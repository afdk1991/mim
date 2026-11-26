/** 小工具：原子写、读 JSON、人类可读字节数。 */
import fs from 'node:fs';

export function writeAtomic(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, typeof data === 'string' ? data : JSON.stringify(data));
  fs.renameSync(tmp, file);
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function humanBytes(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

/** 日志超过上限时轮转一份（sync.log → sync.log.1），避免长期占用磁盘。 */
export function rotateLog(file, maxBytes) {
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > maxBytes) fs.renameSync(file, `${file}.1`);
  } catch {
    /* 轮转失败不阻断采集 */
  }
}

export function newRunId() {
  return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

/** 同时写标准输出与「本次运行日志」，run.sh 另有一份 sync.log。 */
export function createLogger(reportDir, runId) {
  const file = `${reportDir}/${runId}.log`;
  let stream = null;
  try {
    stream = fs.createWriteStream(file, { flags: 'a' });
  } catch {
    /* 日志文件不可写时只打标准输出 */
  }
  return {
    file,
    log(msg) {
      const line = `${new Date().toISOString()} ${msg}`;
      console.log(line);
      if (stream) stream.write(`${line}\n`);
    },
    close() {
      if (stream) stream.end();
    },
  };
}

export function pruneRunLogs(reportDir, keep = 30) {
  try {
    const files = fs
      .readdirSync(reportDir)
      .filter((f) => f.endsWith('.log'))
      .map((f) => `${reportDir}/${f}`)
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    for (const f of files.slice(keep)) fs.unlinkSync(f);
  } catch {
    /* 清理失败忽略 */
  }
}

/**
 * 防重入：run.lock 记录 pid，进程已死则接管。
 * 每个站点用各自的 stateDir，锁互不影响。
 */
export function acquireLock(stateDir) {
  const lock = `${stateDir}/run.lock`;
  const payload = JSON.stringify({ pid: process.pid, at: new Date().toISOString() });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(lock, 'wx');
      fs.writeSync(fd, payload);
      fs.closeSync(fd);
      return () => {
        try {
          fs.unlinkSync(lock);
        } catch {
          /* 已被清理 */
        }
      };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const prev = readJson(lock, null);
      const pid = prev && Number(prev.pid);
      const alive = pid
        ? (() => {
            try {
              process.kill(pid, 0);
              return true;
            } catch {
              return false;
            }
          })()
        : false;
      if (alive) throw new Error(`已有采集任务在运行（pid=${pid}），本次退出`);
      fs.unlinkSync(lock);
    }
  }
  throw new Error('无法获取 run.lock');
}
