/**
 * 社区视图纯函数（2026-11-25 由 Community.tsx 拆分）：
 * 分页窗口、账号脱敏、金额 / 封面 / 徽章 / 日期 / 体积等展示口径。
 * 不依赖 React 与组件状态。
 */

// 金额格式化单一实现，避免各视图各拼「¥」
import { formatCurrency } from '@mim/i18n';
// 公开地址归一化：签名链接补 API 源，静态素材补 BASE_URL
import { resolvePublicUrl } from '../../api/request.js';

/** 数字分页窗口：总页数 ≤7 全列；否则首末页 + 当前页前后各一页，中间省略号折叠 */
export function pagerWindow(current: number, total: number): Array<number | '…'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1); // 短页全列
  const pages: Array<number | '…'> = [1]; // 首页恒显
  const lo = Math.max(2, current - 1); // 左邻页下限
  const hi = Math.min(total - 1, current + 1); // 右邻页上限
  if (lo > 2) pages.push('…'); // 左侧折叠
  for (let i = lo; i <= hi; i++) pages.push(i); // 当前邻页
  if (hi < total - 1) pages.push('…'); // 右侧折叠
  pages.push(total); // 末页恒显
  return pages;
}

/** 收款账号脱敏：只保留首 2 位与末 4 位，列表页不展示完整账号 */
export function maskAccount(account: string): string {
  if (account.length <= 6) return account; // 太短无法脱敏，原样返回
  return `${account.slice(0, 2)}****${account.slice(-4)}`;
}

export function yuan(cents: number): string {
  return formatCurrency(cents, 'CNY', 'zh-CN'); // 社区钱包 / 商城文案均为中文界面，按中文人民币口径输出
}

export function coverSrc(url: string | null): string {
  if (!url) return ''; // 条件分支：按判断结果选择后续处理路径
  return resolvePublicUrl(url); // 绝对地址、/api/ 签名链接、/catalog 等静态前缀由解析器分流
}

/** VIP 等级徽章：等级 ≥2 走紫色 vip-2，其余走金色 vip-1；路径按 BASE_URL 拼接兼容子路径部署。 */
export function vipBadge(level: number): string {
  const file = level >= 2 ? 'vip-2.svg' : 'vip-1.svg'; // 高等级紫、普通等级金
  return `${import.meta.env.BASE_URL}zib/img/${file}`; // 静态资源补前缀
}

export function dateOnly(iso: string | null): string {
  return iso ? iso.slice(0, 10) : ''; // 返回当前函数的处理结果
}

export function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '未知大小'; // 0 表示服务端未记录，直接提示未知
  if (bytes < 1024) return `${bytes} B`; // 不足 1KB 按字节展示
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`; // 不足 1MB 按 KB 展示
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`; // 其余按 MB 展示
}
