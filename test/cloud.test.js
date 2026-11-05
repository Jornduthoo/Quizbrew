// My quiz folder: two computers keep their library the same through one folder in OneDrive or Google Drive.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Library = require('../src/library');
const Cloud = require('../src/cloud');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qb-cloud-'));
const memorySettings = () => { const v = {}; return { get: k => v[k], set: (k, x) => { v[k] = x; } }; };
const quiz = (title, extra = {}) => ({ title, rounds: [{ type: 'classic', title: 'R1', questions: [{ question: 'Q?', answers: ['a', 'b', 'c', 'd'], correct: 0 }] }], ...extra });

// One computer: its own data folder, library and sync.
function computer(folder) {
  const dataDir = tmp();
  const library = Library.create(dataDir);
  const cloud = Cloud.create({ dataDir, settings: memorySettings() });
  if (folder) cloud.choose(folder);
  return { dataDir, library, cloud, titles: () => listTitles(library.tree()) };
}
const listTitles = node => [...node.quizzes.map(q => q.title), ...node.folders.flatMap(listTitles)].sort();
const age = (file, seconds) => { const t = new Date(Date.now() - seconds * 1000); fs.utimesSync(file, t, t); };

test('a quiz made at home turns up on the quiz laptop, folders and media included', async () => {
  const shared = tmp();
  const home = computer(shared);
  const laptop = computer(shared);

  home.library.mkdir('Pub nights');
  const media = home.library.addMedia(Buffer.from('RIFFxxxxWEBPVP8 fake'), 'image/webp');
  home.library.save(null, quiz('Friday quiz', { rounds: [{ type: 'classic', title: 'R1', questions: [{ question: 'Q?', image: media, answers: ['a', 'b'], correct: 1 }] }] }), { folder: 'Pub nights' });
  home.library.mkdir('Empty for now');

  await home.cloud.sync();
  assert.equal(home.cloud.view().error, '');
  assert.ok(fs.existsSync(path.join(shared, 'library', 'Pub nights')));
  assert.ok(fs.readdirSync(path.join(shared, 'media')).length === 1);

  assert.equal(await laptop.cloud.sync(), true, 'something arrived');
  assert.deepEqual(laptop.titles(), ['Friday quiz']);
  assert.ok(fs.existsSync(path.join(laptop.dataDir, 'library', 'Empty for now')));
  const name = path.basename(media);
  assert.ok(fs.existsSync(path.join(laptop.dataDir, 'media', name)), 'the picture came along');
  assert.equal(laptop.cloud.view().pulled, 2);

  // Nothing changed: nothing moves.
  assert.equal(await laptop.cloud.sync(), false);
  assert.equal(laptop.cloud.view().pulled + laptop.cloud.view().pushed, 0);
});

test('edits and deletions travel, a deleted quiz waits in the trash', async () => {
  const shared = tmp();
  const home = computer(shared);
  const laptop = computer(shared);
  const saved = home.library.save(null, quiz('Old title'));
  await home.cloud.sync();
  await laptop.cloud.sync();

  laptop.library.save(saved.path, quiz('New title'));
  await laptop.cloud.sync();
  await home.cloud.sync();
  assert.deepEqual(home.titles(), ['New title']);

  home.library.remove(saved.path);
  await home.cloud.sync();
  await laptop.cloud.sync();
  assert.deepEqual(laptop.titles(), []);
  const trashed = fs.readdirSync(path.join(shared, '_trash'));
  assert.equal(trashed.length, 1);
  assert.match(trashed[0], /\.json$/);
});

test('changed on both sides: the newest wins and the other one goes to the trash', async () => {
  const shared = tmp();
  const home = computer(shared);
  const laptop = computer(shared);
  const saved = home.library.save(null, quiz('Start'));
  await home.cloud.sync();
  await laptop.cloud.sync();

  laptop.library.save(saved.path, quiz('Laptop version'));
  age(path.join(laptop.dataDir, 'library', saved.path), 120);
  home.library.save(saved.path, quiz('Home version'));
  await home.cloud.sync();
  await laptop.cloud.sync();
  assert.deepEqual(laptop.titles(), ['Home version']);
  const bin = fs.readdirSync(path.join(laptop.dataDir, 'cloud-trash'));
  assert.equal(bin.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(laptop.dataDir, 'cloud-trash', bin[0]), 'utf8')).title, 'Laptop version');
});

test('a broken file in the folder is left alone, a missing library folder deletes nothing', async () => {
  const shared = tmp();
  const laptop = computer(shared);
  laptop.library.save(null, quiz('Keep me'));
  await laptop.cloud.sync();

  fs.writeFileSync(path.join(shared, 'library', 'half.json'), '{"title": "half wr');
  await laptop.cloud.sync();
  assert.deepEqual(laptop.titles(), ['Keep me']);

  fs.rmSync(path.join(shared, 'library'), { recursive: true });
  await laptop.cloud.sync();
  assert.equal(laptop.cloud.view().error, 'cloud.missing');
  assert.deepEqual(laptop.titles(), ['Keep me']);
});

test('choosing a folder: absolute paths only, never inside Quizbrew, empty unlinks', async () => {
  const pc = computer();
  assert.throws(() => pc.cloud.choose('relative/path'), /cloud\.absolute/);
  assert.throws(() => pc.cloud.choose(path.join(pc.dataDir, 'sub')), /cloud\.inside/);
  assert.throws(() => pc.cloud.choose(path.join(__dirname, '..', 'public')), /cloud\.inside/);
  const dir = path.join(tmp(), 'Quizbrew');
  pc.cloud.choose(`"${dir}"`);
  assert.equal(pc.cloud.folder(), dir);
  assert.ok(fs.existsSync(dir), 'made for you');
  pc.cloud.choose('');
  assert.equal(pc.cloud.folder(), '');
  assert.equal(await pc.cloud.sync(), false);

  fs.rmSync(dir, { recursive: true });
  pc.cloud.choose(dir);
  fs.rmSync(dir, { recursive: true });
  await pc.cloud.sync();
  assert.equal(pc.cloud.view().error, 'cloud.notFound');
  assert.ok(Array.isArray(pc.cloud.suggestions()));
});

test('the builder links a folder over the API and syncs right away', async t => {
  const { createServer } = require('../src/app');
  const library = Library.create(tmp());
  library.save(null, quiz('Over the API'));
  const qb = createServer({ port: 0, license: require('./fixtures/pro').proLicense(), settings: memorySettings(), library, lanAddresses: () => ['192.168.1.50'] });
  const port = await qb.listen();
  t.after(() => qb.close());
  const call = (method, url, body) => fetch(`http://127.0.0.1:${port}/api/host${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) }).then(async r => ({ status: r.status, ...(await r.json()) }));

  const before = await call('GET', '/cloud');
  assert.equal(before.folder, '');
  assert.ok(Array.isArray(before.suggestions));
  assert.equal((await call('POST', '/cloud/choose', { folder: 'not/absolute' })).error, 'cloud.absolute');

  const shared = path.join(tmp(), 'Quizbrew');
  const linked = await call('POST', '/cloud/choose', { folder: shared });
  assert.equal(linked.folder, shared);
  assert.equal(linked.pushed, 1);
  assert.equal(fs.readdirSync(path.join(shared, 'library')).length, 1);
  assert.equal((await call('POST', '/cloud/sync')).error, '');
});
