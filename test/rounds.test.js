// Round types, scoring modes, twists, the library, spreadsheets and reading AI answers.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const rounds = require('../src/rounds');
const { Game, validateQuiz } = require('../src/game');
const Library = require('../src/library');
const csv = require('../src/csv');
const ai = require('../src/ai');
const i18n = require('../src/i18n');

function fakeClock() {
  let now = 0;
  let timers = [];
  return {
    now: () => now,
    setTimeout: (fn, ms) => { const t = { fn, at: now + ms }; timers.push(t); return t; },
    clearTimeout: t => { timers = timers.filter(x => x !== t); },
    advance(ms) {
      now += ms;
      const due = timers.filter(t => t.at <= now);
      timers = timers.filter(t => t.at > now);
      due.forEach(t => t.fn());
    },
  };
}

// A game with teams A and B at the first question of the given round.
function play(round, { teams = ['A', 'B'], jokers = false } = {}) {
  const clock = fakeClock();
  const game = new Game({ clock });
  game.load({ title: 'T', jokers, rounds: [round] });
  const ids = teams.map((name, i) => {
    const id = `team${i}aaaa`;
    game.join(id, name, ['amber', 'pink', 'cyan'][i], 's' + i);
    return id;
  });
  game.next(); // round intro
  return { game, clock, ids, go: () => game.next() };
}

test('every round type, scoring mode, twist and family has a name in every language', () => {
  for (const { code } of i18n.LANGUAGES) {
    const d = i18n.read(code);
    for (const type of rounds.TYPES) {
      assert.ok(d[`round.${type.id}`], `${code}: round.${type.id}`);
      assert.ok(d[`round.${type.id}.desc`], `${code}: round.${type.id}.desc`);
      if (!type.scorings.length) assert.ok(d[`scoring.own.${type.id}`], `${code}: scoring.own.${type.id}`);
    }
    for (const s of rounds.SCORINGS) assert.ok(d[`scoring.${s}`] && d[`scoring.${s}.desc`], `${code}: scoring.${s}`);
    for (const tw of rounds.TWISTS) assert.ok(d[`twist.${tw}`] && d[`twist.${tw}.desc`], `${code}: twist.${tw}`);
    for (const f of ['all', ...rounds.FAMILIES]) assert.ok(d[`family.${f}`], `${code}: family.${f}`);
    for (const k of ['choice', 'trueFalse', 'text', 'number', 'choiceOrText', 'order', 'pairs', 'point']) assert.ok(d[`kind.${k}`], `${code}: kind.${k}`);
  }
});

test('every round type has a theme for the big screen and the builder', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'common.js'), 'utf8');
  for (const type of rounds.TYPES) assert.match(src, new RegExp(`\\b${type.id}: \\{ glow`), type.id);
});

test('typed answers forgive case, accents, articles and a small typo', () => {
  const q = { answer: 'Leonardo da Vinci', accept: ['Da Vinci'] };
  assert.ok(rounds.textMatches('leonardo da vinci', q));
  assert.ok(rounds.textMatches('Leonardo daVinci', q), 'one letter off');
  assert.ok(rounds.textMatches('da vinci', q));
  assert.ok(!rounds.textMatches('Michelangelo', q));
  assert.ok(rounds.textMatches('Éléphant', { answer: 'elephant' }));
  assert.ok(rounds.textMatches('the Beatles', { answer: 'Beatles' }));
  assert.ok(!rounds.textMatches('cat', { answer: 'car' }), 'short words must be exact');
});

test('scrambled letters are stable and never the word itself', () => {
  const s = rounds.scramble('PILSNER');
  assert.equal(s, rounds.scramble('PILSNER'));
  assert.notEqual(s, 'PILSNER');
  assert.deepEqual([...s].sort(), [...'PILSNER'].sort());
});

test('true or bluff', () => {
  const { game, ids, go } = play({ type: 'trueFalse', questions: [{ question: 'Bats are blind', correct: false }] });
  go();
  assert.equal(game.kind, 'trueFalse');
  game.answer(ids[0], 1);
  game.answer(ids[1], 0);
  assert.equal(game.phase, 'reveal');
  assert.equal(game.screenState().correct, 1);
  assert.deepEqual(game.screenState().counts, [1, 1]);
  assert.equal(game.teams.get(ids[0]).score, 1);
});

