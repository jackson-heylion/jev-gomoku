# JEV × 五子棋：从 146 次提交看它到底适合做什么

> 本文是对 **Jev Gomoku** 的一次阶段性复盘。  
> 历史统计基线：从仓库初始化提交 `20866827` 到 `907ac552`，共 **146 条提交**。  
> 本文由这 146 条既有提交整理而来；为了避免“文档提交把自己也算进去”的递归问题，本次新增文档本身不计入下面的历史统计。

## 先说结论

说人话：

> **JEV 不适合替代五子棋搜索引擎，但很适合做“最后那层判断”。**

五子棋里有两类问题：

1. **能算清楚的**：有没有立即成五、是不是禁手、对手有没有一手杀、VCF/VCT 是否成立、某条强制线是不是必输。
2. **一时算不清楚但必须选一个的**：几个候选都没被证明输，Local、Deep、Pattern、Threat 给出的意见又不一致，到底选谁。

第一类问题应该交给确定性代码和搜索。

第二类问题，才是 JEV 真正有价值的地方。

当前仓库最终形成的架构，本质上不是“JEV 下五子棋”，而是：

~~~text
本地算法负责找候选 + 搜索 + 证明
              ↓
把事实整理成结构化状态
              ↓
JEV 对未决候选做 Atomic / Pairwise / Critic / Global Best 判断
              ↓
确定性安全边界再兜底
              ↓
最终落子
~~~

如果只追求“做一个尽可能强的五子棋引擎”，继续加深专用搜索、棋型库、开局库甚至换成熟棋类引擎，通常比引入 JEV 更直接。

但如果目的是研究：

> **“传统算法能证明一部分，剩下难写规则的部分交给结构化 AI 判断”**

那么五子棋是一个非常好的实验场。

---

## 1. 这 146 次提交到底做了什么

仓库在很短时间内快速演化。

按 GitHub API 的 author date（UTC）统计：

| 日期 | 提交数 |
|---|---:|
| 2026-09-22 | 123 |
| 2026-09-23 | 12 |
| 2026-09-24 | 11 |
| **合计** | **146** |

按提交前缀粗略分类：

| 类型 | 数量 | 主要内容 |
|---|---:|---|
| UI | 28 | 棋盘、状态、等级、结果弹窗、决策展示 |
| build | 26 | V3 拼装、Vite、Sites/Worker 构建 |
| fix | 20 | 实战败局、Threat 漏洞、崩溃、悔棋、语义覆盖安全 |
| test | 13 | 回归、真实棋谱固定局面、Worker/超时 |
| docs | 10 | README、架构、benchmark 说明 |
| feat | 10 | Jev Max、宗师、禁手、rescue 等 |
| bench | 8 | Local/JEV/JEV Max 对比与历史重放 |
| engine | 5 | challenger、Deep Worker、战术检测 |
| 其余 | 26 | style / ci / security / refactor / perf / chore / 无前缀 |

最值得看的不是数量，而是**方向变化**。

### 阶段 A：先把一个“能玩的 JEV 五子棋”跑起来

最早一批提交主要在做：

- V3 游戏主体；
- HTML / JS / CSS 拼装；
- 浏览器运行；
- Mac 启动脚本；
- 基础 JEV 调用。

这时的核心思路比较直接：

> 有棋盘 → 把状态给 JEV → JEV 选一步。

它能工作，但很快暴露了棋类问题的本质：**五子棋不是普通分类题，局面里有大量必须严格计算的战术事实。**

### 阶段 B：前端拆分、棋谱和 JEV 决策过程可观察

随后开始把大 HTML 拆开，并加入：

- JEV 每阶段的决策记录；
- 一键复制棋谱；
- 人类可读的 JEV 解释；
- 对局结束弹窗；
- 后续的思考状态、耗时、彩蛋等。

这个阶段非常重要，因为没有 trace，就只能知道“输了”，不知道：

- 候选是谁提供的；
- JEV 看到了什么；
- JEV 为什么推翻 Local；
- 是候选召回漏了，还是判断错了；
- 是 Threat proof 漏了，还是 Worker 超时了。

后面的绝大多数优化，都是靠这些真实棋谱反推出来的。

### 阶段 C：从浏览器直连，改成同源服务端代理

一开始尝试过浏览器直接访问 TypeSafe，随后很快转成：

~~~text
Browser
  ↓ POST /api/jev
Same-origin server
  ↓ Bearer JEV_API_KEY
TypeSafe System One
~~~

相关提交解决了：

- CORS；
- API Key 不下发浏览器；
- ChatGPT Sites / Cloudflare Worker 构建；
- 429 / 529 重试；
- 本地开发和线上架构一致。

这个方向后来证明是正确的：**模型调用属于服务端能力，前端不应该持有密钥。**

### 阶段 D：JEV 从“主角”变成“独立 Challenger”

这是项目第一次真正改变架构的地方。

提交 `376109f3` 明确把 JEV 做成 **independent challenger**：

- Local Engine 自己算；
- JEV 不直接照抄 Local 排名；
- 后台 Deep Search 再提供第二份证据；
- 最后处理分歧。

同时加入：

- 真实败局 regression；
- depth-7 诊断；
- horizon rescue；
- 对手 double-threat creator 检测。

这一步之后，JEV 不再只是“会下棋的 API”，而开始变成**多算法之间的裁判层**。

### 阶段 E：浏览器性能逼着架构做工程化

为了提高棋力，一度把更重的 horizon search 放进浏览器，随后出现页面崩溃，提交 `01f0ed94` 直接回滚。

之后换成更合理的方案：

- Deep Search 放 Web Worker；
- Worker 不可用时快速降级；
- timeout 不能回主线程继续做重活；
- CI 确保 Worker 被正确打包；
- 后来进一步变成长驻 Worker Pool；
- TT / Zobrist / PV ordering 做复用。

这里得到一个很现实的结论：

> **棋力不是“算法越多越好”，而是单位浏览器预算里能产生多少有效证据。**

### 阶段 F：明确“JEV 做最终决定”，但不能推翻数学事实

提交 `9a6ee3dc` 把 JEV 提升成最终落子决策者。

紧接着加入：

- Renju 禁手；
- 玩家执黑/执白；
- 长连、四四、三三配置；
- 悔棋修复；
- token 降低；
- cache 有界化；
- 重复对局多样性；
- Grandmaster Threat Search。

此时逐渐形成一条关键原则：

> **JEV 有最终语义决策权，但没有推翻 legality / forced proof 的权力。**

这也是现在架构最重要的边界。

### 阶段 G：JEV Max——从“一次选择”变成多视角裁决

`c8701286` 开始引入 Jev Max。

JEV Max 不是简单问一句“哪个最好”，而是把同一组候选拆成多个问题：

