// A screenshot of the big screen for every round type, for the round list on the website.
// Plays one question per type (the AI samples from the tests, translated in shot-lang.js) with a few teams, and saves
// website/img/rounds/<lang>/<type>.webp. Run from the repo root: node website/tools/round-shots.js [lang|all] [type ...]
// Needs Playwright with Chromium, ffmpeg and ImageMagick. Pictures are drawn from emoji, so no internet is needed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const { io: connect } = require('socket.io-client');
const { createServer } = require('../../src/app');
const rounds = require('../../src/rounds');
const ai = require('../../src/ai');
const L = require('./shot-lang');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'qb-rshots-'));
const NO_MOTION = '*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition: none !important; }';
const settle = (ms = 700) => new Promise(r => setTimeout(r, ms));
const COLORS = require('../../src/teams').TEAM_COLORS;
const [langArg = 'all', ...only] = process.argv.slice(2);
const types = rounds.TYPES.filter(t => !only.length || only.includes(t.id));

// Pictures for the picture rounds: one emoji, big, on a soft background.
const PICS = X => ({ picture: ['🦊', X.animal, X.fox], zoomOut: ['🍍'], pixelFog: ['🐘', X.animal, X.elephant], silhouette: ['🦒'], captionThis: ['🐶'], mapDrop: ['🗺️'] });
const ODD = ['🍎', '🍌', '🥕', '🍇'];
const dataUrl = (file, type) => `data:${type};base64,${fs.readFileSync(file).toString('base64')}`;

async function main(LANG) {
  const OUT = path.join(__dirname, '..', 'img', 'rounds', LANG);
  const SAMPLES = L.samples(LANG), X = L.EXTRA[LANG], TEAMS = L.TEAMS[LANG].slice(0, 6), P = PICS(X);
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const art = await browser.newPage({ viewport: { width: 640, height: 480 } });
  const emojiPic = async (e, i, plain) => {
    const bg = plain ? 'transparent' : `radial-gradient(circle at 40% 35%, hsl(${i * 70} 60% 70%), hsl(${i * 70 + 30} 45% 35%))`;
    await art.setContent(`<body style="margin:0;display:grid;place-items:center;height:100vh;background:${bg};font-size:300px">${e}</body>`);
    const f = path.join(TMP, `pic${i}.png`); await art.screenshot({ path: f, omitBackground: !!plain });
    const w = path.join(TMP, `pic${i}.webp`); execFileSync('convert', [f, '-quality', '80', w]);
    return dataUrl(w, 'image/webp');
  };
  const mp3 = path.join(TMP, 'a.mp3'), mp4 = path.join(TMP, 'v.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8', '-q:a', '6', mp3]);
  const still = path.join(TMP, 'street.png');
  await art.setContent('<body style="margin:0;display:grid;place-items:center;height:100vh;background:linear-gradient(#8ec5ff,#f7d9a8);font-size:200px">🏙️🚲🐕</body>');
  await art.screenshot({ path: still });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-loop', '1', '-i', still, '-t', '6', '-r', '24', '-vf', 'scale=640:480', '-pix_fmt', 'yuv420p', mp4]);
  const audio = dataUrl(mp3, 'audio/mpeg'), video = dataUrl(mp4, 'video/mp4');

  const quizRounds = [];
  let n = 0;
  for (const t of types) {
    const raw = { ...SAMPLES[t.id] };
    if (P[t.id] && P[t.id][1]) { raw.question = P[t.id][1]; raw.answer = P[t.id][2]; raw.accept = []; }
    if (t.id === 'oddOneOut') { raw.question = X.notFruit; raw.captions = X.fruit; raw.correct = 2; }
    const q = ai.parseRound(JSON.stringify({ questions: [raw] }), t.id)[0];
    if (P[t.id]) q.image = await emojiPic(P[t.id][0], n++, t.id === 'silhouette');
    if (t.fields.includes('images')) { q.images = []; for (const [i, e] of ODD.entries()) q.images.push(await emojiPic(e, 10 + i)); }
    if (t.fields.includes('audio')) q.audio = audio;
    if (t.fields.includes('video')) q.video = video;
    if (t.fields.includes('spot') && !q.spot) q.spot = { x: 0.45, y: 0.4 };
    quizRounds.push({ type: t.id, title: '', questions: [{ ...q, time: 60 }] });
  }
  const quiz = { title: L.TITLE[LANG], language: LANG, tiebreak: false, jokers: false, powerUps: false, rounds: quizRounds };

  const data = { language: LANG, sfx: false, look: 'pub' };
  const qb = createServer({ port: 0, license: require('../../test/fixtures/pro').proLicense(), settings: { get: k => data[k], set: (k, v) => { data[k] = v; } }, library: require('../../src/library').create(TMP), lanAddresses: () => ['192.168.1.20'] });
  const port = await qb.listen();
  const url = `http://127.0.0.1:${port}`;
  const sockets = [];
  const open = query => { const s = connect(url, { query, transports: ['websocket'], forceNew: true }); sockets.push(s); return s; };
  const host = open({ role: 'host' });
  let state = null;
  host.on('state', s => { state = s; });
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
  const tv = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await tv.goto(`${url}/screen?fx=off`);
  await tv.addStyleTag({ content: NO_MOTION + ' #fs-btn { display: none !important; }' });
  const shot = async name => {
    await settle(900);
    const png = path.join(TMP, 'shot.png');
    await tv.screenshot({ path: png });
    const file = path.join(OUT, name + '.webp');
    execFileSync('convert', [png, '-resize', '800x', '-quality', '72', file]);
    console.log(name, Math.round(fs.statSync(file).size / 1024) + ' KB');
  };
  const answerFor = (q, i) => {
    switch (q.kind) {
      case 'choice': return i % 2 ? q.correct ?? 0 : (i % (q.answers || [1, 2]).length);
      case 'trueFalse': return i % 2;
      case 'number': return 1000 + i * 77;
      case 'order': return [...Array(q.items.length).keys()];
      case 'pairs': return [...Array(q.left.length).keys()];
      case 'list': return X.list;
      case 'point': return { x: 0.1 * (i + 1), y: 0.5 };
      case 'level': return { l: i % 3, i: 0 };
      case 'buzz': return 'buzz';
      default: return X.open[i % 5];
    }
  };
  host.emit('next');
  await settle();
  const done = new Set();
  for (let guard = 0; guard < 400 && state && !['end', 'awards'].includes(state.phase); guard++) {
    const s = state, id = s.round && s.round.type;
    if (s.phase === 'wager') teams.forEach((p, i) => { p.emit('wager', 1); p.emit('pick', i % 3); });
    if (s.phase === 'question' && id && !done.has(id)) {
      done.add(id);
      for (const [i, p] of teams.entries()) { if (i > 3) break; const q = p.last && p.last.question; if (q && q.kind !== 'buzz' && id !== 'buzzer') p.emit('answer', answerFor(q, i)); await settle(150); }
      await shot(id);
    }
    host.emit('next');
    await settle(400);
  }
  console.log(LANG, 'missing:', types.map(t => t.id).filter(x => !done.has(x)).join(' ') || 'none');
  sockets.forEach(s => s.close());
  await browser.close(); await qb.close();
}
(async () => {
  for (const lang of langArg === 'all' ? L.LANGS : [langArg]) await main(lang);
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
