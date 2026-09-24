# Benchmark

## 目标

Benchmark 直接复用生产 `src/app.js`、Renju 规则和 `public/deep-worker.js`，比较同一固定对手、同一 opening 下三条决策链：

| arm | 说明 | Jev 请求 |
|---|---|---:|
| `local` | 内部 Local 基线，只用于测量/降级 | 0 |
| `jev-final` | 现有高强度链路：Local/Deep 证据 → Jev Final | 每回合最多 1 |
| `jev-max` | 异构候选 → Deep/Threat → speculative fan-out → optional Final/Resolution | 每回合最多 2 |
| `jev-blind` | 诊断基线：Jev 直接面对全部合法点 | 1 |

默认运行 `local,jev-final,jev-max`。纯 Local 已从产品 UI 删除，但 benchmark 仍保留它作为内部对照组；这不会恢复用户可选的 Local 模式。

## Jev Max 被测契约

生产 Jev Max 的有界流程：

~~~text
Board
  ↓
Local Alpha-Beta
  - Zobrist hash
  - bounded persistent TT
  - iterative-depth TT reuse
  - PV / TT-best move ordering
  ↓
6–8 heterogeneous candidates
  ↓
Persistent Worker Pool (max 2)
  ├─ Deep Worker (Top 4–5)
  ├─ Threat Worker (Top ≤6)
  └─ queued speculative tail Threat (≤2, starts on first idle slot)
  ↓
hard proof filter
  ↓
Request 1: Speculative Fan-Out
  - Atomic: all main candidates
  - Pairwise: likely Top ≤6, reversed-order pairs
  - Critic: same speculative pool
  - global_best
  - recall_check + bounded wildcard proposal
  ↓
Atomic Top4 + deterministic Threat coverage closure
  ↓
High-confidence agreement?
  ├─ yes → FINAL MOVE (1 Jev request)
  └─ no / finalist pool changed / wildcard entered
       ↓
Request 2:
  - Final Judge, or
  - Resolution Fan-Out for actual Top4 + final best_move
       ↓
FINAL MOVE
~~~

硬约束仍由确定性代码执行：非法点、黑棋禁手、立即取胜、唯一必须防守、VCF/Threat-space 已证明的 forced result。普通 Local/Deep/Pattern 排名只能作为证据。

### 性能/载荷契约

- 主候选：最多 8；低核心浏览器自动收紧。
- Deep：最多重点分析 5 个候选。
- Threat：最多 6 个候选。
- 重型 Worker：最多 2 个并行，并复用整局长驻 Worker Pool。
- Jev：最多 2 个逻辑请求/回合；普通未决局面目标 1 次；确定性唯一解 0 次。
- Pairwise：Request 1 可对 likely Top ≤6 speculative fan-out（最多 30 个双向 choice question）；最终实际消费仍只取 Top4 的 ≤12 个问题。
- Critic：Request 1 可 speculative 评估 ≤6 个；最终决策只消费实际 Top4 的 ≤4 个。
- wildcard：额外池 10–16 个，只提议 1 个，必须重新通过本地合法性与一手败着检查。
- Payload：共享 board / candidate facts / policy 去重；目标 < 5000 input tokens / 请求，硬目标 < 7000。
- Deep 若没有完成任何有效 depth：`no_completed_depth + ranking_only`，不能把 `0/-1/-2` 当评估分。
- mate-like sentinel：转换成结构化 `forced_result` 且标记 `proven=false / advisory=true`，不得把超大内部 score 当作数学证明发送给 Jev；VCF / Threat-space proof 仍单独标记为确定性证据。

## 核心指标

除了 W-L-D / 得分率 / Wilson 95% CI，报告还记录：

- Jev override Local #1 次数、override 后的离线 deeper-search hindsight。
- Jev 最终选择与 Local #1 / Deep #1 的一致次数。
- Atomic / Pairwise Top1 一致率。
- wildcard 请求、通过验证、进入 final、最终被选次数。
- VCF 选择、Threat filter 命中。
- 平均 Jev 请求数、input/output token。
- Local / Deep / Threat 阶段耗时、整手决策耗时。
- Worker timeout、`no_completed_depth`。
- Payload >5k / >7k 次数。
- 漏立即胜、自造对手立即胜等战术错误。
- 契约违规：候选/Pairwise/Critic/Worker/请求数/载荷是否越界。

## 回归测试

`npm run benchmark:regression` 会覆盖生产路径，重点包括：

