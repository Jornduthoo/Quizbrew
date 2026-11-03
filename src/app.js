// The Quizbrew server: static screens, a few JSON routes and the live game over socket.io.
const http = require('http');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const { Game } = require('./game');
const { TEAM_COLORS } = require('./teams');
const i18n = require('./i18n');
const quizzes = require('./quizzes');
const network = require('./network');
const Settings = require('./settings');

const TEAM_ID = /^[a-z0-9]{8,40}$/;

function createServer({ port = 3000, settings = Settings.create(), lanAddresses = network.lanAddresses, hostFromAnywhere = false } = {}) {
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
      on('quizzes', cb => cb(quizzes.list()));
      on('load', (file, cb) => {
        game.load(quizzes.load(String(file)));
        cb && cb({ ok: true });
      });
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
    socket.on('disconnect', () => teamId && game.disconnect(socket.id));
  });

  return {
    app, io, server, game,
    listen: () => new Promise(resolve => server.listen(port, () => resolve(server.address().port))),
    close: () => new Promise(resolve => { game.reset(); io.close(); server.close(() => resolve()); }),
  };
}

module.exports = { createServer };
