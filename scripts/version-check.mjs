#!/usr/bin/env node
// 上一行是 shebang：指定以 node 作为解释器，使脚本可在类 Unix 环境直接 ./version-check.mjs 运行
/**
 * scripts/version-check.mjs  // 脚本相对路径，便于在 CI 日志中快速定位来源
 *
 * 强制落实 AGENTS.md 铁律四：版本号规约  // 本脚本存在的唯一目的，即把铁律四变成可执行门禁
 *
 * 规则：  // 下列四条规则与铁律四正文一一对应
 *  1. 首个对外正式发布版本 = V0.0.0，递增；发布前不得占用。  // 正式版本号从 0.0.0 起算
 *  2. 内部 / 预览 / 草稿构建用 RELEASE_CHANNEL（preview/draft/test）区分，  // 预览构建不改 semver 数字
 *     展示为 V0.0.0-preview 等，不改 semver 数字。  // 通道只体现在展示后缀上
 *  3. 内部 git tag 命名为 draft-* / pre-*，不得为 V<semver> 形态。  // 避免预览构建污染正式版本序列
 *  4. 通道感知：预览通道下若仓库已有 V<semver> 正式 tag 则报 ❌。  // 预览与正式不可共存
 *
 * 用法：  // 两种调用方式，差异仅在是否注入 RELEASE_CHANNEL
 *   node scripts/version-check.mjs  // 正式通道校验
 *   RELEASE_CHANNEL=preview node scripts/version-check.mjs  // 预览通道校验
 *
 * 退出码：0 = 通过，1 = 存在违规。  // CI 仅依据退出码判定门禁结果
 */

// 引入 node:child_process 的 execSync：同步执行 shell 命令（本脚本用于调用 git） // 同步执行便于线性表达校验流程
import { execSync } from 'node:child_process'; // 仅需同步版，避免引入 Promise 编排复杂度
// 引入 node:fs 的 existsSync / readFileSync：检测文件是否存在、读取文件文本内容 // 版本号来源可能不存在，需先探测再读取
import { existsSync, readFileSync } from 'node:fs'; // 两个函数覆盖「探测 + 读取」全部需求
// 引入 node:path 的 join / dirname：拼接跨平台路径、取路径的目录部分 // Windows 与 Linux 路径分隔符不同，必须用 path 工具
import { join, dirname } from 'node:path'; // join 拼接、dirname 取父目录
// 引入 node:url 的 fileURLToPath：把 file:// 形式的 URL 转成本地文件系统路径 // import.meta.url 是 URL，不是路径
import { fileURLToPath } from 'node:url'; // 转换后才能交给 dirname / join 处理

// ESM 模块没有内置 __dirname，这里用 import.meta.url 推导当前脚本所在目录 // 兼容 ESM 的标准做法
const __dirname = dirname(fileURLToPath(import.meta.url)); // 先转路径再去目录，得到 scripts/ 的绝对路径
// 项目根目录 = 本脚本所在 scripts 目录的上一级 // 后续所有相对资源都以根目录为基准
const ROOT = join(__dirname, '..'); // 拼出仓库根目录，避免依赖进程 cwd

// 语义化版本号正则：严格匹配 X.Y.Z 三段非负整数（如 0.0.0、1.2.3） // 不允许前缀 v、不允许预发布后缀
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/; // 全串锚定，防止 "1.2.3-beta" 这类写法混入
// 正式对外 tag 正则：大写 V 开头 + semver（如 V0.0.0） // 与铁律四的正式版本命名格式一致
const OFFICIAL_TAG_RE = /^V\d+\.\d+\.\d+$/; // 大写 V 是约定，小写 v 视为非规范
// 内部 tag 正则：必须以 draft- 或 pre- 前缀开头（如 draft-2026-11-03、pre-rc1） // 内部构建的合法命名空间
const INTERNAL_TAG_RE = /^(draft|pre)-/; // 前缀后内容不限，便于携带日期或序号
// 合法的发布通道白名单：仅允许 preview / draft / test 三种 // 白名单式校验，杜绝拼写错误静默通过
const VALID_CHANNELS = new Set(['preview', 'draft', 'test']); // 用 Set 做 O(1) 命中判断

