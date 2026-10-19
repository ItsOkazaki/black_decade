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
  // stage a MOBILE guard for the memory test (posted sentries stay by design)
  { const mob = (await S()).enemies.find(x => !x.hold && x.d > 30);
    if (mob) { await page.evaluate(m => window.BD_TEST.teleport(m.x + 16, m.z + 6), mob); await sleep(500); await page.evaluate(() => window.BD_TEST.aggro()); await sleep(1200); } }
  // break line of sight completely: he must SEARCH for you, not forget
  await page.evaluate(() => window.BD_TEST.teleport(-120.1, -233.9));
  const s4 = await until(x => x.enemies.some(en => en.st === 'search'), 90, 'search state');
  check('losing sight triggers a search (memory, not amnesia)',
    s4.enemies.some(en => en.st === 'search') && s4.enemies.some(en => en.mem > 3),
    JSON.stringify(s4.enemies.slice(0, 3).map(x => x.st + ':' + x.mem)));
}

// ---- v66: posted sentries, death anims, routing, cliffs ----
{
  const st2 = await S();
  const tw = st2.enemies.reduce((a, b) => Math.hypot(b.x + 237.8, b.z + 439.3) < Math.hypot(a.x + 237.8, a.z + 439.3) ? b : a, st2.enemies[0]);
  check('tower guard spawns at tower platform level, not on the roof', tw.y > 13.5 && tw.y < 17.5, 'y=' + tw.y);
}
await page.evaluate(() => window.BD_TEST.hurt(-100000));
await page.evaluate(() => window.BD_TEST.teleport(-237.8, -400));
await sleep(500);
{
  const st0 = await S();
  const tw0 = st0.enemies.reduce((a, b) => Math.hypot(b.x + 237.8, b.z + 439.3) < Math.hypot(a.x + 237.8, a.z + 439.3) ? b : a, st0.enemies[0]);
  const home = [tw0.x, tw0.z];
  await page.evaluate(() => window.BD_TEST.aggro());
  let engaged = false, maxDrift = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) {
    const sx = await S();
    const tw = sx.enemies.reduce((a, b) => Math.hypot(b.x + 237.8, b.z + 439.3) < Math.hypot(a.x + 237.8, a.z + 439.3) ? b : a, sx.enemies[0]);
    if (tw.st === 'engage') engaged = true;
    maxDrift = Math.max(maxDrift, Math.hypot(tw.x - home[0], tw.z - home[1]));
    if (maxDrift > 2.5) break;   // he left the post: fail fast
    if (engaged && Date.now() - t0 > 60000) break;
    await sleep(1800);
  }
  check('posted sentry engages the player from his post', engaged);
  check('posted sentry HOLDS his post (no descent/charge)', maxDrift < 2.5, 'max drift ' + maxDrift.toFixed(1) + 'm');
}
{
  const r = await page.evaluate(() => window.BD_TEST.slay());
  await sleep(600);
  const st2 = await S();
  check('killed enemy plays a DEATH animation (corpse not just frozen)', !!r && /DEATH/.test(r.anim || '') && st2.corpses.length >= 1,
    JSON.stringify(r) + ' corpses=' + st2.corpses.length);
}
// routing: seen far away, the guard travels to the last-seen point to search
{
  let reached = false, tries = 0, detail = '';
  while (!reached && tries < 3) {
    tries++;
    const st0 = await S();
    const cand = st0.enemies.filter(e2 => !e2.hold && e2.d > 100 && e2.d < 190)[0] || st0.enemies.filter(e2 => !e2.hold)[0];
    if (!cand) break;
    const home = [cand.x, cand.z];
    await page.evaluate(c => window.BD_TEST.teleport(c[0] + 22, c[1]), home);
    await sleep(400);
    await page.evaluate(() => window.BD_TEST.aggro());
    await sleep(1200);
    await page.evaluate(() => window.BD_TEST.teleport(-120.1, -233.9));
    const end = Date.now() + 100000;
    while (Date.now() < end && !reached) {
      const sx = await S();
      const g = sx.enemies.reduce((a, b) => Math.hypot(b.x - home[0], b.z - home[1]) < Math.hypot(a.x - home[0], a.z - home[1]) ? b : a, sx.enemies[0]);
      detail = 'st=' + g.st + ' ls=' + JSON.stringify(g.ls) + ' pos=' + g.x + ',' + g.z;
      if (g.ls && Math.hypot(g.x - g.ls[0], g.z - g.ls[1]) < 16) reached = true;   // the sweep itself ranges ~13 m around lastSeen
      if (g.st === 'patrol' && Math.hypot(g.x - home[0], g.z - home[1]) < 5) break;
      await sleep(2500);
    }
  }
  check('enemy travels to last-seen point and searches (routes, persistent memory)', reached, detail);
}
// cliff: walk off the plateau edge — must end on the gorge floor, never mid-face
{
  await page.evaluate(() => window.BD_TEST.hurt(-100000)); // guards can't stop the walk test
  await page.evaluate(() => window.BD_TEST.teleport(-237.8, -439.3));   // the gate watchtower platform
  await sleep(700);
  const y0 = (await S()).pos[1];
  // walk off the tower platform edge: must fall and land on the ground below
  await page.evaluate(() => { window.BD_TEST.facePlayer(-237.8, -470); window.BD_TEST.key('KeyW', true); });
  const st3 = await until(s => !s.airborne && s.pos[1] < y0 - 4, 130, 'walk off the plateau');
  await page.evaluate(() => window.BD_TEST.key('KeyW', false));
  check('walking off a cliff lands on real ground below (never stands mid-face)',
    !st3.airborne && st3.pos[1] < y0 - 4, `y ${y0} -> ${st3.pos[1]}, air=${st3.airborne}`);
}

