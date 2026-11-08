// Every answer and every vote sends a new state to the big screen and to every phone. That may change a counter or
// light a dot, but it must never build the stage again: new cards replay their neon entrance, pictures load again,
// a zoom starts over and the fit jumps, and on a TV that is a flicker on every answer (Jorn's quiz night, Nov 2026).
// Plays a choice, a zoom, an order, a map, a last-one-standing, a bluff and a drawing round; another team answers or votes while the screen and a
// phone (locked in, or still choosing) watch for anything that is built again.
// Needs Playwright with Chromium; without it the test is skipped.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { io: connect } = require('socket.io-client');
const { createServer } = require('../src/app');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* not installed: skip */ }

const COLORS = require('../src/teams').TEAM_COLORS;
const IMG = '/img/look/pub-play.webp';

// Runs in the page: from now on, note every element that is built again, every animation that starts and every
// style the stage gets again. The answered dots, the clocks and the counters may change: that is the point.
function watch() {
  window.__log = [];
  if (window.__watching) return;
  window.__watching = true;
  const name = el => (el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.classList.length ? '.' + [...el.classList].join('.') : ''));
  const free = el => !!el.closest('#answered-dots, #timer, .timer, .mini-head, #team-bar, #reactions, #alerts, .fx-canvas, #ballot-pages');
  document.addEventListener('animationstart', e => { if (!free(e.target)) window.__log.push(`animation ${e.animationName} starts again on ${name(e.target)}`); }, true);
  new MutationObserver(list => list.forEach(m => {
    if (free(m.target)) return;
    if (m.type === 'childList') {
      if ([...m.addedNodes, ...m.removedNodes].some(n => n.nodeType === 1)) window.__log.push(`${name(m.target)} is built again`);
    } else if (m.oldValue !== m.target.getAttribute(m.attributeName) && m.attributeName === 'style') {
      window.__log.push(`${name(m.target)} gets a new style (${String(m.target.getAttribute('style')).slice(0, 60)})`);
    }
  })).observe(document.body, { subtree: true, childList: true, attributes: true, attributeOldValue: true });
}

