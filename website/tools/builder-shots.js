// Screenshots of the quiz builder for the website: the AI writes a night, the round-type menu and the editor.
// Run from the repo root: node website/tools/builder-shots.js [lang|all]   (needs Playwright with Chromium and ImageMagick)
// A stand-in answers for the AI with the sample night of that language, so no key or internet is needed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const express = require('express');
const { chromium } = require('playwright');
const { createServer } = require('../../src/app');

const ROOT = path.join(__dirname, '..', '..');
const L = require('./shot-lang');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'qb-bshots-'));
const NO_MOTION = '*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition: none !important; }';
const settle = (ms = 700) => new Promise(r => setTimeout(r, ms));

async function run(lang) {
  const OUT = path.join(__dirname, '..', 'img', 'shots', lang);
  fs.mkdirSync(OUT, { recursive: true });
  const pack = JSON.parse(fs.readFileSync(path.join(ROOT, 'quizzes', `night-pack-1.${lang}.json`), 'utf8'));
  const ai = express();
  ai.use(express.json({ limit: '5mb' }));
  ai.post(/generateContent$/, (req, res) => res.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ title: L.TITLE[lang], rounds: pack.rounds }) }] } }] }));
  const aiServer = await new Promise(r => { const sv = ai.listen(0, () => r(sv)); });
  process.env.GEMINI_BASE_URL = `http://127.0.0.1:${aiServer.address().port}`;
  const data = { language: lang, sfx: false, look: 'pub', aiProvider: 'gemini', geminiKey: 'demo', geminiModel: 'gemini-demo' };
  const qb = createServer({ port: 0, license: require('../../test/fixtures/pro').proLicense(), settings: { get: k => data[k], set: (k, v) => { data[k] = v; } }, library: require('../../src/library').create(TMP), lanAddresses: () => ['192.168.1.20'] });
  const port = await qb.listen();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 }, locale: L.LOCALE[lang] });
  const shot = async name => {
    await settle();
    const png = path.join(TMP, name + '.png');
    await page.screenshot({ path: png });
    const file = path.join(OUT, `builder-${name}.webp`);
    execFileSync('convert', [png, '-resize', '1280x', '-quality', '76', file]);
    console.log(file, Math.round(fs.statSync(file).size / 1024) + ' KB');
  };
  await page.goto(`http://127.0.0.1:${port}/builder?fx=off`);
  await page.addStyleTag({ content: NO_MOTION });
  await page.locator('#welcome-ai').click();
  await page.locator('#ai-topic').fill(L.TOPIC[lang]);
  await page.locator('#ai-generate').click();
  await page.locator('#ai-result .brass-btn').waitFor({ timeout: 15000 });
  await shot('ai');
  await page.locator('#ai-result .brass-btn').click();
  await settle(1200);
  await shot('editor');
  await page.locator('.round-card.add').click();
  await shot('types');
  await browser.close(); await qb.close(); aiServer.close();
}
(async () => {
  const arg = process.argv[2] || 'all';
  for (const lang of arg === 'all' ? L.LANGS : [arg]) await run(lang);
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
