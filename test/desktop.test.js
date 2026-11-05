// The installed Windows app: where it keeps its data, which port it takes, and that the installer,
// the Store package and the starter agree on the ports the firewall opens.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');

const launcher = require('../desktop/launcher');
const { winVersion, SHIP } = require('../desktop/build');
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
    const r = await launcher.start({ env: { QUIZBREW_DATA: tmp() }, open: false, log: l => lines.push(l), ports: [busy] });
    assert.deepEqual(r, { failed: true });
    assert.match(lines.join('\n'), new RegExp(String(busy)));
  } finally { blocker.close(); }
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
