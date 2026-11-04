// The quiz builder in a real browser, for every round type: paste an AI answer in the AI dialog, see every field
// filled in, add the pictures, sounds and videos by hand in the slots the builder offers, and end with a quiz that
// passes the check. Then the quiz is played on the big screen, a phone and the quizmaster's screen without a script error.
// Needs Playwright with Chromium; without it the test is skipped.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { io: connect } = require('socket.io-client');
const { createServer } = require('../src/app');
const rounds = require('../src/rounds');
const SAMPLES = require('./fixtures/ai-answers');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* not installed: skip */ }

// Tiny but real files for the upload fields.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAEUlEQVR4nGM4UaGBFTEMpAQA5jNDgbfBAhwAAAAASUVORK5CYII=', 'base64');
const FILES = {
  image: { name: 'pic.png', mimeType: 'image/png', buffer: PNG },
  audio: { name: 'clip.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('ID3\u0003\u0000\u0000\u0000\u0000\u0000\u0000fake mp3 for the test') },
  video: { name: 'clip.mp4', mimeType: 'video/mp4', buffer: Buffer.from('\u0000\u0000\u0000\u0018ftypmp42 fake mp4 for the test') },
};

// The texts of a sample that must show up somewhere in the editor after reading it in.
function textsOf(sample) {
  const out = [];
  const walk = (v, depth = 0) => {
    if (typeof v === 'string' && v.length > 1 && !/^[\d.,\s-]+$/.test(v)) out.push(v);
    else if (typeof v === 'number' && !Number.isInteger(v)) out.push(String(v));
    else if (Array.isArray(v)) v.forEach(x => walk(x, depth + 1));
    // One "did you know" line per question: the ones inside levels or categories have no field of their own.
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (!(k === 'fact' && depth > 0) && !['imagePrompt', 'imagePrompts', 'imageSearch', 'imageSearches', 'song', 'sound', 'clip', 'mapHint', 'clipStart', 'correct'].includes(k)) walk(x, depth + 1);
  };
  walk(sample);
  return out;
}

test('builder: every round type from a pasted AI answer, completed by hand, passes the check and plays', { skip: !chromium && 'Playwright is not installed', timeout: 900000 }, async t => {
  const settingsData = { language: 'en', sfx: false };
  const qb = createServer({
    port: 0,
    settings: { get: k => settingsData[k], set: (k, v) => { settingsData[k] = v; } },
    library: require('../src/library').create(fs.mkdtempSync(path.join(os.tmpdir(), 'qb-builder-'))),
    lanAddresses: () => ['192.168.1.50'],
    // No internet in the test: picture suggestions find nothing.
    webFetch: async () => ({ ok: false, status: 503, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0), headers: new Map() }),
  });
  const port = await qb.listen();
  const url = `http://127.0.0.1:${port}`;
  const api = async (method, p, body) => (await fetch(`${url}/api/host${p}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })).json();
  const browser = await chromium.launch();
  const sockets = [];
  t.after(async () => { sockets.forEach(s => s.close()); await browser.close(); await qb.close(); });

  const failures = [];
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  page.on('pageerror', e => failures.push(`builder: script error ${e.message}`));
  page.on('dialog', d => { failures.push(`builder: unexpected message "${d.message()}"`); d.dismiss(); });
  const built = [];

  for (const type of rounds.TYPES) {
    const where = type.id;
    const sample = SAMPLES[type.id];
    // A new quiz with one round of this type, as "Add round" makes it.
    const { path: quizPath } = await api('PUT', '/library/quiz', { quiz: { title: `AI ${type.id}`, rounds: [{ type: type.id, title: '', scoring: type.defaults.scoring || null, twists: [], questions: [{ question: '' }] }] } });
    // The builder of the round before may still be leaving (its last save on the way out): try a second time then.
    const target = `${url}/builder?open=${encodeURIComponent(quizPath)}`;
    await page.goto(target).catch(e => (/ERR_ABORTED/.test(e.message) ? page.goto(target) : Promise.reject(e)));
    await page.waitForSelector('#editor:not([hidden]) .q-card');

    // The AI dialog: paste what the AI chat answered (with some chatter around it) and replace the empty question.
    await page.click('.re-actions .ai-btn');
    await page.waitForSelector('#ai-modal[open]');
    const answer = `Here you go!\n\`\`\`json\n${JSON.stringify({ questions: [sample, sample] }, null, 2)}\n\`\`\``;
    await page.fill('#ai-paste', answer);
    await page.click('#ai-read');
    await page.waitForSelector('#ai-result .ai-use .ghost-btn', { timeout: 5000 }).catch(() => failures.push(`${where}: the AI answer was not read (${(page.locator('#ai-error').textContent())})`));
    if (!(await page.$('#ai-result .ai-use .ghost-btn'))) continue;
    await page.click('#ai-result .ai-use .ghost-btn');
    await page.waitForFunction(() => document.querySelectorAll('.q-card').length === 2);

    // Every text the AI wrote is in a field the quizmaster can edit.
    const card = page.locator('.q-card').first();
    const values = (await card.evaluate(el => [...el.querySelectorAll('input, textarea')].map(i => i.value).join(' \n '))).toLowerCase();
    for (const text of textsOf(sample)) if (!values.includes(text.split('/')[0].trim().toLowerCase())) failures.push(`${where}: "${text}" is not in any field`);

    // The slots the quizmaster fills by hand are there.
    const count = sel => card.locator(sel).count();
    if (type.fields.includes('image') && !(await count('.media-field .drop-zone'))) failures.push(`${where}: no place to add the picture`);
    if (type.fields.includes('audio') && !(await count('.audio-field .drop-zone input[accept^="audio"]'))) failures.push(`${where}: no place to add the sound`);
    if (type.fields.includes('video') && !(await count('.audio-field .drop-zone input[accept^="video"]'))) failures.push(`${where}: no place to add the video`);
    if (type.fields.includes('images') && (await count('.image-slot .drop-zone')) !== 4) failures.push(`${where}: ${await count('.image-slot .drop-zone')} picture slots instead of 4`);
    if (type.fields.includes('levels') && (await count('.level-block')) !== 3) failures.push(`${where}: not 3 levels`);
    if (type.fields.includes('options') && (await count('.level-block')) !== 3) failures.push(`${where}: not 3 categories`);
    if (type.fields.includes('answers') && (await count('.answer-edit')) !== 4) failures.push(`${where}: not 4 answers`);
    if (type.fields.includes('answers') && (await card.locator('.answer-edit.right input:not([type=radio])').first().inputValue()) !== sample.answers[sample.correct]) failures.push(`${where}: the wrong answer is marked right`);
    if (type.fields.includes('images') && (await card.locator('.image-slot.right .slot-row input:not([type=radio])').first().inputValue()) !== sample.captions[sample.correct]) failures.push(`${where}: the wrong picture is marked odd`);
    if (type.fields.includes('images') && !(await count('.img-prompt'))) failures.push(`${where}: the picture prompts of the AI are not shown`);

    // Add every picture, sound and video, then click the spot on the map.
    for (let guard = 0; guard < 16; guard++) {
      const input = page.locator('.q-list .drop-zone input[type=file]').first();
      if (!(await input.count())) break;
      const accept = await input.getAttribute('accept');
      const before = await page.locator('.q-list .drop-zone input[type=file]').count();
      await input.setInputFiles(accept.startsWith('audio') ? FILES.audio : accept.startsWith('video') ? FILES.video : FILES.image);
      await page.waitForFunction(n => document.querySelectorAll('.q-list .drop-zone input[type=file]').length < n, before, { timeout: 5000 })
        .catch(() => failures.push(`${where}: an upload (${accept}) did not land in its slot`));
      if ((await page.locator('.q-list .drop-zone input[type=file]').count()) >= before) break;
    }
    for (const map of await page.locator('.spot-map').all()) await map.click({ position: { x: 5, y: 5 } }).catch(() => failures.push(`${where}: the map can not be clicked`));
    await page.waitForFunction(() => document.querySelector('#save-state').dataset.state === 'builder.saved', null, { timeout: 8000 }).catch(() => failures.push(`${where}: not saved`));

    // Saved, read back, and complete.
    const quiz = await api('GET', `/library/quiz?path=${encodeURIComponent(quizPath)}`);
    const check = await api('POST', '/library/check', { quiz });
    if (!check.ok) failures.push(`${where}: check says "${check.problem}"`);
    else built.push(quiz.rounds[0]);
  }

  // The rounds made in the builder, played as one quiz night on the big screen, a phone and the quizmaster's laptop.
  const { path: nightPath } = await api('PUT', '/library/quiz', { quiz: { title: 'Built from the AI', rounds: built } });
  const host = connect(url, { query: { role: 'host' }, transports: ['websocket'], forceNew: true });
  sockets.push(host);
  let state = null;
  host.on('state', s => { state = s; });
  assert.equal((await new Promise(r => host.emit('load', { library: nightPath }, r))).ok, true);
  const teams = [];
  for (let i = 0; i < 2; i++) {
    const id = `teamab${i}cdefgh`;
    const s = connect(url, { query: { role: 'player', teamId: id }, transports: ['websocket'], forceNew: true });
    sockets.push(s);
    s.on('state', st => { s.last = st; });
    assert.equal((await new Promise(r => s.emit('join', { teamId: id, name: `Team ${i}`, color: ['amber', 'pink'][i] }, r))).ok, true);
    teams.push(s);
  }
  const screen = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await phone.addInitScript(() => localStorage.setItem('qb.teamId', 'teamab0cdefgh'));
  const hostPage = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  for (const [name, p] of [['screen', screen], ['phone', phone], ['host', hostPage]]) p.on('pageerror', e => failures.push(`${name}: script error ${e.message} (${state && state.round ? state.round.type : ''} ${state && state.phase})`));
  await screen.goto(`${url}/screen?fx=off`);
  await phone.goto(`${url}/play?fx=off`);
  await hostPage.goto(`${url}/host?fx=off`);
  const settle = (ms = 250) => new Promise(r => setTimeout(r, ms));
  const answerFor = q => ({ choice: 0, trueFalse: 0, number: 8800, order: [...Array((q.items || []).length).keys()], pairs: [...Array((q.left || []).length).keys()], point: { x: 0.5, y: 0.5 }, level: 0, buzz: true, list: 'Belgium',
    groups: { groups: Array.from({ length: q.groupCount || 0 }, (_, g) => [0, 1, 2, 3].map(k => g * 4 + k)), links: [] } }[q.kind] ?? 'Ottawa');
  const played = new Set();
  host.emit('next');
  await settle();
  for (let guard = 0; guard < 600 && state && state.phase !== 'end'; guard++) {
    if (state.phase === 'wager') teams.forEach((p, i) => { p.emit('wager', 1); p.emit('pick', i); });
    if (state.phase === 'question') {
      played.add(state.round.type);
      await settle();
      // The screen may lag a little behind when the machine is busy with the other browser tests.
      const type = state.round.type;
      await screen.locator('#v-question').waitFor({ state: 'visible', timeout: 4000 }).catch(() => failures.push(`screen: no question shown for ${type}`));
      if (!(await phone.evaluate(() => [...document.querySelectorAll('.view')].some(v => !v.hidden)))) failures.push(`phone: nothing shown for ${state.round.type}`);
      teams.forEach(p => { const q = p.last && p.last.question; if (q && q.kind && q.kind !== 'turn') p.emit('answer', answerFor(q)); });
      await settle();
      if (state.phase === 'question' && (state.buzz || (state.question && state.question.kind === 'turn'))) host.emit('buzzJudge', true);
    }
    host.emit('next');
    await settle(120);
  }
  assert.equal(state.phase, 'end', `stuck in ${state.phase}`);
  assert.deepEqual(failures, []);
  assert.deepEqual([...played].sort(), rounds.TYPES.map(x => x.id).sort());
});
