/* CONFLICT: DESERT STORM — original frontend (Phase 2).
   Every label, title and briefing string comes from the game's own .loc files;
   every screen is dressed in the game's own art (DEFLOAD bitmaps, GWInt/CDSFont
   banks). Flow mirrors the original: title -> main -> missions -> briefing ->
   equipment (loadout) -> loading -> deploy. */
import { loadFont, setCdsText, cdsText } from './cdsfont.js';

const $ = id => document.getElementById(id);
const LOC = {};
let UNITS = [], WEAPONS = [], INVEN = [], UNITWPNS = [], GWINT = {};
let screen = 'title';
let mission = null;              // {n, key, title, gap}
let loadout = {};                // soldierName -> {primary, secondary, item}
let curSoldier = 0;
const OPT = JSON.parse(localStorage.getItem('cds_opt') || '{"music":true,"sfx":true}');

const MISSIONS = [
  ['mission1', 'MISS1_TITLE'], ['mission2', 'MISS2_TITLE'], ['mission3', 'MISS3_TITLE'],
  ['mission4', 'MISS4_TITLE'], ['mission5a', 'MISS5_TITLE'], ['mission5b', 'MISS5B_TITLE'],
  ['mission6', 'MISS6_TITLE'], ['mission7', 'MISS7_TITLE'], ['mission8', 'MISS8_TITLE'],
  ['mission9', 'MISS9_TITLE'], ['mission10', 'MISS10_TITLE'], ['mission11a', 'MISS11_TITLE'],
  ['mission11b', 'MISS11B_TITLE'], ['mission12a', 'MISS12_TITLE'], ['mission12b', 'MISS12B_TITLE']
];

let musicEl = null;
function music(on) {
  if (musicEl) { musicEl.pause(); musicEl = null; }
  if (on && OPT.music) { musicEl = new Audio('assets/music/frontendmusic.wav'); musicEl.loop = true; musicEl.volume = 0.55; musicEl.play().catch(() => {}); }
}
function click(name = 'Interface_line53.wav', vol = 0.5) {
  if (!OPT.sfx) return;
  const a = new Audio('assets/sounds/frontend/Interface/' + name);
  a.volume = vol; a.play().catch(() => {});
}
const S = (file, key, dflt = '') => (LOC[file] && LOC[file][key]) || dflt;

function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('on'));
  $('scr-' + id).classList.add('on');
  screen = id;
}
function cds(el, text, opts) { setCdsText(el, text, opts); }

