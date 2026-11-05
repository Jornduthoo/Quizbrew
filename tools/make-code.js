#!/usr/bin/env node
// Make a Quizbrew code (Jorn only: it needs the private key, which is never in the repo).
//   npm run make-code -- --name "Marieke"              Pro, forever
//   npm run make-code -- --name "Tester Tom" --days 60 Tester: Pro for 60 days
//   npm run make-code -- --name "Bar Zoet" --count 5   five codes at once
// The key is read from keys/quizbrew-private.pem (git ignores keys/) or from the file in QUIZBREW_PRIVATE_KEY.
// Keep a copy of that key somewhere safe: without it, no new codes can be made that this version accepts.
const fs = require('fs');
const path = require('path');
const License = require('../src/license');

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const name = opt('name');
const days = Number(opt('days') || 0);
const count = Math.max(1, Math.min(100, Number(opt('count') || 1)));
if (!name) {
  console.log('Usage: npm run make-code -- --name "Name" [--days 60] [--count 1]');
  process.exit(1);
}
const keyFile = process.env.QUIZBREW_PRIVATE_KEY || path.join(__dirname, '..', 'keys', 'quizbrew-private.pem');
let key;
try { key = fs.readFileSync(keyFile); } catch {
  console.error(`No private key at ${keyFile}.`);
  process.exit(1);
}
const until = days > 0 ? Date.now() + days * 86400000 : null;
for (let i = 0; i < count; i++) {
  const code = License.sign(key, { name, kind: until ? 'tester' : 'pro', until });
  if (!License.decode(code)) { console.error('This key does not match the app. Wrong key file?'); process.exit(1); }
  console.log(code);
}
console.error(`\n${count} code(s) for "${name}": ${until ? `tester, Pro until ${new Date(until).toISOString().slice(0, 10)}` : 'Pro, no end date'}.`);
