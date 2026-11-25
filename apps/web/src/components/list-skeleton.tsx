/**
 * 列表 / 详情骨架统一组件（2026-11-25）。
 *
 * 只复用 styles.css 已有的骨架样式类（.skeleton / .skeleton-line 修饰档 /
 * .community-skeleton-card / .community-skeleton-cover / .community-skeleton-body /
 * .detail-skeleton），不在此文件新造一套样式；骨架尺寸对齐真实卡片，
 * 请求结束后由真实内容或空态原位替换，不造成布局跳动。
 */

/** 骨架条数缺省值：个人聚合区块默认 3 行，圈子列表沿用既有 6 张卡片口径 */
const DEFAULT_ROWS = 3; // 缺省骨架行数

/** 列表骨架入参：条数 + 形态（card=带封面的网格卡；row=无封面的纯文本行） */
interface ListSkeletonProps {
  count?: number; // 骨架条数，缺省 3
  variant?: 'card' | 'row'; // 列表形态：卡片网格或纯文本行
} // 入参结构结束

/** 卡片形态骨架：结构与 .community-card 一致（封面 + 标题行 + 摘要行 + 数据行） */
function CardSkeleton({ index }: { index: number }) { // 单张卡片骨架
  return (
    <div key={index} className="community-skeleton-card">{/* 与真实列表卡同网格同比例 */}
      <div className="skeleton community-skeleton-cover" />{/* 封面槽位：与真实封面同比例 */}
      <div className="community-skeleton-body">{/* 卡片内容区：行距与内距对齐真实卡片 */}
        <span className="skeleton skeleton-line short" />{/* 元信息短行 */}
        <span className="skeleton skeleton-line tall" />{/* 标题第一行 */}
        <span className="skeleton skeleton-line tall mid" />{/* 标题第二行 */}
        <span className="skeleton skeleton-line thin" />{/* 摘要行 */}
        <span className="skeleton skeleton-line thin mid" />{/* 摘要第二行 */}
        <span className="skeleton skeleton-line short" />{/* 数据行 */}
      </div>
    </div>
  ); // 卡片骨架结束
} // CardSkeleton 结束

/** 文本行形态骨架：无封面，对齐收藏 / 圈子 / 举报这类纯文本列表行 */
function RowSkeleton({ index }: { index: number }) { // 单行骨架
  return (
    <li key={index} className="deploy-row">{/* 与真实列表行同表面 */}
      <span className="skeleton skeleton-line tall mid" style={{ flex: 1 }} />{/* 标题占位：占满剩余宽度 */}
      <span className="skeleton skeleton-line thin short" />{/* 元信息占位短行 */}
    </li>
  ); // 行骨架结束
} // RowSkeleton 结束

/** 列表骨架：按形态渲染 N 条占位；加载结束后调用方用真实列表或空态替换 */
export function ListSkeleton({ count = DEFAULT_ROWS, variant = 'row' }: ListSkeletonProps) { // 导出入口
  const rows = Array.from({ length: count }, (_, index) => index); // 生成 0..count-1 序号
  if (variant === 'card') { // 卡片网格形态
    return (
      <div className="commerce-grid tools-grid" role="status" aria-label="loading">{/* 与真实网格同一容器类 */}
        {rows.map((index) => <CardSkeleton key={index} index={index} />)}
      </div>
    ); // 卡片骨架结束
  } // 文本行形态
  return (
    <ul className="plain-list" role="status" aria-label="loading">{/* 与真实无样式列表同一容器类 */}
      {rows.map((index) => <RowSkeleton key={index} index={index} />)}
    </ul>
  ); // 行骨架结束
} // ListSkeleton 结束

/** 详情骨架：对齐 .detail-skeleton 的标题 + 多行正文结构，供详情类区块首屏占位 */
export function DetailSkeleton() { // 导出入口
  return (
    <div className="detail-skeleton" role="status" aria-label="loading">{/* 与详情页骨架同一表面 */}
      <span className="skeleton skeleton-line short" />{/* 面包屑 / 分类短行 */}
      <span className="skeleton skeleton-line heading" />{/* 大标题行 */}
      <span className="skeleton skeleton-line mid" />{/* 副标题行 */}
      <span className="skeleton skeleton-line" />{/* 正文第一行 */}
      <span className="skeleton skeleton-line" />{/* 正文第二行 */}
      <span className="skeleton skeleton-line thin mid" />{/* 摘要行 */}
      <span className="skeleton skeleton-line thin" />{/* 摘要短行 */}
    </div>
  ); // 详情骨架结束
} // DetailSkeleton 结束
