/**
 * 社区列表骨架屏（2026-11-25 由 Community.tsx 拆分）：
 * 结构与 .community-card 一致（10:7 封面 + 元信息 / 两行标题 / 摘要 / 数据行），
 * 加载完成后原位替换不跳动。
 */

/** 列表骨架：6 张占位卡片，纯展示无状态 */
export function ThreadSkeleton() {
  return (
    <>
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="community-skeleton-card">
          <div className="skeleton community-skeleton-cover" />
          <div className="community-skeleton-body">
            <span className="skeleton skeleton-line short" />
            <span className="skeleton skeleton-line tall" />
            <span className="skeleton skeleton-line tall mid" />
            <span className="skeleton skeleton-line thin" />
            <span className="skeleton skeleton-line thin mid" />
            <span className="skeleton skeleton-line short" />
          </div>
        </div>
      ))}
    </>
  );
}
