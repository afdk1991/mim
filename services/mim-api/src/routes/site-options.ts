// 站点选项路由：把「主题选项后台」的能力落成可读写接口。
// 三个面：① GET /site/options 免登录只读公开字段（前端启动配置）；② GET/PUT /admin/site-options 管理端读写（appearance:write）；
// ③ POST /admin/site-options/reset 单键或整体恢复默认。数据统一落在 site_settings 的单条 JSON（key = options），
// 与既有 theme / site / home / pages 配置并存，互不覆盖。

import { Router } from 'express'; // 路由容器
import { z } from 'zod'; // 入参校验
import { requirePermission } from '../middleware.js'; // 鉴权：与外观配置同一权限口径
import { parse } from '../validate.js'; // 校验错误翻译
import { applyOptionPatch, mergeOptionValues, OPTION_DEFAULTS, optionSchema, pickPublicOptions } from '../options/registry.js'; // 注册表与清洗逻辑
import type { OptionValues } from '../options/registry.js'; // 取值类型
import type { ApiDeps } from '../types.js'; // 依赖容器

/** 存储键：全站选项在 site_settings 表里的唯一行键 */
const OPTION_KEY = 'options';

/** 读取已存储的选项原始对象；缺失或脏数据按空对象处理，后续由注册表补默认 */
function readStored(deps: ApiDeps): Record<string, unknown> {
  const row = deps.db.prepare('SELECT value FROM site_settings WHERE key = ?').get(OPTION_KEY) as { value: string } | undefined; // 取单行
  if (!row) return {}; // 未配置：返回空对象
  try {
    const parsed: unknown = JSON.parse(row.value); // 解析 JSON
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}; // 仅接受对象
  } catch {
    return {}; // 脏数据回落空对象，避免配置坏掉时公开接口 500
  }
} // 读取结束

/** 读取「合并默认值后的完整选项」：其它模块需要站点行为时统一走这里，保证口径一致 */
export function readOptionValues(deps: ApiDeps): OptionValues {
  return mergeOptionValues(readStored(deps)); // 存储值 + 默认值
} // 读取结束

/** 写入完整选项：单行 upsert，附带更新时间，便于后台展示「最后保存时间」 */
function writeStored(deps: ApiDeps, values: OptionValues): void {
  const payload = JSON.stringify(values); // 序列化
  deps.db
    .prepare(
      `INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(OPTION_KEY, payload, new Date().toISOString()); // 幂等 upsert
} // 写入结束

/** 读取该行的最后保存时间：无行时返回 null，后台据此显示「尚未保存过」 */
function readUpdatedAt(deps: ApiDeps): string | null {
  const row = deps.db.prepare('SELECT updated_at FROM site_settings WHERE key = ?').get(OPTION_KEY) as { updated_at: string } | undefined; // 取更新时间
  return row ? row.updated_at : null; // 无行即未保存
} // 读取结束

/** 局部写入入参：values 为字段键到新值的映射，允许只提交改动的少数几个键 */
const patchSchema = z.object({ values: z.record(z.string(), z.unknown()) });

/** 重置入参：keys 缺省表示整体恢复默认；给出时只重置这些键 */
const resetSchema = z.object({ keys: z.array(z.string()).max(200).optional() });

/** 创建站点选项路由 */
export function createSiteOptionsRouter(deps: ApiDeps): Router {
  const router = Router(); // 路由实例

  /** 公开只读：免登录返回公开字段，前端用于设置标题、图标、布局与悬浮层 */
  router.get('/site/options', (_req, res) => {
    const values = readOptionValues(deps); // 完整取值
    res.json({ values: pickPublicOptions(values) }); // 只回公开字段
  });

  /** 管理端读取：返回注册表 schema + 当前完整取值 + 最后保存时间，后台按 schema 渲染 */
  router.get('/admin/site-options', requirePermission('appearance:write'), (_req, res) => {
    const values = readOptionValues(deps); // 完整取值
    res.json({ ...optionSchema(), values, updated_at: readUpdatedAt(deps) }); // 结构 + 值 + 时间
  });

  /** 管理端写入：只接受注册表内字段，未知键忽略；返回本次改动的键清单，便于前端提示「已保存 N 项」 */
  router.put('/admin/site-options', requirePermission('appearance:write'), (req, res) => {
    const body = parse(patchSchema, req.body); // 校验入参
    const current = readOptionValues(deps); // 当前取值
    const { values, changed } = applyOptionPatch(current, body.values); // 只合并注册表字段
    if (changed.length > 0) writeStored(deps, values); // 有改动才落库，避免无意义写入
    res.json({ values, changed, updated_at: readUpdatedAt(deps) }); // 回写结果
  });

  /** 管理端重置：keys 缺省整体恢复默认；给出时只把这些键恢复默认值 */
  router.post('/admin/site-options/reset', requirePermission('appearance:write'), (req, res) => {
    const body = parse(resetSchema, req.body ?? {}); // 校验入参
    const current = readOptionValues(deps); // 当前取值
    const patch: Record<string, unknown> = {}; // 重置补丁
    const keys = body.keys && body.keys.length > 0 ? body.keys : Object.keys(OPTION_DEFAULTS); // 未指定即全量
    for (const key of keys) { // 逐个键恢复默认
      if (Object.prototype.hasOwnProperty.call(OPTION_DEFAULTS, key)) patch[key] = OPTION_DEFAULTS[key]; // 仅在注册表内生效
    }
    const { values, changed } = applyOptionPatch(current, patch); // 复用同一套清洗
    if (changed.length > 0) writeStored(deps, values); // 有改动才落库
    res.json({ values, changed, updated_at: readUpdatedAt(deps) }); // 回写结果
  });

  return router; // 返回路由
} // 创建结束
