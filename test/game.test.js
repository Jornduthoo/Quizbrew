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

test('a big night: once every colour is taken, colours are shared, up to 40 teams', () => {
  const { game } = setup();
  const { TEAM_COLORS, MAX_TEAMS } = require('../src/teams');
  assert.equal(MAX_TEAMS, 40);
  TEAM_COLORS.forEach((c, i) => assert.ok(game.join(`team${i}aaaaa`, `Team ${i}`, c, `s${i}`).ok));
  assert.deepEqual(game.teamState(null).takenColors, []);
  for (let i = TEAM_COLORS.length; i < MAX_TEAMS; i++) assert.ok(game.join(`team${i}aaaaa`, `Team ${i}`, TEAM_COLORS[i % TEAM_COLORS.length], `s${i}`).ok);
  assert.equal(game.join('teamFullaaa', 'One more', 'amber', 'sx').error, 'error.full');
  assert.equal(game.addPaperTeam('Paper').error, 'error.full');
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
  // Two teams: at least the daredevil-free, streak-free night still has no prize unless someone earned one.
  game.next();
  if (game.phase === 'awards') game.next();
  // 1 - 1: a tie on the podium, so one tie-break question first.
  assert.equal(game.phase, 'roundIntro');
  assert.ok(game.round.tiebreak);
  game.next();
  assert.equal(game.phase, 'question');
  game.answer('team1aaaa', 0);
  game.answer('team2aaaa', game.question.answer);
  assert.equal(game.phase, 'reveal');
  game.next();
  assert.equal(game.phase, 'end');
  assert.deepEqual(game.ranking().map(r => [r.name, r.rank]), [['B', 1], ['A', 2]]);
});

test('tie-break: only tied podium teams play, no points, the closest goes first', () => {
  const { game } = setup();
  game.language = 'nl';
  game.load({ title: 'Tie', rounds: [{ type: 'classic', questions: [{ question: 'Q', answers: ['a', 'b'], correct: 0, time: 10 }] }] });
  ['A', 'B', 'C', 'D', 'E'].forEach((n, i) => game.join('team' + i + 'aaaa', n, ['amber', 'pink', 'cyan', 'lime', 'violet'][i], 's' + i));
  game.next(); game.next();
  // A, B and C are right (1 point each): three share first place. D and E share fourth: no tie-break for them.
  ['team0aaaa', 'team1aaaa', 'team2aaaa'].forEach(id => game.answer(id, 0));
  ['team3aaaa', 'team4aaaa'].forEach(id => game.answer(id, 1));
  game.next(); // scoreboard
  game.next();
  if (game.phase === 'awards') game.next();
  assert.equal(game.phase, 'roundIntro');
  assert.deepEqual(game.screenState().round.tiebreak.map(t => t.name), ['A', 'B', 'C']);
  assert.equal(game.screenState().round.title, 'Schiftingsvraag!');
  assert.equal(game.screenState().round.total, 1, 'the tie-break is not counted as a round');
  assert.equal(game.playJoker('team0aaaa'), false);
  game.next();
  const q = game.question;
  assert.ok(q.question.length > 10, 'a built-in question in the language of the evening');
  assert.equal(game.answer('team3aaaa', 5), false, 'a team that is not tied sits out');
  game.answer('team0aaaa', q.answer + 10);
  game.answer('team1aaaa', q.answer - 3);
  game.answer('team2aaaa', q.answer + 10);
  assert.equal(game.phase, 'reveal');
  assert.equal(game.teamState('team1aaaa').wasCorrect, true);
  game.next();
  assert.equal(game.phase, 'end');
  const ranking = game.ranking();
  assert.deepEqual(ranking.map(r => [r.name, r.rank, r.score]), [['B', 1, 1], ['A', 2, 1], ['C', 2, 1], ['D', 4, 0], ['E', 4, 0]]);
  // Undo back to the question and the tie-break round is not added twice.
  game.back(); game.back();
  assert.equal(game.quiz.rounds.filter(r => r.tiebreak).length, 1);
});

