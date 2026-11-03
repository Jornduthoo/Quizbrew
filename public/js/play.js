// The phone. One sentence, one button at a time.
(function () {
  const { $, h, showView, LETTERS, teamVar, countdown, CROWN } = QB;
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
    const key = [s.phase, s.round && s.round.index, s.questionIndex, s.team ? 1 : 0, s.answer, s.blocked, s.wager].join(':');
    const fresh = force || key !== lastKey;
    if (key !== lastKey) window.scrollTo(0, 0);
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
      case 'roundIntro':
        wait(t('play.getReady', { title: s.round.title || t(`round.${s.round.type}`) }));
        return renderJoker(s);
      case 'wager': return renderWager(s, fresh);
      case 'question':
        if (s.blocked) return wait(t('play.blocked'), '!');
        if (s.answer !== null && s.answer !== undefined) return wait(t('play.locked'), lockedBadge(s));
        if (s.question.kind === 'text' || s.question.kind === 'number') return renderType(s, fresh);
        if (['order', 'pairs', 'point'].includes(s.question.kind)) return renderBuild(s, fresh);
        return renderChoices(s, fresh);
      case 'reveal': return renderResult(s, fresh);
      case 'scoreboard':
      case 'end':
        wait(t(s.phase === 'end' ? 'play.finalPlace' : 'play.place', { n: s.team.rank, total: s.team.teams }), '#' + s.team.rank);
        if (s.team.rank === 1) {
          const b = $('#wait-badge');
          b.classList.add('first');
          b.append(h('span', { class: 'badge-crown' }));
          b.lastChild.innerHTML = CROWN;
          if (fresh) setTimeout(() => celebrate(b, s.phase === 'end' ? 2 : 1), 300);
        }
        return;
      default:
    }
  }

  // The badge after locking in: the letter, true/false, or what was typed.
  function lockedBadge(s) {
    const k = s.question.kind;
    if (k === 'choice') return LETTERS[s.answer];
    if (k === 'trueFalse') return s.answer === 0 ? '✓' : '✗';
    if (k === 'order' || k === 'pairs' || k === 'point') return '✓';
    return String(s.answer).slice(0, 14);
  }

  // A joker doubles the points of one round per evening; it can only be played at the start of a round.
  function renderJoker(s) {
    const btn = $('#joker-btn');
    btn.hidden = !s.jokers || !s.team.jokerLeft;
    if (s.jokers && s.team.jokerNow) $('#wait-text').textContent = t('play.jokerPlayed');
  }
  $('#joker-btn').addEventListener('click', () => {
    if (!confirm(t('play.jokerConfirm'))) return;
    socket.emit('joker');
    if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
  });

  function renderWager(s, fresh) {
    showView('wager');
    $('#wager-category').textContent = s.category || t('round.jackpot');
    const range = $('#wager-range');
    if (fresh) {
      range.max = s.maxWager;
      range.value = s.wager !== null && s.wager !== undefined ? s.wager : Math.round(s.maxWager / 2);
    }
    $('#wager-amount').textContent = range.value;
    $('#wager-note').textContent = s.wager !== null && s.wager !== undefined ? t('play.betPlaced', { n: s.wager }) : t('play.betMax', { n: s.maxWager });
  }
  $('#wager-range').addEventListener('input', e => { $('#wager-amount').textContent = e.target.value; });
  $('#wager-send').addEventListener('click', () => {
    socket.emit('wager', Number($('#wager-range').value));
    if (navigator.vibrate) navigator.vibrate(25);
  });

  function renderType(s, fresh) {
    showView('type');
    const number = s.question.kind === 'number';
    $('#t-num').textContent = t('play.questionOf', { n: s.questionIndex + 1, total: s.round.questions });
    if (fresh) {
      const input = $('#type-input');
      input.value = '';
      input.type = number ? 'text' : 'text';
      input.inputMode = number ? 'decimal' : 'text';
      $('#type-label').textContent = t(number ? 'play.typeNumber' : 'play.typeAnswer');
      $('#type-unit').textContent = s.question.unit || '';
      setTimeout(() => input.focus(), 50);
    }
    stopTimer = countdown(s.remaining, s.question.time * 1000, left => {
      $('#t-time').textContent = Math.ceil(left / 1000);
    });
  }
  $('#type-form').addEventListener('submit', e => {
    e.preventDefault();
    const v = $('#type-input').value.trim();
    if (!v) return;
    const number = state.question && state.question.kind === 'number';
    socket.emit('answer', number ? Number(v.replace(/\s/g, '').replace(',', '.')) : v);
    $('#type-input').blur();
    if (navigator.vibrate) navigator.vibrate(25);
  });

  // Order, pairs and pins: the team builds an answer with taps, can undo, and sends it when it is complete.
  let build = [];
  function renderBuild(s, fresh) {
    showView('build');
    const q = s.question;
    $('#b-num').textContent = t('play.questionOf', { n: s.questionIndex + 1, total: s.round.questions });
    if (fresh) build = [];
    drawBuild(q, fresh);
    stopTimer = countdown(s.remaining, q.time * 1000, left => {
      $('#b-time').textContent = Math.ceil(left / 1000);
    });
  }

  function drawBuild(q, enter) {
    const box = $('#build');
    const tap = fn => e => { fn(e); if (navigator.vibrate) navigator.vibrate(15); drawBuild(q); };
    let done = false;
    if (q.kind === 'order') {
      $('#build-label').textContent = t('play.tapOrder');
      box.className = 'build order' + (enter ? ' enter' : '');
      box.replaceChildren(...q.items.map((item, i) => {
        const at = build.indexOf(i);
        return h('button', { type: 'button', class: 'build-item' + (at >= 0 ? ' on' : ''), style: `--k: ${i}`, onclick: tap(() => { if (at < 0) build.push(i); }) },
          h('span', { class: 'build-n' }, at >= 0 ? String(at + 1) : ''), h('span', { class: 'text' }, item));
      }));
      done = build.length === q.items.length;
    } else if (q.kind === 'pairs') {
      const cur = build.length;
      done = cur === q.left.length;
      $('#build-label').textContent = done ? t('play.pairsDone') : t('play.pickPair', { item: q.left[cur] });
      box.className = 'build pairs' + (enter ? ' enter' : '');
      box.replaceChildren(
        h('ol', { class: 'pair-left' }, q.left.map((l, i) => h('li', { class: i === cur ? 'now' : i < cur ? 'set' : '' },
          h('span', { class: 'text' }, l), h('span', { class: 'pair-to' }, i < cur ? q.right[build[i]] : '')))),
        h('div', { class: 'pair-right' }, q.right.map((r, i) => h('button', {
          type: 'button', class: 'build-item' + (build.includes(i) ? ' used' : ''), disabled: done || build.includes(i),
          onclick: tap(() => build.push(i)),
        }, h('span', { class: 'text' }, r)))),
      );
    } else {
      $('#build-label').textContent = t('play.tapSpot');
      box.className = 'build point';
      const pin = build[0];
      const img = h('img', { src: q.image, alt: '', draggable: 'false' });
      const frame = h('div', {
        class: 'pin-frame',
        onclick: tap(e => {
          const r = img.getBoundingClientRect();
          const x = (e.clientX - r.left) / r.width;
          const y = (e.clientY - r.top) / r.height;
          if (x >= 0 && x <= 1 && y >= 0 && y <= 1) build = [{ x, y }];
        }),
      }, img, pin ? h('span', { class: 'pin', style: `left: ${pin.x * 100}%; top: ${pin.y * 100}%` }) : null);
      box.replaceChildren(frame);
      done = !!pin;
    }
    $('#build-send').disabled = !done;
    $('#build-undo').disabled = build.length === 0;
  }
  $('#build-undo').addEventListener('click', () => { build.pop(); if (state && state.question) drawBuild(state.question); });
  $('#build-send').addEventListener('click', () => {
    const q = state && state.question;
    if (!q) return;
    socket.emit('answer', q.kind === 'point' ? build[0] : build.slice());
    if (navigator.vibrate) navigator.vibrate(25);
  });

  // Anti-cheat: leaving the page during a question (switching to a search app) is seen by the quizmaster.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state && state.team && state.phase === 'question') socket.emit('leftPage');
  });

  function wait(text, badge) {
    showView('wait');
    $('#joker-btn').hidden = true;
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
      'aria-label': t(`color.${c}`),
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
      const tf = s.question.kind === 'trueFalse';
      const answers = tf ? [t('play.true'), t('play.false')] : s.question.answers;
      $('#choices').className = 'choices n' + answers.length + (tf ? ' tf' : '') + (s.question.blackout ? ' blackout' : '');
      $('#choices').replaceChildren(...answers.map((a, i) => h('button', {
        class: 'choice', style: tf ? `--k: ${i}` : `--a: var(--ans-${i}); --k: ${i}`,
        onclick: e => {
          e.currentTarget.classList.add('tapped');
          if (navigator.vibrate) navigator.vibrate(25);
          socket.emit('answer', i);
        },
      }, h('span', { class: 'letter' }, tf ? (i === 0 ? '✓' : '✗') : LETTERS[i]), h('span', { class: 'text' }, a))));
    }
    stopTimer = countdown(s.remaining, s.question.time * 1000, left => {
      $('#q-time').textContent = Math.ceil(left / 1000);
    });
  }

  // Brass sparks and gold light in the team colour from an element. Light only, nothing falls.
  function celebrate(el, power) {
    const b = el.getBoundingClientRect();
    const me = getComputedStyle(document.body).getPropertyValue('--me').trim();
    const team = state && state.team ? getComputedStyle(document.body).getPropertyValue('--team-' + state.team.color).trim() : me;
    FX.celebrate({ x: b.left + b.width / 2, y: b.top + b.height / 2, colors: [team], count: 60 * power });
    if (power > 1) FX.glints({ x: innerWidth / 2, y: innerHeight, width: innerWidth, count: 70 });
  }

  function renderResult(s, fresh) {
    showView('reveal');
    const answered = s.answer !== null && s.answer !== undefined;
    const right = !!s.wasCorrect;
    const icon = $('#result-icon');
    icon.className = 'result ' + (right ? 'good' : answered ? 'bad' : 'none');
    const view = $('#v-reveal');
    view.classList.toggle('good-result', right);
    view.classList.toggle('bad-result', answered && !right);
    if (fresh && right) setTimeout(() => celebrate(icon, 1), 200);
    icon.textContent = right ? '✓' : answered ? '✗' : '–';
    $('#result-text').textContent = right ? t(['number', 'point'].includes(s.question.kind) ? 'play.closest' : 'play.correct') : answered ? t('play.wrong') : t('play.noAnswer');
    const k = s.question.kind;
    const solution = k === 'choice' ? t('play.answerWas', { letter: LETTERS[s.correct], text: s.question.answers[s.correct] })
      : k === 'trueFalse' ? t('play.statementWas', { text: t(s.correct === 0 ? 'play.true' : 'play.false') })
        : t('play.solutionWas', { text: s.reveal.answerText + (s.reveal.unit ? ' ' + s.reveal.unit : '') });
    $('#result-sub').textContent = s.lastPoints > 0 ? t('play.pointsWon', { n: s.lastPoints })
      : s.lastPoints < 0 ? `${t('play.pointsLost', { n: -s.lastPoints })} · ${solution}` : solution;
    if (fresh && navigator.vibrate) navigator.vibrate(right ? [40, 60, 40] : 120);
  }
})();
