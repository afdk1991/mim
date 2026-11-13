/** CDN 适配层测试：回源缓存策略分类 / 厂商齐备度判定 / 未配置不假装刷新成功（纯函数 + 未配置路径，不触网） */

import { describe, expect, it } from 'vitest';
import { classifyCachePolicy, describeCdn, purgeCdn, detectCdnProvider } from '../src/cdn.js';

describe('CDN 回源缓存策略分类', () => {
  it('带 hash 的静态产物 → 不可变长缓存', () => {
    expect(classifyCachePolicy('/assets/app.abc123456.js')).toEqual({
      category: 'immutable-asset',
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    expect(classifyCachePolicy('/static/logo-9f8e7d6c5b4a.png').category).toBe('immutable-asset');
  });

  it('HTML 页面 → no-cache 协商缓存', () => {
    expect(classifyCachePolicy('/index.html', 'text/html').category).toBe('html-swr');
    expect(classifyCachePolicy('/about.htm').category).toBe('html-swr');
  });

  it('API 路径 → 私有 no-store', () => {
    expect(classifyCachePolicy('/api/v1/me').category).toBe('api-private');
    expect(classifyCachePolicy('/api/v1/me')['Cache-Control']).toBe('private, no-store');
  });

  it('其余静态资源 → 缺省短公共缓存', () => {
    expect(classifyCachePolicy('/static/banner.png').category).toBe('default-public');
  });
});

describe('CDN 厂商齐备度如实判定', () => {
  it('未配置 / 非法 provider → none 且 configured=false', () => {
    expect(detectCdnProvider({})).toBe('none');
    expect(detectCdnProvider({ MIM_CDN_PROVIDER: 'cloudfrontx' })).toBe('none');
    const status = describeCdn({});
    expect(status.provider).toBe('none');
    expect(status.configured).toBe(false);
  });

  it('cloudflare 缺 token/zone → configured=false 并列出缺失变量', () => {
    const status = describeCdn({ MIM_CDN_PROVIDER: 'cloudflare' });
    expect(status.configured).toBe(false);
    expect(status.missing).toContain('MIM_CDN_CLOUDFLARE_ZONE_ID');
    expect(status.missing).toContain('MIM_CDN_CLOUDFLARE_API_TOKEN');
  });

  it('cloudflare 凭证齐备 → configured=true', () => {
    const status = describeCdn({
      MIM_CDN_PROVIDER: 'cloudflare',
      MIM_CDN_CLOUDFLARE_ZONE_ID: 'zone',
      MIM_CDN_CLOUDFLARE_API_TOKEN: 'token',
    });
    expect(status.configured).toBe(true);
  });

  it('cloudfront 即使凭证齐备也标记未实现（SigV4 待接入）', () => {
    const status = describeCdn({
      MIM_CDN_PROVIDER: 'cloudfront',
      MIM_CDN_CLOUDFRONT_DISTRIBUTION_ID: 'dist',
      MIM_CDN_AWS_ACCESS_KEY_ID: 'ak',
      MIM_CDN_AWS_SECRET_ACCESS_KEY: 'sk',
    });
    expect(status.provider).toBe('cloudfront');
    expect(status.configured).toBe(false);
    expect(status.note).toMatch(/SigV4/);
  });
});

describe('purgeCdn 未配置路径不假装成功', () => {
  it('none / 未配置 → ok=false、configured=false、错误码 CDN_NOT_CONFIGURED', async () => {
    const result = await purgeCdn({}, ['https://mim.mixm.top/a.js']);
    expect(result.ok).toBe(false);
    expect(result.configured).toBe(false);
    expect(result.error).toMatch(/CDN_NOT_CONFIGURED/);
    expect(result.purged).toEqual([]);
  });

  it('cloudflare 缺凭证 → 不发网络请求，返回 CDN_NOT_CONFIGURED', async () => {
    const result = await purgeCdn({ MIM_CDN_PROVIDER: 'cloudflare' }, ['https://mim.mixm.top/a.css']);
    expect(result.ok).toBe(false);
    expect(result.configured).toBe(false);
    expect(result.error).toMatch(/CDN_NOT_CONFIGURED/);
  });

  it('cloudfront → 未实现，不调用上游', async () => {
    const result = await purgeCdn(
      { MIM_CDN_PROVIDER: 'cloudfront', MIM_CDN_CLOUDFRONT_DISTRIBUTION_ID: 'd' },
      ['https://mim.mixm.top/a.js'],
    );
    expect(result.ok).toBe(false);
    expect(result.configured).toBe(false);
  });
});