- **Atomic**：单独看每一步值不值得下；
- **Pairwise**：A 和 B 正面对比；
- **Critic**：专门找这一步最可能怎么崩；
- **Global Best**：独立再选一次全局最佳；
- **Recall Check**：主候选是否可能漏招；
- **Wildcard**：必要时从额外候选池补一个点。

这种设计的价值是：

> 不指望一次问法永远正确，而是让 JEV 从几个不同角度判断，再看是否收敛。

同时又做了严格限制：

- 主候选通常最多 8；
- Pairwise/Critic 有上限；
- Worker 并发最多 2；
- Jev Max 每回合最多 2 个逻辑请求；
- 确定性唯一解时 0 请求。

### 阶段 H：真实败局不断暴露“AI 看起来合理，但棋上就是错”

Jev Max 上线后，真实棋谱继续暴露问题：

- counter-threat 没看完整；
- wildcard 绕过 Threat proof；
- Atomic 把没做同等 Threat 检查的尾部候选抬进 Top4；
- all-main-loss 时还在继续做 Pairwise，浪费请求；
- 一手 double-ended open-four 没被硬拦；
- DOUBLE_OPEN_THREE 在早期局面必须更谨慎。

这些修复非常说明问题：

> **JEV 不是因为输出是结构化的，就自动变成棋类证明器。**

它仍然会做出“语义上看起来不错、战术上直接输”的选择。

所以项目越来越多地把**可证明的风险提前变成代码过滤器**。

### 阶段 I：性能优化不是少算，而是“并行、多算少等”

`acb65cac` 之后，Jev Max 重点优化延迟：

- Zobrist + bounded persistent TT；
- iterative deepening 复用；
- persistent Deep / Threat Worker；
- Request 1 speculative fan-out；
- shared state 去重；
- 第一次请求里提前把可能需要的 Pairwise/Critic 一起算了；
- 真有分歧再发 Request 2。

也就是说：

> **没有明显降低分析维度，而是减少串行等待。**

这是 JEV 很适配的一点：它本来就适合一口气回答多个结构化问题。

### 阶段 J：最后不是无限相信 JEV，而是给“语义推翻 Local”再加一道深搜保险

最后一轮真实历史棋谱重放又发现：

> JEV 有时会把 Local #1 推翻成一个语义上很漂亮、但深搜明显更差的点。

于是最近几次提交做了很克制的 guard：

- 区分 **heterogeneous recall 顺序** 和真正的 **Alpha-Beta Local #1**；
- 只有 JEV 最终真的要推翻 Local #1 时才触发 guard；
- 已被 deterministic proof 淘汰的 Local 不允许“复活”；
- 优先复用已有 Deep evidence；
- 不够时只对 Local #1 与 JEV 选择做二点窄化深搜；
- 最新提交在仍然模糊时允许 Worker 直接做 exact depth 8；
- 只有巨大、灾难性的分差才 veto，普通分歧仍交给 JEV。

这是目前最成熟的形态：

~~~text
JEV 可以挑战 Local
但挑战需要接受事实校验
事实不明确时，JEV 仍然有空间发挥
事实已经很明确时，不让“语义感觉”覆盖计算结果
~~~

---

## 2. 当前 JEV 在五子棋里到底负责什么

### 2.1 它不是搜索器

JEV 不擅长替代：

- Alpha-Beta；
- VCF / VCT；
- Threat-space；
- 禁手判断；
- 成五判断；
- 穷举强制变化。

这些问题要的是**严格计算**。

### 2.2 它是候选裁决器

JEV 最适合面对这种输入：

~~~text
候选 A：
- Local score 较高
- Deep PV 一般
- 对手最佳回复后还能活
- Pattern 偏防守

候选 B：
- Local score 稍低
- Threat 形状更积极
- 对手回复更集中
- 但存在一个中长期反击点

候选 C：
- 几个算法意见分裂
~~~

然后回答：

> 在这些都没有被证明输的候选里，综合来看选哪个？

这正是 JEV 的强项：**结构化状态 → 有限选项 → 概率化判断。**

### 2.3 它是独立 second opinion

Max 模式特意不把 `local_rank` / `local_engine_grade` 直接喂给 Atomic。

原因很简单：

如果告诉 JEV：

> “Local 觉得 A 第一，B 第二。”

那它很容易只是跟着 Local 走。

现在更希望它看到的是**证据本身**，然后独立判断。

### 2.4 它是多算法 ensemble 的“裁判”

当前项目实际上已经不是两套算法：

- Alpha-Beta；
- Pattern；
- VCF / VCT；
- Deep Worker；
- Threat-space；
- defensive recall；
- wildcard recall；
- semantic JEV。

传统做法通常是手工调一堆权重，把所有分数加起来。

JEV 的价值在于：

> **不一定要把所有异构证据硬塞进一个固定公式，可以把它们作为状态，让 JEV 做最后的条件判断。**

### 2.5 它可以发现候选召回的盲区，但不能自由发挥

JEV 可以说 `OTHER`，提示“主候选可能漏了”。

但程序不会让它直接随便编一个坐标。

流程是：

1. 本地额外召回 bounded wildcard pool；
2. JEV 从池里选一个；
3. 再过合法性、禁手、一手败着、Threat proof；
4. 通过后才能进决赛。

所以这里的 JEV 是**召回触发器 + reranker**，不是自由生成器。

---

## 3. JEV 和五子棋的适配度

### 作为“纯五子棋 AI”：适配度低

原因：

- 棋类大量信息是组合搜索，不是模糊语义判断；
- 一步战术漏算就直接输；
- JEV 不是专门训练的 Gomoku policy/value network；
- 同局面结果存在随机性；
- 每回合还有网络请求、成本和延迟；
- 专用引擎可以持续利用更深搜索、开局库、定式、棋型优化。

所以不应该得出：

> “JEV 比传统五子棋算法更适合下五子棋。”

目前仓库也没有证明这个结论。

### 作为“候选最终裁决层”：适配度高

这里非常契合 JEV 的接口形态：

- 状态是结构化的；
- 输出集合有限；
- 可以同时问多个问题；
- 能返回概率/置信度；
- 周围有代码控制边界；
- 错误可以通过 deterministic proof 拦一部分。

JEV 在这里像：

> **一个速度很快、可以一次看很多结构化证据的评审员。**

### 作为“混合智能架构实验”：适配度很高

这个项目真正值得保留的不是某一盘棋赢没赢，而是这套模式：

~~~text
Hard rules / proof
        +
Bounded search
        +
Multiple evidence generators
        +
JEV semantic arbitration
        +
Post-decision verification
~~~

这比“让 LLM 直接控制整个程序”更接近可工程化的自动化系统。

---

## 4. 目前实验已经证明了什么，没证明什么

### 已经比较明确的

