/* 管理后台权限引导（首个管理员）
   -
   背景：注册触发器只分配默认角色 user，而 user_roles 的写策略要求调用者已是
   admin —— 若不显式引导，部署后没有任何人能进入 /#/admin。
   迁移 0010_admin_bootstrap.sql 在数据库侧提供两条通道：
     · has_any_admin()    系统是否已有管理员（据此决定是否显示自助引导）
     · bootstrap_admin()  仅当尚无管理员时，把当前登录用户提为 admin（门自动关闭）
   两者均只对 Supabase 后端可用；CloudBase 后端走 mim-api 云函数，无此 RPC。
*/

import { cloudBackend, supabase } from './supabase'

export type AdminBootstrapResult = {
  ok: boolean
  /** 面向用户的中文结果说明（成功/受限/失败原因） */
  msg: string
}

/** 后端是否支持引导 RPC（仅 Supabase 主后端） */
export function adminBootstrapSupported(): boolean {
  return cloudBackend === 'supabase' && !!supabase
}

/**
 * 查询系统当前是否已有管理员。
 * 查询失败（迁移未应用/无权限）时返回 null，调用方据此不显示引导按钮，
 * 退化为「联系已有管理员或执行 grant-admin.sql」的静态说明。
 */
export async function queryHasAnyAdmin(): Promise<boolean | null> {
  if (!adminBootstrapSupported()) return null
  try {
    const { data, error } = await supabase!.rpc('has_any_admin')
    if (error) return null
    return data === true
  } catch {
    return null
  }
}

/**
 * 自助成为首个管理员。仅在系统尚无管理员时成功；
 * 成功后调用方刷新页面（auth 的 roles 在会话恢复时重新拉取）。
 */
export async function bootstrapAdmin(): Promise<AdminBootstrapResult> {
  if (!adminBootstrapSupported()) {
    return { ok: false, msg: '当前后端不支持自助引导（仅 Supabase 主后端可用），请执行 supabase/grant-admin.sql' }
  }
  try {
    const { data, error } = await supabase!.rpc('bootstrap_admin')
    if (error) {
      const m = String(error.message ?? '')
      if (m.includes('does not exist') || m.includes('function')) {
        return { ok: false, msg: '数据库未应用 0010_admin_bootstrap.sql，请先执行迁移（npm run db:apply:remote）' }
      }
      return { ok: false, msg: `引导失败：${m}` }
    }
    if (data === true) return { ok: true, msg: '已成为首个管理员，正在刷新…' }
    return { ok: false, msg: '系统已存在管理员，自助引导通道已关闭。请联系现有管理员授权，或执行 supabase/grant-admin.sql' }
  } catch (err) {
    return { ok: false, msg: `引导失败：${String((err as Error)?.message ?? err)}` }
  }
}
