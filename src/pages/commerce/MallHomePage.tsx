/* 商城中心 —— 重建占位，等待实现 */
import { Empty } from '@/ui'
import type { MallChannel } from '@/domain/commerce/model'

export interface MallHomePageProps {
  initial?: MallChannel
}

export function MallHomePage({ initial }: MallHomePageProps) {
  return (
    <div className="page">
      <Empty emoji="🚧" text={`商城中心 待实现：${[initial].filter(Boolean).join(' / ')}`} />
    </div>
  )
}
