import { loadProductionEngine } from './harness.mjs';
import { BLACK, WHITE, Referee, cloneBoard } from './referee.mjs';

const CASES = [
  {
    id: 'straight-five',
    initial: ['H8','G7','H7','G8','H6'],
    continuation: ['H9','H5','H4','G6','G10','I6','G9','G11','F6','F7','I4','D9','E8','I8','J9','I9','I7','J8','G5','H10','K7','F12'],
    localChoices: ['H5','H4','F7','F6','F6','I4','E8','F5','I7','H10','K7'],
    rules: { overline: true, fourFour: false, threeThree: false }
  },
  {
    id: 'recent-long-vcf',
    initial: ['H8','G9','I8','G8','J8','G7','K8','L8','G6','G10','G11','H7','I10','I7','J7','F7','E7'],
    continuation: ['E6','D5','H9','J9','F9','H11','L7','G12'],
    localChoices: ['E6','I6','J6','L7'],
    rules: { overline: true, fourFour: false, threeThree: false }
  },
  {
    id: 'coverage-37ply',
    initial: ['H8','G7','H7','H6','H9','H10','G6','G9','F8','G8','G10','I8','F11','E12','F7','F9','H5','E8','I4','J3','F6','F4','G5','E10','I5','E11','E9','D11','C12','E14','E13'],
    continuation: ['J5','I3','F13','H4','J2','E7'],
    localChoices: ['J5','I2','J2'],
    rules: { overline: true, fourFour: false, threeThree: false }
  }
];

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function compactThreat(row) {
  if (!row) return null;
  return {
    forced: Boolean(row.forced),
    timedOut: Boolean(row.timedOut),
    reason: row.reason || null,
    attackerTurns: row.attackerTurns ?? null,
    line: Array.isArray(row.line) ? row.line.slice(0, 10) : [],
    counterRisk: row.counterThreat?.risk || null,
    counterReason: row.counterThreat?.reason || null,
    forcedDefenseMove: row.counterThreat?.forcedDefenseMove || null,
    network: (row.counterThreat?.networkMoves || []).slice(0, 6).map(x => ({
      move: x.move,
      kind: x.kind,
      winningPoints: x.winningPoints,
      openThreeDirections: x.openThreeDirections,
      fourDirections: x.fourDirections
    }))
  };
}

const engine = await loadProductionEngine({
  request: async () => { throw new Error('historical loss audit must not call Jev'); },
  deepWorker: 'thread'
});

for (const sample of CASES) {
  engine.setGameConfig({
    playerColor: 'black',
    overline: sample.rules.overline,
    fourFour: sample.rules.fourFour,
    threeThree: sample.rules.threeThree
  });
  const referee = new Referee(engine, { model: 'jev-latest', maxPlies: 225 });
  referee.reset(sample.initial);
  if (referee.toMove !== WHITE) throw new Error(sample.id + ' must start with WHITE to move');

  console.log('AUDIT_CASE', JSON.stringify({ id: sample.id, initialPlies: referee.plies }));

  for (let turn = 0; turn < sample.localChoices.length; turn++) {
    const chosen = sample.continuation[turn * 2];
    const blackReply = sample.continuation[turn * 2 + 1] || null;
    const historicalLocal = sample.localChoices[turn];

    engine.setPosition(cloneBoard(referee.board), referee.moves.map(m => ({...m})), 'jev-latest');
    const context = engine.candidates('max');
    const contextKeys = (context.candidates || []).map(m => m.key);
    const keys = unique([...contextKeys, chosen, historicalLocal]).slice(0, 8);

    engine.setPosition(cloneBoard(referee.board), referee.moves.map(m => ({...m})), 'jev-latest');
    const threat = await engine.threatAnalyze(keys, 'max', {
      timeBudgetMs: 1450,
      maxThreatTurns: 8,
      branch: 9
    });
    const rows = new Map((threat?.analyses || []).map(row => [row.move, row]));
    const completed = keys.filter(key => rows.has(key));
    const safe = completed.filter(key => rows.get(key)?.forced !== true && rows.get(key)?.timedOut !== true);
    const forced = completed.filter(key => rows.get(key)?.forced === true);
    const unresolved = keys.filter(key => !rows.has(key) || rows.get(key)?.timedOut === true);

    let deepPair = null;
    if (chosen && historicalLocal && chosen !== historicalLocal) {
      engine.setPosition(cloneBoard(referee.board), referee.moves.map(m => ({...m})), 'jev-latest');
      deepPair = await engine.deepAnalyze([historicalLocal, chosen], 'max');
    }

    let arbitration = null;
    if (chosen && historicalLocal && chosen !== historicalLocal) {
      engine.setPosition(cloneBoard(referee.board), referee.moves.map(m => ({...m})), 'jev-latest');
      try {
        arbitration = engine.arbitrate(historicalLocal, chosen, {
          mode: 'expert',
          depth: 7,
          branch: 6,
          vcfDepth: 5,
          vctDepth: 3
        });
      } catch (error) {
        arbitration = { error: String(error?.message || error) };
      }
    }

    console.log('AUDIT_TURN', JSON.stringify({
      id: sample.id,
      turn: turn + 1,
      plyBefore: referee.plies,
      chosen,
      historicalLocal,
      contextForced: context.forced || null,
      contextKeys,
      analyzedKeys: keys,
      safe,
      forced,
      unresolved,
      chosenThreat: compactThreat(rows.get(chosen)),
      localThreat: compactThreat(rows.get(historicalLocal)),
      deepPair,
      arbitration
    }));

    const wv = referee.inspect(chosen, WHITE);
    if (!wv.legal) throw new Error(sample.id + ' historical white move illegal: ' + chosen);
    referee.commit(chosen, WHITE, wv);
    if (wv.winsNow || !blackReply) break;

    const bv = referee.inspect(blackReply, BLACK);
    if (!bv.legal) throw new Error(sample.id + ' historical black move illegal: ' + blackReply);
    referee.commit(blackReply, BLACK, bv);
    if (bv.winsNow) break;
  }
}