// LAW sight + rocket vs armour: servo the aim onto the (patrolling) tank and
// fire; the LAW is single-shot, so re-give and re-aim between attempts
await page.evaluate(() => window.BD_TEST.give('LAW66'));
await sleep(300);
async function aimAtTank() {
  const tgt = (await S()).armor, pl = (await S()).pos;
  const dx = tgt.x - pl[0], dy = (tgt.y + 1.1) - (pl[1] + 1.45), dz = tgt.z - pl[2];
  const L3 = Math.hypot(dx, dy, dz);
  const want = [dx / L3, dy / L3, dz / L3];
  await page.evaluate(a => { window.BD_TEST.facePlayer(a.x, a.z); window.BD_TEST.look(true); }, tgt);
  let bestP = 0, bestE = 9;
  for (const p of [-1.05, -0.8, -0.55, -0.35, -0.18, -0.05, 0.08, 0.22, 0.4]) {
    await page.evaluate(v => window.BD_TEST.pitch(v), p);
    await sleep(450);
    const c = await page.evaluate(() => window.BD_TEST.camDir());
    const err = Math.hypot(c.dir[0] - want[0], c.dir[1] - want[1], c.dir[2] - want[2]);
    if (err < bestE) { bestE = err; bestP = p; }
  }
  // refine: track the patrolling tank (re-face + recompute) while the
  // camera settles at the chosen pitch, then verify
  await page.evaluate(v => window.BD_TEST.pitch(v), bestP);
  for (let i = 0; i < 16; i++) {
    await sleep(700);
    const t2 = (await S()).armor, p2 = (await S()).pos;
    const ddx = t2.x - p2[0], ddy = (t2.y + 1.1) - (p2[1] + 1.45), ddz = t2.z - p2[2];
    const LL = Math.hypot(ddx, ddy, ddz);
    await page.evaluate(a => window.BD_TEST.facePlayer(a.x, a.z), t2);
    const c = await page.evaluate(() => window.BD_TEST.camDir());
    const err = Math.hypot(c.dir[0] - ddx / LL, c.dir[1] - ddy / LL, c.dir[2] - ddz / LL);
    if (err < 0.055) { console.log('  (aim locked err ' + err.toFixed(3) + ')'); return true; }
  }
  console.log('  (aim never locked; firing anyway)');
  return false;
}
{
  let dmg = false;
  for (let attempt = 0; attempt < 3 && !dmg; attempt++) {
    const a = (await S()).armor;
    await page.evaluate(a2 => window.BD_TEST.teleport(a2.x + 14, a2.z + 2), a);
    await sleep(600);
    const hp0 = (await S()).armor.hp;
    await aimAtTank();
    await page.evaluate(() => window.BD_TEST.aim(true));
    await sleep(400);
    if (attempt === 0) {
      const sight = await page.evaluate(() => document.getElementById('lawSight').style.display);
      check('LAW fullscreen sight shows while aiming', sight === 'block', sight);
      await page.screenshot({ path: OUT + '/01-law-sight.png' });
    }
    await until(s => s.rockets >= 1, 20, 'rocket spawned');
    const stx = await until(s => s.armor.hp < hp0 || s.rockets === 0, 45, 'rocket flight');
    await page.evaluate(() => window.BD_TEST.aim(false));
    dmg = stx.armor.hp < hp0;
    console.log('  (attempt ' + attempt + ': hp ' + hp0 + ' -> ' + stx.armor.hp + ')');
    if (!dmg) { await page.evaluate(() => window.BD_TEST.give('LAW66')); await sleep(300); }
  }
  check('rocket damages the tank', dmg);
  await page.screenshot({ path: OUT + '/02-tank-hit.png' });
}

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

