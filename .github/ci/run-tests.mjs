/* Drives tests/index.html in a real Chromium and turns the result into an exit code.
   The suite needs a real browser -- it loads the game in an iframe, drives canvas and
   measures layout -- so there is no way to run it in a bare Node process.

   The site itself stays dependency-free on purpose. That is why Playwright lives here,
   under .github/ci, instead of in a package.json at the repo root: nothing a player
   downloads should depend on the test tooling. */

import { chromium } from 'playwright';

const url = process.argv[2] || 'http://127.0.0.1:8000/tests/index.html';
/* 300s was not enough: the first CI run timed out there. A runner with a software
   rasteriser is several times slower than a development machine, so the ceiling is
   generous and the suite itself was made cheap (see stepSim in tests/suite.js). */
const TIMEOUT_MS = Number(process.env.SUITE_TIMEOUT_MS || 900000);

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
  /* A harness-level failure needs to be visible without log access too, or a red run
     says nothing to anyone who cannot download the log. Progress is included so a
     timeout says WHERE it stopped -- slow and stuck look identical otherwise. */
  let progress = null;
  try { progress = await page.evaluate(() => window.PIPO_PROGRESS || null); } catch (e) { /* page may be gone */ }
  const where = progress
    ? ' | reached ' + progress.done + '/' + progress.total + ' checks, last: ' + progress.last
    : ' | no progress was reported at all';
  const first = noise.length ? ' | first page error: ' + noise[0].replace(/\r?\n/g, ' ').slice(0, 200) : '';
  console.log('::error title=regression suite did not run::' + err.message.replace(/\r?\n/g, ' ').slice(0, 300) + where + first);
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

/* Emit a GitHub annotation per failure. Job logs need admin rights on the repository,
   so a failure that only exists in the log is invisible to anyone without them -- which
   is exactly the position this project was in when the first CI run went red and the
   reason could not be read. Annotations ride on the check run and are readable by
   anyone who can see the repo. */
const oneLine = (s) => String(s == null ? '' : s).replace(/\r?\n/g, ' ').slice(0, 400);
for (const r of result.results) {
  if (r.pass) continue;
  console.log('::error title=' + oneLine(r.group + '/' + r.name) + '::' + oneLine(r.detail));
}
if (!result.failed) {
  console.log('::notice title=regression suite::' + result.passed + '/' + result.total + ' checks passed');
}

/* And a job summary, for the humans who do have log access. */
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs');
  const rows = result.results
    .map((r) => '| ' + (r.pass ? '✅' : '❌') + ' | `' + r.group + '` | ' + r.name + ' | ' + r.ms + 'ms | ' + oneLine(r.detail).replace(/\|/g, '\\|') + ' |')
    .join('\n');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    '## PIPO JUMP regression suite\n\n' +
    '**' + result.passed + '/' + result.total + ' passed' + (result.failed ? ', ' + result.failed + ' failed' : '') + '**\n\n' +
    '| | group | check | time | detail |\n|---|---|---|---|---|\n' + rows + '\n');
}

/* Console errors are reported but do not by themselves fail the run: the crash-boundary
   test deliberately provokes one, and the suite asserts the count itself. */
if (noise.length) {
  console.log('');
  console.log('page console errors (' + noise.length + ', expected: 1 from the crash-boundary test):');
  for (const line of noise.slice(0, 10)) console.log('  ' + line);
}

process.exit(result.failed > 0 ? 1 : 0);
