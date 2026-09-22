# Benchmark

## 这个 benchmark 回答什么

生产架构是：

```text
Board
  ↓
Local Engine        Alpha-Beta / VCF / VCT / 立即取胜与必防 / fork 防守 /
                    Renju 禁手过滤 / 候选生成
  ↓
Optional Deep Search（Web Worker，有 1.5s 预算）
  ↓
Local evidence
  ↓
Jev                 ← 最终落子决定者
  ↓
FINAL MOVE
```

Jev 是最终决策者，所以这里不再问这几件事：

```text
Jev 是否成功挑战 Local        ← challenger 视角，已废弃
Deep Search 是否推翻 Jev      ← 仲裁视角，已废弃
Local / Jev fusion 权重哪个好 ← 融合视角，已废弃
```

现在只问四件事：

1. **同一对手、同一开局下，把最终落子权交给 Jev，是否比让 Local 自己决定得分更高？**
2. **Jev 改写 Local #1 时改得对不对？**（离线更深搜索裁判）
3. **承诺的成本与性能契约是否成立？**（每白棋回合 ≤ 1 次 Jev、唯一候选 0 次 Jev、开局前 8 手浅搜、前 10 手跳过额外 Deep Worker）
4. **Renju 禁手规则在对局引擎里是否和生产一致？**

## 实验设计

被测的 arm 永远执 **白棋**。生产引擎只实现了白棋座位（提示词、战术过滤、禁手处理都以白棋视角写成），
所以不存在「同一个引擎执黑再和它自己对打」的干净做法。

黑棋由固定的 **Ref Local** 参照对手扮演：把生产 Local 引擎放到颜色互换的棋盘上复用，
每个候选点再交给 Renju 裁判复核，取排名最高的合法点。两个 arm 面对**完全相同的对手、完全相同的开局**，
因此得分率差异只能来自白棋的决策策略。

```text
每个 opening 跑 2 局：
  Game A：white = Local      vs black = Ref Local
  Game B：white = Jev Final  vs black = Ref Local
```

| arm | 说明 | Jev 调用 |
|---|---|---|
| `local` | 只用生产 Local 决策（`localOnlyDecision`） | 0 |
| `jev-final` | 生产完整链路（`advancedDecision`）：Local 候选 + 可选深搜证据 → Jev 最终落子 | 每回合 ≤ 1 |
| `jev-blind` | 诊断基线：Jev 直接看棋盘和全部合法点，绕过 Local 候选集 | 每回合 1 |

`jev-blind` 只用于观察候选生成器是否漏手，默认不参与，需要显式 `--arms` 打开。

## 离线裁判（不是 challenger）

「裁判」只用于**测量**，不参与对局，也不会改写任何落点。当 Jev 的落点不等于 Local #1 时，
benchmark 用生产引擎的同一套原语对两个点各做一轮更深搜索：

```text
depth 7 / branch 6，保留 production 的 VCF/VCT 战术深度
先比 tactical safety 等级，再比 Alpha-Beta 分数
```

输出三个结果：`Jev 更优` / `Local 更优` / `持平`，聚合成 **改写质量**。
改判结论对深度敏感（实测 depth 5 与 depth 7 会给出不同结论），所以默认 depth 7，可用
`--arbitration-depth` 调整。

## 运行

```bash
export JEV_API_KEY='...'
npm run benchmark -- --seeds 6 --confirm-cost
```

规模更大的一轮：

```bash
npm run benchmark -- --seeds 12 --max-plies 60 --confirm-cost
```

不花钱、只用 mock Jev 验证管线（CI 用这个）：

```bash
npm run benchmark:mock
```

不调用 Jev，只验证 harness / 裁判 / Deep Worker 通路：

```bash
npm run benchmark:smoke
```

引擎回归（Jev 最终决策权、唯一候选短路、禁手一致性、裁判对称性）：

```bash
npm run benchmark:regression
```

