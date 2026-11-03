// Screen text lives in lang/<code>.json under keys like "host.next". English is the default and the fallback:
// a key missing in another language shows the English text.
const fs = require('fs');
const path = require('path');

const LANG_DIR = path.join(__dirname, '..', 'lang');
const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'fr', name: 'Français' },
];
const DEFAULT = 'en';

const cache = new Map();
function read(code) {
  if (!cache.has(code)) cache.set(code, JSON.parse(fs.readFileSync(path.join(LANG_DIR, `${code}.json`), 'utf8')));
  return cache.get(code);
}

function isSupported(code) {
  return LANGUAGES.some(l => l.code === code);
}

// The full dictionary for one language, English filled in where a translation is missing.
function dictionary(code) {
  const base = read(DEFAULT);
  return isSupported(code) && code !== DEFAULT ? { ...base, ...read(code) } : { ...base };
}

module.exports = { LANGUAGES, DEFAULT, isSupported, dictionary, read };
