/**
 * Mim 全量商城采集器入口（2026-11-26）。
 *
 * 子命令：
 *   sync    抓取目录 / 商品 / 高清单图并幂等入库（默认全量，可用 --limit/--per-cat 做有界验证）
 *   verify  核对商品总数、一级类目覆盖、图片清晰度、最近同步批次与定时配置
 *   inspect 只读对账单件商品（不写库）
 *
 * 运行示例：
 *   node scripts/catalog/cli.mjs sync --limit 2 --per-cat 20
 *   node scripts/catalog/cli.mjs verify
 *   node scripts/catalog/cli.mjs inspect --item-no 764393
 */
import fs from 'node:fs'; // 读写报告
import path from 'node:path'; // 路径拼接

import { loadConfig, usage, REPO_ROOT } from './config.mjs'; // 配置
import { createClient } from './site.mjs'; // 源站客户端
import { collectCatalog, collectDetails, ensureDirs, applyImageFallback } from './collect.mjs'; // 采集阶段
import { createLogger, newRunId, rotateLog, pruneRunLogs, acquireLock, writeAtomic } from './util.mjs'; // 日志/锁/原子写
import {
  openDb,
  markRunStarted,
  markRunFinished,
  markRunPhase,
  upsertCategories,
  applyProducts,
  delistMissing,
  refreshCategoryCounts,
  readProduct,
  latestRun,
} from './store.mjs'; // 落库

/** 判断是否「全量运行」：只有全量、列表无失败、未触发预算停止且允许下架时才做下架判定。 */
function isFullRun(cfg) {
  return !cfg.limit && !cfg.perCat && !cfg.maxItems && !cfg.pages && !cfg.dryRun && !cfg.noDelist; // 任一有界参数都返回 false
}

/** 单轮时间预算是否已用完。 */
function budgetExceeded(cfg, startedAt) {
  return cfg.maxRuntimeMin > 0 && Date.now() - startedAt >= cfg.maxRuntimeMin * 60000; // 分钟 → 毫秒
}

