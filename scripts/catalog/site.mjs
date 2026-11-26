/**
 * 源站 HTTP 客户端（2026-11-26）：CSRF 握手、限频、重试、图片下载。
 *
 * 所有出网请求只从这里走，限频与重试只有一处，避免采集逻辑各自发请求被 WAF 拦。
 * 图片档位：优先裸文件名（实测 1000×1000 原画质，单张 70–220KB），
 * 再退 `_l`（1000×1000 高压缩）、`_m`（800×800），确保「高清/超高清」不落到 80×80 的 `_s`。
 */
import fs from 'node:fs'; // 图片落盘
import path from 'node:path'; // 拼接目标路径
import crypto from 'node:crypto'; // 内容 SHA1 命名，天然去重
import https from 'node:https'; // HTTPS 传输
import http from 'node:http'; // HTTP 传输（自建/测试源）

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'; // 与真实浏览器一致，降低 WAF 误伤
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); // 限频用睡眠

/** 图片变体 → 角色。第一张是封面，spec 是规格图；数组顺序即降级顺序。 */
export const IMAGE_VARIANTS = [
  { role: 'cover', candidates: ['img1', 'img1_l', 'img1_m'] }, // 封面：原画质 → 高清压缩 → 800
  { role: 'gallery', candidates: ['img2', 'img2_l', 'img2_m'] }, // 画廊第 2 张
  { role: 'gallery', candidates: ['img3', 'img3_l', 'img3_m'] }, // 画廊第 3 张
  { role: 'gallery', candidates: ['img4', 'img4_l', 'img4_m'] }, // 画廊第 4 张
  { role: 'spec', candidates: ['spec'] }, // 规格图（实测 1121×668）
];

/** 按文件头识别真实扩展名，避免把 HTML 错误页当图片存下来。 */
export function magicExt(buffer) {
  if (buffer.length < 4) return null; // 过短直接拒绝
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg'; // JPEG
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png'; // PNG
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'gif'; // GIF
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) return 'webp'; // RIFF/WebP
  return null; // 其它一律丢弃
}

/** 1×1 占位图直接丢弃，不落盘也不入库。 */
export function isPlaceholder(buffer) {
  if (buffer.length < 200) return true; // 小于 200 字节基本是占位/错误图
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return buffer.readUInt32BE(16) <= 1 && buffer.readUInt32BE(20) <= 1; // PNG 头里的宽高
  }
  return false; // 其余格式按大小判断
}

/** 从图片字节里读出宽高：用于验证「确实高清」并写进商品图片元数据。 */
export function imageSize(buffer) {
  try {
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }; // PNG：IHDR 宽高
    }
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
      return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) }; // GIF：逻辑屏幕宽高
    }
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
      return { width: buffer.readUInt16LE(26), height: buffer.readUInt16LE(28) }; // WebP：VP8X 宽高
    }
    if (buffer[0] === 0xff && buffer[1] === 0xd8) {
      let i = 2; // 跳过 SOI
      while (i < buffer.length - 9) {
        if (buffer[i] !== 0xff) { i += 1; continue; } // 找下一个标记
        const marker = buffer[i + 1]; // 标记字节
        if (marker === 0xd8 || marker === 0xd9) { i += 2; continue; } // 无长度字段
        const len = buffer.readUInt16BE(i + 2); // 段长度
        if (marker >= 0xc0 && marker <= 0xc3) {
          return { width: buffer.readUInt16BE(i + 7), height: buffer.readUInt16BE(i + 5) }; // SOF：高在前宽在后
        }
        i += 2 + len; // 跳到下一段
      }
    }
  } catch {
    /* 解析失败按未知尺寸处理 */
  }
  return { width: 0, height: 0 }; // 未知
}

