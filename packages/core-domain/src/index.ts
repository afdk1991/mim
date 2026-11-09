/**
 * core-domain 包的公开入口（barrel 聚合文件）。
 * 上层 apps / services 统一从 @mim/core-domain 导入，不直接引用包内具体文件路径，
 * 这样后续在包内拆分或挪动实现文件时，调用方代码无需改动。
 */
// 聚合导出统一错误码、AppError 类与状态码映射：业务层只抛 AppError，由 HTTP 层翻译成响应信封
export * from './errors.js';
// 聚合导出 UUIDv7 主键生成函数：时间有序，便于数据库顺序写入与按时间分页
export * from './ids.js';
// 聚合导出统一入口配置清单：45 个去重入口 / 19 个业务域 / 职责边界 / 关联区分 / 可配置占位标识 / 功能点状态机，前后端共用同一数据源
export * from './siteModules.js';
// 聚合导出部署汇总注册表：统一字段的部署仓库 / 部署项 / 状态 / 结果 / 异常 / 汇总统计，前后端共用同一数据源
export * from './deploymentRegistry.js';
