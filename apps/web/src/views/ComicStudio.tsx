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

interface Props { // 接口 Props：约束对象的字段与类型形态
  locale: Locale; // 当前语言
  hasSession: boolean; // 是否已登录
  onSignIn: () => void; // 匿名引导登录
} // Props 结束

/** 渲染漫剧模块外壳 */
export function ComicStudio({ locale, hasSession, onSignIn }: Props) {
  const isZh = locale !== 'en-US'; // 中文判断
  const [tab, setTab] = useState<'theater' | 'workbench'>('theater'); // 默认进放映厅，打开模块即可看片

  return ( // 返回当前函数的处理结果
    <div className="comic-studio">{/* 执行当前业务步骤 */}
      {/* 分段切换：放映厅 / 创作工作台 */}
      <div className="segment comic-segment" role="tablist">{/* 执行当前业务步骤 */}
        <button
          type="button" // 赋值：更新变量 type 的取值
          role="tab"
          aria-selected={tab === 'theater'}
          className={`segment-item${tab === 'theater' ? ' active' : ''}`}
          onClick={() => setTab('theater')}
        >
          {isZh ? '放映厅' : 'Theater'}
        </button>
        <button
          type="button" // 赋值：更新变量 type 的取值
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

      {/* 创作工作台：免登录体验下访客会话建立后直接渲染；仅在会话建立失败时给出重试入口 */}
      {tab === 'workbench' && hasSession && <ComicWorkbench locale={locale} />}
      {tab === 'workbench' && !hasSession && (
        <div className="page">{/* 执行当前业务步骤 */}
          <div className="card theater-login">{/* 执行当前业务步骤 */}
            <h2>{isZh ? '正在建立免登录会话' : 'Setting up your anonymous session'}</h2>
            <p className="muted">{/* 执行当前业务步骤 */}
              {isZh
                ? '工作台无需登录即可使用；当前只是会话尚未就绪（离线或服务端限流），重试即可恢复。'
                : 'The workbench needs no sign-in. Your anonymous session is not ready yet (offline or rate-limited) — retry to continue.'}
            </p>
            <button type="button" className="btn primary" onClick={onSignIn}>{/* 执行当前业务步骤 */}
              {isZh ? '重试 / 登录' : 'Retry / Sign in'}
            </button>
          </div>
        </div>
      )}
    </div>
  ); // 执行当前业务步骤
} // ComicStudio 结束
