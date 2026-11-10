// The Quizbrew server: static screens, a few JSON routes and the live game over socket.io.
const http = require('http');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { Game, validateQuiz } = require('./game');
const { Autopilot } = require('./autopilot');
const Brand = require('./brand');
const { Audience } = require('./audience');
const { TEAM_COLORS } = require('./teams');
const i18n = require('./i18n');
const quizzes = require('./quizzes');
const network = require('./network');
const Settings = require('./settings');
const Library = require('./library');
const Cloud = require('./cloud');
const Pictures = require('./pictures');
const Ai = require('./ai');
const csv = require('./csv');
const rounds = require('./rounds');
const License = require('./license');
const { MAX_TEAMS } = require('./teams');

const TEAM_ID = /^[a-z0-9]{8,40}$/;

const LOOKS = ['pub', 'space', 'jungle', 'spooky', 'arcade', 'winter', 'disco', 'beach', 'stadium', 'gala'];
const MODES = ['screen', 'phones'];

// A quiz file: our own export, or a quiz an AI wrote and someone saved as a file (other type names, AI question shapes,
// not quite valid JSON). Our own rounds stay exactly as they are; rounds an AI wrote are read like a pasted AI answer.
function isComplete(type, q) {
  let ok = true;
  try { type.validate(q, () => { ok = false; }); } catch { ok = false; }
  return ok;
}
// Read again like an AI answer; empty fields that were not there before are not added.
function repaired(q, typeId) {
  const fixed = Ai.readQuestion(q, typeId);
  for (const [k, v] of Object.entries(fixed)) if (!(k in q) && (v === '' || (Array.isArray(v) && !v.length))) delete fixed[k];
  return { ...q, ...fixed };
}
function readQuizFile(text) {
  let quiz = null;
  try { quiz = JSON.parse(String(text).replace(/^\ufeff/, '')); } catch { /* not clean JSON: read it like an AI answer */ }
  if (!quiz || !Array.isArray(quiz.rounds)) return Ai.parseQuiz(text);
  const out = [];
  quiz.rounds.forEach((r, i) => {
    const type = r && rounds.get(r.type);
    if (type && Array.isArray(r.questions)) {
      // A question that is not complete may still be in the AI's shape ("correct": "Paris", captions without pictures):
      // read it like an AI answer, keeping everything else it has (pictures, sound, time, points).
      out.push({ ...r, questions: r.questions.map(q => (q && typeof q === 'object' && !Array.isArray(q) && !isComplete(type, q) ? repaired(q, type.id) : q)) });
      return;
    }
    const id = r && rounds.typeFrom(r.type);
    if (!id) throw new Error(`Round ${i + 1} has a round type Quizbrew does not know: "${r && r.type}"`);
    const one = Ai.parseQuiz(JSON.stringify({ rounds: [{ ...r, type: id }] })).rounds[0];
    out.push({ ...r, ...one, title: String(r.title || '') });
  });
  return { ...quiz, rounds: out };
}

