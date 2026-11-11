# 项目主题与 Gitee Explore 分类映射（2026-11-12）

> 本文回答一件事：**Mim 的项目主题从哪里来、归到哪些分类、用什么对外表述**。
> 主题词不自行发明，全部取自 [Gitee Explore](https://gitee.com/explore) 的真实分类页；本文逐条记录分类名称、真实路径（slug）、抓取时间与对标项目。

## 1. 主题定名

**一句话主题**：IM 即时通讯 + AI 漫剧创作 + 模块化商城，一套 Node/TypeScript 全栈、多平台发布的跨端协作平台。

**主题词（用于仓库介绍 / README / 对外描述）**：`IM 即时通讯` · `AI 漫剧` · `模块商城` · `多端 Web 应用` · `Node / TypeScript`

## 2. 分类映射（全部为 Gitee Explore 真实分类）

| 归属 | Gitee 分类（页面标题原文） | 真实路径 | 映射理由（对应 Mim 已实现模块） | 本轮抓取时间 |
|---|---|---|---|---|
| 主分类 | `IM即时通讯/聊天` | https://gitee.com/explore/im | `/chat` 单聊 / 群聊 / 引用回复 / 撤回 / 文件与图片消息、WebRTC 视频通话（`apps/web/src/views/Chat.tsx`、`components/VideoCall.tsx`、`services/mim-api/src/im/*`） | 2026-11-12 |
| 主分类 | `WEB应用开发` | https://gitee.com/explore/web-app-develop | 前端产物 `apps/web`（SPA 单页、深链接回退四件套）+ `apps/admin`（管理端），Vite/React/TypeScript 构建 | 2026-11-12 |
| 辅分类 | `后台管理框架` | https://gitee.com/explore/backend | `/admin/` 管理后台、订单与渠道/交易号视图、`/api/v1/*` 管理类接口 | 2026-11-12 |
| 辅分类 | `AI-人工智能` | https://gitee.com/explore/ai | 漫剧创作工作台、AI 剧本扩充、AI 配音合成、生成包（`comic.*` / `ai.*` 模块） | 2026-11-12 |
| 辅分类 | `多媒体` | https://gitee.com/explore/multimedia | 漫剧成片渲染与导出（MOV/720p 转码降级）、WebRTC 音视频链路、云存储扩容模块 | 2026-11-12 |

> 说明：Gitee Explore 的分类由平台策展维护，仓库侧**没有**「主题 / 标签」自助字段（见 §4），所以主题只能通过仓库介绍、主页、语言与仓库内文档对外表达。

## 3. 同分类标杆项目（本轮实测数据，用作定位参照，非依赖）

| 分类 | 标杆项目（Gitee 路径） | Star | 语言 | 与本项目的差异点 |
|---|---|---|---|---|
| IM即时通讯/聊天 | `轨迹/J-IM` | 13.3K | Java | 服务端为主、单机百万在线；Mim 是 Node/TS 全栈 + 前端一体化交付 |
| IM即时通讯/聊天 | `远方夕阳/cim` | 6.7K | Java | Netty 推送系统；Mim 走 WebSocket + HTTP 同一套 `/api/v1` |
| IM即时通讯/聊天 | `乐天/V-IM` | 5.3K | JavaScript | Vue3 + Electron 桌面聊天；Mim 为浏览器端 + 多平台边缘部署 |
| WEB应用开发 | `芋道源码/ruoyi-vue-pro` | 111.9K | Java | 后台管理 + 商城 + IM 全家桶；Mim 以「模块商城 + 付费回调」为核心差异化 |
| WEB应用开发 | `若依/RuoYi-Vue` | 43.3K | JavaScript | 经典前后端分离权限系统；Mim 额外覆盖 AI 漫剧与多平台发布链路 |
| 后台管理框架 | `若依/RuoYi` | 49K | Java | 轻量权限框架；Mim 的 `/admin` 只做商城/订单运营视图 |
| AI-人工智能 | `dromara/EasyAi` | 9.5K | Java | 算法框架；Mim 是 AI 能力的应用层编排（生成包 + 依赖链计费） |
| AI-人工智能 | `ageerle/ruoyi-ai` | 5.2K | Java | 企业级 AI 应用框架；Mim 把 AI 能力做成可售模块 |
| 多媒体 | `夏楚/ZLMediaKit` | 4.1K | C++ | 流媒体协议栈；Mim 只做成片导出与转码降级 |

## 4. 仓库侧落点与限制（如实记录）

| 落点 | 当前做法 | 状态 |
|---|---|---|
| Gitee 仓库「介绍」 | 写入主题词：`Mim — 跨平台商业级项目（IM 即时通讯 / AI 漫剧 / 模块商城 / 多端 Web）· GitHub 镜像` | 本轮设置 |
| Gitee 仓库「主页」 | 指向生产入口 `https://mim.mixm.top` | 本轮设置（原为空） |
| Gitee 仓库「语言」 | `TypeScript`（仓库主语言） | 本轮设置（原为空） |
| README「项目主题」段 | 见 [README.md](../README.md) 顶部同名段落，含五个分类链接 | 本轮新增 |
| 仓库开源许可证 | 新增 [LICENSE](../LICENSE)（MIT，`Copyright (c) 2026 Mim project contributors`），README 同步「许可证」段；Gitee 仓库页据 `LICENSE` 自动识别协议 | 2026-11-12 新增（原为空） |
| 本文档 | 分类映射与对标表的唯一事实源 | 本轮新增 |
| **「主题 / 标签」字段** | Gitee 仓库设置页（`/<owner>/<repo>/settings` 基本信息）只有：仓库名称、路径、介绍、主页、语言、默认分支、是否开源；`GET /api/v5/repos/{owner}/{repo}` 返回体也没有 `topics` 字段（`project_labels` 恒为 `[]`，且无公开写接口） | **不可自助设置**，主题只能通过上表其它落点表达 |
| 期望被 Explore 收录 | Explore 分类为平台策展，本轮未发现自助提交入口 | 不承诺收录；以主题词与分类对齐为主 |

## 5. 取证方式

- 分类与标杆数据：2026-11-12 用真实浏览器打开 `https://gitee.com/explore/<slug>`，逐页读取表格行（项目路径 / star / 语言 / 子分类）。
- 抓取过程中 Explore 触发过一次百度滑块验证，由用户手动放行后继续（未绕过、未伪造）。
- 仓库字段核对：`GET https://gitee.com/api/v5/repos/mallwm_admin/mim` 返回字段清单，用于确认无 `topics`。

## 6. 后续动作（谁来做、条件是什么）

1. 若 Gitee 后续开放主题字段或 Explore 自助提交，把 §2 的五个分类原样填进去，本文件同轮更新。
2. 新增业务模块时，先回到 Explore 找对应真实分类，再更新 §2 与 README 主题段（不允许自造分类名）。
3. 仓库「语言」若被平台按文件占比自动改判（当前仓库 `.ts/.tsx` 占比最高），以平台显示为准并在本文件记录变更时间。