test('an answer or a vote does not build the big screen or the phone again', { skip: !chromium && 'Playwright is not installed', timeout: 180000 }, async t => {
  const settingsData = { language: 'en', sfx: false, look: 'pub' };
  const qb = createServer({ port: 0, license: require('./fixtures/pro').proLicense(), settings: { get: k => settingsData[k], set: (k, v) => { settingsData[k] = v; } }, library: require('../src/library').create(fs.mkdtempSync(path.join(os.tmpdir(), 'qb-'))), lanAddresses: () => ['192.168.1.50'] });
  const port = await qb.listen();
  const url = `http://127.0.0.1:${port}`;
  const sockets = [];
  const open = query => { const s = connect(url, { query, transports: ['websocket'], forceNew: true }); sockets.push(s); return s; };
  const browser = await chromium.launch();
  t.after(async () => { sockets.forEach(s => s.close()); await browser.close(); await qb.close(); });
  const settle = (ms = 400) => new Promise(r => setTimeout(r, ms));
  const failures = [];

  // A drawing like a phone sends.
  const maker = await browser.newPage();
  const png = await maker.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 300; c.height = 400;
    const g = c.getContext('2d');
    g.fillStyle = '#1a120c'; g.fillRect(0, 0, 300, 400);
    g.strokeStyle = '#7df9ff'; g.lineWidth = 8; g.beginPath(); g.arc(150, 200, 90, 0, 7); g.stroke();
    return c.toDataURL('image/png');
  });
  await maker.close();

  const quiz = { title: 'Steady', language: 'en', rounds: [
    { type: 'classic', title: 'Choice', questions: [{ question: 'Which city is the capital of France?', answers: ['Paris', 'Rome', 'Berlin', 'Madrid'], correct: 0, time: 60 }] },
    { type: 'zoomOut', title: 'Zoom', questions: [{ question: 'What do you see?', answer: 'A pub', image: IMG, time: 60 }] },
    { type: 'orderUp', title: 'Order', questions: [{ question: 'Oldest first', items: ['One', 'Two', 'Three', 'Four'], time: 60 }] },
    { type: 'mapDrop', title: 'Map', questions: [{ question: 'Where is the pub?', image: IMG, spot: { x: 0.4, y: 0.6 }, answer: 'Here', time: 60 }] },
    { type: 'lastStanding', title: 'Last one', questions: [{ question: 'Which city is the capital of Italy?', answers: ['Paris', 'Rome', 'Berlin', 'Madrid'], correct: 1, time: 60 }] },
    { type: 'bluffBank', title: 'Bluff', questions: [{ question: 'Which animal has cube-shaped droppings?', answer: 'The wombat', time: 60 }] },
    { type: 'drawGuess', title: 'Draw', questions: [{ question: 'Draw a cat on a bike', time: 60 }] },
  ] };
  const saved = await (await fetch(`${url}/api/host/library/quiz`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quiz }) })).json();
  const host = open({ role: 'host' });
  let state = null;
  host.on('state', s => { state = s; });
  assert.equal((await new Promise(r => host.emit('load', { library: saved.path }, r))).ok, true);

  const teams = [];
  for (let i = 0; i < 4; i++) {
    const id = 'team' + String(i).padStart(6, '0');
    const s = open({ role: 'player', teamId: id });
    s.on('state', st => { s.last = st; });
    assert.equal((await new Promise(r => s.emit('join', { teamId: id, name: `Team ${i + 1}`, color: COLORS[i] }, r))).ok, true);
    teams.push(s);
  }
  const screen = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  // A second phone of team 1: it sees its own team's answer and everybody else's.
  const phone = await browser.newPage({ viewport: { width: 390, height: 800 } });
  await phone.addInitScript(() => localStorage.setItem('qb.teamId', 'team000000'));
  for (const page of [screen, phone]) page.on('pageerror', e => failures.push(`script error ${e.message}`));
  await screen.goto(`${url}/screen?fx=off`);
  await phone.goto(`${url}/play?fx=off`);
  await settle(800);

  const answerFor = (q, i) => (q.kind === 'choice' ? i % 4 : q.kind === 'order' ? [0, 1, 2, 3] : q.kind === 'point' ? { x: 0.3, y: 0.3 } : q.kind === 'draw' ? png : `Answer ${i + 1}`);
  // Another team answers or votes; nothing on the screen or the phone may be built again.
  const steady = async (step, act) => {
    // Let the entrance animations finish first.
    await settle(2600);
    await screen.evaluate(watch);
    await phone.evaluate(watch);
    act();
    await settle(900);
    for (const [name, page] of [['screen', screen], ['phone', phone]]) {
      for (const line of new Set(await page.evaluate(() => window.__log))) failures.push(`${step} @ ${name}: ${line}`);
    }
  };

  host.emit('next');
  await settle();
  for (let guard = 0; guard < 40 && state.phase !== 'end' && state.phase !== 'awards'; guard++) {
    if (state.phase === 'question') {
      const step = `${state.round.type}-${state.phase}`;
      const q = () => teams[1].last.question;
      // Team 1 is still choosing while team 2 answers; then team 1 is locked in while team 3 answers.
      await steady(`${step} (choosing)`, () => teams[1].emit('answer', answerFor(q(), 1)));
      teams[0].emit('answer', answerFor(teams[0].last.question, 0));
      await steady(`${step} (locked in)`, () => teams[2].emit('answer', answerFor(teams[2].last.question, 2)));
      teams[3].emit('answer', answerFor(teams[3].last.question, 3));
      for (let k = 0; k < 20 && state.phase === 'question'; k++) await settle(100);
      if (state.phase === 'question') { host.emit('next'); await settle(); }
      continue;
    }
    if (state.phase === 'vote') {
      const pick = s => (s.last.ballot.find(b => !b.mine) || {}).id;
      await steady(`${state.round.type}-vote`, () => teams[1].emit('vote', pick(teams[1])));
      teams.forEach(s => s.emit('vote', pick(s)));
      for (let k = 0; k < 20 && state.phase === 'vote'; k++) await settle(100);
      if (state.phase === 'vote') { host.emit('next'); await settle(); }
      continue;
    }
    host.emit('next');
    await settle(300);
  }
  host.emit('stop');
  assert.deepEqual(failures, []);
});
