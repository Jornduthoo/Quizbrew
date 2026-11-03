const test = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('../src/game');
const { Audience } = require('../src/audience');

test('the audience plays along on choice questions with its own score', () => {
  const sent = [];
  let audience = null;
  const game = new Game({ onChange: () => audience && audience.check() });
  audience = new Audience(game, { emit: (to, ev, p) => sent.push({ to, ev, p }) });
  assert.equal(audience.join('aud1aaaaa', 'Tom', 's1').error, 'error.noQuiz');
  game.load({ title: 'A', rounds: [
    { type: 'classic', title: 'R', questions: [{ question: 'Q1', answers: ['a', 'b', 'c'], correct: 1, time: 10 }] },
    { type: 'trueFalse', title: 'T', questions: [{ question: 'Sky is blue', correct: true, time: 10 }] },
    { type: 'open', title: 'O', questions: [{ question: 'Name?', answer: 'x', time: 10 }] },
  ] });
  game.join('team1aaaa', 'Owls', 'amber', 'p1');
  assert.ok(audience.join('aud1aaaaa', '  Tom ', 's1').ok);
  assert.ok(audience.join('aud2aaaaa', 'Ann', 's2').ok);
  assert.equal(audience.join('aud3aaaaa', ' ', 's3').error, 'error.nameEmpty');
  assert.equal(audience.answer('aud1aaaaa', 1), false, 'no question yet');
  game.next(); game.next();
  assert.ok(audience.answer('aud1aaaaa', 1));
  assert.equal(audience.answer('aud1aaaaa', 0), false, 'one answer per question');
  assert.ok(audience.answer('aud2aaaaa', 2));
  assert.equal(audience.answer('aud2aaaaa', 9), false);
  game.answer('team1aaaa', 1); // the only team answered: reveal
  assert.equal(game.phase, 'reveal');
  assert.deepEqual(audience.screenView().reveal, { answered: 2, right: 1, pct: 50 });
  audience.check(); // a second check does not score again
  assert.equal(audience.people.get('aud1aaaaa').score, 1);
  assert.equal(game.teams.get('team1aaaa').score, 1, 'the audience never changes the teams');
  const view = sent.filter(x => x.to === 'aud:aud1aaaaa').at(-1).p;
  assert.equal(view.correct, 1);
  assert.equal(view.rank, 1);
  game.next(); game.next(); game.next(); // scoreboard, round 2 intro, true/false question
  assert.ok(audience.answer('aud2aaaaa', 0));
  game.answer('team1aaaa', 0);
  assert.equal(audience.people.get('aud2aaaaa').score, 1);
  game.next(); game.next(); game.next(); // open question: not for the audience
  assert.equal(game.phase, 'question');
  assert.equal(audience.answer('aud1aaaaa', 0), false);
  assert.equal(audience.personView('aud1aaaaa', audience.people.get('aud1aaaaa')).question, null);
  assert.deepEqual(audience.ranking().map(r => r.rank), [1, 1]);
  // A new quiz starts the audience at zero.
  game.load({ title: 'B', rounds: [{ type: 'classic', title: 'R', questions: [{ question: 'Q', answers: ['a', 'b'], correct: 0, time: 10 }] }] });
  assert.equal(audience.people.get('aud1aaaaa').score, 0);
  audience.leave('aud2aaaaa');
  assert.equal(audience.screenView().count, 1);
});
