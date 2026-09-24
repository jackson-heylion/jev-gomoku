import { loadProductionEngine } from './harness.mjs';
import { BLACK } from './referee.mjs';

function positionFromSequence(sequence) {
  const board = Array.from({ length: 15 }, () => Array(15).fill(0));
  const COLS = 'ABCDEFGHIJKLMNO';
  const moves = [];
  let color = 1;
  for (const key of sequence) {
    const m = /^([A-O])(1[0-5]|[1-9])$/.exec(key);
    const c = COLS.indexOf(m[1]);
    const r = Number(m[2]) - 1;
    board[r][c] = color;
    moves.push({ r, c, color, coord: key, source: 'diag' });
    color = color === 1 ? 2 : 1;
  }
  return { board, moves };
}

const engine = await loadProductionEngine({
  request: async () => { throw new Error('deep separation audit must not call Jev'); },
  deepWorker: 'thread'
});
engine.setGameConfig({ playerColor: 'black', overline: true, fourFour: false, threeThree: false });

const cases = [
  {
    id: 'straight-ply9',
    seq: ['H8','G7','H7','G8','H6','H9','H5','H4','G6'],
    keys: ['F7','G10','G5','G9','J11']
  },
  {
    id: 'recent-ply19',
    seq: ['H8','G9','I8','G8','J8','G7','K8','L8','G6','G10','G11','H7','I10','I7','J7','F7','E7','E6','D5'],
    keys: ['I6','F9','H9','I9','E10']
  }
];

for (const sample of cases) {
  const p = positionFromSequence(sample.seq);
  engine.setPosition(p.board, p.moves, 'jev-latest');
  const deep = await engine.deepAnalyze(sample.keys, 'max');
  console.log('DEEP_SEPARATION', JSON.stringify({
    id: sample.id,
    status: deep?.status,
    depthReached: deep?.depthReached,
    timedOut: deep?.timedOut,
    elapsedMs: deep?.elapsedMs,
    scores: (deep?.scores || []).map(row => ({
      move: row.move,
      score: row.score,
      forcedResult: row.forcedResult || null,
      pv: row.principalVariation
    }))
  }));
}

const coverage = positionFromSequence([
  'H8','G7','H7','H6','H9','H10','G6','G9','F8','G8','G10','I8','F11','E12','F7','F9',
  'H5','E8','I4','J3','F6','F4','G5','E10','I5','E11','E9','D11','C12','E14','E13'
]);
engine.setPosition(coverage.board, coverage.moves, 'jev-latest');
const threat = await engine.threatAnalyze(['J5','F5'], 'max', { timeBudgetMs: 1450, maxThreatTurns: 6, branch: 9 });
console.log('COVERAGE_THREAT_PAIR', JSON.stringify(threat?.analyses || []));
