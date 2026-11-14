/**
 * API 业务端点（2026-11-14 P1-A 拆分，自 api.ts 原样搬出）
 *
 * 22 个业务域按原有顺序保留在一个对象里，调用方式仍为 api.<域>.<方法>，对外契约完全不变。
 * 后续再按域拆成独立文件时，只需把这里的某个键搬走并在 api.ts 里展开合并，不会影响调用方。
 */

import { ApiError, BASE, current, request } from './request.js'; // 所有端点的唯一出口：鉴权、幂等、错误信封与 401 重试
import type { Locale } from '@mim/i18n';
import type { Region, Provider, CaptchaScene, CaptchaIssue, SecurityStatus, CaptchaTicket, UserInfo, OAuthProviderInfo, OAuthBinding, RealnameRecord, LoginResult, MeResponse, ComicProject, ComicCharacter, StoryboardShot, Storyboard, SuggestKind, Suggestion, JobType, GenerationJob, Film, FilmVersion, ShowcaseWork, TheaterItem, FilmExportFormat, FilmExportResolution, FilmExportResult, AssetType, ListedAsset, PresignedUrl, AiCapabilities, RunJobResult, ImConversationType, ImMessageContentType, ImMessage, ImConversation, ImMember, ImUser, CartSummary, CartCheckoutResult, SiteCapability, EntryModule, SiteModuleSummary, EntryDomain, SiteGroup, SiteModuleDetail, SiteItem, SiteOverview, EntryOverview, DeploymentItem, DeploymentOverview, CommunityBoard, CommunityThreadMedia, CommunityThread, CommunityThreadDetail, CommunityPost, CircleRole, CircleSummary, CircleMember, CirclePost, CircleNotice, CircleCreatePayload, VipPlan, WalletSnapshot, WalletTransaction, ShopProduct, ShopOrder, UnifiedOrder, UnifiedOrderSummary, UnifiedOrderSource, NavLink, NavSummary, SearchEngine, SearchResponse, SearchScopeCount, PaidAssetKind, PaidAsset, PaidAssetDetail, PaymentProvider, PaymentChannel, PaymentIntent, Shipment, AfterSale, ProductReview, Withdrawal, CreatorEarning, ThemeSettings, I18nSettings, PageBlock, PointsDeductionConfig, AnnouncementItem, ChangelogItem, PromotionItem, AnnouncementUpsertPayload, ChangelogUpsertPayload, PromotionUpsertPayload, BoardTab, BoardTabInput, ToolItem, ToolUpsertPayload, GrowthSnapshot, DirectMessage } from './types.js'; // 端点签名用到的类型仍定义在 api.ts，仅类型引用

