// probe21 — v68 mission1: C4 order-independence, solid walls, grenade boom FX.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const LIBS = '/tmp/snap/libs';
const BASE = 'http://127.0.0.1:5175/';
fs.mkdirSync('/tmp/snap/shots21', { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
function check(name, ok, extra = '') { results.push([name, ok]); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')); }
const browser = await puppeteer.launch({
  
  protocolTimeout: 1200000,executablePath: '/tmp/chromium', headless: 'new',
  env: { ...process.env, LD_LIBRARY_PATH: LIBS },
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio', '--window-size=1280,800'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const errs = [];
page.on('pageerror', e => errs.push('PAGE: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('CON: ' + m.text().slice(0, 160)); });
await page.goto(BASE + 'play.html?m=mission1', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.__playLoaded === true, { timeout: 240000, polling: 2000 }).catch(() => {});
await page.evaluate(() => document.getElementById('deployGo').click());
await sleep(600);
await page.mouse.click(640, 400);
const S = () => page.evaluate(() => window.BD_TEST.state());
async function until(pred, timeoutS, label) {
  const end = Date.now() + timeoutS * 1000;
  let st = await S();
  while (!pred(st) && Date.now() < end) { await sleep(2000); st = await S(); }
  if (!pred(st)) console.log('  (timeout waiting: ' + label + ')');
  return st;
}
let st = await until(s => s.playing, 30, 'playing');
check('mission1 playing', st.playing === true, JSON.stringify(st.pos));
await page.evaluate(() => window.BD_TEST.hurt(-100000)); // god-mode: probes must not die mid-step

// 1. walls were harvested from the world geometry
check('wall segments built from zone geometry', st.walls > 500, st.walls + ' segments');

// 2. behavioural: a wall actually stops the player. Find a wall cell near the
//    garage block, walk at it from outside, and confirm he cannot cross.
const wallPt = await page.evaluate(() => {
  for (let x = -245; x <= -195; x += 1) for (let z = -470; z <= -428; z += 1)
    if (window.BD_TEST.wallAt(x, z)) return { x, z };
  return null;
});
check('found a solid wall near the garage block', !!wallPt, wallPt ? wallPt.x + ',' + wallPt.z : 'none');
if (wallPt) {
  let blocked = false, travelOpen = 0;
  for (const [ox, oz] of [[0, 3.2], [0, -3.2], [3.2, 0], [-3.2, 0]]) {
    await page.evaluate(([x, z]) => window.BD_TEST.teleport(x, z), [wallPt.x + ox, wallPt.z + oz]);
    await sleep(300);
    const before = (await S()).pos;
    await page.evaluate(([x, z]) => window.BD_TEST.facePlayer(x, z), [wallPt.x, wallPt.z]);
    await page.keyboard.down('KeyW');
    await sleep(1600);
    await page.keyboard.up('KeyW');
    const after = (await S()).pos;
    const distToWall = Math.hypot(after[0] - wallPt.x, after[2] - wallPt.z);
    const moved = Math.hypot(after[0] - before[0], after[2] - before[2]);
    if (distToWall > 0.45 && moved > 0.3) { blocked = true; break; }
    if (moved > 2.2) travelOpen = moved;
  }
  check('player cannot walk through the wall', blocked);
  // control: same walk along the flat bridge deck travels freely (the deck
  // runs north-south; poll, because game-time runs slow under SwiftShader)
  await page.evaluate(() => window.BD_TEST.teleport(-225.9, -488.2));
  await sleep(300);
  const b2 = (await S()).pos;
  await page.evaluate(() => { window.BD_TEST.facePlayer(-225.9, -560); window.BD_TEST.key('KeyW', true); });
  const cst = await until(s => Math.hypot(s.pos[0] - b2[0], s.pos[2] - b2[2]) > 2, 40, 'deck walk travel');
  await page.evaluate(() => window.BD_TEST.key('KeyW', false));
  const a2 = cst.pos;
  check('open-ground walk still travels (control)', Math.hypot(a2[0] - b2[0], a2[2] - b2[2]) > 1.6, 'moved ' + Math.hypot(a2[0] - b2[0], a2[2] - b2[2]).toFixed(1) + ' m');
}

// 3. C4 BEFORE rescue must not deadlock the chain: give C4, then rescue ZIANI,
//    and the chain must land on PLANT (objIdx 2), not strand on RECOVER.
await page.evaluate(() => window.BD_TEST.giveItem('C4', 1));
await page.evaluate(() => window.BD_TEST.teleport(-58.9, -593.5)); // the prisoner
st = await until(s => s.objIdx >= 1, 40, 'rescue registers');
check('rescue registers with C4 already in hand', st.objIdx >= 1, 'objIdx=' + st.objIdx);
check('chain skips RECOVER and goes straight to PLANT', st.objIdx === 2, 'objIdx=' + st.objIdx);

// 4. plant at the bridge struts with E, detonation advances the chain
await page.evaluate(() => window.BD_TEST.teleport(-225.9, -488.2));
await sleep(500);
await page.keyboard.press('KeyE');
st = await until(s => s.objIdx >= 3, 60, 'C4 planted + detonated');
check('C4 plants at the bridge and detonates (objIdx 3)', st.objIdx >= 3, 'objIdx=' + st.objIdx);
check('explosion registered (boom timestamp)', st.boomAt > 0, 'boomAt=' + st.boomAt);

// 5. enemy grenade = real explosion: dig in 18 m from a real guard and wait
await page.evaluate(() => window.BD_TEST.setHP(5000));
const boom0 = (await S()).boomAt;
st = await S();
const g = st.enemies.slice().sort((a, b) => a.d - b.d)[0];
await page.evaluate(([x, z]) => window.BD_TEST.teleport(x, z), [g.x + 17, g.z + 4]);
await page.evaluate(() => window.BD_TEST.aggro());
st = await until(s => s.boomAt > boom0, 120, 'enemy grenade detonates');
check('enemy grenade detonates with explosion FX hook', st.boomAt > boom0, 'boomAt ' + boom0 + ' -> ' + st.boomAt);
check('enemy voices heard during the fight', st.voicePlays > 0, 'voicePlays=' + st.voicePlays);

const fails = results.filter(r => !r[1]).length;
console.log('PROBE21: ' + (results.length - fails) + '/' + results.length + ' PASS; page errors: ' + errs.length);
errs.slice(0, 5).forEach(e => console.log('  ERR ' + e));
await browser.close();
process.exit(fails || errs.length ? 1 : 0);
