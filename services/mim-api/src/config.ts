/**
 * 运行期常量。
 * 数据库路径为本地文件方案；JWT 密钥优先读取 MIM_JWT_SECRET 环境变量
 * （已登记 docs/wiki/09「应用自有机密」段），非生产环境回退本地文件。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'; // 四个文件系统同步 API：存在性判断、建目录、读密钥、写密钥
import { randomBytes } from 'node:crypto'; // 用 CSPRNG 生成 256 位密钥，避免 Math.random 可预测
import { dirname, resolve } from 'node:path'; // dirname 取上级目录、resolve 拼绝对路径，跨平台稳定
import { fileURLToPath } from 'node:url'; // 把 import.meta.url 的 file URL 转成本地文件路径

const SRC_DIR = dirname(fileURLToPath(import.meta.url)); // 当前文件所在目录（src），后续所有路径以它为基准

export const REPO_ROOT = resolve(SRC_DIR, '../../..'); // 上溯三级到仓库根，供 .mim-dev-secret 等开发态产物定位
export const DATA_DIR = resolve(SRC_DIR, '../data'); // 数据目录固定为 services/mim-api/data，本地驱动读写此处
export const DB_PATH = resolve(DATA_DIR, 'mim.db'); // SQLite 单文件库；生产由部署脚本指向持久化目录
export const SECRET_DIR = resolve(REPO_ROOT, '.mim-dev-secret'); // 开发态密钥目录，已列入 .gitignore 防误提交
export const SECRET_FILE = resolve(SECRET_DIR, 'jwt.key'); // 开发态密钥文件路径，首次运行自动生成

/** 标准环境变量，非 MIM_ 命名，不触发 env-check 模板校验 */
export const PORT = Number(process.env.PORT ?? 8787); // 端口走通用 PORT 约定以兼容托管平台，缺省 8787 便于本地直跑

export const ACCESS_TTL_SECONDS = 900; // 访问令牌 15 分钟，短有效期缩小泄漏窗口
export const REFRESH_TTL_SECONDS = 30 * 24 * 3600; // 刷新令牌 30 天，兼顾免频繁登录与可撤销性
export const CODE_TTL_SECONDS = 300; // 验证码 5 分钟过期，限制爆破时间窗
export const CODE_MAX_ATTEMPTS = 5; // 单个验证码最多试 5 次，超过即作废
export const CODE_LENGTH = 6; // 6 位数字，长度与用户输入体验及穷举成本平衡
export const CODE_RATE_LIMIT = 5; // 同一标识 10 分钟内最多发 5 条，抑制短信轰炸
export const CODE_RATE_WINDOW_MINUTES = 10; // 限流滑动窗口长度，单位为分钟
export const LOGIN_LOCK_AFTER_FAILURES = 5; // 连续 5 次密码错误即锁定账号
export const LOGIN_LOCK_MINUTES = 15; // 锁定 15 分钟后自动解锁，避免永久误锁
export const DELETION_GRACE_DAYS = 7; // 注销冷静期 7 天，期内可撤销删除

/** Mim ID 号码：对外可见的纯数字编号（QQ 号样式），注册时自动分配，与内部 uuidv7 主键解耦 */
export const MEMBER_NO_START = 1; // 号码空间从个位数起（1、2、3…），不补零、不带前缀，位数随量自然增长
export const MEMBER_NO_MAX = 9_999_999_999; // 十位上限：仍在 JS 安全整数内，超出即停止发号，避免位数失控
export const MEMBER_NO_SKIP_GUARD = 1_000_000; // 连续跳过靓号的上限，规则写错时快速失败而不是死循环

/** OAuth 第三方登录：授权 state 与一次性登录票据的有效期 */
export const OAUTH_STATE_TTL_SECONDS = 600; // 授权链接 10 分钟有效，覆盖用户在提供方页面停留与二次验证
export const OAUTH_TICKET_TTL_SECONDS = 300; // 回调票据 5 分钟有效，只在 302 与一次兑换之间存活
export const OAUTH_HTTP_TIMEOUT_MS = 10_000; // 调用提供方 token / userinfo 的超时，避免外部挂起拖死请求

