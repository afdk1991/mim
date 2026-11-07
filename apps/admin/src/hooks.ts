// React 状态与副作用钩子：本文件只放跨视图复用的通用逻辑
import { useCallback, useEffect, useRef, useState } from 'react';

/** 异步加载统一状态：数据、错误、加载中与手动重载 */
export interface AsyncState<T> {
  // 成功返回的数据；未完成或失败时为 null
  data: T | null;
  // 失败时的原始错误对象，交由视图决定如何提示
  error: unknown;
  // 是否处于请求进行中
  loading: boolean;
  // 手动触发重新加载，用于操作成功后刷新列表
  reload: () => void;
}

/**
 * useAsync：按依赖变化自动执行 loader，并在卸载后丢弃过期结果。
 * deps 语义与 useEffect 一致，调用方需显式传入避免每次渲染都重新请求。
 */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  // 数据状态
  const [data, setData] = useState<T | null>(null);
  // 错误状态
  const [error, setError] = useState<unknown>(null);
  // 加载状态：初始为 true，首帧即展示占位
  const [loading, setLoading] = useState(true);
  // 自增计数器：reload 时改变依赖，触发重新执行
  const [tick, setTick] = useState(0);
  // 用 ref 保存最新的 loader，避免把它放进依赖导致无限循环
  const loaderRef = useRef(loader);
  // 每次渲染同步最新 loader 引用
  loaderRef.current = loader;
  useEffect(() => {
    // 标记本次请求是否已过期（组件卸载或依赖变化）
    let cancelled = false;
    // 进入请求即置为加载中
    setLoading(true);
    // 执行加载函数
    loaderRef.current()
      .then((value) => {
        // 过期结果直接丢弃，避免卸载后 setState 告警
        if (cancelled) return;
        // 写入数据
        setData(value);
        // 成功后清空历史错误
        setError(null);
      })
      .catch((err: unknown) => {
        // 过期错误同样丢弃
        if (!cancelled) setError(err);
      })
      .finally(() => {
        // 只有未过期时才结束加载态
        if (!cancelled) setLoading(false);
      });
    // 清理函数：下一次执行或卸载时把本次标记为过期
    return () => {
      cancelled = true;
    };
    // 依赖数组展开 + tick：deps 变化或手动 reload 都会重新请求
  }, [...deps, tick]);
  // reload 用 useCallback 固定引用，避免作为依赖时反复变化
  const reload = useCallback(() => setTick((value) => value + 1), []);
  // 返回聚合状态
  return { data, error, loading, reload };
}
