# Jev Gomoku

15×15 五子棋网页项目。玩家可在开局前选择执黑/执白，并分别配置黑棋长连、四四、三三禁手。AI 保留本地 Alpha-Beta / VCF / VCT / Pattern / Deep / Threat-space 作为搜索器和证据提供者，Jev 模式下由 Jev 参与或完成最终决策。

## 模式

产品 UI 只保留：

| 模式 | 说明 |
|---|---|
| **Jev Max** | 默认最强模式。6–8 个异构候选 + Deep/Threat 双 Worker + Atomic + 双向 Pairwise + Critic + opponent best reply + optional wildcard + final judge |
| **Jev 宗师（等级 4）** | 原高强度稳定模式：Deep / Threat 并行，证据分歧时 Jev 裁决 |
| **Jev 大师（等级 3）** | 深本地搜索提供候选和证据，Jev 最终落子 |
| **Jev 直觉** | 普通 Jev / 实验基线，直接从合法点判断 |

已删除用户可选的 **等级 2 / Jev 快速** 和 **纯 Local**。Local Engine 没有删除：它仍是所有高强度模式的底层搜索器，并在 Jev 网络失败时承担安全降级。

旧 localStorage 自动迁移：

- `local` → `grandmaster`
- `strong`（旧等级 2）→ `grandmaster`
- 新用户/无效值默认 → `max`

## Jev Max

```text
Board
  ↓
多个本地算法提供证据
  ├─ Alpha-Beta
  ├─ Pattern Expert
  ├─ VCF / VCT
  ├─ Deep Search
  ├─ Threat-space
  └─ Defensive / counter-threat recall
  ↓
6–8 heterogeneous Candidate Universe
  ↓
Deep Worker Top 4–5 ─┐
Threat Worker Top ≤6 ┴─ parallel, max 2 heavy Workers
  ↓
确定性 proof filter
  ↓
Request 1
  ├─ Atomic evaluation
  └─ MAIN_SET / OTHER recall audit
  ↓
Atomic Top 4
  ↓
Request 2
  ├─ 6 pairs × A/B + B/A = ≤12 Pairwise questions
  ├─ Critic / refutation for Top 4
  └─ optional wildcard pick from 10–16 extra legal points
  ↓
Request 3（仅未高置信收敛时）
  └─ Final Judge
  ↓
FINAL MOVE
```

### 候选召回

Jev Max 不再使用 `filtered.slice(0, 3)` 作为 Jev 的视野。主候选由多个来源去重合并：

- Local Alpha-Beta Top
- Local deeper-search seeds
- Pattern Expert
- defensive / counter-threat hotspots
- unique fork block（Jev Max 仅作为强证据，不再伪装成唯一数学必防）
- opponent forcing-extension block
- VCF / VCT 标记
- strategic wildcard seed

默认最多 8 个；低核心浏览器自动收紧。Deep 只重点分析 Top 4–5，Threat 最多 6 个。

### 硬安全规则

以下规则不交给 Jev 覆盖：

1. 非法落子。
2. 黑棋已启用的长连 / 四四 / 三三禁手。
3. 当前立即取胜。
4. 对方下一手立即取胜时的唯一合法防守。
5. VCF / Threat-space 已严格证明的 forced result。
6. 已证明 forced-loss / illegal candidate。

普通 Local 排名、Deep 数值、Pattern score 不是数学证明，只作为证据。

### Atomic / Pairwise / Critic

Atomic 独立评价每个候选，刻意隐藏 `local_rank` 和 `local_engine_grade`，避免 Jev 锚定 Local 排名。

Atomic Top 4 再进入 Pairwise。每一对同时询问 `A vs B` 与 `B vs A`，最多 12 个 choice question，使用概率 margin + 胜负关系聚合，降低 option 顺序偏差。Pairwise question 只引用共享 `state.candidate_facts`，不会为每道题复制棋盘和完整证据。

同一个第二阶段请求还会对 Top 4 做 adversarial Critic：

- immediate tactical refutation
- forcing sequence
- multi-axis counterattack
- forced defensive reply 后仍残留的 counter-threat network
- forcing resource spent too early
- initiative loss
- survives best reply

这样第三次 Final Judge 可以看到已经实际返回的 Atomic、Pairwise、Critic 结果，而不是要求第四次 HTTP 请求。

### Counter-threat aware Threat Search

Threat Worker 现在把两类信息严格分开：

- **hard proof**：立即胜、连续强制回复、VCF/Threat-space forced win；可用于硬过滤。
- **advisory counter-threat**：对手被迫防守一次后，仍残留多个 forcing extension / multi-axis junction；只作为 Jev / Critic 的高优先级风险证据，不能单独当成数学证明。

特别针对“我先制造一个威胁 → 对手被迫挡 → 但对手原来的杀网仍然存在”的 horizon 问题。Worker 会记录：

