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
    for (const k of ['choice', 'trueFalse', 'text', 'number', 'choiceOrText', 'order', 'pairs', 'point', 'buzz', 'list', 'level', 'draw', 'photo', 'turn']) assert.ok(d[`kind.${k}`], `${code}: kind.${k}`);
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

const scores = game => [...game.teams.values()].map(t => t.score);
const ch = (q, correct = 0) => ({ question: q, answers: ['a', 'b', 'c', 'd'], correct });

test('buzzer: first buzz stops the clock, wrong lets the others buzz', () => {
  const { game, ids, go, clock } = play({ type: 'buzzer', scoring: 'risk', questions: [{ question: 'Capital of Peru?', answer: 'Lima', time: 30 }] }, { teams: ['A', 'B', 'C'] });
  go();
  clock.advance(5000);
  assert.equal(game.answer(ids[0], true), true);
  assert.equal(game.answer(ids[1], true), false, 'floor is taken');
  assert.equal(game.screenState().buzz.name, 'A');
  clock.advance(10000);
  assert.equal(game.remaining(), 25000, 'clock stands still');
  game.judgeBuzz(false);
  assert.equal(game.phase, 'question');
  assert.equal(game.answer(ids[0], true), false, 'a wrong team may not buzz again');
  game.answer(ids[1], true);
  game.judgeBuzz(true);
  assert.equal(game.phase, 'reveal');
  assert.deepEqual(scores(game), [-1, 1, 0]);
});

test('last team standing: a miss and you are out for the round', () => {
  const { game, ids, go } = play({ type: 'lastStanding', questions: [ch('Q1'), ch('Q2'), ch('Q3')] }, { teams: ['A', 'B'] });
  go();
  game.answer(ids[0], 0);
  game.answer(ids[1], 1);
  go(); // next question
  assert.equal(game.teamState(ids[1]).out, true);
  assert.equal(game.answer(ids[1], 0), false);
  game.answer(ids[0], 0);
  assert.equal(game.phase, 'reveal', 'the out team does not hold up the reveal');
  assert.deepEqual(scores(game), [2, 0]);
});

test('push your luck: pots double, banking keeps them, a miss empties', () => {
  const { game, ids, go } = play({ type: 'pushYourLuck', questions: [ch('Q1'), ch('Q2'), ch('Q3'), ch('Q4')] }, { teams: ['A', 'B'] });
  go();
  game.answer(ids[0], 0); game.answer(ids[1], 0); // pots 1, 1
  go();
  game.answer(ids[0], 0); game.answer(ids[1], 0); // pots 2, 2
  go();
  assert.equal(game.teamState(ids[0]).canBank, true);
  game.bankPot(ids[0]); // A keeps 2
  game.answer(ids[1], 3); // B misses: pot 0
  assert.deepEqual(scores(game), [2, 0]);
  go();
  assert.equal(game.teamState(ids[0]).out, true);
  game.answer(ids[1], 0); // last question: B's new pot (1) is banked by itself
  assert.deepEqual(scores(game), [2, 1]);
});

test('steal: right teams take points from the leader', () => {
  const { game, ids, go } = play({ type: 'steal', questions: [{ question: 'Q', answer: 'Lima', points: 2 }] }, { teams: ['A', 'B', 'C'] });
  game.adjustScore(ids[0], 5);
  go();
  game.answer(ids[0], 'Paris');
  game.answer(ids[1], 'lima');
  game.answer(ids[2], 'Lima');
  assert.deepEqual(scores(game), [1, 2, 2]);
  game.judge(ids[2], false);
  assert.deepEqual(scores(game), [3, 2, 0], 'the quizmaster can overrule and the steal follows');
});

test('pick your level: every team plays its own question for 1, 2 or 3 times the points', () => {
  const levels = [ch('easy', 0), ch('medium', 1), ch('hard', 2)];
  const { game, ids, go } = play({ type: 'pickYourLevel', questions: [{ category: 'Space', levels }] }, { teams: ['A', 'B'] });
  go();
  assert.equal(game.phase, 'wager');
  game.setWager(ids[0], 2);
  go();
  assert.equal(game.teamState(ids[0]).question.text, 'hard');
  assert.equal(game.teamState(ids[1]).question.text, 'easy', 'no choice = easy');
  assert.equal(game.screenState().question.text, '');
  game.answer(ids[0], 2);
  game.answer(ids[1], 0);
  assert.deepEqual(scores(game), [3, 1]);
});

