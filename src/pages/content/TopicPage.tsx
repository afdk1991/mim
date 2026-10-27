/* 话题页 —— 重建占位，等待实现 */
import { Empty } from '@/ui'

export interface TopicPageProps {
  name: string
}

export function TopicPage({ name }: TopicPageProps) {
  return (
    <div className="page">
      <Empty emoji="🚧" text={`话题页 待实现：${[name].filter(Boolean).join(' / ')}`} />
    </div>
  )
}
