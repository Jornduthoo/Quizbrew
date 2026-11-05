// The bluff round in a real browser with 3, 8, 20 and 40 teams. A small game gets house bluffs; from 9 cards on every
// phone gets its own short list and the big screen shows no cards while the teams choose. At the reveal the cards
// turn one by one (only the top bluffs with many teams) and everything stays on the screen.
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
  { name: 'laptop', width: 1366, height: 768 },
];
const COUNTS = [3, 8, 20, 40];
const COLORS = require('../src/teams').TEAM_COLORS;
const NO_MOTION = '*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition: none !important; }';
const BLUFFS = ['A pigeon', 'The mayor', 'A very small horse', 'Nobody, it was a dare', 'Two monks and a goat', 'A retired astronaut', 'The ship cook', 'A tax inspector'];

test('bluff round: house bluffs, a short list per phone, cards that turn one by one', { skip: !chromium && 'Playwright is not installed', timeout: 300000 }, async t => {
  const settingsData = { language: 'en', sfx: false, look: 'pub' };
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

  const host = open({ role: 'host' });
  let state = null;
  host.on('state', s => { state = s; });
  const pages = [];
  for (const size of SCREENS) {
    const page = await browser.newPage({ viewport: { width: size.width, height: size.height } });
    page.on('pageerror', e => failures.push(`${size.name}: script error ${e.message}`));
    pages.push({ page, size });
  }
  // The phone of the second team.
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  phone.on('pageerror', e => failures.push(`phone: script error ${e.message}`));
  await phone.addInitScript(() => { localStorage.setItem('qb.teamId', 'team000001'); });

  const quiz = { title: 'Bluffs', language: 'en', rounds: [{ type: 'bluffBank', title: 'Bluff', questions: [{
    question: 'Who was the first passenger of the very first hot air balloon flight with living beings on board?',
    answer: 'A sheep, a duck and a rooster', decoys: ['A cat in a basket', 'The inventor\'s neighbour', 'A small brass band'] }] }] };
  const saved = await (await fetch(`${url}/api/host/library/quiz`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quiz }) })).json();
  const phaseLeaves = async (phase, ms = 4000) => {
    for (const end = Date.now() + ms; Date.now() < end; await settle(100)) if (state.phase !== phase) return true;
    return false;
  };
  const shoot = async (step, list = pages) => {
    for (const { page, size } of list) {
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      if (size.name !== 'phone') (await page.evaluate(problems)).forEach(p => failures.push(`${step} @ ${size.name}: ${p}`));
      if (shots) await page.screenshot({ path: path.join(shots, `${step}-${size.name}.png`) });
    }
  };
  const phonePage = [{ page: phone, size: { name: 'phone' } }];

  for (const count of COUNTS) {
    { const res = await new Promise(r => host.emit('load', { library: saved.path }, r)); assert.equal(res.ok, true); }
    const teams = [];
    for (let i = 0; i < count; i++) {
      const id = 'team' + String(i).padStart(6, '0');
      const s = open({ role: 'player', teamId: id });
      s.on('state', st => { s.last = st; });
      assert.equal((await new Promise(r => s.emit('join', { teamId: id, name: `${i + 1} Bluff Barflies`, color: COLORS[i % COLORS.length] }, r))).ok, true);
      teams.push(s);
    }
    // turnms: the cards of the reveal turn fast, so the test sees the end of it.
    for (const { page } of pages) { await page.goto(`${url}/screen?fx=off&turnms=60`); await page.addStyleTag({ content: NO_MOTION }); }
    await phone.goto(`${url}/play?fx=off`);
    await phone.addStyleTag({ content: NO_MOTION });
    for (let guard = 0; guard < 6 && state.phase !== 'question'; guard++) { host.emit('next'); await settle(250); }
    assert.equal(state.phase, 'question');

    // The phone's team types the real answer first: its phone says so.
    if (count === 3) {
      teams[1].emit('answer', 'a sheep, a duck and a rooster');
      await settle();
      const warn = await phone.evaluate(() => { const w = document.querySelector('#type-warn'); return w && !w.hidden ? w.textContent : ''; });
      if (!warn) failures.push('the phone does not say that the real answer is no bluff');
      await shoot('bluff-truth-typed', phonePage);
    }
    teams.forEach((s, i) => s.emit('answer', `${BLUFFS[i % BLUFFS.length]}${i >= BLUFFS.length ? ' ' + (i + 1) : ''}`));
    if (!(await phaseLeaves('question'))) { host.emit('next'); await phaseLeaves('question'); }
    assert.equal(state.phase, 'vote', `${count} bluffs go to the vote`);
    await settle(count > 20 ? 1500 : 600);
    const personal = count + 1 > 9;
    const mine = teams[1].last.ballot;
    if (personal) {
      if (mine.length !== 6) failures.push(`${count} teams: the phone has ${mine.length} answers, not 6`);
      for (const { page, size } of pages) {
        const cards = await page.evaluate(() => document.querySelectorAll('#ballot-grid .ballot-card').length);
        const panel = await page.evaluate(() => !document.querySelector('#vote-phones').hidden);
        if (cards || !panel) failures.push(`${count} teams @ ${size.name}: the big screen shows ${cards} cards while the phones choose`);
      }
    } else if (count === 3 && mine.length !== 7) failures.push(`3 teams: house bluffs do not fill the ballot (${mine.length} cards)`);
    await shoot(`bluff-${count}-vote`);
    await shoot(`bluff-${count}-vote`, phonePage);
    // Most teams fall for the bluff of team 1; the rest spread over their own lists.
    teams.forEach((s, i) => {
      const list = s.last.ballot.filter(b => !b.mine);
      const fav = list.find(b => b.content === BLUFFS[0]);
      s.emit('vote', (i % 3 && fav ? fav : list[i % list.length]).id);
    });
    if (!(await phaseLeaves('vote'))) { host.emit('next'); await phaseLeaves('vote'); }
    assert.equal(state.phase, 'reveal');
    // Wait until every card turned (a busy test machine may be slow), then check.
    for (const { page } of pages) {
      await page.waitForFunction(() => { const c = document.querySelectorAll('#ballot-grid .ballot-card'); return c.length && [...c].every(x => x.classList.contains('turned')); }, null, { timeout: 8000 }).catch(() => {});
    }
    await settle(300);
    for (const { page, size } of pages) {
      const r = await page.evaluate(() => ({
        cards: document.querySelectorAll('#ballot-grid .ballot-card').length,
        turned: document.querySelectorAll('#ballot-grid .ballot-card.turned').length,
        truth: !!document.querySelector('#ballot-grid .ballot-card.is-truth.win'),
        more: document.querySelector('#ballot-more').hidden ? '' : document.querySelector('#ballot-more').textContent,
      }));
      if (r.turned !== r.cards) failures.push(`${count} teams @ ${size.name}: only ${r.turned} of ${r.cards} cards turned`);
      if (!r.truth) failures.push(`${count} teams @ ${size.name}: the truth is not lit at the end`);
      if (personal && r.cards > 6) failures.push(`${count} teams @ ${size.name}: ${r.cards} cards at the reveal`);
      if (personal && !r.more) failures.push(`${count} teams @ ${size.name}: no line for the other bluffs`);
    }
    await shoot(`bluff-${count}-reveal`);
    host.emit('stop');
    teams.forEach(s => s.close());
    await settle();
  }
  assert.deepEqual(failures, []);
});
