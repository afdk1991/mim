/** 成长私信 · 管理端端点（独立文件，不并入 admin.ts）。
 *
 *   POST /api/v1/admin/growth-dm/preview    — 按条件预览受众（人数 + 样本）
 *   POST /api/v1/admin/growth-dm/send       — 发送系统私信（dedupe_key 幂等）
 *   GET  /api/v1/admin/growth-dm/campaigns  — 最近批次台账
 *
 * 复用点：现有 RBAC（messaging:write）、现有 IM 会话/消息表、现有 WS 通道推送 message.new。
 */

import { Router } from 'express'; // 路由容器
import { z } from 'zod'; // 参数校验
import { parse } from '../validate.js'; // 统一校验包装
import { requirePermission } from '../middleware.js'; // RBAC 校验
import { audited, auditActor } from '../audit.js'; // 统一审计留痕：批量群发私信必须留痕
import type { ApiDeps } from '../types.js'; // 依赖容器
import {
  listGrowthDmCampaigns, // 批次列表
  resolveGrowthDmAudience, // 受众解析
  sendGrowthDm, // 幂等发送
} from '../im/growth-dm.js'; // 成长私信服务

/** 受众条件校验：与 GrowthDmAudience 字段一一对应 */
const audienceSchema = z.object({
  user_ids: z.array(z.string().min(1).max(64)).max(2000).optional(), // 显式名单
  region: z.enum(['cn', 'global']).optional(), // 注册地区
  created_after: z.string().min(10).max(40).optional(), // 注册时间下界
  created_before: z.string().min(10).max(40).optional(), // 注册时间上界
  query: z.string().max(64).optional(), // 昵称 / Mim ID 模糊匹配
  limit: z.number().int().min(1).max(2000).optional(), // 单批上限
});

/** 跳转地址白名单：站内相对路径或 https 外链，拒绝 javascript: 等危险协议 */
const linkUrlSchema = z
  .string()
  .max(500)
  .refine((v) => v.startsWith('/') || /^https:\/\//i.test(v), '跳转地址只允许站内路径或 https 链接');

/** 发送请求体 */
const sendSchema = z.object({
  dedupe_key: z.string().min(8).max(128).regex(/^[A-Za-z0-9:_-]+$/, '幂等键只允许字母、数字、冒号、下划线与连字符'), // 幂等键
  title: z.string().trim().min(1).max(60), // 批次标题（后台台账展示）
  body: z.string().trim().min(1).max(1000), // 私信正文
  link_url: linkUrlSchema.optional(), // 跳转地址
  link_label: z.string().trim().min(1).max(24).optional(), // 跳转按钮文案
  audience: audienceSchema, // 受众条件
});

/** 预览请求体 */
const previewSchema = z.object({ audience: audienceSchema });

export function createGrowthDmAdminRouter(deps: ApiDeps): Router {
  const router = Router(); // 独立路由实例
  const db = deps.db; // 数据库连接

  // 预览受众：只读，不写库
  router.post('/admin/growth-dm/preview', requirePermission('messaging:write'), (req, res) => {
    const { audience } = parse(previewSchema, req.body); // 校验请求
    const users = resolveGrowthDmAudience(db, audience); // 解析命中用户
    res.json({
      count: users.length, // 命中人数
      sample: users.slice(0, 20), // 前 20 个样本供运营核对
    });
  });

  // 发送系统私信：dedupe_key 相同视为同一请求，命中即回执既有批次
  router.post('/admin/growth-dm/send', requirePermission('messaging:write'), (req, res) => {
    const input = parse(sendSchema, req.body); // 校验请求
    if (!input.audience.user_ids?.length && !input.audience.region && !input.audience.created_after && !input.audience.created_before && !input.audience.query) {
      return res.status(400).json({ code: 'VALIDATION_FAILED', message: '至少提供一个受众条件，避免误发全量用户' }); // 全量群发需显式条件
    }
    const detail: Record<string, unknown> = {}; // 受众摘要 / 发送人数在业务跑完后回填，审计落库时序列化
    const result = audited(db, auditActor(req), { // 批量群发与审计同属一次敏感操作（批量发消息）
      action: 'growth_dm.send', // 动作码：发送系统私信批次
      targetType: 'growth_dm_campaign', // 对象类型：私信批次
      targetId: input.dedupe_key, // 对象主键：幂等键（同一批次重复调用可回溯）
      detail, // 明细：标题 / 受众摘要 / 发送人数；不落私信正文与全量名单
    }, () => {
      const sent = sendGrowthDm(db, {
        dedupeKey: input.dedupe_key,
        title: input.title,
        body: input.body,
        linkUrl: input.link_url,
        linkLabel: input.link_label,
        audience: input.audience,
        operatorId: req.user?.id ?? 'admin-token', // 引导令牌场景没有 req.user
      });
      detail.title = input.title; // 回填批次标题
      detail.audience = { // 回填受众摘要：只记条件与名单规模，不展开全量 user_ids
        region: input.audience.region ?? null, // 注册地区条件
        query: input.audience.query ?? null, // 昵称 / Mim ID 匹配条件
        user_count: input.audience.user_ids?.length ?? null, // 显式名单规模
      }; // 受众摘要结束
      detail.sent_count = sent.deliveries.length; // 回填本次实际发送人数
      detail.duplicate = sent.duplicate; // 回填是否幂等命中
      return sent; // 交回业务结果
    });
    // 每个目标用户走现有 WS 通道实时收到 message.new；离线用户下次打开会话列表即可看到
    for (const delivery of result.deliveries) {
      deps.imHub?.sendToUser(delivery.user_id, {
        type: 'message.new',
        payload: { message: delivery.message }, // 完整消息视图，前端可直接追加并刷新摘要
      });
    }
    res.status(result.duplicate ? 200 : 201).json({
      duplicate: result.duplicate, // true 表示幂等命中，没有新发私信
      campaign: result.campaign, // 批次台账
      sent_count: result.deliveries.length, // 本次实际发送人数
    });
  });

  // 批次台账：最近 N 条
  router.get('/admin/growth-dm/campaigns', requirePermission('messaging:write'), (req, res) => {
    const query = parse(z.object({ limit: z.coerce.number().int().min(1).max(100).optional() }), req.query); // 校验 limit
    res.json({ campaigns: listGrowthDmCampaigns(db, query.limit ?? 20) }); // 回传最近批次
  });

  return router; // 交出可挂载路由
}
