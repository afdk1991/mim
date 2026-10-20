import './manju.css';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useToast } from './components';
import { cx, uid } from './utils';

/* ================= 数据模型 ================= */

interface MjEpisode {
  id: string;
  index: number;
  durationSec: number;
  free: boolean;
}

interface MjSeries {
  id: string;
  title: string;
  cover: string;
  tone: number;
  tags: string[];
  score: number;
  year: number;
  status: '连载中' | '已完结';
  vip: boolean;
  synopsis: string;
  episodes: MjEpisode[];
}

type MjExtMode = 'direct' | 'embed' | 'blocked';
type MjExtReason = 'frame_blocked' | 'stream_expired';

interface MjExtItem {
  id: string;
  title: string;
  cat: 'comic' | 'ai';
  cover: string;
  source: string;
  episodesText: string;
  playMode: MjExtMode;
  reason?: MjExtReason;
  custom?: boolean;
  /** 授权标识：仅收录可验证无版权争议的内容（公版 / CC-BY） */
  license?: string;
}

interface MjPlayResult {
  mode: MjExtMode;
  message: string;
}

interface MjState {
  favorites: string[];
  seen: string[];
  progress: Record<string, number>;
  customExt: MjExtItem[];
}

type MjView =
  | { kind: 'home' }
  | { kind: 'ext'; cat: 'comic' | 'ai' }
  | { kind: 'detail'; sid: string }
  | { kind: 'watch'; sid: string; eid: string };

interface MjContRow {
  sid: string;
  eid: string;
  title: string;
  cover: string;
  epIndex: number;
  pct: number;
}

/* ================= 种子数据（全部内置，无网络请求） ================= */

const mkEps = (sid: string, n: number, freeN: number): MjEpisode[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `${sid}_e${String(i + 1).padStart(2, '0')}`,
    index: i + 1,
    durationSec: 80 + ((i * 37) % 70),
    free: i < freeN,
  }));

const SEED: MjSeries[] = [
  {
    id: 's_airebirth', title: '重生：我成了漫画主角', cover: '🖋️', tone: 3,
    tags: ['漫剧', 'AI剧', '原创', '玄幻'], score: 9.1, year: 2026, status: '连载中', vip: false,
    synopsis:
      '落魄漫画家深夜伏案沉睡，笔下世界竟在台灯光中复苏。他穿越进自己未完的漫画，双手开始化作墨线——一场关于「重生」的黑白漫剧由此展开。本站自有 AI 生成内容，纯原创，全程站内播放。',
    episodes: [{ id: 's_airebirth_e01', index: 1, durationSec: 36, free: true }],
  },
  {
    id: 's_demo1', title: '赘婿逆袭指南', cover: '🗡️', tone: 1,
    tags: ['逆袭', '都市'], score: 8.7, year: 2025, status: '已完结', vip: false,
    synopsis: '入赘三年受尽白眼，一夜觉醒神秘血脉，从此商界纵横、打脸不停。',
    episodes: mkEps('s_demo1', 6, 3),
  },
  {
    id: 's_demo2', title: '神医小娘子', cover: '👘', tone: 4,
    tags: ['古装', '甜宠'], score: 8.2, year: 2025, status: '连载中', vip: false,
    synopsis: '现代外科女医生一朝穿越，凭借一手神级医术在古代风生水起。',
    episodes: mkEps('s_demo2', 4, 2),
  },
  {
    id: 's_demo3', title: '重生之AI觉醒', cover: '🤖', tone: 3,
    tags: ['科幻', 'AI'], score: 9.1, year: 2026, status: '连载中', vip: true,
    synopsis: '车祸重生的程序员带着 AI 系统归来，扼住命运的每一次转折。',
    episodes: mkEps('s_demo3', 4, 1),
  },
  {
    id: 's_demo4', title: '末日囤货王', cover: '🧟', tone: 2,
    tags: ['末世', '求生'], score: 7.9, year: 2025, status: '已完结', vip: false,
    synopsis: '末世前夜疯狂囤货，别人逃命我盖楼，硬是囤出一座末日堡垒。',
    episodes: mkEps('s_demo4', 5, 2),
  },
  {
    id: 's_demo5', title: '千金归来', cover: '👑', tone: 5,
    tags: ['复仇', '豪门'], score: 8.4, year: 2026, status: '连载中', vip: true,
    synopsis: '被调包的豪门真千金强势归来，一步步夺回属于自己的一切。',
    episodes: mkEps('s_demo5', 3, 1),
  },
  {
    id: 's_demo6', title: '我在唐朝送外卖', cover: '🛵', tone: 2,
    tags: ['穿越', '搞笑'], score: 8.0, year: 2024, status: '已完结', vip: false,
    synopsis: '外卖骑手穿越长安，把现代配送体系玩成了大唐商业帝国。',
    episodes: mkEps('s_demo6', 4, 4),
  },
];

