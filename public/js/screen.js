// The big screen on the TV or projector. It only shows; the quizmaster drives it from /host.
(function () {
  const { $, h, showView, LETTERS, teamVar, countdown, roundTheme, CROWN, split, countUp, later, clearLater } = QB;
  const socket = io({ query: { role: 'screen' } });
  let state = null;
  let stopTimer = null;
  let lastKey = '';
  let lobbyShown = false;

  // Ambient particles per phase.
  const AMBIENT = { idle: 'bubbles', lobby: 'bubbles', roundIntro: 'stage', question: 'dust', reveal: 'dust', scoreboard: 'dust', end: 'embers' };
  const cssColor = name => getComputedStyle(document.body).getPropertyValue(name).trim();

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
    FX.ambient(AMBIENT[s.phase]);
    // Re-render only what changed, so animations play once.
    const key = [s.phase === 'reveal' ? 'question' : s.phase, s.round && s.round.index, s.questionIndex].join(':');
    const fresh = force || key !== lastKey;
    if (key !== lastKey) { clearLater(); FX.clear(); }
    lastKey = key;
    document.body.classList.remove('urgent');
    if (s.phase !== 'lobby') lobbyShown = false;
    if (s.round) setTheme(s.round.type);
    if (s.phase === 'lobby') renderLobby(s);
    if (s.phase === 'roundIntro' && fresh) renderRoundIntro(s);
    if (s.phase === 'question' || s.phase === 'reveal') renderQuestion(s, fresh);
    if (s.phase === 'scoreboard' && fresh) renderScoreboard(s);
    if (s.phase === 'end' && fresh) renderEnd(s);
  }

  function setTheme(type) {
    document.body.style.setProperty('--theme', roundTheme(type).glow);
  }

  function renderLobby(s) {
    $('#lobby-title').textContent = s.title;
    const list = $('#lobby-teams');
    const known = new Set([...list.children].map(li => li.dataset.name));
    const names = new Set(s.teams.map(t => t.name));
    [...list.children].forEach(li => { if (!names.has(li.dataset.name)) li.remove(); });
    s.teams.forEach(team => {
      if (known.has(team.name)) return;
      const chip = h('li', { class: 'team-chip', style: teamVar(team.color), 'data-name': team.name }, h('span', { class: 'team-dot' }), team.name);
      list.append(chip);
      // A new team arriving gets a little burst of sparks in its colour.
      if (lobbyShown) setTimeout(() => FX.sparksAt(chip, { color: cssColor('--team-' + team.color), count: 34 }), 250);
    });
    lobbyShown = true;
    list.style.setProperty('--rows', Math.max(6, Math.ceil(s.teams.length / 2)));
    $('#team-count').textContent = t('screen.teamCount', { n: s.teams.length });
    $('#lobby-empty').hidden = s.teams.length > 0;
  }

  function renderRoundIntro(s) {
    const theme = roundTheme(s.round.type);
    $('#ri-icon').innerHTML = theme.icon;
    $('#round-kicker').textContent = t('screen.roundOf', { n: s.round.index + 1, total: s.round.total });
    split($('#round-title'), s.round.title);
    $('#ri-type').textContent = t('round.' + (s.round.type in QB.ROUND_THEMES ? s.round.type : 'classic'));
    $('#round-meta').textContent = t('screen.questionsInRound', { n: s.round.questions });
    // Restart the CSS animations for this round.
    const v = $('#v-roundIntro');
    v.classList.remove('play'); void v.offsetWidth; v.classList.add('play');
    later(() => FX.sparksAt($('#ri-medal'), { color: theme.glow, count: 70, speed: 1.3 }), 700);
  }

  function renderQuestion(s, fresh) {
    const q = s.question;
    const reveal = s.phase === 'reveal';
    $('#q-count').textContent = t('screen.questionOf', { n: s.questionIndex + 1, total: s.round.questions });
    $('#q-answered').textContent = t('screen.answeredCount', { n: s.answered, total: s.teams.length });
    const wasRevealed = document.body.classList.contains('revealed');
    document.body.classList.toggle('revealed', reveal);

    if (fresh) {
      split($('#q-text'), q.text, 'word');
      const words = q.text.split(/\s+/).length;
      $('#answers').style.setProperty('--start', Math.min(1.4, 0.25 + words * 0.06) + 's');
      $('#answers').replaceChildren(...q.answers.map((a, i) => h('li', { class: 'answer', style: `--a: var(--ans-${i}); --k: ${i}` },
        h('span', { class: 'letter' }, LETTERS[i]),
        h('span', { class: 'text' }, a),
        h('span', { class: 'count' }))));
      $('#q-text').parentElement.classList.toggle('long', q.text.length > 90);
      $('#answered-dots').replaceChildren();
    }

    [...$('#answers').children].forEach((li, i) => {
      li.classList.toggle('correct', reveal && i === s.correct);
      li.classList.toggle('wrong', reveal && i !== s.correct);
      li.querySelector('.count').textContent = reveal && s.counts ? t('screen.teamsChose', { n: s.counts[i] }) : '';
    });

    if (reveal && (!wasRevealed || fresh)) {
      const color = cssColor('--ans-' + s.correct);
      const flash = $('#flash');
      flash.style.setProperty('--f', color);
      flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go');
      later(() => FX.sparksAt($('#answers').children[s.correct], { color, count: 90, speed: 1.4 }), 150);
    }

    // Answered dots: update in place so only the dot that changes animates.
    const dots = $('#answered-dots');
    s.teams.forEach((team, i) => {
      let d = dots.children[i];
      if (!d) dots.append(d = h('li', { class: 'dot' }));
      const was = d.classList.contains('on');
      d.className = 'dot' + (team.answered ? ' on' : '') + (team.connected ? '' : ' away') + (team.answered && !was ? ' just' : '');
      d.style.cssText = teamVar(team.color);
      d.title = team.name;
    });
    while (dots.children.length > s.teams.length) dots.lastChild.remove();

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
      const urgent = left < 5000 && left > 0;
      $('#timer').classList.toggle('urgent', urgent);
      document.body.classList.toggle('urgent', urgent);
    });
  }

  function renderScoreboard(s) {
    split($('#sb-title'), t('screen.standingsAfter', { n: s.round.index + 1 }));
    const rows = s.ranking;
    const n = rows.length;
    const list = $('#sb-list');
    list.classList.toggle('two-col', n > 10);
    list.style.setProperty('--n', Math.max(1, n > 10 ? Math.ceil(n / 2) : n));
    // The reveal goes from last place to first: the bottom rows appear first, the leader last.
    const step = Math.min(0.7, 6 / Math.max(1, n));
    list.replaceChildren(...rows.map((r, i) => {
      const moved = r.previousRank ? r.previousRank - r.rank : 0;
      const delay = 0.6 + (n - 1 - i) * step + (i === 0 ? 0.8 : 0);
      const score = h('span', { class: 'score' }, '0');
      countUp(score, r.score, 900, delay * 1000 + 200);
      const row = h('li', { class: 'sb-row' + (r.rank <= 3 ? ` top top${r.rank}` : ''), style: `${teamVar(r.color)}; --d: ${delay}s` },
        h('span', { class: 'rank' }, r.rank === 1 ? h('span', { class: 'crown-wrap' }) : null, r.rank),
        h('span', { class: 'team-dot' }),
        h('span', { class: 'name' }, r.name),
        moved > 0 ? h('span', { class: 'moved up' }, '▲ ' + moved) : moved < 0 ? h('span', { class: 'moved down' }, '▼ ' + -moved) : h('span', { class: 'moved' }),
        score);
      if (r.rank === 1) {
        row.querySelector('.crown-wrap').innerHTML = CROWN;
        later(() => {
          const b = row.getBoundingClientRect();
          const colors = [cssColor('--team-' + r.color), '#f6d48c', '#ffb43c', '#ffffff'];
          FX.confetti({ x: b.left + b.width * 0.25, y: b.top + b.height / 2, colors, count: 90 });
          FX.confetti({ x: b.left + b.width * 0.75, y: b.top + b.height / 2, colors, count: 90 });
        }, (delay + 0.55) * 1000);
      }
      return row;
    }));
  }

  function renderEnd(s) {
    split($('#end-title'), t('screen.winner'));
    const rows = s.ranking;
    const podium = [rows[1], rows[0], rows[2]].filter(Boolean);
    $('#podium').replaceChildren(...podium.map(r => h('div', { class: `step place${r.rank}`, style: teamVar(r.color) },
      h('div', { class: 'who' }, r.rank === 1 ? h('span', { class: 'crown-wrap' }) : null, h('span', { class: 'team-dot' }), h('span', { class: 'name' }, r.name), h('span', { class: 'pts' }, t('screen.points', { n: r.score }))),
      h('div', { class: 'block' }, h('span', { class: 'medal' }, r.rank)))));
    const crown = $('#podium .crown-wrap');
    if (crown) crown.innerHTML = CROWN;
    $('#rest').replaceChildren(...rows.slice(3).map(r => h('li', { style: teamVar(r.color) }, h('span', { class: 'rank' }, r.rank), h('span', { class: 'team-dot' }), r.name, h('span', { class: 'score' }, r.score))));
    const winner = rows[0];
    if (!winner) return;
    // The winner lands at about 2.3 s: cannons from both corners, then confetti rain.
    const colors = [cssColor('--team-' + winner.color), '#f6d48c', '#ffb43c', '#ffffff', '#ff4fa3', '#3ee6ff'];
    later(() => {
      FX.confetti({ x: 0, y: innerHeight, colors, count: 160, spread: 2.6, dir: -Math.PI * 0.3, cone: Math.PI * 0.12 });
      FX.confetti({ x: innerWidth, y: innerHeight, colors, count: 160, spread: 2.6, dir: -Math.PI * 0.7, cone: Math.PI * 0.12 });
      FX.sparksAt($('.place1 .medal'), { color: '#ffcf5a', count: 90, speed: 1.5 });
    }, 2300);
    later(() => FX.rain({ colors, seconds: 6 }), 2700);
  }

})();
