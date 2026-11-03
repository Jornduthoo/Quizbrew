// The Quizbrew server: static screens, a few JSON routes and the live game over socket.io.
const http = require('http');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const { Game, validateQuiz } = require('./game');
const { TEAM_COLORS } = require('./teams');
const i18n = require('./i18n');
const quizzes = require('./quizzes');
const network = require('./network');
const Settings = require('./settings');
const Library = require('./library');
const Ai = require('./ai');
const csv = require('./csv');
const rounds = require('./rounds');

const TEAM_ID = /^[a-z0-9]{8,40}$/;

function createServer({ port = 3000, settings = Settings.create(), library = Library.create(), lanAddresses = network.lanAddresses, hostFromAnywhere = false } = {}) {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { serveClient: true, pingInterval: 10000, pingTimeout: 8000 });
  const pub = path.join(__dirname, '..', 'public');

  const language = () => (i18n.isSupported(settings.get('language')) ? settings.get('language') : i18n.DEFAULT);
  const canHost = address => hostFromAnywhere || network.isLocal(address);
  const joinUrl = () => {
    const addr = lanAddresses()[0] || 'localhost';
    return `http://${addr}:${server.address() ? server.address().port : port}/play`;
  };

  const game = new Game({
    emit: (target, event, payload) => io.to(target).emit(event, payload),
  });
  const ai = Ai.create(settings);

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
  api.use(express.json({ limit: '60mb' }));
  const handle = fn => async (req, res) => {
    try {
      res.json(await fn(req, res));
    } catch (err) {
      if (err instanceof Ai.AiError || /^ai\./.test(err.message)) return res.status(400).json({ error: err.key || err.message, detail: err.detail || '' });
      res.status(400).json({ error: 'error.generic', detail: err.message });
    }
  };
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
  api.post('/media', express.raw({ type: () => true, limit: '12mb' }), handle(req => ({ url: library.addMedia(req.body, String(req.headers['content-type'] || '').split(';')[0]) })));
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
    res.json({ url, qr, language: language(), languages: i18n.LANGUAGES, colors: TEAM_COLORS });
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

    if (role === 'host') {
      if (!canHost(socket.handshake.address)) return socket.disconnect(true);
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
      // Play the sound of the question again (or stop it) on the big screen.
      on('media', action => { if (['replay', 'stop'].includes(action)) io.to('screen').emit('media', action); });
      on('next', () => game.next());
      on('stop', () => game.stop());
      on('kick', teamId => game.kick(String(teamId)));
      on('score', ({ teamId, delta } = {}) => game.adjustScore(String(teamId), Number(delta)));
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
      game.join(teamId, '', '', socket.id);
      socket.leave('lobby');
    } else {
      socket.emit('state', game.teamState(null));
    }

    on('join', ({ teamId: id, name, color } = {}, cb) => {
      if (typeof cb !== 'function') return;
      if (typeof id !== 'string' || !TEAM_ID.test(id)) return cb({ error: 'error.generic' });
      const result = game.join(id, name, color, socket.id);
      if (result.ok) {
        teamId = id;
        socket.leave('lobby');
        socket.emit('state', game.teamState(id));
      }
      cb(result);
    });
    on('answer', choice => teamId && game.answer(teamId, choice));
    on('wager', amount => teamId && game.setWager(teamId, Number(amount)));
    on('joker', () => teamId && game.playJoker(teamId));
    on('leftPage', () => teamId && game.leftPage(teamId));
    socket.on('disconnect', () => teamId && game.disconnect(socket.id));
  });

  return {
    app, io, server, game,
    listen: () => new Promise(resolve => server.listen(port, () => resolve(server.address().port))),
    close: () => new Promise(resolve => { game.reset(); io.close(); server.close(() => resolve()); }),
  };
}

module.exports = { createServer };
