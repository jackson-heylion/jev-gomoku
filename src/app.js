(() => {
  'use strict';

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

  const settings = loadSettings();
  modelInput.value = settings.model;
  strengthModeInput.value = settings.strengthMode;

  function makeBoard() {
    return Array.from({ length: SIZE }, () => Array(SIZE).fill(EMPTY));
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
    if (gameOver) {
      turnClockLabel.textContent = '对局状态';
      turnClockValue.textContent = '已结束';
      return;
    }

    const now = performance.now();
    if (thinking) {
      const started = thinkingStartedAt ?? turnStartedAt;
      const elapsed = Math.max(0, now - started);
      const actor = settings.strengthMode !== 'local' ? 'Jev' : '本地引擎';
      turnClockLabel.textContent = `${actor} 已思考`;
      turnClockValue.textContent = formatElapsed(elapsed);
      if (settings.strengthMode !== 'local') {
        jevLiveState.textContent = `思考中 · ${formatElapsedCompact(elapsed)}`;
      }
      return;
    }

    if (current === BLACK) {
      turnClockLabel.textContent = '你已思考';
      turnClockValue.textContent = formatElapsed(now - turnStartedAt);
      return;
    }

    turnClockLabel.textContent = settings.strengthMode !== 'local' ? '等待 Jev' : '等待本地引擎';
    turnClockValue.textContent = formatElapsed(now - turnStartedAt);
  }

  function loadSettings() {
    return {
      model: localStorage.getItem('jev_gomoku_model') || 'jev-latest',
      strengthMode: localStorage.getItem('jev_gomoku_strength') || 'expert'
    };
  }

  function saveSettings() {
    if (testController) testController.abort();
    settings.model = modelInput.value.trim() || 'jev-latest';
    settings.strengthMode = ['local', 'jev', 'strong', 'expert'].includes(strengthModeInput.value)
      ? strengthModeInput.value
      : 'expert';
    localStorage.setItem('jev_gomoku_model', settings.model);
    localStorage.setItem('jev_gomoku_strength', settings.strengthMode);
    settingsModal.classList.remove('show');
    updateApiState();
    toast(`已切换到 ${publicModeLabel(settings.strengthMode)}`);
    if (current === WHITE && !thinking && !gameOver) setTimeout(jevTurn, 100);
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
    const model = modelInput.value.trim() || 'jev-latest';
    if (testController) testController.abort();
    testController = new AbortController();
    const timeout = setTimeout(() => testController?.abort(), 15000);
    testConnectionBtn.disabled = true;
    testConnectionBtn.textContent = '检查中…';
    setConnectionTest('busy', '正在检查 Jev 服务…');
    const started = performance.now();
    const payload = {
      state: 'TypeSafe Jev API connection test from Jev Gomoku.',
      model,
      questions: {
        connection_test: {
          type: 'choice',
          instructions: 'Choose the option named ok. This is only an API connectivity test.',
          criteria: { ok: 'The connection test is operating normally.', other: 'Any other result.' }
        }
      }
    };

    try {
      const response = await fetch('/api/jev', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: testController.signal
      });
      const elapsed = Math.round(performance.now() - started);
      const raw = await response.text();
      let data = null;
      try { data = raw ? JSON.parse(raw) : null; } catch (_) {}
      if (!response.ok) {
        const detail = data?.detail || data?.message || data?.error || response.statusText || `HTTP ${response.status}`;
        throw Object.assign(new Error(typeof detail === 'string' ? detail : JSON.stringify(detail)), { httpStatus: response.status });
      }
      const answer = data?.answers?.connection_test;
      if (!answer || answer.type !== 'choice' || typeof answer.choice !== 'string') {
        throw new Error('Jev 服务响应异常，请稍后重试。');
      }
      setConnectionTest('ok', `Jev 在线 · ${elapsed} ms`);
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
        name: '本地引擎',
        badge: '本地',
        summary: '不使用 Jev：只运行传统搜索和战术判断。'
      };
    }
    if (mode === 'jev') {
      return {
        name: 'Jev 直觉',
        badge: '实验',
        summary: 'Jev 更直接地从合法落点中选择；Jev 感更强，但不代表棋力更强。'
      };
    }
    if (mode === 'strong') {
      return {
        name: 'Jev 快速',
        badge: '等级 2',
        summary: '速度优先：本地搜索提供候选与证据，由 Jev 做最终落子决定。'
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
    const selectedMode = ['local', 'jev', 'strong', 'expert'].includes(mode) ? mode : 'expert';
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

    if (kind === 'busy') {
      apiIndicator.classList.add('busy');
      jevLiveState.classList.add('busy');
      jevLiveState.textContent = '思考中';
    } else if (kind === 'err') {
      apiIndicator.classList.add('err');
      jevLiveState.classList.add('fallback');
      jevLiveState.textContent = '本地接管';
    } else if (settings.strengthMode === 'local') {
      jevLiveState.classList.add('off');
      jevLiveState.textContent = '未启用';
    } else {
      apiIndicator.classList.add('ok');
      jevLiveState.textContent = '在线';
    }

    const meta = publicModeMeta(settings.strengthMode);
    apiLabel.textContent = text || meta.name;
    levelBadge.textContent = meta.badge;
    levelSummary.textContent = meta.summary;
  }

  function openSettings() {
    modelInput.value = settings.model;
    renderLevelSelection(settings.strengthMode || 'expert');
    clearConnectionTest();
    settingsModal.classList.add('show');
    const selected = levelOptionButtons.find(button => button.classList.contains('selected'));
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
    moves.push({ r, c, color, source, coord: coord(r, c) });
    drawBoard();
    updateHistory();
    updateStatus();
    return true;
  }

  function onBoardClick(e) {
    if (gameOver || thinking || current !== BLACK) return;
    const p = pointFromEvent(e);
    if (!p || board[p.r][p.c] !== EMPTY) return;

    const forbidden = blackForbiddenInfo(p.r, p.c);
    if (forbidden.forbidden) {
      const label = forbidden.type === 'OVERLINE' ? '长连'
        : forbidden.type === 'FOUR_FOUR' ? '四四'
        : forbidden.type === 'THREE_THREE' ? '三三'
        : '禁手';
      toast(`${coord(p.r, p.c)} 是黑棋${label}禁手，请选择其他落点。`, 3200);
      return;
    }

    place(p.r, p.c, BLACK, '你');
    if (isWin(p.r, p.c, BLACK)) {
      finish('你赢了', BLACK);
      return;
    }
    if (moves.length === SIZE * SIZE) {
      finish('平局', EMPTY);
      return;
    }
    current = WHITE;
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
    if (color === BLACK) return hasExactFiveAt(r, c, BLACK);
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
    // Under RIF rules an exact five wins immediately, even if the same move
    // would otherwise also create a double-three or double-four.
    if (hasExactFiveAt(r, c, BLACK)) {
      return { forbidden: false, type: null, winningFive: true, fourCount: 0, threeCount: 0 };
    }
    if (hasOverlineAt(r, c, BLACK)) {
      return { forbidden: true, type: 'OVERLINE', winningFive: false, fourCount: 0, threeCount: 0 };
    }

    const fours = collectBlackFoursThrough(r, c);
    if (fours.length >= 2) {
      return { forbidden: true, type: 'FOUR_FOUR', winningFive: false, fourCount: fours.length, threeCount: 0 };
    }

    if (depth >= RENJU_MAX_RECURSION || potentialBlackThreeDirections(r, c) < 2) {
      return { forbidden: false, type: null, winningFive: false, fourCount: fours.length, threeCount: 0 };
    }

    const threes = collectRealBlackThreesThrough(r, c, depth);
    if (threes.length >= 2) {
      return { forbidden: true, type: 'THREE_THREE', winningFive: false, fourCount: fours.length, threeCount: threes.length };
    }
    return { forbidden: false, type: null, winningFive: false, fourCount: fours.length, threeCount: threes.length };
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

  function hideResultModal() {
    resultModal.classList.remove('show');
  }

  function showResultModal(text, winner) {
    const modeLabel = publicModeLabel(settings.strengthMode);

    resultTitle.textContent = text;
    resultIcon.textContent = winner === BLACK ? '●' : winner === WHITE ? '○' : '＝';
    resultIcon.className = `result-icon ${winner === BLACK ? 'player-win' : winner === WHITE ? 'ai-win' : 'draw'}`;
    resultDesc.textContent = winner === BLACK
      ? '你执黑完成五连，本局获胜。'
      : winner === WHITE
        ? 'Jev 执白完成五连，赢下了这一局。'
        : '棋盘已下满，你与 Jev 战成平局。';
    resultStats.textContent = `共 ${moves.length} 手 · ${modeLabel}`;
    resultCopyBtn.textContent = '复制棋谱';
    resultModal.classList.add('show');
  }

  function finish(text, winner) {
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

  function restart() {
    if (requestController) requestController.abort();
    requestController = null;
    board = makeBoard();
    current = BLACK;
    moves = [];
    gameOver = false;
    thinking = false;
    lastJev = null;
    jevDecisionLog = [];
    gameResult = null;
    gameStartedAt = new Date();
    turnStartedAt = performance.now();
    thinkingStartedAt = null;
    lastThinkMs = null;
    lastThinkDuration.textContent = '—';
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
    drawBoard(); updateHistory(); updateStatus(); updateApiState();
  }

  function undo() {
    if (thinking) { toast('Jev 正在思考，暂时不能悔棋'); return; }
    if (!moves.length) return;
    if (gameOver) gameOver = false;
    hideResultModal();
    gameResult = null;

    let remove = current === BLACK ? 2 : 1;
    remove = Math.min(remove, moves.length);
    for (let i = 0; i < remove; i++) {
      const m = moves.pop();
      board[m.r][m.c] = EMPTY;
    }
    jevDecisionLog = jevDecisionLog.filter(item => item.moveNo <= moves.length);
    current = BLACK;
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
    drawBoard(); updateHistory(); updateStatus();
  }

  function updateStatus() {
    if (gameOver) return;
    const nextNo = moves.length + 1;
    if (thinking) {
      const actor = settings.strengthMode !== 'local' ? 'Jev' : '本地引擎';
      turnText.innerHTML = `<span class="stone-dot white"></span><span class="thinking">${actor} 正在思考</span>`;
      turnHint.textContent = '正在分析局面，请稍候';
      gameMeta.textContent = `第 ${nextNo} 手 · 白棋`;
    } else if (current === BLACK) {
      turnText.innerHTML = '<span class="stone-dot black"></span><span>轮到你了</span>';
      turnHint.textContent = '点击棋盘交叉点落下一枚黑棋';
      gameMeta.textContent = `第 ${nextNo} 手 · 黑棋`;
    } else {
      const actor = settings.strengthMode !== 'local' ? 'Jev' : '本地引擎';
      turnText.innerHTML = `<span class="stone-dot white"></span><span>${actor} 的回合</span>`;
      turnHint.textContent = `${actor} 即将开始思考`;
      gameMeta.textContent = `第 ${nextNo} 手 · 白棋`;
    }
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
    const modeLabel = d.mode === 'local' ? '本地引擎'
      : d.mode === 'jev' ? '纯 Jev'
      : d.mode === 'strong' ? 'Jev 强化'
      : 'Jev 大师';
    lines.push(`第 ${d.moveNo} 手 · 白 ${d.chosen}`);
    lines.push(`  模式：${modeLabel}`);
    if (d.stageNote) lines.push(`  决策阶段：${d.stageNote}`);
    if (d.forced) lines.push(`  强制类型：${d.forced === 'win' ? '立即取胜' : d.forced === 'block' ? '必须防守' : d.forced}`);
    if (d.localChoice) lines.push(`  Local 首选：${d.localChoice}`);
    if (d.jevSuggested) lines.push(`  Jev 最终选择：${d.jevSuggested}`);
    if (d.trace?.preJevDeepSearch) {
      const v = d.trace.preJevDeepSearch;
      lines.push(`  Jev 前置深搜：source=${v.source || '—'}；status=${v.status || '—'}；depth=${v.depthReached ?? '—'}；elapsed=${v.elapsedMs ?? '—'}ms`);
      if (Array.isArray(v.scores) && v.scores.length) {
        lines.push(`    深搜评分：${v.scores.map(item => `${item.move}=${compactNumber(item.score, 1)}`).join('；')}`);
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
    if (d.client) lines.push(`  API：${d.client.cached ? '命中会话缓存' : `${d.client.attempts || 1} 次请求`}`);
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
          `    #${c.localRank ?? c.rank ?? '—'} ${c.move} | search=${compactNumber(c.searchScore, 1)} | deep=${compactNumber(c.deepSearchScore, 1)} | deepRank=${c.deepSearchRank ?? '—'} | local=${compactNumber(c.localNorm)}`
        );
        const factText = [
          f.forced_role && `role=${f.forced_role}`,
          f.tactical_safety && `safety=${f.tactical_safety}`,
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
    const result = gameResult?.text || (gameOver ? '对局结束' : '进行中');
    const started = gameStartedAt instanceof Date ? gameStartedAt.toLocaleString() : '';
    const lines = [
      'Jev 五子棋棋谱',
      `棋盘：${SIZE}×${SIZE}`,
      '黑方：玩家',
      '白方：Jev / 本地引擎',
      `结果：${result}`,
      `开始：${started}`,
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
    if (!activeDecisions.length) {
      lines.push('—');
    } else {
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

  function legalMoves(color = WHITE) {
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
    strong: {
      depth: 3, root: 10, branch: 7, semantic: 5, tournament: 3, radius: 2,
      vcfDepth: 3, vctDepth: 1, localWeight: .66, pairWeight: .24, atomicWeight: .10
    },
    expert: {
      depth: 5, root: 14, branch: 7, semantic: 6, tournament: 4, radius: 2,
      vcfDepth: 4, vctDepth: 2, localWeight: .62, pairWeight: .27, atomicWeight: .11
    }
  };
  const MATE_SCORE = 1e14;

  function otherColor(color) { return color === WHITE ? BLACK : WHITE; }

  function evaluateStatic() {
    let score = 0;
    for (const seg of WIN_SEGMENTS) {
      let w = 0, b = 0;
      for (const [r, c] of seg) {
        if (board[r][c] === WHITE) w++;
        else if (board[r][c] === BLACK) b++;
      }
      if (w && b) continue;
      if (w) score += LINE_WEIGHTS[w];
      else if (b) score -= LINE_WEIGHTS[b] * 1.16;
    }
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (board[r][c] === EMPTY) continue;
        const d = Math.max(Math.abs(r - 7), Math.abs(c - 7));
        const bonus = Math.max(0, 8 - d) * .45;
        score += board[r][c] === WHITE ? bonus : -bonus;
      }
    }
    return score;
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

  function quickMoveScore(move, color) {
    board[move.r][move.c] = color;
    let score;
    if (isWin(move.r, move.c, color)) {
      score = MATE_SCORE;
    } else {
      const base = evaluateStatic();
      const conn = localConnectivity(move.r, move.c, color);
      score = (color === WHITE ? base : -base) + conn.allies * 18 + conn.enemies * 5;
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

  function boardCacheKey(toMove, depth) {
    let key = `${toMove}:${depth}:`;
    for (let r = 0; r < SIZE; r++) key += board[r].join('');
    return key;
  }

  function alphaBeta(depth, alpha, beta, toMove, cfg, cache) {
    if (depth <= 0) return evaluateStatic();
    const key = boardCacheKey(toMove, depth);
    if (cache.has(key)) return cache.get(key);

    const immediate = immediateWins(toMove, cfg.radius);
    if (immediate.length) {
      const score = toMove === WHITE ? MATE_SCORE + depth : -MATE_SCORE - depth;
      cache.set(key, score);
      return score;
    }

    const limit = Math.max(4, cfg.branch - Math.max(0, cfg.depth - depth - 1));
    const candidates = orderedMoves(toMove, limit, cfg.radius);
    if (!candidates.length) return evaluateStatic();

    let value = toMove === WHITE ? -Infinity : Infinity;
    for (const m of candidates) {
      board[m.r][m.c] = toMove;
      let child;
      if (isWin(m.r, m.c, toMove)) {
        child = toMove === WHITE ? MATE_SCORE + depth : -MATE_SCORE - depth;
      } else {
        child = alphaBeta(depth - 1, alpha, beta, otherColor(toMove), cfg, cache);
      }
      board[m.r][m.c] = EMPTY;

      if (toMove === WHITE) {
        if (child > value) value = child;
        if (value > alpha) alpha = value;
      } else {
        if (child < value) value = child;
        if (value < beta) beta = value;
      }
      if (beta <= alpha) break;
    }
    cache.set(key, value);
    return value;
  }

  function scoreRootMove(move, cfg, cache) {
    board[move.r][move.c] = WHITE;
    let score;
    if (isWin(move.r, move.c, WHITE)) {
      score = MATE_SCORE * 10;
    } else {
      score = alphaBeta(cfg.depth - 1, -Infinity, Infinity, BLACK, cfg, cache);
      score += evaluateStatic() * .035;
    }
    board[move.r][move.c] = EMPTY;
    return score;
  }

  function countForkCreators(color, limit = 10, radius = 2, maxCount = Infinity) {
    let count = 0;
    const points = [];
    const movesFound = [];
    const candidates = orderedMoves(color, limit, radius);
    for (const m of candidates) {
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
    return { count, points, moves: movesFound };
  }

  function forcingExtensions(color, limit = 8, radius = 2) {
    const out = [];
    for (const m of orderedMoves(color, limit * 2, radius)) {
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
    if (turns <= 0) return false;
    const defender = otherColor(attacker);
    if (immediateWins(attacker, radius).length) return true;
    if (immediateWins(defender, radius).length) return false;
    const memoKey = `VCF:${attacker}:${turns}:${boardCacheKey(attacker, 0)}`;
    if (memo.has(memoKey)) return memo.get(memoKey);

    const candidates = orderedMoves(attacker, 8, radius);
    for (const m of candidates) {
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
    if (turns <= 0) return false;
    if (searchVCF(attacker, Math.min(2, turns), radius, new Map())) return true;
    const defender = otherColor(attacker);
    if (immediateWins(defender, radius).length) return false;
    const memoKey = `VCT:${attacker}:${turns}:${boardCacheKey(attacker, 0)}`;
    if (memo.has(memoKey)) return memo.get(memoKey);

    const candidates = orderedMoves(attacker, 7, radius);
    for (const m of candidates) {
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

  function analyzeAdvancedCandidate(move, forced, cfg) {
    board[move.r][move.c] = WHITE;
    const winsNow = isWin(move.r, move.c, WHITE);
    const ownImmediate = winsNow ? 2 : immediateWins(WHITE, cfg.radius).length;
    const oppImmediate = winsNow ? 0 : immediateWins(BLACK, cfg.radius).length;
    const forks = winsNow ? {count: 0, points: [], moves: []} : countForkCreators(WHITE, 10, cfg.radius, 3);
    const opponentForks = (!winsNow && ownImmediate === 0 && oppImmediate === 0)
      ? countForkCreators(BLACK, 12, cfg.radius, 2)
      : { count: 0, points: [], moves: [] };
    const conn = localConnectivity(move.r, move.c, WHITE);
    const vcf = winsNow || (!oppImmediate && continuationVCFAfterCandidate(WHITE, cfg.vcfDepth, cfg.radius));
    const vct = !vcf && !oppImmediate && cfg.vctDepth > 0 && continuationVCTAfterCandidate(WHITE, cfg.vctDepth, cfg.radius);
    const blackCounterVCF = !winsNow && !ownImmediate && !opponentForks.count
      && searchVCF(BLACK, Math.min(2, cfg.vcfDepth), cfg.radius, new Map());
    const blackCounterVCT = !winsNow && !ownImmediate && !opponentForks.count && !blackCounterVCF && cfg.vctDepth > 0
      && searchVCTPressure(BLACK, Math.min(2, cfg.vctDepth + 1), cfg.radius, new Map());
    board[move.r][move.c] = EMPTY;

    let safety = 'SAFE';
    if (oppImmediate >= 2) safety = 'LOSING';
    else if (oppImmediate === 1) safety = 'UNSAFE';
    else if (opponentForks.count >= 1) safety = 'LOSING';
    else if (blackCounterVCF || blackCounterVCT) safety = 'TACTICALLY_RISKY';

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
      blackCounterVCF,
      blackCounterVCT,
      facts: {
        forced_role: forcedRole,
        tactical_safety: safety,
        attack_shape: attack,
        initiative,
        own_immediate_winning_points_after_move: countLabel(ownImmediate),
        opponent_immediate_winning_points_after_move: countLabel(oppImmediate),
        opponent_fork_creators_after_move: countLabel(opponentForks.count),
        opponent_fork_creator_points: opponentForks.points.length ? opponentForks.points.join(',') : 'NONE',
        vcf_status: vcf ? 'FORCED_SEQUENCE_FOUND' : 'NOT_FOUND',
        vct_status: vct ? 'PRESSURE_SEQUENCE_FOUND' : 'NOT_FOUND',
        opponent_counter_vcf: blackCounterVCF ? 'FOUND' : 'NOT_FOUND',
        opponent_counter_vct: blackCounterVCT ? 'PRESSURE_FOUND' : 'NOT_FOUND',
        connectivity: connectionLabel(conn.allies),
        centrality: Math.max(Math.abs(move.r - 7), Math.abs(move.c - 7)) <= 3 ? 'CENTRAL' : 'OUTER'
      }
    };
  }

  function buildAdvancedCandidates(mode) {
    const cfg = ENGINE_PRESETS[mode] || ENGINE_PRESETS.expert;
    const whiteWins = immediateWins(WHITE, cfg.radius);
    const blackWins = immediateWins(BLACK, cfg.radius);
    let forced = null;
    let roots;
    if (whiteWins.length) {
      forced = 'win';
      roots = whiteWins;
    } else if (blackWins.length) {
      forced = 'block';
      roots = blackWins;
    } else {
      const blackForks = moves.length >= 16
        ? countForkCreators(BLACK, Math.max(12, cfg.root), cfg.radius, 2)
        : { count: 0, points: [], moves: [] };
      if (blackForks.count === 1) {
        forced = 'block_fork';
        roots = blackForks.moves;
      } else {
        roots = orderedMoves(WHITE, cfg.root, cfg.radius);
      }
    }

    const cache = new Map();
    const scored = roots.map(m => ({ ...m, searchScore: scoreRootMove(m, cfg, cache) }))
      .sort((a,b) => b.searchScore - a.searchScore);

    let selected = scored.slice(0, Math.min(cfg.semantic, scored.length));
    selected.forEach((m, i) => {
      m.rank = i + 1;
      m.analysis = analyzeAdvancedCandidate(m, forced, cfg);
    });

    // Hard tactical filters override every probabilistic judgement.
    const immediate = selected.filter(m => m.analysis.winsNow);
    if (immediate.length) selected = immediate;
    else {
      const fullySafe = selected.filter(m => m.analysis.facts.tactical_safety === 'SAFE');
      if (fullySafe.length) selected = fullySafe;
      else {
        const survivable = selected.filter(m => !['LOSING','UNSAFE'].includes(m.analysis.facts.tactical_safety));
        if (survivable.length) selected = survivable;
      }
      const proven = selected.filter(m => m.analysis.vcf);
      if (proven.length) selected = proven;
    }
    selected.forEach((m,i) => { m.rank = i + 1; m.analysis.facts.local_engine_grade = i === 0 ? 'TOP_CHOICE' : i === 1 ? 'STRONG' : i <= 3 ? 'SOLID' : 'SECONDARY'; });
    return { mode, cfg, forced, candidates: selected };
  }

  function buildPureJevRequest() {
    const legal = legalMoves();
    const criteria = Object.fromEntries(legal.map(m => [m.key, null]));
    const last = moves.length ? moves[moves.length - 1].coord : null;
    return {
      mode: 'jev',
      candidates: legal,
      payload: {
        state: {
          game: 'Gomoku / Five in a Row',
          board_size: '15x15',
          you_are: 'WHITE (O)',
          opponent_is: 'BLACK (X)',
          side_to_move: 'WHITE',
          coordinate_system: 'Columns A-O left to right; rows 1-15 top to bottom; H8 is center.',
          rules: 'Renju forbidden-move rules are enabled. BLACK may not play overline, double-four, or real double-three; an exact black five wins. WHITE has no forbidden moves and wins with five or more in a row.',
          last_move: last,
          board_legend: 'X=BLACK opponent, O=WHITE you, .=empty',
          board_rows: boardRows()
        },
        model: settings.model || 'jev-latest',
        questions: {
          best_move: {
            type: 'choice',
            instructions: 'Choose the best legal move for WHITE. Never ignore an immediate win or an opponent one-move win.',
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
        instructions: `Judge candidate ${m.key} for WHITE by independently inspecting the board and candidate_facts.${m.key}. Candidate facts are deterministic hints but may be horizon-limited. If direct board tactics conflict with a heuristic fact, prefer the board evidence.`,
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
        side: 'WHITE',
        board_size: '15x15',
        coordinate_system: 'Columns A-O left to right; rows 1-15 top to bottom.',
        board_legend: 'X=BLACK opponent, O=WHITE you, .=empty',
        last_move: moves.length ? moves[moves.length - 1].coord : null,
        board_rows: boardRows(),
        instruction: 'Independently inspect the board geometry as well as the supplied candidate facts. The facts are horizon-limited hints, not a ranking and not infallible. Priority: immediate win > mandatory defense > forced tactical sequences > safety > initiative > connectivity.',
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
    const instruction = 'Choose the stronger move for WHITE by independently checking the board and the supplied semantic facts. The facts may miss deeper horizon tactics. Priority: immediate win > mandatory defense > forced tactical sequences > safety > forcing initiative > connectivity. No Local ranking is provided.';
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const a = candidates[i].key, b = candidates[j].key;
        const id = n++;
        questions[`duel_${id}_ab`] = { type: 'choice', instructions: instruction, criteria: { [a]: facts[a], [b]: facts[b] } };
        questions[`duel_${id}_ba`] = { type: 'choice', instructions: instruction, criteria: { [b]: facts[b], [a]: facts[a] } };
        pairs.push({ id, a, b });
      }
    }
    return {
      payload: {
        state: {
          task: 'Independent pairwise Gomoku move tournament.',
          side: 'WHITE',
          board_size: '15x15',
          coordinate_system: 'Columns A-O left to right; rows 1-15 top to bottom.',
          board_legend: 'X=BLACK opponent, O=WHITE you, .=empty',
          last_move: moves.length ? moves[moves.length - 1].coord : null,
          board_rows: boardRows(),
          note: 'Each pair is asked twice with reversed option order to reduce presentation-order bias. Candidate facts contain no Local rank.',
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

  function buildFinalJevPayload(context, candidates, deepAnalysis) {
    const deepRows = Array.isArray(deepAnalysis?.scores) ? deepAnalysis.scores : [];
    const deepByMove = new Map(deepRows.map((item, index) => [
      item.move,
      {
        score: Number.isFinite(item.score) ? item.score : null,
        rank: index + 1
      }
    ]));
    const criteria = {};

    for (const move of candidates) {
      const deep = deepByMove.get(move.key) || null;
      const facts = move.analysis?.facts || {};
      criteria[move.key] = {
        local_rank: move.rank ?? null,
        local_alpha_beta_score: Number.isFinite(move.searchScore) ? Number(move.searchScore.toFixed(2)) : null,
        deep_search_rank: deep?.rank ?? null,
        deep_search_score: Number.isFinite(deep?.score) ? Number(deep.score.toFixed(2)) : null,
        deep_search_depth: deepAnalysis?.depthReached ?? null,
        forced_role: facts.forced_role || 'NORMAL',
        tactical_safety: facts.tactical_safety || 'UNKNOWN',
        attack_shape: facts.attack_shape || 'POSITIONAL',
        initiative: facts.initiative || 'BALANCED',
        own_immediate_winning_points_after_move: facts.own_immediate_winning_points_after_move || 'NONE',
        opponent_immediate_winning_points_after_move: facts.opponent_immediate_winning_points_after_move || 'NONE',
        opponent_fork_creators_after_move: facts.opponent_fork_creators_after_move || 'NONE',
        vcf_status: facts.vcf_status || 'NOT_FOUND',
        vct_status: facts.vct_status || 'NOT_FOUND',
        opponent_counter_vcf: facts.opponent_counter_vcf || 'NOT_FOUND',
        opponent_counter_vct: facts.opponent_counter_vct || 'NOT_FOUND',
        connectivity: facts.connectivity || 'LOW',
        centrality: facts.centrality || 'OUTER'
      };
    }

    return {
      state: {
        task: 'Final Gomoku move decision using deterministic local-engine evidence.',
        side: 'WHITE',
        board_size: '15x15',
        coordinate_system: 'Columns A-O left to right; rows 1-15 top to bottom.',
        board_legend: 'X=BLACK opponent, O=WHITE you, .=empty',
        last_move: moves.length ? moves[moves.length - 1].coord : null,
        board_rows: boardRows(),
        local_engine_role: 'The local engine generated and tactically filtered the candidate set. Its ranks and search scores are evidence, not commands.',
        deep_search: {
          source: deepAnalysis?.source || 'unavailable',
          status: deepAnalysis?.status || 'unavailable',
          depth_reached: deepAnalysis?.depthReached ?? null,
          timed_out: Boolean(deepAnalysis?.timedOut)
        },
        rules: 'Renju forbidden-move rules are enabled: BLACK cannot play overline, double-four, or real double-three; exact black five wins. WHITE has no forbidden moves and wins with five or more.',
        decision_policy: [
          'You are the FINAL decision maker. Choose exactly one supplied candidate.',
          'Never ignore an immediate win, mandatory defense, or proven VCF sequence.',
          'Never choose an UNSAFE or LOSING move when a SAFE candidate is available.',
          'Treat local rank, Alpha-Beta score, and deep-search score as strong but finite-horizon evidence; do not mechanically choose local_rank=1.',
          'When tactically safe candidates have close search evidence, use board-wide strategic judgement: initiative, threat multiplicity, connectivity, future forcing potential, and opponent counterplay.'
        ]
      },
      model: settings.model || 'jev-latest',
      questions: {
        best_move: {
          type: 'choice',
          instructions: 'Make the final move decision for WHITE. Inspect the full board and all candidate evidence, then choose exactly one candidate. You have final selection authority within this already-filtered candidate set.',
          criteria
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
    const engineMode = mode === 'strong' ? 'strong' : 'expert';
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
          ranked: ranked.slice(0, 8).map(m => ({
            move: m.key,
            rank: m.rank,
            searchScore: Number.isFinite(m.searchScore) ? m.searchScore : null,
            finalScore: Number.isFinite(m.finalScore) ? m.finalScore : null,
            facts: m.analysis?.facts || null
          }))
        }
      },
      stageNote: '本地 Alpha-Beta + VCF/VCT（0 次 Jev 请求）'
    };
  }

  function challengerVerificationConfig(mode) {
    const base = ENGINE_PRESETS[mode] || ENGINE_PRESETS.expert;
    return {
      ...base,
      depth: mode === 'strong' ? Math.max(5, base.depth + 2) : Math.max(7, base.depth + 2),
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

  let deepWorkerSequence = 0;

  async function runDeepWorkerVerification(candidateMoves, mode, trigger) {
    const uniqueMoves = [...new Map(
      (candidateMoves || []).filter(Boolean).map(move => [move.key, move])
    ).values()];
    if (uniqueMoves.length < 2) return null;

    // Benchmark/Node harnesses do not expose Worker. Evaluate the same candidate
    // set synchronously so Jev receives comparable deep-search evidence.
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

    const id = ++deepWorkerSequence;
    const timeBudgetMs = mode === 'expert' ? 1500 : 1000;
    const maxDepth = mode === 'expert' ? 7 : 5;
    const branch = mode === 'expert' ? 7 : 6;

    return await new Promise(resolve => {
      let settled = false;
      let worker;
      try {
        worker = new Worker('/deep-worker.js', { type: 'module' });
      } catch (error) {
        resolve({
          status: 'unavailable',
          source: 'web-worker',
          trigger,
          winner: uniqueMoves[0].key,
          error: String(error?.message || error || 'Web Worker unavailable'),
          timedOut: false
        });
        return;
      }
      const finish = result => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.terminate();
        resolve(result);
      };

      const timer = setTimeout(() => {
        finish({
          status: 'timeout',
          source: 'web-worker',
          trigger,
          winner: uniqueMoves[0].key,
          depthReached: null,
          scores: [],
          timedOut: true,
          elapsedMs: timeBudgetMs,
          budgetMs: timeBudgetMs
        });
      }, timeBudgetMs + 350);

      worker.onmessage = event => {
        const message = event.data || {};
        if (message.id !== id) return;
        if (!message.ok) {
          finish({
            status: 'error',
            source: 'web-worker',
            trigger,
            winner: uniqueMoves[0].key,
            error: message.error || 'deep worker failed',
            timedOut: false
          });
          return;
        }
        finish({
          ...(message.result || {}),
          trigger
        });
      };

      worker.onerror = event => {
        finish({
          status: 'error',
          source: 'web-worker',
          trigger,
          winner: uniqueMoves[0].key,
          error: event?.message || 'deep worker crashed',
          timedOut: false
        });
      };

      worker.postMessage({
        id,
        board: board.map(row => row.slice()),
        side: WHITE,
        candidates: uniqueMoves.map(move => move.key),
        timeBudgetMs,
        maxDepth,
        branch
      });
    });
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

    updateApiState('busy', '本地深搜正在为 Jev 准备决策证据…');
    const deepAnalysis = await runDeepWorkerVerification(
      candidates,
      mode,
      'pre_jev_evidence'
    );

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

    const finalChoice = rawAnswer.choice.toUpperCase();
    const candidateKeys = new Set(candidates.map(move => move.key));
    if (!candidateKeys.has(finalChoice)) {
      throw new Error(`Jev 返回候选集之外的落点：${rawAnswer.choice}`);
    }

    const final = candidates.find(move => move.key === finalChoice);
    const probabilities = rawAnswer.probabilities && typeof rawAnswer.probabilities === 'object'
      ? Object.fromEntries(
          Object.entries(rawAnswer.probabilities)
            .filter(([key]) => candidateKeys.has(String(key).toUpperCase()))
            .map(([key, value]) => [String(key).toUpperCase(), Number(value)])
        )
      : { [finalChoice]: 1 };
    const probabilityConfidence = Number(probabilities[finalChoice]);
    const confidence = Number.isFinite(rawAnswer.confidence)
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
      jevSuggested: finalChoice,
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
          decisionAuthority: 'jev_final'
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
        finalDecision: compactAnswer(answer),
        localEvidence: candidates.map(move => ({
          move: move.key,
          localRank: move.localRank,
          localSearchScore: Number.isFinite(move.searchScore) ? move.searchScore : null,
          deepSearchRank: move.deepSearchRank,
          deepSearchScore: Number.isFinite(move.deepSearchScore) ? move.deepSearchScore : null,
          facts: move.analysis?.facts || null
        }))
      },
      stageNote: `Jev 最终决策：Local 提供 ${candidates.length} 个候选及搜索证据，Jev 最终选择 ${finalChoice}（每回合 1 次 Jev 请求）`
    };
  }

    async function jevTurn() {
    if (gameOver || current !== WHITE || thinking) return;

    thinking = true;
    beginThinkingClock();
    retryBtn.style.display = 'none';
    canvas.classList.add('disabled');
    updateStatus();
    updateApiState('busy', settings.strengthMode !== 'local'
      ? '正在为 Jev 分析局面…'
      : '本地引擎正在思考…');
    requestController = new AbortController();

    try {
      let result;
      if (settings.strengthMode === 'local') {
        result = localOnlyDecision(settings.strengthMode === 'strong' ? 'strong' : 'expert');
      } else if (settings.strengthMode === 'jev') {
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
        result = await advancedDecision(settings.strengthMode || 'expert');
      }

      const parsed = parseCoord(result.finalChoice);
      if (!parsed || board[parsed.r][parsed.c] !== EMPTY) throw new Error(`最终决策产生非法落点：${result.finalChoice}`);
      captureThinkingDuration(result);
      lastJev = result;
      renderJevResult(lastJev);
      const moveSource = result.mode === 'local' || result.fallbackReason || result.stageNote?.includes('0 次 Jev')
        ? '本地战术'
        : 'Jev';
      place(parsed.r, parsed.c, WHITE, moveSource);
      rememberDecision(result, moves.length);

      if (isWin(parsed.r, parsed.c, WHITE)) {
        finish(result.mode === 'local' ? '本地引擎赢了' : 'Jev 赢了', WHITE);
        return;
      }
      if (moves.length === SIZE * SIZE) {
        finish('平局', EMPTY);
        return;
      }
      current = BLACK;
      resetTurnClock();
      updateApiState();
    } catch (err) {
      if (err?.name === 'AbortError') return;
      console.error(err);

      const msg = friendlyError(err);
      const shouldFallback = true;

      if (shouldFallback) {
        try {
          const fallback = localOnlyDecision(settings.strengthMode === 'strong' ? 'strong' : 'expert');
          fallback.fallbackReason = msg;
          fallback.stageNote = `${fallback.stageNote}；Jev 不可用时自动降级`;
          const parsed = parseCoord(fallback.finalChoice);
          if (!parsed || board[parsed.r][parsed.c] !== EMPTY) throw new Error('本地降级产生非法落点');
          captureThinkingDuration(fallback);
          lastJev = fallback;
          renderJevResult(fallback);
          place(parsed.r, parsed.c, WHITE, '本地引擎(降级)');
          rememberDecision(fallback, moves.length);

          if (isWin(parsed.r, parsed.c, WHITE)) {
            finish('本地引擎赢了', WHITE);
            return;
          }
          if (moves.length === SIZE * SIZE) {
            finish('平局', EMPTY);
            return;
          }
          current = BLACK;
          resetTurnClock();
          updateApiState('err', 'Jev 暂不可用 · 本地引擎接管');
          toast('Jev 暂时不可用，本回合已由本地引擎接管。', 4200);
          return;
        } catch (fallbackErr) {
          console.error('local fallback failed', fallbackErr);
        }
      }

      captureThinkingDuration();
      current = WHITE;
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
    let reason = `综合局面后，白棋选择 ${finalChoice}，优先保持棋形和后续空间。`;

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
      reason = `${finalChoice} 与现有白棋连接紧密，有利于形成更多后续进攻方向。`;
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
      const challenger = result.decisionTrace?.challenger;
      const verification = challenger?.verification;
      if (finalDecision) {
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
            : '本地战术 · 白棋落在';
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
  document.getElementById('settingsBtn').addEventListener('click', openSettings);
  document.getElementById('quickSettingsBtn').addEventListener('click', openSettings);
  document.getElementById('closeSettingsBtn').addEventListener('click', () => {
    if (testController) testController.abort();
    settingsModal.classList.remove('show');
  });
  document.getElementById('saveSettingsBtn').addEventListener('click', saveSettings);
  levelOptionButtons.forEach(button => {
    button.addEventListener('click', () => renderLevelSelection(button.dataset.mode));
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
    if (e.target === settingsModal) {
      if (testController) testController.abort();
      settingsModal.classList.remove('show');
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (testController) testController.abort();
      settingsModal.classList.remove('show');
      hideResultModal();
    }
  });

  renderLevelSelection(settings.strengthMode);
  drawBoard();
  updateHistory();
  updateStatus();
  updateApiState();
  setInterval(refreshTurnClock, 100);
})();
