// The live quiz. One game runs at a time on a host.
// Phases: idle -> lobby -> roundIntro -> question -> reveal -> (question ...) -> scoreboard -> (roundIntro ...) -> end
// The quizmaster drives the pace with next(); a question also reveals itself when time is up or every team answered.
// Errors are returned as i18n keys, never as screen text.

const { TEAM_COLORS } = require('./teams');

const MAX_NAME = 20;

class Game {
  // emit(target, event, payload): target is 'host', 'screen' or a team socket id.
  // clock: { now, setTimeout, clearTimeout } so tests can drive time.
  constructor({ emit = () => {}, clock = { now: Date.now, setTimeout, clearTimeout } } = {}) {
    this.emit = emit;
    this.clock = clock;
    this.teams = new Map(); // teamId -> { name, color, score, answer, answeredAt, socketId, connected, lastPoints }
    this.reset();
  }

  reset() {
    if (this.timer) this.clock.clearTimeout(this.timer);
    this.timer = null;
    this.quiz = null;
    this.phase = 'idle';
    this.roundIndex = -1;
    this.questionIndex = -1;
    this.questionStartedAt = 0;
    this.teams.clear();
    this.previousRanks = {};
  }

  load(quiz) {
    validateQuiz(quiz);
    this.reset();
    this.quiz = quiz;
    this.phase = 'lobby';
    this.broadcast();
  }

  get round() {
    return this.quiz && this.quiz.rounds[this.roundIndex];
  }

  get question() {
    return this.round && this.round.questions[this.questionIndex];
  }

