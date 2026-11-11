/**
 * 模块商城「模块 = 真实能力」清单（服务端种子、调用路由与前端工具面板共用同一份定义）。
 *
 * 口径（用户 2026-11-11 指令）：分类导航里的条目要能真正用起来，而不是只有价格与简介。
 * 因此每个可用的二级模块在这里登记一条能力：绑定模块编码（`cat.<一级slug>-<序号>`）、
 * 说明输入输出形态，服务端 `capabilities.ts` 提供同名 handler 真正执行。
 *
 * 未登记的模块属于「规划中」：商城仍展示，但详情面板不给解锁/调用入口，
 * 避免用户为没有实现的条目付费。
 */

/** 输出形态：前端据此决定渲染方式（纯文本 / 结构化 JSON / HTML / 图片 dataURL） */
export type ModuleCapabilityOutputKind = 'text' | 'json' | 'html' | 'image';

/** 单条能力定义：一条能力可绑定多个模块编码（同一实现服务多个导航条目） */
export interface ModuleCapabilitySeed {
  key: string; // 能力标识，与服务端 handler 注册键一一对应（如 json.format）
  name: { 'zh-CN': string; 'en-US': string }; // 能力名称，详情面板区块标题
  hint: { 'zh-CN': string; 'en-US': string }; // 使用提示，说明输入该填什么
  placeholder: { 'zh-CN': string; 'en-US': string }; // 输入框占位文案
  output_kind: ModuleCapabilityOutputKind; // 输出形态
  module_codes: readonly string[]; // 绑定的模块编码清单
}

