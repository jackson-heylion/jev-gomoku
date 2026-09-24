import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createBrowserWorkerClass } from './worker-shim.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function makeClassList() {
  const values = new Set();
  return {
    add(...names) { names.forEach(name => values.add(name)); },
    remove(...names) { names.forEach(name => values.delete(name)); },
    contains(name) { return values.has(name); },
    toggle(name, force) {
      if (force === true) {
        values.add(name);
        return true;
      }
      if (force === false) {
        values.delete(name);
        return false;
      }
      if (values.has(name)) {
        values.delete(name);
        return false;
      }
      values.add(name);
      return true;
    }
  };
}

function makeElement(id = '') {
  const element = {
    id,
    className: '',
    classList: makeClassList(),
    style: {},
    textContent: '',
    innerHTML: '',
    value: '',
    disabled: false,
    width: 0,
    height: 0,
    addEventListener() {},
    removeEventListener() {},
    setAttribute(name, value) { this[name] = value; },
    removeAttribute(name) { delete this[name]; },
    focus() {},
    appendChild() {},
    remove() {},
    select() {},
    getBoundingClientRect() {
      return { left: 0, top: 0, width: this.width || 760, height: this.height || 760 };
    }
  };
  return element;
}

function makeCanvas() {
  const canvas = makeElement('board');
  canvas.width = 760;
  canvas.height = 760;
  const gradient = { addColorStop() {} };
  const context = {
    clearRect() {},
    fillRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    fillText() {},
    arc() {},
    fill() {},
    save() {},
    restore() {},
    createLinearGradient() { return gradient; },
    createRadialGradient() { return gradient; },
    set fillStyle(_) {},
    set strokeStyle(_) {},
    set lineWidth(_) {},
    set font(_) {},
    set textAlign(_) {},
    set textBaseline(_) {},
    set shadowColor(_) {},
    set shadowBlur(_) {},
    set shadowOffsetY(_) {}
  };
  canvas.getContext = () => context;
  return canvas;
}

function makeDocument() {
  const elements = new Map();
  const board = makeCanvas();
  elements.set('board', board);

  const document = {
    body: {
      appendChild() {}
    },
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement(id));
      return elements.get(id);
    },
    querySelectorAll() {
      return [];
    },
    addEventListener() {},
    removeEventListener() {},
    createElement(tag) {
      return makeElement(tag);
    },
    execCommand() {
      return true;
    }
  };
  return document;
}

function makeLocalStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    }
  };
}

/**
 * The benchmark only ever asks the production engine questions that the page
 * itself asks. Every helper below delegates to production code; nothing
 * re-implements search, tactical analysis or Renju rules.
 */
