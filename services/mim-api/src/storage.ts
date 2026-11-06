/**
 * media 域：对象存储准入（08 §2 media 域 / 08 §5 generation_assets）。
 *
 * 设计原则：
 * - 默认 LocalDiskStorage：无需任何云凭证即可真实落盘，预签名 URL 由 HMAC-SHA256 保护；
 * - S3Storage：仅当 MIM_STORAGE_S3_* 齐全时启用（阿里云 OSS / R2 / MinIO 等 S3 兼容端点通用）；
 * - 云驱动缺凭证时抛 STORAGE_NOT_CONFIGURED(503)，绝不伪造外部产物。
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'; // 摘要、HMAC 签名与定长时间比较
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'; // 本地落盘所需的同步文件系统操作
import { dirname, extname, join } from 'node:path'; // 路径拼装与扩展名解析（跨平台安全）
import { // 按需引入 S3 命令，避免整包导入拖慢启动
  DeleteObjectCommand, // 删除对象
  GetObjectCommand, // 读取对象
  HeadObjectCommand, // 取对象元数据
  PutObjectCommand, // 写入对象
  S3Client, // S3 兼容客户端
} from '@aws-sdk/client-s3'; // 官方 SDK，避免手写 SigV4
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'; // 生成预签名 URL，服务端不经手字节流
import { AppError } from '@mim/core-domain'; // 统一业务错误类型与错误码

export type StorageDriver = 'local' | 's3'; // 支持的存储驱动枚举

export interface PresignedUrl { // 预签名结果，前端拿到后可直接收发
  url: string; // 完整可访问地址
  method: 'PUT' | 'GET'; // 允许的 HTTP 方法
  headers: Record<string, string>; // 调用方必须携带的请求头（如 content-type）
  expires_at: string; // 过期时间，ISO 字符串
} // 结束 PresignedUrl 定义

export interface PresignInput { // 预签名入参
  key: string; // 对象键，需通过安全校验
  mime?: string; // 内容类型，上传时写入签名与响应头
  expires_seconds?: number; // 期望有效期，会被裁剪到安全区间
  /** 本地驱动用它拼绝对地址；优先 MIM_PUBLIC_BASE_URL，其次调用方传入（如 req 的 host） */
  base_url?: string; // 本地驱动的对外基地址
} // 结束 PresignInput 定义

export interface SignatureCheck { // 本地驱动的验签入参
  method: 'PUT' | 'GET'; // 签名绑定的方法，防止 GET 签名被换成 PUT
  key: string; // 签名绑定的对象键
  expires: number; // 过期时间戳（秒）
  signature: string; // 调用方带来的签名
} // 结束 SignatureCheck 定义

export interface StorageAdapter { // 存储适配器统一契约，local/s3 可互换
  driver: StorageDriver; // 当前驱动标识
  configured: boolean; // 是否具备可用凭证
  presignUpload(input: PresignInput): Promise<PresignedUrl>; // 生成上传预签名
  presignDownload(input: PresignInput): Promise<PresignedUrl>; // 生成下载预签名
  putObject(key: string, body: Buffer, mime: string): Promise<{ size_bytes: number; checksum: string }>; // 服务端直接写入
  getObject(key: string): Promise<{ body: Buffer; mime: string }>; // 服务端直接读取
  headObject(key: string): Promise<{ size_bytes: number; checksum: string } | null>; // 探测对象是否存在及其元数据
  deleteObject(key: string): Promise<void>; // 删除对象
  verifySignature(check: SignatureCheck): boolean; // 本地驱动验签；S3 由云厂商负责
} // 结束 StorageAdapter 接口

/** object_key 只允许安全字符与层级：禁止 `..` 穿越、禁止绝对路径 */
const KEY_RE = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/; // 每层仅允许字母数字与 ._-，杜绝斜杠注入与目录穿越

export function assertSafeObjectKey(key: string): void { // 对象键准入校验，所有写入路径统一调用
  if (!KEY_RE.test(key) || key.includes('..')) { // 正则不匹配或含 .. 一律拒绝
    throw new AppError('VALIDATION_FAILED', 'invalid object key', { object_key: key }); // 拒绝危险键，防止越权读写
  } // 结束危险键判断
} // 结束 assertSafeObjectKey

