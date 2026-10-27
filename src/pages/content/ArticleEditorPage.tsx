/* 文章编辑器 —— 重建占位，等待实现 */
import { Empty } from '@/ui'

export interface ArticleEditorPageProps {
  draftId?: string
  editId?: string
}

export function ArticleEditorPage({ draftId, editId }: ArticleEditorPageProps) {
  return (
    <div className="page">
      <Empty emoji="🚧" text={`文章编辑器 待实现：${[draftId, editId].filter(Boolean).join(' / ')}`} />
    </div>
  )
}
