/**
 * Mim Web API 客户端（桶导出）。
 *
 * 2026-11-14 P1-A 拆分：本文件从 2449 行收敛为桶，实际实现分三处 ——
 *   ./api/types.ts      类型声明（无运行时副作用）
 *   ./api/request.ts    请求核心与会话管理（原 API_ORIGIN / SESSION / request / ApiError）
 *   ./api/endpoints.ts  22 个业务域端点对象 api.<域>.<方法>
 * 对外符号名与 import 路径（@/api 或 ../api.js）保持不变，调用方无需改动。
 */

export * from './api/types.js'; // 全部类型声明
export * from './api/request.js'; // 会话、请求核心、错误类型与 i18n 错误文案
export { api } from './api/endpoints.js'; // 22 个业务域端点集合（对象形状与原 api.ts 完全一致）