test('hot streak: right answers in a row count up', () => {
  const { game, ids, go } = play({ type: 'hotStreak', questions: [ch('Q1'), ch('Q2'), { question: 'Q3', answer: 'Lima' }] }, { teams: ['A', 'B'] });
  go(); game.answer(ids[0], 0); game.answer(ids[1], 0);
  go(); game.answer(ids[0], 0); game.answer(ids[1], 1);
  go(); game.answer(ids[0], 'lima'); game.answer(ids[1], 'lima');
  assert.deepEqual(scores(game), [1 + 2 + 3, 1 + 0 + 1]);
});

test('list rush: every right item once, other spellings with a slash', () => {
  const { game, ids, go, clock } = play({ type: 'listRush', questions: [{ question: 'Benelux capitals', items: ['Brussels / Brussel', 'Amsterdam', 'Luxembourg'], time: 30 }] });
  go();
  game.answer(ids[0], 'Brussel');
  game.answer(ids[0], 'brussel');
  game.answer(ids[0], 'Amsterdam');
  game.answer(ids[0], 'Paris');
  game.answer(ids[1], 'Luxemburg');
  assert.deepEqual(game.teams.get(ids[0]).answer, ['Brussel', 'Amsterdam', 'Paris']);
  assert.equal(game.phase, 'question', 'a list runs until time is up');
  clock.advance(30000);
  assert.deepEqual(scores(game), [2, 1]);
  assert.deepEqual(game.screenState().reveal.found.sort(), [0, 1, 2]);
});

test('crowd mind: the most common answer scores', () => {
  const { game, ids, go } = play({ type: 'crowdMind', questions: [{ question: 'Name a fruit' }] }, { teams: ['A', 'B', 'C'] });
  go();
  game.answer(ids[0], 'Apple');
  game.answer(ids[1], 'apple ');
  game.answer(ids[2], 'Kiwi');
  assert.deepEqual(scores(game), [2, 2, 0]);
  assert.equal(game.screenState().reveal.answerText, 'Apple');
});

test('caption this: entries go on a ballot, every vote is worth the points, no voting for yourself', () => {
  const { game, ids, go } = play({ type: 'captionThis', questions: [{ image: '/media/x.webp', question: 'Caption?' }] }, { teams: ['A', 'B', 'C'] });
  go();
  game.answer(ids[0], 'Monday mood');
  game.answer(ids[1], 'When the wifi drops');
  game.answer(ids[2], 'Me at 7 am');
  assert.equal(game.phase, 'vote');
  const ballot = game.teamState(ids[0]).ballot;
  assert.equal(ballot.length, 3);
  assert.equal(ballot.filter(b => b.mine).length, 1);
  const idx = text => ballot.findIndex(b => b.content === text);
  assert.equal(game.castVote(ids[0], idx('Monday mood')), false, 'own entry');
  game.castVote(ids[0], idx('When the wifi drops'));
  game.castVote(ids[1], idx('Me at 7 am'));
  game.castVote(ids[2], idx('When the wifi drops'));
  assert.equal(game.phase, 'reveal');
  assert.deepEqual(scores(game), [0, 2, 1]);
  assert.equal(game.screenState().ballot.find(b => b.content === 'When the wifi drops').votes.length, 2);
});

test('bluff: find the truth, fool the others', () => {
  const { game, ids, go } = play({ type: 'bluffBank', questions: [{ question: 'What was the first webcam used for?', answer: 'Watching a coffee pot' }] }, { teams: ['A', 'B', 'C'] });
  go();
  assert.equal(game.answer(ids[0], 'watching a coffee pot'), false, 'the real answer is no bluff');
  game.answer(ids[0], 'Spying on a cat');
  game.answer(ids[1], 'Checking the weather');
  game.answer(ids[2], 'Counting birds');
  const ballot = game.teamState(ids[0]).ballot;
  assert.equal(ballot.length, 4);
  const idx = text => ballot.findIndex(b => b.content === text);
  game.castVote(ids[0], idx('Watching a coffee pot')); // A finds the truth: +1
  game.castVote(ids[1], idx('Spying on a cat')); // B fooled by A: A +1
  game.castVote(ids[2], idx('Spying on a cat')); // C fooled by A: A +1
  assert.deepEqual(scores(game), [3, 0, 0]);
  assert.equal(game.screenState().ballot.find(b => b.truth).content, 'Watching a coffee pot');
});

