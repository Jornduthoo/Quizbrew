// Free pictures: Wikimedia Commons search and pictures behind a dragged or pasted link (the internet is faked here).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Pictures = require('../src/pictures');
const rounds = require('../src/rounds');

const commonsAnswer = {
  query: { pages: {
    2: { index: 2, title: 'File:Lighthouse at night.jpg', imageinfo: [{ mime: 'image/jpeg', thumburl: 'https://upload.wikimedia.org/thumb/a/ab/Light.jpg/1280px-Light.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Light.jpg', extmetadata: { Artist: { value: '<a href="//x">Jane &amp; Co</a>' }, LicenseShortName: { value: 'CC BY-SA 4.0' } } }] },
    1: { index: 1, title: 'File:Eiffel.png', imageinfo: [{ mime: 'image/png', thumburl: 'https://upload.wikimedia.org/thumb/e/ef/Eiffel.png/1280px-Eiffel.png', extmetadata: { ObjectName: { value: 'Eiffel Tower' }, LicenseShortName: { value: 'Public domain' } } }] },
    3: { index: 3, title: 'File:Drawing.svg', imageinfo: [{ mime: 'image/svg+xml', thumburl: 'https://upload.wikimedia.org/x.png' }] },
  } },
};
const fakeFetch = routes => async (url, opts = {}) => {
  const u = String(url);
  for (const [match, make] of routes) if (u.includes(match)) return make(u, opts);
  throw new Error('offline');
};
const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const picture = (bytes, type = 'image/png') => new Response(bytes, { headers: { 'content-type': type } });

test('a Commons search gives pictures in order, with maker and licence, and leaves drawings out', async () => {
  let asked = '';
  const { results, term } = await Pictures.search(' lighthouse ', { fetch: fakeFetch([['commons.wikimedia.org', u => { asked = u; return json(commonsAnswer); }]]) });
  assert.equal(term, 'lighthouse');
  assert.match(asked, /gsrsearch=lighthouse\+filetype%3Abitmap/);
  assert.deepEqual(results.map(r => r.title), ['Eiffel Tower', 'Lighthouse at night']);
  assert.equal(results[1].credit, 'Jane & Co · CC BY-SA 4.0 · Wikimedia Commons');
  assert.equal(results[0].credit, 'Public domain · Wikimedia Commons');
  assert.match(results[0].thumb, /\/330px-Eiffel\.png$/);
  assert.match(results[0].url, /\/1280px-Eiffel\.png$/);
  assert.deepEqual((await Pictures.search('   ')).results, []);
  await assert.rejects(Pictures.search('x', { fetch: fakeFetch([]) }), /pictures\.offline/);
});

const openverseAnswer = { results: [
  { title: 'Lion resting', url: 'https://live.staticflickr.com/1/lion.jpg', thumbnail: 'https://api.openverse.org/v1/images/a/thumb/', creator: 'Sam', license: 'by', license_version: '2.0', source: 'flickr', filetype: 'jpg' },
  { title: 'Lion vector', url: 'https://x.org/lion.svg', thumbnail: 'https://api.openverse.org/v1/images/b/thumb/', license: 'cc0', filetype: 'svg' },
  { title: 'Old lion print', url: 'https://museum.org/lion.png', thumbnail: 'https://api.openverse.org/v1/images/c/thumb/', license: 'pdm', source: 'smithsonian' },
] };

test('Openverse joins in, with licences fit for a paid quiz night, mixed with Commons', async () => {
  let asked = '';
  const { results } = await Pictures.search('lion', { fetch: fakeFetch([['commons.wikimedia.org', () => json(commonsAnswer)], ['api.openverse.org', u => { asked = u; return json(openverseAnswer); }]]) });
  assert.match(asked, /license_type=commercial/);
  assert.deepEqual(results.map(r => r.title), ['Eiffel Tower', 'Lion resting', 'Lighthouse at night', 'Old lion print']);
  assert.equal(results[1].credit, 'Sam · CC BY 2.0 · Openverse (flickr)');
  assert.equal(results[3].credit, 'Public domain · Openverse (smithsonian)');
  // One source down: the other still gives pictures.
  const half = await Pictures.search('lion', { fetch: fakeFetch([['api.openverse.org', () => json(openverseAnswer)]]) });
  assert.equal(half.results.length, 2);
});

test('a too precise search is tried again with fewer words', async () => {
  assert.deepEqual(Pictures.broader('Eiffel Tower at night, Paris!'), ['Eiffel Tower at night Paris', 'Eiffel Tower at night', 'Eiffel Tower at', 'Eiffel Tower', 'Eiffel', 'Paris']);
  const asked = [];
  const net = fakeFetch([
    ['commons.wikimedia.org', u => { const q = new URL(u).searchParams.get('gsrsearch'); asked.push(q); return json(q.startsWith('Eiffel Tower filetype') ? commonsAnswer : { query: {} }); }],
    ['api.openverse.org', () => json({ results: [] })],
  ]);
  const { results, term } = await Pictures.search('Eiffel Tower at dusk', { fetch: net, enough: 1 });
  assert.equal(term, 'Eiffel Tower');
  assert.equal(results.length, 2);
  assert.deepEqual(asked, ['Eiffel Tower at dusk filetype:bitmap', 'Eiffel Tower at filetype:bitmap', 'Eiffel Tower filetype:bitmap']);
});

