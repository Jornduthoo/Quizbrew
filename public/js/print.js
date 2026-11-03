// The run sheet: the whole quiz on paper for the quizmaster, with the answers, and a score sheet to fill in.
(function () {
  const { $, h, LETTERS, roundTheme } = QB;
  const params = new URLSearchParams(location.search);
  let quiz = null;
  let catalog = null;

  const icon = type => {
    const span = h('span', { class: 'r-icon' });
    span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${roundTheme(type).icon}</svg>`;
    return span;
  };
  const typeOf = id => catalog.types.find(x => x.id === id);

  function minutes(q) {
    let s = 0;
    for (const r of q.rounds) {
      const type = typeOf(r.type);
      s += 75;
      for (const x of r.questions) s += (Number(x.time) || (type && type.defaults.time) || 20) + 15 + (type && type.wager ? 30 : 0);
    }
    return Math.max(1, Math.round(s / 60));
  }

  // A list of choices with the right one marked.
  const choices = (answers, correct) => h('ol', { class: 'a-choices' }, answers.map((a, i) => h('li', { class: i === correct ? 'right' : '' }, h('b', {}, LETTERS[i]), ' ', a)));

  // The answer column, for every kind of question.
  function answerOf(type, q) {
    const out = [];
    const kind = type ? type.kind : '';
    if (q.options) {
      out.push(h('div', { class: 'a-block' }, q.options.map(o => h('p', {}, h('span', { class: 'cat' }, o.category), ' ', o.question, ' → ', h('strong', {}, `${LETTERS[o.correct]} ${o.answers[o.correct] || ''}`)))));
      return out;
    }
    if (q.levels) {
      out.push(h('div', { class: 'a-block' }, q.levels.map((l, i) => h('p', {}, h('span', { class: 'cat' }, t(`play.level${i}`)), ' ', l.question, ' → ', h('strong', {}, l.answers[l.correct] || '')))));
      return out;
    }
    if (q.images && q.images.length) {
      out.push(h('strong', {}, `${LETTERS[q.correct]}${q.captions && q.captions[q.correct] ? ' · ' + q.captions[q.correct] : ''}`));
      return out;
    }
    if (Array.isArray(q.answers) && q.answers.length) out.push(choices(q.answers, q.correct));
    else if (typeof q.correct === 'boolean') out.push(h('strong', {}, t(q.correct ? 'play.true' : 'play.false')));
    if (q.pairs) out.push(h('div', { class: 'a-block' }, q.pairs.map(p => h('p', {}, p[0], ' = ', h('strong', {}, p[1])))));
    if (q.items && kind === 'order') out.push(h('ol', { class: 'a-order' }, q.items.map(it => h('li', {}, it))));
    if (q.items && kind === 'list') out.push(h('p', { class: 'a-list' }, h('span', { class: 'cat' }, String(q.items.length)), ' ', q.items.map(it => it.split('/')[0].trim()).join(', ')));
    if (q.answer !== undefined && q.answer !== null && q.answer !== '' && !(Array.isArray(q.answers) && q.answers.length)) {
      out.push(h('strong', { class: 'a-main' }, String(q.answer) + (q.unit ? ' ' + q.unit : '')));
      if (q.accept && q.accept.length) out.push(h('p', { class: 'accept' }, t('print.accept', { list: q.accept.join(', ') })));
    }
    if (q.spot) out.push(h('p', { class: 'accept' }, t('print.spot')));
    if (!out.length) out.push(h('p', { class: 'accept' }, t('print.noAnswer')));
    return out;
  }

  // The question column: the text plus whatever the teams get to see or hear.
  function questionOf(type, q) {
    const out = [];
    if (q.category) out.push(h('span', { class: 'cat' }, q.category));
    if (q.emoji) out.push(h('span', { class: 'emoji' }, q.emoji));
    if (q.question) out.push(h('p', { class: 'q-text' }, q.question));
    if (q.clues) out.push(h('ol', { class: 'clues' }, q.clues.filter(Boolean).map(c => h('li', {}, c))));
    if (type && type.id === 'scramble') out.push(h('p', { class: 'q-text mono' }, String(q.answer || '').toUpperCase()));
    const media = [];
    if (q.image) media.push(h('img', { src: q.image, alt: '' }));
    if (q.images) q.images.filter(Boolean).forEach((src, i) => media.push(h('figure', {}, h('img', { src, alt: '' }), h('figcaption', {}, LETTERS[i]))));
    if (q.audio) media.push(h('span', { class: 'm-note' }, '♪ ', t('print.sound'), q.audioHint ? ` · ${q.audioHint}` : '', q.start ? ` · ${q.start}s` : ''));
    if (q.video) media.push(h('span', { class: 'm-note' }, '▶ ', t('print.video'), q.videoHint ? ` · ${q.videoHint}` : ''));
    if (media.length) out.push(h('div', { class: 'q-media' }, media));
    if (!out.length) out.push(h('p', { class: 'q-text muted' }, t(`round.${type ? type.id : 'classic'}`)));
    return out;
  }

  function render() {
    const total = quiz.rounds.reduce((n, r) => n + r.questions.length, 0);
    document.title = `${quiz.title} · ${t('print.runSheet')}`;
    const cover = h('header', { class: 'cover' },
      h('img', { class: 'cover-logo', src: '/img/logo.webp', alt: '' }),
      h('div', {},
        h('p', { class: 'kicker' }, t('print.runSheet')),
        h('h1', {}, quiz.title),
        h('p', { class: 'meta' }, `${t('host.quizMeta', { rounds: quiz.rounds.length, questions: total })} · ${t('builder.minutes', { n: minutes(quiz) })}`, quiz.jokers ? ` · ${t('print.jokers')}` : '')),
      h('ol', { class: 'overview' }, quiz.rounds.map((r, i) => h('li', { style: `--g: ${roundTheme(r.type).glow}` }, h('b', {}, i + 1), r.title || t(`round.${r.type}`)))));

    const rounds = quiz.rounds.map((r, ri) => {
      const type = typeOf(r.type);
      const rules = [type && type.scorings.length ? t(`scoring.${r.scoring || type.defaults.scoring}`) : t(`scoring.own.${r.type}`), ...(r.twists || []).map(tw => t(`twist.${tw}`))];
      const notes = [];
      if (type && type.kind === 'turn') notes.push(t('builder.f.clockNote', { n: type.clock }));
      if (type && type.finale) notes.push(t('builder.f.finaleNote'));
      if ((r.twists || []).includes('mysteryCategory')) notes.push(t('twist.mysteryCategory.desc'));
      return h('section', { class: 'round', style: `--g: ${roundTheme(r.type).glow}` },
        h('header', { class: 'r-head' },
          h('span', { class: 'r-num' }, ri + 1),
          icon(r.type),
          h('div', {},
            h('h2', {}, r.title || t(`round.${r.type}`)),
            h('p', { class: 'r-type' }, `${t(`round.${r.type}`)} · ${t(`round.${r.type}.desc`)}`),
            h('p', { class: 'r-rules' }, rules.map(x => h('span', { class: 'chip' }, x))),
            notes.length ? h('p', { class: 'r-note' }, notes.join(' ')) : '')),
        h('table', { class: 'q-table' },
          h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, t('print.question')), h('th', { class: 'ans' }, t('print.answer')), h('th', { class: 'num' }, t('builder.f.time')), h('th', { class: 'num' }, t('builder.f.points')))),
          h('tbody', {}, r.questions.map((q, qi) => h('tr', {},
            h('td', { class: 'qn' }, qi + 1),
            h('td', {}, questionOf(type, q)),
            h('td', { class: 'ans' }, answerOf(type, q)),
            h('td', { class: 'num' }, type && type.id === 'clockDuel' ? '—' : `${type && type.kind === 'turn' ? '+' : ''}${q.time || (type && type.defaults.time) || ''}s`),
            h('td', { class: 'num' }, String(q.points || (type && type.defaults.points) || ''))))))
      );
    });

    // Score sheet: one row per team, one column per round.
    const sheet = h('section', { class: 'scores', id: 'score-sheet' },
      h('h2', {}, t('print.scoreSheet')),
      h('table', { class: 's-table' },
        h('thead', {}, h('tr', {}, h('th', { class: 'team' }, t('print.team')), quiz.rounds.map((r, i) => h('th', { title: r.title || t(`round.${r.type}`) }, i + 1)), h('th', { class: 'total' }, t('print.total')))),
        h('tbody', {}, Array.from({ length: 12 }, () => h('tr', {}, h('td', { class: 'team' }), quiz.rounds.map(() => h('td')), h('td', { class: 'total' }))))));

    $('#paper').replaceChildren(cover, ...rounds, sheet);
    applyToggles();
  }

  function applyToggles() {
    document.body.classList.toggle('no-answers', !$('#show-answers').checked);
    $('#score-sheet').hidden = !$('#show-scores').checked;
  }
  $('#show-answers').addEventListener('change', applyToggles);
  $('#show-scores').addEventListener('change', applyToggles);
  $('#print-now').addEventListener('click', () => print());

  (async () => {
    const info = await fetch('/api/info').then(r => r.json());
    await I18n.load(info.language);
    catalog = await fetch('/api/host/catalog').then(r => r.json());
    const src = params.get('sample') ? 'sample=' + encodeURIComponent(params.get('sample')) : 'path=' + encodeURIComponent(params.get('open') || '');
    const res = await fetch('/api/host/library/quiz?' + src);
    if (!res.ok) { $('#paper').replaceChildren(h('p', { class: 'loading' }, t('print.notFound'))); return; }
    quiz = await res.json();
    render();
  })();
})();
