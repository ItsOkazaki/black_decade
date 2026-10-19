// tour4: corpse fall (mid-anim + settled) and tower guard from ground level
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync('/tmp/snap/tour4', { recursive: true });
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
// corpse: isolated patrol man, 8 m in front of the camera
const e = (await S()).enemies.filter(x2 => !x2.hold)[2];
await tp(e.x + 2, e.z + 9); await face(e.x, e.z); await sleep(1200);
await page.screenshot({ path: '/tmp/snap/tour4/01-before.png' });
await page.evaluate(() => window.BD_TEST.slay());
await sleep(1600);
await page.screenshot({ path: '/tmp/snap/tour4/02-falling.png' });
await sleep(5000);
await page.screenshot({ path: '/tmp/snap/tour4/03-corpse.png' });
console.log('corpse:', JSON.stringify((await S()).corpses));
// tower guard from the gate road
await tp(-224, -450); await face(-237.9, -439); await sleep(2600);
await page.screenshot({ path: '/tmp/snap/tour4/04-tower-from-road.png' });
await browser.close();
console.log('tour4 done');
