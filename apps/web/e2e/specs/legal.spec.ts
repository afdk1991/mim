// 合规静态页 / 端到端：四条链路各有 h1、正文 > 200 字，地址栏子路径段保留不折叠成 /legal。
import { expect, test } from '@playwright/test';
import { assertCleanConsole, watchPageErrors } from '../helpers/console-errors';

/** 四篇合规文档：子段 → 主标题（与 Legal.tsx 的 DOCS 一一对应） */
const LEGAL_CASES = [
  { kind: 'privacy', title: '隐私政策' },
  { kind: 'terms', title: '用户协议' },
  { kind: 'refund', title: '退款与售后说明' },
  { kind: 'help', title: '帮助中心' },
] as const;

test.describe('合规静态页', () => {
  for (const item of LEGAL_CASES) {
    test(`/legal/${item.kind} 渲染主标题、正文超 200 字且子段保留`, async ({ page }) => {
      const errs = watchPageErrors(page); // 先挂监听再访问
      await page.goto(`/legal/${item.kind}`);

      // 子段必须保留：地址栏仍是 /legal/<kind>，不能被规整折叠成 /legal
      await expect(page).toHaveURL(new RegExp(`/legal/${item.kind}(\\?|$)`));
      // 主标题 h1 与文档登记一致
      await expect(page.locator('.legal-page h1')).toHaveText(item.title);
      // 正文长度判白屏：分节标题 + 段落合计 > 200 字
      const body = (await page.locator('.legal-page').innerText()).trim();
      expect(body.length).toBeGreaterThan(200);

      assertCleanConsole(errs); // 未登记的 console.error / pageerror 必须为 0
    });
  }
});