test("who's who: match answers to teams by colour", () => {
  const { game, ids, go } = play({ type: 'whosWho', questions: [{ question: 'Our hidden talent' }] }, { teams: ['A', 'B', 'C'] });
  go();
  game.answer(ids[0], 'Juggling');
  game.answer(ids[1], 'Yodeling');
  game.answer(ids[2], 'Origami');
  const st = game.teamState(ids[0]);
  assert.deepEqual(st.teamsToMatch.map(x => x.name), ['B', 'C']);
  const owner = { Juggling: 'amber', Yodeling: 'pink', Origami: 'cyan' };
  game.castVote(ids[0], st.ballot.map(b => owner[b.content]));
  game.castVote(ids[1], st.ballot.map(() => 'amber'));
  game.castVote(ids[2], st.ballot.map(() => 'nope'));
  assert.deepEqual(scores(game), [2, 1, 0]);
});

test('act it out: one team acts, the others guess, the actors score when someone gets it', () => {
  const { game, ids, go } = play({ type: 'actItOut', questions: [{ answer: 'Penguin' }, { answer: 'Firefighter' }] }, { teams: ['A', 'B', 'C'] });
  go();
  assert.equal(game.teamState(ids[0]).isActor, true);
  assert.equal(game.teamState(ids[0]).secret, 'Penguin');
  assert.equal(game.teamState(ids[1]).secret, null);
  assert.equal(game.answer(ids[0], 'Penguin'), false, 'the actors do not guess');
  game.answer(ids[1], 'penguin');
  game.answer(ids[2], 'duck');
  assert.equal(game.phase, 'reveal');
  assert.deepEqual(scores(game), [1, 1, 0]);
  go();
  assert.equal(game.teamState(ids[1]).isActor, true, 'the next team acts');
});

