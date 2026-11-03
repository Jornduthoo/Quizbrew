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
const LANGUAGE_NAMES = { en: 'English', nl: 'Dutch (Flemish, as spoken in Belgium)', fr: 'French' };
const AUDIENCES = { mixed: 'a mixed adult pub crowd', kids: 'children aged 8 to 12', experts: 'experienced quiz fans', company: 'colleagues at a company party', family: 'a family party with all ages' };
const DIFFICULTY = ['', 'very easy', 'easy', 'medium', 'hard', 'very hard'];

const RULES = [
  'Facts must be correct, current and unambiguous: one clear right answer.',
  'Keep questions short enough to read on a TV in a few seconds (max 120 characters).',
  'Never mention or copy existing TV quiz shows, game shows, quiz brands or board games.',
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
    '- Round types with pictures get an "imagePrompt" per question; the quizmaster makes the pictures later.',
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

function extract(raw, check) {
  const str = String(raw || '').replace(/^﻿/, '');
  const fences = [...str.matchAll(/```(?:json|JSON)?\s*([\s\S]*?)```/g)].map(m => m[1]);
  for (const part of [...fences, str]) {
    // A bare array of questions is fine too.
    const arr = part.trim().startsWith('[') ? tryParse(`{"questions": ${part.trim()}}`) : null;
    if (arr && check(arr)) return arr;
    for (const c of candidates(part)) {
      const data = tryParse(c);
      if (data && check(data)) return data;
    }
  }
  throw new Error('ai.noJson');
}

// Questions for one round from AI text, already in Quizbrew's shape. Unusable items are dropped.
function parseRound(text, typeId) {
  const type = rounds.get(typeId);
  if (!type) throw new Error('Unknown round type');
  const data = extract(text, d => Array.isArray(d.questions));
  const questions = data.questions.filter(it => it && typeof it === 'object').map(it => type.fromAI(it));
  if (!questions.length) throw new Error('ai.noQuestions');
  return questions;
}

function parseQuiz(text) {
  const data = extract(text, d => Array.isArray(d.rounds));
  const out = { title: rounds.str(data.title) || 'AI quiz', rounds: [] };
  for (const r of data.rounds) {
    const type = r && rounds.get(r.type);
    if (!type || !Array.isArray(r.questions)) continue;
    out.rounds.push({ type: type.id, title: rounds.str(r.title), scoring: type.defaults.scoring, questions: r.questions.filter(q => q && typeof q === 'object').map(q => type.fromAI(q)) });
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
    return { provider: a.id, hasKey: !!a.apiKey, providers };
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
  };
}

module.exports = { create, roundPrompt, quizPrompt, parseRound, parseQuiz, extract, PROVIDERS, AUDIENCES, TYPE_HELP, AiError };
