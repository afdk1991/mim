/**
 * ai-orchestrator：生成任务队列消费（08 §2/§3.2）。
 *
 * 职责：
 * 1. 轮询 queued 任务，`UPDATE ... WHERE status='queued'` 原子抢占为 running；
 * 2. 按 job_type 路由处理器；mock 提供方产物真实落盘（结果显式标注 provider=mock）；
 * 3. 真实提供方 openai（OpenAI 兼容协议：OpenAI / 火山方舟 / DeepSeek / 百炼兼容模式，
 *    经 MIM_AI_BASE_URL 切换）支持 text（chat/completions）与 image（images/generations）任务，
 *    产物为真实模型返回内容；未配置凭证或不支持的 job_type 一律诚实失败
 *    （PROVIDER_NOT_CONFIGURED），不伪造外部产物；
 * 4. 成本预检（单任务上限 + 当日累计）超限直接失败（COST_LIMIT_EXCEEDED）；
 * 5. 成功产物写入 generation_assets；compose 成功驱动项目 generating → rendered。
 */

import { AppError } from '@mim/core-domain'; // 统一业务错误类型：供 runOne 捕获并映射错误码
import { uuidv7 } from '@mim/core-domain'; // 时间有序 UUID，产物与任务主键写入时避免碰撞
import { checksumOf, extensionForMime, type StorageAdapter } from './storage.js'; // 复用存储层的摘要算法、后缀映射与适配器契约
import type { Db } from './types.js'; // 同步 SQLite 数据库抽象（prepare/transaction）

const JOB_TYPES = ['text', 'image', 'video', 'tts', 'compose'] as const; // 任务类型白名单，作为路由与校验的唯一事实来源
type JobType = (typeof JOB_TYPES)[number]; // 由常量数组反推字面量联合类型，保证 switch/映射表被类型检查覆盖

const ASSET_TYPE_BY_JOB: Record<JobType, 'text' | 'image' | 'video' | 'audio' | 'final'> = { // 任务类型 → 产物类型映射，决定 generation_assets.asset_type
  text: 'text', // 文本任务产出 text 类资产
  image: 'image', // 图片任务产出 image 类资产
  video: 'video', // 视频任务产出 video 类资产
  tts: 'audio', // 语音合成归入 audio，与视频区分便于前端选择播放组件
  compose: 'final', // 合成任务产出成片，标记 final 以支持长期保留
}; // 结束产物类型映射表

const MIME_BY_JOB: Record<JobType, string> = { // 各任务产物的默认 MIME，用于落盘 Content-Type 与下载响应头
  text: 'application/json', // 文本以结构化 JSON 落盘，可携带 model/usage 等元数据
  image: 'image/png', // mock 与兼容网关统一按 PNG 处理，避免前端多分支
  video: 'application/json', // mock 不伪造二进制视频，改用 JSON 清单占位
  tts: 'audio/wav', // mock 生成可解码 WAV，保证播放链路真实可用
  compose: 'application/json', // mock 合成返回清单，待接入真实渲染器再切换 MP4
}; // 结束默认 MIME 映射表

interface JobRow { // generation_jobs 在编排器内使用到的字段子集
  id: string; // 任务主键，用于原子抢占与结果回写
  project_id: string; // 所属工程，成片状态联动与对象键组织都依赖它
  storyboard_id: string | null; // 可选分镜归属，产物可精确挂到某个分镜
  job_type: string; // 数据库以字符串存储，运行时再收敛为 JobType
  status: string; // queued/running/succeeded/failed，决定能否被抢占
  cost_estimate_minor: number | null; // 预估成本（最小货币单位），用于双重限额预检
  payload: string; // 原始 JSON 字符串，处理器按需解析提示词
  created_by: string; // 创建者，作为对象键首段实现按用户隔离
  created_at: string; // 入队时间，tick 据此保证先进先出
} // 结束 JobRow，覆盖抢占、限额与落盘所需字段

