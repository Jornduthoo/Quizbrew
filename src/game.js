// The live quiz. One game runs at a time on a host.
// Phases: idle -> lobby -> roundIntro -> [wager] -> question -> reveal -> (question ...) -> scoreboard -> (roundIntro ...) -> end
// The quizmaster drives the pace with next(); a question also reveals itself when time is up or every team answered.
// What a question looks like and how it scores comes from its round type (rounds.js).
// Errors are returned as i18n keys, never as screen text.

const { TEAM_COLORS } = require('./teams');
const rounds = require('./rounds');

const MAX_NAME = 20;

class Game {
  // emit(target, event, payload): target is 'host', 'screen' or a team socket id.
  // clock: { now, setTimeout, clearTimeout } so tests can drive time.
  constructor({ emit = () => {}, clock = { now: Date.now, setTimeout, clearTimeout } } = {}) {
    this.emit = emit;
    this.clock = clock;
    this.teams = new Map(); // teamId -> team (see join)
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
    this.overrides = new Map();
    this.underdogs = new Set();
    this.teams.clear();
    this.previousRanks = {};
  }

  load(quiz) {
    const clean = validateQuiz(quiz);
    this.reset();
    this.quiz = clean;
    this.phase = 'lobby';
    this.broadcast();
  }

  get round() {
    return this.quiz && this.quiz.rounds[this.roundIndex];
  }

  get type() {
    return this.round && rounds.get(this.round.type);
  }

  get question() {
    return this.round && this.round.questions[this.questionIndex];
  }

  get kind() {
    return this.question ? rounds.kindOf(this.type, this.question) : null;
  }

  hasTwist(name) {
    return !!this.round && this.round.twists.includes(name);
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
    this.teams.set(teamId, {
      name: clean, color, score: 0, socketId, connected: true,
      answer: null, answeredAt: 0, correct: false, lastPoints: 0, away: false, blocked: false, wager: null,
      jokerRound: -1,
    });
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
      case 'wager':
        return this.startQuestion();
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
    // Underdog twist: whoever is last when the round starts gets a boost.
    const ranking = this.ranking();
    const last = ranking.length > 1 ? ranking[ranking.length - 1].score : null;
    this.underdogs = new Set(last === null || ranking[0].score === last ? [] : ranking.filter(r => r.score === last).map(r => r.id));
    this.broadcast();
  }

  // A team plays its one joker of the evening on the round that is about to start: points x2.
  playJoker(teamId) {
    const t = this.teams.get(teamId);
    if (!t || !this.quiz.jokers || this.phase !== 'roundIntro' || t.jokerRound !== -1) return false;
    t.jokerRound = this.roundIndex;
    this.broadcast();
    return true;
  }

  openQuestion(index) {
    this.questionIndex = index;
    this.overrides = new Map();
    for (const t of this.teams.values()) {
      t.answer = null;
      t.answeredAt = 0;
      t.correct = false;
      t.lastPoints = 0;
      t.away = false;
      t.blocked = false;
      t.wager = null;
    }
    this.clearTimer();
    if (this.type.wager) {
      this.phase = 'wager';
      return this.broadcast();
    }
    this.startQuestion();
  }

  maxWager(t) {
    return Math.max(t.score, this.question.points);
  }

  setWager(teamId, amount) {
    const t = this.teams.get(teamId);
    if (!t || this.phase !== 'wager' || !Number.isFinite(amount)) return false;
    t.wager = Math.max(0, Math.min(this.maxWager(t), Math.round(amount)));
    this.broadcast();
    return true;
  }

  startQuestion() {
    for (const t of this.teams.values()) if (this.type.wager && t.wager === null) t.wager = 0;
    this.phase = 'question';
    this.questionStartedAt = this.clock.now();
    this.clearTimer();
    this.timer = this.clock.setTimeout(() => this.reveal(), this.question.time * 1000);
    this.broadcast();
  }

  answer(teamId, raw) {
    const t = this.teams.get(teamId);
    if (!t || this.phase !== 'question' || t.answer !== null || t.blocked) return false;
    const value = this.type.parse(raw, this.question);
    if (value === undefined) return false;
    t.answer = value;
    t.answeredAt = this.clock.now() - this.questionStartedAt;
    if ([...this.teams.values()].every(x => x.answer !== null || x.blocked || !x.connected)) this.reveal();
    else this.broadcast();
    return true;
  }

  // The phone left the page (switched app, opened a browser tab) during a question.
  // The quizmaster always sees it; with the lockdown twist the answer is blocked.
  leftPage(teamId) {
    const t = this.teams.get(teamId);
    if (!t || this.phase !== 'question' || t.away) return;
    t.away = true;
    if (this.hasTwist('lockdown')) {
      t.blocked = true;
      t.answer = null;
    }
    this.broadcast();
  }

