// Round types. Every round type is a small description on top of one shared engine (game.js):
// what a question holds, how a phone answers, how an answer is checked, and how the AI should write it.
// The name and the description on screen come from i18n keys round.<id> and round.<id>.desc.
//
// kind: how a phone answers
//   choice    - 2 to 4 buttons (answer = index)
//   trueFalse - 2 buttons, true or false (answer = 0 for true, 1 for false)
//   text      - type an answer (checked against answer + accept, the quizmaster can overrule)
//   number    - type a number (closest wins)
//   order     - tap shown items in order (answer = item indexes in the right order)
//   pairs     - match left to right (answer = right index per left item)
//   point     - tap a spot on a picture (answer = { x, y }, 0..1)
//   buzz      - one big button; the first team to buzz says the answer out loud, the quizmaster judges
//   list      - type as many items of a list as you can (answer = the typed items)
//   level     - every team first picks easy, medium or hard and gets its own question (answer = { l, i })
//   draw      - draw on the phone (answer = picture url)
//   photo     - take a photo with the phone (answer = picture url)
//   turn      - one team at a time answers out loud while its own clock runs; the quizmaster judges (clock rounds)
//
// vote: after the question every team votes on what the others made.
//   best  - vote for the best entry (not your own); every vote is worth the points
//   truth - find the real answer between the bluffs; right = points, every team you fooled = points
//   match - match every answer to the team that wrote it; every right match = points
//
// A type with its own score(entries, q, base, ctx) gets per team: answer, answeredAt, wager, mem (what the
// round remembers about the team: streak, pot, out ...) and bank. It may return a new mem per team.
//
// wager: a step before the question.
//   true    - every team bets points on the category
//   level   - every team picks easy, medium or hard
//   pick    - the leading team picks the category the others get
//   predict - finale: the teams that do not play predict which finalist wins
//
// Scoring modes that the quizmaster picks per round (only for types with a right or wrong answer):
//   points - right = the points of the question
//   speed  - right = points plus a bonus up to the same again for a fast answer
//   race   - only the fastest right team scores
//   risk   - right = +points, wrong = -points (no answer = 0)
//   time   - right = the seconds that were left on the clock
//   ladder - the earlier you answer while the picture or clues unfold, the more points

const SCORINGS = ['points', 'speed', 'race', 'risk', 'time', 'ladder'];
const TWISTS = ['double', 'lockdown', 'blackout', 'underdog', 'mysteryCategory', 'suddenDeath', 'shrinkingOptions', 'lifeline', 'silentRound'];
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


// A fixed shuffle of 0..n-1 for the same content (so a reload shows the same order), never the identity when n > 1.
function permutation(n, seedText) {
  const idx = Array.from({ length: n }, (_, i) => i);
  let seed = [...String(seedText)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 11);
  const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
  for (let tries = 0; tries < 6; tries++) {
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    if (n < 2 || idx.some((v, i) => v !== i)) break;
  }
  return idx;
}

// Distance between two points on a picture, both 0..1, as a share of the picture's diagonal.
const pointDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) / Math.SQRT2;

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
  audio(q, fail) { if (!str(q.audio)) fail('needs a sound file'); },
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
  aiShape: '{"question": "What is shown?", "answer": "short answer", "accept": ["..."], "imagePrompt": "a prompt for an image AI that shows the subject without any text in the image", "imageSearch": "2 to 4 English words to find a real photo of the subject on Wikimedia Commons"}',
  fromAI: it => ({ question: str(it.question) || '', answer: str(it.answer), accept: list(it.accept), imagePrompt: str(it.imagePrompt), imageSearch: str(it.imageSearch) }),
};

// Drawings and photos arrive as a media url (the server stores the picture first).
const mediaUrl = raw => (typeof raw === 'string' && /^\/media\/[a-f0-9]{20}\.(webp|png|jpg)$/.test(raw) ? raw : undefined);

// Points after a vote (see vote modes at the top). ctx.ballot: [{ id, teamId|null }], e.vote: index or match list.
function voteScore(entries, q, base, ctx) {
  const pts = new Map(entries.map(e => [e.id, 0]));
  const right = new Map(entries.map(e => [e.id, false]));
  const ballot = ctx.ballot || [];
  for (const e of entries) {
    if (ctx.vote === 'match') {
      // e.vote: for every ballot entry, the team id the voter thinks wrote it.
      (Array.isArray(e.vote) ? e.vote : []).forEach((guess, i) => {
        const b = ballot[i];
        if (b && b.teamId !== e.id && guess === b.teamId) { pts.set(e.id, pts.get(e.id) + base); right.set(e.id, true); }
      });
      continue;
    }
    const b = Number.isInteger(e.vote) ? ballot[e.vote] : null;
    if (!b || b.teamId === e.id) continue;
    if (ctx.vote === 'truth' && b.teamId === null) { pts.set(e.id, pts.get(e.id) + base); right.set(e.id, true); }
    else if (b.teamId && pts.has(b.teamId)) { pts.set(b.teamId, pts.get(b.teamId) + base); right.set(b.teamId, true); }
  }
  return entries.map(e => ({ points: pts.get(e.id), correct: right.get(e.id) }));
}

