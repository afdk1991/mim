import './manju.css';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useToast } from './components';
import { cx, uid } from './utils';
import { pullToolState, pushToolState } from './lib/tool-cloud';

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

/** 红果短剧公开元数据条目（public/external/*.json 运行时加载，仅元数据不含视频） */
interface HgItem {
  id: string;
  title: string;
  cover: string;
  episodesText: string;
  sourceLabel: string;
  detailUrl: string;
}

/** external/index.json 分类索引 */
interface HgIndex {
  providerLabel: string;
  attribution: string;
  catalogs: Array<{ category: 'ai-drama' | 'comic-drama'; categoryLabel: string; total: number }>;
}

interface MjState {
  favorites: string[];
  seen: string[];
  progress: Record<string, number>;
  customExt: MjExtItem[];
}

type MjView =
  | { kind: 'home' }
  | { kind: 'extIndex' }
  | { kind: 'extList'; cat: 'comic' | 'ai' | 'pd' }
  | { kind: 'extWatch'; cat: 'comic' | 'ai'; id: string }
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

export const mkEps = (sid: string, n: number, freeN: number): MjEpisode[] =>
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
  /* AI 剧 / 开源分类：Blender 开源电影（CC-BY / CC-BY-ND 署名授权，studio.blender.org 可验证） */
  { id: 'x_a1', title: 'Big Buck Bunny（2008）', cat: 'ai', cover: '🐰', source: 'Blender 开源电影 · CC-BY 署名', episodesText: '全片约 10 分钟 · 公开直链可用', playMode: 'direct', license: 'CC-BY' },
  { id: 'x_a2', title: 'Elephants Dream（2006）', cat: 'ai', cover: '🐘', source: 'Blender 开源电影 · CC-BY 署名', episodesText: '首部开源电影 · 全片约 11 分钟', playMode: 'embed', license: 'CC-BY' },
  { id: 'x_a3', title: 'Sintel（2010）', cat: 'ai', cover: '🐉', source: 'Blender 开源电影 · CC-BY 署名', episodesText: '奇幻短片 · 全片约 15 分钟', playMode: 'direct', license: 'CC-BY' },
  { id: 'x_a4', title: 'Tears of Steel（2012）', cat: 'ai', cover: '🦾', source: 'Blender 开源电影 · CC-BY 署名', episodesText: '真人+CG 科幻 · 全片约 12 分钟', playMode: 'direct', license: 'CC-BY' },
  { id: 'x_a5', title: 'Cosmos Laundromat: First Cycle（2015）', cat: 'ai', cover: '🐑', source: 'Blender 开源电影 · CC-BY 署名', episodesText: '首集正式片 · 全片约 12 分钟', playMode: 'embed', license: 'CC-BY' },
  { id: 'x_a6', title: 'Sprite Fright（2021）', cat: 'ai', cover: '🧚', source: 'Blender 开源电影 · CC-BY 署名', episodesText: '喜剧恐怖短片 · 全片约 10 分钟', playMode: 'blocked', reason: 'stream_expired', license: 'CC-BY' },
  /* 第二轮扩充（2026-10-20，授权逐条检索验证） */
  { id: 'x_c5', title: '超人：极地巨人（1942）', cat: 'comic', cover: '🦕', source: 'Fleischer Studios · 公版 Public Domain', episodesText: '超人系列第 4 部 · 冰封恐龙苏醒 · 全片约 9 分钟', playMode: 'direct', license: '公版 PD' },
  { id: 'x_c6', title: '汽船威利 Steamboat Willie（1928）', cat: 'comic', cover: '🚢', source: 'Walt Disney / Ub Iwerks · 公版 Public Domain（2024-01-01 起）', episodesText: '首部有声米奇动画 · 全片约 8 分钟', playMode: 'direct', license: '公版 PD' },
  { id: 'x_c7', title: '恐龙葛蒂 Gertie the Dinosaur（1914）', cat: 'comic', cover: '🦖', source: 'Winsor McCay · 公版 Public Domain', episodesText: '动画史首部角色动画 · 全片约 12 分钟', playMode: 'embed', license: '公版 PD' },
  { id: 'x_c8', title: '梦乡奇遇 Somewhere in Dreamland（1936）', cat: 'comic', cover: '🌙', source: 'Fleischer Studios 彩色经典系列 · 公版 Public Domain', episodesText: '彩色经典系列短片 · 全片约 8 分钟', playMode: 'embed', license: '公版 PD' },
  { id: 'x_a7', title: 'Charge 充电危机（2022）', cat: 'ai', cover: '🔋', source: 'Blender 开源电影 · CC-BY 4.0 署名', episodesText: '能源荒废土科幻 · 全片约 8 分钟', playMode: 'direct', license: 'CC-BY' },
  { id: 'x_a8', title: 'Coffee Run 咖啡快跑（2020）', cat: 'ai', cover: '☕', source: 'Blender 开源电影 · CC-BY 署名', episodesText: '咖啡因驱动的追忆短片 · 全片约 4 分钟', playMode: 'embed', license: 'CC-BY' },
  { id: 'x_a9', title: 'Glass Half 半杯水（2015）', cat: 'ai', cover: '🥛', source: 'Blender 开源电影 · CC-BY 署名', episodesText: '卡通渲染实验短片 · 全片约 3 分钟', playMode: 'direct', license: 'CC-BY' },
  { id: 'x_a10', title: 'Agent 327：Operation Barbershop（2017）', cat: 'ai', cover: '🕵️', source: 'Blender 开源电影 · CC-BY-ND 署名-禁止演绎', episodesText: '荷兰侦探动画测试片 · 全片约 4 分钟', playMode: 'blocked', reason: 'frame_blocked', license: 'CC-BY-ND' },
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

