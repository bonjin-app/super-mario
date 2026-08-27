/* Drives tests/index.html in a real Chromium and turns the result into an exit code.
   The suite needs a real browser -- it loads the game in an iframe, drives canvas and
   measures layout -- so there is no way to run it in a bare Node process.

   The site itself stays dependency-free on purpose. That is why Playwright lives here,
   under .github/ci, instead of in a package.json at the repo root: nothing a player
   downloads should depend on the test tooling. */

import { chromium } from 'playwright';

const url = process.argv[2] || 'http://127.0.0.1:8000/tests/index.html';
const TIMEOUT_MS = Number(process.env.SUITE_TIMEOUT_MS || 300000);

const browser = await chromium.launch();
const page = await browser.newPage();

/* Console output from the test page is worth keeping: a failure inside the harness
   itself shows up here rather than in the results table. */
const noise = [];
page.on('console', (m) => { if (m.type() === 'error') noise.push(m.text()); });
page.on('pageerror', (e) => noise.push('pageerror: ' + e.message));

let result;
try {
  await page.goto(url + '?auto', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__PIPO_RESULT, null, { timeout: TIMEOUT_MS });
  result = await page.evaluate(() => window.__PIPO_RESULT);
} catch (err) {
  console.error('the suite never produced a result: ' + err.message);
  if (noise.length) console.error('page console:\n  ' + noise.slice(0, 20).join('\n  '));
  await browser.close();
  process.exit(2);
}

await browser.close();

const pad = (s, n) => String(s).padEnd(n);
for (const r of result.results) {
  console.log(
    (r.pass ? 'PASS  ' : 'FAIL  ') + pad(r.group, 12) + pad(r.name, 62) +
    pad(r.ms + 'ms', 8) + (r.detail || '')
  );
}
console.log('');
console.log(result.passed + '/' + result.total + ' passed' + (result.failed ? ', ' + result.failed + ' FAILED' : ''));

/* Console errors are reported but do not by themselves fail the run: the crash-boundary
   test deliberately provokes one, and the suite asserts the count itself. */
if (noise.length) {
  console.log('');
  console.log('page console errors (' + noise.length + ', expected: 1 from the crash-boundary test):');
  for (const line of noise.slice(0, 10)) console.log('  ' + line);
}

process.exit(result.failed > 0 ? 1 : 0);
