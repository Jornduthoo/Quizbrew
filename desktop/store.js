// The Microsoft Store version: Quizbrew is a paid app with an unlimited free trial. The trial is the demo;
// a bought copy is Pro. Windows knows which one this is (desktop/store-license.ps1 asks it). The answer is kept
// in store.json in the data folder, so Quizbrew stays Pro when Windows can't answer for a moment.
// After a purchase the Store answers "bought" within a minute, so a demo keeps asking every minute.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const SCRIPT = path.join(__dirname, 'store-license.ps1');

// Is this Quizbrew.exe running from a Store package (C:\Program Files\WindowsApps\...)?
function packaged(execPath = process.execPath) {
  return /[\\/]WindowsApps[\\/]/i.test(execPath);
}

function askWindows(done) {
  const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  execFile(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT], { windowsHide: true, timeout: 30000 }, (err, stdout) => {
    if (err && !stdout) return done({ ok: false, error: err.message });
    const line = String(stdout).trim().split(/\r?\n/).pop();
    try { done(JSON.parse(line)); } catch { done({ ok: false, error: 'No answer from the Store' }); }
  });
}

// storeId: the Store ID from Partner Center (9...), for the "Get Pro" link to the Store page.
function create({ dataDir, storeId = '', ask = askWindows, every = 60000, now = () => Date.now() } = {}) {
  const file = path.join(dataDir, 'store.json');
  let state = { checked: false, bought: false, at: 0, error: '' };
  try { state = { ...state, ...JSON.parse(fs.readFileSync(file, 'utf8')), checked: false }; } catch { /* first start */ }
  let busy = false;
  let timer = null;
  const save = () => { try { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify({ bought: state.bought, at: state.at })); } catch { /* read-only: keep it in memory */ } };
  const check = () => new Promise(resolve => {
    if (busy) return resolve(state);
    busy = true;
    ask(answer => {
      busy = false;
      if (answer && answer.ok) {
        state = { checked: true, bought: !!answer.active && !answer.trial, at: now(), error: '' };
        save();
      } else {
        state = { ...state, checked: true, error: (answer && answer.error) || 'unknown' };
      }
      if (state.bought && timer) { clearInterval(timer); timer = null; }
      resolve(state);
    });
  });
  const start = () => { check(); if (!timer && every) { timer = setInterval(() => { if (!state.bought) check(); }, every); timer.unref?.(); } };
  const url = storeId ? `ms-windows-store://pdp/?ProductId=${encodeURIComponent(storeId)}` : '';
  return { pro: () => state.bought, url, check, start, status: () => ({ ...state }), stop: () => { clearInterval(timer); timer = null; } };
}

module.exports = { create, packaged, SCRIPT };
