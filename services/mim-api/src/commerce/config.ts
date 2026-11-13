/**
 * 商业化三期 · 运行配置
 *
 * 全部走 MIM_ 前缀环境变量，缺省值保证「不配置也能跑」且与现网行为兼容：
 *   - 积分抵扣默认开启；100 积分 = 1 元；单笔最多抵扣应付金额的 30%。
 * 配置只做读取与归一化，不写 .env.example；清单随交付文档回传。
 */

/** 积分抵扣相关配置（金额单位：分；积分单位：整数） */
export interface PointsConfig {
  enabled: boolean; // 积分抵扣总开关
  pointsPerYuan: number; // 多少积分折抵 1 元（1 元 = 100 分）；默认 100
  maxRatioPercent: number; // 单笔抵扣上限占应付金额的百分比（0–100）；默认 30
} // 代码块结束

/** 读取整数环境变量：非法 / 越界回落默认值，避免脏环境把配置搞成 NaN */
function readInt(env: Record<string, string | undefined>, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key]?.trim(); // 去空白，容忍复制粘贴带入的空格
  if (!raw) return fallback; // 未配置回落默认
  const parsed = Number.parseInt(raw, 10); // 十进制整数解析
  if (Number.isNaN(parsed)) return fallback; // 非法形态回落默认，不抛错阻断启动
  return Math.min(max, Math.max(min, parsed)); // 夹到合法区间
} // 代码块结束

/** 读取积分抵扣配置；env 缺省取 process.env，测试可注入替身环境 */
export function readPointsConfig(env: Record<string, string | undefined> = process.env): PointsConfig {
  const enabled = (env.MIM_POINTS_DEDUCTION_ENABLED ?? '1').trim() !== '0'; // 显式 0 才关闭，其余取值视为开启
  const pointsPerYuan = readInt(env, 'MIM_POINTS_PER_YUAN', 100, 1, 1_000_000); // 兑换比例必须为正整数
  const maxRatioPercent = readInt(env, 'MIM_POINTS_MAX_RATIO_PERCENT', 30, 0, 100); // 抵扣比例 0–100，0 表示不可用积分
  return { enabled, pointsPerYuan, maxRatioPercent }; // 返回当前函数的处理结果
} // 代码块结束
