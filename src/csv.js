// Quizzes as a spreadsheet: one row per question. Works with Excel's comma or semicolon files.
// Columns: round, type, question, A, B, C, D, correct, answer, accept, clues, category, unit, time, points, image, fact
// correct = the letter of the right choice (A-D), or true/false for a true-or-false round.
// accept and clues are separated by |.
// more = the rest of the question as JSON (items, pairs, groups, levels, pictures ...), so every round type survives a round trip.
const rounds = require('./rounds');

const COLUMNS = ['round', 'type', 'question', 'A', 'B', 'C', 'D', 'correct', 'answer', 'accept', 'clues', 'category', 'unit', 'time', 'points', 'image', 'fact', 'more'];
// Question fields that have a column of their own; everything else goes into "more".
const OWN = new Set(['question', 'answers', 'correct', 'answer', 'accept', 'clues', 'category', 'unit', 'time', 'points', 'image', 'fact']);
const LETTERS = ['A', 'B', 'C', 'D'];

function parseRows(text) {
  const src = String(text).replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/)[0] || '';
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : (firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ',');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

// CSV text -> { title, rounds }. Rows with the same round name end up in one round.
function toQuiz(text, title = 'Imported quiz') {
  const rows = parseRows(text);
  if (rows.length < 2) throw new Error('The file has no questions');
  const head = rows[0].map(h => h.trim().toLowerCase());
  const col = name => head.indexOf(name.toLowerCase());
  if (col('question') === -1 && col('answer') === -1 && col('clues') === -1) throw new Error('No "question" column found');
  const get = (r, name) => (col(name) === -1 ? '' : String(r[col(name)] || '').trim());
  const quiz = { title, rounds: [] };
  for (const r of rows.slice(1)) {
    const roundName = get(r, 'round') || 'Round 1';
    const typeId = rounds.typeFrom(get(r, 'type'));
    let round = quiz.rounds.find(x => x.title === roundName && (!typeId || x.type === typeId));
    if (!round) {
      round = { type: typeId || 'classic', title: roundName, questions: [] };
      quiz.rounds.push(round);
    }
    const type = rounds.get(typeId || round.type);
    const q = { question: get(r, 'question') };
    const choices = LETTERS.map(l => get(r, l)).filter(Boolean);
    const correct = get(r, 'correct');
    if (type.id === 'trueFalse') q.correct = rounds.yesNo(correct) === true || /^w$/i.test(correct);
    else if (choices.length >= 2) {
      q.answers = choices;
      q.correct = rounds.correctOf({ correct }, choices);
    }
    if (get(r, 'answer')) q.answer = type.kind === 'number' ? rounds.num(get(r, 'answer')) : get(r, 'answer');
    if (get(r, 'accept')) q.accept = rounds.list(get(r, 'accept'));
    if (get(r, 'clues')) q.clues = rounds.list(get(r, 'clues'));
    for (const f of ['category', 'unit', 'image', 'fact']) if (get(r, f)) q[f] = get(r, f);
    if (Number(get(r, 'time')) > 0) q.time = Number(get(r, 'time'));
    if (Number(get(r, 'points')) > 0) q.points = Number(get(r, 'points'));
    if (get(r, 'more')) {
      let more = null;
      try { more = JSON.parse(get(r, 'more')); } catch { /* a broken cell: leave it out */ }
      if (more && typeof more === 'object' && !Array.isArray(more)) for (const [k, v] of Object.entries(more)) if (!OWN.has(k) && !(k in q)) q[k] = v;
      // The odd one out keeps its right picture in "correct" too.
      if (more && Number.isInteger(more.correct) && !q.answers) q.correct = more.correct;
    }
    round.questions.push(q);
  }
  return quiz;
}

const esc = v => {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function fromQuiz(quiz) {
  const lines = [COLUMNS.join(',')];
  const names = [];
  for (const [ri, r] of (quiz.rounds || []).entries()) {
    // Every round gets its own name in the sheet, so two rounds never melt into one on the way back.
    let name = String(r.title || '').trim() || `Round ${ri + 1}`;
    if (names.includes(name)) name = `${name} (${ri + 1})`;
    names.push(name);
    for (const q of r.questions || []) {
      const row = {
        round: name, type: r.type, question: q.question,
        correct: typeof q.correct === 'boolean' ? String(q.correct) : Array.isArray(q.answers) ? LETTERS[q.correct] : '',
        answer: q.answer, accept: (q.accept || []).join('|'), clues: (q.clues || []).join('|'),
        category: q.category, unit: q.unit, time: q.time, points: q.points,
        image: typeof q.image === 'string' && !q.image.startsWith('data:') ? q.image : '',
        fact: q.fact,
      };
      const more = {};
      for (const [k, v] of Object.entries(q)) if (!OWN.has(k) && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)) more[k] = v;
      if (Number.isInteger(q.correct) && !Array.isArray(q.answers)) more.correct = q.correct;
      if (typeof q.image === 'string' && q.image.startsWith('data:')) delete more.image;
      if (Object.keys(more).length) row.more = JSON.stringify(more);
      (q.answers || []).forEach((a, i) => { row[LETTERS[i]] = a; });
      lines.push(COLUMNS.map(c => esc(row[c])).join(','));
    }
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

module.exports = { parseRows, toQuiz, fromQuiz, COLUMNS };
