import { loadProductionEngine } from './harness.mjs';
import { WHITE, Referee, cloneBoard } from './referee.mjs';

const engine = await loadProductionEngine({
  request: async () => { throw new Error('fast audit must not call Jev'); },
  deepWorker: 'thread'
});

const cases = [
  ['straight-turn7',
    ['H8','G7','H7','G8','H6','H9','H5','H4','G6','F7','E6','F6','F5','E4','G5','E5','G4'],
    ['J11','H3','D4']],
  ['straight-turn8',
    ['H8','G7','H7','G8','H6','H9','H5','H4','G6','F7','E6','F6','F5','E4','G5','E5','G4','J11','I10'],
    ['C3','H3','D4']],
  ['depth0-turn4',
    ['H8','G9','H9','H10','F8','G8','I11','G10','G7','G11','G12','F10','I10','D10','E10','I9','F12','J8','K7','H12','I13'],
    ['D8','E9','D9']],
  ['depth0-turn5',
    ['H8','G9','H9','H10','F8','G8','I11','G10','G7','G11','G12','F10','I10','D10','E10','I9','F12','J8','K7','H12','I13','D8','E9'],
    ['H6','D9','E11']],
  ['coverage',
    ['H8','G7','H7','H6','H9','H10','G6','G9','F8','G8','G10','I8','F11','E12','F7','F9','H5','E8','I4','J3','F6','F4','G5','E10','I5','E11','E9','D11','C12','E14','E13'],
    ['J5','F5','F13']],
  ['recent1',
    ['H8','G9','I8','G8','J8','G7','K8','L8','G6','G10','G11','H7','I10','I7','J7','F7','E7'],
    ['J9','E6','I6','F9']],
  ['recent2',
    ['H8','G9','I8','G8','J8','G7','K8','L8','G6','G10','G11','H7','I10','I7','J7','F7','E7','J9','I6'],
    ['H5','I6','F9','H9']],
  ['recent3',
    ['H8','G9','I8','G8','J8','G7','K8','L8','G6','G10','G11','H7','I10','I7','J7','F7','E7','J9','I6','H5','L9'],
    ['M10','J6','F9','L5']],
  ['recent4',
    ['H8','G9','I8','G8','J8','G7','K8','L8','G6','G10','G11','H7','I10','I7','J7','F7','E7','J9','I6','H5','L9','M10','K6'],
    ['L5','K5','F9','J6']]
];

for (const [id, seq, focus] of cases) {
  engine.setGameConfig({playerColor:'black',overline:true,fourFour:false,threeThree:false});
  const referee = new Referee(engine,{model:'jev-latest',maxPlies:225});
  referee.reset(seq);
  if (referee.toMove !== WHITE) throw new Error(id+' expected white');

  engine.setPosition(cloneBoard(referee.board),referee.moves.map(m=>({...m})),'jev-latest');
  const context=engine.candidates('max');
  const candidateMap=Object.fromEntries((context.candidates||[]).map(m=>[m.key,{
    rank:m.rank,
    searchScore:m.searchScore,
    sources:m.recallSources||[],
    safety:m.analysis?.facts?.tactical_safety||null
  }]));

  engine.setPosition(cloneBoard(referee.board),referee.moves.map(m=>({...m})),'jev-latest');
  const deep=await engine.deepAnalyze(focus,'max');

  engine.setPosition(cloneBoard(referee.board),referee.moves.map(m=>({...m})),'jev-latest');
  const threat=await engine.threatAnalyze(focus,'max',{
    timeBudgetMs:1450,maxThreatTurns:8,branch:9
  });

  console.log('FAST_AUDIT',JSON.stringify({
    id,ply:referee.plies,focus,contextForced:context.forced||null,
    candidates:candidateMap,
    deep:{
      status:deep?.status||null,depth:deep?.depthReached??null,timedOut:Boolean(deep?.timedOut),
      scores:(deep?.scores||[]).map(r=>({move:r.move,score:r.score,forced:r.forcedResult||null,pv:r.principalVariation||[]}))
    },
    threat:(threat?.analyses||[]).map(r=>({
      move:r.move,forced:Boolean(r.forced),timedOut:Boolean(r.timedOut),reason:r.reason||null,line:r.line||[],
      counter:r.counterThreat?{
        risk:r.counterThreat.risk||null,reason:r.counterThreat.reason||null,
        forcedDefenseMove:r.counterThreat.forcedDefenseMove||null,
        network:(r.counterThreat.networkMoves||[]).slice(0,8)
      }:null
    }))
  }));
}