/** sync 子命令。 */
async function runSync(cfg, logger) {
  ensureDirs(cfg); // 建目录
  rotateLog(cfg.logFile, cfg.logMaxBytes); // 轮转旧日志
  const release = acquireLock(cfg.stateDir); // 防重入
  const runId = newRunId(); // 批次号
  const startedAt = new Date().toISOString(); // 开始时间
  cfg.budgetStart = Date.now(); // 时间预算起点
  const db = openDb(cfg.dbPath); // 打开库（会幂等建表）
  const client = createClient(cfg, logger.log); // 源站客户端
  let stats = {}; // 汇总
  try {
    markRunStarted(db, runId, startedAt); // 批次开始
    logger.log(`[run] ${runId} 开始，库 ${cfg.dbPath}，图片 ${cfg.imageDir}，dryRun=${cfg.dryRun}`);

    let catalog = null; // 目录阶段结果
    const snapshot = path.join(cfg.stateDir, 'catalog.json'); // 列表快照
    if (cfg.resume && fs.existsSync(snapshot)) {
      const cached = JSON.parse(fs.readFileSync(snapshot, 'utf8')); // 复用上次列表
      catalog = {
        tree: cached.tree || [],
        leaves: [],
        items: cached.items || [],
        perCategory: cached.perCategory || [],
        gallery: JSON.parse(fs.existsSync(path.join(cfg.stateDir, 'gallery.json')) ? fs.readFileSync(path.join(cfg.stateDir, 'gallery.json'), 'utf8') : '{}'),
        errors: [],
        listFailed: 0,
        scanned: 0,
        durationSec: 0,
      };
      logger.log(`[resume] 复用列表快照 ${catalog.items.length} 条`);
    } else {
      await client.handshake(); // 首次握手
      catalog = await collectCatalog(client, cfg, logger.log); // 目录 + 列表 + 画廊
    }

    // 源站无图商品复用同级真实高清图；collectCatalog 已处理过，这里覆盖 --resume 复用的旧快照
    const fallbackFilled = applyImageFallback(catalog.items, catalog.gallery); // 幂等兜底
    if (fallbackFilled > 0) logger.log(`[image] 无图商品兜底 ${fallbackFilled} 件`);

    let catalogFirst = { inserted: 0, updated: 0, unchanged: 0, images: 0 }; // 列表阶段入库统计
    if (!cfg.dryRun) {
      const catCount = upsertCategories(db, catalog.tree, new Date().toISOString()); // 类目树
      logger.log(`[db] 类目 upsert ${catCount} 个`);
      catalogFirst = applyProducts({ db, runId, items: catalog.items, details: null, gallery: catalog.gallery, now: new Date().toISOString() }); // 列表项先保底入库
      logger.log(`[db] 列表项入库 新增 ${catalogFirst.inserted} / 更新 ${catalogFirst.updated} / 未变 ${catalogFirst.unchanged}`);
    }

    let detailStats = { targets: 0, fetched: 0, errors: 0, durationSec: 0 }; // 详情统计
    let second = { inserted: 0, updated: 0, unchanged: 0, images: 0 }; // 详情入库统计
    if (catalog.items.length > 0) {
      markRunPhase(db, runId, 'detail'); // 阶段推进
      const details = await collectDetails(client, cfg, catalog.items, logger.log); // 抓详情（断点续跑）
      detailStats = details.stats; // 统计
      if (!cfg.dryRun) {
        second = applyProducts({ db, runId, items: catalog.items, details: details.store, gallery: catalog.gallery, now: new Date().toISOString() }); // 详情覆盖
        logger.log(`[db] 详情入库 新增 ${second.inserted} / 更新 ${second.updated} / 未变 ${second.unchanged}`);
      }
    }

    if (isFullRun(cfg) && catalog.listFailed === 0 && !catalog.budgetStop && !detailStats.partial) {
      delistMissing(db, catalog.items.map((i) => i.sourceKey), new Date().toISOString()); // 全量下架判定
      logger.log('[db] 已执行源站下架标记（未抓到的商品只置 listed=0）');
    } else if (catalog.budgetStop || detailStats.partial) {
      logger.log('[db] 本轮触发时间预算，跳过下架判定；次日 --resume 续跑');
    }

    if (!cfg.dryRun) refreshCategoryCounts(db); // 回填类目商品数

    stats = {
      runId,
      baseUrl: cfg.baseUrl,
      dryRun: cfg.dryRun,
      categories: { l1: catalog.tree.length, leaves: catalog.leaves.length || null, perCategory: catalog.perCategory.length },
      products: {
        crawled: catalog.items.length,
        scanned: catalog.scanned,
        inserted: (catalogFirst?.inserted || 0) + second.inserted,
        updated: (catalogFirst?.updated || 0) + second.updated,
        unchanged: second.unchanged,
      },
      details: detailStats,
      images: second.images,
      imageFallback: fallbackFilled,
      partial: Boolean(catalog.budgetStop || detailStats.partial),
      listFailed: catalog.listFailed,
      errors: catalog.errors.slice(0, 50),
      durationSec: catalog.durationSec + detailStats.durationSec,
    };
    const reportPath = path.join(cfg.reportDir, `${runId}.json`); // 报告路径
    writeAtomic(reportPath, JSON.stringify(stats, null, 2)); // 写报告
    markRunFinished(db, runId, 'done', stats, reportPath, null); // 批次完成
    logger.log(`[run] ${runId} 完成：${JSON.stringify(stats.products)}`);
    return stats; // 返回
  } catch (e) {
    const message = e instanceof Error ? e.stack || e.message : String(e); // 错误
    logger.log(`[run] 失败：${message}`);
    try {
      markRunFinished(db, runId, 'failed', stats, null, message); // 记录失败摘要
    } catch {
      /* 数据库不可用时只保留日志 */
    }
    throw e; // 交给进程退出码
  } finally {
    db.close(); // 关闭库
    release(); // 释放锁
    pruneRunLogs(cfg.reportDir, 30); // 只保留最近 30 份日志
    logger.close(); // 关闭日志
  }
}

