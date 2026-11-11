/** ChatPreview：匿名访客的聊天只读体验页 —— 用同一套聊天布局展示示例会话与消息，输入区禁用并引导登录。
 *  目的：未登录也能看清「聊天到底长什么样、能做什么」，不再是一张空白登录卡片。 */

import type { Locale } from '@mim/i18n'; // 语言类型：zh-CN / en-US

interface Props {
  locale: Locale; // 当前语言
  onSignIn: () => void; // 点击登录引导：由上层切到登录视图
} // Props 结束

/** 示例会话：仅本地静态数据，不触达任何接口，避免匿名态读取他人消息 */
const DEMO_CONVERSATIONS = [
  { id: 'demo-team', title: 'Mim 产品组', members: 5, preview: '部署脚本已更新到 release/deploy', time: '09:12' }, // 群聊示例
  { id: 'demo-ai', title: 'AI 能力讨论', members: 3, preview: '蓝图能力已覆盖 205 条导航条目', time: '昨天' }, // 技术群示例
  { id: 'demo-bot', title: 'Mim 助手', members: 1, preview: '今晚 20:00 生成漫剧第三集', time: '周一' }, // 单聊示例
]; // DEMO_CONVERSATIONS 结束

/** 示例消息：含一条引用回复，直观展示引用块与文件气泡的形态 */
const DEMO_MESSAGES = [
  { id: 'm1', mine: false, sender: '林工', text: '商城那 143 条「规划中」已经全部补完能力了吗？', time: '09:08' }, // 对方提问
  { id: 'm2', mine: true, sender: '我', text: '补完了：205 条导航条目全部可调用，商城已经看不到「规划中」。', time: '09:09' }, // 我的回答
  { id: 'm3', mine: false, sender: '林工', text: '那聊天这边呢？引用和群管理都能用吗？', time: '09:10', quote: '我: 205 条导航条目全部可调用' }, // 带引用的消息
  { id: 'm4', mine: true, sender: '我', text: '都能用：引用回复、文件下载、设管理员、转让群主、搜索定位、未读分割、表情。', time: '09:11' }, // 我的补充
  { id: 'm5', mine: false, sender: '林工', text: '收到，我看下线上。', time: '09:12' }, // 收尾
]; // DEMO_MESSAGES 结束

/** 渲染匿名只读聊天页 */
export function ChatPreview({ locale, onSignIn }: Props) {
  const isZh = locale !== 'en-US'; // 中文判断，文案随语言切换
  return (
    <div className="chat-layout chat-preview">{/* 复用真实聊天布局，保持视觉一致 */}
      <aside className="chat-sidebar">{/* 左侧会话栏 */}
        <div className="chat-search">{/* 搜索区：匿名态禁用输入，避免产生「能搜」的误解 */}
          <input type="text" placeholder={isZh ? '搜索用户…' : 'Search users…'} disabled />
        </div>
        <div className="chat-conversations">{/* 示例会话列表 */}
          {DEMO_CONVERSATIONS.map((c, index) => ( // 逐条渲染示例会话
            <div key={c.id} className={`chat-conv-item${index === 0 ? ' active' : ''}`}>{/* 首条高亮，模拟选中态 */}
              <span className="chat-avatar">{c.title.slice(0, 1)}</span>{/* 头像：取标题首字 */}
              <span className="chat-conv-body">
                <span className="chat-conv-title">
                  {c.title}{/* 会话标题 */}
                  <span className="chat-conv-meta">({c.members})</span>{/* 成员数 */}
                </span>
                <span className="chat-conv-preview">{c.preview}</span>{/* 最近一条消息预览 */}
              </span>
              <span className="chat-conv-time">{c.time}</span>{/* 时间 */}
            </div>
          ))}{/* 会话遍历结束 */}
        </div>
      </aside>

      <section className="chat-main">{/* 右侧消息区 */}
        <header className="chat-preview-banner">{/* 顶部说明条：明确这是演示态并给出登录入口 */}
          <span>{isZh ? '只读演示：登录后即可创建会话、收发消息、传文件与群管理。' : 'Read-only demo. Sign in to chat, send files and manage groups.'}</span>
          <button type="button" className="btn primary small" onClick={onSignIn}>{/* 登录引导按钮 */}
            {isZh ? '去登录 / 注册' : 'Sign in / Sign up'}
          </button>
        </header>

        <div className="chat-messages">{/* 示例消息区 */}
          {DEMO_MESSAGES.map((m) => ( // 逐条渲染示例消息
            <div key={m.id} className={`chat-msg ${m.mine ? 'mine' : 'theirs'}`}>{/* 气泡位置按是否本人区分 */}
              <span className="chat-msg-sender">{m.sender}</span>{/* 发送者名 */}
              <div className="chat-msg-bubble">
                {m.quote && <span className="chat-msg-quote">{m.quote}</span>}{/* 引用块：展示被引用摘要 */}
                <span className="chat-msg-text">{m.text}</span>{/* 正文 */}
              </div>
              <span className="chat-msg-time">{m.time}</span>{/* 时间 */}
            </div>
          ))}{/* 消息遍历结束 */}
        </div>

        <div className="chat-input">{/* 输入区：全部禁用，明确只读 */}
          <button type="button" className="btn ghost chat-emoji-btn" disabled>🙂</button>{/* 表情按钮占位 */}
          <textarea disabled placeholder={isZh ? '登录后即可输入消息…' : 'Sign in to type messages…'} />{/* 禁用的输入框 */}
          <button type="button" className="btn ghost" disabled>{isZh ? '图片/文件' : 'Image / File'}</button>{/* 附件按钮占位 */}
          <button type="button" className="btn primary" disabled>{isZh ? '发送' : 'Send'}</button>{/* 发送按钮占位 */}
        </div>
      </section>
    </div>
  );
} // ChatPreview 结束