1. **纯语义模型不能替代棋类 proof。**
2. **候选质量比 prompt 花活更重要。**
3. **JEV 更适合有限候选裁决，而不是全棋盘自由选择。**
4. **让 JEV 独立于 Local 排名，才有真正 challenger 价值。**
5. **真实失败棋谱比随机 benchmark 更容易找到架构漏洞。**
6. **UNKNOWN 不能写成 SAFE。**
7. **模型最终决定也需要 post-check，尤其是推翻强基线时。**
8. **浏览器预算必须有界，Worker / candidate / API request 都要有硬上限。**
9. **JEV 的并行 typed questions 很适合 speculative fan-out。**
10. **随机模型的单次胜负不能当稳定棋力结论。**

### 还没有证明的

1. JEV Max 的长期胜率稳定高于纯 Local。
2. JEV 能在固定成本下稳定提升 Elo。
3. 当前的 Atomic / Pairwise / Critic 组合已经是最佳问法。
4. 当前 semantic override guard 的阈值已经最优。
5. 历史 7 个棋谱族能代表一般五子棋水平。
6. Jev Max 比成熟专用 Gomoku 引擎更强。

因此正确的项目定位应该是：

> **混合决策架构实验，而不是“已经证明 JEV 是强五子棋引擎”。**

---

## 5. 为什么 JEV 的官方定位和这个项目越来越像

TypeSafe 当前把 Jev 定义为 **System One Model**。

它的 API 不是让模型写一大段自然语言，而是：

- 输入 `state`；
- 同时输入多个 typed questions；
- question 支持 Choice / Score / Noul；
- 返回结构化答案、概率和置信信息。

官方 Quick Start：
https://docs.typesafe.ai/introduction/quickstart

官方介绍：
https://typesafe.ai/blog/introducing-system-one-models-and-jev

这类接口天然适合：

~~~text
程序先整理状态
→ 模型做“难写 if/else”的判断
→ 程序根据概率、阈值和规则继续执行
~~~

这正是 Jev Gomoku 最后走到的形态。

需要注意：**结构化输出不等于判断永远正确。**

TypeSafe 能把输出约束在合法 schema 里，但“选择哪个选项”本身仍然可能判断错。五子棋里的多次实战修复已经非常直观地证明了这一点。

---

## 6. JEV 在其他场景，我会重点观望什么

### 6.1 工单 / 客服 / 流程路由：很适合

例如一条工单进来，需要同时判断：

- 属于哪个部门；
- 紧急程度；
- 是否需要人工；
- 是否疑似重复问题；
- 是否有升级风险。

这是非常典型的 System One 任务。

程序完全可以：

~~~text
工单文本 + 用户状态 + 历史信息
       ↓
JEV 并行输出多个 typed decisions
       ↓
代码按概率和阈值路由
~~~

官方 Quick Start 本身就是类似的客服工单示例。

### 6.2 Agent 运行结果审查：很值得看

TypeSafe 已公开一个 **Agent Trace Observability** workflow：

- 看 Agent 的指令；
- 看完整对话；
- 看 tool calls；
- 看最终回复；
- 判断 AUTO-CLOSE / HUMAN REVIEW / PRIORITY REVIEW / FILE ISSUE / PAGE ON-CALL 等。

参考：
https://evals.typesafe.ai/agent_trace_observability

这和 Jev Gomoku 很像：

> Agent 本身负责“执行”，JEV 负责“看证据后判断要不要升级/拦截”。

这是我认为非常有潜力的方向。

### 6.3 多模型 / 多算法结果裁决：非常适合

例如：

- OCR A、OCR B、规则引擎给出不同结果；
- 三个推荐算法各给 Top10；
- 两个风控模型意见不一致；
- 多个 Agent 提出不同执行方案。

与五子棋一样，可以：

1. 先用各自擅长的算法生成候选和证据；
2. 去掉已经确定不合法的；
3. JEV 只处理真正未决的几个选项；
4. 高风险动作再做 deterministic verification。

这可能比“再训练一个统一大模型解决一切”更容易落地。

### 6.4 推荐 / 搜索 rerank：适合

搜索系统最难的往往不是召回，而是：

> 已经有 10～50 个差不多的候选，哪个更适合当前上下文？

JEV 的 choice / score / probability 很适合做：

- rerank；
- contextual selection；
- 多目标权衡；
- “是否值得展示”的 soft rule。

前提仍然是候选集要控制好，不能把它当搜索数据库本身。

### 6.5 异常单据 / 对账差异分流：适合“判断”，不适合“算账”

例如：

- 金额不一致已经由代码算出来；
- 支付渠道、营业日、退款状态等事实也已经结构化；
- 接下来需要判断“更像延迟入账、重复单、退款跨日、渠道异常还是需要人工”。

这种最后一层 exception triage 很适合 JEV。

但：

- 金额计算；
- 唯一键；
- 对账等式；
- 会计规则；

仍然必须是确定性代码。

这和五子棋“Proof > JEV”是同一原则。

### 6.6 实时游戏 / 实时控制：有潜力，但要实测

TypeSafe 官方公开过 Doom、Wikiracing 等演示，强调低延迟结构化判断。

参考：
https://typesafe.ai/blog/introducing-system-one-models-and-jev

Jev Gomoku 也说明这条路可行，但需要关注：

- 网络 RTT；
- 尾延迟；
- 模型服务地域；
- 每秒调用成本；
- 状态压缩；
- 非确定性；
- 出错后的 fallback。

所以这里目前更适合说“值得观察”，还不能直接说“已经适合所有实时控制”。

### 6.7 风险审核 / Guardrail：适合做第二层，不应该单独兜底

例如：

- 一个 Agent 要删除数据；
- 一笔操作是否疑似越权；
- 一份合同是否需要升级法务；
- 一条自动化动作是否应该人工复核。

JEV 可以做：

> “基于这些事实，这次是否需要升级？”

但真正不可逆、强合规的边界，仍然应该有：

- 权限系统；
- 白名单；
- 金额阈值；
- 审批流；
- 确定性 policy。

也就是：

> **JEV 可以是 risk judge，不应该是唯一的安全门。**

---

## 7. 哪些场景反而不应该优先用 JEV

### 需要长文本生成

比如：

- 写报告；
- 写代码；
- 写邮件；
- 长篇解释；
- 创作。

JEV 的核心价值不是字符串生成，这些继续用 LLM 更自然。

### 能用确定性代码轻松解决

比如：

- 金额相加；
- 日期比较；
- 唯一键判断；
- 权限检查；
- 正则就能稳定解决的问题。

这种地方引入模型只会增加成本和不确定性。

### 需要很深的顺序推理 / 搜索

例如：

- 棋类穷举；
- 定理证明；
- 复杂规划；
- 很长的依赖链。

可以让 JEV 判断搜索过程中某个局部决策，但不应默认它替代完整搜索过程。

### 错一次代价极高、又没有后验验证

如果没有：

