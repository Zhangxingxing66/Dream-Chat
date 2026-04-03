# Dream-Chat

一个基于 DeepSeek 大模型的 AI 对话应用，支持流式输出、Function Calling、多会话管理等特性。

![React](https://img.shields.io/badge/React-18.2-blue)
![Vite](https://img.shields.io/badge/Vite-5.2-purple)
![Node.js](https://img.shields.io/badge/Node.js-Backend-green)
![DeepSeek](https://img.shields.io/badge/DeepSeek-API-orange)

## 功能特性

### 核心功能
- **流式对话** — 实时打字机效果，SSE 流式渲染 AI 回复
- **Function Calling** — 支持多轮工具调用，结果以结构化卡片展示
- **多会话管理** — 创建、切换、删除会话，数据持久化到 localStorage
- **Markdown 渲染** — 支持代码高亮、表格、GFM 等完整 Markdown 语法
- **语音输入** — 基于 Web Speech API 的语音识别
- **消息重新生成** — 支持中止生成和重新生成回复

### 内置工具（AI 可自主调用）
| 工具 | 功能 |
|------|------|
| `get_weather` | 实时天气查询（wttr.in） |
| `web_search` | 联网搜索（Tavily API） |
| `run_code` | 浏览器沙箱 JavaScript 执行 |
| `calculate` | 安全数学表达式计算 |

### 技术亮点
- **有限状态机（FSM）** 管理 AI 消息生命周期：`idle → thinking → tool_calling → answering → completed`
- **requestAnimationFrame** 驱动的文本渲染，每帧 8 字符，保证流畅打字效果
- **并行工具执行**：多个工具调用通过 `Promise.all()` 并发处理
- **服务端代理**：API Key 保存在后端，前端不暴露敏感信息

## 技术栈

**前端**
- React 18 + Vite 5
- react-markdown + rehype-highlight（Markdown & 代码高亮）
- React Context（全局状态管理）
- Web Speech API（语音输入）

**后端**
- Node.js（原生 http 模块，无框架）
- 代理 DeepSeek、wttr.in、Tavily API 请求

## 快速开始

### 前置要求
- Node.js >= 18
- DeepSeek API Key（必须）
- Tavily API Key（联网搜索，可选）

### 安装

```bash
git clone https://github.com/your-username/dream-Chat.git
cd dream-Chat
npm install
```

### 配置环境变量

在项目根目录创建 `.env` 文件：

```env
DEEPSEEK_API_KEY=your_deepseek_api_key
TAVILY_API_KEY=your_tavily_api_key   # 可选，用于联网搜索
PORT=3001
```

### 启动

需要同时启动前端和后端两个服务：

```bash
# 终端 1 — 启动后端 API 代理服务器（:3001）
npm run server

# 终端 2 — 启动前端开发服务器
npm run dev
```

打开浏览器访问 `http://localhost:5173`

### 生产构建

```bash
npm run build   # 构建前端到 /dist
npm run server  # 启动后端服务器
```

## 项目结构

```
dream-Chat/
├── src/
│   ├── components/
│   │   ├── Main/              # 聊天界面、消息列表、输入框
│   │   ├── SideBar/           # 会话列表与导航
│   │   └── MarkdownRenderer/  # Markdown 渲染组件
│   ├── context/
│   │   └── Context.jsx        # 全局状态管理（会话、消息、生成状态）
│   ├── services/
│   │   ├── streamParser.js    # SSE 流式解析
│   │   ├── messageFSM.js      # 消息生命周期状态机
│   │   ├── toolDefinitions.js # AI 工具定义（Schema）
│   │   └── toolExecutor.js    # 工具执行逻辑
│   └── App.jsx
├── server.js                  # 后端 API 代理服务器
├── vite.config.js
└── .env                       # API Keys（不提交到 Git）
```

## 架构说明

```
用户输入
  ↓
Context.runStreamLoop()
  ↓
POST /api/chat → server.js → DeepSeek API
  ↓
SSE 流式响应 → StreamParser 解析
  ↓
┌─ 文本内容 → onChunk() → 打字机渲染
└─ 工具调用 → executeToolCalls() → 并行执行工具
                  ↓
           工具结果返回 API → 继续流式输出
```

## License

MIT
