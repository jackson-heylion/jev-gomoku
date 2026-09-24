/**
 * Real Jev replay over every distinct historical game family captured by the
 * regression suite. Each family starts at its earliest useful pre-blunder
 * snapshot; Jev Max plays WHITE and the production Ref Local engine plays BLACK.
 *
 * Paid API calls: requires JEV_API_KEY + BENCHMARK_CONFIRM=1.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadProductionEngine } from './harness.mjs';
import {
  BLACK,
  WHITE,
  Referee,
  cloneBoard,
  swapBoardColors,
  swappedHistory
} from './referee.mjs';

const UPSTREAM = 'https://api.typesafe.ai/v1/systemone';
const RETRYABLE = new Set([429, 529]);
const MAX_ATTEMPTS = 3;
const MODEL = process.env.JEV_MODEL || 'jev-latest';
const MODE = 'expert';
const DELAY_MS = Math.max(0, Number(process.env.JEV_BENCH_DELAY_MS) || 350);
const MAX_ADDITIONAL_PLIES = Math.max(8, Math.min(60, Number(process.env.HISTORICAL_MAX_ADDITIONAL_PLIES) || 30));
const OUTPUT_DIR = path.resolve('benchmark/results/historical-real');

const HISTORICAL_FAMILIES = [
  {
    id: 'straight-five',
    label: '9手直线五连败局',
    sourceSnapshots: ['straight-five pre-white-6'],
    moves: ['H8','G7','H7','G8','H6'],
    rules: { overline: true, fourFour: false, threeThree: false }
  },
  {
    id: 'old-level4',
    label: '旧 Level-4 威胁网络败局',
    sourceSnapshots: ['pre-I10@11','pre-I12@15','pre-K8@17'],
    moves: ['H8','G9','J10','I9','H9','H10','J8','I11','J12','F8','E7'],
    rules: { overline: true, fourFour: false, threeThree: false }
  },
  {
    id: 'recent-long-vcf',
    label: 'Recent 长局 / VCF 棋谱',
    sourceSnapshots: ['local-deep@17','threat-filter@21','vcf-lock@41'],
    moves: ['H8','G9','I8','G8','J8','G7','K8','L8','G6','G10','G11','H7','I10','I7','J7','F7','E7'],
    rules: { overline: true, fourFour: false, threeThree: false }
  },
  {
    id: 'recent-depth0',
    label: 'Recent depth=0 棋谱',
    sourceSnapshots: ['depth0@15'],
    moves: ['H8','G9','H9','H10','F8','G8','I11','G10','G7','G11','G12','F10','I10','D10','E10'],
    rules: { overline: true, fourFour: false, threeThree: false }
  },
  {
    id: 'coverage-37ply',
    label: '37手 Threat coverage 败局',
    sourceSnapshots: ['pre-G14@31'],
    moves: [
      'H8','G7','H7','H6','H9','H10','G6','G9','F8','G8','G10','I8','F11','E12','F7','F9',
      'H5','E8','I4','J3','F6','F4','G5','E10','I5','E11','E9','D11','C12','E14','E13'
    ],
    rules: { overline: true, fourFour: false, threeThree: false }
  },
  {
    id: 'real-49ply',
    label: '49手长局',
    sourceSnapshots: ['move36@35','move42@41','move44@43'],
    moves: [
      'H8','G9','H9','H10','H7','H6','G8','I11','F8','E8','I8','J8',
      'G6','F5','J9','K10','I6','F9','J5','K4','I7','I9','I5','I4',
      'K7','J7','J6','G11','F12','J12','K13','H4','K5','L4','J4'
    ],
    rules: { overline: true, fourFour: false, threeThree: false }
  },
  {
    id: 'diagonal-double-open-three',
    label: '第三局斜五星 / H9 双活三',
    sourceSnapshots: ['pre-I7@11'],
    moves: ['H8','G7','I9','G9','G8','F8','I8','J8','I10','I11','H10'],
    rules: { overline: false, fourFour: false, threeThree: false }
  }
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function retryDelayMs(response, attempt) {
  const header = response.headers.get('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(15000, seconds * 1000);
    const when = Date.parse(header);
    if (Number.isFinite(when)) return Math.max(0, Math.min(15000, when - Date.now()));
  }
  return Math.min(8000, 650 * (2 ** attempt));
}

function createTypeSafeRequest({ apiKey, delayMs, onRequest }) {
  let lastRequestAt = 0;
  return async function request({ payload, signal }) {
    const gap = Date.now() - lastRequestAt;
    if (gap < delayMs) await sleep(delayMs - gap);

    const started = performance.now();
    let lastResponse = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      lastRequestAt = Date.now();
      onRequest?.();
      const response = await fetch(UPSTREAM, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal
      });
      lastResponse = response;
      if (RETRYABLE.has(response.status) && attempt < MAX_ATTEMPTS - 1) {
        await sleep(retryDelayMs(response, attempt));
        continue;
      }

      const raw = await response.text();
      let data = null;
      try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
      if (!response.ok) {
        const error = new Error('TypeSafe request failed with HTTP ' + response.status);
        error.httpStatus = response.status;
        throw error;
      }
      const result = data || {};
      result.__client = {
        attempts: attempt + 1,
        cached: false,
        transport: 'historical-real',
        latencyMs: Math.round(performance.now() - started)
      };
      return result;
    }
    const error = new Error('TypeSafe request failed');
    error.httpStatus = lastResponse?.status || null;
    throw error;
  };
}

function blackReferenceDecision(engine, referee) {
  const swappedBoard = swapBoardColors(referee.board);
  const swappedMoves = swappedHistory(referee.moves);
  engine.setPosition(swappedBoard, swappedMoves, MODEL);
  const result = engine.local(MODE);
  const preferred = result.finalChoice;
  const ranked = unique([preferred, ...(result.candidates || []).map(move => move.key)]);

  for (const key of ranked) {
    const verdict = referee.inspect(key, BLACK);
    if (verdict.legal) return { key, verdict, substituted: key !== preferred };
  }

  referee.syncEngine();
  for (const key of engine.orderedBlack(32)) {
    const verdict = referee.inspect(key, BLACK);
    if (verdict.legal) return { key, verdict, substituted: true };
  }
  throw new Error('Black reference opponent found no legal move');
}

function summarizeDecision(result, latencyMs) {
  const shape = result?.decisionTrace?.requestShape || {};
  return {
    move: result.finalChoice,
    localChoice: result.localChoice || null,
    latencyMs: Math.round(latencyMs),
    logicalRequests: Number(shape.logicalRequests ?? result?.client?.logicalRequests ?? 0) || 0,
    httpRequests: Number(shape.httpRequests ?? result?.client?.attempts ?? 0) || 0,
    decisionAuthority: shape.decisionAuthority || null,
    deepDominanceApplied: Boolean(shape.deepDominanceApplied),
    deepDominanceLeader: shape.deepDominanceLeader || null,
    deepDominanceRejected: Array.isArray(shape.deepDominanceRejected) ? shape.deepDominanceRejected : [],
    overrideGuardVetoed: Boolean(shape.overrideGuardVetoed),
    overrideGuardElapsedMs: Number(shape.overrideGuardElapsedMs) || 0,
    overrideGuardReason: shape.overrideGuardReason || null,
    overrideGuardLocalMove: shape.overrideGuardLocalMove || null,
    overrideGuardSemanticMove: shape.overrideGuardSemanticMove || null,
    inputTokens: Number(result?.usage?.input_tokens) || 0,
    outputTokens: Number(result?.usage?.output_tokens) || 0,
    candidateCount: Number(shape.candidateCount ?? result?.candidates?.length ?? 0) || 0,
    stageNote: result?.stageNote || null
  };
}

async function playHistoricalFamily(engine, sample, index, total) {
  engine.setGameConfig({
    playerColor: 'black',
    overline: sample.rules.overline,
    fourFour: sample.rules.fourFour,
    threeThree: sample.rules.threeThree
  });

  const maxPlies = Math.min(225, sample.moves.length + MAX_ADDITIONAL_PLIES);
  const referee = new Referee(engine, { model: MODEL, maxPlies });
  referee.reset(sample.moves);

  if (referee.toMove !== WHITE) {
    throw new Error(sample.id + ' snapshot must leave WHITE to move');
  }

  const decisions = [];
  const startPlies = referee.plies;
  process.stdout.write('[' + index + '/' + total + '] ' + sample.id + ' from ply ' + startPlies + ' ... ');

  while (!referee.finished) {
    if (referee.toMove === BLACK) {
      const black = blackReferenceDecision(engine, referee);
      referee.commit(black.key, BLACK, black.verdict);
      continue;
    }

    engine.setPosition(cloneBoard(referee.board), referee.moves.map(move => ({ ...move })), MODEL);
    const started = performance.now();
    let result;
    let fallback = false;
    let error = null;
    try {
      result = await engine.jevMax();
    } catch (err) {
      fallback = true;
      error = String(err?.message || err);
      engine.setPosition(cloneBoard(referee.board), referee.moves.map(move => ({ ...move })), MODEL);
      result = engine.local(MODE);
    }
    const latencyMs = performance.now() - started;
    const key = String(result.finalChoice || result?.answer?.choice || '').toUpperCase();
    const verdict = referee.inspect(key, WHITE);
    const decision = {
      ...summarizeDecision(result, latencyMs),
      fallback,
      error
    };
    decisions.push(decision);

    if (!verdict.legal) {
      referee.winner = BLACK;
      referee.winReason = 'white_foul';
      break;
    }
    referee.commit(key, WHITE, verdict);
  }

  if (!referee.winReason && !referee.winner) referee.winReason = 'max_additional_plies';
  const result = referee.winner === WHITE ? 'W' : referee.winner === BLACK ? 'L' : 'D';
  console.log(result + ' after +' + (referee.plies - startPlies) + ' plies');

  return {
    id: sample.id,
    label: sample.label,
    sourceSnapshots: sample.sourceSnapshots,
    initialPlies: startPlies,
    additionalPlies: referee.plies - startPlies,
    result,
    winner: referee.winner === WHITE ? 'jev-max' : referee.winner === BLACK ? 'ref-local' : null,
    winReason: referee.winReason,
    continuationMoves: referee.moves.slice(startPlies).map(move => move.coord),
    decisions,
    metrics: {
      jevTurns: decisions.length,
      zeroRequestTurns: decisions.filter(d => d.logicalRequests === 0).length,
      oneRequestTurns: decisions.filter(d => d.logicalRequests === 1).length,
      twoRequestTurns: decisions.filter(d => d.logicalRequests === 2).length,
      logicalRequests: decisions.reduce((sum, d) => sum + d.logicalRequests, 0),
      overrideGuardVetoes: decisions.filter(d => d.overrideGuardVetoed).length,
      overrideGuardChecks: decisions.filter(d => d.overrideGuardSemanticMove && d.overrideGuardLocalMove
        && d.overrideGuardSemanticMove !== d.overrideGuardLocalMove).length,
      overrideGuardElapsedMs: decisions.reduce((sum, d) => sum + d.overrideGuardElapsedMs, 0),
      httpRequests: decisions.reduce((sum, d) => sum + d.httpRequests, 0),
      inputTokens: decisions.reduce((sum, d) => sum + d.inputTokens, 0),
      outputTokens: decisions.reduce((sum, d) => sum + d.outputTokens, 0),
      avgLatencyMs: decisions.length
        ? Math.round(decisions.reduce((sum, d) => sum + d.latencyMs, 0) / decisions.length)
        : 0,
      maxLatencyMs: decisions.length ? Math.max(...decisions.map(d => d.latencyMs)) : 0,
      fallbacks: decisions.filter(d => d.fallback).length
    }
  };
}

function markdownReport(report) {
  const rows = report.games.map(game =>
    '| ' + game.id + ' | ' + game.initialPlies + ' | ' + game.result + ' | '
    + game.additionalPlies + ' | ' + game.metrics.jevTurns + ' | '
    + game.metrics.logicalRequests + ' | '
    + game.metrics.oneRequestTurns + '/' + game.metrics.twoRequestTurns + ' | '
    + game.metrics.overrideGuardVetoes + '/' + game.metrics.overrideGuardChecks + ' | '
    + game.metrics.inputTokens + '/' + game.metrics.outputTokens + ' | '
    + game.metrics.avgLatencyMs + ' |'
  ).join('\n');

  return [
    '# Jev Max 历史真实棋谱重放',
    '',
    '- 时间：' + report.generatedAt,
    '- 模型：' + report.model,
    '- 对手：Ref Local（生产 Local 颜色反转 + 真实规则裁判）',
    '- 历史棋谱族：' + report.summary.total,
    '- 最多续弈：每个样本 +' + report.maxAdditionalPlies + ' 手',
    '- API：TypeSafe System One 真实调用；API Key 不写入报告',
    '',
    '## 总结果',
    '',
    '- Jev Max：**' + report.summary.wins + ' 胜 / ' + report.summary.losses + ' 负 / ' + report.summary.draws + ' 和**',
    '- 1-request 回合：' + report.summary.oneRequestTurns + '/' + report.summary.jevTurns,
    '- 2-request 回合：' + report.summary.twoRequestTurns + '/' + report.summary.jevTurns,
    '- 总逻辑请求：' + report.summary.logicalRequests,
    '- Override Deep guard：' + report.summary.overrideGuardVetoes + ' veto / ' + report.summary.overrideGuardChecks + ' checks，额外 Worker ' + report.summary.overrideGuardElapsedMs + ' ms',
    '- Token：' + report.summary.inputTokens + ' input / ' + report.summary.outputTokens + ' output',
    '',
    '| 历史棋谱族 | 起始手数 | W/L/D | 续弈手数 | Jev回合 | 逻辑请求 | 1req/2req | Guard veto/check | in/out token | 平均决策ms |',
    '|---|---:|:---:|---:|---:|---:|---:|---:|---:|---:|',
    rows,
    ''
  ].join('\n');
}

async function main() {
  const apiKey = String(process.env.JEV_API_KEY || '').trim();
  if (process.env.BENCHMARK_CONFIRM !== '1') {
    throw new Error('Historical replay makes paid Jev calls; set BENCHMARK_CONFIRM=1');
  }
  if (!apiKey) throw new Error('JEV_API_KEY is required');

  let upstreamRequests = 0;
  const request = createTypeSafeRequest({
    apiKey,
    delayMs: DELAY_MS,
    onRequest: () => { upstreamRequests++; }
  });
  const engine = await loadProductionEngine({ request, deepWorker: 'thread' });

  console.log('Historical real-game replay: ' + HISTORICAL_FAMILIES.length + ' distinct game families.');
  console.log('JEV_API_KEY is loaded from the environment and will not be printed or written.');

  const games = [];
  for (let i = 0; i < HISTORICAL_FAMILIES.length; i++) {
    games.push(await playHistoricalFamily(engine, HISTORICAL_FAMILIES[i], i + 1, HISTORICAL_FAMILIES.length));
  }

  const summary = {
    total: games.length,
    wins: games.filter(g => g.result === 'W').length,
    losses: games.filter(g => g.result === 'L').length,
    draws: games.filter(g => g.result === 'D').length,
    jevTurns: games.reduce((sum, g) => sum + g.metrics.jevTurns, 0),
    zeroRequestTurns: games.reduce((sum, g) => sum + g.metrics.zeroRequestTurns, 0),
    oneRequestTurns: games.reduce((sum, g) => sum + g.metrics.oneRequestTurns, 0),
    twoRequestTurns: games.reduce((sum, g) => sum + g.metrics.twoRequestTurns, 0),
    logicalRequests: games.reduce((sum, g) => sum + g.metrics.logicalRequests, 0),
    overrideGuardVetoes: games.reduce((sum, g) => sum + g.metrics.overrideGuardVetoes, 0),
    overrideGuardChecks: games.reduce((sum, g) => sum + g.metrics.overrideGuardChecks, 0),
    overrideGuardElapsedMs: games.reduce((sum, g) => sum + g.metrics.overrideGuardElapsedMs, 0),
    httpRequests: games.reduce((sum, g) => sum + g.metrics.httpRequests, 0),
    upstreamRequests,
    inputTokens: games.reduce((sum, g) => sum + g.metrics.inputTokens, 0),
    outputTokens: games.reduce((sum, g) => sum + g.metrics.outputTokens, 0),
    fallbacks: games.reduce((sum, g) => sum + g.metrics.fallbacks, 0)
  };

  const report = {
    generatedAt: new Date().toISOString(),
    model: MODEL,
    maxAdditionalPlies: MAX_ADDITIONAL_PLIES,
    familyDefinition: 'Distinct historical game families; multiple regression snapshots from the same source game are deduplicated.',
    summary,
    games
  };

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUTPUT_DIR, 'latest.json'), JSON.stringify(report, null, 2) + '\n');
  await fs.writeFile(path.join(OUTPUT_DIR, 'latest.md'), markdownReport(report) + '\n');
  console.log(markdownReport(report));
}

await main();