/** 写操作必须携带 Idempotency-Key（08 §3.3）；auth 端点天然非幂等，已豁免 */
export const REQUIRE_IDEMPOTENCY = true; // 全局开关：控制写路由是否强制幂等键，便于灰度或本地调试关闭

/**
 * 管理面鉴权令牌（超管引导通道，与 RBAC 并存）。
 *
 * 鉴权双通道：
 *   1. 主通道 —— Bearer JWT + RBAC：`requirePermission(code)` 每请求实时查 user_roles / role_permissions，
 *      撤销授权立即生效，权限点见 db.ts 的 RBAC_PERMISSIONS。
 *   2. 引导通道 —— 本常量对应的 `x-admin-token` 头：用于冷启动（库里还没有任何 superadmin 用户时）
 *      先登录后台，把 superadmin 授给真实用户；命中后等同全权限（req.adminBootstrap = true）。
 *
 * 注意：不在模块顶层缓存该值——中间件从 req.deps.env 读取，测试可直接注入而无需改全局 process.env。
 * 未配置环境变量时引导通道直接失效（返回 false），管理端点仅接受 RBAC 通道，不暴露任何匿名管理能力。
 */
export const ADMIN_TOKEN_ENV_KEY = 'MIM_ADMIN_TOKEN'; // 只导出键名常量，避免多处手写字符串拼错

/** 后台定时任务总开关：默认开启；多副本部署只让一个实例消费时设 MIM_JOBS=0 */
export const JOBS_ENABLED = (process.env.MIM_JOBS ?? '1') !== '0'; // 显式 0 才关闭，其余取值均视为开启，避免拼写错误导致任务静默不跑

/**
 * JWT 密钥加载（优先级从高到低）：
 * 1. `MIM_JWT_SECRET` 环境变量（生产必配，systemd 经 /opt/mim/mim-api.env 注入）；
 * 2. 非生产环境回退到本地 `.mim-dev-secret/jwt.key`（首次运行自动生成，已在 .gitignore 中）。
 * 生产环境缺失密钥即拒绝启动，避免静默使用可预测的本地文件密钥。
 */
export function loadJwtSecret(): string { // 启动期调用一次，返回可用的 HS256 密钥
  const fromEnv = process.env.MIM_JWT_SECRET?.trim(); // 优先读环境变量并去空白，容忍复制粘贴带入的换行
  if (fromEnv) { // 环境变量存在即走生产路径
    if (fromEnv.length < 32) { // HS256 要求足够熵，短密钥易被离线破解
      throw new Error('MIM_JWT_SECRET 长度不足 32 字符，无法满足 HS256 签名要求'); // 直接失败而不是静默降级
    } // if 结束：密钥长度达标才继续
    return fromEnv; // 合规密钥直接返回，不落盘
  } // if 结束：环境变量分支处理完毕
  if (process.env.NODE_ENV === 'production') { // 生产环境缺失密钥必须拒绝启动
    throw new Error('生产环境必须通过 MIM_JWT_SECRET 注入 JWT 密钥（deploy.sh §5 生成 /opt/mim/mim-api.env）'); // 报错信息直接给出修复路径
  } // if 结束：生产环境缺密钥已在此终止
  if (existsSync(SECRET_FILE)) { // 非生产：复用上次生成的本地密钥，避免重启后 token 全失效
    const value = readFileSync(SECRET_FILE, 'utf8').trim(); // 读取并去掉文件尾部换行
    if (value.length >= 32) return value; // 长度达标才复用，否则视为损坏并重新生成
  } // if 结束：本地密钥文件分支处理完毕
  mkdirSync(SECRET_DIR, { recursive: true }); // 目录不存在则递归创建，首次运行必需
  const secret = randomBytes(32).toString('hex'); // 生成 32 字节随机密钥（64 位十六进制字符）
  writeFileSync(SECRET_FILE, secret, { encoding: 'utf8' }); // 落盘供下次启动复用
  return secret; // 首次运行返回新生成的密钥
} // loadJwtSecret 结束
