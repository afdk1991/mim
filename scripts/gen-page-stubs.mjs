/* 一次性脚手架：按路由表生成页面占位文件与域桶文件。
   真实实现由后续分批填充；占位阶段保证 typecheck / build 可通过。 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(process.cwd(), 'src/pages')

const PAGES = {
  content: [
    ['FeedPage', '首页广场', []],
    ['PostDetailPage', '动态详情', ['id: string']],
    ['TopicPage', '话题页', ['name: string']],
    ['TopicRankPage', '超话排行', []],
    ['VideosPage', '视频沉浸流', []],
    ['RanksPage', '榜单体系', []],
    ['ArticlesPage', '文章列表', []],
    ['ArticleDetailPage', '文章详情', ['id: string']],
    ['ArticleEditorPage', '文章编辑器', ['draftId?: string', 'editId?: string']],
    ['BlogHomePage', '我的博客', []],
    ['SnippetsPage', '代码片段', []],
    ['ResourcesPage', '资源下载', []],
    ['SearchPage', '搜索结果', ['q: string']],
    ['TagsPage', '标签页', []],
    ['PublishPage', '统一发布器', []],
    ['LivePage', '直播开播台', []],
  ],
  social: [
    ['NotificationsPage', '通知', []],
    ['MessagesPage', '私信', []],
    ['FavoritesPage', '收藏', []],
    ['HistoryPage', '浏览足迹', []],
    ['MyProfilePage', '我的主页', []],
    ['FollowingPage', '关注列表', []],
    ['ProfilePage', '用户主页', ['id: string']],
  ],
  commerce: [
    ['MallHomePage', '商城中心', ['initial?: MallChannel']],
    ['MallGoodsPage', '商品详情', ['id: string']],
    ['MallCartPage', '购物车', []],
    ['MallOrdersPage', '订单中心', []],
    ['MallWalletPage', '商城钱包', []],
    ['MallSeckillPage', '秒杀会场', []],
    ['MallLocalPage', '本地生活会会场', []],
    ['MallLivePage', '直播会场', []],
    ['MallTravelPage', '出行会场', []],
  ],
  tools: [
    ['BomToolPage', 'BOM 工具台', []],
    ['CozePanelPage', '智能体面板', []],
    ['AiResPage', 'AI 资源库', []],
    ['ManjuPage', '漫剧', []],
    ['ArdotPage', '聚合监控台', []],
    ['EmailHubPage', '邮箱聚合', []],
    ['RouteNavPage', '路线导航', []],
    ['DeliveryBoardPage', '配送调度台', []],
    ['PriceMonitorPage', '价格监控', []],
  ],
  system: [
    ['LoginPage', '登录注册', []],
    ['InfoPage', '站点信息', ['slug: string']],
    ['SettingsPage', '设置', []],
    ['VipCenterPage', 'VIP 会员中心', []],
    ['GrowthPage', '成长引擎', []],
    ['WalletPage', '统一钱包', []],
    ['AdminHomePage', '管理后台', []],
    ['AdminAuditPage', '审计日志', []],
    ['AdminRolesPage', '角色管理', []],
  ],
}

const EXTRA_IMPORT = {
  commerce: "import type { MallChannel } from '@/domain/commerce/model'\n",
}

for (const [domain, list] of Object.entries(PAGES)) {
  const dir = path.join(ROOT, domain)
  fs.mkdirSync(dir, { recursive: true })
  const names = []
  for (const [name, label, props] of list) {
    const file = path.join(dir, `${name}.tsx`)
    if (fs.existsSync(file)) {
      names.push(name)
      continue
    }
    const propList = props.map((p) => p.replace(/:.*/, '').replace('?', ''))
    const iface = props.length
      ? `\nexport interface ${name}Props {\n${props.map((p) => `  ${p}`).join('\n')}\n}\n`
      : ''
    const signature = props.length ? `{ ${propList.join(', ')} }: ${name}Props` : ''
    const body =
      propList.length > 0
        ? `<Empty emoji="🚧" text={\`${label} 待实现：\${[${propList
            .map((p) => (p.endsWith('?') ? p.slice(0, -1) : p))
            .join(', ')}].filter(Boolean).join(' / ')}\`} />`
        : `<Empty emoji="🚧" text="${label} 待实现" />`
    const src = `/* ${label} —— 重建占位，等待实现 */
import { Empty } from '@/ui'
${domain === 'commerce' && name === 'MallHomePage' ? EXTRA_IMPORT.commerce : ''}${iface}
export function ${name}(${signature}) {
  return (
    <div className="page">
      ${body}
    </div>
  )
}
`
    fs.writeFileSync(file, src, 'utf8')
    names.push(name)
  }
  const barrel = names.map((n) => `export { ${n} } from './${n}'`).join('\n') + '\n'
  fs.writeFileSync(path.join(dir, 'index.ts'), barrel, 'utf8')
}

console.log('generated pages:', Object.values(PAGES).flat().length)
