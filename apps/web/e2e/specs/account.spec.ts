// 个人中心聚合 / 端到端（登录态）：我的内容页签展示成长 / 收藏 / 圈子 / 举报四区块标题（允许空态）。
// 登录态来源：helper 经本地 API 注册确定性测试账号；拿不到登录态时 test.skip 写明原因，不假装验证。
import { expect, test } from '@playwright/test';
import { assertCleanConsole, watchPageErrors } from '../helpers/console-errors';
import { ensureE2eSession, isExternalTarget, seedSessionIntoLocalStorage } from '../helpers/auth';

test.describe('个人中心聚合（登录态）', () => {
  test('我的内容页签展示成长等级 / 我的收藏 / 我加入的圈子 / 我的举报四区块', async ({ page }, testInfo) => {
    const errs = watchPageErrors(page); // 先挂监听再访问
    const baseURL = String(testInfo.project.use.baseURL ?? 'http://localhost:5173');

    // 外部只读环境：不在该环境注册测试账号，登录态用例跳过
    if (isExternalTarget()) {
      test.skip(true, '指向外部只读环境，不在该环境注册测试账号；个人中心登录态用例跳过');
    }

    const session = await ensureE2eSession(baseURL);
    test.skip(!session, '注册总开关关闭且既有 e2e 账号口令不可用，拿不到登录态；个人中心聚合用例跳过');

    // 会话落盘后再直达页签：刷新式加载让前端从 localStorage 恢复登录态
    await seedSessionIntoLocalStorage(page, session);
    await page.goto('/account?tab=content');

    // 四个区块标题必须可见；列表内容允许空态，只断言标题存在
    await expect(page.getByRole('heading', { name: '成长等级', level: 2 })).toBeVisible();
    await expect(page.getByRole('heading', { name: '我的收藏', level: 2 })).toBeVisible();
    await expect(page.getByRole('heading', { name: '我加入的圈子', level: 2 })).toBeVisible();
    await expect(page.getByRole('heading', { name: '我的举报', level: 2 })).toBeVisible();

    assertCleanConsole(errs); // 未登记的 console.error / pageerror 必须为 0
  });
});