test('open answer: auto check and the quizmaster can overrule', () => {
  const { game, ids, go } = play({ type: 'open', questions: [{ question: 'Capital of Belgium?', answer: 'Brussels', accept: ['Bruxelles', 'Brussel'] }] });
  go();
  assert.equal(game.screenState().question.kind, 'text');
  assert.equal(game.answer(ids[0], 42), false, 'a typed answer is text');
  game.answer(ids[0], ' brussel ');
  assert.deepEqual(game.hostState().liveAnswers, [{ name: 'A', color: 'amber', answer: 'brussel' }]);
  game.answer(ids[1], 'Antwerp');
  const s = game.screenState();
  assert.equal(s.reveal.answerText, 'Brussels');
  assert.deepEqual(s.answers.map(a => [a.name, a.correct]), [['A', true], ['B', false]]);
  assert.ok(game.hostState().canJudge);
  game.judge(ids[1], true);
  assert.equal(game.teams.get(ids[1]).score, 1);
  game.judge(ids[0], false);
  assert.equal(game.teams.get(ids[0]).score, 0);
  assert.equal(game.teamState(ids[0]).wasCorrect, false);
});

test('closest wins: closest team scores, spot on doubles', () => {
  const { game, ids, go } = play({ type: 'closest', questions: [{ question: 'Height of the Atomium in m?', answer: 102, unit: 'm' }] }, { teams: ['A', 'B', 'C'] });
  go();
  game.answer(ids[0], '95');
  game.answer(ids[1], 110);
  game.answer(ids[2], '101,5');
  assert.equal(game.phase, 'reveal');
  assert.deepEqual([...game.teams.values()].map(t => t.score), [0, 0, 2]);
  const r2 = play({ type: 'closest', questions: [{ question: 'Q', answer: 7, points: 3 }] });
  r2.go();
  r2.game.answer(r2.ids[0], 7);
  r2.game.answer(r2.ids[1], 8);
  assert.equal(r2.game.teams.get(r2.ids[0]).score, 6);
});

test('picture round needs a picture and plays as buttons or typed', () => {
  assert.throws(() => validateQuiz({ rounds: [{ type: 'picture', questions: [{ answer: 'x' }] }] }), /needs a picture/);
  const { game, ids, go } = play({ type: 'picture', questions: [{ image: '/media/x.webp', answer: 'Manneken Pis' }, { image: '/media/y.webp', answers: ['a', 'b'], correct: 1 }] });
  go();
  assert.equal(game.kind, 'text');
  assert.equal(game.screenState().question.image, '/media/x.webp');
  game.answer(ids[0], 'manneken pis');
  game.answer(ids[1], 'atomium');
  go();
  go();
  assert.equal(game.kind, 'choice');
});

test('in the right order: the phone sends shown positions, only the full right order scores', () => {
  const items = ['Bronze Age', 'Roman Empire', 'Middle Ages', 'Renaissance'];
  const { game, ids, go } = play({ type: 'orderUp', questions: [{ question: 'Oldest first', items }] });
  go();
  assert.equal(game.kind, 'order');
  const shown = game.teamState(ids[0]).question.items;
  assert.deepEqual([...shown].sort(), [...items].sort());
  assert.notDeepEqual(shown, items, 'items are shuffled');
  const right = items.map(it => shown.indexOf(it));
  assert.equal(game.answer(ids[0], [0, 0, 1, 2]), false, 'duplicates are refused');
  game.answer(ids[0], right);
  game.answer(ids[1], [...right].reverse());
  assert.equal(game.phase, 'reveal');
  assert.deepEqual([...game.teams.values()].map(t => t.score), [2, 0]);
  assert.deepEqual(game.screenState().reveal.order, items);
});

test('make pairs: every left item matched to the right one', () => {
  const pairs = [['France', 'Paris'], ['Belgium', 'Brussels'], ['Spain', 'Madrid']];
  const { game, ids, go } = play({ type: 'pairUp', questions: [{ question: 'Capitals', pairs }] });
  go();
  const q = game.teamState(ids[0]).question;
  assert.deepEqual(q.left, ['France', 'Belgium', 'Spain']);
  const right = pairs.map(p => q.right.indexOf(p[1]));
  game.answer(ids[0], right);
  game.answer(ids[1], [right[1], right[0], right[2]]);
  assert.deepEqual([...game.teams.values()].map(t => t.score), [2, 0]);
});

