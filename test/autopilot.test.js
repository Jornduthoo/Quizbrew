const test = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('../src/game');
const { Autopilot, DELAYS } = require('../src/autopilot');

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

function setup(rounds) {
  const clock = fakeClock();
  const views = [];
  let pilot = null;
  const game = new Game({ clock, onChange: () => pilot && pilot.check() });
  pilot = new Autopilot(game, { clock, onUpdate: v => views.push(v) });
  game.load({ title: 'T', rounds: rounds || [
    { type: 'classic', title: 'R1', questions: [
      { question: 'Q1', answers: ['a', 'b'], correct: 0, time: 10 },
      { question: 'Q2', answers: ['a', 'b'], correct: 1, time: 10 },
    ] },
  ] });
  game.join('team1aaaa', 'A', 'amber', 's1');
  game.join('team2aaaa', 'B', 'pink', 's2');
  return { game, clock, pilot, views };
}

test('autopilot runs a whole quiz without the quizmaster', () => {
  const { game, clock, pilot, views } = setup();
  pilot.set(true);
  game.next(); // the quizmaster starts the quiz from the lobby
  assert.equal(game.phase, 'roundIntro');
  assert.equal(views.at(-1).left, DELAYS.roundIntro);
  clock.advance(DELAYS.roundIntro);
  assert.equal(game.phase, 'question');
  game.answer('team1aaaa', 0);
  clock.advance(10000); // the question timer reveals
  assert.equal(game.phase, 'reveal');
  clock.advance(DELAYS.reveal);
  assert.equal(game.phase, 'question');
  assert.equal(game.questionIndex, 1);
  clock.advance(10000);
  clock.advance(DELAYS.reveal);
  assert.equal(game.phase, 'scoreboard');
  clock.advance(DELAYS.scoreboard);
  // A tie-break or the awards may come in between; it always ends.
  for (let i = 0; i < 6 && game.phase !== 'end'; i++) clock.advance(30000);
  assert.equal(game.phase, 'end');
});

test('autopilot waits in the lobby, during a break and when it is off', () => {
  const { game, clock, pilot } = setup();
  pilot.set(true);
  clock.advance(60000);
  assert.equal(game.phase, 'lobby');
  game.next();
  game.startBreak();
  clock.advance(DELAYS.roundIntro * 2);
  assert.equal(game.phase, 'roundIntro');
  game.endBreak();
  clock.advance(DELAYS.roundIntro);
  assert.equal(game.phase, 'question');
  clock.advance(10000);
  pilot.set(false);
  clock.advance(60000);
  assert.equal(game.phase, 'reveal');
  assert.equal(pilot.view().on, false);
});

test('autopilot leaves a buzz to the quizmaster', () => {
  const { game, clock, pilot } = setup([{ type: 'buzzer', title: 'B', questions: [{ question: 'Who?', answer: 'Me', time: 20 }] }]);
  pilot.set(true);
  game.next();
  clock.advance(DELAYS.roundIntro);
  assert.equal(game.phase, 'question');
  game.answer('team1aaaa', 'buzz');
  assert.ok(game.buzz);
  clock.advance(60000);
  assert.equal(game.phase, 'question');
  assert.ok(game.buzz);
});
