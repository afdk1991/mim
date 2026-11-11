/**
 * 双语文案与本地化格式化（FR-06 / 08 §4.4 多端一致性）。
 * 客户端禁止硬编码文案：所有展示文案由本包或服务端下发。
 */

// 仅引入类型（type-only import），编译后不留运行时依赖，避免客户端多打一个包
import type { ErrorCode } from '@mim/core-domain';

// 全站支持的语言标识，采用 BCP 47 的「语言-地区」形式，便于直接交给 Intl 使用
export type Locale = 'zh-CN' | 'en-US';

// 运行时可选语言清单：设置页的语言下拉、Accept-Language 协商都以它为准
export const SUPPORTED_LOCALES: Locale[] = ['zh-CN', 'en-US'];

// 缺省语言：中文用户占比最高，未显式指定语言时以此兜底
export const DEFAULT_LOCALE: Locale = 'zh-CN';

// 字典的通用结构：扁平化的「点分键 → 文案」映射，避免多层对象带来的取值样板代码
type Dict = Record<string, string>;

// 简体中文文案字典：key 采用「模块.语义」点分命名，便于按前缀分组检索
const zh: Dict = {
  // 产品名，出现在标题栏与启动页；各语言保持品牌同一写法
  'app.name': 'Mim',
  // 底部导航「设置」入口的名称
  'nav.settings': '设置',
  // 列表页主操作按钮：新建一条业务对象
  'action.create': '新建',
  // 表单提交时保存当前编辑内容
  'action.save': '保存',
  // 放弃当前编辑并返回，不落库
  'action.cancel': '取消',
  // 删除操作文案，配合二次确认弹窗使用
  'action.delete': '删除',
  // 进入编辑态，打开可改表单
  'action.edit': '编辑',
  // 把任务条目标记为已完成，触发状态流转
  'action.complete': '完成',
  // 将已完成任务回退为未完成，用于误操作恢复
  'action.reopen': '重新打开',
  // 清除本地会话并跳回登录页
  'action.logout': '退出登录',
  // 登录页标题：同一入口兼做注册，降低用户选择成本
  'auth.title': '登录 / 注册',
  // 国内主登录凭证的手机号输入框标签
  'auth.phone': '手机号',
  // 海外主登录凭证的邮箱输入框标签
  'auth.email': '邮箱',
  // 短信/邮件一次性验证码的输入框标签
  'auth.code': '验证码',
  // 密码登录模式下的密码输入框标签
  'auth.password': '密码',
  // 登录方式切换项：使用账号密码认证
  'auth.modePassword': '密码登录',
  // 登录方式切换项：使用一次性验证码认证
  'auth.modeCode': '验证码登录',
  // 触发验证码下发的按钮，点击后进入倒计时防重复点击
  'auth.sendCode': '获取验证码',
  // 开发环境未接短信通道时，把验证码直接回显给联调人员
  'auth.codeSent': '验证码已生成（开发模式直接展示）',
  // 已有账号的提交按钮
  'auth.login': '登录',
  // 新账号的提交按钮，与登录共用同一表单
  'auth.register': '注册',
  // 设置页「账号」分区的标题
  'settings.account': '账号',
  // 设置页设备管理分区：查看并移除已登录终端
  'settings.devices': '登录设备',
  // 设置页注销分区的标题
  'settings.deletion': '账号注销',
  // 注销前的风险提示，满足合规对「充分告知」的要求
  'settings.deletionTip': '注销后进入 7 天冷静期，期间可撤销',
  // 通用加载态，省略号表示请求仍在进行中
  'common.loading': '加载中…',
  // 通用确认按钮，用于弹窗的主操作
  'common.confirm': '确认',
  // 空值占位文案，避免界面出现空白或 null
  'common.none': '无',
  // 断网时的状态条提示，说明本地改动会在恢复网络后补传
  'common.offline': '离线，变更将在恢复后同步',
  // 未预期异常的兜底提示，具体原因由错误码映射补充
  'common.error': '出错了',
  // 展示名称输入框的标签
  'settings.displayName': '昵称',
  // 界面语言选择项的标签
  'settings.locale': '语言',
  // 时区选择项标签，影响日期展示与提醒触发时刻
  'settings.timezone': '时区',
  // 设置页底部的提交按钮，一次性保存本页改动
  'settings.save': '保存设置',
  // 账号所属地区选择项，决定可用支付通道与合规策略
  'settings.region': '地区',
  // 只读展示当前地区信息的分组标题
  'settings.regionInfo': '地区信息',
  // 发起账号注销流程的按钮
  'settings.requestDeletion': '申请注销',
  // 冷静期内反悔时的撤销按钮
  'settings.cancelDeletion': '撤销注销',
  // 冷静期内的状态说明，提示部分能力暂不可用
  'settings.deletionPending': '账号处于注销冷静期',
// 中文字典结束：此处键集合是英文对照的基准，增删键需两边同步
};

