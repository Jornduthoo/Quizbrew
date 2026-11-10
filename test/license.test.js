// Demo or Pro: signed codes that work offline, and the limits of the free demo.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { io: connect } = require('socket.io-client');
const License = require('../src/license');
const { createServer } = require('../src/app');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const memorySettings = () => { const v = {}; return { get: k => v[k], set: (k, x) => { v[k] = x; } }; };

test('a signed code reads back, typed sloppily too; a changed or foreign code does not', () => {
  const until = Date.UTC(2027, 0, 15);
  const code = License.sign(privateKey, { name: 'Marieke', kind: 'tester', until });
  assert.match(code, /^QB-[0-9A-Z]{5}(-[0-9A-Z]{1,5})+$/);
  const info = License.decode(code, publicKey);
  assert.equal(info.name, 'Marieke');
  assert.equal(info.kind, 'tester');
  assert.ok(Math.abs(info.until - until) <= 86400000);
  assert.deepEqual(License.decode(' ' + code.toLowerCase().replace(/-/g, ' ') + '\n', publicKey), info);
  // One character changed: the signature no longer fits.
  const body = code.slice(3);
  const bad = 'QB-' + body.slice(0, 20) + (body[20] === 'A' ? 'B' : 'A') + body.slice(21);
  assert.equal(License.decode(bad, publicKey), null);
  // Signed with another key (somebody's own generator): refused.
  const other = crypto.generateKeyPairSync('ed25519');
  assert.equal(License.decode(License.sign(other.privateKey, { name: 'Me' }), publicKey), null);
  // A code made with a test key is no good for the real app either.
  assert.equal(License.decode(code), null);
  assert.equal(License.decode('hello'), null);
  assert.equal(License.decode(''), null);
});

test('activating: Pro for good, a tester code until its end date', () => {
  const settings = memorySettings();
  let now = Date.UTC(2026, 10, 5);
  const lic = License.create(settings, { publicKey, now: () => now });
  assert.equal(lic.pro(), false);
  assert.throws(() => lic.activate('QB-NOPE'), /pro\.badCode/);
  const v = lic.activate(License.sign(privateKey, { name: 'Bar Zoet' }));
  assert.equal(v.pro, true);
  assert.equal(v.name, 'Bar Zoet');
  assert.equal(v.until, null);
  lic.remove();
  assert.equal(lic.pro(), false);
  lic.activate(License.sign(privateKey, { name: 'Tom', kind: 'tester', until: now + 10 * 86400000 }));
  assert.equal(lic.view().kind, 'tester');
  assert.equal(lic.pro(), true);
  now += 11 * 86400000;
  assert.equal(lic.pro(), false);
  assert.equal(lic.view().expired, true);
  assert.throws(() => lic.activate(License.sign(privateKey, { name: 'Late', kind: 'tester', until: now - 86400000 })), /pro\.expiredCode/);
});

test('the demo keeps the free round types, twists and scorings of a quiz', () => {
  const quiz = { title: 'Mix', rounds: [
    { type: 'classic', scoring: 'ladder', twists: ['double', 'blackout'], questions: [] },
    { type: 'zoomOut', questions: [] },
    { type: 'speed', scoring: 'speed', twists: [], questions: [] },
  ] };
  const { quiz: out, skipped } = License.trim(quiz);
  assert.deepEqual(skipped, ['zoomOut']);
  assert.deepEqual(out.rounds.map(r => r.type), ['classic', 'speed']);
  assert.deepEqual(out.rounds[0].twists, ['double']);
  assert.ok(License.FREE.scorings.includes(out.rounds[0].scoring));
  assert.equal(out.rounds[1].scoring, 'speed');
  assert.equal(License.FREE.types.length, 15);
});

