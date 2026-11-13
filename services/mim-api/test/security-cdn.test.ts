/** CDN 适配层测试：回源缓存策略分类 / 厂商齐备度判定 / 未配置不假装刷新成功（纯函数 + 未配置路径，不触网） */

import { describe, expect, it } from 'vitest'; // 引入依赖、类型或本地模块绑定
import { classifyCachePolicy, describeCdn, purgeCdn, detectCdnProvider } from '../src/cdn.js'; // 引入依赖、类型或本地模块绑定

describe('CDN 回源缓存策略分类', () => { // 调用 describe 并处理其返回结果
  it('带 hash 的静态产物 → 不可变长缓存', () => { // 调用 it 并处理其返回结果
    expect(classifyCachePolicy('/assets/app.abc123456.js')).toEqual({ // 调用 expect 并处理其返回结果
      category: 'immutable-asset', // 对象字段 category：记录一项配置或数据
      'Cache-Control': 'public, max-age=31536000, immutable', // 执行当前业务步骤
    }); // 代码块结束
    expect(classifyCachePolicy('/static/logo-9f8e7d6c5b4a.png').category).toBe('immutable-asset'); // 调用 expect 并处理其返回结果
  }); // 代码块结束

  it('HTML 页面 → no-cache 协商缓存', () => { // 调用 it 并处理其返回结果
    expect(classifyCachePolicy('/index.html', 'text/html').category).toBe('html-swr'); // 调用 expect 并处理其返回结果
    expect(classifyCachePolicy('/about.htm').category).toBe('html-swr'); // 调用 expect 并处理其返回结果
  }); // 代码块结束

  it('API 路径 → 私有 no-store', () => { // 调用 it 并处理其返回结果
    expect(classifyCachePolicy('/api/v1/me').category).toBe('api-private'); // 调用 expect 并处理其返回结果
    expect(classifyCachePolicy('/api/v1/me')['Cache-Control']).toBe('private, no-store'); // 调用 expect 并处理其返回结果
  }); // 代码块结束

  it('其余静态资源 → 缺省短公共缓存', () => { // 调用 it 并处理其返回结果
    expect(classifyCachePolicy('/static/banner.png').category).toBe('default-public'); // 调用 expect 并处理其返回结果
  }); // 代码块结束
}); // 代码块结束

