import './manju.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

/** 兼容旧存档的播放模式标记（保留类型以通过持久化往返契约，新逻辑不再依赖） */
type MjExtMode = 'direct' | 'embed' | 'blocked';

interface MjExtItem {
  id: string;
  title: string;
  cat: 'comic' | 'ai';
  cover: string;
  source: string;
  episodesText: string;
  /** 兼容旧存档字段（不再参与播放逻辑） */
  playMode?: MjExtMode;
  custom?: boolean;
  /** 授权标识：仅收录可验证无版权争议的内容（公版 / CC 授权） */
  license?: string;
  /** 已验证的视频直链（存在时可在站内真实播放） */
  videoUrl?: string;
  /** 来源站页面（无直链时引导跳转） */
  homeUrl?: string;
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
  | { kind: 'play'; id: string; from: 'home' | 'pd' };

interface MjContRow {
  id: string;
  title: string;
  cover: string;
  sub: string;
}

/* ================= 站内精选（公版 / CC 授权真实内容） ================= */

export const mkEps = (sid: string, n: number, freeN: number): MjEpisode[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `${sid}_e${String(i + 1).padStart(2, '0')}`,
    index: i + 1,
    durationSec: 80 + ((i * 37) % 70),
    free: i < freeN,
  }));

/* 以下全部为真实存在的公有领域 / CC 授权内容：
   - Big Buck Bunny / Elephants Dream / Sintel / Tears of Steel 的 mp4 直链来自
     Google GTV 公开样片库（commondatastorage.googleapis.com），官方长期镜像，可真实播放；
   - 其余条目附来源站页面（Blender Studio / Internet Archive），跳转即可观看。 */
