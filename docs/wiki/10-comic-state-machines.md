# 10. 漫剧模块完整状态机文档

> 本文是漫剧 AI 剧工作台（`comic.workbench`）三套状态机的**权威文档**，全部内容锚定仓库实况代码：
> - 路由实现：[services/mim-api/src/routes/comic.ts](../../services/mim-api/src/routes/comic.ts)（24 条路由）
> - DB CHECK 约束：[services/mim-api/src/schema.sql](../../services/mim-api/src/schema.sql)
> - 冒烟链路：[05-runbook.md](./05-runbook.md) §6.4
>
> 线上环境参照：<https://mim.mixm.top>（生产 API 前缀 `/api/v1`，无 token 一律 401）。

## 0. 总览

| 状态机 | 表 | 状态数 | 核心驱动 |
|---|---|---|---|
| 工程状态机 | `comic_projects.status` | 6（draft / storyboarded / generating / rendered / published / archived） | 人工确认分镜 + 任务派发 + 合成完成 + 成片发布 |
| 任务状态机 | `generation_jobs.status` | 5（queued / running / succeeded / failed / canceled） | 显式 start / complete / fail / cancel / retry 路由 |
| 成片状态机 | `comic_films.status` | 4（draft / reviewing / published / archived） | 提交审核 / 发布 / 驳回 / 归档 |

**贯穿性约束（代码级事实）**：

1. **门禁**：全部 24 条路由挂 `requireAuth` + `requireEntitlement('comic.workbench')`（`MODULE_CODE`），无 token 401、无权限 403。
2. **归属判定**：`findProject` / `findJob` / `findFilm` 均要求「本人 + 未删除」，跨用户与不存在一律 404，不泄漏存在性；job / film 经 JOIN `comic_projects` 判定归属。
3. **内容冻结边界**：`EDITABLE_STATUSES = new Set(['draft', 'storyboarded'])`——工程进入 `generating` 后，标题/简介/分镜/角色全部冻结，`PATCH` 返回 409。
4. **版本只追加不覆盖**：storyboard（`version_no` 自增）、film_versions（`version_no` 自增）、generation_jobs（retry 新建行，历史 job 永不覆盖）。
5. **乐观锁**：`PATCH /comic/projects/:id` 必传 `version`，不匹配返回 409 CONFLICT。
6. **幂等**：`POST /comic/projects` 走 `idempotency` 中间件；删除为事务软删（写 `deleted_at`）。

---

## 1. 工程状态机（comic_projects）

### 1.1 状态定义

DB CHECK（schema.sql）：

```sql
status TEXT NOT NULL DEFAULT 'draft'
CHECK (status IN ('draft','storyboarded','generating','rendered','published','archived'))
```

路由常量 `PROJECT_STATUSES` 与 CHECK 六值一一对应。

| 状态 | 含义 | 进入条件 | 可编辑内容 |
|---|---|---|---|
| `draft` | 草稿（初始态） | `POST /comic/projects` 创建即 draft | ✅ 在 EDITABLE_STATUSES |
| `storyboarded` | 分镜已确认 | `POST /comic/projects/:id/storyboard` 且 `confirm=true` | ✅ 在 EDITABLE_STATUSES |
| `generating` | 生成中 | 首次 `POST /comic/projects/:id/jobs` 派发任务 | ❌ 内容冻结 |
| `rendered` | 渲染完成 | `compose` 类型任务 `complete` 成功 | ❌ |
| `published` | 已发布 | 任一 film `publish` 成功 | ❌ |
| `archived` | 已归档 | DB CHECK 保留值；**当前路由无主动归档入口** | ❌ |

### 1.2 状态转移图

```
                 POST /projects
                      │
                      ▼
        ┌───────┐  storyboard(confirm=true)  ┌──────────────┐
        │ draft │ ─────────────────────────► │ storyboarded │
        └───────┘                              └──────────────┘
                                                    │ 首次 POST /jobs
                                                    ▼
        ┌───────────┐  film publish  ┌───────────┐  compose complete ┌─────────────┐
        │ published │ ◄───────────── │ rendered  │ ◄──────────────── │ generating  │
        └───────────┘                └───────────┘                   └─────────────┘
                                            │ 注：published 工程仍可继续派任务/发新 film

   archived：DB 保留终态，路由层暂无入口
```

### 1.3 转移明细（触发路由 ↔ 守卫 ↔ 副作用）

