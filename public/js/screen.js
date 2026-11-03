// The big screen on the TV or projector. It only shows; the quizmaster drives it from /host.
(function () {
  const { Media, pixelate } = QBMedia;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) / Math.SQRT2;
  const { $, h, showView, LETTERS, teamVar, countdown, roundTheme, CROWN, split, countUp, later, clearLater } = QB;
  const socket = io({ query: { role: 'screen' } });
  // ?mute: a small copy of the screen on a phone (phones-only mode). The sound plays on the quizmaster's laptop.
  const MUTE = new URLSearchParams(location.search).has('mute');
  if (MUTE) document.documentElement.classList.add('embed');
  let state = null;
  let stopTimer = null;
  let lastKey = '';
  let lobbyShown = false;

  // Ambient particles per phase.
  const AMBIENT = { awards: 'stage', idle: 'lights', lobby: 'lights', roundIntro: 'stage', wager: 'stage', vote: 'stage', question: 'dust', reveal: 'dust', scoreboard: 'dust', end: 'embers' };
  const cssColor = name => getComputedStyle(document.body).getPropertyValue(name).trim();

  socket.on('language', async lang => {
    await I18n.load(lang);
    if (state) render(state, true);
  });
  socket.on('media', action => (action === 'replay' ? Media.replay() : Media.stop()));
  // Browsers only play sound after a click on the page: show a button for that once.
  Media.onBlocked(() => { $('#sound-gate').hidden = MUTE; });
  $('#sound-gate').addEventListener('click', async () => {
    $('#sound-gate').hidden = true;
    await Media.unlock();
    Media.replay();
  });
  socket.on('state', s => { state = s; if (I18n.dict['app.name']) render(s); });

  QB.info().then(i => {
    $('#qr').innerHTML = i.qr;
    $('#join-url').textContent = i.url.replace(/^https?:\/\//, '');
  });

  function render(s, force) {
    showView(s.vote && (s.phase === 'reveal' || s.phase === 'vote') ? 'vote' : s.phase, { reveal: 'question' });
    FX.ambient(AMBIENT[s.phase]);
    // Re-render only what changed, so animations play once.
    const key = [s.phase === 'reveal' && !s.vote ? 'question' : s.phase, s.round && s.round.index, s.questionIndex].join(':');
    const fresh = force || key !== lastKey;
    if (key !== lastKey) { clearLater(); FX.clear(); Media.stop(); document.body.classList.remove('spot-winner'); }
    lastKey = key;
    document.body.classList.remove('urgent');
    if (s.phase !== 'lobby') lobbyShown = false;
    if (s.round) setTheme(s.round.type);
    if (s.phase === 'lobby') renderLobby(s);
    if (s.phase === 'roundIntro' && fresh) renderRoundIntro(s);
    if (s.vote) renderVote(s, fresh);
    else if (s.phase === 'question' || s.phase === 'reveal') renderQuestion(s, fresh);
    if (s.phase === 'wager') renderWager(s);
    if (s.phase === 'scoreboard' && fresh) renderScoreboard(s);
    if (s.phase === 'awards' && fresh) renderAwards(s);
    if (s.phase === 'end' && fresh) renderEnd(s);
  }

  function setTheme(type) {
    document.body.style.setProperty('--theme', roundTheme(type).glow);
  }

  // The lobby line changes every few seconds.
  let lobbyQuipTimer = 0;
  function lobbyQuip() {
    const el = $('#lobby-quip');
    el.classList.remove('in'); void el.offsetWidth;
    el.textContent = QB.quip('lobby');
    el.classList.add('in');
  }
  function renderLobby(s) {
    if (!lobbyQuipTimer) { lobbyQuip(); lobbyQuipTimer = setInterval(() => { if (state && state.phase === 'lobby') lobbyQuip(); }, 9000); }
    $('#lobby-title').textContent = s.title;
    const list = $('#lobby-teams');
    // A team that adds its photo later gets its chip again.
    const known = new Set([...list.children].map(li => li.dataset.name + '|' + (li.dataset.photo || '')));
    const names = new Set(s.teams.map(t => t.name + '|' + (t.photo || '')));
    [...list.children].forEach(li => { if (!names.has(li.dataset.name + '|' + (li.dataset.photo || ''))) li.remove(); });
    s.teams.forEach(team => {
      if (known.has(team.name + '|' + (team.photo || ''))) return;
      const chip = h('li', { class: 'team-chip', style: teamVar(team.color), 'data-name': team.name, 'data-photo': team.photo || '' }, QB.dot(team), team.name);
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
    $('#ri-art').src = '/img/icons/' + (s.round.family || 'classic') + '.webp';
    $('#round-kicker').textContent = t('screen.roundOf', { n: s.round.index + 1, total: s.round.total });
    split($('#round-title'), s.round.title || t(`round.${s.round.type}`));
    $('#ri-type').textContent = t(`round.${s.round.type}`);
    // How this round scores, and its twists, so every team knows the rules before it starts.
    const rules = [t('screen.questionsInRound', { n: s.round.questions })];
    if (s.round.scoring && s.round.scoring !== 'points') rules.push(t(`scoring.${s.round.scoring}`));
    s.round.twists.forEach(tw => rules.push(t(`twist.${tw}`)));
    $('#round-meta').textContent = rules.join(' · ');
    // Restart the CSS animations for this round.
    const v = $('#v-roundIntro');
    v.classList.remove('play'); void v.offsetWidth; v.classList.add('play');
    later(() => FX.sparksAt($('#ri-medal'), { color: theme.glow, count: 70, speed: 1.3 }), 700);
  }

  function renderQuestion(s, fresh) {
    const q = s.question;
    const reveal = s.phase === 'reveal';
    const kind = q.kind;
    const typed = kind === 'text' || kind === 'number';
    const listed = typed || ['point', 'order', 'pairs', 'list', 'level', 'buzz', 'turn'].includes(kind);
    const silent = MUTE || s.round.twists.includes('silentRound');
    document.body.classList.toggle('silent', s.round.twists.includes('silentRound'));
    $('#q-count').textContent = t('screen.questionOf', { n: s.questionIndex + 1, total: s.round.questions });
    $('#q-answered').textContent = t('screen.answeredCount', { n: s.answered, total: s.teams.length });
    const wasRevealed = document.body.classList.contains('revealed');
    document.body.classList.toggle('revealed', reveal);
    document.body.dataset.kind = kind;

    if (fresh) {
      const text = s.round.type === 'actItOut' ? t('screen.actTitle') : q.ladder ? t('screen.whoAmI') : q.kind === 'level' ? t('screen.ownLevel') : q.scrambled ? t('screen.unscramble') : q.text || (q.clues ? t('screen.findLink') : q.emoji ? t('screen.emojiWhat') : q.audio ? t('screen.listen') : q.images ? t('screen.oddOne') : q.image ? t('screen.whatIsThis') : '');
      split($('#q-text'), text, 'word');
      const words = text.split(/\s+/).length;
      $('#q-text').parentElement.classList.toggle('long', text.length > 90);
      $('#answers').style.setProperty('--start', Math.min(1.4, 0.25 + words * 0.06) + 's');
      const answers = kind === 'trueFalse' ? [t('play.true'), t('play.false')] : kind === 'choice' ? q.answers : [];
      $('#answers').className = 'answers' + (kind === 'trueFalse' ? ' tf' : '') + (q.images ? ' images' : '');
      $('#answers').replaceChildren(...answers.map((a, i) => h('li', { class: 'answer', style: kind === 'trueFalse' ? `--k: ${i}` : `--a: var(--ans-${i}); --k: ${i}` },
        q.images ? h('img', { class: 'answer-img', src: q.images[i], alt: '' }) : null,
        h('span', { class: 'letter' }, kind === 'trueFalse' ? (i === 0 ? '✓' : '✗') : LETTERS[i]),
        h('span', { class: 'text' }, a),
        h('span', { class: 'count' }))));
      $('#q-emoji').hidden = !q.emoji;
      if (q.emoji) $('#q-emoji').replaceChildren(...Array.from(q.emoji.replace(/\s+/g, ''), (c, i) => c).reduce((out, c) => {
        // Keep emoji made of several code points (flags, skin tones, joined people) together.
        if (out.length && /[\u200d\ufe0f\u{1f3fb}-\u{1f3ff}\u{e0020}-\u{e007f}]/u.test(c)) out[out.length - 1] += c;
        else if (out.length && /\u200d$/.test(out[out.length - 1])) out[out.length - 1] += c;
        else out.push(c);
        return out;
      }, []).map((c, i) => h('span', { class: 'emo', style: `--k: ${i}` }, c)));
      $('#q-items').hidden = !q.items;
      if (q.items) $('#q-items').replaceChildren(...q.items.map((it, i) => h('li', { class: 'order-item', style: `--k: ${i}` }, h('span', { class: 'letter' }, LETTERS[i] || i + 1), h('span', {}, it))));
      $('#q-pairs').hidden = !q.left;
      if (q.left) $('#q-pairs').replaceChildren(
        h('ol', { class: 'pair-col left' }, q.left.map((x, i) => h('li', { style: `--k: ${i}` }, h('span', { class: 'num' }, i + 1), x))),
        h('ol', { class: 'pair-col right' }, q.right.map((x, i) => h('li', { style: `--k: ${i}` }, h('span', { class: 'letter' }, LETTERS[i] || String.fromCharCode(65 + i)), x))));
      $('#q-pins').replaceChildren();
      $('#answered-dots').replaceChildren();
      renderMedia(q);
      $('#q-category').hidden = !q.category;
      $('#q-category').textContent = q.category ? t('screen.category', { name: q.category }) : '';
      $('#q-tiles').hidden = !q.scrambled;
      if (q.scrambled) {
        $('#q-tiles').replaceChildren(...[...q.scrambled].map((c, i) => h('span', { class: 'tile', style: `--k: ${i}; --r: ${((i * 37) % 13) - 6}deg` }, c)));
      }
      if (q.hint) {
        $('#q-category').hidden = false;
        $('#q-category').textContent = q.hint;
      }
      // Finales: who plays against whom.
      if (s.finalists && s.finalists.length === 2 && kind !== 'turn') {
        $('#q-category').hidden = false;
        $('#q-category').textContent = `${s.finalists[0].name} ${t('screen.vs')} ${s.finalists[1].name}`;
      }
      // Act it out: who is on stage.
      if (s.actor) {
        $('#q-category').hidden = false;
        $('#q-category').textContent = t('screen.actsNow', { name: s.actor.name });
      }
      $('#q-clues').hidden = !q.clues;
      if (q.clues) $('#q-clues').replaceChildren(...q.clues.map((c, i) => h('li', { class: 'clue', style: `--k: ${i}` }, h('span', { class: 'clue-pts' }), h('span', {}, c))));
      const own = { bluffBank: 'screen.bluffNow', captionThis: 'screen.captionNow', whosWho: 'screen.aboutUs', actItOut: 'screen.guessAct' }[s.round.type];
      const hintKey = kind === 'turn' || s.finalists ? null : own || { draw: 'screen.drawNow', photo: 'screen.photoNow', text: 'screen.typeAnswer', number: 'screen.typeNumber', point: 'screen.tapSpot', order: 'screen.putInOrder', pairs: 'screen.makePairs', buzz: 'screen.buzzNow', list: 'screen.listGo', level: 'screen.answerOnPhone' }[kind];
      $('#q-typehint').hidden = !hintKey;
      $('#q-typehint').textContent = hintKey ? t(hintKey, { n: q.total }) : '';
      $('#q-list').hidden = true;
      $('#q-levels').hidden = !q.levels;
      if (!silent) Media.start(q, q.time * 1000 - s.remaining);
      startVideo(q, reveal);
      $('#q-wave').hidden = !q.audio;
      if (!q.audio) $('#sound-gate').hidden = true;
    }

    // Pick your level: three cards with the teams that chose each; the questions and answers come with the reveal.
    if (q.levels) {
      $('#q-levels').replaceChildren(...q.levels.map((lv, i) => {
        const solved = reveal && s.reveal.levels && s.reveal.levels[i];
        return h('li', { class: 'level-card' + (solved ? ' solved' : ''), style: `--k: ${i}` },
          h('span', { class: 'lv-name' }, t(`play.level${i}`)),
          h('span', { class: 'lv-pts' }, t('screen.points', { n: lv.points * q.points })),
          solved ? h('span', { class: 'lv-q' }, solved.question) : null,
          solved ? h('strong', { class: 'lv-a' }, solved.answer) : null,
          h('span', { class: 'lv-teams' }, s.teams.filter(tm => (tm.level || 0) === i).map(tm => h('i', { class: 'team-dot', style: teamVar(tm.color), title: tm.name }))));
      }));
    }

    // Shrinking options: the answers that are gone fade out.
    const gone = new Set(q.gone || []);
    [...$('#answers').children].forEach((li, i) => {
      if (gone.has(i) && !li.classList.contains('gone')) { li.classList.add('gone'); FX.sparksAt(li, { color: cssColor('--bad') || '#ff5a5a', count: 30 }); }
      if (!gone.has(i)) li.classList.remove('gone');
    });

    // Clock rounds: every team's clock, the one whose turn it is runs.
    renderClocks(s);

    // Round memory: pots, streaks and who is out.
    const board = $('#round-board');
    board.hidden = !s.board;
    if (s.board) {
      board.replaceChildren(...s.teams.map(tm => h('li', { class: 'rb-team' + (tm.out ? ' out' : '') + (tm.banked ? ' banked' : ''), style: teamVar(tm.color) },
        h('span', { class: 'team-dot' }), h('span', { class: 'rb-name' }, tm.name),
        h('span', { class: 'rb-val' }, s.round.type === 'pushYourLuck' ? (tm.banked ? t('screen.banked') : t('screen.pot', { n: tm.pot }))
          : s.round.type === 'hotStreak' ? (tm.streak ? '×' + tm.streak : '') : tm.out ? t('screen.out') : '✓'))));
    }

    // Buzzer: the team that has the floor, big and in its colour.
    const banner = $('#buzz-banner');
    const hadBuzz = !banner.hidden;
    // Clock duel: the winner gets the banner at the end.
    const duelWinner = reveal && s.clocks && s.clocks.find(c => c.winner);
    const holder = s.buzz || duelWinner;
    banner.hidden = !holder;
    if (holder) {
      banner.style.cssText = teamVar(holder.color);
      banner.replaceChildren(h('span', { class: 'bz-name' }, holder.name), h('span', { class: 'bz-sub' }, s.buzz ? t('screen.buzzed') : t('screen.winsDuel')));
      if (!hadBuzz) later(() => FX.sparksAt(banner, { color: cssColor('--team-' + holder.color), count: duelWinner ? 140 : 80, speed: 1.4 }), 100);
    }

    // Choice and true/false: light up the right answer.
    [...$('#answers').children].forEach((li, i) => {
      li.classList.toggle('correct', reveal && i === s.correct);
      li.classList.toggle('wrong', reveal && i !== s.correct);
      li.querySelector('.count').textContent = reveal && s.counts ? t('screen.teamsChose', { n: s.counts[i] }) : '';
    });

    // Typed answers: the solution on the board and every team's answer below it.
    const sol = $('#q-solution');
    // Order and pairs show the solution in the list itself.
    const crowd = s.round.type === 'crowdMind';
    sol.hidden = !(reveal && (listed || kind === 'buzz')) || ['order', 'pairs', 'list', 'level'].includes(kind) || (kind === 'buzz' && !(s.reveal && s.reveal.answerText));
    $('#team-answers').hidden = !(reveal && listed && s.answers);
    if (reveal && listed) {
      $('#q-typehint').hidden = true;
      sol.replaceChildren(h('span', { class: 'sol-label' }, t(crowd ? 'screen.crowdSays' : 'screen.solution')), h('span', { class: 'sol-text' }, s.reveal.answerText + (s.reveal.unit ? ' ' + s.reveal.unit : '')));
      const list = (s.answers || []).slice();
      if (kind === 'number') list.sort((a, b) => (a.answer === null) - (b.answer === null) || Math.abs(a.answer - s.reveal.number) - Math.abs(b.answer - s.reveal.number));
      else list.sort((a, b) => b.correct - a.correct);
      if (kind === 'list') list.sort((a, b) => (b.found || 0) - (a.found || 0));
      if (kind === 'point') list.sort((a, b) => (a.answer === null) - (b.answer === null) || (a.answer && b.answer ? dist(a.answer, s.reveal.spot) - dist(b.answer, s.reveal.spot) : 0));
      const shown = a => {
        if (a.answer === null) return '—';
        if (kind === 'point') return t('screen.distance', { n: Math.round(dist(a.answer, s.reveal.spot) * 100) });
        if (kind === 'order' || kind === 'pairs') return a.correct ? '✓' : '✗';
        if (kind === 'list') return t('screen.foundN', { n: a.found || 0 });
        if (kind === 'level') return `${t(`play.level${a.answer.l}`)} ${a.correct ? '✓' : '✗'}`;
        if (kind === 'buzz') return a.answer === 'right' ? '✓' : '✗';
        return String(a.answer);
      };
      $('#team-answers').replaceChildren(...list.map((a, i) => h('li', { class: 'team-answer' + (a.correct ? ' right' : a.answer === null ? ' none' : ' wrong'), style: `${teamVar(a.color)}; --k: ${i}` },
        h('span', { class: 'team-dot' }),
        h('span', { class: 'ta-name' }, a.name),
        h('span', { class: 'ta-answer' }, shown(a)),
        h('span', { class: 'ta-pts' + (a.points < 0 ? ' minus' : '') }, a.points ? (a.points > 0 ? '+' : '') + a.points : ''))));
    }
    if (reveal) {
      const img = $('#q-img');
      img.style.animation = 'none';
      img.style.transform = '';
      img.style.filter = '';
      $('#q-canvas').hidden = true;
      img.hidden = false;
      if (!wasRevealed) Media.reveal();
      if (q.items && s.reveal.order) $('#q-items').replaceChildren(...s.reveal.order.map((it, i) => h('li', { class: 'order-item solved', style: `--k: ${i}` }, h('span', { class: 'letter' }, i + 1), h('span', {}, it))));
      if (q.left && s.reveal.pairs) $('#q-pairs').replaceChildren(h('ol', { class: 'pair-col solved' }, s.reveal.pairs.map((p, i) => h('li', { style: `--k: ${i}` }, h('span', { class: 'num' }, i + 1), p[0], h('span', { class: 'eq' }, '='), h('strong', {}, p[1])))));
      if (kind === 'point' && s.reveal.spot) {
        const pins = (s.answers || []).filter(a => a.answer).map(a => h('span', { class: 'pin team', style: `${teamVar(a.color)}; left: ${a.answer.x * 100}%; top: ${a.answer.y * 100}%`, title: a.name }));
        pins.push(h('span', { class: 'pin goal', style: `left: ${s.reveal.spot.x * 100}%; top: ${s.reveal.spot.y * 100}%` }));
        $('#q-pins').replaceChildren(...pins);
        fitPins();
      }
      if (kind === 'list' && s.reveal.items) {
        const found = new Set(s.reveal.found || []);
        $('#q-list').hidden = false;
        $('#q-list').replaceChildren(...s.reveal.items.map((it, i) => h('li', { class: found.has(i) ? 'hit' : '', style: `--k: ${i}` }, it)));
      }
      $('#q-clues').querySelectorAll('.clue').forEach(c => c.classList.add('on'));
      if (q.scrambled) $('#q-tiles').replaceChildren(...[...s.reveal.answerText.toUpperCase().replace(/\s+/g, '')].map((c, i) => h('span', { class: 'tile solved', style: `--k: ${i}` }, c)));
    }

    if (reveal && (!wasRevealed || fresh)) {
      const color = cssColor(s.correct !== null ? '--ans-' + s.correct : '--good');
      const flash = $('#flash');
      flash.style.setProperty('--f', color);
      flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go');
      const target = s.correct !== null ? $('#answers').children[s.correct] : sol;
      later(() => target && FX.sparksAt(target, { color, count: 90, speed: 1.4 }), 150);
    }

    // Answered dots: update in place so only the dot that changes animates.
    const dots = $('#answered-dots');
    s.teams.forEach((team, i) => {
      let d = dots.children[i];
      if (!d) dots.append(d = h('li', { class: 'dot' }));
      const was = d.classList.contains('on');
      d.className = 'dot' + (team.answered ? ' on' : '') + (team.connected ? '' : ' away') + (team.blocked ? ' blocked' : '') + (team.answered && !was ? ' just' : '');
      d.style.cssText = teamVar(team.color);
      d.title = team.name;
    });
    while (dots.children.length > s.teams.length) dots.lastChild.remove();

    if (kind === 'turn') return;
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
    const clues = [...$('#q-clues').children];
    const img = $('#q-img');
    if (q.effect === 'zoom' && q.image) {
      // Zoomed in far at the start, the whole picture when time is up.
      img.style.animation = 'none';
      void img.offsetWidth;
      img.style.animation = `zoom-out ${total}ms linear both`;
      img.style.animationDelay = `-${total - s.remaining}ms`;
    }
    const canvas = $('#q-canvas');
    canvas.hidden = q.effect !== 'pixel';
    img.hidden = q.effect === 'pixel';
    if (s.paused) {
      ring.style.strokeDashoffset = C * (1 - s.remaining / total);
      $('#timer-num').textContent = Math.ceil(s.remaining / 1000);
      Media.stop();
      return;
    }
    stopTimer = countdown(s.remaining, total, (left, frac) => {
      Media.tick(total - left);
      if (q.effect === 'pixel') pixelate(canvas, img, 1 - frac);
      ring.style.strokeDashoffset = C * (1 - frac);
      $('#timer-num').textContent = Math.ceil(left / 1000);
      const urgent = left < 5000 && left > 0;
      $('#timer').classList.toggle('urgent', urgent);
      document.body.classList.toggle('urgent', urgent);
      if (clues.length) {
        const shown = Math.min(clues.length, Math.floor((1 - frac) * clues.length) + 1);
        clues.forEach((c, i) => {
          if (i < shown && !c.classList.contains('on')) { c.classList.add('on'); if (i > 0) FX.sparksAt(c, { color: cssColor('--theme') || '#ffb43c', count: 24 }); }
        });
        // Points still to win, shown next to the newest clue in a ladder round.
        if (s.round.scoring === 'ladder') clues.forEach((c, i) => { c.querySelector('.clue-pts').textContent = i === shown - 1 ? '+' + Math.max(1, Math.ceil(q.points * (clues.length - i) / clues.length)) : ''; });
      }
    });
  }

  // A video clip plays once on the big screen (with sound when the browser allows it).
  function startVideo(q, reveal) {
    const v = $('#q-video');
    v.hidden = !q.video;
    if (!q.video) { v.pause(); v.removeAttribute('src'); return; }
    if (v.getAttribute('src') !== q.video) v.src = q.video;
    if (reveal) return;
    v.currentTime = 0;
    v.muted = MUTE || document.body.classList.contains('silent');
    v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
  }

  function renderClocks(s) {
    const board = $('#clock-board');
    board.hidden = !s.clocks;
    document.body.classList.toggle('turns', !!s.clocks);
    if (!s.clocks) return;
    if (stopTimer) { stopTimer(); stopTimer = null; }
    const fmt = ms => (ms / 1000).toFixed(ms < 10000 ? 1 : 0);
    board.replaceChildren(...s.clocks.map(c => h('li', { class: 'clock' + (c.active ? ' active' : '') + (c.ms <= 0 ? ' out' : '') + (c.winner ? ' winner' : ''), style: teamVar(c.color) },
      h('span', { class: 'clk-name' }, h('i', { class: 'team-dot' }), c.name),
      h('span', { class: 'clk-num', 'data-ms': c.ms }, c.ms <= 0 ? '0' : fmt(c.ms)),
      h('span', { class: 'clk-bar' }, h('i', { style: `width: ${Math.min(100, (c.ms / s.clockStart) * 100)}%` })))));
    const live = s.clocks.find(c => c.running);
    if (s.phase === 'question' && s.turn) {
      $('#q-typehint').hidden = false;
      $('#q-typehint').textContent = t('screen.turnNow', { name: s.turn.name });
    }
    if (!live) return;
    const el = board.querySelector('.clock.active');
    const num = el.querySelector('.clk-num');
    const bar = el.querySelector('.clk-bar i');
    if (stopTimer) stopTimer();
    stopTimer = countdown(live.ms, live.ms, left => {
      num.textContent = fmt(left);
      bar.style.width = Math.min(100, (left / s.clockStart) * 100) + '%';
      const urgent = left < 5000 && left > 0;
      el.classList.toggle('urgent', urgent);
      document.body.classList.toggle('urgent', urgent);
    });
  }

  function renderMedia(q) {
    const box = $('#q-media');
    const img = $('#q-img');
    box.hidden = !q.image && !q.audio && !q.video;
    box.classList.toggle('video', !!q.video);
    box.classList.toggle('silhouette', q.effect === 'silhouette');
    box.classList.toggle('map', q.kind === 'point');
    box.classList.toggle('audio-only', !q.image && !!q.audio);
    document.body.classList.toggle('has-media', !!q.image || !!q.audio || !!q.video);
    img.style.animation = 'none';
    if (q.image) img.src = q.image;
    else img.removeAttribute('src');
  }

  // Pins sit on the picture itself, not on the frame around it (the picture is letterboxed).
  function fitPins() {
    const img = $('#q-img');
    const box = $('#q-pins');
    const place = () => {
      const W = img.clientWidth;
      const H = img.clientHeight;
      if (!img.naturalWidth || !W) return;
      const k = Math.min(W / img.naturalWidth, H / img.naturalHeight);
      const w = img.naturalWidth * k;
      const hh = img.naturalHeight * k;
      box.style.cssText = `left: ${(W - w) / 2}px; top: ${(H - hh) / 2}px; width: ${w}px; height: ${hh}px`;
    };
    if (img.complete) place(); else img.addEventListener('load', place, { once: true });
  }
  addEventListener('resize', () => { if ($('#q-pins').children.length) fitPins(); });

  // The ballot: entries with letters while voting; at the reveal the authors, the votes and (for a bluff) the truth.
  function renderVote(s, fresh) {
    const reveal = s.phase === 'reveal';
    document.body.classList.toggle('revealed', reveal);
    const mode = s.vote.mode;
    $('#vote-kicker').textContent = t(reveal ? 'screen.voteResult' : mode === 'truth' ? 'screen.findTruth' : mode === 'match' ? 'screen.matchTeams' : 'screen.voteBest');
    $('#vote-count').textContent = reveal ? '' : t('screen.votedCount', { n: s.answered, total: s.teams.length });
    if (fresh) split($('#vote-q'), s.question.text || t(`round.${s.round.type}`), 'word');
    const most = reveal ? Math.max(0, ...s.ballot.map(b => (b.votes || []).length)) : -1;
    const grid = $('#ballot-grid');
    grid.className = 'ballot-grid n' + Math.min(s.ballot.length, 8) + (s.ballot.some(b => b.image) ? ' pics' : '');
    grid.replaceChildren(...s.ballot.map((b, i) => {
      const win = reveal && mode !== 'match' && (b.truth || (mode === 'best' && most > 0 && (b.votes || []).length === most));
      return h('li', { class: 'ballot-card' + (b.image ? ' pic' : '') + (b.truth ? ' truth' : '') + (win ? ' win' : ''), style: `--k: ${i}` + (reveal && b.by ? `; ${teamVar(b.by.color)}` : '') },
        h('span', { class: 'letter' }, LETTERS[i] || String(i + 1)),
        b.image ? h('img', { src: b.content, alt: '' }) : h('span', { class: 'bc-text' }, b.content),
        reveal ? h('span', { class: 'bc-by' }, b.truth ? t('screen.theTruth') : b.by ? b.by.name : '') : null,
        reveal && mode !== 'match' ? h('span', { class: 'bc-votes' }, (b.votes || []).map(v => h('i', { class: 'team-dot', style: teamVar(v.color), title: v.name }))) : null);
    }));
    if (stopTimer) stopTimer();
    if (reveal) {
      $('#vote-time').textContent = '';
      if (fresh) later(() => grid.querySelectorAll('.ballot-card.win').forEach(c => FX.sparksAt(c, { color: cssColor('--good'), count: 70 })), 300);
      return;
    }
    stopTimer = countdown(s.remaining, s.vote.time * 1000, left => { $('#vote-time').textContent = Math.ceil(left / 1000); });
  }

  function renderWager(s) {
    const mode = s.wagerMode;
    const level = mode === 'level';
    const cards = $('#pick-cards');
    cards.hidden = mode !== 'pick';
    $('#wager-dots').hidden = mode === 'pick';
    if (mode === 'pick') {
      // Your pick: the categories, and which one the leader chose.
      $('#wager-kicker').textContent = t('screen.picks', { name: s.pick.by ? s.pick.by.name : '' });
      $('#wager-hint').textContent = t('screen.pickHint');
      $('#wager-category').replaceChildren();
      const was = cards.dataset.chosen;
      cards.replaceChildren(...s.pick.categories.map((c, i) => h('li', { class: 'pick-card' + (s.pick.chosen === i ? ' on' : ''), style: `--k: ${i}` }, c)));
      if (s.pick.chosen !== null && String(s.pick.chosen) !== was) later(() => { const on = cards.querySelector('.on'); if (on) FX.sparksAt(on, { color: cssColor('--theme'), count: 80 }); }, 50);
      cards.dataset.chosen = s.pick.chosen === null ? '' : String(s.pick.chosen);
      return;
    }
    if (mode === 'predict') {
      $('#wager-kicker').textContent = t('screen.predict');
      $('#wager-hint').textContent = t('screen.predictHint');
      const [a, b] = s.finalists || [];
      $('#wager-category').replaceChildren(...[a, b].filter(Boolean).flatMap((f, i) => [
        i ? h('span', { class: 'vs' }, t('screen.vs')) : null,
        h('span', { class: 'finalist', style: teamVar(f.color) }, f.name)].filter(Boolean)));
      const names = new Set((s.finalists || []).map(f => f.name));
      $('#wager-dots').replaceChildren(...s.teams.filter(team => !names.has(team.name)).map(team => h('li', { class: 'dot' + (team.wagered ? ' on' : ''), style: teamVar(team.color), title: team.name })));
      return;
    }
    $('#wager-kicker').textContent = t(level ? 'screen.pickLevel' : 'screen.placeBets');
    $('#wager-hint').textContent = t(level ? 'screen.levelHint' : 'screen.betHint');
    split($('#wager-category'), s.category || t(level ? 'round.pickYourLevel' : `round.${s.round.type}`));
    $('#wager-dots').replaceChildren(...s.teams.map(team => h('li', { class: 'dot' + (team.wagered ? ' on' : ''), style: teamVar(team.color), title: team.name })));
  }

  function renderScoreboard(s) {
    split($('#sb-title'), t('screen.standingsAfter', { n: s.round.index + 1 }));
    const rows = s.ranking;
    $('#sb-quip').textContent = rows[0] ? QB.quip('leader', { name: rows[0].name }) : '';
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
        QB.dot(r),
        h('span', { class: 'name' }, r.name),
        moved > 0 ? h('span', { class: 'moved up' }, '▲ ' + moved) : moved < 0 ? h('span', { class: 'moved down' }, '▼ ' + -moved) : h('span', { class: 'moved' }),
        score);
      if (r.rank === 1) {
        row.querySelector('.crown-wrap').innerHTML = CROWN;
        later(() => {
          const b = row.getBoundingClientRect();
          const colors = [cssColor('--team-' + r.color)];
          FX.celebrate({ x: b.left + 40, y: b.top + b.height / 2, colors, count: 70 });
          FX.celebrate({ x: b.right - 40, y: b.top + b.height / 2, colors, count: 70 });
          FX.glints({ x: b.left + b.width / 2, y: b.top, width: b.width * 0.8, count: 60 });
        }, (delay + 0.55) * 1000);
      }
      return row;
    }));
  }

  // The prizes: one card every 1.8 seconds, each with a burst of light in the team colour.
  const AWARD_ICON = { fastest: '⚡', streak: '🔥', climber: '🚀', daredevil: '🎲', buzzer: '⏱️', almost: '🤏' };
  function renderAwards(s) {
    split($('#awards-title'), t('screen.awards'));
    const grid = $('#award-grid');
    grid.style.setProperty('--n', s.awards.length);
    grid.replaceChildren(...s.awards.map((a, i) => h('li', { class: 'award', style: `${teamVar(a.team.color)}; --d: ${1 + i * 1.8}s` },
      h('span', { class: 'aw-icon' }, AWARD_ICON[a.id] || '★'),
      h('span', { class: 'aw-title' }, t(`award.${a.id}`)),
      h('span', { class: 'aw-team' }, QB.dot(a.team), a.team.name),
      h('span', { class: 'aw-text' }, t(`award.${a.id}.text`, { n: a.n })))));
    [...grid.children].forEach((card, i) => later(() => {
      const b = card.getBoundingClientRect();
      FX.glints({ x: b.left + b.width / 2, y: b.top, width: b.width, count: 40 });
      FX.sparksAt(card, { color: cssColor('--team-' + s.awards[i].team.color) || '#ffb43c', count: 50 });
    }, (1.3 + i * 1.8) * 1000));
  }

  function renderEnd(s) {
    split($('#end-title'), t('screen.winner'));
    $('#end-quip').textContent = QB.quip('final');
    const rows = s.ranking;
    const podium = [rows[1], rows[0], rows[2]].filter(Boolean);
    $('#podium').replaceChildren(...podium.map(r => h('div', { class: `step place${r.rank}`, style: teamVar(r.color) },
      h('div', { class: 'who' }, r.rank === 1 ? h('span', { class: 'crown-wrap' }) : null, QB.dot(r), h('span', { class: 'name' }, r.name), h('span', { class: 'pts' }, t('screen.points', { n: r.score }))),
      h('div', { class: 'block' }, h('span', { class: 'medal' }, r.rank)))));
    const crown = $('#podium .crown-wrap');
    if (crown) crown.innerHTML = CROWN;
    $('#rest').replaceChildren(...rows.slice(3).map(r => h('li', { style: teamVar(r.color) }, h('span', { class: 'rank' }, r.rank), QB.dot(r), r.name, h('span', { class: 'score' }, r.score))));
    const winner = rows[0];
    if (!winner) return;
    // The winner lands at about 2.3 s: the spots swing onto the podium, brass sparks fly, gold light swarms up.
    const colors = [cssColor('--team-' + winner.color)];
    document.body.classList.remove('spot-winner');
    later(() => {
      document.body.classList.add('spot-winner');
      const m = $('.place1 .medal').getBoundingClientRect();
      FX.celebrate({ x: m.left + m.width / 2, y: m.top + m.height / 2, colors, count: 140 });
      FX.glints({ x: m.left + m.width / 2, y: m.top, width: m.width * 4, count: 90 });
    }, 2300);
    later(() => FX.swarm({ seconds: 8 }), 2600);
  }

})();
