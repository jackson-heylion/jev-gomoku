/**
 * Jev Gomoku benchmark — "is Jev a better final decision maker than Local?"
 *
 * The production architecture is:
 *
 *   Board -> Local engine (Alpha-Beta + VCF/VCT + immediate win/block +
 *            fork defense + Renju forbidden filtering + candidate generation)
 *         -> optional Deep Search (Web Worker)
 *         -> Local evidence
 *         -> Jev  ->  FINAL MOVE
 *
 * Jev is the final decision maker. This benchmark therefore no longer asks
 * "can Jev beat Local?" or "which fusion weight wins?". It asks:
 *
 *   1. With the SAME opponent and the SAME openings, does letting Jev make the
 *      final move score better than letting Local decide alone?
 *   2. When Jev overrides Local's #1, is the override actually better according
 *      to a deeper deterministic search?
 *   3. Does the shipped cost/policy contract hold (legacy Jev Final <=1 request,
 *      Jev Max <=3 requests, 0 calls for deterministic single-candidate proof,
 *      bounded candidates / workers / payload, and no fake depth=0 scores)?
 *   4. Is the Renju rule set consistent between the benchmark game engine and
 *      production?
 *
 * Because production only implements the WHITE seat (its prompts and its
 * forbidden-move handling are white-specific), the arms under test always play
 * WHITE. BLACK is a fixed, deterministic reference opponent: the production
 * Local engine evaluated in swapped colours, with every black move re-validated
 * by the Renju referee. Both arms face exactly the same reference opponent on
 * exactly the same openings, so any score difference is attributable to the
 * white seat's decision policy.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadProductionEngine } from './harness.mjs';
import {
  BLACK,
  EMPTY,
  SIZE,
  WHITE,
  Referee,
  cloneBoard,
  coord,
  parseCoord,
  swapBoardColors,
  swappedHistory
} from './referee.mjs';

const UPSTREAM = 'https://api.typesafe.ai/v1/systemone';
const RETRYABLE = new Set([429, 529]);
const MAX_ATTEMPTS = 3;

const ARM_LABELS = {
  local: 'Local (内部基线)',
  'jev-final': 'Jev Final (原高强度链路)',
  'jev-max': 'Jev Max (多阶段最终裁决)',
  'jev-blind': 'Jev Blind (诊断基线)'
};

const OPENINGS = [
  { name: 'empty', moves: [] },
  { name: 'center-vertical', moves: ['H8', 'H9'] },
  { name: 'center-horizontal', moves: ['H8', 'I8'] },
  { name: 'center-diagonal-se', moves: ['H8', 'I9'] },
  { name: 'center-diagonal-sw', moves: ['H8', 'G9'] },
  { name: 'center-north', moves: ['H8', 'H7'] },
  { name: 'cross-east-west', moves: ['H8', 'I8', 'G8', 'I9'] },
  { name: 'cross-north-south', moves: ['H8', 'H9', 'H7', 'I8'] },
  { name: 'diagonal-pressure', moves: ['H8', 'I9', 'G7', 'I8'] },
  { name: 'offset-east', moves: ['H8', 'I8', 'I9', 'G8'] },
  { name: 'offset-west', moves: ['H8', 'G8', 'G9', 'I8'] },
  { name: 'balanced-four', moves: ['H8', 'I9', 'G9', 'I7'] }
];

const DEFAULT_ARMS = ['local', 'jev-final', 'jev-max'];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function pct(value) {
  return (value * 100).toFixed(1) + '%';
}

function num(value, digits = 0) {
  return Number(value || 0).toFixed(digits);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function wilsonInterval(points, games, z = 1.96) {
  if (!games) return { low: 0, high: 0 };
  const p = points / games;
  const denominator = 1 + (z * z) / games;
  const center = (p + (z * z) / (2 * games)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / games + (z * z) / (4 * games * games))) / denominator;
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

function percentile(values, q) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[index];
}

function chebyshevToCenter(key) {
  const point = parseCoord(key);
  if (!point) return 99;
  return Math.max(Math.abs(point.r - 7), Math.abs(point.c - 7));
}

// ---------------------------------------------------------------------------
// Jev transport
// ---------------------------------------------------------------------------

function retryDelayMs(response, attempt) {
  const header = response.headers.get('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(15000, seconds * 1000);
    const when = Date.parse(header);
    if (Number.isFinite(when)) return Math.max(0, Math.min(15000, when - Date.now()));
  }
  return Math.min(8000, 650 * (2 ** attempt));
}

/** Real TypeSafe System One transport, with the same retry policy as the page proxy. */
function createTypeSafeRequest({ apiKey, delayMs, onRequest }) {
  let lastRequestAt = 0;

  return async function request({ payload, signal }) {
    const gap = Date.now() - lastRequestAt;
    if (gap < delayMs) await sleep(delayMs - gap);

    const started = performance.now();
    let lastResponse = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      lastRequestAt = Date.now();
      onRequest?.();
      const response = await fetch(UPSTREAM, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal
      });
      lastResponse = response;

      if (RETRYABLE.has(response.status) && attempt < MAX_ATTEMPTS - 1) {
        await sleep(retryDelayMs(response, attempt));
        continue;
      }

      const raw = await response.text();
      let data = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        data = null;
      }

      if (!response.ok) {
        const error = new Error('TypeSafe request failed with HTTP ' + response.status);
        error.httpStatus = response.status;
        throw error;
      }

      const result = data || {};
      result.__client = {
        attempts: attempt + 1,
        cached: false,
        transport: 'benchmark-direct',
        latencyMs: Math.round(performance.now() - started)
      };
      return result;
    }

    const error = new Error('TypeSafe request failed');
    error.httpStatus = lastResponse ? lastResponse.status : null;
    throw error;
  };
}

/**
 * Deterministic offline stand-in for Jev. It answers with a structurally valid
 * response so the whole pipeline (payload shape, final-decision contract,
 * arbitration, reporting) can be validated in CI without any paid API call.
 *
 * The policy is intentionally aggressive for the final-decision question: it
 * takes the second candidate when one exists, which produces the override cases
 * the report is built around.
 */
function createMockJev({ onRequest }) {
  let call = 0;
  return async function request({ payload }) {
    onRequest?.();
    call++;
    const questions = payload?.questions || {};
    const answers = {};

    for (const [id, question] of Object.entries(questions)) {
      const keys = Object.keys(question?.criteria || {});
      if (!keys.length) throw new Error('Mock Jev received no choices for ' + id);

      let choice;
      if (id === 'recall_check') {
        choice = keys.includes('MAIN_SET') ? 'MAIN_SET' : keys[0];
      } else if (id.startsWith('judge_')) {
        const move = id.slice('judge_'.length);
        const parity = [...move].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 3;
        choice = parity === 0 && keys.includes('EXCELLENT')
          ? 'EXCELLENT'
          : parity === 1 && keys.includes('GOOD')
            ? 'GOOD'
            : keys.includes('NEUTRAL') ? 'NEUTRAL' : keys[0];
      } else if (id.startsWith('critic_')) {
        choice = keys.includes('SURVIVES_BEST_REPLY') ? 'SURVIVES_BEST_REPLY' : keys[0];
      } else if (id.startsWith('duel_') || id === 'wildcard_pick') {
        choice = keys.reduce((best, key) => (
          chebyshevToCenter(key) < chebyshevToCenter(best) ? key : best
        ), keys[0]);
      } else if (id === 'best_move') {
        const isBlind = keys.every(key => question.criteria[key] == null);
        choice = isBlind
          ? keys.reduce((best, key) => (
              chebyshevToCenter(key) < chebyshevToCenter(best) ? key : best
            ), keys[0])
          : keys[Math.min(1, keys.length - 1)];
      } else {
        choice = keys[0];
      }

      answers[id] = {
        type: 'choice',
        choice,
        confidence: 1,
        probabilities: Object.fromEntries(keys.map(key => [key, key === choice ? 1 : 0]))
      };
    }

    return {
      model: 'mock-jev',
      answers,
      usage: { input_tokens: 0, output_tokens: 0 },
      __client: { attempts: 1, cached: false, transport: 'benchmark-mock', latencyMs: 0 },
      __mock: { call }
    };
  };
}

// ---------------------------------------------------------------------------
// Arms under test (white seat only)
// ---------------------------------------------------------------------------

const ARMS = {
  local: {
    key: 'local',
    label: ARM_LABELS.local,
    expectsJev: false,
    async run(engine, mode) {
      return engine.local(mode);
    }
  },
  'jev-final': {
    key: 'jev-final',
    label: ARM_LABELS['jev-final'],
    expectsJev: true,
    async run(engine, mode) {
      return engine.jevFinal(mode);
    }
  },
  'jev-max': {
    key: 'jev-max',
    label: ARM_LABELS['jev-max'],
    expectsJev: true,
    async run(engine) {
      return engine.jevMax();
    }
  },
  'jev-blind': {
    key: 'jev-blind',
    label: ARM_LABELS['jev-blind'],
    expectsJev: true,
    async run(engine, mode) {
      return engine.jevBlind(mode);
    }
  }
};

function parseArmList(value) {
  const requested = String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  if (!requested.length) return [...DEFAULT_ARMS];
  const unknown = requested.filter(name => !ARMS[name]);
  if (unknown.length) {
    throw new Error('Unknown arm(s): ' + unknown.join(', ') + '. Available: ' + Object.keys(ARMS).join(', '));
  }
  return unique(requested);
}

