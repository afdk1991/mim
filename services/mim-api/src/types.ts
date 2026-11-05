/** 服务端共享类型与 Express 请求扩展 */

import type { NotifyChannels } from './notify.js';
import type { Orchestrator } from './orchestrator.js';
import type { StorageAdapter } from './storage.js';

export type Db = import('better-sqlite3').Database;

export interface ApiDeps {
  db: Db;
  jwtSecret: string;
  /** 注入的环境变量（默认 process.env），用于支付驱动凭证检查 */
  env: Record<string, string | undefined>;
  /** 可注入时钟，便于测试 */
  now?: () => string;
  /** 对象存储适配器（media 域）；未注入时由 app 依据 env 构造默认实例 */
  storage?: StorageAdapter;
  /** 生成任务编排器（ai-orchestrator 域）；未注入时由 app 依据 env 构造默认实例 */
  orchestrator?: Orchestrator;
  /** 验证码通知通道（短信/邮件）；未注入时由 app 依据 env 构造默认实例 */
  notify?: NotifyChannels;
}

export type Region = 'cn' | 'global';
export type UserStatus = 'active' | 'pending_deletion' | 'deleted';

export interface AuthUser {
  id: string;
  region: Region;
  status: UserStatus;
  display_name: string;
  locale: string;
  timezone: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      user?: AuthUser;
      deps: ApiDeps;
    }
  }
}

export {};
