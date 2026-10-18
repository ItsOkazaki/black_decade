// BLACK DECADE — state-assertion tests for the v64 bug round.
// SwiftShader runs game-time far slower than wall-clock, so every wait
// POLLS the game's own state (window.BD_TEST) instead of sleeping.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const LIBS = '/tmp/snap/libs';
const BASE = 'http://127.0.0.1:5175/';
const OUT = '/tmp/snap/shots3'; fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
function check(name, ok, extra = '') { results.push([name, ok]); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')); }

const browser = await puppeteer.launch({
  executablePath: '/tmp/chromium', headless: 'new',
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
await page.mouse.click(640, 400); // skip cutscene
const S = () => page.evaluate(() => window.BD_TEST.state());
async function until(pred, timeoutS, label) {
  const end = Date.now() + timeoutS * 1000;
  let st = await S();
  while (!pred(st) && Date.now() < end) { await sleep(2000); st = await S(); }
  if (!pred(st)) console.log('  (timeout waiting: ' + label + ')');
  return st;
}
let st = await until(s => s.playing, 30, 'playing');
check('game playing after deploy+skip', st.playing === true, JSON.stringify(st.pos));
check('M1: nobody carries C4 at start', st.hasC4 === false);
check('pickups placed in world', st.pickups.length >= 5, st.pickups.length + ' pickups');
check('armour (BMP) present', !!st.armor && st.armor.alive, st.armor ? 'hp ' + st.armor.hp : 'none');

// falling FIRST (quiet spawn area, before any gunfire draws attention)
await page.evaluate(() => window.BD_TEST.drop(9));
st = await until(s => !s.airborne && s.hp < 100, 90, 'fall landing');
check('fall off a height: gravity lands you, damage scales, survivable', st.hp < 100 && st.hp > 0 && !st.airborne, `hp ${st.hp}`);

// medkit pickup (real keyboard E) + flash
const mk = st.pickups.find(p => p.t === 'medkit');
await page.evaluate(p => window.BD_TEST.teleport(p.x + 0.8, p.z), mk);
await sleep(600);
await page.keyboard.press('KeyE');
st = await until(s => s.pickups.some(p => p.t === 'medkit' && p.x === mk.x && p.taken), 20, 'medkit taken');
check('medkit pickup taken with E', st.pickups.some(p => p.t === 'medkit' && p.x === mk.x && p.taken));
const flash = await page.evaluate(() => document.getElementById('itemFlashTxt').textContent + '|' + document.getElementById('itemFlash').className);
check('pickup flash fired (OG item banner)', flash.includes('MEDI KIT'), flash);

// C4 pickup -> becomes carried
const c4 = st.pickups.find(p => p.t === 'c4');
if (c4) {
  await page.evaluate(p => window.BD_TEST.teleport(p.x + 0.8, p.z), c4);
  await sleep(600);
  await page.keyboard.press('KeyE');
  st = await until(s => s.hasC4, 20, 'c4 carried');
  check('C4 recovered via pickup (not pre-carried)', st.hasC4 === true);
} else check('C4 pickup exists in world', false);

// tank patrol movement (poll up to 2 min of wall time)
const a0 = (await S()).armor;
st = await until(s => Math.hypot(s.armor.x - a0.x, s.armor.z - a0.z) > 1.5, 120, 'tank patrol');
check('tank moves on patrol', Math.hypot(st.armor.x - a0.x, st.armor.z - a0.z) > 1.5,
  `moved ${Math.hypot(st.armor.x - a0.x, st.armor.z - a0.z).toFixed(1)}m`);

// finite ammo: fire, then reload drains reserve exactly
await page.evaluate(() => window.BD_TEST.select('M16A2'));
await sleep(300);
const b4 = await S();
await page.evaluate(() => window.BD_TEST.aim(true));
st = await until(s => s.ammo <= b4.ammo - 3, 60, 'firing spends mag');
await page.evaluate(() => window.BD_TEST.aim(false));
check('firing spends magazine', st.ammo <= b4.ammo - 3, `${b4.ammo} -> ${st.ammo}`);
const firedAmmo = (await S()).ammo, res0 = (await S()).slot.reserve;
await page.evaluate(() => window.BD_TEST.reload());
st = await until(s => s.ammo === 30, 60, 'reload completes');
check('reload refills mag from reserve (finite ammo)', st.ammo === 30 && st.slot.reserve === res0 - (30 - firedAmmo),
  `ammo ${st.ammo}, reserve ${res0} -> ${st.slot.reserve}`);

// guard shoots from his post instead of charging (try a few sentries)
{
  let ok = false, note = 'no enemy engaged';
  const es = (await S()).enemies.slice(0, 8);
  for (const e of es) {
    await page.evaluate(e2 => window.BD_TEST.teleport(e2.x + 4, e2.z + 24), e);
    const s2 = await until(s => s.enemies.some(en => en.st === 'engage'), 30, 'guard engage');
    const en = s2.enemies.filter(x => x.st === 'engage').sort((a, b) => a.d - b.d)[0];
    if (!en) continue;
    const p0 = { x: en.x, z: en.z };
    await sleep(15000);
    const s3 = await S();
    if (!s3.playing) { note = 'player died during guard test'; break; }
    const en2 = s3.enemies.filter(x => x.st === 'engage').sort((a, b) => Math.hypot(a.x - p0.x, a.z - p0.z) - Math.hypot(b.x - p0.x, b.z - p0.z))[0];
    const drift = en2 ? Math.hypot(en2.x - p0.x, en2.z - p0.z) : 99;
    note = `engaged guard drifted ${drift.toFixed(1)}m in 15 s`;
    ok = drift < 8;
    break;
  }
  check('guard shoots from post (no downhill charge)', ok, note);
}

// LAW sight + rocket kills armour: 2 rockets (hp 900, 340/hit -> need 3; check damage at least)
await page.evaluate(() => window.BD_TEST.give('LAW66'));
await sleep(300);
st = await S();
await page.evaluate(a => window.BD_TEST.teleport(a.x + 20, a.z + 2), st.armor);   // on the gorge road, clean line to the tank
await sleep(500);
await page.evaluate(a => { window.BD_TEST.facePlayer(a.x, a.z); window.BD_TEST.pitch(0.03); window.BD_TEST.look(true); }, (await S()).armor);
{ // wait until the third-person camera has actually swung onto the target
  const tgt = (await S()).armor, pl = (await S()).pos;
  const L = Math.hypot(tgt.x - pl[0], tgt.z - pl[2]);
  const ex = (tgt.x - pl[0]) / L, ez = (tgt.z - pl[2]) / L;
  const end = Date.now() + 90000;
  while (Date.now() < end) {
    const c = await page.evaluate(() => window.BD_TEST.camDir());
    if (Math.abs(c.dir[0] - ex) < 0.04 && Math.abs(c.dir[2] - ez) < 0.04) break;
    await sleep(1500);
  }
}
const hp0 = (await S()).armor.hp;
await page.evaluate(() => window.BD_TEST.aim(true));
await sleep(400);
const sight = await page.evaluate(() => document.getElementById('lawSight').style.display);
check('LAW fullscreen sight shows while aiming', sight === 'block', sight);
await page.screenshot({ path: OUT + '/01-law-sight.png' });
st = await until(s => s.armor.hp < hp0, 90, 'rocket hits tank');
await page.evaluate(() => window.BD_TEST.aim(false));
check('rocket damages the tank', st.armor.hp < hp0, `hp ${hp0} -> ${st.armor.hp}`);
await page.screenshot({ path: OUT + '/02-tank-hit.png' });

// death -> KIA restart screen (not the briefing)
await page.evaluate(() => window.BD_TEST.hurt(9999));
st = await until(s => s.kia === 'flex', 20, 'kia screen');
check('death shows KIA restart screen', st.kia === 'flex', `kia=${st.kia}`);
await page.screenshot({ path: OUT + '/03-kia.png' });

// restart mission -> fresh state (ammo/HP reset)
await page.goto(BASE + 'play.html?m=mission1&redeploy=1', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.__playLoaded === true, { timeout: 240000, polling: 2000 }).catch(() => {});
st = await until(s => s.playing && s.hp === 100, 40, 'redeploy fresh');
check('restart mission: fresh HP + full mag', st.playing === true && st.hp === 100 && st.ammo === 30, `hp ${st.hp} ammo ${st.ammo}`);
await page.screenshot({ path: OUT + '/04-redeployed.png' });

// bridge: cross ON the deck, and pass UNDER it in the gorge (refY ground fix)
await page.evaluate(() => window.BD_TEST.hurt(-100000)); // guards can't stop the walk test
await page.evaluate(() => window.BD_TEST.teleport(-225.9, -468));
await sleep(600);
const deckY = (await S()).pos[1];
await page.evaluate(() => { window.BD_TEST.facePlayer(-225.9, -560); window.BD_TEST.key('KeyW', true); });
st = await until(s => s.pos[2] < -474, 60, 'bridge cross');
await page.evaluate(() => window.BD_TEST.key('KeyW', false));
check('bridge deck is crossable (no invisible wall)', st.pos[2] < -474 && Math.abs(st.pos[1] - deckY) < 1.5, JSON.stringify(st.pos));
await page.evaluate(() => window.BD_TEST.teleport(-208, -490));
await sleep(600);
await page.evaluate(() => { window.BD_TEST.facePlayer(-245, -490); window.BD_TEST.key('KeyW', true); });
st = await until(s => s.pos[0] < -215, 60, 'under bridge');
await page.evaluate(() => window.BD_TEST.key('KeyW', false));
check('gorge under the bridge stays on the floor (no snap-up)', st.pos[0] < -215 && st.pos[1] < 0, JSON.stringify(st.pos));

const fails = results.filter(r => !r[1]);
console.log('\n== ' + (results.length - fails.length) + '/' + results.length + ' passed; page errors: ' + errs.length);
errs.slice(0, 6).forEach(e => console.log(e));
await browser.close();
process.exit(fails.length ? 1 : 0);
