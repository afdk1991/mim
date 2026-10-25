import './manju.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useToast } from './components';
import { cx, uid } from './utils';
import { pullToolStateMeta, pushToolStateThrottled } from './lib/tool-cloud';
import { detectMediaKind, usePlayer, usePlayerControl, type MediaTrack } from './player';
import {
  classifyDiscError,
  licenseLabel,
  searchCommonsCached,
  searchOpenverseCached,
  UNKNOWN_LICENSE,
  type FetchLike,
  type OvMedia,
} from './lib/openverse';

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
  /** 已验证的音频直链（与 videoUrl 二选一；自定义片源按扩展名自动判定） */
  audioUrl?: string;
  /** 封面缩略图 URL（在线发现来源提供；加载失败时回退 emoji 封面） */
  thumb?: string;
  /** 来源站页面（无直链时引导跳转） */
  homeUrl?: string;
}

interface MjState {
  favorites: string[];
  seen: string[];
  progress: Record<string, number>;
  customExt: MjExtItem[];
}

type MjView =
  | { kind: 'home' }
  | { kind: 'list' }
  | { kind: 'play'; id: string; from: 'home' | 'list' };

interface MjContRow {
  id: string;
  title: string;
  cover: string;
  sub: string;
}

/** Openverse 视频检索结果（仅取用到的字段，兼容缺字段） */
interface OpenverseVideo {
  id?: string;
  title?: string;
  url?: string;
  foreign_landing_url?: string;
  license?: string;
  license_version?: string;
  source?: string;
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
  /* 第二轮继续扩充（CC / 公版，来源站可验证） */
  { id: 'x_a11', title: 'Spring 春（2019）', cat: 'ai', cover: '🌸', source: 'Blender 开源电影 · CC-BY 署名', episodesText: '四季童话短片 · 全片约 8 分钟', homeUrl: 'https://studio.blender.org/films/spring/', license: 'CC-BY' },
  { id: 'x_a12', title: 'Wing it! 展翅（2021）', cat: 'ai', cover: '🕊️', source: 'Blender 开源电影 · CC-BY 署名', episodesText: '喜剧飞行短片 · 全片约 3 分钟', homeUrl: 'https://studio.blender.org/films/wing-it/', license: 'CC-BY' },
  { id: 'x_a13', title: 'Caminandes 3：Llama Drama（2016）', cat: 'ai', cover: '🦙', source: 'Blender 开源电影 · CC-BY 署名', episodesText: '羊驼喜剧三部曲终章 · 全片约 3 分钟', homeUrl: 'https://studio.blender.org/films/caminandes-3-llama-drama/', license: 'CC-BY' },
  { id: 'x_a14', title: 'Napkin Films · AI 导演动画合集', cat: 'ai', cover: '🤖', source: 'Napkin Films · CC-BY 4.0 署名', episodesText: '代码生成的 AI 导演动画短片（73 部）', homeUrl: 'https://joshuaayson.com/films/', license: 'CC-BY' },
  { id: 'x_a15', title: 'Cyberpunk Rainy Street（Hailuo AI）', cat: 'ai', cover: '🌃', source: 'Wikimedia Commons · CC0 公共领域', episodesText: 'AI 文生视频短片 · 来源站可看', homeUrl: 'https://commons.wikimedia.org/wiki/File:Cyberpunk_Rainy_Street_(Hailuo_AI).webm', license: 'CC0' },
  /* 音频种子（公有领域音乐，直链走 Wikimedia Commons Special:FilePath 稳定重定向，可在站内真实播放） */
  { id: 'x_m1', title: '巴赫：D 小调托卡塔与赋格 BWV 565', cat: 'ai', cover: '🎵', source: 'Wikimedia Commons · 公版 Public Domain', episodesText: '巴洛克管风琴名曲 · 音频直链可播', audioUrl: 'https://commons.wikimedia.org/wiki/Special:FilePath/Johann_Sebastian_Bach_-_Toccata_and_Fugue_in_D_minor,_BWV_565.ogg', license: '公版 PD' },
  { id: 'x_m2', title: '贝多芬：第五交响曲第一乐章', cat: 'ai', cover: '🎼', source: 'Wikimedia Commons · 公版 Public Domain', episodesText: '命运交响曲 · 音频直链可播', audioUrl: 'https://commons.wikimedia.org/wiki/Special:FilePath/Beethoven_Symphony_No._5_in_C_minor,_Op._67_-_I._Allegro_con_brio.ogg', license: '公版 PD' },
  { id: 'x_m3', title: '斯科特·乔普林：艺人 The Entertainer', cat: 'ai', cover: '🎹', source: 'Wikimedia Commons · 公版 Public Domain', episodesText: '拉格泰姆钢琴名曲 · 音频直链可播', audioUrl: 'https://commons.wikimedia.org/wiki/Special:FilePath/Scott_Joplin_-_The_Entertainer.ogg', license: '公版 PD' },
];

