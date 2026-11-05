// Managing quizzes: duplicate, rename (title and file), a copy of an example to edit.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Library = require('../src/library');
const { createServer } = require('../src/app');

const quiz = title => ({ title, rounds: [{ type: 'classic', title: 'R1', questions: [{ question: 'Q?', answers: ['a', 'b'], correct: 0 }] }] });

test('duplicate and rename keep the folder and never overwrite', () => {
  const lib = Library.create(fs.mkdtempSync(path.join(os.tmpdir(), 'qb-manage-')));
  lib.mkdir('Pub');
  const a = lib.save(null, quiz('Friday'), { folder: 'Pub' });
  const b = lib.duplicate(lib.read(a.path), { folder: 'Pub', title: 'Friday (copy)' });
  assert.equal(b.path, 'Pub/Friday (copy).json');
  assert.equal(lib.duplicate(lib.read(a.path), { folder: 'Pub', title: 'Friday (copy)' }).path, 'Pub/Friday (copy) (2).json');

  const r = lib.retitle(a.path, 'Saturday: special');
  assert.equal(r.path, 'Pub/Saturday special.json');
  assert.equal(lib.read(r.path).title, 'Saturday: special');
  assert.ok(!fs.existsSync(path.join(lib.root, 'Pub', 'Friday.json')));
  // A title that is already taken by another file gets its own name.
  assert.equal(lib.retitle(r.path, 'Friday (copy)').path, 'Pub/Friday (copy) (3).json');
  assert.throws(() => lib.retitle(b.path, '  '), /Invalid title/);
});

test('the host page manages quizzes over the API', async t => {
  const library = Library.create(fs.mkdtempSync(path.join(os.tmpdir(), 'qb-manage-')));
  const v = {};
  const qb = createServer({ port: 0, license: require('./fixtures/pro').proLicense(), settings: { get: k => v[k], set: (k, x) => { v[k] = x; } }, library, lanAddresses: () => ['192.168.1.50'] });
  const port = await qb.listen();
  t.after(() => qb.close());
  const post = (url, body) => fetch(`http://127.0.0.1:${port}/api/host${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());

  const saved = library.save(null, quiz('Quiz night'));
  const copy = await post('/library/duplicate', { path: saved.path, copyWord: 'kopie' });
  assert.equal(copy.path, 'Quiz night (kopie).json');
  const renamed = await post('/library/retitle', { path: copy.path, title: 'Tweede avond' });
  assert.equal(renamed.path, 'Tweede avond.json');
  const sample = await post('/library/duplicate', { sample: 'pub-warm-up.json' });
  assert.match(sample.path, /\.json$/);
  assert.ok(library.read(sample.path).rounds.length > 0);
  assert.deepEqual(library.tree().quizzes.map(q => q.path).sort(), ['Quiz night.json', 'Tweede avond.json', sample.path].sort());
});

test('examples can be removed, stay removed after a restart, and come back from Settings', async t => {
  const library = Library.create(fs.mkdtempSync(path.join(os.tmpdir(), 'qb-manage-')));
  const v = { language: 'nl' };
  const settings = { get: k => v[k], set: (k, x) => { v[k] = x; } };
  const start = async () => { const qb = createServer({ port: 0, license: require('./fixtures/pro').proLicense(), settings, library, lanAddresses: () => ['192.168.1.50'] }); const port = await qb.listen(); t.after(() => qb.close()); return port; };
  let port = await start();
  const api = (p, url, body) => fetch(`http://127.0.0.1:${p}/api/host${url}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}).then(r => r.json());
  const files = async p => (await api(p, '/library')).samples.map(s => s.file);

  assert.ok((await files(port)).includes('night-pack-1.nl.json'));
  assert.equal((await api(port, '/library/hide-sample', { sample: 'night-pack-1.nl.json' })).hidden, 1);
  await api(port, '/library/hide-sample', { sample: 'pub-warm-up.json' });
  assert.deepEqual(v.hiddenSamples, ['night-pack-1', 'pub-warm-up']);
  // All language versions of a pack go away, also after a restart.
  port = await start();
  assert.ok(!(await files(port)).some(f => /^night-pack-1|pub-warm-up/.test(f)));
  v.language = 'fr';
  assert.ok(!(await files(port)).some(f => f.startsWith('night-pack-1')));
  assert.ok((await files(port)).includes('round-tour.json'));
  await api(port, '/library/restore-samples', {});
  assert.ok((await files(port)).includes('night-pack-1.fr.json'));
  assert.ok((await files(port)).includes('pub-warm-up.json'));
});
