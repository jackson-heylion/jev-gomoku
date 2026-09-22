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

await testIndependentChallengerVerification();
console.log('Engine regression tests passed.');