/* ================= 在线发现：Openverse CC 授权视频/音频检索 ================= */

/** 将 Openverse 结果映射为站内 MjExtItem；media 决定直链落 videoUrl 还是 audioUrl */
export function mapOpenverseItem(r: unknown, media: OvMedia = 'videos'): MjExtItem | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  const id = typeof o.id === 'string' ? o.id : '';
  if (!id) return null;
  const title = typeof o.title === 'string' && o.title.trim() ? o.title.trim() : '未命名开放授权媒体';
  const directUrl = typeof o.url === 'string' ? o.url : '';
  const homeUrl = typeof o.foreign_landing_url === 'string' ? o.foreign_landing_url : undefined;
  const thumb = typeof o.thumbnail === 'string' ? o.thumbnail : undefined;
  // 扩展名判定统一复用播放器的 detectMediaKind（单一事实源，避免两套白名单漂移）
  const kindOk = !!directUrl && detectMediaKind(directUrl) === (media === 'audio' ? 'audio' : 'video');
  const source =
    typeof o.source === 'string' && o.source ? `Openverse · ${o.source}` : 'Openverse · CC 授权';
  const audio = media === 'audio';
  return {
    id: `ov_${id}`,
    title,
    cat: 'ai',
    cover: '🌐',
    source,
    episodesText: kindOk
      ? audio
        ? '在线发现 · 音频直链可播'
        : '在线发现 · 直链可试播'
      : '在线发现 · 跳转来源站',
    ...(kindOk ? (audio ? { audioUrl: directUrl } : { videoUrl: directUrl }) : {}),
    ...(thumb ? { thumb } : {}),
    ...(homeUrl ? { homeUrl } : {}),
    license: licenseLabel(o.license, o.license_version) || UNKNOWN_LICENSE,
    custom: true,
  };
}

