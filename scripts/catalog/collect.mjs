/**
 * 采集：目录树 → 叶子类目 → 商品列表（分页）→ 详情（2026-11-26，Mim 版）。
 *
 * 只负责取数与拼装，不碰数据库；字段落地规则仍在 mapping.mjs。
 * 与 MixmAPP 版差异：叶子节点保留完整 c1/c2/c3 链、支持 --per-cat / --max-items / --pages 有界覆盖、
 * 画廊缓存按「是否至少 800px」判定是否过期，保证滚动续抓始终向高清档收敛。
 */
import fs from 'node:fs'; // 目录创建
import path from 'node:path'; // 路径拼接

import { DETAIL_KEYS, buildCatalogItem } from './mapping.mjs'; // 字段映射与目录项构造
import { writeAtomic, readJson } from './util.mjs'; // 原子写与 JSON 读取
import { mapPool } from './site.mjs'; // 并发池

const PAGE_SIZE = 200; // 源站单页上限
const DETAIL_PERSIST_EVERY = 200; // 每 200 件落一次详情快照
const HANDSHAKE_EVERY = 2000; // 每 2000 次请求刷新一次令牌

/** 目录树 → 叶子类目；每个叶子带完整链路（一级 / 二级 / 三级）。 */
export function flattenLeaves(roots) {
  const leaves = []; // 结果
  const walk = (nodes, trail, chain) => {
    for (const node of nodes || []) {
      const ctg = node.ctg || {}; // 类目元信息
      const code = ctg.code || ctg.value; // 优先用源站数字编码，缺失退 value
      const nextChain = [...chain, { code: String(code), name: ctg.name, level: chain.length + 1, value: ctg.value }]; // 当前层链路
      const nextTrail = [...trail, ctg.name].filter(Boolean); // 名称路径
      if (Array.isArray(node.subs) && node.subs.length > 0) walk(node.subs, nextTrail, nextChain); // 继续下钻
      else leaves.push({ code: chain[0].code, c1: nextChain[0], c2: nextChain[1] || null, c3: nextChain[2], leafValue: ctg.value, path: nextTrail, chain: nextChain }); // 叶子（code 兼容旧映射的一级短码）
    }
  };
  for (const root of roots || []) {
    const ctg = root.ctg || {}; // 一级类目
    const code = ctg.code || ctg.value; // 一级编码
    const chain = [{ code: String(code), name: ctg.name, level: 1, value: ctg.value }]; // 一级链路
    walk(root.subs || [], [ctg.name], chain); // 从二级开始下钻
  }
  return leaves; // 全部叶子
}

/** 拉取目录树。 */
export async function fetchTree(client) {
  const tree = await client.getJson(`${client.SVR}/api/ctg/ccc`, `${client.origin}/b2b/`); // 目录树接口
  return Array.isArray(tree) ? tree : tree.main || []; // 兼容 {main: []} 包装
}

/** 拉取三级类目的规格筛选项（失败不影响主流程）。 */
export async function fetchFilters(client, c3) {
  return client.getJson(
    `${client.SVR}/api/mall/ccc_filter?c3=${encodeURIComponent(c3)}`,
    `${client.origin}/b2b/mall/ctg_items?c3=${encodeURIComponent(c3)}`
  );
}

/** 某三级类目的商品行（自动翻页；pages > 0 时限制页数）。 */
export async function fetchCategoryRows(client, c3, { pages = 0 } = {}) {
  const rows = []; // 累积行
  let offset = 0; // 偏移
  let total = 0; // 源站总数
  let pageNo = 0; // 已翻页数
  const referer = `${client.origin}/b2b/mall/ctg_items?c3=${encodeURIComponent(c3)}`; // 来源页
  while (true) {
    const page = await client.getJson(
      `${client.SVR}/api/mall/ccc_items?c3=${encodeURIComponent(c3)}&offset=${offset}&limit=${PAGE_SIZE}`,
      referer
    );
    const pageRows = Array.isArray(page.rows) ? page.rows : []; // 本页行
    total = Number(page.total) || pageRows.length; // 总数
    rows.push(...pageRows); // 累加
    offset += pageRows.length; // 推进偏移
    pageNo += 1; // 页计数
    if (pageRows.length === 0 || rows.length >= total) break; // 抓完
    if (pages > 0 && pageNo >= pages) break; // 页数上限
  }
  return { rows, total }; // 返回
}

