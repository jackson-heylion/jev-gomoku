import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadProductionEngine } from './harness.mjs';

const SIZE = 15;
const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;
const COLS = 'ABCDEFGHIJKLMNO'.split('');
const UPSTREAM = 'https://api.typesafe.ai/v1/systemone';
const RETRYABLE = new Set([429, 529]);
const MAX_ATTEMPTS = 3;

const ENGINE_LABELS = {
  local: 'Local',
  blind: 'Jev Blind',
  hybrid: 'Hybrid'
};

const OPENINGS = [
  { name: 'empty', moves: [] },
  { name: 'center-vertical', moves: ['H8', 'H9'] },
  { name: 'center-horizontal', moves: ['H8', 'I8'] },
  { name: 'center-diagonal-se', moves: ['H8', 'I9'] },
  { name: 'center-diagonal-sw', moves: ['H8', 'G9'] },
  { name: 'center-north', moves: ['H8', 'H7'] },
  { name: 'cross-east-west', moves: ['H8', 'I8', 'G8', 'I9'] },
  { name: 'cross-north-south', moves: ['H8', 'H9', 'H7', 'I8'] },
  { name: 'diagonal-pressure', moves: ['H8', 'I9', 'G7', 'I8'] },
  { name: 'offset-east', moves: ['H8', 'I8', 'I9', 'G8'] },
  { name: 'offset-west', moves: ['H8', 'G8', 'G9', 'I8'] },
  { name: 'balanced-four', moves: ['H8', 'I9', 'G9', 'I7'] }
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function other(color) {
  return color === BLACK ? WHITE : BLACK;
}

function coord(r, c) {
  return COLS[c] + String(r + 1);
}

function parseCoord(value) {
  const match = String(value || '').trim().toUpperCase().match(/^([A-O])(1[0-5]|[1-9])$/);
  if (!match) return null;
  return { c: COLS.indexOf(match[1]), r: Number(match[2]) - 1 };
}

function makeBoard() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(EMPTY));
}

function cloneBoard(board) {
  return board.map(row => row.slice());
}

function swapColor(color) {
  if (color === BLACK) return WHITE;
  if (color === WHITE) return BLACK;
  return EMPTY;
}

function swapBoardColors(board) {
  return board.map(row => row.map(swapColor));
}

function isWin(board, r, c, color) {
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
  return dirs.some(([dr, dc]) => {
    let count = 1;
    for (const sign of [-1, 1]) {
      let rr = r + dr * sign;
      let cc = c + dc * sign;
      while (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && board[rr][cc] === color) {
        count++;
        rr += dr * sign;
        cc += dc * sign;
      }
    }
    return count >= 5;
  });
}

function legalMoves(board) {
  const moves = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (board[r][c] === EMPTY) moves.push({ r, c, key: coord(r, c) });
    }
  }
  return moves;
}

function immediateWinningMoves(board, color) {
  const result = [];
  for (const move of legalMoves(board)) {
    board[move.r][move.c] = color;
    const win = isWin(board, move.r, move.c, color);
    board[move.r][move.c] = EMPTY;
    if (win) result.push(move.key);
  }
  return result;
}

function newGame(opening) {
  const board = makeBoard();
  const moves = [];
  let side = BLACK;

  for (const key of opening.moves) {
    const parsed = parseCoord(key);
    if (!parsed || board[parsed.r][parsed.c] !== EMPTY) {
      throw new Error('Invalid opening move: ' + key + ' in ' + opening.name);
    }
    board[parsed.r][parsed.c] = side;
    moves.push({
      r: parsed.r,
      c: parsed.c,
      color: side,
      coord: key,
      source: 'opening'
    });
    if (isWin(board, parsed.r, parsed.c, side)) {
      throw new Error('Opening already wins: ' + opening.name);
    }
    side = other(side);
  }

  return { board, moves, side };
}

