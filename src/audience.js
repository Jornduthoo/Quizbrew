'use strict';

// The audience: people in the room without a team play along on their own phone, with a nickname.
// They answer the multiple-choice and true/false questions, never change the team scores, and get
// their own little ranking. The big screen shows how the room did and who in the audience is best.

const MAX_PEOPLE = 300;
const MAX_NAME = 20;

class Audience {
  constructor(game, { emit = () => {} } = {}) {
    this.game = game;
    this.emit = emit;
    this.people = new Map(); // id -> { name, score, answer, key, sockets: Set }
    this.scoredKey = null;
    this.quiz = null;
  }

  key() { return `${this.game.roundIndex}:${this.game.questionIndex}`; }

  // A question the audience can play: multiple choice or true/false, not the tie-break.
  playable() {
    const g = this.game;
    return !!g.round && !g.round.tiebreak && ['choice', 'trueFalse'].includes(g.kind) && !!g.question
      && (g.kind === 'trueFalse' || Array.isArray(g.question.answers));
  }

  correctIndex() {
    const q = this.game.question;
    return this.game.kind === 'trueFalse' ? (q.correct ? 0 : 1) : q.correct;
  }

  join(id, name, socketId) {
    if (this.game.phase === 'idle') return { error: 'error.noQuiz' };
    const known = this.people.get(id);
    if (known) {
      known.sockets.add(socketId);
      this.update();
      return { ok: true, name: known.name };
    }
    const clean = String(name || '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME);
    if (!clean) return { error: 'error.nameEmpty' };
    if (this.people.size >= MAX_PEOPLE) return { error: 'error.generic' };
    this.people.set(id, { name: clean, score: 0, answer: null, key: null, sockets: new Set([socketId]) });
    this.update();
    return { ok: true, name: clean };
  }

  leave(id) {
    if (this.people.delete(id)) this.update();
  }

  disconnect(socketId) {
    for (const p of this.people.values()) p.sockets.delete(socketId);
  }

  answer(id, raw) {
    const p = this.people.get(id);
    const g = this.game;
    if (!p || g.phase !== 'question' || !this.playable() || p.key === this.key()) return false;
    const n = g.kind === 'trueFalse' ? 2 : g.question.answers.length;
    if (!Number.isInteger(raw) || raw < 0 || raw >= n) return false;
    p.answer = raw;
    p.key = this.key();
    this.update();
    return true;
  }

  // After every change of the game: a new quiz starts everyone at zero, a reveal scores the audience once.
  check() {
    const g = this.game;
    if (g.quiz !== this.quiz) {
      this.quiz = g.quiz;
      this.scoredKey = null;
      for (const p of this.people.values()) { p.score = 0; p.answer = null; p.key = null; }
    }
    if (g.phase === 'reveal' && this.playable() && this.scoredKey !== this.key()) {
      this.scoredKey = this.key();
      const right = this.correctIndex();
      for (const p of this.people.values()) if (p.key === this.scoredKey && p.answer === right) p.score += 1;
    }
    this.update();
  }

  ranking() {
    let prev = null;
    return [...this.people.entries()].sort(([, a], [, b]) => b.score - a.score || a.name.localeCompare(b.name)).map(([id, p], i) => {
      const rank = prev && prev.score === p.score ? prev.rank : i + 1;
      prev = { score: p.score, rank };
      return { id, name: p.name, score: p.score, rank };
    });
  }
  publicRanking(n) { return this.ranking().slice(0, n).map(({ name, score, rank }) => ({ name, score, rank })); }

  // How the room did on the question that was just revealed.
  revealStats() {
    const g = this.game;
    if (g.phase !== 'reveal' || !this.playable()) return null;
    const key = this.key();
    const answered = [...this.people.values()].filter(p => p.key === key);
    if (!answered.length) return null;
    const right = answered.filter(p => p.answer === this.correctIndex()).length;
    return { answered: answered.length, right, pct: Math.round(100 * right / answered.length) };
  }

  screenView() {
    const g = this.game;
    return {
      count: this.people.size,
      reveal: this.revealStats(),
      top: g.phase === 'end' || g.phase === 'scoreboard' ? this.publicRanking(3) : [],
    };
  }

  personView(id, p) {
    const g = this.game;
    const key = this.key();
    const playing = g.phase === 'question' && this.playable();
    const ranking = this.ranking();
    const me = ranking.find(r => r.id === id);
    return {
      phase: g.phase,
      title: g.quiz ? g.quiz.title : '',
      name: p.name,
      score: p.score,
      rank: me ? me.rank : null,
      people: this.people.size,
      question: playing || (g.phase === 'reveal' && this.playable()) ? {
        key, kind: g.kind, text: g.question.question || '',
        answers: g.kind === 'trueFalse' ? null : g.question.answers.slice(),
        remaining: playing ? g.remaining() : 0, time: g.question.time,
      } : null,
      answer: p.key === key ? p.answer : null,
      correct: g.phase === 'reveal' && this.playable() ? this.correctIndex() : null,
      top: g.phase === 'end' ? this.publicRanking(5) : null,
    };
  }

  update() {
    for (const [id, p] of this.people) if (p.sockets.size) this.emit(`aud:${id}`, 'audience', this.personView(id, p));
    this.emit('screen', 'audience', this.screenView());
  }
}

module.exports = { Audience, MAX_PEOPLE };