- deterministic guard；
- 人工复核；
- 可回滚；
- 二次验证；

那就不应该只凭一个模型概率直接执行高风险动作。

---

## 8. 接下来最值得继续验证的 7 件事

### 1. 做真正的 A/B，而不是只看“这一盘赢了”

建议固定：

- opening；
- 对手；
- 时间预算；
- Local search budget；
- 模型版本；
- 候选数量。

比较：

- Local；
- Jev Final；
- Jev Max。

至少多轮重复，避免 Jev 随机性把结论带偏。

### 2. 统计“JEV 推翻 Local 后到底是变好还是变差”

比最终 W/L 更有信息量的指标是：

~~~text
JEV override Local #1
      ↓
离线更深搜索 / 后验 proof
      ↓
override 是 improvement 还是 regression
~~~

这能直接回答：

> JEV 这个裁判到底有没有价值？

### 3. 把 JEV 的价值拆成两部分

分别测试：

- **候选排序价值**；
- **候选召回价值（OTHER / wildcard）**。

不要混在一起，否则不知道提升来自哪里。

### 4. 测概率是否真的可校准

如果 JEV 对“这步能存活”给 0.9，长期是不是大约 90% 真能存活？

这比单纯 accuracy 更重要，因为只有校准可靠，程序才能放心写：

~~~text
p > 0.95 自动执行
0.65 < p <= 0.95 二次验证
p <= 0.65 人工/更深搜索
~~~

### 5. 防止为了历史棋谱不断堆特判

现在已经出现若干“由真实败局触发的 guard”。

这很好，但要警惕：

> 修一盘棋 → 加一条规则 → 再修下一盘 → 最后变成不可维护的历史补丁合集。

每条 guard 最好都能抽象成**一般性错误模式**，而不是某个具体坐标。

### 6. 把模型版本漂移纳入 benchmark

`jev-latest` 会变。

所以长期比较最好同时记录：

- 实际返回 model version；
- 日期；
- request shape revision；
- prompt/policy revision。

否则一个月后“同样代码结果不同”会很难解释。

### 7. 把这套模式迁移到一个真实业务小场景

五子棋已经证明架构能跑。

下一步真正有价值的是找一个：

- 有明确候选；
- 有规则/算法基线；
- 有人工历史答案；
- 错误可回滚；
- 可以量化准确率和成本；

的业务场景做第二个实验。

如果 JEV 在完全不同领域仍然能稳定提升“规则 + 基线模型”的最后裁决质量，才更能说明这套架构具有通用性。

---

## 9. 最后一句话

Jev Gomoku 这两天 146 次提交最大的收获，不是把 JEV 调成了一个“神奇五子棋模型”。

而是把边界逐渐试出来了：

> **能证明的，交给代码。**  
> **能搜索的，交给搜索。**  
> **几个合理答案之间难以写死规则的判断，交给 JEV。**  
> **JEV 做完决定后，关键动作再接受事实校验。**

换成通用软件架构就是：

~~~text
Search / Rules / Tools produce evidence.
JEV judges the unresolved choices.
Deterministic constraints keep final authority over facts.
~~~

这比“让 AI 接管全部逻辑”更保守，但也更像真正能进生产的方向。

---

## 10. 参考资料

- TypeSafe / Jev Quick Start  
  https://docs.typesafe.ai/introduction/quickstart
- TypeSafe Agent Skill  
  https://docs.typesafe.ai/agent-skill
- Introducing System One Models & Jev  
  https://typesafe.ai/blog/introducing-system-one-models-and-jev
- TypeSafe Workflow Eval：Agent Trace Observability  
  https://evals.typesafe.ai/agent_trace_observability
- 本仓库 Benchmark 说明  
  [../benchmark/README.md](../benchmark/README.md)

> 外部资料描述的是 TypeSafe 官方的产品定位、演示和评测。涉及性能、成本和模型能力的厂商数据应视为官方自报结果；迁移到真实业务前仍应使用自己的数据集、延迟环境和错误成本进行验证。

---

# 附录：开始整理时的完整 146 条提交记录

以下按时间从旧到新列出，确保本次“总结全部提交记录”有可追溯索引。

### 2026-09-22（UTC）

