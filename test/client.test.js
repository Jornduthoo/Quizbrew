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

test('opening the camera for a photo is not reported as leaving the page', () => {
  const src = fs.readFileSync(path.join(JS, 'play.js'), 'utf8');
  assert.match(src, /for \(const id of \['#photo-input', '#tp-input'\]\)[\s\S]*?picking = true/);
  assert.match(src, /function leave\(fromBlur\) \{\s*if \(picking\) return;/);
  // Pictures are sent with a confirmation and tried again, never fire-and-forget.
  assert.doesNotMatch(src, /socket\.emit\('answer', (url|photoUrl)\)/);
  assert.match(src, /socket\.timeout\(\d+\)\.emit\('answer', url,/);
});