/** 创建源站客户端。 */
export function createClient(cfg, log) {
  const origin = new URL(cfg.baseUrl); // 站点源
  const transport = origin.protocol === 'http:' ? http : https; // 传输层
  const SVR = '/b2b-svr'; // 接口前缀
  const UPLOAD = '/b2b/static/uploads'; // 图片前缀

  let token = null; // CSRF 令牌
  let cookie = null; // 会话 Cookie
  let lastAt = 0; // 上次请求时间，用于全局限频

  /** 串行最小间隔限流：即使并发也排队，不突破 delay。 */
  async function paced(delayMs) {
    if (delayMs <= 0) return; // 关闭限频
    const wait = Math.max(0, delayMs - (Date.now() - lastAt)); // 计算还需等待多久
    if (wait > 0) await sleep(wait); // 睡到允许时刻
    lastAt = Date.now(); // 记录本次起点
  }

  /** 最底层请求：返回状态码、响应头与完整字节。 */
  function request(method, requestPath, headers = {}) {
    return new Promise((resolve, reject) => {
      const req = transport.request(
        { host: origin.hostname, port: origin.port || (origin.protocol === 'http:' ? 80 : 443), path: requestPath, method, headers },
        (res) => {
          const chunks = []; // 收集响应体
          res.on('data', (d) => chunks.push(d)); // 累积分片
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })); // 完成
        }
      );
      req.setTimeout(cfg.timeoutMs, () => req.destroy(new Error('timeout'))); // 超时销毁
      req.on('error', reject); // 网络错误透传
      req.end(); // 结束请求
    });
  }

  /** 合并 Set-Cookie，保持会话。 */
  function mergeCookie(res) {
    const list = res.headers['set-cookie']; // 响应 Set-Cookie
    if (!list) return; // 无 Cookie
    const jar = new Map((cookie || '').split('; ').filter(Boolean).map((c) => [c.split('=')[0], c])); // 现有 jar
    for (const c of list) {
      const kv = c.split(';')[0]; // 只取 name=value
      jar.set(kv.split('=')[0], kv); // 覆盖同名
    }
    cookie = [...jar.values()].join('; '); // 重新拼回请求头
  }

  /** CSRF 握手：令牌在响应头 el-result-code，同时刷新 Cookie。 */
  async function handshake() {
    await paced(cfg.listDelayMs); // 限频
    const res = await request('GET', `${SVR}/csrf`, {
      'User-Agent': UA,
      Accept: 'application/json, text/javascript, */*; q=0.01',
      Referer: `${origin.origin}/b2b/`,
    });
    token = res.headers['el-result-code'] || null; // 令牌
    mergeCookie(res); // 会话
    if (!token) throw new Error('csrf 握手未返回 el-result-code'); // 缺令牌直接失败
  }

  /** 组装业务请求头。 */
  function headers(referer) {
    const h = {
      'User-Agent': UA,
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: referer || `${origin.origin}/b2b/`,
    };
    if (token) h['el-xsrf'] = token; // 令牌
    if (cookie) h.Cookie = cookie; // 会话
    return h;
  }

  /** GET JSON：401/403/404 视为令牌过期，重新握手后重试。 */
  async function getJson(requestPath, referer, delayMs = cfg.listDelayMs) {
    let lastErr = ''; // 最近一次错误
    for (let attempt = 0; attempt <= cfg.maxRetries; attempt += 1) {
      await paced(delayMs); // 限频
      try {
        const res = await request('GET', requestPath, headers(referer)); // 发请求
        if (res.status === 200) {
          const text = res.body.toString('utf8'); // 文本体
          return text ? JSON.parse(text) : {}; // 空体按空对象
        }
        lastErr = `HTTP ${res.status}`; // 记录状态
        if (res.status === 401 || res.status === 403 || res.status === 404) await handshake(); // 令牌失效
        else if (res.status === 429 || res.status >= 500) await sleep(1500 * (attempt + 1)); // 退避
        else break; // 其它 4xx 不重试
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e); // 记录异常
        await sleep(800 * (attempt + 1)); // 网络退避
      }
    }
    throw new Error(`GET ${requestPath} 失败：${lastErr}`); // 重试耗尽
  }

  /** 下载图片：按内容 SHA1 命名落盘，返回文件、尺寸与字节数；不可达/占位图返回 null。 */
  async function downloadImage(remotePath, role) {
    if (!cfg.downloadImages) return null; // 关闭下载
    for (let attempt = 0; attempt <= cfg.maxRetries; attempt += 1) {
      await paced(cfg.listDelayMs); // 限频
      try {
        const res = await request('GET', remotePath, headers(`${origin.origin}/b2b/`)); // 下载
        if (res.status === 200 && res.body.length > 0) {
          if (isPlaceholder(res.body)) {
            log(`[image] 占位图丢弃 ${remotePath}`); // 占位图不落盘
            return null;
          }
          const ext = magicExt(res.body); // 真实格式
          if (!ext) {
            log(`[image] 魔数无法识别 ${remotePath}`); // 非图片
            return null;
          }
          const file = `${crypto.createHash('sha1').update(res.body).digest('hex')}.${ext}`; // 内容寻址文件名
          const dest = path.join(cfg.imageDir, file); // 目标路径
          if (!fs.existsSync(dest)) fs.writeFileSync(dest, res.body); // 已存在则跳过写入
          const dim = imageSize(res.body); // 读取宽高
          return { file, url: `${cfg.imageUrlPrefix}/${file}`, role, remote: remotePath, width: dim.width, height: dim.height, bytes: res.body.length }; // 元数据
        }
        if (res.status === 404) return null; // 该档不存在
        await sleep(1000 * (attempt + 1)); // 其它状态退避
      } catch {
        await sleep(800 * (attempt + 1)); // 网络异常退避
      }
    }
    return null; // 全部失败
  }

  /** 类目画廊：逐个角色尝试高清档，404 才降级；结果用于该三级类目下所有商品。 */
  async function galleryForC3(c3) {
    if (!cfg.downloadImages) return []; // 关闭下载
    const entries = []; // 收集结果
    for (const item of IMAGE_VARIANTS) {
      for (const name of item.candidates) {
        const got = await downloadImage(`${UPLOAD}/item/c3/${c3}/${name}`, item.role); // 尝试该档
        if (got) {
          entries.push(got); // 命中即止
          break;
        }
      }
    }
    return entries; // 返回本类目画廊
  }

  return { origin: origin.origin, SVR, getJson, handshake, downloadImage, galleryForC3, imageVariants: IMAGE_VARIANTS }; // 对外能力
}

/** 极简并发池：每个 worker 顺序消费队列，配合 paced 形成全局限流。 */
export async function mapPool(list, concurrency, fn) {
  const width = Math.max(1, Math.min(concurrency, list.length || 1)); // 实际并发
  let cursor = 0; // 共享游标
  const workers = Array.from({ length: width }, async () => {
    while (true) {
      const idx = cursor; // 领取任务
      cursor += 1; // 推进游标
      if (idx >= list.length) return; // 队列耗尽
      await fn(list[idx], idx); // 顺序执行
    }
  });
  await Promise.all(workers); // 等待全部 worker
}