export interface RunResult { // 单次执行结果，供调用方与观测接口使用
  job_id: string; // 对应任务主键
  status: 'succeeded' | 'failed' | 'skipped'; // skipped 表示未执行（状态不符或已被其他 worker 抢占）
  provider: string; // 实际使用的提供方，便于区分 mock 与真实产物
  asset_id?: string; // 成功时写入的产物 ID
  object_key?: string; // 成功时的对象存储键，可直接用于下载
  error_code?: string; // 失败时的机器可读错误码
  message?: string; // 失败或跳过的可读原因
} // 结束 RunResult

export interface Orchestrator { // 对外暴露的能力契约，便于测试时注入替身
  readonly provider: string; // 当前提供方名称
  readonly configured: boolean; // 凭证是否齐备，未配置时任务应诚实失败而非伪造
  readonly jobCostLimitMinor: number; // 单任务成本上限（0 表示不限制）
  readonly dailyCostLimitMinor: number; // 当日累计成本上限（0 表示不限制）
  readonly assetTtlDays: number; // 中间产物保留天数
  capabilities(): Record<string, unknown>; // 自述能力，供能力探测接口透出
  tick(limit?: number): Promise<RunResult[]>; // 批量消费一批队列任务
  runOne(jobId: string): Promise<RunResult | null>; // 精确执行指定任务
  start(): void; // 启动定时轮询
  stop(): void; // 停止定时轮询
} // 结束 Orchestrator 契约

/** 1×1 透明 PNG：mock 产物是真实可解码图片，不是占位字符串 */
const MOCK_PNG_BASE64 = // 预置最小 PNG 的 base64 常量
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='; // 解码后为 1×1 透明图，可被浏览器真实渲染以验证端到端链路

/** 0.5s 静音 WAV（8000Hz / 单声道 / 16bit）：可被播放器真实解码 */
function mockWav(): Buffer { // 现场拼接合法 WAV 头与静音采样，避免仓库引入二进制资源
  const sampleRate = 8000; // 8kHz 采样率：文件足够小且播放器兼容性最好
  const durationMs = 500; // 0.5 秒时长，满足 mock 产物最小可播放需求
  const samples = (sampleRate * durationMs) / 1000; // 采样点总数，用于推算数据段字节数
  const dataSize = samples * 2; // 16bit 单声道即每采样 2 字节
  const buffer = Buffer.alloc(44 + dataSize); // 预留 44 字节标准头 + 数据段
  buffer.write('RIFF', 0, 'ascii'); // RIFF 标识，WAV 容器固定开头
  buffer.writeUInt32LE(36 + dataSize, 4); // 文件总长减去前 8 字节
  buffer.write('WAVE', 8, 'ascii'); // WAVE 格式标识
  buffer.write('fmt ', 12, 'ascii'); // fmt 子块标识
  buffer.writeUInt32LE(16, 16); // fmt 子块长度固定 16
  buffer.writeUInt16LE(1, 20); // 音频格式 1 = PCM
  buffer.writeUInt16LE(1, 22); // 声道数 1 = 单声道
  buffer.writeUInt32LE(sampleRate, 24); // 采样率写入头
  buffer.writeUInt32LE(sampleRate * 2, 28); // 字节率 = 采样率 × 块对齐
  buffer.writeUInt16LE(2, 32); // 块对齐 = 声道数 × 位深/8
  buffer.writeUInt16LE(16, 34); // 位深 16bit
  buffer.write('data', 36, 'ascii'); // data 子块标识
  buffer.writeUInt32LE(dataSize, 40); // 数据段字节数
  return buffer; // 剩余数据区保持全 0，即静音
} // 结束 mockWav

function manifestOf(job: JobRow, note: string): Buffer { // mock/占位产物统一输出结构化清单，便于人工排查
  return Buffer.from( // 将对象序列化为 UTF-8 字节，交给存储适配器落盘
    JSON.stringify( // 手工控制缩进，保证产物可读
      { // 清单对象起始
        provider: 'mock', // 显式标注 mock，避免被误认为真实模型输出
        job_id: job.id, // 回填任务 ID，便于产物与任务互相追溯
        job_type: job.job_type, // 记录任务类型，前端可据此选择渲染方式
        project_id: job.project_id, // 记录所属工程
        storyboard_id: job.storyboard_id, // 记录分镜归属（可能为空）
        payload: (() => { // IIFE：payload 非法 JSON 时降级为原始字符串
          try { // 先尝试按 JSON 解析
            return JSON.parse(job.payload); // 正常路径按 JSON 解析，保留原始结构
          } catch { // 解析失败分支
            return job.payload; // 解析失败则原样透传，保证产物不丢信息
          } // 结束 catch
        })(), // 立即执行，得到最终 payload 值
        note, // 调用点传入的说明，解释为何返回清单而非真实媒体
      }, // 结束清单对象
      null, // 不启用 replacer，保持字段顺序
      2, // 两空格缩进，便于阅读
    ), // 结束序列化
    'utf8', // 显式 UTF-8，保证中文 note 不乱码
  ); // 结束 Buffer 构造
} // 结束 manifestOf

