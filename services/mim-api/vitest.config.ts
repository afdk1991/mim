import { defineConfig } from 'vitest/config'; // 引入 vitest 配置助手，提供类型提示与默认值合并

export default defineConfig({ // 导出 vitest 配置对象，vitest 启动时自动读取
  test: { // 测试运行参数集合
    environment: 'node', // 使用 Node 环境（无 DOM），API 单测不需要浏览器环境
    include: ['test/**/*.test.ts'], // 只收集 test 目录下的 .test.ts，避免把源码误当测试
    testTimeout: 20000, // 单测超时 20s，放宽以适应 SQLite 落盘与定时相关用例
    // 生产默认关闭注册；存量用例需要建号能力，测试进程统一显式开启，
    // 针对「关闭态」的用例在请求级 env 里显式传 MIM_REGISTRATION_ENABLED=0 覆盖。
    env: { MIM_REGISTRATION_ENABLED: '1' }, // 仅测试进程生效，不影响生产默认关闭
  }, // test 配置结束
}); // defineConfig 结束
