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
  const qb = createServer({ port: 0, settings: { get: k => v[k], set: (k, x) => { v[k] = x; } }, library, lanAddresses: () => ['192.168.1.50'] });
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