// 英文文案字典：键集合必须与中文完全一致，缺失的键会回落到 DEFAULT_LOCALE
const en: Dict = {
  // 品牌名不做翻译，保持全球统一
  'app.name': 'Mim',
  // 导航项「Settings」
  'nav.settings': 'Settings',
  // 新建按钮用短词 New，贴合英文界面习惯
  'action.create': 'New',
  // 保存按钮
  'action.save': 'Save',
  // 取消按钮
  'action.cancel': 'Cancel',
  // 删除按钮
  'action.delete': 'Delete',
  // 编辑按钮
  'action.edit': 'Edit',
  // 标记完成的按钮
  'action.complete': 'Complete',
  // 把已完成项重新打开的按钮
  'action.reopen': 'Reopen',
  // 退出登录；英文用 Sign out 而非 Logout，与 Apple/Google 生态一致
  'action.logout': 'Sign out',
  // 登录页标题
  'auth.title': 'Sign in / Sign up',
  // 手机号输入框
  'auth.phone': 'Phone',
  // 邮箱输入框
  'auth.email': 'Email',
  // 验证码输入框
  'auth.code': 'Verification code',
  // 密码输入框
  'auth.password': 'Password',
  // 密码登录方式切换项
  'auth.modePassword': 'Password sign-in',
  // 验证码登录方式切换项
  'auth.modeCode': 'Code sign-in',
  // 获取验证码按钮
  'auth.sendCode': 'Send code',
  // 开发模式下回显验证码的提示
  'auth.codeSent': 'Code generated (shown in dev mode)',
  // 登录提交按钮
  'auth.login': 'Sign in',
  // 注册提交按钮
  'auth.register': 'Sign up',
  // 设置页账号分组
  'settings.account': 'Account',
  // 设置页设备分组
  'settings.devices': 'Devices',
  // 设置页注销分组
  'settings.deletion': 'Delete account',
  // 注销冷静期提示
  'settings.deletionTip': 'Account enters a 7-day cooling-off period and can be restored',
  // 加载态
  'common.loading': 'Loading…',
  // 通用确认
  'common.confirm': 'Confirm',
  // 空值占位
  'common.none': 'None',
  // 离线提示
  'common.offline': 'Offline. Changes will sync when back online.',
  // 通用错误提示
  'common.error': 'Something went wrong',
  // 昵称字段标签
  'settings.displayName': 'Display name',
  // 语言字段标签
  'settings.locale': 'Language',
  // 时区字段标签
  'settings.timezone': 'Time zone',
  // 保存设置按钮
  'settings.save': 'Save settings',
  // 地区字段标签
  'settings.region': 'Region',
  // 地区信息分组标题
  'settings.regionInfo': 'Region info',
  // 申请注销按钮
  'settings.requestDeletion': 'Request deletion',
  // 撤销注销按钮
  'settings.cancelDeletion': 'Cancel deletion',
  // 冷静期状态说明
  'settings.deletionPending': 'Account is pending deletion',
// 英文字典结束：与中文字典保持一一对应，供 en-US 场景取词
};

