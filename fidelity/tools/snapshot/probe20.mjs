// probe20 — v68 squad orders: distinct role guns, stance mirroring,
// mate engagement at real range, enemy voice on contact. (mission2, full squad)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const LIBS = '/tmp/snap/libs';
const BASE = 'http://127.0.0.1:5175/';
fs.mkdirSync('/tmp/snap/shots20', { recursive: true });
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
await page.goto(BASE + 'play.html?m=mission2', { waitUntil: 'load', timeout: 60000 });
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
check('mission2 playing, full squad deployed', st.playing === true && st.mates.length === 4, JSON.stringify(st.wpns));

// 1. every man has a DIFFERENT role gun — BOUDIAF must not carry BENALI's M16A2
check('four distinct role weapons (BOUDIAF != BENALI)', new Set(st.wpns).size === 4 && /PSG/.test(st.wpns[2] || '') && /M16/.test(st.wpns[0] || ''), JSON.stringify(st.wpns));

// 2. stance mirroring: leader crouches -> squad crouches; leader goes prone -> squad prone
await page.evaluate(() => window.BD_TEST.setHP(100000));
await page.evaluate(() => window.BD_TEST.setStance('crouch'));
st = await until(s => s.mates.filter(m => m.i !== 0 && !m.absent).every(m => m.stance === 'crouch'), 20, 'mates crouch');
check('squad mirrors leader crouch', st.mates.filter(m => m.i !== 0).every(m => m.stance === 'crouch'), JSON.stringify(st.mates));
await page.evaluate(() => window.BD_TEST.setStance('prone'));
st = await until(s => s.mates.filter(m => m.i !== 0 && !m.absent).every(m => m.stance === 'prone'), 20, 'mates prone');
check('squad mirrors leader prone', st.mates.filter(m => m.i !== 0).every(m => m.stance === 'prone'), JSON.stringify(st.mates));
await page.evaluate(() => window.BD_TEST.setStance('stand'));
st = await until(s => s.mates.filter(m => m.i !== 0 && !m.absent).every(m => m.stance === 'stand'), 20, 'mates stand');
check('squad mirrors leader stand', st.mates.filter(m => m.i !== 0).every(m => m.stance === 'stand'), JSON.stringify(st.mates));

// 3+4. mate engagement at ~35 m + enemy voice. Walk to a real enemy, keep the
// player out of the fight (prone, behind the mate) and watch CHERIF work.
st = await S();
const near = st.enemies.slice().sort((a, b) => a.d - b.d)[0];
check('enemies present on mission2', !!near, near ? 'nearest ' + near.d + ' m' : 'none');
if (near) {
  // stand 36 m short of the enemy, mate 3 m ahead of the player
  const px = near.x + 36, pz = near.z;
  await page.evaluate(([x, z]) => window.BD_TEST.teleport(x, z), [px, pz]);
  await page.evaluate(([x, z]) => window.BD_TEST.matePos(1, x, z), [near.x + 33, near.z]);
  await page.evaluate(() => window.BD_TEST.facePlayer(0, 0)); // keep camera calm
  const hp0 = new Map((await S()).enemies.map(e => [e.x + ',' + e.z, e.hp]));
  st = await until(s => s.mates[1] && s.mates[1].tgt, 60, 'mate acquires target beyond 26 m');
  check('mate acquires a visible target at ~33 m (was capped at 26 m)', !!(st.mates[1] && st.mates[1].tgt), JSON.stringify(st.mates[1]));
  st = await until(s => s.enemies.some(e => e.hp < 70), 90, 'mate fire hurts someone');
  const hurt = st.enemies.filter(e => e.hp < 70).length;
  check('mate fire actually wounds enemies', hurt > 0 || st.enemies.length < hp0.size, hurt + ' wounded, alive ' + st.enemies.length + '/' + hp0.size);
  // the contact shout comes when the wounded man turns, finds the shooter and
  // engages — give the fight its own window to reach that beat
  st = await until(s => s.voicePlays > 0, 150, 'enemy shouts in combat');
  if (!st.voicePlays) {
    // staged fallback: stand 22 m in front of a guard who has not spotted
    // anyone yet (the first-sight shout is the deterministic trigger)
    const g = st.enemies.filter(e2 => e2.st === 'patrol' || e2.hold).sort((a, b) => b.d - a.d)[0];
    if (g) {
      const fx = g.x + Math.sin(g.yaw) * 22, fz = g.z + Math.cos(g.yaw) * 22;
      console.log('  (staging first contact at ' + fx.toFixed(0) + ',' + fz.toFixed(0) + ' guard yaw ' + g.yaw.toFixed(2) + ')');
      await page.evaluate(([x, z]) => window.BD_TEST.teleport(x, z), [fx, fz]);
      st = await until(s => s.voicePlays > 0, 200, 'staged shout');
    }
  }
  check('enemy voice lines play in combat', st.voicePlays > 0, 'voicePlays=' + st.voicePlays);
}

const fails = results.filter(r => !r[1]).length;
console.log('PROBE20: ' + (results.length - fails) + '/' + results.length + ' PASS; page errors: ' + errs.length);
errs.slice(0, 5).forEach(e => console.log('  ERR ' + e));
await browser.close();
process.exit(fails || errs.length ? 1 : 0);
