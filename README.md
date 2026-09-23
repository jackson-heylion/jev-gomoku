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

    C --> C1[Alpha-Beta<br/>Zobrist + bounded TT + PV ordering]
    C --> C2[Pattern Expert]
    C --> C3[VCF / VCT]
    C --> C4[Persistent Deep Worker]
    C --> C5[Persistent Threat Worker]
    C --> C6[Defensive / Counter-threat Recall]

    C1 --> D[6–8 Candidate Universe]
    C2 --> D
    C3 --> D
    C4 --> D
    C5 --> D
    C6 --> D

    D --> E[Deterministic Proof Filter]
    E -->|forced / illegal| F[Hard Decision]
    E -->|unresolved| G[Request 1: Speculative Fan-Out]

    G --> G1[Atomic: all main candidates]
    G --> G2[Pairwise: likely Top ≤6]
    G --> G3[Critic: likely Top ≤6]
    G --> G4[Global Best]
    G --> G5[Recall / Wildcard proposal]

    G1 --> H[Apply Atomic Top4 + Threat coverage]
    G2 --> H
    G3 --> H
    G4 --> H
    G5 --> H

    H --> I{High-confidence convergence?}
    I -->|Yes| J[Final Move]
    I -->|No / finalist pool changed| K[Request 2: Final or Resolution Fan-Out]
    K --> J

    C4 -. first idle slot .-> T[Speculative tail Threat validation]
    C5 -. first idle slot .-> T
    T --> H
~~~

可以把它理解成三层：

| 层 | 负责什么 | 是否可被 Jev 覆盖 |
|---|---|---|
| **规则 / Proof 层** | 合法性、禁手、立即胜负、严格 VCF / Threat proof | **不可覆盖** |
| **搜索 / Evidence 层** | Alpha-Beta、Deep、Pattern、Threat、PV、opponent reply | 提供证据 |
| **Jev Decision 层** | Atomic、Pairwise、Critic、独立 Global Best、必要时最终裁决 | 只处理未被证明的区域 |

---

# Jev Max

**Jev Max** 是当前默认、也是最完整的混合决策模式。

核心目标不是减少搜索深度，而是减少**重复计算和串行等待**：相同的棋力证据尽量并行产生，同一批 Jev 独立问题尽量在一次 System One 请求中 fan-out。

## Stage 0：确定性搜索与 Proof

在调用 Jev 前，本地引擎继续完成：

- 合法点过滤与黑棋禁手；
- immediate win / mandatory defense；
- VCF / VCT；
- direct open-four / double-winning-point proof；
- Threat-space search；
- Deep iterative search；
- opponent best replies；
- heterogeneous candidate recall。

严格 proof 已经给出唯一答案时直接落子，仍然是 **0 次 Jev 请求**。

### Alpha-Beta 性能层

主线程 Alpha-Beta 现在使用：

- 双 32-bit Zobrist incremental hash；
- EXACT / LOWER / UPPER transposition-table entry；
- 同一次 iterative deepening 跨 depth 复用 TT；
- 上一层 root/PV 排序；
- TT bestMove 优先搜索；
- bounded TT 跨回合复用，保留最近 generation，优先淘汰浅层和旧条目。

这些优化不降低搜索 depth、branch 或战术候选范围，目标是让相同预算搜索更多有效节点。

Deep Worker 侧同样保留 Zobrist TT，并在长驻 Worker 生命周期内跨任务复用 bounded TT。

---

## Stage 0.5：两个长驻 Heavy Worker

浏览器不再每个阶段反复创建和销毁 Worker。

整局维持最多 **2 个**长驻 Worker slot：

- Deep Search；
- Threat-space Search；
- supplemental Threat；
- wildcard / rescue Threat。

任务进入统一队列；正常完成后 Worker 保留，timeout / crash 才销毁对应 slot 并按需重建。

Jev Max 启动 Deep + Threat 后，会把最多 2 个未被首轮 Threat 覆盖的 tail candidate 提前排进队列。只要 Deep 或 Threat 任一先结束，空闲 slot 就开始计算 tail Threat。Atomic 后若 #7/#8 晋级，通常可以直接复用已经完成的结果，而不是再串行等待一次 supplemental Worker。

---

## Stage 1：Speculative Fan-Out

普通 Max 不再先发 Atomic、等响应、再发 Pairwise/Critic。

**Request 1** 同时包含：

- Atomic：全部主候选，最多 8；
- Pairwise：最可能进入决赛的前 ≤6 个候选，双向比较；
- Critic：同一 speculative pool；
- global_best：独立全局最佳判断；
- recall_check；
- bounded wildcard proposal。

共享的棋盘、candidate facts、Pairwise policy、Critic policy 只发送一次；各问题只引用共享 state，减少重复 payload。

收到响应后，程序才根据 Atomic + deterministic Threat coverage 确定实际 Top4。只有仍然合法、未被 hard proof 排除的 Pairwise/Critic 回答会被消费，其余 speculative answer 直接丢弃。

这属于**多算少等**：不减少判断维度，而是消除 API round-trip barrier。

---

## Stage 2：本地收敛或第 2 次裁决

如果实际 Atomic Top4 落在 speculative pool 内，则直接复用 Request 1 已返回的双向 Pairwise 与 Critic。

当以下信号形成高置信一致时，可以在 **1 次 Jev 请求**后直接落子：

- Pairwise Top1；
- Atomic 强度；
- Critic 生存概率；
- 独立 global_best；
- deterministic Deep / Threat evidence。

如果存在明显分歧、validated wildcard 进入 finalist，或 Atomic 将决赛池改写到 speculative pool 之外，才使用 **Request 2**：

- 普通分歧：Final Judge；
- 决赛池被改写：Resolution Fan-Out，在同一请求中补齐实际 Top4 的 Pairwise/Critic，并附带最终 best_move。

因此正常 Jev Max 回合现在是：

~~~text
严格确定性局面：0 请求
普通未决局面：1 请求
困难 / 分歧局面：2 请求
~~~

**硬上限从原来的 3 次降为 2 次。**

Wildcard、rescue、VCF、Threat proof 的安全边界保持不变。

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
- Heavy Worker 最多同时运行 **2 个**，并使用整局长驻 Worker Pool；
- 主线程 Alpha-Beta 使用 incremental Zobrist + bounded persistent TT + PV/TT best-move ordering；
- Deep Worker 的 bounded TT 在 Worker 生命周期内跨回合复用；
- 主候选通常限制在 **6–8 个**；
- Deep 只深入分析头部候选；
- Threat Search 使用 bounded budget，并利用空闲 Worker 对 tail candidate 做 speculative validation；
- Request 1 对 likely Top ≤6 预计算 Pairwise/Critic，但实际只消费最终 Top4 对应结果；
- shared board / candidate facts / policy 只发送一次，避免每个问题重复长说明；
- wildcard pool 有数量上限；
- Worker timeout 后不会回主线程同步补跑重型搜索；
- Jev Max 每回合最多 **2 次**逻辑请求；确定性唯一解为 0 次；
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