const EXT_SEED: MjExtItem[] = [
  /* 漫剧分类：公有领域经典动画（Public Domain，Internet Archive 免费托管，授权链路可验证） */
  { id: 'x_c1', title: '超人：疯狂科学家（1941）', cat: 'comic', cover: '🦸', source: 'Fleischer Studios · 公版 Public Domain', episodesText: '首部超人动画 · 全片约 10 分钟', playMode: 'direct', license: '公版 PD' },
  { id: 'x_c2', title: '超人：机械怪物（1941）', cat: 'comic', cover: '🤖', source: 'Fleischer Studios · 公版 Public Domain', episodesText: '超人系列第 2 部 · 全片约 10 分钟', playMode: 'embed', license: '公版 PD' },
  { id: 'x_c3', title: '贝蒂娃娃：Minnie the Moocher（1932）', cat: 'comic', cover: '💃', source: 'Fleischer Studios · 公版 Public Domain', episodesText: '贝蒂娃娃早期短片 · 全片约 8 分钟', playMode: 'direct', license: '公版 PD' },
  { id: 'x_c4', title: '大力水手公版短剧合集', cat: 'comic', cover: '🥬', source: 'Fleischer / Famous Studios · 公版 Public Domain', episodesText: '多部公版短剧 · 1930s-1950s', playMode: 'blocked', reason: 'frame_blocked', license: '公版 PD' },
  /* AI 剧 / 开源分类：Blender 开源电影（CC-BY 署名授权，studio.blender.org 可验证） */
  { id: 'x_a1', title: 'Big Buck Bunny（2008）', cat: 'ai', cover: '🐰', source: 'Blender 开源电影 · CC-BY 署名', episodesText: '全片约 10 分钟 · 公开直链可用', playMode: 'direct', license: 'CC-BY' },
  { id: 'x_a2', title: 'Elephants Dream（2006）', cat: 'ai', cover: '🐘', source: 'Blender 开源电影 · CC-BY 署名', episodesText: '首部开源电影 · 全片约 11 分钟', playMode: 'embed', license: 'CC-BY' },
  { id: 'x_a3', title: 'Sintel（2010）', cat: 'ai', cover: '🐉', source: 'Blender 开源电影 · CC-BY 署名', episodesText: '奇幻短片 · 全片约 15 分钟', playMode: 'direct', license: 'CC-BY' },
  { id: 'x_a4', title: 'Tears of Steel（2012）', cat: 'ai', cover: '🦾', source: 'Blender 开源电影 · CC-BY 署名', episodesText: '真人+CG 科幻 · 全片约 12 分钟', playMode: 'direct', license: 'CC-BY' },
  { id: 'x_a5', title: 'Cosmos Laundromat: First Cycle（2015）', cat: 'ai', cover: '🐑', source: 'Blender 开源电影 · CC-BY 署名', episodesText: '首集正式片 · 全片约 12 分钟', playMode: 'embed', license: 'CC-BY' },
  { id: 'x_a6', title: 'Sprite Fright（2021）', cat: 'ai', cover: '🧚', source: 'Blender 开源电影 · CC-BY 署名', episodesText: '喜剧恐怖短片 · 全片约 10 分钟', playMode: 'blocked', reason: 'stream_expired', license: 'CC-BY' },
];

