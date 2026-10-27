/* 用户主页 —— 重建占位，等待实现 */
import { Empty } from '@/ui'

export interface ProfilePageProps {
  id: string
}

export function ProfilePage({ id }: ProfilePageProps) {
  return (
    <div className="page">
      <Empty emoji="🚧" text={`用户主页 待实现：${[id].filter(Boolean).join(' / ')}`} />
    </div>
  )
}
