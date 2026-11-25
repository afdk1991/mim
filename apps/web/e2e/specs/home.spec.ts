// 首页 / 端到端：首屏关键标题与入口卡存在，console.error 与 pageerror 为 0。
import { expect, test } from '@playwright/test';
import { assertCleanConsole, watchPageErrors } from '../helpers/console-errors';

test.describe('门户首页', () => {
  test('首屏主标题与三张入口卡存在，且无运行期错误', async ({ page }) => {
    const errs = watchPageErrors(page); // 先挂监听再访问，避免漏掉首屏错误
    await page.goto('/');

    // 主标题：门户 hero 文案（中文口径）
    await expect(page.locator('h1', { hasText: '内容、社区与交易' })).toBeVisible();
    // 三张入口卡：社区 / 聊天 / 个人中心
    const entries = page.locator('.home-entry');
    await expect(entries).toHaveCount(3);
    // hero 两个行动按钮可见可点
    await expect(page.getByRole('button', { name: '进入社区' })).toBeVisible();
    await expect(page.getByRole('button', { name: '浏览圈子' })).toBeVisible();

    assertCleanConsole(errs); // 未登记的 console.error / pageerror 必须为 0
  });
});
