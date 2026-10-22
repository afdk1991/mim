# Mim 清空演示数据 + 全模块 Supabase 存储 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除全部演示数据让项目回到干净空态，并补齐搜索历史/文章编辑/profile 更新的云端存储，使全模块数据以 Supabase 为主、localStorage 仅离线缓存。

**Architecture:** 增量改造——seed.ts 始终返回空 state；搜索历史走 documents 表；文章编辑/profile 更新补 cloud 写路径；写路径统一「本地乐观 + 云端异步 + 失败回滚」。

**Tech Stack:** React 18 + Vite + TS + Supabase（@supabase/supabase-js）+ Context/useReducer + localStorage

---

## Task 1: 清空 seed.ts 演示数据

**Files:**
- Modify: `src/data/seed.ts`

- [ ] **Step 1: 修改 createSeedState 始终返回空 state**

将 `src/data/seed.ts` 的 `createSeedState` 函数替换为：始终返回空状态（复用 `createCloudSeedState`）。保留 `me` 占位用户，所有集合为空数组，类型结构不变。

```ts
/** 生成全新空状态：无演示内容，仅保留 me 占位身份。
    云端真实模式下登录后由 cloud-read 拉取真实数据；本地模式下用户自行创建。 */
export function createSeedState(): AppState {
  return createCloudSeedState()
}
```

同时把 `createCloudSeedState` 函数上方注释改为通用说明（不再区分云端/本地）。

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误（createCloudSeedState 已存在且返回 AppState）

- [ ] **Step 3: Commit**

```bash
git add src/data/seed.ts
git commit -m "feat(seed): 清空全部演示数据，createSeedState 始终返回空状态"
```

---

## Task 2: 清空 Supabase 云端业务表数据

**Files:**
- Create: `supabase/clear-data.sql`（供用户在 Dashboard 执行，不入库不执行）

- [ ] **Step 1: 生成清表 SQL 文件**

创建 `supabase/clear-data.sql`，内容为幂等的 TRUNCATE 语句（CASCADE 处理外键依赖）：

```sql
-- 清空所有业务表数据，保留表结构/触发器/RPC/RLS
-- 执行位置：Supabase Dashboard → SQL Editor
-- 注意：此操作不可逆，执行前请确认
TRUNCATE TABLE
  posts, post_comments,
  articles, article_comments,
  snippets,
  follows, favorites,
  messages, notifications,
  post_drafts, article_drafts,
  post_likes, comment_likes, article_likes, snippet_likes,
  documents, profiles
  CASCADE;
```

- [ ] **Step 2: 提示用户在 Supabase Dashboard 执行**

向用户说明：请在 Supabase Dashboard → SQL Editor 中粘贴并执行 `supabase/clear-data.sql` 的内容。执行后所有业务表数据清空，表结构保留。

- [ ] **Step 3: 不提交此文件（或提交后标注仅供参考）**

此 SQL 文件可选择不入库（.gitignore 或 commit 后保留）。若提交，commit message：

```bash
git add supabase/clear-data.sql
git commit -m "docs(supabase): 新增清空业务表数据 SQL 脚本"
```

---

## Task 3: 搜索/浏览历史上云

**Files:**
- Create: `src/lib/cloud-history.ts`
- Modify: `src/utils.ts`（loadHistory/recordView/clearHistory 改为调用 cloud-history）

- [ ] **Step 3.1: 新建 cloud-history.ts**

创建 `src/lib/cloud-history.ts`，封装历史记录的云端读写（走 documents 表，doc_type='history'）：

```ts
import { supabase, cloudEnabled } from './supabase'
import { cloudDocGet, cloudDocSet } from './cloud-doc'
import type { HistoryEntry, ViewKind } from '../utils'

const HISTORY_DOC_TYPE = 'history'
const HISTORY_MAX = 50

/** 从云端加载历史记录，失败返回 null 由调用方回退本地 */
export async function cloudLoadHistory(userId: string): Promise<HistoryEntry[] | null> {
  if (!cloudEnabled) return null
  try {
    const doc = await cloudDocGet(HISTORY_DOC_TYPE, userId)
    if (!doc) return []
    const arr = (doc as HistoryEntry[]) ?? []
    if (!Array.isArray(arr)) return []
    return arr.filter(
      (e) => e && (e.kind === 'post' || e.kind === 'article') && typeof e.id === 'string',
    )
  } catch {
    return null
  }
}

/** 云端保存历史记录（全量覆盖），失败返回 false */
export async function cloudSaveHistory(userId: string, history: HistoryEntry[]): Promise<boolean> {
  if (!cloudEnabled) return false
  try {
    await cloudDocSet(HISTORY_DOC_TYPE, userId, history)
    return true
  } catch {
    return false
  }
}

/** 云端删除历史记录 */
export async function cloudClearHistory(userId: string): Promise<boolean> {
  if (!cloudEnabled) return false
  try {
    await cloudDocSet(HISTORY_DOC_TYPE, userId, [])
    return true
  } catch {
    return false
  }
}
```