function perspectiveForProduction(game, side) {
  if (side === WHITE) {
    return {
      board: cloneBoard(game.board),
      moves: game.moves.map(move => ({ ...move }))
    };
  }

  return {
    board: swapBoardColors(game.board),
    moves: game.moves.map(move => ({
      ...move,
      color: swapColor(move.color)
    }))
  };
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

function createTypeSafeRequest({ apiKey, delayMs }) {
  let lastRequestAt = 0;

  return async function request({ payload, signal }) {
    const gap = Date.now() - lastRequestAt;
    if (gap < delayMs) await sleep(delayMs - gap);

    const started = performance.now();
    let lastResponse = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      lastRequestAt = Date.now();
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
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        data = null;
      }

      if (!response.ok) {
        const error = new Error('TypeSafe request failed with HTTP ' + response.status);
        error.httpStatus = response.status;
        throw error;
      }

      const result = data || {};
      result.__client = {
        attempts: attempt + 1,
        cached: false,
        transport: 'benchmark-direct',
        latencyMs: Math.round(performance.now() - started)
      };
      return result;
    }

    const error = new Error('TypeSafe request failed');
    error.httpStatus = lastResponse ? lastResponse.status : null;
    throw error;
  };
}

function setProductionPosition(engine, game, side, model) {
  const view = perspectiveForProduction(game, side);
  engine.setPosition(view.board, view.moves, model);
}

function resultUsage(result) {
  const input = Number(result && result.usage && result.usage.input_tokens);
  const output = Number(result && result.usage && result.usage.output_tokens);
  return {
    input: Number.isFinite(input) ? input : 0,
    output: Number.isFinite(output) ? output : 0
  };
}

async function decide(engine, engineName, game, side, options) {
  let localResult;
  let result;
  let fallback = false;
  let error = null;

  if (engineName === 'local') {
    setProductionPosition(engine, game, side, options.model);
    const started = performance.now();
    result = engine.local(options.mode);
    const latencyMs = performance.now() - started;
    return buildDecisionRecord(engineName, game, side, result, result, latencyMs, fallback, error);
  }

  setProductionPosition(engine, game, side, options.model);
  localResult = engine.local(options.mode);

  setProductionPosition(engine, game, side, options.model);
  const started = performance.now();
  try {
    result = engineName === 'blind'
      ? await engine.blind()
      : await engine.hybrid(options.mode);
  } catch (err) {
    fallback = true;
    error = err;
    setProductionPosition(engine, game, side, options.model);
    result = engine.local(options.mode);
  }
  const latencyMs = performance.now() - started;

  return buildDecisionRecord(engineName, game, side, result, localResult, latencyMs, fallback, error);
}

function buildDecisionRecord(engineName, game, side, result, localResult, latencyMs, fallback, error) {
  const choice = String(result.finalChoice || (result.answer && result.answer.choice) || '').toUpperCase();
  const parsed = parseCoord(choice);
  if (!parsed || game.board[parsed.r][parsed.c] !== EMPTY) {
    throw new Error(ENGINE_LABELS[engineName] + ' produced illegal move: ' + choice);
  }

  const ownImmediateBefore = immediateWinningMoves(game.board, side);
  const oppImmediateBefore = immediateWinningMoves(game.board, other(side));
  const after = cloneBoard(game.board);
  after[parsed.r][parsed.c] = side;
  const winsNow = isWin(after, parsed.r, parsed.c, side);
  const oppImmediateAfter = winsNow ? [] : immediateWinningMoves(after, other(side));

  const localChoice = String(localResult.finalChoice || '').toUpperCase();
  const localCandidates = Array.isArray(localResult.candidates) ? localResult.candidates : [];
  const localRankIndex = localCandidates.findIndex(candidate => candidate.key === choice);
  const usage = resultUsage(result);
  const jevSuggested = result.jevSuggested ? String(result.jevSuggested).toUpperCase() : null;
  const client = result.client || null;

  return {
    choice,
    parsed,
    latencyMs: Math.round(latencyMs),
    confidence: Number.isFinite(result.answer && result.answer.confidence)
      ? result.answer.confidence
      : null,
    localChoice,
    localRank: localRankIndex >= 0 ? localRankIndex + 1 : null,
    disagreesWithLocal: Boolean(localChoice && choice !== localChoice),
    jevSuggested,
    jevDisagreesWithLocal: Boolean(jevSuggested && localChoice && jevSuggested !== localChoice),
    hybridOverride: engineName === 'hybrid' && Boolean(localChoice && choice !== localChoice),
    jevParticipated: Boolean(client),
    upstreamAttempts: client && Number.isFinite(client.attempts) ? client.attempts : 0,
    upstreamLatencyMs: client && Number.isFinite(client.latencyMs) ? client.latencyMs : null,
    inputTokens: usage.input,
    outputTokens: usage.output,
    fallback,
    error: error ? String(error.message || error) : null,
    tactical: {
      immediateWinsBefore: ownImmediateBefore,
      opponentImmediateWinsBefore: oppImmediateBefore,
      winsNow,
      missedImmediateWin: ownImmediateBefore.length > 0 && !winsNow,
      leftImmediateReply: !winsNow && oppImmediateAfter.length > 0,
      opponentImmediateWinsAfter: oppImmediateAfter
    }
  };
}