test('pin it: closest pin wins, spot on doubles, bad pins are refused', () => {
  assert.throws(() => validateQuiz({ rounds: [{ type: 'mapDrop', questions: [{ image: '/media/m.webp', question: 'Where?' }] }] }), /right spot/);
  const round = { type: 'mapDrop', questions: [{ image: '/media/m.webp', question: 'Where is Ghent?', answer: 'Ghent', spot: { x: 0.4, y: 0.3 } }] };
  const { game, ids, go } = play(round, { teams: ['A', 'B', 'C'] });
  go();
  assert.equal(game.answer(ids[2], { x: 2, y: 0 }), false);
  game.answer(ids[0], { x: 0.5, y: 0.5 });
  game.answer(ids[1], { x: 0.41, y: 0.31 });
  game.answer(ids[2], { x: 0.45, y: 0.3 });
  assert.equal(game.phase, 'reveal');
  assert.deepEqual([...game.teams.values()].map(t => t.score), [0, 4, 0]);
  assert.equal(game.screenState().answers.length, 3);
});

test('odd one out, emoji and sound rounds', () => {
  assert.throws(() => validateQuiz({ rounds: [{ type: 'oddOneOut', questions: [{ images: ['/a', '/b'], correct: 0 }] }] }), /3 or 4 pictures/);
  assert.throws(() => validateQuiz({ rounds: [{ type: 'emoji', questions: [{ answer: 'x' }] }] }), /emoji/);
  const { game, ids, go } = play({ type: 'oddOneOut', questions: [{ question: 'Which?', images: ['/a', '/b', '/c'], captions: ['Cat', 'Dog', 'Car'], correct: 2 }] });
  go();
  assert.equal(game.kind, 'choice');
  assert.deepEqual(game.teamState(ids[0]).question.answers, ['Cat', 'Dog', 'Car']);
  game.answer(ids[0], 2);
  game.answer(ids[1], 0);
  assert.deepEqual([...game.teams.values()].map(t => t.score), [1, 0]);

  const music = play({ type: 'introSprint', questions: [{ audio: '/media/s.mp3', start: 12, answer: 'Song' }] });
  music.go();
  const pq = music.game.screenState().question;
  assert.equal(pq.audio, '/media/s.mp3');
  assert.equal(pq.start, 12);
  assert.equal(pq.effect, 'grow');
  assert.throws(() => validateQuiz({ rounds: [{ type: 'music', questions: [{ answer: 'x' }] }] }), /sound/);
});

test('scoring modes: speed, race, risk, time and ladder', () => {
  const round = scoring => ({ type: 'classic', scoring, questions: [{ question: 'Q', answers: ['a', 'b'], correct: 0, time: 10, points: 2 }] });
  const run = (scoring, moves) => {
    const { game, clock, ids, go } = play(round(scoring));
    go();
    for (const [team, ms, answer] of moves) { clock.advance(ms); game.answer(ids[team], answer); }
    if (game.phase === 'question') game.next();
    return [...game.teams.values()].map(t => t.score);
  };
  assert.deepEqual(run('points', [[0, 1000, 0], [1, 1000, 0]]), [2, 2]);
  assert.deepEqual(run('speed', [[0, 0, 0], [1, 5000, 0]]), [4, 3]);
  assert.deepEqual(run('race', [[1, 1000, 0], [0, 1000, 0]]), [0, 2]);
  assert.deepEqual(run('risk', [[0, 1000, 0], [1, 1000, 1]]), [2, -2]);
  assert.deepEqual(run('time', [[0, 2500, 0], [1, 6000, 1]]), [8, 0]);
  // The scoring a round type does not allow falls back to its default.
  assert.equal(validateQuiz({ rounds: [{ type: 'closest', scoring: 'speed', questions: [{ question: 'Q', answer: 1 }] }] }).rounds[0].scoring, null);
});

test('common thread: clues and ladder points', () => {
  const r = { type: 'commonThread', questions: [{ clues: ['Hard', 'Medium', 'Easier', 'Easy'], answer: 'Beer', time: 40 }] };
  const { game, clock, ids, go } = play(r);
  go();
  assert.deepEqual(game.screenState().question.clues, ['Hard', 'Medium', 'Easier', 'Easy']);
  assert.equal(game.screenState().question.steps, 4);
  clock.advance(5000);
  game.answer(ids[0], 'beer'); // during clue 1: 4 points
  clock.advance(20000);
  game.answer(ids[1], 'beer'); // during clue 3: 2 points
  assert.deepEqual([...game.teams.values()].map(t => t.score), [4, 2]);
});

