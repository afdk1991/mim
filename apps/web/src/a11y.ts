// 无障碍焦点工具：弹窗 / 抽屉 / 下拉面板复用的焦点查询与焦点陷阱 Hook。
// 本文件只做焦点管理，不引入任何第三方依赖；语义角色由调用方在 JSX 上声明。
import { useEffect, useRef } from 'react'; // React 副作用与引用 Hook
// 仅类型导入：面板元素泛型
import type { RefObject } from 'react';

/** 可聚焦元素选择器：链接、按钮、表单控件与显式 tabindex≥0 的元素。 */
export const FOCUSABLE_SELECTOR = [ // 选择器清单
  'a[href]', // 带地址的链接
  'button:not([disabled])', // 可用按钮
  'input:not([disabled])', // 可用输入框
  'select:not([disabled])', // 可用下拉
  'textarea:not([disabled])', // 可用多行输入
  '[tabindex]:not([tabindex="-1"])', // 显式可聚焦元素
].join(', '); // 合并为复合选择器

/**
 * 取容器内按 DOM 顺序排列的可聚焦元素。
 * 禁用元素与带 aria-hidden 的元素不计入，避免 Tab 落到不可用控件上。
 */
export function getFocusable(container: HTMLElement | null): HTMLElement[] { // 焦点列表查询
  if (!container) return []; // 空容器直接返回空数组
  const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)); // 查询全部候选
  return nodes.filter((el) => { // 逐项过滤不可用项
    if (el.hasAttribute('disabled')) return false; // 禁用元素不可聚焦
    if (el.closest('[aria-hidden="true"]')) return false; // 自身或祖先在装饰容器内则排除
    return true; // 其余计入可聚焦列表
  }); // 过滤结束
} // 焦点列表结束

/**
 * 弹窗焦点陷阱 Hook：
 *   - 打开时把焦点移入面板，面板获得 tabindex=-1 以承接初始焦点；
 *   - Tab / Shift+Tab 在面板首尾循环，焦点不落到背后页面；
 *   - Esc 触发 onClose 关闭；
 *   - 关闭后把焦点归还给打开弹窗前的触发元素。
 *
 * @param open 弹窗是否打开；false 时不绑定监听
 * @param onClose 关闭回调（Esc 触发），由调用方传入稳定引用
 * @returns 面板元素引用，挂到弹窗根节点上
 */
export function useDialogTrap<T extends HTMLElement>(open: boolean, onClose: () => void): RefObject<T> { // 陷阱 Hook
  const panelRef = useRef<T | null>(null); // 面板节点引用
  const restoreRef = useRef<HTMLElement | null>(null); // 关闭前持有的焦点元素

  useEffect(() => { // 打开期间绑定键盘与焦点归还逻辑
    if (!open) return; // 未打开不挂监听
    restoreRef.current = document.activeElement as HTMLElement | null; // 记录触发元素
    const panel = panelRef.current; // 取面板节点
    if (panel) panel.focus(); // 焦点进入面板

    const onKeyDown = (event: KeyboardEvent): void => { // 键盘事件处理
      if (event.key === 'Escape') { // Esc 关闭弹窗
        event.preventDefault(); // 阻止冒泡到页面级快捷键
        onClose(); // 回调关闭
        return; // 不再继续 Tab 处理
      } // Esc 分支结束
      if (event.key !== 'Tab' || !panel) return; // 只拦截 Tab 键
      const items = getFocusable(panel); // 面板内可聚焦列表
      if (items.length === 0) { event.preventDefault(); return; } // 无可聚焦项时拦截 Tab
      const first = items[0]; // 首项
      const last = items[items.length - 1]; // 末项
      const active = document.activeElement; // 当前焦点元素
      if (event.shiftKey && active === first) { // Shift+Tab 离开首项
        event.preventDefault(); // 默认回退行为拦截
        last.focus(); // 循环到末项
      } else if (!event.shiftKey && active === last) { // Tab 离开末项
        event.preventDefault(); // 默认前进行为拦截
        first.focus(); // 循环回首项
      } // 首尾循环结束
    }; // 键盘处理结束

    window.addEventListener('keydown', onKeyDown); // 绑定全局键盘监听
    return () => { // 卸载 / 关闭时清理
      window.removeEventListener('keydown', onKeyDown); // 解绑监听
      restoreRef.current?.focus?.(); // 焦点归还触发元素
    }; // 清理结束
  }, [open, onClose]); // 依赖：打开态与关闭回调

  return panelRef; // 返回面板引用
} // 陷阱 Hook 结束
