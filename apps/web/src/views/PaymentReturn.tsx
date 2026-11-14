/**
 * 支付回跳承接页：渠道回跳 / 外部跳转落地后，按意图编号查询支付结果三态。
 * 成功 / 处理中 / 失败（含取消）三态展示；轮询有上限，超时后停在处理中并允许手动刷新。
 */

import { useEffect, useRef, useState } from 'react';
import { formatCurrency, type Locale } from '@mim/i18n';
import { api, errorText } from '../api';
import type { PaymentIntent } from '../api';
import { navigatePath, pathOf } from '../router';
import { classifyIntentStatus, parseIntentQuery, type IntentUiStatus } from '../lib/payments';
import { providerLabel } from '../lib/checkout';
import { tr } from '../lib/messages';

interface Props {
  locale: Locale;
}

const POLL_MS = 4000; // 轮询间隔
const MAX_POLLS = 12; // 最多轮询 12 次（约 48 秒），之后停止自动轮询

export function PaymentReturn({ locale }: Props) {
  const queryRef = useRef(parseIntentQuery(typeof window === 'undefined' ? '' : window.location.search));
  const [intent, setIntent] = useState<PaymentIntent | null>(null);
  const [status, setStatus] = useState<IntentUiStatus>('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const attemptsRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const intentId = queryRef.current.intentId;

    if (!intentId) {
      setError('missing intent');
      setLoading(false);
      return;
    }

    const refresh = async () => {
      try {
        const res = await api.commerce.getIntent(intentId);
        if (cancelled) return;
        setIntent(res.intent);
        setStatus(classifyIntentStatus(res.intent.status));
        return res.intent;
      } catch (err) {
        if (!cancelled) setError(errorText(locale, err));
        return null;
      }
    };

    void refresh().then((first) => {
      if (cancelled) return;
      setLoading(false);
      if (first && classifyIntentStatus(first.status) === 'pending') {
        timer = window.setInterval(() => {
          attemptsRef.current += 1;
          void refresh().then((fresh) => {
            if (!fresh) return;
            if (classifyIntentStatus(fresh.status) !== 'pending' || attemptsRef.current >= MAX_POLLS) {
              if (timer !== null) window.clearInterval(timer);
            }
          });
        }, POLL_MS);
      }
    });

    return () => {
      cancelled = true;
      if (timer !== null) window.clearInterval(timer);
    };
  }, [locale]);

  return (
    <div className="page pay-return-page">
      <header className="page-head">
        <h1>{tr(locale, 'web.return.title')}</h1>
        <button type="button" className="btn ghost" onClick={() => navigatePath(pathOf('account'))}>
          {tr(locale, 'web.checkout.back')}
        </button>
      </header>

      {loading ? <div className="hint">{tr(locale, 'web.player.loading')}</div> : null}
      {error ? <section className="panel danger"><p className="error">{error}</p></section> : null}

      {intent && !error && (
        <section className={`panel pay-result is-${status}`}>
          {status === 'pending' && (
            <>
              <strong>{tr(locale, 'web.return.processing')}</strong>
              <p className="hint">
                {providerLabel(locale, intent.provider)} · {formatCurrency(intent.amount_cents, 'CNY', locale)}
              </p>
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  void api.commerce.getIntent(intent.id).then((res) => {
                    setIntent(res.intent);
                    setStatus(classifyIntentStatus(res.intent.status));
                  });
                }}
              >
                {tr(locale, 'web.checkout.refresh')}
              </button>
            </>
          )}
          {status === 'paid' && (
            <>
              <strong className="ok">{tr(locale, 'web.return.success')}</strong>
              <p className="hint">
                {providerLabel(locale, intent.provider)} · {formatCurrency(intent.amount_cents, 'CNY', locale)}
              </p>
              <button type="button" className="btn primary" onClick={() => navigatePath(pathOf('account'))}>
                {tr(locale, 'web.checkout.back')}
              </button>
            </>
          )}
          {status === 'failed' && (
            <>
              <strong className="danger">{tr(locale, 'web.return.failed')}</strong>
              <p className="hint">{intent.status}</p>
              <button type="button" className="btn ghost" onClick={() => navigatePath(pathOf('checkout'))}>
                {tr(locale, 'web.common.payNow')}
              </button>
            </>
          )}
        </section>
      )}
    </div>
  );
}
