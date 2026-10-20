// editprobe — the Data Editor's overrides must actually drive the game,
// and with no edits saved the game must sit on the pure OG values.
import puppeteer from 'puppeteer-core';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let PASS = 0, FAIL = 0;
const ok = (n, c, x = '') => { console.log((c ? '  ok ' : '  FAIL ') + n, x); c ? PASS++ : FAIL++; };
const browser = await puppeteer.launch({ executablePath: '/tmp/chromium', headless: 'new', protocolTimeout: 1200000,
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/snap/libs' },
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
async function loadPage(edit) {
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 450 });
  page.on('pageerror', e => console.log('PAGEERR', e.message));
  if (edit) await page.evaluateOnNewDocument(v => localStorage.setItem('bd_edit', JSON.stringify(v)), edit);
  await page.goto('http://127.0.0.1:5176/game/play.html?m=mission1', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__playLoaded === true, { timeout: 240000, polling: 2000 });
  await page.evaluate(() => document.getElementById('deployGo').click());
  await sleep(500);
  return page;
}
const S = p => p.evaluate(() => window.BD_TEST.state());

// 1) untouched: pure OG values
let page = await loadPage(null);
let st = await S(page);
const maxHp = Math.max(...st.enemies.map(e => e.hp));
ok('no edits: enemies on OG 48 HP', maxHp === 48, 'max=' + maxHp);
ok('no edits: M16A2 damage is OG 14', st.wdef.M16A2.dmg === 14, JSON.stringify(st.wdef.M16A2));
ok('no edits: squad integrity 150', st.hp === 150, 'hp=' + st.hp);
ok('no edits: editor defaults reported', st.edit.enemy.hp === 48 && st.edit.player.hp === 150 && st.edit.vehicle.rocketDamage === 550, JSON.stringify(st.edit.enemy));
await page.close();

// 2) edited: overrides must rule the game
page = await loadPage({ enemy: { hp: 999 }, weapons: { M16A2: { dmg: 99 } }, player: { hp: 300 }, vehicle: { rocketDamage: 5000 } });
st = await S(page);
const maxHp2 = Math.max(...st.enemies.map(e => e.hp));
ok('edited: enemies use editor HP 999', maxHp2 === 999, 'max=' + maxHp2);
ok('edited: M16A2 damage is editor 99', st.wdef.M16A2.dmg === 99, JSON.stringify(st.wdef.M16A2));
ok('edited: squad integrity 300', st.hp === 300, 'hp=' + st.hp);
ok('edited: rocket damage is editor 5000', st.edit.vehicle.rocketDamage === 5000, '');
await page.close();

// 3) tracers + add-a-weapon
page = await loadPage({ fx: { tracerPlayer: 'ff6b6b', tracerEnemy: '00ff00', tracerWidth: 2 },
  customWeapons: [{ key: 'CUSTOM1', label: 'TEST GUN', base: 'M16A2', dmg: 77, mag: 40, reload: 1.1, interval: 0.05 }] });
st = await S(page);
ok('edited: your tracers are light red', st.fx.trcP === 0xff6b6b, 'trcP=' + st.fx.trcP.toString(16));
ok('edited: enemy tracers are green', st.fx.trcE === 0x00ff00, 'trcE=' + st.fx.trcE.toString(16));
ok('edited: tracer thickness x2', st.fx.trcW === 2, 'trcW=' + st.fx.trcW);
ok('custom weapon registered with editor stats', !!st.wdef.CUSTOM1 && st.wdef.CUSTOM1.dmg === 77 && st.wdef.CUSTOM1.mag === 40, JSON.stringify(st.wdef.CUSTOM1));
await page.evaluate(() => window.BD_TEST.select('CUSTOM1'));
await sleep(600);
st = await S(page);
ok('custom weapon is in the kit and selectable', st.slot.key === 'CUSTOM1', 'held=' + st.slot.key);
await page.close();

await browser.close();
console.log(`editprobe: ${PASS} pass, ${FAIL} fail`);
process.exit(FAIL ? 1 : 0);