// 进程退出码：默认 0 表示全部通过；任何一项违规都会被置为 1 // 单一变量集中累积，避免多处提前退出
let exitCode = 0; // 初始视为通过，交由各项校验按需置 1
// 读取环境变量 RELEASE_CHANNEL 并去掉两侧空白；未设置时为空字符串（视为正式通道） // 空字符串即「正式通道」的哨兵值
const channel = (process.env.RELEASE_CHANNEL || '').trim(); // 兼容 process.env 取到 undefined 的情况

// 打印校验器标题行 // 便于在 CI 多步骤日志中定位本步骤输出
console.log('=== Mim 版本号校验 (铁律四) ==='); // 标题中带上铁律编号，便于回溯规则出处
// 打印当前发布通道；未设置时显示「正式通道」 // 明示本次判定所依据的通道
console.log(`RELEASE_CHANNEL = ${channel || '(unset / 正式通道)'}`); // 未设置时给出可读文案而非空白
// 打印空行用于分隔输出区块 // 提升日志可读性
console.log(''); // 仅换行，无业务含义

// ---------- 1. 版本号来源 ---------- // 第一项校验：版本号本身是否合规
// 读取版本号：优先取 package.json 的 version 字段，其次取根目录 VERSION 文件内容 // 双来源兼容不同项目形态
function readVersion() { // 返回 { source, version } 或 null
  // package.json 的绝对路径 // 由 ROOT 拼接，避免依赖 cwd
  const pkgPath = join(ROOT, 'package.json'); // 主来源路径
  // 若 package.json 存在，则尝试解析它 // 文件不存在时直接跳过该分支
  if (existsSync(pkgPath)) { // 探测文件是否存在，避免 readFileSync 抛 ENOENT
    try { // 包文件可能被人为改坏，解析需容错
      // 读取 package.json 文本并解析为 JSON 对象 // 一次性读取，文件体积很小
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')); // 指定 utf-8 避免 Buffer 拼接问题
      // 若存在 version 字段，返回来源标记与版本号 // 有值即视为有效来源
      if (pkg.version) return { source: 'package.json', version: pkg.version }; // 返回后即短路后续来源
    } catch { // JSON 解析失败分支
      // JSON 解析失败时静默忽略，继续向下尝试 VERSION 文件 // 容错降级，避免门禁因包文件损坏而崩溃
      // ignore parse errors, fall through // 英文提示保留原有语义，说明此处故意不处理
    } // 结束 try/catch
  } // 结束 package.json 分支
  // VERSION 文件的绝对路径 // 备选来源路径
  const verPath = join(ROOT, 'VERSION'); // 纯文本单行版本号
  // 若 VERSION 文件存在，读取其内容并去除首尾空白作为版本号返回 // 文本文件常有尾随换行
  if (existsSync(verPath)) { // 先探测再读取，避免异常
    return { source: 'VERSION', version: readFileSync(verPath, 'utf-8').trim() }; // trim 去掉换行与空格
  } // 结束 VERSION 分支
  // 两种来源都不存在，返回 null 表示无法确定版本号 // 交由调用方决定是警告还是报错
  return null; // 显式返回 null，语义清晰
} // 结束 readVersion

