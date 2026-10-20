/* R2 probe: DS-* music containers recovered + mission-end stingers wired. */
import puppeteer from 'puppeteer-core';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let PASS = 0, FAIL = 0;
const ok = (n, c, x = '') => { console.log((c ? '  ok ' : '  FAIL ') + n, x); c ? PASS++ : FAIL++; };
const browser = await puppeteer.launch({ executablePath: '/tmp/chromium', headless: 'new', protocolTimeout: 900000,
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/snap/libs' },
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
const page = await browser.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto('http://127.0.0.1:5176/', { waitUntil: 'load', timeout: 60000 });
await sleep(1500);

// the six recovered tracks serve, with real durations
for (const t of ['DS-DesertMusic1', 'DS-DesertMusic2', 'DS-MilitaryMusic1', 'DS-UrbanMusic1', 'DS-MissionSuccess', 'DS-MissionFailure']) {
  const meta = await page.evaluate(async (t) => {
    const r = await fetch(`assets/music/${t}.wav`);
    const b = await r.arrayBuffer();
    const dv = new DataView(b);
    const rate = dv.getUint32(24, true), dataBytes = b.byteLength - 44;
    return { status: r.status, secs: dataBytes / (rate * 4) };
  }, t);
  ok(`${t}.wav decoded & served`, meta.status === 200 && meta.secs > 60, `${meta.secs.toFixed(0)}s`);
}

// deploy M1, then mission-end stingers (win + fail) hit the audio log
await page.evaluate(() => { window.CDS_FE.brief(0); });
await page.evaluate(() => window.CDS_FE.loadout());
await page.evaluate(() => window.CDS_FE.deploy());
let st = null;
for (let i = 0; i < 90; i++) { await sleep(2500); st = await page.evaluate(() => window.CDS_SIM && window.CDS_SIM.state()).catch(() => null); if (st && st.playing) break; }
await page.evaluate(() => window.CDS_SIM.skipCutscene());
await page.evaluate(() => window.CDS_SIM.endMission(true));
await sleep(600);
let aud = await page.evaluate(() => window.CDS_SIM.audio());
ok('win -> DS-MissionSuccess stinger', aud.some(a => /DS-MissionSuccess\.wav/.test(a)), aud.slice(-2).join(' | '));
ok('end screen shown', await page.evaluate(() => document.getElementById('hudEnd').style.display === 'block'), '');
await page.evaluate(() => document.getElementById('endRestart').click());
for (let i = 0; i < 40; i++) { await sleep(2000); st = await page.evaluate(() => window.CDS_SIM.state()); if (st && st.playing) break; }
ok('RESTART LEVEL flow restarts the mission', !!(st && st.playing), '');
await page.evaluate(() => window.CDS_SIM.skipCutscene());
await page.evaluate(() => window.CDS_SIM.endMission(false));
await sleep(600);
aud = await page.evaluate(() => window.CDS_SIM.audio());
ok('fail -> DS-MissionFailure stinger', aud.some(a => /DS-MissionFailure\.wav/.test(a)), aud.slice(-2).join(' | '));
ok('zero page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`R2: ${PASS} pass, ${FAIL} fail`);
await browser.close();
process.exit(FAIL ? 1 : 0);
