/** 服务入口：本地 SQLite + 本地开发 JWT 密钥 + HTTP 监听 + 编排 worker */

import { createApp } from './app.js';
import { DATA_DIR, DB_PATH, PORT, loadJwtSecret } from './config.js';
import { createDatabase } from './db.js';
import { createStorage } from './storage.js';
import { createOrchestrator } from './orchestrator.js';

const db = createDatabase(DB_PATH);
const jwtSecret = loadJwtSecret();
const storage = createStorage({ env: process.env, jwtSecret, fallbackDir: DATA_DIR });
const orchestrator = createOrchestrator({ db, storage, env: process.env });
const app = createApp({ db, jwtSecret, env: process.env, storage, orchestrator });

app.listen(PORT, () => {
  console.log(`mim-api listening on http://127.0.0.1:${PORT}`);
  console.log(`database: ${DB_PATH}`);
  console.log(`storage: driver=${storage.driver} configured=${storage.configured}`);
  console.log(`ai provider: ${orchestrator.provider} configured=${orchestrator.configured}`);

  if ((process.env.MIM_AI_WORKER ?? '1') === '0') {
    console.log('ai worker: disabled (MIM_AI_WORKER=0)');
  } else {
    orchestrator.start();
    console.log('ai worker: started');
  }
});
