// Demo or Pro. Quizbrew runs offline, so a code is a small signed note: who it is for, Pro or tester, and maybe
// an end date. Only Jorn's private key can sign one (tools/make-code.js); the app only holds the public key below,
// so nobody can make codes by reading this file.
const crypto = require('crypto');
const rounds = require('./rounds');

const PUBLIC_KEY = crypto.createPublicKey({ key: Buffer.from('MCowBQYDK2VwAyEAgOz2KClWzc+Fya1u5inlMZhHvjG6Ge6QMvFnMrt0zyE=', 'base64'), format: 'der', type: 'spki' });
const CONTEXT = Buffer.from('quizbrew-license-v1:');
const VERSION = 1;
const KINDS = { 1: 'pro', 2: 'tester' };
const DAY0 = Date.UTC(2026, 0, 1);
const DAY = 86400000;
const PRICE = '€49';
const SHOP = 'https://quizbrew.app';

// What the free demo can do. Everything else is shown, with a lock.
const FREE = {
  teams: 4,
  looks: ['pub'],
  types: ['classic', 'trueFalse', 'open', 'closest', 'picture', 'emoji', 'music', 'speed', 'buzzer', 'lastStanding', 'drawGuess', 'crowdMind', 'scramble', 'jackpot', 'clockBank'],
  twists: ['double'],
  scorings: ['points', 'speed'],
  aiQuestions: 10,
  aiRounds: 2,
  aiPerRound: 5,
  quizzes: 3,
};
// The Pro extras outside the round types, for the locks on the host screen and the Pro dialog.
const FEATURES = ['teams', 'types', 'looks', 'venue', 'autopilot', 'print', 'audience', 'raffle', 'cloud', 'aiImage', 'ai', 'quizzes'];

// Crockford base32: no I, L, O or U, so a code read aloud or typed over is hard to get wrong.
const ABC = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function toBase32(buf) {
  let bits = 0, value = 0, out = '';
  for (const b of buf) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += ABC[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits) out += ABC[(value << (5 - bits)) & 31];
  return out;
}
function fromBase32(text) {
  let bits = 0, value = 0;
  const out = [];
  for (const ch of text) {
    const v = ABC.indexOf(ch);
    if (v < 0) return null;
    value = ((value << 5) | v) & 0xffff; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
// Spaces, dashes, lower case and look-alike letters are all fine.
const tidy = code => String(code || '').toUpperCase().replace(/^\s*QB[-\s]*/, '').replace(/O/g, '0').replace(/[IL]/g, '1').replace(/[^0-9A-Z]/g, '');

function payload({ name, kind = 'pro', until = null, id = crypto.randomBytes(4) }) {
  const nameBytes = Buffer.from(String(name || '').trim().slice(0, 40));
  const day = until ? Math.max(1, Math.ceil((until - DAY0) / DAY)) : 0;
  const head = Buffer.from([VERSION, kind === 'tester' ? 2 : 1, day >> 8, day & 255]);
  return Buffer.concat([head, Buffer.from(id), nameBytes]);
}

// Make a code (tools/make-code.js, with the private key).
function sign(privateKey, info) {
  const data = payload(info);
  const sig = crypto.sign(null, Buffer.concat([CONTEXT, data]), privateKey);
  const body = toBase32(Buffer.concat([Buffer.from([data.length]), data, sig]));
  return 'QB-' + body.match(/.{1,5}/g).join('-');
}

// Read a code: null when it is not a real Quizbrew code.
function decode(code, publicKey = PUBLIC_KEY) {
  const raw = fromBase32(tidy(code));
  if (!raw || raw.length < 1 + 8 + 64) return null;
  const len = raw[0];
  if (raw.length < 1 + len + 64 || len < 8) return null;
  const data = raw.subarray(1, 1 + len);
  const sig = raw.subarray(1 + len, 1 + len + 64);
  let ok = false;
  try { ok = crypto.verify(null, Buffer.concat([CONTEXT, data]), publicKey, sig); } catch { ok = false; }
  if (!ok || data[0] !== VERSION || !KINDS[data[1]]) return null;
  const day = (data[2] << 8) | data[3];
  return { kind: KINDS[data[1]], until: day ? DAY0 + day * DAY : null, id: data.subarray(4, 8).toString('hex'), name: data.subarray(8).toString('utf8') };
}

// A quiz the demo plays: only the free round types, twists and scorings. The examples play in full, as a taste of Pro.
function trim(quiz) {
  const skipped = [];
  const kept = [];
  for (const r of quiz.rounds || []) {
    if (!FREE.types.includes(r.type)) { skipped.push(r.type); continue; }
    const type = rounds.get(r.type);
    const scoring = r.scoring && !FREE.scorings.includes(r.scoring) ? (type && type.defaults.scoring && FREE.scorings.includes(type.defaults.scoring) ? type.defaults.scoring : 'points') : r.scoring;
    kept.push({ ...r, scoring, twists: (r.twists || []).filter(tw => FREE.twists.includes(tw)) });
  }
  return { quiz: { ...quiz, rounds: kept }, skipped };
}

function create(settings, { now = () => Date.now(), publicKey = PUBLIC_KEY } = {}) {
  const current = () => {
    const code = settings.get('license');
    const info = code ? decode(code, publicKey) : null;
    if (!info) return null;
    return { ...info, expired: !!(info.until && now() > info.until) };
  };
  const pro = () => { const c = current(); return !!c && !c.expired; };
  const view = () => {
    const c = current();
    return {
      pro: !!c && !c.expired, name: c ? c.name : '', kind: c ? c.kind : null, until: c ? c.until : null, expired: !!(c && c.expired),
      free: FREE, features: FEATURES, price: PRICE, shop: SHOP,
    };
  };
  return {
    pro, view,
    activate(code) {
      const info = decode(code, publicKey);
      if (!info) throw new Error('pro.badCode');
      if (info.until && now() > info.until) throw new Error('pro.expiredCode');
      settings.set('license', tidy(code));
      return view();
    },
    remove() { settings.set('license', null); return view(); },
  };
}

module.exports = { FREE, FEATURES, PRICE, SHOP, sign, decode, trim, create, tidy };
