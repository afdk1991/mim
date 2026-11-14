/**
 * API 业务端点（2026-11-14 P1-A 拆分，自 api.ts 原样搬出）
 *
 * 22 个业务域按原有顺序保留在一个对象里，调用方式仍为 api.<域>.<方法>，对外契约完全不变。
 * 后续再按域拆成独立文件时，只需把这里的某个键搬走并在 api.ts 里展开合并，不会影响调用方。
 */

import { ApiError, BASE, current, request } from './request.js'; // 所有端点的唯一出口：鉴权、幂等、错误信封与 401 重试
import type { Locale } from '@mim/i18n';
import type { Region, Provider, CaptchaScene, CaptchaIssue, SecurityStatus, CaptchaTicket, UserInfo, OAuthProviderInfo, OAuthBinding, RealnameRecord, LoginResult, MeResponse, AssetType, PresignedUrl, ImConversationType, ImMessageContentType, ImMessage, ImConversation, ImMember, ImUser, CartSummary, CartCheckoutResult, CommunityBoard, CommunityThreadMedia, CommunityThread, CommunityThreadDetail, CommunityPost, CircleRole, CircleSummary, CircleMember, CirclePost, CircleNotice, CircleCreatePayload, VipPlan, WalletSnapshot, WalletTransaction, ShopProduct, ShopOrder, UnifiedOrder, UnifiedOrderSummary, UnifiedOrderSource, PaymentProvider, PaymentChannel, PaymentIntent, ThemeSettings, I18nSettings, PageBlock, PointsDeductionConfig, ContentFeedItem, AnnouncementItem, ChangelogItem, PromotionItem, AnnouncementUpsertPayload, ChangelogUpsertPayload, PromotionUpsertPayload, BoardTab, BoardTabInput } from './types.js'; // 端点签名用到的类型仍定义在 types.ts，仅类型引用

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

  // ---------- 对象存储（media）：object_key 一律由服务端生成，客户端不拼接 ----------

  media: { // 对象存储相关接口
    /** POST /media/presign/upload → 201；服务端校验 asset_type/mime 并生成 object_key */
    presignUpload(input: { // 申请上传预签名地址
      asset_type: AssetType; // 产物类型，服务端据此校验 mime 合法性
      mime: string; // 文件 MIME，需与产物类型匹配
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
  }, // media 分组结束
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
    page(page: string) { // 页面区块
      return request<{ page: string; blocks: PageBlock[] }>(`/pages/${encodeURIComponent(page)}`, { idempotency: false }); // 返回当前函数的处理结果
    }, // 代码块结束
  }, // 代码块结束

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
    feed(limit = 50, kind?: string) { // 全站统一内容流：论坛主题 + 圈内动态 + 圈内公告（复用已有 GET /content/items，公开只读）
      const qs = new URLSearchParams({ limit: String(limit) }); // 条数上限：后端按同样口径兜底
      if (kind) qs.set('kind', kind); // 可选：按内容形态过滤（text / video / notice）
      return request<{ items: ContentFeedItem[]; total: number }>(`/content/items?${qs.toString()}`, { auth: false, idempotency: false }); // 公开只读，无需会话
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
