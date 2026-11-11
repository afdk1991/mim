/**
 * ComicStudio：漫剧 / AI 剧模块外壳 —— 把「放映厅」与「创作工作台」并列成两个分段。
 *
 * 放映厅匿名可看（真正能播放视频），创作工作台需要登录后使用；
 * 这样既满足「打开模块就能看片」，也让收费创作能力仍按需登录。
 */

import { useState } from 'react'; // 分段状态
import type { Locale } from '@mim/i18n'; // 语言类型
import { ComicTheater } from './ComicTheater'; // 放映厅
import { ComicWorkbench } from './ComicWorkbench'; // 创作工作台

interface Props {
  locale: Locale; // 当前语言
  hasSession: boolean; // 是否已登录
  onSignIn: () => void; // 匿名引导登录
} // Props 结束

/** 渲染漫剧模块外壳 */
export function ComicStudio({ locale, hasSession, onSignIn }: Props) {
  const isZh = locale !== 'en-US'; // 中文判断
  const [tab, setTab] = useState<'theater' | 'workbench'>('theater'); // 默认进放映厅，打开模块即可看片

  return (
    <div className="comic-studio">
      {/* 分段切换：放映厅 / 创作工作台 */}
      <div className="segment comic-segment" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'theater'}
          className={`segment-item${tab === 'theater' ? ' active' : ''}`}
          onClick={() => setTab('theater')}
        >
          {isZh ? '放映厅' : 'Theater'}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'workbench'}
          className={`segment-item${tab === 'workbench' ? ' active' : ''}`}
          onClick={() => setTab('workbench')}
        >
          {isZh ? '创作工作台' : 'Workbench'}
        </button>
      </div>

      {/* 放映厅：匿名与登录都可用 */}
      {tab === 'theater' && (
        <ComicTheater
          locale={locale}
          hasSession={hasSession}
          onSignIn={onSignIn}
          onOpenWorkbench={() => setTab('workbench')}
        />
      )}

      {/* 创作工作台：登录后渲染；匿名时给出说明与登录入口 */}
      {tab === 'workbench' && hasSession && <ComicWorkbench locale={locale} />}
      {tab === 'workbench' && !hasSession && (
        <div className="page">
          <div className="card theater-login">
            <h2>{isZh ? '创作工作台需要登录' : 'Sign in to use the workbench'}</h2>
            <p className="muted">
              {isZh
                ? '放映厅无需登录即可看片；剧本、分镜、角色与一键成片属于你的私有创作数据，登录后才能使用。'
                : 'The theater is open to everyone. Scripts, storyboards, characters and film generation are private, so sign in to use them.'}
            </p>
            <button type="button" className="btn primary" onClick={onSignIn}>
              {isZh ? '去登录 / 注册' : 'Sign in / Sign up'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
} // ComicStudio 结束
