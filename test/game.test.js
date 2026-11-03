const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, validateQuiz } = require('../src/game');

const quiz = () => ({
  title: 'Test',
  rounds: [
    { type: 'classic', title: 'R1', questions: [
      { question: 'Q1', answers: ['a', 'b', 'c', 'd'], correct: 1, time: 10 },
      { question: 'Q2', answers: ['a', 'b'], correct: 0, time: 10 },
    ] },
    { type: 'classic', title: 'R2', questions: [{ question: 'Q3', answers: ['a', 'b', 'c'], correct: 2, time: 10 }] },
  ],
});

// A fake clock so timers run on demand.
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

function setup() {
  const clock = fakeClock();
  const sent = [];
  const game = new Game({ clock, emit: (to, ev, p) => sent.push({ to, ev, p }) });
  game.load(quiz());
  return { game, clock, sent };
}

test('teams join with a unique name and colour', () => {
  const { game } = setup();
  assert.deepEqual(game.join('team1aaaa', '  The  Owls ', 'amber', 's1'), { ok: true, name: 'The Owls', color: 'amber' });
  assert.equal(game.join('team2aaaa', 'the owls', 'pink', 's2').error, 'error.nameTaken');
  assert.equal(game.join('team2aaaa', 'Foxes', 'amber', 's2').error, 'error.colorTaken');
  assert.equal(game.join('team2aaaa', 'Foxes', 'purple-ish', 's2').error, 'error.colorInvalid');
  assert.equal(game.join('team2aaaa', '   ', 'pink', 's2').error, 'error.nameEmpty');
  assert.ok(game.join('team2aaaa', 'Foxes', 'pink', 's2').ok);
  assert.equal(game.teamState(null).takenColors.length, 2);
});

test('joining needs a loaded quiz and is closed after the start', () => {
  const g = new Game();
  assert.equal(g.join('team1aaaa', 'A', 'amber', 's1').error, 'error.noQuiz');
  const { game } = setup();
  game.join('team1aaaa', 'A', 'amber', 's1');
  game.next();
  assert.equal(game.join('team2aaaa', 'B', 'pink', 's2').error, 'error.alreadyStarted');
  // A known team can come back after a reload.
  assert.ok(game.join('team1aaaa', '', '', 's9').ok);
  assert.ok(game.teams.get('team1aaaa').phones.has('s9'));
});

test('several phones play in one team: the first answer counts', () => {
  const { game, sent } = setup();
  game.join('team1aaaa', 'A', 'amber', 's1');
  assert.deepEqual(game.teamState(null).teams, [{ id: 'team1aaaa', name: 'A', color: 'amber' }]);
  assert.ok(game.join('team1aaaa', '', '', 's2').ok);
  assert.equal(game.teams.size, 1);
  assert.equal(game.hostState().teams[0].phones, 2);
  // One phone drops out: the team is still connected.
  game.disconnect('s1');
  assert.ok(game.teams.get('team1aaaa').connected);
  game.next();
  game.next();
  assert.equal(game.phase, 'question');
  game.join('team2aaaa', '', '', 's3');
  assert.ok(!game.teams.has('team2aaaa'));
  game.join('team1aaaa', '', '', 's1');
  const kind = game.teamState('team1aaaa').question.kind;
  assert.equal(kind, 'choice');
  game.answer('team1aaaa', 1);
  assert.equal(game.answer('team1aaaa', 2), false);
  assert.ok(sent.some(m => m.to === 'team:team1aaaa' && m.ev === 'state'));
  game.disconnect('s1');
  game.disconnect('s2');
  assert.equal(game.teams.get('team1aaaa').connected, false);
});