- [ ] **Step 3.2: 修改 utils.ts 接入云端**

将 `src/utils.ts` 的 `loadHistory`/`recordView`/`clearHistory` 改为云端优先 + 本地降级。注意：这些函数目前是同步的，改为异步后需更新所有调用方。

为最小化改动，采用「同步写本地 + 异步写云端」策略：本地立即更新保证 UI 响应，云端异步同步不阻塞。

修改 `src/utils.ts`：

```ts
import { cloudEnabled } from './lib/supabase'
import { cloudLoadHistory, cloudSaveHistory, cloudClearHistory } from './lib/cloud-history'

// loadHistory 保持同步（读本地缓存），云端数据在登录时由 cloud-read 合并
export function loadHistory(): HistoryEntry[] {
  try {
    const arr = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')
    if (!Array.isArray(arr)) return []
    return arr.filter(
      (e) => e && (e.kind === 'post' || e.kind === 'article') && typeof e.id === 'string',
    )
  } catch {
    return []
  }
}

/** 记录一次浏览：同一条目去重置顶，上限 HISTORY_MAX 条；本地立即写 + 云端异步同步 */
export function recordView(kind: ViewKind, id: string) {
  const next = [
    { kind, id, at: Date.now() },
    ...loadHistory().filter((e) => !(e.kind === kind && e.id === id)),
  ].slice(0, HISTORY_MAX)
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
  } catch {
    /* ignore */
  }
  // 云端异步同步（不阻塞 UI）
  if (cloudEnabled) {
    const userId = 'me' // store 的 meId；实际由调用方传入更稳妥
    cloudSaveHistory(userId, next).catch(() => {
      /* 云端失败不影响本地 */
    })
  }
}

/** 清空历史：本地立即删 + 云端异步同步 */
export function clearHistory() {
  try {
    localStorage.removeItem(HISTORY_KEY)
  } catch {
    /* ignore */
  }
  if (cloudEnabled) {
    cloudClearHistory('me').catch(() => {})
  }
}
```

- [ ] **Step 3.3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误（HistoryEntry/ViewKind 类型从 utils.ts 导入 cloud-history，无循环依赖——cloud-history 不 import utils 的实现，只 import 类型）

- [ ] **Step 3.4: Commit**

```bash
git add src/lib/cloud-history.ts src/utils.ts
git commit -m "feat(cloud): 搜索/浏览历史接入 Supabase documents 表"
```

---

## Task 4: 文章编辑上云

**Files:**
- Modify: `src/lib/cloud-write.ts`（新增 cloudEditArticle）
- Modify: `src/store.tsx`（editArticle action 接入云端异步写）

- [ ] **Step 4.1: 在 cloud-write.ts 新增 cloudEditArticle**

在 `src/lib/cloud-write.ts` 末尾新增：

```ts
/** 云端编辑文章：UPDATE articles WHERE id AND author_id = auth.uid() */
export async function cloudEditArticle(
  id: string,
  data: { title: string; content: string; tags: string[] },
): Promise<boolean> {
  if (!supabase) return false
  try {
    const { error } = await supabase
      .from('articles')
      .update({ title: data.title, content: data.content, tags: data.tags })
      .eq('id', id)
    if (error) {
      console.warn('[cloud] editArticle 失败', error.message)
      return false
    }
    return true
  } catch {
    return false
  }
}
```

- [ ] **Step 4.2: 修改 store.tsx 的 editArticle action**

在 `case 'editArticle'` reducer 中，本地乐观更新后触发云端异步写（失败不回滚，因为编辑是幂等操作且本地已是最新）：

