#!/usr/bin/env node
/**
 * scripts/build-site-domains.mjs
 *
 * 用途：把 `site/domains/domains.data.json` 渲染成 13 个领域静态详情页 + 1 个领域索引页 + sitemap/robots。
 *
 * 为什么是「构建期生成静态页」：
 *   1. 用户明确要求核心内容静态化以加速访问并利于 SEO——静态 HTML 无运行时数据依赖，首屏直出；
 *   2. 内容更新频率低，改内容只改数据文件后重跑本脚本，不需要起服务、不需要查库；
 *   3. 与 `site/index.html`（同样手写静态、逐行注释）保持同一套设计令牌与写法，视觉与代码风格一致。
 *
 * 用法：
 *   node scripts/build-site-domains.mjs                 # 用默认基准地址生成
 *   SITE_BASE_URL=https://example.com node ...          # 覆盖 canonical / sitemap 的绝对地址前缀
 *
 * 输出（全部落在 site/domains/，可整体作为静态目录发布）：
 *   site/domains/index.html        领域索引（按 5 个分组）
 *   site/domains/<slug>.html       13 个领域详情页
 *   site/sitemap.xml               站点地图（含索引与 13 详情）
 *   site/robots.txt                爬虫声明与 sitemap 指向
 *
 * 约束：
 *   - 零第三方依赖，只用 Node 内置模块；
 *   - 不读取、不修改工作区其他文件，尤其不碰并行开发线在改的 `site/index.html`；
 *   - 生成的 HTML 每块带中文注释，满足仓库铁律十一的注释覆盖率要求。
 */

// 文件系统原语：读取数据、写文件、建目录
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
// 路径工具：按当前脚本位置推导仓库根，保证在任意工作目录执行都正确
import { dirname, join } from 'node:path';
// ESM 下取当前文件路径（替代 __filename）
import { fileURLToPath } from 'node:url';

// 当前脚本所在目录（scripts/）
const __dirname = dirname(fileURLToPath(import.meta.url));
// 仓库根目录（scripts 的上一级）
const ROOT = join(__dirname, '..');
// 数据源路径：13 领域的唯一内容出处
const DATA_FILE = join(ROOT, 'site', 'domains', 'domains.data.json');
// 领域页输出目录
const OUT_DIR = join(ROOT, 'site', 'domains');
// 站点根输出目录（sitemap / robots 放这里）
const SITE_DIR = join(ROOT, 'site');
// 绝对地址前缀：canonical 与 sitemap 需要绝对 URL，缺省用生产前端域名
const BASE_URL = (process.env.SITE_BASE_URL ?? 'https://zy.laal.top').replace(/\/+$/, '');
// 站点图标：与 site/index.html 同款内联 SVG，不产生图片请求
const FAVICON = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='%230a0c10'/><path d='M9 22V11l7 7 7-7v11' fill='none' stroke='%237db2ff' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/></svg>";

/**
 * HTML 转义：所有来自数据文件的文本都要过一遍，避免内容里的尖括号破坏结构。
 * @param {unknown} value 任意值
 * @returns {string} 转义后的安全文本
 */
