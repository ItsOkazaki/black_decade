import puppeteer from 'puppeteer-core';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let PASS = 0, FAIL = 0;
const ok = (n, c, x = '') => { console.log((c ? '  ok ' : '  FAIL ') + n, x); c ? PASS++ : FAIL++; };
const browser = await puppeteer.launch({ executablePath: '/tmp/chromium', headless: 'new', protocolTimeout: 1200000,
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/snap/libs' },
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
const page = await browser.newPage();
await page.setViewport({ width: 1024, height: 576 });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto('http://127.0.0.1:5176/', { waitUntil: 'load', timeout: 60000 });
await sleep(1500);
const titleTxt = await page.evaluate(() => document.body.innerText);
ok('launch shows Conflict: Desert Storm, no BLACK DECADE', /PRESS ENTER/.test(titleTxt) && !/BLACK DECADE/i.test(titleTxt), '');
await page.screenshot({ path: '/tmp/snap/cds_title.png' });
await page.click('#title');
await sleep(600);
ok('main menu: SINGLE PLAYER', await page.evaluate(() => document.getElementById('menu').classList.contains('on') && /SINGLE PLAYER/.test(document.body.innerText)), '');
await page.click('#miQuick');
await sleep(600);
const br = await page.evaluate(() => ({ h: document.getElementById('brHead').textContent, t: document.getElementById('brText').textContent, o: document.getElementById('brObjs').innerText }));
ok('briefing is the original .loc text', br.h === 'RESCUE' && /Paul 'Eagle-eye' Foley/.test(br.t) && /Extraction/.test(br.o), br.h);
await page.click('#brDeploy');
let st = null;
for (let i = 0; i < 90; i++) { await sleep(3000); st = await page.evaluate(() => window.CDS_TEST && window.CDS_TEST.state()); if (st && st.playing) break; }
ok('mission deployed & playing', !!(st && st.playing), JSON.stringify(st && st.mission));
ok('squad is Bradley/Connors/Jones', !!st && st.squad.map(s => s.name).join(',') === 'BRADLEY,CONNORS,JONES', st && st.squad.map(s => s.name).join(','));
ok('27 hostiles from the mission file', !!st && st.enemies.total === 27, st && String(st.enemies.total));
ok('Foley held prisoner', !!st && !!st.prisoner, '');
ok('objective 1 = RESCUE FOLEY', !!st && st.objectives[0] === 'RESCUE FOLEY', st && st.objectives.join('|'));
await sleep(2500);
await page.screenshot({ path: '/tmp/snap/cds_game.png' });
// firing burns ammo
const a0 = await page.evaluate(() => document.getElementById('gunAmmo').innerText);
await page.evaluate(() => window.CDS_TEST.fire(true));
await sleep(1600);
await page.evaluate(() => window.CDS_TEST.fire(false));
const a1 = await page.evaluate(() => document.getElementById('gunAmmo').innerText);
ok('weapon fires (ammo drops)', a0 !== a1, a0.trim() + ' -> ' + a1.trim());
// movement
const p0 = st.squad[0].pos;
await page.evaluate(() => window.CDS_TEST.key('KeyW', true));
await sleep(2200);
await page.evaluate(() => window.CDS_TEST.key('KeyW', false));
st = await page.evaluate(() => window.CDS_TEST.state());
ok('soldier moves', Math.hypot(st.squad[0].pos[0] - p0[0], st.squad[0].pos[2] - p0[2]) > 0.4, JSON.stringify(st.squad[0].pos));
// kill pipeline
const alive0 = st.enemies.alive;
await page.evaluate(() => window.CDS_TEST.killNearest());
await sleep(400);
st = await page.evaluate(() => window.CDS_TEST.state());
ok('hostile can be killed', st.enemies.alive === alive0 - 1, alive0 + '->' + st.enemies.alive);
// rescue Foley
await page.evaluate(() => { const s = window.CDS_TEST.state(); window.CDS_TEST.warp(s.prisoner.pos[0] + 2, s.prisoner.pos[2] + 2); });
await sleep(500);
await page.evaluate(() => window.CDS_TEST.key('KeyF'));
for (let i = 0; i < 20; i++) { await sleep(1000); st = await page.evaluate(() => window.CDS_TEST.state()); if (st.objIdx === 1) break; }
ok('Foley rescued → squad of 4, objective advances', st.objIdx === 1 && st.squad.length === 4, `obj=${st.objIdx} squad=${st.squad.length}`);
// C4 → bridge → extraction
await page.evaluate(() => window.CDS_TEST.giveC4());
await page.evaluate(() => window.CDS_TEST.key('KeyF'));
await sleep(300);
// force obj stage to C4-done? giveC4 only sets flag; walk the plant:
await page.evaluate(() => window.CDS_TEST.warp(-225.9, -486.0));
await sleep(600);
await page.evaluate(() => window.CDS_TEST.key('KeyF'));
let plantedOk = false;
for (let i = 0; i < 40; i++) { await sleep(2000); st = await page.evaluate(() => window.CDS_TEST.state()); if (st.objIdx >= 2) plantedOk = true; if (st.objIdx === 3) break; }
ok('C4 objective chain reaches bridge/extraction', plantedOk || st.objIdx === 3, 'obj=' + st.objIdx);
if (st.objIdx === 3) {
  await page.evaluate(() => window.CDS_TEST.warpAll(-113.5, -229.0));
  let done = false;
  for (let i = 0; i < 25; i++) { await sleep(1500); const t = await page.evaluate(() => document.getElementById('endTitle').textContent); if (t === 'MISSION COMPLETE') { done = true; break; } }
  ok('extraction completes the mission', done, '');
}
ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
await page.screenshot({ path: '/tmp/snap/cds_end.png' });
await browser.close();
console.log(`cdsprobe: ${PASS} pass, ${FAIL} fail`);
process.exit(FAIL ? 1 : 0);