const PLAY_MSG: Record<string, string> = {
  direct: '解析成功：已取得视频直链，本集可直接播放（演示环境不实际拉流）。',
  embed: '源站允许嵌入，已在站内 iframe 中载入播放器。',
  frame_blocked: '不可播：源站通过 X-Frame-Options / CSP 禁止被嵌入，只能跳转源站观看。',
  stream_expired: '不可播：直链已失效（防盗链 403 / 404），请稍后重试或跳转源站。',
};

const REASON_LABEL: Record<string, string> = {
  frame_blocked: '原因码：frame_blocked',
  stream_expired: '原因码：stream_expired',
};

/* ================= 本地持久化 ================= */

const KEY = 'mim-manju-v1';

function isExtItem(v: unknown): v is MjExtItem {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === 'string' && typeof o.title === 'string' && (o.cat === 'comic' || o.cat === 'ai');
}

function seedState(): MjState {
  return { favorites: [], seen: [], progress: {}, customExt: [] };
}

function loadManju(): MjState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return seedState();
    const obj: unknown = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return seedState();
    const o = obj as Record<string, unknown>;
    if (
      !Array.isArray(o.favorites) ||
      !Array.isArray(o.seen) ||
      !Array.isArray(o.customExt) ||
      !o.progress ||
      typeof o.progress !== 'object'
    ) {
      return seedState();
    }
    const progress: Record<string, number> = {};
    for (const [k, v] of Object.entries(o.progress as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) progress[k] = Math.floor(v);
    }
    return {
      favorites: o.favorites.filter((x): x is string => typeof x === 'string'),
      seen: o.seen.filter((x): x is string => typeof x === 'string'),
      progress,
      customExt: o.customExt.filter(isExtItem),
    };
  } catch {
    return seedState();
  }
}

function saveManju(s: MjState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 隐私模式下忽略 */
  }
}

/* ================= 通用小组件 ================= */

/** 模拟异步加载：key 变化时短暂 loading */
function useSimLoad(key: string, ms = 350): boolean {
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    const t = window.setTimeout(() => setLoading(false), ms);
    return () => window.clearTimeout(t);
  }, [key, ms]);
  return loading;
}

function MjCard({ s, seen, onOpen }: { s: MjSeries; seen: boolean; onOpen: () => void }) {
  return (
    <div
      className="manju-card card"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen();
      }}
    >
      <div className={cx('manju-cover', `manju-tone${s.tone}`)}>
        <span className="manju-cover-emoji">{s.cover}</span>
        {s.tags.includes('AI剧') && <span className="manju-badge manju-ai">AI 原创</span>}
        {s.vip && <span className="manju-badge manju-vip">VIP</span>}
        {seen && <span className="manju-badge manju-seen">已看</span>}
      </div>
      <div className="manju-card-body">
        <div className="manju-card-title">{s.title}</div>
        <div className="manju-card-meta muted">
          ★ {s.score} · {s.episodes.length}集 · {s.status}
        </div>
      </div>
    </div>
  );
}

function MjLoading({ text = '加载中…' }: { text?: string }) {
  return <div className="manju-loading muted">{text}</div>;
}

/* ================= 首页 ================= */