| # | 转移 | 触发路由 | 守卫条件 | 副作用 |
|---|---|---|---|---|
| P1 | — → `draft` | `POST /comic/projects` | 通过 zod `createBody`（title 1..120） | 幂等创建；`version=1` |
| P2 | `draft → storyboarded` | `POST /comic/projects/:id/storyboard` | 工程在 EDITABLE_STATUSES；shot.index 唯一；`confirm=true` | 新增 storyboard 版本（`version_no` 自增）+ 写 `confirmed_at` + 工程状态置 storyboarded |
| P3 | `storyboarded → generating` | `POST /comic/projects/:id/jobs` | 工程状态 ∈ {storyboarded, generating}（否则 409）；storyboard_id（如传）必须存在 | 首个任务派发驱动工程 `storyboarded → generating`；后续任务不再改变状态 |
| P4 | `generating → rendered` | `POST /comic/jobs/:id/complete`（`job_type='compose'`） | job 当前 `running` | 条件更新 `WHERE status='generating'` → rendered；非 compose 任务完成不影响工程状态 |
| P5 | `rendered → published` | `POST /comic/films/:id/publish` | film 当前 `reviewing`（见 §3） | 事务内条件更新 `WHERE status='rendered'` → published（与 film 发布同事务） |
| P6 | 删除（非状态转移） | `DELETE /comic/projects/:id` | 工程归属本人 | 事务软删：工程 + 角色写 `deleted_at`；后续所有 find* 404 |

**说明**：
- `PATCH /comic/projects/:id`（改标题/简介）不改变状态，但受 `EDITABLE_STATUSES` 门禁 + 乐观锁 `version` 约束，违规 409。
- `archived` 当前仅在 DB CHECK 与 `listQuery.status` 枚举中保留，是预留终态；路由层没有产生 archived 的路径。

---

## 2. 任务状态机（generation_jobs）

### 2.1 状态定义

```sql
status TEXT NOT NULL DEFAULT 'queued'
CHECK (status IN ('queued','running','succeeded','failed','canceled'))
```

任务类型 `JOB_TYPES = ['text','image','video','tts','compose']`；索引 `idx_generation_jobs_status_type(status, job_type)` 支撑按状态+类型扫描（为后续 ai-orchestrator 消费预留）。

| 状态 | 含义 |
|---|---|
| `queued` | 已排队（初始态） |
| `running` | 执行中（写 `started_at`） |
| `succeeded` | 成功终态（写 `result` + `finished_at`） |
| `failed` | 失败终态（写 `error_code` + `finished_at`） |
| `canceled` | 取消终态（写 `finished_at`） |

### 2.2 状态转移图

```
              POST /projects/:id/jobs
                       │
                       ▼
              ┌──────────────┐   start    ┌─────────┐  complete  ┌───────────┐
              │   queued     │ ─────────► │ running │ ─────────► │ succeeded │（终态）
              └──────────────┘            └─────────┘            └───────────┘
                    │  cancel                 │  fail             ▲
                    ▼                         ▼                   │ retry（新建 queued job）
              ┌───────────┐            ┌──────────┐               │   retry_of 指向原 job
              │ canceled  │（终态）     │  failed  │ ──────────────┘
              └───────────┘            └──────────┘   （原 job 保持 failed 不变）
                    ▲
                    └──────── running 也可 cancel → canceled
```

**关键不变量**：
- `queued/running/succeeded/failed/canceled` 单向推进；终态（succeeded/failed/canceled）不可再转移。
- `retry` **不修改原 job**：新建一条 `queued` job，`retry_of` 指向原 failed job，历史审计链完整保留。
- `start` 仅允许 `queued`；`complete` / `fail` 仅允许 `running`；不满足返回 409。

### 2.3 转移明细

