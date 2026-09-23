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
  if (shallow.localSearch?.budgetMs !== 4400) {
    throw new Error('Expert local search budget must be 4400ms');
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
  if (full.localSearch?.budgetMs !== 4400) {
    throw new Error('Full Expert profile lost the 4400ms local search budget');
  }
  if (!Number.isFinite(full.localSearch?.elapsedMs) || full.localSearch.elapsedMs < 0) {
    throw new Error('Local search trace must report elapsedMs');
  }
  if (!Number.isFinite(full.localSearch?.depthReached) || full.localSearch.depthReached > 5) {
    throw new Error('Local search trace returned an invalid depthReached');
  }
  if (full.localSearch.elapsedMs > 7600) {
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
    if (!Number.isFinite(evidence.attackerTurns) || evidence.attackerTurns > 4) {
      throw new Error('Expected a bounded <=4-attacker-turn proof for ' + losingMove + ', got ' + evidence.attackerTurns);
    }
    if (!Array.isArray(evidence.line) || !evidence.line.length) {
      throw new Error('Threat proof for ' + losingMove + ' must expose a concrete forcing line');
    }
    if (evidence.line.some(key => !parseCoord(key))) {
      throw new Error('Threat proof for ' + losingMove + ' contains an invalid coordinate: ' + evidence.line.join('>'));
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
    }, 10000);
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
      timeBudgetMs: 1000,
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

/**
 * Deep search with no completed iterative depth is ranking-only evidence.
 * Sentinel mate scores are structured instead of leaking huge numeric values.
 */
async function testDeepEvidenceSemantics() {
  const engine = await loadProductionEngine({
    request: async () => {
      throw new Error('Deep evidence semantics regression must not call Jev');
    }
  });

  const depth0 = engine.normalizeDeepRow(
    { move: 'H8', score: 0, fallbackRank: 1 },
    { status: 'no_completed_depth', depthReached: 0, rankingOnly: true }
  );
  if (depth0?.status !== 'no_completed_depth' || depth0?.ranking_only !== true) {
    throw new Error('depth=0 must be marked no_completed_depth + ranking_only');
  }
  if ('score' in depth0) {
    throw new Error('depth=0 fallback score must not be exposed as a numeric evaluation');
  }

  const sentinel = engine.normalizeDeepRow(
    {
      move: 'H8',
      score: 1e15,
      forcedResult: {
        forced: true,
        result: 'win',
        proofType: 'DEEP_SEARCH',
        mateOrForcingDistance: 3
      },
      principalVariation: ['H8', 'H9', 'I8']
    },
    { status: 'completed', depthReached: 5, rankingOnly: false }
  );
  if (sentinel?.forced_result?.result !== 'win') {
    throw new Error('Mate sentinel must become a structured forced_result');
  }
  if ('score' in sentinel) {
    throw new Error('Mate sentinel must not be exposed as a normal deep score');
  }
}

/**
 * Jev Max must keep Atomic independent from Local ranking and keep a 4-candidate
 * pairwise tournament bounded to 12 order-balanced choice questions.
 */
async function testJevMaxPayloadBounds() {
  const engine = await loadProductionEngine({
    request: async () => {
      throw new Error('Payload-bound regression must not call Jev');
    }
  });
  const position = positionFromSequence(['G7']);
  engine.setPosition(position.board, position.moves, 'jev-latest');

  const atomicPayload = engine.maxAtomicPayload('max');
  const atomicFacts = Object.values(atomicPayload?.state?.candidate_facts || {});
  if (!atomicFacts.length || atomicFacts.length > 8) {
    throw new Error('Jev Max Atomic candidate universe must contain 1..8 candidates');
  }
  for (const facts of atomicFacts) {
    if ('local_rank' in facts || 'local_engine_grade' in facts) {
      throw new Error('Atomic payload leaked Local rank/grade anchoring evidence');
    }
  }

  const pairwise = engine.maxPairwisePayload('max');
  const duelIds = Object.keys(pairwise?.payload?.questions || {}).filter(id => id.startsWith('duel_'));
  if (pairwise.pairs.length === 6 && duelIds.length !== 12) {
    throw new Error('Top-4 pairwise tournament must contain 6 pairs x 2 option orders');
  }
  if (duelIds.length > 12) throw new Error('Jev Max pairwise question count exceeded 12');
  for (const id of duelIds) {
    const values = Object.values(pairwise.payload.questions[id].criteria || {});
    if (values.some(value => typeof value !== 'string' || !value.startsWith('See candidate_facts.'))) {
      throw new Error('Pairwise questions must reference shared candidate facts instead of duplicating them');
    }
  }
}

/**
 * End-to-end Jev Max regression: Atomic can request OTHER, the bounded wildcard
 * proposal is validated locally, Pairwise/Critic stay batched, and the third
 * request receives real prior-stage results before making the final choice.
 */
async function testJevMaxPipelineAndWildcard() {
  let requestCount = 0;
  let finalTarget = null;
  const captured = [];

  const engine = await loadProductionEngine({
    request: async ({ payload }) => {
      requestCount++;
      captured.push(payload);
      const answers = {};

      for (const [id, question] of Object.entries(payload?.questions || {})) {
        const keys = Object.keys(question?.criteria || {});
        if (!keys.length) throw new Error('Jev Max mock question has no criteria: ' + id);
        let choice;

        if (id === 'recall_check') {
          choice = 'OTHER';
        } else if (id.startsWith('judge_')) {
          choice = keys.includes('GOOD') ? 'GOOD' : keys[0];
        } else if (id.startsWith('duel_')) {
          // Pick the first displayed option; reversed duplicate cancels the
          // order bias and deliberately prevents high-confidence early exit.
          choice = keys[0];
        } else if (id.startsWith('critic_')) {
          choice = keys.includes('SURVIVES_BEST_REPLY') ? 'SURVIVES_BEST_REPLY' : keys[0];
        } else if (id === 'wildcard_pick') {
          choice = keys[0];
        } else if (id === 'best_move') {
          const candidateEvidence = payload?.state?.candidates || {};
          finalTarget = keys.find(key =>
            Array.isArray(candidateEvidence[key]?.candidate_sources)
            && candidateEvidence[key].candidate_sources.includes('JEV_WILDCARD')
          ) || keys[Math.min(1, keys.length - 1)];
          choice = finalTarget;
        } else {
          choice = keys[0];
        }

        answers[id] = oneHotChoice(choice, keys);
      }

      return {
        model: 'mock-jev-max',
        answers,
        usage: { input_tokens: 100, output_tokens: 10 },
        __client: { attempts: 1, cached: false, transport: 'regression-mock' }
      };
    }
  });

  const position = positionFromSequence(['G7']);
  engine.setPosition(position.board, position.moves, 'jev-latest');
  const result = await engine.jevMax();

  console.log('jev-max pipeline regression:', JSON.stringify({
    finalChoice: result.finalChoice,
    localChoice: result.localChoice,
    requests: requestCount,
    requestShape: result.decisionTrace?.requestShape,
    wildcard: result.decisionTrace?.wildcard
  }));

  if (result.mode !== 'max') throw new Error('Jev Max result mode not preserved');
  if (requestCount !== 3) throw new Error('Expected Atomic + Pairwise/Critic + Final = 3 Jev requests, got ' + requestCount);
  if (result.decisionTrace?.requestShape?.maxWorkers !== 2) throw new Error('Jev Max must declare at most two heavy workers');
  if ((result.decisionTrace?.requestShape?.candidateCount || 0) > 8) throw new Error('Jev Max candidate universe exceeded 8');
  if ((result.decisionTrace?.requestShape?.pairwiseCount || 0) > 12) throw new Error('Jev Max pairwise budget exceeded 12 questions');
  if ((result.decisionTrace?.requestShape?.criticCount || 0) > 4) throw new Error('Jev Max critic budget exceeded Top 4');
  if ((result.decisionTrace?.requestShape?.payloadEstimatedInputTokens || []).some(value => value > 7000)) {
    throw new Error('Jev Max estimated request payload exceeded the 7000-token hard target');
  }

  const first = captured[0];
  for (const facts of Object.values(first?.state?.candidate_facts || {})) {
    if ('local_rank' in facts || 'local_engine_grade' in facts) {
      throw new Error('Jev Max Atomic stage leaked Local rank/grade');
    }
  }

  const second = captured[1];
  const duelIds = Object.keys(second?.questions || {}).filter(id => id.startsWith('duel_'));
  if (duelIds.length > 12) throw new Error('Pairwise stage exceeded 12 duel questions');
  if (!Object.keys(second?.questions || {}).some(id => id.startsWith('critic_'))) {
    throw new Error('Pairwise request must batch adversarial critic questions');
  }
  if (!second?.questions?.wildcard_pick) throw new Error('OTHER must trigger a bounded wildcard proposal question');
  if ((second?.state?.wildcard_pool || []).length > 16) throw new Error('Wildcard pool exceeded 16');

  const wildcard = result.decisionTrace?.wildcard;
  if (!wildcard?.requested || !wildcard?.accepted || !wildcard?.enteredFinalists) {
    throw new Error('Validated wildcard did not enter final candidates');
  }
  if (!finalTarget || result.finalChoice !== finalTarget || wildcard.chosen !== true) {
    throw new Error('Final judge did not retain authority to choose the validated wildcard');
  }
  if (result.finalChoice === result.localChoice) {
    throw new Error('Regression should demonstrate Jev Max can override Local #1');
  }

  const finalPayload = captured[2];
  const finalEvidence = finalPayload?.state?.candidates?.[result.finalChoice];
  if (!finalEvidence?.critic_summary && !Array.isArray(finalEvidence?.candidate_sources)) {
    throw new Error('Final judge did not receive structured prior-stage evidence');
  }
}

/**
 * Real position from the recent Jev/Local game: Local preferred D5 while the
 * completed deeper search preferred I6. Keep both moves in the candidate recall
 * so Jev Max can actually override instead of losing the alternative upstream.
 */
async function testRecentGameLocalDeepDisagreementRecall() {
  let requestCount = 0;
  const engine = await loadProductionEngine({
    request: async ({ payload }) => {
      requestCount++;
      const answers = {};
      for (const [id, question] of Object.entries(payload?.questions || {})) {
        const keys = Object.keys(question?.criteria || {});
        let choice;
        if (id === 'recall_check') {
          choice = keys.includes('MAIN_SET') ? 'MAIN_SET' : keys[0];
        } else if (id.startsWith('judge_')) {
          const move = id.slice('judge_'.length);
          choice = move === 'I6' && keys.includes('EXCELLENT')
            ? 'EXCELLENT'
            : move === 'D5' && keys.includes('GOOD')
              ? 'GOOD'
              : keys.includes('NEUTRAL') ? 'NEUTRAL' : keys[0];
        } else if (id.startsWith('duel_')) {
          choice = keys.includes('I6') ? 'I6' : keys[0];
        } else if (id.startsWith('critic_')) {
          const move = id.slice('critic_'.length);
          choice = move === 'I6' && keys.includes('SURVIVES_BEST_REPLY')
            ? 'SURVIVES_BEST_REPLY'
            : keys.includes('LOSES_INITIATIVE') ? 'LOSES_INITIATIVE' : keys[0];
        } else if (id === 'best_move') {
          choice = keys.includes('I6') ? 'I6' : keys[0];
        } else {
          choice = keys[0];
        }
        answers[id] = oneHotChoice(choice, keys);
      }
      return {
        model: 'mock-real-override',
        answers,
        usage: { input_tokens: 1, output_tokens: 1 },
        __client: { attempts: 1, cached: false, transport: 'regression-mock' }
      };
    }
  });
  const sequence = [
    'H8','G9','I8','G8','J8','G7','K8','L8','G6','G10','G11','H7','I10','I7','J7','F7','E7'
  ];
  const position = positionFromSequence(sequence);
  engine.setPosition(position.board, position.moves, 'jev-latest');

  const context = engine.candidates('max');
  const keys = new Set(context.candidates.map(move => move.key));
  if (!keys.has('I6')) {
    throw new Error('Jev Max candidate recall lost the real-game Jev alternative I6');
  }
  if (!keys.has('D5')) {
    throw new Error('Jev Max candidate recall lost the real-game Local alternative D5');
  }

  const deep = await engine.deepAnalyze(['D5','I6','F9','E10'], 'max');
  const deepKeys = new Set((deep.scores || []).map(item => item.move));
  if (!deepKeys.has('D5') || !deepKeys.has('I6')) {
    throw new Error('Real-game deep evidence must retain both D5 and I6 for comparison');
  }
  if (Number(deep.depthReached || 0) === 0 && deep.status !== 'no_completed_depth' && deep.status !== 'timeout') {
    throw new Error('Real-game deep disagreement returned invalid depth=0 semantics: ' + deep.status);
  }

  engine.setPosition(position.board, position.moves, 'jev-latest');
  const result = await engine.jevMax();
  if (!result.candidates.some(candidate => candidate.key === 'I6')) {
    throw new Error('I6 disappeared before Jev Max final selection');
  }
  if (result.finalChoice !== 'I6') {
    throw new Error('Jev Max could not exercise final authority for the real-game I6 alternative: ' + result.finalChoice);
  }
  if (requestCount < 2 || requestCount > 3) {
    throw new Error('Real-game Jev Max override must stay within the 2–3 request budget, got ' + requestCount);
  }
}

/**
 * Real position from the same game: Threat-space proved L7 loses by force.
 * That mathematical proof must remain visible and L7 must not survive the
 * deterministic filter into Jev's final candidate set.
 */
async function testRecentGameThreatForcedLossFilter() {
  const engine = await loadProductionEngine({
    request: async ({ payload }) => {
      const answers = {};
      for (const [id, question] of Object.entries(payload?.questions || {})) {
        const keys = Object.keys(question?.criteria || {});
        let choice;
        if (id === 'recall_check') choice = keys.includes('MAIN_SET') ? 'MAIN_SET' : keys[0];
        else if (id.startsWith('judge_')) choice = keys.includes('GOOD') ? 'GOOD' : keys[0];
        else if (id.startsWith('critic_')) choice = keys.includes('SURVIVES_BEST_REPLY') ? 'SURVIVES_BEST_REPLY' : keys[0];
        else choice = keys[0];
        answers[id] = oneHotChoice(choice, keys);
      }
      return {
        model: 'mock-real-threat',
        answers,
        usage: { input_tokens: 1, output_tokens: 1 },
        __client: { attempts: 1, cached: false, transport: 'regression-mock' }
      };
    }
  });
  const sequence = [
    'H8','G9','I8','G8','J8','G7','K8','L8','G6','G10','G11','H7','I10','I7','J7','F7','E7','I6','J5','J6','J9'
  ];
  const position = positionFromSequence(sequence);
  engine.setPosition(position.board, position.moves, 'jev-latest');

  const result = await engine.jevMax();
  const threat = result.decisionTrace?.preJevThreatSearch;
  const l7 = threat?.analyses?.find(item => item.move === 'L7');
  if (l7 && !l7.forced) {
    throw new Error('Real-game L7 threat evidence exists but is no longer a forced loss');
  }
  if (l7?.forced && result.candidates.some(candidate => candidate.key === 'L7')) {
    throw new Error('Threat-space proven losing L7 survived the Jev Max hard filter');
  }
}

/**
 * Real position from the recent depth=0 game. Depending on runner speed the
 * worker may now finish depth >=3; if it does not, it must return ranking-only
 * semantics and no fake 0/-1/-2 numeric evaluations.
 */
async function testRecentGameDepthZeroPositionSemantics() {
  const engine = await loadProductionEngine({
    request: async () => {
      throw new Error('Depth-zero real-position regression must not call Jev');
    }
  });
  const sequence = [
    'H8','G9','H9','H10','F8','G8','I11','G10','G7','G11','G12','F10','I10','D10','E10'
  ];
  const position = positionFromSequence(sequence);
  engine.setPosition(position.board, position.moves, 'jev-latest');

  const deep = await engine.deepAnalyze(['I9','F12','E9','H12'], 'grandmaster');
  if (Number(deep.depthReached || 0) === 0) {
    if (deep.status !== 'no_completed_depth' || deep.rankingOnly !== true) {
      throw new Error('Historical depth=0 position must use no_completed_depth ranking-only semantics');
    }
    for (const row of deep.scores || []) {
      if (Number.isFinite(row.score)) {
        throw new Error('Historical depth=0 position leaked a fake numeric score for ' + row.move);
      }
      if (!Number.isFinite(row.fallbackRank)) {
        throw new Error('Historical depth=0 position lost its fallback rank for ' + row.move);
      }
    }
  } else if (deep.status !== 'completed' || Number(deep.depthReached) < 3) {
    throw new Error('Unexpected deep result for historical depth=0 position: ' + JSON.stringify(deep));
  }
}

/**
 * Real late-game position: I5 starts the already-proven VCF sequence. Jev Max
 * may compare proven VCF alternatives, but it must never escape the proven set.
 */
async function testRecentGameVcfProofLock() {
  let requestCount = 0;
  const engine = await loadProductionEngine({
    request: async ({ payload }) => {
      requestCount++;
      const answers = {};
      for (const [id, question] of Object.entries(payload?.questions || {})) {
        const keys = Object.keys(question?.criteria || {});
        const choice = id === 'recall_check' && keys.includes('MAIN_SET')
          ? 'MAIN_SET'
          : id.startsWith('judge_') && keys.includes('GOOD')
            ? 'GOOD'
            : id.startsWith('critic_') && keys.includes('SURVIVES_BEST_REPLY')
              ? 'SURVIVES_BEST_REPLY'
              : keys[keys.length - 1];
        answers[id] = oneHotChoice(choice, keys);
      }
      return {
        model: 'mock-real-vcf',
        answers,
        usage: { input_tokens: 1, output_tokens: 1 },
        __client: { attempts: 1, cached: false, transport: 'regression-mock' }
      };
    }
  });
  const sequence = [
    'H8','G9','I8','G8','J8','G7','K8','L8','G6','G10','G11','H7','I10','I7','J7','F7','E7','I6','J5','J6',
    'J9','F9','E10','H11','L7','M6','E8','E9','H9','K6','L6','I12','J13','D9','C9','F8','J10','J11','F6','D8','D10'
  ];
  const position = positionFromSequence(sequence);
  engine.setPosition(position.board, position.moves, 'jev-latest');

  const result = await engine.jevMax();
  const chosen = result.candidates.find(candidate => candidate.key === result.finalChoice);
  if (!chosen?.analysis?.vcf) {
    throw new Error('Jev Max escaped the real-game proven VCF set at move 42: ' + result.finalChoice);
  }
  if (result.candidates.some(candidate => candidate.analysis?.vcf !== true)) {
    throw new Error('Non-VCF candidate survived after a proven VCF candidate existed');
  }
  if (result.finalChoice !== 'I5') {
    throw new Error('Real-game VCF regression expected I5, got ' + result.finalChoice);
  }
  if (result.candidates.length === 1 && requestCount !== 0) {
    throw new Error('Single proven VCF candidate should not spend a Jev request');
  }
}

/**
 * Old Level-4 loss regression (23 plies): before White 12 I10, Black J9 is a
 * forcing extension. The worker should surface it as advisory counter-threat
 * evidence even though no mathematical forced win has been proved yet.
 */
async function testOldGameEarlyForcingExtensionWarning() {
  const engine = await loadProductionEngine({
    request: async () => {
      throw new Error('Old-game threat regression must not call Jev');
    }
  });
  engine.setGameConfig({
    playerColor: 'black',
    overline: true,
    fourFour: false,
    threeThree: false
  });
  const sequence = ['H8','G9','J10','I9','H9','H10','J8','I11','J12','F8','E7'];
  const position = positionFromSequence(sequence);
  engine.setPosition(position.board, position.moves, 'jev-latest');

  const threat = await engine.threatAnalyze(['I10'], 'max');
  const row = threat?.analyses?.find(item => item.move === 'I10');
  if (!row) throw new Error('Old-game I10 threat analysis is missing');

  const moves = new Set((row.counterThreat?.networkMoves || []).map(item => item.move));
  if (!moves.has('J9')) {
    throw new Error('Counter-threat audit failed to surface the historical J9 forcing extension');
  }
  if (!row.counterThreat?.risk || row.counterThreat.risk === 'NONE') {
    throw new Error('Historical I10 must carry a non-NONE counter-threat warning');
  }
}

/**
 * After Black 15 I8, old logic could collapse onto the unique double-threat
 * blocker K8. Jev Max must keep fork defense advisory and preserve multiple
 * candidates, then recognize that White I12 forces I13 but leaves J7 + K8.
 */
async function testOldGameForcedDefenseResidualNetwork() {
  const engine = await loadProductionEngine({
    request: async () => {
      throw new Error('Old-game residual-network regression must not call Jev');
    }
  });
  engine.setGameConfig({
    playerColor: 'black',
    overline: true,
    fourFour: false,
    threeThree: false
  });
  const sequence = [
    'H8','G9','J10','I9','H9','H10','J8','I11','J12','F8','E7','I10','J9','J11','I8'
  ];
  const position = positionFromSequence(sequence);
  engine.setPosition(position.board, position.moves, 'jev-latest');

  const context = engine.candidates('max');
  if (context.forced === 'block_fork') {
    throw new Error('Jev Max must not hard-collapse a unique fork creator into a pseudo-forced move');
  }
  if ((context.candidates || []).length < 2) {
    throw new Error('Jev Max must preserve multiple alternatives in the I8 threat-network position');
  }

  const recallSources = new Set(
    (context.candidates || []).flatMap(move => move.recallSources || [])
  );
  if (!recallSources.has('COUNTER_THREAT_BLOCK') && !recallSources.has('DEFENSIVE_FORK_BLOCK')) {
    throw new Error('Jev Max failed to recall any explicit counter-threat defense in the I8 position');
  }

  const threat = await engine.threatAnalyze(['I12'], 'max');
  const row = threat?.analyses?.find(item => item.move === 'I12');
  if (!row) throw new Error('Old-game I12 threat analysis is missing');
  const counter = row.counterThreat || {};
  if (counter.forcedDefenseMove !== 'I13') {
    throw new Error('I12 must identify Black I13 as the forced defensive reply, got ' + counter.forcedDefenseMove);
  }

  const network = new Set((counter.networkMoves || []).map(item => item.move));
  if (!network.has('J7') || !network.has('K8')) {
    throw new Error('Residual counter-threat network must preserve both J7 and K8, got ' + [...network].join(','));
  }
  if (!['HIGH', 'CRITICAL'].includes(counter.risk)) {
    throw new Error('I12 residual network should be HIGH/CRITICAL risk, got ' + counter.risk);
  }
}

/**
 * After Black 17 I13, White K8 is already losing by force:
 * J7 -> J6 -> (G10 or K6) creates the double winning-point finish.
 * This is a hard Threat-space proof and may be used as a deterministic filter.
 */
async function testOldGameK8ForcedLossProof() {
  const engine = await loadProductionEngine({
    request: async () => {
      throw new Error('Old-game K8 proof regression must not call Jev');
    }
  });
  engine.setGameConfig({
    playerColor: 'black',
    overline: true,
    fourFour: false,
    threeThree: false
  });
  const sequence = [
    'H8','G9','J10','I9','H9','H10','J8','I11','J12','F8','E7','I10','J9','J11','I8','I12','I13'
  ];
  const position = positionFromSequence(sequence);
  engine.setPosition(position.board, position.moves, 'jev-latest');

  const threat = await engine.threatAnalyze(['K8'], 'max');
  const row = threat?.analyses?.find(item => item.move === 'K8');
  if (!row?.forced) {
    throw new Error('Historical K8 must be proved as an opponent forced win');
  }
  if (!Array.isArray(row.line) || row.line.length < 3) {
    throw new Error('Historical K8 proof must expose the forcing line');
  }
  if (row.line[0] !== 'J7' || row.line[1] !== 'J6') {
    throw new Error('Historical K8 proof must begin J7 -> J6, got ' + row.line.join('>'));
  }
  if (!['G10', 'K6'].includes(row.line[2])) {
    throw new Error('Historical K8 proof must continue through G10 or K6, got ' + row.line.join('>'));
  }
}

/**
 * Regression from the 9-ply straight-line loss:
 * H8 G7 H7 G8 H6. White must stop the vertical open-three with H5/H9.
 * I7 was already proved losing by Threat-space in the real game, but OTHER
 * reintroduced it as a wildcard. A wildcard may never bypass a hard proof.
 */
async function testStraightFiveWildcardCannotBypassThreatProof() {
  let requestCount = 0;
  const captured = [];
  const engine = await loadProductionEngine({
    request: async ({ payload }) => {
      requestCount++;
      captured.push(payload);
      const answers = {};
      for (const [id, question] of Object.entries(payload?.questions || {})) {
        const keys = Object.keys(question?.criteria || {});
        if (!keys.length) throw new Error('Straight-five mock question has no choices: ' + id);

        let choice;
        if (id === 'recall_check') {
          choice = keys.includes('OTHER') ? 'OTHER' : keys[0];
        } else if (id.startsWith('judge_')) {
          choice = keys.includes('GOOD') ? 'GOOD' : keys[0];
        } else if (id.startsWith('duel_')) {
          choice = keys.includes('H5') ? 'H5' : keys.includes('H9') ? 'H9' : keys[0];
        } else if (id.startsWith('critic_')) {
          choice = keys.includes('SURVIVES_BEST_REPLY') ? 'SURVIVES_BEST_REPLY' : keys[0];
        } else if (id === 'wildcard_pick') {
          choice = keys.includes('I7') ? 'I7' : keys[0];
        } else if (id === 'best_move') {
          choice = keys.includes('H5') ? 'H5' : keys.includes('H9') ? 'H9' : keys[0];
        } else {
          choice = keys[0];
        }
        answers[id] = oneHotChoice(choice, keys);
      }
      return {
        model: 'mock-straight-five',
        answers,
        usage: { input_tokens: 1, output_tokens: 1 },
        __client: { attempts: 1, cached: false, transport: 'regression-mock' }
      };
    }
  });

  engine.setGameConfig({
    playerColor: 'black',
    overline: true,
    fourFour: false,
    threeThree: false
  });
  const sequence = ['H8','G7','H7','G8','H6'];
  const position = positionFromSequence(sequence);
  engine.setPosition(position.board, position.moves, 'jev-latest');

  const threat = await engine.threatAnalyze(['H5','H9','I7','G6','H10','G9'], 'max');
  const i7 = threat?.analyses?.find(item => item.move === 'I7');
  if (!i7?.forced || !['H5','H9'].includes(i7.line?.[0])) {
    throw new Error('Historical I7 must be proved losing through Black H5/H9 fork creator');
  }

  engine.setPosition(position.board, position.moves, 'jev-latest');
  const result = await engine.jevMax();
  if (!['H5','H9'].includes(result.finalChoice)) {
    throw new Error('Jev Max failed to stop the straight-line open-three: ' + result.finalChoice);
  }
  if (result.finalChoice === 'I7') {
    throw new Error('Threat-proved I7 re-entered through wildcard');
  }
  if (requestCount < 2 || requestCount > 3) {
    throw new Error('Straight-five defense must stay within the normal 2–3 Jev request budget, got ' + requestCount);
  }

  const pairwisePayload = captured[1] || null;
  if (pairwisePayload?.state?.wildcard_pool?.includes('I7')) {
    throw new Error('Threat-proved I7 must be excluded from wildcard_pool');
  }
  if (result.decisionTrace?.wildcard?.accepted === 'I7') {
    throw new Error('Threat-proved I7 was accepted as a wildcard');
  }
  const excluded = new Set(result.decisionTrace?.wildcard?.excludedByThreatProof || []);
  if (!excluded.has('I7')) {
    throw new Error('Decision trace must record I7 as excluded by Threat-space proof');
  }
}

/**
 * If the historical blunder is forcibly replayed and Black gets H5 after White
 * I7, Black has two distinct immediate winning points H4 and H9. White has no
 * one-move defense. Jev should not spend Atomic/Pairwise/Final requests deciding
 * between two mathematically losing blocks.
 */
async function testDoubleImmediateWinShortCircuitsJev() {
  let requestCount = 0;
  const engine = await loadProductionEngine({
    request: async () => {
      requestCount++;
      throw new Error('Double-immediate forced loss must not call Jev');
    }
  });

  engine.setGameConfig({
    playerColor: 'black',
    overline: true,
    fourFour: false,
    threeThree: false
  });
  const sequence = ['H8','G7','H7','G8','H6','I7','H5'];
  const position = positionFromSequence(sequence);
  engine.setPosition(position.board, position.moves, 'jev-latest');

  const context = engine.candidates('max');
  if (context.forced !== 'forced_loss_double_win') {
    throw new Error('Expected forced_loss_double_win, got ' + context.forced);
  }
  const keys = new Set(context.candidates.map(move => move.key));
  if (!keys.has('H4') || !keys.has('H9')) {
    throw new Error('Double immediate win must expose both H4 and H9');
  }

  engine.setPosition(position.board, position.moves, 'jev-latest');
  const result = await engine.jevMax();
  if (requestCount !== 0) {
    throw new Error('Proven double-immediate loss wasted ' + requestCount + ' Jev requests');
  }
  if (result.forced !== 'forced_loss_double_win') {
    throw new Error('Jev Max lost the forced double-win state');
  }
  if (result.decisionTrace?.requestShape?.logicalRequests !== 0) {
    throw new Error('Double-immediate loss should report 0 logical Jev requests');
  }
}

/**
 * 37-ply real-game regression: before White 34, H14 was candidate #7 and skipped
 * by the initial six-candidate Threat batch. Atomic/Final promoted the missing-
 * evidence move over the actually analysed defensive F5/J5 candidates, then
 * Black J5 created the F5/K5 double winning-point finish.
 *
 * Jev Max must close Threat coverage whenever Atomic promotes an unvetted
 * candidate into Top 4. H14 must be proved losing and removed before Pairwise.
 */
async function testLateGameAtomicPromotionThreatCoverageClosure() {
  let requestCount = 0;
  const captured = [];
  const engine = await loadProductionEngine({
    request: async ({ payload }) => {
      requestCount++;
      captured.push(payload);
      const answers = {};
      for (const [id, question] of Object.entries(payload?.questions || {})) {
        const keys = Object.keys(question?.criteria || {});
        if (!keys.length) throw new Error('Threat-coverage mock question has no choices: ' + id);

        let choice;
        if (id === 'recall_check') {
          choice = keys.includes('MAIN_SET') ? 'MAIN_SET' : keys[0];
        } else if (id.startsWith('judge_')) {
          const move = id.slice('judge_'.length);
          choice = move === 'G14' && keys.includes('EXCELLENT')
            ? 'EXCELLENT'
            : ['F5','J5'].includes(move) && keys.includes('GOOD')
              ? 'GOOD'
              : keys.includes('NEUTRAL') ? 'NEUTRAL' : keys[0];
        } else if (id.startsWith('duel_')) {
          choice = keys.includes('F5') ? 'F5' : keys.includes('J5') ? 'J5' : keys[0];
        } else if (id.startsWith('critic_')) {
          choice = keys.includes('SURVIVES_BEST_REPLY') ? 'SURVIVES_BEST_REPLY' : keys[0];
        } else if (id === 'best_move') {
          choice = keys.includes('F5') ? 'F5' : keys.includes('J5') ? 'J5' : keys[0];
        } else {
          choice = keys[0];
        }
        answers[id] = oneHotChoice(choice, keys);
      }
      return {
        model: 'mock-threat-coverage',
        answers,
        usage: { input_tokens: 1, output_tokens: 1 },
        __client: { attempts: 1, cached: false, transport: 'regression-mock' }
      };
    }
  });

  engine.setGameConfig({
    playerColor: 'black',
    overline: true,
    fourFour: false,
    threeThree: false
  });

  // First pin the preceding tempo-defense: White E14 threatens E13, so Black
  // must answer E13 before it can exploit the latent F5/J5 fork network. The
  // counter-threat is dangerous but is not itself a mathematical forced loss.
  const beforeE14 = positionFromSequence([
    'H8','G7','H7','H6','H9','H10','G6','G9','F8','G8','G10','I8','F11','E12','F7','F9',
    'H5','E8','I4','J3','F6','F4','G5','E10','I5','E11','E9','D11','C12'
  ]);
  engine.setPosition(beforeE14.board, beforeE14.moves, 'jev-latest');
  const e14Threat = await engine.threatAnalyze(['E14'], 'max');
  const e14 = e14Threat?.analyses?.find(item => item.move === 'E14');
  if (!e14 || e14.forced) {
    throw new Error('Historical E14 counter-threat must remain survivable, not a hard forced loss');
  }
  if (e14.counterThreat?.forcedDefenseMove !== 'E13') {
    throw new Error('Historical E14 must force Black E13 before the latent fork can continue');
  }

  // After Black E13, White G14 no longer creates an immediate forcing reply.
  // It was candidate #8 in the real game and skipped by the initial six-candidate
  // Threat batch; Black can now play F5/J5 to create two legal winning points.
  const beforeG14 = positionFromSequence([
    'H8','G7','H7','H6','H9','H10','G6','G9','F8','G8','G10','I8','F11','E12','F7','F9',
    'H5','E8','I4','J3','F6','F4','G5','E10','I5','E11','E9','D11','C12','E14','E13'
  ]);
  engine.setPosition(beforeG14.board, beforeG14.moves, 'jev-latest');

  const context = engine.candidates('max');
  const g14Candidate = context.candidates.find(move => move.key === 'G14');
  if (!g14Candidate) {
    throw new Error('Historical G14 must remain in heterogeneous recall so coverage closure can test it');
  }
  if (
    g14Candidate.analysis?.facts?.tactical_verification === 'BUDGET_EXHAUSTED'
    && g14Candidate.analysis?.facts?.tactical_safety === 'SAFE'
  ) {
    throw new Error('Budget-exhausted tactical analysis must never be labelled SAFE');
  }

  const explicitThreat = await engine.threatAnalyze(['G14','F5','J5'], 'max');
  const g14Proof = explicitThreat?.analyses?.find(item => item.move === 'G14');
  if (!g14Proof?.forced || !['F5','J5'].includes(g14Proof.line?.[0])) {
    throw new Error('Historical G14 must be proved losing through Black F5/J5 fork creator');
  }

  engine.setPosition(beforeG14.board, beforeG14.moves, 'jev-latest');
  const result = await engine.jevMax();
  if (result.finalChoice === 'G14') {
    throw new Error('Unvetted G14 survived Threat coverage closure into Final');
  }

  const coverage = result.decisionTrace?.threatCoverage;
  if (!coverage?.supplementalTriggered || !(coverage.supplementalCandidates || []).includes('G14')) {
    throw new Error('Atomic-promoted G14 did not trigger supplemental Threat validation');
  }
  const g14Merged = result.decisionTrace?.preJevThreatSearch?.analyses?.find(item => item.move === 'G14');
  if (!g14Merged?.forced) {
    throw new Error('Supplemental Threat proof for G14 was not merged into final evidence');
  }

  const pairwisePayload = captured[1];
  if (pairwisePayload?.state?.candidate_facts?.G14) {
    throw new Error('Threat-proved G14 reached Pairwise candidate_facts');
  }
  for (const question of Object.values(pairwisePayload?.questions || {})) {
    if (Object.prototype.hasOwnProperty.call(question?.criteria || {}, 'G14')) {
      throw new Error('Threat-proved G14 reached a Pairwise/Critic choice question');
    }
  }

  if (!['F5','J5'].includes(result.finalChoice)) {
    throw new Error('Regression mock should retain the direct defensive F5/J5 family, got ' + result.finalChoice);
  }
  if (requestCount < 2 || requestCount > 3) {
    throw new Error('Threat coverage closure changed the Jev request budget: ' + requestCount);
  }
}

/**
 * Diagnostic / future regression seed from the 49-ply real game.
 * Position before White 42 after Black L6. Analyze the candidate family one by
 * one so Threat timeout on one root cannot hide whether alternatives are
 * actually provable losses.
 */
async function testRealGameMove42ProofBoundary() {
  const engine = await loadProductionEngine({
    request: async () => {
      throw new Error('Move-42 residual rescue proof must not call Jev');
    }
  });
  engine.setGameConfig({
    playerColor: 'black',
    overline: true,
    fourFour: false,
    threeThree: false
  });
  const sequence = [
    'H8','G9','H9','H10','H7','H6','G8','I11','F8','E8','I8','J8',
    'G6','F5','J9','K10','I6','F9','J5','K4','I7','I9','I5','I4',
    'K7','J7','J6','G11','F12','J12','K13','H4','K5','L4','J4','H5',
    'L5','M5','L8','M9','L6'
  ];
  const position = positionFromSequence(sequence);
  engine.setPosition(position.board, position.moves, 'jev-latest');

  const threat = await engine.threatAnalyze(
    ['H2'],
    'max',
    { timeBudgetMs: 1450, maxThreatTurns: 6, branch: 9 }
  );
  const row = threat?.analyses?.find(item => item.move === 'H2');
  if (!row) {
    throw new Error('Historical move-42 H2 analysis is missing');
  }
  if (row.forced) {
    throw new Error('Bounded engine must not over-prove H2 without a closed continuation');
  }
  if (!row.timedOut && row.reason !== 'forced_defense_without_proven_continuation') {
    throw new Error('H2 completed NO_PROOF must expose the forced-defense boundary, got ' + row.reason);
  }
}

/**
 * Counterfactual audit before White 36 after Black J4 in the 49-ply game.
 * The real game selected H5 after an initial Threat timeout and wildcard retry.
 */
async function testRealGameMove36CounterfactualThreatAudit() {
  const engine = await loadProductionEngine({
    request: async () => {
      throw new Error('Move-36 counterfactual audit must not call Jev');
    }
  });
  engine.setGameConfig({
    playerColor: 'black',
    overline: true,
    fourFour: false,
    threeThree: false
  });
  const sequence = [
    'H8','G9','H9','H10','H7','H6','G8','I11','F8','E8','I8','J8',
    'G6','F5','J9','K10','I6','F9','J5','K4','I7','I9','I5','I4',
    'K7','J7','J6','G11','F12','J12','K13','H4','K5','L4','J4'
  ];
  const position = positionFromSequence(sequence);
  const moves = ['H5','L5','G7','G5','G10','H11','I10','D7'];
  const rows = {};
  for (const key of moves) {
    engine.setPosition(position.board, position.moves, 'jev-latest');
    const threat = await engine.threatAnalyze([key], 'max');
    rows[key] = threat?.analyses?.find(item => item.move === key) || null;
  }
  engine.setPosition(position.board, position.moves, 'jev-latest');
  const h5Depth8 = await engine.threatAnalyze(
    ['H5'],
    'max',
    { maxThreatTurns: 8, timeBudgetMs: 1450, branch: 9 }
  );
  const h5Deep = h5Depth8?.analyses?.[0] || null;
  console.log('move36 H5 depth8 audit:', JSON.stringify(h5Deep));
  console.log('move36 counterfactual threat audit:', JSON.stringify(rows));
  if (!rows.H5 || !rows.L5) {
    throw new Error('Move-36 counterfactual audit did not return core candidates');
  }
  if (rows.H5.forced || h5Deep?.forced) {
    throw new Error('Move-36 H5 must remain unproved even at 8 attacker turns; avoid over-proving the only resistance move');
  }
  for (const losingMove of ['L5','G7','G5','G10','H11','I10','D7']) {
    if (!rows[losingMove]?.forced) {
      throw new Error('Move-36 alternative ' + losingMove + ' should remain a proved loss');
    }
  }
}

/**
 * Position before White 44 after Black H3 in the supplied 49-ply game.
 * The normal main set is hard-proved losing. Jev Max must not spend three
 * semantic requests ranking losing moves; it must enter bounded rescue mode.
 */
async function testRealGameMove44AllMainLossTriggersRescueSweep() {
  let requestCount = 0;
  const engine = await loadProductionEngine({
    request: async ({ payload }) => {
      requestCount++;
      const answers = {};
      for (const [id, question] of Object.entries(payload?.questions || {})) {
        const keys = Object.keys(question?.criteria || {});
        if (!keys.length) throw new Error('Move-44 rescue mock has no choices: ' + id);
        const choice = keys[0];
        answers[id] = oneHotChoice(choice, keys);
      }
      return {
        model: 'mock-rescue',
        answers,
        usage: { input_tokens: 1, output_tokens: 1 },
        __client: { attempts: 1, cached: false, transport: 'regression-mock' }
      };
    }
  });
  engine.setGameConfig({
    playerColor: 'black',
    overline: true,
    fourFour: false,
    threeThree: false
  });
  const sequence = [
    'H8','G9','H9','H10','H7','H6','G8','I11','F8','E8','I8','J8',
    'G6','F5','J9','K10','I6','F9','J5','K4','I7','I9','I5','I4',
    'K7','J7','J6','G11','F12','J12','K13','H4','K5','L4','J4','H5',
    'L5','M5','L8','M9','L6','H2','H3'
  ];
  const position = positionFromSequence(sequence);
  engine.setPosition(position.board, position.moves, 'jev-latest');

  const result = await engine.jevMax();
  const shape = result.decisionTrace?.requestShape || {};
  if (!['jev_max_rescue','bounded_rescue_exhausted'].includes(shape.decisionAuthority)) {
    throw new Error('Move-44 all-loss position did not enter rescue mode: ' + shape.decisionAuthority);
  }
  if ((shape.pairwiseCount || 0) !== 0 || (shape.criticCount || 0) !== 0) {
    throw new Error('Rescue mode must skip Pairwise/Critic on known-loss main candidates');
  }
  if ((shape.logicalRequests || 0) > 2) {
    throw new Error('All-loss rescue path must beat the historical 3-request flow, got ' + shape.logicalRequests);
  }
  if (requestCount > 2) {
    throw new Error('Move-44 rescue path issued too many Jev requests: ' + requestCount);
  }
  if (!result.decisionTrace?.rescueSweep) {
    throw new Error('Move-44 result must record rescueSweep diagnostics');
  }
}

/**
 * Replay the actual position before White 44 and exercise the production
 * Jev-Max rescue path. The normal eight candidates are hard-proved losing in
 * the supplied log; this test checks whether bounded extra recall can discover
 * a vetted rescue or correctly stop semantic voting when none exists.
 */
async function testRealGameMove44M7WorkerAudit() {
  const engine = await loadProductionEngine({
    request: async () => {
      throw new Error('Move-44 M7 worker audit must not call Jev');
    }
  });
  engine.setGameConfig({
    playerColor: 'black',
    overline: true,
    fourFour: false,
    threeThree: false
  });
  const sequence = [
    'H8','G9','H9','H10','H7','H6','G8','I11','F8','E8','I8','J8',
    'G6','F5','J9','K10','I6','F9','J5','K4','I7','I9','I5','I4',
    'K7','J7','J6','G11','F12','J12','K13','H4','K5','L4','J4','H5',
    'L5','M5','L8','M9','L6','H2','H3'
  ];
  const position = positionFromSequence(sequence);
  engine.setPosition(position.board, position.moves, 'jev-latest');
  const threat = await engine.threatAnalyze(
    ['M7'],
    'max',
    { timeBudgetMs: 1100, maxThreatTurns: 6, branch: 9 }
  );
  const row = threat?.analyses?.find(item => item.move === 'M7');
  if (!row?.forced || row.timedOut) {
    throw new Error('Move-44 M7 must complete as a proven forced loss');
  }
  if (!Array.isArray(row.line) || !row.line.length) {
    throw new Error('Move-44 M7 proof must expose a concrete forcing line');
  }
}

async function testRealGameMove44ProductionRescueAudit() {
  let requests = 0;
  const engine = await loadProductionEngine({
    request: async ({ payload }) => {
      requests++;
      const answers = {};
      for (const [id, question] of Object.entries(payload?.questions || {})) {
        const keys = Object.keys(question?.criteria || {});
        if (!keys.length) throw new Error('Move-44 rescue mock has no choices: ' + id);
        const choice = keys[0];
        answers[id] = oneHotChoice(choice, keys);
      }
      return {
        model: 'mock-rescue-audit',
        answers,
        usage: { input_tokens: 1, output_tokens: 1 },
        __client: { attempts: 1, cached: false, transport: 'regression-mock' }
      };
    }
  });
  engine.setGameConfig({
    playerColor: 'black',
    overline: true,
    fourFour: false,
    threeThree: false
  });
  const sequence = [
    'H8','G9','H9','H10','H7','H6','G8','I11','F8','E8','I8','J8',
    'G6','F5','J9','K10','I6','F9','J5','K4','I7','I9','I5','I4',
    'K7','J7','J6','G11','F12','J12','K13','H4','K5','L4','J4','H5',
    'L5','M5','L8','M9','L6','H2','H3'
  ];
  const position = positionFromSequence(sequence);
  engine.setPosition(position.board, position.moves, 'jev-latest');
  const result = await engine.jevMax();
  const rescue = result.decisionTrace?.rescueSweep || null;
  const shape = result.decisionTrace?.requestShape || {};
  if (shape.decisionAuthority !== 'bounded_rescue_exhausted') {
    throw new Error('Move-44 production replay must exhaust bounded rescue, got ' + shape.decisionAuthority);
  }
  if (requests !== 0 || (shape.logicalRequests || 0) !== 0) {
    throw new Error('Move-44 exhausted rescue must spend 0 Jev requests, got ' + requests);
  }
  if (rescue?.mode !== 'BOUNDED_RESCUE_EXHAUSTED') {
    throw new Error('Move-44 rescue mode should be BOUNDED_RESCUE_EXHAUSTED');
  }
  if ((rescue?.unresolved || []).length) {
    throw new Error('Move-44 rescue must not leave unresolved candidates: ' + rescue.unresolved.join(','));
  }
  if ((shape.pairwiseCount || 0) !== 0 || (shape.criticCount || 0) !== 0) {
    throw new Error('Move-44 exhausted rescue must skip Pairwise/Critic');
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

await testRealGameMove44M7WorkerAudit();
await testRealGameMove44ProductionRescueAudit();
await testRealGameMove36CounterfactualThreatAudit();
await testRealGameMove44AllMainLossTriggersRescueSweep();
await testRealGameMove42ProofBoundary();
await testLateGameAtomicPromotionThreatCoverageClosure();
await testStraightFiveWildcardCannotBypassThreatProof();
await testDoubleImmediateWinShortCircuitsJev();
await testOldGameEarlyForcingExtensionWarning();
await testOldGameForcedDefenseResidualNetwork();
await testOldGameK8ForcedLossProof();
await testRecentGameLocalDeepDisagreementRecall();
await testRecentGameThreatForcedLossFilter();
await testRecentGameDepthZeroPositionSemantics();
await testRecentGameVcfProofLock();
await testDeepEvidenceSemantics();
await testJevMaxPayloadBounds();
await testJevMaxPipelineAndWildcard();
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
