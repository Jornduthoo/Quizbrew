// The phone. One sentence, one button at a time.
(function () {
  const { $, h, showView, LETTERS, teamVar, countdown } = QB;
  const store = {
    get: k => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
    del: k => { try { localStorage.removeItem(k); } catch { /* private mode */ } },
  };
  const newId = () => Array.from(crypto.getRandomValues ? crypto.getRandomValues(new Uint8Array(12)) : Array.from({ length: 12 }, () => Math.random() * 256), b => (b & 255).toString(36).padStart(2, '0')).join('').slice(0, 20);

  let teamId = store.get('qb.teamId') || newId();
  store.set('qb.teamId', teamId);

  let state = null;
  let colors = [];
  let picked = null;
  let deviceLang = null;
  let stopTimer = null;
  let lastKey = '';

  const socket = io({ query: { role: 'player', teamId } });
  socket.on('connect', () => { $('#offline').hidden = true; });
  socket.on('disconnect', () => { $('#offline').hidden = false; });
  socket.on('language', lang => { if (!deviceLang) I18n.load(lang).then(() => state && render(state, true)); });
  socket.on('state', s => { state = s; if (I18n.dict['app.name']) render(s); });
  socket.on('kicked', () => {
    store.del('qb.teamId');
    teamId = newId();
    store.set('qb.teamId', teamId);
    location.reload();
  });

  QB.info().then(info => {
    colors = info.colors;
    deviceLang = I18n.deviceLanguage(info.languages.map(l => l.code));
    return I18n.load(deviceLang || info.language);
  }).then(() => state && render(state, true));

  function render(s, force) {
    const key = [s.phase, s.round && s.round.index, s.questionIndex, s.team ? 1 : 0, s.answer].join(':');
    const fresh = force || key !== lastKey;
    lastKey = key;
    if (stopTimer) { stopTimer(); stopTimer = null; }

    const bar = $('#team-bar');
    bar.hidden = !s.team;
    if (s.team) {
      bar.style.cssText = teamVar(s.team.color);
      $('#bar-name').textContent = s.team.name;
      $('#bar-score').textContent = t('play.score', { n: s.team.score });
      document.body.style.setProperty('--me', `var(--team-${s.team.color})`);
    }

    if (!s.team) {
      if (s.phase === 'idle') return showView('idle');
      if (s.phase === 'lobby') { showView('join'); return renderSwatches(s.takenColors); }
      return wait(t('play.tooLate'));
    }

    switch (s.phase) {
      case 'idle': return showView('idle');
      case 'lobby': return wait(t('play.youreIn'));
      case 'roundIntro': return wait(t('play.getReady', { title: s.round.title }));
      case 'question':
        if (s.answer !== null && s.answer !== undefined) return wait(t('play.locked'), LETTERS[s.answer]);
        return renderChoices(s, fresh);
      case 'reveal': return renderResult(s, fresh);
      case 'scoreboard':
      case 'end':
        return wait(t(s.phase === 'end' ? 'play.finalPlace' : 'play.place', { n: s.team.rank, total: s.team.teams }), '#' + s.team.rank);
      default:
    }
  }

  function wait(text, badge) {
    showView('wait');
    const b = $('#wait-badge');
    b.textContent = badge || (state && state.team ? state.team.name.charAt(0).toUpperCase() : '');
    b.className = 'badge' + (badge ? ' filled' : ' pulse');
    $('#wait-text').textContent = text;
  }

  function renderSwatches(taken) {
    if (picked && taken.includes(picked)) picked = null;
    if (!picked) picked = colors.find(c => !taken.includes(c)) || null;
    $('#swatches').replaceChildren(...colors.map(c => h('button', {
      type: 'button',
      class: 'swatch' + (c === picked ? ' on' : ''),
      style: teamVar(c),
      disabled: taken.includes(c),
      'aria-label': t('color.' + c),
      'aria-pressed': c === picked ? 'true' : 'false',
      onclick: () => { picked = c; renderSwatches(state.takenColors); },
    })));
    document.body.style.setProperty('--me', picked ? `var(--team-${picked})` : 'var(--brass)');
  }

  $('#join-form').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('#team-name').value.trim();
    $('#join-error').textContent = '';
    if (!name) return ($('#join-error').textContent = t('error.nameEmpty'));
    socket.emit('join', { teamId, name, color: picked }, res => {
      if (res.error) $('#join-error').textContent = t(res.error);
      else if (navigator.vibrate) navigator.vibrate(30);
    });
  });

  function renderChoices(s, fresh) {
    showView('question');
    $('#q-num').textContent = t('play.questionOf', { n: s.questionIndex + 1, total: s.round.questions });
    if (fresh) {
      $('#choices').className = 'choices n' + s.question.answers.length;
      $('#choices').replaceChildren(...s.question.answers.map((a, i) => h('button', {
        class: 'choice', style: `--a: var(--ans-${i})`,
        onclick: e => {
          e.currentTarget.classList.add('tapped');
          if (navigator.vibrate) navigator.vibrate(25);
          socket.emit('answer', i);
        },
      }, h('span', { class: 'letter' }, LETTERS[i]), h('span', { class: 'text' }, a))));
    }
    stopTimer = countdown(s.remaining, s.question.time * 1000, left => {
      $('#q-time').textContent = Math.ceil(left / 1000);
    });
  }

  function renderResult(s, fresh) {
    showView('reveal');
    const answered = s.answer !== null && s.answer !== undefined;
    const right = answered && s.answer === s.correct;
    const icon = $('#result-icon');
    icon.className = 'result ' + (right ? 'good' : answered ? 'bad' : 'none');
    icon.textContent = right ? '✓' : answered ? '✗' : '–';
    $('#result-text').textContent = right ? t('play.correct') : answered ? t('play.wrong') : t('play.noAnswer');
    $('#result-sub').textContent = right
      ? t('play.pointsWon', { n: s.lastPoints })
      : t('play.answerWas', { letter: LETTERS[s.correct], text: s.question.answers[s.correct] });
    if (fresh && navigator.vibrate) navigator.vibrate(right ? [40, 60, 40] : 120);
  }
})();
