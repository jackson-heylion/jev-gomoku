(() => {
  'use strict';

  const SIZE = 15;
  const COLS = 'ABCDEFGHIJKLMNO'.split('');
  const EMPTY = 0, BLACK = 1, WHITE = 2;

  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const turnText = document.getElementById('turnText');
  const gameMeta = document.getElementById('gameMeta');
  const lastMoveText = document.getElementById('lastMoveText');
  const historyEl = document.getElementById('history');
  const apiIndicator = document.getElementById('apiIndicator');
  const apiLabel = document.getElementById('apiLabel');
  const jevMove = document.getElementById('jevMove');
  const jevInfo = document.getElementById('jevInfo');
  const confidenceBar = document.getElementById('confidenceBar');
  const confidenceText = document.getElementById('confidenceText');
  const alternatives = document.getElementById('alternatives');
  const retryBtn = document.getElementById('retryBtn');
  const copyRecordBtn = document.getElementById('copyRecordBtn');
  const toastEl = document.getElementById('toast');

  const settingsModal = document.getElementById('settingsModal');
  const modelInput = document.getElementById('model');
  const strengthModeInput = document.getElementById('strengthMode');
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

  const settings = loadSettings();
  modelInput.value = settings.model;
  strengthModeInput.value = settings.strengthMode;

  function makeBoard() {
    return Array.from({ length: SIZE }, () => Array(SIZE).fill(EMPTY));
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
    toast(settings.strengthMode === 'local' ? '已切换到本地引擎' : 'Jev 设置已保存');
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
    testConnectionBtn.textContent = '检测中…';
    setConnectionTest('busy', '正在通过同源 /api/jev 验证服务端 Jev 连接…');
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
        throw new Error('API 已响应，但返回结构不符合预期。');
      }
      const actualModel = data?.model || model;
      setConnectionTest('ok', `连接成功 · HTTP ${response.status} · ${elapsed} ms · ${actualModel}`);
    } catch (err) {
      setConnectionTest('err', err?.name === 'AbortError'
        ? '检测超时（15 秒）或已取消。'
        : `${err?.httpStatus ? `HTTP ${err.httpStatus} · ` : ''}${friendlyError(err)}`);
    } finally {
      clearTimeout(timeout);
      testController = null;
      testConnectionBtn.disabled = false;
      testConnectionBtn.textContent = '检测连接';
    }
  }

  function updateApiState(kind = null, text = null) {
    apiIndicator.className = 'indicator';
    if (kind === 'busy') apiIndicator.classList.add('busy');
    else if (kind === 'err') apiIndicator.classList.add('err');
    else if (settings.strengthMode !== 'local') apiIndicator.classList.add('ok');

    if (text) apiLabel.textContent = text;
    else {
      const strengthLabel = settings.strengthMode === 'local' ? '本地引擎'
        : settings.strengthMode === 'jev' ? '纯 Jev'
        : settings.strengthMode === 'strong' ? '强力混合'
        : '大师混合';
      apiLabel.textContent = settings.strengthMode === 'local'
        ? '本地引擎 · 0 次 Jev 请求'
        : `${settings.model} · ${strengthLabel} · 同源服务端`;
    }
  }

  function openSettings() {
    modelInput.value = settings.model;
    strengthModeInput.value = settings.strengthMode || 'expert';
    clearConnectionTest();
    settingsModal.classList.add('show');
    setTimeout(() => modelInput.focus(), 30);
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
    updateStatus();
    setTimeout(jevTurn, 220);
  }

  function isWin(r, c, color) {
    const dirs = [[1,0],[0,1],[1,1],[1,-1]];
    return dirs.some(([dr,dc]) => {
      let n = 1;
      for (const s of [-1, 1]) {
        let rr = r + dr*s, cc = c + dc*s;
        while (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && board[rr][cc] === color) {
          n++; rr += dr*s; cc += dc*s;
        }
      }
      return n >= 5;
    });
  }

  function finish(text, winner) {
    gameResult = { text, winner, endedAt: new Date() };
    gameOver = true;
    thinking = false;
    canvas.classList.remove('disabled');
    const cls = winner === BLACK ? 'black' : 'white';
    turnText.innerHTML = winner === EMPTY
      ? `<span>对局结束：${text}</span>`
      : `<span class="stone-dot ${cls}"></span><span>对局结束：${text}</span>`;
    gameMeta.textContent = `共 ${moves.length} 手`;
    toast(text, 3500);
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
    canvas.classList.remove('disabled');
    jevMove.textContent = '—';
    jevInfo.textContent = '等待 Jev 落子';
    confidenceBar.style.width = '0%';
    confidenceText.textContent = '—';
    alternatives.innerHTML = '';
    retryBtn.style.display = 'none';
    drawBoard(); updateHistory(); updateStatus(); updateApiState();
  }

  function undo() {
    if (thinking) { toast('Jev 正在思考，暂时不能悔棋'); return; }
    if (!moves.length) return;
    if (gameOver) gameOver = false;
    gameResult = null;

    let remove = current === BLACK ? 2 : 1;
    remove = Math.min(remove, moves.length);
    for (let i = 0; i < remove; i++) {
      const m = moves.pop();
      board[m.r][m.c] = EMPTY;
    }
    jevDecisionLog = jevDecisionLog.filter(item => item.moveNo <= moves.length);
    current = BLACK;
    lastJev = null;
    jevMove.textContent = '—';
    jevInfo.textContent = '已悔棋，等待下一次 Jev 判断';
    confidenceBar.style.width = '0%';
    confidenceText.textContent = '—';
    alternatives.innerHTML = '';
    retryBtn.style.display = 'none';
    drawBoard(); updateHistory(); updateStatus();
  }

  function updateStatus() {
    if (gameOver) return;
    const nextNo = moves.length + 1;
    if (thinking) {
      turnText.innerHTML = `<span class="stone-dot white"></span><span class="thinking">${settings.strengthMode !== 'local' ? 'Jev' : '本地引擎'} 正在选择落点</span>`;
      gameMeta.textContent = `第 ${nextNo} 手 · 白棋`;
    } else if (current === BLACK) {
      turnText.innerHTML = `<span class="stone-dot black"></span><span>你的回合</span>`;
      gameMeta.textContent = `第 ${nextNo} 手 · 黑棋`;
    } else {
      turnText.innerHTML = `<span class="stone-dot white"></span><span>${settings.strengthMode !== 'local' ? 'Jev' : '本地引擎'} 的回合</span>`;
      gameMeta.textContent = `第 ${nextNo} 手 · 白棋`;
    }
    lastMoveText.textContent = moves.length ? `最后落子：${moves[moves.length - 1].coord}` : '尚未落子';
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
      jevSuggested: result?.jevSuggested || null,
      stageNote: result?.stageNote || '',
      model: result?.model || '',
      confidence: Number.isFinite(result?.answer?.confidence) ? result.answer.confidence : null,
      usage: result?.usage ? { ...result.usage } : null,
      client: result?.client ? { ...result.client } : null,
      fallbackReason: result?.fallbackReason || null,
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
      : d.mode === 'strong' ? '强力混合'
      : '大师混合';
    lines.push(`第 ${d.moveNo} 手 · 白 ${d.chosen}`);
    lines.push(`  模式：${modeLabel}`);
    if (d.stageNote) lines.push(`  决策阶段：${d.stageNote}`);
    if (d.forced) lines.push(`  强制类型：${d.forced === 'win' ? '立即取胜' : d.forced === 'block' ? '必须防守' : d.forced}`);
    if (d.jevSuggested) lines.push(`  Jev 建议：${d.jevSuggested}`);
    if (d.model) lines.push(`  模型：${d.model}`);
    if (d.confidence != null) lines.push(`  最终置信度：${(d.confidence * 100).toFixed(1)}%`);
    if (d.usage) lines.push(`  Token：${d.usage.input_tokens ?? '?'} in / ${d.usage.output_tokens ?? '?'} out`);
    if (d.client) lines.push(`  API：${d.client.cached ? '命中会话缓存' : `${d.client.attempts || 1} 次请求`}`);
    if (d.fallbackReason) lines.push(`  降级原因：${d.fallbackReason}`);
    if (d.probabilities.length) {
      lines.push(`  候选概率：${d.probabilities.map(p => `${p.move} ${(p.probability * 100).toFixed(1)}%`).join('；')}`);
    }
    if (d.candidates.length) {
      lines.push('  候选评估：');
      d.candidates.forEach(c => {
        const f = c.facts || {};
        lines.push(
          `    #${c.rank ?? '—'} ${c.move} | final=${compactNumber(c.finalScore)} | local=${compactNumber(c.localNorm)} | atomic=${compactNumber(c.atomicScore)} | pair=${compactNumber(c.pairScore)} | search=${compactNumber(c.searchScore, 1)}`
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
    copyRecordBtn.textContent = '已复制';
    toast(`已复制 ${moves.length} 手棋谱`);
    setTimeout(() => { copyRecordBtn.textContent = old; }, 1200);
  }

  function boardRows() {
    return board.map((row, r) => ({
      row: r + 1,
      cells: row.map(v => v === BLACK ? 'X' : v === WHITE ? 'O' : '.').join('')
    }));
  }

  function legalMoves() {
    const result = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (board[r][c] === EMPTY) result.push({ r, c, key: coord(r, c) });
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
    return nearbyMoves(radius).filter(m => wouldWin(m.r, m.c, color));
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
    const blocks = immediateWins(otherColor(color), radius);
    if (blocks.length) {
      return blocks.map(m => ({ ...m, quick: quickMoveScore(m, color) }))
        .sort((a,b) => b.quick - a.quick).slice(0, limit);
    }
    return nearbyMoves(radius)
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

  function countForkCreators(color, limit = 10, radius = 2) {
    let count = 0;
    const points = [];
    const candidates = orderedMoves(color, limit, radius);
    for (const m of candidates) {
      board[m.r][m.c] = color;
      const wins = isWin(m.r, m.c, color) ? 2 : immediateWins(color, radius).length;
      board[m.r][m.c] = EMPTY;
      if (wins >= 2) {
        count++;
        points.push(m.key);
      }
    }
    return { count, points };
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
        if (board[d.r][d.c] !== EMPTY) continue;
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
      if (board[d.r][d.c] !== EMPTY) continue;
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
    const forks = winsNow ? {count: 0, points: []} : countForkCreators(WHITE, 10, cfg.radius);
    const conn = localConnectivity(move.r, move.c, WHITE);
    const vcf = winsNow || (!oppImmediate && continuationVCFAfterCandidate(WHITE, cfg.vcfDepth, cfg.radius));
    const vct = !vcf && !oppImmediate && cfg.vctDepth > 0 && continuationVCTAfterCandidate(WHITE, cfg.vctDepth, cfg.radius);
    const blackCounterVCF = !winsNow && !ownImmediate && searchVCF(BLACK, Math.min(2, cfg.vcfDepth), cfg.radius, new Map());
    board[move.r][move.c] = EMPTY;

    let safety = 'SAFE';
    if (oppImmediate >= 2) safety = 'LOSING';
    else if (oppImmediate === 1) safety = 'UNSAFE';
    else if (blackCounterVCF) safety = 'TACTICALLY_RISKY';

    const forcedRole = winsNow ? 'WIN_NOW'
      : forced === 'block' ? 'MUST_DEFEND'
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
      facts: {
        forced_role: forcedRole,
        tactical_safety: safety,
        attack_shape: attack,
        initiative,
        own_immediate_winning_points_after_move: countLabel(ownImmediate),
        opponent_immediate_winning_points_after_move: countLabel(oppImmediate),
        vcf_status: vcf ? 'FORCED_SEQUENCE_FOUND' : 'NOT_FOUND',
        vct_status: vct ? 'PRESSURE_SEQUENCE_FOUND' : 'NOT_FOUND',
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
    if (whiteWins.length) { forced = 'win'; roots = whiteWins; }
    else if (blackWins.length) { forced = 'block'; roots = blackWins; }
    else roots = orderedMoves(WHITE, cfg.root, cfg.radius);

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
      const safe = selected.filter(m => !['LOSING','UNSAFE'].includes(m.analysis.facts.tactical_safety));
      if (safe.length) selected = safe;
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
          rules: 'Choose one empty intersection. Five or more consecutive stones horizontally, vertically, or diagonally wins.',
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
    return Object.fromEntries(candidates.map(m => [m.key, {
      ...m.analysis.facts,
      local_rank: `RANK_${m.rank}`
    }]));
  }

  function buildAtomicPayload(context) {
    const questions = {};
    for (const m of context.candidates) {
      questions[`judge_${m.key}`] = {
        type: 'choice',
        instructions: `Judge candidate ${m.key} for WHITE using only candidate_facts.${m.key}. Do not reconstruct the board, count stones, or perform arithmetic. Deterministic code already handled geometry and tactical search.`,
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
        task: 'Gomoku candidate evaluation after deterministic tactical analysis.',
        side: 'WHITE',
        instruction: 'Treat supplied facts as ground truth. Do not infer board geometry. Priority: WIN_NOW > MUST_DEFEND > VCF_FORCED_SEQUENCE > tactical safety > forcing initiative > VCT pressure > connectivity.',
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
    const instruction = 'Choose the stronger move for WHITE using only the supplied deterministic semantic facts. Do not reconstruct the board. Priority: immediate win > mandatory defense > proven VCF > tactical safety > forcing initiative > VCT pressure > connectivity. If facts are close, prefer the higher local_engine_grade.';
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
          task: 'Pairwise Gomoku move tournament.',
          side: 'WHITE',
          note: 'Each pair is asked twice with reversed option order to reduce presentation-order bias.',
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

  async function advancedDecision(mode) {
    const context = buildAdvancedCandidates(mode);
    const candidates = context.candidates;
    if (!candidates.length) throw new Error('本地引擎没有生成合法候选点');

    if (candidates.length === 1) {
      const only = candidates[0];
      only.atomicScore = 1;
      only.pairScore = 1;
      only.localNorm = 1;
      only.finalScore = 1;
      return {
        answer: { choice: only.key, confidence: 1, probabilities: { [only.key]: 1 } },
        finalChoice: only.key,
        jevSuggested: only.key,
        mode,
        forced: context.forced,
        candidates,
        model: `${settings.model || 'jev-latest'} + local-forced`,
        usage: null,
        client: null,
        decisionTrace: {
          local: { reason: 'single_deterministic_forced_move', move: only.key }
        },
        stageNote: '本地强制手（0 次 Jev 请求）'
      };
    }

    // TypeSafe questions are independent inside one request. We therefore batch
    // all atomic judgements and the reverse-order pairwise tournament into one
    // System One call to reduce rate-limit pressure and duplicated input tokens.
    const tournament = [...candidates]
      .sort((a,b) => (a.rank ?? 999) - (b.rank ?? 999))
      .slice(0, Math.min(context.cfg.tournament, candidates.length));
    const { payload, pairs } = buildBatchedDecisionPayload(context, tournament);

    updateApiState('busy', `Jev 单次批量判断：${candidates.length} Atomic + ${pairs.length * 2} Pairwise…`);
    const data = await callJev(payload);

    for (const m of candidates) {
      m.atomicScore = atomicScore(data?.answers?.[`judge_${m.key}`]);
    }

    if (tournament.length >= 2) {
      const points = new Map(tournament.map(m => [m.key, 0]));
      const maxPoints = 2 * (tournament.length - 1);
      for (const pair of pairs) {
        for (const suffix of ['ab','ba']) {
          const ans = data?.answers?.[`duel_${pair.id}_${suffix}`];
          if (!ans) {
            points.set(pair.a, points.get(pair.a) + .5);
            points.set(pair.b, points.get(pair.b) + .5);
            continue;
          }
          points.set(pair.a, points.get(pair.a) + probabilityFor(ans, pair.a));
          points.set(pair.b, points.get(pair.b) + probabilityFor(ans, pair.b));
        }
      }
      tournament.forEach(m => {
        m.pairScore = maxPoints > 0 ? points.get(m.key) / maxPoints : .5;
      });
    } else {
      tournament.forEach(m => { m.pairScore = 1; });
    }

    candidates.forEach(m => {
      if (!Number.isFinite(m.pairScore)) m.pairScore = tournament.includes(m) ? .5 : 0;
      const localNorm = candidates.length === 1 ? 1 : 1 - ((m.rank - 1) / (candidates.length - 1));
      m.localNorm = localNorm;
      m.finalScore = context.cfg.localWeight * localNorm
        + context.cfg.atomicWeight * (m.atomicScore ?? .5)
        + context.cfg.pairWeight * m.pairScore;
      if (m.analysis.winsNow) m.finalScore += 10;
      if (m.analysis.vcf) m.finalScore += 1.2;
      if (m.analysis.facts.tactical_safety === 'LOSING') m.finalScore -= 10;
      else if (m.analysis.facts.tactical_safety === 'UNSAFE') m.finalScore -= 4;
    });

    const ranked = [...candidates].sort((a,b) => b.finalScore - a.finalScore);
    const final = ranked[0];
    const jevSuggested = [...tournament]
      .sort((a,b) => (b.pairScore ?? 0) - (a.pairScore ?? 0))[0]?.key || final.key;
    const probabilities = softmaxProbabilities(ranked);
    const confidence = probabilities[final.key] ?? .5;
    const atomicTrace = candidates.map(m => ({
      move: m.key,
      ...compactAnswer(data?.answers?.[`judge_${m.key}`])
    }));
    const pairwiseTrace = [];
    for (const pair of pairs) {
      for (const suffix of ['ab', 'ba']) {
        const ans = compactAnswer(data?.answers?.[`duel_${pair.id}_${suffix}`]);
        pairwiseTrace.push({
          left: suffix === 'ab' ? pair.a : pair.b,
          right: suffix === 'ab' ? pair.b : pair.a,
          ...(ans || { choice: null, confidence: null, probabilities: null })
        });
      }
    }

    return {
      answer: { choice: final.key, confidence, probabilities },
      finalChoice: final.key,
      jevSuggested,
      mode,
      forced: context.forced,
      candidates: ranked.map((m,i) => ({ ...m, rank: i + 1 })),
      model: data?.model || settings.model,
      usage: data?.usage || null,
      client: data?.__client || null,
      decisionTrace: {
        requestShape: {
          atomicQuestions: candidates.length,
          pairwiseQuestions: pairs.length * 2,
          httpRequests: data?.__client?.cached ? 0 : (data?.__client?.attempts || 1)
        },
        atomic: atomicTrace,
        pairwise: pairwiseTrace,
        fusion: {
          weights: {
            local: context.cfg.localWeight,
            atomic: context.cfg.atomicWeight,
            pairwise: context.cfg.pairWeight
          },
          finalChoice: final.key,
          jevSuggested
        }
      },
      stageNote: '单次批量：Atomic + 双向 Pairwise（每回合最多 1 次 Jev 请求）'
    };
  }

    async function jevTurn() {
    if (gameOver || current !== WHITE || thinking) return;

    thinking = true;
    retryBtn.style.display = 'none';
    canvas.classList.add('disabled');
    updateStatus();
    updateApiState('busy', settings.strengthMode !== 'local'
      ? '本地引擎：Alpha-Beta + VCF/VCT…'
      : '本地引擎计算中…');
    requestController = new AbortController();

    try {
      let result;
      if (settings.strengthMode === 'local') {
        result = localOnlyDecision(settings.strengthMode === 'strong' ? 'strong' : 'expert');
      } else if (settings.strengthMode === 'jev') {
        updateApiState('busy', '正在请求纯 Jev…');
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
      lastJev = result;
      renderJevResult(lastJev);
      place(parsed.r, parsed.c, WHITE, result.mode === 'local' ? '本地引擎' : 'Jev');
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
          updateApiState('err', 'Jev 暂不可用 · 已降级本地引擎');
          toast(`Jev 暂不可用，已用本地引擎继续：${msg}`, 5000);
          return;
        } catch (fallbackErr) {
          console.error('local fallback failed', fallbackErr);
        }
      }

      current = WHITE;
      updateApiState('err', 'Jev 请求失败');
      jevInfo.textContent = `请求失败：${msg}`;
      retryBtn.style.display = 'inline-block';
      toast(`Jev 请求失败：${msg}`, 5000);
    } finally {
      thinking = false;
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

  function renderJevResult(result) {
    const a = result.answer;
    const confidence = Number.isFinite(a.confidence) ? a.confidence : null;
    const finalChoice = result.finalChoice || a.choice;
    jevMove.textContent = finalChoice;
    const tokens = result.usage ? `${result.usage.input_tokens ?? '?'} in / ${result.usage.output_tokens ?? '?'} out` : 'usage n/a';
    const modeLabel = result.mode === 'local' ? '本地引擎'
      : result.mode === 'jev' ? '纯 Jev'
      : result.mode === 'strong' ? '强力混合'
      : '大师混合';
    const suggestion = result.jevSuggested && result.jevSuggested !== finalChoice ? ` · Jev 原建议 ${result.jevSuggested}` : '';
    const forced = result.forced === 'win' ? ' · 必胜点' : result.forced === 'block' ? ' · 强制防守' : '';
    jevInfo.textContent = `${modeLabel}${forced}${suggestion} · ${result.stageNote || 'Jev'} · ${result.model} · ${tokens}`;
    confidenceBar.style.width = confidence == null ? '0%' : `${Math.max(0, Math.min(100, confidence * 100))}%`;
    confidenceText.textContent = confidence == null ? '—' : `${Math.round(confidence * 100)}%`;

    const probs = a.probabilities && typeof a.probabilities === 'object'
      ? Object.entries(a.probabilities).sort((x, y) => Number(y[1]) - Number(x[1])).slice(0, 5)
      : [];
    const rankMap = new Map((result.candidates || []).map(m => [m.key, m.rank]));

    alternatives.innerHTML = probs.map(([key, p]) => {
      const pct = Math.max(0, Math.min(100, Number(p) * 100));
      const rank = rankMap.get(key);
      const label = rank ? `${key} · #${rank}` : key;
      return `<div class="alt"><strong>${escapeHtml(label)}</strong><div class="mini"><i style="width:${pct}%"></i></div><em>${pct.toFixed(pct >= 10 ? 0 : 1)}%</em></div>`;
    }).join('');
  }

  function friendlyError(err) {
    const msg = String(err?.message || err || '未知错误');
    if (err?.httpStatus === 429) return 'Jev 请求过于频繁（HTTP 429）。服务端已按 Retry-After / 指数退避重试，仍未恢复。';
    if (err?.httpStatus === 529) return 'TypeSafe 暂时过载（HTTP 529）。服务端已按 Retry-After / 指数退避重试，仍未恢复。';
    if (err?.httpStatus === 503 && /not configured|未配置/i.test(msg)) return '服务端未配置 JEV_API_KEY。';
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return '无法访问同源 /api/jev；本回合将使用本地引擎。';
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
  testConnectionBtn.addEventListener('click', testConnection);
  document.getElementById('restartBtn').addEventListener('click', restart);
  document.getElementById('undoBtn').addEventListener('click', undo);
  retryBtn.addEventListener('click', jevTurn);
  copyRecordBtn.addEventListener('click', copyGameRecord);
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
    }
  });

  drawBoard();
  updateHistory();
  updateStatus();
  updateApiState();
})();
