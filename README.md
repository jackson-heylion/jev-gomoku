# Jev Gomoku

一个 15×15 五子棋网页项目。开局前可选择玩家执黑或执白，并独立配置黑棋长连、四四、三三禁手；AI 由本地搜索引擎提供候选与战术证据，必要时由 **Jev 做最终落子决定**。

每局开始前会打开开局设置：选择执黑 / 执白，并分别开关长连、四四、三三。规则在开局后锁定，并同时应用于玩家落子、本地 Alpha-Beta/VCF/VCT、Deep Worker、Threat-space Search 与 Jev。长连禁手开启时黑棋恰好五连获胜；关闭时黑棋五连及以上均可获胜。白棋始终五连及以上获胜。

## AI 决策架构

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
- Local 主线程搜索增加墙钟时间预算：Strong 900ms、Expert 2200ms、Grandmaster 2400ms；根搜索采用迭代加深，超时保留最后一轮完整结果，再继续必要的一手战术安全检查。
- 开局性能保护：仅 `moves.length < 4` 使用较浅的 Local 搜索；从第 5 个落子位置开始 Expert/Grandmaster 恢复完整本地参数。额外 Deep Worker 仍按原策略在前 10 手跳过。
- Jev 返回非法落点或调用失败时，自动降级由 Local 接管本回合。

## 功能

- Alpha-Beta 搜索
- 根节点低成本棋形专家：活四/冲四类完成点、活三扩展、多轴威胁、占据对手强点
- Deep Worker：迭代加深 + 有界 TT + 2 层 Threat Quiescence，只在叶子继续搜索强制/高威胁着法
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

宗师模式不引入 MCTS。同步根搜索先用低成本棋形专家补充候选召回，但不扩大 Alpha-Beta 根宽度；后台再并行运行 Deep Alpha-Beta 与 Threat-space 强制威胁证明。Deep Worker 的普通叶子会额外做最多 2 层 Threat Quiescence，只延伸立即胜/必防/冲四与活三类高威胁着法。若 Threat-space 证明某候选会遭遇对手强制胜，则优先过滤；Local、Deep、Threat 与高置信棋形专家一致时可直接落子，否则交给 Jev。

## Jev 决策纲领

不会把整篇“五子棋口诀/兵法”原文塞进每次请求。Jev 只接收一份短小、结构化的 `gomoku_doctrine`，内容包括：

- 证据优先级：合法性/数学证明 > 强制威胁 > Deep Search > 棋形启发 > 位置偏好
- 威胁等级：成五 > 活四/双四/四三 > 四 > 活三/VCT > 多路二 > 普通位置
- 强调着法次序、保留潜在先手、攻守转换、四个方向同时检查
- 防守优先选择“既消除对方主威胁，又制造己方反先/切断多轴交叉点”的落子
- 开局关注多路二→三扩展和阻断对方扩展，而不是只追求中心或贴子

每个最终候选同时携带 `pattern_class`、`pattern_score`、四/活三方向数、multi-axis、以及该点原本是否是对手强棋形点。棋形证据只是启发，不得覆盖 VCF/Threat-space 等确定性证明。

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
而不是旧的 challenger / fusion 思路。生产引擎已支持 AI 执黑或执白；benchmark 的具体座位由对应测试场景决定。

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
