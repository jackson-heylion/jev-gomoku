import { loadProductionEngine } from './harness.mjs';

const SIZE = 15;
const BLACK = 1;
const WHITE = 2;
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
    if (board[r][c] !== 0) throw new Error('Duplicate move: ' + key);
    board[r][c] = color;
    moves.push({ r, c, color, coord: key, source: 'regression' });
    color = color === BLACK ? WHITE : BLACK;
  }

  return { board, moves, toMove: color };
}

function oneHotChoice(choice, keys) {
  return {
    type: 'choice',
    choice,
    confidence: 1,
    probabilities: Object.fromEntries(keys.map(key => [key, key === choice ? 1 : 0]))
  };
}

async function testLostGameHorizonGuard() {
  const engine = await loadProductionEngine({
    request: async ({ payload }) => {
      if (!Array.isArray(payload?.state?.board_rows) || payload.state.board_rows.length !== 15) {
        throw new Error('Hybrid Jev request must include the full 15x15 board');
      }

      const candidateKeys = Object.keys(payload?.state?.candidate_facts || {});
      const localLikeChoice = candidateKeys[0];
      const answers = {};

      for (const [questionId, question] of Object.entries(payload.questions || {})) {
        const keys = Object.keys(question.criteria || {});
        if (questionId.startsWith('judge_')) {
          const move = questionId.slice('judge_'.length);
          const choice = move === localLikeChoice ? 'EXCELLENT' : 'GOOD';
          answers[questionId] = oneHotChoice(choice, ['EXCELLENT', 'GOOD', 'NEUTRAL', 'RISKY', 'BAD']);
        } else if (questionId.startsWith('duel_')) {
          const choice = keys.includes(localLikeChoice) ? localLikeChoice : keys[0];
          answers[questionId] = oneHotChoice(choice, keys);
        }
      }

      return {
        model: 'mock-jev-agree',
        answers,
        usage: { input_tokens: 1, output_tokens: 1 },
        __client: { attempts: 1, cached: false, transport: 'regression-mock' }
      };
    }
  });

  // Real game from 2026-09-22, position after black 19.G6.
  // Depth 5 rated E6 positively; depth 7 later showed both visible safe
  // candidates at mate-scale negative values. This must trigger Horizon Guard.
  const position = positionFromSequence([
    'G7', 'H8',
    'H6', 'F8',
    'I7', 'G8',
    'I8', 'E8',
    'D8', 'H9',
    'I6', 'I5',
    'H7', 'F7',
    'J7', 'K7',
    'I10', 'I9',
    'G6'
  ]);

  if (position.toMove !== WHITE) throw new Error('Regression position must be WHITE to move');

  engine.setPosition(position.board, position.moves, 'jev-latest');
  const result = await engine.hybrid('expert');
  const challenger = result.decisionTrace?.challenger;

  console.log('lost-game horizon regression:', JSON.stringify({
    finalChoice: result.finalChoice,
    localChoice: result.localChoice,
    jevSuggested: result.jevSuggested,
    trigger: challenger?.verificationTrigger,
    verification: challenger?.verification,
    rescue: challenger?.rescue
  }));

  if (challenger?.verificationTrigger !== 'horizon_guard') {
    throw new Error('Regression failed: late forcing move did not trigger Horizon Guard');
  }
  if (!challenger.verification || challenger.verification.config?.depth < 7) {
    throw new Error('Regression failed: Horizon Guard did not run depth-7 verification');
  }
  if (!Array.isArray(challenger.rescue) || challenger.rescue.length < 2) {
    throw new Error('Regression failed: mate-scale Horizon Guard did not expand rescue candidates');
  }
  if (result.decisionTrace?.requestShape?.localRankHiddenFromJev !== true) {
    throw new Error('Regression failed: Local rank is not hidden from Jev');
  }
}

async function testIndependentChallengerVerification() {
  let challengerTarget = null;

  const engine = await loadProductionEngine({
    request: async ({ payload }) => {
      if (!Array.isArray(payload?.state?.board_rows) || payload.state.board_rows.length !== 15) {
        throw new Error('Independent challenger did not receive the full board');
      }
      const facts = payload?.state?.candidate_facts || {};
      const candidateKeys = Object.keys(facts);
      if (candidateKeys.length < 2) throw new Error('Need at least two candidates for challenger regression');

      // Critical regression: Jev must not be told Local's hidden rank/grade.
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
          continue;
        }

        if (questionId.startsWith('duel_')) {
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
    throw new Error('Regression failed: mock Jev did not produce a challenger');
  }
  if (result.jevSuggested === result.localChoice) {
    throw new Error('Regression failed: mock Jev did not disagree with Local');
  }
  if (!challenger?.disagreed || !challenger?.verification) {
    throw new Error('Regression failed: Local/Jev disagreement did not trigger deep verification');
  }
  if (result.decisionTrace?.requestShape?.localRankHiddenFromJev !== true) {
    throw new Error('Regression failed: trace does not confirm Local rank is hidden from Jev');
  }
}

await testLostGameHorizonGuard();
await testIndependentChallengerVerification();
console.log('Engine regression tests passed.');