function injectBenchmarkHook(source) {
  const marker = '\n})();';
  const index = source.lastIndexOf(marker);
  if (index < 0) throw new Error('Unable to locate app.js IIFE terminator');

  const hook = [
    '',
    '  globalThis.__JEV_GOMOKU_BENCH__ = {',
    '    setPosition(nextBoard, nextMoves, model, side) {',
    '      board = nextBoard.map(row => row.slice());',
    '      moves = (nextMoves || []).map(move => ({ ...move }));',
    '      current = side === BLACK || side === 1 ? BLACK : WHITE;',
    '      gameOver = false;',
    '      gameStarted = true;',
    '      thinking = false;',
    '      requestController = null;',
    '      lastJev = null;',
    '      jevDecisionLog = [];',
    '      gameResult = null;',
    "      settings.model = model || 'jev-latest';",
    "      settings.strengthMode = 'expert';",
    '    },',
    '    setGameConfig(config) {',
    '      const next = config || {};',
    "      settings.playerColor = next.playerColor === 'white' ? 'white' : 'black';",
    '      settings.forbidOverline = next.overline !== false;',
    '      settings.forbidFourFour = next.fourFour !== false;',
    '      settings.forbidThreeThree = next.threeThree !== false;',
    '      gameStarted = true;',
    '      return {',
    '        playerColor: settings.playerColor,',
    '        aiColor: aiColor(),',
    '        rules: activeRuleConfig()',
    '      };',
    '    },',
    '    gameConfig() {',
    '      return {',
    '        playerColor: settings.playerColor,',
    '        aiColor: aiColor(),',
    '        rules: activeRuleConfig()',
    '      };',
    '    },',
    '    position() {',
    '      return {',
    '        board: board.map(row => row.slice()),',
    '        moves: moves.map(move => ({ ...move })),',
    '        toMove: current',
    '      };',
    '    },',
    // --- decision entry points (the real product paths) ---------------------
    "    local(mode) { return localOnlyDecision(mode || 'expert'); },",
    "    jevFinal(mode) { return advancedDecision(mode || 'expert'); },",
    "    jevMax() { return jevMaxDecision(); },",
    "    normalizeDeepRow(row, analysis) { return deepRowForJev(row, analysis); },",
    "    maxAtomicPayload(mode) { const context = buildAdvancedCandidates(mode || 'max'); return buildMaxAtomicPayload(context, context.candidates); },",
    "    maxPairwisePayload(mode) { const context = buildAdvancedCandidates(mode || 'max'); const candidates = context.candidates.slice(0, 4); return buildPairwisePayload(candidates); },",
    "    maxSpeculativePayload(mode) { const context = buildAdvancedCandidates(mode || 'max'); const candidates = context.candidates; const pool = candidates.slice(0, Math.min(6, candidates.length)); return buildMaxSpeculativePayload(context, candidates, pool, extraWildcardPool(candidates, 12, new Set())).payload; },",
    "    maxDeepDominance(mode, deepAnalysis) { const context = buildAdvancedCandidates(mode || 'max'); const candidates = context.candidates; candidates.forEach((move, index) => { move.localRank = move.rank ?? index + 1; }); attachMaxDeepEvidence(candidates, deepAnalysis); const result = applyMaxDeepDominance(candidates, deepAnalysis); return { ...result, candidates: result.candidates.map(move => move.key) }; },",
    "    async maxSemanticOverrideGuard(localKey, semanticKey) { const context = buildAdvancedCandidates('max'); const candidates = context.candidates; const local = candidates.find(move => move.key === localKey); const semantic = candidates.find(move => move.key === semanticKey); if (!local || !semantic) throw new Error('Override-guard candidate missing'); const original = context.candidates; context.candidates = [local, ...original.filter(move => move.key !== local.key)]; return runMaxSemanticOverrideGuard(context, candidates, semantic); },",
    "    deepAnalyze(keys, mode, overrides) {",
    "      const candidates = (keys || []).map(key => { const point = parseCoord(key); return point ? { ...point, key } : null; }).filter(Boolean);",
    "      return runDeepWorkerVerification(candidates, mode || 'grandmaster', 'regression_position', overrides || {});",
    "    },",
    "    threatAnalyze(keys, mode, overrides) {",
    "      const candidates = (keys || []).map(key => { const point = parseCoord(key); return point ? { ...point, key } : null; }).filter(Boolean);",
    "      return runThreatWorkerAnalysis(candidates, mode || 'max', 'regression_position', overrides || {});",
    "    },",
    '    async jevBlind() {',
    '      const decision = buildPureJevRequest();',
    '      const data = await callJev(decision.payload);',
    '      const answer = data && data.answers ? data.answers.best_move : null;',
    "      if (!answer || typeof answer.choice !== 'string') throw new Error('Jev response missing answers.best_move.choice');",
    '      const finalChoice = answer.choice.toUpperCase();',
    '      const candidateKeys = new Set(decision.candidates.map(move => move.key));',
    "      if (!candidateKeys.has(finalChoice)) throw new Error('Jev returned illegal candidate: ' + answer.choice);",
    '      return {',
    '        answer,',
    '        finalChoice,',
    '        localChoice: null,',
    '        jevSuggested: finalChoice,',
    "        mode: 'jev-blind',",
    '        forced: null,',
    '        candidates: decision.candidates,',
    '        model: data.model || settings.model,',
    '        usage: data.usage || null,',
    '        client: data.__client || null,',
    '        decisionTrace: { requestShape: { decisionAuthority: \'jev_blind\', candidateCount: decision.candidates.length } },',
    "        stageNote: 'Jev 直接读取棋盘（诊断用基线，候选集为全部合法点）'",
    '      };',
    '    },',
    "    candidates(mode) { return buildAdvancedCandidates(mode || 'expert'); },",
    // --- referee support: Renju rules straight from production --------------
    '    judge(key, color) {',
    '      const point = parseCoord(key);',
    "      if (!point) throw new Error('Invalid coordinate: ' + key);",
    '      const target = color === BLACK || color === \'black\' ? BLACK : WHITE;',
    '      const empty = board[point.r][point.c] === EMPTY;',
    '      const info = target === BLACK',
    '        ? blackForbiddenInfo(point.r, point.c)',
    '        : { forbidden: !empty, type: empty ? null : \'OCCUPIED\', winningFive: false };',
    '      let winsNow = false;',
    '      let overline = false;',
    '      let exactFive = false;',
    '      if (empty) {',
    '        board[point.r][point.c] = target;',
    '        winsNow = isWin(point.r, point.c, target);',
    '        overline = hasOverlineAt(point.r, point.c, target);',
    '        exactFive = hasExactFiveAt(point.r, point.c, target);',
    '        board[point.r][point.c] = EMPTY;',
    '      }',
    '      return {',
    '        key: coord(point.r, point.c),',
    "        color: target === BLACK ? 'black' : 'white',",
    '        empty,',
    '        forbidden: Boolean(info.forbidden),',
    '        forbiddenType: info.type || null,',
    '        winningFive: Boolean(info.winningFive),',
    '        winsNow,',
    '        overline,',
    '        exactFive,',
    '        legal: empty && !info.forbidden',
    '      };',
    '    },',
    "    forbidden(key) {",
    "      const point = parseCoord(key);",
    "      if (!point) throw new Error('Invalid forbidden-test coordinate');",
    "      return blackForbiddenInfo(point.r, point.c);",
    '    },',
    "    legalBlackMoves() { return legalMoves(BLACK).map(move => move.key); },",
    "    orderedBlack(limit) { return orderedMoves(BLACK, limit || 64, 2).map(move => move.key); },",
    '    immediateWinsFor(color) {',
    '      const target = color === BLACK || color === \'black\' ? BLACK : WHITE;',
    '      return immediateWins(target, 2).map(move => move.key);',
    '    },',
    // --- offline oracle: deeper deterministic comparison, never used in game
    '    arbitrate(aKey, bKey, options) {',
    '      const opts = options || {};',
    "      const preset = ENGINE_PRESETS[opts.mode === 'grandmaster' ? 'grandmaster' : 'expert'];",
    '      const cfg = {',
    '        ...preset,',
    '        depth: Number.isFinite(opts.depth) ? opts.depth : preset.depth + 2,',
    '        branch: Number.isFinite(opts.branch) ? opts.branch : 6,',
    '        vcfDepth: Number.isFinite(opts.vcfDepth) ? opts.vcfDepth : preset.vcfDepth,',
    '        vctDepth: Number.isFinite(opts.vctDepth) ? opts.vctDepth : preset.vctDepth',
    '      };',
    '      const cache = new Map();',
    '      const evaluate = key => {',
    '        const point = parseCoord(key);',
    "        if (!point) throw new Error('Invalid arbitration coordinate: ' + key);",
    '        const move = { ...point, key };',
    '        const analysis = analyzeAdvancedCandidate(move, null, cfg);',
    '        return {',
    '          move,',
    '          searchScore: scoreRootMove(move, cfg, cache),',
    '          safetyRank: safetyRank(analysis),',
    '          winsNow: analysis.winsNow,',
    '          vcf: analysis.vcf,',
    '          vct: analysis.vct,',
    '          facts: analysis.facts',
    '        };',
    '      };',
    '      const first = evaluate(aKey);',
    '      const second = evaluate(bKey);',
    '      let verdict;',
    '      if (first.safetyRank !== second.safetyRank) {',
    '        verdict = first.safetyRank > second.safetyRank ? \'a\' : \'b\';',
    '      } else if (first.searchScore !== second.searchScore) {',
    '        verdict = first.searchScore > second.searchScore ? \'a\' : \'b\';',
    '      } else {',
    '        verdict = \'tie\';',
    '      }',
    '      return {',
    '        config: { depth: cfg.depth, branch: cfg.branch, vcfDepth: cfg.vcfDepth, vctDepth: cfg.vctDepth },',
    '        a: { move: aKey, searchScore: first.searchScore, safetyRank: first.safetyRank, winsNow: first.winsNow, vcf: first.vcf },',
    '        b: { move: bKey, searchScore: second.searchScore, safetyRank: second.safetyRank, winsNow: second.winsNow, vcf: second.vcf },',
    '        verdict',
    '      };',
    '    },',
    "    deepRank(mode) {",
    "      const engineMode = mode || 'expert';",
    "      const context = buildAdvancedCandidates(engineMode);",
    "      const cfg = challengerVerificationConfig(engineMode);",
    "      const cache = new Map();",
    "      return context.candidates.map(move => ({",
    "        move: move.key,",
    "        shallowScore: move.searchScore,",
    "        deepScore: scoreRootMove(move, cfg, cache),",
    "        safety: move.analysis?.facts?.tactical_safety || null,",
    "        facts: { ...(move.analysis?.facts || {}) }",
    "      })).sort((a, b) => b.deepScore - a.deepScore);",
    "    },",
    // These two helpers exist for the "undo after game over" regression: they
    // drive the page's own turn state instead of re-implementing it.
    "    setTurnState(color, ended) { current = color; gameOver = Boolean(ended); },",
    "    undoTurn() {",
    "      undo();",
    "      return {",
    "        current,",
    "        gameOver,",
    "        moves: moves.map(move => ({ ...move })),",
    "        board: board.map(row => row.slice())",
    "      };",
    "    }",
    '  };',
    ''
  ].join('\n');

  return source.slice(0, index) + hook + source.slice(index);
}

