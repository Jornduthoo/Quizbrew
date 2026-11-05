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
    renderModes();
    renderLocks();
    if (licFull) renderProState();
    if (state) render(state);
    loadQuizzes();
    // The run sheet and the builder send the demo here: /host#pro or /host#pro-<feature>.
    const ask = /^#pro(?:-(\w+))?$/.exec(location.hash);
    if (ask && !remote) { history.replaceState(null, '', '/host'); openPro(ask[1]); }
  });
  socket.on('state', s => { state = s; if (I18n.dict['app.name']) render(s); });

  // The remote phone may sleep or lose the wifi: show it, and connect again as soon as it is back.
  if (remote) {
    const banner = $('#remote-offline');
    const show = key => { banner.textContent = key ? t(key) : ''; banner.hidden = !key; };
    socket.on('connect', () => show(null));
    socket.on('disconnect', reason => {
      // The server sends us away when the secret key is wrong: Quizbrew was restarted and has a new link.
      show(reason === 'io server disconnect' ? 'host.remoteExpired' : 'play.reconnecting');
    });
    const retry = () => { if (!document.hidden && !socket.connected) socket.connect(); };
    document.addEventListener('visibilitychange', retry);
    addEventListener('online', retry);
    addEventListener('pageshow', retry);
  }

  // Anti-cheat notices: a team left the quiz page, or came back. On the laptop and on the remote.
  socket.on('alert', n => {
    if (!n || !I18n.dict['app.name']) return;
    const stack = $('#alerts');
    const text = n.kind === 'lifeline' ? t('host.alertLifeline', { name: n.name }) : n.kind === 'sleep' ? t('host.alertSleep', { name: n.name }) : n.kind === 'back'
      ? t('host.alertBack', { name: n.name, n: n.seconds })
      : t(n.blocked ? 'host.alertBlocked' : 'host.alertLeft', { name: n.name }) + (n.count > 1 ? ' ' + t('host.alertTimes', { n: n.count }) : '');
    const toast = h('div', { class: 'alert ' + n.kind, style: teamVar(n.color), role: 'alert' }, h('span', { class: 'icon' }, n.kind === 'lifeline' ? '🛟' : n.kind === 'sleep' ? '💤' : n.kind === 'back' ? '↩' : '👀'), h('span', {}, text));
    stack.prepend(toast);
    if (n.kind === 'left' && navigator.vibrate) navigator.vibrate(200);
    setTimeout(() => toast.classList.add('out'), n.kind === 'left' ? 9000 : 5000);
    setTimeout(() => toast.remove(), n.kind === 'left' ? 9600 : 5600);
    while (stack.children.length > 5) stack.lastChild.remove();
  });

  QB.info().then(info => {
    languages = info.languages;
    joinInfo = info;
    if (state) render(state);
    $('#lang').replaceChildren(...languages.map(l => h('option', { value: l.code }, l.name)));
    $('#lang').value = I18n.lang;
    $('#join-url').textContent = info.url.replace(/^https?:\/\//, '');
    looks = info.looks;
    renderLooks();
    modes = info.modes;
    renderModes(info.mode);
  });
  // The quizmaster picked another address (or the first phone came in on another one): new QR code everywhere.
  socket.on('joinInfo', j => {
    if (!joinInfo) return;
    joinInfo = { ...joinInfo, ...j };
    $('#join-url').textContent = j.url.replace(/^https?:\/\//, '');
    if (state) render(state);
  });
  let looks = [];
  function renderLooks() {
    const cur = document.documentElement.dataset.look;
    $('#look').replaceChildren(...looks.map(l => h('option', { value: l }, (lookLocked(l) ? '🔒 ' : '') + t('look.' + l))));
    $('#look').value = cur;
  }
  $('#look').addEventListener('change', e => {
    if (lookLocked(e.target.value)) { e.target.value = document.documentElement.dataset.look; return openPro('looks'); }
    socket.emit('look', e.target.value);
  });
  // Big screen, or phones only: then this laptop shows (and sounds) what the phones show.
  let modes = [];
  let mode = 'screen';
  function renderModes(cur) {
    mode = cur || mode;
    $('#mode').replaceChildren(...modes.map(m => h('option', { value: m }, t('mode.' + m))));
    $('#mode').value = mode;
    renderCopy();
  }
  function renderCopy() {
    const box = document.getElementById('screen-copy');
    if (!box) return;
    const on = mode === 'phones' && !!state && state.phase !== 'idle';
    box.hidden = !on;
    const frame = $('#screen-copy-frame');
    if (!on) return;
    if (!frame.getAttribute('src')) frame.src = '/screen?fx=low';
    frame.style.transform = `scale(${box.clientWidth / 1280})`;
  }
  addEventListener('resize', renderCopy);
  $('#mode').addEventListener('change', e => socket.emit('mode', e.target.value));
  socket.on('mode', m => renderModes(m));
  // Sound effects on the big screen: on or off for the whole evening.
  let sfxOn = true;
  const renderSfx = () => {
    $('#sfx').innerHTML = Menu.icon(sfxOn ? 'sound' : 'mute');
    $('#sfx').classList.toggle('off', !sfxOn);
    $('#sfx').setAttribute('aria-pressed', String(sfxOn));
  };
  socket.on('sfx', v => { sfxOn = !!v; renderSfx(); });
  $('#sfx').addEventListener('click', () => socket.emit('sfx', !sfxOn));
  socket.on('look', l => { $('#look').value = l; });
  $('#lang').addEventListener('change', e => socket.emit('language', e.target.value));
  if (!remote) {
    $('#remote-tile').addEventListener('click', e => { e.stopPropagation(); $('#remote-btn').click(); scrollTo({ top: 0, behavior: 'smooth' }); });
    $('#remote-btn').addEventListener('click', async () => {
      if (!togglePop('#remote-pop') || $('#remote-qr').innerHTML) return;
      const r = await fetch('/api/host/remote').then(x => x.json());
      $('#remote-qr').innerHTML = r.qr;
      $('#remote-url').textContent = r.url;
    });
  }

  // The pop-ups in the top bar: one at a time.
  const pops = ['#remote-pop', '#check-pop', '#raffle-pop'];
  const togglePop = sel => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const open = el.hidden;
    pops.forEach(p => { const x = document.querySelector(p); if (x) x.hidden = true; });
    el.hidden = !open;
    return open;
  };

  // Connection test: every phone that opens the QR link shows up here.
  if ($('#check-btn')) {
    $('#check-btn').addEventListener('click', async () => {
      if (!togglePop('#check-pop') || $('#check-qr').innerHTML) return;
      const r = await fetch('/api/host/check').then(x => x.json());
      $('#check-qr').innerHTML = r.qr;
      $('#check-addr').textContent = t('host.checkAddress', { url: r.url });
      // No phone after 20 seconds: open the tips.
      setTimeout(() => { if (!$('#check-hits').children.length) $('#check-tips').open = true; }, 20000);
    });
    socket.on('checkHit', hit => {
      const time = new Date(hit.at).toLocaleTimeString(I18n.lang, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      $('#check-hits').prepend(h('li', {}, h('span', { class: 'ok' }, '✓'), ` ${hit.device} `, h('span', { class: 'hint' }, time)));
      $('#check-status').textContent = t('host.checkOk', { n: $('#check-hits').children.length });
      $('#check-status').classList.add('good');
    });
  }

  // Raffle: teams or ticket numbers; the big screen spins it out.
  if ($('#raffle-btn')) {
    let raffleMode = 'teams';
    $('#raffle-btn').addEventListener('click', () => togglePop('#raffle-pop'));
    $('#raffle-mode').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      raffleMode = b.dataset.mode;
      [...$('#raffle-mode').children].forEach(x => x.classList.toggle('on', x === b));
      $('#raffle-range').hidden = raffleMode !== 'tickets';
    });
    $('#raffle-draw').addEventListener('click', () => {
      $('#raffle-error').textContent = '';
      socket.emit('raffle', { mode: raffleMode, from: $('#raffle-from').value, to: $('#raffle-to').value }, r => {
        if (r && r.error) $('#raffle-error').textContent = t(r.error);
      });
    });
    $('#raffle-hide').addEventListener('click', () => socket.emit('raffleHide'));
    $('#raffle-reset').addEventListener('click', () => socket.emit('raffleReset'));
    socket.on('raffleState', ({ winners }) => {
      $('#raffle-winners').replaceChildren(...winners.map((w, i) => h('li', { style: w.color ? teamVar(w.color) : null },
        h('span', { class: 'hint' }, t('screen.rafflePrize', { n: i + 1 })), ' ', w.name ? [QB.dot(w), ' ', w.name] : t('screen.raffleTicket', { n: w.number }))));
      $('#raffle-reset').hidden = !winners.length;
    });
  }

  // Stars from the phones at the end.
  let rating = null;
  socket.on('rating', r => { rating = r; if (state) render(state); });

  // ---------- my quizzes: open, edit, copy, rename, export, delete ----------

  const manage = async (url, body) => {
    const res = await fetch('/api/host' + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    // The demo keeps 3 quizzes of its own: show the Pro dialog, and nothing else.
    if (!res.ok && /^pro\.locked\./.test(data.error || '')) { openPro(data.error.slice(11)); return new Promise(() => {}); }
    if (!res.ok) throw new Error(data.error || 'error.generic');
    return data;
  };
  const manageDelete = path => fetch('/api/host/library/item?path=' + encodeURIComponent(path), { method: 'DELETE' });

  // A small menu under the ⋯ button; one open at a time, closes on a click elsewhere or Escape.
  let openMenu = null;
  const closeMenu = () => { if (openMenu) { openMenu.remove(); openMenu = null; } };
  document.addEventListener('click', e => { if (openMenu && !openMenu.contains(e.target) && !e.target.closest('.more-btn')) closeMenu(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
  function menu(anchor, items) {
    const was = openMenu && openMenu.dataset.for === anchor.dataset.menuId;
    closeMenu();
    if (was) return;
    anchor.dataset.menuId = anchor.dataset.menuId || Math.random().toString(36).slice(2);
    openMenu = h('div', { class: 'card-menu', role: 'menu' }, items.filter(Boolean).map(it => it.href
      ? h('a', { class: 'menu-item', href: it.href, target: it.target || null, role: 'menuitem', onclick: closeMenu }, it.label)
      : h('button', { class: 'menu-item' + (it.danger ? ' danger' : ''), type: 'button', role: 'menuitem', onclick: () => { closeMenu(); it.run(); } }, it.label)));
    // On the page itself (cards clip what sticks out), right under the button.
    openMenu.dataset.for = anchor.dataset.menuId;
    document.body.append(openMenu);
    const r = anchor.getBoundingClientRect();
    const m = openMenu.getBoundingClientRect();
    const below = r.bottom + 6 + m.height < innerHeight;
    openMenu.style.left = Math.max(8, Math.min(innerWidth - m.width - 8, r.right - m.width)) + 'px';
    openMenu.style.top = (below ? r.bottom + 6 : Math.max(8, r.top - 6 - m.height)) + 'px';
  }
  addEventListener('scroll', closeMenu, true);
  addEventListener('resize', closeMenu);

  async function act(job) {
    try { await job(); } catch (err) { alert(t(err.message && /\./.test(err.message) ? err.message : 'error.generic')); }
    loadQuizzes();
  }

  let allQuizzes = { samples: [], library: [], ratings: {} };
  function loadQuizzes() {
    socket.emit('quizzes', data => {
      allQuizzes = { ratings: {}, ...data };
      renderQuizzes();
      renderRestore();
    });
  }

  // Settings: bring back the examples that were removed.
  function renderRestore() {
    if (!$('#samples-restore')) return;
    const n = allQuizzes.hiddenSamples || 0;
    $('#samples-restore-row').hidden = !n;
    $('#samples-restore-count').textContent = t('manage.samplesHidden', { count: n });
  }
  if ($('#samples-restore')) $('#samples-restore').addEventListener('click', () => act(() => manage('/library/restore-samples', {})));

  function renderQuizzes() {
    const { samples, library, ratings } = allQuizzes;
    const search = $('#quiz-search');
    search.hidden = library.length + samples.length < 7;
    const want = search.hidden ? '' : search.value.trim().toLowerCase();
    const match = q => !want || String(q.title || q.name).toLowerCase().includes(want) || String(q.path || '').toLowerCase().includes(want);
    const folderOf = p => (p && p.includes('/') ? p.split('/').slice(0, -1).join(' / ') : '');

    const card = (q, ref, edit) => {
      const exportUrl = '/api/host/export?' + (edit ? 'path=' + encodeURIComponent(edit) : 'sample=' + encodeURIComponent(ref));
      const printUrl = '/print?' + (edit ? 'open=' + encodeURIComponent(edit) : 'sample=' + encodeURIComponent(ref));
      const more = remote ? null : h('button', {
        class: 'ghost-btn more-btn', type: 'button', title: t('manage.more'), 'aria-label': t('manage.more'),
        onclick: e => menu(e.currentTarget, edit ? [
          printItem(printUrl),
          { label: t('manage.duplicate'), run: () => act(() => manage('/library/duplicate', { path: edit, copyWord: t('manage.copyWord') })) },
          { label: t('manage.rename'), run: () => {
            const title = prompt(t('builder.newName'), q.title || '');
            if (title && title.trim() && title.trim() !== q.title) act(() => manage('/library/retitle', { path: edit, title: title.trim() }));
          } },
          { label: t('manage.export'), href: exportUrl },
          { label: t('builder.delete'), danger: true, run: () => {
            if (confirm(t('manage.confirmDelete', { title: q.title || q.name }))) act(() => manageDelete(edit));
          } },
        ] : [
          printItem(printUrl),
          { label: t('manage.export'), href: exportUrl },
          { label: t('builder.delete'), danger: true, run: () => {
            if (confirm(t('manage.confirmHideSample', { title: q.title || q.name }))) act(() => manage('/library/hide-sample', { sample: ref }));
          } },
        ]),
      }, '⋯');
      return h('li', { class: 'quiz-card panel' },
        h('img', { class: 'quiz-icon', src: '/img/icons/quiz.webp', alt: '' }),
        h('div', { class: 'quiz-info' },
          h('h3', {}, q.title || q.name),
          h('p', {}, folderOf(edit) ? h('span', { class: 'quiz-folder' }, folderOf(edit)) : null,
            edit ? null : h('span', { class: 'quiz-folder sample' }, t('manage.sample')),
            t('host.quizMeta', { rounds: q.rounds, questions: q.questions }),
            ratings[q.title] && ratings[q.title].count ? h('span', { class: 'quiz-rating' }, ` · ★ ${Number(ratings[q.title].avg).toFixed(1)}`) : null)),
        h('div', { class: 'card-actions' },
          h('button', { class: 'brass-btn', onclick: () => socket.emit('load', ref, res => {
            if (res && res.error) return alert(res.error === 'pro.noFreeRounds' ? t(res.error) : t('error.quizInvalid') + '\n' + (res.detail || ''));
            if (res && res.skipped && res.skipped.length) toast(t('pro.skipped', { n: res.skipped.length }), '🔒');
          }) }, t('host.open')),
          remote ? null : edit ? h('a', { class: 'ghost-btn', href: '/builder?open=' + encodeURIComponent(edit) }, t('host.edit'))
            : h('button', { class: 'ghost-btn', type: 'button', onclick: async () => {
              try { const copy = await manage('/library/duplicate', { sample: ref }); location.href = '/builder?open=' + encodeURIComponent(copy.path); } catch { alert(t('error.generic')); }
            } }, t('manage.editCopy')),
          more));
    };
    const cards = [...library.filter(match).map(q => card(q, { library: q.path }, q.path)), ...samples.filter(match).map(q => card(q, q.file, null))];
    $('#quiz-list').replaceChildren(...(cards.length ? cards : [h('li', { class: 'hint quiz-none' }, t('manage.none'))]));
  }
  $('#quiz-search').addEventListener('input', renderQuizzes);

  const NEXT_LABEL = {
    lobby: () => 'host.startQuiz',
    roundIntro: () => 'host.firstQuestion',
    wager: () => 'host.showQuestion',
    question: s => (s.turn ? 'host.skipTurn' : s.round && ['drawGuess', 'captionThis', 'bluffBank', 'photoHunt', 'whosWho'].includes(s.round.type) ? 'host.startVote' : 'host.reveal'),
    vote: () => 'host.showVotes',
    reveal: s => (s.round && s.round.tiebreak ? 'host.showWinner' : s.lastQuestion ? 'host.showScores' : 'host.nextQuestion'),
    scoreboard: s => (s.lastRound ? (s.hasAwards ? 'host.showAwards' : 'host.showWinner') : 'host.nextRound'),
    awards: () => 'host.showWinner',
  };

  // One line of advice for the quizmaster under the title: what to say or do now.
  function coachStep(s) {
    if (s.break) return 'break';
    if (s.phase === 'question' && s.buzz) return 'buzz';
    if (s.phase === 'question' && s.turn) return 'turn';
    if (s.phase === 'reveal' && s.canJudge) return 'judge';
    return s.phase;
  }

  // Autopilot: a bar fills the next button until Quizbrew presses it.
  let auto = { on: false, left: 0, total: 0 };
  function renderAuto() {
    const btn = $('#autopilot');
    btn.classList.toggle('on', auto.on);
    btn.setAttribute('aria-pressed', String(auto.on));
    const next = $('#next');
    next.classList.remove('counting');
    if (auto.left > 0 && auto.total > 0) {
      void next.offsetWidth; // restart the animation
      next.style.setProperty('--auto-ms', `${auto.left}ms`);
      next.style.setProperty('--auto-from', String(1 - auto.left / auto.total));
      next.classList.add('counting');
    }
  }
  socket.on('auto', a => { auto = a || auto; renderAuto(); });

  function render(s) {
    showView(s.phase === 'idle' ? 'idle' : 'live');
    renderCopy();
    const resume = s.resumable;
    $('#resume').hidden = !resume;
    if (resume) {
      $('#resume-title').textContent = resume.title;
      $('#resume-meta').textContent = t('host.resumeMeta', { n: resume.round, total: resume.rounds, teams: resume.teams });
    }
    $('#quiz-name').textContent = s.title || '';
    if (s.phase === 'idle') return;

    const label = NEXT_LABEL[s.phase];
    const next = $('#next');
    next.hidden = !label;
    if (label) next.textContent = t(s.break ? 'host.endBreak' : label(s));
    next.disabled = s.phase === 'lobby' && s.teams.length === 0;
    $('#stop').textContent = t(s.phase === 'end' ? 'host.newQuiz' : 'host.stop');
    $('#back').hidden = !s.canBack;
    $('#add-time').hidden = !s.canAddTime;
    $('#break').hidden = !s.canBreak;
    $('#break').textContent = t(s.break ? 'host.breakMore' : 'host.break');

    $('#coach').textContent = t(`host.coach.${coachStep(s)}`);
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
      preview.append(h('p', { class: 'net-note lobby-tip' }, t('host.lobbyTip')));
    } else if (s.phase === 'roundIntro') {
      kicker.textContent = t('screen.roundOf', { n: s.round.index + 1, total: s.round.total });
      title.textContent = s.round.title || t(`round.${s.round.type}`);
      const rules = [t(`round.${s.round.type}`)];
      if (s.round.scoring) rules.push(t(`scoring.${s.round.scoring}`));
      preview.append(h('p', { class: 'hint' }, rules.join(' · ')));
      const chips = QB.twistChips(s);
      if (chips.length) preview.append(h('p', { class: 'twist-chips' }, chips));
      if (s.round.mystery) preview.append(h('p', { class: 'answer-key' }, t('host.realTitle', { title: s.realTitle })));
    } else if (s.phase === 'wager') {
      kicker.textContent = `${s.round.title || t(`round.${s.round.type}`)} · ${t('host.phase.wager')}`;
      title.textContent = s.pick ? t('host.picks', { name: s.pick.by ? s.pick.by.name : '' }) : s.wagerMode === 'predict' ? (s.finalists || []).map(f => f.name).join(` ${t('screen.vs')} `) : s.category || '';
      if (s.pick) preview.append(h('ol', { class: 'mini-answers' }, s.pick.categories.map((c, i) => h('li', { class: s.pick.chosen === i ? 'key' : '' }, h('span', { class: 'letter' }, LETTERS[i]), c))));
      preview.append(h('p', { class: 'hint' }, t('host.wagered', { n: s.teams.filter(x => x.wagered).length, total: s.teams.filter(x => !x.paper).length })));
      if (s.answerKey) preview.append(h('p', { class: 'answer-key' }, t('host.answerKey', { text: s.answerKey.answerText })));
    } else if (s.phase === 'vote') {
      kicker.textContent = `${s.round.title || t(`round.${s.round.type}`)} · ${t('host.phase.vote')}`;
      title.textContent = s.question.text || '';
      preview.append(h('ol', { class: 'mini-answers ballot-mini' }, s.ballot.map((b, i) => h('li', {},
        h('span', { class: 'letter' }, QB.cardLetter(i)), b.image ? h('img', { class: 'ballot-thumb', src: b.content, alt: '' }) : b.content))));
      preview.append(h('p', { class: 'hint' }, t('screen.votedCount', { n: s.answered, total: s.teams.filter(x => !x.paper).length })));
    } else if (s.phase === 'question' || s.phase === 'reveal') {
      kicker.textContent = `${s.round.title || t(`round.${s.round.type}`)} · ${t('screen.questionOf', { n: s.questionIndex + 1, total: s.round.questions })}`;
      const q = s.question;
      title.textContent = q.text || (q.clues ? q.clues.join(' · ') : '') || (q.scrambled || '');
      const chips = QB.twistChips(s);
      if (chips.length) preview.append(h('p', { class: 'twist-chips' }, chips));
      if (s.actor) preview.append(h('p', { class: 'hint' }, t('screen.actsNow', { name: s.actor.name })));
      if (s.phase === 'reveal' && s.ballot) {
        preview.append(h('ol', { class: 'mini-answers ballot-mini' }, s.ballot.map((b, i) => h('li', { class: b.truth ? 'key' : '' },
          h('span', { class: 'letter' }, QB.cardLetter(i)), b.image ? h('img', { class: 'ballot-thumb', src: b.content, alt: '' }) : b.content,
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
          h('span', { class: 'letter', 'data-shape': kind === 'trueFalse' ? null : i }, kind === 'trueFalse' ? (i === 0 ? '✓' : '✗') : LETTERS[i]), a,
          s.phase === 'reveal' && s.counts ? h('span', { class: 'n' }, s.counts[i]) : null))));
        // After the reveal: every team's pick, and ✓ / ✗ to overrule it.
        if (s.judgeList) {
          const letter = x => (x === null ? '—' : kind === 'trueFalse' ? (x === 0 ? t('play.true') : t('play.false')) : LETTERS[x] || '?');
          preview.append(h('ul', { class: 'judge-list' }, s.judgeList.map(a => h('li', { class: 'judge-row' + (a.correct ? ' right' : ' wrong'), style: teamVar(a.color) },
            h('span', { class: 'team-dot' }), h('span', { class: 'name' }, a.name), h('span', { class: 'given' }, letter(a.answer)),
            h('span', { class: 'pts' }, (a.points > 0 ? '+' : '') + a.points),
            h('span', { class: 'judge' },
              h('button', { class: 'mini ok' + (a.correct ? ' on' : ''), title: t('host.markRight'), onclick: () => socket.emit('judge', { teamId: a.id, correct: true }) }, '✓'),
              h('button', { class: 'mini no' + (!a.correct ? ' on' : ''), title: t('host.markWrong'), onclick: () => socket.emit('judge', { teamId: a.id, correct: false }) }, '✗'))))));
          preview.append(h('p', { class: 'hint' }, t('host.judgeAfter')));
        }
      } else {
        const keyText = s.phase === 'reveal' ? s.reveal.answerText : s.answerKey && s.answerKey.answerText;
        if (keyText) preview.append(h('p', { class: 'answer-key' }, t('host.answerKey', { text: keyText + (q.unit ? ' ' + q.unit : '') })));
        const rows = s.phase === 'reveal' ? s.answers : s.liveAnswers;
        if (rows && rows.length) {
          preview.append(h('ul', { class: 'judge-list' }, rows.map(a => h('li', { class: 'judge-row' + (s.phase === 'reveal' ? (a.correct ? ' right' : ' wrong') : ''), style: teamVar(a.color) },
            h('span', { class: 'team-dot' }), h('span', { class: 'name' }, a.name),
            s.phase === 'reveal' && kind === 'groups' && a.answer ? linkChips(a) : h('span', { class: 'given' }, given(a.answer, kind, key)),
            s.phase === 'reveal' ? h('span', { class: 'pts' }, (a.points > 0 ? '+' : '') + a.points) : null,
            s.canJudge && a.answer !== null ? h('span', { class: 'judge' },
              h('button', { class: 'mini ok' + (a.correct ? ' on' : ''), title: t('host.markRight'), onclick: () => socket.emit('judge', { teamId: a.id, correct: true }) }, '✓'),
              h('button', { class: 'mini no' + (!a.correct ? ' on' : ''), title: t('host.markWrong'), onclick: () => socket.emit('judge', { teamId: a.id, correct: false }) }, '✗')) : null))));
          if (s.canJudge) preview.append(h('p', { class: 'hint' }, t('host.judgeHint')));
          if (s.phase === 'reveal' && kind === 'groups') preview.append(h('p', { class: 'hint' }, t('host.linkHint')));
        }
      }
      preview.append(h('p', { class: 'hint' }, t('screen.answeredCount', { n: s.answered, total: s.teams.filter(x => !x.paper && !x.out).length })));
    } else if (s.phase === 'scoreboard') {
      kicker.textContent = t('host.phase.scoreboard');
      title.textContent = t('screen.standingsAfter', { n: s.round.index + 1 });
    } else if (s.phase === 'awards') {
      kicker.textContent = t('host.phase.awards');
      title.textContent = t('screen.awards');
      preview.append(h('ul', { class: 'judge-list' }, s.awards.map(a => h('li', { class: 'judge-row', style: teamVar(a.team.color) },
        QB.dot(a.team), h('span', { class: 'name' }, t(`award.${a.id}`)), h('span', { class: 'given' }, a.team.name)))));
    } else if (s.phase === 'end') {
      kicker.textContent = t('host.phase.end');
      title.textContent = s.ranking[0] ? t('host.winnerIs', { name: s.ranking[0].name }) : '';
      preview.append(h('p', { class: 'rating-live' }, rating && rating.count ? t('host.ratingLive', { avg: rating.avg.toFixed(1), n: rating.count }) : t('host.ratingWait')));
    }

    renderTeams(s);
  }

  // What a team gave, readable for the quizmaster.
  // Word web after the reveal: every link a team typed, green when it counts; a tap approves or refuses it.
  function linkChips(a) {
    const ok = (a.found && a.found.links) || [];
    return h('span', { class: 'given link-chips' }, a.answer.links.map((text, i) => (text ? h('button', {
      type: 'button', class: 'link-chip' + (ok[i] ? ' on' : ''), title: t(ok[i] ? 'host.linkRefuse' : 'host.linkApprove'),
      onclick: () => socket.emit('judgeLink', { teamId: a.id, group: i, correct: !ok[i] }),
    }, (ok[i] ? '✓ ' : '') + text) : null)));
  }

  function given(a, kind, key) {
    if (a === null || a === undefined) return '—';
    if (kind === 'order') return key && key.order ? a.map(i => key.order[i]).join(' → ') : '✓';
    if (kind === 'groups') return a && a.links ? a.links.filter(Boolean).join(' · ') || '✓' : '✓';
    if (kind === 'pairs') return key && key.pairs ? t('host.pairsRight', { n: a.filter((v, i) => v === i).length, total: a.length }) : '✓';
    if (kind === 'list') return t('host.items', { n: a.length });
    if (kind === 'level') return `${t(`play.level${a.l}`)} · ${LETTERS[a.i]}`;
    if (kind === 'buzz') return a === 'right' ? '✓' : '✗';
    if (kind === 'point') return key && key.spot ? t('screen.distance', { n: Math.round(Math.hypot(a.x - key.spot.x, a.y - key.spot.y) * 100) }) : '📍';
    return String(a);
  }

  function renderTeams(s) {
    // Don't redraw under the quizmaster's fingers while they type the points of a paper team.
    if (document.activeElement && document.activeElement.classList.contains('paper-pts')) { pendingTeams = s; return; }
    pendingTeams = null;
    lastRanking = s.ranking || [];
    if (scoreTeam) drawScore();
    const paper = Object.fromEntries((s.paperTeams || []).map(p => [p.id, p]));
    $('#paper-hint').hidden = !(s.paperTeams || []).length;
    $('#team-total').textContent = s.maxTeams && s.maxTeams < 40 ? t('pro.teamsUsed', { n: s.teams.length, max: s.maxTeams }) : s.teams.length;
    $('#team-total').classList.toggle('demo', !!(s.maxTeams && s.maxTeams < 40));
    $('#no-teams').hidden = s.teams.length > 0;
    const byName = Object.fromEntries(s.teams.map(tm => [tm.name, tm]));
    $('#team-list').replaceChildren(...s.ranking.map(r => {
      const tm = byName[r.name] || {};
      const pt = paper[r.id];
      const status = pt ? 'paper' : !tm.connected ? 'away' : tm.blocked ? 'blocked' : tm.away ? 'left' : (s.phase === 'question' && tm.answered) ? 'answered' : '';
      return h('li', { class: 'team-row ' + status, style: teamVar(r.color) },
        h('span', { class: 'rank' }, r.rank),
        QB.dot(r),
        h('span', { class: 'name', title: !tm.connected ? t('host.offline') : '' }, r.name, tm.joker ? h('span', { class: 'joker-star', title: t('host.jokerPlayed') }, ' ★') : null, tm.phones > 1 ? h('span', { class: 'phones' }, ' ' + t('host.phones', { n: tm.phones })) : null),
        h('span', { class: 'tag' + (status === 'answered' ? ' ok' : status === 'paper' ? ' paper' : status ? ' warn' : ''), title: status === 'answered' ? t('host.answered') : null },
          status === 'paper' ? t('host.paperTag') : status === 'answered' ? '✓' : status === 'away' ? t('host.offline') : status === 'left' ? t('host.leftPage') : status === 'blocked' ? t('host.blocked') : ''),
        h('button', { class: 'score', type: 'button', title: t('host.scoreOpen'), onclick: () => openScore(r.id) }, r.score),
        pt && s.paperRound >= 0 ? h('label', { class: 'paper-in', title: t('host.paperPoints', { n: s.paperRound + 1 }) },
          h('span', {}, t('host.paperRound', { n: s.paperRound + 1 })),
          h('input', { class: 'paper-pts', type: 'number', inputmode: 'numeric', step: 1, value: pt.points === null ? '' : String(pt.points), placeholder: '0', 'aria-label': t('host.paperPoints', { n: s.paperRound + 1 }),
            onchange: e => socket.emit('paperPoints', { teamId: r.id, round: s.paperRound, points: Number(e.target.value) || 0 }),
            onkeydown: e => { if (e.key === 'Enter') e.target.blur(); },
            onblur: () => setTimeout(() => { if (pendingTeams) renderTeams(pendingTeams); }, 0) })) : null,
        h('span', { class: 'adjust' },
          h('button', { class: 'mini', title: t('host.minusPoint'), onclick: () => socket.emit('score', { teamId: r.id, delta: -1 }) }, '−'),
          h('button', { class: 'mini', title: t('host.plusPoint'), onclick: () => socket.emit('score', { teamId: r.id, delta: 1 }) }, '+'),
          h('button', { class: 'mini kick', title: t('host.kick'), onclick: () => { if (confirm(t('host.confirmKick', { name: r.name }))) socket.emit('kick', r.id); } }, '×')));
    }));
  }

  // The quizmaster's call: tap a score to give or take points (a dispute, a bonus, a penalty).
  let scoreTeam = null;
  let lastRanking = [];
  function drawScore() {
    const r = lastRanking.find(x => x.id === scoreTeam);
    if (!r) { if ($('#score-modal').open) $('#score-modal').close(); return; }
    $('#score-modal').setAttribute('style', teamVar(r.color));
    $('#score-title').replaceChildren(QB.dot(r), h('span', { class: 'who' }, r.name));
    $('#score-now').replaceChildren(t('host.scoreNow'), ' ', h('b', {}, String(r.score)));
  }
  function giveScore(delta) {
    if (!scoreTeam || !Number.isFinite(delta) || !delta) return;
    socket.emit('score', { teamId: scoreTeam, delta });
    if (navigator.vibrate) navigator.vibrate(20);
  }
  function openScore(id) {
    scoreTeam = id;
    $('#score-amount').value = '';
    drawScore();
    $('#score-modal').showModal();
  }
  $('#score-steps').replaceChildren(...[-10, -5, -1, 1, 5, 10].map(d =>
    h('button', { type: 'button', class: d > 0 ? 'plus' : 'minus', onclick: () => giveScore(d) }, (d > 0 ? '+' : '−') + Math.abs(d))));
  $('#score-form').addEventListener('submit', e => {
    e.preventDefault();
    giveScore(Math.trunc(Number($('#score-amount').value)));
    $('#score-amount').value = '';
  });
  $('#score-modal [data-close]').addEventListener('click', () => $('#score-modal').close());
  $('#score-modal').addEventListener('close', () => { scoreTeam = null; });

  let pendingTeams = null;
  $('#paper-form').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('#paper-name').value;
    socket.emit('paperTeam', name, res => {
      $('#paper-error').textContent = res && res.error ? t(res.error) : '';
      if (res && res.ok) $('#paper-name').value = '';
    });
  });

  $('#next').addEventListener('click', () => socket.emit('next'));
  $('#back').addEventListener('click', () => socket.emit('back'));
  $('#add-time').addEventListener('click', () => socket.emit('addTime'));
  $('#break').addEventListener('click', () => socket.emit('break'));
  // The venue and its sponsors.
  let brand = { venue: '', logo: '', sponsors: [] };
  socket.on('brand', b => { if (b) brand = b; });
  async function uploadLogo(file) {
    let blob = file;
    let type = file.type;
    if (/^image\/(jpeg|png|webp|bmp)$/.test(type)) {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 640 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * scale);
      c.height = Math.round(bmp.height * scale);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const out = await new Promise(r => c.toBlob(r, 'image/webp', 0.88));
      if (out && out.type === 'image/webp') { blob = out; type = 'image/webp'; }
    }
    const res = await fetch('/api/host/media', { method: 'POST', headers: { 'Content-Type': type }, body: blob });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'upload');
    return data.url;
  }
  function logoSlot(url, set) {
    const input = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async e => {
      const f = e.target.files[0];
      if (!f) return;
      slot.classList.add('busy');
      try { set(await uploadLogo(f)); } catch { $('#venue-error').textContent = t('error.generic'); }
      slot.classList.remove('busy');
    } });
    const slot = h('label', { class: 'logo-pick' + (url ? ' has' : ''), title: t('venue.logo') }, input,
      url ? h('img', { src: url, alt: '' }) : h('span', { class: 'logo-plus' }, t('venue.logo')));
    if (!url) return slot;
    return h('div', { class: 'logo-wrap' }, slot, h('button', { class: 'mini remove', type: 'button', title: t('venue.removeLogo'), onclick: () => set('') }, '×'));
  }
  let draft = null;
  function drawVenue() {
    $('#venue-logo').replaceChildren(logoSlot(draft.logo, url => { draft.logo = url; drawVenue(); }));
    $('#sponsor-list').replaceChildren(...draft.sponsors.map((sp, i) => h('li', { class: 'sponsor-row' },
      logoSlot(sp.logo, url => { sp.logo = url; drawVenue(); }),
      h('div', { class: 'sponsor-fields' },
        h('input', { value: sp.name, maxlength: 40, placeholder: t('venue.sponsorName'), 'aria-label': t('venue.sponsorName'), oninput: e => { sp.name = e.target.value; } }),
        h('input', { value: sp.line, maxlength: 80, placeholder: t('venue.sponsorLine'), 'aria-label': t('venue.sponsorLine'), oninput: e => { sp.line = e.target.value; } })),
      h('button', { class: 'mini remove', type: 'button', title: t('builder.delete'), onclick: () => { draft.sponsors.splice(i, 1); drawVenue(); } }, '×'))));
    $('#sponsor-add').hidden = draft.sponsors.length >= 8;
  }
  // The venue dialog lives on the laptop only (the remote has no venue tile).
  if ($('#venue-tile')) {
    $('#venue-tile').addEventListener('click', () => {
      draft = JSON.parse(JSON.stringify(brand));
      $('#venue-name').value = draft.venue;
      $('#venue-error').textContent = '';
      drawVenue();
      $('#venue-modal').showModal();
    });
    $('#venue-name').addEventListener('input', e => { draft.venue = e.target.value; });
    $('#sponsor-add').addEventListener('click', () => { draft.sponsors.push({ name: '', line: '', logo: '' }); drawVenue(); });
    $('#venue-modal [data-close]').addEventListener('click', () => $('#venue-modal').close());
    $('#venue-form').addEventListener('submit', async e => {
      e.preventDefault();
      try {
        const res = await fetch('/api/host/brand', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
        if (!res.ok) throw new Error('save');
        brand = await res.json();
        $('#venue-modal').close();
      } catch { $('#venue-error').textContent = t('error.generic'); }
    });
  }

  $('#autopilot').addEventListener('click', () => { if (!lic.pro) return; socket.emit('autopilot', !auto.on); });

  // ---------- Demo or Pro ----------
  // Everything Pro stays visible with a small lock; a click on it opens the Pro dialog instead.
  let lic = { pro: true, freeLooks: [] };
  let licFull = null;
  function lookLocked(l) { return !lic.pro && !(lic.freeLooks || []).includes(l); }
  function toast(text, icon) {
    const stack = $('#alerts');
    const el = h('div', { class: 'alert pro', role: 'status' }, h('span', { class: 'icon' }, icon || '★'), h('span', {}, text));
    stack.prepend(el);
    setTimeout(() => el.classList.add('out'), 6000);
    setTimeout(() => el.remove(), 6600);
  }
  function printItem(href) {
    return lic.pro ? { label: t('host.print'), href, target: '_blank' } : { label: '🔒 ' + t('host.print'), run: () => openPro('print') };
  }
  function renderLocks() {
    document.querySelectorAll('[data-pro]').forEach(el => {
      el.classList.toggle('locked', !lic.pro);
      if (!lic.pro && !el.querySelector('.lock-badge')) el.append(h('span', { class: 'lock-badge', 'aria-hidden': 'true' }));
      const badge = el.querySelector('.lock-badge');
      if (badge) { badge.hidden = lic.pro; if (!badge.firstChild) badge.innerHTML = Menu.icon('lock').replace('class="ico"', 'class="lk"'); }
    });
    if ($('#pro-btn')) $('#pro-btn').hidden = remote || lic.pro;
    renderLooks();
  }
  // A click on a locked button: the Pro dialog, never the feature.
  document.addEventListener('click', e => {
    const el = !lic.pro && e.target.closest('[data-pro]');
    if (!el) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    openPro(el.dataset.pro);
  }, true);
  socket.on('license', l => {
    const was = lic.pro;
    lic = l || lic;
    renderLocks();
    if (was !== lic.pro) { loadQuizzes(); if (licFull) refreshPro(); }
  });
  async function refreshPro() {
    try { licFull = await fetch('/api/host/license').then(r => r.json()); } catch { return; }
    renderProState();
  }
  const day = ms => new Date(ms).toLocaleDateString(I18n.lang, { day: 'numeric', month: 'long', year: 'numeric' });
  function proLine(v) {
    if (v.pro) return v.kind === 'tester' && v.until ? t('pro.tester', { date: day(v.until) }) : t('pro.active', { name: v.name });
    if (v.expired) return t('pro.expired', { date: day(v.until) });
    return t('pro.demoLine');
  }
  function renderProState(highlight) {
    const v = licFull;
    if (!v || !$('#pro-modal')) return;
    $('#settings-pro-state').textContent = v.pro ? (v.kind === 'tester' ? t('pro.tester', { date: day(v.until) }) : t('pro.badge')) : t('pro.demo');
    $('#pro-state').textContent = proLine(v);
    $('#pro-state').classList.toggle('good', v.pro);
    $('#pro-sell').hidden = v.pro && v.kind !== 'tester';
    $('#pro-form').hidden = v.pro && v.kind !== 'tester';
    $('#pro-remove').hidden = !v.pro;
    $('#pro-price').textContent = t('pro.price', { price: v.price });
    $('#pro-buy').href = v.shop;
    $('#pro-list').replaceChildren(...v.features.map(f => h('li', { class: f === highlight ? 'hi' : '' }, h('span', { class: 'pro-check', 'aria-hidden': 'true' }, '✓'), t(`pro.locked.${f}`))));
  }
  async function openPro(feature) {
    if (remote || !$('#pro-modal')) return;
    await refreshPro();
    renderProState(feature);
    $('#pro-error').textContent = '';
    $('#pro-input').value = '';
    $('#pro-modal').showModal();
    const hi = $('#pro-list .hi');
    if (hi) hi.scrollIntoView({ block: 'nearest' });
  }
  if ($('#pro-modal')) {
    $('#pro-btn').addEventListener('click', () => openPro());
    $('#settings-pro').addEventListener('click', () => { $('#settings-modal').close(); openPro(); });
    $('#pro-modal [data-close]').addEventListener('click', () => $('#pro-modal').close());
    $('#pro-form').addEventListener('submit', async e => {
      e.preventDefault();
      $('#pro-error').textContent = '';
      const res = await fetch('/api/host/license', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: $('#pro-input').value }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { $('#pro-error').textContent = t(data.error && /^pro\./.test(data.error) ? data.error : 'error.generic'); return; }
      licFull = data;
      renderProState();
      $('#pro-modal').close();
      toast(t('pro.thanks'), '🍻');
    });
    $('#pro-remove').addEventListener('click', async () => {
      if (!confirm(t('pro.removeSure'))) return;
      licFull = await fetch('/api/host/license', { method: 'DELETE' }).then(r => r.json());
      renderProState();
    });
    refreshPro();
  }
  $('#resume-go').addEventListener('click', () => socket.emit('resume', res => { if (res && res.error) alert(t(res.error)); }));
  $('#resume-no').addEventListener('click', () => { if (confirm(t('host.resumeNoSure'))) socket.emit('discard'); });
  $('#stop').addEventListener('click', () => {
    if (state.phase === 'end' || confirm(t('host.confirmStop'))) socket.emit('stop');
  });
  document.addEventListener('keydown', e => {
    if (e.target.matches('input, select, textarea')) return;
    if ((e.key === ' ' || e.key === 'ArrowRight') && !$('#next').hidden && !$('#next').disabled && !$('#v-live').hidden) {
      e.preventDefault();
      socket.emit('next');
    }
    if (e.key === 'ArrowLeft' && !$('#back').hidden && !$('#v-live').hidden) {
      e.preventDefault();
      socket.emit('back');
    }
  });
})();
