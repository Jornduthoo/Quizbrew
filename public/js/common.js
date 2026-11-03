// Small helpers shared by the host, the big screen and the phone.
(function () {
  const $ = sel => document.querySelector(sel);

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : String(c));
    return el;
  }

  // Show the one view that matches the phase; question and reveal share a view.
  function showView(phase, map) {
    const id = (map && map[phase]) || phase;
    document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== 'v-' + id; });
    document.body.dataset.phase = phase;
  }

  const LETTERS = ['A', 'B', 'C', 'D'];
  const teamVar = color => `--c: var(--team-${color})`;

  // Countdown that follows the server: remaining ms at the moment the state arrived.
  function countdown(remainingMs, totalMs, onTick) {
    const end = performance.now() + remainingMs;
    let raf = 0;
    const tick = () => {
      const left = Math.max(0, end - performance.now());
      onTick(left, totalMs ? left / totalMs : 0);
      if (left > 0) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }

  async function info() {
    const res = await fetch('/api/info');
    return res.json();
  }

  // Each round type has its own neon colour and icon, used by round intros and headers.
  // Add a new round type here and it gets a themed intro everywhere. Icons are 24x24 line drawings.
  const ROUND_THEMES = {
    classic: { glow: '#ffb43c', icon: '<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/>' },
    open: { glow: '#3ee6ff', icon: '<path d="M4 4h16v12H10l-5 4v-4H4z"/><path d="M10 8.5a2 2 0 1 1 3 1.7c-.7.4-1 .9-1 1.6"/><path d="M12 14v.01"/>' },
    picture: { glow: '#ff4fa3', icon: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 8"/>' },
    music: { glow: '#b07cff', icon: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>' },
    speed: { glow: '#a8ff3e', icon: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>' },
    drawGuess: { glow: '#ff7a2e', icon: '<path d="M4 20l4-1L19 8l-3-3L5 16z"/><path d="M14 7l3 3"/>' },
    puzzle: { glow: '#2fe0b8', icon: '<path d="M4 7h4a2 2 0 1 1 4 0h4v4a2 2 0 1 1 0 4v5H4v-5a2 2 0 1 0 0-4z"/>' },
    trueFalse: { glow: '#5dff9a', icon: '<path d="M4 12l4 4 8-9"/><path d="M15 15l5 5M20 15l-5 5"/>' },
    closest: { glow: '#ffe94a', icon: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>' },
    zoomOut: { glow: '#4f8bff', icon: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21M7.5 10.5h6"/>' },
    scramble: { glow: '#2fe0b8', icon: '<rect x="2.5" y="7" width="6" height="6" rx="1.2"/><rect x="9" y="11" width="6" height="6" rx="1.2"/><rect x="15.5" y="6" width="6" height="6" rx="1.2"/><path d="M5.5 16.5v3h4"/>' },
    commonThread: { glow: '#9dffd6', icon: '<circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="18" r="2"/><circle cx="12" cy="12" r="2.5"/><path d="M7 7l3 3.5M17 7l-3 3.5M7 17l3-3.5M17 17l-3-3.5"/>' },
    jackpot: { glow: '#ffcf3c', icon: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v4c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 10v4c0 1.7 3.1 3 7 3s7-1.3 7-3v-4"/><path d="M5 14v4c0 1.7 3.1 3 7 3s7-1.3 7-3v-4"/>' },
    lastStanding: { glow: '#ff4a4a', icon: '<path d="M6 3h12M6 21h12M7 3c0 6 10 6 10 9s-10 3-10 9M17 3c0 6-10 6-10 9s10 3 10 9"/>' },
  };
  const roundTheme = type => ROUND_THEMES[type] || ROUND_THEMES.classic;
  const CROWN = '<svg class="crown" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18l1.5-11 5 5L12 4l2.5 8 5-5L21 18z"/><path d="M3.5 21h17"/></svg>';

  // Put each letter (or word) in its own span with --i, so CSS can light them up one by one.
  function split(el, text, by) {
    const parts = by === 'word' ? text.split(/(\s+)/) : Array.from(text);
    let i = 0;
    el.replaceChildren(...parts.map(p => (/^\s+$/.test(p) ? document.createTextNode(p) : h('span', { class: 'ch', style: `--i: ${i++}` }, p))));
    el.style.setProperty('--n', i);
    el.setAttribute('aria-label', text);
  }

  // Count a number up in an element, with an ease-out. Respects the effects level.
  function countUp(el, to, ms, delay) {
    const from = 0;
    if (!window.FX || FX.quality === 'off' || !to) { el.textContent = to; return; }
    el.textContent = from;
    setTimeout(() => {
      const start = performance.now();
      const step = now => {
        const k = Math.min(1, (now - start) / ms);
        el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }, delay || 0);
  }

  // Timeouts that belong to one screen; clear them when the screen changes.
  const timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const clearLater = () => { while (timers.length) clearTimeout(timers.pop()); };

  window.QB = { $, h, showView, LETTERS, teamVar, countdown, info, ROUND_THEMES, roundTheme, CROWN, split, countUp, later, clearLater };
})();
