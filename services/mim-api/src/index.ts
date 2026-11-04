/** 服务入口：本地 SQLite + 本地开发 JWT 密钥 + HTTP 监听 */

import { createApp } from './app.js';
import { DB_PATH, PORT, loadJwtSecret } from './config.js';
import { createDatabase } from './db.js';

const db = createDatabase(DB_PATH);
const app = createApp({ db, jwtSecret: loadJwtSecret(), env: process.env });

app.listen(PORT, () => {
  console.log(`mim-api listening on http://127.0.0.1:${PORT}`);
  console.log(`database: ${DB_PATH}`);
});