export const api = { // 接口集合：按业务域分组，调用方按 api.xxx.yyy 使用
  requestCode(region: Region, provider: Provider, identifier: string, captcha?: { id: string; code: string }) { // 请求发送验证码（开发环境直接回传 dev_code）
    return request<{ // 发码响应结构
      delivery: 'dev'; // 投递方式：当前仅开发态直返验证码
      dev_code: string; // 明文验证码，仅开发环境存在
      identifier: string; // 回显被发送的账号，便于前端校验输入
      provider: Provider; // 回显凭证类型
      expires_in: number; // 验证码有效期（秒）
      note: string; // 提示文案，说明当前为开发模式
    }>('/auth/code', { method: 'POST', body: { region, provider, identifier, captcha_id: captcha?.id, captcha_code: captcha?.code }, auth: false, idempotency: false }); // 公开接口免鉴权；重复发码无副作用，禁用幂等键
  }, // requestCode 结束

  captcha(scene: CaptchaScene = 'login') { // 按场景签发验证码题目：image 返回 SVG，slider 返回拼图背景与缺口，第三方模式仅回模式标识
    return request<CaptchaIssue>('/auth/captcha?scene=' + encodeURIComponent(scene), { auth: false, idempotency: false }); // 返回当前函数的处理结果
  }, // 代码块结束

  securityStatus() { // 安全能力状态：验证码模式 / 强制场景 / 第三方凭证齐备度 / 内容审核开关
    return request<SecurityStatus>('/security/status', { auth: false, idempotency: false }); // 返回当前函数的处理结果
  }, // 代码块结束

  loginWithPassword(payload: { // 密码登录：手机号/邮箱 + 密码
    region: Region; // 区域
    provider?: Provider; // 凭证类型；省略时由服务端按 identifier 形态推断
    identifier: string; // 手机号或邮箱
    password: string; // 明文密码，经 HTTPS 传输，前端不做哈希
    device?: { platform: string; name?: string }; // 设备信息，未传时下面兜底为 web/浏览器
  } & CaptchaTicket) { // 验证码票据字段按当前 mode 携带；off 模式不带
    return request<LoginResult>('/auth/password', { // 走统一请求层拿会话
      method: 'POST', // 登录属写操作
      body: { ...payload, device: payload.device ?? { platform: 'web', name: '浏览器' } }, // 展开原参数并补默认设备标识，便于服务端区分登录来源
      auth: false, // 登录时还没有令牌
      idempotency: false, // 登录无需幂等键：重复提交由密码校验兜底
    }); // 请求调用结束
  }, // loginWithPassword 结束

  register(payload: { // 自助注册：账号 + 口令一次完成注册并拿到会话
    region: Region; // 区域
    provider?: Provider; // 凭证类型；省略时由服务端按 region 推断
    identifier: string; // 手机号或邮箱
    password: string; // 明文口令（≥8 位且含字母与数字），经 HTTPS 传输
    display_name?: string; // 展示名可选，缺省由服务端留空
    invite_code?: string; // 注册门槛开启时必填的有效邀请码
    device?: { platform: string; name?: string }; // 设备信息，未传时兜底 web/浏览器
  } & CaptchaTicket) { // 验证码票据字段按当前 mode 携带；off 模式不带
    return request<LoginResult>('/auth/register', { // 注册成功即返回令牌，前端无需再登录一次
      method: 'POST', // 写操作
      body: { ...payload, device: payload.device ?? { platform: 'web', name: '浏览器' } }, // 补默认设备标识
      auth: false, // 注册时尚无令牌
      idempotency: false, // 重复提交由唯一身份冲突兜底
    }); // 请求调用结束
  }, // register 结束

  authChannels() { // 查询当前部署可用的登录方式，用于登录页隐藏不可用入口
    return request<{ sms: boolean; email: boolean; password: boolean; register: boolean }>('/auth/channels', { auth: false, idempotency: false }); // 公开只读接口
  }, // authChannels 结束

  guest(region?: Region) { // 匿名访客会话：免登录体验入口，不绑定任何身份也拿到完整可用会话
    return request<LoginResult>('/auth/guest', { // 与登录同形状的响应：令牌 + 用户视图
      method: 'POST', // 建号属写操作
      body: { region, device: { platform: 'web', name: '浏览器' } }, // 区域可空，服务端缺省中国区
      auth: false, // 此时还没有令牌
      idempotency: false, // 每次建号都是新访客，重复提交由服务端限流兜底
    }); // 请求调用结束
  }, // guest 结束

  oauthProviders(region?: Region) { // 第三方登录提供方清单（含凭证配置状态）
    const query = region ? `?region=${region}` : ''; // 区域过滤：中国区只看国内可用项
    return request<{ providers: OAuthProviderInfo[] }>(`/auth/oauth/providers${query}`, { auth: false, idempotency: false }); // 公开只读接口
  }, // oauthProviders 结束

  oauthAuthorize(provider: string, payload: { region?: Region; mode?: 'login' | 'bind'; return_to?: string }) { // 生成授权跳转地址
    return request<{ provider: string; authorization_url: string; state: string; expires_in: number; mode: 'login' | 'bind' }>( // 响应结构
      `/auth/oauth/${encodeURIComponent(provider)}/authorize`, // 按提供方发起
      { method: 'POST', body: payload, auth: payload.mode === 'bind', idempotency: false }, // 绑定模式必须带登录态
    ); // 请求调用结束
  }, // oauthAuthorize 结束

  oauthExchange(ticket: string) { // 用回调带回的一次性票据换正式会话
    return request<LoginResult>('/auth/oauth/exchange', { // 与账号登录同一响应形状
      method: 'POST', // 写操作（票据会被消费）
      body: { ticket, device: { platform: 'web', name: '浏览器' } }, // 补默认设备标识
      auth: false, // 兑换时还没有令牌
      idempotency: false, // 票据本身一次性
    }); // 请求调用结束
  }, // oauthExchange 结束

  oauthBindings() { // 当前账号已绑定的第三方身份
    return request<{ accounts: OAuthBinding[] }>('/me/oauth', { idempotency: false }); // 需登录
  }, // oauthBindings 结束

  unlinkOAuth(provider: string) { // 解绑第三方身份（服务端保证至少留一种登录方式）
    return request<{ ok: true; removed: boolean }>(`/me/oauth/${encodeURIComponent(provider)}`, { method: 'DELETE' }); // 写操作自动带幂等键
  }, // unlinkOAuth 结束

  login(payload: { // 验证码登录
    region: Region; // 区域
    provider: Provider; // 凭证类型
    identifier: string; // 手机号或邮箱
    code: string; // 收到的验证码
    device?: { platform: string; name?: string }; // 设备信息，未传时兜底 web/浏览器
  } & CaptchaTicket) { // 验证码票据字段按当前 mode 携带；off 模式不带
    return request<LoginResult>('/auth/login', { // 换取会话
      method: 'POST', // 登录属写操作
      body: { ...payload, device: payload.device ?? { platform: 'web', name: '浏览器' } }, // 同样补默认设备信息
      auth: false, // 尚未登录，不能带 Bearer
      idempotency: false, // 验证码一次性使用，幂等键无意义
    }); // 请求调用结束
  }, // login 结束

  logout() { // 登出：让服务端吊销 refresh_token
    return request<{ ok: true }>('/auth/logout', { // 只需成功标记，不做复杂返回
      method: 'POST', // 吊销属写操作
      body: { refresh_token: current?.refresh_token ?? '' }, // 上交待吊销的令牌；无会话时传空串由服务端忽略
      idempotency: false, // 重复登出应视为成功，不需要幂等键
    }); // 请求调用结束
  }, // logout 结束

  me() { // 拉取当前用户资料
    return request<MeResponse>('/me'); // 默认带鉴权；失败会走统一错误处理
  }, // me 结束

  realname: { // 实名认证：本人提交与状态查询
    status() { // 查询本人最新审核状态；未提交返回 record=null
      return request<{ record: RealnameRecord | null }>('/auth/realname/status', { idempotency: false }); // 只读 GET
    }, // status 结束
    submit(payload: { id_type: 'id_card' | 'passport' | 'other'; name: string; id_number: string }) { // 提交实名资料
      return request<RealnameRecord>('/auth/realname/submit', { method: 'POST', body: payload }); // 明文只在传输中出现
    }, // submit 结束
  }, // realname 分组结束

  updateMe(payload: { display_name?: string; locale?: Locale; timezone?: string }) { // 局部更新资料，仅提交要改的字段
    return request<{ user: UserInfo }>('/me', { method: 'PATCH', body: payload }); // PATCH 语义为局部更新，写操作自动带幂等键
  }, // updateMe 结束

  requestDeletion() { // 申请注销账号（进入冷静期）
    return request<{ status: string; deletion_scheduled_at: string | null }>('/me/deletion', { // 返回最新状态与生效时间
      method: 'POST', // 写操作
      body: {}, // 服务端要求显式空体，保证 Content-Type 与幂等键生效
    }); // 请求调用结束
  }, // requestDeletion 结束

  cancelDeletion() { // 撤销注销申请
    return request<{ status: string }>('/me/cancel-deletion', { method: 'POST', body: {} }); // 同样显式空体，返回恢复后的状态
  }, // cancelDeletion 结束

  // ---------- 商城购物车（cart）----------

  cart: { // 购物车：加购 / 移除 / 清空 / 结算（免费即时解锁，付费生成待结算订单）
    get() { // 读我的购物车
      return request<CartSummary>('/cart', { idempotency: false }); // 只读 GET
    }, // get 结束
    add(module_code: string) { // 加购：重复加购由后端回放
      return request<{ added: boolean; item_id: string; cart: CartSummary }>('/cart/items', { method: 'POST', body: { module_code } }); // 写操作自动带幂等键
    }, // add 结束
    remove(moduleCode: string) { // 移除单个条目
      return request<{ ok: boolean; cart: CartSummary }>(`/cart/items/${encodeURIComponent(moduleCode)}`, { method: 'DELETE' }); // 路径编码防注入
    }, // remove 结束
    clear() { // 清空购物车
      return request<{ ok: boolean; cart: CartSummary }>('/cart', { method: 'DELETE' }); // 写操作带幂等键
    }, // clear 结束
    checkout(channel: 'manual' | 'alipay' | 'wechat' | 'stripe' = 'manual', options: { use_points?: boolean; points_to_use?: number } = {}) { // 结算整车，可选积分抵扣
      return request<{ results: CartCheckoutResult[]; cart: CartSummary }>('/cart/checkout', { method: 'POST', body: { channel, ...options } }); // 返回逐条结果与剩余车
    }, // checkout 结束
  }, // cart 分组结束

  // ---------- 功能模块商城（catalog）----------

  catalog: { // 模块商城：模块列表、详情、解锁、我的权益
    getTaxonomy() { // 拉取分类导航树：19 个一级分类 + 205 个二级条目（带模块计数）
      return request<{ // 导航树响应
        groups: Array<{ // 一级分类列表
          slug: string; // 一级分类标识，作为 category 过滤值
          name: string; // 一级分类中文名称
          name_en: string | null; // 一级分类英文名称（英文站点导航使用，未登记时为 null）
          count: number; // 该分类下模块总数
          items: Array<{ slug: string; name: string; name_en: string | null; count: number }>; // 二级条目（slug / 中英文名 / 模块数）
        }>; // 一级分类类型结束
        total_items: number; // 二级条目总数
        total_modules: number; // 可见模块总数
      }>('/taxonomy', { auth: false, idempotency: false }); // 公开只读接口
    }, // getTaxonomy 结束
    getModules(opts: { // 拉取可购买模块：支持关键词、分类、排序、许可、语言与分页
      q?: string; // 关键词（名称/编码模糊匹配）
      category?: string; // 分类过滤：一级或二级 slug，'all' 等价不过滤
      sort?: 'stars' | 'recommended' | 'updated'; // 排序方式
      licenses?: string[]; // 许可多选
      languages?: string[]; // 语言多选
      page?: number; // 页码，从 1 起
      pageSize?: number; // 每页条数
    } = {}) { // 代码块结束
      // 逐项拼接查询串：空值一律不下发，避免缓存键被空参数污染
      const params: string[] = []; // 查询参数收集器
      if (opts.q) params.push(`q=${encodeURIComponent(opts.q)}`); // 关键词经编码防注入
      if (opts.category && opts.category !== 'all') params.push(`category=${encodeURIComponent(opts.category)}`); // 分类过滤
      if (opts.sort) params.push(`sort=${encodeURIComponent(opts.sort)}`); // 排序方式
      if (opts.licenses && opts.licenses.length > 0) params.push(`licenses=${encodeURIComponent(opts.licenses.join(','))}`); // 许可多选拼逗号串
      if (opts.languages && opts.languages.length > 0) params.push(`languages=${encodeURIComponent(opts.languages.join(','))}`); // 语言多选拼逗号串
      if (opts.page && opts.page > 1) params.push(`page=${opts.page}`); // 首页不必携带
      if (opts.pageSize) params.push(`pageSize=${opts.pageSize}`); // 每页条数
      const suffix = params.length > 0 ? `?${params.join('&')}` : ''; // 组装最终查询串
      return request<{ // 响应为模块数组 + 分页元信息
        modules: Array<{ // 模块条目列表
          code: string; // 模块唯一编码，下单与解锁都用它
          name: Record<string, string>; // 多语言名称，键为语言码
          summary: Record<string, string>; // 多语言简介
          unlock_mode: 'one_time'; // 解锁方式：当前仅一次性买断
          region: Region; // 所属区域
          status: string; // 上架状态
          requires: string[]; // 前置依赖模块编码，前端据此提示
          category_slug: string | null; // 所属二级分类
          license: string | null; // 开源许可
          language: string | null; // 编程语言
          stars: number; // Star 数（Stars 排序依据）
          capability: string | null; // 真实能力键；null 表示该模块功能规划中
          current_price: { currency: string; amount_minor: number } | null; // 当前价格；未定价为 null
        }>; // 模块条目类型结束
        total: number; // 过滤后的总条数
        page: number; // 当前页码
        page_size: number; // 每页条数
        total_pages: number; // 总页数
      }>(`/modules${suffix}`, { auth: false, idempotency: false }); // 公开目录接口，免鉴权、只读无需幂等键
    }, // getModules 结束
    getHotModules(opts: { range: 'today' | 'week'; category?: string; limit?: number }) { // 右侧「热门项目」卡片数据
      const params: string[] = [`range=${encodeURIComponent(opts.range)}`]; // 必带时间窗
      if (opts.category && opts.category !== 'all') params.push(`category=${encodeURIComponent(opts.category)}`); // 跟随当前分类
      if (opts.limit) params.push(`limit=${opts.limit}`); // 条数上限
      return request<{ // 热门列表响应
        range: 'today' | 'week'; // 回显时间窗
        window_hours: number; // 窗口小时数（24 / 168）
        category: string; // 回显分类，all 表示全站
        total: number; // 参与排序的模块总数
        items: Array<{ // 热门条目
          code: string; // 模块编码
          name: Record<string, string>; // 多语言名称
          stars: number; // Star 数
          category_slug: string | null; // 所属二级分类
          license: string | null; // 开源许可
          language: string | null; // 编程语言
          created_at: string; // 创建时间，用于「新」标记
          hotness: number; // 热度分值（Stars + 窗口内新建加权）
        }>; // 热门条目类型结束
      }>(`/modules/hot?${params.join('&')}`, { auth: false, idempotency: false }); // 公开只读接口
    }, // getHotModules 结束
    getModule(code: string) { // 拉取单个模块详情
      return request<{ // 详情比列表多价格历史
        code: string; // 模块编码
        name: Record<string, string>; // 多语言名称
        summary: Record<string, string>; // 多语言简介
        unlock_mode: 'one_time'; // 解锁方式
        region: Region; // 所属区域
        status: string; // 上架状态
        requires: string[]; // 前置依赖
        category_slug: string | null; // 所属二级分类，详情页显示归属
        license: string | null; // 开源许可，与列表徽标同源
        language: string | null; // 编程语言，与列表徽标同源
        stars: number; // Star 数
        capability: string | null; // 真实能力键；前端据此渲染「工具」区块或「规划中」标记
        current_price: { currency: string; amount_minor: number } | null; // 当前价格，未定价为 null
        price_history: Array<{ // 价格变更历史，供详情页展示走势
          currency: string; // 币种
          amount_minor: number; // 金额（最小货币单位）
          effective_from: string; // 生效开始时间
          effective_to: string | null; // 生效结束时间；null 表示仍在生效
        }>; // 价格历史类型结束
      }>(`/modules/${encodeURIComponent(code)}`, { auth: false, idempotency: false }); // 编码路径参数防注入；公开只读接口
    }, // getModule 结束
    invokeModule(module_code: string, text: string, options: Record<string, string | number | boolean> = {}) { // 调用模块绑定的真实能力
      return request<{ // 能力调用结果
        module_code: string; // 回显模块编码
        capability: string; // 回显能力键
        output: string; // 结果正文：文本 / JSON / HTML / 图片 dataURL
        output_kind: 'text' | 'json' | 'html' | 'image'; // 输出形态，决定前端渲染方式
        meta: Record<string, unknown>; // 附加信息（字节数 / 算法 / 尺寸等）
        elapsed_ms: number; // 服务端执行耗时
      }>(`/modules/${encodeURIComponent(module_code)}/invoke`, { method: 'POST', body: { text, options } }); // 写操作自动带幂等键；后端校验登录与权益
    }, // invokeModule 结束
    unlockModule(module_code: string) { // 解锁（购买）模块，生成权益
      return request<{ // 返回新建/更新的权益
        entitlement: { // 权益对象
          id: string; // 权益主键
          module_code: string; // 对应模块编码
          module_name: Record<string, string>; // 模块多语言名，便于直接展示
          status: string; // 权益状态（active/expired 等）
          expires_at: string | null; // 到期时间；永久有效为 null
          version: number; // 版本号，供并发控制
          created_at: string; // 创建时间
        }; // 权益对象结束
      }>('/entitlements', { method: 'POST', body: { module_code } }); // 写操作：下单并解锁，自动带幂等键防重复扣费
    }, // unlockModule 结束
    getMyEntitlements() { // 拉取我拥有的权益
      return request<{ // 响应为权益数组包装
        entitlements: Array<{ // 权益列表
          id: string; // 权益主键
          module_code: string; // 模块编码
          module_name: Record<string, string>; // 模块多语言名
          status: string; // 权益状态
          expires_at: string | null; // 到期时间
          created_at: string; // 创建时间
        }>; // 权益数组类型结束
      }>('/me/entitlements', { idempotency: false }); // 只读 GET，无需幂等键
    }, // getMyEntitlements 结束
    createOrder(module_code: string) { // 为付费模块下单（待结算）；重复点击由后端回放同一张单
      return request<{ // 返回订单对象
        order: { // 订单视图
          id: string; // 订单主键，取消订单要用
          status: string; // 订单状态：pending / paid / cancelled
          currency: string; // 结算币种
          amount_minor: number; // 成交金额（分）
          channel: string; // 结算渠道；当前为 manual 人工结算
          module_code: string; // 模块编码
          module_name: Record<string, string>; // 模块多语言名
          entitlement_id: string | null; // 结算后发放的权益主键
          created_at: string; // 下单时间
          paid_at: string | null; // 结算时间
        }; // 订单视图结束
      }>('/orders', { method: 'POST', body: { module_code } }); // 写操作自动带幂等键，避免重复下单
    }, // createOrder 结束
    getMyOrders() { // 拉取我的订单列表
      return request<{ // 响应为订单数组包装
        orders: Array<{ // 订单条目
          id: string; // 订单主键
          status: string; // 订单状态
          currency: string; // 币种
          amount_minor: number; // 金额（分）
          module_code: string; // 模块编码
          module_name: Record<string, string>; // 模块多语言名
          created_at: string; // 下单时间
          paid_at: string | null; // 结算时间
        }>; // 订单数组类型结束
        total: number; // 总条数
      }>('/orders', { idempotency: false }); // 只读 GET，无需幂等键
    }, // getMyOrders 结束
    cancelOrder(id: string) { // 取消自己的待结算订单
      return request<{ order: { id: string; status: string; cancelled_at: string } }>( // 返回取消结果
        `/orders/${encodeURIComponent(id)}/cancel`, // 订单子资源
        { method: 'POST', body: {} }, // 显式空体，确保幂等键被附加
      ); // 请求调用结束
    }, // cancelOrder 结束
  }, // catalog 分组结束

  // ---------- 漫剧 AI 剧（comic，契约对齐 services/mim-api/src/routes/comic.ts）----------

  comic: { // 漫剧业务：项目、角色、分镜、任务、成片
    showcase() { // 放映厅演示片库：匿名可看，不携带鉴权也可调用
      return request<{ items: ShowcaseWork[]; updated_at: string }>('/comic/showcase', { idempotency: false, auth: false }); // 公开只读
    }, // showcase 结束
    theater() { // 我的放映厅：本人成片 + 最新版本播放地址（需登录，不要求模块权益）
      return request<{ items: TheaterItem[] }>('/comic/theater', { idempotency: false }); // 登录后由服务端签发播放 URL
    }, // theater 结束
    listProjects() { // 列出我的项目
      return request<{ items: ComicProject[] }>('/comic/projects', { idempotency: false }); // 只读 GET，默认带鉴权
    }, // listProjects 结束
    createProject(payload: { title: string; synopsis?: string }) { // 新建项目，仅需标题与可选梗概
      return request<{ project: ComicProject }>('/comic/projects', { method: 'POST', body: payload }); // 写操作自动生成幂等键，防止重复建项目
    }, // createProject 结束
    getProject(id: string) { // 项目详情：项目 + 角色 + 最新分镜一次取回
      return request<{ // 详情响应结构
        project: ComicProject; // 项目本体
        characters: ComicCharacter[]; // 角色列表
        latest_storyboard: Storyboard | null; // 最新分镜稿，未创建为 null
      }>(`/comic/projects/${encodeURIComponent(id)}`, { idempotency: false }); // 路径参数编码；只读无需幂等键
    }, // getProject 结束
    deleteProject(id: string) { // 删除项目
      return request<{ ok: true; project_id: string }>(`/comic/projects/${encodeURIComponent(id)}`, { // 返回删除标记与被删 id
        method: 'DELETE', // 删除语义
        body: {}, // 显式空体，确保 Content-Type 与幂等键被正确附加
      }); // 请求调用结束
    }, // deleteProject 结束
    saveStoryboard(id: string, payload: { shots: StoryboardShot[]; confirm?: boolean }) { // 保存/确认分镜
      return request<{ storyboard: Storyboard; project_status: string }>( // 返回新分镜稿与项目新状态
        `/comic/projects/${encodeURIComponent(id)}/storyboard`, // 项目下的分镜子资源
        { method: 'POST', body: payload }, // 写操作：整稿覆盖提交，confirm 决定是否推进项目状态
      ); // 请求调用结束
    }, // saveStoryboard 结束
    addCharacter( // 新增角色
      id: string, // 项目 id
      payload: { name: string; appearance_prompt: string; seed?: number; voice_profile?: string }, // 角色必填外观提示；种子与音色可选
    ) { // 形参定义结束
      return request<{ character: ComicCharacter; created: boolean }>( // created 区分新建与复用同名角色
        `/comic/projects/${encodeURIComponent(id)}/characters`, // 项目下的角色集合
        { method: 'POST', body: payload }, // 写操作
      ); // 请求调用结束
    }, // addCharacter 结束
    suggest(id: string, kind: SuggestKind, prompt?: string) { // 请求 AI 生成建议
      return request<{ suggestion: Suggestion }>( // 返回建议包装
        `/comic/projects/${encodeURIComponent(id)}/suggest`, // 建议接口挂在项目下，便于带上项目上下文
        { method: 'POST', body: { kind, prompt: prompt?.trim() || undefined, count: 3 } }, // 提示词去空白，空串转 undefined 避免传空字段；固定取 3 条候选
      ); // 请求调用结束
    }, // suggest 结束
    listJobs(projectId: string) { // 列出项目下的生成任务
      return request<{ items: GenerationJob[] }>( // 任务数组包装
        `/comic/projects/${encodeURIComponent(projectId)}/jobs`, // 项目下的任务集合
        { idempotency: false }, // 只读 GET
      ); // 请求调用结束
    }, // listJobs 结束
    createJob( // 创建生成任务（入队）
      projectId: string, // 项目 id
      payload: { // 任务参数
        job_type: JobType; // 任务类型
        storyboard_id?: string; // 关联分镜稿
        payload?: Record<string, unknown>; // 任务自定义入参
        cost_estimate_minor?: number; // 预估费用，服务端可据此做额度校验
      }, // 任务参数结束
    ) { // 形参定义结束
      return request<{ job: GenerationJob; project_status: string }>( // 返回新任务与项目新状态
        `/comic/projects/${encodeURIComponent(projectId)}/jobs`, // 项目下的任务集合
        { method: 'POST', body: payload }, // 写操作：自动带幂等键防止重复扣费
      ); // 请求调用结束
    }, // createJob 结束
    getJob(id: string) { // 查询单个任务
      return request<{ job: GenerationJob }>(`/comic/jobs/${encodeURIComponent(id)}`, { // 任务详情
        idempotency: false, // 只读 GET
      }); // 请求调用结束
    }, // getJob 结束
    jobAction( // 推进任务状态
      id: string, // 任务 id
      action: 'start' | 'complete' | 'fail' | 'cancel' | 'retry', // 状态机动作
      body?: Record<string, unknown>, // 动作附加参数（如失败原因）
    ) { // 形参定义结束
      return request<{ job: GenerationJob }>(`/comic/jobs/${encodeURIComponent(id)}/${action}`, { // 动作作为路径段，符合 REST 风格
        method: 'POST', // 状态迁移属写操作
        body: body ?? {}, // 无附加参数时传空对象，保证头部与幂等键生效
      }); // 请求调用结束
    }, // jobAction 结束
    listFilms(projectId: string) { // 列出项目成片
      return request<{ items: Film[] }>(`/comic/projects/${encodeURIComponent(projectId)}/films`, { // 项目下的成片集合
        idempotency: false, // 只读 GET
      }); // 请求调用结束
    }, // listFilms 结束
    createFilm( // 新建成片（可同时登记首版产物）
      projectId: string, // 项目 id
      payload: { title: string; object_key?: string; duration_sec?: number; size_bytes?: number }, // 标题必填，产物元信息可选
    ) { // 形参定义结束
      return request<{ film: Film; version: FilmVersion }>( // 返回成片与生成的版本
        `/comic/projects/${encodeURIComponent(projectId)}/films`, // 项目下的成片集合
        { method: 'POST', body: payload }, // 写操作
      ); // 请求调用结束
    }, // createFilm 结束
    getFilm(id: string) { // 成片详情：含全部版本
      return request<{ film: Film; versions: FilmVersion[] }>( // 成片与版本列表
        `/comic/films/${encodeURIComponent(id)}`, // 成片资源
        { idempotency: false }, // 只读 GET
      ); // 请求调用结束
    }, // getFilm 结束
    publishFilm(id: string, action: 'submit-review' | 'publish' | 'archive') { // 发布流程动作
      return request<{ film: Film }>(`/comic/films/${encodeURIComponent(id)}/${action}`, { // 动作作为路径段
        method: 'POST', // 状态迁移属写操作
        body: {}, // 显式空体，保证头部与幂等键生效
      }); // 请求调用结束
    }, // publishFilm 结束
    rejectFilm(id: string, reason: string) { // 驳回成片并给出原因
      return request<{ film: Film }>(`/comic/films/${encodeURIComponent(id)}/reject`, { // 驳回子资源
        method: 'POST', // 写操作
        body: { reason }, // 原因必传，供作者修改
      }); // 请求调用结束
    }, // rejectFilm 结束
    exportFilm( // 导出成片：按格式/分辨率换取一次性预签名下载地址
      id: string, // 成片 id
      payload: { format?: FilmExportFormat; resolution?: FilmExportResolution } = {}, // 省略时走服务端默认 mp4 + 1080p（原片直下）
    ) { // 形参定义结束
      return request<FilmExportResult>(`/comic/films/${encodeURIComponent(id)}/export`, { // 导出子资源
        method: 'POST', // 写操作（会签发新的下载凭证）
        body: payload, // 空对象也显式带上，保证 Content-Type 与幂等键生效
      }); // 请求调用结束
    }, // exportFilm 结束
  }, // comic 分组结束

  // ---------- 对象存储（media）：object_key 一律由服务端生成，客户端不拼接 ----------

  media: { // 对象存储相关接口
    /** POST /media/presign/upload → 201；服务端校验 asset_type/mime 并生成 object_key */
    presignUpload(input: { // 申请上传预签名地址
      asset_type: AssetType; // 产物类型，服务端据此校验 mime 合法性
      mime: string; // 文件 MIME，需与产物类型匹配
      project_id?: string; // 归属项目，可为空
      size_bytes?: number; // 文件大小，服务端用于额度与上限校验
      expires_seconds?: number; // 期望签名有效期
    }) { // 形参定义结束
      return request<{ // 上传凭证响应
        upload: PresignedUrl; // 直传地址与必需请求头
        object_key: string; // 服务端生成的对象键，后续接口都用它引用
        asset_type: AssetType; // 回显产物类型
        expires_at: string; // 签名过期时间
      }>('/media/presign/upload', { method: 'POST', body: input }); // 写操作：由服务端签发凭证，客户端无法自行构造
    }, // presignUpload 结束
    /** GET /media/presign/download?object_key=…（服务端为 GET，非 POST） */
    presignDownload(objectKey: string, expiresSeconds?: number) { // 申请下载预签名地址
      const qs = new URLSearchParams({ object_key: objectKey }); // 用 URLSearchParams 自动编码对象键（含斜杠等特殊字符）
      if (expiresSeconds !== undefined) qs.set('expires_seconds', String(expiresSeconds)); // 仅在显式传入时附加，避免覆盖服务端默认有效期
      return request<{ download: PresignedUrl; object_key: string; expires_at: string }>( // 下载凭证响应
        `/media/presign/download?${qs.toString()}`, // 查询串拼接在路径上，参数已被安全编码
      ); // 请求调用结束
    }, // presignDownload 结束
    /** GET /media/assets?project_id=… → { items }，每项已附 download_url */
    listAssets(projectId: string, opts: { asset_type?: AssetType; limit?: number } = {}) { // 列出项目产物，可选类型与条数过滤
      const qs = new URLSearchParams({ project_id: projectId }); // project_id 为必填过滤条件
      if (opts.asset_type) qs.set('asset_type', opts.asset_type); // 有类型才附加，保持查询串精简
      if (opts.limit !== undefined) qs.set('limit', String(opts.limit)); // 分页条数需转字符串，0 也要保留
      return request<{ items: ListedAsset[] }>(`/media/assets?${qs.toString()}`); // 返回带 download_url 的产物列表
    }, // listAssets 结束
    /** GET /media/thumb?object_key=…&size=…：带 Bearer 拉取 WebP 缩略图二进制，供产物列表内联预览；失败由调用方回退原图 */
    async thumbBlob(objectKey: string, size = 240): Promise<Blob> {
      // 查询串：对象键必填，边长限制在后端 32~512 区间内
      const qs = new URLSearchParams({ object_key: objectKey, size: String(size) });
      // 缩略图走鉴权端点（非预签名免鉴权），需手动注入 Bearer；统一 request 强制 text()+JSON 解析，不适配二进制，故独立 fetch
      const headers: Record<string, string> = {};
      if (current) headers.Authorization = `Bearer ${current.access_token}`; // 有会话才带令牌，避免 Bearer undefined
      const res = await fetch(`${BASE}/media/thumb?${qs.toString()}`, { headers }); // GET 缩略图端点
      // 非 2xx：读 JSON 信封抛结构化错误，与列表/下载错误口径一致；缩略图失败由视图回退原图，不阻断列表
      if (!res.ok) {
        const text = await res.text(); // 读取错误正文
        let payload: unknown = null; // 可变变量 payload：运行过程中会被重新赋值
        if (text) { try { payload = JSON.parse(text); } catch { payload = null; } } // 非 JSON 按空兜底
        const body = (payload ?? {}) as { code?: string; message?: string; request_id?: string; details?: unknown }; // 常量 body：保存固定配置或一次性派生值
        throw new ApiError( // 抛出错误：中断当前流程并向上层传递
          body.code ?? 'INTERNAL_ERROR', // 业务错误码兜底
          body.message ?? res.statusText, // 错误文案兜底
          res.status, // HTTP 状态码
          body.details, // 详情原样透出
          body.request_id, // 请求 ID 追踪
        ); // 执行当前业务步骤
      } // 代码块结束
      return res.blob(); // 返回 WebP 二进制，由调用方生成 BlobURL 喂给 <img>
    }, // thumbBlob 结束
  }, // media 分组结束

  // ---------- AI 编排控制面（ai-orchestrator） ----------

  ai: { // AI 控制面：能力查询与任务触发
    /** GET /ai/capabilities：provider 能力、成本限额、存储与 worker 状态 */
    capabilities() { // 查询当前 AI 能力
      return request<{ ai: AiCapabilities; storage: { driver: string; configured: boolean } | null }>( // storage 独立返回，未配置时为 null
        '/ai/capabilities', // 能力自述接口
      ); // 请求调用结束
    }, // capabilities 结束
    /** POST /ai/jobs/:id/run：同步触发 queued 任务执行（幂等；非 queued 返回 409） */
    runJob(jobId: string) { // 手动触发任务执行（worker 关闭时使用）
      return request<{ run: RunJobResult; job: GenerationJob }>( // 同时返回执行结果与最新任务状态
        `/ai/jobs/${encodeURIComponent(jobId)}/run`, // 任务 id 编码后作为路径段
        { method: 'POST', body: {} }, // 写操作；空体保证头部与幂等键生效，重复触发由服务端 409 拦截
      ); // 请求调用结束
    }, // runJob 结束
  }, // ai 分组结束
  im: { // IM 即时通讯：会话 / 消息 / 用户搜索（需登录）
    /** GET /im/conversations：当前用户的会话列表 */
    listConversations() { // 拉取会话列表，含最后消息与未读数
      return request<{ items: ImConversation[] }>('/im/conversations', { auth: true, idempotency: false }); // 需鉴权，只读无需幂等键
    }, // listConversations 结束
    /** POST /im/conversations：创建会话（direct 或 group） */
    createConversation(body: { type: ImConversationType; target_user_id?: string; name?: string; member_user_ids?: string[] }) {
      return request<{ conversation_id: string; conversation: ImConversation }>('/im/conversations', { method: 'POST', body, auth: true }); // 写操作由 request 自动生成幂等键
    }, // createConversation 结束
    /** GET /im/conversations/:id/messages：分页拉取历史消息（before 向前翻页；around 定位到指定消息附近） */
    listMessages(conversationId: string, opts: { before?: string; around?: string; limit?: number } = {}) {
      const qs = new URLSearchParams(); // 安全拼接查询串
      if (opts.before) qs.set('before', opts.before); // 游标：取比该 ID 更早的消息
      if (opts.around) qs.set('around', opts.around); // 定位：取该消息前后各半页（搜索结果跳转用）
      if (opts.limit) qs.set('limit', String(opts.limit)); // 条数限制
      const suffix = qs.toString(); // 无参数时空串
      return request<{ items: ImMessage[] }>(`/im/conversations/${encodeURIComponent(conversationId)}/messages${suffix ? `?${suffix}` : ''}`, { auth: true, idempotency: false }); // 返回当前函数的处理结果
    }, // listMessages 结束
    /** POST /im/conversations/:id/messages：HTTP 方式发消息（兜底；实时通道走 WebSocket） */
    sendMessage(conversationId: string, body: { content_type: ImMessageContentType; content?: string; object_key?: string; object_mime?: string; object_name?: string; object_size?: number; reply_to_id?: string }) {
      return request<{ message: ImMessage }>(`/im/conversations/${encodeURIComponent(conversationId)}/messages`, { method: 'POST', body, auth: true }); // 写操作由 request 自动生成幂等键
    }, // sendMessage 结束
    /** POST /im/conversations/:id/read：标记已读到指定消息 */
    markRead(conversationId: string, messageId: string) {
      return request<{ ok: boolean }>(`/im/conversations/${encodeURIComponent(conversationId)}/read`, { method: 'POST', body: { message_id: messageId }, auth: true, idempotency: false }); // 返回当前函数的处理结果
    }, // markRead 结束
    /** GET /im/users?q=：搜索用户（创建会话时选人） */
    searchUsers(q: string, limit = 20) {
      const suffix = new URLSearchParams({ q, limit: String(limit) }).toString(); // 拼接查询串
      return request<{ items: ImUser[] }>(`/im/users?${suffix}`, { auth: true, idempotency: false }); // 返回当前函数的处理结果
    }, // searchUsers 结束
    /** GET /im/conversations/:id：会话详情 + 成员列表 */
    getConversation(conversationId: string) {
      return request<{ conversation: { id: string; type: ImConversationType; title: string; owner_user_id: string | null }; members: ImMember[] }>( // 返回当前函数的处理结果
        `/im/conversations/${encodeURIComponent(conversationId)}`, // 会话 ID 编码
        { auth: true, idempotency: false }, // 只读
      ); // 请求结束
    }, // getConversation 结束
    /** PATCH /im/conversations/:id：群改名（仅群主/管理员） */
    renameConversation(conversationId: string, title: string) {
      return request<{ ok: boolean; title: string }>(`/im/conversations/${encodeURIComponent(conversationId)}`, { // 返回当前函数的处理结果
        method: 'PATCH', // 局部更新
        body: { title }, // 新群名
        auth: true, // 需登录
      }); // 请求结束
    }, // renameConversation 结束
    /** GET /im/conversations/:id/members：群成员列表 */
    listMembers(conversationId: string) {
      return request<{ items: ImMember[] }>(`/im/conversations/${encodeURIComponent(conversationId)}/members`, { auth: true, idempotency: false }); // 返回当前函数的处理结果
    }, // listMembers 结束
    /** POST /im/conversations/:id/members：邀请入群 */
    addMembers(conversationId: string, userIds: string[]) {
      return request<{ ok: boolean; added: number }>(`/im/conversations/${encodeURIComponent(conversationId)}/members`, { // 返回当前函数的处理结果
        method: 'POST', // 新增
        body: { user_ids: userIds }, // 待邀请用户
        auth: true, // 需登录
      }); // 请求结束
    }, // addMembers 结束
    /** DELETE /im/conversations/:id/members/:userId：退群或踢人 */
    removeMember(conversationId: string, userId: string) {
      return request<{ ok: boolean }>(`/im/conversations/${encodeURIComponent(conversationId)}/members/${encodeURIComponent(userId)}`, { // 返回当前函数的处理结果
        method: 'DELETE', // 移除成员
        auth: true, // 需登录
      }); // 请求结束
    }, // removeMember 结束
    /** PATCH /im/conversations/:id/members/:userId：设 / 撤管理员（仅群主） */
    setMemberRole(conversationId: string, userId: string, role: 'admin' | 'member') {
      return request<{ ok: boolean; role: 'admin' | 'member' }>( // 返回当前函数的处理结果
        `/im/conversations/${encodeURIComponent(conversationId)}/members/${encodeURIComponent(userId)}`, // 成员端点
        { method: 'PATCH', body: { role }, auth: true }, // 局部更新角色
      ); // 请求结束
    }, // setMemberRole 结束
    /** POST /im/conversations/:id/transfer：转让群主（仅群主） */
    transferOwnership(conversationId: string, userId: string) {
      return request<{ ok: boolean; owner_user_id: string }>(`/im/conversations/${encodeURIComponent(conversationId)}/transfer`, { // 返回当前函数的处理结果
        method: 'POST', // 转让动作
        body: { user_id: userId }, // 接任者
        auth: true, // 需登录
      }); // 请求结束
    }, // transferOwnership 结束
    /** PATCH /im/conversations/:id/preferences：置顶 / 免打扰 */
    setPreference(conversationId: string, patch: { pinned?: boolean; muted?: boolean }) {
      return request<{ ok: boolean }>(`/im/conversations/${encodeURIComponent(conversationId)}/preferences`, { // 返回当前函数的处理结果
        method: 'PATCH', // 局部更新
        body: patch, // 开关
        auth: true, // 需登录
      }); // 请求结束
    }, // setPreference 结束
    /** DELETE /im/conversations/:id：删除会话（群主解散 / 成员退群 / 私聊移除自己） */
    deleteConversation(conversationId: string) {
      return request<{ ok: boolean; result: 'dissolved' | 'left' }>(`/im/conversations/${encodeURIComponent(conversationId)}`, { // 返回当前函数的处理结果
        method: 'DELETE', // 删除
        auth: true, // 需登录
      }); // 请求结束
    }, // deleteConversation 结束
    /** GET /im/conversations/:id/messages/search?q=：会话内消息搜索 */
    searchMessages(conversationId: string, q: string, limit = 30) {
      const suffix = new URLSearchParams({ q, limit: String(limit) }).toString(); // 查询串
      return request<{ items: ImMessage[] }>(`/im/conversations/${encodeURIComponent(conversationId)}/messages/search?${suffix}`, { // 返回当前函数的处理结果
        auth: true, // 需登录
        idempotency: false, // 只读
      }); // 请求结束
    }, // searchMessages 结束
    /** POST /im/conversations/:id/messages/:messageId/recall：撤回消息（2 分钟内，仅本人） */
    recallMessage(conversationId: string, messageId: string) {
      return request<{ ok: boolean }>( // 返回当前函数的处理结果
        `/im/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/recall`, // 消息撤回端点
        { method: 'POST', body: {}, auth: true }, // 写操作
      ); // 请求结束
    }, // recallMessage 结束
  }, // im 分组结束

  // ---------- 统一入口配置清单（entries / sites）----------

  // 统一入口配置清单：45 个去重入口 / 19 业务域 / 职责边界 / 关联区分 / 可配置占位标识，全部只读公开。
  entries: {
    overview() { // 清单总览：规模、去重整理口径与占位配置统计
      return request<EntryOverview>('/entries/overview', { auth: false, idempotency: false }); // 公开只读
    }, // overview 结束
    domains() { // 19 个业务域及其入口数
      return request<{ total: number; domains: EntryDomain[] }>('/entries/domains', { auth: false, idempotency: false }); // 公开只读
    }, // domains 结束
    list(opts: { q?: string; domain?: string } = {}) { // 入口清单，支持关键词与业务域过滤
      const qs = new URLSearchParams(); // 安全拼接查询串
      if (opts.q) qs.set('q', opts.q); // 关键词：占位键 / 系统名 / 备注原文 / 职责字段
      if (opts.domain) qs.set('domain', opts.domain); // 业务域编码
      const suffix = qs.toString(); // 无参数时空串
      return request<{ schema: string; domains: EntryDomain[]; total: number; entries: EntryModule[] }>( // 返回当前函数的处理结果
        `/entries${suffix ? `?${suffix}` : ''}`, // 参数经 URLSearchParams 编码，防注入
        { auth: false, idempotency: false }, // 公开只读
      ); // 请求结束
    }, // list 结束
    detail(entryKey: string) { // 单入口详情：关联解析 + 运行时能力点
      return request<{ entry: EntryModule; hostConfig: Record<string, unknown>; capabilities: SiteCapability[] }>( // 返回当前函数的处理结果
        `/entries/${encodeURIComponent(entryKey)}`, // 占位键编码；公开只读
        { auth: false, idempotency: false }, // 公开只读
      ); // 请求结束
    }, // detail 结束
    placeholders() { // 46 个占位标识及其配置状态
      return request<{ total: number; configured: number; items: Array<{ entryKey: string; placeholder: string; envKey: string; configured: boolean; kind: string; system: string }> }>( // 返回当前函数的处理结果
        '/entries/placeholders', { auth: false, idempotency: false }, // 公开只读
      ); // 请求结束
    }, // placeholders 结束
    config() { // 可配置占位标识模板（值恒为空，不回传具体主机值）
      return request<{ schema: string; template: string; format: string; envPrefix: string; rule: string; resolutionOfMissing: string; hosts: Record<string, string> }>( // 返回当前函数的处理结果
        '/entries/config', { auth: false, idempotency: false }, // 公开只读
      ); // 请求结束
    }, // config 结束
  }, // entries 分组结束

  // 站点模块运行时：入口占位键下的能力点与业务条目，写操作需登录。
  sites: { // 浏览类端点公开，写操作需登录（由 request 自动带 Bearer 与幂等键）
    overview() { // 全站汇总：入口 / 能力 / 业务域 / 占位状态 / 条目与状态分布
      return request<SiteOverview>('/sites/overview', { auth: false, idempotency: false }); // 公开只读
    }, // overview 结束
    list(opts: { q?: string; group?: string; domain?: string } = {}) { // 入口列表，支持关键词与业务域过滤
      const qs = new URLSearchParams(); // 安全拼接查询串
      if (opts.q) qs.set('q', opts.q); // 关键词：占位键 / 系统名 / 备注原文 / 职责字段
      if (opts.domain) qs.set('domain', opts.domain); // 业务域编码（新口径）
      else if (opts.group) qs.set('domain', opts.group); // 兼容旧调用：group 值按业务域处理
      const suffix = qs.toString(); // 无参数时空串
      return request<{ domains: EntryDomain[]; groups: SiteGroup[]; total: number; modules: SiteModuleSummary[] }>( // 返回当前函数的处理结果
        `/sites${suffix ? `?${suffix}` : ''}`, // 参数经 URLSearchParams 编码，防注入
        { auth: false, idempotency: false }, // 公开只读
      ); // 请求结束
    }, // list 结束
    detail(host: string) { // 单模块详情：备注原文、行号、能力点与条目统计
      return request<{ // 返回当前函数的处理结果
        module: SiteModuleDetail; // 完整模块定义
        capability_kinds: Record<string, { name: string; states: string[]; description: string }>; // 能力状态机字典
        stats: { total: number; byCapability: Record<string, number>; byStatus: Record<string, number> }; // 条目统计
      }>(`/sites/${encodeURIComponent(host)}`, { auth: false, idempotency: false }); // 主机记录编码；公开只读
    }, // detail 结束
    listItems(host: string, opts: { capability?: string; status?: string } = {}) { // 业务条目列表
      const qs = new URLSearchParams(); // 安全拼接查询串
      if (opts.capability) qs.set('capability', opts.capability); // 按能力过滤
      if (opts.status) qs.set('status', opts.status); // 按状态过滤
      const suffix = qs.toString(); // 无参数时空串
      return request<{ host: string; items: SiteItem[]; total: number }>( // 返回当前函数的处理结果
        `/sites/${encodeURIComponent(host)}/items${suffix ? `?${suffix}` : ''}`, // 路径参数编码
        { auth: false, idempotency: false }, // 公开只读：浏览匿名可访问
      ); // 请求结束
    }, // listItems 结束
    createItem(host: string, payload: { capability: string; title: string; detail?: string; status?: string }) { // 新建业务条目
      return request<{ item: SiteItem }>(`/sites/${encodeURIComponent(host)}/items`, { // 写操作：自动带幂等键防重复提交
        method: 'POST', // 新建语义
        body: payload, // 标题必填，状态省略时由后端取能力默认态
      }); // 请求结束
    }, // createItem 结束
    transitionItem(host: string, id: string, status: string) { // 推进条目状态
      return request<{ item: SiteItem }>(`/sites/${encodeURIComponent(host)}/items/${encodeURIComponent(id)}/transition`, { // 写操作：自动带幂等键
        method: 'POST', // 状态迁移语义
        body: { status }, // 目标状态，后端按能力 states 校验
      }); // 请求结束
    }, // transitionItem 结束
  }, // sites 分组结束

  // ---------- 部署汇总（deployments）：统一字段的部署仓库 / 部署项 / 状态 / 结果 / 异常，全公开只读 ----------

  deployments: { // 部署汇总：三个端点均匿名可访问，不提供写操作
    overview() { // 全量汇总：状态 / 结果 / 层级 / 平台 / 严重度分布 + 覆盖口径 + 字典
      return request<DeploymentOverview>('/deployments/overview', { auth: false, idempotency: false }); // 公开只读
    }, // overview 结束
    list(opts: { q?: string; layer?: string; status?: string; verdict?: string; platform_id?: string } = {}) { // 清单，支持五类过滤
      const qs = new URLSearchParams(); // 安全拼接查询串
      if (opts.q) qs.set('q', opts.q); // 关键词：id / 名称 / 别名 / 仓库标识 / 入口
      if (opts.layer) qs.set('layer', opts.layer); // 层级
      if (opts.status) qs.set('status', opts.status); // 部署状态
      if (opts.verdict) qs.set('verdict', opts.verdict); // 结果（EMPTY 命中空数据项）
      if (opts.platform_id) qs.set('platform_id', opts.platform_id); // 平台编码
      const suffix = qs.toString(); // 无参数时空串
      return request<{ // 返回当前函数的处理结果
        schema: string; // 契约版本
        captured_at: string; // 取证时间
        filters: Record<string, string>; // 过滤条件回显
        total: number; // 过滤后条数
        registry_total: number; // 注册表总数（区分「无命中」与「无数据」）
        items: DeploymentItem[]; // 部署项清单
        status_codes: Record<string, string>; // 状态字典
        verdict_codes: Record<string, string>; // 结果字典
        severity_codes: Record<string, string>; // 严重度字典
      }>(`/deployments${suffix ? `?${suffix}` : ''}`, { auth: false, idempotency: false }); // 公开只读
    }, // list 结束
    detail(id: string) { // 单项详情：仓库标识、交付链路、结果、异常、缺失信息、同类项
      return request<{ // 返回当前函数的处理结果
        schema: string; // 契约版本
        item: DeploymentItem; // 完整部署项
        related: Array<{ id: string; name: string; layer: string }>; // 同平台同类项
        status_codes: Record<string, string>; // 状态字典
        verdict_codes: Record<string, string>; // 结果字典
        severity_codes: Record<string, string>; // 严重度字典
      }>(`/deployments/${encodeURIComponent(id)}`, { auth: false, idempotency: false }); // 路径参数编码
    }, // detail 结束
  }, // deployments 分组结束

  // ---------- 导航站（navigation）：链接目录 / 三态可达性 / 推荐位，浏览公开、写与探测需登录 ----------

  navigation: { // 全站资源导航站：路径 /navigation
    summary() { // 目录汇总：三态计数、分组计数、最近探测时间
      return request<{ schema: string; summary: NavSummary }>('/navigation/summary', { auth: false, idempotency: false }); // 公开只读
    }, // summary 结束
    links(opts: { q?: string; group?: string; status?: string; recommended?: boolean } = {}) { // 链接目录，支持四类过滤
      const qs = new URLSearchParams(); // 安全拼接查询串
      if (opts.q) qs.set('q', opts.q); // 关键词：名称 / 地址 / 说明
      if (opts.group) qs.set('group', opts.group); // 分组
      if (opts.status) qs.set('status', opts.status); // 三态
      if (opts.recommended) qs.set('recommended', '1'); // 只看推荐位
      const suffix = qs.toString(); // 无参数时空串
      return request<{ schema: string; total: number; items: NavLink[]; summary: NavSummary }>(`/navigation/links${suffix ? `?${suffix}` : ''}`, { auth: false, idempotency: false }); // 公开只读
    }, // links 结束
    create(payload: { name: string; url: string; group?: string; description?: string; recommended?: boolean }) { // 收录一条入口
      return request<{ item: NavLink }>('/navigation/links', { method: 'POST', body: payload }); // 写操作：自动带幂等键
    }, // create 结束
    update(id: string, payload: { name?: string; url?: string; group?: string; description?: string; recommended?: boolean }) { // 改名 / 分组 / 说明 / 推荐位 / 地址
      return request<{ item: NavLink }>(`/navigation/links/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload }); // 写操作：自动带幂等键
    }, // update 结束
    check(id: string) { // 单条可达性探测
      return request<{ item: NavLink }>(`/navigation/links/${encodeURIComponent(id)}/check`, { method: 'POST', body: {} }); // 服务端探测并回写状态
    }, // check 结束
    checkAll() { // 全目录可达性探测
      return request<{ schema: string; checked: number; items: NavLink[]; summary: NavSummary }>('/navigation/check', { method: 'POST', body: {} }); // 逐条串行探测
    }, // checkAll 结束
  }, // navigation 分组结束

  // ---------- 社区与变现（community）：论坛 / 付费阅读 / VIP / 钱包 / 独立商城 / 推广 ----------

  community: { // 社区论坛与知识付费
    overview() { // 首页聚合：板块、统计、当前钱包与会员
      return request<{ boards: CommunityBoard[]; stats: { threads: number; views: number; likes: number }; wallet: WalletSnapshot; vip_level: number; vip: { plan_id: string; level: number; expires_at: string } | null }>('/community/overview', { idempotency: false }); // 返回当前函数的处理结果
    }, // 代码块结束
    threads(opts: { board?: string; kind?: string; sort?: 'latest' | 'hot' | 'views' | 'replies' | 'favorites' | 'rating' | 'recommend'; q?: string; limit?: number } = {}) { // 帖子列表
      const qs = new URLSearchParams(); // 常量 qs：保存固定配置或一次性派生值
      if (opts.board && opts.board !== 'all') qs.set('board', opts.board); // 条件分支：按判断结果选择后续处理路径
      if (opts.kind && opts.kind !== 'all') qs.set('kind', opts.kind); // 条件分支：按判断结果选择后续处理路径
      if (opts.sort) qs.set('sort', opts.sort); // 条件分支：按判断结果选择后续处理路径
      if (opts.q) qs.set('q', opts.q); // 条件分支：按判断结果选择后续处理路径
      if (opts.limit) qs.set('limit', String(opts.limit)); // 条件分支：按判断结果选择后续处理路径
      const suffix = qs.toString(); // 常量 suffix：保存固定配置或一次性派生值
      return request<{ items: CommunityThread[]; total: number; sort: string; vip_level: number }>(`/community/threads${suffix ? `?${suffix}` : ''}`, { idempotency: false }); // 返回当前函数的处理结果
    }, // 代码块结束
    thread(id: string) { // 帖子详情
      return request<{ thread: CommunityThreadDetail; posts: CommunityPost[]; liked: boolean; unlocked: boolean; favorited: boolean }>(`/community/threads/${encodeURIComponent(id)}`, { idempotency: false }); // 返回当前函数的处理结果
    }, // 代码块结束
    createThread(payload: { board_slug: string; title: string; summary?: string; body: string; kind?: string; cover_url?: string; price_cents?: number; media?: CommunityThreadMedia[]; poll_options?: string[]; episodes?: Array<{ title: string; media_url: string; poster_url?: string }> }) { // 发帖
      return request<{ thread_id: string }>('/community/threads', { method: 'POST', body: payload }); // 返回当前函数的处理结果
    }, // 代码块结束
    unlock(id: string) { // 解锁付费帖
      return request<{ unlocked: boolean; charged_cents: number; via?: string }>(`/community/threads/${encodeURIComponent(id)}/unlock`, { method: 'POST', body: {} }); // 返回当前函数的处理结果
    }, // 代码块结束
    reply(id: string, content: string) { // 回复
      return request<{ ok: boolean }>(`/community/threads/${encodeURIComponent(id)}/reply`, { method: 'POST', body: { content } }); // 返回当前函数的处理结果
    }, // 代码块结束
    like(id: string) { // 点赞开关
      return request<{ liked: boolean }>(`/community/threads/${encodeURIComponent(id)}/like`, { method: 'POST', body: {} }); // 返回当前函数的处理结果
    }, // 代码块结束
    favorite(id: string) { // 收藏开关
      return request<{ favorited: boolean }>(`/community/threads/${encodeURIComponent(id)}/favorite`, { method: 'POST', body: {} }); // 返回当前函数的处理结果
    }, // 代码块结束
    rate(id: string, rating: number) { // 评分 1–5 星
      return request<{ ok: boolean; summary: { avg: number | null; count: number } }>(`/community/threads/${encodeURIComponent(id)}/rate`, { method: 'POST', body: { rating } }); // 返回当前函数的处理结果
    }, // 代码块结束
    vote(id: string, optionId: string) { // 投票
      return request<{ ok: boolean }>(`/community/threads/${encodeURIComponent(id)}/vote`, { method: 'POST', body: { option_id: optionId } }); // 返回当前函数的处理结果
    }, // 代码块结束
    joinBoard(slug: string) { // 加入付费板块
      return request<{ joined: boolean; charged_cents: number; via?: string }>(`/community/boards/${encodeURIComponent(slug)}/join`, { method: 'POST', body: {} }); // 返回当前函数的处理结果
    }, // 代码块结束
    followBoard(slug: string) { // 关注 / 取消关注板块
      return request<{ followed: boolean }>(`/community/boards/${encodeURIComponent(slug)}/follow`, { method: 'POST', body: {} }); // 返回当前函数的处理结果
    }, // 代码块结束
    createBoard(payload: { slug: string; name: string; description?: string; icon?: string; price_cents?: number; visibility?: 'public' | 'followers'; post_min_level?: number }) { // 创建板块
      return request<{ ok: boolean; slug: string }>('/community/boards', { method: 'POST', body: payload }); // 返回当前函数的处理结果
    }, // 代码块结束
    acceptPost(threadId: string, postId: string) { // 问答采纳
      return request<{ ok: boolean; accepted_post_id: string }>(`/community/threads/${encodeURIComponent(threadId)}/accept`, { method: 'POST', body: { post_id: postId } }); // 返回当前函数的处理结果
    }, // 代码块结束
    deleteThread(threadId: string) { // 作者 / 版主软删
      return request<{ ok: boolean }>(`/community/threads/${encodeURIComponent(threadId)}`, { method: 'DELETE' }); // 返回当前函数的处理结果
    }, // 代码块结束
    favorites() { // 我的收藏
      return request<{ items: CommunityThread[] }>('/community/favorites', { idempotency: false }); // 返回当前函数的处理结果
    }, // 代码块结束
    homeSetting() { // 论坛设为首页开关（公开；404 / 异常由前端回落现状门户）
      return request<{ home: 'community' | 'portal' }>('/community/home-setting', { auth: false, idempotency: false }); // 返回当前函数的处理结果
    }, // 代码块结束
    boardTabs(slug: string) { // 板块 Tab 栏目配置（公开；接口缺失时前端回落内置默认 Tab）
      return request<{ tabs: BoardTab[] }>(`/community/boards/${encodeURIComponent(slug)}/tabs`, { auth: false, idempotency: false }); // 返回当前函数的处理结果
    }, // 代码块结束
    saveBoardTabs(slug: string, tabs: BoardTabInput[]) { // 版主 / 运营保存栏目组合（顺序 / 显隐 / 排序口径）
      return request<{ ok: boolean; tabs: BoardTab[] }>(`/community/boards/${encodeURIComponent(slug)}/tabs`, { method: 'PUT', body: { tabs } }); // 返回当前函数的处理结果
    }, // 代码块结束
  }, // 代码块结束

  vip: { // 会员
    plans() { // 套餐列表
      return request<{ plans: VipPlan[] }>('/vip/plans', { idempotency: false }); // 返回当前函数的处理结果
    }, // 代码块结束
    subscribe(code: string) { // 开通 / 续费
      return request<{ ok: boolean; level: number; expires_at: string }>('/vip/subscribe', { method: 'POST', body: { code } }); // 返回当前函数的处理结果
    }, // 代码块结束
  }, // 代码块结束

  wallet: { // 钱包
    get() { // 余额 / 积分 / 签到 / 流水
      return request<{ wallet: WalletSnapshot; checked_in_today: boolean; transactions: WalletTransaction[]; vip_level: number }>('/wallet', { idempotency: false }); // 返回当前函数的处理结果
    }, // 代码块结束
    checkin() { // 每日签到
      return request<{ ok: boolean; points: number }>('/wallet/checkin', { method: 'POST', body: {} }); // 返回当前函数的处理结果
    }, // 代码块结束
    redeem(code: string) { // 充值卡兑换
      return request<{ ok: boolean; amount_cents: number }>('/wallet/redeem', { method: 'POST', body: { code } }); // 返回当前函数的处理结果
    }, // 代码块结束
    transferPoints(payload: { to_member_no: string; points: number; note?: string }) { // 积分转给其他用户
      return request<{ ok: boolean; points: number; to: string }>('/wallet/points/transfer', { method: 'POST', body: payload }); // 返回当前函数的处理结果
    }, // 代码块结束
  }, // 代码块结束

  shop: { // 独立商城
    products() { // 商品列表
      return request<{ products: ShopProduct[] }>('/shop/products', { idempotency: false }); // 返回当前函数的处理结果
    }, // 代码块结束
    order(payload: { product_code: string; quantity?: number; coupon_code?: string; shipping?: { name: string; phone: string; address: string } }) { // 下单
      return request<{ order_id: string; payable_cents: number; discount_cents: number; delivery_kind: string }>('/shop/orders', { method: 'POST', body: payload }); // 返回当前函数的处理结果
    }, // 代码块结束
    orders() { // 我的订单
      return request<{ items: ShopOrder[] }>('/shop/orders', { idempotency: false }); // 返回当前函数的处理结果
    }, // 代码块结束
    confirm(id: string) { // 确认收货 / 完成人工发货
      return request<{ ok: boolean }>(`/shop/orders/${encodeURIComponent(id)}/confirm`, { method: 'POST', body: {} }); // 返回当前函数的处理结果
    }, // 代码块结束
    refund(id: string) { // 退款
      return request<{ ok: boolean; refunded_cents: number }>(`/shop/orders/${encodeURIComponent(id)}/refund`, { method: 'POST', body: {} }); // 返回当前函数的处理结果
    }, // 代码块结束
  }, // 代码块结束

  coupon: { // 优惠码
    validate(code: string, amount_cents: number) { // 预校验
      return request<{ valid: boolean; discount_cents: number }>('/coupons/validate', { method: 'POST', body: { code, amount_cents } }); // 返回当前函数的处理结果
    }, // 代码块结束
  }, // 代码块结束

  referral: { // 推广
    get() { // 我的邀请码与佣金
      return request<{ code: string; invited: { count: number; commission: number }; commission_cents: number }>('/referral', { idempotency: false }); // 返回当前函数的处理结果
    }, // 代码块结束
    bind(code: string) { // 绑定邀请码
      return request<{ ok: boolean }>('/referral/bind', { method: 'POST', body: { code } }); // 返回当前函数的处理结果
    }, // 代码块结束
  }, // 代码块结束

  // ---------- 商业化中台（commerce）：资产 / 支付 / 履约 / 资金 / 外观 / 成长 / 国际化 ----------

  commerce: { // 商业化二期：与 services/mim-api 新路由一一对应
    siteConfig() { // 公开站点启动配置（无需会话）；points_deduction 为积分抵扣开关与兑换口径，前端据此决定是否展示抵扣面板
      return request<{ home_view: 'store' | 'community'; theme: ThemeSettings; site: Record<string, unknown>; locales: I18nSettings | Record<string, never>; points_deduction?: PointsDeductionConfig }>('/site/config', { idempotency: false }); // 返回当前函数的处理结果
    }, // 代码块结束
    assets(opts: { kind?: string; q?: string } = {}) { // 资产列表
      const qs = new URLSearchParams(); // 查询串
      if (opts.kind && opts.kind !== 'all') qs.set('kind', opts.kind); // 类型过滤
      if (opts.q) qs.set('q', opts.q); // 关键词
      const suffix = qs.toString(); // 序列化
      return request<{ items: PaidAsset[]; vip_level: number }>(`/assets${suffix ? `?${suffix}` : ''}`, { idempotency: false }); // 返回当前函数的处理结果
    }, // 代码块结束
    asset(code: string) { // 资产详情（未解锁只回试读）
      return request<{ asset: PaidAssetDetail }>(`/assets/${encodeURIComponent(code)}`, { idempotency: false }); // 返回当前函数的处理结果
    }, // 代码块结束
    purchaseAsset(code: string) { // 余额购买
      return request<{ ok: boolean; charged_cents: number; via: string }>(`/assets/${encodeURIComponent(code)}/purchase`, { method: 'POST', body: {} }); // 返回当前函数的处理结果
    }, // 代码块结束
    createAsset(payload: { code: string; kind: PaidAssetKind; title: string; summary: string; body: string; price_cents: number; cover_url?: string; file_url?: string; vip_free?: boolean; media?: Array<{ kind: 'image' | 'video'; url: string; poster_url?: string }> }) { // 作者发布
      return request<{ ok: boolean; code: string }>('/assets', { method: 'POST', body: payload }); // 返回当前函数的处理结果
    }, // 代码块结束
    channels() { // 支付渠道配置状态
      return request<{ channels: PaymentChannel[] }>('/payments/channels', { idempotency: false }); // 返回当前函数的处理结果
    }, // 代码块结束
    orders(opts: { source?: UnifiedOrderSource } = {}) { // 我的统一订单列表（只读）；source 缺省返回三源全部，指定后只回该产线
      const qs = new URLSearchParams(); // 查询串构造器
      if (opts.source) qs.set('source', opts.source); // 产线过滤参数
      const suffix = qs.toString(); // 序列化查询串
      return request<{ items: UnifiedOrder[]; total: number; limit: number }>(`/commerce/orders${suffix ? `?${suffix}` : ''}`, { idempotency: false }); // 只读 GET，无需幂等键
    }, // 代码块结束
    order(id: string) { // 单笔统一订单详情（只读）；跨用户由服务端按 404 处理
      return request<{ order: UnifiedOrder }>(`/commerce/orders/${encodeURIComponent(id)}`, { idempotency: false }); // 只读 GET
    }, // 代码块结束
    orderSummary() { // 我的统一订单汇总（只读）：总数 / 已支付 / 待支付 / 已退款 / 实付合计
      return request<{ summary: UnifiedOrderSummary }>('/commerce/orders/summary', { idempotency: false }); // 只读 GET
    }, // 代码块结束
    createIntent(payload: { purpose: 'shop_order' | 'vip' | 'asset' | 'recharge'; ref_id: string; provider: PaymentProvider; amount_cents?: number }) { // 创建支付意图
      return request<{ intent: PaymentIntent; next: { provider: string; pay_url?: string; qr_text?: string; note?: string } }>('/payments/intents', { method: 'POST', body: payload }); // 返回当前函数的处理结果
    }, // 代码块结束
    getIntent(id: string) { // 查询支付意图状态（仅本人可见）：收银台 / 回跳页轮询使用
      return request<{ intent: PaymentIntent }>(`/payments/intents/${encodeURIComponent(id)}`, { idempotency: false }); // 返回当前函数的处理结果
    }, // 代码块结束
    cancelIntent(id: string) { // 取消未支付
      return request<{ ok: boolean }>(`/payments/intents/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: {} }); // 返回当前函数的处理结果
    }, // 代码块结束
    offlineConfirm(id: string) { // 运营线下确认
      return request<{ ok: boolean; status: string }>(`/payments/intents/${encodeURIComponent(id)}/offline-confirm`, { method: 'POST', body: {} }); // 返回当前函数的处理结果
    }, // 代码块结束
    ship(orderId: string, payload: { carrier: string; tracking_no: string; status?: string; events?: Array<{ text: string }> }) { // 发货
      return request<{ ok: boolean; status: string }>(`/shop/orders/${encodeURIComponent(orderId)}/ship`, { method: 'POST', body: payload }); // 返回当前函数的处理结果
    }, // 代码块结束
    shipment(orderId: string) { // 物流轨迹
      return request<{ shipment: Shipment | null }>(`/shop/orders/${encodeURIComponent(orderId)}/shipment`, { idempotency: false }); // 返回当前函数的处理结果
    }, // 代码块结束
    applyAfterSales(orderId: string, payload: { kind: 'refund' | 'return'; reason: string }) { // 申请售后
      return request<{ ok: boolean; id: string; amount_cents: number }>(`/shop/orders/${encodeURIComponent(orderId)}/after-sales`, { method: 'POST', body: payload }); // 返回当前函数的处理结果
    }, // 代码块结束
    myAfterSales() { // 我的售后
      return request<{ items: AfterSale[] }>('/after-sales/mine', { idempotency: false }); // 返回当前函数的处理结果
    }, // 代码块结束
    reviewAfterSales(id: string, payload: { approve: boolean; note?: string }) { // 运营审核
      return request<{ ok: boolean; status: string }>(`/after-sales/${encodeURIComponent(id)}/review`, { method: 'POST', body: payload }); // 返回当前函数的处理结果
    }, // 代码块结束
    reviewOrder(orderId: string, payload: { rating: number; content: string }) { // 订单评价
      return request<{ ok: boolean }>(`/shop/orders/${encodeURIComponent(orderId)}/review`, { method: 'POST', body: payload }); // 返回当前函数的处理结果
    }, // 代码块结束
    productReviews(code: string) { // 商品评价聚合
      return request<{ summary: { count: number; avg: number }; items: ProductReview[] }>(`/shop/products/${encodeURIComponent(code)}/reviews`, { idempotency: false }); // 返回当前函数的处理结果
    }, // 代码块结束
    withdrawals() { // 我的提现
      return request<{ items: Withdrawal[]; balance_cents: number }>('/wallet/withdrawals', { idempotency: false }); // 返回当前函数的处理结果
    }, // 代码块结束
    applyWithdrawal(payload: { amount_cents: number; channel: 'alipay' | 'wechat' | 'bank'; account: string }) { // 申请提现
      return request<{ ok: boolean; id: string; status: string; amount_cents: number }>('/wallet/withdrawals', { method: 'POST', body: payload }); // 返回当前函数的处理结果
    }, // 代码块结束
    reviewWithdrawal(id: string, payload: { action: 'approve' | 'paid' | 'reject'; note?: string }) { // 运营审核
      return request<{ ok: boolean; status: string }>(`/withdrawals/${encodeURIComponent(id)}/review`, { method: 'POST', body: payload }); // 返回当前函数的处理结果
    }, // 代码块结束
    earnings() { // 创作者收益
      return request<{ items: CreatorEarning[]; summary: { pending: number; settled: number } }>('/earnings', { idempotency: false }); // 返回当前函数的处理结果
    }, // 代码块结束
    settleEarnings() { // 待结算转余额
      return request<{ ok: boolean; settled_cents: number; count: number }>('/earnings/settle', { method: 'POST', body: {} }); // 返回当前函数的处理结果
    }, // 代码块结束
    financeSummary() { // 平台资金汇总
      return request<{ wallets: { users: number; balance: number }; withdrawals: Array<{ status: string; count: number; amount: number }>; earnings: Array<{ status: string; count: number; amount: number }>; orders: { count: number; amount: number } }>('/admin/finance/summary', { idempotency: false }); // 返回当前函数的处理结果
    }, // 代码块结束
    appearance() { // 外观与页面
      return request<{ settings: { theme?: ThemeSettings; locales?: I18nSettings; site?: Record<string, unknown> }; pages: Array<{ page: string; blocks: number }> }>('/appearance', { idempotency: false }); // 返回当前函数的处理结果
    }, // 代码块结束
    updateAppearance(key: 'theme' | 'locales' | 'site' | 'home', value: Record<string, unknown>) { // 更新设置
      return request<{ ok: boolean; key: string }>('/appearance/settings', { method: 'PUT', body: { key, value } }); // 返回当前函数的处理结果
    }, // 代码块结束
    page(page: string) { // 页面区块
      return request<{ page: string; blocks: PageBlock[] }>(`/pages/${encodeURIComponent(page)}`, { idempotency: false }); // 返回当前函数的处理结果
    }, // 代码块结束
    createBlock(page: string, payload: { kind: string; sort_order?: number; config?: Record<string, unknown> }) { // 新建区块
      return request<{ ok: boolean; id: string }>(`/pages/${encodeURIComponent(page)}/blocks`, { method: 'POST', body: payload }); // 返回当前函数的处理结果
    }, // 代码块结束
    updateBlock(page: string, id: string, payload: { config?: Record<string, unknown>; sort_order?: number; enabled?: boolean }) { // 修改区块
      return request<{ ok: boolean }>(`/pages/${encodeURIComponent(page)}/blocks/${encodeURIComponent(id)}`, { method: 'PUT', body: payload }); // 返回当前函数的处理结果
    }, // 代码块结束
    deleteBlock(page: string, id: string) { // 删除区块
      return request<{ ok: boolean }>(`/pages/${encodeURIComponent(page)}/blocks/${encodeURIComponent(id)}`, { method: 'DELETE' }); // 返回当前函数的处理结果
    }, // 代码块结束
    reorderBlocks(page: string, ids: string[]) { // 批量排序
      return request<{ ok: boolean; count: number }>(`/pages/${encodeURIComponent(page)}/reorder`, { method: 'PUT', body: { ids } }); // 返回当前函数的处理结果
    }, // 代码块结束
    growth() { // 我的等级 / 徽章
      return request<GrowthSnapshot>('/me/growth', { idempotency: false }); // 返回当前函数的处理结果
    }, // 代码块结束
    syncGrowth() { // 徽章自动发放
      return request<{ ok: boolean; awarded: string[] }>('/me/growth/sync', { method: 'POST', body: {} }); // 返回当前函数的处理结果
    }, // 代码块结束
    messages(box: 'inbox' | 'sent' = 'inbox') { // 私信
      return request<{ box: string; items: DirectMessage[]; unread: number }>(`/messages?box=${box}`, { idempotency: false }); // 返回当前函数的处理结果
    }, // 代码块结束
    sendMessage(payload: { to_member_no: string; content: string }) { // 发私信
      return request<{ ok: boolean; id: string }>('/messages', { method: 'POST', body: payload }); // 返回当前函数的处理结果
    }, // 代码块结束
    readMessage(id: string) { // 标记已读
      return request<{ ok: boolean }>(`/messages/${encodeURIComponent(id)}/read`, { method: 'POST', body: {} }); // 返回当前函数的处理结果
    }, // 代码块结束
    ip() { // IP 归属地
      return request<{ region_code: string; ip_hash_prefix: string; note: string }>('/me/ip', { idempotency: false }); // 返回当前函数的处理结果
    }, // 代码块结束
    i18nSettings() { // 语言分离配置
      return request<{ settings: I18nSettings; provider_configured: boolean }>('/i18n/settings', { idempotency: false }); // 返回当前函数的处理结果
    }, // 代码块结束
    updateI18n(payload: { front: 'zh-CN' | 'en-US'; admin: 'zh-CN' | 'en-US'; machine_translation: boolean }) { // 更新语言
      return request<{ ok: boolean; settings: I18nSettings }>('/i18n/settings', { method: 'PUT', body: payload }); // 返回当前函数的处理结果
    }, // 代码块结束
    translate(text: string, target: 'zh-CN' | 'en-US') { // 机器翻译
      return request<{ translated_text: string; provider: string; cached: boolean; translated: boolean }>('/i18n/translate', { method: 'POST', body: { text, target } }); // 返回当前函数的处理结果
    }, // 代码块结束
  }, // 代码块结束

  // ---------- 统一搜索（search）：五来源聚合检索，浏览公开 ----------

  search: { // 统一搜索：路径 /search
    summary() { // 各来源可搜文档数与当前引擎
      return request<{ schema: string; total: number; scopes: SearchScopeCount[]; engine: SearchEngine }>('/search/summary', { auth: false, idempotency: false }); // 公开只读
    }, // summary 结束
    query(opts: { q: string; scope?: string; limit?: number }) { // 关键词检索
      const qs = new URLSearchParams(); // 安全拼接查询串
      qs.set('q', opts.q); // 关键词必填
      if (opts.scope && opts.scope !== 'all') qs.set('scope', opts.scope); // 来源过滤
      if (opts.limit) qs.set('limit', String(opts.limit)); // 每来源条数
      return request<SearchResponse>(`/search?${qs.toString()}`, { auth: false, idempotency: false }); // 公开只读
    }, // query 结束
  }, // search 分组结束

  // ---------- 内容运营（content）：公告 / 更新日志 / 推广计划，公开只读；404 或空数组由前端静默隐藏 ----------

  content: { // 内容栏目：路径 /announcements、/changelog、/promotions
    announcements(limit = 10) { // 公告清单：置顶优先，失败由调用方静默隐藏
      return request<{ items: AnnouncementItem[] }>(`/announcements?limit=${limit}`, { auth: false, idempotency: false }); // 返回当前函数的处理结果
    }, // 代码块结束
    changelog(limit = 20) { // 更新日志时间线：按版本 / 发布时间倒序
      return request<{ items: ChangelogItem[] }>(`/changelog?limit=${limit}`, { auth: false, idempotency: false }); // 返回当前函数的处理结果
    }, // 代码块结束
    promotions() { // 推广计划卡片：进行中且在有效期内
      return request<{ items: PromotionItem[] }>('/promotions', { auth: false, idempotency: false }); // 返回当前函数的处理结果
    }, // 代码块结束

    // ===== 管理端 CRUD（复用 /admin/content/* 契约；挂 appearance:write 权限，无权限时前端静默隐藏）=====

    manageAnnouncements() { // 公告管理清单（含草稿 / 归档）
      return request<{ items: AnnouncementItem[] }>('/admin/content/announcements', { idempotency: false });
    },
    createAnnouncement(payload: AnnouncementUpsertPayload) { // 新建公告
      return request<{ item: AnnouncementItem }>('/admin/content/announcements', { method: 'POST', body: payload });
    },
    updateAnnouncement(id: string, payload: Partial<AnnouncementUpsertPayload>) { // 更新公告
      return request<{ item: AnnouncementItem }>(`/admin/content/announcements/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload });
    },
    deleteAnnouncement(id: string) { // 删除公告
      return request<{ ok: boolean }>(`/admin/content/announcements/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },

    manageChangelog() { // 更新日志管理清单（含草稿 / 归档）
      return request<{ items: ChangelogItem[] }>('/admin/content/changelog', { idempotency: false });
    },
    createChangelog(payload: ChangelogUpsertPayload) { // 新建更新日志
      return request<{ item: ChangelogItem }>('/admin/content/changelog', { method: 'POST', body: payload });
    },
    updateChangelog(id: string, payload: Partial<ChangelogUpsertPayload>) { // 更新更新日志
      return request<{ item: ChangelogItem }>(`/admin/content/changelog/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload });
    },
    deleteChangelog(id: string) { // 删除更新日志
      return request<{ ok: boolean }>(`/admin/content/changelog/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },

    managePromotions() { // 推广计划管理清单（含点击 / 转化统计）
      return request<{ items: PromotionItem[] }>('/admin/content/promotions', { idempotency: false });
    },
    createPromotion(payload: PromotionUpsertPayload) { // 新建推广计划
      return request<{ item: PromotionItem }>('/admin/content/promotions', { method: 'POST', body: payload });
    },
    updatePromotion(id: string, payload: Partial<PromotionUpsertPayload>) { // 更新推广计划
      return request<{ item: PromotionItem }>(`/admin/content/promotions/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload });
    },
    deletePromotion(id: string) { // 删除推广计划
      return request<{ ok: boolean }>(`/admin/content/promotions/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
  }, // content 分组结束

  // ---------- 自研工具目录（tools）：公开浏览清单 / 详情；管理端增删改挂权限 ----------

  tools: { // 工具发布页：路径 /tools
    list(opts: { q?: string; tag?: string } = {}) { // 上线清单，支持关键词 / 标签
      const qs = new URLSearchParams(); // 查询串
      if (opts.q) qs.set('q', opts.q); // 关键词
      if (opts.tag) qs.set('tag', opts.tag); // 标签
      const suffix = qs.toString(); // 序列化
      return request<{ items: ToolItem[] }>(`/tools${suffix ? `?${suffix}` : ''}`, { auth: false, idempotency: false });
    },
    detail(slug: string) { // 工具详情（版本记录 / 链接 / 标签）
      return request<{ tool: ToolItem }>(`/tools/${encodeURIComponent(slug)}`, { auth: false, idempotency: false });
    },
    manage() { // 管理端全状态清单（含草稿 / 归档）
      return request<{ items: ToolItem[] }>('/tools/manage', { idempotency: false });
    },
    create(payload: ToolUpsertPayload) { // 新建工具
      return request<{ ok: boolean; tool: ToolItem }>('/tools', { method: 'POST', body: payload });
    },
    update(slug: string, payload: ToolUpsertPayload) { // 更新工具信息 / 版本记录 / 状态
      return request<{ ok: boolean; tool: ToolItem }>(`/tools/${encodeURIComponent(slug)}`, { method: 'PUT', body: payload });
    },
    remove(slug: string) { // 删除工具
      return request<{ ok: boolean }>(`/tools/${encodeURIComponent(slug)}`, { method: 'DELETE' });
    },
  }, // tools 分组结束

  // ---------- 圈子（circles）：以人 / 兴趣 / 组织为中心的成员制社群，与板块 board 概念独立 ----------

  circles: { // 圈子域：公开浏览 / 成员准入与互动 / 圈主管理
    list(opts: { category?: string; visibility?: string; keyword?: string; page?: number; limit?: number } = {}) { // 圈子列表，支持分类 / 可见性 / 关键词过滤与分页
      const qs = new URLSearchParams();
      if (opts.category) qs.set('category', opts.category);
      if (opts.visibility) qs.set('visibility', opts.visibility);
      if (opts.keyword) qs.set('keyword', opts.keyword);
      if (opts.page) qs.set('page', String(opts.page));
      if (opts.limit) qs.set('limit', String(opts.limit));
      const suffix = qs.toString();
      return request<{ items: CircleSummary[]; total: number; page: number; limit: number }>(`/circles${suffix ? `?${suffix}` : ''}`, { auth: false, idempotency: false });
    },
    detail(slug: string) { // 圈子详情（成员数 / 我是否成员 / 我的角色）
      return request<{ circle: CircleSummary }>(`/circles/${encodeURIComponent(slug)}`, { idempotency: false });
    },
    create(payload: CircleCreatePayload) { // 创建圈子；创建者自动成为 owner
      return request<{ ok: boolean; circle: CircleSummary & { invite_code: string | null } }>('/circles', { method: 'POST', body: payload });
    },
    join(slug: string, inviteCode?: string) { // 加入：open 直入 / approve 待审 / invite 凭邀请码
      return request<{ ok: boolean; status: 'pending' | 'active'; role: CircleRole; joined: boolean; via: string }>(`/circles/${encodeURIComponent(slug)}/join`, { method: 'POST', body: { invite_code: inviteCode } });
    },
    leave(slug: string) { // 退出圈子
      return request<{ ok: boolean; left: boolean }>(`/circles/${encodeURIComponent(slug)}/leave`, { method: 'POST', body: {} });
    },
    members(slug: string) { // 成员名单（仅 active 成员可读；owner / admin 额外带回待审名单）
      return request<{ items: CircleMember[]; pending: CircleMember[]; member_count: number }>(`/circles/${encodeURIComponent(slug)}/members`, { idempotency: false });
    },
    approve(slug: string, userId: string) { // 圈主 / 管理员通过待审成员
      return request<{ ok: boolean; status: string }>(`/circles/${encodeURIComponent(slug)}/approve`, { method: 'POST', body: { user_id: userId } });
    },
    reject(slug: string, userId: string) { // 圈主 / 管理员拒绝待审成员
      return request<{ ok: boolean; status: string }>(`/circles/${encodeURIComponent(slug)}/reject`, { method: 'POST', body: { user_id: userId } });
    },
    posts(slug: string) { // 圈内动态流
      return request<{ items: CirclePost[] }>(`/circles/${encodeURIComponent(slug)}/posts`, { idempotency: false });
    },
    createPost(slug: string, body: string, threadId?: string | null) { // 发圈内动态
      return request<{ ok: boolean; post: CirclePost }>(`/circles/${encodeURIComponent(slug)}/posts`, { method: 'POST', body: { body, thread_id: threadId ?? null } });
    },
    notices(slug: string) { // 圈内公告流
      return request<{ items: CircleNotice[] }>(`/circles/${encodeURIComponent(slug)}/notices`, { idempotency: false });
    },
    createNotice(slug: string, body: string) { // 发圈内公告（仅 owner / admin）
      return request<{ ok: boolean; notice: CircleNotice }>(`/circles/${encodeURIComponent(slug)}/notices`, { method: 'POST', body: { body } });
    },
  }, // circles 分组结束
}; // api 对象结束
