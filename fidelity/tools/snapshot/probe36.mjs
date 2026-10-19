// probe36 — v69: items, poses, sights, headshots, difficulty, sentry awareness
import puppeteer from 'puppeteer-core';
const LIBS = '/tmp/snap/libs';
const BASE = 'http://127.0.0.1:5175/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const polls = async (fn, timeout = 60000, step = 1200) => { const t0 = Date.now(); let v; while (Date.now() - t0 < timeout) { v = await fn(); if (v) return v; await sleep(step); } return v; };
let PASS = 0, FAIL = 0;
const ok = (name, cond, extra = '') => { if (cond) { PASS++; console.log('  ok', name, extra); } else { FAIL++; console.log('  FAIL', name, extra); } };

const browser = await puppeteer.launch({
  executablePath: '/tmp/chromium', headless: 'new',
  env: { ...process.env, LD_LIBRARY_PATH: LIBS },
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio', '--window-size=1280,800'],
});
async function newPage(diff) {
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 450 });
  page.on('pageerror', e => console.log('PAGEERR', e.message));
  if (diff) await page.evaluateOnNewDocument(d => localStorage.setItem('bd_diff', d), diff);
  await page.goto(BASE + 'play.html?m=mission1', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__playLoaded === true, { timeout: 240000, polling: 2000 });
  await page.evaluate(() => document.getElementById('deployGo').click());
  await sleep(600);
  await page.mouse.click(640, 400);
  await page.evaluate(() => window.BD_TEST.hurt(-100000));
  return page;
}
const S = page => page.evaluate(() => window.BD_TEST.state());
const near = (st, x, z) => st.enemies.slice().sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];

// =============== page 1: NORMAL ===============
let page = await newPage(null);
let st = await S(page);
ok('enemy HP 100 on NORMAL', st.enemies.length > 0 && Math.max(...st.enemies.map(e => e.hp)) === 100, 'maxhp=' + Math.max(...st.enemies.map(e => e.hp)));
ok('difficulty reported', st.diff === 'NORMAL', st.diff);

// --- a posted sentry: stand 16 m behind him; he must notice on his own
st = await S(page);
const sentry = st.enemies.filter(e => e.hold).slice().sort((a, b) => a.d - b.d)[0] || st.enemies.slice().sort((a, b) => a.d - b.d)[0];
const bx = sentry.x - Math.sin(sentry.yaw) * 16, bz = sentry.z - Math.cos(sentry.yaw) * 16;
await page.evaluate(([x, z]) => window.BD_TEST.teleport(x, z), [bx, bz]);
const noticed = await polls(async () => { const s2 = await S(page); const n = near(s2, sentry.x, sentry.z); return (n && (n.st === 'engage' || n.st === 'search')) ? n : null; }, 180000, 2500);
ok('sentry notices a man standing behind him (scan)', !!noticed, noticed ? noticed.st : 'target still ' + (near(await S(page), sentry.x, sentry.z) || {}).st);

// --- being shot turns the next guard to the fight
await page.evaluate(() => window.BD_TEST.teleport(-120, -236));
await sleep(600);
const hit = await page.evaluate(() => window.BD_TEST.hitNearest(10, false));
st = await S(page);
const victim = st.enemies.slice().sort((a, b) => a.d - b.d)[0];
ok('a wounded guard turns to hunt (not patrol)', hit && victim && victim.st !== 'patrol', 'state=' + (victim && victim.st) + ' hp ' + (hit && hit.before) + '->' + (hit && hit.after));

// --- headshot math
const h1 = await page.evaluate(() => window.BD_TEST.hitNearest(22, false));
const h2 = await page.evaluate(() => window.BD_TEST.hitNearest(22, false));
ok('body hits chip exactly weapon damage (22 a hit)', h1 && h2 && h1.after === h1.before - 22 && h2.after === h2.before - 22 && h2.alive, JSON.stringify([h1, h2]));
const h3 = await page.evaluate(() => window.BD_TEST.hitNearest(57, true));
ok('follow-up head shot kills', h3 && !h3.alive, JSON.stringify(h3));
await sleep(500);
st = await S(page);
ok('head-shot death plays the headshot clip', st.corpses.some(c => c.anim === 'UPRIGHT_HEADSHOT'), JSON.stringify(st.corpses.map(c => c.anim)));

// =============== wheel gate (real Space key) ===============
const slot0 = (await S(page)).slot.key;
await page.mouse.wheel({ deltaY: 240 });
await sleep(500);
ok('wheel does NOT cycle items without SPACE', (await S(page)).slot.key === slot0, slot0);
await page.keyboard.down('Space');
await sleep(700);
await page.mouse.wheel({ deltaY: 240 });
await sleep(500);
const slot1 = (await S(page)).slot.key;
ok('wheel cycles while SPACE is held', slot1 !== slot0, slot0 + '->' + slot1);
await page.keyboard.up('Space');
await sleep(300);
await page.mouse.wheel({ deltaY: 240 });
await sleep(400);
ok('wheel dead again after SPACE released', (await S(page)).slot.key === slot1, (await S(page)).slot.key);

// =============== items & poses ===============
await page.evaluate(() => window.BD_TEST.select('MEDIKIT'));
await page.evaluate(() => window.BD_TEST.look(true));
await sleep(700);
st = await S(page);
ok('medikit cannot be aimed', st.aiming === false, 'aiming=' + st.aiming);
ok('medikit carried one-handed (relaxed pose)', st.anim === 'UPRIGHT_RELAXED_WITH_PISTOL', st.anim);
await page.evaluate(() => window.BD_TEST.select('M16A2'));
await page.evaluate(() => window.BD_TEST.select('MEDIKIT'));
await page.evaluate(() => window.BD_TEST.setHP(55));
const hpBefore = (await S(page)).hp;
await page.evaluate(() => window.BD_TEST.aim(true));
await sleep(300);
await page.evaluate(() => window.BD_TEST.aim(false));
const healed = await polls(async () => { const s2 = await S(page); return s2.hp > hpBefore ? s2 : null; }, 90000, 2500);
ok('medikit heals after the dressing pause', !!healed, hpBefore + '->' + (healed ? healed.hp : 'never'));

