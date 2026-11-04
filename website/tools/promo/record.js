// Records the promo video: a scripted quiz night in the real app, filmed on a set with the big screen and a phone.
// Run from the repo root:  node website/tools/promo/record.js [lang|all] [wide|tall|both] [url]
// Writes promo-<lang>-<wide|tall>.mp4 to website/video (wide, 1280x720 for the website) and to OUT (full size).
// Needs Playwright with Chromium and ffmpeg.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const express = require('express');
const { chromium } = require('playwright');
const { io: connect } = require('socket.io-client');
const { createServer } = require('../../../src/app');
const { TYPES } = require('../../../src/rounds');

const ROOT = path.join(__dirname, '..', '..', '..');
const LANGS = ['en', 'nl', 'fr', 'de', 'es'];
const [langArg = 'all', shapeArg = 'both', URL_TEXT = 'quizbrew.app'] = process.argv.slice(2);
const OUT = process.env.OUT || path.join(os.tmpdir(), 'quizbrew-promo');
const WEB = path.join(ROOT, 'website', 'video');
const ROUNDS = (Array.isArray(TYPES) ? TYPES : Object.values(TYPES)).length;
const COLORS = require('../../../src/teams').TEAM_COLORS;
const PHONE_TEAM = { en: 'The Brainiacs', nl: 'De Slimmeriken', fr: 'Les Cerveaux', de: 'Die Schlauköpfe', es: 'Los Cerebritos' };
const BOTS = ['Quizzly Bears', 'Know-It-Owls', 'Table Six', 'Fact Hunters', 'Late Again', 'Mind the Gap', 'Grandma Knows'];
const wait = ms => new Promise(r => setTimeout(r, ms));

