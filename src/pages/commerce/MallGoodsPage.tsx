/* 商品详情 —— 重建占位，等待实现 */
import { Empty } from '@/ui'

export interface MallGoodsPageProps {
  id: string
}

export function MallGoodsPage({ id }: MallGoodsPageProps) {
  return (
    <div className="page">
      <Empty emoji="🚧" text={`商品详情 待实现：${[id].filter(Boolean).join(' / ')}`} />
    </div>
  )
}
