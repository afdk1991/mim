/**
 * 支付回跳承接页：渠道回跳 / 外部跳转落地后，按意图编号查询支付结果三态。
 * 成功 / 处理中 / 失败（含取消）三态展示；轮询有上限，超时后停在处理中并允许手动刷新。
 */

// 引入 React 副作用与状态钩子：useEffect 编排首次查询与轮询，useRef 保存查询参数与计数，useState 维护页面展示状态
import { useEffect, useRef, useState } from 'react';
// 引入货币格式化与语言类型：金额按当前 locale 格式化展示，Locale 约束语言取值
import { formatCurrency, type Locale } from '@mim/i18n';
// 引入接口客户端与错误文案翻译器：getIntent 查询支付意图，errorText 把后端错误转成可读提示
import { api, errorText } from '../api';
// 引入支付意图类型：约束 intent 状态对象的字段结构
import type { PaymentIntent } from '../api';
// 引入路由工具：navigatePath 跳转页面，pathOf 取路由路径
import { navigatePath, pathOf } from '../router';
// 引入支付状态归类、查询参数解析与界面状态类型：把后端状态映射成 pending/paid/failed 三态
import { classifyIntentStatus, parseIntentQuery, type IntentUiStatus } from '../lib/payments';
// 引入渠道展示名：把 provider 代号翻译成当前语言的可读渠道名
import { providerLabel } from '../lib/checkout';
// 引入词条翻译函数：按 locale 取页面文案
import { tr } from '../lib/messages';

// 组件对外契约：接收当前语言用于文案与金额格式化
interface Props {
  // 当前语言取值：zh-CN / en-US
  locale: Locale;
} // 代码块结束

// 轮询间隔：每 4 秒向服务端复核一次支付结果，兼顾渠道回调延迟与请求频率
const POLL_MS = 4000; // 轮询间隔（毫秒）
// 最多自动轮询次数：12 次约 48 秒，达到上限后停止自动轮询，交由用户手动刷新
const MAX_POLLS = 12; // 最多轮询 12 次（约 48 秒），之后停止自动轮询

