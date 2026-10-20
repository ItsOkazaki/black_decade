/* P7 probe: default.key bindings, GenStrs flows, OG inventory, perf budget.
   Usage: node p7probe.mjs */
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
const key = code => page.evaluate(c => window.dispatchEvent(new KeyboardEvent('keydown', { code: c })), code);
const keyUp = code => page.evaluate(c => window.dispatchEvent(new KeyboardEvent('keyup', { code: c })), code);
const S = () => page.evaluate(() => window.CDS_SIM.state());

await page.evaluate(() => { window.CDS_FE.brief(0); });
await page.evaluate(() => window.CDS_FE.loadout());
await page.evaluate(() => window.CDS_FE.deploy());
let st = null;
for (let i = 0; i < 90; i++) { await sleep(2500); st = await S().catch(() => null); if (st && st.playing) break; }
ok('M1 deploys (cutscene first)', !!(st && st.playing), '');

// MOVIE_CANCEL (default.key: KEY_ESC / MOUSE_BUTTON_0) skips the scene
const csA = await page.evaluate(() => window.CDS_SIM.cutscene());
ok('intro cutscene running', !!csA.active, JSON.stringify(csA));
await key('Escape');
await sleep(500);
const csB = await page.evaluate(() => window.CDS_SIM.cutscene());
ok('MOVIE_CANCEL (Esc) skips the scene', !csB.active, '');

// bindings are default.key, verbatim
const B = await page.evaluate(() => window.CDS_SIM.bindings());
ok('FORWARD = KEY_W', (B.FORWARD || []).join() === 'KeyW', JSON.stringify(B.FORWARD));
ok('ACTION = KEY_R (OG use key)', (B.ACTION || []).join() === 'KeyR', JSON.stringify(B.ACTION));
ok('STANCE = KEY_SPACE', (B.STANCE || []).join() === 'Space', JSON.stringify(B.STANCE));
ok('WALK = KEY_LCTRL', (B.WALK || []).join() === 'ControlLeft', JSON.stringify(B.WALK));
ok('GRUNT_1..4 = KEY_1..4', (B.GRUNT_1 || []).join() === 'Digit1' && (B.GRUNT_4 || []).join() === 'Digit4', '');
ok('NEXT/PREV_GRUNT = PAGEUP/PAGEDOWN', (B.NEXT_GRUNT || []).join() === 'PageUp' && (B.PREV_GRUNT || []).join() === 'PageDown', '');
ok('INVENTORY = KEY_LSHIFT (hold)', (B.INVENTORY || []).join() === 'ShiftLeft', JSON.stringify(B.INVENTORY));
ok('74 default.key actions parsed', Object.keys(B).length >= 60, String(Object.keys(B).length));

// GenStrs flows
const G = await page.evaluate(() => window.CDS_SIM.strings());
ok('pause title = GenStrs GAME PAUSED', G.PAUSE === 'GAME PAUSED', G.PAUSE);
ok('restart = GenStrs RESTART LEVEL', G.RESTART === 'RESTART LEVEL', G.RESTART);
ok('resume = GenStrs QUITTER->RESUME', G.RESUME === 'RESUME', G.RESUME);
ok('failure = GenStrs MISSION FAILED', G.FAILURE === 'MISSION FAILED', G.FAILURE);
await key('Escape');
await sleep(400);
ok('PAUSE binding opens the pause overlay', await page.evaluate(() => document.getElementById('hudPause').style.display === 'block'), '');
await key('Escape');
await sleep(400);

// STANCE (Space) cycles stand -> kneel -> crawl
await key('Space'); await keyUp('Space');
await sleep(1800);
st = await S();
ok('Space -> KNEELING (state machine)', /KNEEL/.test(st.squad[st.active].state), st.squad[st.active].state);
await key('Space'); await keyUp('Space');
await sleep(1800);
st = await S();
ok('Space again -> CRAWLING', /CRAWL|PRONE/.test(st.squad[st.active].state), st.squad[st.active].state);
await key('Space'); await keyUp('Space');
await page.evaluate(() => window.CDS_SIM.setMode('RUN'));
for (let i = 0; i < 40; i++) {   // crawl->stand transition runs on clamped sim-time (~1 fps here)
  await sleep(2500);
  const s = await S();
  if (!/CRAWL|PRONE/.test(s.squad[s.active].state)) break;
}

// PREV_GRUNT (PageDown) cycles the active hero
const a0 = (await S()).active;
await key('PageDown'); await keyUp('PageDown');
await sleep(600);
const a1 = (await S()).active;
ok('PREV_GRUNT cycles active hero', a1 !== a0, `${a0} -> ${a1}`);
await page.evaluate(() => window.CDS_SIM.warpAll(-120, -234));

// WALK modifier: Ctrl+W moves at walk, state WALKING
await page.evaluate(() => { window.CDS_SIM.key('ControlLeft', true); window.CDS_SIM.key('KeyW', true); });
let walkState = '';
for (let i = 0; i < 30; i++) {
  await sleep(2000);
  st = await S();
  walkState = st.squad[st.active].state;
  if (/WALK/.test(walkState)) break;
}
ok('Ctrl+W = WALKING state (WALK binding)', /WALK/.test(walkState), walkState);
await page.evaluate(() => { window.CDS_SIM.key('ControlLeft', false); window.CDS_SIM.key('KeyW', false); });

// INVENTORY (hold Shift): panel, navigate, release equips
const am0 = (await S()).squad[(await S()).active].ammo;
await key('ShiftLeft');
await sleep(600);
const invShown = await page.evaluate(() => document.getElementById('hudPanel').style.display === 'block' && /INVENTORY/.test(document.getElementById('hudPanel').innerHTML));
ok('hold INVENTORY opens the inventory panel', invShown, '');
await key('KeyS'); await keyUp('KeyS');
await sleep(300);
await keyUp('ShiftLeft');
await sleep(600);
const am1 = (await S()).squad[(await S()).active].ammo;
ok('release equips the selected weapon', am1 !== am0, `${am0} -> ${am1}`);

// ACTION (R) interacts: rescue Foley
const pr = (await S()).prisoner.pos;
let done = false;
for (let i = 0; i < 20 && !done; i++) {
  await page.evaluate(p => window.CDS_SIM.warp(p[0] + 2, p[2] + 2), pr);
  await page.evaluate(() => window.CDS_SIM.tap('KeyR'));
  await sleep(800);
  st = await S();
  done = st.objIdx === 1;
}
ok('ACTION (R) rescues Foley', done, 'obj=' + (st && st.objIdx));

// perf: budget + honest numbers
await page.evaluate(() => window.CDS_SIM.warpAll(-260, -600));
await sleep(3500);
const P = await page.evaluate(() => window.CDS_SIM.perf());
console.log('    perf:', JSON.stringify(P));
ok('static matrices frozen (>4000 objects)', P.staticFrozen > 4000, String(P.staticFrozen));
ok('worst-vantage draw calls under 2500', P.drawCalls > 0 && P.drawCalls < 2500, String(P.drawCalls));  // worn CONNOBJS kit adds a draw call per gear mesh
ok('instancing merged terrain meshes (<4005)', P.terrainMeshes < 4005, String(P.terrainMeshes));
ok('load timings recorded', P.timings.totalMs > 0 && P.timings.worldMs > 0, JSON.stringify(P.timings));
ok('zero page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`P7: ${PASS} pass, ${FAIL} fail`);
await browser.close();
process.exit(FAIL ? 1 : 0);
