/**
 * media 域（08 §2 / §8）：对象存储准入与产物下载
 *
 * 设计（08 §6）：
 * - 客户端不直连存储服务，统一由服务端签发短时预签名 URL；
 * - `object_key` 首段固定为上传者 user_id，跨用户一律按 404 处理，不泄漏存在性；
 * - 中间产物有保留期（generation_assets.expires_at），成片长期保留；
 * - 本地驱动（默认）真实读写 data/media，对象收发端点凭 HMAC 签名免鉴权；
 *   S3 兼容驱动由云厂商直接收发对象，本服务只签发预签名 URL。
 */

import express, { Router } from 'express'; // express 本体用于取 raw 解析器，Router 用于建独立子路由
import type { Request } from 'express'; // 仅类型引用 Request，给辅助函数标注入参，不产生运行时代码
import { z } from 'zod'; // 声明请求体 / 查询串的 schema，交给 parse 统一校验
import { AppError, uuidv7 } from '@mim/core-domain'; // AppError 产出统一错误信封；uuidv7 生成时间有序主键
import { clockOf } from '../domain.js'; // 统一时间源，便于测试注入固定时钟
import { idempotency, requireAuth, requireEntitlement } from '../middleware.js'; // 幂等键、鉴权、权益三道拦截
import { // 从存储层一次性引入四个工具与适配器类型，多行展开便于逐项写明用途
  assertSafeObjectKey, // 校验对象键不含路径穿越，防止越权读写任意文件
  extensionForMime, // 由 MIME 反推扩展名，让对象名带正确后缀便于 CDN / 浏览器识别
  mimeForObjectKey, // 由对象名反推 MIME，客户端未带 Content-Type 时的兜底
  type StorageAdapter, // 存储适配器接口，local 与 s3 两套实现共用同一契约
} from '../storage.js'; // 存储层导入结束，后续只用这四个具名导出
import { parse } from '../validate.js'; // 统一校验入口，zod 失败时抛 VALIDATION_FAILED
import type { ApiDeps, Db } from '../types.js'; // 依赖容器与数据库连接类型

/** 工作台的解锁模块编码（与 db.ts seedModules / comic 路由保持一致） */
const MODULE_CODE = 'comic.workbench'; // 三处共用同一模块码，避免口径漂移导致解锁状态不一致

const ASSET_TYPES = ['image', 'video', 'audio', 'text', 'final'] as const; // as const 固化字面量元组，让 z.enum 复用且类型可推导

const presignUploadBody = z.object({ // 上传预签名请求体：白名单字段，多余字段被 zod 丢弃
  asset_type: z.enum(ASSET_TYPES), // 产物类型必须命中枚举，防止脏类型污染统计
  mime: z.string().trim().min(3).max(120), // MIME 去空白后限长，避免超长串进入对象名推导
  project_id: z.string().min(1).optional(), // 可选工程归属；缺省时对象落到 uploads 前缀
  size_bytes: z.number().int().min(0).max(1024 * 1024 * 1024).optional(), // 单对象上限 1GiB，提前拦截异常大包
  expires_seconds: z.number().int().min(60).max(604800).optional(), // 有效期 60 秒 ~ 7 天，防止签出永久链接
}); // 上传预签名 schema 结束：后续 parse 调用都以它为唯一校验口径

const presignDownloadQuery = z.object({ // 下载预签名查询串：走 query 便于直接拼成 URL
  object_key: z.string().min(1).max(512), // 对象键必填且限长，超长键一律拒绝
  expires_seconds: z.coerce.number().int().min(60).max(604800).optional(), // query 值都是字符串，coerce 成数字后再校验区间
}); // 下载预签名 schema 结束：有效期区间与上传保持一致

const listAssetsQuery = z.object({ // 产物列表查询串：全部可选，未给则返回本人最新产物
  project_id: z.string().min(1).optional(), // 按工程过滤前会再做归属校验，避免越权读取
  asset_type: z.enum(ASSET_TYPES).optional(), // 按类型过滤，复用同一枚举保持口径
  limit: z.coerce.number().int().min(1).max(100).default(20), // 默认 20、上限 100，防止一次拉全表
}); // 产物列表 schema 结束

