# Jev Gomoku

[中文](README.md) | **English**

> **Search for facts. Jev for judgment. Proof wins.**

Jev Gomoku is a browser-based 15×15 Gomoku experiment that explores how a traditional search engine and **Jev / TypeSafe System One** can work together.

This is **not** “ask an AI to look at the board and invent a move.”

The current architecture is deliberately hybrid:

- deterministic code handles legality, Renju rules, immediate wins, mandatory defenses and proven tactical lines;
- Alpha-Beta, Pattern, VCF/VCT, Deep Search and Threat-space produce candidates and evidence;
- **Jev** independently evaluates unresolved candidates and arbitrates disagreements;
- critical semantic overrides are checked again before the final move.

In one sentence:

> **Algorithms calculate what can be calculated; Jev judges what remains hard to rank with fixed rules.**

## What this project is testing

The main research question is not:

> “Can Jev replace a Gomoku engine?”

It is:

> **When software has both deterministic subproblems and fuzzy judgment calls, can a fast structured decision model improve the final choice without taking control away from hard constraints?**

Gomoku is useful for this experiment because mistakes are visible immediately:

- an illegal move is objectively illegal;
- an immediate win can be proven;
- a forced tactical loss can often be searched;
- several survivable moves can still differ strategically;
- browser compute is limited, so exhaustive search is not available.

That gives Jev a clear boundary.

## Current architecture

~~~mermaid
flowchart TD
    A[15×15 Board] --> B[Rules / legality]
    B --> C[Local candidate recall]

    C --> C1[Alpha-Beta]
    C --> C2[Pattern]
    C --> C3[VCF / VCT]
    C --> C4[Deep Worker]
    C --> C5[Threat-space]
    C --> C6[Defense / wildcard recall]

    C1 --> D[6–8 candidates]
    C2 --> D
    C3 --> D
    C4 --> D
    C5 --> D
    C6 --> D

    D --> E[Deterministic proof filter]
    E -->|forced answer| F[Final move]
    E -->|unresolved| G[Jev speculative fan-out]

    G --> G1[Atomic]
    G --> G2[Pairwise]
    G --> G3[Critic]
    G --> G4[Global Best]
    G --> G5[Recall check]

    G1 --> H[Convergence / finalist set]
    G2 --> H
    G3 --> H
    G4 --> H
    G5 --> H

    H --> I{Confident agreement?}
    I -->|yes| J[Semantic choice]
    I -->|no| K[Final / Resolution request]
    K --> J

    J --> L[Semantic override guard]
    L --> F
~~~

### Three layers

| Layer | Responsibility | Can Jev override it? |
|---|---|---|
| **Rules / proof** | legality, forbidden moves, immediate win, mandatory defense, proven VCF / Threat result | **No** |
| **Search / evidence** | Alpha-Beta, Pattern, Deep, PV, best replies, Threat analysis | evidence only |
| **Jev decision** | Atomic, Pairwise, Critic, Global Best, unresolved final arbitration | yes, inside the safe candidate set |

## What Jev actually does

### 1. Independent challenger

Jev Max intentionally separates heterogeneous recall order from the real Alpha-Beta leader.

Atomic judgment does not simply receive “Local says A is #1.” It receives board state and structured tactical/search evidence so Jev can form a genuine second opinion.

### 2. Candidate judge

Jev is strongest here when the engine has already reduced the board to a small set of legal, non-proven-losing moves.

It can compare evidence such as:

- local evaluation;
- deeper PV;
- opponent best replies;
- tactical safety;
- pattern strength;
- threat coverage;
- counter-threat risk.

### 3. Multi-view arbitration

Jev Max does not rely on one prompt-shaped question. The first request can evaluate multiple views in parallel:

- **Atomic** — how strong is each candidate on its own?
- **Pairwise** — which move is better head-to-head?
- **Critic** — how likely is the move to survive the opponent’s best reply?
- **Global Best** — independent best-move choice.
- **Recall Check** — is the main candidate set probably missing something?

If these views converge, one Jev request is enough. Difficult disagreements can use a second request.

### 4. Bounded wildcard discovery

Jev may signal that the main set is incomplete, but it cannot freely invent an unchecked move.

The program recalls a bounded wildcard pool, lets Jev choose from it, then re-validates legality and tactical safety before that move can enter the final set.

## What Jev is not allowed to override

Jev never has authority over:

1. illegal moves;
2. enabled black forbidden-move rules;
3. an immediate winning move;
4. a unique mandatory defense against an immediate loss;
5. a proven VCF / Threat-space forced result;
6. candidates already proven to lose;
7. wildcard safety validation.

A core rule in the codebase is:

> **No proof found is not the same as safe.**

Timeouts and incomplete searches remain unknown evidence rather than being silently promoted to “safe.”

## Semantic override guard

Historical real-game replays exposed an important failure mode: Jev could sometimes prefer a move that sounded strategically good while deeper search strongly preferred the production Local #1.

The current policy is intentionally narrow:

- Jev still sees the full safe candidate pool;
- Local #1 is not automatically privileged;
- only a **final Jev override of the actual Local #1** triggers the guard;
- previously computed Deep evidence is reused first;
- if still ambiguous, a focused two-root Worker search can jump to exact depth 8;
- a Local move removed by deterministic proof can never be resurrected;
- only large, clearly dangerous separations veto the semantic override.

Normal disagreements remain Jev decisions.

## Jev Max request budget

Current bounded target:

~~~text
Deterministic forced position: 0 Jev requests
Normal unresolved position:   1 Jev request
Hard disagreement:            2 Jev requests
~~~

The hard logical-request ceiling for Jev Max is 2 per move.

The browser also keeps heavy Worker concurrency bounded at 2.

## Modes