export function isExtItem(v: unknown): v is MjExtItem {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === 'string' && typeof o.title === 'string' && (o.cat === 'comic' || o.cat === 'ai');
}

export function seedState(): MjState {
  return { favorites: [], seen: [], progress: {}, customExt: [] };
}

export function loadManju(): MjState {
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

export function saveManju(s: MjState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 隐私模式下忽略 */
  }
}

/* ================= 红果短剧公开元数据目录（运行时加载 public/external/*.json） ================= */

const EXT_FILES = { comic: 'comic-drama.json', ai: 'ai-drama.json' } as const;
const HG_STEP = 60;

/** 模块级内存缓存：同一会话内避免重复拉取 500KB 级目录 */
const hgCache = new Map<string, HgItem[]>();

export function extUrl(file: string): string {
  return `${import.meta.env.BASE_URL}external/${file}`;
}

function isHgItemRaw(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === 'string' && typeof o.title === 'string' && typeof o.cover_url === 'string';
}

export async function loadHgIndex(sig: AbortSignal): Promise<HgIndex> {
  const res = await fetch(extUrl('index.json'), { signal: sig });
  if (!res.ok) throw new Error(`目录加载失败（HTTP ${res.status}）`);
  const raw: unknown = await res.json();
  if (!raw || typeof raw !== 'object') throw new Error('目录数据格式异常');
  const o = raw as Record<string, unknown>;
  const catalogs = (Array.isArray(o.catalogs) ? o.catalogs : [])
    .map((c): HgIndex['catalogs'][number] | null => {
      if (!c || typeof c !== 'object') return null;
      const cc = c as Record<string, unknown>;
      if ((cc.category !== 'ai-drama' && cc.category !== 'comic-drama') || typeof cc.category_label !== 'string') return null;
      return {
        category: cc.category,
        categoryLabel: cc.category_label,
        total: typeof cc.total === 'number' ? cc.total : 0,
      };
    })
    .filter((c): c is HgIndex['catalogs'][number] => !!c);
  if (catalogs.length === 0) throw new Error('目录数据格式异常');
  return {
    providerLabel: typeof o.provider_label === 'string' ? o.provider_label : '红果短剧',
    attribution: typeof o.attribution === 'string' ? o.attribution : '',
    catalogs,
  };
}

