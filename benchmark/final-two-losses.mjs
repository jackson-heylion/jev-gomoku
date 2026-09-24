import { loadProductionEngine } from './harness.mjs';
import { WHITE, Referee, cloneBoard } from './referee.mjs';

const engine = await loadProductionEngine({
  request: async () => { throw new Error('offline final-loss audit must not call Jev'); },
  deepWorker: 'thread'
});

const CASES = [
  {
    id: 'recent-long-root',
    moves: ['H8','G9','I8','G8','J8','G7','K8','L8','G6','G10','G11','H7','I10','I7','J7','F7','E7']
  },
  {
    id: 'coverage-pre-E14',
    moves: [
      'H8','G7','H7','H6','H9','H10','G6','G9','F8','G8','G10','I8','F11','E12','F7','F9',
      'H5','E8','I4','J3','F6','F4','G5','E10','I5','E11','E9','D11','C12'
    ]
  }
];

for (const sample of CASES) {
  engine.setGameConfig({playerColor:'black',overline:true,fourFour:false,threeThree:false});
  const referee=new Referee(engine,{model:'jev-latest',maxPlies:225});
  referee.reset(sample.moves);
  if (referee.toMove!==WHITE) throw new Error(sample.id+' must be WHITE to move');

  engine.setPosition(cloneBoard(referee.board),referee.moves.map(m=>({...m})),'jev-latest');
  const context=engine.candidates('max');
  const keys=(context.candidates||[]).map(m=>m.key);

  engine.setPosition(cloneBoard(referee.board),referee.moves.map(m=>({...m})),'jev-latest');
  const threat=await engine.threatAnalyze(keys,'max',{
    timeBudgetMs:3200,
    maxThreatTurns:10,
    branch:9
  });

  engine.setPosition(cloneBoard(referee.board),referee.moves.map(m=>({...m})),'jev-latest');
  const deep=await engine.deepAnalyze(keys.slice(0,5),'max');

  const rows=new Map((threat?.analyses||[]).map(r=>[r.move,r]));
  console.log('FINAL_AUDIT',JSON.stringify({
    id:sample.id,
    ply:referee.plies,
    localSearchChoice:context.localSearchChoice||null,
    candidates:(context.candidates||[]).map(m=>{
      const t=rows.get(m.key);
      return {
        move:m.key,
        rank:m.rank,
        searchScore:m.searchScore,
        sources:m.recallSources||[],
        tacticalSafety:m.analysis?.facts?.tactical_safety||null,
        threat:t?{
          forced:Boolean(t.forced),
          timedOut:Boolean(t.timedOut),
          reason:t.reason||null,
          attackerTurns:t.attackerTurns??null,
          line:t.line||[],
          counterRisk:t.counterThreat?.risk||null,
          forcedDefenseMove:t.counterThreat?.forcedDefenseMove||null,
          network:(t.counterThreat?.networkMoves||[]).slice(0,8)
        }:null
      };
    }),
    deep:{
      status:deep?.status||null,
      depthReached:deep?.depthReached??null,
      timedOut:Boolean(deep?.timedOut),
      scores:(deep?.scores||[]).map(r=>({
        move:r.move,score:r.score,forcedResult:r.forcedResult||null,
        pv:r.principalVariation||[]
      }))
    }
  }));
}
