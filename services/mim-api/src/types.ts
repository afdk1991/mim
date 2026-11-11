/** 服务端共享类型与 Express 请求扩展 */

import type { NotifyChannels } from './notify.js'; // 验证码通知通道的类型来源，仅用于 ApiDeps 字段声明
import type { Orchestrator } from './orchestrator.js'; // 生成任务编排器类型，仅类型引用避免循环依赖
import type { StorageAdapter } from './storage.js'; // 存储适配器类型，local / s3 两套实现共用该契约

export type Db = import('better-sqlite3').Database; // 用 import() 类型直接取 better-sqlite3 的 Database，免去额外 import 语句

export interface ApiDeps { // 依赖注入容器：所有路由通过它拿能力，测试可整体替换
  db: Db; // 同步 SQLite 连接，路由内直接用 prepare/get/all
  jwtSecret: string; // HS256 签名密钥，来自环境变量或本地文件
  /** 注入的环境变量（默认 process.env），用于支付驱动凭证检查 */
  env: Record<string, string | undefined>; // 以 Record 形式注入，测试可构造最小 env 而无需污染进程环境
  /** 可注入时钟，便于测试 */
  now?: () => string; // 可选时钟：给了就返回固定时间，让保留期/过期逻辑可断言
  /** 对象存储适配器（media 域）；未注入时由 app 依据 env 构造默认实例 */
  storage?: StorageAdapter; // 可选存储：测试可传内存替身，生产由 app 按 env 装配
  /** 生成任务编排器（ai-orchestrator 域）；未注入时由 app 依据 env 构造默认实例 */
  orchestrator?: Orchestrator; // 可选编排器：缺失时相关路由返回 PROVIDER_NOT_CONFIGURED
  /** 验证码通知通道（短信/邮件）；未注入时由 app 依据 env 构造默认实例 */
  notify?: NotifyChannels; // 可选通知通道：缺失时登录验证码走本地日志下发
  /** IM 实时连接中心；由服务入口在挂载 WebSocket 后回填，HTTP 路由借此推送撤回等事件 */
  imHub?: import('./im/hub.js').ImHub; // 仅类型引用，避免 types → hub 的运行时环依赖
} // ApiDeps 结束：可选字段由 app 在装配时补齐默认实现

export type Region = 'cn' | 'global'; // 数据驻留区域，决定账号归属与合规分区
export type UserStatus = 'active' | 'pending_deletion' | 'deleted'; // 账号状态机：正常 / 注销冷静期 / 已删除

/** users 表在鉴权与用户视图里使用的字段子集：member_no 为对外自动分配的 Mim ID 号码 */
export interface UserRow { // 用户行最小视图，登录响应与个人中心共用
  id: string; // 内部主键（uuidv7），用于所有关联表与令牌 sub
  member_no: string | null; // 对外编号（MIM-10000001）；历史库补列前可能为 NULL，读到时需兜底
  region: Region; // 所属地区，影响默认语言与时区
  status: string; // 状态：active / pending_deletion / deleted
  display_name: string; // 展示名
  locale: string; // 语言偏好
  timezone: string; // 时区偏好
  is_guest: number | null; // 匿名访客标记：1 为免登录自动建的访客账号，0/NULL 为真实账号
  deletion_scheduled_at: string | null; // 注销预约时间，供前端提示
  created_at: string; // 注册时间
} // UserRow 结束

export interface AuthUser { // 鉴权通过后挂到 req.user 的最小用户视图
  id: string; // 用户主键，同时作为对象键首段
  member_no: string | null; // 对外 Mim ID 号码，鉴权中间件一并带出，避免各路由重复查询
  region: Region; // 所属区域，用于区域化策略判断
  status: UserStatus; // 账号状态，pending_deletion 期间限制写操作
  display_name: string; // 展示名，前端界面直接使用
  locale: string; // 语言区域，决定返回文案语言
  timezone: string; // 时区，用于按用户本地时间做提醒
  is_guest?: number | null; // 匿名访客标记：1 为免登录自动建的访客账号
} // AuthUser 结束：字段随鉴权结果一并挂到 req.user

declare global { // 全局类型增强：让 Express Request 携带自定义字段
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express { // 必须落在全局 Express 命名空间内才能被合并识别
    interface Request { // 对 Request 做接口合并，不覆盖原有成员
      requestId: string; // 请求追踪 ID，由 requestId 中间件最先写入
      user?: AuthUser; // 鉴权通过后才有值，故为可选；未鉴权路由不应读取
      deps: ApiDeps; // 每个请求共享的依赖容器，由依赖注入中间件赋值
      adminBootstrap?: boolean; // 超管引导通道标记：命中 MIM_ADMIN_TOKEN 时为 true，用于区分「令牌超管」与「JWT 角色超管」
    } // Request 接口合并结束
  } // Express 命名空间结束
} // declare global 结束，自定义字段已并入全局 Request 类型

export {}; // 使本文件成为模块，declare global 才能生效
