// 浏览器级端到端用例：真实 Chromium 点击真实前端 + 真实本地 API，验证「点了有反应、地址有变化、页面有内容」。
// 断言只用稳定结构（外壳 / 导航 / 底部 Tab / 密码框 / URL），不绑定具体文案与数据，避免业务迭代后脆断。
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/** 收集运行期错误：pageerror 为真错误；console.error 先收集，交由用例按需断言 */
function watchErrors(page: Page): { pageErrors: string[]; consoleErrors: string[] } {
  const pageErrors: string[] = []; // 未捕获异常
  const consoleErrors: string[] = []; // 前端主动打印的错误
  page.on('pageerror', (err) => pageErrors.push(err.message)); // 未捕获异常直接记错误文本
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text()); // 只收 error 级别
  });
  return { pageErrors, consoleErrors };
} // watchErrors 结束

test.describe('桌面端点击链路', () => {
  test('首页渲染外壳，点击一级导航进入社区并改变地址', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', '桌面端用例不在移动端重复执行');
    const errs = watchErrors(page); // 先挂监听再访问，避免漏掉首屏错误
    await page.goto('/'); // 门户首页
    const header = page.locator('header.site-header'); // 外壳头部
    await expect(header).toBeVisible(); // 外壳必须渲染
    const navButtons = page.locator('.site-nav button.nav-item'); // 一级导航按钮
    await expect(navButtons.first()).toBeVisible(); // 至少有一个导航项
    expect(await navButtons.count()).toBeGreaterThanOrEqual(2); // 首页 + 社区起步
    await page.getByRole('button', { name: '社区', exact: true }).first().click(); // 点击「社区」
    await expect(page).toHaveURL(/\/community(\?|$)/); // 地址必须切到 /community
    // 社区首屏会先渲染「加载中…」占位，故用轮询等待真实数据落地，而不是立即读取文本
    await expect
      .poll(async () => (await page.locator('main.main').innerText()).trim().length, { timeout: 20_000 })
      .toBeGreaterThan(20); // 主区必须从占位变为真实内容
    expect(errs.pageErrors, `未捕获异常: ${errs.pageErrors.join(' | ')}`).toHaveLength(0); // 首屏点击链路不允许有 JS 崩溃
    if (errs.consoleErrors.length) console.warn('[e2e] console.error:', errs.consoleErrors.join(' | ')); // 打印但不阻断：后端 401 等属预期
  }); // 用例结束

  test('深链接直达与未知路径回落在同一套外壳内', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', '桌面端用例不在移动端重复执行');
    await page.goto('/circles'); // 圈子深链接
    await expect(page.locator('header.site-header')).toBeVisible(); // 外壳渲染
    const circlesText = await page.locator('main.main').innerText(); // 主区文本
    expect(circlesText.trim().length).toBeGreaterThan(10); // 深链接不能落到空白
    await page.goto('/this-path-should-not-exist'); // 未知路径
    await expect(page.locator('header.site-header')).toBeVisible(); // 未知路径仍要回到可用外壳，而不是白屏
    const fallbackText = await page.locator('main.main').innerText(); // 回落页文本
    expect(fallbackText.trim().length).toBeGreaterThan(10); // 回落页必须有内容
  }); // 用例结束

  test('未登录访问个人中心被守卫带到登录页，且登录表单可用', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', '桌面端用例不在移动端重复执行');
    await page.goto('/account'); // 需要身份的页面
    await expect(page).toHaveURL(/\/signin(\?|$)/); // 未登录必须落到 /signin
    await expect(page.locator('input[type="password"]').first()).toBeVisible(); // 登录表单含密码框
    const submit = page.locator('button[type="submit"], form button').first(); // 首个提交按钮
    await expect(submit).toBeVisible(); // 提交入口必须可见可点
  }); // 用例结束
}); // 桌面端结束

test.describe('移动端底部 Tab', () => {
  test('底部 Tab 可见，点击后切换到对应视图', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', '移动端用例只在移动端执行');
    await page.goto('/community'); // 社区首页
    const tabs = page.locator('nav.mobile-tabs button.mobile-tab'); // 底部 Tab 项
    await expect(tabs.first()).toBeVisible(); // 窄屏必须出现底部导航
    expect(await tabs.count()).toBeGreaterThanOrEqual(3); // 首页 / 社区 / 聊天 / 个人中心起步
    await page.locator('nav.mobile-tabs').getByRole('button', { name: '首页', exact: true }).click(); // 点击首页 Tab（匿名可读）
    await expect(page).toHaveURL(/(\/home|\/)$/); // 地址切到 /home（或根路径）
    await page.locator('nav.mobile-tabs').getByRole('button', { name: '聊天', exact: true }).click(); // 点击聊天 Tab
    await expect(page).toHaveURL(/\/signin(\?|$)/); // 聊天需要身份：未登录必须被守卫带到登录页，而不是静默无反应
  }); // 用例结束
}); // 移动端结束
