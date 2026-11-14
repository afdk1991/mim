/** 服务入口：本地 SQLite + 本地开发 JWT 密钥 + HTTP 监听 + 编排 worker + 定时任务 */

import { createApp } from './app.js'; // 引入应用装配工厂，注入依赖后得到 Express 实例
import { createServer } from 'node:http'; // 原生 HTTP server，用于把 Express 应用升级为支持 WebSocket
import { DATA_DIR, DB_PATH, JOBS_ENABLED, PORT, loadJwtSecret } from './config.js'; // 引入数据目录、数据库路径、任务开关、监听端口与 JWT 密钥加载器
import { createDatabase } from './db.js'; // 引入数据库初始化（建表 + 种子数据）
import { createJobs } from './jobs.js'; // 引入后台定时任务工厂（权益到期回收）
import { createStorage } from './storage.js'; // 引入存储驱动工厂（本地目录或对象存储）
import { attachImWebSocket } from './im/ws.js'; // 引入 IM WebSocket 接入层，负责实时消息与视频信令
import { ImHub } from './im/hub.js'; // 引入连接中心：需在 createApp 之前注入，HTTP 路由才能复用同一实例广播
import { reconcileRecommendScores } from './community/recommend.js'; // 推荐指数全量对账：纠正存量「0 浏览却有预置分数」的假数
import type { ApiDeps } from './types.js'; // 依赖容器类型：显式标注后才能回填 imHub 字段

const db = createDatabase(DB_PATH); // 按配置路径打开持久化 SQLite，启动即完成建表与种子写入
const reconciledScores = reconcileRecommendScores(process.env, db); // 每次启动按公式重算一次：幂等，只写回与真实互动不一致的行
if (reconciledScores > 0) console.log(`[community] recommend_score reconciled: ${reconciledScores} rows`); // 有修正才留痕，便于核对存量假分已清零
const jwtSecret = loadJwtSecret(); // 加载签名密钥；缺失时由 config 层决定回退开发密钥或直接报错
const storage = createStorage({ env: process.env, jwtSecret, fallbackDir: DATA_DIR }); // 依据环境变量选择存储驱动，未配置远端时落本地数据目录
const jobs = createJobs({ db, env: process.env }); // 装配后台定时任务，复用同一数据库实例
const deps: ApiDeps = { db, jwtSecret, env: process.env, storage }; // 统一依赖容器，供 app 与 WS 层共享
deps.imHub = new ImHub(); // 必须先建 hub：createApp 会浅拷贝依赖快照，晚于此步挂载会让 HTTP 路由永远读不到 hub
const app = createApp(deps); // 组装 Express 应用，依赖显式注入便于测试替换
const server = createServer(app); // 用原生 HTTP server 包裹 Express，以便同一端口承载 WebSocket 升级
attachImWebSocket(server, deps, deps.imHub); // 复用同一 hub 挂载 IM WebSocket，保证 HTTP 侧广播可用

server.listen(PORT, () => { // 监听端口并保留 server 句柄，供优雅停机时关闭连接
  console.log(`mim-api listening on http://127.0.0.1:${PORT}`); // 打印监听地址，便于本地确认服务已起
  console.log(`database: ${DB_PATH}`); // 打印实际数据库位置，避免误连内存库或旧文件
  console.log(`storage: driver=${storage.driver} configured=${storage.configured}`); // 打印存储驱动及是否已配置远端凭证，便于排查上传失败

  if (JOBS_ENABLED) { // 默认开启定时任务，保证到期权益不会长期滞留
    jobs.start(); // 启动定时器，并在启动瞬间补跑一次（幂等键保证不重复生效）
    console.log('jobs: started (entitlement-expiry 24h)'); // 打印节拍，便于核对配置
  } else { // 多副本部署时只让一个实例跑任务
    console.log('jobs: disabled (MIM_JOBS=0)'); // 明确告知任务已关闭
  } // 任务开关分支结束
}); // listen 回调结束

/** 优雅停机：先停定时器，再关 HTTP 连接，最后关数据库，避免任务写到已关闭的连接 */
function shutdown(signal: string): void { // 统一处理 SIGTERM / SIGINT
  console.log(`shutting down (${signal})`); // 记录信号来源，便于排查是哪个编排动作触发的停机
  jobs.stop(); // 停止定时任务，防止停机过程中触发新的写事务
  server.close(() => { // 等待在途请求处理完成再关库
    db.close(); // 关闭 SQLite 连接，确保 WAL 正常落盘
    process.exit(0); // 正常退出
  }); // close 回调结束
} // shutdown 结束

process.once('SIGTERM', () => shutdown('SIGTERM')); // 容器/进程管理器停止信号
process.once('SIGINT', () => shutdown('SIGINT')); // 本地 Ctrl+C 中断信号
