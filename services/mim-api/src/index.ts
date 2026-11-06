/** 服务入口：本地 SQLite + 本地开发 JWT 密钥 + HTTP 监听 + 编排 worker */

import { createApp } from './app.js'; // 引入应用装配工厂，注入依赖后得到 Express 实例
import { DATA_DIR, DB_PATH, PORT, loadJwtSecret } from './config.js'; // 引入数据目录、数据库路径、监听端口与 JWT 密钥加载器
import { createDatabase } from './db.js'; // 引入数据库初始化（建表 + 种子数据）
import { createStorage } from './storage.js'; // 引入存储驱动工厂（本地目录或对象存储）
import { createOrchestrator } from './orchestrator.js'; // 引入 AI 编排器，负责后台任务的领取与执行

const db = createDatabase(DB_PATH); // 按配置路径打开持久化 SQLite，启动即完成建表与种子写入
const jwtSecret = loadJwtSecret(); // 加载签名密钥；缺失时由 config 层决定回退开发密钥或直接报错
const storage = createStorage({ env: process.env, jwtSecret, fallbackDir: DATA_DIR }); // 依据环境变量选择存储驱动，未配置远端时落本地数据目录
const orchestrator = createOrchestrator({ db, storage, env: process.env }); // 装配 AI 编排器，复用同一数据库与存储实例以共享连接
const app = createApp({ db, jwtSecret, env: process.env, storage, orchestrator }); // 组装 Express 应用，依赖显式注入便于测试替换

app.listen(PORT, () => { // 监听端口；回调在端口就绪后执行一次
  console.log(`mim-api listening on http://127.0.0.1:${PORT}`); // 打印监听地址，便于本地确认服务已起
  console.log(`database: ${DB_PATH}`); // 打印实际数据库位置，避免误连内存库或旧文件
  console.log(`storage: driver=${storage.driver} configured=${storage.configured}`); // 打印存储驱动及是否已配置远端凭证，便于排查上传失败
  console.log(`ai provider: ${orchestrator.provider} configured=${orchestrator.configured}`); // 打印 AI 供应商及是否可用，便于排查任务降级

  if ((process.env.MIM_AI_WORKER ?? '1') === '0') { // 显式设置 MIM_AI_WORKER=0 时关闭后台 worker（如多副本部署只让一个实例消费）
    console.log('ai worker: disabled (MIM_AI_WORKER=0)'); // 明确告知 worker 已按配置关闭
  } else { // 默认开启，保证单机部署下排队任务能被自动消费
    orchestrator.start(); // 启动轮询循环，开始处理排队中的 AI 任务
    console.log('ai worker: started'); // 告知 worker 已启动，便于日志核对
  } // worker 开关分支结束
}); // listen 回调结束
