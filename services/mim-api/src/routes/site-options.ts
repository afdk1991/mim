// 站点选项路由：把「主题选项后台」的能力落成可读写接口。
// 三个面：① GET /site/options 免登录只读公开字段（前端启动配置）；② GET/PUT /admin/site-options 管理端读写（appearance:write）；
// ③ POST /admin/site-options/reset 单键或整体恢复默认。数据统一落在 site_settings 的单条 JSON（key = options），
// 与既有 theme / site / home / pages 配置并存，互不覆盖。

import { Router } from 'express'; // 路由容器
import { randomUUID } from 'node:crypto'; // 上传图片的随机文件名
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'; // 本地站点素材落盘
import path from 'node:path'; // 路径拼接
import { z } from 'zod'; // 入参校验
import { AppError } from '@mim/core-domain'; // 业务异常
import { requirePermission } from '../middleware.js'; // 鉴权：与外观配置同一权限口径
import { parse } from '../validate.js'; // 校验错误翻译
import { applyOptionPatch, mergeOptionValues, OPTION_DEFAULTS, optionSchema, pickPublicOptions } from '../options/registry.js'; // 注册表与清洗逻辑
import type { OptionValues } from '../options/registry.js'; // 取值类型
import { DATA_DIR } from '../config.js'; // 本地数据目录：站点素材与数据库同根，便于发布脚本一起持久化
import type { ApiDeps } from '../types.js'; // 依赖容器

/** 存储键：全站选项在 site_settings 表里的唯一行键 */
const OPTION_KEY = 'options';

/** 站点素材目录：后台图片上传控件把文件落在这里，由公开只读端点回发 */
const SITE_ASSET_DIR = path.join(DATA_DIR, 'site-assets');

/** 素材文件名白名单：随机 UUID + 图片扩展名，杜绝路径穿越与任意文件读取 */
const ASSET_FILE_RE = /^[0-9a-f-]{36}\.(png|jpg|jpeg|gif|webp|svg)$/i;

/** 图片 MIME → 扩展名：只接受这几类，其余一律拒绝 */
const IMAGE_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

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

/**
 * 读取单个布尔开关：注册表默认值为 true 的开关在未配置时视为开启。
 * 认证 / 付费等运行时链路统一走这里，保证后台面板上的开关是真实闸门，而不是纯展示。
 */
export function optionFlag(deps: ApiDeps, key: string): boolean {
  const value = readOptionValues(deps)[key]; // 取合并默认后的值
  return typeof value === 'boolean' ? value : true; // 缺省按开启处理，避免误伤现网
} // optionFlag 结束

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

/** 图片上传入参：data_url 为浏览器 FileReader 产生的 data URL，单文件限 2MB */
const uploadSchema = z.object({
  data_url: z.string().min(32).max(4_000_000), // base64 体积约为原文件 1.33 倍，留出余量
});

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

  /** 站点素材上传：后台图片控件把选中的图片以 data URL 提交，落盘后返回可直接入库的公开地址 */
  router.post('/admin/site-options/upload', requirePermission('appearance:write'), (req, res) => {
    const body = parse(uploadSchema, req.body ?? {}); // 校验入参
    const matched = /^data:([^;,]+);base64,(.+)$/i.exec(body.data_url.trim()); // 拆出 MIME 与 base64 主体
    if (!matched) throw new AppError('VALIDATION_FAILED', '图片格式无法识别'); // 非 data URL 直接拒绝
    const mime = matched[1].toLowerCase(); // 归一化 MIME
    const ext = IMAGE_EXT[mime]; // 只接受图片类型
    if (!ext) throw new AppError('VALIDATION_FAILED', '仅支持 png / jpg / gif / webp / svg 图片'); // 其他类型拒绝
    const buffer = Buffer.from(matched[2], 'base64'); // 解码二进制
    if (buffer.byteLength === 0) throw new AppError('VALIDATION_FAILED', '图片内容不能为空'); // 空文件拒绝
    if (buffer.byteLength > 2 * 1024 * 1024) throw new AppError('VALIDATION_FAILED', '图片不能超过 2MB'); // 限幅，避免把站点素材目录撑爆
    mkdirSync(SITE_ASSET_DIR, { recursive: true }); // 目录不存在时自动创建
    const filename = `${randomUUID()}.${ext}`; // 随机文件名，内容不可枚举
    writeFileSync(path.join(SITE_ASSET_DIR, filename), buffer); // 同步落盘：单文件小，避免引入异步排队
    res.status(201).json({ url: `/api/v1/site/assets/${filename}`, size: buffer.byteLength, mime }); // 回传可直接写入选项的地址
  });

  /** 站点素材公开只读：文件名严格白名单 + 长缓存，供前台直接引用上传的图标 / Logo */
  router.get('/site/assets/:file', (req, res) => {
    const file = String(req.params.file ?? ''); // 取文件名
    if (!ASSET_FILE_RE.test(file)) throw new AppError('NOT_FOUND', '图片不存在'); // 非法名直接 404，不暴露目录信息
    const abs = path.join(SITE_ASSET_DIR, file); // 绝对路径
    if (!existsSync(abs)) throw new AppError('NOT_FOUND', '图片不存在'); // 未落盘
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // 随机文件名即内容寻址，可长期缓存
    res.sendFile(abs); // 发送文件
  });

  return router; // 返回路由
} // 创建结束