/** 单件详情；缺失字段补 null，保证 buildDetail 见到稳定结构。 */
export async function fetchItem(client, no, delayMs) {
  try {
    const json = await client.getJson(
      `${client.SVR}/api/mall/item?itemNo=${encodeURIComponent(no)}`,
      `${client.origin}/b2b/mall/item?itemNo=${no}`,
      delayMs
    );
    return { ok: true, item: Object.fromEntries(DETAIL_KEYS.map((k) => [k, json[k] === undefined ? null : json[k]])) }; // 只保留需要的键
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }; // 单件失败不阻断
  }
}

/** 画廊缓存是否「不够清晰」：空、缺封面、最大边 < 800 都视为需重采。 */
function isStaleGallery(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return true; // 空缓存
  const cover = entries.find((e) => e?.role === 'cover'); // 封面
  if (!cover) return true; // 必须有封面
  const maxSide = Math.max(Number(cover.width) || 0, Number(cover.height) || 0); // 封面最大边
  return maxSide < 800; // 低于 800 视为模糊
}

/** 类目画廊（按 c3 缓存到 gallery.json，跨运行复用）。 */
export async function collectGallery(client, cfg, c3, cache) {
  if (cache[c3] && !isStaleGallery(cache[c3])) return cache[c3]; // 命中缓存
  const entries = await client.galleryForC3(c3); // 重新下载
  cache[c3] = entries; // 更新缓存
  writeAtomic(path.join(cfg.stateDir, 'gallery.json'), cache); // 落盘
  return entries; // 返回
}

/**
 * 图片兜底：源站部分三级类目（钻头/铰刀等）没有任何图，商品会空封面。
 * 规则：同类目无图 → 借用同一二级类目下最接近的高清画廊 → 再退同一级类目，
 * 只复用真实商品图，不生成假图；被兜底的商品打 imageFallback 标记，便于核对。
 * @returns {number} 被兜底的商品数
 */
export function applyImageFallback(items, gallery) {
  const metaByC3 = new Map(); // c3 值 → { c1, c2 }
  for (const item of items) {
    if (item.c3) metaByC3.set(item.c3, { c1: item.chain?.[0]?.code, c2: item.chain?.[1]?.code }); // 记录链路
  }
  const byC2 = new Map(); // 二级类目 → 首个有图画廊
  const byC1 = new Map(); // 一级类目 → 首个有图画廊
  for (const [c3, entries] of Object.entries(gallery || {})) {
    if (!Array.isArray(entries) || entries.length === 0) continue; // 空画廊跳过
    const meta = metaByC3.get(c3); // 该 c3 的链路
    if (!meta) continue; // 无链路信息
    if (meta.c2 && !byC2.has(meta.c2)) byC2.set(meta.c2, entries); // 记录二级画廊
    if (meta.c1 && !byC1.has(meta.c1)) byC1.set(meta.c1, entries); // 记录一级画廊
  }
  let filled = 0; // 兜底计数
  for (const item of items) {
    if (Array.isArray(item.images) && item.images.length > 0) continue; // 已有图不动
    const meta = metaByC3.get(item.c3) || {}; // 当前链路
    const entries = byC2.get(meta.c2) || byC1.get(meta.c1) || []; // 二级优先，一级兜底
    if (entries.length === 0) continue; // 同源确实无图
    item.images = entries.map((e) => e.url); // 复用真实商品图
    item.cover = item.images[0] || null; // 封面
    item.imageFallback = true; // 兜底标记
    filled += 1; // 计数
  }
  return filled; // 返回兜底数
}

/**
 * 阶段一：目录 + 列表 + 画廊。
 * @returns {{tree: Array, leaves: Array, items: Array, perCategory: Array, gallery: Object, errors: Array, listFailed: number, scanned: number}}
 */
