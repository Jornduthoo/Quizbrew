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
