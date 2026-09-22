const SIZE = 15;
const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;
const MATE_SCORE = 1e14;
const LINE_WEIGHTS = [0, 2, 28, 520, 32000, 1000000000];
const TIMEOUT = Symbol('timeout');

const WIN_SEGMENTS = (() => {
  const result = [];
  const dirs = [[1,0],[0,1],[1,1],[1,-1]];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      for (const [dr, dc] of dirs) {
        const er = r + dr * 4;
        const ec = c + dc * 4;
        if (er < 0 || er >= SIZE || ec < 0 || ec >= SIZE) continue;
        const cells = [];
        for (let k = 0; k < 5; k++) cells.push([r + dr * k, c + dc * k]);
        result.push(cells);
      }
    }
  }
  return result;
})();

let board;
let rootSide;
let opponentSide;
let deadline;
let nodes;
let hashA = 0;
let hashB = 0;
const TT_MAX_ENTRIES = 60000;

function mix32(value) {
  let x = value >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

function hashStone(r, c, color, salt) {
  return mix32((((r * SIZE + c + 1) * 3 + color) ^ salt) >>> 0);
}

function toggleHash(r, c, color) {
  hashA = (hashA ^ hashStone(r, c, color, 0x9e3779b9)) >>> 0;
  hashB = (hashB ^ hashStone(r, c, color, 0x85ebca6b)) >>> 0;
}

function initializeHash() {
  hashA = 0;
  hashB = 0;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const color = board[r][c];
      if (color !== EMPTY) toggleHash(r, c, color);
    }
  }
}

function playMove(move, color) {
  board[move.r][move.c] = color;
  toggleHash(move.r, move.c, color);
}

function undoMove(move, color) {
  toggleHash(move.r, move.c, color);
  board[move.r][move.c] = EMPTY;
}

function cachePut(cache, key, entry) {
  if (cache.size < TT_MAX_ENTRIES) cache.set(key, entry);
}

function otherColor(color) {
  return color === WHITE ? BLACK : WHITE;
}

function coordToPoint(key) {
  const match = String(key || '').toUpperCase().match(/^([A-O])(1[0-5]|[1-9])$/);
  if (!match) return null;
  return {
    c: match[1].charCodeAt(0) - 65,
    r: Number(match[2]) - 1,
    key: match[1] + match[2]
  };
}

function assertTime() {
  nodes++;
  if ((nodes & 127) === 0 && performance.now() >= deadline) throw TIMEOUT;
}

function isWin(r, c, color) {
  const dirs = [[1,0],[0,1],[1,1],[1,-1]];
  for (const [dr, dc] of dirs) {
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
    if (count >= 5) return true;
  }
  return false;
}

function evaluateStatic() {
  assertTime();
  let whiteScore = 0;
  for (const seg of WIN_SEGMENTS) {
    let w = 0;
    let b = 0;
    for (const [r, c] of seg) {
      const value = board[r][c];
      if (value === WHITE) w++;
      else if (value === BLACK) b++;
    }
    if (w && b) continue;
    if (w) whiteScore += LINE_WEIGHTS[w];
    else if (b) whiteScore -= LINE_WEIGHTS[b] * 1.16;
  }

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const value = board[r][c];
      if (value === EMPTY) continue;
      const d = Math.max(Math.abs(r - 7), Math.abs(c - 7));
      const bonus = Math.max(0, 8 - d) * .45;
      whiteScore += value === WHITE ? bonus : -bonus;
    }
  }

  return rootSide === WHITE ? whiteScore : -whiteScore;
}

function nearbyMoves(radius = 2) {
  assertTime();
  let hasStone = false;
  const set = new Set();
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (board[r][c] === EMPTY) continue;
      hasStone = true;
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          if (!dr && !dc) continue;
          const rr = r + dr;
          const cc = c + dc;
          if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE || board[rr][cc] !== EMPTY) continue;
          set.add(rr * SIZE + cc);
        }
      }
    }
  }
  if (!hasStone) return [{ r: 7, c: 7, key: 'H8' }];
  return [...set].map(value => {
    const r = Math.floor(value / SIZE);
    const c = value % SIZE;
    return { r, c, key: String.fromCharCode(65 + c) + String(r + 1) };
  });
}

function wouldWin(move, color) {
  if (board[move.r][move.c] !== EMPTY) return false;
  playMove(move, color);
  const win = isWin(move.r, move.c, color);
  undoMove(move, color);
  return win;
}

function immediateWins(color, radius = 2) {
  const result = [];
  for (const move of nearbyMoves(radius)) {
    assertTime();
    if (wouldWin(move, color)) result.push(move);
  }
  return result;
}

function localConnectivity(r, c, color) {
  let allies = 0;
  let enemies = 0;
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      if (!dr && !dc) continue;
      const rr = r + dr;
      const cc = c + dc;
      if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) continue;
      if (board[rr][cc] === color) allies += Math.abs(dr) <= 1 && Math.abs(dc) <= 1 ? 2 : 1;
      else if (board[rr][cc] === otherColor(color)) enemies++;
    }
  }
  return { allies, enemies };
}

function quickMoveScore(move, color) {
  playMove(move, color);
  let score;
  if (isWin(move.r, move.c, color)) {
    score = MATE_SCORE;
  } else {
    const base = evaluateStatic();
    const signedBase = color === rootSide ? base : -base;
    const conn = localConnectivity(move.r, move.c, color);
    score = signedBase + conn.allies * 18 + conn.enemies * 5;
  }
  undoMove(move, color);
  return score;
}

