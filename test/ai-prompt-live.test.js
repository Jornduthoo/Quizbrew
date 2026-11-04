// The AI dialog in a real browser: change the difficulty (or any other field) after a first copy, and the next
// "Copy prompt" hands out the prompt for what the form says now, not the earlier one.
// Needs Playwright with Chromium; without it the test is skipped.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createServer } = require('../src/app');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* not installed: skip */ }

test('AI dialog: the copied prompt follows every change in the form', { skip: !chromium && 'Playwright is not installed', timeout: 120000 }, async t => {
  const settingsData = { language: 'en', sfx: false };
  const qb = createServer({
    port: 0,
    settings: { get: k => settingsData[k], set: (k, v) => { settingsData[k] = v; } },
    library: require('../src/library').create(fs.mkdtempSync(path.join(os.tmpdir(), 'qb-aiprompt-'))),
    lanAddresses: () => ['192.168.1.50'],
    webFetch: async () => ({ ok: false, status: 503, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0), headers: new Map() }),
  });
  const port = await qb.listen();
  const url = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); await qb.close(); });

  const res = await fetch(`${url}/api/host/library/quiz`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quiz: { title: 'Jackpot', rounds: [{ type: 'jackpot', title: '', twists: [], questions: [{ question: '' }] }] } }) });
  const { path: quizPath } = await res.json();

  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${url}/builder?open=${encodeURIComponent(quizPath)}`);
  await page.waitForSelector('#editor:not([hidden]) .q-card');
  await page.click('.re-actions .ai-btn');
  await page.waitForSelector('#ai-modal[open]');

  const setRange = v => page.$eval('#ai-difficulty', (el, val) => { el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, String(v));
  // Empty the clipboard first, then wait until the copy lands in it.
  const copied = async () => {
    await page.evaluate(() => navigator.clipboard.writeText('-'));
    await page.click('#ai-copy');
    await page.waitForFunction(async () => (await navigator.clipboard.readText()) !== '-');
    return page.evaluate(() => navigator.clipboard.readText());
  };

  await page.fill('#ai-topic', 'Football');
  await setRange(4);
  const first = await copied();
  assert.match(first, /Difficulty: hard/);
  assert.match(first, /Topic: Football/);

  // Straight after the change, with no pause: the copy still has the new level.
  await setRange(2);
  const second = await copied();
  assert.match(second, /Difficulty: easy/);
  assert.doesNotMatch(second, /Difficulty: hard/);

  await page.fill('#ai-topic', 'Tech companies');
  await page.fill('#ai-theme', 'Not too hard');
  await page.selectOption('#ai-audience', 'family');
  await page.selectOption('#ai-language', 'nl');
  await page.fill('#ai-count', '6');
  const third = await copied();
  assert.match(third, /Topic: Tech companies/);
  assert.match(third, /Theme of the evening: Not too hard/);
  assert.match(third, /family party/);
  assert.match(third, /Dutch/);
  assert.match(third, /Write 6 questions/);
  assert.match(third, /Difficulty: easy/);
  assert.deepEqual(errors, []);
});
