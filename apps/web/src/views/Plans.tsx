import { useState } from 'react';
import { formatCurrency, t } from '@mim/i18n';
import type { Locale } from '@mim/i18n';
import { api, errorText } from '../api';
import type { BillingCycle, PlanCatalogItem } from '../api';
import { useAsync } from '../hooks';

interface Props {
  locale: Locale;
}

export function Plans({ locale }: Props) {
  const state = useAsync(async () => {
    const me = await api.me();
    const [catalog, orders] = await Promise.all([api.plans(me.user.region), api.orders()]);
    return { me, catalog: catalog.items, orders: orders.items };
  }, []);
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function buy(item: PlanCatalogItem) {
    if (!window.confirm(`${t(locale, 'plans.buy')} · ${item.name_zh} / ${item.name_en}`)) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api.checkout(item.id, cycle);
      setMessage(`${t(locale, 'plans.buy')} ✓`);
      state.reload();
    } catch (err) {
      setError(errorText(locale, err));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!window.confirm(t(locale, 'plans.cancel'))) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api.cancelSubscription();
      setMessage(`${t(locale, 'plans.cancel')} ✓`);
      state.reload();
    } catch (err) {
      setError(errorText(locale, err));
    } finally {
      setBusy(false);
    }
  }

  if (state.loading) return <div className="hint">{t(locale, 'common.loading')}</div>;
  if (state.error || !state.data) {
    return <div className="error">{errorText(locale, state.error)}</div>;
  }

  const { me, catalog, orders } = state.data;
  const currentPlan = me.plan.id;
  const canCancel =
    me.subscription !== null && me.subscription.status === 'active' && me.subscription.cancel_at_period_end === 0;

  return (
    <div className="page">
      <header className="page-head">
        <h1>{t(locale, 'nav.plans')}</h1>
        <span className="muted">
          {t(locale, 'plan.current')}: {locale === 'zh-CN' ? me.plan.name_zh : me.plan.name_en}
          {me.plan.expires_at ? ` · ${me.plan.expires_at.slice(0, 10)}` : ''}
        </span>
      </header>

      {error && <p className="error">{error}</p>}
      {message && <p className="success">{message}</p>}

      <div className="row">
        <div className="segmented">
          <button
            type="button"
            className={cycle === 'monthly' ? 'active' : ''}
            onClick={() => setCycle('monthly')}
          >
            {t(locale, 'plan.monthly')}
          </button>
          <button
            type="button"
            className={cycle === 'yearly' ? 'active' : ''}
            onClick={() => setCycle('yearly')}
          >
            {t(locale, 'plan.yearly')}
          </button>
        </div>
        {canCancel && (
          <button type="button" className="btn ghost" onClick={cancel} disabled={busy}>
            {t(locale, 'plans.cancel')}
          </button>
        )}
      </div>

      <div className="plan-grid">
        {catalog.map((item) => {
          const price = item.prices[cycle];
          const isCurrent = item.id === currentPlan;
          const purchasable = item.configured && price !== null && !isCurrent;
          return (
            <section className={`panel plan-card${isCurrent ? ' current' : ''}`} key={item.id}>
              <header className="panel-head">
                <h2>{locale === 'zh-CN' ? item.name_zh : item.name_en}</h2>
                {isCurrent && <span className="badge role-owner">{t(locale, 'plan.current')}</span>}
              </header>
              <p className="muted">
                {locale === 'zh-CN' ? item.description_zh : item.description_en}
              </p>
              <div className="plan-price">
                {price === null
                  ? t(locale, 'plan.notConfigured')
                  : formatCurrency(price, item.currency, locale)}
              </div>
              <button
                type="button"
                className="btn primary block"
                disabled={!purchasable || busy}
                onClick={() => buy(item)}
              >
                {isCurrent ? t(locale, 'plan.current') : t(locale, 'plans.buy')}
              </button>
            </section>
          );
        })}
      </div>

      <section className="panel">
        <header className="panel-head">
          <h2>{t(locale, 'plans.orders')}</h2>
          <span className="count">{orders.length}</span>
        </header>
        {orders.length === 0 ? (
          <p className="empty">{t(locale, 'plans.noOrders')}</p>
        ) : (
          <table className="order-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>{t(locale, 'settings.plan')}</th>
                <th>{t(locale, 'plans.price')}</th>
                <th>Status</th>
                <th>{t(locale, 'plans.createdAt')}</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td>
                    <code>{order.id.slice(0, 8)}</code>
                  </td>
                  <td>{order.plan_id}</td>
                  <td>{formatCurrency(order.amount_minor, order.currency, locale)}</td>
                  <td>{order.status}</td>
                  <td>{order.created_at.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
