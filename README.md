# Jev Gomoku

15×15 五子棋网页应用：玩家执黑先手，本地确定性引擎负责棋盘几何、Alpha-Beta、VCF/VCT 等计算，Jev / TypeSafe System One 作为可选的结构化判断层。

当前 `chatgpt-sites-private-preview` 分支已改造成 **ChatGPT Sites / Cloudflare Worker 兼容**的同源架构，保留原有棋盘 UI、本地引擎、Jev 决策轨迹与“复制棋谱”功能。

## 网络架构

```text
浏览器
  │
  │ POST /api/jev
  ▼
ChatGPT Sites Worker
  │
  │ Authorization: Bearer $JEV_API_KEY
  │ Content-Type: application/json
  ▼
POST https://api.typesafe.ai/v1/systemone
```

浏览器不会直接访问 TypeSafe，也不会收到、保存或记录 `JEV_API_KEY`。服务端 Worker 从运行时 Secret `JEV_API_KEY` 读取密钥。

## 目录

```text
.
├── index.html
├── jev-gomoku.html
├── assets/
│   └── styles.css
├── src/
│   ├── app.js                 # UI、本地 Alpha-Beta + VCF/VCT、Jev 决策编排、棋谱复制
│   └── jev-client.js          # 浏览器同源 /api/jev 客户端 + sessionStorage 结果缓存
├── server/
│   └── index.js               # Sites Worker；POST /api/jev -> TypeSafe
├── .openai/
│   └── hosting.json           # Sites 托管元数据；不保存 Secret
├── vite.config.js
├── wrangler.jsonc
├── package.json
├── .env.example
├── jev-proxy.mjs              # 本地无跨域代理，同样读取 JEV_API_KEY
└── start-jev.command
```

## ChatGPT Sites runtime

项目使用：

- Node.js 22.13+
- Vite 8
- `@cloudflare/vite-plugin`
- `@openai/sites-vite-plugin`
- Cloudflare Worker 风格的 `fetch(request, env)` 入口

`npm run build` 应生成 Worker 与静态资源，并由 OpenAI Sites 插件复制 `.openai/hosting.json` 到构建产物。

首次由 ChatGPT Sites 保存版本时，Sites 会为项目 provision `project_id` 并更新托管元数据。不要把 Secret 写进 `.openai/hosting.json`。

## Secret

托管环境只需要一个 Secret：

```text
JEV_API_KEY
```

本地开发可按相同变量名设置：

```bash
export JEV_API_KEY='...'
npm install
npm run dev
```

或继续使用原来的轻量本地服务器：

```bash
export JEV_API_KEY='...'
node jev-proxy.mjs
```

不要使用 `VITE_JEV_API_KEY`；任何 `VITE_*` 值都属于浏览器构建可见配置。

## Jev 请求控制

- **本地引擎**：0 次 Jev 请求。
- **大师混合 / 强力混合**：Atomic 与双向 Pairwise 合并到同一个 System One payload，正常每个白棋回合只发起 **1 个浏览器 -> /api/jev 的逻辑请求**。
- **纯 Jev**：正常每个白棋回合 1 个 `/api/jev` 请求。
- Worker 对 TypeSafe 的 **429 / 529** 最多尝试 3 次：优先遵守 `Retry-After`，没有该响应头时使用指数退避。
- sessionStorage 只缓存 **Jev 响应结果**，不保存 API Key。
- TypeSafe、Worker、网络或响应校验出现错误时，白棋自动使用本地 Alpha-Beta + VCF/VCT 继续落子。

429 / 529 的重试属于异常恢复；正常成功路径只调用 TypeSafe 一次。

## 棋谱复制

“复制棋谱”继续包含：

- 回合棋谱与逐手记录
- 白方最终落点
- 模式、模型、阶段、强制取胜 / 防守状态
- Jev 概率与 confidence
- Atomic / Pairwise 原始可观测结果
- 本地候选排序及融合分数
- VCF / VCT、战术安全、先手压力、连接性等确定性特征
- Token 使用、浏览器请求 / 会话缓存信息
- Jev 不可用时的本地降级原因

这些是程序可观测的决策数据和评分轨迹，不依赖模型隐藏推理文本。

## 验证

```bash
npm install
npm run check
```

CI 还会确认：

- `dist/server/index.js` 和 `dist/.openai/hosting.json` 存在；
- Worker 默认导出可调用的 `fetch`；
- 浏览器文件不包含 TypeSafe API URL、Bearer Key 逻辑或 `dangerouslyAllowBrowser`；
- 前端只通过同源 `/api/jev` 调用 Jev。
