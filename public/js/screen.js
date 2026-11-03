// The big screen on the TV or projector. It only shows; the quizmaster drives it from /host.
(function () {
  const { $, h, showView, LETTERS, teamVar, countdown } = QB;
  const socket = io({ query: { role: 'screen' } });
  let state = null;
  let stopTimer = null;
  let lastKey = '';

  socket.on('language', async lang => {
    await I18n.load(lang);
    if (state) render(state, true);
  });
  socket.on('state', s => { state = s; if (I18n.dict['app.name']) render(s); });

  QB.info().then(i => {
    $('#qr').innerHTML = i.qr;
    $('#join-url').textContent = i.url.replace(/^https?:\/\//, '');
  });

  function render(s, force) {
    showView(s.phase, { reveal: 'question' });
    // Re-render only what changed, so animations play once.
    const key = [s.phase, s.round && s.round.index, s.questionIndex].join(':');
    const fresh = force || key !== lastKey;
    lastKey = key;
    if (s.phase === 'lobby') renderLobby(s);
    if (s.phase === 'roundIntro') renderRoundIntro(s);
    if (s.phase === 'question' || s.phase === 'reveal') renderQuestion(s, fresh);
    if (s.phase === 'scoreboard' && fresh) renderScoreboard(s);
    if (s.phase === 'end' && fresh) renderEnd(s);
  }

  function renderLobby(s) {
    $('#lobby-title').textContent = s.title;
    const list = $('#lobby-teams');
    const known = new Set([...list.children].map(li => li.dataset.name));
    const names = new Set(s.teams.map(t => t.name));
    [...list.children].forEach(li => { if (!names.has(li.dataset.name)) li.remove(); });
    s.teams.forEach(team => {
      if (known.has(team.name)) return;
      list.append(h('li', { class: 'team-chip', style: teamVar(team.color), 'data-name': team.name }, h('span', { class: 'team-dot' }), team.name));
    });
    list.style.setProperty('--rows', Math.max(6, Math.ceil(s.teams.length / 2)));
    $('#team-count').textContent = t('screen.teamCount', { n: s.teams.length });
    $('#lobby-empty').hidden = s.teams.length > 0;
  }

  function renderRoundIntro(s) {
    $('#round-kicker').textContent = t('screen.roundOf', { n: s.round.index + 1, total: s.round.total });
    $('#round-title').textContent = s.round.title;
    $('#round-meta').textContent = t('screen.questionsInRound', { n: s.round.questions });
  }

  function renderQuestion(s, fresh) {
    const q = s.question;
    const reveal = s.phase === 'reveal';
    $('#q-count').textContent = t('screen.questionOf', { n: s.questionIndex + 1, total: s.round.questions });
    $('#q-answered').textContent = t('screen.answeredCount', { n: s.answered, total: s.teams.length });
    document.body.classList.toggle('revealed', reveal);

    if (fresh) {
      $('#q-text').textContent = q.text;
      $('#answers').replaceChildren(...q.answers.map((a, i) => h('li', { class: 'answer', style: `--a: var(--ans-${i}); animation-delay: ${0.15 + i * 0.12}s` },
        h('span', { class: 'letter' }, LETTERS[i]),
        h('span', { class: 'text' }, a),
        h('span', { class: 'count' }))));
      $('#q-text').parentElement.classList.toggle('long', q.text.length > 90);
    }

    [...$('#answers').children].forEach((li, i) => {
      li.classList.toggle('correct', reveal && i === s.correct);
      li.classList.toggle('wrong', reveal && i !== s.correct);
      li.querySelector('.count').textContent = reveal && s.counts ? t('screen.teamsChose', { n: s.counts[i] }) : '';
    });

    $('#answered-dots').replaceChildren(...s.teams.map(team => h('li', {
      class: 'dot' + (team.answered ? ' on' : '') + (team.connected ? '' : ' away'),
      style: teamVar(team.color), title: team.name,
    })));

    if (stopTimer) stopTimer();
    const total = q.time * 1000;
    const ring = $('#timer-ring');
    const C = 2 * Math.PI * 44;
    ring.style.strokeDasharray = C;
    if (reveal) {
      ring.style.strokeDashoffset = C;
      $('#timer-num').textContent = '';
      $('#timer').classList.remove('urgent');
      return;
    }
    stopTimer = countdown(s.remaining, total, (left, frac) => {
      ring.style.strokeDashoffset = C * (1 - frac);
      $('#timer-num').textContent = Math.ceil(left / 1000);
      $('#timer').classList.toggle('urgent', left < 5000);
    });
  }

  function renderScoreboard(s) {
    $('#sb-title').textContent = t('screen.standingsAfter', { n: s.round.index + 1 });
    const rows = s.ranking;
    const n = rows.length;
    const list = $('#sb-list');
    list.classList.toggle('two-col', n > 10);
    list.style.setProperty('--n', Math.max(1, n > 10 ? Math.ceil(n / 2) : n));
    // The reveal goes from last place to first: the bottom rows appear first, the leader last.
    list.replaceChildren(...rows.map((r, i) => {
      const moved = r.previousRank ? r.previousRank - r.rank : 0;
      const delay = (n - 1 - i) * 0.7 + (i === 0 ? 0.8 : 0);
      return h('li', { class: 'sb-row' + (r.rank <= 3 ? ` top top${r.rank}` : ''), style: `${teamVar(r.color)}; animation-delay: ${delay}s` },
        h('span', { class: 'rank' }, r.rank),
        h('span', { class: 'team-dot' }),
        h('span', { class: 'name' }, r.name),
        moved > 0 ? h('span', { class: 'moved up' }, '▲ ' + moved) : moved < 0 ? h('span', { class: 'moved down' }, '▼ ' + -moved) : h('span', { class: 'moved' }),
        h('span', { class: 'score' }, r.score));
    }));
  }

  function renderEnd(s) {
    const rows = s.ranking;
    const podium = [rows[1], rows[0], rows[2]].filter(Boolean);
    $('#podium').replaceChildren(...podium.map(r => h('div', { class: `step place${r.rank}`, style: teamVar(r.color) },
      h('div', { class: 'who' }, h('span', { class: 'team-dot' }), h('span', { class: 'name' }, r.name), h('span', { class: 'pts' }, t('screen.points', { n: r.score }))),
      h('div', { class: 'block' }, h('span', { class: 'medal' }, r.rank)))));
    $('#rest').replaceChildren(...rows.slice(3).map(r => h('li', { style: teamVar(r.color) }, h('span', { class: 'rank' }, r.rank), h('span', { class: 'team-dot' }), r.name, h('span', { class: 'score' }, r.score))));
  }

})();
