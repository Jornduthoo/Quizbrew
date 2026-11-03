// Round types. Every round type is a small description on top of one shared engine (game.js):
// what a question holds, how a phone answers, how an answer is checked, and how the AI should write it.
// The name and the description on screen come from i18n keys round.<id> and round.<id>.desc.
//
// kind: how a phone answers
//   choice    - 2 to 4 buttons (answer = index)
//   trueFalse - 2 buttons, true or false (answer = 0 for true, 1 for false)
//   text      - type an answer (checked against answer + accept, the quizmaster can overrule)
//   number    - type a number (closest wins)
//
// Scoring modes that the quizmaster picks per round (only for types with a right or wrong answer):
//   points - right = the points of the question
//   speed  - right = points plus a bonus up to the same again for a fast answer
//   race   - only the fastest right team scores
//   risk   - right = +points, wrong = -points (no answer = 0)
//   time   - right = the seconds that were left on the clock
//   ladder - the earlier you answer while the picture or clues unfold, the more points

const SCORINGS = ['points', 'speed', 'race', 'risk', 'time', 'ladder'];
const TWISTS = ['double', 'lockdown', 'blackout', 'underdog'];
const FAMILIES = ['classic', 'visual', 'audio', 'speed', 'strategy', 'party', 'puzzle', 'special', 'clock'];

// Lowercase, no accents, no punctuation, no leading "the/de/het/le/la".
function normalize(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/^(the|a|an|de|het|een|le|la|les|l|un|une) /, '');
}

function distance(a, b) {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

// A typed answer counts when it matches the answer or one of the accepted spellings, with a small typo allowed.
function textMatches(given, q) {
  const g = normalize(given);
  if (!g) return false;
  return [q.answer, ...(q.accept || [])].some(ok => {
    const n = normalize(ok);
    if (!n) return false;
    if (n === g) return true;
    const allowed = n.length >= 9 ? 2 : n.length >= 5 ? 1 : 0;
    return distance(n, g) <= allowed;
  });
}

// Same letters, shuffled the same way every time for the same word, never the word itself.
function scramble(word) {
  const letters = [...String(word).toUpperCase().replace(/\s+/g, '')];
  let seed = [...letters].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
  for (let tries = 0; tries < 5; tries++) {
    for (let i = letters.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [letters[i], letters[j]] = [letters[j], letters[i]];
    }
    if (letters.join('') !== String(word).toUpperCase().replace(/\s+/g, '') || letters.length < 2) break;
  }
  return letters.join('');
}

const str = v => (typeof v === 'string' ? v.trim() : '');
const list = v => (Array.isArray(v) ? v.map(str).filter(Boolean) : typeof v === 'string' ? v.split('|').map(str).filter(Boolean) : []);

// Checks shared by the types.
const need = {
  text(q, fail) { if (!str(q.question)) fail('has no text'); },
  answers(q, fail) {
    if (!Array.isArray(q.answers) || q.answers.length < 2 || q.answers.length > 4) fail('needs 2 to 4 answers');
    if (q.answers.some(a => !str(a))) fail('has an empty answer');
    if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct >= q.answers.length) fail('has no valid correct answer');
  },
  answer(q, fail) { if (!str(q.answer)) fail('needs the right answer'); },
  image(q, fail) { if (!str(q.image)) fail('needs a picture'); },
};

// Parts reused by many types.
const choiceType = {
  kind: 'choice',
  validate(q, fail) { need.text(q, fail); need.answers(q, fail); },
  parse: (raw, q) => (Number.isInteger(raw) && raw >= 0 && raw < q.answers.length ? raw : undefined),
  isCorrect: (a, q) => a === q.correct,
  publicQ: q => ({ answers: q.answers }),
  revealQ: q => ({ correct: q.correct, answerText: q.answers[q.correct] }),
  aiShape: '{"question": "...", "answers": ["...", "...", "...", "..."], "correct": 0}  (exactly 4 answers, correct = index 0-3 of the right one; shuffle where the right answer sits)',
  fromAI: it => ({ question: str(it.question), answers: list(it.answers).slice(0, 4), correct: Number(it.correct) || 0 }),
};

const textType = {
  kind: 'text',
  validate(q, fail) { need.text(q, fail); need.answer(q, fail); },
  parse: raw => (typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, 80) : undefined),
  isCorrect: (a, q) => textMatches(a, q),
  publicQ: () => ({}),
  revealQ: q => ({ answerText: q.answer }),
  aiShape: '{"question": "...", "answer": "short answer", "accept": ["other accepted spelling"]}',
  fromAI: it => ({ question: str(it.question), answer: str(it.answer), accept: list(it.accept) }),
};

