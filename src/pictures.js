// Free pictures for picture questions: search Wikimedia Commons, and fetch a picture from a link
// (dragged or pasted from any website) so the builder can make it small and keep it in the library.
const net = require('net');

const COMMONS = 'https://commons.wikimedia.org/w/api.php';
const AGENT = 'Quizbrew/1.0 (quiz builder; https://github.com/Jornduthoo/Quizbrew)';
const MAX_BYTES = 15 * 1024 * 1024;
const IMAGE_TYPES = /^image\/(jpeg|png|webp|gif|bmp|avif)$/;

const plain = html => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

// Up to 24 pictures for a search: a small one for the grid, a bigger one to use, and who made it under which licence.
async function search(query, { fetch = globalThis.fetch } = {}) {
  const q = String(query || '').trim().slice(0, 120);
  if (!q) return [];
  const params = new URLSearchParams({
    action: 'query', format: 'json', origin: '*', generator: 'search', gsrnamespace: '6', gsrlimit: '24',
    gsrsearch: `${q} filetype:bitmap`, prop: 'imageinfo', iiprop: 'url|mime|extmetadata', iiurlwidth: '1280',
    iiextmetadatafilter: 'Artist|LicenseShortName|ObjectName',
  });
  let res;
  try { res = await fetch(`${COMMONS}?${params}`, { headers: { 'User-Agent': AGENT, 'Api-User-Agent': AGENT }, signal: AbortSignal.timeout(12000) }); } catch { throw new Error('pictures.offline'); }
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
      thumb: info.thumburl.replace(/\/1280px-/, '/320px-'),
      url: info.thumburl,
      page: info.descriptionurl || '',
      credit: [author, license, 'Wikimedia Commons'].filter(Boolean).join(' · '),
    });
  }
  return out;
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

module.exports = { search, get, publicUrl };
