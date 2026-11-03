// My quiz folder: keep the library the same as a folder in OneDrive or Google Drive (the same idea as LANcelot's lesson folder).
// Build a quiz at home in your own Quizbrew, the quiz laptop picks it up at start (and every minute after), and the other way round.
// Quizzes keep their folders; pictures, sounds and clips go along in media/. Nothing is ever thrown away straight off:
// what is deleted or loses a clash goes to a _trash folder for 30 days.
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TRASH = '_trash';
const KEEP_DAYS = 30;
const SEGMENT_OK = name => !name.startsWith('.') && !name.startsWith('_');
const MEDIA_RE = /^[a-f0-9]{20}\.(webp|jpg|png|gif|mp3|ogg|m4a|wav|mp4|webm)$/;
const hash = text => crypto.createHash('sha1').update(text).digest('hex');

// A quiz file is valid when it is JSON with a list of rounds.
function validQuiz(text) {
  try { const q = JSON.parse(text); return !!q && Array.isArray(q.rounds); } catch { return false; }
}

// Every quiz file (relative path with /) and every folder below dir.
async function walk(dir, rel = '', out = { files: {}, folders: new Set() }) {
  let entries = [];
  try { entries = await fsp.readdir(path.join(dir, rel), { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (!SEGMENT_OK(e.name)) continue;
    const child = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { out.folders.add(child); await walk(dir, child, out); }
    else if (e.name.endsWith('.json')) {
      try {
        const file = path.join(dir, child);
        const text = await fsp.readFile(file, 'utf8');
        out.files[child] = { text, hash: hash(text), mtime: (await fsp.stat(file)).mtimeMs };
      } catch { /* skipped this round */ }
    }
  }
  return out;
}

async function write(dir, rel, text) {
  const file = path.join(dir, ...rel.split('/'));
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file + '.tmp', text);
  await fsp.rename(file + '.tmp', file);
}

// Into the _trash folder next to it (same folder structure, with a time stamp), and clean up what is older than 30 days.
async function trash(dir, bin, rel) {
  try {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const dst = path.join(bin, ...rel.replace(/\.json$/, `-${stamp}.json`).split('/'));
    await fsp.mkdir(path.dirname(dst), { recursive: true });
    await fsp.rename(path.join(dir, ...rel.split('/')), dst);
    const clean = async d => {
      for (const e of await fsp.readdir(d, { withFileTypes: true }).catch(() => [])) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) await clean(p);
        else if (Date.now() - (await fsp.stat(p)).mtimeMs > KEEP_DAYS * 864e5) await fsp.unlink(p).catch(() => {});
      }
    };
    await clean(bin);
  } catch { /* a file that is gone already */ }
}

