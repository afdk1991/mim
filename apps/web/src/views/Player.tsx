/**
 * 独立播放器页：/watch/:kind/:id
 *
 * 支持两类内容：
 * - thread：社区付费帖 / 剧集（api.community.thread），剧集选集 + 帖内视频
 * - asset：付费视频资产（api.commerce.asset），媒体视频
 *
 * 能力：选集列表、上一集 / 下一集、localStorage 进度记忆；未解锁时展示解锁引导，不渲染播放器。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Locale } from '@mim/i18n';
import { api, errorText, resolvePublicUrl } from '../api';
import type { CommunityEpisode, CommunityThreadMedia, PaidAssetDetail } from '../api';
import { navigatePath, pathOf, pathSegments } from '../router';
import {
  clampIndex,
  nextIndex,
  prevIndex,
  readProgress,
  writeProgress,
  clearProgress,
} from '../lib/player';
import { startCheckout } from '../lib/checkout';
import { tr } from '../lib/messages';

interface Props {
  locale: Locale;
}

/** 归一化后的单集条目 */
interface EpisodeItem {
  id: string;
  title: string;
  src: string;
  poster: string | null;
}

type WatchKind = 'thread' | 'asset' | 'product';

/** 解析路径 /watch/:kind/:id */
function parseWatchRoute(): { kind: WatchKind; id: string } {
  const segs = pathSegments();
  const kind = (segs[1] ?? '') as WatchKind;
  const id = decodeURIComponent(segs[2] ?? '');
  return { kind, id };
}

/** 帖内视频媒体 → 剧集条目 */
function mediaToEpisodes(media: CommunityThreadMedia[] | undefined): EpisodeItem[] {
  return (media ?? [])
    .filter((item) => item.kind === 'video')
    .map((item, index) => ({
      id: item.id ?? `media-${index}`,
      title: `Video ${index + 1}`,
      src: resolvePublicUrl(item.url),
      poster: item.poster_url ? resolvePublicUrl(item.poster_url) : null,
    }));
}

/** 剧集目录 → 剧集条目 */
function episodesToItems(episodes: CommunityEpisode[] | undefined): EpisodeItem[] {
  return (episodes ?? []).map((ep) => ({
    id: ep.id,
    title: ep.title,
    src: resolvePublicUrl(ep.media_url),
    poster: ep.poster_url ? resolvePublicUrl(ep.poster_url) : null,
  }));
}