export async function loadHgItems(cat: 'comic' | 'ai', sig: AbortSignal): Promise<HgItem[]> {
  const hit = hgCache.get(cat);
  if (hit) return hit;
  const res = await fetch(extUrl(EXT_FILES[cat]), { signal: sig });
  if (!res.ok) throw new Error(`片单加载失败（HTTP ${res.status}）`);
  const raw: unknown = await res.json();
  const arr =
    raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).items)
      ? ((raw as Record<string, unknown>).items as unknown[])
      : [];
  const parsed: HgItem[] = [];
  for (const v of arr) {
    if (!isHgItemRaw(v)) continue;
    const o = v as Record<string, unknown>;
    parsed.push({
      id: o.id as string,
      title: o.title as string,
      cover: o.cover_url as string,
      episodesText: typeof o.episodes_text === 'string' ? o.episodes_text : '集数未知',
      sourceLabel: typeof o.source_label === 'string' ? o.source_label : '红果短剧',
      detailUrl: typeof o.detail_url === 'string' ? o.detail_url : '',
    });
  }
  if (parsed.length === 0) throw new Error('片单数据格式异常');
  hgCache.set(cat, parsed);
  return parsed;
}

/**
 * 打开来源站点：必须是「用户已二次确认」之后才会走到这里。
 * 用临时 <a> 而非 window.open，才能带上 target/rel/referrerPolicy；
 * rel 保留 external 反向链接凭证，跨源默认只发 origin。
 */
function openExternal(url: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener external';
  a.referrerPolicy = 'strict-origin-when-cross-origin';
  document.body.appendChild(a);
  a.click();
  a.remove();
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
  cont: MjContRow[];
  favorites: MjSeries[];
  seenList: string[];
  extTotal: number;
  onOpen: (sid: string) => void;
  onContinue: (sid: string, eid: string) => void;
  onOpenExt: () => void;
}) {
  return (
    <>
      <div className="manju-hero">
        <h1>漫剧 Manju</h1>
        <p>竖屏漫剧在线观影 · 站内片库（含原创 AI 剧）+ 外部片单索引（红果短剧公开目录 / 公版精选）</p>
      </div>

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
              <div className="muted">共 {props.extTotal} 条 · 红果公开元数据 / 公版 / CC-BY</div>
            </div>
            <span className="manju-ext-arrow">›</span>
          </div>
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

/* ================= 外部片单（红果短剧目录 + 站内精选，母本三级形态） ================= */

/** 三级页面之一：分类索引页（红果漫剧 / AI剧 + 站内精选入口） */
function ExtIndexView(props: {
  idx: HgIndex | null;
  err: string | null;
  pdCount: number;
  onReload: () => void;
  onOpenCat: (c: 'comic' | 'ai' | 'pd') => void;
}) {
  const idx = props.idx;
  return (
    <>
      <div className="muted manju-ext-note">
        外部片单仅收录公开元数据与来源链接，站内不存储、不转码任何视频，播放需跳转来源站观看；
        「站内精选」为公有领域（Public Domain）或 CC-BY 授权内容，可站内解析演示。
      </div>
      {props.err ? (
        <div className="manju-empty">
          加载失败：{props.err}
          <div style={{ marginTop: 10 }}>
            <button className="btn btn-primary btn-sm" onClick={props.onReload}>
              重试
            </button>
          </div>
        </div>
      ) : !idx ? (
        <MjLoading text="正在加载片单目录…" />
      ) : (
        <div className="manju-ext-cats">
          {idx.catalogs.map((c) => (
            <div
              key={c.category}
              className="manju-ext-cat card"
              role="button"
              tabIndex={0}
              onClick={() => props.onOpenCat(c.category === 'comic-drama' ? 'comic' : 'ai')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') props.onOpenCat(c.category === 'comic-drama' ? 'comic' : 'ai');
              }}
            >
              <span className="manju-ext-entry-emoji">{c.category === 'comic-drama' ? '🎬' : '🤖'}</span>
              <div className="manju-cont-info">
                <div className="manju-card-title">{c.categoryLabel}</div>
                <div className="muted">
                  {c.total} 条 · {idx.providerLabel}公开目录
                </div>
              </div>
              <span className="manju-ext-arrow">›</span>
            </div>
          ))}
          <div
            className="manju-ext-cat card"
            role="button"
            tabIndex={0}
            onClick={() => props.onOpenCat('pd')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') props.onOpenCat('pd');
            }}
          >
            <span className="manju-ext-entry-emoji">⭐</span>
            <div className="manju-cont-info">
              <div className="manju-card-title">站内精选 · 公版 / 开源</div>
              <div className="muted">{props.pdCount} 条 · 公版动画 / Blender 开源电影 · 站内解析演示</div>
            </div>
            <span className="manju-ext-arrow">›</span>
          </div>
        </div>
      )}
      {idx && idx.attribution && <div className="manju-attrib muted">{idx.attribution}</div>}
    </>
  );
}

