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
await page.evaluate(() => { window.CDS_FE.brief(0); });
await page.evaluate(() => window.CDS_FE.loadout());
await page.evaluate(() => window.CDS_FE.deploy());
let st = null;
for (let i = 0; i < 80; i++) { await sleep(3000); st = await page.evaluate(() => window.CDS_SIM && window.CDS_SIM.state()); if (st && st.playing) break; }
ok('DEPLOY enters the simulation (Mission 1)', !!(st && st.playing), '');
ok('squad: Bradley / CONNORS / Jones', !!st && st.squad.map(s => s.name).join(',') === 'BRADLEY,CONNORS,JONES', st && st.squad.map(s => s.name).join(','));
ok('Foley is the prisoner', !!st && !!st.prisoner, '');
ok('27 hostiles from HLOI placements', !!st && st.enemies.total === 27, st && String(st.enemies.total));
ok('state machine: standing state from the rules file', !!st && /STANDING_STILL/.test(st.squad[0].state), st && st.squad[0].state);
ok('locomotion speeds: source declared honestly', !!st && (st.speeds.src === 'clip-root-motion' || st.speeds.src === 'PROVISIONAL'), JSON.stringify(st && st.speeds));
await sleep(2500);
await page.screenshot({ path: '/tmp/snap/p34_game.png' });
// movement: state + displacement
const p0 = st.squad[0].pos;
await page.evaluate(() => window.CDS_SIM.key('KeyW', true));
await sleep(2500);
let st2 = await page.evaluate(() => window.CDS_SIM.state());
await page.evaluate(() => window.CDS_SIM.key('KeyW', false));
ok('movement state = RUNNING (OG default mode)', /RUNNING/.test(st2.squad[0].state), st2.squad[0].state);
ok('soldier displaced', Math.hypot(st2.squad[0].pos[0] - p0[0], st2.squad[0].pos[2] - p0[2]) > 0.5, JSON.stringify(st2.squad[0].pos));
// stances
await page.evaluate(() => window.CDS_SIM.setMode('KNEEL'));
await sleep(1500);
st2 = await page.evaluate(() => window.CDS_SIM.state());
ok('kneel -> KNEELING states', /KNEELING/.test(st2.squad[0].state), st2.squad[0].state);
await page.evaluate(() => window.CDS_SIM.setMode('CRAWL'));
await sleep(1500);
st2 = await page.evaluate(() => window.CDS_SIM.state());
ok('crawl -> CRAWLING states', /CRAWL|PRONE/.test(st2.squad[0].state), st2.squad[0].state);
await page.evaluate(() => window.CDS_SIM.setMode('RUN'));
// rescue arc
const pr = (await page.evaluate(() => window.CDS_SIM.state())).prisoner.pos;
await page.evaluate(p => window.CDS_SIM.warp(p[0] + 2, p[2] + 2), pr);
await sleep(500);
for (let i = 0; i < 24; i++) { await page.evaluate(() => window.CDS_SIM.key('KeyF')); await sleep(800); st2 = await page.evaluate(() => window.CDS_SIM.state()); if (st2.objIdx === 1) break; await page.evaluate(p => window.CDS_SIM.warp(p[0] + 2, p[2] + 2), st2.prisoner.pos); }
ok('rescue: Foley joins, objective advances', st2.objIdx === 1 && st2.squad.length === 4, `obj=${st2.objIdx} squad=${st2.squad.map(s => s.name).join(',')}`);
// C4
const c4spot = await page.evaluate(c => {
  let best = null, bd = 1e9;
  for (let dx = -8; dx <= 8; dx += 1) for (let dz = -5; dz <= 5; dz += 1) {
    const under = window.CDS_SIM.ground(c[0] + dx, c[2] + dz).filter(y => y <= c[1] + 1.2);
    if (!under.length) continue;
    const d = Math.hypot(dx, dz) + Math.abs(under[0] - c[1]) * 2;
    if (d < bd) { bd = d; best = [c[0] + dx, c[2] + dz]; }
  }
  return best || [c[0], c[2]];
}, st2.c4);
await page.evaluate(p => window.CDS_SIM.warpAll(p[0], p[1]), c4spot);
for (let i = 0; i < 50; i++) { const ts = await page.evaluate(() => window.CDS_SIM.testShot()); if (!ts || ts.dist > 26) break; await sleep(120); }
for (let i = 0; i < 30; i++) { await page.evaluate(() => window.CDS_SIM.key('KeyF')); await sleep(1200); st2 = await page.evaluate(() => window.CDS_SIM.state()); if (st2.objIdx === 2 || !st2.squad[0].alive) break; }
ok('C4 recovered', st2.objIdx === 2 && st2.hasC4, 'obj=' + st2.objIdx);
// bridge plant
await page.evaluate(b => window.CDS_SIM.warpAll(b[0], b[2]), st2.bridge);
for (let i = 0; i < 60; i++) { const ts = await page.evaluate(() => window.CDS_SIM.testShot()); if (!ts || ts.dist > 30) break; await sleep(120); }
for (let i = 0; i < 70; i++) { await page.evaluate(() => window.CDS_SIM.key('KeyF')); await sleep(1500); st2 = await page.evaluate(() => window.CDS_SIM.state()); if (st2.objIdx === 3 || !st2.squad[0].alive) break; }
ok('bridge destroyed -> extraction objective', st2.objIdx === 3, 'obj=' + st2.objIdx);
// combat: one aimed shot must cost the target exactly the table damage (14)
await page.evaluate(() => window.CDS_SIM.warp(-260, -600));
await sleep(600);
for (let i = 0; i < 40; i++) { const ts = await page.evaluate(() => window.CDS_SIM.testShot()); if (!ts || ts.dist > 30) break; await sleep(100); }
const shot = await page.evaluate(() => window.CDS_SIM.testShot());
ok('one M16A2 hit = 14 damage (Weaps.txt)', !!shot && shot.after === shot.before - 14, JSON.stringify(shot));
// firing burns ammo
const am0 = (await page.evaluate(() => window.CDS_SIM.state())).squad[0].ammo;
await page.evaluate(() => window.CDS_SIM.fire(true));
let am1 = am0;
for (let i = 0; i < 16; i++) { await sleep(500); am1 = (await page.evaluate(() => window.CDS_SIM.state())).squad[0].ammo; if (am1 < am0) break; }
await page.evaluate(() => window.CDS_SIM.fire(false));
ok('trigger fire burns magazine', am1 < am0, am0 + '->' + am1);
// extraction
await page.evaluate(e => window.CDS_SIM.warpAll(e[0], e[2]), st2.extract);
let done = false;
for (let i = 0; i < 30; i++) { await sleep(1500); const s3 = await page.evaluate(() => window.CDS_SIM.state()); if (!s3.playing) { done = true; break; } }
ok('extraction completes the mission', done, '');
ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
await browser.close();
console.log(`p34probe: ${PASS} pass, ${FAIL} fail`);
process.exit(FAIL ? 1 : 0);
