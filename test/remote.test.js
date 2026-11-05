// The remote (/remote?key=) runs the same host.js as the laptop. If host.js touches an element the remote
// page lacks, the script stops early and the remote shows no teams and an empty stage.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const pub = path.join(__dirname, '..', 'public');
const js = fs.readFileSync(path.join(pub, 'js', 'host.js'), 'utf8');
const remote = fs.readFileSync(path.join(pub, 'remote.html'), 'utf8');

// Laptop-only tools: host.js checks for these before using them.
const LAPTOP_ONLY = /^(check-|raffle-|remote-|venue-|sponsor-|samples-restore|screen-copy|pro-|settings-pro|settings-quit)/;

test('every element host.js needs exists on the remote page', () => {
  const ids = new Set([...js.matchAll(/\$\('#([a-z0-9-]+)/g)].map(m => m[1]));
  const missing = [...ids].filter(id => !LAPTOP_ONLY.test(id) && !remote.includes(`id="${id}"`));
  assert.deepEqual(missing, []);
});

test('laptop-only tools are guarded in host.js', () => {
  for (const id of ['check-btn', 'raffle-btn', 'venue-tile', 'samples-restore', 'settings-quit']) assert.match(js, new RegExp(`if \\(\\$\\('#${id}'\\)\\)`));
  assert.match(js, /if \(!remote\) \{\s*\$\('#remote-tile'\)/);
});

test('the remote keeps the phone awake and shows when the link is lost', () => {
  assert.match(remote, /<script src="\/js\/awake\.js"><\/script>/);
  assert.match(remote, /id="remote-offline"/);
  const awake = fs.readFileSync(path.join(pub, 'js', 'awake.js'), 'utf8');
  assert.match(awake, /navigator\.wakeLock\.request\('screen'\)/);
  assert.match(awake, /playsinline/); // the fallback for plain http on the wifi
  assert.ok(fs.statSync(path.join(pub, 'img', 'awake.mp4')).size < 80000);
  assert.match(awake, /width:100vw;height:100vh/, 'Chrome only keeps the screen on for a video that covers 20% of it');
  assert.doesNotMatch(awake, /currentTime\s*=/, 'seeking the video flickers the screen on Android');
  for (const l of ['en', 'nl', 'fr', 'de', 'es']) {
    assert.ok(JSON.parse(fs.readFileSync(path.join(pub, '..', 'lang', `${l}.json`), 'utf8'))['host.remoteExpired'], l);
  }
});

test('player phones stay awake and come straight back after a dark screen', () => {
  const play = fs.readFileSync(path.join(pub, 'play.html'), 'utf8');
  assert.ok(play.indexOf('/js/awake.js') > 0 && play.indexOf('/js/awake.js') < play.indexOf('/js/play.js'));
  const js = fs.readFileSync(path.join(pub, 'js', 'play.js'), 'utf8');
  assert.match(js, /socket\.connect\(\)/);
  assert.match(js, /emit\('leftPage', \{ sleep: leftAsleep \}\)/);
  for (const l of ['en', 'nl', 'fr', 'de', 'es']) {
    assert.ok(JSON.parse(fs.readFileSync(path.join(pub, '..', 'lang', `${l}.json`), 'utf8'))['host.alertSleep'], l);
  }
});

test('a remote that comes back from sleep gets the running quiz and its teams again', async t => {
  const { io: connect } = require('socket.io-client');
  const { createServer } = require('../src/app');
  const library = require('../src/library').create(fs.mkdtempSync(path.join(require('os').tmpdir(), 'qb-')));
  const v = {};
  const qb = createServer({ port: 0, license: require('./fixtures/pro').proLicense(), settings: { get: k => v[k], set: (k, x) => { v[k] = x; } }, library, lanAddresses: () => ['192.168.1.50'] });
  const port = await qb.listen();
  const url = `http://127.0.0.1:${port}`;
  const sockets = [];
  const open = query => { const s = connect(url, { query, transports: ['websocket'], forceNew: true }); sockets.push(s); return s; };
  t.after(async () => { sockets.forEach(s => s.close()); await qb.close(); });
  const once = (s, ev, pred = () => true) => new Promise(r => { const fn = x => { if (pred(x)) { s.off(ev, fn); r(x); } }; s.on(ev, fn); });

  const host = open({ role: 'host' });
  await once(host, 'state');
  await new Promise(r => host.emit('load', 'pub-warm-up.json', r));
  const phone = open({ role: 'player' });
  await once(phone, 'state');
  await new Promise(r => phone.emit('join', { teamId: 'abcdefgh123', name: 'Owls', color: 'amber' }, r));

  const rc = open({ role: 'host', key: qb.remoteKey });
  await once(rc, 'state', s => s.teams.length === 1);
  rc.disconnect(); // the phone went to sleep
  const back = once(rc, 'state');
  rc.connect();
  const s = await back;
  assert.equal(s.phase, 'lobby');
  assert.deepEqual(s.teams.map(tm => tm.name), ['Owls']);
});

test('a remote with an old link is sent away, so the page can say to scan again', async t => {
  const lan = require('../src/network').lanAddresses()[0];
  if (!lan) return t.skip('no network address on this machine');
  const { io: connect } = require('socket.io-client');
  const { createServer } = require('../src/app');
  const library = require('../src/library').create(fs.mkdtempSync(path.join(require('os').tmpdir(), 'qb-')));
  const v = {};
  const qb = createServer({ port: 0, license: require('./fixtures/pro').proLicense(), settings: { get: k => v[k], set: (k, x) => { v[k] = x; } }, library });
  const port = await qb.listen();
  t.after(() => qb.close());
  const old = connect(`http://${lan}:${port}`, { query: { role: 'host', key: 'a'.repeat(qb.remoteKey.length) }, transports: ['websocket'], forceNew: true, reconnection: false });
  const reason = await new Promise(r => old.on('disconnect', r));
  old.close();
  assert.equal(reason, 'io server disconnect');
});
