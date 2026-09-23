# Jev Gomoku

> **让传统棋类搜索负责“算”，让 Jev 负责“判”。**

Jev Gomoku 是一个运行在浏览器中的 15×15 五子棋实验项目。

它并不是简单地“让一个 AI 看棋盘然后直接下一步棋”，而是尝试一种混合决策架构：

- **Alpha-Beta / Pattern / VCF / VCT / Threat-space / Deep Search** 负责搜索、证明、生成候选和战术证据。
- **Jev** 负责理解局面、独立评价候选、比较不同计划，并在多个搜索器意见不一致时做最终裁决。
- **确定性规则与战术证明** 拥有最高优先级，Jev 不能覆盖非法落子、禁手、立即胜负和已经证明的 forced result。

项目的核心问题不是“Jev 能不能替代五子棋引擎”，而是：

> **当浏览器里的传统搜索无法无限加深时，Jev 能否作为一个独立判断层，把多个有限搜索器的结果组合成更好的最终决策？**

---

## Jev 是什么？

[Jev](https://docs.typesafe.ai/introduction) 是 TypeSafe 的旗舰模型，也是其第一个 **System One model**。

与主要面向文本生成的传统 LLM 使用方式不同，Jev 的接口直接接收：

- **state**：当前状态；
- **typed questions**：结构化问题；

并直接返回：

- choice；
- probabilities；
- confidence；
- score / noul 等结构化结果。

也就是说，在这个项目里我们并不要求 Jev 输出一大段“棋局分析作文”，再从自然语言里解析一个坐标。

我们把棋盘、规则和本地搜索得到的证据组织成结构化状态，然后直接问：

> 在这些合法候选中，哪一步更值得下？

Jev 返回可以直接被程序消费的概率和选择结果。

官方文档：

- [TypeSafe / Jev Introduction](https://docs.typesafe.ai/introduction)
- [Quick Start](https://docs.typesafe.ai/introduction/quickstart)
- [Agent Skill](https://docs.typesafe.ai/agent-skill)

---

# Jev 在这个项目里做什么？

## 1. Jev 不是搜索器，而是决策层

传统五子棋引擎擅长：

- 枚举变化；
- Alpha-Beta 剪枝；
- 找立即胜；
- 找唯一防守；
- VCF / VCT；
- Threat-space forcing sequence；
- 判断禁手和合法性。

这些任务具有明确的组合搜索结构，非常适合确定性算法。

但浏览器环境里的搜索深度、分支数和运行时间都是有限的。

当几个候选都没有被证明为必胜或必败时，经常会出现：

- Local #1 和 Deep #1 不一致；
- Pattern 更喜欢进攻，但 Threat Search 认为防守更重要；
- 两步棋数值差异很小，但战略含义完全不同；
- 搜索 horizon 之外存在对手反击；
- 候选召回本身可能漏掉一手非典型好棋。

这正是 Jev 的位置。

**本地算法提供事实和候选，Jev 负责在“不确定但必须做决定”的区域进行判断。**

---

## 2. Jev 是 Local Engine 的独立 Challenger

如果直接告诉 Jev：

> Local Engine 认为 G8 排名第一，H7 排名第二。

那么 Jev 很容易被已有排名锚定。

因此 Jev Max 会刻意隐藏：

- local_rank；
- local_engine_grade。

Jev 只能看到：

- 当前棋盘；
- 规则；
- 候选坐标；
- 每个候选的战术事实；
- Deep / Threat / VCF / Pattern 等结构化证据。

然后重新独立判断。

因此 Jev 的价值不是“复述 Local Engine”，而是充当一个真正的 **challenger / second opinion**。

---

## 3. Jev 负责处理搜索器之间的分歧

一个候选可能同时具有：

- 更好的 Alpha-Beta score；
- 更差的 opponent best reply；
- 更强的局部进攻；
- 更高的 counter-threat 风险。

这些信息很难压缩成一个永远正确的手工权重公式。

Jev Max 会把这些异构证据组织成一个统一状态，让 Jev 判断：

- 哪一步真正更强；
- 哪一步只是数值看起来漂亮；
- 哪一步会把主动权过早花掉；
- 哪一步在对手最强回复之后仍然成立。

这里 Jev 更像一个**裁判层**，而不是另一个暴力搜索器。

---

## 4. Jev 负责寻找候选集中的盲点

主候选通常来自：

- Alpha-Beta；
- deeper-search seeds；
- Pattern Expert；
- defensive / counter-threat hotspots；
- VCF / VCT；
- Threat-space；
- strategic wildcard seed。

但任何 bounded search 都可能漏招。

所以 Jev 的 Atomic 阶段允许返回 **OTHER**。

这不是允许 Jev随意生成坐标，而是触发一个 bounded wildcard 流程：

1. 本地再召回 10–16 个额外合理合法点；
2. Jev 从中提出一个 wildcard；
3. wildcard 再经过合法性、禁手、立即败着、Threat proof 等校验；
4. 通过后才允许进入最终候选。

因此 Jev 可以帮助发现搜索盲点，但**不能绕过确定性安全边界**。

---

# 整体架构

~~~mermaid
flowchart TD
    A[15×15 Board] --> B[Rules / Legality]
    B --> C[Local Candidate Recall]

    C --> C1[Alpha-Beta]
    C --> C2[Pattern Expert]
    C --> C3[VCF / VCT]
    C --> C4[Deep Search Worker]
    C --> C5[Threat-space Worker]
    C --> C6[Defensive / Counter-threat Recall]

    C1 --> D[Candidate Universe]
    C2 --> D
    C3 --> D
    C4 --> D
    C5 --> D
    C6 --> D

    D --> E[Deterministic Proof Filter]

    E -->|forced / illegal| F[Hard Decision]
    E -->|unresolved candidates| G[Jev Atomic Evaluation]

    G --> H[Jev Pairwise Tournament]
    H --> I[Adversarial Critic]
    I --> J{High-confidence convergence?}

    J -->|Yes| K[Final Move]
    J -->|No| L[Jev Final Judge]
    L --> K

    G -->|OTHER| M[Bounded Wildcard Recall]
    M --> N[Local Threat Verification]
    N --> H
~~~

可以把它理解成三层：

| 层 | 负责什么 | 是否可被 Jev 覆盖 |
|---|---|---|
| **规则 / Proof 层** | 合法性、禁手、立即胜负、严格 VCF / Threat proof | **不可覆盖** |
| **搜索 / Evidence 层** | Alpha-Beta、Deep、Pattern、Threat、PV、opponent reply | 提供证据 |
| **Jev Decision 层** | 独立评价、候选比较、反驳、分歧裁决 | 只处理未被证明的区域 |

---

# Jev Max

**Jev Max** 是当前默认、也是最完整的混合决策模式。

它不是单次请求“问 Jev 下一步走哪里”，而是把决策拆成多个更小、更稳定的问题。

## Stage 0：本地搜索先做能确定的事情

在调用 Jev 前，本地引擎先完成：

- 合法点过滤；
- 黑棋长连 / 四四 / 三三禁手；
- immediate win；
- opponent immediate win；
- VCF / VCT；
- direct open-four / double-winning-point proof；
- Threat-space search；
- Deep iterative search；
- opponent best replies；
- candidate recall。

如果答案已经被严格证明，就直接落子。

**能用算法证明的事情，不浪费 Jev 请求。**

---

## Stage 1：Atomic Evaluation

Jev 对每个候选进行**独立评价**。

典型标签：

- EXCELLENT
- GOOD
- NEUTRAL
- RISKY
- BAD

每个候选单独判断，避免先看整体排名后产生跟随效应。

Atomic 阶段重点回答：

> 如果只看棋盘和这一步对应的事实，这一步本身怎么样？

Local 的排名不会发送给 Jev。

---

## Stage 2：Pairwise Tournament

Atomic Top 候选继续进入 Pairwise。

例如比较 G8 与 H7 时，会同时询问：

- G8 vs H7
- H7 vs G8

然后综合概率 margin。

这样做是为了降低选项展示顺序对结果的影响。

Pairwise 回答的是另一个问题：

> 当两个看起来都不错的候选必须二选一时，哪一个更值得下？

---

## Stage 2.5：Adversarial Critic

同一个阶段还会让 Jev 从“反方”视角检查候选：

- 是否存在 immediate tactical refutation；
- 是否有 forcing sequence；
- 是否留下 multi-axis counterattack；
- 对手被迫防守后，原来的威胁网络是否仍然存在；
- 是否过早消耗 forcing resource；
- 是否丢失主动权；
- 在 opponent best reply 之后是否仍然成立。

因此 Jev 不只是“选喜欢的棋”，还要尝试**推翻自己的候选**。

---

## Stage 3：Final Judge

如果 Atomic + Pairwise + Critic 已经高置信收敛，就直接结束。

只有仍然存在明显分歧时，才调用 Final Judge。

Final Judge 可以同时看到：

- Atomic 概率；
- Pairwise 结果；
- Critic；
- Deep PV；
- opponent best replies；
- Threat evidence；
- wildcard；
- deterministic proof 状态。

最终从经过安全验证的候选中选择落子。

正常 Jev Max 回合最多使用 **0–3 个逻辑 Jev 请求**。

---

# Jev 不能做什么？

为了避免“语义判断覆盖数学事实”，项目明确设置了硬边界。

Jev 不能覆盖：

1. 非法落子；
2. 已启用的黑棋禁手；
3. 当前立即取胜；
4. 对方下一手立即取胜时的唯一合法防守；
5. 已严格证明的 VCF / Threat-space forced result；
6. 已证明 forced-loss 的候选；
7. wildcard 的安全校验。

一个很重要的设计原则是：

> **Search 没有证明输，不等于证明安全。**

因此项目使用类似 **THREAT_SEARCH_NO_PROOF** 的语义，而不会把“搜索没找到问题”伪装成 SAFE。

---

# 为什么不是纯 Local？

纯本地搜索当然可以下五子棋，而且项目内部仍然保留完整 Local Engine。

问题在于浏览器不是围棋服务器或专用棋类引擎环境：

- CPU 核数有限；
- JavaScript 主线程不能长时间阻塞；
- Worker 数量需要控制；
- 搜索树指数爆炸；
- 更深搜索意味着明显更长等待时间；
- horizon problem 不会因为简单增加一点 depth 就彻底消失。

Jev Gomoku 的实验方向不是无限堆搜索深度，而是：

> **用 bounded deterministic search 找到“事实”，再让 Jev 在事实之上处理剩余的不确定性。**

---

# 为什么不是纯 Jev？

因为五子棋包含大量非常适合算法处理的确定性问题。

例如：

- 这一手是不是禁手？
- 有没有立即成五？
- 对手有没有一步杀？
- 这条 VCF 是否严格成立？
- 某个点是不是 forced loss？

这些事情不应该依赖语义模型“感觉”。

因此 Jev Gomoku 也不是一个纯神经模型棋手。

更准确地说，它是：

> **Search Engine + Tactical Proof System + Jev Decision Layer**

---

# 对局模式

| 模式 | Jev 的角色 |
|---|---|
| **Jev Max** | 多算法异构召回 → Atomic → Pairwise → Critic → 必要时 Final Judge |
| **Jev 宗师** | Deep / Threat 与本地搜索并行；证据一致时直接落子，分歧时 Jev 裁决 |
| **Jev 大师** | 深本地搜索生成高质量候选，由 Jev 做最终选择 |
| **Jev 直觉** | 更直接地让 Jev 从合法点判断，主要作为实验基线 |

纯 Local 不作为用户模式展示，但 Local Engine 始终存在：

- 负责候选和战术证据；
- 负责 hard proof；
- Jev 网络失败时自动接管当前回合。

---

# 浏览器性能设计

Jev Max 必须在普通浏览器中运行，因此所有昂贵步骤都有边界。

主要策略：

- 主线程只负责 UI、轻量计算、调度和结果整合；
- Heavy Worker 最多同时运行 **2 个**；
- 主候选通常限制在 **6–8 个**；
- Deep 只深入分析头部候选；
- Threat Search 使用 bounded budget；
- Pairwise 只比较 Atomic Top 候选；
- wildcard pool 有数量上限；
- Worker timeout 后不会回主线程同步补跑重型搜索；
- Jev 请求和缓存都有数量、TTL 和容量限制；
- Jev 不可用时 Local Engine 自动降级接管。

目标不是“搜索尽可能久”，而是让有限计算预算产生尽可能高的信息密度。

---

# 透明的 Jev 决策日志

每一局都可以复制完整棋谱。

除了普通落子记录，还会保存 Jev 的决策过程，包括：

- 候选来源；
- Local / Deep / Pattern / Threat 证据；
- Atomic label 与 probability；
- Pairwise 双向比较；
- Critic / refutation；
- Deep PV；
- opponent best replies；
- wildcard requested / proposed / accepted；
- Final choice / confidence；
- Jev 请求次数；
- token 使用量；
- Local / Deep / Threat / total think time；
- Worker timeout；
- payload token estimate；
- browser long-task。

这些日志可以直接用于：

- regression position；
- benchmark；
- 错误局面复盘；
- Jev vs Local 对比；
- 后续算法迭代。

---

# 五子棋规则

支持开局前配置：

- 玩家执黑 / 执白；
- 黑棋长连禁手；
- 黑棋四四禁手；
- 黑棋三三禁手。

当长连禁手开启时：

- 黑棋必须**恰好五连**获胜；
- 白棋五连及以上获胜。

关闭长连禁手后，黑棋也可以五连及以上获胜。

---

# Jev 请求架构

浏览器不会直接访问 TypeSafe API。

~~~text
Browser
   │
   │ POST /api/jev
   ▼
Same-origin Server
   │
   │ Authorization: Bearer JEV_API_KEY
   ▼
TypeSafe System One
https://api.typesafe.ai/v1/systemone
~~~

API Key 只存在服务端环境变量：

~~~bash
JEV_API_KEY=...
~~~

不会写入：

- 浏览器 JS；
- HTML；
- localStorage；
- 棋谱；
- 前端日志。

服务端同时负责 429 / 529 的 Retry-After 与指数退避。

---

# 本地运行

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

包括：

- JavaScript syntax check；
- benchmark smoke；
- regression；
- Jev mock benchmark；
- production build。

---

# Benchmark

项目保留多个 benchmark arm，用于区分：

- Local baseline；
- Jev final decision；
- Jev Max。

常用命令：

~~~bash
npm run benchmark:smoke
npm run benchmark:regression
npm run benchmark:mock
~~~

真实 Jev benchmark：

~~~bash
export JEV_API_KEY='...'
npm run benchmark -- --seeds 6 --confirm-cost
~~~

重点观察：

- W / L / D；
- Jev override Local #1；
- deeper-search hindsight；
- Atomic / Pairwise consistency；
- Final 与 Local / Deep 的一致率；
- wildcard 效果；
- VCF / Threat hard filter；
- Jev 请求数与 token；
- Local / Deep / Threat 分阶段耗时；
- Worker timeout；
- tactical error；
- contract violation。

详见 [benchmark/README.md](benchmark/README.md)。

---

# 项目目标

Jev Gomoku 并不试图证明“Jev 比传统棋类引擎更强”。

它更关注一个通用的软件架构问题：

> **当一个问题同时包含“可计算的确定性部分”和“难以用固定规则表达的判断部分”时，应该如何把传统算法与结构化 AI 决策模型组合起来？**

在这个项目里：

- Alpha-Beta 是搜索器；
- VCF / VCT / Threat-space 是战术证明器；
- Pattern / Deep Worker 是证据生成器；
- Jev 是独立判断者与分歧裁决者；
- deterministic proof 是最终安全边界。

五子棋只是这个架构最直观的实验场。

如果这种模式有效，它同样可以迁移到：

- Agent tool routing；
- 多模型候选裁决；
- 风险判断；
- 推荐系统 rerank；
- 规则系统 + AI 混合决策；
- 多算法 ensemble。

---

## 核心思想

~~~text
不要让 Jev 替代算法。

让算法负责它能证明的部分，
让 Jev 负责算法无法可靠排序的部分。

Search for facts.
Jev for judgment.
Proof wins.
~~~