function createServer({ port = 3000, settings = Settings.create(), library = Library.create(), lanAddresses = null, interfaces = null, hostFromAnywhere = false, cloudEvery = 60000, webFetch = globalThis.fetch, license = null, onQuit = null } = {}) {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { serveClient: true, pingInterval: 10000, pingTimeout: 8000, maxHttpBufferSize: 3e6 });
  const pub = path.join(__dirname, '..', 'public');

  // Demo or Pro: the demo has 4 teams, one look and a set of round types; Pro has everything.
  if (!license) license = License.create(settings);
  const pro = () => license.pro();
  const lookFree = name => pro() || License.FREE.looks.includes(name);
  // The look of the evening (backgrounds, colours, fonts) for every screen. Pub is the default.
  const look = () => (LOOKS.includes(settings.get('look')) && lookFree(settings.get('look')) ? settings.get('look') : LOOKS[0]);
  // Big screen (default), or phones only: then every phone shows a small copy of the big screen.
  const mode = () => (MODES.includes(settings.get('mode')) ? settings.get('mode') : MODES[0]);
  const language = () => (i18n.isSupported(settings.get('language')) ? settings.get('language') : i18n.DEFAULT);
  const canHost = address => hostFromAnywhere || network.isLocal(address);
  // The quizmaster's remote: a phone or tablet on the wifi with the secret link (new on every start) may drive the quiz.
  const remoteKey = crypto.randomBytes(9).toString('hex');
  const isRemote = key => typeof key === 'string' && key.length === remoteKey.length && crypto.timingSafeEqual(Buffer.from(key), Buffer.from(remoteKey));
  const baseUrl = () => joinUrl().replace(/\/play$/, '');
  // The addresses of this laptop, best first. Tests pass their own list.
  const given = lanAddresses;
  if (!interfaces) interfaces = given ? () => given().map(address => ({ address, name: '', kind: '' })) : () => network.lanInterfaces();
  lanAddresses = () => interfaces().map(i => i.address);
  const livePort = () => (server.address() ? server.address().port : port);
  // The quizmaster can pick another address when the first one does not work (a hotspot, a second network card).
  // Quizbrew also remembers the address the first phone came in on: that one works for sure.
  const chosenAddress = () => {
    const list = lanAddresses();
    const saved = settings.get('address');
    return list.includes(saved) ? saved : list[0];
  };
  const joinUrl = () => `http://${chosenAddress() || 'localhost'}:${livePort()}/play`;
  const qrSvg = url => QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#1b0f08', light: '#0000' } });
  const joinInfo = async () => { const url = joinUrl(); return { url, qr: await qrSvg(url) }; };
  const announceJoin = () => joinInfo().then(j => io.emit('joinInfo', j)).catch(() => {});

  // The running game is saved to data/live.json after every change (at most twice a second),
  // so a crash or a closed window costs nothing: at the next start the quizmaster can pick it up again.
  const liveFile = path.join(library.dataDir, 'live.json');
  let saveSoon = null;
  const saveLive = () => {
    saveSoon = null;
    if (game.phase === 'idle') return;
    try {
      fs.mkdirSync(library.dataDir, { recursive: true });
      fs.writeFileSync(liveFile, JSON.stringify({ savedAt: Date.now(), ref: currentRef, quiz: game.quiz, state: game.snapshot() }));
    } catch (err) { console.error('Could not save the game:', err.message); }
  };
  const forgetLive = () => { clearTimeout(saveSoon); saveSoon = null; try { fs.unlinkSync(liveFile); } catch { /* nothing saved */ } };
  const readLive = () => { try { return JSON.parse(fs.readFileSync(liveFile, 'utf8')); } catch { return null; } };

  // How every question went, summed over every night a quiz was played (data/stats.json). The builder shows it.
  const statsFile = path.join(library.dataDir, 'stats.json');
  const statsKey = ref => (ref && typeof ref === 'object' && ref.library ? 'lib:' + ref.library : ref ? 'sample:' + ref : null);
  const readStats = () => { try { return JSON.parse(fs.readFileSync(statsFile, 'utf8')); } catch { return {}; } };
  let currentRef = null;
  let statsSaved = false;
  const saveStats = () => {
    statsSaved = true;
    const key = statsKey(currentRef);
    if (!key) return;
    const all = readStats();
    const mine = all[key] || { plays: 0, q: {} };
    mine.plays += 1;
    mine.updated = Date.now();
    for (const e of game.log.values()) {
      if (!e.scored) continue;
      const teams = Object.values(e.teams);
      const s = mine.q[e.key] || { asked: 0, right: 0, answered: 0 };
      s.asked += teams.length;
      s.right += teams.filter(x => x.c).length;
      s.answered += teams.filter(x => x.a).length;
      mine.q[e.key] = s;
    }
    all[key] = mine;
    try { fs.writeFileSync(statsFile, JSON.stringify(all)); } catch (err) { console.error('Could not save the statistics:', err.message); }
  };
  let autopilot = null;
  let audience = null;
  const game = new Game({
    emit: (target, event, payload) => io.to(target).emit(event, payload),
    onChange: () => {
      if (autopilot) autopilot.check();
      if (audience) audience.check();
      if (game.phase === 'end' && !statsSaved) saveStats();
      if (game.phase === 'idle' || saveSoon) return;
      saveSoon = setTimeout(saveLive, 500);
      saveSoon.unref();
    },
  });
  {
    const saved = readLive();
    if (saved && saved.quiz && saved.state && saved.state.phase !== 'end') {
      game.resumable = {
        title: saved.quiz.title, savedAt: saved.savedAt, teams: saved.state.teams.length,
        round: saved.state.roundIndex + 1, rounds: saved.quiz.rounds.length,
      };
    }
  }
  game.language = language();
  game.maxTeams = pro() ? MAX_TEAMS : License.FREE.teams;
  // The venue and its sponsors are Pro: the demo keeps them, but shows none.
  const brand = () => (pro() ? Brand.clean(settings.get('brand')) : Brand.clean({}));
  audience = new Audience(game, { emit: (target, event, payload) => io.to(target).emit(event, payload) });
  autopilot = new Autopilot(game, { onUpdate: view => io.to('host').emit('auto', view) });
  autopilot.set(settings.get('autopilot') === true && pro());
  const ai = Ai.create(settings);

  // Raffle: the quizmaster draws a team or a ticket number; the big screen spins it out. Winners are not drawn twice.
  let raffleWinners = [];
  const raffleView = () => ({ winners: raffleWinners });
  function drawRaffle({ mode, from, to } = {}) {
    let pool;
    if (mode === 'tickets') {
      const lo = Math.max(1, Math.floor(Number(from) || 1));
      const hi = Math.min(lo + 9999, Math.floor(Number(to) || 0));
      if (!(hi >= lo)) return { error: 'raffle.range' };
      const taken = new Set(raffleWinners.filter(w => w.number).map(w => w.number));
      pool = [];
      for (let n = lo; n <= hi; n++) if (!taken.has(n)) pool.push({ number: n });
    } else {
      const taken = new Set(raffleWinners.filter(w => w.name).map(w => w.name));
      pool = [...game.teams.values()].filter(t => !taken.has(t.name)).map(t => ({ name: t.name, color: t.color, photo: t.photo || null }));
    }
    if (!pool.length) return { error: 'raffle.empty' };
    const winner = pool[crypto.randomInt(pool.length)];
    raffleWinners.push(winner);
    // A handful of other candidates for the spinning reel on the big screen.
    const reel = Array.from({ length: Math.min(24, pool.length * 3) }, () => pool[crypto.randomInt(pool.length)]);
    io.to('screen').emit('raffle', { mode: mode === 'tickets' ? 'tickets' : 'teams', winner, reel, prize: raffleWinners.length });
    io.to('host').emit('raffleState', raffleView());
    return { ok: true, winner };
  }

  // Stars from the phones at the end of the quiz: one rating per team, the last one counts.
  // The average per quiz is kept in data/ratings.json, so the quiz list can show it.
  const ratingsFile = path.join(library.dataDir, 'ratings.json');
  const readRatings = () => { try { return JSON.parse(fs.readFileSync(ratingsFile, 'utf8')); } catch { return {}; } };
  let ratings = new Map();
  let ratedQuiz = null;
  const ratingView = () => {
    const all = [...ratings.values()];
    return { count: all.length, avg: all.length ? Math.round(all.reduce((a, b) => a + b, 0) / all.length * 10) / 10 : null };
  };
  function rate(teamId, stars) {
    const n = Math.round(Number(stars));
    if (game.phase !== 'end' || !game.teams.has(teamId) || !(n >= 1 && n <= 5)) return false;
    if (ratedQuiz !== game.quiz) { ratings = new Map(); ratedQuiz = game.quiz; }
    ratings.set(teamId, n);
    const view = ratingView();
    try {
      const all = readRatings();
      all[game.quiz.title] = { avg: view.avg, count: view.count, at: Date.now() };
      fs.mkdirSync(library.dataDir, { recursive: true });
      fs.writeFileSync(ratingsFile, JSON.stringify(all, null, 2));
    } catch (err) { console.error('Could not save the rating:', err.message); }
    io.to('host').emit('rating', view);
    return true;
  }
  // A short name for the phone that passed the connection test: "iPhone · Safari".
  const deviceName = ua => {
    const s = String(ua || '');
    const os = /iPhone/.test(s) ? 'iPhone' : /iPad/.test(s) ? 'iPad' : /Android/.test(s) ? 'Android' : /Windows/.test(s) ? 'Windows' : /Mac OS/.test(s) ? 'Mac' : '';
    const browser = /SamsungBrowser/.test(s) ? 'Samsung Internet' : /Edg\//.test(s) ? 'Edge' : /Firefox|FxiOS/.test(s) ? 'Firefox' : /CriOS|Chrome/.test(s) ? 'Chrome' : /Safari/.test(s) ? 'Safari' : '';
    return [os, browser].filter(Boolean).join(' · ') || '?';
  };

  // My quiz folder in OneDrive or Google Drive: at start, every minute, and a few seconds after every change here.
  const cloud = Cloud.create({ dataDir: library.dataDir, settings });
  let cloudSoon = null;
  const cloudLater = () => {
    if (!cloud.folder() || !pro()) return;
    clearTimeout(cloudSoon);
    cloudSoon = setTimeout(() => cloud.sync(), 3000);
    cloudSoon.unref();
  };
  const cloudTimer = setInterval(() => { if (pro()) cloud.sync(); }, cloudEvery);
  cloudTimer.unref();
  if (pro()) cloud.sync();

  // A quiz to play: a bundled sample by file name, or { library: 'folder/quiz.json' }.
  const quizFor = ref => (ref && typeof ref === 'object' && ref.library ? library.read(String(ref.library)) : quizzes.load(String(ref)));

  app.disable('x-powered-by');
  // Images are checked again on every load (a cheap 304 on the local network), so a new logo or
  // background shows straight after an update instead of an old copy from the browser cache.
  app.use('/img', express.static(path.join(pub, 'img'), { maxAge: 0 }));
  // Pages go through the routes below, so the host page stays on this laptop.
  app.use((req, res, next) => (req.path.endsWith('.html') ? res.redirect(req.path.slice(0, -5)) : next()));
  app.use(express.static(pub, { index: false }));

  app.get('/', (req, res) => res.redirect(canHost(req.socket.remoteAddress) ? '/host' : '/play'));
  app.get('/host', (req, res) => {
    if (!canHost(req.socket.remoteAddress)) return res.redirect('/play');
    res.sendFile(path.join(pub, 'host.html'));
  });
  app.get('/remote', (req, res) => {
    if (!canHost(req.socket.remoteAddress) && !isRemote(req.query.key)) return res.redirect('/play');
    res.sendFile(path.join(pub, 'remote.html'));
  });
  // The run sheet to print: every round, question and answer.
  app.get('/print', (req, res) => {
    if (!canHost(req.socket.remoteAddress)) return res.redirect('/play');
    if (!pro()) return res.redirect('/host#pro-print');
    res.sendFile(path.join(pub, 'print.html'));
  });
  app.get('/screen', (req, res) => res.sendFile(path.join(pub, 'screen.html')));
  // The connection test: a phone that opens this page has reached the quiz laptop.
  app.get('/network', (req, res) => {
    if (!canHost(req.socket.remoteAddress)) return res.redirect('/play');
    res.sendFile(path.join(pub, 'network.html'));
  });
  app.get('/check', (req, res) => res.sendFile(path.join(pub, 'check.html')));
  app.get('/play', (req, res) => res.sendFile(path.join(pub, 'play.html')));
  app.get('/builder', (req, res) => {
    if (!canHost(req.socket.remoteAddress)) return res.redirect('/play');
    res.sendFile(path.join(pub, 'builder.html'));
  });

  // Pictures and sounds of the quizzes, for every screen.
  app.get('/media/:name', (req, res) => {
    const file = library.mediaFile(req.params.name);
    if (!file) return res.sendStatus(404);
    res.sendFile(file, { maxAge: '30d', immutable: true });
  });

  // Everything below is for the quiz builder on this laptop only.
  const hostOnly = (req, res, next) => (canHost(req.socket.remoteAddress) ? next() : res.status(403).json({ error: 'error.generic' }));
  const api = express.Router();
  api.use(hostOnly);
  // An exported quiz carries its pictures, sounds and video clips inside.
  api.use(express.json({ limit: '250mb' }));
  const handle = fn => async (req, res) => {
    try {
      const out = await fn(req, res);
      if (req.method !== 'GET' && !req.path.startsWith('/cloud') && !req.path.startsWith('/ai')) cloudLater();
      res.json(out);
    } catch (err) {
      if (/^(cloud|pictures|pro)\./.test(err.message)) return res.status(400).json({ error: err.message });
      if (err instanceof Ai.AiError || /^ai\./.test(err.message)) return res.status(400).json({ error: err.key || err.message, detail: err.detail || '' });
      res.status(400).json({ error: 'error.generic', detail: err.message });
    }
  };
  // Demo or Pro: the code is checked here, offline. After a change every screen hears it.
  const proLocked = feature => { if (!pro()) throw new Error(`pro.locked.${feature}`); };
  const licenseChanged = () => {
    wasPro = pro();
    game.maxTeams = pro() ? MAX_TEAMS : License.FREE.teams;
    if (!pro()) autopilot.set(false); else autopilot.set(settings.get('autopilot') === true);
    io.emit('license', publicLicense());
    io.emit('look', look());
    io.emit('brand', brand());
    io.to('host').emit('auto', autopilot.view());
    game.broadcast();
  };
  // Pro can also change by itself: a Store purchase comes through while Quizbrew runs, or a tester's code runs out.
  // Every screen hears that within a few seconds, without a restart.
  let wasPro = pro();
  const proWatch = setInterval(() => { if (pro() !== wasPro) licenseChanged(); }, 5000);
  proWatch.unref();
  api.get('/license', handle(() => license.view()));
  api.post('/license', handle(req => { const v = license.activate(req.body.code); licenseChanged(); if (pro()) cloud.sync(); return v; }));
  api.delete('/license', handle(() => { const v = license.remove(); licenseChanged(); return v; }));
  // The demo keeps 3 quizzes of its own.
  const ownQuizzes = () => { const flat = node => node.quizzes.length + node.folders.reduce((n, f) => n + flat(f), 0); return flat(library.tree()); };
  const roomForQuiz = () => { if (!pro() && ownQuizzes() >= License.FREE.quizzes) throw new Error('pro.locked.quizzes'); };
  // The AI in the demo: up to 10 questions at a time, free round types only.
  const aiDemo = body => {
    if (pro()) return body;
    const o = { ...body };
    if (o.whole) {
      o.rounds = Math.min(License.FREE.aiRounds, Number(o.rounds) || License.FREE.aiRounds);
      o.perRound = Math.min(License.FREE.aiPerRound, Number(o.perRound) || License.FREE.aiPerRound);
      o.types = License.FREE.types;
    } else {
      if (!License.FREE.types.includes(o.type)) throw new Error('pro.locked.types');
      o.count = Math.min(License.FREE.aiQuestions, Number(o.count) || License.FREE.aiQuestions);
    }
    return o;
  };
  const aiDemoOut = out => {
    if (pro()) return out;
    if (out.questions) return { ...out, questions: out.questions.slice(0, License.FREE.aiQuestions) };
    if (out.quiz && Array.isArray(out.quiz.rounds)) {
      return { ...out, quiz: { ...out.quiz, rounds: out.quiz.rounds.slice(0, License.FREE.aiRounds).map(r => ({ ...r, questions: (r.questions || []).slice(0, License.FREE.aiPerRound) })) } };
    }
    return out;
  };
  api.get('/remote', handle(async () => {
    const url = `${baseUrl()}/remote?key=${remoteKey}`;
    return { url, qr: await qrSvg(url) };
  }));
  // The connection test for the quizmaster: a QR code to /check and the addresses of this laptop.
  api.get('/check', handle(async () => {
    const url = `${baseUrl()}/check`;
    return { url, addresses: lanAddresses(), qr: await qrSvg(url) };
  }));
  // Network help: every address of this laptop, pick the one phones can reach, open the Windows Firewall.
  api.get('/addresses', handle(async () => {
    const chosen = chosenAddress();
    const list = interfaces().map(i => ({ ...i, url: `http://${i.address}:${livePort()}/play`, chosen: i.address === chosen }));
    return { port: livePort(), list, ...(await joinInfo()) };
  }));
  api.post('/address', handle(async req => {
    const address = String(req.body.address || '');
    if (!lanAddresses().includes(address)) throw new Error('unknown address');
    settings.set('address', address);
    announceJoin();
    return joinInfo();
  }));
  api.post('/firewall', handle(req => new Promise(resolve => {
    if (!network.isLocal(req.socket.remoteAddress)) return resolve({ error: 'network.fwOnLaptop' });
    network.openFirewall(livePort(), resolve);
  })));
  // The venue and its sponsors, for every screen.
  api.get('/brand', handle(() => brand()));
  api.get('/brand/saved', handle(() => Brand.clean(settings.get('brand'))));
  api.put('/brand', handle(req => {
    proLocked('venue');
    const b = Brand.clean(req.body);
    settings.set('brand', b);
    io.emit('brand', b);
    return b;
  }));
  // The quiz that is loaded right now, for the answer sheet of the paper teams.
  api.get('/live-quiz', handle(() => { if (!game.quiz) throw new Error('no quiz'); return game.quiz; }));
  api.get('/catalog', handle(() => rounds.catalog()));
  api.get('/stats', handle(req => readStats()[statsKey({ library: String(req.query.path || '') })] || { plays: 0, q: {} }));
  // Examples the quizmaster removed stay away after a restart or update; Settings can bring them back.
  const hiddenSamples = () => (Array.isArray(settings.get('hiddenSamples')) ? settings.get('hiddenSamples') : []);
  const samples = () => quizzes.list(language(), hiddenSamples());
  api.get('/library', handle(() => ({ tree: library.tree(), samples: samples() })));
  api.post('/library/hide-sample', handle(req => {
    const file = String(req.body.sample || '');
    quizzes.load(file);
    settings.set('hiddenSamples', [...new Set([...hiddenSamples(), quizzes.base(file)])]);
    return { ok: true, hidden: hiddenSamples().length };
  }));
  api.post('/library/restore-samples', handle(() => { settings.set('hiddenSamples', []); return { ok: true }; }));
  api.get('/library/quiz', handle(req => (req.query.sample ? quizzes.load(String(req.query.sample)) : library.read(String(req.query.path || '')))));
  api.put('/library/quiz', handle(req => (req.body.path ? null : roomForQuiz(), library.save(req.body.path || null, req.body.quiz, { folder: req.body.folder || '' }))));
  api.delete('/library/item', handle(req => { library.remove(String(req.query.path || '')); return { ok: true }; }));
  api.post('/library/folder', handle(req => { library.mkdir(String(req.body.path || '')); return { ok: true }; }));
  api.post('/library/duplicate', handle(req => {
    roomForQuiz();
    const quiz = req.body.sample ? quizzes.load(String(req.body.sample)) : library.read(String(req.body.path || ''));
    const folder = req.body.sample ? '' : String(req.body.path || '').split('/').slice(0, -1).join('/');
    return library.duplicate(quiz, { folder, title: req.body.title || (req.body.sample ? quiz.title : `${quiz.title || 'Quiz'} (${req.body.copyWord || 'copy'})`) });
  }));
  api.post('/library/retitle', handle(req => library.retitle(String(req.body.path || ''), req.body.title)));
  api.post('/library/move', handle(req => { library.move(String(req.body.from || ''), String(req.body.to || '')); return { ok: true }; }));
  api.post('/library/check', handle(req => {
    try { validateQuiz(req.body.quiz); return { ok: true }; } catch (err) { return { ok: false, problem: err.message.replace(/^Invalid quiz: /, '') }; }
  }));
  api.post('/import', handle(req => {
    roomForQuiz();
    const { name = '', text = '' } = req.body;
    const title = String(name).replace(/\.(json|csv|txt)$/i, '') || 'Imported quiz';
    const quiz = /\.json$/i.test(name) || /^\s*[{[]/.test(String(text)) ? readQuizFile(text) : csv.toQuiz(text, title);
    if (!quiz || !Array.isArray(quiz.rounds)) throw new Error('Not a quiz');
    return library.save(null, { ...quiz, title: quiz.title || title }, { folder: req.body.folder || '' });
  }));
  api.get('/export', (req, res) => {
    try {
      const quiz = req.query.sample ? quizzes.load(String(req.query.sample)) : library.read(String(req.query.path || ''));
      const base = String(quiz.title || 'quiz').replace(/[^\w\- ]+/g, '').trim() || 'quiz';
      if (req.query.format === 'csv') {
        res.attachment(`${base}.csv`).type('text/csv').send(csv.fromQuiz(quiz));
      } else {
        res.attachment(`${base}.quizbrew.json`).type('application/json').send(JSON.stringify(library.inlineMedia(quiz), null, 2));
      }
    } catch {
      res.sendStatus(404);
    }
  });
  api.post('/media', express.raw({ type: () => true, limit: '40mb' }), handle(req => ({ url: library.addMedia(req.body, String(req.headers['content-type'] || '').split(';')[0]) })));
  api.get('/cloud', handle(() => ({ ...cloud.view(), suggestions: cloud.suggestions(), canPick: process.platform === 'win32' })));
  api.post('/cloud/choose', handle(async req => { if (req.body.folder) proLocked('cloud'); cloud.choose(req.body.folder); if (cloud.folder()) await cloud.sync(); return cloud.view(); }));
  api.post('/cloud/sync', handle(async () => { await cloud.sync(); return cloud.view(); }));
  api.post('/cloud/pick', handle(req => new Promise(resolve => {
    if (process.platform !== 'win32' || !network.isLocal(req.socket.remoteAddress)) return resolve({ error: 'cloud.typeIt' });
    const ps = 'Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; '
      + '$d.Description = \'Quizbrew\'; $d.ShowNewFolderButton = $true; '
      + '$w = New-Object System.Windows.Forms.Form -Property @{TopMost=$true}; '
      + 'if ($d.ShowDialog($w) -eq \'OK\') { [Console]::OutputEncoding = [Text.Encoding]::UTF8; $d.SelectedPath }';
    execFile('powershell', ['-NoProfile', '-STA', '-Command', ps], { windowsHide: true }, (err, out) => resolve(err ? { error: 'cloud.typeIt' } : { path: String(out).trim() }));
  })));
  api.post('/cloud/open', handle(() => { if (cloud.folder() && process.platform === 'win32') execFile('explorer', [cloud.folder()]); return { ok: true }; }));
  // Free pictures: search Wikimedia Commons and Openverse, or fetch the picture behind a dragged or pasted link.
  const findPictures = Pictures.cached();
  api.get('/pictures', handle(req => findPictures(req.query.q, { fetch: webFetch })));
  api.get('/pictures/get', async (req, res) => {
    try {
      const { type, buffer } = await Pictures.get(req.query.url, { fetch: webFetch });
      res.type(type).set('Cache-Control', 'no-store').send(buffer);
    } catch (err) {
      res.status(400).json({ error: /^pictures\./.test(err.message) ? err.message : 'pictures.noPicture' });
    }
  });
  // A picture made by the image AI; the builder makes it small like any other picture.
  api.post('/ai/image', async (req, res) => {
    try {
      proLocked('aiImage');
      const { type, buffer } = await ai.makeImage(req.body.prompt);
      res.type(type).set('Cache-Control', 'no-store').send(buffer);
    } catch (err) {
      res.status(400).json({ error: err.key || (/^pro\./.test(err.message) ? err.message : 'ai.failed'), detail: err.detail || '' });
    }
  });
  api.get('/ai/settings', handle(() => ai.publicSettings()));
  api.put('/ai/settings', handle(req => ai.update(req.body)));
  api.post('/ai/prompt', handle(req => { const o = aiDemo(req.body); return { prompt: o.whole ? Ai.quizPrompt(o) : Ai.roundPrompt(o) }; }));
  api.post('/ai/parse', handle(req => aiDemoOut(req.body.whole ? { quiz: Ai.parseQuiz(req.body.text) } : { questions: Ai.parseRound(req.body.text, req.body.type) })));
  api.post('/ai/generate', handle(async req => { const o = aiDemo(req.body); return aiDemoOut(o.whole ? { quiz: await ai.generateQuiz(o) } : { questions: await ai.generateRound(o) }); }));
  // The installed Windows app runs without a window: the quizmaster stops it from the settings.
  api.get('/app', handle(() => ({ quit: !!onQuit })));
  api.post('/quit', handle(() => {
    if (!onQuit) throw new Error('error.generic');
    setTimeout(onQuit, 300);
    return { ok: true };
  }));
  app.use('/api/host', api);

  app.get('/lang/:code.json', (req, res) => {
    const code = i18n.isSupported(req.params.code) ? req.params.code : i18n.DEFAULT;
    res.set('Cache-Control', 'no-cache').json(i18n.dictionary(code));
  });

  app.get('/api/info', async (req, res) => {
    const { url, qr } = await joinInfo();
    res.json({ url, qr, language: language(), languages: i18n.LANGUAGES, look: look(), looks: LOOKS, license: publicLicense(), mode: mode(), modes: MODES, colors: TEAM_COLORS });
  });

  // What every screen may know: demo or Pro (the big screen shows a small "Demo" label).
  function publicLicense() { return { pro: pro(), freeLooks: License.FREE.looks, teams: game.maxTeams }; }

  const REACTIONS = 5; // the length of QB.REACTIONS in public/js/common.js

  io.on('connection', socket => {
    const role = socket.handshake.query.role;
    const on = (event, fn) => socket.on(event, (...args) => {
      try { fn(...args); } catch (err) {
        console.error(`Error in '${event}':`, err);
        const cb = args[args.length - 1];
        if (typeof cb === 'function') cb({ error: 'error.generic' });
      }
    });

    socket.emit('language', language());
    socket.emit('look', look());
    socket.emit('mode', mode());
    socket.emit('sfx', settings.get('sfx') !== false);
    socket.emit('brand', brand());
    socket.emit('license', publicLicense());

    if (role === 'host') {
      if (!canHost(socket.handshake.address) && !isRemote(socket.handshake.query.key)) return socket.disconnect(true);
      socket.join('host');
      socket.emit('state', game.hostState());
      socket.emit('raffleState', raffleView());
      socket.emit('auto', autopilot.view());
      if (ratedQuiz === game.quiz) socket.emit('rating', ratingView());
      on('quizzes', cb => {
        const flat = (node, out = []) => { node.quizzes.forEach(q => out.push(q)); node.folders.forEach(f => flat(f, out)); return out; };
        cb({ samples: samples(), hiddenSamples: hiddenSamples().length, library: flat(library.tree()).sort((a, b) => b.modified - a.modified), ratings: readRatings() });
      });
      on('load', (ref, cb) => {
        try {
          // The demo plays the examples in full (a taste of Pro); its own quizzes keep the free round types only.
          let quiz = quizFor(ref);
          let skipped = [];
          if (!pro() && ref && typeof ref === 'object') {
            ({ quiz, skipped } = License.trim(quiz));
            if (!quiz.rounds.length) return cb && cb({ error: 'pro.noFreeRounds' });
          }
          game.maxTeams = pro() ? MAX_TEAMS : License.FREE.teams;
          game.load(quiz);
          currentRef = ref;
          statsSaved = false;
          cb && cb({ ok: true, skipped });
        } catch (err) {
          cb && cb({ error: 'error.quizInvalid', detail: err.message.replace(/^Invalid quiz: /, '') });
        }
      });
      on('judge', ({ teamId, correct } = {}) => game.judge(String(teamId), !!correct));
      on('judgeLink', ({ teamId, group, correct } = {}) => game.judgeLink(String(teamId), group, !!correct));
      on('buzzJudge', right => game.judgeBuzz(!!right));
      // Play the sound of the question again (or stop it) on the big screen.
      on('media', action => { if (['replay', 'stop'].includes(action)) io.to('screen').emit('media', action); });
      on('next', () => game.next());
      on('back', () => game.back());
      on('addTime', () => game.addTime());
      on('break', () => game.startBreak());
      on('endBreak', () => game.endBreak());
      on('stop', () => { forgetLive(); game.stop(); });
      on('resume', cb => {
        const saved = readLive();
        try {
          if (!saved) throw new Error('nothing saved');
          currentRef = saved.ref || null;
          statsSaved = false;
          game.resume(saved);
          cb && cb({ ok: true });
        } catch (err) {
          console.error('Could not resume:', err.message);
          game.resumable = null;
          forgetLive();
          game.broadcast();
          cb && cb({ error: 'error.generic' });
        }
      });
      on('discard', () => { game.resumable = null; forgetLive(); game.broadcast(); });
      on('kick', teamId => game.kick(String(teamId)));
      on('paperTeam', (name, cb) => { const r = game.addPaperTeam(name); if (typeof cb === 'function') cb(r); });
      on('paperPoints', ({ teamId, round, points } = {}) => game.setPaperPoints(String(teamId), round, points));
      on('raffle', (opts, cb) => { const r = pro() ? drawRaffle(opts) : { error: 'pro.locked.raffle' }; if (typeof cb === 'function') cb(r); });
      on('raffleHide', () => io.to('screen').emit('raffle', null));
      on('autopilot', value => { if (!pro()) return; settings.set('autopilot', !!value); autopilot.set(!!value); });
      on('raffleReset', () => { raffleWinners = []; io.to('host').emit('raffleState', raffleView()); });
      on('score', ({ teamId, delta } = {}) => game.adjustScore(String(teamId), Number(delta)));
      on('look', name => {
        if (!LOOKS.includes(name) || !lookFree(name)) return;
        settings.set('look', name);
        io.emit('look', name);
      });
      on('sfx', value => {
        settings.set('sfx', !!value);
        io.emit('sfx', !!value);
      });
      on('mode', name => {
        if (!MODES.includes(name)) return;
        settings.set('mode', name);
        io.emit('mode', name);
      });
      on('language', code => {
        if (!i18n.isSupported(code)) return;
        settings.set('language', code);
        game.language = code;
        io.emit('language', code);
      });
      return;
    }

    // A phone doing the connection test: tell the quizmaster it got through.
    if (role === 'check') {
      io.to('host').emit('checkHit', { device: deviceName(socket.handshake.headers['user-agent']), at: Date.now() });
      socket.emit('checked');
      return;
    }

    if (role === 'screen') {
      socket.join('screen');
      socket.emit('state', game.screenState());
      socket.emit('audience', audience.screenView());
      return;
    }

    // Everyone else is a phone. The address it came in on works: remember it if nothing was chosen yet.
    const cameIn = network.hostIp(socket.handshake.headers.host);
    if (cameIn && !settings.get('address') && lanAddresses().includes(cameIn)) {
      settings.set('address', cameIn);
      if (cameIn !== lanAddresses()[0]) announceJoin();
    }
    socket.join('lobby');
    let teamId = null;
    const claimed = socket.handshake.query.teamId;
    if (typeof claimed === 'string' && TEAM_ID.test(claimed) && game.teams.has(claimed)) {
      teamId = claimed;
      socket.leave('lobby');
      socket.join(`team:${teamId}`);
      game.join(teamId, '', '', socket.id);
    } else {
      socket.emit('state', game.teamState(null));
    }

    on('join', ({ teamId: id, name, color } = {}, cb) => {
      if (typeof cb !== 'function') return;
      if (typeof id !== 'string' || !TEAM_ID.test(id)) return cb({ error: 'error.generic' });
      const result = game.join(id, name, color, socket.id);
      if (result.ok) {
        if (teamId && teamId !== id) { socket.leave(`team:${teamId}`); game.disconnect(socket.id); }
        teamId = id;
        socket.leave('lobby');
        socket.join(`team:${id}`);
        socket.emit('state', game.teamState(id));
      }
      cb(result);
    });
    // A drawing or a photo comes with a callback: the phone keeps sending until the laptop says it has it,
    // so a picture sent while the wifi hiccups (or right after the camera app closed) still arrives.
    on('answer', (choice, cb) => {
      const reply = typeof cb === 'function' ? cb : () => {};
      if (!teamId) return reply({ error: 'error.generic' });
      // A drawing or a photo: store the picture first, the game only keeps its url.
      const m = typeof choice === 'string' && /^data:(image\/(?:webp|png|jpeg));base64,(.+)$/.exec(choice);
      if (m) {
        try { choice = library.addMedia(Buffer.from(m[2], 'base64'), m[1]); } catch { return reply({ error: 'play.photoFailed' }); }
      }
      const team = game.teams.get(teamId);
      // The same picture again (a retry after a lost answer): it is there already.
      if (m && team && team.answer === choice) return reply({ ok: true });
      reply(game.answer(teamId, choice) ? { ok: true } : { error: 'error.generic' });
    });
    on('vote', choice => teamId && game.castVote(teamId, choice));
    // The audience: no team, a nickname, their own score.
    let audienceId = null;
    on('audienceJoin', ({ id, name } = {}, cb) => {
      if (typeof cb !== 'function') return;
      if (typeof id !== 'string' || !TEAM_ID.test(id)) return cb({ error: 'error.generic' });
      if (!pro()) return cb({ error: 'pro.locked.audience' });
      const result = audience.join(id, name, socket.id);
      if (result.ok) {
        audienceId = id;
        socket.leave('lobby');
        socket.join(`aud:${id}`);
        audience.update();
      }
      cb(result);
    });
    on('audienceAnswer', i => audienceId && audience.answer(audienceId, i));
    on('audienceLeave', () => {
      if (!audienceId) return;
      socket.leave(`aud:${audienceId}`);
      audience.leave(audienceId);
      audienceId = null;
      socket.join('lobby');
      socket.emit('state', game.teamState(null));
    });
    on('wager', amount => teamId && game.setWager(teamId, Number(amount)));
    on('bank', () => teamId && game.bankPot(teamId));
    on('lifeline', () => teamId && game.useLifeline(teamId));
    on('joker', () => teamId && game.playJoker(teamId));
    on('power', name => teamId && game.usePower(teamId, String(name)));
    on('leftPage', info => teamId && game.leftPage(teamId, { sleep: !!(info && info.sleep === true) }));
    on('backOnPage', ms => teamId && game.backOnPage(teamId, ms));
    on('rate', stars => teamId && rate(teamId, stars));
    // Team photo: a small square picture from the phone (the phone makes it small first).
    on('photo', data => {
      const m = teamId && typeof data === 'string' && data.length < 1.5e6 && /^data:(image\/(?:webp|png|jpeg));base64,(.+)$/.exec(data);
      if (!m) return;
      try { game.setPhoto(teamId, library.addMedia(Buffer.from(m[2], 'base64'), m[1])); } catch { /* not a picture */ }
    });
    // A reaction (an index into the emoji list on the phones) floats up on the big screen.
    // At most one every 600 ms per phone, so a crowd of thumbs cannot flood the screen.
    let lastReact = 0;
    on('react', i => {
      const team = teamId && game.teams.get(teamId);
      const now = Date.now();
      if (!team || !Number.isInteger(i) || i < 0 || i >= REACTIONS || now - lastReact < 600) return;
      lastReact = now;
      io.to('screen').emit('react', { i, color: team.color });
    });
    socket.on('disconnect', () => { if (teamId) game.disconnect(socket.id); if (audienceId) audience.disconnect(socket.id); });
  });

  return {
    app, io, server, game, remoteKey, cloud, license,
    listen: (p = port) => new Promise(resolve => server.listen(p, () => resolve(server.address().port))),
    close: () => new Promise(resolve => { clearInterval(cloudTimer); clearInterval(proWatch); clearTimeout(cloudSoon); clearTimeout(saveSoon); game.reset(); io.close(); server.close(() => resolve()); }),
  };
}

module.exports = { LOOKS, MODES, createServer };