// Lists: every typed line is added to the team's list until time is up; "/" separates other spellings of an item.
function listFound(given, q) {
  const items = list(q.items).map(it => it.split('/').map(x => x.trim()).filter(Boolean));
  const hit = new Set();
  for (const g of given || []) {
    const i = items.findIndex((alts, k) => !hit.has(k) && textMatches(g, { answer: alts[0], accept: alts.slice(1) }));
    if (i >= 0) hit.add(i);
  }
  return [...hit];
}

const listType = (min, max) => ({
  kind: 'list',
  multi: true,
  validate(q, fail) {
    need.text(q, fail);
    const n = list(q.items).length;
    if (n < min || n > max) fail(`needs ${min} to ${max} right items`);
  },
  parse: (raw, q, team) => {
    if (typeof raw !== 'string' || !raw.trim()) return undefined;
    const have = (team && team.answer) || [];
    if (have.length >= 60) return undefined;
    const item = raw.trim().slice(0, 60);
    if (have.some(x => normalize(x) === normalize(item))) return undefined;
    return [...have, item];
  },
  publicQ: q => ({ total: list(q.items).length }),
  revealQ: q => ({ items: list(q.items).map(it => it.split('/')[0].trim()), answerText: list(q.items).map(it => it.split('/')[0].trim()).join(', ') }),
  found: listFound,
  score(entries, q, base) {
    return entries.map(e => {
      const n = listFound(e.answer, q).length;
      return { points: n * base, correct: n > 0, found: n };
    });
  },
});

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
  // ---------- wave 2: sound and pictures ----------
  {
    id: 'music', family: 'audio', ...choiceOrText, media: 'audio',
    defaults: { time: 30, points: 1, scoring: 'points' },
    fields: ['audio', 'question', 'answerOrChoices', 'time', 'points'],
    validate(q, fail) { need.audio(q, fail); if (Array.isArray(q.answers) && q.answers.length) need.answers(q, fail); else need.answer(q, fail); },
    aiShape: '{"question": "Who sings this? / What is the title?", "answer": "artist or title", "accept": ["..."], "song": "Artist - Title", "clipStart": 35}  (the quizmaster adds the sound file; clipStart = second where the recognisable part starts)',
    fromAI: it => ({ question: str(it.question), answer: str(it.answer), accept: list(it.accept), audioHint: str(it.song), start: Number(it.clipStart) || 0 }),
  },
  {
    id: 'introSprint', family: 'audio', ...textType, media: 'audio', effect: 'grow',
    defaults: { time: 30, points: 4, scoring: 'ladder' },
    fields: ['audio', 'question', 'answer', 'time', 'points'],
    validate(q, fail) { need.audio(q, fail); need.answer(q, fail); },
    steps: () => 4,
    aiShape: '{"question": "Name the song", "answer": "title", "accept": ["..."], "song": "Artist - Title"}  (well known songs with a recognisable intro; the quizmaster adds the sound file)',
    fromAI: it => ({ question: str(it.question), answer: str(it.answer), accept: list(it.accept), audioHint: str(it.song) }),
  },
  {
    id: 'rewind', family: 'audio', ...textType, media: 'audio', effect: 'reverse',
    defaults: { time: 30, points: 1, scoring: 'points' },
    fields: ['audio', 'question', 'answer', 'time', 'points'],
    validate(q, fail) { need.audio(q, fail); need.answer(q, fail); },
    aiShape: '{"question": "This song plays backwards. Which one is it?", "answer": "title", "accept": ["..."], "song": "Artist - Title"}',
    fromAI: it => ({ question: str(it.question), answer: str(it.answer), accept: list(it.accept), audioHint: str(it.song) }),
  },
  {
    id: 'soundCheck', family: 'audio', ...choiceOrText, media: 'audio',
    defaults: { time: 20, points: 1, scoring: 'points' },
    fields: ['audio', 'question', 'answerOrChoices', 'time', 'points'],
    validate(q, fail) { need.audio(q, fail); if (Array.isArray(q.answers) && q.answers.length) need.answers(q, fail); else need.answer(q, fail); },
    aiShape: '{"question": "What makes this sound?", "answers": ["...", "...", "...", "..."], "correct": 0, "sound": "description of the sound to record or find"}',
    fromAI: it => ({ question: str(it.question), answers: list(it.answers).slice(0, 4), correct: Number(it.correct) || 0, audioHint: str(it.sound) }),
  },
  {
    id: 'lyricGap', family: 'audio', ...textType,
    defaults: { time: 25, points: 1, scoring: 'points' },
    fields: ['question', 'answer', 'audio', 'time', 'points'],
    validate(q, fail) { need.text(q, fail); need.answer(q, fail); },
    aiShape: '{"question": "a line of a famous song with the missing word as ___", "answer": "missing word", "song": "Artist - Title"}  (quote at most one short line)',
    fromAI: it => ({ question: str(it.question), answer: str(it.answer), audioHint: str(it.song) }),
  },
  {
    id: 'pixelFog', family: 'visual', ...choiceOrText, effect: 'pixel',
    defaults: { time: 25, points: 5, scoring: 'ladder' },
    fields: ['image', 'question', 'answerOrChoices', 'time', 'points'],
  },
  {
    id: 'silhouette', family: 'visual', ...choiceOrText, effect: 'silhouette',
    defaults: { time: 20, points: 1, scoring: 'points' },
    fields: ['image', 'question', 'answerOrChoices', 'time', 'points'],
    aiShape: '{"question": "Whose shadow is this?", "answer": "short answer", "accept": ["..."], "imagePrompt": "a prompt for an image AI: the subject alone on a plain white background, clear outline", "imageSearch": "2 to 4 English words to find a real photo of the subject on Wikimedia Commons"}',
  },
  {
    id: 'oddOneOut', family: 'visual', kind: 'choice',
    defaults: { time: 20, points: 1, scoring: 'points' },
    fields: ['question', 'images', 'time', 'points'],
    validate(q, fail) {
      if (!Array.isArray(q.images) || q.images.length < 3 || q.images.length > 4 || q.images.some(x => !str(x))) fail('needs 3 or 4 pictures');
      if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct >= q.images.length) fail('has no odd one marked');
    },
    parse: (raw, q) => (Number.isInteger(raw) && raw >= 0 && raw < q.images.length ? raw : undefined),
    isCorrect: (a, q) => a === q.correct,
    publicQ: q => ({ images: q.images, answers: q.images.map((_, i) => (q.captions && q.captions[i]) || '') }),
    revealQ: q => ({ correct: q.correct, answerText: (q.captions && q.captions[q.correct]) || '' }),
    aiShape: '{"question": "Which one does not belong?", "captions": ["...", "...", "...", "..."], "correct": 2, "imagePrompts": ["...", "...", "...", "..."]}',
    fromAI: it => ({ question: str(it.question), captions: list(it.captions).slice(0, 4), correct: Number(it.correct) || 0, images: [], imagePrompt: list(it.imagePrompts).join(' | ') }),
  },
  {
    id: 'emoji', family: 'visual', ...textType,
    defaults: { time: 30, points: 1, scoring: 'points' },
    fields: ['emoji', 'question', 'answer', 'time', 'points'],
    validate(q, fail) { if (!str(q.emoji)) fail('needs emoji'); need.answer(q, fail); },
    publicQ: q => ({ emoji: str(q.emoji) }),
    aiShape: '{"emoji": "🦁👑", "question": "Which film?", "answer": "short answer", "accept": ["..."]}  (3 to 6 emoji that spell out a film, song, saying or place)',
    fromAI: it => ({ emoji: str(it.emoji), question: str(it.question), answer: str(it.answer), accept: list(it.accept) }),
  },
  {
    id: 'orderUp', family: 'classic', kind: 'order',
    defaults: { time: 40, points: 2, scoring: 'points' },
    fields: ['question', 'items', 'time', 'points'],
    validate(q, fail) {
      need.text(q, fail);
      if (!Array.isArray(q.items) || q.items.length < 3 || q.items.length > 6 || q.items.some(x => !str(x))) fail('needs 3 to 6 items');
    },
    // The phone sends the shown items in the order the team chose (indexes into the shown list).
    parse(raw, q) {
      const n = q.items.length;
      if (!Array.isArray(raw) || raw.length !== n || new Set(raw).size !== n || raw.some(i => !Number.isInteger(i) || i < 0 || i >= n)) return undefined;
      const shown = permutation(n, q.items.join('|'));
      return raw.map(i => shown[i]);
    },
    isCorrect: a => a.every((v, i) => v === i),
    publicQ: q => ({ items: permutation(q.items.length, q.items.join('|')).map(i => q.items[i]) }),
    revealQ: q => ({ order: q.items, answerText: q.items.join(' → ') }),
    aiShape: '{"question": "Put these in order from oldest to newest", "items": ["first", "second", "third", "fourth"]}  (items listed in the RIGHT order; say in the question what the order is)',
    fromAI: it => ({ question: str(it.question), items: list(it.items).slice(0, 6) }),
  },
  {
    id: 'pairUp', family: 'classic', kind: 'pairs',
    defaults: { time: 45, points: 2, scoring: 'points' },
    fields: ['question', 'pairs', 'time', 'points'],
    validate(q, fail) {
      need.text(q, fail);
      if (!Array.isArray(q.pairs) || q.pairs.length < 3 || q.pairs.length > 5 || q.pairs.some(p => !Array.isArray(p) || !str(p[0]) || !str(p[1]))) fail('needs 3 to 5 pairs');
    },
    // The phone sends, for every left item, the index of the right item it picked (in the shown right column).
    parse(raw, q) {
      const n = q.pairs.length;
      if (!Array.isArray(raw) || raw.length !== n || new Set(raw).size !== n || raw.some(i => !Number.isInteger(i) || i < 0 || i >= n)) return undefined;
      const shown = permutation(n, q.pairs.map(p => p[1]).join('|'));
      return raw.map(i => shown[i]);
    },
    isCorrect: a => a.every((v, i) => v === i),
    publicQ: q => ({ left: q.pairs.map(p => p[0]), right: permutation(q.pairs.length, q.pairs.map(p => p[1]).join('|')).map(i => q.pairs[i][1]) }),
    revealQ: q => ({ pairs: q.pairs, answerText: q.pairs.map(p => `${p[0]} = ${p[1]}`).join(' · ') }),
    aiShape: '{"question": "Match the country to its capital", "pairs": [["left", "right"], ["left", "right"], ["left", "right"], ["left", "right"]]}',
    fromAI: it => ({ question: str(it.question), pairs: (Array.isArray(it.pairs) ? it.pairs : []).filter(p => Array.isArray(p) && p.length >= 2).map(p => [str(p[0]), str(p[1])]).slice(0, 5) }),
  },
  {
    id: 'mapDrop', family: 'visual', kind: 'point',
    defaults: { time: 30, points: 2 },
    fields: ['image', 'question', 'spot', 'time', 'points'],
    scorings: [],
    validate(q, fail) {
      need.image(q, fail);
      need.text(q, fail);
      if (!q.spot || !(q.spot.x >= 0 && q.spot.x <= 1 && q.spot.y >= 0 && q.spot.y <= 1)) fail('needs the right spot on the picture');
    },
    parse: raw => (raw && Number.isFinite(raw.x) && Number.isFinite(raw.y) && raw.x >= 0 && raw.x <= 1 && raw.y >= 0 && raw.y <= 1 ? { x: Math.round(raw.x * 1000) / 1000, y: Math.round(raw.y * 1000) / 1000 } : undefined),
    publicQ: () => ({}),
    revealQ: q => ({ spot: q.spot, answerText: str(q.answer) }),
    // The closest pin gets the points, a pin within 2% of the picture doubles them.
    score(entries, q, base) {
      const d = e => (e.answer ? pointDistance(e.answer, q.spot) : Infinity);
      const best = Math.min(...entries.map(d));
      return entries.map(e => (e.answer && d(e) === best ? { points: d(e) <= 0.02 ? base * 2 : base, correct: true } : { points: 0, correct: false }));
    },
    aiShape: '{"question": "Where is Paris?", "answer": "Paris", "mapHint": "which map to use, e.g. a map of Europe"}  (the quizmaster adds the map and clicks the right spot)',
    fromAI: it => ({ question: str(it.question), answer: str(it.answer), imagePrompt: str(it.mapHint) }),
  },