| # | 转移 | 触发路由 | 守卫条件 | 副作用 |
|---|---|---|---|---|
| J1 | — → `queued` | `POST /comic/projects/:id/jobs` | 工程状态 ∈ {storyboarded, generating}；storyboard_id 存在性 | 首个任务触发工程 P3（→ generating） |
| J2 | `queued → running` | `POST /comic/jobs/:id/start` | 当前 `queued`（否则 409） | 写 `started_at` |
| J3 | `running → succeeded` | `POST /comic/jobs/:id/complete` | 当前 `running`（否则 409） | 写 `result` + `finished_at`；若 `job_type='compose'` 触发工程 P4（→ rendered） |
| J4 | `running → failed` | `POST /comic/jobs/:id/fail` | 当前 `running`（否则 409）；`error_code` 1..80 | 写 `error_code` + `finished_at` |
| J5 | `queued\|running → canceled` | `POST /comic/jobs/:id/cancel` | 当前 ∈ {queued, running}（否则 409） | 写 `finished_at` |
| J6 | `failed →`（新建）`queued` | `POST /comic/jobs/:id/retry` | 当前 `failed`（否则 409） | **新建** queued job（201），`retry_of = 原 job id`；原 job 保持 failed |

只读路由：`GET /comic/jobs/:id`（经 findJob 归属判定）。

---

## 3. 成片状态机（comic_films）

### 3.1 状态定义

```sql
status TEXT NOT NULL DEFAULT 'draft'
CHECK (status IN ('draft','reviewing','published','archived'))
```

| 状态 | 含义 |
|---|---|
| `draft` | 草稿（初始态 / 驳回后 / 发新版本后回到此态） |
| `reviewing` | 审核中（最新版本须已登记 `object_key`） |
| `published` | 已发布（写 `current_version_id` + 版本 `published_at`） |
| `archived` | 归档终态（不可再操作） |

### 3.2 状态转移图

```
        POST /projects/:id/films（工程须 rendered|published）
                       │
                       ▼
        ┌───────┐  submit-review   ┌───────────┐   publish    ┌───────────┐
        │ draft │ ───────────────► │ reviewing │ ───────────► │ published │
        └───────┘  （最新版本须有    └───────────┘              └───────────┘
              ▲      object_key）        │ reject                   │ POST /films/:id/versions
              │                          │ （写 review_note）        │ （追加新版本）
              └──────────────────────────┘                          ▼
              ◄──────────────── 回到 draft（review_note=NULL） ──────┘

        任意非 archived ── POST /films/:id/archive ──► archived（终态，重复归档 409）
```

### 3.3 转移明细

| # | 转移 | 触发路由 | 守卫条件 | 副作用 |
|---|---|---|---|---|
| F1 | — → `draft` | `POST /comic/projects/:id/films` | 工程状态 ∈ {rendered, published}（否则 409） | **事务**：建 film（draft）+ film_versions v1（可带 object_key/duration/size） |
| F2 | 任意 →（追加版本） | `POST /comic/films/:id/versions` | film 非 archived（archived 409） | 版本 `version_no` 自增、**只追加不覆盖**；若 film 当前 `published` → 回到 `draft` 且 `review_note=NULL` |
| F3 | `draft → reviewing` | `POST /comic/films/:id/submit-review` | 当前 `draft`；**最新版本已登记 object_key**（否则 409） | 状态置 reviewing |
| F4 | `reviewing → published` | `POST /comic/films/:id/publish` | 当前 `reviewing`（否则 409） | **事务**：写 `current_version_id=最新版本` + `film_versions.published_at` + 触发工程 P5（rendered → published，条件更新） |
| F5 | `reviewing → draft` | `POST /comic/films/:id/reject` | 当前 `reviewing`（否则 409）；`reason` 1..500 | 写 `review_note=reason`，回到 draft |
| F6 | 任意非 archived → `archived` | `POST /comic/films/:id/archive` | 当前非 archived（重复归档 409） | 终态；此后 versions/submit/publish/reject/archive 全部 409 |

只读路由：`GET /comic/projects/:id/films`（status 过滤 + limit）、`GET /comic/films/:id`（含 versions 列表）。

---

## 4. 24 条路由 ↔ 状态机对照总表

