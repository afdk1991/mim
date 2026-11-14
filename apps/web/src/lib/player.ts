/**
 * 播放器选集导航与进度记忆纯函数（localStorage 读写做异常兜底，可独立单测）。
 */

const PROGRESS_PREFIX = 'mim.player.progress.';

/** 剧集进度在 localStorage 中的键名 */
export function progressKey(episodeId: string): string {
  return `${PROGRESS_PREFIX}${encodeURIComponent(episodeId)}`;
}

/** 读取某集已播放秒数；无记录 / 读取失败返回 0 */
export function readProgress(episodeId: string): number {
  try {
    const raw = localStorage.getItem(progressKey(episodeId));
    const seconds = raw === null ? 0 : Number(raw);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  } catch {
    return 0;
  }
}

/** 写入某集播放进度；隐私模式 / 存储不可用时静默忽略 */
export function writeProgress(episodeId: string, seconds: number): void {
  try {
    if (!Number.isFinite(seconds) || seconds < 0) return;
    localStorage.setItem(progressKey(episodeId), String(Math.floor(seconds)));
  } catch {
    /* 存储不可用不阻断播放 */
  }
}

/** 清除某集进度（播完后调用，避免下次回到旧进度） */
export function clearProgress(episodeId: string): void {
  try {
    localStorage.removeItem(progressKey(episodeId));
  } catch {
    /* 忽略 */
  }
}

/** 上一集下标：第一集时保持 0 */
export function prevIndex(index: number): number {
  return Math.max(0, index - 1);
}

/** 下一集下标：最后一集时保持末尾下标 */
export function nextIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(length - 1, index + 1);
}

/** 下标越界兜底 */
export function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(length - 1, Math.max(0, index));
}