test('scramble shows letters, not the word', () => {
  const { game, go } = play({ type: 'scramble', questions: [{ answer: 'Waffle', question: 'Belgian treat' }] });
  go();
  const q = game.teamState(null).question;
  assert.equal(q.scrambled.length, 6);
  assert.equal(q.hint, 'Belgian treat');
  assert.ok(!JSON.stringify(game.screenState().question).toLowerCase().includes('waffle'));
});

test('jackpot: bet first, then answer; wrong loses the bet', () => {
  const r = { type: 'jackpot', questions: [{ category: 'Beer', question: 'Q', answer: 'Hops', points: 5 }] };
  const { game, ids, go } = play(r);
  game.adjustScore(ids[0], 10);
  go();
  assert.equal(game.phase, 'wager');
  assert.equal(game.teamState(ids[0]).category, 'Beer');
  assert.equal(game.teamState(ids[0]).question, null, 'the question stays hidden while betting');
  assert.equal(game.teamState(ids[0]).maxWager, 10);
  assert.equal(game.teamState(ids[1]).maxWager, 5, 'a team without points may still bet the question points');
  game.setWager(ids[0], 99);
  assert.equal(game.teams.get(ids[0]).wager, 10);
  game.setWager(ids[1], 4);
  assert.equal(game.answer(ids[0], 'hops'), false, 'no answers while betting');
  go();
  assert.equal(game.phase, 'question');
  game.answer(ids[0], 'hops');
  game.answer(ids[1], 'malt');
  assert.deepEqual([...game.teams.values()].map(t => t.score), [20, -4]);
});

test('twists: double, underdog, blackout, lockdown', () => {
  const q = { question: 'Q', answers: ['a', 'b'], correct: 0, points: 2 };
  const d = play({ type: 'classic', twists: ['double'], questions: [q] });
  d.go();
  d.game.answer(d.ids[0], 0);
  d.game.answer(d.ids[1], 1);
  assert.equal(d.game.teams.get(d.ids[0]).score, 4);

  const clock = fakeClock();
  const game = new Game({ clock });
  game.load({ title: 'T', rounds: [{ type: 'classic', questions: [q] }, { type: 'classic', twists: ['underdog', 'blackout', 'lockdown'], questions: [q, q] }] });
  game.join('team0aaaa', 'A', 'amber', 's0');
  game.join('team1aaaa', 'B', 'pink', 's1');
  game.next(); game.next();
  game.answer('team0aaaa', 0);
  game.answer('team1aaaa', 1);
  game.next(); game.next(); // scoreboard, round 2
  game.next(); // question
  const phone = game.teamState('team1aaaa');
  assert.equal(phone.question.text, '', 'blackout hides the question on the phone');
  assert.deepEqual(phone.question.answers, ['', '']);
  assert.equal(game.screenState().question.text, 'Q', 'but not on the big screen');
  game.answer('team0aaaa', 1);
  game.answer('team1aaaa', 0);
  assert.equal(game.teams.get('team1aaaa').score, 3, 'underdog gets 1.5x');
  game.next(); // next question
  game.leftPage('team0aaaa');
  assert.ok(game.teamState('team0aaaa').blocked);
  assert.equal(game.answer('team0aaaa', 0), false, 'lockdown blocks the answer');
  assert.ok(game.hostState().teams[0].away);
});

test('leaving the page without lockdown is only flagged', () => {
  const { game, ids, go } = play({ type: 'classic', questions: [{ question: 'Q', answers: ['a', 'b'], correct: 0 }] });
  go();
  game.leftPage(ids[0]);
  assert.ok(game.screenState().teams[0].away);
  assert.ok(game.answer(ids[0], 0));
});

test('a joker doubles one round, once per evening', () => {
  const q = { question: 'Q', answers: ['a', 'b'], correct: 0 };
  const clock = fakeClock();
  const game = new Game({ clock });
  game.load({ title: 'T', jokers: true, rounds: [{ type: 'classic', questions: [q] }, { type: 'classic', questions: [q] }] });
  game.join('team0aaaa', 'A', 'amber', 's0');
  game.next();
  assert.ok(game.playJoker('team0aaaa'));
  assert.equal(game.playJoker('team0aaaa'), false);
  game.next();
  game.answer('team0aaaa', 0);
  assert.equal(game.teams.get('team0aaaa').score, 2);
  game.next(); game.next(); // scoreboard, round 2
  assert.equal(game.playJoker('team0aaaa'), false, 'used up');
  assert.equal(game.teamState('team0aaaa').team.jokerLeft, false);
});

