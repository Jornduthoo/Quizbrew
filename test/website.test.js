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
  // Sales go only through the Microsoft Store: the site links to the same listing the Store package uses.
  assert.equal(C.storeId, require('../desktop/msix/store.json').storeId, 'storeId in website/js/config.js must match desktop/msix/store.json');
  assert.equal(typeof C.storeLive, 'boolean');
  // The app's Pro dialog and the site name the same price.
  assert.equal(C.price, require('../src/license').PRICE, 'price in website/js/config.js must match PRICE in src/license.js');
  // The page without JavaScript (search engines, link previews) shows that price too, not an old one.
  for (const m of html.matchAll(/data-price>([^<]*)</g)) assert.equal(m[1], '€' + C.price, 'the fallback price in index.html is out of date');
  assert.ok(!/€\s?49\b(?![.,]\d)/.test(html), 'index.html still says €49');
});

test('website: every file the page and stylesheet use exists', () => {
  const css = fs.readFileSync(path.join(dir, 'css', 'site.css'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="((?:img|css|js|fonts)\/[^"?]+)/g)].map(m => m[1])
    .concat([...css.matchAll(/url\('\.\.\/([^']+)'\)/g)].map(m => m[1]));
  const LANGS = Object.keys(load('js/i18n.js').QB_TEXT);
  // Every screenshot exists in every page language (made by tools/shots.js, builder-shots.js and round-shots.js).
  const shots = refs.filter(r => r.startsWith('img/shots/en/')).map(r => r.slice('img/shots/en/'.length));
  for (const look of [...html.matchAll(/data-look="(\w+)"/g)].map(m => m[1])) shots.push(`${look}-intro.webp`);
  const R = load('js/rounds.js').QB_ROUNDS;
  for (const f of R) refs.push(`img/icons/${f.id}.webp`);
  for (const lang of LANGS) {
    refs.push(`video/promo-${lang}-wide.mp4`, `video/poster-${lang}.webp`, ...shots.map(s => `img/shots/${lang}/${s}`));
    for (const f of R) refs.push(...f.rounds.map(r => `img/rounds/${lang}/${r.id}.webp`));
  }
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

test('website: quiz night guide pages exist in all 5 languages and are up to date (run node website/tools/build.js)', () => {
  const { PAGES, T, page } = require('../website/tools/guides');
  const textKeys = o => Object.keys(o).sort();
  assert.deepEqual(Object.keys(PAGES).sort(), ['de', 'en', 'es', 'fr', 'nl']);
  for (const lang of Object.keys(PAGES)) {
    assert.deepEqual(textKeys(T[lang]), textKeys(T.en), `guide ${lang}: same texts as English`);
    assert.equal(T[lang].steps.length, T.en.steps.length, `guide ${lang}: same steps`);
    const file = path.join(dir, PAGES[lang]);
    assert.ok(fs.existsSync(file), `missing website/${PAGES[lang]}`);
    assert.equal(fs.readFileSync(file, 'utf8'), page(lang), `website/${PAGES[lang]} is out of date`);
    assert.ok(fs.readFileSync(path.join(dir, 'sitemap.xml'), 'utf8').includes(PAGES[lang]), `${PAGES[lang]} not in sitemap.xml`);
  }
});

test('website: the film and its poster carry the version stamp (videos are cached for a week)', () => {
  const site = fs.readFileSync(path.join(dir, 'js', 'site.js'), 'utf8');
  assert.match(site, /video\/promo-\$\{lang\}-wide\.mp4\$\{V\}/);
  assert.match(site, /video\/poster-\$\{lang\}\.webp\$\{V\}/);
  assert.match(html, /poster="video\/poster-en\.webp\?v=\d+"/);
});

test('website: the top of the page says something different in every heading', () => {
  const T = load('js/i18n.js').QB_TEXT;
  const P = load('tools/promo/text.js').PROMO_TEXT;
  for (const lang of Object.keys(T)) {
    const lines = [T[lang]['hero.title'], T[lang]['video.title'], P[lang].build, T[lang]['ai.title']].map(s => s.toLowerCase());
    assert.equal(new Set(lines).size, lines.length, `${lang}: repeated heading`);
    assert.ok(!/minu/.test(lines.slice(1).join(' ')), `${lang}: "a quiz in a minute" again`);
  }
});
