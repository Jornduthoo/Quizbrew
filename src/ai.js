// AI help in the quiz builder. Two ways, same result:
//  - with the quizmaster's own key (Gemini, Claude or ChatGPT): Quizbrew asks the AI directly;
//  - without a key: the builder shows the prompt, the quizmaster pastes it in any AI chat and pastes the answer back.
// Plain fetch, no extra libraries. Keys stay in data/settings.json on this laptop and never go to a browser.
const rounds = require('./rounds');

const PROVIDERS = {
  gemini: { name: 'Gemini', key: 'geminiKey', model: 'geminiModel', defaultModel: 'auto' },
  claude: { name: 'Claude', key: 'claudeKey', model: 'claudeModel', defaultModel: 'claude-sonnet-5-5' },
  openai: { name: 'ChatGPT', key: 'openaiKey', model: 'openaiModel', defaultModel: 'gpt-6.1-sol' },
};
const LANGUAGE_NAMES = { en: 'English', nl: 'Dutch (Flemish, as spoken in Belgium)', fr: 'French', de: 'German', es: 'Spanish' };
const AUDIENCES = { mixed: 'a mixed adult pub crowd', kids: 'children aged 8 to 12', experts: 'experienced quiz fans', company: 'colleagues at a company party', family: 'a family party with all ages' };
const DIFFICULTY = ['', 'very easy', 'easy', 'medium', 'hard', 'very hard'];

const RULES = [
  'Facts must be correct, current and unambiguous: one clear right answer.',
  'Keep questions short enough to read on a TV in a few seconds (max 120 characters).',
  'Never mention or copy existing TV quiz shows, game shows, quiz brands or board games.',
  'Give every question a "fact" field: one short, surprising and true extra sentence for after the answer (max 120 characters).',
  'Keep alcohol, drinking and drugs out of questions, answers and facts unless the topic itself asks for it.',
  'Answer with JSON only, no explanation before or after it.',
];

function brief({ topic, difficulty = 3, audience = 'mixed', language = 'en', theme = '' }) {
  return [
    `Topic: ${String(topic || 'general knowledge').slice(0, 200)}.`,
    theme ? `Theme of the evening: ${String(theme).slice(0, 200)}.` : '',
    `Audience: ${AUDIENCES[audience] || AUDIENCES.mixed}.`,
    `Difficulty: ${DIFFICULTY[Math.max(1, Math.min(5, Number(difficulty) || 3))]}.`,
    `Language of all text: ${LANGUAGE_NAMES[language] || LANGUAGE_NAMES.en}.`,
  ].filter(Boolean).join('\n');
}

// The prompt for the questions of one round.
function roundPrompt({ type: typeId, count = 8, ...rest }) {
  const type = rounds.get(typeId);
  if (!type) throw new Error('Unknown round type');
  const n = Math.max(1, Math.min(30, Number(count) || 8));
  return [
    `You write questions for a quiz night. Write ${n} questions for one round.`,
    `Round type: ${type.id} - ${TYPE_HELP[type.id] || ''}`,
    brief(rest),
    '',
    'Rules:',
    ...RULES.map(r => `- ${r}`),
    '',
    'Return exactly this JSON:',
    `{"questions": [ ${type.aiShape}, ... ]}`,
  ].join('\n');
}

// The prompt for a whole evening: the AI picks the round types too.
function quizPrompt({ rounds: roundCount = 6, perRound = 8, minutes = 90, types = [], ...rest }) {
  const allowed = (types.length ? types : rounds.TYPES.map(t => t.id)).map(rounds.get).filter(Boolean);
  const n = Math.max(1, Math.min(12, Number(roundCount) || 6));
  return [
    `You put together a complete quiz night of about ${Number(minutes) || 90} minutes with ${n} rounds of about ${Number(perRound) || 8} questions.`,
    'Vary the round types and build up the tension: start easy and fun, end with the strongest round.',
    brief(rest),
    '',
    'Round types you may use (id - what it is - shape of one question):',
    ...allowed.map(t => `- ${t.id} - ${TYPE_HELP[t.id] || ''} - ${t.aiShape}`),
    '',
    'Rules:',
    ...RULES.map(r => `- ${r}`),
    '- Round types with pictures get an "imagePrompt" and an "imageSearch" per question; the quizmaster finds or makes the pictures later.',
    '',
    'Return exactly this JSON:',
    '{"title": "a catchy title for the evening", "rounds": [ {"type": "<id>", "title": "round title", "questions": [ ... ]}, ... ]}',
  ].join('\n');
}