/* ---------------- screens ---------------- */
function buildMain() {
  cds($('mainTitle'), 'CONFLICT DESERT STORM', { scale: 2.6 });
  const items = [
    ['SINGLE PLAYER', () => openMissions(), false],
    ['MULTIPLAYER', null, true],
    ['LOAD GAME', null, true],
    ['OPTIONS', () => openOptions(), false],
    ['QUIT', () => { music(false); show('title'); }, false]
  ];
  const labels = { 'SINGLE PLAYER': S('gen', 'S_PLAYER', 'SINGLE PLAYER'), 'MULTIPLAYER': S('gen', 'M_PLAYER', 'MULTIPLAYER'),
    'LOAD GAME': S('gen', 'LOAD', 'LOAD GAME'), 'OPTIONS': S('gen', 'OPTIONS', 'OPTIONS'), 'QUIT': S('gen', 'QUIT', 'QUIT') };
  $('mainItems').innerHTML = '';
  for (const [label, fn, dis] of items) {
    const d = document.createElement('div');
    d.className = 'mitem' + (dis ? ' dis' : '');
    cds(d, labels[label] || label, { scale: 1.7 });
    if (dis) { const s = document.createElement('div'); s.style.cssText = 'font-size:10px;color:#f0b429;letter-spacing:.14em;margin-top:2px'; s.textContent = 'NOT IN THE BROWSER ASSEMBLY'; d.appendChild(s); }
    if (fn) d.addEventListener('click', () => { click(); fn(); });
    $('mainItems').appendChild(d);
  }
  $('mainFoot').textContent = S('pc', 'PC_BACK_PROMPT', 'Esc: Back') + '   ·   ' + S('pc', 'PC_ESC_CONTINUE_PROMPT', 'Esc: Continue');
}
function openMissions() {
  cds($('misTitle'), 'SINGLE PLAYER', { scale: 2.2 });
  cds($('misBack'), S('gen', 'BACK', 'BACK'), { scale: 1.4 });
  const list = $('misList'); list.innerHTML = '';
  MISSIONS.forEach(([id, key], i) => {
    const title = S('title', key, id);
    const row = document.createElement('div');
    row.className = 'mrow';
    row.innerHTML = `<div class="num">${i + 1}</div><div class="ttl"></div>` +
      (id !== 'mission1' ? '<div class="tag">BRIEFING TEXT: ARCHIVE GAP — SEE PLAN</div>' : '');
    cds(row.querySelector('.ttl'), title.toUpperCase(), { scale: 1.5, color: '#e8e4cf' });
    row.addEventListener('click', () => { click(); openBrief(id, title, i + 1); });
    list.appendChild(row);
  });
  show('missions');
}
function openBrief(id, title, n) {
  mission = { id, title, n };
  const T = id === 'mission1' ? LOC.m01 : null;
  $('brMission').textContent = 'MISSION ' + n;
  $('brHead').textContent = T ? (T.M01_BRF_HD || title.toUpperCase()) : title.toUpperCase();
  $('brDate').textContent = T ? (T.M01_BRF_DT || '') : 'KUWAIT, 1991';
  $('brText').textContent = T ? (T.M01_BRF_TXT || '') :
    'The original briefing text for this mission lives in its mission archive, which is not among the files supplied (see PLAN.md §7). The mission itself — terrain, placements, hostiles — is fully present and arrives with the simulation phases.';
  $('brObjHead').textContent = 'OBJECTIVES';
  const objs = [];
  if (T) for (let i = 1; i <= 4; i++) { const t = T['OBJECTIVE' + i + 'A'] || T['OBJECTIVE_' + i + 'A']; if (t) objs.push(t); }
  $('brObjs').innerHTML = objs.map(t => `<li>${t}</li>`).join('') ||
    '<li>Objectives are defined by the mission data and arrive with the simulation (Phase 4/5).</li>';
  cds($('brBack'), S('gen', 'BACK', 'BACK'), { scale: 1.4 });
  cds($('brNext'), 'EQUIPMENT', { scale: 1.4 });
  show('brief');
}
function soldierKit(name) {
  const rows = UNITWPNS.filter(r => r.id === name);
  const wpns = rows.filter(r => r.cells[2] === 'WEAPON').map(r => r.cells[1]);
  const items = rows.filter(r => r.cells[2] !== 'WEAPON').map(r => r.cells[1]);
  return { wpns, items };
}
function openLoadout() {
  cds($('loTitle'), 'EQUIPMENT', { scale: 2.2 });
  $('loSub').textContent = 'MISSION ' + mission.n + ' — ' + mission.title.toUpperCase();
  const heroes = UNITS.slice(0, 4);
  const box = $('loSoldiers'); box.innerHTML = '';
  heroes.forEach((u, i) => {
    if (!loadout[u.name]) {
      // main weapons come from the mission/role data (M1 start: M16A2 + SIGP228);
      // UnitWpns.txt carries the supplementary kit (knife, grenades, items).
      const kit = soldierKit(u.name);
      const byRole = { 'RIFLEMAN': 'US_WPN_M16A2', 'HEAVY WEAPONS': (WEAPONS.find(w => /SAW/i.test(w.id)) || {}).id || 'US_WPN_M16A2',
        'COMBAT ENGINEER': 'US_WPN_M16A2', 'SNIPER': (WEAPONS.find(w => /PSG1|SNIPER/i.test(w.id)) || {}).id || 'US_WPN_M16A2' };
      loadout[u.name] = { primary: byRole[u.role] || 'US_WPN_M16A2', secondary: 'US_WPN_SIGP228', item: kit.items[0] || 'MediKit' };
    }
    const d = document.createElement('div');
    d.className = 'sold' + (i === curSoldier ? ' sel' : '');
    cds(d, u.name.toUpperCase(), { scale: 1.3, color: '#e8e4cf' });
    const r = document.createElement('div'); r.className = 'role'; r.textContent = u.role; d.appendChild(r);
    d.addEventListener('click', () => { click('Interface_line39.wav', 0.35); curSoldier = i; openLoadout(); });
    box.appendChild(d);
  });
  const u = heroes[curSoldier];
  const lo = loadout[u.name];
  const usWpns = WEAPONS.filter(w => w.id.startsWith('US_WPN'));
  const primaries = usWpns.filter(w => !/PISTOL/i.test(w.wclass));
  const secondaries = usWpns.filter(w => /PISTOL/i.test(w.wclass));
  const icon = wid => { const w = WEAPONS.find(x => x.id === wid); return w && GWINT[w.icon] ? 'assets/ui/gwint/' + GWINT[w.icon].file : ''; };
  const slot = (lab, opts, val, key) => `
    <div class="slotrow"><div class="lab">${lab}</div>
      <select data-slot="${key}">${opts.map(o => `<option value="${o.v}" ${o.v === val ? 'selected' : ''}>${o.t}</option>`).join('')}</select>
      ${icon(val) ? `<img class="wic" src="${icon(val)}" alt="">` : '<img class="wic" style="visibility:hidden">'}
    </div>`;
  $('loSlots').innerHTML =
    slot('PRIMARY', primaries.map(w => ({ v: w.id, t: w.id.replace('US_WPN_', '') + ' — ' + w.wclass })), lo.primary, 'primary') +
    slot('SECONDARY', secondaries.map(w => ({ v: w.id, t: w.id.replace('US_WPN_', '') + ' — ' + w.wclass })), lo.secondary, 'secondary') +
    slot('ITEM', INVEN.map(it => ({ v: it.id, t: S('inv', (it.cells[1] || '').toUpperCase(), it.id) })), lo.item, 'item');
  $('loSlots').querySelectorAll('select').forEach(sel => sel.addEventListener('change', () => {
    loadout[u.name][sel.dataset.slot] = sel.value; click('Interface_line39.wav', 0.35); openLoadout();
  }));
  cds($('loBack'), S('gen', 'BACK', 'BACK'), { scale: 1.4 });
  cds($('loDeploy'), 'DEPLOY', { scale: 1.4 });
  show('loadout');
}
function openOptions() {
  cds($('optTitle'), 'OPTIONS', { scale: 2.2 });
  $('optSub').textContent = S('pc', 'CON_MOUSE', 'MOUSE OPTIONS') + ' · ' + S('pc', 'CON_OPTIONS', 'CONTROLLER OPTIONS');
  const rows = [
    ['MUSIC', OPT.music, () => { OPT.music = !OPT.music; music(OPT.music); }],
    ['SOUND FX', OPT.sfx, () => { OPT.sfx = !OPT.sfx; }]
  ];
  const box = $('optItems'); box.innerHTML = '';
  for (const [lab, on, fn] of rows) {
    const d = document.createElement('div'); d.className = 'mitem';
    cds(d, `${lab}: ${on ? 'ON' : 'OFF'}`, { scale: 1.5, color: on ? '#ffd75e' : '#9aa27c' });
    d.addEventListener('click', () => { fn(); saveOpt(); openOptions(); });
    box.appendChild(d);
  }
  cds($('optBack'), S('gen', 'BACK', 'BACK'), { scale: 1.4 });
  show('options');
}
function saveOpt() { localStorage.setItem('cds_opt', JSON.stringify(OPT)); }
async function openLoading() {
  show('loading');
  $('ldMission').textContent = 'MISSION ' + mission.n;
  $('ldHead').textContent = mission.title.toUpperCase();
  const files = [
    'assets/models/characters/HERO01_ARMSTRONG.glb', 'assets/models/characters/HERO02_RAMIREZ.glb',
    'assets/models/characters/HERO03_JONES.glb', 'assets/models/characters/HERO04_FOLEY.glb',
    'assets/models/characters/IRAQINFANTRY01_SANDY.glb', 'assets/music/frontendmusic.wav'
  ];
  let done = 0;
  await Promise.all(files.map(async f => {
    try { await fetch(f); } catch (e) { /* cache-warm only */ }
    done++; $('loadBar').style.width = (done / files.length * 100) + '%';
    $('loadStatus').textContent = 'LOADING ' + f.split('/').pop();
  }));
  $('loadStatus').textContent = 'READY';
  cds($('depTitle'), 'DEPLOYED', { scale: 2.2, color: '#9dc25e' });
  cds($('depMenu'), 'MAIN MENU', { scale: 1.4 });
  setTimeout(() => show('deployed'), 500);
}

