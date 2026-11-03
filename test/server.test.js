// End to end over real sockets: host loads a quiz, a phone joins and answers, the screen follows.
const test = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const { createServer } = require('../src/app');

const tmpLibrary = () => require('../src/library').create(require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'qb-')));
const memorySettings = () => { const v = {}; return { get: k => v[k], set: (k, x) => { v[k] = x; } }; };
const once = (socket, event, pred = () => true) => new Promise(resolve => {
  const fn = s => { if (pred(s)) { socket.off(event, fn); resolve(s); } };
  socket.on(event, fn);
});

test('host, screen and phone play a question together', async t => {
  const qb = createServer({ port: 0, settings: memorySettings(), library: tmpLibrary(), lanAddresses: () => ['192.168.1.50'] });
  const port = await qb.listen();
  const url = `http://127.0.0.1:${port}`;
  const sockets = [];
  const open = query => { const s = connect(url, { query, transports: ['websocket'], forceNew: true }); sockets.push(s); return s; };
  t.after(async () => { sockets.forEach(s => s.close()); await qb.close(); });

  const info = await (await fetch(`${url}/api/info`)).json();
  assert.equal(info.url, `http://192.168.1.50:${port}/play`);
  assert.match(info.qr, /<svg/);
  assert.equal(info.language, 'en');

  for (const p of ['/host', '/screen', '/play', '/lang/nl.json', '/css/base.css', '/img/logo.webp']) {
    assert.equal((await fetch(url + p)).status, 200, p);
  }
  assert.equal((await fetch(`${url}/lang/fr.json`).then(r => r.json()))['play.join'], 'Rejoindre le quiz');

  const host = open({ role: 'host' });
  const screen = open({ role: 'screen' });
  const list = await new Promise(r => host.emit('quizzes', r));
  assert.ok(list.samples.find(q => q.file === 'pub-warm-up.json'));
  assert.ok(Array.isArray(list.library));

  const lobby = once(screen, 'state', s => s.phase === 'lobby');
  await new Promise(r => host.emit('load', 'pub-warm-up.json', r));
  await lobby;

  const phone = open({ role: 'player' });
  await once(phone, 'state');
  const joined = await new Promise(r => phone.emit('join', { teamId: 'abcdefgh123', name: 'Owls', color: 'amber' }, r));
  assert.deepEqual(joined, { ok: true, name: 'Owls', color: 'amber' });
  const bad = await new Promise(r => phone.emit('join', { teamId: 'x', name: 'Owls', color: 'amber' }, r));
  assert.equal(bad.error, 'error.generic');

  const question = once(phone, 'state', s => s.phase === 'question');
  host.emit('next');
  host.emit('next');
  const q = await question;
  assert.equal(q.question.text, 'Which planet is known as the Red Planet?');
  assert.equal(q.correct, null);

  const reveal = once(screen, 'state', s => s.phase === 'reveal');
  phone.emit('answer', 1);
  const r = await reveal;
  assert.equal(r.correct, 1);
  assert.equal(r.ranking[0].score, 1);

  // A reload of the phone with the same team id gets the team back.
  phone.close();
  const back = open({ role: 'player', teamId: 'abcdefgh123' });
  const s = await once(back, 'state', x => !!x.team);
  assert.equal(s.team.name, 'Owls');

  // Language change reaches every screen.
  const lang = once(screen, 'language');
  host.emit('language', 'nl');
  assert.equal(await lang, 'nl');

  // Phones-only mode reaches the phones; nonsense is ignored.
  const mode = once(back, 'mode');
  host.emit('mode', 'nonsense');
  host.emit('mode', 'phones');
  assert.equal(await mode, 'phones');
  assert.equal((await (await fetch(`${url}/api/info`)).json()).mode, 'phones');
});

test('host controls only work from this laptop', async t => {
  const lan = require('../src/network').lanAddresses()[0];
  if (!lan) return t.skip('no network address on this machine');
  const qb = createServer({ port: 0, settings: memorySettings(), library: tmpLibrary() });
  const port = await qb.listen();
  t.after(() => qb.close());
  // Through the network address the server sees a non-local client, like a phone would be.
  const res = await fetch(`http://${lan}:${port}/host`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/play');
  const direct = await fetch(`http://${lan}:${port}/host.html`, { redirect: 'follow' });
  assert.ok(direct.url.endsWith('/play'));
  const host = connect(`http://${lan}:${port}`, { query: { role: 'host' }, transports: ['websocket'], forceNew: true, reconnection: false });
  await once(host, 'disconnect');
  host.close();
});

test('the remote link lets a phone drive the quiz; the run sheet stays on this laptop', async t => {
  const lan = require('../src/network').lanAddresses()[0];
  if (!lan) return t.skip('no network address on this machine');
  const qb = createServer({ port: 0, settings: memorySettings(), library: tmpLibrary() });
  const port = await qb.listen();
  t.after(() => qb.close());
  const base = `http://${lan}:${port}`;
  const remote = await (await fetch(`http://127.0.0.1:${port}/api/host/remote`)).json();
  assert.match(remote.url, new RegExp(`/remote\\?key=${qb.remoteKey}$`));
  assert.match(remote.qr, /<svg/);
  assert.equal((await fetch(`${base}/remote?key=${qb.remoteKey}`, { redirect: 'manual' })).status, 200);
  assert.equal((await fetch(`${base}/remote?key=wrong`, { redirect: 'manual' })).status, 302);
  assert.equal((await fetch(`${base}/print?sample=pub-warm-up.json`, { redirect: 'manual' })).status, 302);
  assert.equal((await fetch(`http://127.0.0.1:${port}/print?sample=pub-warm-up.json`)).status, 200);
  const ok = connect(base, { query: { role: 'host', key: qb.remoteKey }, transports: ['websocket'], forceNew: true, reconnection: false });
  const s = await once(ok, 'state');
  assert.equal(s.phase, 'idle');
  ok.close();
  const bad = connect(base, { query: { role: 'host', key: 'nope' }, transports: ['websocket'], forceNew: true, reconnection: false });
  await once(bad, 'disconnect');
  bad.close();
});