// 支付回跳页组件：先按意图编号查询一次结果，处理中则按间隔轮询，直到出结果或达到轮询上限
export function PaymentReturn({ locale }: Props) {
  // 查询参数引用：页面挂载时解析一次地址栏 query，避免后续渲染重复解析；服务端渲染时空字符串兜底
  const queryRef = useRef(parseIntentQuery(typeof window === 'undefined' ? '' : window.location.search));
  // 支付意图对象状态：拿到服务端返回后回填，用于展示渠道、金额与状态
  const [intent, setIntent] = useState<PaymentIntent | null>(null);
  // 界面三态状态：pending 处理中 / paid 成功 / failed 失败，驱动结果面板样式与按钮
  const [status, setStatus] = useState<IntentUiStatus>('pending');
  // 首次加载标记：true 时展示加载提示，首次意图查询返回后置 false
  const [loading, setLoading] = useState(true);
  // 错误提示状态：查询失败或缺少意图编号时保存可读文案，null 表示无错误
  const [error, setError] = useState<string | null>(null);
  // 已轮询次数引用：跨轮询回调累加，达到 MAX_POLLS 即停表，不触发额外渲染
  const attemptsRef = useRef(0);

  // 副作用：解析意图编号 → 首次查询 → 处理中则周期轮询；卸载时取消回调并清表
  useEffect(() => {
    // 卸载标记：异步回调返回时若组件已卸载，不再写入状态
    let cancelled = false;
    // 轮询计时器句柄：未启动为 null，启动后保存以便清理
    let timer: number | null = null;
    // 从地址栏解析出的意图编号：回跳链接上携带，是查询支付结果的主键
    const intentId = queryRef.current.intentId;

    // 缺少意图编号属于非法回跳链接：直接记录错误并结束加载，不发起请求
    if (!intentId) {
      setError(locale === 'en-US' ? 'Missing payment intent' : '缺少支付意图编号'); // 标记缺少意图编号的错误
      setLoading(false); // 结束加载态，页面展示错误面板
      return; // 后续查询与轮询均不再执行
    } // 缺号分支结束

    // 单次意图查询：拉取最新支付意图，归类界面状态；失败时翻译错误文案并返回 null 供轮询判重
    const refresh = async () => {
      try { // 开始捕获本次查询的网络与业务异常
        const res = await api.commerce.getIntent(intentId); // 按意图编号请求服务端最新结果
        if (cancelled) return; // 组件已卸载：丢弃本次回调，避免写入已销毁页面
        setIntent(res.intent); // 回填意图对象，刷新渠道与金额展示
        setStatus(classifyIntentStatus(res.intent.status)); // 把后端状态归类为界面三态
        return res.intent; // 返回意图对象，供外层判断是否继续轮询
      } catch (err) { // 捕获查询异常：翻译为可读文案并返回空结果
        if (!cancelled) setError(errorText(locale, err)); // 未卸载则翻译并展示错误文案
        return null; // 查询失败返回 null，轮询循环据此跳过本次归类
      } // 异常分支结束
    }; // refresh 结束

    // 首次查询完成后决定是否启动轮询：仅当首次结果仍为处理中时才挂周期定时器
    void refresh().then((first) => {
      if (cancelled) return; // 已卸载则不进入轮询编排
      setLoading(false); // 首次查询（无论成败）都结束加载态
      if (first && classifyIntentStatus(first.status) === 'pending') { // 首次结果仍处理中才进入周期轮询编排
        // 首次结果仍处理中：按 POLL_MS 周期复核，直到结果落定或轮询次数触顶
        timer = window.setInterval(() => {
          attemptsRef.current += 1; // 累计本次自动轮询次数
          void refresh().then((fresh) => { // 单次轮询回调：复核最新意图
            if (!fresh) return; // 本次查询失败：跳过本次停表判定，等下一轮
            if (classifyIntentStatus(fresh.status) !== 'pending' || attemptsRef.current >= MAX_POLLS) { // 结果落定或次数触顶即停表
              if (timer !== null) window.clearInterval(timer); // 结果落定：停止定时器
            } // 停表条件判定结束
          }); // 单次轮询回调结束
        }, POLL_MS); // 轮询间隔结束
      } // 处理中才启轮询的分支结束
    }); // 首次查询编排结束

    // 清理函数：组件卸载时置取消标记并清掉轮询定时器，防止回调泄漏
    return () => {
      cancelled = true; // 标记已卸载，阻断后续状态写入
      if (timer !== null) window.clearInterval(timer); // 清理周期轮询句柄
    }; // 清理函数结束
  }, [locale]); // locale 变化时重跑：错误文案语言需随当前语言刷新

  return ( // 进入页面 JSX 渲染
    <div className="page pay-return-page">{/* 回跳页外层容器 */}
      <header className="page-head">{/* 页面头部：标题 + 返回个人中心按钮 */}
        <h1>{tr(locale, 'web.return.title')}</h1>{/* 回跳页标题，取自 i18n 词条 */}
        <button type="button" className="btn ghost" onClick={() => navigatePath(pathOf('account'))}>{/* 返回个人中心按钮 */}
          {tr(locale, 'web.checkout.back')}{/* 返回按钮文案 */}
        </button>{/* 结束返回按钮 */}
      </header>{/* 结束页面头部 */}

      {loading ? <div className="hint">{tr(locale, 'web.player.loading')}</div> : null}{/* 首次加载中展示提示条 */}
      {error ? <section className="panel danger"><p className="error">{error}</p></section> : null}{/* 错误面板：红色提示错误文案 */}

      {/* 意图已回填且无错误时才渲染结果面板 */}
      {intent && !error && (
        <section className={`panel pay-result is-${status}`}>{/* 结果面板：按三态切换样式 */}
          {/* 处理中分支：提示等待 + 渠道金额 + 手动刷新按钮 */}
          {status === 'pending' && (
            <>{/* 处理中片段包裹 */}
              <strong>{tr(locale, 'web.return.processing')}</strong>{/* 处理中主标题 */}
              <p className="hint">{/* 渠道与金额一行容器 */}
                {providerLabel(locale, intent.provider)} · {formatCurrency(intent.amount_cents, 'CNY', locale)}{/* 渠道名与应付金额 */}
              </p>{/* 渠道名与应付金额一行展示 */}
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  // 手动刷新：用户主动复核一次最新结果，不改变轮询计数
                  void api.commerce.getIntent(intent.id).then((res) => {
                    setIntent(res.intent); // 回填最新意图对象
                    setStatus(classifyIntentStatus(res.intent.status)); // 重新归类界面状态
                  }); // 手动查询回调结束
                }}
              >
                {tr(locale, 'web.checkout.refresh')}{/* 手动刷新按钮文案 */}
              </button>{/* 结束手动刷新按钮 */}
            </>
          )}
          {/* 支付成功分支：成功提示 + 渠道金额 + 回到个人中心 */}
          {status === 'paid' && (
            <>{/* 成功片段包裹 */}
              <strong className="ok">{tr(locale, 'web.return.success')}</strong>{/* 成功主标题 */}
              <p className="hint">{/* 渠道与金额一行容器 */}
                {providerLabel(locale, intent.provider)} · {formatCurrency(intent.amount_cents, 'CNY', locale)}{/* 渠道名与实付金额 */}
              </p>{/* 渠道名与实付金额一行展示 */}
              <button type="button" className="btn primary" onClick={() => navigatePath(pathOf('account'))}>{/* 回到个人中心主按钮 */}
                {tr(locale, 'web.checkout.back')}{/* 回到个人中心按钮文案 */}
              </button>{/* 结束成功态按钮 */}
            </>
          )}
          {/* 支付失败分支：失败提示 + 可重新发起支付 */}
          {status === 'failed' && (
            <>{/* 失败片段包裹 */}
              <strong className="danger">{tr(locale, 'web.return.failed')}</strong>{/* 失败主标题 */}
              <p className="hint">{locale === 'en-US' ? 'Payment was not completed. You can try again.' : '支付未完成，可重新发起支付。'}</p>{/* 失败说明，按语言取一侧 */}
              <button type="button" className="btn ghost" onClick={() => navigatePath(pathOf('checkout'))}>{/* 重新发起支付按钮 */}
                {tr(locale, 'web.common.payNow')}{/* 重新发起支付按钮文案 */}
              </button>{/* 结束失败态按钮 */}
            </>
          )}
        </section>
      )}
    </div>
  );
}
