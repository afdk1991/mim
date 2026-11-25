// 圈子筛选 / 端到端：关键词命中收窄列表、无结果关键词展示空态、点重置恢复全量。
// 本地由 helper 建一个确定性公开圈子作为筛选对象；外部只读环境不注册 / 造数据，只跑匿名可读部分。
import { expect, test, type Locator } from '@playwright/test';
import { assertCleanConsole, watchPageErrors } from '../helpers/console-errors';
import {
  E2E_CIRCLE_NAME,
  E2E_CIRCLE_SLUG,
  ensureE2eCircle,
  ensureE2eSession,
  isExternalTarget,
} from '../helpers/auth';

/** 必然无结果的关键词：随机串，不命中任何种子 / e2e 圈子 */
const NO_RESULT_KEYWORD = 'zzz-no-such-circle-9999';

/** 轮询等待至少一张卡片落地，抵消移动端异步渲染 / 防抖请求滞后 */
async function waitAtLeastOne(cards: Locator): Promise<void> {
  await expect.poll(async () => await cards.count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
}

/** 轮询等待卡片清空，避免读到切换前的残留列表 */
async function waitEmpty(cards: Locator): Promise<void> {
  await expect.poll(async () => await cards.count(), { timeout: 15_000 }).toBe(0);
}

test.describe('圈子筛选', () => {
  test('关键词命中收窄列表，无结果关键词展示空态，重置恢复全量', async ({ page }, testInfo) => {
    const errs = watchPageErrors(page); // 先挂监听再访问
    const baseURL = String(testInfo.project.use.baseURL ?? 'http://localhost:5173');

    // 本地链路：注册 e2e 账号并确保专用公开圈子存在；外部只读环境跳过造数
    let seeded = false;
    if (!isExternalTarget()) {
      const session = await ensureE2eSession(baseURL);
      test.skip(!session, '本地 API 未开放注册且无既有 e2e 测试账号，登录态造圈步骤跳过');
      const slug = await ensureE2eCircle(baseURL, session.access_token);
      seeded = slug === E2E_CIRCLE_SLUG;
    }

    await page.goto('/circles');
    const search = page.locator('input[type="search"]'); // 关键词搜索框
    await expect(search).toBeVisible();
    const cards = page.locator('article.tool-card'); // 圈子卡片

    // 等待首屏骨架结束（卡片或空态二选一落地）
    await expect.poll(async () => (await page.locator('.list-skeleton').count()) === 0, { timeout: 15_000 }).toBe(true);
    if (seeded) await waitAtLeastOne(cards); // 全量清单含 e2e 圈子

    // 命中关键词：列表收窄到 e2e 圈子，卡片标题可见
    if (seeded) {
      await search.fill(E2E_CIRCLE_NAME);
      await expect(cards.first()).toBeVisible();
      await waitAtLeastOne(cards);
      await expect(cards.first()).toContainText(E2E_CIRCLE_NAME);
    }

    // 无结果关键词：展示空态标题，且无卡片残留
    await search.fill(NO_RESULT_KEYWORD);
    await expect(page.getByText('没有匹配的圈子')).toBeVisible();
    await waitEmpty(cards);

    // 重置：关键词清空，恢复全量清单
    await page.getByRole('button', { name: '重置' }).click();
    await expect(search).toHaveValue('');
    if (seeded) {
      await expect(cards.first()).toBeVisible();
      await waitAtLeastOne(cards);
    }

    assertCleanConsole(errs); // 未登记的 console.error / pageerror 必须为 0
  });
});