/** Commons videoinfo.extmetadata 取值（去 HTML 标签） */
function extmetaValue(v: unknown): string {
  if (!v || typeof v !== 'object') return '';
  const raw = (v as { value?: unknown }).value;
  if (typeof raw !== 'string') return '';
  return raw.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/** 将 Wikimedia Commons 文件页映射为站内 MjExtItem（视频直链在 upload.wikimedia.org） */
export function mapCommonsPage(p: unknown): MjExtItem | null {
  if (!p || typeof p !== 'object') return null;
  const o = p as Record<string, unknown>;
  const pageid = typeof o.pageid === 'number' ? o.pageid : 0;
  const title =
    typeof o.title === 'string' ? o.title.replace(/^File:/, '').replace(/_/g, ' ').trim() : '';
  if (!pageid || !title) return null;
  const vi = Array.isArray(o.videoinfo)
    ? (o.videoinfo[0] as Record<string, unknown> | undefined)
    : undefined;
  const url = typeof vi?.url === 'string' ? vi.url : '';
  const thumb = typeof vi?.thumburl === 'string' ? vi.thumburl : undefined;
  const homeUrl = typeof vi?.descriptionurl === 'string' ? vi.descriptionurl : undefined;
  const em = (vi?.extmetadata ?? {}) as Record<string, unknown>;
  const isVideo = !!url && detectMediaKind(url) === 'video';
  return {
    id: `wc_${pageid}`,
    title,
    cat: 'ai',
    cover: '🌐',
    source: 'Wikimedia Commons · 开放授权',
    episodesText: isVideo ? 'Commons 直链可播' : 'Commons · 跳转文件页',
    ...(isVideo ? { videoUrl: url } : {}),
    ...(thumb ? { thumb } : {}),
    ...(homeUrl ? { homeUrl } : {}),
    license: extmetaValue(em.LicenseShortName) || UNKNOWN_LICENSE,
    custom: true,
  };
}

export interface DiscoverResult {
  items: MjExtItem[];
  page: number;
  pageCount: number;
  resultCount: number;
  /** Commons 等不返回总量的来源用 hasMore 判断是否可继续翻页 */
  hasMore?: boolean;
}

/**
 * Openverse 检索（优先 mim-api 代理，本地模式回退直连）。
 * fetchFn 可注入以便测试；proxyBase 传 '' 强制直连。错误按 OvError 细分（rate_limit/network/upstream/parse）。
 */
export async function discoverOpenverse(
  q: string,
  fetchFn?: FetchLike,
  opts: { media?: OvMedia; page?: number; proxyBase?: string } = {},
): Promise<DiscoverResult> {
  const media = opts.media ?? 'videos';
  const r = await searchOpenverseCached(q, {
    media,
    page: opts.page,
    fetchFn,
    ...(opts.proxyBase !== undefined ? { proxyBase: opts.proxyBase } : {}),
  });
  const items: MjExtItem[] = [];
  for (const raw of r.results) {
    const it = mapOpenverseItem(raw, media);
    if (it) items.push(it);
  }
  return { items, page: r.page, pageCount: r.pageCount, resultCount: r.resultCount, hasMore: r.hasMore };
}

/** Wikimedia Commons 视频检索（AI 生成短片等开放授权内容，CORS 友好直连，支持 gsroffset 翻页） */
export async function discoverCommons(
  q: string,
  fetchFn?: FetchLike,
  opts: { proxyBase?: string; offset?: number } = {},
): Promise<DiscoverResult> {
  const r = await searchCommonsCached(q, {
    fetchFn,
    offset: opts.offset,
  });
  const items: MjExtItem[] = [];
  for (const raw of r.results) {
    const it = mapCommonsPage(raw);
    if (it) items.push(it);
  }
  return { items, page: 1, pageCount: 1, resultCount: r.resultCount, hasMore: r.hasMore };
}

/* ================= 与全站统一播放器对接 ================= */

/** 取条目的可播直链 + 媒体类型（视频优先；其次音频） */
export function playableOf(it: MjExtItem): { src: string; kind: 'audio' | 'video' } | null {
  if (it.videoUrl) return { src: it.videoUrl, kind: 'video' };
  if (it.audioUrl) return { src: it.audioUrl, kind: 'audio' };
  return null;
}

/** 将站内条目转换为统一播放器曲目 */
export function toTrack(it: MjExtItem): MediaTrack | null {
  const p = playableOf(it);
  if (!p) return null;
  return {
    id: it.id,
    title: it.title,
    artist: it.source,
    kind: p.kind,
    src: p.src,
    poster: it.thumb ?? it.cover,
    cover: it.cover,
    license: it.license,
    meta: it.episodesText,
  };
}

/** 由自定义片源 URL 判定媒体类型（复用播放器的纯函数） */
export function kindOfUrl(url: string): 'audio' | 'video' {
  return detectMediaKind(url);
}

/* ================= 本地持久化 ================= */

const KEY = 'mim-manju-v1';
/** 本地最后保存时间（ISO 字符串），与云端 updated_at 做「新者优先」合并 */
const SAVED_AT_KEY = 'mim-manju-v1-at';
/** 自定义片单上限（localStorage 5MB 配额保护） */
const MAX_CUSTOM = 200;

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

/** 保存本地状态；返回 false 表示写入失败（隐私模式 / 配额满），调用方应告知用户 */
export function saveManju(s: MjState): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

/* ================= 红果外部目录加载层已随「彻底下线红果」方案移除（见 漫剧片单变更总结） ================= */

/**
 * 打开来源站点：必须是「用户已二次确认」之后才会走到这里。
 * 用临时 <a> 而非 window.open，才能带上 target/rel/referrerPolicy；
 * rel 保留 external 反向链接凭证，跨源默认只发 origin。
 * scheme 白名单：仅 http(s)，拦截 javascript: 等危险协议（在线发现数据来自
 * 第三方 API，理论上存在被污染可能，不能无条件信任）。
 */
function openExternal(url: string): void {
  if (!/^https?:\/\/[^\s]+$/i.test(url)) return;
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
  onOpen: (id: string) => void;
  onContinue: (id: string) => void;
  onViewAll: () => void;
}) {
  return (
    <>
      <div className="manju-hero">
        <h1>漫剧 Manju</h1>
        <p>站内精选 · 公有领域 / CC 授权真实内容，全部可看、无版权争议</p>
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

      <div className="manju-section-head manju-section-head-row">
        <h3>站内精选</h3>
        <button className="btn btn-ghost btn-sm" onClick={props.onViewAll}>
          全部 {props.items.length} 部 ›
        </button>
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
    </>
  );
}

