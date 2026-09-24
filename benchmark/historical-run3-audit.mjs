import { loadProductionEngine } from './harness.mjs';
import { WHITE, BLACK, Referee, cloneBoard } from './referee.mjs';

const CASES = [
  {
    id: 'straight-five',
    initial: ['H8','G7','H7','G8','H6'],
    continuation: ['H9','H5','H4','G6','F7','E6','F6','F5','E4','G5','E5','G4','J11','I10','C3','D4','H3','I7','D7','J8','F4','K9'],
    locals: ['H5','H4','F7','F6','E4','E5','H3','H3','H3','F4','F4'],
    rules: { overline: true, fourFour: false, threeThree: false }
  },
  {
    id: 'recent-long-vcf',
    initial: ['H8','G9','I8','G8','J8','G7','K8','L8','G6','G10','G11','H7','I10','I7','J7','F7','E7'],
    continuation: ['J9','I6','H5','L9','M10','K6','L5','K7','F9','K9','K5','K10'],
    locals: ['J9','H5','M10','L5','K5','K5'],
    rules: { overline: true, fourFour: false, threeThree: false }
  },
  {
    id: 'recent-depth0',
    initial: ['H8','G9','H9','H10','F8','G8','I11','G10','G7','G11','G12','F10','I10','D10','E10'],
    continuation: ['I9','F12','J8','K7','H12','I13','D8','E9','H6','I14','I12','H13','F11','F13','I7','H11','J9','E14'],
    locals: ['I9','J8','H12','E9','D9','I12','F11','H11','J9'],
    rules: { overline: true, fourFour: false, threeThree: false }
  },
  {
    id: 'coverage-37ply',
    initial: ['H8','G7','H7','H6','H9','H10','G6','G9','F8','G8','G10','I8','F11','E12','F7','F9','H5','E8','I4','J3','F6','F4','G5','E10','I5','E11','E9','D11','C12','E14','E13'],
    continuation: ['J5','I3','F13','H4','J2','E7'],
    locals: ['J5','I2','J2'],
    rules: { overline: true, fourFour: false, threeThree: false }
  }
];

function unique(xs){ return [...new Set(xs.filter(Boolean))]; }
function compactThreat(row){
  if(!row) return null;
  return {
    forced: !!row.forced,
    timedOut: !!row.timedOut,
    reason: row.reason || null,
    line: Array.isArray(row.line) ? row.line.slice(0,8) : [],
    counterRisk: row.counterThreat?.risk || null,
    forcedDefenseMove: row.counterThreat?.forcedDefenseMove || null,
    network: (row.counterThreat?.networkMoves || []).slice(0,5).map(x=>({
      move:x.move, kind:x.kind, winningPoints:x.winningPoints,
      openThreeDirections:x.openThreeDirections, fourDirections:x.fourDirections
    }))
  };
}

const engine = await loadProductionEngine({
  request: async () => { throw new Error('run3 audit must not call Jev'); },
  deepWorker: 'thread'
});

for(const sample of CASES){
  engine.setGameConfig({ playerColor:'black', ...sample.rules });
  const referee = new Referee(engine,{model:'jev-latest',maxPlies:225});
  referee.reset(sample.initial);
  console.log('RUN3_CASE', JSON.stringify({id:sample.id,initialPlies:referee.plies}));

  for(let turn=0; turn<sample.locals.length; turn++){
    const chosen=sample.continuation[turn*2];
    const blackReply=sample.continuation[turn*2+1] || null;
    const local=sample.locals[turn];

    engine.setPosition(cloneBoard(referee.board),referee.moves.map(m=>({...m})),'jev-latest');
    const context=engine.candidates('max');
    const keys=unique([
      ...context.candidates.slice(0,6).map(m=>m.key),
      chosen, local
    ]).slice(0,8);

    engine.setPosition(cloneBoard(referee.board),referee.moves.map(m=>({...m})),'jev-latest');
    const [deep,threat]=await Promise.all([
      engine.deepAnalyze(keys,'max'),
      engine.threatAnalyze(keys,'max',{timeBudgetMs:1450,maxThreatTurns:8,branch:9})
    ]);
    const dmap=new Map((deep?.scores||[]).map(x=>[x.move,x]));
    const tmap=new Map((threat?.analyses||[]).map(x=>[x.move,x]));
    const safe=keys.filter(k=>tmap.get(k)&&!tmap.get(k).forced&&!tmap.get(k).timedOut);
    const forced=keys.filter(k=>tmap.get(k)?.forced);
    const unresolved=keys.filter(k=>!tmap.has(k)||tmap.get(k)?.timedOut);
    const deepRows=keys.map(k=>{
      const d=dmap.get(k);
      return d ? {move:k,score:Number.isFinite(d.score)?Math.round(d.score):null,forced:d.forcedResult||null,pv:(d.principalVariation||[]).slice(0,6)} : {move:k,missing:true};
    });

    let arb=null;
    if(chosen!==local){
      engine.setPosition(cloneBoard(referee.board),referee.moves.map(m=>({...m})),'jev-latest');
      try { arb=engine.arbitrate(local,chosen,{mode:'expert',depth:8,branch:8,vcfDepth:5,vctDepth:3}); }
      catch(e){ arb={error:String(e?.message||e)}; }
    }

    console.log('RUN3_TURN',JSON.stringify({
      id:sample.id,turn:turn+1,plyBefore:referee.plies,chosen,local,
      contextForced:context.forced||null,
      contextKeys:context.candidates.map(m=>m.key),
      safe,forced,unresolved,
      deepStatus:deep?.status||null,deepDepth:deep?.depthReached??null,deepRows,
      chosenThreat:compactThreat(tmap.get(chosen)),
      localThreat:compactThreat(tmap.get(local)),
      arbitration:arb
    }));

    const wv=referee.inspect(chosen,WHITE);
    if(!wv.legal) throw new Error(sample.id+' illegal historical white '+chosen);
    referee.commit(chosen,WHITE,wv);
    if(wv.winsNow||!blackReply) break;
    const bv=referee.inspect(blackReply,BLACK);
    if(!bv.legal) throw new Error(sample.id+' illegal historical black '+blackReply);
    referee.commit(blackReply,BLACK,bv);
    if(bv.winsNow) break;
  }
}
