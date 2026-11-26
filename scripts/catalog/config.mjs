/**
 * 全量商城采集器配置：命令行参数 > 环境变量 > 默认值（2026-11-26）。
 *
 * 默认值面向 Mim 仓库布局：
 *   状态目录 <repo>/.catalog-sync           阶段快照 / 日志 / 报告
 *   图片目录 <repo>/storage/catalog-images  按内容 SHA1 落盘，API 经 /api/v1/mall/img 读取
 *   数据库   <repo>/services/mim-api/data/mim.db（SQLite，可用 --db 覆盖）
 */
import path from 'node:path'; // 路径拼接与解析
import { fileURLToPath } from 'node:url'; // 把模块 URL 转为文件路径

const HERE = path.dirname(fileURLToPath(import.meta.url)); // scripts/catalog 目录
export const REPO_ROOT = path.resolve(HERE, '..', '..'); // 仓库根目录
export const DEFAULT_DB_PATH = path.join(REPO_ROOT, 'services', 'mim-api', 'data', 'mim.db'); // 与 API 共用同一个 SQLite 库
export const DEFAULT_IMAGE_DIR = path.join(REPO_ROOT, 'storage', 'catalog-images'); // 商品图片落盘目录

/** 轻量参数读取器：只支持 --key value 与 --flag 两种形式，避免引入依赖。 */
function readArgs(argv) {
  const args = argv.slice(2); // 去掉 node 与脚本路径
  const has = (name) => args.includes(name); // 布尔开关
  const value = (name, fallback) => {
    const i = args.indexOf(name); // 参数位置
    if (i < 0) return fallback; // 未出现即默认值
    const next = args[i + 1]; // 紧跟的取值
    return next && !next.startsWith('--') ? next : fallback; // 下一个参数是开关时视为未取值
  };
  const number = (name, fallback, { min = 1 } = {}) => {
    const raw = value(name, ''); // 原始文本
    if (raw === '' || raw === undefined || raw === null) return fallback; // 缺省
    const n = Number(raw); // 转数字
    return Number.isFinite(n) && n >= min ? n : fallback; // 非数字或越界回落默认值
  };
  const bool = (name, envKey, fallback) => {
    if (has(name)) return true; // 显式开关优先
    const raw = process.env[envKey]; // 环境变量
    if (raw === undefined || raw === '') return fallback; // 未配置
    return !/^(0|false|no|off)$/i.test(raw); // 关闭词取反
  };
  const command = args[0] && !args[0].startsWith('--') ? args[0] : 'sync'; // 首个非开关参数为子命令
  return { args, has, value, number, bool, command };
}

