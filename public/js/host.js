// The quizmaster's laptop: pick a quiz, drive the pace, keep an eye on the teams.
(function () {
  const { $, h, showView, LETTERS, teamVar } = QB;
  const socket = io({ query: { role: 'host' } });
  let state = null;
  let languages = [];
  let joinInfo = null;

  socket.on('language', async lang => {
    await I18n.load(lang);
    $('#lang').value = lang;
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
  });
  $('#lang').addEventListener('change', e => socket.emit('language', e.target.value));

  function loadQuizzes() {
    socket.emit('quizzes', list => {
      $('#quiz-list').replaceChildren(...list.map(q => h('li', { class: 'quiz-card panel' },
        h('div', { class: 'quiz-info' },
          h('h3', {}, q.title),
          h('p', {}, t('host.quizMeta', { rounds: q.rounds, questions: q.questions }))),
        h('button', { class: 'brass-btn', onclick: () => socket.emit('load', q.file) }, t('host.open')))));
    });
  }

  const NEXT_LABEL = {
    lobby: () => 'host.startQuiz',
    roundIntro: () => 'host.firstQuestion',
    question: () => 'host.reveal',
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
      title.textContent = s.round.title;
    } else if (s.phase === 'question' || s.phase === 'reveal') {
      kicker.textContent = `${s.round.title} · ${t('screen.questionOf', { n: s.questionIndex + 1, total: s.round.questions })}`;
      title.textContent = s.question.text;
      const key = s.phase === 'reveal' ? s.correct : s.answerKey;
      preview.append(h('ol', { class: 'mini-answers' }, s.question.answers.map((a, i) => h('li', { class: i === key ? 'key' : '', style: `--a: var(--ans-${i})` },
        h('span', { class: 'letter' }, LETTERS[i]), a,
        s.phase === 'reveal' && s.counts ? h('span', { class: 'n' }, s.counts[i]) : null))));
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

  function renderTeams(s) {
    $('#team-total').textContent = s.teams.length;
    $('#no-teams').hidden = s.teams.length > 0;
    const byName = Object.fromEntries(s.teams.map(tm => [tm.name, tm]));
    $('#team-list').replaceChildren(...s.ranking.map(r => {
      const tm = byName[r.name] || {};
      const status = !tm.connected ? 'away' : (s.phase === 'question' && tm.answered) ? 'answered' : '';
      return h('li', { class: 'team-row ' + status, style: teamVar(r.color) },
        h('span', { class: 'rank' }, r.rank),
        h('span', { class: 'team-dot' }),
        h('span', { class: 'name', title: !tm.connected ? t('host.offline') : '' }, r.name),
        h('span', { class: 'tag' + (status === 'answered' ? ' ok' : status === 'away' ? ' warn' : ''), title: status === 'answered' ? t('host.answered') : null },
          status === 'answered' ? '✓' : status === 'away' ? t('host.offline') : ''),
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