function applyDecision(game, decision, side, engineName) {
  const { r, c } = decision.parsed;
  game.board[r][c] = side;
  game.moves.push({
    r,
    c,
    color: side,
    coord: decision.choice,
    source: engineName
  });
  return isWin(game.board, r, c, side);
}

async function playGame(engine, blackEngine, whiteEngine, opening, options, gameIndex, gameTotal) {
  const game = newGame(opening);
  const records = [];
  let winner = null;
  let reason = 'max_moves';

  process.stdout.write(
    '[' + gameIndex + '/' + gameTotal + '] ' +
    ENGINE_LABELS[blackEngine] + ' (B) vs ' + ENGINE_LABELS[whiteEngine] +
    ' (W) · ' + opening.name + ' ... '
  );

  while (game.moves.length < options.maxMoves && legalMoves(game.board).length) {
    const side = game.side;
    const engineName = side === BLACK ? blackEngine : whiteEngine;
    const decision = await decide(engine, engineName, game, side, options);
    const win = applyDecision(game, decision, side, engineName);

    records.push({
      ply: game.moves.length,
      side: side === BLACK ? 'B' : 'W',
      engine: engineName,
      move: decision.choice,
      latencyMs: decision.latencyMs,
      upstreamLatencyMs: decision.upstreamLatencyMs,
      confidence: decision.confidence,
      localChoice: decision.localChoice,
      localRank: decision.localRank,
      disagreesWithLocal: decision.disagreesWithLocal,
      jevSuggested: decision.jevSuggested,
      jevDisagreesWithLocal: decision.jevDisagreesWithLocal,
      hybridOverride: decision.hybridOverride,
      jevParticipated: decision.jevParticipated,
      upstreamAttempts: decision.upstreamAttempts,
      inputTokens: decision.inputTokens,
      outputTokens: decision.outputTokens,
      fallback: decision.fallback,
      error: decision.error,
      tactical: decision.tactical
    });

    if (win) {
      winner = side;
      reason = 'five';
      break;
    }
    game.side = other(side);
  }

  if (!winner && legalMoves(game.board).length === 0) reason = 'board_full';

  const winnerEngine = winner === BLACK ? blackEngine : winner === WHITE ? whiteEngine : null;
  console.log(winnerEngine ? 'winner: ' + ENGINE_LABELS[winnerEngine] + ' in ' + game.moves.length + ' plies' : 'draw');

  return {
    blackEngine,
    whiteEngine,
    opening: opening.name,
    openingMoves: opening.moves,
    winner: winner === BLACK ? 'B' : winner === WHITE ? 'W' : null,
    winnerEngine,
    reason,
    plies: game.moves.length,
    moves: game.moves.map(move => move.coord),
    decisions: records
  };
}

function emptyEngineStats(name) {
  return {
    engine: name,
    games: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    points: 0,
    blackGames: 0,
    blackWins: 0,
    whiteGames: 0,
    whiteWins: 0,
    moves: 0,
    totalLatencyMs: 0,
    jevMoves: 0,
    upstreamAttempts: 0,
    inputTokens: 0,
    outputTokens: 0,
    fallbacks: 0,
    errors: 0,
    missedImmediateWins: 0,
    leftImmediateReplies: 0,
    disagreementsWithLocal: 0,
    jevDisagreementsWithLocal: 0,
    hybridOverrides: 0,
    outsideLocalCandidates: 0
  };
}

