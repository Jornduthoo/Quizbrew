// The quiz library on this laptop: data/library/ with folders, and pictures in data/media/.
// Paths are relative ("Pub nights/October.json") and never leave the library folder.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SEGMENT = /^[^\\/:*?"<>|\x00-\x1f]{1,80}$/;
const MEDIA_TYPES = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/wav': 'wav', 'video/mp4': 'mp4', 'video/webm': 'webm' };
const ALIASES = { 'audio/x-m4a': 'm4a', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/mp3': 'mp3', 'audio/webm': 'webm' };
const MAX_MEDIA = 40 * 1024 * 1024; // short video clips fit

function create(dataDir = path.join(__dirname, '..', 'data')) {
  const root = path.join(dataDir, 'library');
  const mediaDir = path.join(dataDir, 'media');

  // A safe absolute path inside the library, or an error.
  function resolve(rel, { file = false } = {}) {
    const parts = String(rel || '').split('/').filter(Boolean);
    if (parts.some(p => p === '.' || p === '..' || !SEGMENT.test(p) || p.startsWith('.'))) throw new Error('Invalid path');
    if (file && (!parts.length || !parts[parts.length - 1].endsWith('.json'))) throw new Error('Invalid quiz path');
    return path.join(root, ...parts);
  }

  function summary(quiz) {
    const rounds = Array.isArray(quiz.rounds) ? quiz.rounds : [];
    return {
      title: quiz.title || '',
      rounds: rounds.length,
      questions: rounds.reduce((n, r) => n + (Array.isArray(r.questions) ? r.questions.length : 0), 0),
      types: [...new Set(rounds.map(r => r.type))],
    };
  }

  function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  // The folder tree: [{ name, path, folders: [...], quizzes: [{ name, path, title, rounds, questions, modified }] }]
  function tree(rel = '') {
    const dir = resolve(rel);
    fs.mkdirSync(dir, { recursive: true });
    const node = { name: rel ? path.basename(dir) : '', path: rel, folders: [], quizzes: [] };
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.')) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) node.folders.push(tree(childRel));
      else if (entry.name.endsWith('.json')) {
        try {
          const file = path.join(dir, entry.name);
          node.quizzes.push({ name: entry.name, path: childRel, modified: fs.statSync(file).mtimeMs, ...summary(readJson(file)) });
        } catch { /* a broken file is skipped */ }
      }
    }
    return node;
  }

  function read(rel) {
    return readJson(resolve(rel, { file: true }));
  }

  // A file name from the title: "Pub night: October!" -> "Pub night October.json", unique in the folder.
  function freeName(folder, title) {
    const dir = resolve(folder);
    const base = String(title || 'Quiz').replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Quiz';
    let name = `${base}.json`;
    for (let i = 2; fs.existsSync(path.join(dir, name)); i++) name = `${base} (${i}).json`;
    return folder ? `${folder}/${name}` : name;
  }

  // Save a quiz (also a half-finished one). Pictures sent as data: URLs are stored in data/media.
  function save(rel, quiz, { folder = '' } = {}) {
    if (!quiz || typeof quiz !== 'object' || !Array.isArray(quiz.rounds)) throw new Error('Not a quiz');
    const target = rel || freeName(folder, quiz.title);
    const file = resolve(target, { file: true });
    const clean = storeInlineMedia(quiz);
    clean.modified = new Date().toISOString();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(clean, null, 2));
    return { path: target, quiz: clean };
  }

  function remove(rel) {
    const p = resolve(rel);
    if (!rel) throw new Error('Invalid path');
    fs.rmSync(p, { recursive: true, force: true });
  }

  function mkdir(rel) {
    if (!rel) throw new Error('Invalid path');
    fs.mkdirSync(resolve(rel), { recursive: true });
  }

  // Move or rename a quiz or folder. to is the new full path.
  function move(from, to) {
    const src = resolve(from);
    const dst = resolve(to);
    if (!from || !to || !fs.existsSync(src)) throw new Error('Not found');
    if (fs.existsSync(dst)) throw new Error('Already exists');
    if (dst.startsWith(src + path.sep)) throw new Error('Invalid path');
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.renameSync(src, dst);
  }

  // Store an uploaded file; same content gives the same name. Returns "/media/<hash>.<ext>".
  function addMedia(buffer, mime) {
    const ext = MEDIA_TYPES[mime] || ALIASES[mime];
    if (!ext) throw new Error('Unsupported file type');
    if (!buffer || !buffer.length || buffer.length > MAX_MEDIA) throw new Error('File too large');
    const name = `${crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 20)}.${ext}`;
    fs.mkdirSync(mediaDir, { recursive: true });
    const file = path.join(mediaDir, name);
    if (!fs.existsSync(file)) fs.writeFileSync(file, buffer);
    return `/media/${name}`;
  }

  function mediaFile(name) {
    if (!/^[a-f0-9]{20}\.(webp|jpg|png|gif|mp3|ogg|m4a|wav|mp4|webm)$/.test(name)) return null;
    const file = path.join(mediaDir, name);
    return fs.existsSync(file) ? file : null;
  }

  const MEDIA_FIELDS = ['image', 'audio', 'video'];

  // data: URLs in a quiz become files in data/media (import of an exported quiz, pasted pictures).
  function storeInlineMedia(quiz) {
    const copy = JSON.parse(JSON.stringify(quiz));
    for (const r of copy.rounds || []) {
      for (const q of r.questions || []) {
        for (const f of MEDIA_FIELDS) {
          const m = typeof q[f] === 'string' && q[f].match(/^data:([\w/+.-]+);base64,(.+)$/);
          if (m) q[f] = addMedia(Buffer.from(m[2], 'base64'), m[1]);
        }
      }
    }
    return copy;
  }

  // The other way round, for an export that works on another laptop: every picture inside the file.
  function inlineMedia(quiz) {
    const copy = JSON.parse(JSON.stringify(quiz));
    const mimeOf = Object.fromEntries(Object.entries(MEDIA_TYPES).map(([m, e]) => [e, m]));
    for (const r of copy.rounds || []) {
      for (const q of r.questions || []) {
        for (const f of MEDIA_FIELDS) {
          const m = typeof q[f] === 'string' && q[f].match(/^\/media\/([\w.]+)$/);
          const file = m && mediaFile(m[1]);
          if (file) q[f] = `data:${mimeOf[path.extname(file).slice(1)]};base64,${fs.readFileSync(file).toString('base64')}`;
        }
      }
    }
    return copy;
  }

  return { root, tree, read, save, remove, mkdir, move, addMedia, mediaFile, inlineMedia, storeInlineMedia, freeName, MEDIA_TYPES };
}

module.exports = { create, MEDIA_TYPES };