test('tie-break: the quiz can bring its own question, or switch it off', () => {
  const { game } = setup();
  game.load({ title: 'Own', tiebreak: { question: 'How tall is our pub sign?', answer: 3.5, unit: 'm' }, rounds: [{ type: 'classic', questions: [{ question: 'Q', answers: ['a', 'b'], correct: 0, time: 10 }] }] });
  game.join('team1aaaa', 'A', 'amber', 's1');
  game.join('team2aaaa', 'B', 'pink', 's2');
  game.next(); game.next(); game.next(); game.next();
  game.next();
  if (game.phase === 'awards') game.next();
  assert.equal(game.phase, 'roundIntro');
  game.next();
  assert.equal(game.question.question, 'How tall is our pub sign?');
  assert.equal(game.screenState().question.unit, 'm');

  const off = setup().game;
  off.load({ title: 'Off', tiebreak: false, rounds: [{ type: 'classic', questions: [{ question: 'Q', answers: ['a', 'b'], correct: 0, time: 10 }] }] });
  off.join('team1aaaa', 'A', 'amber', 's1');
  off.join('team2aaaa', 'B', 'pink', 's2');
  off.next(); off.next(); off.next(); off.next(); off.next();
  if (off.phase === 'awards') off.next();
  assert.equal(off.phase, 'end');
});

