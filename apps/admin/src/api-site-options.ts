// 管理端站点选项 API：读取注册表 schema + 当前取值、局部保存、恢复默认。
// 与后端 routes/site-options.ts 一一对应，权限口径统一走 appearance:write。

import type { Credential } from './api'; // 凭证类型
import { request } from './api'; // 统一请求层（含凭证注入与错误信封解析）

/** 字段类型：与后端注册表同名，后台据此选择控件 */
export type OptionFieldType = 'switch' | 'text' | 'textarea' | 'number' | 'select' | 'url';

/** 选项取值：统一为标量 */
export type OptionValue = string | number | boolean;
/** 选项映射：字段键 → 取值 */
export type OptionValues = Record<string, OptionValue>;

/** 单字段定义（后端 schema 原样回传） */
export interface OptionField {
  key: string; // 字段键
  label: string; // 展示名
  type: OptionFieldType; // 控件类型
  defaultValue: OptionValue; // 默认值
  hint?: string; // 说明
  options?: Array<{ value: string; label: string }>; // 下拉候选项
  min?: number; // 数值下界
  max?: number; // 数值上界
  publicRead?: boolean; // 是否免登录可读
  secretPlaceholder?: boolean; // 密钥类字段：库里只存环境变量名
} // OptionField 结束

/** 分组定义 */
export interface OptionGroup {
  key: string; // 分组键
  label: string; // 分组名
  description?: string; // 分组说明
  fields: OptionField[]; // 字段清单
} // OptionGroup 结束

/** 页签定义 */
export interface OptionTab {
  key: string; // 页签键
  label: string; // 页签名
  groups: OptionGroup[]; // 分组清单
} // OptionTab 结束

/** 读取返回：schema + 当前值 + 最后保存时间 */
export interface SiteOptionsPayload {
  tabs: OptionTab[]; // 页签结构
  defaults: OptionValues; // 默认值集合
  public_keys: string[]; // 免登录可读的键
  values: OptionValues; // 当前取值（已合并默认）
  updated_at: string | null; // 最后保存时间，null 表示从未保存
} // SiteOptionsPayload 结束

/** 保存 / 重置返回：完整取值 + 本次改动键 + 保存时间 */
export interface SiteOptionsResult {
  values: OptionValues; // 合并后的完整取值
  changed: string[]; // 本次真正变化的键
  updated_at: string | null; // 保存时间
} // SiteOptionsResult 结束

/** 读取站点选项：GET /admin/site-options */
export function getSiteOptions(credential: Credential): Promise<SiteOptionsPayload> {
  return request<SiteOptionsPayload>('/admin/site-options', { credential }); // 仅读，无请求体
} // getSiteOptions 结束

/** 局部保存：只提交改动过的键，后端按注册表清洗后合并 */
export function saveSiteOptions(credential: Credential, values: Record<string, OptionValue>): Promise<SiteOptionsResult> {
  return request<SiteOptionsResult>('/admin/site-options', { method: 'PUT', body: { values }, credential }); // PUT 局部写入
} // saveSiteOptions 结束

/** 恢复默认：keys 缺省为整体恢复；给出时只重置这些键 */
export function resetSiteOptions(credential: Credential, keys?: string[]): Promise<SiteOptionsResult> {
  return request<SiteOptionsResult>('/admin/site-options/reset', { method: 'POST', body: keys && keys.length > 0 ? { keys } : {}, credential }); // POST 重置
} // resetSiteOptions 结束

/** 差异计算：返回 a 相对 baseline 变化的键值，供「只提交改动」使用 */
export function diffOptions(baseline: OptionValues, current: OptionValues): Record<string, OptionValue> {
  const patch: Record<string, OptionValue> = {}; // 改动容器
  for (const key of Object.keys(current)) { // 逐键比较
    if (baseline[key] !== current[key]) patch[key] = current[key]; // 值变化才纳入补丁
  }
  return patch; // 返回补丁
} // diffOptions 结束

/** 图片上传返回：可直接写入 url 字段的站内地址 */
export interface SiteImageUpload {
  url: string; // 形如 /api/v1/site/assets/<uuid>.png
  size: number; // 字节数
  mime: string; // 服务端识别出的 MIME
} // SiteImageUpload 结束

/** 上传站点图片：把浏览器读出的 data URL 交给后端落盘，返回公开地址 */
export function uploadSiteImage(credential: Credential, dataUrl: string): Promise<SiteImageUpload> {
  return request<SiteImageUpload>('/admin/site-options/upload', { method: 'POST', body: { data_url: dataUrl }, credential }); // 复用统一请求层
} // uploadSiteImage 结束