// 错误码到用户可读文案的映射：按语言分组，键覆盖 ERROR_CODES 全量，类型上强制穷举
const ERROR_MESSAGES: Record<Locale, Record<ErrorCode, string>> = {
  // 中文错误文案表
  'zh-CN': {
    // 参数校验失败：提示用户检查输入，而非暴露字段级技术细节
    VALIDATION_FAILED: '请求参数不合法',
    // 未登录：引导先完成认证
    AUTH_UNAUTHORIZED: '请先登录',
    // 验证码不匹配
    AUTH_CODE_INVALID: '验证码错误',
    // 验证码超时，需重新获取
    AUTH_CODE_EXPIRED: '验证码已过期',
    // 发送频控，提示稍后重试
    AUTH_CODE_RATE_LIMITED: '验证码发送过于频繁，请稍后再试',
    // 通道未配置，避免暴露运维细节
    AUTH_CHANNEL_NOT_CONFIGURED: '验证码通道未配置，请稍后再试',
    // 上游下发失败，提示重试而非报错码
    AUTH_CODE_DELIVERY_FAILED: '验证码发送失败，请稍后再试',
    // 密码错误
    AUTH_PASSWORD_INVALID: '密码错误',
    // 未开启密码登录，指引联系管理员
    AUTH_PASSWORD_NOT_CONFIGURED: '密码登录未配置，请联系管理员',
    // 注册身份已被占用，引导改用登录
    AUTH_IDENTITY_EXISTS: '该账号已注册，请直接登录',
    // 账号锁定，告知原因与临时性
    AUTH_ACCOUNT_LOCKED: '登录失败次数过多，账号已临时锁定',
    // 会话失效，要求重新登录
    AUTH_REFRESH_INVALID: '登录状态已失效，请重新登录',
    // 账号不存在
    ACCOUNT_NOT_FOUND: '账号不存在',
    // 地区不匹配，说明账号归属限制
    ACCOUNT_REGION_MISMATCH: '该账号不属于当前地区',
    // 注销冷静期内，指引先撤销注销
    ACCOUNT_DELETION_PENDING: '账号处于注销冷静期，请先撤销注销',
    // 无权限
    FORBIDDEN: '没有执行该操作的权限',
    // 资源不存在
    NOT_FOUND: '资源不存在',
    // 冲突，建议刷新后重试
    CONFLICT: '数据冲突，请刷新后重试',
    // 幂等键复用于不同请求体，属于客户端实现问题
    IDEMPOTENCY_CONFLICT: '幂等键对应的请求内容不一致',
    // 功能未解锁，暗示与套餐/权限有关
    FEATURE_NOT_AVAILABLE: '当前账号未解锁该功能',
    // 付费模块必须先下单并完成结算
    PAYMENT_REQUIRED: '该模块为付费模块，请先下单并完成结算',
    // 支付回调密钥未配置
    PAYMENT_NOTIFY_NOT_CONFIGURED: '支付回调密钥未配置，暂无法接收渠道通知',
    // 对象存储缺失
    STORAGE_NOT_CONFIGURED: '对象存储未配置',
    // AI 提供方缺失
    PROVIDER_NOT_CONFIGURED: 'AI 模型提供方未配置',
    // 成本超限，说明限额维度
    COST_LIMIT_EXCEEDED: '已超出单任务/当日生成成本上限',
    // AI 生成任务失败：上游模型/存储/合成环节报错，提示稍后重试
    GENERATION_FAILED: '生成失败，请稍后重试',
    // 通用频控
    RATE_LIMITED: '请求过于频繁，请稍后再试',
    // 服务端异常，不暴露堆栈
    INTERNAL_ERROR: '服务器内部错误',
  // 中文错误文案表结束
  },
  // 英文错误文案表，与中文表逐码对应
  'en-US': {
    // 参数校验失败
    VALIDATION_FAILED: 'Invalid request parameters',
    // 未认证
    AUTH_UNAUTHORIZED: 'Please sign in first',
    // 验证码错误
    AUTH_CODE_INVALID: 'Incorrect verification code',
    // 验证码过期
    AUTH_CODE_EXPIRED: 'Verification code expired',
    // 验证码频控
    AUTH_CODE_RATE_LIMITED: 'Too many code requests, try again later',
    // 通道未配置
    AUTH_CHANNEL_NOT_CONFIGURED: 'Verification channel is not configured, please try again later',
    // 下发失败
    AUTH_CODE_DELIVERY_FAILED: 'Failed to deliver the verification code, please try again later',
    // 密码错误
    AUTH_PASSWORD_INVALID: 'Incorrect password',
    // 密码登录未开启
    AUTH_PASSWORD_NOT_CONFIGURED: 'Password sign-in is not configured, contact the administrator',
    // 注册身份已被占用
    AUTH_IDENTITY_EXISTS: 'This account is already registered, please sign in',
    // 账号锁定
    AUTH_ACCOUNT_LOCKED: 'Too many failed sign-ins, account temporarily locked',
    // 会话失效
    AUTH_REFRESH_INVALID: 'Session expired, please sign in again',
    // 账号不存在
    ACCOUNT_NOT_FOUND: 'Account not found',
    // 地区不匹配
    ACCOUNT_REGION_MISMATCH: 'Account does not belong to this region',
    // 注销冷静期
    ACCOUNT_DELETION_PENDING: 'Account is pending deletion; cancel it first',
    // 无权限
    FORBIDDEN: 'You are not allowed to perform this action',
    // 资源不存在
    NOT_FOUND: 'Resource not found',
    // 数据冲突
    CONFLICT: 'Data conflict, refresh and retry',
    // 幂等冲突
    IDEMPOTENCY_CONFLICT: 'Idempotency key was reused with a different payload',
    // 功能未解锁
    FEATURE_NOT_AVAILABLE: 'This feature is not unlocked for your account',
    // 付费模块必须先下单并完成结算
    PAYMENT_REQUIRED: 'This module is paid; place an order and settle it first',
    // 支付回调密钥未配置
    PAYMENT_NOTIFY_NOT_CONFIGURED: 'Payment callback secret is not configured',
    // 存储未配置
    STORAGE_NOT_CONFIGURED: 'Object storage is not configured',
    // 模型提供方未配置
    PROVIDER_NOT_CONFIGURED: 'AI model provider is not configured',
    // 成本超限
    COST_LIMIT_EXCEEDED: 'Generation cost limit exceeded (per job or daily)',
    // AI 生成任务失败
    GENERATION_FAILED: 'Generation failed, please try again later',
    // 通用频控
    RATE_LIMITED: 'Too many requests, try again later',
    // 服务端异常
    INTERNAL_ERROR: 'Internal server error',
  // 英文错误文案表结束
  },
// 错误文案总表结束：外层按 Locale 分组，内层按 ErrorCode 分键
};

