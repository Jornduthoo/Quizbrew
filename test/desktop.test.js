// The installed Windows app: where it keeps its data, which port it takes, and that the installer,
// the Store package and the starter agree on the ports the firewall opens.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');

const launcher = require('../desktop/launcher');
const { winVersion, SHIP, windowsApp, subsystem } = require('../desktop/build');
const Settings = require('../src/settings');
const Library = require('../src/library');

const ROOT = path.join(__dirname, '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qb-desktop-'));
const freePort = () => new Promise(resolve => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const quiet = () => {};

test('the data folder is %LOCALAPPDATA%\\Quizbrew, or QUIZBREW_DATA when given', () => {
  assert.equal(launcher.dataDir({ LOCALAPPDATA: 'C:\\Users\\Jo\\AppData\\Local' }), path.join('C:\\Users\\Jo\\AppData\\Local', 'Quizbrew'));
  assert.equal(launcher.dataDir({ QUIZBREW_DATA: '/x/y', LOCALAPPDATA: '/a' }), '/x/y');
  assert.ok(launcher.dataDir({}).endsWith(path.join('AppData', 'Local', 'Quizbrew')));
});

test('settings and library follow QUIZBREW_DATA, and stay in data/ without it', () => {
  const before = process.env.QUIZBREW_DATA;
  const dir = tmp();
  try {
    process.env.QUIZBREW_DATA = dir;
    assert.equal(Library.create().dataDir, dir);
    Settings.create().set('language', 'nl');
    assert.ok(fs.existsSync(path.join(dir, 'settings.json')));
    delete process.env.QUIZBREW_DATA;
    assert.equal(Library.create().dataDir, path.join(ROOT, 'data'));
  } finally {
    if (before === undefined) delete process.env.QUIZBREW_DATA; else process.env.QUIZBREW_DATA = before;
  }
});

test('the starter skips a busy port, and a second start only opens the first one', async () => {
  const busy = await freePort();
  const free = await freePort();
  const blocker = net.createServer().listen(busy);
  await new Promise(r => blocker.once('listening', r));
  const env = { QUIZBREW_DATA: tmp() };
  const first = await launcher.start({ env, open: false, log: quiet, ports: [busy, free] });
  try {
    assert.equal(first.port, free);
    assert.equal(await launcher.isQuizbrew(free), true);
    assert.equal(await launcher.isQuizbrew(busy, 300), false);
    const second = await launcher.start({ env, open: false, log: quiet, ports: [busy, free] });
    assert.deepEqual(second, { already: true, port: free });
  } finally {
    await first.close();
    blocker.close();
  }
});

test('the starter says so when every port is taken', async () => {
  const busy = await freePort();
  const blocker = net.createServer().listen(busy);
  await new Promise(r => blocker.once('listening', r));
  const lines = [];
  try {
    const shown = [];
    const r = await launcher.start({ env: { QUIZBREW_DATA: tmp() }, open: false, log: l => lines.push(l), ports: [busy], alert: async m => shown.push(m) });
    assert.deepEqual(r, { failed: true });
    assert.match(lines.join('\n'), new RegExp(String(busy)));
    assert.equal(shown.length, 1, 'there is no console window, so a dialog box says it');
    assert.match(shown[0], new RegExp(String(busy)));
  } finally { blocker.close(); }
});

test('the Windows app stops from the settings, and other servers have no quit button', async () => {
  const port = await freePort();
  let quitWith = null;
  const r = await launcher.start({ env: { QUIZBREW_DATA: tmp() }, open: false, log: quiet, ports: [port], onQuit: qb => { quitWith = qb; } });
  try {
    const base = `http://127.0.0.1:${port}/api/host`;
    assert.deepEqual(await (await fetch(`${base}/app`)).json(), { quit: true });
    assert.deepEqual(await (await fetch(`${base}/quit`, { method: 'POST' })).json(), { ok: true });
    await new Promise(res => setTimeout(res, 500));
    assert.ok(quitWith && typeof quitWith.close === 'function', 'quit gets the server to close');
  } finally { await r.close(); }

  const { createServer } = require('../src/app');
  const qb = createServer({ port: 0, settings: { get: () => undefined, set: () => {} }, library: Library.create(tmp()) });
  const p2 = await qb.listen();
  try {
    assert.deepEqual(await (await fetch(`http://127.0.0.1:${p2}/api/host/app`)).json(), { quit: false });
    assert.equal((await fetch(`http://127.0.0.1:${p2}/api/host/quit`, { method: 'POST' })).status >= 400, true);
  } finally { await qb.close(); }
});

test('the log file keeps what the app would have printed', () => {
  const file = path.join(tmp(), 'sub', 'quizbrew.log');
  const log = launcher.logTo(file);
  log('Quizbrew is running.', 3001);
  log(new Error('boom'));
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /Quizbrew is running\. 3001/);
  assert.match(text, /Error: boom/);
});

