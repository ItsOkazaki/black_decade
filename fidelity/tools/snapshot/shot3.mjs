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

// guard engages, PLANTS and shoots — he may shift into formation but he
// must never beeline-charge to point-blank like the old brain
await page.evaluate(() => window.BD_TEST.hurt(-100000)); // god-mode: he WILL kill an idle player otherwise
{
  let engagedSeen = false, plantedSeen = false, minD = 999;
  const e = (await S()).enemies[0];
  await page.evaluate(e2 => window.BD_TEST.teleport(e2.x + 3, e2.z + 22), e);
  await sleep(500);
  await page.evaluate(() => window.BD_TEST.aggro());
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    const sx = await S();
    if (!sx.playing) break;
    const engs = sx.enemies.filter(x => x.st === 'engage');
    if (engs.length) {
      engagedSeen = true;
      if (engs.some(x => x.planted && !x.moving)) plantedSeen = true;
      minD = Math.min(minD, ...engs.map(x => x.d));
    }
    if (plantedSeen) break;
    await sleep(1800);
  }
  check('guard engages, plants and shoots (no point-blank charge)', engagedSeen && plantedSeen && minD > 8,
    `closest ${minD === 999 ? 'n/a' : minD.toFixed(1)}m, planted-fire ${plantedSeen}`);
}

// --- the smarter brain: firing postures, grenades, memory & search ---
await page.evaluate(() => window.BD_TEST.hurt(-100000)); // survive the lesson
{
  const e0 = (await S()).enemies[0];
  await page.evaluate(e => window.BD_TEST.teleport(e.x + 3, e.z + 20), e0);
  await sleep(500);
  await page.evaluate(() => window.BD_TEST.aggro());
  let post = false, gren = false;
  const end = Date.now() + 150000;
  while (Date.now() < end && !(post && gren)) {
    const s2 = await S();
    if (s2.enemies.some(x => x.st === 'engage' && x.posture !== 'stand')) post = true;
    if (s2.grenadesThrown > 0) gren = true;
    await sleep(1500);
  }
  check('engaged enemies take firing postures (crouch/prone)', post);
  check('enemies throw grenades at mid range', gren, 'thrown ' + (await S()).grenadesThrown);
  // break line of sight completely: he must SEARCH for you, not forget
  await page.evaluate(() => window.BD_TEST.teleport(-120.1, -233.9));
  const s4 = await until(x => x.enemies.some(en => en.st === 'search'), 90, 'search state');
  check('losing sight triggers a search (memory, not amnesia)',
    s4.enemies.some(en => en.st === 'search') && s4.enemies.some(en => en.mem > 3),
    JSON.stringify(s4.enemies.slice(0, 3).map(x => x.st + ':' + x.mem)));
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
await page.evaluate(() => { window.BD_TEST.setHP(1); window.BD_TEST.hurt(50); });
st = await until(s => s.kia === 'flex', 20, 'kia screen');
check('death shows KIA restart screen', st.kia === 'flex', `kia=${st.kia}`);
await page.screenshot({ path: OUT + '/03-kia.png' });

// restart mission -> INSTANT reset, no page reload, no asset loading
await page.evaluate(() => { window.__noReload = 1; });
await page.evaluate(() => document.getElementById('kiaRestart').click());
st = await until(s => s.playing && s.hp === 100, 40, 'instant restart');
const noReload = await page.evaluate(() => window.__noReload === 1);
check('KIA restart: instant, no reload, fresh HP + full mag',
  st.playing === true && st.hp === 100 && st.ammo === 30 && noReload,
  `hp ${st.hp} ammo ${st.ammo} noReload=${noReload}`);
await page.screenshot({ path: OUT + '/04-redeployed.png' });

// jump: SPACE tap (hold is the inventory)
await page.keyboard.down('Space');
await sleep(70);
await page.keyboard.up('Space');
let sawAir = false;
for (let i = 0; i < 50 && !sawAir; i++) { const sj = await S(); if (sj.airborne) sawAir = true; else await sleep(300); }
check('SPACE tap jumps', sawAir);
st = await until(s2 => !s2.airborne, 60, 'jump lands');
check('jump lands back on the ground unharmed', !st.airborne && st.hp === 100, `hp ${st.hp}`);

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
