/**
 * 公开定价与权益页（/pricing，匿名可读）。
 *
 * 展示口径：会员档位卡（名称 / 价格 / 计费周期 / 一句话定位 / 权益清单）+ 权益对比表 +
 * 脚注（平台服务费、退款规则入口、生效日期）。价格、周期、权益全部来自后端公开配置
 * （GET /api/v1/vip/pricing/public），本视图不硬编码任何价格与权益文案。
 *
 * 借鉴落点：
 *   - Revolut（https://www.revolut.com/pricing）：按人群定位分档，每档一句话讲清适合谁；
 *   - Shopify（https://www.shopify.com/pricing）：费率 / 周期与权益同屏对比，逐项勾选；
 *   - HubSpot 定价页 FAQ 折叠（https://www.hubspot.com/pricing）：脚注把退款 / 帮助入口与政策日期说清。
 *
 * 样式只复用既有类名组合，不改共享 styles.css；本视图不发起任何写操作。
 */

import { useEffect, useState } from 'react'; // 状态与副作用
import type { Locale } from '@mim/i18n'; // 语言类型
import { api, errorText } from '../api'; // 接口客户端与统一错误文案
import type { PublicPricingLegal, PublicPricingPlan, PublicPricingPolicy, PublicPricingResponse } from '../api'; // 公开定价响应类型
import { EmptyState } from '../empty-state'; // 空态共享组件
import { yuan } from './community/format'; // 金额格式化（分 → 人民币展示）
import { legalPath, navigatePath } from '../router'; // 站内合规深链接跳转
import { buildPricingComparison } from '../api/endpoints.js'; // 权益对比整形纯函数

/** 计费周期文案：按后端 duration_days 派生展示口径，天数本身仍以后端配置为准 */
function periodLabel(days: number): string {
  if (days >= 3650) return '终身'; // 超长周期按终身档展示
  if (days >= 365) return '年'; // 满一年按年计费展示
  if (days >= 30) return '月'; // 满一月按月计费展示
  return `${days} 天`; // 其余按天数如实展示
} // periodLabel 结束

/** 档位一句话定位：vip_plans 表无描述列，按 level 派生标签；价格 / 周期 / 权益仍全部来自接口 */
function positioning(level: number, locale: Locale): string {
  if (locale === 'en-US') { // 英文文案分支
    if (level <= 1) return 'Starter plan: core perks for first-time members'; // 入门档
    if (level === 2) return 'Growth plan: more community and content perks'; // 进阶档
    return 'Lifetime plan: one purchase, long-term access'; // 终身档
  } // 英文分支结束
  if (level <= 1) return '基础会员，先体验核心内容与社区权益'; // 入门档定位
  if (level === 2) return '进阶会员，长期享有更多内容与社区权益'; // 进阶档定位
  return '终身会员，一次开通长期有效'; // 终身档定位
} // positioning 结束

/** 后端合规路径 → 合规页子类型：识别尾段，回落兜底类型 */
function legalKindOf(path: string, fallback: 'refund' | 'help'): 'refund' | 'help' {
  if (path.endsWith('/refund')) return 'refund'; // 退款与售后说明
  if (path.endsWith('/help')) return 'help'; // 帮助中心
  return fallback; // 兜底类型
} // legalKindOf 结束

/** 视图入参：当前界面语言由 App 统一下发 */
interface PricingProps {
  locale: Locale; // 当前语言
} // 入参结构结束

