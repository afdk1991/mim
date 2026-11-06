// 领取所需 Hooks：缓存回调、注册副作用、保存可变引用、声明状态
import { useCallback, useEffect, useRef, useState } from 'react';

// 异步加载结果契约：页面只需消费这四项，不必关心内部实现
export interface AsyncState<T> {
  // 加载成功后的数据；未完成或失败时为 null
  data: T | null;
  // 失败原因；保留 unknown 让调用方自行收窄，避免强转掩盖问题
  error: unknown;
  // 是否处于请求中，供页面显示骨架屏或禁用按钮
  loading: boolean;
  // 手动重跑加载（如「重试」按钮），不改变调用方入参
  reload: () => void;
} // 契约定义结束

/** 极简数据加载 hook：loading / data / error / 手动 reload，卸载后丢弃结果 */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []): AsyncState<T> { // deps 语义同 useEffect：变化即重拉，默认空数组表示只拉一次
  // 数据状态：初始 null，加载成功后写入
  const [data, setData] = useState<T | null>(null);
  // 错误状态：初始 null 表示尚无错误
  const [error, setError] = useState<unknown>(null);
  // 加载状态：初始 true，保证首帧就渲染「加载中」而不是空态
  const [loading, setLoading] = useState(true);
  // 自增计数器：reload 时加一，作为副作用依赖触发重跑
  const [tick, setTick] = useState(0);
  // 用 ref 保存最新 loader，避免每次渲染因函数引用变化而重复请求
  const loaderRef = useRef(loader);
  // 渲染期同步最新 loader 即可，无需额外副作用
  loaderRef.current = loader;

  // 依赖变化（含 reload 触发的 tick）时重新拉取数据
  useEffect(() => {
    // 作废标记：卸载或被新请求取代后，丢弃这次的结果
    let cancelled = false;
    // 进入加载态
    setLoading(true);
    // 调用最新 loader（返回 Promise）
    loaderRef
      // 取出并立即执行，得到本次请求的 Promise
      .current()
      // 成功分支
      .then((value) => {
        // 已作废则直接返回，避免过期数据覆盖新结果
        if (cancelled) return;
        // 写入数据
        setData(value);
        // 成功后清空旧错误，防止残留的报错提示
        setError(null);
      })
      // 失败分支：保留原始错误对象交给调用方判断
      .catch((err: unknown) => {
        // 仅在仍有效时写入错误
        if (!cancelled) setError(err);
      })
      // 无论成败都要收尾，防止 loading 永久为 true
      .finally(() => {
        // 仍有效时退出加载态
        if (!cancelled) setLoading(false);
      });
    // 清理函数：卸载或依赖变化时执行
    return () => {
      // 标记本次请求作废
      cancelled = true;
    };
    // 依赖展开 deps 并附上 tick，使 reload 能触发重跑
  }, [...deps, tick]);

  // reload 引用保持稳定，供子组件安全地放入依赖数组
  const reload = useCallback(() => setTick((value) => value + 1), []);

  // 暴露统一契约，调用方无需感知内部状态拆分
  return { data, error, loading, reload };
} // useAsync 定义结束
