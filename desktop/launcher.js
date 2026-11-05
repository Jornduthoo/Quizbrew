// The installed Windows app (Quizbrew.exe, from the installer or the Microsoft Store) starts here.
// Quizbrew.exe is Node itself with a tiny start script (desktop/sea-main.js) that loads this file from app\.
// It keeps the quizzes and settings in %LOCALAPPDATA%\Quizbrew, finds a free port, opens the quizmaster
// screen in the browser and runs without a window of its own (Quizbrew.exe is a Windows app, not a console app):
// the quizmaster stops it with "Quit Quizbrew" in the settings. What it would have printed goes to quizbrew.log.
// A second start while Quizbrew already runs only opens the browser again.
const os = require('os');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { spawn, execFile } = require('child_process');
const Store = require('./store');

// Port 3000 is often taken (LANcelot, dev servers), so the installed app starts at 3001.
// The Store package opens exactly these ports in the firewall (desktop/msix/AppxManifest.xml).
const FIRST_PORT = 3001;
const LAST_PORT = 3010;

function dataDir(env = process.env) {
  if (env.QUIZBREW_DATA) return env.QUIZBREW_DATA;
  return path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Quizbrew');
}

// Does a Quizbrew answer on this port? Then we open that one instead of starting a second one.
function isQuizbrew(port, timeout = 800) {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port, path: '/host', timeout }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { if (body.length < 4000) body += c; });
      res.on('end', () => resolve(res.statusCode === 200 && /<title>Quizbrew\b/.test(body)));
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

// Listen on the first free port. Resolves with the port, or null when every port is taken.
function listenFree(server, ports) {
  return new Promise(resolve => {
    const tryAt = i => {
      if (i >= ports.length) return resolve(null);
      const onError = err => {
        server.removeListener('listening', onListening);
        if (err.code === 'EADDRINUSE' || err.code === 'EACCES') tryAt(i + 1);
        else { console.error(err); resolve(null); }
      };
      const onListening = () => { server.removeListener('error', onError); resolve(server.address().port); };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(ports[i]);
    };
    tryAt(0);
  });
}

function openBrowser(url) {
  if (process.platform === 'win32') spawn('explorer.exe', [url], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}

function fill(text, values) {
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m));
}

// The language of the console text: the one the quizmaster picked in Quizbrew, else the one of Windows.
function language(settings, i18n) {
  const picked = settings.get('language');
  if (i18n.isSupported(picked)) return picked;
  let sys = '';
  try { sys = Intl.DateTimeFormat().resolvedOptions().locale.slice(0, 2).toLowerCase(); } catch { /* no Intl */ }
  return i18n.isSupported(sys) ? sys : i18n.DEFAULT;
}

// A short message in a Windows dialog box (there is no console window to print it in).
function messageBox(text) {
  if (process.platform !== 'win32') return Promise.resolve();
  const ps = `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show($env:QB_MSG, 'Quizbrew') | Out-Null`;
  return new Promise(resolve => execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps],
    { windowsHide: true, env: { ...process.env, QB_MSG: text } }, () => resolve()));
}

async function start({ env = process.env, open = true, log = console.log, ports, onQuit = null, alert = null } = {}) {
  env.QUIZBREW_DATA = dataDir(env);
  process.env.QUIZBREW_DATA = env.QUIZBREW_DATA;
  const appDir = path.join(__dirname, '..');
  const { createServer } = require(path.join(appDir, 'src', 'app'));
  const Settings = require(path.join(appDir, 'src', 'settings'));
  const i18n = require(path.join(appDir, 'src', 'i18n'));
  const { lanAddresses } = require(path.join(appDir, 'src', 'network'));

  const settings = Settings.create(env.QUIZBREW_DATA);
  // The Microsoft Store version: bought in the Store = Pro (desktop/store.js). store-config.json holds the Store ID.
  let license = null;
  if (env.QUIZBREW_STORE === '1' || Store.packaged()) {
    let config = {};
    try { config = JSON.parse(fs.readFileSync(path.join(__dirname, 'store-config.json'), 'utf8')); } catch { /* no Store ID yet */ }
    const store = Store.create({ dataDir: env.QUIZBREW_DATA, storeId: config.storeId || '' });
    store.start();
    license = require(path.join(appDir, 'src', 'license')).create(settings, { store });
  }
  const t = i18n.dictionary(language(settings, i18n));
  if (!ports) {
    const fixed = Number(env.PORT);
    ports = fixed ? [fixed] : Array.from({ length: LAST_PORT - FIRST_PORT + 1 }, (_, i) => FIRST_PORT + i);
  }

  for (const p of ports) {
    if (await isQuizbrew(p)) {
      log(`\n  ${t['desktop.already']}\n`);
      if (open) openBrowser(`http://localhost:${p}/host`);
      return { already: true, port: p };
    }
  }

  let qb = null;
  const quit = onQuit && (() => onQuit(qb));
  qb = createServer({ port: ports[0], settings, ...(license ? { license } : {}), ...(quit ? { onQuit: quit } : {}) });
  const port = await listenFree(qb.server, ports);
  if (!port) {
    const msg = fill(t['desktop.noPort'], { from: ports[0], to: ports[ports.length - 1] });
    log(`\n  ${msg}\n`);
    await qb.close().catch(() => {});
    if (alert) await alert(msg);
    return { failed: true };
  }

  const lan = lanAddresses()[0];
  log(`\n  ${t['desktop.running']}\n`);
  log(`  ${t['desktop.host']}:  http://localhost:${port}/host`);
  log(`  ${t['desktop.screen']}:  http://localhost:${port}/screen`);
  log(lan ? `  ${t['desktop.players']}:  http://${lan}:${port}/play` : `  ${t['desktop.noNetwork']}`);
  log(`\n  ${t['desktop.keepOpen']}\n`);
  if (open) openBrowser(`http://localhost:${port}/host`);
  return { port, close: () => qb.close() };
}

// Everything Quizbrew prints also goes to quizbrew.log in the data folder (there is no window to show it).
function logTo(file) {
  let out = null;
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); out = fs.openSync(file, 'w'); } catch { /* no log then */ }
  return (...args) => {
    const line = args.map(a => (a instanceof Error ? a.stack : String(a))).join(' ');
    try { console.log(line); } catch { /* no console */ }
    if (out !== null) try { fs.writeSync(out, line + '\n'); } catch { /* disk full */ }
  };
}

function main() {
  process.title = 'Quizbrew';
  const log = logTo(path.join(dataDir(), 'quizbrew.log'));
  process.on('uncaughtException', err => log('Unexpected error:', err));
  process.on('unhandledRejection', err => log('Unexpected error:', err));
  // QUIZBREW_NO_BROWSER=1 starts without opening the browser (the Windows build test uses it).
  const onQuit = qb => { log('Quit from the quizmaster screen.'); qb.close().catch(() => {}).finally(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
  return start({ open: !process.env.QUIZBREW_NO_BROWSER, log, onQuit, alert: messageBox }).then(r => {
    // A second start only opened the browser: stop this one again after a moment.
    if (r.already || r.failed) setTimeout(() => process.exit(r.failed ? 1 : 0), 1500);
  });
}

module.exports = { start, main, dataDir, isQuizbrew, listenFree, logTo, FIRST_PORT, LAST_PORT };

if (require.main === module) main();
