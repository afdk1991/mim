/** 服务端共享类型与 Express 请求扩展 */

export type Db = import('better-sqlite3').Database;

export interface ApiDeps {
  db: Db;
  jwtSecret: string;
  /** 注入的环境变量（默认 process.env），用于支付驱动凭证检查 */
  env: Record<string, string | undefined>;
  /** 可注入时钟，便于测试 */
  now?: () => string;
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
