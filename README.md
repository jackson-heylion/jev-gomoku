# Jev Gomoku

一个 15×15 五子棋网页项目。开局前可选择玩家执黑或执白，并独立配置黑棋长连、四四、三三禁手；AI 由本地搜索引擎提供候选与战术证据，必要时由 **Jev 做最终落子决定**。

每局开始前会打开开局设置：选择执黑 / 执白，并分别开关长连、四四、三三。规则在开局后锁定，并同时应用于玩家落子、本地 Alpha-Beta/VCF/VCT、Deep Worker、Threat-space Search 与 Jev。长连禁手开启时黑棋恰好五连获胜；关闭时黑棋五连及以上均可获胜。白棋始终五连及以上获胜。

## 白棋决策架构

```text
Board
  ↓
Local Engine        Alpha-Beta / VCF / VCT / 立即取胜与必防 / fork 防守 /
                    Renju 禁手过滤 / 候选生成
  ↓
Optional Deep Search（Web Worker，1.5s 预算）
  ↓
Local evidence
  ↓
Jev                 ← 最终落子决定者
  ↓
FINAL MOVE
```

- 候选数 > 1 时，每个白棋回合最多调用 Jev **1 次**。
- 候选唯一（强制必胜/必防/唯一防 fork）时 **0 次** Jev 调用，直接落子。
- 开局性能保护：前 8 手使用较浅的 Local 搜索，前 10 手跳过额外 Deep Worker。
- Jev 返回非法落点或调用失败时，自动降级由 Local 接管本回合。

## 功能

- Alpha-Beta 搜索
- VCF / VCT 威胁判断
- 立即取胜 / 必防 / fork 防守 / Renju 禁手过滤
- 开局前选择玩家执黑 / 执白，AI 可执黑先行
- 长连 / 四四 / 三三禁手可独立开关，开局后锁定
- 本地、快速、大师、宗师（Alpha-Beta + Threat-space Search 并行）与纯 Jev 多种模式
- 可选的离线 Deep Worker 深搜证据
- 宗师模式：Deep Search 与强制威胁证明双 Worker 并行；证据一致时 0 次 Jev，分歧时最多 1 次 Jev
- Jev 失败时自动降级到本地引擎
- 对局结束胜负弹窗
- 一键复制完整棋谱与 AI 决策记录
- ChatGPT Sites / Cloudflare Worker 同源部署

## 宗师模式

宗师模式不引入 MCTS。它把同步根搜索控制在较轻预算内，再并行运行两路有界后台证据：常规 Deep Alpha-Beta 与 Threat-space 强制威胁证明。若威胁搜索证明某候选会遭遇对手强制胜，则优先过滤该候选；若 Local、Deep 与威胁证据收敛，则直接落子，只有存在分歧或证据不足时才调用 Jev 裁决。

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

检查构建、引擎回归与 benchmark 冒烟：

```bash
npm run check
```

## 基准测试

`benchmark/` 用于回答「Jev 作为最终落子决策者，是否真的比 Local 单独决策更强」，
而不是旧的 challenger / fusion 思路。被测 arm 固定执白（生产引擎只实现白棋座位），
黑棋是固定的 Ref Local 参照对手，两个 arm 面对同一对手、同一开局。

```bash
npm run benchmark:smoke       # 不调用 Jev，验证 harness / 裁判 / Deep Worker
npm run benchmark:regression  # 引擎与禁手规则回归
npm run benchmark:mock        # 离线 mock Jev，验证完整报告管线

export JEV_API_KEY='...'
npm run benchmark -- --seeds 6 --confirm-cost
```

详见 [`benchmark/README.md`](benchmark/README.md)。

## 部署

项目主要用于 **ChatGPT Sites** 部署，Sites 配置位于：

```text
.openai/hosting.json
```
