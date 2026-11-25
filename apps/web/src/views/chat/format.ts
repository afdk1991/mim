/**
 * 聊天视图纯函数与常量（2026-11-25 由 Chat.tsx 拆分）：
 * 时间 / 体积 / 预览摘要 / 发送状态文案，以及撤回窗口与表情候选。
 * 不依赖 React 与接口请求，便于单测与多视图复用。
 */

// IM 消息类型：摘要与状态判定复用同一结构
import type { ImMessage } from '../../api';

/** 撤回窗口：2 分钟，与后端保持一致（仅用于前端是否显示「撤回」按钮） */
export const RECALL_WINDOW_MS = 120000; // 毫秒

/** 表情面板候选：纯本地插入 Unicode 字符，不依赖表情包服务 */
export const CHAT_EMOJIS = ['😀', '😄', '😅', '😂', '🤣', '😊', '😍', '🤔', '😐', '😭', '😡', '👍', '👏', '🙏', '🎉', '❤️', '🔥', '✅', '❌', '👌'];

/** 格式化时间戳为 HH:mm */
export function formatTime(iso: string): string {
  try { // 异常捕获起点：包裹可能抛出错误的操作
    const d = new Date(iso); // 解析 ISO 时间
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); // 取时分
  } catch {
    return ''; // 解析失败返回空
  } // 代码块结束
}

/** 字节数格式化：文件气泡展示 1.2 MB 这类可读体积 */
export function formatBytes(size: number | null | undefined): string {
  if (!size || size <= 0) return ''; // 缺失或 0 不展示
  const units = ['B', 'KB', 'MB', 'GB']; // 单位阶梯
  let value = size; // 逐级换算
  let index = 0; // 当前单位下标
  while (value >= 1024 && index < units.length - 1) { // 循环：条件成立时重复执行循环体
    value /= 1024; // 换算到更大单位
    index += 1; // 单位前移
  } // 换算循环结束
  return `${value.toFixed(1)} ${units[index]}`; // 保留一位小数
}

/** 消息预览文本：列表里显示的摘要 */
export function messagePreview(msg: ImMessage): string {
  if (msg.content_type === 'text') return msg.content; // 文本直接显示
  if (msg.content_type === 'image') return '[图片]'; // 图片消息预览
  if (msg.content_type === 'file') return `[文件] ${msg.object_name ?? ''}`; // 文件消息预览
  return msg.content; // system 等其它类型兜底
}

/** 发送状态图标：sent 单勾、delivered 双勾、read 双勾加粗由 CSS 区分 */
export function statusMark(status: ImMessage['status'], isZh: boolean): string {
  if (status === 'read') return isZh ? '已读' : 'Read'; // 对方已读
  if (status === 'delivered') return isZh ? '已送达' : 'Delivered'; // 已投递
  return isZh ? '已发送' : 'Sent'; // 仅落库
}