/** repair 子命令：复用已有 catalog/details/gallery 快照重算图片与字段，不重新出网。 */
function runRepair(cfg, logger) {
  const read = (name, fallback) => {
    const file = path.join(cfg.stateDir, name); // 快照路径
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback; // 容错读取
  };
  if (!fs.existsSync(path.join(cfg.stateDir, 'catalog.json'))) throw new Error('缺少 catalog.json，请先执行 sync'); // 前置守卫
  const catalog = read('catalog.json', { items: [] }); // 目录快照
  const details = read('details.json', { items: {} }); // 详情快照
  const gallery = read('gallery.json', {}); // 画廊快照
  const filled = applyImageFallback(catalog.items || [], gallery); // 图片兜底
  const db = openDb(cfg.dbPath); // 打开库
  try {
    const runId = newRunId(); // 批次号
    const now = new Date().toISOString(); // 当前时间
    markRunStarted(db, runId, now); // 记录批次
    const stats = applyProducts({ db, runId, items: catalog.items || [], details, gallery, now }); // 重算入库
    refreshCategoryCounts(db); // 回填类目计数
    markRunFinished(db, runId, 'done', { repair: true, fallbackFilled: filled, ...stats }, null, null); // 完成
    logger.log(`[repair] 兜底 ${filled} 件，入库 新增 ${stats.inserted} / 更新 ${stats.updated} / 未变 ${stats.unchanged}，图片 ${stats.images}`);
    return { filled, ...stats }; // 返回
  } finally {
    db.close(); // 关闭
  }
}

/** verify 子命令：输出可核对的覆盖情况与图片清晰度。 */
function runVerify(cfg) {
  const db = openDb(cfg.dbPath); // 打开库
  try {
    const total = db.prepare("SELECT COUNT(*) AS n FROM catalog_products WHERE source = 'egluosi'").get().n; // 商品总数
    const listed = db.prepare("SELECT COUNT(*) AS n FROM catalog_products WHERE source = 'egluosi' AND listed = 1").get().n; // 可售数
    const l1 = db.prepare(
      `SELECT c.id, c.code, c.name,
              (SELECT COUNT(*) FROM catalog_products p WHERE p.source = 'egluosi' AND p.listed = 1 AND p.c1_id = c.id) AS product_count
         FROM catalog_categories c
        WHERE c.level = 1
        ORDER BY c.sort_no`
    ).all(); // 一级类目（实时计数，同步中途也能核对覆盖）
    const l2n = db.prepare('SELECT COUNT(*) AS n FROM catalog_categories WHERE level = 2').get().n; // 二级数
    const l3n = db.prepare('SELECT COUNT(*) AS n FROM catalog_categories WHERE level = 3').get().n; // 三级数
    const rows = db.prepare("SELECT c1_id, images FROM catalog_products WHERE source = 'egluosi' AND listed = 1").all(); // 图片分布
    let imgTotal = 0; // 图片总数
    let hd = 0; // >=800 的图片数
    let sd = 0; // <800 的图片数
    const byRole = { cover: { n: 0, hd: 0 }, gallery: { n: 0, hd: 0 }, spec: { n: 0, hd: 0 } }; // 按角色分组的清晰度
    const perCatImages = new Map(); // 一级类目图片统计
    for (const row of rows) {
      let images = []; // 图片数组
      try { images = JSON.parse(row.images || '[]'); } catch { images = []; } // 容错
      const stat = perCatImages.get(row.c1_id) || { products: 0, images: 0, hd: 0 }; // 类目统计
      stat.products += 1; // 商品数
      for (const img of images) {
        imgTotal += 1; // 图片总数
        stat.images += 1; // 类目图片数
        const longSide = Math.max(Number(img.width) || 0, Number(img.height) || 0); // 最大边
        const role = img.role === 'cover' ? 'cover' : img.role === 'spec' ? 'spec' : 'gallery'; // 角色归一
        byRole[role].n += 1; // 角色计数
        if (longSide >= 800) {
          hd += 1; // 高清
          stat.hd += 1; // 类目高清数
          byRole[role].hd += 1; // 角色高清数
        } else {
          sd += 1; // 低清
        }
      }
      perCatImages.set(row.c1_id, stat); // 回写
    }
    const run = latestRun(db); // 最近批次
    const runs = db.prepare("SELECT COUNT(*) AS n FROM catalog_sync_runs WHERE source = 'egluosi'").get().n; // 批次数
    const files = fs.existsSync(cfg.imageDir) ? fs.readdirSync(cfg.imageDir).length : 0; // 本地图片文件数
    const timer = path.join(REPO_ROOT, 'deploy', 'mim-catalog.timer'); // systemd 定时单元
    const cron = path.join(REPO_ROOT, 'deploy', 'catalog-cron'); // crontab 片段
    const result = {
      database: cfg.dbPath,
      products: { total, listed },
      categories: {
        l1: l1.map((c) => ({ code: c.code, name: c.name, products: c.product_count, images: perCatImages.get(c.id)?.images || 0, hd: perCatImages.get(c.id)?.hd || 0 })),
        l2: l2n,
        l3: l3n,
      },
      images: { total: imgTotal, hd, sd, hdRatio: imgTotal ? Number((hd / imgTotal).toFixed(4)) : 0, files, by_role: byRole },
      sync: { runs, latest: run ? { runId: run.run_id, startedAt: run.started_at, finishedAt: run.finished_at, status: run.status, phase: run.phase, stats: JSON.parse(run.stats || '{}') } : null },
      schedule: {
        timer: fs.existsSync(timer) ? timer : null,
        cron: fs.existsSync(cron) ? cron : null,
        ps1: fs.existsSync(path.join(REPO_ROOT, 'scripts', 'catalog', 'run-daily.ps1')),
      },
    };
    console.log(JSON.stringify(result, null, 2)); // 机器可读
    console.log('\n== 核对摘要 =='); // 人读摘要
    console.log(`商品总数 ${total}，可售 ${listed}；一级类目 ${l1.length} 个，二级 ${l2n}，三级 ${l3n}`);
    for (const c of result.categories.l1) console.log(`- ${c.code} ${c.name}：商品 ${c.products}，图片 ${c.images}（高清 ${c.hd}）`);
    console.log(`图片 ${imgTotal} 张，高清(≥800px) ${hd}，低清 ${sd}，高清率 ${(result.images.hdRatio * 100).toFixed(1)}%，落盘文件 ${files}`);
    console.log(`按角色：封面 ${byRole.cover.hd}/${byRole.cover.n} 高清，画廊 ${byRole.gallery.hd}/${byRole.gallery.n} 高清，规格图 ${byRole.spec.hd}/${byRole.spec.n} 高清（规格图源站原尺寸，多为 400–700px 线稿）`);
    console.log(`同步批次 ${runs} 次，最近 ${run ? `${run.run_id} ${run.status}` : '无'}`);
    console.log(`定时配置：systemd=${result.schedule.timer || '未安装'}，cron=${result.schedule.cron || '未安装'}，PowerShell=${result.schedule.ps1 ? '已提供' : '未提供'}`);
    return result; // 返回
  } finally {
    db.close(); // 关闭
  }
}

