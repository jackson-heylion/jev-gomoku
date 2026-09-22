/**
 * Authoritative game referee for the benchmark.
 *
 * The referee never re-implements Renju rules. Every legality and win question
 * is answered by the production engine itself (`benchmark/harness.mjs` ->
 * `src/app.js`), so the benchmark board enforces exactly the same rules the
 * page enforces:
 *
 *   - BLACK may not play overline / double-four / real double-three.
 *   - A false three is not a forbidden move.
 *   - BLACK wins with an exact five only; an overline is forbidden, never a win.
 *   - WHITE wins with five or more in a row, and has no forbidden moves.
 */

export const SIZE = 15;
export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;
export const COLS = 'ABCDEFGHIJKLMNO'.split('');

export function coord(r, c) {
  return COLS[c] + String(r + 1);
}

export function parseCoord(value) {
  const match = String(value || '').trim().toUpperCase().match(/^([A-O])(1[0-5]|[1-9])$/);
  if (!match) return null;
  return { c: COLS.indexOf(match[1]), r: Number(match[2]) - 1 };
}

export function makeBoard() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(EMPTY));
}

export function cloneBoard(board) {
  return board.map(row => row.slice());
}

export function otherColor(color) {
  return color === BLACK ? WHITE : BLACK;
}

export function colorName(color) {
  return color === BLACK ? 'black' : 'white';
}

export function swapColor(color) {
  if (color === BLACK) return WHITE;
  if (color === WHITE) return BLACK;
  return EMPTY;
}

export function swapBoardColors(board) {
  return board.map(row => row.map(swapColor));
}

/** Re-label a real black move history as a white move history (and vice versa). */
export function swappedHistory(moves) {
  return moves.map(move => ({ ...move, color: swapColor(move.color) }));
}

export class Referee {
  constructor(engine, { model = 'jev-latest', maxPlies = 60 } = {}) {
    this.engine = engine;
    this.model = model;
    this.maxPlies = maxPlies;
    this.board = makeBoard();
    this.moves = [];
    this.toMove = BLACK;
    this.winner = null;
    this.winReason = null;
    this.fouls = [];
    this.forbiddenSubstitutions = 0;
    this.inspections = 0;
  }

  reset(openingMoves = []) {
    this.board = makeBoard();
    this.moves = [];
    this.toMove = BLACK;
    this.winner = null;
    this.winReason = null;
    this.fouls = [];
    this.forbiddenSubstitutions = 0;
    this.inspections = 0;

    for (const key of openingMoves) {
      const verdict = this.inspect(key, this.toMove);
      if (!verdict.legal) {
        throw new Error(`Illegal opening move ${key} (${verdict.reason}) in this position`);
      }
      this.commit(key, this.toMove, verdict);
      if (verdict.winsNow) throw new Error('Opening sequence already wins: ' + key);
    }
    return this;
  }

  get plies() {
    return this.moves.length;
  }

  get finished() {
    return Boolean(this.winner) || this.plies >= this.maxPlies || this.empties() === 0;
  }

  get result() {
    if (this.winner) return this.winner === BLACK ? 'B' : 'W';
    return 'draw';
  }

  empties() {
    let count = 0;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (this.board[r][c] === EMPTY) count++;
      }
    }
    return count;
  }

  /** Point the production engine at the REAL position (black is black). */
  syncEngine() {
    this.engine.setPosition(
      cloneBoard(this.board),
      this.moves.map(move => ({ ...move })),
      this.model
    );
    return this;
  }

  /**
   * Production `immediateWins(color)` on the current position: the points where
   * `color` wins in one move. For BLACK this already excludes forbidden points,
   * because a forbidden point is a loss, not a win.
   */
  immediateWins(color) {
    this.syncEngine();
    return this.engine.immediateWinsFor(color);
  }

  /**
   * Ask production code whether `key` is playable for `color` in the current
   * position, and whether it wins immediately.
   */
  inspect(key, color) {
    const point = parseCoord(key);
    if (!point) {
      return { key, legal: false, reason: 'malformed_coordinate' };
    }

    this.syncEngine();
    const raw = this.engine.judge(coord(point.r, point.c), color);

    if (!raw.empty) {
      return { key: raw.key, legal: false, reason: 'occupied', winsNow: false };
    }
    if (raw.forbidden) {
      return {
        key: raw.key,
        legal: false,
        reason: 'forbidden',
        forbiddenType: raw.forbiddenType || 'UNKNOWN',
        winsNow: false
      };
    }
    return {
      key: raw.key,
      legal: true,
      reason: null,
      forbiddenType: null,
      winsNow: Boolean(raw.winsNow),
      exactFive: Boolean(raw.exactFive),
      overline: Boolean(raw.overline)
    };
  }

  commit(key, color, verdict) {
    const point = parseCoord(key);
    this.board[point.r][point.c] = color;
    this.moves.push({
      r: point.r,
      c: point.c,
      color,
      coord: coord(point.r, point.c),
      win: Boolean(verdict?.winsNow)
    });
    if (verdict?.winsNow) {
      this.winner = color;
      this.winReason = verdict.exactFive
        ? 'exact_five'
        : color === BLACK
          ? 'five'
          : 'five_or_more';
      return { wins: true };
    }
    this.toMove = otherColor(color);
    return { wins: false };
  }

  /** Record a foul: a player produced a move it was not allowed to play. */
  recordFoul(engineName, color, key, verdict) {
    const foul = {
      engine: engineName,
      color: colorName(color),
      move: key,
      reason: verdict?.reason || 'illegal',
      forbiddenType: verdict?.forbiddenType || null,
      plies: this.plies
    };
    this.fouls.push(foul);
    return foul;
  }
}
