/** 跨路由复用的领域读取：统一时间源 */

import type { ApiDeps } from './types.js';

export function clockOf(deps: ApiDeps): string {
  return deps.now ? deps.now() : new Date().toISOString();
}
