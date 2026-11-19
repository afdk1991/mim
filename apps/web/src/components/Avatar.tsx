// React 类型：角标槽传入任意节点（VIP / 等级徽章）
import type { ReactNode } from 'react';

/** 头像档位：18 / 24 / 32 / 40px，对齐 zibll 头像尺寸族 */
export type AvatarSize = 'sm' | 'md' | 'lg' | 'xl'; // 四档尺寸标识

interface AvatarProps { // 头像组件入参
  name: string; // 昵称：无头像时取首字符兜底
  src?: string | null; // 头像地址；空值走首字符兜底
  size?: AvatarSize; // 尺寸档，默认 lg（32px）
  badge?: ReactNode; // 角标槽：VIP / 等级徽章等叠加元素
  className?: string; // 追加类名，便于所在视图微调
} // 入参接口结束

/**
 * 共享头像：四档尺寸 + 角标槽。
 * 缺省地址时用首字符圆形兜底；角标绝对定位在右下，不参与头像自身排布。
 */
export function Avatar({ name, src, size = 'lg', badge, className = '' }: AvatarProps) {
  const initial = (name || '?').trim().charAt(0).toUpperCase(); // 兜底首字符
  return ( // 头像外层容器
    <span className={`avatar avatar-${size}${className ? ` ${className}` : ''}`}> {/* 按档位拼接尺寸类名 */}
      {src ? <img src={src} alt={name} loading="lazy" /> : <span className="avatar-fallback" aria-hidden="true">{initial}</span>} {/* 有图渲染图片，无图渲染首字符兜底 */}
      {badge ? <span className="avatar-badge">{badge}</span> : null} {/* 角标槽：有内容才叠加 */}
    </span>
  ); // 容器结束
} // Avatar 结束
