/**
 * 纯函数契约测试：公开地址归一化 + 会话结构校验。
 *
 * 不启动浏览器、不发真实请求；只覆盖无副作用的 URL 分流与会话类型守卫，
 * 跨源拼接的 API 源前缀由构建期 VITE_API_ORIGIN 注入，用例按同源默认（空源）口径断言。
 */

import { describe, expect, it } from 'vitest'; // vitest 编排
import { BASE, coverSrcset, isValidSession, resolvePublicUrl, resolveStaticUrl } from './request.js'; // 待测纯函数与常量

describe('resolveStaticUrl：Web 静态产物地址补全', () => {
  it('空串原样返回，调用方按无图处理', () => {
    expect(resolveStaticUrl('')).toBe(''); // 空地址不补前缀
  });

  it('http(s) 绝对地址与协议相对地址原样保留', () => {
    expect(resolveStaticUrl('https://cdn.example.com/a.jpg')).toBe('https://cdn.example.com/a.jpg'); // 外链不加工
    expect(resolveStaticUrl('//cdn.example.com/a.jpg')).toBe('//cdn.example.com/a.jpg'); // 协议相对地址不加工
  });

  it('根相对路径补 BASE_URL 前缀，兼容子路径部署', () => {
    expect(resolveStaticUrl('/catalog/frontier.jpg')).toBe('/catalog/frontier.jpg'); // 同源默认 BASE_URL 为 /
    expect(resolveStaticUrl('demo/stardust-cover.jpg')).toBe('/demo/stardust-cover.jpg'); // 裸路径同样补前缀
  });
});

describe('resolvePublicUrl：API 签名链接与 Web 静态产物分流', () => {
  it('空串原样返回', () => {
    expect(resolvePublicUrl('')).toBe(''); // 空地址兜底
  });

  it('已是绝对地址或协议相对地址无需加工', () => {
    expect(resolvePublicUrl('https://api.laal.top/api/v1/media/objects/x?signature=a')).toBe('https://api.laal.top/api/v1/media/objects/x?signature=a'); // 签名外链原样
    expect(resolvePublicUrl('//cdn.example.com/b.jpg')).toBe('//cdn.example.com/b.jpg'); // 协议相对原样
  });

  it('/api/ 开头按 API 前缀处理，不被当成 Web 静态产物', () => {
    const signed = '/api/v1/media/objects/x?signature=a'; // 服务端签名下载链接
    expect(resolvePublicUrl(signed)).toBe(signed); // 同源默认空源：保持原路径，不拼静态前缀
  });

  it('其余根相对路径留在 Web 源（/catalog、/demo、/zib 等）', () => {
    expect(resolvePublicUrl('/catalog/store.jpg')).toBe('/catalog/store.jpg'); // 静态封面不走 API 源
    expect(resolvePublicUrl('/demo/bloom-cover.jpg')).toBe('/demo/bloom-cover.jpg'); // 演示封面同样留在 Web 源
  });

  it('非斜杠开头的裸路径按 API 前缀兜底', () => {
    expect(resolvePublicUrl('threads/abc')).toBe(`${BASE}/threads/abc`); // 裸路径补 /api/v1 前缀
  });
});

describe('coverSrcset：catalog 封面 2x 档派生', () => {
  it('catalog 封面派生 1x/2x 密度描述符，2x 为同名 @2x.jpg', () => {
    expect(coverSrcset('/catalog/store.jpg')).toBe('/catalog/store.jpg 1x, /catalog/store@2x.jpg 2x');
  });

  it('demo 封面 / 外链 / 空地址不派生高清档', () => {
    expect(coverSrcset('/demo/stardust-cover.jpg')).toBe(''); // 演示封面不在 2x 批次
    expect(coverSrcset('https://cdn.example.com/a.jpg')).toBe(''); // 外链不派生
    expect(coverSrcset('')).toBe(''); // 空地址兜底
  });
});

describe('isValidSession：会话结构类型守卫', () => {
  it('null / 非对象 / 缺字段一律判为不合法', () => {
    expect(isValidSession(null)).toBe(false); // 空会话
    expect(isValidSession({})).toBe(false); // 空对象
    expect(isValidSession('not-an-object')).toBe(false); // 字符串脏数据
    expect(isValidSession({ access_token: 'a', refresh_token: 'b' })).toBe(false); // 缺用户主键
    expect(isValidSession({ access_token: '', refresh_token: 'b', user: { id: 'u1' } })).toBe(false); // 访问令牌为空
  });

  it('双令牌与用户主键同时有效才算登录态', () => {
    const valid = { access_token: 'a', refresh_token: 'b', user: { id: 'u1' } }; // 结构完整
    expect(isValidSession(valid)).toBe(true); // 合法会话放行
  });
});