function summarize(games) {
  const stats = {
    local: emptyEngineStats('local'),
    blind: emptyEngineStats('blind'),
    hybrid: emptyEngineStats('hybrid')
  };

  for (const game of games) {
    if (game.blackEngine === game.whiteEngine) continue;

    for (const [color, engineName] of [['B', game.blackEngine], ['W', game.whiteEngine]]) {
      const item = stats[engineName];
      item.games++;
      if (color === 'B') item.blackGames++;
      else item.whiteGames++;

      if (!game.winnerEngine) {
        item.draws++;
        item.points += 0.5;
      } else if (game.winnerEngine === engineName) {
        item.wins++;
        item.points += 1;
        if (color === 'B') item.blackWins++;
        else item.whiteWins++;
      } else {
        item.losses++;
      }
    }

    for (const move of game.decisions) {
      const item = stats[move.engine];
      item.moves++;
      item.totalLatencyMs += move.latencyMs;
      if (move.jevParticipated) item.jevMoves++;
      item.upstreamAttempts += move.upstreamAttempts;
      item.inputTokens += move.inputTokens;
      item.outputTokens += move.outputTokens;
      if (move.fallback) item.fallbacks++;
      if (move.error) item.errors++;
      if (move.tactical.missedImmediateWin) item.missedImmediateWins++;
      if (move.tactical.leftImmediateReply) item.leftImmediateReplies++;
      if (move.disagreesWithLocal) item.disagreementsWithLocal++;
      if (move.jevDisagreesWithLocal) item.jevDisagreementsWithLocal++;
      if (move.hybridOverride) item.hybridOverrides++;
      if (move.localRank == null && move.engine !== 'local') item.outsideLocalCandidates++;
    }
  }

  for (const item of Object.values(stats)) {
    item.scoreRate = item.games ? item.points / item.games : 0;
    item.avgLatencyMs = item.moves ? item.totalLatencyMs / item.moves : 0;
    item.jevMoveRate = item.moves ? item.jevMoves / item.moves : 0;
    item.disagreementRate = item.moves ? item.disagreementsWithLocal / item.moves : 0;
    item.jevDisagreementRate = item.moves ? item.jevDisagreementsWithLocal / item.moves : 0;
    item.overrideRate = item.moves ? item.hybridOverrides / item.moves : 0;
    item.tacticalErrorRate = item.moves
      ? (item.missedImmediateWins + item.leftImmediateReplies) / item.moves
      : 0;
  }

  const pairwise = {};
  for (const game of games) {
    if (game.blackEngine === game.whiteEngine) continue;
    const names = [game.blackEngine, game.whiteEngine].sort();
    const key = names.join('_vs_');
    if (!pairwise[key]) {
      pairwise[key] = {
        a: names[0],
        b: names[1],
        games: 0,
        aWins: 0,
        bWins: 0,
        draws: 0
      };
    }
    const row = pairwise[key];
    row.games++;
    if (!game.winnerEngine) row.draws++;
    else if (game.winnerEngine === row.a) row.aWins++;
    else row.bWins++;
  }

  return { engines: stats, pairwise: Object.values(pairwise) };
}

function pairScore(summary, a, b) {
  const row = summary.pairwise.find(item =>
    (item.a === a && item.b === b) || (item.a === b && item.b === a)
  );
  if (!row || !row.games) return null;
  const wins = row.a === a ? row.aWins : row.bWins;
  return (wins + row.draws * 0.5) / row.games;
}