test('the demo over the network: 4 teams, one look, no venue, 3 quizzes, a capped AI; a code opens it all', async t => {
  const settings = memorySettings();
  const library = require('../src/library').create(fs.mkdtempSync(path.join(os.tmpdir(), 'qb-lic-')));
  const qb = createServer({ port: 0, settings, library, lanAddresses: () => ['192.168.1.50'], license: License.create(settings, { publicKey }) });
  const port = await qb.listen();
  const url = `http://127.0.0.1:${port}`;
  const sockets = [];
  const open = query => { const s = connect(url, { query, transports: ['websocket'], forceNew: true }); sockets.push(s); return s; };
  t.after(async () => { sockets.forEach(s => s.close()); await qb.close(); });
  const call = (method, p, body) => fetch(url + '/api/host' + p, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) }).then(async r => ({ status: r.status, body: await r.json() }));

  assert.equal((await call('GET', '/license')).body.pro, false);
  assert.equal((await fetch(`${url}/api/info`).then(r => r.json())).license.pro, false);
  assert.equal((await fetch(`${url}/print`, { redirect: 'manual' })).headers.get('location'), '/host#pro-print');
  assert.equal((await call('PUT', '/brand', { venue: 'Bar Zoet' })).body.error, 'pro.locked.venue');
  assert.equal((await call('POST', '/ai/image', { prompt: 'a cat' })).body.error, 'pro.locked.aiImage');
  assert.equal((await call('POST', '/ai/prompt', { type: 'zoomOut', count: 5 })).body.error, 'pro.locked.types');
  assert.match((await call('POST', '/ai/prompt', { type: 'classic', count: 25 })).body.prompt, /\b10\b/);
  assert.doesNotMatch((await call('POST', '/ai/prompt', { whole: true })).body.prompt, /- zoomOut -/);

  // Three quizzes of its own, then the Pro dialog.
  for (let i = 0; i < 3; i++) assert.equal((await call('PUT', '/library/quiz', { quiz: { title: `Q${i}`, rounds: [] } })).status, 200);
  assert.equal((await call('PUT', '/library/quiz', { quiz: { title: 'Q4', rounds: [] } })).body.error, 'pro.locked.quizzes');

  const host = open({ role: 'host' });
  await new Promise(r => host.on('connect', r));
  host.emit('look', 'space');
  host.emit('autopilot', true);
  assert.deepEqual(await new Promise(r => host.emit('raffle', {}, r)), { error: 'pro.locked.raffle' });
  await new Promise(r => host.emit('load', 'pub-warm-up.json', r));
  assert.equal(settings.get('look'), undefined);
  assert.notEqual(settings.get('autopilot'), true);

  const join = (i, sock = open({ role: 'player' })) => new Promise(r => sock.emit('join', { teamId: `team000${i}x`, name: `Team ${i}`, color: require('../src/teams').TEAM_COLORS[i] }, r));
  for (let i = 0; i < 4; i++) assert.equal((await join(i)).ok, true);
  assert.equal((await join(4)).error, 'error.demoFull');
  assert.deepEqual(await new Promise(r => open({ role: 'player' }).emit('audienceJoin', { id: 'aud00000001', name: 'Fan' }, r)), { error: 'pro.locked.audience' });

  // A real code: everything opens, live.
  assert.equal((await call('POST', '/license', { code: 'QB-12345' })).body.error, 'pro.badCode');
  const lic = open({ role: 'screen' });
  const heard = new Promise(r => lic.on('license', l => { if (l.pro) r(l); }));
  const v = await call('POST', '/license', { code: License.sign(privateKey, { name: 'Bar Zoet' }) });
  assert.equal(v.body.pro, true);
  assert.equal((await heard).teams, 40);
  assert.equal((await join(4)).ok, true);
  assert.equal((await call('PUT', '/library/quiz', { quiz: { title: 'Q4', rounds: [] } })).status, 200);
  assert.equal((await call('PUT', '/brand', { venue: 'Bar Zoet' })).body.venue, 'Bar Zoet');
  assert.equal((await fetch(`${url}/print`, { redirect: 'manual' })).status, 200);
});

