/**
 * 漫剧模块单元测试（node 环境，无 jsdom）
 *
 * 覆盖三层：
 * - 纯函数：mkEps / seedState / isExtItem
 * - 本地持久化：loadManju / saveManju（localStorage stub）
 * - fetch 适配层：extUrl / loadHgIndex / loadHgItems（fetch stub + 模块级 hgCache 隔离）
 *
 * fetch 层测试通过 vi.resetModules() + 动态 import 获取全新模块实例，
 * 以隔离 manju.tsx 内的模块级缓存 hgCache。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

/** 模拟 fetch Response */
function jsonRes(payload: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => payload };
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

/* ============ fetch 适配层 ============ */

describe('fetch 适配层（extUrl / loadHgIndex / loadHgItems）', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    // 每个用例重置模块注册表：动态 import 拿到全新实例，隔离模块级 hgCache
    vi.resetModules();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  it('extUrl 拼接 BASE_URL + external/ 路径', async () => {
    const m = await import('./manju');
    expect(m.extUrl('index.json')).toBe(`${import.meta.env.BASE_URL}external/index.json`);
    expect(m.extUrl('comic-drama.json')).toBe(`${import.meta.env.BASE_URL}external/comic-drama.json`);
  });

  it('loadHgIndex：成功映射目录并过滤非法 catalog 条目', async () => {
    fetchMock.mockResolvedValue(
      jsonRes({
        provider_label: '红果短剧',
        attribution: '版权说明',
        catalogs: [
          { category: 'ai-drama', category_label: 'AI剧', total: 989 },
          { category: 'other', category_label: '非法', total: 1 },
          { category: 'comic-drama', category_label: '漫剧', total: 1021 },
          null,
        ],
      }),
    );
    const m = await import('./manju');
    const idx = await m.loadHgIndex(new AbortController().signal);
    expect(idx.providerLabel).toBe('红果短剧');
    expect(idx.attribution).toBe('版权说明');
    expect(idx.catalogs).toEqual([
      { category: 'ai-drama', categoryLabel: 'AI剧', total: 989 },
      { category: 'comic-drama', categoryLabel: '漫剧', total: 1021 },
    ]);
    // 请求走 extUrl('index.json')
    expect(fetchMock.mock.calls[0][0]).toBe(`${import.meta.env.BASE_URL}external/index.json`);
  });

  it('loadHgIndex：provider_label 缺失时兜底"红果短剧"', async () => {
    fetchMock.mockResolvedValue(
      jsonRes({ catalogs: [{ category: 'comic-drama', category_label: '漫剧', total: 1 }] }),
    );
    const m = await import('./manju');
    const idx = await m.loadHgIndex(new AbortController().signal);
    expect(idx.providerLabel).toBe('红果短剧');
    expect(idx.attribution).toBe('');
  });

  it('loadHgIndex：HTTP 非 2xx 抛出带状态码的错误', async () => {
    fetchMock.mockResolvedValue(jsonRes(null, false, 500));
    const m = await import('./manju');
    await expect(m.loadHgIndex(new AbortController().signal)).rejects.toThrow(
      '目录加载失败（HTTP 500）',
    );
  });

  it('loadHgIndex：catalogs 为空或全非法时抛出格式异常', async () => {
    fetchMock.mockResolvedValue(jsonRes({ catalogs: [{ category: 'bad', category_label: 'x' }] }));
    const m = await import('./manju');
    await expect(m.loadHgIndex(new AbortController().signal)).rejects.toThrow('目录数据格式异常');
  });

  it('loadHgItems：成功映射条目并补齐默认值，跳过非法条目', async () => {
    fetchMock.mockResolvedValue(
      jsonRes({
        items: [
          { id: '1', title: 'A', cover_url: 'c1' },
          { id: '2', title: 'B', cover_url: 'c2', episodes_text: '全集 12 集', source_label: '其他源', detail_url: 'u2' },
          { id: '3' }, // 缺 title/cover_url → 丢弃
          null,
          'junk',
        ],
      }),
    );
    const m = await import('./manju');
    const items = await m.loadHgItems('comic', new AbortController().signal);
    expect(items).toEqual([
      { id: '1', title: 'A', cover: 'c1', episodesText: '集数未知', sourceLabel: '红果短剧', detailUrl: '' },
      { id: '2', title: 'B', cover: 'c2', episodesText: '全集 12 集', sourceLabel: '其他源', detailUrl: 'u2' },
    ]);
    expect(fetchMock.mock.calls[0][0]).toBe(`${import.meta.env.BASE_URL}external/comic-drama.json`);
  });

  it('loadHgItems：全部条目非法时抛出格式异常', async () => {
    fetchMock.mockResolvedValue(jsonRes({ items: [{ id: 'x' }] }));
    const m = await import('./manju');
    await expect(m.loadHgItems('ai', new AbortController().signal)).rejects.toThrow(
      '片单数据格式异常',
    );
  });

  it('loadHgItems：HTTP 非 2xx 抛出带状态码的错误', async () => {
    fetchMock.mockResolvedValue(jsonRes(null, false, 404));
    const m = await import('./manju');
    await expect(m.loadHgItems('comic', new AbortController().signal)).rejects.toThrow(
      '片单加载失败（HTTP 404）',
    );
  });

  it('loadHgItems：同分类命中缓存不再请求，跨分类各自请求', async () => {
    fetchMock.mockResolvedValue(
      jsonRes({ items: [{ id: '1', title: 'A', cover_url: 'c1' }] }),
    );
    const m = await import('./manju');
    const sig = new AbortController().signal;
    const first = await m.loadHgItems('comic', sig);
    const second = await m.loadHgItems('comic', sig);
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await m.loadHgItems('ai', sig);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
