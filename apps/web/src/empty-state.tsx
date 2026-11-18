/**
 * 空态共享组件（2026-11-18）：把各视图纯文字空态换成「插图 + 标题 + 说明 + 操作」结构。
 *
 * 插图取自已入库的子比主题静态素材（apps/web/public/zib/img，正版授权域名 laal.top），
 * 只复用 SVG 视觉，不引入 PHP / jQuery / 授权校验代码；素材路径按构建期 BASE_URL 拼接，
 * 兼容 GitHub Pages 等 /mim/ 子路径部署。
 */

// 仅类型导入：操作槽位允许传任意按钮 / 链接节点
import type { ReactNode } from 'react';

/** 空态类目：与 public/zib/img 下的 null-*.svg 一一对应，调用方按场景选图 */
export type EmptyKind =
  | 'post' // 帖子 / 内容列表空
  | 'search' // 搜索无结果
  | 'order' // 订单 / 售后 / 提现申请空
  | 'money' // 钱包流水 / 余额记录空
  | 'user' // 账号 / 成员相关空
  | 'love' // 收藏 / 点赞相关空
  | 'cart' // 货架 / 购物车空
  | 'set' // 设置 / 配置项空
  | 'cap' // 权限 / 名额相关空
  | 'default'; // 兜底插图

/** 类目 → 静态素材路径映射：集中在一处，换图只改本表 */
const EMPTY_ICON: Record<EmptyKind, string> = {
  post: 'zib/img/null-post.svg', // 帖子空态
  search: 'zib/img/null-search.svg', // 搜索无结果
  order: 'zib/img/null-order.svg', // 订单 / 售后空态
  money: 'zib/img/null-money.svg', // 流水 / 资金记录空态
  user: 'zib/img/null-user.svg', // 用户 / 成员空态
  love: 'zib/img/null-love.svg', // 收藏空态
  cart: 'zib/img/null-2.svg', // 货架空态
  set: 'zib/img/null-set.svg', // 设置空态
  cap: 'zib/img/null-cap.svg', // 名额 / 权限空态
  default: 'zib/img/null.svg', // 兜底空态
};

/** 空态组件入参：标题必填，说明与操作按钮可选 */
interface EmptyStateProps {
  kind?: EmptyKind; // 插图类目，缺省走兜底图
  title: string; // 空态标题：一句话说明当前状态
  hint?: string; // 补充说明：引导下一步动作
  action?: ReactNode; // 操作槽位：重试 / 去发帖等按钮，由调用方决定形态
} // 入参结构结束

/** 站内静态素材地址：BASE_URL 前缀 + 去掉前导斜杠的相对路径 */
function staticAsset(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`; // 子路径部署下资源仍能正确解析
} // staticAsset 结束

/**
 * 空态渲染：沿用全站 `.community-empty` 表面与留白，追加 `.empty-state` 挂插图样式。
 * 不自带按钮行为：操作槽位由调用方传入，保证重试 / 跳转口径与所在视图一致。
 */
export function EmptyState({ kind = 'default', title, hint, action }: EmptyStateProps) {
  return (
    <div className="community-empty empty-state">{/* 复用既有空态表面，避免两套留白 */}
      <img
        className="empty-state-icon" // 插图尺寸与留白由 CSS 统一控制
        src={staticAsset(EMPTY_ICON[kind])} // 按类目取对应 SVG
        alt="" // 插图为装饰性，屏幕阅读器不朗读
        aria-hidden="true" // 装饰图标记，避免与标题重复播报
        loading="lazy" // 空态不在首屏关键路径，懒加载
      />
      <strong>{title}</strong>{/* 空态标题：主文字层级 */}
      {hint && <span>{hint}</span>}{/* 补充说明：可选，缺省不渲染节点 */}
      {action}{/* 操作槽位：可选，缺省纯展示空态 */}
    </div>
  );
} // EmptyState 结束
