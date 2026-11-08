// From an AI answer to a quiz night, for every round type: read the pasted answer (also when the AI wrote it a bit
// differently), fill in what the quizmaster adds by hand (pictures, sound, video, the spot on a map), check, save,
// export and import as JSON and CSV, and play it through with two teams.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const rounds = require('../src/rounds');
const ai = require('../src/ai');
const csv = require('../src/csv');
const Library = require('../src/library');
const { Game, validateQuiz } = require('../src/game');
const SAMPLES = require('./fixtures/ai-answers');

const MEDIA = '/media/aaaaaaaaaaaaaaaaaaaa.webp';

// What the quizmaster adds in the builder after the AI wrote the questions.
function fillLikeBuilder(typeId, q) {
  const type = rounds.get(typeId);
  const out = JSON.parse(JSON.stringify(q));
  if (type.fields.includes('image') && !out.image) out.image = MEDIA;
  if (type.fields.includes('audio') && !out.audio) out.audio = '/media/bbbbbbbbbbbbbbbbbbbb.mp3';
  if (type.fields.includes('video') && !out.video) out.video = '/media/cccccccccccccccccccc.mp4';
  if (type.fields.includes('images')) out.images = out.images.map(x => x || MEDIA);
  if (type.fields.includes('spot') && !out.spot) out.spot = { x: 0.4, y: 0.6 };
  return out;
}

// Problems of a question, the way the builder's check shows them.
function problems(typeId, q) {
  const out = [];
  rounds.get(typeId).validate(q, m => out.push(m));
  return out;
}

