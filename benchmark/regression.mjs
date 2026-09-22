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
    request: async () => {
      throw new Error('Horizon regression must not call Jev');
    }
  });

  // Real game from 2026-09-22, position after black 19.G6.
  // Old engine chose 20.E6 as a clearly positive #1, then after 21.D5
  // every white continuation collapsed to mate-scale negative scores.
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
  const context = engine.candidates('expert');
  const e6 = context.candidates.find(move => move.key === 'E6');

  engine.setPosition(position.board, position.moves, 'jev-latest');
  const local = engine.local('expert');

  console.log('lost-game regression:', JSON.stringify({
    choice: local.finalChoice,
    candidates: context.candidates.map(move => ({
      move: move.key,
      safety: move.analysis?.facts?.tactical_safety,
      counterVcf: move.analysis?.facts?.opponent_counter_vcf,
      counterVct: move.analysis?.facts?.opponent_counter_vct,
      searchScore: move.searchScore
    })),
    e6: e6 ? {
      safety: e6.analysis?.facts?.tactical_safety,
      counterVcf: e6.analysis?.facts?.opponent_counter_vcf,
      counterVct: e6.analysis?.facts?.opponent_counter_vct,
      searchScore: e6.searchScore
    } : null
  }));

  if (!e6) {
    throw new Error('Regression failed: expected E6 to remain visible for diagnostics');
  }

  if (e6.analysis?.facts?.tactical_safety === 'SAFE') {
    throw new Error('Regression failed: E6 is still classified SAFE');
  }

  if (!e6.analysis?.facts?.opponent_double_threat || e6.analysis.facts.opponent_double_threat === 'NOT_FOUND') {
    throw new Error('Regression failed: E6 does not expose the opponent double-threat creator');
  }

  // The position may already be objectively lost, so the regression does not
  // require a specific replacement move. It requires the engine to stop calling
  // E6 safe and to surface the tactical reason instead of a horizon-blind score.
  if (local.finalChoice === 'E6' && e6.analysis?.facts?.tactical_safety !== 'LOSING') {
    throw new Error('Regression failed: E6 can only remain top if it is explicitly marked losing');
  }
}

async function testIndependentChallengerVerification() {
  let challengerTarget = null;

  const engine = await loadProductionEngine({
    request: async ({ payload }) => {
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
