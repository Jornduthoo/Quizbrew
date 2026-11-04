// Free pictures for picture questions: search Wikimedia Commons and Openverse (both free to use, also in a paid quiz night), and fetch a picture from a link
// (dragged or pasted from any website) so the builder can make it small and keep it in the library.
const net = require('net');

const COMMONS = 'https://commons.wikimedia.org/w/api.php';
const OPENVERSE = 'https://api.openverse.org/v1/images/';
const AGENT = 'Quizbrew/1.0 (quiz builder; https://github.com/Jornduthoo/Quizbrew)';
const MAX_BYTES = 15 * 1024 * 1024;
const IMAGE_TYPES = /^image\/(jpeg|png|webp|gif|bmp|avif)$/;
// A search may never keep the quizmaster waiting long: each source gets a few seconds, then we show what we have.
const SOURCE_TIMEOUT = 6000;
const GRACE = 1500; // once one source has answered, the other gets this much longer
const CACHE_MAX = 200;
const CACHE_TIME = 30 * 60 * 1000;

const plain = html => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

// Pictures for a search: a small one for the grid, a bigger one to use, and who made it under which licence.
async function commons(q, fetch, timeout = SOURCE_TIMEOUT) {
  const params = new URLSearchParams({
    action: 'query', format: 'json', origin: '*', generator: 'search', gsrnamespace: '6', gsrlimit: '24',
    gsrsearch: `${q} filetype:bitmap`, prop: 'imageinfo', iiprop: 'url|mime|extmetadata', iiurlwidth: '1280',
    iiextmetadatafilter: 'Artist|LicenseShortName|ObjectName',
  });
  let res;
  try { res = await fetch(`${COMMONS}?${params}`, { headers: { 'User-Agent': AGENT, 'Api-User-Agent': AGENT }, signal: AbortSignal.timeout(timeout) }); } catch { throw new Error('pictures.offline'); }
  if (!res.ok) throw new Error('pictures.offline');
  const data = await res.json();
  const pages = Object.values((data.query && data.query.pages) || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
  const out = [];
  for (const p of pages) {
    const info = p.imageinfo && p.imageinfo[0];
    if (!info || !IMAGE_TYPES.test(info.mime || '') || !info.thumburl) continue;
    const meta = info.extmetadata || {};
    const author = plain(meta.Artist && meta.Artist.value).slice(0, 80);
    const license = plain(meta.LicenseShortName && meta.LicenseShortName.value).slice(0, 40);
    out.push({
      title: plain((meta.ObjectName && meta.ObjectName.value) || String(p.title || '').replace(/^File:/, '').replace(/\.\w+$/, '')).slice(0, 80),
      thumb: info.thumburl.replace(/\/1280px-/, '/330px-'), // Wikimedia only serves standard thumbnail widths (330 is one, 320 is not)
      backup: info.thumburl, // if the small one fails, the 1280 one (never the full-size original)
      url: info.thumburl,
      page: info.descriptionurl || '',
      credit: [author, license, 'Wikimedia Commons'].filter(Boolean).join(' · '),
    });
  }
  return out;
}

const LICENSES = { cc0: 'CC0', pdm: 'Public domain' };
const licenseName = (code, version) => LICENSES[code] || `CC ${String(code || '').toUpperCase()}${version ? ' ' + version : ''}`.trim();

// Openverse: openly licensed pictures from Flickr, museums and more; only licences that allow use at a paid event.
async function openverse(q, fetch, timeout = SOURCE_TIMEOUT) {
  const params = new URLSearchParams({ q, page_size: '20', license_type: 'commercial', mature: 'false' });
  let res;
  try { res = await fetch(`${OPENVERSE}?${params}`, { headers: { 'User-Agent': AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(timeout) }); } catch { throw new Error('pictures.offline'); }
  if (!res.ok) throw new Error('pictures.offline');
  const data = await res.json();
  return (data.results || []).filter(r => r.url && r.thumbnail && !/svg/i.test(r.filetype || '')).map(r => ({
    title: plain(r.title).slice(0, 80),
    thumb: r.thumbnail,
    url: r.url,
    page: r.foreign_landing_url || '',
    credit: [plain(r.creator).slice(0, 80), licenseName(r.license, r.license_version), `Openverse${r.source ? ` (${r.source})` : ''}`].filter(Boolean).join(' · '),
  }));
}

// Ever broader searches: the whole term first, then fewer words, so a very precise term still finds something.
function broader(query) {
  const words = String(query || '').replace(/[^\p{L}\p{N}' -]+/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 8);
  const out = [];
  for (let n = words.length; n >= 1; n--) out.push(words.slice(0, n).join(' '));
  if (words.length > 1) out.push(words[words.length - 1]);
  return [...new Set(out)];
}

// Mix lists one by one (a, b, a, b, ...) without doubles.
function mix(found, seen, lists) {
  for (let i = 0; i < Math.max(0, ...lists.map(l => l.length)); i++) {
    for (const list of lists) {
      const r = list[i];
      if (r && !seen.has(r.url)) { seen.add(r.url); found.push(r); }
    }
  }
}

// Both sources at once; as soon as one has pictures, the slow one gets a short grace and is then left out.
function settleBoth(jobs, grace = GRACE) {
  const out = jobs.map(() => ({ status: 'pending' }));
  return new Promise(resolve => {
    let left = jobs.length;
    let timer = null;
    const finish = () => { clearTimeout(timer); resolve(out.map(r => (r.status === 'pending' ? { status: 'rejected', reason: new Error('pictures.slow') } : r))); };
    jobs.forEach((job, i) => job.then(value => { out[i] = { status: 'fulfilled', value }; }, reason => { out[i] = { status: 'rejected', reason }; }).then(() => {
      left -= 1;
      if (!left) return finish();
      if (!timer && out[i].status === 'fulfilled' && out[i].value.length) timer = setTimeout(finish, grace);
    }));
  });
}

// Search both sources at the same time, mixed. If the exact words give too little, all broader terms go out at once
// (not one after the other), so a search takes at most two short waits. Gives the pictures and the words that found them.
async function search(query, { fetch = globalThis.fetch, enough = 8, timeout = SOURCE_TIMEOUT, grace = GRACE } = {}) {
  const terms = broader(String(query || '').slice(0, 120));
  if (!terms.length) return { results: [], term: '' };
  const found = [];
  const seen = new Set();
  const ask = q => [commons(q, fetch, timeout), openverse(q, fetch, timeout)];
  const first = await settleBoth(ask(terms[0]), grace);
  if (!first.some(r => r.status === 'fulfilled')) throw new Error('pictures.offline');
  mix(found, seen, first.map(r => r.value || []));
  let term = terms[0];
  if (found.length < enough && terms.length > 1) {
    const more = terms.slice(1, 4);
    const lists = await Promise.all(more.map(q => settleBoth(ask(q), grace)));
    more.forEach((q, i) => {
      const before = found.length;
      mix(found, seen, lists[i].map(r => r.value || []));
      if (before === 0 && found.length > 0) term = q;
    });
  }
  return { results: found.slice(0, 30), term };
}

// The same words again (a suggestion strip, then the search window, or the builder opened again) answer at once.
// A search still under way is shared, not asked twice.
function cached(searchFn = search) {
  const memo = new Map();
  return (query, opts = {}) => {
    const key = String(query || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const hit = memo.get(key);
    if (hit && Date.now() - hit.at < CACHE_TIME) return hit.job;
    const job = searchFn(query, opts);
    memo.set(key, { at: Date.now(), job });
    job.then(r => { if (!r.results.length) memo.delete(key); }, () => memo.delete(key));
    while (memo.size > CACHE_MAX) memo.delete(memo.keys().next().value);
    return job;
  };
}

// Only pictures on the internet: no links to this laptop or the local network.
function publicUrl(raw) {
  let u;
  try { u = new URL(String(raw || '')); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.localhost')) return null;
  if (net.isIP(host)) {
    if (/^(0|10|127)\./.test(host) || /^169\.254\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)) return null;
    if (host.includes(':') && (host === '::1' || host === '::' || /^f[cd]/.test(host) || /^fe80/.test(host) || host.startsWith('::ffff:'))) return null;
  }
  return u;
}

// The picture behind a link, as bytes and a type.
async function get(raw, { fetch = globalThis.fetch } = {}) {
  const u = publicUrl(raw);
  if (!u) throw new Error('pictures.badLink');
  let res;
  try { res = await fetch(u, { headers: { 'User-Agent': AGENT, Accept: 'image/*' }, redirect: 'follow', signal: AbortSignal.timeout(20000) }); } catch { throw new Error('pictures.noPicture'); }
  if (!res.ok || (res.url && !publicUrl(res.url))) throw new Error('pictures.noPicture');
  const type = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!IMAGE_TYPES.test(type)) throw new Error('pictures.noPicture');
  if (Number(res.headers.get('content-length')) > MAX_BYTES) throw new Error('pictures.tooBig');
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new Error('pictures.tooBig');
    chunks.push(Buffer.from(chunk));
  }
  return { type, buffer: Buffer.concat(chunks) };
}

module.exports = { search, cached, get, publicUrl, broader };
