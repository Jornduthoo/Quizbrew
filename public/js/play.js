// The phone. One sentence, one button at a time.
(function () {
  const { $, h, showView, LETTERS, REACTIONS, teamVar, countdown, CROWN } = QB;
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
  let mode = 'screen';
  socket.on('mode', m => { mode = m; if (state) renderStage(state); });
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
    const key = [s.phase, s.round && s.round.index, s.questionIndex, s.team ? 1 : 0, s.answer, s.blocked, s.wager, s.voted, s.lifelineUsed].join(':');
    document.body.classList.toggle('silent', !!(s.round && s.round.twists.includes('silentRound')));
    const fresh = force || key !== lastKey;
    if (key !== lastKey) window.scrollTo(0, 0);
    lastKey = key;
    if (stopTimer) { stopTimer(); stopTimer = null; }

    renderStage(s);
    $('#react-bar').hidden = !s.team || !REACT_PHASES.includes(s.phase);
    document.body.classList.toggle('reacting', !$('#react-bar').hidden);
    const bar = $('#team-bar');
    bar.hidden = !s.team;
    if (s.team) {
      bar.style.cssText = teamVar(s.team.color);
      $('#bar-dot').replaceWith(Object.assign(QB.dot(s.team), { id: 'bar-dot' }));
      $('#bar-name').textContent = s.team.name;
      $('#bar-score').textContent = t('play.score', { n: s.team.score });
      document.body.style.setProperty('--me', `var(--team-${s.team.color})`);
    }

    if (!s.team) {
      if (s.phase === 'idle') return showView('idle');
      // A teammate can always join a team that is already in, also after the start.
      if (s.phase !== 'lobby' && !(s.teams && s.teams.length)) return wait(t('play.tooLate'));
      showView('join');
      $('#join-form').hidden = s.phase !== 'lobby';
      renderTeamPick(s.teams || []);
      if (s.phase === 'lobby') renderSwatches(s.takenColors);
      return;
    }

    switch (s.phase) {
      case 'idle': return showView('idle');
      case 'lobby':
        wait(t('play.youreIn'));
        $('#photo-later').hidden = false;
        $('#photo-later').textContent = t(s.team.photo ? 'play.teamPhotoChange' : 'play.teamPhotoLater');
        return;
      case 'roundIntro':
        wait(t('play.getReady', { title: s.round.title || t(`round.${s.round.type}`) }));
        return renderJoker(s);
      case 'wager':
        if (s.wagerMode === 'pick' && !s.canWager) return wait(t('play.leaderPicks', { name: s.pick && s.pick.by ? s.pick.by.name : '' }), '?');
        if (s.wagerMode === 'predict' && !s.canWager) return wait(t('play.youreFinalist'), '★');
        return renderWager(s, fresh);
      case 'vote':
        if (s.voted) return wait(t('play.voted'), '✓');
        return renderVote(s, fresh);
      case 'question':
        if (s.blocked) return wait(t('play.blocked'), '!');
        if (s.question.kind === 'turn') return renderTurn(s);
        if (s.out && s.isPicker) return wait(t('play.youPicked'), '★');
        if (s.out && s.finalists && !s.isFinalist) return wait(t('play.watchFinal'), '★');
        if (s.out) return wait(t(s.round.type === 'pushYourLuck' ? 'play.bankedWait' : 'play.outOfRound'), s.round.type === 'pushYourLuck' ? '★' : '✗');
        if (s.banked) return wait(t('play.bankedNow', { n: s.pot }), '★');
        if (s.isActor) return renderActor(s);
        if (s.question.kind === 'buzz') return renderBuzz(s, fresh);
        if (s.answer !== null && s.answer !== undefined && (s.question.kind === 'draw' || s.question.kind === 'photo')) return wait(t('play.sent'), '✓');
        if (s.question.kind === 'draw') return renderDraw(s, fresh);
        if (s.question.kind === 'photo') return renderPhoto(s, fresh);
        if (s.question.kind === 'list') return renderList(s, fresh);
        if (s.answer !== null && s.answer !== undefined) { wait(t('play.locked'), lockedBadge(s)); if (fresh) $('#wait-quip').textContent = QB.quip('locked'); return; }
        if (s.question.kind === 'text' || s.question.kind === 'number') return renderType(s, fresh);
        if (['order', 'pairs', 'point'].includes(s.question.kind)) return renderBuild(s, fresh);
        return renderChoices(s, fresh);
      case 'reveal': return renderResult(s, fresh);
      case 'awards': {
        const mine = (s.awards || []).filter(a => a.team.name === s.team.name);
        wait(t('play.awards'), mine.length ? '★' : '✦');
        if (mine.length) $('#wait-quip').textContent = mine.map(a => t('play.youWon', { title: t(`award.${a.id}`) })).join(' · ');
        return;
      }
      case 'scoreboard':
      case 'end':
        wait(t(s.phase === 'end' ? 'play.finalPlace' : 'play.place', { n: s.team.rank, total: s.team.teams }), '#' + s.team.rank);
        renderStandings(s.standings);
        // After the last question every player sees where the quiz came from.
        $('#made-with').hidden = s.phase !== 'end';
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
    if (k === 'level') return LETTERS[s.answer.i];
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
    const mode = s.wagerMode;
    const level = mode === 'level';
    const choose = mode === 'pick' || mode === 'predict';
    $('#wager-kicker').textContent = t(level ? 'screen.pickLevel' : mode === 'pick' ? 'play.pickFor' : mode === 'predict' ? 'play.predictKicker' : 'play.wagerKicker');
    $('#bet-box').hidden = level || choose;
    $('#level-picks').hidden = !level;
    $('#pick-list').hidden = !choose;
    if (choose) {
      // Your pick: a category for the others. Head to head: the finalist you back.
      const opts = mode === 'pick' ? s.pick.categories.map(c => ({ label: c })) : (s.finalists || []).map(f => ({ label: f.name, color: f.color }));
      $('#wager-category').textContent = mode === 'pick' ? t('round.opponentsPick') : (s.finalists || []).map(f => f.name).join(` ${t('screen.vs')} `);
      // Redraw only for a new choice, so the buttons do not replay their entrance on every update.
      const list = $('#pick-list');
      if (list.children.length === opts.length && list.dataset.q === lastKey.split(':').slice(1, 3).join(':')) {
        [...list.children].forEach((b, i) => b.classList.toggle('on', s.wager === i));
      } else list.replaceChildren(...opts.map((o, i) => h('button', {
        type: 'button', class: 'level-pick' + (s.wager === i ? ' on' : ''), style: `--k: ${i}` + (o.color ? `; ${teamVar(o.color)}` : ''),
        onclick: () => { socket.emit('wager', i); if (navigator.vibrate) navigator.vibrate(20); },
      }, o.color ? h('i', { class: 'team-dot' }) : null, h('strong', {}, o.label))));
      list.dataset.q = lastKey.split(':').slice(1, 3).join(':');
      const chosen = s.wager !== null && s.wager !== undefined ? opts[s.wager] : null;
      $('#wager-note').textContent = chosen ? t(mode === 'pick' ? 'play.picked' : 'play.predicted', { name: chosen.label }) : '';
      return;
    }
    if (level) {
      $('#wager-category').textContent = s.category || t('round.pickYourLevel');
      $('#level-picks').replaceChildren(...[0, 1, 2].map(l => h('button', {
        type: 'button', class: 'level-pick' + (s.wager === l ? ' on' : ''), style: `--k: ${l}`,
        onclick: () => { socket.emit('wager', l); if (navigator.vibrate) navigator.vibrate(20); },
      }, h('strong', {}, t(`play.level${l}`)), h('span', {}, t('play.levelPoints', { n: (l + 1) * (s.levelBase || 1) })))));
      $('#wager-note').textContent = s.wager !== null && s.wager !== undefined ? t('play.levelPicked', { level: t(`play.level${s.wager}`) }) : t('play.pickLevel');
      return;
    }
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
      const label = { bluffBank: 'play.typeBluff', captionThis: 'play.typeCaption', whosWho: 'play.typeAboutUs' }[s.round.type];
      $('#type-label').textContent = t(label || (number ? 'play.typeNumber' : 'play.typeAnswer'));
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

  // Act it out: the secret, big, only on the acting team's phone.
  function renderActor(s) {
    showView('actor');
    $('#actor-secret').textContent = s.secret || '';
  }

  // Drawing: a few neon pens on a dark board; strokes are kept so undo works.
  const PENS = ['#fff6e0', '#ffb43c', '#ff4fa3', '#3ee6ff', '#a8ff3e', '#ff5a5a', '#1a0e08'];
  let strokes = [];
  let pen = PENS[0];
  function renderDraw(s, fresh) {
    showView('draw');
    $('#d-num').textContent = s.question.text;
    if (fresh) {
      strokes = [];
      $('#draw-tools').replaceChildren(...PENS.map(c => h('button', {
        type: 'button', class: 'pen' + (c === pen ? ' on' : ''), style: `--pen: ${c}`, 'aria-label': c,
        onclick: e => { pen = c; [...$('#draw-tools').children].forEach(b => b.classList.toggle('on', b === e.currentTarget)); },
      })));
      requestAnimationFrame(redraw);
    }
    stopTimer = countdown(s.remaining, s.question.time * 1000, left => { $('#d-time').textContent = Math.ceil(left / 1000); });
  }
  function redraw() {
    const c = $('#draw-canvas');
    const w = c.clientWidth;
    if (!w) return;
    if (c.width !== w * 2) { c.width = w * 2; c.height = c.clientHeight * 2; }
    const g = c.getContext('2d');
    g.fillStyle = '#120a06';
    g.fillRect(0, 0, c.width, c.height);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const st of strokes) {
      g.strokeStyle = st.c;
      g.lineWidth = st.c === '#1a0e08' ? 40 : 12;
      g.beginPath();
      st.p.forEach(([x, y], i) => (i ? g.lineTo(x * c.width, y * c.height) : g.moveTo(x * c.width, y * c.height)));
      if (st.p.length === 1) g.lineTo(st.p[0][0] * c.width + 0.1, st.p[0][1] * c.height);
      g.stroke();
    }
  }
  (() => {
    const c = $('#draw-canvas');
    let cur = null;
    const at = e => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
    c.addEventListener('pointerdown', e => { c.setPointerCapture(e.pointerId); cur = { c: pen, p: [at(e)] }; strokes.push(cur); redraw(); });
    c.addEventListener('pointermove', e => { if (cur) { cur.p.push(at(e)); redraw(); } });
    const end = () => { cur = null; };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  })();
  $('#draw-undo').addEventListener('click', () => { strokes.pop(); redraw(); });
  $('#draw-clear').addEventListener('click', () => { strokes = []; redraw(); });
  $('#draw-send').addEventListener('click', () => {
    if (!strokes.length) return;
    // A small copy (600 px wide) goes to the laptop.
    const src = $('#draw-canvas');
    const out = document.createElement('canvas');
    out.width = 600;
    out.height = Math.round(600 * src.height / src.width);
    out.getContext('2d').drawImage(src, 0, 0, out.width, out.height);
    let url = out.toDataURL('image/webp', 0.8);
    if (!url.startsWith('data:image/webp')) url = out.toDataURL('image/png');
    socket.emit('answer', url);
    if (navigator.vibrate) navigator.vibrate(25);
  });

  // Photo: the phone camera; the picture is made small (900 px, webp) before it is sent.
  let photoUrl = null;
  function renderPhoto(s, fresh) {
    showView('photo');
    $('#p-num').textContent = s.question.text;
    if (fresh) {
      photoUrl = null;
      $('#photo-preview').hidden = true;
      $('#photo-label').hidden = false;
      $('#photo-send').disabled = true;
    }
    stopTimer = countdown(s.remaining, s.question.time * 1000, left => { $('#p-time').textContent = Math.ceil(left / 1000); });
  }
  $('#photo-input').addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try {
      const bmp = await createImageBitmap(f);
      const k = Math.min(1, 900 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * k);
      c.height = Math.round(bmp.height * k);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      photoUrl = c.toDataURL('image/webp', 0.78);
      if (!photoUrl.startsWith('data:image/webp')) photoUrl = c.toDataURL('image/jpeg', 0.8);
      $('#photo-preview').src = photoUrl;
      $('#photo-preview').hidden = false;
      $('#photo-label').hidden = true;
      $('#photo-send').disabled = false;
    } catch { alert(t('play.photoFailed')); }
  });
  $('#photo-send').addEventListener('click', () => {
    if (!photoUrl) return;
    socket.emit('answer', photoUrl);
    if (navigator.vibrate) navigator.vibrate(25);
  });

  // Vote: tap the best entry (or the truth). Who's who: give every answer a team colour.
  let matchPick = [];
  function renderVote(s, fresh) {
    showView('vote');
    const mode = s.vote.mode;
    $('#v-label').textContent = t(mode === 'truth' ? 'play.findTruth' : mode === 'match' ? 'play.matchTeams' : 'play.voteBest');
    if (fresh) matchPick = s.ballot.map(() => null);
    const box = $('#ballot');
    box.className = 'ballot ' + mode;
    if (mode === 'match') {
      box.replaceChildren(...s.ballot.map((b, i) => (b.mine ? null : h('div', { class: 'match-row' },
        h('p', { class: 'match-text' }, b.content),
        h('div', { class: 'match-teams' }, s.teamsToMatch.map(tm => h('button', {
          type: 'button', class: 'match-team' + (matchPick[i] === tm.color ? ' on' : ''), style: teamVar(tm.color),
          onclick: () => { matchPick[i] = tm.color; renderVote(state); },
        }, tm.name)))))).filter(Boolean));
      $('#match-send').hidden = false;
      $('#match-send').disabled = s.ballot.some((b, i) => !b.mine && !matchPick[i]);
    } else {
      $('#match-send').hidden = true;
      box.replaceChildren(...s.ballot.map((b, i) => h('button', {
        type: 'button', class: 'ballot-item' + (b.mine ? ' mine' : '') + (b.image ? ' pic' : ''), disabled: b.mine, style: `--k: ${i}`,
        onclick: () => { socket.emit('vote', i); if (navigator.vibrate) navigator.vibrate(25); },
      }, h('span', { class: 'letter' }, LETTERS[i] || i + 1), b.image ? h('img', { src: b.content, alt: '' }) : h('span', { class: 'text' }, b.content),
      b.mine ? h('span', { class: 'mine-tag' }, t('play.yours')) : null)));
    }
    stopTimer = countdown(s.remaining, s.vote.time * 1000, left => { $('#v-time').textContent = Math.ceil(left / 1000); });
  }
  $('#match-send').addEventListener('click', () => {
    socket.emit('vote', matchPick.map(c => c || ''));
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
    $('#wait-quip').textContent = '';
    $('#standings').hidden = true;
    $('#made-with').hidden = true;
    $('#photo-later').hidden = true;
  }

  // Team photo: a selfie, cut to a square of 360 px. Picked before joining it goes along right after the join.
  let pendingPhoto = null;
  async function squarePhoto(file) {
    const bmp = await createImageBitmap(file);
    const side = Math.min(bmp.width, bmp.height);
    const c = document.createElement('canvas');
    c.width = c.height = 360;
    c.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 360, 360);
    const url = c.toDataURL('image/webp', 0.8);
    return url.startsWith('data:image/webp') ? url : c.toDataURL('image/jpeg', 0.82);
  }
  $('#tp-input').addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const url = await squarePhoto(f);
      if (state && state.team) return socket.emit('photo', url);
      pendingPhoto = url;
      $('#tp-face').style.backgroundImage = `url("${url}")`;
      $('#tp-label').classList.add('has');
    } catch { /* not a picture */ }
  });
  $('#photo-later').addEventListener('click', () => $('#tp-input').click());

  function renderStandings(rows) {
    const list = $('#standings');
    if (!rows || rows.length < 2) return;
    list.hidden = false;
    list.replaceChildren(...rows.map((r, i) => {
      const rank = h('span', { class: 'st-rank' }, String(r.rank));
      if (r.rank === 1) rank.innerHTML = CROWN;
      return h('li', { class: 'st-row' + (r.me ? ' me' : ''), style: teamVar(r.color) + `; --k: ${i}` },
        rank, h('span', { class: 'st-name' }, QB.dot(r), ' ', r.name), h('span', { class: 'st-score' }, String(r.score)));
    }));
  }

  // Phones-only mode: the big screen itself, small, on top of the phone (muted: the laptop plays the sound).
  const STAGE_W = 1280;
  const STAGE_H = 720;
  const STAGE_PHASES = ['roundIntro', 'wager', 'question', 'reveal', 'vote', 'scoreboard', 'end'];
  function renderStage(s) {
    const on = mode === 'phones' && !!s.team && STAGE_PHASES.includes(s.phase);
    const box = $('#stage');
    box.hidden = !on;
    document.body.classList.toggle('staged', on);
    if (!on) { box.classList.remove('big'); return; }
    const frame = $('#stage-frame');
    if (!frame.getAttribute('src')) frame.src = '/screen?mute&fx=low';
    fitStage();
  }
  function fitStage() {
    const box = $('#stage');
    const frame = $('#stage-frame');
    if (box.hidden) return;
    const big = box.classList.contains('big');
    const k = big ? Math.min(innerWidth / STAGE_W, innerHeight / STAGE_H) : box.clientWidth / STAGE_W;
    frame.style.width = STAGE_W + 'px';
    frame.style.height = STAGE_H + 'px';
    frame.style.transform = `scale(${k})`;
    frame.style.left = big ? `${(innerWidth - STAGE_W * k) / 2}px` : '0';
    frame.style.top = big ? `${(innerHeight - STAGE_H * k) / 2}px` : '0';
  }
  addEventListener('resize', fitStage);
  $('#stage-tap').addEventListener('click', () => { $('#stage').classList.add('big'); fitStage(); });
  $('#stage-close').addEventListener('click', () => { $('#stage').classList.remove('big'); fitStage(); });

  // Reactions: tap an emoji and it floats up on the big screen. Not during a question, so nobody is distracted.
  const REACT_PHASES = ['lobby', 'roundIntro', 'reveal', 'scoreboard', 'awards', 'end'];
  REACTIONS.forEach((emoji, i) => {
    const b = h('button', { type: 'button', class: 'react-btn' }, emoji);
    b.addEventListener('click', () => {
      if (b.classList.contains('cool')) return;
      socket.emit('react', i);
      b.classList.remove('sent');
      void b.offsetWidth;
      b.classList.add('sent', 'cool');
      setTimeout(() => b.classList.remove('cool'), 600);
      if (navigator.vibrate) navigator.vibrate(15);
    });
    $('#react-bar').append(b);
  });

  // Join a team that is already in: this phone then plays along with that team.
  function renderTeamPick(teams) {
    $('#join-team').hidden = !teams.length;
    $('#team-pick').replaceChildren(...teams.map(x => h('button', {
      type: 'button', class: 'team-chip', style: teamVar(x.color),
      onclick: () => {
        if (!confirm(t('play.joinTeamSure', { name: x.name }))) return;
        socket.emit('join', { teamId: x.id }, res => {
          if (res.error) return ($('#pick-error').textContent = t(res.error));
          teamId = x.id;
          store.set('qb.teamId', teamId);
          socket.io.opts.query = { ...socket.io.opts.query, teamId };
          if (navigator.vibrate) navigator.vibrate(30);
        });
      },
    }, h('span', { class: 'dot' }), x.name)));
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
      if (res.error) return ($('#join-error').textContent = t(res.error));
      if (pendingPhoto) { socket.emit('photo', pendingPhoto); pendingPhoto = null; }
      if (navigator.vibrate) navigator.vibrate(30);
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
    // Shrinking options and the 50/50 lifeline: answers that are gone can not be tapped.
    const gone = new Set(s.question.gone || []);
    [...$('#choices').children].forEach((b, i) => { b.classList.toggle('gone', gone.has(i)); b.disabled = gone.has(i); });
    $('#lifeline-btn').hidden = !s.canLifeline;
    const own = s.question.kind === 'level';
    $('#phone-q').hidden = !own;
    if (own) $('#phone-q').textContent = s.question.text;
    $('#q-extra').textContent = s.round.type === 'pushYourLuck' ? t('play.pot', { n: s.pot }) : s.round.type === 'hotStreak' && s.streak ? t('play.streak', { n: s.streak + 1 }) : own ? t(`play.level${s.question.level}`) : '';
    $('#bank-btn').hidden = !s.canBank;
    if (s.canBank) $('#bank-btn').textContent = t('play.bank', { n: s.pot });
    stopTimer = countdown(s.remaining, s.question.time * 1000, left => {
      $('#q-time').textContent = Math.ceil(left / 1000);
    });
  }
  $('#lifeline-btn').addEventListener('click', () => {
    if (!confirm(t('play.lifelineConfirm'))) return;
    socket.emit('lifeline');
    if (navigator.vibrate) navigator.vibrate([20, 30, 20]);
  });

  // Clock rounds: your own clock big on the phone, or whose turn it is.
  function renderTurn(s) {
    showView('turn');
    const mine = s.clocks && s.clocks.find(c => c.name === s.team.name);
    const view = $('#v-turn');
    view.classList.toggle('mine', !!s.myTurn);
    view.style.cssText = s.turn ? teamVar(s.turn.color) : '';
    $('#turn-label').textContent = s.myTurn ? t('play.yourTurn') : s.turn ? t('play.theirTurn', { name: s.turn.name }) : '';
    $('#turn-clock').hidden = !mine;
    $('#turn-sub').textContent = mine && mine.ms <= 0 ? t('play.clockOut') : '';
    if (!mine) return;
    const fmt = ms => (ms / 1000).toFixed(ms < 10000 ? 1 : 0);
    $('#turn-num').textContent = fmt(mine.ms);
    if (mine.running) {
      if (navigator.vibrate) navigator.vibrate(60);
      stopTimer = countdown(mine.ms, mine.ms, left => { $('#turn-num').textContent = fmt(left); });
    }
  }

  $('#bank-btn').addEventListener('click', () => {
    if (!confirm(t('play.bankConfirm', { n: state.pot }))) return;
    socket.emit('bank');
    if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
  });

  // Buzzer: whoever presses first gets the floor.
  function renderBuzz(s, fresh) {
    showView('buzz');
    $('#z-num').textContent = t('play.questionOf', { n: s.questionIndex + 1, total: s.round.questions });
    const btn = $('#buzz-btn');
    const mine = s.buzzMine;
    btn.disabled = !!s.buzz || s.buzzOut;
    btn.classList.toggle('mine', mine);
    $('#buzz-text').textContent = mine ? t('play.buzzMine') : s.buzz ? t('play.buzzOther', { name: s.buzz.name }) : s.buzzOut ? t('play.buzzOut') : '';
    if (mine && fresh && navigator.vibrate) navigator.vibrate([60, 40, 60]);
    if (s.paused) { $('#z-time').textContent = Math.ceil(s.remaining / 1000); return; }
    stopTimer = countdown(s.remaining, s.question.time * 1000, left => { $('#z-time').textContent = Math.ceil(left / 1000); });
  }
  $('#buzz-btn').addEventListener('click', e => {
    e.currentTarget.classList.add('pressed');
    socket.emit('answer', true);
    if (navigator.vibrate) navigator.vibrate(40);
    setTimeout(() => $('#buzz-btn').classList.remove('pressed'), 300);
  });

  // List rush: every line is sent at once and added to the team's list.
  function renderList(s, fresh) {
    showView('list');
    $('#l-num').textContent = t('play.questionOf', { n: s.questionIndex + 1, total: s.round.questions });
    const sent = s.answer || [];
    $('#l-count').textContent = t('play.itemsSent', { n: sent.length });
    $('#list-sent').replaceChildren(...sent.slice().reverse().map((x, i) => h('li', { class: i === 0 && fresh ? 'new' : '' }, x)));
    if (fresh) setTimeout(() => $('#list-input').focus(), 50);
    stopTimer = countdown(s.remaining, s.question.time * 1000, left => { $('#l-time').textContent = Math.ceil(left / 1000); });
  }
  $('#list-form').addEventListener('submit', e => {
    e.preventDefault();
    const input = $('#list-input');
    const v = input.value.trim();
    if (!v) return;
    socket.emit('answer', v);
    input.value = '';
    if (navigator.vibrate) navigator.vibrate(15);
  });

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
    const predictor = s.finalists && !s.isFinalist && s.wager !== null && s.wager !== undefined;
    const answered = (s.answer !== null && s.answer !== undefined) || predictor;
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
    if (k === 'list') $('#result-text').textContent = t('play.found', { n: s.found || 0 });
    if (s.vote) $('#result-text').textContent = s.lastPoints > 0 ? t('play.votesWon', { n: s.lastPoints }) : t('play.noVotes');
    if (k === 'turn' && !s.myTurn && !s.lastPoints) $('#result-text').textContent = s.turn ? t('play.theirTurn', { name: s.turn.name }) : '';
    if (s.isPicker && !answered) $('#result-text').textContent = t('play.youPicked');
    const solution = s.round.type === 'bluffBank' ? t('play.truthWas', { text: s.reveal.answerText })
      : s.vote || s.round.type === 'actItOut' && s.isActor ? ''
        : k === 'list' ? ''
      : s.round.type === 'crowdMind' ? t('play.crowdSaid', { text: s.reveal.answerText })
        : k === 'level' ? t('play.solutionWas', { text: s.reveal.levels[s.question.level].answer })
          : k === 'buzz' ? (s.reveal.answerText ? t('play.solutionWas', { text: s.reveal.answerText }) : '')
            : k === 'choice' ? t('play.answerWas', { letter: LETTERS[s.correct], text: s.question.answers[s.correct] })
      : k === 'trueFalse' ? t('play.statementWas', { text: t(s.correct === 0 ? 'play.true' : 'play.false') })
        : t('play.solutionWas', { text: s.reveal.answerText + (s.reveal.unit ? ' ' + s.reveal.unit : '') });
    if (fresh) $('#result-quip').textContent = QB.quip(right ? 'correct' : answered ? 'wrong' : 'late');
    $('#result-sub').textContent = s.lastPoints > 0 ? t('play.pointsWon', { n: s.lastPoints })
      : s.lastPoints < 0 ? `${t('play.pointsLost', { n: -s.lastPoints })} · ${solution}` : solution;
    if (fresh && navigator.vibrate) navigator.vibrate(right ? [40, 60, 40] : 120);
  }
})();
