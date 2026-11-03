// The big screen and the phone in a real browser: nothing may overlap, stick out or be cut off, with long texts
// and 8 teams, on a full HD TV, on the same TV with the browser bar still showing, and on a small laptop.
// Needs Playwright with Chromium; without it the test is skipped. SHOTS=<folder> also saves a screenshot of every step.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { io: connect } = require('socket.io-client');
const { createServer } = require('../src/app');
const quiz = require('./fixtures/stress-quiz');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* not installed: skip */ }

const SCREENS = [
  { name: 'tv', width: 1920, height: 1080 },
  { name: 'tv-browserbar', width: 1920, height: 940 },
  { name: 'laptop', width: 1366, height: 768 },
];
// 8 teams by default; LAYOUT_TEAMS=18 (up to 24, one per colour) for a big night.
const NAMES = ['Ik ben geslaagd vrr', 'MegaMachtigeMuizen', 'Jorn', 'Voet', 'De Quizzende Kwissers', 'Team Tafel Nummer 7', 'Pubquizpiraten', 'Wablieft Wat Zegt Ge',
  'De Slimme Sloebers', 'Quiz Khalifa', 'Tafel 11', 'Les Cerveaux Fous', 'Die Besserwisser', 'Los Sabelotodos', 'Bier en Bitterballen', 'De Laatste Rij',
  'Kwis Kwis Kwis', 'Antwoord 42', 'De Nerds van Nu', 'Smart Alecs', 'Mama Mia', 'Opa en de Kleinkids', 'Team Onverwacht', 'Wie Is Dit'];
const TEAM_COUNT = Math.min(24, Number(process.env.LAYOUT_TEAMS) || 8);
const TEAMS = NAMES.slice(0, TEAM_COUNT);
const COLORS = require('../src/teams').TEAM_COLORS;
const NO_MOTION = '*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition: none !important; }';

// Runs in the page: every visible block of the current view stays inside the screen and inside its own zone,
// and the zones of the view never overlap each other.
function problems() {
  const out = [];
  const vw = innerWidth, vh = innerHeight, slack = 3;
  const view = [...document.querySelectorAll('.view')].find(v => !v.hidden);
  if (!view) return out;
  const shown = el => el.offsetParent !== null || getComputedStyle(el).position === 'fixed';
  const label = el => el.id ? '#' + el.id : el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : el.tagName;
  const box = el => el.getBoundingClientRect();
  // Corner notes on the end screen are placed on top of the view, but must not cover anything either.
  const zones = [...view.children].filter(el => shown(el) && (el.matches('.made-with, .end-sponsors') || !['absolute', 'fixed'].includes(getComputedStyle(el).position)) && box(el).height > 0);
  for (const z of zones) {
    const r = box(z);
    if (r.left < -slack || r.top < -slack || r.right > vw + slack || r.bottom > vh + slack) out.push(`${label(z)} sticks out of the screen`);
    for (const el of z.querySelectorAll('*')) {
      // Decoration that is meant to stick out a little: the crown on the leader, the scaled art in the medal,
      // the right answer that grows when it lights up.
      if (!shown(el) || el.closest('.crown-wrap, .ri-art, .answer.correct')) continue;
      const e = box(el);
      if (!e.width || !e.height || e.width > vw * 2) continue;
      if (e.left < r.left - slack * 4 || e.right > r.right + slack * 4 || e.top < r.top - slack * 4 || e.bottom > r.bottom + slack * 4) {
        out.push(`${label(el)} (${el.textContent.trim().slice(0, 30)}) sticks out of ${label(z)}`);
        break;
      }
    }
    // Text that does not fit its own box: a word wider than its line, or a list that is cut off.
    for (const el of [z, ...z.querySelectorAll('*')]) {
      if (!shown(el) || el.matches('.ta-name, .ta-answer, .name, .rb-name, .br-name, .team-chip, .ch, .w')) continue;
      if (el.scrollWidth > el.clientWidth + slack && el.clientWidth > 0 && getComputedStyle(el).overflowX !== 'visible') out.push(`${label(el)} is cut off on the side`);
      if (el.scrollHeight > el.clientHeight + slack && el.clientHeight > 0 && getComputedStyle(el).overflowY !== 'visible') out.push(`${label(el)} is cut off at the bottom`);
    }
  }
  // Vote cards: the text and the team name stay inside the card and clear of the letter.
  for (const card of view.querySelectorAll('.ballot-card')) {
    if (!shown(card)) continue;
    const c = box(card);
    const letter = card.querySelector('.letter');
    const l = letter && box(letter);
    for (const el of card.querySelectorAll('.bc-text, .bc-by')) {
      const e = box(el);
      if (!e.height) continue;
      if (e.top < c.top - slack || e.bottom > c.bottom + slack) out.push(`${label(el)} (${el.textContent.trim().slice(0, 30)}) sticks out of its card (${Math.round(e.top - c.top)}/${Math.round(c.bottom - e.bottom)})`);
      else if (l && el.matches('.bc-text') && e.top < l.bottom - slack && e.left < l.right - slack) out.push(`${label(el)} (${el.textContent.trim().slice(0, 30)}) runs under the card letter`);
    }
  }
  for (let i = 0; i < zones.length; i++) {
    for (let j = i + 1; j < zones.length; j++) {
      const a = box(zones[i]), b = box(zones[j]);
      const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (x > slack && y > slack) out.push(`${label(zones[i])} overlaps ${label(zones[j])}`);
    }
  }
  // A title never breaks in the middle of a word.
  for (const w of view.querySelectorAll('.w')) {
    if (!shown(w)) continue;
    const tops = new Set([...w.children].map(c => Math.round(c.getBoundingClientRect().top / 4)));
    if (tops.size > 1) out.push(`the word "${w.textContent}" breaks over two lines`);
    if (w.getBoundingClientRect().right > vw + slack) out.push(`the word "${w.textContent}" sticks out of the screen`);
  }
  return out;
}

