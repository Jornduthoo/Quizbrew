// The look: every image the CSS uses exists and stays small, every round theme has a label in every language.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const i18n = require('../src/i18n');

const PUB = path.join(__dirname, '..', 'public');

test('images used by the CSS exist, are webp and stay light', () => {
  for (const f of fs.readdirSync(path.join(PUB, 'css'))) {
    const css = fs.readFileSync(path.join(PUB, 'css', f), 'utf8');
    for (const m of css.matchAll(/url\('(\/img\/[^']+)'\)/g)) {
      const file = path.join(PUB, m[1]);
      assert.ok(fs.existsSync(file), `${f}: ${m[1]} missing`);
      assert.match(m[1], /\.webp$/, `${f}: ${m[1]} should be webp`);
      assert.ok(fs.statSync(file).size < 150 * 1024, `${m[1]} is over 150 KB`);
    }
  }
});

test('every round theme has an icon, a colour and a label in every language', () => {
  const window = { location: { search: '' } };
  const document = { createElement: () => ({}), querySelectorAll: () => [], documentElement: { dataset: {} } };
  vm.runInNewContext(fs.readFileSync(path.join(PUB, 'js', 'common.js'), 'utf8'), { window, document });
  const themes = window.QB.ROUND_THEMES;
  assert.ok(themes.classic);
  for (const [type, th] of Object.entries(themes)) {
    assert.match(th.glow, /^#[0-9a-f]{6}$/i, type);
    assert.match(th.icon, /<(path|rect|circle)/, type);
    for (const { code } of i18n.LANGUAGES) assert.ok(i18n.read(code)['round.' + type], `${code}: round.${type}`);
  }
});

test('effects can be switched off', () => {
  const src = fs.readFileSync(path.join(PUB, 'js', 'fx.js'), 'utf8');
  assert.match(src, /prefers-reduced-motion/);
  assert.match(src, /fx=\(off\|low\|high\)/);
});

test('every look has its colours, painted backgrounds and a name in every language', () => {
  const { LOOKS } = require('../src/app');
  const css = fs.readFileSync(path.join(PUB, 'css', 'base.css'), 'utf8');
  for (const look of LOOKS) {
    if (look !== 'pub') assert.match(css, new RegExp(`:root\\[data-look="${look}"\\]`), look);
    for (const scene of ['lobby', 'stage', 'play', 'board', 'finale', 'phone']) {
      const file = path.join(PUB, 'img', 'look', `${look}-${scene}.webp`);
      assert.ok(fs.existsSync(file), `${look}-${scene}.webp`);
      assert.ok(fs.statSync(file).size < 150 * 1024, `${look}-${scene}.webp is over 150 KB`);
    }
    for (const { code } of i18n.LANGUAGES) assert.ok(i18n.read(code)['look.' + look], `${code}: look.${look}`);
  }
});
