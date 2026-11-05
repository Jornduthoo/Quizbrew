// Copies the round type names and their one-line explanations out of the app's own language files into website/js/rounds.js,
// so the website always lists the same 45 round types in the same 5 languages. Run: node website/tools/build.js
const fs = require('fs');
const path = require('path');
const { TYPES, FAMILIES } = require('../../src/rounds');
const LANGS = ['en', 'nl', 'fr', 'de', 'es'];
const lang = Object.fromEntries(LANGS.map(l => [l, require(`../../lang/${l}.json`)]));
const types = Array.isArray(TYPES) ? TYPES : Object.values(TYPES);
const out = FAMILIES.map(f => ({
  id: f,
  name: Object.fromEntries(LANGS.map(l => [l, lang[l][`family.${f}`] || lang.en[`family.${f}`]])),
  rounds: types.filter(t => t.family === f).map(t => ({
    id: t.id,
    ...Object.fromEntries(LANGS.map(l => [l, lang[l][`round.${t.id}`] || lang.en[`round.${t.id}`]])),
    desc: Object.fromEntries(LANGS.map(l => [l, lang[l][`round.${t.id}.desc`] || lang.en[`round.${t.id}.desc`]])),
  })),
}));
const file = path.join(__dirname, '..', 'js', 'rounds.js');
fs.writeFileSync(file, '// Made by website/tools/build.js from lang/*.json: do not edit by hand.\nwindow.QB_ROUNDS = ' + JSON.stringify(out) + ';\n');
console.log(file, types.length + ' round types');

// New version stamp on the stylesheet and scripts in index.html, so browsers fetch the new files after a change.
const index = path.join(__dirname, '..', 'index.html');
const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 12);
fs.writeFileSync(index, fs.readFileSync(index, 'utf8').replace(/\?v=\d+/g, `?v=${stamp}`));
console.log(index, 'version ' + stamp);

// The quiz night guide pages use the same stamp.
require('./guides').writeAll();
