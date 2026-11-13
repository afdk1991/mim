/**
 * 第 1 期：AI 辅助创作工作台（07 §12.1、08 §3.2）
 * 第 2 期：生成任务编排（generation_jobs）+ 成片合成（comic_films / film_versions）路由骨架
 *
 * 交付物是「创作工程」而非成片：
 * 剧本 / 分镜 / 角色设定 / 对白 / 配音均由 AI 建议，人工确认后再导出素材。
 * 第 2 期落地状态机与编排控制面；真实模型调用与队列消费（ai-orchestrator）、
 * 对象存储预签名（media 域 /media/presign/*）后续接入，骨架不伪造外部产物。
 */

import { Router } from 'express'; // 路由工厂：把漫剧工作台做成可独立挂载的子路由
import { z } from 'zod'; // 入参校验：所有写接口的字段类型 / 长度 / 枚举都集中在此声明
import { AppError, uuidv7 } from '@mim/core-domain'; // 统一错误码与时间有序主键生成器
import type { ErrorCode } from '@mim/core-domain'; // 错误码联合类型，用于编排器回传错误码的类型收窄
import { clockOf } from '../domain.js'; // 注入式时钟：测试可固定时间，保证 created_at 可断言
import { idempotency, requireAuth, requireEntitlement } from '../middleware.js'; // 幂等键拦截 + 登录态 + 模块权益三件套
import { parse } from '../validate.js'; // 把裸入参交给 zod 解析，失败统一转 VALIDATION_FAILED
import { jsonParse, pathParam } from '../utils.js'; // JSON 列反序列化兜底与路径参数取值
import type { ApiDeps, Db } from '../types.js'; // 依赖注入容器类型与 SQLite 句柄类型（仅类型导入，不产生运行时依赖）
// 导出成片转码所需的 Node 内置模块（与 orchestrator 一致，避免引入第三方转码依赖）
import { spawnSync } from 'node:child_process'; // 同步调用 ffmpeg，导出链路为请求内完成
import { tmpdir } from 'node:os'; // 临时目录，转码中间产物落盘后即删
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'; // 临时文件读写与清理
import { join } from 'node:path'; // 路径拼接
import { randomBytes } from 'node:crypto'; // 临时目录名随机化，避免并发冲突

/** 工作台的解锁模块编码（与 db.ts seedModules 保持一致） */
const MODULE_CODE = 'comic.workbench'; // 未购买该模块的用户访问 /comic/* 会被权益中间件拦下

/** 允许写入分镜 / 角色的项目状态；进入生成态后内容冻结 */
const EDITABLE_STATUSES = new Set(['draft', 'storyboarded']); // 生成中/已出片/已发布/归档一律拒绝改动，防止剧本与产物不一致

const PROJECT_STATUSES = [ // 工程状态机全部合法取值，同时供 z.enum 与校验复用
  'draft', // 草稿：只建了工程与简介，还没分镜
  'storyboarded', // 分镜已确认：可以派发生成任务
  'generating', // 生成中：内容冻结，任务排队或执行
  'rendered', // 已合成：允许创建成片记录
  'published', // 已发布：成片对外可见
  'archived', // 归档：只读终态
] as const; // as const 让 z.enum 能拿到字面量联合类型

interface ProjectRow { // 工程表 comic_projects 的行结构
  id: string; // 工程主键（UUIDv7，天然按时间有序）
  owner_user_id: string; // 归属用户，跨用户访问一律 404
  region: string; // 数据分区/地域，创建时取自登录用户
  title: string; // 工程标题，导出与列表展示用
  synopsis: string | null; // 故事简介，可作为 AI 建议的主题来源
  status: string; // 状态机当前值，见 PROJECT_STATUSES
  version: number; // 乐观锁版本号，每次写操作 +1
  created_at: string; // 创建时间（ISO 字符串）
  updated_at: string; // 最近更新时间，用于列表排序与并发判定
  deleted_at: string | null; // 软删除标记，非空即视为已删除
} // 工程行结构结束

interface CharacterRow { // 角色表 comic_characters 的行结构
  id: string; // 角色主键
  project_id: string; // 所属工程
  name: string; // 角色名，同名即视为同一角色（upsert 依据）
  appearance_prompt: string; // 外观提示词，生成图像时复用
  seed: number | null; // 随机种子，保证同一角色多次出图风格稳定
  reference_asset_ids: string; // 参考图资产 ID 的 JSON 数组（文本列存储）
  voice_profile: string | null; // 音色描述，供 TTS 任务使用
  version: number; // 角色设定的版本号，便于前端感知变更
  created_at: string; // 创建时间
  updated_at: string; // 更新时间
  deleted_at: string | null; // 软删除标记，随工程一并删除
} // 角色行结构结束

interface StoryboardRow { // 分镜版本表 storyboards 的行结构
  id: string; // 分镜版本主键
  project_id: string; // 所属工程
  version_no: number; // 分镜版本序号，每次提交 +1，历史不可覆盖
  shots: string; // 镜头数组的 JSON 文本
  confirmed_at: string | null; // 人工确认时间，非空表示已锁定可派发任务
  created_by: string; // 提交人用户 ID
  created_at: string; // 提交时间
} // 分镜行结构结束

/** 第 2 期：生成任务编排（08 §3.2：queued → running → succeeded/failed/canceled 单向） */
const JOB_TYPES = ['text', 'image', 'video', 'tts', 'compose'] as const; // 五类生成任务：文本/图像/视频/配音/合成
const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'canceled'] as const; // 任务状态机取值，只允许单向流转

/** 第 2 期：成片（draft → reviewing → published → archived；驳回回到 draft 留原因） */
const FILM_STATUSES = ['draft', 'reviewing', 'published', 'archived'] as const; // 成片状态机取值

interface JobRow { // 生成任务表 generation_jobs 的行结构
  id: string; // 任务主键
  project_id: string; // 所属工程，权限判定经此字段回溯
  storyboard_id: string | null; // 关联分镜版本，纯文本类任务可为空
  job_type: string; // 任务类型，见 JOB_TYPES
  status: string; // 任务状态，见 JOB_STATUSES
  retry_of: string | null; // 重试来源任务 ID，构成可追溯的重试链
  cost_estimate_minor: number | null; // 预估成本（最小货币单位），用于额度预占展示
  error_code: string | null; // 失败原因码，成功任务为 null
  payload: string; // 任务入参 JSON 文本
  result: string | null; // 任务产出 JSON 文本，未完成时为 null
  created_by: string; // 派发人用户 ID
  created_at: string; // 入队时间
  started_at: string | null; // 开始执行时间，queued 时为 null
  finished_at: string | null; // 结束时间（成功/失败/取消共用）
} // 任务行结构结束

interface FilmRow { // 成片表 comic_films 的行结构
  id: string; // 成片主键
  project_id: string; // 所属工程
  title: string; // 成片标题
  status: string; // 成片状态，见 FILM_STATUSES
  current_version_id: string | null; // 当前对外版本，发布时指向最新版本
  review_note: string | null; // 驳回原因，发布后清空
  version: number; // 乐观锁版本号
  created_at: string; // 创建时间
  updated_at: string; // 更新时间
  deleted_at: string | null; // 软删除标记
} // 成片行结构结束

interface FilmVersionRow { // 成片版本表 film_versions 的行结构
  id: string; // 版本主键
  film_id: string; // 所属成片
  version_no: number; // 版本序号，只追加不覆盖
  object_key: string | null; // 对象存储键，未上传产物时为 null（此时不可提交审核）
  duration_sec: number | null; // 时长（秒），用于列表展示
  size_bytes: number | null; // 文件体积（字节），用于额度统计
  published_at: string | null; // 该版本被发布的时间
  created_by: string; // 上传人用户 ID
  created_at: string; // 上传时间
} // 成片版本行结构结束

function projectPayload(row: ProjectRow) { // 把工程行裁剪成对外契约对象
  return { // 逐字段映射，过滤内部字段
    id: row.id, // 对外主键
    region: row.region, // 地域，前端用于就近选择素材站
    title: row.title, // 标题
    synopsis: row.synopsis, // 简介
    status: row.status, // 状态机当前值，前端据此渲染可操作按钮
    version: row.version, // 乐观锁版本，PATCH 时必须回传
    created_at: row.created_at, // 创建时间
    updated_at: row.updated_at, // 更新时间
  }; // 只暴露契约字段，owner_user_id / deleted_at 不外泄
} // 工程视图组装结束

function characterPayload(row: CharacterRow) { // 角色行 → 对外视图
  return { // 逐字段映射并解析 JSON 列
    id: row.id, // 角色主键
    name: row.name, // 角色名
    appearance_prompt: row.appearance_prompt, // 外观提示词
    seed: row.seed, // 随机种子
    reference_asset_ids: jsonParse<string[]>(row.reference_asset_ids) ?? [], // JSON 文本转数组，坏数据退化为空数组
    voice_profile: row.voice_profile, // 音色描述
    version: row.version, // 设定版本号
    created_at: row.created_at, // 创建时间
    updated_at: row.updated_at, // 更新时间
  }; // 不返回 project_id，调用方已由 URL 上下文确定工程
} // 角色视图组装结束

function storyboardPayload(row: StoryboardRow) { // 分镜行 → 对外视图
  return { // 映射分镜字段
    id: row.id, // 分镜版本主键
    version_no: row.version_no, // 版本序号，前端用于提示「第 N 版」
    shots: jsonParse<unknown[]>(row.shots) ?? [], // 镜头 JSON 文本转数组，坏数据退化为空
    confirmed_at: row.confirmed_at, // 确认时间，null 表示仍是草稿分镜
    created_by: row.created_by, // 提交人
    created_at: row.created_at, // 提交时间
  }; // 不返回 project_id，避免冗余
} // 分镜视图组装结束

function jobPayload(row: JobRow) { // 任务行 → 对外视图
  return { // 映射任务字段并解析 JSON 列
    id: row.id, // 任务主键
    project_id: row.project_id, // 所属工程
    storyboard_id: row.storyboard_id, // 关联分镜版本
    job_type: row.job_type, // 任务类型
    status: row.status, // 任务状态，前端据此决定轮询或展示结果
    retry_of: row.retry_of, // 重试链上游任务
    cost_estimate_minor: row.cost_estimate_minor, // 预估成本
    error_code: row.error_code, // 失败原因码
    payload: jsonParse<Record<string, unknown>>(row.payload) ?? {}, // 入参 JSON 文本转对象，坏数据退化为空对象
    result: row.result ? jsonParse<Record<string, unknown>>(row.result) : null, // 仅完成的任务才解析产出
    created_by: row.created_by, // 派发人
    created_at: row.created_at, // 入队时间
    started_at: row.started_at, // 开始时间
    finished_at: row.finished_at, // 结束时间
  }; // 对外任务视图
} // 任务视图组装结束

function filmPayload(row: FilmRow) { // 成片行 → 对外视图
  return { // 映射成片字段
    id: row.id, // 成片主键
    project_id: row.project_id, // 所属工程
    title: row.title, // 成片标题
    status: row.status, // 成片状态
    current_version_id: row.current_version_id, // 当前对外版本 ID
    review_note: row.review_note, // 驳回原因
    version: row.version, // 乐观锁版本
    created_at: row.created_at, // 创建时间
    updated_at: row.updated_at, // 更新时间
  }; // 不返回 deleted_at，已删除记录本就不会被查到
} // 成片视图组装结束