// ---------- wave 3: speed and strategy ----------
  {
    id: 'buzzer', family: 'speed', kind: 'buzz',
    defaults: { time: 30, points: 1, scoring: 'points' },
    fields: ['question', 'answer', 'image', 'time', 'points'],
    scorings: ['points', 'risk'],
    validate(q, fail) { need.text(q, fail); },
    parse: raw => (raw === true ? true : undefined),
    publicQ: () => ({}),
    revealQ: q => ({ answerText: str(q.answer) }),
    // The quizmaster judged the team that buzzed: 'right' or 'wrong' (with risk, wrong costs the points).
    score: (entries, q, base, ctx) => entries.map(e => (e.answer === 'right' ? { points: base, correct: true } : { points: e.answer === 'wrong' && ctx.scoring === 'risk' ? -base : 0, correct: false })),
    aiShape: '{"question": "...", "answer": "short answer the quizmaster reads"}  (quick questions with one clear answer)',
    fromAI: it => ({ question: str(it.question), answer: str(it.answer) }),
  },
  {
    id: 'lastStanding', family: 'strategy', ...choiceType,
    defaults: { time: 15, points: 1 },
    fields: ['question', 'answers', 'image', 'time', 'points'],
    scorings: [],
    // A wrong or missing answer and the team is out for the rest of the round. Survivors score every question.
    score: (entries, q, base) => entries.map(e => {
      if (e.mem.out) return { points: 0, correct: false };
      const right = e.answer === q.correct;
      return right ? { points: base, correct: true } : { points: 0, correct: false, mem: { ...e.mem, out: true } };
    }),
    sitsOut: mem => !!mem.out,
  },
  {
    id: 'pushYourLuck', family: 'strategy', ...choiceType,
    defaults: { time: 15, points: 1 },
    fields: ['question', 'answers', 'image', 'time', 'points'],
    scorings: [],
    // Every right answer doubles the pot (1, 2, 4, 8 ...). Bank it before a question to keep it; a wrong answer empties it.
    // The pot is banked by itself after the last question of the round.
    score: (entries, q, base, ctx) => entries.map(e => {
      if (e.mem.banked) return { points: 0, correct: false };
      if (e.bank) return { points: e.mem.pot, correct: true, mem: { ...e.mem, pot: 0, banked: true } };
      const right = e.answer === q.correct;
      const pot = right ? (e.mem.pot ? e.mem.pot * 2 : base) : 0;
      if (ctx.lastQuestion && pot) return { points: pot, correct: true, mem: { ...e.mem, pot: 0, banked: true } };
      return { points: 0, correct: right, mem: { ...e.mem, pot } };
    }),
    sitsOut: mem => !!mem.banked,
    canBank: mem => !mem.banked && mem.pot > 0,
  },
  {
    id: 'steal', family: 'strategy', ...textType, judge: true,
    defaults: { time: 30, points: 2 },
    fields: ['question', 'answer', 'image', 'time', 'points'],
    scorings: [],
    // Every right team scores, and takes those points from the leader (the leader can not go below zero this way).
    score: (entries, q, base, ctx) => {
      const right = entries.map(e => ctx.isRight(e));
      const thieves = entries.filter((e, i) => right[i] && !ctx.leaders.includes(e.id)).length;
      return entries.map((e, i) => {
        let points = right[i] ? base : 0;
        if (ctx.leaders.includes(e.id) && thieves) points -= Math.min(base * thieves, Math.max(0, e.score));
        return { points, correct: right[i] };
      });
    },
  },
  {
    id: 'pickYourLevel', family: 'strategy', kind: 'level', wager: 'level',
    defaults: { time: 25, points: 1 },
    fields: ['category', 'levels', 'time', 'points'],
    scorings: [],
    validate(q, fail) {
      if (!Array.isArray(q.levels) || q.levels.length !== 3) fail('needs an easy, a medium and a hard question');
      q.levels.forEach(l => { need.text(l || {}, fail); need.answers(l || {}, fail); });
    },
    // The team picked a level (0, 1, 2) first; the phone sends the index of its answer.
    parse: (raw, q, team) => {
      const l = team && Number.isInteger(team.wager) ? team.wager : 0;
      return Number.isInteger(raw) && raw >= 0 && raw < q.levels[l].answers.length ? { l, i: raw } : undefined;
    },
    isCorrect: (a, q) => a.i === q.levels[a.l].correct,
    publicQ: q => ({ category: str(q.category), levels: q.levels.map((l, i) => ({ points: i + 1 })) }),
    teamQ: (q, team) => {
      const l = q.levels[team.wager || 0];
      return { level: team.wager || 0, text: l.question, answers: l.answers };
    },
    revealQ: q => ({ levels: q.levels.map(l => ({ question: l.question, answer: l.answers[l.correct] })), answerText: q.levels.map(l => l.answers[l.correct]).join(' · ') }),
    score: (entries, q, base) => entries.map(e => (e.answer && e.answer.i === q.levels[e.answer.l].correct ? { points: base * (e.answer.l + 1), correct: true } : { points: 0, correct: false })),
    aiShape: '{"category": "topic", "levels": [{"question": "easy", "answers": ["...", "...", "...", "..."], "correct": 0}, {"question": "medium", ...}, {"question": "hard", ...}]}',
    fromAI: it => ({ category: str(it.category), levels: (Array.isArray(it.levels) ? it.levels : []).slice(0, 3).map(l => ({ question: str(l && l.question), answers: list(l && l.answers).slice(0, 4), correct: Number(l && l.correct) || 0 })) }),
  },
  {
    id: 'hotStreak', family: 'speed', kind: 'choice', judge: true,
    kindOf: q => (Array.isArray(q.answers) && q.answers.length ? 'choice' : 'text'),
    defaults: { time: 15, points: 1 },
    fields: ['question', 'answerOrChoices', 'image', 'time', 'points'],
    scorings: [],
    validate(q, fail) {
      need.text(q, fail);
      if (Array.isArray(q.answers) && q.answers.length) need.answers(q, fail); else need.answer(q, fail);
    },
    parse: (raw, q) => (Array.isArray(q.answers) && q.answers.length ? choiceType.parse(raw, q) : textType.parse(raw)),
    isCorrect: (a, q) => (Array.isArray(q.answers) && q.answers.length ? a === q.correct : textMatches(a, q)),
    publicQ: q => (Array.isArray(q.answers) && q.answers.length ? { answers: q.answers } : {}),
    revealQ: q => (Array.isArray(q.answers) && q.answers.length ? choiceType.revealQ(q) : { answerText: q.answer }),
    // Right answers in a row count up: 1x, 2x, 3x the points. A miss starts again at 1x.
    score: (entries, q, base, ctx) => entries.map(e => {
      if (!ctx.isRight(e)) return { points: 0, correct: false, mem: { ...e.mem, streak: 0 } };
      const streak = (e.mem.streak || 0) + 1;
      return { points: base * streak, correct: true, mem: { ...e.mem, streak } };
    }),
    aiShape: textType.aiShape,
    fromAI: textType.fromAI,
  },
  {
    id: 'listRush', family: 'speed', ...listType(3, 200),
    defaults: { time: 60, points: 1 },
    fields: ['question', 'listItems', 'time', 'points'],
    scorings: [],
    aiShape: '{"question": "Name as many ... as you can", "items": ["item", "item / other spelling", "..."]}  (10 to 30 items)',
    fromAI: it => ({ question: str(it.question), items: list(it.items).slice(0, 60) }),
  },
  {
    id: 'crowdMind', family: 'party', kind: 'text',
    defaults: { time: 30, points: 2 },
    fields: ['question', 'time', 'points'],
    scorings: [],
    validate(q, fail) { need.text(q, fail); },
    parse: textType.parse,
    publicQ: () => ({}),
    revealQ: () => ({ answerText: '' }),
    // Think like the room: the teams with the most common answer score (at least two teams must agree).
    score(entries, q, base) {
      const groups = new Map();
      for (const e of entries) if (e.answer) { const k = normalize(e.answer); groups.set(k, (groups.get(k) || 0) + 1); }
      const top = Math.max(0, ...groups.values());
      return entries.map(e => {
        const ok = !!e.answer && top >= 2 && groups.get(normalize(e.answer)) === top;
        return { points: ok ? base : 0, correct: ok };
      });
    },
    crowd: true,
    aiShape: '{"question": "Name something most people ..."}  (open questions with many possible answers, where a few answers are very common)',
    fromAI: it => ({ question: str(it.question) }),
  },