interface AssetRow { // generation_assets 表行结构，用于 SQL 结果强类型化
  id: string; // 产物主键（uuidv7）
  job_id: string; // 所属生成任务，便于回溯产物来源
  project_id: string; // 所属创作工程，用于归属与过滤
  asset_type: string; // 产物类型，取值来自 ASSET_TYPES
  object_key: string; // 对象存储键，首段为上传者 user_id
  mime: string; // MIME 类型，下载时回写 Content-Type
  duration_ms: number | null; // 音视频时长（毫秒），非音视频为 null
  size_bytes: number | null; // 对象字节数，未知时为 null
  checksum: string; // 内容校验和，供前端做完整性 / 秒传校验
  expires_at: string | null; // 过期时间；null 表示长期保留（成片）
  created_at: string; // 创建时间（ISO 字符串），列表按其倒序
} // AssetRow 结束：字段与 generation_assets 表列一一对应

interface ProjectRow { // comic_projects 的最小投影，只取归属校验需要的列
  id: string; // 工程主键，回填进对象键路径
  title: string; // 工程标题，当前仅用于确认行存在
} // ProjectRow 结束

/** 只允许读取「本人 + 未删除」的创作工程；跨用户与不存在一律 404 */
function findOwnedProject(db: Db, userId: string, projectId: string): ProjectRow { // 归属校验收敛到一处，避免各路由重复实现
  const row = db // 取 better-sqlite3 同步连接
    .prepare( // 预编译语句，重复调用可复用执行计划
      // 下面模板串整段是一条 SQL：同时限定工程 ID、属主、未软删
      `SELECT id, title FROM comic_projects
       WHERE id = ? AND owner_user_id = ? AND deleted_at IS NULL`, // 三个条件缺一不可，任一不满足都视为工程不存在
    ) // prepare 调用结束，参数即上面那条 SQL
    .get(projectId, userId) as ProjectRow | undefined; // 同步取单行；未命中返回 undefined 交由下方统一抛 404
  if (!row) throw new AppError('NOT_FOUND', 'comic project not found', { project_id: projectId }); // 跨用户与真不存在同样 404，不泄漏存在性
  return row; // 命中则返回，调用方只关心 id
} // findOwnedProject 结束

/** object_key 首段是签名主体；不匹配本人即 404（不泄漏对象是否存在） */
function assertOwnedKey(userId: string, key: string): void { // 统一的对象归属守卫，供下载预签名复用
  assertSafeObjectKey(key); // 先做路径安全校验，挡住 ../ 之类的穿越键
  if (!key.startsWith(`${userId}/`)) { // 首段前缀比对即归属校验，成本低于查库
    throw new AppError('NOT_FOUND', 'object not found', { object_key: key }); // 用 404 而非 403，避免暴露对象是否存在
  } // if 结束：能走到这里说明键首段就是本人 user_id
} // assertOwnedKey 结束

/** 本地驱动拼绝对地址；优先 MIM_PUBLIC_BASE_URL，其次按请求 host 推导（反代后仍是公网域名） */
function baseUrlOf(req: Request, env: Record<string, string | undefined>): string | undefined { // 计算预签名 URL 的公网基址
  const configured = (env.MIM_PUBLIC_BASE_URL ?? '').trim(); // 显式配置优先，适配反代后 host 被改写的情况
  if (configured) return configured; // 配了就直用，完全不强依赖请求头
  const host = req.get('host'); // 回退到请求 Host 头（反代通常已保留公网域名）
  return host ? `${req.protocol}://${host}` : undefined; // 有 host 才拼协议；无 host 返回 undefined 由驱动兜底
} // baseUrlOf 结束

function requireStorage(deps: ApiDeps): StorageAdapter { // 取存储适配器，未注入则整个媒体域不可用
  if (!deps.storage) throw new AppError('STORAGE_NOT_CONFIGURED', 'object storage is not available'); // 显式报配置缺失，避免空指针崩溃
  return deps.storage; // 类型收窄后返回非空适配器
} // requireStorage 结束

function assetPayload(row: AssetRow) { // 把 DB 行投影成对外 JSON，避免透出内部多余列
  return { // 显式列举字段，保持响应契约稳定
    id: row.id, // 产物 ID
    job_id: row.job_id, // 来源任务 ID，前端据此关联生成记录
    project_id: row.project_id, // 所属工程
    asset_type: row.asset_type, // 产物类型
    object_key: row.object_key, // 对象键，前端可据此再签下载 URL
    mime: row.mime, // MIME，前端可直接用于 img / video 标签
    duration_ms: row.duration_ms, // 时长（毫秒）
    size_bytes: row.size_bytes, // 字节数，用于展示与限额提示
    checksum: row.checksum, // 校验和，供完整性校验
    expires_at: row.expires_at, // 过期时间；null 表示长期保留
    created_at: row.created_at, // 创建时间，前端排序展示
  }; // 返回对象字面量结束
} // assetPayload 结束

