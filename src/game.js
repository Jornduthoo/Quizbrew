// The live quiz. One game runs at a time on a host.
// Phases: idle -> lobby -> roundIntro -> [wager] -> question -> [vote] -> reveal -> (question ...) -> scoreboard -> (roundIntro ...) -> end
// The quizmaster drives the pace with next(); a question also reveals itself when time is up or every team answered.
// What a question looks like and how it scores comes from its round type (rounds.js).
// Errors are returned as i18n keys, never as screen text.

const { TEAM_COLORS, MAX_TEAMS } = require('./teams');
const rounds = require('./rounds');
const tiebreak = require('./tiebreak');
const i18n = require('./i18n');

const MAX_NAME = 20;
const MAX_UNDO = 40;
const EXTRA_TIME = 10000; // the quizmaster's +10 s
// A break: the quizmaster pauses between questions; the screen shows a countdown and the standings.
const BREAK_PHASES = ['lobby', 'roundIntro', 'reveal', 'scoreboard'];
const BREAK_STEP = 5 * 60000;
const RESTORE_MIN = 10000; // a question that comes back (undo, after a crash) gets at least 10 seconds
const SHRINK_STEP = 5000; // shrinking options twist: one wrong answer disappears every 5 seconds

// What a round remembers about a team between questions (streak, pot, out of the round ...).
const freshMem = () => ({ streak: 0, pot: 0, out: false, banked: false });

// While the phone can answer, leaving the quiz page is reported to the quizmaster.
const ANSWER_PHASES = new Set(['question', 'wager', 'vote']);
// Vote rounds with more than 8 entries: every phone gets its own short list (6 to pick the best from, 3 answers to match).
const SHORTLIST_BEST = 6;
const SHORTLIST_MATCH = 3;
const MATCH_SUSPECTS = 4; // per answer to match: the author and 3 other teams
// A ballot entry belongs to a team (bluffs can have several authors that wrote the same thing).
const owns = (b, teamId) => b.teamId === teamId || (Array.isArray(b.teams) && b.teams.includes(teamId));

class Game {
  // emit(target, event, payload): target is 'host', 'screen' or a team socket id.
  // clock: { now, setTimeout, clearTimeout } so tests can drive time.
  // onChange(): called after every change, so the app can save the game (resume after a crash).
  constructor({ emit = () => {}, clock = { now: Date.now, setTimeout, clearTimeout }, onChange = () => {} } = {}) {
    this.emit = emit;
    this.clock = clock;
    this.onChange = onChange;
    this.resumable = null; // a saved game from before a restart: { title, round, teams }
    this.teams = new Map(); // teamId -> team (see join)
    this.language = 'en'; // the language of the evening (for the built-in tie-break questions)
    this.reset();
  }

  reset() {
    if (this.timer) this.clock.clearTimeout(this.timer);
    this.timer = null;
    this.quiz = null;
    this.breakUntil = null;
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
    this.resetRoundState();
    this.teams.clear();
    this.previousRanks = {};
    this.history = []; // snapshots before every step, for the quizmaster's undo
    this.log = new Map(); // 'round:question' -> how every team did (awards, statistics)
    this.rankHistory = []; // the ranks at every scoreboard
  }

  // Finales and clock rounds: who plays, whose turn it is, how much time every team has left.
  resetRoundState() {
    this.finalists = null;
    this.picker = null;
    this.resolved = null;
    this.clocks = new Map();
    this.turnTeam = null;
    this.nextTurn = null;
    this.duelWinner = null;
    this.roundOver = false;
  }