// ---- v67: kill banner gone, gate, hearing, contact, grenades, weapons ----
{
  await page.evaluate(() => window.BD_TEST.hurt(-100000));
  await page.evaluate(() => window.BD_TEST.slay());
  await sleep(1200);
  const msg = await page.evaluate(() => document.getElementById('msg').textContent + '|' + document.getElementById('csub').textContent);
  check('kill shows NO name banner in the game UI (stats only)', !/DOWN|ABU/.test(msg), JSON.stringify(msg));
}
{
  const st0 = await S();
  check('main gate exists as a working door (not baked shut)', st0.gateBuilt === true);
  check('main gate starts OPEN (as in the original)', st0.gate > 0.9, 'gate=' + st0.gate);
  await page.evaluate(() => window.BD_TEST.toggleGate());
  let st = await until(s => s.gate < 0.1, 40, 'gate closes');
  check('gate switch closes the gate', st.gate < 0.1, 'gate=' + st.gate);
  await page.evaluate(() => window.BD_TEST.toggleGate());
  st = await until(s => s.gate > 0.9, 40, 'gate reopens');
  check('gate switch reopens the gate', st.gate > 0.9, 'gate=' + st.gate);
}
// hearing: firing near a patrol wakes him (he investigates or engages — never ignores it)
{
  const st0 = await S();
  const e = st0.enemies.find(x => !x.hold && x.d > 130) || st0.enemies.find(x => !x.hold);
  const home = [e.x, e.z];
  await page.evaluate(h => window.BD_TEST.teleport(h[0] + 42, h[1] + 6), home);
  await sleep(500);
  await page.evaluate(() => window.BD_TEST.aim(true));
  await sleep(2500);
  await page.evaluate(() => window.BD_TEST.aim(false));
  let reacted = '';
  const end = Date.now() + 70000;
  while (Date.now() < end && !reacted) {
    const sx = await S();
    const g = sx.enemies.reduce((a, b) => Math.hypot(b.x - home[0], b.z - home[1]) < Math.hypot(a.x - home[0], a.z - home[1]) ? b : a, sx.enemies[0]);
    if (g.st !== 'patrol') reacted = g.st;
    await sleep(2000);
  }
  check('nearby enemy reacts to gunfire (hears it / joins the fight)', !!reacted, 'state=' + reacted);
}
// contact: when one guard engages, his squadmate comes to the fight
{
  const st0 = await S();
  const mob = st0.enemies.filter(x => !x.hold);
  let A = null, B = null, bd = 1e9;
  for (const a of mob) for (const b of mob) { if (a === b) continue; const d = Math.hypot(a.x - b.x, a.z - b.z); if (d > 10 && d < 42 && d < bd) { bd = d; A = a; B = { m: b }; } }
  if (A && B) {
    const bHome = [B.m.x, B.m.z];
    await page.evaluate(a => window.BD_TEST.teleport(a.x + 14, a.z + 10), A);
    await sleep(400);
    await page.evaluate(() => window.BD_TEST.aggro());
    let joined = '';
    const end = Date.now() + 100000;
    while (Date.now() < end && !joined) {
      const sx = await S();
      const g = sx.enemies.reduce((a2, b2) => Math.hypot(b2.x - bHome[0], b2.z - bHome[1]) < Math.hypot(a2.x - bHome[0], a2.z - bHome[1]) ? b2 : a2, sx.enemies[0]);
      if (g.st === 'search' || g.st === 'engage' || g.ls) joined = g.st;
      await sleep(2000);
    }
    check('squadmate joins a contact (does not ignore the firefight)', !!joined, 'mate state=' + joined);
  } else check('squadmate joins a contact (does not ignore the firefight)', false, 'no pair staged');
}
// smart grenades: (a) no throw at a moving visible target
{
  const st0 = await S();
  const e = st0.enemies.filter(x => !x.hold).sort((a, b) => Math.hypot(a.x + 160, a.z + 330) - Math.hypot(b.x + 160, b.z + 330))[0];
  const C = [e.x, e.z];
  await page.evaluate(c => window.BD_TEST.teleport(c[0] + 18, c[1]), C);
  await sleep(400);
  await page.evaluate(() => window.BD_TEST.aggro());
  const gr0 = (await S()).enemies.reduce((a, b) => Math.hypot(b.x - C[0], b.z - C[1]) < Math.hypot(a.x - C[0], a.z - C[1]) ? b : a, (await S()).enemies[0]).gr;
  // orbit him at 18 m, turning constantly: always moving, always in the open
  await page.evaluate(() => window.BD_TEST.key('KeyW', true));
  const end = Date.now() + 55000;
  let ang = 0;
  while (Date.now() < end) {
    ang += 1.1;
    await page.evaluate(c => window.BD_TEST.facePlayer(c[0] + Math.sin(c[2]) * 18, c[1] + Math.cos(c[2]) * 18), [C[0], C[1], ang]);
    await sleep(2500);
  }
  await page.evaluate(() => window.BD_TEST.key('KeyW', false));
  const sx2 = await S();
  const gA = sx2.enemies.reduce((a, b) => Math.hypot(b.x - C[0], b.z - C[1]) < Math.hypot(a.x - C[0], a.z - C[1]) ? b : a, sx2.enemies[0]);
  check('no grenade thrown at a moving, visible target', gA.gr === gr0, 'his grenades left: ' + gr0 + ' -> ' + gA.gr);
}
// smart grenades: (b) flush-out throw when the player ducks out of sight
{
  const st0 = await S();
  const e = st0.enemies.filter(x => !x.hold).sort((a, b) => Math.hypot(a.x + 204, a.z + 505) - Math.hypot(b.x + 204, b.z + 505))[0];
  const home = [e.x, e.z];
  const g0 = (await S()).grenadesThrown;
  await page.evaluate(h => window.BD_TEST.teleport(h[0] + 3, h[1] + 16), home);
  await sleep(400);
  await page.evaluate(() => window.BD_TEST.aggro());
  // wait until he truly SEES us, then vanish behind the guardhouse block
  const seenIt = await until(s => { const g = s.enemies.reduce((a, b) => Math.hypot(b.x - home[0], b.z - home[1]) < Math.hypot(a.x - home[0], a.z - home[1]) ? b : a, s.enemies[0]); return g.see === true; }, 60, 'enemy sees player');
  await page.evaluate(() => window.BD_TEST.teleport(-208, -527));
  let threw = false;
  const end = Date.now() + 130000;
  while (Date.now() < end && !threw) {
    const sx = await S();
    if (sx.grenadesThrown > g0) threw = true;
    await sleep(2500);
  }
  check('grenade flushes the player out of cover (thrown at last-seen)', threw, 'thrown ' + g0 + ' -> ' + (await S()).grenadesThrown);
}
// every weapon works: fires, spends, has an effect
for (const k of ['SAW', 'BARRETT', 'SIGP228', 'PSG1', 'RPG7']) {
  await page.evaluate(k2 => window.BD_TEST.give(k2), k);
  await sleep(300);
  await page.evaluate(k2 => window.BD_TEST.select(k2), k);
  await sleep(300);
  const before = (await S()).ammo;
  await page.evaluate(() => window.BD_TEST.aim(true));
  const stw = await until(s => s.ammo < before || s.rockets > 0, 50, k + ' fires');
  await page.evaluate(() => window.BD_TEST.aim(false));
  check('weapon works: ' + k + ' fires', stw.ammo < before || stw.rockets > 0, 'ammo ' + before + ' -> ' + stw.ammo + ', rockets ' + stw.rockets);
}
{
  const c0 = (await S()).corpses.length;
  const e = (await S()).enemies.filter(x => x.hold)[0] || (await S()).enemies[0];
  const home = [e.x, e.z];
  await page.evaluate(() => window.BD_TEST.give('KNIFE'));
  await page.evaluate(k2 => window.BD_TEST.select(k2), 'KNIFE');
  await page.evaluate(h => window.BD_TEST.teleport(h[0] + 1.1, h[1] + 1.1), home);
  await sleep(400);
  await page.evaluate(h => window.BD_TEST.facePlayer(h[0], h[1]), home);
  await page.evaluate(() => window.BD_TEST.aim(true));
  // stay at arm's reach while the blade works
  let stw = await S();
  const endK = Date.now() + 45000;
  while (stw.corpses.length <= c0 && Date.now() < endK) {
    await page.evaluate(h => window.BD_TEST.teleport(h[0] + 1.1, h[1] + 1.1), home);
    await sleep(2500);
    stw = await S();
  }
  await page.evaluate(() => window.BD_TEST.aim(false));
  check('weapon works: KNIFE kills at arm\'s reach', stw.corpses.length > c0, 'corpses ' + c0 + ' -> ' + stw.corpses.length);
}

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
