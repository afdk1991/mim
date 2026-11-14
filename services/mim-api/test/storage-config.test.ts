/**
 * 契约测试：存储驱动的配置严格性（私有桶基线）
 *
 * 目的：把「缺值即报错、绝不静默降级为本地磁盘 / 公有读」这条约束固化成测试，
 * 防止后续有人把 createStorage 的硬失败改回「凭证不全就回落 local」。
 */

import { describe, expect, it } from 'vitest'; // 只用到 describe / it / expect，无外部副作用
import { tmpdir } from 'node:os'; // 系统临时目录，作为本地驱动的兜底根目录
import { join } from 'node:path'; // 路径拼接
import { createStorage } from '../src/storage.js'; // 被测工厂

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 本地驱动的 HMAC 密钥（与 JWT 共用来源）
const FALLBACK_DIR = join(tmpdir(), 'mim-storage-config-test'); // 本地落盘兜底目录，用例内不会真的写文件

/** 统一构造入参，避免每个用例重复写三行 */
function build(env: Record<string, string | undefined>) { // 入参即环境变量表
  return createStorage({ env, jwtSecret: JWT_SECRET, fallbackDir: FALLBACK_DIR }); // 走生产同款装配路径
} // build 结束

/** 取出 AppError 的错误码，非 AppError 直接让用例失败 */
function codeOf(fn: () => unknown): string { // 捕获同步抛出的错误并返回 code
  try { // 期望进入异常分支
    fn(); // 若未抛错，说明守卫失效
  } catch (err) { // 捕获工厂抛出的 AppError
    return (err as { code?: string }).code ?? ''; // 无 code 时返回空串，断言会失败并暴露原因
  } // catch 结束
  return ''; // 未抛错也返回空串，交由断言判定为失败
} // codeOf 结束

describe('createStorage 配置严格性', () => {
  it('驱动与凭证全空时走本地磁盘（本地开发默认路径）', () => {
    const storage = build({}); // 完全空环境
    expect(storage.driver).toBe('local'); // 空配置是唯一允许回流本地的情形
    expect(storage.configured).toBe(true); // 本地磁盘始终可用
  });

  it('显式 s3 但四项缺任意一项即抛 STORAGE_CONFIG_INVALID', () => {
    const code = codeOf(() => build({ MIM_STORAGE_DRIVER: 's3', MIM_STORAGE_S3_BUCKET: 'mim-private' })); // 只给桶名
    expect(code).toBe('STORAGE_CONFIG_INVALID'); // 缺区域与两把密钥必须硬失败
  });

  it('驱动留空但只填了一项 S3 变量同样硬失败（配置到一半）', () => {
    const code = codeOf(() => build({ MIM_STORAGE_S3_REGION: 'ap-beijing' })); // 未声明驱动，却填了区域
    expect(code).toBe('STORAGE_CONFIG_INVALID'); // 不允许把这当成「未启用 S3」悄悄回落本地
  });

  it('驱动名拼错即硬失败，不被当作未指定驱动', () => {
    const code = codeOf(() => build({ MIM_STORAGE_DRIVER: 's3c' })); // 常见笔误
    expect(code).toBe('STORAGE_CONFIG_INVALID'); // 必须报错而不是回落本地
  });

  it('显式 local 时无视 S3 变量，仍走本地磁盘', () => {
    const storage = build({
      MIM_STORAGE_DRIVER: 'local', // 显式声明本地，意图明确
      MIM_STORAGE_S3_BUCKET: 'leftover', // 残留变量不应改变驱动
    }); // build 结束
    expect(storage.driver).toBe('local'); // 显式 local 优先
  });

  it('四项齐全时启用 s3 驱动', () => {
    const storage = build({
      MIM_STORAGE_DRIVER: 's3', // 显式云端驱动
      MIM_STORAGE_S3_ENDPOINT: 'https://cos.ap-beijing.myqcloud.com', // 自定义端点
      MIM_STORAGE_S3_REGION: 'ap-beijing', // 区域
      MIM_STORAGE_S3_BUCKET: 'mim-private', // 私有桶
      MIM_STORAGE_S3_ACCESS_KEY_ID: 'ak', // 密钥 ID
      MIM_STORAGE_S3_SECRET_ACCESS_KEY: 'sk', // 密钥
    }); // build 结束
    expect(storage.driver).toBe('s3'); // 配置齐全才启用云驱动
    expect(storage.configured).toBe(true); // 客户端已实例化
  });
});