// ---------- wave 4: party ----------
  {
    id: 'drawGuess', family: 'party', kind: 'draw', vote: 'best',
    defaults: { time: 90, points: 1 },
    fields: ['question', 'time', 'points'],
    scorings: [],
    validate(q, fail) { need.text(q, fail); },
    parse: raw => mediaUrl(raw),
    publicQ: () => ({}),
    revealQ: () => ({ answerText: '' }),
    score: voteScore,
    aiShape: '{"question": "Draw ...: a funny thing to draw in one minute"}  (silly, concrete things that are fun to draw)',
    fromAI: it => ({ question: str(it.question) }),
  },
  {
    id: 'captionThis', family: 'party', kind: 'text', vote: 'best',
    defaults: { time: 60, points: 1 },
    fields: ['image', 'question', 'time', 'points'],
    scorings: [],
    validate(q, fail) { need.image(q, fail); },
    parse: raw => (typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, 120) : undefined),
    publicQ: () => ({}),
    revealQ: () => ({ answerText: '' }),
    score: voteScore,
    aiShape: '{"question": "Write the funniest caption", "imagePrompt": "a prompt for an image AI: a funny, odd scene without text"}',
    fromAI: it => ({ question: str(it.question), imagePrompt: str(it.imagePrompt) }),
  },
  {
    id: 'bluffBank', family: 'party', kind: 'text', vote: 'truth',
    defaults: { time: 45, points: 1 },
    fields: ['question', 'answer', 'image', 'time', 'points'],
    scorings: [],
    validate(q, fail) { need.text(q, fail); need.answer(q, fail); },
    // A bluff that is (almost) the real answer does not count.
    parse: (raw, q) => (typeof raw === 'string' && raw.trim() && !textMatches(raw, q) ? raw.trim().slice(0, 80) : undefined),
    publicQ: () => ({}),
    revealQ: q => ({ answerText: q.answer }),
    score: voteScore,
    aiShape: '{"question": "an obscure but real fact as a question", "answer": "the surprising real answer"}  (the real answer should sound unlikely, so bluffs can compete)',
    fromAI: it => ({ question: str(it.question), answer: str(it.answer) }),
  },
  {
    id: 'actItOut', family: 'party', kind: 'text', judge: true, actor: true,
    defaults: { time: 60, points: 1 },
    fields: ['answer', 'time', 'points'],
    scorings: [],
    validate(q, fail) { need.answer(q, fail); },
    parse: textType.parse,
    isCorrect: (a, q) => textMatches(a, q),
    publicQ: () => ({}),
    revealQ: q => ({ answerText: q.answer }),
    // One team acts the secret out without words; the others type what it is. The actors score if anyone gets it.
    score: (entries, q, base, ctx) => {
      const right = entries.map(e => e.id !== ctx.actor && ctx.isRight(e));
      const any = right.some(Boolean);
      return entries.map((e, i) => (e.id === ctx.actor ? { points: any ? base : 0, correct: any } : { points: right[i] ? base : 0, correct: right[i] }));
    },
    aiShape: '{"answer": "a film, job, animal or action to act out without words", "accept": ["..."]}',
    fromAI: it => ({ answer: str(it.answer), accept: list(it.accept), question: '' }),
  },
  {
    id: 'photoHunt', family: 'party', kind: 'photo', vote: 'best',
    defaults: { time: 120, points: 1 },
    fields: ['question', 'time', 'points'],
    scorings: [],
    validate(q, fail) { need.text(q, fail); },
    parse: raw => mediaUrl(raw),
    publicQ: () => ({}),
    revealQ: () => ({ answerText: '' }),
    score: voteScore,
    aiShape: '{"question": "Take a photo of ...: a fun task that can be done in the room in 2 minutes"}',
    fromAI: it => ({ question: str(it.question) }),
  },
  {
    id: 'whosWho', family: 'party', kind: 'text', vote: 'match',
    defaults: { time: 60, points: 1 },
    fields: ['question', 'time', 'points'],
    scorings: [],
    validate(q, fail) { need.text(q, fail); },
    parse: raw => (typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, 100) : undefined),
    publicQ: () => ({}),
    revealQ: () => ({ answerText: '' }),
    score: voteScore,
    aiShape: '{"question": "a personal question teams answer about themselves, e.g. Our worst holiday ever was ..."}',
    fromAI: it => ({ question: str(it.question) }),
  },