function HomeView(props: {
  query: string;
  onQuery: (q: string) => void;
  cont: MjContRow[];
  favorites: MjSeries[];
  seenList: string[];
  extTotal: number;
  onOpen: (sid: string) => void;
  onContinue: (sid: string, eid: string) => void;
  onOpenExt: () => void;
}) {
  const q = props.query.trim();
  const results = useMemo(
    () => (q ? SEED.filter((s) => s.title.includes(q) || s.tags.some((t) => t.includes(q))) : []),
    [q],
  );

  return (
    <>
      <div className="manju-hero">
        <h1>漫剧 Manju</h1>
        <p>竖屏漫剧在线观影 · 站内片库（含原创 AI 剧）+ 外部片单解析（演示数据）</p>
      </div>

      <div className="manju-search-row">
        <input
          className="input manju-search"
          placeholder="搜索剧名或题材，如「逆袭」「古装」"
          value={props.query}
          onChange={(e) => props.onQuery(e.target.value)}
        />
      </div>

      {q ? (
        <>
          <div className="manju-section-head">
            <h3>搜索结果</h3>
            <span className="muted">{results.length} 部</span>
          </div>
          {results.length === 0 ? (
            <div className="manju-empty">🔍 没有找到与「{q}」相关的剧集，换个关键词试试</div>
          ) : (
            <div className="manju-grid">
              {results.map((s) => (
                <MjCard key={s.id} s={s} seen={props.seenList.includes(s.id)} onOpen={() => props.onOpen(s.id)} />
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {props.cont.length > 0 && (
            <>
              <div className="manju-section-head">
                <h3>继续观看</h3>
                <span className="muted">上次没看完的</span>
              </div>
              <div className="manju-cont-list">
                {props.cont.map((r) => (
                  <div key={r.eid} className="manju-cont card">
                    <span className="manju-cont-cover">{r.cover}</span>
                    <div className="manju-cont-info">
                      <div className="manju-card-title">{r.title}</div>
                      <div className="muted">
                        第 {r.epIndex} 集 · 已看 {r.pct}%
                      </div>
                    </div>
                    <button className="btn btn-primary btn-sm" onClick={() => props.onContinue(r.sid, r.eid)}>
                      续播
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="manju-section-head">
            <h3>我的收藏</h3>
            <span className="muted">{props.favorites.length} 部</span>
          </div>
          {props.favorites.length === 0 ? (
            <div className="manju-empty manju-empty-soft">还没有收藏 · 进入剧集详情点亮 ❤️ 即可收藏</div>
          ) : (
            <div className="manju-grid">
              {props.favorites.map((s) => (
                <MjCard key={s.id} s={s} seen={props.seenList.includes(s.id)} onOpen={() => props.onOpen(s.id)} />
              ))}
            </div>
          )}

          <div className="manju-section-head">
            <h3>本周热门</h3>
            <span className="muted">{SEED.length} 部</span>
          </div>
          <div className="manju-grid">
            {SEED.map((s) => (
              <MjCard key={s.id} s={s} seen={props.seenList.includes(s.id)} onOpen={() => props.onOpen(s.id)} />
            ))}
          </div>

          <div className="manju-section-head">
            <h3>会员精选</h3>
            <span className="muted">VIP 专享</span>
          </div>
          <div className="manju-grid">
            {SEED.filter((s) => s.vip).map((s) => (
              <MjCard key={s.id} s={s} seen={props.seenList.includes(s.id)} onOpen={() => props.onOpen(s.id)} />
            ))}
          </div>

          <div
            className="manju-ext-entry card"
            role="button"
            tabIndex={0}
            onClick={props.onOpenExt}
            onKeyDown={(e) => {
              if (e.key === 'Enter') props.onOpenExt();
            }}
          >
            <span className="manju-ext-entry-emoji">🧭</span>
            <div className="manju-cont-info">
              <div className="manju-card-title">外部片单索引</div>
              <div className="muted">共 {props.extTotal} 条 · 公版漫剧 / CC-BY 开源剧 · 无版权争议</div>
            </div>
            <span className="manju-ext-arrow">›</span>
          </div>
        </>
      )}
    </>
  );
}

/* ================= 剧集详情 ================= */

function DetailView(props: {
  series: MjSeries;
  fav: boolean;
  progress: Record<string, number>;
  onToggleFav: () => void;
  onPlay: (e: MjEpisode) => void;
}) {
  const { series } = props;
  const done = (e: MjEpisode) => (props.progress[e.id] ?? 0) >= e.durationSec;
  return (
    <>
      <div className="manju-detail card">
        <div className={cx('manju-cover', 'manju-cover-lg', `manju-tone${series.tone}`)}>
          <span className="manju-cover-emoji">{series.cover}</span>
          {series.tags.includes('AI剧') && <span className="manju-badge manju-ai">AI 原创</span>}
          {series.vip && <span className="manju-badge manju-vip">VIP</span>}
        </div>
        <div className="manju-detail-info">
          <h2>{series.title}</h2>
          <div className="manju-card-meta muted">
            ★ {series.score} · {series.year} · {series.status} · 共 {series.episodes.length} 集
          </div>
          <div className="manju-tags">
            {series.tags.map((t) => (
              <span key={t} className="tag">
                {t}
              </span>
            ))}
          </div>
          <p className="manju-synopsis muted">{series.synopsis}</p>
          <button className={cx('btn', props.fav ? 'btn-ghost' : 'btn-primary')} onClick={props.onToggleFav}>
            {props.fav ? '💔 取消收藏' : '❤️ 收藏'}
          </button>
        </div>
      </div>

      <div className="manju-section-head">
        <h3>选集</h3>
        <span className="muted">
          免费 {series.episodes.filter((e) => e.free).length} 集
          {series.episodes.some((e) => !e.free) ? ' · 其余为 VIP 专享' : ''}
        </span>
      </div>
      <div className="manju-eps">
        {series.episodes.map((e) => (
          <button
            key={e.id}
            className={cx('manju-ep', done(e) && 'manju-ep-done', !e.free && 'manju-ep-vip')}
            onClick={() => props.onPlay(e)}
          >
            <span>第{e.index}集</span>
            <span className="manju-ep-tag">{e.free ? '免费' : '🔒 VIP'}</span>
            {done(e) && <span className="manju-ep-check">✓</span>}
          </button>
        ))}
      </div>
    </>
  );
}

/* ================= 观看页（模拟播放器） ================= */

function WatchView(props: {
  series: MjSeries;
  ep: MjEpisode;
  savedSec: number;
  seen: boolean;
  onProgress: (epId: string, sec: number) => void;
  onSeen: () => void;
  hasNext: boolean;
  onNext: () => void;
}) {
  const { series, ep } = props;
  const [sec, setSec] = useState(() => (props.savedSec >= ep.durationSec ? 0 : Math.max(0, props.savedSec)));
  const [playing, setPlaying] = useState(false);
  const pct = ep.durationSec > 0 ? Math.min(100, Math.round((sec / ep.durationSec) * 100)) : 0;

  useEffect(() => {
    if (!playing) return;
    const t = window.setInterval(() => setSec((v) => Math.min(v + 1, ep.durationSec)), 400);
    return () => window.clearInterval(t);
  }, [playing, ep.durationSec]);

  useEffect(() => {
    props.onProgress(ep.id, sec);
  }, [ep.id, sec, props.onProgress]);

  useEffect(() => {
    if (sec >= ep.durationSec) {
      setPlaying(false);
      if (!props.seen) props.onSeen();
    }
  }, [sec, ep.durationSec, props.seen, props.onSeen]);

  return (
    <>
      <div className="manju-player card">
        <div className={cx('manju-screen', `manju-tone${series.tone}`, playing && 'manju-playing')}>
          <span className="manju-screen-emoji">{series.cover}</span>
          {!playing && <div className="manju-veil">⏸</div>}
          <div className="manju-caption">
            第 {ep.index} 集 · {sec}s / {ep.durationSec}s{playing ? ' · 演示 2.5×' : ''}
          </div>
          <div className="manju-bar">
            <div className="manju-bar-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="manju-ctrls">
          <button className="btn btn-primary" onClick={() => setPlaying((p) => !p)}>
            {playing ? '⏸ 暂停' : '▶ 播放'}
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => {
              setSec(0);
              setPlaying(true);
            }}
          >
            ↺ 重看
          </button>
          <button className="btn btn-ghost" disabled={!props.hasNext} onClick={props.onNext}>
            下一集 →
          </button>
        </div>
      </div>

      <div className="manju-now card">
        <div className="manju-card-title">
          {series.title} · 第 {ep.index} 集
        </div>
        <div className="muted">
          {ep.durationSec < 60 ? `时长 ${ep.durationSec} 秒` : `约 ${Math.round(ep.durationSec / 60)} 分钟`} ·
          站内片库（模拟数据，非真实视频流）
        </div>
        {pct >= 90 && <div className="manju-now-hint">✅ 本集已看完，进度已保存，可返回选集或看下一集</div>}
      </div>
    </>
  );
}

/* ================= 外部片单 ================= */

const EXT_TABS: Array<{ id: 'comic' | 'ai'; label: string }> = [
  { id: 'comic', label: '漫剧' },
  { id: 'ai', label: '开源 · AI 剧' },
];

function ExtView(props: {
  cat: 'comic' | 'ai';
  items: MjExtItem[];
  results: Record<string, MjPlayResult>;
  resolving: Record<string, boolean>;
  onCat: (c: 'comic' | 'ai') => void;
  onResolve: (it: MjExtItem) => void;
  onAdd: (cat: 'comic' | 'ai', title: string, url: string) => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');

  const submit = () => {
    const t = title.trim();
    if (!t) {
      toast('请先填写片名');
      return;
    }
    props.onAdd(props.cat, t, url.trim());
    setTitle('');
    setUrl('');
    toast('已添加自定义片源');
  };

  return (
    <>
      <div className="manju-ext-tabs">
        {EXT_TABS.map((t) => (
          <button
            key={t.id}
            className={cx('manju-tab', props.cat === t.id && 'manju-tab-on')}
            onClick={() => props.onCat(t.id)}
          >
            {t.label} · {props.items.filter((i) => i.cat === t.id).length}
          </button>
        ))}
      </div>

      <div className="muted manju-ext-note">
        外部片单仅提供发现与播放源解析演示：直链可播 → 站内嵌入 → 不可播（降级）。
        收录标准：全部为公有领域（Public Domain）或 CC-BY 署名授权内容，授权可验证、无版权争议；
        「开源 · AI 剧」分类以 Blender 开源电影为主，真正 AI 生成剧集普遍保留创作者版权，站内自有 AI 原创剧见首页。
      </div>

      {props.items.map((it) => {
        const res = props.results[it.id];
        return (
          <div key={it.id} className="manju-ext-item card">
            <div className="manju-ext-row">
              <span className="manju-ext-cover">{it.cover}</span>
              <div className="manju-cont-info">
                <div className="manju-card-title">
                  {it.title}
                  {it.license && <span className="manju-badge manju-license">{it.license}</span>}
                  {it.custom && <span className="manju-badge manju-custom">自定义</span>}
                </div>
                <div className="muted">{it.source}</div>
                <div className="muted">{it.episodesText}</div>
              </div>
              <button className="btn btn-primary btn-sm" disabled={props.resolving[it.id]} onClick={() => props.onResolve(it)}>
                {props.resolving[it.id] ? '解析中…' : '解析播放源'}
              </button>
            </div>
            {res && (
              <div className={cx('manju-ext-res', `manju-res-${res.mode}`)}>
                <div className="manju-ext-res-text">
                  {res.mode === 'direct' ? '✅ ' : res.mode === 'embed' ? '🪟 ' : '⛔ '}
                  {res.message}
                </div>
                {res.mode === 'embed' && <div className="manju-iframe">🪟 站内 iframe 播放器（演示占位）</div>}
                {res.mode === 'blocked' && it.reason && <span className="manju-reason">{REASON_LABEL[it.reason]}</span>}
              </div>
            )}
          </div>
        );
      })}

      <div className="manju-addform card">
        <div className="manju-card-title">添加自定义片源</div>
        <div className="muted">对应用户自定义内容源（user_defined）：填一个名称与地址，加入当前分类的片单。</div>
        <div className="manju-addform-row">
          <input
            className="input"
            placeholder="片名，如：我的自制漫剧"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <input
            className="input"
            placeholder="接口 / 播放地址（可选）"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button className="btn btn-primary" onClick={submit}>
            添加
          </button>
        </div>
      </div>
    </>
  );
}

/* ================= 页面入口 ================= */

export function ManjuPage() {
  const toast = useToast();
  const [state, setState] = useState<MjState>(loadManju);
  const [view, setView] = useState<MjView>({ kind: 'home' });
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Record<string, MjPlayResult>>({});
  const [resolving, setResolving] = useState<Record<string, boolean>>({});

  const detailLoading = useSimLoad(view.kind === 'detail' ? view.sid : '');
  const watchLoading = useSimLoad(view.kind === 'watch' ? view.eid : '');

  useEffect(() => {
    saveManju(state);
  }, [state]);

  /* 续播列表：有进度且未看完（<95%）的集，按剧序取前 4 条 */
  const cont = useMemo<MjContRow[]>(() => {
    const rows: MjContRow[] = [];
    for (const s of SEED) {
      for (const e of s.episodes) {
        const p = state.progress[e.id] ?? 0;
        if (p <= 0 || p >= e.durationSec || p / e.durationSec >= 0.95) continue;
        rows.push({ sid: s.id, eid: e.id, title: s.title, cover: s.cover, epIndex: e.index, pct: Math.round((p / e.durationSec) * 100) });
      }
    }
    return rows.slice(0, 4);
  }, [state.progress]);

  const setProgress = useCallback((epId: string, sec: number) => {
    setState((s) => ({ ...s, progress: { ...s.progress, [epId]: sec } }));
  }, []);

  const markSeen = useCallback(
    (s: MjSeries) => {
      setState((st) => (st.seen.includes(s.id) ? st : { ...st, seen: [...st.seen, s.id] }));
      toast(`《${s.title}》已标记为看过`);
    },
    [toast],
  );

  const toggleFav = (sid: string, title: string) => {
    const has = state.favorites.includes(sid);
    setState((s) => ({
      ...s,
      favorites: has ? s.favorites.filter((x) => x !== sid) : [...s.favorites, sid],
    }));
    toast(has ? '已取消收藏' : `已收藏《${title}》`);
  };

  const openEp = (s: MjSeries) => (e: MjEpisode) => {
    if (!e.free) {
      toast('该集为会员专享 · 演示环境未开通会员');
      return;
    }
    setView({ kind: 'watch', sid: s.id, eid: e.id });
  };

  const resolveItem = (it: MjExtItem) => {
    if (resolving[it.id]) return;
    setResolving((r) => ({ ...r, [it.id]: true }));
    window.setTimeout(() => {
      const mode: MjExtMode = it.custom ? 'embed' : it.playMode;
      const message = mode === 'blocked' ? PLAY_MSG[it.reason ?? 'stream_expired'] : PLAY_MSG[mode];
      setResults((r) => ({ ...r, [it.id]: { mode, message } }));
      setResolving((r) => {
        const n = { ...r };
        delete n[it.id];
        return n;
      });
      toast(mode === 'blocked' ? '该源暂不可播，已说明原因' : '播放源解析成功');
    }, 700);
  };

  const addCustom = (cat: 'comic' | 'ai', title: string, url: string) => {
    const item: MjExtItem = {
      id: uid('u_'),
      title,
      cat,
      cover: '📺',
      source: `自定义片源${url ? ` · ${url}` : ''}`,
      episodesText: '集数未知（以实际解析为准）',
      playMode: 'embed',
      custom: true,
    };
    setState((s) => ({ ...s, customExt: [item, ...s.customExt] }));
  };

  const resetDemo = () => {
    if (!window.confirm('确定重置演示数据？收藏、观看进度与自定义片源将被清除。')) return;
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    setState(seedState());
    setView({ kind: 'home' });
    setQuery('');
    setResults({});
    setResolving({});
    toast('已恢复演示种子数据');
  };

  const goBack = () => {
    if (view.kind === 'watch') setView({ kind: 'detail', sid: view.sid });
    else setView({ kind: 'home' });
  };

  const extTotal = EXT_SEED.length + state.customExt.length;
  const favSeries = state.favorites
    .map((id) => SEED.find((s) => s.id === id))
    .filter((s): s is MjSeries => !!s);

  const renderBody = (): ReactNode => {
    if (view.kind === 'detail') {
      const s = SEED.find((x) => x.id === view.sid);
      if (!s) return <div className="manju-empty">剧集不存在</div>;
      if (detailLoading) return <MjLoading />;
      return (
        <DetailView
          series={s}
          fav={state.favorites.includes(s.id)}
          progress={state.progress}
          onToggleFav={() => toggleFav(s.id, s.title)}
          onPlay={openEp(s)}
        />
      );
    }
    if (view.kind === 'watch') {
      const s = SEED.find((x) => x.id === view.sid);
      if (!s) return <div className="manju-empty">剧集不存在</div>;
      const e = s.episodes.find((x) => x.id === view.eid);
      if (!e) return <div className="manju-empty">本集不存在</div>;
      if (watchLoading) return <MjLoading text="正在拉取片源…" />;
      const next = s.episodes.find((x) => x.index === e.index + 1) ?? null;
      return (
        <WatchView
          key={e.id}
          series={s}
          ep={e}
          savedSec={state.progress[e.id] ?? 0}
          seen={state.seen.includes(s.id)}
          onProgress={setProgress}
          onSeen={() => markSeen(s)}
          hasNext={!!next}
          onNext={() => next && setView({ kind: 'watch', sid: s.id, eid: next.id })}
        />
      );
    }
    if (view.kind === 'ext') {
      const items = [...state.customExt.filter((i) => i.cat === view.cat), ...EXT_SEED.filter((i) => i.cat === view.cat)];
      return (
        <ExtView
          cat={view.cat}
          items={items}
          results={results}
          resolving={resolving}
          onCat={(c) => setView({ kind: 'ext', cat: c })}
          onResolve={resolveItem}
          onAdd={addCustom}
        />
      );
    }
    return (
      <HomeView
        query={query}
        onQuery={setQuery}
        cont={cont}
        favorites={favSeries}
        seenList={state.seen}
        extTotal={extTotal}
        onOpen={(sid) => setView({ kind: 'detail', sid })}
        onContinue={(sid, eid) => setView({ kind: 'watch', sid, eid })}
        onOpenExt={() => setView({ kind: 'ext', cat: 'comic' })}
      />
    );
  };

  return (
    <div className="manju-wrap">
      <div className="manju-top">
        {view.kind !== 'home' && (
          <button className="btn btn-ghost btn-sm" onClick={goBack}>
            ‹ 返回
          </button>
        )}
        <div className="manju-top-title">漫剧 Manju</div>
        <div className="manju-top-spacer" />
        <button className="btn btn-ghost btn-sm" onClick={resetDemo}>
          🧹 重置演示数据
        </button>
      </div>
      {renderBody()}
      <div className="manju-foot muted">
        站内剧集为演示数据，原创 AI 剧《重生：我成了漫画主角》为本站 AI 生成演示内容；
        外部片单均为公有领域（Public Domain）或 CC-BY 署名授权内容，授权可验证、无版权争议；「解析播放源」为演示行为，不实际拉流。
      </div>
    </div>
  );
}
