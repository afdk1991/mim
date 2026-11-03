#!/usr/bin/env node
/**
 * scripts/version-check.mjs
 *
 * 强制落实 AGENTS.md 铁律四：版本号规约
 *
 * 规则：
 *  1. 首个对外正式发布版本 = V0.0.0，递增；发布前不得占用。
 *  2. 内部 / 预览 / 草稿构建用 RELEASE_CHANNEL（preview/draft/test）区分，
 *     展示为 V0.0.0-preview 等，不改 semver 数字。
 *  3. 内部 git tag 命名为 draft-* / pre-*，不得为 V<semver> 形态。
 *  4. 通道感知：预览通道下若仓库已有 V<semver> 正式 tag 则报 ❌。
 *
 * 用法：
 *   node scripts/version-check.mjs
 *   RELEASE_CHANNEL=preview node scripts/version-check.mjs
 *
 * 退出码：0 = 通过，1 = 存在违规。
 */

// 引入 node:child_process 的 execSync：同步执行 shell 命令（本脚本用于调用 git）
import { execSync } from 'node:child_process';
// 引入 node:fs 的 existsSync / readFileSync：检测文件是否存在、读取文件文本内容
import { existsSync, readFileSync } from 'node:fs';
// 引入 node:path 的 join / dirname：拼接跨平台路径、取路径的目录部分
import { join, dirname } from 'node:path';
// 引入 node:url 的 fileURLToPath：把 file:// 形式的 URL 转成本地文件系统路径
import { fileURLToPath } from 'node:url';

// ESM 模块没有内置 __dirname，这里用 import.meta.url 推导当前脚本所在目录
const __dirname = dirname(fileURLToPath(import.meta.url));
// 项目根目录 = 本脚本所在 scripts 目录的上一级
const ROOT = join(__dirname, '..');

// 语义化版本号正则：严格匹配 X.Y.Z 三段非负整数（如 0.0.0、1.2.3）
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;
// 正式对外 tag 正则：大写 V 开头 + semver（如 V0.0.0）
const OFFICIAL_TAG_RE = /^V\d+\.\d+\.\d+$/;
// 内部 tag 正则：必须以 draft- 或 pre- 前缀开头（如 draft-2026-11-03、pre-rc1）
const INTERNAL_TAG_RE = /^(draft|pre)-/;
// 合法的发布通道白名单：仅允许 preview / draft / test 三种
const VALID_CHANNELS = new Set(['preview', 'draft', 'test']);

// 进程退出码：默认 0 表示全部通过；任何一项违规都会被置为 1
let exitCode = 0;
// 读取环境变量 RELEASE_CHANNEL 并去掉两侧空白；未设置时为空字符串（视为正式通道）
const channel = (process.env.RELEASE_CHANNEL || '').trim();

// 打印校验器标题行
console.log('=== Mim 版本号校验 (铁律四) ===');
// 打印当前发布通道；未设置时显示「正式通道」
console.log(`RELEASE_CHANNEL = ${channel || '(unset / 正式通道)'}`);
// 打印空行用于分隔输出区块
console.log('');

// ---------- 1. 版本号来源 ----------
// 读取版本号：优先取 package.json 的 version 字段，其次取根目录 VERSION 文件内容
function readVersion() {
  // package.json 的绝对路径
  const pkgPath = join(ROOT, 'package.json');
  // 若 package.json 存在，则尝试解析它
  if (existsSync(pkgPath)) {
    try {
      // 读取 package.json 文本并解析为 JSON 对象
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      // 若存在 version 字段，返回来源标记与版本号
      if (pkg.version) return { source: 'package.json', version: pkg.version };
    } catch {
      // JSON 解析失败时静默忽略，继续向下尝试 VERSION 文件
      // ignore parse errors, fall through
    }
  }
  // VERSION 文件的绝对路径
  const verPath = join(ROOT, 'VERSION');
  // 若 VERSION 文件存在，读取其内容并去除首尾空白作为版本号返回
  if (existsSync(verPath)) {
    return { source: 'VERSION', version: readFileSync(verPath, 'utf-8').trim() };
  }
  // 两种来源都不存在，返回 null 表示无法确定版本号
  return null;
}

