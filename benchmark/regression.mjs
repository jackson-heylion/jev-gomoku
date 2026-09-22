import { loadProductionEngine } from './harness.mjs';

const SIZE = 15;
const BLACK = 1;
const COLS = 'ABCDEFGHIJKLMNO'.split('');

function parseCoord(value) {
  const match = String(value).trim().toUpperCase().match(/^([A-O])(1[0-5]|[1-9])$/);
  if (!match) throw new Error('Invalid coordinate: ' + value);
  return { c: COLS.indexOf(match[1]), r: Number(match[2]) - 1 };
}

function positionFromSequence(sequence) {
  const board = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
  const moves = [];
  let color = BLACK;
  for (const key of sequence) {
    const { r, c } = parseCoord(key);
    board[r][c] = color;
    moves.push({ r, c, color, coord: key, source: 'regression' });
    color = color === 1 ? 2 : 1;
  }
  return { board, moves };
}

function oneHotChoice(choice, keys) {
  return {
    type: 'choice',
    choice,
    confidence: 1,
    probabilities: Object.fromEntries(keys.map(key => [key, key === choice ? 1 : 0]))
  };
}

async function testJevFinalDecisionAuthority() {
  let jevTarget = null;
  let requestCount = 0;

  const engine = await loadProductionEngine({
    request: async ({ payload }) => {
      requestCount++;
      const questions = payload?.questions || {};
      const questionIds = Object.keys(questions);
      if (questionIds.length !== 1 || questionIds[0] !== 'best_move') {
        throw new Error('Hybrid must send exactly one best_move question to Jev');
      }

      const criteria = questions.best_move?.criteria || {};
      const candidateKeys = Object.keys(criteria);
      if (candidateKeys.length < 2) throw new Error('Need at least two candidates');

      for (const candidate of Object.values(criteria)) {
        if (!('local_rank' in candidate)) throw new Error('Local rank evidence missing');
        if (!('local_alpha_beta_score' in candidate)) throw new Error('Local search evidence missing');
        if (!('deep_search_rank' in candidate)) throw new Error('Deep-search evidence missing');
        if (!('tactical_safety' in candidate)) throw new Error('Tactical safety evidence missing');
      }

      jevTarget = candidateKeys[1];
      return {
        model: 'mock-jev',
        answers: {
          best_move: oneHotChoice(jevTarget, candidateKeys)
        },
        usage: { input_tokens: 1, output_tokens: 1 },
        __client: { attempts: 1, cached: false, transport: 'regression-mock' }
      };
    }
  });

  const position = positionFromSequence(['G7']);
  engine.setPosition(position.board, position.moves, 'jev-latest');
  const result = await engine.hybrid('expert');

  console.log('jev-final regression:', JSON.stringify({
    finalChoice: result.finalChoice,
    localChoice: result.localChoice,
    jevSuggested: result.jevSuggested,
    requestShape: result.decisionTrace?.requestShape,
    deepSearch: result.decisionTrace?.preJevDeepSearch
  }));

  if (!jevTarget) throw new Error('Mock Jev did not receive candidate choices');
  if (jevTarget === result.localChoice) throw new Error('Regression target must differ from Local #1');
  if (result.finalChoice !== jevTarget) {
    throw new Error('Jev choice was not used as final move: expected ' + jevTarget + ', got ' + result.finalChoice);
  }
  if (result.jevSuggested !== jevTarget) {
    throw new Error('jevSuggested must reflect Jev final choice');
  }
  if (requestCount !== 1) {
    throw new Error('Expected exactly one Jev request, got ' + requestCount);
  }
  if (result.decisionTrace?.requestShape?.decisionAuthority !== 'jev_final') {
    throw new Error('Trace does not record Jev final decision authority');
  }
  if (result.decisionTrace?.requestShape?.localOpeningAdaptive !== true) {
    throw new Error('Expert opening must use the adaptive shallow local profile');
  }
  if (result.decisionTrace?.requestShape?.deepSearchPolicy !== 'skip_opening') {
    throw new Error('Expert opening must skip the extra pre-Jev deep worker');
  }
  if (result.decisionTrace?.preJevDeepSearch?.status !== 'skipped_opening') {
    throw new Error('Expected pre-Jev deep search to be marked skipped_opening');
  }
  if (result.decisionTrace?.requestShape?.localEvidenceVisibleToJev !== true) {
    throw new Error('Trace does not confirm Local evidence is visible to Jev');
  }
  if (result.decisionTrace?.finalDecision?.choice !== jevTarget) {
    throw new Error('Final Jev decision trace is missing or incorrect');
  }
  if (!result.decisionTrace?.preJevDeepSearch) {
    throw new Error('Pre-Jev deep-search evidence is missing');
  }
}


async function testMustBlockOpponentForkCreator() {
  const engine = await loadProductionEngine({
    request: async () => {
      throw new Error('Fork-defense regression must be resolved locally without a Jev request');
    }
  });

  const sequence = [
    'H8', 'G7', 'G9', 'I7', 'H7', 'H6', 'J8', 'I5', 'F8', 'I8',
    'I6', 'J4', 'K3', 'G5', 'H5', 'F4', 'E3', 'G4', 'G6', 'E4',
    'D4', 'I4', 'H4', 'G1', 'C5', 'G2', 'G3'
  ];
  const position = positionFromSequence(sequence);
  engine.setPosition(position.board, position.moves, 'jev-latest');

  const result = engine.local('expert');
  console.log('fork-defense regression:', JSON.stringify({
    finalChoice: result.finalChoice,
    forced: result.forced,
    candidates: result.candidates?.map(candidate => ({
      move: candidate.key,
      safety: candidate.analysis?.facts?.tactical_safety,
      opponentForks: candidate.analysis?.facts?.opponent_fork_creator_points
    }))
  }));

  if (result.finalChoice !== 'B6') {
    throw new Error('Expected mandatory fork defense B6, got ' + result.finalChoice);
  }
  if (result.forced !== 'block_fork') {
    throw new Error('Expected forced=block_fork, got ' + result.forced);
  }
}

await testJevFinalDecisionAuthority();
await testMustBlockOpponentForkCreator();
console.log('Engine regression tests passed.');
