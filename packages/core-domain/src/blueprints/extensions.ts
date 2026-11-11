/** 插件和扩展（8）+ 其他开源（10）+ 前沿技术（2）+ 区块链（2）+ 微信开发（4）共 26 条未绑定条目的起盘蓝图。 */
import { B, type ModuleBlueprint } from './types.js'; // 蓝图构造函数与类型

export const EXTENSION_BLUEPRINTS: readonly ModuleBlueprint[] = [ // 数组顺序：plugin → misc → frontier → blockchain → wechat
  // plugin-01 Chrome扩展：Manifest V3
  B('cat.plugin-01', 'Chrome 扩展：Manifest V3 声明（弹窗、后台 Service Worker、最小权限）。', 'JavaScript / Chrome MV3', "{\n  \"manifest_version\": 3, \"name\": \"Mim 助手\", \"version\": \"0.0.1\",\n  \"action\": { \"default_popup\": \"popup.html\" },\n  \"background\": { \"service_worker\": \"background.js\" },\n  \"permissions\": [\"storage\", \"activeTab\"]\n}"),
  // plugin-02 WordPress 扩展：插件头与钩子
  B('cat.plugin-02', 'WordPress 扩展：插件头注释 + the_content 钩子插入模块卡片。', 'PHP / WordPress', "<?php\n/**\n * Plugin Name: Mim Module Widget\n * Version: 0.0.1\n * Description: 在文章页展示 Mim 模块卡片\n */\nadd_action('the_content', function ($content) { return $content . '<div class=\"mim-card\">Mim</div>'; });"),
  // plugin-03 Eclipse插件：视图扩展点
  B('cat.plugin-03', 'Eclipse 插件：plugin.xml 视图扩展点声明与对应 View 类。', 'Java / Eclipse', "<plugin>\n  <extension point=\"org.eclipse.ui.views\">\n    <view id=\"com.mim.view\" name=\"Mim\" class=\"com.mim.MimView\"/>\n  </extension>\n</plugin>"),
  // plugin-04 IDEA 插件：toolWindow 扩展
  B('cat.plugin-04', 'IDEA 插件：plugin.xml 声明 id/依赖与 toolWindow 工厂类。', 'Kotlin / IntelliJ', "<idea-plugin>\n  <id>com.mim.plugin</id>\n  <name>Mim Toolkit</name>\n  <depends>com.intellij.modules.platform</depends>\n  <extensions defaultExtensionNs=\"com.intellij\"><toolWindow id=\"Mim\" factoryClass=\"com.mim.MimToolWindowFactory\"/></extensions>\n</idea-plugin>"),
  // plugin-05 Firefox扩展：MV2 声明
  B('cat.plugin-05', 'Firefox 扩展：Manifest V2 声明（browser_action 弹窗 + 最小权限）。', 'JavaScript / Firefox', "{ \"manifest_version\": 2, \"name\": \"Mim Helper\", \"version\": \"0.0.1\", \"permissions\": [\"storage\", \"activeTab\"], \"browser_action\": { \"default_popup\": \"popup.html\" } }"),
  // plugin-06 Safari 插件：Safari Web Extension
  B('cat.plugin-06', 'Safari 插件：Safari Web Extension 清单与内容脚本注入范围。', 'JavaScript / Xcode', "{ \"manifest_version\": 3, \"name\": \"Mim for Safari\", \"version\": \"0.0.1\", \"content_scripts\": [{ \"matches\": [\"https://*/*\"], \"js\": [\"content.js\"] }] }\n// Xcode：File → New → Target → Safari Web Extension 生成壳工程"),
  // plugin-07 VS Code 扩展：命令贡献点
  B('cat.plugin-07', 'VS Code 扩展：package.json 命令贡献点与 activate 注册。', 'TypeScript / VS Code', "{ \"name\": \"mim-tools\", \"engines\": { \"vscode\": \"^1.90.0\" }, \"contributes\": { \"commands\": [{ \"command\": \"mim.openModule\", \"title\": \"Mim: 打开模块\" }] } }\n// activate(context) 里 context.subscriptions.push(vscode.commands.registerCommand('mim.openModule', () => {}))"),
  // plugin-08 Jenkins 插件：流水线
  B('cat.plugin-08', 'Jenkins 插件：声明式流水线（门禁、测试、部署三段）。', 'Groovy / Jenkins', "pipeline {\n  agent any\n  stages {\n    stage('gate') { steps { sh 'pnpm i --frozen-lockfile && pnpm -r typecheck' } }\n    stage('test') { steps { sh 'pnpm --filter @mim/api test' } }\n    stage('deploy') { steps { sh './deploy/remote.sh' } }\n  }\n}"),
  // misc-01 高仿项目：复刻拆解清单
  B('cat.misc-01', '高仿项目：复刻拆解四步法（功能盘点、接口还原、自建后端、差异化改进）。', '项目拆解', "# 复刻拆解：目标项目 → 功能域 → 页面/接口 → 排期\n- [ ] 抓取站点地图与公开接口（遵守 robots 与速率限制）\n- [ ] 列举 20 个核心页面，标注交互与数据依赖\n- [ ] 自建后端替代第三方接口，屏蔽他人商标与素材\n- [ ] 差异化：至少 3 个功能或体验改进点"),
  // misc-02 图书/手册/教程：章节模板
  B('cat.misc-02', '图书/手册/教程：技术书目录骨架与每章「目标-步骤-验证-常见坑」模板。', 'Markdown', "# 《Mim 全栈手册》目录\n01 架构总览 / 02 环境与工具链 / 03 数据模型 / 04 API 契约\n05 前端工程 / 06 部署与运维 / 07 故障排查\n# 每章模板：目标 → 前置 → 步骤（可复制命令）→ 验证 → 常见坑"),
  // misc-03 ACM/OJ 项目：评测沙箱
  B('cat.misc-03', 'ACM/OJ 项目：判题五步闭环（编译、沙箱、限时、比对、回写）与 nsjail 命令。', 'C++ / nsjail', "# 评测机闭环：接收提交 → 编译 → 沙箱运行 → 比对输出 → 回写结果\nnsjail --config judge.cfg -- /usr/bin/g++ main.cpp -O2 -o main\n./main < input.txt > out.txt && diff -q out.txt answer.txt && echo AC || echo WA"),
  // misc-04 操作系统：内核最小骨架
  B('cat.misc-04', '操作系统：RISC-V 裸机内核骨架（启动入口、链接脚本与 QEMU 运行命令）。', 'C / RISC-V', "// kernel/start.c\nvoid start() { printf(\"Mim kernel boot\\n\"); while (1) {} }\n// 构建：riscv64-unknown-elf-gcc -march=rv64gc -nostdlib -T kernel.ld start.c -o kernel.elf\n// 运行：qemu-system-riscv64 -machine virt -kernel kernel.elf -nographic"),
  // misc-05 教学管理：作业与提交
  B('cat.misc-05', '教学管理：作业、提交与评分三表结构（含截止时间与最晚批改）。', 'SQL / 教务', "CREATE TABLE assignments (id TEXT PRIMARY KEY, course_id TEXT, title TEXT, due_at TEXT, max_score REAL);\nCREATE TABLE submissions (id TEXT PRIMARY KEY, assignment_id TEXT, student_id TEXT, score REAL, graded_at TEXT);"),
  // misc-06 教程配套代码：仓库结构约定
  B('cat.misc-06', '教程配套代码：与正文一一对应的目录结构与 README 四要素约定。', 'Markdown / 工程约定', "code/\n  01-basics/   # 每节一个可运行最小示例 + README\n  02-api/      # 与正文一一对应的接口示例\n  shared/      # 公共工具\n# 约定：每章 README 顶部写「本节目标 / 运行命令 / 预期输出」"),
  // misc-07 RISC-V 开发：汇编与链接脚本
  B('cat.misc-07', 'RISC-V 开发：最小汇编程序（系统调用 exit）与链接脚本基址。', 'RISC-V / 汇编', ".section .text\n.globl _start\n_start: li a0, 0; li a7, 93; ecall  # exit(0)\n# text.ld: SECTIONS { . = 0x80000000; .text : { *(.text) } }"),
  // misc-08 生物/医疗/健康：FHIR 观测
  B('cat.misc-08', '生物/医疗/健康：FHIR Observation 资源（心率 LOINC 编码）+ 去标识化要求。', 'FHIR / JSON', "{ \"resourceType\": \"Observation\", \"status\": \"final\", \"code\": { \"coding\": [{ \"system\": \"http://loinc.org\", \"code\": \"8867-4\" }] }, \"valueQuantity\": { \"value\": 72, \"unit\": \"/min\" } }\n// 合规：姓名/证件号哈希去标识化，只上报最小必要字段"),
  // misc-09 2020公益黑客马拉松：项目书
  B('cat.misc-09', '2020 公益黑客马拉松：48 小时赛题项目书（命题、交付、评审维度与权重）。', '项目书 / Markdown', "# 公益黑客马拉松项目书\n命题：社区助老数字化\n交付：48h 可演示原型 + 10 页方案 + 数据合规说明\n评审维度：社会价值 40% / 可行性 30% / 完成度 30%"),
  // misc-10 新冠病毒相关开源：数据管道
  B('cat.misc-10', '新冠病毒相关开源：公开报表 ETL 管道与指标口径标注要求。', 'Python / ETL', "# 数据管道：原始报表 → 清洗 → 指标聚合 → 可视化\npython etl.py --src who.csv --out data/cases.parquet\n# 指标：新增确诊 / 7 日均值 / 阳性率；口径与更新时间必须随图标注"),
  // frontier-03 量子计算：Qiskit 贝尔态
  B('cat.frontier-03', '量子计算：Qiskit 贝尔态电路（H + CNOT + 测量）与模拟器采样。', 'Python / Qiskit', "from qiskit import QuantumCircuit\nqc = QuantumCircuit(2, 2)\nqc.h(0); qc.cx(0, 1); qc.measure([0, 1], [0, 1])\nfrom qiskit_aer import AerSimulator\nprint(AerSimulator().run(qc, shots=1024).result().get_counts())"),
  // frontier-04 Web 3.0：钱包连接与合约读取
  B('cat.frontier-04', 'Web 3.0：钱包连接 + ERC-20 合约只读调用（ethers v6）。', 'TypeScript / ethers', "import { BrowserProvider, Contract } from 'ethers'\nconst provider = new BrowserProvider(window.ethereum)\nawait provider.send('eth_requestAccounts', [])\nconst token = new Contract('0xToken', ['function balanceOf(address) view returns (uint256)'], provider)\nconsole.log(await token.balanceOf((await provider.getSigner()).address))"),
  // blockchain-01 数字货币：ERC-20
  B('cat.blockchain-01', '数字货币：ERC-20 最小代币合约（余额映射 + transfer 校验）。', 'Solidity 0.8', "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\ncontract MimToken { mapping(address => uint256) public balanceOf; uint256 public totalSupply;\n  constructor(uint256 supply) { balanceOf[msg.sender] = totalSupply = supply; }\n  function transfer(address to, uint256 amount) external returns (bool) { require(balanceOf[msg.sender] >= amount); balanceOf[msg.sender] -= amount; balanceOf[to] += amount; return true; }\n}"),
  // blockchain-02 NFT：元数据与合约
  B('cat.blockchain-02', 'NFT：ERC-721 元数据 JSON（属性 traits）+ OpenZeppelin 合约接入。', 'Solidity / ERC-721', "{ \"name\": \"Mim Module #001\", \"description\": \"商城模块权益凭证\", \"image\": \"ipfs://bafy.../001.png\", \"attributes\": [{ \"trait_type\": \"group\", \"value\": \"程序开发\" }, { \"trait_type\": \"rarity\", \"value\": \"rare\" }] }\n// 合约：import '@openzeppelin/contracts/token/ERC721/ERC721.sol'"),
  // wechat-01 微信开发包：JS-SDK 签名
  B('cat.wechat-01', '微信开发包：JS-SDK 服务端签名串 + 前端 wx.config 接入。', 'JavaScript / 微信 JS-SDK', "// 服务端签名：sha1('jsapi_ticket=...&noncestr=...&timestamp=...&url=...')\n// 前端\n// wx.config({ appId, timestamp, nonceStr, signature, jsApiList: ['chooseImage', 'scanQRCode'] })"),
  // wechat-02 微信小程序/小游戏：app.json
  B('cat.wechat-02', '微信小程序/小游戏：app.json 页面与窗口配置 + 首页请求示例。', 'JavaScript / 微信小程序', "{ \"pages\": [\"pages/index/index\"], \"window\": { \"navigationBarTitleText\": \"Mim\", \"navigationBarBackgroundColor\": \"#2f6feb\" }, \"sitemapLocation\": \"sitemap.json\" }\n// pages/index/index.js: Page({ data: { items: [] }, onLoad() { wx.request({ url: 'https://mim.mixm.top/api/v1/modules' }) } })"),
  // wechat-03 微信应用：公众号消息回复
  B('cat.wechat-03', '微信应用：公众号服务器校验与被动回复 XML 消息组装。', 'PHP / 微信公众号', "// GET 校验 signature/timestamp/nonce/echostr；POST 解析 XML 后被动回复\nfunction reply($to, $from, $content) { return \"<xml><ToUserName>$from</ToUserName><FromUserName>$to</FromUserName><Content>$content</Content></xml>\"; }"),
  // wechat-04 微信小游戏：game.js 画布循环
  B('cat.wechat-04', '微信小游戏：game.js 创建画布并驱动 requestAnimationFrame 渲染循环。', 'JavaScript / 微信小游戏', "const canvas = wx.createCanvas()\nconst ctx = canvas.getContext('2d')\nrequestAnimationFrame(function loop() { ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.fillText('Mim Game', 40, 80); requestAnimationFrame(loop) })"),
]; // 扩展/其他/前沿/区块链/微信蓝图结束：26 条
