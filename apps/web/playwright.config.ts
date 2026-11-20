// Playwright 端到端配置：真实浏览器驱动前端 + 真实本地 API，覆盖「点击 → 地址变化 → 页面渲染」链路。
// 只在本机 / CI 运行时生效，不参与生产构建。
import { defineConfig, devices } from '@playwright/test';

// 前端端口：与 vite.config.ts 的 server.port 保持一致，避免代理与断言地址错位
const WEB_PORT = Number(process.env.MIM_E2E_WEB_PORT || 5173);
// 后端端口：vite 代理表里写死的 127.0.0.1:8787
const API_PORT = Number(process.env.MIM_E2E_API_PORT || 8787);
// 允许指向已部署环境（只读用例）；默认跑本地 dev 双服务
const BASE_URL = process.env.MIM_E2E_BASE_URL || `http://localhost:${WEB_PORT}`;
// 仓库根目录：webServer 的 command 需要在根目录执行 pnpm 过滤命令
const REPO_ROOT = '../..';

export default defineConfig({
  testDir: './e2e', // 用例目录：apps/web/e2e
  timeout: 45_000, // 单用例上限：包含首次加载与 API 冷启动
  expect: { timeout: 10_000 }, // 断言重试窗口：等待异步数据渲染
  fullyParallel: false, // 串行：共用同一套 dev 服务与 SQLite 库，避免并发写库
  workers: 1, // 单 worker，保证登录态 / 存储隔离可控
  forbidOnly: !!process.env.CI, // CI 上禁止 .only，避免漏跑用例
  retries: process.env.CI ? 1 : 0, // CI 允许一次重试，抵消网络抖动
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]], // 控制台 + HTML 报告
  use: {
    baseURL: BASE_URL, // 所有 page.goto 的相对地址基准
    trace: 'retain-on-failure', // 失败保留 trace，便于复盘点击链路
    screenshot: 'only-on-failure', // 失败截图
    video: 'off', // 关闭录屏：体积大且对本项目无增益
    locale: 'zh-CN', // 中文界面：与线上默认语言一致
    timezoneId: 'Asia/Shanghai', // 时区与生产一致
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }, // 桌面端点击链路
    { name: 'mobile', use: { ...devices['Pixel 7'] } }, // 移动端底部 Tab 链路
  ],
  webServer: process.env.MIM_E2E_BASE_URL
    ? undefined // 指向外部环境时不启动本地服务
    : [
        {
          command: `pnpm --filter @mim/api dev`, // 真实本地 API（SQLite WAL + 启动期迁移）
          url: `http://127.0.0.1:${API_PORT}/api/v1/healthz`, // 就绪判据：健康检查 200
          reuseExistingServer: !process.env.CI, // 本机复用已在跑的服务
          timeout: 150_000, // 冷启动 + 迁移上限
          cwd: REPO_ROOT,
        },
        {
          command: `pnpm exec vite --port ${WEB_PORT} --strictPort`, // 直接在 web 包内起 vite，避免把 --port 误传给 pnpm
          url: BASE_URL,
          reuseExistingServer: !process.env.CI,
          timeout: 150_000,
          cwd: '.',
        },
      ],
});