// English explanation of each round type for the AI.
const TYPE_HELP = {
  classic: 'multiple choice with 4 options, 1 right',
  trueFalse: 'a statement that is true or false',
  open: 'an open question with a short typed answer',
  closest: 'estimate a number; the closest team wins',
  picture: 'a picture is shown; teams name what or who it is',
  zoomOut: 'a picture starts zoomed in very far and slowly zooms out; teams name what it is',
  speed: 'quick multiple choice with 4 options; fast answers score more, keep questions very short',
  scramble: 'the letters of a word are shuffled; teams find the word',
  commonThread: 'clues appear one by one from hard to easy; teams find what links them',
  jackpot: 'teams bet points after seeing only the category, then answer one hard open question',
  music: 'a music fragment plays; teams name the artist or title',
  introSprint: 'the intro of a song plays in growing bursts; the earlier a team names it, the more points',
  rewind: 'a song plays backwards; teams name it',
  soundCheck: 'a sound plays (animal, machine, place); teams say what it is',
  lyricGap: 'a line of a song with one word missing; teams type the missing word',
  pixelFog: 'a picture starts as big blocks and gets sharper; teams name what it is',
  silhouette: 'only the black outline of a picture is shown; teams name it',
  oddOneOut: 'four pictures, one does not belong; teams pick it',
  emoji: 'a row of emoji spells out a film, song, saying or place; teams type it',
  orderUp: 'teams put 4 items in the right order (by year, size, distance...)',
  pairUp: 'teams match 4 items on the left to 4 items on the right',
  mapDrop: 'teams tap a spot on a map; the closest pin wins',
  buzzer: 'the first team to buzz answers out loud; short, quick questions with one clear answer',
  lastStanding: 'a wrong answer and the team is out for the rest of the round; start easy, get harder',
  pushYourLuck: 'every right answer doubles the pot, teams may bank it or risk it on the next question; get harder as you go',
  steal: 'right teams take points from the leader; medium-hard questions',
  pickYourLevel: 'per topic an easy, a medium and a hard question; each team picks a level before seeing it',
  hotStreak: 'right answers in a row count up (1x, 2x, 3x); a steady mix of questions',
  listRush: 'teams type as many items of a list as they can (countries, colours, players...)',
  drawGuess: 'every team draws the same funny thing on its phone, then the teams vote for the best drawing',
  captionThis: 'teams write the funniest caption for a picture, then vote for the best one',
  bluffBank: 'an obscure question; teams write a fake answer, then everyone looks for the real one between the bluffs',
  actItOut: 'one team acts out the answer without words, the others type what it is',
  photoHunt: 'teams take a photo with their phone for a fun task in the room, then vote for the best photo',
  whosWho: 'teams answer a personal question, then guess which team wrote which answer',
  stakeIt: 'teams see only the category, bet points, then answer a multiple choice question; right wins the bet, wrong loses it',
  localLegend: 'questions about the own town, club or pub of the players (the quizmaster checks every fact)',
  wordWeb: '12 words hide 3 groups of 4; teams sort the words into groups and name what links each group',
  clueLadder: 'who or what is this: clues appear one by one from very hard to easy, an early answer scores more',
  fiveFacts: 'an open question with exactly five right keywords; every keyword found scores',
  clipRecall: 'the teams watch a short video clip, then type as many details as they remember',
  opponentsPick: 'the leading team picks one of three categories for the other teams; one multiple choice question per category',
  headToHead: 'finale: the top two teams answer a fast multiple choice question, the other teams predict who wins',
  clockBank: 'one team at a time answers out loud while its own clock runs; quick questions with one clear answer',
  clockDuel: 'finale: the top two teams take turns answering out loud against their own clock; many quick questions',
  crowdMind: 'no right answer: teams score by giving the answer most other teams give',
};

