// 悬浮按钮层：右下 / 左下的回到顶部、联系入口与分享面板。
// 取值全部来自站点选项（后台可开关），本组件只负责渲染与交互，不做任何兜底配置判断以外的业务决策。

import { useEffect, useState } from 'react'; // 本地状态与滚动监听
import type { SiteOptions } from './site-options'; // 站点选项结构

/** 分享渠道到外链的映射：微信无法网页直分享，只提示复制 + 打开微信 */
const SHARE_URL = {
  weibo: (url: string, title: string) => `https://service.weibo.com/share/share.php?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`, // 微博分享
  qq: (url: string, title: string) => `https://connect.qq.com/widget/shareqq/index.html?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`, // QQ 分享
  x: (url: string, title: string) => `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`, // X 分享
}; // 映射结束

/** 渠道中文名：按钮与无障碍标签共用 */
const SHARE_LABEL: Record<string, string> = { wechat: '微信', weibo: '微博', qq: 'QQ', x: 'X', copy: '复制链接' }; // 标签表

/** 入参：站点选项 + 语言 */
interface Props {
  options: SiteOptions; // 站点选项
  locale: string; // 当前语言（en-US 为英文）
} // Props 结束

/** 悬浮按钮层：只在选项开启时渲染，滚动超过一屏才出现「回到顶部」 */
export function FloatingActions({ options, locale }: Props) {
  const [showTop, setShowTop] = useState(false); // 「回到顶部」是否可点（滚动阈值）
  const [shareOpen, setShareOpen] = useState(false); // 分享面板开合
  const [copied, setCopied] = useState(false); // 复制成功的瞬时提示

  useEffect(() => {
    function onScroll() {
      setShowTop(window.scrollY > 480); // 超过约一屏即展示回到顶部
    } // onScroll 结束
    onScroll(); // 首帧同步一次，避免刷新后停在中段却没有按钮
    window.addEventListener('scroll', onScroll, { passive: true }); // 被动监听，不阻塞滚动
    return () => {
      window.removeEventListener('scroll', onScroll); // 卸载清理
    }; // 清理结束
  }, []); // 只挂一次

  if (!options.floatingEnabled) return null; // 总开关关闭即不渲染

  const side = options.floatingPosition === 'left' ? 'left' : 'right'; // 位置
  const canShare = options.shareEnabled && options.sharePlatforms.length > 0; // 分享面板是否可用
  const title = document.title; // 分享标题取当前页面标题

  /** 点击分享渠道：能直达外链的直接开新窗，微信与复制走剪贴板 */
  function handleShare(channel: string) {
    const url = window.location.href; // 当前地址
    if (channel === 'copy' || channel === 'wechat') {
      void navigator.clipboard
        ?.writeText(url)
        .then(() => {
          setCopied(true); // 提示已复制
          window.setTimeout(() => setCopied(false), 1600); // 1.6 秒后收回
        })
        .catch(() => {
          setCopied(false); // 剪贴板不可用时不谎报成功
        });
      return; // 走剪贴板分支
    }
    const build = SHARE_URL[channel as keyof typeof SHARE_URL]; // 取映射函数
    if (!build) return; // 未知渠道不处理
    window.open(build(url, title), '_blank', 'noopener,noreferrer'); // 新窗打开
  } // handleShare 结束

  return (
    <div className={`float-actions ${side}`} aria-label={locale === 'en-US' ? 'Quick actions' : '快捷操作'}>
      {canShare && (
        <>
          {shareOpen && (
            <div className="float-share" role="menu">
              {options.sharePlatforms.map((channel) => (
                <button key={channel} type="button" className="float-share-item" onClick={() => handleShare(channel)}>
                  {SHARE_LABEL[channel] ?? channel}
                </button>
              ))}
              {copied && <span className="float-share-tip">{locale === 'en-US' ? 'Link copied' : '链接已复制'}</span>}
            </div>
          )}
          <button
            type="button"
            className="float-btn"
            onClick={() => setShareOpen((open) => !open)}
            aria-expanded={shareOpen}
            title={locale === 'en-US' ? 'Share' : '分享'}
          >
            {locale === 'en-US' ? 'Share' : '分享'}
          </button>
        </>
      )}
      {options.floatingContact && (
        <a
          className="float-btn"
          href={options.floatingContactUrl || '#/community'}
          title={locale === 'en-US' ? 'Contact' : '联系'}
        >
          {locale === 'en-US' ? 'Contact' : '联系'}
        </a>
      )}
      {options.floatingBackToTop && showTop && (
        <button
          type="button"
          className="float-btn"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          title={locale === 'en-US' ? 'Back to top' : '回到顶部'}
        >
          ↑
        </button>
      )}
    </div>
  ); // 返回悬浮层
} // FloatingActions 结束
