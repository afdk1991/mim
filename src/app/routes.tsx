/* ==========================================================================
 * 路由表 —— 全站 57 条可达路由的唯一真源
 * （`case` 行 45 行、去重路径根 40 条，三种口径见 docs/rebuild/路由清单.md）
 *
 * 页面组件按域从桶文件导入（pages/<域>/index.ts），路由表不再散落 import。
 * 新增页面必须同时改这里与对应域的桶文件，否则会拿到 undefined 组件。
 *
 * 守卫说明：全站无路由级登录守卫，仅 #/admin/* 走 AdminGate；
 * 其余页面靠数据层按身份分 key 隔离，游客可访问。
 * ======================================================================== */

import type { ReactNode } from 'react'
import { segmentsOf } from './router'
import { BIZ_META, bizOfRoute } from '../domain/commerce/biz/registry'
import { MALL_CHANNEL_META } from '../domain/commerce/model'
import type { MallChannel } from '../domain/commerce/model'
import { Empty } from '../ui'

import {
  ArticleDetailPage,
  ArticleEditorPage,
  ArticlesPage,
  BlogHomePage,
  FeedPage,
  LivePage,
  PostDetailPage,
  PublishPage,
  RanksPage,
  ResourcesPage,
  SearchPage,
  SnippetsPage,
  TagsPage,
  TopicPage,
  TopicRankPage,
  VideosPage,
} from '../pages/content'

import {
  FavoritesPage,
  FollowingPage,
  HistoryPage,
  MessagesPage,
  MyProfilePage,
  NotificationsPage,
  ProfilePage,
} from '../pages/social'

import {
  MallCartPage,
  MallGoodsPage,
  MallHomePage,
  MallLivePage,
  MallLocalPage,
  MallOrdersPage,
  MallSeckillPage,
  MallTravelPage,
  MallWalletPage,
} from '../pages/commerce'

import {
  AiResPage,
  ArdotPage,
  BomToolPage,
  CozePanelPage,
  DeliveryBoardPage,
  EmailHubPage,
  ManjuPage,
  PriceMonitorPage,
  RouteNavPage,
} from '../pages/tools'

import {
  AdminAuditPage,
  AdminDevicesPage,
  AdminHomePage,
  AdminProductsPage,
  AdminRechargePage,
  AdminRolesPage,
  AdminVerifyPage,
  GrowthPage,
  InfoPage,
  LoginPage,
  SettingsPage,
  VipCenterPage,
  WalletPage,
} from '../pages/system'

const isChannel = (v: string | undefined): v is MallChannel => !!v && v in MALL_CHANNEL_META

/** 路由解析：返回该路径对应的页面节点 */
export function resolveRoute(path: string, query: URLSearchParams): ReactNode {
  const segs = segmentsOf(path)
  const [root, param] = segs

  switch (root) {
    case undefined:
    case 'feed':
      return <FeedPage />

    /* ---------- 内容社区域 ---------- */
    case 'post':
      return param ? <PostDetailPage id={param} /> : <Empty emoji="🔍" text="缺少动态 id" />
    case 'topic':
      return param ? <TopicPage name={decodeURIComponent(param)} /> : <Empty emoji="💬" text="缺少话题名" />
    case 'topics':
      return <TopicRankPage />
    case 'videos':
      return <VideosPage />
    case 'ranks':
      return <RanksPage />
    case 'articles':
      return <ArticlesPage />
    case 'article':
      return param ? <ArticleDetailPage id={param} /> : <Empty emoji="📄" text="缺少文章 id" />
    case 'write':
      return <ArticleEditorPage draftId={param} editId={query.get('edit') ?? undefined} />
    case 'blog':
      return <BlogHomePage />
    case 'snippets':
      return <SnippetsPage />
    case 'resources':
      return <ResourcesPage />
    case 'search':
      return <SearchPage q={query.get('q') ?? ''} />
    case 'tags':
      return <TagsPage />
    case 'publish':
      return <PublishPage />
    case 'live':
      return <LivePage />

    /* ---------- 社交域 ---------- */
    case 'notifications':
      return <NotificationsPage />
    case 'messages':
      return <MessagesPage />
    case 'favorites':
      return <FavoritesPage />
    case 'history':
      return <HistoryPage />
    case 'my':
      return <MyProfilePage />
    case 'following':
      return <FollowingPage />
    case 'user':
      return param ? <ProfilePage id={param} /> : <Empty emoji="👻" text="缺少用户 id" />

    /* ---------- 商城域 ---------- */
    case 'mall': {
      // 业务会场（#/mall/biz/<kind>）优先：与商品频道前缀隔离，避免 #/mall/live 撞车
      if (param === 'biz') {
        const biz = bizOfRoute(segs[2])
        if (!biz) return <Empty emoji="🧭" text="未知的业务会场" />
        switch (biz.kind) {
          case BIZ_META.seckill.kind:
            return <MallSeckillPage />
          case BIZ_META.local.kind:
            return <MallLocalPage />
          case BIZ_META.live.kind:
            return <MallLivePage />
          case BIZ_META.travel.kind:
            return <MallTravelPage />
        }
        return <Empty emoji="🧭" text="未知的业务会场" />
      }
      if (param === 'goods') return <MallGoodsPage id={segs[2] ?? ''} />
      if (param === 'cart') return <MallCartPage />
      if (param === 'orders') return <MallOrdersPage />
      if (param === 'wallet') return <MallWalletPage />
      if (isChannel(param)) return <MallHomePage initial={param} />
      return <MallHomePage />
    }

    /* ---------- 个人账户与权益 ---------- */
    case 'vip':
      return <VipCenterPage />
    case 'growth':
      return <GrowthPage />
    case 'wallet':
      return <WalletPage />

    /* ---------- 系统 ---------- */
    case 'login':
      return <LoginPage />
    case 'info':
      return param ? <InfoPage slug={param} /> : <Empty emoji="📄" text="请从页脚选择要查看的信息" />
    case 'settings':
      return <SettingsPage />

    /* ---------- 工具台 ---------- */
    case 'delivery':
      return <DeliveryBoardPage />
    case 'price':
      return <PriceMonitorPage />
    case 'nav':
      return <RouteNavPage />
    case 'mail':
      return <EmailHubPage />
    case 'bom':
      return <BomToolPage />
    case 'coze':
      return <CozePanelPage />
    case 'ai':
      return <AiResPage />
    case 'manju':
      return <ManjuPage />
    case 'ardot':
      return <ArdotPage />

    /* ---------- 管理后台（页面内做 AdminGate） ---------- */
    case 'admin':
      if (param === 'audit') return <AdminAuditPage />
      if (param === 'roles') return <AdminRolesPage />
      if (param === 'products') return <AdminProductsPage />
      if (param === 'recharge') return <AdminRechargePage />
      if (param === 'verify') return <AdminVerifyPage />
      if (param === 'devices') return <AdminDevicesPage />
      return <AdminHomePage />

    default:
      return <Empty emoji="🧭" text="页面不存在，检查一下地址吧" />
  }
}