function esc(value) {
  // 统一转字符串后替换 5 个危险字符
  return String(value ?? '')
    .replace(/&/g, '&amp;') // & 必须最先转，否则会二次转义
    .replace(/</g, '&lt;') // 左尖括号
    .replace(/>/g, '&gt;') // 右尖括号
    .replace(/"/g, '&quot;') // 双引号
    .replace(/'/g, '&#39;'); // 单引号
} // esc 结束

/**
 * JSON-LD 序列化：script 内不能出现裸 `</`，统一转成 Unicode 转义。
 * @param {unknown} obj 结构化数据对象
 * @returns {string} 可安全嵌入 script 标签的 JSON 文本
 */
function jsonld(obj) {
  // 先正常序列化，再把尖括号转义，避免提前闭合 script
  return JSON.stringify(obj).replace(/</g, '\\u003c');
} // jsonld 结束

/**
 * 输出一行「注释 + 代码」对：注释保证可读性，也满足逐行注释门禁。
 * @param {string[]} out 行缓冲区
 * @param {string} comment 中文注释
 * @param {string} code 该行代码
 */
function line(out, comment, code) {
  // 先压注释行
  out.push(`<!-- ${comment} -->`);
  // 再压代码行
  out.push(code);
} // line 结束

/**
 * 取当前日期（YYYY-MM-DD），用于 sitemap 的 lastmod。
 * @returns {string} 日期字符串
 */
function today() {
  // 用本地时间切片，避免 toISOString 的时区偏移把日期算错一天
  const now = new Date();
  // 补零后的年-月-日
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
} // today 结束

/**
 * 渲染通用页头（head 之外的导航与跳过链接）。
 * @param {string[]} out 行缓冲区
 * @param {{d?:object}} ctx 上下文，d 存在表示详情页
 */
function renderHeader(out, ctx) {
  // 跳过导航链接：键盘用户第一个焦点即可直达正文
  line(out, '无障碍：跳到主内容', '<a class="skip" href="#main">跳到主要内容</a>');
  // 顶部导航容器
  line(out, '顶部导航：吸顶，包含品牌与站点级入口', '<header class="site-header"><div class="wrap nav">');
  // 品牌区：返回领域索引，而不是返回站点首页，符合「领域内导航」直觉
  line(out, '品牌区：点击回到领域索引', `<a class="brand" href="./index.html"><span class="brand-mark" aria-hidden="true">M</span><span>Mim</span><span class="brand-tag">领域</span></a>`);
  // 站点级导航：只放与领域页相关的三处入口
  line(out, '站点级导航：索引 / 产品文档 / 站点首页', '<nav class="nav-links" aria-label="站点导航"><a href="./index.html">全部领域</a><a href="../index.html">站点首页</a><a href="../prd.html">产品文档</a></nav>');
  // 导航容器收尾
  line(out, '导航容器结束', '</div></header>');
} // renderHeader 结束

/**
 * 渲染页脚。
 * @param {string[]} out 行缓冲区
 */
function renderFooter(out) {
  // 页脚容器
  line(out, '页脚：返回入口与免责说明', '<footer class="site-footer"><div class="wrap">');
  // 页脚主行
  line(out, '页脚主行：左侧版权与定位，右侧链接', '<div class="foot-row"><p>Mim · 内容、社区与交易一体化</p><nav class="foot-links" aria-label="页脚导航"><a href="./index.html">全部领域</a><a href="../index.html">站点首页</a><a href="../prd.html">产品文档</a></nav></div>');
  // 免责说明：领域页内容为能力说明，不构成业务承诺
  line(out, '免责说明：本页是能力与落位说明，不构成服务承诺', '<p class="foot-note">本页用于说明该业务领域的定位、功能点与对现有能力的复用关系，不构成服务承诺；涉及资金、医疗、法律的实际规则以线上页面与正式条款为准。</p>');
  // 页脚收尾
  line(out, '页脚容器结束', '</div></footer>');
} // renderFooter 结束

/**
 * 渲染单个领域详情页。
 * @param {object} d 领域数据
 * @param {object} data 全量数据（用于查分组名与相关领域）
 * @returns {string} 完整 HTML 文本
 */
function renderDomainPage(d, data) {
  // 行缓冲
  const out = [];
  // 分组显示名
  const groupName = data.groups[d.category]?.name ?? d.category;
  // 状态显示名与样式类
  const statusName = data.statuses[d.status]?.name ?? d.status;
  // 已上线用薄荷绿标签，规划中用琥珀标签
  const statusClass = d.status === 'active' ? 'tag-live' : 'tag-plan';
  // 本页绝对地址：canonical 与 sitemap 共用同一口径
  const canonical = `${BASE_URL}/domains/${d.slug}.html`;
  // 页面标题：领域名 + 站点名，便于搜索结果区分
  const title = `${d.name_zh}（${d.name_en}）· Mim 业务领域`;
  // 页面描述：用 tagline + 简述，控制在 120 字内
  const description = `${d.tagline}。${d.description}。${d.reuse}。`;

  // 文档类型声明
  out.push('<!DOCTYPE html>');
  // 主语言
  line(out, '根元素：简体中文', '<html lang="zh-CN">');
  // head 开始
  line(out, '文档头：编码、视口、SEO、社交卡片、结构化数据与样式', '<head>');
  // 编码声明必须靠前
  line(out, '字符编码：避免中文乱码', '<meta charset="UTF-8" />');
  // 视口
  line(out, '视口：跟随设备宽度', '<meta name="viewport" content="width=device-width, initial-scale=1" />');
  // 标题
  line(out, '标签页标题', `<title>${esc(title)}</title>`);
  // SEO 描述
  line(out, 'SEO 描述：供搜索引擎摘要', `<meta name="description" content="${esc(description)}" />`);
  // 关键词：只列本领域真实存在的词，不堆砌
  line(out, 'SEO 关键词：领域名与功能点', `<meta name="keywords" content="${esc([d.name_zh, d.name_en, ...d.features.map((f) => f.name), 'Mim'].join(','))}" />`);
  // canonical：声明规范地址，避免镜像站重复收录
  line(out, '规范地址：避免多端镜像被判重复内容', `<link rel="canonical" href="${esc(canonical)}" />`);
  // 收录策略：允许收录并跟随
  line(out, '收录策略：允许索引与跟随', '<meta name="robots" content="index,follow" />');
  // 主题色
  line(out, '主题色：与页面背景一致', '<meta name="theme-color" content="#0a0c10" />');
  // 配色方案
  line(out, '配色方案：声明深色，原生控件跟随', '<meta name="color-scheme" content="dark" />');
  // Open Graph 类型
  line(out, '社交卡片：类型与站点名', '<meta property="og:type" content="article" /><meta property="og:site_name" content="Mim" />');
  // Open Graph 标题与描述
  line(out, '社交卡片：标题与描述', `<meta property="og:title" content="${esc(title)}" /><meta property="og:description" content="${esc(description)}" />`);
  // Open Graph 语言与地址
  line(out, '社交卡片：语言与规范地址', `<meta property="og:locale" content="zh_CN" /><meta property="og:url" content="${esc(canonical)}" />`);
  // Twitter 卡片
  line(out, '社交卡片：Twitter 摘要', `<meta name="twitter:card" content="summary" /><meta name="twitter:title" content="${esc(title)}" />`);
  // 图标：内联 SVG，零请求
  line(out, '站点图标：内联 SVG，不产生图片请求', `<link rel="icon" href="${FAVICON}" />`);
  // 共享样式表：13 页共用一份，缓存后二次进入更快
  line(out, '共享样式表：与站点首页同一套设计令牌', '<link rel="stylesheet" href="./domains.css" />');
  // 结构数据一：面包屑
  line(out, '结构化数据：面包屑层级', `<script type="application/ld+json">${jsonld({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Mim', item: `${BASE_URL}/` }, { '@type': 'ListItem', position: 2, name: '业务领域', item: `${BASE_URL}/domains/` }, { '@type': 'ListItem', position: 3, name: d.name_zh, item: canonical }] })}</script>`);
  // 结构数据二：网页本体
  line(out, '结构化数据：网页本体与所属站点', `<script type="application/ld+json">${jsonld({ '@context': 'https://schema.org', '@type': 'WebPage', name: title, description, url: canonical, inLanguage: 'zh-CN', isPartOf: { '@type': 'WebSite', name: 'Mim', alternateName: 'Mim 内容、社区与交易一体化' }, about: { '@type': 'Thing', name: d.name_zh, description: d.description } })}</script>`);
  // 结构数据三：常见问题
  line(out, '结构化数据：常见问题（可被搜索引擎直接展示）', `<script type="application/ld+json">${jsonld({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: d.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) })}</script>`);
  // head 收尾
  line(out, '文档头结束', '</head>');
  // 页面主体开始
  line(out, '页面主体开始', '<body>');
  // 通用页头
  renderHeader(out, { d });
  // 主内容开始
  line(out, '主内容区：详情页所有分区都挂在这里', '<main id="main">');
  // 面包屑容器
  line(out, '面包屑：Mim → 业务领域 → 当前领域', '<div class="wrap"><nav class="crumbs" aria-label="面包屑"><a href="../index.html">Mim</a><span aria-hidden="true">/</span><a href="./index.html">业务领域</a><span aria-hidden="true">/</span><b aria-current="page">' + esc(d.name_zh) + '</b></nav></div>');
  // 头图区
  line(out, '头图区：领域名、状态、导语与两个出口', '<section class="hero"><div class="wrap">');
  // 眉题行：分组 + 英文名 + 图标
  line(out, '眉题：所属分组与英文名', `<p class="hero-kicker"><span class="hero-icon" aria-hidden="true">${esc(d.icon)}</span><span>${esc(groupName)}</span><span>·</span><span>${esc(d.name_en)}</span></p>`);
  // 标题行：主标题与状态徽标
  line(out, '标题行：中文名与上线状态', `<div class="hero-title"><h1>${esc(d.name_zh)}</h1><span class="tag ${statusClass}">${esc(statusName)}</span></div>`);
  // 导语：tagline + 复用关系
  line(out, '导语：一句话定位 + 复用的现有能力', `<p class="hero-lead">${esc(d.tagline)}。${esc(d.description)}；${esc(d.reuse)}。</p>`);
  // 按钮行
  line(out, '操作区：进入相关功能 / 查看全部领域', '<div class="hero-actions"><a class="btn btn-primary" href="#live">查看运行状态</a><a class="btn btn-ghost" href="./index.html">全部 13 个领域</a></div>');
  // 头图区收尾
  line(out, '头图区结束', '</div></section>');

  // 分区一：定位
  line(out, '分区一：定位说明（静态正文，爬虫可直接读取）', '<section class="section"><div class="wrap"><div class="sec-head"><div><p class="kicker">定位</p><h2>这个领域在 Mim 里承担什么</h2></div><p>内容静态直出，不依赖接口返回才能看到。</p></div><div class="prose">');
  // 逐段输出定位正文
  for (const p of d.lead) line(out, '定位段落', `<p>${esc(p)}</p>`);
  // 定位区收尾
  line(out, '定位区结束', '</div></div></section>');

  // 分区二：典型场景
  line(out, '分区二：典型场景（三列卡片）', '<section class="section"><div class="wrap"><div class="sec-head"><div><p class="kicker">场景</p><h2>谁在什么情况下会用到</h2></div><p>列的是可验证的使用路径，不是宣传语。</p></div><div class="grid">');
  // 逐条场景
  d.scenarios.forEach((s, i) => {
    // 场景卡片
    line(out, '场景卡片', `<article class="card"><span class="card-idx">场景 ${String(i + 1).padStart(2, '0')}</span><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p></article>`);
  });
  // 场景区收尾
  line(out, '场景区结束', '</div></div></section>');

  // 分区三：功能清单
  line(out, '分区三：功能清单（口径与目录一致）', '<section class="section"><div class="wrap"><div class="sec-head"><div><p class="kicker">功能</p><h2>包含哪些能力</h2></div><p>名称与后端领域目录逐字一致，避免两处叫法不同。</p></div><div class="feature-grid">');
  // 逐项功能
  d.features.forEach((f) => {
    // 功能项：左侧圆点承载序号语义
    line(out, '功能项', `<article class="feature"><span class="feature-dot" aria-hidden="true">✓</span><div><h3>${esc(f.name)}</h3><p>${esc(f.text)}</p></div></article>`);
  });
  // 功能区收尾
  line(out, '功能区结束', '</div></div></section>');

  // 分区四：工作流
  line(out, '分区四：工作流（四步，CSS 计数器编号）', '<section class="section"><div class="wrap"><div class="sec-head"><div><p class="kicker">流程</p><h2>一条请求怎么走完</h2></div><p>步骤顺序即实现时的推荐路径。</p></div><div class="steps">');
  // 逐步骤
  d.workflow.forEach((w) => {
    // 步骤卡片
    line(out, '流程步骤', `<article class="step"><h3>${esc(w.step)}</h3><p>${esc(w.text)}</p></article>`);
  });
  // 工作流收尾
  line(out, '工作流区结束', '</div></div></section>');

  // 分区五：复用映射
  line(out, '分区五：复用映射（哪些能力已经在跑）', '<section class="section"><div class="wrap"><div class="sec-head"><div><p class="kicker">复用</p><h2>现有能力与入口</h2></div><p>标「已上线」的入口可直接访问；空入口表示仅在仓库内维护。</p></div><div class="table-wrap"><table><caption class="skip">复用能力对照表</caption><thead><tr><th scope="col">能力</th><th scope="col">现有入口</th><th scope="col">说明</th></tr></thead><tbody>');
  // 逐行映射
  d.reuse_map.forEach((r) => {
    // 入口列：有地址就出链接，没有就写维护位置
    const entry = r.entry_url ? `<a href="${esc(r.entry_url)}">${esc(r.entry_label)}</a>` : `${esc(r.entry_label)}（仓库内）`;
    // 表格行
    line(out, '复用映射行', `<tr><th scope="row">${esc(r.capability)}</th><td>${entry}</td><td>${esc(r.note)}</td></tr>`);
  });
  // 表格与分区收尾
  line(out, '表格与复用区结束', '</tbody></table></div></div></section>');

  // 分区六：实时状态（动态部分）
  line(out, '分区六：实时状态（异步加载，失败不影响静态内容）', '<section class="section" id="live"><div class="wrap"><div class="sec-head"><div><p class="kicker">实时</p><h2>接口与社区动态</h2></div><p>本区块由脚本异步补数据；脚本或接口不可用时，上面的静态内容照常可读。</p></div>');
  // 状态容器：data-live 供脚本定位，data-api 允许部署方覆盖接口前缀
  line(out, '状态容器：脚本据此探活并拉取社区动态', '<div class="live" data-live data-api="/api/v1"><span class="live-dot" aria-hidden="true"></span><b data-live-label>检测中…</b><small>静态内容已就绪，此处仅补充实时信息</small></div>');
  // 动态列表容器：默认空，由脚本按需填充
  line(out, '动态列表容器：最多三条，默认留空', '<ul class="live-list" data-live-list aria-label="社区最新动态"></ul>');
  // 分区收尾
  line(out, '实时区结束', '</div></section>');

  // 分区七：FAQ
  line(out, '分区七：常见问题（原生 details，无脚本可用）', '<section class="section"><div class="wrap"><div class="sec-head"><div><p class="kicker">问答</p><h2>常见问题</h2></div><p>只回答本领域边界内的问题，不代替正式条款。</p></div><div class="faq">');
  // 逐条问答
  d.faq.forEach((f) => {
    // 问答项
    line(out, '问答项', `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`);
  });
  // FAQ 收尾
  line(out, '问答区结束', '</div></div></section>');

  // 分区八：相关领域
  line(out, '分区八：相关领域（帮助横向浏览）', '<section class="section"><div class="wrap"><div class="sec-head"><div><p class="kicker">相关</p><h2>常一起出现的领域</h2></div></div><div class="related">');
  // 逐条相关领域
  d.related.forEach((slug) => {
    // 找到目标领域，拿名称与图标
    const target = data.domains.find((x) => x.slug === slug);
    // 目标缺失时跳过，避免死链
    if (!target) return;
    // 相关链接
    line(out, '相关领域链接', `<a href="./${esc(target.slug)}.html"><span aria-hidden="true">${esc(target.icon)}</span>${esc(target.name_zh)}</a>`);
  });
  // 相关区收尾
  line(out, '相关区结束', '</div></div></section>');

  // 主内容收尾
  line(out, '主内容区结束', '</main>');
  // 页脚
  renderFooter(out);
  // 异步增强脚本：defer 不阻塞解析；脚本失败也不影响内容
  line(out, '动态增强脚本：异步探活与社区动态，失败自动降级', '<script src="./live.js" defer></script>');
  // body 收尾
  line(out, '页面主体结束', '</body>');
  // html 收尾
  line(out, '文档结束', '</html>');
  // 行缓冲拼成文本，末尾补换行
  return out.join('\n') + '\n';
} // renderDomainPage 结束

/**
 * 渲染领域索引页：按 5 个分组列出 13 个领域。
 * @param {object} data 全量数据
 * @returns {string} 完整 HTML 文本
 */
function renderIndexPage(data) {
  // 行缓冲
  const out = [];
  // 已上线数量：由数据推导，不硬编码
  const activeCount = data.domains.filter((d) => d.status === 'active').length;
  // 规划中数量
  const plannedCount = data.domains.length - activeCount;
  // 索引页标题
  const title = '业务领域 · 13 个领域与 5 个分组 · Mim';
  // 索引页描述
  const description = `Mim 的 13 个业务领域按 5 个分组组织：${Object.values(data.groups).map((g) => g.name).join('、')}。${activeCount} 个已上线，${plannedCount} 个规划中。`;
  // 规范地址
  const canonical = `${BASE_URL}/domains/`;

  // 文档类型
  out.push('<!DOCTYPE html>');
  // 根元素
  line(out, '根元素：简体中文', '<html lang="zh-CN">');
  // head
  line(out, '文档头：编码、视口、SEO、结构化数据与样式', '<head>');
  // 编码
  line(out, '字符编码', '<meta charset="UTF-8" />');
  // 视口
  line(out, '视口', '<meta name="viewport" content="width=device-width, initial-scale=1" />');
  // 标题
  line(out, '标签页标题', `<title>${esc(title)}</title>`);
  // 描述
  line(out, 'SEO 描述', `<meta name="description" content="${esc(description)}" />`);
  // 关键词
  line(out, 'SEO 关键词', `<meta name="keywords" content="${esc(data.domains.map((d) => d.name_zh).join(','))}" />`);
  // canonical
  line(out, '规范地址', `<link rel="canonical" href="${esc(canonical)}" />`);
  // 收录策略
  line(out, '收录策略', '<meta name="robots" content="index,follow" />');
  // 主题色
  line(out, '主题色', '<meta name="theme-color" content="#0a0c10" />');
  // 配色
  line(out, '配色方案：深色', '<meta name="color-scheme" content="dark" />');
  // 社交卡片
  line(out, '社交卡片：标题与描述', `<meta property="og:type" content="website" /><meta property="og:site_name" content="Mim" /><meta property="og:title" content="${esc(title)}" /><meta property="og:description" content="${esc(description)}" />`);
  // 图标
  line(out, '站点图标：内联 SVG', `<link rel="icon" href="${FAVICON}" />`);
  // 样式
  line(out, '共享样式表', '<link rel="stylesheet" href="./domains.css" />');
  // 结构数据：集合页
  line(out, '结构化数据：领域集合页与条目清单', `<script type="application/ld+json">${jsonld({ '@context': 'https://schema.org', '@type': 'CollectionPage', name: title, description, url: canonical, inLanguage: 'zh-CN', hasPart: data.domains.map((d) => ({ '@type': 'WebPage', name: `${d.name_zh}（${d.name_en}）`, url: `${BASE_URL}/domains/${d.slug}.html`, description: d.description })) })}</script>`);
  // head 收尾
  line(out, '文档头结束', '</head>');
  // body
  line(out, '页面主体开始', '<body>');
  // 页头
  renderHeader(out, {});
  // 主内容
  line(out, '主内容区', '<main id="main">');
  // 头图
  line(out, '头图区：总量、分组与状态分布', '<section class="hero"><div class="wrap">');
  // 眉题
  line(out, '眉题', '<p class="hero-kicker"><span class="hero-icon" aria-hidden="true">🧭</span><span>业务领域</span></p>');
  // 标题与统计
  line(out, '标题与统计：全部数字由数据推导', `<div class="hero-title"><h1>13 个业务领域</h1><span class="tag tag-live">${activeCount} 已上线</span><span class="tag tag-plan">${plannedCount} 规划中</span></div>`);
  // 导语
  line(out, '导语：说明「复用为主、新建为辅」的原则', '<p class="hero-lead">13 个领域按 5 个分组组织。已上线的领域映射到现有真实能力，规划中的领域只给路线图与功能点；每个领域的页面都静态直出，交互部分才异步加载。</p>');
  // 头图收尾
  line(out, '头图区结束', '</div></section>');
  // 逐分组渲染
  Object.keys(data.groups).forEach((key) => {
    // 分组字典项
    const group = data.groups[key];
    // 本组领域
    const items = data.domains.filter((d) => d.category === key);
    // 空分组不渲染，避免出现空标题
    if (items.length === 0) return;
    // 分组分区
    line(out, '分组分区：标题 + 领域卡片网格', '<section class="section"><div class="wrap"><div class="sec-head"><div><p class="kicker">' + esc(group.name) + '</p><h2>' + esc(group.name) + ' · ' + items.length + ' 个领域</h2></div><p>' + esc(group.desc) + '</p></div><div class="grid">');
    // 逐卡片
    items.forEach((d) => {
      // 状态显示名与类
      const statusName = data.statuses[d.status]?.name ?? d.status;
      // 标签类
      const statusClass = d.status === 'active' ? 'tag-live' : 'tag-plan';
      // 卡片：整卡是一个指向详情页的链接
      line(out, '领域卡片：整卡可点，进入静态详情页', `<a class="card" href="./${esc(d.slug)}.html"><span class="card-idx" aria-hidden="true">${esc(d.icon)}</span><h3>${esc(d.name_zh)} <span class="tag ${statusClass}">${esc(statusName)}</span></h3><p>${esc(d.description)}</p><p><small>复用：${esc(d.reuse)}</small></p></a>`);
    });
    // 分组收尾
    line(out, '分组结束', '</div></div></section>');
  });
  // 说明分区：口径与更新方式
  line(out, '说明分区：内容口径与更新方式', '<section class="section"><div class="wrap"><div class="sec-head"><div><p class="kicker">维护</p><h2>这些页面怎么更新</h2></div></div><div class="prose"><p>页面由仓库脚本从一份数据文件生成：改内容只改数据，重跑构建即可，不需要起服务或查数据库。</p><p>领域名称、分组、状态与功能点与后端领域目录保持一致；本页不单独维护第二套命名。</p></div></div></section>');
  // 主内容收尾
  line(out, '主内容区结束', '</main>');
  // 页脚
  renderFooter(out);
  // body 收尾
  line(out, '页面主体结束', '</body>');
  // html 收尾
  line(out, '文档结束', '</html>');
  // 拼成文本
  return out.join('\n') + '\n';
} // renderIndexPage 结束

/**
 * 渲染 sitemap.xml。
 * @param {object} data 全量数据
 * @returns {string} XML 文本
 */
function renderSitemap(data) {
  // 日期：同一次构建的所有条目共用
  const lastmod = today();
  // XML 头与 urlset 开始
  const head = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';
  // 索引页条目
  const indexEntry = `  <url><loc>${BASE_URL}/domains/</loc><lastmod>${lastmod}</lastmod><changefreq>monthly</changefreq><priority>0.9</priority></url>`;
  // 13 个详情页条目
  const domainEntries = data.domains.map((d) => `  <url><loc>${BASE_URL}/domains/${d.slug}.html</loc><lastmod>${lastmod}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>`).join('\n');
  // 结尾
  const tail = '</urlset>';
  // 拼接并补换行
  return `${head}\n${indexEntry}\n${domainEntries}\n${tail}\n`;
} // renderSitemap 结束

/**
 * 渲染 robots.txt：放行全站，并指向 sitemap。
 * @returns {string} 文本
 */
function renderRobots() {
  // 三行声明，末尾留换行
  return ['User-agent: *', 'Allow: /', `Sitemap: ${BASE_URL}/sitemap.xml`, ''].join('\n');
} // renderRobots 结束

/**
 * 主流程：读数据 → 渲染 → 落盘。
 */
function main() {
  // 读取并解析数据源；解析失败直接抛出，避免产出半套页面
  const data = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  // 基本校验：领域数量必须为 13，防止数据被误删
  if (!Array.isArray(data.domains) || data.domains.length !== 13) {
    // 数量不符时明确失败，而不是静默生成 12 个页面
    throw new Error(`领域数量应为 13，实际 ${data.domains?.length ?? 0}`);
  } // 校验结束
  // 唯一性校验：slug 重复会导致后写覆盖前写
  const slugSet = new Set(data.domains.map((d) => d.slug));
  // 去重后数量必须与原始一致
  if (slugSet.size !== data.domains.length) throw new Error('存在重复的领域 slug');
  // 确保输出目录存在（幂等）
  mkdirSync(OUT_DIR, { recursive: true });
  // 输出索引页
  writeFileSync(join(OUT_DIR, 'index.html'), renderIndexPage(data), 'utf8');
  // 逐领域输出详情页
  for (const d of data.domains) {
    // 文件名即 slug，保证 URL 可预测
    writeFileSync(join(OUT_DIR, `${d.slug}.html`), renderDomainPage(d, data), 'utf8');
  } // 输出循环结束
  // 输出 sitemap 到站点根
  writeFileSync(join(SITE_DIR, 'sitemap.xml'), renderSitemap(data), 'utf8');
  // 输出 robots 到站点根
  writeFileSync(join(SITE_DIR, 'robots.txt'), renderRobots(), 'utf8');
  // 打印结果，便于 CI 日志与本地核对
  console.log(`✅ 领域静态页已生成：${data.domains.length} 个详情页 + 1 个索引页 + sitemap/robots`);
  console.log(`   输出目录：${OUT_DIR}`);
  console.log(`   绝对地址前缀：${BASE_URL}（可用 SITE_BASE_URL 覆盖）`);
} // main 结束

// 执行主流程：任何异常都打印后以非 0 退出，避免 CI 误判成功
try {
  // 调用主流程
  main();
  // 捕获并输出错误
} catch (err) {
  // 输出可读错误信息
  console.error('❌ 生成失败：', err instanceof Error ? err.message : err);
  // 以失败码退出
  process.exit(1);
} // try/catch 结束
