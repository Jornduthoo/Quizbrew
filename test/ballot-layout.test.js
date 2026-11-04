// The drawing round's vote screen with 4, 12, 24 and 40 drawings: every drawing, team name and vote dot stays on
// the screen, clear of the question, on a full HD TV, the same TV with the browser bar and a small laptop.
// Needs Playwright with Chromium; without it the test is skipped. SHOTS=<folder> saves a screenshot of every step.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { io: connect } = require('socket.io-client');
const { createServer } = require('../src/app');
const { problems } = require('./fixtures/screen-problems');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* not installed: skip */ }

const SCREENS = [
  { name: 'tv', width: 1920, height: 1080 },
  { name: 'tv-browserbar', width: 1920, height: 940 },
  { name: 'laptop', width: 1366, height: 768 },
];
const COUNTS = [4, 12, 24, 40];
const PAGE_MS = 600000; // the test turns the pages with the arrow key
const COLORS = require('../src/teams').TEAM_COLORS;
const NO_MOTION = '*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition: none !important; }';

// Runs in the page: the pictures are big enough to see, and stay inside their card with the name and the dots.
// More than 12 drawings turn over in pages of at most 12: every page is checked.
function pictureProblems(min) {
  const out = [];
  const shown = [...document.querySelectorAll('#ballot-grid .ballot-card')].filter(c => !c.classList.contains('off'));
  if (shown.length > 12) out.push(`${shown.length} drawings on one page`);
  const q = document.querySelector('#vote-q').getBoundingClientRect();
  for (const card of shown) {
    const c = card.getBoundingClientRect();
    const letter = card.querySelector('.letter').textContent;
    if (c.top < q.bottom - 2) out.push(`card ${letter} runs under the question`);
    if (c.bottom > innerHeight + 2 || c.right > innerWidth + 2) out.push(`card ${letter} runs off the screen`);
    const img = card.querySelector('img');
    const r = img.getBoundingClientRect();
    if (r.height < min || r.width < min) out.push(`drawing ${letter} is too small (${Math.round(r.width)}x${Math.round(r.height)})`);
    for (const el of card.querySelectorAll('img, .bc-by, .bc-votes')) {
      const e = el.getBoundingClientRect();
      if (e.height && (e.top < c.top - 2 || e.bottom > c.bottom + 2)) out.push(`${el.className || el.tagName} of card ${letter} sticks out of its card`);
    }
  }
  return out;
}