// 执行版本号读取，得到 { source, version } 或 null // 只调用一次，结果复用
const verInfo = readVersion(); // 缓存结果供后续分支判断
// 未找到任何版本号来源：打印警告并跳过版本号格式校验（不算违规） // 允许尚无版本文件的过渡期
if (!verInfo) { // 无来源分支
  console.log('⚠️  未找到版本号来源（package.json 或 VERSION 文件），跳过版本号校验。'); // 提示原因
  console.log('   建议在项目根目录创建 package.json 或 VERSION 文件以启用校验。'); // 给出可执行的修复建议
} else { // 有来源分支
  // 解构出来源名称与版本号字符串 // 后续拼接提示文案需要来源名
  const { source, version } = verInfo; // 局部变量，避免重复访问对象
  // 版本号不符合 semver 格式：打印错误并标记违规 // 格式不合法即阻断发布
  if (!SEMVER_RE.test(version)) { // 正则不匹配分支
    console.log(`❌ [${source}] 版本号 "${version}" 不符合 semver 格式（X.Y.Z）`); // 指明来源与实际值
    exitCode = 1; // 置违规码，令 CI 失败
  } else { // 格式合法分支
    // 版本号格式正确：打印通过信息 // 正向反馈便于确认门禁生效
    console.log(`✅ [${source}] 版本号 ${version} 格式正确`); // 输出来源与版本号
    // 组装展示用版本号：设置了通道时追加通道后缀（如 V0.0.0-preview） // 展示层体现通道，不改数字
    const display = channel ? `V${version}-${channel}` : `V${version}`; // 三目区分正式与预览
    // 打印展示用版本号 // 与铁律四的展示约定一致
    console.log(`   展示版本号: ${display}`); // 前缀缩进，从属于上方通过信息
  } // 结束格式判断
} // 结束来源判断

// ---------- 2. RELEASE_CHANNEL 合法性 ---------- // 第二项校验：通道名必须来自白名单
// 通道非空且不在白名单内：打印错误并标记违规 // 空值代表正式通道，天然合法
if (channel && !VALID_CHANNELS.has(channel)) { // 仅当显式设置了通道才校验
  console.log(`❌ RELEASE_CHANNEL="${channel}" 非法，仅允许 preview / draft / test`); // 明确列出可选值
  exitCode = 1; // 非法通道直接令门禁失败
} // 结束通道白名单校验

// ---------- 3. git tag 校验 ---------- // 第三项校验：tag 命名与通道是否自洽
// 判断项目根目录是否位于一个 git 工作区内 // 非 git 环境（如源码包解压）应跳过本项
function isGitRepo() { // 返回布尔值，不抛异常
  try { // git 命令失败会抛错，需捕获
    // 执行 git rev-parse --is-inside-work-tree，stdout/stderr 全部丢弃，只看是否报错 // 用退出码判定最可靠
    execSync('git rev-parse --is-inside-work-tree', { // 该命令是标准的工作区探测方式
      cwd: ROOT, // 以项目根目录为工作目录，避免受调用方 cwd 影响
      stdio: 'ignore', // 丢弃输出，只关心成功与否
    }); // 结束命令执行
    // 命令成功退出即为 git 仓库 // 无异常即命中该分支
    return true; // 返回真，后续继续做 tag 校验
  } catch { // 命令失败分支
    // 命令失败（不是 git 仓库，或未安装 git） // 两种情况对本脚本等价
    return false; // 返回假，调用方据此跳过 tag 校验
  } // 结束 try/catch
} // 结束 isGitRepo

// 获取当前仓库的全部 git tag 列表 // 供正式 tag 与内部 tag 两类规则共用
function getGitTags() { // 返回 string[] 或 null
  try { // 执行失败（如 git 不可用）需要兜底
    // 执行 git tag 拿到全部 tag 文本，按行拆分、去空白、过滤空行后返回数组 // 一次命令拿全量，避免逐 tag 调用
    return execSync('git tag', { cwd: ROOT, encoding: 'utf-8' }) // 指定 utf-8，避免中文 tag 乱码
      .split('\n') // Windows 下 git 输出可能含 \r，后续 trim 会一并处理
      .map((t) => t.trim()) // 去掉行尾空白与可能的 \r
      .filter(Boolean); // 过滤空字符串，保证数组元素均为有效 tag
  } catch { // 命令执行失败分支
    // 执行失败时返回 null，表示 tag 信息不可用 // 与「无 tag」区分开，便于上层措辞
    return null; // 显式返回 null
  } // 结束 try/catch
} // 结束 getGitTags

