// 引入 useState：记录正在解锁的模块编码与提示信息
import { useState } from 'react';
// 引入 Locale 类型：约束语言取值为 'zh-CN' | 'en-US'
import type { Locale } from '@mim/i18n';
// 引入接口客户端与错误文案翻译器
import { api, errorText } from '../api';
// 引入通用异步加载钩子：统一处理 loading / error / reload
import { useAsync } from '../hooks';

// 组件对外契约：商城文案跟随全局语言
interface Props {
  // 当前界面语言
  locale: Locale;
}

// 模块卡片结构：与 /catalog 接口返回的字段一一对应
interface ModuleCard {
  // 模块唯一编码，作为列表 key 与解锁入参
  code: string;
  // 模块名称的多语言映射，键为 locale
  name: Record<string, string>;
  // 模块简介的多语言映射
  summary: Record<string, string>;
  // 解锁方式：当前仅支持一次性买断
  unlock_mode: 'one_time';
  // 模块归属区域，用于区分中国区与海外区
  region: string;
  // 模块状态，例如上架 / 下架
  status: string;
  // 前置模块编码列表：需先解锁这些模块才能购买本模块
  requires: string[];
  // 当前售价；null 表示免费模块
  current_price: { currency: string; amount_minor: number } | null;
}

// 从多语言映射中挑选当前语言的文案，缺失时逐级兜底
function pick(locale: Locale, map: Record<string, string> | undefined, fallback = ''): string {
  // 映射为空时直接返回兜底值，避免后续取值报错
  if (!map) return fallback;
  // 优先当前语言，其次中文、英文，再退化为任意一种语言，最后用兜底值
  return map[locale] ?? map['zh-CN'] ?? map['en-US'] ?? Object.values(map)[0] ?? fallback;
}

