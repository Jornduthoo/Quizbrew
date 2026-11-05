// The 10 Microsoft Store screenshots (1920x1080) in every language: the big screen with a phone, then the special rounds
// and two looks. Run from the repo root: node website/tools/store-shots.js [lang|all] [out dir]
// Writes <out>/<lang>/01-combo.png ... 10-stadion.png (default out: a temp folder, printed at the end).
// Needs Playwright with Chromium. Pictures are drawn from emoji and on a canvas, so no internet is needed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { io: connect } = require('socket.io-client');
const { createServer } = require('../../src/app');
const ai = require('../../src/ai');
const L = require('./shot-lang');

const ROOT = path.join(__dirname, '..', '..');
const [langArg = 'all', outArg] = process.argv.slice(2);
const OUT = outArg || fs.mkdtempSync(path.join(os.tmpdir(), 'qb-store-'));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'qb-sshots-'));
const NO_MOTION = '*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition: none !important; } #fs-btn { display: none !important; }';
const COLORS = require('../../src/teams').TEAM_COLORS;
const settle = (ms = 700) => new Promise(r => setTimeout(r, ms));
const dataUrl = (buf, type) => `data:${type};base64,${buf.toString('base64')}`;
// Round order on the night: the screenshot of each is taken in the phase that shows it best.
const ROUNDS = ['classic', 'drawGuess', 'bluffBank', 'mapDrop', 'pixelFog', 'oddOneOut', 'zoomOut', 'pushYourLuck'];