// ---------------------------------------------------------------------------
// Fixed black reference opponent
// ---------------------------------------------------------------------------

/**
 * Production only implements a WHITE engine, so the black seat is played by the
 * production Local engine through the existing colour-swap trick: we hand it the
 * colour-inverted board and read the reply back on the real board.
 *
 * That inversion also means the swapped search cannot see BLACK's forbidden
 * points (in the inverted view its own stones look white, and white has no
 * forbidden moves). Every candidate is therefore re-validated by the Renju
 * referee against the real position and the highest-ranked legal point is
 * played. Substitutions are counted and reported as a known limitation.
 */
function blackReferenceDecision(engine, referee, mode) {
  const swappedBoard = swapBoardColors(referee.board);
  const swappedMoves = swappedHistory(referee.moves);
  engine.setPosition(swappedBoard, swappedMoves, engine.model || 'jev-latest');
  const result = engine.local(mode);
  const preferred = result.finalChoice;
  const ranked = unique([preferred, ...(result.candidates || []).map(move => move.key)]);

  for (const key of ranked) {
    const verdict = referee.inspect(key, BLACK);
    if (verdict.legal) {
      const rejected = ranked.slice(0, ranked.indexOf(key)).map(item => {
        const info = referee.inspect(item, BLACK);
        return { move: item, reason: info.reason, forbiddenType: info.forbiddenType || null };
      });
      return {
        key,
        source: 'ref-local',
        substituted: key !== preferred,
        rejected,
        verdict
      };
    }
  }

  // Nothing from Local's candidate set is playable for BLACK. Fall back to the
  // production black-legal move ordering, which is already Renju-filtered.
  referee.syncEngine();
  for (const key of engine.orderedBlack(32)) {
    const verdict = referee.inspect(key, BLACK);
    if (verdict.legal) {
      return { key, source: 'ref-ordered-fallback', substituted: true, rejected: [], verdict };
    }
  }

  throw new Error('Black reference opponent found no legal move');
}

// ---------------------------------------------------------------------------
// One game
// ---------------------------------------------------------------------------

function engineClientTrace(result) {
  const shape = result?.decisionTrace?.requestShape || {};
  const deep = result?.decisionTrace?.preJevDeepSearch || null;
  const threat = result?.decisionTrace?.preJevThreatSearch || null;
  const client = result?.client || null;
  const usage = result?.usage || null;
  return {
    requestShape: {
      decisionAuthority: shape.decisionAuthority || null,
      candidateCount: shape.candidateCount ?? (result?.candidates?.length ?? null),
      httpRequests: client?.cached ? 0 : (shape.httpRequests ?? (client?.attempts || 0)),
      localOpeningAdaptive: shape.localOpeningAdaptive ?? null,
      deepSearchPolicy: shape.deepSearchPolicy ?? null,
      localEvidenceVisibleToJev: shape.localEvidenceVisibleToJev ?? null,
      logicalRequests: shape.logicalRequests ?? null,
      atomicCount: shape.atomicCount ?? null,
      pairwiseCount: shape.pairwiseCount ?? null,
      criticCount: shape.criticCount ?? null,
      finalistCount: shape.finalistCount ?? null,
      maxWorkers: shape.maxWorkers ?? null,
      threatFilterCount: shape.threatFilterCount ?? 0,
      threatSupplementalElapsedMs: shape.threatSupplementalElapsedMs ?? null,
      threatSupplementalCandidates: shape.threatSupplementalCandidates ?? [],
      threatCoverageRejectedIncomplete: shape.threatCoverageRejectedIncomplete ?? [],
      pairwiseThreatCoverageComplete: shape.pairwiseThreatCoverageComplete ?? null,
      rescueSweepElapsedMs: shape.rescueSweepElapsedMs ?? null,
      rescueSweepCandidates: shape.rescueSweepCandidates ?? [],
      rescueSweepPasses: shape.rescueSweepPasses ?? null,
      rescueSweepRetriedCandidates: shape.rescueSweepRetriedCandidates ?? [],
      payloadEstimatedInputTokens: shape.payloadEstimatedInputTokens ?? null,
      localSearchElapsedMs: shape.localSearchElapsedMs ?? null,
      deepElapsedMs: shape.deepElapsedMs ?? null,
      threatElapsedMs: shape.threatElapsedMs ?? null
    },
    deepSearch: deep
      ? {
        status: deep.status || null,
        source: deep.source || null,
        depthReached: deep.depthReached ?? null,
        timedOut: Boolean(deep.timedOut),
        elapsedMs: deep.elapsedMs ?? null,
        budgetMs: deep.budgetMs ?? null
      }
      : null,
    threatSearch: threat
      ? {
        status: threat.status || null,
        source: threat.source || null,
        timedOut: Boolean(threat.timedOut),
        elapsedMs: threat.elapsedMs ?? null,
        budgetMs: threat.budgetMs ?? null
      }
      : null,
    jev: {
      participated: Boolean(client),
      upstreamAttempts: client?.attempts ?? 0,
      upstreamLatencyMs: client?.latencyMs ?? null,
      transport: client?.transport || null,
      inputTokens: Number(usage?.input_tokens) || 0,
      outputTokens: Number(usage?.output_tokens) || 0
    },
    max: {
      atomic: Array.isArray(result?.decisionTrace?.atomic) ? result.decisionTrace.atomic : [],
      pairwise: Array.isArray(result?.decisionTrace?.pairwise) ? result.decisionTrace.pairwise : [],
      critic: Array.isArray(result?.decisionTrace?.critic) ? result.decisionTrace.critic : [],
      wildcard: result?.decisionTrace?.wildcard || null,
      localEvidence: Array.isArray(result?.decisionTrace?.localEvidence) ? result.decisionTrace.localEvidence : []
    }
  };
}

function localEvidenceOf(result) {
  const fromTrace = result?.decisionTrace?.localEvidence;
  if (Array.isArray(fromTrace)) return fromTrace;
  const fromLocal = result?.decisionTrace?.local?.ranked;
  if (Array.isArray(fromLocal)) {
    return fromLocal.map(item => ({
      move: item.move,
      localRank: item.rank,
      localSearchScore: item.searchScore,
      deepSearchRank: null,
      deepSearchScore: null,
      facts: item.facts
    }));
  }
  return [];
}

async function whiteDecision(engine, arm, referee, options) {
  const position = () => engine.setPosition(
    cloneBoard(referee.board),
    referee.moves.map(move => ({ ...move })),
    options.model
  );

  position();
  const started = performance.now();
  let result;
  let fallback = false;
  let error = null;
  try {
    result = await ARMS[arm].run(engine, options.mode);
  } catch (err) {
    // The page degrades to the local engine when Jev is unavailable; mirror it.
    fallback = true;
    error = err;
    position();
    result = engine.local(options.mode);
    result.fallbackReason = String(err?.message || err);
  }
  const latencyMs = performance.now() - started;

  const choice = String(result.finalChoice || result?.answer?.choice || '').toUpperCase();
  const localChoice = String(result.localChoice || result.finalChoice || '').toUpperCase();
  const candidates = Array.isArray(result.candidates) ? result.candidates : [];
  const localRankIndex = candidates.findIndex(candidate => candidate.key === choice);
  const trace = engineClientTrace(result);
  const evidence = localEvidenceOf(result);
  const chosenEvidence = evidence.find(item => item.move === choice) || null;
  const localEvidence = evidence.find(item => item.move === localChoice) || null;

  return {
    choice,
    localChoice,
    localRank: localRankIndex >= 0 ? localRankIndex + 1 : null,
    isOverride: Boolean(localChoice && choice !== localChoice),
    candidateCount: candidates.length,
    forced: result.forced ?? null,
    confidence: Number.isFinite(result?.answer?.confidence) ? result.answer.confidence : null,
    latencyMs: Math.round(latencyMs),
    fallback,
    error: error ? String(error.message || error) : null,
    stageNote: result.stageNote || null,
    trace,
    facts: chosenEvidence?.facts || null,
    localFacts: localEvidence?.facts || null
  };
}

