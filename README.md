# Jev Gomoku

一个使用 [Jev / TypeSafe System One](https://docs.typesafe.ai/introduction) 参与决策的 15×15 五子棋网页应用。

## 特性

- 玩家执黑先手，Jev 执白
- 支持配置 Jev API Key、Model、Endpoint
- 内置 API 连通性检测
- 本地 Node.js 代理，解决浏览器 CORS 问题
- 端口 8787 被占用时自动尝试 8788–8797，必要时使用系统随机空闲端口
- 大师混合模式：一步胜 / 必须挡杀、Alpha-Beta、VCF / VCT、语义特征、Jev Atomic Judgements、Jev 双向 Pairwise Tournament
- 悔棋、重新开始
- 一键复制完整棋谱

## 快速开始

要求 Node.js 18+，推荐 Node.js 20+。

### macOS

```bash
chmod +x start-jev.command
./start-jev.command
```

也可以直接运行：

```bash
node jev-proxy.mjs
```

启动后打开终端输出的地址，例如：

```text
http://127.0.0.1:8787/
```

如果 8787 已占用，会自动换用其他端口。

### 指定端口

```bash
JEV_PROXY_PORT=8899 node jev-proxy.mjs
```

## Jev 设置

在页面中打开「Jev 设置」：

1. 选择本地代理模式
2. 填写 Jev API Key
3. Model 默认使用 `jev-latest`
4. 点击「检测连接」
5. 检测成功后开始对局

TypeSafe 官方 API：

```text
POST https://api.typesafe.ai/v1/systemone
```

## 架构

```text
浏览器
  ↓
本地五子棋确定性引擎
  ├─ Immediate win / forced block
  ├─ Alpha-Beta
  ├─ VCF / VCT
  └─ 语义战术特征
  ↓
Jev Atomic Judgements
  ↓
Jev Pairwise Tournament
  ↓
融合本地搜索与 Jev 概率
  ↓
最终落子
```

浏览器不直接跨域访问 TypeSafe API，而是：

```text
Browser
  ↓
127.0.0.1:<port>/api/jev
  ↓
https://api.typesafe.ai/v1/systemone
```

## API Key 安全

API Key 由页面发送到本机代理，再由代理转发给 TypeSafe。不要把 API Key 写进仓库或公开提交。

## 文件

- `jev-gomoku.html`：游戏页面、棋局引擎和 Jev 决策逻辑
- `jev-proxy.mjs`：本地代理与静态页面服务器
- `start-jev.command`：macOS 一键启动脚本

## 棋谱复制

页面右侧支持一键复制回合棋谱、逐手记录、紧凑落子序列和对局结果。