// Runs in the phone, host and remote pages: the page never scrolls sideways and no block sticks out on the side.
function pageProblems() {
  const out = [];
  const vw = innerWidth;
  if (document.documentElement.scrollWidth > vw + 2) out.push(`the page scrolls sideways (${document.documentElement.scrollWidth}px wide)`);
  for (const el of document.querySelectorAll('body *')) {
    if (el.offsetParent === null || el.closest('[hidden], .reactions, svg')) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    // Inside a box that scrolls or clips sideways it may be wider; that box is checked itself.
    let p = el.parentElement, clipped = false;
    while (p && p !== document.body) { const o = getComputedStyle(p).overflowX; if (o !== 'visible') { clipped = true; break; } p = p.parentElement; }
    if (!clipped && (r.right > vw + 3 || r.left < -3)) { out.push(`${el.id ? '#' + el.id : el.tagName + '.' + String(el.className).split(' ')[0]} (${el.textContent.trim().slice(0, 24)}) sticks out on the side`); break; }
  }
  const b = document.querySelector('#wait-badge');
  if (b && b.offsetParent && b.classList.contains('filled')) {
    const inner = b.firstElementChild && b.firstElementChild.classList.contains('badge-text') ? b.firstElementChild : null;
    const r = b.getBoundingClientRect();
    const e = inner ? inner.getBoundingClientRect() : null;
    if (inner ? e.width > r.width * 0.9 || e.height > r.height * 0.9 : b.scrollWidth > b.clientWidth + 1) out.push(`the locked answer "${b.textContent}" sticks out of its circle`);
  }
  return out;
}

