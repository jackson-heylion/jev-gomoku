(() => {
  'use strict';

  const TIMEOUT_SCALE = 2;
  const SIZE = 15;
  const COLS = 'ABCDEFGHIJKLMNO'.split('');
  const EMPTY = 0, BLACK = 1, WHITE = 2;

  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const turnText = document.getElementById('turnText');
  const turnHint = document.getElementById('turnHint');
  const turnClockLabel = document.getElementById('turnClockLabel');
  const turnClockValue = document.getElementById('turnClockValue');
  const gameMeta = document.getElementById('gameMeta');
  const lastMoveText = document.getElementById('lastMoveText');
  const historyEl = document.getElementById('history');
  const apiIndicator = document.getElementById('apiIndicator');
  const apiLabel = document.getElementById('apiLabel');
  const apiPhase = document.getElementById('apiPhase');
  const levelBadge = document.getElementById('levelBadge');
  const levelSummary = document.getElementById('levelSummary');
  const jevLiveState = document.getElementById('jevLiveState');
  const lastThinkDuration = document.getElementById('lastThinkDuration');
  const jevMove = document.getElementById('jevMove');
  const jevDecisionLabel = document.getElementById('jevDecisionLabel');
  const jevVerdict = document.getElementById('jevVerdict');
  const jevInfo = document.getElementById('jevInfo');
  const confidenceBar = document.getElementById('confidenceBar');
  const confidenceText = document.getElementById('confidenceText');
  const alternativesTitle = document.getElementById('alternativesTitle');
  const alternatives = document.getElementById('alternatives');
  const retryBtn = document.getElementById('retryBtn');
  const copyRecordBtn = document.getElementById('copyRecordBtn');
  const toastEl = document.getElementById('toast');

  const resultModal = document.getElementById('resultModal');
  const resultIcon = document.getElementById('resultIcon');
  const resultTitle = document.getElementById('resultTitle');
  const resultDesc = document.getElementById('resultDesc');
  const resultStats = document.getElementById('resultStats');
  const resultSummary = document.getElementById('resultSummary');
  const resultCloseBtn = document.getElementById('resultCloseBtn');
  const resultCopyBtn = document.getElementById('resultCopyBtn');
  const resultRestartBtn = document.getElementById('resultRestartBtn');

  const settingsModal = document.getElementById('settingsModal');
  const modelInput = document.getElementById('model');
  const strengthModeInput = document.getElementById('strengthMode');
  const levelOptionButtons = [...document.querySelectorAll('.level-option')];
  const currentLevelSummary = document.getElementById('currentLevelSummary');
  const testConnectionBtn = document.getElementById('testConnectionBtn');
  const connectionTest = document.getElementById('connectionTest');
  const connectionTestText = document.getElementById('connectionTestText');
  const sideOptionButtons = [...document.querySelectorAll('.side-option')];
  const ruleOverlineInput = document.getElementById('ruleOverline');
  const ruleFourFourInput = document.getElementById('ruleFourFour');
  const ruleThreeThreeInput = document.getElementById('ruleThreeThree');
  const gameConfigSummary = document.getElementById('gameConfigSummary');
  const easterEggProgress = document.getElementById('easterEggProgress');
  const ruleHint = document.getElementById('ruleHint');
  const runtimeRulesHint = document.getElementById('runtimeRulesHint');

  let board = makeBoard();
  let current = BLACK;
  let moves = [];
  let gameOver = false;
  let thinking = false;
  let requestController = null;
  let toastTimer = null;
  let lastJev = null;
  let jevDecisionLog = [];
  let testController = null;
  let gameResult = null;
  let gameStartedAt = new Date();
  let turnStartedAt = performance.now();
  let thinkingStartedAt = null;
  let lastThinkMs = null;
  let gameSeed = createGameSeed();
  let gameStarted = false;
  let browserLongTaskCount = null;
  let gameEggs = new Set();
  let undoCount = 0;
  let copyCount = 0;
  let openingSaved = false;
  let pendingHumanThreat = null;
  let missedDefensePendingWin = false;
  let jevWasInDanger = false;
  let jevBlockStreak = 0;
  let thinkEgg20 = false;
  let thinkEgg40 = false;
  let maxBadgeTimer = null;

  if (typeof PerformanceObserver !== 'undefined') {
    try {
      browserLongTaskCount = 0;
      const longTaskObserver = new PerformanceObserver(list => {
        browserLongTaskCount += list.getEntries().length;
      });
      longTaskObserver.observe({ entryTypes: ['longtask'] });
    } catch (_) {
      browserLongTaskCount = null;
    }
  }

  const settings = loadSettings();
  modelInput.value = settings.model;
  strengthModeInput.value = settings.strengthMode;

  const EASTER_UNLOCK_KEY = 'jev_gomoku_easter_eggs_v1';
  const OPENING_HISTORY_KEY = 'jev_gomoku_opening_history_v1';
  const EASTER_EGG_META = Object.freeze({
    center_opening: { label: '天元执念' },
    lightning: { label: '闪电战' },
    straight_win: { label: '直线狂魔' },
    straight_blocked: { label: '意图已读' },
    jev_miss: { label: 'Jev 看漏了' },
    comeback: { label: '绝地求生' },
    familiar_opening: { label: '你被研究了' },
    copy_3: { label: '复制狂魔' },
    copy_5: { label: '棋谱背诵者' },
    undo_3: { label: '时间线波动' },
    undo_6: { label: '平行棋局' },
    undo_overload: { label: '悔棋过多' },
    undo_multiverse: { label: '多元宇宙' },
    long_think_20: { label: '深度沉思' },
    long_think_40: { label: '超长沉思' },
    forced_chain: { label: '强制变化' },
    center_universe: { label: '正中央宇宙' },
    edge_artist: { label: '边角艺术家' },
    perfect_defense: { label: '完美封杀' },
    changed_mind: { label: '概率嘴硬' },
    max_true_form: { label: 'MAX 真身' }
  });
  const unlockedEasterEggs = loadUnlockedEasterEggs();

  function readStoredArray(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(value) ? value : [];
    } catch (_) {
      return [];
    }
  }

  function loadUnlockedEasterEggs() {
    return new Set(readStoredArray(EASTER_UNLOCK_KEY).filter(id => EASTER_EGG_META[id]));
  }

  function persistUnlockedEasterEggs() {
    try {
      localStorage.setItem(EASTER_UNLOCK_KEY, JSON.stringify([...unlockedEasterEggs]));
    } catch (_) {}
  }

  function updateEasterProgress() {
    if (!easterEggProgress) return;
    const count = unlockedEasterEggs.size;
    easterEggProgress.hidden = count === 0;
    easterEggProgress.textContent = `彩蛋 ${count} / ??`;
  }

  function triggerEasterEgg(id, message, options = {}) {
    if (!EASTER_EGG_META[id] || gameEggs.has(id)) return false;
    gameEggs.add(id);
    if (!unlockedEasterEggs.has(id)) {
      unlockedEasterEggs.add(id);
      persistUnlockedEasterEggs();
    }
    updateEasterProgress();
    if (gameOver && gameResult && resultSummary) {
      resultSummary.textContent = buildGameSummary(gameResult.winner);
    }
    if (options.toast !== false) toast(`彩蛋 · ${message}`, options.duration || 3600);
    return true;
  }

  function gameEggLabels() {
    return [...new Set([...gameEggs].map(id => EASTER_EGG_META[id]?.label).filter(Boolean))];
  }

  function playerMovesInGame() {
    return moves.filter(move => move.color === playerColor());
  }

  function sameMoveLine(items) {
    if (!Array.isArray(items) || items.length < 4) return false;
    const rows = new Set(items.map(move => move.r));
    const cols = new Set(items.map(move => move.c));
    const diag = new Set(items.map(move => move.r - move.c));
    const anti = new Set(items.map(move => move.r + move.c));
    return rows.size === 1 || cols.size === 1 || diag.size === 1 || anti.size === 1;
  }

  function isCenterFive(move) {
    return move && move.r >= 5 && move.r <= 9 && move.c >= 5 && move.c <= 9;
  }

  function isEdgeZone(move) {
    if (!move) return false;
    return Math.min(move.r, move.c, SIZE - 1 - move.r, SIZE - 1 - move.c) <= 2;
  }

  function openingsSimilar(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length < 4 || b.length < 4) return false;
    let close = 0;
    for (let i = 0; i < 4; i++) {
      const x = parseCoord(a[i]);
      const y = parseCoord(b[i]);
      if (x && y && Math.max(Math.abs(x.r - y.r), Math.abs(x.c - y.c)) <= 1) close++;
    }
    return close >= 3;
  }

  function maybeRecognizeOpening() {
    const opening = playerMovesInGame().slice(0, 4).map(move => move.coord);
    if (opening.length !== 4) return;
    const history = readStoredArray(OPENING_HISTORY_KEY).filter(item => Array.isArray(item) && item.length >= 4);
    if (history.length >= 3 && history.slice(-3).every(previous => openingsSimilar(previous, opening))) {
      triggerEasterEgg('familiar_opening', '这个开局……Jev 好像见过。');
    }
  }

  function saveOpeningHistory() {
    if (openingSaved) return;
    const opening = playerMovesInGame().slice(0, 4).map(move => move.coord);
    if (opening.length < 4) return;
    openingSaved = true;
    const history = readStoredArray(OPENING_HISTORY_KEY)
      .filter(item => Array.isArray(item) && item.length >= 4)
      .slice(-7);
    history.push(opening);
    try {
      localStorage.setItem(OPENING_HISTORY_KEY, JSON.stringify(history));
    } catch (_) {}
  }

  function trackPlacedMoveEasterEggs(move) {
    if (!move) return;
    if (move.color === playerColor()) {
      const humanMoves = playerMovesInGame();
      if (humanMoves.length === 1 && move.coord === 'H8') {
        triggerEasterEgg('center_opening', '天元开局。Jev 似乎认真了一点。');
      }
      if (humanMoves.length === 4) maybeRecognizeOpening();
      if (humanMoves.length === 5 && humanMoves.every(isEdgeZone)) {
        triggerEasterEgg('edge_artist', '你对棋盘中央似乎没有兴趣。');
      }
    }

    if (moves.length === 8 && moves.every(isCenterFive)) {
      triggerEasterEgg('center_universe', '整个宇宙暂时只有中央这 25 个点。');
      canvas.classList.add('easter-pulse');
      setTimeout(() => canvas.classList.remove('easter-pulse'), 1200);
    }
  }

  function prepareHumanThreatForAi() {
    const humanMoves = playerMovesInGame();
    if (humanMoves.length < 4) {
      pendingHumanThreat = null;
      return;
    }
    const threats = immediateWins(playerColor(), 2);
    pendingHumanThreat = threats.length
      ? {
          points: threats.map(move => move.key),
          straight: sameMoveLine(humanMoves.slice(-4))
        }
      : null;
    if (threats.length) jevWasInDanger = true;
  }

  function resolveHumanThreatAfterAiMove(aiMove) {
    if (!pendingHumanThreat) {
      jevBlockStreak = 0;
      missedDefensePendingWin = false;
      return;
    }

    const remaining = immediateWins(playerColor(), 2);
    const blocked = pendingHumanThreat.points.includes(aiMove) && remaining.length === 0;
    if (blocked) {
      jevBlockStreak++;
      missedDefensePendingWin = false;
      if (pendingHumanThreat.straight) {
        triggerEasterEgg('straight_blocked', 'Jev：这个我还是看得见的。');
      }
      if (jevBlockStreak >= 3) {
        triggerEasterEgg('perfect_defense', '防守模式：已读。连续三次直接威胁都被 Jev 挡住了。');
      }
    } else {
      jevBlockStreak = 0;
      missedDefensePendingWin = remaining.length > 0;
    }
    pendingHumanThreat = null;
  }

  function afterJevDecisionEasterEggs(result) {
    const finalChoice = result?.finalChoice || result?.answer?.choice;
    const probabilities = result?.answer?.probabilities;
    if (finalChoice && probabilities && typeof probabilities === 'object') {
      const top = Object.entries(probabilities)
        .filter(([, probability]) => Number.isFinite(Number(probability)))
        .sort((a, b) => Number(b[1]) - Number(a[1]))[0];
      if (top && top[0] !== finalChoice) {
        triggerEasterEgg('changed_mind', `Jev 最后改变了主意：${top[0]} → ${finalChoice}。`);
      }
    } else if (result?.jevSuggested && finalChoice && result.jevSuggested !== finalChoice) {
      triggerEasterEgg('changed_mind', `Jev 最后改变了主意：${result.jevSuggested} → ${finalChoice}。`);
    }

    let forcedTail = 0;
    for (let i = jevDecisionLog.length - 1; i >= 0 && jevDecisionLog[i]?.forced; i--) forcedTail++;
    if (forcedTail >= 3) {
      triggerEasterEgg('forced_chain', `连续 ${forcedTail} 个 Jev 回合进入强制战术变化。`);
    }
  }

  function prepareFinishEasterEggs(winner) {
    if (moves.length <= 9) {
      triggerEasterEgg('lightning', '闪电战：这局结束得比完整分析流程还快。', { toast: false });
    }

    if (winner === playerColor()) {
      if (sameMoveLine(playerMovesInGame().slice(-5))) {
        triggerEasterEgg('straight_win', '你甚至没有掩饰自己的意图。', { toast: false });
      }
      if (missedDefensePendingWin) {
        triggerEasterEgg('jev_miss', '上一回合仍存在直接防守点，但 Jev 没有处理掉。', { toast: false });
      }
    } else if (winner === aiColor() && jevWasInDanger) {
      triggerEasterEgg('comeback', 'Jev 曾进入直接失分危险，但最终完成翻盘。', { toast: false });
    }

    saveOpeningHistory();
  }

  function makeBoard() {
    return Array.from({ length: SIZE }, () => Array(SIZE).fill(EMPTY));
  }

  function storedBool(key, fallback = true) {
    const value = localStorage.getItem(key);
    if (value == null) return fallback;
    return value !== 'false';
  }

  function playerColor() {
    return settings.playerColor === 'white' ? WHITE : BLACK;
  }

  function aiColor() {
    return playerColor() === BLACK ? WHITE : BLACK;
  }

  function colorNameZh(color) {
    return color === BLACK ? '黑棋' : '白棋';
  }

  function colorNameEn(color) {
    return color === BLACK ? 'BLACK' : 'WHITE';
  }

  function colorStoneEn(color) {
    return color === BLACK ? 'X' : 'O';
  }

  function boardLegendForAi() {
    const ai = aiColor();
    const opponent = otherColor(ai);
    return `${colorStoneEn(ai)}=${colorNameEn(ai)} you, ${colorStoneEn(opponent)}=${colorNameEn(opponent)} opponent, .=empty`;
  }

  function colorShortZh(color) {
    return color === BLACK ? '黑' : '白';
  }

  function colorCss(color) {
    return color === BLACK ? 'black' : 'white';
  }

  function activeRuleConfig() {
    return {
      overline: settings.forbidOverline !== false,
      fourFour: settings.forbidFourFour !== false,
      threeThree: settings.forbidThreeThree !== false
    };
  }

  function enabledForbiddenLabels() {
    const rules = activeRuleConfig();
    return [
      rules.overline && '长连',
      rules.fourFour && '四四',
      rules.threeThree && '三三'
    ].filter(Boolean);
  }

  function ruleSummaryText() {
    const enabled = enabledForbiddenLabels();
    const blackWin = activeRuleConfig().overline ? '黑棋恰好五连胜' : '黑棋五连及以上胜';
    return `你执${colorShortZh(playerColor())}${playerColor() === BLACK ? '先手' : '后手'} · 黑棋禁手：${enabled.length ? enabled.join(' / ') : '关闭'} · ${blackWin}`;
  }

  function renjuRuleDescription() {
    const rules = activeRuleConfig();
    const enabled = enabledForbiddenLabels();
    const blackWin = rules.overline
      ? 'BLACK wins only with an exact five; an overline is illegal.'
      : 'BLACK wins with five or more in a row; overline is legal.';
    const forbidden = enabled.length
      ? `BLACK forbidden moves enabled: ${enabled.join(', ')}.`
      : 'BLACK forbidden moves are disabled.';
    return `${forbidden} ${blackWin} WHITE has no forbidden moves and wins with five or more in a row.`;
  }

  function workerRuleConfig() {
    return { ...activeRuleConfig() };
  }

  function hashSeed32(text) {
    let h = 2166136261 >>> 0;
    const value = String(text || '');
    for (let i = 0; i < value.length; i++) {
      h ^= value.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function createGameSeed() {
    const override = Number(globalThis.__JEV_GOMOKU_GAME_SEED__);
    if (Number.isInteger(override)) return override >>> 0;

    const cryptoApi = typeof window !== 'undefined' ? window.crypto : null;
    if (cryptoApi?.getRandomValues) {
      const values = new Uint32Array(1);
      cryptoApi.getRandomValues(values);
      return values[0] >>> 0;
    }

    // Headless benchmark environments intentionally omit browser crypto.
    // Keep them deterministic so regression results stay reproducible.
    return 0x6d2b79f5;
  }

  function mulberry32(seed) {
    let value = seed >>> 0;
    return () => {
      value = (value + 0x6d2b79f5) >>> 0;
      let t = value;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function seededPositionRandom(label = '') {
    let material = `${gameSeed}|${moves.length}|${label}|`;
    for (let r = 0; r < SIZE; r++) material += board[r].join('');
    return mulberry32(hashSeed32(material));
  }

  function formatElapsed(ms) {
    const seconds = Math.max(0, Number(ms) || 0) / 1000;
    if (seconds < 60) return `${seconds.toFixed(1)} 秒`;
    const minutes = Math.floor(seconds / 60);
    const remain = Math.floor(seconds % 60);
    return `${minutes} 分 ${String(remain).padStart(2, '0')} 秒`;
  }

  function formatElapsedCompact(ms) {
    const seconds = Math.max(0, Number(ms) || 0) / 1000;
    return seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
  }

  function resetTurnClock() {
    turnStartedAt = performance.now();
    refreshTurnClock();
  }

  function beginThinkingClock() {
    thinkingStartedAt = performance.now();
    turnStartedAt = thinkingStartedAt;
    thinkEgg20 = false;
    thinkEgg40 = false;
    refreshTurnClock();
  }

  function captureThinkingDuration(result = null) {
    if (thinkingStartedAt == null) return lastThinkMs;
    const elapsed = Math.max(0, performance.now() - thinkingStartedAt);
    lastThinkMs = elapsed;
    if (result && typeof result === 'object') result.thinkDurationMs = Math.round(elapsed);
    lastThinkDuration.textContent = formatElapsed(elapsed);
    return elapsed;
  }

  function refreshTurnClock() {
    if (!gameStarted) {
      turnClockLabel.textContent = '对局状态';
      turnClockValue.textContent = '等待开局';
      return;
    }
    if (gameOver) {
      turnClockLabel.textContent = '对局状态';
      turnClockValue.textContent = '已结束';
      return;
    }

    const now = performance.now();
    if (thinking) {
      const started = thinkingStartedAt ?? turnStartedAt;
      const elapsed = Math.max(0, now - started);
      turnClockLabel.textContent = 'Jev 已思考';
      turnClockValue.textContent = formatElapsed(elapsed);
      if (elapsed >= 20000 && !thinkEgg20) {
        thinkEgg20 = true;
        triggerEasterEgg('long_think_20', 'Jev 正在怀疑上一轮计算。');
        apiPhase.textContent = 'Jev 正在怀疑上一轮计算。';
      }
      if (elapsed >= 40000 && !thinkEgg40) {
        thinkEgg40 = true;
        triggerEasterEgg('long_think_40', '它最好是真的算到了什么。');
        apiPhase.textContent = '它最好是真的算到了什么。';
      }
      return;
    }

    if (current === playerColor()) {
      turnClockLabel.textContent = '你已思考';
      turnClockValue.textContent = formatElapsed(now - turnStartedAt);
      return;
    }
    turnClockLabel.textContent = '等待 Jev';
    turnClockValue.textContent = formatElapsed(now - turnStartedAt);
  }

  function loadSettings() {
    const player = localStorage.getItem('jev_gomoku_player_color');
    const storedStrength = localStorage.getItem('jev_gomoku_strength');
    const migratedStrength = storedStrength === 'local' || storedStrength === 'strong'
      ? 'grandmaster'
      : storedStrength;
    const strengthMode = ['jev', 'expert', 'grandmaster', 'max'].includes(migratedStrength)
      ? migratedStrength
      : 'max';
    if (storedStrength && storedStrength !== strengthMode) {
      localStorage.setItem('jev_gomoku_strength', strengthMode);
    }
    return {
      model: localStorage.getItem('jev_gomoku_model') || 'jev-latest',
      strengthMode,
      playerColor: player === 'white' ? 'white' : 'black',
      forbidOverline: storedBool('jev_gomoku_rule_overline', true),
      forbidFourFour: storedBool('jev_gomoku_rule_four_four', true),
      forbidThreeThree: storedBool('jev_gomoku_rule_three_three', true)
    };
  }

  function syncPreGameControls() {
    sideOptionButtons.forEach(button => {
      const selected = button.dataset.playerColor === settings.playerColor;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-checked', selected ? 'true' : 'false');
    });
    ruleOverlineInput.checked = settings.forbidOverline;
    ruleFourFourInput.checked = settings.forbidFourFour;
    ruleThreeThreeInput.checked = settings.forbidThreeThree;
    updatePreGamePreview();
  }

  function updatePreGamePreview() {
    const selected = sideOptionButtons.find(button => button.classList.contains('selected'));
    const side = selected?.dataset.playerColor === 'white' ? WHITE : BLACK;
    const enabled = [
      ruleOverlineInput.checked && '长连',
      ruleFourFourInput.checked && '四四',
      ruleThreeThreeInput.checked && '三三'
    ].filter(Boolean);
    const blackWin = ruleOverlineInput.checked ? '黑棋恰好五连胜' : '黑棋五连及以上胜';
    gameConfigSummary.textContent = `你执${colorShortZh(side)}${side === BLACK ? '先手' : '后手'} · 黑棋禁手：${enabled.length ? enabled.join(' / ') : '关闭'} · ${blackWin}`;
  }

  function readPreGameControls() {
    const selected = sideOptionButtons.find(button => button.classList.contains('selected'));
    settings.playerColor = selected?.dataset.playerColor === 'white' ? 'white' : 'black';
    settings.forbidOverline = Boolean(ruleOverlineInput.checked);
    settings.forbidFourFour = Boolean(ruleFourFourInput.checked);
    settings.forbidThreeThree = Boolean(ruleThreeThreeInput.checked);
  }

  function persistSettings() {
    localStorage.setItem('jev_gomoku_model', settings.model);
    localStorage.setItem('jev_gomoku_strength', settings.strengthMode);
    localStorage.setItem('jev_gomoku_player_color', settings.playerColor);
    localStorage.setItem('jev_gomoku_rule_overline', String(settings.forbidOverline));
    localStorage.setItem('jev_gomoku_rule_four_four', String(settings.forbidFourFour));
    localStorage.setItem('jev_gomoku_rule_three_three', String(settings.forbidThreeThree));
  }

  function saveSettings() {
    if (testController) testController.abort();
    settings.model = modelInput.value.trim() || 'jev-latest';
    settings.strengthMode = ['jev', 'expert', 'grandmaster', 'max'].includes(strengthModeInput.value)
      ? strengthModeInput.value
      : 'max';
    readPreGameControls();
    persistSettings();
    settingsModal.classList.remove('show');
    startGame();
  }

  function setConnectionTest(kind, text) {
    connectionTest.className = `connection-test show ${kind || ''}`.trim();
    connectionTestText.textContent = text;
  }

  function clearConnectionTest() {
    connectionTest.className = 'connection-test';
    connectionTestText.textContent = '';
  }

  async function testConnection() {
    if (testController) testController.abort();
    testController = new AbortController();
    const timeout = setTimeout(() => testController?.abort(), 15000 * TIMEOUT_SCALE);
    testConnectionBtn.disabled = true;
    testConnectionBtn.textContent = '检查中…';
    setConnectionTest('busy', '正在检查 Jev 服务…');
    const started = performance.now();

    try {
      // Health checks must never spend Jev tokens. The server already exposes
      // whether the upstream API key is configured, so keep this probe local.
      const response = await fetch('/health', {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: testController.signal
      });
      const elapsed = Math.round(performance.now() - started);
      const raw = await response.text();
      let data = null;
      try { data = raw ? JSON.parse(raw) : null; } catch (_) {}
      if (!response.ok || data?.ok !== true) {
        const detail = data?.detail || data?.message || data?.error || response.statusText || `HTTP ${response.status}`;
        throw Object.assign(new Error(typeof detail === 'string' ? detail : JSON.stringify(detail)), { httpStatus: response.status });
      }
      if (!data.jevConfigured) {
        throw Object.assign(new Error('Jev 服务暂未配置。'), { httpStatus: 503 });
      }
      setConnectionTest('ok', `Jev 服务已配置 · ${elapsed} ms`);
    } catch (err) {
      setConnectionTest('err', err?.name === 'AbortError'
        ? '检查超时，请稍后重试。'
        : friendlyError(err));
    } finally {
      clearTimeout(timeout);
      testController = null;
      testConnectionBtn.disabled = false;
      testConnectionBtn.textContent = '检查 Jev 状态';
    }
  }

  function publicModeMeta(mode) {
    if (mode === 'local') {
      return {
        name: '本地接管',
        badge: '降级',
        summary: '仅作为 Jev 不可用时的内部安全降级，不提供用户选择。'
      };
    }
    if (mode === 'max') {
      return {
        name: 'Jev Max',
        badge: 'MAX',
        summary: '多算法异构召回 + Atomic + Pairwise + 对手最强回复 + Critic，由 Jev 做高信息量最终裁决。'
      };
    }
    if (mode === 'jev') {
      return {
        name: 'Jev 直觉',
        badge: '实验',
        summary: 'Jev 更直接地从合法落点中选择；Jev 感更强，但不代表棋力更强。'
      };
    }
    if (mode === 'grandmaster') {
      return {
        name: 'Jev 宗师',
        badge: '等级 4',
        summary: '战术增强：Alpha-Beta 深搜与强制威胁搜索并行；证据一致时直接落子，出现分歧时再由 Jev 裁决。'
      };
    }
    return {
      name: 'Jev 大师',
      badge: '等级 3',
      summary: '棋力优先：更深本地搜索与后台深搜提供证据，由 Jev 做最终落子决定。'
    };
  }

  function publicModeLabel(mode) {
    return publicModeMeta(mode).name;
  }

  function publicSelectionLabel(mode) {
    const meta = publicModeMeta(mode);
    return `${meta.badge} · ${meta.name}`;
  }

  function renderLevelSelection(mode) {
    const selectedMode = ['jev', 'expert', 'grandmaster', 'max'].includes(mode) ? mode : 'max';
    strengthModeInput.value = selectedMode;
    levelOptionButtons.forEach(button => {
      const selected = button.dataset.mode === selectedMode;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-checked', selected ? 'true' : 'false');
    });
    currentLevelSummary.textContent = publicSelectionLabel(selectedMode);
  }

  function updateApiState(kind = null, text = null) {
    apiIndicator.className = 'indicator';
    jevLiveState.className = 'jev-live';

    const meta = publicModeMeta(settings.strengthMode);
    apiLabel.textContent = meta.name;
    levelBadge.textContent = meta.badge;
    levelSummary.textContent = meta.summary;

    if (kind === 'busy') {
      apiIndicator.classList.add('busy');
      jevLiveState.classList.add('busy');
      jevLiveState.textContent = '思考中';
      apiPhase.textContent = text || '正在分析局面…';
    } else if (kind === 'err') {
      apiIndicator.classList.add('err');
      jevLiveState.classList.add('fallback');
      jevLiveState.textContent = '本地接管';
      apiPhase.textContent = text || 'Jev 暂不可用，本回合由本地引擎接管。';
    } else {
      apiIndicator.classList.add('ok');
      jevLiveState.textContent = '在线';
      apiPhase.textContent = text || '准备就绪';
    }
  }

  function openSettings(force = false) {
    if (!force && gameStarted) {
      toast('本局已开始。请点击“重开”后再修改棋色或禁手规则。', 3600);
      return;
    }
    modelInput.value = settings.model;
    renderLevelSelection(settings.strengthMode || 'max');
    syncPreGameControls();
    clearConnectionTest();
    settingsModal.classList.add('show');
    const selected = sideOptionButtons.find(button => button.classList.contains('selected'))
      || levelOptionButtons.find(button => button.classList.contains('selected'));
    setTimeout(() => selected?.focus(), 30);
  }

  function toast(msg, duration = 2600) {
    clearTimeout(toastTimer);
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), duration);
  }

  function coord(r, c) { return `${COLS[c]}${r + 1}`; }

  function drawBoard() {
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const margin = 46;
    const span = (W - margin * 2) / (SIZE - 1);

    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#d7ad6c');
    grad.addColorStop(1, '#bd8d49');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(53, 33, 12, .72)';
    ctx.lineWidth = 1.25;
    for (let i = 0; i < SIZE; i++) {
      const p = margin + i * span;
      ctx.beginPath(); ctx.moveTo(margin, p); ctx.lineTo(W - margin, p); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(p, margin); ctx.lineTo(p, H - margin); ctx.stroke();
    }

    ctx.fillStyle = 'rgba(54, 32, 10, .85)';
    [[3,3],[3,11],[7,7],[11,3],[11,11]].forEach(([r,c]) => {
      ctx.beginPath(); ctx.arc(margin + c*span, margin + r*span, 4.1, 0, Math.PI*2); ctx.fill();
    });

    ctx.fillStyle = 'rgba(55, 36, 18, .76)';
    ctx.font = '15px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let c = 0; c < SIZE; c++) ctx.fillText(COLS[c], margin + c * span, 19);
    ctx.textAlign = 'right';
    for (let r = 0; r < SIZE; r++) ctx.fillText(String(r + 1), 28, margin + r * span);

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (board[r][c] !== EMPTY) drawStone(r, c, board[r][c], margin, span);
      }
    }

    if (moves.length) {
      const m = moves[moves.length - 1];
      const x = margin + m.c * span, y = margin + m.r * span;
      ctx.strokeStyle = m.color === BLACK ? '#ffd166' : '#e34d59';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(x, y, span * .17, 0, Math.PI*2); ctx.stroke();
    }
  }

  function drawStone(r, c, color, margin, span) {
    const x = margin + c * span, y = margin + r * span;
    const radius = span * .41;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.35)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    const g = ctx.createRadialGradient(x - radius*.35, y - radius*.4, radius*.1, x, y, radius);
    if (color === BLACK) {
      g.addColorStop(0, '#4a515a'); g.addColorStop(.28, '#20252b'); g.addColorStop(1, '#060708');
    } else {
      g.addColorStop(0, '#ffffff'); g.addColorStop(.55, '#f2f4f6'); g.addColorStop(1, '#cbd1d6');
    }
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }

  function pointFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    const margin = 46;
    const span = (canvas.width - margin * 2) / (SIZE - 1);
    const c = Math.round((x - margin) / span);
    const r = Math.round((y - margin) / span);
    if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return null;
    const px = margin + c * span, py = margin + r * span;
    if (Math.hypot(x - px, y - py) > span * .46) return null;
    return { r, c };
  }

  function place(r, c, color, source) {
    if (board[r][c] !== EMPTY) return false;
    board[r][c] = color;
    const move = { r, c, color, source, coord: coord(r, c) };
    moves.push(move);
    trackPlacedMoveEasterEggs(move);
    drawBoard();
    updateHistory();
    updateStatus();
    return true;
  }

  function onBoardClick(e) {
    const human = playerColor();
    if (!gameStarted || gameOver || thinking || current !== human) return;
    const p = pointFromEvent(e);
    if (!p || board[p.r][p.c] !== EMPTY) return;

    if (human === BLACK) {
      const forbidden = blackForbiddenInfo(p.r, p.c);
      if (forbidden.forbidden) {
        const label = forbidden.type === 'OVERLINE' ? '长连'
          : forbidden.type === 'FOUR_FOUR' ? '四四'
          : forbidden.type === 'THREE_THREE' ? '三三'
          : '禁手';
        toast(`${coord(p.r, p.c)} 是黑棋${label}禁手，请选择其他落点。`, 3200);
        return;
      }
    }

    place(p.r, p.c, human, '你');
    if (isWin(p.r, p.c, human)) {
      finish('你赢了', human);
      return;
    }
    missedDefensePendingWin = false;
    if (moves.length === SIZE * SIZE) {
      finish('平局', EMPTY);
      return;
    }
    prepareHumanThreatForAi();
    current = aiColor();
    resetTurnClock();
    updateStatus();
    setTimeout(jevTurn, 220);
  }

  const RENJU_DIRS = [[1,0],[0,1],[1,1],[1,-1]];
  const RENJU_MAX_RECURSION = 4;

  function inBounds(r, c) {
    return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
  }

  function lineLength(r, c, color, dr, dc) {
    let n = 1;
    for (const sign of [-1, 1]) {
      let rr = r + dr * sign;
      let cc = c + dc * sign;
      while (inBounds(rr, cc) && board[rr][cc] === color) {
        n++;
        rr += dr * sign;
        cc += dc * sign;
      }
    }
    return n;
  }

  function hasExactFiveAt(r, c, color) {
    return RENJU_DIRS.some(([dr, dc]) => lineLength(r, c, color, dr, dc) === 5);
  }

  function hasOverlineAt(r, c, color) {
    return RENJU_DIRS.some(([dr, dc]) => lineLength(r, c, color, dr, dc) >= 6);
  }

  function isWin(r, c, color) {
    if (color === BLACK) {
      if (activeRuleConfig().overline) return hasExactFiveAt(r, c, BLACK);
      return RENJU_DIRS.some(([dr, dc]) => lineLength(r, c, BLACK, dr, dc) >= 5);
    }
    return RENJU_DIRS.some(([dr, dc]) => lineLength(r, c, WHITE, dr, dc) >= 5);
  }

  function contiguousRunCells(r, c, color, dr, dc) {
    const negative = [];
    let rr = r - dr;
    let cc = c - dc;
    while (inBounds(rr, cc) && board[rr][cc] === color) {
      negative.push([rr, cc]);
      rr -= dr;
      cc -= dc;
    }
    negative.reverse();

    const positive = [];
    rr = r + dr;
    cc = c + dc;
    while (inBounds(rr, cc) && board[rr][cc] === color) {
      positive.push([rr, cc]);
      rr += dr;
      cc += dc;
    }
    return [...negative, [r, c], ...positive];
  }

  function collectBlackFoursThrough(r, c) {
    const fours = new Map();
    RENJU_DIRS.forEach(([dr, dc], dirIndex) => {
      for (let start = -4; start <= 0; start++) {
        const cells = [];
        let valid = true;
        for (let k = 0; k < 5; k++) {
          const rr = r + (start + k) * dr;
          const cc = c + (start + k) * dc;
          if (!inBounds(rr, cc)) {
            valid = false;
            break;
          }
          cells.push([rr, cc]);
        }
        if (!valid) continue;

        const blackCells = [];
        const emptyCells = [];
        let blocked = false;
        for (const [rr, cc] of cells) {
          if (board[rr][cc] === BLACK) blackCells.push([rr, cc]);
          else if (board[rr][cc] === EMPTY) emptyCells.push([rr, cc]);
          else {
            blocked = true;
            break;
          }
        }
        if (blocked || blackCells.length !== 4 || emptyCells.length !== 1) continue;

        const [er, ec] = emptyCells[0];
        board[er][ec] = BLACK;
        const makesExactFive = lineLength(er, ec, BLACK, dr, dc) === 5;
        board[er][ec] = EMPTY;
        if (!makesExactFive) continue;

        const stoneKey = blackCells
          .map(([rr, cc]) => rr * SIZE + cc)
          .sort((a, b) => a - b)
          .join('-');
        fours.set(`${dirIndex}:${stoneKey}`, {
          direction: dirIndex,
          stones: blackCells,
          winningPoint: [er, ec]
        });
      }
    });
    return [...fours.values()];
  }

  function straightFourCreatedByExtension(originR, originC, extR, extC, dr, dc) {
    const run = contiguousRunCells(extR, extC, BLACK, dr, dc);
    if (run.length !== 4) return null;
    if (!run.some(([rr, cc]) => rr === originR && cc === originC)) return null;

    const first = run[0];
    const last = run[run.length - 1];
    const left = [first[0] - dr, first[1] - dc];
    const right = [last[0] + dr, last[1] + dc];
    if (!inBounds(left[0], left[1]) || !inBounds(right[0], right[1])) return null;
    if (board[left[0]][left[1]] !== EMPTY || board[right[0]][right[1]] !== EMPTY) return null;

    for (const [rr, cc] of [left, right]) {
      board[rr][cc] = BLACK;
      const exact = lineLength(rr, cc, BLACK, dr, dc) === 5;
      board[rr][cc] = EMPTY;
      if (!exact) return null;
    }
    return run;
  }

  function collectRealBlackThreesThrough(r, c, depth) {
    const threes = new Map();
    RENJU_DIRS.forEach(([dr, dc], dirIndex) => {
      for (let offset = -4; offset <= 4; offset++) {
        if (!offset) continue;
        const er = r + offset * dr;
        const ec = c + offset * dc;
        if (!inBounds(er, ec) || board[er][ec] !== EMPTY) continue;

        board[er][ec] = BLACK;
        const makesFive = hasExactFiveAt(er, ec, BLACK);
        const run = makesFive ? null : straightFourCreatedByExtension(r, c, er, ec, dr, dc);
        let extensionLegal = Boolean(run);
        if (extensionLegal) {
          const extensionRestriction = blackForbiddenInfoPlaced(er, ec, depth + 1);
          extensionLegal = !extensionRestriction.forbidden;
        }

        if (extensionLegal && run) {
          const existing = run.filter(([rr, cc]) => !(rr === er && cc === ec));
          if (existing.length === 3 && existing.some(([rr, cc]) => rr === r && cc === c)) {
            const stoneKey = existing
              .map(([rr, cc]) => rr * SIZE + cc)
              .sort((a, b) => a - b)
              .join('-');
            threes.set(`${dirIndex}:${stoneKey}`, {
              direction: dirIndex,
              stones: existing,
              extension: [er, ec]
            });
          }
        }
        board[er][ec] = EMPTY;
      }
    });
    return [...threes.values()];
  }

  function potentialBlackThreeDirections(r, c) {
    let directions = 0;
    for (const [dr, dc] of RENJU_DIRS) {
      let nearbyBlack = 0;
      for (let offset = -4; offset <= 4; offset++) {
        if (!offset) continue;
        const rr = r + offset * dr;
        const cc = c + offset * dc;
        if (inBounds(rr, cc) && board[rr][cc] === BLACK) nearbyBlack++;
      }
      if (nearbyBlack >= 2) directions++;
    }
    return directions;
  }

  function blackForbiddenInfoPlaced(r, c, depth = 0) {
    const rules = activeRuleConfig();
    const exactFive = hasExactFiveAt(r, c, BLACK);
    const overline = hasOverlineAt(r, c, BLACK);

    if (exactFive) {
      return { forbidden: false, type: null, winningFive: true, fourCount: 0, threeCount: 0 };
    }
    if (rules.overline && overline) {
      return { forbidden: true, type: 'OVERLINE', winningFive: false, fourCount: 0, threeCount: 0 };
    }

    const fours = rules.fourFour || rules.threeThree ? collectBlackFoursThrough(r, c) : [];
    if (rules.fourFour && fours.length >= 2) {
      return { forbidden: true, type: 'FOUR_FOUR', winningFive: false, fourCount: fours.length, threeCount: 0 };
    }
    if (!rules.threeThree || depth >= RENJU_MAX_RECURSION || potentialBlackThreeDirections(r, c) < 2) {
      return { forbidden: false, type: null, winningFive: !rules.overline && overline, fourCount: fours.length, threeCount: 0 };
    }

    const threes = collectRealBlackThreesThrough(r, c, depth);
    if (threes.length >= 2) {
      return { forbidden: true, type: 'THREE_THREE', winningFive: false, fourCount: fours.length, threeCount: threes.length };
    }
    return { forbidden: false, type: null, winningFive: !rules.overline && overline, fourCount: fours.length, threeCount: threes.length };
  }

  function blackForbiddenInfo(r, c) {
    if (!inBounds(r, c) || board[r][c] !== EMPTY) {
      return { forbidden: true, type: 'OCCUPIED_OR_INVALID', winningFive: false, fourCount: 0, threeCount: 0 };
    }
    board[r][c] = BLACK;
    const result = blackForbiddenInfoPlaced(r, c, 0);
    board[r][c] = EMPTY;
    return result;
  }

  function isLegalMoveForColor(r, c, color) {
    if (!inBounds(r, c) || board[r][c] !== EMPTY) return false;
    if (color !== BLACK) return true;
    return !blackForbiddenInfo(r, c).forbidden;
  }

  function winningLineCoords(winner) {
    if (winner === EMPTY || !moves.length) return [];
    const last = moves[moves.length - 1];
    if (!last || last.color !== winner) return [];

    for (const [dr, dc] of RENJU_DIRS) {
      const run = contiguousRunCells(last.r, last.c, winner, dr, dc);
      const wins = winner === BLACK && activeRuleConfig().overline
        ? run.length === 5
        : run.length >= 5;
      if (wins) return run.map(([r, c]) => coord(r, c));
    }
    return [];
  }

  function buildGameSummary(winner) {
    const human = playerColor();
    const ai = aiColor();
    const lengthLabel = moves.length <= 20 ? '短局' : moves.length <= 45 ? '中盘结束' : '长局';
    const lines = [];

    if (winner === human) {
      lines.push(`你执${colorShortZh(human)}获胜，共 ${moves.length} 手，属于${lengthLabel}。`);
    } else if (winner === ai) {
      lines.push(`Jev 执${colorShortZh(ai)}获胜，共 ${moves.length} 手，属于${lengthLabel}。`);
    } else {
      lines.push(`本局共 ${moves.length} 手，双方战成平局。`);
    }

    const winLine = winningLineCoords(winner);
    if (winLine.length) {
      const last = moves[moves.length - 1];
      lines.push(`终局：${last.coord} 落下后形成 ${winLine.join(' → ')} 连线。`);
    }

    const decisions = jevDecisionLog.filter(item => item.moveNo <= moves.length);
    if (decisions.length) {
      const timed = decisions
        .map(item => Number(item.thinkDurationMs))
        .filter(Number.isFinite);
      const avgThink = timed.length
        ? timed.reduce((sum, ms) => sum + ms, 0) / timed.length
        : null;
      const forcedCount = decisions.filter(item => item.forced).length;
      const fallbackCount = decisions.filter(item => item.mode === 'local' || item.fallbackReason).length;
      let decisionLine = `Jev 共完成 ${decisions.length} 次落子决策`;
      if (avgThink != null) decisionLine += `，平均思考 ${formatElapsed(avgThink)}`;
      if (forcedCount) decisionLine += `，其中 ${forcedCount} 次属于强制战术处理`;
      decisionLine += '。';
      lines.push(decisionLine);
      if (fallbackCount) lines.push(`本局有 ${fallbackCount} 次决策使用了本地降级或回退路径。`);
    }

    const eggLabels = gameEggLabels();
    if (eggLabels.length) lines.push(`本局彩蛋：${eggLabels.join(' / ')}。`);

    return lines.join('\n');
  }

  function hideResultModal() {
    resultModal.classList.remove('show');
  }

  function showResultModal(text, winner) {
    const modeLabel = publicModeLabel(settings.strengthMode);
    const human = playerColor();
    const ai = aiColor();

    resultTitle.textContent = text;
    resultIcon.textContent = winner === BLACK ? '●' : winner === WHITE ? '○' : '＝';
    resultIcon.className = `result-icon ${winner === human ? 'player-win' : winner === ai ? 'ai-win' : 'draw'}`;
    resultDesc.textContent = winner === human
      ? `你执${colorShortZh(human)}完成五连，本局获胜。`
      : winner === ai
        ? `Jev 执${colorShortZh(ai)}完成五连，赢下了这一局。`
        : '棋盘已下满，你与 Jev 战成平局。';
    resultStats.textContent = `共 ${moves.length} 手 · ${modeLabel} · ${ruleSummaryText()}`;
    resultSummary.textContent = buildGameSummary(winner);
    resultCopyBtn.textContent = '复制棋谱';
    resultModal.classList.add('show');
  }

  function finish(text, winner) {
    prepareFinishEasterEggs(winner);
    gameResult = { text, winner, endedAt: new Date() };
    gameOver = true;
    thinking = false;
    thinkingStartedAt = null;
    canvas.classList.remove('disabled');
    const cls = winner === BLACK ? 'black' : 'white';
    turnText.innerHTML = winner === EMPTY
      ? `<span>对局结束：${text}</span>`
      : `<span class="stone-dot ${cls}"></span><span>对局结束：${text}</span>`;
    gameMeta.textContent = `共 ${moves.length} 手`;
    showResultModal(text, winner);
  }

  function resetGameState(started) {
    if (requestController) requestController.abort();
    requestController = null;
    board = makeBoard();
    current = BLACK;
    moves = [];
    gameOver = false;
    gameStarted = Boolean(started);
    thinking = false;
    lastJev = null;
    jevDecisionLog = [];
    gameResult = null;
    gameStartedAt = started ? new Date() : null;
    gameSeed = createGameSeed();
    turnStartedAt = performance.now();
    thinkingStartedAt = null;
    lastThinkMs = null;
    lastThinkDuration.textContent = '—';
    gameEggs = new Set();
    undoCount = 0;
    copyCount = 0;
    openingSaved = false;
    pendingHumanThreat = null;
    missedDefensePendingWin = false;
    jevWasInDanger = false;
    jevBlockStreak = 0;
    thinkEgg20 = false;
    thinkEgg40 = false;
    if (maxBadgeTimer) clearTimeout(maxBadgeTimer);
    maxBadgeTimer = null;
    resultSummary.textContent = '等待对局结束。';
    hideResultModal();
    canvas.classList.remove('disabled');
    jevMove.textContent = '—';
    jevDecisionLabel.textContent = '等待 Jev 判断';
    jevVerdict.textContent = '等待';
    jevInfo.textContent = 'Jev 落子后，这里会解释它为什么考虑这一手。';
    confidenceBar.style.width = '0%';
    confidenceText.textContent = '—';
    alternativesTitle.textContent = '其他考虑';
    alternatives.innerHTML = '<div class="empty">暂无备选落点。</div>';
    retryBtn.style.display = 'none';
    drawBoard();
    updateHistory();
    updateStatus();
    updateApiState();
    updateEasterProgress();
  }

  function startGame() {
    resetGameState(true);
    const enabled = enabledForbiddenLabels();
    ruleHint.textContent = `${ruleSummaryText()}。点击交叉点落子。`;
    runtimeRulesHint.textContent = `本局规则已锁定：你执${colorShortZh(playerColor())}，Jev 执${colorShortZh(aiColor())}；黑棋禁手：${enabled.length ? enabled.join('、') : '关闭'}。Local、Deep Worker、Threat-space 与 Jev 使用同一规则。`;
    toast(`已开始：${ruleSummaryText()} · ${publicModeLabel(settings.strengthMode)}`, 3200);
    if (settings.strengthMode === 'max' && (gameSeed & 127) === 0) {
      triggerEasterEgg('max_true_form', 'MAXIMUM。');
      levelBadge.textContent = 'MAXIMUM';
      maxBadgeTimer = setTimeout(() => {
        levelBadge.textContent = publicModeMeta(settings.strengthMode).badge;
        maxBadgeTimer = null;
      }, 1200);
    }
    if (aiColor() === BLACK) setTimeout(jevTurn, 180);
  }

  function restart() {
    resetGameState(false);
    ruleHint.textContent = '开局前可选择执黑 / 执白，并配置黑棋长连、四四、三三禁手。';
    runtimeRulesHint.textContent = '规则将在开局时锁定，并同步应用于玩家、Local、Deep Worker、Threat-space 与 Jev。';
    openSettings(true);
  }

  function undoPlyCount() {
    if (!moves.length) return 0;
    const human = playerColor();
    const ai = aiColor();
    const lastMove = moves[moves.length - 1];

    if (gameOver) {
      return Math.min(lastMove?.color === ai ? 2 : 1, moves.length);
    }
    if (current === human && lastMove?.color === ai) {
      return Math.min(2, moves.length);
    }
    return 1;
  }

  function undo() {
    if (thinking) { toast('Jev 正在思考，暂时不能悔棋'); return; }
    if (!gameStarted || !moves.length) return;

    const remove = undoPlyCount();
    undoCount++;
    if (undoCount === 3) triggerEasterEgg('undo_3', '第三次了，还悔？');
    if (undoCount === 6) triggerEasterEgg('undo_6', '你这是在读档吧？');
    if (undoCount === 10) triggerEasterEgg('undo_overload', '十次了，要不重开？');
    if (undoCount === 20) triggerEasterEgg('undo_multiverse', '别下了，改玩时间旅行吧。');
    pendingHumanThreat = null;
    missedDefensePendingWin = false;
    jevWasInDanger = false;
    jevBlockStreak = 0;
    if (gameOver) gameOver = false;
    hideResultModal();
    gameResult = null;
    for (let i = 0; i < remove; i++) {
      const m = moves.pop();
      board[m.r][m.c] = EMPTY;
    }
    jevDecisionLog = jevDecisionLog.filter(item => item.moveNo <= moves.length);
    current = moves.length % 2 === 0 ? BLACK : WHITE;
    turnStartedAt = performance.now();
    thinkingStartedAt = null;
    lastThinkMs = null;
    lastThinkDuration.textContent = '—';
    lastJev = null;
    jevMove.textContent = '—';
    jevDecisionLabel.textContent = '已悔棋';
    jevVerdict.textContent = '等待';
    jevInfo.textContent = '等待下一次 Jev 判断。';
    confidenceBar.style.width = '0%';
    confidenceText.textContent = '—';
    alternativesTitle.textContent = '其他考虑';
    alternatives.innerHTML = '<div class="empty">暂无备选落点。</div>';
    retryBtn.style.display = 'none';
    drawBoard();
    updateHistory();
    updateStatus();
    if (current === aiColor()) setTimeout(jevTurn, 180);
  }

  function updateStatus() {
    if (!gameStarted) {
      turnText.innerHTML = '<span>等待开局</span>';
      turnHint.textContent = '请先完成开局设置';
      gameMeta.textContent = '尚未开始';
      lastMoveText.textContent = '尚未落子';
      refreshTurnClock();
      return;
    }
    if (gameOver) return;

    const nextNo = moves.length + 1;
    const color = current;
    const stoneClass = colorCss(color);
    if (thinking) {
      turnText.innerHTML = `<span class="stone-dot ${stoneClass}"></span><span class="thinking">Jev 正在思考</span>`;
      turnHint.textContent = '正在分析局面，请稍候';
    } else if (current === playerColor()) {
      turnText.innerHTML = `<span class="stone-dot ${stoneClass}"></span><span>轮到你了</span>`;
      turnHint.textContent = `点击棋盘交叉点落下一枚${colorNameZh(color)}`;
    } else {
      turnText.innerHTML = `<span class="stone-dot ${stoneClass}"></span><span>Jev 的回合</span>`;
      turnHint.textContent = 'Jev 即将开始思考';
    }
    gameMeta.textContent = `第 ${nextNo} 手 · ${colorNameZh(color)}`;
    lastMoveText.textContent = moves.length ? `最后落子：${moves[moves.length - 1].coord}` : '尚未落子';
    refreshTurnClock();
  }

  function updateHistory() {
    if (!moves.length) {
      historyEl.innerHTML = '<div class="empty">对局开始后，这里会记录每一步坐标。</div>';
      return;
    }
    historyEl.innerHTML = moves.map((m, i) => `
      <div class="move">
        <span class="n">${i + 1}</span>
        <span class="mini-stone ${m.color === BLACK ? 'black' : 'white'}"></span>
        <span class="coord">${m.coord}</span>
        <span class="who">${m.source}</span>
      </div>`).reverse().join('');
  }

  function compactNumber(value, digits = 3) {
    return Number.isFinite(value) ? Number(value).toFixed(digits) : '—';
  }

  function snapshotDecision(result, moveNo) {
    const probabilities = result?.answer?.probabilities && typeof result.answer.probabilities === 'object'
      ? Object.entries(result.answer.probabilities)
          .sort((a,b) => Number(b[1]) - Number(a[1]))
          .slice(0, 8)
          .map(([move, probability]) => ({ move, probability: Number(probability) }))
      : [];
    const candidates = (result?.candidates || [])
      .filter(m => m && m.key)
      .slice(0, 8)
      .map(m => ({
        move: m.key,
        rank: m.rank ?? null,
        searchScore: Number.isFinite(m.searchScore) ? m.searchScore : null,
        deepSearchScore: Number.isFinite(m.deepSearchScore) ? m.deepSearchScore : null,
        deepSearchRank: Number.isFinite(m.deepSearchRank) ? m.deepSearchRank : null,
        localRank: Number.isFinite(m.localRank) ? m.localRank : (Number.isFinite(m.rank) ? m.rank : null),
        localNorm: Number.isFinite(m.localNorm) ? m.localNorm : null,
        atomicScore: Number.isFinite(m.atomicScore) ? m.atomicScore : null,
        pairScore: Number.isFinite(m.pairScore) ? m.pairScore : null,
        finalScore: Number.isFinite(m.finalScore) ? m.finalScore : null,
        sources: Array.isArray(m.recallSources) ? [...m.recallSources] : [],
        deepEvidence: m.deepEvidence ? JSON.parse(JSON.stringify(m.deepEvidence)) : null,
        criticSummary: m.criticSummary ? JSON.parse(JSON.stringify(m.criticSummary)) : null,
        threatSearch: m.threatSearch ? JSON.parse(JSON.stringify(m.threatSearch)) : null,
        facts: m.analysis?.facts ? { ...m.analysis.facts } : null
      }));

    return {
      moveNo,
      chosen: result?.finalChoice || result?.answer?.choice || '—',
      mode: result?.mode || 'unknown',
      forced: result?.forced || null,
      localChoice: result?.localChoice || null,
      jevSuggested: result?.jevSuggested || null,
      stageNote: result?.stageNote || '',
      model: result?.model || '',
      confidence: Number.isFinite(result?.answer?.confidence) ? result.answer.confidence : null,
      usage: result?.usage ? { ...result.usage } : null,
      client: result?.client ? { ...result.client } : null,
      fallbackReason: result?.fallbackReason || null,
      thinkDurationMs: Number.isFinite(result?.thinkDurationMs) ? result.thinkDurationMs : null,
      probabilities,
      candidates,
      trace: result?.decisionTrace ? JSON.parse(JSON.stringify(result.decisionTrace)) : null
    };
  }

  function rememberDecision(result, moveNo) {
    jevDecisionLog.push(snapshotDecision(result, moveNo));
  }

  function appendDecisionTrace(lines, d) {
    const modeLabel = d.mode === 'local' ? '本地降级'
      : d.mode === 'jev' ? 'Jev 直觉'
      : d.mode === 'max' ? 'Jev Max'
      : d.mode === 'grandmaster' ? 'Jev 宗师'
      : 'Jev 大师';
    lines.push(`第 ${d.moveNo} 手 · ${colorShortZh(aiColor())} ${d.chosen}`);
    lines.push(`  模式：${modeLabel}`);
    if (d.stageNote) lines.push(`  决策阶段：${d.stageNote}`);
    if (d.forced) lines.push(`  强制类型：${d.forced === 'win'
      ? '立即取胜'
      : d.forced === 'block'
        ? '必须防守'
        : d.forced === 'forced_loss_double_win'
          ? '对手已有两个立即胜点，单手无解'
          : d.forced}`);
    if (d.localChoice) lines.push(`  Local 首选：${d.localChoice}`);
    if (d.jevSuggested) lines.push(`  Jev 最终选择：${d.jevSuggested}`);
    if (d.trace?.preJevDeepSearch) {
      const v = d.trace.preJevDeepSearch;
      lines.push(`  Jev 前置深搜：source=${v.source || '—'}；status=${v.status || '—'}；depth=${v.depthReached ?? '—'}；elapsed=${v.elapsedMs ?? '—'}ms`);
      if (Array.isArray(v.scores) && v.scores.length) {
        if (v.status === 'no_completed_depth' || v.rankingOnly) {
          lines.push(`    深搜：未完成有效 depth，仅保留 fallback rank：${v.scores.map(item => `${item.move}#${item.fallbackRank ?? '—'}`).join('；')}`);
        } else {
          lines.push(`    深搜评分：${v.scores.map(item => item.forcedResult
            ? `${item.move}=${item.forcedResult.result === 'win' ? 'FORCED_WIN' : 'FORCED_LOSS'}`
            : `${item.move}=${compactNumber(item.score, 1)}`).join('；')}`);
        }
        v.scores.slice(0, 5).forEach(item => {
          if (Array.isArray(item.principalVariation) && item.principalVariation.length) {
            lines.push(`      ${item.move} PV: ${item.principalVariation.join(' > ')}`);
          }
          if (Array.isArray(item.opponentBestReplies) && item.opponentBestReplies.length) {
            lines.push(`      ${item.move} 对手最强回复：${item.opponentBestReplies.map(reply => reply.move).join(' / ')}`);
          }
        });
      }
    }
    if (d.trace?.preJevThreatSearch) {
      const t = d.trace.preJevThreatSearch;
      lines.push(`  威胁空间搜索：source=${t.source || '—'}；status=${t.status || '—'}；maxTurns=${t.maxThreatTurns ?? '—'}；elapsed=${t.elapsedMs ?? '—'}ms`);
      if (Array.isArray(t.analyses) && t.analyses.length) {
        t.analyses.forEach(item => {
          const line = Array.isArray(item.line) && item.line.length ? `；line=${item.line.join('>')}` : '';
          lines.push(`    ${item.move}: ${item.forced ? 'OPPONENT_FORCED_WIN' : item.timedOut ? 'TIMEOUT' : 'NO_PROOF'}${line}`);
          const counter = item.counterThreat;
          if (counter && counter.risk && !['NONE', 'PROVEN_FORCED_LOSS'].includes(counter.risk)) {
            const network = Array.isArray(counter.networkMoves) && counter.networkMoves.length
              ? counter.networkMoves.map(row => `${row.move}:${row.kind}`).join(' / ')
              : '—';
            lines.push(`      counter-threat=${counter.risk}；forced-defense=${counter.forcedDefenseMove || '—'}；network=${network}`);
          }
        });
      }
    }
    if (d.trace?.finalDecision) {
      const p = d.trace.finalDecision;
      const probs = p.probabilities
        ? Object.entries(p.probabilities)
            .sort((a,b) => Number(b[1]) - Number(a[1]))
            .map(([k,v]) => `${k} ${(Number(v) * 100).toFixed(1)}%`)
            .join('，')
        : '';
      lines.push(`  Jev 最终裁决：${p.choice || '—'}${probs ? ` [${probs}]` : ''}`);
    }
    if (d.trace?.challenger?.verification) {
      const v = d.trace.challenger.verification;
      lines.push(`  后台深搜：trigger=${d.trace.challenger.verificationTrigger || v.trigger || '—'}；source=${v.source || '—'}；status=${v.status || '—'}；depth=${v.depthReached ?? v.config?.depth ?? '—'}；elapsed=${v.elapsedMs ?? '—'}ms`);
      if (Array.isArray(v.scores) && v.scores.length) {
        lines.push(`    深搜评分：${v.scores.map(item => `${item.move}=${compactNumber(item.score, 1)}`).join('；')}`);
      } else if (v.local && v.challenger) {
        lines.push(`    Local=${v.local.move} ${compactNumber(v.local.searchScore, 1)}；Jev=${v.challenger.move} ${compactNumber(v.challenger.searchScore, 1)}`);
      }
    }
    if (d.model) lines.push(`  模型：${d.model}`);
    if (d.confidence != null) lines.push(`  最终置信度：${(d.confidence * 100).toFixed(1)}%`);
    if (d.usage) lines.push(`  Token：${d.usage.input_tokens ?? '?'} in / ${d.usage.output_tokens ?? '?'} out`);
    if (d.client) {
      const logical = d.trace?.requestShape?.logicalRequests ?? d.client.logicalRequests ?? null;
      const actual = d.trace?.requestShape?.httpRequests ?? d.client.attempts ?? null;
      lines.push(`  Jev requests：${logical ?? (d.client.cached ? 0 : 1)} logical / ${actual ?? 0} upstream`);
    }
    if (d.thinkDurationMs != null) lines.push(`  本手思考：${formatElapsed(d.thinkDurationMs)}`);
    if (d.fallbackReason) lines.push(`  降级原因：${d.fallbackReason}`);
    if (d.probabilities.length) {
      lines.push(`  候选概率：${d.probabilities.map(p => `${p.move} ${(p.probability * 100).toFixed(1)}%`).join('；')}`);
    }
    if (d.candidates.length) {
      lines.push('  候选评估：');
      d.candidates.forEach(c => {
        const f = c.facts || {};
        lines.push(
          `    #${c.localRank ?? c.rank ?? '—'} ${c.move} | sources=${c.sources?.length ? c.sources.join('+') : '—'} | search=${compactNumber(c.searchScore, 1)} | deep=${compactNumber(c.deepSearchScore, 1)} | deepRank=${c.deepSearchRank ?? '—'} | atomic=${compactNumber(c.atomicScore)} | pair=${compactNumber(c.pairScore)}`
        );
        const factText = [
          f.forced_role && `role=${f.forced_role}`,
          f.tactical_safety && `safety=${f.tactical_safety}`,
          f.tactical_verification && `localVerify=${f.tactical_verification}`,
          f.threat_verification && `threatVerify=${f.threat_verification}`,
          f.attack_shape && `attack=${f.attack_shape}`,
          f.initiative && `initiative=${f.initiative}`,
          f.vcf_status && `VCF=${f.vcf_status}`,
          f.vct_status && `VCT=${f.vct_status}`,
          f.connectivity && `connectivity=${f.connectivity}`,
          f.centrality && `centrality=${f.centrality}`
        ].filter(Boolean).join('；');
        if (factText) lines.push(`      ${factText}`);
      });
    }

    if (d.trace?.atomic?.length) {
      lines.push('  Jev Atomic 原始判断：');
      d.trace.atomic.forEach(item => {
        const probs = item.probabilities
          ? Object.entries(item.probabilities)
              .sort((a,b) => Number(b[1]) - Number(a[1]))
              .map(([k,v]) => `${k} ${(Number(v) * 100).toFixed(1)}%`)
              .join('，')
          : '';
        lines.push(`    ${item.move}: ${item.choice || '—'}${probs ? ` [${probs}]` : ''}`);
      });
    }

    if (d.trace?.pairwise?.length) {
      lines.push('  Jev Pairwise 对决：');
      d.trace.pairwise.forEach(item => {
        const probs = item.probabilities
          ? Object.entries(item.probabilities)
              .sort((a,b) => Number(b[1]) - Number(a[1]))
              .map(([k,v]) => `${k} ${(Number(v) * 100).toFixed(1)}%`)
              .join('，')
          : '';
        lines.push(`    ${item.left} vs ${item.right} -> ${item.choice || '—'}${probs ? ` [${probs}]` : ''}`);
      });
    }

    if (d.trace?.critic?.length) {
      lines.push('  Jev Critic / Refutation：');
      d.trace.critic.forEach(item => {
        const probs = item.probabilities
          ? Object.entries(item.probabilities)
              .sort((a,b) => Number(b[1]) - Number(a[1]))
              .slice(0, 3)
              .map(([k,v]) => `${k} ${(Number(v) * 100).toFixed(1)}%`)
              .join('，')
          : '';
        lines.push(`    ${item.move}: ${item.choice || '—'}${probs ? ` [${probs}]` : ''}`);
      });
    }

    if (d.trace?.rescueSweep) {
      const r = d.trace.rescueSweep;
      lines.push(`  Rescue Sweep：mode=${r.mode || '—'}；pool=${(r.pool || []).join(' / ') || '—'}；vetted=${(r.vetted || []).join(' / ') || '—'}；unresolved=${(r.unresolved || []).join(' / ') || '—'}；elapsed=${r.elapsedMs ?? '—'}ms`);
      if (Array.isArray(r.rejectedByProof) && r.rejectedByProof.length) {
        lines.push(`    Rescue proof 排除：${r.rejectedByProof.join(' / ')}`);
      }
      if (r.selectedResistance) {
        lines.push(`    Bounded rescue exhausted；最长抵抗：${r.selectedResistance}`);
      }
    }

    if (d.trace?.threatCoverage?.supplementalTriggered) {
      const tc = d.trace.threatCoverage;
      lines.push(`  Threat coverage 补检：${(tc.supplementalCandidates || []).join(' / ') || '—'}；elapsed=${tc.elapsedMs ?? '—'}ms`);
      if (Array.isArray(tc.rejectedIncomplete) && tc.rejectedIncomplete.length) {
        lines.push(`    未完成校验而 fail-closed：${tc.rejectedIncomplete.join(' / ')}`);
      }
    }

    if (d.trace?.wildcard) {
      const w = d.trace.wildcard;
      lines.push(`  Wildcard：requested=${Boolean(w.requested)}；proposed=${w.proposed || '—'}；accepted=${w.accepted || '—'}；enteredFinal=${Boolean(w.enteredFinalists)}；chosen=${Boolean(w.chosen)}`);
      if (Array.isArray(w.excludedByThreatProof) && w.excludedByThreatProof.length) {
        lines.push(`    Threat proof 排除：${w.excludedByThreatProof.join(' / ')}`);
      }
      if (w.validation) {
        lines.push(`    Wildcard 校验：accepted=${Boolean(w.validation.accepted)}；reason=${w.validation.reason || '—'}；source=${w.validation.source || '—'}；elapsed=${w.validation.elapsedMs ?? '—'}ms`);
        if (Array.isArray(w.validation.forcedLine) && w.validation.forcedLine.length) {
          lines.push(`    Wildcard forced line：${w.validation.forcedLine.join('>')}`);
        }
      }
    }

    if (d.trace?.requestShape) {
      const s = d.trace.requestShape;
      lines.push(`  性能：local=${s.localSearchElapsedMs ?? '—'}ms；deep=${s.deepElapsedMs ?? '—'}ms；threat=${s.threatElapsedMs ?? '—'}ms；workers<=${s.maxWorkers ?? '—'}；browserLongTasks=${s.browserLongTasks ?? 'unsupported'}`);
      if (Array.isArray(s.payloadEstimatedInputTokens)) {
        lines.push(`  Payload 估算：${s.payloadEstimatedInputTokens.join(' / ')} tokens（target<${s.payloadTokenBudgetTarget ?? 5000}，hard<${s.payloadTokenBudgetHard ?? 7000}）`);
      }
    }

    if (d.trace?.pureJev) {
      const p = d.trace.pureJev;
      const probs = p.probabilities
        ? Object.entries(p.probabilities)
            .sort((a,b) => Number(b[1]) - Number(a[1]))
            .slice(0, 12)
            .map(([k,v]) => `${k} ${(Number(v) * 100).toFixed(1)}%`)
            .join('，')
        : '';
      lines.push(`  纯 Jev：${p.choice || '—'}${probs ? ` [${probs}]` : ''}`);
    }
  }

  function formatGameRecord() {
    const result = gameResult?.text || (gameOver ? '对局结束' : gameStarted ? '进行中' : '未开始');
    const started = gameStartedAt instanceof Date ? gameStartedAt.toLocaleString() : '';
    const blackOwner = playerColor() === BLACK ? '玩家' : 'Jev / 本地引擎';
    const whiteOwner = playerColor() === WHITE ? '玩家' : 'Jev / 本地引擎';
    const rules = activeRuleConfig();
    const lines = [
      'Jev 五子棋棋谱',
      `棋盘：${SIZE}×${SIZE}`,
      `黑方：${blackOwner}`,
      `白方：${whiteOwner}`,
      `玩家棋色：${colorNameZh(playerColor())}`,
      `AI 棋色：${colorNameZh(aiColor())}`,
      `黑棋禁手：长连=${rules.overline ? '开' : '关'}；四四=${rules.fourFour ? '开' : '关'}；三三=${rules.threeThree ? '开' : '关'}`,
      `胜负规则：${rules.overline ? '黑棋恰好五连获胜；白棋五连及以上获胜' : '黑白双方五连及以上获胜'}`,
      `结果：${result}`,
      `开始：${started}`,
      `对局种子：${gameSeed}`,
      `手数：${moves.length}`,
      '',
      '【回合棋谱】'
    ];

    for (let i = 0; i < moves.length; i += 2) {
      const black = moves[i]?.coord || '—';
      const white = moves[i + 1]?.coord || '—';
      lines.push(`${Math.floor(i / 2) + 1}. 黑 ${black}  白 ${white}`);
    }

    lines.push('', '【逐手记录】');
    moves.forEach((m, i) => {
      lines.push(`${i + 1}. ${m.color === BLACK ? '黑' : '白'} ${m.coord}${m.source ? ` (${m.source})` : ''}`);
    });

    lines.push('', '【Jev / AI 决策过程】');
    const activeDecisions = jevDecisionLog.filter(d => d.moveNo <= moves.length);
    if (!activeDecisions.length) lines.push('—');
    else {
      activeDecisions.forEach((d, i) => {
        if (i) lines.push('');
        appendDecisionTrace(lines, d);
      });
    }

    lines.push('', `【紧凑序列】${moves.map(m => m.coord).join(' ') || '—'}`);
    return lines.join('\n');
  }

    async function copyGameRecord() {
    const text = formatGameRecord();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        throw new Error('clipboard API unavailable');
      }
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    copyCount++;
    if (copyCount === 3) triggerEasterEgg('copy_3', '棋谱已经背下来了。');
    if (copyCount === 5) triggerEasterEgg('copy_5', '真的没有偷偷改棋谱。');

    const old = copyRecordBtn.textContent;
    const resultOld = resultCopyBtn.textContent;
    copyRecordBtn.textContent = '已复制';
    resultCopyBtn.textContent = '已复制';
    toast(`已复制 ${moves.length} 手棋谱`);
    setTimeout(() => {
      copyRecordBtn.textContent = old;
      resultCopyBtn.textContent = resultOld;
    }, 1200);
  }

  function boardRows() {
    return board.map((row, r) => ({
      row: r + 1,
      cells: row.map(v => v === BLACK ? 'X' : v === WHITE ? 'O' : '.').join('')
    }));
  }

  function legalMoves(color = aiColor()) {
    const result = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (isLegalMoveForColor(r, c, color)) result.push({ r, c, key: coord(r, c) });
      }
    }
    return result;
  }

  // ------------------------------
  // V3 hybrid engine
  // Deterministic code handles geometry, counting, tactical forcing and search.
  // Jev receives semantic facts only, then performs narrow atomic judgements
  // followed by a reverse-order pairwise tournament.
  // ------------------------------

  const WIN_SEGMENTS = (() => {
    const result = [];
    const dirs = [[1,0],[0,1],[1,1],[1,-1]];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        for (const [dr, dc] of dirs) {
          const er = r + dr * 4, ec = c + dc * 4;
          if (er < 0 || er >= SIZE || ec < 0 || ec >= SIZE) continue;
          const cells = [];
          for (let k = 0; k < 5; k++) cells.push([r + dr*k, c + dc*k]);
          result.push(cells);
        }
      }
    }
    return result;
  })();

  const LINE_WEIGHTS = [0, 2, 28, 520, 32000, 1000000000];
  const ENGINE_PRESETS = {
    expert: {
      depth: 5, root: 14, branch: 7, semantic: 6, tournament: 4, radius: 2,
      vcfDepth: 4, vctDepth: 2, localTimeMs: 2200, localRootShare: .80,
      localWeight: .62, pairWeight: .27, atomicWeight: .11
    },
    grandmaster: {
      depth: 4, root: 12, branch: 7, semantic: 6, tournament: 3, radius: 2,
      vcfDepth: 4, vctDepth: 2, localTimeMs: 2400, localRootShare: .85,
      localWeight: .62, pairWeight: .27, atomicWeight: .11
    },
    max: {
      depth: 5, root: 16, branch: 7, semantic: 8, tournament: 4, radius: 2,
      vcfDepth: 5, vctDepth: 2, localTimeMs: 2500, localRootShare: .82,
      localWeight: .0, pairWeight: .0, atomicWeight: .0
    }
  };
  const MATE_SCORE = 1e14;
  const LOCAL_TT_MAX_ENTRIES = 50000;
  const LOCAL_TT_KEEP_GENERATIONS = 4;
  const localTranspositionTable = new Map();
  let localTtGeneration = 0;
  let localHashA = 0;
  let localHashB = 0;
  let activeLocalSearch = null;

  function localMix32(value) {
    let x = value >>> 0;
    x ^= x >>> 16;
    x = Math.imul(x, 0x7feb352d);
    x ^= x >>> 15;
    x = Math.imul(x, 0x846ca68b);
    x ^= x >>> 16;
    return x >>> 0;
  }

  function localHashStone(r, c, color, salt) {
    return localMix32((((r * SIZE + c + 1) * 3 + color) ^ salt) >>> 0);
  }

  function toggleLocalHash(r, c, color) {
    localHashA = (localHashA ^ localHashStone(r, c, color, 0x9e3779b9)) >>> 0;
    localHashB = (localHashB ^ localHashStone(r, c, color, 0x85ebca6b)) >>> 0;
  }

  function initializeLocalHash() {
    localHashA = 0;
    localHashB = 0;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const color = board[r][c];
        if (color !== EMPTY) toggleLocalHash(r, c, color);
      }
    }
  }

  function localSearchPlay(move, color) {
    board[move.r][move.c] = color;
    toggleLocalHash(move.r, move.c, color);
  }

  function localSearchUndo(move, color) {
    toggleLocalHash(move.r, move.c, color);
    board[move.r][move.c] = EMPTY;
  }

  function localRuleSignature() {
    const rules = activeRuleConfig();
    return `${rules.overline ? 1 : 0}${rules.fourFour ? 1 : 0}${rules.threeThree ? 1 : 0}`;
  }

  function localTtKey(toMove, cfg, depth) {
    // Move width is root-ply-sensitive in this engine. Include the ply profile
    // so a value searched under a wider node is never treated as an EXACT value
    // for a different narrowing profile. Iterative depths still share the root
    // child key (ply=1), allowing the prior depth's bestMove to order the next.
    const plyFromRoot = Math.max(0, Number(cfg.depth || depth) - depth);
    return `${aiColor()}:${toMove}:${localRuleSignature()}:${cfg.branch}:${cfg.radius}:p${plyFromRoot}:${localHashA}:${localHashB}`;
  }

  function pruneLocalTranspositionTable() {
    if (localTranspositionTable.size <= LOCAL_TT_MAX_ENTRIES) return;
    const minGeneration = Math.max(0, localTtGeneration - LOCAL_TT_KEEP_GENERATIONS);
    for (const [key, entry] of localTranspositionTable) {
      if ((entry?.generation ?? 0) < minGeneration) localTranspositionTable.delete(key);
      if (localTranspositionTable.size <= LOCAL_TT_MAX_ENTRIES) return;
    }
    if (localTranspositionTable.size <= LOCAL_TT_MAX_ENTRIES) return;
    const ranked = [...localTranspositionTable.entries()].sort((a, b) =>
      (a[1]?.depth || 0) - (b[1]?.depth || 0)
      || (a[1]?.generation || 0) - (b[1]?.generation || 0)
    );
    const removeCount = localTranspositionTable.size - LOCAL_TT_MAX_ENTRIES;
    for (let i = 0; i < removeCount; i++) localTranspositionTable.delete(ranked[i][0]);
  }

  function localTtPut(key, entry) {
    const previous = localTranspositionTable.get(key);
    if (!previous || entry.depth >= previous.depth || entry.flag === 'EXACT') {
      localTranspositionTable.set(key, {
        ...entry,
        generation: localTtGeneration
      });
    } else {
      previous.generation = localTtGeneration;
    }
    if (localTranspositionTable.size > LOCAL_TT_MAX_ENTRIES + 1024) pruneLocalTranspositionTable();
  }

  function prioritizeLocalMove(candidates, key) {
    if (!key) return candidates;
    const index = candidates.findIndex(move => move.key === key);
    if (index <= 0) return candidates;
    return [candidates[index], ...candidates.slice(0, index), ...candidates.slice(index + 1)];
  }

  function beginLocalSearchBudget(cfg) {
    const startedAt = performance.now();
    const budgetMs = Math.max(250, (Number(cfg.localTimeMs) || 1200) * TIMEOUT_SCALE);
    const rootShare = Math.max(.50, Math.min(.90, Number(cfg.localRootShare) || .75));
    const runtime = {
      startedAt,
      budgetMs,
      rootShare,
      deadline: startedAt + budgetMs,
      phaseDeadline: startedAt + Math.max(150, budgetMs * rootShare),
      timedOut: false,
      rootTimedOut: false,
      phase: 'root',
      checks: 0,
      depthReached: 0,
      targetDepth: cfg.depth
    };
    activeLocalSearch = runtime;
    return runtime;
  }

  function localSearchExpired() {
    const runtime = activeLocalSearch;
    if (!runtime) return false;
    runtime.checks++;
    const now = performance.now();
    if (now >= runtime.deadline) {
      runtime.timedOut = true;
      return true;
    }
    if (now >= runtime.phaseDeadline) {
      if (runtime.phase === 'root') runtime.rootTimedOut = true;
      return true;
    }
    return false;
  }

  function enterLocalTacticalPhase(runtime) {
    if (!runtime) return;
    runtime.phase = 'tactical';
    runtime.phaseDeadline = runtime.deadline;
  }

  function finishLocalSearchBudget(runtime) {
    if (!runtime) return null;
    const elapsedMs = Math.round(performance.now() - runtime.startedAt);
    const result = {
      budgetMs: runtime.budgetMs,
      rootShare: runtime.rootShare,
      elapsedMs,
      timedOut: runtime.timedOut || elapsedMs >= runtime.budgetMs,
      rootTimedOut: runtime.rootTimedOut,
      depthReached: runtime.depthReached,
      targetDepth: runtime.targetDepth,
      checks: runtime.checks,
      transpositionEntries: runtime.transpositionEntries ?? localTranspositionTable.size,
      transpositionGeneration: runtime.transpositionGeneration ?? localTtGeneration
    };
    if (activeLocalSearch === runtime) activeLocalSearch = null;
    return result;
  }

  function otherColor(color) { return color === WHITE ? BLACK : WHITE; }

  function evaluateStatic() {
    let whiteScore = 0;
    for (const seg of WIN_SEGMENTS) {
      let w = 0, b = 0;
      for (const [r, c] of seg) {
        if (board[r][c] === WHITE) w++;
        else if (board[r][c] === BLACK) b++;
      }
      if (w && b) continue;
      if (w) whiteScore += LINE_WEIGHTS[w];
      else if (b) whiteScore -= LINE_WEIGHTS[b] * 1.16;
    }
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (board[r][c] === EMPTY) continue;
        const d = Math.max(Math.abs(r - 7), Math.abs(c - 7));
        const bonus = Math.max(0, 8 - d) * .45;
        whiteScore += board[r][c] === WHITE ? bonus : -bonus;
      }
    }
    return aiColor() === WHITE ? whiteScore : -whiteScore;
  }

  function nearbyMoves(radius = 2) {
    let hasStone = false;
    const set = new Set();
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (board[r][c] === EMPTY) continue;
        hasStone = true;
        for (let dr = -radius; dr <= radius; dr++) {
          for (let dc = -radius; dc <= radius; dc++) {
            if (!dr && !dc) continue;
            const rr = r + dr, cc = c + dc;
            if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE || board[rr][cc] !== EMPTY) continue;
            set.add(rr * SIZE + cc);
          }
        }
      }
    }
    if (!hasStone) return [{ r: 7, c: 7, key: 'H8' }];
    return [...set].map(v => {
      const r = Math.floor(v / SIZE), c = v % SIZE;
      return { r, c, key: coord(r, c) };
    });
  }

  function wouldWin(r, c, color) {
    if (board[r][c] !== EMPTY) return false;
    board[r][c] = color;
    const yes = isWin(r, c, color);
    board[r][c] = EMPTY;
    return yes;
  }

  function immediateWins(color, radius = 2) {
    return nearbyMoves(radius)
      .filter(m => isLegalMoveForColor(m.r, m.c, color))
      .filter(m => wouldWin(m.r, m.c, color));
  }

  function localConnectivity(r, c, color) {
    let allies = 0, enemies = 0;
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) continue;
        if (board[rr][cc] === color) allies += Math.abs(dr) <= 1 && Math.abs(dc) <= 1 ? 2 : 1;
        else if (board[rr][cc] === otherColor(color)) enemies++;
      }
    }
    return { allies, enemies };
  }

  function lineTokensThrough(r, c, color, dr, dc, span = 5) {
    const tokens = [];
    for (let offset = -span; offset <= span; offset++) {
      const rr = r + dr * offset;
      const cc = c + dc * offset;
      if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) tokens.push('#');
      else if (board[rr][cc] === color) tokens.push('O');
      else if (board[rr][cc] === EMPTY) tokens.push('.');
      else tokens.push('#');
    }
    return tokens;
  }

  function lineWinningCompletionIndexes(tokens, center) {
    const points = new Set();
    for (let start = 0; start <= tokens.length - 5; start++) {
      if (start > center || start + 4 < center) continue;
      let own = 0, empty = 0, emptyIndex = -1, blocked = false;
      for (let i = start; i < start + 5; i++) {
        if (tokens[i] === '#') { blocked = true; break; }
        if (tokens[i] === 'O') own++;
        else if (tokens[i] === '.') { empty++; emptyIndex = i; }
      }
      if (!blocked && own === 4 && empty === 1) points.add(emptyIndex);
    }
    return points;
  }

  function directionalThreatPattern(r, c, color, dr, dc) {
    const tokens = lineTokensThrough(r, c, color, dr, dc);
    const center = 5;
    const completions = lineWinningCompletionIndexes(tokens, center);
    const openThreeExtensions = new Set();
    let twoPotential = 0;

    for (let start = 0; start <= tokens.length - 6; start++) {
      if (start > center || start + 5 < center) continue;
      const window = tokens.slice(start, start + 6);
      if (window.includes('#')) continue;
      const own = window.filter(v => v === 'O').length;
      const empty = 6 - own;
      if (own === 2 && empty === 4) twoPotential++;
    }

    for (let i = 1; i < tokens.length - 1; i++) {
      if (tokens[i] !== '.' || Math.abs(i - center) > 4) continue;
      tokens[i] = 'O';
      const nextCompletions = lineWinningCompletionIndexes(tokens, center);
      if (nextCompletions.size >= 2) openThreeExtensions.add(i);
      tokens[i] = '.';
    }

    return {
      winningPoints: completions.size,
      openFour: completions.size >= 2,
      rushFour: completions.size === 1,
      openThree: openThreeExtensions.size > 0,
      openThreeExtensions: openThreeExtensions.size,
      twoPotential
    };
  }

  function threatPatternClass(profile) {
    if (profile.winsNow) return 'WIN_NOW';
    if (profile.winningPoints >= 2 || profile.openFourDirections > 0) return 'OPEN_FOUR';
    if (profile.fourDirections >= 1 && profile.openThreeDirections >= 1) return 'FOUR_THREE';
    if (profile.fourDirections >= 2) return 'DOUBLE_FOUR';
    if (profile.fourDirections >= 1) return 'FOUR';
    if (profile.openThreeDirections >= 2) return 'DOUBLE_OPEN_THREE';
    if (profile.openThreeDirections >= 1) return 'OPEN_THREE';
    if (profile.twoDirections >= 2) return 'MULTI_TWO';
    if (profile.twoDirections === 1) return 'TWO';
    return 'POSITIONAL';
  }

  function threatPatternProfilePlaced(r, c, color) {
    let winningPoints = 0;
    let openFourDirections = 0;
    let rushFourDirections = 0;
    let openThreeDirections = 0;
    let twoDirections = 0;
    let activeDirections = 0;

    for (const [dr, dc] of RENJU_DIRS) {
      const line = directionalThreatPattern(r, c, color, dr, dc);
      winningPoints += line.winningPoints;
      if (line.openFour) openFourDirections++;
      if (line.rushFour) rushFourDirections++;
      if (line.openThree) openThreeDirections++;
      if (line.twoPotential > 0) twoDirections++;
      if (line.winningPoints > 0 || line.openThree || line.twoPotential > 0) activeDirections++;
    }

    const winsNow = isWin(r, c, color);
    const fourDirections = openFourDirections + rushFourDirections;
    const multiAxis = Math.max(0, activeDirections - 1);
    const score =
      (winsNow ? 900000000 : 0) +
      winningPoints * 180000 +
      openFourDirections * 120000 +
      rushFourDirections * 32000 +
      openThreeDirections * 6500 +
      twoDirections * 420 +
      multiAxis * 900;

    const profile = {
      winsNow,
      winningPoints,
      openFourDirections,
      rushFourDirections,
      fourDirections,
      openThreeDirections,
      twoDirections,
      activeDirections,
      multiAxis,
      score
    };
    profile.className = threatPatternClass(profile);
    return profile;
  }

  function previewThreatPattern(move, color) {
    if (!move || board[move.r]?.[move.c] !== EMPTY) {
      return { className: 'OCCUPIED', score: 0, winningPoints: 0, fourDirections: 0, openThreeDirections: 0, twoDirections: 0, multiAxis: 0 };
    }
    if (color === BLACK && !isLegalMoveForColor(move.r, move.c, color)) {
      return { className: 'ILLEGAL_FOR_BLACK', score: 0, winningPoints: 0, fourDirections: 0, openThreeDirections: 0, twoDirections: 0, multiAxis: 0 };
    }
    board[move.r][move.c] = color;
    const profile = threatPatternProfilePlaced(move.r, move.c, color);
    board[move.r][move.c] = EMPTY;
    return profile;
  }

  function fastPatternSeedScore(move, color) {
    let score = 0;
    for (const [dr, dc] of RENJU_DIRS) {
      for (let offset = -4; offset <= 4; offset++) {
        if (!offset) continue;
        const rr = move.r + dr * offset;
        const cc = move.c + dc * offset;
        if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) continue;
        const weight = 5 - Math.abs(offset);
        if (board[rr][cc] === color) score += weight * 8;
        else if (board[rr][cc] === otherColor(color)) score += weight * 3;
      }
    }
    const centerDistance = Math.max(Math.abs(move.r - 7), Math.abs(move.c - 7));
    return score + Math.max(0, 7 - centerDistance) * 2;
  }

  function patternHotspots(color, limit = 4, radius = 2) {
    const opponent = otherColor(color);
    // Candidate recall is intentionally cheap. Full live-three/four parsing is
    // deferred until the small semantic candidate set is analysed.
    return nearbyMoves(radius)
      .filter(move => isLegalMoveForColor(move.r, move.c, color))
      .map(move => ({
        ...move,
        patternPriority: fastPatternSeedScore(move, color)
          + fastPatternSeedScore(move, opponent) * .72
      }))
      .sort((a, b) => b.patternPriority - a.patternPriority)
      .slice(0, limit);
  }

  function mergeRootCandidates(primary, hotspots, limit) {
    // Preserve the engine's proven move ordering at the front because Alpha-Beta
    // pruning is extremely sensitive to root order. Pattern hotspots only replace
    // the weakest tail entries when they are genuinely new candidates.
    const result = primary.slice(0, limit);
    const keys = new Set(result.map(move => move.key));
    let replaceIndex = result.length - 1;

    for (const move of hotspots) {
      if (!move || keys.has(move.key)) continue;
      if (result.length < limit) {
        result.push(move);
        keys.add(move.key);
        continue;
      }
      while (replaceIndex >= Math.max(2, Math.floor(limit * .65))) {
        const displaced = result[replaceIndex];
        if (displaced) keys.delete(displaced.key);
        result[replaceIndex] = move;
        keys.add(move.key);
        replaceIndex--;
        break;
      }
    }
    return result;
  }

  function quickMoveScore(move, color) {
    board[move.r][move.c] = color;
    let score;
    if (isWin(move.r, move.c, color)) {
      score = MATE_SCORE;
    } else {
      const base = evaluateStatic();
      const conn = localConnectivity(move.r, move.c, color);
      score = (color === aiColor() ? base : -base) + conn.allies * 18 + conn.enemies * 5;
    }
    board[move.r][move.c] = EMPTY;
    return score;
  }

  function orderedMoves(color, limit, radius = 2) {
    const wins = immediateWins(color, radius);
    if (wins.length) return wins.map(m => ({ ...m, quick: MATE_SCORE })).slice(0, limit);
    const blocks = immediateWins(otherColor(color), radius)
      .filter(m => isLegalMoveForColor(m.r, m.c, color));
    if (blocks.length) {
      return blocks.map(m => ({ ...m, quick: quickMoveScore(m, color) }))
        .sort((a,b) => b.quick - a.quick).slice(0, limit);
    }
    return nearbyMoves(radius)
      .filter(m => isLegalMoveForColor(m.r, m.c, color))
      .map(m => ({ ...m, quick: quickMoveScore(m, color) }))
      .sort((a, b) => b.quick - a.quick)
      .slice(0, limit);
  }

  // VCF/VCT keep their compact deterministic memo key. Alpha-Beta below uses
  // the incremental Zobrist TT instead, so it no longer serializes 225 cells
  // at every search node.
  function boardCacheKey(toMove, depth) {
    let key = `${toMove}:${depth}:`;
    for (let r = 0; r < SIZE; r++) key += board[r].join('');
    return key;
  }

  function alphaBeta(depth, alpha, beta, toMove, cfg) {
    if (depth <= 0 || localSearchExpired()) return evaluateStatic();

    const key = localTtKey(toMove, cfg, depth);
    const alphaStart = alpha;
    const betaStart = beta;
    const cached = localTranspositionTable.get(key);
    if (cached) {
      cached.generation = localTtGeneration;
      if (cached.depth >= depth) {
        if (cached.flag === 'EXACT') return cached.value;
        if (cached.flag === 'LOWER') alpha = Math.max(alpha, cached.value);
        else if (cached.flag === 'UPPER') beta = Math.min(beta, cached.value);
        if (alpha >= beta) return cached.value;
      }
    }

    const immediate = immediateWins(toMove, cfg.radius);
    if (immediate.length) {
      const score = toMove === aiColor() ? MATE_SCORE + depth : -MATE_SCORE - depth;
      localTtPut(key, {
        depth,
        value: score,
        flag: 'EXACT',
        bestMove: immediate[0]?.key || null
      });
      return score;
    }

    const limit = Math.max(4, cfg.branch - Math.max(0, cfg.depth - depth - 1));
    const candidates = prioritizeLocalMove(
      orderedMoves(toMove, limit, cfg.radius),
      cached?.bestMove || null
    );
    if (!candidates.length) return evaluateStatic();

    const maximizing = toMove === aiColor();
    let value = maximizing ? -Infinity : Infinity;
    let bestMove = candidates[0]?.key || null;
    let explored = 0;
    let completedNode = true;

    for (const m of candidates) {
      if (localSearchExpired()) {
        completedNode = false;
        break;
      }
      explored++;
      localSearchPlay(m, toMove);
      let child;
      if (isWin(m.r, m.c, toMove)) {
        child = maximizing ? MATE_SCORE + depth : -MATE_SCORE - depth;
      } else {
        child = alphaBeta(depth - 1, alpha, beta, otherColor(toMove), cfg);
      }
      localSearchUndo(m, toMove);

      if (maximizing) {
        if (child > value) {
          value = child;
          bestMove = m.key;
        }
        if (value > alpha) alpha = value;
      } else {
        if (child < value) {
          value = child;
          bestMove = m.key;
        }
        if (value < beta) beta = value;
      }
      if (beta <= alpha) break;
    }

    if (!explored) return evaluateStatic();
    // A time-bounded partial node is useful to the current iterative layer, but
    // it is not a valid transposition bound and must never survive into another
    // depth or turn.
    if (!completedNode) return value;

    let flag = 'EXACT';
    if (value <= alphaStart) flag = 'UPPER';
    else if (value >= betaStart) flag = 'LOWER';
    localTtPut(key, { depth, value, flag, bestMove });
    return value;
  }

  function scoreRootMove(move, cfg) {
    const side = aiColor();
    const opponent = otherColor(side);
    // scoreRootMove is also used by benchmark/synchronous fallback paths, so
    // initialize from the actual board at the root instead of assuming a caller
    // has already seeded the incremental hash.
    initializeLocalHash();
    localSearchPlay(move, side);
    let score;
    if (isWin(move.r, move.c, side)) {
      score = MATE_SCORE * 10;
    } else {
      score = alphaBeta(cfg.depth - 1, -Infinity, Infinity, opponent, cfg);
      score += evaluateStatic() * .035;
    }
    localSearchUndo(move, side);
    return score;
  }

  function createdWinningPointsThroughPlaced(r, c, color) {
    const points = new Map();
    for (const [dr, dc] of RENJU_DIRS) {
      const tokens = lineTokensThrough(r, c, color, dr, dc);
      const center = 5;
      for (const index of lineWinningCompletionIndexes(tokens, center)) {
        const offset = index - center;
        const rr = r + dr * offset;
        const cc = c + dc * offset;
        if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE || board[rr][cc] !== EMPTY) continue;
        if (!isLegalMoveForColor(rr, cc, color)) continue;
        if (!wouldWin(rr, cc, color)) continue;
        const key = coord(rr, cc);
        points.set(key, { r: rr, c: cc, key });
      }
    }
    return [...points.values()];
  }

  function directDoubleWinCreators(color, radius = 2, maxCount = Infinity) {
    const movesFound = [];
    // Callers only use this after confirming the side has no win-now point.
    // Therefore every newly-created immediate win must pass through the creator,
    // so four directional lines are sufficient; no nested full-board win scan.
    for (const move of nearbyMoves(radius)) {
      if (!isLegalMoveForColor(move.r, move.c, color)) continue;
      board[move.r][move.c] = color;
      let winningPoints = [];
      try {
        if (isWin(move.r, move.c, color)) continue;
        winningPoints = createdWinningPointsThroughPlaced(move.r, move.c, color);
      } finally {
        board[move.r][move.c] = EMPTY;
      }
      if (winningPoints.length < 2) continue;
      movesFound.push({
        ...move,
        winningPoints: winningPoints.slice(0, 4).map(point => point.key)
      });
      if (movesFound.length >= maxCount) break;
    }
    return {
      count: movesFound.length,
      points: movesFound.map(move => move.key),
      moves: movesFound
    };
  }

  function directDoubleOpenThreeCreators(color, radius = 2, maxCount = Infinity) {
    const movesFound = [];
    for (const move of nearbyMoves(radius)) {
      if (!isLegalMoveForColor(move.r, move.c, color)) continue;
      board[move.r][move.c] = color;
      let row = null;
      try {
        if (isWin(move.r, move.c, color)) continue;
        const profile = threatPatternProfilePlaced(move.r, move.c, color);
        // Recall only: keep this main-thread scan cheap. Counter-forcing
        // resources are verified later by the Threat Worker before filtering.
        if (profile.openThreeDirections < 2) continue;
        row = {
          ...move,
          openThreeDirections: profile.openThreeDirections,
          multiAxis: profile.multiAxis,
          patternScore: Math.round(profile.score)
        };
      } finally {
        board[move.r][move.c] = EMPTY;
      }
      if (row) {
        movesFound.push(row);
        if (movesFound.length >= maxCount) break;
      }
    }
    return {
      count: movesFound.length,
      points: movesFound.map(move => move.key),
      moves: movesFound
    };
  }

  function countForkCreators(color, limit = 10, radius = 2, maxCount = Infinity) {
    let count = 0;
    let complete = true;
    const points = [];
    const movesFound = [];
    const candidates = orderedMoves(color, limit, radius);
    for (const m of candidates) {
      if (localSearchExpired()) {
        complete = false;
        break;
      }
      board[m.r][m.c] = color;
      const wins = isWin(m.r, m.c, color) ? 2 : immediateWins(color, radius).length;
      const defenderImmediate = wins >= 2 ? immediateWins(otherColor(color), radius).length : 0;
      board[m.r][m.c] = EMPTY;
      if (wins >= 2 && defenderImmediate === 0) {
        count++;
        points.push(m.key);
        movesFound.push({ r: m.r, c: m.c, key: m.key });
        if (count >= maxCount) break;
      }
    }
    return { count, points, moves: movesFound, complete };
  }

  function forcingExtensions(color, limit = 8, radius = 2) {
    const out = [];
    for (const m of orderedMoves(color, limit * 2, radius)) {
      if (localSearchExpired()) break;
      board[m.r][m.c] = color;
      const n = isWin(m.r, m.c, color) ? 2 : immediateWins(color, radius).length;
      board[m.r][m.c] = EMPTY;
      if (n >= 1) out.push({ ...m, force: n });
      if (out.length >= limit) break;
    }
    return out;
  }

  // VCF: limited-depth continuous-four proof search. It only follows genuinely
  // forced single-point blocks, so a positive result is much stronger than a
  // heuristic static score.
  function searchVCF(attacker, turns, radius = 2, memo = new Map()) {
    if (turns <= 0 || localSearchExpired()) return false;
    const defender = otherColor(attacker);
    if (immediateWins(attacker, radius).length) return true;
    if (immediateWins(defender, radius).length) return false;
    const memoKey = `VCF:${attacker}:${turns}:${boardCacheKey(attacker, 0)}`;
    if (memo.has(memoKey)) return memo.get(memoKey);

    const candidates = orderedMoves(attacker, 8, radius);
    for (const m of candidates) {
      if (localSearchExpired()) break;
      board[m.r][m.c] = attacker;
      if (isWin(m.r, m.c, attacker)) {
        board[m.r][m.c] = EMPTY;
        memo.set(memoKey, true);
        return true;
      }
      if (immediateWins(defender, radius).length) {
        board[m.r][m.c] = EMPTY;
        continue;
      }
      const threats = immediateWins(attacker, radius);
      if (threats.length >= 2) {
        board[m.r][m.c] = EMPTY;
        memo.set(memoKey, true);
        return true;
      }
      if (threats.length === 1) {
        const d = threats[0];
        if (!isLegalMoveForColor(d.r, d.c, defender)) {
          board[m.r][m.c] = EMPTY;
          memo.set(memoKey, true);
          return true;
        }
        board[d.r][d.c] = defender;
        const forced = !isWin(d.r, d.c, defender) && searchVCF(attacker, turns - 1, radius, memo);
        board[d.r][d.c] = EMPTY;
        board[m.r][m.c] = EMPTY;
        if (forced) {
          memo.set(memoKey, true);
          return true;
        }
        continue;
      }
      board[m.r][m.c] = EMPTY;
    }
    memo.set(memoKey, false);
    return false;
  }

  // VCT pressure search: extends VCF with open-three style extension points.
  // Because Gomoku VCT defense can be broad, this is intentionally exposed to
  // Jev as VCT_PRESSURE_FOUND rather than as a mathematical proof.
  function searchVCTPressure(attacker, turns, radius = 2, memo = new Map()) {
    if (turns <= 0 || localSearchExpired()) return false;
    if (searchVCF(attacker, Math.min(2, turns), radius, new Map())) return true;
    const defender = otherColor(attacker);
    if (immediateWins(defender, radius).length) return false;
    const memoKey = `VCT:${attacker}:${turns}:${boardCacheKey(attacker, 0)}`;
    if (memo.has(memoKey)) return memo.get(memoKey);

    const candidates = orderedMoves(attacker, 7, radius);
    for (const m of candidates) {
      if (localSearchExpired()) break;
      board[m.r][m.c] = attacker;
      if (isWin(m.r, m.c, attacker)) {
        board[m.r][m.c] = EMPTY;
        memo.set(memoKey, true);
        return true;
      }
      if (immediateWins(defender, radius).length) {
        board[m.r][m.c] = EMPTY;
        continue;
      }
      const direct = immediateWins(attacker, radius);
      if (direct.length >= 2) {
        board[m.r][m.c] = EMPTY;
        memo.set(memoKey, true);
        return true;
      }

      let defenses;
      if (direct.length === 1) {
        defenses = direct;
      } else {
        const ext = forcingExtensions(attacker, 5, radius);
        if (ext.length < 2) {
          board[m.r][m.c] = EMPTY;
          continue;
        }
        defenses = ext.slice(0, 4);
      }

      let allHold = defenses.length > 0;
      for (const d of defenses) {
        if (localSearchExpired()) { allHold = false; break; }
        if (board[d.r][d.c] !== EMPTY || !isLegalMoveForColor(d.r, d.c, defender)) continue;
        board[d.r][d.c] = defender;
        const survives = !isWin(d.r, d.c, defender) && searchVCTPressure(attacker, turns - 1, radius, memo);
        board[d.r][d.c] = EMPTY;
        if (!survives) { allHold = false; break; }
      }
      board[m.r][m.c] = EMPTY;
      if (allHold) {
        memo.set(memoKey, true);
        return true;
      }
    }
    memo.set(memoKey, false);
    return false;
  }

  function continuationVCFAfterCandidate(attacker, turns, radius = 2) {
    const defender = otherColor(attacker);
    if (immediateWins(defender, radius).length) return false;
    const threats = immediateWins(attacker, radius);
    if (threats.length >= 2) return true;
    if (threats.length === 1) {
      const d = threats[0];
      if (!isLegalMoveForColor(d.r, d.c, defender)) return true;
      board[d.r][d.c] = defender;
      const result = !isWin(d.r, d.c, defender) && searchVCF(attacker, turns - 1, radius, new Map());
      board[d.r][d.c] = EMPTY;
      return result;
    }
    return false;
  }

  function continuationVCTAfterCandidate(attacker, turns, radius = 2) {
    if (continuationVCFAfterCandidate(attacker, turns, radius)) return true;
    const defender = otherColor(attacker);
    if (immediateWins(defender, radius).length) return false;
    const direct = immediateWins(attacker, radius);
    let defenses = direct.length ? direct : forcingExtensions(attacker, 5, radius);
    if (!direct.length && defenses.length < 2) return false;
    defenses = defenses.slice(0, 4);
    let allHold = defenses.length > 0;
    for (const d of defenses) {
      if (localSearchExpired()) { allHold = false; break; }
      if (board[d.r][d.c] !== EMPTY || !isLegalMoveForColor(d.r, d.c, defender)) continue;
      board[d.r][d.c] = defender;
      const survives = !isWin(d.r, d.c, defender) && searchVCTPressure(attacker, turns - 1, radius, new Map());
      board[d.r][d.c] = EMPTY;
      if (!survives) { allHold = false; break; }
    }
    return allHold;
  }

  function semanticThreatLabel(winsNow, ownImmediate, forkCreators, vcf, vct) {
    if (winsNow) return 'IMMEDIATE_WIN';
    if (vcf) return 'VCF_FORCED_SEQUENCE';
    if (ownImmediate >= 2) return 'OPEN_FOUR_OR_DOUBLE_FOUR';
    if (ownImmediate === 1 && forkCreators >= 1) return 'FOUR_PLUS_FOLLOWUP';
    if (vct) return 'VCT_PRESSURE_SEQUENCE';
    if (forkCreators >= 2) return 'MULTIPLE_OPEN_THREE_PRESSURE';
    if (forkCreators === 1) return 'OPEN_THREE_PRESSURE';
    return 'POSITIONAL';
  }

  function connectionLabel(allies) {
    if (allies >= 8) return 'VERY_HIGH';
    if (allies >= 5) return 'HIGH';
    if (allies >= 2) return 'MEDIUM';
    return 'LOW';
  }

  function countLabel(n) {
    if (n <= 0) return 'NONE';
    if (n === 1) return 'ONE';
    return 'MULTIPLE';
  }

  function analyzeAdvancedCandidate(move, forced, cfg, mode = 'expert') {
    const side = aiColor();
    const opponent = otherColor(side);
    const blockedOpponentPattern = previewThreatPattern(move, opponent);
    board[move.r][move.c] = side;
    const ownPattern = threatPatternProfilePlaced(move.r, move.c, side);
    const winsNow = isWin(move.r, move.c, side);
    const ownImmediate = winsNow ? 2 : immediateWins(side, cfg.radius).length;
    const oppImmediate = winsNow ? 0 : immediateWins(opponent, cfg.radius).length;
    const forks = winsNow ? {count: 0, points: [], moves: []} : countForkCreators(side, 10, cfg.radius, 3);
    const opponentDirectDoubleWins = (!winsNow && ownImmediate === 0 && oppImmediate === 0)
      ? directDoubleWinCreators(opponent, cfg.radius, 2)
      : { count: 0, points: [], moves: [] };
    const opponentForks = (!winsNow && ownImmediate === 0 && oppImmediate === 0 && opponentDirectDoubleWins.count === 0)
      ? countForkCreators(opponent, 12, cfg.radius, 2)
      : { count: 0, points: [], moves: [], complete: true };
    const conn = localConnectivity(move.r, move.c, side);
    const vcf = winsNow || (!oppImmediate && continuationVCFAfterCandidate(side, cfg.vcfDepth, cfg.radius));
    const vct = !vcf && !oppImmediate && cfg.vctDepth > 0 && continuationVCTAfterCandidate(side, cfg.vctDepth, cfg.radius);
    const opponentCounterVCF = !winsNow && !ownImmediate && !opponentDirectDoubleWins.count && !opponentForks.count
      && searchVCF(opponent, Math.min(2, cfg.vcfDepth), cfg.radius, new Map());
    const opponentCounterVCT = !winsNow && !ownImmediate && !opponentDirectDoubleWins.count && !opponentForks.count && !opponentCounterVCF && cfg.vctDepth > 0
      && searchVCTPressure(opponent, Math.min(2, cfg.vctDepth + 1), cfg.radius, new Map());
    board[move.r][move.c] = EMPTY;

    const tacticalVerificationComplete = opponentForks.complete !== false
      && !Boolean(activeLocalSearch?.timedOut);
    let safety = mode === 'max' && !tacticalVerificationComplete ? 'UNVERIFIED_BUDGET' : 'SAFE';
    if (oppImmediate >= 2) safety = 'LOSING';
    else if (oppImmediate === 1) safety = 'UNSAFE';
    else if (opponentDirectDoubleWins.count >= 1) safety = 'LOSING';
    else if (opponentForks.count >= 1) safety = 'LOSING';
    else if (opponentCounterVCF || opponentCounterVCT) safety = 'TACTICALLY_RISKY';

    const forcedRole = winsNow ? 'WIN_NOW'
      : forced === 'block' ? 'MUST_DEFEND'
      : forced === 'block_fork' ? 'MUST_DEFEND_FORK'
      : forced === 'win' ? 'WIN_NOW'
      : 'NORMAL';
    const attack = semanticThreatLabel(winsNow, ownImmediate, forks.count, vcf, vct);
    const initiative = winsNow || vcf || ownImmediate >= 1 ? 'FORCING'
      : vct || forks.count >= 1 ? 'PRESSURE'
      : 'BALANCED';

    return {
      winsNow,
      ownImmediate,
      oppImmediate,
      forkCreators: forks.count,
      vcf,
      vct,
      blackCounterVCF: opponentCounterVCF,
      blackCounterVCT: opponentCounterVCT,
      opponentCounterVCF,
      opponentCounterVCT,
      ownPattern,
      blockedOpponentPattern,
      patternDecisionScore: ownPattern.score + blockedOpponentPattern.score * .72,
      facts: {
        forced_role: forcedRole,
        tactical_safety: safety,
        tactical_verification: tacticalVerificationComplete ? 'COMPLETE' : 'BUDGET_EXHAUSTED',
        attack_shape: attack,
        initiative,
        own_immediate_winning_points_after_move: countLabel(ownImmediate),
        opponent_immediate_winning_points_after_move: countLabel(oppImmediate),
        opponent_direct_double_win_creators_after_move: countLabel(opponentDirectDoubleWins.count),
        opponent_direct_double_win_creator_points: opponentDirectDoubleWins.moves.length
          ? opponentDirectDoubleWins.moves.map(item => item.key + '->' + item.winningPoints.join('/')).join(',')
          : 'NONE',
        opponent_fork_creators_after_move: countLabel(opponentForks.count),
        opponent_fork_creator_points: opponentForks.points.length ? opponentForks.points.join(',') : 'NONE',
        vcf_status: vcf ? 'FORCED_SEQUENCE_FOUND' : 'NOT_FOUND',
        vct_status: vct ? 'PRESSURE_SEQUENCE_FOUND' : 'NOT_FOUND',
        opponent_counter_vcf: opponentCounterVCF ? 'FOUND' : 'NOT_FOUND',
        opponent_counter_vct: opponentCounterVCT ? 'PRESSURE_FOUND' : 'NOT_FOUND',
        connectivity: connectionLabel(conn.allies),
        centrality: Math.max(Math.abs(move.r - 7), Math.abs(move.c - 7)) <= 3 ? 'CENTRAL' : 'OUTER',
        pattern_class: ownPattern.className,
        pattern_score: Math.round(ownPattern.score),
        pattern_winning_points: ownPattern.winningPoints,
        pattern_four_directions: ownPattern.fourDirections,
        pattern_open_three_directions: ownPattern.openThreeDirections,
        pattern_two_directions: ownPattern.twoDirections,
        pattern_multi_axis: ownPattern.multiAxis,
        blocks_opponent_pattern: blockedOpponentPattern.className,
        blocks_opponent_pattern_score: Math.round(blockedOpponentPattern.score)
      }
    };
  }

  function scoreRootsWithinLocalBudget(roots, cfg, runtime) {
    const side = aiColor();
    localTtGeneration++;
    pruneLocalTranspositionTable();

    let completed = roots.map(move => ({
      ...move,
      searchScore: quickMoveScore(move, side)
    }));
    let rootOrder = [...completed];
    let depthReached = 0;

    const startDepth = Math.min(cfg.depth, 3);
    for (let depth = startDepth; depth <= cfg.depth; depth++) {
      if (localSearchExpired()) {
        runtime.rootTimedOut = true;
        break;
      }

      const depthCfg = { ...cfg, depth };
      const iteration = [];
      let complete = true;

      // Preserve the previous completed iteration's PV/root ordering. Combined
      // with TT best-move ordering this improves cutoffs without reducing any
      // depth, branch width, or tactical candidate coverage.
      for (const move of rootOrder) {
        if (localSearchExpired()) {
          complete = false;
          runtime.rootTimedOut = true;
          break;
        }
        iteration.push({
          ...move,
          searchScore: scoreRootMove(move, depthCfg)
        });
      }

      if (!complete) break;
      iteration.sort((a, b) => b.searchScore - a.searchScore);
      completed = iteration;
      rootOrder = iteration;
      depthReached = depth;
      runtime.depthReached = depth;
    }

    if (!depthReached && cfg.depth < 3) runtime.depthReached = cfg.depth;
    runtime.transpositionEntries = localTranspositionTable.size;
    runtime.transpositionGeneration = localTtGeneration;
    return completed.sort((a, b) => b.searchScore - a.searchScore);
  }

  function advancedEngineConfig(mode) {
    const base = ENGINE_PRESETS[mode] || ENGINE_PRESETS.expert;
    if ((mode === 'expert' || mode === 'grandmaster' || mode === 'max') && moves.length < 4) {
      // Only the first four plies use the shallow opening profile. From ply 5
      // onward Expert/Grandmaster restore their full local search settings;
      // the local wall-clock budget below prevents pathological UI stalls.
      return {
        ...base,
        depth: 3,
        root: Math.min(base.root, 10),
        branch: Math.min(base.branch, 6),
        semantic: mode === 'max' ? Math.min(base.semantic, 6) : Math.min(base.semantic, 5),
        vcfDepth: Math.min(base.vcfDepth, 3),
        vctDepth: Math.min(base.vctDepth, 1),
        openingAdaptive: true
      };
    }
    return { ...base, openingAdaptive: false };
  }

  function maxCandidateLimit() {
    const cores = Number(globalThis.navigator?.hardwareConcurrency || 0);
    return cores > 0 && cores <= 4 ? 6 : 8;
  }

  function addRecallSource(move, source) {
    if (!move) return move;
    if (!Array.isArray(move.recallSources)) move.recallSources = [];
    if (!move.recallSources.includes(source)) move.recallSources.push(source);
    return move;
  }

  function buildAdvancedCandidates(mode) {
    const cfg = advancedEngineConfig(mode);
    const runtime = beginLocalSearchBudget(cfg);
    let result;

    try {
      const side = aiColor();
      const opponent = otherColor(side);
      // Immediate win / mandatory block detection is deliberately not skipped on
      // timeout; legality and one-ply tactics remain deterministic safety rails.
      const ownWins = immediateWins(side, cfg.radius);
      const opponentWins = immediateWins(opponent, cfg.radius);
      let forced = null;
      let roots;
      let primaryRoots = [];
      let hotspots = [];
      let defensiveHotspots = [];
      let directDoubleWinBlocks = [];
      let doubleOpenThreeBlocks = [];
      let opponentForkBlocks = [];
      let counterThreatBlocks = [];

      if (ownWins.length) {
        forced = 'win';
        roots = ownWins;
      } else if (opponentWins.length) {
        forced = opponentWins.length >= 2 ? 'forced_loss_double_win' : 'block';
        roots = opponentWins.filter(move => isLegalMoveForColor(move.r, move.c, side));
      } else {
        const opponentDirectDoubleWins = directDoubleWinCreators(opponent, cfg.radius, 4);
        // Double-open-three creators are one ply earlier than the existing
        // direct-double-win/open-four detector. They matter in the early-midgame
        // too, so do not gate them behind the old moves.length >= 16 threshold.
        const opponentDoubleOpenThrees = mode === 'max' && !localSearchExpired()
          ? directDoubleOpenThreeCreators(opponent, cfg.radius, 3)
          : { count: 0, points: [], moves: [] };
        const opponentForks = moves.length >= 16 && !localSearchExpired()
          ? countForkCreators(opponent, Math.max(12, cfg.root), cfg.radius, 2)
          : { count: 0, points: [], moves: [] };
        if (opponentForks.count === 1 && mode !== 'max') {
          forced = 'block_fork';
          roots = opponentForks.moves.filter(move => isLegalMoveForColor(move.r, move.c, side));
        } else {
          primaryRoots = orderedMoves(side, cfg.root, cfg.radius);
          directDoubleWinBlocks = mode === 'max'
            ? opponentDirectDoubleWins.moves.filter(move => isLegalMoveForColor(move.r, move.c, side))
            : [];
          doubleOpenThreeBlocks = mode === 'max'
            ? opponentDoubleOpenThrees.moves.filter(move => isLegalMoveForColor(move.r, move.c, side))
            : [];
          hotspots = localSearchExpired() ? [] : patternHotspots(side, mode === 'max' ? 5 : 3, cfg.radius);
          defensiveHotspots = mode === 'max' && !localSearchExpired()
            ? patternHotspots(opponent, 5, cfg.radius)
                .filter(move => isLegalMoveForColor(move.r, move.c, side))
            : [];
          opponentForkBlocks = mode === 'max'
            ? opponentForks.moves.filter(move => isLegalMoveForColor(move.r, move.c, side))
            : [];
          counterThreatBlocks = mode === 'max' && !localSearchExpired()
            ? forcingExtensions(opponent, 5, cfg.radius)
                .filter(move => isLegalMoveForColor(move.r, move.c, side))
            : [];
          // Keep the Alpha-Beta root width bounded. Jev Max treats a unique
          // fork-creator as strong defensive evidence, not a mathematical
          // single-move proof: a second forcing branch may still exist.
          roots = mergeRootCandidates(
            mergeRootCandidates(
              mergeRootCandidates(
                mergeRootCandidates(primaryRoots, directDoubleWinBlocks, cfg.root),
                doubleOpenThreeBlocks,
                cfg.root
              ),
              opponentForkBlocks,
              cfg.root
            ),
            hotspots,
            cfg.root
          );
        }
      }

      const scored = scoreRootsWithinLocalBudget(roots, cfg, runtime);
      enterLocalTacticalPhase(runtime);

      let selected;
      if (mode === 'max' && !forced) {
        const limit = Math.min(maxCandidateLimit(), cfg.semantic);
        const scoredByKey = new Map(scored.map(move => [move.key, move]));
        const recall = new Map();
        const add = (sourceMove, source) => {
          if (!sourceMove || recall.size >= limit && !recall.has(sourceMove.key)) return;
          let move = recall.get(sourceMove.key);
          if (!move) {
            const scoredMove = scoredByKey.get(sourceMove.key);
            move = {
              ...sourceMove,
              ...(scoredMove || {}),
              searchScore: Number.isFinite(scoredMove?.searchScore) ? scoredMove.searchScore : null,
              recallSources: []
            };
            recall.set(move.key, move);
          }
          addRecallSource(move, source);
        };

        directDoubleWinBlocks.slice(0, 4).forEach(move => add(move, 'DIRECT_OPEN_FOUR_BLOCK'));
        doubleOpenThreeBlocks.slice(0, 3).forEach(move => add(move, 'DOUBLE_OPEN_THREE_BLOCK'));
        scored.slice(0, 2).forEach(move => add(move, 'LOCAL_ALPHA_BETA'));
        hotspots.slice(0, 2).forEach(move => add(move, 'PATTERN_EXPERT'));
        opponentForkBlocks.slice(0, 2).forEach(move => add(move, 'DEFENSIVE_FORK_BLOCK'));
        counterThreatBlocks.slice(0, 3).forEach(move => add(move, 'COUNTER_THREAT_BLOCK'));
        defensiveHotspots.slice(0, 2).forEach(move => add(move, 'DEFENSIVE_COUNTER_THREAT'));
        scored.slice(2, 5).forEach(move => add(move, 'LOCAL_DEEP_SEED'));

        const strategic = primaryRoots.find(move => !recall.has(move.key));
        if (strategic) add(strategic, 'STRATEGIC_WILDCARD');

        for (const move of scored) {
          if (recall.size >= limit) break;
          add(move, 'LOCAL_RECALL');
        }
        selected = [...recall.values()].slice(0, limit);
      } else {
        selected = scored.slice(0, Math.min(cfg.semantic, scored.length));
        selected.forEach(move => addRecallSource(move, 'LOCAL_ALPHA_BETA'));
      }

      selected.forEach((m, i) => {
        m.rank = i + 1;
        m.analysis = analyzeAdvancedCandidate(m, forced, cfg, mode);
        m.analysis.facts.candidate_sources = [...(m.recallSources || [])];
        if (m.analysis.vcf) addRecallSource(m, 'VCF');
        if (m.analysis.vct) addRecallSource(m, 'VCT');
        m.analysis.facts.candidate_sources = [...(m.recallSources || [])];
      });

      // Max keeps ordinary finite-horizon disagreement visible to Jev. Only exact
      // one-ply wins are collapsed here; proven opponent forcing losses are filtered
      // later by Threat-space Search. Existing modes retain their proven filters.
      const immediate = selected.filter(m => m.analysis.winsNow);
      if (immediate.length) {
        selected = immediate;
      } else if (mode !== 'max') {
        const fullySafe = selected.filter(m => m.analysis.facts.tactical_safety === 'SAFE');
        if (fullySafe.length) selected = fullySafe;
        else {
          const survivable = selected.filter(m => !['LOSING','UNSAFE'].includes(m.analysis.facts.tactical_safety));
          if (survivable.length) selected = survivable;
        }
        const proven = selected.filter(m => m.analysis.vcf);
        if (proven.length) selected = proven;
      }

      selected.forEach((m,i) => {
        m.rank = i + 1;
        m.analysis.facts.local_engine_grade = i === 0 ? 'TOP_CHOICE' : i === 1 ? 'STRONG' : i <= 3 ? 'SOLID' : 'SECONDARY';
        m.analysis.facts.local_rank = i + 1;
        m.analysis.facts.candidate_sources = [...(m.recallSources || [])];
      });
      result = {
        mode,
        cfg,
        forced,
        candidates: selected,
        recall: mode === 'max'
          ? selected.map(move => ({ move: move.key, sources: [...(move.recallSources || [])] }))
          : null
      };
    } finally {
      const localSearch = finishLocalSearchBudget(runtime);
      if (result) result.localSearch = localSearch;
    }

    return result;
  }

  function gomokuDecisionDoctrine() {
    return {
      evidence_order: 'LEGALITY_AND_PROOF > FORCED_THREAT > DEEP_SEARCH > PATTERN_HEURISTIC > POSITIONAL_STYLE',
      threat_hierarchy: 'WIN > OPEN_FOUR / DOUBLE_FOUR / FOUR_THREE > FOUR > OPEN_THREE / VCT > MULTI_TWO > POSITION',
      sequencing: 'Move order matters. Preserve latent three/four resources unless converting them creates a concrete forced gain; do not spend forcing moves just because they are available.',
      defense: 'A legal opponent move that creates two legal immediate winning points (for example extending an open diagonal three into a double-ended open four) is deterministic hard tactical evidence. If your move does not create an immediate forcing reply, it must remove all such one-ply creators before positional preference is considered.',
      counter_threat: 'A move is not automatically safe just because it creates one forcing threat. If the opponent has a forced defensive reply, inspect the board after that reply: residual forcing extensions, fork creators, and multi-axis junctions may leave the original attack intact.',
      geometry: 'Inspect horizontal, vertical, and both diagonals equally. Multi-axis intersections and moves that reduce the opponent reply set are strategically important.',
      opening: 'In the early game, value connected central influence, multiple two-to-three extension routes, and denying the opponent equivalent extension routes over isolated stones.',
      caution: 'pattern_* fields are fast heuristic shape evidence, not mathematical proof. Missing or timed-out tactical evidence is UNKNOWN, never SAFE. Before comparing finalists, require equivalent Threat-space coverage; threat-space FOUND and proven VCF remain higher authority.'
    };
  }

  function buildPureJevRequest() {
    const side = aiColor();
    const opponent = otherColor(side);
    const legal = legalMoves(side);
    const criteria = Object.fromEntries(legal.map(m => [m.key, null]));
    const last = moves.length ? moves[moves.length - 1].coord : null;
    const sideName = colorNameEn(side);
    return {
      mode: 'jev',
      candidates: legal,
      payload: {
        state: {
          game: 'Gomoku / Five in a Row',
          board_size: '15x15',
          you_are: `${sideName} (${colorStoneEn(side)})`,
          opponent_is: `${colorNameEn(opponent)} (${colorStoneEn(opponent)})`,
          side_to_move: sideName,
          coordinate_system: 'Columns A-O left to right; rows 1-15 top to bottom; H8 is center.',
          rules: renjuRuleDescription(),
          last_move: last,
          board_legend: boardLegendForAi(),
          board_rows: boardRows(),
          gomoku_doctrine: gomokuDecisionDoctrine()
        },
        model: settings.model || 'jev-latest',
        questions: {
          best_move: {
            type: 'choice',
            instructions: `Choose the best legal move for ${sideName}. Use state.gomoku_doctrine as strategic guidance, but concrete board tactics and legality are authoritative. Never ignore an immediate win or an opponent one-move win. Obey the configured BLACK forbidden-move rules exactly.`,
            criteria
          }
        }
      }
    };
  }

  function candidateFactsMap(candidates) {
    return Object.fromEntries(candidates.map(m => {
      const facts = { ...(m.analysis?.facts || {}) };
      // Jev acts as an independent challenger. Do not reveal Local's rank/grade,
      // otherwise the semantic judge can simply anchor on the deterministic engine.
      delete facts.local_engine_grade;
      delete facts.local_rank;
      return [m.key, facts];
    }));
  }

  function buildAtomicPayload(context) {
    const questions = {};
    for (const m of context.candidates) {
      questions[`judge_${m.key}`] = {
        type: 'choice',
        instructions: `Judge ${m.key} using state.atomic_policy and candidate_facts.${m.key}.`,
        criteria: {
          EXCELLENT: 'The supplied facts indicate a strategically preferred move with strong initiative and tactical safety.',
          GOOD: 'The move is sound and useful, but not clearly dominant.',
          NEUTRAL: 'The move is playable but offers limited forcing value.',
          RISKY: 'The move has meaningful strategic or tactical concerns.',
          BAD: 'The supplied facts indicate this move should be avoided.'
        }
      };
    }
    return {
      state: {
        task: 'Independent Gomoku challenger evaluation after deterministic tactical analysis.',
        side: colorNameEn(aiColor()),
        board_size: '15x15',
        coordinate_system: 'Columns A-O left to right; rows 1-15 top to bottom.',
        board_legend: boardLegendForAi(),
        rules: renjuRuleDescription(),
        last_move: moves.length ? moves[moves.length - 1].coord : null,
        board_rows: boardRows(),
        instruction: 'Independently inspect the board geometry as well as the supplied candidate facts. The facts are horizon-limited hints, not a ranking and not infallible. Priority: immediate win > mandatory defense > forced tactical sequences > safety > initiative > connectivity.',
        atomic_policy: 'Judge each candidate independently from board geometry and candidate_facts. Deterministic facts may be horizon-limited; concrete board tactics and legality are authoritative.',
        candidate_facts: candidateFactsMap(context.candidates)
      },
      model: settings.model || 'jev-latest',
      questions
    };
  }

  function atomicScore(answer) {
    const weights = { EXCELLENT: 1, GOOD: .78, NEUTRAL: .5, RISKY: .22, BAD: 0 };
    const probs = answer?.probabilities;
    if (probs && typeof probs === 'object') {
      let total = 0, mass = 0;
      for (const [k,w] of Object.entries(weights)) {
        const p = Number(probs[k] || 0);
        total += p * w; mass += p;
      }
      if (mass > 0) return total / mass;
    }
    return weights[String(answer?.choice || '').toUpperCase()] ?? .5;
  }

  function buildPairwisePayload(candidates) {
    const questions = {};
    const pairs = [];
    let n = 0;
    const facts = candidateFactsMap(candidates);
    const pairwisePolicy = `Choose the stronger move for ${colorNameEn(aiColor())}. Independently check the full board and shared candidate facts. Priority: immediate win > mandatory defense > forced tactical sequences > safety > forcing initiative > connectivity. Obey configured BLACK forbidden-move rules. No Local ranking is authoritative.`;
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const a = candidates[i].key, b = candidates[j].key;
        const id = n++;
        questions[`duel_${id}_ab`] = {
          type: 'choice',
          instructions: `Compare ${a} vs ${b}; apply state.pairwise_policy.`,
          criteria: { [a]: `See candidate_facts.${a}`, [b]: `See candidate_facts.${b}` }
        };
        questions[`duel_${id}_ba`] = {
          type: 'choice',
          instructions: `Compare ${b} vs ${a}; apply state.pairwise_policy.`,
          criteria: { [b]: `See candidate_facts.${b}`, [a]: `See candidate_facts.${a}` }
        };
        pairs.push({ id, a, b });
      }
    }
    return {
      payload: {
        state: {
          task: 'Independent pairwise Gomoku move tournament.',
          side: colorNameEn(aiColor()),
          board_size: '15x15',
          coordinate_system: 'Columns A-O left to right; rows 1-15 top to bottom.',
          board_legend: boardLegendForAi(),
          rules: renjuRuleDescription(),
          last_move: moves.length ? moves[moves.length - 1].coord : null,
          board_rows: boardRows(),
          pairwise_policy: pairwisePolicy,
          note: 'Pairs are asked twice with reversed option order to reduce presentation-order bias. Shared candidate facts are sent once.',
          candidate_facts: facts
        },
        model: settings.model || 'jev-latest',
        questions
      },
      pairs
    };
  }

  function buildBatchedDecisionPayload(context, tournament) {
    const atomic = buildAtomicPayload(context);
    const pairwise = buildPairwisePayload(tournament);
    return {
      payload: {
        state: {
          ...atomic.state,
          batching: {
            strategy: 'single_request_atomic_plus_pairwise',
            candidate_count: context.candidates.length,
            tournament_count: tournament.length
          }
        },
        model: settings.model || 'jev-latest',
        questions: {
          ...atomic.questions,
          ...pairwise.payload.questions
        }
      },
      pairs: pairwise.pairs
    };
  }

  function compactEvidence(value) {
    return Object.fromEntries(
      Object.entries(value || {}).filter(([, item]) => item !== null && item !== undefined)
    );
  }

  function factorCommonCandidateEvidence(criteria) {
    const keys = Object.keys(criteria || {});
    if (keys.length < 2) return { common: {}, criteria };

    const first = criteria[keys[0]] || {};
    const common = {};
    for (const [field, value] of Object.entries(first)) {
      if (keys.every(key => Object.prototype.hasOwnProperty.call(criteria[key] || {}, field)
        && criteria[key][field] === value)) {
        common[field] = value;
      }
    }

    if (!Object.keys(common).length) return { common, criteria };

    const compactCriteria = Object.fromEntries(keys.map(key => {
      const candidate = criteria[key] || {};
      return [key, Object.fromEntries(
        Object.entries(candidate).filter(([field]) => !Object.prototype.hasOwnProperty.call(common, field))
      )];
    }));
    return { common, criteria: compactCriteria };
  }

  function isSentinelSearchScore(score) {
    return Number.isFinite(score) && Math.abs(score) >= MATE_SCORE * .9;
  }

  function structuredForcedResult(score, proofType = 'SEARCH_SENTINEL', proven = false) {
    if (!isSentinelSearchScore(score)) return null;
    return {
      forced: true,
      result: score > 0 ? 'win' : 'loss',
      proof_type: proofType,
      proven: Boolean(proven),
      advisory: !proven
    };
  }

  function localScoreEvidence(score) {
    if (!Number.isFinite(score)) return {};
    const forced = structuredForcedResult(score, 'LOCAL_ALPHA_BETA_SENTINEL', false);
    return forced
      ? { local_forced_result: forced }
      : { local_alpha_beta_score: Number(score.toFixed(2)) };
  }

  function deepRowForJev(row, deepAnalysis) {
    if (!row) return null;
    const noDepth = deepAnalysis?.status === 'no_completed_depth'
      || Number(deepAnalysis?.depthReached || 0) <= 0
      || deepAnalysis?.rankingOnly === true;
    if (noDepth) {
      return compactEvidence({
        status: 'no_completed_depth',
        ranking_only: true,
        fallback_rank: row.fallbackRank ?? null
      });
    }

    const forced = row.forcedResult?.forced
      ? {
          forced: true,
          result: row.forcedResult.result,
          proof_type: row.forcedResult.proofType || 'DEEP_SEARCH_SENTINEL',
          mate_or_forcing_distance: row.forcedResult.mateOrForcingDistance ?? null,
          proven: false,
          advisory: true
        }
      : structuredForcedResult(row.score, 'DEEP_SEARCH_SENTINEL', false);

    const replies = Array.isArray(row.opponentBestReplies)
      ? row.opponentBestReplies.slice(0, 2).map(reply => compactEvidence({
          move: reply.move,
          score: Number.isFinite(reply.score) && !isSentinelSearchScore(reply.score)
            ? Number(reply.score.toFixed(2))
            : null,
          forced_result: reply.forcedResult?.forced
            ? compactEvidence({
                result: reply.forcedResult.result,
                proof_type: reply.forcedResult.proofType || 'DEEP_SEARCH',
                mate_or_forcing_distance: reply.forcedResult.mateOrForcingDistance ?? null
              })
            : structuredForcedResult(reply.score, 'DEEP_SEARCH_REPLY_SENTINEL', false),
          tactical_facts: reply.tacticalFacts || null
        }))
      : [];

    return compactEvidence({
      status: 'completed',
      ranking_only: false,
      score: !forced && Number.isFinite(row.score) ? Number(row.score.toFixed(2)) : null,
      forced_result: forced,
      principal_variation: Array.isArray(row.principalVariation)
        ? row.principalVariation.slice(0, 8)
        : null,
      opponent_best_replies: replies.length ? replies : null
    });
  }

  function deepEvidenceMap(deepAnalysis) {
    const rows = Array.isArray(deepAnalysis?.scores) ? deepAnalysis.scores : [];
    return new Map(rows.map((row, index) => [
      row.move,
      {
        row,
        rank: deepAnalysis?.status === 'completed' && Number(deepAnalysis?.depthReached || 0) > 0
          ? index + 1
          : null,
        evidence: deepRowForJev(row, deepAnalysis)
      }
    ]));
  }

  function buildFinalJevPayload(context, candidates, deepAnalysis, threatAnalysis = null) {
    const threatRows = Array.isArray(threatAnalysis?.analyses) ? threatAnalysis.analyses : [];
    const threatByMove = new Map(threatRows.map(item => [item.move, item]));
    const deepByMove = deepEvidenceMap(deepAnalysis);
    const criteria = {};

    for (const move of candidates) {
      const deep = deepByMove.get(move.key) || null;
      const threat = threatByMove.get(move.key) || move.threatSearch || null;
      const facts = move.analysis?.facts || {};
      criteria[move.key] = compactEvidence({
        local_rank: move.rank ?? null,
        ...localScoreEvidence(move.searchScore),
        deep_search_rank: deep?.rank ?? null,
        deep_search: deep?.evidence || null,
        opponent_forcing_proof: threat?.forced === true ? 'FOUND' : threat?.timedOut ? 'TIMEOUT' : threat ? 'NOT_FOUND' : null,
        opponent_forcing_line: Array.isArray(threat?.line) && threat.line.length ? threat.line.slice(0, 12).join(' > ') : null,
        opponent_forcing_attacker_turns: Number.isFinite(threat?.attackerTurns) ? threat.attackerTurns : null,
        opponent_counter_threat: threat?.counterThreat ? compactEvidence({
          risk: threat.counterThreat.risk || 'NONE',
          reason: threat.counterThreat.reason || null,
          forced_defense_move: threat.counterThreat.forcedDefenseMove || null,
          network_moves: Array.isArray(threat.counterThreat.networkMoves)
            ? threat.counterThreat.networkMoves.slice(0, 4)
            : null
        }) : null,
        candidate_sources: Array.isArray(move.recallSources) && move.recallSources.length ? move.recallSources : null,
        forced_role: facts.forced_role || 'NORMAL',
        tactical_safety: facts.tactical_safety || 'UNKNOWN',
        attack_shape: facts.attack_shape || 'POSITIONAL',
        initiative: facts.initiative || 'BALANCED',
        own_immediate_winning_points_after_move: facts.own_immediate_winning_points_after_move || 'NONE',
        opponent_immediate_winning_points_after_move: facts.opponent_immediate_winning_points_after_move || 'NONE',
        opponent_direct_double_win_creators_after_move: facts.opponent_direct_double_win_creators_after_move || 'NONE',
        opponent_direct_double_win_creator_points: facts.opponent_direct_double_win_creator_points || 'NONE',
        opponent_fork_creators_after_move: facts.opponent_fork_creators_after_move || 'NONE',
        vcf_status: facts.vcf_status || 'NOT_FOUND',
        vct_status: facts.vct_status || 'NOT_FOUND',
        opponent_counter_vcf: facts.opponent_counter_vcf || 'NOT_FOUND',
        opponent_counter_vct: facts.opponent_counter_vct || 'NOT_FOUND',
        connectivity: facts.connectivity || 'LOW',
        centrality: facts.centrality || 'OUTER',
        pattern_class: facts.pattern_class || 'POSITIONAL',
        pattern_score: Number.isFinite(facts.pattern_score) ? facts.pattern_score : 0,
        pattern_winning_points: Number.isFinite(facts.pattern_winning_points) ? facts.pattern_winning_points : 0,
        pattern_four_directions: Number.isFinite(facts.pattern_four_directions) ? facts.pattern_four_directions : 0,
        pattern_open_three_directions: Number.isFinite(facts.pattern_open_three_directions) ? facts.pattern_open_three_directions : 0,
        pattern_two_directions: Number.isFinite(facts.pattern_two_directions) ? facts.pattern_two_directions : 0,
        pattern_multi_axis: Number.isFinite(facts.pattern_multi_axis) ? facts.pattern_multi_axis : 0,
        blocks_opponent_pattern: facts.blocks_opponent_pattern || 'POSITIONAL',
        blocks_opponent_pattern_score: Number.isFinite(facts.blocks_opponent_pattern_score) ? facts.blocks_opponent_pattern_score : 0
      });
    }

    const factoredEvidence = factorCommonCandidateEvidence(criteria);

    return {
      state: {
        task: 'Final Gomoku move decision using deterministic local-engine evidence.',
        side: colorNameEn(aiColor()),
        board_size: '15x15',
        coordinate_system: 'Columns A-O left to right; rows 1-15 top to bottom.',
        board_legend: boardLegendForAi(),
        last_move: moves.length ? moves[moves.length - 1].coord : null,
        board_rows: boardRows(),
        local_engine_role: 'The local engine generated and tactically filtered the candidate set. Its ranks and search scores are evidence, not commands.',
        deep_search: compactEvidence({
          source: deepAnalysis?.source || 'unavailable',
          status: deepAnalysis?.status || 'unavailable',
          depth_reached: deepAnalysis?.depthReached ?? null,
          ranking_only: Boolean(deepAnalysis?.rankingOnly),
          timed_out: Boolean(deepAnalysis?.timedOut)
        }),
        threat_space_search: threatAnalysis ? compactEvidence({
          source: threatAnalysis.source || 'unavailable',
          status: threatAnalysis.status || 'unavailable',
          max_attacker_turns: threatAnalysis.maxThreatTurns ?? null,
          timed_out: Boolean(threatAnalysis.timedOut),
          elapsed_ms: threatAnalysis.elapsedMs ?? null
        }) : undefined,
        ...(Object.keys(factoredEvidence.common).length
          ? { common_candidate_evidence: factoredEvidence.common }
          : {}),
        rules: renjuRuleDescription(),
        gomoku_doctrine: gomokuDecisionDoctrine(),
        decision_policy: [
          'You are the FINAL decision maker. Choose exactly one supplied candidate.',
          'Never ignore an immediate win, mandatory defense, proven VCF sequence, or threat-space proof of an opponent forced win.',
          'A threat-space FOUND result is deterministic tactical evidence and outranks heuristic or shallow-search preferences.',
          'Never choose an UNSAFE or LOSING move when a SAFE candidate is available.',
          'Treat local rank, Alpha-Beta score, deep-search score, and pattern_* fields as finite-horizon evidence; pattern evidence is useful for shape and move-order judgement but is not proof.',
          'When safe candidates are close, explicitly compare forcing tempo, number of opponent replies, multi-axis threat growth, whether a latent threat should be preserved, and whether a defensive move also creates counter-pressure.',
          'If a candidate creates one forcing threat, inspect the forced reply and residual counter-threat evidence before calling it safe. A forced reply that preserves multiple opponent forcing extensions is a major warning, though not by itself a mathematical proof.',
          'In quiet openings prefer connected multi-direction extension potential and denial of the opponent equivalent routes; avoid isolated cosmetic central moves with little continuation.'
        ]
      },
      model: settings.model || 'jev-latest',
      questions: {
        best_move: {
          type: 'choice',
          instructions: `Make the final move decision for ${colorNameEn(aiColor())}. Inspect the full board, state.gomoku_doctrine, and all candidate evidence, then choose exactly one candidate. Candidate criteria inherit state.common_candidate_evidence when present. Obey the configured BLACK forbidden rules. Prefer the move whose concrete forcing sequence and reply-control are strongest, not the move that merely looks most central. You have final selection authority within this already-filtered candidate set.`,
          criteria: factoredEvidence.criteria
        }
      }
    };
  }

  function compactAnswer(answer) {
    if (!answer || typeof answer !== 'object') return null;
    const probabilities = answer.probabilities && typeof answer.probabilities === 'object'
      ? Object.fromEntries(Object.entries(answer.probabilities).map(([k,v]) => [k, Number(v)]))
      : null;
    return {
      choice: typeof answer.choice === 'string' ? answer.choice : null,
      confidence: Number.isFinite(answer.confidence) ? answer.confidence : null,
      probabilities
    };
  }

  function probabilityFor(answer, key) {
    const p = Number(answer?.probabilities?.[key]);
    if (Number.isFinite(p)) return Math.max(0, Math.min(1, p));
    return String(answer?.choice || '').toUpperCase() === key ? 1 : 0;
  }

  const DIVERSITY_POLICY = Object.freeze({
    topK: 3,
    dominantProbability: .72,
    relativeProbabilityFloor: .55,
    maxLocalRank: 4,
    maxDeepRank: 2
  });

  function selectDiverseJevChoice(answer, candidates, forced) {
    const jevChoice = String(answer?.choice || '').toUpperCase();
    const deterministic = reason => ({
      choice: jevChoice,
      jevChoice,
      samplingApplied: false,
      changed: false,
      reason,
      draw: null,
      pool: []
    });

    if (!jevChoice || candidates.length < 2) return deterministic('single_or_missing_choice');
    if (forced) return deterministic('forced_tactical_role');

    const tacticalLock = candidates.some(move => {
      const facts = move.analysis?.facts || {};
      return move.analysis?.winsNow
        || move.analysis?.vcf
        || ['WIN_NOW', 'MUST_DEFEND', 'MUST_DEFEND_FORK'].includes(facts.forced_role);
    });
    if (tacticalLock) return deterministic('tactical_lock');

    const safe = candidates
      .filter(move => move.analysis?.facts?.tactical_safety === 'SAFE')
      .map(move => ({
        move,
        probability: probabilityFor(answer, move.key)
      }))
      .filter(item => item.probability > 0);

    const primary = safe.find(item => item.move.key === jevChoice);
    if (!primary || safe.length < 2) return deterministic('insufficient_safe_choices');
    if (primary.probability >= DIVERSITY_POLICY.dominantProbability) {
      return deterministic('jev_probability_dominant');
    }

    const hasDeepRanks = safe.some(item => Number.isFinite(item.move.deepSearchRank));
    let pool = safe
      .filter(item => {
        const localRank = item.move.localRank ?? item.move.rank ?? Infinity;
        if (localRank > DIVERSITY_POLICY.maxLocalRank && item.move.key !== jevChoice) return false;
        if (
          hasDeepRanks &&
          Number.isFinite(item.move.deepSearchRank) &&
          item.move.deepSearchRank > DIVERSITY_POLICY.maxDeepRank &&
          item.move.key !== jevChoice
        ) return false;
        return item.probability >= primary.probability * DIVERSITY_POLICY.relativeProbabilityFloor;
      })
      .sort((a, b) => b.probability - a.probability)
      .slice(0, DIVERSITY_POLICY.topK);

    if (!pool.some(item => item.move.key === jevChoice)) {
      pool = [primary, ...pool].slice(0, DIVERSITY_POLICY.topK);
    }
    if (pool.length < 2) return deterministic('no_near_best_alternative');

    const total = pool.reduce((sum, item) => sum + item.probability, 0);
    if (!(total > 0)) return deterministic('invalid_probability_mass');

    const random = seededPositionRandom('jev-diversity-v1');
    const draw = random();
    let cursor = draw * total;
    let selected = pool[pool.length - 1];
    for (const item of pool) {
      cursor -= item.probability;
      if (cursor <= 0) {
        selected = item;
        break;
      }
    }

    return {
      choice: selected.move.key,
      jevChoice,
      samplingApplied: true,
      changed: selected.move.key !== jevChoice,
      reason: selected.move.key === jevChoice ? 'sample_kept_jev_choice' : 'sampled_safe_near_best',
      draw,
      pool: pool.map(item => ({
        move: item.move.key,
        probability: item.probability,
        localRank: item.move.localRank ?? item.move.rank ?? null,
        deepRank: Number.isFinite(item.move.deepSearchRank) ? item.move.deepSearchRank : null
      }))
    };
  }

  function sumUsage(...items) {
    let input = 0, output = 0, has = false;
    for (const u of items) {
      if (!u) continue;
      if (Number.isFinite(u.input_tokens)) { input += u.input_tokens; has = true; }
      if (Number.isFinite(u.output_tokens)) { output += u.output_tokens; has = true; }
    }
    return has ? { input_tokens: input, output_tokens: output } : null;
  }

  async function callJev(payload) {
    if (!window.JevClient) throw new Error('JevClient 未加载');
    return await window.JevClient.request({
      payload,
      signal: requestController?.signal
    });
  }

    function softmaxProbabilities(candidates, field = 'finalScore') {
    if (!candidates.length) return {};
    const values = candidates.map(m => Number(m[field] || 0));
    const max = Math.max(...values);
    const exps = values.map(v => Math.exp((v - max) / .13));
    const sum = exps.reduce((a,b) => a+b, 0) || 1;
    return Object.fromEntries(candidates.map((m,i) => [m.key, exps[i] / sum]));
  }

  function localOnlyDecision(mode = 'expert') {
    const engineMode = mode === 'max' ? 'max' : mode === 'grandmaster' ? 'grandmaster' : 'expert';
    const context = buildAdvancedCandidates(engineMode);
    const candidates = context.candidates;
    if (!candidates.length) throw new Error('本地引擎没有生成合法候选点');

    candidates.forEach((m, i) => {
      const localNorm = candidates.length === 1 ? 1 : 1 - (i / (candidates.length - 1));
      m.localNorm = localNorm;
      m.finalScore = localNorm;
      if (m.analysis?.winsNow) m.finalScore += 10;
      if (m.analysis?.vcf) m.finalScore += 1.2;
      if (m.analysis?.facts?.tactical_safety === 'LOSING') m.finalScore -= 10;
      else if (m.analysis?.facts?.tactical_safety === 'UNSAFE') m.finalScore -= 4;
    });

    const ranked = [...candidates].sort((a,b) => b.finalScore - a.finalScore);
    const final = ranked[0];
    const probabilities = softmaxProbabilities(ranked);
    return {
      answer: {
        choice: final.key,
        confidence: probabilities[final.key] ?? 1,
        probabilities
      },
      finalChoice: final.key,
      jevSuggested: null,
      mode: 'local',
      forced: context.forced,
      candidates: ranked.map((m,i) => ({ ...m, rank: i + 1 })),
      model: 'local-engine',
      usage: null,
      client: null,
      decisionTrace: {
        local: {
          engineMode,
          forced: context.forced,
          searchBudget: context.localSearch,
          ranked: ranked.slice(0, 8).map(m => ({
            move: m.key,
            rank: m.rank,
            searchScore: Number.isFinite(m.searchScore) ? m.searchScore : null,
            finalScore: Number.isFinite(m.finalScore) ? m.finalScore : null,
            facts: m.analysis?.facts || null
          }))
        }
      },
      stageNote: `本地 Alpha-Beta + VCF/VCT（0 次 Jev 请求；${context.localSearch?.timedOut ? `达到 ${context.localSearch.budgetMs}ms 时间上限，使用已完成搜索结果` : `本地耗时 ${context.localSearch?.elapsedMs ?? 0}ms`})`
    };
  }

  function challengerVerificationConfig(mode) {
    const base = ENGINE_PRESETS[mode] || ENGINE_PRESETS.expert;
    return {
      ...base,
      depth: mode === 'max' ? Math.max(8, base.depth + 2) : Math.max(7, base.depth + 2),
      branch: Math.max(8, base.branch + 1),
      root: 2,
      semantic: 2,
      tournament: 2,
      vcfDepth: base.vcfDepth + 2,
      vctDepth: base.vctDepth + 1
    };
  }

  function safetyRank(analysis) {
    const safety = analysis?.facts?.tactical_safety;
    if (analysis?.winsNow) return 6;
    if (analysis?.vcf) return 5;
    if (safety === 'SAFE') return 4;
    if (safety === 'TACTICALLY_RISKY') return 3;
    if (safety === 'UNSAFE') return 1;
    if (safety === 'LOSING') return 0;
    return 2;
  }

  function deepVerifyChallenger(localMove, jevMove, mode) {
    if (!localMove || !jevMove || localMove.key === jevMove.key) return null;
    const cfg = challengerVerificationConfig(mode);
    const cache = new Map();

    const evaluate = move => {
      const searchScore = scoreRootMove(move, cfg, cache);
      const analysis = analyzeAdvancedCandidate(move, null, cfg);
      return {
        move: move.key,
        searchScore,
        safetyRank: safetyRank(analysis),
        facts: analysis.facts,
        winsNow: analysis.winsNow,
        vcf: analysis.vcf,
        vct: analysis.vct,
        blackCounterVCF: analysis.blackCounterVCF,
        blackCounterVCT: analysis.blackCounterVCT
      };
    };

    const local = evaluate(localMove);
    const challenger = evaluate(jevMove);
    let winner;
    let reason;

    if (local.safetyRank !== challenger.safetyRank) {
      winner = local.safetyRank > challenger.safetyRank ? local : challenger;
      reason = 'deeper_tactical_safety';
    } else if (local.searchScore !== challenger.searchScore) {
      winner = local.searchScore > challenger.searchScore ? local : challenger;
      reason = 'deeper_alpha_beta';
    } else {
      winner = local;
      reason = 'verification_tie_keep_local';
    }

    return {
      config: {
        depth: cfg.depth,
        branch: cfg.branch,
        vcfDepth: cfg.vcfDepth,
        vctDepth: cfg.vctDepth
      },
      local,
      challenger,
      winner: winner.move,
      reason,
      changedFromLocal: winner.move !== localMove.key
    };
  }

  const HEAVY_WORKER_POOL_SIZE = 2;
  const heavyWorkerSlots = Array.from({ length: HEAVY_WORKER_POOL_SIZE }, () => ({
    worker: null,
    busy: false
  }));
  const heavyWorkerQueue = [];
  let heavyWorkerTaskSequence = 0;

  function createHeavyWorker(slot) {
    if (slot.worker) return slot.worker;
    slot.worker = new Worker('/deep-worker.js', { type: 'module' });
    return slot.worker;
  }

  function resetHeavyWorker(slot) {
    try { slot.worker?.terminate(); } catch (_) {}
    slot.worker = null;
    slot.busy = false;
  }

  function pumpHeavyWorkerQueue() {
    if (typeof Worker === 'undefined') return;
    for (const slot of heavyWorkerSlots) {
      if (slot.busy || !heavyWorkerQueue.length) continue;
      const job = heavyWorkerQueue.shift();
      slot.busy = true;

      let worker;
      try {
        worker = createHeavyWorker(slot);
        worker.ref?.();
      } catch (error) {
        resetHeavyWorker(slot);
        job.resolve(job.onError(error));
        Promise.resolve().then(pumpHeavyWorkerQueue);
        continue;
      }

      let settled = false;
      const finish = (result, reset = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.onmessage = null;
        worker.onerror = null;
        if (reset) resetHeavyWorker(slot);
        else {
          slot.busy = false;
          worker.unref?.();
        }
        job.resolve(result);
        Promise.resolve().then(pumpHeavyWorkerQueue);
      };

      const timer = setTimeout(() => {
        finish(job.onTimeout(), true);
      }, job.timeoutMs);

      worker.onmessage = event => {
        const message = event.data || {};
        if (message.id !== job.message.id) return;
        if (!message.ok) {
          finish(job.onWorkerError(message.error || 'heavy worker failed'), true);
          return;
        }
        finish(job.onSuccess(message.result || {}));
      };

      worker.onerror = event => {
        finish(job.onError(event?.message || 'heavy worker crashed'), true);
      };

      try {
        worker.postMessage(job.message);
      } catch (error) {
        finish(job.onError(error), true);
      }
    }
  }

  function submitHeavyWorkerTask(message, handlers) {
    return new Promise(resolve => {
      heavyWorkerQueue.push({
        message,
        timeoutMs: handlers.timeoutMs,
        resolve,
        onSuccess: handlers.onSuccess,
        onTimeout: handlers.onTimeout,
        onError: handlers.onError,
        onWorkerError: handlers.onWorkerError || handlers.onError
      });
      pumpHeavyWorkerQueue();
    });
  }

  async function runDeepWorkerVerification(candidateMoves, mode, trigger, overrides = {}) {
    const uniqueMoves = [...new Map(
      (candidateMoves || []).filter(Boolean).map(move => [move.key, move])
    ).values()];
    if (uniqueMoves.length < 2) return null;

    if (typeof Worker === 'undefined') {
      const cfg = challengerVerificationConfig(mode);
      const cache = new Map();
      const scores = uniqueMoves
        .map(move => ({ move: move.key, score: scoreRootMove(move, cfg, cache) }))
        .sort((a, b) => b.score - a.score);
      return {
        status: 'completed',
        source: 'sync-test-fallback',
        winner: scores[0]?.move || uniqueMoves[0].key,
        depthReached: cfg.depth,
        scores,
        trigger,
        timedOut: false,
        branch: cfg.branch
      };
    }

    const id = ++heavyWorkerTaskSequence;
    const defaultTimeBudgetMs = TIMEOUT_SCALE * (mode === 'max'
      ? (moves.length < 10 ? 1300 : 1800)
      : mode === 'grandmaster' ? (moves.length < 10 ? 900 : 1400)
        : 1500);
    const timeBudgetMs = Math.max(
      250,
      Math.min(6500, Number(overrides.timeBudgetMs) || defaultTimeBudgetMs)
    );
    const maxDepth = Math.max(
      3,
      Math.min(8, Number(overrides.maxDepth) || (mode === 'max' ? 8 : 7))
    );
    const branch = Math.max(
      4,
      Math.min(9, Number(overrides.branch) || (mode === 'max' ? 8 : 7))
    );

    return submitHeavyWorkerTask({
      id,
      task: 'search',
      board: board.map(row => row.slice()),
      side: aiColor(),
      rules: workerRuleConfig(),
      candidates: uniqueMoves.map(move => move.key),
      timeBudgetMs,
      maxDepth,
      branch
    }, {
      timeoutMs: timeBudgetMs + 350 * TIMEOUT_SCALE,
      onSuccess: result => ({ ...result, trigger }),
      onTimeout: () => ({
        status: 'timeout',
        source: 'web-worker',
        trigger,
        winner: uniqueMoves[0].key,
        depthReached: null,
        scores: [],
        timedOut: true,
        elapsedMs: timeBudgetMs,
        budgetMs: timeBudgetMs
      }),
      onError: error => ({
        status: 'error',
        source: 'web-worker',
        trigger,
        winner: uniqueMoves[0].key,
        error: String(error?.message || error || 'Web Worker unavailable'),
        timedOut: false
      })
    });
  }

  async function runThreatWorkerAnalysis(candidateMoves, mode, trigger = 'parallel_threat_evidence', overrides = {}) {
    const uniqueMoves = [...new Map(
      (candidateMoves || []).filter(Boolean).map(move => [move.key, move])
    ).values()].slice(0, 6);
    if (!uniqueMoves.length) return null;

    if (typeof Worker === 'undefined') {
      return {
        status: 'unavailable',
        source: 'worker-unavailable',
        trigger,
        winner: uniqueMoves[0].key,
        analyses: [],
        timedOut: false
      };
    }

    const id = ++heavyWorkerTaskSequence;
    const defaultTimeBudgetMs = TIMEOUT_SCALE * (mode === 'max'
      ? (moves.length < 10 ? 1100 : 1450)
      : (moves.length < 10 ? 800 : 1200));
    const timeBudgetMs = Number.isFinite(overrides.timeBudgetMs)
      ? Math.max(250, Math.min(defaultTimeBudgetMs, overrides.timeBudgetMs * TIMEOUT_SCALE))
      : defaultTimeBudgetMs;
    const maxThreatTurns = Number.isFinite(overrides.maxThreatTurns)
      ? Math.max(2, Math.min(8, overrides.maxThreatTurns))
      : (moves.length < 10 ? 4 : 6);
    const branch = Number.isFinite(overrides.branch)
      ? Math.max(4, Math.min(10, overrides.branch))
      : (mode === 'max' ? 9 : 8);

    return submitHeavyWorkerTask({
      id,
      task: 'threat',
      board: board.map(row => row.slice()),
      side: aiColor(),
      rules: workerRuleConfig(),
      candidates: uniqueMoves.map(move => move.key),
      timeBudgetMs,
      maxThreatTurns,
      branch
    }, {
      timeoutMs: timeBudgetMs + 350 * TIMEOUT_SCALE,
      onSuccess: result => ({ ...result, trigger }),
      onTimeout: () => ({
        status: 'timeout',
        source: 'threat-worker',
        trigger,
        winner: uniqueMoves[0].key,
        analyses: [],
        timedOut: true,
        elapsedMs: timeBudgetMs,
        budgetMs: timeBudgetMs,
        maxThreatTurns
      }),
      onError: error => ({
        status: 'error',
        source: 'threat-worker',
        trigger,
        winner: uniqueMoves[0].key,
        analyses: [],
        error: String(error?.message || error || 'Threat Worker unavailable'),
        timedOut: false
      })
    });
  }

  function attachThreatEvidence(candidates, threatAnalysis) {
    const rows = Array.isArray(threatAnalysis?.analyses) ? threatAnalysis.analyses : [];
    const byMove = new Map(rows.map(item => [item.move, item]));
    for (const move of candidates) {
      const evidence = byMove.get(move.key) || null;
      move.threatSearch = evidence;
      if (!evidence || !move.analysis?.facts) continue;
      move.analysis.facts.threat_verification = evidence.timedOut ? 'TIMEOUT' : 'COMPLETED';
      move.analysis.facts.opponent_forcing_proof = evidence.forced
        ? 'FOUND'
        : evidence.timedOut ? 'TIMEOUT' : 'NOT_FOUND';
      move.analysis.facts.opponent_forcing_line = Array.isArray(evidence.line) && evidence.line.length
        ? evidence.line.join('>')
        : 'NONE';
      const counterThreat = evidence.counterThreat || null;
      move.analysis.facts.opponent_counter_threat_risk = counterThreat?.risk || 'NONE';
      move.analysis.facts.opponent_counter_threat_reason = counterThreat?.reason || 'NONE';
      move.analysis.facts.opponent_counter_threat_forced_defense = counterThreat?.forcedDefenseMove || 'NONE';
      move.analysis.facts.opponent_counter_threat_moves = Array.isArray(counterThreat?.networkMoves) && counterThreat.networkMoves.length
        ? counterThreat.networkMoves.map(item => `${item.move}:${item.kind}`).join(',')
        : 'NONE';
      if (evidence.forced) {
        move.analysis.facts.tactical_safety = 'LOSING';
      } else if (
        ['CRITICAL', 'HIGH'].includes(counterThreat?.risk)
        && !['LOSING', 'UNSAFE'].includes(move.analysis.facts.tactical_safety)
      ) {
        move.analysis.facts.tactical_safety = 'TACTICALLY_RISKY';
      } else if (
        move.analysis.facts.tactical_safety === 'UNVERIFIED_BUDGET'
        && !evidence.timedOut
      ) {
        move.analysis.facts.tactical_safety = 'THREAT_SEARCH_NO_PROOF';
      }
    }
    return byMove;
  }

  function grandmasterCandidateFilter(candidates, threatAnalysis) {
    const byMove = attachThreatEvidence(candidates, threatAnalysis);
    const notProvenLosing = candidates.filter(move => byMove.get(move.key)?.forced !== true);
    const filtered = notProvenLosing.length ? notProvenLosing : candidates;
    return filtered.slice(0, Math.min(3, filtered.length));
  }

  function bestDeepCandidate(candidates, deepAnalysis) {
    const allowed = new Set(candidates.map(move => move.key));
    return (deepAnalysis?.scores || []).find(item => allowed.has(item.move))?.move || null;
  }

  function threatEvidenceSnapshot(threatAnalysis) {
    if (!threatAnalysis) return null;
    return {
      status: threatAnalysis.status || null,
      source: threatAnalysis.source || null,
      maxThreatTurns: threatAnalysis.maxThreatTurns ?? null,
      timedOut: Boolean(threatAnalysis.timedOut),
      elapsedMs: threatAnalysis.elapsedMs ?? null,
      budgetMs: threatAnalysis.budgetMs ?? null,
      nodes: threatAnalysis.nodes ?? null,
      winner: threatAnalysis.winner || null,
      analyses: (threatAnalysis.analyses || []).map(item => ({
        move: item.move,
        forced: Boolean(item.forced),
        timedOut: Boolean(item.timedOut),
        attackerTurns: item.attackerTurns ?? null,
        line: Array.isArray(item.line) ? item.line.slice(0, 16) : [],
        reason: item.reason || null,
        counterThreat: item.counterThreat ? {
          risk: item.counterThreat.risk || 'NONE',
          reason: item.counterThreat.reason || null,
          forcedDefenseMove: item.counterThreat.forcedDefenseMove || null,
          networkMoves: Array.isArray(item.counterThreat.networkMoves)
            ? item.counterThreat.networkMoves.slice(0, 6).map(row => ({
                move: row.move,
                kind: row.kind,
                winningPoints: row.winningPoints ?? 0,
                openThreeDirections: row.openThreeDirections ?? 0,
                fourDirections: row.fourDirections ?? 0,
                multiAxis: row.multiAxis ?? 0
              }))
            : []
        } : null
      }))
    };
  }

  function deterministicGrandmasterResult(context, candidates, choice, deepAnalysis, threatAnalysis, reason) {
    const selected = candidates.find(move => move.key === choice) || candidates[0];
    const ranked = [selected, ...candidates.filter(move => move.key !== selected.key)];
    const deepRows = Array.isArray(deepAnalysis?.scores) ? deepAnalysis.scores : [];
    return {
      answer: { choice: selected.key, confidence: 1, probabilities: { [selected.key]: 1 } },
      finalChoice: selected.key,
      localChoice: context.candidates[0]?.key || selected.key,
      jevSuggested: null,
      mode: 'grandmaster',
      forced: context.forced,
      candidates: ranked,
      model: 'grandmaster-local-consensus',
      usage: null,
      client: null,
      decisionTrace: {
        requestShape: {
          finalDecisionQuestions: 0,
          candidateCount: candidates.length,
          httpRequests: 0,
          decisionAuthority: reason,
          parallelEvidence: true,
          localSearchBudgetMs: context.localSearch?.budgetMs ?? null,
          localSearchElapsedMs: context.localSearch?.elapsedMs ?? null,
          localSearchTimedOut: Boolean(context.localSearch?.timedOut),
          localSearchDepthReached: context.localSearch?.depthReached ?? null,
          localSearchTargetDepth: context.localSearch?.targetDepth ?? context.cfg.depth
        },
        preJevDeepSearch: deepAnalysis ? {
          status: deepAnalysis.status || null,
          source: deepAnalysis.source || null,
          depthReached: deepAnalysis.depthReached ?? null,
          timedOut: Boolean(deepAnalysis.timedOut),
          elapsedMs: deepAnalysis.elapsedMs ?? null,
          budgetMs: deepAnalysis.budgetMs ?? null,
          scores: deepRows.map(item => ({ move: item.move, score: item.score }))
        } : null,
        preJevThreatSearch: threatEvidenceSnapshot(threatAnalysis)
      },
      stageNote: reason === 'threat_filter_single'
        ? '宗师模式：威胁空间搜索排除已证明的强制败着，仅剩唯一安全候选（0 次 Jev 请求）'
        : '宗师模式：Alpha-Beta 深搜与威胁空间搜索证据一致，直接落子（0 次 Jev 请求）'
    };
  }

  function patternExpertSummary(candidates) {
    const ranked = [...candidates]
      .map(move => ({
        move,
        score: Number(move.analysis?.patternDecisionScore || 0),
        className: move.analysis?.ownPattern?.className || 'POSITIONAL',
        blockedClass: move.analysis?.blockedOpponentPattern?.className || 'POSITIONAL'
      }))
      .sort((a, b) => b.score - a.score);
    const first = ranked[0] || null;
    const second = ranked[1] || null;
    const margin = first && second ? first.score - second.score : Infinity;
    const tacticalClass = first && ['OPEN_FOUR','FOUR_THREE','DOUBLE_FOUR','FOUR','DOUBLE_OPEN_THREE'].includes(first.className);
    return {
      choice: first?.move?.key || null,
      score: first?.score ?? null,
      margin: Number.isFinite(margin) ? margin : null,
      reliable: Boolean(first && (tacticalClass || margin >= 4500)),
      className: first?.className || null,
      blockedClass: first?.blockedClass || null
    };
  }

  function estimatePayloadTokens(payload) {
    try {
      return Math.ceil(JSON.stringify(payload).length / 4);
    } catch (_) {
      return null;
    }
  }

  function aggregateJevClient(...responses) {
    const clients = responses.map(item => item?.__client).filter(Boolean);
    const attempts = clients.reduce((sum, item) => sum + (Number(item.attempts) || 0), 0);
    return {
      attempts,
      cached: clients.length > 0 && clients.every(item => item.cached === true),
      logicalRequests: responses.filter(Boolean).length,
      transport: 'same-origin-server'
    };
  }

  function attachMaxDeepEvidence(candidates, deepAnalysis) {
    const map = deepEvidenceMap(deepAnalysis);
    for (const move of candidates) {
      const deep = map.get(move.key);
      move.deepSearchRank = deep?.rank ?? null;
      move.deepSearchScore = deep?.rank && Number.isFinite(deep?.row?.score) && !isSentinelSearchScore(deep.row.score)
        ? deep.row.score
        : null;
      move.deepEvidence = deep?.evidence || null;
      if (move.analysis?.facts) {
        move.analysis.facts.deep_search = deep?.evidence || {
          status: deepAnalysis?.status || 'unavailable'
        };
      }
      if (deep?.rank && deep.rank <= 2) addRecallSource(move, 'DEEP_SEARCH');
    }
  }

  const MAX_DEEP_DOMINANCE_MIN_DEPTH = 5;
  const MAX_DEEP_DOMINANCE_MIN_GAP = 20000;
  const MAX_DEEP_DOMINANCE_DANGER_SCORE = -20000;

  function applyMaxDeepDominance(candidates, deepAnalysis) {
    const rows = Array.isArray(deepAnalysis?.scores) ? deepAnalysis.scores : [];
    if (
      deepAnalysis?.status !== 'completed'
      || Number(deepAnalysis?.depthReached || 0) < MAX_DEEP_DOMINANCE_MIN_DEPTH
      || rows.length < 2
      || candidates.length < 2
    ) {
      return { candidates, applied: false, leader: null, rejected: [], gapThreshold: null };
    }

    const localLeader = candidates
      .filter(move => Number.isFinite(move.searchScore) && !isSentinelSearchScore(move.searchScore))
      .sort((a, b) => b.searchScore - a.searchScore)[0] || null;
    const deepLeader = rows[0];
    if (!localLeader || deepLeader?.move !== localLeader.key) {
      return { candidates, applied: false, leader: deepLeader?.move || null, rejected: [], gapThreshold: null };
    }
    if (!Number.isFinite(deepLeader.score) || isSentinelSearchScore(deepLeader.score)) {
      return { candidates, applied: false, leader: deepLeader.move, rejected: [], gapThreshold: null };
    }

    // Deep is bounded and therefore advisory, not a hard proof. Only use it as
    // a veto when the independent Local #1 and Deep #1 agree AND another
    // actually-searched candidate is catastrophically below that leader.
    // Unsearched candidates stay in the pool for Jev.
    const gapThreshold = Math.max(
      MAX_DEEP_DOMINANCE_MIN_GAP,
      Math.min(60000, Math.abs(deepLeader.score) * 2)
    );
    const scoreByMove = new Map(rows.map(row => [row.move, row]));
    const rejected = [];
    const filtered = candidates.filter(move => {
      if (move.key === deepLeader.move) return true;
      const row = scoreByMove.get(move.key);
      if (!row || !Number.isFinite(row.score) || isSentinelSearchScore(row.score)) return true;
      const dominated = row.score <= MAX_DEEP_DOMINANCE_DANGER_SCORE
        && (deepLeader.score - row.score) >= gapThreshold;
      if (dominated) rejected.push({
        move: move.key,
        score: Math.round(row.score),
        rank: rows.findIndex(item => item.move === move.key) + 1
      });
      return !dominated;
    });

    return {
      candidates: filtered.length ? filtered : candidates,
      applied: rejected.length > 0,
      leader: deepLeader.move,
      leaderScore: Math.round(deepLeader.score),
      depthReached: Number(deepAnalysis.depthReached || 0),
      rejected,
      gapThreshold: Math.round(gapThreshold)
    };
  }

  function selectMaxThreatCandidates(candidates, limit = 6) {
    const selected = [];
    const seen = new Set();
    const add = move => {
      if (!move || selected.length >= limit || seen.has(move.key)) return;
      selected.push(move);
      seen.add(move.key);
    };

    // Preserve strong root coverage, then spend remaining slots on candidates
    // whose local tactical verification is incomplete. Missing evidence should
    // increase verification priority rather than make a candidate look safer.
    candidates.slice(0, Math.min(4, candidates.length)).forEach(add);
    candidates
      .filter(move => move.analysis?.facts?.tactical_safety === 'UNVERIFIED_BUDGET')
      .forEach(add);
    candidates
      .filter(move => (move.recallSources || []).some(source =>
        ['DIRECT_OPEN_FOUR_BLOCK', 'DOUBLE_OPEN_THREE_BLOCK', 'DEFENSIVE_FORK_BLOCK', 'COUNTER_THREAT_BLOCK', 'DEFENSIVE_COUNTER_THREAT'].includes(source)
      ))
      .forEach(add);
    candidates.forEach(add);
    return selected;
  }

  function leavesCriticalDoubleOpenThree(move) {
    const counter = move?.threatSearch?.counterThreat;
    if (counter?.risk !== 'CRITICAL') return false;
    return Array.isArray(counter.networkMoves)
      && counter.networkMoves.some(item => item?.kind === 'DOUBLE_OPEN_THREE');
  }

  function hardFilterMaxCandidates(candidates, threatAnalysis) {
    attachThreatEvidence(candidates, threatAnalysis);
    let filtered = candidates;

    const provenVcf = filtered.filter(move => move.analysis?.vcf === true);
    if (provenVcf.length) filtered = provenVcf;

    const safeFromLocalProof = filtered.filter(move => move.analysis?.facts?.tactical_safety !== 'LOSING');
    if (safeFromLocalProof.length) filtered = safeFromLocalProof;

    const safeFromThreatProof = filtered.filter(move => move.threatSearch?.forced !== true);
    if (safeFromThreatProof.length) filtered = safeFromThreatProof;

    // A DOUBLE_OPEN_THREE is one tempo earlier than an open-four fork. It is
    // not always a mathematical forced loss because the defender may have a
    // counter-forcing resource, so do not label it LOSING globally. But when
    // at least one candidate prevents the CRITICAL junction, never let Jev
    // prefer a move that voluntarily leaves that junction available.
    const verifiedNonDoubleThree = filtered.filter(move =>
      hasCompletedThreatEvidence(threatAnalysis, move.key)
      && !leavesCriticalDoubleOpenThree(move)
    );
    if (verifiedNonDoubleThree.length) {
      filtered = filtered.filter(move => !leavesCriticalDoubleOpenThree(move));
    }

    return filtered.slice(0, maxCandidateLimit());
  }

  function maxOverridePairVerdict(localMove, semanticMove, pairAnalysis) {
    const rows = new Map((pairAnalysis?.scores || []).map(row => [row.move, row]));
    const local = rows.get(localMove?.key);
    const semantic = rows.get(semanticMove?.key);
    if (!local || !semantic || pairAnalysis?.status !== 'completed' || Number(pairAnalysis?.depthReached || 0) <= 0) {
      return {
        vetoed: false,
        reason: 'insufficient_pair_deep_evidence',
        local: local || null,
        semantic: semantic || null
      };
    }

    const localForcedLoss = local.forcedResult?.forced === true && local.forcedResult.result === 'loss';
    const semanticForcedLoss = semantic.forcedResult?.forced === true && semantic.forcedResult.result === 'loss';
    if (semanticForcedLoss && !localForcedLoss) {
      return { vetoed: true, reason: 'semantic_deep_forced_loss', local, semantic };
    }

    const localScore = Number(local.score);
    const semanticScore = Number(semantic.score);
    const margin = localScore - semanticScore;
    if (
      Number.isFinite(localScore)
      && Number.isFinite(semanticScore)
      && Number(pairAnalysis?.depthReached || 0) >= 6
      && localScore >= -5000
      && semanticScore <= -1500
      && margin >= 1200
    ) {
      return {
        vetoed: true,
        reason: 'local_deep_consensus_over_semantic_override',
        local,
        semantic,
        margin
      };
    }

    return {
      vetoed: false,
      reason: 'pair_deep_not_decisive',
      local,
      semantic,
      margin: Number.isFinite(margin) ? margin : null
    };
  }

  async function runMaxSemanticOverrideGuard(context, candidates, semanticMove) {
    const localKey = context?.candidates?.[0]?.key || null;
    const localMove = candidates.find(move => move.key === localKey) || null;
    if (!localMove || !semanticMove || localMove.key === semanticMove.key) {
      return {
        vetoed: false,
        reason: 'no_semantic_override',
        choice: semanticMove?.key || localMove?.key || null,
        localMove: localMove?.key || null,
        semanticMove: semanticMove?.key || null,
        analysis: null
      };
    }

    updateApiState('busy', 'Jev Max：Jev 改写 Local #1，后台窄化 Deep 复核两点…');
    const analysis = await runDeepWorkerVerification(
      [localMove, semanticMove],
      'max',
      'jev_max_semantic_override_guard',
      { timeBudgetMs: 5200, maxDepth: 8, branch: 9 }
    );
    const verdict = maxOverridePairVerdict(localMove, semanticMove, analysis);
    return {
      ...verdict,
      choice: verdict.vetoed ? localMove.key : semanticMove.key,
      localMove: localMove.key,
      semanticMove: semanticMove.key,
      analysis
    };
  }

  async function closePreAtomicLossFrontier(contextCandidates, survivors, threatAnalysis) {
    const unresolved = (survivors || []).filter(move =>
      !hasCompletedThreatEvidence(threatAnalysis, move.key)
    );
    const knownLost = (contextCandidates || []).filter(maxHardProvenLoss);

    // Rare tactical state: the initial Threat batch has already proved most of
    // the universe losing, and <=2 candidates survive only because their proof
    // did not run/finish. Close that hard-evidence frontier (at most four
    // survivors) before spending an Atomic request; semantic judgement must not
    // decide whether proof exists.
    if (
      unresolved.length === 0
      || unresolved.length !== survivors.length
      || unresolved.length > 4
      || knownLost.length + unresolved.length < contextCandidates.length
    ) {
      return {
        candidates: survivors,
        threatAnalysis,
        supplemental: null
      };
    }

    updateApiState('busy', 'Jev Max：主候选接近全败，Atomic 前补齐 Threat 生存证据…');
    const supplemental = await runThreatWorkerAnalysis(
      unresolved,
      'max',
      'jev_max_pre_atomic_loss_frontier',
      { timeBudgetMs: 1450, maxThreatTurns: moves.length < 10 ? 4 : 6, branch: 9 }
    );
    const merged = mergeThreatAnalysis(threatAnalysis, supplemental);
    attachThreatEvidence(contextCandidates, merged);
    const filtered = hardFilterMaxCandidates(survivors, merged);
    return {
      candidates: filtered,
      threatAnalysis: merged,
      supplemental
    };
  }

  function mergeThreatAnalysis(primary, supplemental) {
    if (!primary) return supplemental || null;
    if (!supplemental) return primary;
    const byMove = new Map();
    for (const row of primary.analyses || []) byMove.set(row.move, row);
    for (const row of supplemental.analyses || []) byMove.set(row.move, row);
    return {
      ...primary,
      status: primary.status === 'completed' && supplemental.status === 'completed'
        ? 'completed'
        : primary.status || supplemental.status || 'unavailable',
      timedOut: Boolean(primary.timedOut || supplemental.timedOut),
      elapsedMs: (Number(primary.elapsedMs) || 0) + (Number(supplemental.elapsedMs) || 0),
      budgetMs: (Number(primary.budgetMs) || 0) + (Number(supplemental.budgetMs) || 0),
      nodes: (Number(primary.nodes) || 0) + (Number(supplemental.nodes) || 0),
      analyses: [...byMove.values()],
      supplemental: {
        trigger: supplemental.trigger || null,
        status: supplemental.status || null,
        timedOut: Boolean(supplemental.timedOut),
        elapsedMs: supplemental.elapsedMs ?? null,
        budgetMs: supplemental.budgetMs ?? null,
        candidates: (supplemental.analyses || []).map(row => row.move)
      }
    };
  }

  function hasCompletedThreatEvidence(threatAnalysis, key) {
    const row = threatEvidenceForMove(threatAnalysis, key);
    return Boolean(row && !row.timedOut);
  }

  async function closeMaxThreatCoverage(candidates, provisionalTop4, threatAnalysis, speculativeThreatPromise = null) {
    let merged = threatAnalysis;
    let speculative = null;
    let promotedNeedsProof = provisionalTop4.some(move => !hasCompletedThreatEvidence(merged, move.key));
    if (!promotedNeedsProof) {
      return {
        candidates,
        threatAnalysis: merged,
        speculative: null,
        supplemental: null,
        rejectedIncomplete: []
      };
    }

    // Tail validation is queued as soon as the initial Deep/Threat pair starts.
    // With the two-slot persistent pool it begins the moment either primary
    // worker becomes idle, so Atomic usually does not create a new wait bubble.
    if (speculativeThreatPromise) {
      try {
        speculative = await speculativeThreatPromise;
      } catch (_) {
        speculative = null;
      }
      if (speculative) {
        merged = mergeThreatAnalysis(merged, speculative);
        attachThreatEvidence(candidates, merged);
        const filtered = hardFilterMaxCandidates(candidates, merged);
        provisionalTop4 = provisionalTop4.filter(move =>
          filtered.some(item => item.key === move.key)
        );
        promotedNeedsProof = provisionalTop4.some(move => !hasCompletedThreatEvidence(merged, move.key));
        if (!promotedNeedsProof) {
          return {
            candidates: filtered,
            threatAnalysis: merged,
            speculative,
            supplemental: null,
            rejectedIncomplete: []
          };
        }
        candidates = filtered;
      }
    }

    const missingTop = provisionalTop4
      .filter(move => !hasCompletedThreatEvidence(merged, move.key));
    const missingAll = candidates
      .filter(move => !hasCompletedThreatEvidence(merged, move.key));
    const unvetted = [...new Map(
      [...missingTop, ...missingAll].map(move => [move.key, move])
    ).values()].slice(0, 2);

    if (!unvetted.length) {
      return {
        candidates,
        threatAnalysis: merged,
        speculative,
        supplemental: null,
        rejectedIncomplete: []
      };
    }

    updateApiState('busy', 'Jev Max：补齐晋级候选的 Threat 安全性…');
    const supplemental = await runThreatWorkerAnalysis(
      unvetted,
      'max',
      'jev_max_atomic_promotion_validation',
      { timeBudgetMs: 850, maxThreatTurns: moves.length < 10 ? 4 : 6, branch: 8 }
    );
    merged = mergeThreatAnalysis(merged, supplemental);
    attachThreatEvidence(candidates, merged);

    const rejectedIncomplete = candidates
      .filter(move => !hasCompletedThreatEvidence(merged, move.key))
      .map(move => move.key);
    const rejectedSet = new Set(rejectedIncomplete);
    const covered = candidates.filter(move => !rejectedSet.has(move.key));
    const filtered = hardFilterMaxCandidates(covered, merged);

    return {
      candidates: filtered,
      threatAnalysis: merged,
      speculative,
      supplemental,
      rejectedIncomplete
    };
  }

  function threatEvidenceForMove(threatAnalysis, key) {
    return (threatAnalysis?.analyses || []).find(item => item.move === key) || null;
  }

  function provenThreatLossKeys(threatAnalysis) {
    return new Set(
      (threatAnalysis?.analyses || [])
        .filter(item => item?.forced === true)
        .map(item => item.move)
    );
  }

  function extraWildcardPool(mainCandidates, limit = 12, blockedKeys = new Set()) {
    const excluded = new Set(mainCandidates.map(move => move.key));
    const side = aiColor();
    const opponent = otherColor(side);
    return nearbyMoves(2)
      .filter(move => !excluded.has(move.key))
      .filter(move => !blockedKeys.has(move.key))
      .filter(move => isLegalMoveForColor(move.r, move.c, side))
      .map(move => ({
        ...move,
        wildcardPriority: fastPatternSeedScore(move, side)
          + fastPatternSeedScore(move, opponent) * .75
          + Math.max(0, 7 - Math.max(Math.abs(move.r - 7), Math.abs(move.c - 7))) * 3
      }))
      .sort((a, b) => b.wildcardPriority - a.wildcardPriority)
      .slice(0, Math.max(10, Math.min(16, limit)));
  }

  function validateWildcardCandidate(move) {
    if (!move || board[move.r]?.[move.c] !== EMPTY || !isLegalMoveForColor(move.r, move.c, aiColor())) {
      return null;
    }

    const side = aiColor();
    const opponent = otherColor(side);
    const blockedOpponentPattern = previewThreatPattern(move, opponent);
    board[move.r][move.c] = side;
    const ownPattern = threatPatternProfilePlaced(move.r, move.c, side);
    const winsNow = isWin(move.r, move.c, side);
    const opponentWins = winsNow ? [] : immediateWins(opponent, 2);
    const ownWins = winsNow ? [] : immediateWins(side, 2);
    const opponentForks = (!winsNow && opponentWins.length === 0)
      ? countForkCreators(opponent, 10, 2, 1)
      : { count: 0, points: [], moves: [] };
    const conn = localConnectivity(move.r, move.c, side);
    board[move.r][move.c] = EMPTY;

    // A Jev-proposed wildcard may enter the final comparison only if it passes
    // deterministic local safety first: no immediate opponent win and no legal
    // opponent fork-creator that yields multiple immediate winning points.
    if (!winsNow && (opponentWins.length || opponentForks.count >= 1)) return null;

    return {
      ...move,
      rank: null,
      localRank: null,
      localNorm: null,
      searchScore: null,
      deepSearchRank: null,
      deepSearchScore: null,
      recallSources: ['JEV_WILDCARD'],
      analysis: {
        winsNow,
        vcf: false,
        vct: false,
        ownPattern,
        blockedOpponentPattern,
        patternDecisionScore: ownPattern.score + blockedOpponentPattern.score * .72,
        facts: {
          candidate_sources: ['JEV_WILDCARD'],
          forced_role: winsNow ? 'WIN_NOW' : 'NORMAL',
          tactical_safety: 'ONE_PLY_SAFE_UNVERIFIED',
          attack_shape: winsNow ? 'IMMEDIATE_WIN' : ownWins.length ? 'FORCING_REPLY_SET' : ownPattern.className,
          initiative: winsNow || ownWins.length ? 'FORCING' : ownPattern.openThreeDirections ? 'PRESSURE' : 'BALANCED',
          own_immediate_winning_points_after_move: countLabel(ownWins.length),
          opponent_immediate_winning_points_after_move: 'NONE',
          opponent_fork_creators_after_move: 'NONE',
          vcf_status: 'NOT_RUN_WILDCARD',
          vct_status: 'NOT_RUN_WILDCARD',
          opponent_counter_vcf: 'NOT_RUN_WILDCARD',
          opponent_counter_vct: 'NOT_RUN_WILDCARD',
          connectivity: connectionLabel(conn.allies),
          centrality: Math.max(Math.abs(move.r - 7), Math.abs(move.c - 7)) <= 3 ? 'CENTRAL' : 'OUTER',
          pattern_class: ownPattern.className,
          pattern_score: Math.round(ownPattern.score),
          pattern_winning_points: ownPattern.winningPoints,
          pattern_four_directions: ownPattern.fourDirections,
          pattern_open_three_directions: ownPattern.openThreeDirections,
          pattern_two_directions: ownPattern.twoDirections,
          pattern_multi_axis: ownPattern.multiAxis,
          blocks_opponent_pattern: blockedOpponentPattern.className,
          blocks_opponent_pattern_score: Math.round(blockedOpponentPattern.score)
        }
      }
    };
  }

  async function validateWildcardForMax(move, initialThreatAnalysis) {
    const candidate = validateWildcardCandidate(move);
    if (!candidate) {
      return {
        candidate: null,
        validation: {
          accepted: false,
          reason: 'illegal_or_one_ply_loss',
          source: 'local_guard'
        }
      };
    }

    const existing = threatEvidenceForMove(initialThreatAnalysis, candidate.key);
    if (existing && !existing.timedOut) {
      attachThreatEvidence([candidate], { analyses: [existing] });
      if (existing.forced) {
        return {
          candidate: null,
          validation: {
            accepted: false,
            reason: 'existing_threat_proof_forced_loss',
            source: 'initial_threat_worker',
            forcedLine: Array.isArray(existing.line) ? existing.line.slice(0, 12) : []
          }
        };
      }
      return {
        candidate,
        validation: {
          accepted: true,
          reason: 'existing_threat_analysis_safe_from_proof',
          source: 'initial_threat_worker',
          elapsedMs: 0
        }
      };
    }

    const targeted = await runThreatWorkerAnalysis(
      [candidate],
      'max',
      'jev_max_wildcard_validation',
      { timeBudgetMs: 700, maxThreatTurns: 4, branch: 8 }
    );
    const row = threatEvidenceForMove(targeted, candidate.key);

    // Wildcard is optional. If its deterministic threat check cannot complete,
    // fail closed and keep the already-vetted main candidates.
    if (!row || targeted?.status !== 'completed' || targeted?.timedOut || row.timedOut) {
      return {
        candidate: null,
        validation: {
          accepted: false,
          reason: 'wildcard_threat_validation_incomplete',
          source: targeted?.source || 'threat-worker',
          status: targeted?.status || 'unavailable',
          elapsedMs: targeted?.elapsedMs ?? null
        }
      };
    }

    attachThreatEvidence([candidate], targeted);
    if (row.forced) {
      return {
        candidate: null,
        validation: {
          accepted: false,
          reason: 'wildcard_threat_proof_forced_loss',
          source: targeted.source || 'threat-worker',
          elapsedMs: targeted.elapsedMs ?? null,
          forcedLine: Array.isArray(row.line) ? row.line.slice(0, 12) : []
        }
      };
    }

    return {
      candidate,
      validation: {
        accepted: true,
        reason: 'wildcard_threat_validation_passed',
        source: targeted.source || 'threat-worker',
        elapsedMs: targeted.elapsedMs ?? null
      }
    };
  }

  function maxSemanticEvidence(move, { includeRanks = false } = {}) {
    const facts = move.analysis?.facts || {};
    return compactEvidence({
      candidate_sources: Array.isArray(move.recallSources) ? move.recallSources : facts.candidate_sources,
      ...(includeRanks ? {
        local_rank: Number.isFinite(move.localRank) ? move.localRank : (Number.isFinite(move.rank) ? move.rank : null),
        deep_rank: Number.isFinite(move.deepSearchRank) ? move.deepSearchRank : null
      } : {}),
      ...localScoreEvidence(move.searchScore),
      deep_search: move.deepEvidence || facts.deep_search || null,
      pattern_class: facts.pattern_class || null,
      attack_shape: facts.attack_shape || null,
      initiative: facts.initiative || null,
      tactical_safety: facts.tactical_safety || null,
      opponent_direct_double_win_creators_after_move: facts.opponent_direct_double_win_creators_after_move || null,
      opponent_direct_double_win_creator_points: facts.opponent_direct_double_win_creator_points || null,
      local_tactical_verification: facts.tactical_verification || null,
      threat_verification: facts.threat_verification || (move.threatSearch ? (move.threatSearch.timedOut ? 'TIMEOUT' : 'COMPLETED') : 'NOT_RUN'),
      vcf_status: facts.vcf_status || null,
      vct_status: facts.vct_status || null,
      threat_search: move.threatSearch ? compactEvidence({
        opponent_forced_win: Boolean(move.threatSearch.forced),
        timed_out: Boolean(move.threatSearch.timedOut),
        attacker_turns: move.threatSearch.attackerTurns ?? null,
        line: Array.isArray(move.threatSearch.line) ? move.threatSearch.line.slice(0, 12) : null,
        counter_threat: move.threatSearch.counterThreat ? compactEvidence({
          risk: move.threatSearch.counterThreat.risk || 'NONE',
          reason: move.threatSearch.counterThreat.reason || null,
          forced_defense_move: move.threatSearch.counterThreat.forcedDefenseMove || null,
          network_moves: Array.isArray(move.threatSearch.counterThreat.networkMoves)
            ? move.threatSearch.counterThreat.networkMoves.slice(0, 4)
            : null
        }) : null
      }) : null,
      atomic_judgement: move.atomicJudgement || null,
      pairwise_score: Number.isFinite(move.pairScore) ? Number(move.pairScore.toFixed(4)) : null,
      critic_summary: move.criticSummary || null
    });
  }

  function buildMaxAtomicPayload(context, candidates) {
    const payload = buildAtomicPayload({ ...context, candidates });
    payload.state.task = 'Jev Max stage 1: independent atomic candidate evaluation and candidate-recall audit.';
    payload.state.gomoku_doctrine = gomokuDecisionDoctrine();
    payload.state.candidate_facts = Object.fromEntries(
      candidates.map(move => [move.key, maxSemanticEvidence(move, { includeRanks: false })])
    );
    payload.state.max_policy = 'Do not infer Local ranking. Judge board geometry, tactical safety, forcing resources, and opponent best replies independently.';
    payload.questions.recall_check = {
      type: 'choice',
      instructions: 'Decide whether at least one supplied main candidate is sufficient for serious final consideration. Choose OTHER only if the board contains a materially stronger plausible move outside the supplied set.',
      criteria: {
        MAIN_SET: 'At least one supplied candidate is strong enough for final consideration.',
        OTHER: 'The supplied set appears to miss a materially stronger legal alternative.'
      }
    };
    return payload;
  }

  function buildMaxSpeculativePayload(context, candidates, speculativePool, wildcardPool = []) {
    const payload = buildMaxAtomicPayload(context, candidates);
    const tournament = buildPairwisePayload(speculativePool);

    payload.state.task = 'Jev Max speculative fan-out: atomic evaluation plus precomputed pairwise/critic evidence for the likely finalist pool.';
    payload.state.fanout_policy = 'Atomic answers determine the actual Top 4. Pairwise/Critic answers are speculative and are only consumed when their candidate is still eligible after deterministic Threat coverage. Ignore all hard-proved losing or illegal candidates.';
    payload.state.speculative_pool = speculativePool.map(move => move.key);
    payload.state.pairwise_policy = tournament.payload.state.pairwise_policy;
    payload.state.critic_policy = MAX_CRITIC_POLICY;
    Object.assign(payload.questions, tournament.payload.questions);
    addCriticQuestions(payload.questions, speculativePool);

    payload.questions.global_best = {
      type: 'choice',
      instructions: 'Independently choose the strongest supplied main candidate from the full board and candidate_facts. This is a consensus signal, not permission to override deterministic proof.',
      criteria: Object.fromEntries(candidates.map(move => [
        move.key,
        `See candidate_facts.${move.key}`
      ]))
    };

    if (wildcardPool.length) {
      payload.state.wildcard_pool = wildcardPool.map(move => move.key);
      payload.questions.wildcard_pick = {
        type: 'choice',
        instructions: 'If recall_check is OTHER, propose the strongest alternative from state.wildcard_pool; otherwise this answer will be ignored.',
        criteria: Object.fromEntries(wildcardPool.map(move => [
          move.key,
          'Bounded legal alternative; inspect full-board geometry directly.'
        ]))
      };
    }

    return {
      payload,
      pairs: tournament.pairs,
      speculativePool: speculativePool.map(move => move.key)
    };
  }

  function buildMaxResolutionPayload(context, candidates, atomicAnswers, extraCandidate = null) {
    const tournament = buildPairwisePayload(candidates);
    const resolutionCandidates = [
      ...candidates,
      ...(extraCandidate && !candidates.some(move => move.key === extraCandidate.key) ? [extraCandidate] : [])
    ];
    tournament.payload.state.task = 'Jev Max difficult-position resolution fan-out after Atomic changed the likely finalist pool or wildcard validation introduced a new finalist.';
    tournament.payload.state.gomoku_doctrine = gomokuDecisionDoctrine();
    tournament.payload.state.critic_policy = MAX_CRITIC_POLICY;
    tournament.payload.state.candidate_facts = Object.fromEntries(
      resolutionCandidates.map(move => [move.key, maxSemanticEvidence(move, { includeRanks: false })])
    );
    tournament.payload.state.atomic_results = Object.fromEntries(
      candidates.map(move => [move.key, atomicAnswers?.[`judge_${move.key}`] || null])
    );
    addCriticQuestions(tournament.payload.questions, candidates);
    tournament.payload.questions.best_move = {
      type: 'choice',
      instructions: 'Choose the strongest legal resolution candidate. Use full-board geometry, candidate_facts and prior Atomic results. Pairwise/Critic questions in this request are independent cross-checks; legality and hard proofs remain authoritative.',
      criteria: Object.fromEntries(resolutionCandidates.map(move => [
        move.key,
        `See candidate_facts.${move.key}`
      ]))
    };
    return {
      payload: tournament.payload,
      pairs: tournament.pairs,
      candidates: resolutionCandidates
    };
  }

  function atomicTraceFor(candidates, answers) {
    return candidates.map(move => {
      const answer = answers?.[`judge_${move.key}`] || null;
      move.atomicScore = atomicScore(answer);
      move.atomicJudgement = compactAnswer(answer);
      return {
        move: move.key,
        score: move.atomicScore,
        ...compactAnswer(answer)
      };
    });
  }

  const MAX_CRITIC_POLICY = 'Assume the candidate is wrong and search for the strongest opponent refutation: immediate tactic, forcing sequence, double-open-three or other multi-axis counterattack, residual threat network after a forced defense, premature spending of a forcing resource, or loss of initiative. If no concrete refutation is convincing, choose SURVIVES_BEST_REPLY.';

  function addCriticQuestions(questions, candidates) {
    for (const move of candidates) {
      questions[`critic_${move.key}`] = {
        type: 'choice',
        instructions: `Refute ${move.key} using state.critic_policy and candidate_facts.${move.key}; otherwise choose SURVIVES_BEST_REPLY.`,
        criteria: {
          SURVIVES_BEST_REPLY: 'No concrete refutation found; candidate remains robust against best play.',
          TACTICAL_REFUTATION: 'Opponent has a concrete tactical or forcing refutation.',
          MULTI_AXIS_COUNTERATTACK: 'Opponent gains a stronger multi-direction counterattack.',
          RESIDUAL_COUNTER_THREAT: 'After answering this candidate\'s forcing threat, the opponent retains multiple forcing extensions or a dangerous threat-network junction.',
          FORCING_RESOURCE_SPENT_TOO_EARLY: 'Candidate wastes a forcing resource and weakens the continuation.',
          LOSES_INITIATIVE: 'Candidate yields the initiative or expands the opponent reply set.'
        }
      };
    }
  }

  function scorePairwiseTournament(candidates, pairs, answers) {
    const byKey = new Map(candidates.map(move => [move.key, move]));
    for (const move of candidates) {
      move.pairMargin = 0;
      move.pairWins = 0;
      move.pairLosses = 0;
      move.pairScore = 0;
    }

    const trace = [];
    for (const pair of pairs) {
      const ab = answers?.[`duel_${pair.id}_ab`] || null;
      const ba = answers?.[`duel_${pair.id}_ba`] || null;
      const pA = (probabilityFor(ab, pair.a) + probabilityFor(ba, pair.a)) / 2;
      const pB = (probabilityFor(ab, pair.b) + probabilityFor(ba, pair.b)) / 2;
      const margin = pA - pB;
      const a = byKey.get(pair.a);
      const b = byKey.get(pair.b);
      if (a) a.pairMargin += margin;
      if (b) b.pairMargin -= margin;
      if (margin > .05) {
        if (a) a.pairWins++;
        if (b) b.pairLosses++;
      } else if (margin < -.05) {
        if (b) b.pairWins++;
        if (a) a.pairLosses++;
      }
      trace.push({
        left: pair.a,
        right: pair.b,
        choice: margin >= 0 ? pair.a : pair.b,
        probabilities: { [pair.a]: pA, [pair.b]: pB },
        margin
      });
    }

    for (const move of candidates) {
      move.pairScore = (move.pairWins - move.pairLosses) + move.pairMargin;
    }
    return trace;
  }

  function maxCriticTrace(candidates, answers) {
    return candidates.map(move => {
      const answer = answers?.[`critic_${move.key}`] || null;
      move.criticSummary = compactAnswer(answer);
      return { move: move.key, ...compactAnswer(answer) };
    });
  }

  function criticSurvivalProbability(move) {
    const answer = move?.criticSummary;
    const p = Number(answer?.probabilities?.SURVIVES_BEST_REPLY);
    if (Number.isFinite(p)) return p;
    return answer?.choice === 'SURVIVES_BEST_REPLY' ? 1 : 0;
  }

  function pairwiseRank(candidates) {
    return [...candidates].sort((a, b) =>
      (b.pairScore || 0) - (a.pairScore || 0)
      || (b.atomicScore || 0) - (a.atomicScore || 0)
      || (a.localRank || a.rank || 999) - (b.localRank || b.rank || 999)
    );
  }

  function highConfidenceMaxConvergence(ranked, globalBest = null) {
    if (ranked.length < 2) return false;
    const first = ranked[0];
    const second = ranked[1];
    const pairLead = Number(first.pairScore || 0) - Number(second.pairScore || 0);
    const expectedWins = Math.max(1, Math.min(3, ranked.length - 1));
    const strict = first.pairWins >= expectedWins
      && pairLead >= 1.35
      && Number(first.atomicScore || 0) >= .82
      && criticSurvivalProbability(first) >= .72;
    if (strict) return true;

    const globalChoice = String(globalBest?.choice || '').toUpperCase();
    const globalConfidence = Number.isFinite(globalBest?.confidence)
      ? Number(globalBest.confidence)
      : Number(globalBest?.probabilities?.[first.key] || 0);
    return globalChoice === first.key
      && globalConfidence >= .55
      && first.pairWins >= Math.max(1, expectedWins - 1)
      && pairLead >= .75
      && Number(first.atomicScore || 0) >= .72
      && criticSurvivalProbability(first) >= .65;
  }

  function pairwiseAnswer(ranked) {
    const values = ranked.map(move => Number(move.pairScore || 0) + Number(move.atomicScore || 0) * .6);
    const max = Math.max(...values);
    const exps = values.map(value => Math.exp((value - max) / .85));
    const sum = exps.reduce((a, b) => a + b, 0) || 1;
    const probabilities = Object.fromEntries(ranked.map((move, index) => [move.key, exps[index] / sum]));
    return {
      choice: ranked[0].key,
      confidence: probabilities[ranked[0].key] ?? null,
      probabilities
    };
  }

  function maxHardProvenLoss(move) {
    return Boolean(
      move?.threatSearch?.forced === true
      || move?.analysis?.facts?.tactical_safety === 'LOSING'
    );
  }

  function allMaxCandidatesHardLost(candidates) {
    return Boolean(candidates?.length) && candidates.every(maxHardProvenLoss);
  }

  function maxResistanceRank(candidates) {
    return [...(candidates || [])].sort((a, b) => {
      const aTurns = Number(a?.threatSearch?.attackerTurns);
      const bTurns = Number(b?.threatSearch?.attackerTurns);
      const aDepth = Number.isFinite(aTurns) ? aTurns : -1;
      const bDepth = Number.isFinite(bTurns) ? bTurns : -1;
      return bDepth - aDepth
        || Number(b?.searchScore || -Infinity) - Number(a?.searchScore || -Infinity)
        || Number(a?.localRank || a?.rank || 999) - Number(b?.localRank || b?.rank || 999);
    });
  }

  function buildMaxRescuePayload(candidates, context, deepAnalysis, threatAnalysis, rescueMode) {
    return {
      state: {
        task: 'Jev Max emergency rescue selection after the normal main candidate set was hard-proved losing.',
        rescue_mode: rescueMode,
        side: colorNameEn(aiColor()),
        board_size: '15x15',
        coordinate_system: 'Columns A-O left to right; rows 1-15 top to bottom.',
        board_legend: boardLegendForAi(),
        board_rows: boardRows(),
        last_move: moves.length ? moves[moves.length - 1].coord : null,
        rules: renjuRuleDescription(),
        gomoku_doctrine: gomokuDecisionDoctrine(),
        deterministic_engine_role: 'Every normal main candidate has a hard forced-loss proof. These rescue candidates are the bounded alternatives not yet hard-proved losing. Never prefer a known forced-loss move over an unresolved or completed non-forced rescue.',
        priority: 'LEGALITY / proven forced result > survival from forced loss > opponent best-response robustness > forcing tempo > deep/local evidence',
        deep_search_status: compactEvidence({
          status: deepAnalysis?.status || 'unavailable',
          depth_reached: deepAnalysis?.depthReached ?? null,
          timed_out: Boolean(deepAnalysis?.timedOut)
        }),
        threat_search_status: compactEvidence({
          status: threatAnalysis?.status || 'unavailable',
          timed_out: Boolean(threatAnalysis?.timedOut),
          max_attacker_turns: threatAnalysis?.maxThreatTurns ?? null
        }),
        candidates: Object.fromEntries(
          candidates.map(move => [move.key, maxSemanticEvidence(move, { includeRanks: true })])
        )
      },
      model: settings.model || 'jev-latest',
      questions: {
        best_move: {
          type: 'choice',
          instructions: 'Choose the strongest rescue move. Every listed move passed deterministic local guards and is not currently hard-proved losing. Prefer completed Threat NO_PROOF over timeout/unresolved evidence, but inspect the board and forcing tempo directly.',
          criteria: Object.fromEntries(candidates.map(move => [
            move.key,
            `See state.candidates.${move.key}`
          ]))
        }
      }
    };
  }

  async function verifyMaxRescueThreatPool(pool, threatAnalysis) {
    let mergedThreat = threatAnalysis;
    const passes = [];
    if (!pool.length) {
      return { mergedThreat, passes, elapsedMs: 0, retried: [] };
    }

    const mergePass = result => {
      if (!result) return;
      passes.push(result);
      mergedThreat = mergeThreatAnalysis(mergedThreat, result);
      attachThreatEvidence(pool, mergedThreat);
    };

    // Rescue is a rare emergency path. With only one or two candidates, give
    // each candidate an independent budget so a complex proof cannot starve its
    // sibling. This remains sequential and never increases Worker concurrency.
    if (pool.length <= 2) {
      for (const move of pool) {
        const result = await runThreatWorkerAnalysis(
          [move],
          'max',
          'jev_max_rescue_individual',
          { timeBudgetMs: 1100, maxThreatTurns: moves.length < 10 ? 4 : 6, branch: 9 }
        );
        mergePass(result);
      }
    } else {
      const batch = await runThreatWorkerAnalysis(
        pool,
        'max',
        'jev_max_rescue_sweep',
        { timeBudgetMs: 1450, maxThreatTurns: moves.length < 10 ? 4 : 6, branch: 9 }
      );
      mergePass(batch);

      // Retry at most two unresolved roots independently. The batch remains the
      // fast path; retries only spend extra wall time when proof coverage would
      // otherwise be ambiguous.
      const unresolved = pool
        .filter(move => !hasCompletedThreatEvidence(mergedThreat, move.key))
        .slice(0, 2);
      for (const move of unresolved) {
        const retry = await runThreatWorkerAnalysis(
          [move],
          'max',
          'jev_max_rescue_retry',
          { timeBudgetMs: 900, maxThreatTurns: moves.length < 10 ? 4 : 6, branch: 9 }
        );
        mergePass(retry);
      }
    }

    const elapsedMs = passes.reduce((sum, result) => sum + (Number(result?.elapsedMs) || 0), 0);
    return {
      mergedThreat,
      passes,
      elapsedMs,
      retried: passes
        .filter(result => result?.trigger === 'jev_max_rescue_retry' || result?.trigger === 'jev_max_rescue_individual')
        .flatMap(result => (result?.analyses || []).map(row => row.move))
    };
  }

  async function runMaxRescueSweep(context, provenMain, deepAnalysis, threatAnalysis, priorAtomic = null) {
    const blocked = new Set([
      ...provenThreatLossKeys(threatAnalysis),
      ...context.candidates.filter(maxHardProvenLoss).map(move => move.key)
    ]);
    const pool = [];
    const seen = new Set();
    const add = (move, source) => {
      if (!move || seen.has(move.key) || blocked.has(move.key)) return;
      const checked = validateWildcardCandidate(move);
      if (!checked) return;
      const candidate = context.candidates.find(item => item.key === move.key) || checked;
      addRecallSource(candidate, source);
      if (!candidate.analysis?.facts?.threat_verification) {
        candidate.analysis.facts.threat_verification = 'RESCUE_PENDING';
      }
      pool.push(candidate);
      seen.add(candidate.key);
    };

    // First rescue candidates that normal coverage rejected only because their
    // Threat proof did not finish. A timeout is more valuable than a known loss.
    for (const move of context.candidates) {
      if (!maxHardProvenLoss(move) && !hasCompletedThreatEvidence(threatAnalysis, move.key)) {
        add(move, 'RESCUE_UNRESOLVED_MAIN');
      }
      if (pool.length >= 6) break;
    }

    if (pool.length < 6) {
      const extras = extraWildcardPool(context.candidates, 12, blocked);
      for (const move of extras) {
        add(move, 'RESCUE_EXTRA');
        if (pool.length >= 6) break;
      }
    }

    let mergedThreat = threatAnalysis;
    let rescueVerification = { mergedThreat, passes: [], elapsedMs: 0, retried: [] };
    if (pool.length) {
      updateApiState('busy', 'Jev Max：主候选均已证败，执行 bounded rescue sweep…');
      rescueVerification = await verifyMaxRescueThreatPool(pool, threatAnalysis);
      mergedThreat = rescueVerification.mergedThreat;
      attachThreatEvidence(pool, mergedThreat);
    }

    const vetted = pool.filter(move => {
      const row = threatEvidenceForMove(mergedThreat, move.key);
      return Boolean(row && !row.timedOut && row.forced !== true);
    });
    const unresolved = pool.filter(move => {
      const row = threatEvidenceForMove(mergedThreat, move.key);
      return !row || row.timedOut;
    });
    const rescueCandidates = (vetted.length ? vetted : unresolved).slice(0, 4);
    const rescueMode = vetted.length
      ? 'VETTED_RESCUE'
      : unresolved.length
        ? 'UNRESOLVED_RESCUE'
        : 'BOUNDED_RESCUE_EXHAUSTED';

    if (!rescueCandidates.length) {
      const resistance = maxResistanceRank(provenMain);
      const selected = resistance[0] || provenMain[0];
      const usage = priorAtomic?.data?.usage || null;
      const client = priorAtomic?.data ? aggregateJevClient(priorAtomic.data) : null;
      const logicalRequests = priorAtomic?.data ? 1 : 0;
      return {
        answer: {
          choice: selected.key,
          confidence: 1,
          probabilities: { [selected.key]: 1 }
        },
        finalChoice: selected.key,
        localChoice: context.candidates[0]?.key || selected.key,
        jevSuggested: null,
        mode: 'max',
        forced: context.forced,
        candidates: [selected, ...resistance.filter(move => move.key !== selected.key)].slice(0, maxCandidateLimit()),
        model: priorAtomic?.data?.model || 'jev-max-bounded-rescue',
        usage,
        client,
        decisionTrace: {
          atomic: priorAtomic?.trace || null,
          preJevDeepSearch: deepAnalysis || null,
          preJevThreatSearch: threatEvidenceSnapshot(mergedThreat),
          rescueSweep: {
            mode: rescueMode,
            pool: pool.map(move => move.key),
            vetted: vetted.map(move => move.key),
            unresolved: unresolved.map(move => move.key),
            rejectedByProof: pool.filter(maxHardProvenLoss).map(move => move.key),
            elapsedMs: rescueVerification.elapsedMs,
            verificationPasses: rescueVerification.passes.map(result => ({
              trigger: result?.trigger || null,
              status: result?.status || null,
              timedOut: Boolean(result?.timedOut),
              elapsedMs: result?.elapsedMs ?? null,
              candidates: (result?.analyses || []).map(row => row.move)
            })),
            retried: rescueVerification.retried,
            selectedResistance: selected.key
          },
          requestShape: {
            decisionAuthority: 'bounded_rescue_exhausted',
            candidateCount: provenMain.length,
            atomicCount: priorAtomic?.count || 0,
            pairwiseCount: 0,
            criticCount: 0,
            finalistCount: 0,
            logicalRequests,
            httpRequests: client?.attempts || 0,
            maxWorkers: 2,
            payloadEstimatedInputTokens: Number.isFinite(priorAtomic?.tokens) ? [priorAtomic.tokens] : [],
            localSearchBudgetMs: context.localSearch?.budgetMs ?? null,
            localSearchElapsedMs: context.localSearch?.elapsedMs ?? null,
            deepElapsedMs: deepAnalysis?.elapsedMs ?? null,
            threatElapsedMs: mergedThreat?.elapsedMs ?? null,
            rescueSweepElapsedMs: rescueVerification.elapsedMs,
            rescueSweepPasses: rescueVerification.passes.length,
            rescueSweepRetriedCandidates: rescueVerification.retried,
            rescueSweepCandidates: pool.map(move => move.key)
          }
        },
        stageNote: `Jev Max：主候选全部硬证败，bounded rescue 也未找到未证败候选；停止 Jev 败着投票，选择最长抵抗 ${selected.key}`
      };
    }

    const payload = buildMaxRescuePayload(
      rescueCandidates,
      context,
      deepAnalysis,
      mergedThreat,
      rescueMode
    );
    const rescueTokens = estimatePayloadTokens(payload);
    updateApiState('busy', 'Jev Max：从 rescue 候选中进行最终选择…');
    const rescueData = await callJev(payload);
    const raw = rescueData?.answers?.best_move;
    const rescueKeys = new Set(rescueCandidates.map(move => move.key));
    let finalChoice = String(raw?.choice || '').toUpperCase();
    if (!rescueKeys.has(finalChoice)) {
      finalChoice = rescueCandidates[0].key;
    }
    const selected = rescueCandidates.find(move => move.key === finalChoice) || rescueCandidates[0];
    const probabilities = raw?.probabilities && typeof raw.probabilities === 'object'
      ? Object.fromEntries(Object.entries(raw.probabilities)
          .filter(([key]) => rescueKeys.has(String(key).toUpperCase()))
          .map(([key, value]) => [String(key).toUpperCase(), Number(value)]))
      : { [finalChoice]: 1 };
    const answer = {
      ...(raw || {}),
      choice: finalChoice,
      confidence: Number.isFinite(raw?.confidence)
        ? raw.confidence
        : Number.isFinite(Number(probabilities[finalChoice])) ? Number(probabilities[finalChoice]) : null,
      probabilities
    };
    const usage = sumUsage(priorAtomic?.data?.usage, rescueData?.usage);
    const client = aggregateJevClient(priorAtomic?.data, rescueData);
    const logicalRequests = (priorAtomic?.data ? 1 : 0) + 1;
    const finalCandidates = [
      selected,
      ...rescueCandidates.filter(move => move.key !== selected.key),
      ...provenMain.filter(move => move.key !== selected.key)
    ].slice(0, maxCandidateLimit());

    return {
      answer,
      finalChoice,
      localChoice: context.candidates[0]?.key || finalChoice,
      jevSuggested: finalChoice,
      mode: 'max',
      forced: context.forced,
      candidates: finalCandidates,
      model: rescueData?.model || priorAtomic?.data?.model || settings.model,
      usage,
      client,
      decisionTrace: {
        atomic: priorAtomic?.trace || null,
        preJevDeepSearch: deepAnalysis || null,
        preJevThreatSearch: threatEvidenceSnapshot(mergedThreat),
        rescueSweep: {
          mode: rescueMode,
          pool: pool.map(move => move.key),
          vetted: vetted.map(move => move.key),
          unresolved: unresolved.map(move => move.key),
          rejectedByProof: pool.filter(maxHardProvenLoss).map(move => move.key),
          elapsedMs: rescueVerification.elapsedMs,
            verificationPasses: rescueVerification.passes.map(result => ({
              trigger: result?.trigger || null,
              status: result?.status || null,
              timedOut: Boolean(result?.timedOut),
              elapsedMs: result?.elapsedMs ?? null,
              candidates: (result?.analyses || []).map(row => row.move)
            })),
            retried: rescueVerification.retried,
          chosen: finalChoice
        },
        finalDecision: compactAnswer(answer),
        requestShape: {
          decisionAuthority: 'jev_max_rescue',
          candidateCount: provenMain.length,
          atomicCount: priorAtomic?.count || 0,
          pairwiseCount: 0,
          criticCount: 0,
          finalistCount: rescueCandidates.length,
          logicalRequests,
          httpRequests: client?.attempts || 0,
          maxWorkers: 2,
          payloadEstimatedInputTokens: [
            priorAtomic?.tokens,
            rescueTokens
          ].filter(Number.isFinite),
          payloadTokenBudgetTarget: 5000,
          payloadTokenBudgetHard: 7000,
          localSearchBudgetMs: context.localSearch?.budgetMs ?? null,
          localSearchElapsedMs: context.localSearch?.elapsedMs ?? null,
          deepElapsedMs: deepAnalysis?.elapsedMs ?? null,
          threatElapsedMs: mergedThreat?.elapsedMs ?? null,
          rescueSweepElapsedMs: rescueVerification.elapsedMs,
            rescueSweepPasses: rescueVerification.passes.length,
            rescueSweepRetriedCandidates: rescueVerification.retried,
          rescueSweepCandidates: pool.map(move => move.key)
        },
        localEvidence: finalCandidates.map(move => ({
          move: move.key,
          sources: [...(move.recallSources || [])],
          localRank: move.localRank ?? null,
          localSearchScore: Number.isFinite(move.searchScore) && !isSentinelSearchScore(move.searchScore) ? move.searchScore : null,
          threatSearch: move.threatSearch || null,
          facts: move.analysis?.facts || null
        }))
      },
      stageNote: `Jev Max：主候选全部硬证败 → bounded rescue sweep → ${rescueMode}，${logicalRequests} 次 Jev 请求后选择 ${finalChoice}`
    };
  }

  function buildMaxFinalPayload(candidates, context, deepAnalysis, threatAnalysis) {
    const candidateEvidence = Object.fromEntries(
      candidates.map(move => [move.key, maxSemanticEvidence(move, { includeRanks: true })])
    );
    return {
      state: {
        task: 'Jev Max final Gomoku judgement after independent atomic evaluation, order-balanced pairwise tournament, opponent-best-reply search, and adversarial critic analysis.',
        side: colorNameEn(aiColor()),
        board_size: '15x15',
        coordinate_system: 'Columns A-O left to right; rows 1-15 top to bottom.',
        board_legend: boardLegendForAi(),
        board_rows: boardRows(),
        last_move: moves.length ? moves[moves.length - 1].coord : null,
        rules: renjuRuleDescription(),
        gomoku_doctrine: gomokuDecisionDoctrine(),
        deterministic_engine_role: 'Deterministic engines are advisors, not authorities, except legality and proven forced results. You should disagree with Local / Deep when board geometry or opponent best-response analysis gives a stronger reason.',
        priority: 'LEGALITY / proven forced result > forced tactical sequence > opponent best-response robustness > deep search > multi-axis strategic pressure > pattern heuristic > positional preference',
        deep_search_status: compactEvidence({
          status: deepAnalysis?.status || 'unavailable',
          depth_reached: deepAnalysis?.depthReached ?? null,
          ranking_only: Boolean(deepAnalysis?.rankingOnly),
          timed_out: Boolean(deepAnalysis?.timedOut)
        }),
        threat_search_status: compactEvidence({
          status: threatAnalysis?.status || 'unavailable',
          timed_out: Boolean(threatAnalysis?.timedOut),
          max_attacker_turns: threatAnalysis?.maxThreatTurns ?? null
        }),
        candidates: candidateEvidence
      },
      model: settings.model || 'jev-latest',
      questions: {
        best_move: {
          type: 'choice',
          instructions: 'Choose the FINAL legal move. Use the recorded Atomic, Pairwise, principal variation / opponent best replies, Threat-space proof, and critic result. Do not mechanically follow Local or Deep ranking. Never override a proven forced result or legality rule.',
          criteria: Object.fromEntries(candidates.map(move => [
            move.key,
            `See state.candidates.${move.key}`
          ]))
        }
      }
    };
  }

  function deterministicMaxResult(context, candidates, choice, deepAnalysis, threatAnalysis, reason) {
    const selected = candidates.find(move => move.key === choice) || candidates[0];
    return {
      answer: { choice: selected.key, confidence: 1, probabilities: { [selected.key]: 1 } },
      finalChoice: selected.key,
      localChoice: context.candidates[0]?.key || selected.key,
      jevSuggested: null,
      mode: 'max',
      forced: context.forced,
      candidates: [selected, ...candidates.filter(move => move.key !== selected.key)],
      model: 'jev-max-deterministic-proof',
      usage: null,
      client: null,
      decisionTrace: {
        candidateSources: candidates.map(move => ({
          move: move.key,
          sources: [...(move.recallSources || [])]
        })),
        preJevDeepSearch: deepAnalysis || null,
        preJevThreatSearch: threatEvidenceSnapshot(threatAnalysis),
        requestShape: {
          decisionAuthority: reason,
          candidateCount: candidates.length,
          logicalRequests: 0,
          httpRequests: 0,
          maxWorkers: 2,
          localSearchBudgetMs: context.localSearch?.budgetMs ?? null,
          localSearchElapsedMs: context.localSearch?.elapsedMs ?? null
        }
      },
      stageNote: `Jev Max：确定性规则直接裁决（${reason}，0 次 Jev 请求）`
    };
  }

  async function jevMaxDecision() {
    const context = buildAdvancedCandidates('max');
    let candidates = context.candidates;
    if (!candidates.length) throw new Error('Jev Max 没有生成合法候选点');

    candidates.forEach((move, index) => {
      move.localRank = move.rank ?? index + 1;
      move.localNorm = candidates.length === 1 ? 1 : 1 - (index / Math.max(1, candidates.length - 1));
    });

    const allImmediateWins = candidates.length && candidates.every(move => move.analysis?.winsNow);
    if (allImmediateWins || candidates.length === 1 || context.forced === 'forced_loss_double_win') {
      return deterministicMaxResult(
        context, candidates, candidates[0].key, null, null,
        allImmediateWins
          ? 'immediate_win'
          : context.forced === 'forced_loss_double_win'
            ? 'proven_double_immediate_loss'
            : 'single_forced_candidate'
      );
    }

    const deepCandidates = candidates.slice(0, Math.min(5, candidates.length));
    const threatCandidates = selectMaxThreatCandidates(candidates, 6);
    const initialThreatKeys = new Set(threatCandidates.map(move => move.key));
    const speculativeThreatCandidates = candidates
      .filter(move => !initialThreatKeys.has(move.key))
      .slice(0, 2);

    updateApiState('busy', 'Jev Max：Deep / Threat 长驻 Worker 并行准备证据…');
    const deepPromise = runDeepWorkerVerification(deepCandidates, 'max', 'jev_max_parallel');
    const threatPromise = runThreatWorkerAnalysis(threatCandidates, 'max', 'jev_max_parallel');
    const speculativeThreatPromise = speculativeThreatCandidates.length
      ? runThreatWorkerAnalysis(
          speculativeThreatCandidates,
          'max',
          'jev_max_speculative_tail',
          { timeBudgetMs: 850, maxThreatTurns: moves.length < 10 ? 4 : 6, branch: 8 }
        )
      : Promise.resolve(null);

    const [deepAnalysis, initialThreatAnalysis] = await Promise.all([
      deepPromise,
      threatPromise
    ]);
    let threatAnalysis = initialThreatAnalysis;

    attachMaxDeepEvidence(candidates, deepAnalysis);
    candidates = hardFilterMaxCandidates(candidates, threatAnalysis);
    const deepDominance = applyMaxDeepDominance(candidates, deepAnalysis);
    candidates = deepDominance.candidates;

    const preAtomicFrontier = await closePreAtomicLossFrontier(
      context.candidates,
      candidates,
      threatAnalysis
    );
    candidates = preAtomicFrontier.candidates;
    threatAnalysis = preAtomicFrontier.threatAnalysis;

    if (allMaxCandidatesHardLost(candidates)) {
      const rescue = await runMaxRescueSweep(context, candidates, deepAnalysis, threatAnalysis);
      if (rescue?.decisionTrace?.requestShape) {
        rescue.decisionTrace.requestShape.preAtomicFrontierElapsedMs = preAtomicFrontier.supplemental?.elapsedMs ?? null;
        rescue.decisionTrace.requestShape.preAtomicFrontierCandidates = preAtomicFrontier.supplemental?.analyses?.map(row => row.move) || [];
      }
      return rescue;
    }

    if (candidates.length === 1) {
      return deterministicMaxResult(
        context, candidates, candidates[0].key, deepAnalysis, threatAnalysis,
        candidates[0].analysis?.vcf ? 'proven_vcf_single' : 'threat_filter_single'
      );
    }

    let hardRejectedThreatKeys = provenThreatLossKeys(threatAnalysis);
    let wildcardPool = extraWildcardPool(candidates, 12, hardRejectedThreatKeys);
    let speculativePool = candidates.slice(0, Math.min(6, candidates.length));
    let fanout = buildMaxSpeculativePayload(context, candidates, speculativePool, wildcardPool);
    let fanoutTokens = estimatePayloadTokens(fanout.payload);

    // Keep the main candidate recall intact when possible. First reduce only
    // speculative comparisons; if the shared-state payload still crosses the
    // historical hard target, fall back to the existing six-candidate ceiling.
    if (Number.isFinite(fanoutTokens) && fanoutTokens > 7000 && speculativePool.length > 4) {
      speculativePool = candidates.slice(0, Math.min(4, candidates.length));
      fanout = buildMaxSpeculativePayload(context, candidates, speculativePool, wildcardPool);
      fanoutTokens = estimatePayloadTokens(fanout.payload);
    }
    if (Number.isFinite(fanoutTokens) && fanoutTokens > 7000 && candidates.length > 6) {
      candidates = candidates.slice(0, 6);
      hardRejectedThreatKeys = provenThreatLossKeys(threatAnalysis);
      wildcardPool = extraWildcardPool(candidates, 12, hardRejectedThreatKeys);
      speculativePool = candidates.slice(0, Math.min(6, candidates.length));
      fanout = buildMaxSpeculativePayload(context, candidates, speculativePool, wildcardPool);
      fanoutTokens = estimatePayloadTokens(fanout.payload);
      if (Number.isFinite(fanoutTokens) && fanoutTokens > 7000 && speculativePool.length > 4) {
        speculativePool = candidates.slice(0, 4);
        fanout = buildMaxSpeculativePayload(context, candidates, speculativePool, wildcardPool);
        fanoutTokens = estimatePayloadTokens(fanout.payload);
      }
    }

    updateApiState('busy', 'Jev Max：一次 Fan-Out 并行执行 Atomic / Pairwise / Critic…');
    const fanoutData = await callJev(fanout.payload);
    const atomic = atomicTraceFor(candidates, fanoutData?.answers || {});
    const atomicCandidateCount = candidates.length;
    const recallChoice = String(fanoutData?.answers?.recall_check?.choice || 'MAIN_SET').toUpperCase();
    const globalBest = compactAnswer(fanoutData?.answers?.global_best);

    let atomicTop4 = [...candidates]
      .sort((a, b) => (b.atomicScore || 0) - (a.atomicScore || 0)
        || (a.localRank || 999) - (b.localRank || 999))
      .slice(0, Math.min(4, candidates.length));

    const preCoverageCandidates = [...candidates];
    const coverage = await closeMaxThreatCoverage(
      candidates,
      atomicTop4,
      threatAnalysis,
      speculativeThreatPromise
    );
    candidates = coverage.candidates;
    threatAnalysis = coverage.threatAnalysis;
    atomicTop4 = [...candidates]
      .sort((a, b) => (b.atomicScore || 0) - (a.atomicScore || 0)
        || (a.localRank || 999) - (b.localRank || 999))
      .slice(0, Math.min(4, candidates.length));

    if (!candidates.length || allMaxCandidatesHardLost(candidates)) {
      const rescueBaseline = candidates.length ? candidates : preCoverageCandidates;
      return runMaxRescueSweep(
        context,
        rescueBaseline,
        deepAnalysis,
        threatAnalysis,
        {
          data: fanoutData,
          trace: atomic,
          count: atomicCandidateCount,
          tokens: fanoutTokens
        }
      );
    }

    if (candidates.length === 1) {
      const result = deterministicMaxResult(
        context,
        candidates,
        candidates[0].key,
        deepAnalysis,
        threatAnalysis,
        'post_fanout_threat_single'
      );
      const client = aggregateJevClient(fanoutData);
      result.model = fanoutData?.model || settings.model;
      result.usage = fanoutData?.usage || null;
      result.client = client;
      result.decisionTrace.atomic = atomic;
      result.decisionTrace.recallCheck = compactAnswer(fanoutData?.answers?.recall_check);
      result.decisionTrace.globalBest = globalBest;
      Object.assign(result.decisionTrace.requestShape, {
        logicalRequests: 1,
        httpRequests: client.attempts,
        fanoutPairwiseCount: fanout.pairs.length * 2,
        fanoutCriticCount: fanout.speculativePool.length,
        payloadEstimatedInputTokens: [fanoutTokens].filter(Number.isFinite)
      });
      result.stageNote = `Jev Max：Fan-Out 后 Threat 证明收敛到唯一候选 ${candidates[0].key}（1 次 Jev 请求）`;
      return result;
    }

    const pairwiseThreatCoverageComplete = atomicTop4.every(move =>
      hasCompletedThreatEvidence(threatAnalysis, move.key)
    );
    if (!pairwiseThreatCoverageComplete) {
      throw new Error('Jev Max Threat coverage closure invariant failed before Pairwise');
    }

    const wildcardChoice = recallChoice === 'OTHER'
      ? String(fanoutData?.answers?.wildcard_pick?.choice || '').toUpperCase()
      : '';
    let wildcard = null;
    let wildcardValidation = null;
    if (wildcardChoice) {
      const proposed = wildcardPool.find(move => move.key === wildcardChoice);
      const checked = await validateWildcardForMax(proposed, threatAnalysis);
      wildcard = checked.candidate;
      wildcardValidation = checked.validation;
      if (wildcard) {
        wildcard.atomicScore = .5;
        wildcard.pairScore = 0;
      }
    }

    const atomicTopKeys = new Set(atomicTop4.map(move => move.key));
    const speculativePoolKeys = new Set(fanout.speculativePool);
    const expectedPairs = atomicTop4.length * (atomicTop4.length - 1) / 2;
    let usedPairs = fanout.pairs.filter(pair =>
      atomicTopKeys.has(pair.a) && atomicTopKeys.has(pair.b)
    );
    const fanoutCovered = atomicTop4.every(move => speculativePoolKeys.has(move.key))
      && usedPairs.length === expectedPairs;

    let pairwise = [];
    let critic = [];
    let ranked = [];
    let finalists = [];
    let answer = null;
    let finalChoice = null;
    let secondData = null;
    let secondTokens = null;
    let decisionAuthority = null;
    let pairwiseSource = 'speculative_fanout';

    if (fanoutCovered) {
      pairwise = scorePairwiseTournament(atomicTop4, usedPairs, fanoutData?.answers || {});
      critic = maxCriticTrace(atomicTop4, fanoutData?.answers || {});
      ranked = pairwiseRank(atomicTop4);
      finalists = ranked.slice(0, Math.min(2, ranked.length));
      if (wildcard && !finalists.some(move => move.key === wildcard.key)) {
        finalists = [...finalists, wildcard].slice(0, 3);
      }

      const converged = !wildcard && highConfidenceMaxConvergence(ranked, globalBest);
      if (converged) {
        answer = pairwiseAnswer(ranked);
        finalChoice = answer.choice;
        decisionAuthority = 'jev_max_fanout_convergence';
      } else {
        const finalPayload = buildMaxFinalPayload(finalists, context, deepAnalysis, threatAnalysis);
        secondTokens = estimatePayloadTokens(finalPayload);
        updateApiState('busy', 'Jev Max：证据存在分歧，执行第 2 次最终裁决…');
        secondData = await callJev(finalPayload);
        const raw = secondData?.answers?.best_move;
        if (!raw || typeof raw.choice !== 'string') {
          throw new Error('Jev Max 最终响应中缺少 answers.best_move.choice');
        }
        const finalistKeys = new Set(finalists.map(move => move.key));
        finalChoice = raw.choice.toUpperCase();
        if (!finalistKeys.has(finalChoice)) {
          throw new Error(`Jev Max 返回候选集之外的落点：${raw.choice}`);
        }
        const probabilities = raw.probabilities && typeof raw.probabilities === 'object'
          ? Object.fromEntries(Object.entries(raw.probabilities)
              .filter(([key]) => finalistKeys.has(String(key).toUpperCase()))
              .map(([key, value]) => [String(key).toUpperCase(), Number(value)]))
          : { [finalChoice]: 1 };
        answer = {
          ...raw,
          choice: finalChoice,
          confidence: Number.isFinite(raw.confidence)
            ? raw.confidence
            : Number.isFinite(Number(probabilities[finalChoice])) ? Number(probabilities[finalChoice]) : null,
          probabilities
        };
        decisionAuthority = 'jev_max_final';
      }
    } else {
      // Rare difficult path: Atomic promoted a candidate outside the speculative
      // top-six pool. Resolve Pairwise/Critic and a final best-move vote together
      // in the second and final request, preserving the two-request ceiling.
      const resolution = buildMaxResolutionPayload(
        context,
        atomicTop4,
        fanoutData?.answers || {},
        wildcard
      );
      secondTokens = estimatePayloadTokens(resolution.payload);
      updateApiState('busy', 'Jev Max：Atomic 改写决赛池，第 2 次 Fan-Out 解决分歧…');
      secondData = await callJev(resolution.payload);
      usedPairs = resolution.pairs;
      pairwise = scorePairwiseTournament(atomicTop4, resolution.pairs, secondData?.answers || {});
      critic = maxCriticTrace(atomicTop4, secondData?.answers || {});
      ranked = pairwiseRank(atomicTop4);
      pairwiseSource = 'resolution_fanout';

      const raw = secondData?.answers?.best_move;
      const resolutionKeys = new Set(resolution.candidates.map(move => move.key));
      let rawChoice = String(raw?.choice || '').toUpperCase();
      if (!resolutionKeys.has(rawChoice)) rawChoice = ranked[0]?.key || resolution.candidates[0]?.key;
      const rawProbabilities = raw?.probabilities && typeof raw.probabilities === 'object'
        ? Object.fromEntries(Object.entries(raw.probabilities)
            .filter(([key]) => resolutionKeys.has(String(key).toUpperCase()))
            .map(([key, value]) => [String(key).toUpperCase(), Number(value)]))
        : { [rawChoice]: 1 };
      const resolutionAnswer = {
        ...(raw || {}),
        choice: rawChoice,
        confidence: Number.isFinite(raw?.confidence)
          ? raw.confidence
          : Number.isFinite(Number(rawProbabilities[rawChoice])) ? Number(rawProbabilities[rawChoice]) : null,
        probabilities: rawProbabilities
      };

      if (
        !wildcard
        && ranked[0]
        && resolutionAnswer.choice === ranked[0].key
        && highConfidenceMaxConvergence(ranked, resolutionAnswer)
      ) {
        answer = pairwiseAnswer(ranked);
      } else {
        answer = resolutionAnswer;
      }
      finalChoice = answer.choice;
      finalists = resolution.candidates;
      decisionAuthority = 'jev_max_resolution_fanout';
    }

    let final = finalists.find(move => move.key === finalChoice)
      || ranked.find(move => move.key === finalChoice)
      || candidates.find(move => move.key === finalChoice);
    if (!final) throw new Error('Jev Max 最终选择无法映射到合法候选');

    const semanticChoice = finalChoice;
    const overrideGuard = await runMaxSemanticOverrideGuard(context, candidates, final);
    if (overrideGuard.vetoed && overrideGuard.choice !== finalChoice) {
      const guarded = candidates.find(move => move.key === overrideGuard.choice);
      if (guarded) {
        finalChoice = guarded.key;
        final = guarded;
        answer = {
          ...(answer || {}),
          choice: finalChoice,
          confidence: null,
          probabilities: { [finalChoice]: 1 }
        };
        decisionAuthority = decisionAuthority + '_deep_guard';
      }
    }

    const finalCandidates = [
      final,
      ...candidates.filter(move => move.key !== final.key),
      ...(wildcard && !candidates.some(move => move.key === wildcard.key) && wildcard.key !== final.key ? [wildcard] : [])
    ].slice(0, maxCandidateLimit());

    const usage = sumUsage(fanoutData?.usage, secondData?.usage);
    const client = aggregateJevClient(fanoutData, secondData);
    const logicalRequests = secondData ? 2 : 1;
    const estimatedInputTokens = [fanoutTokens, secondTokens].filter(Number.isFinite);

    return {
      answer,
      finalChoice,
      localChoice: context.candidates[0]?.key || candidates[0]?.key || finalChoice,
      jevSuggested: semanticChoice,
      mode: 'max',
      forced: context.forced,
      candidates: finalCandidates,
      model: secondData?.model || fanoutData?.model || settings.model,
      usage,
      client,
      decisionTrace: {
        candidateSources: candidates.map(move => ({
          move: move.key,
          sources: [...(move.recallSources || [])]
        })),
        atomic,
        recallCheck: compactAnswer(fanoutData?.answers?.recall_check),
        globalBest,
        pairwise,
        critic,
        wildcard: {
          requested: recallChoice === 'OTHER',
          pool: wildcardPool.map(move => move.key),
          excludedByThreatProof: [...hardRejectedThreatKeys],
          proposed: wildcardChoice || null,
          accepted: wildcard?.key || null,
          validation: wildcardValidation,
          enteredFinalists: Boolean(wildcard && finalists.some(move => move.key === wildcard.key)),
          chosen: finalChoice === wildcard?.key
        },
        preJevDeepSearch: deepAnalysis ? {
          status: deepAnalysis.status || null,
          source: deepAnalysis.source || null,
          depthReached: deepAnalysis.depthReached ?? null,
          rankingOnly: Boolean(deepAnalysis.rankingOnly),
          timedOut: Boolean(deepAnalysis.timedOut),
          elapsedMs: deepAnalysis.elapsedMs ?? null,
          budgetMs: deepAnalysis.budgetMs ?? null,
          scores: (deepAnalysis.scores || []).map(item => ({
            move: item.move,
            score: Number.isFinite(item.score) && !isSentinelSearchScore(item.score) ? item.score : null,
            fallbackRank: item.fallbackRank ?? null,
            forcedResult: item.forcedResult ? {
              ...item.forcedResult,
              proven: false,
              advisory: true
            } : structuredForcedResult(item.score, 'DEEP_SEARCH_SENTINEL', false),
            principalVariation: Array.isArray(item.principalVariation) ? item.principalVariation.slice(0, 8) : [],
            opponentBestReplies: Array.isArray(item.opponentBestReplies) ? item.opponentBestReplies.slice(0, 2) : []
          }))
        } : null,
        preJevThreatSearch: threatEvidenceSnapshot(threatAnalysis),
        threatCoverage: {
          speculativeQueued: speculativeThreatCandidates.map(move => move.key),
          speculativeUsed: Boolean(coverage.speculative),
          speculativeCandidates: coverage.speculative?.analyses?.map(row => row.move) || [],
          speculativeElapsedMs: coverage.speculative?.elapsedMs ?? null,
          supplementalTriggered: Boolean(coverage.supplemental),
          supplementalCandidates: coverage.supplemental?.analyses?.map(row => row.move) || [],
          rejectedIncomplete: coverage.rejectedIncomplete,
          elapsedMs: coverage.supplemental?.elapsedMs ?? null
        },
        finalDecision: secondData ? compactAnswer(answer) : null,
        semanticOverrideGuard: {
          vetoed: Boolean(overrideGuard?.vetoed),
          reason: overrideGuard?.reason || null,
          localMove: overrideGuard?.localMove || null,
          semanticMove: overrideGuard?.semanticMove || null,
          choice: overrideGuard?.choice || null,
          status: overrideGuard?.analysis?.status || null,
          depthReached: overrideGuard?.analysis?.depthReached ?? null,
          timedOut: Boolean(overrideGuard?.analysis?.timedOut),
          elapsedMs: overrideGuard?.analysis?.elapsedMs ?? null,
          scores: (overrideGuard?.analysis?.scores || []).map(row => ({
            move: row.move,
            score: Number.isFinite(row.score) ? row.score : null,
            forcedResult: row.forcedResult || null,
            principalVariation: Array.isArray(row.principalVariation) ? row.principalVariation.slice(0, 8) : []
          }))
        },
        requestShape: {
          decisionAuthority,
          candidateCount: candidates.length,
          atomicCount: atomicCandidateCount,
          pairwiseCount: usedPairs.length * 2,
          criticCount: atomicTop4.length,
          finalistCount: finalists.length,
          logicalRequests,
          httpRequests: client.attempts,
          maxWorkers: HEAVY_WORKER_POOL_SIZE,
          workerPoolPersistent: true,
          fanoutSpeculativePool: fanout.speculativePool,
          fanoutPairwiseCount: fanout.pairs.length * 2,
          fanoutCriticCount: fanout.speculativePool.length,
          pairwiseSource,
          payloadEstimatedInputTokens: estimatedInputTokens,
          payloadTokenBudgetTarget: 5000,
          payloadTokenBudgetHard: 7000,
          localSearchBudgetMs: context.localSearch?.budgetMs ?? null,
          localSearchElapsedMs: context.localSearch?.elapsedMs ?? null,
          localSearchTimedOut: Boolean(context.localSearch?.timedOut),
          localTranspositionEntries: context.localSearch?.transpositionEntries ?? null,
          localTranspositionGeneration: context.localSearch?.transpositionGeneration ?? null,
          deepElapsedMs: deepAnalysis?.elapsedMs ?? null,
          deepDominanceApplied: Boolean(deepDominance?.applied),
          deepDominanceLeader: deepDominance?.leader || null,
          deepDominanceLeaderScore: deepDominance?.leaderScore ?? null,
          deepDominanceDepthReached: deepDominance?.depthReached ?? null,
          deepDominanceRejected: deepDominance?.rejected || [],
          deepDominanceGapThreshold: deepDominance?.gapThreshold ?? null,
          overrideGuardElapsedMs: overrideGuard?.analysis?.elapsedMs ?? null,
          overrideGuardVetoed: Boolean(overrideGuard?.vetoed),
          overrideGuardReason: overrideGuard?.reason || null,
          overrideGuardLocalMove: overrideGuard?.localMove || null,
          overrideGuardSemanticMove: overrideGuard?.semanticMove || null,
          threatElapsedMs: threatAnalysis?.elapsedMs ?? null,
          threatSpeculativeElapsedMs: coverage.speculative?.elapsedMs ?? null,
          threatSupplementalElapsedMs: coverage.supplemental?.elapsedMs ?? null,
          threatSupplementalCandidates: coverage.supplemental?.analyses?.map(row => row.move) || [],
          threatCoverageRejectedIncomplete: coverage.rejectedIncomplete,
          pairwiseThreatCoverageComplete,
          threatFilterCount: context.candidates.length - candidates.length
        },
        localEvidence: finalCandidates.map(move => ({
          move: move.key,
          sources: [...(move.recallSources || [])],
          localRank: move.localRank ?? null,
          localSearchScore: Number.isFinite(move.searchScore) && !isSentinelSearchScore(move.searchScore) ? move.searchScore : null,
          localForcedResult: structuredForcedResult(move.searchScore, 'LOCAL_ALPHA_BETA_SENTINEL', false),
          deepSearchRank: move.deepSearchRank ?? null,
          deepSearchScore: Number.isFinite(move.deepSearchScore) ? move.deepSearchScore : null,
          deepEvidence: move.deepEvidence || null,
          atomicScore: Number.isFinite(move.atomicScore) ? move.atomicScore : null,
          pairScore: Number.isFinite(move.pairScore) ? move.pairScore : null,
          criticSummary: move.criticSummary || null,
          threatSearch: move.threatSearch || null,
          facts: move.analysis?.facts || null
        }))
      },
      stageNote: logicalRequests === 1
        ? `Jev Max：Speculative Fan-Out 单请求收敛，选择 ${finalChoice}`
        : decisionAuthority === 'jev_max_resolution_fanout'
          ? `Jev Max：首轮 Fan-Out + 困难局面 Resolution Fan-Out，2 次 Jev 请求后选择 ${finalChoice}`
          : `Jev Max：首轮 Fan-Out 后证据仍有分歧，第 2 次 Final Judge 选择 ${finalChoice}`
    };
  }

  async function grandmasterDecision() {
    const context = buildAdvancedCandidates('grandmaster');
    const allCandidates = context.candidates;
    if (!allCandidates.length) throw new Error('宗师模式没有生成合法候选点');

    allCandidates.forEach((move, index) => {
      move.localRank = move.rank ?? index + 1;
      move.localNorm = allCandidates.length === 1 ? 1 : 1 - (index / (allCandidates.length - 1));
    });

    if (allCandidates.length === 1) {
      return deterministicGrandmasterResult(context, allCandidates, allCandidates[0].key, null, null, 'single_candidate');
    }

    const deepCandidates = allCandidates.slice(0, Math.min(4, allCandidates.length));
    const threatCandidates = allCandidates.slice(0, Math.min(6, allCandidates.length));
    updateApiState('busy', '宗师模式：深搜与威胁空间搜索并行计算…');
    const [deepAnalysis, threatAnalysis] = await Promise.all([
      runDeepWorkerVerification(deepCandidates, 'grandmaster', 'grandmaster_parallel'),
      runThreatWorkerAnalysis(threatCandidates, 'grandmaster', 'grandmaster_parallel')
    ]);

    const deepRows = Array.isArray(deepAnalysis?.scores) ? deepAnalysis.scores : [];
    const deepByMove = new Map(deepRows.map((item, index) => [
      item.move,
      { score: item.score, rank: index + 1 }
    ]));
    allCandidates.forEach(move => {
      const deep = deepByMove.get(move.key);
      move.deepSearchScore = Number.isFinite(deep?.score) ? deep.score : null;
      move.deepSearchRank = deep?.rank ?? null;
    });

    const candidates = grandmasterCandidateFilter(allCandidates, threatAnalysis);
    const localChoice = candidates[0];
    const deepChoice = bestDeepCandidate(candidates, deepAnalysis);
    const patternExpert = patternExpertSummary(candidates);
    const localThreat = localChoice?.threatSearch || null;

    if (candidates.length === 1) {
      return deterministicGrandmasterResult(
        context, candidates, candidates[0].key, deepAnalysis, threatAnalysis, 'threat_filter_single'
      );
    }

    const reliableDeep = deepAnalysis?.status === 'completed'
      && !deepAnalysis?.timedOut
      && Boolean(deepChoice);
    const reliableThreat = threatAnalysis?.status === 'completed'
      && !threatAnalysis?.timedOut
      && localThreat
      && !localThreat.timedOut
      && !localThreat.forced;

    const patternAllowsConsensus = !patternExpert.reliable || patternExpert.choice === localChoice.key;
    if (reliableDeep && reliableThreat && deepChoice === localChoice.key && patternAllowsConsensus) {
      const result = deterministicGrandmasterResult(
        context, candidates, localChoice.key, deepAnalysis, threatAnalysis, 'multi_engine_consensus'
      );
      result.decisionTrace.patternExpert = patternExpert;
      return result;
    }

    const payload = buildFinalJevPayload(context, candidates, deepAnalysis, threatAnalysis);
    updateApiState('busy', '宗师模式：多路证据有分歧，Jev 正在裁决…');
    const data = await callJev(payload);
    const rawAnswer = data?.answers?.best_move;
    if (!rawAnswer || typeof rawAnswer.choice !== 'string') {
      throw new Error('Jev 响应中缺少 answers.best_move.choice');
    }

    const finalChoice = rawAnswer.choice.toUpperCase();
    const candidateKeys = new Set(candidates.map(move => move.key));
    if (!candidateKeys.has(finalChoice)) {
      throw new Error(`Jev 返回候选集之外的落点：${rawAnswer.choice}`);
    }

    const probabilities = rawAnswer.probabilities && typeof rawAnswer.probabilities === 'object'
      ? Object.fromEntries(
          Object.entries(rawAnswer.probabilities)
            .filter(([key]) => candidateKeys.has(String(key).toUpperCase()))
            .map(([key, value]) => [String(key).toUpperCase(), Number(value)])
        )
      : { [finalChoice]: 1 };
    const probabilityConfidence = Number(probabilities[finalChoice]);
    const answer = {
      ...rawAnswer,
      choice: finalChoice,
      confidence: Number.isFinite(rawAnswer.confidence)
        ? rawAnswer.confidence
        : Number.isFinite(probabilityConfidence) ? probabilityConfidence : null,
      probabilities
    };
    const final = candidates.find(move => move.key === finalChoice);
    const ranked = [final, ...candidates.filter(move => move.key !== finalChoice)];

    return {
      answer,
      finalChoice,
      localChoice: context.candidates[0]?.key || localChoice.key,
      jevSuggested: finalChoice,
      mode: 'grandmaster',
      forced: context.forced,
      candidates: ranked,
      model: data?.model || settings.model,
      usage: data?.usage || null,
      client: data?.__client || null,
      decisionTrace: {
        requestShape: {
          finalDecisionQuestions: 1,
          candidateCount: candidates.length,
          httpRequests: data?.__client?.cached ? 0 : (data?.__client?.attempts || 1),
          localEvidenceVisibleToJev: true,
          threatEvidenceVisibleToJev: true,
          decisionAuthority: 'jev_on_disagreement',
          parallelEvidence: true,
          localSearchBudgetMs: context.localSearch?.budgetMs ?? null,
          localSearchElapsedMs: context.localSearch?.elapsedMs ?? null,
          localSearchTimedOut: Boolean(context.localSearch?.timedOut),
          localSearchDepthReached: context.localSearch?.depthReached ?? null,
          localSearchTargetDepth: context.localSearch?.targetDepth ?? context.cfg.depth
        },
        preJevDeepSearch: deepAnalysis ? {
          status: deepAnalysis.status || null,
          source: deepAnalysis.source || null,
          depthReached: deepAnalysis.depthReached ?? null,
          timedOut: Boolean(deepAnalysis.timedOut),
          elapsedMs: deepAnalysis.elapsedMs ?? null,
          budgetMs: deepAnalysis.budgetMs ?? null,
          scores: deepRows.map(item => ({ move: item.move, score: item.score }))
        } : null,
        preJevThreatSearch: threatEvidenceSnapshot(threatAnalysis),
        patternExpert,
        finalDecision: compactAnswer(answer),
        localEvidence: candidates.map(move => ({
          move: move.key,
          localRank: move.localRank,
          localSearchScore: Number.isFinite(move.searchScore) ? move.searchScore : null,
          deepSearchRank: move.deepSearchRank,
          deepSearchScore: Number.isFinite(move.deepSearchScore) ? move.deepSearchScore : null,
          threatSearch: move.threatSearch || null,
          facts: move.analysis?.facts || null
        }))
      },
      stageNote: `宗师模式：Alpha-Beta / Deep Search 与 Threat-space Search 出现分歧或证据不足，Jev 在 ${candidates.length} 个过滤候选中最终选择 ${finalChoice}（最多 1 次 Jev 请求）`
    };
  }

  function shouldRunPreJevDeepSearch(mode, candidates) {
    if (mode !== 'expert' || candidates.length < 2) return false;
    // Avoid launching a second expensive search while the board is still
    // highly symmetric. This was the dominant crash path on the hosted page.
    return moves.length >= 10;
  }

  function shouldRunHorizonGuard(mode, candidates, localChoice) {
    if (mode !== 'expert' || moves.length < 12 || candidates.length < 2) return false;
    if (localChoice?.analysis?.winsNow || localChoice?.analysis?.vcf) return false;
    const facts = localChoice?.analysis?.facts || {};
    return facts.initiative === 'FORCING'
      || facts.tactical_safety !== 'SAFE'
      || facts.opponent_fork_creators_after_move === 'ONE'
      || facts.opponent_fork_creators_after_move === 'MULTIPLE'
      || facts.attack_shape === 'FOUR_PLUS_FOLLOWUP'
      || facts.attack_shape === 'MULTIPLE_OPEN_THREE_PRESSURE';
  }

  async function advancedDecision(mode) {
    if (mode === 'max') return jevMaxDecision();
    if (mode === 'grandmaster') return grandmasterDecision();
    const context = buildAdvancedCandidates(mode);
    const candidates = context.candidates;
    if (!candidates.length) throw new Error('本地引擎没有生成合法候选点');

    candidates.forEach((move, index) => {
      move.localRank = move.rank ?? index + 1;
      move.localNorm = candidates.length === 1 ? 1 : 1 - (index / (candidates.length - 1));
    });

    // A single deterministic candidate does not benefit from a paid/network
    // decision call. Local has already reduced the action space to one move.
    if (candidates.length === 1) {
      const only = candidates[0];
      return {
        answer: { choice: only.key, confidence: 1, probabilities: { [only.key]: 1 } },
        finalChoice: only.key,
        localChoice: only.key,
        jevSuggested: only.key,
        mode,
        forced: context.forced,
        candidates,
        model: `${settings.model || 'jev-latest'} + local-forced`,
        usage: null,
        client: null,
        decisionTrace: {
          local: { reason: 'single_deterministic_candidate', move: only.key },
          requestShape: {
            finalDecisionQuestions: 0,
            candidateCount: 1,
            httpRequests: 0,
            decisionAuthority: 'single_candidate'
          }
        },
        stageNote: '本地已收敛到唯一候选（0 次 Jev 请求）'
      };
    }

    const localChoice = candidates[0];

    let deepAnalysis;
    if (shouldRunPreJevDeepSearch(mode, candidates)) {
      updateApiState('busy', '本地深搜正在为 Jev 准备决策证据…');
      deepAnalysis = await runDeepWorkerVerification(
        candidates.slice(0, Math.min(4, candidates.length)),
        mode,
        'pre_jev_evidence'
      );
    } else {
      deepAnalysis = {
        status: 'skipped_opening',
        source: 'policy',
        depthReached: null,
        scores: [],
        timedOut: false,
        elapsedMs: 0,
        budgetMs: 0
      };
    }

    const deepRows = Array.isArray(deepAnalysis?.scores) ? deepAnalysis.scores : [];
    const deepByMove = new Map(deepRows.map((item, index) => [
      item.move,
      { score: item.score, rank: index + 1 }
    ]));
    candidates.forEach(move => {
      const deep = deepByMove.get(move.key);
      move.deepSearchScore = Number.isFinite(deep?.score) ? deep.score : null;
      move.deepSearchRank = deep?.rank ?? null;
    });

    const payload = buildFinalJevPayload(context, candidates, deepAnalysis);
    updateApiState('busy', 'Jev 正在做最终落子决定…');
    const data = await callJev(payload);
    const rawAnswer = data?.answers?.best_move;
    if (!rawAnswer || typeof rawAnswer.choice !== 'string') {
      throw new Error('Jev 响应中缺少 answers.best_move.choice');
    }

    const jevChoice = rawAnswer.choice.toUpperCase();
    const candidateKeys = new Set(candidates.map(move => move.key));
    if (!candidateKeys.has(jevChoice)) {
      throw new Error(`Jev 返回候选集之外的落点：${rawAnswer.choice}`);
    }

    const probabilities = rawAnswer.probabilities && typeof rawAnswer.probabilities === 'object'
      ? Object.fromEntries(
          Object.entries(rawAnswer.probabilities)
            .filter(([key]) => candidateKeys.has(String(key).toUpperCase()))
            .map(([key, value]) => [String(key).toUpperCase(), Number(value)])
        )
      : { [jevChoice]: 1 };

    const jevAnswer = {
      ...rawAnswer,
      choice: jevChoice,
      probabilities
    };
    const diversity = selectDiverseJevChoice(jevAnswer, candidates, context.forced);
    const finalChoice = diversity.choice;
    const final = candidates.find(move => move.key === finalChoice);
    if (!final) throw new Error(`多样性选择产生非法候选：${finalChoice}`);

    const probabilityConfidence = Number(probabilities[finalChoice]);
    const confidence = finalChoice === jevChoice && Number.isFinite(rawAnswer.confidence)
      ? rawAnswer.confidence
      : Number.isFinite(probabilityConfidence)
        ? probabilityConfidence
        : null;
    const answer = {
      ...rawAnswer,
      choice: finalChoice,
      confidence,
      probabilities
    };

    const ranked = [
      final,
      ...candidates.filter(move => move.key !== finalChoice)
    ];

    return {
      answer,
      finalChoice,
      localChoice: localChoice.key,
      jevSuggested: jevChoice,
      mode,
      forced: context.forced,
      candidates: ranked,
      model: data?.model || settings.model,
      usage: data?.usage || null,
      client: data?.__client || null,
      decisionTrace: {
        requestShape: {
          finalDecisionQuestions: 1,
          candidateCount: candidates.length,
          httpRequests: data?.__client?.cached ? 0 : (data?.__client?.attempts || 1),
          localEvidenceVisibleToJev: true,
          decisionAuthority: 'jev_final',
          localOpeningAdaptive: Boolean(context.cfg.openingAdaptive),
          localSearchBudgetMs: context.localSearch?.budgetMs ?? null,
          localSearchElapsedMs: context.localSearch?.elapsedMs ?? null,
          localSearchTimedOut: Boolean(context.localSearch?.timedOut),
          localSearchDepthReached: context.localSearch?.depthReached ?? null,
          localSearchTargetDepth: context.localSearch?.targetDepth ?? context.cfg.depth,
          deepSearchPolicy: deepAnalysis?.status === 'skipped_opening'
            ? 'skip_opening'
            : 'pre_jev_worker'
        },
        preJevDeepSearch: deepAnalysis ? {
          status: deepAnalysis.status || null,
          source: deepAnalysis.source || null,
          depthReached: deepAnalysis.depthReached ?? null,
          timedOut: Boolean(deepAnalysis.timedOut),
          elapsedMs: deepAnalysis.elapsedMs ?? null,
          budgetMs: deepAnalysis.budgetMs ?? null,
          scores: deepRows.map(item => ({ move: item.move, score: item.score }))
        } : null,
        finalDecision: compactAnswer(jevAnswer),
        diversity: {
          gameSeed,
          samplingApplied: diversity.samplingApplied,
          changed: diversity.changed,
          reason: diversity.reason,
          draw: diversity.draw,
          jevChoice: diversity.jevChoice,
          selectedChoice: diversity.choice,
          pool: diversity.pool
        },
        localEvidence: candidates.map(move => ({
          move: move.key,
          localRank: move.localRank,
          localSearchScore: Number.isFinite(move.searchScore) ? move.searchScore : null,
          deepSearchRank: move.deepSearchRank,
          deepSearchScore: Number.isFinite(move.deepSearchScore) ? move.deepSearchScore : null,
          facts: move.analysis?.facts || null
        }))
      },
      stageNote: diversity.changed
        ? `Jev 最终决策：Local 提供 ${candidates.length} 个候选${deepAnalysis?.status === 'skipped_opening' ? '（开局跳过额外深搜）' : '及深搜证据'}；Jev 首选 ${jevChoice}，安全近优候选受控采样后选择 ${finalChoice}（每回合最多 1 次 Jev 请求）`
        : `Jev 最终决策：Local 提供 ${candidates.length} 个候选${deepAnalysis?.status === 'skipped_opening' ? '（开局跳过额外深搜）' : '及深搜证据'}，Jev 最终选择 ${finalChoice}（每回合最多 1 次 Jev 请求）`
    };
  }

  async function jevTurn() {
    const side = aiColor();
    const human = playerColor();
    if (!gameStarted || gameOver || current !== side || thinking) return;

    thinking = true;
    const longTaskBaseline = browserLongTaskCount;
    beginThinkingClock();
    retryBtn.style.display = 'none';
    canvas.classList.add('disabled');
    updateStatus();
    updateApiState('busy', '正在为 Jev 分析局面…');
    requestController = new AbortController();

    try {
      let result;
      if (settings.strengthMode === 'jev') {
        updateApiState('busy', 'Jev 正在思考…');
        const decision = buildPureJevRequest();
        const data = await callJev(decision.payload);
        const answer = data?.answers?.best_move;
        if (!answer || typeof answer.choice !== 'string') throw new Error('Jev 响应中缺少 answers.best_move.choice');
        const finalChoice = answer.choice.toUpperCase();
        const candidateKeys = new Set(decision.candidates.map(m => m.key));
        if (!candidateKeys.has(finalChoice)) throw new Error(`Jev 返回非法候选：${answer.choice}`);
        result = {
          answer,
          finalChoice,
          jevSuggested: finalChoice,
          mode: 'jev',
          forced: null,
          candidates: decision.candidates,
          model: data.model || settings.model,
          usage: data.usage || null,
          client: data?.__client || null,
          decisionTrace: {
            pureJev: compactAnswer(answer),
            requestShape: {
              legalChoices: decision.candidates.length,
              httpRequests: data?.__client?.cached ? 0 : (data?.__client?.attempts || 1)
            }
          },
          stageNote: '纯 Jev（每回合 1 次请求）'
        };
      } else {
        result = await advancedDecision(settings.strengthMode || 'max');
      }

      const parsed = parseCoord(result.finalChoice);
      if (!parsed || board[parsed.r][parsed.c] !== EMPTY || !isLegalMoveForColor(parsed.r, parsed.c, side)) {
        throw new Error(`最终决策产生非法落点：${result.finalChoice}`);
      }
      captureThinkingDuration(result);
      if (result?.decisionTrace?.requestShape) {
        result.decisionTrace.requestShape.browserLongTasks = Number.isFinite(browserLongTaskCount)
          && Number.isFinite(longTaskBaseline)
          ? Math.max(0, browserLongTaskCount - longTaskBaseline)
          : null;
      }
      lastJev = result;
      renderJevResult(lastJev);
      const moveSource = result.mode === 'local' || result.fallbackReason || result.stageNote?.includes('0 次 Jev')
        ? '本地战术'
        : 'Jev';
      place(parsed.r, parsed.c, side, moveSource);
      rememberDecision(result, moves.length);
      afterJevDecisionEasterEggs(result);

      if (isWin(parsed.r, parsed.c, side)) {
        finish(result.mode === 'local' ? '本地引擎赢了' : 'Jev 赢了', side);
        return;
      }
      if (moves.length === SIZE * SIZE) {
        finish('平局', EMPTY);
        return;
      }
      resolveHumanThreatAfterAiMove(coord(parsed.r, parsed.c));
      current = human;
      resetTurnClock();
      updateApiState();
    } catch (err) {
      if (err?.name === 'AbortError') return;
      console.error(err);

      const msg = friendlyError(err);
      try {
        const fallback = localOnlyDecision('expert');
        fallback.fallbackReason = msg;
        fallback.stageNote = `${fallback.stageNote}；Jev 不可用时自动降级`;
        const parsed = parseCoord(fallback.finalChoice);
        if (!parsed || board[parsed.r][parsed.c] !== EMPTY || !isLegalMoveForColor(parsed.r, parsed.c, side)) {
          throw new Error('本地降级产生非法落点');
        }
        captureThinkingDuration(fallback);
        lastJev = fallback;
        renderJevResult(fallback);
        place(parsed.r, parsed.c, side, '本地引擎(降级)');
        rememberDecision(fallback, moves.length);
        afterJevDecisionEasterEggs(fallback);

        if (isWin(parsed.r, parsed.c, side)) {
          finish('本地引擎赢了', side);
          return;
        }
        if (moves.length === SIZE * SIZE) {
          finish('平局', EMPTY);
          return;
        }
        resolveHumanThreatAfterAiMove(coord(parsed.r, parsed.c));
        current = human;
        resetTurnClock();
        updateApiState('err', 'Jev 暂不可用 · 本地引擎接管');
        toast('Jev 暂时不可用，本回合已由本地引擎接管。', 4200);
        return;
      } catch (fallbackErr) {
        console.error('local fallback failed', fallbackErr);
      }

      captureThinkingDuration();
      current = side;
      updateApiState('err', 'Jev 暂不可用');
      jevInfo.textContent = `Jev 暂不可用：${msg}`;
      retryBtn.style.display = 'inline-block';
      toast('Jev 暂不可用，请重试。', 4200);
    } finally {
      thinking = false;
      thinkingStartedAt = null;
      requestController = null;
      canvas.classList.remove('disabled');
      updateStatus();
    }
  }

    function parseCoord(value) {
    const m = String(value).trim().toUpperCase().match(/^([A-O])(1[0-5]|[1-9])$/);
    if (!m) return null;
    return { c: COLS.indexOf(m[1]), r: Number(m[2]) - 1 };
  }

  function humanCandidateLabel(candidate) {
    const f = candidate?.analysis?.facts || {};
    if (f.forced_role === 'WIN_NOW' || f.attack_shape === 'IMMEDIATE_WIN') return '可以直接取胜';
    if (f.forced_role === 'MUST_DEFEND') return '必须先挡住对手';
    if (f.vcf_status === 'FORCED_SEQUENCE_FOUND') return '有连续冲四杀棋';
    if (f.vct_status === 'PRESSURE_SEQUENCE_FOUND') return '有持续进攻机会';
    if (f.attack_shape === 'FOUR_PLUS_FOLLOWUP') return '能形成强制后续';
    if (f.attack_shape === 'MULTIPLE_OPEN_THREE_PRESSURE') return '能制造多重威胁';
    if (f.attack_shape === 'OPEN_THREE_PRESSURE') return '能继续主动进攻';
    if (f.tactical_safety === 'TACTICALLY_RISKY') return '有进攻，但要提防反击';
    if (f.connectivity === 'VERY_HIGH' || f.connectivity === 'HIGH') return '和现有棋形连接紧密';
    return '位置稳健';
  }

  function buildHumanDecision(result, finalChoice) {
    const candidate = (result.candidates || []).find(m => m.key === finalChoice) || null;
    const f = candidate?.analysis?.facts || {};
    const modeLabel = publicModeLabel(result.mode);

    let verdict = '稳健选择';
    let reason = `综合局面后，${colorNameZh(aiColor())}选择 ${finalChoice}，优先保持棋形和后续空间。`;

    if (result.forced === 'win' || f.forced_role === 'WIN_NOW' || f.attack_shape === 'IMMEDIATE_WIN') {
      verdict = '直接取胜';
      reason = `${finalChoice} 可以立即形成五连，这是当前最明确的取胜点。`;
    } else if (result.forced === 'block' || f.forced_role === 'MUST_DEFEND') {
      verdict = '必须防守';
      reason = `对手已经形成下一手取胜威胁，${finalChoice} 是当前必须优先封住的点。`;
    } else if (f.vcf_status === 'FORCED_SEQUENCE_FOUND') {
      verdict = '发现杀棋';
      reason = `从 ${finalChoice} 开始，本地搜索发现连续冲四的强制进攻路线，可以持续逼迫对手应对。`;
    } else if (f.attack_shape === 'FOUR_PLUS_FOLLOWUP') {
      verdict = '强制进攻';
      reason = `${finalChoice} 能形成“四”或紧接着的强制手，比单纯占位更有主动权。`;
    } else if (f.attack_shape === 'MULTIPLE_OPEN_THREE_PRESSURE') {
      verdict = '制造多重威胁';
      reason = `${finalChoice} 能同时制造多处进攻压力，让对手更难一次防住。`;
    } else if (f.attack_shape === 'OPEN_THREE_PRESSURE' || f.vct_status === 'PRESSURE_SEQUENCE_FOUND') {
      verdict = '主动施压';
      reason = `${finalChoice} 可以延续进攻，并保留后续做活三、做四的机会。`;
    } else if (f.tactical_safety === 'TACTICALLY_RISKY') {
      verdict = '谨慎进攻';
      reason = `${finalChoice} 有进攻价值，但也存在被对手反击的风险。`;
    } else if (f.connectivity === 'VERY_HIGH' || f.connectivity === 'HIGH') {
      verdict = '强化棋形';
      reason = `${finalChoice} 与现有${colorNameZh(aiColor())}连接紧密，有利于形成更多后续进攻方向。`;
    }

    let agreement;
    if (result.fallbackReason) {
      agreement = 'Jev 暂时不可用，本手由本地引擎接管。';
    } else if (result.mode === 'local') {
      agreement = '当前为本地引擎模式，Jev 未参与这一手。';
    } else if (result.stageNote?.includes('0 次 Jev')) {
      agreement = 'Jev 未介入：本地引擎发现了明确的必胜、必防或强制手。';
    } else if (result.mode === 'jev') {
      agreement = '这一手由 Jev 直接判断并选择。';
    } else {
      const finalDecision = result.decisionTrace?.finalDecision;
      const diversity = result.decisionTrace?.diversity;
      const challenger = result.decisionTrace?.challenger;
      const verification = challenger?.verification;
      if (diversity?.changed) {
        agreement = `Jev 首选 ${diversity.jevChoice}；${finalChoice} 同属安全近优候选，本局按 Jev 概率进行受控采样后选择 ${finalChoice}。`;
      } else if (finalDecision) {
        agreement = result.localChoice && result.localChoice !== finalChoice
          ? `Local 首选 ${result.localChoice}；Jev 综合棋盘、战术与搜索证据后，最终改选 ${finalChoice}。`
          : `Local 首选 ${result.localChoice || finalChoice}；Jev 综合棋盘、战术与搜索证据后，最终确认 ${finalChoice}。`;
      } else if (challenger?.disagreed && verification) {
        agreement = `Local 首选 ${result.localChoice || '—'}，Jev 独立提出 ${result.jevSuggested || '—'}；后台深搜最终选择 ${finalChoice}${verification.timedOut ? '，并在时间上限内返回' : ''}。`;
      } else if (challenger?.verificationTrigger === 'horizon_guard' && verification) {
        agreement = `Jev 与 Local 都倾向 ${result.localChoice || finalChoice}；系统额外在后台做了战术深搜复核，最终选择 ${finalChoice}${verification.timedOut ? '，并在时间上限内返回' : ''}。`;
      } else if (result.jevSuggested && result.jevSuggested !== finalChoice) {
        agreement = `Jev 更偏向 ${result.jevSuggested}，最终选择 ${finalChoice}。`;
      } else {
        agreement = 'Jev 与 Local 独立判断得到同一选择。';
      }
    }

    return { verdict, reason, agreement, modeLabel };
  }

  function renderJevResult(result) {
    const a = result.answer;
    const confidence = Number.isFinite(a.confidence) ? a.confidence : null;
    const finalChoice = result.finalChoice || a.choice;
    const human = buildHumanDecision(result, finalChoice);

    const jevParticipated = result.mode !== 'local' && !result.fallbackReason && !result.stageNote?.includes('0 次 Jev');
    const challengerTrace = result.decisionTrace?.challenger;
    const finalDecisionTrace = result.decisionTrace?.finalDecision;
    jevMove.textContent = finalChoice;
    jevDecisionLabel.textContent = finalDecisionTrace
      ? `${human.modeLabel} · Jev 最终决策`
      : challengerTrace?.verificationTrigger === 'jev_disagreement'
        ? `${human.modeLabel} · Jev 挑战裁决`
        : challengerTrace?.verificationTrigger === 'horizon_guard'
          ? `${human.modeLabel} · 后台战术复核`
          : jevParticipated
            ? `${human.modeLabel} · Jev 选择`
            : `本地战术 · ${colorNameZh(aiColor())}落在`;
    jevVerdict.textContent = human.verdict;
    jevInfo.innerHTML = `<strong>${escapeHtml(human.reason)}</strong><span>${escapeHtml(human.agreement)}</span>`;

    confidenceBar.style.width = confidence == null ? '0%' : `${Math.max(0, Math.min(100, confidence * 100))}%`;
    confidenceText.textContent = confidence == null ? '—' : `${Math.round(confidence * 100)}%`;

    const probs = a.probabilities && typeof a.probabilities === 'object'
      ? Object.entries(a.probabilities)
          .sort((x, y) => Number(y[1]) - Number(x[1]))
          .filter(([key]) => key !== finalChoice)
          .slice(0, 3)
      : [];

    const candidateMap = new Map((result.candidates || []).map(m => [m.key, m]));
    alternativesTitle.textContent = '其他考虑';
    alternatives.innerHTML = probs.length
      ? probs.map(([key, p]) => {
          const pct = Math.max(0, Math.min(100, Number(p) * 100));
          const hint = humanCandidateLabel(candidateMap.get(key));
          return `<div class="alt"><div class="alt-copy"><strong>${escapeHtml(key)}</strong><span>${escapeHtml(hint)}</span></div><div class="mini"><i style="width:${pct}%"></i></div><em>${pct.toFixed(pct >= 10 ? 0 : 1)}%</em></div>`;
        }).join('')
      : '<div class="empty">这一手无需比较其他落点。</div>';
  }

  function friendlyError(err) {
    const msg = String(err?.message || err || '未知错误');
    if (err?.httpStatus === 429) return 'Jev 当前请求较多，请稍后重试。';
    if (err?.httpStatus === 529) return 'Jev 暂时繁忙，请稍后重试。';
    if (err?.httpStatus === 503 && /not configured|未配置/i.test(msg)) return 'Jev 服务暂未配置。';
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return '暂时无法连接 Jev，本回合将使用本地引擎。';
    if (msg.length > 220) return msg.slice(0, 220) + '…';
    return msg;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  }

  canvas.addEventListener('click', onBoardClick);
  document.getElementById('settingsBtn').addEventListener('click', () => openSettings(false));
  document.getElementById('quickSettingsBtn').addEventListener('click', () => openSettings(false));
  document.getElementById('closeSettingsBtn').addEventListener('click', () => {
    if (testController) testController.abort();
    if (!gameStarted) {
      toast('请先确认开局设置并点击“保存并开始”。', 3200);
      return;
    }
    settingsModal.classList.remove('show');
  });
  document.getElementById('saveSettingsBtn').addEventListener('click', saveSettings);
  levelOptionButtons.forEach(button => {
    button.addEventListener('click', () => renderLevelSelection(button.dataset.mode));
  });
  sideOptionButtons.forEach(button => {
    button.addEventListener('click', () => {
      sideOptionButtons.forEach(item => {
        const selected = item === button;
        item.classList.toggle('selected', selected);
        item.setAttribute('aria-checked', selected ? 'true' : 'false');
      });
      updatePreGamePreview();
    });
  });
  [ruleOverlineInput, ruleFourFourInput, ruleThreeThreeInput].forEach(input => {
    input.addEventListener('change', updatePreGamePreview);
  });
  testConnectionBtn.addEventListener('click', testConnection);
  document.getElementById('restartBtn').addEventListener('click', restart);
  document.getElementById('undoBtn').addEventListener('click', undo);
  retryBtn.addEventListener('click', jevTurn);
  copyRecordBtn.addEventListener('click', copyGameRecord);
  resultCopyBtn.addEventListener('click', copyGameRecord);
  resultCloseBtn.addEventListener('click', hideResultModal);
  resultRestartBtn.addEventListener('click', restart);
  resultModal.addEventListener('click', e => {
    if (e.target === resultModal) hideResultModal();
  });
  settingsModal.addEventListener('click', e => {
    if (e.target === settingsModal && gameStarted) {
      if (testController) testController.abort();
      settingsModal.classList.remove('show');
    } else if (e.target === settingsModal && !gameStarted) {
      toast('开局前必须先确认棋色和规则。', 3000);
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (testController) testController.abort();
      if (gameStarted) settingsModal.classList.remove('show');
      hideResultModal();
    }
  });

  renderLevelSelection(settings.strengthMode);
  syncPreGameControls();
  resetGameState(false);
  openSettings(true);
  setInterval(refreshTurnClock, 100);
})();