/**
 * Load the real production engine (`src/app.js`) inside a DOM-less VM sandbox.
 *
 * @param {object} options
 * @param {Function} options.request  Jev request function (or a mock).
 * @param {string}   [options.appPath]
 * @param {'thread'|'sync'} [options.deepWorker='thread']
 *   'thread' injects a browser-like Worker backed by node:worker_threads, so the
 *   time-budgeted `public/deep-worker.js` path is exercised exactly like the
 *   page does. 'sync' omits Worker and uses the engine's own synchronous
 *   fallback (slower, unbounded, not what production runs).
 */
export async function loadProductionEngine({ request, appPath, deepWorker = 'thread' } = {}) {
  if (typeof request !== 'function') throw new Error('loadProductionEngine requires a Jev request function');

  const resolvedAppPath = appPath || path.join(ROOT, 'src', 'app.js');
  const source = await fs.readFile(resolvedAppPath, 'utf8');
  const transformed = injectBenchmarkHook(source);
  const document = makeDocument();
  const localStorage = makeLocalStorage();

  const sandbox = {
    console,
    document,
    localStorage,
    navigator: {
      clipboard: {
        async writeText() {}
      }
    },
    performance,
    AbortController,
    TextEncoder,
    setTimeout,
    clearTimeout,
    setInterval() { return 0; },
    clearInterval() {},
    window: {
      JevClient: {
        request
      }
    }
  };

  const deepWorkerMode = deepWorker === 'sync' ? 'sync' : 'thread';
  if (deepWorkerMode === 'thread') {
    sandbox.Worker = createBrowserWorkerClass();
  }

  const context = vm.createContext(sandbox);
  vm.runInContext(transformed, context, {
    filename: resolvedAppPath,
    timeout: 10000
  });

  const engine = context.__JEV_GOMOKU_BENCH__;
  if (!engine
    || typeof engine.local !== 'function'
    || typeof engine.jevFinal !== 'function'
    || typeof engine.jevMax !== 'function'
    || typeof engine.judge !== 'function') {
    throw new Error('Benchmark hook was not initialized from src/app.js');
  }
  engine.deepWorkerMode = deepWorkerMode;
  return engine;
}