/** 红果条目封面：热链来源站 CDN，加载失败回退 emoji 占位 */
function HgCover({ src, alt, lg }: { src: string; alt: string; lg?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (failed || !src) {
    return <div className={cx('manju-hg-cover-emoji', lg && 'manju-hg-cover-lg')}>📺</div>;
  }
  return (
    <img
      className={cx('manju-hg-cover', lg && 'manju-hg-cover-lg')}
      src={src}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

/** 三级页面之二：红果分类列表页（分批加载，每次 60 条） */
function HgListView(props: { cat: 'comic' | 'ai'; title: string; onOpenItem: (id: string) => void }) {
  const [items, setItems] = useState<HgItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [shown, setShown] = useState(HG_STEP);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const ac = new AbortController();
    setItems(null);
    setShown(HG_STEP);
    setErr(null);
    loadHgItems(props.cat, ac.signal)
      .then(setItems)
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        setErr(e instanceof Error ? e.message : '加载失败');
      });
    return () => ac.abort();
  }, [props.cat, reload]);

  if (err) {
    return (
      <div className="manju-empty">
        加载失败：{err}
        <div style={{ marginTop: 10 }}>
          <button className="btn btn-primary btn-sm" onClick={() => setReload((n) => n + 1)}>
            重试
          </button>
        </div>
      </div>
    );
  }
  if (!items) return <MjLoading text="正在加载片单…" />;

  const slice = items.slice(0, shown);
  return (
    <>
      <div className="muted manju-ext-note">
        {props.title} · 共 {items.length} 条 · 仅含公开元数据与来源链接，点击进入站内播放页
      </div>
      <div className="manju-hg-grid">
        {slice.map((it) => (
          <div
            key={it.id}
            className="manju-card card"
            role="button"
            tabIndex={0}
            onClick={() => props.onOpenItem(it.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') props.onOpenItem(it.id);
            }}
          >
            <HgCover src={it.cover} alt={it.title} />
            <div className="manju-card-body">
              <div className="manju-card-title">{it.title}</div>
              <div className="manju-card-meta muted">{it.episodesText}</div>
            </div>
          </div>
        ))}
      </div>
      {shown < items.length && (
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={() => setShown((n) => n + HG_STEP)}>
            加载更多（{shown} / {items.length}）
          </button>
        </div>
      )}
    </>
  );
}