async function record(lang, tall) {
  const W = tall ? 1080 : 1920, H = tall ? 1920 : 1080;
  const pack = JSON.parse(fs.readFileSync(path.join(ROOT, 'quizzes', `night-pack-1.${lang}.json`), 'utf8'));
  const quiz = { ...pack, tiebreak: false, jokers: false, powerUps: false,
    rounds: pack.rounds.slice(0, 2).map(r => ({ ...r, questions: r.questions.slice(0, 1).map(q => ({ ...q, time: 30 })) })) };
  const data = { language: lang, sfx: false, look: 'pub' };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qb-promo-'));
  const qb = createServer({ port: 0, settings: { get: k => data[k], set: (k, v) => { data[k] = v; } }, library: require('../../../src/library').create(tmp), lanAddresses: () => ['192.168.1.20'] });
  qb.app.use('/promo', express.static(__dirname, { extensions: ['html'] }));
  const port = await qb.listen();
  const base = `http://127.0.0.1:${port}`;
  const sockets = [];
  const open = query => { const s = connect(base, { query, transports: ['websocket'], forceNew: true }); sockets.push(s); return s; };
  const host = open({ role: 'host' });
  let state = null;
  host.on('state', s => { state = s; });
  const saved = await (await fetch(`${base}/api/host/library/quiz`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quiz }) })).json();
  await new Promise(r => host.emit('load', { library: saved.path }, r));

  const browser = await chromium.launch();
  const LOCALE = { en: 'en-GB', nl: 'nl-BE', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };
  // Phones pick their own language from the browser, so the film's browser speaks the film's language.
  const page = await browser.newPage({ viewport: { width: W, height: H }, locale: LOCALE[lang] });
  await page.goto(`${base}/promo/stage?lang=${lang}&rounds=${ROUNDS}${tall ? '&v=1' : ''}&url=${encodeURIComponent(URL_TEXT)}`);
  await page.evaluate(([tv, phone]) => window.setFrames(tv, phone), [`${base}/screen?fx=high`, `${base}/play?fx=high`]);
  await page.evaluate(() => window.card('intro', true));
  await wait(2500);
  // The full screen hint is for a real TV only.
  for (const f of page.frames()) if (f.url().includes('/screen')) await f.addStyleTag({ content: '#fs-btn { display: none !important; }' });
  const phone = page.frameLocator('#phone');

  // Film: a screencast of every painted frame, with its time.
  const frames = path.join(tmp, 'frames');
  fs.mkdirSync(frames);
  const cdp = await page.context().newCDPSession(page);
  const shots = [];
  cdp.on('Page.screencastFrame', async f => {
    const file = path.join(frames, String(shots.length).padStart(5, '0') + '.jpg');
    fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
    shots.push({ file, t: f.metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  const scene = k => page.evaluate(key => window.scene(key), k);

  // 1. Logo and tagline.
  await wait(2800);
  await page.evaluate(() => window.card('intro', false));
  // 2. Teams join: the phone types its team name while other teams pop in on the big screen.
  await scene('join');
  await wait(600);
  const bots = [];
  const addBot = async i => {
    const id = 'bot' + String(i).padStart(7, '0');
    const s = open({ role: 'player', teamId: id });
    await new Promise(r => s.emit('join', { teamId: id, name: BOTS[i], color: COLORS[i + 1] }, r));
    bots.push(s);
  };
  await addBot(0); await wait(350); await addBot(1);
  await phone.locator('#team-name').pressSequentially(PHONE_TEAM[lang], { delay: 70 });
  await addBot(2);
  await phone.locator('#swatches .swatch').nth(0).click();
  await wait(300);
  await phone.locator('#join-form button[type=submit]').click();
  for (let i = 3; i < BOTS.length; i++) { await wait(300); await addBot(i); }
  await wait(900);
  // 3. No internet needed.
  await scene('offline');
  await page.evaluate(() => window.badge(true));
  await wait(2600);
  await page.evaluate(() => window.badge(false));
  // 4. Round intro.
  await scene('rounds');
  host.emit('next');
  await wait(3000);
  // 5. Question: the phone taps, the other teams follow.
  await scene('answer');
  host.emit('next');
  await wait(2200);
  const q = quiz.rounds[0].questions[0];
  await phone.locator('#choices .choice').nth(q.correct).click();
  for (const [i, s] of bots.entries()) { await wait(220); s.emit('answer', i % 3 === 1 ? (q.correct + 1) % q.answers.length : q.correct); }
  await wait(1200);
  // 6. Reveal.
  await scene('reveal');
  if (state.phase === 'question') host.emit('next');
  await wait(3200);
  // 7. Scoreboard, on the big screen only.
  await scene('score');
  await page.evaluate(() => window.focusTv(true));
  host.emit('next');
  await wait(5200);
  // 8. Five looks on the next round intro.
  await scene('looks');
  host.emit('next');
  await wait(1100);
  for (const look of ['space', 'jungle', 'spooky', 'arcade', 'pub']) { host.emit('look', look); await wait(950); }
  // 9. End card.
  await page.evaluate(() => window.card('outro', true));
  await wait(3800);
  await cdp.send('Page.stopScreencast');
  await wait(300);

  // Frames → constant 30 fps video. Each frame lasts until the next one was painted.
  const list = path.join(tmp, 'list.txt');
  const lines = shots.map((s, i) => `file '${s.file}'\nduration ${Math.max(0.001, ((shots[i + 1] || { t: s.t + 0.04 }).t - s.t)).toFixed(4)}`);
  fs.writeFileSync(list, lines.join('\n') + `\nfile '${shots[shots.length - 1].file}'\n`);
  fs.mkdirSync(OUT, { recursive: true });
  const name = `promo-${lang}-${tall ? 'tall' : 'wide'}`;
  const full = path.join(OUT, name + '.mp4');
  const enc = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-r', '30'];
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', `scale=${W}:${H}:flags=lanczos,fps=30`, ...enc, '-crf', '20', '-preset', 'slow', full]);
  console.log(full, Math.round(fs.statSync(full).size / 1024) + ' KB', shots.length + ' frames');
  if (!tall) {
    fs.mkdirSync(WEB, { recursive: true });
    const web = path.join(WEB, name + '.mp4');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', full, '-vf', 'scale=1280:720:flags=lanczos', ...enc, '-crf', '27', '-preset', 'slow', '-an', web]);
    console.log(web, Math.round(fs.statSync(web).size / 1024) + ' KB');
    if (lang === 'en') execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '9', '-i', full, '-frames:v', '1', '-vf', 'scale=1280:720', '-q:v', '70', path.join(WEB, 'poster.webp')]);
    if (lang === 'en') execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '9', '-i', full, '-frames:v', '1', '-vf', 'scale=1200:675', '-q:v', '4', path.join(WEB, 'share.jpg')]);
  }
  sockets.forEach(s => s.close());
  await browser.close();
  await qb.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}

(async () => {
  const langs = langArg === 'all' ? LANGS : [langArg];
  const shapes = shapeArg === 'both' ? [false, true] : [shapeArg === 'tall'];
  for (const lang of langs) for (const tall of shapes) await record(lang, tall);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