test('drawing round vote screen: 4 to 40 drawings fit under the question', { skip: !chromium && 'Playwright is not installed', timeout: 300000 }, async t => {
  const settingsData = { language: 'nl', sfx: false, look: 'pub' };
  const qb = createServer({ port: 0, settings: { get: k => settingsData[k], set: (k, v) => { settingsData[k] = v; } }, library: require('../src/library').create(fs.mkdtempSync(path.join(os.tmpdir(), 'qb-'))), lanAddresses: () => ['192.168.1.50'] });
  const port = await qb.listen();
  const url = `http://127.0.0.1:${port}`;
  const sockets = [];
  const open = query => { const s = connect(url, { query, transports: ['websocket'], forceNew: true }); sockets.push(s); return s; };
  const browser = await chromium.launch();
  t.after(async () => { sockets.forEach(s => s.close()); await browser.close(); await qb.close(); });
  const shots = process.env.SHOTS;
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const settle = (ms = 400) => new Promise(r => setTimeout(r, ms));
  const failures = [];

  // Drawings like the phones send: upright from a phone, wide from a laptop, neon lines on a dark board.
  const maker = await browser.newPage();
  const drawings = [];
  for (let i = 0; i < 6; i++) {
    const png = await maker.evaluate(i => {
      const c = document.createElement('canvas');
      c.width = 600; c.height = i % 3 === 2 ? 400 : 800;
      const g = c.getContext('2d');
      g.fillStyle = '#1a120c'; g.fillRect(0, 0, c.width, c.height);
      g.lineWidth = 10; g.strokeStyle = ['#7df9ff', '#ffe066', '#ff6bd6', '#8dff8a', '#ff9a3c', '#c9a0ff'][i];
      g.beginPath(); g.arc(c.width / 2, c.height / 3, 80, 0, 7); g.moveTo(c.width / 2, c.height / 3 + 80); g.lineTo(c.width / 2, c.height - 120);
      g.lineTo(c.width / 2 - 90, c.height - 20); g.moveTo(c.width / 2, c.height - 120); g.lineTo(c.width / 2 + 90, c.height - 20); g.stroke();
      return c.toDataURL('image/png').split(',')[1];
    }, i);
    const res = await fetch(`${url}/api/host/media`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: Buffer.from(png, 'base64') });
    drawings.push((await res.json()).url);
  }
  await maker.close();
  assert.ok(drawings.every(d => /^\/media\//.test(d)), 'drawings uploaded');

  const host = open({ role: 'host' });
  let state = null;
  host.on('state', s => { state = s; });
  const pages = [];
  for (const size of SCREENS) {
    const page = await browser.newPage({ viewport: { width: size.width, height: size.height } });
    page.on('pageerror', e => failures.push(`${size.name}: script error ${e.message}`));
    pages.push({ page, size });
  }
  const quiz = { title: 'Drawings', language: 'nl', rounds: [{ type: 'drawGuess', title: 'Teken het', questions: [{ question: 'Teken een bange astronaut die op de maan schrikt van een muis die kaas eet' }] }] };
  const saved = await (await fetch(`${url}/api/host/library/quiz`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quiz }) })).json();

  // Waits (at most a few seconds, the test machine may be busy) until the game is past this phase.
  const phaseLeaves = async (phase, ms = 4000) => {
    for (const end = Date.now() + ms; Date.now() < end; await settle(100)) if (state.phase !== phase) return true;
    return false;
  };
  // Every page of the carousel (turned with the arrow key), and every drawing was on one of them.
  const check = async (step, count) => {
    await settle();
    const perPage = count > 12 ? Math.ceil(count / Math.ceil(count / 12)) : count;
    const pageCount = Math.ceil(count / perPage) + (step.endsWith('reveal') && count > 12 ? 1 : 0);
    for (let p = 0; p < pageCount; p++) {
      if (p) { for (const { page } of pages) await page.keyboard.press('ArrowRight'); await settle(200); }
      await checkPage(`${step}-p${p + 1}`);
    }
    for (const { page, size } of pages) {
      const seen = await page.evaluate(() => window.__seen.size);
      if (seen !== count) failures.push(`${step} @ ${size.name}: only ${seen} of ${count} drawings were on screen`);
    }
  };
  const checkPage = async step => {
    for (const { page, size } of pages) {
      await page.evaluate(() => Promise.all([...document.images].map(i => i.complete || new Promise(r => { i.onload = i.onerror = r; }))));
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      (await page.evaluate(problems)).forEach(p => failures.push(`${step} @ ${size.name}: ${p}`));
      (await page.evaluate(pictureProblems, 60)).forEach(p => failures.push(`${step} @ ${size.name}: ${p}`));
      await page.evaluate(() => { window.__seen = window.__seen || new Set(); document.querySelectorAll('#ballot-grid .ballot-card:not(.off) .letter').forEach(l => window.__seen.add(l.textContent)); });
      if (shots) await page.screenshot({ path: path.join(shots, `${step}-${size.name}.png`) });
    }
  };

  for (const count of COUNTS) {
    { const res = await new Promise(r => host.emit('load', { library: saved.path }, r)); assert.equal(res.ok, true, JSON.stringify([res, saved])); }
    const teams = [];
    for (let i = 0; i < count; i++) {
      const id = 'team' + String(i).padStart(6, '0');
      const s = open({ role: 'player', teamId: id });
      s.on('state', st => { s.last = st; });
      assert.equal((await new Promise(r => s.emit('join', { teamId: id, name: `${i + 1} De Quizzende Kwissers`, color: COLORS[i % COLORS.length] }, r))).ok, true);
      teams.push(s);
    }
    for (const { page } of pages) { await page.goto(`${url}/screen?fx=off&pagems=${PAGE_MS}`); await page.addStyleTag({ content: NO_MOTION }); }
    for (let guard = 0; guard < 6 && state.phase !== 'question'; guard++) { host.emit('next'); await settle(250); }
    assert.equal(state.phase, 'question');
    teams.forEach((s, i) => s.emit('answer', drawings[i % drawings.length]));
    // When every team has sent its drawing the vote starts by itself; only push it on when it did not.
    if (!(await phaseLeaves('question'))) { host.emit('next'); await phaseLeaves('question'); }
    assert.equal(state.phase, 'vote', `${count} drawings go to the vote`);
    await check(`draw-${count}-vote`, count);
    for (const { page } of pages) await page.evaluate(() => { window.__seen = new Set(); });
    // Most teams vote for the first drawing, so one card gets a long row of dots.
    teams.forEach((s, i) => s.emit('vote', i === 0 ? 1 : 0));
    if (!(await phaseLeaves('vote'))) { host.emit('next'); await phaseLeaves('vote'); }
    assert.equal(state.phase, 'reveal');
    await check(`draw-${count}-reveal`, count);
    host.emit('stop');
    teams.forEach(s => s.close());
    await settle();
  }
  assert.deepEqual(failures, []);
});