| # | 方法与路径 | 域 | 状态效果 |
|---|---|---|---|
| 1 | `POST /comic/projects` | 工程 | 创建 draft（幂等） |
| 2 | `GET /comic/projects` | 工程 | 只读（status/limit 过滤） |
| 3 | `GET /comic/projects/:id` | 工程 | 只读（含 characters + latest_storyboard） |
| 4 | `PATCH /comic/projects/:id` | 工程 | 不改状态；EDITABLE_STATUSES + 乐观锁 |
| 5 | `DELETE /comic/projects/:id` | 工程 | 事务软删（deleted_at） |
| 6 | `POST /comic/projects/:id/storyboard` | 工程 | P2：confirm → storyboarded；版本自增 |
| 7 | `POST /comic/projects/:id/characters` | 工程 | 同名 upsert；内容不变 200 `created:false` |
| 8 | `POST /comic/projects/:id/suggest` | 工程 | mock 建议（不落库，`requires_confirmation:true`） |
| 9 | `GET /comic/projects/:id/jobs` | 任务 | 只读（status/job_type/limit 过滤） |
| 10 | `POST /comic/projects/:id/jobs` | 任务 | J1 + 首个任务 P3 |
| 11 | `GET /comic/jobs/:id` | 任务 | 只读 |
| 12 | `POST /comic/jobs/:id/start` | 任务 | J2：queued → running |
| 13 | `POST /comic/jobs/:id/complete` | 任务 | J3：running → succeeded；compose 触发 P4 |
| 14 | `POST /comic/jobs/:id/fail` | 任务 | J4：running → failed |
| 15 | `POST /comic/jobs/:id/cancel` | 任务 | J5：queued\|running → canceled |
| 16 | `POST /comic/jobs/:id/retry` | 任务 | J6：failed → 新建 queued（retry_of） |
| 17 | `POST /comic/projects/:id/films` | 成片 | F1：建 draft film + v1（事务） |
| 18 | `GET /comic/projects/:id/films` | 成片 | 只读（status/limit） |
| 19 | `GET /comic/films/:id` | 成片 | 只读（含 versions） |
| 20 | `POST /comic/films/:id/versions` | 成片 | F2：追加版本；published → draft |
| 21 | `POST /comic/films/:id/submit-review` | 成片 | F3：draft → reviewing |
| 22 | `POST /comic/films/:id/publish` | 成片 | F4：reviewing → published + 工程 P5（事务） |
| 23 | `POST /comic/films/:id/reject` | 成片 | F5：reviewing → draft（review_note） |
| 24 | `POST /comic/films/:id/archive` | 成片 | F6：→ archived（终态） |

> 计数取证：`router.(get|post|patch|delete)(` 在 comic.ts 命中 24 行，与本表一一对应。

## 5. 与冒烟链路对应（runbook §6.4）

| 冒烟段 | 步骤 | 覆盖的状态转移 |
|---|---|---|
| 第 1 期 6 步链路 | 建工程 → 写分镜（confirm）→ 建角色 → suggest → 查详情 → PATCH | P1 → P2 →（角色 upsert）→（mock 不落库）→ 只读 → 乐观锁 |
| 第 2 期 jobs 链路 | 派任务 → start → complete（compose） | J1/P3 → J2 → J3/P4（工程 rendered） |
| 第 2 期 films 链路 | 建 film → submit-review → publish | F1 → F3 → F4/P5（工程 published） |
| 失败链路 | 派任务 → start → fail → retry | J1 → J2 → J4 → J6（新 queued 挂 retry_of） |
| 驳回链路 | submit-review → reject → 重新 submit | F3 → F5（review_note 留存）→ F3 |

## 6. DB 约束与索引速查

| 表 | CHECK | 关键索引 | 软删 |
|---|---|---|---|
| `comic_projects` | 6 值 | `idx_comic_projects_owner(owner_user_id, status, created_at)` | `deleted_at` |
| `comic_characters` | — | 按 project_id | `deleted_at` |
| `storyboards` | — | 按 (project_id, version_no) | —（版本只追加） |
| `generation_jobs` | 5 值 | `idx_generation_jobs_status_type(status, job_type)` | —（retry 新建行） |
| `generation_assets` | — | 按 job_id | — |
| `comic_films` | 4 值 | `idx_comic_films_project(project_id, status, created_at)` | `deleted_at` |
| `film_versions` | — | 按 (film_id, version_no) | —（版本只追加） |

## 7. 当前边界与后续接入点（如实标注）

- **路由已上线、编排器/存储已装配、前端视图 0 代码**：漫剧模块当前无 `apps/web` 视图入口（`App.tsx` 仅 settings 视图），所有能力仅经 API 暴露。
- `suggest` 为本地 mock（`model:'mock-text-suggest'`），不伪造外部模型输出；真实文本模型待接入。
- `ai-orchestrator` 队列消费与 media 域 `/media/presign/*` 预签名为后续接入点，骨架不伪造外部产物。
- 工程 `archived` 为 DB 预留终态，路由层暂无入口（如需启用须新增路由并同步本文）。