// ---------- reading the AI's answer ----------

// Every {...} block with matching braces, longest first (ignores braces inside strings).
function candidates(str) {
  const out = [];
  for (let start = str.indexOf('{'); start !== -1 && out.length < 50; start = str.indexOf('{', start + 1)) {
    let depth = 0;
    let quote = false;
    for (let i = start; i < str.length; i++) {
      const ch = str[i];
      if (quote) {
        if (ch === '\\') i++;
        else if (ch === '"') quote = false;
        continue;
      }
      if (ch === '"') quote = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) { out.push(str.slice(start, i + 1)); break; }
    }
  }
  return out.sort((a, b) => b.length - a.length);
}

function tryParse(text) {
  for (const t of [text, text.replace(/[“”„]/g, '"').replace(/[‘’]/g, "'"), text.replace(/[“”„]/g, '"').replace(/,\s*([}\]])/g, '$1')]) {
    try {
      const data = JSON.parse(t);
      if (data && typeof data === 'object' && !Array.isArray(data)) return data;
    } catch { /* next try */ }
  }
  return null;
}

// A forgiving JSON reader for what people paste from an AI chat: smart quotes, quotes inside texts
// ("The Rock"), line breaks inside texts, comments, trailing commas, and an answer that was cut off.
function lenient(str, start) {
  let i = start;
  let cut = false;
  const QUOTES = '"\u201c\u201d\u201e';
  const ws = () => {
    for (;;) {
      while (i < str.length && /[\s\u00a0\ufeff]/.test(str[i])) i++;
      if (str.startsWith('//', i)) { while (i < str.length && str[i] !== '\n') i++; continue; }
      if (str.startsWith('/*', i)) { const e = str.indexOf('*/', i + 2); i = e === -1 ? str.length : e + 2; continue; }
      return;
    }
  };
  const string = () => {
    i++;
    let out = '';
    while (i < str.length) {
      const ch = str[i];
      if (ch === '\\') {
        const n = str[i + 1];
        const map = { n: '\n', t: '\t', r: '', b: '', f: '', '"': '"', '\\': '\\', '/': '/' };
        if (n === 'u' && /^[0-9a-fA-F]{4}$/.test(str.slice(i + 2, i + 6))) { out += String.fromCharCode(parseInt(str.slice(i + 2, i + 6), 16)); i += 6; continue; }
        out += n in map ? map[n] : n || '';
        i += 2;
        continue;
      }
      if (QUOTES.includes(ch)) {
        // A real closing quote is followed by , } ] or : (or the end); otherwise it is a quote inside the text.
        let j = i + 1;
        while (j < str.length && /[ \t\u00a0]/.test(str[j])) j++;
        if (j >= str.length || /[,}\]:\r\n]/.test(str[j])) { i++; return out; }
      }
      out += ch === '\r' ? '' : ch;
      i++;
    }
    cut = true;
    return out;
  };
  const value = () => {
    ws();
    if (i >= str.length) { cut = true; return undefined; }
    const ch = str[i];
    if (ch === '{') {
      i++;
      const obj = {};
      for (;;) {
        ws();
        if (i >= str.length) { cut = true; return obj; }
        if (str[i] === '}') { i++; return obj; }
        if (str[i] === ',') { i++; continue; }
        let key;
        if (QUOTES.includes(str[i])) key = string();
        else { const m = /^[\w$-]+/.exec(str.slice(i)); if (!m) throw new Error('bad'); key = m[0]; i += key.length; }
        ws();
        if (str[i] !== ':') { if (i >= str.length) { cut = true; return obj; } throw new Error('bad'); }
        i++;
        const v = value();
        if (cut) { if (v && typeof v === 'object') obj[key] = v; return obj; }
        obj[key] = v;
      }
    }
    if (ch === '[') {
      i++;
      const arr = [];
      for (;;) {
        ws();
        if (i >= str.length) { cut = true; return arr; }
        if (str[i] === ']') { i++; return arr; }
        if (str[i] === ',') { i++; continue; }
        const v = value();
        if (cut) return arr; // the half-written last item is left out
        arr.push(v);
      }
    }
    if (QUOTES.includes(ch)) return string();
    const m = /^(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(str.slice(i));
    if (!m) throw new Error('bad');
    i += m[0].length;
    return JSON.parse(m[0]);
  };
  try {
    const v = value();
    return { value: v, end: i };
  } catch { return null; }
}