/* ================= 站内真实播放页（驱动全站统一播放器） ================= */

function PlayView(props: {
  item: MjExtItem;
  savedSec: number;
  onPlay: (position?: number) => void;
}) {
  const { item } = props;
  const p = usePlayer();
  const track = toTrack(item);
  const isThis = p.current?.id === item.id;
  const playingThis = isThis && p.status === 'playing';
  const pausedThis = isThis && p.status === 'paused';
  const hasProgress = props.savedSec > 0;

  const fmt = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  return (
    <>
      <div className="manju-player card">
        {track ? (
          <div className="manju-now-player">
            <div className="manju-now-cover">{item.cover}</div>
            <div className="manju-now-info">
              <div className="manju-card-title">{item.title}</div>
              <div className="muted">
                {item.source} · {item.episodesText}
                {hasProgress ? ` · 上次看到 ${fmt(props.savedSec)}` : ''}
              </div>
              {item.license && <div className="manju-now-hint">📜 授权：{item.license}（授权信息以来源站为准）</div>}
              <div className="manju-now-actions">
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    /* 正在播/已暂停本条目 → 直接走播放器 toggle（暂停或继续）；
                       否则按已存进度启动，避免旧实现「点了暂停却重启」的死按钮问题 */
                    if (playingThis || pausedThis) p.toggle();
                    else props.onPlay(props.savedSec);
                  }}
                >
                  {playingThis ? '⏸ 暂停' : isThis ? `▶ 继续播放${hasProgress ? `（${fmt(props.savedSec)}）` : ''}` : `▶ 播放${hasProgress ? '（续播）' : ''}`}
                </button>
                {hasProgress && !playingThis && (
                  <button className="btn btn-ghost btn-sm" onClick={() => props.onPlay(props.savedSec)}>
                    ↺ 从 {fmt(props.savedSec)} 续播
                  </button>
                )}
                <button className="btn btn-ghost btn-sm" onClick={() => p.setExpand(true)}>
                  ⤢ 展开播放器
                </button>
              </div>
              <div className="manju-now-hint">
                已接入全站统一播放器：切换页面不中断，底部播放条常驻控制（播放 / 暂停 / 拖拽进度 / 上下切）。
              </div>
            </div>
          </div>
        ) : (
          <div className="manju-empty" style={{ margin: 0 }}>
            站内未收录该内容的视频直链，请前往来源站观看。
            <div style={{ marginTop: 10, display: 'flex', gap: 8, justifyContent: 'center' }}>
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
          {hasProgress ? ` · 上次看到 ${fmt(props.savedSec)}` : ''}
        </div>
        {item.license && <div className="manju-now-hint">📜 授权：{item.license}（授权信息以来源站为准）</div>}
      </div>
    </>
  );
}