test('drawings and photos are media urls; one entry only skips the vote', () => {
  const { game, ids, go } = play({ type: 'drawGuess', questions: [{ question: 'Draw a cat' }] });
  go();
  assert.equal(game.answer(ids[0], 'data:image/png;base64,AAAA'), false, 'raw data never reaches the game');
  assert.equal(game.answer(ids[0], '/media/0123456789abcdef0123.webp'), true);
  go();
  assert.equal(game.phase, 'reveal');
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
  // Odd one out keeps a list of pictures; a video clip travels too.
  const mp4 = lib.addMedia(Buffer.from('fake video bytes'), 'video/mp4');
  const odd = { title: 'O', rounds: [{ type: 'oddOneOut', questions: [{ images: [url, url, url], correct: 1 }] }, { type: 'clipRecall', questions: [{ video: mp4, question: 'x', items: ['a', 'b', 'c'] }] }] };
  const out = lib.inlineMedia(odd);
  assert.ok(out.rounds[0].questions[0].images.every(x => x.startsWith('data:image/png')));
  assert.match(out.rounds[1].questions[0].video, /^data:video\/mp4;base64,/);
  const back = Library.create(tmp()).save(null, out).quiz;
  assert.deepEqual(back.rounds[0].questions[0].images, [url, url, url]);
  assert.equal(back.rounds[1].questions[0].video, mp4);
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

// ---------- wave 5: clocks, finales and the last twists ----------

const mc = (question, correct = 0) => ({ question, answers: ['a', 'b', 'c', 'd'], correct });

test('stake it: bet on the category, right wins the bet, wrong loses it', () => {
  const { game, ids, go } = play({ type: 'stakeIt', questions: [{ ...mc('Q'), category: 'Space', points: 4 }] });
  go();
  assert.equal(game.phase, 'wager');
  assert.equal(game.common().category, 'Space');
  game.setWager(ids[0], 3);
  game.setWager(ids[1], 2);
  go();
  game.answer(ids[0], 0);
  game.answer(ids[1], 1);
  assert.equal(game.teams.get(ids[0]).score, 3);
  assert.equal(game.teams.get(ids[1]).score, -2);
});

test('local legend: own questions, the picture is optional', () => {
  const clean = validateQuiz({ rounds: [{ type: 'localLegend', questions: [{ question: 'Who founded our club?', answer: 'Marie' }] }] });
  assert.equal(clean.rounds[0].questions[0].time, 25);
  assert.throws(() => validateQuiz({ rounds: [{ type: 'localLegend', questions: [{ question: '' }] }] }), /no text/);
});

test('clue ladder: the earlier you get it, the more points', () => {
  const { game, clock, ids, go } = play({ type: 'clueLadder', questions: [{ clues: ['c1', 'c2', 'c3', 'c4', 'c5'], answer: 'Paris', time: 50, points: 5 }] });
  go();
  game.answer(ids[0], 'paris');
  clock.advance(41000);
  game.answer(ids[1], 'Paris');
  assert.equal(game.teams.get(ids[0]).score, 5);
  assert.equal(game.teams.get(ids[1]).score, 1);
});

test('five facts: a point per keyword, all five doubles', () => {
  const { game, clock, ids, go } = play({ type: 'fiveFacts', questions: [{ question: 'Name the five', items: ['one', 'two', 'three', 'four', 'five'] }] });
  go();
  for (const w of ['one', 'two', 'three', 'four', 'five']) game.answer(ids[0], w);
  game.answer(ids[1], 'two');
  game.answer(ids[1], 'nine');
  clock.advance(45000);
  assert.equal(game.teams.get(ids[0]).score, 10);
  assert.equal(game.teams.get(ids[1]).score, 1);
});

test('clip recall: a video question with a list of details', () => {
  const { game, clock, ids, go } = play({ type: 'clipRecall', questions: [{ video: '/media/aaaaaaaaaaaaaaaaaaaa.mp4', question: 'What did you see?', items: ['red car', 'dog', 'umbrella / brolly'] }] });
  go();
  assert.equal(game.screenState().question.video, '/media/aaaaaaaaaaaaaaaaaaaa.mp4');
  game.answer(ids[0], 'brolly');
  game.answer(ids[0], 'dog');
  clock.advance(60000);
  assert.equal(game.teams.get(ids[0]).score, 2);
  assert.throws(() => validateQuiz({ rounds: [{ type: 'clipRecall', questions: [{ question: 'x', items: ['a', 'b', 'c'] }] }] }), /needs a video/);
});

test('your pick: the leader picks the category, the others play it', () => {
  const options = [{ category: 'Art', ...mc('Art Q', 1) }, { category: 'Sport', ...mc('Sport Q', 2) }];
  const { game, ids, go } = play({ type: 'opponentsPick', questions: [{ options }, { options }] }, { teams: ['A', 'B', 'C'] });
  game.teams.get(ids[2]).score = 5;
  go();
  assert.equal(game.phase, 'wager');
  assert.deepEqual(game.common().pick.categories, ['Art', 'Sport']);
  assert.equal(game.common().pick.by.name, 'C');
  assert.equal(game.setWager(ids[0], 1), false, 'only the leader picks');
  assert.ok(game.setWager(ids[2], 1));
  go();
  assert.equal(game.question.question, 'Sport Q');
  assert.equal(game.teamState(ids[2]).out, true);
  assert.equal(game.answer(ids[2], 2), false);
  game.answer(ids[0], 2);
  game.answer(ids[1], 0);
  assert.equal(game.phase, 'reveal');
  assert.equal(game.teams.get(ids[0]).score, 2);
  assert.equal(game.teams.get(ids[2]).score, 5);
});

test('head to head: the top two play, the others predict the winner', () => {
  const { game, clock, ids, go } = play({ type: 'headToHead', questions: [mc('Q', 3)] }, { teams: ['A', 'B', 'C'] });
  // Restart the round with standings: B first, C second.
  game.teams.get(ids[1]).score = 9;
  game.teams.get(ids[2]).score = 7;
  game.startRound(0);
  assert.deepEqual(game.finalists, [ids[1], ids[2]]);
  go();
  assert.equal(game.common().wagerMode, 'predict');
  assert.equal(game.setWager(ids[1], 0), false, 'finalists do not predict');
  assert.ok(game.setWager(ids[0], 1));
  go();
  assert.equal(game.answer(ids[0], 3), false, 'only finalists answer');
  clock.advance(2000);
  game.answer(ids[2], 3);
  clock.advance(1000);
  game.answer(ids[1], 3);
  assert.equal(game.phase, 'reveal');
  assert.equal(game.teams.get(ids[2]).lastPoints, 2);
  assert.equal(game.teams.get(ids[1]).lastPoints, 0);
  assert.equal(game.teams.get(ids[0]).lastPoints, 2, 'predicted the winner');
});

test('time bank: one team at a time on its own clock; right adds seconds, zero is out', () => {
  const qs = Array.from({ length: 6 }, (_, i) => ({ question: 'Q' + i, answer: 'A', time: 10, points: 1 }));
  const { game, clock, ids, go } = play({ type: 'clockBank', questions: qs });
  go();
  assert.equal(game.turnTeam, ids[0]);
  assert.equal(game.answer(ids[1], 'x'), false);
  clock.advance(5000);
  game.judgeBuzz(true);
  assert.equal(game.phase, 'reveal');
  assert.equal(game.clocks.get(ids[0]), 65000);
  assert.equal(game.teams.get(ids[0]).score, 1);
  go();
  assert.equal(game.turnTeam, ids[1]);
  clock.advance(60000); // B runs out
  assert.equal(game.phase, 'reveal');
  assert.equal(game.clocks.get(ids[1]), 0);
  go();
  assert.equal(game.turnTeam, ids[0], 'B is out, A again');
  clock.advance(3000);
  game.judgeBuzz(false);
  assert.equal(game.clocks.get(ids[0]), 62000);
  assert.equal(game.teams.get(ids[0]).lastPoints, 0);
});

test('clock duel: right passes the turn, the first clock at zero loses', () => {
  const qs = Array.from({ length: 20 }, (_, i) => ({ question: 'Q' + i, answer: 'A', points: 5 }));
  const { game, clock, ids, go } = play({ type: 'clockDuel', questions: qs }, { teams: ['A', 'B', 'C'] });
  game.teams.get(ids[0]).score = 10;
  game.teams.get(ids[1]).score = 8;
  game.startRound(0);
  go();
  assert.equal(game.turnTeam, ids[1], 'second place starts');
  assert.equal(game.common().clocks.length, 2);
  clock.advance(4000);
  game.judgeBuzz(true);
  go();
  assert.equal(game.turnTeam, ids[0]);
  clock.advance(10000);
  game.judgeBuzz(false);
  go();
  assert.equal(game.turnTeam, ids[0], 'wrong keeps the turn');
  clock.advance(40000);
  assert.equal(game.phase, 'reveal');
  assert.equal(game.duelWinner, ids[1]);
  assert.equal(game.teams.get(ids[1]).score, 13);
  go();
  assert.equal(game.phase, 'scoreboard', 'the duel ends the round');
});

test('twist: sudden death ends the round for a team after its first mistake', () => {
  const { game, ids, go } = play({ type: 'classic', twists: ['suddenDeath'], questions: [mc('Q1', 0), mc('Q2', 0), mc('Q3', 0)] });
  go();
  game.answer(ids[0], 0);
  game.answer(ids[1], 1);
  go();
  assert.equal(game.teamState(ids[1]).out, true);
  assert.equal(game.answer(ids[1], 0), false);
  game.answer(ids[0], 0);
  assert.equal(game.phase, 'reveal', 'the team that is out does not hold up the question');
});

test('twist: shrinking options remove wrong answers and lower the points', () => {
  const { game, clock, ids, go } = play({ type: 'classic', twists: ['shrinkingOptions'], questions: [{ ...mc('Q', 2), points: 4, time: 30 }] });
  go();
  assert.deepEqual(game.screenState().question.gone, []);
  clock.advance(5000);
  const gone = game.screenState().question.gone;
  assert.equal(gone.length, 1);
  assert.ok(!gone.includes(2));
  assert.equal(game.answer(ids[1], gone[0]), false, 'a gone answer can not be picked');
  clock.advance(5000);
  assert.equal(game.screenState().question.gone.length, 2);
  clock.advance(10000);
  assert.equal(game.screenState().question.gone.length, 2, 'one wrong answer stays');
  game.answer(ids[0], 2);
  game.answer(ids[1], 2);
  assert.equal(game.teams.get(ids[0]).lastPoints, 2);
});

test('twist: lifeline hides two wrong answers once per round', () => {
  const { game, ids, go } = play({ type: 'classic', twists: ['lifeline'], questions: [mc('Q1', 1), mc('Q2', 1)] });
  go();
  assert.ok(game.teamState(ids[0]).canLifeline);
  assert.ok(game.useLifeline(ids[0]));
  const hidden = game.teamState(ids[0]).question.gone;
  assert.equal(hidden.length, 2);
  assert.ok(!hidden.includes(1));
  assert.deepEqual(game.teamState(ids[1]).question.gone, [], 'only on its own phone');
  assert.equal(game.answer(ids[0], hidden[0]), false);
  game.answer(ids[0], 1);
  game.answer(ids[1], 1);
  go();
  assert.equal(game.teamState(ids[0]).canLifeline, false);
  assert.equal(game.useLifeline(ids[0]), false);
});

test('twist: the lifeline is announced to the room, and only offered where it can work', () => {
  const { game, ids, go } = play({ type: 'classic', twists: ['lifeline'], questions: [mc('Q1', 1)] });
  const sent = [];
  game.emit = (to, event, payload) => sent.push([to, event, payload]);
  go();
  game.useLifeline(ids[0]);
  const alerts = sent.filter(([, e]) => e === 'alert').map(([to, , p]) => [to, p.kind, p.name]);
  assert.deepEqual(alerts, [['host', 'lifeline', 'A'], ['screen', 'lifeline', 'A']]);

  const types = Object.fromEntries(rounds.catalog().types.map(t => [t.id, t.twists]));
  assert.ok(types.classic.includes('lifeline'));
  assert.ok(types.picture.includes('lifeline'), 'picture rounds can be multiple choice');
  assert.ok(!types.open.includes('lifeline'));
  assert.ok(!types.trueFalse.includes('shrinkingOptions'));
  assert.ok(types.open.includes('double'));
});

test('twist: mystery category keeps the round title hidden until the last answer', () => {
  const { game, ids, go } = play({ type: 'classic', title: 'Cheese', twists: ['mysteryCategory'], questions: [mc('Q1'), mc('Q2')] });
  assert.equal(game.screenState().round.title, '? ? ?');
  assert.equal(game.hostState().realTitle, 'Cheese');
  go();
  game.answer(ids[0], 0);
  game.answer(ids[1], 0);
  assert.equal(game.screenState().round.title, '? ? ?');
  go();
  game.answer(ids[0], 0);
  game.answer(ids[1], 0);
  assert.equal(game.screenState().round.title, 'Cheese');
});

test('a "did you know" line: from the AI, in a spreadsheet, and with the answer', () => {
  const ai = require('../src/ai');
  const csv = require('../src/csv');
  const { Game } = require('../src/game');
  const qs = ai.parseRound('{"questions": [{"question": "Q?", "answers": ["a", "b", "c", "d"], "correct": 1, "fact": "Short and true."}]}', 'classic');
  assert.equal(qs[0].fact, 'Short and true.');
  assert.match(ai.roundPrompt({ type: 'classic' }), /"fact"/);
  const quiz = { title: 'F', rounds: [{ type: 'classic', title: 'R', questions: [{ question: 'Q?', answers: ['a', 'b'], correct: 0, fact: 'Fun, really.' }] }] };
  assert.equal(csv.toQuiz(csv.fromQuiz(quiz), 'F').rounds[0].questions[0].fact, 'Fun, really.');
  const game = new Game();
  game.load(quiz);
  game.join('team1aaaa', 'A', 'amber', 's1');
  game.next(); game.next();
  assert.equal(game.screenState().reveal, null);
  game.answer('team1aaaa', 0);
  assert.equal(game.screenState().reveal.fact, 'Fun, really.');
});

test('word web: teams find groups of four and name the link, a point for each', () => {
  const q = { question: 'Find the groups', groups: [
    { link: 'Rivers', words: ['Seine', 'Rhine', 'Danube', 'Thames'] },
    { link: 'Planets', words: ['Mars', 'Venus', 'Saturn', 'Jupiter'] },
    { link: 'Chocolate bars', accept: ['candy bars'], words: ['Twix', 'Bounty', 'Snickers', 'Galaxy'] } ] };
  const quiz = { title: 'T', rounds: [{ type: 'wordWeb', questions: [q] }] };
  validateQuiz(quiz);
  assert.throws(() => validateQuiz({ title: 'T', rounds: [{ type: 'wordWeb', questions: [{ groups: q.groups.slice(0, 2) }] }] }), /3 or 4 groups/);
  assert.throws(() => validateQuiz({ title: 'T', rounds: [{ type: 'wordWeb', questions: [{ groups: [...q.groups.slice(0, 2), { link: 'X', words: ['Mars', 'a', 'b', 'c'] }] }] }] }), /only once/);

  const g = new Game({});
  g.load(quiz);
  g.join('aaaaaaaa1', 'A', 'amber', 's1');
  g.join('aaaaaaaa2', 'B', 'pink', 's2');
  g.join('aaaaaaaa3', 'C', 'teal', 's3');
  g.next(); g.next();
  const pub = g.teamState('aaaaaaaa1').question;
  assert.equal(pub.kind, 'groups');
  assert.equal(pub.groupCount, 3);
  assert.deepEqual([...pub.words].sort(), q.groups.flatMap(x => x.words).sort());
  assert.equal(JSON.stringify(pub).includes('Rivers'), false, 'the links stay secret');
  const idx = w => pub.words.indexOf(w);
  const ids = ws => ws.map(idx);
  assert.equal(g.answer('aaaaaaaa3', { groups: [ids(['Seine', 'Rhine', 'Danube', 'Thames'])], links: [] }), false, 'all groups are needed');
  assert.ok(g.answer('aaaaaaaa1', { groups: [ids(['Seine', 'Rhine', 'Danube', 'Thames']), ids(['Mars', 'Venus', 'Saturn', 'Jupiter']), ids(['Twix', 'Bounty', 'Snickers', 'Galaxy'])], links: ['rivers', 'planet', 'candy bar'] }));
  // Two words swapped: one group right, and a link still counts when 3 of 4 words are right.
  assert.ok(g.answer('aaaaaaaa2', { groups: [ids(['Seine', 'Rhine', 'Danube', 'Galaxy']), ids(['Mars', 'Venus', 'Saturn', 'Jupiter']), ids(['Twix', 'Bounty', 'Snickers', 'Thames'])], links: ['Rivers', 'stars', ''] }));
  if (g.phase === 'question') g.next();
  const st = g.screenState();
  const by = Object.fromEntries(st.answers.map(a => [a.name, a]));
  assert.equal(by.A.points, 6);
  assert.equal(by.A.correct, true);
  assert.deepEqual(by.A.found, { g: 3, l: 3 });
  assert.equal(by.B.points, 2);
  assert.equal(by.B.correct, false);
  assert.deepEqual(by.B.found, { g: 1, l: 1 });
  assert.equal(st.reveal.answerText, 'Rivers · Planets · Chocolate bars');
  assert.equal(st.reveal.groups.length, 3);
});

test('word web: the AI shape gives groups', () => {
  const t = rounds.get('wordWeb');
  const q = t.fromAI({ question: 'Q', groups: [{ link: 'L', words: ['a', 'b', 'c', 'd', 'e'] }] });
  assert.deepEqual(q.groups, [{ link: 'L', words: ['a', 'b', 'c', 'd'] }]);
});

test('twists stay in sight: the underdog is named, and with one mistake and out the screen shows who is still in', () => {
  const mc = c => ({ question: 'Q' + c, answers: ['a', 'b', 'c', 'd'], correct: c });
  const quiz = { title: 'T', rounds: [
    { type: 'classic', questions: [mc(0)] },
    { type: 'classic', twists: ['underdog', 'suddenDeath'], questions: [mc(0), mc(1)] },
  ] };
  const g = new Game({});
  g.load(quiz);
  g.join('aaaaaaaa1', 'A', 'amber', 's1');
  g.join('aaaaaaaa2', 'B', 'pink', 's2');
  g.next(); g.next();
  g.answer('aaaaaaaa1', 0); g.answer('aaaaaaaa2', 1);
  while (g.phase !== 'roundIntro') g.next();
  assert.deepEqual(g.screenState().round.underdogs.map(x => x.name), ['B']);
  assert.equal(g.teamState('aaaaaaaa2').underdog, true);
  assert.equal(g.teamState('aaaaaaaa1').underdog, false);
  g.next();
  assert.equal(g.screenState().board, true);
  g.answer('aaaaaaaa1', 0); g.answer('aaaaaaaa2', 3);
  if (g.phase === 'question') g.next();
  g.next();
  assert.deepEqual(g.screenState().teams.map(x => x.out), [false, true]);
});

test('pasted AI answers are read forgivingly: quotes in texts, chatter, other keys, cut-off answers', () => {
  const q = { question: 'Wie is dit?', answer: 'Dwayne Johnson', imagePrompt: 'Dwayne The Rock Johnson in a wrestling ring, no text', imageSearch: 'Dwayne Johnson' };
  const s = JSON.stringify(q);
  const cases = {
    quotesInside: '{"questions": [{"question": "Wie is "The Rock"?", "answer": "Dwayne "The Rock" Johnson", "imagePrompt": "x"}]}',
    arrayAfterText: `Hier zijn ze:\n[${s}, ${s}]`,
    dutchKey: `{"vragen": [${s}, ${s}]}`,
    lineBreak: '{"questions": [{"question": "Wie is\ndit?", "answer": "X"}, {"question": "Q", "answer": "Y"}]}',
    cutOff: `{"questions": [${s}, ${s}, {"question": "Wie`,
    comments: `{"questions": [ // de eerste\n${s}, ${s}]}`,
    looseObjects: `${s}\n\n${s}`,
  };
  for (const [name, text] of Object.entries(cases)) {
    const got = ai.parseRound(text, 'pixelFog');
    assert.ok(got.length >= 1, name);
    assert.ok(got.every(x => x.answer), name);
  }
  assert.equal(ai.parseRound(cases.quotesInside, 'pixelFog')[0].answer, 'Dwayne "The Rock" Johnson');
  assert.equal(ai.parseRound(cases.cutOff, 'pixelFog').length, 2);
  assert.throws(() => ai.parseRound('Sorry, ik kan geen vragen maken.', 'pixelFog'), /ai\.noJson/);
});

test('the AI answer shape of every round type can be read back, also wrapped in chatter or cut off', () => {
  for (const t of rounds.TYPES) {
    const one = JSON.parse(t.aiShape.replace(/\)\s*$/, '').replace(/\s{2}\([^"]*$/, '').replace(/, \.\.\./g, '').replace(/"\.\.\."/g, '"x"').trim());
    const s = JSON.stringify(one);
    for (const text of [`{"questions": [${s}, ${s}]}`, 'Hier zijn ze:\n```json\n' + JSON.stringify({ questions: [one, one] }, null, 2) + '\n```\nVeel plezier!', `{"questions": [${s}, ${s}, ${s.slice(0, 15)}`]) {
      assert.equal(ai.parseRound(text, t.id).length, 2, t.id);
    }
  }
});

test('odd one out from the AI comes with an empty picture slot per caption', () => {
  const q = rounds.get('oddOneOut').fromAI({ question: 'Welke rivier?', captions: ['Schelde', 'Maas', 'Rijn', 'IJzer'], correct: 2, imagePrompts: ['a', 'b', 'c', 'd'] });
  assert.deepEqual(q.images, ['', '', '', '']);
  assert.equal(q.correct, 2);
  assert.equal(rounds.get('oddOneOut').fromAI({ captions: ['a', 'b', 'c'], correct: 9 }).correct, 2);
});
