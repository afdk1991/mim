/* 站点信息 —— 重建占位，等待实现 */
import { Empty } from '@/ui'

export interface InfoPageProps {
  slug: string
}

export function InfoPage({ slug }: InfoPageProps) {
  return (
    <div className="page">
      <Empty emoji="🚧" text={`站点信息 待实现：${[slug].filter(Boolean).join(' / ')}`} />
    </div>
  )
}
