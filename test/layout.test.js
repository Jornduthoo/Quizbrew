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
// 8 teams by default; LAYOUT_TEAMS=18 (up to 40; past 24 colours are shared) for a big night.
const NAMES = ['Kben weer gescheiden', 'Supercalifragilistic', 'Jorn', 'Voet', 'De Quizzende Kwissers', 'Team Tafel Nummer 7', 'Pubquizpiraten', 'Wablieft Wat Zegt Ge',
  'De Slimme Sloebers', 'Quiz Khalifa', 'Tafel 11', 'Les Cerveaux Fous', 'Die Besserwisser', 'Los Sabelotodos', 'Bier en Bitterballen', 'De Laatste Rij',
  'Kwis Kwis Kwis', 'Antwoord 42', 'De Nerds van Nu', 'Smart Alecs', 'Mama Mia', 'Opa en de Kleinkids', 'Team Onverwacht', 'Wie Is Dit',
  'Hersenkrakers', 'De Buren', 'Tafel Plezier', 'Quizzly Bears', 'Les Malins', 'Die Füchse', 'Los Listos', 'De Gouden Gans',
  'Collega\'s van Boven', 'De Wiskunde Club', 'Bijna Gewonnen', 'Te Laat Gekomen', 'Altijd Tweede', 'De Kantine', 'Wilde Weetjes', 'Laatste Ronde'];
const TEAM_COUNT = Math.min(40, Number(process.env.LAYOUT_TEAMS) || 8);
const TEAMS = NAMES.slice(0, TEAM_COUNT);
const COLORS = require('../src/teams').TEAM_COLORS;
const NO_MOTION = '*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition: none !important; }';

const { problems } = require('./fixtures/screen-problems');

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
  // The answer buttons fit the phone: nobody has to scroll to find answer D.
  const qv = document.querySelector('#v-question');
  if (qv && !qv.hidden && qv.scrollHeight > innerHeight + 2) out.push(`the answer buttons do not fit the phone (${qv.scrollHeight}px high)`);
  const b = document.querySelector('#wait-badge');
  if (b && b.offsetParent && b.classList.contains('filled')) {
    const inner = b.firstElementChild && b.firstElementChild.classList.contains('badge-text') ? b.firstElementChild : null;
    const r = b.getBoundingClientRect();
    const e = inner ? inner.getBoundingClientRect() : null;
    const clipped = inner && inner.scrollWidth > inner.clientWidth + 1;
    if (clipped || (inner ? e.width > r.width * 0.9 || e.height > r.height * 0.9 : b.scrollWidth > b.clientWidth + 1)) out.push(`the locked answer "${b.textContent}" sticks out of its circle`);
  }
  return out;
}

test('big screen, phone, host and remote: no overlap, nothing sticks out, every round type with long texts and many teams', { skip: !chromium && 'Playwright is not installed', timeout: 2400000 }, async t => {
  // LAYOUT_LOOK=<look> checks the layout with that look's font (each display font has its own width).
  const settingsData = { language: 'nl', sfx: false, look: process.env.LAYOUT_LOOK || 'pub' };
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
  // With big text on, like a phone held at arm's length: the locked answer must still fit its circle.
  await phone.addInitScript(() => { localStorage.setItem('qb.teamId', 'team000002'); localStorage.setItem('qb.bigText', '1'); });
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
      case 'groups': return { groups: Array.from({ length: q.groupCount }, (_, g) => [0, 1, 2, 3].map(k => (g * 4 + k + i) % (q.groupCount * 4))), links: ['Rivieren in Europa', 'Planeten', 'Een hele lange foute gok van dit team'] };
      case 'list': return ['Nederland', 'Belgie', 'Frankrijk', 'Een heel lang land dat niet bestaat'].slice(0, 1 + i % 4);
      case 'point': return { x: 0.05 + 0.9 * (i % 10) / 9, y: 0.2 + 0.15 * (i % 5) };
      case 'level': return { l: i % 3, i: 0 };
      case 'buzz': return 'buzz';
      case 'draw': case 'photo': return media.pictures[i % media.pictures.length];
      default: return i === 2 ? 'Broodje eekhoorntjes' : ['de Backstreet Boys', 'Take That en nog wat', 'sinck', 'Olympus Mons', 'Een hele lange foute gok van dit team', 'Het Atomium in Brussel of toch de Eiffeltoren'][i % 6];
    }
  };

  // Part c needs real files: one second of sound, a clip and drawings / photos like the phones send.
  const media = { video: '/img/awake.mp4', pictures: [] };
  const post = async (body, type) => (await (await fetch(`${url}/api/host/media`, { method: 'POST', headers: { 'Content-Type': type }, body })).json()).url;
  async function upload() {
    const rate = 8000, n = rate;
    const wav = Buffer.alloc(44 + n * 2);
    wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 2, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(n * 2, 40);
    for (let k = 0; k < n; k++) wav.writeInt16LE(Math.round(Math.sin(k / 8) * 3000), 44 + k * 2);
    media.audio = await post(wav, 'audio/wav');
    const maker = await browser.newPage();
    for (let i = 0; i < 4; i++) {
      const png = await maker.evaluate(i => {
        const c = document.createElement('canvas');
        c.width = 600; c.height = i % 2 ? 400 : 800;
        const g = c.getContext('2d');
        g.fillStyle = '#1a120c'; g.fillRect(0, 0, c.width, c.height);
        g.lineWidth = 10; g.strokeStyle = ['#7df9ff', '#ffe066', '#ff6bd6', '#8dff8a'][i];
        g.beginPath(); g.arc(c.width / 2, c.height / 2, 120, 0, 7); g.stroke();
        return c.toDataURL('image/png').split(',')[1];
      }, i);
      media.pictures.push(await post(Buffer.from(png, 'base64'), 'image/png'));
    }
    await maker.close();
    assert.ok(media.audio && media.pictures.every(Boolean), 'media uploaded');
  }

  async function play(quiz, part) {
    const saved = await (await fetch(`${url}/api/host/library/quiz`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quiz }) })).json();
    assert.equal((await new Promise(r => host.emit('load', { library: saved.path }, r))).ok, true);
    const teams = [];
    for (let i = 0; i < TEAMS.length; i++) {
      const id = 'team' + String(i).padStart(6, '0');
      const s = open({ role: 'player', teamId: id });
      s.on('state', st => { s.last = st; });
      assert.equal((await new Promise(r => s.emit('join', { teamId: id, name: TEAMS[i], color: COLORS[i % COLORS.length] }, r))).ok, true);
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
          // A list is sent one line at a time, like the phone does.
          if (q) [].concat(q.kind === 'list' ? answerFor(q, i) : [answerFor(q, i)]).forEach(a => teams[i].emit('answer', a));
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

  // LAYOUT_PART=a, b or c plays only one part (quicker while working on one screen).
  const part = process.env.LAYOUT_PART;
  if (!part || part === 'a') await play(quiz, 'a');
  if (!part || part === 'b') await play(quiz.more, 'b');
  if (!part || part === 'c') {
    await upload();
    await play(quiz.media(media), 'c');
  }
  assert.deepEqual(failures, []);
});