function create({ dataDir, settings, appDir = path.join(__dirname, '..') }) {
  const libDir = path.join(dataDir, 'library');
  const mediaDir = path.join(dataDir, 'media');
  const localBin = path.join(dataDir, 'cloud-trash');
  const stateFile = path.join(dataDir, 'cloud-sync.json');
  let busy = null;
  let status = { at: 0, pulled: 0, pushed: 0, removed: 0, error: '' };

  const folder = () => settings.get('cloudFolder') || '';

  function readState(root) {
    try {
      const s = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (s.root === root && s.files) return { ...s, folders: s.folders || [] };
    } catch { /* first time */ }
    // A new quiz folder: merge everything, delete nothing.
    return { root, files: {}, folders: [] };
  }

  async function syncLibrary(root, state, count) {
    const remote = path.join(root, 'library');
    const remoteBin = path.join(root, TRASH);
    // The library folder in the cloud is gone (not downloaded yet, moved by mistake)? Then delete nothing and try again later.
    if (Object.keys(state.files).length && !(await fsp.stat(remote).catch(() => null))) throw new Error('cloud.missing');
    const L = await walk(libDir);
    const R = await walk(remote);
    const seen = state.files;
    const next = {};
    let changedHere = false;

    for (const rel of new Set([...Object.keys(L.files), ...Object.keys(R.files), ...Object.keys(seen)])) {
      const l = L.files[rel], r = R.files[rel], s = seen[rel];
      if ((l && l.hash) === (r && r.hash)) { if (l) next[rel] = l.hash; continue; }
      const lChanged = (l ? l.hash : undefined) !== s;
      const rChanged = (r ? r.hash : undefined) !== s;
      const pull = async keep => {
        if (!validQuiz(r.text)) return;
        if (l && keep) await trash(libDir, localBin, rel);
        await write(libDir, rel, r.text);
        next[rel] = r.hash;
        changedHere = true;
        count.pulled++;
      };
      const push = async keep => {
        if (r && keep) await trash(remote, remoteBin, rel);
        await write(remote, rel, l.text);
        next[rel] = l.hash;
        count.pushed++;
      };
      if (lChanged && !rChanged) {
        if (l) await push();
        else { await trash(remote, remoteBin, rel); count.removed++; }
      } else if (rChanged && !lChanged) {
        if (r) await pull();
        else { await trash(libDir, localBin, rel); changedHere = true; count.removed++; }
      } else if (l && r) {
        // Changed on both sides: the newest wins, the other version goes to the trash.
        if (r.mtime > l.mtime) await pull(true); else await push(true);
      } else if (l) await push();
      else if (r) await pull();
    }

    // Folders: a new one appears on both sides; a removed one goes on the other side too, but only when it is empty there.
    const known = new Set(state.folders);
    const Lf = (await walk(libDir)).folders;
    const Rf = (await walk(remote)).folders;
    const isEmpty = async dir => (await fsp.readdir(dir).catch(() => ['x'])).length === 0;
    for (const f of new Set([...Lf, ...Rf])) {
      if (Lf.has(f) && Rf.has(f)) continue;
      const gone = known.has(f);
      if (Lf.has(f)) {
        if (gone && await isEmpty(path.join(libDir, ...f.split('/')))) { await fsp.rmdir(path.join(libDir, ...f.split('/'))).catch(() => {}); changedHere = true; }
        else await fsp.mkdir(path.join(remote, ...f.split('/')), { recursive: true });
      } else if (gone && await isEmpty(path.join(remote, ...f.split('/')))) await fsp.rmdir(path.join(remote, ...f.split('/'))).catch(() => {});
      else { await fsp.mkdir(path.join(libDir, ...f.split('/')), { recursive: true }); changedHere = true; }
    }
    state.files = next;
    state.folders = [...(await walk(libDir)).folders];
    return changedHere;
  }

  // Pictures, sounds and clips have a name made from their content: copy what is missing, both ways, never delete.
  async function syncMedia(root, count) {
    const remote = path.join(root, 'media');
    await fsp.mkdir(remote, { recursive: true });
    await fsp.mkdir(mediaDir, { recursive: true });
    const L = new Set((await fsp.readdir(mediaDir)).filter(n => MEDIA_RE.test(n)));
    const R = new Set((await fsp.readdir(remote)).filter(n => MEDIA_RE.test(n)));
    const copy = async (from, to, name) => {
      await fsp.copyFile(path.join(from, name), path.join(to, name + '.tmp'));
      await fsp.rename(path.join(to, name + '.tmp'), path.join(to, name));
    };
    for (const n of L) if (!R.has(n)) { await copy(mediaDir, remote, n); count.pushed++; }
    for (const n of R) if (!L.has(n)) { await copy(remote, mediaDir, n); count.pulled++; }
  }

  // Sync everything. Resolves to true when something arrived here (so the lists can be refreshed).
  function sync() {
    if (busy) return busy;
    const root = folder();
    if (!root) return Promise.resolve(false);
    busy = (async () => {
      const count = { pulled: 0, pushed: 0, removed: 0 };
      let changed = false;
      try {
        const stat = await fsp.stat(root).catch(() => null);
        if (!stat || !stat.isDirectory()) throw new Error('cloud.notFound');
        const state = readState(root);
        await syncMedia(root, count);
        changed = await syncLibrary(root, state, count);
        fs.writeFileSync(stateFile, JSON.stringify(state) + '\n');
        status = { at: Date.now(), ...count, error: '' };
      } catch (err) {
        status = { ...status, error: /^cloud\./.test(err.message) ? err.message : 'cloud.failed', detail: err.message };
      }
      return changed;
    })().finally(() => { busy = null; });
    return busy;
  }

  // Where OneDrive and Google Drive live on this computer, to pick with one click.
  function suggestions() {
    const out = [];
    const add = (kind, base) => {
      if (!base) return;
      const p = path.join(base, 'Quizbrew');
      if (out.some(s => s.path === p)) return;
      try { if (fs.statSync(base).isDirectory()) out.push({ kind, path: p }); } catch { /* not here */ }
    };
    add('onedriveWork', process.env.OneDriveCommercial);
    add('onedrive', process.env.OneDriveConsumer);
    add('onedrive', process.env.OneDrive);
    if (process.platform === 'win32') for (const letter of 'GHIJKLMNOPQRSTUVWXYZ') for (const sub of ['Mijn Drive', 'My Drive', 'Mon Drive']) add('gdrive', `${letter}:\\${sub}`);
    for (const sub of ['Mijn Drive', 'My Drive', 'Mon Drive']) add('gdrive', path.join(os.homedir(), 'Google Drive', sub));
    add('onedrive', path.join(os.homedir(), 'OneDrive'));
    return out;
  }

  function choose(dir) {
    const clean = String(dir || '').trim().replace(/^"|"$/g, '');
    if (!clean) { settings.set('cloudFolder', ''); status = { at: 0, pulled: 0, pushed: 0, removed: 0, error: '' }; return; }
    if (!path.isAbsolute(clean)) throw new Error('cloud.absolute');
    const resolved = path.resolve(clean);
    const inside = d => resolved === path.resolve(d) || resolved.startsWith(path.resolve(d) + path.sep);
    // Never Quizbrew's own folders.
    if (inside(appDir) || inside(dataDir)) throw new Error('cloud.inside');
    fs.mkdirSync(resolved, { recursive: true });
    settings.set('cloudFolder', resolved);
    status = { at: 0, pulled: 0, pushed: 0, removed: 0, error: '' };
  }

  const view = () => ({ folder: folder(), ...status });

  return { sync, suggestions, choose, view, folder };
}

module.exports = { create };
