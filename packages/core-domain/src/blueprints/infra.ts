/** 服务器应用（12）+ 数据库相关（2）+ 游戏/娱乐（3）三组共 17 条未绑定条目的起盘蓝图。 */
import { B, type ModuleBlueprint } from './types.js'; // 蓝图构造函数与类型

export const INFRA_BLUEPRINTS: readonly ModuleBlueprint[] = [ // 数组顺序：server → database → game
  // server-01 分布式服务/框架：gRPC 客户端
  B('cat.server-01', '分布式服务/框架：gRPC 服务端契约与客户端调用（含 proto 方法约定）。', 'gRPC / @grpc/grpc-js', "// proto: service User { rpc Get (GetReq) returns (User); }\nimport { loadPackageDefinition, credentials } from '@grpc/grpc-js'\nconst client = new (loadPackageDefinition(proto).User)(host + ':50051', credentials.createInsecure())\nclient.Get({ id: 'u1' }, (err, user) => console.log(err ?? user))"),
  // server-02 消息服务器/队列：Kafka 生产
  B('cat.server-02', '消息服务器/消息队列：Kafka 生产者发送模块事件（带 key 保序）。', 'Kafka / Node', "const { Kafka } = require('kafkajs')\nconst kafka = new Kafka({ clientId: 'mim', brokers: ['127.0.0.1:9092'] })\nconst producer = kafka.producer(); await producer.connect()\nawait producer.send({ topic: 'module-events', messages: [{ key: 'cat.dev-28', value: JSON.stringify({ type: 'invoked' }) }] })"),
  // server-03 Docker相关：镜像构建
  B('cat.server-03', 'Docker 相关：Node 服务多阶段镜像构建（仅装生产依赖、非 root 运行）。', 'Docker', "FROM node:22-alpine\nWORKDIR /app\nCOPY package.json pnpm-lock.yaml ./\nRUN corepack enable && pnpm i --prod --frozen-lockfile\nCOPY dist ./dist\nEXPOSE 8787\nCMD ['node', 'dist/index.js']"),
  // server-04 容器/虚拟机：compose 编排
  B('cat.server-04', '容器/虚拟机：docker compose 编排 API + nginx，数据卷持久化 SQLite。', 'Docker Compose', "services:\n  api: { build: ., ports: ['8787:8787'], environment: ['MIM_DB_PATH=/data/mim.db'], volumes: ['mim-data:/data'] }\n  nginx: { image: nginx:alpine, ports: ['443:443'], volumes: ['./deploy/nginx.conf:/etc/nginx/nginx.conf'] }\nvolumes: { mim-data: {} }"),
  // server-05 Nginx扩展模块：SPA 与反代
  B('cat.server-05', 'Nginx 扩展模块：SPA 回退、API 反代与透传真实协议头的站点配置。', 'nginx', "server {\n  listen 443 ssl http2;\n  location / { try_files $uri $uri/ /index.html; }\n  location /api/ { proxy_pass http://127.0.0.1:8787; proxy_set_header X-Forwarded-Proto $scheme; }\n  add_header Content-Security-Policy \"default-src 'self'\";\n}"),
  // server-06 大数据：Spark 聚合
  B('cat.server-06', '大数据：PySpark 读取 Parquet 并按状态聚合排序的最小作业。', 'PySpark', "from pyspark.sql import SparkSession\nspark = SparkSession.builder.appName('mim-orders').getOrCreate()\ndf = spark.read.parquet('s3a://mim/orders/')\ndf.groupBy('status').count().orderBy('count', ascending=False).show()"),
  // server-07 云计算：Terraform 实例
  B('cat.server-07', '云计算：Terraform 声明式创建云主机（实例规格 + 镜像 + 数量）。', 'Terraform / HCL', "resource \"tencentcloud_cvm_instance\" \"api\" {\n  instance_name = \"mim-api\"\n  instance_type = \"S5.MEDIUM4\"\n  image_id = \"img-pi0ii46r\"\n  count = 1\n}"),
  // server-08 一键安装包：安装脚本
  B('cat.server-08', '一键安装包：幂等安装脚本（下载、托管服务、健康检查三步）。', 'Bash', "#!/usr/bin/env bash\nset -euo pipefail\ncurl -fsSL https://mim.mixm.top/install.sh | bash -s -- --prefix /opt/mim\nsystemctl enable --now mim-api\ncurl -fsS https://mim.mixm.top/health"),
  // server-09 OpenResty 扩展：Lua 注入
  B('cat.server-09', 'OpenResty 扩展：Lua 注入请求头并按路由直接返回内容。', 'OpenResty / Lua', "location /api/ {\n  access_by_lua_block { ngx.req.set_header(\"X-Trace-Id\", ngx.var.request_id) }\n  content_by_lua_block { ngx.say('mim ok') }\n}"),
  // server-10 系统性能优化：内核参数
  B('cat.server-10', '系统性能优化：连接队列、TIME_WAIT 复用与文件句柄的内核参数基线。', 'Linux / sysctl', "# /etc/sysctl.d/99-mim.conf\nnet.core.somaxconn = 1024\nnet.ipv4.tcp_tw_reuse = 1\nvm.swappiness = 10\nfs.file-max = 2097152\n# 验证：sysctl --system && ulimit -n"),
  // server-11 Serverless：云函数入口
  B('cat.server-11', 'Serverless：云函数入口（解析 body、返回 JSON 响应信封）。', 'Node / 云函数', "exports.main = async (event, context) => {\n  const items = JSON.parse(event.body ?? '{}')\n  return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ok: true, count: items.length }) }\n}"),
  // server-12 分布式存储：S3 分片上传
  B('cat.server-12', '分布式存储：S3 客户端接入 + 大文件分片上传三步（含幂等对象键）。', 'S3 / 对象存储', "const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3')\nconst s3 = new S3Client({ region: 'auto', endpoint: process.env.S3_ENDPOINT })\n// 大文件：CreateMultipartUpload → UploadPart(≥5MiB) → CompleteMultipartUpload\n// 一致性：对象键前缀带内容哈希，重复上传天然幂等"),
  // database-02 数据库服务：Postgres 建库
  B('cat.database-02', '数据库服务：PostgreSQL 建表、并发索引与连接串（SSL 强制）。', 'PostgreSQL / SQL', "-- PostgreSQL 生产库骨架\nCREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, created_at TIMESTAMPTZ DEFAULT now());\nCREATE INDEX CONCURRENTLY idx_users_email ON users (email);\n-- DATABASE_URL=postgres://user:pass@host:5432/mim?sslmode=require"),
  // database-03 数据库管理/监控：慢查询与备份
  B('cat.database-03', '数据库管理/监控：慢查询 Top10、完整性检查与在线备份三条运维命令。', 'SQL / 运维', "-- 慢查询（pg_stat_statements）\nSELECT query, calls, mean_exec_time FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;\n-- SQLite：PRAGMA integrity_check; PRAGMA wal_checkpoint(TRUNCATE);\n-- 备份：sqlite3 mim.db \".backup 'mim-2026-11-11.db'\""),
  // game-01 游戏：Unity 玩法循环
  B('cat.game-01', '游戏：Unity 玩法循环骨架（输入检测 + 刚体跳跃）。', 'C# / Unity', "using UnityEngine;\npublic class MimGameLoop : MonoBehaviour {\n  void Update() { if (Input.GetKeyDown(KeyCode.Space)) Jump(); }\n  void Jump() { GetComponent<Rigidbody>().AddForce(Vector3.up * 6f, ForceMode.Impulse); }\n}"),
  // game-02 游戏开发：关卡数值与状态机
  B('cat.game-02', '游戏开发：关卡数值表（血量/敌人数/奖励）与五态状态机迁移事件。', 'CSV / 状态机', "# 关卡数值表（CSV）\nlevel,hp,enemy_count,reward_gold\n1,100,3,50\n2,160,5,90\n# 状态机：Idle → Ready → Playing → Paused → Win/Lose，迁移写入埋点"),
  // game-03 3D引擎：three.js 场景
  B('cat.game-03', '3D 引擎：three.js 场景、光照、相机与渲染循环的最小可运行版本。', 'TypeScript / three.js', "import * as THREE from 'three'\nconst scene = new THREE.Scene(); const cam = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 100)\nconst mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x2f6feb }))\nscene.add(mesh); scene.add(new THREE.DirectionalLight(0xffffff, 2)); cam.position.z = 4\nconst renderer = new THREE.WebGLRenderer(); document.body.appendChild(renderer.domElement); renderer.setAnimationLoop(() => renderer.render(scene, cam))"),
]; // 基础设施蓝图结束：17 条