async function run(lang, browser) {
  const out = path.join(OUT, lang);
  fs.mkdirSync(out, { recursive: true });
  const S = L.samples(lang), X = L.EXTRA[lang], TEAMS = L.TEAMS[lang].slice(0, 6);
  const art = await browser.newPage({ viewport: { width: 640, height: 480 } });
  const emojiPic = async (e, i) => {
    await art.setContent(`<body style="margin:0;display:grid;place-items:center;height:100vh;background:radial-gradient(circle at 40% 35%, hsl(${i * 70} 60% 70%), hsl(${i * 70 + 30} 45% 35%));font-size:300px">${e}</body>`);
    return dataUrl(await art.screenshot({ type: 'jpeg', quality: 85 }), 'image/jpeg');
  };
  const pack = JSON.parse(fs.readFileSync(path.join(ROOT, 'quizzes', `night-pack-1.${lang}.json`), 'utf8'));
  const rounds = [];
  for (const [n, id] of ROUNDS.entries()) {
    let q;
    if (id === 'classic') q = pack.rounds[0].questions[0];
    else {
      const raw = { ...S[id] };
      if (id === 'pixelFog') { raw.question = X.animal; raw.answer = X.elephant; raw.accept = []; }
      if (id === 'oddOneOut') { raw.question = X.notFruit; raw.captions = X.fruit; raw.correct = 2; }
      q = ai.parseRound(JSON.stringify({ questions: [raw] }), id)[0];
      if (id === 'pixelFog') q.image = await emojiPic('🐘', n);
      if (id === 'zoomOut') q.image = await emojiPic('🍍', n);
      if (id === 'mapDrop') q.image = await emojiPic('🗺️', n);
      if (id === 'mapDrop' && !q.spot) q.spot = { x: 0.45, y: 0.4 };
      if (id === 'oddOneOut') { q.images = []; for (const [i, e] of ['🍎', '🍌', '🥕', '🍇'].entries()) q.images.push(await emojiPic(e, 10 + i)); }
    }
    rounds.push({ type: id, title: '', questions: [{ ...q, time: 60 }] });
  }
  // A cat on a bicycle, the way six teams draw it on their phone: neon lines on a dark board.
  const drawings = [];
  for (let i = 0; i < 6; i++) {
    drawings.push(await art.evaluate(i => {
      const c = document.createElement('canvas'); c.width = 600; c.height = 450;
      const g = c.getContext('2d');
      g.fillStyle = '#1a120c'; g.fillRect(0, 0, 600, 450);
      g.lineWidth = 9; g.lineCap = g.lineJoin = 'round';
      const col = ['#7df9ff', '#ffe066', '#ff6bd6', '#8dff8a', '#ff9a3c', '#c9a0ff'], w = (i % 3) * 8;
      const line = (pts, color) => { g.strokeStyle = color; g.beginPath(); pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); };
      g.strokeStyle = col[(i + 1) % 6]; g.beginPath(); g.arc(160, 330, 80 + w, 0, 7); g.stroke(); g.beginPath(); g.arc(440, 330, 80 + w, 0, 7); g.stroke();
      line([[160, 330], [260, 220], [400, 220], [440, 330]], col[(i + 2) % 6]); line([[260, 220], [300, 330], [400, 220]], col[(i + 2) % 6]);
      g.strokeStyle = col[i]; g.beginPath(); g.ellipse(310, 170, 70, 45, -0.2, 0, 7); g.stroke();
      g.beginPath(); g.arc(380, 95, 42, 0, 7); g.stroke();
      line([[350, 65], [352, 30], [372, 55]], col[i]); line([[392, 55], [412, 28], [415, 68]], col[i]);
      line([[245, 165], [205, 120 - w], [220, 90]], col[i]);
      g.fillStyle = col[i]; g.beginPath(); g.arc(368, 92, 5, 0, 7); g.arc(394, 92, 5, 0, 7); g.fill();
      return c.toDataURL('image/png').split(',')[1];
    }, i));
  }
  await art.close();

  const data = { language: lang, sfx: false, look: 'pub' };
  const qb = createServer({ port: 0, license: require('../../test/fixtures/pro').proLicense(), settings: { get: k => data[k], set: (k, v) => { data[k] = v; } }, library: require('../../src/library').create(TMP), lanAddresses: () => ['192.168.1.20'] });
  const port = await qb.listen();
  const url = `http://127.0.0.1:${port}`;
  const media = [];
  for (const d of drawings) {
    const res = await fetch(`${url}/api/host/media`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: Buffer.from(d, 'base64') });
    media.push((await res.json()).url);
  }
  const sockets = [];
  const open = query => { const s = connect(url, { query, transports: ['websocket'], forceNew: true }); sockets.push(s); return s; };
  const host = open({ role: 'host' });
  let state = null;
  host.on('state', s => { state = s; });
  const quiz = { title: L.TITLE[lang], language: lang, tiebreak: false, jokers: false, powerUps: false, rounds };
  const saved = await (await fetch(`${url}/api/host/library/quiz`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quiz }) })).json();
  const loaded = await new Promise(r => host.emit('load', { library: saved.path }, r));
  if (!loaded.ok) throw new Error('quiz did not load: ' + JSON.stringify(loaded));
  const teams = [];
  for (let i = 0; i < TEAMS.length; i++) {
    const id = 'team' + String(i).padStart(6, '0');
    const s = open({ role: 'player', teamId: id });
    s.on('state', st => { s.last = st; });
    await new Promise(r => s.emit('join', { teamId: id, name: TEAMS[i], color: COLORS[i] }, r));
    teams.push(s);
  }
  const tv = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await tv.goto(`${url}/screen?fx=off`);
  await tv.addStyleTag({ content: NO_MOTION });
  const shot = async (name, page = tv) => {
    await settle(900);
    await page.evaluate(() => Promise.all([...document.images].map(i => i.complete || new Promise(r => { i.onload = i.onerror = r; }))));
    const file = path.join(out, name + '.png');
    await page.screenshot({ path: file });
    console.log(file);
    return file;
  };
  const until = async (test, ms = 5000) => { for (const end = Date.now() + ms; Date.now() < end; await settle(100)) if (test()) return true; return false; };
  const toQuestion = async type => {
    for (let guard = 0; guard < 12 && !(state.phase === 'question' && state.round && state.round.type === type); guard++) {
      if (state.phase === 'wager') { teams.forEach((p, i) => { p.emit('wager', 1); p.emit('pick', i % 3); }); await settle(300); }
      host.emit('next'); await settle(350);
    }
  };

  // 01: the big screen and a phone side by side on the pub wall.
  await toQuestion('classic');
  const phone = await browser.newPage({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: L.LOCALE[lang] });
  await phone.addInitScript(() => localStorage.setItem('qb.teamId', 'team000000'));
  await phone.goto(`${url}/play?fx=off`); await phone.addStyleTag({ content: NO_MOTION });
  const small = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 2 });
  await small.goto(`${url}/screen?fx=off`); await small.addStyleTag({ content: NO_MOTION });
  const tvPng = await shot('tv-tmp', small);
  await small.close();
  const phonePng = await shot('phone-tmp', phone);
  await phone.close();
  const stage = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const bg = fs.readFileSync(path.join(ROOT, 'public', 'img', 'look', 'pub-stage.webp'));
  await stage.setContent(`<body style="margin:0;width:1920px;height:1080px;background:url(${dataUrl(bg, 'image/webp')}) center/cover;position:relative;overflow:hidden">
    <img src="${dataUrl(fs.readFileSync(tvPng), 'image/png')}" style="position:absolute;left:100px;top:180px;width:1280px;height:720px;border:8px solid #c8963e;box-shadow:0 30px 80px #000c">
    <img src="${dataUrl(fs.readFileSync(phonePng), 'image/png')}" style="position:absolute;left:1440px;top:120px;width:420px;height:840px;border:6px solid #c8963e;box-shadow:0 30px 80px #000c">
  </body>`);
  await shot('01-combo', stage);
  await stage.close();
  fs.rmSync(tvPng); fs.rmSync(phonePng);

  // 02: everyone drew, the vote is on.
  await toQuestion('drawGuess');
  teams.forEach((s, i) => s.emit('answer', media[i]));
  if (!(await until(() => state.phase !== 'question'))) host.emit('next');
  await until(() => state.phase === 'vote');
  await shot('02-tekenen');

  // 03: the bluffs are in, which one is true?
  await toQuestion('bluffBank');
  teams.forEach((s, i) => s.emit('answer', X.open[i % 5] + (i === 5 ? '!' : '')));
  if (!(await until(() => state.phase !== 'question'))) host.emit('next');
  await until(() => state.phase === 'vote');
  await shot('03-bluffen');

  // 04: pins on the map and the answer.
  await toQuestion('mapDrop');
  teams.slice(0, 5).forEach((s, i) => s.emit('answer', { x: 0.2 + 0.08 * i, y: 0.35 + 0.03 * i }));
  await settle(300);
  for (let guard = 0; guard < 4 && !['reveal', 'answer'].includes(state.phase) && state.phase === 'question'; guard++) { host.emit('next'); await settle(400); }
  await shot('04-kaart');

  // 05-08: questions with four teams in.
  const answerFor = (q, i) => (q.kind === 'choice' ? (i % 2 ? q.correct ?? 0 : i % 4) : X.open[i % 5]);
  for (const [type, name, reveal] of [['pixelFog', '05-pixelfoto'], ['oddOneOut', '06-intruder', true], ['zoomOut', '07-inzoomen'], ['pushYourLuck', '08-gokken']]) {
    await toQuestion(type);
    for (const [i, p] of teams.entries()) { if (i > 3) break; const q = p.last && p.last.question; if (q) p.emit('answer', answerFor(q, i)); await settle(120); }
    if (reveal) { host.emit('next'); await settle(500); }
    await shot(name);
  }

  // 09-10: the first round of the sample night in two other looks.
  const night = { ...pack, title: L.TITLE[lang], tiebreak: false, rounds: pack.rounds.slice(0, 3).map(r => ({ ...r, questions: r.questions.slice(0, 1) })) };
  const nightSaved = await (await fetch(`${url}/api/host/library/quiz`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quiz: night }) })).json();
  for (const [look, name] of [['disco', '09-disco'], ['stadium', '10-stadion']]) {
    host.emit('stop'); await settle();
    host.emit('look', look); await settle();
    await new Promise(r => host.emit('load', { library: nightSaved.path }, r));
    for (const [i, s] of teams.entries()) await new Promise(r => s.emit('join', { teamId: 'team' + String(i).padStart(6, '0'), name: TEAMS[i], color: COLORS[i] }, r));
    await tv.reload(); await tv.addStyleTag({ content: NO_MOTION });
    host.emit('next'); await settle();
    await shot(name);
  }
  sockets.forEach(s => s.close());
  await qb.close();
}

(async () => {
  const browser = await chromium.launch();
  for (const lang of langArg === 'all' ? L.LANGS : [langArg]) await run(lang, browser);
  await browser.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('done:', OUT);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
