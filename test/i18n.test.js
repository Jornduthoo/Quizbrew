// Every screen text must come from lang/*.json: same keys in every language, no text hardcoded in the HTML.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const i18n = require('../src/i18n');
const { TEAM_COLORS } = require('../src/teams');

const PUB = path.join(__dirname, '..', 'public');
const en = i18n.read('en');

test('every language has exactly the English keys', () => {
  for (const { code } of i18n.LANGUAGES) {
    const keys = Object.keys(i18n.read(code)).sort();
    assert.deepEqual(keys, Object.keys(en).sort(), `lang/${code}.json`);
    for (const [k, v] of Object.entries(i18n.read(code))) assert.ok(typeof v === 'string' && v.trim(), `${code}: ${k} is empty`);
  }
});

test('placeholders match across languages', () => {
  const vars = s => (s.match(/\{\w+\}/g) || []).sort().join();
  for (const { code } of i18n.LANGUAGES) {
    for (const [k, v] of Object.entries(i18n.read(code))) assert.equal(vars(v), vars(en[k]), `${code}: ${k}`);
  }
});

test('every key used in the screens exists', () => {
  const used = new Set();
  for (const f of fs.readdirSync(path.join(PUB, 'js'))) {
    const src = fs.readFileSync(path.join(PUB, 'js', f), 'utf8');
    for (const m of src.matchAll(/\bt\(\s*'([a-z][\w]*\.[\w.]+)'/g)) used.add(m[1]);
    for (const m of src.matchAll(/'((?:host|play|screen|error)\.[\w.]+)'/g)) used.add(m[1]);
  }
  for (const f of fs.readdirSync(PUB).filter(f => f.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(PUB, f), 'utf8');
    for (const m of html.matchAll(/data-i18n="([^"]+)"/g)) used.add(m[1]);
    for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) m[1].split(',').forEach(p => used.add(p.split(':')[1]));
  }
  for (const c of TEAM_COLORS) used.add(`color.${c}`);
  const missing = [...used].filter(k => !(k in en));
  assert.deepEqual(missing, []);
});

test('server error keys exist', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'game.js'), 'utf8') + fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
  for (const m of src.matchAll(/'(error\.\w+)'/g)) assert.ok(m[1] in en, m[1]);
});

test('no screen text is hardcoded in the HTML', () => {
  for (const f of fs.readdirSync(PUB).filter(f => f.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(PUB, f), 'utf8')
      .replace(/<script[\s\S]*?<\/script>/g, '')
      .replace(/<style[\s\S]*?<\/style>/g, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<title>[\s\S]*?<\/title>/g, '');
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    assert.equal(text, '', `${f} has text outside data-i18n: "${text}"`);
  }
});

test('missing translations fall back to English', () => {
  const d = i18n.dictionary('xx');
  assert.equal(d['host.next'] ?? d['host.startQuiz'], en['host.startQuiz']);
});

test('plural forms are used the same way in every language', () => {
  for (const { code } of i18n.LANGUAGES) {
    for (const [k, v] of Object.entries(i18n.read(code))) {
      assert.equal(v.includes('|'), en[k].includes('|'), `${code}: ${k} plural form`);
      if (v.includes('|')) assert.equal(v.split('|').length, 2, `${code}: ${k} needs exactly one|other`);
    }
  }
});
