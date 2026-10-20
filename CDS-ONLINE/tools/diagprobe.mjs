import puppeteer from 'puppeteer-core';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/tmp/chromium', headless: 'new', protocolTimeout: 900000,
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/snap/libs' },
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio', '--window-size=1280,720'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto('http://127.0.0.1:5176/', { waitUntil: 'load', timeout: 60000 });
await sleep(2500);
await page.evaluate(() => { window.CDS_FE.brief(0); });
await page.evaluate(() => window.CDS_FE.loadout());
await page.evaluate(() => window.CDS_FE.deploy());
let st = null;
for (let i = 0; i < 90; i++) { await sleep(2000); st = await page.evaluate(() => window.CDS_SIM && window.CDS_SIM.state()).catch(() => null); if (st && st.playing) break; }
await page.evaluate(() => window.CDS_SIM.skipCutscene());
await sleep(2000);
console.log('squad0 pos:', JSON.stringify(st.squad[0].pos), 'extract:', JSON.stringify(st.extract));
await page.screenshot({ path: '/tmp/snap/diag_a_spawn.png' });
// turn camera 180 via TURN_LEFT (Comma)
await page.evaluate(() => window.CDS_SIM.key('Comma', true));
await sleep(2600);
await page.evaluate(() => window.CDS_SIM.key('Comma', false));
await sleep(1200);
await page.screenshot({ path: '/tmp/snap/diag_b_turned.png' });
// warp across the map
await page.evaluate(() => window.CDS_SIM.warpAll(-226, -490));
await sleep(2000);
await page.screenshot({ path: '/tmp/snap/diag_c_bridge.png' });
console.log('done');
await browser.close();
