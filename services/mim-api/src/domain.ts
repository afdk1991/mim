/** 跨路由复用的领域读取：统一时间源 */

import type { ApiDeps } from './types.js'; // 只取依赖容器类型，编译期擦除，不产生运行时 import

export function clockOf(deps: ApiDeps): string { // 取「当前时间」的统一入口，避免各处直接 new Date()
  return deps.now ? deps.now() : new Date().toISOString(); // 测试注入了固定时钟就用它，否则回退真实 ISO 时间，保证保留期判断可复现
} // clockOf 结束