test('a full quiz: rounds, questions, reveal, scoreboard and end', () => {
  const { game } = setup();
  game.join('team1aaaa', 'A', 'amber', 's1');
  game.join('team2aaaa', 'B', 'pink', 's2');
  game.next();
  assert.equal(game.phase, 'roundIntro');
  game.next();
  assert.equal(game.phase, 'question');
  assert.equal(game.screenState().question.text, 'Q1');
  assert.equal(game.screenState().correct, null, 'the screen never sees the answer early');
  assert.equal(game.hostState().answerKey.correct, 1, 'the quizmaster does');

  assert.equal(game.answer('team1aaaa', 1), true);
  assert.equal(game.answer('team1aaaa', 2), false, 'one answer per question');
  assert.equal(game.phase, 'question');
  game.answer('team2aaaa', 0);
  assert.equal(game.phase, 'reveal', 'reveals as soon as every team answered');
  assert.deepEqual(game.screenState().counts, [1, 1, 0, 0]);
  assert.equal(game.teams.get('team1aaaa').score, 1);
  assert.equal(game.teams.get('team2aaaa').score, 0);

  game.next(); // Q2
  game.next(); // reveal early by the quizmaster
  assert.equal(game.phase, 'reveal');
  game.next();
  assert.equal(game.phase, 'scoreboard');
  assert.equal(game.hostState().lastRound, false);
  game.next();
  assert.equal(game.phase, 'roundIntro');
  assert.equal(game.round.title, 'R2');
  game.next();
  game.answer('team2aaaa', 2);
  game.next();
  game.next();
  assert.equal(game.phase, 'scoreboard');
  assert.equal(game.hostState().lastRound, true);
  game.next();
  assert.equal(game.phase, 'end');
});

test('time up reveals the question', () => {
  const { game, clock } = setup();
  game.join('team1aaaa', 'A', 'amber', 's1');
  game.next();
  game.next();
  clock.advance(4000);
  assert.ok(game.remaining() > 5000 && game.remaining() <= 6000);
  clock.advance(6000);
  assert.equal(game.phase, 'reveal');
  assert.equal(game.answer('team1aaaa', 1), false, 'too late');
});

test('a disconnected team does not hold up the reveal', () => {
  const { game } = setup();
  game.join('team1aaaa', 'A', 'amber', 's1');
  game.join('team2aaaa', 'B', 'pink', 's2');
  game.next();
  game.next();
  game.disconnect('s2');
  game.answer('team1aaaa', 1);
  assert.equal(game.phase, 'reveal');
});

test('ranking shares ranks on a tie and remembers the previous rank', () => {
  const { game } = setup();
  game.join('team1aaaa', 'A', 'amber', 's1');
  game.join('team2aaaa', 'B', 'pink', 's2');
  game.join('team3aaaa', 'C', 'cyan', 's3');
  game.adjustScore('team1aaaa', 2);
  game.adjustScore('team2aaaa', 2);
  assert.deepEqual(game.ranking().map(r => [r.name, r.rank]), [['A', 1], ['B', 1], ['C', 3]]);
  game.showScoreboard();
  game.adjustScore('team3aaaa', 5);
  const c = game.ranking().find(r => r.name === 'C');
  assert.equal(c.rank, 1);
  assert.equal(c.previousRank, 3);
});

test('kick and stop', () => {
  const { game, sent } = setup();
  game.join('team1aaaa', 'A', 'amber', 's1');
  game.kick('team1aaaa');
  assert.equal(game.teams.size, 0);
  assert.ok(sent.some(m => m.to === 'team:team1aaaa' && m.ev === 'kicked'));
  game.stop();
  assert.equal(game.phase, 'idle');
});

test('the lobby needs at least one team to start', () => {
  const { game } = setup();
  game.next();
  assert.equal(game.phase, 'lobby');
});

test('quiz validation explains what is wrong', () => {
  assert.ok(validateQuiz(quiz()));
  assert.throws(() => validateQuiz({ rounds: [] }), /no rounds/);
  const q = quiz();
  q.rounds[0].questions[0].correct = 7;
  assert.throws(() => validateQuiz(q), /round 1, question 1 has no valid correct answer/);
  const r = quiz();
  r.rounds[1].type = 'mystery';
  assert.throws(() => validateQuiz(r), /unsupported type/);
});