async function playGame(engine, referee, arm, opening, options, index, total) {
  referee.reset(opening.moves);
  const records = [];

  process.stdout.write(
    '[' + index + '/' + total + '] white=' + ARMS[arm].label +
    ' vs black=Ref Local · ' + opening.name + ' ... '
  );

  while (!referee.finished) {
    const color = referee.toMove;
    const ply = referee.plies;

    if (color === BLACK) {
      const decision = blackReferenceDecision(engine, referee, options.mode);
      if (decision.substituted) referee.forbiddenSubstitutions++;
      const commit = referee.commit(decision.key, BLACK, decision.verdict);
      records.push({
        ply: ply + 1,
        color: 'B',
        engine: 'ref-local',
        move: decision.key,
        source: decision.source,
        substituted: decision.substituted,
        rejected: decision.rejected,
        winsNow: commit.wins
      });
      continue;
    }

    const decision = await whiteDecision(engine, arm, referee, options);
    const verdict = referee.inspect(decision.choice, WHITE);

    if (!verdict.legal) {
      const foul = referee.recordFoul(arm, WHITE, decision.choice, verdict);
      records.push({
        ply: ply + 1,
        color: 'W',
        engine: arm,
        move: decision.choice,
        foul,
        winsNow: false
      });
      // An illegal white move loses on the spot, exactly like clicking an
      // occupied point in the page.
      referee.winner = BLACK;
      referee.winReason = 'white_foul';
      break;
    }

    // Hard tactical safety, measured by production code on the real board:
    // did white have a winning point and waste it, or hand black a one-move win?
    const whiteWinsBefore = referee.immediateWins(WHITE);
    const blackWinsBefore = referee.immediateWins(BLACK);

    let arbitration = null;
    if (options.arbitration && decision.isOverride) {
      const localVerdict = referee.inspect(decision.localChoice, WHITE);
      if (!localVerdict.legal) {
        arbitration = { verdict: 'skipped', reason: 'local_choice_illegal' };
      } else {
        try {
          const raw = engine.arbitrate(decision.localChoice, decision.choice, {
            mode: options.mode,
            depth: options.arbitrationDepth,
            branch: options.arbitrationBranch
          });
          arbitration = {
            verdict: raw.verdict,
            depth: raw.config.depth,
            branch: raw.config.branch,
            localScore: raw.a.searchScore,
            jevScore: raw.b.searchScore,
            localSafetyRank: raw.a.safetyRank,
            jevSafetyRank: raw.b.safetyRank,
            jevBetter: raw.verdict === 'b',
            localBetter: raw.verdict === 'a'
          };
        } catch (error) {
          arbitration = { verdict: 'error', error: String(error?.message || error) };
        }
      }
    }

    const commit = referee.commit(decision.choice, WHITE, verdict);
    const tactical = {
      whiteWinningPointsBefore: whiteWinsBefore,
      blackWinningPointsBefore: blackWinsBefore,
      winsNow: commit.wins,
      missedImmediateWin: !commit.wins && whiteWinsBefore.length > 0,
      blackWinningPointsAfter: null,
      leftImmediateReply: false,
      openedImmediateReply: false,
      blockedForcedWin: false
    };
    if (!commit.wins) {
      const blackWinsAfter = referee.immediateWins(BLACK);
      tactical.blackWinningPointsAfter = blackWinsAfter;
      tactical.leftImmediateReply = blackWinsAfter.length > 0;
      // White itself created the threat: black had no one-move win before.
      tactical.openedImmediateReply = tactical.leftImmediateReply && blackWinsBefore.length === 0;
      tactical.blockedForcedWin = blackWinsBefore.length > 0 && blackWinsAfter.length === 0;
    }

    records.push({
      ply: ply + 1,
      color: 'W',
      engine: arm,
      move: decision.choice,
      winsNow: commit.wins,
      localChoice: decision.localChoice,
      localRank: decision.localRank,
      isOverride: decision.isOverride,
      candidateCount: decision.candidateCount,
      forced: decision.forced,
      confidence: decision.confidence,
      latencyMs: decision.latencyMs,
      fallback: decision.fallback,
      error: decision.error,
      stageNote: decision.stageNote,
      trace: decision.trace,
      arbitration,
      tactical,
      facts: decision.facts,
      localFacts: decision.localFacts
    });
  }

  const winnerEngine = referee.winner === WHITE ? arm : referee.winner === BLACK ? 'ref-local' : null;
  if (!referee.winReason && !winnerEngine) {
    referee.winReason = referee.empties() === 0 ? 'board_full' : 'max_plies';
  }
  console.log(winnerEngine
    ? 'winner: ' + winnerEngine + ' in ' + referee.plies + ' plies'
    : 'draw (' + referee.winReason + ')');

  return {
    opening: opening.name,
    openingMoves: opening.moves,
    arm,
    blackEngine: 'ref-local',
    whiteEngine: arm,
    winner: referee.result,
    winnerEngine,
    winReason: referee.winReason,
    plies: referee.plies,
    moves: referee.moves.map(move => move.coord),
    forbiddenSubstitutions: referee.forbiddenSubstitutions,
    fouls: referee.fouls.map(foul => ({ ...foul })),
    decisions: records
  };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function emptyVolume() {
  return {
    decisions: 0,
    jevCalls: 0,
    jevTurns: 0,
    zeroCallTurns: 0,
    forcedSingleCandidateTurns: 0,
    overrides: 0,
    agreements: 0,
    fallbacks: 0,
    errors: 0,
    inputTokens: 0,
    outputTokens: 0,
    upstreamAttempts: 0,
    arbitered: 0,
    overrideJevBetter: 0,
    overrideLocalBetter: 0,
    overrideTie: 0,
    missedImmediateWins: 0,
    leftImmediateReplies: 0,
    openedImmediateReplies: 0,
    blockedForcedWins: 0,
    wildcardRequested: 0,
    wildcardAccepted: 0,
    wildcardChosen: 0,
    atomicPairwiseCompared: 0,
    atomicPairwiseAgreements: 0,
    finalLocal1Matches: 0,
    finalDeep1Matches: 0,
    vcfChosen: 0,
    threatFilterHits: 0,
    counterThreatWarnings: 0,
    counterThreatHighCritical: 0,
    counterThreatForcedDefenseResidual: 0,
    counterThreatAdvisoryTimeouts: 0,
    threatCoverageSupplementalTurns: 0,
    threatCoverageSupplementalCandidates: 0,
    threatCoverageRejectedIncomplete: 0,
    threatCoverageSupplementalElapsed: [],
    rescueSweepTurns: 0,
    rescueSweepCandidates: 0,
    rescueSweepVetted: 0,
    rescueSweepUnresolved: 0,
    rescueSweepExhausted: 0,
    rescueSweepVerificationPasses: 0,
    rescueSweepRetriedCandidates: 0,
    rescueSweepElapsed: [],
    workerTimeouts: 0,
    payloadOverTarget: 0,
    payloadOverHard: 0,
    latencies: [],
    localElapsed: [],
    deepElapsed: [],
    threatElapsed: [],
    deepSearch: { completed: 0, timeout: 0, error: 0, unavailable: 0, skipped: 0, noCompletedDepth: 0 },
    violations: []
  };
}

function accumulate(volume, record, options) {
  volume.decisions++;
  if (record.latencyMs) volume.latencies.push(record.latencyMs);
  if (record.fallback) volume.fallbacks++;
  if (record.error) volume.errors++;
  if (record.isOverride) volume.overrides++;
  else volume.agreements++;

  const shape = record.trace?.requestShape || {};
  const jev = record.trace?.jev || {};
  const deep = record.trace?.deepSearch || null;
  const threat = record.trace?.threatSearch || null;
  const maxTrace = record.trace?.max || {};
  const candidateCount = shape.candidateCount ?? record.candidateCount ?? 0;
  const httpRequests = shape.httpRequests ?? 0;

  if (jev.participated) {
    volume.jevTurns++;
    volume.jevCalls += Math.max(1, httpRequests || 1);
    volume.inputTokens += jev.inputTokens || 0;
    volume.outputTokens += jev.outputTokens || 0;
    volume.upstreamAttempts += jev.upstreamAttempts || 0;
  } else {
    volume.zeroCallTurns++;
  }
  if (candidateCount <= 1) volume.forcedSingleCandidateTurns++;

  if (deep) {
    const status = deep.status || 'unknown';
    if (status === 'completed') volume.deepSearch.completed++;
    else if (status === 'timeout') volume.deepSearch.timeout++;
    else if (status === 'error') volume.deepSearch.error++;
    else if (status === 'unavailable') volume.deepSearch.unavailable++;
    else if (status === 'skipped_opening') volume.deepSearch.skipped++;
    else if (status === 'no_completed_depth') volume.deepSearch.noCompletedDepth++;
    if (deep.timedOut) volume.workerTimeouts++;
  }
  if (threat?.timedOut) volume.workerTimeouts++;

  if (Number.isFinite(shape.localSearchElapsedMs)) volume.localElapsed.push(shape.localSearchElapsedMs);
  if (Number.isFinite(shape.deepElapsedMs)) volume.deepElapsed.push(shape.deepElapsedMs);
  if (Number.isFinite(shape.threatElapsedMs)) volume.threatElapsed.push(shape.threatElapsedMs);
  if (Number.isFinite(shape.threatSupplementalElapsedMs)) {
    volume.threatCoverageSupplementalTurns++;
    volume.threatCoverageSupplementalElapsed.push(shape.threatSupplementalElapsedMs);
  }
  volume.threatCoverageSupplementalCandidates += Array.isArray(shape.threatSupplementalCandidates)
    ? shape.threatSupplementalCandidates.length
    : 0;
  volume.threatCoverageRejectedIncomplete += Array.isArray(shape.threatCoverageRejectedIncomplete)
    ? shape.threatCoverageRejectedIncomplete.length
    : 0;
  if (Number.isFinite(shape.rescueSweepElapsedMs)) {
    volume.rescueSweepTurns++;
    volume.rescueSweepElapsed.push(shape.rescueSweepElapsedMs);
  }
  volume.rescueSweepCandidates += Array.isArray(shape.rescueSweepCandidates)
    ? shape.rescueSweepCandidates.length
    : 0;
  volume.rescueSweepVerificationPasses += Number(shape.rescueSweepPasses || 0);
  volume.rescueSweepRetriedCandidates += Array.isArray(shape.rescueSweepRetriedCandidates)
    ? shape.rescueSweepRetriedCandidates.length
    : 0;
  const rescueTrace = maxTrace.rescueSweep || {};
  volume.rescueSweepVetted += Array.isArray(rescueTrace.vetted) ? rescueTrace.vetted.length : 0;
  volume.rescueSweepUnresolved += Array.isArray(rescueTrace.unresolved) ? rescueTrace.unresolved.length : 0;
  if (shape.decisionAuthority === 'bounded_rescue_exhausted') volume.rescueSweepExhausted++;

  if (record.engine === 'jev-max') {
    if (!record.isOverride) volume.finalLocal1Matches++;
    const deepTop = (maxTrace.localEvidence || []).find(item => item.deepSearchRank === 1)?.move;
    if (deepTop && deepTop === record.choice) volume.finalDeep1Matches++;

    const atomicRows = (maxTrace.localEvidence || []).filter(item => Number.isFinite(item.atomicScore));
    const pairRows = (maxTrace.localEvidence || []).filter(item => Number.isFinite(item.pairScore));
    if (atomicRows.length && pairRows.length) {
      volume.atomicPairwiseCompared++;
      const atomicTop = [...atomicRows].sort((a,b) => b.atomicScore - a.atomicScore)[0]?.move;
      const pairTop = [...pairRows].sort((a,b) => b.pairScore - a.pairScore)[0]?.move;
      if (atomicTop && atomicTop === pairTop) volume.atomicPairwiseAgreements++;
    }

    const wildcard = maxTrace.wildcard;
    if (wildcard?.requested) volume.wildcardRequested++;
    if (wildcard?.accepted) volume.wildcardAccepted++;
    if (wildcard?.chosen) volume.wildcardChosen++;
    if (record.facts?.vcf_status === 'FORCED_SEQUENCE_FOUND') volume.vcfChosen++;
    volume.threatFilterHits += Number(shape.threatFilterCount || 0);

    for (const evidence of maxTrace.localEvidence || []) {
      const counter = evidence?.threatSearch?.counterThreat;
      if (!counter) continue;
      if (counter.timedOut) volume.counterThreatAdvisoryTimeouts++;
      if (counter.risk && !['NONE', 'UNKNOWN', 'PROVEN_FORCED_LOSS'].includes(counter.risk)) {
        volume.counterThreatWarnings++;
      }
      if (['HIGH', 'CRITICAL'].includes(counter.risk)) {
        volume.counterThreatHighCritical++;
      }
      if (
        counter.forcedDefenseMove
        && Array.isArray(counter.networkMoves)
        && counter.networkMoves.length
      ) {
        volume.counterThreatForcedDefenseResidual++;
      }
    }

    for (const estimate of shape.payloadEstimatedInputTokens || []) {
      if (estimate > 5000) volume.payloadOverTarget++;
      if (estimate > 7000) volume.payloadOverHard++;
    }
  }

  if (record.tactical?.missedImmediateWin) volume.missedImmediateWins++;
  if (record.tactical?.leftImmediateReply) volume.leftImmediateReplies++;
  if (record.tactical?.openedImmediateReply) volume.openedImmediateReplies++;
  if (record.tactical?.blockedForcedWin) volume.blockedForcedWins++;

  if (record.arbitration && record.arbitration.verdict !== 'error' && record.arbitration.verdict !== 'skipped') {
    volume.arbitered++;
    if (record.arbitration.jevBetter) volume.overrideJevBetter++;
    else if (record.arbitration.localBetter) volume.overrideLocalBetter++;
    else volume.overrideTie++;
  }

  // --- shipped policy contract --------------------------------------------
  const plies = record.ply - 1; // stones already on the board before this move
  const arm = ARMS[record.engine];

  if (arm?.expectsJev) {
    const maxRequests = record.engine === 'jev-max' ? 3 : 1;
    if (candidateCount > 1 && httpRequests > maxRequests) {
      volume.violations.push({
        kind: 'jev_calls_per_turn',
        ply: record.ply,
        detail: 'candidateCount=' + candidateCount + ' but httpRequests=' + httpRequests + ' (max=' + maxRequests + ')'
      });
    }
    if (candidateCount === 1 && jev.participated) {
      volume.violations.push({
        kind: 'forced_candidate_must_skip_jev',
        ply: record.ply,
        detail: 'single deterministic candidate still triggered a Jev request'
      });
    }
    if (record.engine === 'jev-final') {
      // A single deterministic candidate must be taken with 0 Jev calls; every
      // other turn must record Jev as the final decision authority.
      const expectedAuthority = candidateCount <= 1 ? 'single_candidate' : 'jev_final';
      if (shape.decisionAuthority !== expectedAuthority) {
        volume.violations.push({
          kind: 'decision_authority',
          ply: record.ply,
          detail: 'candidates=' + candidateCount + ' decisionAuthority=' + shape.decisionAuthority
            + ' (expected ' + expectedAuthority + ')'
        });
      }
    }
    if (record.engine === 'jev-max' && candidateCount > 1) {
      if (!['jev_max_final', 'jev_max_pairwise_convergence', 'jev_max_rescue', 'bounded_rescue_exhausted'].includes(shape.decisionAuthority)) {
        volume.violations.push({
          kind: 'jev_max_decision_authority',
          ply: record.ply,
          detail: 'unexpected decisionAuthority=' + shape.decisionAuthority
        });
      }
      if ((shape.atomicCount || 0) > 8 || (shape.pairwiseCount || 0) > 12 || (shape.criticCount || 0) > 4) {
        volume.violations.push({
          kind: 'jev_max_unbounded_analysis',
          ply: record.ply,
          detail: 'atomic=' + shape.atomicCount + ' pairwise=' + shape.pairwiseCount + ' critic=' + shape.criticCount
        });
      }
      if (Number(shape.rescueSweepPasses || 0) > 3) {
        volume.violations.push({
          kind: 'jev_max_rescue_pass_limit',
          ply: record.ply,
          detail: 'rescue verification passes=' + shape.rescueSweepPasses
        });
      }
      if ((shape.rescueSweepRetriedCandidates || []).length > 2) {
        volume.violations.push({
          kind: 'jev_max_rescue_retry_limit',
          ply: record.ply,
          detail: 'rescue retried candidates=' + JSON.stringify(shape.rescueSweepRetriedCandidates)
        });
      }
      if ((shape.rescueSweepCandidates || []).length > 6) {
        volume.violations.push({
          kind: 'jev_max_rescue_sweep_limit',
          ply: record.ply,
          detail: 'rescue candidates=' + JSON.stringify(shape.rescueSweepCandidates)
        });
      }
      if (['jev_max_rescue', 'bounded_rescue_exhausted'].includes(shape.decisionAuthority)
        && ((shape.pairwiseCount || 0) !== 0 || (shape.criticCount || 0) !== 0)) {
        volume.violations.push({
          kind: 'jev_max_rescue_semantic_waste',
          ply: record.ply,
          detail: 'rescue mode must skip pairwise/critic'
        });
      }
      if ((shape.threatSupplementalCandidates || []).length > 2) {
        volume.violations.push({
          kind: 'jev_max_threat_supplemental_limit',
          ply: record.ply,
          detail: 'supplemental candidates=' + JSON.stringify(shape.threatSupplementalCandidates)
        });
      }
      if (shape.pairwiseThreatCoverageComplete === false) {
        volume.violations.push({
          kind: 'jev_max_pairwise_threat_coverage',
          ply: record.ply,
          detail: 'Pairwise received a candidate without completed Threat evidence'
        });
      }
      if ((shape.maxWorkers || 0) > 2) {
        volume.violations.push({
          kind: 'jev_max_worker_limit',
          ply: record.ply,
          detail: 'maxWorkers=' + shape.maxWorkers
        });
      }
      if ((shape.payloadEstimatedInputTokens || []).some(value => value > 7000)) {
        volume.violations.push({
          kind: 'jev_max_payload_hard_limit',
          ply: record.ply,
          detail: 'payload estimates=' + JSON.stringify(shape.payloadEstimatedInputTokens)
        });
      }
    }

    if (record.engine === 'jev-final' && shape.localEvidenceVisibleToJev === false) {
      volume.violations.push({
        kind: 'local_evidence_hidden',
        ply: record.ply,
        detail: 'Jev did not see Local evidence'
      });
    }
  } else if (jev.participated) {
    volume.violations.push({
      kind: 'local_arm_called_jev',
      ply: record.ply,
      detail: 'Local-only arm issued a Jev request'
    });
  }

  if (options.mode === 'expert' && record.engine === 'jev-final') {
    const expectShallow = plies < 8;
    if (expectShallow && shape.localOpeningAdaptive !== true) {
      volume.violations.push({
        kind: 'opening_adaptive_profile',
        ply: record.ply,
        detail: 'plies=' + plies + ' must use the shallow opening profile'
      });
    }
    if (!expectShallow && shape.localOpeningAdaptive === true) {
      volume.violations.push({
        kind: 'opening_adaptive_profile',
        ply: record.ply,
        detail: 'plies=' + plies + ' must not use the opening-only profile'
      });
    }
    const expectSkipDeep = plies < 10 || candidateCount < 2;
    if (expectSkipDeep && deep && deep.status !== 'skipped_opening') {
      volume.violations.push({
        kind: 'deep_search_policy',
        ply: record.ply,
        detail: 'plies=' + plies + ' candidates=' + candidateCount + ' should skip the deep worker, got status=' + deep.status
      });
    }
    if (!expectSkipDeep && deep && deep.status === 'skipped_opening') {
      volume.violations.push({
        kind: 'deep_search_policy',
        ply: record.ply,
        detail: 'plies=' + plies + ' candidates=' + candidateCount + ' should have run the deep worker'
      });
    }
  }
}

function summarize(games, arms, options) {
  const perArm = {};
  for (const arm of arms) {
    perArm[arm] = {
      arm,
      label: ARMS[arm].label,
      games: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      points: 0,
      plies: 0,
      volume: emptyVolume()
    };
  }

  for (const game of games) {
    const item = perArm[game.arm];
    if (!item) continue;
    item.games++;
    item.plies += game.plies;
    if (!game.winnerEngine) {
      item.draws++;
      item.points += 0.5;
    } else if (game.winnerEngine === game.arm) {
      item.wins++;
      item.points += 1;
    } else {
      item.losses++;
    }
    for (const record of game.decisions) {
      if (record.color !== 'W') continue;
      accumulate(item.volume, record, options);
    }
  }

  const openingNames = unique(games.map(game => game.opening));
  const pairedOpenings = [];
  for (const name of openingNames) {
    const row = { opening: name, results: {} };
    for (const arm of arms) {
      const game = games.find(item => item.opening === name && item.arm === arm);
      if (!game) continue;
      row.results[arm] = {
        result: game.winner,
        plies: game.plies,
        reason: game.winReason,
        overrides: game.decisions.filter(record => record.color === 'W' && record.isOverride).length,
        whiteDecisions: game.decisions.filter(record => record.color === 'W').length
      };
    }
    pairedOpenings.push(row);
  }

  const summary = { arms: {}, pairedOpenings };
  for (const arm of arms) {
    const item = perArm[arm];
    const volume = item.volume;
    const scoreRate = item.games ? item.points / item.games : 0;
    summary.arms[arm] = {
      arm,
      label: item.label,
      games: item.games,
      wins: item.wins,
      losses: item.losses,
      draws: item.draws,
      points: item.points,
      scoreRate,
      scoreRateCi95: wilsonInterval(item.points, item.games),
      avgPlies: item.games ? item.plies / item.games : 0,
      decisions: volume.decisions,
      jevCalls: volume.jevCalls,
      jevTurns: volume.jevTurns,
      zeroCallTurns: volume.zeroCallTurns,
      forcedSingleCandidateTurns: volume.forcedSingleCandidateTurns,
      jevCallsPerWhiteTurn: volume.decisions ? volume.jevCalls / volume.decisions : 0,
      overrides: volume.overrides,
      agreements: volume.agreements,
      overrideRate: volume.decisions ? volume.overrides / volume.decisions : 0,
      arbitered: volume.arbitered,
      overrideJevBetter: volume.overrideJevBetter,
      overrideLocalBetter: volume.overrideLocalBetter,
      overrideTie: volume.overrideTie,
      overrideQuality: volume.arbitered ? volume.overrideJevBetter / volume.arbitered : null,
      missedImmediateWins: volume.missedImmediateWins,
      leftImmediateReplies: volume.leftImmediateReplies,
      openedImmediateReplies: volume.openedImmediateReplies,
      blockedForcedWins: volume.blockedForcedWins,
      tacticalErrorRate: volume.decisions
        ? (volume.missedImmediateWins + volume.openedImmediateReplies) / volume.decisions
        : 0,
      fallbacks: volume.fallbacks,
      errors: volume.errors,
      inputTokens: volume.inputTokens,
      outputTokens: volume.outputTokens,
      upstreamAttempts: volume.upstreamAttempts,
      avgDecisionMs: volume.latencies.length
        ? volume.latencies.reduce((sum, value) => sum + value, 0) / volume.latencies.length
        : 0,
      p50DecisionMs: percentile(volume.latencies, 0.5),
      p95DecisionMs: percentile(volume.latencies, 0.95),
      deepSearch: volume.deepSearch,
      wildcardRequested: volume.wildcardRequested,
      wildcardAccepted: volume.wildcardAccepted,
      wildcardChosen: volume.wildcardChosen,
      atomicPairwiseCompared: volume.atomicPairwiseCompared,
      atomicPairwiseAgreements: volume.atomicPairwiseAgreements,
      atomicPairwiseConsistency: volume.atomicPairwiseCompared
        ? volume.atomicPairwiseAgreements / volume.atomicPairwiseCompared
        : null,
      finalLocal1Matches: volume.finalLocal1Matches,
      finalDeep1Matches: volume.finalDeep1Matches,
      finalLocal1Rate: volume.decisions ? volume.finalLocal1Matches / volume.decisions : null,
      finalDeep1Rate: volume.decisions ? volume.finalDeep1Matches / volume.decisions : null,
      vcfChosen: volume.vcfChosen,
      threatFilterHits: volume.threatFilterHits,
      counterThreatWarnings: volume.counterThreatWarnings,
      counterThreatHighCritical: volume.counterThreatHighCritical,
      counterThreatForcedDefenseResidual: volume.counterThreatForcedDefenseResidual,
      counterThreatAdvisoryTimeouts: volume.counterThreatAdvisoryTimeouts,
      threatCoverageSupplementalTurns: volume.threatCoverageSupplementalTurns,
      threatCoverageSupplementalCandidates: volume.threatCoverageSupplementalCandidates,
      threatCoverageRejectedIncomplete: volume.threatCoverageRejectedIncomplete,
      avgThreatCoverageSupplementalElapsedMs: volume.threatCoverageSupplementalElapsed.length
        ? volume.threatCoverageSupplementalElapsed.reduce((sum, value) => sum + value, 0) / volume.threatCoverageSupplementalElapsed.length
        : 0,
      rescueSweepTurns: volume.rescueSweepTurns,
      rescueSweepCandidates: volume.rescueSweepCandidates,
      rescueSweepVetted: volume.rescueSweepVetted,
      rescueSweepUnresolved: volume.rescueSweepUnresolved,
      rescueSweepExhausted: volume.rescueSweepExhausted,
      rescueSweepVerificationPasses: volume.rescueSweepVerificationPasses,
      rescueSweepRetriedCandidates: volume.rescueSweepRetriedCandidates,
      avgRescueSweepElapsedMs: volume.rescueSweepElapsed.length
        ? volume.rescueSweepElapsed.reduce((sum, value) => sum + value, 0) / volume.rescueSweepElapsed.length
        : 0,
      workerTimeouts: volume.workerTimeouts,
      payloadOverTarget: volume.payloadOverTarget,
      payloadOverHard: volume.payloadOverHard,
      avgLocalElapsedMs: volume.localElapsed.length
        ? volume.localElapsed.reduce((sum, value) => sum + value, 0) / volume.localElapsed.length
        : 0,
      avgDeepElapsedMs: volume.deepElapsed.length
        ? volume.deepElapsed.reduce((sum, value) => sum + value, 0) / volume.deepElapsed.length
        : 0,
      avgThreatElapsedMs: volume.threatElapsed.length
        ? volume.threatElapsed.reduce((sum, value) => sum + value, 0) / volume.threatElapsed.length
        : 0,
      violations: volume.violations
    };
  }

  if (summary.arms.local && summary.arms['jev-final']) {
    const local = summary.arms.local;
    const jevFinal = summary.arms['jev-final'];
    let onlyLocalWon = 0;
    let onlyJevWon = 0;
    let identical = 0;
    for (const row of pairedOpenings) {
      const a = row.results.local;
      const b = row.results['jev-final'];
      if (!a || !b) continue;
      if (a.result === b.result) identical++;
      else if (a.result === 'W') onlyLocalWon++;
      else if (b.result === 'W') onlyJevWon++;
    }
    summary.headToHead = {
      scoreRateLocal: local.scoreRate,
      scoreRateJevFinal: jevFinal.scoreRate,
      deltaScoreRate: jevFinal.scoreRate - local.scoreRate,
      openingsWithIdenticalResult: identical,
      openingsOnlyLocalWon: onlyLocalWon,
      openingsOnlyJevFinalWon: onlyJevWon
    };
  }

  return summary;
}

function generateRecommendations(summary) {
  const recommendations = [];
  const local = summary.arms.local;
  const jevFinal = summary.arms['jev-final'];
  const gameCount = Object.values(summary.arms).reduce((max, item) => Math.max(max, item.games), 0);

  if (gameCount < 12) {
    recommendations.push({
      priority: 'P0',
      title: '样本量偏小，先不要下棋力结论',
      detail: '当前每个 arm 只有 ' + gameCount + ' 局。至少 12 局（建议 12 个 opening 以上）再判断棋力差异；单局五子棋方差很大。'
    });
  }

  if (jevFinal && local) {
    const delta = summary.headToHead?.deltaScoreRate ?? 0;
    if (delta > 0.05) {
      recommendations.push({
        priority: 'P2',
        title: 'Jev 作为最终决策者显示正向棋力增益',
        detail: '同一对手、同一开局下 Jev Final 得分率 ' + pct(jevFinal.scoreRate)
          + '，Local ' + pct(local.scoreRate) + '（+' + pct(delta) + '）。下一步优化成本，不要改动决策权。'
      });
    } else if (delta < -0.05) {
      recommendations.push({
        priority: 'P0',
        title: 'Jev 最终决策目前没有带来棋力增益',
        detail: '同一对手、同一开局下 Jev Final 得分率 ' + pct(jevFinal.scoreRate)
          + '，低于 Local ' + pct(local.scoreRate)
          + '。先收缩 Jev 的改写权限：只在深搜证据与 Local #1 接近、且硬战术检查无法区分时允许改手。'
      });
    } else {
      recommendations.push({
        priority: 'P1',
        title: '棋力差异不显著，先看改写质量',
        detail: 'Jev Final ' + pct(jevFinal.scoreRate) + ' vs Local ' + pct(local.scoreRate)
          + '，差异落在噪声范围内。重点看 override 质量：改对了多少、改错了多少。'
      });
    }

    if (jevFinal.arbitered > 0) {
      const quality = jevFinal.overrideQuality ?? 0;
      if (quality >= 0.6) {
        recommendations.push({
          priority: 'P2',
          title: 'Jev 的改判在深搜裁判下多数正确',
          detail: jevFinal.overrideJevBetter + '/' + jevFinal.arbitered
            + ' 次改写被判为优于 Local #1，可以继续扩大 Jev 的改写范围。'
        });
      } else if (quality <= 0.4) {
        recommendations.push({
          priority: 'P0',
          title: 'Jev 的改判在深搜裁判下多数更差',
          detail: '只有 ' + jevFinal.overrideJevBetter + '/' + jevFinal.arbitered
            + ' 次改写被判为优于 Local #1，' + jevFinal.overrideLocalBetter
            + ' 次更差。优先修 Local 证据的表达方式（深搜分差、对手反击线要更显式），而不是调提示语语气。'
        });
      } else {
        recommendations.push({
          priority: 'P1',
          title: 'Jev 的改判接近随机',
          detail: jevFinal.overrideJevBetter + ' 次更好 / ' + jevFinal.overrideLocalBetter
            + ' 次更差 / ' + jevFinal.overrideTie
            + ' 次持平。说明证据还不足以支撑改写，考虑在证据分差低于阈值时强制保留 Local #1。'
        });
      }
    } else if (jevFinal.overrides > 0) {
      recommendations.push({
        priority: 'P1',
        title: '有改写但没有裁判数据',
        detail: '本次运行未产生可用的深搜裁判结果，降低 --arbitration-depth 或检查 arbitrate 调用是否报错。'
      });
    }

    if (jevFinal.overrides === 0 && jevFinal.decisions > 0) {
      recommendations.push({
        priority: 'P1',
        title: 'Jev 从未改写 Local #1',
        detail: '改写率 0%。此时 Jev 只是在为延迟和 Token 买单，而不是提升棋力。要么减少调用频率，要么让证据里出现 Local 看不到的信息（更深搜索、对手反击线）。'
      });
    } else if (jevFinal.overrideRate > 0.5 && (jevFinal.overrideQuality ?? 1) < 0.5) {
      recommendations.push({
        priority: 'P0',
        title: '改写频繁但质量不佳',
        detail: 'Jev 改写率超过 50%，但深搜裁判认为多数改写更差。需要收紧候选集或提高硬战术过滤强度。'
      });
    }
  }

  for (const item of Object.values(summary.arms)) {
    if (item.violations.length) {
      recommendations.push({
        priority: 'P0',
        title: item.label + ' 违反已承诺的调用/性能契约',
        detail: item.violations
          .slice(0, 3)
          .map(violation => '#' + violation.ply + ' ' + violation.kind + '（' + violation.detail + '）')
          .join('；') + (item.violations.length > 3 ? '；共 ' + item.violations.length + ' 处' : '')
      });
    }
    if (item.errors > 0 || item.fallbacks > 0) {
      recommendations.push({
        priority: 'P0',
        title: item.label + ' 出现 Jev 失败与降级',
        detail: 'errors=' + item.errors + '，fallbacks=' + item.fallbacks
          + '。降级回 Local 会掩盖 Jev 的真实棋力，先解决稳定性再比较棋力。'
      });
    }
    if (item.missedImmediateWins > 0) {
      recommendations.push({
        priority: 'P0',
        title: item.label + ' 漏掉立即取胜点',
        detail: item.missedImmediateWins + ' 手在存在必胜点时没有取胜。生产引擎的硬战术过滤本应把候选集收敛到必胜点，说明最终决策绕过了这道过滤。'
      });
    }
    if (item.openedImmediateReplies > 0) {
      recommendations.push({
        priority: 'P0',
        title: item.label + ' 自己给对手造出立即取胜点',
        detail: item.openedImmediateReplies
          + ' 手在走之前对手没有一步成五，走完之后出现了。硬战术安全过滤（tactical_safety）必须挡住这类落点。'
      });
    }
  }

  if (jevFinal && jevFinal.games) {
    recommendations.push({
      priority: 'P2',
      title: '记录当前成本基线',
      detail: 'Jev Final：每局 ' + num(jevFinal.jevCalls / jevFinal.games, 1) + ' 次 Jev 调用，'
        + num(jevFinal.inputTokens / jevFinal.games) + ' / ' + num(jevFinal.outputTokens / jevFinal.games)
        + ' input/output token，决策 p50 ' + num(jevFinal.p50DecisionMs) + ' ms、p95 '
        + num(jevFinal.p95DecisionMs) + ' ms。'
    });
  }

  if (summary.arms['jev-final'] && summary.arms['jev-final'].forcedSingleCandidateTurns === 0
    && summary.arms['jev-final'].decisions > 0) {
    recommendations.push({
      priority: 'P2',
      title: '没有出现「唯一候选」回合',
      detail: '本批次没有触发 0 次 Jev 请求的强制候选路径，无法验证该短路逻辑的实际命中率。需要更多局面或更长对局。'
    });
  }

  if (!recommendations.some(item => item.priority === 'P0')) {
    recommendations.push({
      priority: 'P2',
      title: '当前没有阻塞性问题',
      detail: '继续扩大 opening 数量并保持同一对手，重点追踪 Jev 改写质量与每局调用成本的变化趋势。'
    });
  }

  return recommendations;
}

function renderMarkdown(report) {
  const lines = [];
  const arms = report.config.arms;
  lines.push('# Jev Gomoku Benchmark — Jev 作为最终落子决策者');
  lines.push('');
  lines.push('- 时间：' + report.generatedAt);
  lines.push('- 对局：每个 arm ' + report.config.openingCount + ' 局，共 ' + report.games.length + ' 局');
  lines.push('- 白棋（被测）：' + arms.map(arm => ARM_LABELS[arm]).join(' / '));
  lines.push('- 黑棋（固定参照）：Ref Local（生产 Local + Renju 裁判过滤）');
  lines.push('- 搜索档位 / 模型：' + report.config.mode + ' / ' + report.config.model);
  lines.push('- 单局最大手数：' + report.config.maxPlies);
  lines.push('- Jev 传输：' + (report.config.mockJev
    ? '离线 mock（无 API 调用，仅验证管线）'
    : 'TypeSafe System One（真实调用）'));
  lines.push('- 深搜执行方式：' + (report.config.deepWorker === 'thread'
    ? 'node worker_threads 复刻浏览器 Worker（含 1.5s 预算）'
    : '引擎内同步回退（无预算，测试用）'));
  lines.push('');

  lines.push('## 主结论：Jev 最终决策 vs Local 单独决策');
  lines.push('');
  lines.push('| Arm | W-L-D | 得分率 | 95% CI | 平均手数 | 平均决策 | p95 决策 |');
  lines.push('|---|---:|---:|---|---:|---:|---:|');
  for (const arm of arms) {
    const item = report.summary.arms[arm];
    lines.push(
      '| ' + item.label +
      ' | ' + item.wins + '-' + item.losses + '-' + item.draws +
      ' | ' + pct(item.scoreRate) +
      ' | [' + pct(item.scoreRateCi95.low) + ', ' + pct(item.scoreRateCi95.high) + ']' +
      ' | ' + num(item.avgPlies, 1) +
      ' | ' + num(item.avgDecisionMs) + ' ms' +
      ' | ' + num(item.p95DecisionMs) + ' ms |'
    );
  }

  if (report.summary.headToHead) {
    const head = report.summary.headToHead;
    lines.push('');
    lines.push('同一对手、同一开局下的配对比较：');
    lines.push('');
    lines.push('- Local 得分率：' + pct(head.scoreRateLocal));
    lines.push('- Jev Final 得分率：' + pct(head.scoreRateJevFinal));
    lines.push('- 差值：' + (head.deltaScoreRate >= 0 ? '+' : '') + pct(head.deltaScoreRate));
    lines.push('- 结果完全相同的开局数：' + head.openingsWithIdenticalResult);
    lines.push('- 只有 Local 赢下的开局：' + head.openingsOnlyLocalWon);
    lines.push('- 只有 Jev Final 赢下的开局：' + head.openingsOnlyJevFinalWon);
  }

  lines.push('');
  lines.push('## 逐开局配对结果');
  lines.push('');
  lines.push('| Opening | ' + arms.map(arm => ARM_LABELS[arm]).join(' | ') + ' |');
  lines.push('|---|' + arms.map(() => '---:').join('|') + '|');
  for (const row of report.summary.pairedOpenings) {
    const cells = arms.map(arm => {
      const item = row.results[arm];
      if (!item) return '-';
      const outcome = item.result === 'W' ? '白胜' : item.result === 'B' ? '黑胜' : '和';
      return outcome + '(' + item.plies + '手/' + item.reason + ')';
    });
    lines.push('| ' + row.opening + ' | ' + cells.join(' | ') + ' |');
  }

  lines.push('');
  lines.push('## 决策质量');
  lines.push('');
  lines.push('| Arm | 白棋决策 | 改写 Local #1 | 改写率 | 裁判：Jev 更优 | Local 更优 | 持平 | 改写质量 | 漏必胜 | 自造必防 |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const arm of arms) {
    const item = report.summary.arms[arm];
    lines.push(
      '| ' + item.label +
      ' | ' + item.decisions +
      ' | ' + item.overrides +
      ' | ' + pct(item.overrideRate) +
      ' | ' + item.overrideJevBetter +
      ' | ' + item.overrideLocalBetter +
      ' | ' + item.overrideTie +
      ' | ' + (item.overrideQuality == null ? 'n/a' : pct(item.overrideQuality)) +
      ' | ' + item.missedImmediateWins +
      ' | ' + item.openedImmediateReplies + ' |'
    );
  }
  lines.push('');
  lines.push('> 「裁判」是离线确定性验证：对 Local #1 与 Jev 的实际落点各做一轮更深搜索（depth '
    + report.config.arbitrationDepth + ' / branch ' + report.config.arbitrationBranch
    + '，并保留 production 的 VCF/VCT 战术分析）再比较战术安全等级与分数。它只用于测量，不参与对局。');

  lines.push('');
  if (report.summary.arms['jev-max']) {
    const max = report.summary.arms['jev-max'];
    lines.push('');
    lines.push('## Jev Max 专项指标');
    lines.push('');
    lines.push('| Atomic/Pairwise 一致率 | 与 Local #1 一致 | 与 Deep #1 一致 | wildcard 请求/接受/最终选择 | VCF 选择 | Threat filter 命中 | Counter-threat 告警(H/C) | Forced-defense residual | Coverage 补检(候选/拒绝) | Advisory timeout | Worker timeout | Payload >5k / >7k |');
    lines.push('|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
    lines.push(
      '| ' + (max.atomicPairwiseConsistency == null ? 'n/a' : pct(max.atomicPairwiseConsistency)) +
      ' | ' + max.finalLocal1Matches + '/' + max.decisions +
      ' | ' + max.finalDeep1Matches + '/' + max.decisions +
      ' | ' + max.wildcardRequested + '/' + max.wildcardAccepted + '/' + max.wildcardChosen +
      ' | ' + max.vcfChosen +
      ' | ' + max.threatFilterHits +
      ' | ' + max.counterThreatWarnings + ' (' + max.counterThreatHighCritical + ')' +
      ' | ' + max.counterThreatForcedDefenseResidual +
      ' | ' + max.threatCoverageSupplementalTurns + ' (' + max.threatCoverageSupplementalCandidates + '/' + max.threatCoverageRejectedIncomplete + ')' +
      ' | ' + max.counterThreatAdvisoryTimeouts +
      ' | ' + max.workerTimeouts +
      ' | ' + max.payloadOverTarget + ' / ' + max.payloadOverHard + ' |'
    );
    lines.push('');
    lines.push('- 本地 / Deep / Threat 平均耗时：'
      + num(max.avgLocalElapsedMs) + ' / ' + num(max.avgDeepElapsedMs) + ' / ' + num(max.avgThreatElapsedMs) + ' ms');
    lines.push('- Threat coverage 补检平均耗时：' + num(max.avgThreatCoverageSupplementalElapsedMs) + ' ms（仅触发回合统计）');
    lines.push('- Rescue Sweep：' + max.rescueSweepTurns + ' 回合 / ' + max.rescueSweepCandidates
      + ' 候选；验证 pass=' + max.rescueSweepVerificationPasses
      + '；独立重试候选=' + max.rescueSweepRetriedCandidates
      + '；bounded exhausted=' + max.rescueSweepExhausted
      + '；平均耗时=' + num(max.avgRescueSweepElapsedMs) + ' ms');
  }

  lines.push('');
  lines.push('## 成本与调用契约');
  lines.push('');
  lines.push('| Arm | Jev 调用 | 每手调用 | 0 调用回合 | 唯一候选回合 | input/output token | 上游尝试 |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|');
  for (const arm of arms) {
    const item = report.summary.arms[arm];
    lines.push(
      '| ' + item.label +
      ' | ' + item.jevCalls +
      ' | ' + num(item.jevCallsPerWhiteTurn, 2) +
      ' | ' + item.zeroCallTurns +
      ' | ' + item.forcedSingleCandidateTurns +
      ' | ' + item.inputTokens + ' / ' + item.outputTokens +
      ' | ' + item.upstreamAttempts + ' |'
    );
  }

  lines.push('');
  lines.push('## 深搜与性能保护');
  lines.push('');
  lines.push('| Arm | completed | no_completed_depth | timeout | error | unavailable | skipped(opening) |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|');
  for (const arm of arms) {
    const deep = report.summary.arms[arm].deepSearch;
    lines.push(
      '| ' + ARM_LABELS[arm] +
      ' | ' + deep.completed +
      ' | ' + (deep.noCompletedDepth || 0) +
      ' | ' + deep.timeout +
      ' | ' + deep.error +
      ' | ' + deep.unavailable +
      ' | ' + deep.skipped + ' |'
    );
  }

  lines.push('');
  lines.push('## 契约校验');
  lines.push('');
  const violations = arms.flatMap(arm => report.summary.arms[arm].violations.map(violation => ({ arm, ...violation })));
  if (!violations.length) {
    lines.push('- 未发现违规：每白棋回合 ≤ 1 次 Jev、唯一候选 0 次 Jev、开局前 8 手浅搜、前 10 手跳过额外 Deep Worker。');
  } else {
    for (const violation of violations.slice(0, 20)) {
      lines.push('- ' + ARM_LABELS[violation.arm] + ' #' + violation.ply + ' `' + violation.kind + '` — ' + violation.detail);
    }
    if (violations.length > 20) lines.push('- …共 ' + violations.length + ' 处');
  }

  lines.push('');
  lines.push('## Renju 禁手一致性');
  lines.push('');
  lines.push('- 裁判规则直接来自生产引擎（`src/app.js` 的 `blackForbiddenInfo` / `hasExactFiveAt` / `hasOverlineAt`），benchmark 没有另写一套规则。');
  lines.push('- 黑棋禁手落点被拒绝并记入 `forbiddenSubstitutions`：'
    + report.renju.totalForbiddenSubstitutions + ' 次'
    + (report.renju.substitutionRate == null ? '' : '（占黑棋决策 ' + pct(report.renju.substitutionRate) + '）'));
  lines.push('- 白棋非法落点：' + report.renju.totalFouls + ' 次');
  lines.push('- 胜因分布：' + (report.renju.winReasons.length
    ? report.renju.winReasons.map(item => item.reason + '×' + item.count).join('、')
    : '本次没有分出胜负'));
  if (report.renju.substitutionRate != null && report.renju.substitutionRate > 0.02) {
    lines.push('- ⚠️ 黑棋参照引擎（颜色互换视角）看不到黑棋禁手，替换率偏高会削弱对手强度，结论需保守解读。');
  }

  lines.push('');
  lines.push('## 优化方向');
  lines.push('');
  for (const item of report.recommendations) {
    lines.push('- **' + item.priority + ' · ' + item.title + '** — ' + item.detail);
  }

  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push('- 所有决策都调用 `src/app.js` 的生产函数：Local 用 `localOnlyDecision`，Jev Final 用 `advancedDecision`，没有另写搜索引擎。');
  lines.push('- 生产引擎只实现白棋座位，因此被测 arm 固定执白；黑棋是固定参照对手，两个 arm 面对完全相同的对手与开局。');
  lines.push('- 黑棋参照用颜色互换复用白棋引擎；互换后它看不到黑棋禁手，因此每个候选都经裁判复核并取排名最高的合法点，替换次数单独统计。');
  lines.push('- benchmark 结果不会包含或写出 `JEV_API_KEY`。');
  lines.push('');
  return lines.join('\n');
}

async function writeReport(report, outputDir) {
  await fs.mkdir(outputDir, { recursive: true });
  const safeTime = report.generatedAt.replace(/[:.]/g, '-');
  const json = JSON.stringify(report, null, 2);
  const markdown = renderMarkdown(report);

  await fs.writeFile(path.join(outputDir, 'latest.json'), json);
  await fs.writeFile(path.join(outputDir, 'latest.md'), markdown);
  await fs.writeFile(path.join(outputDir, safeTime + '.json'), json);
  await fs.writeFile(path.join(outputDir, safeTime + '.md'), markdown);

  return {
    json: path.join(outputDir, 'latest.json'),
    markdown: path.join(outputDir, 'latest.md')
  };
}

function renjuSummary(games) {
  let substitutions = 0;
  let blackDecisions = 0;
  const fouls = [];
  const winReasons = new Map();

  for (const game of games) {
    substitutions += game.forbiddenSubstitutions || 0;
    for (const record of game.decisions) {
      if (record.color === 'B') blackDecisions++;
      if (record.foul) fouls.push({ game: game.opening + '/' + game.arm, ...record.foul });
    }
    if (game.winReason) winReasons.set(game.winReason, (winReasons.get(game.winReason) || 0) + 1);
  }

  return {
    totalForbiddenSubstitutions: substitutions,
    blackDecisions,
    substitutionRate: blackDecisions ? substitutions / blackDecisions : null,
    totalFouls: fouls.length,
    fouls,
    winReasons: [...winReasons.entries()].map(([reason, count]) => ({ reason, count }))
  };
}

// ---------------------------------------------------------------------------
// Smoke test (never calls Jev)
// ---------------------------------------------------------------------------

function positionFromSequence(sequence) {
  const board = Array.from({ length: SIZE }, () => Array(SIZE).fill(EMPTY));
  const moves = [];
  let color = BLACK;
  for (const key of sequence) {
    const point = parseCoord(key);
    board[point.r][point.c] = color;
    moves.push({ r: point.r, c: point.c, color, coord: key, source: 'smoke' });
    color = color === BLACK ? WHITE : BLACK;
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

function boardFromStones({ black = [], white = [] }) {
  const board = Array.from({ length: SIZE }, () => Array(SIZE).fill(EMPTY));
  const moves = [];
  for (const key of black) {
    const point = parseCoord(key);
    board[point.r][point.c] = BLACK;
    moves.push({ r: point.r, c: point.c, color: BLACK, coord: key, source: 'smoke' });
  }
  for (const key of white) {
    const point = parseCoord(key);
    board[point.r][point.c] = WHITE;
    moves.push({ r: point.r, c: point.c, color: WHITE, coord: key, source: 'smoke' });
  }
  return { board, moves };
}

async function runSmoke() {
  const engine = await loadProductionEngine({
    request: async () => {
      throw new Error('Smoke test must not call Jev');
    }
  });
  const referee = new Referee(engine, { model: 'jev-latest', maxPlies: 8 });
  referee.reset(['H8', 'H9']);

  const white = engine.local('expert');
  const whiteVerdict = referee.inspect(white.finalChoice, WHITE);
  if (!whiteVerdict.legal) throw new Error('Local smoke test returned an illegal white move');

  const black = blackReferenceDecision(engine, referee, 'expert');
  const blackVerdict = referee.inspect(black.key, BLACK);
  if (!blackVerdict.legal) throw new Error('Black reference returned an illegal black move');
  if (blackVerdict.forbiddenType) throw new Error('Black reference played a forbidden point');

  // Renju rules must be exactly the ones production enforces.
  const overline = boardFromStones({ black: ['A8', 'B8', 'C8', 'D8', 'F8'] });
  engine.setPosition(overline.board, overline.moves, 'jev-latest');
  const overlineVerdict = engine.judge('E8', BLACK);
  if (!overlineVerdict.forbidden || overlineVerdict.forbiddenType !== 'OVERLINE' || overlineVerdict.winsNow) {
    throw new Error('Smoke test: black overline must be forbidden and must never count as a win');
  }

  const whiteOverline = boardFromStones({ white: ['A8', 'B8', 'C8', 'D8', 'F8'] });
  engine.setPosition(whiteOverline.board, whiteOverline.moves, 'jev-latest');
  const whiteVerdict2 = engine.judge('E8', WHITE);
  if (!whiteVerdict2.legal || !whiteVerdict2.winsNow) {
    throw new Error('Smoke test: white overline must be legal and winning');
  }

  // The pre-Jev Deep Worker is production behaviour: once the opening guard is
  // over, Jev must receive deep-search evidence produced by the worker path.
  const deepEngine = await loadProductionEngine({
    request: async ({ payload }) => {
      const keys = Object.keys(payload?.questions?.best_move?.criteria || {});
      if (!keys.length) throw new Error('Deep-search smoke test received no candidates');
      return {
        model: 'smoke-jev',
        answers: { best_move: oneHotChoice(keys[0], keys) },
        usage: { input_tokens: 0, output_tokens: 0 },
        __client: { attempts: 1, cached: false, transport: 'smoke' }
      };
    }
  });
  // 10 plies: past the opening guard (>=10) with several Local candidates, so
  // the pre-Jev Deep Worker must actually run.
  const sequence = ['H8', 'G7', 'G9', 'I7', 'H7', 'H6', 'J8', 'I5', 'F8', 'I8'];
  const midGame = positionFromSequence(sequence);
  deepEngine.setPosition(midGame.board, midGame.moves, 'jev-latest');
  const midResult = await deepEngine.jevFinal('expert');
  const shape = midResult.decisionTrace?.requestShape || {};
  const deep = midResult.decisionTrace?.preJevDeepSearch || {};
  if (midResult.candidates.length < 2) {
    throw new Error('Smoke test: mid-game position should offer multiple candidates, got ' + midResult.candidates.length);
  }
  if (shape.deepSearchPolicy !== 'pre_jev_worker') {
    throw new Error('Smoke test: mid-game Jev turn must run the deep worker, got ' + shape.deepSearchPolicy);
  }
  if (deep.source !== 'web-worker') {
    throw new Error('Smoke test: deep search must come from the worker, got ' + deep.source);
  }
  if (!['completed', 'timeout'].includes(deep.status)) {
    throw new Error('Smoke test: unexpected deep worker status ' + deep.status);
  }
  if (shape.httpRequests > 1) {
    throw new Error('Smoke test: a white turn must not use more than one Jev request');
  }

  console.log('Benchmark smoke OK: white=' + white.finalChoice
    + ' black=' + black.key
    + ' blackOverline=' + overlineVerdict.forbiddenType
    + ' whiteOverlineWins=' + whiteVerdict2.winsNow
    + ' deepWorker=' + (deep.source || 'n/a') + '/' + (deep.status || 'n/a')
    + ' depth=' + (deep.depthReached ?? 'n/a'));
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  const { values } = parseArgs({
    options: {
      smoke: { type: 'boolean', default: false },
      seeds: { type: 'string', default: '6' },
      openings: { type: 'string' },
      arms: { type: 'string', default: DEFAULT_ARMS.join(',') },
      mode: { type: 'string', default: 'expert' },
      model: { type: 'string', default: 'jev-latest' },
      'max-plies': { type: 'string', default: '60' },
      'delay-ms': { type: 'string', default: '350' },
      'deep-worker': { type: 'string', default: 'thread' },
      'arbitration-depth': { type: 'string', default: '7' },
      'no-arbitration': { type: 'boolean', default: false },
      'mock-jev': { type: 'boolean', default: false },
      output: { type: 'string', default: 'benchmark/results' },
      'confirm-cost': { type: 'boolean', default: false }
    }
  });

  if (values.smoke) {
    await runSmoke();
    return;
  }

  const openingCount = Math.max(1, Math.min(OPENINGS.length, Number(values.openings || values.seeds) || 1));
  const arms = parseArmList(values.arms);
  const maxPlies = Math.max(4, Math.min(SIZE * SIZE, Number(values['max-plies']) || 60));
  const delayMs = Math.max(0, Number(values['delay-ms']) || 0);
  const mode = ['expert', 'grandmaster'].includes(values.mode) ? values.mode : 'expert';
  const model = values.model || 'jev-latest';
  const arbitrationDepth = Math.max(1, Math.min(11, Number(values['arbitration-depth']) || 7));
  const arbitrationBranch = Math.max(2, Math.min(12, Number(values['arbitration-branch']) || 6));
  const arbitration = !values['no-arbitration'];
  const mockJev = values['mock-jev'] === true;
  const deepWorker = values['deep-worker'] === 'sync' ? 'sync' : 'thread';
  const confirmed = values['confirm-cost'] || process.env.BENCHMARK_CONFIRM === '1';
  const apiKey = String(process.env.JEV_API_KEY || '').trim();

  if (!mockJev) {
    if (!confirmed) {
      throw new Error('Benchmark makes paid Jev calls. Re-run with --confirm-cost or BENCHMARK_CONFIRM=1 (or use --mock-jev for an offline pipeline check).');
    }
    if (!apiKey) {
      throw new Error('JEV_API_KEY is required unless --mock-jev is used.');
    }
  }

  let jevRequests = 0;
  const request = mockJev
    ? createMockJev({ onRequest: () => { jevRequests++; } })
    : createTypeSafeRequest({ apiKey, delayMs, onRequest: () => { jevRequests++; } });

  const engine = await loadProductionEngine({ request, deepWorker });

  const openings = OPENINGS.slice(0, openingCount);
  const plans = [];
  for (const opening of openings) {
    for (const arm of arms) plans.push({ opening, arm });
  }

  console.log('Jev Gomoku benchmark — Jev as final decision maker.');
  console.log('Arms: ' + arms.map(arm => ARM_LABELS[arm]).join(' / '));
  console.log('Opponent: Ref Local (production Local + Renju referee filter, colour-swapped to BLACK).');
  console.log('Games: ' + plans.length + ' (' + openingCount + ' opening(s) x ' + arms.length + ' arm(s), max ' + maxPlies + ' plies).');
  console.log(mockJev
    ? 'Jev: offline mock (no API calls, pipeline validation only).'
    : 'Jev: TypeSafe System One. JEV_API_KEY is loaded from the environment and will not be printed or written.');

  const games = [];
  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    const referee = new Referee(engine, { model, maxPlies });
    games.push(await playGame(engine, referee, plan.arm, plan.opening, {
      mode,
      model,
      arbitration,
      arbitrationDepth,
      arbitrationBranch
    }, i + 1, plans.length));
  }

  const summary = summarize(games, arms, { mode });
  const recommendations = generateRecommendations(summary);
  const report = {
    generatedAt: new Date().toISOString(),
    config: {
      arms,
      openingCount,
      openings: openings.map(opening => ({ name: opening.name, moves: opening.moves })),
      mode,
      model,
      maxPlies,
      delayMs,
      arbitration,
      arbitrationDepth,
      arbitrationBranch,
      mockJev,
      deepWorker,
      gamesPlanned: plans.length,
      jevRequests
    },
    summary,
    renju: renjuSummary(games),
    recommendations,
    games
  };

  if (report.renju.totalFouls > 0) {
    console.error('WARNING: ' + report.renju.totalFouls + ' illegal white move(s) were played.');
  }
  const violations = arms.flatMap(arm => summary.arms[arm].violations);
  if (violations.length) {
    console.error('WARNING: ' + violations.length + ' policy contract violation(s) detected.');
  }

  const paths = await writeReport(report, values.output);
  console.log('');
  console.log(renderMarkdown(report));
  console.log('');
  console.log('JSON: ' + paths.json);
  console.log('Markdown: ' + paths.markdown);
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