function generateRecommendations(summary, seedCount) {
  const recommendations = [];
  const local = summary.engines.local;
  const blind = summary.engines.blind;
  const hybrid = summary.engines.hybrid;
  const hybridVsLocal = pairScore(summary, 'hybrid', 'local');
  const blindVsHybrid = pairScore(summary, 'blind', 'hybrid');

  if (seedCount < 3) {
    recommendations.push({
      priority: 'P0',
      title: '先扩大样本再下棋力结论',
      detail: '当前 opening seed 少于 3。至少使用 3-5 个 opening seed，并保持每组交换黑白，避免先手优势和单一开局放大偶然结果。'
    });
  }

  if (hybrid.jevDisagreementsWithLocal > 0 && hybrid.hybridOverrides === 0) {
    recommendations.push({
      priority: 'P0',
      title: 'Jev 有分歧但最终从不改变落点',
      detail: 'Hybrid 中 Jev 已经与 Local 出现分歧，但没有真正改写 Local。检查 Jev 最终决策请求是否收到完整的 Local/深搜证据，以及候选集是否过窄或被过度过滤。'
    });
  }

  if (hybrid.jevMoveRate > 0.65 && hybrid.jevDisagreementRate < 0.10) {
    recommendations.push({
      priority: 'P1',
      title: '减少无效 Jev 调用',
      detail: 'Hybrid 大多数回合都调用 Jev，但 Jev 很少与 Local 分歧。可以只在 Local 前两名分差小、战术不明确或局面复杂时调用 Jev，预计能明显降低延迟和 Token 消耗。'
    });
  }

  if (blind.tacticalErrorRate > 0) {
    recommendations.push({
      priority: 'P0',
      title: 'Blind 需要硬战术护栏',
      detail: 'Jev Blind 出现漏立即取胜或给对手留下立即取胜点的情况。Blind 可继续作为基线，但产品模式不应让 Jev 绕过必胜/必防检查。'
    });
  }

  if (hybrid.tacticalErrorRate > 0) {
    recommendations.push({
      priority: 'P0',
      title: 'Hybrid 的硬战术过滤仍有漏洞',
      detail: 'Hybrid 仍出现立即战术错误。应优先检查 forced win/block、候选过滤和最终融合后的合法性/安全性验证，这类错误优先级高于继续调权重。'
    });
  }

  if (hybridVsLocal != null && hybridVsLocal < 0.5) {
    recommendations.push({
      priority: 'P1',
      title: '先收紧 Jev 对 Local 的改写权限',
      detail: '交换黑白后 Hybrid 对 Local 的得分率低于 50%。优先检查候选过滤质量、深搜证据质量和 Jev 最终决策提示，不要退回简单加权融合。'
    });
  } else if (hybridVsLocal != null && hybridVsLocal > 0.55) {
    recommendations.push({
      priority: 'P2',
      title: 'Hybrid 已显示增益，继续优化成本而不是激进改权重',
      detail: '交换黑白后 Hybrid 对 Local 有正向表现。下一步优先减少低价值调用、缩小候选数量和增加结果缓存，保持战术护栏不变。'
    });
  }

  if (blindVsHybrid != null && blindVsHybrid > 0.55) {
    recommendations.push({
      priority: 'P1',
      title: '检查 Hybrid 是否被 Local 候选集限制',
      detail: 'Jev Blind 对 Hybrid 的表现反而更好。重点检查 Local 候选是否漏掉关键点，以及 candidate_facts 中 local_rank 是否对 Jev 形成过强锚定。'
    });
  }

  if (hybrid.moves && hybrid.outsideLocalCandidates === 0 && blind.outsideLocalCandidates > 0) {
    recommendations.push({
      priority: 'P2',
      title: '记录 Jev Blind 落在 Local 候选集之外的优质手',
      detail: 'Blind 会选择 Local 候选集之外的点。把这些局面单独保存，使用更深 Local/VCF/VCT 做离线复核，可以直接发现候选生成器的召回率问题。'
    });
  }

  const totalBlackWins = summary.engines.local.blackWins + summary.engines.blind.blackWins + summary.engines.hybrid.blackWins;
  const totalWhiteWins = summary.engines.local.whiteWins + summary.engines.blind.whiteWins + summary.engines.hybrid.whiteWins;
  if (Math.abs(totalBlackWins - totalWhiteWins) >= Math.max(2, Math.round((totalBlackWins + totalWhiteWins) * 0.3))) {
    recommendations.push({
      priority: 'P2',
      title: '继续严格交换黑白，避免把先手优势当成引擎优势',
      detail: '当前黑白胜局数量差异较明显。五子棋先手影响很大，所有结论都应基于同一 opening 的双向换色结果。'
    });
  }

  if (!recommendations.length) {
    recommendations.push({
      priority: 'P2',
      title: '当前没有明显单点问题',
      detail: '继续增加 opening seed，并重点观察 Hybrid vs Local 的换色得分、Jev/Local 分歧率、战术错误率和每局 Token。'
    });
  }

  return recommendations;
}

