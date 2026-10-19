// shot4: audit EVERY mission — loads, enemy counts vs the mission data,
// asset failures. Usage: node shot4.mjs <0|1> (half of the mission list)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const half = parseInt(process.argv[2] || '0', 10);
const missions = JSON.parse(fs.readFileSync('/home/user/black_decade/fidelity/missions.json', 'utf8'));
const list = missions.filter((_, i) => i % 2 === half);
const browser = await puppeteer.launch({
  executablePath: '/tmp/chromium', headless: 'new',
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/snap/libs' },
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio', '--window-size=900,560'],
});
let failures = 0;
for (const m of list) {
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 560 });
  const warns = [], errs = [];
  page.on('pageerror', e => errs.push(e.message.slice(0, 120)));
  page.on('console', cm => {
    const t = cm.text();
    if (cm.type() === 'error') errs.push(t.slice(0, 120));
    if (/failed:/.test(t)) warns.push(t.slice(0, 90));
  });
  const t0 = Date.now();
  let loaded = false;
  try {
    await page.goto('http://127.0.0.1:5175/play.html?m=' + m.id, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => window.__playLoaded === true, { timeout: 170000, polling: 2500 });
    loaded = true;
  } catch (e) { /* recorded below */ }
  let line = m.id.padEnd(10) + ' loaded=' + loaded + ' (' + Math.round((Date.now() - t0) / 1000) + 's)';
  if (loaded) {
    const st = await page.evaluate(() => { try { const s = window.BD_TEST.state(); return { e: s.enemies.length, pk: s.pickups.length, gate: s.gateBuilt }; } catch (e2) { return { err: e2.message }; } });
    let expected = -1;
    try {
      const uj = JSON.parse(fs.readFileSync('/home/user/black_decade/fidelity/models/' + m.id + '/units.json', 'utf8'));
      const pj = JSON.parse(fs.readFileSync('/home/user/black_decade/fidelity/models/' + m.id + '/props.json', 'utf8'));
      expected = Math.max((uj.enemies || []).length, pj.enemiesHLOI || 0);   // the game merges both data sources
    } catch (e) { /* no data files */ }
    line += ' enemies=' + st.e + (expected >= 0 ? '/' + expected : '') + ' pickups=' + st.pk;
    if (expected > 0 && st.e !== expected) { line += '  <<< COUNT MISMATCH'; failures++; }
    if (st.err) { line += '  <<< STATE ERR ' + st.err; failures++; }
  } else failures++;
  const uw = [...new Set(warns)];
  if (uw.length) line += ' warns=[' + uw.slice(0, 6).join('; ') + (uw.length > 6 ? ' +' + (uw.length - 6) : '') + ']';
  if (errs.length) { line += ' ERRORS=[' + errs.slice(0, 3).join('; ') + ']'; failures++; }
  console.log(line);
  await page.close();
}
await browser.close();
console.log(failures ? 'AUDIT FAILURES: ' + failures : 'AUDIT CLEAN (half ' + half + ')');
process.exit(failures ? 1 : 0);
