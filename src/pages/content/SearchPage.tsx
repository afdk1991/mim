/* 搜索结果 —— 重建占位，等待实现 */
import { Empty } from '@/ui'

export interface SearchPageProps {
  q: string
}

export function SearchPage({ q }: SearchPageProps) {
  return (
    <div className="page">
      <Empty emoji="🚧" text={`搜索结果 待实现：${[q].filter(Boolean).join(' / ')}`} />
    </div>
  )
}
