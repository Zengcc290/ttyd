(() => {
  const VERSION = 1;
  const state = (window.__webtermKeyboard = {
    version: VERSION,
    open: false,
    modifiers: new Set(),
    capsLock: false,
  });

  const css = `
  .wt-keyboard-panel{position:fixed;left:0;right:0;bottom:0;z-index:2147482990;display:none;box-sizing:border-box;max-height:min(48dvh,310px);padding:8px max(8px,env(safe-area-inset-right)) max(8px,env(safe-area-inset-bottom)) max(8px,env(safe-area-inset-left));overflow:auto;background:rgba(15,18,21,.92);border-top:1px solid rgba(255,255,255,.16);box-shadow:0 -16px 40px rgba(0,0,0,.34);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);user-select:none;-webkit-user-select:none;touch-action:manipulation}
  .wt-keyboard-panel.show{display:block}
  .wt-keyboard-title{display:flex;align-items:center;justify-content:space-between;max-width:1180px;margin:0 auto 7px;color:#aeb8c0;font:600 12px/1.2 system-ui,sans-serif}
  .wt-keyboard-title button{width:28px;height:28px;border:0;border-radius:7px;background:rgba(255,255,255,.1);color:#e8eef2;cursor:pointer;font-size:18px;line-height:1}
  .wt-keyboard-rows{display:grid;gap:5px;max-width:1180px;margin:0 auto}
  .wt-key-row{display:flex;gap:4px;min-width:660px}
  .wt-key{flex:1 1 0;min-width:32px;height:36px;border:1px solid rgba(255,255,255,.14);border-radius:7px;background:rgba(42,48,54,.92);color:#edf2f5;box-shadow:0 2px 0 rgba(0,0,0,.24);font:600 12px/1 system-ui,sans-serif;cursor:pointer;padding:0 4px;touch-action:manipulation}
  .wt-key:hover{background:rgba(65,76,84,.96)}
  .wt-key:active,.wt-key.active{background:rgba(68,199,138,.82);border-color:transparent;color:#04150f;transform:translateY(1px)}
  .wt-key.wide{flex:1.65 1 0}.wt-key.xwide{flex:2.35 1 0}.wt-key.space{flex:6 1 0}.wt-key.mod{background:rgba(30,38,44,.96);color:#c9d4db}
  body.wt-keyboard-open #terminal-container{height:calc(100% - var(--wt-keyboard-height, 280px))}
  @media (max-width:600px){.wt-keyboard-panel{padding-top:6px}.wt-key{height:34px;font-size:11px}.wt-keyboard-title{margin-bottom:5px}}
  `;

  const injectCss = () => {
    if (document.getElementById('wt-keyboard-css')) return;
    const style = document.createElement('style');
    style.id = 'wt-keyboard-css';
    style.textContent = css;
    document.head.appendChild(style);
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

  const specialKeys = {
    Escape: '\x1b', Tab: '\x09', Enter: '\r', Backspace: '\x7f',
    ArrowUp: '\x1b[A', ArrowDown: '\x1b[B', ArrowRight: '\x1b[C', ArrowLeft: '\x1b[D',
    Home: '\x1b[H', End: '\x1b[F', Insert: '\x1b[2~', Delete: '\x1b[3~',
    PageUp: '\x1b[5~', PageDown: '\x1b[6~',
    F1: '\x1bOP', F2: '\x1bOQ', F3: '\x1bOR', F4: '\x1bOS',
    F5: '\x1b[15~', F6: '\x1b[17~', F7: '\x1b[18~', F8: '\x1b[19~',
    F9: '\x1b[20~', F10: '\x1b[21~', F11: '\x1b[23~', F12: '\x1b[24~',
    PrintScreen: '\x1b[29~', ScrollLock: '\x1b[34~', Pause: '\x1b[99~',
    NumLock: '\x1b[30~', Menu: '\x1b[29~',
  };
  const shiftedChars = { '`':'~','1':'!','2':'@','3':'#','4':'$','5':'%','6':'^','7':'&','8':'*','9':'(','0':')','-':'_','=':'+','[':'{',']':'}','\\':'|',';':':',"'":'\"',',':'<','.':'>','/':'?' };
  const ctrlChars = { ' ':'\x00','@':'\x00','2':'\x00','[':'\x1b','3':'\x1b','\\':'\x1c',']':'\x1d','^':'\x1e','6':'\x1e','_':'\x1f','-':'\x1f','?':'\x7f' };

  const withCsiModifier = (sequence, modifiers) => {
    const code = 1 + (modifiers.has('shift') ? 1 : 0) + (modifiers.has('alt') ? 2 : 0) + (modifiers.has('ctrl') ? 4 : 0) + (modifiers.has('meta') ? 8 : 0);
    if (code === 1) return sequence;
    if (sequence === '\x1b[Z') return sequence;
    if (sequence.startsWith('\x1bO')) return `\x1b[1;${code}${sequence.slice(-1)}`;
    const match = sequence.match(/^\x1b\[(\d+)?(~|[A-Za-z])$/);
    if (!match) return sequence;
    return `\x1b[${match[1] || '1'};${code}${match[2]}`;
  };

  const keyData = (key) => {
    const modifiers = new Set(state.modifiers);
    let data = specialKeys[key] || key;
    const printable = data.length === 1 && data !== '\x1b';
    if (printable) {
      let char = data;
      if (/[a-z]/i.test(char) && (modifiers.has('shift') !== state.capsLock)) char = char.toUpperCase();
      else if (shiftedChars[char] && modifiers.has('shift')) char = shiftedChars[char];
      if (modifiers.has('ctrl')) {
        const upper = char.toUpperCase();
        data = ctrlChars[char] || ctrlChars[upper] || (upper >= 'A' && upper <= 'Z' ? String.fromCharCode(upper.charCodeAt(0) - 64) : char);
      } else data = char;
    } else data = withCsiModifier(data, modifiers);
    if (modifiers.has('alt') && !data.startsWith('\x1b')) data = `\x1b${data}`;
    if (modifiers.has('meta') && !data.startsWith('\x1b')) data = `\x1b${data}`;
    return data;
  };

  const updateModifierButtons = () => {
    document.querySelectorAll('[data-wt-mod]').forEach((button) => {
      const modifier = button.dataset.wtMod;
      button.classList.toggle('active', modifier === 'caps' ? state.capsLock : state.modifiers.has(modifier));
    });
  };

  const setPanelHeight = () => {
    const panel = document.getElementById('wt-keyboard-panel');
    if (!panel || !state.open) return;
    document.documentElement.style.setProperty('--wt-keyboard-height', `${Math.ceil(panel.getBoundingClientRect().height)}px`);
    try { window.dispatchEvent(new Event('resize')); } catch (_) {}
  };

  const toggle = (open) => {
    state.open = typeof open === 'boolean' ? open : !state.open;
    const panel = document.getElementById('wt-keyboard-panel');
    const trigger = document.getElementById('wt-keyboard-trigger');
    if (panel) panel.classList.toggle('show', state.open);
    if (trigger) {
      trigger.classList.toggle('active', state.open);
      trigger.setAttribute('aria-pressed', String(state.open));
    }
    document.body.classList.toggle('wt-keyboard-open', state.open);
    if (!state.open) {
      state.modifiers.clear();
      document.documentElement.style.removeProperty('--wt-keyboard-height');
      updateModifierButtons();
    } else {
      requestAnimationFrame(setPanelHeight);
      setTimeout(setPanelHeight, 120);
      setTimeout(setPanelHeight, 360);
    }
    try { window.dispatchEvent(new Event('resize')); } catch (_) {}
  };

  const buildKeyboard = () => {
    injectCss();
    const stack = document.getElementById('wt-fab-stack');
    if (stack && !document.getElementById('wt-keyboard-trigger')) {
      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.id = 'wt-keyboard-trigger';
      trigger.className = 'wt-fab';
      trigger.title = 'Virtual keyboard';
      trigger.setAttribute('aria-label', 'Virtual keyboard');
      trigger.setAttribute('aria-pressed', 'false');
      trigger.innerHTML = '<svg class="wt-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2"></rect><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M10 13h.01M14 13h.01M18 13h.01M7 16h10"></path></svg>';
      trigger.addEventListener('click', () => toggle());
      stack.insertBefore(trigger, stack.firstChild);
    }
    if (document.getElementById('wt-keyboard-panel')) return;
    const panel = document.createElement('section');
    panel.id = 'wt-keyboard-panel';
    panel.className = 'wt-keyboard-panel';
    panel.setAttribute('aria-label', 'Virtual keyboard');
    panel.innerHTML = `
      <div class="wt-keyboard-title"><span>Keyboard</span><button type="button" id="wt-keyboard-close" title="Close" aria-label="Close">&#215;</button></div>
      <div class="wt-keyboard-rows">
        <div class="wt-key-row"><button class="wt-key" data-wt-key="Escape">Esc</button><button class="wt-key" data-wt-key="F1">F1</button><button class="wt-key" data-wt-key="F2">F2</button><button class="wt-key" data-wt-key="F3">F3</button><button class="wt-key" data-wt-key="F4">F4</button><button class="wt-key" data-wt-key="F5">F5</button><button class="wt-key" data-wt-key="F6">F6</button><button class="wt-key" data-wt-key="F7">F7</button><button class="wt-key" data-wt-key="F8">F8</button><button class="wt-key" data-wt-key="F9">F9</button><button class="wt-key" data-wt-key="F10">F10</button><button class="wt-key" data-wt-key="F11">F11</button><button class="wt-key" data-wt-key="F12">F12</button><button class="wt-key" data-wt-key="PrintScreen">Prt</button><button class="wt-key" data-wt-key="ScrollLock">Scr</button><button class="wt-key" data-wt-key="Pause">Pause</button></div>
        <div class="wt-key-row"><button class="wt-key" data-wt-key="&#96;">&#96;</button><button class="wt-key" data-wt-key="1">1</button><button class="wt-key" data-wt-key="2">2</button><button class="wt-key" data-wt-key="3">3</button><button class="wt-key" data-wt-key="4">4</button><button class="wt-key" data-wt-key="5">5</button><button class="wt-key" data-wt-key="6">6</button><button class="wt-key" data-wt-key="7">7</button><button class="wt-key" data-wt-key="8">8</button><button class="wt-key" data-wt-key="9">9</button><button class="wt-key" data-wt-key="0">0</button><button class="wt-key" data-wt-key="-">-</button><button class="wt-key" data-wt-key="=">=</button><button class="wt-key wide" data-wt-key="Backspace">Backspace</button><button class="wt-key" data-wt-key="Insert">Ins</button><button class="wt-key" data-wt-key="Home">Home</button><button class="wt-key" data-wt-key="PageUp">PgUp</button></div>
        <div class="wt-key-row"><button class="wt-key wide" data-wt-key="Tab">Tab</button><button class="wt-key" data-wt-key="q">Q</button><button class="wt-key" data-wt-key="w">W</button><button class="wt-key" data-wt-key="e">E</button><button class="wt-key" data-wt-key="r">R</button><button class="wt-key" data-wt-key="t">T</button><button class="wt-key" data-wt-key="y">Y</button><button class="wt-key" data-wt-key="u">U</button><button class="wt-key" data-wt-key="i">I</button><button class="wt-key" data-wt-key="o">O</button><button class="wt-key" data-wt-key="p">P</button><button class="wt-key" data-wt-key="[">[</button><button class="wt-key" data-wt-key="]">]</button><button class="wt-key" data-wt-key="&#92;">&#92;</button><button class="wt-key" data-wt-key="Delete">Del</button><button class="wt-key" data-wt-key="End">End</button><button class="wt-key" data-wt-key="PageDown">PgDn</button></div>
        <div class="wt-key-row"><button class="wt-key wide mod" data-wt-mod="caps">Caps</button><button class="wt-key" data-wt-key="a">A</button><button class="wt-key" data-wt-key="s">S</button><button class="wt-key" data-wt-key="d">D</button><button class="wt-key" data-wt-key="f">F</button><button class="wt-key" data-wt-key="g">G</button><button class="wt-key" data-wt-key="h">H</button><button class="wt-key" data-wt-key="j">J</button><button class="wt-key" data-wt-key="k">K</button><button class="wt-key" data-wt-key="l">L</button><button class="wt-key" data-wt-key=";">;</button><button class="wt-key" data-wt-key="&#39;">&#39;</button><button class="wt-key xwide" data-wt-key="Enter">Enter</button><button class="wt-key" data-wt-key="ArrowUp">&#8593;</button></div>
        <div class="wt-key-row"><button class="wt-key xwide mod" data-wt-mod="shift">Shift</button><button class="wt-key" data-wt-key="z">Z</button><button class="wt-key" data-wt-key="x">X</button><button class="wt-key" data-wt-key="c">C</button><button class="wt-key" data-wt-key="v">V</button><button class="wt-key" data-wt-key="b">B</button><button class="wt-key" data-wt-key="n">N</button><button class="wt-key" data-wt-key="m">M</button><button class="wt-key" data-wt-key=",">,</button><button class="wt-key" data-wt-key=".">.</button><button class="wt-key" data-wt-key="/">/</button><button class="wt-key xwide mod" data-wt-mod="shift">Shift</button><button class="wt-key" data-wt-key="ArrowLeft">&#8592;</button><button class="wt-key" data-wt-key="ArrowDown">&#8595;</button><button class="wt-key" data-wt-key="ArrowRight">&#8594;</button></div>
        <div class="wt-key-row"><button class="wt-key wide mod" data-wt-mod="ctrl">Ctrl</button><button class="wt-key wide mod" data-wt-mod="meta">Meta</button><button class="wt-key wide mod" data-wt-mod="alt">Alt</button><button class="wt-key space" data-wt-key=" ">Space</button><button class="wt-key wide mod" data-wt-mod="alt">Alt</button><button class="wt-key wide mod" data-wt-mod="ctrl">Ctrl</button></div>
      </div>`;
    document.body.appendChild(panel);

    panel.addEventListener('pointerdown', (event) => event.preventDefault());
    panel.addEventListener('click', (event) => {
      const keyButton = event.target.closest('[data-wt-key]');
      if (keyButton) {
        const data = keyData(keyButton.dataset.wtKey);
        if (writeToPty(data)) {
          try { window.term.focus(); } catch (_) {}
        }
        state.modifiers.clear();
        updateModifierButtons();
        return;
      }
      const modifierButton = event.target.closest('[data-wt-mod]');
      if (!modifierButton) return;
      const modifier = modifierButton.dataset.wtMod;
      if (modifier === 'caps') state.capsLock = !state.capsLock;
      else if (state.modifiers.has(modifier)) state.modifiers.delete(modifier);
      else state.modifiers.add(modifier);
      updateModifierButtons();
    });
    document.getElementById('wt-keyboard-close').addEventListener('click', () => toggle(false));
    window.addEventListener('resize', () => requestAnimationFrame(setPanelHeight));
    window.addEventListener('keydown', (event) => { if (event.key === 'Escape' && state.open) toggle(false); });
  };

  const boot = () => {
    if (document.getElementById('wt-keyboard-panel')) return;
    buildKeyboard();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
