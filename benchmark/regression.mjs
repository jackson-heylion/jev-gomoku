/**
 * Engine regression suite.
 *
 * These tests pin down the behaviour the benchmark depends on:
 *   - Jev is the FINAL decision maker inside the filtered candidate set.
 *   - A single deterministic candidate is played with 0 Jev calls.
 *   - The shipped opening / deep-search performance protection is real.
 *   - Renju rules are identical for the engine, the referee and the game loop.
 *
 * Run with: npm run benchmark:regression
 */

import { loadProductionEngine } from './harness.mjs';
import { createBrowserWorkerClass } from './worker-shim.mjs';
import { BLACK, EMPTY, SIZE, WHITE, Referee, coord, parseCoord } from './referee.mjs';

function positionFromSequence(sequence) {
  const board = Array.from({ length: SIZE }, () => Array(SIZE).fill(EMPTY));
  const moves = [];
  let color = BLACK;
  for (const key of sequence) {
    const point = parseCoord(key);
    board[point.r][point.c] = color;
    moves.push({ r: point.r, c: point.c, color, coord: key, source: 'regression' });
    color = color === BLACK ? WHITE : BLACK;
  }
  return { board, moves };
}

function positionFromStones({ black = [], white = [] }) {
  const board = Array.from({ length: SIZE }, () => Array(SIZE).fill(EMPTY));
  const moves = [];
  for (const key of black) {
    const point = parseCoord(key);
    board[point.r][point.c] = BLACK;
    moves.push({ r: point.r, c: point.c, color: BLACK, coord: key, source: 'regression' });
  }
  for (const key of white) {
    const point = parseCoord(key);
    board[point.r][point.c] = WHITE;
    moves.push({ r: point.r, c: point.c, color: WHITE, coord: key, source: 'regression' });
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

/**
 * Jev owns the final move: it receives one `best_move` question with Local
 * evidence, and its answer is what the engine plays.
 */
async function testJevFinalDecisionAuthority() {
  let jevTarget = null;
  let requestCount = 0;

  const engine = await loadProductionEngine({
    request: async ({ payload }) => {
      requestCount++;
      const questions = payload?.questions || {};
      const questionIds = Object.keys(questions);
      if (questionIds.length !== 1 || questionIds[0] !== 'best_move') {
        throw new Error('jev-final must send exactly one best_move question to Jev');
      }

      const criteria = questions.best_move?.criteria || {};
      const commonEvidence = payload?.state?.common_candidate_evidence || {};
      const candidateKeys = Object.keys(criteria);
      if (candidateKeys.length < 2) throw new Error('Need at least two candidates');

      if (Object.values(payload?.state?.deep_search || {}).some(value => value === null || value === undefined)) {
        throw new Error('Null deep-search state leaked into compact Jev payload');
      }

      if (!payload?.state?.gomoku_doctrine?.threat_hierarchy) {
        throw new Error('Compact Gomoku doctrine is missing from Jev payload');
      }
      if (!String(payload.state.gomoku_doctrine.evidence_order || '').includes('LEGALITY_AND_PROOF')) {
        throw new Error('Gomoku doctrine must rank deterministic proof above heuristics');
      }

      for (const candidate of Object.values(criteria)) {
        if (Object.values(candidate).some(value => value === null || value === undefined)) {
          throw new Error('Null candidate evidence leaked into compact Jev payload');
        }
        if ('deep_search_depth' in candidate) {
          throw new Error('Per-candidate deep_search_depth duplicates state.deep_search.depth_reached');
        }

        const effectiveEvidence = { ...commonEvidence, ...candidate };
        if (!('local_rank' in effectiveEvidence)) throw new Error('Local rank evidence missing');
        if (!('local_alpha_beta_score' in effectiveEvidence)) throw new Error('Local search evidence missing');
        if (!('tactical_safety' in effectiveEvidence)) throw new Error('Tactical safety evidence missing');
        if (!('pattern_class' in effectiveEvidence)) throw new Error('Pattern-class evidence missing');
        if (!('pattern_score' in effectiveEvidence)) throw new Error('Pattern score evidence missing');
        if (!('blocks_opponent_pattern' in effectiveEvidence)) throw new Error('Opponent-pattern denial evidence missing');

        if (payload?.state?.deep_search?.status === 'skipped_opening') {
          if ('deep_search_rank' in candidate || 'deep_search_score' in candidate) {
            throw new Error('Skipped opening should omit unavailable per-candidate deep-search evidence');
          }
        }
      }

      jevTarget = candidateKeys[1];
      return {
        model: 'mock-jev',
        answers: { best_move: oneHotChoice(jevTarget, candidateKeys) },
        usage: { input_tokens: 1, output_tokens: 1 },
        __client: { attempts: 1, cached: false, transport: 'regression-mock' }
      };
    }
  });

  const position = positionFromSequence(['G7']);
  engine.setPosition(position.board, position.moves, 'jev-latest');
  const result = await engine.jevFinal('expert');

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
    throw new Error('jevSuggested must reflect the Jev final choice');
  }
  if (requestCount !== 1) throw new Error('Expected exactly one Jev request, got ' + requestCount);
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

/**
 * Expert/Grandmaster only keep the shallow opening profile for moves.length < 4,
 * and every local candidate build reports its bounded wall-clock search budget.
 */
async function testLocalTimeBudgetAndOpeningThreshold() {
  const engine = await loadProductionEngine({
    request: async () => {
      throw new Error('Local budget regression must not call Jev');
    }
  });

  const opening3 = positionFromSequence(['H8', 'H9', 'G8']);
  engine.setPosition(opening3.board, opening3.moves, 'jev-latest');
  const shallow = engine.candidates('expert');
  if (shallow.cfg.openingAdaptive !== true || shallow.cfg.depth !== 3) {
    throw new Error('Expert must keep the shallow opening profile while moves.length < 4');
  }
  if (shallow.localSearch?.budgetMs !== 2200) {
    throw new Error('Expert local search budget must be 2200ms');
  }

  const opening4 = positionFromSequence(['H8', 'H9', 'G8', 'G9']);
  engine.setPosition(opening4.board, opening4.moves, 'jev-latest');
  const full = engine.candidates('expert');
  console.log('local budget regression:', JSON.stringify({
    opening3: {
      adaptive: shallow.cfg.openingAdaptive,
      depth: shallow.cfg.depth,
      localSearch: shallow.localSearch
    },
    opening4: {
      adaptive: full.cfg.openingAdaptive,
      depth: full.cfg.depth,
      localSearch: full.localSearch
    }
  }));

  if (full.cfg.openingAdaptive !== false || full.cfg.depth !== 5) {
    throw new Error('Expert must restore full depth at moves.length >= 4');
  }
  if (full.localSearch?.budgetMs !== 2200) {
    throw new Error('Full Expert profile lost the 2200ms local search budget');
  }
  if (!Number.isFinite(full.localSearch?.elapsedMs) || full.localSearch.elapsedMs < 0) {
    throw new Error('Local search trace must report elapsedMs');
  }
  if (!Number.isFinite(full.localSearch?.depthReached) || full.localSearch.depthReached > 5) {
    throw new Error('Local search trace returned an invalid depthReached');
  }
  if (full.localSearch.elapsedMs > 3800) {
    throw new Error('Local search exceeded its bounded budget by too much: ' + full.localSearch.elapsedMs + 'ms');
  }
}

/**
 * Cheap root pattern expert must recall obvious open-four builders without
 * widening the configured Alpha-Beta root set.
 */
async function testThreatPatternCandidateRecall() {
  const engine = await loadProductionEngine({
    request: async () => {
      throw new Error('Pattern recall regression must not call Jev');
    }
  });

  const position = positionFromStones({
    white: ['E8', 'F8', 'G8'],
    black: ['A1', 'A2', 'B1']
  });
  engine.setPosition(position.board, position.moves, 'jev-latest');
  const context = engine.candidates('expert');
  const tactical = context.candidates.filter(candidate =>
    ['OPEN_FOUR', 'FOUR_THREE', 'DOUBLE_FOUR'].includes(candidate.analysis?.facts?.pattern_class)
  );

  console.log('pattern recall regression:', JSON.stringify({
    roots: context.candidates.map(candidate => ({
      move: candidate.key,
      pattern: candidate.analysis?.facts?.pattern_class,
      patternScore: candidate.analysis?.facts?.pattern_score,
      deny: candidate.analysis?.facts?.blocks_opponent_pattern
    }))
  }));

  if (!tactical.length) {
    throw new Error('Pattern expert failed to retain an obvious open-four candidate');
  }
  if (context.cfg.root !== 14) {
    throw new Error('Pattern recall must not widen Expert root configuration');
  }
}

/**
 * Grandmaster runs two bounded background analyses. It may skip Jev when the
 * evidence converges, but disagreement/timeout may trigger at most one Jev call.
 */
async function testGrandmasterParallelThreatMode() {
  let requestCount = 0;
  const engine = await loadProductionEngine({
    request: async ({ payload }) => {
      requestCount++;
      const criteria = payload?.questions?.best_move?.criteria || {};
      const keys = Object.keys(criteria);
      if (keys.length < 2) throw new Error('Grandmaster Jev arbitration needs at least two candidates');
      if (!payload?.state?.threat_space_search) {
        throw new Error('Grandmaster Jev payload is missing threat-space search state');
      }
      const choice = keys[keys.length - 1];
      return {
        model: 'mock-jev',
        answers: { best_move: oneHotChoice(choice, keys) },
        usage: { input_tokens: 1, output_tokens: 1 },
        __client: { attempts: 1, cached: false, transport: 'regression-mock' }
      };
    }
  });

  const position = positionFromSequence(['G7']);
  engine.setPosition(position.board, position.moves, 'jev-latest');
  const result = await engine.jevFinal('grandmaster');

  console.log('grandmaster regression:', JSON.stringify({
    finalChoice: result.finalChoice,
    localChoice: result.localChoice,
    requestCount,
    requestShape: result.decisionTrace?.requestShape,
    deepSearch: result.decisionTrace?.preJevDeepSearch,
    threatSearch: result.decisionTrace?.preJevThreatSearch
  }));

  if (result.mode !== 'grandmaster') throw new Error('Grandmaster result mode was not preserved');
  if (!result.candidates?.some(candidate => candidate.key === result.finalChoice)) {
    throw new Error('Grandmaster final choice is outside the filtered candidate set');
  }
  if (requestCount > 1) throw new Error('Grandmaster must use at most one Jev request, got ' + requestCount);
  if (result.candidates.length > 1) {
    if (result.decisionTrace?.requestShape?.parallelEvidence !== true) {
      throw new Error('Grandmaster trace must record parallel evidence');
    }
    if (!result.decisionTrace?.preJevDeepSearch) {
      throw new Error('Grandmaster deep-search evidence is missing');
    }
    if (!result.decisionTrace?.preJevThreatSearch) {
      throw new Error('Grandmaster threat-space evidence is missing');
    }
  }
  if (requestCount === 1) {
    if (result.decisionTrace?.requestShape?.decisionAuthority !== 'jev_on_disagreement') {
      throw new Error('Grandmaster Jev call must only occur on disagreement/evidence uncertainty');
    }
    if (result.decisionTrace?.requestShape?.threatEvidenceVisibleToJev !== true) {
      throw new Error('Grandmaster Jev arbitration did not receive threat evidence');
    }
  } else if (!['multi_engine_consensus', 'threat_filter_single', 'single_candidate'].includes(
    result.decisionTrace?.requestShape?.decisionAuthority
  )) {
    throw new Error('Unexpected zero-Jev grandmaster decision authority');
  }
}

async function testGrandmasterRealGameThreatTrace() {
  const engine = await loadProductionEngine({
    request: async ({ payload }) => {
      const criteria = payload?.questions?.best_move?.criteria || {};
      const keys = Object.keys(criteria);
      const choice = keys[0];
      return {
        model: 'mock-jev',
        answers: { best_move: oneHotChoice(choice, keys) },
        usage: { input_tokens: 1, output_tokens: 1 },
        __client: { attempts: 1, cached: false, transport: 'real-game-regression' }
      };
    }
  });

  const sequence = [
    'H7','G8','G6','I8','H8','H9','J7','F7','E6','I10','J11','I9',
    'I7','I11','I12','K7','J8','G9','J9','J10','J6','J5','H6'
  ];
  const position = positionFromSequence(sequence);
  engine.setPosition(position.board, position.moves, 'jev-latest');
  const result = await engine.jevFinal('grandmaster');
  const threat = result.decisionTrace?.preJevThreatSearch;

  console.log('grandmaster real-game threat trace:', JSON.stringify({
    finalChoice: result.finalChoice,
    localChoice: result.localChoice,
    candidates: result.candidates?.map(item => item.key),
    threat
  }));

  if (!threat) throw new Error('Real-game grandmaster trace is missing threat evidence');
  if (!Array.isArray(threat.analyses) || !threat.analyses.length) {
    throw new Error('Real-game threat search returned no candidate analyses');
  }

  const byMove = new Map(threat.analyses.map(item => [item.move, item]));
  for (const losingMove of ['K9', 'G5']) {
    const evidence = byMove.get(losingMove);
    if (!evidence?.forced) {
      throw new Error('Threat search failed to prove the real-game losing candidate ' + losingMove);
    }
    if (evidence.attackerTurns !== 4) {
      throw new Error('Expected a four-attacker-turn proof for ' + losingMove + ', got ' + evidence.attackerTurns);
    }
    if (evidence.line?.[0] !== 'I6' || !evidence.line?.includes('K8')) {
      throw new Error('Threat proof for ' + losingMove + ' lost the expected I6...K8 forcing line');
    }
  }

  for (const survivingMove of ['F9', 'E9']) {
    if (byMove.get(survivingMove)?.forced) {
      throw new Error('Threat search incorrectly marked ' + survivingMove + ' as a proven forced loss');
    }
  }
}

/** A single deterministic candidate must never trigger a Jev request. */
async function testSingleCandidateShortCircuit() {
  let requestCount = 0;
  const engine = await loadProductionEngine({
    request: async () => {
      requestCount++;
      throw new Error('A forced single candidate must not call Jev');
    }
  });

  // BLACK has A8-D8 and wins by completing the five at E8, so WHITE has exactly
  // one legal defence.
  const position = positionFromStones({
    black: ['A8', 'B8', 'C8', 'D8'],
    white: ['H8', 'I9']
  });
  engine.setPosition(position.board, position.moves, 'jev-latest');

  const result = await engine.jevFinal('expert');
  console.log('single-candidate regression:', JSON.stringify({
    finalChoice: result.finalChoice,
    candidateCount: result.candidates?.length,
    forced: result.forced,
    requestShape: result.decisionTrace?.requestShape
  }));

  if (requestCount !== 0) throw new Error('Forced single candidate called Jev ' + requestCount + ' time(s)');
  if (result.finalChoice !== 'E8') throw new Error('Expected the only mandatory defence E8, got ' + result.finalChoice);
  if (result.candidates.length !== 1) {
    throw new Error('Expected a single candidate, got ' + result.candidates.length);
  }
  if (result.decisionTrace?.requestShape?.decisionAuthority !== 'single_candidate') {
    throw new Error('Trace must mark the single-candidate shortcut');
  }
  if (result.decisionTrace?.requestShape?.httpRequests !== 0) {
    throw new Error('Single-candidate shortcut must record zero HTTP requests');
  }
}

/** Local must still find a mandatory fork defence without any Jev call. */
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

/** Black forbidden rules, straight from production. */
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
    console.log('renju regression:', JSON.stringify({ name: item.name, move: item.move, result }));

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

/**
 * The three BLACK forbidden rules are independently configurable.
 */
async function testConfigurableForbiddenRules() {
  const engine = await loadProductionEngine({
    request: async () => {
      throw new Error('Rule configuration regression must not call Jev');
    }
  });

  const cases = [
    {
      name: 'overline-off',
      config: { playerColor: 'black', overline: false, fourFour: true, threeThree: true },
      position: positionFromStones({ black: ['A8', 'B8', 'C8', 'D8', 'F8'] }),
      move: 'E8',
      expectedType: null,
      winsNow: true
    },
    {
      name: 'double-four-off',
      config: { playerColor: 'black', overline: true, fourFour: false, threeThree: true },
      position: positionFromStones({ black: ['E8', 'F8', 'G8', 'H5', 'H6', 'H7'] }),
      move: 'H8',
      expectedType: null
    },
    {
      name: 'double-three-off',
      config: { playerColor: 'black', overline: true, fourFour: true, threeThree: false },
      position: positionFromStones({ black: ['F8', 'G8', 'H6', 'H7'] }),
      move: 'H8',
      expectedType: null
    }
  ];

  for (const item of cases) {
    engine.setGameConfig(item.config);
    engine.setPosition(item.position.board, item.position.moves, 'jev-latest');
    const verdict = engine.judge(item.move, BLACK);
    console.log('configurable rule regression:', JSON.stringify({
      name: item.name,
      config: engine.gameConfig(),
      verdict
    }));
    if (!verdict.legal || verdict.forbidden) {
      throw new Error(item.name + ': disabling this forbidden rule must make the move legal');
    }
    if ((verdict.forbiddenType || null) !== item.expectedType) {
      throw new Error(item.name + ': unexpected forbidden type ' + verdict.forbiddenType);
    }
    if (item.winsNow && verdict.winsNow !== true) {
      throw new Error(item.name + ': black overline must win when overline prohibition is disabled');
    }
  }

  // Independence check: turning off double-three must not silently turn off overline.
  engine.setGameConfig({ playerColor: 'black', overline: true, fourFour: true, threeThree: false });
  const overline = positionFromStones({ black: ['A8', 'B8', 'C8', 'D8', 'F8'] });
  engine.setPosition(overline.board, overline.moves, 'jev-latest');
  const stillForbidden = engine.judge('E8', BLACK);
  if (stillForbidden.legal || stillForbidden.forbiddenType !== 'OVERLINE') {
    throw new Error('Forbidden toggles are not independent: overline changed when only three-three was disabled');
  }
}

/** AI can take BLACK and the deterministic engine must search from BLACK's perspective. */
async function testAiCanPlayBlack() {
  let requestCount = 0;
  const engine = await loadProductionEngine({
    request: async () => {
      requestCount++;
      throw new Error('Immediate AI-black win must not call Jev');
    }
  });

  engine.setGameConfig({
    playerColor: 'white',
    overline: true,
    fourFour: true,
    threeThree: true
  });
  const position = positionFromStones({
    black: ['A8', 'B8', 'C8', 'D8'],
    white: ['H6', 'I6']
  });
  engine.setPosition(position.board, position.moves, 'jev-latest', BLACK);
  const result = await engine.jevFinal('grandmaster');

  console.log('AI-black regression:', JSON.stringify({
    config: engine.gameConfig(),
    finalChoice: result.finalChoice,
    candidates: result.candidates?.map(item => item.key),
    requestCount
  }));

  if (engine.gameConfig().aiColor !== BLACK) throw new Error('AI color did not switch to BLACK');
  if (result.finalChoice !== 'E8') {
    throw new Error('BLACK AI failed to take immediate exact-five win E8: ' + result.finalChoice);
  }
  if (requestCount !== 0) {
    throw new Error('Deterministic BLACK immediate win unexpectedly called Jev');
  }

  // With overline disabled, a six-in-a-row completion is legal and winning.
  engine.setGameConfig({
    playerColor: 'white',
    overline: false,
    fourFour: true,
    threeThree: true
  });
  const overlineWin = positionFromStones({
    black: ['A8', 'B8', 'C8', 'D8', 'F8'],
    white: ['H6', 'I6']
  });
  engine.setPosition(overlineWin.board, overlineWin.moves, 'jev-latest', BLACK);
  const overlineResult = engine.local('expert');
  if (overlineResult.finalChoice !== 'E8') {
    throw new Error('BLACK AI did not use legal overline winning point E8 when overline prohibition was disabled');
  }
}

/** Worker-side legality must receive the same BLACK rule toggles as the main engine. */
async function testWorkerRulePropagation() {
  const WorkerClass = createBrowserWorkerClass();
  const board = positionFromStones({ black: ['A8', 'B8', 'C8', 'D8', 'F8'] }).board;

  const run = rules => new Promise((resolve, reject) => {
    const worker = new WorkerClass('/deep-worker.js');
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error('Worker rule regression timed out'));
    }, 5000);
    worker.onmessage = event => {
      clearTimeout(timer);
      worker.terminate();
      resolve(event.data);
    };
    worker.onerror = event => {
      clearTimeout(timer);
      worker.terminate();
      reject(new Error(event?.message || 'Worker rule regression crashed'));
    };
    worker.postMessage({
      id: 991,
      task: 'search',
      board,
      side: BLACK,
      rules,
      candidates: ['E8'],
      timeBudgetMs: 500,
      maxDepth: 3,
      branch: 4
    });
  });

  const disabled = await run({ overline: false, fourFour: true, threeThree: true });
  if (!disabled.ok || disabled.result?.winner !== 'E8') {
    throw new Error('Worker rejected legal BLACK overline after overline rule was disabled');
  }
  if (disabled.result?.quiescenceDepth !== 2) {
    throw new Error('Deep Worker must expose the bounded threat-quiescence extension');
  }
  if (!Number.isFinite(disabled.result?.transpositionEntries)) {
    throw new Error('Deep Worker must expose bounded transposition-table usage');
  }

  const enabled = await run({ overline: true, fourFour: true, threeThree: true });
  if (enabled.ok) {
    throw new Error('Worker accepted forbidden BLACK overline while overline rule was enabled');
  }
  console.log('worker rule regression: dynamic overline legality matches main rule config');
}