function filmVersionPayload(row: FilmVersionRow) { // 成片版本行 → 对外视图
  return { // 映射版本字段
    id: row.id, // 版本主键
    film_id: row.film_id, // 所属成片
    version_no: row.version_no, // 版本序号
    object_key: row.object_key, // 对象存储键，前端据此申请下载签名
    duration_sec: row.duration_sec, // 时长（秒）
    size_bytes: row.size_bytes, // 体积（字节）
    published_at: row.published_at, // 该版本的发布时间
    created_by: row.created_by, // 上传人
    created_at: row.created_at, // 上传时间
  }; // 对外版本视图
} // 版本视图组装结束

/** 只允许操作「本人 + 未删除」的创作工程；跨用户与不存在一律 404，不泄漏存在性 */
function findProject(db: Db, userId: string, projectId: string): ProjectRow { // 工程归属校验，所有工程级接口的第一道闸门
  const row = db // better-sqlite3 风格同步句柄
    .prepare( // 预编译 SQL，参数化绑定以杜绝注入
      `SELECT * FROM comic_projects
       WHERE id = ? AND owner_user_id = ? AND deleted_at IS NULL`, // 三重条件：主键 + 归属 + 未删除
    ) // 预编译结束
    .get(projectId, userId) as ProjectRow | undefined; // 单行查询，未命中返回 undefined
  if (!row) throw new AppError('NOT_FOUND', 'comic project not found', { project_id: projectId }); // 统一 404，不区分「不存在」与「他人的工程」
  return row; // 返回完整行，调用方可读 status / version
} // 工程查询函数结束

/** 任务经工程判定归属：跨用户 / 已删除工程 / 不存在一律 404，不泄漏存在性 */
function findJob(db: Db, userId: string, jobId: string): JobRow { // 任务归属校验，需回溯到工程所有者
  const row = db // 复用同一 db 句柄
    .prepare( // 任务表需要 JOIN 工程表才能拿到归属
      `SELECT j.* FROM generation_jobs j
       JOIN comic_projects p ON p.id = j.project_id
       WHERE j.id = ? AND p.owner_user_id = ? AND p.deleted_at IS NULL`, // 权限判定落在工程归属上
    ) // 预编译结束
    .get(jobId, userId) as JobRow | undefined; // 未命中即视为不可见
  if (!row) throw new AppError('NOT_FOUND', 'generation job not found', { job_id: jobId }); // 越权与不存在同样返回 404
  return row; // 返回任务行，供状态机校验
} // 任务查询函数结束

/** 成片同样经工程判定归属，规则与 findJob 一致 */
function findFilm(db: Db, userId: string, filmId: string): FilmRow { // 成片归属校验，避免跨用户操作他人成片
  const row = db // 同一连接执行
    .prepare( // 成片表 JOIN 工程表做归属校验
      `SELECT f.* FROM comic_films f
       JOIN comic_projects p ON p.id = f.project_id
       WHERE f.id = ? AND p.owner_user_id = ? AND p.deleted_at IS NULL AND f.deleted_at IS NULL`, // 工程与成片都需未删除
    ) // 预编译结束
    .get(filmId, userId) as FilmRow | undefined; // 单行结果
  if (!row) throw new AppError('NOT_FOUND', 'comic film not found', { film_id: filmId }); // 不泄漏成片是否存在
  return row; // 供后续状态迁移使用
} // 成片查询函数结束

/** 全自动流水线专用：写入任务并同步执行，返回产物键。失败抛 AppError 中断链路 */
async function runAutoJob( // 建任务 + 编排器执行 + 取结果，统一封装避免各环节重复样板
  db: Db, // 数据库句柄
  orch: NonNullable<ApiDeps['orchestrator']>, // 编排器实例（已校验非空）
  projectId: string, // 所属工程
  storyboardId: string | null, // 关联分镜，可空
  jobType: 'text' | 'image' | 'tts' | 'video' | 'compose', // 任务类型
  payload: Record<string, unknown>, // 任务入参
  userId: string, // 发起人
  now: string, // 统一时间戳
): Promise<{ object_key: string | null; asset_id: string | null }> { // 返回产物键与资产 ID
  const id = uuidv7(); // 任务主键
  db // 写入排队中的任务
    .prepare( // 预编译任务插入
      `INSERT INTO generation_jobs
         (id, project_id, storyboard_id, job_type, status, retry_of, cost_estimate_minor,
          error_code, payload, result, created_by, created_at, started_at, finished_at)
       VALUES (?, ?, ?, ?, 'queued', NULL, NULL, NULL, ?, NULL, ?, ?, NULL, NULL)`, // 新任务固定 queued，结果与错误留空
    ) // 预编译结束
    .run(id, projectId, storyboardId, jobType, JSON.stringify(payload), userId, now); // 绑定任务字段
  const result = await orch.runOne(id); // 同步执行该任务（真实模型下可能耗时数秒到数十秒）
  if (!result) throw new AppError('INTERNAL_ERROR', 'orchestrator did not return a result', { job_id: id }); // 编排器未返回结果属内部异常
  if (result.status === 'failed') { // 任务失败则中断整条自动链路
    throw new AppError((result.error_code as ErrorCode) ?? 'GENERATION_FAILED', result.message ?? 'generation task failed', { // 透传模型侧错误码与消息；error_code 来自编排器，强转为 ErrorCode 以适配构造函数
      job_id: id, // 附任务 ID 便于排查
      job_type: jobType, // 附任务类型定位失败环节
    }); // 失败错误体结束
  } // 失败分支结束
  return { object_key: result.object_key ?? null, asset_id: result.asset_id ?? null }; // 成功返回产物键
} // runAutoJob 结束

/** 从文本任务的产物键读取剧本文本：编排器把文本内容存为 text 资产 */
async function extractTextFromResult( // 读取存储中的文本资产，供后续拆分为镜
  storage: NonNullable<ApiDeps['storage']>, // 存储适配器
  objectKey: string | null, // 文本资产键
): Promise<string> { // 返回 UTF-8 解码后的文本
  if (!objectKey) return ''; // 无键则返回空串，由调用方兜底
  const asset = await storage.getObject(objectKey); // 从对象存储读取原始字节
  return asset.body.toString('utf-8'); // 文本资产按 UTF-8 解码
} // extractTextFromResult 结束

interface AutoShot { // 自动拆分出的分镜结构，与 shotSchema 对齐
  index: number; // 镜头序号
  description: string; // 画面描述
  dialogue?: string; // 台词（可空）
} // AutoShot 结束

/** 把模型输出的剧本文本拆成 N 个分镜；解析不足时按标题生成兜底镜头 */
function parseScriptToShots(script: string, expected: number, title: string): AutoShot[] { // 按【分镜N】标记拆分
  const shots: AutoShot[] = []; // 累积解析出的镜头
  const blocks = script.split(/【分镜\d+】/).map((b) => b.trim()).filter(Boolean); // 按【分镜N】切块并去空白
  for (let i = 0; i < blocks.length; i++) { // 逐块提取画面与台词
    const block = blocks[i]; // 当前分镜文本块
    const descMatch = block.match(/【画面】\s*([^\n]+)/); // 抓取【画面】后的描述（到行尾）
    const dialMatch = block.match(/【台词】\s*([^\n]+)/); // 抓取【台词】后的对白（到行尾）
    const description = descMatch?.[1]?.trim() || block.split('\n')[0]?.trim() || `${title} 第 ${i + 1} 镜`; // 无画面标记则取首行，再不行用标题兜底
    const dialogue = dialMatch?.[1]?.trim(); // 台词可为空
    shots.push({ index: i + 1, description, dialogue: dialogue || undefined }); // 推入镜头列表
  } // 分镜块循环结束
  if (shots.length < expected) { // 解析出的镜头数不足期望值
    for (let i = shots.length; i < expected; i++) { // 用标题兜底补齐到 expected 个
      shots.push({ index: i + 1, description: `${title} 第 ${i + 1} 镜：承接剧情推进`, dialogue: undefined }); // 兜底镜头无台词
    } // 补齐循环结束
  } // 不足兜底结束
  return shots.slice(0, expected); // 截取期望数量，避免模型多输出导致失控
} // parseScriptToShots 结束