  // Points for every team on the current question. Pure: does not touch the scores.
  computePoints() {
    const q = this.question;
    const type = this.type;
    const ids = [...this.teams.keys()];
    const entries = ids.map(id => {
      const t = this.teams.get(id);
      return { id, answer: t.answer, answeredAt: t.answeredAt, wager: t.wager || 0 };
    });
    const base = q.points;
    const timeMs = q.time * 1000;
    let results;
    if (type.score) {
      results = type.score(entries, q, base);
    } else {
      const correct = entries.map(e => {
        if (this.overrides.has(e.id)) return this.overrides.get(e.id);
        return e.answer !== null && type.isCorrect(e.answer, q);
      });
      const fastest = Math.min(...entries.filter((e, i) => correct[i]).map(e => e.answeredAt));
      const steps = rounds.stepsOf(type, q);
      results = entries.map((e, i) => {
        const answered = e.answer !== null;
        const left = Math.max(0, 1 - e.answeredAt / timeMs);
        if (!correct[i]) return { correct: false, points: this.round.scoring === 'risk' && answered ? -base : 0 };
        switch (this.round.scoring) {
          case 'speed': return { correct: true, points: base + Math.round(base * left) };
          case 'race': return { correct: true, points: e.answeredAt === fastest ? base : 0 };
          case 'time': return { correct: true, points: Math.max(1, Math.ceil((timeMs - e.answeredAt) / 1000)) };
          case 'ladder': {
            const step = Math.min(steps - 1, Math.floor(e.answeredAt / (timeMs / steps)));
            return { correct: true, points: Math.max(1, Math.ceil(base * (steps - step) / steps)) };
          }
          default: return { correct: true, points: base };
        }
      });
    }
    const out = new Map();
    ids.forEach((id, i) => {
      const t = this.teams.get(id);
      let p = results[i].points;
      if (this.hasTwist('double')) p *= 2;
      if (t.jokerRound === this.roundIndex) p *= 2;
      if (this.hasTwist('underdog') && this.underdogs.has(id) && p > 0) p = Math.round(p * 1.5);
      out.set(id, { points: p, correct: results[i].correct });
    });
    return out;
  }

  applyPoints() {
    for (const [id, r] of this.computePoints()) {
      const t = this.teams.get(id);
      t.score += r.points - t.lastPoints;
      t.lastPoints = r.points;
      t.correct = r.correct;
    }
  }

  reveal() {
    if (this.phase !== 'question') return;
    this.clearTimer();
    for (const t of this.teams.values()) t.lastPoints = 0;
    this.applyPoints();
    this.phase = 'reveal';
    this.broadcast();
  }