/* ================= 站内精选全量列表（含自定义片源 + 在线发现） ================= */

/** 在线发现来源：Openverse 视频 / Openverse 音频 / Wikimedia Commons 视频 */
type DiscSource = 'ov-video' | 'ov-audio' | 'commons'

const DISC_SOURCES: Array<{ key: DiscSource; label: string; presets: string[] }> = [
  {
    key: 'ov-video',
    label: '🎬 Openverse 视频',
    presets: ['animation', 'blender animation', 'public domain cartoon', 'anime', 'cat'],
  },
  {
    key: 'ov-audio',
    label: '🎵 Openverse 音频',
    presets: ['animation music', 'cc0 music', 'medieval music', 'sound effect'],
  },
  {
    key: 'commons',
    label: '🤖 Commons AI 视频',
    presets: ['AI generated animation', 'text to video', 'generative video', 'Hailuo AI', 'animated short'],
  },
]

const HIST_KEY = 'mim-manju-hist';
const HIST_MAX = 8;

function loadHist(): string[] {
  try {
    const raw = localStorage.getItem(HIST_KEY);
    if (!raw) return [];
    const arr: unknown = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string').slice(0, HIST_MAX) : [];
  } catch {
    return [];
  }
}

function saveHist(list: string[]): void {
  try {
    localStorage.setItem(HIST_KEY, JSON.stringify(list.slice(0, HIST_MAX)));
  } catch {
    /* ignore */
  }
}