| Mode | Role of Jev |
|---|---|
| **Jev Max** | heterogeneous recall → Deep/Threat evidence → Atomic/Pairwise/Critic → optional final arbitration |
| **Jev Grandmaster** | tactical/Deep evidence first; Jev resolves disagreement |
| **Jev Master** | stronger local search creates candidates; Jev makes the final semantic choice |
| **Jev Intuition** | more direct Jev selection, kept as an experimental baseline |

Pure Local is not exposed as a normal player mode. It remains available internally for:

- deterministic search;
- fallback when Jev is unavailable;
- benchmark baselines.

## Renju / game configuration

Before a game you can configure:

- player as black or white;
- black overline forbidden rule;
- black double-four forbidden rule;
- black double-three forbidden rule.

When black overline is forbidden, black must make **exactly five** to win while white wins with five or more.

## Browser performance design

The project is intentionally bounded for normal browsers:

- heavy search runs in Web Workers;
- at most 2 heavy Worker slots are active;
- Workers persist across the game instead of being recreated for every stage;
- Alpha-Beta uses incremental Zobrist hashing;
- bounded transposition tables are reused across iterative depths and recent generations;
- candidate count stays small;
- Deep and Threat analysis focus on the candidate frontier;
- speculative Jev questions share one state instead of duplicating the board and policies;
- timeouts fail closed instead of falling back to expensive synchronous work.

The goal is not “search forever.” It is to maximize useful evidence per unit of browser compute.

## Transparent decision traces

Copied game records can include:

- candidate sources;
- Local / Deep / Pattern / Threat evidence;
- Atomic results;
- Pairwise comparisons;
- Critic results;
- principal variations;
- opponent best replies;
- wildcard proposal and validation;
- final Jev suggestion;
- semantic override guard;
- Jev request count and token usage;
- Local / Deep / Threat / total latency;
- Worker timeout and payload telemetry.

These traces are used directly as regression cases.

## Benchmarking

The repository keeps several benchmark arms:

| Arm | Purpose |
|---|---|
| `local` | deterministic baseline / fallback |
| `jev-final` | Local/Deep evidence followed by one Jev final decision |
| `jev-max` | full bounded multi-stage pipeline |
| `jev-blind` | diagnostic baseline where Jev faces the broad legal set |

Useful commands:

~~~bash
npm run benchmark:smoke
npm run benchmark:regression
npm run benchmark:mock
~~~

Real Jev benchmark calls cost money and require explicit confirmation:

~~~bash
export JEV_API_KEY='...'
npm run benchmark -- --seeds 6 --confirm-cost
~~~

Historical real-game replay:

~~~bash
BENCHMARK_CONFIRM=1 JEV_API_KEY='...' npm run benchmark:historical:real
~~~

See [benchmark/README.md](benchmark/README.md) for the benchmark contract and historical regression families.

## What the project currently concludes about Jev

### Poor fit: Jev as a replacement search engine

Gomoku contains too much exact combinatorial structure. Dedicated search is better for legality, forcing lines and tactical proof.

### Good fit: Jev as a finalist / reranker

Once code has produced a small legal candidate set with structured evidence, Jev’s typed choice/score/probability interface maps naturally to the problem.

### Very useful fit: hybrid decision-system research

The reusable pattern is:

~~~text
hard rules
+ bounded search
+ multiple evidence producers
+ structured Jev arbitration
+ post-decision verification
~~~

That pattern may transfer better to production software than the game-specific move logic itself.

## Beyond Gomoku

The most promising Jev-style applications are cases where software already knows the facts but fixed rules are brittle when choosing what to do next:

- ticket classification and routing;
- agent-run review and escalation;
- multi-model / multi-algorithm arbitration;
- recommendation or search reranking;
- exception triage for financial/reconciliation workflows;
- risk review with deterministic hard policy outside the model;
- low-latency structured control where a bounded option set already exists.

Less suitable uses include long-form generation, exact arithmetic, permissions, deterministic accounting rules, or deep sequential search that should be handled by code/search first.

For the full project retrospective, including all 146 commits present before the documentation rewrite and a discussion of where Jev may fit next, see:

**[JEV × Gomoku retrospective](docs/JEV-RETROSPECTIVE.md)**

## Jev / TypeSafe

Jev is TypeSafe’s System One model. The API takes a state plus typed questions and returns structured decisions rather than free-form prose.

Official references:

- [TypeSafe Quick Start](https://docs.typesafe.ai/introduction/quickstart)
- [TypeSafe Agent Skill](https://docs.typesafe.ai/agent-skill)
- [Introducing System One Models & Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev)

Vendor performance claims and demos should be validated against your own workload before production use.

## Security / request architecture

The browser does not call TypeSafe directly:

~~~text
Browser
   │ POST /api/jev
   ▼
Same-origin server
   │ Authorization: Bearer JEV_API_KEY
   ▼
TypeSafe /v1/systemone
~~~

`JEV_API_KEY` remains server-side and is not written into browser JS, HTML, localStorage or copied game records.

## Local development

Requires Node.js >= 22.13.

~~~bash
npm install
export JEV_API_KEY='your-api-key'
npm run dev
~~~

Run the full validation pipeline:

~~~bash
npm run check
~~~

This covers syntax checks, benchmark smoke/regression/mock runs and the production build.

## Repository notes

- Main application: `src/app.js`
- Jev client: `src/jev-client.js`
- Deep Worker: `public/deep-worker.js`
- Benchmark suite: `benchmark/`
- Full Jev experiment retrospective: `docs/JEV-RETROSPECTIVE.md`

---

**Core idea**

> Do not ask Jev to replace algorithms.  
> Let algorithms prove what they can prove.  
> Let Jev judge the unresolved choices.  
> Keep facts and hard constraints outside the model.
