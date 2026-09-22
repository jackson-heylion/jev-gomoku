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

function positionFromStones({ black = [], white = [] }) {
  const board = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
  const moves = [];
  for (const key of black) {
    const { r, c } = parseCoord(key);
    board[r][c] = BLACK;
    moves.push({ r, c, color: BLACK, coord: key, source: 'renju-regression' });
  }
  for (const key of white) {
    const { r, c } = parseCoord(key);
    board[r][c] = 2;
    moves.push({ r, c, color: 2, coord: key, source: 'renju-regression' });
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

async function testUndoAfterGameOver() {
  const engine = await loadProductionEngine({
    request: async () => {
      throw new Error('Undo regression must not call Jev');
    }
  });

  // White just made the terminal move. The old implementation looked at
  // current=WHITE and removed only one stone, leaving the player's previous
  // black stone on the board.
  {
    const position = positionFromSequence(['H8', 'H9', 'G8', 'G9']);
    engine.setPosition(position.board, position.moves, 'jev-latest');
    engine.setTurnState(2, true);
    const state = engine.undoTurn();

    if (state.gameOver) throw new Error('White-terminal undo must reopen the game');
    if (state.current !== BLACK) throw new Error('White-terminal undo must return the turn to BLACK');
    if (state.moves.length !== 2) {
      throw new Error('White-terminal undo must remove two plies, got ' + state.moves.length);
    }
    if (state.moves.map(move => move.coord).join(',') !== 'H8,H9') {
      throw new Error('White-terminal undo left the wrong move history');
    }
  }

  // Black just made the terminal move. Only that black stone should be
  // removed so the player can choose a different move.
  {
    const position = positionFromSequence(['H8', 'H9', 'G8']);
    engine.setPosition(position.board, position.moves, 'jev-latest');
    engine.setTurnState(BLACK, true);
    const state = engine.undoTurn();

    if (state.gameOver) throw new Error('Black-terminal undo must reopen the game');
    if (state.current !== BLACK) throw new Error('Black-terminal undo must return the turn to BLACK');
    if (state.moves.length !== 2) {
      throw new Error('Black-terminal undo must remove one ply, got ' + state.moves.length);
    }
    if (state.moves.map(move => move.coord).join(',') !== 'H8,H9') {
      throw new Error('Black-terminal undo left the wrong move history');
    }
  }

  // Normal player turn after Jev has replied: undo still rolls back the
  // complete player+Jev turn pair.
  {
    const position = positionFromSequence(['H8', 'H9', 'G8', 'G9']);
    engine.setPosition(position.board, position.moves, 'jev-latest');
    engine.setTurnState(BLACK, false);
    const state = engine.undoTurn();

    if (state.moves.length !== 2 || state.current !== BLACK || state.gameOver) {
      throw new Error('Normal undo semantics regressed');
    }
  }

  console.log('undo regression: terminal-white=2 plies, terminal-black=1 ply, normal=2 plies');
}

async function testRenjuForbiddenMoves() {
  const engine = await loadProductionEngine({
    request: async () => {
      throw new Error('Renju rule regression must not call Jev');
    }
  });

  const cases = [
    {
      name: 'overline',
      position: positionFromStones({ black: ['A8', 'B8', 'C8', 'D8', 'F8'] }),
      move: 'E8',
      forbidden: true,
      type: 'OVERLINE'
    },
    {
      name: 'double-four',
      position: positionFromStones({ black: ['E8', 'F8', 'G8', 'H5', 'H6', 'H7'] }),
      move: 'H8',
      forbidden: true,
      type: 'FOUR_FOUR'
    },
    {
      name: 'double-three',
      position: positionFromStones({ black: ['F8', 'G8', 'H6', 'H7'] }),
      move: 'H8',
      forbidden: true,
      type: 'THREE_THREE',
      excludedFromSearch: true
    },
    {
      name: 'false-three-is-legal',
      position: positionFromStones({
        black: ['F8', 'G8', 'H6', 'H7'],
        white: ['H5']
      }),
      move: 'H8',
      forbidden: false,
      type: null
    },
    {
      name: 'exact-five-has-priority',
      position: positionFromStones({ black: ['D8', 'E8', 'F8', 'G8', 'H6', 'H7'] }),
      move: 'H8',
      forbidden: false,
      type: null,
      winningFive: true
    }
  ];

  for (const item of cases) {
    engine.setPosition(item.position.board, item.position.moves, 'jev-latest');
    const result = engine.forbidden(item.move);
    console.log('renju regression:', JSON.stringify({
      name: item.name,
      move: item.move,
      result
    }));

    if (result.forbidden !== item.forbidden) {
      throw new Error(item.name + ': expected forbidden=' + item.forbidden + ', got ' + result.forbidden);
    }
    if ((result.type || null) !== item.type) {
      throw new Error(item.name + ': expected type=' + item.type + ', got ' + result.type);
    }
    if (item.winningFive && result.winningFive !== true) {
      throw new Error(item.name + ': exact five should be marked as winningFive');
    }
    if (item.excludedFromSearch) {
      const ordered = engine.orderedBlack(64);
      if (ordered.includes(item.move)) {
        throw new Error(item.name + ': forbidden move leaked into black ordered search: ' + item.move);
      }
    }
  }
}

await testJevFinalDecisionAuthority();
await testMustBlockOpponentForkCreator();
await testRenjuForbiddenMoves();
await testUndoAfterGameOver();
console.log('Engine regression tests passed.');