1. Jev Final 仍拥有旧高强度模式的最终决策权。
2. Expert/Grandmaster 本地搜索时间预算与 opening 阈值。
3. Threat-space 已证明 forced-loss 时的确定性过滤。
4. VCF/禁手/黑棋恰好五连规则一致性。
5. `depth=0` 不得被序列化为真实 numeric score。
6. forced-win sentinel 必须结构化。
7. Jev Max Atomic 不得看到 `local_rank/local_engine_grade`。
8. Speculative Pairwise 最多覆盖 Top6（≤30 个问题），实际 Top4 消费 ≤12 个；候选 facts 与 pairwise/critic policy 通过共享 state 引用。
9. `OTHER` → bounded wildcard → 本地合法/一手败着校验 → final judge 的完整链路。
10. Jev Max 每回合重型 Worker ≤2、Jev 请求 ≤2、候选 ≤8，并记录 persistent Worker / TT telemetry。
11. 最近两盘真实棋谱固定位置：`D5 ↔ I6` Local/Deep 分歧召回、Threat-space forced-loss 过滤、VCF proof lock，以及历史 `depth=0` 语义回归。

## 运行

离线 CI / 本地管线验证：

```bash
npm run benchmark:smoke
npm run benchmark:regression
npm run benchmark:mock
```

真实 Jev benchmark 会产生费用，必须显式确认：

```bash
export JEV_API_KEY='...'
npm run benchmark -- --seeds 6 --confirm-cost
```

常用参数：

| 参数 | 默认 | 说明 |
|---|---|---|
| `--seeds N` | 6 | opening 数量，最多 12 |
| `--arms a,b` | `local,jev-final,jev-max` | 被测 arm |
| `--max-plies N` | 60 | 单局最大手数 |
| `--mode expert\|grandmaster` | expert | 非 Max 生产档位 |
| `--arbitration-depth N` | 7 | override 离线 hindsight 深度 |
| `--no-arbitration` | 关 | 跳过 hindsight 裁判 |
| `--deep-worker thread\|sync` | thread | thread 复刻浏览器 Worker |
| `--mock-jev` | 关 | 离线确定性多问题 mock |
| `--model` | jev-latest | Jev 模型 |

输出：

```text
benchmark/results/latest.json
benchmark/results/latest.md
benchmark/results/<timestamp>.json
benchmark/results/<timestamp>.md
```

## 解读

少量 opening 只能用于 regression 和方向判断，不能当作稳定棋力结论。优先检查：

1. 漏立即胜 / 自造立即败是否为 0。
2. Threat / VCF proof 是否从未被 Jev 破坏。
3. override hindsight 是否改善，而不是只看 override 次数。
4. Jev Max 相比 Jev Final 的胜率、override 质量、请求/token/耗时是否值得。
5. Worker timeout、`no_completed_depth`、payload hard-limit violation 是否异常。
6. wildcard 是否偶尔补到 Local candidate universe 漏掉的强手，而不是高频制造噪声。

Benchmark 不会输出或保存 `JEV_API_KEY`。


## Counter-threat regression

新增旧等级 4 实战败局的三个固定局面：

1. 白 12 手 `I10` 后必须至少提示黑 `J9` forcing extension。
2. 黑 `I8` 后 Jev Max 不得因为唯一 fork creator 就硬锁死 `K8`；白 `I12` 的 Threat 分析必须识别黑被迫 `I13` 后仍保留 `J7 + K8` 残余威胁网络。
3. 黑 `I13` 后白 `K8` 必须被 Threat-space 硬证明为 forced loss，强制线从 `J7 -> J6` 开始，并经 `G10` 或 `K6` 转为双胜点。

这些测试区分 hard proof 与 advisory threat network，避免为了增强二阶威胁识别而把启发式误当证明。


## Straight-five wildcard bypass regression

固定实战序列 `H8 G7 H7 G8 H6`：

- `I7` 必须被 Threat-space 证明为 forced loss（黑 `H9` 起杀）。
- `I7` 不得进入 `wildcard_pool`。
- Jev Max 最终必须从 `H5/H9` 的存活防点中选择。
- 若强制重放错误线到 `... I7 H5`，白方面对 `H4/H9` 两个立即胜点时必须标记 `forced_loss_double_win`，并保持 0 次 Jev 请求。


## Threat coverage closure regression

新增 37 手实战败局的“counter-threat 续命 → 证据断层”固定回归：

