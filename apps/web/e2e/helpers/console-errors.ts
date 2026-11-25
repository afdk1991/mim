// 端到端错误采集与断言：每页结束必须 console.error 0、pageerror 0。
// 白名单为显式登记制：只有带正则与理由的条目才允许被忽略；默认空名单即零容忍。
import { expect, type Page } from '@playwright/test';

/** 单条运行期错误记录：来源区分控制台错误与未捕获异常 */
export interface PageErrorRecord {
  kind: 'console-error' | 'pageerror'; // 错误来源：前端主动打印 / 未捕获 JS 异常
  text: string; // 错误文本（控制台文案或异常消息）
}

/** 白名单条目：正则匹配错误文本 + 必须写明的忽略理由 */
export interface ErrorWhitelistEntry {
  match: RegExp; // 命中正则：对错误文本做匹配
  reason: string; // 忽略理由：为什么该报错属于预期噪音
}

/**
 * 挂载错误监听并返回收集句柄。
 * 必须在 page.goto 之前调用，否则首屏同步抛出的错误会漏掉。
 */
export function watchPageErrors(page: Page): PageErrorRecord[] {
  const records: PageErrorRecord[] = []; // 收集句柄：用例结束后统一过滤断言
  page.on('console', (msg) => {
    if (msg.type() === 'error') records.push({ kind: 'console-error', text: msg.text() }); // 只收 error 级别
  });
  page.on('pageerror', (err) => records.push({ kind: 'pageerror', text: String(err) })); // 未捕获异常直接记消息
  return records;
}

/**
 * 断言未登记的错误为 0。
 * 白名单默认空：任何 console.error / pageerror 都会让用例失败；
 * 如确有不可控的预期噪音，先在此登记正则与理由，再放行，不许静默忽略。
 */
export function assertCleanConsole(records: PageErrorRecord[], whitelist: ErrorWhitelistEntry[] = []): void {
  const unexpected = records.filter((record) => !whitelist.some((entry) => entry.match.test(record.text)));
  const detail = unexpected.map((r) => `[${r.kind}] ${r.text}`).join(' | '); // 失败信息：逐条列出来源与文本
  expect(unexpected, `存在未登记的 console.error / pageerror：${detail}`).toEqual([]);
}
