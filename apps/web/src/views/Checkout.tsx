/**
 * 统一收银台：支付意图二维码 / 渠道唤起 / 状态轮询 / 三态结果。
 *
 * 入口两种：
 * 1. 已有意图：/checkout?intent=<id>
 * 2. 现场创建：/checkout?purpose=asset&ref=<code>&provider=alipay
 * 状态轮询仅前端展示用途，履约以后端回调 / 线下确认为准。
 */

// 引入 React 钩子：useCallback 缓存查询与停表函数，useEffect 编排创建/查询/轮询，useRef 保存查询参数与计时器，useState 维护页面状态
import { useCallback, useEffect, useRef, useState } from 'react';
// 引入货币格式化与语言类型：金额按 locale 展示，Locale 约束语言取值
import { formatCurrency, type Locale } from '@mim/i18n';
// 引入接口客户端与错误文案翻译器：createIntent/getIntent 发起意图，errorText 翻译后端错误
import { api, errorText } from '../api';
// 引入支付意图与渠道类型：约束意图对象与 provider 取值结构
import type { PaymentIntent, PaymentProvider } from '../api';
// 引入路由工具：navigatePath 跳转，pathOf 取路由路径
import { navigatePath, pathOf } from '../router';
// 引入支付状态归类、查询解析、唤起方式解析与界面状态类型：把后端状态与设备 UA 映射成可执行的唤起方案
import {
  classifyIntentStatus, // 后端状态归类为界面三态
  parseIntentQuery, // 解析地址栏查询参数
  resolvePaymentLaunch, // 按渠道与 UA 解析 scheme 唤起方案
  type IntentUiStatus, // 界面三态联合类型
} from '../lib/payments';
// 引入渠道展示名：provider 代号翻译成当前语言可读名
import { providerLabel } from '../lib/checkout';
// 引入词条翻译函数：按 locale 取页面文案
import { tr } from '../lib/messages';
// 引入二维码组件：把支付码文本渲染成可扫码图像
import { QrCode } from '../components/QrCode';

// 组件对外契约：接收当前语言用于文案、金额与渠道名展示
interface Props {
  // 当前语言取值：zh-CN / en-US
  locale: Locale;
} // 接口定义结束

// 待支付状态轮询间隔：每 5 秒复核一次结果，等待渠道回调落地
const POLL_MS = 5000; // 待支付状态轮询间隔（毫秒）

/** 用途白名单（与后端 zod 枚举一致）：前端只允许这四类用途进入收银台 */
const PURPOSES = ['shop_order', 'vip', 'asset', 'recharge'] as const;
// 用途字面量联合类型：由白名单数组推导，避免出现枚举外的字符串
type Purpose = (typeof PURPOSES)[number];