const MIME_EXT: Record<string, string> = { // MIME → 扩展名，用于生成可读的对象键
  'image/png': '.png', // PNG 图片
  'image/jpeg': '.jpg', // JPEG 图片
  'audio/wav': '.wav', // WAV 音频
  'audio/mpeg': '.mp3', // MP3 音频
  'video/mp4': '.mp4', // MP4 视频
  'application/json': '.json', // 结构化 JSON 产物
  'text/plain': '.txt', // 纯文本
}; // 结束 MIME_EXT 映射

const EXT_MIME: Record<string, string> = { // 扩展名 → MIME，读取时回填 Content-Type
  '.png': 'image/png', // PNG
  '.jpg': 'image/jpeg', // JPG
  '.jpeg': 'image/jpeg', // JPEG 长后缀
  '.wav': 'audio/wav', // WAV
  '.mp3': 'audio/mpeg', // MP3
  '.mp4': 'video/mp4', // MP4
  '.json': 'application/json', // JSON
  '.txt': 'text/plain', // 纯文本
}; // 结束 EXT_MIME 映射

export function extensionForMime(mime: string): string { // 由 MIME 推导对象键后缀
  return MIME_EXT[mime] ?? '.bin'; // 未知类型统一 .bin，避免键名缺后缀
} // 结束 extensionForMime

export function mimeForObjectKey(key: string): string { // 由对象键后缀反推 MIME
  return EXT_MIME[extname(key).toLowerCase()] ?? 'application/octet-stream'; // 未识别时给二进制流类型
} // 结束 mimeForObjectKey

export function checksumOf(buffer: Buffer): string { // 计算产物摘要，供完整性校验
  return createHash('sha256').update(buffer).digest('hex'); // SHA-256 十六进制，与数据库 checksum 列对齐
} // 结束 checksumOf

function ttlSeconds(value: number | undefined): number { // 规范化预签名有效期
  if (!Number.isFinite(value) || (value as number) <= 0) return 900; // 缺省/非法值回落 15 分钟
  return Math.min(Math.floor(value as number), 604800); // 上限 7 天，避免长期有效链接被滥用
} // 结束 ttlSeconds

function isoAt(epochSeconds: number): string { // 秒级时间戳转 ISO 字符串
  return new Date(epochSeconds * 1000).toISOString(); // 数据库与前端统一使用 ISO 时间
} // 结束 isoAt

function normalizeBase(baseUrl: string | undefined): string { // 规整对外基地址
  const raw = (baseUrl ?? 'http://127.0.0.1:8787').trim(); // 未配置时回落本地默认端口
  return raw.endsWith('/') ? raw.slice(0, -1) : raw; // 去掉尾部斜杠，避免出现双斜杠
} // 结束 normalizeBase

/** 本地磁盘驱动：真实写入 data/media，签名 URL 直接由本服务收发 */
class LocalDiskStorage implements StorageAdapter { // 零云依赖的默认驱动
  readonly driver = 'local' as const; // 驱动标识
  readonly configured = true; // 本地磁盘始终可用

  constructor( // 注入落盘根目录与签名密钥
    private readonly rootDir: string, // 落盘根目录，所有对象键相对于它
    private readonly secret: string, // HMAC 密钥（复用 JWT secret），用于预签名
  ) {} // 参数属性直接生效，无需额外初始化

  private objectPath(key: string): string { // 由对象键得到绝对路径
    assertSafeObjectKey(key); // 先校验再拼路径，杜绝目录穿越
    return join(this.rootDir, key); // 相对于根目录拼接，保证不会逃逸
  } // 结束 objectPath

  private sign(method: 'PUT' | 'GET', key: string, expires: number): string { // 生成 HMAC 签名
    return createHmac('sha256', this.secret).update(`${method}\n${key}\n${expires}`).digest('hex'); // 方法+键+过期时间三元组签名，防止篡改
  } // 结束 sign