/** inspect 子命令：只读对账单件。 */
async function runInspect(cfg, logger) {
  ensureDirs(cfg); // 目录
  const db = openDb(cfg.dbPath); // 库
  const client = createClient(cfg, logger.log); // 客户端
  try {
    if (cfg.itemNo) {
      await client.handshake(); // 握手
      const r = await client.getJson(`${client.SVR}/api/mall/item?itemNo=${encodeURIComponent(cfg.itemNo)}`, `${client.origin}/b2b/mall/item?itemNo=${cfg.itemNo}`); // 源站详情
      const row = readProduct(db, r.code ? `sku:${r.code}` : `url:${client.origin}/b2b/mall/item?itemNo=${cfg.itemNo}`); // 本地行
      console.log(JSON.stringify({ source: r, local: row }, null, 2)); // 输出
      return; // 结束
    }
    console.log('inspect 需要 --item-no <货号>'); // 提示
  } finally {
    db.close(); // 关闭
  }
}

/** 入口。 */
async function main() {
  const cfg = loadConfig(process.argv); // 解析参数
  if (cfg.help) {
    console.log(usage()); // 帮助
    return;
  }
  if (cfg.site !== 'egluosi') throw new Error(`不支持的货源站：${cfg.site}（当前仅 egluosi）`); // 单源守卫
  ensureDirs(cfg); // 所有子命令都先建目录：日志流与报告不能依赖后续步骤
  const logger = createLogger(cfg.reportDir, newRunId()); // 控制台 + 批次日志
  try {
    if (cfg.command === 'sync') await runSync(cfg, logger); // 同步
    else if (cfg.command === 'repair') runRepair(cfg, logger); // 用快照重算图片/字段
    else if (cfg.command === 'verify') runVerify(cfg); // 核对
    else if (cfg.command === 'inspect') await runInspect(cfg, logger); // 对账
    else console.log(usage()); // 未知命令
  } finally {
    logger.close(); // 关闭日志
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack || e.message : e); // 输出错误
  process.exitCode = 1; // 非零退出码，便于 cron 告警
});