/** 站内精选列表页（公版 / CC-BY 解析演示 + 自定义片源） */
function PdListView(props: {
  items: MjExtItem[];
  results: Record<string, MjPlayResult>;
  resolving: Record<string, boolean>;
  onResolve: (it: MjExtItem) => void;
  onAdd: (title: string, url: string) => void;
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
    props.onAdd(t, url.trim());
    setTitle('');
    setUrl('');
    toast('已添加自定义片源');
  };

  return (
    <>
      <div className="muted manju-ext-note">
        站内精选仅提供发现与播放源解析演示：直链可播 → 站内嵌入 → 不可播（降级）。
        收录标准：全部为公有领域（Public Domain）或 CC-BY 署名授权内容，授权可验证、无版权争议；
        真正 AI 生成剧集普遍保留创作者版权，站内自有 AI 原创剧见首页。
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
        <div className="muted">对应用户自定义内容源（user_defined）：填一个名称与地址，加入站内精选片单。</div>
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

/** 三级页面之三：红果条目站内播放页（解析演示固定降级，二次确认后跳原站） */
function ExtWatchView(props: {
  cat: 'comic' | 'ai';
  id: string;
  providerLabel: string;
  attribution: string;
}) {
  const toast = useToast();
  const [items, setItems] = useState<HgItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [res, setRes] = useState<MjPlayResult | null>(null);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    setItems(null);
    setErr(null);
    setRes(null);
    loadHgItems(props.cat, ac.signal)
      .then(setItems)
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        setErr(e instanceof Error ? e.message : '加载失败');
      });
    return () => ac.abort();
  }, [props.cat, reload]);

  if (err) {
    return (
      <div className="manju-empty">
        加载失败：{err}
        <div style={{ marginTop: 10 }}>
          <button className="btn btn-primary btn-sm" onClick={() => setReload((n) => n + 1)}>
            重试
          </button>
        </div>
      </div>
    );
  }
  if (!items) return <MjLoading text="正在加载条目…" />;

  const it = items.find((x) => x.id === props.id) ?? null;
  if (!it) return <div className="manju-empty">条目不存在</div>;

  const resolve = () => {
    if (resolving) return;
    setResolving(true);
    window.setTimeout(() => {
      setRes({ mode: 'blocked', message: PLAY_MSG.frame_blocked });
      setResolving(false);
    }, 700);
  };

  const gotoSource = () => {
    if (!it.detailUrl) {
      toast('该条目无来源链接');
      return;
    }
    if (!window.confirm('即将离开本站，前往来源站观看。确定继续？')) return;
    openExternal(it.detailUrl);
  };

  return (
    <>
      <div className="manju-extwatch card">
        <div className="manju-extwatch-cover">
          <HgCover src={it.cover} alt={it.title} lg />
        </div>
        <div className="manju-extwatch-info">
          <h2>{it.title}</h2>
          <div className="muted">
            {it.sourceLabel} · {it.episodesText}
          </div>
          <div className="manju-tags">
            <span className="tag">公开元数据</span>
            <span className="tag">站内不存储视频</span>
          </div>
          {res && (
            <div className="manju-ext-res manju-res-blocked">
              <div className="manju-ext-res-text">⛔ {res.message}</div>
              <span className="manju-reason">{REASON_LABEL.frame_blocked}</span>
            </div>
          )}
        </div>
      </div>
      <div className="manju-ctrls">
        <button className="btn btn-primary" disabled={resolving || !!res} onClick={resolve}>
          {resolving ? '解析中…' : res ? '⛔ 不可播' : '▶ 解析播放源'}
        </button>
        <button className="btn btn-ghost" onClick={gotoSource}>
          前往{props.providerLabel}观看 ↗
        </button>
      </div>
      {props.attribution && <div className="manju-attrib muted">{props.attribution}</div>}
    </>
  );
}

/* ================= 页面入口 ================= */