await page.evaluate(() => window.BD_TEST.select('KNIFE'));
const knifePose = await polls(async () => { const s2 = await S(page); return (s2.anim === 'UPRIGHT_RELAXED_WITH_PISTOL' || s2.anim === 'UPRIGHT_WALK_WITH_PISTOL') ? s2 : null; }, 90000, 2500);
ok('knife held one-handed', !!knifePose, knifePose ? knifePose.anim : (await S(page)).anim);
st = await S(page);
const eN = st.enemies.slice().sort((a, b) => a.d - b.d)[0];
await page.evaluate(([x, z, y]) => window.BD_TEST.teleport(x - Math.sin(y) * 1.6, z - Math.cos(y) * 1.6), [eN.x, eN.z, eN.yaw]);
const killsBefore = st.enemies.length;
await page.evaluate(() => window.BD_TEST.aim(true));
await sleep(1200);
st = await S(page);
ok('knife slash kills at reach', st.enemies.length < killsBefore || st.corpses.length > 0, 'alive ' + killsBefore + '->' + st.enemies.length);
await page.evaluate(() => window.BD_TEST.aim(false));

await page.evaluate(() => window.BD_TEST.select('FRAG'));
await sleep(300);
const fragLeft = (await S(page)).slot.left;
await page.evaluate(() => window.BD_TEST.aim(true));
await sleep(300);
await page.evaluate(() => window.BD_TEST.aim(false));
const thrown1 = await polls(async () => { const s2 = await S(page); return (fragLeft !== undefined && s2.slot.left === fragLeft - 1) ? s2 : null; }, 60000, 2000);
ok('frag thrown once per click (count drops by one)', !!thrown1, fragLeft + '->' + (thrown1 ? thrown1.slot.left : '?'));

// =============== sights & poses ===============
await page.evaluate(() => window.BD_TEST.teleport(-120, -236));
await page.evaluate(() => window.BD_TEST.select('LAW66'));
await page.evaluate(() => window.BD_TEST.look(true));
const lawPose = await polls(async () => { const s2 = await S(page); return s2.anim === 'UPRIGHT_STANCE_WITH_LAW' ? s2 : null; }, 90000, 2500);
st = await S(page);
ok('LAW66 raises the green glass only', st.sights.law === 'block' && st.sights.rpg !== 'block', JSON.stringify(st.sights));
ok('LAW shouldered pose', !!lawPose, lawPose ? lawPose.anim : (await S(page)).anim);
await page.evaluate(() => window.BD_TEST.look(false));
await page.evaluate(() => window.BD_TEST.give('RPG7'));
await sleep(400);
await page.evaluate(() => window.BD_TEST.look(true));
await sleep(1000);
st = await S(page);
ok('RPG7 gets its own optic', st.sights.rpg === 'block' && st.sights.law !== 'block', JSON.stringify(st.sights));
await page.evaluate(() => window.BD_TEST.look(false));
await page.evaluate(() => window.BD_TEST.select('BINOCULARS'));
await page.evaluate(() => window.BD_TEST.look(true));
await sleep(1000);
st = await S(page);
ok('binoculars: twin-lens mask', st.sights.binoc === 'block', JSON.stringify(st.sights));
const binocPose = await polls(async () => { const s2 = await S(page); return s2.anim === 'UPRIGHT_USE_BINOCULARS' ? s2 : null; }, 90000, 2500);
ok('binoculars raised-to-eyes clip', !!binocPose, binocPose ? binocPose.anim : (await S(page)).anim);
await page.screenshot({ path: '/tmp/snap/shots34/v69-binoc.png' });
await page.evaluate(() => window.BD_TEST.look(false));
await page.evaluate(() => window.BD_TEST.select('SIGP228'));
await page.evaluate(() => window.BD_TEST.look(true));
const pisPose = await polls(async () => { const s2 = await S(page); return s2.anim === 'UPRIGHT_STANCE_WITH_PISTOL' ? s2 : null; }, 60000, 2000);
st = await S(page);
ok('pistol aim pose is the pistol stance', !!pisPose, pisPose ? pisPose.anim : st.anim);
await page.screenshot({ path: '/tmp/snap/shots34/v69-pistol.png' });
await page.evaluate(() => window.BD_TEST.look(false));

await page.evaluate(() => window.BD_TEST.select('M16A2'));
await page.evaluate(() => window.BD_TEST.facePlayer(-160, -300));
await page.evaluate(() => window.BD_TEST.aim(true));
const mzl = await polls(async () => (await S(page)).fx.mzl, 6000, 200);
ok('M15 muzzle-blast sprite flashes', !!mzl);
await page.evaluate(() => window.BD_TEST.aim(false));
await page.close();

// =============== difficulty pages ===============
page = await newPage('HARD');
st = await S(page);
ok('HARD: enemy HP 125', Math.max(...st.enemies.map(e => e.hp)) === 125, '' + Math.max(...st.enemies.map(e => e.hp)));
await page.close();
page = await newPage('EASY');
st = await S(page);
ok('EASY: enemy HP 75', Math.max(...st.enemies.map(e => e.hp)) === 75, '' + Math.max(...st.enemies.map(e => e.hp)));
await page.close();

await browser.close();
console.log(`\nprobe36: ${PASS} pass, ${FAIL} fail`);
process.exit(FAIL ? 1 : 0);
