# Jev Gomoku

15×15 五子棋网页应用：玩家执黑先手，本地确定性引擎负责棋盘几何、Alpha-Beta、VCF/VCT 等计算，Jev / TypeSafe System One 作为可选的结构化判断层。

## 在线体验

计划通过 GitHub Pages 发布：

```text
https://jackson-heylion.github.io/jev-gomoku/
```

首次需要在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。之后 `main` 每次更新会由 `.github/workflows/pages.yml` 自动发布。

公开页面默认可直接使用 **本地引擎**，不需要 API Key，也不会产生 Jev 请求。若要启用 Jev，请使用自己的 TypeSafe API Key；项目不会把共享 API Key 写入仓库、GitHub Pages 或前端构建产物。

> GitHub Pages 是静态托管，不能安全保存服务端 API Key，也不能充当 Jev 反向代理。若浏览器直连 TypeSafe 被 CORS 拦截，请使用下面的本地代理方式。

## 目录

```text
.
├── index.html                 # 页面结构，保持精简
├── jev-gomoku.html            # 兼容旧入口，与 index.html 一致
├── assets/
│   └── styles.css             # 页面样式
├── src/
│   ├── app.js                 # 棋局状态、UI、本地棋力、Jev 决策编排
│   └── jev-client.js          # Jev HTTP、缓存、429/529 重试
├── jev-proxy.mjs              # 本地静态服务器 + Jev 代理
├── start-jev.command          # macOS 一键启动
└── .github/workflows/
    ├── ci.yml                 # JS 语法与静态入口检查
    └── pages.yml              # GitHub Pages 自动部署
```

## 本地运行

要求 Node.js 20+。

### macOS

```bash
chmod +x start-jev.command
./start-jev.command
```

或：

```bash
node jev-proxy.mjs
```

默认尝试 `127.0.0.1:8787`；占用时依次尝试 8788–8797，仍不可用则选择系统空闲端口。启动后会输出并自动打开实际地址。

## 棋力模式

- **本地引擎**：0 次 Jev 请求，可离线 / GitHub Pages 直接玩。
- **大师混合**：Alpha-Beta 5 层 + VCF/VCT + Jev 批量 Atomic / Pairwise。
- **强力混合**：Alpha-Beta 3 层 + 威胁搜索 + Jev 批量 Atomic / Pairwise。
- **纯 Jev**：将合法落点作为 Choice 选项直接交给 Jev。15×15 在玩家先落一手后最多 224 个合法选项，低于 TypeSafe Choice 的 255 选项上限。

## Jev 请求控制

TypeSafe 官方文档说明 `429 Too Many Requests` 与 `529 Overloaded` 应使用指数退避重试。当前实现：

1. 混合模式把 Atomic 判断和双向 Pairwise **合并为同一个 System One 请求**，正常情况下每个白方回合最多 1 次 Jev HTTP 请求。
2. 对 429 / 529 最多尝试 3 次，优先遵守 `Retry-After`，否则指数退避。
3. 成功结果写入 `sessionStorage` 会话缓存；悔棋后遇到相同局面可避免重复请求。
4. 请求仍失败或浏览器遭遇网络 / CORS 问题时，自动降级到本地引擎继续对局。
5. 不在公网部署中共享一个服务端 Jev Key，避免所有访客共用同一额度与速率限制。

TypeSafe 还明确推荐把多个独立问题放进一个请求；官方 Parallel Questions 示例显示批量问题可以显著减少重复输入 token 和网络往返。

## 棋谱复制

“复制棋谱”现在包含：

- 回合棋谱与逐手记录
- 每一步白方最终落点
- 模式、模型、阶段、强制取胜 / 防守状态
- Jev 最终概率与 confidence
- 本地候选排序
- Atomic / Pairwise / 最终融合分数
- VCF / VCT、战术安全、先手压力、连接性等确定性特征
- Token 使用、API 尝试次数 / 会话缓存命中
- Jev 不可用时的本地降级原因

这些内容是程序可观测的决策数据和评分轨迹，不依赖模型隐藏推理文本。

## API Key 安全

本地模式下，API Key 由浏览器发送到 `127.0.0.1:<port>/api/jev`，本地 Node 进程再转发给：

```text
POST https://api.typesafe.ai/v1/systemone
```

公开 GitHub Pages 页面只支持用户自行填写 Key，并且是否能浏览器直连取决于 TypeSafe 的 CORS 策略。不要把 API Key 提交到 GitHub、Workflow、Pages 文件或 JavaScript 常量中。
