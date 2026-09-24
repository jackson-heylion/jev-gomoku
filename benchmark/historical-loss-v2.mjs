import { loadProductionEngine } from './harness.mjs';
import { BLACK, WHITE, Referee, cloneBoard } from './referee.mjs';

const engine = await loadProductionEngine({
  request: async () => { throw new Error('diagnostic must not call Jev'); },
  deepWorker: 'thread'
});

function position(sequence, rules={overline:true,fourFour:false,threeThree:false}) {
  engine.setGameConfig({ playerColor:'black', ...rules });
  const referee = new Referee(engine, { model:'jev-latest', maxPlies:225 });
  referee.reset(sequence);
  if (referee.toMove !== WHITE) throw new Error('Expected WHITE to move');
  return referee;
}

async function inspectCase(id, sequence, focus, rules) {
  const referee = position(sequence, rules);
  engine.setPosition(cloneBoard(referee.board), referee.moves.map(m=>({...m})), 'jev-latest');
  const context = engine.candidates('max');
  const keys = [...new Set([
    ...focus,
    ...(context.candidates||[]).map(m=>m.key)
  ])].slice(0, 8);

  engine.setPosition(cloneBoard(referee.board), referee.moves.map(m=>({...m})), 'jev-latest');
  const threat = await engine.threatAnalyze(keys, 'max', {
    timeBudgetMs: 1450,
    maxThreatTurns: 8,
    branch: 9
  });

  engine.setPosition(cloneBoard(referee.board), referee.moves.map(m=>({...m})), 'jev-latest');
  const deep = await engine.deepAnalyze(keys.slice(0,5), 'max');

  const pairwise = [];
  for (let i=0;i<focus.length-1;i++) {
    const a=focus[i], b=focus[i+1];
    engine.setPosition(cloneBoard(referee.board), referee.moves.map(m=>({...m})), 'jev-latest');
    try {
      pairwise.push(engine.arbitrate(a,b,{mode:'expert',depth:8,branch:8,vcfDepth:5,vctDepth:3}));
    } catch (error) {
      pairwise.push({a,b,error:String(error?.message||error)});
    }
  }

  console.log('V2_AUDIT', JSON.stringify({
    id,
    ply: referee.plies,
    focus,
    contextForced: context.forced || null,
    candidates: (context.candidates||[]).map(m=>({
      move:m.key,
      rank:m.rank,
      searchScore:m.searchScore,
      recallSources:m.recallSources||[],
      tacticalSafety:m.analysis?.facts?.tactical_safety||null
    })),
    threat: (threat?.analyses||[]).map(row=>({
      move:row.move,
      forced:Boolean(row.forced),
      timedOut:Boolean(row.timedOut),
      reason:row.reason||null,
      line:row.line||[],
      counter: row.counterThreat ? {
        risk:row.counterThreat.risk||null,
        reason:row.counterThreat.reason||null,
        forcedDefenseMove:row.counterThreat.forcedDefenseMove||null,
        network:(row.counterThreat.networkMoves||[]).slice(0,8)
      } : null
    })),
    deep: {
      status:deep?.status||null,
      depthReached:deep?.depthReached??null,
      timedOut:Boolean(deep?.timedOut),
      scores:(deep?.scores||[]).map(r=>({
        move:r.move,score:r.score,forcedResult:r.forcedResult||null,
        pv:r.principalVariation||[]
      }))
    },
    pairwise
  }));
}

await inspectCase(
  'straight-turn7-J11-vs-H3',
  ['H8','G7','H7','G8','H6','H9','H5','H4','G6','F7','E6','F6','F5','E4','G5','E5','G4'],
  ['J11','H3','D4']
);
await inspectCase(
  'straight-turn8-C3-vs-H3',
  ['H8','G7','H7','G8','H6','H9','H5','H4','G6','F7','E6','F6','F5','E4','G5','E5','G4','J11','I10'],
  ['C3','H3','D4']
);
await inspectCase(
  'depth0-turn4-D8-vs-E9',
  ['H8','G9','H9','H10','F8','G8','I11','G10','G7','G11','G12','F10','I10','D10','E10',
   'I9','F12','J8','K7','H12','I13'],
  ['D8','E9','D9']
);
await inspectCase(
  'depth0-turn5-H6-vs-D9',
  ['H8','G9','H9','H10','F8','G8','I11','G10','G7','G11','G12','F10','I10','D10','E10',
   'I9','F12','J8','K7','H12','I13','D8','E9'],
  ['H6','D9','E11']
);
await inspectCase(
  'coverage-J5-vs-F5',
  ['H8','G7','H7','H6','H9','H10','G6','G9','F8','G8','G10','I8','F11','E12','F7','F9',
   'H5','E8','I4','J3','F6','F4','G5','E10','I5','E11','E9','D11','C12','E14','E13'],
  ['J5','F5','F13']
);

const recentBase=['H8','G9','I8','G8','J8','G7','K8','L8','G6','G10','G11','H7','I10','I7','J7','F7','E7'];
await inspectCase('recent-long-turn1', recentBase, ['J9','E6','I6','F9']);
await inspectCase('recent-long-turn2', [...recentBase,'J9','I6'], ['H5','I6','F9','H9']);
await inspectCase('recent-long-turn3', [...recentBase,'J9','I6','H5','L9'], ['M10','J6','F9','L5']);
await inspectCase('recent-long-turn4', [...recentBase,'J9','I6','H5','L9','M10','K6'], ['L5','K5','F9','J6']);
