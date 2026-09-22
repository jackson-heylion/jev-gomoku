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

async function testIndependentChallengerVerification() {
  let challengerTarget = null;

  const engine = await loadProductionEngine({
    request: async ({ payload }) => {
      const facts = payload?.state?.candidate_facts || {};
      const candidateKeys = Object.keys(facts);
      if (candidateKeys.length < 2) throw new Error('Need at least two candidates');

      for (const candidate of Object.values(facts)) {
        if ('local_rank' in candidate || 'local_engine_grade' in candidate) {
          throw new Error('Local ranking leaked into Jev candidate_facts');
        }
      }

      challengerTarget = candidateKeys[1];
      const answers = {};
      for (const [questionId, question] of Object.entries(payload.questions || {})) {
        const keys = Object.keys(question.criteria || {});
        if (questionId.startsWith('judge_')) {
          const move = questionId.slice('judge_'.length);
          const choice = move === challengerTarget ? 'EXCELLENT' : 'NEUTRAL';
          answers[questionId] = oneHotChoice(choice, ['EXCELLENT', 'GOOD', 'NEUTRAL', 'RISKY', 'BAD']);
        } else if (questionId.startsWith('duel_')) {
          const choice = keys.includes(challengerTarget) ? challengerTarget : keys[0];
          answers[questionId] = oneHotChoice(choice, keys);
        }
      }

      return {
        model: 'mock-jev',
        answers,
        usage: { input_tokens: 1, output_tokens: 1 },
        __client: { attempts: 1, cached: false, transport: 'regression-mock' }
      };
    }
  });

  const position = positionFromSequence(['G7']);
  engine.setPosition(position.board, position.moves, 'jev-latest');
  const result = await engine.hybrid('strong');
  const challenger = result.decisionTrace?.challenger;

  console.log('challenger regression:', JSON.stringify({
    finalChoice: result.finalChoice,
    localChoice: result.localChoice,
    jevSuggested: result.jevSuggested,
    challenger
  }));

  if (!challengerTarget || !result.jevSuggested) {
    throw new Error('Mock Jev did not produce a challenger');
  }
  if (result.jevSuggested === result.localChoice) {
    throw new Error('Mock Jev did not disagree with Local');
  }
  if (!challenger?.disagreed || !challenger?.verification) {
    throw new Error('Local/Jev disagreement did not trigger deep verification');
  }
  if (result.decisionTrace?.requestShape?.localRankHiddenFromJev !== true) {
    throw new Error('Trace does not confirm Local rank is hidden from Jev');
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

await testIndependentChallengerVerification();
await testMustBlockOpponentForkCreator();
console.log('Engine regression tests passed.');