// ---------- wave 5: clocks, finales and the last specials ----------
  {
    id: 'stakeIt', family: 'strategy', ...choiceType, wager: true,
    defaults: { time: 20, points: 3 },
    fields: ['category', 'question', 'answers', 'image', 'time', 'points'],
    scorings: [],
    publicQ: q => ({ answers: q.answers, category: str(q.category) }),
    // Bet on the category first. Right = + the bet, wrong or no answer = - the bet.
    score: (entries, q) => entries.map(e => (e.answer === q.correct ? { points: e.wager, correct: true } : { points: -e.wager, correct: false })),
    aiShape: '{"category": "category shown before betting", "question": "...", "answers": ["...", "...", "...", "..."], "correct": 0}',
    fromAI: it => ({ ...choiceType.fromAI(it), category: str(it.category) }),
  },
  {
    id: 'localLegend', family: 'special', kind: 'choice', judge: true,
    kindOf: q => (Array.isArray(q.answers) && q.answers.length ? 'choice' : 'text'),
    defaults: { time: 25, points: 1, scoring: 'points' },
    fields: ['question', 'answerOrChoices', 'image', 'time', 'points'],
    validate(q, fail) {
      need.text(q, fail);
      if (Array.isArray(q.answers) && q.answers.length) need.answers(q, fail); else need.answer(q, fail);
    },
    parse: (raw, q) => (Array.isArray(q.answers) && q.answers.length ? choiceType.parse(raw, q) : textType.parse(raw)),
    isCorrect: (a, q) => (Array.isArray(q.answers) && q.answers.length ? a === q.correct : textMatches(a, q)),
    publicQ: q => (Array.isArray(q.answers) && q.answers.length ? { answers: q.answers } : {}),
    revealQ: q => (Array.isArray(q.answers) && q.answers.length ? choiceType.revealQ(q) : { answerText: q.answer }),
    aiShape: '{"question": "a question about the town, club or pub (the quizmaster checks the facts)", "answer": "short answer", "accept": ["..."]}',
    fromAI: textType.fromAI,
  },
  {
    id: 'clueLadder', family: 'puzzle', ...textType,
    defaults: { time: 50, points: 5, scoring: 'ladder' },
    fields: ['clues', 'answer', 'time', 'points'],
    validate(q, fail) {
      need.answer(q, fail);
      if (list(q.clues).length < 3 || list(q.clues).length > 6) fail('needs 3 to 6 clues');
    },
    steps: q => list(q.clues).length,
    publicQ: q => ({ clues: list(q.clues), ladder: true }),
    aiShape: '{"clues": ["very hard clue", "hard clue", "medium clue", "easy clue", "giveaway clue"], "answer": "who or what it is", "accept": ["..."]}  (5 clues about one person, place or thing, from hard to easy)',
    fromAI: it => ({ clues: list(it.clues).slice(0, 6), answer: str(it.answer), accept: list(it.accept), question: '' }),
  },
  {
    id: 'fiveFacts', family: 'classic', ...listType(3, 6),
    defaults: { time: 45, points: 1 },
    fields: ['question', 'listItems', 'time', 'points'],
    scorings: [],
    // One point per keyword; all of them = double.
    score(entries, q, base) {
      const total = list(q.items).length;
      return entries.map(e => {
        const n = listFound(e.answer, q).length;
        return { points: n === total ? n * base * 2 : n * base, correct: n > 0, found: n };
      });
    },
    aiShape: '{"question": "Name the five ...", "items": ["keyword", "keyword / other spelling", "...", "...", "..."]}  (exactly 5 keywords)',
    fromAI: it => ({ question: str(it.question), items: list(it.items).slice(0, 6) }),
  },
  {
    id: 'clipRecall', family: 'visual', ...listType(3, 30), media: 'video',
    defaults: { time: 60, points: 1 },
    fields: ['video', 'question', 'listItems', 'time', 'points'],
    scorings: [],
    validate(q, fail) {
      if (!str(q.video)) fail('needs a video');
      need.text(q, fail);
      if (list(q.items).length < 3) fail('needs at least 3 details');
    },
    aiShape: '{"question": "What did you see? Name as many details as you can", "items": ["detail", "detail / other word", "..."], "clip": "description of the clip to film or find"}  (8 to 15 details that can be seen in the clip)',
    fromAI: it => ({ question: str(it.question), items: list(it.items).slice(0, 30), videoHint: str(it.clip) }),
  },
  {
    id: 'opponentsPick', family: 'strategy', kind: 'choice', wager: 'pick',
    defaults: { time: 20, points: 2, scoring: 'points' },
    fields: ['options', 'time', 'points'],
    scorings: ['points', 'speed', 'risk'],
    validate(q, fail) {
      if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 3) fail('needs 2 or 3 categories');
      (q.options || []).forEach(o => { if (!str(o && o.category)) fail('has a category without a name'); need.text(o || {}, fail); need.answers(o || {}, fail); });
    },
    // The leading team picks one category; everyone else gets that question.
    resolve: (q, pick) => ({ ...q, ...q.options[Math.min(q.options.length - 1, Math.max(0, pick || 0))] }),
    parse: choiceType.parse,
    isCorrect: choiceType.isCorrect,
    publicQ: q => ({ answers: q.answers, category: str(q.category) }),
    revealQ: q => (q.answers ? choiceType.revealQ(q) : { answerText: q.options.map(o => `${o.category}: ${o.answers[o.correct]}`).join(' · ') }),
    aiShape: '{"options": [{"category": "...", "question": "...", "answers": ["...", "...", "...", "..."], "correct": 0}, {"category": "...", ...}, {"category": "...", ...}]}  (3 different categories, one question each, about as hard)',
    fromAI: it => ({ options: (Array.isArray(it.options) ? it.options : []).slice(0, 3).map(o => ({ category: str(o && o.category), ...choiceType.fromAI(o || {}) })) }),
  },
  {
    id: 'headToHead', family: 'special', ...choiceType, wager: 'predict', finale: true,
    defaults: { time: 15, points: 2 },
    fields: ['question', 'answers', 'image', 'time', 'points'],
    scorings: [],
    // Only the top two play. The fastest right finalist wins the question; every team that predicted the winner scores too.
    score: (entries, q, base, ctx) => {
      const f = ctx.finalists || [];
      const right = entries.filter(e => f.includes(e.id) && e.answer === q.correct);
      const winner = right.sort((a, b) => a.answeredAt - b.answeredAt)[0];
      return entries.map(e => {
        if (f.includes(e.id)) return winner && winner.id === e.id ? { points: base, correct: true } : { points: 0, correct: false };
        const ok = !!winner && Number.isInteger(e.pick) && f[e.pick] === winner.id;
        return { points: ok ? base : 0, correct: ok };
      });
    },
  },
  {
    id: 'clockBank', family: 'clock', kind: 'turn', turns: 'bank', clock: 60,
    defaults: { time: 10, points: 1 },
    fields: ['question', 'answer', 'time', 'points'],
    scorings: [],
    validate(q, fail) { need.text(q, fail); need.answer(q, fail); },
    parse: () => undefined,
    publicQ: () => ({}),
    revealQ: q => ({ answerText: q.answer }),
    // One team at a time answers out loud while its own clock runs. Right = the points and extra seconds; at zero the team is out.
    score: (entries, q, base, ctx) => entries.map(e => (e.id === ctx.turn && e.answer === 'right' ? { points: base, correct: true } : { points: 0, correct: false })),
    aiShape: '{"question": "...", "answer": "short answer the quizmaster reads"}  (quick questions with one clear answer)',
    fromAI: it => ({ question: str(it.question), answer: str(it.answer) }),
  },
  {
    id: 'clockDuel', family: 'clock', kind: 'turn', turns: 'duel', clock: 45, finale: true,
    defaults: { time: 10, points: 5 },
    fields: ['question', 'answer', 'points'],
    scorings: [],
    validate(q, fail) { need.text(q, fail); need.answer(q, fail); },
    parse: () => undefined,
    publicQ: () => ({}),
    revealQ: q => ({ answerText: q.answer }),
    // The top two take turns; your clock runs until you answer right. Whoever still has time when the other runs out wins the points.
    score: (entries, q, base, ctx) => {
      const winner = ctx.duelWinner;
      return entries.map(e => (winner && e.id === winner ? { points: base, correct: true } : { points: 0, correct: e.id === ctx.turn && e.answer === 'right' }));
    },
    aiShape: '{"question": "...", "answer": "short answer the quizmaster reads"}  (many quick questions with one clear answer; a duel uses a lot of them)',
    fromAI: it => ({ question: str(it.question), answer: str(it.answer) }),
  },
];

const BY_ID = Object.fromEntries(TYPES.map(t => [t.id, t]));
for (const t of TYPES) {
  if (!t.scorings) t.scorings = t.steps || t.effect ? ['ladder', 'points', 'speed', 'race', 'risk', 'time'] : ['points', 'speed', 'race', 'risk', 'time'];
}

const get = id => BY_ID[id];
const kindOf = (type, q) => (type.kindOf ? type.kindOf(q) : type.kind);
const stepsOf = (type, q) => (type.steps ? type.steps(q) : type.effect ? 5 : 1);
const isTurn = type => !!(type && type.turns);

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
    types: TYPES.map(t => ({ id: t.id, family: t.family, kind: t.kindOf ? 'choiceOrText' : t.kind, fields: t.fields, defaults: t.defaults, scorings: t.scorings, wager: t.wager || false, effect: t.effect || null, media: t.media || null, finale: !!t.finale, clock: t.clock || null })),
  };
}

module.exports = { isTurn, listFound, permutation, pointDistance, TYPES, SCORINGS, TWISTS, FAMILIES, get, kindOf, stepsOf, withDefaults, catalog, normalize, textMatches, scramble, list, str };