  private buildUrl(baseUrl: string | undefined, method: 'PUT' | 'GET', key: string, ttl: number): PresignedUrl { // 组装带签名的本地 URL
    const expires = Math.floor(Date.now() / 1000) + ttl; // 绝对过期时间（秒）
    const signature = this.sign(method, key, expires); // 对三元组签名
    const url = `${normalizeBase(baseUrl)}/api/v1/media/objects/${key}?expires=${expires}&signature=${signature}`; // 交给 media 路由统一收发
    return { url, method, headers: {}, expires_at: isoAt(expires) }; // 本地驱动无需额外请求头
  } // 结束 buildUrl

  async presignUpload(input: PresignInput): Promise<PresignedUrl> { // 生成上传预签名
    assertSafeObjectKey(input.key); // 校验对象键
    const result = this.buildUrl(input.base_url, 'PUT', input.key, ttlSeconds(input.expires_seconds)); // 以 PUT 绑定签名
    if (input.mime) result.headers['content-type'] = input.mime; // 上传需声明内容类型，服务端据此落盘
    return result; // 返回预签名结果
  } // 结束 presignUpload

  async presignDownload(input: PresignInput): Promise<PresignedUrl> { // 生成下载预签名
    assertSafeObjectKey(input.key); // 校验对象键
    return this.buildUrl(input.base_url, 'GET', input.key, ttlSeconds(input.expires_seconds)); // 以 GET 绑定签名，避免复用于上传
  } // 结束 presignDownload

  async putObject(key: string, body: Buffer, _mime: string) { // 服务端直接写入（内部生成产物时使用）
    const path = this.objectPath(key); // 解析落盘路径
    const dir = dirname(path); // 取父目录
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); // 按需递归建目录，支持多层键
    writeFileSync(path, body); // 同步写入，保证返回时文件已存在
    return { size_bytes: body.byteLength, checksum: checksumOf(body) }; // 回传大小与摘要
  } // 结束 putObject

  async getObject(key: string) { // 服务端直接读取
    const path = this.objectPath(key); // 解析路径
    if (!existsSync(path)) throw new AppError('NOT_FOUND', 'object not found', { object_key: key }); // 不存在即 404
    return { body: readFileSync(path), mime: mimeForObjectKey(key) }; // 内容类型按后缀推断
  } // 结束 getObject

  async headObject(key: string) { // 探测对象元数据
    const path = this.objectPath(key); // 解析路径
    if (!existsSync(path)) return null; // 不存在返回 null，任务可据此重建
    const body = readFileSync(path); // 本地无独立元数据接口，读取后计算摘要
    return { size_bytes: statSync(path).size, checksum: checksumOf(body) }; // 返回大小与摘要
  } // 结束 headObject

  async deleteObject(key: string) { // 删除对象
    const path = this.objectPath(key); // 解析路径
    if (existsSync(path)) rmSync(path); // 幂等删除：不存在也不报错
  } // 结束 deleteObject

  verifySignature(check: SignatureCheck): boolean { // 校验调用方带来的签名
    if (!Number.isFinite(check.expires) || check.expires * 1000 <= Date.now()) return false; // 过期或非法时间直接拒绝
    const expected = this.sign(check.method, check.key, check.expires); // 以同样参数重算签名
    if (expected.length !== check.signature.length) return false; // 长度不同直接拒绝，规避 timingSafeEqual 抛错
    try { // 进入签名比对，非法十六进制会抛错
      return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(check.signature, 'hex')); // 定长时间比较，抵御计时攻击
    } catch { // 输入含非法十六进制字符时
      return false; // 非十六进制输入视为非法签名
    } // 结束签名比对分支
  } // 结束 verifySignature
} // 结束 LocalDiskStorage

interface S3Options { // S3 兼容驱动的连接参数
  endpoint?: string; // 自定义端点（OSS/R2/MinIO），官方 S3 可省略
  region: string; // 区域，部分兼容端点要求固定值
  bucket: string; // 桶名
  accessKeyId: string; // 访问密钥 ID
  secretAccessKey: string; // 访问密钥
  forcePathStyle: boolean; // 是否强制 path-style（MinIO 等需要）
} // 结束 S3Options 定义

