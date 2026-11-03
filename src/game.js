// The live quiz. One game runs at a time on a host.
// Phases: idle -> lobby -> roundIntro -> [wager] -> question -> reveal -> (question ...) -> scoreboard -> (roundIntro ...) -> end
// The quizmaster drives the pace with next(); a question also reveals itself when time is up or every team answered.
// What a question looks like and how it scores comes from its round type (rounds.js).
// Errors are returned as i18n keys, never as screen text.

const { TEAM_COLORS } = require('./teams');
const rounds = require('./rounds');

const MAX_NAME = 20;

// What a round remembers about a team between questions (streak, pot, out of the round ...).
const freshMem = () => ({ streak: 0, pot: 0, out: false, banked: false });

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
    this.leaders = [];
    this.buzz = null;
    this.ballot = null;
    this.actor = null;
    this.voteStartedAt = 0;
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
      jokerRound: -1, mem: freshMem(), memNext: null, bank: false, buzzOut: false,
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
      case 'vote':
        return this.finishVote();
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
    for (const t of this.teams.values()) { t.mem = freshMem(); t.memNext = null; }
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
    this.buzz = null;
    this.ballot = null;
    // Act it out: the teams take turns, in the order they joined.
    const ids = [...this.teams.keys()];
    this.actor = this.type.actor && ids.length ? ids[(this.roundIndex + this.questionIndex) % ids.length] : null;
    const top = Math.max(...[...this.teams.values()].map(t => t.score));
    this.leaders = top > 0 ? [...this.teams.entries()].filter(([, t]) => t.score === top).map(([id]) => id) : [];
    for (const t of this.teams.values()) {
      if (t.memNext) { t.mem = t.memNext; t.memNext = null; }
      t.bank = false;
      t.buzzOut = false;
      t.vote = null;
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
    if (this.type.wager === 'level') return 2;
    return Math.max(t.score, this.question.points);
  }

  // Out of this round (last team standing) or already banked (push your luck).
  sitsOut(t) {
    return !!(this.type && this.type.sitsOut && this.type.sitsOut(t.mem));
  }

  done(t) {
    return t.answer !== null || t.bank || t.blocked || !t.connected || this.sitsOut(t) || (!!this.actor && this.teams.get(this.actor) === t);
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
    if (!t || this.phase !== 'question' || t.blocked || t.bank || this.sitsOut(t) || teamId === this.actor) return false;
    if (t.answer !== null && !this.type.multi) return false;
    if (this.kind === 'buzz') return this.buzzIn(teamId, t);
    const value = this.type.parse(raw, this.question, t);
    if (value === undefined) return false;
    t.answer = value;
    t.answeredAt = this.clock.now() - this.questionStartedAt;
    // A list keeps filling until the time is up.
    if (!this.type.multi && [...this.teams.values()].every(x => this.done(x))) this.reveal();
    else this.broadcast();
    return true;
  }

  // Buzzer: the first team stops the clock and answers out loud; the quizmaster says right or wrong.
  buzzIn(teamId, t) {
    if (this.buzz || t.buzzOut) return false;
    this.buzz = { teamId, at: this.clock.now() - this.questionStartedAt, left: this.remaining() };
    t.answeredAt = this.buzz.at;
    this.clearTimer();
    this.broadcast();
    return true;
  }

  judgeBuzz(right) {
    if (this.phase !== 'question' || !this.buzz) return false;
    const t = this.teams.get(this.buzz.teamId);
    const left = this.buzz.left;
    this.buzz = null;
    if (!t) return false;
    t.answer = right ? 'right' : 'wrong';
    if (right) { this.reveal(); return true; }
    t.buzzOut = true;
    // Wrong: the clock runs on and the other teams may buzz.
    if ([...this.teams.values()].every(x => x.buzzOut || !x.connected) || left <= 0) { this.reveal(); return true; }
    this.questionStartedAt = this.clock.now() - (this.question.time * 1000 - left);
    this.timer = this.clock.setTimeout(() => this.reveal(), left);
    this.broadcast();
    return true;
  }

  // Push your luck: keep the pot and sit out the rest of the round.
  bankPot(teamId) {
    const t = this.teams.get(teamId);
    if (!t || this.phase !== 'question' || !this.type.canBank || !this.type.canBank(t.mem) || t.answer !== null) return false;
    t.bank = true;
    t.answeredAt = this.clock.now() - this.questionStartedAt;
    if ([...this.teams.values()].every(x => this.done(x))) this.reveal();
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
      return { id, answer: t.answer, answeredAt: t.answeredAt, wager: t.wager || 0, mem: t.mem, bank: t.bank, score: t.score - t.lastPoints, vote: t.vote };
    });
    const base = q.points;
    const timeMs = q.time * 1000;
    let results;
    const isRight = e => (this.overrides.has(e.id) ? this.overrides.get(e.id) : e.answer !== null && !!type.isCorrect && type.isCorrect(e.answer, q));
    if (type.score) {
      results = type.score(entries, q, base, {
        isRight, leaders: this.leaders, scoring: this.round.scoring, ballot: this.ballot, vote: type.vote, actor: this.actor,
        lastQuestion: this.questionIndex + 1 >= this.round.questions.length,
      });
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
      out.set(id, { points: p, correct: results[i].correct, mem: results[i].mem || null, found: results[i].found });
    });
    return out;
  }

  applyPoints() {
    for (const [id, r] of this.computePoints()) {
      const t = this.teams.get(id);
      t.score += r.points - t.lastPoints;
      t.lastPoints = r.points;
      t.correct = r.correct;
      t.memNext = r.mem;
      t.found = r.found;
    }
  }

  reveal() {
    if (this.phase !== 'question') return;
    this.clearTimer();
    if (this.type.vote && this.startVote()) return;
    for (const t of this.teams.values()) t.lastPoints = 0;
    this.applyPoints();
    this.phase = 'reveal';
    this.broadcast();
  }

  // Party rounds: everything the teams made goes on a ballot (shuffled, the same after a reload) and every team votes.
  startVote() {
    const made = [...this.teams.entries()].filter(([, t]) => t.answer !== null).map(([teamId, t]) => ({ teamId, content: t.answer }));
    if (this.type.vote === 'truth') made.push({ teamId: null, content: this.question.answer });
    const enough = this.type.vote === 'truth' ? made.length >= 2 : made.length >= 2 && this.teams.size >= 2;
    if (!enough) return false;
    const order = rounds.permutation(made.length, made.map(m => m.content).join('|') + this.questionIndex);
    this.ballot = order.map((i, k) => ({ id: k, ...made[i] }));
    this.phase = 'vote';
    this.voteStartedAt = this.clock.now();
    this.timer = this.clock.setTimeout(() => this.finishVote(), this.voteTime() * 1000);
    this.broadcast();
    return true;
  }

  voteTime() {
    return this.type.vote === 'match' ? 45 : 30;
  }

  // best / truth: the index of an entry that is not your own. match: for every entry the colour of the team you think wrote it.
  castVote(teamId, raw) {
    const t = this.teams.get(teamId);
    if (!t || this.phase !== 'vote' || t.vote !== null) return false;
    const ballot = this.ballot;
    if (this.type.vote === 'match') {
      if (!Array.isArray(raw) || raw.length !== ballot.length) return false;
      const byColor = new Map([...this.teams.entries()].map(([id, x]) => [x.color, id]));
      t.vote = raw.map((c, i) => (ballot[i].teamId === teamId ? null : byColor.get(c) || null));
    } else {
      if (!Number.isInteger(raw) || !ballot[raw] || ballot[raw].teamId === teamId) return false;
      t.vote = raw;
    }
    if ([...this.teams.values()].every(x => x.vote !== null || !x.connected)) this.finishVote();
    else this.broadcast();
    return true;
  }

  finishVote() {
    if (this.phase !== 'vote') return;
    this.clearTimer();
    for (const t of this.teams.values()) t.lastPoints = 0;
    this.applyPoints();
    this.phase = 'reveal';
    this.broadcast();
  }

  // What the ballot looks like on a screen: an entry is a picture or a text; the authors only come with the reveal.
  publicBallot(teamId) {
    if (!this.ballot) return null;
    const reveal = this.phase === 'reveal';
    return this.ballot.map(b => {
      const out = { content: b.content, image: /^\/media\//.test(b.content) };
      if (teamId !== undefined) out.mine = b.teamId === teamId;
      if (reveal) {
        const author = b.teamId && this.teams.get(b.teamId);
        out.truth = b.teamId === null;
        out.by = author ? { name: author.name, color: author.color } : null;
        out.votes = [...this.teams.values()].filter(x => x.vote === b.id).map(x => ({ name: x.name, color: x.color }));
      }
      return out;
    });
  }

  // The quizmaster overrules a typed answer after the reveal (a spelling the list did not know, a wrong match).
  judge(teamId, correct) {
    const t = this.teams.get(teamId);
    if (!t || this.phase !== 'reveal' || !this.canJudge()) return false;
    this.overrides.set(teamId, !!correct);
    this.applyPoints();
    this.broadcast();
    return true;
  }

  canJudge() {
    return this.kind === 'text' && (!this.type.score || !!this.type.judge);
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
    if (this.phase === 'vote') return Math.max(0, this.voteTime() * 1000 - (this.clock.now() - this.voteStartedAt));
    if (this.phase !== 'question') return 0;
    if (this.buzz) return this.buzz.left;
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
      audio: q.audio || null,
      start: Number(q.start) > 0 ? Number(q.start) : 0,
      end: Number(q.end) > 0 ? Number(q.end) : null,
      effect: type.effect || null,
      steps: rounds.stepsOf(type, q),
      time: q.time,
      points: q.points,
      ...type.publicQ(q),
    };
  }

  common() {
    const q = this.question;
    const showQuestion = q && (this.phase === 'question' || this.phase === 'reveal' || this.phase === 'vote');
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
      wagerMode: this.phase === 'wager' ? (this.type.wager === 'level' ? 'level' : 'bet') : null,
      levelBase: this.phase === 'wager' ? q.points : null,
      remaining: this.remaining(),
      reveal: this.phase === 'reveal' ? this.revealInfo() : null,
      correct: this.phase === 'reveal' ? (this.type.revealQ(q).correct ?? null) : null,
      // Buzzer: who holds the floor; the clock stands still meanwhile.
      buzz: this.buzz ? { name: this.teams.get(this.buzz.teamId).name, color: this.teams.get(this.buzz.teamId).color } : null,
      paused: !!this.buzz,
      vote: this.ballot && (this.phase === 'vote' || this.phase === 'reveal') ? { mode: this.type.vote, time: this.voteTime() } : null,
      actor: this.actor && this.teams.get(this.actor) ? { name: this.teams.get(this.actor).name, color: this.teams.get(this.actor).color } : null,
    };
  }

  revealInfo() {
    const info = this.type.revealQ(this.question);
    if (this.type.crowd) {
      // The answer of the room: the most common one.
      const groups = new Map();
      for (const t of this.teams.values()) if (t.answer) {
        const k = rounds.normalize(t.answer);
        const g = groups.get(k) || { text: t.answer, n: 0 };
        g.n++;
        groups.set(k, g);
      }
      const top = [...groups.values()].sort((a, b) => b.n - a.n)[0];
      info.answerText = top && top.n >= 2 ? top.text : '—';
    }
    if (this.type.multi) info.found = this.type.found([...this.teams.values()].flatMap(t => t.answer || []), this.question);
    return info;
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
        out: this.sitsOut(t), pot: t.mem.pot, streak: t.mem.streak, banked: t.bank || t.mem.banked, buzzOut: t.buzzOut,
        level: this.type && this.type.wager === 'level' ? t.wager : null,
      })),
      answered: this.phase === 'vote' ? teams.filter(t => t.vote !== null).length : teams.filter(t => t.answer !== null || t.bank).length,
      ballot: this.publicBallot(),
      counts: null,
      answers: null,
      ranking: this.phase === 'scoreboard' || this.phase === 'end' || reveal ? this.ranking() : null,
    };
    if (reveal && (kind === 'choice' || kind === 'trueFalse')) {
      const n = kind === 'trueFalse' ? 2 : (this.question.answers || this.question.images).length;
      state.counts = Array.from({ length: n }, (_, i) => teams.filter(t => t.answer === i).length);
    }
    if (reveal && ['text', 'number', 'point', 'order', 'pairs', 'list', 'level', 'buzz'].includes(kind)) {
      state.answers = [...this.teams.entries()].map(([id, t]) => ({
        id, name: t.name, color: t.color, answer: t.answer, correct: t.correct, points: t.lastPoints, wager: t.wager, found: t.found,
      }));
    }
    // Strategy rounds show their round memory: pots, streaks and who is out.
    if (this.type && (this.type.sitsOut || this.type.id === 'hotStreak')) state.board = true;
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
      liveAnswers: this.phase === 'question' && ['text', 'number', 'point', 'list'].includes(this.kind)
        ? [...this.teams.values()].filter(t => t.answer !== null).map(t => ({ name: t.name, color: t.color, answer: t.answer }))
        : null,
      canJudge: this.phase === 'reveal' && this.canJudge(),
      canJudgeBuzz: this.phase === 'question' && !!this.buzz,
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
    // Pick your level: every team gets the question of the level it chose.
    if (state.question && this.type.teamQ) state.question = { ...state.question, ...this.type.teamQ(this.question, t) };
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
      out: this.sitsOut(t),
      pot: t.mem.pot,
      streak: t.mem.streak,
      canBank: this.phase === 'question' && !!this.type.canBank && this.type.canBank(t.mem) && t.answer === null && !t.bank,
      banked: t.bank,
      buzzOut: t.buzzOut,
      buzzMine: !!this.buzz && this.buzz.teamId === teamId,
      found: this.phase === 'reveal' ? t.found : undefined,
      ballot: this.publicBallot(teamId),
      voted: t.vote !== null,
      isActor: this.actor === teamId,
      secret: this.actor === teamId && this.phase === 'question' ? this.question.answer : null,
      // Who's who: the teams you can choose from (by colour, never by id).
      teamsToMatch: this.phase === 'vote' && this.type.vote === 'match' ? [...this.teams.entries()].filter(([id]) => id !== teamId).map(([, x]) => ({ name: x.name, color: x.color })) : null,
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