function numberFromEnv(value: string | undefined, fallback: number): number { // 环境变量转数字并做安全兜底
  const parsed = Number(value); // 未配置或空串会得到 NaN/0，交给下一步判断
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback; // 只接受非负有限数，避免负限额导致误判
} // 结束 numberFromEnv

/** OpenAI 兼容提供方配置（OpenAI / 火山方舟 / DeepSeek / 百炼兼容模式，经 base_url 切换） */
interface OpenAiCompatConfig { // 兼容网关所需的最小配置集合
  apiKey: string; // Bearer 凭证
  baseUrl: string; // 网关根地址（保证无尾部斜杠）
  textModel: string; // 文本任务模型名
  imageModel: string; // 图片任务模型名
} // 结束 OpenAiCompatConfig

function resolveOpenAiCompat(env: Record<string, string | undefined>): OpenAiCompatConfig | null { // 从环境变量解析兼容网关配置
  const apiKey = (env.MIM_AI_OPENAI_API_KEY ?? '').trim(); // 去空白，避免复制粘贴带换行导致鉴权失败
  if (!apiKey) return null; // 无凭证返回 null，由上层判定为未配置
  return { // 返回归一化后的配置
    apiKey, // 复用已裁剪的凭证
    baseUrl: (env.MIM_AI_BASE_URL ?? '').trim().replace(/\/+$/, '') || 'https://api.openai.com/v1', // 去尾斜杠便于拼路径，未配置时回落官方端点
    textModel: (env.MIM_AI_TEXT_MODEL ?? '').trim() || 'gpt-4o-mini', // 未指定时用低成本默认模型
    imageModel: (env.MIM_AI_IMAGE_MODEL ?? '').trim() || 'dall-e-3', // 未指定时用通用文生图模型
  }; // 结束配置对象
} // 结束 resolveOpenAiCompat

/** 各提供方实际支持的任务类型（mock 全量；openai 兼容协议仅 text/image，其余诚实失败） */
function supportedTypesFor(provider: string): readonly JobType[] { // 按提供方能力裁剪可执行任务类型
  if (provider === 'mock') return JOB_TYPES; // mock 覆盖全部类型，便于本地跑通端到端
  if (provider === 'openai') return ['text', 'image']; // 兼容协议仅实现两类，视频/合成不伪造
  return []; // 未知提供方一律不支持，避免静默产出错误产物
} // 结束 supportedTypesFor

/** 从任务 payload 提取提示词（prompt / text 字段优先，否则整体 JSON 透传） */
function promptOf(job: JobRow): string { // 统一提示词提取逻辑，兼容前端多种传参习惯
  try { // payload 约定为 JSON，先尝试解析
    const payload = JSON.parse(job.payload) as Record<string, unknown>; // payload 约定为 JSON 对象
    const candidate = payload.prompt ?? payload.text ?? payload.prompt_text; // 依次兼容三种常见字段名
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim(); // 命中非空字符串则裁剪后返回
    return JSON.stringify(payload); // 无提示词字段时整体序列化，仍为模型提供上下文
  } catch { // 非法 JSON 分支
    return job.payload; // 非 JSON 的 payload 原样作为提示词，避免直接失败
  } // 结束 catch
} // 结束 promptOf

const OPENAI_TIMEOUT_MS = 90_000; // 生成类请求耗时长，统一 90s 超时防止工作线程被长期占用

