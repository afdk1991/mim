/* ==========================================================================
 * 内容域本机偏好 —— 黑名单 / 青少年模式 / 推荐负反馈 / 同城城市 / 话题签到
 *
 * 存储约定（与 core/storage 一致）：mim.content.<uid>.<field>
 *   blacklist / teen 不在此处落盘 —— 真源是身份域 mim.identity.<uid>.{blacklist,teen}
 *                    （设置页写入），这里只读取后喂给 feedFilter
 *   neg          推荐负反馈 { authors: string[]; topics: string[] }
 *   city         同城 Tab 的当前城市
 *   checkin      话题签到 Record<话题名, CheckinState>
 *
 * 为什么要放在页面目录而不是 domain：
 *  这几个字段属于「本机偏好」而非领域真源，且原实现里由 user-domain / feed-core /
 *  social-domain 三处各自持有一份格外散乱。这里统一到一张键表，
 *  写操作通过 EVT.* 广播，设置页（系统域）按同样的键写入即可即时生效，无需改共享层。
 * ======================================================================== */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FeedFilterInput } from '@/domain/content/rules'
import type { CheckinState } from '@/domain/social/model'
import { dayKey, nextStreak } from '@/domain/social/model'
import { EVT, emit, subscribe } from '@/core/events'
import { asRecord, asString, asStringArray, readJson, userKey, writeJson } from '@/core/storage'
// 黑名单与青少年模式的真源在身份域（设置页写入），内容域只读取，避免两处各存一份导致开关不生效
import { getBlacklist, getTeen } from '@/app/state/identity'

const SCOPE = 'content'

/* ---------- 底层读写 ---------- */

function keyOf(uid: string, field: string): string {
  return userKey(SCOPE, uid, field)
}

export interface NegFeedbackState {
  authors: string[]
  topics: string[]
}

export interface FeedPrefsState {
  blacklist: string[]
  teenEnabled: boolean
  neg: NegFeedbackState
  city: string
}

function readNeg(raw: unknown): NegFeedbackState | null {
  const r = asRecord(raw)
  if (!r) return null
  const authors = asStringArray(r.authors)
  const topics = asStringArray(r.topics)
  if (!authors || !topics) return null
  return { authors, topics }
}

export function readFeedPrefs(uid: string, fallbackCity = '北京市'): FeedPrefsState {
  return {
    blacklist: getBlacklist(),
    teenEnabled: getTeen().enabled,
    neg: readJson(keyOf(uid, 'neg'), readNeg, { authors: [], topics: [] }),
    city: readJson(keyOf(uid, 'city'), asString, fallbackCity),
  }
}

/* ---------- useFeedPrefs ---------- */

export interface FeedPrefsApi extends FeedPrefsState {
  /** 直接喂给 feedFilter 的入参（顺序由 rules.feedFilter 固定，页面不得自行重排） */
  filter: FeedFilterInput
  negCount: number
  setCity: (city: string) => void
  /** 负反馈：不感兴趣的作者 / 话题（命中后整卡即时消失） */
  dislikeAuthor: (id: string) => void
  dislikeTopic: (name: string) => void
  clearNeg: () => void
}

export function useFeedPrefs(uid: string, fallbackCity = '北京市'): FeedPrefsApi {
  const [state, setState] = useState<FeedPrefsState>(() => readFeedPrefs(uid, fallbackCity))

  // 设置页改黑名单 / 青少年模式后即时生效；多标签页由 core/storage 的 storage 事件转发补齐
  useEffect(() => {
    const sync = (): void => setState(readFeedPrefs(uid, fallbackCity))
    const off1 = subscribe(EVT.identity, sync)
    const off2 = subscribe(EVT.feedback, sync)
    return () => {
      off1()
      off2()
    }
  }, [uid, fallbackCity])

  const setCity = useCallback(
    (city: string): void => {
      writeJson(keyOf(uid, 'city'), city)
      setState((prev) => ({ ...prev, city }))
    },
    [uid],
  )

  const patchNeg = useCallback(
    (fn: (prev: NegFeedbackState) => NegFeedbackState): void => {
      setState((prev) => {
        const neg = fn(prev.neg)
        writeJson(keyOf(uid, 'neg'), neg)
        emit(EVT.feedback)
        return { ...prev, neg }
      })
    },
    [uid],
  )

  const dislikeAuthor = useCallback(
    (id: string): void => patchNeg((n) => (n.authors.includes(id) ? n : { ...n, authors: [...n.authors, id] })),
    [patchNeg],
  )
  const dislikeTopic = useCallback(
    (name: string): void => patchNeg((n) => (n.topics.includes(name) ? n : { ...n, topics: [...n.topics, name] })),
    [patchNeg],
  )
  const clearNeg = useCallback((): void => patchNeg(() => ({ authors: [], topics: [] })), [patchNeg])

  return useMemo(
    () => ({
      ...state,
      filter: { blacklist: state.blacklist, teenEnabled: state.teenEnabled, blockedAuthors: state.neg.authors },
      negCount: state.neg.authors.length + state.neg.topics.length,
      setCity,
      dislikeAuthor,
      dislikeTopic,
      clearNeg,
    }),
    [state, setCity, dislikeAuthor, dislikeTopic, clearNeg],
  )
}

/* ---------- 话题签到 ---------- */

type CheckinMap = Record<string, CheckinState>

function readCheckin(raw: unknown): CheckinMap | null {
  const r = asRecord(raw)
  if (!r) return null
  const out: CheckinMap = {}
  for (const [name, v] of Object.entries(r)) {
    const c = asRecord(v)
    if (!c) return null
    const lastDate = asString(c.lastDate)
    const streak = c.streak
    const total = c.total
    if (lastDate === null || typeof streak !== 'number' || typeof total !== 'number') return null
    out[name] = { lastDate, streak, total }
  }
  return out
}

export interface CheckinApi {
  map: CheckinMap
  today: string
  /** 今日是否已签到 */
  checkedOf: (name: string) => boolean
  stateOf: (name: string) => CheckinState | undefined
  /** 签到（同一天重复调用不累加，返回连击结果） */
  checkin: (name: string) => { streak: number; total: number }
}

export function useTopicCheckin(uid: string): CheckinApi {
  const [map, setMap] = useState<CheckinMap>(() => readJson(keyOf(uid, 'checkin'), readCheckin, {}))

  useEffect(() => {
    const sync = (): void => setMap(readJson(keyOf(uid, 'checkin'), readCheckin, {}))
    const off = subscribe(EVT.social, sync)
    return off
  }, [uid])

  const today = dayKey()

  return {
    map,
    today,
    checkedOf: (name) => map[name]?.lastDate === today,
    stateOf: (name) => map[name],
    checkin: (name) => {
      const result = nextStreak(map[name], today)
      const next: CheckinMap = { ...map, [name]: { streak: result.streak, total: result.total, lastDate: today } }
      writeJson(keyOf(uid, 'checkin'), next)
      setMap(next)
      emit(EVT.social)
      return result
    },
  }
}
