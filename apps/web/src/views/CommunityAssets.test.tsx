// @vitest-environment jsdom
/**
 * CommunityAssets 组件级测试（#28）。
 *
 * 在 jsdom 内渲染真实 React 组件，只 mock 数据端点与站内路由，覆盖：
 *   - catalog 本地封面派生 1x/2x srcSet；外链 / 空封面不派生高清档、走类型占位；
 *   - 整卡点击进入详情深链接；
 *   - 详情页未解锁态：封面 srcSet、匿名购买先引导登录；
 *   - 已解锁态：拥有提示与媒体图 srcSet；登录后购买状态机回读解锁。
 *
 * 不启动浏览器、不打真实网络；地址归一化与 srcSet 纯函数口径由 request.test.ts 覆盖。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'; // 测试编排与 mock
import { cleanup, fireEvent, render, screen } from '@testing-library/react'; // React 组件渲染与交互
import type { Locale } from '@mim/i18n'; // 语言标签类型
import { CommunityAssets } from './CommunityAssets.js'; // 待测组件
import type { AssetDetail, AssetListItem } from '../api/assets.js'; // 资产数据类型
import { fetchAsset, fetchAssets, purchaseAsset } from '../api/assets.js'; // 被 mock 的数据端点
import { navigatePath } from '../router.js'; // 被 mock 的站内跳转

// mock 资产端点：保留 assetUrl 等纯实现，只替换会发请求的四个函数
vi.mock('../api/assets', async (importOriginal) => {
  const original = await importOriginal<typeof import('../api/assets')>(); // 原始模块引用
  return {
    ...original, // 保留 assetUrl / 类型导出等纯实现
    fetchAssets: vi.fn(), // 列表接口替换为 mock
    fetchAsset: vi.fn(), // 详情接口替换为 mock
    fetchMyAssets: vi.fn(), // 我的资产接口替换为 mock
    purchaseAsset: vi.fn(), // 购买接口替换为 mock
  };
});

// mock 站内路由：只提供组件用到的跳转与路径拼装，不依赖浏览器 history
vi.mock('../router', () => ({
  navigatePath: vi.fn(), // 跳转函数：断言调用入参
  pathOf: vi.fn((view: string, subPath = '', query = '') => (
    query ? `/${view}/${subPath}?${query}` : `/${view}/${subPath}`
  )), // 路径拼装：返回可断言的简单拼接串
}));

// mock 统一错误文案出口：避免拉入 endpoints 全链；业务错误类型仍用真实语义
vi.mock('../api', () => ({
  ApiError: class ApiError extends Error {
    readonly code: string; // 业务错误码
    readonly status: number; // HTTP 状态
    readonly details?: unknown; // 结构化细节
    constructor(code: string, message: string, status: number, details?: unknown) {
      super(message); // 基类 Error 信息
      this.code = code; // 保存错误码
      this.status = status; // 保存状态码
      this.details = details; // 保存细节载荷
    }
  },
  errorText: (_locale: unknown, err: unknown) => (err instanceof Error ? err.message : String(err)), // 错误文案兜底
}));

const zhCN = 'zh-CN' as Locale; // 中文口径，断言中文按钮与占位文案

/** 列表项工厂：除封面外字段取固定样例，便于聚焦封面与状态分支。 */
function makeItem(code: string, title: string, cover_url: string | null, unlocked = false): AssetListItem {
  return {
    code, // 资产编码
    kind: 'article', // 类型：文章
    title, // 标题
    summary: '资产简介样例', // 简介
    cover_url, // 封面地址（可空）
    price_cents: 1900, // 价格 19.00 元
    vip_free: 0, // 非会员免费
    views: 10, // 浏览量
    sales: 3, // 销量
    updated_at: '2026-11-20T08:00:00Z', // 更新时间
    unlocked, // 是否已解锁
  };
}

/** 详情对象工厂：在列表项基础上补正文 / 文件地址 / 媒体。 */
function makeDetail(item: AssetListItem, overrides: Partial<AssetDetail> = {}): AssetDetail {
  return {
    ...item, // 继承列表项字段
    body: '试读片段', // 正文
    file_url: null, // 未解锁无下载地址
    media: [], // 未解锁媒体为空
    ...overrides, // 覆盖分支所需字段
  };
}

afterEach(() => {
  cleanup(); // 卸载上一用例渲染的组件树
  vi.clearAllMocks(); // 清空 mock 调用记录与返回值
});

