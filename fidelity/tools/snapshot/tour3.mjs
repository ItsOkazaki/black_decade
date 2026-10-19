// tour3: v66 visual evidence — flag, tower interior, HMG post, corpse, BMP, cell
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync('/tmp/snap/tour3', { recursive: true });
const browser = await puppeteer.launch({
  executablePath: '/tmp/chromium', headless: 'new',
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/snap/libs' },
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio', '--window-size=1280,800'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
page.on('pageerror', e => console.log('PAGEERR', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('CONERR', m.text().slice(0, 140)); });
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
// 1. flag + guardhouse plateau, from the road below the pole
await tp(-202, -499); await face(-216.9, -515.9); await sleep(2600);
await page.screenshot({ path: '/tmp/snap/tour3/01-flag.png' });
// 2. watchtower: guard should be INSIDE the cab (head over parapet), not on the roof
await tp(-237.8, -424); await face(-237.8, -439.3); await sleep(2600);
await page.screenshot({ path: '/tmp/snap/tour3/02-tower.png' });
// 3. HMG tripod post + its guard
await tp(-196, -433); await face(-205.7, -426); await sleep(2600);
await page.screenshot({ path: '/tmp/snap/tour3/03-hmg.png' });
// 4. kill a guard in the open: death animation end pose (corpse on the ground)
await tp(-120, -234); await sleep(300);
const near = (await S()).enemies.filter(e => !e.hold)[0];
await tp(near.x + 6, near.z + 10); await face(near.x, near.z); await sleep(900);
await page.evaluate(() => window.BD_TEST.slay());
await sleep(3500);
await page.screenshot({ path: '/tmp/snap/tour3/04-corpse.png' });
console.log('corpses:', JSON.stringify((await S()).corpses));
// 5. BMP on the gorge road (must sit ON the floor now, not float on the deck)
{ const a = (await S()).armor; await tp(a.x + 12, a.z + 10); await face(a.x, a.z); await sleep(2600);
  await page.screenshot({ path: '/tmp/snap/tour3/05-bmp.png' });
  console.log('armor y:', a.y); }
// 6. prison cell doors / captive area
await tp(-48, -585); await face(-61, -593.5); await sleep(2600);
await page.screenshot({ path: '/tmp/snap/tour3/06-cell.png' });
await browser.close();
console.log('tour3 done');