  join(teamId, name, color, socketId) {
    if (this.phase === 'idle') return { error: 'error.noQuiz' };
    const existing = this.teams.get(teamId);
    if (existing) {
      existing.socketId = socketId;
      existing.connected = true;
      this.broadcast();
      return { ok: true, name: existing.name, color: existing.color };
    }
    if (this.phase !== 'lobby') return { error: 'error.alreadyStarted' };
    const clean = String(name || '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME);
    if (!clean) return { error: 'error.nameEmpty' };
    const teams = [...this.teams.values()];
    if (teams.some(t => t.name.toLowerCase() === clean.toLowerCase())) return { error: 'error.nameTaken' };
    if (!TEAM_COLORS.includes(color)) return { error: 'error.colorInvalid' };
    if (teams.some(t => t.color === color)) return { error: 'error.colorTaken' };
    this.teams.set(teamId, { name: clean, color, score: 0, answer: null, answeredAt: 0, socketId, connected: true, lastPoints: 0 });
    this.broadcast();
    return { ok: true, name: clean, color };
  }

  disconnect(socketId) {
    for (const t of this.teams.values()) if (t.socketId === socketId) t.connected = false;
    this.broadcast();
  }

  kick(teamId) {
    const t = this.teams.get(teamId);
    if (!t) return;
    this.teams.delete(teamId);
    this.emit(t.socketId, 'kicked');
    this.broadcast();
  }

  adjustScore(teamId, delta) {
    const t = this.teams.get(teamId);
    if (!t || !Number.isFinite(delta)) return;
    t.score += Math.trunc(delta);
    this.broadcast();
  }

  // One button for the quizmaster: always moves to the next logical step.
  next() {
    switch (this.phase) {
      case 'lobby':
        if (this.teams.size === 0) return;
        return this.startRound(0);
      case 'roundIntro':
        return this.openQuestion(0);
      case 'question':
        return this.reveal();
      case 'reveal':
        if (this.questionIndex + 1 < this.round.questions.length) return this.openQuestion(this.questionIndex + 1);
        return this.showScoreboard();
      case 'scoreboard':
        if (this.roundIndex + 1 < this.quiz.rounds.length) return this.startRound(this.roundIndex + 1);
        this.phase = 'end';
        return this.broadcast();
      default:
    }
  }

  startRound(index) {
    this.roundIndex = index;
    this.questionIndex = -1;
    this.phase = 'roundIntro';
    this.broadcast();
  }

  openQuestion(index) {
    this.questionIndex = index;
    for (const t of this.teams.values()) {
      t.answer = null;
      t.answeredAt = 0;
      t.lastPoints = 0;
    }
    this.phase = 'question';
    this.questionStartedAt = this.clock.now();
    this.clearTimer();
    this.timer = this.clock.setTimeout(() => this.reveal(), this.question.time * 1000);
    this.broadcast();
  }

  answer(teamId, choice) {
    const t = this.teams.get(teamId);
    const q = this.question;
    if (!t || this.phase !== 'question' || t.answer !== null) return false;
    if (!Number.isInteger(choice) || choice < 0 || choice >= q.answers.length) return false;
    t.answer = choice;
    t.answeredAt = this.clock.now() - this.questionStartedAt;
    if ([...this.teams.values()].every(x => x.answer !== null || !x.connected)) this.reveal();
    else this.broadcast();
    return true;
  }

  reveal() {
    if (this.phase !== 'question') return;
    this.clearTimer();
    const q = this.question;
    const points = q.points || 1;
    for (const t of this.teams.values()) {
      t.lastPoints = t.answer === q.correct ? points : 0;
      t.score += t.lastPoints;
    }
    this.phase = 'reveal';
    this.broadcast();
  }

  showScoreboard() {
    this.phase = 'scoreboard';
    this.broadcast();
    // Remember the ranks so the next scoreboard can show who moved up.
    this.previousRanks = Object.fromEntries(this.ranking().map(r => [r.id, r.rank]));
  }

  stop() {
    this.reset();
    this.broadcast();
  }

  clearTimer() {
    if (this.timer) this.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  // Ties share a rank: 10, 8, 8, 5 -> 1, 2, 2, 4.
  ranking() {
    const sorted = [...this.teams.entries()]
      .map(([id, t]) => ({ id, name: t.name, color: t.color, score: t.score, lastPoints: t.lastPoints }))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    sorted.forEach((r, i) => {
      r.rank = i > 0 && sorted[i - 1].score === r.score ? sorted[i - 1].rank : i + 1;
      r.previousRank = this.previousRanks[r.id] || null;
    });
    return sorted;
  }

  remaining() {
    if (this.phase !== 'question') return 0;
    return Math.max(0, this.question.time * 1000 - (this.clock.now() - this.questionStartedAt));
  }

  common() {
    const q = this.question;
    const showQuestion = q && (this.phase === 'question' || this.phase === 'reveal');
    return {
      phase: this.phase,
      title: this.quiz ? this.quiz.title : '',
      round: this.round ? { index: this.roundIndex, total: this.quiz.rounds.length, title: this.round.title, type: this.round.type, questions: this.round.questions.length } : null,
      questionIndex: this.questionIndex,
      question: showQuestion ? { text: q.question, answers: q.answers, time: q.time } : null,
      remaining: this.remaining(),
      correct: this.phase === 'reveal' ? q.correct : null,
    };
  }

  // The big screen and the quizmaster see the same thing; the quizmaster also sees the answer early and team status.
  screenState() {
    const teams = [...this.teams.values()];
    const q = this.question;
    return {
      ...this.common(),
      teams: teams.map(t => ({ name: t.name, color: t.color, answered: t.answer !== null, connected: t.connected })),
      answered: teams.filter(t => t.answer !== null).length,
      counts: this.phase === 'reveal' ? q.answers.map((_, i) => teams.filter(t => t.answer === i).length) : null,
      ranking: this.phase === 'scoreboard' || this.phase === 'end' || this.phase === 'reveal' ? this.ranking() : null,
    };
  }

  hostState() {
    const q = this.question;
    return {
      ...this.screenState(),
      ranking: this.ranking(),
      teamIds: [...this.teams.keys()],
      answerKey: q && this.phase === 'question' ? q.correct : null,
      lastQuestion: !!this.round && this.questionIndex + 1 >= this.round.questions.length,
      lastRound: !!this.quiz && this.roundIndex + 1 >= this.quiz.rounds.length,
    };
  }

  teamState(teamId) {
    const t = this.teams.get(teamId);
    const state = { ...this.common(), takenColors: [...this.teams.values()].map(x => x.color) };
    if (!t) return state;
    const r = this.ranking().find(x => x.id === teamId);
    return {
      ...state,
      team: { name: t.name, color: t.color, score: t.score, rank: r.rank, teams: this.teams.size },
      answer: t.answer,
      lastPoints: this.phase === 'reveal' ? t.lastPoints : 0,
    };
  }

  broadcast() {
    this.emit('host', 'state', this.hostState());
    this.emit('screen', 'state', this.screenState());
    this.emit('lobby', 'state', this.teamState(null));
    for (const [id, t] of this.teams) if (t.connected) this.emit(t.socketId, 'state', this.teamState(id));
  }
}

// A quiz file: { title, rounds: [{ type: 'classic', title, questions: [{ question, answers: [2..4], correct, time, points? }] }] }
function validateQuiz(quiz) {
  const fail = msg => { throw new Error(`Invalid quiz: ${msg}`); };
  if (!quiz || typeof quiz !== 'object') fail('not an object');
  if (!Array.isArray(quiz.rounds) || quiz.rounds.length === 0) fail('no rounds');
  quiz.rounds.forEach((r, ri) => {
    if (r.type !== 'classic') fail(`round ${ri + 1} has unsupported type "${r.type}"`);
    if (!Array.isArray(r.questions) || r.questions.length === 0) fail(`round ${ri + 1} has no questions`);
    r.questions.forEach((q, qi) => {
      const where = `round ${ri + 1}, question ${qi + 1}`;
      if (typeof q.question !== 'string' || !q.question.trim()) fail(`${where} has no text`);
      if (!Array.isArray(q.answers) || q.answers.length < 2 || q.answers.length > 4) fail(`${where} needs 2 to 4 answers`);
      if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct >= q.answers.length) fail(`${where} has no valid correct answer`);
      if (!(q.time > 0)) fail(`${where} needs a time in seconds`);
    });
  });
  return true;
}

module.exports = { Game, validateQuiz };