test('only pictures on the internet can be fetched', async () => {
  for (const bad of ['', 'file:///etc/passwd', 'ftp://x.org/a.png', 'http://localhost:3001/x.png', 'http://127.0.0.1/a.png', 'http://192.168.1.10/a.png', 'http://10.0.0.2/a', 'http://[::1]/a', 'http://user:pw@example.org/a.png', 'http://printer.local/a.png']) {
    assert.equal(Pictures.publicUrl(bad), null, bad);
  }
  assert.ok(Pictures.publicUrl('https://upload.wikimedia.org/a.jpg'));

  const net = fakeFetch([
    ['good.example/pic', () => picture(Buffer.from('PNGDATA'))],
    ['good.example/page', () => new Response('<html>', { headers: { 'content-type': 'text/html' } })],
    ['good.example/huge', () => new Response('x', { headers: { 'content-type': 'image/jpeg', 'content-length': String(20 * 1024 * 1024) } })],
  ]);
  const got = await Pictures.get('https://good.example/pic.png', { fetch: net });
  assert.equal(got.type, 'image/png');
  assert.equal(got.buffer.toString(), 'PNGDATA');
  await assert.rejects(Pictures.get('https://good.example/page', { fetch: net }), /pictures\.noPicture/);
  await assert.rejects(Pictures.get('https://good.example/huge.jpg', { fetch: net }), /pictures\.tooBig/);
  await assert.rejects(Pictures.get('http://127.0.0.1/x.png', { fetch: net }), /pictures\.badLink/);
});

test('the builder searches and fetches pictures through the laptop', async t => {
  const { createServer } = require('../src/app');
  const library = require('../src/library').create(fs.mkdtempSync(path.join(os.tmpdir(), 'qb-pic-')));
  const settings = (() => { const v = {}; return { get: k => v[k], set: (k, x) => { v[k] = x; } }; })();
  const webFetch = fakeFetch([['commons.wikimedia.org', () => json(commonsAnswer)], ['good.example', () => picture(Buffer.from('JPEGDATA'), 'image/jpeg')]]);
  const qb = createServer({ port: 0, settings, library, lanAddresses: () => ['192.168.1.50'], webFetch });
  const port = await qb.listen();
  t.after(() => qb.close());
  const base = `http://127.0.0.1:${port}/api/host`;

  const found = await (await fetch(`${base}/pictures?q=eiffel`)).json();
  assert.equal(found.results.length, 2);
  const res = await fetch(`${base}/pictures/get?url=${encodeURIComponent('https://good.example/a.jpg')}`);
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  assert.equal(await res.text(), 'JPEGDATA');
  const bad = await fetch(`${base}/pictures/get?url=${encodeURIComponent('http://localhost/a.jpg')}`);
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, 'pictures.badLink');
});

test('the AI gives a search term for picture questions', () => {
  const picture = rounds.get('picture');
  assert.match(picture.aiShape, /imageSearch/);
  assert.equal(picture.fromAI({ question: 'Q', answer: 'Big Ben', imageSearch: ' Big Ben London ' }).imageSearch, 'Big Ben London');
  assert.match(rounds.get('silhouette').aiShape, /imageSearch/);
});

test('the image AI makes a picture from a prompt with the Gemini key, trying the next model when one is gone', async t => {
  const Ai = require('../src/ai');
  const v = {};
  const settings = { get: k => v[k], set: (k, x) => { v[k] = x; } };
  const ai = Ai.create(settings);
  await assert.rejects(ai.makeImage('a lighthouse'), e => e.key === 'ai.noImageKey');
  assert.equal(ai.publicSettings().canDraw, false);
  v.geminiKey = 'test-key';
  v.aiProvider = 'claude';
  assert.equal(ai.publicSettings().canDraw, true);

  const real = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url, opts) => {
    asked.push(String(url));
    assert.equal(opts.headers['x-goog-api-key'], 'test-key');
    if (String(url).includes('gemini-2.5-flash-image')) return new Response(JSON.stringify({ error: { message: 'gone' } }), { status: 404 });
    assert.match(JSON.parse(opts.body).contents[0].parts[0].text, /a lighthouse/);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'here' }, { inlineData: { mimeType: 'image/png', data: Buffer.from('PNG!').toString('base64') } }] } }] }));
  };
  t.after(() => { globalThis.fetch = real; });
  const pic = await ai.makeImage('a lighthouse');
  assert.equal(pic.type, 'image/png');
  assert.equal(pic.buffer.toString(), 'PNG!');
  assert.equal(asked.length, 2);
});
