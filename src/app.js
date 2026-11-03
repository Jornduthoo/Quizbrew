// The Quizbrew server: static screens, a few JSON routes and the live game over socket.io.
const http = require('http');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { Game, validateQuiz } = require('./game');
const { TEAM_COLORS } = require('./teams');
const i18n = require('./i18n');
const quizzes = require('./quizzes');
const network = require('./network');
const Settings = require('./settings');
const Library = require('./library');
const Cloud = require('./cloud');
const Ai = require('./ai');
const csv = require('./csv');
const rounds = require('./rounds');

const TEAM_ID = /^[a-z0-9]{8,40}$/;

const LOOKS = ['pub', 'space', 'jungle', 'spooky', 'arcade'];

function createServer({ port = 3000, settings = Settings.create(), library = Library.create(), lanAddresses = network.lanAddresses, hostFromAnywhere = false, cloudEvery = 60000 } = {}) {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { serveClient: true, pingInterval: 10000, pingTimeout: 8000, maxHttpBufferSize: 3e6 });
  const pub = path.join(__dirname, '..', 'public');

  // The look of the evening (backgrounds, colours, fonts) for every screen. Pub is the default.
  const look = () => (LOOKS.includes(settings.get('look')) ? settings.get('look') : LOOKS[0]);
  const language = () => (i18n.isSupported(settings.get('language')) ? settings.get('language') : i18n.DEFAULT);
  const canHost = address => hostFromAnywhere || network.isLocal(address);
  // The quizmaster's remote: a phone or tablet on the wifi with the secret link (new on every start) may drive the quiz.
  const remoteKey = crypto.randomBytes(9).toString('hex');
  const isRemote = key => typeof key === 'string' && key.length === remoteKey.length && crypto.timingSafeEqual(Buffer.from(key), Buffer.from(remoteKey));
  const baseUrl = () => joinUrl().replace(/\/play$/, '');
  const joinUrl = () => {
    const addr = lanAddresses()[0] || 'localhost';
    return `http://${addr}:${server.address() ? server.address().port : port}/play`;
  };

  const game = new Game({
    emit: (target, event, payload) => io.to(target).emit(event, payload),
  });
  const ai = Ai.create(settings);

  // My quiz folder in OneDrive or Google Drive: at start, every minute, and a few seconds after every change here.
  const cloud = Cloud.create({ dataDir: library.dataDir, settings });
  let cloudSoon = null;
  const cloudLater = () => {
    if (!cloud.folder()) return;
    clearTimeout(cloudSoon);
    cloudSoon = setTimeout(() => cloud.sync(), 3000);
    cloudSoon.unref();
  };
  const cloudTimer = setInterval(() => cloud.sync(), cloudEvery);
  cloudTimer.unref();
  cloud.sync();

  // A quiz to play: a bundled sample by file name, or { library: 'folder/quiz.json' }.
  const quizFor = ref => (ref && typeof ref === 'object' && ref.library ? library.read(String(ref.library)) : quizzes.load(String(ref)));

  app.disable('x-powered-by');
  app.use('/img', express.static(path.join(pub, 'img'), { maxAge: '7d' }));
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
    res.sendFile(path.join(pub, 'print.html'));
  });
  app.get('/screen', (req, res) => res.sendFile(path.join(pub, 'screen.html')));
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
      if (/^cloud\./.test(err.message)) return res.status(400).json({ error: err.message });
      if (err instanceof Ai.AiError || /^ai\./.test(err.message)) return res.status(400).json({ error: err.key || err.message, detail: err.detail || '' });
      res.status(400).json({ error: 'error.generic', detail: err.message });
    }
  };
  api.get('/remote', handle(async () => {
    const url = `${baseUrl()}/remote?key=${remoteKey}`;
    return { url, qr: await QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#1b0f08', light: '#0000' } }) };
  }));
  api.get('/catalog', handle(() => rounds.catalog()));
  api.get('/library', handle(() => ({ tree: library.tree(), samples: quizzes.list() })));
  api.get('/library/quiz', handle(req => (req.query.sample ? quizzes.load(String(req.query.sample)) : library.read(String(req.query.path || '')))));
  api.put('/library/quiz', handle(req => library.save(req.body.path || null, req.body.quiz, { folder: req.body.folder || '' })));
  api.delete('/library/item', handle(req => { library.remove(String(req.query.path || '')); return { ok: true }; }));
  api.post('/library/folder', handle(req => { library.mkdir(String(req.body.path || '')); return { ok: true }; }));
  api.post('/library/move', handle(req => { library.move(String(req.body.from || ''), String(req.body.to || '')); return { ok: true }; }));
  api.post('/library/check', handle(req => {
    try { validateQuiz(req.body.quiz); return { ok: true }; } catch (err) { return { ok: false, problem: err.message.replace(/^Invalid quiz: /, '') }; }
  }));
  api.post('/import', handle(req => {
    const { name = '', text = '' } = req.body;
    const title = String(name).replace(/\.(json|csv|txt)$/i, '') || 'Imported quiz';
    const quiz = /\.json$/i.test(name) || String(text).trim().startsWith('{') ? JSON.parse(text) : csv.toQuiz(text, title);
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
  api.post('/cloud/choose', handle(async req => { cloud.choose(req.body.folder); if (cloud.folder()) await cloud.sync(); return cloud.view(); }));
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
  api.get('/ai/settings', handle(() => ai.publicSettings()));
  api.put('/ai/settings', handle(req => ai.update(req.body)));
  api.post('/ai/prompt', handle(req => ({ prompt: req.body.whole ? Ai.quizPrompt(req.body) : Ai.roundPrompt(req.body) })));
  api.post('/ai/parse', handle(req => (req.body.whole ? { quiz: Ai.parseQuiz(req.body.text) } : { questions: Ai.parseRound(req.body.text, req.body.type) })));
  api.post('/ai/generate', handle(async req => (req.body.whole ? { quiz: await ai.generateQuiz(req.body) } : { questions: await ai.generateRound(req.body) })));
  app.use('/api/host', api);

  app.get('/lang/:code.json', (req, res) => {
    const code = i18n.isSupported(req.params.code) ? req.params.code : i18n.DEFAULT;
    res.set('Cache-Control', 'no-cache').json(i18n.dictionary(code));
  });

  app.get('/api/info', async (req, res) => {
    const url = joinUrl();
    const qr = await QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#1b0f08', light: '#0000' } });
    res.json({ url, qr, language: language(), languages: i18n.LANGUAGES, look: look(), looks: LOOKS, colors: TEAM_COLORS });
  });

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

    if (role === 'host') {
      if (!canHost(socket.handshake.address) && !isRemote(socket.handshake.query.key)) return socket.disconnect(true);
      socket.join('host');
      socket.emit('state', game.hostState());
      on('quizzes', cb => {
        const flat = (node, out = []) => { node.quizzes.forEach(q => out.push(q)); node.folders.forEach(f => flat(f, out)); return out; };
        cb({ samples: quizzes.list(), library: flat(library.tree()).sort((a, b) => b.modified - a.modified) });
      });
      on('load', (ref, cb) => {
        try {
          game.load(quizFor(ref));
          cb && cb({ ok: true });
        } catch (err) {
          cb && cb({ error: 'error.quizInvalid', detail: err.message.replace(/^Invalid quiz: /, '') });
        }
      });
      on('judge', ({ teamId, correct } = {}) => game.judge(String(teamId), !!correct));
      on('buzzJudge', right => game.judgeBuzz(!!right));
      // Play the sound of the question again (or stop it) on the big screen.
      on('media', action => { if (['replay', 'stop'].includes(action)) io.to('screen').emit('media', action); });
      on('next', () => game.next());
      on('stop', () => game.stop());
      on('kick', teamId => game.kick(String(teamId)));
      on('score', ({ teamId, delta } = {}) => game.adjustScore(String(teamId), Number(delta)));
      on('look', name => {
        if (!LOOKS.includes(name)) return;
        settings.set('look', name);
        io.emit('look', name);
      });
      on('language', code => {
        if (!i18n.isSupported(code)) return;
        settings.set('language', code);
        io.emit('language', code);
      });
      return;
    }

    if (role === 'screen') {
      socket.join('screen');
      socket.emit('state', game.screenState());
      return;
    }

    // Everyone else is a phone.
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
    on('answer', choice => {
      if (!teamId) return;
      // A drawing or a photo: store the picture first, the game only keeps its url.
      const m = typeof choice === 'string' && /^data:(image\/(?:webp|png|jpeg));base64,(.+)$/.exec(choice);
      if (m) {
        try { choice = library.addMedia(Buffer.from(m[2], 'base64'), m[1]); } catch { return; }
      }
      game.answer(teamId, choice);
    });
    on('vote', choice => teamId && game.castVote(teamId, choice));
    on('wager', amount => teamId && game.setWager(teamId, Number(amount)));
    on('bank', () => teamId && game.bankPot(teamId));
    on('lifeline', () => teamId && game.useLifeline(teamId));
    on('joker', () => teamId && game.playJoker(teamId));
    on('leftPage', () => teamId && game.leftPage(teamId));
    socket.on('disconnect', () => teamId && game.disconnect(socket.id));
  });

  return {
    app, io, server, game, remoteKey, cloud,
    listen: () => new Promise(resolve => server.listen(port, () => resolve(server.address().port))),
    close: () => new Promise(resolve => { clearInterval(cloudTimer); clearTimeout(cloudSoon); game.reset(); io.close(); server.close(() => resolve()); }),
  };
}

module.exports = { LOOKS, createServer };