```yaml
counter_threat:
  risk: HIGH | CRITICAL | ELEVATED | WATCH | NONE
  forced_defense_move: I13
  network_moves:
    - J7: FORCING_EXTENSION
    - K8: DOUBLE_WINNING_POINTS
```

为了避免附加分析拖垮原有证明，hard proof 优先执行；counter-threat advisory 自己超时不会把已完成的 hard-proof 结果改成 timeout。

### Opponent best reply / PV

Deep Worker 的完成深度结果现在可返回：

```json
{
  "move": "G8",
  "score": 125.3,
  "principalVariation": ["G8", "H7", "G10", "F9"],
  "opponentBestReplies": [
    {
      "move": "H7",
      "score": 82.1,
      "tacticalFacts": {}
    }
  ]
}
```

Final Judge 因此能比较“我走这步后，对方最强反击是什么”，而不只看到一个 scalar score。

如果 Deep Worker 在时间内没有完成任何有效 iterative-deepening depth：

```json
{
  "status": "no_completed_depth",
  "depthReached": 0,
  "rankingOnly": true
}
```

此时只保留 `fallbackRank`，不会再把 `0/-1/-2` 当作真实 evaluation score 发送给 Jev。

内部 mate-like sentinel（如 `1e14+`）不会直接进入 prompt，而会转换为结构化 `forced_result`，并显式标记 `proven=false / advisory=true`。只有立即胜、VCF、Threat-space 等确定性证明才拥有 proof 权威。

### OTHER / wildcard

Atomic 可返回 `OTHER`，表示主候选可能漏招。系统不会把 200+ 空位全部塞给 Jev，而是本地生成 10–16 个额外合理合法点，第二阶段只让 Jev提议其中 1 个。

wildcard 进入 Final 前必须重新通过：

- 空位/坐标合法性
- 黑棋禁手
- 一手立即败着检查

通过后才可成为最终候选。

## 浏览器性能保护

Jev Max 明确使用 bounded implementation：

- 主线程：UI、候选聚合、轻量 pattern/一手战术、请求调度、结果整合。
- 重型 Worker：最多 2 个并行（Deep + Threat）。
- Local 根搜索预算：Max 2500ms。
- Deep Worker：约 1.3–1.8s。
- Threat Worker：约 1.1–1.45s。
- 候选：最多 8；Deep ≤5；Threat ≤6。
- Jev：0–3 个逻辑请求/回合；普通 Max 非确定性局面通常 2–3 次。
- Pairwise ≤12；Critic ≤4；wildcard pool ≤16。
- 每请求 payload 估算目标 <5000 input tokens，硬目标 <7000。
- sessionStorage Jev cache 继续有 TTL、条数、单项和总容量上限。
- Worker timeout 后正常降级，不在主线程补跑重型同步搜索。
- 支持 `PerformanceObserver('longtask')` 的浏览器会在棋谱记录本手思考期间的 long-task 数量。
- Jev 失败仍由内部 Local Engine 安全接管本回合。

## 棋谱 / 决策日志

Jev Max 棋谱会记录：

- 候选及来源（Local / Deep / Pattern / Threat / wildcard 等）。
- Atomic label + 概率。
- Pairwise 双向聚合结果。
- Deep PV 与 opponent best replies。
- Critic / refutation。
- wildcard requested / proposed / accepted / chosen。
- Final choice / confidence。
- Jev logical requests / upstream attempts。
- input/output token。
- Local / Deep / Threat / total think time。
- Worker timeout / `no_completed_depth`。
- payload token 估算。
- browser long-task（浏览器支持时）。

这些字段可直接用于后续 regression position 与 benchmark。

## 规则与现有功能

保持：

- 玩家执黑 / 执白。
- 长连 / 四四 / 三三独立配置。
- 长连开启时黑棋恰好五连获胜；关闭时黑棋五连及以上获胜。
- Alpha-Beta。
- VCF / VCT。
- Threat-space Search。
- Deep Worker / Web Worker。
- 悔棋。
- 棋谱复制。
- Jev 决策日志。
- 对局 seed 与有界缓存。
- Jev 失败自动降级。
- ChatGPT Sites / Cloudflare Worker。
- 同源服务端 `POST /api/jev`。

## Jev 请求架构

浏览器只请求：

```text
POST /api/jev
```

server-side endpoint 再请求 TypeSafe System One。API Key 只从服务端环境变量读取：

```text
JEV_API_KEY
```

不会把 API Key 写入浏览器、HTML、JS、localStorage 或日志。服务端继续负责 429 / 529 Retry-After / 指数退避。

## 本地运行

```bash
npm install
export JEV_API_KEY='your-api-key'
npm run dev
```

完整检查：

```bash
npm run check
```

包含语法检查、benchmark smoke、回归测试、包含 Jev Max 的离线 mock benchmark，以及生产构建。

## Benchmark

`benchmark/` 保留内部 Local 基线，同时新增独立 `jev-max` arm，不会用 Max 覆盖旧 `jev-final`。重点统计：