test('a Store purchase while Quizbrew runs opens Pro on every screen, without a restart', async t => {
  const settings = memorySettings();
  const library = require('../src/library').create(fs.mkdtempSync(path.join(os.tmpdir(), 'qb-lic-')));
  let bought = false;
  const store = { pro: () => bought, url: 'ms-windows-store://pdp/?ProductId=X', status: () => ({ bought }) };
  const qb = createServer({ port: 0, settings, library, lanAddresses: () => ['192.168.1.50'], license: License.create(settings, { publicKey, store }) });
  const port = await qb.listen();
  const url = `http://127.0.0.1:${port}`;
  const screen = connect(url, { query: { role: 'screen' }, transports: ['websocket'], forceNew: true });
  t.after(async () => { screen.close(); await qb.close(); });
  const view = await fetch(url + '/api/host/license').then(r => r.json());
  assert.equal(view.pro, false);
  assert.equal(view.store, true);
  assert.equal(view.price, License.PRICE);
  assert.equal(view.currency, 'EUR');
  assert.equal(qb.game.teamLimit(), 4);
  const heard = new Promise(r => screen.on('license', l => { if (l.pro) r(l); }));
  bought = true;
  assert.equal((await heard).teams, 40);
  assert.equal(qb.game.teamLimit(), 40);
});

test('make-code refuses to run without the private key', () => {
  const r = require('child_process').spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'make-code.js'), '--name', 'X'], { env: { ...process.env, QUIZBREW_PRIVATE_KEY: path.join(os.tmpdir(), 'no-such-key.pem') }, encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /No private key/);
});

test('the demo imports JSON and CSV files: Pro rounds stay in the quiz, locked, and are left out at play time', async t => {
  const settings = memorySettings();
  const library = require('../src/library').create(fs.mkdtempSync(path.join(os.tmpdir(), 'qb-lic-')));
  const qb = createServer({ port: 0, settings, library, lanAddresses: () => ['192.168.1.50'], license: License.create(settings, { publicKey }) });
  const port = await qb.listen();
  const url = `http://127.0.0.1:${port}`;
  const sockets = [];
  t.after(async () => { sockets.forEach(s => s.close()); await qb.close(); });
  const call = (method, p, body) => fetch(url + '/api/host' + p, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) }).then(async r => ({ status: r.status, body: await r.json() }));
  assert.equal((await call('GET', '/license')).body.pro, false);

  // A quiz with free and Pro rounds, as somebody else exported it.
  const tour = require('../src/quizzes').load('round-tour.json');
  assert.ok(tour.rounds.some(r => !License.FREE.types.includes(r.type)) && tour.rounds.some(r => License.FREE.types.includes(r.type)));
  const json = await fetch(`${url}/api/host/export?sample=round-tour.json`).then(r => r.text());
  const csvText = await fetch(`${url}/api/host/export?sample=round-tour.json&format=csv`).then(r => r.text());
  const a = await call('POST', '/import', { name: 'Round Tour.quizbrew.json', text: json });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.deepEqual(a.body.quiz.rounds.map(r => r.type), tour.rounds.map(r => r.type));
  const b = await call('POST', '/import', { name: 'Round Tour.csv', text: csvText });
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.deepEqual(b.body.quiz.rounds.map(r => r.type), tour.rounds.map(r => r.type));

  // Playing it in the demo leaves the Pro rounds out and says how many.
  const host = connect(url, { query: { role: 'host' }, transports: ['websocket'], forceNew: true });
  sockets.push(host);
  await new Promise(r => host.on('connect', r));
  const loaded = await new Promise(r => host.emit('load', { library: a.body.path }, r));
  assert.equal(loaded.ok, true, JSON.stringify(loaded));
  assert.equal(loaded.skipped.length, tour.rounds.filter(r => !License.FREE.types.includes(r.type)).length);

  // Imports count as the demo's own quizzes: the fourth asks for Pro.
  assert.equal((await call('POST', '/import', { name: 'c.json', text: json })).status, 200);
  assert.equal((await call('POST', '/import', { name: 'd.json', text: json })).body.error, 'pro.locked.quizzes');
});