/** Express 5 的 `*splat` 参数为段数组，按 `/` 还原并做安全校验 */
function splatKey(req: Request): string { // 把通配段还原成完整对象键
  const raw: unknown = req.params.splat; // 参数类型不确定（数组或字符串），先按 unknown 收窄
  const key = Array.isArray(raw) ? raw.join('/') : typeof raw === 'string' ? raw : ''; // 数组按 / 拼回；非字符串一律当空串
  if (!key) throw new AppError('VALIDATION_FAILED', 'object key is required'); // 空键无意义，直接 422
  assertSafeObjectKey(key); // 拼接还原后再校验一次，防止绕过单段校验
  return key; // 返回校验通过的对象键
} // splatKey 结束

/**
 * 对象收发端点（挂载在全局 JSON 解析之前）：
 * - 免鉴权，凭 URL 中的 expires + signature 校验；
 * - 仅本地驱动提供该端点；S3 驱动由云厂商直连，这里返回 404。
 */
export function createMediaObjectRouter(deps: ApiDeps): Router { // 对象端点工厂：必须由 app 在 express.json 之前挂载
  const router = Router(); // 独立 router，只承载免鉴权的对象读写

  function guard(req: Request): StorageAdapter { // 端点级守卫：仅本地驱动提供直连收发
    if (deps.storage?.driver !== 'local') { // S3 驱动由云厂商直连，本服务不应暴露该端点
      throw new AppError('NOT_FOUND', 'object endpoint is only served by the local storage driver'); // 统一 404，不暴露驱动细节
    } // if 结束：非本地驱动已在此拦下
    return requireStorage(deps); // 驱动匹配后再取适配器，顺带处理未注入的情况
  } // guard 结束

  function signatureOf(req: Request): { expires: number; signature: string } { // 解析并校验签名相关查询参数
    const expiresRaw = req.query.expires; // 取过期时间戳原始值
    const expires = Number(Array.isArray(expiresRaw) ? expiresRaw[0] : expiresRaw); // 重复参数取第一个再转数字
    const signatureRaw = req.query.signature; // 取签名原始值
    const signature = Array.isArray(signatureRaw) ? signatureRaw[0] : signatureRaw; // 重复参数同样取第一个
    if (!Number.isInteger(expires) || !signature || typeof signature !== 'string') { // 缺参或类型不符都视为鉴权失败
      throw new AppError('AUTH_UNAUTHORIZED', 'storage signature is missing'); // 401：签名参数缺失
    } // if 结束：参数齐全才可能通过校验
    return { expires, signature }; // 交给适配器做 HMAC 校验
  } // signatureOf 结束

  // 原始字节上传：该路由自带的 raw 解析器在全局 express.json 之前生效
  router.put('/media/objects/*splat', express.raw({ type: () => true, limit: '64mb' }), async (req, res) => { // 通配路由 + raw 解析，接收任意二进制体
    const storage = guard(req); // 先确认驱动与适配器可用
    const key = splatKey(req); // 还原并校验对象键
    const { expires, signature } = signatureOf(req); // 取出签名参数
    if (!storage.verifySignature({ method: 'PUT', key, expires, signature })) { // method 参与 HMAC，防止 GET 签名被改用 PUT 上传
      throw new AppError('AUTH_UNAUTHORIZED', 'storage signature rejected'); // 401：签名不匹配或已过期
    }
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0); // raw 解析失败时 body 不是 Buffer，退化为空
    if (body.byteLength === 0) { // 空体无意义，也易被用来占位探测
      throw new AppError('VALIDATION_FAILED', 'uploaded object body is empty'); // 422：空对象
    }
    const mime = req.header('content-type') ?? mimeForObjectKey(key); // 优先客户端声明，缺失时按扩展名推导
    const stored = await storage.putObject(key, body, mime); // 真正落盘 / 落桶，返回校验和等元信息
    res.status(204).setHeader('x-object-checksum', stored.checksum); // 204 无响应体；校验和放响应头供调用方记录
    res.end(); // 显式结束响应，避免 keep-alive 连接悬挂
  });

  router.get('/media/objects/*splat', async (req, res) => { // 免鉴权读取端点，同样凭 URL 签名放行
    const storage = guard(req); // 驱动守卫
    const key = splatKey(req); // 对象键还原与安全校验
    const { expires, signature } = signatureOf(req); // 签名参数
    if (!storage.verifySignature({ method: 'GET', key, expires, signature })) { // 与 PUT 同理，method 参与签名
      throw new AppError('AUTH_UNAUTHORIZED', 'storage signature rejected'); // 401：签名被拒
    }
    const object = await storage.getObject(key); // 读取对象内容与 MIME
    res.status(200).type(object.mime).send(object.body); // 回写真实 MIME 后发送字节，避免浏览器误判类型
  });

  return router; // 交由 app 挂载到 /api/v1
} // 路由工厂结束，返回已注册好端点的 router

