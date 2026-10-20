/* P5 probe: every SP mission + training boots in the sim with placement-exact
   hostile counts; M1 vehicle armour maths + gate switch; screenshots.
   Usage: node p5probe.mjs [briefIndexFrom] [briefIndexTo]  (SP indices 0..14)
          node p5probe.mjs veh    (vehicle + gate tests on Mission 1)
          node p5probe.mjs train  (training1..3) */
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'fs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
let PASS = 0, FAIL = 0;
const ok = (n, c, x = '') => { console.log((c ? '  ok ' : '  FAIL ') + n, x); c ? PASS++ : FAIL++; };
const SP = ['mission1', 'mission2', 'mission3', 'mission4', 'mission5a', 'mission5b', 'mission6', 'mission7',
  'mission8', 'mission9', 'mission10', 'mission11a', 'mission11b', 'mission12a', 'mission12b'];

function expectedHostiles(id) {
  const d = JSON.parse(readFileSync(`/home/user/cds-og/game/data/missions/${id}.json`, 'utf8'));
  if (d.counts) return d.counts.hostiles;
  return d.units.filter(u => /^IRAQ|^IR_/.test(u.model || '') && !(u.script || '').startsWith('CS')).length;
}

const browser = await puppeteer.launch({ executablePath: '/tmp/chromium', headless: 'new', protocolTimeout: 3600000,
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/snap/libs' },
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
const page = await browser.newPage();
await page.setViewport({ width: 1024, height: 576 });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto('http://127.0.0.1:5176/', { waitUntil: 'load', timeout: 60000 });
await sleep(2000);

async function deployMission(id, briefFn) {
  await briefFn();
  await page.evaluate(() => window.CDS_FE.loadout());
  await page.evaluate(() => window.CDS_FE.deploy());
  let st = null;
  for (let i = 0; i < 150; i++) {
    await sleep(2000);
    st = await page.evaluate(() => window.CDS_SIM && window.CDS_SIM.state());
    if (st && st.playing && st.mission === id) {
      await page.evaluate(() => window.CDS_SIM.skipCutscene());
      return st;
    }
  }
  return st;
}
async function quitToMain() {
  await page.evaluate(() => { const q = document.getElementById('pzQuit'); if (q) q.click(); });
  for (let i = 0; i < 20; i++) { await sleep(500); const sc = await page.evaluate(() => window.CDS_FE.state()); if (sc.screen === 'main') return true; }
  return false;
}

const mode = process.argv[2] || '0';
if (mode === 'veh') {
  const st0 = await deployMission('mission1', async () => page.evaluate(() => window.CDS_FE.brief(0)));
  ok('M1 deploys for vehicle tests', !!(st0 && st0.playing), '');
  const vs = st0.vehicles || [];
  const bmp = vs.find(v => v.model === 'BMP2');
  ok('BMP2 is a live vehicle (VStat BMP2)', !!bmp, JSON.stringify(vs.map(v => v.model)));
  ok('BMP2 hp/armour from VStat (1000/500)', !!bmp && bmp.maxHp === 1000 && bmp.armour === 500, bmp && `${bmp.maxHp}/${bmp.armour}`);
  const h1 = await page.evaluate(() => window.CDS_SIM.testVehicleHit('US_WPN_M16A2', 'iq'));
  ok('rifle fire does not penetrate (14 <= 500)', !!h1 && !h1.penetrated && h1.after === h1.before, JSON.stringify(h1));
  const h2 = await page.evaluate(() => window.CDS_SIM.testVehicleHit('US_WPN_LAW66', 'iq'));
  ok('LAW66 penetrates: 1000 - 550 = 450', !!h2 && h2.penetrated && h2.after === 450, JSON.stringify(h2));
  const h3 = await page.evaluate(() => window.CDS_SIM.testVehicleHit('US_WPN_LAW66', 'iq'));
  ok('second LAW66 destroys the BMP', !!h3 && !h3.alive, JSON.stringify(h3));
  // gate switch (MAIN_GATE_SWITCH region at -237.55, 9.47, -449.36)
  await page.evaluate(() => window.CDS_SIM.warpAll(-237.5, -449.3));
  await sleep(800);
  await page.evaluate(() => window.CDS_SIM.tap('KeyR'));
  let gst = null;
  for (let i = 0; i < 20; i++) { await sleep(800); gst = await page.evaluate(() => window.CDS_SIM.state()); if (gst.gates.some(g => g.target === 1)) break; await page.evaluate(() => window.CDS_SIM.tap('KeyR')); }
  ok('gate switch operates the gate (Doors.txt Mission1Gate)', (gst.gates || []).some(g => g.name === 'MISSION1GATE' && g.target === 1), JSON.stringify((gst.gates || []).filter(g => g.name === 'MISSION1GATE')));
  for (let i = 0; i < 12; i++) { await sleep(700); gst = await page.evaluate(() => window.CDS_SIM.state()); if (gst.gates.some(g => g.open > 0.8)) break; }
  ok('gate slides open (800cm Doors.txt travel)', (gst.gates || []).some(g => g.name === 'MISSION1GATE' && g.open > 0.8), JSON.stringify((gst.gates || []).filter(g => g.name === 'MISSION1GATE')));
  // driving the fuel truck (enterable VStat vehicle)
  const drv = await page.evaluate(() => window.CDS_SIM.enterVehicle());
  ok('enter a vehicle', !!drv, String(drv));
  const vBefore = (await page.evaluate(() => window.CDS_SIM.state())).vehicles.find(v => v.model === drv);
  await page.evaluate(() => window.CDS_SIM.key('KeyW', true));
  await sleep(9000);
  await page.evaluate(() => window.CDS_SIM.key('KeyW', false));
  const stD = await page.evaluate(() => window.CDS_SIM.state());
  const vAfter = stD.vehicles.find(v => v.model === drv);
  ok('vehicle drives (state machine MOVING)', !!vAfter && Math.hypot(vAfter.pos[0] - vBefore.pos[0], vAfter.pos[2] - vBefore.pos[2]) > 1.5,
    `${vBefore && vBefore.pos} -> ${vAfter && vAfter.pos} ${vAfter && vAfter.state}`);
  await page.evaluate(() => window.CDS_SIM.exitVehicle());
  ok('exit vehicle', true, '');
  await page.screenshot({ path: '/tmp/snap/p5_m1veh.png' });
  await quitToMain();
} else if (mode === 'train') {
  for (let t = 0; t < 3; t++) {
    const id = 'training' + (t + 1);
    const st = await deployMission(id, async () => page.evaluate(i => window.CDS_FE.briefT(i), t));
    ok(`${id} boots`, !!(st && st.playing && st.mission === id), st ? `enemies=${st.enemies.total} squad=${st.squad.length}` : 'no sim');
    ok(`${id} hostile count = placements (0)`, !!st && st.enemies.total === expectedHostiles(id), st && String(st.enemies.total));
    if (t === 0) await page.screenshot({ path: '/tmp/snap/p5_training1.png' });
    await quitToMain();
  }
} else {
  const from = parseInt(mode, 10) || 0;
  const to = process.argv[3] ? parseInt(process.argv[3], 10) : 14;
  for (let i = from; i <= to; i++) {
    const id = SP[i];
    const st = await deployMission(id, async () => page.evaluate(j => window.CDS_FE.brief(j), i));
    ok(`${id} boots in the sim`, !!(st && st.playing && st.mission === id), st ? `screen-sim=${st.mission}` : 'no sim state');
    ok(`${id} hostile count = placements (${expectedHostiles(id)})`, !!st && st.enemies.total === expectedHostiles(id), st && `sim=${st.enemies.total}`);
    ok(`${id} squad deploys (>=3)`, !!st && st.squad.length >= 3, st && `squad=${st.squad.length}`);
    if (id === 'mission2' || id === 'mission7') { await sleep(2500); await page.screenshot({ path: `/tmp/snap/p5_${id}.png` }); }
    await quitToMain();
  }
}
ok('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
await browser.close();
console.log(`p5probe[${mode}]: ${PASS} pass, ${FAIL} fail`);
process.exit(FAIL ? 1 : 0);
