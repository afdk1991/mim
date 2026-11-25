// 404 / 端到端：未知路径展示「页面不存在」文案与回首页 / 去社区两个出口，无运行期错误。
import { expect, test } from '@playwright/test';
import { assertCleanConsole, watchPageErrors } from '../helpers/console-errors';

test.describe('独立 404', () => {
  test('未知路径展示未找到文案与两个返回出口', async ({ page }) => {
    const errs = watchPageErrors(page); // 先挂监听再访问
    await page.goto('/definitely-not-a-page');

    // 未找到主标题可见
    await expect(page.getByText('页面不存在')).toBeVisible();
    // 两个出口按钮：回首页 / 去社区
    await expect(page.getByRole('button', { name: '返回首页' })).toBeVisible();
    await expect(page.getByRole('button', { name: '去社区' })).toBeVisible();

    assertCleanConsole(errs); // 未登记的 console.error / pageerror 必须为 0
  });
});
