// The promo website (website/): every text exists in all 5 languages, every file the page uses exists,
// and the round type list is in sync with the app.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = path.join(__dirname, '..', 'website');
const load = file => { const window = {}; vm.runInNewContext(fs.readFileSync(path.join(dir, file), 'utf8'), { window }); return window; };
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');

test('website: every text in all 5 languages', () => {
  const T = load('js/i18n.js').QB_TEXT;
  assert.deepEqual(Object.keys(T).sort(), ['de', 'en', 'es', 'fr', 'nl']);
  const keys = Object.keys(T.en);
  for (const lang of Object.keys(T)) {
    assert.deepEqual(Object.keys(T[lang]).filter(k => !keys.includes(k)), [], `${lang} has extra keys`);
    assert.deepEqual(keys.filter(k => !T[lang][k]), [], `${lang} misses keys`);
    for (const k of keys) assert.equal((T[lang][k].match(/\|/g) || []).length, (T.en[k].match(/\|/g) || []).length, `${lang} ${k}: list length`);
  }
  for (const [, k] of html.matchAll(/data-(?:t|list)="([^"]+)"/g)) assert.ok(T.en[k], `index.html uses unknown text ${k}`);
});

test('website: price and links come from config.js', () => {
  const C = load('js/config.js').QB_SITE;
  assert.equal(typeof C.price, 'number');
  assert.ok(C.demoTeams > 0 && C.maxTeams > C.demoTeams);
  assert.equal(C.maxTeams, require('../src/teams').MAX_TEAMS, 'maxTeams in website/js/config.js must match src/teams.js');
});

test('website: every file the page and stylesheet use exists', () => {
  const css = fs.readFileSync(path.join(dir, 'css', 'site.css'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="((?:img|css|js|fonts)\/[^"]+)"/g)].map(m => m[1])
    .concat([...css.matchAll(/url\('\.\.\/([^']+)'\)/g)].map(m => m[1]));
  for (const look of ['pub', 'space', 'jungle', 'spooky', 'arcade']) refs.push(`img/shots/${look}-intro.webp`);
  for (const f of load('js/rounds.js').QB_ROUNDS) refs.push(`img/icons/${f.id}.webp`);
  for (const r of refs) assert.ok(fs.existsSync(path.join(dir, r)), `missing ${r}`);
  for (const r of refs.filter(r => r.endsWith('.webp'))) assert.ok(fs.statSync(path.join(dir, r)).size < 150 * 1024, `${r} is too big`);
});

test('website: round types match the app (run node website/tools/build.js after adding one)', () => {
  const { TYPES } = require('../src/rounds');
  const R = load('js/rounds.js').QB_ROUNDS;
  const count = (Array.isArray(TYPES) ? TYPES : Object.values(TYPES)).length;
  assert.equal(R.reduce((n, f) => n + f.rounds.length, 0), count);
  const en = require('../lang/en.json');
  assert.ok(R.every(f => f.rounds.every(r => Object.values(en).includes(r.en))));
});
