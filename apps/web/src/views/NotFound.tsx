// 独立 404 视图：未知路径不再静默回落首页，停留在明确的未找到页面并给出出口
import type { AppView } from '../router'; // 仅类型导入：视图标识
import { EmptyState } from '../empty-state'; // 复用全站空态插图与表面

/** 404 视图入参：回首页 / 去社区都走上层统一跳转入口 */
interface NotFoundProps {
  onNavigate: (view: AppView) => void; // 统一跳转回调，与主导航同一口径
} // 入参结构结束

/** 独立 404：空态插图 + 标题说明 + 两个返回动作，刷新后仍停留在本页 */
export function NotFound({ onNavigate }: NotFoundProps) {
  return (
    <EmptyState
      kind="cap" // 名额 / 未命中类插图
      title="页面不存在" // 空态标题：明确地址未找到
      hint="你访问的地址有误，或对应内容已被移除。" // 补充说明：区分失效与输错
      action={
        <div className="legal-actions">
          {/* 回首页：落到门户首页 */}
          <button type="button" className="btn primary" onClick={() => onNavigate('home')}>返回首页</button>
          {/* 去社区：落到匿名可读的社区列表 */}
          <button type="button" className="btn ghost" onClick={() => onNavigate('community')}>去社区</button>
        </div>
      }
    />
  );
} // NotFound 结束