- W-L-D / 得分率。
- override Local #1 及 deeper-search hindsight。
- wildcard 使用效果。
- Atomic / Pairwise 一致率。
- Final 与 Local #1 / Deep #1 一致率。
- VCF / Threat filter。
- 平均 Jev 请求/token/回合耗时。
- Local/Deep/Threat 分阶段耗时。
- Worker timeout / `no_completed_depth`。
- payload >5k / >7k，并在 Atomic 请求超过 7k 估算时自动把候选从 8 收紧到 6。
- browser long-task。
- 契约违规和战术错误。
- 两盘真实棋谱位置：Local/Deep 分歧、Threat forced-loss、VCF proof lock、历史 depth=0。

```bash
npm run benchmark:smoke
npm run benchmark:regression
npm run benchmark:mock

export JEV_API_KEY='...'
npm run benchmark -- --seeds 6 --confirm-cost
```

详见 [benchmark/README.md](benchmark/README.md)。

## 部署

主要用于 ChatGPT Sites，同时保留 Cloudflare Worker / 普通 server-side endpoint。

ChatGPT Sites 配置：

```text
.openai/hosting.json
```

所有部署形态都应保持浏览器只访问同源 `/api/jev`，不得把 `JEV_API_KEY` 暴露到前端。


### Wildcard Threat-proof 安全边界

Jev 的 `OTHER` 只能扩大候选召回，不能绕过确定性安全规则。主候选被 VCF / Threat-space / deterministic fork proof 判定为必败后，同一落点不能通过 wildcard 再次进入 Final。若对手已经存在两个不同的立即胜点，则记为 `forced_loss_double_win`，Jev Max 直接 0 请求短路，不再让 Atomic / Pairwise / Final 在多个必败防点之间投票。


### Threat coverage closure

Jev Max 仍保留 6～8 个异构候选，但初始 Threat Worker 只分析最多 6 个。为避免低排名候选因为“缺少风险证据”反而在 Jev 阶段占便宜：

- 仅在 Jev Max 中，本地战术预算耗尽的候选标记为 `UNVERIFIED_BUDGET`，不再伪装成 `SAFE`；旧 Grandmaster 行为保持不变。
- 初始 6 个 Threat 名额不再机械取前 6：保留头部候选后，优先纳入 `UNVERIFIED_BUDGET` 与关键防守候选。
- Atomic 仍可独立评价全部主候选。
- 如果 Atomic 把尚未完成 Threat 校验的候选抬入 Top 4，会触发一次最多 2 候选、850ms 上限的 supplemental Threat Worker。
- supplemental 校验发生在 Pairwise / Critic 之前；已证明 forced-loss 的候选直接移除。
- supplemental 超时或缺失结果时 fail-closed；Pairwise 前有硬不变量：所有参与比较的主候选都必须拥有完成的 Threat evidence。
- 该补检与初始 Deep/Threat Worker 不并发叠加，因此重型 Worker 并发数仍不超过 2。

Threat Worker 还会在每个候选根节点执行一次**直接双胜点 proof**：若对手某一合法落子能立即制造两个合法成五点，就直接作为确定性 forced-loss 证据，不依赖 Pattern 分类或通用 branch 排序。该全量扫描只在根节点执行，递归深层仍保持原有有界 forcing search。

这样 Final Judge 不再比较“风险证据完整的候选”和“因为没分析而看起来干净的候选”，同时不会把能制造强制反击、迫使对手先防守的 counter-threat 手误杀。


### Jev Max Bounded Rescue Sweep

正常回合继续使用 Threat coverage closure。但如果当前主候选已经全部 hard-proved losing，Jev Max 不再让 Atomic / Pairwise / Critic / Final 在一组确定败着之间反复投票：

1. 优先重新检查此前因 Threat timeout / coverage fail-closed 被排除的主候选。
2. 再从 bounded wildcard universe 中加入少量通过 legality + immediate-loss + fork-loss guard 的额外点。
3. Rescue 最多保留 6 个候选；常规情况下先做 bounded Threat 验证。若只剩 1～2 个复杂候选，则逐个给独立时间片，避免共享预算造成 survivor bias；候选较多时批量验证后最多对 2 个 unresolved 单独补跑。
4. 有 completed `NO_PROOF` rescue 时优先保留；没有则保留 timeout / unresolved 候选，因为 UNKNOWN 比已知 forced loss 更值得尝试。
5. rescue 候选存在时最多增加 1 次 Jev 最终选择；若 bounded rescue 全部被证明为败，则停止 Jev 语义投票，按 proof 深度选择最长抵抗线。

另外，在接近“全主候选已败”的 rare path，最多 4 个仅因 Threat 未完成而存活的候选可以在 Atomic 前补一次本地 proof，以减少无意义的语义请求。正常回合预算和最多 2 个重型 Worker 的约束不变。

`THREAT_VETTED_NO_FORCED_LOSS` 语义已改为更保守的 `THREAT_SEARCH_NO_PROOF`：搜索没证明输不等于已经证明安全。
