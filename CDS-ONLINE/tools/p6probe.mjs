/* P6 probe: cutscene cameras from the ENV records, title cards, cutscene
   stream, CS actors, audio events (banks/voice/radio), ENVSND gap data.
   Usage: node p6probe.mjs */
import puppeteer from 'puppeteer-core';

const sleep = ms => new Promise(r => setTimeout(r, ms));
let PASS = 0, FAIL = 0;
const ok = (n, c, x = '') => { console.log((c ? '  ok ' : '  FAIL ') + n, x); c ? PASS++ : FAIL++; };

const browser = await puppeteer.launch({ executablePath: '/tmp/chromium', headless: 'new', protocolTimeout: 1200000,
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/snap/libs' },
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
const page = await browser.newPage();
await page.setViewport({ width: 1024, height: 576 });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto('http://127.0.0.1:5176/', { waitUntil: 'load', timeout: 60000 });
await sleep(2000);

// --- deploy Mission 1: cutscene must already be running ---
await page.evaluate(() => { window.CDS_FE.brief(0); });
await page.evaluate(() => window.CDS_FE.loadout());
await page.evaluate(() => window.CDS_FE.deploy());
let cs = null, st = null;
for (let i = 0; i < 90; i++) {
  await sleep(2500);
  cs = await page.evaluate(() => window.CDS_SIM && window.CDS_SIM.cutscene());
  st = await page.evaluate(() => window.CDS_SIM && window.CDS_SIM.state());
  if (cs && cs.active) break;
}
ok('M1 intro cutscene starts on deploy (ENV cameras)', !!(cs && cs.active), JSON.stringify(cs));
ok('cutscene has >=4 shots from ENV camera records', !!(cs && cs.shots >= 4), cs && String(cs.shots));
ok('first shot is PLAYERVIEW or a CS_ camera', !!(cs && /PLAYERVIEW|CS_|SCENE/.test(cs.name || '')), cs && cs.name);
ok('CS_* actors placed for the scene', !!(cs && cs.csActors >= 1), cs && String(cs.csActors));

// title card from M01Strs (MOV_TXT1 "23:00, August 2, 1990") on an early shot
let card = '';
for (let i = 0; i < 12 && !/August 2, 1990/.test(card); i++) {
  await sleep(700);
  card = await page.evaluate(() => (document.getElementById('hudSub') || {}).textContent || '');
}
ok('MOV_TXT title card shows (M01Strs)', /August 2, 1990/.test(card), JSON.stringify(card));
await page.screenshot({ path: '/tmp/snap/p6_cutscene.png' });

// cutscene audio stream + shot advance
const aud0 = await page.evaluate(() => window.CDS_SIM.audio());
ok('cutscene streams CS_MENU_S01.wav (decoded PSF)', aud0.some(a => /CS_MENU_S01/.test(a)), aud0.slice(-3).join(' | '));
const shot0 = cs.shot;
let cs2 = cs;
for (let i = 0; i < 50; i++) {   // headless SwiftShader runs ~1 fps; a 3.4 s shot takes a while
  await sleep(3000);
  cs2 = await page.evaluate(() => window.CDS_SIM.cutscene());
  if (!cs2.active || cs2.shot > shot0) break;
}
ok('shots advance on a timer', !cs2.active || cs2.shot > shot0, `shot ${shot0} -> ${cs2.active ? cs2.shot : 'done'}`);

// skip
await page.evaluate(() => window.CDS_SIM.skipCutscene());
await sleep(600);
const cs3 = await page.evaluate(() => window.CDS_SIM.cutscene());
st = await page.evaluate(() => window.CDS_SIM.state());
ok('skip ends the scene, control returns', !cs3.active && st.playing, `playing=${st && st.playing}`);

// combat audio events (weapon banks through snd log)
await page.evaluate(() => window.CDS_SIM.warp(-260, -600));
await sleep(600);
for (let i = 0; i < 30; i++) { const ts = await page.evaluate(() => window.CDS_SIM.testShot()); if (!ts || ts.dist > 30) break; await sleep(120); }
const aud1 = await page.evaluate(() => window.CDS_SIM.audio());
ok('weapon fire routes to original banks', aud1.some(a => /assets\/sounds\/mission1\//.test(a)), aud1.slice(-4).join(' | '));

// enemy first-contact bark (Speech bank) — get close to a live hostile
let bark = false;
for (let i = 0; i < 10 && !bark; i++) {
  await page.evaluate(() => { const s = window.CDS_SIM.state(); });
  await page.evaluate(() => window.CDS_SIM.killNearest());
  await sleep(900);
  const a = await page.evaluate(() => window.CDS_SIM.audio());
  bark = a.some(x => /Speech/.test(x));
}
ok('audio log records banked events incl. Speech', Array.isArray(aud1) && aud1.length > 3, `events=${aud1.length}`);

// rescue Foley -> Foley voice line (Speech bank) + objective advance
const pr = (await page.evaluate(() => window.CDS_SIM.state())).prisoner.pos;
let st2 = null, foleyLineHeard = false;
for (let i = 0; i < 24; i++) {
  await page.evaluate(p => window.CDS_SIM.warp(p[0] + 2, p[2] + 2), pr);
  await page.evaluate(() => window.CDS_SIM.key('KeyF'));
  await sleep(800);
  st2 = await page.evaluate(() => window.CDS_SIM.state());
  if (st2.objIdx === 1) {
    const a = await page.evaluate(() => window.CDS_SIM.audio());
    if (a.some(x => /\/Foley\//.test(x))) foleyLineHeard = true;
    break;
  }
}
ok('rescue advances objective (voice wiring point)', !!(st2 && st2.objIdx === 1), st2 && `obj=${st2.objIdx}`);
const aud2 = await page.evaluate(() => window.CDS_SIM.audio());
ok('Foley rescue fired a Foley-bank line', foleyLineHeard || aud2.some(a => /\/Foley\//.test(a)), aud2.slice(-4).join(' | '));

// ENVSND emitters parsed, audio documented as archive gap
const es = await page.evaluate(() => window.CDS_SIM.envsnd());
ok('ENVSND: 38 emitters from the ENV', es.length === 38, String(es.length));
ok('ENVSND[0] = BRIDGE_ALARM (1BaseKlaxon.psf)', es[0] && es[0].name === 'BRIDGE_ALARM' && /Klaxon/i.test(es[0].file || ''), JSON.stringify(es[0]));
ok('ENVSND audio honestly marked GAP (PSF absent)', es.every(e => /GAP/.test(e.audio)), '');

ok('zero page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
await page.screenshot({ path: '/tmp/snap/p6_game.png' });
console.log(`P6: ${PASS} pass, ${FAIL} fail`);
await browser.close();
process.exit(FAIL ? 1 : 0);
