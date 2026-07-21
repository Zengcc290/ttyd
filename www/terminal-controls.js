(() => {
  const VERSION = 8;

  const qs = new URLSearchParams(location.search);
  const pageId = (() => {
    const bytes = new Uint8Array(16);
    if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
      window.crypto.getRandomValues(bytes);
      return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    }
    return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.padEnd(32, '0').slice(0, 32);
  })();
  const sessionId = (() => {
    for (const [k, v] of qs.entries()) {
      if ((k === 'arg' || k === 'arg[]') && /^s-[a-f0-9]{16}$/.test(v)) return v;
    }
    const m = location.href.match(/s-[a-f0-9]{16}/);
    return m ? m[0] : '';
  })();

  const state = (window.__webtermControls = {
    version: VERSION,
    sessionId,
    lockToken: qs.get('lock_token') || '',
    pageId,
    copyMode: false,
    zoomMode: false,
    zoom: 1,
    heartbeatTimer: null,
    sockets: new Set(),
  });

  // This script is injected in <head>, before ttyd creates its websocket.
  const NativeWebSocket = window.WebSocket;
  window.WebSocket = class WebtermTrackedSocket extends NativeWebSocket {
    constructor(...args) {
      const rawUrl = args[0];
      let url = rawUrl;
      try {
        const parsed = new URL(String(rawUrl), location.href);
        parsed.searchParams.set('page_id', state.pageId);
        url = parsed.toString();
      } catch (_) {}
      if (args.length > 1) super(url, args[1]);
      else super(url);
      state.sockets.add(this);
      this.addEventListener('close', () => state.sockets.delete(this), { once: true });
    }
  };

  const api = async (path, options = {}) => {
    const response = await fetch(path, {
      ...options,
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'X-Webterm-Request': '1',
        ...(options.headers || {}),
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(body.error || `请求失败 (${response.status})`);
      err.status = response.status;
      err.body = body;
      throw err;
    }
    return body;
  };

  const css = `
  .wt-fab-stack{position:fixed;top:12px;right:12px;z-index:2147483000;display:flex;flex-direction:column;gap:10px;align-items:flex-end;pointer-events:none}
  .wt-fab{pointer-events:auto;width:44px;height:44px;border-radius:999px;border:1px solid rgba(255,255,255,.18);background:rgba(20,24,28,.42);color:#e8eef2;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);box-shadow:0 10px 28px rgba(0,0,0,.28);display:grid;place-items:center;cursor:pointer;font-size:18px;user-select:none;-webkit-user-select:none;touch-action:manipulation}
  .wt-icon{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}
  .wt-fab:hover{background:rgba(32,40,46,.62)}
  .wt-fab.active{background:rgba(68,199,138,.78);color:#04150f;border-color:transparent}
  .wt-zoom-panel{pointer-events:auto;display:none;gap:8px;align-items:center;padding:8px 10px;border-radius:14px;background:rgba(16,18,20,.72);border:1px solid rgba(255,255,255,.12);color:#e8eef2;backdrop-filter:blur(10px)}
  .wt-zoom-panel.show{display:flex}
  .wt-zoom-panel button{border:0;border-radius:10px;padding:8px 10px;background:rgba(255,255,255,.08);color:inherit;cursor:pointer;min-width:40px}
  .wt-zoom-panel button:hover{background:rgba(255,255,255,.16)}
  .wt-zoom-panel span{min-width:52px;text-align:center;font:600 13px/1 ui-monospace,monospace}
  .wt-banner{position:fixed;left:50%;transform:translateX(-50%);top:12px;z-index:2147483001;display:none;align-items:center;gap:10px;padding:10px 14px;border-radius:12px;background:rgba(251,191,36,.16);border:1px solid rgba(251,191,36,.45);color:#ffe8a3;font:600 13px/1.3 system-ui,sans-serif;backdrop-filter:blur(8px);max-width:min(92vw,520px)}
  .wt-banner.show{display:flex}
  .wt-banner button{border:0;border-radius:8px;padding:7px 10px;background:rgba(255,255,255,.12);color:inherit;cursor:pointer}
  .wt-modal-mask{position:fixed;inset:0;z-index:2147483010;background:rgba(0,0,0,.45);display:none;align-items:center;justify-content:center;padding:18px}
  .wt-modal-mask.show{display:flex}
  .wt-modal{box-sizing:border-box;width:min(560px,100%);max-height:calc(100vh - 36px);overflow:auto;background:#171a1d;border:1px solid #343a40;border-radius:8px;box-shadow:0 24px 80px rgba(0,0,0,.45);color:#f1f3f5;padding:16px}
  .wt-modal h3{margin:0 0 8px;font-size:16px}
  .wt-modal p{margin:0 0 12px;color:#9ca3aa;font-size:13px}
  .wt-modal textarea{box-sizing:border-box;width:100%;min-height:180px;resize:vertical;border-radius:8px;border:1px solid #3a4248;background:#0f1214;color:#f1f3f5;padding:12px;font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre;tab-size:4}
  .wt-modal .row{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}
  .wt-modal .row button{border:0;border-radius:8px;padding:10px 14px;cursor:pointer;font:600 13px/1 system-ui,sans-serif}
  .wt-modal .ok{background:#44c78a;color:#04150f}
  .wt-modal .cancel{background:#2a3036;color:#e8eef2}
  body.wt-copy-mode, body.wt-copy-mode .xterm, body.wt-copy-mode .xterm-screen{cursor:crosshair !important}
  body.wt-copy-mode .xterm-selection div{background:rgba(68,199,138,.35)!important}
  #terminal-container, .xterm, .xterm-viewport, .xterm-screen { transform-origin: 0 0; }
  @media (max-width:600px){.wt-banner{top:auto;bottom:12px;max-width:calc(100vw - 24px)}}
  `;

  const injectCss = () => {
    if (document.getElementById('wt-controls-css')) return;
    const style = document.createElement('style');
    style.id = 'wt-controls-css';
    style.textContent = css;
    document.head.appendChild(style);
  };

  const toast = (message, isError = false) => {
    let el = document.getElementById('wt-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'wt-toast';
      el.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483020;max-width:min(420px,calc(100vw - 32px));padding:12px 14px;border-radius:10px;background:rgba(20,24,28,.92);border:1px solid #485057;color:#f1f3f5;opacity:0;transform:translateY(10px);transition:opacity .18s ease,transform .18s ease;pointer-events:none;font:13px/1.4 system-ui,sans-serif';
      document.body.appendChild(el);
    }
    el.style.bottom = state.copyMode && matchMedia('(max-width:600px)').matches ? '120px' : '16px';
    el.textContent = message;
    el.style.borderColor = isError ? '#7f3040' : '#485057';
    el.style.color = isError ? '#fecdd3' : '#f1f3f5';
    el.style.opacity = '1';
    el.style.transform = 'translateY(0)';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(10px)';
    }, 2800);
  };

  const writeToPty = (data) => {
    const terminal = window.term;
    if (!terminal || !data) return false;
    try {
      const core = terminal._core;
      if (core && core._coreService && typeof core._coreService.triggerDataEvent === 'function') {
        core._coreService.triggerDataEvent(data, true);
        return true;
      }
    } catch (_) {}
    try {
      if (typeof terminal.paste === 'function') {
        terminal.paste(data);
        return true;
      }
    } catch (_) {}
    return false;
  };

  const applyZoom = (value) => {
    const terminal = window.term;
    state.zoom = Math.max(0.7, Math.min(2.5, Number(value) || 1));
    const scale = state.zoom;
    const host = document.getElementById('terminal-container');
    if (!host) return;
    host.style.transform = scale === 1 ? '' : `scale(${scale})`;
    host.style.transformOrigin = '0 0';
    if (scale !== 1) {
      host.style.width = `${100 / scale}%`;
      host.style.height = `${100 / scale}%`;
      host.style.margin = '0';
    } else {
      host.style.width = '';
      host.style.height = '';
      host.style.margin = '';
    }
    try {
      if (terminal && typeof terminal.refresh === 'function') terminal.refresh(0, terminal.rows - 1);
      window.dispatchEvent(new Event('resize'));
    } catch (_) {}
    const label = document.getElementById('wt-zoom-label');
    if (label) label.textContent = `${Math.round(state.zoom * 100)}%`;
  };

  const setCopyMode = (on) => {
    state.copyMode = !!on;
    document.body.classList.toggle('wt-copy-mode', state.copyMode);
    const btn = document.getElementById('wt-copy-btn');
    if (btn) {
      btn.classList.toggle('active', state.copyMode);
      btn.setAttribute('aria-pressed', String(state.copyMode));
    }
    const banner = document.getElementById('wt-copy-banner');
    if (banner) banner.classList.toggle('show', state.copyMode);
    window.__webtermCopyMode = state.copyMode;
    const terminal = window.term;
    if (!state.copyMode && terminal && typeof terminal.clearSelection === 'function') {
      try { terminal.clearSelection(); } catch (_) {}
    }
    toast(state.copyMode ? '复制模式：拖动选择文本，松手自动复制' : '已退出复制模式');
  };

  const setZoomMode = (on) => {
    state.zoomMode = !!on;
    const btn = document.getElementById('wt-zoom-btn');
    if (btn) {
      btn.classList.toggle('active', state.zoomMode);
      btn.setAttribute('aria-pressed', String(state.zoomMode));
    }
    const panel = document.getElementById('wt-zoom-panel');
    if (panel) panel.classList.toggle('show', state.zoomMode);
    window.__webtermZoomMode = state.zoomMode;
  };

  const openPasteModal = async () => {
    const mask = document.getElementById('wt-paste-mask');
    const ta = document.getElementById('wt-paste-text');
    if (!mask || !ta) return;
    ta.value = '';
    mask.classList.add('show');
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const clip = await navigator.clipboard.readText();
        if (clip) ta.value = clip;
      }
    } catch (_) {}
    setTimeout(() => ta.focus(), 30);
  };

  const closePasteModal = () => {
    const mask = document.getElementById('wt-paste-mask');
    if (mask) mask.classList.remove('show');
  };

  const confirmPaste = () => {
    const ta = document.getElementById('wt-paste-text');
    if (!ta) return;
    const text = ta.value;
    if (!text) {
      toast('粘贴内容为空', true);
      return;
    }
    const terminal = window.term;
    let ok = false;
    try {
      if (terminal && typeof terminal.paste === 'function') {
        terminal.paste(text);
        ok = true;
      }
    } catch (_) {}
    if (!ok) ok = writeToPty(text);
    if (ok) {
      toast(`已粘贴 ${text.length} 字符`);
      closePasteModal();
    } else {
      toast('粘贴失败：终端尚未就绪', true);
    }
  };

  const copySelection = async () => {
    const terminal = window.term;
    if (!terminal) return;
    let text = '';
    try {
      if (typeof terminal.getSelection === 'function') text = terminal.getSelection() || '';
    } catch (_) {}
    if (!text) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      toast(`已复制 ${text.length} 字符`);
    } catch (e) {
      toast('复制失败：浏览器拒绝剪贴板权限', true);
    }
  };

  const installSelectionHandlers = () => {
    const terminal = window.term;
    const screen = document.querySelector('.xterm-screen');
    if (!terminal || !screen || screen.dataset.wtSelectBridge === '1') return false;
    screen.dataset.wtSelectBridge = '1';

    let selecting = false;
    let startCol = 0;
    let startRow = 0;

    const cellAt = (clientX, clientY) => {
      const rect = screen.getBoundingClientRect();
      const cols = Math.max(terminal.cols || 1, 1);
      const rows = Math.max(terminal.rows || 1, 1);
      const scale = state.zoom || 1;
      const x = (clientX - rect.left) / scale;
      const y = (clientY - rect.top) / scale;
      const col = Math.max(0, Math.min(cols - 1, Math.floor(x / (rect.width / scale / cols))));
      const row = Math.max(0, Math.min(rows - 1, Math.floor(y / (rect.height / scale / rows))));
      return { col, row };
    };

    const onStart = (clientX, clientY) => {
      if (!state.copyMode) return false;
      const { col, row } = cellAt(clientX, clientY);
      selecting = true;
      startCol = col;
      startRow = row;
      try {
        if (typeof terminal.clearSelection === 'function') terminal.clearSelection();
        if (typeof terminal.select === 'function') {
          const viewportY = terminal.buffer && terminal.buffer.active
            ? terminal.buffer.active.viewportY
            : 0;
          terminal.select(col, viewportY + row, 1);
        }
      } catch (_) {}
      return true;
    };

    const onMove = (clientX, clientY) => {
      if (!selecting || !state.copyMode) return;
      const { col, row } = cellAt(clientX, clientY);
      try {
        if (typeof terminal.select === 'function') {
          const start = startRow * terminal.cols + startCol;
          const end = row * terminal.cols + col;
          const from = Math.min(start, end);
          const len = Math.abs(end - start) + 1;
          const viewportY = terminal.buffer && terminal.buffer.active
            ? terminal.buffer.active.viewportY
            : 0;
          terminal.select(from % terminal.cols, viewportY + Math.floor(from / terminal.cols), len);
        }
      } catch (_) {}
    };

    const onEnd = async () => {
      if (!selecting) return;
      selecting = false;
      if (state.copyMode) await copySelection();
    };

    screen.addEventListener('mousedown', (e) => {
      if (!state.copyMode) return;
      if (e.button !== 0) return;
      if (onStart(e.clientX, e.clientY)) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);

    window.addEventListener('mousemove', (e) => {
      if (!selecting) return;
      onMove(e.clientX, e.clientY);
      e.preventDefault();
    }, true);

    window.addEventListener('mouseup', async (e) => {
      if (!selecting) return;
      e.preventDefault();
      await onEnd();
    }, true);

    screen.addEventListener('touchstart', (e) => {
      if (!state.copyMode) return;
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      if (onStart(t.clientX, t.clientY)) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, { capture: true, passive: false });

    screen.addEventListener('touchmove', (e) => {
      if (!state.copyMode || !selecting) return;
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      onMove(t.clientX, t.clientY);
      e.preventDefault();
      e.stopPropagation();
    }, { capture: true, passive: false });

    screen.addEventListener('touchend', async (e) => {
      if (!state.copyMode || !selecting) return;
      e.preventDefault();
      e.stopPropagation();
      await onEnd();
    }, { capture: true, passive: false });

    return true;
  };

  const buildUi = () => {
    if (document.getElementById('wt-fab-stack')) return;
    injectCss();

    const stack = document.createElement('div');
    stack.id = 'wt-fab-stack';
    stack.className = 'wt-fab-stack';
    stack.innerHTML = `
      <div id="wt-zoom-panel" class="wt-zoom-panel" aria-label="缩放面板">
        <button type="button" id="wt-zoom-out" title="缩小">−</button>
        <span id="wt-zoom-label">100%</span>
        <button type="button" id="wt-zoom-in" title="放大">+</button>
        <button type="button" id="wt-zoom-reset" title="重置">100%</button>
      </div>
      <button type="button" class="wt-fab" id="wt-zoom-btn" title="缩放" aria-label="缩放" aria-pressed="false">
        <svg class="wt-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path><path d="M11 8v6"></path><path d="M8 11h6"></path></svg>
      </button>
      <button type="button" class="wt-fab" id="wt-copy-btn" title="复制模式" aria-label="复制模式" aria-pressed="false">
        <svg class="wt-icon" viewBox="0 0 24 24" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>
      </button>
      <button type="button" class="wt-fab" id="wt-paste-btn" title="粘贴" aria-label="粘贴">
        <svg class="wt-icon" viewBox="0 0 24 24" aria-hidden="true"><rect width="8" height="4" x="8" y="2" rx="1"></rect><path d="M16 4h2a2 2 0 0 1 2 2v4"></path><path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6"></path><path d="m16 19 2 2 4-4"></path></svg>
      </button>
    `;
    document.body.appendChild(stack);

    const banner = document.createElement('div');
    banner.id = 'wt-copy-banner';
    banner.className = 'wt-banner';
    banner.innerHTML = `<span>复制模式中：页面滚动已锁定，拖选文本即可复制</span><button type="button" id="wt-copy-exit">退出</button>`;
    document.body.appendChild(banner);

    const mask = document.createElement('div');
    mask.id = 'wt-paste-mask';
    mask.className = 'wt-modal-mask';
    mask.innerHTML = `
      <div class="wt-modal" role="dialog" aria-modal="true">
        <h3>粘贴到终端</h3>
        <p>将完整保留缩进与换行。可先从剪贴板读取，也可手动编辑后再确认。</p>
        <textarea id="wt-paste-text" spellcheck="false" autocomplete="off"></textarea>
        <div class="row">
          <button type="button" class="cancel" id="wt-paste-cancel">取消</button>
          <button type="button" class="ok" id="wt-paste-ok">确定粘贴</button>
        </div>
      </div>`;
    document.body.appendChild(mask);

    document.getElementById('wt-zoom-btn').addEventListener('click', () => setZoomMode(!state.zoomMode));
    document.getElementById('wt-zoom-in').addEventListener('click', () => applyZoom(state.zoom + 0.1));
    document.getElementById('wt-zoom-out').addEventListener('click', () => applyZoom(state.zoom - 0.1));
    document.getElementById('wt-zoom-reset').addEventListener('click', () => applyZoom(1));
    document.getElementById('wt-copy-btn').addEventListener('click', () => setCopyMode(!state.copyMode));
    document.getElementById('wt-copy-exit').addEventListener('click', () => setCopyMode(false));
    document.getElementById('wt-paste-btn').addEventListener('click', () => openPasteModal());
    document.getElementById('wt-paste-cancel').addEventListener('click', () => closePasteModal());
    document.getElementById('wt-paste-ok').addEventListener('click', () => confirmPaste());
    mask.addEventListener('click', (e) => { if (e.target === mask) closePasteModal(); });

    let pinchStartDist = 0;
    let pinchStartZoom = 1;
    const dist = (t1, t2) => Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
    document.addEventListener('touchstart', (e) => {
      if (!state.zoomMode || e.touches.length !== 2) return;
      pinchStartDist = dist(e.touches[0], e.touches[1]);
      pinchStartZoom = state.zoom;
    }, { passive: true, capture: true });
    document.addEventListener('touchmove', (e) => {
      if (!state.zoomMode || e.touches.length !== 2 || !pinchStartDist) return;
      const scale = dist(e.touches[0], e.touches[1]) / pinchStartDist;
      applyZoom(pinchStartZoom * scale);
      e.preventDefault();
    }, { passive: false, capture: true });
    document.addEventListener('touchend', () => { pinchStartDist = 0; }, { passive: true, capture: true });

    document.addEventListener('wheel', (e) => {
      if (!state.copyMode) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    }, { passive: false, capture: true });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (state.copyMode) setCopyMode(false);
        if (state.zoomMode) setZoomMode(false);
        closePasteModal();
      }
    });
  };

  const releaseLock = async () => {
    if (!sessionId || !state.lockToken) return;
    const token = state.lockToken;
    state.lockToken = '';
    try {
      await api(`/api/sessions/${sessionId}/release`, {
        method: 'POST',
        body: JSON.stringify({ token, page_id: state.pageId }),
        keepalive: true,
      });
    } catch (_) {}
  };

  const blockTerminal = (message) => {
    if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
    state.heartbeatTimer = null;
    state.lockToken = '';
    for (const socket of state.sockets) {
      try { socket.close(1000, 'terminal lock lost'); } catch (_) {}
    }
    try {
      if (window.term) window.term.options.disableStdin = true;
    } catch (_) {}

    let blocker = document.getElementById('wt-lock-blocker');
    if (!blocker) {
      blocker = document.createElement('div');
      blocker.id = 'wt-lock-blocker';
      blocker.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:#101214;color:#f1f3f5;font:16px/1.5 system-ui,sans-serif;padding:24px;text-align:center';
      const content = document.createElement('div');
      const text = document.createElement('p');
      text.style.margin = '0 0 14px';
      const home = document.createElement('a');
      home.href = '/';
      home.textContent = '返回主页';
      home.style.color = '#44c78a';
      content.append(text, home);
      blocker.appendChild(content);
      document.body.appendChild(blocker);
    }
    blocker.querySelector('p').textContent = message;
  };

  const startHeartbeat = () => {
    if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
    state.heartbeatTimer = setInterval(async () => {
      if (!sessionId || !state.lockToken) return;
      try {
        await api(`/api/sessions/${sessionId}/heartbeat`, {
          method: 'POST',
          body: JSON.stringify({ token: state.lockToken, page_id: state.pageId }),
        });
      } catch (err) {
        blockTerminal('会话锁已失效或已被强制释放，当前页面已断开。');
      }
    }, 10000);
  };

  const acquireLockOrBlock = async () => {
    if (!sessionId) return true;
    const owner = `${navigator.userAgent.slice(0, 40)} @ ${new Date().toLocaleString()}`;
    try {
      if (state.lockToken) {
        await api(`/api/sessions/${sessionId}/heartbeat`, {
          method: 'POST',
          body: JSON.stringify({ token: state.lockToken, page_id: state.pageId }),
        });
      } else {
        const res = await api(`/api/sessions/${sessionId}/acquire`, {
          method: 'POST',
          body: JSON.stringify({ owner }),
        });
        state.lockToken = res.token || '';
      }
      startHeartbeat();
      return true;
    } catch (err) {
      const message = err.status === 409
        ? '该终端已在其他页面打开，当前页面已拒绝进入。'
        : `终端锁校验失败，当前页面已拒绝进入：${err.message}`;
      blockTerminal(message);
      return false;
    }
  };

  const boot = async () => {
    buildUi();
    const ok = await acquireLockOrBlock();
    if (!ok) return;

    const timer = setInterval(() => {
      if (installSelectionHandlers()) clearInterval(timer);
    }, 50);
    setTimeout(() => clearInterval(timer), 60000);

    window.addEventListener('pagehide', () => { releaseLock(); }, { capture: true });
    window.addEventListener('beforeunload', () => { releaseLock(); });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
