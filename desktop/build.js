// Builds the Windows app folder: dist/windows/Quizbrew/Quizbrew.exe + app\ (the code, lang, quizzes, node_modules).
// The installer (desktop/installer.iss) and the Store package (desktop/msix/build-msix.ps1) both pack this folder.
//
//   npm install --no-save resedit@2.0.3 postject@1.0.0-alpha.6
//   node desktop/build.js
//
// Quizbrew.exe is the official Node for Windows (same version as the Node that runs this script, checked against
// nodejs.org's SHA256 list) with the Quizbrew icon, name and version, and desktop/sea-main.js built in.
// The GitHub workflow .github/workflows/windows.yml runs this on Windows and makes the installer and the MSIX.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(DIST, 'windows', 'Quizbrew');
const APP = path.join(OUT, 'app');
const CACHE = path.join(DIST, 'cache');
const SHIP = ['server.js', 'package.json', 'package-lock.json', 'src', 'public', 'lang', 'quizzes', 'desktop/launcher.js'];
const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

// "0.1.0" -> [0, 1, 0, 0]. Windows and the Store want four numbers.
function winVersion(version = pkg.version) {
  const parts = String(version).split(/[.-]/).slice(0, 3).map(n => parseInt(n, 10) || 0);
  while (parts.length < 3) parts.push(0);
  return [...parts, 0];
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function nodeExe(version = process.version) {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, `node-${version}-win-x64.exe`);
  const base = `https://nodejs.org/dist/${version}`;
  const sums = (await download(`${base}/SHASUMS256.txt`)).toString('utf8');
  const line = sums.split('\n').find(l => l.trim().endsWith(' win-x64/node.exe'));
  if (!line) throw new Error(`No win-x64/node.exe in ${base}/SHASUMS256.txt`);
  const want = line.trim().split(/\s+/)[0];
  const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
  if (fs.existsSync(file) && sha(fs.readFileSync(file)) === want) return fs.readFileSync(file);
  const buf = await download(`${base}/win-x64/node.exe`);
  if (sha(buf) !== want) throw new Error('node.exe does not match the SHA256 from nodejs.org');
  fs.writeFileSync(file, buf);
  return buf;
}

function copyApp() {
  fs.rmSync(OUT, { recursive: true, force: true });
  for (const item of SHIP) {
    const src = path.join(ROOT, item);
    fs.cpSync(src, path.join(APP, item), { recursive: true });
  }
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execFileSync(npm, ['ci', '--omit=dev', '--no-audit', '--no-fund', '--ignore-scripts'], { cwd: APP, stdio: 'inherit', shell: process.platform === 'win32' });
  fs.rmSync(path.join(APP, 'package-lock.json'), { force: true });
}

// Icon, name and version in the exe (what Windows shows in Explorer, the taskbar and Task Manager).
async function brand(exe) {
  const ResEdit = await import('resedit');
  const lib = ResEdit.default || ResEdit;
  const pe = lib.NtExecutable.from(exe, { ignoreCert: true });
  const res = lib.NtExecutableResource.from(pe);
  const ico = lib.Data.IconFile.from(fs.readFileSync(path.join(__dirname, 'assets', 'icon.ico')));
  const groups = lib.Resource.IconGroupEntry.fromEntries(res.entries);
  const group = groups[0] || { id: 1, lang: 1033 };
  lib.Resource.IconGroupEntry.replaceIconsForResource(res.entries, group.id, group.lang, ico.icons.map(i => i.data));
  const [vi] = lib.Resource.VersionInfo.fromEntries(res.entries);
  const v = winVersion();
  const lang = { lang: 1033, codepage: 1200 };
  for (const l of vi.getAllLanguagesForStringValues()) {
    for (const key of ['FileDescription', 'ProductName', 'CompanyName', 'InternalName', 'OriginalFilename', 'LegalCopyright', 'FileVersion', 'ProductVersion']) vi.removeStringValue(l, key);
  }
  vi.setStringValues(lang, {
    FileDescription: 'Quizbrew',
    ProductName: 'Quizbrew',
    CompanyName: 'Quizbrew',
    InternalName: 'Quizbrew',
    OriginalFilename: 'Quizbrew.exe',
    LegalCopyright: `Quizbrew. Includes Node.js (MIT licence).`,
    FileVersion: v.join('.'),
    ProductVersion: v.join('.'),
  });
  vi.setFileVersion(...v, 1033);
  vi.setProductVersion(...v, 1033);
  vi.outputToResourceEntries(res.entries);
  res.outputResource(pe);
  return Buffer.from(pe.generate());
}

async function seaBlob() {
  const work = path.join(DIST, 'sea');
  fs.mkdirSync(work, { recursive: true });
  const config = path.join(work, 'sea-config.json');
  const blob = path.join(work, 'sea-prep.blob');
  fs.writeFileSync(config, JSON.stringify({ main: path.join(__dirname, 'sea-main.js'), output: blob, disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false }));
  execFileSync(process.execPath, ['--experimental-sea-config', config], { stdio: 'inherit' });
  return fs.readFileSync(blob);
}

async function build() {
  console.log(`Quizbrew ${pkg.version} for Windows, Node ${process.version}`);
  copyApp();
  // First the start script (postject), then icon and version (resedit keeps the script's resource).
  const target = path.join(OUT, 'Quizbrew.exe');
  fs.writeFileSync(target, await nodeExe());
  const { inject } = require('postject');
  await inject(target, 'NODE_SEA_BLOB', await seaBlob(), { sentinelFuse: FUSE, overwrite: true });
  fs.writeFileSync(target, await brand(fs.readFileSync(target)));
  fs.copyFileSync(path.join(__dirname, 'assets', 'icon.ico'), path.join(OUT, 'Quizbrew.ico'));
  fs.writeFileSync(path.join(DIST, 'version.txt'), winVersion().join('.'));
  console.log(`Done: ${OUT}`);
}

module.exports = { winVersion, SHIP };

if (require.main === module) build().catch(err => { console.error(err); process.exit(1); });
