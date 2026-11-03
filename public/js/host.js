// The quizmaster's laptop: pick a quiz, drive the pace, keep an eye on the teams.
(function () {
  const { $, h, showView, LETTERS, teamVar } = QB;
  // On the remote (a phone or tablet), the secret key from the link lets this page drive the quiz.
  const remote = document.body.classList.contains('remote');
  const socket = io({ query: { role: 'host', key: new URLSearchParams(location.search).get('key') || '' } });
  let state = null;
  let languages = [];
  let joinInfo = null;

  socket.on('language', async lang => {
    await I18n.load(lang);
    $('#lang').value = lang;
    renderLooks();
    if (state) render(state);
    loadQuizzes();
  });
  socket.on('state', s => { state = s; if (I18n.dict['app.name']) render(s); });

  QB.info().then(info => {
    languages = info.languages;
    joinInfo = info;
    if (state) render(state);
    $('#lang').replaceChildren(...languages.map(l => h('option', { value: l.code }, l.name)));
    $('#lang').value = I18n.lang;
    $('#join-url').textContent = info.url.replace(/^https?:\/\//, '');
    looks = info.looks;
    renderLooks();
  });
  let looks = [];
  function renderLooks() {
    const cur = document.documentElement.dataset.look;
    $('#look').replaceChildren(...looks.map(l => h('option', { value: l }, t('look.' + l))));
    $('#look').value = cur;
  }
  $('#look').addEventListener('change', e => socket.emit('look', e.target.value));
  socket.on('look', l => { $('#look').value = l; });
  $('#lang').addEventListener('change', e => socket.emit('language', e.target.value));
  if (!remote) {
    $('#remote-tile').addEventListener('click', e => { e.stopPropagation(); $('#remote-btn').click(); scrollTo({ top: 0, behavior: 'smooth' }); });
    $('#remote-btn').addEventListener('click', async () => {
      const pop = $('#remote-pop');
      pop.hidden = !pop.hidden;
      if (pop.hidden || $('#remote-qr').innerHTML) return;
      const r = await fetch('/api/host/remote').then(x => x.json());
      $('#remote-qr').innerHTML = r.qr;
      $('#remote-url').textContent = r.url;
    });
  }

  function loadQuizzes() {
    socket.emit('quizzes', ({ samples, library }) => {
      const card = (q, ref, edit) => h('li', { class: 'quiz-card panel' },
        h('img', { class: 'quiz-icon', src: '/img/icons/quiz.webp', alt: '' }),
        h('div', { class: 'quiz-info' },
          h('h3', {}, q.title || q.name),
          h('p', {}, t('host.quizMeta', { rounds: q.rounds, questions: q.questions }))),
        h('div', { class: 'card-actions' },
          h('button', { class: 'brass-btn', onclick: () => socket.emit('load', ref, res => { if (res && res.error) alert(t('error.quizInvalid') + '\n' + (res.detail || '')); }) }, t('host.open')),
          edit && !remote ? h('a', { class: 'ghost-btn', href: '/builder?open=' + encodeURIComponent(edit) }, t('host.edit')) : null,
          remote ? null : h('a', { class: 'ghost-btn', href: '/print?' + (edit ? 'open=' + encodeURIComponent(edit) : 'sample=' + encodeURIComponent(ref)), target: '_blank' }, t('host.print'))));
      $('#quiz-list').replaceChildren(
        ...library.map(q => card(q, { library: q.path }, q.path)),
        ...samples.map(q => card(q, q.file, null)));
    });
  }

  const NEXT_LABEL = {
    lobby: () => 'host.startQuiz',
    roundIntro: () => 'host.firstQuestion',
    wager: () => 'host.showQuestion',
    question: s => (s.turn ? 'host.skipTurn' : s.round && ['drawGuess', 'captionThis', 'bluffBank', 'photoHunt', 'whosWho'].includes(s.round.type) ? 'host.startVote' : 'host.reveal'),
    vote: () => 'host.showVotes',
    reveal: s => (s.lastQuestion ? 'host.showScores' : 'host.nextQuestion'),
    scoreboard: s => (s.lastRound ? 'host.showWinner' : 'host.nextRound'),
  };

  function render(s) {
    showView(s.phase === 'idle' ? 'idle' : 'live');
    $('#quiz-name').textContent = s.title || '';
    if (s.phase === 'idle') return;

    const label = NEXT_LABEL[s.phase];
    const next = $('#next');
    next.hidden = !label;
    if (label) next.textContent = t(label(s));
    next.disabled = s.phase === 'lobby' && s.teams.length === 0;
    $('#stop').textContent = t(s.phase === 'end' ? 'host.newQuiz' : 'host.stop');

    const kicker = $('#phase-kicker');
    const title = $('#phase-title');
    const preview = $('#preview');
    preview.replaceChildren();
    if (s.phase === 'lobby') {
      kicker.textContent = t('host.phase.lobby');
      title.textContent = t('host.lobbyTitle', { n: s.teams.length });
      if (joinInfo) {
        const qr = h('div', { class: 'qr-mini' });
        qr.innerHTML = joinInfo.qr;
        preview.append(h('div', { class: 'join-box' }, qr, h('div', {}, h('p', { class: 'hint' }, t('host.joinAddress')), h('p', { class: 'big-url' }, joinInfo.url.replace(/^https?:\/\//, '')))));
      }
    } else if (s.phase === 'roundIntro') {
      kicker.textContent = t('screen.roundOf', { n: s.round.index + 1, total: s.round.total });
      title.textContent = s.round.title || t(`round.${s.round.type}`);
      const rules = [t(`round.${s.round.type}`)];
      if (s.round.scoring) rules.push(t(`scoring.${s.round.scoring}`));
      s.round.twists.forEach(tw => rules.push(t(`twist.${tw}`)));
      preview.append(h('p', { class: 'hint' }, rules.join(' · ')));
      if (s.round.mystery) preview.append(h('p', { class: 'answer-key' }, t('host.realTitle', { title: s.realTitle })));
    } else if (s.phase === 'wager') {
      kicker.textContent = `${s.round.title || t(`round.${s.round.type}`)} · ${t('host.phase.wager')}`;
      title.textContent = s.pick ? t('host.picks', { name: s.pick.by ? s.pick.by.name : '' }) : s.wagerMode === 'predict' ? (s.finalists || []).map(f => f.name).join(` ${t('screen.vs')} `) : s.category || '';
      if (s.pick) preview.append(h('ol', { class: 'mini-answers' }, s.pick.categories.map((c, i) => h('li', { class: s.pick.chosen === i ? 'key' : '' }, h('span', { class: 'letter' }, LETTERS[i]), c))));
      preview.append(h('p', { class: 'hint' }, t('host.wagered', { n: s.teams.filter(x => x.wagered).length, total: s.teams.length })));
      if (s.answerKey) preview.append(h('p', { class: 'answer-key' }, t('host.answerKey', { text: s.answerKey.answerText })));
    } else if (s.phase === 'vote') {
      kicker.textContent = `${s.round.title || t(`round.${s.round.type}`)} · ${t('host.phase.vote')}`;
      title.textContent = s.question.text || '';
      preview.append(h('ol', { class: 'mini-answers ballot-mini' }, s.ballot.map((b, i) => h('li', {},
        h('span', { class: 'letter' }, LETTERS[i] || String(i + 1)), b.image ? h('img', { class: 'ballot-thumb', src: b.content, alt: '' }) : b.content))));
      preview.append(h('p', { class: 'hint' }, t('screen.votedCount', { n: s.answered, total: s.teams.length })));
    } else if (s.phase === 'question' || s.phase === 'reveal') {
      kicker.textContent = `${s.round.title || t(`round.${s.round.type}`)} · ${t('screen.questionOf', { n: s.questionIndex + 1, total: s.round.questions })}`;
      const q = s.question;
      title.textContent = q.text || (q.clues ? q.clues.join(' · ') : '') || (q.scrambled || '');
      if (s.actor) preview.append(h('p', { class: 'hint' }, t('screen.actsNow', { name: s.actor.name })));
      if (s.phase === 'reveal' && s.ballot) {
        preview.append(h('ol', { class: 'mini-answers ballot-mini' }, s.ballot.map((b, i) => h('li', { class: b.truth ? 'key' : '' },
          h('span', { class: 'letter' }, LETTERS[i] || String(i + 1)), b.image ? h('img', { class: 'ballot-thumb', src: b.content, alt: '' }) : b.content,
          h('span', { class: 'n' }, `${b.truth ? t('screen.theTruth') : b.by ? b.by.name : ''} · ${(b.votes || []).length}`)))));
      }
      const key = s.phase === 'reveal' ? s.reveal : s.answerKey;
      if (q.emoji) preview.append(h('p', { class: 'host-emoji' }, q.emoji));
      if (q.image) preview.append(h('img', { class: 'host-img' + (q.effect === 'silhouette' && s.phase !== 'reveal' ? ' shadow' : ''), src: q.image, alt: '' }));
      if (q.images) preview.append(h('div', { class: 'host-imgs' }, q.images.map((src, i) => h('figure', { class: key && key.correct === i ? 'key' : '' }, h('img', { src, alt: '' }), h('figcaption', {}, LETTERS[i])))));
      if (q.audio) {
        preview.append(h('div', { class: 'card-actions' },
          h('button', { class: 'ghost-btn small', type: 'button', onclick: () => socket.emit('media', 'replay') }, t('host.replay')),
          h('button', { class: 'ghost-btn small', type: 'button', onclick: () => socket.emit('media', 'stop') }, t('host.stopSound'))));
      }
      const kind = q.kind;
      // Clock rounds: every clock at a glance.
      if (s.clocks) {
        preview.append(h('ul', { class: 'host-clocks' }, s.clocks.map(c => h('li', { class: (c.active ? 'active' : '') + (c.ms <= 0 ? ' out' : ''), style: teamVar(c.color) },
          h('span', { class: 'team-dot' }), c.name, h('strong', {}, (c.ms / 1000).toFixed(1) + ' s')))));
      }
      const holder = s.buzz || (s.phase === 'question' && s.turn);
      if (s.canJudgeBuzz && holder) {
        preview.append(h('div', { class: 'buzz-judge', style: teamVar(holder.color) },
          h('span', { class: 'team-dot' }), h('strong', {}, t(s.buzz ? 'host.buzzing' : 'host.turnOf', { name: holder.name })),
          h('button', { class: 'brass-btn ok', type: 'button', onclick: () => socket.emit('buzzJudge', true) }, t('host.buzzRight')),
          h('button', { class: 'ghost-btn no', type: 'button', onclick: () => socket.emit('buzzJudge', false) }, t('host.buzzWrong'))));
      }
      if (kind === 'level') {
        const lv = (s.phase === 'reveal' ? s.reveal : s.answerKey).levels;
        preview.append(h('ol', { class: 'mini-answers levels' }, lv.map((l, i) => h('li', { class: 'key' },
          h('span', { class: 'letter' }, i + 1), `${l.question} → ${l.answer}`,
          h('span', { class: 'n' }, s.teams.filter(tm => (tm.level || 0) === i).length)))));
      }
      if (kind === 'choice' || kind === 'trueFalse') {
        const key = s.phase === 'reveal' ? s.correct : s.answerKey && s.answerKey.correct;
        const answers = kind === 'trueFalse' ? [t('play.true'), t('play.false')] : q.answers;
        preview.append(h('ol', { class: 'mini-answers' }, answers.map((a, i) => h('li', { class: i === key ? 'key' : '', style: `--a: var(--ans-${i})` },
          h('span', { class: 'letter' }, kind === 'trueFalse' ? (i === 0 ? '✓' : '✗') : LETTERS[i]), a,
          s.phase === 'reveal' && s.counts ? h('span', { class: 'n' }, s.counts[i]) : null))));
      } else {
        const keyText = s.phase === 'reveal' ? s.reveal.answerText : s.answerKey && s.answerKey.answerText;
        if (keyText) preview.append(h('p', { class: 'answer-key' }, t('host.answerKey', { text: keyText + (q.unit ? ' ' + q.unit : '') })));
        const rows = s.phase === 'reveal' ? s.answers : s.liveAnswers;
        if (rows && rows.length) {
          preview.append(h('ul', { class: 'judge-list' }, rows.map(a => h('li', { class: 'judge-row' + (s.phase === 'reveal' ? (a.correct ? ' right' : ' wrong') : ''), style: teamVar(a.color) },
            h('span', { class: 'team-dot' }), h('span', { class: 'name' }, a.name), h('span', { class: 'given' }, given(a.answer, kind, key)),
            s.phase === 'reveal' ? h('span', { class: 'pts' }, (a.points > 0 ? '+' : '') + a.points) : null,
            s.canJudge && a.answer !== null ? h('span', { class: 'judge' },
              h('button', { class: 'mini ok' + (a.correct ? ' on' : ''), title: t('host.markRight'), onclick: () => socket.emit('judge', { teamId: a.id, correct: true }) }, '✓'),
              h('button', { class: 'mini no' + (!a.correct ? ' on' : ''), title: t('host.markWrong'), onclick: () => socket.emit('judge', { teamId: a.id, correct: false }) }, '✗')) : null))));
          if (s.canJudge) preview.append(h('p', { class: 'hint' }, t('host.judgeHint')));
        }
      }
      preview.append(h('p', { class: 'hint' }, t('screen.answeredCount', { n: s.answered, total: s.teams.length })));
    } else if (s.phase === 'scoreboard') {
      kicker.textContent = t('host.phase.scoreboard');
      title.textContent = t('screen.standingsAfter', { n: s.round.index + 1 });
    } else if (s.phase === 'end') {
      kicker.textContent = t('host.phase.end');
      title.textContent = s.ranking[0] ? t('host.winnerIs', { name: s.ranking[0].name }) : '';
    }

    renderTeams(s);
  }

  // What a team gave, readable for the quizmaster.
  function given(a, kind, key) {
    if (a === null || a === undefined) return '—';
    if (kind === 'order') return key && key.order ? a.map(i => key.order[i]).join(' → ') : '✓';
    if (kind === 'pairs') return key && key.pairs ? t('host.pairsRight', { n: a.filter((v, i) => v === i).length, total: a.length }) : '✓';
    if (kind === 'list') return t('host.items', { n: a.length });
    if (kind === 'level') return `${t(`play.level${a.l}`)} · ${LETTERS[a.i]}`;
    if (kind === 'buzz') return a === 'right' ? '✓' : '✗';
    if (kind === 'point') return key && key.spot ? t('screen.distance', { n: Math.round(Math.hypot(a.x - key.spot.x, a.y - key.spot.y) * 100) }) : '📍';
    return String(a);
  }

  function renderTeams(s) {
    $('#team-total').textContent = s.teams.length;
    $('#no-teams').hidden = s.teams.length > 0;
    const byName = Object.fromEntries(s.teams.map(tm => [tm.name, tm]));
    $('#team-list').replaceChildren(...s.ranking.map(r => {
      const tm = byName[r.name] || {};
      const status = !tm.connected ? 'away' : tm.blocked ? 'blocked' : tm.away ? 'left' : (s.phase === 'question' && tm.answered) ? 'answered' : '';
      return h('li', { class: 'team-row ' + status, style: teamVar(r.color) },
        h('span', { class: 'rank' }, r.rank),
        h('span', { class: 'team-dot' }),
        h('span', { class: 'name', title: !tm.connected ? t('host.offline') : '' }, r.name, tm.joker ? h('span', { class: 'joker-star', title: t('host.jokerPlayed') }, ' ★') : null),
        h('span', { class: 'tag' + (status === 'answered' ? ' ok' : status ? ' warn' : ''), title: status === 'answered' ? t('host.answered') : null },
          status === 'answered' ? '✓' : status === 'away' ? t('host.offline') : status === 'left' ? t('host.leftPage') : status === 'blocked' ? t('host.blocked') : ''),
        h('span', { class: 'score' }, r.score),
        h('span', { class: 'adjust' },
          h('button', { class: 'mini', title: t('host.minusPoint'), onclick: () => socket.emit('score', { teamId: r.id, delta: -1 }) }, '−'),
          h('button', { class: 'mini', title: t('host.plusPoint'), onclick: () => socket.emit('score', { teamId: r.id, delta: 1 }) }, '+'),
          h('button', { class: 'mini kick', title: t('host.kick'), onclick: () => { if (confirm(t('host.confirmKick', { name: r.name }))) socket.emit('kick', r.id); } }, '×')));
    }));
  }

  $('#next').addEventListener('click', () => socket.emit('next'));
  $('#stop').addEventListener('click', () => {
    if (state.phase === 'end' || confirm(t('host.confirmStop'))) socket.emit('stop');
  });
  document.addEventListener('keydown', e => {
    if (e.target.matches('input, select, textarea')) return;
    if ((e.key === ' ' || e.key === 'ArrowRight') && !$('#next').hidden && !$('#next').disabled && !$('#v-live').hidden) {
      e.preventDefault();
      socket.emit('next');
    }
  });
})();