function pct(value) {
  return (value * 100).toFixed(1) + '%';
}

function num(value) {
  return Number(value || 0).toFixed(0);
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Local / Jev Blind / Hybrid Benchmark');
  lines.push('');
  lines.push('- Time: ' + report.generatedAt);
  lines.push('- Opening seeds: ' + report.config.seedCount);
  lines.push('- Games: ' + report.games.length);
  lines.push('- Search mode: ' + report.config.mode);
  lines.push('- Model: ' + report.config.model);
  lines.push('- Max plies: ' + report.config.maxMoves);
  lines.push('');
  lines.push('## Engine summary');
  lines.push('');
  lines.push('| Engine | W-L-D | Score | Avg latency | Jev moves | Tokens in/out | Tactical errors | vs Local disagreement |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const key of ['local', 'blind', 'hybrid']) {
    const item = report.summary.engines[key];
    lines.push(
      '| ' + ENGINE_LABELS[key] +
      ' | ' + item.wins + '-' + item.losses + '-' + item.draws +
      ' | ' + pct(item.scoreRate) +
      ' | ' + num(item.avgLatencyMs) + ' ms' +
      ' | ' + item.jevMoves + '/' + item.moves +
      ' | ' + item.inputTokens + '/' + item.outputTokens +
      ' | ' + (item.missedImmediateWins + item.leftImmediateReplies) +
      ' | ' + pct(item.disagreementRate) + ' |'
    );
  }

  lines.push('');
  lines.push('## Pairwise');
  lines.push('');
  lines.push('| Matchup | Games | A wins | B wins | Draws |');
  lines.push('|---|---:|---:|---:|---:|');
  for (const row of report.summary.pairwise) {
    lines.push(
      '| ' + ENGINE_LABELS[row.a] + ' vs ' + ENGINE_LABELS[row.b] +
      ' | ' + row.games +
      ' | ' + row.aWins +
      ' | ' + row.bWins +
      ' | ' + row.draws + ' |'
    );
  }

  lines.push('');
  lines.push('## Optimization directions');
  lines.push('');
  for (const item of report.recommendations) {
    lines.push('- **' + item.priority + ' · ' + item.title + '** — ' + item.detail);
  }

  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push('- Local and Hybrid call the actual production decision code from src/app.js.');
  lines.push('- Black turns reuse the production WHITE-perspective engine by swapping stone colors, so the same production logic is tested on both sides.');
  lines.push('- Jev Blind receives the raw board and all legal moves, without Local candidate ranking/facts.');
  lines.push('- Hybrid uses the current production candidate filtering, Atomic + Pairwise batching, and fusion weights.');
  lines.push('- Benchmark results never contain JEV_API_KEY.');
  lines.push('');
  return lines.join('\n');
}

async function writeReport(report, outputDir) {
  await fs.mkdir(outputDir, { recursive: true });
  const safeTime = report.generatedAt.replace(/[:.]/g, '-');
  const json = JSON.stringify(report, null, 2);
  const markdown = renderMarkdown(report);

  await fs.writeFile(path.join(outputDir, 'latest.json'), json);
  await fs.writeFile(path.join(outputDir, 'latest.md'), markdown);
  await fs.writeFile(path.join(outputDir, safeTime + '.json'), json);
  await fs.writeFile(path.join(outputDir, safeTime + '.md'), markdown);

  return {
    json: path.join(outputDir, 'latest.json'),
    markdown: path.join(outputDir, 'latest.md')
  };
}

