/**
 * 申诉通道 + 关注板块 + 成长规则客户端（2026-11-25 申诉与成长公开批次）。
 *
 * 端点口径与后端 routes/appeals.ts、routes/growth.ts 一一对应：
 *   POST   /community/appeals            本人提交申诉（登录）
 *   GET    /community/appeals/mine       本人申诉列表（私密读）
 *   GET    /admin/appeals                 后台待处理队列（content:write）
 *   PUT    /admin/appeals/:id             受理 / 驳回（content:write）
 *   GET    /community/follows/boards      本人关注板块清单（私密读）
 *   GET    /growth/rules                  成长与积分规则（匿名公开）
 */

import { request } from './request.js'; // 统一请求出口：鉴权 / 幂等 / 错误信封

/** 申诉对象类型：帖子 / 回复（与后端 target_type 枚举一致） */
export type AppealTargetType = 'thread' | 'reply';

/** 申诉状态：待处理 / 受理成立 / 驳回 */
export type AppealStatus = 'pending' | 'accepted' | 'rejected';

/** 本人申诉列表条目：含归属帖子标题，便于在列表里定位原内容 */
export interface AppealItem { // 接口声明：约束我的申诉视图结构
  id: string; // 申诉主键
  target_type: AppealTargetType; // 对象类型：帖子 / 回复
  target_id: string; // 对象主键
  thread_id: string | null; // 归属帖子：回复申诉时回填所属帖
  thread_title: string | null; // 归属帖子标题
  reason: string; // 申诉理由
  status: AppealStatus; // 受理状态
  handled_note: string; // 处理说明（未处理为空串）
  created_at: string; // 提交时间（ISO-8601）
  handled_at: string | null; // 处理时间；未处理为 null
} // AppealItem 结束

/** 后台申诉队列条目：在本人视图基础上补申诉人昵称与回复摘要 */
export interface AdminAppealItem extends AppealItem { // 继承本人条目字段
  user_id: string; // 申诉人主键
  user_name: string | null; // 申诉人展示名
  post_excerpt: string | null; // 回复申诉时的原回复摘要
} // AdminAppealItem 结束

/** 关注板块清单条目：名称 / slug / 成员数等元信息，关注关系本身不公开 */
export interface FollowedBoard { // 接口声明：约束关注板块视图结构
  slug: string; // 板块标识：跳转与选中过滤用
  name: string; // 板块展示名
  icon: string; // 板块图标 emoji
  visibility: 'public' | 'followers' | string; // 可见性：公开 / 关注可见
  member_count: number; // 成员数（成员会籍计数）
  thread_count: number; // 帖子数（已发布计数）
} // FollowedBoard 结束

/** 等级条目：名称 / 门槛 / 权益摘要，直接读后端成长等级配置 */
export interface GrowthLevel { // 接口声明：约束等级表行结构
  level: number; // 等级序号：从 1 起
  name: string; // 等级名称：配置展示名
  min_points: number; // 升级门槛：累计积分下限
  perks: string; // 权益摘要
} // GrowthLevel 结束

/** 积分来源条目：分值取既有配置，前端不新造数值 */
export interface GrowthRuleSource { // 接口声明：约束积分来源表行结构
  key: string; // 来源键：文案 / 图标映射用
  label: string; // 来源中文名
  points: number; // 该渠道基础分值
  description: string; // 规则说明：连续加成等口径
} // GrowthRuleSource 结束

/** 成长规则公开视图：等级表 + 签到规则 + 积分来源，不含任何个人数据 */
export interface GrowthRules { // 接口声明：约束 /growth/rules 响应结构
  levels: GrowthLevel[]; // 等级列表（升序由后端配置保证）
  rules: { // 签到原始配置：供前端展开说明
    timezone: string; // 换天判定时区
    checkin: { // 签到规则块
      base_points: number; // 基础签到分
      streak_bonus_per_day: number; // 连续签到每日加成
      streak_bonus_cap: number; // 连续加成封顶天数
    };
  };
  sources: GrowthRuleSource[]; // 已配置发分来源
  note: string; // 未开放来源的统一说明
} // GrowthRules 结束

