// Quiz files live in quizzes/ (bundled samples). The library with folders comes in a later step.
const fs = require('fs');
const path = require('path');
const { validateQuiz } = require('./game');

const DIR = path.join(__dirname, '..', 'quizzes');

function list() {
  return fs.readdirSync(DIR).filter(f => f.endsWith('.json')).sort().map(file => {
    const quiz = load(file);
    return { file, title: quiz.title, rounds: quiz.rounds.length, questions: quiz.rounds.reduce((n, r) => n + r.questions.length, 0) };
  });
}

function load(file) {
  if (!/^[\w.-]+\.json$/.test(file)) throw new Error('Invalid quiz file name');
  const quiz = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
  validateQuiz(quiz);
  return quiz;
}

module.exports = { list, load };