1. 白 `E14` 会制造立即威胁，必须先迫使黑 `E13` 防守；它只能标为高风险 counter-threat，不能被错误硬判为 forced loss。
2. 黑 `E13` 后，历史尾部候选 `G14` 不再享有“未做 Threat 检查所以看起来干净”的优势。若 Atomic 将其晋级 Top 4，必须先完成 supplemental Threat validation。
3. 根节点直接双胜点 proof 不依赖 Pattern 分数或通用 branch 排名；若对手能通过 `F5/J5` 一手制造两个合法成五点，该候选必须在 Pairwise 前被证明并移除。

契约要求：

- Jev Max 的 `UNVERIFIED_BUDGET` 只影响 Max，不改变旧 Grandmaster 候选行为。
- 初始 Threat 最多 6；supplemental 最多 2、1700ms（timeout ×2）。
- supplemental fail-closed，Pairwise 的主候选 Threat coverage 必须 100% 完成。
- 重型 Worker 并发仍 ≤2。
- benchmark 记录补检触发回合、候选数、fail-closed 拒绝数、补检耗时，并把 supplemental >2 或 Pairwise coverage 不完整记为契约违规。


## 49-ply bounded-rescue regression

来自 49 手真实败局的三组回归：

### White 36 H5：防止过度证明

在黑 `J4` 后：

- `L5 / G7 / G5 / G10 / H11 / I10 / D7` 可在 bounded Threat-space 内证明 forced loss。
- `H5` 在默认 6 attacker turns 以及提升到 8 attacker turns 时仍保持 `NO_PROOF`。
- 该回归防止为了追求更多 hard proof 而把唯一抵抗手误判成败着。

### White 42 H2：保留证明边界

在黑 `L6` 后，`H2` 会迫使黑 `H3`，但 bounded Threat-space 不能完整证明后续所有救法都输，因此：

- `H2` 不得被伪造为 forced loss。
- 若搜索完成，reason 保持 `forced_defense_without_proven_continuation`。
- timeout 仍是 UNKNOWN，不等价于 SAFE，也不等价于 LOSS。

### White 44：all-main-loss rescue state

历史日志中主候选已全部由 Threat-space 标为 `OPPONENT_FORCED_WIN`，旧流程仍发出 3 次 Jev 请求。新回归要求：

- 进入 `jev_max_rescue` 或 `bounded_rescue_exhausted`。
- Pairwise = 0，Critic = 0。
- Jev logical requests 少于历史 3 次。
- Rescue Sweep 最多检查 6 个额外候选，仍保持重型 Worker 并发 ≤2。
- 1～2 个 rescue 候选使用独立 Threat 时间片；较大 rescue pool 批量后最多重试 2 个 unresolved。

Benchmark 统计 rescue sweep 触发回合、候选数、vetted / unresolved 数、bounded-exhausted 次数和耗时，并把 rescue >6 或 rescue 状态仍执行 Pairwise/Critic 记为契约违规。


## Timeout ×2 regression policy

运行时 timeout 统一放大 2 倍后，benchmark 同步放宽对应的显式时间预算和上界，但不放宽结构约束：

- Local 搜索回归上界同步翻倍。
- Worker 规则传播测试的执行 timeout 与显式 worker budget 同步翻倍。
- 49 手实战的 Threat / rescue 诊断预算同步翻倍。
- 候选数、Jev 请求数、Worker 并发数、Threat coverage、rescue pass/retry 上限均保持不变。

这样 benchmark 只允许“多算一倍时间”，不会允许算法无界扩张。

## 历史真实棋谱重放

仓库维护一套去重后的历史真实棋谱族，用于回答“之前输过的关键位置，当前 Jev Max 还能救回多少”。

真实重放命令：

```bash
BENCHMARK_CONFIRM=1 JEV_API_KEY=... npm run benchmark:historical:real
```

默认覆盖 7 个独立棋谱族：

- 9 手直线五连败局；
- 旧 Level-4 威胁网络败局；
- Recent 长局 / VCF 棋谱；
- Recent depth=0 棋谱；
- 37 手 Threat coverage 败局；
- 49 手长局；
- H9 双活三导致的第三局斜五星败局。

同一来源棋谱的多个回归快照只算一个棋谱族，避免重复计胜负。每个样本从最早有意义的关键快照开始，Jev Max 执白、生产 Ref Local 执黑，默认最多续弈 30 手。报告写入 `benchmark/results/historical-real/latest.json` 和 `latest.md`，包含 W/L/D、0/1/2-request 分布、真实 token、延迟与 fallback 数量；API Key 不写入报告。
