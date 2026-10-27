/* 文章详情 —— 重建占位，等待实现 */
import { Empty } from '@/ui'

export interface ArticleDetailPageProps {
  id: string
}

export function ArticleDetailPage({ id }: ArticleDetailPageProps) {
  return (
    <div className="page">
      <Empty emoji="🚧" text={`文章详情 待实现：${[id].filter(Boolean).join(' / ')}`} />
    </div>
  )
}
