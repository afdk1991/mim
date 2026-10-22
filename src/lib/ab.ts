/* 轮 23 打通：B4 轻量 AB 实验框架 —— 真实登录身份 userId hash → 稳定分桶（纯前端 demo，无曝光上报）。
   实验在 AB_EXPERIMENTS 注册即声明，使用方用 abVariant/abIs 取变体渲染；
   Debug 开关开启时控制台打印命中桶，页面侧展示见 feed-domain 的 AbDebugBar（#videos 页底）。 */
import { getCurrentUserId } from '../auth'

export interface AbExperiment {
  key: string
  name: string
  variants: string[]
  desc: string
}

/** 已注册实验（demo 两个：推荐理由样式 / 同城默认城市） */
export const AB_EXPERIMENTS: AbExperiment[] = [
  { key: 'reco_reason_style', name: '推荐理由展示样式', variants: ['a', 'b'], desc: 'A=轻角标 / B=高亮气泡' },
  { key: 'city_default', name: '同城默认城市', variants: ['a', 'b'], desc: 'A=北京市 / B=上海市' },
]

/** Debug 开关变更事件（页面侧监听刷新） */
export const AB_EVT = 'mim-ab-debug'

const AB_DEBUG_KEY = 'mim-ab-debug'

/** djb2 字符串哈希：稳定可复现，同一身份恒定落同一桶 */
function hash32(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

/** 指定身份在指定实验中的分桶 */
export function abBucket(userId: string, expKey: string): string {
  const exp = AB_EXPERIMENTS.find((e) => e.key === expKey)
  if (!exp) return 'a'
  return exp.variants[hash32(`${expKey}#${userId}`) % exp.variants.length]
}

/** 当前登录身份在指定实验中的变体 */
export function abVariant(expKey: string): string {
  return abBucket(getCurrentUserId(), expKey)
}

export function abIs(expKey: string, variant: string): boolean {
  return abVariant(expKey) === variant
}

export function loadAbDebug(): boolean {
  try {
    return localStorage.getItem(AB_DEBUG_KEY) === 'on'
  } catch {
    return false
  }
}

export function writeAbDebug(on: boolean): void {
  try {
    localStorage.setItem(AB_DEBUG_KEY, on ? 'on' : 'off')
  } catch {
    /* 存储不可用时静默 */
  }
  if (on) {
    const uid = getCurrentUserId()
    for (const e of AB_EXPERIMENTS) {
      console.info(`[AB] ${e.key}(${e.name}) userId=${uid} → ${abBucket(uid, e.key)}`)
    }
  }
  window.dispatchEvent(new Event(AB_EVT))
}

/** Debug 面板数据：全部实验的当前命中桶 */
export function abSummary(): Array<{ exp: AbExperiment; variant: string }> {
  const uid = getCurrentUserId()
  return AB_EXPERIMENTS.map((exp) => ({ exp, variant: abBucket(uid, exp.key) }))
}
