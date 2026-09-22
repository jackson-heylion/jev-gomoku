# Benchmark

用于比较三种决策架构：

- **Local**：只使用当前生产版的本地 Alpha-Beta + VCF/VCT 引擎。
- **Jev Blind**：不看 Local 候选和评分，Jev 直接根据完整棋盘和所有合法落点选棋。
- **Hybrid**：Local 负责候选过滤、战术分析与深搜证据，Jev 在过滤后的候选集中做最终落子决定。

Benchmark 会让三种引擎两两自动对战，并对同一 opening 交换黑白，降低五子棋先手优势对结果的干扰。

## 为什么不是另写一套引擎

`benchmark/harness.mjs` 会直接加载当前的 `src/app.js`，把生产版 Local / Hybrid 决策函数暴露给 Benchmark。

生产引擎原本按白棋视角实现。Benchmark 在黑棋回合只交换黑白棋颜色，再调用同一套生产逻辑，因此不会维护另一份容易漂移的搜索实现。

## 运行

先设置 TypeSafe Key：

```bash
export JEV_API_KEY='...'
```

最小测试：

```bash
npm run benchmark -- --seeds 1 --confirm-cost
```

更有参考价值的测试：

```bash
npm run benchmark -- --seeds 3 --max-moves 60 --confirm-cost
```

`--seeds 3` 会使用 3 组 opening。每组 opening 都会运行：

- Local vs Jev Blind，交换黑白
- Local vs Hybrid，交换黑白
- Jev Blind vs Hybrid，交换黑白

因此总局数为：

```text
3 pairings × 2 colors × seed count
```

例如 `--seeds 3` 共 18 局。

> Benchmark 会产生真实 Jev API 调用和 Token 消耗，所以默认必须显式传 `--confirm-cost`。

## Smoke test

不调用 Jev，只验证 Benchmark 能成功加载生产引擎并完成合法的 Local 决策：

```bash
npm run benchmark:smoke
```

CI 会自动执行这个 smoke test。

## 输出

默认生成：

```text
benchmark/results/latest.json
benchmark/results/latest.md
benchmark/results/<timestamp>.json
benchmark/results/<timestamp>.md
```

报告包含：

- 三引擎胜 / 负 / 和
- 交换黑白后的 pairwise 结果
- 平均决策延迟
- Jev 实际参与回合
- TypeSafe 上游尝试次数
- input / output token
- 漏立即取胜
- 给对手留下立即取胜点
- Jev / Local 分歧率
- Hybrid 最终改写 Local 的比例
- Blind 是否经常选到 Local 候选集之外
- 自动生成的优化方向

## 重点观察

最值得看的不是简单总胜率，而是：

1. **Hybrid vs Local 换色后的得分率**：判断 Jev 是否真的带来棋力增益。
2. **Jev 与 Local 的分歧率**：判断 Jev 有没有提供不同信息。
3. **Hybrid override rate**：Jev 最终选择与 Local #1 不同时，实际改写 Local 的比例。
4. **战术错误率**：是否漏必胜、漏必防。
5. **每局 Jev 调用与 Token**：衡量棋力增益是否值得成本。
6. **Blind 在 Local 候选集之外的落子**：用于发现候选生成器可能漏掉的好手。\n\n当前 Hybrid 的决策权约定：Local 决定哪些候选可以进入最终决策，并提供 Alpha-Beta、VCF/VCT、战术安全和深搜证据；候选数大于 1 时，每个回合只向 Jev 发起一次请求，由 `answers.best_move.choice` 直接决定最终落子。

Benchmark 不会输出或保存 `JEV_API_KEY`。
