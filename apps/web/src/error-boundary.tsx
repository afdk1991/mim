// 错误边界：class 组件才能捕获子树渲染期异常，函数组件没有 componentDidCatch 钩子
import { Component } from 'react';
// 仅类型导入：子节点与语言枚举，避免把类型打进产物
import type { ReactNode } from 'react';
import type { Locale } from '@mim/i18n';

/** 边界入参：被包裹的子树 + 当前语言 + 回首页回调（重试由边界内直接刷新页面） */
interface ErrorBoundaryProps {
  children: ReactNode; // 被包裹的整棵视图子树
  locale: Locale; // 当前语言：兜底文案按语言分流
  onGoHome: () => void; // 「回首页」动作：交回上层路由跳转，边界自身不感知视图
} // 入参结构结束

/** 边界内部状态：是否已捕获异常 + 错误摘要（仅用于界面提示，不上报远端） */
interface ErrorBoundaryState {
  hasError: boolean; // 是否已进入错误兜底态
  message: string; // 错误信息摘要：从 Error / 普通异常归一化为字符串
} // 状态结构结束

/**
 * 全站错误边界：子树任意组件渲染抛错时，componentDidCatch 记录日志并切到兜底 UI。
 * 注意：边界只兜「渲染期」异常；接口失败仍由各视图自己的 error 通道处理，不在此吞掉。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  // 初始状态：未捕获异常，正常渲染子树
  state: ErrorBoundaryState = { hasError: false, message: '' };

  // 派生兜底态：只要进入本方法就展示兜底 UI；错误详情走 componentDidCatch 记日志
  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    const message = error instanceof Error ? error.message : String(error); // 归一化错误摘要
    return { hasError: true, message }; // 标记进入错误态并保留摘要
  }

  // 捕获渲染异常：控制台留痕便于排查；不弹远端告警，也不静默吞掉错误
  componentDidCatch(error: unknown, info: { componentStack?: string }): void {
    console.error('[Mim] 页面渲染异常', error, info.componentStack); // 打印错误与组件栈，供本地 / 控制台排查
  }

  // 渲染分发：正常态透传子树，异常态给「重试 + 回首页」兜底卡片
  render() {
    if (!this.state.hasError) return this.props.children; // 未出错：原样渲染子树
    const zh = this.props.locale !== 'en-US'; // 中文判定：后台语言默认 zh
    return (
      // 复用门禁页居中容器表面，避免再造一套错误态视觉
      <div className="gate-shell">
        <div className="gate-card">
          <span className="gate-mark" aria-hidden="true" />{/* 与导航同族的主色标记 */}
          <h2 className="gate-title">{zh ? '页面出了点问题' : 'Something went wrong'}</h2>
          <p className="gate-text">
            {zh
              ? '当前页面渲染中断，可以刷新重试；若问题反复出现，请回到首页后再试。'
              : 'This page failed to render. Reload to retry, or go back home.'}
          </p>
          {/* 错误摘要：仅本地展示，不暴露堆栈给访客 */}
          {this.state.message && <p className="chat-error">{this.state.message}</p>}
          <div className="community-wallet-actions">
            {/* 重试：整页刷新，重新拉取配置与视图状态 */}
            <button type="button" className="btn primary" onClick={() => window.location.reload()}>
              {zh ? '重试' : 'Reload'}
            </button>
            {/* 回首页：交回上层路由跳到门户首页，避免边界自己操作地址栏 */}
            <button type="button" className="btn ghost" onClick={this.props.onGoHome}>
              {zh ? '回首页' : 'Go home'}
            </button>
          </div>
        </div>
      </div>
    );
  }
} // ErrorBoundary 结束
