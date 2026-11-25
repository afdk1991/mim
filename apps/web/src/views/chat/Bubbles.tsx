/**
 * 聊天消息气泡（2026-11-25 由 Chat.tsx 拆分）：图片气泡 / 文件气泡。
 * 两者都按 object_key 申请下载签名，失败回退文字占位，不阻塞消息列表渲染。
 */

// React 钩子：本地签名地址与失败态
import { useEffect, useState } from 'react';
// API 客户端：下载签名
import { api } from '../../api';
// 公开地址归一化：签名下载链接在跨源构建下补 API 源
import { resolvePublicUrl } from '../../api/request.js';
// 文件体积格式化复用纯函数模块
import { formatBytes } from './format.js';

/** 图片气泡：按 object_key 向服务端申请下载签名，取到后内联渲染缩略图，点击可看原图
 *  - 签名地址有时效，故按 object_key 缓存一次结果，消息列表重渲染不重复申请
 *  - 申请失败时回退为文字占位，不阻塞消息展示
 * 入口：消息 content_type === 'image' 且带 object_key
 * 出口：<img> 或占位文本
 */
export function ChatImageBubble({ objectKey, name, isZh }: { objectKey: string; name?: string; isZh: boolean }) {
  const [url, setUrl] = useState<string | null>(null); // 签名后的可访问地址
  const [failed, setFailed] = useState(false); // 申请失败标记
  useEffect(() => {
    let alive = true; // 组件卸载后丢弃回调，避免卸载后 setState
    setFailed(false); // 每次换 key 重置失败态
    api.media
      .presignDownload(objectKey, 3600) // 申请 1 小时有效的下载签名
      .then((res) => {
        if (alive) setUrl(resolvePublicUrl(res.download.url)); // 拿到直链并归一化（相对签名链接补 API 源）
      }) // 代码块结束
      .catch(() => {
        if (alive) setFailed(true); // 失败回退占位
      });
    return () => { // 返回当前函数的处理结果
      alive = false; // 清理标记
    }; // 代码块结束
  }, [objectKey]); // 仅 object_key 变化时重新申请
  if (failed) return <span className="chat-image-fallback">{`[图片] ${name ?? ''}`}</span>; // 失败占位
  if (!url) return <span className="chat-image-loading">{isZh ? '图片加载中…' : 'Loading…'}</span>; // 加载中占位
  return ( // 返回当前函数的处理结果
    <a className="chat-image" href={url} target="_blank" rel="noreferrer" title={name ?? ''}>{/* 执行当前业务步骤 */}
      <img src={url} alt={name ?? (isZh ? '图片' : 'image')} loading="lazy" />{/* 缩略展示，点击开原图 */}
    </a>
  ); // 执行当前业务步骤
}

/** 文件气泡：按 object_key 申请下载签名，给出文件名、体积与下载按钮
 *  - 点击下载即触发浏览器保存（download 属性带原始文件名）
 *  - 申请失败时回退为纯文本占位，不影响其它消息渲染
 */
export function ChatFileBubble({ objectKey, name, size, isZh }: { objectKey: string; name?: string; size?: number | null; isZh: boolean }) {
  const [url, setUrl] = useState<string | null>(null); // 签名后的下载地址
  const [failed, setFailed] = useState(false); // 申请失败标记
  useEffect(() => {
    let alive = true; // 卸载后丢弃回调
    setFailed(false); // 切换文件时重置失败态
    api.media
      .presignDownload(objectKey, 3600) // 申请 1 小时有效下载签名
      .then((res) => {
        if (alive) setUrl(resolvePublicUrl(res.download.url)); // 拿到直链并归一化（相对签名链接补 API 源）
      }) // 代码块结束
      .catch(() => {
        if (alive) setFailed(true); // 失败回退
      });
    return () => { // 返回当前函数的处理结果
      alive = false; // 清理标记
    }; // 代码块结束
  }, [objectKey]); // 仅对象键变化时重新申请
  const label = name ?? (isZh ? '文件' : 'file'); // 展示文件名
  if (failed) return <span className="chat-file-fallback">{`[文件] ${label}`}</span>; // 失败占位
  return ( // 返回当前函数的处理结果
    <span className="chat-file">{/* 执行当前业务步骤 */}
      <span className="chat-file-name">{label}</span>{/* 文件名 */}
      {size ? <span className="chat-file-size">{formatBytes(size)}</span> : null}{/* 体积 */}
      {url ? (
        <a className="btn ghost small chat-file-download" href={url} download={label} target="_blank" rel="noreferrer">{/* 执行当前业务步骤 */}
          {isZh ? '下载' : 'Download'}
        </a>
      ) : (
        <span className="muted">{isZh ? '准备中…' : 'Preparing…'}</span>
      )}{/* 下载入口 */}
    </span>
  ); // 执行当前业务步骤
}
