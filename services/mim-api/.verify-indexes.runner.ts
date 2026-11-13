
import { createDatabase } from './src/db.js';
import { inspectIndexes } from './src/security.js';

const db = createDatabase(':memory:'); // 空内存库：仅校验 schema 与索引覆盖，不写真实库
const audit = inspectIndexes(db);
console.log(JSON.stringify({
  missing: audit.missing,
  slowCandidates: audit.slowCandidates,
}));