/** 解析配置；cli.mjs 在每次运行开始时调用一次。 */
export function loadConfig(argv = process.argv) {
  const { args, has, value, number, bool, command } = readArgs(argv); // 读取原始参数
  const env = process.env; // 环境变量别名
  const stateDir = path.resolve(value('--state-dir', env.CATALOG_STATE_DIR || path.join(REPO_ROOT, '.catalog-sync'))); // 状态目录
  const storageDir = path.resolve(value('--storage-dir', env.CATALOG_IMAGE_DIR || DEFAULT_IMAGE_DIR)); // 图片根目录
  const dbPath = path.resolve(value('--db', env.MIM_DB_PATH || DEFAULT_DB_PATH)); // SQLite 库路径

  return {
    command, // 子命令：sync / inspect / verify
    help: has('--help') || has('-h'), // 帮助
    site: value('--site', env.CATALOG_SITE || 'egluosi'), // 货源站（当前仅 egluosi）
    baseUrl: value('--base-url', env.CATALOG_BASE_URL || 'https://eg.egluosi.com').replace(/\/+$/, ''), // 站点基址
    concurrency: number('--concurrency', Number(env.CATALOG_CONCURRENCY) || 1), // 详情并发（限频仍由 delay 控制）
    delayMs: number('--delay-ms', Number(env.DETAIL_DELAY_MS) || 250, { min: 0 }), // 详情请求间隔
    listDelayMs: number('--list-delay-ms', Number(env.CATALOG_DELAY_MS) || 400, { min: 0 }), // 列表/树请求间隔
    timeoutMs: number('--timeout-ms', 20000), // 单请求超时
    maxRetries: number('--retries', 3, { min: 0 }), // 重试次数
    downloadImages: !has('--no-images') && bool('', 'CATALOG_DOWNLOAD_IMAGES', true), // 是否下载图片
    withFilters: !has('--no-filters'), // 是否抓规格筛选项
    dryRun: has('--dry-run') || bool('', 'CATALOG_DRY_RUN', false), // 只对账不写库
    resume: has('--resume'), // 断点续跑
    limit: number('--limit', 0, { min: 0 }), // 只处理前 N 个三级类目
    perCat: number('--per-cat', Number(env.CATALOG_PER_CAT) || 0, { min: 0 }), // 每个三级类目最多 N 件
    maxItems: number('--max-items', Number(env.CATALOG_MAX_ITEMS) || 0, { min: 0 }), // 本次最多入库 N 件
    pages: number('--pages', Number(env.CATALOG_PAGES) || 0, { min: 0 }), // 每个类目最多翻 N 页
    maxRuntimeMin: number('--max-runtime-min', Number(env.CATALOG_MAX_RUNTIME_MIN) || 0, { min: 0 }), // 单轮运行预算（分钟），0 不限；生产默认 150
    noDelist: has('--no-delist') || bool('', 'CATALOG_NO_DELIST', false), // 禁止下架判定（定时任务默认开启，避免半轮误标停售）
    itemNo: value('--item-no', ''), // inspect：按货号查
    brand: value('--brand', ''), // inspect：按品牌定位
    spec: value('--spec', ''), // inspect：按规格定位
    dims: value('--dims', ''), // inspect：规格筛选
    lens: value('--lens', ''), // inspect：长度筛选
    stateDir, // 状态目录
    storageDir, // 图片根目录
    dbPath, // SQLite 路径
    logFile: path.join(stateDir, 'sync.log'), // run.sh 追加日志
    logMaxBytes: number('--log-max-bytes', 5 * 1024 * 1024), // 日志轮转阈值
    reportDir: path.join(stateDir, 'reports'), // 批次日志/报告
    imageDir: storageDir, // 图片直接落在根目录，文件名即 SHA1
    imageUrlPrefix: '/api/v1/mall/img', // API 对外图片前缀
    raw: args, // 原始参数，便于报告回显
  };
}

/** --help 输出；同时被 README 引用，改动需同步文档。 */
export function usage() {
  return [
    'Mim 全量商城采集器（egluosi 货源站）',
    '',
    '  node scripts/catalog/cli.mjs sync   [选项]   抓取目录/商品/图片并幂等入库',
    '  node scripts/catalog/cli.mjs repair [选项]   用已有快照重算图片兜底与字段，不出网',
    '  node scripts/catalog/cli.mjs verify [选项]   核对商品总数、一级类目覆盖、图片清晰度、定时配置',
    '  node scripts/catalog/cli.mjs inspect --item-no <no>  只读对账单件商品',
    '',
    '  --db <path>            SQLite 库（默认 services/mim-api/data/mim.db）',
    '  --base-url <url>       源站基址（默认 https://eg.egluosi.com）',
    '  --limit <n>            只处理前 n 个三级类目（调试/有界验证）',
    '  --per-cat <n>          每个三级类目最多取 n 件（有界覆盖）',
    '  --max-items <n>        本次最多入库 n 件',
    '  --pages <n>            每个类目最多翻 n 页',
    '  --max-runtime-min <n>  单轮运行预算分钟数（生产定时默认 150，到点优雅收尾、次日续跑）',
    '  --no-delist            不做下架判定（定时任务默认开启，避免半轮误标停售）',
    '  --no-images            不下载图片（保留库内已有图片）',
    '  --dry-run              只对账不写库',
    '  --resume               复用上次 catalog.json / details.json 断点续跑',
    '  --state-dir <dir>      状态/日志/报告目录（默认 .catalog-sync）',
    '  --storage-dir <dir>    图片目录（默认 storage/catalog-images）',
    '  --delay-ms <n>         详情请求间隔毫秒（默认 250）',
    '  --list-delay-ms <n>    列表请求间隔毫秒（默认 400）',
    '  --concurrency <n>      详情并发（默认 1）',
  ].join('\n');
}