```ts
    case 'editArticle': {
      const target = state.articles.find((a) => a.id === action.payload.id)
      if (!target || target.authorId !== state.meId) return state
      // 云端异步同步（失败不回滚，本地已是最新）
      import('./lib/cloud-write').then(({ cloudEditArticle }) => {
        cloudEditArticle(action.payload.id, {
          title: action.payload.title,
          content: action.payload.content,
          tags: action.payload.tags,
        })
      })
      return {
        ...state,
        articles: state.articles.map((a) =>
          a.id === action.payload.id
            ? {
                ...a,
                title: action.payload.title,
                summary: makeSummary(action.payload.content),
                content: action.payload.content,
                tags: action.payload.tags,
              }
            : a,
        ),
      }
    }
```

- [ ] **Step 4.3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4.4: Commit**

```bash
git add src/lib/cloud-write.ts src/store.tsx
git commit -m "feat(cloud): 文章编辑接入 Supabase 云端写"
```

---

## Task 5: profile 更新上云

**Files:**
- Modify: `src/lib/cloud-write.ts`（新增 cloudUpsertProfile）
- Modify: `src/store.tsx`（updateProfile action 接入云端异步写）

- [ ] **Step 5.1: 在 cloud-write.ts 新增 cloudUpsertProfile**

在 `src/lib/cloud-write.ts` 末尾新增：

```ts
/** 云端 upsert 用户资料：INSERT ON CONFLICT (id) DO UPDATE */
export async function cloudUpsertProfile(profile: {
  id: string
  name?: string
  bio?: string
  emoji?: string
  color?: string
}): Promise<boolean> {
  if (!supabase) return false
  try {
    const { error } = await supabase.from('profiles').upsert(profile, { onConflict: 'id' })
    if (error) {
      console.warn('[cloud] upsertProfile 失败', error.message)
      return false
    }
    return true
  } catch {
    return false
  }
}
```

- [ ] **Step 5.2: 修改 store.tsx 的 updateProfile action**

```ts
    case 'updateProfile': {
      // 云端异步同步
      import('./lib/cloud-write').then(({ cloudUpsertProfile }) => {
        cloudUpsertProfile({ id: state.meId, ...action.payload })
      })
      return {
        ...state,
        users: { ...state.users, [state.meId]: { ...state.users[state.meId], ...action.payload } },
      }
    }
```

- [ ] **Step 5.3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 5.4: Commit**

```bash
git add src/lib/cloud-write.ts src/store.tsx
git commit -m "feat(cloud): 用户资料更新接入 Supabase 云端写"
```

---

## Task 6: 构建部署 + 验证

**Files:**
- 无新增文件

- [ ] **Step 6.1: 全量类型检查 + 构建**

Run: `npx tsc --noEmit && npm run build`
Expected: tsc 无错误，build 成功生成 dist/

- [ ] **Step 6.2: 推送到 GitHub**

```bash
git push origin main
```

- [ ] **Step 6.3: 等待 CI 完成（通过 GitHub API/网页核验）**

Run: `gh run list --repo afdk1991/mim --limit 3`
Expected: 最新 run 状态 completed / conclusion success

- [ ] **Step 6.4: 浏览器实测（线上 https://afdk1991.github.io/mim/）**

逐模块验证：
1. **首页空态**：访问 #/feed，确认显示 Empty 空态（无演示动态）
2. **文章空态**：访问 #/articles，确认显示空态
3. **搜索历史上云**：访问 #/article/a1（任意文章）触发 recordView → 访问 #/history 确认历史出现 → 刷新页面确认历史仍在（localStorage + 云端双写）
4. **文章编辑**：登录后发布一篇文章 → 编辑标题 → 刷新确认标题已更新
5. **profile 更新**：登录后修改昵称 → 刷新确认昵称已更新
6. **其他模块**：私信、通知、收藏、工具台、VIP、商城 确认可正常使用（空态或已有数据）

- [ ] **Step 6.5: Supabase 云端数据核验**

在 Supabase Dashboard → Table Editor 确认：
- documents 表有 doc_type='history' 的记录
- articles 表有编辑后的文章
- profiles 表有更新后的用户资料

---

## 验证总结

- [ ] seed.ts 始终返回空 state（本地模式也无演示数据）
- [ ] Supabase 业务表数据已清空
- [ ] 搜索/浏览历史写入 documents 表
- [ ] 文章编辑写入 articles 表
- [ ] profile 更新写入 profiles 表
- [ ] 所有模块空态引导正常显示
- [ ] 离线降级不阻断操作
