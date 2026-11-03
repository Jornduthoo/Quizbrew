// The quiz builder: prepare a whole quiz night at home on this laptop. Rounds of any type, a library with
// folders, import and export, AI help per round or for the whole evening. Saves by itself.
(function () {
  const { $, h, roundTheme } = QB;
  const LETTERS = QB.LETTERS;
  const api = async (method, url, body) => {
    const res = await fetch('/api/host' + url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'error.generic'), { detail: data.detail || '' });
    return data;
  };

  let catalog = null;
  let library = { tree: { folders: [], quizzes: [] }, samples: [] };
  let current = null; // { path, quiz }
  let stats = { plays: 0, q: {} }; // how the questions went on earlier nights
  let roundIndex = 0;
  let saveTimer = null;
  let saving = false;
  let openFolders = new Set(['']);
  let folderTarget = '';

  const typeOf = id => catalog.types.find(x => x.id === id);
  const typeName = id => t(`round.${id}`);
  const icon = id => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'type-icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = roundTheme(id).icon;
    return svg;
  };
  const glow = id => `--glow: ${roundTheme(id).glow}`;

  // ---------- start ----------

  async function start() {
    const lang = await QB.info().then(i => i.language).catch(() => 'en');
    await I18n.load(lang);
    catalog = await api('GET', '/catalog');
    await refreshLibrary();
    const open = new URLSearchParams(location.search).get('open');
    if (open) openQuiz({ path: open });
    else showWelcome();
  }

  async function refreshLibrary() {
    library = await api('GET', '/library');
    renderLibrary();
  }

  // ---------- library ----------

  function renderLibrary() {
    const tree = $('#lib-tree');
    tree.replaceChildren(folderNode(library.tree, 0));
    $('#lib-samples').replaceChildren(...library.samples.map(s => h('li', {},
      h('button', { class: 'lib-item', onclick: () => openQuiz({ sample: s.file }) }, h('span', { class: 'lib-title' }, s.title), h('span', { class: 'lib-meta' }, t('host.quizMeta', { rounds: s.rounds, questions: s.questions }))))));
  }

  function folderNode(node, depth) {
    const isRoot = depth === 0;
    const open = isRoot || openFolders.has(node.path);
    const wrap = h('div', { class: 'folder' + (open ? ' open' : '') });
    if (!isRoot) {
      wrap.append(h('div', { class: 'folder-row' + (folderTarget === node.path ? ' target' : '') },
        h('button', { class: 'folder-btn', onclick: () => { if (open) openFolders.delete(node.path); else openFolders.add(node.path); folderTarget = node.path; renderLibrary(); } },
          h('span', { class: 'chev' }, open ? '▾' : '▸'), node.name),
        h('button', { class: 'mini', title: t('builder.rename'), onclick: () => renameItem(node.path, node.name) }, '✎'),
        h('button', { class: 'mini kick', title: t('builder.delete'), onclick: () => deleteItem(node.path, true) }, '×')));
      wrap.addEventListener('dragover', e => { e.preventDefault(); wrap.classList.add('drop'); });
      wrap.addEventListener('dragleave', () => wrap.classList.remove('drop'));
      wrap.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); wrap.classList.remove('drop'); moveInto(e.dataTransfer.getData('text/qb-path'), node.path); });
    } else {
      wrap.addEventListener('dragover', e => e.preventDefault());
      wrap.addEventListener('drop', e => { e.preventDefault(); moveInto(e.dataTransfer.getData('text/qb-path'), ''); });
    }
    if (open) {
      const inner = h('div', { class: 'folder-items' });
      node.folders.forEach(f => inner.append(folderNode(f, depth + 1)));
      node.quizzes.forEach(q => inner.append(h('button', {
        class: 'lib-item' + (current && current.path === q.path ? ' on' : ''), draggable: 'true',
        ondragstart: e => e.dataTransfer.setData('text/qb-path', q.path),
        onclick: () => openQuiz({ path: q.path }),
      }, h('span', { class: 'lib-title' }, q.title || q.name), h('span', { class: 'lib-meta' }, t('host.quizMeta', { rounds: q.rounds, questions: q.questions })))));
      if (isRoot && !node.folders.length && !node.quizzes.length) inner.append(h('p', { class: 'hint small' }, t('builder.emptyLibrary')));
      wrap.append(inner);
    }
    return wrap;
  }

  async function moveInto(from, folder) {
    if (!from) return;
    const name = from.split('/').pop();
    const to = folder ? `${folder}/${name}` : name;
    if (to === from) return;
    try {
      await api('POST', '/library/move', { from, to });
      if (current && current.path === from) current.path = to;
      await refreshLibrary();
    } catch (err) { alert(t('builder.moveFailed')); }
  }

  async function renameItem(path, name) {
    const next = prompt(t('builder.newName'), name.replace(/\.json$/, ''));
    if (!next || !next.trim()) return;
    const parent = path.split('/').slice(0, -1).join('/');
    const clean = next.trim().replace(/[\\/:*?"<>|]+/g, ' ');
    const to = (parent ? parent + '/' : '') + clean + (path.endsWith('.json') ? '.json' : '');
    try {
      await api('POST', '/library/move', { from: path, to });
      if (current && current.path === path) current.path = to;
      await refreshLibrary();
    } catch { alert(t('builder.moveFailed')); }
  }

  async function deleteItem(path, folder) {
    if (!confirm(t(folder ? 'builder.confirmDeleteFolder' : 'builder.confirmDelete'))) return;
    await api('DELETE', '/library/item?path=' + encodeURIComponent(path));
    if (current && current.path && (current.path === path || current.path.startsWith(path + '/'))) { current = null; showWelcome(); }
    await refreshLibrary();
  }

  $('#new-folder').addEventListener('click', async () => {
    const name = prompt(t('builder.folderName'));
    if (!name || !name.trim()) return;
    const path = (folderTarget ? folderTarget + '/' : '') + name.trim().replace(/[\\/:*?"<>|]+/g, ' ');
    try {
      await api('POST', '/library/folder', { path });
      openFolders.add(path);
      await refreshLibrary();
    } catch { alert(t('error.generic')); }
  });

  $('#import-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const res = await api('POST', '/import', { name: file.name, text: await file.text(), folder: folderTarget });
      await refreshLibrary();
      openQuiz({ path: res.path });
    } catch (err) { alert(t('builder.importFailed') + (err.detail ? `\n${err.detail}` : '')); }
  });

  // ---------- open, new, save ----------

  function showWelcome() {
    $('#welcome').hidden = false;
    $('#editor').hidden = true;
    setSaveState('');
  }

  async function openQuiz({ path, sample }) {
    await flushSave();
    const quiz = sample ? await api('GET', '/library/quiz?sample=' + encodeURIComponent(sample)) : await api('GET', '/library/quiz?path=' + encodeURIComponent(path));
    if (sample) {
      if (!confirm(t('builder.copySample'))) return;
      // A sample is read-only: editing makes a copy in the library.
      const res = await api('PUT', '/library/quiz', { quiz: { ...quiz, title: quiz.title }, folder: folderTarget });
      current = { path: res.path, quiz: res.quiz };
      await refreshLibrary();
    } else current = { path, quiz };
    current.quiz.rounds = current.quiz.rounds || [];
    stats = await api('GET', '/stats?path=' + encodeURIComponent(current.path)).catch(() => ({ plays: 0, q: {} }));
    roundIndex = 0;
    $('#welcome').hidden = true;
    $('#editor').hidden = false;
    $('#check-result').hidden = true;
    renderEditor();
    renderLibrary();
    history.replaceState(null, '', '/builder?open=' + encodeURIComponent(current.path));
  }

  async function newQuiz(quiz) {
    await flushSave();
    const res = await api('PUT', '/library/quiz', { quiz: quiz || { title: t('builder.untitled'), jokers: false, rounds: [] }, folder: folderTarget });
    await refreshLibrary();
    await openQuiz({ path: res.path });
    if (!quiz) { $('#quiz-title').select(); }
  }
  $('#new-quiz').addEventListener('click', () => newQuiz());
  $('#welcome-new').addEventListener('click', () => newQuiz());
  $('#welcome-ai').addEventListener('click', () => openAi({ whole: true }));

  function changed() {
    setSaveState('builder.unsaved');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 900);
    renderMeta();
  }

  async function save() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!current || saving) return;
    saving = true;
    setSaveState('builder.saving');
    try {
      await api('PUT', '/library/quiz', { path: current.path, quiz: current.quiz });
      setSaveState('builder.saved');
      refreshLibrary();
    } catch {
      setSaveState('builder.saveFailed');
    }
    saving = false;
  }

  async function flushSave() {
    if (saveTimer) await save();
  }

  function setSaveState(key) {
    const el = $('#save-state');
    el.textContent = key ? t(key) : '';
    el.dataset.state = key;
  }

  window.addEventListener('beforeunload', e => { if (saveTimer) { save(); e.preventDefault(); } });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); }
  });

  // ---------- editor ----------

  function renderEditor() {
    const quiz = current.quiz;
    $('#quiz-title').value = quiz.title || '';
    $('#quiz-jokers').checked = !!quiz.jokers;
    renderMeta();
    renderTimeline();
    renderRound();
  }

  $('#quiz-title').addEventListener('input', e => { current.quiz.title = e.target.value; changed(); });
  $('#quiz-jokers').addEventListener('change', e => { current.quiz.jokers = e.target.checked; changed(); });

  // Rough time of the evening: every question plus the reveal, plus intro and scoreboard per round.
  function estimateMinutes(quiz) {
    let s = 0;
    for (const r of quiz.rounds) {
      const type = typeOf(r.type);
      s += 75;
      for (const q of r.questions) s += (Number(q.time) || (type && type.defaults.time) || 20) + 15 + (type && type.wager ? 30 : 0);
    }
    return Math.max(1, Math.round(s / 60));
  }

  function renderMeta() {
    const quiz = current.quiz;
    const questions = quiz.rounds.reduce((n, r) => n + r.questions.length, 0);
    $('#quiz-meta').textContent = `${t('host.quizMeta', { rounds: quiz.rounds.length, questions })} · ${t('builder.minutes', { n: estimateMinutes(quiz) })}`;
  }

  function renderTimeline() {
    const tl = $('#timeline');
    const cards = current.quiz.rounds.map((r, i) => {
      const card = h('div', {
        class: 'round-card' + (i === roundIndex ? ' on' : ''), style: glow(r.type), draggable: 'true', tabindex: '0',
        onclick: () => { roundIndex = i; renderTimeline(); renderRound(); },
        onkeydown: e => { if (e.key === 'Enter') card.click(); },
        ondragstart: e => { e.dataTransfer.setData('text/qb-round', String(i)); card.classList.add('dragging'); },
        ondragend: () => card.classList.remove('dragging'),
        ondragover: e => { if (e.dataTransfer.types.includes('text/qb-round')) { e.preventDefault(); card.classList.add('drop'); } },
        ondragleave: () => card.classList.remove('drop'),
        ondrop: e => {
          e.preventDefault();
          card.classList.remove('drop');
          const from = Number(e.dataTransfer.getData('text/qb-round'));
          if (Number.isInteger(from) && from !== i) moveRound(from, i);
        },
      },
      h('span', { class: 'rc-num' }, i + 1),
      icon(r.type),
      h('span', { class: 'rc-title' }, r.title || typeName(r.type)),
      h('span', { class: 'rc-meta' }, `${typeName(r.type)} · ${t('builder.questionsN', { n: r.questions.length })}`));
      return card;
    });
    cards.push(h('button', { class: 'round-card add', onclick: () => openPicker() }, h('span', { class: 'plus' }, '+'), h('span', { class: 'rc-title' }, t('builder.addRound'))));
    tl.replaceChildren(...cards);
  }

  function moveRound(from, to) {
    const list = current.quiz.rounds;
    const [r] = list.splice(from, 1);
    list.splice(to, 0, r);
    roundIndex = to;
    changed();
    renderTimeline();
    renderRound();
  }

  function newQuestion(type) {
    const q = { question: '' };
    if (type.fields.includes('answers')) { q.answers = ['', '', '', '']; q.correct = 0; }
    if (type.fields.includes('truth')) q.correct = true;
    if (type.fields.includes('answer') || type.fields.includes('answerOrChoices')) q.answer = '';
    if (type.fields.includes('number')) q.answer = null;
    if (type.fields.includes('clues')) q.clues = ['', '', '', ''];
    if (type.fields.includes('items')) q.items = ['', '', '', ''];
    if (type.fields.includes('pairs')) q.pairs = [['', ''], ['', ''], ['', ''], ['', '']];
    if (type.fields.includes('images')) { q.images = ['', '', '', '']; q.captions = ['', '', '', '']; q.correct = 0; }
    if (type.fields.includes('audio')) q.audio = '';
    if (type.fields.includes('listItems')) q.items = [];
    if (type.fields.includes('video')) q.video = '';
    if (type.fields.includes('options')) q.options = [0, 1, 2].map(() => ({ category: '', question: '', answers: ['', '', '', ''], correct: 0 }));
    if (type.fields.includes('levels')) q.levels = [0, 1, 2].map(() => ({ question: '', answers: ['', '', '', ''], correct: 0 }));
    return q;
  }

  function addRound(typeId) {
    const type = typeOf(typeId);
    current.quiz.rounds.push({ type: typeId, title: '', scoring: type.defaults.scoring || null, twists: [], questions: [newQuestion(type)] });
    roundIndex = current.quiz.rounds.length - 1;
    changed();
    renderTimeline();
    renderRound();
  }

  function renderRound() {
    const box = $('#round-editor');
    const r = current.quiz.rounds[roundIndex];
    if (!r) {
      box.replaceChildren(h('div', { class: 'empty-round' }, h('p', { class: 'hint' }, t('builder.noRounds')), h('button', { class: 'brass-btn', onclick: () => openPicker() }, t('builder.addRound'))));
      return;
    }
    const type = typeOf(r.type);
    box.style.cssText = glow(r.type);
    const scoring = type.scorings.length ? h('label', { class: 'field inline' }, h('span', {}, t('builder.scoring')),
      h('select', { onchange: e => { r.scoring = e.target.value; changed(); renderRound(); } },
        type.scorings.map(s => h('option', { value: s, selected: r.scoring === s ? 'selected' : null }, t(`scoring.${s}`))))) : h('p', { class: 'hint small' }, t(`scoring.own.${r.type}`));
    const scoringHint = type.scorings.length ? h('p', { class: 'hint small' }, t(`scoring.${r.scoring || type.defaults.scoring}.desc`)) : null;

    fill(box,
      h('header', { class: 're-head' },
        h('div', { class: 're-type' }, icon(r.type), h('div', {}, h('strong', {}, typeName(r.type)), h('p', { class: 'hint small' }, t(`round.${r.type}.desc`)))),
        h('div', { class: 're-actions' },
          h('button', { class: 'ghost-btn small ai-btn', onclick: () => openAi({ whole: false }) }, t('builder.aiRound')),
          h('button', { class: 'mini', title: t('builder.moveLeft'), disabled: roundIndex === 0, onclick: () => moveRound(roundIndex, roundIndex - 1) }, '◀'),
          h('button', { class: 'mini', title: t('builder.moveRight'), disabled: roundIndex === current.quiz.rounds.length - 1, onclick: () => moveRound(roundIndex, roundIndex + 1) }, '▶'),
          h('button', { class: 'mini', title: t('builder.duplicate'), onclick: () => { current.quiz.rounds.splice(roundIndex + 1, 0, JSON.parse(JSON.stringify(r))); roundIndex++; changed(); renderTimeline(); renderRound(); } }, '⧉'),
          h('button', { class: 'mini kick', title: t('builder.deleteRound'), onclick: () => { if (!confirm(t('builder.confirmDeleteRound'))) return; current.quiz.rounds.splice(roundIndex, 1); roundIndex = Math.max(0, roundIndex - 1); changed(); renderTimeline(); renderRound(); } }, '×'))),
      h('div', { class: 're-settings' },
        h('label', { class: 'field grow' }, h('span', {}, t('builder.roundTitle')),
          h('input', { value: r.title || '', placeholder: typeName(r.type), maxlength: 60, oninput: e => { r.title = e.target.value; changed(); renderTimeline(); } })),
        h('div', { class: 'field' }, scoring, scoringHint),
        h('div', { class: 'field' }, h('span', {}, t('builder.twists')),
          h('div', { class: 'chips' }, catalog.twists.map(tw => h('label', { class: 'chip' + ((r.twists || []).includes(tw) ? ' on' : ''), title: t(`twist.${tw}.desc`) },
            h('input', { type: 'checkbox', checked: (r.twists || []).includes(tw) ? 'checked' : null, onchange: e => {
              r.twists = (r.twists || []).filter(x => x !== tw);
              if (e.target.checked) r.twists.push(tw);
              changed();
              renderRound();
            } }), t(`twist.${tw}`))))),
        h('label', { class: 'field small-field' }, h('span', {}, t('builder.timeAll')),
          h('input', { type: 'number', min: 3, max: 600, placeholder: type.defaults.time, onchange: e => {
            const v = Number(e.target.value);
            if (v > 0) { r.questions.forEach(q => { q.time = v; }); changed(); renderRound(); }
          } }))),
      type.kind === 'turn' ? h('p', { class: 'hint round-note' }, t('builder.f.clockNote', { n: type.clock })) : null,
      type.finale ? h('p', { class: 'hint round-note' }, t('builder.f.finaleNote')) : null,
      h('ol', { class: 'q-list' }, r.questions.map((q, i) => questionCard(r, type, q, i))),
      h('div', { class: 'q-add' },
        h('button', { class: 'ghost-btn', onclick: () => { r.questions.push(newQuestion(type)); changed(); renderRound(); renderTimeline(); } }, t('builder.addQuestion'))));
  }

  // ---------- one question ----------

  function questionCard(r, type, q, i) {
    const set = (k, v) => { q[k] = v; changed(); };
    const fields = type.fields.map(f => (FIELD[f] ? FIELD[f](q, set, type, r) : null)).flat();
    return h('li', { class: 'q-card' },
      h('div', { class: 'q-top' },
        h('span', { class: 'q-num' }, i + 1),
        statBadge(r, q, i),
        h('div', { class: 'q-tools' },
          h('button', { class: 'mini', title: t('builder.moveUp'), disabled: i === 0, onclick: () => { r.questions.splice(i - 1, 0, r.questions.splice(i, 1)[0]); changed(); renderRound(); } }, '▲'),
          h('button', { class: 'mini', title: t('builder.moveDown'), disabled: i === r.questions.length - 1, onclick: () => { r.questions.splice(i + 1, 0, r.questions.splice(i, 1)[0]); changed(); renderRound(); } }, '▼'),
          h('button', { class: 'mini kick', title: t('builder.deleteQuestion'), onclick: () => { r.questions.splice(i, 1); changed(); renderRound(); renderTimeline(); } }, '×'))),
      h('div', { class: 'q-fields' }, fields));
  }

  // After a quiz night: how many teams got this question right (same key as the game log: the question text).
  function statBadge(r, q, i) {
    const key = (q.question || '').trim() || `#${current.quiz.rounds.indexOf(r)}:${i}`;
    const s = stats && stats.q && stats.q[key];
    if (!s || !s.asked) return null;
    const pct = Math.round((s.right / s.asked) * 100);
    return h('span', { class: 'q-stat' + (pct < 25 ? ' hard' : pct > 85 ? ' easy' : ''), title: t('builder.statHint', { n: stats.plays }) }, t('builder.stat', { pct, n: s.asked }));
  }

  // replaceChildren turns null into the text "null"; leave empty parts out.
  const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter(k => k !== null && k !== undefined && k !== false));
  const input = (label, value, oninput, attrs = {}) => h('label', { class: 'field ' + (attrs.cls || '') }, h('span', {}, label),
    h(attrs.area ? 'textarea' : 'input', { value: attrs.area ? null : (value ?? ''), rows: attrs.area ? 2 : null, oninput: e => oninput(e.target.value), ...attrs.el }, attrs.area ? (value || '') : null));

  const FIELD = {
    question: (q, set, type) => input(t(type.id === 'zoomOut' || type.id === 'picture' ? 'builder.f.questionOptional' : 'builder.f.question'), q.question, v => set('question', v), { area: true, cls: 'wide', el: { maxlength: 240 } }),
    category: (q, set) => input(t('builder.f.category'), q.category, v => set('category', v), { el: { maxlength: 60 } }),
    hint: (q, set) => input(t('builder.f.hint'), q.question, v => set('question', v), { el: { maxlength: 80 } }),
    answers: (q, set) => answersEditor(q, set),
    truth: (q, set) => h('div', { class: 'field' }, h('span', {}, t('builder.f.truth')),
      h('div', { class: 'seg' }, [true, false].map(v => h('button', { type: 'button', class: q.correct === v ? 'on' : '', onclick: e => { set('correct', v); [...e.currentTarget.parentElement.children].forEach((b, k) => b.classList.toggle('on', (k === 0) === v)); } }, t(v ? 'play.true' : 'play.false'))))),
    answer: (q, set) => [
      input(t('builder.f.answer'), q.answer, v => set('answer', v), { el: { maxlength: 80 } }),
      input(t('builder.f.accept'), (q.accept || []).join(' | '), v => set('accept', v.split('|').map(s => s.trim()).filter(Boolean)), { el: { maxlength: 200, placeholder: t('builder.f.acceptHint') } }),
    ],
    number: (q, set) => [
      input(t('builder.f.number'), q.answer, v => set('answer', v === '' ? null : Number(String(v).replace(',', '.'))), { el: { type: 'number', step: 'any' } }),
      input(t('builder.f.unit'), q.unit, v => set('unit', v), { el: { maxlength: 20 } }),
    ],
    answerOrChoices: (q, set) => {
      const wrap = h('div', { class: 'field wide' });
      const draw = () => {
        const isChoice = Array.isArray(q.answers) && q.answers.length > 0;
        fill(wrap, 
          h('div', { class: 'seg' },
            h('button', { type: 'button', class: isChoice ? '' : 'on', onclick: () => { delete q.answers; delete q.correct; if (q.answer === undefined) q.answer = ''; changed(); draw(); } }, t('builder.f.typed')),
            h('button', { type: 'button', class: isChoice ? 'on' : '', onclick: () => { q.answers = q.answers && q.answers.length ? q.answers : ['', '', '', '']; q.correct = q.correct || 0; changed(); draw(); } }, t('builder.f.choices'))),
          h('div', { class: 'q-fields' }, isChoice ? answersEditor(q, set) : FIELD.answer(q, set)));
      };
      draw();
      return wrap;
    },
    clues: (q, set) => {
      const wrap = h('div', { class: 'field wide' });
      const draw = () => {
        const clues = q.clues || (q.clues = ['', '']);
        fill(wrap, h('span', {}, t('builder.f.clues')),
          h('ol', { class: 'clue-list' }, clues.map((c, i) => h('li', {},
            h('input', { value: c, maxlength: 120, oninput: e => { clues[i] = e.target.value; changed(); } }),
            clues.length > 2 ? h('button', { class: 'mini kick', type: 'button', onclick: () => { clues.splice(i, 1); changed(); draw(); } }, '×') : null))),
          clues.length < 6 ? h('button', { class: 'ghost-btn small', type: 'button', onclick: () => { clues.push(''); changed(); draw(); } }, t('builder.f.addClue')) : null,
          h('p', { class: 'hint small' }, t('builder.f.cluesHint')));
      };
      draw();
      return wrap;
    },
    image: (q, set) => mediaField(q, set),
    audio: (q, set) => audioField(q, set),
    video: (q, set) => videoField(q, set),
    // Your pick: two or three categories, each with its own question.
    options: q => {
      const wrap = h('div', { class: 'field wide level-edit' });
      const draw = () => {
        const opts = q.options || (q.options = []);
        fill(wrap, h('span', {}, t('builder.f.options')),
          opts.map((o, i) => h('div', { class: 'level-block', style: `--k: ${i}` },
            h('div', { class: 'opt-head' },
              input(t('builder.f.optionCategory'), o.category, v => { o.category = v; changed(); }, { el: { maxlength: 40 } }),
              opts.length > 2 ? h('button', { class: 'mini kick', type: 'button', onclick: () => { opts.splice(i, 1); changed(); draw(); } }, '×') : null),
            input(t('builder.f.question'), o.question, v => { o.question = v; changed(); }, { el: { maxlength: 200 } }),
            answersEditor(o, (k, v) => { o[k] = v; changed(); }))),
          opts.length < 3 ? h('button', { class: 'ghost-btn small', type: 'button', onclick: () => { opts.push({ category: '', question: '', answers: ['', '', '', ''], correct: 0 }); changed(); draw(); } }, t('builder.f.addOption')) : null);
      };
      draw();
      return wrap;
    },
    emoji: (q, set) => input(t('builder.f.emoji'), q.emoji, v => set('emoji', v), { cls: 'emoji-field', el: { maxlength: 40 } }),
    images: (q, set) => imagesField(q, set),
    items: (q, set) => listField(q, 'items', 3, 6, t('builder.f.items'), t('builder.f.itemsHint')),
    pairs: (q, set) => pairsField(q, set),
    // A long list, one item per line ("/" for other spellings).
    listItems: q => {
      const area = h('textarea', { rows: 8, maxlength: 4000, oninput: e => { q.items = e.target.value.split('\n').map(x => x.trim()).filter(Boolean); changed(); } });
      area.value = (q.items || []).join('\n');
      return h('label', { class: 'field wide' }, h('span', {}, t('builder.f.listItems')), area, h('p', { class: 'hint small' }, t('builder.f.listItemsHint')));
    },
    // Easy, medium and hard: three small questions with buttons.
    levels: q => {
      const levels = q.levels || (q.levels = [0, 1, 2].map(() => ({ question: '', answers: ['', '', '', ''], correct: 0 })));
      return h('div', { class: 'field wide level-edit' }, levels.map((lv, i) => h('div', { class: 'level-block', style: `--k: ${i}` },
        h('span', { class: 'level-tag' }, `${t(`play.level${i}`)} · ${t('builder.f.levelPoints', { n: i + 1 })}`),
        input(t('builder.f.question'), lv.question, v => { lv.question = v; changed(); }, { el: { maxlength: 200 } }),
        answersEditor(lv, (k, v) => { lv[k] = v; changed(); }))));
    },
    spot: (q, set) => spotField(q, set),
    time: (q, set, type) => input(t(type.kind === 'turn' ? 'builder.f.bonusTime' : 'builder.f.time'), q.time, v => set('time', Number(v) || undefined), { cls: 'small-field', el: { type: 'number', min: 3, max: 600, placeholder: type.defaults.time } }),
    points: (q, set, type) => input(t('builder.f.points'), q.points, v => set('points', Number(v) || undefined), { cls: 'small-field', el: { type: 'number', min: 1, max: 100, placeholder: type.defaults.points } }),
  };

  function answersEditor(q, set) {
    const wrap = h('div', { class: 'field wide' });
    const name = 'c' + Math.random().toString(36).slice(2);
    const draw = () => {
      const list = q.answers || (q.answers = ['', '']);
      fill(wrap, h('span', {}, t('builder.f.answers')),
        h('div', { class: 'answer-grid' }, list.map((a, i) => h('label', { class: 'answer-edit' + (q.correct === i ? ' right' : ''), style: `--a: var(--ans-${i})` },
          h('input', { type: 'radio', name, checked: q.correct === i ? 'checked' : null, title: t('builder.f.markRight'), onchange: () => { set('correct', i); draw(); } }),
          h('span', { class: 'letter' }, LETTERS[i]),
          h('input', { value: a, maxlength: 80, oninput: e => { list[i] = e.target.value; changed(); } }),
          list.length > 2 ? h('button', { class: 'mini kick', type: 'button', onclick: e => { e.preventDefault(); list.splice(i, 1); if (q.correct >= list.length) q.correct = 0; changed(); draw(); } }, '×') : null))),
        ...(list.length < 4 ? [h('button', { class: 'ghost-btn small', type: 'button', onclick: () => { list.push(''); changed(); draw(); } }, t('builder.f.addAnswer'))] : []),
        h('p', { class: 'hint small' }, t('builder.f.markRight')));
    };
    draw();
    return wrap;
  }

  // Pictures are made small (webp, max 1600 px) in the browser before they go to the laptop's library.
  async function shrink(file) {
    if (!/^image\/(jpeg|png|webp|bmp)$/.test(file.type)) return { blob: file, type: file.type };
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/webp', 0.82));
    return blob && blob.type === 'image/webp' ? { blob, type: 'image/webp' } : { blob: file, type: file.type };
  }

  async function upload(file) {
    const { blob, type } = await shrink(file);
    const res = await fetch('/api/host/media', { method: 'POST', headers: { 'Content-Type': type }, body: blob });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'upload');
    return data.url;
  }

  function mediaField(q, set) {
    const wrap = h('div', { class: 'field media-field' });
    const draw = () => {
      const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async e => {
        const f = e.target.files[0];
        if (!f) return;
        wrap.classList.add('busy');
        try { set('image', await upload(f)); } catch { alert(t('builder.uploadFailed')); }
        wrap.classList.remove('busy');
        if (q.spot !== undefined || typeOf(current.quiz.rounds[roundIndex].type).fields.includes('spot')) renderRound(); else draw();
      } });
      fill(wrap, h('span', {}, t('builder.f.image')),
        q.image ? h('div', { class: 'thumb' }, h('img', { src: q.image, alt: '' }), h('button', { class: 'mini kick', type: 'button', title: t('builder.f.removeImage'), onclick: () => { set('image', ''); draw(); } }, '×'))
          : h('label', { class: 'drop-zone' }, fileInput, h('span', {}, t('builder.f.addImage'))),
        q.imagePrompt ? h('div', { class: 'img-prompt' }, h('p', { class: 'hint small' }, t('builder.f.imagePrompt')), h('code', {}, q.imagePrompt),
          h('button', { class: 'ghost-btn small', type: 'button', onclick: () => copy(q.imagePrompt) }, t('ai.copy'))) : null);
      wrap.ondragover = e => { e.preventDefault(); wrap.classList.add('drop'); };
      wrap.ondragleave = () => wrap.classList.remove('drop');
      wrap.ondrop = async e => {
        e.preventDefault();
        wrap.classList.remove('drop');
        const f = e.dataTransfer.files[0];
        if (!f || !f.type.startsWith('image/')) return;
        try { set('image', await upload(f)); } catch { alert(t('builder.uploadFailed')); }
        draw();
      };
    };
    draw();
    return wrap;
  }

  // A short video clip for the big screen.
  function videoField(q, set) {
    const wrap = h('div', { class: 'field wide audio-field' });
    const take = async f => {
      if (!f || !f.type.startsWith('video/')) return;
      wrap.classList.add('busy');
      try { set('video', await upload(f)); } catch { alert(t('builder.uploadFailed')); }
      wrap.classList.remove('busy');
      draw();
    };
    const draw = () => {
      const fileInput = h('input', { type: 'file', accept: 'video/mp4,video/webm', hidden: true, onchange: e => take(e.target.files[0]) });
      fill(wrap, h('span', {}, t('builder.f.video')),
        q.video ? h('div', { class: 'audio-row' }, h('video', { src: q.video, controls: true, preload: 'metadata', class: 'video-preview' }),
          h('button', { class: 'mini kick', type: 'button', title: t('builder.f.removeVideo'), onclick: () => { set('video', ''); draw(); } }, '×'))
          : h('label', { class: 'drop-zone' }, fileInput, h('span', {}, t('builder.f.addVideo'))),
        q.videoHint ? h('p', { class: 'hint small' }, t('builder.f.videoHint', { clip: q.videoHint })) : null,
        h('p', { class: 'hint small' }, t('builder.f.audioRights')));
      wrap.ondragover = e => { e.preventDefault(); wrap.classList.add('drop'); };
      wrap.ondragleave = () => wrap.classList.remove('drop');
      wrap.ondrop = e => { e.preventDefault(); wrap.classList.remove('drop'); take(e.dataTransfer.files[0]); };
    };
    draw();
    return wrap;
  }

  // A sound file with an optional start and end second; the AI may have suggested which song to use.
  function audioField(q, set) {
    const wrap = h('div', { class: 'field wide audio-field' });
    const draw = () => {
      const fileInput = h('input', { type: 'file', accept: 'audio/*', hidden: true, onchange: async e => {
        const f = e.target.files[0];
        if (!f) return;
        wrap.classList.add('busy');
        try { set('audio', await upload(f)); } catch { alert(t('builder.uploadFailed')); }
        wrap.classList.remove('busy');
        draw();
      } });
      const player = q.audio ? h('audio', { src: q.audio, controls: true, preload: 'metadata' }) : null;
      fill(wrap, h('span', {}, t('builder.f.audio')),
        q.audio ? h('div', { class: 'audio-row' }, player,
          h('button', { class: 'ghost-btn small', type: 'button', onclick: () => { set('start', Math.floor(player.currentTime)); draw(); } }, t('builder.f.startHere')),
          h('button', { class: 'mini kick', type: 'button', title: t('builder.f.removeAudio'), onclick: () => { set('audio', ''); draw(); } }, '×'))
          : h('label', { class: 'drop-zone' }, fileInput, h('span', {}, t('builder.f.addAudio'))),
        q.audio ? h('div', { class: 'audio-row' },
          input(t('builder.f.start'), q.start, v => set('start', Number(v) || 0), { cls: 'small-field', el: { type: 'number', min: 0, step: 1 } }),
          input(t('builder.f.end'), q.end, v => set('end', Number(v) || undefined), { cls: 'small-field', el: { type: 'number', min: 0, step: 1, placeholder: t('builder.f.endAll') } })) : null,
        q.audioHint ? h('p', { class: 'hint small' }, t('builder.f.audioHint', { song: q.audioHint })) : null,
        h('p', { class: 'hint small' }, t('builder.f.audioRights')));
      wrap.ondragover = e => { e.preventDefault(); wrap.classList.add('drop'); };
      wrap.ondragleave = () => wrap.classList.remove('drop');
      wrap.ondrop = async e => {
        e.preventDefault();
        wrap.classList.remove('drop');
        const f = e.dataTransfer.files[0];
        if (!f || !f.type.startsWith('audio/')) return;
        try { set('audio', await upload(f)); } catch { alert(t('builder.uploadFailed')); }
        draw();
      };
    };
    draw();
    if (q.audio === undefined) q.audio = '';
    return wrap;
  }

  // Three or four pictures, one is the odd one out.
  function imagesField(q, set) {
    const wrap = h('div', { class: 'field wide' });
    const name = 'o' + Math.random().toString(36).slice(2);
    const draw = () => {
      const imgs = q.images || (q.images = ['', '', '', '']);
      q.captions = q.captions || imgs.map(() => '');
      fill(wrap, h('span', {}, t('builder.f.images')),
        h('div', { class: 'image-grid' }, imgs.map((src, i) => {
          const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async e => {
            const f = e.target.files[0];
            if (!f) return;
            try { imgs[i] = await upload(f); changed(); } catch { alert(t('builder.uploadFailed')); }
            draw();
          } });
          return h('div', { class: 'image-slot' + (q.correct === i ? ' right' : '') },
            src ? h('img', { src, alt: '' }) : h('label', { class: 'drop-zone' }, fileInput, h('span', {}, LETTERS[i] + ' +')),
            h('label', { class: 'slot-row' },
              h('input', { type: 'radio', name, checked: q.correct === i ? 'checked' : null, onchange: () => { set('correct', i); draw(); } }),
              h('input', { value: q.captions[i] || '', maxlength: 40, placeholder: t('builder.f.caption'), oninput: e => { q.captions[i] = e.target.value; changed(); } }),
              src ? h('button', { class: 'mini kick', type: 'button', onclick: () => { imgs[i] = ''; changed(); draw(); } }, '×') : null));
        })),
        h('p', { class: 'hint small' }, t('builder.f.oddHint')));
    };
    if (!Number.isInteger(q.correct)) q.correct = 0;
    draw();
    return wrap;
  }

  // A list of short texts (items in the right order).
  function listField(q, key, min, max, label, hint) {
    const wrap = h('div', { class: 'field wide' });
    const draw = () => {
      const items = q[key] || (q[key] = Array.from({ length: min + 1 }, () => ''));
      fill(wrap, h('span', {}, label),
        h('ol', { class: 'clue-list' }, items.map((c, i) => h('li', {},
          h('input', { value: c, maxlength: 80, oninput: e => { items[i] = e.target.value; changed(); } }),
          items.length > min ? h('button', { class: 'mini kick', type: 'button', onclick: () => { items.splice(i, 1); changed(); draw(); } }, '×') : null))),
        items.length < max ? h('button', { class: 'ghost-btn small', type: 'button', onclick: () => { items.push(''); changed(); draw(); } }, t('builder.f.addItem')) : null,
        h('p', { class: 'hint small' }, hint));
    };
    draw();
    return wrap;
  }

  function pairsField(q) {
    const wrap = h('div', { class: 'field wide' });
    const draw = () => {
      const pairs = q.pairs || (q.pairs = [['', ''], ['', ''], ['', ''], ['', '']]);
      fill(wrap, h('span', {}, t('builder.f.pairs')),
        h('div', { class: 'pair-list' }, pairs.map((p, i) => h('div', { class: 'pair-row' },
          h('input', { value: p[0], maxlength: 60, oninput: e => { p[0] = e.target.value; changed(); } }),
          h('span', { class: 'pair-eq' }, '='),
          h('input', { value: p[1], maxlength: 60, oninput: e => { p[1] = e.target.value; changed(); } }),
          pairs.length > 3 ? h('button', { class: 'mini kick', type: 'button', onclick: () => { pairs.splice(i, 1); changed(); draw(); } }, '×') : null))),
        pairs.length < 5 ? h('button', { class: 'ghost-btn small', type: 'button', onclick: () => { pairs.push(['', '']); changed(); draw(); } }, t('builder.f.addPair')) : null,
        h('p', { class: 'hint small' }, t('builder.f.pairsHint')));
    };
    draw();
    return wrap;
  }

  // Click the right spot on the map (the question's picture).
  function spotField(q, set) {
    const wrap = h('div', { class: 'field wide' });
    const draw = () => {
      if (!q.image) { fill(wrap, h('span', {}, t('builder.f.spot')), h('p', { class: 'hint small' }, t('builder.f.spotNeedsMap'))); return; }
      const pin = q.spot ? h('span', { class: 'spot-pin', style: `left: ${q.spot.x * 100}%; top: ${q.spot.y * 100}%` }) : null;
      const map = h('div', { class: 'spot-map', onclick: e => {
        const b = e.currentTarget.getBoundingClientRect();
        set('spot', { x: Math.round(((e.clientX - b.left) / b.width) * 1000) / 1000, y: Math.round(((e.clientY - b.top) / b.height) * 1000) / 1000 });
        draw();
      } }, h('img', { src: q.image, alt: '' }), pin);
      fill(wrap, h('span', {}, t('builder.f.spot')), map, input(t('builder.f.spotName'), q.answer, v => set('answer', v), { el: { maxlength: 60 } }), h('p', { class: 'hint small' }, t('builder.f.spotHint')));
    };
    draw();
    wrap.redraw = draw;
    return wrap;
  }

  // Paste a picture anywhere: it goes to the first question of this round without one.
  document.addEventListener('paste', async e => {
    if (!current || e.target.matches('input, textarea')) return;
    const item = [...(e.clipboardData || {}).items || []].find(i => i.type.startsWith('image/'));
    const r = current.quiz.rounds[roundIndex];
    if (!item || !r || !typeOf(r.type).fields.includes('image')) return;
    const q = r.questions.find(x => !x.image);
    if (!q) return;
    try { q.image = await upload(item.getAsFile()); changed(); renderRound(); } catch { alert(t('builder.uploadFailed')); }
  });

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); } catch {
      const ta = h('textarea', {}, text);
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
  }

  // ---------- check, export, play, delete ----------

  $('#check-btn').addEventListener('click', async () => {
    await flushSave();
    const res = await api('POST', '/library/check', { quiz: current.quiz });
    const box = $('#check-result');
    box.hidden = false;
    box.className = 'check-result ' + (res.ok ? 'ok' : 'bad');
    box.textContent = res.ok ? t('builder.checkOk', { n: estimateMinutes(current.quiz) }) : t('builder.checkProblem', { problem: res.problem });
  });

  $('#export-json').addEventListener('click', async () => { await flushSave(); location.href = '/api/host/export?path=' + encodeURIComponent(current.path); });
  $('#export-csv').addEventListener('click', async () => { await flushSave(); location.href = '/api/host/export?format=csv&path=' + encodeURIComponent(current.path); });
  $('#print-sheet').addEventListener('click', async () => { await flushSave(); window.open('/print?open=' + encodeURIComponent(current.path), '_blank'); });
  $('#delete-quiz').addEventListener('click', () => deleteItem(current.path, false));

  $('#play-btn').addEventListener('click', async () => {
    await flushSave();
    const socket = io({ query: { role: 'host' } });
    socket.emit('load', { library: current.path }, res => {
      socket.close();
      if (res && res.error) {
        const box = $('#check-result');
        box.hidden = false;
        box.className = 'check-result bad';
        box.textContent = t('builder.checkProblem', { problem: res.detail || '' });
        return;
      }
      location.href = '/host';
    });
  });

  // ---------- round type picker ----------

  let pickerFamily = 'all';
  function openPicker() {
    const dlg = $('#picker');
    $('#picker-search').value = '';
    pickerFamily = 'all';
    renderPicker();
    dlg.showModal();
    $('#picker-search').focus();
  }

  function renderPicker() {
    const fams = ['all', ...catalog.families.filter(f => catalog.types.some(x => x.family === f))];
    $('#picker-families').replaceChildren(...fams.map(f => h('button', { class: 'chip' + (f === pickerFamily ? ' on' : ''), onclick: () => { pickerFamily = f; renderPicker(); } }, t(`family.${f}`))));
    const q = $('#picker-search').value.trim().toLowerCase();
    const types = catalog.types.filter(x => (pickerFamily === 'all' || x.family === pickerFamily)
      && (!q || (typeName(x.id) + ' ' + t(`round.${x.id}.desc`)).toLowerCase().includes(q)));
    $('#picker-grid').replaceChildren(...types.map(x => h('button', { class: 'type-card', style: glow(x.id), onclick: () => { $('#picker').close(); addRound(x.id); } },
      icon(x.id),
      h('strong', {}, typeName(x.id)),
      h('span', { class: 'desc' }, t(`round.${x.id}.desc`)),
      h('span', { class: 'tags' }, h('span', { class: 'tag' }, t(`family.${x.family}`)), h('span', { class: 'tag' }, t(`kind.${x.kind}`))))));
  }
  $('#picker-search').addEventListener('input', renderPicker);

  document.querySelectorAll('dialog [data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
  document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));

  // ---------- AI ----------

  let aiWhole = false;
  let aiResult = null;

  async function openAi({ whole }) {
    aiWhole = whole;
    aiResult = null;
    const dlg = $('#ai-modal');
    dlg.classList.toggle('whole', whole);
    const r = !whole && current && current.quiz.rounds[roundIndex];
    $('#ai-title').textContent = whole ? t('builder.aiWhole') : t('ai.forRound', { type: typeName(r.type) });
    $('#ai-audience').replaceChildren(...['mixed', 'kids', 'family', 'company', 'experts'].map(a => h('option', { value: a }, t(`ai.audience.${a}`))));
    $('#ai-language').replaceChildren(...['en', 'nl', 'fr', 'de', 'es'].map(l => h('option', { value: l, selected: l === I18n.lang ? 'selected' : null }, t(`ai.lang.${l}`))));
    $('#ai-difficulty-out').textContent = t(`ai.level.${$('#ai-difficulty').value}`);
    $('#ai-error').textContent = '';
    $('#ai-result').replaceChildren();
    $('#ai-paste').value = '';
    const s = await api('GET', '/ai/settings');
    $('#ai-key-state').textContent = s.hasKey ? t('ai.keyReady', { name: s.providers[s.provider].name }) : t('ai.noKeyYet');
    $('#ai-generate').disabled = !s.hasKey;
    dlg.showModal();
    $('#ai-topic').focus();
  }
  $('#ai-difficulty').addEventListener('input', e => { $('#ai-difficulty-out').textContent = t(`ai.level.${e.target.value}`); });

  function aiOptions() {
    const r = !aiWhole && current.quiz.rounds[roundIndex];
    return {
      whole: aiWhole,
      type: r ? r.type : undefined,
      topic: $('#ai-topic').value,
      theme: $('#ai-theme').value,
      audience: $('#ai-audience').value,
      language: $('#ai-language').value,
      difficulty: Number($('#ai-difficulty').value),
      count: Number($('#ai-count').value),
      rounds: Number($('#ai-rounds').value),
      minutes: Number($('#ai-minutes').value),
      perRound: 8,
    };
  }

  const aiFail = err => { $('#ai-error').textContent = t(/^ai\./.test(err.message) ? err.message : 'ai.failed') + (err.detail ? ` (${err.detail})` : ''); };

  $('#ai-copy').addEventListener('click', async () => {
    try {
      const { prompt: text } = await api('POST', '/ai/prompt', aiOptions());
      await copy(text);
      $('#ai-copy').textContent = t('ai.copied');
      setTimeout(() => { $('#ai-copy').textContent = t('ai.copyPrompt'); }, 2000);
    } catch (err) { aiFail(err); }
  });

  $('#ai-read').addEventListener('click', async () => {
    $('#ai-error').textContent = '';
    try {
      const o = aiOptions();
      showAiResult(await api('POST', '/ai/parse', { whole: o.whole, type: o.type, text: $('#ai-paste').value }));
    } catch (err) { aiFail(err); }
  });

  $('#ai-generate').addEventListener('click', async () => {
    const btn = $('#ai-generate');
    $('#ai-error').textContent = '';
    btn.disabled = true;
    btn.classList.add('busy');
    btn.textContent = t('ai.working');
    try { showAiResult(await api('POST', '/ai/generate', aiOptions())); } catch (err) { aiFail(err); }
    btn.disabled = false;
    btn.classList.remove('busy');
    btn.textContent = t('ai.generate');
  });

  function questionLine(q) {
    const main = q.question || (q.clues || []).join(' · ') || q.answer;
    const ans = Array.isArray(q.answers) && q.answers.length ? q.answers[q.correct] : typeof q.correct === 'boolean' ? t(q.correct ? 'play.true' : 'play.false') : q.answer;
    return h('span', {}, main, ' ', h('em', {}, '→ ', String(ans ?? '')));
  }

  function showAiResult(res) {
    aiResult = res;
    const box = $('#ai-result');
    if (res.quiz) {
      box.replaceChildren(
        h('h3', {}, res.quiz.title),
        h('ol', { class: 'ai-rounds' }, res.quiz.rounds.map(r => h('li', { style: glow(r.type) }, icon(r.type), h('strong', {}, r.title || typeName(r.type)), ' ', h('span', { class: 'hint' }, `${typeName(r.type)} · ${t('builder.questionsN', { n: r.questions.length })}`)))),
        h('button', { class: 'brass-btn', onclick: async () => { $('#ai-modal').close(); await newQuiz({ ...res.quiz, jokers: true }); } }, t('ai.useQuiz')));
      return;
    }
    const checks = res.questions.map(() => true);
    box.replaceChildren(
      h('ol', { class: 'ai-questions' }, res.questions.map((q, i) => h('li', {}, h('label', {}, h('input', { type: 'checkbox', checked: 'checked', onchange: e => { checks[i] = e.target.checked; } }), questionLine(q))))),
      h('div', { class: 'ai-use' },
        h('button', { class: 'brass-btn', onclick: () => useQuestions(res.questions.filter((_, i) => checks[i]), false) }, t('ai.add')),
        h('button', { class: 'ghost-btn', onclick: () => useQuestions(res.questions.filter((_, i) => checks[i]), true) }, t('ai.replace'))));
  }

  function useQuestions(list, replace) {
    const r = current.quiz.rounds[roundIndex];
    const empty = q => !q.question && !q.answer && !(q.clues || []).some(Boolean) && !q.image;
    const keep = replace ? [] : r.questions.filter(q => !empty(q));
    r.questions = [...keep, ...list];
    $('#ai-modal').close();
    changed();
    renderRound();
    renderTimeline();
  }

  // ---------- AI keys ----------

  let settingsProvider = 'gemini';
  let aiSettings = null;
  $('#ai-settings-btn').addEventListener('click', async () => {
    aiSettings = await api('GET', '/ai/settings');
    settingsProvider = aiSettings.provider;
    renderSettings();
    $('#settings-modal').showModal();
  });

  function renderSettings() {
    $('#provider-chips').replaceChildren(...Object.entries(aiSettings.providers).map(([id, p]) => h('button', {
      type: 'button', class: 'chip' + (id === settingsProvider ? ' on' : ''),
      onclick: () => { settingsProvider = id; renderSettings(); },
    }, p.name, p.hasKey ? ' ✓' : '')));
    const p = aiSettings.providers[settingsProvider];
    $('#set-key').value = '';
    $('#set-key').placeholder = p.hasKey ? p.keyHint : t('ai.keyPlaceholder');
    $('#set-model').value = p.model;
  }

  $('#settings-form').addEventListener('submit', async e => {
    e.preventDefault();
    const body = { provider: settingsProvider, model: $('#set-model').value };
    if ($('#set-key').value.trim()) body.key = $('#set-key').value.trim();
    aiSettings = await api('PUT', '/ai/settings', body);
    $('#settings-modal').close();
  });

  // ---------- my quiz folder (OneDrive / Google Drive) ----------

  let cloud = null;
  let cloudSeen = 0;
  const cloudLabel = kind => t(`cloud.kind.${kind}`);

  async function loadCloud() {
    try { cloud = await api('GET', '/cloud'); } catch { return; }
    $('#cloud-dot').className = 'cloud-dot' + (cloud.folder ? (cloud.error ? ' bad' : ' on') : '');
    $('#cloud-btn').title = cloud.folder || '';
    // Something came in from the other computer: show it in the list.
    if (cloud.at && cloud.at !== cloudSeen) {
      if (cloudSeen && (cloud.pulled || cloud.removed)) refreshLibrary();
      cloudSeen = cloud.at;
    }
    if ($('#cloud-modal').open) renderCloud();
  }

  function cloudTime(at) {
    return new Date(at).toLocaleTimeString(I18n.lang || undefined, { hour: '2-digit', minute: '2-digit' });
  }

  function renderCloud(problem) {
    const status = $('#cloud-status');
    const err = problem || cloud.error;
    status.className = 'cloud-status' + (err ? ' bad' : cloud.folder ? ' on' : '');
    if (err) status.textContent = t(err, { detail: cloud.detail || '' });
    else if (!cloud.folder) status.textContent = t('cloud.none');
    else status.replaceChildren(t('cloud.linked'), ' ', h('strong', {}, cloud.folder), h('br'),
      cloud.at ? t('cloud.lastSync', { time: cloudTime(cloud.at), pulled: cloud.pulled, pushed: cloud.pushed }) : t('cloud.waiting'));
    $('#cloud-linked').hidden = !cloud.folder;
    $('#cloud-open').hidden = !cloud.canPick;
    $('#cloud-browse').hidden = !cloud.canPick;
    $('#cloud-sugg-label').hidden = !cloud.suggestions.length;
    $('#cloud-sugg').replaceChildren(...cloud.suggestions.map(sg => h('button', {
      type: 'button', class: 'chip' + (sg.path === cloud.folder ? ' on' : ''), title: sg.path,
      onclick: () => { $('#cloud-path').value = sg.path; useCloud(); },
    }, cloudLabel(sg.kind))));
    if (!$('#cloud-path').value) $('#cloud-path').value = cloud.folder || '';
  }

  async function cloudCall(btn, url, body) {
    btn.classList.add('busy');
    try {
      const view = await api('POST', url, body);
      cloud = { ...cloud, ...view };
      renderCloud();
      if (view.at) { cloudSeen = view.at; await refreshLibrary(); }
    } catch (err) {
      renderCloud(err.message);
    } finally {
      btn.classList.remove('busy');
      loadCloud();
    }
  }
  const useCloud = () => cloudCall($('#cloud-use'), '/cloud/choose', { folder: $('#cloud-path').value });

  $('#cloud-btn').addEventListener('click', async () => {
    await loadCloud();
    if (!cloud) return;
    $('#cloud-path').value = cloud.folder || '';
    renderCloud();
    $('#cloud-modal').showModal();
  });
  $('#cloud-use').addEventListener('click', useCloud);
  $('#cloud-path').addEventListener('keydown', e => { if (e.key === 'Enter') useCloud(); });
  $('#cloud-sync').addEventListener('click', () => cloudCall($('#cloud-sync'), '/cloud/sync'));
  $('#cloud-open').addEventListener('click', () => api('POST', '/cloud/open').catch(() => {}));
  $('#cloud-off').addEventListener('click', () => {
    if (!confirm(t('cloud.disconnectSure'))) return;
    $('#cloud-path').value = '';
    cloudCall($('#cloud-off'), '/cloud/choose', { folder: '' });
  });
  $('#cloud-browse').addEventListener('click', async () => {
    const res = await api('POST', '/cloud/pick').catch(err => ({ error: err.message }));
    if (res.error) return renderCloud(res.error);
    if (res.path) { $('#cloud-path').value = res.path; useCloud(); }
  });
  loadCloud();
  setInterval(loadCloud, 30000);

  start().catch(err => { console.error(err); setSaveState('error.generic'); });
})();
