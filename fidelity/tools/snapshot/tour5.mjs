// tour5: close-ups — crouched firing enemy, then his corpse at 4 m
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync('/tmp/snap/tour5', { recursive: true });
const browser = await puppeteer.launch({
  executablePath: '/tmp/chromium', headless: 'new',
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/snap/libs' },
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio', '--window-size=1280,800'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
page.on('pageerror', e => console.log('PAGEERR', e.message));
await page.goto('http://127.0.0.1:5175/play.html?m=mission1', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.__playLoaded === true, { timeout: 240000, polling: 2000 }).catch(() => {});
await page.evaluate(() => document.getElementById('deployGo').click());
await sleep(600);
await page.mouse.click(640, 400);
await page.waitForFunction(() => window.BD_TEST.state().playing, { timeout: 60000, polling: 1000 }).catch(() => {});
const S = () => page.evaluate(() => window.BD_TEST.state());
const tp = (x, z) => page.evaluate(([a, b]) => window.BD_TEST.teleport(a, b), [x, z]);
const face = (x, z) => page.evaluate(([a, b]) => window.BD_TEST.facePlayer(a, b), [x, z]);
await page.evaluate(() => window.BD_TEST.hurt(-100000));
// open flat ground by the road north of the gate: stage a duel at 16 m
await tp(-160, -330); await sleep(600);
const e = (await S()).enemies.filter(x2 => !x2.hold).sort((a, b) => a.d - b.d)[0];
await tp(e.x + 14, e.z + 8); await face(e.x, e.z); await sleep(500);
await page.evaluate(() => window.BD_TEST.aggro());
let shot = false;
for (let i = 0; i < 40 && !shot; i++) {
  await sleep(2000);
  const s = await S();
  const g = s.enemies.reduce((a, b) => Math.hypot(b.x - e.x, b.z - e.z) < Math.hypot(a.x - e.x, a.z - e.z) ? b : a, s.enemies[0]);
  if (g.st === 'engage' && g.posture !== 'stand') {
    await page.screenshot({ path: '/tmp/snap/tour5/01-crouch-fire.png' });
    console.log('crouch/prone shot at posture', g.posture); shot = true;
  }
}
if (!shot) await page.screenshot({ path: '/tmp/snap/tour5/01-crouch-fire.png' });
// corpse at 4 m
await page.evaluate(() => window.BD_TEST.slay());
await sleep(5000);
const c = (await S()).corpses[0];
if (c) { await tp(c.x + 3, c.z + 3); await face(c.x, c.z); await sleep(1500);
  await page.screenshot({ path: '/tmp/snap/tour5/02-corpse-close.png' }); }
console.log('corpse:', JSON.stringify(c));
await browser.close();
console.log('tour5 done');
