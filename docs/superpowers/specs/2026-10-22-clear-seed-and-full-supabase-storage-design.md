# Mim 全项目演示数据清空 + 全模块 Supabase 存储 设计

- 日期：2026-10-22
- 状态：待用户审核

## 一、背景与目标

用户指令：「整个项目所有演示数据删除，整个项目实现全栈所有功能模块数据库储存」。

目标：
1. 删除全部演示数据，项目回到干净初始空态
2. 所有功能模块的数据以 Supabase 云端数据库为主存储，localStorage 仅作离线缓存

## 二、现状盘点

### 2.1 数据层架构
- 纯前端 React 18 + Vite + TS
- Context + useReducer + localStorage（key `mim-state-v1`）
- Supabase 云同步：已完成 6 轮迁移（基建/Auth/写路径内容/写路径个人+读路径/Realtime 私信/工具台云端化）
- `seed.ts`：`cloudEnabled` 时返回空 seed（仅 me 占位），否则返回完整 demo 数据

### 2.2 各模块上云状态
| 模块 | 状态 | 备注 |
|------|------|------|
| posts 动态（发布/转发/点赞/评论/删除） | ✅ 已上云 | 编辑待确认 |
| articles 文章（发布/点赞/删除/草稿） | ✅ 已上云 | 编辑待确认 |
| snippets 代码片段 | ✅ 已上云 | |
| follows 关注 | ✅ 已上云 | |
| favorites 收藏 | ✅ 已上云 | |
| messages 私信 | ✅ 已上云 | 含 Realtime |
| notifications 通知 | ✅ 已上云 | 已读回写 |
| postDrafts/articleDrafts 草稿 | ✅ 已上云 | |
| 14 工具台 | ✅ 已上云 | documents 表 |
| VIP 会员 | ✅ 已上云 | documents 表快照 |
| 商城（购物车/订单/钱包） | ✅ 已上云 | documents 表快照 |
| 搜索/浏览历史 | ❌ 纯本地 | utils.ts `mim-history` key |
| post/article 编辑 | ⚠️ 待确认 | 需查 cloud-write |
| profile 更新 | ⚠️ 待确认 | 需查 cloud-write |

## 三、设计方案

### 阶段 1：清空演示数据

**1.1 seed.ts 改造**
- 删除 `createSeedState()` 中的演示数据分支
- `createSeedState()` 始终返回空 state（复用 `createCloudSeedState` 逻辑）
- 保留 `me` 占位用户（id='me'，昵称"新用户"），所有集合为空数组
- 类型结构不变

**1.2 Supabase 云端业务表清空**
- 在 Supabase Dashboard SQL Editor 执行 TRUNCATE（RLS 会阻止前端 anon 批量删除）
- 清空表：posts、post_comments、articles、article_comments、snippets、follows、favorites、messages、notifications、post_drafts、article_drafts、post_likes、comment_likes、article_likes、snippet_likes、documents、profiles
- **保留**：表结构、触发器、RPC、RLS 策略
- SQL 语句（用户在 Dashboard 执行）：
```sql
TRUNCATE TABLE posts, post_comments, articles, article_comments, snippets,
  follows, favorites, messages, notifications, post_drafts, article_drafts,
  post_likes, comment_likes, article_likes, snippet_likes, documents, profiles
  CASCADE;
```

**1.3 localStorage**
- 不主动清除（用户历史数据保留，登录后云端拉取覆盖同 id 记录）
- 用户可通过顶部 ♻️ 重置按钮手动清空

### 阶段 2：补齐上云缺口

**2.1 搜索/浏览历史上云**
- 新建 `src/lib/cloud-history.ts`
- 走 `documents` 表（`doc_type='history'`，`doc_id=<userId>`）
- 方法：`saveHistory(kw)`、`loadHistory()`、`clearHistory()`
- 云端优先，失败回退 localStorage
- `utils.ts` 中 `recordView`/`saveHist`/`loadHistory`/`clearHistory` 改为调用 cloud-history

**2.2 post/article 编辑上云**
- 检查 `cloud-write.ts` 是否有 `cloudEditPost`/`cloudEditArticle`
- 缺失则新增：`UPDATE posts SET content=$1, images=$2, topic=$3 WHERE id=$4 AND author_id=auth.uid()`
- store.tsx 的 editPost/editArticle action 接入 cloud 写

**2.3 profile 更新上云**
- 检查 cloud-write 是否有 profiles upsert
- 缺失则补 `cloudUpsertProfile(user)`：`INSERT INTO profiles (id, name, bio, ...) VALUES (...) ON CONFLICT (id) DO UPDATE`
- store.tsx updateProfile action 接入

### 阶段 3：统一数据流向

- **写路径**：reducer 乐观更新本地 → `fireCloudWrite` 异步同步 → 失败 `dispatch(cloudRollback*)` 回滚
- **读路径**：登录后 `pullCloudContent()` 拉取全部云端数据 → 合并入本地 state（云端同 id 覆盖本地）
- **离线**：未配置 Supabase / 无网时 localStorage 独立工作，不阻断操作；恢复联网后登录触发同步

### 阶段 4：验证

- 逐模块浏览器实测：发布/点赞/评论/关注/收藏/私信/草稿/工具台/VIP/商城/搜索历史
- Supabase 表数据核验：操作后查表确认数据落库
- 离线降级验证：断网时操作不报错，恢复后同步

## 四、风险与回滚

- **风险 1**：TRUNCATE 清空云端表不可逆 → 用户需确认后在 Dashboard 执行
- **风险 2**：编辑/profile 上云可能引入 RLS 权限问题 → 先在本地测试再上线
- **回滚**：seed.ts 改动可通过 git revert 恢复演示数据；云端数据需用户自行备份

## 五、不在本轮范围

- 不新建后端服务（继续用 Supabase）
- 不重构 store.tsx 整体架构
- 不改变 UI/交互逻辑
