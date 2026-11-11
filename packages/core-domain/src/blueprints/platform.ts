/** 手机/移动开发（10）+ 开发工具（6）+ DevOps（3）三组共 19 条未绑定条目的起盘蓝图。 */
import { B, type ModuleBlueprint } from './types.js'; // 蓝图构造函数与类型

export const PLATFORM_BLUEPRINTS: readonly ModuleBlueprint[] = [ // 数组顺序：mobile → devtools → devops
  // mobile-01 Android组件：Compose 卡片
  B('cat.mobile-01', 'Android 组件：Jetpack Compose 可点击卡片组件（Material3 排版）。', 'Kotlin / Compose', "@Composable\nfun MimCard(title: String, onClick: () -> Unit) {\n    Card(onClick = onClick, modifier = Modifier.fillMaxWidth()) {\n        Text(title, modifier = Modifier.padding(16.dp), style = MaterialTheme.typography.titleMedium)\n    }\n}"),
  // mobile-02 iOS组件：SwiftUI 卡片
  B('cat.mobile-02', 'iOS 组件：SwiftUI 卡片视图（自适应宽度、圆角与系统背景色）。', 'Swift / SwiftUI', "struct MimCard: View {\n    let title: String\n    var body: some View {\n        Text(title).padding(16).frame(maxWidth: .infinity, alignment: .leading)\n            .background(Color(.secondarySystemBackground)).clipShape(RoundedRectangle(cornerRadius: 12))\n    }\n}"),
  // mobile-03 移动App：React Native 路由骨架
  B('cat.mobile-03', '移动 App：React Native 导航骨架（NavigationContainer + 原生栈）。', 'TypeScript / React Native', "import { NavigationContainer } from '@react-navigation/native'\nimport { createNativeStackNavigator } from '@react-navigation/native-stack'\nconst Stack = createNativeStackNavigator()\nexport default function App() { return (<NavigationContainer><Stack.Navigator><Stack.Screen name='Home' component={Home} /></Stack.Navigator></NavigationContainer>) }"),
  // mobile-04 支付宝小程序：页面请求
  B('cat.mobile-04', '支付宝小程序：app.json 页面声明 + my.request 拉取模块列表。', 'JavaScript / 支付宝小程序', "// app.json\n{ \"pages\": [\"pages/index/index\"], \"window\": { \"defaultTitle\": \"Mim\" } }\n// pages/index/index.js\nPage({ onLoad() { my.request({ url: 'https://mim.mixm.top/api/v1/modules', success: (res) => this.setData({ items: res.data }) }) } })"),
  // mobile-05 百度小程序：swan 请求
  B('cat.mobile-05', '百度小程序：app.json 声明与 swan.request 拉取数据的等价写法。', 'JavaScript / 百度小程序', "// app.json\n{ \"pages\": [\"pages/index/index\"] }\n// swan.request 与支付宝/微信差异点：错误回调在 fail，不在 complete\nswan.request({ url: 'https://mim.mixm.top/api/v1/modules', success: (res) => console.log(res.data), fail: (err) => console.error(err) })"),
  // mobile-06 PhoneGap/Cordova 插件：plugin.xml
  B('cat.mobile-06', 'PhoneGap/Cordova 插件：plugin.xml 声明 JS 模块与 Android 原生源码目录。', 'Cordova / XML', "<plugin xmlns=\"http://apache.org/cordova/ns/plugins/1.0\" id=\"mim-device-info\" version=\"0.0.1\">\n  <js-module src=\"www/device.js\" name=\"device\"><clobbers target=\"mim.device\" /></js-module>\n  <platform name=\"android\"><source-file src=\"src/android/DeviceInfo.java\" target-dir=\"src/com/mim/\" /></platform>\n</plugin>"),
  // mobile-07 跨平台移动开发：Flutter 卡片
  B('cat.mobile-07', '跨平台移动开发：Flutter 卡片组件（Card + ListTile + 尾部箭头）。', 'Dart / Flutter', "import 'package:flutter/material.dart';\nclass MimCard extends StatelessWidget {\n  const MimCard({super.key, required this.title}); final String title;\n  @override Widget build(BuildContext context) => Card(child: ListTile(title: Text(title), trailing: const Icon(Icons.chevron_right)));\n}"),
  // mobile-08 快应用：manifest 与页面
  B('cat.mobile-08', '快应用：manifest.json 入口声明与 index.ux 页面骨架。', '快应用 / ux', "// manifest.json\n{ \"package\": \"com.mim.quickapp\", \"name\": \"Mim\", \"versionName\": \"0.0.1\", \"router\": { \"entry\": \"pages/index\" } }\n// pages/index/index.ux\n// <template><text>Mim</text></template><script>export default { data: {} }</script>"),
  // mobile-09 TV/电视开发：Leanback 入口与焦点
  B('cat.mobile-09', 'TV/电视开发：Leanback 启动入口声明与遥控器焦点导航要点。', 'Kotlin / Android TV', "<!-- AndroidManifest.xml -->\n<activity android:name=\".MainActivity\" android:banner=\"@drawable/banner\">\n  <intent-filter><action android:name=\"android.intent.action.MAIN\"/><category android:name=\"android.intent.category.LEANBACK_LAUNCHER\"/></intent-filter>\n</activity>\n<!-- 焦点：focusable=true，方向键用 nextFocusUp/Down/Left/Right 显式声明 -->"),
  // mobile-10 uniapp 组件：Vue SFC
  B('cat.mobile-10', 'uniapp 开源组件：Vue 单文件组件（props + emit，跨 H5/小程序/App）。', 'Vue / uniapp', "<template>\n  <view class='mim-card' @click=\"emit('select')\">{{ title }}</view>\n</template>\n<script setup>\nconst props = defineProps({ title: String }); const emit = defineEmits(['select'])\n</script>"),
  // devtools-01 版本管理系统：分支规范与提交钩子
  B('cat.devtools-01', '版本管理系统：Git 分支命名规范、Conventional Commits 与 pre-commit 门禁。', 'Git / husky', "# 分支：main / feat/<slug> / fix/<slug>\n# 提交：feat(scope): 说明 / fix(scope): 说明\nnpx husky init && echo 'pnpm -r typecheck' > .husky/pre-commit\ngit log --oneline --graph --decorate -20"),
  // devtools-03 Wiki/文档工具：mkdocs 配置
  B('cat.devtools-03', 'Wiki/文档工具：mkdocs-material 配置、导航与本地预览命令。', 'mkdocs / Markdown', "# mkdocs.yml\nsite_name: Mim Wiki\ntheme: { name: material }\nnav:\n  - 首页: index.md\n  - 运行手册: runbook.md\nplugins: [search]\n# 本地：mkdocs serve -a 0.0.0.0:8000"),
  // devtools-04 编译/构建/部署：esbuild 构建脚本
  B('cat.devtools-04', '编译/构建/部署：esbuild 打包 Node 服务（外置原生依赖）+ systemd 托管。', 'esbuild / systemd', "import { build } from 'esbuild'\nawait build({ entryPoints: ['src/index.ts'], bundle: true, platform: 'node', format: 'esm', outfile: 'dist/index.js', external: ['better-sqlite3'] })\n# 部署：node dist/index.js，交由 systemd mim-api.service 托管与重启"),
  // devtools-05 Maven 插件：编译插件与自定义 goal
  B('cat.devtools-05', 'Maven 插件：编译插件（release 21）与自定义 goal 的 pom 片段。', 'Maven / Java', "<plugin>\n  <groupId>org.apache.maven.plugins</groupId>\n  <artifactId>maven-compiler-plugin</artifactId>\n  <configuration><release>21</release></configuration>\n</plugin>\n<!-- 自定义 goal：mvn -pl core mim:verify -->"),
  // devtools-06 Gulp 扩展：压缩任务
  B('cat.devtools-06', 'Gulp 扩展：基于 gulp-terser 的压缩任务与默认串行任务。', 'Node / gulp', "const gulp = require('gulp'); const terser = require('gulp-terser')\ngulp.task('minify', () => gulp.src('src/**/*.js').pipe(terser()).pipe(gulp.dest('dist')))\ngulp.task('default', gulp.series('minify'))"),
  // devtools-07 测试工具：vitest 配置与覆盖率阈值
  B('cat.devtools-07', '测试工具：vitest 配置、v8 覆盖率阈值与单文件执行命令。', 'vitest / v8', "import { defineConfig } from 'vitest/config'\nexport default defineConfig({ test: { environment: 'node', coverage: { provider: 'v8', thresholds: { lines: 80 } } } })\n// 单文件：pnpm --filter @mim/api test -- catalog.test.ts"),
  // devops-01 网管工具：连接与端口诊断
  B('cat.devops-01', '网管工具：连接统计、端口监听与 systemd 日志三件套诊断命令。', 'Linux / nginx', "curl -s localhost:8080/nginx_status   # Active connections / reading / writing\nss -s && ss -lntp | head -20           # 连接与端口\njournalctl -u mim-api -n 50 --no-pager # 服务日志\n# 采集：每 60s 写成 Prometheus textfile"),
  // devops-02 监控系统：Prometheus 告警规则
  B('cat.devops-02', '监控系统：Prometheus 告警规则（实例宕机 + 5xx 错误率，含 for 抑制）。', 'Prometheus / YAML', "groups:\n  - name: mim-api\n    rules:\n      - alert: ApiDown\n        expr: up{job='mim-api'} == 0\n        for: 2m\n        labels: { severity: critical }\n      - alert: HighErrorRate\n        expr: rate(http_requests_total{status=~'5..'}[5m]) > 0.05"),
  // devops-03 DevOps工具：CI 流水线
  B('cat.devops-03', 'DevOps 工具：GitHub Actions 门禁-部署两阶段流水线骨架。', 'GitHub Actions / YAML', "on: { push: { branches: [main] } }\njobs:\n  gate:\n    runs-on: ubuntu-latest\n    steps: [{ uses: actions/checkout@v4 }, { run: pnpm i --frozen-lockfile }, { run: pnpm -r typecheck }, { run: pnpm --filter @mim/api test }]\n  deploy:\n    needs: gate\n    runs-on: ubuntu-latest\n    steps: [{ run: ssh deploy@host 'cd /opt/mim && ./deploy/remote.sh' }]"),
]; // 平台/工具/运维蓝图结束：19 条
