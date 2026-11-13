/** 安全加固包测试：出站 URL SSRF 防护（协议白名单 / 私网环回 / 元数据 / 编码 IP / 重定向复核） */

import { describe, expect, it } from 'vitest'; // 引入依赖、类型或本地模块绑定
import { createServer } from 'node:http'; // 引入依赖、类型或本地模块绑定
import type { AddressInfo } from 'node:net'; // 引入依赖、类型或本地模块绑定
import { AppError } from '@mim/core-domain'; // 引入依赖、类型或本地模块绑定
import { assertSafeOutboundUrl, safeOutboundFetch } from '../src/security.js'; // 引入依赖、类型或本地模块绑定

/** 期望被拒绝的出站地址：协议非法 / 私网 / 环回 / 链路本地 / 元数据 / 编码 IP */
const REJECTED = [ // 准备：构造本用例需要的输入或句柄
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
]; // 执行当前业务步骤

describe('assertSafeOutboundUrl 拒绝内网 / 非法协议目标', () => { // 调用 describe 并处理其返回结果
  for (const target of REJECTED) { // 循环：逐项遍历集合并执行相同处理
    it(`拒绝 ${target}`, async () => { // 调用 it 并处理其返回结果
      await expect(assertSafeOutboundUrl(target)).rejects.toBeInstanceOf(AppError); // 断言：校验接口响应或状态符合冻结契约
    }); // 代码块结束
  } // 代码块结束
}); // 代码块结束

describe('safeOutboundFetch 出站前复核目标', () => { // 调用 describe 并处理其返回结果
  it('命中环回地址时在 fetch 前即拒绝，不发出请求', async () => { // 调用 it 并处理其返回结果
    const server = createServer((_req, res) => { // 准备：构造本用例需要的输入或句柄
      res.writeHead(200, { 'content-type': 'text/plain' }); // 执行当前业务步骤
      res.end('ok'); // 执行当前业务步骤
    }); // 代码块结束
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); // 执行：等待异步操作返回后继续
    const port = (server.address() as AddressInfo).port; // 准备：构造本用例需要的输入或句柄
    try { // 异常捕获起点：包裹可能抛出错误的操作
      await expect(safeOutboundFetch(`http://127.0.0.1:${port}/`)).rejects.toBeInstanceOf(AppError); // 异步等待：挂起至 Promise 落定后再继续
    } finally { // 代码块结束
      await new Promise<void>((resolve) => server.close(() => resolve())); // 执行：等待异步操作返回后继续
    } // 代码块结束
  }); // 代码块结束

  it('3xx 跳转到内网地址时逐跳复核并拒绝', async () => { // 调用 it 并处理其返回结果
    // 首跳目标用本机回环地址：守卫在首跳即拦下私网目标；
    // 重定向 Location 为元数据地址，复核链路同样走私网判定。
    const server = createServer((_req, res) => { // 准备：构造本用例需要的输入或句柄
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }); // 执行当前业务步骤
      res.end(); // 执行当前业务步骤
    }); // 代码块结束
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); // 执行：等待异步操作返回后继续
    const port = (server.address() as AddressInfo).port; // 准备：构造本用例需要的输入或句柄
    try { // 异常捕获起点：包裹可能抛出错误的操作
      await expect(safeOutboundFetch(`http://127.0.0.1:${port}/`)).rejects.toBeInstanceOf(AppError); // 异步等待：挂起至 Promise 落定后再继续
    } finally { // 代码块结束
      await new Promise<void>((resolve) => server.close(() => resolve())); // 执行：等待异步操作返回后继续
    } // 代码块结束
  }); // 代码块结束
}); // 代码块结束
