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
const LAPTOP_ONLY = /^(check-|raffle-|remote-|venue-|sponsor-|screen-copy)/;

test('every element host.js needs exists on the remote page', () => {
  const ids = new Set([...js.matchAll(/\$\('#([a-z0-9-]+)/g)].map(m => m[1]));
  const missing = [...ids].filter(id => !LAPTOP_ONLY.test(id) && !remote.includes(`id="${id}"`));
  assert.deepEqual(missing, []);
});

test('laptop-only tools are guarded in host.js', () => {
  for (const id of ['check-btn', 'raffle-btn', 'venue-tile']) assert.match(js, new RegExp(`if \\(\\$\\('#${id}'\\)\\)`));
  assert.match(js, /if \(!remote\) \{\s*\$\('#remote-tile'\)/);
});
