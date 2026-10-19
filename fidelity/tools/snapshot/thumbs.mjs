// thumbs.mjs — capture each placeholder mission's own terrain vista for the
// mission-select slider (the game's world, rendered live, HUD cropped out).
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const LIBS = '/tmp/snap/libs';
const BASE = 'http://127.0.0.1:5175/';
const OUT = '/tmp/thumbs'; fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const IDS = process.argv[2] ? process.argv[2].split(',') : ['mission1', 'mission3', 'mission8', 'mission10', 'mission12a'];
const browser = await puppeteer.launch({
  executablePath: '/tmp/chromium', headless: 'new',
  env: { ...process.env, LD_LIBRARY_PATH: LIBS },
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio', '--window-size=1280,800'],
});
for (const id of IDS) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('pageerror', e => console.log(id, 'PAGEERR', e.message));
  await page.goto(BASE + 'play.html?m=' + id, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__playLoaded === true, { timeout: 240000, polling: 2000 }).catch(() => {});
  await page.evaluate(() => document.getElementById('deployGo').click());
  await sleep(600);
  await page.mouse.click(640, 400); // skip cutscene -> gameplay vista at spawn
  await sleep(3500);
  // face the mission: toward the centroid of the enemy force (the objective view)
  await page.evaluate(() => {
    const st = window.BD_TEST.state();
    if (st.enemies && st.enemies.length) {
      const cx = st.enemies.reduce((a, e) => a + e.x, 0) / st.enemies.length;
      const cz = st.enemies.reduce((a, e) => a + e.z, 0) / st.enemies.length;
      window.BD_TEST.facePlayer(cx, cz);
    }
  });
  await sleep(2500);
  await page.screenshot({ path: OUT + '/' + id + '.png' });
  console.log('captured', id);
  await page.close();
}
await browser.close();
