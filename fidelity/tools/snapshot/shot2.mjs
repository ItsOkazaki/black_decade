import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { mkdirSync } from 'fs';
mkdirSync('/tmp/snap/shots2', { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const exe = await chromium.executablePath();
const browser = await puppeteer.launch({
  executablePath: exe,
  args: [...chromium.args, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,800'],
  headless: 'new',
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/snap/libs' },
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 200)));
await page.goto('http://localhost:5175/play.html?m=mission1', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => {
  const b = document.getElementById('deployGo');
  return b && b.style.display !== 'none';
}, { timeout: 240000 });
await page.evaluate(() => document.getElementById('deployGo').click());
await sleep(3000);
await page.screenshot({ path: '/tmp/snap/shots2/01-cutscene.png' });
await page.mouse.click(640, 400);
await sleep(6000);
await page.screenshot({ path: '/tmp/snap/shots2/02-gameplay.png' });
const op = await page.evaluate(() => getComputedStyle(document.getElementById('msg')).opacity);
console.log('msg opacity after skip:', op);
// inventory: hold SPACE
await page.keyboard.down('Space');
await sleep(900);
await page.screenshot({ path: '/tmp/snap/shots2/03-inventory.png' });
await page.keyboard.up('Space');
// sprint + terrain block test: run forward
await page.keyboard.down('KeyW');
await page.keyboard.down('ShiftLeft');
await sleep(3000);
await page.keyboard.up('ShiftLeft');
await page.keyboard.up('KeyW');
await page.screenshot({ path: '/tmp/snap/shots2/04-sprint.png' });
await browser.close();
console.log('done');