export function ManjuPage() {
  const toast = useToast();
  const [state, setState] = useState<MjState>(loadManju);
  const [view, setView] = useState<MjView>({ kind: 'home' });
  const [results, setResults] = useState<Record<string, MjPlayResult>>({});
  const [resolving, setResolving] = useState<Record<string, boolean>>({});
  const [idx, setIdx] = useState<HgIndex | null>(null);
  const [idxErr, setIdxErr] = useState<string | null>(null);
  const [idxReload, setIdxReload] = useState(0);

  const detailLoading = useSimLoad(view.kind === 'detail' ? view.sid : '');
  const watchLoading = useSimLoad(view.kind === 'watch' ? view.eid : '');

  useEffect(() => {
    saveManju(state);
    pushToolState(KEY, state); // 云端整包快照（不动 saveManju 本体，测试契约不受影响）
  }, [state]);

  /* 云端恢复（轮 6）：mount 拉取快照 → 写回本地 → 重载（幂等触发上方保存回推） */
  useEffect(() => {
    void pullToolState(KEY).then((d) => {
      if (!d || typeof d !== 'object') return;
      try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* ignore */ }
      setState(loadManju());
    });
  }, []);

  /* 红果目录索引：挂载时加载一次，失败可重试 */
  useEffect(() => {
    const ac = new AbortController();
    loadHgIndex(ac.signal)
      .then(setIdx)
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        setIdxErr(e instanceof Error ? e.message : '目录加载失败');
      });
    return () => ac.abort();
  }, [idxReload]);

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

  const addCustom = (title: string, url: string) => {
    const item: MjExtItem = {
      id: uid('u_'),
      title,
      cat: 'comic',
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
    setResults({});
    setResolving({});
    toast('已恢复演示种子数据');
  };

  const goBack = () => {
    if (view.kind === 'watch') setView({ kind: 'detail', sid: view.sid });
    else if (view.kind === 'extWatch') setView({ kind: 'extList', cat: view.cat });
    else if (view.kind === 'extList') setView({ kind: 'extIndex' });
    else setView({ kind: 'home' });
  };

  const hgTotal = idx?.catalogs.reduce((a, c) => a + c.total, 0) ?? 0;
  const extTotal = EXT_SEED.length + state.customExt.length + hgTotal;
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
    if (view.kind === 'extIndex') {
      return (
        <ExtIndexView
          idx={idx}
          err={idxErr}
          pdCount={EXT_SEED.length + state.customExt.length}
          onReload={() => setIdxReload((n) => n + 1)}
          onOpenCat={(c) => setView({ kind: 'extList', cat: c })}
        />
      );
    }
    if (view.kind === 'extList') {
      const cat = view.cat;
      if (cat === 'pd') {
        const items = [...state.customExt, ...EXT_SEED];
        return (
          <PdListView
            items={items}
            results={results}
            resolving={resolving}
            onResolve={resolveItem}
            onAdd={addCustom}
          />
        );
      }
      return (
        <HgListView
          cat={cat}
          title={cat === 'comic' ? '漫剧' : 'AI剧'}
          onOpenItem={(id) => setView({ kind: 'extWatch', cat, id })}
        />
      );
    }
    if (view.kind === 'extWatch') {
      return (
        <ExtWatchView
          cat={view.cat}
          id={view.id}
          providerLabel={idx?.providerLabel ?? '红果短剧'}
          attribution={idx?.attribution ?? ''}
        />
      );
    }
    return (
      <HomeView
        cont={cont}
        favorites={favSeries}
        seenList={state.seen}
        extTotal={extTotal}
        onOpen={(sid) => setView({ kind: 'detail', sid })}
        onContinue={(sid, eid) => setView({ kind: 'watch', sid, eid })}
        onOpenExt={() => setView({ kind: 'extIndex' })}
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
        站内精选均为公有领域（Public Domain）或 CC-BY 署名授权内容；红果短剧目录仅收录公开元数据与来源链接（作品与封面版权归权利人所有），站内不存储、不转码视频，「解析播放源」为演示行为。
      </div>
    </div>
  );
}
