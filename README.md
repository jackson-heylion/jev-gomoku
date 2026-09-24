# Jev Gomoku

**中文** | [English](README.en.md)

> **算法负责“算”，JEV 负责“判”，Proof 拥有最终事实权。**

Jev Gomoku 是一个运行在浏览器中的 15×15 五子棋实验项目，用来研究 **传统搜索算法 + JEV / TypeSafe System One** 应该怎样组合。

它不是：

> “把棋盘扔给 AI，让 AI 凭感觉下一步。”

现在的核心架构是：

- **确定性代码**负责合法性、禁手、立即胜负、唯一防守和已经证明的战术结论；
- **Alpha-Beta / Pattern / VCF / VCT / Deep Search / Threat-space** 负责搜索、召回候选和产生证据；
- **JEV** 只在“几个候选都还活着、传统算法意见又不一致”的区域做独立判断和最终裁决；
- JEV 真正推翻强 Local 基线时，还会再经过一层窄化深搜校验。

一句话：

> **能算清楚的不要交给 JEV；算不死、但必须选一个的，再让 JEV 判断。**

## 这个项目真正想验证什么

重点不是：

> “JEV 能不能替代五子棋引擎？”

而是：

> **一个软件问题里，如果同时存在“可确定计算的部分”和“很难写死规则的判断部分”，能不能让代码负责事实、JEV 负责最后的模糊决策？**

五子棋很适合做这个实验，因为输赢和错误都很直观：

- 非法就是非法；
- 一步成五可以证明；
- 很多强制杀可以搜索；
- 但几个“都没被证明输”的候选，战略价值可能很难靠固定权重排清；
- 浏览器算力有限，又不可能无限深搜。

这正好把 JEV 的边界暴露出来。

## 当前架构

~~~mermaid
flowchart TD
    A[15×15 棋盘] --> B[规则 / 合法性]
    B --> C[本地候选召回]

    C --> C1[Alpha-Beta]
    C --> C2[Pattern]
    C --> C3[VCF / VCT]
    C --> C4[Deep Worker]
    C --> C5[Threat-space]
    C --> C6[防守 / Wildcard 召回]

    C1 --> D[6–8 个候选]
    C2 --> D
    C3 --> D
    C4 --> D
    C5 --> D
    C6 --> D

    D --> E[确定性 Proof 过滤]
    E -->|已有唯一答案| F[最终落子]
    E -->|仍未决| G[JEV Speculative Fan-Out]

    G --> G1[Atomic]
    G --> G2[Pairwise]
    G --> G3[Critic]
    G --> G4[Global Best]
    G --> G5[Recall Check]

    G1 --> H[收敛 / 决赛候选]
    G2 --> H
    G3 --> H
    G4 --> H
    G5 --> H

    H --> I{是否高置信一致?}
    I -->|是| J[JEV 语义选择]
    I -->|否| K[Final / Resolution Request]
    K --> J

    J --> L[Semantic Override Guard]
    L --> F
~~~

### 三层职责

| 层 | 负责什么 | JEV 能否覆盖 |
|---|---|---|
| **规则 / Proof 层** | 合法性、禁手、立即胜、唯一防守、已证明 VCF / Threat 结果 | **不能** |
| **搜索 / Evidence 层** | Alpha-Beta、Pattern、Deep、PV、对手最佳回复、Threat | 只提供证据 |
| **JEV Decision 层** | Atomic、Pairwise、Critic、Global Best、最终未决裁决 | 只在安全候选集内决定 |

## JEV 在这里到底做什么

### 1. 独立 Challenger

JEV Max 会刻意区分：

- **候选召回顺序**；
- 真正的 **Alpha-Beta Local #1**。

Atomic 阶段不会简单告诉 JEV：

> “Local 觉得 A 第一。”

而是尽量给它棋盘和结构化证据，让它形成真正的 second opinion。

否则 JEV 很容易只是跟着 Local 排名走，失去独立判断价值。

### 2. 候选裁决器

JEV 最适合面对的是这种局面：

~~~text
A：Local 分高，但 Deep PV 一般
B：Local 略低，但 Threat 结构更主动
C：Pattern 很漂亮，但对手最佳回复后风险偏高
D：几个算法意见完全分裂
~~~

而这些候选都已经：

- 合法；
- 没有被 hard proof 判输；
- 做过相对一致的 Threat / Deep 检查。

这时再让 JEV 判断：

> 综合这些证据，到底下哪一个？

这比让它从 225 个格子里自由“想一步”靠谱得多。

### 3. 多视角裁决，而不是只问一句

JEV Max 的第一次请求可以并行问多个角度：

