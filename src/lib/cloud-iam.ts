/* IAM 云端读路径（Phase1 L1）：管理后台真实数据接入。
   角色管理页读 roles / permissions / role_permissions / user_roles；
   审计日志页读 audit_logs（仅 admin 可见，RLS is_admin）。
   任一查询失败或无登录会话返回 null，调用方静默降级到提示态。 */
import { supabase } from './supabase'

export interface IamRole {
  id: string
  name: string
  description: string
  createdAt: string
  /** 该角色当前绑定成员数（user_roles 计数） */
  members: number
  /** 该角色被授予的权限点 key（已排序） */
  permissionKeys: string[]
}

export interface AuditLogRow {
  id: number
  actorId: string | null
  action: string
  targetType: string
  targetId: string
  detail: Record<string, unknown>
  createdAt: string
}

/** 拉取 RBAC 参考数据：角色 + 各自权限点 + 成员数。 */
export async function fetchIamRoles(): Promise<IamRole[] | null> {
  if (!supabase) return null
  const { data: sess } = await supabase.auth.getSession()
  if (!sess.session?.user?.id) return null
  try {
    const [rolesR, permsR, rpR, urR] = await Promise.all([
      supabase
        .from('roles')
        .select('id, name, description, created_at')
        .order('created_at', { ascending: true }),
      supabase.from('permissions').select('id, key'),
      supabase.from('role_permissions').select('role_id, permission_id'),
      supabase.from('user_roles').select('role_id'),
    ])
    if (rolesR.error || permsR.error || rpR.error || urR.error) return null

    const roles = (rolesR.data ?? []) as Array<{ id: string; name: string; description: string; created_at: string }>
    const perms = (permsR.data ?? []) as Array<{ id: string; key: string }>
    const rps = (rpR.data ?? []) as Array<{ role_id: string; permission_id: string }>
    const urs = (urR.data ?? []) as Array<{ role_id: string }>

    const permKeyById = new Map<string, string>()
    for (const p of perms) permKeyById.set(p.id, p.key)

    const permIdsByRole = new Map<string, string[]>()
    for (const rp of rps) {
      const k = permKeyById.get(rp.permission_id)
      if (!k) continue
      const arr = permIdsByRole.get(rp.role_id) ?? []
      arr.push(k)
      permIdsByRole.set(rp.role_id, arr)
    }

    const memberCount = new Map<string, number>()
    for (const ur of urs) {
      memberCount.set(ur.role_id, (memberCount.get(ur.role_id) ?? 0) + 1)
    }

    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description ?? '',
      createdAt: r.created_at,
      members: memberCount.get(r.id) ?? 0,
      permissionKeys: (permIdsByRole.get(r.id) ?? []).sort(),
    }))
  } catch {
    return null
  }
}

/** 拉取审计日志（倒序，最近在前）。仅 admin 可见。 */
export async function fetchAuditLogs(limit = 100): Promise<AuditLogRow[] | null> {
  if (!supabase) return null
  const { data: sess } = await supabase.auth.getSession()
  if (!sess.session?.user?.id) return null
  try {
    const { data, error } = await supabase
      .from('audit_logs')
      .select('id, actor_id, action, target_type, target_id, detail, created_at')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) return null
    const rows = (data ?? []) as Array<{
      id: number
      actor_id: string | null
      action: string
      target_type: string
      target_id: string
      detail: Record<string, unknown>
      created_at: string
    }>
    return rows.map((a) => ({
      id: Number(a.id),
      actorId: a.actor_id ?? null,
      action: a.action ?? '',
      targetType: a.target_type ?? '',
      targetId: a.target_id ?? '',
      detail: (a.detail as Record<string, unknown>) ?? {},
      createdAt: a.created_at,
    }))
  } catch {
    return null
  }
}