// 执行版本号读取，得到 { source, version } 或 null
const verInfo = readVersion();
// 未找到任何版本号来源：打印警告并跳过版本号格式校验（不算违规）
if (!verInfo) {
  console.log('⚠️  未找到版本号来源（package.json 或 VERSION 文件），跳过版本号校验。');
  console.log('   建议在项目根目录创建 package.json 或 VERSION 文件以启用校验。');
} else {
  // 解构出来源名称与版本号字符串
  const { source, version } = verInfo;
  // 版本号不符合 semver 格式：打印错误并标记违规
  if (!SEMVER_RE.test(version)) {
    console.log(`❌ [${source}] 版本号 "${version}" 不符合 semver 格式（X.Y.Z）`);
    exitCode = 1;
  } else {
    // 版本号格式正确：打印通过信息
    console.log(`✅ [${source}] 版本号 ${version} 格式正确`);
    // 组装展示用版本号：设置了通道时追加通道后缀（如 V0.0.0-preview）
    const display = channel ? `V${version}-${channel}` : `V${version}`;
    // 打印展示用版本号
    console.log(`   展示版本号: ${display}`);
  }
}

// ---------- 2. RELEASE_CHANNEL 合法性 ----------
// 通道非空且不在白名单内：打印错误并标记违规
if (channel && !VALID_CHANNELS.has(channel)) {
  console.log(`❌ RELEASE_CHANNEL="${channel}" 非法，仅允许 preview / draft / test`);
  exitCode = 1;
}

// ---------- 3. git tag 校验 ----------
// 判断项目根目录是否位于一个 git 工作区内
function isGitRepo() {
  try {
    // 执行 git rev-parse --is-inside-work-tree，stdout/stderr 全部丢弃，只看是否报错
    execSync('git rev-parse --is-inside-work-tree', {
      cwd: ROOT,
      stdio: 'ignore',
    });
    // 命令成功退出即为 git 仓库
    return true;
  } catch {
    // 命令失败（不是 git 仓库，或未安装 git）
    return false;
  }
}

// 获取当前仓库的全部 git tag 列表
function getGitTags() {
  try {
    // 执行 git tag 拿到全部 tag 文本，按行拆分、去空白、过滤空行后返回数组
    return execSync('git tag', { cwd: ROOT, encoding: 'utf-8' })
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean);
  } catch {
    // 执行失败时返回 null，表示 tag 信息不可用
    return null;
  }
}

// 不是 git 仓库：打印警告并跳过 tag 校验
if (!isGitRepo()) {
  console.log('⚠️  当前目录不是 git 仓库，跳过 tag 校验。');
} else {
  // 读取全部 tag；读取失败时按空数组处理，保证后续 filter 不报错
  const tags = getGitTags() || [];
  // 过滤出符合 V<semver> 形态的正式 tag
  const officialTags = tags.filter((t) => OFFICIAL_TAG_RE.test(t));
  // 过滤出既不是正式形态、也不是 draft-/pre- 前缀的「非规范命名」tag
  const badInternalTags = tags.filter(
    (t) => !OFFICIAL_TAG_RE.test(t) && !INTERNAL_TAG_RE.test(t),
  );

  // 打印空行分隔
  console.log('');
  // 打印现有 tag 总数与完整清单（无 tag 时显示 (none)）
  console.log(`现有 git tags (${tags.length}): ${tags.length ? tags.join(', ') : '(none)'}`);

  // 通道感知：预览/草稿/测试通道下不允许存在正式 tag
  if (VALID_CHANNELS.has(channel)) {
    // 预览通道下仍存在正式 tag：违规
    if (officialTags.length > 0) {
      console.log(
        `❌ 预览通道(${channel})下已存在正式 tag: ${officialTags.join(', ')}`,
      );
      console.log('   预览通道下不得使用 V<semver> 形态的 tag，应使用 draft-* / pre-*');
      exitCode = 1;
    } else {
      // 预览通道下无正式 tag：合规
      console.log(`✅ 预览通道(${channel})下无正式 tag，合规`);
    }
  } else {
    // 正式通道（或未设置通道）：仅提示性列出已有的正式 tag，不算违规
    if (officialTags.length > 0) {
      console.log(`ℹ️  正式 tag: ${officialTags.join(', ')}`);
    }
  }

  // 内部 tag 命名规范检查：存在非规范命名时打印警告（仅警告，不置违规码）
  if (badInternalTags.length > 0) {
    console.log(
      `⚠️  存在非规范命名的内部 tag: ${badInternalTags.join(', ')}（应为 draft-* 或 pre-*）`,
    );
  }
}

// ---------- 4. 结论 ----------
// 打印空行分隔
console.log('');
// 根据累计退出码打印总结论
if (exitCode === 0) {
  console.log('✅ 版本号校验通过');
} else {
  console.log('❌ 版本号校验未通过，请根据上方提示修正');
}

// 以累计的退出码结束进程：0 = 通过，1 = 存在违规
process.exit(exitCode);