async function openAiPost(cfg: OpenAiCompatConfig, path: string, body: unknown): Promise<unknown> { // 兼容网关 POST 封装：鉴权、超时、错误与 JSON 解析
  const res = await fetch(`${cfg.baseUrl}${path}`, { // 拼接完整地址（baseUrl 已去尾斜杠）
    method: 'POST', // 生成接口统一使用 POST
    headers: { authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' }, // 标准 Bearer 鉴权头
    body: JSON.stringify(body), // 请求体序列化
    signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS), // 超时中断，避免任务永久停留在 running
  }); // 结束请求参数
  const text = await res.text(); // 先取文本，便于错误信息保留供应商原文
  if (!res.ok) { // 非 2xx 视为失败
    throw new Error(`openai-compatible HTTP ${res.status}: ${text.slice(0, 500)}`); // 截断后抛错，既留线索又不炸日志
  } // 结束状态判断
  try { // 成功响应应可解析为 JSON
    return JSON.parse(text) as unknown; // 成功响应约定为 JSON
  } catch { // 非 JSON 分支
    throw new Error('openai-compatible returned a non-JSON response'); // 非 JSON 视为协议不符，任务失败
  } // 结束 catch
} // 结束 openAiPost

export interface CreateOrchestratorOptions { // 创建编排器的依赖注入参数
  db: Db; // 同步 SQLite 句柄，事务与抢占都依赖它
  storage: StorageAdapter; // 产物落盘适配器（local/s3）
  env: Record<string, string | undefined>; // 环境变量，用于配置提供方与限额
  now?: () => string; // 可注入时钟，便于测试时间相关逻辑
  /** 轮询间隔（毫秒），默认 2000 */
  intervalMs?: number; // 定时器间隔，可被环境变量或调用方覆盖
} // 结束 CreateOrchestratorOptions

