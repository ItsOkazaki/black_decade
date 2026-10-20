/* Visual check after the deploy/black-screen fix. */
import puppeteer from 'puppeteer-core';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/tmp/chromium', headless: 'new', protocolTimeout: 900000,
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/snap/libs' },
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio', '--window-size=1280,720'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errs = []; page.on('pageerror', e => errs.push(e.message));
const failed = [];
page.on('response', r => { if (r.status() >= 400) failed.push(r.status() + ' ' + r.url().split('/game/').pop()); });
await page.goto('http://127.0.0.1:5176/', { waitUntil: 'load', timeout: 60000 });
await sleep(2000);
await page.evaluate(() => { window.CDS_FE.brief(0); });
await page.evaluate(() => window.CDS_FE.loadout());
const tClick = Date.now();
page.evaluate(() => window.CDS_FE.deploy());
await sleep(400);
const mid = await page.evaluate(() => ({ screen: document.querySelector('.screen.on') && document.querySelector('.screen.on').id, status: document.getElementById('loadStatus').textContent, bar: document.getElementById('loadBar').style.width }));
await page.screenshot({ path: '/tmp/snap/shot_loading.png' });
let st = null;
for (let i = 0; i < 90; i++) { await sleep(1000); st = await page.evaluate(() => window.CDS_SIM && window.CDS_SIM.state()).catch(() => null); if (st && st.playing) break; }
console.log('deploy->playing ms:', Date.now() - tClick, 'mid-load:', JSON.stringify(mid));
console.log('failed requests:', failed.length, failed.slice(0, 8).join(' | ') || 'none');
await sleep(1200);
await page.screenshot({ path: '/tmp/snap/shot_cutscene.png' });
await page.evaluate(() => window.CDS_SIM.skipCutscene());
await sleep(2500);
const guns = await page.evaluate(() => window.CDS_SIM.guns());
console.log('guns', JSON.stringify(guns.filter(g => g.team === 'us' || g.gun).slice(0, 8)), 'armed', guns.filter(g => g.gun).length, '/', guns.length);
await page.screenshot({ path: '/tmp/snap/shot_game1.png' });
console.log('errors:', errs.slice(0, 4).join(' | ') || 'none');
await browser.close();
