/** 安全加固包测试：出站 URL SSRF 防护（协议白名单 / 私网环回 / 元数据 / 编码 IP / 重定向复核） */

import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AppError } from '@mim/core-domain';
import { assertSafeOutboundUrl, safeOutboundFetch } from '../src/security.js';

/** 期望被拒绝的出站地址：协议非法 / 私网 / 环回 / 链路本地 / 元数据 / 编码 IP */
const REJECTED = [
  'file:///etc/passwd', // 非 http(s) 协议
  'javascript:alert(1)', // 脚本协议
  'http://127.0.0.1/', // 环回 IPv4
  'http://127.0.0.1:8080/admin', // 环回带端口
  'http://169.254.169.254/', // 云元数据地址
  'http://169.254.169.254/latest/meta-data/', // 元数据常见路径
  'http://10.0.0.5/', // A 类私网
  'http://192.168.1.10/', // C 类私网
  'http://172.16.3.4/', // B 类私网
  'http://2130706433/', // 十进制整数 IP → 127.0.0.1
  'http://0x7f000001/', // 十六进制整数 IP → 127.0.0.1
  'http://0177.0.0.1/', // 八进制 octet → 127.0.0.1
  'http://localhost/', // 环回主机名
  'http://localhost:3000/', // 环回主机名带端口
  'http://[::1]/', // 环回 IPv6
  'http://[::ffff:127.0.0.1]/', // IPv4 映射私网 IPv6
  'http://[fd00::1]/', // 唯一本地 IPv6
];

describe('assertSafeOutboundUrl 拒绝内网 / 非法协议目标', () => {
  for (const target of REJECTED) {
    it(`拒绝 ${target}`, async () => {
      await expect(assertSafeOutboundUrl(target)).rejects.toBeInstanceOf(AppError);
    });
  }
});

describe('safeOutboundFetch 出站前复核目标', () => {
  it('命中环回地址时在 fetch 前即拒绝，不发出请求', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      await expect(safeOutboundFetch(`http://127.0.0.1:${port}/`)).rejects.toBeInstanceOf(AppError);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('3xx 跳转到内网地址时逐跳复核并拒绝', async () => {
    // 首跳目标用本机回环地址：守卫在首跳即拦下私网目标；
    // 重定向 Location 为元数据地址，复核链路同样走私网判定。
    const server = createServer((_req, res) => {
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      await expect(safeOutboundFetch(`http://127.0.0.1:${port}/`)).rejects.toBeInstanceOf(AppError);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