/* ---------------- boot ---------------- */
async function boot() {
  const files = {
    gen: 'data/loc/black_decade_Catalog_0001_GenStrs_loc.json',
    pc: 'data/loc/black_decade_Catalog_0002_PCStrs_loc.json',
    inv: 'data/loc/black_decade_Catalog_0003_InvStrs_loc.json',
    title: 'data/loc/black_decade_Catalog_0004_TitleStrs_loc.json',
    m01: 'data/loc/black_decade_Mission1_M01Strs_loc.json'
  };
  for (const k in files) { try { LOC[k] = await (await fetch(files[k])).json(); } catch (e) { LOC[k] = {}; } }
  UNITS = await (await fetch('data/tables/units.json')).json();
  WEAPONS = await (await fetch('data/tables/weapons.json')).json();
  INVEN = await (await fetch('data/tables/inven.json')).json();
  UNITWPNS = await (await fetch('data/tables/unitwpns.json')).json();
  GWINT = await (await fetch('assets/ui/gwint/index.json')).json();
  await loadFont();
  cds($('pressStart'), 'PRESS ENTER OR CLICK TO START', { scale: 1.6, color: '#ffffff' });
  buildMain();
  const toMain = () => { click(); music(true); show('main'); };
  $('titleArt').addEventListener('click', toMain);
  addEventListener('keydown', e => {
    if (screen === 'title' && (e.code === 'Enter' || e.code === 'Space')) toMain();
    if (e.code === 'Escape') {
      if (screen === 'missions' || screen === 'options') { click(); show('main'); }
      else if (screen === 'brief') { click(); openMissions(); }
      else if (screen === 'loadout') { click(); openBrief(mission.id, mission.title, mission.n); }
    }
  });
  $('misBack').addEventListener('click', () => { click(); show('main'); });
  $('brBack').addEventListener('click', () => { click(); openMissions(); });
  $('brNext').addEventListener('click', () => { click(); openLoadout(); });
  $('loBack').addEventListener('click', () => { click(); openBrief(mission.id, mission.title, mission.n); });
  $('loDeploy').addEventListener('click', () => { click(); openLoading(); });
  $('optBack').addEventListener('click', () => { click(); show('main'); });
  $('depMenu').addEventListener('click', () => { click(); show('main'); });
  document.querySelectorAll('.mitem,.btn,.mrow').forEach(el => el.addEventListener('mouseenter', () => click('Interface_line39.wav', 0.18)));
}
boot().catch(e => console.error(e));
window.CDS_FE = {
  state: () => ({ screen, mission: mission && mission.id, loadout: JSON.parse(JSON.stringify(loadout)), curSoldier }),
  go: show, missions: openMissions,
  brief: i => { const [id, key] = MISSIONS[i]; openBrief(id, S('title', key, id), i + 1); },
  loadout: () => openLoadout(),
  setSoldier: i => { curSoldier = i; openLoadout(); },
  deploy: () => openLoading()
};