test('validation fills in the defaults of each type', () => {
  const clean = validateQuiz({ rounds: [{ type: 'speed', questions: [{ question: 'Q', answers: ['a', 'b'], correct: 1 }] }] });
  assert.equal(clean.rounds[0].scoring, 'speed');
  assert.equal(clean.rounds[0].questions[0].time, 10);
  assert.throws(() => validateQuiz({ rounds: [{ type: 'commonThread', questions: [{ clues: ['one'], answer: 'x' }] }] }), /2 to 6 clues/);
  assert.throws(() => validateQuiz({ rounds: [{ type: 'trueFalse', questions: [{ question: 'Q' }] }] }), /true or false/);
});

// ---------- library ----------

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qb-lib-'));

test('library: folders, save, move, delete and safe paths', () => {
  const lib = Library.create(tmp());
  lib.mkdir('Pub nights');
  const a = lib.save(null, { title: 'October: Halloween!', rounds: [] }, { folder: 'Pub nights' });
  assert.equal(a.path, 'Pub nights/October Halloween!.json');
  const b = lib.save(null, { title: 'October: Halloween!', rounds: [] }, { folder: 'Pub nights' });
  assert.equal(b.path, 'Pub nights/October Halloween! (2).json');
  const tree = lib.tree();
  assert.equal(tree.folders[0].name, 'Pub nights');
  assert.equal(tree.folders[0].quizzes.length, 2);
  lib.move(b.path, 'Copy.json');
  assert.equal(lib.read('Copy.json').title, 'October: Halloween!');
  assert.throws(() => lib.read('../settings.json'), /Invalid/);
  assert.throws(() => lib.save('../../evil.json', { rounds: [] }), /Invalid/);
  assert.throws(() => lib.move('Pub nights', 'Pub nights/inner'), /Invalid/);
  lib.remove('Pub nights');
  assert.equal(lib.tree().folders.length, 0);
});

test('library: pictures are stored once and travel inside an export', () => {
  const lib = Library.create(tmp());
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');
  const url = lib.addMedia(png, 'image/png');
  assert.match(url, /^\/media\/[a-f0-9]{20}\.png$/);
  assert.equal(lib.addMedia(png, 'image/png'), url);
  assert.throws(() => lib.addMedia(png, 'text/html'), /Unsupported/);
  const quiz = { title: 'P', rounds: [{ type: 'picture', questions: [{ image: url, answer: 'dot' }] }] };
  const exported = lib.inlineMedia(quiz);
  assert.match(exported.rounds[0].questions[0].image, /^data:image\/png;base64,/);
  // Import on another laptop: the picture becomes a file again.
  const other = Library.create(tmp());
  const saved = other.save(null, exported);
  assert.equal(saved.quiz.rounds[0].questions[0].image, url);
  assert.ok(other.mediaFile(url.slice(7)));
  assert.equal(other.mediaFile('../x.png'), null);
});

// ---------- spreadsheets ----------

test('CSV: Excel semicolons, quotes, letters for the right answer, round trip', () => {
  const text = '﻿round;type;question;A;B;C;D;correct;answer;accept;time\r\n'
    + 'Warm-up;classic;"Which ""planet"" is red?";Venus;Mars;;;B;;;20\r\n'
    + 'Warm-up;classic;Biggest ocean?;Atlantic;Pacific;Indian;;b;;;\r\n'
    + 'Typed;open;Capital of France?;;;;;;Paris;Parijs|Parigi;\r\n'
    + 'Bluff;trueFalse;Bats are blind;;;;;false;;;\r\n';
  const quiz = csv.toQuiz(text, 'Sheet');
  assert.equal(quiz.rounds.length, 3);
  assert.equal(quiz.rounds[0].questions[0].question, 'Which "planet" is red?');
  assert.deepEqual(quiz.rounds[0].questions[0].answers, ['Venus', 'Mars']);
  assert.equal(quiz.rounds[0].questions[1].correct, 1);
  assert.deepEqual(quiz.rounds[1].questions[0].accept, ['Parijs', 'Parigi']);
  assert.equal(quiz.rounds[2].questions[0].correct, false);
  assert.ok(validateQuiz(quiz));
  const back = csv.toQuiz(csv.fromQuiz(quiz), 'Sheet');
  assert.deepEqual(back.rounds.map(r => r.questions.length), [2, 1, 1]);
  assert.equal(back.rounds[0].questions[0].question, 'Which "planet" is red?');
  assert.throws(() => csv.toQuiz('just one line'), /no questions/);
});

