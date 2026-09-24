import { loadProductionEngine } from './harness.mjs';
import { BLACK, WHITE, Referee, cloneBoard, swapBoardColors, swappedHistory } from './referee.mjs';

const UPSTREAM='https://api.typesafe.ai/v1/systemone';
const apiKey=String(process.env.JEV_API_KEY||'').trim();
if(process.env.BENCHMARK_CONFIRM!=='1') throw new Error('set BENCHMARK_CONFIRM=1');
if(!apiKey) throw new Error('JEV_API_KEY is required');
const MODEL='jev-latest';
const MAX_EXTRA=30;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function request({payload,signal}){
  let last=null;
  for(let attempt=0;attempt<3;attempt++){
    const response=await fetch(UPSTREAM,{
      method:'POST',
      headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},
      body:JSON.stringify(payload),
      signal
    });
    last=response;
    if((response.status===429||response.status===529)&&attempt<2){
      const retry=Number(response.headers.get('retry-after'));
      await sleep(Number.isFinite(retry)?Math.min(15000,retry*1000):650*(2**attempt));
      continue;
    }
    const raw=await response.text();
    let data=null; try{data=raw?JSON.parse(raw):null;}catch{}
    if(!response.ok) throw new Error('TypeSafe HTTP '+response.status);
    const result=data||{};
    result.__client={attempts:attempt+1,cached:false,transport:'final-two-real-ab'};
    return result;
  }
  throw new Error('TypeSafe failed '+(last?.status||'unknown'));
}

const engine=await loadProductionEngine({request,deepWorker:'thread'});

function blackDecision(referee){
  const b=swapBoardColors(referee.board);
  const m=swappedHistory(referee.moves);
  engine.setPosition(b,m,MODEL);
  const local=engine.local('expert');
  const keys=[local.finalChoice,...(local.candidates||[]).map(x=>x.key)].filter(Boolean);
  for(const key of [...new Set(keys)]){
    const v=referee.inspect(key,BLACK);
    if(v.legal) return {key,verdict:v};
  }
  referee.syncEngine();
  for(const key of engine.orderedBlack(32)){
    const v=referee.inspect(key,BLACK);
    if(v.legal) return {key,verdict:v};
  }
  throw new Error('no black move');
}

const CASES=[
  {
    id:'recent-long-force-I6',
    start:['H8','G9','I8','G8','J8','G7','K8','L8','G6','G10','G11','H7','I10','I7','J7','F7','E7','E6','D5'],
    force:'I6'
  },
  {
    id:'coverage-force-E13',
    start:['H8','G7','H7','H6','H9','H10','G6','G9','F8','G8','G10','I8','F11','E12','F7','F9','H5','E8','I4','J3','F6','F4','G5','E10','I5','E11','E9','D11','C12'],
    force:'E13'
  }
];

for(const sample of CASES){
  engine.setGameConfig({playerColor:'black',overline:true,fourFour:false,threeThree:false});
  const referee=new Referee(engine,{model:MODEL,maxPlies:Math.min(225,sample.start.length+1+MAX_EXTRA)});
  referee.reset(sample.start);
  if(referee.toMove!==WHITE) throw new Error(sample.id+' must be white to move');
  const fv=referee.inspect(sample.force,WHITE);
  if(!fv.legal) throw new Error(sample.id+' forced move illegal: '+sample.force);
  referee.commit(sample.force,WHITE,fv);
  const startAfterForce=referee.plies;
  const decisions=[];
  while(!referee.finished){
    if(referee.toMove===BLACK){
      const d=blackDecision(referee);
      referee.commit(d.key,BLACK,d.verdict);
      continue;
    }
    engine.setPosition(cloneBoard(referee.board),referee.moves.map(m=>({...m})),MODEL);
    const t=performance.now();
    let result;
    try{ result=await engine.jevMax(); }
    catch(error){
      engine.setPosition(cloneBoard(referee.board),referee.moves.map(m=>({...m})),MODEL);
      result=engine.local('expert');
      result.__fallback=String(error?.message||error);
    }
    const key=String(result.finalChoice||result?.answer?.choice||'').toUpperCase();
    const v=referee.inspect(key,WHITE);
    decisions.push({
      move:key,
      localChoice:result.localChoice||null,
      jevSuggested:result.jevSuggested||null,
      authority:result?.decisionTrace?.requestShape?.decisionAuthority||null,
      guard:result?.decisionTrace?.semanticOverrideGuard?.reason||null,
      ms:Math.round(performance.now()-t),
      fallback:result.__fallback||null
    });
    if(!v.legal){ referee.winner=BLACK; referee.winReason='white_foul'; break; }
    referee.commit(key,WHITE,v);
  }
  if(!referee.winReason&&!referee.winner) referee.winReason='max_additional_plies';
  const wl=referee.winner===WHITE?'W':referee.winner===BLACK?'L':'D';
  console.log('REAL_AB',JSON.stringify({
    id:sample.id,
    forced:sample.force,
    result:wl,
    winner:referee.winner,
    winReason:referee.winReason,
    continuation:referee.moves.slice(startAfterForce).map(m=>m.coord),
    decisions
  }));
}