/**
 * The benchmark game engine must enforce exactly the same rules as production:
 * the referee delegates every legality/win question to `src/app.js`.
 */
async function testRefereeRuleParity() {
  const engine = await loadProductionEngine({
    request: async () => {
      throw new Error('Referee regression must not call Jev');
    }
  });
  const referee = new Referee(engine, { model: 'jev-latest', maxPlies: 40 });

  // 1. Black overline: illegal, never a win.
  const overline = positionFromStones({ black: ['A8', 'B8', 'C8', 'D8', 'F8'] });
  referee.reset([]);
  referee.board = overline.board;
  referee.moves = overline.moves;
  referee.toMove = BLACK;
  const overlineVerdict = referee.inspect('E8', BLACK);
  console.log('referee overline:', JSON.stringify(overlineVerdict));
  if (overlineVerdict.legal) throw new Error('Referee accepted a black overline');
  if (overlineVerdict.forbiddenType !== 'OVERLINE') throw new Error('Referee did not report OVERLINE');
  if (overlineVerdict.winsNow) throw new Error('Referee counted a black overline as a win');

  // 2. Black exact five: legal and winning.
  const exactFive = positionFromStones({ black: ['D8', 'E8', 'F8', 'G8'], white: ['H6'] });
  referee.board = exactFive.board;
  referee.moves = exactFive.moves;
  referee.toMove = BLACK;
  const fiveVerdict = referee.inspect('H8', BLACK);
  console.log('referee exact five:', JSON.stringify(fiveVerdict));
  if (!fiveVerdict.legal || !fiveVerdict.winsNow || !fiveVerdict.exactFive) {
    throw new Error('Referee must accept a black exact five as a win');
  }

  referee.board = exactFive.board.map(row => row.slice());
  referee.moves = exactFive.moves.map(move => ({ ...move }));
  referee.toMove = BLACK;
  referee.commit('H8', BLACK, fiveVerdict);
  if (referee.result !== 'B' || referee.winReason !== 'exact_five') {
    throw new Error('Referee did not record the black exact-five win: ' + referee.result + '/' + referee.winReason);
  }

  // 3. White overline: legal and winning.
  const whiteOverline = positionFromStones({ white: ['A8', 'B8', 'C8', 'D8', 'F8'], black: ['A1', 'A2'] });
  referee.board = whiteOverline.board;
  referee.moves = whiteOverline.moves;
  referee.toMove = WHITE;
  const whiteVerdict = referee.inspect('E8', WHITE);
  if (!whiteVerdict.legal || !whiteVerdict.winsNow) {
    throw new Error('Referee must accept a white overline as a win');
  }

  // 4. Occupied points are rejected.
  referee.board = exactFive.board;
  referee.moves = exactFive.moves;
  const occupied = referee.inspect('D8', BLACK);
  if (occupied.legal || occupied.reason !== 'occupied') {
    throw new Error('Referee must reject an occupied point');
  }

  // 5. A double-three is rejected for BLACK but fine for WHITE.
  const doubleThree = positionFromStones({ black: ['F8', 'G8', 'H6', 'H7'] });
  referee.board = doubleThree.board;
  referee.moves = doubleThree.moves;
  const blackThree = referee.inspect('H8', BLACK);
  const whiteThree = referee.inspect('H8', WHITE);
  if (blackThree.legal || blackThree.forbiddenType !== 'THREE_THREE') {
    throw new Error('Referee must reject a black double-three');
  }
  if (!whiteThree.legal) throw new Error('WHITE has no forbidden moves; H8 must be legal for white');
}