export function createOrchestrator(options: CreateOrchestratorOptions): Orchestrator { // 工厂：用闭包持有配置与定时器状态
  const { db, storage, env } = options; // 解构常用依赖
  const clock = options.now ?? (() => new Date().toISOString()); // 未注入则使用系统时间（ISO 字符串）
  const provider = (env.MIM_AI_PROVIDER ?? '').trim().toLowerCase() || 'mock'; // 提供方归一化，未配置默认 mock 保证本地可用
  const openAi = provider === 'openai' ? resolveOpenAiCompat(env) : null; // 仅 openai 提供方需要解析凭证
  const configured = provider === 'mock' || openAi !== null; // mock 天然可用；openai 需凭证齐全
  const supportedTypes = supportedTypesFor(provider); // 缓存支持类型，避免每个任务重复计算
  const jobCostLimitMinor = numberFromEnv(env.MIM_AI_JOB_COST_LIMIT_MINOR, 100000); // 单任务成本上限，默认 1000 元（最小单位）
  const dailyCostLimitMinor = numberFromEnv(env.MIM_AI_DAILY_COST_LIMIT_MINOR, 500000); // 当日累计上限，默认 5000 元
  const assetTtlDays = numberFromEnv(env.MIM_AI_ASSET_TTL_DAYS, 90); // 中间产物默认保留 90 天
  const intervalMs = options.intervalMs ?? numberFromEnv(env.MIM_AI_WORKER_INTERVAL_MS, 2000); // 轮询间隔优先取调用方入参

  let timer: ReturnType<typeof setInterval> | null = null; // 定时器句柄，start/stop 幂等的依据
  let ticking = false; // 重入保护：进程内串行消费，避免重复抢占同一批任务

  function fail(job: JobRow, code: string, message: string): RunResult { // 统一失败回写：置 failed 并记录错误码与说明
    db.prepare( // 仅当仍为 running 时更新，避免覆盖其他 worker 的终态
      `UPDATE generation_jobs SET status = 'failed', error_code = ?, result = ?, finished_at = ?
       WHERE id = ? AND status = 'running'`,
    ).run(code, JSON.stringify({ error: message, provider }), clock(), job.id); // 结果列同时记录 provider 便于归因
    return { job_id: job.id, status: 'failed', provider, error_code: code, message }; // 返回结构化失败结果给调用方
  } // 结束 fail

  function expiresAtFor(jobType: JobType): string | null { // 计算产物的过期时间
    // 成片长期保留（08 §6）；中间产物按保留期过期
    if (jobType === 'compose') return null; // 成片不设过期时间
    const at = new Date(Date.parse(clock()) + assetTtlDays * 86400000); // 当前时间加上保留天数（毫秒）
    return at.toISOString(); // 统一输出 ISO 字符串便于数据库比较
  } // 结束 expiresAtFor

  function bodyFor(jobType: JobType, job: JobRow): { body: Buffer; mime: string } { // mock 提供方按类型生成真实可解码产物
    switch (jobType) { // 分支覆盖全部任务类型
      case 'image': // 图片任务产出真实 PNG
        return { body: Buffer.from(MOCK_PNG_BASE64, 'base64'), mime: 'image/png' }; // 1×1 PNG，可被浏览器真实渲染
      case 'tts': // 语音任务产出可播放音频
        return { body: mockWav(), mime: 'audio/wav' }; // 现场生成的静音 WAV，播放器可解码
      case 'video': // 视频任务不伪造二进制
        return { // 返回结构化清单
          body: manifestOf(job, 'mock provider does not fabricate binary video; manifest returned instead'), // 不伪造视频字节，只返回清单
          mime: 'application/json', // 清单以 JSON 存储
        }; // 结束 video 分支返回值
      case 'compose': // 合成任务需真实渲染器
        return { // 返回结构化清单
          body: manifestOf(job, 'mock compose returns a manifest; connect a real renderer to emit MP4'), // 合成需真实渲染器，mock 只给清单
          mime: 'application/json', // 清单以 JSON 存储
        }; // 结束 compose 分支返回值
      case 'text': // 文本任务
      default: // 兜底分支，保证函数总有返回值
        return { body: manifestOf(job, 'mock text generation returns a structured manifest'), mime: 'application/json' }; // 文本同样以结构化清单落盘
    } // 结束 switch
  } // 结束 bodyFor

  /** 真实提供方产出：openai 兼容协议，text → chat/completions，image → images/generations */
  async function produceWithOpenAi(
    cfg: OpenAiCompatConfig, // 已解析的兼容网关配置
    jobType: JobType, // 已校验为 text/image 的任务类型
    job: JobRow, // 任务行，用于提取提示词与回填元数据
  ): Promise<{ body: Buffer; mime: string }> { // 返回真实模型产出的字节与 MIME
    const prompt = promptOf(job); // 统一提取提示词
    if (jobType === 'text') { // 文本任务分支
      const data = (await openAiPost(cfg, '/chat/completions', { // 文本任务走 chat completions
        model: cfg.textModel, // 使用配置的文本模型
        messages: [ // 消息数组：系统角色 + 用户提示词
          { role: 'system', content: '你是 Mim 漫剧工坊的创作模型，按用户要求产出可直接使用的文本内容。' }, // 系统提示词固定角色设定
          { role: 'user', content: prompt }, // 用户提示词来自任务 payload
        ], // 结束消息数组
      })) as { choices?: Array<{ message?: { content?: unknown } }>; usage?: unknown }; // 仅取需要的字段，避免依赖完整响应结构
      const content = data.choices?.[0]?.message?.content; // 取首条候选的文本内容
      if (typeof content !== 'string' || !content.trim()) { // 空内容视为异常
        throw new Error('openai-compatible chat completion returned empty content'); // 空内容视为异常，不落空产物
      } // 结束空内容判断
      return { // 返回文本产物
        body: Buffer.from( // 将产物与元数据统一序列化为 JSON 字节
          JSON.stringify( // 序列化清单
            { // 文本产物结构
              provider, // 标注真实提供方
              model: cfg.textModel, // 记录模型版本，便于复现
              job_id: job.id, // 回填任务 ID
              job_type: job.job_type, // 回填任务类型
              project_id: job.project_id, // 回填工程 ID
              storyboard_id: job.storyboard_id, // 回填分镜 ID（可空）
              content, // 模型返回的正文
              usage: data.usage ?? null, // 用量信息用于成本核算，缺失时为 null
            }, // 结束文本产物结构
            null, // 不使用 replacer
            2, // 两空格缩进
          ), // 结束序列化
          'utf8', // 显式 UTF-8，避免中文乱码
        ), // 结束 Buffer 构造
        mime: 'application/json', // 文本产物统一 JSON
      }; // 结束文本产物返回
    } // 结束文本任务分支
    // image：优先 b64_json；部分网关仅回 url 则回源拉取字节
    const data = (await openAiPost(cfg, '/images/generations', { // 图片任务走 images generations
      model: cfg.imageModel, // 使用配置的图片模型
      prompt, // 用户提示词
      n: 1, // 单图任务只取一张，控制成本
      size: '1024x1024', // 固定方形尺寸，前端展示无需裁剪
      response_format: 'b64_json', // 优先要求 base64，避免二次外网请求
    })) as { data?: Array<{ b64_json?: string; url?: string }> }; // 兼容仅回 url 的网关实现
    const first = data.data?.[0]; // 取第一张结果
    if (first?.b64_json) { // 网关直接回 base64
      return { body: Buffer.from(first.b64_json, 'base64'), mime: 'image/png' }; // 直接解码为字节落盘
    } // 结束 base64 分支
    if (first?.url) { // 网关只回 url
      const img = await fetch(first.url, { signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS) }); // 回源拉取图片字节
      if (!img.ok) throw new Error(`openai-compatible image fetch HTTP ${img.status}`); // 拉取失败即任务失败，不落残缺产物
      return { body: Buffer.from(await img.arrayBuffer()), mime: 'image/png' }; // 以字节形式写入对象存储
    } // 结束 url 分支
    throw new Error('openai-compatible images response missing b64_json/url'); // 两种字段都缺失说明协议不符
  } // 结束 produceWithOpenAi

  async function execute(job: JobRow): Promise<RunResult> { // 单任务执行主流程：校验 → 限额 → 生产 → 落盘 → 事务回写
    const jobType = JOB_TYPES.find((value) => value === job.job_type); // 将数据库字符串收敛为白名单类型
    if (!jobType) return fail(job, 'VALIDATION_FAILED', `unsupported job_type: ${job.job_type}`); // 未知类型直接失败，避免误处理

    const cost = job.cost_estimate_minor ?? 0; // 缺省成本按 0 计，兼容未估价的 mock 任务
    if (jobCostLimitMinor > 0 && cost > jobCostLimitMinor) { // 单任务限额判定（0 表示不限制）
      return fail(job, 'COST_LIMIT_EXCEEDED', `job cost ${cost} exceeds limit ${jobCostLimitMinor}`); // 单任务超限即拒绝，防止单点烧钱
    } // 结束单任务限额判断
    if (dailyCostLimitMinor > 0) { // 当日限额启用时才统计
      const dayStart = `${clock().slice(0, 10)}T00:00:00.000Z`; // 取当天 UTC 零点作为统计窗口起点
      const row = db // 当日成本汇总查询起点
        .prepare( // 预编译汇总语句
          `SELECT COALESCE(SUM(cost_estimate_minor), 0) AS total FROM generation_jobs
           WHERE status = 'succeeded' AND created_at >= ?`,
        ) // 结束预编译
        .get(dayStart) as { total: number }; // 汇总当日已成功任务的成本
      if ((row?.total ?? 0) + cost > dailyCostLimitMinor) { // 累计加本单后超限
        return fail(job, 'COST_LIMIT_EXCEEDED', `daily cost exceeds limit ${dailyCostLimitMinor}`); // 当日累计超限即拒绝
      } // 结束当日限额判断
    } // 结束当日限额统计

    if (!supportedTypes.includes(jobType)) { // 提供方不支持该任务类型
      return fail( // 诚实地失败，而不是伪造产物
        job, // 当前任务
        'PROVIDER_NOT_CONFIGURED', // 复用同一错误码，前端可据此提示「提供方不支持该类型」
        `provider "${provider}" does not support job_type "${jobType}"`, // 明确说明是能力缺失而非系统错误
      ); // 结束失败返回
    } // 结束能力校验
    if (!configured) { // 凭证缺失
      return fail(job, 'PROVIDER_NOT_CONFIGURED', `provider "${provider}" is not configured`); // 凭证缺失时诚实失败，不伪造产物
    } // 结束配置校验

    const { body, mime } =
      provider === 'mock' ? bodyFor(jobType, job) : await produceWithOpenAi(openAi!, jobType, job); // 按提供方分派到 mock 或真实模型
    const assetType = ASSET_TYPE_BY_JOB[jobType]; // 映射产物类型
    const objectKey = `${job.created_by}/${job.project_id}/${job.id}-${assetType}${extensionForMime(mime)}`; // 按用户/工程/任务分层，避免键冲突
    const stored = await storage.putObject(objectKey, body, mime); // 真实落盘，返回大小与摘要
    const checksum = stored.checksum || checksumOf(body); // 适配器未给摘要时本地兜底计算
    const assetId = uuidv7(); // 预生成产物 ID，供事务内一次性写入
    const now = clock(); // 单次取时，保证事务内时间一致

    const finish = db.transaction(() => { // 产物与任务状态必须同时生效，避免出现「有产物但任务未成功」
      db.prepare( // 写入产物记录
        `INSERT INTO generation_assets
           (id, job_id, project_id, asset_type, object_key, mime, duration_ms, size_bytes, checksum, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run( // 逐项绑定产物字段
        assetId, // 产物主键
        job.id, // 关联任务
        job.project_id, // 关联工程
        assetType, // 产物类型
        objectKey, // 对象存储键
        mime, // 内容类型
        jobType === 'tts' ? 500 : null, // mock WAV 固定 500ms，其余类型不填时长
        stored.size_bytes, // 实际写入字节数
        checksum, // 摘要，便于前端校验完整性
        expiresAtFor(jobType), // 过期时间（成片为 null 即永久）
        now, // 创建时间
      ); // 结束产物写入
      db.prepare( // 回写任务终态
        `UPDATE generation_jobs SET status = 'succeeded', result = ?, finished_at = ?
         WHERE id = ? AND status = 'running'`,
      ).run( // 绑定结果 JSON 与完成时间
        JSON.stringify({
          provider, // 结果内记录提供方
          asset_id: assetId, // 便于前端直接跳转产物
          object_key: objectKey, // 便于前端直接下载
          mime, // 内容类型
          size_bytes: stored.size_bytes, // 产物大小
          checksum, // 完整性摘要
        }), // 结束结果序列化
        now, // 完成时间
        job.id, // 目标任务
      ); // 结束任务终态回写
      // compose 成功 → 工程 generating → rendered（08 §3.2 联动）
      if (jobType === 'compose') { // 仅合成任务需要推进工程状态
        db.prepare( // 推进工程状态
          `UPDATE comic_projects SET status = 'rendered', updated_at = ?
           WHERE id = ? AND status = 'generating'`,
        ).run(now, job.project_id); // 仅当工程仍在 generating 时推进，避免覆盖人工操作
      } // 结束工程状态联动
    }); // 结束事务定义
    finish(); // 执行事务

    return { job_id: job.id, status: 'succeeded', provider, asset_id: assetId, object_key: objectKey }; // 返回成功结果
  } // 结束 execute

  async function runOne(jobId: string): Promise<RunResult | null> { // 精确执行指定任务
    const job = db.prepare('SELECT * FROM generation_jobs WHERE id = ?').get(jobId) as JobRow | undefined; // 读取任务全字段
    if (!job) throw new AppError('NOT_FOUND', 'generation job not found', { job_id: jobId }); // 不存在则视为调用方错误
    if (job.status !== 'queued') { // 非 queued 不重复执行
      return { job_id: job.id, status: 'skipped', provider, message: `job is ${job.status}`, error_code: undefined }; // 直接返回跳过
    } // 结束状态判断

    const claimed = db // 原子抢占起点
      .prepare( // 预编译条件更新
        `UPDATE generation_jobs SET status = 'running', started_at = ?
         WHERE id = ? AND status = 'queued'`,
      ) // 结束预编译
      .run(clock(), job.id); // 条件更新实现原子抢占，天然支持多 worker 竞争
    if (claimed.changes === 0) { // 影响行数为 0 说明已被抢占
      return { job_id: job.id, status: 'skipped', provider, message: 'job was claimed by another worker' }; // 抢占失败说明已被他人处理
    } // 结束抢占判断

    try { // 执行阶段可能抛出业务或网络错误
      return await execute({ ...job, status: 'running' }); // 传入更新后的状态，保证后续逻辑读到一致值
    } catch (err) { // 任何异常都要回写失败，避免任务卡死
      const code = err instanceof AppError ? err.code : 'INTERNAL_ERROR'; // 业务错误沿用自身码，其余归为内部错误
      const message = err instanceof Error ? err.message : String(err); // 兜底把非 Error 抛出物转成字符串
      return fail(job, code, message); // 统一回写失败状态，避免任务卡在 running
    } // 结束异常处理
  } // 结束 runOne

  async function tick(limit = 5): Promise<RunResult[]> { // 批量消费：默认一次最多 5 个任务
    if (ticking) return []; // 已有批次在执行则直接返回，避免并发重复抢占
    ticking = true; // 标记进入批次
    try { // 批次主体，finally 保证释放标记
      const rows = db // 候选任务查询起点
        .prepare( // 预编译：按入队时间取一批
          `SELECT id FROM generation_jobs WHERE status = 'queued'
           ORDER BY created_at LIMIT ?`,
        ) // 结束预编译
        .all(limit) as Array<{ id: string }>; // 按入队时间先进先出取一批候选
      const results: RunResult[] = []; // 汇总本批结果
      for (const row of rows) { // 逐个串行执行
        const result = await runOne(row.id); // 逐个串行执行，避免同时打满外部模型配额
        if (result) results.push(result); // 收集非空结果
      } // 结束遍历
      return results; // 返回本批执行结果
    } finally { // 无论成功失败都释放批次标记
      ticking = false; // 无论如何都释放批次标记
    } // 结束 finally
  } // 结束 tick

  function capabilities(): Record<string, unknown> { // 自述能力，供运维与前端探测
    return { // 能力清单
      provider, // 当前提供方
      provider_configured: configured, // 是否已具备可用凭证
      mock_provider: provider === 'mock', // 便于前端提示「当前为 mock 产物」
      supported_job_types: [...supportedTypes], // 展开为普通数组，避免 JSON 序列化 readonly 类型
      ...(provider === 'openai' // 仅 openai 提供方追加网关信息
        ? { // openai 专属字段
            base_url: openAi?.baseUrl ?? null, // 透出网关地址便于排查
            text_model: openAi?.textModel ?? null, // 透出文本模型名
            image_model: openAi?.imageModel ?? null, // 透出图片模型名
          } // 结束 openai 专属字段
        : {}), // 非 openai 提供方不追加这些字段
      job_cost_limit_minor: jobCostLimitMinor, // 单任务限额
      daily_cost_limit_minor: dailyCostLimitMinor, // 当日限额
      asset_ttl_days: assetTtlDays, // 产物保留天数
      storage: { driver: storage.driver, configured: storage.configured }, // 存储驱动状态，便于确认产物落点
      worker_enabled: (env.MIM_AI_WORKER ?? '1') !== '0', // 显式 '0' 才视为关闭 worker
      worker_interval_ms: intervalMs, // 实际轮询间隔
    }; // 结束能力清单
  } // 结束 capabilities

  return { // 返回编排器实例
    provider, // 对外暴露提供方
    configured, // 对外暴露是否配置完成
    jobCostLimitMinor, // 对外暴露单任务限额
    dailyCostLimitMinor, // 对外暴露当日限额
    assetTtlDays, // 对外暴露保留天数
    capabilities, // 能力自述
    tick, // 批量消费入口
    runOne, // 单任务入口
    start() { // 启动定时轮询（幂等）
      if (timer) return; // 已启动则不重复创建定时器
      timer = setInterval(() => { // 按间隔触发一批消费
        void tick().catch((err) => console.error('[ai-orchestrator] tick failed', err)); // 单批异常只记录日志，不中断定时器
      }, intervalMs); // 绑定轮询间隔
      if (typeof timer.unref === 'function') timer.unref(); // 不阻止进程退出，便于测试与优雅停机
    }, // 结束 start
    stop() { // 停止定时轮询
      if (timer) clearInterval(timer); // 清理定时器
      timer = null; // 复位句柄，使 start 可再次生效
    }, // 结束 stop
  }; // 结束实例对象
} // 结束 createOrchestrator