  // The quizmaster overrules a typed answer after the reveal (a spelling the list did not know, a wrong match).
  judge(teamId, correct) {
    const t = this.teams.get(teamId);
    if (!t || this.phase !== 'reveal' || this.type.score || this.kind !== 'text') return false;
    this.overrides.set(teamId, !!correct);
    this.applyPoints();
    this.broadcast();
    return true;
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

  // What everybody may see of the current question. The answer only comes with the reveal.
  publicQuestion() {
    const q = this.question;
    const type = this.type;
    return {
      kind: this.kind,
      text: q.question || '',
      image: q.image || null,
      effect: type.effect || null,
      steps: rounds.stepsOf(type, q),
      time: q.time,
      points: q.points,
      ...type.publicQ(q),
    };
  }

  common() {
    const q = this.question;
    const showQuestion = q && (this.phase === 'question' || this.phase === 'reveal');
    const round = this.round;
    return {
      phase: this.phase,
      title: this.quiz ? this.quiz.title : '',
      jokers: !!(this.quiz && this.quiz.jokers),
      round: round ? {
        index: this.roundIndex, total: this.quiz.rounds.length, title: round.title, type: round.type,
        questions: round.questions.length, scoring: round.scoring, twists: round.twists,
      } : null,
      questionIndex: this.questionIndex,
      question: showQuestion ? this.publicQuestion() : null,
      category: this.phase === 'wager' ? (q.category || '') : null,
      remaining: this.remaining(),
      reveal: this.phase === 'reveal' ? this.type.revealQ(q) : null,
      correct: this.phase === 'reveal' ? (this.type.revealQ(q).correct ?? null) : null,
    };
  }

  // The big screen and the quizmaster see the same thing; the quizmaster also sees the answer early and team status.
  screenState() {
    const teams = [...this.teams.values()];
    const kind = this.kind;
    const reveal = this.phase === 'reveal';
    const state = {
      ...this.common(),
      teams: teams.map(t => ({
        name: t.name, color: t.color, answered: t.answer !== null, connected: t.connected, away: t.away, blocked: t.blocked,
        wagered: t.wager !== null, joker: t.jokerRound === this.roundIndex, jokerLeft: t.jokerRound === -1,
      })),
      answered: teams.filter(t => t.answer !== null).length,
      counts: null,
      answers: null,
      ranking: this.phase === 'scoreboard' || this.phase === 'end' || reveal ? this.ranking() : null,
    };
    if (reveal && (kind === 'choice' || kind === 'trueFalse')) {
      const n = kind === 'trueFalse' ? 2 : this.question.answers.length;
      state.counts = Array.from({ length: n }, (_, i) => teams.filter(t => t.answer === i).length);
    }
    if (reveal && (kind === 'text' || kind === 'number')) {
      state.answers = [...this.teams.entries()].map(([id, t]) => ({
        id, name: t.name, color: t.color, answer: t.answer, correct: t.correct, points: t.lastPoints, wager: t.wager,
      }));
    }
    return state;
  }

  hostState() {
    const q = this.question;
    const live = q && (this.phase === 'question' || this.phase === 'wager');
    return {
      ...this.screenState(),
      ranking: this.ranking(),
      teamIds: [...this.teams.keys()],
      answerKey: live ? this.type.revealQ(q) : null,
      liveAnswers: this.phase === 'question' && (this.kind === 'text' || this.kind === 'number')
        ? [...this.teams.values()].filter(t => t.answer !== null).map(t => ({ name: t.name, color: t.color, answer: t.answer }))
        : null,
      canJudge: this.phase === 'reveal' && !this.type.score && this.kind === 'text',
      lastQuestion: !!this.round && this.questionIndex + 1 >= this.round.questions.length,
      lastRound: !!this.quiz && this.roundIndex + 1 >= this.quiz.rounds.length,
    };
  }

  teamState(teamId) {
    const t = this.teams.get(teamId);
    const state = { ...this.common(), takenColors: [...this.teams.values()].map(x => x.color) };
    // Blackout: the question and the answer texts are only on the big screen.
    if (state.question && this.hasTwist('blackout') && this.phase === 'question') {
      state.question = { ...state.question, text: '', clues: undefined, answers: state.question.answers ? state.question.answers.map(() => '') : undefined, blackout: true };
    }
    if (!t) return state;
    const r = this.ranking().find(x => x.id === teamId);
    return {
      ...state,
      team: {
        name: t.name, color: t.color, score: t.score, rank: r.rank, teams: this.teams.size,
        jokerLeft: t.jokerRound === -1, jokerNow: t.jokerRound === this.roundIndex,
      },
      answer: t.answer,
      away: t.away,
      blocked: t.blocked,
      wager: t.wager,
      maxWager: this.phase === 'wager' ? this.maxWager(t) : null,
      lastPoints: this.phase === 'reveal' ? t.lastPoints : 0,
      wasCorrect: this.phase === 'reveal' ? t.correct : null,
    };
  }

  broadcast() {
    this.emit('host', 'state', this.hostState());
    this.emit('screen', 'state', this.screenState());
    this.emit('lobby', 'state', this.teamState(null));
    for (const [id, t] of this.teams) if (t.connected) this.emit(t.socketId, 'state', this.teamState(id));
  }
}

// A quiz file: { title, jokers?, rounds: [{ type, title, scoring?, twists?, questions: [...] }] }
// The fields of a question depend on its round type (rounds.js). Returns a cleaned copy with the defaults filled in.
function validateQuiz(quiz) {
  const fail = msg => { throw new Error(`Invalid quiz: ${msg}`); };
  if (!quiz || typeof quiz !== 'object') fail('not an object');
  if (!Array.isArray(quiz.rounds) || quiz.rounds.length === 0) fail('no rounds');
  const clean = { ...quiz, title: String(quiz.title || '').trim() || 'Quiz', jokers: !!quiz.jokers };
  clean.rounds = quiz.rounds.map((r, ri) => {
    const type = rounds.get(r && r.type);
    if (!type) fail(`round ${ri + 1} has unsupported type "${r && r.type}"`);
    if (!Array.isArray(r.questions) || r.questions.length === 0) fail(`round ${ri + 1} has no questions`);
    const round = rounds.withDefaults({ ...r, title: String(r.title || '').trim() });
    round.questions.forEach((q, qi) => {
      const where = `round ${ri + 1}, question ${qi + 1}`;
      if (!q || typeof q !== 'object') fail(`${where} is empty`);
      type.validate(q, msg => fail(`${where} ${msg}`));
      if (!(q.time > 0)) fail(`${where} needs a time in seconds`);
    });
    return round;
  });
  return clean;
}

module.exports = { Game, validateQuiz };