// Ways an AI chat writes the same answer.
const STYLES = {
  clean: list => JSON.stringify({ questions: list }),
  chatterAndFence: list => `Sure! Here are your questions:\n\n\`\`\`json\n${JSON.stringify({ questions: list }, null, 2)}\n\`\`\`\n\nEnjoy the quiz night!`,
  bareList: list => JSON.stringify(list, null, 1),
  capitalKeys: list => JSON.stringify({ Questions: list.map(q => upperKeys(q)) }),
  snakeKeys: list => JSON.stringify({ questions: list }).replace(/"([a-z]+)([A-Z])([a-z]+)":/g, (m, a, b, c) => `"${a}_${b.toLowerCase()}${c}":`),
  dutchKey: list => JSON.stringify({ vragen: list }),
  trailingCommas: list => `{"questions": [${list.map(q => JSON.stringify(q).replace(/\}$/, ',}')).join(',\n')},]}`,
  // Copied from a chat as markdown: "\\" at each line end, "&#x20;" for leading spaces, escaped [ ] _ and &quot;.
  markdownCopy: list => JSON.stringify({ questions: list }, null, 2).split('\n')
    .map(l => l.replace(/^ /, '&#x20;').replace(/[[\]_*]/g, c => `\\${c}`).replace(/&(?!#x20;)/g, '&amp;')).join('\\\n'),
  markdownEntities: list => JSON.stringify({ questions: list }, null, 2).replace(/"/g, '&quot;').replace(/\n {2}/g, '\n&nbsp; '),
  cutOff: list => { const s = JSON.stringify({ questions: [...list, list[0]] }); return s.slice(0, s.length - 8); },
};
const upperKeys = v => (Array.isArray(v) ? v.map(upperKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k[0].toUpperCase() + k.slice(1), upperKeys(x)])) : v);

test('every round type has an AI sample here, so a new type cannot skip this check', () => {
  assert.deepEqual(Object.keys(SAMPLES).sort(), rounds.TYPES.map(t => t.id).sort());
});

test('every round type: an AI answer in any style becomes questions that only miss what the quizmaster adds by hand', () => {
  for (const t of rounds.TYPES) {
    const sample = SAMPLES[t.id];
    for (const [style, write] of Object.entries(STYLES)) {
      const got = ai.parseRound(write([sample, sample]), t.id);
      assert.equal(got.length, 2, `${t.id} / ${style}: both questions`);
      const filled = fillLikeBuilder(t.id, got[0]);
      assert.deepEqual(problems(t.id, filled), [], `${t.id} / ${style}: ${JSON.stringify(got[0])}`);
    }
  }
});

test('every round type: the same question from the AI keeps its texts, right answer and media hints', () => {
  const one = id => ai.parseRound(JSON.stringify({ questions: [SAMPLES[id]] }), id)[0];
  assert.equal(one('classic').correct, 1);
  assert.equal(one('classic').fact, 'A short true fact.');
  assert.equal(one('trueFalse').correct, true);
  assert.equal(one('open').answer, '1969');
  assert.equal(one('closest').answer, 8849);
  assert.equal(one('scramble').answer, 'WAFFLE');
  assert.equal(one('music').audioHint, 'Stromae - Alors on danse');
  assert.equal(one('music').start, 35);
  assert.equal(one('soundCheck').answers.length, 4);
  assert.equal(one('oddOneOut').correct, 2);
  assert.deepEqual(one('oddOneOut').images, ['', '', '', '']);
  assert.match(one('oddOneOut').imagePrompt, /Ardennes/);
  assert.equal(one('mapDrop').imageSearch, 'a map of Belgium');
  assert.equal(one('captionThis').imageSearch, 'dog sunglasses');
  assert.equal(one('buzzer').answer, '1440');
  assert.equal(one('clockDuel').answer, '2');
  assert.equal(one('pickYourLevel').levels[2].correct, 2);
  assert.equal(one('opponentsPick').options.length, 3);
  assert.equal(one('wordWeb').groups[1].link, 'Planets');
});

test('AI answers written a bit differently are still read right', () => {
  const read = (type, q) => ai.parseRound(JSON.stringify({ questions: [q] }), type)[0];
  const four = ['Lyon', 'Paris', 'Nice', 'Lille'];
  // The right option as text, as a letter, with "A) " in front, as a 1-based number, or marked inside the options.
  assert.equal(read('classic', { question: 'Q', answers: four, correct: 'Paris' }).correct, 1);
  assert.equal(read('classic', { question: 'Q', answers: four, correct: 'B' }).correct, 1);
  assert.equal(read('classic', { question: 'Q', answers: four, correct_answer: 'Paris' }).correct, 1);
  assert.equal(read('classic', { question: 'Q', options: four, answer: 'Paris' }).correct, 1);
  assert.equal(read('classic', { question: 'Q', answers: four, correct: 4 }).correct, 3);
  assert.deepEqual(read('classic', { question: 'Q', answers: ['A) Lyon', 'B) Paris', 'C) Nice', 'D) Lille'], correct: 'B) Paris' }), { question: 'Q', answers: four, correct: 1 });
  assert.deepEqual(read('classic', { question: 'Q', answers: [{ text: 'Lyon' }, { text: 'Paris', correct: true }, { text: 'Nice' }, { text: 'Lille' }] }).answers, four);
  assert.equal(read('classic', { question: 'Q', answers: [{ text: 'Lyon' }, { text: 'Paris', correct: true }] }).correct, 1);
  assert.deepEqual(read('classic', { question: 'Q', answers: { A: 'Lyon', B: 'Paris', C: 'Nice', D: 'Lille' }, correct: 'B' }), { question: 'Q', answers: four, correct: 1 });
  assert.equal(read('classic', { text: 'Q', answers: four, correct: 0 }).question, 'Q');
  // True or false in words, in our languages.
  for (const [v, want] of [['True', true], ['TRUE', true], ['waar', true], ['vrai', true], ['false', false], ['Niet waar', false], ['faux', false]]) assert.equal(read('trueFalse', { statement: 'S', correct: v }).correct, want, v);
  assert.equal(read('trueFalse', { statement: 'S', answer: true }).correct, true);
  // Numbers the way people write them.
  for (const [v, want] of [['8,849', 8849], ['8.849', 8849], ['11.700.000', 11700000], ['1,234,567', 1234567], ['11.7 million', 11700000], ['3,5', 3.5], ['0.125', 0.125], ['ca. 330 m', 330], ['-40', -40], ['1.234,5', 1234.5], [42, 42]]) {
    assert.equal(read('closest', { question: 'Q', answer: v }).answer, want, String(v));
  }
  assert.equal(read('closest', { question: 'Q', answer: 'no idea' }).answer, null);
  // Pairs, orders, groups and lists in other shapes.
  const pairs = [['France', 'Paris'], ['Spain', 'Madrid'], ['Italy', 'Rome']];
  assert.deepEqual(read('pairUp', { question: 'Q', pairs: [{ left: 'France', right: 'Paris' }, { left: 'Spain', right: 'Madrid' }, { left: 'Italy', right: 'Rome' }] }).pairs, pairs);
  assert.deepEqual(read('pairUp', { question: 'Q', pairs: { France: 'Paris', Spain: 'Madrid', Italy: 'Rome' } }).pairs, pairs);
  assert.deepEqual(read('pairUp', { question: 'Q', pairs: ['France = Paris', 'Spain - Madrid', 'Italy: Rome'] }).pairs, pairs);
  assert.deepEqual(read('orderUp', { question: 'Q', items: [{ name: 'Moon landing', year: 1969 }, { name: 'Euro', year: 2002 }, { name: 'iPhone', year: 2007 }] }).items, ['Moon landing', 'Euro', 'iPhone']);
  assert.deepEqual(read('orderUp', { question: 'Q', items: [1, 22, 333] }).items, ['1', '22', '333']);
  assert.deepEqual(read('wordWeb', { question: 'Q', groups: [{ connection: 'Fish', words: 'cod, eel, ray, pike' }] }).groups[0], { link: 'Fish', words: ['cod', 'eel', 'ray', 'pike'] });
  assert.deepEqual(read('wordWeb', { question: 'Q', groups: { Fish: ['cod', 'eel', 'ray', 'pike'] } }).groups[0], { link: 'Fish', words: ['cod', 'eel', 'ray', 'pike'] });
  assert.deepEqual(read('fiveFacts', { question: 'Q', items: 'a, b, c, d, e' }).items, ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(read('commonThread', { clues: 'one\ntwo\nthree', answer: 'x' }).clues, ['one', 'two', 'three']);
  // Easy, medium and hard by name, or fewer levels than three: always three slots.
  const lv = { question: 'q', answers: ['1', '2', '3', '4'], correct: 0 };
  assert.equal(read('pickYourLevel', { category: 'S', levels: { easy: lv, medium: lv, hard: lv } }).levels.length, 3);
  assert.equal(read('pickYourLevel', { category: 'S', easy: lv, medium: lv, hard: lv }).levels.length, 3);
  assert.equal(read('pickYourLevel', { category: 'S', levels: [lv] }).levels.length, 3);
  // Choices where we asked for a typed answer, and the other way round.
  assert.equal(read('hotStreak', { question: 'Q', answers: four, correct: 1 }).answers.length, 4);
  assert.equal(read('localLegend', { question: 'Q', answers: four, correct: 1 }).correct, 1);
  assert.equal(read('picture', { question: 'Q', answers: four, correct: 1 }).answers.length, 4);
  assert.equal(read('music', { question: 'Q', answers: four, correct: 1 }).answers.length, 4);
  assert.equal(read('soundCheck', { question: 'Q', answer: 'a dog' }).answer, 'a dog');
  assert.equal(read('music', { question: 'Q', answer: 'x', artist: 'Queen', title: 'Bohemian Rhapsody' }).audioHint, 'Queen - Bohemian Rhapsody');
  // Odd one out with the options under another name, and the odd one as text.
  const odd = read('oddOneOut', { question: 'Q', options: ['a', 'b', 'c', 'd'], correct: 'c' });
  assert.deepEqual([odd.captions, odd.correct, odd.images], [['a', 'b', 'c', 'd'], 2, ['', '', '', '']]);
  // Other key names.
  assert.equal(read('scramble', { word: 'paris', hint: 'city' }).answer, 'PARIS');
  assert.equal(read('emoji', { emojis: '🦁👑', answer: 'x' }).emoji, '🦁👑');
  assert.equal(read('open', { question: 'Q', answer: 'x', fun_fact: 'F' }).fact, 'F');
  assert.deepEqual(read('open', { Question: 'Q', Answer: 'A', Alternatives: ['B'] }), { question: 'Q', answer: 'A', accept: ['B'] });
});

test('the exact zoom-out answer Jorn pasted (markdown copy with \\ line ends and &#x20;) is read', () => {
  const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'ai-markdown-copy.txt'), 'utf8');
  assert.match(text, /&#x20;/);
  const got = ai.parseRound(text, 'zoomOut');
  assert.deepEqual(got.map(q => q.answer), ['Hans Vanaken', 'Brandon Mechele', 'Yann Sommer']);
  assert.deepEqual(got[0].accept, ['Vanaken', 'Hans']);
  assert.equal(got[1].imageSearch, 'Brandon Mechele');
  assert.match(got[2].fact, /Mönchengladbach\.$/);
  for (const q of got) assert.ok(!/&#|\\/.test(JSON.stringify(q)), JSON.stringify(q));
  assert.equal(ai.parseQuiz(`{"rounds": [{"type": "zoomOut", ${text.trim().slice(1)}]}`).rounds[0].questions.length, 3);
});

test('the exact map round answer Jorn pasted (same markdown copy) is read', () => {
  const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'ai-markdown-copy-map.txt'), 'utf8');
  const got = ai.parseRound(text, 'mapDrop');
  assert.deepEqual(got.map(q => q.question), ['Waar ligt de Eiffeltoren?', "Waar leven wilde reuzenpanda's in het wild?", 'In welke stad staat het beroemde Colosseum?']);
  assert.equal(got[2].fact, 'Het Colosseum kon vroeger tienduizenden toeschouwers tegelijk ontvangen.');
  for (const q of got) assert.ok(!/&#|\\/.test(JSON.stringify(q)), JSON.stringify(q));
});

test('the exact word scramble answer Jorn pasted (same markdown copy) is read', () => {
  const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'ai-markdown-copy-scramble.txt'), 'utf8');
  const got = ai.parseRound(text, 'scramble');
  assert.equal(got.length, 3);
  assert.deepEqual(got.map(q => q.answer.toUpperCase()), ['VANAKEN', 'MIGNOLET', 'TZOLIS']);
  assert.deepEqual(got.map(q => q.question), ['De aanvoerder van Club Brugge', 'De doelman van Club Brugge', 'De Griekse aanvaller van Club Brugge'], 'the AI letters are taken out of the hint');
  for (const q of got) assert.ok(!/&#|\\/.test(JSON.stringify(q)), JSON.stringify(q));
});

test('loose questions without a list around them are read for every round type, never the lists inside them', () => {
  for (const id of ['pickYourLevel', 'opponentsPick', 'wordWeb', 'pairUp', 'orderUp', 'oddOneOut']) {
    const s = JSON.stringify(SAMPLES[id]);
    const got = ai.parseRound(`Here you go:\n${s}\n\n${s}\n`, id);
    assert.equal(got.length, 2, id);
    assert.deepEqual(problems(id, fillLikeBuilder(id, got[0])), [], id);
  }
});

test('a whole evening from the AI: round types by any name, every type ready to play once the media are in', () => {
  const names = { classic: 'Multiple choice', trueFalse: 'true_false', open: 'Open', closest: 'Closest wins', wordWeb: 'Word web', music: 'MUSIC', oddOneOut: 'OddOneOut', orderUp: 'In de juiste volgorde' };
  const text = JSON.stringify({ title: 'Night', rounds: rounds.TYPES.map(t => ({ type: names[t.id] || t.id, title: t.id, questions: [SAMPLES[t.id], SAMPLES[t.id]] })) });
  const quiz = ai.parseQuiz(text);
  assert.deepEqual(quiz.rounds.map(r => r.type), rounds.TYPES.map(t => t.id));
  for (const r of quiz.rounds) r.questions = r.questions.map(q => fillLikeBuilder(r.type, q));
  assert.ok(validateQuiz(quiz));
  assert.equal(rounds.typeFrom('Waar of niet'), 'trueFalse');
  assert.equal(rounds.typeFrom('Music round'), 'music');
  assert.equal(rounds.typeFrom('nonsense'), null);
});

// Two teams play the whole quiz; every question gets an answer that fits its kind.
function playThrough(quiz) {
  const game = new Game({ clock: { now: Date.now, setTimeout: () => 0, clearTimeout: () => {} } });
  game.load(quiz);
  const ids = ['teamaaaaaaaa', 'teambbbbbbbb'];
  ids.forEach((id, i) => game.join(id, `Team ${i}`, ['amber', 'pink'][i], `s${i}`));
  const answerFor = (q, i) => {
    switch (q.kind) {
      case 'choice': return i % Math.max(1, (q.answers || q.images || [1]).length);
      case 'trueFalse': return i % 2;
      case 'number': return 8000 + i;
      case 'order': return [...Array(q.items.length).keys()];
      case 'pairs': return [...Array(q.left.length).keys()];
      case 'groups': return { groups: Array.from({ length: q.groupCount }, (_, g) => [0, 1, 2, 3].map(k => g * 4 + k)), links: ['Fish'] };
      case 'list': return 'Belgium';
      case 'point': return { x: 0.4, y: 0.6 };
      case 'level': return 0;
      case 'buzz': return true;
      case 'draw': case 'photo': return MEDIA;
      default: return i ? 'Saturn' : 'Ottawa';
    }
  };
  const seen = new Set();
  for (let guard = 0; guard < 2000 && game.phase !== 'end'; guard++) {
    if (game.phase === 'wager') ids.forEach((id, i) => { game.setWager(id, 1); });
    if (game.phase === 'question') {
      seen.add(game.quiz.rounds[game.roundIndex].type);
      ids.forEach((id, i) => {
        const q = game.teamState(id).question;
        if (q && q.kind && q.kind !== 'turn') game.answer(id, answerFor(q, i));
      });
      if (game.buzz) game.judgeBuzz(true);
      if (game.whoseTurn && game.whoseTurn()) game.judgeTurn(true);
    }
    game.screenState();
    game.hostState();
    ids.forEach(id => game.teamState(id));
    game.next();
  }
  assert.equal(game.phase, 'end');
  return seen;
}

test('every round type from the AI: saved, exported and imported as JSON and CSV, and played through', async t => {
  const lib = Library.create(fs.mkdtempSync(path.join(os.tmpdir(), 'qb-ai-')));
  const quiz = { title: 'From the AI', rounds: rounds.TYPES.map(t => ({ type: t.id, title: '', scoring: t.defaults.scoring || null, questions: ai.parseRound(JSON.stringify({ questions: [SAMPLES[t.id], SAMPLES[t.id]] }), t.id).map(q => fillLikeBuilder(t.id, q)) })) };
  assert.ok(validateQuiz(quiz));
  const saved = lib.save(null, quiz);
  const back = lib.read(saved.path);
  assert.deepEqual(back.rounds, quiz.rounds);
  // A spreadsheet keeps every round type: items, pairs, groups, levels, pictures and the spot travel along.
  const sheet = csv.toQuiz(csv.fromQuiz(back), 'Sheet');
  assert.deepEqual(sheet.rounds.map(r => r.type), quiz.rounds.map(r => r.type));
  for (const [i, r] of sheet.rounds.entries()) {
    for (const [k, q] of r.questions.entries()) assert.deepEqual(problems(r.type, q), [], `CSV ${r.type} ${k}`);
    assert.equal(r.questions.length, 2, `CSV ${quiz.rounds[i].type}`);
  }
  assert.ok(validateQuiz(sheet));
  const played = playThrough(validateQuiz(back));
  assert.equal(played.size, rounds.TYPES.length - 0, `played: ${[...played].join(', ')}`);
});

test('importing a quiz file an AI wrote: other type names, AI shapes and sloppy JSON become a quiz the builder can open', async t => {
  const { createServer } = require('../src/app');
  const settingsData = {};
  const qb = createServer({ port: 0, license: require('./fixtures/pro').proLicense(), settings: { get: k => settingsData[k], set: (k, v) => { settingsData[k] = v; } }, library: Library.create(fs.mkdtempSync(path.join(os.tmpdir(), 'qb-imp-'))), lanAddresses: () => ['192.168.1.50'] });
  const port = await qb.listen();
  t.after(() => qb.close());
  const post = async body => {
    const res = await fetch(`http://127.0.0.1:${port}/api/host/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, data: await res.json() };
  };
  const read = async p => (await fetch(`http://127.0.0.1:${port}/api/host/library/quiz?path=${encodeURIComponent(p)}`)).json();

  // Our ids, but the AI's shapes: the right answer as text, odd one out without picture slots.
  const aiFile = { title: 'AI night', rounds: [
    { type: 'classic', questions: [{ question: 'Q', answers: ['Lyon', 'Paris'], correct: 'Paris' }] },
    { type: 'oddOneOut', questions: [{ question: 'Which?', captions: ['a', 'b', 'c', 'd'], correct: 1 }] },
    { type: 'Word web', questions: [SAMPLES.wordWeb] },
  ] };
  let res = await post({ name: 'night.json', text: JSON.stringify(aiFile) });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  let quiz = await read(res.data.path);
  assert.equal(quiz.rounds[0].questions[0].correct, 1);
  assert.deepEqual(quiz.rounds[1].questions[0].images, ['', '', '', '']);
  assert.equal(quiz.rounds[2].type, 'wordWeb');

  // Not quite valid JSON (a nickname in quotes, a trailing comma).
  res = await post({ name: 'wrestlers.json', text: '{"title": "Ring", "rounds": [{"type": "open", "questions": [{"question": "Who is "The Rock"?", "answer": "Dwayne Johnson",},]}]}' });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  quiz = await read(res.data.path);
  assert.equal(quiz.rounds[0].questions[0].question, 'Who is "The Rock"?');

  // Our own export stays exactly as it was, also an unfinished question without its picture.
  const own = { title: 'Mine', rounds: [{ type: 'picture', title: 'Pics', questions: [{ question: '', answer: 'Atomium', imageSearch: 'Atomium', time: 25, points: 1, imageCredit: 'x' }] }] };
  res = await post({ name: 'mine.quizbrew.json', text: JSON.stringify(own) });
  quiz = await read(res.data.path);
  assert.deepEqual(quiz.rounds[0].questions[0], own.rounds[0].questions[0]);

  // A round type nobody knows is refused with a clear message, instead of a builder that cannot open the quiz.
  res = await post({ name: 'odd.json', text: JSON.stringify({ title: 'X', rounds: [{ type: 'karaoke battle', questions: [{ question: 'Q' }] }] }) });
  assert.equal(res.status, 400);
  assert.match(res.data.detail, /karaoke battle/);
});

test('word scramble: the AI\'s own shuffled letters never reach the screen (Jorn\'s quiz night)', () => {
  const got = ai.parseRound(JSON.stringify([
    { answer: 'SCHOENLEPEL', question: 'Ontcijfer dit zonnestelsellichaam: SOMNCEPLUHA' },
    { answer: 'OLIFANT', question: 'Ontcijfer dit dier: LIOFTANE' },
    { answer: 'WAFFLE', category: 'Belgian treat' },
  ]), 'scramble');
  assert.equal(got[0].question, '', 'letters far off from the answer: the AI mixed up its questions, hint dropped');
  assert.equal(got[1].question, 'Ontcijfer dit dier');
  assert.equal(got[2].question, 'Belgian treat');
});
