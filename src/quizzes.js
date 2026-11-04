// Quiz files live in quizzes/ (bundled samples). The library with folders comes in a later step.
const fs = require('fs');
const path = require('path');
const { validateQuiz } = require('./game');

const DIR = path.join(__dirname, '..', 'quizzes');

// Quiz packs come in one file per language (name.<language>.json); the quizmaster sees the one in their language
// (English when there is none). Quizzes without a language in the name are always shown.
const PACK = /\.([a-z]{2})\.json$/;

// The name of a sample without language and extension: removing one hides all its language versions.
const base = f => String(f).replace(PACK, '').replace(/\.json$/, '');

// hidden: sample names the quizmaster removed (kept in data/settings.json, so a git pull does not bring them back).
function list(language, hidden = []) {
  const gone = new Set(hidden);
  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json') && !gone.has(base(f))).sort();
  const langs = new Map();
  for (const f of files) {
    const m = PACK.exec(f);
    if (m) langs.set(base(f), [...(langs.get(base(f)) || []), m[1]]);
  }
  return files.filter(f => {
    const m = PACK.exec(f);
    if (!m || !language) return true;
    const have = langs.get(base(f));
    return m[1] === (have.includes(language) ? language : have.includes('en') ? 'en' : have[0]);
  }).map(file => {
    const quiz = load(file);
    return { file, title: quiz.title, language: quiz.language || null, rounds: quiz.rounds.length, questions: quiz.rounds.reduce((n, r) => n + r.questions.length, 0) };
  });
}

function load(file) {
  if (!/^[\w.-]+\.json$/.test(file)) throw new Error('Invalid quiz file name');
  const quiz = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
  validateQuiz(quiz);
  return quiz;
}

module.exports = { list, load, base };