/** 已实现的能力清单：按「程序开发」组的导航条目绑定，键与 `services/mim-api/src/capabilities.ts` 对齐 */
export const MODULE_CAPABILITIES: readonly ModuleCapabilitySeed[] = [ // 数组顺序即文档展示顺序
  { // JSON 工具：格式化 / 压缩 / 校验
    key: 'json.format', // 能力标识
    name: { 'zh-CN': 'JSON 格式化与校验', 'en-US': 'JSON format & validate' }, // 中文名给中文站用
    hint: { 'zh-CN': '粘贴任意 JSON，按所选模式格式化、压缩或校验合法性', 'en-US': 'Paste any JSON to pretty-print, minify or validate it' }, // 使用提示
    placeholder: { 'zh-CN': '{"name":"Mim","tags":["catalog","tool"]}', 'en-US': '{"name":"Mim","tags":["catalog","tool"]}' }, // 占位示例
    output_kind: 'json', // 输出结构化 JSON
    module_codes: ['cat.dev-28'], // 程序开发 / JSON工具
  }, // JSON 工具结束
  { // 编码转换：Base64 / Base64URL / Hex / URL 编解码
    key: 'text.encode', // 能力标识
    name: { 'zh-CN': '文本编解码', 'en-US': 'Text encode/decode' }, // 能力名
    hint: { 'zh-CN': '选择编码方式与方向，对文本做编码或解码', 'en-US': 'Pick an encoding and direction to encode or decode text' }, // 使用提示
    placeholder: { 'zh-CN': '要编码或解码的文本', 'en-US': 'Text to encode or decode' }, // 占位
    output_kind: 'text', // 输出纯文本
    module_codes: ['cat.dev-04'], // 程序开发 / 常用工具包
  }, // 编码转换结束
  { // 摘要哈希：MD5 / SHA-1 / SHA-256 / SHA-512
    key: 'text.hash', // 能力标识
    name: { 'zh-CN': '摘要与哈希', 'en-US': 'Digest & hash' }, // 能力名
    hint: { 'zh-CN': '输入文本，输出所选算法的十六进制摘要', 'en-US': 'Enter text and get the hex digest of the chosen algorithm' }, // 使用提示
    placeholder: { 'zh-CN': '待计算摘要的文本', 'en-US': 'Text to hash' }, // 占位
    output_kind: 'text', // 输出纯文本
    module_codes: ['cat.dev-03'], // 程序开发 / 安全开发相关
  }, // 摘要哈希结束
  { // Markdown 渲染：Markdown → HTML
    key: 'markdown.render', // 能力标识
    name: { 'zh-CN': 'Markdown 渲染', 'en-US': 'Markdown rendering' }, // 能力名
    hint: { 'zh-CN': '输入 Markdown，输出可直接渲染的 HTML', 'en-US': 'Enter Markdown and get renderable HTML' }, // 使用提示
    placeholder: { 'zh-CN': '# 标题\n\n- 列表项\n- **加粗**', 'en-US': '# Title\n\n- item\n- **bold**' }, // 占位示例
    output_kind: 'html', // 输出 HTML
    module_codes: ['cat.dev-17'], // 程序开发 / Markdown工具包
  }, // Markdown 渲染结束
  { // 二维码生成：文本 → PNG dataURL
    key: 'qrcode.generate', // 能力标识
    name: { 'zh-CN': '二维码生成', 'en-US': 'QR code generator' }, // 能力名
    hint: { 'zh-CN': '输入文本或链接，输出可保存的二维码图片', 'en-US': 'Enter text or a link to get a scannable QR image' }, // 使用提示
    placeholder: { 'zh-CN': 'https://mim.mixm.top', 'en-US': 'https://mim.mixm.top' }, // 占位示例
    output_kind: 'image', // 输出图片
    module_codes: ['cat.dev-06'], // 程序开发 / 条形码/二维码
  }, // 二维码生成结束
  { // Cron 表达式：解析 + 推算未来触发时间
    key: 'cron.describe', // 能力标识
    name: { 'zh-CN': 'Cron 表达式解析', 'en-US': 'Cron expression parser' }, // 能力名
    hint: { 'zh-CN': '输入 5 段或 6 段 cron 表达式，输出未来若干次触发时间', 'en-US': 'Enter a 5/6-field cron expression to list upcoming runs' }, // 使用提示
    placeholder: { 'zh-CN': '0 9 * * 1-5', 'en-US': '0 9 * * 1-5' }, // 占位示例
    output_kind: 'json', // 输出结构化 JSON
    module_codes: ['cat.dev-14'], // 程序开发 / 作业/任务调度
  }, // Cron 解析结束
  { // 中英文分词统计：汉字逐字 + 英文单词，输出词频
    key: 'text.segment', // 能力标识
    name: { 'zh-CN': '中英文分词统计', 'en-US': 'Chinese/English segmentation' }, // 能力名
    hint: { 'zh-CN': '粘贴中英文混排文本，输出汉字数、单词数、唯一词数与词频 Top20', 'en-US': 'Paste mixed text to get CJK/word counts and top-20 frequency' }, // 使用提示
    placeholder: { 'zh-CN': 'Mim 支持中英文分词，把文本切成词元再统计。', 'en-US': 'Mim segments mixed text into tokens.' }, // 占位
    output_kind: 'json', // 结构化输出
    module_codes: ['cat.dev-01'], // 程序开发 / 中英文分词
  }, // 分词统计结束
  { // 银行卡号 Luhn 校验
    key: 'card.luhn', // 能力标识
    name: { 'zh-CN': '卡号 Luhn 校验', 'en-US': 'Card number Luhn check' }, // 能力名
    hint: { 'zh-CN': '输入卡号（可含空格/短横线），输出校验结果、发卡行与掩码卡号', 'en-US': 'Enter a card number to verify Luhn and detect the brand' }, // 使用提示
    placeholder: { 'zh-CN': '4111 1111 1111 1111', 'en-US': '4111 1111 1111 1111' }, // 占位（公开测试卡号）
    output_kind: 'json', // 结构化输出
    module_codes: ['cat.dev-02'], // 程序开发 / 支付开发包
  }, // 卡号校验结束
  { // CSV ↔ JSON 互转
    key: 'csv.json', // 能力标识
    name: { 'zh-CN': 'CSV / JSON 互转', 'en-US': 'CSV ↔ JSON' }, // 能力名
    hint: { 'zh-CN': 'tojson 模式输入 CSV（首行表头）；tocsv 模式输入对象数组 JSON', 'en-US': 'tojson: CSV with header; tocsv: JSON array of objects' }, // 使用提示
    placeholder: { 'zh-CN': 'name,score\nAlice,92\nBob,88', 'en-US': 'name,score\nAlice,92\nBob,88' }, // 占位
    output_kind: 'json', // 默认输出结构化 JSON
    module_codes: ['cat.dev-05'], // 程序开发 / Excel工具包
  }, // CSV 互转结束
  { // Mustache 模板渲染
    key: 'template.render', // 能力标识
    name: { 'zh-CN': 'Mustache 模板渲染', 'en-US': 'Mustache template rendering' }, // 能力名
    hint: { 'zh-CN': '输入 {"template":"Hi {{name}}","data":{"name":"Mim"}}，输出渲染文本', 'en-US': 'Input {"template":"Hi {{name}}","data":{"name":"Mim"}}' }, // 使用提示
    placeholder: { 'zh-CN': '{"template":"Hi {{name}}, {{count}} new items","data":{"name":"Mim","count":3}}', 'en-US': '{"template":"Hi {{name}}, {{count}} new items","data":{"name":"Mim","count":3}}' }, // 占位
    output_kind: 'text', // 纯文本输出
    module_codes: ['cat.dev-07'], // 程序开发 / 模板引擎
  }, // 模板渲染结束
  { // URL 解析
    key: 'url.parse', // 能力标识
    name: { 'zh-CN': 'URL 解析', 'en-US': 'URL parser' }, // 能力名
    hint: { 'zh-CN': '输入完整 URL（含协议），输出协议、主机、路径、查询参数与路径段', 'en-US': 'Enter a full URL to get its parts and query params' }, // 使用提示
    placeholder: { 'zh-CN': 'https://mim.mixm.top/marketplace?tab=dev&q=json', 'en-US': 'https://mim.mixm.top/marketplace?tab=dev&q=json' }, // 占位
    output_kind: 'json', // 结构化输出
    module_codes: ['cat.dev-09'], // 程序开发 / 网络开发包
  }, // URL 解析结束
  { // IPv4 / CIDR 计算
    key: 'ip.cidr', // 能力标识
    name: { 'zh-CN': 'IPv4 / CIDR 计算', 'en-US': 'IPv4 / CIDR calculator' }, // 能力名
    hint: { 'zh-CN': '输入 IPv4 或 CIDR（如 192.168.1.10/24），输出网络地址、广播地址与可用主机范围', 'en-US': 'Enter an IPv4 or CIDR to get network, broadcast and host range' }, // 使用提示
    placeholder: { 'zh-CN': '192.168.1.10/24', 'en-US': '192.168.1.10/24' }, // 占位
    output_kind: 'json', // 结构化输出
    module_codes: ['cat.dev-11'], // 程序开发 / 网络工具
  }, // CIDR 计算结束
  { // SVG 图表
    key: 'chart.svg', // 能力标识
    name: { 'zh-CN': 'SVG 图表生成', 'en-US': 'SVG chart generator' }, // 能力名
    hint: { 'zh-CN': '输入两列 CSV（标签,数值），输出可直接展示的柱状图或折线图', 'en-US': 'CSV with label,value columns produces a bar or line chart' }, // 使用提示
    placeholder: { 'zh-CN': 'month,orders\n1月,120\n2月,180\n3月,240', 'en-US': 'month,orders\nJan,120\nFeb,180\nMar,240' }, // 占位
    output_kind: 'html', // 输出 SVG（按 HTML 渲染）
    module_codes: ['cat.dev-21'], // 程序开发 / 图表组件
  }, // 图表生成结束
  { // 报表表格
    key: 'report.table', // 能力标识
    name: { 'zh-CN': '报表表格生成', 'en-US': 'Report table builder' }, // 能力名
    hint: { 'zh-CN': '输入 CSV，输出 HTML 表格（format=markdown 时输出 Markdown 表格）', 'en-US': 'CSV in, HTML table out; use format=markdown for Markdown' }, // 使用提示
    placeholder: { 'zh-CN': 'module,price\ncomic.workbench,0\nai.dubbing,199', 'en-US': 'module,price\ncomic.workbench,0\nai.dubbing,199' }, // 占位
    output_kind: 'html', // HTML 表格
    module_codes: ['cat.dev-23'], // 程序开发 / 报表工具
  }, // 报表工具结束
  { // dataURL / Base64 互转
    key: 'image.dataurl', // 能力标识
    name: { 'zh-CN': '图片 dataURL 互转', 'en-US': 'Image dataURL converter' }, // 能力名
    hint: { 'zh-CN': '输入 dataURL 得到 MIME 与字节数；输入 Base64 得到 dataURL', 'en-US': 'dataURL → MIME/bytes; Base64 → dataURL' }, // 使用提示
    placeholder: { 'zh-CN': 'data:image/png;base64,iVBORw0KGgo=', 'en-US': 'data:image/png;base64,iVBORw0KGgo=' }, // 占位
    output_kind: 'json', // 结构化输出
    module_codes: ['cat.dev-26'], // 程序开发 / 图像处理
  }, // dataURL 互转结束
  { // 日志分析
    key: 'log.stats', // 能力标识
    name: { 'zh-CN': '日志级别分析', 'en-US': 'Log level analysis' }, // 能力名
    hint: { 'zh-CN': '粘贴应用日志，输出各级别计数、错误率、首末时间与高频消息 Top10', 'en-US': 'Paste logs to get level counts, error rate and top messages' }, // 使用提示
    placeholder: { 'zh-CN': '2026-11-11T09:00:00Z INFO start\n2026-11-11T09:00:05Z ERROR db timeout', 'en-US': '2026-11-11T09:00:00Z INFO start\n2026-11-11T09:00:05Z ERROR db timeout' }, // 占位
    output_kind: 'json', // 结构化输出
    module_codes: ['cat.dev-29'], // 程序开发 / 日志工具包
  }, // 日志分析结束
  { // SVG 验证码
    key: 'captcha.svg', // 能力标识
    name: { 'zh-CN': 'SVG 验证码生成', 'en-US': 'SVG CAPTCHA generator' }, // 能力名
    hint: { 'zh-CN': '直接调用生成 4 位字符验证码图片（length 可选 4–8），答案随 meta 返回', 'en-US': 'Generate a 4-8 char CAPTCHA image; answer returned in meta' }, // 使用提示
    placeholder: { 'zh-CN': '（无需输入，直接执行）', 'en-US': '(no input needed)' }, // 占位
    output_kind: 'image', // 图片
    module_codes: ['cat.dev-31'], // 程序开发 / 验证码
  }, // 验证码结束
  { // 数学表达式求值
    key: 'math.eval', // 能力标识
    name: { 'zh-CN': '数学表达式求值', 'en-US': 'Math expression evaluator' }, // 能力名
    hint: { 'zh-CN': '输入纯算术表达式（支持 sqrt、sin、log 等函数），不允许赋值或语句', 'en-US': 'Pure arithmetic expressions with sqrt/sin/log etc.' }, // 使用提示
    placeholder: { 'zh-CN': '(12+8)*3 / sqrt(16)', 'en-US': '(12+8)*3 / sqrt(16)' }, // 占位
    output_kind: 'json', // 结构化输出
    module_codes: ['cat.dev-32'], // 程序开发 / 算法/数学计算
  }, // 数学求值结束
  { // JSON → JSON Schema
    key: 'json.schema', // 能力标识
    name: { 'zh-CN': 'JSON 推导 Schema', 'en-US': 'JSON to JSON Schema' }, // 能力名
    hint: { 'zh-CN': '粘贴一份 JSON 样例，输出 draft-2020-12 JSON Schema（低代码表单起点）', 'en-US': 'Paste a JSON sample to get a draft-2020-12 schema' }, // 使用提示
    placeholder: { 'zh-CN': '{"title":"Mim","count":3,"tags":["a"]}', 'en-US': '{"title":"Mim","count":3,"tags":["a"]}' }, // 占位
    output_kind: 'json', // 结构化输出
    module_codes: ['cat.frontier-01'], // 前沿技术 / 低代码
  }, // Schema 推导结束
  { // 参考文献格式化
    key: 'cite.format', // 能力标识
    name: { 'zh-CN': '参考文献格式化', 'en-US': 'Citation formatter' }, // 能力名
    hint: { 'zh-CN': '输入 {authors,title,year,type,journal/publisher,...}，输出 GB/T 7714 条目', 'en-US': 'Input citation fields to get a GB/T 7714 entry' }, // 使用提示
    placeholder: { 'zh-CN': '{"authors":["张三","李四"],"title":"跨平台办公系统设计","year":"2026","type":"journal","journal":"软件学报","volume":"37","issue":"4","pages":"1-12"}', 'en-US': '{"authors":["Zhang San"],"title":"Cross-platform design","year":"2026","type":"journal","journal":"Journal of Software","volume":"37","issue":"4","pages":"1-12"}' }, // 占位
    output_kind: 'text', // 纯文本
    module_codes: ['cat.frontier-02'], // 前沿技术 / 科研论文
  }, // 参考文献结束
  { // YAML ↔ JSON
    key: 'yaml.json', // 能力标识
    name: { 'zh-CN': 'YAML / JSON 互转', 'en-US': 'YAML ↔ JSON' }, // 能力名
    hint: { 'zh-CN': 'yaml2json 模式输入 YAML；json2yaml 模式输入 JSON', 'en-US': 'yaml2json: YAML in; json2yaml: JSON in' }, // 使用提示
    placeholder: { 'zh-CN': 'apiVersion: v1\nkind: Service\nmetadata:\n  name: mim-api', 'en-US': 'apiVersion: v1\nkind: Service\nmetadata:\n  name: mim-api' }, // 占位
    output_kind: 'json', // 默认 JSON 输出
    module_codes: ['cat.frontier-05'], // 前沿技术 / 云原生
  }, // YAML 互转结束
  { // JWT 解析
    key: 'jwt.decode', // 能力标识
    name: { 'zh-CN': 'JWT 解析（不验签）', 'en-US': 'JWT decoder (no verify)' }, // 能力名
    hint: { 'zh-CN': '粘贴 JWT，输出 header / payload / 过期状态；仅解析，不做签名验证', 'en-US': 'Paste a JWT to decode header/payload; signature is not verified' }, // 使用提示
    placeholder: { 'zh-CN': 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJtaW0ifQ.signature', 'en-US': 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJtaW0ifQ.signature' }, // 占位
    output_kind: 'json', // 结构化输出
    module_codes: ['cat.web-10'], // WEB应用开发 / OAuth/单点登录/统一认证
  }, // JWT 解析结束
  { // 文本差异
    key: 'diff.text', // 能力标识
    name: { 'zh-CN': '文本差异对比', 'en-US': 'Text diff' }, // 能力名
    hint: { 'zh-CN': '输入 {"a":"旧文本","b":"新文本"}，输出统一 diff 与增删行数', 'en-US': 'Input {"a":"old","b":"new"} to get a unified diff' }, // 使用提示
    placeholder: { 'zh-CN': '{"a":"line1\\nline2","b":"line1\\nline3"}', 'en-US': '{"a":"line1\\nline2","b":"line1\\nline3"}' }, // 占位
    output_kind: 'text', // diff 文本
    module_codes: ['cat.devtools-02'], // 开发工具 / 开发调试
  }, // 文本差异结束
  { // 代码行统计
    key: 'code.stats', // 能力标识
    name: { 'zh-CN': '代码行统计', 'en-US': 'Code line stats' }, // 能力名
    hint: { 'zh-CN': '粘贴源码，按 lang（ts/js/py/sh/sql/html）统计代码行、注释行、空行与注释率', 'en-US': 'Paste source code to count code/comment/blank lines' }, // 使用提示
    placeholder: { 'zh-CN': '// 注释\nconst a = 1;\n\nconsole.log(a);', 'en-US': '// comment\nconst a = 1;\n\nconsole.log(a);' }, // 占位
    output_kind: 'json', // 结构化输出
    module_codes: ['cat.devtools-08'], // 开发工具 / 代码扫描分析
  }, // 代码统计结束
  { // SQL 格式化
    key: 'sql.format', // 能力标识
    name: { 'zh-CN': 'SQL 格式化', 'en-US': 'SQL formatter' }, // 能力名
    hint: { 'zh-CN': '粘贴 SQL，按方言（sql/mysql/postgresql/sqlite/tsql）重排关键字与缩进', 'en-US': 'Paste SQL and reformat it for the chosen dialect' }, // 使用提示
    placeholder: { 'zh-CN': 'select id,name from modules where status=1 order by id desc', 'en-US': 'select id,name from modules where status=1 order by id desc' }, // 占位
    output_kind: 'text', // 格式化文本
    module_codes: ['cat.database-01'], // 数据库相关 / 数据库开发包
  }, // SQL 格式化结束
  { // 文本统计
    key: 'text.stats', // 能力标识
    name: { 'zh-CN': '文本统计', 'en-US': 'Text statistics' }, // 能力名
    hint: { 'zh-CN': '粘贴文本，输出字符/汉字/字母/数字/行/段落数与高频词 Top10', 'en-US': 'Paste text to get character, line, paragraph counts and top words' }, // 使用提示
    placeholder: { 'zh-CN': 'Mim 是跨平台商业级项目。\n第二段文本。', 'en-US': 'Mim is a cross-platform project.' }, // 占位
    output_kind: 'json', // 结构化输出
    module_codes: ['cat.tools-03'], // 应用工具 / 文本编辑
  }, // 文本统计结束
  { // 批量重命名预览
    key: 'file.rename', // 能力标识
    name: { 'zh-CN': '批量重命名预览', 'en-US': 'Batch rename preview' }, // 能力名
    hint: { 'zh-CN': '输入 {"files":["a.txt"],"pattern":"{n}-{name}{ext}"}，返回改名映射（不会动磁盘）', 'en-US': 'Input file list and pattern to preview new names (dry run)' }, // 使用提示
    placeholder: { 'zh-CN': '{"files":["report.txt","photo.png"],"pattern":"{n}-{name}{ext}"}', 'en-US': '{"files":["report.txt","photo.png"],"pattern":"{n}-{name}{ext}"}' }, // 占位
    output_kind: 'json', // 映射结构
    module_codes: ['cat.tools-01'], // 应用工具 / 文件管理工具
  }, // 批量重命名结束
]; // 能力清单结束

/** 按能力键取定义：前端工具面板与服务端路由都用它做存在性判断 */
export function capabilityOfKey(key: string): ModuleCapabilitySeed | undefined {
  return MODULE_CAPABILITIES.find((item) => item.key === key); // 线性查找即可，清单规模是个位数
} // capabilityOfKey 结束

/** 按模块编码取能力：模块没有登记能力即视为「规划中」 */
export function capabilityOfModule(code: string): ModuleCapabilitySeed | undefined {
  return MODULE_CAPABILITIES.find((item) => item.module_codes.includes(code)); // 编码在核心域唯一，命中第一条即可
} // capabilityOfModule 结束