- [`20866827`](https://github.com/jackson-heylion/jev-gomoku/commit/2086682749f8fd3c909b66df7cbe4cde2f2e5713) — docs: initialize Jev Gomoku repository
- [`b69bc911`](https://github.com/jackson-heylion/jev-gomoku/commit/b69bc911fbe69e0411e687dd1740a8a9d99ec8b0) — feat: add Jev Gomoku V3 game
- [`1e5d7ca4`](https://github.com/jackson-heylion/jev-gomoku/commit/1e5d7ca420baaca2ad9cf31658df6461311f4034) — build: continue Jev Gomoku V3 source
- [`5bbea2e3`](https://github.com/jackson-heylion/jev-gomoku/commit/5bbea2e39cd049496f1662ea405fbfaeef7b98a7) — build: append Jev Gomoku V3 source
- [`95c9fde5`](https://github.com/jackson-heylion/jev-gomoku/commit/95c9fde586384387697bef92d70edd90199939f6) — build: append Jev Gomoku V3 source
- [`a9d9d58c`](https://github.com/jackson-heylion/jev-gomoku/commit/a9d9d58cf042ed4977e66aeca8ea1033ab6d63f9) — build: append Jev Gomoku V3 source
- [`d9551267`](https://github.com/jackson-heylion/jev-gomoku/commit/d9551267378ec25a85df276139e1f446010579f2) — build: append Jev Gomoku V3 source
- [`8ef361d4`](https://github.com/jackson-heylion/jev-gomoku/commit/8ef361d4125e706dcbae5995f64f50848c7cd8bc) — build: append Jev Gomoku V3 source
- [`cf1461f8`](https://github.com/jackson-heylion/jev-gomoku/commit/cf1461f853986555c74c3f16fa0ec13ee34926aa) — build: append Jev Gomoku V3 source
- [`fec23720`](https://github.com/jackson-heylion/jev-gomoku/commit/fec23720536b3b1713a2997a1c7ed6c18e36dba4) — build: complete Jev Gomoku V3 source
- [`4c2017c2`](https://github.com/jackson-heylion/jev-gomoku/commit/4c2017c2de1b7d794c4ffb9ee9f6885ca3a4a2a6) — feat: add exact V3 entrypoint (part 1)
- [`fb960f72`](https://github.com/jackson-heylion/jev-gomoku/commit/fb960f720a172f733c974f0c1142f8873f624548) — build: assemble exact V3 entrypoint (part 2)
- [`b5b1bd94`](https://github.com/jackson-heylion/jev-gomoku/commit/b5b1bd9401678cdce0e3e8db4863fc59682fe5c1) — build: assemble exact V3 entrypoint (part 3)
- [`32979a76`](https://github.com/jackson-heylion/jev-gomoku/commit/32979a76b0bd174f74968826c3886ade54c8aed3) — build: assemble exact V3 entrypoint (part 4)
- [`09dfeec6`](https://github.com/jackson-heylion/jev-gomoku/commit/09dfeec654f39484f8b440a9bc0a3a640fdc8f98) — build: assemble exact V3 entrypoint (part 5a)
- [`95cbee08`](https://github.com/jackson-heylion/jev-gomoku/commit/95cbee08734873eee2024651ef74632968f25ba3) — build: assemble exact V3 entrypoint (next)
- [`6d6828da`](https://github.com/jackson-heylion/jev-gomoku/commit/6d6828da34ef5389b7d9a9775ee68ccc40b02da0) — build: assemble exact V3 entrypoint (next)
- [`1f3393ef`](https://github.com/jackson-heylion/jev-gomoku/commit/1f3393ef70e5133e54892b92b469882c8caf32b0) — build: assemble exact V3 entrypoint (49006-57006)
- [`fea938e6`](https://github.com/jackson-heylion/jev-gomoku/commit/fea938e690d578f569a5097367348121e920b5d8) — chore: add macOS launcher
- [`e29e02a3`](https://github.com/jackson-heylion/jev-gomoku/commit/e29e02a3dcfc9aead77fad5b2dc5ac4f3e9c1c2d) — refactor: split frontend, trace Jev decisions, prepare Pages
- [`2380b2b8`](https://github.com/jackson-heylion/jev-gomoku/commit/2380b2b869016a8208e51ed659fd44cd7c999b5b) — fix: repair clipboard fallback syntax
- [`261cf5a4`](https://github.com/jackson-heylion/jev-gomoku/commit/261cf5a45412f50b02ac06fd3e56c989dea903e6) — fix: remove duplicated malformed CSS block
- [`b9394928`](https://github.com/jackson-heylion/jev-gomoku/commit/b9394928a161e77b0ca6c835def86cd68938fbb2) — feat: include Jev stage decisions in copied game record
- [`ce34dae0`](https://github.com/jackson-heylion/jev-gomoku/commit/ce34dae0fd3915e4bbd6ab9a4914abe61a91d68b) — docs: describe Jev decision trace export
- [`7f91796c`](https://github.com/jackson-heylion/jev-gomoku/commit/7f91796cdfa69fc69dc3e3fa3d2364fa8ab35b55) — chore: trigger GitHub Pages deployment
- [`38be4981`](https://github.com/jackson-heylion/jev-gomoku/commit/38be4981df72ecdf210f1281185c4ad762ae97ed) — test: enable TypeSafe browser SDK mode
- [`739d0434`](https://github.com/jackson-heylion/jev-gomoku/commit/739d0434aec4e6269a6fbda485b8bd11be9fbdb1) — fix: keep browser SDK result immutable-safe
- [`3a5db2c6`](https://github.com/jackson-heylion/jev-gomoku/commit/3a5db2c6ca5694e7979c1b5a365b102107dfd5ab) — docs: note browser SDK CORS experiment
- [`08fc0f31`](https://github.com/jackson-heylion/jev-gomoku/commit/08fc0f31b77fab1dae1094cb83341122c0cc5878) — refactor: route Jev through same-origin server endpoint
- [`e12ed342`](https://github.com/jackson-heylion/jev-gomoku/commit/e12ed342056f81332da10aac4b0e4286286b20a9) — security: remove browser TypeSafe transport and API key handling
- [`e2e65a01`](https://github.com/jackson-heylion/jev-gomoku/commit/e2e65a01442224a43671bd01a0e09347e8660b85) — ui: make Jev settings server-side only
- [`287e13c3`](https://github.com/jackson-heylion/jev-gomoku/commit/287e13c36cfb0e83948e21c6c091ce4ef73ac8c1) — ui: make Jev settings server-side only
- [`2c2b0f5e`](https://github.com/jackson-heylion/jev-gomoku/commit/2c2b0f5e5916601ab4c2447ad23a9b9622cf9b72) — build: add ChatGPT Sites Worker runtime
- [`475ba18b`](https://github.com/jackson-heylion/jev-gomoku/commit/475ba18bcc6917cc2b76110db1dc0e6aa292df33) — build: add ChatGPT Sites Worker runtime
- [`e525349f`](https://github.com/jackson-heylion/jev-gomoku/commit/e525349fd0900450bf155a8ca502eda9e28ce172) — build: add ChatGPT Sites Worker runtime
- [`e71b3e4e`](https://github.com/jackson-heylion/jev-gomoku/commit/e71b3e4e0bb0b79f344e3edefd62607dbc1f2278) — build: add ChatGPT Sites Worker runtime
- [`8ad3cacb`](https://github.com/jackson-heylion/jev-gomoku/commit/8ad3cacb6598ef8324a60accb5e9fcf4e7269268) — build: add ChatGPT Sites Worker runtime
- [`4219eebd`](https://github.com/jackson-heylion/jev-gomoku/commit/4219eebd1e6c6fd71aa2dc03fd362ee5e98ee1d2) — build: add ChatGPT Sites Worker runtime
- [`6adf2d4d`](https://github.com/jackson-heylion/jev-gomoku/commit/6adf2d4d6c993a6366b7a063dd821c8f0ccc944a) — build: add ChatGPT Sites Worker runtime
- [`4708f44b`](https://github.com/jackson-heylion/jev-gomoku/commit/4708f44bab2c02a4d3196cdde61a8d70476104d5) — security: load local Jev key from server environment
- [`8ef1fbe3`](https://github.com/jackson-heylion/jev-gomoku/commit/8ef1fbe3ae269b7f2e931ba21a4308563c4ce0a7) — docs: align local launcher with server-side Jev secret
- [`745944df`](https://github.com/jackson-heylion/jev-gomoku/commit/745944df5852331dd5a8658ef134295048c3e092) — docs: document ChatGPT Sites same-origin architecture
- [`74e4a7a9`](https://github.com/jackson-heylion/jev-gomoku/commit/74e4a7a925927f7ddee039969742c33ff081348d) — ci: validate ChatGPT Sites worker build and secret boundary
- [`497fdfed`](https://github.com/jackson-heylion/jev-gomoku/commit/497fdfeda4caa447157926e5cb9c38fb10b0be66) — fix: use Cloudflare default client entry for Sites build
- [`ab1eacb9`](https://github.com/jackson-heylion/jev-gomoku/commit/ab1eacb934c29f4e5d1f92c0067cb9385b1f88e6) — build: include existing browser scripts in Vite client output
- [`6686729e`](https://github.com/jackson-heylion/jev-gomoku/commit/6686729ec289e831e388e2a34dad0b4add3bca4b) — build: include existing browser scripts in Vite client output
- [`dd4a53a2`](https://github.com/jackson-heylion/jev-gomoku/commit/dd4a53a2848e97867faf803a25d6fda80b6151f9) — build: normalize Worker artifact for ChatGPT Sites
- [`6561fc9e`](https://github.com/jackson-heylion/jev-gomoku/commit/6561fc9e67f21578db760b5acc894371f40df9c9) — build: package Vite worker into Sites artifact layout
- [`a2b68f6b`](https://github.com/jackson-heylion/jev-gomoku/commit/a2b68f6b147b521da360895ba1401fb732ec822e) — ci: assert fixed same-origin Jev endpoint
- [`abb48d95`](https://github.com/jackson-heylion/jev-gomoku/commit/abb48d95181fc6e4a92d8092baac91def78c37a0) — fix: finalize ChatGPT Sites private preview
- [`32659953`](https://github.com/jackson-heylion/jev-gomoku/commit/32659953fb655f2e511292ef5fe83ebf9b9c8ada) — ui: improve game result and AI decision panel (index.html)
- [`87a8e3f4`](https://github.com/jackson-heylion/jev-gomoku/commit/87a8e3f403f77853e12954f7a7747172fa5dfa8e) — ui: improve game result and AI decision panel (jev-gomoku.html)
- [`2249cc59`](https://github.com/jackson-heylion/jev-gomoku/commit/2249cc59b75ad79888a8cc0695e3d871dae445d7) — ui: style result dialog and readable AI explanation
- [`af8bd4a6`](https://github.com/jackson-heylion/jev-gomoku/commit/af8bd4a6e7c4344bab6cce792c8a19a7fffde234) — ui: add end-game dialog and human-readable AI decision text
- [`a9f3d789`](https://github.com/jackson-heylion/jev-gomoku/commit/a9f3d789c71d125d20a7562501b552aae01baee3) — docs: simplify README
- [`3ff4ad2c`](https://github.com/jackson-heylion/jev-gomoku/commit/3ff4ad2cf2207d025aebab21c602af954a39c3e1) — chore: remove GitHub Pages deployment
- [`5104b8b2`](https://github.com/jackson-heylion/jev-gomoku/commit/5104b8b29b6c042451de0654f9780a600a7b090f) — ui: polish public-facing copy in index.html
- [`5fa35909`](https://github.com/jackson-heylion/jev-gomoku/commit/5fa35909117587e8b59a4da7481578c5db053568) — ui: polish public-facing copy in jev-gomoku.html
- [`aeeb6969`](https://github.com/jackson-heylion/jev-gomoku/commit/aeeb6969df5126686c3d6bb20f9db0011b167255) — ui: simplify public-facing AI status and settings copy
- [`a748be73`](https://github.com/jackson-heylion/jev-gomoku/commit/a748be73f0d6ef7bf18ebc96cd2217fcd371d3e4) — style: polish public game controls
- [`b57d8d53`](https://github.com/jackson-heylion/jev-gomoku/commit/b57d8d534587e109680c53910195db560a8d2a29) — ui: clarify AI score wording in index.html
- [`3fe363c9`](https://github.com/jackson-heylion/jev-gomoku/commit/3fe363c98244a32f0deca3ec4ad8fd28fc34673e) — ui: clarify AI score wording in jev-gomoku.html
- [`a75f9538`](https://github.com/jackson-heylion/jev-gomoku/commit/a75f95388061f1c5aa0b1f54016cde6ef35b37b4) — ui: make AI explanations clearer for public release
- [`51917d97`](https://github.com/jackson-heylion/jev-gomoku/commit/51917d972ebb603457e2f6aa8cc7134f703ea03d) — ui: make Jev the focus of index.html
- [`19ce272b`](https://github.com/jackson-heylion/jev-gomoku/commit/19ce272b3733ba11075fb428b4dc03e68fdb2698) — ui: make Jev the focus of jev-gomoku.html
- [`a95902e8`](https://github.com/jackson-heylion/jev-gomoku/commit/a95902e84e0ba6a9a1c1fbca7d9c7edac6e8a6e9) — ui: make Jev presence explicit throughout gameplay
- [`03bfef6f`](https://github.com/jackson-heylion/jev-gomoku/commit/03bfef6fb7d184054ae165b85c687a548c63ae78) — style: strengthen Jev identity in public UI
- [`d4cd9b09`](https://github.com/jackson-heylion/jev-gomoku/commit/d4cd9b09635470c917333f04dd0caba40172863a) — ui: add game level guide to index.html
- [`84d37403`](https://github.com/jackson-heylion/jev-gomoku/commit/84d37403696f558de6ec074980a44efd077bb616) — ui: add game level guide to jev-gomoku.html
- [`54d6502e`](https://github.com/jackson-heylion/jev-gomoku/commit/54d6502ea33034328d9937973c2e3fefc9cb60f6) — ui: show current Jev game level and explanation
- [`24ad5d35`](https://github.com/jackson-heylion/jev-gomoku/commit/24ad5d35ba0da290dda6624903f6871f7f14b701) — style: add Jev game level guide
- [`03ec83cb`](https://github.com/jackson-heylion/jev-gomoku/commit/03ec83cb576878504a1807fffb9bda7f435a4c7a) — fix: keep game level display synced to saved setting
- [`176cd02c`](https://github.com/jackson-heylion/jev-gomoku/commit/176cd02c3cb6c67a23da748b1c1c40200d3ba809) — ui: replace level select with cards in index.html
- [`1059d4f8`](https://github.com/jackson-heylion/jev-gomoku/commit/1059d4f8e601e0fa8f73cb41903e07b6eda797b6) — ui: replace level select with cards in jev-gomoku.html
- [`48b931d4`](https://github.com/jackson-heylion/jev-gomoku/commit/48b931d4d7d7b6aaec9501a196ecc008d24caacb) — ui: make game level cards selectable
- [`6010613c`](https://github.com/jackson-heylion/jev-gomoku/commit/6010613c650e22e809debffb249fbc17ff2f0508) — style: make selected game level unmistakable
- [`3047c822`](https://github.com/jackson-heylion/jev-gomoku/commit/3047c8225a5032509f04b757110f31cec59d3da8) — bench: add production engine harness
- [`c3799b1a`](https://github.com/jackson-heylion/jev-gomoku/commit/c3799b1a798d6d368e284f208b97dc04cbdba50e) — bench: add Local Jev Blind Hybrid runner
- [`9b49ebb9`](https://github.com/jackson-heylion/jev-gomoku/commit/9b49ebb9fa0d95186a7296ed7af0625b0e9fa4bd) — bench: add benchmark scripts and smoke check
- [`411153fc`](https://github.com/jackson-heylion/jev-gomoku/commit/411153fcb434613e65467c218f6b2973fcc1221b) — docs: explain three-engine benchmark
- [`1a462baa`](https://github.com/jackson-heylion/jev-gomoku/commit/1a462baa9d1a8f36e19fba4fcc8b73d283d3263e) — bench: add manual three-engine workflow
- [`376109f3`](https://github.com/jackson-heylion/jev-gomoku/commit/376109f366b2216f02f47a92a29fbbdb5fc93220) — engine: make Jev an independent challenger with deep verification
- [`898fb3ca`](https://github.com/jackson-heylion/jev-gomoku/commit/898fb3cabc74ed3f5f9ff34e740eebe728b6deaa) — test: add lost-game and challenger regressions
- [`c0863a71`](https://github.com/jackson-heylion/jev-gomoku/commit/c0863a71bce407726477b80c968d89b0cb16440e) — test: run engine regressions in CI
- [`a124cf63`](https://github.com/jackson-heylion/jev-gomoku/commit/a124cf635301b0fa118d054818a6519890ee9a01) — ui: expose Local Jev challenger arbitration in game records
- [`00e650f5`](https://github.com/jackson-heylion/jev-gomoku/commit/00e650f5a38a7a5fcaf0466170e2317590e3facf) — engine: detect opponent double-threat creators without move-order pruning
- [`0145ae31`](https://github.com/jackson-heylion/jev-gomoku/commit/0145ae3111736e1b06f342b2e6cf75ab99e25274) — test: assert tactical diagnosis for lost-game position
- [`9fa06abe`](https://github.com/jackson-heylion/jev-gomoku/commit/9fa06abebec6c087dcefc93f2c5189f010ebb747) — test: expose deep challenger verification to regression harness
- [`bf2cf478`](https://github.com/jackson-heylion/jev-gomoku/commit/bf2cf47884b4560e8b1f50d06edce9ca7e89cbfd) — test: diagnose lost-game position with depth-7 verification
- [`d7798cb2`](https://github.com/jackson-heylion/jev-gomoku/commit/d7798cb2c9d592c7c9a2e6d4d56cf61898dc0d6f) — test: expose deep candidate ranking for historical analysis
- [`a578e16d`](https://github.com/jackson-heylion/jev-gomoku/commit/a578e16dc423943d3700320cdbebefc7a723ba78) — test: trace historical game with depth-7 candidate ranking
- [`6f1ac519`](https://github.com/jackson-heylion/jev-gomoku/commit/6f1ac519d8eaceab6e10ffa933badb48cec50a9c) — engine: give Jev board context and add horizon rescue search
- [`bdb0defa`](https://github.com/jackson-heylion/jev-gomoku/commit/bdb0defa50d35f2267ddb5839753fc248c0f2603) — ui: explain Jev challenger horizon and rescue decisions
- [`cb4331ec`](https://github.com/jackson-heylion/jev-gomoku/commit/cb4331ecd992bbab6a67ef63ec89fb45a09aa37a) — test: cover production Horizon Guard and Jev board context
- [`01f0ed94`](https://github.com/jackson-heylion/jev-gomoku/commit/01f0ed94041f3874e59047587c0a3eebe7cc6cb3) — fix: roll back browser-heavy horizon search that crashed Sites
- [`6824143f`](https://github.com/jackson-heylion/jev-gomoku/commit/6824143f9aa08002aa20b4fc606aa83702a9d0da) — fix: align regression tests with safe challenger runtime
- [`dceae5df`](https://github.com/jackson-heylion/jev-gomoku/commit/dceae5df2a056e5edbe412ed2eebff32f11edde6) — engine: add bounded deep-search Web Worker
- [`402b427b`](https://github.com/jackson-heylion/jev-gomoku/commit/402b427bc5baca5931eba66dd4889b3120f8da12) — engine: move deep verification off the UI thread
- [`11481541`](https://github.com/jackson-heylion/jev-gomoku/commit/11481541615e976be2f0fa7dd04ef72f20fc35ca) — ui: report background deep-search arbitration
- [`49aa78ae`](https://github.com/jackson-heylion/jev-gomoku/commit/49aa78aed5f1f81270b8f7b1236aea0e8ef16b17) — fix: gracefully degrade when deep-search Worker is unavailable
- [`d80ce76f`](https://github.com/jackson-heylion/jev-gomoku/commit/d80ce76f081f004739b1f5c24c92f42dea05e3a8) — fix: make deep-search timeout fallback constant-time
- [`a1429475`](https://github.com/jackson-heylion/jev-gomoku/commit/a1429475a9473d99c64c814ed7a67fb597cfea18) — ci: validate deep-search worker
- [`4ca29073`](https://github.com/jackson-heylion/jev-gomoku/commit/4ca290739a04d2aaeecafab7b9d7df920b9c5020) — ci: require deep-search worker in built artifact
- [`1f14ef07`](https://github.com/jackson-heylion/jev-gomoku/commit/1f14ef07958dc20a52a7c455ff719c99f5e6767d) — ui: add turn and thinking timer to index.html
- [`c32a942e`](https://github.com/jackson-heylion/jev-gomoku/commit/c32a942ec9c6606076b8676c2b818e7707f3a967) — ui: add turn and thinking timer to jev-gomoku.html
- [`4ef43759`](https://github.com/jackson-heylion/jev-gomoku/commit/4ef43759b8f90026bdbda68f2b3830651ce4a315) — ui: show live turn and thinking duration
- [`50b48662`](https://github.com/jackson-heylion/jev-gomoku/commit/50b48662daf1eb16abda853a14beedeba88aa192) — style: emphasize active turn and live thinking time
- [`52ec4464`](https://github.com/jackson-heylion/jev-gomoku/commit/52ec44647a6f8930a7ac9d28b7ec445178fd7397) — test: provide interval timers to browser harness
- [`9d37fb7f`](https://github.com/jackson-heylion/jev-gomoku/commit/9d37fb7fab5441764f52802babda32c2a74aa52a) — test: stub UI interval so benchmark process can exit
- [`991515c9`](https://github.com/jackson-heylion/jev-gomoku/commit/991515c9ee403994ba573ebd83b2f022f350cefb) — Improve tactical fork defense and deep-search performance (#1)
- [`9a6ee3dc`](https://github.com/jackson-heylion/jev-gomoku/commit/9a6ee3dcdba779ee0d65a2a0f2c23b78e77da9f2) — Make Jev the final move decision maker
- [`c799a765`](https://github.com/jackson-heylion/jev-gomoku/commit/c799a765a165f16c1e94ea8386494bd7a939f366) — Fix hosted page crash on expert opening
- [`e6cd46eb`](https://github.com/jackson-heylion/jev-gomoku/commit/e6cd46eb7fb2eb3429b7a94504afc02b7606635e) — Integrate Renju forbidden moves with expert crash fix
- [`0bbfc4ca`](https://github.com/jackson-heylion/jev-gomoku/commit/0bbfc4cae38a2ae823971483d0a06909954fce94) — Fix undo after game over
- [`9ab2134f`](https://github.com/jackson-heylion/jev-gomoku/commit/9ab2134f0e184a2ed1132af59b873ba3e0665852) — bench: refactor benchmark around Jev as final decision maker
- [`bbb75ef5`](https://github.com/jackson-heylion/jev-gomoku/commit/bbb75ef5118833566df8c6821c32c0039f09c23f) — Reduce Jev token usage without weakening move selection
- [`77608aaf`](https://github.com/jackson-heylion/jev-gomoku/commit/77608aafc3125a43dc04f6b21ebca97075c1cd32) — Reduce repeated games with bounded Jev cache diversity
- [`35dcf5b9`](https://github.com/jackson-heylion/jev-gomoku/commit/35dcf5b9841f7921897892353f987ecd993f4c97) — feat: add grandmaster parallel threat-search difficulty
- [`2ec5d966`](https://github.com/jackson-heylion/jev-gomoku/commit/2ec5d966630f17d19a6019d98877726ada0930b6) — test: pin real-game grandmaster threat detection
- [`ec2636bc`](https://github.com/jackson-heylion/jev-gomoku/commit/ec2636bc416537ddad8e3b6b9f96bc5b14316510) — chore: make level 4 grandmaster the default
- [`bfa2bc83`](https://github.com/jackson-heylion/jev-gomoku/commit/bfa2bc839bdf93bd0553be2034ee100085468049) — feat: add pre-game side and Renju rule configuration
- [`912edcab`](https://github.com/jackson-heylion/jev-gomoku/commit/912edcabf5c888417be8b1fe2b00133800b41c9a) — feat: bound local search time and shorten expert opening phase
- [`0ed78296`](https://github.com/jackson-heylion/jev-gomoku/commit/0ed78296e51369f99262f185b7d15984aebd3060) — feat: strengthen tactical search and Jev Gomoku interaction

### 2026-09-23（UTC）

- [`c8701286`](https://github.com/jackson-heylion/jev-gomoku/commit/c8701286cfcf5e850e8b0dec1a44bad8558765a2) — feat: add bounded multi-stage Jev Max mode (#15)
- [`6a0921e1`](https://github.com/jackson-heylion/jev-gomoku/commit/6a0921e17b469740d54a37d833a11962f59a2f6e) — feat: add counter-threat aware Jev Max analysis (#16)
- [`445ff0ee`](https://github.com/jackson-heylion/jev-gomoku/commit/445ff0ee824275b30294d297dbeab76f97900489) — fix: stop Jev Max wildcard from bypassing threat proofs (#17)
- [`580afcf7`](https://github.com/jackson-heylion/jev-gomoku/commit/580afcf77865520699713789de266dd8d7f0ba2b) — fix: close Jev Max Threat coverage before final arbitration (#18)
- [`17b5b990`](https://github.com/jackson-heylion/jev-gomoku/commit/17b5b9900287824b948946c67b2a1f0d1b32c209) — feat: add bounded Jev Max rescue for all-loss positions (#19)
- [`57c04d05`](https://github.com/jackson-heylion/jev-gomoku/commit/57c04d057fe5860b9bd97d1286949e6c597ac77f) — perf: double all Jev Gomoku timeout budgets (#20)
- [`c9eb25db`](https://github.com/jackson-heylion/jev-gomoku/commit/c9eb25db04aa6d23c363ece65d83315d1c4d4709) — test: stabilize G14 regression under doubled timeouts (#21)
- [`045c5565`](https://github.com/jackson-heylion/jev-gomoku/commit/045c5565a0e6a8b7edebbcdb70faec16575f443a) — fix: hard-veto one-ply double-ended open-four threats (#22)
- [`b259590b`](https://github.com/jackson-heylion/jev-gomoku/commit/b259590b3292625899c4368fd3b4d4687d3613e3) — ui: stabilize live status, add game summary and easter eggs (#23)
- [`84e7a8ea`](https://github.com/jackson-heylion/jev-gomoku/commit/84e7a8ea33f281580712aa6545720913064171c0) — docs: rewrite README around Jev decision architecture
- [`acb65cac`](https://github.com/jackson-heylion/jev-gomoku/commit/acb65cacb468dda5685cc772da4d10df3cced2c8) — perf: optimize Jev Max latency without reducing search strength
- [`cf9e43ca`](https://github.com/jackson-heylion/jev-gomoku/commit/cf9e43ca5522d501f72d3fb3169216434d57a91c) — fix: defend historical double-open-three diagonal fork

### 2026-09-24（UTC）

- [`20b625e1`](https://github.com/jackson-heylion/jev-gomoku/commit/20b625e12850a9d686ea6b36f0226bcd43e7e66c) — bench: add real Jev historical replay suite
- [`37057f2f`](https://github.com/jackson-heylion/jev-gomoku/commit/37057f2f722c71fdfa582e3b44d6635369c9221c) — fix: run historical replay without npm lockfile cache
- [`3ae8f70b`](https://github.com/jackson-heylion/jev-gomoku/commit/3ae8f70bc64948ef6ecb0fe18882f6691ab2be96) — fix: guard Jev Max against historical tactical blunders
- [`1a63f91d`](https://github.com/jackson-heylion/jev-gomoku/commit/1a63f91d5e813d6aaa04cb71b441b3e6dbf41818) — fix: separate Alpha-Beta leader from recall and guard Jev overrides
- [`b73ccf04`](https://github.com/jackson-heylion/jev-gomoku/commit/b73ccf04b59111fba4c6aeff17ddad1c2ae7f4aa) — bench: report Alpha-Beta leader and semantic Deep guard
- [`ab2872a3`](https://github.com/jackson-heylion/jev-gomoku/commit/ab2872a37fd5d546604b51a904c2f4820fd76d7d) — fix: stabilize semantic guard and fair historical replay
- [`53a728b6`](https://github.com/jackson-heylion/jev-gomoku/commit/53a728b62a31433f5cef2368fb50fc1057bfdf31) — fix: narrow Deep safety to final semantic override
- [`061d875d`](https://github.com/jackson-heylion/jev-gomoku/commit/061d875d7096fedfb4217c7c1a7aea70a9fe70e3) — bench: tag final semantic override replay policy
- [`1aeaf9ba`](https://github.com/jackson-heylion/jev-gomoku/commit/1aeaf9ba08e15c8b94233be6da328536d735a28a) — docs: document deterministic semantic guard fallback
- [`62c1f42e`](https://github.com/jackson-heylion/jev-gomoku/commit/62c1f42ee612598f42b143a564a28233e64dded0) — docs: explain stochastic historical replay interpretation
- [`907ac552`](https://github.com/jackson-heylion/jev-gomoku/commit/907ac552107ac37570b5651b5dd26d940f44a0ec) — fix: strengthen ambiguous Jev semantic overrides