// A picture question is a choice when it has answers, otherwise typed.
const choiceOrText = {
  kindOf: q => (Array.isArray(q.answers) && q.answers.length ? 'choice' : 'text'),
  validate(q, fail) {
    need.image(q, fail);
    if (Array.isArray(q.answers) && q.answers.length) need.answers(q, fail);
    else need.answer(q, fail);
  },
  parse: (raw, q) => (choiceOrText.kindOf(q) === 'choice' ? choiceType.parse(raw, q) : textType.parse(raw)),
  isCorrect: (a, q) => (choiceOrText.kindOf(q) === 'choice' ? a === q.correct : textMatches(a, q)),
  publicQ: q => (choiceOrText.kindOf(q) === 'choice' ? { answers: q.answers } : {}),
  revealQ: q => (choiceOrText.kindOf(q) === 'choice' ? choiceType.revealQ(q) : { answerText: q.answer }),
  aiShape: '{"question": "What is shown?", "answer": "short answer", "accept": ["..."], "imagePrompt": "a prompt for an image AI that shows the subject without any text in the image"}',
  fromAI: it => ({ question: str(it.question) || '', answer: str(it.answer), accept: list(it.accept), imagePrompt: str(it.imagePrompt) }),
};

const TYPES = [
  {
    id: 'classic', family: 'classic', ...choiceType,
    defaults: { time: 20, points: 1, scoring: 'points' },
    fields: ['question', 'answers', 'image', 'time', 'points'],
  },
  {
    id: 'trueFalse', family: 'classic', kind: 'trueFalse',
    defaults: { time: 12, points: 1, scoring: 'points' },
    fields: ['question', 'truth', 'image', 'time', 'points'],
    validate(q, fail) { need.text(q, fail); if (typeof q.correct !== 'boolean') fail('must be true or false'); },
    parse: raw => (raw === 0 || raw === 1 ? raw : undefined),
    isCorrect: (a, q) => a === (q.correct ? 0 : 1),
    publicQ: () => ({}),
    revealQ: q => ({ correct: q.correct ? 0 : 1 }),
    aiShape: '{"question": "a statement", "correct": true}  (correct = whether the statement is true; mix true and false, surprising facts work best)',
    fromAI: it => ({ question: str(it.question || it.statement), correct: it.correct === true || it.correct === 'true' }),
  },
  {
    id: 'open', family: 'classic', ...textType,
    defaults: { time: 30, points: 1, scoring: 'points' },
    fields: ['question', 'answer', 'image', 'time', 'points'],
  },
  {
    id: 'closest', family: 'classic', kind: 'number',
    defaults: { time: 25, points: 2 },
    fields: ['question', 'number', 'image', 'time', 'points'],
    scorings: [],
    validate(q, fail) { need.text(q, fail); if (!Number.isFinite(q.answer)) fail('needs a number as answer'); },
    parse: raw => {
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/\s/g, '').replace(',', '.'));
      return Number.isFinite(n) ? n : undefined;
    },
    publicQ: q => ({ unit: str(q.unit) }),
    revealQ: q => ({ answerText: String(q.answer), number: q.answer, unit: str(q.unit) }),
    // The closest team(s) get the points, a spot-on answer doubles them.
    score(entries, q, base) {
      const given = entries.filter(e => e.answer !== undefined && e.answer !== null);
      const best = Math.min(...given.map(e => Math.abs(e.answer - q.answer)));
      return entries.map(e => {
        if (e.answer === undefined || e.answer === null || Math.abs(e.answer - q.answer) !== best) return { points: 0, correct: false };
        return { points: best === 0 ? base * 2 : base, correct: true };
      });
    },
    aiShape: '{"question": "How many / how high / in which year ...?", "answer": 1234, "unit": "metres"}  (answer is a plain number)',
    fromAI: it => ({ question: str(it.question), answer: Number(String(it.answer).replace(/[^\d.,-]/g, '').replace(',', '.')), unit: str(it.unit) }),
  },
  {
    id: 'picture', family: 'visual', ...choiceOrText,
    defaults: { time: 25, points: 1, scoring: 'points' },
    fields: ['image', 'question', 'answerOrChoices', 'time', 'points'],
  },
  {
    id: 'zoomOut', family: 'visual', ...choiceOrText, effect: 'zoom',
    defaults: { time: 25, points: 5, scoring: 'ladder' },
    fields: ['image', 'question', 'answerOrChoices', 'time', 'points'],
  },
  {
    id: 'speed', family: 'speed', ...choiceType,
    defaults: { time: 10, points: 1, scoring: 'speed' },
    fields: ['question', 'answers', 'image', 'time', 'points'],
  },
  {
    id: 'scramble', family: 'puzzle', ...textType,
    defaults: { time: 30, points: 1, scoring: 'speed' },
    fields: ['answer', 'hint', 'time', 'points'],
    validate(q, fail) {
      need.answer(q, fail);
      if (q.answer.replace(/\s/g, '').length < 3) fail('needs a word of at least 3 letters');
    },
    publicQ: q => ({ scrambled: scramble(q.answer), hint: str(q.question) }),
    aiShape: '{"answer": "WORD", "question": "a short hint or category"}  (one word or a short name of 4-12 letters)',
    fromAI: it => ({ answer: str(it.answer).toUpperCase(), question: str(it.question || it.hint) }),
  },
  {
    id: 'commonThread', family: 'puzzle', ...textType,
    defaults: { time: 40, points: 4, scoring: 'ladder' },
    fields: ['clues', 'answer', 'time', 'points'],
    validate(q, fail) {
      need.answer(q, fail);
      if (list(q.clues).length < 2 || list(q.clues).length > 6) fail('needs 2 to 6 clues');
    },
    steps: q => list(q.clues).length,
    publicQ: q => ({ clues: list(q.clues) }),
    aiShape: '{"clues": ["hardest clue", "...", "...", "easiest clue"], "answer": "the link", "accept": ["..."]}  (4 clues from hard to easy that all point to one answer)',
    fromAI: it => ({ clues: list(it.clues).slice(0, 6), answer: str(it.answer), accept: list(it.accept), question: '' }),
  },
  {
    id: 'jackpot', family: 'special', ...textType, wager: true,
    defaults: { time: 30, points: 5 },
    fields: ['category', 'question', 'answer', 'image', 'time', 'points'],
    scorings: [],
    validate(q, fail) { need.text(q, fail); need.answer(q, fail); },
    publicQ: q => ({ category: str(q.category) }),
    // Right = + the wager, wrong or no answer = - the wager.
    score(entries, q) {
      return entries.map(e => {
        const right = e.answer !== undefined && e.answer !== null && textMatches(e.answer, q);
        return { points: right ? e.wager : -e.wager, correct: right };
      });
    },
    aiShape: '{"category": "category shown before betting", "question": "...", "answer": "short answer", "accept": ["..."]}',
    fromAI: it => ({ category: str(it.category), question: str(it.question), answer: str(it.answer), accept: list(it.accept) }),
  },
];