export function Player({ locale }: Props) {
  const { kind, id } = parseWatchRoute();
  const [title, setTitle] = useState('');
  const [episodes, setEpisodes] = useState<EpisodeItem[]>([]);
  const [unlocked, setUnlocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastSavedRef = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (kind === 'thread') {
        const data = await api.community.thread(id);
        setTitle(data.thread.title);
        setUnlocked(data.unlocked);
        const items = episodesToItems(data.thread.episodes);
        setEpisodes(items.length > 0 ? items : mediaToEpisodes(data.thread.media));
      } else if (kind === 'asset') {
        const data = await api.commerce.asset(id);
        const asset: PaidAssetDetail = data.asset;
        setTitle(asset.title);
        setUnlocked(asset.unlocked);
        setEpisodes(
          (asset.media ?? [])
            .filter((item) => item.kind === 'video')
            .map((item, index) => ({
              id: `${asset.code}-${index}`,
              title: `Video ${index + 1}`,
              src: resolvePublicUrl(item.url),
              poster: item.poster_url ? resolvePublicUrl(item.poster_url) : null,
            })),
        );
      } else {
        throw new Error('unsupported watch kind');
      }
      setActiveIndex(0);
    } catch (err) {
      setError(errorText(locale, err));
    } finally {
      setLoading(false);
    }
  }, [kind, id, locale]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = episodes[clampIndex(activeIndex, episodes.length)] ?? null;

  // 切换剧集：恢复上次进度
  useEffect(() => {
    if (!active) return;
    lastSavedRef.current = 0;
    const video = videoRef.current;
    if (video) {
      const saved = readProgress(active.id);
      video.currentTime = saved;
    }
  }, [active?.id]);

  function onTimeUpdate() {
    const video = videoRef.current;
    if (!video || !active) return;
    if (video.currentTime - lastSavedRef.current >= 5) {
      lastSavedRef.current = video.currentTime;
      writeProgress(active.id, video.currentTime);
    }
  }

  function onEnded() {
    if (active) clearProgress(active.id);
    if (activeIndex < episodes.length - 1) setActiveIndex(nextIndex(activeIndex, episodes.length));
  }

  function gotoIndex(next: number) {
    setActiveIndex(clampIndex(next, episodes.length));
  }

  async function unlockThread() {
    try {
      await api.community.unlock(id);
      await load();
    } catch (err) {
      setError(errorText(locale, err));
    }
  }

  async function buyAssetBalance() {
    try {
      await api.commerce.purchaseAsset(id);
      await load();
    } catch (err) {
      setError(errorText(locale, err));
    }
  }

  return (
    <div className="page player-page">
      <header className="page-head">
        <div>
          <h1>{title || tr(locale, 'web.player.episode')}</h1>
          <span className="hint">{kind === 'thread' ? 'thread' : 'asset'} · {id}</span>
        </div>
        <button type="button" className="btn ghost" onClick={() => navigatePath(pathOf('community'))}>
          {tr(locale, 'web.checkout.back')}
        </button>
      </header>

      {loading ? <div className="hint">{tr(locale, 'web.player.loading')}</div> : null}
      {error ? (
        <section className="panel danger">
          <p className="error">{error}</p>
          <button type="button" className="btn ghost" onClick={() => void load()}>
            {tr(locale, 'web.common.retry')}
          </button>
        </section>
      ) : null}

      {!loading && !error && !unlocked && (
        <section className="panel paywall">
          <strong>{tr(locale, 'web.player.lockedTitle')}</strong>
          <p className="hint">{tr(locale, 'web.player.lockedDesc')}</p>
          <div className="deploy-columns">
            {kind === 'thread' && (
              <button type="button" className="btn primary" onClick={() => void unlockThread()}>
                {tr(locale, 'web.player.unlock')}
              </button>
            )}
            {kind === 'asset' && (
              <>
                <button type="button" className="btn primary" onClick={() => void buyAssetBalance()}>
                  {tr(locale, 'web.player.unlock')}
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => void startCheckout({ purpose: 'asset', refId: id, provider: 'alipay' })}
                >
                  {tr(locale, 'web.common.onlinePay')}
                </button>
              </>
            )}
          </div>
        </section>
      )}

      {!loading && !error && unlocked && episodes.length === 0 && (
        <div className="hint">{tr(locale, 'web.player.empty')}</div>
      )}

      {!loading && !error && unlocked && active && (
        <div className="player-layout">
          <div className="player-main">
            <video
              ref={videoRef}
              className="player-video"
              src={active.src}
              poster={active.poster ?? undefined}
              controls
              playsInline
              preload="metadata"
              onTimeUpdate={onTimeUpdate}
              onEnded={onEnded}
            />
            <div className="player-nav">
              <button type="button" className="btn ghost small" disabled={activeIndex === 0} onClick={() => gotoIndex(prevIndex(activeIndex))}>
                ← {tr(locale, 'web.player.prev')}
              </button>
              <span className="hint">{activeIndex + 1} / {episodes.length}</span>
              <button
                type="button"
                className="btn ghost small"
                disabled={activeIndex === episodes.length - 1}
                onClick={() => gotoIndex(nextIndex(activeIndex, episodes.length))}
              >
                {tr(locale, 'web.player.next')} →
              </button>
            </div>
          </div>
          <aside className="player-list">
            <h3>{tr(locale, 'web.player.episode')}</h3>
            <ul>
              {episodes.map((ep, index) => (
                <li key={ep.id}>
                  <button
                    type="button"
                    className={index === activeIndex ? 'is-active' : ''}
                    onClick={() => gotoIndex(index)}
                  >
                    <span className="hint">{index + 1}.</span> {ep.title}
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      )}
    </div>
  );
}