/** S3 兼容驱动：预签名交给 AWS SDK，服务端不经手字节流 */
class S3Storage implements StorageAdapter { // 云对象存储实现
  readonly driver = 's3' as const; // 驱动标识
  readonly configured: boolean; // 是否已配置（opts 非空）
  private readonly client: S3Client | null; // 客户端实例，未配置时为 null

  constructor(private readonly opts: S3Options | null) { // 允许以 null 构造，便于统一类型
    this.configured = opts !== null; // 有配置即可用
    this.client = opts // 有配置才实例化客户端
      ? new S3Client({ // SDK 内部负责 SigV4 与重试
          region: opts.region, // 区域
          ...(opts.endpoint ? { endpoint: opts.endpoint } : {}), // 仅自定义端点时才传入
          forcePathStyle: opts.forcePathStyle, // 兼容 MinIO 等实现
          credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey }, // 静态凭证
        }) // 结束客户端配置
      : null; // 缺配置则不建客户端
  } // 结束 S3Storage 构造

  private requireClient(): { client: S3Client; bucket: string } { // 使用前确保已配置
    if (!this.client || !this.opts) { // 客户端或配置缺失即视为不可用
      throw new AppError('STORAGE_NOT_CONFIGURED', 'S3 storage credentials are incomplete'); // 缺凭证诚实失败，不伪造产物
    } // 结束配置检查
    return { client: this.client, bucket: this.opts.bucket }; // 返回已就绪的客户端与桶名
  } // 结束 requireClient

  async presignUpload(input: PresignInput): Promise<PresignedUrl> { // 生成上传预签名
    assertSafeObjectKey(input.key); // 统一对象键校验
    const { client, bucket } = this.requireClient(); // 确保配置完整
    const ttl = ttlSeconds(input.expires_seconds); // 规范化有效期
    const command = new PutObjectCommand({ // 构造上传命令，签名基于它生成
      Bucket: bucket, // 目标桶
      Key: input.key, // 目标键
      ...(input.mime ? { ContentType: input.mime } : {}), // 有 MIME 时纳入签名
    }); // 结束上传命令
    const url = await getSignedUrl(client, command, { expiresIn: ttl }); // 交给 SDK 生成 SigV4 预签名
    const headers: Record<string, string> = {}; // 需要调用方额外携带的头
    if (input.mime) headers['content-type'] = input.mime; // 与签名中的 ContentType 保持一致
    return { url, method: 'PUT', headers, expires_at: isoAt(Math.floor(Date.now() / 1000) + ttl) }; // 返回预签名结果
  } // 结束 presignUpload

  async presignDownload(input: PresignInput): Promise<PresignedUrl> { // 生成下载预签名
    assertSafeObjectKey(input.key); // 统一对象键校验
    const { client, bucket } = this.requireClient(); // 确保配置完整
    const ttl = ttlSeconds(input.expires_seconds); // 规范化有效期
    const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: input.key }), { // 下载签名只绑定桶与键
      expiresIn: ttl, // 与返回的 expires_at 保持一致
    }); // 结束签名参数
    return { url, method: 'GET', headers: {}, expires_at: isoAt(Math.floor(Date.now() / 1000) + ttl) }; // 下载无需额外请求头
  } // 结束 presignDownload

  async putObject(key: string, body: Buffer, mime: string) { // 服务端直接写入
    const { client, bucket } = this.requireClient(); // 确保配置完整
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: mime })); // 同步等待上传完成
    return { size_bytes: body.byteLength, checksum: checksumOf(body) }; // 回传大小与摘要
  } // 结束 putObject

  async getObject(key: string) { // 服务端直接读取
    const { client, bucket } = this.requireClient(); // 确保配置完整
    const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key })); // 拉取对象
    const body = Buffer.from((await out.Body?.transformToByteArray()) ?? new Uint8Array()); // 流式响应转字节
    return { body, mime: out.ContentType ?? mimeForObjectKey(key) }; // 优先用云端声明的类型
  } // 结束 getObject

  async headObject(key: string) { // 探测对象元数据
    const { client, bucket } = this.requireClient(); // 确保配置完整
    try { // HEAD 失败可能是对象不存在或权限不足
      const out = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key })); // HEAD 请求开销最小
      return { size_bytes: out.ContentLength ?? 0, checksum: out.ETag?.replace(/"/g, '') ?? '' }; // ETag 去掉引号，便于与本地摘要对照
    } catch { // 统一兜底为「不存在」
      return null; // 不存在或无权限统一按「不存在」处理
    } // 结束 HEAD 分支
  } // 结束 headObject

  async deleteObject(key: string) { // 删除对象
    const { client, bucket } = this.requireClient(); // 确保配置完整
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })); // S3 删除天然幂等
  } // 结束 deleteObject

  verifySignature(): boolean { // S3 预签名由云厂商校验
    // S3 预签名由云厂商校验，本地不做二次验签
    return false; // 明确返回 false，避免调用方误以为本地可通过
  } // 结束 verifySignature（S3 无本地验签）
} // 结束 S3Storage