test('bundled quizzes are valid', () => {
  const quizzes = require('../src/quizzes');
  const list = quizzes.list();
  assert.ok(list.length > 0);
  for (const q of list) assert.ok(quizzes.load(q.file));
  assert.throws(() => quizzes.load('../package.json'), /Invalid quiz file name/);
});

test('the quizmaster can step back, add time and overrule a choice after the reveal', () => {
  const { game, clock } = setup();
  game.join('team1aaaa', 'A', 'amber', 's1');
  game.join('team2aaaa', 'B', 'pink', 's2');
  game.next();
  game.next();
  assert.equal(game.phase, 'question');
  clock.advance(8000);
  assert.ok(game.addTime());
  assert.equal(game.remaining(), 10000);
  clock.advance(9000);
  assert.equal(game.phase, 'question');
  game.answer('team1aaaa', 1);
  game.answer('team2aaaa', 0);
  assert.equal(game.phase, 'reveal');
  assert.equal(game.teams.get('team1aaaa').score, 1);
  // Overrule: B counts as right after all.
  assert.ok(game.hostState().judgeList);
  assert.ok(game.judge('team2aaaa', true));
  assert.equal(game.teams.get('team2aaaa').score, 1);
  // Step back from the next question to the reveal, then from the reveal to the intro.
  game.next();
  assert.equal(game.questionIndex, 1);
  assert.ok(game.back());
  assert.equal(game.phase, 'reveal');
  assert.equal(game.questionIndex, 0);
  assert.equal(game.teams.get('team2aaaa').score, 1);
  // The question revealed itself (every team answered), so the step before the reveal is the intro.
  game.back();
  assert.equal(game.phase, 'roundIntro');
  assert.equal(game.teams.get('team1aaaa').score, 0);
  assert.ok(game.teams.get('team1aaaa').connected, 'phones stay connected after a step back');
});

test('a saved game comes back after a restart with scores and the question time', () => {
  const { game, clock } = setup();
  game.join('team1aaaa', 'A', 'amber', 's1');
  game.next();
  game.next();
  game.answer('team1aaaa', 1);
  game.next(); // reveal -> question 2
  clock.advance(7000);
  const saved = JSON.parse(JSON.stringify({ quiz: game.quiz, state: game.snapshot() }));

  const later = new Game({ clock });
  later.resume(saved);
  assert.equal(later.phase, 'question');
  assert.equal(later.questionIndex, 1);
  assert.equal(later.teams.get('team1aaaa').score, 1);
  assert.equal(later.teams.get('team1aaaa').connected, false);
  assert.equal(later.remaining(), 10000, 'a question that comes back gets at least 10 seconds');
  // The phone comes back with its stored team id.
  assert.ok(later.join('team1aaaa', '', '', 's9').ok);
  assert.ok(later.teams.get('team1aaaa').connected);
  later.answer('team1aaaa', 0);
  assert.equal(later.phase, 'reveal');
  assert.equal(later.teams.get('team1aaaa').score, 2);
});

test('a team photo shows up for the screen, the standings and the phone', () => {
  const { game } = setup();
  game.join('team1aaaa', 'A', 'amber', 's1');
  assert.equal(game.setPhoto('nobodyaaa', '/media/x.webp'), false);
  assert.ok(game.setPhoto('team1aaaa', '/media/0123456789abcdef0123.webp'));
  assert.equal(game.screenState().teams[0].photo, '/media/0123456789abcdef0123.webp');
  assert.equal(game.ranking()[0].photo, '/media/0123456789abcdef0123.webp');
  assert.equal(game.teamState('team1aaaa').team.photo, '/media/0123456789abcdef0123.webp');
});
