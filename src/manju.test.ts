/**
 * 漫剧模块单元测试（node 环境，无 jsdom）
 *
 * 覆盖两层：
 * - 纯函数：mkEps / seedState / isExtItem
 * - 本地持久化：loadManju / saveManju（localStorage stub）
 *
 * 注：红果外部目录 fetch 适配层（extUrl / loadHgIndex / loadHgItems）已随
 * 「彻底下线红果」方案移除，相关用例同步删除。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isExtItem, loadManju, mkEps, saveManju, seedState } from './manju';

/* ============ 公共工具 ============ */

/** 内存版 localStorage，替代浏览器原生实现 */
function makeStore(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
  };
}

/** setItem 必抛异常的 localStorage（模拟隐私模式写入失败） */
function makeThrowStore() {
  return {
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
    removeItem: () => undefined,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ============ 纯函数 ============ */

describe('mkEps', () => {
  it('生成指定数量的剧集，id 补零、index 从 1 递增', () => {
    const eps = mkEps('s_demo1', 3, 1);
    expect(eps).toHaveLength(3);
    expect(eps.map((e) => e.id)).toEqual(['s_demo1_e01', 's_demo1_e02', 's_demo1_e03']);
    expect(eps.map((e) => e.index)).toEqual([1, 2, 3]);
  });

  it('durationSec 按公式 80 + (i*37) % 70 生成', () => {
    const eps = mkEps('s_x', 4, 0);
    expect(eps.map((e) => e.durationSec)).toEqual([80, 117, 84, 121]);
  });

  it('前 freeN 集为免费，其余收费', () => {
    const eps = mkEps('s_x', 3, 1);
    expect(eps.map((e) => e.free)).toEqual([true, false, false]);
  });

  it('freeN 为 0 时全部收费', () => {
    expect(mkEps('s_x', 2, 0).every((e) => !e.free)).toBe(true);
  });
});

describe('seedState', () => {
  it('返回全空初始状态', () => {
    expect(seedState()).toEqual({
      favorites: [],
      seen: [],
      progress: {},
      customExt: [],
    });
  });
});

describe('isExtItem', () => {
  it('id/title 为 string 且 cat 为 comic/ai 时通过', () => {
    expect(isExtItem({ id: 'x1', title: 'T', cat: 'comic' })).toBe(true);
    expect(isExtItem({ id: 'x2', title: 'T', cat: 'ai' })).toBe(true);
  });

  it('非法输入返回 false', () => {
    expect(isExtItem(null)).toBe(false);
    expect(isExtItem(undefined)).toBe(false);
    expect(isExtItem('str')).toBe(false);
    expect(isExtItem(42)).toBe(false);
    expect(isExtItem({ id: 'x', title: 'T', cat: 'other' })).toBe(false);
    expect(isExtItem({ title: 'T', cat: 'comic' })).toBe(false); // 缺 id
    expect(isExtItem({ id: 'x', cat: 'comic' })).toBe(false); // 缺 title
  });
});

/* ============ 本地持久化 ============ */

describe('loadManju', () => {
  it('无存档时返回 seedState', () => {
    vi.stubGlobal('localStorage', makeStore());
    expect(loadManju()).toEqual(seedState());
  });

  it('JSON 非法时返回 seedState', () => {
    vi.stubGlobal('localStorage', makeStore({ 'mim-manju-v1': '{broken json' }));
    expect(loadManju()).toEqual(seedState());
  });

  it('结构缺字段（favorites 非数组等）返回 seedState', () => {
    vi.stubGlobal(
      'localStorage',
      makeStore({ 'mim-manju-v1': JSON.stringify({ favorites: 'nope', seen: [], progress: {} }) }),
    );
    expect(loadManju()).toEqual(seedState());
  });

  it('顶层非对象（数组/字符串）返回 seedState', () => {
    vi.stubGlobal('localStorage', makeStore({ 'mim-manju-v1': JSON.stringify([1, 2]) }));
    expect(loadManju()).toEqual(seedState());
  });

  it('favorites/seen 过滤非 string 项', () => {
    vi.stubGlobal(
      'localStorage',
      makeStore({
        'mim-manju-v1': JSON.stringify({
          favorites: ['a', 1, null, 'b'],
          seen: ['s1', { x: 1 }, 's2'],
          progress: {},
          customExt: [],
        }),
      }),
    );
    const st = loadManju();
    expect(st.favorites).toEqual(['a', 'b']);
    expect(st.seen).toEqual(['s1', 's2']);
  });

  it('progress 仅保留有限非负数并向下取整', () => {
    vi.stubGlobal(
      'localStorage',
      makeStore({
        'mim-manju-v1': JSON.stringify({
          favorites: [],
          seen: [],
          progress: { k1: 12.7, k2: -1, k3: Infinity, k4: NaN, k5: 'x', k6: 0 },
          customExt: [],
        }),
      }),
    );
    expect(loadManju().progress).toEqual({ k1: 12, k6: 0 });
  });

  it('customExt 按 isExtItem 过滤非法条目', () => {
    vi.stubGlobal(
      'localStorage',
      makeStore({
        'mim-manju-v1': JSON.stringify({
          favorites: [],
          seen: [],
          progress: {},
          customExt: [
            { id: 'c1', title: 'T', cat: 'comic' },
            { id: 'c2', title: 'T', cat: 'bad' },
            null,
            'junk',
          ],
        }),
      }),
    );
    const st = loadManju();
    expect(st.customExt).toHaveLength(1);
    expect(st.customExt[0].id).toBe('c1');
  });
});

describe('saveManju / loadManju 往返', () => {
  it('保存后读取内容一致', () => {
    vi.stubGlobal('localStorage', makeStore());
    const st: ReturnType<typeof loadManju> = {
      favorites: ['s1'],
      seen: ['e1'],
      progress: { s1_e01: 42 },
      customExt: [
        { id: 'c1', title: 'T', cat: 'ai', cover: '🤖', source: '自建', episodesText: '1 集', playMode: 'direct' },
      ],
    };
    saveManju(st);
    expect(loadManju()).toEqual(st);
  });

  it('setItem 抛异常时不向外抛出（隐私模式兜底）', () => {
    vi.stubGlobal('localStorage', makeThrowStore());
    expect(() => saveManju(seedState())).not.toThrow();
  });
});
