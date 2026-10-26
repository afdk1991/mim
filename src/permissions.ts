/* 统一权限模型 —— 能力守卫
   身份两态：guest（未登录游客）| cloud（云端登录）—— 本地模式已移除。
   内容归属以当前身份 meId 为界：作者本人可删/编，其他人均不可。
   分层策略：UI 层用 can() 控制按钮显隐；reducer 内再做 ownership 校验静默兜底（防越权调用）；
   云端 RLS（author_id = auth.uid()）管真实边界 —— 本地守卫管客户端体验，双保险。 */

export type AuthMode = 'guest' | 'cloud'

export type PermAction =
  | 'post:delete'
  | 'article:edit'
  | 'article:delete'
  | 'snippet:delete'
  | 'profile:edit'

/** 判定当前身份能否对目标内容执行操作。target.authorId 为内容的作者 id（meId 域）。
    游客与云端登录共用同一 ownership 规则：只有作者本人可操作。 */
export function can(
  _mode: AuthMode,
  meId: string,
  action: PermAction,
  target: { authorId: string },
): boolean {
  switch (action) {
    case 'post:delete':
    case 'article:edit':
    case 'article:delete':
    case 'snippet:delete':
    case 'profile:edit':
      // 目前所有动作同一规则（仅作者本人）；新增动作时此处会强制编译期决策
      return target.authorId === meId
  }
}
