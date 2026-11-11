/**
 * 「模块起盘蓝图」数据类型：把 205 条商城模块里无法做成通用工具的条目，
 * 落成一份可直接开工的交付定义（目标 / 技术栈 / 起步代码 / 目录 / 验收）。
 *
 * 与 `moduleCapabilities.ts` 的关系：能力清单负责「哪些模块可调用、绑定哪个 handler」，
 * 本目录负责「调用后产出什么」。二者都用模块编码作为唯一连接键。
 */

/** 单条模块蓝图：四字段刻意保持精简，便于逐条维护而不产生大片重复描述 */
export interface ModuleBlueprint {
  code: string; // 模块编码，形如 cat.open-01，与分类树一一对应
  summary: string; // 该条目交付什么（一句话，中文，含关键行为）
  stack: string; // 推荐技术栈 / 关键依赖，便于判断环境是否齐备
  starter: string; // 起步代码或配置：可直接粘贴运行的最小可用片段
} // ModuleBlueprint 结束

/**
 * 造一条蓝图：把四字段对象压成单行调用，205 条数据共用一个构造函数，
 * 既避免每条重复写 `{ code: ..., summary: ... }` 的样板，也方便后续批量补齐。
 */
export function B(code: string, summary: string, stack: string, starter: string): ModuleBlueprint {
  return { code, summary, stack, starter }; // 直接返回四字段对象
} // B 结束

/** 一级分组的输出模板：同一组内所有模块共用「交付物 / 验收 / 目录根 / 文件后缀」四项口径 */
export interface BlueprintGroupMeta {
  slug: string; // 一级分类 slug，与 CATALOG_GROUPS 对齐
  capability: string; // 该组绑定的能力键，须与服务端 handler 注册键一致
  nameZh: string; // 能力名称中文，详情面板区块标题
  nameEn: string; // 能力名称英文
  hintZh: string; // 使用提示中文
  hintEn: string; // 使用提示英文
  placeholderZh: string; // 输入占位中文，提示用户填项目名/需求补充
  placeholderEn: string; // 输入占位英文
  rootDir: string; // 建议目录根，生成目录树时使用
  ext: string; // 起步文件扩展名（ets/ts/py/c/md/sql/yml 等）
  deliverablesZh: string[]; // 交付物清单（该组统一的 3 条）
  deliverablesEn: string[]; // 交付物英文清单
  checksZh: string[]; // 验收清单（该组统一的 3–4 条）
  checksEn: string[]; // 验收清单英文
} // BlueprintGroupMeta 结束