// 不是 git 仓库：打印警告并跳过 tag 校验 // 非 git 环境下 tag 概念不适用
if (!isGitRepo()) { // 探测结果取反分支
  console.log('⚠️  当前目录不是 git 仓库，跳过 tag 校验。'); // 提示跳过原因，不置违规码
} else { // 是 git 仓库分支
  // 读取全部 tag；读取失败时按空数组处理，保证后续 filter 不报错 // null 与空数组在本项校验中语义一致
  const tags = getGitTags() || []; // 用空数组兜底，避免 null.filter 抛 TypeError
  // 过滤出符合 V<semver> 形态的正式 tag // 用于通道冲突判断
  const officialTags = tags.filter((t) => OFFICIAL_TAG_RE.test(t)); // 仅保留大写 V 形态
  // 过滤出既不是正式形态、也不是 draft-/pre- 前缀的「非规范命名」tag // 用于给出命名规范提示
  const badInternalTags = tags.filter( // 双条件取反即「两边都不满足」
    (t) => !OFFICIAL_TAG_RE.test(t) && !INTERNAL_TAG_RE.test(t), // 既非正式也非内部前缀
  ); // 结束过滤

  // 打印空行分隔 // 分隔来源校验与 tag 校验两块输出
  console.log(''); // 仅换行
  // 打印现有 tag 总数与完整清单（无 tag 时显示 (none)） // 让读者一眼看清仓库 tag 现状
  console.log(`现有 git tags (${tags.length}): ${tags.length ? tags.join(', ') : '(none)'}`); // 逗号分隔便于阅读

  // 通道感知：预览/草稿/测试通道下不允许存在正式 tag // 两类版本序列必须互斥
  if (VALID_CHANNELS.has(channel)) { // 当前处于内部通道分支
    // 预览通道下仍存在正式 tag：违规 // 说明有人在预览构建上占用正式版本序列
    if (officialTags.length > 0) { // 存在正式 tag 分支
      console.log( // 输出违规详情
        `❌ 预览通道(${channel})下已存在正式 tag: ${officialTags.join(', ')}`, // 列出冲突的正式 tag
      ); // 结束违规提示
      console.log('   预览通道下不得使用 V<semver> 形态的 tag，应使用 draft-* / pre-*'); // 给出正确命名方式
      exitCode = 1; // 置违规码，阻断预览构建
    } else { // 无正式 tag 分支
      // 预览通道下无正式 tag：合规 // 内部构建未污染正式序列
      console.log(`✅ 预览通道(${channel})下无正式 tag，合规`); // 正向确认
    } // 结束冲突判断
  } else { // 正式通道分支
    // 正式通道（或未设置通道）：仅提示性列出已有的正式 tag，不算违规 // 正式通道本就允许存在正式 tag
    if (officialTags.length > 0) { // 存在正式 tag 分支
      console.log(`ℹ️  正式 tag: ${officialTags.join(', ')}`); // 仅信息提示，不置违规码
    } // 结束存在性判断
  } // 结束通道分支

  // 内部 tag 命名规范检查：存在非规范命名时打印警告（仅警告，不置违规码） // 历史 tag 不强行阻断，避免误伤
  if (badInternalTags.length > 0) { // 存在非规范 tag 分支
    console.log( // 输出命名建议
      `⚠️  存在非规范命名的内部 tag: ${badInternalTags.join(', ')}（应为 draft-* 或 pre-*）`, // 列出全部非规范 tag
    ); // 结束警告提示
  } // 结束非规范 tag 判断
} // 结束 git 仓库分支

// ---------- 4. 结论 ---------- // 汇总各项校验结果
// 打印空行分隔 // 让结论行在日志中独立可见
console.log(''); // 仅换行
// 根据累计退出码打印总结论 // 单一出口，便于 CI 阅读最后一行
if (exitCode === 0) { // 全部通过分支
  console.log('✅ 版本号校验通过'); // 正向总结论
} else { // 存在违规分支
  console.log('❌ 版本号校验未通过，请根据上方提示修正'); // 指引读者回看具体违规项
} // 结束总结论判断

// 以累计的退出码结束进程：0 = 通过，1 = 存在违规 // CI 依据该退出码判定门禁成败
process.exit(exitCode); // 显式退出，确保退出码被正确传递