describe('AssetList 列表视图', () => {
  it('catalog 本地封面派生 1x/2x srcSet，src 指向静态产物路径', async () => {
    vi.mocked(fetchAssets).mockResolvedValue({
      items: [makeItem('a1', '目录封面帖', '/catalog/store.jpg')], // 单条本地封面
      vip_level: 0, // 非会员
    });

    render(<CommunityAssets locale={zhCN} hasSession={false} />); // 匿名渲染列表
    const img = (await screen.findByText('目录封面帖')).closest('button')!.querySelector('img')!; // 卡片内封面图

    expect(img.getAttribute('src')).toBe('/catalog/store.jpg'); // 本地静态封面留在 Web 源
    expect(img.getAttribute('srcSet')).toBe('/catalog/store.jpg 1x, /catalog/store@2x.jpg 2x'); // 1x/2x 密度描述符
  });

  it('外链封面保留绝对地址，不派生 2x 高清档', async () => {
    vi.mocked(fetchAssets).mockResolvedValue({
      items: [makeItem('a2', '外链封面帖', 'https://cdn.example.com/ext.jpg')], // 绝对外链封面
      vip_level: 0,
    });

    render(<CommunityAssets locale={zhCN} hasSession={false} />);
    const img = (await screen.findByText('外链封面帖')).closest('button')!.querySelector('img')!;

    expect(img.getAttribute('src')).toBe('https://cdn.example.com/ext.jpg'); // 外链原样保留
    expect(img.getAttribute('srcSet')).toBe(''); // 外链不在 2x 批次，srcSet 为空串
  });

  it('空封面退化为类型名占位，卡片内不渲染 img', async () => {
    vi.mocked(fetchAssets).mockResolvedValue({
      items: [makeItem('a3', '无封面帖', null)], // 无封面
      vip_level: 0,
    });

    render(<CommunityAssets locale={zhCN} hasSession={false} />);
    const card = (await screen.findByText('无封面帖')).closest('button')!; // 卡片节点

    expect(card.querySelector('img')).toBeNull(); // 无封面不渲染图片
    expect(card.querySelector('.asset-cover-fallback')?.textContent).toBe('付费阅读'); // 类型名占位兜底
  });

  it('点击整卡调用 navigatePath 进入详情深链接', async () => {
    vi.mocked(fetchAssets).mockResolvedValue({
      items: [makeItem('a4', '可跳转帖', '/catalog/frontier.jpg')],
      vip_level: 0,
    });

    render(<CommunityAssets locale={zhCN} hasSession={false} />);
    const card = (await screen.findByText('可跳转帖')).closest('button')!; // 整卡按钮
    fireEvent.click(card); // 模拟点击卡片

    expect(navigatePath).toHaveBeenCalledWith('/community/assets/a4'); // 跳转到详情深链接
  });
});

describe('AssetDetailView 详情视图', () => {
  it('未解锁 catalog 封面带 srcSet；匿名购买先触发登录引导，不调用购买接口', async () => {
    const detail = makeDetail(makeItem('a1', '详情封面帖', '/catalog/store.jpg')); // 未解锁详情
    vi.mocked(fetchAsset).mockResolvedValue({ asset: detail });
    const onRequireLogin = vi.fn(); // 登录引导回调

    render(<CommunityAssets locale={zhCN} hasSession={false} code="a1" onRequireLogin={onRequireLogin} />);
    const cover = (await screen.findByText('详情封面帖')).closest('article')!.querySelector('.asset-detail-cover')!; // 详情封面

    expect(cover.getAttribute('srcSet')).toBe('/catalog/store.jpg 1x, /catalog/store@2x.jpg 2x'); // 详情封面同样派生 2x

    const buyButton = screen.getByText('登录后购买'); // 匿名购买按钮文案
    fireEvent.click(buyButton); // 点击购买

    expect(onRequireLogin).toHaveBeenCalledTimes(1); // 匿名先引导登录
    expect(purchaseAsset).not.toHaveBeenCalled(); // 不发购买请求
  });

  it('已解锁资产渲染拥有提示，解锁媒体图派生 2x srcSet', async () => {
    const detail = makeDetail(
      makeItem('a2', '已拥有帖', '/catalog/frontier.jpg', true), // 已解锁
      {
        file_url: '/demo/owned.zip', // 下载地址
        media: [{ kind: 'image', url: '/catalog/ai.jpg', poster_url: null }], // 解锁后下发媒体
      },
    );
    vi.mocked(fetchAsset).mockResolvedValue({ asset: detail });

    render(<CommunityAssets locale={zhCN} hasSession code="a2" />);
    expect(await screen.findByText('已拥有该资产')).toBeTruthy(); // 拥有态提示

    const mediaSet = Array.from(document.querySelectorAll('.asset-media img'))[0]; // 取媒体网格内首图
    expect(mediaSet).toBeTruthy();
    expect(mediaSet.getAttribute('srcSet')).toBe('/catalog/ai.jpg 1x, /catalog/ai@2x.jpg 2x'); // 媒体图同样派生 2x
  });

  it('登录后购买：购买成功回读解锁，展示成功提示并进入拥有态', async () => {
    const locked = makeDetail(makeItem('a3', '待购买帖', '/catalog/wechat.jpg')); // 首次拉取：未解锁
    const unlocked = makeDetail(makeItem('a3', '待购买帖', '/catalog/wechat.jpg', true), { body: '全文内容', media: [] }); // 购买后回读：已解锁
    vi.mocked(fetchAsset)
      .mockResolvedValueOnce({ asset: locked }) // 首次详情：未解锁
      .mockResolvedValueOnce({ asset: unlocked }); // 购买后回读：已解锁
    vi.mocked(purchaseAsset).mockResolvedValue({ ok: true, charged_cents: 1900, via: 'balance' }); // 余额扣款成功

    render(<CommunityAssets locale={zhCN} hasSession code="a3" />);
    const buyButton = await screen.findByText('余额购买'); // 登录后主按钮
    fireEvent.click(buyButton); // 发起购买

    expect(await screen.findByText('购买成功，已解锁')).toBeTruthy(); // 成功提示出现
    expect(await screen.findByText('已拥有该资产')).toBeTruthy(); // 回读后进入拥有态
    expect(purchaseAsset).toHaveBeenCalledWith('a3'); // 购买接口带编码调用
  });
});