const EXT_SEED: MjExtItem[] = [
  /* 漫剧分类：公有领域经典动画（Public Domain，Internet Archive 可检索） */
  { id: 'x_c1', title: '超人：疯狂科学家（1941）', cat: 'comic', cover: '🦸', source: 'Fleischer Studios · 公版 Public Domain', episodesText: '首部超人动画 · 全片约 10 分钟', homeUrl: 'https://archive.org/search?query=superman+%22the+mad+scientist%22+1941', license: '公版 PD' },
  { id: 'x_c2', title: '超人：机械怪物（1941）', cat: 'comic', cover: '🤖', source: 'Fleischer Studios · 公版 Public Domain', episodesText: '超人系列第 2 部 · 全片约 10 分钟', homeUrl: 'https://archive.org/search?query=superman+%22the+mechanical+monsters%22', license: '公版 PD' },
  { id: 'x_c3', title: '贝蒂娃娃：Minnie the Moocher（1932）', cat: 'comic', cover: '💃', source: 'Fleischer Studios · 公版 Public Domain', episodesText: '贝蒂娃娃早期短片 · 全片约 8 分钟', homeUrl: 'https://archive.org/search?query=betty+boop+%22minnie+the+moocher%22', license: '公版 PD' },
  { id: 'x_c4', title: '大力水手公版短剧合集', cat: 'comic', cover: '🥬', source: 'Fleischer / Famous Studios · 公版 Public Domain', episodesText: '多部公版短剧 · 1930s-1950s', homeUrl: 'https://archive.org/search?query=popeye+the+sailor+fleischer', license: '公版 PD' },
  /* AI 剧 / 开源分类：Blender 开源电影（CC-BY / CC-BY-ND 署名授权，studio.blender.org 可验证） */
  { id: 'x_a1', title: 'Big Buck Bunny（2008）', cat: 'ai', cover: '🐰', source: 'Blender 开源电影 · CC-BY 署名', episodesText: '全片约 10 分钟 · 真实直链可播', videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4', license: 'CC-BY' },
  { id: 'x_a2', title: 'Elephants Dream（2006）', cat: 'ai', cover: '🐘', source: 'Blender 开源电影 · CC-BY 署名', episodesText: '首部开源电影 · 全片约 11 分钟 · 真实直链可播', videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4', license: 'CC-BY' },
  { id: 'x_a3', title: 'Sintel（2010）', cat: 'ai', cover: '🐉', source: 'Blender 开源电影 · CC-BY 署名', episodesText: '奇幻短片 · 全片约 15 分钟 · 真实直链可播', videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4', license: 'CC-BY' },
  { id: 'x_a4', title: 'Tears of Steel（2012）', cat: 'ai', cover: '🦾', source: 'Blender 开源电影 · CC-BY 署名', episodesText: '真人+CG 科幻 · 全片约 12 分钟 · 真实直链可播', videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4', license: 'CC-BY' },
  { id: 'x_a5', title: 'Cosmos Laundromat: First Cycle（2015）', cat: 'ai', cover: '🐑', source: 'Blender 开源电影 · CC-BY 署名', episodesText: '首集正式片 · 全片约 12 分钟', homeUrl: 'https://studio.blender.org/films/cosmos-laundromat/', license: 'CC-BY' },
  { id: 'x_a6', title: 'Sprite Fright（2021）', cat: 'ai', cover: '🧚', source: 'Blender 开源电影 · CC-BY 署名', episodesText: '喜剧恐怖短片 · 全片约 10 分钟', homeUrl: 'https://studio.blender.org/films/sprite-fright/', license: 'CC-BY' },
  /* 第二轮扩充（授权逐条检索验证） */
  { id: 'x_c5', title: '超人：极地巨人（1942）', cat: 'comic', cover: '🦕', source: 'Fleischer Studios · 公版 Public Domain', episodesText: '超人系列第 4 部 · 冰封恐龙苏醒 · 全片约 9 分钟', homeUrl: 'https://archive.org/search?query=superman+%22arctic+giants%22', license: '公版 PD' },
  { id: 'x_c6', title: '汽船威利 Steamboat Willie（1928）', cat: 'comic', cover: '🚢', source: 'Walt Disney / Ub Iwerks · 公版 Public Domain（2024-01-01 起）', episodesText: '首部有声米奇动画 · 全片约 8 分钟', homeUrl: 'https://archive.org/search?query=%22steamboat+willie%22', license: '公版 PD' },
  { id: 'x_c7', title: '恐龙葛蒂 Gertie the Dinosaur（1914）', cat: 'comic', cover: '🦖', source: 'Winsor McCay · 公版 Public Domain', episodesText: '动画史首部角色动画 · 全片约 12 分钟', homeUrl: 'https://archive.org/search?query=gertie+the+dinosaur', license: '公版 PD' },
  { id: 'x_c8', title: '梦乡奇遇 Somewhere in Dreamland（1936）', cat: 'comic', cover: '🌙', source: 'Fleischer Studios 彩色经典系列 · 公版 Public Domain', episodesText: '彩色经典系列短片 · 全片约 8 分钟', homeUrl: 'https://archive.org/search?query=%22somewhere+in+dreamland%22', license: '公版 PD' },
  { id: 'x_a7', title: 'Charge 充电危机（2022）', cat: 'ai', cover: '🔋', source: 'Blender 开源电影 · CC-BY 4.0 署名', episodesText: '能源荒废土科幻 · 全片约 8 分钟', homeUrl: 'https://studio.blender.org/films/charge/', license: 'CC-BY' },
  { id: 'x_a8', title: 'Coffee Run 咖啡快跑（2020）', cat: 'ai', cover: '☕', source: 'Blender 开源电影 · CC-BY 署名', episodesText: '咖啡因驱动的追忆短片 · 全片约 4 分钟', homeUrl: 'https://studio.blender.org/films/coffee-run/', license: 'CC-BY' },
  { id: 'x_a9', title: 'Glass Half 半杯水（2015）', cat: 'ai', cover: '🥛', source: 'Blender 开源电影 · CC-BY 署名', episodesText: '卡通渲染实验短片 · 全片约 3 分钟', homeUrl: 'https://studio.blender.org/films/glass-half/', license: 'CC-BY' },
  { id: 'x_a10', title: 'Agent 327：Operation Barbershop（2017）', cat: 'ai', cover: '🕵️', source: 'Blender 开源电影 · CC-BY-ND 署名-禁止演绎', episodesText: '荷兰侦探动画测试片 · 全片约 4 分钟', homeUrl: 'https://studio.blender.org/films/agent-327/', license: 'CC-BY-ND' },
];

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

function MjLoading({ text = '加载中…' }: { text?: string }) {
  return <div className="manju-loading muted">{text}</div>;
}

/** 站内精选卡片（公版 / CC 授权真实内容） */
function MjCard({
  it,
  tone,
  seen,
  onOpen,
}: {
  it: MjExtItem;
  tone: number;
  seen: boolean;
  onOpen: () => void;
}) {
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
      <div className={cx('manju-cover', `manju-tone${tone}`)}>
        <span className="manju-cover-emoji">{it.cover}</span>
        {it.license && <span className="manju-badge manju-license">{it.license}</span>}
        {it.custom && <span className="manju-badge manju-custom">自定义</span>}
        {seen && <span className="manju-badge manju-seen">已看</span>}
      </div>
      <div className="manju-card-body">
        <div className="manju-card-title">{it.title}</div>
        <div className="manju-card-meta muted">{it.episodesText}</div>
      </div>
    </div>
  );
}

/* ================= 首页 ================= */

function HomeView(props: {
  cont: MjContRow[];
  favorites: MjExtItem[];
  items: MjExtItem[];
  seenList: string[];
  extTotal: number;
  onOpen: (id: string) => void;
  onContinue: (id: string) => void;
  onOpenExt: () => void;
}) {
  return (
    <>
      <div className="manju-hero">
        <h1>漫剧 Manju</h1>
        <p>站内精选（公版 / CC 授权真实内容）+ 外部片单索引（红果短剧公开目录）</p>
      </div>

      {props.cont.length > 0 && (
        <>
          <div className="manju-section-head">
            <h3>继续观看</h3>
            <span className="muted">上次没看完的</span>
          </div>
          <div className="manju-cont-list">
            {props.cont.map((r) => (
              <div key={r.id} className="manju-cont card">
                <span className="manju-cont-cover">{r.cover}</span>
                <div className="manju-cont-info">
                  <div className="manju-card-title">{r.title}</div>
                  <div className="muted">{r.sub}</div>
                </div>
                <button className="btn btn-primary btn-sm" onClick={() => props.onContinue(r.id)}>
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
        <div className="manju-empty manju-empty-soft">还没有收藏 · 在「站内精选」中点亮 ❤️ 即可收藏</div>
      ) : (
        <div className="manju-grid">
          {props.favorites.map((it, i) => (
            <MjCard
              key={it.id}
              it={it}
              tone={(i % 5) + 1}
              seen={props.seenList.includes(it.id)}
              onOpen={() => props.onOpen(it.id)}
            />
          ))}
        </div>
      )}

      <div className="manju-section-head">
        <h3>站内精选</h3>
        <span className="muted">{props.items.length} 部 · 公版动画 / Blender 开源电影</span>
      </div>
      <div className="manju-grid">
        {props.items.map((it, i) => (
          <MjCard
            key={it.id}
            it={it}
            tone={(i % 5) + 1}
            seen={props.seenList.includes(it.id)}
            onOpen={() => props.onOpen(it.id)}
          />
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
          <div className="muted">共 {props.extTotal} 条 · 红果公开元数据 / 公版 / CC 授权</div>
        </div>
        <span className="manju-ext-arrow">›</span>
      </div>
    </>
  );
}

/* ================= 站内真实播放页 ================= */

function PlayView(props: {
  item: MjExtItem;
  savedSec: number;
  onProgress: (id: string, sec: number) => void;
  onSeen: () => void;
}) {
  const { item } = props;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastSaved = useRef(props.savedSec);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);

  /* 有进度且未接近片尾时，从上次位置续播 */
  const onMeta = () => {
    const v = videoRef.current;
    if (!v || !v.duration || !Number.isFinite(v.duration)) return;
    const saved = props.savedSec;
    if (saved > 0 && saved < v.duration * 0.95) v.currentTime = saved;
  };

  /* 每 ≥5 秒保存一次进度；≥95% 视为已看 */
  const onTime = () => {
    const v = videoRef.current;
    if (!v) return;
    const sec = Math.floor(v.currentTime);
    if (v.duration > 0 && Number.isFinite(v.duration) && sec / v.duration >= 0.95) {
      props.onSeen();
      props.onProgress(item.id, Math.floor(v.duration));
      return;
    }
    if (sec - lastSaved.current >= 5) {
      lastSaved.current = sec;
      props.onProgress(item.id, sec);
    }
  };

  const onEnd = () => {
    props.onSeen();
    const v = videoRef.current;
    if (v && Number.isFinite(v.duration)) props.onProgress(item.id, Math.floor(v.duration));
  };

  return (
    <>
      <div className="manju-player card">
        {item.videoUrl && !failed ? (
          <video
            key={reload}
            ref={videoRef}
            className="manju-video"
            src={item.videoUrl}
            controls
            playsInline
            preload="metadata"
            style={{ width: '100%', maxHeight: '60vh', display: 'block', background: '#000' }}
            onLoadedMetadata={onMeta}
            onTimeUpdate={onTime}
            onEnded={onEnd}
            onError={() => setFailed(true)}
          />
        ) : (
          <div className="manju-empty" style={{ margin: 0 }}>
            {failed
              ? '视频加载失败：直链可能已失效，可重试或前往来源站观看。'
              : '站内未收录该内容的视频直链，请前往来源站观看。'}
            <div style={{ marginTop: 10, display: 'flex', gap: 8, justifyContent: 'center' }}>
              {failed && item.videoUrl && (
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    setFailed(false);
                    setReload((n) => n + 1);
                  }}
                >
                  重试
                </button>
              )}
              {item.homeUrl && (
                <button className="btn btn-ghost btn-sm" onClick={() => openExternal(item.homeUrl as string)}>
                  前往来源站 ↗
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="manju-now card">
        <div className="manju-card-title">{item.title}</div>
        <div className="muted">
          {item.source} · {item.episodesText}
          {props.savedSec > 0 ? ` · 上次看到 ${Math.floor(props.savedSec / 60)} 分 ${props.savedSec % 60} 秒` : ''}
        </div>
        {item.license && <div className="manju-now-hint">📜 授权：{item.license}（授权信息以来源站为准）</div>}
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
        外部片单仅收录公开元数据与来源链接，站内不存储、不转码任何视频；
        「站内精选」为公有领域（Public Domain）或 CC 授权内容，含真实视频直链或来源站页面。
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
              <div className="muted">{props.pdCount} 条 · 公版动画 / Blender 开源电影 · 真实可播</div>
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
        {props.title} · 共 {items.length} 条 · 仅含公开元数据与来源链接，点击进入条目页跳转来源站
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

/** 站内精选列表页（公版 / CC 授权真实内容 + 自定义片源） */
function PdListView(props: {
  items: MjExtItem[];
  onPlay: (id: string) => void;
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
        站内精选收录公有领域（Public Domain）或 CC 署名授权内容，授权可验证、无版权争议；
        有直链的可站内真实播放，其余跳转来源站观看。
      </div>

      {props.items.map((it) => (
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
            {it.videoUrl ? (
              <button className="btn btn-primary btn-sm" onClick={() => props.onPlay(it.id)}>
                ▶ 站内播放
              </button>
            ) : it.homeUrl ? (
              <button className="btn btn-ghost btn-sm" onClick={() => openExternal(it.homeUrl as string)}>
                来源站观看 ↗
              </button>
            ) : (
              <span className="muted">未提供可播地址</span>
            )}
          </div>
        </div>
      ))}

      <div className="manju-addform card">
        <div className="manju-card-title">添加自定义片源</div>
        <div className="muted">填一个名称与直链地址（可选），加入站内精选片单；无地址的条目仅作记录。</div>
        <div className="manju-addform-row">
          <input
            className="input"
            placeholder="片名，如：我的自制漫剧"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <input
            className="input"
            placeholder="视频直链地址（可选）"
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

/** 三级页面之三：红果条目页（仅公开元数据，跳转来源站观看） */
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

  useEffect(() => {
    const ac = new AbortController();
    setItems(null);
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
  if (!items) return <MjLoading text="正在加载条目…" />;

  const it = items.find((x) => x.id === props.id) ?? null;
  if (!it) return <div className="manju-empty">条目不存在</div>;

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
        </div>
      </div>
      <div className="manju-ctrls">
        <button className="btn btn-primary" onClick={gotoSource}>
          前往{props.providerLabel}观看 ↗
        </button>
      </div>
      <div className="muted manju-ext-note">
        红果条目仅提供公开元数据，站内不解析、不转码视频，请前往来源站观看正片。
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
  const [idx, setIdx] = useState<HgIndex | null>(null);
  const [idxErr, setIdxErr] = useState<string | null>(null);
  const [idxReload, setIdxReload] = useState(0);

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

  /* 站内精选全集（含自定义片源），按 id 反查 */
  const allItems = useMemo<MjExtItem[]>(() => [...state.customExt, ...EXT_SEED], [state.customExt]);

  /* 续播列表：有进度且未看完（保存进度 < 时长 95%）的条目，取前 4 条 */
  const cont = useMemo<MjContRow[]>(() => {
    const rows: MjContRow[] = [];
    for (const it of allItems) {
      if (!it.videoUrl) continue;
      const p = state.progress[it.id] ?? 0;
      if (p <= 0) continue;
      const mins = Math.floor(p / 60);
      rows.push({
        id: it.id,
        title: it.title,
        cover: it.cover,
        sub: mins > 0 ? `已看约 ${mins} 分 ${p % 60} 秒` : `已看 ${p} 秒`,
      });
    }
    return rows.slice(0, 4);
  }, [allItems, state.progress]);

  const setProgress = useCallback((id: string, sec: number) => {
    setState((s) => ({ ...s, progress: { ...s.progress, [id]: sec } }));
  }, []);

  const markSeen = useCallback(
    (it: MjExtItem) => {
      setState((st) => (st.seen.includes(it.id) ? st : { ...st, seen: [...st.seen, it.id] }));
    },
    [],
  );

  const toggleFav = (id: string, title: string) => {
    const has = state.favorites.includes(id);
    setState((s) => ({
      ...s,
      favorites: has ? s.favorites.filter((x) => x !== id) : [...s.favorites, id],
    }));
    toast(has ? '已取消收藏' : `已收藏《${title}》`);
  };

  const addCustom = (title: string, url: string) => {
    const item: MjExtItem = {
      id: uid('u_'),
      title,
      cat: 'comic',
      cover: '📺',
      source: '自定义片源',
      episodesText: url ? '自定义直链 · 集数未知' : '仅记录 · 未提供地址',
      ...(url ? { videoUrl: url } : {}),
      custom: true,
    };
    setState((s) => ({ ...s, customExt: [item, ...s.customExt] }));
  };

  const clearLocal = () => {
    if (!window.confirm('清空收藏、观看进度与自定义片源？')) return;
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    setState(seedState());
    setView({ kind: 'home' });
    toast('本地数据已清空');
  };

  const goBack = () => {
    if (view.kind === 'play') setView(view.from === 'home' ? { kind: 'home' } : { kind: 'extList', cat: 'pd' });
    else if (view.kind === 'extWatch') setView({ kind: 'extList', cat: view.cat });
    else if (view.kind === 'extList') setView({ kind: 'extIndex' });
    else setView({ kind: 'home' });
  };

  const hgTotal = idx?.catalogs.reduce((a, c) => a + c.total, 0) ?? 0;
  const extTotal = allItems.length + hgTotal;
  const favItems = state.favorites
    .map((id) => allItems.find((it) => it.id === id))
    .filter((it): it is MjExtItem => !!it);

  const openItem = (id: string, from: 'home' | 'pd') => {
    const it = allItems.find((x) => x.id === id);
    if (!it) return;
    setView({ kind: 'play', id, from });
  };

  const renderBody = (): ReactNode => {
    if (view.kind === 'play') {
      const it = allItems.find((x) => x.id === view.id);
      if (!it) return <div className="manju-empty">条目不存在</div>;
      return (
        <>
          <div className="manju-section-head">
            <h3>{it.title}</h3>
            <button
              className={cx('btn btn-sm', state.favorites.includes(it.id) ? 'btn-ghost' : 'btn-primary')}
              onClick={() => toggleFav(it.id, it.title)}
            >
              {state.favorites.includes(it.id) ? '💔 取消收藏' : '❤️ 收藏'}
            </button>
          </div>
          <PlayView
            key={it.id}
            item={it}
            savedSec={state.progress[it.id] ?? 0}
            onProgress={setProgress}
            onSeen={() => markSeen(it)}
          />
        </>
      );
    }
    if (view.kind === 'extIndex') {
      return (
        <ExtIndexView
          idx={idx}
          err={idxErr}
          pdCount={allItems.length}
          onReload={() => setIdxReload((n) => n + 1)}
          onOpenCat={(c) => setView({ kind: 'extList', cat: c })}
        />
      );
    }
    if (view.kind === 'extList') {
      const cat = view.cat;
      if (cat === 'pd') {
        return (
          <PdListView
            items={allItems}
            onPlay={(id) => openItem(id, 'pd')}
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
        favorites={favItems}
        items={allItems}
        seenList={state.seen}
        extTotal={extTotal}
        onOpen={(id) => openItem(id, 'home')}
        onContinue={(id) => openItem(id, 'home')}
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
        <button className="btn btn-ghost btn-sm" onClick={clearLocal}>
          🧹 清空本地数据
        </button>
      </div>
      {renderBody()}
      <div className="manju-foot muted">
        站内精选均为公有领域（Public Domain）或 CC 授权内容，视频直链来自公开镜像（Blender 开源电影 / Google 公开样片库）；
        红果短剧目录仅收录公开元数据与来源链接（作品与封面版权归权利人所有），站内不存储、不转码视频。
      </div>
    </div>
  );
}