const BY_ID = Object.fromEntries(TYPES.map(t => [t.id, t]));
for (const t of TYPES) {
  if (!t.scorings) t.scorings = t.steps || t.effect ? ['ladder', 'points', 'speed', 'race', 'risk', 'time'] : ['points', 'speed', 'race', 'risk', 'time'];
}

const get = id => BY_ID[id];
const kindOf = (type, q) => (type.kindOf ? type.kindOf(q) : type.kind);
const stepsOf = (type, q) => (type.steps ? type.steps(q) : type.effect ? 5 : 1);

// Fill the defaults of the round type into a round, without changing what the quizmaster set.
function withDefaults(round) {
  const type = get(round.type);
  if (!type) return round;
  return {
    ...round,
    scoring: type.scorings.includes(round.scoring) ? round.scoring : type.defaults.scoring || null,
    twists: (round.twists || []).filter(x => TWISTS.includes(x)),
    questions: round.questions.map(q => ({ ...q, time: q.time > 0 ? q.time : type.defaults.time, points: q.points > 0 ? q.points : type.defaults.points })),
  };
}

// What the builder needs to know about every type (no functions).
function catalog() {
  return {
    families: FAMILIES,
    scorings: SCORINGS,
    twists: TWISTS,
    types: TYPES.map(t => ({ id: t.id, family: t.family, kind: t.kind || 'choiceOrText', fields: t.fields, defaults: t.defaults, scorings: t.scorings, wager: !!t.wager, effect: t.effect || null })),
  };
}

module.exports = { TYPES, SCORINGS, TWISTS, FAMILIES, get, kindOf, stepsOf, withDefaults, catalog, normalize, textMatches, scramble, list, str };
