/* ==========================================================================
 * Provider 栈 —— 统一组装，避免入口文件里层层嵌套难以维护
 *
 * 顺序有讲究：Router 在最外层（任何层都可能需要跳转），
 * Toast 次之（领域层要能直接提示），随后才是业务状态。
 * ======================================================================== */

import type { ReactNode } from 'react'
import { RouterProvider } from './router'
import { ToastProvider } from '../ui'
import { AppProvider } from './state/content'
import { MallProvider } from './state/mall'

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <RouterProvider>
      <ToastProvider>
        <AppProvider>
          <MallProvider>{children}</MallProvider>
        </AppProvider>
      </ToastProvider>
    </RouterProvider>
  )
}