- **Atomic**：单独看每个候选强不强；
- **Pairwise**：A 和 B 正面对比谁更好；
- **Critic**：专门挑毛病，看对手最佳回复后还能不能活；
- **Global Best**：独立再选一次最佳；
- **Recall Check**：主候选是不是可能漏招。

如果几个视角收敛，1 次请求就落子。

如果出现明显分歧，才进入第 2 次 Final / Resolution 裁决。

### 4. 可以提醒“可能漏招”，但不能乱编

JEV 可以通过 \`OTHER\` 提醒：

> 主候选集可能漏了好棋。

但程序不会让它随便生成一个坐标直接下。

流程是：

1. 本地再召回一个有数量上限的 wildcard pool；
2. JEV 只能从池里挑；
3. 再过合法性、禁手、一手败着、Threat proof；
4. 通过后才能进入最终候选。

所以它更像：

> **召回补充触发器 + reranker**

而不是自由生成器。

## JEV 不能推翻什么

JEV 没有权力覆盖：

1. 非法落子；
2. 已开启的黑棋禁手；
3. 当前立即取胜；
4. 对方下一手立即赢时的唯一合法防守；
5. 已严格证明的 VCF / Threat-space forced result；
6. 已被证明 forced-loss 的候选；
7. wildcard 的确定性安全校验。

项目里一个很重要的原则是：

> **没有搜到证明，不等于已经证明安全。**

所以 timeout、搜索未完成、\`NO_PROOF\` 都不会被偷换成 \`SAFE\`。

## Semantic Override Guard

历史真实棋谱重放暴露过一个典型问题：

> JEV 有时会把 Local #1 推翻成一手“战略上说得通”，但更深搜索明显更差的棋。

现在的处理非常克制：

- JEV 仍然能看到完整安全候选集；
- Local #1 不会提前绑架 JEV；
- 只有 **JEV 最终真的要推翻实际 Alpha-Beta Local #1** 时才触发 guard；
- 优先复用已有 Deep evidence；
- 证据仍不够时，只对“Local #1 vs JEV 最终点”做两点窄化 Worker 深搜；
- 最新策略在仍模糊时可以直接跳到 **exact depth 8**；
- 已经被 deterministic proof 淘汰的 Local 绝对不会被“复活”；
- 只有巨大、明显灾难性的深搜分差才 veto，普通分歧仍交给 JEV。

也就是说：

> **JEV 可以挑战 Local，但挑战也要接受事实校验。**

## Jev Max 请求上限

当前目标：

~~~text
确定性唯一解：0 次 JEV 请求
普通未决局面：1 次
困难 / 分歧局面：2 次
~~~

Jev Max 每回合逻辑请求硬上限是 **2**。

浏览器重型 Worker 并发同样限制在 **2**。

## 对局模式

| 模式 | JEV 的角色 |
|---|---|
| **Jev Max** | 异构召回 → Deep/Threat → Atomic/Pairwise/Critic → 必要时 Final |
| **Jev 宗师** | 战术/深搜先提供证据，出现分歧时 JEV 裁决 |
| **Jev 大师** | 高强度本地搜索生成候选，由 JEV 做最终语义选择 |
| **Jev 直觉** | 更直接让 JEV 从合法点选择，主要作为实验基线 |

纯 Local 不再作为普通用户模式展示，但一直存在于内部：

- 搜索；
- hard proof；
- JEV 不可用时降级接管；
- benchmark 对照组。

## 五子棋 / Renju 配置

开局前可以配置：

- 玩家执黑 / 执白；
- 黑棋长连禁手；
- 黑棋四四禁手；
- 黑棋三三禁手。

长连禁手开启时：

- 黑棋必须**恰好五连**获胜；
- 白棋五连及以上获胜。

## 浏览器性能设计

这个项目明确接受一个现实：

> 浏览器不是专用棋类服务器。

所以所有重活都有边界：

- Deep / Threat 放到 Web Worker；
- 重型 Worker 最多 2 个；
- Worker 整局长驻复用，不每阶段反复创建；
- Alpha-Beta 使用 incremental Zobrist；
- bounded TT 跨 iterative depth / 最近 generation 复用；
- 主候选维持小集合；
- Deep / Threat 只分析候选前沿；
- JEV 多问题共享同一份 board / facts / policy；
- timeout 后 fail-closed，不回主线程同步补跑重型搜索。

目标不是“搜得越久越强”，而是：

> **让有限浏览器预算产生尽量高的信息密度。**

## 完整决策日志

复制棋谱时可以带上：

- 候选来源；
- Local / Deep / Pattern / Threat 证据；
- Atomic；
- Pairwise；
- Critic；
- Deep PV；
- 对手最佳回复；
- wildcard 请求 / 提议 / 校验；
- JEV 最终建议；
- Semantic Override Guard；
- JEV 请求次数和 token；
- Local / Deep / Threat / 总耗时；
- Worker timeout；
- payload telemetry。

这些真实棋谱会继续反过来变成 regression case。

## Benchmark

仓库保留多条对照链：

| Arm | 作用 |
|---|---|
| \`local\` | 确定性基线 / fallback |
| \`jev-final\` | Local/Deep 提供证据 → JEV 做一次最终裁决 |
| \`jev-max\` | 当前完整有界多阶段架构 |
| \`jev-blind\` | JEV 直接面对较宽合法集的诊断基线 |

离线检查：

~~~bash
npm run benchmark:smoke
npm run benchmark:regression
npm run benchmark:mock
~~~

真实 JEV benchmark 会产生费用，需要显式确认：

~~~bash
export JEV_API_KEY='...'
npm run benchmark -- --seeds 6 --confirm-cost
~~~

历史真实棋谱重放：

~~~bash
BENCHMARK_CONFIRM=1 JEV_API_KEY='...' npm run benchmark:historical:real
~~~

完整契约和历史棋谱族说明见：

**[benchmark/README.md](benchmark/README.md)**

## 目前对 JEV × 五子棋的结论

### JEV 直接替代棋类搜索：不适合

五子棋里太多问题是组合搜索和严格 proof。

合法性、强制线、禁手、立即杀都应该让算法做。

### JEV 做候选最终裁决：适合

当程序已经把棋盘压缩成少量：

- 合法；
- 没有被证明输；
- 带结构化证据；

的候选时，JEV 的 choice / score / probability 形态非常匹配。

### JEV 做“混合智能架构”实验：很适合

真正可迁移的不是某一套五子棋棋型，而是：

~~~text
Hard Rules
+ Bounded Search
+ Multiple Evidence Producers
+ JEV Arbitration
+ Post-decision Verification
~~~

## 从五子棋往其他场景看

比较值得继续观察的 JEV 场景，通常都有一个共同点：

> **事实已经被程序整理好了，但最后那几个选项很难靠固定 if/else 排清。**

例如：

- 工单分类、优先级和路由；
- Agent 执行结果审查 / 升级人工；
- 多模型、多算法结果裁决；
- 推荐 / 搜索 rerank；
- 对账异常、业务异常的原因分流；
- 有确定性 policy 兜底的风险审核；
- 候选集有限的低延迟实时控制。

相反，这些事情不应该优先交给 JEV：

- 长文本生成；
- 精确金额计算；
- 权限判断；
- 会计规则；
- 可以简单用代码确定的条件；
- 需要很深顺序搜索但又没有外部验证的任务。

完整复盘、**开始整理时全部 146 条提交记录**、适配分析和其他应用观察见：

**[JEV × 五子棋：完整实验复盘](docs/JEV-RETROSPECTIVE.md)**

## JEV / TypeSafe

JEV 是 TypeSafe 的 System One Model。

它的使用方式不是让模型自由输出一大段文字，而是：

- 输入 \`state\`；
- 同时输入多个 typed questions；
- 使用 Choice / Score / Noul；
- 返回结构化答案、概率和置信信息。

官方资料：

- [TypeSafe Quick Start](https://docs.typesafe.ai/introduction/quickstart)
- [TypeSafe Agent Skill](https://docs.typesafe.ai/agent-skill)
- [Introducing System One Models & Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev)

厂商公开的性能、成本和 demo 适合作为方向参考；真正用于业务前，仍然应该用自己的数据、网络环境和错误成本重新测。

## 请求与密钥架构

浏览器不会直接访问 TypeSafe：

~~~text
Browser
   │ POST /api/jev
   ▼
Same-origin Server
   │ Authorization: Bearer JEV_API_KEY
   ▼
TypeSafe /v1/systemone
~~~

\`JEV_API_KEY\` 只存在服务端环境变量，不会进入：

- 浏览器 JS；
- HTML；
- localStorage；
- 棋谱；
- 前端日志。

## 本地运行

要求 Node.js >= 22.13。

~~~bash
npm install
export JEV_API_KEY='your-api-key'
npm run dev
~~~

完整检查：

~~~bash
npm run check
~~~

包括语法检查、benchmark smoke/regression/mock 和 production build。

## 仓库入口

- 主程序：\`src/app.js\`
- JEV Client：\`src/jev-client.js\`
- Deep Worker：\`public/deep-worker.js\`
- Benchmark：\`benchmark/\`
- 完整实验复盘：\`docs/JEV-RETROSPECTIVE.md\`

---

## 核心思想

> 不要让 JEV 替代算法。  
> 算法负责它能证明的部分。  
> JEV 负责几个合理答案之间难写死规则的判断。  
> 最终事实边界仍然掌握在确定性代码手里。