test('big screen, phone, host and remote: no overlap, nothing sticks out, every round type with long texts and many teams', { skip: !chromium && 'Playwright is not installed', timeout: 900000 }, async t => {
  const settingsData = { language: 'nl', sfx: false };
  const qb = createServer({ port: 0, settings: { get: k => settingsData[k], set: (k, v) => { settingsData[k] = v; } }, library: require('../src/library').create(fs.mkdtempSync(path.join(os.tmpdir(), 'qb-'))), lanAddresses: () => ['192.168.1.50'] });
  const port = await qb.listen();
  const url = `http://127.0.0.1:${port}`;
  const sockets = [];
  const open = query => { const s = connect(url, { query, transports: ['websocket'], forceNew: true }); sockets.push(s); return s; };
  const browser = await chromium.launch();
  t.after(async () => { sockets.forEach(s => s.close()); await browser.close(); await qb.close(); });
  const shots = process.env.SHOTS;
  if (shots) fs.mkdirSync(shots, { recursive: true });

  const host = open({ role: 'host' });
  let state = null;
  host.on('state', s => { state = s; });
  const settle = (ms = 450) => new Promise(r => setTimeout(r, ms));
  const failures = [];

  const pages = [];
  for (const size of SCREENS) {
    const page = await browser.newPage({ viewport: { width: size.width, height: size.height } });
    await page.goto(`${url}/screen?fx=off`);
    await page.addStyleTag({ content: NO_MOTION });
    pages.push({ page, size });
  }
  // One phone of the third team ('Jorn'), the quizmaster's laptop and the remote on a phone.
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await phone.addInitScript(() => localStorage.setItem('qb.teamId', 'team000002'));
  const hostPage = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const remote = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const others = [['phone', phone], ['host', hostPage], ['remote', remote]];
  // A script error on any page is a failure too.
  for (const [name, page] of [...others, ...pages.map(x => [x.size.name, x.page])]) page.on('pageerror', e => failures.push(`${name}: script error ${e.message}`));

  const check = async (step, withOthers = false) => {
    await settle();
    for (const { page, size } of pages) {
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      (await page.evaluate(problems)).forEach(p => failures.push(`${step} @ ${size.name}: ${p}`));
      if (shots) await page.screenshot({ path: path.join(shots, `${step}-${size.name}.png`) });
    }
    if (withOthers) await checkOthers(step);
  };
  const checkOthers = async step => {
    for (const [name, page] of others) {
      (await page.evaluate(pageProblems)).forEach(p => failures.push(`${step} @ ${name}: ${p}`));
      if (shots) await page.screenshot({ path: path.join(shots, `${step}-${name}.png`), fullPage: name === 'host' });
    }
  };
  // What each team answers: long and partly wrong, so the reveal has to show a mix.
  const answerFor = (q, i) => {
    switch (q.kind) {
      case 'choice': return i % (q.answers || [1, 2]).length;
      case 'trueFalse': return i % 2;
      case 'number': return 1000 + i * 77;
      case 'order': return [...Array(q.items.length).keys()];
      case 'pairs': return [...Array(q.left.length).keys()];
      case 'list': return ['Nederland', 'Belgie'];
      case 'point': return { x: 0.1 * (i + 1), y: 0.5 };
      case 'level': return { l: i % 3, i: 0 };
      case 'buzz': return 'buzz';
      default: return i === 2 ? 'Eiffeltoren' : ['de Backstreet Boys', 'Take That en nog wat', 'sinck', 'Olympus Mons', 'Een hele lange foute gok van dit team'][i % 5];
    }
  };

  async function play(quiz, part) {
    const saved = await (await fetch(`${url}/api/host/library/quiz`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quiz }) })).json();
    assert.equal((await new Promise(r => host.emit('load', { library: saved.path }, r))).ok, true);
    const teams = [];
    for (let i = 0; i < TEAMS.length; i++) {
      const id = 'team' + String(i).padStart(6, '0');
      const s = open({ role: 'player', teamId: id });
      s.on('state', st => { s.last = st; });
      assert.equal((await new Promise(r => s.emit('join', { teamId: id, name: TEAMS[i], color: COLORS[i] }, r))).ok, true);
      teams.push(s);
    }
    await phone.goto(`${url}/play?fx=off`);
    await phone.addStyleTag({ content: NO_MOTION });
    await hostPage.goto(`${url}/host?fx=off`);
    await hostPage.addStyleTag({ content: NO_MOTION });
    await remote.goto(`${url}/remote?key=${qb.remoteKey}&fx=off`);
    await remote.addStyleTag({ content: NO_MOTION });
    await check(`${part}-r0-lobby`, true);

    host.emit('next');
    await settle();
    for (let guard = 0; guard < 300 && state && state.phase !== 'end' && state.phase !== 'awards'; guard++) {
      const s = state;
      const step = `${part}-r${String(s.round ? s.round.index + 1 : 0).padStart(2, '0')}-${s.round ? s.round.type : ''}-q${s.questionIndex + 1}-${s.phase}`;
      if (s.phase === 'roundIntro' || s.phase === 'scoreboard' || s.phase === 'vote') await check(step, s.phase === 'roundIntro');
      if (s.phase === 'wager') {
        await check(step);
        teams.forEach((p, i) => { p.emit('wager', 1); p.emit('pick', i % 3); });
      }
      if (s.phase === 'question') {
        await check(step, true);
        // Team 'Jorn' answers first, so its phone shows the locked answer before the reveal.
        for (const i of [2, ...teams.keys()].filter((x, k, all) => all.indexOf(x) === k)) {
          const q = teams[i].last && teams[i].last.question;
          if (q) teams[i].emit('answer', answerFor(q, i));
          if (i === 2) { await settle(); await checkOthers(`${step}-locked`); }
        }
        await settle();
        if (state.phase === 'question' && state.question && state.question.kind === 'turn') host.emit('buzzJudge', true);
        else if (state.phase === 'question' && state.buzz) host.emit('buzzJudge', true);
        await settle();
        if (state.phase === 'question') host.emit('next');
        await settle();
        if (state.phase === 'vote') { await check(step.replace(/question$/, 'vote')); host.emit('next'); await settle(); }
        if (state.phase === 'reveal') await check(step.replace(/question$/, 'reveal'), true);
      }
      host.emit('next');
      await settle();
    }
    if (state.phase === 'awards') { await check(`${part}-r99-awards`); host.emit('next'); await settle(); }
    if (state.phase === 'end') await check(`${part}-r99-end`, true);
    host.emit('stop');
    teams.forEach(s => s.close());
    await settle();
  }

  // LAYOUT_PART=a or b plays only one half (quicker while working on one screen).
  const part = process.env.LAYOUT_PART;
  if (!part || part === 'a') await play(quiz, 'a');
  if (!part || part === 'b') await play(quiz.more, 'b');
  assert.deepEqual(failures, []);
});

module.exports = { problems };