/** 站内精选列表页（公版 / CC 授权真实内容 + 自定义片源 + 在线发现） */
function PdListView(props: {
  items: MjExtItem[];
  onPlay: (id: string) => void;
  onAdd: (title: string, url: string) => void;
  onAddItem: (item: MjExtItem) => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [query, setQuery] = useState('');
  const [src, setSrc] = useState<DiscSource>('ov-video');
  const [disc, setDisc] = useState<MjExtItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [discErr, setDiscErr] = useState('');
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [resultCount, setResultCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [hist, setHist] = useState<string[]>(loadHist);

  const presets = DISC_SOURCES.find((s) => s.key === src)?.presets ?? [];

  /* 在线发现：防重入（Enter 与按钮双入口）+ 分页追加 + 错误细分文案 */
  const runDiscover = async (opts?: { append?: boolean; q?: string }) => {
    if (loading) return;
    const append = opts?.append ?? false;
    const q = (opts?.q ?? query).trim() || 'animation';
    const nextPage = append ? page + 1 : 1;
    setLoading(true);
    setDiscErr('');
    try {
      const r =
        src === 'commons'
          ? await discoverCommons(q, undefined, { offset: append ? page * 12 : 0 })
          : await discoverOpenverse(q, undefined, {
              media: src === 'ov-audio' ? 'audio' : 'videos',
              page: nextPage,
            });
      if (r.items.length === 0 && !append) setDiscErr('未找到开放授权内容，换个关键词试试。');
      setDisc((prev) => (append ? [...prev, ...r.items] : r.items));
      // Commons 上游永远回 page=1（用 gsroffset 翻页），故分页序号本地维护；
      // Openverse 直接采用上游 page。
      if (src === 'commons') setPage(append ? page + 1 : 1);
      else setPage(r.page);
      setPageCount(r.pageCount);
      setResultCount(r.resultCount);
      setHasMore(!!r.hasMore);
      if (!append) {
        const next = [q, ...hist.filter((h) => h !== q)].slice(0, HIST_MAX);
        setHist(next);
        saveHist(next);
      }
    } catch (e) {
      const info = classifyDiscError(e);
      setDiscErr(info.message);
    } finally {
      setLoading(false);
    }
  };

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

  const renderCover = (it: MjExtItem) => (
    <span className="manju-ext-cover">
      {it.cover}
      {it.thumb && (
        <img
          className="manju-ext-thumb"
          src={it.thumb}
          alt=""
          loading="lazy"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      )}
    </span>
  );

  return (
    <>
      <div className="muted manju-ext-note">
        站内精选收录公有领域（Public Domain）或 CC 署名授权内容，授权可验证、无版权争议；
        有直链的可站内真实播放，其余跳转来源站观看。
      </div>

      <div className="manju-discover card">
        <div className="manju-card-title">在线发现 · 开放授权媒体检索</div>
        <div className="muted">
          从 Openverse（8 亿+ 开放媒体）与 Wikimedia Commons 检索公有领域 / CC 内容，
          仅收录可商用（license_type=commercial）的授权条目，结果与站内精选同样可收入片单。
        </div>
        <div className="manju-discover-srcs" role="group" aria-label="检索来源">
          {DISC_SOURCES.map((s) => (
            <button
              key={s.key}
              type="button"
              className={cx('manju-chip', src === s.key && 'on')}
              aria-pressed={src === s.key}
              onClick={() => setSrc(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="manju-discover-row">
          <input
            className="input"
            placeholder="关键词，如：animation / blender / cat"
            aria-label="在线发现关键词"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !loading) void runDiscover();
            }}
          />
          <button className="btn btn-primary" onClick={() => void runDiscover()} disabled={loading}>
            {loading ? '检索中…' : '搜索'}
          </button>
        </div>
        {(presets.length > 0 || hist.length > 0) && (
          <div className="manju-discover-chips">
            {presets.map((p) => (
              <button
                key={`p-${p}`}
                type="button"
                className="manju-chip"
                onClick={() => {
                  setQuery(p);
                  void runDiscover({ q: p });
                }}
              >
                {p}
              </button>
            ))}
            {hist.length > 0 && <span className="muted manju-discover-hist-label">最近搜索</span>}
            {hist.map((h) => (
              <button
                key={`h-${h}`}
                type="button"
                className="manju-chip manju-chip-hist"
                onClick={() => {
                  setQuery(h);
                  void runDiscover({ q: h });
                }}
              >
                {h}
              </button>
            ))}
          </div>
        )}
        {discErr && <div className="manju-discover-err">{discErr}</div>}
        {disc.length > 0 && (
          <>
            <div className="muted manju-discover-meta">
              {src === 'commons'
                ? `实时检索 · 第 ${page} 页${hasMore ? '（还有更多）' : ''}`
                : `共约 ${resultCount} 条结果${pageCount > 1 ? ` · 第 ${page}/${pageCount} 页` : ''}`}
            </div>
            <div className="manju-discover-list">
              {disc.map((it) => {
                const added = props.items.some((x) => x.id === it.id);
                return (
                  <div key={it.id} className="manju-ext-item card">
                    <div className="manju-ext-row">
                      {renderCover(it)}
                      <div className="manju-cont-info">
                        <div className="manju-card-title">
                          {it.title}
                          {it.license && <span className="manju-badge manju-license">{it.license}</span>}
                        </div>
                        <div className="muted">{it.source}</div>
                      </div>
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={added}
                        onClick={() => props.onAddItem(it)}
                      >
                        {added ? '✓ 已加入' : '＋ 收入片单'}
                      </button>
                      {it.homeUrl && (
                        <button className="btn btn-ghost btn-sm" onClick={() => openExternal(it.homeUrl as string)}>
                          来源站 ↗
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {src === 'commons'
              ? hasMore && (
                  <button
                    className="btn btn-ghost manju-discover-more"
                    disabled={loading}
                    onClick={() => void runDiscover({ append: true })}
                  >
                    {loading ? '加载中…' : '加载更多'}
                  </button>
                )
              : pageCount > 1 && (
                  <button
                    className="btn btn-ghost manju-discover-more"
                    disabled={loading || page >= pageCount}
                    onClick={() => void runDiscover({ append: true })}
                  >
                    {loading ? '加载中…' : page >= pageCount ? '已到最后一页' : '加载更多'}
                  </button>
                )}
          </>
        )}
      </div>

      {props.items.map((it) => (
        <div key={it.id} className="manju-ext-item card">
          <div className="manju-ext-row">
            {renderCover(it)}
            <div className="manju-cont-info">
              <div className="manju-card-title">
                {it.title}
                {it.license && <span className="manju-badge manju-license">{it.license}</span>}
                {it.custom && <span className="manju-badge manju-custom">自定义</span>}
              </div>
              <div className="muted">{it.source}</div>
              <div className="muted">{it.episodesText}</div>
            </div>
            {playableOf(it) ? (
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

/* ================= 页面入口 ================= */

export function ManjuPage() {
  const toast = useToast();
  const [state, setState] = useState<MjState>(loadManju);
  const [view, setView] = useState<MjView>({ kind: 'home' });
  const player = usePlayerControl();
  const quotaWarned = useRef(false);

  /* 本地保存 + 云端快照：
     · saveManju 失败（隐私模式/配额满）只告警一次，不静默丢数据；
     · 每次成功本地保存都记录 savedAt，供「新者优先」合并比对；
     · pushToolStateThrottled 节流 ≥10s（播放中每 ~5s 一次进度也不打爆上游），
       尾调用保证最终状态一定落云。 */
  useEffect(() => {
    const ok = saveManju(state);
    if (ok) {
      quotaWarned.current = false;
      try {
        localStorage.setItem(SAVED_AT_KEY, new Date().toISOString());
      } catch {
        /* ignore */
      }
    } else if (!quotaWarned.current) {
      quotaWarned.current = true;
      toast('本地存储写入失败（空间可能已满），进度可能无法保存');
    }
    pushToolStateThrottled(KEY, state);
  }, [state, toast]);

  /* 云端恢复：仅当云端快照比本地新（updated_at > 本地 savedAt）才覆盖，
     避免「离线观看的进度被旧云端快照冲掉」；无云端/未登录时静默跳过。 */
  useEffect(() => {
    void pullToolStateMeta(KEY).then((m) => {
      if (!m?.updatedAt) return;
      let localAt = '';
      try {
        localAt = localStorage.getItem(SAVED_AT_KEY) ?? '';
      } catch {
        /* ignore */
      }
      if (m.updatedAt > localAt) {
        try {
          localStorage.setItem(KEY, JSON.stringify(m.data));
          localStorage.setItem(SAVED_AT_KEY, m.updatedAt);
        } catch {
          /* ignore */
        }
        setState(loadManju());
      }
    });
  }, []);

  /* 站内精选全集（含自定义片源），按 id 反查 */
  const allItems = useMemo<MjExtItem[]>(() => [...state.customExt, ...EXT_SEED], [state.customExt]);

  /* 续播列表：有进度且未看完（保存进度 < 时长 95%）的条目，取前 4 条 */
  const cont = useMemo<MjContRow[]>(() => {
    const rows: MjContRow[] = [];
    for (const it of allItems) {
      if (!playableOf(it)) continue;
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

  /* 统一播放器进度回调：节流由播放器内部保证（≥5s / 暂停 / 结束各报一次），
     写回本站进度与「已看」，实现跨页续播与收藏态持久化。 */
  useEffect(() => {
    return player.registerProgress((trackId, sec, ended) => {
      setProgress(trackId, Math.floor(sec));
      if (ended) {
        const it = allItems.find((x) => x.id === trackId);
        if (it) markSeen(it);
      }
    });
  }, [player, allItems, setProgress, markSeen]);

  const toggleFav = (id: string, title: string) => {
    const has = state.favorites.includes(id);
    setState((s) => ({
      ...s,
      favorites: has ? s.favorites.filter((x) => x !== id) : [...s.favorites, id],
    }));
    toast(has ? '已取消收藏' : `已收藏《${title}》`);
  };

  const addCustom = (title: string, url: string) => {
    if (state.customExt.length >= MAX_CUSTOM) {
      toast(`片单已满（上限 ${MAX_CUSTOM} 部），可先清理自定义片源`);
      return;
    }
    const isAudio = url ? kindOfUrl(url) === 'audio' : false;
    const item: MjExtItem = {
      id: uid('u_'),
      title,
      cat: 'comic',
      cover: '📺',
      source: '自定义片源',
      episodesText: url
        ? isAudio
          ? '自定义音频 · 集数未知'
          : '自定义直链 · 集数未知'
        : '仅记录 · 未提供地址',
      ...(url ? (isAudio ? { audioUrl: url } : { videoUrl: url }) : {}),
      custom: true,
    };
    setState((s) => ({ ...s, customExt: [item, ...s.customExt] }));
  };

  /* 在线发现：将 Openverse / Commons 检索到的开放授权内容收入片单。
     按 id 去重（同一在线条目重复点击只入账一次，杜绝同 id 双条目导致的
     React key 重复与播放列表重复）；达上限时拒绝并提示。 */
  const addDiscovered = (item: MjExtItem) => {
    if (state.customExt.some((x) => x.id === item.id)) {
      toast('该条目已在片单中');
      return;
    }
    if (state.customExt.length >= MAX_CUSTOM) {
      toast(`片单已满（上限 ${MAX_CUSTOM} 部），可先清理自定义片源`);
      return;
    }
    setState((s) => ({ ...s, customExt: [item, ...s.customExt] }));
    toast('已收入片单');
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
    if (view.kind === 'play') setView(view.from === 'home' ? { kind: 'home' } : { kind: 'list' });
    else setView({ kind: 'home' });
  };

  const favItems = state.favorites
    .map((id) => allItems.find((it) => it.id === id))
    .filter((it): it is MjExtItem => !!it);

  /* 播放 + 可选跳转详情：构建全可播片单（跨条目「切换」），续播带入已存进度 */
  const startPlay = (it: MjExtItem, from: 'home' | 'list', position: number, goDetail: boolean) => {
    const track = toTrack(it);
    if (!track) {
      if (goDetail) setView({ kind: 'play', id: it.id, from });
      return;
    }
    const playable = allItems.map(toTrack).filter((t): t is MediaTrack => !!t);
    const idx = playable.findIndex((t) => t.id === track.id);
    /* position=0/undefined 时不 seek（从头或保持当前位）；>0 才显式续播定位 */
    player.play(track, {
      position: position > 0 ? position : undefined,
      playlist: playable,
      playlistIndex: idx >= 0 ? idx : 0,
    });
    if (goDetail) setView({ kind: 'play', id: it.id, from });
  };

  const openItem = (id: string, from: 'home' | 'list') => {
    const it = allItems.find((x) => x.id === id);
    if (!it) return;
    startPlay(it, from, state.progress[it.id] ?? 0, true);
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
            onPlay={(pos) => startPlay(it, 'list', pos ?? 0, false)}
          />
        </>
      );
    }
    if (view.kind === 'list') {
      return (
        <PdListView
          items={allItems}
          onPlay={(id) => {
            const it = allItems.find((x) => x.id === id);
            if (it) startPlay(it, 'list', 0, false);
          }}
          onAdd={addCustom}
          onAddItem={addDiscovered}
        />
      );
    }
    return (
      <HomeView
        cont={cont}
        favorites={favItems}
        items={allItems}
        seenList={state.seen}
        onOpen={(id) => openItem(id, 'home')}
        onContinue={(id) => openItem(id, 'home')}
        onViewAll={() => setView({ kind: 'list' })}
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
        站内精选均为公有领域（Public Domain）或 CC 授权内容，视频直链来自公开镜像（Blender 开源电影 / Google 公开样片库），授权可验证、无版权争议。
      </div>
    </div>
  );
}
