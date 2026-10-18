import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const BASE = 'http://localhost:5175';
const OUT = '/tmp/snap/shots';
import { mkdirSync } from 'fs';
mkdirSync(OUT, { recursive: true });

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
page.on('console', m => { const t = m.text(); if (/error|Error|failed|warn/i.test(t)) console.log('[console]', t.slice(0, 220)); });
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)));

async function shot(name) { await page.screenshot({ path: `${OUT}/${name}.png` }); console.log('shot', name); }

// 1 — main menu (after splash)
await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 60000 });
await sleep(5000);
await shot('01-menu');

// 2 — select force
await page.evaluate(() => document.getElementById('btnSingle').click());
await sleep(1200);
await shot('02-force');

// 3 — mission slider
await page.evaluate(() => document.getElementById('fcANP').click());
await sleep(1500);
await shot('03-missions');
await page.evaluate(() => document.getElementById('misNext').click());
await sleep(1200);
await shot('03b-missions-next');

// 4 — into mission 1: briefing while loading
await page.goto(BASE + '/play.html?m=mission1', { waitUntil: 'load', timeout: 60000 });
await sleep(3000);
await shot('04-briefing-loading');
try {
  await page.waitForFunction(() => {
    const b = document.getElementById('deployGo');
    return b && b.style.display !== 'none';
  }, { timeout: 240000 });
  console.log('loaded: DEPLOY visible');
} catch (e) { console.log('DEPLOY never appeared'); }
await shot('05-briefing-ready');

// 5 — deploy -> cutscene -> gameplay
await page.evaluate(() => document.getElementById('deployGo').click());
await sleep(3500);
await shot('06-cutscene');
await page.mouse.click(640, 400);   // skip cutscene
await sleep(2500);
await shot('07-gameplay');
// walk forward a little (hover-look works without pointer lock)
await page.keyboard.down('KeyW');
await sleep(2500);
await page.keyboard.up('KeyW');
await shot('08-walked');
// aim + look up
await page.mouse.down({ button: 'right' });
await page.mouse.move(640, 300);
await sleep(1200);
await shot('09-aim');
await page.mouse.up({ button: 'right' });

await browser.close();
console.log('done');
