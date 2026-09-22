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
let ruleConfig = { overline: true, fourFour: true, threeThree: true };
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
  if (cache.has(key) || cache.size < TT_MAX_ENTRIES) cache.set(key, entry);
}

function otherColor(color) {
  return color === WHITE ? BLACK : WHITE;
}

function applyRuleConfig(value) {
  ruleConfig = {
    overline: value?.overline !== false,
    fourFour: value?.fourFour !== false,
    threeThree: value?.threeThree !== false
  };
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

const RENJU_DIRS = [[1,0],[0,1],[1,1],[1,-1]];
const RENJU_MAX_RECURSION = 4;

function inBounds(r, c) {
  return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
}

function lineLength(r, c, color, dr, dc) {
  let count = 1;
  for (const sign of [-1, 1]) {
    let rr = r + dr * sign;
    let cc = c + dc * sign;
    while (inBounds(rr, cc) && board[rr][cc] === color) {
      count++;
      rr += dr * sign;
      cc += dc * sign;
    }
  }
  return count;
}

function hasExactFiveAt(r, c, color) {
  return RENJU_DIRS.some(([dr, dc]) => lineLength(r, c, color, dr, dc) === 5);
}

function hasOverlineAt(r, c, color) {
  return RENJU_DIRS.some(([dr, dc]) => lineLength(r, c, color, dr, dc) >= 6);
}

function isWin(r, c, color) {
  if (color === BLACK) {
    if (ruleConfig.overline) return hasExactFiveAt(r, c, BLACK);
    return RENJU_DIRS.some(([dr, dc]) => lineLength(r, c, BLACK, dr, dc) >= 5);
  }
  return RENJU_DIRS.some(([dr, dc]) => lineLength(r, c, WHITE, dr, dc) >= 5);
}

function contiguousRunCells(r, c, color, dr, dc) {
  const negative = [];
  let rr = r - dr;
  let cc = c - dc;
  while (inBounds(rr, cc) && board[rr][cc] === color) {
    negative.push([rr, cc]);
    rr -= dr;
    cc -= dc;
  }
  negative.reverse();

  const positive = [];
  rr = r + dr;
  cc = c + dc;
  while (inBounds(rr, cc) && board[rr][cc] === color) {
    positive.push([rr, cc]);
    rr += dr;
    cc += dc;
  }
  return [...negative, [r, c], ...positive];
}

function collectBlackFoursThrough(r, c) {
  const fours = new Map();
  RENJU_DIRS.forEach(([dr, dc], dirIndex) => {
    for (let start = -4; start <= 0; start++) {
      const cells = [];
      let valid = true;
      for (let k = 0; k < 5; k++) {
        const rr = r + (start + k) * dr;
        const cc = c + (start + k) * dc;
        if (!inBounds(rr, cc)) {
          valid = false;
          break;
        }
        cells.push([rr, cc]);
      }
      if (!valid) continue;

      const blackCells = [];
      const emptyCells = [];
      let blocked = false;
      for (const [rr, cc] of cells) {
        if (board[rr][cc] === BLACK) blackCells.push([rr, cc]);
        else if (board[rr][cc] === EMPTY) emptyCells.push([rr, cc]);
        else {
          blocked = true;
          break;
        }
      }
      if (blocked || blackCells.length !== 4 || emptyCells.length !== 1) continue;

      const [er, ec] = emptyCells[0];
      board[er][ec] = BLACK;
      const makesExactFive = lineLength(er, ec, BLACK, dr, dc) === 5;
      board[er][ec] = EMPTY;
      if (!makesExactFive) continue;

      const stoneKey = blackCells
        .map(([rr, cc]) => rr * SIZE + cc)
        .sort((a, b) => a - b)
        .join('-');
      fours.set(dirIndex + ':' + stoneKey, true);
    }
  });
  return fours.size;
}

function straightFourCreatedByExtension(originR, originC, extR, extC, dr, dc) {
  const run = contiguousRunCells(extR, extC, BLACK, dr, dc);
  if (run.length !== 4) return null;
  if (!run.some(([rr, cc]) => rr === originR && cc === originC)) return null;

  const first = run[0];
  const last = run[run.length - 1];
  const left = [first[0] - dr, first[1] - dc];
  const right = [last[0] + dr, last[1] + dc];
  if (!inBounds(left[0], left[1]) || !inBounds(right[0], right[1])) return null;
  if (board[left[0]][left[1]] !== EMPTY || board[right[0]][right[1]] !== EMPTY) return null;

  for (const [rr, cc] of [left, right]) {
    board[rr][cc] = BLACK;
    const exact = lineLength(rr, cc, BLACK, dr, dc) === 5;
    board[rr][cc] = EMPTY;
    if (!exact) return null;
  }
  return run;
}

function collectRealBlackThreesThrough(r, c, depth) {
  const threes = new Map();
  RENJU_DIRS.forEach(([dr, dc], dirIndex) => {
    for (let offset = -4; offset <= 4; offset++) {
      if (!offset) continue;
      const er = r + offset * dr;
      const ec = c + offset * dc;
      if (!inBounds(er, ec) || board[er][ec] !== EMPTY) continue;

      board[er][ec] = BLACK;
      const makesFive = hasExactFiveAt(er, ec, BLACK);
      const run = makesFive ? null : straightFourCreatedByExtension(r, c, er, ec, dr, dc);
      let extensionLegal = Boolean(run);
      if (extensionLegal) extensionLegal = !blackForbiddenInfoPlaced(er, ec, depth + 1).forbidden;

      if (extensionLegal && run) {
        const existing = run.filter(([rr, cc]) => !(rr === er && cc === ec));
        if (existing.length === 3 && existing.some(([rr, cc]) => rr === r && cc === c)) {
          const stoneKey = existing
            .map(([rr, cc]) => rr * SIZE + cc)
            .sort((a, b) => a - b)
            .join('-');
          threes.set(dirIndex + ':' + stoneKey, true);
        }
      }
      board[er][ec] = EMPTY;
    }
  });
  return threes.size;
}

function potentialBlackThreeDirections(r, c) {
  let directions = 0;
  for (const [dr, dc] of RENJU_DIRS) {
    let nearbyBlack = 0;
    for (let offset = -4; offset <= 4; offset++) {
      if (!offset) continue;
      const rr = r + offset * dr;
      const cc = c + offset * dc;
      if (inBounds(rr, cc) && board[rr][cc] === BLACK) nearbyBlack++;
    }
    if (nearbyBlack >= 2) directions++;
  }
  return directions;
}

function blackForbiddenInfoPlaced(r, c, depth = 0) {
  const exactFive = hasExactFiveAt(r, c, BLACK);
  const overline = hasOverlineAt(r, c, BLACK);
  if (exactFive) return { forbidden: false, type: null };
  if (ruleConfig.overline && overline) return { forbidden: true, type: 'OVERLINE' };

  const fourCount = ruleConfig.fourFour || ruleConfig.threeThree ? collectBlackFoursThrough(r, c) : 0;
  if (ruleConfig.fourFour && fourCount >= 2) return { forbidden: true, type: 'FOUR_FOUR' };
  if (!ruleConfig.threeThree || depth >= RENJU_MAX_RECURSION || potentialBlackThreeDirections(r, c) < 2) {
    return { forbidden: false, type: null };
  }

  const threeCount = collectRealBlackThreesThrough(r, c, depth);
  if (threeCount >= 2) return { forbidden: true, type: 'THREE_THREE' };
  return { forbidden: false, type: null };
}

function blackForbiddenInfo(r, c) {
  if (!inBounds(r, c) || board[r][c] !== EMPTY) return { forbidden: true, type: 'OCCUPIED_OR_INVALID' };
  board[r][c] = BLACK;
  const result = blackForbiddenInfoPlaced(r, c, 0);
  board[r][c] = EMPTY;
  return result;
}

function isLegalMoveForColor(r, c, color) {
  if (!inBounds(r, c) || board[r][c] !== EMPTY) return false;
  if (color !== BLACK) return true;
  return !blackForbiddenInfo(r, c).forbidden;
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
    if (!isLegalMoveForColor(move.r, move.c, color)) continue;
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

function lineTokensThrough(r, c, color, dr, dc, span = 5) {
  const tokens = [];
  for (let offset = -span; offset <= span; offset++) {
    const rr = r + dr * offset;
    const cc = c + dc * offset;
    if (!inBounds(rr, cc)) tokens.push('#');
    else if (board[rr][cc] === color) tokens.push('O');
    else if (board[rr][cc] === EMPTY) tokens.push('.');
    else tokens.push('#');
  }
  return tokens;
}

function lineWinningCompletionIndexes(tokens, center) {
  const points = new Set();
  for (let start = 0; start <= tokens.length - 5; start++) {
    if (start > center || start + 4 < center) continue;
    let own = 0;
    let empty = 0;
    let emptyIndex = -1;
    let blocked = false;
    for (let i = start; i < start + 5; i++) {
      if (tokens[i] === '#') { blocked = true; break; }
      if (tokens[i] === 'O') own++;
      else if (tokens[i] === '.') { empty++; emptyIndex = i; }
    }
    if (!blocked && own === 4 && empty === 1) points.add(emptyIndex);
  }
  return points;
}

function directionalThreatPattern(r, c, color, dr, dc) {
  const tokens = lineTokensThrough(r, c, color, dr, dc);
  const center = 5;
  const completions = lineWinningCompletionIndexes(tokens, center);
  const openThreeExtensions = new Set();
  let twoPotential = 0;

  for (let start = 0; start <= tokens.length - 6; start++) {
    if (start > center || start + 5 < center) continue;
    const window = tokens.slice(start, start + 6);
    if (window.includes('#')) continue;
    const own = window.filter(value => value === 'O').length;
    if (own === 2) twoPotential++;
  }

  for (let i = 1; i < tokens.length - 1; i++) {
    if (tokens[i] !== '.' || Math.abs(i - center) > 4) continue;
    tokens[i] = 'O';
    if (lineWinningCompletionIndexes(tokens, center).size >= 2) openThreeExtensions.add(i);
    tokens[i] = '.';
  }

  return {
    winningPoints: completions.size,
    openFour: completions.size >= 2,
    rushFour: completions.size === 1,
    openThree: openThreeExtensions.size > 0,
    twoPotential
  };
}

function threatPatternProfilePlaced(r, c, color) {
  let winningPoints = 0;
  let openFourDirections = 0;
  let rushFourDirections = 0;
  let openThreeDirections = 0;
  let twoDirections = 0;
  let activeDirections = 0;

  for (const [dr, dc] of RENJU_DIRS) {
    const line = directionalThreatPattern(r, c, color, dr, dc);
    winningPoints += line.winningPoints;
    if (line.openFour) openFourDirections++;
    if (line.rushFour) rushFourDirections++;
    if (line.openThree) openThreeDirections++;
    if (line.twoPotential > 0) twoDirections++;
    if (line.winningPoints > 0 || line.openThree || line.twoPotential > 0) activeDirections++;
  }

  const winsNow = isWin(r, c, color);
  const fourDirections = openFourDirections + rushFourDirections;
  const multiAxis = Math.max(0, activeDirections - 1);
  const score =
    (winsNow ? 900000000 : 0) +
    winningPoints * 180000 +
    openFourDirections * 120000 +
    rushFourDirections * 32000 +
    openThreeDirections * 6500 +
    twoDirections * 420 +
    multiAxis * 900;

  return {
    winsNow,
    winningPoints,
    openFourDirections,
    rushFourDirections,
    fourDirections,
    openThreeDirections,
    twoDirections,
    activeDirections,
    multiAxis,
    score
  };
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

  const blocks = immediateWins(otherColor(color), radius)
    .filter(move => isLegalMoveForColor(move.r, move.c, color));
  if (blocks.length) {
    return blocks
      .map(move => ({ ...move, quick: quickMoveScore(move, color) }))
      .sort((a, b) => b.quick - a.quick)
      .slice(0, limit);
  }

  return nearbyMoves(radius)
    .filter(move => isLegalMoveForColor(move.r, move.c, color))
    .map(move => ({ ...move, quick: quickMoveScore(move, color) }))
    .sort((a, b) => b.quick - a.quick)
    .slice(0, limit);
}

function boardKey(toMove) {
  return toMove + ':' + hashA + ':' + hashB;
}

function prioritizeCachedMove(candidates, key) {
  if (!key) return candidates;
  const index = candidates.findIndex(move => move.key === key);
  if (index <= 0) return candidates;
  return [candidates[index], ...candidates.slice(0, index), ...candidates.slice(index + 1)];
}

function forcingMoves(color, limit, radius) {
  const wins = immediateWins(color, radius);
  if (wins.length) return { moves: wins.slice(0, limit), mandatory: true, reason: 'win' };

  const blocks = immediateWins(otherColor(color), radius)
    .filter(move => isLegalMoveForColor(move.r, move.c, color));
  if (blocks.length) return { moves: blocks.slice(0, limit), mandatory: true, reason: 'block' };

  const candidates = orderedMoves(color, Math.max(limit * 2, 6), radius);
  const forcing = [];
  for (const move of candidates) {
    assertTime();
    playMove(move, color);
    const profile = threatPatternProfilePlaced(move.r, move.c, color);
    undoMove(move, color);
    if (
      profile.winningPoints > 0 ||
      profile.fourDirections > 0 ||
      profile.openThreeDirections > 0
    ) {
      forcing.push({ ...move, threatScore: profile.score });
    }
  }
  return {
    moves: forcing.sort((a, b) => b.threatScore - a.threatScore).slice(0, limit),
    mandatory: false,
    reason: 'shape'
  };
}

function threatQuiescence(alpha, beta, toMove, remaining, branch, radius) {
  assertTime();
  const standPat = evaluateStatic();
  if (remaining <= 0) return standPat;

  const forcing = forcingMoves(toMove, Math.min(4, branch), radius);
  const candidates = forcing.moves;
  if (!candidates.length) return standPat;

  const maximizing = toMove === rootSide;
  let value = forcing.mandatory ? (maximizing ? -Infinity : Infinity) : standPat;
  if (!forcing.mandatory) {
    if (maximizing) alpha = Math.max(alpha, value);
    else beta = Math.min(beta, value);
    if (beta <= alpha) return value;
  }

  for (const move of candidates) {
    assertTime();
    playMove(move, toMove);
    let child;
    if (isWin(move.r, move.c, toMove)) {
      child = maximizing ? MATE_SCORE + remaining : -MATE_SCORE - remaining;
    } else {
      child = threatQuiescence(alpha, beta, otherColor(toMove), remaining - 1, branch, radius);
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
  return value;
}

function mayContainForcingPattern(move, color) {
  if (!move) return false;
  for (const [dr, dc] of RENJU_DIRS) {
    let own = 0;
    for (let offset = -4; offset <= 4; offset++) {
      if (!offset) continue;
      const rr = move.r + dr * offset;
      const cc = move.c + dc * offset;
      if (!inBounds(rr, cc)) continue;
      if (board[rr][cc] === color) own++;
    }
    if (own >= 2) return true;
  }
  return false;
}

function alphaBeta(depth, alpha, beta, toMove, branch, radius, cache, lastMove = null) {
  assertTime();
  if (depth <= 0) {
    if (lastMove) {
      const lastMover = otherColor(toMove);
      if (mayContainForcingPattern(lastMove, lastMover)) {
        const volatile = threatPatternProfilePlaced(lastMove.r, lastMove.c, lastMover);
        if (volatile.winningPoints > 0 || volatile.fourDirections > 0) {
          return threatQuiescence(alpha, beta, toMove, 2, branch, radius);
        }
        if (volatile.openThreeDirections > 0) {
          return threatQuiescence(alpha, beta, toMove, 1, branch, radius);
        }
      }
    }
    return evaluateStatic();
  }

  const cacheKey = boardKey(toMove);
  const alphaStart = alpha;
  const betaStart = beta;
  const cached = cache.get(cacheKey);
  if (cached && cached.depth >= depth) {
    if (cached.flag === 'EXACT') return cached.value;
    if (cached.flag === 'LOWER') alpha = Math.max(alpha, cached.value);
    else if (cached.flag === 'UPPER') beta = Math.min(beta, cached.value);
    if (alpha >= beta) return cached.value;
  }

  const immediate = immediateWins(toMove, radius);
  if (immediate.length) {
    const score = toMove === rootSide ? MATE_SCORE + depth : -MATE_SCORE - depth;
    cachePut(cache, cacheKey, { depth, value: score, flag: 'EXACT', bestMove: immediate[0]?.key || null });
    return score;
  }

  const localBranch = Math.max(4, branch - (depth <= 2 ? 2 : depth <= 4 ? 1 : 0));
  const candidates = prioritizeCachedMove(
    orderedMoves(toMove, localBranch, radius),
    cached?.bestMove || null
  );
  if (!candidates.length) return evaluateStatic();

  const maximizing = toMove === rootSide;
  let value = maximizing ? -Infinity : Infinity;
  let bestMove = candidates[0]?.key || null;

  for (const move of candidates) {
    assertTime();
    playMove(move, toMove);
    let child;
    if (isWin(move.r, move.c, toMove)) {
      child = maximizing ? MATE_SCORE + depth : -MATE_SCORE - depth;
    } else {
      child = alphaBeta(depth - 1, alpha, beta, otherColor(toMove), branch, radius, cache, move);
    }
    undoMove(move, toMove);

    if (maximizing) {
      if (child > value) { value = child; bestMove = move.key; }
      alpha = Math.max(alpha, value);
    } else {
      if (child < value) { value = child; bestMove = move.key; }
      beta = Math.min(beta, value);
    }
    if (beta <= alpha) break;
  }

  let flag = 'EXACT';
  if (value <= alphaStart) flag = 'UPPER';
  else if (value >= betaStart) flag = 'LOWER';
  cachePut(cache, cacheKey, { depth, value, flag, bestMove });
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
    score = alphaBeta(depth - 1, -Infinity, Infinity, opponentSide, branch, radius, cache, move);
    score += evaluateStatic() * .035;
  }
  undoMove(move, rootSide);
  return score;
}

function runSearch(message) {
  board = message.board.map(row => row.slice());
  rootSide = message.side === BLACK ? BLACK : WHITE;
  applyRuleConfig(message.rules);
  opponentSide = otherColor(rootSide);
  nodes = 0;
  initializeHash();

  const candidates = (message.candidates || [])
    .map(coordToPoint)
    .filter(Boolean)
    .filter(move => board[move.r]?.[move.c] === EMPTY)
    .filter(move => isLegalMoveForColor(move.r, move.c, rootSide));

  if (!candidates.length) throw new Error('No legal deep-search candidates');

  const started = performance.now();
  const budgetMs = Math.max(250, Math.min(5000, Number(message.timeBudgetMs) || 1800));
  deadline = started + budgetMs;

  const maxDepth = Math.max(3, Math.min(8, Number(message.maxDepth) || 7));
  const branch = Math.max(4, Math.min(9, Number(message.branch) || 7));
  const radius = 2;

  let completed = null;
  let timedOut = false;
  const cache = new Map();

  for (let depth = 3; depth <= maxDepth; depth++) {
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
    branch,
    transpositionEntries: cache.size,
    quiescenceDepth: 2
  };
}

function forcingProofKey(attacker, turns) {
  return 'TS:' + attacker + ':' + turns + ':' + hashA + ':' + hashB;
}

function proveForcingWin(attacker, turns, branch, radius, memo) {
  assertTime();
  const defender = otherColor(attacker);

  const winsNow = immediateWins(attacker, radius);
  if (winsNow.length) {
    return {
      forced: true,
      attackerTurns: 1,
      line: [winsNow[0].key],
      reason: 'immediate_win'
    };
  }
  if (turns <= 0) return { forced: false, attackerTurns: null, line: [], reason: 'depth_limit' };

  // A forcing proof is conservative: if the defender already has a direct win,
  // this attacker line is not considered forced.
  if (immediateWins(defender, radius).length) {
    return { forced: false, attackerTurns: null, line: [], reason: 'defender_immediate_win' };
  }

  const key = forcingProofKey(attacker, turns);
  const cached = memo.get(key);
  if (cached) return cached;

  const candidates = orderedMoves(attacker, branch, radius);
  for (const move of candidates) {
    assertTime();
    playMove(move, attacker);
    let result = null;
    try {
      if (isWin(move.r, move.c, attacker)) {
        result = {
          forced: true,
          attackerTurns: 1,
          line: [move.key],
          reason: 'winning_move'
        };
      } else if (immediateWins(defender, radius).length) {
        result = null;
      } else {
        const threats = immediateWins(attacker, radius);
        if (threats.length >= 2) {
          result = {
            forced: true,
            attackerTurns: 2,
            line: [move.key],
            reason: 'double_winning_points'
          };
        } else if (threats.length === 1) {
          const block = threats[0];
          if (!isLegalMoveForColor(block.r, block.c, defender)) {
            result = {
              forced: true,
              attackerTurns: 2,
              line: [move.key],
              reason: 'unblockable_threat'
            };
          } else {
            playMove(block, defender);
            try {
              if (!isWin(block.r, block.c, defender)) {
                const child = proveForcingWin(attacker, turns - 1, branch, radius, memo);
                if (child.forced) {
                  result = {
                    forced: true,
                    attackerTurns: 1 + (child.attackerTurns || 0),
                    line: [move.key, block.key, ...child.line],
                    reason: 'forced_reply_chain'
                  };
                }
              }
            } finally {
              undoMove(block, defender);
            }
          }
        }
      }
    } finally {
      undoMove(move, attacker);
    }

    if (result?.forced) {
      memo.set(key, result);
      return result;
    }
  }

  const miss = { forced: false, attackerTurns: null, line: [], reason: 'not_proven' };
  memo.set(key, miss);
  return miss;
}

function runThreatSearch(message) {
  board = message.board.map(row => row.slice());
  rootSide = message.side === BLACK ? BLACK : WHITE;
  applyRuleConfig(message.rules);
  opponentSide = otherColor(rootSide);
  nodes = 0;
  initializeHash();

  const candidates = (message.candidates || [])
    .map(coordToPoint)
    .filter(Boolean)
    .filter(move => board[move.r]?.[move.c] === EMPTY)
    .filter(move => isLegalMoveForColor(move.r, move.c, rootSide));

  if (!candidates.length) throw new Error('No legal threat-search candidates');

  const started = performance.now();
  const budgetMs = Math.max(250, Math.min(4000, Number(message.timeBudgetMs) || 1200));
  const maxThreatTurns = Math.max(2, Math.min(8, Number(message.maxThreatTurns) || 6));
  const branch = Math.max(4, Math.min(10, Number(message.branch) || 8));
  const radius = 2;
  const sliceMs = Math.max(120, Math.floor(budgetMs / candidates.length));

  const analyses = [];
  let anyTimedOut = false;

  for (let index = 0; index < candidates.length; index++) {
    const move = candidates[index];
    const remainingBudget = Math.max(0, budgetMs - (performance.now() - started));
    if (remainingBudget <= 0) {
      analyses.push({
        move: move.key,
        forced: false,
        timedOut: true,
        attackerTurns: null,
        line: [],
        reason: 'budget_exhausted'
      });
      anyTimedOut = true;
      continue;
    }

    deadline = performance.now() + Math.min(sliceMs, remainingBudget);
    let timedOut = false;
    let proof = { forced: false, attackerTurns: null, line: [], reason: 'not_proven' };

    playMove(move, rootSide);
    try {
      if (!isWin(move.r, move.c, rootSide)) {
        const memo = new Map();
        proof = proveForcingWin(opponentSide, maxThreatTurns, branch, radius, memo);
      }
    } catch (error) {
      if (error !== TIMEOUT) throw error;
      timedOut = true;
      anyTimedOut = true;
    } finally {
      undoMove(move, rootSide);
    }

    analyses.push({
      move: move.key,
      forced: Boolean(proof.forced),
      timedOut,
      attackerTurns: proof.attackerTurns ?? null,
      line: Array.isArray(proof.line) ? proof.line : [],
      reason: timedOut ? 'timeout' : proof.reason
    });
  }

  // This engine only claims preference when it can prove a candidate loses.
  // Otherwise preserve root order instead of inventing a heuristic ranking.
  const safe = analyses.find(item => !item.forced && !item.timedOut)
    || analyses.find(item => !item.forced)
    || analyses[0];

  return {
    status: 'completed',
    source: 'threat-worker',
    winner: safe?.move || candidates[0].key,
    analyses,
    timedOut: anyTimedOut,
    nodes,
    elapsedMs: Math.round(performance.now() - started),
    budgetMs,
    maxThreatTurns,
    branch
  };
}

self.onmessage = event => {
  const message = event.data || {};
  const id = message.id;
  try {
    const result = message.task === 'threat' ? runThreatSearch(message) : runSearch(message);
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: String(error?.message || error || 'deep worker failed')
    });
  }
};