/** 申诉受理窗口：被处置后 7 天内可申诉（毫秒），与后端 APPEAL_WINDOW_MS 同口径 */
export const APPEAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 个自然日

/**
 * 纯函数：判断处置时间是否仍在 7 天申诉窗口内。
 * 输入 ISO-8601 时间串；无法解析的时间按「不在窗口内」处理，避免脏数据被放行申诉。
 */
export function appealWindowOpen(disposedAt: string, nowIso: string = new Date().toISOString()): boolean { // 可注入当前时间，便于纯函数测试冻结时钟
  const disposedMs = Date.parse(disposedAt); // 处置时间转毫秒时间戳
  const nowMs = Date.parse(nowIso); // 当前时间转毫秒时间戳
  if (!Number.isFinite(disposedMs) || !Number.isFinite(nowMs)) return false; // 时间解析失败兜底为不可申诉
  return nowMs - disposedMs <= APPEAL_WINDOW_MS; // 差值不超过 7 天即窗口内
} // appealWindowOpen 结束

/** 提交申诉请求体：对象类型 + 对象主键 + 理由 */
interface AppealCreateBody { // 接口声明：约束创建申诉入参
  target_type: AppealTargetType; // 对象类型
  target_id: string; // 对象主键
  reason: string; // 申诉理由
} // AppealCreateBody 结束

/** 读取本人申诉列表（私密读：匿名 401，由后端门禁拦截） */
export function listMyAppeals(): Promise<{ items: AppealItem[]; total: number }> { // 列表 + 总数，与收藏 / 举报我的列表同形态
  return request<{ items: AppealItem[]; total: number }>('/community/appeals/mine'); // GET 只读，天然幂等
} // listMyAppeals 结束

/** 提交申诉：登录用户对自己被处置的帖子 / 回复发起一次申诉 */
export function createAppeal(body: AppealCreateBody): Promise<{ id: string; status: AppealStatus }> { // 回申诉 id 与初始状态
  return request<{ id: string; status: AppealStatus }>('/community/appeals', { method: 'POST', body }); // 写操作由 request 自动带幂等键
} // createAppeal 结束

/** 读取后台待处理申诉队列（content:write；无权限由后端 401/403 拦截） */
export function listAdminAppeals(): Promise<{ items: AdminAppealItem[]; total: number }> { // 队列条目 + 总数
  return request<{ items: AdminAppealItem[]; total: number }>('/admin/appeals'); // GET 只读
} // listAdminAppeals 结束

/** 受理 / 驳回申诉：decision=accept 成立，reject 驳回；note 为随回执的处理说明 */
export function reviewAppeal(id: string, decision: 'accept' | 'reject', note: string): Promise<{ ok: boolean; id: string; status: AppealStatus }> { // 回处理结果状态
  return request<{ ok: boolean; id: string; status: AppealStatus }>(`/admin/appeals/${encodeURIComponent(id)}`, { // 路径参数编码防注入
    method: 'PUT', // 写操作
    body: { decision, note }, // 决策 + 处理说明
  }); // 请求结束
} // reviewAppeal 结束

/** 读取本人关注的板块清单（私密读：关注关系不公开，只有本人可见） */
export function myFollowedBoards(): Promise<{ boards: FollowedBoard[]; total: number }> { // 清单 + 总数
  return request<{ boards: FollowedBoard[]; total: number }>('/community/follows/boards'); // GET 只读
} // myFollowedBoards 结束

/** 读取成长与积分规则（匿名公开：等级 / 门槛 / 权益 + 积分来源，不含个人数据） */
export function growthRules(): Promise<GrowthRules> { // 规则视图
  return request<GrowthRules>('/growth/rules', { auth: false }); // 公开读：不显式带鉴权头，匿名也可访问
} // growthRules 结束
