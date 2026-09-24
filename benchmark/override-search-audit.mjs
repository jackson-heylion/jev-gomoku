import { loadProductionEngine } from './harness.mjs';

const engine = await loadProductionEngine({
  request: async () => { throw new Error('override search audit must not call Jev'); },
  deepWorker: 'thread'
});
engine.setGameConfig({
  playerColor: 'black',
  overline: true,
  fourFour: false,
  threeThree: false
});

function positionFromSequence(sequence) {
  const board = Array.from({ length: 15 }, () => Array(15).fill(0));
  const cols = 'ABCDEFGHIJKLMNO';
  const moves = [];
  let color = 1;
  for (const key of sequence) {
    const m = String(key).match(/^([A-O])(1[0-5]|[1-9])$/);
    const c = cols.indexOf(m[1]);
    const r = Number(m[2]) - 1;
    board[r][c] = color;
    moves.push({ r, c, color, coord: key });
    color = color === 1 ? 2 : 1;
  }
  return { board, moves };
}

const cases = [
  {
    id: 'straight',
    sequence: ['H8','G7','H7','G8','H6','H9','H5','H4','G6'],
    local: 'F7',
    semantic: 'G10'
  },
  {
    id: 'recent',
    sequence: ['H8','G9','I8','G8','J8','G7','K8','L8','G6','G10','G11','H7','I10','I7','J7','F7','E7','E6','D5'],
    local: 'I6',
    semantic: 'H9'
  }
];

const configs = [
  { branch: 8, timeBudgetMs: 5200, maxDepth: 8 },
  { branch: 7, timeBudgetMs: 5200, maxDepth: 8 },
  { branch: 6, timeBudgetMs: 5200, maxDepth: 8 },
  { branch: 6, timeBudgetMs: 4200, maxDepth: 8 },
  { branch: 5, timeBudgetMs: 4200, maxDepth: 8 }
];

for (const tc of cases) {
  const p = positionFromSequence(tc.sequence);
  console.log('AUDIT_CASE', tc.id);
  for (const cfg of configs) {
    engine.setPosition(p.board, p.moves, 'jev-latest');
    const opts = { ...cfg, allowSingleRoot: true };
    const [a,b] = await Promise.all([
      engine.deepAnalyze([tc.local], 'max', opts),
      engine.deepAnalyze([tc.semantic], 'max', opts)
    ]);
    const ar=a?.scores?.[0]||null;
    const br=b?.scores?.[0]||null;
    console.log('AUDIT_CONFIG', JSON.stringify({
      case: tc.id,
      cfg,
      local: {
        move: tc.local,
        status: a?.status,
        depth: a?.depthReached,
        timedOut: a?.timedOut,
        elapsedMs: a?.elapsedMs,
        score: ar?.score,
        forcedResult: ar?.forcedResult || null,
        pv: ar?.principalVariation || []
      },
      semantic: {
        move: tc.semantic,
        status: b?.status,
        depth: b?.depthReached,
        timedOut: b?.timedOut,
        elapsedMs: b?.elapsedMs,
        score: br?.score,
        forcedResult: br?.forcedResult || null,
        pv: br?.principalVariation || []
      },
      margin: Number(ar?.score) - Number(br?.score)
    }));
  }
}