// Keys that make an object look like one question, for every round type.
const QUESTION_KEYS = ['question', 'answer', 'statement', 'items', 'clues', 'category', 'levels', 'options', 'groups', 'pairs', 'captions', 'emoji', 'word'];
const looksLikeQuestion = x => !!x && typeof x === 'object' && !Array.isArray(x) && QUESTION_KEYS.some(k => k in canon(x));
// Lists inside one question (its answers, levels, options ...) are never the list of questions.
const INSIDE_QUESTION = new Set(['answers', 'choices', 'options', 'levels', 'groups', 'pairs', 'items', 'clues', 'captions', 'words', 'accept', 'imagePrompts', 'imageSearches']);

// The first array of question-like objects anywhere in the data ("questions", "vragen", nested, ...).
function findArray(data, key, depth = 0) {
  if (!data || typeof data !== 'object' || depth > 4) return null;
  if (Array.isArray(data)) return data.some(x => x && typeof x === 'object' && !Array.isArray(x)) ? data : null;
  if (Array.isArray(data[key])) return data[key];
  for (const [k, v] of Object.entries(data)) {
    if (key === 'questions' && INSIDE_QUESTION.has(canonKey(k))) continue;
    const found = Array.isArray(v) && key === 'questions' && v.some(looksLikeQuestion)
      ? v : (v && typeof v === 'object' && !Array.isArray(v) ? findArray(v, key, depth + 1) : null);
    if (found) return found;
  }
  return null;
}

// AIs do not always use our key names: "Question", "correct_answer", "vraag", "fun_fact" ... Map them to ours.
const KEY_ALIASES = {
  q: 'question', vraag: 'question', prompt: 'question', text: 'question', questiontext: 'question', frage: 'question', pregunta: 'question',
  antwoord: 'answer', solution: 'answer', reponse: 'answer', antwort: 'answer', respuesta: 'answer',
  antwoorden: 'answers', possibleanswers: 'answers', answeroptions: 'answers', multiplechoice: 'answers',
  correctindex: 'correct', correctoption: 'correct', answerindex: 'correct', rightindex: 'correct', correctanswerindex: 'correct', correctchoice: 'correct',
  correctanswer: 'correctAnswer', rightanswer: 'correctAnswer',
  alternatives: 'accept', alsoaccept: 'accept', acceptable: 'accept', accepted: 'accept', acceptedanswers: 'accept', alternativeanswers: 'accept', variants: 'accept', synonyms: 'accept',
  imageprompt: 'imagePrompt', imagesearch: 'imageSearch', imagesearchterm: 'imageSearch', searchterm: 'imageSearch', imageprompts: 'imagePrompts', imagesearches: 'imageSearches',
  hints: 'clues', emojis: 'emoji', clipstart: 'clipStart', starttime: 'clipStart', start: 'clipStart', maphint: 'mapHint',
  funfact: 'fact', didyouknow: 'fact', trivia: 'fact', extrafact: 'fact', weetje: 'fact', explanation: 'fact',
  roundtype: 'type', categories: 'categories',
};
const canonKey = k => {
  const n = String(k).toLowerCase().replace(/[\s_-]/g, '');
  return KEY_ALIASES[n] || CANON_KEYS[n] || k;
};
const CANON_KEYS = Object.fromEntries(['question', 'answer', 'answers', 'correct', 'accept', 'unit', 'clues', 'category', 'items', 'pairs', 'levels', 'options', 'groups', 'link', 'words',
  'captions', 'emoji', 'song', 'sound', 'clip', 'statement', 'hint', 'fact', 'type', 'title', 'questions', 'rounds', 'word', 'artist', 'choices', 'truth', 'left', 'right'].map(k => [k.toLowerCase(), k]));