// ---------- AI ----------

test('AI prompts describe the round type and never name other brands', () => {
  const p = ai.roundPrompt({ type: 'closest', count: 5, topic: 'Belgium', language: 'nl', difficulty: 4, audience: 'kids' });
  assert.match(p, /5 questions/);
  assert.match(p, /Dutch/);
  assert.match(p, /children/);
  assert.match(p, /"answer": 1234/);
  assert.match(p, /Never mention or copy existing TV quiz shows/);
  const whole = ai.quizPrompt({ rounds: 4, topic: 'pub' });
  for (const t of rounds.TYPES) assert.ok(whole.includes(`- ${t.id} - `), t.id);
  for (const t of rounds.TYPES) assert.ok(ai.TYPE_HELP[t.id], `help text for ${t.id}`);
});

test('AI answers are read even with code fences, smart quotes or a bare list', () => {
  const fenced = 'Sure!\n```json\n{"questions": [{"question": "2+2?", "answers": ["3","4","5","6"], "correct": 1},]}\n```';
  const qs = ai.parseRound(fenced, 'classic');
  assert.deepEqual(qs[0], { question: '2+2?', answers: ['3', '4', '5', '6'], correct: 1 });
  const smart = '{“questions”: [{“question”: “Bats are blind”, “correct”: false}]}';
  assert.equal(ai.parseRound(smart, 'trueFalse')[0].correct, false);
  assert.equal(ai.parseRound('[{"answer": "waffle", "hint": "food"}]', 'scramble')[0].answer, 'WAFFLE');
  assert.equal(ai.parseRound('{"questions":[{"question":"How tall?","answer":"1,234 m","unit":"m"}]}', 'closest')[0].answer, 1.234);
  assert.throws(() => ai.parseRound('no json here', 'classic'), /ai.noJson/);
  const quiz = ai.parseQuiz('{"title": "Night", "rounds": [{"type": "open", "title": "R", "questions": [{"question": "Q", "answer": "A"}]}, {"type": "nope", "questions": []}]}');
  assert.equal(quiz.rounds.length, 1);
  assert.ok(validateQuiz(quiz));
});

test('AI with a key: Claude, ChatGPT and Gemini over plain fetch', async t => {
  const settings = (() => { const v = {}; return { get: k => v[k], set: (k, x) => { v[k] = x; } }; })();
  const helper = ai.create(settings);
  await assert.rejects(helper.generateRound({ type: 'classic', topic: 'x' }), /ai.noKey/);
  const answer = JSON.stringify({ questions: [{ question: 'Q?', answer: 'A' }] });
  const calls = [];
  const realFetch = global.fetch;
  t.after(() => { global.fetch = realFetch; });
  global.fetch = async (url, opts = {}) => {
    calls.push({ url, opts });
    const json = /anthropic/.test(url) ? { content: [{ type: 'text', text: answer }] }
      : /openai/.test(url) ? { output: [{ type: 'message', content: [{ type: 'output_text', text: answer }] }] }
        : /models\?/.test(url) ? { models: [{ name: 'models/gemini-9.0-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-9.0-pro', supportedGenerationMethods: ['generateContent'] }] }
          : { candidates: [{ content: { parts: [{ text: answer }] } }] };
    return { ok: true, status: 200, json: async () => json };
  };
  helper.update({ provider: 'claude', key: 'sk-ant-secret1234' });
  assert.equal(helper.publicSettings().providers.claude.keyHint, '…1234');
  assert.ok(!JSON.stringify(helper.publicSettings()).includes('secret'));
  assert.equal((await helper.generateRound({ type: 'open', topic: 'x' }))[0].answer, 'A');
  assert.equal(calls[0].opts.headers['x-api-key'], 'sk-ant-secret1234');
  helper.update({ provider: 'openai', key: 'sk-open' });
  assert.equal((await helper.generateRound({ type: 'open', topic: 'x' }))[0].answer, 'A');
  helper.update({ provider: 'gemini', key: 'g-key' });
  assert.equal((await helper.generateRound({ type: 'open', topic: 'x' }))[0].answer, 'A');
  assert.match(calls[calls.length - 1].url, /gemini-9\.0-flash:generateContent/);
  assert.equal(settings.get('geminiAutoModel'), 'gemini-9.0-flash');
  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'API key not valid' } }) });
  await assert.rejects(helper.generateRound({ type: 'open', topic: 'x' }), /ai.badKey/);
});