> `--seeds N` = 使用前 N 个 opening，每个 opening 产生「arm 数量」局。
> `--seeds 6` + 默认两个 arm = 12 局。真实调用会产生费用，所以默认必须显式 `--confirm-cost`
> （或 `BENCHMARK_CONFIRM=1`，或 `--mock-jev`）。

### 常用参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `--seeds N` | 6 | opening 数量（1–12） |
| `--arms a,b` | `local,jev-final` | 被测 arm（白棋） |
| `--max-plies N` | 60 | 单局最大手数 |
| `--mode expert\|strong` | expert | 引擎档位 |
| `--arbitration-depth N` | 7 | 裁判深搜深度 |
| `--arbitration-branch N` | 6 | 裁判分支宽度 |
| `--no-arbitration` | 关 | 跳过裁判，只统计成本与契约 |
| `--deep-worker thread\|sync` | thread | `thread` 用 node worker_threads 复刻浏览器 Worker；`sync` 用引擎内同步回退（更慢、无预算） |
| `--mock-jev` | 关 | 离线确定性 mock，不发 API 请求 |
| `--model` | jev-latest | Jev 模型 |

## 运行时间参考

单局是**串行**跑的，每一手都要走完整的生产链路，所以时间开销不小：

| 场景 | 实测 |
|---|---|
| `benchmark:smoke` | 约 20s（含真实 Deep Worker 一次） |
| `benchmark:regression` | 约 12s |
| `benchmark:mock`（1 opening × 2 arm × 6 手） | 约 45s |
| 真实 Jev，expert 档，60 手一局 | 数分钟到十几分钟（含裁判与 API 延迟） |

建议先用 `--seeds 2` 验证通路，再跑 `--seeds 6`；`--seeds 12 --max-plies 60` 属于长跑，
建议放到 CI 手动触发里跑，并在本地先确认时长。若只想看成本与契约，加 `--no-arbitration` 会明显变快
（裁判是整条流程里最慢的一步）。

## 输出

```text
benchmark/results/latest.json
benchmark/results/latest.md
benchmark/results/<timestamp>.json
benchmark/results/<timestamp>.md
```

报告包含：

- 主结论表：W-L-D、得分率 + Wilson 95% CI、平均 / p95 决策耗时
- 配对比较：两个 arm 在同一对手、同一开局下的得分率差值与逐开局结果
- 决策质量：改写率、改写质量、漏必胜、自造必防
- 成本与调用契约：Jev 调用数、每手调用、0 调用回合、唯一候选回合、token
- 深搜与性能保护：completed / timeout / error / skipped(opening) 分布
- 契约校验：逐条列出违反承诺的回合
- Renju 禁手一致性：禁手替换次数、白棋非法落点、胜因分布
- 自动生成的优化方向

## 怎么看这份报告

1. **先看样本量。** 少于 12 局不要下棋力结论，五子棋单局方差很大。
2. **Jev Final 与 Local 的得分率差值**是主指标；CI 重叠就说明还没有结论。
3. **改写质量**比改写率重要。改写率高但质量低，说明 Jev 在降低棋力。
4. **漏必胜 / 自造必防**必须为 0。这两项大于 0 说明最终决策绕过了硬战术过滤，优先级高于一切调参。
5. **每局 Jev 调用与 token** 决定这个棋力增益值不值。
6. 黑棋参照的**禁手替换率**如果偏高，说明参照对手偏弱，结论要保守解读。

## 已知局限

- 生产引擎只有白棋座位，因此无法做真正的双向换色对局；黑棋是固定参照对手，不是同等强度的对手。
- 黑棋参照用颜色互换复用白棋引擎，互换后它看不到黑棋禁手，需要裁判逐点复核并可能替换落点；替换次数会单独统计。
- 判分依赖 opening 数量，12 个 opening 也只是小样本。
- 裁判本身也是有限视野搜索（默认 depth 7），只能作为代理指标，不是真值。
- `--mock-jev` 只是管线自检，不代表任何棋力结论。

Benchmark 不会输出或保存 `JEV_API_KEY`。
