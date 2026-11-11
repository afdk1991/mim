/** 人工智能组 11 条条目的起盘蓝图：编码 cat.ai-01 ~ cat.ai-11。 */
import { B, type ModuleBlueprint } from './types.js'; // 蓝图构造函数与类型

export const AI_BLUEPRINTS: readonly ModuleBlueprint[] = [ // 数组顺序即分类树顺序
  // 01 AI-人工智能：通用模型调用骨架
  B('cat.ai-01', '通用 AI 应用骨架：OpenAI 兼容接口调用 + 提示词模板 + 结果兜底。', 'Python 3.11 / openai SDK', "import os\nfrom openai import OpenAI\nclient = OpenAI(base_url=os.environ['LLM_BASE_URL'], api_key=os.environ['LLM_API_KEY'])\ndef ask(prompt: str) -> str:\n    r = client.chat.completions.create(model='mim-chat', messages=[{'role': 'user', 'content': prompt}])\n    return r.choices[0].message.content or ''"),
  // 02 VR/AR：WebXR 场景与 XR 渲染循环
  B('cat.ai-02', 'VR/AR：three.js + WebXR 场景骨架，启用 XR 后按头显帧率渲染。', 'TypeScript / three.js', "import * as THREE from 'three'\nconst scene = new THREE.Scene()\nconst camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.01, 100)\nconst renderer = new THREE.WebGLRenderer({ antialias: true })\nrenderer.xr.enabled = true\nrenderer.setAnimationLoop(() => renderer.render(scene, camera))\ndocument.body.appendChild(renderer.domElement)"),
  // 03 机器学习/深度学习：PyTorch 训练循环
  B('cat.ai-03', '机器学习/深度学习：PyTorch 训练循环（DataLoader + 优化器 + 每轮损失）。', 'Python / PyTorch', "import torch, torch.nn as nn\nds = torch.utils.data.TensorDataset(torch.randn(1000, 8), torch.randint(0, 2, (1000,)))\ndl = torch.utils.data.DataLoader(ds, batch_size=32, shuffle=True)\nmodel = nn.Sequential(nn.Linear(8, 16), nn.ReLU(), nn.Linear(16, 2))\nopt = torch.optim.Adam(model.parameters(), lr=1e-3)\nfor epoch in range(5):\n    for x, y in dl:\n        loss = nn.functional.cross_entropy(model(x), y); opt.zero_grad(); loss.backward(); opt.step()\n    print(epoch, float(loss))"),
  // 04 计算机视觉/人脸识别：OpenCV 实时检测
  B('cat.ai-04', '计算机视觉/人脸识别：OpenCV 摄像头实时人脸框选与退出键处理。', 'Python / OpenCV', "import cv2\ncap = cv2.VideoCapture(0)\ncascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')\nwhile True:\n    ok, frame = cap.read()\n    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)\n    for (x, y, w, h) in cascade.detectMultiScale(gray, 1.2, 5):\n        cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 255, 0), 2)\n    cv2.imshow('mim', frame)\n    if cv2.waitKey(1) == 27: break"),
  // 05 智能家居：MQTT 控制与订阅
  B('cat.ai-05', '智能家居：MQTT 下发设备指令并订阅传感器主题，回调打印载荷。', 'Python / paho-mqtt', "import paho.mqtt.client as mqtt\nc = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)\nc.connect('broker.example.com', 1883)\nc.publish('home/livingroom/light', 'ON')\nc.subscribe('home/+/sensor')\nc.on_message = lambda _c, _u, msg: print(msg.topic, msg.payload.decode())\nc.loop_forever()"),
  // 06 自然语言处理：分词与情感极性
  B('cat.ai-06', '自然语言处理：jieba 分词 + SnowNLP 情感极性打分（中文场景基线）。', 'Python / jieba / snownlp', "import jieba\nfrom snownlp import SnowNLP\ntext = '这个模块很好用'\nprint(list(jieba.cut(text)))\nprint(round(SnowNLP(text).sentiments, 3))  # 0–1，越大越正面"),
  // 07 大模型：函数调用（tool_calls）
  B('cat.ai-07', '大模型：函数调用（tools）骨架——模型返回 tool_calls 后本地执行再回填。', 'Python / openai SDK', "from openai import OpenAI\nclient = OpenAI()\nresp = client.chat.completions.create(\n    model='mim-chat', messages=[{'role': 'user', 'content': '帮我找 JSON 工具'}],\n    tools=[{'type': 'function', 'function': {'name': 'search_modules', 'parameters': {'type': 'object', 'properties': {'q': {'type': 'string'}}}}}],\n)  # resp.choices[0].message.tool_calls 里取出入参后本地执行"),
  // 08 推理框架：llama.cpp 本地服务
  B('cat.ai-08', '推理框架：llama.cpp 本地起服务 + OpenAI 兼容接口自测。', 'llama.cpp / GGUF', "# 本地起服务（GGUF 量化模型）\nllama-server -m models/qwen2.5-7b-instruct-q4_k_m.gguf --port 8080 -c 4096\n# 自测\ncurl -s http://127.0.0.1:8080/v1/chat/completions -H 'Content-Type: application/json' -d '{\"messages\":[{\"role\":\"user\",\"content\":\"你好\"}]}'"),
  // 09 MCP：MCP server 最小实现
  B('cat.ai-09', 'MCP：Model Context Protocol 服务端最小实现（stdio 传输 + 一个工具）。', 'TypeScript / @modelcontextprotocol/sdk', "import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'\nimport { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'\nimport { z } from 'zod'\nconst server = new McpServer({ name: 'mim-tools', version: '0.0.1' })\nserver.tool('module_lookup', { code: z.string() }, async ({ code }) => ({ content: [{ type: 'text', text: code }] }))\nawait server.connect(new StdioServerTransport())"),
  // 10 RAG知识库：向量检索最小闭环
  B('cat.ai-10', 'RAG 知识库：分块 → 向量化 → 余弦检索 Top1，先跑通再上向量库。', 'Python / sentence-transformers', "from sentence_transformers import SentenceTransformer\nimport numpy as np\nchunks = ['商城支持购物车', 'IM 支持群聊']\nmodel = SentenceTransformer('BAAI/bge-small-zh-v1.5')\nvecs = model.encode(chunks, normalize_embeddings=True)\nq = model.encode(['怎么加群'], normalize_embeddings=True)[0]\nprint(chunks[int(np.argmax(vecs @ q))])"),
  // 11 数据集：数据集卡与字段定义
  B('cat.ai-11', '数据集：数据集卡（字段 / 切分比例 / 许可）+ 生成脚本约定。', 'YAML / Markdown', "# dataset-card.md\nname: mim-marketplace-modules\nlicense: CC-BY-4.0\nsplit: { train: 0.8, valid: 0.1, test: 0.1 }\nfeatures:\n  - { name: code, dtype: string }\n  - { name: name, dtype: string }\n  - { name: group, dtype: string }\n  - { name: capability, dtype: string }\n# 生成：python scripts/build_dataset.py --out data/modules.jsonl"),
]; // AI 蓝图结束：11 条
