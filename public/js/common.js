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
  // A letter for each vote card: A to Z, then AA, AB… for a big night with more than 26 teams.
  const cardLetter = i => (i >= 26 ? cardLetter(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26));
  // Reactions a phone can send to the big screen. The server only takes an index into this list.
  const REACTIONS = ['\u{1F602}', '\u{1F525}', '\u{1F631}', '\u{1F44F}', '\u{1F340}'];
  const teamVar = color => `--c: var(--team-${color})`;
  // The team's dot, or its photo in a ring of its colour when it took one.
  function dot(team) {
    const el = h('span', { class: 'team-dot' + (team && team.photo ? ' photo' : '') });
    if (team && team.photo && /^\/media\/[\w.-]+$/.test(team.photo)) el.style.backgroundImage = `url("${team.photo}")`;
    return el;
  }

  // Twists stay in sight during the whole round: a glowing chip per twist, with what it means right now.
  // phone: true uses the phone's own words (what the team must do), and `me` knows the team's state.
  const TWIST_ICON = { double: '×2', lockdown: '🔒', blackout: '🌑', underdog: '🐾', mysteryCategory: '❓', suddenDeath: '💥', shrinkingOptions: '⏳', lifeline: '🛟', silentRound: '🤫' };
  function twistChips(s, { phone = false } = {}) {
    if (!s.round || !s.round.twists || !s.round.twists.length) return [];
    return s.round.twists.map(tw => {
      let text = t(`twist.${tw}`);
      const under = s.round.underdogs || [];
      if (tw === 'underdog' && phone) text = s.underdog ? t('play.tw.underdogMe') : under.length ? t('twist.underdogFor', { names: under.map(x => x.name).join(', ') }) : text;
      else if (tw === 'underdog' && under.length) text = t('twist.underdogFor', { names: under.map(x => x.name).join(', ') });
      else if (phone && ['lockdown', 'blackout', 'suddenDeath'].includes(tw)) text = t(`play.tw.${tw}`);
      if (tw === 'shrinkingOptions' && s.phase === 'question' && s.question && s.question.kind === 'choice' && s.question.points > 1 && s.question.answers) {
        const n = s.question.answers.length;
        text = t('twist.shrinkNow', { n: Math.max(1, Math.round(s.question.points * (n - (s.question.gone || []).length) / n)) });
      }
      return h('span', { class: `twist-chip tw-${tw}` }, h('i', { 'aria-hidden': 'true' }, TWIST_ICON[tw] || '✦'), h('span', {}, text));
    });
  }

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

  // 9:05 from milliseconds (rounded up, so the clock never shows 0:00 too early).
  function mmss(ms) {
    const sec = Math.ceil(Math.max(0, ms) / 1000);
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  }

  async function info() {
    const res = await fetch('/api/info');
    const data = await res.json();
    applyLook(data.look);
    return data;
  }

  // The look (pub, space, jungle...) is set by the quizmaster and followed by every screen.
  // The last one is remembered, so a page does not flash in the wrong look while it loads.
  function applyLook(look) {
    if (!look || !/^[a-z]+$/.test(look)) return;
    document.documentElement.dataset.look = look;
    try { localStorage.setItem('qb.look', look); } catch { /* private mode */ }
  }
  try { applyLook(localStorage.getItem('qb.look') || 'pub'); } catch { applyLook('pub'); }
  // Every socket a page opens follows look changes live.
  if (window.io) {
    const connect = window.io;
    window.io = function (...args) {
      const socket = connect(...args);
      socket.on('look', applyLook);
      return socket;
    };
    Object.assign(window.io, connect);
  }

  // Each round type has its own neon colour and icon, used by round intros and headers.
  // Add a new round type here and it gets a themed intro everywhere. Icons are 24x24 line drawings.
  const ROUND_THEMES = {
    classic: { glow: '#ffb43c', icon: '<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/>' },
    open: { glow: '#3ee6ff', icon: '<path d="M4 4h16v12H10l-5 4v-4H4z"/><path d="M10 8.5a2 2 0 1 1 3 1.7c-.7.4-1 .9-1 1.6"/><path d="M12 14v.01"/>' },
    picture: { glow: '#ff4fa3', icon: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 8"/>' },
    music: { glow: '#b07cff', icon: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>' },
    speed: { glow: '#a8ff3e', icon: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>' },
    puzzle: { glow: '#2fe0b8', icon: '<path d="M4 7h4a2 2 0 1 1 4 0h4v4a2 2 0 1 1 0 4v5H4v-5a2 2 0 1 0 0-4z"/>' },
    trueFalse: { glow: '#5dff9a', icon: '<path d="M4 12l4 4 8-9"/><path d="M15 15l5 5M20 15l-5 5"/>' },
    closest: { glow: '#ffe94a', icon: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>' },
    zoomOut: { glow: '#4f8bff', icon: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21M7.5 10.5h6"/>' },
    scramble: { glow: '#2fe0b8', icon: '<rect x="2.5" y="7" width="6" height="6" rx="1.2"/><rect x="9" y="11" width="6" height="6" rx="1.2"/><rect x="15.5" y="6" width="6" height="6" rx="1.2"/><path d="M5.5 16.5v3h4"/>' },
    commonThread: { glow: '#9dffd6', icon: '<circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="18" r="2"/><circle cx="12" cy="12" r="2.5"/><path d="M7 7l3 3.5M17 7l-3 3.5M7 17l3-3.5M17 17l-3-3.5"/>' },
    jackpot: { glow: '#ffcf3c', icon: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v4c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 10v4c0 1.7 3.1 3 7 3s7-1.3 7-3v-4"/><path d="M5 14v4c0 1.7 3.1 3 7 3s7-1.3 7-3v-4"/>' },
    introSprint: { glow: '#ff4fa3', icon: '<path d="M3 12h3l2-5 3 10 3-14 3 12 2-3h2"/>' },
    rewind: { glow: '#3ee6ff', icon: '<path d="M11 6l-7 6 7 6zM20 6l-7 6 7 6z"/>' },
    soundCheck: { glow: '#a8ff3e', icon: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>' },
    lyricGap: { glow: '#ffa3c4', icon: '<path d="M4 7h10M4 12h4M14 12h6M4 17h12"/><path d="M9 11.5h4" stroke-dasharray="1.5 1.5"/>' },
    pixelFog: { glow: '#4f8bff', icon: '<rect x="3" y="3" width="6" height="6"/><rect x="9" y="9" width="6" height="6"/><rect x="15" y="3" width="6" height="6"/><rect x="3" y="15" width="6" height="6"/><rect x="15" y="15" width="6" height="6"/>' },
    silhouette: { glow: '#b07cff', icon: '<circle cx="12" cy="7" r="3.5"/><path d="M5 21c0-4 3-7 7-7s7 3 7 7z"/>' },
    oddOneOut: { glow: '#ff7a2e', icon: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><circle cx="17.5" cy="17.5" r="3.5"/>' },
    emoji: { glow: '#ffe94a', icon: '<circle cx="12" cy="12" r="9"/><path d="M8 14.5c1 1.5 2.4 2.3 4 2.3s3-.8 4-2.3"/><path d="M9 9.5v.01M15 9.5v.01"/>' },
    orderUp: { glow: '#2fe0b8', icon: '<path d="M4 6h3M4 12h3M4 18h3"/><path d="M10 6h10M10 12h7M10 18h4"/>' },
    pairUp: { glow: '#9dffd6', icon: '<circle cx="5" cy="6" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="19" cy="18" r="2"/><path d="M7 6l10 12M7 18L17 6"/>' },
    mapDrop: { glow: '#ff4a4a', icon: '<path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>' },
    lastStanding: { glow: '#ff4a4a', icon: '<path d="M6 3h12M6 21h12M7 3c0 6 10 6 10 9s-10 3-10 9M17 3c0 6-10 6-10 9s10 3 10 9"/>' },
    buzzer: { glow: '#ff3d6e', icon: '<path d="M5 17h14"/><path d="M7 17a5 5 0 0 1 10 0"/><path d="M12 9V5M7.5 10.5L5 8M16.5 10.5L19 8"/><path d="M4 20h16"/>' },
    pushYourLuck: { glow: '#ffcf3c', icon: '<path d="M7 20h10l-1-9H8z"/><path d="M9 11V8a3 3 0 0 1 6 0v3"/><path d="M12 14v3"/>' },
    steal: { glow: '#b07cff', icon: '<path d="M4 8c2-2 5-3 8-3s6 1 8 3"/><path d="M6 12h12l-1.5 7h-9z"/><path d="M10 15h4"/>' },
    pickYourLevel: { glow: '#4f8bff', icon: '<path d="M4 20v-4h4v4M10 20v-9h4v9M16 20V5h4v15"/>' },
    hotStreak: { glow: '#ff7a2e', icon: '<path d="M12 21c-4 0-7-3-7-7 0-3 2-5 3-7 1 2 2 3 3 3 0-3 1-5 4-7 0 4 4 6 4 11 0 4-3 7-7 7z"/>' },
    listRush: { glow: '#a8ff3e', icon: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>' },
    drawGuess: { glow: '#ff4fa3', icon: '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/>' },
    captionThis: { glow: '#ffe94a', icon: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M7 20h10M9 9h6M9 12h4"/>' },
    bluffBank: { glow: '#b07cff', icon: '<path d="M4 9c2-4 14-4 16 0-2 4-14 4-16 0z"/><circle cx="12" cy="9" r="2"/><path d="M8 17c2 2 6 2 8 0"/>' },
    actItOut: { glow: '#ff7a2e', icon: '<circle cx="12" cy="5" r="2.5"/><path d="M12 8v6M12 14l-4 6M12 14l4 6M6 10l6 1 6-3"/>' },
    photoHunt: { glow: '#3ee6ff', icon: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>' },
    whosWho: { glow: '#2fe0b8', icon: '<circle cx="8" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><path d="M3 19c0-3 2.5-5 5-5M21 19c0-3-2.5-5-5-5"/><path d="M11 16h2"/>' },
    stakeIt: { glow: '#ffcf3c', icon: '<circle cx="9" cy="9" r="5"/><path d="M14.5 6.5a5 5 0 1 1-5 9"/><path d="M9 7v4M7.5 8.5h3"/>' },
    localLegend: { glow: '#ff9a3c', icon: '<path d="M4 20h16"/><path d="M6 20V10l6-5 6 5v10"/><path d="M10 20v-5h4v5"/>' },
    wordWeb: { glow: '#c9a2ff', icon: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><path d="M10 6.5h4M6.5 10v4M17.5 10v4M10 17.5h4"/>' },
    clueLadder: { glow: '#9dffd6', icon: '<path d="M7 3v18M17 3v18M7 7h10M7 12h10M7 17h10"/>' },
    fiveFacts: { glow: '#5dff9a', icon: '<path d="M6 4h12v16H6z"/><path d="M9 8h6M9 12h6M9 16h3"/>' },
    clipRecall: { glow: '#4f8bff', icon: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/>' },
    opponentsPick: { glow: '#ff4fa3', icon: '<path d="M8 12V5a1.5 1.5 0 0 1 3 0v6"/><path d="M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V6a1.5 1.5 0 0 1 3 0v7c0 4-3 7-6 7s-5-2-6-5l-1.5-3a1.5 1.5 0 0 1 2.6-1.4L8 12"/>' },
    headToHead: { glow: '#ff3d6e', icon: '<circle cx="6" cy="8" r="3"/><circle cx="18" cy="8" r="3"/><path d="M2 20c0-3 2-5 4-5M22 20c0-3-2-5-4-5M10 13l4 4M14 13l-4 4"/>' },
    clockBank: { glow: '#3ee6ff', icon: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M10 2h4"/>' },
    clockDuel: { glow: '#ff7a2e', icon: '<circle cx="7" cy="14" r="5"/><circle cx="17" cy="14" r="5"/><path d="M7 12v2h2M17 12v2h-2M6 5h2M16 5h2"/>' },
    crowdMind: { glow: '#3ee6ff', icon: '<circle cx="12" cy="7" r="3"/><circle cx="5" cy="10" r="2.2"/><circle cx="19" cy="10" r="2.2"/><path d="M7 20c0-3 2-5 5-5s5 2 5 5M1.5 19c0-2.5 1.5-4 3.5-4M22.5 19c0-2.5-1.5-4-3.5-4"/>' },
  };
  const roundTheme = type => ROUND_THEMES[type] || ROUND_THEMES.classic;
  const CROWN = '<svg class="crown" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18l1.5-11 5 5L12 4l2.5 8 5-5L21 18z"/><path d="M3.5 21h17"/></svg>';

  // Put each letter (or word) in its own span with --i, so CSS can light them up one by one.
  // Letters stay together in a word (.w), so a title only wraps between words, never inside one.
  function split(el, text, by) {
    const parts = String(text).split(/(\s+)/).filter(Boolean);
    let i = 0;
    el.replaceChildren(...parts.map(p => {
      if (/^\s+$/.test(p)) return document.createTextNode(' ');
      if (by === 'word') return h('span', { class: 'ch', style: `--i: ${i++}` }, p);
      return h('span', { class: 'w' }, Array.from(p).map(c => h('span', { class: 'ch', style: `--i: ${i++}` }, c)));
    }));
    el.style.setProperty('--n', i);
    el.setAttribute('aria-label', text);
  }

  // Make text smaller until it fits its box: no word sticks out on the side, and at most `lines` lines
  // (or at most `height` pixels). Sizes in em inside the element shrink along. Returns the scale used.
  function fit(el, { lines = 0, height = 0, min = 0.4 } = {}) {
    if (!el) return 1;
    el.style.fontSize = '';
    if (el.offsetParent === null) return 1;
    const base = parseFloat(getComputedStyle(el).fontSize);
    let size = base;
    const tooBig = () => {
      if (el.scrollWidth > el.clientWidth + 1) return true;
      if (height && el.scrollHeight > height + 1) return true;
      if (lines) {
        const lh = parseFloat(getComputedStyle(el).lineHeight) || size * 1.15;
        if (el.scrollHeight > lh * lines + lh * 0.5) return true;
      }
      return false;
    };
    while (size > base * min && tooBig()) {
      size *= 0.92;
      el.style.fontSize = size + 'px';
    }
    return size / base;
  }

  // A team name is always shown in full: first a little smaller on one line, then over two lines (smaller if
  // needed), and only cut off with … as a last resort. The name element needs the class .tn (see base.css).
  // Sizes are in em, so a list that shrinks afterwards keeps its names fitting.
  // `one`: how much smaller a name may get on one line before it goes over two lines.
  function fitName(el, { min = 0.55, one = 0.8 } = {}) {
    if (!el || el.offsetParent === null) return;
    el.style.fontSize = '';
    el.classList.remove('two', 'break', 'cut');
    const wide = () => el.scrollWidth > el.clientWidth + 1;
    // Measured without a line clamp: more than two lines is too high.
    const high = () => el.scrollHeight > parseFloat(getComputedStyle(el).lineHeight) * 2.5;
    let scale = 1;
    const set = v => { scale = v; el.style.fontSize = v + 'em'; };
    while (wide() && scale > one) set(scale * 0.95);
    if (!wide()) return;
    // Two lines, broken between words.
    el.classList.add('two');
    set(1);
    while ((high() || wide()) && scale > Math.max(min, 0.7)) set(scale * 0.94);
    if (!high() && !wide()) return;
    // One word is too long for the line: it may break, so the name stays readable.
    if (wide()) { el.classList.add('break'); set(Math.max(scale, one)); }
    while (high() && scale > min) set(scale * 0.94);
    if (high() || wide()) el.classList.add('cut');
  }
  function fitNames(root, sel = '.tn', opts) {
    if (root) root.querySelectorAll(sel).forEach(el => fitName(el, opts));
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

    // A random one-liner from a group (quip.<group>.1, .2, ...), written per language, not translated.
  function quip(group, vars) {
    const keys = Object.keys(I18n.dict).filter(k => k.startsWith('quip.' + group + '.'));
    return keys.length ? t(keys[(Math.random() * keys.length) | 0], vars) : '';
  }

  window.QB = { twistChips, quip, applyLook, $, h, showView, LETTERS, cardLetter, REACTIONS, teamVar, dot, countdown, mmss, info, ROUND_THEMES, roundTheme, CROWN, split, fit, fitName, fitNames, countUp, later, clearLater };
})();