/** 受保护的 media 控制面：签发预签名 URL、查询产物 */
export function createMediaRouter(deps: ApiDeps): Router { // 控制面路由工厂
  const router = Router(); // 独立 router
  // 鉴权按命名空间生效：未匹配到 /media* 的请求直接放行到后续 router，避免未知路径被误拦成 401
  router.use('/media', requireAuth); // 只对 /media 前缀生效，后续 router 请求原样穿透
  router.use('/media', requireEntitlement(MODULE_CODE)); // 再校验模块权益，未解锁用户签不出任何 URL

  router.post('/media/presign/upload', idempotency, async (req, res) => { // 签发上传 URL；写操作必须先过幂等键
    const body = parse(presignUploadBody, req.body); // zod 校验并裁剪多余字段
    const user = req.user!; // 已过 requireAuth，user 必定存在
    const storage = requireStorage(deps); // 取适配器，未配置时报 STORAGE_NOT_CONFIGURED

    let projectId: string | null = null; // 缺省不带工程，对象落到 uploads 前缀
    if (body.project_id) { // 只有显式给了工程才做归属校验
      projectId = findOwnedProject(deps.db, user.id, body.project_id).id; // 校验通过后取规范化 ID，非法直接 404
    } // if 结束：未传 project_id 时保持 null，对象落到 uploads 前缀

    const key = `${user.id}/${projectId ?? 'uploads'}/${uuidv7()}${extensionForMime(body.mime)}`; // 键首段固定 user_id，路径天然隔离租户
    const presigned = await storage.presignUpload({ // 让适配器按驱动生成 URL（本地带 HMAC，S3 走官方签名）
      key, // 目标对象键
      mime: body.mime, // 与声明一致，S3 会据此校验 Content-Type
      expires_seconds: body.expires_seconds, // 未给则由适配器用默认有效期
      base_url: baseUrlOf(req, deps.env), // 本地驱动拼绝对地址用
    }); // presignUpload 调用结束，返回可直接 PUT 的描述

    res.status(201).json({ // 201 表示已创建上传意图
      upload: presigned, // 含 url / method / headers / expires_at
      object_key: key, // 回传键，后续下载与入库都用它
      asset_type: body.asset_type, // 原样回显，便于调用方串联流程
      expires_at: presigned.expires_at, // 顶层再暴露一次过期时间，便于直接判断
    }); // json 调用结束，响应已发出
  }); // 上传预签名路由处理函数结束

  router.get('/media/presign/download', async (req, res) => { // 签发下载 URL
    const query = parse(presignDownloadQuery, req.query); // 查询串走同一套 zod 校验
    const user = req.user!; // 已鉴权
    const storage = requireStorage(deps); // 适配器
    assertOwnedKey(user.id, query.object_key); // 归属优先校验，跨用户直接 404

    // 保留期一致性：`GET /media/assets` 按 `expires_at` 过滤隐藏过期产物，
    // 下载签名若不做同样校验，过期产物在 asset-gc 真正删字节之前（最长一个清理周期）仍可下载，TTL 形同虚设。
    // 这里按 object_key 反查产物登记行；用户直传的素材不在 generation_assets 中，无保留期，按原逻辑放行。
    const assetRow = deps.db // 数据库句柄
      .prepare(`SELECT expires_at FROM generation_assets WHERE object_key = ? ORDER BY created_at DESC LIMIT 1`) // 同一键理论上只有一行，取最新兜底
      .get(query.object_key) as { expires_at: string | null } | undefined; // 未登记则 undefined
    if (assetRow && assetRow.expires_at !== null && assetRow.expires_at <= clockOf(deps)) { // 已过保留期
      throw new AppError('NOT_FOUND', 'asset expired', { object_key: query.object_key, expires_at: assetRow.expires_at }); // 与「不存在」同一口径，不额外泄漏保留期策略
    } // 保留期判定结束

    if ((await storage.headObject(query.object_key)) === null) { // 先探测存在性，避免为不存在的对象签 URL
      throw new AppError('NOT_FOUND', 'object not found', { object_key: query.object_key }); // 不存在即 404
    } // if 结束：对象确实存在才继续签发

    const presigned = await storage.presignDownload({ // 生成短时下载地址
      key: query.object_key, // 目标对象键
      expires_seconds: query.expires_seconds, // 可选有效期，未给用默认值
      base_url: baseUrlOf(req, deps.env), // 本地驱动的绝对地址基址
    }); // presignDownload 调用结束
    res.json({ download: presigned, object_key: query.object_key, expires_at: presigned.expires_at }); // 平铺返回，前端直接取 url
  }); // 下载预签名路由处理函数结束

  router.get('/media/assets', async (req, res) => { // 列出本人可见产物
    const query = parse(listAssetsQuery, req.query); // 校验过滤参数
    const user = req.user!; // 已鉴权
    const storage = requireStorage(deps); // 需要为每条产物签下载 URL

    const conditions = ['p.owner_user_id = ?', 'p.deleted_at IS NULL']; // 基线条件：本人 + 工程未软删
    const values: unknown[] = [user.id]; // 与条件顺序严格对应的参数数组
    if (query.project_id) { // 指定工程时追加过滤
      conditions.push('a.project_id = ?'); // 用占位符防注入
      values.push(findOwnedProject(deps.db, user.id, query.project_id).id); // 先过归属校验再入参
    } // if 结束：未指定工程时不加过滤条件
    if (query.asset_type) { // 指定类型时追加过滤
      conditions.push('a.asset_type = ?'); // 同样用占位符
      values.push(query.asset_type); // 枚举已由 zod 收窄
    } // if 结束：未指定类型时返回全部类型
    const now = clockOf(deps); // 取统一时间源，便于测试固定「现在」
    conditions.push('(a.expires_at IS NULL OR a.expires_at > ?)'); // 只返回未过期产物；成片 expires_at 为 null 故永久可见
    values.push(now); // 对应上一个占位符
    values.push(query.limit); // LIMIT 也用占位符绑定，参数顺序排最后

    const rows = deps.db // 同步查询连接
      .prepare( // 预编译这条动态 SQL，占位符顺序与下方 values 严格对应
        // 下面整段 SQL：先 JOIN 工程，再按动态条件过滤，最后按时间倒序限量
        `SELECT a.* FROM generation_assets a
         JOIN comic_projects p ON p.id = a.project_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY a.created_at DESC
         LIMIT ?`, // 收尾反引号后接逗号：模板串在占位符处结束
      ) // prepare 调用结束
      .all(...values) as AssetRow[]; // 展开参数按序绑定，结果强类型化为行数组

    const items = await Promise.all( // 并发签下载 URL，避免逐条串行等待
      rows.map(async (row) => { // 每条产物一个异步任务
        const presigned = await storage.presignDownload({ // 为当前产物签短时地址
          key: row.object_key, // 该产物的对象键
          base_url: baseUrlOf(req, deps.env), // 本地驱动需要绝对基址
        }); // presignDownload 调用结束
        return { ...assetPayload(row), download_url: presigned.url }; // 在原字段上追加可直接访问的 URL
      }), // 单条产物的异步任务结束
    ); // Promise.all 结束，items 顺序与 rows 一致

    res.json({ items }); // 统一包一层 items，便于后续加分页字段
  }); // 产物列表路由处理函数结束

  return router; // 交由 app 挂载到 /api/v1
} // 路由工厂结束，返回已注册好端点的 router

/** 供 ai 路由复用：校验任务经工程归属 */
export function ownedJobProjectId(db: Db, userId: string, jobId: string): string | null { // 返回任务所属工程 ID；无权限返回 null
  const row = db // 同步连接
    .prepare( // 预编译这条归属查询，参数为任务 ID 与用户 ID
      // 这条 SQL 把任务与工程 JOIN，借工程属主间接校验任务归属
      `SELECT j.project_id FROM generation_jobs j
       JOIN comic_projects p ON p.id = j.project_id
       WHERE j.id = ? AND p.owner_user_id = ? AND p.deleted_at IS NULL`, // 三个条件同时满足才算有权访问
    ) // prepare 调用结束
    .get(jobId, userId) as { project_id: string } | undefined; // 未命中返回 undefined
  return row?.project_id ?? null; // 统一成 null，交给调用方抛 404
} // ownedJobProjectId 结束
