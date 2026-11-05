// Screenshots for the website: plays the sample night in a real browser and saves the nicest moments
// as small webp files in website/img/shots/<lang>. Run from the repo root: node website/tools/shots.js [look|all] [lang|all]
// Needs Playwright with Chromium (and ImageMagick `convert` for webp).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const { io: connect } = require('socket.io-client');
const { createServer } = require('../../src/app');

const L = require('./shot-lang');
const LOOKS = ['pub', 'space', 'jungle', 'arcade', 'spooky', 'disco', 'beach', 'winter', 'gala', 'stadium'];
const [lookArg = 'pub', langArg = 'all'] = process.argv.slice(2);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'qb-shots-'));
const COLORS = require('../../src/teams').TEAM_COLORS;
const NO_MOTION = '*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition: none !important; }';
const settle = (ms = 600) => new Promise(r => setTimeout(r, ms));


async function run(LOOK, LANG) {
  const OUT = path.join(__dirname, '..', 'img', 'shots', LANG);
  const TEAMS = L.TEAMS[LANG];
  const pack = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'quizzes', `night-pack-1.${LANG}.json`), 'utf8'));
  const quiz = { ...pack, title: L.TITLE[LANG], tiebreak: false, rounds: pack.rounds.slice(0, 3).map(r => ({ ...r, questions: r.questions.slice(0, 1) })) };
  fs.mkdirSync(OUT, { recursive: true });
  const data = { language: LANG, sfx: false, look: LOOK };
  const qb = createServer({ port: 0, license: require('../../test/fixtures/pro').proLicense(), settings: { get: k => data[k], set: (k, v) => { data[k] = v; } }, library: require('../../src/library').create(TMP), lanAddresses: () => ['192.168.1.20'] });
  const port = await qb.listen();
  const url = `http://127.0.0.1:${port}`;
  const sockets = [];
  const open = query => { const s = connect(url, { query, transports: ['websocket'], forceNew: true }); sockets.push(s); return s; };
  const browser = await chromium.launch();
  const tv = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const phone = await browser.newPage({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: L.LOCALE[LANG] });
  await phone.addInitScript(() => localStorage.setItem('qb.teamId', 'team000000'));
  const shot = async (page, name, w) => {
    await settle();
    const png = path.join(TMP, name + '.png');
    await page.screenshot({ path: png });
    const file = path.join(OUT, `${LOOK}-${name}.webp`);
    execFileSync('convert', [png, '-resize', `${w}x`, '-quality', '78', file]);
    console.log(file, Math.round(fs.statSync(file).size / 1024) + ' KB');
  };

  const host = open({ role: 'host' });
  let state = null;
  host.on('state', s => { state = s; });
  const saved = await (await fetch(`${url}/api/host/library/quiz`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quiz }) })).json();
  await new Promise(r => host.emit('load', { library: saved.path }, r));
  const teams = [];
  for (let i = 0; i < TEAMS.length; i++) {
    const id = 'team' + String(i).padStart(6, '0');
    const s = open({ role: 'player', teamId: id });
    await new Promise(r => s.emit('join', { teamId: id, name: TEAMS[i], color: COLORS[i] }, r));
    teams.push(s);
  }
  await tv.goto(`${url}/screen?fx=off`); await tv.addStyleTag({ content: NO_MOTION });
  await phone.goto(`${url}/play?fx=off`); await phone.addStyleTag({ content: NO_MOTION });
  if (LOOK === 'pub') await shot(tv, 'lobby', 1280);
  if (LOOK !== 'pub') { host.emit('next'); await settle(); await shot(tv, 'intro', 1280); host.emit('stop'); await settle(); return done(); }

  host.emit('next'); await settle();
  await shot(tv, 'intro', 1280);
  host.emit('next'); await settle();
  await shot(tv, 'question', 1280);
  await shot(phone, 'phone-question', 390);
  const q = quiz.rounds[0].questions[0];
  teams.forEach((s, i) => s.emit('answer', i % 3 === 1 ? (q.correct + 1) % 4 : q.correct));
  await settle();
  await shot(phone, 'phone-locked', 390);
  if (state.phase === 'question') { host.emit('next'); await settle(); }
  await shot(tv, 'reveal', 1280);
  await shot(phone, 'phone-reveal', 390);
  host.emit('next'); await settle();
  const hostPage = await browser.newPage({ viewport: { width: 1366, height: 820 } });
  await hostPage.goto(`${url}/host?fx=off`); await hostPage.addStyleTag({ content: NO_MOTION });
  await shot(hostPage, 'host', 1280);
  host.emit('stop'); await settle();
  return done();

  async function done() { sockets.forEach(s => s.close()); await browser.close(); await qb.close(); }
}
(async () => {
  for (const look of lookArg === 'all' ? LOOKS : [lookArg]) for (const lang of langArg === 'all' ? L.LANGS : [langArg]) await run(look, lang);
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
