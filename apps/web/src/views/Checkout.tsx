/**
 * 统一收银台：支付意图二维码 / 渠道唤起 / 状态轮询 / 三态结果。
 *
 * 入口两种：
 * 1. 已有意图：/checkout?intent=<id>
 * 2. 现场创建：/checkout?purpose=asset&ref=<code>&provider=alipay
 * 状态轮询仅前端展示用途，履约以后端回调 / 线下确认为准。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatCurrency, type Locale } from '@mim/i18n';
import { api, errorText } from '../api';
import type { PaymentIntent, PaymentProvider } from '../api';
import { navigatePath, pathOf } from '../router';
import {
  classifyIntentStatus,
  parseIntentQuery,
  resolvePaymentLaunch,
  type IntentUiStatus,
} from '../lib/payments';
import { providerLabel } from '../lib/checkout';
import { tr } from '../lib/messages';
import { QrCode } from '../components/QrCode';

interface Props {
  locale: Locale;
}

const POLL_MS = 5000; // 待支付状态轮询间隔

/** 用途白名单（与后端 zod 枚举一致） */
const PURPOSES = ['shop_order', 'vip', 'asset', 'recharge'] as const;
type Purpose = (typeof PURPOSES)[number];

export function Checkout({ locale }: Props) {
  const queryRef = useRef(parseIntentQuery(typeof window === 'undefined' ? '' : window.location.search));
  const [intent, setIntent] = useState<PaymentIntent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<IntentUiStatus>('pending');
  const timerRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const load = useCallback(async (intentId: string) => {
    const res = await api.commerce.getIntent(intentId);
    setIntent(res.intent);
    setStatus(classifyIntentStatus(res.intent.status));
    return res.intent;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const q = queryRef.current;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        let intentId = q.intentId;
        if (!intentId) {
          // 无意图编号：按用途 / 关联对象现场创建
          const purpose = PURPOSES.find((p) => p === q.purpose) as Purpose | undefined;
          if (!purpose || !q.refId) throw new Error('missing intent reference');
          const created = await api.commerce.createIntent({
            purpose,
            ref_id: q.refId,
            provider: (q.provider ?? 'alipay') as PaymentProvider,
          });
          intentId = created.intent.id;
        }
        const first = await load(intentId);
        if (cancelled) return;
        if (classifyIntentStatus(first.status) === 'pending') {
          timerRef.current = window.setInterval(() => {
            void load(intentId)
              .then((fresh) => {
                if (classifyIntentStatus(fresh.status) !== 'pending') stopPolling();
              })
              .catch(() => {
                /* 单次轮询失败保留轮询，下次再试 */
              });
          }, POLL_MS);
        }
      } catch (err) {
        if (!cancelled) setError(errorText(locale, err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [load, locale, stopPolling]);

  const launch = intent
    ? resolvePaymentLaunch(
        intent.provider,
        intent.pay_url,
        intent.qr_text,
        typeof navigator !== 'undefined' ? navigator.userAgent : '',
      )
    : null;

  const qrContent = intent?.qr_text ?? intent?.pay_url ?? intent?.id ?? '';

  function openScheme() {
    if (launch?.scheme) window.location.href = launch.scheme;
  }

  const schemeLabel =
    intent?.provider === 'wechat' ? tr(locale, 'web.checkout.openWechat') : tr(locale, 'web.checkout.openAlipay');

  return (
    <div className="page checkout-page">
      <header className="page-head">
        <h1>{tr(locale, 'web.checkout.title')}</h1>
        <button type="button" className="btn ghost" onClick={() => navigatePath(pathOf('account'))}>
          {tr(locale, 'web.checkout.back')}
        </button>
      </header>

      {loading ? <div className="hint">{tr(locale, 'web.player.loading')}</div> : null}
      {error ? (
        <section className="panel danger">
          <p className="error">{error}</p>
          <button type="button" className="btn ghost" onClick={() => window.location.reload()}>
            {tr(locale, 'web.common.retry')}
          </button>
        </section>
      ) : null}

      {intent && !error && (
        <section className="panel checkout-panel">
          <div className="checkout-meta">
            <div>
              <span className="hint">{tr(locale, 'web.checkout.amount')}</span>
              <strong className="checkout-amount">{formatCurrency(intent.amount_cents, 'CNY', locale)}</strong>
            </div>
            <div>
              <span className="hint">{tr(locale, 'web.checkout.provider')}</span>
              <span className="deploy-badge muted">{providerLabel(locale, intent.provider)}</span>
            </div>
          </div>

          <div className="checkout-qr">
            <QrCode text={qrContent} size={188} />
            <span className="hint">{tr(locale, 'web.checkout.qrHint')}</span>
          </div>

          <div className="checkout-actions">
            {launch?.scheme ? (
              <button type="button" className="btn primary" onClick={openScheme}>
                {schemeLabel}
              </button>
            ) : null}
            {intent.pay_url && !launch?.scheme ? (
              <a className="btn primary" href={intent.pay_url} target="_blank" rel="noreferrer">
                {tr(locale, 'web.checkout.openAlipay')}
              </a>
            ) : null}
            <button type="button" className="btn ghost" onClick={() => void load(intent.id)}>
              {tr(locale, 'web.checkout.refresh')}
            </button>
          </div>

          {intent.provider === 'manual' ? <p className="hint">{tr(locale, 'web.checkout.manualNote')}</p> : null}
          {intent.provider === 'sandbox' ? <p className="hint">{tr(locale, 'web.checkout.sandboxNote')}</p> : null}
          {launch?.note === 'wechat-hint' ? <p className="hint">{tr(locale, 'web.checkout.wechatHint')}</p> : null}

          <div className={`checkout-status is-${status}`}>
            {status === 'pending' && <span>{tr(locale, 'web.checkout.pending')}</span>}
            {status === 'paid' && <span>{tr(locale, 'web.checkout.success')}</span>}
            {status === 'failed' && (
              <span>
                {intent.status === 'cancelled' ? tr(locale, 'web.checkout.cancelled') : tr(locale, 'web.checkout.failed')}
              </span>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