  load(quiz) {
    const clean = validateQuiz(quiz);
    this.reset();
    this.resumable = null;
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

  // A round where a team picks the category plays the question of that category.
  get question() {
    return this.resolved || (this.round && this.round.questions[this.questionIndex]);
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
    // A known team: the same phone coming back, or a teammate joining on another phone.
    if (existing) {
      existing.phones.add(socketId);
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
    if (teams.length >= MAX_TEAMS) return { error: 'error.full' };
    // Every colour has its own team, until all of them are taken: then colours are shared.
    if (teams.some(t => t.color === color) && this.freeColors().length) return { error: 'error.colorTaken' };
    this.teams.set(teamId, {
      name: clean, color, score: 0, phones: new Set([socketId]), connected: true,
      answer: null, answeredAt: 0, correct: false, lastPoints: 0, away: false, blocked: false, wager: null,
      jokerRound: -1, mem: freshMem(), memNext: null, bank: false, buzzOut: false,
      id: teamId, lifelineRound: -1, fifty: null, vote: null, shieldRound: -1, spyKey: null, fiftyKey: null,
    });
    this.broadcast();
    return { ok: true, name: clean, color };
  }

  // A team that plays on paper: no phone, the quizmaster types in its points per round from the answer sheet.
  addPaperTeam(name) {
    if (this.phase === 'idle' || this.phase === 'end') return { error: 'error.noQuiz' };
    const clean = String(name || '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME);
    if (!clean) return { error: 'error.nameEmpty' };
    const teams = [...this.teams.values()];
    if (teams.some(t => t.name.toLowerCase() === clean.toLowerCase())) return { error: 'error.nameTaken' };
    if (teams.length >= MAX_TEAMS) return { error: 'error.full' };
    const color = TEAM_COLORS.find(c => !teams.some(t => t.color === c)) || TEAM_COLORS[teams.length % TEAM_COLORS.length];
    let id;
    do id = `paper-${Math.random().toString(36).slice(2, 10)}`; while (this.teams.has(id));
    this.teams.set(id, {
      name: clean, color, score: 0, phones: new Set(), connected: false, paper: {},
      answer: null, answeredAt: 0, correct: false, lastPoints: 0, away: false, blocked: false, wager: null,
      jokerRound: -1, mem: freshMem(), memNext: null, bank: false, buzzOut: false,
      id, lifelineRound: -1, fifty: null, vote: null,
    });
    this.broadcast();
    return { ok: true, id, name: clean, color };
  }

  // The round whose paper points the quizmaster types in now (the last regular round during the tie-break).
  paperRound() {
    if (!this.round || this.roundIndex < 0) return -1;
    return this.round.tiebreak ? this.regularRounds() - 1 : this.roundIndex;
  }

  // The points of a paper team for one round; typing them again replaces the earlier number.
  setPaperPoints(teamId, round, points) {
    const t = this.teams.get(teamId);
    const r = Math.trunc(Number(round));
    const p = Math.max(-999, Math.min(999, Math.trunc(Number(points)) || 0));
    if (!t || !t.paper || !this.quiz || !(r >= 0 && r < this.quiz.rounds.length)) return false;
    t.score += p - (t.paper[r] || 0);
    t.paper = { ...t.paper, [r]: p };
    this.broadcast();
    return true;
  }

  freeColors() {
    const used = new Set([...this.teams.values()].map(t => t.color));
    return TEAM_COLORS.filter(c => !used.has(c));
  }

  disconnect(socketId) {
    for (const t of this.teams.values()) {
      t.phones.delete(socketId);
      t.connected = t.phones.size > 0;
    }
    this.broadcast();
  }

  // A team photo (a selfie on a phone), stored as a media url. Shown next to the team name everywhere.
  setPhoto(teamId, url) {
    const t = this.teams.get(teamId);
    if (!t || typeof url !== 'string') return false;
    t.photo = url;
    this.broadcast();
    return true;
  }

  kick(teamId) {
    const t = this.teams.get(teamId);
    if (!t) return;
    this.teams.delete(teamId);
    this.emit(`team:${teamId}`, 'kicked');
    this.broadcast();
  }

  // The quizmaster gives or takes points by hand (a dispute, a bonus, a penalty). The room sees it on the big screen.
  adjustScore(teamId, delta) {
    const t = this.teams.get(teamId);
    if (!t || !Number.isFinite(delta)) return false;
    const d = Math.max(-1000, Math.min(1000, Math.trunc(delta)));
    if (!d) return false;
    t.score += d;
    this.emit('screen', 'alert', { kind: 'score', name: t.name, color: t.color, delta: d });
    this.broadcast();
    return true;
  }

  // One button for the quizmaster: always moves to the next logical step.
  next() {
    if (this.phase === 'lobby' && this.teams.size === 0) return;
    if (this.breakUntil) return this.endBreak();
    if (this.phase !== 'idle' && this.phase !== 'end') {
      this.history.push(this.snapshot());
      if (this.history.length > MAX_UNDO) this.history.shift();
    }
    switch (this.phase) {
      case 'lobby':
        if (this.teams.size === 0) return;
        return this.startRound(0);
      case 'roundIntro':
        return this.openQuestion(0);
      case 'wager':
        return this.startQuestion();
      case 'question':
        // Clock rounds: moving on without a verdict counts as a pass (wrong).
        if (this.type.turns) return this.judgeTurn(false);
        return this.reveal();
      case 'vote':
        return this.finishVote();
      case 'reveal':
        // After the tie-break the winner is known: straight to the podium.
        if (this.round.tiebreak) return this.finish(true);
        if (this.roundOver) return this.showScoreboard();
        if (this.questionIndex + 1 < this.round.questions.length) return this.openQuestion(this.questionIndex + 1);
        return this.showScoreboard();
      case 'scoreboard':
        if (this.roundIndex + 1 < this.regularRounds()) return this.startRound(this.roundIndex + 1);
        if (this.awards().length) {
          this.phase = 'awards';
          return this.broadcast();
        }
        return this.finish();
      case 'awards':
        return this.finish();
      default:
    }
  }

  // The quiz without the tie-break that may have been added at the end.
  regularRounds() {
    return this.quiz.rounds.filter(r => !r.tiebreak).length;
  }

  // The end of the quiz. Teams that share a place in the top three first play one tie-break question.
  finish(afterTiebreak = false) {
    const ties = afterTiebreak || this.quiz.tiebreak === false ? [] : tiebreak.podiumTies(this.ranking());
    if (!ties.length) {
      this.phase = 'end';
      return this.broadcast();
    }
    const q = tiebreak.question(this.quiz, i18n.dictionary(this.language));
    const round = rounds.withDefaults({ type: 'closest', title: '', tiebreak: { teams: ties.flat() }, twists: [], questions: [q] });
    // An undo may come back here: the tie-break round is replaced, never added twice.
    this.quiz.rounds = [...this.quiz.rounds.filter(r => !r.tiebreak), round];
    return this.startRound(this.quiz.rounds.length - 1);
  }

  startRound(index) {
    this.roundIndex = index;
    this.questionIndex = -1;
    this.phase = 'roundIntro';
    for (const t of this.teams.values()) { t.mem = freshMem(); t.memNext = null; }
    this.resetRoundState();
    const type = this.type;
    // Finales: the top two play.
    if (type.finale) this.finalists = this.ranking().slice(0, 2).map(r => r.id);
    // Tie-break: only the tied teams answer.
    if (this.round.tiebreak) this.finalists = this.round.tiebreak.teams.filter(id => this.teams.has(id));
    if (type.turns) {
      const players = type.turns === 'duel' ? this.finalists : [...this.teams.keys()];
      for (const id of players) this.clocks.set(id, type.clock * 1000);
      // In a duel the team in second place starts.
      this.nextTurn = players[players.length - 1] || null;
    }
    // Underdog twist: whoever is last when the round starts gets a boost.
    const ranking = this.ranking();
    const last = ranking.length > 1 ? ranking[ranking.length - 1].score : null;
    this.underdogs = new Set(last === null || ranking[0].score === last ? [] : ranking.filter(r => r.score === last).map(r => r.id));
    this.broadcast();
  }

  // A team plays its one joker of the evening on the round that is about to start: points x2.
  playJoker(teamId) {
    const t = this.teams.get(teamId);
    if (!t || !this.quiz.jokers || this.phase !== 'roundIntro' || t.jokerRound !== -1 || this.round.tiebreak) return false;
    t.jokerRound = this.roundIndex;
    this.broadcast();
    return true;
  }

  // Power-ups (when the quiz has them): every team may use each one once per evening.
  //   shield - played at the start of a round: no minus points in that round
  //   spy    - during a choice question: see live how the other teams answer
  //   fifty  - during a choice question: two wrong answers disappear on your phone
  hasPowers() { return !!(this.quiz && this.quiz.powerUps); }
  qKey() { return `${this.roundIndex}:${this.questionIndex}`; }
  canPower(t, name) {
    if (!t || t.paper || !this.hasPowers() || !this.round || this.round.tiebreak) return false;
    if (name === 'shield') return this.phase === 'roundIntro' && !(t.shieldRound >= 0);
    const open = this.phase === 'question' && t.answer === null && !this.sitsOut(t) && !t.blocked && !this.hasTwist('blackout') && !this.type.turns;
    if (name === 'spy') return open && ['choice', 'trueFalse'].includes(this.kind) && !t.spyKey;
    if (name === 'fifty') return open && this.kind === 'choice' && (this.question.answers || []).length > 2 && !t.fiftyKey && !t.fifty;
    return false;
  }
  usePower(teamId, name) {
    const t = this.teams.get(teamId);
    if (!this.canPower(t, name)) return false;
    if (name === 'shield') t.shieldRound = this.roundIndex;
    if (name === 'spy') t.spyKey = this.qKey();
    if (name === 'fifty') {
      const q = this.question;
      const gone = this.hiddenFor(t);
      t.fifty = rounds.permutation(q.answers.length, q.question + '|fifty').filter(i => i !== q.correct && !gone.includes(i)).slice(0, Math.max(1, q.answers.length - 2 - gone.length));
      t.fiftyKey = this.qKey();
    }
    this.broadcast();
    return true;
  }
  // The spy: how many other teams picked each answer so far.
  spyCounts(t) {
    if (!t || t.spyKey !== this.qKey() || this.phase !== 'question') return null;
    const n = this.kind === 'trueFalse' ? 2 : (this.question.answers || this.question.images || []).length;
    const counts = Array.from({ length: n }, () => 0);
    for (const x of this.teams.values()) if (x !== t && Number.isInteger(x.answer) && x.answer >= 0 && x.answer < n) counts[x.answer]++;
    return counts;
  }

  openQuestion(index) {
    this.questionIndex = index;
    this.resolved = null;
    this.overrides = new Map();
    this.buzz = null;
    this.ballot = null;
    // Act it out: the teams take turns, in the order they joined.
    const ids = [...this.teams.keys()];
    this.actor = this.type.actor && ids.length ? ids[(this.roundIndex + this.questionIndex) % ids.length] : null;
    // Your pick: the leading team chooses the category for the others.
    this.picker = this.type.wager === 'pick' && ids.length ? this.ranking()[0].id : null;
    if (this.type.turns) {
      this.turnTeam = this.whoseTurn();
      this.duelWinner = null;
      if (!this.turnTeam) { this.roundOver = true; return this.showScoreboard(); }
    }
    const top = Math.max(...[...this.teams.values()].map(t => t.score));
    this.leaders = top > 0 ? [...this.teams.entries()].filter(([, t]) => t.score === top).map(([id]) => id) : [];
    for (const t of this.teams.values()) {
      if (t.memNext) { t.mem = t.memNext; t.memNext = null; }
      t.bank = false;
      t.buzzOut = false;
      t.vote = null;
      t.shortlist = null;
      t.suspects = null;
      t.answer = null;
      t.answeredAt = 0;
      t.correct = false;
      t.lastPoints = 0;
      t.away = false;
      t.blocked = false;
      t.wager = null;
      t.fifty = null;
    }
    this.clearTimer();
    if (this.type.wager) {
      this.phase = 'wager';
      return this.broadcast();
    }
    this.startQuestion();
  }

  // Clock rounds: the next team with time left (in join order), or in a duel the team the last answer passed it to.
  whoseTurn() {
    const alive = id => this.teams.has(id) && (this.clocks.get(id) || 0) > 0;
    if (this.type.turns === 'duel') return alive(this.nextTurn) ? this.nextTurn : null;
    const ids = [...this.teams.keys()];
    const from = ids.indexOf(this.turnTeam) + 1;
    for (let k = 0; k < ids.length; k++) {
      const id = ids[(from + k) % ids.length];
      if (alive(id)) return id;
    }
    return null;
  }

  // Who may bet or pick in the wager step.
  canWager(teamId) {
    const mode = this.type.wager;
    if (mode === 'pick') return teamId === this.picker;
    if (mode === 'predict') return !(this.finalists || []).includes(teamId);
    return true;
  }

  maxWager(t) {
    if (this.type.wager === 'level') return 2;
    if (this.type.wager === 'pick') return this.question.options.length - 1;
    if (this.type.wager === 'predict') return 1;
    return Math.max(t.score, this.question.points);
  }

  // Out of this round (last team standing) or already banked (push your luck).
  // Also: out after a mistake (sudden death), not a finalist, the team that picked, not your turn on the clock.
  sitsOut(t) {
    const type = this.type;
    if (!type) return false;
    if (type.sitsOut && type.sitsOut(t.mem)) return true;
    if (this.hasTwist('suddenDeath') && t.mem.out) return true;
    if (this.finalists && !this.finalists.includes(t.id)) return true;
    if (this.picker && this.picker === t.id && this.phase !== 'wager') return true;
    if (type.turns && t.id !== this.turnTeam) return true;
    return false;
  }

  done(t) {
    return t.answer !== null || t.bank || t.blocked || !t.connected || this.sitsOut(t) || (!!this.actor && this.teams.get(this.actor) === t);
  }

  setWager(teamId, amount) {
    const t = this.teams.get(teamId);
    if (!t || this.phase !== 'wager' || !Number.isFinite(amount) || !this.canWager(teamId)) return false;
    t.wager = Math.max(0, Math.min(this.maxWager(t), Math.round(amount)));
    this.broadcast();
    return true;
  }

  startQuestion() {
    const mode = this.type.wager;
    if (mode === true || mode === 'level') for (const t of this.teams.values()) if (t.wager === null) t.wager = 0;
    if (mode === 'pick') {
      const p = this.teams.get(this.picker);
      this.resolved = this.type.resolve(this.round.questions[this.questionIndex], p ? p.wager : 0);
    }
    this.phase = 'question';
    this.questionStartedAt = this.clock.now();
    this.clearTimer();
    if (this.type.turns) {
      // Only the clock of the team whose turn it is runs.
      this.timer = this.clock.setTimeout(() => this.turnTimeout(), this.clocks.get(this.turnTeam));
    } else {
      this.timer = this.clock.setTimeout(() => this.reveal(), this.question.time * 1000);
    }
    if (this.shrinks()) this.scheduleShrink();
    this.broadcast();
  }

  // Shrinking options twist: every few seconds one wrong answer disappears (the same ones after a reload).
  shrinks() {
    return this.hasTwist('shrinkingOptions') && this.kind === 'choice' && (this.question.answers || []).length > 2;
  }

  shrinkOrder() {
    const q = this.question;
    const n = q.answers.length;
    return rounds.permutation(n, q.question + '|shrink').filter(i => i !== q.correct).slice(0, n - 2);
  }

  goneAt(ms) {
    if (!this.shrinks()) return [];
    const order = this.shrinkOrder();
    return order.slice(0, Math.min(order.length, Math.floor(ms / SHRINK_STEP)));
  }

  scheduleShrink() {
    const elapsed = this.clock.now() - this.questionStartedAt;
    if (this.goneAt(elapsed).length >= this.shrinkOrder().length) return;
    const wait = SHRINK_STEP - (elapsed % SHRINK_STEP);
    this.tickTimer = this.clock.setTimeout(() => {
      this.tickTimer = null;
      if (this.phase !== 'question') return;
      this.broadcast();
      this.scheduleShrink();
    }, wait);
  }

  // Answers a team can no longer pick: gone with the shrinking twist, or hidden by its own 50/50.
  hiddenFor(t) {
    if (this.phase !== 'question' || this.kind !== 'choice') return [];
    const gone = this.goneAt(this.clock.now() - this.questionStartedAt);
    return [...new Set([...gone, ...((t && t.fifty) || [])])];
  }

  // Lifeline twist: once per round a team may hide two wrong answers on its own phone.
  canLifeline(t) {
    return !!t && this.hasTwist('lifeline') && this.phase === 'question' && this.kind === 'choice' && (this.question.answers || []).length > 2
      && t.lifelineRound !== this.roundIndex && t.answer === null && !this.sitsOut(t) && !t.blocked;
  }

  useLifeline(teamId) {
    const t = this.teams.get(teamId);
    if (!this.canLifeline(t)) return false;
    const q = this.question;
    const n = q.answers.length;
    const gone = this.hiddenFor(t);
    t.fifty = rounds.permutation(n, q.question + '|fifty').filter(i => i !== q.correct && !gone.includes(i)).slice(0, Math.max(1, n - 2 - gone.length));
    t.lifelineRound = this.roundIndex;
    // The room sees it happen: a lifebuoy on the big screen, a line for the quizmaster.
    const notice = { kind: 'lifeline', name: t.name, color: t.color };
    this.emit('host', 'alert', notice);
    this.emit('screen', 'alert', notice);
    this.broadcast();
    return true;
  }

  // Clock rounds: the quizmaster says right or wrong; the clock of the team stops.
  judgeTurn(right) {
    const id = this.turnTeam;
    const t = this.teams.get(id);
    if (!t || t.answer !== null) return false;
    const left = Math.max(0, this.clocks.get(id) - (this.clock.now() - this.questionStartedAt));
    t.answer = right ? 'right' : 'wrong';
    t.answeredAt = this.clock.now() - this.questionStartedAt;
    this.endTurn(id, left + (right && this.type.turns === 'bank' ? this.question.time * 1000 : 0), right);
    return true;
  }

  turnTimeout() {
    const t = this.teams.get(this.turnTeam);
    if (t && t.answer === null) t.answer = 'wrong';
    this.endTurn(this.turnTeam, 0, false);
  }

  endTurn(id, left, right) {
    this.clocks.set(id, left);
    const alive = [...this.clocks.entries()].filter(([, ms]) => ms > 0).map(([x]) => x);
    if (this.type.turns === 'duel') {
      const other = this.finalists.find(x => x !== id) || null;
      // Right: the other team gets the next question. Wrong: you keep the turn and your clock keeps running.
      this.nextTurn = right && other ? other : id;
      const last = this.questionIndex + 1 >= this.round.questions.length;
      if (left <= 0) this.duelWinner = other;
      else if (last) {
        const [a, b] = this.finalists.map(x => this.clocks.get(x) || 0);
        this.duelWinner = a === b ? null : a > b ? this.finalists[0] : this.finalists[1];
      }
      if (left <= 0 || last) this.roundOver = true;
    } else if (!alive.length) this.roundOver = true;
    this.reveal();
  }

  answer(teamId, raw) {
    const t = this.teams.get(teamId);
    if (!t || this.phase !== 'question' || t.blocked || t.bank || this.sitsOut(t) || teamId === this.actor) return false;
    if (t.answer !== null && !this.type.multi) return false;
    if (this.kind === 'buzz') return this.buzzIn(teamId, t);
    const value = this.type.parse(raw, this.question, t);
    if (value === undefined) return false;
    if (this.kind === 'choice' && this.hiddenFor(t).includes(value)) return false;
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
    if (this.phase === 'question' && this.type.turns) return this.judgeTurn(right);
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

  // The phone left the page (switched app, opened a browser tab, pulled down the notifications) while it could answer.
  // The quizmaster and the big screen get a notice right away; with the lockdown twist the answer is blocked.
  // A phone that could not stay awake and went dark after a long while untouched says so: the quizmaster gets a
  // quiet note, but no flag, no count and no blocked answer. That was the screen saver, not a peek at the internet.
  leftPage(teamId, { sleep = false } = {}) {
    const t = this.teams.get(teamId);
    if (!t || !ANSWER_PHASES.has(this.phase) || t.away) return false;
    if (sleep === true) {
      this.emit('host', 'alert', { kind: 'sleep', name: t.name, color: t.color });
      return true;
    }
    t.away = true;
    t.awayCount = (t.awayCount || 0) + 1;
    if (this.phase === 'question' && this.hasTwist('lockdown')) {
      t.blocked = true;
      t.answer = null;
    }
    const notice = { kind: 'left', name: t.name, color: t.color, count: t.awayCount, blocked: t.blocked };
    this.emit('host', 'alert', notice);
    this.emit('screen', 'alert', notice);
    this.broadcast();
    return true;
  }

  // Back on the quiz page after leaving it: the quizmaster sees for how long.
  backOnPage(teamId, ms) {
    const t = this.teams.get(teamId);
    if (!t || !t.away) return false;
    const seconds = Math.max(1, Math.round(Math.min(Number(ms) || 0, 3600000) / 1000));
    this.emit('host', 'alert', { kind: 'back', name: t.name, color: t.color, seconds });
    return true;
  }

  // Points for every team on the current question. Pure: does not touch the scores.
  computePoints() {
    const q = this.question;
    const type = this.type;
    const ids = [...this.teams.keys()];
    const entries = ids.map(id => {
      const t = this.teams.get(id);
      return { id, answer: t.answer, answeredAt: t.answeredAt, wager: t.wager || 0, pick: t.wager, mem: t.mem, bank: t.bank, score: t.score - t.lastPoints, vote: t.vote };
    });
    const base = q.points;
    const timeMs = q.time * 1000;
    let results;
    const isRight = e => (this.overrides.has(e.id) ? this.overrides.get(e.id) : e.answer !== null && !!type.isCorrect && type.isCorrect(e.answer, q));
    if (type.score) {
      results = type.score(entries, q, base, {
        isRight, leaders: this.leaders, scoring: this.round.scoring, ballot: this.ballot, vote: type.vote, actor: this.actor,
        finalists: this.finalists, turn: this.turnTeam, duelWinner: this.duelWinner,
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
      let mem = results[i].mem || null;
      // Shrinking options: the later you answer, the fewer answers were left and the fewer points you get.
      if (p > 0 && this.shrinks()) {
        const n = q.answers.length;
        p = Math.max(1, Math.round(p * (n - this.goneAt(t.answeredAt).length) / n));
      }
      // Sudden death: the first mistake ends the round for this team.
      if (this.hasTwist('suddenDeath') && !type.vote && !type.turns && !results[i].correct && !this.sitsOut(t)) mem = { ...(mem || t.mem), out: true };
      if (this.hasTwist('double')) p *= 2;
      if (t.jokerRound === this.roundIndex) p *= 2;
      if (t.shieldRound === this.roundIndex && p < 0) p = 0;
      if (this.hasTwist('underdog') && this.underdogs.has(id) && p > 0) p = Math.round(p * 1.5);
      out.set(id, { points: p, correct: results[i].correct, mem, found: results[i].found });
    });
    return out;
  }

  applyPoints() {
    // Tie-break: no points, the distance to the answer decides the order of the tied teams.
    if (this.round.tiebreak) {
      const q = this.question;
      for (const t of this.teams.values()) {
        if (!this.round.tiebreak.teams.includes(t.id)) continue;
        t.tb = t.answer === null || t.answer === undefined ? Number.MAX_SAFE_INTEGER : Math.abs(t.answer - q.answer);
      }
      const best = Math.min(...this.round.tiebreak.teams.map(id => (this.teams.get(id) ? this.teams.get(id).tb : Infinity)));
      for (const t of this.teams.values()) {
        t.lastPoints = 0;
        t.correct = this.round.tiebreak.teams.includes(t.id) && t.tb === best && best !== Number.MAX_SAFE_INTEGER;
        t.memNext = null;
      }
      return;
    }
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
    if (this.type.vote === 'best') this.shortlists(8, SHORTLIST_BEST);
    else if (this.type.vote === 'match') this.shortlists(8, SHORTLIST_MATCH);
    this.timer = this.clock.setTimeout(() => this.finishVote(), this.voteTime() * 1000);
    this.broadcast();
    return true;
  }

  // Many teams: a phone cannot list 40 drawings or captions. Above `from` entries every team gets its own short
  // list of `size` entries (never its own), dealt round robin from the shuffled ballot so every entry lands on
  // about as many phones. Who's who also gets a few teams to pick from per answer: the author and decoys.
  shortlists(from, size) {
    const teams = [...this.teams.entries()];
    for (const [, t] of teams) { t.shortlist = null; t.suspects = null; }
    if (this.ballot.length <= from) return;
    const order = rounds.permutation(teams.length, 'deal' + this.questionIndex + '|' + this.roundIndex);
    const n = this.ballot.length;
    const shown = this.ballot.map(() => 0);
    let at = 0;
    for (const i of order) {
      const [teamId, t] = teams[i];
      // The entries on the fewest phones so far first; equal ones in turn from where the last team stopped.
      const pick = this.ballot.filter(b => !owns(b, teamId))
        .sort((x, y) => shown[x.id] - shown[y.id] || (x.id - at + n) % n - (y.id - at + n) % n)
        .slice(0, size).map(b => b.id);
      for (const id of pick) shown[id]++;
      at = (at + size) % n;
      t.shortlist = pick.sort((a, b) => a - b);
      if (this.type.vote === 'match') t.suspects = this.suspectsFor(teamId, t.shortlist);
    }
  }

  // Who's who with many teams: per answer the real author and up to 3 other teams (never yourself), shuffled.
  suspectsFor(teamId, ids) {
    const others = [...this.teams.keys()].filter(id => id !== teamId);
    const out = {};
    for (const id of ids) {
      const author = this.ballot[id].teamId;
      const pool = others.filter(x => x !== author);
      const decoys = rounds.permutation(pool.length, teamId + '|' + id).slice(0, MATCH_SUSPECTS - 1).map(k => pool[k]);
      const all = [author, ...decoys];
      out[id] = rounds.permutation(all.length, id + '|' + teamId).map(k => all[k]);
    }
    return out;
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
      const byColor = new Map([...this.teams.entries()].map(([id, x]) => [x.color, id]));
      if (t.shortlist) {
        // A short list: per listed answer (in list order) the place of the chosen team among its suspects.
        // Not by colour: above 24 teams colours are shared.
        if (!Array.isArray(raw) || raw.length !== t.shortlist.length) return false;
        const vote = ballot.map(() => null);
        t.shortlist.forEach((id, k) => { vote[id] = Number.isInteger(raw[k]) ? t.suspects[id][raw[k]] || null : null; });
        t.vote = vote;
      } else {
        if (!Array.isArray(raw) || raw.length !== ballot.length) return false;
        t.vote = raw.map((c, i) => (ballot[i].teamId === teamId ? null : byColor.get(c) || null));
      }
    } else {
      if (!Number.isInteger(raw) || !ballot[raw] || owns(ballot[raw], teamId)) return false;
      if (t.shortlist && !t.shortlist.includes(raw)) return false;
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
    const t = teamId !== undefined ? this.teams.get(teamId) : null;
    // While voting, a phone with a short list only gets its own entries.
    const list = t && t.shortlist && this.phase === 'vote' ? this.ballot.filter(b => t.shortlist.includes(b.id)) : this.ballot;
    const match = this.type && this.type.vote === 'match';
    return list.map(b => {
      const out = { id: b.id, content: b.content, image: /^\/media\//.test(b.content) };
      if (teamId !== undefined) out.mine = owns(b, teamId);
      if (t && t.suspects && t.suspects[b.id] && this.phase === 'vote') {
        out.suspects = t.suspects[b.id].map((id, key) => ({ key, x: this.teams.get(id) })).filter(s => s.x).map(({ key, x }) => ({ key, name: x.name, color: x.color }));
      }
      if (reveal) {
        const author = b.teamId && this.teams.get(b.teamId);
        out.truth = b.teamId === null;
        out.by = author ? { name: author.name, color: author.color } : null;
        // Who's who: the teams that guessed the author right.
        const voted = match ? x => Array.isArray(x.vote) && b.teamId && x.vote[b.id] === b.teamId : x => x.vote === b.id;
        out.votes = [...this.teams.values()].filter(voted).map(x => ({ name: x.name, color: x.color }));
      }
      return out;
    });
  }

  // The quizmaster overrules a typed answer after the reveal (a spelling the list did not know, a wrong match).
  judge(teamId, correct) {
    const t = this.teams.get(teamId);
    if (!t || this.phase !== 'reveal' || !this.canJudge()) return false;
    const was = t.correct;
    this.overrides.set(teamId, !!correct);
    this.applyPoints();
    if (was !== t.correct) this.emit('screen', 'alert', { kind: 'judge', name: t.name, color: t.color, correct: t.correct });
    this.broadcast();
    return true;
  }

  // After the reveal the quizmaster may still count an answer as right or wrong.
  canJudge() {
    if (this.type.vote || this.type.turns) return false;
    if (this.kind === 'text') return !this.type.score || !!this.type.judge;
    return !this.type.score && ['choice', 'trueFalse', 'number'].includes(this.kind);
  }

  showScoreboard() {
    this.phase = 'scoreboard';
    this.rankHistory[this.roundIndex] = Object.fromEntries(this.ranking().map(r => [r.id, r.rank]));
    this.broadcast();
    // Remember the ranks so the next scoreboard can show who moved up.
    this.previousRanks = Object.fromEntries(this.ranking().map(r => [r.id, r.rank]));
  }

  stop() {
    this.reset();
    this.broadcast();
  }

  // Everything the game needs to pick up again, as plain JSON (no quiz, no phones, no timers).
  snapshot() {
    const teams = [...this.teams].map(([id, t]) => {
      const { phones, connected, ...rest } = t;
      return [id, JSON.parse(JSON.stringify(rest))];
    });
    return {
      phase: this.phase, roundIndex: this.roundIndex, questionIndex: this.questionIndex,
      remaining: this.remaining(),
      overrides: [...this.overrides], underdogs: [...this.underdogs], leaders: this.leaders,
      buzz: this.buzz, ballot: this.ballot, actor: this.actor,
      finalists: this.finalists, picker: this.picker, resolved: this.resolved, clocks: [...this.clocks],
      turnTeam: this.turnTeam, nextTurn: this.nextTurn, duelWinner: this.duelWinner, roundOver: this.roundOver,
      previousRanks: this.previousRanks, teams,
      log: [...this.log], rankHistory: this.rankHistory,
    };
  }

  // Back to a snapshot: the quizmaster's undo, or a saved game after a restart.
  // Phones that are connected now stay connected; a running question gets its time back (at least 10 s).
  restore(snap) {
    const s = JSON.parse(JSON.stringify(snap));
    this.clearTimer();
    Object.assign(this, {
      phase: s.phase, roundIndex: s.roundIndex, questionIndex: s.questionIndex,
      overrides: new Map(s.overrides), underdogs: new Set(s.underdogs), leaders: s.leaders,
      buzz: s.buzz, ballot: s.ballot, actor: s.actor,
      finalists: s.finalists, picker: s.picker, resolved: s.resolved, clocks: new Map(s.clocks),
      turnTeam: s.turnTeam, nextTurn: s.nextTurn, duelWinner: s.duelWinner, roundOver: s.roundOver,
      previousRanks: s.previousRanks || {},
      log: new Map(s.log || []), rankHistory: s.rankHistory || [],
    });
    const before = this.teams;
    this.teams = new Map(s.teams.map(([id, t]) => {
      const phones = before.has(id) ? before.get(id).phones : new Set();
      return [id, { ...t, phones, connected: phones.size > 0 }];
    }));
    const left = Math.max(s.remaining || 0, RESTORE_MIN);
    const now = this.clock.now();
    if (this.phase === 'question') {
      if (this.type.turns) {
        this.questionStartedAt = now;
        this.timer = this.clock.setTimeout(() => this.turnTimeout(), this.clocks.get(this.turnTeam));
      } else {
        const full = this.question.time * 1000;
        this.questionStartedAt = now - Math.max(0, full - left);
        if (this.buzz) this.buzz.left = Math.max(this.buzz.left, RESTORE_MIN);
        else this.timer = this.clock.setTimeout(() => this.reveal(), Math.min(left, full));
        if (this.shrinks()) this.scheduleShrink();
      }
    } else if (this.phase === 'vote') {
      this.voteStartedAt = now - Math.max(0, this.voteTime() * 1000 - left);
      this.timer = this.clock.setTimeout(() => this.finishVote(), Math.min(left, this.voteTime() * 1000));
    }
    this.broadcast();
  }

  // The quizmaster's undo: one step back.
  back() {
    if (this.breakUntil) return this.endBreak();
    const snap = this.history.pop();
    if (!snap) return false;
    this.restore(snap);
    return true;
  }

  // A break of 10 minutes, or 5 more on a running one. Only between questions, never while a clock runs.
  startBreak() {
    const now = this.clock.now();
    if (this.breakUntil) this.breakUntil = Math.max(this.breakUntil, now) + BREAK_STEP;
    else if (BREAK_PHASES.includes(this.phase)) this.breakUntil = now + 2 * BREAK_STEP;
    else return false;
    this.broadcast();
    return true;
  }

  endBreak() {
    if (!this.breakUntil) return false;
    this.breakUntil = null;
    this.broadcast();
    return true;
  }

  breakInfo() {
    if (!this.breakUntil) return null;
    return {
      left: Math.max(0, this.breakUntil - this.clock.now()),
      standings: this.phase === 'lobby' ? [] : this.ranking().map(r => ({ name: r.name, color: r.color, photo: r.photo, score: r.score, rank: r.rank })),
    };
  }

  // The quizmaster's +10 s on the running question or vote (never past the full time).
  addTime() {
    const now = this.clock.now();
    if (this.phase === 'question' && !this.type.turns && !this.buzz) {
      this.questionStartedAt = Math.min(now, this.questionStartedAt + EXTRA_TIME);
      this.clearTimer();
      this.timer = this.clock.setTimeout(() => this.reveal(), this.remaining());
      if (this.shrinks()) this.scheduleShrink();
    } else if (this.phase === 'vote') {
      this.voteStartedAt = Math.min(now, this.voteStartedAt + EXTRA_TIME);
      this.clearTimer();
      this.timer = this.clock.setTimeout(() => this.finishVote(), this.remaining());
    } else return false;
    this.broadcast();
    return true;
  }

  // A saved game from before a restart (the app reads it from disk).
  resume(saved) {
    this.reset();
    this.quiz = validateQuiz(saved.quiz);
    this.resumable = null;
    this.restore(saved.state);
  }

  clearTimer() {
    if (this.timer) this.clock.clearTimeout(this.timer);
    if (this.tickTimer) this.clock.clearTimeout(this.tickTimer);
    this.timer = null;
    this.tickTimer = null;
  }

  // Ties share a rank: 10, 8, 8, 5 -> 1, 2, 2, 4.
  ranking() {
    const sorted = [...this.teams.entries()]
      .map(([id, t]) => ({ id, name: t.name, color: t.color, photo: t.photo || null, score: t.score, lastPoints: t.lastPoints, tb: t.tb ?? null }))
      // A tie-break splits equal scores: the closest answer first.
      .sort((a, b) => b.score - a.score || (a.tb ?? Infinity) - (b.tb ?? Infinity) || a.name.localeCompare(b.name));
    sorted.forEach((r, i) => {
      const same = i > 0 && sorted[i - 1].score === r.score && sorted[i - 1].tb === r.tb;
      r.rank = same ? sorted[i - 1].rank : i + 1;
      r.previousRank = this.previousRanks[r.id] || null;
    });
    return sorted;
  }

  remaining() {
    if (this.phase === 'vote') return Math.max(0, this.voteTime() * 1000 - (this.clock.now() - this.voteStartedAt));
    if (this.phase !== 'question') return 0;
    if (this.buzz) return this.buzz.left;
    if (this.type.turns) return this.clockLeft(this.turnTeam);
    return Math.max(0, this.question.time * 1000 - (this.clock.now() - this.questionStartedAt));
  }

  // Time left on a team's clock, counting the running turn.
  clockLeft(id) {
    const ms = this.clocks.get(id) || 0;
    const running = this.phase === 'question' && id === this.turnTeam && this.teams.get(id) && this.teams.get(id).answer === null;
    return running ? Math.max(0, ms - (this.clock.now() - this.questionStartedAt)) : ms;
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
      video: q.video || null,
      start: Number(q.start) > 0 ? Number(q.start) : 0,
      end: Number(q.end) > 0 ? Number(q.end) : null,
      effect: type.effect || null,
      steps: rounds.stepsOf(type, q),
      time: q.time,
      points: q.points,
      gone: this.phase === 'question' ? this.goneAt(this.clock.now() - this.questionStartedAt) : [],
      ...type.publicQ(q),
    };
  }

  common() {
    const q = this.question;
    const showQuestion = q && (this.phase === 'question' || this.phase === 'reveal' || this.phase === 'vote');
    const round = this.round;
    const team = id => (this.teams.get(id) ? { name: this.teams.get(id).name, color: this.teams.get(id).color } : null);
    // Mystery category: the round title only comes out with the last answer.
    const mystery = this.hasTwist('mysteryCategory') && round.title && !(this.phase === 'reveal' && this.questionIndex + 1 >= round.questions.length) && this.phase !== 'scoreboard';
    const pickQ = this.phase === 'wager' && this.type.wager === 'pick' ? q : null;
    return {
      phase: this.phase,
      title: this.quiz ? this.quiz.title : '',
      jokers: !!(this.quiz && this.quiz.jokers),
      round: round ? {
        index: this.roundIndex, total: this.regularRounds(), title: round.tiebreak ? i18n.dictionary(this.language)['round.tiebreak'] : mystery ? '? ? ?' : round.title,
        tiebreak: round.tiebreak ? round.tiebreak.teams.map(team).filter(Boolean) : null, type: round.type, family: (rounds.get(round.type) || {}).family || 'classic', mystery: !!mystery,
        questions: round.questions.length, scoring: round.scoring, twists: round.twists,
        underdogs: this.hasTwist('underdog') ? [...this.underdogs].map(team).filter(Boolean) : [],
      } : null,
      questionIndex: this.questionIndex,
      question: showQuestion ? this.publicQuestion() : null,
      category: this.phase === 'wager' ? (q.category || '') : null,
      wagerMode: this.phase === 'wager' ? (this.type.wager === true ? 'bet' : this.type.wager) : null,
      levelBase: this.phase === 'wager' ? q.points : null,
      remaining: this.remaining(),
      awards: this.phase === 'awards' ? this.awards() : null,
      break: this.breakInfo(),
      reveal: this.phase === 'reveal' ? this.revealInfo() : null,
      correct: this.phase === 'reveal' ? (this.type.revealQ(q).correct ?? null) : null,
      // Buzzer: who holds the floor; the clock stands still meanwhile.
      buzz: this.buzz ? { name: this.teams.get(this.buzz.teamId).name, color: this.teams.get(this.buzz.teamId).color } : null,
      paused: !!this.buzz,
      vote: this.ballot && (this.phase === 'vote' || this.phase === 'reveal') ? { mode: this.type.vote, time: this.voteTime() } : null,
      actor: this.actor && this.teams.get(this.actor) ? { name: this.teams.get(this.actor).name, color: this.teams.get(this.actor).color } : null,
      finalists: this.finalists ? this.finalists.map(team).filter(Boolean) : null,
      // Your pick: who chooses, and from which categories.
      pick: pickQ ? { by: team(this.picker), categories: pickQ.options.map(o => o.category), chosen: this.teams.get(this.picker) ? this.teams.get(this.picker).wager : null } : null,
      // Clock rounds: every playing team's clock; only the clock of the team whose turn it is runs.
      turn: this.type && this.type.turns && this.turnTeam ? team(this.turnTeam) : null,
      clocks: this.type && this.type.turns && this.phase !== 'roundIntro' ? [...this.clocks.keys()].filter(id => this.teams.has(id)).map(id => ({
        ...team(id), ms: this.clockLeft(id), active: id === this.turnTeam, running: this.phase === 'question' && id === this.turnTeam && this.teams.get(id).answer === null,
        winner: id === this.duelWinner,
      })) : null,
      clockStart: this.type && this.type.turns ? this.type.clock * 1000 : null,
    };
  }

  revealInfo() {
    const info = this.type.revealQ(this.question);
    // A short "did you know" line after the answer, when the question has one.
    info.fact = typeof this.question.fact === 'string' && this.question.fact.trim() ? this.question.fact.trim().slice(0, 200) : null;
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
        name: t.name, color: t.color, photo: t.photo || null, answered: t.answer !== null, connected: t.connected, phones: t.phones.size, away: t.away, awayCount: t.awayCount || 0, blocked: t.blocked, paper: !!t.paper,
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
    if (reveal && ['text', 'number', 'point', 'order', 'pairs', 'list', 'level', 'buzz', 'groups'].includes(kind)) {
      state.answers = [...this.teams.entries()].filter(([id]) => !this.round.tiebreak || this.round.tiebreak.teams.includes(id)).map(([id, t]) => ({
        id, name: t.name, color: t.color, answer: t.answer, correct: t.correct, points: t.lastPoints, wager: t.wager, found: t.found,
      }));
    }
    // Strategy rounds show their round memory: pots, streaks and who is out.
    if (this.type && (this.type.sitsOut || this.type.id === 'hotStreak')) state.board = true;
    // One mistake and out: the room sees who is still in.
    if (this.hasTwist('suddenDeath') && !this.type.vote && !this.type.turns && !this.finalists && ['question', 'reveal'].includes(this.phase)) state.board = true;
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
      judgeList: this.phase === 'reveal' && this.canJudge() && ['choice', 'trueFalse'].includes(this.kind)
        ? [...this.teams.entries()].map(([id, t]) => ({ id, name: t.name, color: t.color, answer: t.answer, correct: t.correct, points: t.lastPoints }))
        : null,
      paperRound: this.paperRound(),
      paperTeams: [...this.teams.entries()].filter(([, t]) => t.paper).map(([id, t]) => ({ id, name: t.name, color: t.color, points: t.paper[this.paperRound()] ?? null })),
      canBack: this.history.length > 0 && !this.breakUntil,
      canBreak: !!this.breakUntil || BREAK_PHASES.includes(this.phase) && !!this.quiz,
      canAddTime: (this.phase === 'question' && !!this.type && !this.type.turns && !this.buzz) || this.phase === 'vote',
      resumable: this.phase === 'idle' ? this.resumable : null,
      canJudgeBuzz: this.phase === 'question' && (!!this.buzz || (!!this.type.turns && !!this.turnTeam)),
      realTitle: this.round ? this.round.title : '',
      lastQuestion: !!this.round && this.questionIndex + 1 >= this.round.questions.length,
      lastRound: !!this.quiz && this.roundIndex + 1 >= this.regularRounds(),
      hasAwards: this.phase === 'scoreboard' && !!this.quiz && this.roundIndex + 1 >= this.regularRounds() && this.awards().length > 0,
    };
  }

  teamState(teamId) {
    const t = this.teams.get(teamId);
    const state = { ...this.common(), takenColors: this.freeColors().length ? [...this.teams.values()].map(x => x.color) : [] };
    // Blackout: the question and the answer texts are only on the big screen.
    if (state.question && this.hasTwist('blackout') && this.phase === 'question') {
      state.question = { ...state.question, text: '', clues: undefined, answers: state.question.answers ? state.question.answers.map(() => '') : undefined, blackout: true };
    }
    // A phone without a team can join a team that is already in, so a whole table plays along.
    if (!t) return { ...state, teams: [...this.teams].map(([id, x]) => ({ id, name: x.name, color: x.color })) };
    // Pick your level: every team gets the question of the level it chose.
    if (state.question && this.type.teamQ) state.question = { ...state.question, ...this.type.teamQ(this.question, t) };
    if (state.question && this.phase === 'question') state.question = { ...state.question, gone: this.hiddenFor(t) };
    const r = this.ranking().find(x => x.id === teamId);
    return {
      ...state,
      team: {
        name: t.name, color: t.color, photo: t.photo || null, score: t.score, rank: r.rank, teams: this.teams.size,
        jokerLeft: t.jokerRound === -1, jokerNow: t.jokerRound === this.roundIndex,
      },
      // Between rounds and at the end the phone shows the whole standings too.
      standings: this.phase === 'scoreboard' || this.phase === 'end' ? this.ranking().map(r => ({ name: r.name, color: r.color, photo: r.photo, score: r.score, rank: r.rank, me: r.id === teamId })) : null,
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
      isPicker: this.picker === teamId,
      isFinalist: !!this.finalists && this.finalists.includes(teamId),
      myTurn: !!this.type && !!this.type.turns && this.turnTeam === teamId,
      canWager: this.phase === 'wager' && this.canWager(teamId),
      canLifeline: this.canLifeline(t),
      underdog: this.hasTwist('underdog') && this.underdogs.has(teamId),
      powers: this.hasPowers() && !t.paper ? {
        shield: this.canPower(t, 'shield'), spy: this.canPower(t, 'spy'), fifty: this.canPower(t, 'fifty'),
        shieldNow: t.shieldRound === this.roundIndex, left: ['shield', 'spy', 'fifty'].filter(n => (n === 'shield' ? !(t.shieldRound >= 0) : !t[`${n}Key`])),
      } : null,
      spy: this.spyCounts(t),
      lifelineUsed: t.lifelineRound === this.roundIndex,
      secret: this.actor === teamId && this.phase === 'question' ? this.question.answer : null,
      // Who's who: the teams you can choose from (by colour, never by id).
      teamsToMatch: this.phase === 'vote' && this.type.vote === 'match' && !t.shortlist ? [...this.teams.entries()].filter(([id]) => id !== teamId).map(([, x]) => ({ name: x.name, color: x.color })) : null,
    };
  }

  broadcast() {
    this.record();
    this.emit('host', 'state', this.hostState());
    this.emit('screen', 'state', this.screenState());
    this.emit('lobby', 'state', this.teamState(null));
    for (const [id, t] of this.teams) if (t.connected) this.emit(`team:${id}`, 'state', this.teamState(id));
    this.onChange();
  }

  // How every team did on the question that was just revealed (kept up to date when the quizmaster overrules).
  record() {
    if (this.phase !== 'reveal' || !this.question) return;
    const q = this.question;
    this.log.set(`${this.roundIndex}:${this.questionIndex}`, {
      r: this.roundIndex, q: this.questionIndex, type: this.round.type,
      key: (q.question || '').trim() || `#${this.roundIndex}:${this.questionIndex}`,
      scored: !this.type.vote && !this.type.turns && !this.type.sitsOut,
      time: (q.time || 0) * 1000,
      teams: Object.fromEntries([...this.teams].map(([id, t]) => [id, { a: t.answer !== null, c: !!t.correct, p: t.lastPoints, ms: t.answeredAt }])),
    });
  }

  // Fun prizes at the end of the night, worked out from the log. Each one only when someone really earned it.
  awards() {
    const ranking = this.ranking();
    if (ranking.length < 2) return [];
    const who = id => { const r = ranking.find(x => x.id === id); return r ? { name: r.name, color: r.color, photo: r.photo } : null; };
    const entries = [...this.log.values()].sort((a, b) => a.r - b.r || a.q - b.q);
    const scored = entries.filter(e => e.scored);
    const ids = ranking.map(r => r.id);
    const best = (score, better = (a, b) => a > b) => {
      let top = null;
      for (const id of ids) {
        const v = score(id);
        if (v === null) continue;
        if (!top || better(v, top.v)) top = { id, v };
      }
      return top;
    };
    const out = [];
    const add = (id, top) => { if (top) out.push({ id, team: who(top.id), n: top.v }); };
    // Fastest fingers: the quickest right answers on average (at least two).
    add('fastest', best(id => {
      const ms = scored.map(e => e.teams[id]).filter(x => x && x.c && x.a && x.ms > 0).map(x => x.ms);
      return ms.length >= 2 ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length / 100) / 10 : null;
    }, (a, b) => a < b));
    // Hot hand: the longest run of right answers.
    add('streak', best(id => {
      let run = 0, top = 0;
      for (const e of scored) { const x = e.teams[id]; if (!x) continue; run = x.c ? run + 1 : 0; top = Math.max(top, run); }
      return top >= 3 ? top : null;
    }));
    // Climber: the most places up since the first scoreboard.
    const first = this.rankHistory.find(Boolean);
    if (first) add('climber', best(id => (first[id] && first[id] - ranking.find(r => r.id === id).rank > 0 ? first[id] - ranking.find(r => r.id === id).rank : null)));
    // Daredevil: the most points lost by daring (risk, bets, robbing the leader).
    add('daredevil', best(id => {
      const lost = -entries.reduce((sum, e) => sum + Math.min(0, (e.teams[id] || {}).p || 0), 0);
      return lost > 0 ? lost : null;
    }));
    // Last second: the most answers in the final three seconds.
    add('buzzer', best(id => {
      const n = scored.filter(e => { const x = e.teams[id]; return x && x.a && e.time > 0 && e.time - x.ms <= 3000; }).length;
      return n >= 2 ? n : null;
    }));
    // So close: fourth place, just off the podium.
    if (ranking.length >= 4 && ranking[3].rank === 4) out.push({ id: 'almost', team: who(ranking[3].id), n: ranking[2].score - ranking[3].score });
    return out;
  }
}

// A quiz file: { title, jokers?, rounds: [{ type, title, scoring?, twists?, questions: [...] }] }
// The fields of a question depend on its round type (rounds.js). Returns a cleaned copy with the defaults filled in.
function validateQuiz(quiz) {
  const fail = msg => { throw new Error(`Invalid quiz: ${msg}`); };
  if (!quiz || typeof quiz !== 'object') fail('not an object');
  if (!Array.isArray(quiz.rounds) || quiz.rounds.length === 0) fail('no rounds');
  const clean = { ...quiz, title: String(quiz.title || '').trim() || 'Quiz', jokers: !!quiz.jokers, powerUps: !!quiz.powerUps };
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
