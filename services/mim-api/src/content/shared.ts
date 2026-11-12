/**
 * 内容运营共享工具：分页上限解析、环境变量整型读取、有效期判定与访客指纹。
 * 本包只做公告 / 更新日志 / 推广计划的展示与统计，不触碰资金结算与 referral 体系。
 */

import type { Request } from 'express'; // 仅类型引用，编译期擦除
import { sha256 } from '../auth.js'; // 通用 SHA-256 摘要，访客指纹与 IP 哈希复用同一实现
import type { ApiDeps } from '../types.js'; // 依赖容器类型

/** 解析公开列表的 limit 查询参数：夹在 [1, max] 之间，非法值回落 fallback。 */
export function parseLimit(raw: unknown, fallback: number, max: number): number {
  const parsed = Number.parseInt(String(raw ?? ''), 10); // 空串 / 非数字均得 NaN
  if (!Number.isFinite(parsed)) return fallback; // 非法输入回落默认值
  return Math.min(Math.max(parsed, 1), max); // 下限 1、上限 max，避免超大列表拖慢查询
}

/** 读取整型环境变量；缺失 / 非法 / 负数时回落兜底值。 */
export function envInt(env: Record<string, string | undefined>, key: string, fallback: number): number {
  const raw = env[key]?.trim(); // 去首尾空白，容忍配置里的空格
  if (!raw) return fallback; // 未配置回落
  const parsed = Number.parseInt(raw, 10); // 十进制解析
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback; // 负数与 NaN 均回落
}

/**
 * 有效期判定：starts_at 为空表示立即生效，ends_at 为空表示长期有效；
 * 区间为左闭右开 [starts_at, ends_at)，与社区 / 推广既有口径一致。
 */
export function isWithinWindow(startsAt: string | null | undefined, endsAt: string | null | undefined, now: string): boolean {
  if (startsAt && startsAt > now) return false; // 尚未到生效起始
  if (endsAt && endsAt <= now) return false; // 已过截止时间（开区间）
  return true; // 窗口内或无边界
}

/**
 * 访客指纹：登录用户取用户 ID（稳定身份）；匿名访客取 IP + UA 加盐哈希，
 * 不落明文 IP，与 growth.ts 的 IP 哈希口径一致。频控与点击去重都基于该指纹。
 */
export function visitorHash(req: Request, deps: ApiDeps): string {
  if (req.user?.id) return `u:${req.user.id}`; // 登录用户直接用主键，跨设备可识别
  const forwarded = req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? req.ip ?? ''; // 取首跳 IP
  const ua = req.header('user-agent') ?? ''; // 浏览器 / 客户端标识，辅助区分设备
  const salt = deps.env.MIM_IP_HASH_SALT ?? deps.jwtSecret; // 盐缺省回落 JWT 密钥，避免裸哈希被彩虹表反推
  return `v:${sha256(`${salt}:${forwarded}:${ua}`)}`; // 前缀区分用户 / 访客两类指纹
}