export interface CreateStorageOptions { // 创建存储适配器的入参
  env: Record<string, string | undefined>; // 环境变量，用于选择驱动与凭证
  jwtSecret: string; // 本地驱动的签名密钥
  /** 本地驱动的默认落盘目录（通常为 data/media） */
  fallbackDir: string; // 未显式配置目录时的兜底根目录
} // 结束 CreateStorageOptions

export function createStorage(options: CreateStorageOptions): StorageAdapter { // 工厂：按配置选择驱动
  const { env, jwtSecret, fallbackDir } = options; // 解构入参
  const requested = (env.MIM_STORAGE_DRIVER ?? '').trim().toLowerCase(); // 显式指定的驱动名
  const bucket = (env.MIM_STORAGE_S3_BUCKET ?? '').trim(); // 桶名
  const accessKeyId = (env.MIM_STORAGE_S3_ACCESS_KEY_ID ?? '').trim(); // 访问密钥 ID
  const secretAccessKey = (env.MIM_STORAGE_S3_SECRET_ACCESS_KEY ?? '').trim(); // 访问密钥
  const region = (env.MIM_STORAGE_S3_REGION ?? '').trim() || 'auto'; // 未指定区域时用 auto，兼容 R2 等端点

  const s3Ready = Boolean(bucket && accessKeyId && secretAccessKey); // 三项齐全才认为 S3 可用
  const driver: StorageDriver = // 计算最终驱动：显式配置优先，否则看 S3 凭证是否齐全
    requested === 's3' || requested === 'local' ? (requested as StorageDriver) : s3Ready ? 's3' : 'local'; // 显式优先，否则有凭证走 S3，无凭证回落本地

  if (driver === 's3') { // 走 S3 兼容链路
    return new S3Storage( // 构造云驱动实例
      s3Ready // 凭证齐全时才真正配置客户端
        ? { // S3Options 字面量
            endpoint: (env.MIM_STORAGE_S3_ENDPOINT ?? '').trim() || undefined, // 空串视为未配置
            region, // 区域
            bucket, // 桶名
            accessKeyId, // 访问密钥 ID
            secretAccessKey, // 访问密钥
            forcePathStyle: (env.MIM_STORAGE_S3_FORCE_PATH_STYLE ?? '') === '1', // 显式 '1' 才启用 path-style
          } // 结束 S3Options 字面量
        : null, // 显式要求 s3 但凭证不全时传入 null，调用时报 STORAGE_NOT_CONFIGURED
    ); // 结束 S3Storage 构造
  } // 结束 S3 分支

  const localDir = (env.MIM_STORAGE_LOCAL_DIR ?? '').trim() || join(fallbackDir, 'media'); // 默认落在 <fallbackDir>/media
  return new LocalDiskStorage(localDir, jwtSecret); // 本地驱动复用 JWT 密钥做 HMAC 签名
} // 结束 createStorage