test('prizes at the end: fastest, streak, climber, last second and so close', () => {
  const { game, clock } = setup();
  game.load({ title: 'Long', tiebreak: false, rounds: [
    { type: 'classic', title: 'R1', questions: [0, 1, 2].map(i => ({ question: 'A' + i, answers: ['a', 'b'], correct: 0, time: 10 })) },
    { type: 'classic', title: 'R2', questions: [0, 1, 2].map(i => ({ question: 'B' + i, answers: ['a', 'b'], correct: 0, time: 10 })) },
  ] });
  ['A', 'B', 'C', 'D'].forEach((n, i) => game.join('team' + i + 'aaaa', n, ['amber', 'pink', 'cyan', 'lime'][i], 's' + i));
  game.next(); // intro
  for (let r = 0; r < 2; r++) {
    game.next(); // question 1
    for (let q = 0; q < 3; q++) {
      // Round 1: A is right and fast; round 2: D catches up, B answers late.
      clock.advance(1000);
      game.answer('team0aaaa', r === 0 ? 0 : 1);
      game.answer('team3aaaa', r === 1 ? 0 : 1);
      game.answer('team2aaaa', 1);
      clock.advance(7500);
      game.answer('team1aaaa', 1);
      assert.equal(game.phase, 'reveal');
      game.next();
    }
    if (game.phase === 'scoreboard') game.next();
  }
  assert.equal(game.phase, 'awards');
  const awards = Object.fromEntries(game.screenState().awards.map(a => [a.id, a]));
  assert.equal(awards.fastest.team.name, 'A');
  assert.equal(awards.fastest.n, 1);
  assert.equal(awards.streak.team.name, 'A');
  assert.equal(awards.streak.n, 3);
  assert.equal(awards.buzzer.team.name, 'B');
  assert.equal(awards.climber.team.name, 'D');
  assert.equal(awards.almost, undefined, 'no fourth place when B and C share third');
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
  // The quiz pack: one file per language, the quizmaster sees only theirs.
  for (const lang of ['en', 'nl', 'fr', 'de', 'es']) {
    const packs = quizzes.list(lang).filter(q => q.file.startsWith('night-pack-1.'));
    assert.deepEqual(packs.map(q => q.file), [`night-pack-1.${lang}.json`]);
    assert.equal(packs[0].language, lang);
  }
  assert.deepEqual(quizzes.list('xx').filter(q => q.file.startsWith('night-pack-1.')).map(q => q.file), ['night-pack-1.en.json']);
  // Every language has the same rounds and questions.
  const shape = f => quizzes.load(f).rounds.map(r => `${r.type}:${r.questions.length}:${r.questions.map(q => q.correct ?? q.answer ?? '').join(',')}`);
  const en = shape('night-pack-1.en.json');
  for (const lang of ['nl', 'fr', 'de', 'es']) assert.deepEqual(shape(`night-pack-1.${lang}.json`).map(x => x.split(':').slice(0, 2).join(':')), en.map(x => x.split(':').slice(0, 2).join(':')));
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

test('a break shows a countdown and the standings, and the next press ends it', () => {
  const { game, clock } = setup();
  game.join('team1aaaa', 'A', 'amber', 's1');
  game.join('team2aaaa', 'B', 'pink', 's2');
  game.next();
  game.next();
  assert.equal(game.phase, 'question');
  assert.equal(game.startBreak(), false, 'no break while the clock runs');
  assert.equal(game.hostState().canBreak, false);
  game.answer('team1aaaa', 1);
  game.answer('team2aaaa', 0);
  assert.equal(game.phase, 'reveal');
  assert.ok(game.hostState().canBreak);
  assert.ok(game.startBreak());
  assert.equal(game.screenState().break.left, 10 * 60000);
  assert.equal(game.teamState('team1aaaa').break.standings[0].name, 'A');
  clock.advance(60000);
  assert.ok(game.startBreak(), '5 minutes more');
  assert.equal(game.screenState().break.left, 14 * 60000);
  assert.equal(game.hostState().canBack, false);
  game.next();
  assert.equal(game.screenState().break, null);
  assert.equal(game.phase, 'reveal', 'the press that ends the break does not move on');
  game.next();
  assert.equal(game.questionIndex, 1);
});

test('a paper team plays along: points per round typed in, never blocks a question', () => {
  const { game, clock } = setup();
  assert.equal(new Game().addPaperTeam('Pens').error, 'error.noQuiz');
  game.join('team1aaaa', 'Owls', 'amber', 's1');
  const p = game.addPaperTeam('  The Pens ');
  assert.ok(p.ok);
  assert.equal(p.name, 'The Pens');
  assert.notEqual(p.color, 'amber');
  assert.equal(game.addPaperTeam('the pens').error, 'error.nameTaken');
  assert.equal(game.addPaperTeam(' ').error, 'error.nameEmpty');
  game.next(); // round intro
  game.next(); // question 1
  game.answer('team1aaaa', 1);
  assert.equal(game.phase, 'reveal', 'only the phone team had to answer');
  assert.ok(game.setPaperPoints(p.id, 0, 3));
  assert.ok(game.setPaperPoints(p.id, 0, 2), 'typing again replaces');
  assert.equal(game.teams.get(p.id).score, 2);
  assert.equal(game.setPaperPoints('team1aaaa', 0, 5), false, 'phone teams are scored by the app');
  assert.equal(game.setPaperPoints(p.id, 9, 5), false);
  const host = game.hostState();
  assert.deepEqual(host.paperTeams, [{ id: p.id, name: 'The Pens', color: p.color, points: 2 }]);
  assert.equal(game.screenState().teams.find(x => x.name === 'The Pens').paper, true);
  // Undo and a restart keep the paper points.
  const snap = JSON.parse(JSON.stringify(game.snapshot()));
  game.setPaperPoints(p.id, 0, 7);
  game.restore(snap);
  assert.equal(game.teams.get(p.id).score, 2);
  assert.deepEqual(game.teams.get(p.id).paper, { 0: 2 });
  clock.advance(0);
});

test('power-ups: shield, spy and 50/50, each once per evening', () => {
  const clock = fakeClock();
  const game = new Game({ clock });
  game.load({ title: 'P', powerUps: true, rounds: [
    { type: 'jackpot', title: 'J', questions: [{ category: 'C', question: 'Q?', answer: 'yes', time: 20, points: 5 }] },
    { type: 'classic', title: 'R', questions: [
      { question: 'Q1', answers: ['a', 'b', 'c', 'd'], correct: 2, time: 10 },
      { question: 'Q2', answers: ['a', 'b', 'c', 'd'], correct: 0, time: 10 },
    ] },
  ] });
  game.join('team1aaaa', 'A', 'amber', 's1');
  game.join('team2aaaa', 'B', 'pink', 's2');
  game.join('team3aaaa', 'C', 'cyan', 's3');
  game.next(); // round intro of the jackpot
  assert.equal(game.teamState('team1aaaa').powers.shield, true);
  assert.equal(game.usePower('team1aaaa', 'spy'), false, 'no spy before a question');
  assert.ok(game.usePower('team1aaaa', 'shield'));
  assert.equal(game.usePower('team1aaaa', 'shield'), false, 'once per evening');
  assert.equal(game.teamState('team1aaaa').powers.shieldNow, true);
  game.next(); // wager
  game.setWager('team1aaaa', 1);
  game.setWager('team2aaaa', 1);
  game.next(); // question
  game.answer('team1aaaa', 'no');
  game.answer('team2aaaa', 'no');
  game.answer('team3aaaa', 'yes');
  assert.equal(game.phase, 'reveal');
  assert.equal(game.teams.get('team1aaaa').score, 0, 'the shield stops the minus points');
  assert.ok(game.teams.get('team2aaaa').score < 0);
  game.next(); game.next(); game.next(); // scoreboard, round 2 intro, question 1
  assert.equal(game.phase, 'question');
  assert.equal(game.teamState('team1aaaa').powers.shield, false);
  game.answer('team2aaaa', 1);
  assert.ok(game.usePower('team1aaaa', 'spy'));
  assert.deepEqual(game.teamState('team1aaaa').spy, [0, 1, 0, 0]);
  game.answer('team3aaaa', 2);
  assert.deepEqual(game.teamState('team1aaaa').spy, [0, 1, 1, 0]);
  assert.equal(game.teamState('team2aaaa').spy, null, 'only the spy sees it');
  assert.ok(game.usePower('team1aaaa', 'fifty'));
  const gone = game.teamState('team1aaaa').question.gone;
  assert.equal(gone.length, 2);
  assert.ok(!gone.includes(2));
  assert.deepEqual(game.teamState('team1aaaa').powers.left, []);
  clock.advance(10000);
  game.next(); // question 2: no spy, no 50/50 left
  assert.equal(game.teamState('team1aaaa').spy, null);
  assert.equal(game.usePower('team1aaaa', 'fifty'), false);
  assert.equal(game.teamState('team1aaaa').question.gone.length, 0);
  // Without power-ups in the quiz there are none.
  const { game: plain } = setup();
  plain.join('team1aaaa', 'A', 'amber', 's1');
  plain.next();
  assert.equal(plain.teamState('team1aaaa').powers, null);
  assert.equal(plain.usePower('team1aaaa', 'shield'), false);
});

test('leaving the quiz page warns the quizmaster and the big screen, once per question', () => {
  const { game, sent } = setup();
  game.join('team1aaaa', 'Owls', 'amber', 's1');
  assert.equal(game.leftPage('team1aaaa'), false, 'not while the teams are still joining');
  game.next();
  game.next();
  assert.equal(game.phase, 'question');
  sent.length = 0;
  assert.equal(game.leftPage('team1aaaa'), true);
  const notices = sent.filter(m => m.ev === 'alert');
  assert.deepEqual(notices.map(m => m.to).sort(), ['host', 'screen']);
  assert.deepEqual(notices[0].p, { kind: 'left', name: 'Owls', color: 'amber', count: 1, blocked: false });
  assert.equal(game.leftPage('team1aaaa'), false, 'one notice per question');
  sent.length = 0;
  assert.equal(game.backOnPage('team1aaaa', 7400), true);
  assert.deepEqual(sent.filter(m => m.ev === 'alert').map(m => [m.to, m.p.kind, m.p.seconds]), [['host', 'back', 7]]);
  assert.equal(game.hostState().teams[0].awayCount, 1);
});

test('the quizmaster\'s call: hand-given points and an overruled answer show on the big screen and stay through the reveal', () => {
  const { game, sent } = setup();
  game.join('team1aaaa', 'A', 'amber', 's1');
  game.join('team2aaaa', 'B', 'pink', 's2');
  game.next();
  game.next();
  game.answer('team1aaaa', 1);
  game.answer('team2aaaa', 0);
  assert.equal(game.phase, 'reveal');
  const calls = () => sent.filter(x => x.to === 'screen' && x.ev === 'alert' && ['score', 'judge'].includes(x.p.kind)).map(x => x.p);
  // A bonus of 5 for B, then a penalty of 2 for A.
  assert.ok(game.adjustScore('team2aaaa', 5));
  assert.ok(game.adjustScore('team1aaaa', -2));
  assert.equal(game.teams.get('team2aaaa').score, 5);
  assert.equal(game.teams.get('team1aaaa').score, -1);
  // Nonsense is ignored, and a wild number is capped.
  assert.equal(game.adjustScore('team1aaaa', 0), false);
  assert.equal(game.adjustScore('team1aaaa', NaN), false);
  assert.equal(game.adjustScore('nobody', 3), false);
  game.adjustScore('team1aaaa', 1e9);
  assert.equal(game.teams.get('team1aaaa').score, 999);
  game.adjustScore('team1aaaa', -1000);
  // Overrule B's answer: the question points come on top of the bonus, and only a real change makes a note.
  assert.ok(game.judge('team2aaaa', true));
  assert.equal(game.teams.get('team2aaaa').score, 6);
  game.judge('team2aaaa', true);
  assert.ok(game.judge('team2aaaa', false));
  assert.equal(game.teams.get('team2aaaa').score, 5);
  assert.deepEqual(calls().map(c => [c.kind, c.name, c.delta ?? c.correct]), [
    ['score', 'B', 5], ['score', 'A', -2], ['score', 'A', 1000], ['score', 'A', -1000], ['judge', 'B', true], ['judge', 'B', false],
  ]);
  assert.ok(calls().every(c => c.color));
  // The hand-given points stay when the next question is scored.
  game.next();
  game.answer('team1aaaa', 0);
  game.answer('team2aaaa', 0);
  assert.equal(game.teams.get('team2aaaa').score, 6);
});