async function runSmoke() {
  const engine = await loadProductionEngine({
    request: async () => {
      throw new Error('Smoke test must not call Jev');
    }
  });

  const emptyGame = newGame(OPENINGS[0]);
  setProductionPosition(engine, emptyGame, BLACK, 'jev-latest');
  const first = engine.local('strong');
  const parsed = parseCoord(first.finalChoice);
  if (!parsed || emptyGame.board[parsed.r][parsed.c] !== EMPTY) {
    throw new Error('Local smoke test returned illegal first move');
  }

  emptyGame.board[parsed.r][parsed.c] = BLACK;
  emptyGame.moves.push({
    r: parsed.r,
    c: parsed.c,
    color: BLACK,
    coord: first.finalChoice,
    source: 'local-smoke'
  });
  emptyGame.side = WHITE;

  setProductionPosition(engine, emptyGame, WHITE, 'jev-latest');
  const second = engine.local('strong');
  const parsedSecond = parseCoord(second.finalChoice);
  if (!parsedSecond || emptyGame.board[parsedSecond.r][parsedSecond.c] !== EMPTY) {
    throw new Error('Local smoke test returned illegal reply');
  }

  console.log('Benchmark smoke OK: ' + first.finalChoice + ' -> ' + second.finalChoice);
}

async function main() {
  const { values } = parseArgs({
    options: {
      smoke: { type: 'boolean', default: false },
      seeds: { type: 'string', default: '1' },
      games: { type: 'string' },
      mode: { type: 'string', default: 'expert' },
      model: { type: 'string', default: 'jev-latest' },
      'max-moves': { type: 'string', default: '60' },
      'delay-ms': { type: 'string', default: '350' },
      output: { type: 'string', default: 'benchmark/results' },
      'confirm-cost': { type: 'boolean', default: false }
    }
  });

  if (values.smoke) {
    await runSmoke();
    return;
  }

  const seedCount = Math.max(1, Math.min(OPENINGS.length, Number(values.games || values.seeds) || 1));
  const maxMoves = Math.max(10, Math.min(SIZE * SIZE, Number(values['max-moves']) || 60));
  const delayMs = Math.max(0, Number(values['delay-ms']) || 0);
  const mode = values.mode === 'strong' ? 'strong' : 'expert';
  const model = values.model || 'jev-latest';
  const confirmed = values['confirm-cost'] || process.env.BENCHMARK_CONFIRM === '1';
  const apiKey = String(process.env.JEV_API_KEY || '').trim();

  if (!confirmed) {
    throw new Error(
      'Benchmark can make many paid Jev calls. Re-run with --confirm-cost or BENCHMARK_CONFIRM=1.'
    );
  }
  if (!apiKey) {
    throw new Error('JEV_API_KEY is required for Jev Blind / Hybrid benchmark.');
  }

  const request = createTypeSafeRequest({ apiKey, delayMs });
  const engine = await loadProductionEngine({ request });
  const openings = OPENINGS.slice(0, seedCount);
  const pairings = [
    ['local', 'blind'],
    ['local', 'hybrid'],
    ['blind', 'hybrid']
  ];
  const gamePlans = [];

  for (const opening of openings) {
    for (const [a, b] of pairings) {
      gamePlans.push({ black: a, white: b, opening });
      gamePlans.push({ black: b, white: a, opening });
    }
  }

  console.log('Running ' + gamePlans.length + ' games (' + seedCount + ' opening seed(s), swapped colors).');
  console.log('JEV_API_KEY is loaded from the environment and will not be printed or written.');

  const games = [];
  for (let i = 0; i < gamePlans.length; i++) {
    const plan = gamePlans[i];
    const game = await playGame(
      engine,
      plan.black,
      plan.white,
      plan.opening,
      { mode, model, maxMoves },
      i + 1,
      gamePlans.length
    );
    games.push(game);
  }

  const summary = summarize(games);
  const recommendations = generateRecommendations(summary, seedCount);
  const report = {
    generatedAt: new Date().toISOString(),
    config: {
      seedCount,
      openings: openings.map(opening => ({ name: opening.name, moves: opening.moves })),
      mode,
      model,
      maxMoves,
      delayMs,
      gamesPlanned: gamePlans.length
    },
    summary,
    recommendations,
    games
  };

  const paths = await writeReport(report, values.output);
  console.log('');
  console.log(renderMarkdown(report));
  console.log('');
  console.log('JSON: ' + paths.json);
  console.log('Markdown: ' + paths.markdown);
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
