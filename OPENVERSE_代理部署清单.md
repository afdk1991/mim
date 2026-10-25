# Openverse 代理部署清单（P0 部署准备）

> 本文件是 **P0 部署准备**：仅列出命令与密钥清单，**尚未执行任何部署**，待你提供凭证后由 AI 逐项执行。
> 通用后端部署见 [DEPLOY.md](./DEPLOY.md)；本清单只聚焦「开放授权媒体检索代理（Openverse / Commons）」上线所需的最小动作。

## 一、当前状态

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| 代理代码（Supabase Edge Function） | ✅ 已就绪 | `supabase/functions/mim-api/index.ts` 已含 `/openverse/videos`、`/openverse/audio` 路由（先于鉴权门禁） |
| 代理代码（CloudBase 云函数） | ✅ 已就绪 | `cloudfunctions/mim-api/index.js` 同契约实现 |
| 前端接入 | ✅ 已就绪 | `src/lib/openverse.ts` 优先走 mim-api 代理，本地模式回退直连 |
| Openverse 凭证 | ⛔ 未配置 | 当前走匿名 5 次/小时 限流；本地直连还可能被 CORS 拦截 |
| 函数实际部署 | ⛔ 未部署/未注入 Openverse 密钥 | 代码在仓库，但线上函数未接收到 `OPENVERSE_*` |

**上线后效果**：解除匿名限流（注册客户端 10,000 次/天）、服务端 5 分钟缓存（重复关键词 0 上游请求）、CORS 不再受限。

## 二、A. Supabase Edge Function 部署

前置：DEPLOY.md 已配 4 个 Secrets（`SUPABASE_ACCESS_TOKEN` / `SUPABASE_PROJECT_REF` / `SUPABASE_SERVICE_ROLE_KEY` / `MIM_TOKEN_SECRET`）。

```powershell
# 1) 部署函数（含 Openverse 路由）
supabase functions deploy mim-api --project-ref <ref>

# 2) 注入 Openverse 注册客户端凭证（提额到 10,000/天）；未配则回落匿名 5 次/小时
supabase secrets set OPENVERSE_CLIENT_ID=<id> OPENVERSE_CLIENT_SECRET=<secret> --project-ref <ref>
```

验证（替换 `<ref>` 与匿名 key）：

```bash
curl -s "https://<ref>.supabase.co/functions/v1/mim-api/openverse/videos?q=animation&page=1&page_size=2" \
  -H "Authorization: Bearer $ANON" | head -c 400
# 期望：HTTP 200，JSON 含 result_count / page / page_count，且带 cached:false
```

## 三、B. CloudBase 云函数部署

前置：DEPLOY.md 已配 `CLOUDBASE_SECRET_ID` / `CLOUDBASE_SECRET_KEY` / `CLOUDBASE_ENV_ID`。

```powershell
# 1) 部署（函数目录的父目录是 cloudfunctions）
tcb fn deploy mim-api --dir ./cloudfunctions -e <ENV_ID>

# 2) 在函数「环境变量」中设置 Openverse 凭证（代码兼容 MIM_OV_* 与 OPENVERSE_* 两种）
#    MIM_OV_CLIENT_ID / MIM_OV_CLIENT_SECRET（或 OPENVERSE_CLIENT_ID / OPENVERSE_CLIENT_SECRET）
```

验证：

```bash
curl -s "https://cs-1-d5g815slocb5a611a-1320483685.ap-shanghai.app.tcloudbase.com/mim-api/openverse/videos?q=animation&page=1&page_size=2" | head -c 400
# 期望：HTTP 200，JSON 含 result_count / page / page_count
```

## 四、所需密钥清单（总表）

| 密钥 | 用途 | 获取位置 | 必须？ |
| --- | --- | --- | --- |
| `OPENVERSE_CLIENT_ID` | Openverse 注册客户端，提额至 10,000/天 | api.openverse.org → API Keys（注册 OAuth Application） | 推荐（否则匿名 5 次/小时） |
| `OPENVERSE_CLIENT_SECRET` | 同上（换取 access_token） | 同上 | 推荐 |
| `SUPABASE_ACCESS_TOKEN` | 部署 Edge Function | Supabase Dashboard → Account → Access Tokens | 部署 Supabase 版必需 |
| `SUPABASE_PROJECT_REF` | 项目 ref（形如 `sepfobukokrrivwyvhnd`） | Supabase Dashboard → Project Settings → General | 部署 Supabase 版必需 |
| `SUPABASE_SERVICE_ROLE_KEY` | 函数内 service_role 访问 | Supabase Dashboard → Project Settings → API | 部署 Supabase 版必需 |
| `MIM_TOKEN_SECRET` | 自建 HMAC 令牌密钥（任意长随机串；轮换会使旧令牌失效） | 自生成 | 部署 Supabase 版必需 |
| `CLOUDBASE_SECRET_ID` / `CLOUDBASE_SECRET_KEY` | 部署 CloudBase 云函数 | 腾讯云 CAM 子账号密钥 | 部署 CloudBase 版必需 |
| `CLOUDBASE_ENV_ID` | CloudBase 环境 ID（形如 `xxx-1a2b3c4d`） | CloudBase 控制台 | 部署 CloudBase 版必需 |
| `MIM_SERVICE_KEY` / `MIM_SUPABASE_URL` / `MIM_SUPABASE_ANON_KEY` / `MIM_STORAGE_BUCKET` | 云函数其余 API（账号/数据/存储） | 见 DEPLOY.md | 部署 CloudBase 版必需 |

> 不配置 `OPENVERSE_*` 也能部署，只是代理回落到匿名限流（5 次/小时）——功能可用但不适合正式使用。

## 五、本地模式（无凭证）说明

- 未配任何后端时，前端**直连** `api.openverse.org`；但浏览器 CORS 支持不稳定，可能失败。
- 失败已被细分为 `network`（断网/跨域/超时）、`rate_limit`（429）、`upstream`（非 2xx）、`parse`（JSON 解析失败），并给出针对性文案。
- 本次 P1/P2 已完成：前端结果缓存、Commons 分页、license 强制、音频种子、错误细分——本地模式**可用但不保证跨域稳定**。

## 六、执行清单（待你提供凭证后 AI 逐项执行）

- [ ] 收齐密钥（至少选一个部署目标：Supabase / CloudBase / 两者）
- [ ] 执行 `deploy` + `secrets set`
- [ ] `curl` 验证两个 `/openverse` 路由返回 200 且含 `result_count`
- [ ] 在线上站点实测在线发现（动画视频 / 音频 / Commons AI 视频 三源）