export async function collectCatalog(client, cfg, log, treeFromResume) {
  const startedAt = Date.now(); // 计时
  const galleryCache = readJson(path.join(cfg.stateDir, 'gallery.json'), {}); // 画廊缓存
  const tree = treeFromResume || (await fetchTree(client)); // 目录树（续跑可复用）
  const allLeaves = flattenLeaves(tree); // 全部叶子
  const targets = cfg.limit > 0 ? allLeaves.slice(0, cfg.limit) : allLeaves; // 有界截取
  log(`[catalog] 一级类目 ${tree.length} 个，三级叶子 ${allLeaves.length} 个，本次处理 ${targets.length} 个`);

  const items = []; // 目录项
  const perCategory = []; // 每类统计
  const errors = []; // 失败明细
  let listFailed = 0; // 列表失败类目数
  let scanned = 0; // 源站声明总数
  let maxReached = false; // 是否触发 maxItems
  let budgetStop = false; // 是否触发单轮时间预算

  for (const leaf of targets) {
    if (maxReached) break; // 已达上限
    if (cfg.maxRuntimeMin > 0 && Date.now() - (cfg.budgetStart || startedAt) >= cfg.maxRuntimeMin * 60000) {
      budgetStop = true; // 预算用尽
      log(`[catalog] 触发 ${cfg.maxRuntimeMin} 分钟预算，提前收尾；次日 --resume 续抓剩余类目`);
      break; // 退出类目循环
    }
    const c3 = leaf.leafValue; // 三级值
    let rows = []; // 列表行
    let siteCount = 0; // 源站总数
    let failed = false; // 本类目列表是否失败
    try {
      const page = await fetchCategoryRows(client, c3, { pages: cfg.pages }); // 翻页
      rows = page.rows; // 行
      siteCount = page.total; // 总数
    } catch (e) {
      failed = true; // 记失败
      listFailed += 1; // 累计
      errors.push({ c3, error: e instanceof Error ? e.message : String(e) });
    }
    scanned += siteCount; // 累计

    // 画廊按 c3 复用缓存；只有开启下载且缓存不清晰时才出网
    let gallery = galleryCache[c3] && !isStaleGallery(galleryCache[c3]) ? galleryCache[c3] : [];
    if (rows.length > 0 && cfg.downloadImages && isStaleGallery(galleryCache[c3])) {
      try {
        gallery = await collectGallery(client, cfg, c3, galleryCache); // 下载封面/画廊/规格图
      } catch (e) {
        errors.push({ c3, error: `画廊：${e instanceof Error ? e.message : String(e)}` });
      }
    }

    let added = 0; // 本类目新增
    for (let row of rows) {
      if (cfg.perCat > 0 && added >= cfg.perCat) break; // 每类上限
      if (cfg.maxItems > 0 && items.length >= cfg.maxItems) { maxReached = true; break; } // 全局上限
      const item = buildCatalogItem(row, leaf, gallery, client.origin); // 构造目录项
      if (item) {
        items.push(item); // 收集
        added += 1; // 计数
      }
    }
    perCategory.push({ path: leaf.path.join('/'), c3, siteCount, crawled: rows.length, added, failed }); // 统计
    log(`[catalog] ${leaf.path.join(' / ')}：站点 ${siteCount} / 实抓 ${rows.length} / 新增 ${added}，累计 ${items.length}`);
  }

  // 同一 sourceKey 只保留首条
  const seen = new Set(); // 去重集合
  const unique = []; // 去重后
  for (const item of items) {
    if (seen.has(item.sourceKey)) continue; // 已出现
    seen.add(item.sourceKey); // 标记
    unique.push(item); // 保留
  }

  // 源站无图的商品按二级/一级类目复用真实高清图，避免空封面
  const fallbackFilled = applyImageFallback(unique, galleryCache); // 兜底
  if (fallbackFilled > 0) log(`[catalog] 无图商品兜底 ${fallbackFilled} 件（复用同二级/一级类目的真实高清图）`);

  const durationSec = Math.round((Date.now() - startedAt) / 1000); // 耗时
  writeAtomic(path.join(cfg.stateDir, 'catalog.json'), {
    generatedAt: new Date().toISOString(),
    tree,
    perCategory,
    items: unique,
  }); // 快照
  log(`[catalog] 完成：${unique.length} 条，耗时 ${durationSec}s，画廊 ${Object.values(galleryCache).reduce((n, l) => n + l.length, 0)} 张`);

  return { tree, leaves: allLeaves, items: unique, perCategory, gallery: galleryCache, errors, listFailed, scanned, durationSec, fallbackFilled, budgetStop }; // 返回
}

