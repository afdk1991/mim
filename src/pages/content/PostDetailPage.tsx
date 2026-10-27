/* 动态详情 —— 重建占位，等待实现 */
import { Empty } from '@/ui'

export interface PostDetailPageProps {
  id: string
}

export function PostDetailPage({ id }: PostDetailPageProps) {
  return (
    <div className="page">
      <Empty emoji="🚧" text={`动态详情 待实现：${[id].filter(Boolean).join(' / ')}`} />
    </div>
  )
}