describe('CDN 厂商齐备度如实判定', () => { // 调用 describe 并处理其返回结果
  it('未配置 / 非法 provider → none 且 configured=false', () => { // 调用 it 并处理其返回结果
    expect(detectCdnProvider({})).toBe('none'); // 调用 expect 并处理其返回结果
    expect(detectCdnProvider({ MIM_CDN_PROVIDER: 'cloudfrontx' })).toBe('none'); // 调用 expect 并处理其返回结果
    const status = describeCdn({}); // 常量 status：保存固定配置或一次性派生值
    expect(status.provider).toBe('none'); // 调用 expect 并处理其返回结果
    expect(status.configured).toBe(false); // 调用 expect 并处理其返回结果
  }); // 代码块结束

  it('cloudflare 缺 token/zone → configured=false 并列出缺失变量', () => { // 调用 it 并处理其返回结果
    const status = describeCdn({ MIM_CDN_PROVIDER: 'cloudflare' }); // 常量 status：保存固定配置或一次性派生值
    expect(status.configured).toBe(false); // 调用 expect 并处理其返回结果
    expect(status.missing).toContain('MIM_CDN_CLOUDFLARE_ZONE_ID'); // 调用 expect 并处理其返回结果
    expect(status.missing).toContain('MIM_CDN_CLOUDFLARE_API_TOKEN'); // 调用 expect 并处理其返回结果
  }); // 代码块结束

  it('cloudflare 凭证齐备 → configured=true', () => { // 调用 it 并处理其返回结果
    const status = describeCdn({ // 常量 status：保存固定配置或一次性派生值
      MIM_CDN_PROVIDER: 'cloudflare', // 对象字段 MIM_CDN_PROVIDER：记录一项配置或数据
      MIM_CDN_CLOUDFLARE_ZONE_ID: 'zone', // 对象字段 MIM_CDN_CLOUDFLARE_ZONE_ID：记录一项配置或数据
      MIM_CDN_CLOUDFLARE_API_TOKEN: 'token', // 对象字段 MIM_CDN_CLOUDFLARE_API_TOKEN：记录一项配置或数据
    }); // 代码块结束
    expect(status.configured).toBe(true); // 调用 expect 并处理其返回结果
  }); // 代码块结束

  it('cloudfront 即使凭证齐备也标记未实现（SigV4 待接入）', () => {
    const status = describeCdn({ // 常量 status：保存固定配置或一次性派生值
      MIM_CDN_PROVIDER: 'cloudfront', // 对象字段 MIM_CDN_PROVIDER：记录一项配置或数据
      MIM_CDN_CLOUDFRONT_DISTRIBUTION_ID: 'dist', // 对象字段 MIM_CDN_CLOUDFRONT_DISTRIBUTION_ID：记录一项配置或数据
      MIM_CDN_AWS_ACCESS_KEY_ID: 'ak', // 对象字段 MIM_CDN_AWS_ACCESS_KEY_ID：记录一项配置或数据
      MIM_CDN_AWS_SECRET_ACCESS_KEY: 'sk', // 对象字段 MIM_CDN_AWS_SECRET_ACCESS_KEY：记录一项配置或数据
    }); // 代码块结束
    expect(status.provider).toBe('cloudfront'); // 调用 expect 并处理其返回结果
    expect(status.configured).toBe(false); // 调用 expect 并处理其返回结果
    expect(status.note).toMatch(/SigV4/); // 调用 expect 并处理其返回结果
  }); // 代码块结束
}); // 代码块结束

describe('purgeCdn 未配置路径不假装成功', () => { // 调用 describe 并处理其返回结果
  it('none / 未配置 → ok=false、configured=false、错误码 CDN_NOT_CONFIGURED', async () => { // 调用 it 并处理其返回结果
    const result = await purgeCdn({}, ['https://mim.mixm.top/a.js']); // 常量 result：保存固定配置或一次性派生值
    expect(result.ok).toBe(false); // 调用 expect 并处理其返回结果
    expect(result.configured).toBe(false); // 调用 expect 并处理其返回结果
    expect(result.error).toMatch(/CDN_NOT_CONFIGURED/); // 调用 expect 并处理其返回结果
    expect(result.purged).toEqual([]); // 调用 expect 并处理其返回结果
  }); // 代码块结束

  it('cloudflare 缺凭证 → 不发网络请求，返回 CDN_NOT_CONFIGURED', async () => { // 调用 it 并处理其返回结果
    const result = await purgeCdn({ MIM_CDN_PROVIDER: 'cloudflare' }, ['https://mim.mixm.top/a.css']); // 常量 result：保存固定配置或一次性派生值
    expect(result.ok).toBe(false); // 调用 expect 并处理其返回结果
    expect(result.configured).toBe(false); // 调用 expect 并处理其返回结果
    expect(result.error).toMatch(/CDN_NOT_CONFIGURED/); // 调用 expect 并处理其返回结果
  }); // 代码块结束

  it('cloudfront → 未实现，不调用上游', async () => {
    const result = await purgeCdn( // 常量 result：保存固定配置或一次性派生值
      { MIM_CDN_PROVIDER: 'cloudfront', MIM_CDN_CLOUDFRONT_DISTRIBUTION_ID: 'd' }, // 执行当前业务步骤
      ['https://mim.mixm.top/a.js'], // 执行当前业务步骤
    ); // 执行当前业务步骤
    expect(result.ok).toBe(false); // 调用 expect 并处理其返回结果
    expect(result.configured).toBe(false); // 调用 expect 并处理其返回结果
  }); // 代码块结束
}); // 代码块结束
