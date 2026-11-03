// The browser scripts are plain files without a build step: make sure each one at least parses.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS = path.join(__dirname, '..', 'public', 'js');

for (const f of fs.readdirSync(JS).filter(f => f.endsWith('.js'))) {
  test(`public/js/${f} parses`, () => {
    assert.doesNotThrow(() => new vm.Script(fs.readFileSync(path.join(JS, f), 'utf8'), { filename: f }));
  });
}