// 收银台组件：支持「带回跳意图」与「现场创建意图」两种入口，展示金额、渠道、二维码并轮询结果三态
export function Checkout({ locale }: Props) {
  // 查询参数引用：挂载时解析一次地址栏 query，避免重复解析；服务端渲染时空字符串兜底
  const queryRef = useRef(parseIntentQuery(typeof window === 'undefined' ? '' : window.location.search));
  // 支付意图对象状态：拿到服务端返回后回填，驱动金额、渠道、二维码与唤起按钮
  const [intent, setIntent] = useState<PaymentIntent | null>(null);
  // 加载标记：true 展示加载提示，创建/查询完成后置 false
  const [loading, setLoading] = useState(true);
  // 错误提示状态：创建或查询失败时保存可读文案，null 表示无错误
  const [error, setError] = useState<string | null>(null);
  // 界面三态状态：pending 待支付 / paid 成功 / failed 失败，驱动结果条样式与文案
  const [status, setStatus] = useState<IntentUiStatus>('pending');
  // 轮询计时器引用：未启动为 null，启动后保存句柄以便停表与卸载清理
  const timerRef = useRef<number | null>(null);
  // 优惠码本地输入与核验结果：仅结算前预览命中规则与实减金额，不核销次数、不改支付意图
  const [couponCode, setCouponCode] = useState(''); // 优惠码输入值
  const [couponResult, setCouponResult] = useState<{ valid: boolean; discount_cents: number } | null>(null); // 核验结果
  const [couponError, setCouponError] = useState<string | null>(null); // 核验失败文案

  /** 核验优惠码：按当前应付金额预览命中规则与实减；失败回显服务端原因，不阻断支付 */
  async function applyCoupon() {
    if (!intent || !couponCode.trim()) return; // 无意图或空码不发请求
    setCouponError(null); // 清空旧错误
    try {
      const res = await api.coupon.validate(couponCode.trim(), intent.amount_cents); // 预校验不消耗次数
      setCouponResult(res); // 回填命中结果与实减金额
    } catch (err) {
      setCouponResult(null); // 核验不通过：清空旧命中
      setCouponError(errorText(locale, err)); // 翻译为可读文案
    } // try 结束
  }

  // 停表函数：清掉周期轮询句柄并置空，幂等可重复调用；依赖为空数组，引用稳定
  const stopPolling = useCallback(() => {
    if (timerRef.current !== null) { // 计时器已启动才需要清理
      window.clearInterval(timerRef.current); // 清除周期计时器
      timerRef.current = null; // 句柄置空，避免重复清理
    } // 计时器非空分支结束
  }, []); // 依赖空数组：函数引用保持稳定，供 useEffect 依赖项使用

  // 意图查询函数：按编号拉取最新意图、归类界面状态并返回意图对象；依赖为空数组保持引用稳定
  const load = useCallback(async (intentId: string) => {
    const res = await api.commerce.getIntent(intentId); // 请求服务端最新支付意图
    setIntent(res.intent); // 回填意图对象，刷新展示信息
    setStatus(classifyIntentStatus(res.intent.status)); // 后端状态归类为界面三态
    return res.intent; // 返回意图对象，供轮询回调判定是否停表
  }, []); // 依赖空数组：查询函数引用保持稳定

  // 副作用：解析入口参数 → 缺意图则现场创建 → 首次查询 → 待支付状态挂周期轮询；卸载取消回调并停表
  useEffect(() => {
    let cancelled = false; // 卸载标记：异步回调返回时已卸载则不再写入状态
    const q = queryRef.current; // 地址栏解析出的查询参数快照
    setLoading(true); // 副作用开始：重置加载态
    setError(null); // 副作用开始：清空上一轮错误

    // 主流程包成异步 IIFE：先创建意图（如需）再查询与轮询，异常统一落入错误面板
    (async () => {
      try { // 开始捕获创建与查询流程异常
        let intentId = q.intentId; // 已有意图入口：直接取用意图编号
        if (!intentId) { // 无意图编号：按用途 / 关联对象现场创建
          const purpose = PURPOSES.find((p) => p === q.purpose) as Purpose | undefined; // 命中白名单才认可用途，否则按非法入参抛错
          if (!purpose || !q.refId) throw new Error('missing intent reference'); // 用途或关联对象缺失：无法创建意图
          const created = await api.commerce.createIntent({ // 现场创建支付意图
            purpose, // 计费用途：订单 / 会员 / 资产 / 充值
            ref_id: q.refId, // 关联业务对象标识，用于后端落账对应
            provider: (q.provider ?? 'alipay') as PaymentProvider, // 渠道缺省走支付宝，按查询参数覆盖
          }); // 创建意图请求结束
          intentId = created.intent.id; // 用新建意图编号替换本地变量，供后续查询与轮询
        } // 现场创建分支结束
        const first = await load(intentId); // 首次查询意图最新状态
        if (cancelled) return; // 已卸载：丢弃本次编排
        if (classifyIntentStatus(first.status) === 'pending') { // 首次结果仍待支付：挂周期轮询
          timerRef.current = window.setInterval(() => {
            void load(intentId) // 周期复核最新意图
              .then((fresh) => { // 复核成功回调
                if (classifyIntentStatus(fresh.status) !== 'pending') stopPolling(); // 结果落定：停止轮询
              }) // 成功回调结束
              .catch(() => { // 复核失败兜底：不中断轮询周期
                /* 单次轮询失败保留轮询，下次再试 */
              }); // 失败兜底结束
          }, POLL_MS); // 轮询间隔结束
        } // 待支付才启轮询的分支结束
      } catch (err) { // 捕获创建 / 查询异常：翻译为可读文案
        if (!cancelled) setError(errorText(locale, err)); // 未卸载则翻译并展示错误
      } finally { // 收尾：无论成败都结束加载态
        if (!cancelled) setLoading(false); // 未卸载则关闭加载提示
      } // 异常与收尾分支结束
    })(); // 异步 IIFE 调用结束

    // 清理函数：卸载时置取消标记并停止轮询，防止回调泄漏
    return () => {
      cancelled = true; // 标记已卸载，阻断后续状态写入
      stopPolling(); // 清理周期轮询句柄
    }; // 清理函数结束
  }, [load, locale, stopPolling]); // 依赖：查询函数、语言、停表函数变化时重跑编排

  // 唤起方案解析：按渠道、支付链接、二维码文本与设备 UA 得到 scheme 唤起 / 外链 / 提示分支；无意图时为 null
  const launch = intent
    ? resolvePaymentLaunch( // 有意图才解析唤起方案
        intent.provider, // 支付渠道代号
        intent.pay_url, // 支付外链地址
        intent.qr_text, // 二维码文本
        typeof navigator !== 'undefined' ? navigator.userAgent : '', // 设备 UA，服务端渲染时为空串
      )
    : null; // 无意图：不生成唤起方案

  // 二维码内容优先级：二维码文本 > 支付链接 > 意图编号，保证总有可展示的码文本
  const qrContent = intent?.qr_text ?? intent?.pay_url ?? intent?.id ?? '';

  // 渠道唤起动作：存在 scheme 时把当前页跳转到支付 App scheme；无 scheme 不动作
  function openScheme() {
    if (launch?.scheme) window.location.href = launch.scheme; // 跳转渠道唤起链接
  }

  // 唤起按钮文案：微信渠道显示打开微信，其余渠道显示打开支付宝
  const schemeLabel =
    intent?.provider === 'wechat' ? tr(locale, 'web.checkout.openWechat') : tr(locale, 'web.checkout.openAlipay'); // 按渠道取一侧文案

  return ( // 进入页面 JSX 渲染
    <div className="page checkout-page">{/* 收银台外层容器 */}
      <header className="page-head">{/* 页面头部：标题 + 返回个人中心按钮 */}
        <h1>{tr(locale, 'web.checkout.title')}</h1>{/* 收银台标题，取自 i18n 词条 */}
        <button type="button" className="btn ghost" onClick={() => navigatePath(pathOf('account'))}>{/* 返回个人中心按钮 */}
          {tr(locale, 'web.checkout.back')}{/* 返回按钮文案 */}
        </button>{/* 结束返回按钮 */}
      </header>{/* 结束页面头部 */}

      {/* 加载中提示条：意图加载完成前展示 */}
      {loading ? <div className="hint">{tr(locale, 'web.player.loading')}</div> : null}
      {/* 错误面板：创建 / 查询失败时展示红色提示与重试按钮 */}
      {error ? (
        <section className="panel danger">{/* 错误面板容器 */}
          <p className="error">{error}</p>{/* 错误文案 */}
          <button type="button" className="btn ghost" onClick={() => window.location.reload()}>{/* 重试按钮：刷新整页重新编排 */}
            {tr(locale, 'web.common.retry')}{/* 重试按钮文案 */}
          </button>
        </section>
      ) : null}

      {/* 意图已回填且无错误时才渲染收银台主面板 */}
      {intent && !error && (
        <section className="panel checkout-panel">{/* 收银台主面板：金额渠道 / 二维码 / 操作区 / 状态条 */}
          <div className="checkout-meta">{/* 金额与渠道元信息一行 */}
            <div>{/* 金额区块容器 */}
              <span className="hint">{tr(locale, 'web.checkout.amount')}</span>{/* 金额标签 */}
              <strong className="checkout-amount">{formatCurrency(intent.amount_cents, 'CNY', locale)}</strong>{/* 应付金额，按币种与语言格式化 */}
            </div>{/* 结束金额区块 */}
            <div>{/* 渠道区块容器 */}
              <span className="hint">{tr(locale, 'web.checkout.provider')}</span>{/* 渠道标签 */}
              <span className="deploy-badge muted">{providerLabel(locale, intent.provider)}</span>{/* 渠道可读名徽标 */}
            </div>{/* 结束渠道区块 */}
          </div>{/* 结束元信息行 */}

          {/* 金额拆解：应付 / 优惠 / 平台服务费 0。
              口径对齐：Stripe 定价页附加费逐项列示（https://stripe.com/pricing ）、
              PayPal 结账信息最小化（https://www.paypal.com/business ）、
              有赞公开交易规则（https://www.youzan.com/ ）。 */}
          <div className="checkout-meta">
            <div>
              <span className="hint">{tr(locale, 'web.checkout.amount')}</span>
              <strong className="checkout-amount">{formatCurrency(intent.amount_cents, 'CNY', locale)}</strong>
            </div>
            <div>
              <span className="hint">{locale === 'en-US' ? 'Discount' : '优惠'}</span>
              <span className="deploy-badge muted">-{formatCurrency(couponResult?.valid ? couponResult.discount_cents : 0, 'CNY', locale)}</span>
            </div>
            <div>
              <span className="hint">{locale === 'en-US' ? 'Service fee' : '平台服务费'}</span>
              <span className="deploy-badge muted">0</span>
            </div>
          </div>

          {/* 优惠码核验：结算前就地展示命中规则与实减金额；预校验不核销次数、不改支付意图 */}
          <div className="checkout-coupon">
            <label>{locale === 'en-US' ? 'Coupon' : '优惠码'}
              <input value={couponCode} onChange={(event) => setCouponCode(event.target.value)} placeholder="MIM10 / VIP20" />
            </label>
            <button type="button" className="btn ghost" onClick={() => void applyCoupon()}>
              {locale === 'en-US' ? 'Apply' : '核验'}
            </button>
            {couponResult?.valid ? (
              <p className="hint">
                {locale === 'en-US' ? 'Coupon matched, discount ' : '命中优惠，实减 '}
                {formatCurrency(couponResult.discount_cents, 'CNY', locale)}
              </p>
            ) : null}
            {couponError ? <p className="chat-error">{couponError}</p> : null}
          </div>

          <div className="checkout-qr">{/* 二维码区块：码图 + 扫码提示 */}
            <QrCode text={qrContent} size={188} />{/* 支付码图像，固定尺寸 */}
            <span className="hint">{tr(locale, 'web.checkout.qrHint')}</span>{/* 扫码提示文案 */}
          </div>{/* 结束二维码区块 */}

          <div className="checkout-actions">{/* 操作区：唤起 / 外链 / 手动刷新 */}
            {/* 存在 App scheme：优先走站内唤起按钮 */}
            {launch?.scheme ? (
              <button type="button" className="btn primary" onClick={openScheme}>{/* scheme 唤起按钮 */}
                {schemeLabel}{/* scheme 唤起按钮文案，按渠道区分 */}
              </button>
            ) : null}
            {/* 无 scheme 但有外链：新窗口打开支付页 */}
            {intent.pay_url && !launch?.scheme ? (
              <a className="btn primary" href={intent.pay_url} target="_blank" rel="noreferrer">{/* 支付外链锚点，新窗口打开 */}
                {tr(locale, 'web.checkout.openAlipay')}{/* 外链按钮文案 */}
              </a>
            ) : null}
            <button type="button" className="btn ghost" onClick={() => void load(intent.id)}>{/* 手动刷新按钮：复核一次最新结果 */}
              {tr(locale, 'web.checkout.refresh')}{/* 手动刷新文案 */}
            </button>{/* 结束手动刷新按钮 */}
          </div>{/* 结束操作区 */}

          {/* 线下渠道提示 */}
          {intent.provider === 'manual' ? <p className="hint">{tr(locale, 'web.checkout.manualNote')}</p> : null}
          {/* 沙箱渠道提示 */}
          {intent.provider === 'sandbox' ? <p className="hint">{tr(locale, 'web.checkout.sandboxNote')}</p> : null}
          {/* 微信唤起受限提示 */}
          {launch?.note === 'wechat-hint' ? <p className="hint">{tr(locale, 'web.checkout.wechatHint')}</p> : null}

          <div className={`checkout-status is-${status}`}>{/* 结果状态条：按三态切换样式 */}
            {status === 'pending' && <span>{tr(locale, 'web.checkout.pending')}</span>}{/* 待支付文案 */}
            {status === 'paid' && <span>{tr(locale, 'web.checkout.success')}</span>}{/* 支付成功文案 */}
            {/* 失败分支：区分取消与失败两种文案 */}
            {status === 'failed' && (
              <span>{/* 失败状态文本容器 */}
                {intent.status === 'cancelled' ? tr(locale, 'web.checkout.cancelled') : tr(locale, 'web.checkout.failed')}{/* 取消 / 失败按后端状态取一侧 */}
              </span>
            )}
          </div>{/* 结束状态条 */}
        </section>
      )}
    </div>
  );
}
