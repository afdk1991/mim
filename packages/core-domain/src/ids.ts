/** UUIDv7 生成（时间有序，作为全表主键）。使用 Web Crypto，Node 19+ 与浏览器通用 */

// 对外暴露唯一的 ID 生成入口，返回 36 字符的 UUIDv7 字符串
export function uuidv7(): string {
  // 取当前毫秒时间戳，后续写入 UUID 前 48 位，保证 ID 随时间单调递增
  const now = Date.now();
  // 预分配 16 字节缓冲区，UUID 固定为 128 位
  const bytes = new Uint8Array(16);
  // 用 Web Crypto 填满 16 字节随机数，作为时间戳之后随机部分的来源
  globalThis.crypto.getRandomValues(bytes);
  // 第 1 字节：时间戳高 8 位（毫秒数右移 40 位），截断到 1 字节
  bytes[0] = (now / 2 ** 40) & 0xff;
  // 第 2 字节：时间戳次高 8 位（右移 32 位）
  bytes[1] = (now / 2 ** 32) & 0xff;
  // 第 3 字节：时间戳第 3 段（右移 24 位）
  bytes[2] = (now / 2 ** 24) & 0xff;
  // 第 4 字节：时间戳第 4 段（右移 16 位）
  bytes[3] = (now / 2 ** 16) & 0xff;
  // 第 5 字节：时间戳第 5 段（右移 8 位）
  bytes[4] = (now / 2 ** 8) & 0xff;
  // 第 6 字节：时间戳最低 8 位，至此 48 位毫秒时间戳写满
  bytes[5] = now & 0xff;
  // 第 7 版
  // 第 7 字节高 4 位固定为 0111，声明这是 v7 版本 UUID，低 4 位保留原有随机位
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  // 第 10 变体
  // 第 9 字节高 2 位固定为 10，声明这是 RFC 4122 变体，避免生成非标准 UUID
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  // 把 16 个字节逐个转成两位十六进制并拼接，得到 32 位纯十六进制串
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  // 按 8-4-4-4-12 的标准分组插入连字符，输出最终 UUID 文本形态
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
// 函数结束：返回的字符串可直接作为数据库主键或 API 资源 ID
}