function canon(v, depth = 0) {
  if (Array.isArray(v)) return depth > 5 ? v : v.map(x => canon(x, depth + 1));
  if (!v || typeof v !== 'object' || depth > 5) return v;
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    const c = canonKey(k);
    // Our own key wins over an alias ("explanation" next to "fact").
    if (c in out && c !== k) continue;
    out[c] = canon(val, depth + 1);
  }
  if (!('question' in out) && typeof out.statement === 'string') out.question = out.statement;
  return out;
}

function extract(raw, check, key) {
  const str = String(raw || '').replace(/^\ufeff/, '');
  const fences = [...str.matchAll(/```(?:json|JSON)?\s*([\s\S]*?)```/g)].map(m => m[1]);
  for (const part of [...fences, str]) {
    // A bare array of questions is fine too.
    const arr = part.trim().startsWith('[') ? tryParse(`{"${key}": ${part.trim()}}`) : null;
    if (arr && check(arr)) return arr;
    for (const c of candidates(part)) {
      const data = tryParse(c);
      if (data && check(data)) return data;
    }
  }
  // Not clean JSON: read it forgivingly, from the first { or [ on.
  for (const part of [...fences, str]) {
    const loose = [];
    for (let at = part.search(/[{[]/); at !== -1 && at < part.length; ) {
      const got = lenient(part, at);
      if (got && got.value && typeof got.value === 'object') {
        const list = findArray(got.value, key);
        if (list) return { ...(Array.isArray(got.value) ? {} : got.value), [key]: list };
        if (!Array.isArray(got.value)) loose.push(got.value);
      }
      const next = part.slice(got && got.end > at ? got.end : at + 1).search(/[{[]/);
      if (next === -1) break;
      at = (got && got.end > at ? got.end : at + 1) + next;
    }
    // Loose question objects one after the other, without a list around them.
    const items = loose.filter(looksLikeQuestion);
    if (key === 'questions' && items.length) return { questions: items };
  }
  throw new Error('ai.noJson');
}

// The "did you know" line the AI writes next to a question.
const withFact = (it, q) => {
  const fact = rounds.str(it.fact).slice(0, 200);
  return fact ? { ...q, fact } : q;
};

// Questions for one round from AI text, already in Quizbrew's shape. Unusable items are dropped.
function parseRound(text, typeId) {
  const type = rounds.get(typeId);
  if (!type) throw new Error('Unknown round type');
  const data = extract(text, d => Array.isArray(d.questions), 'questions');
  const questions = data.questions.filter(it => it && typeof it === 'object' && !Array.isArray(it)).map(canon).map(it => withFact(it, type.fromAI(it)));
  if (!questions.length) throw new Error('ai.noQuestions');
  return questions;
}

// One question in the AI's shape (or a file's), read into Quizbrew's shape.
function readQuestion(it, typeId) {
  const type = rounds.get(typeId);
  const q = canon(it);
  return withFact(q, type.fromAI(q));
}

function parseQuiz(text) {
  const data = canon(extract(text, d => Array.isArray(d.rounds), 'rounds'));
  const out = { title: rounds.str(data.title) || 'AI quiz', rounds: [] };
  for (const r of data.rounds) {
    if (!r || typeof r !== 'object') continue;
    const id = rounds.typeFrom(r.type) || rounds.typeFrom(r.id) || rounds.typeFrom(r.kind);
    const type = id && rounds.get(id);
    const list = Array.isArray(r.questions) ? r.questions : findArray({ ...r, type: undefined }, 'questions');
    if (!type || !Array.isArray(list)) continue;
    const questions = list.filter(q => q && typeof q === 'object' && !Array.isArray(q)).map(canon).map(q => withFact(q, type.fromAI(q)));
    if (questions.length) out.rounds.push({ type: type.id, title: rounds.str(r.title), scoring: type.defaults.scoring || null, questions });
  }
  if (!out.rounds.length) throw new Error('ai.noQuestions');
  return out;
}

// ---------- calling the AI with a key ----------

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const BUSY = new Set([429, 500, 503, 504, 529]);

class AiError extends Error {
  constructor(key, detail = '') { super(key); this.key = key; this.detail = detail; }
}

async function post(url, headers, body, timeout = 120000) {
  let res;
  let data;
  for (let wait = 2000; ; wait *= 2) {
    try {
      res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
    } catch (err) {
      throw new AiError(err.name === 'TimeoutError' ? 'ai.timeout' : 'ai.offline');
    }
    data = await res.json().catch(() => ({}));
    if (!BUSY.has(res.status) || wait > 4000) break;
    await sleep(wait);
  }
  if (!res.ok) {
    const detail = String((data.error && (data.error.message || data.error)) || '').split('\n')[0].slice(0, 160);
    if (res.status === 401 || (res.status === 400 && /api key/i.test(detail))) throw new AiError('ai.badKey', detail);
    if (res.status === 404) throw new AiError('ai.badModel', detail);
    if (res.status === 402 || /credit|quota|billing|balance/i.test(detail)) throw new AiError('ai.noCredit', detail);
    if (BUSY.has(res.status)) throw new AiError('ai.busy', detail);
    throw new AiError('ai.failed', detail);
  }
  return data;
}

async function claude(prompt, key, model) {
  const base = process.env.CLAUDE_BASE_URL || 'https://api.anthropic.com';
  const data = await post(`${base}/v1/messages`, { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    { model, max_tokens: 16000, messages: [{ role: 'user', content: prompt }] });
  if (data.stop_reason === 'refusal') throw new AiError('ai.refused');
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
}

async function openai(prompt, key, model) {
  const base = process.env.OPENAI_BASE_URL || 'https://api.openai.com';
  const data = await post(`${base}/v1/responses`, { Authorization: `Bearer ${key}` }, { model, input: prompt });
  return (data.output || []).filter(o => o.type === 'message').flatMap(o => o.content || []).filter(c => c.type === 'output_text').map(c => c.text).join('');
}

// Gemini models come and go; with "auto" we ask which models the key may use and take the best flash model.
function geminiRank(id) {
  if (!/^gemini-/.test(id) || /(image|tts|audio|live|embedding|vision|thinking|computer|robotics|learnlm|aqa)/.test(id)) return -1;
  let s = parseFloat((id.match(/^gemini-(\d+(?:\.\d+)?)/) || [])[1] || '0') * 100;
  if (/flash/.test(id)) s += 50;
  if (/lite/.test(id)) s -= 30;
  if (/pro/.test(id)) s -= 20;
  if (/(preview|exp)/.test(id)) s -= 40;
  return s;
}

async function gemini(prompt, key, model, settings) {
  const base = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com';
  const headers = { 'x-goog-api-key': key };
  let use = model && model !== 'auto' ? model : settings.get('geminiAutoModel');
  if (!use) {
    let res;
    try {
      res = await fetch(`${base}/v1beta/models?pageSize=1000`, { headers, signal: AbortSignal.timeout(20000) });
    } catch { throw new AiError('ai.offline'); }
    const data = await res.json().catch(() => ({}));
    if (res.status === 400 || res.status === 401 || res.status === 403) throw new AiError('ai.badKey', data.error && data.error.message);
    const best = (data.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => m.name.replace(/^models\//, '')).filter(id => geminiRank(id) >= 0).sort((a, b) => geminiRank(b) - geminiRank(a))[0];
    if (!best) throw new AiError('ai.badModel');
    use = best;
    settings.set('geminiAutoModel', use);
  }
  const body = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' } };
  try {
    const data = await post(`${base}/v1beta/models/${encodeURIComponent(use)}:generateContent`, headers, body);
    return (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  } catch (err) {
    // The remembered model disappeared: forget it so the next try picks a new one.
    if (err.key === 'ai.badModel' && (!model || model === 'auto')) settings.set('geminiAutoModel', '');
    throw err;
  }
}

// A picture from a prompt, made by Gemini's image model with the Gemini key (whatever AI writes the questions).
const IMAGE_MODELS = ['gemini-2.5-flash-image', 'gemini-3-pro-image-preview'];
async function geminiImage(prompt, key) {
  const base = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com';
  const body = {
    contents: [{ role: 'user', parts: [{ text: `${String(prompt).slice(0, 1200)}\n\nA clear photo-like picture for a pub quiz, 4:3, no text, letters or watermarks in the image.` }] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '4:3' } },
  };
  let last;
  for (const model of (process.env.GEMINI_IMAGE_MODEL ? [process.env.GEMINI_IMAGE_MODEL] : IMAGE_MODELS)) {
    try {
      const data = await post(`${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`, { 'x-goog-api-key': key }, body);
      const part = (data.candidates?.[0]?.content?.parts || []).find(p => p.inlineData && /^image\//.test(p.inlineData.mimeType || ''));
      if (!part) throw new AiError(data.candidates?.[0]?.finishReason === 'SAFETY' || data.promptFeedback?.blockReason ? 'ai.refused' : 'ai.empty');
      return { type: part.inlineData.mimeType, buffer: Buffer.from(part.inlineData.data, 'base64') };
    } catch (err) {
      last = err;
      if (err.key !== 'ai.badModel') throw err;
    }
  }
  throw last;
}

function create(settings) {
  const active = () => {
    const id = PROVIDERS[settings.get('aiProvider')] ? settings.get('aiProvider') : 'gemini';
    const p = PROVIDERS[id];
    return { id, ...p, apiKey: settings.get(p.key) || '', modelId: settings.get(p.model) || p.defaultModel };
  };

  // What the builder may see: never the whole key.
  function publicSettings() {
    const providers = {};
    for (const [id, p] of Object.entries(PROVIDERS)) {
      const k = settings.get(p.key) || '';
      providers[id] = { name: p.name, hasKey: !!k, keyHint: k ? `…${k.slice(-4)}` : '', model: settings.get(p.model) || p.defaultModel };
    }
    const a = active();
    return { provider: a.id, hasKey: !!a.apiKey, canDraw: !!settings.get(PROVIDERS.gemini.key), providers };
  }

  function update({ provider, key, model } = {}) {
    if (provider && PROVIDERS[provider]) settings.set('aiProvider', provider);
    const p = PROVIDERS[settings.get('aiProvider')] || PROVIDERS.gemini;
    if (typeof key === 'string') settings.set(p.key, key.trim().slice(0, 300));
    if (typeof model === 'string') settings.set(p.model, model.trim().slice(0, 80) || p.defaultModel);
    return publicSettings();
  }

  async function ask(prompt) {
    const a = active();
    if (!a.apiKey) throw new AiError('ai.noKey');
    const text = a.id === 'gemini' ? await gemini(prompt, a.apiKey, a.modelId, settings)
      : a.id === 'claude' ? await claude(prompt, a.apiKey, a.modelId)
        : await openai(prompt, a.apiKey, a.modelId);
    if (!text) throw new AiError('ai.empty');
    return text;
  }

  return {
    publicSettings,
    update,
    generateRound: async opts => parseRound(await ask(roundPrompt(opts)), opts.type),
    generateQuiz: async opts => parseQuiz(await ask(quizPrompt(opts))),
    makeImage: async prompt => {
      const key = settings.get(PROVIDERS.gemini.key);
      if (!key) throw new AiError('ai.noImageKey');
      if (!String(prompt || '').trim()) throw new AiError('ai.empty');
      return geminiImage(prompt, key);
    },
  };
}

module.exports = { readQuestion, canon, create, roundPrompt, quizPrompt, parseRound, parseQuiz, extract, PROVIDERS, AUDIENCES, TYPE_HELP, AiError };