// 语言到字典的运行时分发表：避免每次取值都写 switch，新增语言只需在此登记
const DICTS: Record<Locale, Dict> = { 'zh-CN': zh, 'en-US': en };

// 把外部传入的语言标记归一化为受支持的 Locale，容忍 en / en_US 等常见变体
export function normalizeLocale(value: string | undefined | null): Locale {
  // 命中英文的任一常见写法即返回 en-US，其他输入一律走默认语言
  if (value === 'en-US' || value === 'en' || value === 'en_US') return 'en-US';
  // 未识别（含 undefined / null）时兜底中文，保证界面总有文案
  return DEFAULT_LOCALE;
// 归一化函数结束：返回值一定是 SUPPORTED_LOCALES 中的合法成员
}

// 核心取词函数：按语言取模板，缺失时逐级回落，永不返回 undefined
export function t(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  // 三级回落：当前语言 → 默认语言 → 键名本身（便于开发期一眼看出缺失键）
  const template = DICTS[locale][key] ?? DICTS[DEFAULT_LOCALE][key] ?? key;
  // 无插值变量时直接返回模板，省去正则开销（高频渲染路径）
  if (!vars) return template;
  // 用 {name} 占位符做插值；变量缺失时原样保留占位符，避免输出 "undefined"
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
// 取词函数结束：无变量时直接返回模板，有变量时返回插值后的最终文案
}

// 把错误码翻译成当前语言的用户提示；未知码回退到默认语言，再不行直接返回码
export function errorMessage(locale: Locale, code: ErrorCode): string {
  // 与 t() 相同的回落策略，保证错误提示不出现空白
  return ERROR_MESSAGES[locale][code] ?? ERROR_MESSAGES[DEFAULT_LOCALE][code] ?? code;
// 错误文案函数结束：返回的字符串可直接展示，无需前端再维护一份映射
}

// 金额格式化：入参为「最小货币单位」的整数（分/日元），输出带符号的本地化字符串
export function formatCurrency(amountMinor: number, currency: string, locale: Locale): string {
  // 日元、韩元没有小数位，其余币种统一保留 2 位，避免出现 ¥0.00 这类怪异展示
  const digits = currency === 'JPY' || currency === 'KRW' ? 0 : 2;
  // 交给 Intl 处理货币符号位置、千分位与本地化规则，避免自己拼接字符串
  return new Intl.NumberFormat(locale === 'zh-CN' ? 'zh-CN' : 'en-US', {
    // 货币格式：自动加币种符号
    style: 'currency',
    // 目标币种，如 CNY / USD
    currency,
    // 最少小数位与最多小数位保持一致，避免同列金额位数不齐
    minimumFractionDigits: digits,
    // 同上，锁定最大小数位
    maximumFractionDigits: digits,
    // 最小单位换回主单位（分 → 元）后再格式化
  }).format(amountMinor / 100);
// 金额格式化结束：输出形如 ¥1,234.00 / $1,234.00，符号与分隔符均由 Intl 决定
}

// 日期格式化：入参为 ISO 字符串，按语言与时区渲染成中等长度日期
export function formatDate(iso: string, locale: Locale, timeZone = 'Asia/Shanghai'): string {
  // 使用 Intl.DateTimeFormat 而非手写模板，确保各语言下的日期顺序正确
  return new Intl.DateTimeFormat(locale === 'zh-CN' ? 'zh-CN' : 'en-US', {
    // medium 粒度：既含年月日又不过于冗长，适合列表与详情页
    dateStyle: 'medium',
    // 显式时区：服务端与客户端时区不同也能得到一致结果，默认按国内时区
    timeZone,
    // ISO 字符串转 Date 后格式化；非法时间会抛 RangeError，由调用方兜底
  }).format(new Date(iso));
// 日期格式化结束：输出形如 2026年11月6日 / Nov 6, 2026，随时区参数变化
}
