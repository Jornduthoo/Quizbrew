const test = require('node:test');
const assert = require('node:assert/strict');
const { lanAddresses, isLocal } = require('../src/network');

test('real wifi comes before virtual adapters', () => {
  const list = lanAddresses({
    'vEthernet (WSL)': [{ address: '172.28.0.1', family: 'IPv4', internal: false }],
    lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    'Wi-Fi': [{ address: '192.168.1.23', family: 'IPv4', internal: false }, { address: 'fe80::1', family: 'IPv6', internal: false }],
    Ethernet: [{ address: '169.254.3.4', family: 'IPv4', internal: false }],
  });
  assert.deepEqual(list, ['192.168.1.23', '172.28.0.1']);
});

test('only loopback counts as local', () => {
  assert.ok(isLocal('127.0.0.1'));
  assert.ok(isLocal('::ffff:127.0.0.1'));
  assert.ok(!isLocal('192.168.1.5'));
});

test('every address gets the name of its network card and a kind', () => {
  const { lanInterfaces, kind } = require('../src/network');
  const list = lanInterfaces({
    'Wi-Fi': [{ address: '192.168.1.23', family: 'IPv4', internal: false }],
    'Local Area Connection* 10': [{ address: '192.168.137.1', family: 'IPv4', internal: false }],
    'NordLynx': [{ address: '10.5.0.2', family: 'IPv4', internal: false }],
  });
  assert.deepEqual(list.map(i => [i.address, i.kind]), [['192.168.1.23', 'wifi'], ['192.168.137.1', 'hotspot'], ['10.5.0.2', 'vpn']]);
  assert.equal(kind({ name: 'Ethernet 2', address: '192.168.0.4' }), 'cable');
  assert.equal(kind({ name: 'vEthernet (WSL)', address: '172.28.0.1' }), 'virtual');
  assert.equal(kind({ name: 'en0', address: '172.20.10.3' }), 'phone');
});

test('the IP a phone came in on is read from the Host header', () => {
  const { hostIp } = require('../src/network');
  assert.equal(hostIp('192.168.1.23:3000'), '192.168.1.23');
  assert.equal(hostIp('localhost:3000'), '');
  assert.equal(hostIp(undefined), '');
});

test('the quizmaster picks another address for the QR code; the first phone in sets it too', async t => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { io: connect } = require('socket.io-client');
  const { createServer } = require('../src/app');
  const library = require('../src/library').create(fs.mkdtempSync(path.join(os.tmpdir(), 'qb-')));
  const v = {};
  const interfaces = () => [
    { address: '172.28.0.1', name: 'vEthernet (WSL)', kind: 'virtual' },
    { address: '192.168.137.1', name: 'Local Area Connection* 10', kind: 'hotspot' },
  ];
  const qb = createServer({ port: 0, license: require('./fixtures/pro').proLicense(), settings: { get: k => v[k], set: (k, x) => { v[k] = x; } }, library, interfaces });
  const port = await qb.listen();
  const base = `http://127.0.0.1:${port}`;
  const sockets = [];
  t.after(async () => { sockets.forEach(s => s.close()); await qb.close(); });

  const info = await fetch(`${base}/api/info`).then(r => r.json());
  assert.equal(info.url, `http://172.28.0.1:${port}/play`);
  const list = await fetch(`${base}/api/host/addresses`).then(r => r.json());
  assert.deepEqual(list.list.map(a => [a.address, a.kind, a.chosen]), [['172.28.0.1', 'virtual', true], ['192.168.137.1', 'hotspot', false]]);
  assert.equal((await fetch(`${base}/network`, { redirect: 'manual' })).status, 200);

  // A phone that comes in on the hotspot proves that address works: it goes on the QR code everywhere.
  const screen = connect(base, { query: { role: 'screen' }, transports: ['websocket'], forceNew: true });
  sockets.push(screen);
  const announced = new Promise(r => screen.on('joinInfo', r));
  const phone = connect(base, { query: { role: 'player' }, transports: ['websocket'], forceNew: true, extraHeaders: { host: `192.168.137.1:${port}` } });
  sockets.push(phone);
  assert.equal((await announced).url, `http://192.168.137.1:${port}/play`);
  assert.equal(v.address, '192.168.137.1');

  // The quizmaster can still pick another one, but not an address this laptop does not have.
  const picked = await fetch(`${base}/api/host/address`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: '172.28.0.1' }) }).then(r => r.json());
  assert.equal(picked.url, `http://172.28.0.1:${port}/play`);
  const bad = await fetch(`${base}/api/host/address`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: '8.8.8.8' }) });
  assert.equal(bad.status, 400);
  assert.equal(v.address, '172.28.0.1');
});
