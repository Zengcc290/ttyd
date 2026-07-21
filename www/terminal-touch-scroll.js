(() => {
  const VERSION = 5;

  const install = () => {
    const terminal = window.term;
    const screen = document.querySelector('.xterm-screen');
    if (!terminal || !screen || screen.dataset.touchScrollBridge === '1') return false;

    let lastY = null;
    let remainder = 0;

    document.documentElement.style.overscrollBehavior = 'none';
    document.body.style.overscrollBehavior = 'none';
    document.documentElement.style.touchAction = 'none';
    document.body.style.touchAction = 'none';
    screen.style.touchAction = 'none';
    if (terminal.element) terminal.element.style.touchAction = 'none';
    screen.dataset.touchScrollBridge = '1';

    const state = window.__webtermTouchScrollBridge = {
      installed: true,
      version: VERSION,
      wheels: 0,
      scrolls: 0,
      lastDelta: 0,
      mode: 'init',
      sentBytes: 0,
    };

    const cellPosition = (clientX, clientY) => {
      const rect = screen.getBoundingClientRect();
      const cols = Math.max(terminal.cols || 1, 1);
      const rows = Math.max(terminal.rows || 1, 1);
      const x = Math.max(1, Math.min(cols, Math.floor((clientX - rect.left) / (rect.width / cols)) + 1));
      const y = Math.max(1, Math.min(rows, Math.floor((clientY - rect.top) / (rect.height / rows)) + 1));
      return { x, y, rowHeight: Math.max(rect.height / rows, 8), rect };
    };

    const writeToPty = (data) => {
      if (!data) return false;
      try {
        // Prefer xterm internal path used by onData -> ttyd websocket INPUT frames.
        const core = terminal._core;
        if (core && core._coreService && typeof core._coreService.triggerDataEvent === 'function') {
          core._coreService.triggerDataEvent(data, true);
          state.sentBytes += data.length;
          return true;
        }
      } catch (error) {}
      try {
        if (typeof terminal.paste === 'function') {
          terminal.paste(data);
          state.sentBytes += data.length;
          return true;
        }
      } catch (error) {}
      return false;
    };

    const sendMouseWheelToTmux = (lineCount, clientX, clientY) => {
      if (!lineCount) return false;
      const { x, y } = cellPosition(clientX, clientY);
      // SGR mouse encoding used by xterm/tmux:
      // 64 = wheel up (older history), 65 = wheel down (newer).
      const button = lineCount < 0 ? 64 : 65;
      const count = Math.min(Math.abs(lineCount), 40);
      let sequence = '';
      for (let index = 0; index < count; index += 1) {
        sequence += '\x1b[<' + button + ';' + x + ';' + y + 'M';
      }
      return writeToPty(sequence);
    };

    const dispatchDomWheel = (deltaY, clientX, clientY) => {
      const opts = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX,
        clientY,
        screenX: clientX,
        screenY: clientY,
        deltaX: 0,
        deltaY,
        deltaZ: 0,
        deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      };
      for (const target of [screen, terminal.textarea, terminal.element, document].filter(Boolean)) {
        target.dispatchEvent(new WheelEvent('wheel', opts));
      }
      state.wheels += 1;
    };

    const scrollByPixels = (pixels, clientX, clientY) => {
      if (!pixels) return;
      state.lastDelta = pixels;
      state.scrolls += 1;

      const { rowHeight } = cellPosition(clientX, clientY);
      let lines = Math.trunc(pixels / rowHeight);
      if (!lines) lines = Math.sign(pixels);
      lines = Math.max(-40, Math.min(40, lines));

      // Primary path for webterm+tmux: inject mouse-wheel CSI into PTY.
      if (sendMouseWheelToTmux(lines, clientX, clientY)) {
        state.mode = 'tmux-sgr';
      }

      // Local xterm scrollback (when not in alt-screen / mouse app).
      if (typeof terminal.scrollLines === 'function') {
        const beforeY = terminal.buffer && terminal.buffer.active ? terminal.buffer.active.viewportY : null;
        terminal.scrollLines(lines);
        const afterY = terminal.buffer && terminal.buffer.active ? terminal.buffer.active.viewportY : null;
        if (typeof beforeY === 'number' && typeof afterY === 'number' && afterY !== beforeY) {
          state.mode = state.mode === 'tmux-sgr' ? 'hybrid' : 'xterm';
        }
      }

      // DOM wheel for frontends that translate wheel to protocol themselves.
      dispatchDomWheel(pixels, clientX, clientY);
      if (state.mode === 'init') state.mode = 'wheel';
    };

    screen.addEventListener('touchstart', (event) => {
      if (event.touches.length !== 1) {
        lastY = null;
        remainder = 0;
        return;
      }
      lastY = event.touches[0].clientY;
      remainder = 0;
    }, { passive: true, capture: true });

    screen.addEventListener('touchmove', (event) => {
      if (lastY === null || event.touches.length !== 1) return;

      const touch = event.touches[0];
      remainder += lastY - touch.clientY;
      lastY = touch.clientY;

      if (Math.abs(remainder) < 3) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      const pixels = Math.max(-320, Math.min(320, remainder));
      remainder = 0;
      scrollByPixels(pixels, touch.clientX, touch.clientY);

      event.preventDefault();
      event.stopImmediatePropagation();
    }, { passive: false, capture: true });

    const finish = () => {
      lastY = null;
      remainder = 0;
    };
    screen.addEventListener('touchend', finish, { passive: true, capture: true });
    screen.addEventListener('touchcancel', finish, { passive: true, capture: true });

    return true;
  };

  if (!install()) {
    const timer = window.setInterval(() => {
      if (install()) window.clearInterval(timer);
    }, 50);
    window.setTimeout(() => window.clearInterval(timer), 60000);
  }
})();
