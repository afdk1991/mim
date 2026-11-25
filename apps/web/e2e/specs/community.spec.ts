// 社区列表 / 端到端：匿名可读，首屏列表项 > 0，正文渲染完整，无运行期错误。
import { expect, test } from '@playwright/test';
import { assertCleanConsole, watchPageErrors } from '../helpers/console-errors';

test.describe('社区列表', () => {
  test('首屏帖子列表项大于 0，主区正文不为占位骨架', async ({ page }) => {
    const errs = watchPageErrors(page); // 先挂监听再访问
    await page.goto('/community');

    // 等待骨架消失、真实帖子卡片落地（默认 forum 页签）
    const cards = page.locator('article.community-card');
    await expect(cards.first()).toBeVisible({ timeout: 15_000 });
    expect(await cards.count()).toBeGreaterThan(0); // 列表项 > 0

    const mainText = (await page.locator('main.main').innerText()).trim();
    expect(mainText.length).toBeGreaterThan(20); // 主区必须从占位变为真实内容

    assertCleanConsole(errs); // 未登记的 console.error / pageerror 必须为 0
  });
});