/** The offline oracle used to grade Jev's overrides must be deterministic and honest. */
async function testArbitrationOracle() {
  const engine = await loadProductionEngine({
    request: async () => {
      throw new Error('Arbitration regression must not call Jev');
    }
  });

  const position = positionFromSequence(['G7']);
  engine.setPosition(position.board, position.moves, 'jev-latest');
  const local = engine.local('expert');
  const first = local.candidates[0].key;
  const second = local.candidates[1]?.key;
  if (!second) throw new Error('Arbitration regression needs at least two candidates');

  const result = engine.arbitrate(first, second, { mode: 'expert', depth: 5, branch: 4 });
  console.log('arbitration regression:', JSON.stringify(result));

  if (result.config.depth !== 5 || result.config.branch !== 4) {
    throw new Error('Arbitration must honour the requested depth/branch');
  }
  if (!['a', 'b', 'tie'].includes(result.verdict)) {
    throw new Error('Unexpected arbitration verdict: ' + result.verdict);
  }
  for (const side of ['a', 'b']) {
    if (!Number.isFinite(result[side].searchScore)) {
      throw new Error('Arbitration must produce a finite search score for ' + side);
    }
    if (!Number.isFinite(result[side].safetyRank)) {
      throw new Error('Arbitration must produce a tactical safety rank for ' + side);
    }
  }

  const repeat = engine.arbitrate(second, first, { mode: 'expert', depth: 5, branch: 4 });
  if (repeat.a.searchScore !== result.b.searchScore || repeat.b.searchScore !== result.a.searchScore) {
    throw new Error('Arbitration must be symmetric under argument order');
  }
}

/** The referee must derive its coordinates and board from the shared helpers. */
function testCoordinateHelpers() {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const key = coord(r, c);
      const parsed = parseCoord(key);
      if (!parsed || parsed.r !== r || parsed.c !== c) {
        throw new Error('Coordinate round-trip failed for ' + key);
      }
    }
  }
  if (parseCoord('P1') || parseCoord('A0') || parseCoord('A16')) {
    throw new Error('Out-of-board coordinates must not parse');
  }
}

await testCoordinateHelpers();
await testSingleCandidateShortCircuit();
await testJevFinalDecisionAuthority();
await testLocalTimeBudgetAndOpeningThreshold();
await testThreatPatternCandidateRecall();
await testGrandmasterParallelThreatMode();
await testGrandmasterRealGameThreatTrace();
await testArbitrationOracle();
await testMustBlockOpponentForkCreator();
await testRenjuForbiddenMoves();
await testConfigurableForbiddenRules();
await testAiCanPlayBlack();
await testWorkerRulePropagation();
await testUndoAfterGameOver();
await testRefereeRuleParity();
console.log('Engine regression tests passed.');