test('Quizbrew.exe is made a Windows app, so no console window opens', () => {
  const exe = Buffer.alloc(0x200);
  exe.writeUInt16LE(0x5a4d, 0);
  exe.writeUInt32LE(0x80, 0x3c);
  exe.writeUInt32LE(0x4550, 0x80);
  exe.writeUInt16LE(3, 0x80 + 24 + 68);
  assert.equal(subsystem(exe), 3);
  const out = windowsApp(exe);
  assert.equal(subsystem(out), 2);
  assert.equal(subsystem(exe), 3, 'the original is left alone');
  assert.throws(() => windowsApp(Buffer.alloc(0x200)), /not an exe/);
});

test('Windows versions have four numbers', () => {
  assert.deepEqual(winVersion('0.1.0'), [0, 1, 0, 0]);
  assert.deepEqual(winVersion('1.2'), [1, 2, 0, 0]);
  assert.deepEqual(winVersion('2.3.4-beta.1'), [2, 3, 4, 0]);
});

test('the app folder ships everything the starter needs', () => {
  for (const item of SHIP) assert.ok(fs.existsSync(path.join(ROOT, item)), item);
  assert.ok(SHIP.includes('desktop/launcher.js'));
  const main = fs.readFileSync(path.join(ROOT, 'desktop', 'sea-main.js'), 'utf8');
  assert.match(main, /'app', 'desktop', 'launcher\.js'/);
});

test('installer, Store package and starter open the same ports', () => {
  const range = `${launcher.FIRST_PORT}-${launcher.LAST_PORT}`;
  const iss = fs.readFileSync(path.join(ROOT, 'desktop', 'installer.iss'), 'utf8');
  assert.ok(iss.includes(`localport=${range}`), 'installer firewall rule');
  assert.match(iss, /UninstallRun[\s\S]*delete rule name=""Quizbrew""/);
  const xml = fs.readFileSync(path.join(ROOT, 'desktop', 'msix', 'AppxManifest.xml'), 'utf8');
  assert.ok(xml.includes(`LocalPortMin="${launcher.FIRST_PORT}" LocalPortMax="${launcher.LAST_PORT}"`), 'Store firewall rule');
  for (const cap of ['internetClient', 'internetClientServer', 'privateNetworkClientServer', 'runFullTrust']) assert.ok(xml.includes(`Name="${cap}"`), cap);
  for (const png of xml.match(/assets\\[\w.]+\.png/g)) assert.ok(fs.existsSync(path.join(ROOT, 'desktop', png.replace('\\', '/'))), png);
  const store = JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop', 'msix', 'store.json'), 'utf8'));
  assert.ok(store.identityName && /^CN=/.test(store.publisher) && store.publisherDisplayName);
});

test('Store version: a bought copy is Pro, the free trial is the demo, the answer is remembered', async () => {
  const Store = require('../desktop/store');
  const License = require('../src/license');
  const dir = tmp();
  let answer = { ok: true, active: true, trial: true };
  const ask = done => done(answer);
  const settings = { values: {}, get(k) { return this.values[k]; }, set(k, v) { this.values[k] = v; } };
  let store = Store.create({ dataDir: dir, storeId: '9NTEST', ask, every: 0 });
  const lic = License.create(settings, { store });
  await store.check();
  assert.equal(lic.pro(), false, 'trial = demo');
  assert.equal(lic.view().store, true);
  assert.equal(lic.view().shop, 'ms-windows-store://pdp/?ProductId=9NTEST');
  answer = { ok: true, active: true, trial: false };
  await store.check();
  assert.equal(lic.pro(), true, 'bought = Pro');
  assert.equal(lic.view().kind, 'store');
  // Windows can't answer at the next start: the last answer counts.
  answer = { ok: false, error: 'offline' };
  store = Store.create({ dataDir: dir, ask, every: 0 });
  assert.equal(store.pro(), true, 'remembered before asking');
  await store.check();
  assert.equal(store.pro(), true, 'still Pro when the Store is silent');
  assert.equal(Store.packaged('C:\\Program Files\\WindowsApps\\Quizbrew_0.1.0.0_x64__abc\\Quizbrew.exe'), true);
  assert.equal(Store.packaged('C:\\Program Files\\Quizbrew\\Quizbrew.exe'), false);
  assert.deepEqual(License.create(settings).view().store, false);
});
