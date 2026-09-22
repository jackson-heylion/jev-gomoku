# Jev Gomoku

一个 15×15 五子棋网页项目。玩家执黑先手，白棋由本地搜索引擎与 Jev 共同决策。

对局启用黑棋禁手规则：黑棋禁止长连、三三、四四；黑棋恰好五连获胜，白棋五连或长连均可获胜。禁手判定同时应用于玩家落子、本地 Alpha-Beta/VCF/VCT 搜索和 Deep Worker。

## 功能

- Alpha-Beta 搜索
- VCF / VCT 威胁判断
- 本地、强力混合、大师混合、纯 Jev 多种模式
- Jev Atomic + Pairwise 候选判断
- Jev 失败时自动降级到本地引擎
- 对局结束胜负弹窗
- 一键复制完整棋谱与 AI 决策记录
- ChatGPT Sites / Cloudflare Worker 同源部署

## Jev 架构

浏览器只请求：

```text
POST /api/jev
```

服务端再请求 TypeSafe System One。API Key 仅从服务端环境变量读取：

```text
JEV_API_KEY
```

不会把密钥写入前端代码、HTML、localStorage 或日志。

## 本地运行

```bash
npm install
export JEV_API_KEY='your-api-key'
npm run dev
```

检查构建：

```bash
npm run check
```

## 部署

项目主要用于 **ChatGPT Sites** 部署，Sites 配置位于：

```text
.openai/hosting.json
```