/** 公开定价与权益页组件：匿名拉取公开配置，失败 / 空配置均有兜底，不跳登录 */
export function Pricing({ locale }: PricingProps) {
  const [plans, setPlans] = useState<PublicPricingPlan[]>([]); // 档位列表（空数组即未配置）
  const [policy, setPolicy] = useState<PublicPricingPolicy | null>(null); // 服务费 / 生效日期脚注口径
  const [legal, setLegal] = useState<PublicPricingLegal | null>(null); // 退款 / 帮助中心入口路径
  const [loading, setLoading] = useState(true); // 首屏骨架标记
  const [error, setError] = useState<string | null>(null); // 局部错误提示

  useEffect(() => { // 挂载后拉取公开定价配置；卸载后不再写状态
    let alive = true; // 卸载标记：避免异步回调更新已卸载组件
    void api.vip.publicPricing() // 匿名只读公开接口
      .then((data: PublicPricingResponse) => { // 成功回写三部分状态
        if (!alive) return; // 已卸载直接放弃
        setPlans(data.plans); // 档位列表
        setPolicy(data.policy); // 脚注策略口径
        setLegal(data.legal); // 合规入口
      }) // 成功分支结束
      .catch((err: unknown) => { if (alive) setError(errorText(locale, err)); }) // 失败统一转本地化文案
      .finally(() => { if (alive) setLoading(false); }); // 关闭骨架
    return () => { alive = false; }; // 清理卸载标记
  }, [locale]); // 语言切换时重取文案口径

  const comparison = buildPricingComparison(plans); // 权益对比矩阵：纯函数按首次出现顺序汇总

  /** 跳合规静态页：走站内路由，兼容子路径部署前缀 */
  function openLegal(path: string, fallback: 'refund' | 'help'): void {
    navigatePath(legalPath(legalKindOf(path, fallback))); // 写地址栏并广播路由事件
  } // openLegal 结束

  return (
    <div className="page">{/* 页面容器：标题、档位卡、对比表、脚注自上而下 */}
      <div className="page-head">{/* 页面标题行 */}
        <div>
          <h1>{locale === 'en-US' ? 'Pricing & Perks' : '定价与权益'}</h1>
          <p className="muted">{locale === 'en-US' ? 'Membership plans, included perks and service fees are listed below.' : '会员档位、包含权益与平台服务费一览，价格与权益以下方公开配置为准。'}</p>
        </div>
      </div>

      {loading && <div className="hint">{locale === 'en-US' ? 'Loading…' : '加载中…'}</div>}

      {!loading && error && ( // 拉取失败：错误说明 + 重试出口，不白屏
        <div className="panel">
          <p className="error">{error}</p>
          <button type="button" className="btn primary" onClick={() => window.location.reload()}>
            {locale === 'en-US' ? 'Retry' : '重试'}
          </button>
        </div>
      )}

      {!loading && !error && plans.length === 0 && ( // 未配置档位：共享空态兜底
        <EmptyState
          kind="set" // 配置类空态插图
          title={locale === 'en-US' ? 'No membership plan configured yet' : '暂未配置会员档位'}
          hint={locale === 'en-US' ? 'Plans will appear here once they are published.' : '档位配置发布后将在此展示，价格与权益以本站后台配置为准。'}
        />
      )}

      {!loading && !error && plans.length > 0 && (
        <>
          <div className="community-plan-grid">{/* 档位卡横排：复用既有会员套餐网格 */}
            {plans.map((plan) => ( // 逐档渲染卡片
              <article key={plan.code} className="community-plan">
                <span className="community-plan-level">LV {plan.level}</span>
                <h3>{plan.name}</h3>
                <p className="muted">{positioning(plan.level, locale)}</p>
                <strong className="community-plan-price">
                  {yuan(plan.price_cents)}
                  <small> / {periodLabel(plan.duration_days)}</small>
                </strong>
                <ul>{plan.perks.map((perk) => <li key={perk}>{perk}</li>)}</ul>
              </article>
            ))}
          </div>

          {comparison.length > 0 && ( // 权益对比表：有交叉权益才渲染
            <div className="panel">
              <div className="community-section-head">
                <div>
                  <h2>{locale === 'en-US' ? 'Perk comparison' : '权益对比'}</h2>
                  <p className="muted">{locale === 'en-US' ? 'Checkmarks show which plan includes each perk.' : '逐档勾选各档位包含的权益。'}</p>
                </div>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>{locale === 'en-US' ? 'Perk' : '权益'}</th>
                    {plans.map((plan) => <th key={plan.code}>{plan.name}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {comparison.map((row) => ( // 每行一条权益，各档逐项勾选 / 留空
                    <tr key={row.feature}>
                      <td>{row.feature}</td>
                      {plans.map((plan) => (
                        <td key={plan.code}>{row.included[plan.code] ? '✓' : '—'}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <footer className="muted">{/* 脚注：服务费口径、政策生效日期、合规入口 */}
            <p>
              {locale === 'en-US'
                ? `Platform service fee: ${policy && policy.platform_service_fee_cents > 0 ? yuan(policy.platform_service_fee_cents) : '0'} · Effective ${policy?.effective_date ?? '—'}`
                : `平台服务费 ${policy && policy.platform_service_fee_cents > 0 ? yuan(policy.platform_service_fee_cents) : '0'} · 政策生效日期：${policy?.effective_date ?? '—'}`}
            </p>
            <p>
              {legal && (
                <>
                  <button type="button" className="btn ghost" onClick={() => openLegal(legal.refund_path, 'refund')}>
                    {locale === 'en-US' ? 'Refund policy' : '退款说明'}
                  </button>{' '}
                  <button type="button" className="btn ghost" onClick={() => openLegal(legal.help_path, 'help')}>
                    {locale === 'en-US' ? 'Help center' : '帮助中心'}
                  </button>
                </>
              )}
            </p>
          </footer>
        </>
      )}
    </div>
  );
} // Pricing 组件结束