/**
 * 阶段二：详情（断点续跑：details.json 里已有的货号跳过）。
 * @param {Set<string>} only 只抓这些货号（inspect 用），空表示全部
 */
export async function collectDetails(client, cfg, items, log, only) {
  const startedAt = Date.now(); // 计时
  const file = path.join(cfg.stateDir, 'details.json'); // 详情快照
  const store = readJson(file, { items: {}, errors: [] }); // 读取旧快照
  store.items = store.items || {}; // 容错
  store.errors = Array.isArray(store.errors) ? store.errors : []; // 容错

  const targets = items.map((i) => i.itemNo).filter(Boolean).filter((no) => !only || only.has(no)); // 目标货号
  const pending = targets.filter((no) => !store.items[no]); // 尚未抓到的
  log(`[detail] 待抓 ${pending.length}，已有 ${targets.length - pending.length}`);

  let tried = 0; // 已尝试
  let failed = 0; // 失败数
  let budgetStop = false; // 是否触发时间预算
  let sinceHandshake = 0; // 距上次握手

  await mapPool(pending, cfg.concurrency, async (no) => {
    if (budgetStop) return; // 预算已用尽，快速排空
    if (cfg.maxRuntimeMin > 0 && Date.now() - (cfg.budgetStart || startedAt) >= cfg.maxRuntimeMin * 60000) {
      budgetStop = true; // 本轮预算用尽
      return; // 不再发请求
    }
    const r = await fetchItem(client, no, cfg.delayMs); // 抓详情
    tried += 1; // 计数
    sinceHandshake += 1; // 计数
    if (r.ok) store.items[no] = r.item; // 成功落快照
    else {
      failed += 1; // 失败
      store.errors.push({ no, error: r.error, at: new Date().toISOString() }); // 记错误
      if (store.errors.length > 20000) store.errors.splice(0, 5000); // 控制快照体积
    }
    if (tried % DETAIL_PERSIST_EVERY === 0) {
      writeAtomic(file, store); // 定期落盘
      const rate = tried / Math.max(1, (Date.now() - startedAt) / 1000); // 速率
      log(`[detail] 进度 ${tried}/${pending.length} 失败 ${failed} 速率 ${rate.toFixed(2)}/s`);
    }
    if (sinceHandshake >= HANDSHAKE_EVERY) {
      sinceHandshake = 0; // 重置
      try {
        await client.handshake(); // 刷新令牌
      } catch {
        /* 下一轮请求会再试 */
      }
    }
  });

  writeAtomic(file, store); // 最终落盘
  const stats = {
    targets: targets.length, // 目标数
    fetched: targets.filter((no) => store.items[no]).length, // 成功数
    errors: store.errors.length, // 累计错误
    durationSec: Math.round((Date.now() - startedAt) / 1000), // 耗时
    partial: budgetStop, // 是否因预算提前收尾
  };
  if (budgetStop) log(`[detail] 触发 ${cfg.maxRuntimeMin} 分钟预算，提前收尾；次日 --resume 续抓`);
  log(`[detail] 完成：${stats.fetched}/${stats.targets}，失败 ${stats.errors}`);
  return { store, stats }; // 返回
}

/** 确保状态/报告/图片目录存在。 */
export function ensureDirs(cfg) {
  for (const dir of [cfg.stateDir, cfg.reportDir, cfg.imageDir]) fs.mkdirSync(dir, { recursive: true }); // 递归建目录
}
