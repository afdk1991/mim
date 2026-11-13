/**
 * 社区三期：板块名称 / 简介本地敏感词校验。
 *
 * 远程文本审核（auditText）仍用于帖子正文；板块名这类短文本先走本地词表快速拦截，
 * 避免明显违规名称进入待审核队列。词表来自环境变量 MIM_COMMUNITY_BLOCK_WORDS（逗号分隔），
 * 未配置时为空表，不拦截任何内容，保证既有种子与默认行为不变。
 */

/** 解析环境变量词表：逗号分隔，去空白与空项，统一小写匹配。 */
export function blockedWords(env: Record<string, string | undefined>): string[] {
  return (env.MIM_COMMUNITY_BLOCK_WORDS ?? '') // 返回当前函数的处理结果
    .split(',') // 执行当前业务步骤
    .map((word) => word.trim().toLowerCase()) // 执行当前业务步骤
    .filter(Boolean); // 执行当前业务步骤
} // 代码块结束

/**
 * 命中校验：返回命中的敏感词；未命中返回 null。
 * 匹配为小写子串包含，词表与待检文本都做归一化。
 */
export function findBlockedWord(env: Record<string, string | undefined>, text: string): string | null {
  const haystack = text.trim().toLowerCase(); // 常量 haystack：保存固定配置或一次性派生值
  if (!haystack) return null; // 条件分支：按判断结果选择后续处理路径
  for (const word of blockedWords(env)) { // 循环：逐项遍历集合并执行相同处理
    if (haystack.includes(word)) return word; // 条件分支：按判断结果选择后续处理路径
  } // 代码块结束
  return null; // 返回当前函数的处理结果
} // 代码块结束