// 商城视图：展示可解锁的功能模块，并提供一次性解锁入口
export function Store({ locale }: Props) {
  // 拉取模块目录；依赖数组为空表示只在挂载时请求一次
  const modulesState = useAsync(() => api.catalog.getModules(), []);
  // 拉取当前用户已购权益，用于在卡片上标注「已解锁」
  const entState = useAsync(() => api.catalog.getMyEntitlements(), []);
  // 正在解锁的模块编码：用于只禁用被点击的那一个按钮
  const [busyCode, setBusyCode] = useState<string | null>(null);
  // 错误提示：解锁失败时展示，null 表示无错误
  const [error, setError] = useState<string | null>(null);
  // 成功提示：解锁成功后展示，null 表示无提示
  const [message, setMessage] = useState<string | null>(null);

  // 模块列表本体，接口未返回时兜底为空数组；断言为卡片结构便于字段访问
  const modules = (modulesState.data?.modules ?? []) as ModuleCard[];
  // 已解锁模块编码集合：用 Set 让卡片内的判断保持 O(1)
  const unlocked = new Set((entState.data?.entitlements ?? []).map((e) => e.module_code));
  // 两个接口任一仍在加载即视为整体加载中，避免出现半屏数据
  const loading = modulesState.loading || entState.loading;

  // 解锁指定模块：一次性买断，成功后刷新权益列表
  async function handleUnlock(code: string) {
    // 记录当前解锁的模块编码，驱动按钮进入加载态
    setBusyCode(code);
    // 清空旧错误
    setError(null);
    // 清空旧成功提示
    setMessage(null);
    try {
      // 调用解锁接口；后端校验前置依赖与区域可用性
      await api.catalog.unlockModule(code);
      // 按语言展示解锁成功提示
      setMessage(locale === 'en-US' ? 'Unlocked ✓' : '解锁成功 ✓');
      // 重新拉取权益，让卡片立即变为「已解锁」并隐藏按钮
      entState.reload();
    } catch (err) {
      // 解锁失败（如缺少前置模块）时展示可读错误
      setError(errorText(locale, err));
    } finally {
      // 解除按钮加载态，允许操作其它模块
      setBusyCode(null);
    }
  }

  // 首屏加载态：只渲染一行提示，避免空白页面
  if (loading) return <div className="hint">{locale === 'en-US' ? 'Loading…' : '加载中…'}</div>;
  // 目录加载失败：直接展示错误，不再渲染商品网格
  if (modulesState.error) return <div className="error">{errorText(locale, modulesState.error)}</div>;

  // 渲染商城页面
  return (
    // 页面容器：统一页面留白与最大宽度
    <div className="page">
      <header className="page-head">{/* 页头：标题 + 解锁规则说明 */}
        <h1>{locale === 'en-US' ? 'Module Store' : '功能模块商城'}</h1>{/* 标题：按语言切换中英文 */}
        <p className="muted">{/* 说明文案：一次性解锁、权益在所属区域持续有效 */}
          {locale === 'en-US' // 按语言选择对应的规则说明
            ? 'Unlock capabilities one-time; active entitlements survive region switch'
            : '一次性解锁，权益在本区持续有效'}{/* 规则说明文案结束 */}
        </p>{/* 结束说明文案 */}
      </header>{/* 结束页头 */}

      {error && <p className="error">{error}</p>}{/* 解锁失败提示 */}
      {message && <p className="success">{message}</p>}{/* 解锁成功提示 */}

      {modules.length === 0 ? ( // 无可用模块时展示占位文案，否则渲染卡片网格
        <p className="hint">{locale === 'en-US' ? 'No modules available in this region.' : '本区暂无可用模块。'}</p> // 空态：说明当前区域没有可售模块
      ) : (
        <div className="grid">{/* 卡片网格容器 */}
          {modules.map((m) => { // 逐个模块渲染卡片
            // 是否已拥有该模块：决定隐藏解锁按钮并显示徽标
            const owned = unlocked.has(m.code);
            // 价格展示文案：有价格时按「元 + 币种」格式化，免费模块显示 Free / 免费
            const price = m.current_price
              ? `${(m.current_price.amount_minor / 100).toFixed(2)} ${m.current_price.currency}`
              : locale === 'en-US' ? 'Free' : '免费';
            // 返回单个模块卡片
            return (
              <section key={m.code} className="card">{/* 卡片容器：以模块编码作为唯一 key */}
                <header className="card-head">{/* 卡片头部：模块名 + 已解锁徽标 */}
                  <h3>{pick(locale, m.name, m.code)}</h3>{/* 模块名：缺失时退化为模块编码 */}
                  {owned && <span className="badge">✓ {locale === 'en-US' ? 'Owned' : '已解锁'}</span>}{/* 已解锁徽标 */}
                </header>{/* 结束卡片头部 */}
                <p className="muted">{pick(locale, m.summary)}</p>{/* 模块简介：按语言挑选 */}
                <div className="card-meta">{/* 卡片元信息：模块编码与价格 */}
                  <code>{m.code}</code>{/* 模块编码，等宽字体便于识别 */}
                  <span>{price}</span>{/* 价格文案 */}
                </div>{/* 结束元信息 */}
                {m.requires.length > 0 && ( // 前置依赖提示：仅在存在前置模块时展示
                  <p className="muted small">{/* 弱化的小号说明行 */}
                    {locale === 'en-US' ? 'Requires' : '前置'}: {m.requires.join(', ')}{/* 「前置」+ 逗号连接的前置模块编码 */}
                  </p> // 结束前置依赖提示
                )}{/* 结束前置依赖条件渲染 */}
                {!owned && ( // 未拥有时才提供解锁按钮
                  <button
                    // 解锁按钮：普通按钮，避免触发表单提交
                    type="button"
                    // 主按钮样式
                    className="btn primary"
                    // 仅禁用正在解锁的这一个按钮，其它卡片仍可操作
                    disabled={busyCode === m.code}
                    // 点击解锁当前模块
                    onClick={() => handleUnlock(m.code)}
                  >
                    {busyCode === m.code // 按钮文案：按「是否本模块加载中 + 语言」四选一
                      ? locale === 'en-US'
                        ? 'Unlocking…'
                        : '解锁中…'
                      : locale === 'en-US'
                        ? 'Unlock'
                        : '解锁'}{/* 按钮文案结束 */}
                  </button> // 结束解锁按钮
                )}{/* 结束解锁按钮条件渲染 */}
              </section> // 结束模块卡片
            );
          })} {/* 结束模块遍历 */}
        </div> // 结束卡片网格
      )}{/* 结束空态 / 网格条件渲染 */}
    </div>
    // 商城页渲染结束，返回 JSX 元素
  );
}
