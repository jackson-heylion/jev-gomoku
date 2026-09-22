import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

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

function injectBenchmarkHook(source) {
  const marker = '\n})();';
  const index = source.lastIndexOf(marker);
  if (index < 0) throw new Error('Unable to locate app.js IIFE terminator');

  const hook = [
    '',
    '  globalThis.__JEV_GOMOKU_BENCH__ = {',
    '    setPosition(nextBoard, nextMoves, model) {',
    '      board = nextBoard.map(row => row.slice());',
    '      moves = (nextMoves || []).map(move => ({ ...move }));',
    '      current = WHITE;',
    '      gameOver = false;',
    '      thinking = false;',
    '      requestController = null;',
    '      lastJev = null;',
    '      jevDecisionLog = [];',
    '      gameResult = null;',
    "      settings.model = model || 'jev-latest';",
    "      settings.strengthMode = 'expert';",
    '    },',
    "    local(mode) { return localOnlyDecision(mode || 'expert'); },",
    "    hybrid(mode) { return advancedDecision(mode || 'expert'); },",
    "    verifyMoves(localKey, challengerKey, mode) {",
    "      const local = parseCoord(localKey);",
    "      const challenger = parseCoord(challengerKey);",
    "      if (!local || !challenger) throw new Error('Invalid verification coordinate');",
    "      return deepVerifyChallenger({ ...local, key: localKey }, { ...challenger, key: challengerKey }, mode || 'expert');",
    "    },",
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
    '    async blind() {',
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
    '        jevSuggested: finalChoice,',
    "        mode: 'jev',",
    '        forced: null,',
    '        candidates: decision.candidates,',
    '        model: data.model || settings.model,',
    '        usage: data.usage || null,',
    '        client: data.__client || null,',
    '        decisionTrace: { pureJev: compactAnswer(answer) },',
    "        stageNote: 'Jev Blind benchmark'",
    '      };',
    '    },',
    '    candidates(mode) { return buildAdvancedCandidates(mode || \'expert\'); }',
    '  };',
    ''
  ].join('\n');

  return source.slice(0, index) + hook + source.slice(index);
}

export async function loadProductionEngine({ request, appPath } = {}) {
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

  const context = vm.createContext(sandbox);
  vm.runInContext(transformed, context, {
    filename: resolvedAppPath,
    timeout: 5000
  });

  const engine = context.__JEV_GOMOKU_BENCH__;
  if (!engine || typeof engine.local !== 'function' || typeof engine.hybrid !== 'function') {
    throw new Error('Benchmark hook was not initialized from src/app.js');
  }
  return engine;
}