function orderedMoves(color, limit, radius = 2) {
  const wins = immediateWins(color, radius);
  if (wins.length) return wins.slice(0, limit);

  const blocks = immediateWins(otherColor(color), radius);
  if (blocks.length) {
    return blocks
      .map(move => ({ ...move, quick: quickMoveScore(move, color) }))
      .sort((a, b) => b.quick - a.quick)
      .slice(0, limit);
  }

  return nearbyMoves(radius)
    .map(move => ({ ...move, quick: quickMoveScore(move, color) }))
    .sort((a, b) => b.quick - a.quick)
    .slice(0, limit);
}

function boardKey(toMove, depth) {
  return toMove + ':' + depth + ':' + hashA + ':' + hashB;
}

function alphaBeta(depth, alpha, beta, toMove, branch, radius, cache) {
  assertTime();
  if (depth <= 0) return evaluateStatic();

  const cacheKey = boardKey(toMove, depth);
  const alphaStart = alpha;
  const betaStart = beta;
  const cached = cache.get(cacheKey);
  if (cached) {
    if (cached.flag === 'EXACT') return cached.value;
    if (cached.flag === 'LOWER') alpha = Math.max(alpha, cached.value);
    else if (cached.flag === 'UPPER') beta = Math.min(beta, cached.value);
    if (alpha >= beta) return cached.value;
  }

  const immediate = immediateWins(toMove, radius);
  if (immediate.length) {
    const score = toMove === rootSide ? MATE_SCORE + depth : -MATE_SCORE - depth;
    cachePut(cache, cacheKey, { value: score, flag: 'EXACT' });
    return score;
  }

  const localBranch = Math.max(4, branch - (depth <= 2 ? 2 : depth <= 4 ? 1 : 0));
  const candidates = orderedMoves(toMove, localBranch, radius);
  if (!candidates.length) return evaluateStatic();

  const maximizing = toMove === rootSide;
  let value = maximizing ? -Infinity : Infinity;

  for (const move of candidates) {
    assertTime();
    playMove(move, toMove);
    let child;
    if (isWin(move.r, move.c, toMove)) {
      child = maximizing ? MATE_SCORE + depth : -MATE_SCORE - depth;
    } else {
      child = alphaBeta(depth - 1, alpha, beta, otherColor(toMove), branch, radius, cache);
    }
    undoMove(move, toMove);

    if (maximizing) {
      value = Math.max(value, child);
      alpha = Math.max(alpha, value);
    } else {
      value = Math.min(value, child);
      beta = Math.min(beta, value);
    }
    if (beta <= alpha) break;
  }

  let flag = 'EXACT';
  if (value <= alphaStart) flag = 'UPPER';
  else if (value >= betaStart) flag = 'LOWER';
  cachePut(cache, cacheKey, { value, flag });
  return value;
}

function evaluateRootCandidate(move, depth, branch, radius, cache) {
  assertTime();
  if (!move || board[move.r]?.[move.c] !== EMPTY) return -Infinity;

  playMove(move, rootSide);
  let score;
  if (isWin(move.r, move.c, rootSide)) {
    score = MATE_SCORE * 10;
  } else {
    score = alphaBeta(depth - 1, -Infinity, Infinity, opponentSide, branch, radius, cache);
    score += evaluateStatic() * .035;
  }
  undoMove(move, rootSide);
  return score;
}

function runSearch(message) {
  board = message.board.map(row => row.slice());
  rootSide = message.side === BLACK ? BLACK : WHITE;
  opponentSide = otherColor(rootSide);
  nodes = 0;
  initializeHash();

  const candidates = (message.candidates || [])
    .map(coordToPoint)
    .filter(Boolean)
    .filter(move => board[move.r]?.[move.c] === EMPTY);

  if (!candidates.length) throw new Error('No legal deep-search candidates');

  const started = performance.now();
  const budgetMs = Math.max(250, Math.min(5000, Number(message.timeBudgetMs) || 1800));
  deadline = started + budgetMs;

  const maxDepth = Math.max(3, Math.min(8, Number(message.maxDepth) || 7));
  const branch = Math.max(4, Math.min(9, Number(message.branch) || 7));
  const radius = 2;

  let completed = null;
  let timedOut = false;

  for (let depth = 3; depth <= maxDepth; depth++) {
    const cache = new Map();
    const scores = [];
    try {
      for (const move of candidates) {
        const score = evaluateRootCandidate(move, depth, branch, radius, cache);
        scores.push({ move: move.key, score });
      }
      scores.sort((a, b) => b.score - a.score);
      completed = { depth, scores };
    } catch (error) {
      if (error === TIMEOUT) {
        timedOut = true;
        break;
      }
      throw error;
    }
  }

  if (!completed) {
    // The deadline may already have expired. Do not start another expensive
    // evaluation after timeout; keep the caller's first candidate as the safe fallback.
    completed = {
      depth: 0,
      scores: candidates.map((move, index) => ({
        move: move.key,
        score: index === 0 ? 0 : -index
      }))
    };
    timedOut = true;
  }

  return {
    status: 'completed',
    source: 'web-worker',
    winner: completed.scores[0]?.move || candidates[0].key,
    depthReached: completed.depth,
    scores: completed.scores,
    timedOut,
    nodes,
    elapsedMs: Math.round(performance.now() - started),
    budgetMs,
    branch
  };
}

self.onmessage = event => {
  const message = event.data || {};
  const id = message.id;
  try {
    const result = runSearch(message);
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: String(error?.message || error || 'deep worker failed')
    });
  }
};
