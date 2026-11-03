'use strict';

// Autopilot: the quiz runs itself. After a pause that fits each step it presses "next" for the quizmaster.
// Questions and votes already end on their own timer. It never acts while the quizmaster has to judge
// (a buzz, a clock round), during a break, in the lobby or at the end.

const DELAYS = { roundIntro: 8000, wager: 20000, reveal: 9000, scoreboard: 10000, awards: 14000 };
const JUDGE_DELAY = 14000; // a reveal with typed answers: time to count one as right

class Autopilot {
  constructor(game, { clock = { now: Date.now, setTimeout, clearTimeout }, onUpdate = () => {} } = {}) {
    this.game = game;
    this.clock = clock;
    this.onUpdate = onUpdate;
    this.on = false;
    this.timer = null;
    this.key = null;
    this.at = null;
    this.total = 0;
  }

  set(on) {
    this.on = !!on;
    this.key = null;
    this.check();
  }

  delay() {
    const g = this.game;
    if (!this.on || !g.quiz || g.breakUntil) return 0;
    if (g.phase === 'reveal' && g.canJudge() && g.kind === 'text') return JUDGE_DELAY;
    return DELAYS[g.phase] || 0;
  }

  // Called after every change of the game: start a new countdown when the step changed.
  check() {
    const g = this.game;
    const key = [this.on, g.phase, g.roundIndex, g.questionIndex, !!g.breakUntil, g.quiz ? g.quiz.rounds.length : 0].join('|');
    if (key === this.key) return;
    this.key = key;
    this.stop();
    const ms = this.delay();
    if (ms) {
      this.total = ms;
      this.at = this.clock.now() + ms;
      this.timer = this.clock.setTimeout(() => { this.timer = null; this.at = null; this.game.next(); }, ms);
      if (this.timer && this.timer.unref) this.timer.unref();
    }
    this.onUpdate(this.view());
  }

  stop() {
    if (this.timer) this.clock.clearTimeout(this.timer);
    this.timer = null;
    this.at = null;
  }

  view() {
    return { on: this.on, left: this.at ? Math.max(0, this.at - this.clock.now()) : 0, total: this.at ? this.total : 0 };
  }
}

module.exports = { Autopilot, DELAYS, JUDGE_DELAY };