/** 导出转码：用 ffmpeg 把原片转为指定格式/分辨率，存为新对象并返回键 */
async function transcodeVideo( // 封装 ffmpeg 转码 + 存储写入，导出接口专用
  storage: NonNullable<ApiDeps['storage']>, // 存储适配器，回读原片与写入转码产物
  ffmpegBin: string, // ffmpeg 可执行文件路径（已校验非空）
  sourceKey: string, // 原片对象键
  format: 'mp4' | 'mov', // 目标格式
  resolution: '720p' | '1080p', // 目标分辨率（高度）
): Promise<string> { // 返回转码产物的对象键
  const tmpDir = join(tmpdir(), `mim-export-${randomBytes(8).toString('hex')}`); // 临时目录名随机化，避免并发冲突
  mkdirSync(tmpDir, { recursive: true }); // 创建临时目录，recursive 容忍已存在
  const sourcePath = join(tmpDir, `source.${format === 'mov' ? 'mp4' : 'mp4'}`); // 原片临时路径（compose 产物为 mp4）
  const outputPath = join(tmpDir, `output.${format}`); // 转码输出临时路径，扩展名决定容器格式
  try { // try/finally 保证临时目录一定被清理
    const sourceAsset = await storage.getObject(sourceKey); // 从存储回读原片字节
    writeFileSync(sourcePath, sourceAsset.body); // 写入临时文件供 ffmpeg 读取

    const height = resolution === '1080p' ? 1920 : 1280; // 竖版视频：1080p→1920 高，720p→1280 高
    const width = resolution === '1080p' ? 1080 : 720; // 对应宽度，保持 9:16 竖版比例
    const vf = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`; // 缩放并居中填充，避免拉伸变形

    const result = spawnSync(ffmpegBin, [ // 同步执行 ffmpeg
      '-y', // 覆盖已存在的输出文件
      '-i', sourcePath, // 输入原片
      '-vf', vf, // 视频滤镜：缩放+填充
      '-c:v', 'libx264', // 视频编码 H.264，兼容性最好
      '-c:a', 'aac', // 音频编码 AAC
      '-b:a', '128k', // 音频码率 128kbps
      '-movflags', '+faststart', // moov 前置，便于流式播放
      outputPath, // 输出路径
    ], { stdio: 'pipe' }); // 捕获 stderr 用于报错排查
    if (result.status !== 0) { // ffmpeg 非零退出表示转码失败
      const stderr = result.stderr?.toString('utf-8') ?? ''; // 取 stderr 尾部用于定位
      throw new AppError('GENERATION_FAILED', 'video transcoding failed', { // 502 标识上游工具失败
        detail: stderr.slice(-500), // 只回传最后 500 字符，避免日志过长
      }); // 错误体结束
    } // ffmpeg 退出码判断结束

    const outputBuffer = readFileSync(outputPath); // 读取转码产物字节
    const mime = format === 'mov' ? 'video/quicktime' : 'video/mp4'; // 输出 MIME 按容器格式
    const exportKey = `exports/${sourceKey.split('/').pop()?.replace(/\.[^.]+$/, '')}-${resolution}.${format}`; // 导出对象键：exports/原文件名-分辨率.格式
    await storage.putObject(exportKey, outputBuffer, mime); // 写入转码产物到存储
    return exportKey; // 返回新对象键供预签名下载使用
  } finally { // 无论成功失败都清理临时目录
    rmSync(tmpDir, { recursive: true, force: true }); // 递归删除临时目录，force 容忍不存在
  } // finally 结束
} // transcodeVideo 结束

const createBody = z.object({ // 创建工程入参 schema
  title: z.string().trim().min(1).max(120), // 工程标题：去空白后 1~120 字，必填
  synopsis: z.string().max(4000).optional(), // 简介：≤4000 字，可省略（后续作为 AI 主题来源）
}); // 创建工程只允许这两个业务字段，其余由服务端生成

const updateBody = z // 更新工程入参 schema（带跨字段约束）
  .object({ // 先声明三个可选字段
    title: z.string().trim().min(1).max(120).optional(), // 新标题，可选；长度上限防超长入库
    synopsis: z.string().max(4000).nullable().optional(), // 简介可显式传 null 表示清空
    version: z.number().int().positive(), // 乐观锁版本号，必须回传当前值
  }) // 三个字段的宽松组合，交给 refine 约束「至少改一项」
  .refine((value) => value.title !== undefined || value.synopsis !== undefined, { // 跨字段校验：必须至少有一个可写字段
    message: 'title or synopsis is required', // 空更新没有业务意义，直接判非法
  }); // 返回带业务约束的 schema

const shotSchema = z.object({ // 单个镜头结构
  index: z.number().int().positive(), // 镜头序号，正整数且同一分镜内唯一
  description: z.string().trim().min(1).max(1000), // 画面描述，生成图像时作为提示词主干
  dialogue: z.string().max(1000).optional(), // 该镜头台词，可无对白
  camera: z.string().max(80).optional(), // 运镜/景别建议，如「近景固定」
  duration_sec: z.number().positive().max(600).optional(), // 单镜头时长上限 600 秒，防脏数据
}); // 镜头 schema 结束

const storyboardBody = z.object({ // 分镜提交入参
  shots: z.array(shotSchema).min(1).max(100), // 一次提交 1~100 个镜头，避免超大请求
  confirm: z.boolean().default(false), // 是否同时确认分镜：确认后工程进入 storyboarded
}); // 分镜入参结束

const characterBody = z.object({ // 角色设定入参
  name: z.string().trim().min(1).max(60), // 角色名，作为同名 upsert 的业务键
  appearance_prompt: z.string().trim().min(1).max(2000), // 外观提示词，必填以保证出图一致性
  seed: z.number().int().optional(), // 随机种子，可选；不传则每次出图风格可能漂移
  reference_asset_ids: z.array(z.string().min(1)).max(20).default([]), // 参考图资产 ID，最多 20 张，默认空
  voice_profile: z.string().max(200).optional(), // 音色描述，供 TTS 使用
}); // 角色入参结束

const suggestBody = z.object({ // AI 建议入参
  kind: z.enum(['script', 'storyboard', 'dialogue', 'voice']), // 建议类型：剧本/分镜/对白/音色
  prompt: z.string().max(2000).optional(), // 额外提示，缺省时用工程简介兜底
  count: z.number().int().min(1).max(10).default(3), // 生成候选条数，1~10，默认 3 条便于人工比较
}); // 建议入参结束

const listQuery = z.object({ // 工程列表查询参数
  status: z.enum(PROJECT_STATUSES).optional(), // 按状态过滤，省略则全量
  limit: z.coerce.number().int().min(1).max(100).default(20), // URL 查询串是字符串，coerce 后限 1~100，默认 20
}); // 查询参数结束

// ---------- 第 2 期：任务编排 / 成片合成入参 ----------

const createJobBody = z.object({ // 派发任务入参
  job_type: z.enum(JOB_TYPES), // 任务类型，必须命中五类枚举
  storyboard_id: z.string().min(1).optional(), // 关联分镜版本，纯文本任务可不传
  payload: z.record(z.string(), z.unknown()).default({}), // 任务入参键值对，默认空对象
  cost_estimate_minor: z.number().int().min(0).optional(), // 预估成本（最小单位），不允许负数
}); // 派发入参结束

const listJobsQuery = z.object({ // 任务列表查询参数
  status: z.enum(JOB_STATUSES).optional(), // 按任务状态过滤
  job_type: z.enum(JOB_TYPES).optional(), // 按任务类型过滤
  limit: z.coerce.number().int().min(1).max(100).default(20), // 分页上限，防一次拉全表
}); // 任务查询参数结束

const completeJobBody = z.object({ // 完成任务入参
  result: z.record(z.string(), z.unknown()).default({}), // 任务产出键值对，默认空对象（部分任务无产物）
}); // 完成入参结束

const failJobBody = z.object({ // 失败上报入参
  error_code: z.string().trim().min(1).max(80), // 失败原因码，必填便于统计与告警归类
}); // 失败入参结束

const createFilmBody = z.object({ // 创建成片入参
  title: z.string().trim().min(1).max(120), // 成片标题，必填
  object_key: z.string().min(1).max(512).optional(), // 首个版本的存储键，可稍后补传
  duration_sec: z.number().int().positive().optional(), // 时长（秒），正整数
  size_bytes: z.number().int().min(0).optional(), // 体积（字节），允许 0
}); // 成片入参结束

const autoBody = z.object({ // 漫剧第 3 期全自动成片入参：题材→成片单链路
  title: z.string().trim().min(1).max(120), // 工程标题，必填
  synopsis: z.string().trim().max(1000).optional(), // 题材简介，可空由模型自由发挥
  storyboard_count: z.number().int().min(1).max(12).default(4), // 分镜数量，默认 4 镜，上限 12 控制成本
  voice: z.string().trim().min(1).max(40).optional(), // 配音音色，缺省由编排器兜底为 alloy
}); // 全自动成片入参结束

const exportFilmBody = z.object({ // 导出成片入参：格式与分辨率选项
  format: z.enum(['mp4', 'mov']).default('mp4'), // 导出格式，默认 mp4
  resolution: z.enum(['720p', '1080p']).default('1080p'), // 导出分辨率，默认 1080p
}); // 导出成片入参结束

const filmVersionBody = z.object({ // 追加版本入参
  object_key: z.string().min(1).max(512).optional(), // 新版本的存储键，未上传时可先占位
  duration_sec: z.number().int().positive().optional(), // 时长（秒）
  size_bytes: z.number().int().min(0).optional(), // 体积（字节）
}); // 版本入参结束

const rejectFilmBody = z.object({ // 审核驳回入参
  reason: z.string().trim().min(1).max(500), // 驳回原因，必填以便创作者按意见返工
}); // 驳回入参结束

const listFilmsQuery = z.object({ // 成片列表查询参数
  status: z.enum(FILM_STATUSES).optional(), // 按成片状态过滤
  limit: z.coerce.number().int().min(1).max(100).default(20), // 分页上限，默认 20
}); // 成片查询参数结束

/**
 * 本地 mock 建议适配器：真实文本模型（第 2 期 P0）未接入前，
 * 返回结构化、可人工确认的候选，不伪造外部模型输出。
 */
function buildMockSuggestions( // 按建议类型产出候选数组，纯内存计算不落库
  kind: 'script' | 'storyboard' | 'dialogue' | 'voice', // 建议类型，决定返回结构
  project: ProjectRow, // 工程行，用于取标题与简介作为主题
  prompt: string | null, // 用户补充提示，可为空
  count: number, // 需要生成的候选条数
): Array<Record<string, unknown>> { // 返回可直接序列化的候选数组
  const theme = project.synopsis?.trim() || prompt?.trim() || `${project.title}的核心冲突`; // 主题优先级：简介 > 用户提示 > 标题兜底
  const items: Array<Record<string, unknown>> = []; // 累积候选结果
  for (let i = 1; i <= count; i += 1) { // 按条数逐个产出，i 同时作为展示序号
    if (kind === 'script') { // 剧本：给标题 + 一句话梗概 + 四段式结构
      items.push({ // 推入一条剧本候选
        title: `${project.title}·剧情候选 ${i}`, // 候选标题带序号，便于人工挑选
        logline: `${theme}（方向 ${i}）`, // 一句话梗概复用主题，方向序号体现差异化
        beats: ['起', '承', '转', '合'], // 固定四段式骨架，前端可展开编辑
      }); // 剧本候选结束
    } else if (kind === 'storyboard') { // 分镜：给序号 + 描述 + 景别 + 建议时长
      items.push({ // 推入一条分镜候选
        index: i, // 镜头序号，与分镜提交接口的 index 对齐
        description: `分镜 ${i}：围绕「${theme}」推进`, // 描述点明叙事任务
        camera: i % 2 === 0 ? '中景横移' : '近景固定', // 奇偶交替运镜，避免整段呆板
        duration_sec: 3, // 默认 3 秒，落在短视频节奏区间
      }); // 分镜候选结束
    } else if (kind === 'dialogue') { // 对白：两人轮替，保证有来有回
      items.push({ // 推入一条对白候选
        speaker: `角色${((i - 1) % 2) + 1}`, // 模 2 交替分配到两个角色
        line: `围绕「${theme}」的对白候选 ${i}`, // 台词内容围绕同一主题
      }); // 对白候选结束
    } else { // 音色：给出配音风格建议
      items.push({ // 推入一条音色候选
        character_name: `角色${((i - 1) % 2) + 1}`, // 与对白相同的角色编号规则
        voice_profile: `沉稳·中低音·语速偏慢（候选 ${i}）`, // 音色描述，后续可直接喂给 TTS
      }); // 音色候选结束
    } // 代码块结束
  } // 候选逐条产出完毕
  return items; // 返回全部候选，由调用方包进 suggestion 信封
} // mock 建议适配器结束

/** 放映厅演示片库：随仓库发布的静态演示片源，用于匿名访客验收「看片」链路 */
const SHOWCASE_WORKS = [ // 两部开放授权演示片，覆盖动画漫剧与自然短片两类放映形态
  { // 奇幻动画（漫剧演示）
    id: 'showcase.stardust', // 稳定标识，前端用作选中态与进度键
    title: '星尘之约', // 演示标题
    subtitle: '开放授权动画演示片源', // 副标题：明确标注为演示内容
    kind: 'comic-drama', // 漫剧形态
    region: 'global', // 内容分区
    tags: ['奇幻', '动画', '演示片源'], // 标签，前端展示
    cover: '/demo/stardust-cover.jpg', // 封面图（构建产物内静态资源）
    episodes: [{ no: 1, title: '预告片 · 星尘之约', src: '/demo/stardust-ep1.mp4', duration_sec: 52 }], // 可播放片源
  }, // 奇幻动画演示结束
  { // 自然短片（AI 剧占位演示）
    id: 'showcase.bloom', // 稳定标识
    title: '花间序曲', // 演示标题
    subtitle: '开放授权自然短片演示片源', // 副标题
    kind: 'ai-drama', // AI 剧形态（演示位）
    region: 'cn', // 内容分区
    tags: ['治愈', '微距', '演示片源'], // 标签
    cover: '/demo/bloom-cover.jpg', // 封面
    episodes: [{ no: 1, title: '正片 · 花间序曲', src: '/demo/bloom-ep1.mp4', duration_sec: 5 }], // 可播放片源
  }, // 自然短片演示结束
]; // 演示片库结束

export function createComicRouter(deps: ApiDeps): Router { // 工厂函数：外部注入 db / clock，便于测试替换
  const router = Router(); // 独立子路由，由 app 统一挂载

  // ---------- 放映厅（公开可看，先于鉴权中间件注册） ----------

  router.get('/comic/showcase', (req, res) => { // 匿名可访问的演示片库，供访客直接看漫剧 / AI 剧
    // 片源与封面保持相对路径，由前端 resolvePublicUrl 按部署方式补源：
    // 同源部署（生产自建 / 本地开发）直接落在本站静态目录，跨源托管（GitHub Pages 等）补 API 源。
    res.json({ items: SHOWCASE_WORKS, updated_at: clockOf(deps) }); // 统一信封 + 生成时间，便于前端判断新鲜度
  }); // 演示片库路由结束

  router.get('/comic/theater', requireAuth, async (req, res) => { // 登录用户的作品放映列表（仅本人可见，不校验模块权益）
    const user = req.user!; // requireAuth 已保证登录
    const storage = deps.storage; // 存储适配器，用于签发播放地址
    if (!storage) throw new AppError('STORAGE_NOT_CONFIGURED', 'object storage is not available'); // 无存储无法签发播放地址
    const rows = deps.db // 取本人名下所有工程里已有产物的成片，按更新时间倒序
      .prepare( // 预编译查询：一次取出成片与最新版本键，避免 N+1
        `SELECT f.id, f.title, f.status, f.updated_at, v.version_no, v.object_key, v.duration_sec,
                p.title AS project_title
           FROM comic_films f
           JOIN comic_projects p ON p.id = f.project_id
           LEFT JOIN film_versions v ON v.film_id = f.id
          WHERE p.owner_user_id = ? AND p.deleted_at IS NULL AND f.deleted_at IS NULL AND v.object_key IS NOT NULL
          GROUP BY f.id
          ORDER BY f.updated_at DESC
          LIMIT 60`, // 最多 60 部，避免首屏过大
      ) // 预编译结束
      .all(user.id) as Array<{ id: string; title: string; status: string; updated_at: string; version_no: number; object_key: string; duration_sec: number | null; project_title: string }>; // 结果行类型
    const items = await Promise.all(rows.map(async (row) => { // 逐部签发播放地址（本地存储为 HMAC 签名，S3 为 SigV4）
      const presigned = await storage.presignDownload({ key: row.object_key, mime: 'video/mp4', expires_seconds: 3600 }); // 1 小时有效
      return { // 前端直接放进 <video src>
        id: row.id, // 成片 ID
        title: row.title, // 成片标题
        project_title: row.project_title, // 所属工程，便于分组
        status: row.status, // 状态（published / reviewing 等）
        version_no: row.version_no, // 当前播放版本
        duration_sec: row.duration_sec, // 时长，未知为 null
        src: presigned.url, // 预签名播放地址
        updated_at: row.updated_at, // 更新时间
      }; // 条目结束
    })); // 并发签发结束
    res.json({ items }); // 返回作品列表
  }); // 我的放映厅路由结束

  // 鉴权按命名空间生效：未匹配到 /comic* 的请求直接放行到后续 router，避免未知路径被误拦成 401
  router.use('/comic', requireAuth); // 先校验登录态，req.user 在此之后必有值
  router.use('/comic', requireEntitlement(MODULE_CODE)); // 再校验 comic.workbench 模块权益，未购买即 403

  // ---------- 创作工程 CRUD ----------

  router.get('/comic/projects', (req, res) => { // 列出本人工程，支持按状态过滤与条数限制
    const user = req.user!; // requireAuth 已保证登录，此处断言非空
    const query = parse(listQuery, req.query); // 校验 status / limit，失败抛 VALIDATION_FAILED
    const rows = query.status // 传了 status 走带筛选的第一分支
      ? deps.db // 复用注入的数据库句柄
          .prepare( // 第一分支：带状态条件
            `SELECT * FROM comic_projects
             WHERE owner_user_id = ? AND status = ? AND deleted_at IS NULL
             ORDER BY created_at DESC
             LIMIT ?`, // 只看本人、未删除、指定状态的工程，按创建时间倒序
          ) // 预编译结束
          .all(user.id, query.status, query.limit) // 三个占位符依次绑定
      : deps.db // 无状态过滤时走第二分支
          .prepare( // 第二分支：不带状态条件
            `SELECT * FROM comic_projects
             WHERE owner_user_id = ? AND deleted_at IS NULL
             ORDER BY created_at DESC
             LIMIT ?`, // 不筛状态时保持同一排序口径
          ) // 预编译结束
          .all(user.id, query.limit); // 两个占位符依次绑定
    res.json({ items: (rows as ProjectRow[]).map(projectPayload) }); // 统一裁剪为对外契约字段
  }); // 工程列表接口结束

  router.post('/comic/projects', idempotency, (req, res) => { // 新建工程；幂等键防重复点击建出多个
    const body = parse(createBody, req.body); // 校验标题与简介
    const user = req.user!; // 已登录用户
    const now = clockOf(deps); // 统一时间源，created_at 与 updated_at 取同一值
    const id = uuidv7(); // 服务端生成主键，避免客户端伪造
    deps.db // 注入的数据库句柄
      .prepare( // 预编译插入语句
        `INSERT INTO comic_projects
           (id, owner_user_id, region, title, synopsis, status, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'draft', 1, ?, ?)`, // 新工程固定从 draft 状态、version=1 起步
      ) // 预编译结束
      .run(id, user.id, user.region, body.title, body.synopsis ?? null, now, now); // 归属与地域取自登录用户
    res.status(201).json({ project: projectPayload(findProject(deps.db, user.id, id)) }); // 回读一次再返回，确保与库中一致
  }); // 新建工程接口结束

  /** 漫剧第 3 期：题材 → 成片单链路全自动生成（同步执行，真实模型下耗时较长） */
  router.post('/comic/auto', idempotency, async (req, res) => { // 一键成片：建工程→剧本→分镜→图+配音→合成→成片
    const body = parse(autoBody, req.body); // 校验标题、简介、分镜数与音色
    const user = req.user!; // 已登录用户，权益中间件已校验 comic.workbench
    const orch = deps.orchestrator; // 编排器：真实模型或 mock 均经其统一调度
    const storage = deps.storage; // 存储适配器：剧本等文本资产需回读解析
    if (!orch) throw new AppError('PROVIDER_NOT_CONFIGURED', 'ai orchestrator is not available'); // 未注入编排器则整条链路不可用
    if (!orch.configured) throw new AppError('PROVIDER_NOT_CONFIGURED', 'no ai provider is configured'); // 凭证缺失时诚实失败，不伪造产物
    if (!storage) throw new AppError('STORAGE_NOT_CONFIGURED', 'object storage is not available'); // 剧本回读与成片落盘都依赖存储
    const now = clockOf(deps); // 统一时间源
    const projectId = uuidv7(); // 工程主键
    const storyboardId = uuidv7(); // 分镜版本主键（自动生成，用于关联任务）

    // 1) 建工程，直接进入 generating（自动链路跳过人工确认的 storyboarded 中间态）
    deps.db // 写入工程行
      .prepare( // 预编译工程插入
        `INSERT INTO comic_projects
           (id, owner_user_id, region, title, synopsis, status, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'generating', 1, ?, ?)`, // 自动链路从 generating 起步，内容由 AI 全量生成
      ) // 预编译结束
      .run(projectId, user.id, user.region, body.title, body.synopsis ?? null, now, now); // 归属与地域取自登录用户

    // 2) 生成剧本（text 任务）：提示模型按分镜数输出结构化剧本
    const scriptPrompt = `为漫剧《${body.title}》创作一个${body.synopsis ?? '自由发挥的短剧'}剧本，包含 ${body.storyboard_count} 个分镜。
每个分镜以【分镜N】开头，下一行写【画面】描述镜头内容，再下一行写【台词】角色对白。
要求画面描述具体可绘制，台词简短有力，整体节奏紧凑。`; // 结构化提示，便于后续按标记拆分镜头
    const scriptRes = await runAutoJob(deps.db, orch, projectId, storyboardId, 'text', { prompt: scriptPrompt }, user.id, now); // 同步执行剧本任务
    const scriptText = await extractTextFromResult(storage, scriptRes.object_key); // 从存储回读剧本文本

    // 3) 解析剧本，拆出 N 个分镜的画面描述与台词
    const shots = parseScriptToShots(scriptText, body.storyboard_count, body.title); // 按【分镜N】标记拆分，不足则用标题兜底
    deps.db // 写入自动生成的分镜版本（留痕，供前端回放创作过程）
      .prepare( // 预编译分镜插入
        `INSERT INTO storyboards
           (id, project_id, version_no, shots, confirmed_at, created_by, created_at)
         VALUES (?, ?, 1, ?, ?, ?, ?)`, // 自动生成的分镜直接确认，无需人工二次确认
      ) // 预编译结束
      .run(storyboardId, projectId, JSON.stringify(shots), now, user.id, now); // 绑定分镜字段

    // 4) 逐镜生成图片 + 配音，收集所有产物键
    const assetKeys: string[] = []; // 累积所有图片与音频的 object_key，供合成任务使用
    for (let i = 0; i < shots.length; i++) { // 逐镜串行，避免同时打满外部模型配额
      const shot = shots[i]; // 当前分镜
      const imagePrompt = `漫画风格分镜插图：${shot.description}。竖版构图，电影感光影，角色表情生动。`; // 图片提示，统一风格前缀
      const imgRes = await runAutoJob(deps.db, orch, projectId, storyboardId, 'image', { prompt: imagePrompt }, user.id, now); // 生成分镜图
      if (imgRes.object_key) assetKeys.push(imgRes.object_key); // 图片键入合成清单
      if (shot.dialogue) { // 有台词才生成配音，避免静音镜头也产生音频
        const ttsPrompt = shot.dialogue; // 配音文本即分镜台词
        const ttsRes = await runAutoJob(deps.db, orch, projectId, storyboardId, 'tts', { prompt: ttsPrompt, voice: body.voice ?? 'alloy' }, user.id, now); // 生成配音
        if (ttsRes.object_key) assetKeys.push(ttsRes.object_key); // 音频键入合成清单
      } // 台词分支结束
    } // 逐镜循环结束

    if (assetKeys.length === 0) { // 极端情况：所有生成任务都未产出键
      throw new AppError('GENERATION_FAILED', 'no assets were produced for composition'); // 无素材无法合成，明确失败
    } // 空产物守卫结束

    // 5) 合成成片（compose 任务）：编排器内部用 ffmpeg 把图+音频拼成 mp4
    const composeRes = await runAutoJob(deps.db, orch, projectId, storyboardId, 'compose', { object_keys: assetKeys }, user.id, now); // 执行合成
    if (!composeRes.object_key) { // 合成成功但未返回存储键（不应发生，防御性校验）
      throw new AppError('GENERATION_FAILED', 'compose succeeded but no object key returned'); // 明确失败，不返回半成品
    } // 合成产物守卫结束

    // 6) compose 成功已由编排器驱动 project generating→rendered，此处创建成片记录
    const filmId = uuidv7(); // 成片主键
    const versionId = uuidv7(); // 首版本主键
    deps.db.transaction(() => { // 成片与版本同批写入
      deps.db // 建成片壳
        .prepare( // 预编译成片插入
          `INSERT INTO comic_films
             (id, project_id, title, status, current_version_id, review_note, version, created_at, updated_at, deleted_at)
           VALUES (?, ?, ?, 'draft', NULL, NULL, 1, ?, ?, NULL)`, // 新成片从 draft 起步，待审核发布
        ) // 预编译结束
        .run(filmId, projectId, body.title, now, now); // 绑定成片字段
      deps.db // 建首版本，指向合成产物
        .prepare( // 预编译版本插入
          `INSERT INTO film_versions
             (id, film_id, version_no, object_key, duration_sec, size_bytes, published_at, created_by, created_at)
           VALUES (?, ?, 1, ?, NULL, NULL, NULL, ?, ?)`, // 首版本号 1，时长体积后续由资产表回填
        ) // 预编译结束
        .run(versionId, filmId, composeRes.object_key, user.id, now); // 绑定版本字段
    })(); // 立即执行事务

    res.status(201).json({ // 201 表示产出了成片资源
      project_id: projectId, // 工程 ID
      film_id: filmId, // 成片 ID
      version_id: versionId, // 首版本 ID
      object_key: composeRes.object_key, // 合成产物键，前端可直接拉取预览
      asset_keys: assetKeys, // 全部中间产物键，便于前端逐镜回放
      shot_count: shots.length, // 实际分镜数（与请求一致或兜底后的值）
    }); // 全自动成片响应结束
  }); // 漫剧第 3 期全自动接口结束

  router.get('/comic/projects/:id', (req, res) => { // 工程详情：聚合工程 + 角色 + 最新分镜
    const user = req.user!; // 登录用户
    const project = findProject(deps.db, user.id, pathParam(req, 'id')); // 归属校验，越权即 404
    const characters = deps.db // 一次性取全量角色
      .prepare( // 预编译角色查询
        `SELECT * FROM comic_characters
         WHERE project_id = ? AND deleted_at IS NULL
         ORDER BY created_at`, // 角色按创建顺序返回，保持设定页稳定
      ) // 预编译结束
      .all(project.id) as CharacterRow[]; // 按工程 ID 取全量角色
    const storyboard = deps.db // 再取最新一版分镜
      .prepare( // 预编译分镜查询
        `SELECT * FROM storyboards
         WHERE project_id = ?
         ORDER BY version_no DESC
         LIMIT 1`, // 只取最新一版分镜，历史版本不进详情页
      ) // 预编译结束
      .get(project.id) as StoryboardRow | undefined; // 可能尚未提交过分镜
    res.json({ // 一次性返回详情所需全部数据，减少往返
      project: projectPayload(project), // 工程本体
      characters: characters.map(characterPayload), // 角色列表（JSON 列已解析）
      latest_storyboard: storyboard ? storyboardPayload(storyboard) : null, // 无分镜时显式返回 null，前端不必区分缺字段
    }); // 详情响应组装结束
  }); // 工程详情接口结束

  router.patch('/comic/projects/:id', idempotency, (req, res) => { // 局部更新标题 / 简介，带乐观锁
    const body = parse(updateBody, req.body); // 校验字段与版本号
    const user = req.user!; // 登录用户
    const project = findProject(deps.db, user.id, pathParam(req, 'id')); // 归属校验
    if (project.version !== body.version) { // 客户端版本落后说明已被改过
      throw new AppError('CONFLICT', 'project version mismatch', { // 提前失败，避免覆盖他人修改
        expected_version: body.version, // 客户端以为的版本
        current_version: project.version, // 服务端真实版本，便于前端提示重载
      }); // 版本冲突错误体结束
    } // 乐观锁校验结束
    if (!EDITABLE_STATUSES.has(project.status)) { // 生成态之后内容冻结
      throw new AppError('CONFLICT', `project is not editable in status ${project.status}`, { // 阻止改动已进入产线的剧本
        status: project.status, // 回传当前状态，前端可解释为何不可改
      }); // 状态冲突错误体结束
    } // 可编辑性校验结束

    const now = clockOf(deps); // 本次更新时间
    const sets: string[] = []; // 动态拼装的 SET 片段
    const values: unknown[] = []; // 与 SET 片段一一对应的绑定值
    if (body.title !== undefined) { // 只更新调用方显式传入的字段
      sets.push('title = ?'); // 标题占位符
      values.push(body.title); // 绑定新标题
    } // 标题分支结束
    if (body.synopsis !== undefined) { // 简介允许显式置 null
      sets.push('synopsis = ?'); // 简介占位符
      values.push(body.synopsis); // 绑定新简介
    } // 简介分支结束
    sets.push('version = ?', 'updated_at = ?'); // 每次写入必带版本自增与更新时间
    values.push(project.version + 1, now, project.id, project.version); // 追加 set 值与 WHERE 的 id / 版本

    const result = deps.db // 执行条件更新
      .prepare(`UPDATE comic_projects SET ${sets.join(', ')} WHERE id = ? AND version = ?`) // 版本作为并发闸门
      .run(...values); // 展开绑定全部参数
    if (result.changes === 0) { // 期间被其他请求改过，条件不再命中
      throw new AppError('CONFLICT', 'project was modified concurrently'); // 让客户端重读后重试
    } // 并发写校验结束

    res.json({ project: projectPayload(findProject(deps.db, user.id, project.id)) }); // 回读最新行返回
  }); // 更新工程接口结束

  router.delete('/comic/projects/:id', idempotency, (req, res) => { // 软删除工程，并级联软删角色
    const user = req.user!; // 登录用户
    const project = findProject(deps.db, user.id, pathParam(req, 'id')); // 归属校验
    const now = clockOf(deps); // 删除时间，同一事务内复用
    deps.db.transaction(() => { // 事务保证工程与角色同时生效
      deps.db // 先软删工程本身
        .prepare( // 预编译工程软删
          `UPDATE comic_projects
           SET deleted_at = ?, updated_at = ?, version = version + 1
           WHERE id = ?`, // 软删除：只打标记，保留审计痕迹
        ) // 预编译结束
        .run(now, now, project.id); // 绑定删除时间与被删工程
      deps.db // 再级联软删角色
        .prepare( // 预编译角色软删
          `UPDATE comic_characters
           SET deleted_at = ?, updated_at = ?
           WHERE project_id = ? AND deleted_at IS NULL`, // 只处理尚未删除的角色，保证幂等
        ) // 预编译结束
        .run(now, now, project.id); // 级联软删该工程全部角色
    })(); // 立即执行事务
    res.json({ ok: true, project_id: project.id }); // 返回删除结果标识
  }); // 删除工程接口结束

  // ---------- 分镜 ----------

  router.post('/comic/projects/:id/storyboard', idempotency, (req, res) => { // 提交一版分镜，可选同时确认
    const body = parse(storyboardBody, req.body); // 校验镜头数组与 confirm 开关
    const user = req.user!; // 登录用户
    const project = findProject(deps.db, user.id, pathParam(req, 'id')); // 归属校验
    if (!EDITABLE_STATUSES.has(project.status)) { // 生成态后不允许再改分镜
      throw new AppError('CONFLICT', `project is not editable in status ${project.status}`, { // 避免分镜与已派发任务错配
        status: project.status, // 回传当前状态
      }); // 状态冲突错误体结束
    } // 可编辑性校验结束
    if (new Set(body.shots.map((shot) => shot.index)).size !== body.shots.length) { // 去重后长度不等即有重复序号
      throw new AppError('VALIDATION_FAILED', 'shot index must be unique', { // 序号重复会导致排序与资产映射错乱
        field: 'shots.index', // 精确指出出错字段
      }); // 校验错误体结束
    } // 序号唯一性校验结束

    const now = clockOf(deps); // 提交时间
    const saved = deps.db.transaction(() => { // 事务内完成取号 + 插入 + 状态推进
      const latest = deps.db // 取当前最大版本号
        .prepare(`SELECT MAX(version_no) AS max_version FROM storyboards WHERE project_id = ?`) // 聚合查询最新版本
        .get(project.id) as { max_version: number | null }; // 无分镜时 max_version 为 null
      const versionNo = (latest.max_version ?? 0) + 1; // 版本号单调递增，历史版本永不覆盖
      const id = uuidv7(); // 新分镜版本主键
      deps.db // 写入新的分镜版本行
        .prepare( // 预编译分镜插入
          `INSERT INTO storyboards
             (id, project_id, version_no, shots, confirmed_at, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`, // 固化镜头 JSON 与提交人
        ) // 预编译结束
        .run( // 逐项绑定分镜字段
          id, // 版本主键
          project.id, // 所属工程
          versionNo, // 新版本序号
          JSON.stringify(body.shots), // 镜头数组序列化为文本列
          body.confirm ? now : null, // 确认则记录确认时间，否则留空
          user.id, // 提交人
          now, // 提交时间
        ); // 写入分镜版本
      if (body.confirm) { // 确认后工程状态前移
        deps.db // 推进工程状态
          .prepare( // 预编译工程状态更新
            `UPDATE comic_projects
             SET status = 'storyboarded', version = version + 1, updated_at = ?
             WHERE id = ?`, // 状态推进到「分镜已确认」，可派发任务
          ) // 预编译结束
          .run(now, project.id); // 绑定更新时间与工程
      } // 确认分支结束
      return { id, versionNo }; // 回传新版本标识供响应组装
    })(); // 立即执行事务

    res.status(201).json({ // 201 表示产生了新的分镜版本资源
      storyboard: { // 返回刚写入的分镜快照，前端无需二次拉取
        id: saved.id, // 新分镜主键
        version_no: saved.versionNo, // 新版本序号
        shots: body.shots, // 已归一化的镜头数组
        confirmed_at: body.confirm ? now : null, // 与库内 confirmed_at 保持一致
        created_by: user.id, // 提交人
        created_at: now, // 提交时间
      }, // 分镜快照结束
      project_status: body.confirm ? 'storyboarded' : project.status, // 告知前端工程状态是否已推进
    }); // 分镜响应组装结束
  }); // 提交分镜接口结束

  // ---------- 角色设定（同名 upsert，保持跨分镜一致性） ----------

  router.post('/comic/projects/:id/characters', idempotency, (req, res) => { // 角色设定写入：同名覆盖、异名新增
    const body = parse(characterBody, req.body); // 校验角色字段
    const user = req.user!; // 登录用户
    const project = findProject(deps.db, user.id, pathParam(req, 'id')); // 归属校验
    if (!EDITABLE_STATUSES.has(project.status)) { // 生成态后设定冻结，防止出图风格漂移
      throw new AppError('CONFLICT', `project is not editable in status ${project.status}`, { // 与分镜保持一致的可编辑窗口
        status: project.status, // 回传当前状态
      }); // 状态冲突错误体结束
    } // 可编辑性校验结束

    const now = clockOf(deps); // 写入时间
    const upserted = deps.db.transaction(() => { // 查重 + 更新/插入需原子完成
      const referenceIds = JSON.stringify(body.reference_asset_ids); // 参考图 ID 序列化为文本列
      const existing = deps.db // 按「工程 + 角色名」查重
        .prepare( // 预编译同名查询
          `SELECT * FROM comic_characters
           WHERE project_id = ? AND name = ? AND deleted_at IS NULL`, // 同名视为同一角色
        ) // 预编译结束
        .get(project.id, body.name) as CharacterRow | undefined; // 可能尚不存在

      if (existing) { // 已存在同名角色：按字段差异决定是否更新
        const unchanged = // 四个可变字段全一致才算「无变化」
          existing.appearance_prompt === body.appearance_prompt && // 外观提示词是否相同
          existing.seed === (body.seed ?? null) && // 种子是否相同（缺省按 null 比较）
          existing.reference_asset_ids === referenceIds && // 参考图集合是否相同
          existing.voice_profile === (body.voice_profile ?? null); // 音色是否相同
        if (unchanged) return { id: existing.id, created: false }; // 完全一致则跳过写库，省一次版本自增
        deps.db // 设定有变化，执行覆盖更新
          .prepare( // 预编译角色更新
            `UPDATE comic_characters
             SET appearance_prompt = ?, seed = ?, reference_asset_ids = ?, voice_profile = ?,
                 version = version + 1, updated_at = ?
             WHERE id = ?`, // 只更新设定字段并推进版本
          ) // 预编译结束
          .run( // 逐项绑定新的设定值
            body.appearance_prompt, // 新外观提示词
            body.seed ?? null, // 新种子
            referenceIds, // 新参考图集合
            body.voice_profile ?? null, // 新音色
            now, // 更新时间
            existing.id, // 目标角色主键
          ); // 覆盖旧设定
        return { id: existing.id, created: false }; // 标记为更新而非新建
      } // 同名角色分支结束

      const id = uuidv7(); // 新角色主键
      deps.db // 插入全新角色
        .prepare( // 预编译角色插入
          `INSERT INTO comic_characters
             (id, project_id, name, appearance_prompt, seed, reference_asset_ids, voice_profile,
              version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`, // 新角色版本从 1 起步
        ) // 预编译结束
        .run( // 逐项绑定角色字段
          id, // 角色主键
          project.id, // 所属工程
          body.name, // 角色名
          body.appearance_prompt, // 外观提示词
          body.seed ?? null, // 种子可为空
          referenceIds, // 参考图集合
          body.voice_profile ?? null, // 音色可为空
          now, // 创建时间
          now, // 更新时间与创建时间一致
        ); // 插入新角色
      return { id, created: true }; // 标记为新建
    })(); // 立即执行事务

    const row = deps.db // 回读落库后的完整行
      .prepare('SELECT * FROM comic_characters WHERE id = ?') // 按主键查询
      .get(upserted.id) as CharacterRow; // 主键必定存在
    res.status(upserted.created ? 201 : 200).json({ // 新建 201、更新/无变化 200，符合 REST 语义
      character: characterPayload(row), // 对外角色视图
      created: upserted.created, // 显式告知前端是新建还是覆盖
    }); // 角色响应组装结束
  }); // 角色写入接口结束

  // ---------- AI 建议（人工确认后再落库） ----------

  router.post('/comic/projects/:id/suggest', idempotency, (req, res) => { // 生成 AI 建议候选，不直接落库
    const body = parse(suggestBody, req.body); // 校验建议类型与条数
    const user = req.user!; // 登录用户
    const project = findProject(deps.db, user.id, pathParam(req, 'id')); // 归属校验
    const now = clockOf(deps); // 生成时间戳
    const items = buildMockSuggestions(body.kind, project, body.prompt ?? null, body.count); // 当前用本地 mock，真实模型接入后替换
    res.json({ // 建议信封，不写库，纯建议
      suggestion: { // 建议信封，带来源与是否需要确认
        kind: body.kind, // 建议类型回显
        model: 'mock-text-suggest', // 明确标注 mock，避免前端误以为是真实模型产出
        generated_at: now, // 生成时间
        requires_confirmation: true, // 必须人工确认后才可通过分镜/角色接口落库
        items, // 候选数组
      }, // 建议内容结束
    }); // 建议响应组装结束
  }); // 建议接口结束

  // ---------- 第 2 期：生成任务编排（jobs） ----------

  router.get('/comic/projects/:id/jobs', (req, res) => { // 列出某工程下的任务，支持状态/类型过滤
    const user = req.user!; // 登录用户
    const query = parse(listJobsQuery, req.query); // 校验过滤条件与条数
    const project = findProject(deps.db, user.id, pathParam(req, 'id')); // 归属校验
    const conditions = ['project_id = ?']; // 基础条件：限定工程
    const values: unknown[] = [project.id]; // 与 conditions 对应的绑定值
    if (query.status) { // 可选状态过滤
      conditions.push('status = ?'); // 追加状态条件
      values.push(query.status); // 绑定状态值
    } // 状态过滤分支结束
    if (query.job_type) { // 可选类型过滤
      conditions.push('job_type = ?'); // 追加类型条件
      values.push(query.job_type); // 绑定类型值
    } // 类型过滤分支结束
    values.push(query.limit); // LIMIT 永远排最后，与 SQL 顺序一致
    const rows = deps.db // 执行动态条件查询
      .prepare( // 预编译任务列表查询
        `SELECT * FROM generation_jobs
         WHERE ${conditions.join(' AND ')}
         ORDER BY created_at DESC
         LIMIT ?`, // 动态拼条件，值全部参数化绑定
      ) // 预编译结束
      .all(...values) as JobRow[]; // 展开绑定全部参数
    res.json({ items: rows.map(jobPayload) }); // 统一裁剪为任务视图
  }); // 任务列表接口结束

  router.post('/comic/projects/:id/jobs', idempotency, (req, res) => { // 派发生成任务
    const body = parse(createJobBody, req.body); // 校验任务类型与入参
    const user = req.user!; // 登录用户
    const project = findProject(deps.db, user.id, pathParam(req, 'id')); // 归属校验
    // 只有分镜确认（storyboarded）或已在生成中的工程允许派发任务
    if (project.status !== 'storyboarded' && project.status !== 'generating') { // 其余状态说明内容未就绪或已冻结
      throw new AppError('CONFLICT', `project is not dispatchable in status ${project.status}`, { // 阻止空分镜直接派发，浪费额度
        status: project.status, // 回传当前状态供前端解释
      }); // 状态冲突错误体结束
    } // 可派发性校验结束
    let storyboardId: string | null = null; // 未指定分镜时保持为空
    if (body.storyboard_id) { // 前端指定了分镜版本
      const storyboard = deps.db // 校验该分镜确实属于本工程
        .prepare('SELECT id FROM storyboards WHERE id = ? AND project_id = ?') // 双条件防越权引用
        .get(body.storyboard_id, project.id) as { id: string } | undefined; // 越权或不存在均为 undefined
      if (!storyboard) { // 分镜不属于本工程
        throw new AppError('NOT_FOUND', 'storyboard not found', { storyboard_id: body.storyboard_id }); // 统一 404，不泄漏他人分镜
      } // 分镜归属校验结束
      storyboardId = storyboard.id; // 落库使用校验后的 ID
    } // 分镜分支结束

    const now = clockOf(deps); // 入队时间
    const id = uuidv7(); // 任务主键
    const created = deps.db.transaction(() => { // 插入任务与状态推进需原子
      deps.db // 写入排队中的任务
        .prepare( // 预编译任务插入
          `INSERT INTO generation_jobs
             (id, project_id, storyboard_id, job_type, status, retry_of, cost_estimate_minor,
              error_code, payload, result, created_by, created_at, started_at, finished_at)
           VALUES (?, ?, ?, ?, 'queued', NULL, ?, NULL, ?, NULL, ?, ?, NULL, NULL)`, // 新任务固定 queued，结果与错误留空
        ) // 预编译结束
        .run( // 逐项绑定任务字段
          id, // 任务主键
          project.id, // 所属工程
          storyboardId, // 关联分镜（可空）
          body.job_type, // 任务类型
          body.cost_estimate_minor ?? null, // 预估成本
          JSON.stringify(body.payload), // 入参序列化为文本列
          user.id, // 派发人
          now, // 入队时间
        ); // 写入任务行
      // 首个任务派发驱动 storyboarded → generating（08 §3.2）
      if (project.status === 'storyboarded') { // 仅首次派发需要推进状态
        deps.db // 推进工程到生成态
          .prepare( // 预编译状态更新
            `UPDATE comic_projects
             SET status = 'generating', version = version + 1, updated_at = ?
             WHERE id = ?`, // 工程进入生成态，内容自此冻结
          ) // 预编译结束
          .run(now, project.id); // 绑定更新时间与工程
      } // 状态推进分支结束
      return deps.db.prepare('SELECT * FROM generation_jobs WHERE id = ?').get(id) as JobRow; // 回读任务行作为返回值
    })(); // 立即执行事务

    res.status(201).json({ // 201 表示创建了任务资源
      job: jobPayload(created), // 新建任务的完整视图
      project_status: project.status === 'storyboarded' ? 'generating' : project.status, // 与库内状态一致的推进结果
    }); // 派发响应组装结束
  }); // 派发任务接口结束

  router.get('/comic/jobs/:id', (req, res) => { // 查询单个任务详情（前端轮询用）
    const user = req.user!; // 登录用户
    const job = findJob(deps.db, user.id, pathParam(req, 'id')); // 经工程归属校验
    res.json({ job: jobPayload(job) }); // 返回任务视图
  }); // 任务详情接口结束

  // 状态迁移由编排控制面驱动（ai-orchestrator 接入后由其消费队列调用）
  router.post('/comic/jobs/:id/start', idempotency, (req, res) => { // queued 转 running
    const user = req.user!; // 登录用户
    const job = findJob(deps.db, user.id, pathParam(req, 'id')); // 归属校验
    if (job.status !== 'queued') { // 只有排队中的任务能开跑
      throw new AppError('CONFLICT', `job is not startable in status ${job.status}`, { // 防止重复启动或回退终态
        status: job.status, // 回传当前状态
      }); // 状态冲突错误体结束
    } // 状态校验结束
    const now = clockOf(deps); // 开始时间
    deps.db // 更新任务为执行中
      .prepare(`UPDATE generation_jobs SET status = 'running', started_at = ? WHERE id = ?`) // 记录开跑时刻
      .run(now, job.id); // 绑定时间与任务主键
    res.json({ job: jobPayload(findJob(deps.db, user.id, job.id)) }); // 回读最新状态返回
  }); // 启动任务接口结束

  router.post('/comic/jobs/:id/complete', idempotency, (req, res) => { // running 转 succeeded
    const body = parse(completeJobBody, req.body ?? {}); // 请求体可能为空，兜底成空对象
    const user = req.user!; // 登录用户
    const job = findJob(deps.db, user.id, pathParam(req, 'id')); // 归属校验
    if (job.status !== 'running') { // 只有执行中的任务能上报完成
      throw new AppError('CONFLICT', `job is not completable in status ${job.status}`, { // 禁止跨态跳跃
        status: job.status, // 回传当前状态
      }); // 状态冲突错误体结束
    } // 状态校验结束
    const now = clockOf(deps); // 完成时间
    deps.db.transaction(() => { // 任务与工程状态需一致提交
      deps.db // 落库任务产出
        .prepare( // 预编译任务完成更新
          `UPDATE generation_jobs SET status = 'succeeded', result = ?, finished_at = ? WHERE id = ?`, // 落产出并记录完成时间
        ) // 预编译结束
        .run(JSON.stringify(body.result), now, job.id); // 产出序列化为文本列
      // 骨架口径：compose 任务成功即视为合成完成，工程 generating → rendered
      //（08 §3.2 的 generation_assets 分镜全覆盖校验随资产表接入后收紧）
      if (job.job_type === 'compose') { // 只有合成任务成功才代表出片完成
        deps.db // 推进工程到已合成
          .prepare( // 预编译工程状态更新
            `UPDATE comic_projects
             SET status = 'rendered', version = version + 1, updated_at = ?
             WHERE id = ? AND status = 'generating'`, // 仅从 generating 推进，避免重复推进
          ) // 预编译结束
          .run(now, job.project_id); // 绑定时间与工程
      } // 合成分支结束
    })(); // 立即执行事务
    res.json({ job: jobPayload(findJob(deps.db, user.id, job.id)) }); // 返回更新后的任务
  }); // 完成任务接口结束

  router.post('/comic/jobs/:id/fail', idempotency, (req, res) => { // running 转 failed
    const body = parse(failJobBody, req.body); // 校验失败原因码
    const user = req.user!; // 登录用户
    const job = findJob(deps.db, user.id, pathParam(req, 'id')); // 归属校验
    if (job.status !== 'running') { // 只有执行中的任务能上报失败
      throw new AppError('CONFLICT', `job is not failable in status ${job.status}`, { // 已终态的任务不可再改
        status: job.status, // 回传当前状态
      }); // 状态冲突错误体结束
    } // 状态校验结束
    const now = clockOf(deps); // 失败时间
    deps.db // 记录失败态与错误码
      .prepare( // 预编译失败更新
        `UPDATE generation_jobs SET status = 'failed', error_code = ?, finished_at = ? WHERE id = ?`, // 记录错误码供统计与重试判定
      ) // 预编译结束
      .run(body.error_code, now, job.id); // 绑定错误码、时间与主键
    res.json({ job: jobPayload(findJob(deps.db, user.id, job.id)) }); // 返回失败后的任务视图
  }); // 失败上报接口结束

  router.post('/comic/jobs/:id/cancel', idempotency, (req, res) => { // queued / running 转 canceled
    const user = req.user!; // 登录用户
    const job = findJob(deps.db, user.id, pathParam(req, 'id')); // 归属校验
    if (job.status !== 'queued' && job.status !== 'running') { // 只有未终结的任务可取消
      throw new AppError('CONFLICT', `job is not cancelable in status ${job.status}`, { // 成功/失败/已取消均不可再取消
        status: job.status, // 回传当前状态
      }); // 状态冲突错误体结束
    } // 状态校验结束
    const now = clockOf(deps); // 取消时间
    deps.db // 置为已取消
      .prepare(`UPDATE generation_jobs SET status = 'canceled', finished_at = ? WHERE id = ?`) // 记录结束时间便于统计耗时
      .run(now, job.id); // 绑定时间与主键
    res.json({ job: jobPayload(findJob(deps.db, user.id, job.id)) }); // 返回取消后的任务
  }); // 取消任务接口结束

  // 失败重试：新建 job（retry_of 指向原 job），历史 job 永不覆盖
  router.post('/comic/jobs/:id/retry', idempotency, (req, res) => { // 失败任务重试，生成新任务而非改旧行
    const user = req.user!; // 登录用户
    const job = findJob(deps.db, user.id, pathParam(req, 'id')); // 归属校验
    if (job.status !== 'failed') { // 只有失败任务需要重试
      throw new AppError('CONFLICT', `only failed job can be retried, current status ${job.status}`, { // 防止对成功任务重复消耗额度
        status: job.status, // 回传当前状态
      }); // 状态冲突错误体结束
    } // 状态校验结束
    const now = clockOf(deps); // 新任务入队时间
    const id = uuidv7(); // 新任务主键
    deps.db // 插入重试任务
      .prepare( // 预编译重试插入
        `INSERT INTO generation_jobs
           (id, project_id, storyboard_id, job_type, status, retry_of, cost_estimate_minor,
            error_code, payload, result, created_by, created_at, started_at, finished_at)
         VALUES (?, ?, ?, ?, 'queued', ?, ?, NULL, ?, NULL, ?, ?, NULL, NULL)`, // 沿用原任务类型与入参，重试链指向原任务
      ) // 预编译结束
      .run( // 逐项绑定重试任务字段
        id, // 新任务主键
        job.project_id, // 沿用原工程
        job.storyboard_id, // 沿用原分镜
        job.job_type, // 沿用原任务类型
        job.id, // retry_of 指向失败任务，形成可追溯链
        job.cost_estimate_minor, // 复用原成本预估，便于额度核对
        job.payload, // 直接复用原入参文本
        user.id, // 发起重试的用户
        now, // 入队时间
      ); // 写入重试任务
    res.status(201).json({ job: jobPayload(findJob(deps.db, user.id, id)) }); // 返回新任务，原任务保持失败历史
  }); // 重试接口结束

  // ---------- 第 2 期：成片合成（films） ----------

  router.get('/comic/projects/:id/films', (req, res) => { // 列出某工程下的成片
    const user = req.user!; // 登录用户
    const query = parse(listFilmsQuery, req.query); // 校验状态过滤与条数
    const project = findProject(deps.db, user.id, pathParam(req, 'id')); // 归属校验
    const rows = query.status // 有状态过滤走第一分支
      ? deps.db // 带状态条件的查询
          .prepare( // 预编译成片查询
            `SELECT * FROM comic_films
             WHERE project_id = ? AND status = ? AND deleted_at IS NULL
             ORDER BY created_at DESC
             LIMIT ?`, // 限定工程 + 状态，按创建时间倒序
          ) // 预编译结束
          .all(project.id, query.status, query.limit) // 三个占位符依次绑定
      : deps.db // 不带状态条件的查询
          .prepare( // 预编译成片查询
            `SELECT * FROM comic_films
             WHERE project_id = ? AND deleted_at IS NULL
             ORDER BY created_at DESC
             LIMIT ?`, // 不筛状态时同一排序口径
          ) // 预编译结束
          .all(project.id, query.limit); // 两个占位符依次绑定
    res.json({ items: (rows as FilmRow[]).map(filmPayload) }); // 统一裁剪为成片视图
  }); // 成片列表接口结束

  // 合成成片：工程须已进入 rendered（compose 任务成功），创建 draft 成片 + 首个版本
  router.post('/comic/projects/:id/films', idempotency, (req, res) => { // 创建成片并带出版本 1
    const body = parse(createFilmBody, req.body); // 校验标题与首个版本信息
    const user = req.user!; // 登录用户
    const project = findProject(deps.db, user.id, pathParam(req, 'id')); // 归属校验
    if (project.status !== 'rendered' && project.status !== 'published') { // 未合成或已归档的工程不能生成片
      throw new AppError('CONFLICT', `project is not composable in status ${project.status}`, { // 保证成片只源自真实合成产物
        status: project.status, // 回传当前状态
      }); // 状态冲突错误体结束
    } // 可合成性校验结束

    const now = clockOf(deps); // 创建时间
    const filmId = uuidv7(); // 成片主键
    const versionId = uuidv7(); // 首个版本主键
    const film = deps.db.transaction(() => { // 成片与版本必须同批写入
      deps.db // 先建成片壳
        .prepare( // 预编译成片插入
          `INSERT INTO comic_films
             (id, project_id, title, status, current_version_id, review_note, version,
              created_at, updated_at, deleted_at)
           VALUES (?, ?, ?, 'draft', NULL, NULL, 1, ?, ?, NULL)`, // 新成片从 draft 起步，尚未指向任何对外版本
        ) // 预编译结束
        .run(filmId, project.id, body.title, now, now); // 绑定成片主键、工程、标题与时间
      deps.db // 再建首个版本
        .prepare( // 预编译版本插入
          `INSERT INTO film_versions
             (id, film_id, version_no, object_key, duration_sec, size_bytes, published_at,
              created_by, created_at)
           VALUES (?, ?, 1, ?, ?, ?, NULL, ?, ?)`, // 首版本号固定 1，发布前无 published_at
        ) // 预编译结束
        .run( // 逐项绑定版本字段
          versionId, // 版本主键
          filmId, // 所属成片
          body.object_key ?? null, // 存储键可为空，后续补传
          body.duration_sec ?? null, // 时长可空
          body.size_bytes ?? null, // 体积可空
          user.id, // 上传人
          now, // 创建时间
        ); // 写入首个版本
      return deps.db.prepare('SELECT * FROM comic_films WHERE id = ?').get(filmId) as FilmRow; // 回读成片行
    })(); // 立即执行事务

    const version = deps.db // 回读刚写入的版本行
      .prepare('SELECT * FROM film_versions WHERE id = ?') // 按主键查询
      .get(versionId) as FilmVersionRow; // 主键必定存在
    res.status(201).json({ film: filmPayload(film), version: filmVersionPayload(version) }); // 同时返回成片与首版本
  }); // 创建成片接口结束

  router.get('/comic/films/:id', (req, res) => { // 成片详情：本体 + 全部历史版本
    const user = req.user!; // 登录用户
    const film = findFilm(deps.db, user.id, pathParam(req, 'id')); // 经工程归属校验
    const versions = deps.db // 取全部历史版本
      .prepare('SELECT * FROM film_versions WHERE film_id = ? ORDER BY version_no') // 版本按序号升序，形成演进时间线
      .all(film.id) as FilmVersionRow[]; // 一次取全量版本
    res.json({ film: filmPayload(film), versions: versions.map(filmVersionPayload) }); // 返回成片与版本列表
  }); // 成片详情接口结束

  // 追加新版本：版本只追加不覆盖；published 发新版后回到 draft 待重审
  router.post('/comic/films/:id/versions', idempotency, (req, res) => { // 上传/登记新版本
    const body = parse(filmVersionBody, req.body); // 校验版本字段
    const user = req.user!; // 登录用户
    const film = findFilm(deps.db, user.id, pathParam(req, 'id')); // 归属校验
    if (film.status === 'archived') { // 归档成片禁止再改
      throw new AppError('CONFLICT', 'archived film cannot accept new versions', { // 归档为终态，保持对外版本稳定
        status: film.status, // 回传当前状态
      }); // 状态冲突错误体结束
    } // 归档校验结束

    const now = clockOf(deps); // 创建时间
    const saved = deps.db.transaction(() => { // 取号 + 插入 + 状态回退原子完成
      const latest = deps.db // 取当前最大版本号
        .prepare('SELECT MAX(version_no) AS max_version FROM film_versions WHERE film_id = ?') // 聚合查询最新版本
        .get(film.id) as { max_version: number | null }; // 无版本时为 null
      const versionNo = (latest.max_version ?? 0) + 1; // 版本号单调递增，不覆盖历史
      const id = uuidv7(); // 新版本主键
      deps.db // 写入新版本行
        .prepare( // 预编译版本插入
          `INSERT INTO film_versions
             (id, film_id, version_no, object_key, duration_sec, size_bytes, published_at,
              created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`, // 新版本未发布，published_at 留空
        ) // 预编译结束
        .run( // 逐项绑定版本字段
          id, // 版本主键
          film.id, // 所属成片
          versionNo, // 新版本序号
          body.object_key ?? null, // 存储键可空
          body.duration_sec ?? null, // 时长可空
          body.size_bytes ?? null, // 体积可空
          user.id, // 上传人
          now, // 创建时间
        ); // 写入新版本
      if (film.status === 'published') { // 已发布成片追加新版，必须重新走审核
        deps.db // 回退成片状态
          .prepare( // 预编译状态回退
            `UPDATE comic_films
             SET status = 'draft', review_note = NULL, version = version + 1, updated_at = ?
             WHERE id = ?`, // 回退到 draft 并清空旧的驳回原因
          ) // 预编译结束
          .run(now, film.id); // 绑定时间与成片主键
      } // 状态回退分支结束
      return { id, versionNo }; // 回传新版本标识
    })(); // 立即执行事务

    const version = deps.db // 回读落库后的版本行
      .prepare('SELECT * FROM film_versions WHERE id = ?') // 按主键查询
      .get(saved.id) as FilmVersionRow; // 主键必定存在
    res.status(201).json({ version: filmVersionPayload(version) }); // 返回新版本视图
  }); // 追加版本接口结束

  // 提交审核：draft → reviewing；最新版本须已登记 object_key（成片产物归属对象存储）
  router.post('/comic/films/:id/submit-review', idempotency, (req, res) => { // 送审
    const user = req.user!; // 登录用户
    const film = findFilm(deps.db, user.id, pathParam(req, 'id')); // 归属校验
    if (film.status !== 'draft') { // 只有草稿态可以送审
      throw new AppError('CONFLICT', `film is not submittable in status ${film.status}`, { // 避免重复送审或跳过审核直发
        status: film.status, // 回传当前状态
      }); // 状态冲突错误体结束
    } // 状态校验结束
    const latest = deps.db // 取最新版本做产物校验
      .prepare( // 预编译最新版本查询
        'SELECT * FROM film_versions WHERE film_id = ? ORDER BY version_no DESC LIMIT 1', // 只看序号最大的版本
      ) // 预编译结束
      .get(film.id) as FilmVersionRow | undefined; // 理论上至少有一个版本，但保留兜底
    if (!latest || !latest.object_key) { // 没有版本或尚未上传产物都不可送审
      throw new AppError('CONFLICT', 'latest film version has no object_key', { film_id: film.id }); // 明确告知缺少产物键
    } // 产物校验结束
    const now = clockOf(deps); // 送审时间
    deps.db // 推进到审核中
      .prepare( // 预编译状态更新
        `UPDATE comic_films
         SET status = 'reviewing', version = version + 1, updated_at = ?
         WHERE id = ?`, // 状态推进到审核中
      ) // 预编译结束
      .run(now, film.id); // 绑定时间与成片主键
    res.json({ film: filmPayload(findFilm(deps.db, user.id, film.id)) }); // 返回审核态成片
  }); // 送审接口结束

  // 发布：reviewing → published；current_version_id 指向最新版本并记录 published_at
  router.post('/comic/films/:id/publish', idempotency, (req, res) => { // 审核通过后发布
    const user = req.user!; // 登录用户
    const film = findFilm(deps.db, user.id, pathParam(req, 'id')); // 归属校验
    if (film.status !== 'reviewing') { // 只有审核中的成片能发布
      throw new AppError('CONFLICT', `film is not publishable in status ${film.status}`, { // 跳过审核直接发布属非法流转
        status: film.status, // 回传当前状态
      }); // 状态冲突错误体结束
    } // 状态校验结束
    const latest = deps.db // 发布以最新版本为准
      .prepare( // 预编译最新版本查询
        'SELECT * FROM film_versions WHERE film_id = ? ORDER BY version_no DESC LIMIT 1', // 只取序号最大的版本
      ) // 预编译结束
      .get(film.id) as FilmVersionRow; // 送审前已校验存在，此处必有值
    const now = clockOf(deps); // 发布时间
    deps.db.transaction(() => { // 成片、版本、工程三张表需一致
      deps.db // 成片置为已发布并指向对外版本
        .prepare( // 预编译成片发布更新
          `UPDATE comic_films
           SET status = 'published', current_version_id = ?, review_note = NULL,
               version = version + 1, updated_at = ?
           WHERE id = ?`, // 指向对外版本并清空驳回原因
        ) // 预编译结束
        .run(latest.id, now, film.id); // 绑定版本 ID、时间与成片主键
      deps.db // 记录版本发布时间
        .prepare('UPDATE film_versions SET published_at = ? WHERE id = ?') // 供「最近更新」排序
        .run(now, latest.id); // 绑定时间与版本主键
      deps.db // 工程同步推进到已发布
        .prepare( // 预编译工程状态更新
          `UPDATE comic_projects
           SET status = 'published', version = version + 1, updated_at = ?
           WHERE id = ? AND status = 'rendered'`, // 工程仅在 rendered 时推进到 published
        ) // 预编译结束
        .run(now, film.project_id); // 绑定时间与工程主键
    })(); // 立即执行事务
    res.json({ film: filmPayload(findFilm(deps.db, user.id, film.id)) }); // 返回发布后的成片
  }); // 发布接口结束

  // 驳回：reviewing → draft，留原因（08 §3.2）
  router.post('/comic/films/:id/reject', idempotency, (req, res) => { // 审核驳回，退回草稿
    const body = parse(rejectFilmBody, req.body); // 校验驳回原因
    const user = req.user!; // 登录用户
    const film = findFilm(deps.db, user.id, pathParam(req, 'id')); // 归属校验
    if (film.status !== 'reviewing') { // 只有审核中的成片能被驳回
      throw new AppError('CONFLICT', `film is not rejectable in status ${film.status}`, { // 保证驳回语义单向
        status: film.status, // 回传当前状态
      }); // 状态冲突错误体结束
    } // 状态校验结束
    const now = clockOf(deps); // 驳回时间
    deps.db // 退回草稿并留下原因
      .prepare( // 预编译驳回更新
        `UPDATE comic_films
         SET status = 'draft', review_note = ?, version = version + 1, updated_at = ?
         WHERE id = ?`, // 回到草稿并留下驳回原因供创作者返工
      ) // 预编译结束
      .run(body.reason, now, film.id); // 绑定原因、时间与成片主键
    res.json({ film: filmPayload(findFilm(deps.db, user.id, film.id)) }); // 返回驳回后的成片
  }); // 驳回接口结束

  // 归档：draft / reviewing / published → archived（终态）
  router.post('/comic/films/:id/archive', idempotency, (req, res) => { // 归档成片，进入只读终态
    const user = req.user!; // 登录用户
    const film = findFilm(deps.db, user.id, pathParam(req, 'id')); // 归属校验
    if (film.status === 'archived') { // 已归档再归档属重复操作
      throw new AppError('CONFLICT', 'film is already archived', { status: film.status }); // 显式告知终态
    } // 重复归档校验结束
    const now = clockOf(deps); // 归档时间
    deps.db // 置为归档态
      .prepare( // 预编译归档更新
        `UPDATE comic_films
         SET status = 'archived', version = version + 1, updated_at = ?
         WHERE id = ?`, // 只改状态与版本，保留历史版本可追溯
      ) // 预编译结束
      .run(now, film.id); // 绑定时间与成片主键
    res.json({ film: filmPayload(findFilm(deps.db, user.id, film.id)) }); // 返回归档后的成片
  }); // 归档接口结束

  /** POST /comic/films/:id/export — 导出成片：按格式/分辨率转码后返回预签名下载 URL */
  router.post('/comic/films/:id/export', idempotency, async (req, res) => { // 导出可能涉及 ffmpeg 转码，标 async
    const user = req.user!; // 登录用户
    const film = findFilm(deps.db, user.id, pathParam(req, 'id')); // 归属校验
    const body = parse(exportFilmBody, req.body); // 校验格式与分辨率
    const storage = deps.storage; // 存储适配器，用于回读原片与写入转码产物
    if (!storage) throw new AppError('STORAGE_NOT_CONFIGURED', 'object storage is not available'); // 无存储无法导出

    // 1) 取当前版本的 object_key（导出总是基于最新发布版本）
    const versionRow = deps.db // 查当前版本
      .prepare( // 预编译：按成片主键取最新版本的存储键
        `SELECT object_key, version_no FROM film_versions WHERE film_id = ? ORDER BY version_no DESC LIMIT 1`, // 取版本号最大的一条
      ) // 预编译结束
      .get(film.id) as { object_key: string | null; version_no: number } | undefined; // 命中行含存储键与版本号
    if (!versionRow || !versionRow.object_key) { // 成片尚无产物
      throw new AppError('NOT_FOUND', 'film has no published version to export', { film_id: film.id }); // 404 提示先合成
    } // 版本存在性判断结束

    const originalKey = versionRow.object_key; // 原片存储键
    const originalMime = 'video/mp4'; // compose 产物固定为 mp4
    const isOriginalFormat = body.format === 'mp4' && body.resolution === '1080p'; // 与 compose 输出（1080x1920 mp4）一致则无需转码

    let downloadKey = originalKey; // 默认直接下载原片
    let downloadMime = originalMime; // 默认原片 MIME
    if (!isOriginalFormat) { // 需要转码：格式或分辨率与原片不同
      const ffmpegBin = (deps.env.MIM_FFMPEG_PATH ?? '').trim() || null; // 读取 ffmpeg 路径，未配置则为 null
      if (!ffmpegBin) { // 未配置 ffmpeg 时无法转码
        throw new AppError('FEATURE_NOT_AVAILABLE', 'transcoding is not available; export as mp4 1080p to download directly', { // 403 提示降级方案
          requested: { format: body.format, resolution: body.resolution }, // 回显请求的格式与分辨率
        }); // 错误体结束
      } // ffmpeg 可用性判断结束
      downloadKey = await transcodeVideo(storage, ffmpegBin, originalKey, body.format, body.resolution); // 执行转码并返回新对象键
      downloadMime = body.format === 'mov' ? 'video/quicktime' : 'video/mp4'; // mov 用 quicktime，其余按 mp4
    } // 转码分支结束

    // 2) 生成预签名下载 URL（有效期 1 小时）
    const presigned = await storage.presignDownload({ // 调存储适配器生成下载签名
      key: downloadKey, // 待下载的对象键（原片或转码产物）
      mime: downloadMime, // 响应 Content-Type
      expires_seconds: 3600, // 1 小时有效期，足够用户下载
    }); // 预签名入参结束

    res.json({ // 返回下载信息
      film_id: film.id, // 成片 ID
      version_no: versionRow.version_no, // 导出版本号
      format: body.format, // 请求格式
      resolution: body.resolution, // 请求分辨率
      transcoded: !isOriginalFormat, // 是否经过转码
      download_url: presigned.url, // 预签名下载地址
      expires_at: presigned.expires_at, // 下载地址过期时间
      method: presigned.method, // 请求方法（GET）
      headers: presigned.headers, // 需携带的请求头
    }); // 导出响应体结束
  }); // 导出成片接口结束

  return router; // 交出子路由，由上层 app 挂载
} // 工厂函数结束
