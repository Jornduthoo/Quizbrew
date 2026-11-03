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

  window.QB = { $, h, showView, LETTERS, teamVar, countdown, info };
})();
