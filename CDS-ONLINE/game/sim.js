/* =====================================================================
   CONFLICT: DESERT STORM — simulation (Phases 3–4)
   Built only from the original data:
   - MISSION1.ENV (instances, HLOI units, REGN triggers, NEWENVWAYPT graph)
   - Catalog tables (Weaps/HStat/Units/UnitWpns) as parsed by the pipeline
   - MovementStateRules.txt / UpperBodyStateRules.txt, implemented as the
     literal transition tables they are (see RulesMachine below)
   - the PRB animation library inside the converted character GLBs
   Values that remain sealed in the exe are marked PROVISIONAL where used.
   ===================================================================== */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skClone } from 'three/addons/utils/SkeletonUtils.js';
import { cdsText } from './cdsfont.js';

const $ = id => document.getElementById(id);
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
/* region membership: ENV REGN volumes (sphere radius, or box around centre) */
function inRegion(p, r) {
  if (!r) return false;
  if (r.box) return Math.abs(p.x - r.pos[0]) <= Math.max(Math.abs(r.box[0][0]), Math.abs(r.box[1][0])) &&
                     Math.abs(p.y - r.pos[1]) <= Math.max(Math.abs(r.box[0][1]), Math.abs(r.box[1][1])) + 2 &&
                     Math.abs(p.z - r.pos[2]) <= Math.max(Math.abs(r.box[0][2]), Math.abs(r.box[1][2]));
  return Math.hypot(p.x - r.pos[0], p.y - r.pos[1], p.z - r.pos[2]) < Math.max(r.r || 0, 3);
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const DISPLAY = { Ramirez: 'CONNORS' };   // Units.txt codename; the shipped game calls him Connors
const dispName = n => DISPLAY[n] || n.toUpperCase();

let renderer, scene, camera, clock, raf = 0, running = false, paused = false;
let WEAPONS = {}, HUMANS = {}, UNITS = {}, UNITWPNS = {}, INVEN = {}, CONNOBJS = {}, MISSION = null, LOC_M01 = {};
let MOVTXT = '';
let PERF = { totalMs: 0, worldMs: 0, actorsMs: 0, cutsceneMs: 0 };
let squad = [], enemies = [], prisoner = null, activeIdx = 0, allActors = [];
let camYaw = 0, camPitch = 0.1, keys = {}, aiming = false, firing = false;
let firingKey = false;
let objectives = [], objIdx = 0, hasC4 = false, plantT = 0, planted = false, gapHadHostiles = false, kills = 0;
let bridgePoint = null, extractRegion = null, c4Region = null, gateRegion = null, c4PropPos = null, pillarRegion = null;
let SPEEDS = { src: 'PROVISIONAL', walk: 1.6, run: 3.6, kneelWalk: 1.1, crawl: 0.6 };
let onExitCb = null, curLoadout = {};
let MISSION_ID = 'mission1', MODEL_DIR = 'assets/models/mission1', MISSION_LABEL = 'MISSION 1';
let VSTAT = {}, DOORTAB = {}, VEHICLES = [], DOORS = [], driving = null, vehicleRulesText = '', worldGroup = null;
/* model -> VStat row + vehicle weapon (Catalog Weaps has the IR_VWPN_* rows).
   Field semantics: numbers[11] = hit points, numbers[12] = armour (BMP2 500,
   per PLAN); penetration rule dmg > armour, full damage through — PROVISIONAL (R3). */
const VMAP = { BMP2: { vs: 'BMP2', w: 'IR_VWPN_BMP2_ChainGun' }, BMP1: { vs: 'BMP1', w: 'IR_VWNP_BMP1_MAINCANNON' },
  T72M1: { vs: 'TankStat_T72', w: 'IR_VWNP_T72_MAINCANNON' }, T62_IRAQTANK: { vs: 'TankStat_T62', w: 'IR_VWPN_T62_MAINCANNON' },
  URAL375_CLOSED: { vs: 'IR_Truck' }, URAL375_OPEN: { vs: 'IR_Truck' }, FUEL_TRUCK: { vs: 'Fuel_bowser' }, FUEL_TRUCK01: { vs: 'Fuel_bowser' } };
const loader = new GLTFLoader();
const glbCache = {};
const tracers = [];
let muzzleTex = null;

/* ---------------- data ---------------- */
async function jget(u) { const r = await fetch(u); if (!r.ok) throw new Error(u); return r.json(); }
let MODEL_INDEX = null;
function modelIndex() {
  // one shared promise — concurrent loadGLB calls must not observe an empty map
  if (!MODEL_INDEX) MODEL_INDEX = (async () => {
    const map = new Map();
    try {
      const list = await jget('data/model-index.json');
      for (const u of list) map.set(u.toLowerCase(), u);
    } catch (e) { /* fall through to direct fetches */ }
    return map;
  })();
  return MODEL_INDEX;
}
async function loadGLB(url) {
  if (Object.prototype.hasOwnProperty.call(glbCache, url)) return glbCache[url];
  const idx = await modelIndex();
  let real = url;
  if (idx.size) {
    const hit = idx.get(url.toLowerCase());
    if (!hit) { glbCache[url] = null; return null; }   // zone children live inside the parent GLB
    real = hit;
  }
  if (!Object.prototype.hasOwnProperty.call(glbCache, real)) glbCache[real] = loader.loadAsync(real).catch(() => null);
  glbCache[url] = await glbCache[real];
  return glbCache[url];
}
function wpn(id) { return WEAPONS[id] || { id, damage: 14, mag: 30, reload: 1.5, interval: 0.1, range: 800, fireOnMove: true, bank: 'M16A2', icon: '' }; }
function unitRowForModel(model) {
  const m = model.toLowerCase();
  for (const k in UNITS) if (UNITS[k].model.toLowerCase() === m) return UNITS[k];
  return null;
}

/* ---------------- audio (original banks) ---------------- */
const AC = window.AudioContext ? new (window.AudioContext)() : null;
const sndBuf = {};
const AUDIO_LOG = [];           // every sound we would play — the audio-event probe
let SOUND_SUBDIR = 'mission1';  // bank dir under assets/sounds (per-mission .sch recovery)
function snd(path, vol = 0.8, rate = 1) {
  AUDIO_LOG.push(path);
  if (!AC) return;
  if (AC.state === 'suspended') AC.resume();
  if (sndBuf[path]) return blip(sndBuf[path], vol, rate);
  fetch(path).then(r => r.ok ? r.arrayBuffer() : null).then(b => b && AC.decodeAudioData(b))
    .then(buf => { if (buf) { sndBuf[path] = buf; blip(buf, vol, rate); } }).catch(() => {});
}
function blip(buf, vol, rate) {
  const s = AC.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
  const g = AC.createGain(); g.gain.value = clamp(vol, 0, 1);
  s.connect(g); g.connect(AC.destination); s.start();
}
let BANK_SAMPLES = {};    // bank -> [file,...] from data/bank-samples.json
function bankPlay(bank, kind, vol, dist = 0) {
  const files = BANK_SAMPLES[bank];
  if (!files || !files.length) return;
  let f = null;
  if (kind === 'shot') { const shots = files.filter(x => /_shot\d/.test(x)); f = shots.length ? shots[Math.floor(Math.random() * shots.length)] : files[0]; }
  else if (kind === 'voice') { const lines = files.filter(x => /line/i.test(x)); f = lines.length ? lines[Math.floor(Math.random() * lines.length)] : files[0]; }
  else f = files.find(x => !/click/i.test(x)) || files[0];
  const v = dist ? clamp(1.1 - dist / 85, 0.03, 0.65) : vol;
  snd(`assets/sounds/${SOUND_SUBDIR}/${bank}/${f}`, v, rand(0.95, 1.05));
}

/* ---------------- cutscenes & voices (P6) ----------------
   Cameras come from the ENV CAMFREE/CAMTARGOBJ records (envparse) or the
   survivor props.cutscenes. CS_* scripted actors are placed for their
   scene and removed when it ends. Title cards are the mission's MOV_TXT
   strings. ENVSND stream files (.psf) are absent from the supplied
   archives — emitters are exposed via CDS_SIM.envsnd() as a known gap. */
let cutscene = null;         // {shots, i, t, els, actors}
let CS_AUDIO = null;         // decoded cutscene stream (assets/music)
function say(bank, hint, vol = 0.85, dist = 0) {
  const files = BANK_SAMPLES[bank];
  if (!files || !files.length) return;
  let pool = files.filter(f => /line/i.test(f));
  if (hint) { const h = pool.filter(f => f.toLowerCase().includes(hint)); if (h.length) pool = h; }
  const f = pool[Math.floor(Math.random() * pool.length)] || files[0];
  const v = dist ? clamp(1.1 - dist / 85, 0.03, 0.65) : vol;
  snd(`assets/sounds/${SOUND_SUBDIR}/${bank}/${f}`, v, 1);
}
function voiceLine(vol = 0.85) { say('Foley', 'follow_me', vol); }       // Foley rejoining after rescue
function radioLine(vol = 0.6) { say('Mission1', null, vol); }            // HQ / ambient radio bank

/* ---------------- controls & strings: the game's own files ----------------
   Bindings come from default.key (74 actions, pipeline -> defaultkey.json).
   KEY_* tokens map to KeyboardEvent.code; JOY_* has no browser analogue
   (parsed, unbound); MOUSE_BUTTON_0/1 ride the existing mouse flags.
   Strings come from GenStrs (Catalog_0001) with marked fallbacks. */
let BIND = {}, GEN = {};
function tok2code(t) {
  if (!t || t.startsWith('JOY_')) return null;
  if (t === 'MOUSE_BUTTON_0') return 'MOUSE0';
  if (t === 'MOUSE_BUTTON_1') return 'MOUSE1';
  const k = t.replace(/^KEY_/, '');
  const named = { ESC: 'Escape', SPACE: 'Space', LCTRL: 'ControlLeft', RCTRL: 'ControlRight',
    LSHIFT: 'ShiftLeft', RSHIFT: 'ShiftRight', LALT: 'AltLeft', RALT: 'AltRight',
    PAGEUP: 'PageUp', PAGEDOWN: 'PageDown', COMMA: 'Comma', FULLSTOP: 'Period',
    SEMICOLON: 'Semicolon', QUOTE: 'Quote', RETURN: 'Enter',
    UPARROW: 'ArrowUp', DOWNARROW: 'ArrowDown', LEFTARROW: 'ArrowLeft', RIGHTARROW: 'ArrowRight' };
  if (named[k]) return named[k];
  if (/^KP_\d$/.test(k)) return 'Numpad' + k.slice(3);
  if (k === 'KP_PLUS') return 'NumpadAdd';
  if (k === 'KP_MINUS') return 'NumpadSubtract';
  if (/^F\d+$/.test(k)) return k;
  if (/^\d$/.test(k)) return 'Digit' + k;
  if (/^[A-Z]$/.test(k)) return 'Key' + k;
  return null;
}
function down(act) {
  const cs = BIND[act]; if (!cs) return false;
  for (const c of cs) { if (c === 'MOUSE0' ? firing : c === 'MOUSE1' ? aiming : keys[c]) return true; }
  return false;
}
function keyLabel(act) {
  const cs = (BIND[act] || []).filter(c => c !== 'MOUSE0' && c !== 'MOUSE1');
  if (!cs.length) return '';
  return cs[0].replace(/^Key/, '').replace(/^Digit/, '').replace('Space', 'SPACE')
    .replace('PageUp', 'PAGE UP').replace('PageDown', 'PAGE DOWN').replace('ControlLeft', 'CTRL').replace('ShiftLeft', 'SHIFT');
}
function S(k, fb) { return GEN[k] || fb; }
let invOpen = false, invSel = 0;
let STEPFN = null;
function cycleHero(dir) {
  if (!squad.length) return;
  let n = activeIdx;
  do { n = (n + dir + squad.length) % squad.length; } while (!squad[n].alive && n !== activeIdx);
  switchHero(n);
}
function cycleStance() {
  const M = squad[activeIdx]; if (!M) return;
  M.moveMode = M.moveMode === 'RUN' || M.moveMode === 'WALK' ? 'KNEEL' : M.moveMode === 'KNEEL' ? 'CRAWL' : 'RUN';
}
function toggleObjectives() {
  const p = $('hudPanel');
  if (p.style.display === 'block') { p.style.display = 'none'; return; }
  invOpen = false;
  p.innerHTML = `<h3 style="color:#ffd75e;letter-spacing:.24em;margin-bottom:10px">${S('OBJECTIVE', 'OBJECTIVES')}</h3>` +
    objectives.map((o, i) => `<div style="margin:6px 0;font-size:14.5px;${o.done ? 'color:#8fbf6a;text-decoration:line-through' : ''}">${i === objIdx ? '▶ ' : ''}<b>${o.label}</b> — ${o.text}</div>`).join('');
  p.style.display = 'block';
}
function slotLabel(s) {
  return (s.id || '').replace(/^(US|IR)_WPN_/, '').replace(/_/g, ' ');
}
function slotIconHtml(s) {
  const spec = heldSpec(s) || wpn(s.id);
  const gi = GWINT_IDX[(spec && spec.icon) || ''];
  if (!gi) return '';
  return `<img src="assets/ui/gwint/${gi.file}" alt="" style="height:28px;width:auto;vertical-align:middle;margin-right:8px;image-rendering:pixelated">`;
}
function renderInv() {
  const M = squad[activeIdx]; if (!M) return;
  $('hudPanel').innerHTML = '<h3 style="color:#ffd75e;letter-spacing:.24em;margin-bottom:10px">INVENTORY — ' + keyLabel('INVENTORY_UP') + '/' + keyLabel('INVENTORY_DOWN') + ' SELECT, RELEASE ' + keyLabel('INVENTORY') + ' TO EQUIP</h3>' +
    M.inv.map((s, i) => {
      const spec = heldSpec(s) || {};
      const kind = s.kind && s.kind !== 'WEAPON' ? s.kind : (spec.wclass || '');
      const count = s.kind && s.kind !== 'WEAPON' ? (s.ammo > 0 ? s.ammo : '') : `${s.ammo} + ${s.reserve}`;
      return `<div style="margin:6px 0;font-size:15px;display:flex;align-items:center;${i === invSel ? 'color:#ffd75e' : ''}">${i === invSel ? '▶ ' : '<span style="display:inline-block;width:1.1em"></span>'}${slotIconHtml(s)}<b>${slotLabel(s)}</b> <span style="color:#9aa27a;margin-left:8px">${kind}</span> <span style="margin-left:auto">${count}</span></div>`;
    }).join('');
  $('hudPanel').style.display = 'block';
}
function openInv() { const M = squad[activeIdx]; if (!M || !M.inv.length) return; invOpen = true; invSel = M.held; renderInv(); }
function closeInv(equip) {
  if (!invOpen) return;
  invOpen = false; $('hudPanel').style.display = 'none';
  const M = squad[activeIdx];
  if (equip && M && M.inv[invSel] && invSel !== M.held) { M.held = invSel; attachHeld(M); hudDirty = true; }
}
async function startCutscene(shots) {
  if (!shots || !shots.length) return false;
  cutscene = { shots, i: 0, t: 0, actors: [] };
  const token = cutscene;
  if (!MOVTXT) MOVTXT = (await jget('data/tables/movementstaterules.json').catch(() => ({}))).text || '';
  const glbCache = {};
  for (const u of MISSION.units) {
    if (!/^CS_/.test(u.script || '')) continue;
    if (!/^(HERO|IRAQ|IR_|US)/.test(u.model || '')) continue;
    if (!glbCache[u.model]) glbCache[u.model] = await loadGLB(`assets/models/characters/${u.model}.glb`);
    const g = glbCache[u.model]; if (!g) continue;
    const a = makeActor(g, u.name || u.script, 'cs');
    a.sm = new RulesMachine(MOVTXT);
    a.pos.set(u.pos[0], u.pos[1] + 0.4, u.pos[2]); a.floorY = u.pos[1]; a.yaw = u.yaw || 0;
    token.actors.push(a);
    if (cutscene !== token) {   // scene was skipped while actors loaded
      for (const x of token.actors) scene.remove(x.obj);
      allActors = allActors.filter(x => x.team !== 'cs');
      return false;
    }
  }
  if (cutscene !== token) return false;
  $('hudSub').textContent = '';
  $('hudSub').style.display = 'block';
  $('hudSkip').style.display = 'block';
  if (MISSION_ID === 'mission1') {
    AUDIO_LOG.push('assets/music/CS_MENU_S01.wav');
    try { CS_AUDIO = new Audio('assets/music/CS_MENU_S01.wav'); CS_AUDIO.volume = 0.5; CS_AUDIO.play().catch(() => {}); } catch (e) { }
  }
  return true;
}
function endCutscene() {
  if (!cutscene) return;
  for (const a of cutscene.actors) { scene.remove(a.obj); a.obj.visible = false; }
  allActors = allActors.filter(a => a.team !== 'cs');
  cutscene = null;
  if (CS_AUDIO) { try { CS_AUDIO.pause(); } catch (e) { } CS_AUDIO = null; }
  $('hudSub').style.display = 'none';
  $('hudSkip').style.display = 'none';
  missionMusic(true);
  snapCamera();
  if (objectives[0]) toast(objectives[0].label, objectives[0].text);
}
function shotTarget(shot) {
  if (shot.lookPoint) return shot.lookPoint;
  if (shot.look && shot.look.length === 3) return V3(shot.look[0], shot.look[1] + 1, shot.look[2]);
  if (shot.targ) {
    const inst = (MISSION.instances || []).find(i => i.inst === shot.targ);
    if (inst) return V3(inst.w[0], inst.w[1] + 1.2, inst.w[2]);
    const base = shot.targ.replace(/\d+$/, '');
    const u = (MISSION.units || []).find(x => x.model.toUpperCase() === base.toUpperCase());
    if (u) return V3(u.pos[0], u.pos[1] + 1.2, u.pos[2]);
    if (prisoner && /FOLEY/.test(shot.targ)) return prisoner.pos.clone().setY(prisoner.pos[1] + 1.4);
  }
  if (shot.look && shot.look.length === 2) {
    const yaw = shot.look[0] * Math.PI / 180, pitch = shot.look[1] * Math.PI / 180;
    return V3(shot.pos[0] + Math.sin(yaw) * 10, shot.pos[1] + Math.tan(pitch) * 10, shot.pos[2] - Math.cos(yaw) * 10);
  }
  const P = squad[0];
  return P ? new THREE.Vector3(P.pos.x, P.pos[1] + 1.4, P.pos[2]) : null;
}
function cutShots() {
  let raw = [];
  if (MISSION.cameras && MISSION.cameras.length) {
    raw = MISSION.cameras.filter(c => c.name === 'PLAYERVIEW' || /^CS_|_SCENE|SCENE/i.test(c.name));
  } else if (MISSION.cutscenes && MISSION.cutscenes.length) raw = MISSION.cutscenes;
  const cards = [LOC_M01.MOV_TXT1, LOC_M01.MOV_TXT2, LOC_M01.MOV_TXT3].filter(Boolean);
  return raw.slice(0, 6).map((c, i) => ({
    name: c.name, kind: c.kind || 'FREE', pos: c.pos,
    lookPoint: shotTarget(c),
    ang: c.ang || null,
    card: cards[i] || null,
  }));
}
function tickCutscene(dt) {
  if (!cutscene) return;
  cutscene.t += dt;
  const shot = cutscene.shots[cutscene.i];
  const pos = V3(shot.pos[0], shot.pos[1] + 1.6, shot.pos[2]);
  camera.position.copy(pos);
  if (shot.kind === 'TARGOBJ' && shot.lookPoint) camera.lookAt(shot.lookPoint);
  else if (shot.ang) {
    camera.rotation.order = 'YXZ';
    camera.rotation.set(-shot.ang[0] * Math.PI / 180, -shot.ang[1] * Math.PI / 180 + Math.PI, 0);
  }
  else if (shot.lookPoint) camera.lookAt(shot.lookPoint);
  camera.fov = 55; camera.updateProjectionMatrix();
  const card = shot.card;
  if (AUDIO_LOG.length === 0 || $('hudSub').dataset.shot !== String(cutscene.i)) {
    $('hudSub').dataset.shot = String(cutscene.i);
    $('hudSub').textContent = card || '';
  }
  for (const A of allActors) driveActor(A, dt);
  if (cutscene.t > 3.4) { cutscene.i++; cutscene.t = 0; if (cutscene.i >= cutscene.shots.length) endCutscene(); }
}

/* ---------------- the original state machines, literally ----------------
   MovementStateRules.txt is: STATE_NAMES (124), RULE_NAMES (107), then
   RULE <condition> / "FROM" -> "TO" rows / END_RULE. We parse it verbatim
   and evaluate conditions each tick; unknown (script-driven) conditions
   evaluate false, exactly the subset a free-roam soldier can reach. */
class RulesMachine {
  constructor(text) {
    this.states = [];
    this.rules = [];           // [{cond, trans: Map(from->to)}]
    const nameBlock = text.split('RULE_NAMES')[0];
    for (const m of nameBlock.matchAll(/"([^"]+)"/g)) this.states.push(m[1]);
    for (const m of text.matchAll(/RULE\t? ?(\S+)\n([\s\S]*?)END_RULE/g)) {
      const trans = new Map();
      for (const row of m[2].matchAll(/"([^"]+)"\s+"([^"]+)"/g)) trans.set(row[1], row[2]);
      this.rules.push({ cond: m[1].replace(/"/g, ''), trans });
    }
    this.state = 'STATE_STANDING_STILL_PATROL_STANCE';
  }
  tick(ctx) {
    for (let hop = 0; hop < 4; hop++) {
      let moved = false;
      for (const r of this.rules) {
        const to = r.trans.get(this.state);
        if (to && RulesMachine.evalCond(r.cond, ctx)) { this.state = to; moved = true; break; }
      }
      if (!moved) break;
    }
    return this.state;
  }
  static evalCond(name, c) {
    switch (name) {
      case 'VMSR_ZERO_SPEED': return c.speed < 0.08;
      case 'VMSR_ANIM_FINISHED': return !!c.animFinished;
      case 'VMSR_ALIVE': return !!c.alive;
      case 'VMSR_DEAD': return !c.alive;
      case 'VMSR_JOYSTICK_FORWARD': return !!c.joy.f;
      case 'VMSR_JOYSTICK_NOT_FORWARD': return !c.joy.f;
      case 'VMSR_JOYSTICK_BACKWARDS': return !!c.joy.b;
      case 'VMSR_JOYSTICK_NOT_BACKWARDS': return !c.joy.b;
      case 'VMSR_JOYSTICK_LEFT': return !!c.joy.l;
      case 'VMSR_JOYSTICK_NOT_LEFT': return !c.joy.l;
      case 'VMSR_JOYSTICK_RIGHT': return !!c.joy.r;
      case 'VMSR_JOYSTICK_NOT_RIGHT': return !c.joy.r;
      case 'VMSR_JOYSTICK_CENTRED': return !c.joy.f && !c.joy.b && !c.joy.l && !c.joy.r;
      case 'VMSR_AI_STOP_MOVING': return c.aiGo === 'stop';
      case 'VMSR_AI_FACING_DESTINATION': return !!c.facingDest;
      case 'VMSR_AI_NOT_FACING_DESTINATION': return !c.facingDest;
      case 'MSR_ZERO_SPEED': return c.speed < 0.08;
      case 'MSR_ZERO_SPEED_AND_MOVEMENT_MODE_KNEEL_RUN': return c.speed < 0.08 && c.mode === 'KNEEL';
      case 'MSR_ZERO_SPEED_AND_MOVEMENT_MODE_CRAWL': return c.speed < 0.08 && c.mode === 'CRAWL';
      case 'MSR_MOVEMENT_MODE_RUN': return c.mode === 'RUN';
      case 'MSR_MOVEMENT_MODE_WALK': return c.mode === 'WALK';
      case 'MSR_MOVEMENT_MODE_KNEEL_RUN': return c.mode === 'KNEEL';
      case 'MSR_MOVEMENT_MODE_CRAWL': return c.mode === 'CRAWL';
      case 'MSR_JOYSTICK_FORWARD': return !!c.joy.f;
      case 'MSR_JOYSTICK_NOT_FORWARD': return !c.joy.f;
      case 'MSR_JOYSTICK_BACKWARDS': return !!c.joy.b;
      case 'MSR_JOYSTICK_NOT_BACKWARDS': return !c.joy.b;
      case 'MSR_JOYSTICK_LEFT': return !!c.joy.l;
      case 'MSR_JOYSTICK_NOT_LEFT': return !c.joy.l;
      case 'MSR_JOYSTICK_RIGHT': return !!c.joy.r;
      case 'MSR_JOYSTICK_NOT_RIGHT': return !c.joy.r;
      case 'MSR_AI_GO_FORWARDS': return c.aiGo === 'f';
      case 'MSR_AI_GO_BACKWARDS': return c.aiGo === 'b';
      case 'MSR_AI_STOP_MOVING': return c.aiGo === 'stop';
      case 'MSR_AIMING': return !!c.aiming;
      case 'MSR_ALIVE': return c.alive;
      case 'MSR_DEAD': return !c.alive;
      case 'MSR_FALLING': return c.airborne;
      case 'MSR_ON_GROUND': return !c.airborne;
      case 'MSR_ANIM_FINISHED': return !!c.animFinished;
      case 'MSR_FALLING_LAND_INJURED': return false;         // fall-damage table: R3
      case 'MSR_SHOT_AND_KILLED_FROM_IN_FRONT':
      case 'MSR_SHOT_AND_KILLED_FROM_BEHIND':
      case 'MSR_SHOT_AND_KILLED_FROM_THE_LEFT':
      case 'MSR_SHOT_AND_KILLED_FROM_THE_RIGHT':
      case 'MSR_SHOT_AND_KILLED_SHOTGUN_FROM_IN_FRONT':
      case 'MSR_SHOT_AND_KILLED_SHOTGUN_FROM_BEHIND':
      case 'MSR_SHOT_MG_FROM_IN_FRONT':
      case 'MSR_SHOT_MG_FROM_BEHIND':
      case 'MSR_SHOT_AND_KILLED_MG_FROM_IN_FRONT':
      case 'MSR_SHOT_AND_KILLED_MG_FROM_BEHIND':
        return c.deathDir === name;
      case 'MSR_SHOT_AND_KILLED_HEADSHOT': return c.deathDir === 'headshot';
      default: return false;   // script/help-me/salute/etc: driven by the mission VM (R1)
    }
  }
}
/* movement state -> animation clip search (clips are the game's own PRB names) */
const STATE_CLIPS = [
  [/HEADSHOT_DEATH/, [/HEADSHOT/i, /DEATH/i]],
  [/DEATH|RECOVER_FROM/, [/DEATH_BY_SHOTGUN_FORWARD/i, /DEATH/i]],
  [/FALLING/, [/FALLING_MID_AIR/i, /FALL/i]],
  [/CRAWLING.*WALK|CRAWLING_FORWARD|PRONE.*CRAWL/, [/PRONE_CRAWL_WITH_RIFLE/i, /CRAWL/i]],
  [/CRAWLING_STANCE|PRONE/, [/PRONE.*AIM|PRONE/i, /KNEELING_STANCE_WITH_RIFLE/i]],
  [/KNEELING_WALKING_BACKWARDS/, [/CROUCHED.*BACK|CROUCHED_RELAXED_WALK_WITH_RIFLE/i]],
  [/KNEELING_WALKING/, [/CROUCHED_RELAXED_WALK_WITH_RIFLE/i, /CROUCHED.*WALK/i]],
  [/KNEELING/, [/KNEELING_STANCE_WITH_RIFLE/i, /KNEELING/i]],
  [/WALKING_BACKWARDS/, [/WALK.*BACK|UPRIGHT_RELAXED_WALK/i]],
  [/RUNNING|JOGGING/, [/UPRIGHT_RELAXED_RUN_WITH_RIFLE/i, /RUN_WITH/i]],
  [/WALKING/, [/UPRIGHT.*WALK_WITH_RIFLE/i, /WALK/i]],
  [/TURNING/, [/TURN/i, /IDLE/i]],
  [/STANDING_STILL/, [/^UPRIGHT_STANCE_WITH_RIFLE$/i, /UPRIGHT_STANCE_WITH_RIFLE_IDLE01/i, /UPRIGHT_STANCE_WITH_RIFLE/i]],
  [/BLENDING_TO_STANDING|BLENDING_TO_KNEELING|BLENDING_TO_CRAWLING/, [/UPRIGHT_STANCE_WITH_RIFLE/i, /STANCE_WITH_RIFLE/i]]
];
function weaponFamily(w) {
  const aim = ((w && w.aimAnim) || '').toLowerCase();
  const wc = ((w && w.wclass) || '').toUpperCase();
  if (aim.includes('pistol') || wc.includes('PISTOL')) return 'PISTOL';
  if (aim.includes('law') || /ANTI-?TANK|RPG|LAW/.test(wc)) return 'LAW';
  if (aim.includes('knife') || wc.includes('KNIFE')) return 'KNIFE';
  return 'RIFLE';
}
function clipExact(clips, ...names) {
  for (const n of names) {
    if (!n) continue;
    const hit = clips.find(c => c.name.toLowerCase() === n.toLowerCase());
    if (hit) return hit.name;
  }
  return null;
}
function clipForState(clips, state, aimingNow, weapon, strafe) {
  const fam = weaponFamily(weapon || {});
  // Weaps.txt aimAnim is the clip name. A loose /AIM.*RIFLE/ match hits
  // PRONE_AIM_RIFLE first and drops a standing soldier into the prone pose.
  if (aimingNow && weapon && weapon.aimAnim && !/DEATH|DYING|KNOCKED/.test(state || '')) {
    const aim = clipExact(clips, weapon.aimAnim);
    if (aim) return aim;
  }
  if (strafe && (strafe.l || strafe.r) && !/DEATH|DYING|FALL/.test(state || '')) {
    const kneel = /KNEEL|CRAWL/.test(state || '');
    let n = null;
    if (strafe.f && strafe.l) n = clipExact(clips, kneel ? `CROUCHED_STRAFENW_${fam}` : `UPRIGHT_STRAFENW_WITH_${fam}`, `WALK_STRAFENW_${fam}`);
    else if (strafe.f && strafe.r) n = clipExact(clips, kneel ? `CROUCHED_STRAFENE_${fam}` : `UPRIGHT_STRAFENE_WITH_${fam}`, `WALK_STRAFENE_${fam}`);
    else if (strafe.l) n = clipExact(clips, kneel ? `CROUCHED_STRAFEW_WITH_${fam}` : `UPRIGHT_STRAFEW_WITH_${fam}`);
    else if (strafe.r) n = clipExact(clips, kneel ? `CROUCHED_STRAFEE_WITH_${fam}` : `UPRIGHT_STRAFEE_WITH_${fam}`);
    if (n) return n;
  }
  if (/DEATH|DYING|KNOCKED|HEADSHOT/.test(state || '')) return clipExact(clips, 'DEATH_BY_SHOTGUN_FORWARD') || (clips.find(c => /DEATH/i.test(c.name)) || {}).name || null;
  if (/CRAWL/.test(state || '')) return clipExact(clips, `PRONE_CRAWL_WITH_${fam}`, 'PRONE_CRAWL_WITH_RIFLE');
  if (/KNEELING_WALKING/.test(state || '')) return clipExact(clips, `CROUCHED_RELAXED_WALK_WITH_${fam}`, 'CROUCHED_RELAXED_WALK_WITH_RIFLE');
  if (/KNEEL/.test(state || '')) return clipExact(clips, `KNEELING_STANCE_WITH_${fam}`, 'KNEELING_STANCE_WITH_RIFLE');
  if (/BACKWARDS/.test(state || '')) return clipExact(clips, `UPRIGHT_WALK_BACKWARDS_WITH_${fam}`, 'UPRIGHT_WALK_BACKWARDS_WITH_RIFLE');
  if (/RUNNING|JOGGING/.test(state || '')) return clipExact(clips, `UPRIGHT_RELAXED_RUN_WITH_${fam}`, 'UPRIGHT_RELAXED_RUN_WITH_RIFLE');
  if (/WALKING/.test(state || '')) return clipExact(clips, `UPRIGHT_WALK_WITH_${fam}`, 'UPRIGHT_WALK_WITH_RIFLE');
  if (/STANDING|BLENDING/.test(state || '')) return clipExact(clips, `UPRIGHT_STANCE_WITH_${fam}`, 'UPRIGHT_STANCE_WITH_RIFLE');
  for (const [re, prefs] of STATE_CLIPS) {
    if (!re.test(state || '')) continue;
    for (const p of prefs) { const c = clips.find(c => p.test(c.name)); if (c) return c.name; }
  }
  return clipExact(clips, 'UPRIGHT_STANCE_WITH_RIFLE') || (clips[0] && clips[0].name);
}
/* locomotion speeds measured from the clips' own root motion (data, not tuning) */
function measureSpeeds(clips) {
  const out = {};
  const probe = [
    ['run', /UPRIGHT_RELAXED_RUN_WITH_RIFLE/i], ['walk', /UPRIGHT.*WALK_WITH_RIFLE/i],
    ['kneelWalk', /CROUCHED_RELAXED_WALK_WITH_RIFLE/i], ['crawl', /PRONE_CRAWL_WITH_RIFLE/i]
  ];
  for (const [key, re] of probe) {
    const c = clips.find(c => re.test(c.name));
    if (!c) continue;
    let best = 0;
    for (const t of c.tracks) {
      if (!/\.position$/.test(t.name) || !/BIP01/.test(t.name)) continue;
      const v = t.values, n = v.length / 3;
      if (n < 2) continue;
      let path = 0;
      for (let i = 1; i < n; i++) path += Math.hypot(v[i * 3] - v[(i - 1) * 3], v[i * 3 + 2] - v[(i - 1) * 3 + 2]);
      best = Math.max(best, path);
    }
    if (best > 0.2 && c.duration > 0.2) out[key] = best / c.duration;
  }
  return out;
}

/* ---------------- world ---------------- */
let STATIC_FROZEN = 0;
const terrain = [];
const terrainMeshes = [];
const hCache = new Map();
const rayDown = new THREE.Raycaster();
function groundList(x, z) {            /* every surface height at this XZ, high to low */
  const key = Math.round(x * 2) + ',' + Math.round(z * 2);
  let L = hCache.get(key);
  if (!L) {
    rayDown.set(V3(x, 300, z), V3(0, -1, 0)); rayDown.far = 600;
    L = rayDown.intersectObjects(terrainMeshes, false).map(h => h.point.y).sort((a, b) => b - a);
    hCache.set(key, L);
  }
  return L;
}
function groundH(x, z) { const L = groundList(x, z); return L.length ? L[0] : -5; }
/* the floor an actor stands on: highest surface at/below his feet (+ a step) */
function floorFor(A, x, z) {
  const L = groundList(x, z);
  for (const y of L) if (y <= A.pos.y + 1.0) return y;
  return L.length ? L[L.length - 1] : -5;
}
function losClear(a, b) {
  const d = a.distanceTo(b), steps = Math.max(2, Math.floor(d / 7));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (groundH(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t) > a.y + (b.y - a.y) * t + 0.4) return false;
  }
  return true;
}
function regDoor(model, obj) {
  const d = DOORTAB[(model || '').toLowerCase()]; if (!d) return;
  if (!(Math.abs(d.slide[0]) + Math.abs(d.slide[1]) + Math.abs(d.slide[2]) > 0)) return;   /* wreck rows share names; only sliding doors register */
  const off = V3(d.slide[0] || 0, d.slide[1] || 0, d.slide[2] || 0).applyAxisAngle(V3(0, 1, 0), obj.rotation.y);
  DOORS.push({ name: model, obj, base: obj.position.clone(), off, open: 0, target: 0 });
}
function nearestDoor(p, regionName) {
  // OG pairing is script-side (MAIN_GATE_SWITCH -> Mission1Gate): prefer a
  // gate-class door when the switch names a gate, else the nearest door.
  const gateWant = /GATE/.test(regionName || '');
  let b = null, bd = 1e9;
  for (const D of DOORS) {
    const score = D.obj.position.distanceTo(p) + ((gateWant && /GATE/.test(D.name)) ? 0 : 10000);
    if (score < bd) { bd = score; b = D; }
  }
  return b;
}
async function makeVehicle(model, vm, pos, yaw, team, group) {
  const row = VSTAT[vm.vs]; if (!row) return null;
  let g = await loadGLB(`${MODEL_DIR}/${model}.glb`);
  if (!g) g = await loadGLB(`assets/models/mission1/${model}.glb`);
  if (!g) g = await loadGLB(`assets/models/frontend/${model}.glb`);
  if (!g) return null;
  const m = g.scene.clone(true);
  hideHelpers(m);
  m.position.set(pos[0], pos[1], pos[2]); m.rotation.y = yaw || 0;
  group.add(m); terrain.push(m); m.traverse(o => { if (o.isMesh) terrainMeshes.push(o); });
  const box = new THREE.Box3().setFromObject(m);
  const V = { model, vsName: vm.vs, obj: m, pos: m.position, yaw: yaw || 0, team, weaponId: vm.w || null,
    hp: row[11] != null ? row[11] : 1000, maxHp: row[11] != null ? row[11] : 1000, armour: row[12] != null ? row[12] : 0,
    alive: true, radius: Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2,
    speed: 0, nextShot: 0, stateName: 'STATE_TANK_STOPPED', joy: { f: false, b: false, l: false, r: false }, aiGo: 'stop',
    sm: vehicleRulesText ? new RulesMachine(vehicleRulesText) : null, floorY: pos[1] };
  if (V.sm) V.sm.state = 'STATE_TANK_STOPPED';
  VEHICLES.push(V);
  return V;
}
async function buildWorld() {
  scene.background = new THREE.Color(0.79, 0.83, 0.85);
  scene.fog = new THREE.Fog(new THREE.Color(0.79, 0.83, 0.85), 140, 950);
  const sun = new THREE.DirectionalLight(0xfff2d8, 2.6); sun.position.set(140, 240, 80); scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x8a7a5a, 0.95));
  const group = new THREE.Group(); scene.add(group); worldGroup = group;
  let placed = 0;
  /* P7: preload every distinct model concurrently (was: serialized awaits),
     then instance the single-mesh repeats (trees, rocks, furniture) as
     InstancedMesh — one draw call per model instead of per placement.
     Anything multi-mesh, skinned, animated, a door model, or the bridge
     keeps the clone path below. */
  const urlOf = inst => inst.dir ? `assets/models/${inst.dir}/${inst.model}.glb` : `${MODEL_DIR}/${inst.model}.glb`;
  const modelUrls = [...new Set(MISSION.instances.filter(i => i.model && i.model !== 'NOTEXTURE').map(urlOf))];
  let modelsDone = 0;
  await Promise.all(modelUrls.map(u => loadGLB(u).then(() => {
    modelsDone++;
    if (STEPFN && (modelsDone % 10 === 0 || modelsDone === modelUrls.length))
      STEPFN(`LOADING MODELS ${modelsDone}/${modelUrls.length}`, 0.1 + 0.55 * modelsDone / modelUrls.length);
  })));
  if (STEPFN) STEPFN('BUILDING THE ZONE', 0.68);
  /* OG sky: the game textures a sky dome with a per-mission M<n>_SKY1 bitmap.
     Mission 1's own sky bitmap is absent from the supplied archives (GAP —
     only its .sky descriptor name survives in Mission1.dll), so the game's
     own M4SKY1 sky bitmap stands in until the raw archive lands. */
  try {
    const skyTex = new THREE.TextureLoader().load('assets/ui/bitmaps/M4SKY1.png');
    skyTex.wrapS = skyTex.wrapT = THREE.RepeatWrapping;
    skyTex.repeat.set(6, 2);
    skyTex.colorSpace = THREE.SRGBColorSpace;
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 24, 12),
      new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false }));
    sky.renderOrder = -1;
    group.add(sky);
  } catch (e) { /* flat background colour remains */ }
  const instGroups = new Map();
  const yawOf = inst => inst.ry != null ? inst.ry : -(inst.r[1] * Math.PI / 180);
  for (const inst of MISSION.instances) {
    if (!inst.model || inst.model === 'NOTEXTURE') continue;
    const vu = (MISSION.vehicleUnits || []).find(v => !v._done && v.model === inst.model && Math.hypot(v.pos[0] - inst.w[0], v.pos[2] - inst.w[2]) < 2);
    if (vu && VMAP[vu.model.toUpperCase()] || vu && VMAP[vu.model]) { /* placed below as a live vehicle */ }
    else {
    const g = await loadGLB(urlOf(inst));
    if (!g) continue;
    let meshCount = 0, soleMesh = null, skinned = false;
    g.scene.traverse(o => { if (o.isMesh) { meshCount++; soleMesh = o; if (o.isSkinnedMesh) skinned = true; } });
    const canInstance = meshCount === 1 && !skinned && !(g.animations && g.animations.length)
      && !DOORTAB[(inst.model || '').toLowerCase()] && inst.model !== 'MIS1_ZONE1_BRIDGE'
      && !HELPER_MODEL_RE.test(inst.model || '');
    if (canInstance) {
      const key = urlOf(inst);
      if (!instGroups.has(key)) instGroups.set(key, { g, mesh: soleMesh, list: [] });
      instGroups.get(key).list.push(inst);
      continue;
    }
    const m = g.scene.clone(true);
    hideHelpers(m);
    if (HELPER_MODEL_RE.test(inst.model || '')) m.visible = false;
    m.position.set(inst.w[0], inst.w[1], inst.w[2]);
    m.rotation.y = yawOf(inst);
    if (inst.s && (inst.s[0] !== 1 || inst.s[2] !== 1)) m.scale.set(inst.s[0], inst.s[1], inst.s[2]);
    group.add(m); terrain.push(m); placed++;
    m.traverse(o => { if (o.isMesh) terrainMeshes.push(o); });
    if (inst.model === 'MIS1_ZONE1_BRIDGE') {
      const box = new THREE.Box3().setFromObject(m);
      bridgePoint = box.getCenter(V3()); bridgePoint.y = box.max.y;
    }
    regDoor(inst.model, m);
    }
  }
  for (const { g, mesh, list } of instGroups.values()) {
    if (list.length === 1) {   // no saving: clone path for singles
      const inst = list[0];
      const m = g.scene.clone(true);
      hideHelpers(m);
      m.position.set(inst.w[0], inst.w[1], inst.w[2]);
      m.rotation.y = yawOf(inst);
      if (inst.s && (inst.s[0] !== 1 || inst.s[2] !== 1)) m.scale.set(inst.s[0], inst.s[1], inst.s[2]);
      group.add(m); terrain.push(m); placed++;
      m.traverse(o => { if (o.isMesh) terrainMeshes.push(o); });
      regDoor(inst.model, m);
      continue;
    }
    mesh.updateMatrix();
    if (mesh.geometry && mesh.geometry.hasAttribute('color')) {
      mesh.geometry.deleteAttribute('color');
      const ms = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of ms) if (m) { m.vertexColors = false; m.side = THREE.DoubleSide; }
    }
    shadeWorld(mesh);
    const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, list.length);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), S = V3(), P = V3();
    list.forEach((inst, i) => {
      E.set(0, yawOf(inst), 0); Q.setFromEuler(E);
      P.set(inst.w[0], inst.w[1], inst.w[2]);
      S.set(inst.s ? inst.s[0] : 1, inst.s ? inst.s[1] : 1, inst.s ? inst.s[2] : 1);
      M.compose(P, Q, S).multiply(mesh.matrix);
      im.setMatrixAt(i, M);
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.computeBoundingSphere) im.computeBoundingSphere();
    im.matrixAutoUpdate = false;
    group.add(im); terrain.push(im); terrainMeshes.push(im); placed += list.length;
  }
  for (const vu of MISSION.vehicleUnits || []) {
    if (vu._done) continue;
    const vm = VMAP[vu.model] || VMAP[vu.model.toUpperCase()];
    if (!vm) continue;
    vu._done = true;
    await makeVehicle(vu.model, vm, vu.pos, vu.yaw || 0, vu.team || 'iq', group);
  }
  // the Black Hawk (HLOI vehicle placement, or props.vehicles for survivors)
  const hawk = MISSION.units.find(u => u.model === 'BLACKHAWK_UH60') ||
    ((MISSION.vehicles || []).find(v => v.kind === 'hawk') || {}).pos && { pos: (MISSION.vehicles || []).find(v => v.kind === 'hawk').pos, yaw: (MISSION.vehicles || []).find(v => v.kind === 'hawk').yaw };
  if (hawk) {
    const g = await loadGLB('assets/models/frontend/BLACKHAWK_UH60.glb');
    if (g) { const m = g.scene.clone(true); m.position.set(hawk.pos[0], hawk.pos[1], hawk.pos[2]); m.rotation.y = hawk.yaw; group.add(m); terrain.push(m); m.traverse(o => { if (o.isMesh) terrainMeshes.push(o); }); }
  }
  /* HLOI statics: structures, vehicles, props, pickups (the bridge is one!) */
  if (MISSION_ID === 'mission1' || MISSION_ID === 'training1') {
    const seenStatic = new Set();
    for (const u of MISSION.units) {
      if (/^(HERO|IRAQ|IR_)/.test(u.model)) continue;
      const key = u.model + '@' + u.pos.map(v => v.toFixed(1)).join(',');
      if (seenStatic.has(key)) continue;
      seenStatic.add(key);
      const vm = VMAP[u.model];
      if (vm) { await makeVehicle(u.model, vm, u.pos, u.yaw || 0, u.script === 'BRIDGE_BMP' ? 'iq' : 'us', group); continue; }
      const g = await loadGLB(`assets/models/mission1/${u.model}.glb`);
      if (!g) continue;
      const m = g.scene.clone(true);
      m.position.set(u.pos[0], u.pos[1], u.pos[2]); m.rotation.y = u.yaw || 0;
      group.add(m); terrain.push(m);
      m.traverse(o => { if (o.isMesh) terrainMeshes.push(o); });
      regDoor(u.model, m);
    }
  }
  /* P7: freeze every static world matrix (doors and vehicles keep theirs —
     they move). three.js then skips ~4k matrixWorld recomputes per frame. */
  {
    const movers = new Set();
    for (const D of DOORS) movers.add(D.obj);
    for (const V of VEHICLES) movers.add(V.obj);
    STATIC_FROZEN = 0;
    worldGroup.traverse(o => {
      if (movers.has(o)) return;
      o.updateMatrix();
      if (o.matrixAutoUpdate) { o.matrixAutoUpdate = false; STATIC_FROZEN++; }
      o.matrixWorldNeedsUpdate = true;
    });
  }
  return placed;
}

/* OG EVOs embed editor/collision geometry (#BSP_* shells, connectors,
   markers) and the ENV places outright invisible blockers. None of it may
   render; it stays in the physics lists, invisible. */
const HELPER_RE = /#BSP|CONNECTOR|MARKER|HELPER|COLLISION/i;
const HELPER_MODEL_RE = /INVISIBLE|BLOCKING|BLOCKER|DYNBOX|_SHADOW/i;
function shadeWorld(obj) {
  const apply = m => { if (m) m.side = THREE.DoubleSide; };
  const one = o => {
    if (!o.isMesh) return;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    ms.forEach(apply);
  };
  if (obj.isMesh) one(obj); else obj.traverse(one);
}
function hideHelpers(root) {
  shadeWorld(root);
  root.traverse(o => {
    // hide the mesh, never the node — guns parent to connector bones
    if (o.isMesh && HELPER_RE.test(o.name || '')) o.visible = false;
    else if (!o.isMesh && !o.isBone && /#BSP|COLLISION/i.test(o.name || '')) o.visible = false;
    if (o.isMesh && o.geometry && o.geometry.hasAttribute('color')) {
      o.geometry.deleteAttribute('color');
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of ms) if (m) m.vertexColors = false;   // else the shader samples black
    }
  });
}

/* ---------------- actors ---------------- */
function makeActor(gltf, name, team) {
  const obj = gltf.scene ? skClone(gltf.scene) : gltf;
  obj.traverse(o => {
    if (HELPER_RE.test(o.name || '')) o.visible = false;
    if (!o.isMesh) return;
    if (o.geometry && o.geometry.hasAttribute('color')) o.geometry.deleteAttribute('color');
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of ms) if (m) m.vertexColors = false;
  });
  const clips = gltf.animations || [];
  const mixer = new THREE.AnimationMixer(obj);
  const byName = {};
  for (const c of clips) {
    // the clips carry root translation; playing it AND moving the actor
    // slides the mesh off its feet. Locomotion is the actor position.
    if (!c.userData._rootStripped) {
      c.tracks = c.tracks.filter(t => t.name !== 'BIP01.position');
      c.userData._rootStripped = true;
    }
    if (!byName[c.name]) byName[c.name] = mixer.clipAction(c);
  }
  const A = {
    obj, mixer, byName, clips, name, team, alive: true, hp: 100, maxHp: 100,
    pos: obj.position, yaw: 0, vy: 0, speed: 0, mode: 'stand', airborne: false,
    animFinished: false, deathDir: null, curClip: null, nextShot: 0, held: 0, inv: [],
    joy: { f: false, b: false, l: false, r: false }, aiGo: null, moveMode: 'RUN', stateT: 0, landT: 0, floorY: null,
    sm: null, stateName: '', aimingNow: false,
    setClip(name, fade = 0.16, once = false) {
      const a = this.byName[name];
      if (!a || this.curClip === a) return;
      if (this.curClip) this.curClip.fadeOut(fade);
      a.reset(); a.enabled = true; a.fadeIn(fade);
      if (once) { a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true; }
      a.play(); this.curClip = a;
    },
    update(dt) { this.mixer.update(dt); }
  };
  scene.add(obj);
  allActors.push(A);
  return A;
}
function prepWorn(root) {
  root.traverse(o => {
    if (!o.isMesh) return;
    if (o.geometry && o.geometry.hasAttribute('color')) o.geometry.deleteAttribute('color');
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of ms) if (m) m.vertexColors = false;
  });
}
function boneNamed(root, name) {
  const want = (name || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  let found = null;
  root.traverse(o => { if (!found && (o.name || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_') === want) found = o; });
  return found;
}
/* CONNOBJS.TXT: equipment worn by role and faction, on a named connector. */
function attachGear(A, role) {
  const rows = (CONNOBJS[role] || []).filter(r => r.faction === 'US');
  const table = GRIPS[A.modelKey] || GRIPS.HERO01_ARMSTRONG || {};
  for (const row of rows) {
    const grip = table[(row.connector || '').toUpperCase()];
    if (!grip) continue;
    loadGLB(`assets/models/gear/${row.model}.glb`).then(g => {
      if (!g) { A.wornMiss = (A.wornMiss || []).concat(row.model); return; }
      const bone = boneNamed(A.obj, grip.host || grip.parent);
      if (!bone) { A.wornMiss = (A.wornMiss || []).concat(row.connector); return; }
      const m = g.scene.clone(true);
      prepWorn(m);
      if (grip.t) m.position.set(grip.t[0], grip.t[1], grip.t[2]);
      if (grip.q) m.quaternion.set(grip.q[0], grip.q[1], grip.q[2], grip.q[3]);
      bone.add(m);
      A.worn = (A.worn || 0) + 1;
    }).catch(e => { A.wornMiss = (A.wornMiss || []).concat(String(e).slice(0, 40)); });
  }
}
function kitSlots(name, lo) {
  const kit = UNITWPNS[name] || { rows: [], wpns: [], items: [] };
  const slots = [];
  const addW = (id, ammo, reserve) => {
    if (slots.some(s => s.id === id)) return;
    const w = wpn(id);
    slots.push({ id, kind: 'WEAPON', ammo: ammo != null ? ammo : (w.mag || 0), reserve: reserve != null ? reserve : (w.mag ? w.mag * 6 : 0), wclass: w.wclass || '' });
  };
  addW((lo && lo.primary) || 'US_WPN_M16A2');
  addW((lo && lo.secondary) || 'US_WPN_SIGP228');
  for (const row of kit.rows || []) {
    if (row.kind === 'WEAPON') {
      const w = wpn(row.id);
      if (/GRENADE/i.test(w.wclass || '') && row.amount <= 0) continue;
      if (/GRENADE/i.test(w.wclass || '')) addW(row.id, row.amount, 0);
      else addW(row.id);
    } else {
      // amount 0 is the table's own count (binoculars), not a guessed stack of 1
      slots.push({ id: row.id, kind: row.kind, ammo: row.amount, reserve: 0, wclass: row.kind, count: row.amount });
    }
  }
  return slots;
}
function heldSpec(slot) {
  if (!slot) return null;
  if (WEAPONS[slot.id]) return WEAPONS[slot.id];
  const row = INVEN[slot.id];
  if (!row) return null;
  return { id: slot.id, model: row.model, icon: row.icon, raw: row.cells, wclass: row.type, aimAnim: '', damage: 0, mag: 0, range: 0, interval: 1, reload: 1, bank: '' };
}
function attachHeld(M) {
  const slot = M && M.inv[M.held];
  if (!slot) return;
  const spec = heldSpec(slot);
  if (spec && spec.model && spec.model !== '-1') attachGun(M, spec);
  else if (M.gunObj) { M.gunObj.parent && M.gunObj.parent.remove(M.gunObj); M.gunObj = null; }
}
function attachGun(A, w) {
  if (A.gunObj) { A.gunObj.parent && A.gunObj.parent.remove(A.gunObj); A.gunObj = null; }
  if (!w || !w.model) return;
  // Weaps.txt column 6 is the attach connector ("Bip01 GunR Connector").
  // Its rest offset is the EVO node TRS (data/tables/grips.json) — the
  // shipped character GLBs omit connector nodes, so the offset is applied
  // onto the connector's parent bone.
  const want = ((w.raw && w.raw[6] && w.raw[6] !== '-1') ? w.raw[6] : 'Bip01 GunR Connector');
  const norm = s => (s || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  loadGLB(`assets/models/frontend/${w.model}.glb`).then(g => g || loadGLB(`assets/models/gear/${w.model}.glb`)).then(g => g || loadGLB(`assets/models/mission1/${w.model}.glb`)).then(g => {
    if (!g) return;
    const table = GRIPS[A.modelKey] || GRIPS.HERO01_ARMSTRONG || {};
    const grip = table[want.toUpperCase()] || table['BIP01 GUNR CONNECTOR'];
    // GLTFLoader turns "BIP01 R HAND" into "BIP01_R_HAND"
    let connector = null, bone = null;
    A.obj.traverse(o => {
      const n = norm(o.name);
      if (!connector && n === norm(want)) connector = o;
      if (!bone && grip && n === norm(grip.host || grip.parent)) bone = o;
      if (!bone && n === 'BIP01_R_HAND') bone = o;
    });
    const host = connector || bone;
    if (!host) return;
    const gun = g.scene.clone(true);
    prepWorn(gun);
    if (!connector && grip && grip.t) {
      gun.position.set(grip.t[0], grip.t[1], grip.t[2]);
      gun.quaternion.set(grip.q[0], grip.q[1], grip.q[2], grip.q[3]);
    }
    host.add(gun); A.gunObj = gun;
  }).catch(() => {});
}

/* ---------------- spawning (from HLOI placements) ---------------- */
async function spawnActors() {
  const heroGLB = {}, foeGLB = {};
  for (const n of ['HERO01_ARMSTRONG', 'HERO02_RAMIREZ', 'HERO03_JONES', 'HERO04_FOLEY'])
    heroGLB[n] = await loadGLB(`assets/models/characters/${n}.glb`);
  const start = MISSION.units.find(u => u.script === 'HERO_BRADLEY') || MISSION.units.find(u => u.hero);
  const foleyU = MISSION.units.find(u => u.script === 'HERO_FOLEY');
  const measured = measureSpeeds(heroGLB.HERO01_ARMSTRONG.animations || []);
  if (measured.run) { SPEEDS = { src: 'clip-root-motion', walk: measured.walk || 1.6, run: measured.run, kneelWalk: measured.kneelWalk || 1.1, crawl: measured.crawl || 0.6 }; }
  const moveText = (await (await fetch('data/tables/movementstaterules.json')).json()).text;
  MOVTXT = moveText;
  const heroNames = ['Bradley', 'Ramirez', 'Jones'];
  const heroFiles = ['HERO01_ARMSTRONG', 'HERO02_RAMIREZ', 'HERO03_JONES'];
  const heroScripts = ['HERO_BRADLEY', 'HERO_RAMIREZ', 'HERO_JONES'];
  for (let i = 0; i < 3; i++) {
    const A = makeActor(heroGLB[heroFiles[i]], heroNames[i], 'us');
    A.modelKey = heroFiles[i];
    A.sm = new RulesMachine(moveText);
    A.sm.state = 'STATE_STANDING_STILL_ACTION_STANCE';
    const urow = UNITS[heroNames[i]];
    A.maxHp = A.hp = HUMANS[urow.hstat].numbers[0];
    const off = [[0, 0], [-1.7, -1.3], [1.7, -1.3]][i];
    const hu = MISSION.units.find(u => u.script === heroScripts[i]);
    if (hu && i > 0) { A.pos.set(hu.pos[0], hu.pos[1] + 0.4, hu.pos[2]); A.floorY = hu.pos[1]; A.yaw = hu.yaw || start.yaw; }
    else { A.pos.set(start.pos[0] + off[0], start.pos[1] + 1.5, start.pos[2] + off[1]); A.floorY = start.pos[1]; A.yaw = start.yaw; }
    const lo = curLoadout[heroNames[i]] || {};
    A.inv = kitSlots(heroNames[i], lo);
    A.held = 0;
    attachHeld(A);
    attachGear(A, urow.role);
    squad.push(A);
  }
  if (foleyU && MISSION_ID !== 'mission1') {
    // survivor missions: Foley's placement is the 4th squad member, not a prisoner
    const A = makeActor(heroGLB.HERO04_FOLEY, 'Foley', 'us');
    A.modelKey = 'HERO04_FOLEY';
    A.sm = new RulesMachine(moveText);
    A.sm.state = 'STATE_STANDING_STILL_ACTION_STANCE';
    A.maxHp = A.hp = HUMANS[UNITS.Foley.hstat].numbers[0];
    A.pos.set(foleyU.pos[0], foleyU.pos[1] + 0.4, foleyU.pos[2]); A.floorY = foleyU.pos[1];
    A.yaw = foleyU.yaw || 0;
    A.inv = kitSlots('Foley', curLoadout.Foley || {});
    A.held = 0;
    attachHeld(A);
    attachGear(A, UNITS.Foley.role);
    squad.push(A);
  }
  if (foleyU && MISSION_ID === 'mission1') {
    const A = makeActor(heroGLB.HERO04_FOLEY, 'Foley', 'pow');
    A.modelKey = 'HERO04_FOLEY';
    A.sm = new RulesMachine(moveText);
    A.maxHp = A.hp = HUMANS[UNITS.Foley.hstat].numbers[0];
    A.pos.set(foleyU.pos[0], foleyU.pos[1] + 0.3, foleyU.pos[2]); A.floorY = foleyU.pos[1];
    A.yaw = foleyU.yaw; A.mode = 'kneel';
    A.inv = kitSlots('Foley', curLoadout.Foley || {});
    A.held = 0;
    attachGear(A, UNITS.Foley.role);
    prisoner = A;
  }
  // hostiles: exactly the placement list (ENV HLOI, or survivor enemiesHLOI;
  // cutscene CS_ actors excluded)
  for (const u of MISSION.units) {
    if (!u.foe && (!/^IRAQ|^IR_/.test(u.model || '') || (u.script || '').startsWith('CS'))) continue;
    if (!foeGLB[u.model]) foeGLB[u.model] = await loadGLB(`assets/models/characters/${u.model}.glb`) || heroGLB.HERO01_ARMSTRONG;
    const A = makeActor(foeGLB[u.model], u.name, 'iq');
    A.modelKey = u.model;
    A.sm = new RulesMachine(moveText);
    const urow = (u.unitName && UNITS[u.unitName]) || unitRowForModel(u.model) || UNITS.Iraqi_Conscript;
    A.maxHp = A.hp = HUMANS[urow.hstat].numbers[0];
    A.pos.set(u.pos[0], u.pos[1] + 0.4, u.pos[2]); A.floorY = u.pos[1];
    A.yaw = u.yaw; A.post = A.pos.clone(); A.script = u.script;
    const kit = UNITWPNS[urow.name] || { wpns: [] };
    A.weaponId = u.weapon || kit.wpns[0] || 'IR_WPN_AK47';
    A.state = 'post'; A.memT = 0; A.lastSeen = null; A.think = Math.random() * 0.3;
    A.wpIdx = nearestWaypoint(A.pos);
    attachGun(A, wpn(A.weaponId));
    enemies.push(A);
  }
  activeIdx = 0;
  camYaw = start.yaw + Math.PI;
}
function nearestWaypoint(p) {
  let bi = -1, bd = 1e12;
  MISSION.waypoints.forEach((w, i) => { const d = (w.pos[0] - p.x) ** 2 + (w.pos[2] - p.z) ** 2; if (d < bd) { bd = d; bi = i; } });
  return bi;
}

/* ---------------- objectives (REGN triggers + .loc text) ---------------- */
function setupObjectives() {
  objectives = []; objIdx = 0; hasC4 = false; planted = false; plantT = 0; kills = 0;
  const reg = n => MISSION.regions.find(r => r.name === n);
  if (MISSION.objectivesMode === 'gap') {
    extractRegion = reg('EXTRACTION') || reg('PICKUP_BLACKHAWK_TRIGGER');
    gapHadHostiles = enemies.length > 0;
    objectives = [{ label: MISSION_LABEL.toUpperCase(), gap: true, done: false,
      text: 'MISSION SCRIPT UNAVAILABLE — IT LIVES IN THE MISSION DLL (RESEARCH R1). FREE COMBAT: CLEAR ALL ' +
        enemies.length + ' HOSTILES' + (extractRegion ? ' OR REACH THE BLACK Hawk EXTRACTION POINT.' : '.') }];
    toast('ARCHIVE GAP — FREE COMBAT', objectives[0].text);
    return;
  }
  c4Region = reg('C4'); extractRegion = reg('PICKUP_BLACKHAWK_TRIGGER'); gateRegion = reg('MAIN_GATE_SWITCH');
  pillarRegion = reg('BRIDGE_BOOM_PILLAR_REGION');
  const boom = reg('BRIDGE_BOOM_GROUND');
  if (boom) bridgePoint = V3(boom.pos[0], boom.pos[1], boom.pos[2]);   /* the game's own plant volume */
  const c4u = MISSION.units.find(u => u.script === 'C4_CHARGE');
  if (c4u) c4PropPos = V3(c4u.pos[0], c4u.pos[1], c4u.pos[2]);
  const labels = ['RESCUE FOLEY', 'FIND THE C4', 'DESTROY THE BRIDGE', 'EXTRACTION'];
  for (let i = 1; i <= 4; i++) {
    const t = LOC_M01['OBJECTIVE' + i + 'A'] || '';
    objectives.push({ label: labels[i - 1], text: t, done: false });
  }
  toast(objectives[0].label, objectives[0].text);
}
function toast(label, text) {
  const el = $('hudObj');
  el.innerHTML = `<b style="color:#ffd75e;letter-spacing:.2em">${label}</b><br>${text}`;
  el.style.opacity = 1;
  clearTimeout(toast._t); toast._t = setTimeout(() => el.style.opacity = 0, 5600);
}

/* ---------------- combat ---------------- */
function eyeOf(A) { return V3(A.pos.x, A.pos.y + (A.mode === 'crawl' ? 0.5 : A.mode === 'kneel' ? 1.05 : 1.55), A.pos.z); }
function chestOf(A) { return V3(A.pos.x, A.pos.y + (A.mode === 'crawl' ? 0.45 : 1.12), A.pos.z); }
function muzzleOf(A) { return eyeOf(A).add(V3(Math.sin(A.yaw), 0, Math.cos(A.yaw)).multiplyScalar(0.5)); }
function spawnTracer(a, b, col) {
  let T = tracers.find(t => t.life <= 0);
  if (!T) {
    if (tracers.length > 40) return;
    T = { obj: new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.025, 1), new THREE.MeshBasicMaterial({ color: 0xffe2ae, transparent: true })), life: 0 };
    T.obj.frustumCulled = false; scene.add(T.obj); tracers.push(T);
  }
  const len = a.distanceTo(b); if (len < 2) return;
  T.obj.material.color.setHex(col);
  T.obj.position.copy(a).lerp(b, 0.5); T.obj.lookAt(b); T.obj.scale.set(1, 1, len);
  T.obj.visible = true; T.life = 0.07;
}
function flashAt(p, big) {
  if (!muzzleTex) return;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: muzzleTex, transparent: true, depthWrite: false, opacity: 0.95 }));
  s.position.copy(p); const sc = big ? 1.6 : 0.85; s.scale.set(sc, sc * 0.6, 1);
  s.material.rotation = Math.random() * 6.3;
  scene.add(s); setTimeout(() => scene.remove(s), 70);
}
function hurt(A, dmg, fromPos, head) {
  if (!A.alive) return;
  A.hp -= dmg;
  if (A.team === 'iq' && fromPos) {
    A.lastSeen = fromPos.clone(); A.memT = 20;
    if (A.state === 'post') A.state = 'alert';
  }
  if (A.hp <= 0) {
    A.alive = false; A.hp = 0;
    if (A.team === 'iq') kills++;
    A.deathDir = head ? 'headshot' : null;
    A.setClip(clipForState(A.clips, 'STATE_STANDING_HEADSHOT_DEATH', false) || 'DEATH', 0.08, true);
    if (A.team === 'iq' && Math.random() < 0.5) bankPlay('Iraqi_Soldier', 'voice', 0.55);
  }
}
function fireHitscan(shooter, targetPoint, dmg, range) {
  const org = muzzleOf(shooter);
  const dir = targetPoint.clone().sub(org).normalize();
  let best = null, bestT = 1e9;
  const pool = shooter.team === 'us' ? enemies : squad.concat(prisoner && prisoner.team === 'us' ? [prisoner] : []);
  for (const T of pool) {
    if (!T.alive || T === shooter) continue;
    const to = chestOf(T).clone().sub(org); const t = to.dot(dir);
    if (t < 1 || t > range) continue;
    const p = org.clone().add(dir.clone().multiplyScalar(t));
    const dH = p.distanceTo(V3(T.pos.x, T.pos.y + 1.5, T.pos.z));
    const dB = p.distanceTo(chestOf(T));
    if (Math.min(dH, dB) < 0.62 && t < bestT) { bestT = t; best = { T, head: dH < dB, point: p }; }
  }
  for (const V of VEHICLES) {
    if (!V.alive || V.team === shooter.team) continue;
    const c = V3(V.pos.x, V.pos.y + 1.1, V.pos.z);
    const to = c.clone().sub(org); const t = to.dot(dir);
    if (t < 1 || t > range) continue;
    const p = org.clone().add(dir.clone().multiplyScalar(t));
    if (p.distanceTo(c) < Math.max(1.6, V.radius) && t < bestT) { bestT = t; best = { V, point: p }; }
  }
  spawnTracer(org, best ? best.point : org.clone().add(dir.multiplyScalar(range * 0.6)), shooter.team === 'us' ? 0xffe2ae : 0xffc9a0);
  flashAt(org, false);
  if (best) {
    if (best.V) hurtVehicle(best.V, dmg, best.point);
    else hurt(best.T, dmg * (best.head ? 3 : 1), shooter.pos, best.head);   // headshot x3: PROVISIONAL (R3)
  }
  return best;
}
function hurtVehicle(V, dmg, point) {
  if (!V.alive) return { penetrated: false, hp: V.hp };
  if (dmg <= V.armour) { flashAt(point, false); return { penetrated: false, hp: V.hp }; }
  V.hp -= dmg;
  flashAt(point, true);
  if (V.hp <= 0) { V.hp = 0; V.alive = false; explodeVehicle(V); }
  return { penetrated: true, hp: V.hp };
}
function explodeVehicle(V) {
  for (let i = 0; i < 4; i++) setTimeout(() => flashAt(V3(V.pos.x, V.pos.y + 1.5, V.pos.z).add(V3(rand(-1, 1), rand(0, 1), rand(-1, 1))), true), i * 160);
  bankPlay('Explosion', 'boom', 1);
  V.obj.traverse(o => { if (o.isMesh) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) if (m && m.color) m.color.multiplyScalar(0.22); } });
  if (driving === V) exitVehicle();
}
function gunNoise(pos, r) {
  for (const E of enemies) if (E.alive && E.pos.distanceTo(pos) < r && E.state === 'post') {
    E.state = 'alert'; E.lastSeen = pos.clone(); E.memT = 14;
  }
}
function useItem(M, slot, now) {
  if (now < (M.nextShot || 0)) return;
  const row = INVEN[slot.id];
  if (!row || (slot.ammo || 0) <= 0) return;
  if (slot.kind === 'MEDI KIT') {
    // INVEN field 9 is unnamed in the modkit column map. MediKit's own row is 100; night vision is 0.
    const heal = parseFloat(row.cells[9]) || 0;
    const useS = parseFloat(row.cells[10]) || 0.75;
    if (heal > 0) M.hp = Math.min(M.maxHp, M.hp + heal);
    slot.ammo--;
    M.nextShot = now + useS * 1000;
    hudDirty = true;
    snd('assets/sounds/frontend/Interface/Interface_line53.wav', 0.5);
  }
}
function heroFire(now) {
  const M = squad[activeIdx];
  if (!M || !M.alive || M.reloading) return;
  const slot = M.inv[M.held];
  if (!slot) return;
  if (slot.kind && slot.kind !== 'WEAPON') { useItem(M, slot, now); return; }
  const w = wpn(slot.id);
  if (now < (M.nextShot || 0)) return;
  if ((w.mag || 0) === 0) {
    // Weaps range is 0 for the knife. 1.5m is a PROVISIONAL reach so the listed damage can land.
    const reach = 1.5;
    let best = null, bd = reach;
    for (const E of enemies) {
      if (!E.alive) continue;
      const d = E.pos.distanceTo(M.pos);
      if (d < bd) { bd = d; best = E; }
    }
    if (best) hurt(best, w.damage, chestOf(best), false);
    M.nextShot = now + (w.interval || 0.6) * 1000;
    bankPlay(w.bank, 'shot', 0.7);
    return;
  }
  if (slot.ammo <= 0) { doReload(M); return; }
  M.nextShot = now + w.interval * 1000;
  slot.ammo--;
  const dirV = V3(-Math.sin(camYaw) * Math.cos(camPitch), Math.sin(camPitch), -Math.cos(camYaw) * Math.cos(camPitch));
  const target = camera.position.clone().add(dirV.multiplyScalar(w.range || 400));
  M.yaw = camYaw + Math.PI;
  bankPlay(w.bank, 'shot', 0.8);
  gunNoise(M.pos, 55);
  fireHitscan(M, target, w.damage, w.range);
}
function doReload(M) {
  const slot = M.inv[M.held], w = wpn(slot.id);
  if (slot.ammo >= w.mag || slot.reserve <= 0 || M.reloading) return;
  M.reloading = true;
  const clipName = clipExact(M.clips, w.reloadAnim);
  if (clipName) M.setClip(clipName, 0.1, true);
  snd('assets/sounds/frontend/Interface/Interface_line54.wav', 0.4);
  setTimeout(() => {
    const take = Math.min(w.mag - slot.ammo, slot.reserve);
    slot.ammo += take; slot.reserve -= take; M.reloading = false;
  }, w.reload * 1000);
}
function switchHero(i) {
  if (i < 0 || i >= squad.length || !squad[i].alive || i === activeIdx) return;
  activeIdx = i; camYaw = squad[i].yaw + Math.PI; hudDirty = true;
}
function switchWeapon(d) {
  const M = squad[activeIdx]; if (!M) return;
  M.held = ((M.held + d) % M.inv.length + M.inv.length) % M.inv.length;
  attachHeld(M);
  snd('assets/sounds/frontend/Interface/Interface_line53.wav', 0.4);
  hudDirty = true;
}

/* ---------------- AI ---------------- */
const wallRay = new THREE.Raycaster();
const _wallN = new THREE.Vector3();
function wallAhead(A, nx, nz) {
  const dx = nx - A.pos.x, dz = nz - A.pos.z, d = Math.hypot(dx, dz);
  if (d < 1e-4 || !terrainMeshes.length) return false;
  wallRay.set(V3(A.pos.x, A.pos.y + 0.9, A.pos.z), V3(dx / d, 0, dz / d));
  wallRay.far = d + 0.32;
  const hits = wallRay.intersectObjects(terrainMeshes, false);
  for (const h of hits) {
    if (!h.face || h.object.isInstancedMesh) continue;
    _wallN.copy(h.face.normal).transformDirection(h.object.matrixWorld);
    if (_wallN.y < 0.4) return true;
  }
  return false;
}
function moveActor(A, tx, tz, speed, dt, keepYaw) {
  const dx = tx - A.pos.x, dz = tz - A.pos.z, d = Math.hypot(dx, dz);
  if (d < 0.25) { A.speed = 0; return true; }
  const step = Math.min(d, speed * dt);
  const nx = A.pos.x + dx / d * step, nz = A.pos.z + dz / d * step;
  const commit = (x, z) => {
    if (floorFor(A, x, z) - floorFor(A, A.pos.x, A.pos.z) > 1.15 && !A.airborne) return false;
    if (wallAhead(A, x, z)) return false;
    A.pos.x = x; A.pos.z = z;
    if (!keepYaw) A.yaw = Math.atan2(dx, dz);
    A.speed = speed;
    return true;
  };
  if (commit(nx, nz) || commit(nx, A.pos.z) || commit(A.pos.x, nz)) return d - step < 0.35;
  A.speed = 0;
  return false;
}
function sense(E, dt) {
  E.think -= dt; if (E.think > 0) return;
  E.think = 0.22;
  let seen = null, sd = 1e9;
  for (const M of squad.concat(prisoner && prisoner.team === 'us' ? [prisoner] : [])) {
    if (!M.alive) continue;
    const d = E.pos.distanceTo(M.pos);
    if (d > 95) continue;   // perception range: PROVISIONAL pending HStat semantics (R3)
    const ang = Math.abs(((Math.atan2(M.pos.x - E.pos.x, M.pos.z - E.pos.z) - E.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    const near = d < 7 || (M === squad[activeIdx] && M.mode === 'stand' && d < 15);
    if ((ang < 1.15 || near) && losClear(eyeOf(E), chestOf(M)) && d < sd) { seen = M; sd = d; }
  }
  if (seen) { E.state = 'engage'; E.target = seen; E.lastSeen = seen.pos.clone(); E.memT = 22; }
  else if (E.memT > 0) { E.memT -= 0.22; if (E.state === 'engage') E.state = 'alert'; if (E.memT <= 0) { E.state = 'post'; E.target = null; } }
}
function enemyAct(E, dt, now) {
  if (!E.alive) return;
  sense(E, dt);
  const w = wpn(E.weaponId);
  let moving = false;
  if (E.state === 'engage' && E.target && E.target.alive) {
    const T = E.target, d = E.pos.distanceTo(T.pos);
    if (!E.barked) { E.barked = true; say('Iraqi_Soldier', null, 0, d); }  // first-contact bark (bank Iraqi_Soldier)
    E.yaw = Math.atan2(T.pos.x - E.pos.x, T.pos.z - E.pos.z);
    if (d > 55) { moveActor(E, T.pos.x, T.pos.z, SPEEDS.run, dt); moving = E.speed > 0; }
    else if (losClear(eyeOf(E), chestOf(T)) && now > (E.nextShot || 0)) {
      E.nextShot = now + w.interval * 1000 * rand(2.2, 3.4);
      bankPlay(w.bank, 'shot', 0, d);
      gunNoise(E.pos, 40);
      const spread = clamp(0.02 + d / 900, 0.02, 0.09);
      fireHitscan(E, chestOf(T).add(V3(rand(-1, 1) * spread * d, rand(-0.4, 0.8) * spread * d, rand(-1, 1) * spread * d)), w.damage, w.range);
    }
  } else if (E.state === 'alert' && E.lastSeen) {
    moveActor(E, E.lastSeen.x, E.lastSeen.z, SPEEDS.walk * 1.5, dt); moving = E.speed > 0;
  } else if (E.wpIdx >= 0 && MISSION.waypoints[E.wpIdx]) {
    const wp = MISSION.waypoints[E.wpIdx];
    const d = Math.hypot(wp.pos[0] - E.pos.x, wp.pos[2] - E.pos.z);
    if (d > 30) { /* too far from the graph: hold the post */ }
    else if (moveActor(E, wp.pos[0], wp.pos[2], SPEEDS.walk, dt)) {
      if (wp.next >= 0 && MISSION.waypoints[wp.next]) E.wpIdx = wp.next;
    } else moving = E.speed > 0;
  }
  E.aiGo = moving ? 'f' : 'stop';
  E.aimingNow = E.state === 'engage';
  driveActor(E, dt);
}
function mateAct(M, dt, now) {
  if (!M.alive || M === squad[activeIdx]) return;
  const L = squad[activeIdx], idx = squad.indexOf(M);
  const bx = L.pos.x - Math.sin(L.yaw) * 2.6 + Math.cos(L.yaw) * (idx - 1) * 2.0;
  const bz = L.pos.z - Math.cos(L.yaw) * 2.6 - Math.sin(L.yaw) * (idx - 1) * 2.0;
  const d = Math.hypot(bx - M.pos.x, bz - M.pos.z);
  if (d > 1.7) { moveActor(M, bx, bz, d > 16 ? SPEEDS.run : SPEEDS.walk * 1.9, dt); M.aiGo = 'f'; }
  else { M.speed = 0; M.yaw = L.yaw; M.aiGo = 'stop'; }
  M.moveMode = L.moveMode;
  let best = null, bd = 62;
  for (const E of enemies) {
    if (!E.alive) continue;
    const dd = M.pos.distanceTo(E.pos);
    if (dd < bd && losClear(eyeOf(M), chestOf(E))) { best = E; bd = dd; }
  }
  if (best && now > (M.nextShot || 0)) {
    const w = wpn(M.inv[M.held].id);
    M.nextShot = now + w.interval * 1000 * 2.6;
    M.yaw = Math.atan2(best.pos.x - M.pos.x, best.pos.z - M.pos.z);
    bankPlay(w.bank, 'shot', 0, bd);
    fireHitscan(M, chestOf(best), w.damage, w.range);
  }
  driveActor(M, dt);
}
/* the state machine drives the body: conditions from real sim quantities */
function speedForState(A) {
  const s = A.stateName || '';
  if (/CRAWLING/.test(s)) return SPEEDS.crawl;
  if (/KNEELING_WALKING/.test(s)) return SPEEDS.kneelWalk;
  if (/RUNNING|JOGGING/.test(s)) return SPEEDS.run;
  if (/WALKING/.test(s)) return SPEEDS.walk;
  return SPEEDS.walk;
}
function driveActor(A, dt) {
  A.stateT = (A.stateT || 0) + dt;
  A.animFinished = false;
  if (!A.airborne && /LANDING/.test(A.stateName || '')) { A.landT += dt; if (A.landT > 0.35) A.animFinished = true; }
  else A.landT = 0;
  if (/^STATE_BLENDING/.test(A.stateName || '') && A.stateT > 0.3) A.animFinished = true;
  if (A.curClip && A.curClip.loop === THREE.LoopOnce && A.curClip.time >= A.curClip.getClip().duration - 0.03) A.animFinished = true;
  const ctx = { speed: A.speed || 0, mode: A.moveMode, joy: A.joy, aiGo: A.aiGo, aiming: A.aimingNow,
    alive: A.alive, airborne: A.airborne, animFinished: A.animFinished, deathDir: A.deathDir };
  const before = A.stateName;
  A.stateName = A.sm.tick(ctx);
  if (A.stateName !== before) A.stateT = 0;
  A.mode = /CRAWLING/.test(A.stateName) ? 'crawl' : /KNEELING/.test(A.stateName) ? 'kneel' : 'stand';
  const held = A.inv && A.inv[A.held];
  const weapon = held ? (WEAPONS[held.id] || null) : (A.weaponId ? wpn(A.weaponId) : null);
  const clip = clipForState(A.clips, A.stateName, A.aimingNow, weapon, A.strafe);
  // transition states (START_*, STOPPING, DYING) play their clip once: the
  // OG rules leave them via MSR_ANIM_FINISHED, which can only fire if the
  // clip actually finishes (it never does on a loop)
  if (clip) A.setClip(clip, 0.16, /^STATE_(START|BLENDING)|STOPPING|DYING|DEATH/.test(A.stateName));
  let gy = floorFor(A, A.pos.x, A.pos.z);
  if (!groundList(A.pos.x, A.pos.z).length && A.floorY != null) gy = A.floorY;   /* HLOI placement height is the floor where geometry has none */
  if (A.pos.y > gy + 0.3) { A.vy -= 22 * dt; A.pos.y = Math.max(gy, A.pos.y + A.vy * dt); A.airborne = A.pos.y > gy + 0.3; if (!A.airborne) A.vy = 0; }
  else { A.pos.y = gy; A.airborne = false; A.vy = 0; }
  A.obj.rotation.y = A.yaw;
  A.update(dt);
}

function vehicleAct(V, dt, now) {
  if (!V.alive || driving === V) return;
  if (V.sm) V.stateName = V.sm.tick({ speed: Math.abs(V.speed || 0), joy: V.joy, aiGo: V.aiGo, alive: V.alive, animFinished: true, facingDest: true });
  if (V.team !== 'iq' || !V.weaponId) return;
  let T = null, bd = 240;
  for (const M of squad) {
    if (!M.alive) continue;
    const d = M.pos.distanceTo(V.pos);
    if (d < bd && losClear(V3(V.pos.x, V.pos.y + 2.2, V.pos.z), chestOf(M))) { T = M; bd = d; }
  }
  if (!T) return;
  const want = Math.atan2(T.pos.x - V.pos.x, T.pos.z - V.pos.z);
  const dy = ((want - V.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  V.yaw += clamp(dy, -0.4 * dt, 0.4 * dt); V.obj.rotation.y = V.yaw;
  if (Math.abs(dy) < 0.12 && now > (V.nextShot || 0)) {
    const w = wpn(V.weaponId);
    V.nextShot = now + w.interval * 1000 * rand(1.6, 2.6);
    bankPlay(w.bank, 'shot', 0, bd);
    const gunner = { pos: V3(V.pos.x, V.pos.y + 1.6, V.pos.z), yaw: V.yaw, team: 'iq', mode: 'stand' };
    fireHitscan(gunner, chestOf(T).add(V3(rand(-1, 1) * bd * 0.02, 0, rand(-1, 1) * bd * 0.02)), w.damage, w.range || 900);
  }
}
function enterVehicle(V) {
  driving = V;
  const M = squad[activeIdx];
  if (M) { M.obj.visible = false; M.pos.copy(V.pos); }
  toast('DRIVING ' + V.model.replace(/_/g, ' '), 'WASD DRIVE · MOUSE FIRE · F EXIT — vehicle speeds PROVISIONAL (.DYN = R3)');
}
function exitVehicle() {
  if (!driving) return;
  const M = squad[activeIdx];
  if (M) { M.pos.set(driving.pos.x + 3.2, driving.pos.y + 0.3, driving.pos.z); M.floorY = driving.pos.y; M.obj.visible = true; }
  driving = null;
}
function vehicleFire(V, now) {
  if (now < (V.nextShot || 0)) return;
  const w = wpn(V.weaponId); V.nextShot = now + w.interval * 1000;
  bankPlay(w.bank, 'shot', 0.9);
  const dirV = V3(-Math.sin(camYaw) * Math.cos(camPitch), Math.sin(camPitch), -Math.cos(camYaw) * Math.cos(camPitch));
  const gunner = { pos: V3(V.pos.x, V.pos.y + 1.8, V.pos.z), yaw: camYaw + Math.PI, team: 'us', mode: 'stand' };
  fireHitscan(gunner, gunner.pos.clone().add(dirV.multiplyScalar(w.range || 900)), w.damage, w.range || 900);
  gunNoise(V.pos, 70);
}
function driveVehicle(dt, now) {
  const V = driving, M = squad[activeIdx];
  if (!M || !M.alive || !V.alive) { exitVehicle(); return; }
  V.joy.f = down('FORWARD'); V.joy.b = down('BACKWARD'); V.joy.l = down('STRAFE_LEFT'); V.joy.r = down('STRAFE_RIGHT');
  if (V.sm) V.stateName = V.sm.tick({ speed: Math.abs(V.speed), joy: V.joy, aiGo: null, alive: true, animFinished: true, facingDest: true });
  const vmax = /BACKWARDS/.test(V.stateName) ? -3 : /MOVING_FORWARDS/.test(V.stateName) ? 9 : 0;   // PROVISIONAL (.DYN)
  V.speed += clamp(vmax - V.speed, -6 * dt, 3.2 * dt);
  const turn = V.joy.l ? 1 : V.joy.r ? -1 : 0;
  if (turn && (Math.abs(V.speed) > 0.2 || /TURNING/.test(V.stateName))) V.yaw += turn * 0.55 * dt * (V.speed < 0 ? -1 : 1);
  V.pos.x += Math.sin(V.yaw) * V.speed * dt;
  V.pos.z += Math.cos(V.yaw) * V.speed * dt;
  V.pos.y = floorFor(V, V.pos.x, V.pos.z);
  V.obj.rotation.y = V.yaw;
  M.pos.copy(V.pos); M.yaw = V.yaw;
  if (firing && V.weaponId) vehicleFire(V, now);
  const head = V3(V.pos.x, V.pos.y + 2.7, V.pos.z);
  const back = V3(Math.sin(camYaw) * Math.cos(camPitch), -Math.sin(camPitch), Math.cos(camYaw) * Math.cos(camPitch));
  const cd = head.clone().add(back.multiplyScalar(aiming ? 5 : 8.5));
  cd.y = Math.max(cd.y, groundH(cd.x, cd.z) + 0.4);
  camera.position.lerp(cd, 1 - Math.pow(0.0001, dt));
  camera.lookAt(head.clone().add(V3(-Math.sin(camYaw), 0.4, -Math.cos(camYaw)).multiplyScalar(24)));
  $('hudXhair').style.display = V.weaponId ? 'block' : 'none';
}

/* ---------------- interaction & objectives progress ---------------- */
let hudDirty = true;
function interactTick(dt) {
  const M = squad[activeIdx];
  const pr = $('hudPrompt');
  if (!M || !M.alive) { pr.style.display = 'none'; return; }
  let prompt = null, act = null;
  if (driving) { prompt = keyLabel('ACTION') + ' — EXIT ' + driving.model.replace(/_/g, ' '); act = () => exitVehicle(); }
  else if (objIdx === 0 && prisoner) {
    if (M.pos.distanceTo(prisoner.pos) < 6) { prompt = keyLabel('ACTION') + ' — RESCUE FOLEY'; act = rescueFoley; }
  } else if (objIdx === 1 && c4Region) {
    const cp = c4PropPos || V3(c4Region.pos[0], c4Region.pos[1], c4Region.pos[2]);
    if (M.pos.distanceTo(cp) < 6 || (!c4PropPos && inRegion(M.pos, c4Region))) { prompt = keyLabel('ACTION') + ' — TAKE THE C4'; act = () => {
      hasC4 = true; objectives[1].done = true; objIdx = 2;
      toast(objectives[2].label, objectives[2].text); snd('assets/sounds/frontend/Interface/Interface_line53.wav', 0.6);
      hudDirty = true;
    }; }
  } else if (objIdx === 2 && hasC4 && bridgePoint) {
    const nearPillar = (pillarRegion && inRegion(M.pos, pillarRegion)) ||
      (Math.hypot(M.pos.x - bridgePoint.x, M.pos.z - bridgePoint.z) < 9 && Math.abs(M.pos.y - bridgePoint.y) < 20);
    if (nearPillar) {
      if (plantT > 0) {
        prompt = 'PLANTING THE C4…';
        plantT -= dt; M.moveMode = 'KNEEL';
        if (plantT <= 0) explodeBridge();
      } else { prompt = keyLabel('ACTION') + ' — PLANT THE C4 ON THE STRUT'; act = () => { plantT = 2.6; }; }
    }
  } else if (objIdx === 3 && extractRegion) {
    const c = V3(extractRegion.pos[0], extractRegion.pos[1], extractRegion.pos[2]);
    const foley = squad.find(s => s.name === 'Foley');
    if (M.pos.distanceTo(c) < Math.max(10, extractRegion.r || 0) || inRegion(M.pos, extractRegion)) {
      if (!foley || foley.pos.distanceTo(c) < 30) { missionEnd(true); return; }
      prompt = 'FOLEY MUST REACH THE LZ';
    }
  }
  if (!prompt && !driving) {
    for (const r of MISSION.regions) {
      if (!/SWITCH/.test(r.name)) continue;
      if (inRegion(M.pos, r) || M.pos.distanceTo(V3(r.pos[0], M.pos[1], r.pos[2])) < Math.max(4, r.r || 0)) {
        const D = nearestDoor(M.pos, r.name);
        if (D) { prompt = keyLabel('ACTION') + ' — OPERATE THE GATE SWITCH'; act = () => { D.target = D.target ? 0 : 1; snd('assets/sounds/frontend/Interface/Interface_line53.wav', 0.6); }; }
        break;
      }
    }
  }
  if (!prompt && !driving) {
    for (const V of VEHICLES) {
      if (V.alive && M.pos.distanceTo(V.pos) < 6.5) { prompt = keyLabel('ACTION') + ' — DRIVE ' + V.model.replace(/_/g, ' '); act = () => enterVehicle(V); break; }
    }
  }
  if (prompt) { pr.textContent = prompt; pr.style.display = 'block'; } else pr.style.display = 'none';
  const actDown = down('ACTION');
  if (actDown && !interactTick.latch) {
    interactTick.latch = true;
    if (act) act();
    else if (!driving) doReload(M);
  }
  if (!actDown) interactTick.latch = false;
}
function rescueFoley() {
  prisoner.team = 'us';
  attachGun(prisoner, wpn(prisoner.inv[0].id));
  squad.push(prisoner); prisoner = null;
  objectives[0].done = true; objIdx = 1;
  voiceLine(0.9);   // Foley, rescued (bank Speech, hash-recovered lines)
  toast(objectives[1].label, objectives[1].text);
  buildCards(); hudDirty = true;
}
function explodeBridge() {
  planted = true; objectives[2].done = true; objIdx = 3;
  for (let i = 0; i < 5; i++) setTimeout(() => flashAt(bridgePoint.clone().add(V3(rand(-5, 5), rand(0, 4), rand(-5, 5))), true), i * 170);
  bankPlay('Explosion', 'boom', 1);
  radioLine(0.7);   // HQ radio on objective complete (bank Radio)
  toast(objectives[3].label, objectives[3].text);
  hudDirty = true;
}
let stingerEl = null;
function missionEnd(won, why = '') {
  running = false;
  // R2: the game's own end-of-mission music (Data/Sound DS-Mission* containers)
  missionMusic(false);
  const sting = won ? 'assets/music/DS-MissionSuccess.wav' : 'assets/music/DS-MissionFailure.wav';
  AUDIO_LOG.push(sting);
  try { if (stingerEl) stingerEl.pause(); stingerEl = new Audio(sting); stingerEl.volume = 0.55; stingerEl.play().catch(() => {}); } catch (e) { }
  $('endTitle').innerHTML = '';
  $('endTitle').appendChild(cdsText(won ? 'MISSION COMPLETE' : S('FAILURE', 'MISSION FAILED'), { scale: 2.4, color: won ? '#9dc25e' : '#e0684e' }));
  $('endSub').textContent = won ? 'All objectives achieved — extraction complete' : why;
  $('endMenu').innerHTML = ''; $('endMenu').appendChild(cdsText(S('QUIT_TO_FE', 'MAIN MENU'), { scale: 1.4 }));
  const er = $('endRestart');
  if (er) { er.innerHTML = ''; er.appendChild(cdsText(S('RESTART', 'RESTART LEVEL'), { scale: 1.4 })); }
  $('hudEnd').style.display = 'block';
}

/* ---------------- HUD ---------------- */
function buildCards() {
  $('hudSquad').innerHTML = squad.map((M, i) =>
    `<div class="scard2" id="sc${i}" style="width:88px;background:rgba(12,16,8,.72);border:1px solid #5c663f;border-radius:3px;padding:4px;text-align:center">
       <div style="font-size:10.5px;letter-spacing:.1em;color:#e8e4cf">${dispName(M.name)}</div>
       <div style="height:5px;background:#30160f;margin-top:3px"><i id="shp${i}" style="display:block;height:100%;background:#9dc25e"></i></div>
     </div>`).join('');
}
let lastHud = 0;
function updateHud(now) {
  if (!hudDirty && now - lastHud < 150) return;
  lastHud = now; hudDirty = false;
  squad.forEach((M, i) => {
    const b = $('shp' + i); if (b) b.style.width = clamp(M.hp / M.maxHp * 100, 0, 100) + '%';
    const c = $('sc' + i); if (c) { c.style.outline = i === activeIdx ? '2px solid #ffd75e' : 'none'; c.style.opacity = M.alive ? 1 : 0.35; }
  });
  const M = squad[activeIdx];
  if (M && M.inv.length) {
    const slot = M.inv[M.held], w = heldSpec(slot) || wpn(slot.id);
    $('hudGunName').textContent = slotLabel(slot);
    $('hudAmmo').textContent = (slot.kind && slot.kind !== 'WEAPON' ? String(slot.ammo || 0) : `${slot.ammo} / ${slot.reserve}`) + (M.reloading ? '  RELOADING' : '');
    const gi = GWINT_IDX[w.icon];
    $('hudGunIcon').src = gi ? 'assets/ui/gwint/' + gi.file : '';
    $('hudGunIcon').style.visibility = gi ? 'visible' : 'hidden';
  }
}
let GWINT_IDX = {};
let GRIPS = {};

/* ---------------- player ---------------- */
function snapCamera() {
  const M = squad[activeIdx];
  if (!M || !camera) return;
  const dist = aiming ? 2.0 : 4.4;
  const back = V3(Math.sin(camYaw) * Math.cos(camPitch), -Math.sin(camPitch), Math.cos(camYaw) * Math.cos(camPitch));
  const head = V3(M.pos.x, M.pos.y + 1.62, M.pos.z);
  camera.position.copy(head.clone().add(back.multiplyScalar(dist)));
  camera.position.y = Math.max(camera.position.y, groundH(camera.position.x, camera.position.z) + 0.45);
  camera.lookAt(head.clone().add(V3(-Math.sin(camYaw), 0.12, -Math.cos(camYaw)).multiplyScalar(14)));
}
function updatePlayer(dt, now) {
  const M = squad[activeIdx];
  if (!M || !M.alive) return;
  if (driving) { driveVehicle(dt, now); return; }
  // A/D are STRAFE (default.key), not the movement-rule joystick. MSR_JOYSTICK_LEFT/RIGHT
  // only enter turn-on-the-spot. Comma/period are TURN and move the camera; the body follows it.
  if (down('TURN_LEFT') && !invOpen) camYaw += 1.6 * dt;    // keyboard turn rate: PROVISIONAL
  if (down('TURN_RIGHT') && !invOpen) camYaw -= 1.6 * dt;
  if (down('WALK')) { if (M.moveMode === 'RUN') M.moveMode = 'WALK'; }
  else if (M.moveMode === 'WALK') M.moveMode = 'RUN';
  const fwdHeld = down('FORWARD') && !invOpen;
  const backHeld = down('BACKWARD') && !invOpen && !fwdHeld;
  const strafeL = down('STRAFE_LEFT') && !invOpen;
  const strafeR = down('STRAFE_RIGHT') && !invOpen && !strafeL;
  M.joy.f = fwdHeld; M.joy.b = backHeld; M.joy.l = false; M.joy.r = false;
  const f = (fwdHeld ? 1 : 0) - (backHeld ? 1 : 0);
  const s = (strafeR ? 1 : 0) - (strafeL ? 1 : 0);   // +s is strafe right, along the camera's right
  M.strafe = (f || s) ? { f: f > 0, b: f < 0, l: s < 0, r: s > 0 } : null;
  M.yaw = camYaw + Math.PI;   // visual forward is (sin yaw, cos yaw); camera looks the other way
  if (f || s) {
    const sin = Math.sin(camYaw), cos = Math.cos(camYaw);
    const wx = s * cos - f * sin, wz = -f * cos - s * sin;
    const len = Math.hypot(wx, wz) || 1;
    const spd = (!fwdHeld && !backHeld) ? (M.moveMode === 'CRAWL' ? SPEEDS.crawl : M.moveMode === 'KNEEL' ? SPEEDS.kneelWalk : M.moveMode === 'WALK' ? SPEEDS.walk : SPEEDS.run) : speedForState(M);
    moveActor(M, M.pos.x + wx / len * 10, M.pos.z + wz / len * 10, spd, dt, true);
    M.yaw = camYaw + Math.PI;
  } else M.speed = 0;
  M.aimingNow = aiming;
  if ((firing || firingKey) && !invOpen) heroFire(now);
  driveActor(M, dt);
  const dist = aiming ? 2.0 : 4.4;
  const back = V3(Math.sin(camYaw) * Math.cos(camPitch), -Math.sin(camPitch), Math.cos(camYaw) * Math.cos(camPitch));
  const head = V3(M.pos.x, M.pos.y + 1.62, M.pos.z);
  const cd = head.clone().add(back.multiplyScalar(dist));
  cd.y = Math.max(cd.y, groundH(cd.x, cd.z) + 0.35);
  camera.position.lerp(cd, 1 - Math.pow(0.0001, dt));
  const look = head.clone().add(V3(-Math.sin(camYaw) * Math.cos(camPitch), Math.sin(camPitch), -Math.cos(camYaw) * Math.cos(camPitch)).multiplyScalar(30));
  camera.lookAt(look);
  camera.fov += ((aiming ? 38 : 62) - camera.fov) * Math.min(1, dt * 10);
  camera.updateProjectionMatrix();
  $('hudXhair').style.display = aiming ? 'block' : 'none';
}

/* ---------------- main loop ---------------- */
function frame() {
  if (!running) return;
  raf = requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  const now = performance.now();
  if (!paused && cutscene) {
    tickCutscene(dt);
  } else if (!paused) {
    updatePlayer(dt, now);
    for (const M of squad) if (M !== squad[activeIdx]) mateAct(M, dt, now);
    for (const E of enemies) enemyAct(E, dt, now);
    for (const V of VEHICLES) vehicleAct(V, dt, now);
    for (const D of DOORS) if (D.open !== D.target) { D.open = clamp(D.open + Math.sign(D.target - D.open) * dt / 2.2, 0, 1); D.obj.position.copy(D.base).addScaledVector(D.off, D.open); }
    if (objectives[0] && objectives[0].gap && !objectives[0].done) {
      if (gapHadHostiles && !enemies.some(e => e.alive)) { objectives[0].done = true; missionEnd(true); }
      else if (kills > 0 && extractRegion && squad.some(s => s.alive && s.pos.distanceTo(V3(extractRegion.pos[0], s.pos[1], extractRegion.pos[2])) < Math.max(extractRegion.r || 0, 12))) { objectives[0].done = true; missionEnd(true); }
    }
    if (prisoner) { driveActor(prisoner, dt); }
    for (const T of tracers) if (T.life > 0) { T.life -= dt; T.obj.material.opacity = Math.max(0, T.life / 0.07); if (T.life <= 0) T.obj.visible = false; }
    interactTick(dt);
    updateHud(now);
    if (!squad.some(s => s.alive)) missionEnd(false, 'The squad is down.');
    else if (prisoner && !prisoner.alive) missionEnd(false, 'Foley is down.');
  }
  renderer.render(scene, camera);
}

/* ---------------- input ---------------- */
let inputBound = false;
function bindInput() {
  if (inputBound) return; inputBound = true;
  addEventListener('keydown', e => {
    if (!running) return;
    keys[e.code] = true;
    if (cutscene) { if ((BIND.MOVIE_CANCEL || []).includes(e.code)) endCutscene(); return; }
    if (invOpen) {
      const M = squad[activeIdx];
      if (M && (BIND.INVENTORY_UP || []).includes(e.code)) { invSel = (invSel + M.inv.length - 1) % M.inv.length; renderInv(); }
      if (M && (BIND.INVENTORY_DOWN || []).includes(e.code)) { invSel = (invSel + 1) % M.inv.length; renderInv(); }
      return;
    }
    if (paused && !(BIND.PAUSE || []).includes(e.code)) return;
    if ((BIND.GRUNT_1 || []).includes(e.code)) switchHero(0);
    if ((BIND.GRUNT_2 || []).includes(e.code)) switchHero(1);
    if ((BIND.GRUNT_3 || []).includes(e.code)) switchHero(2);
    if ((BIND.GRUNT_4 || []).includes(e.code)) switchHero(3);
    if ((BIND.NEXT_GRUNT || []).includes(e.code)) { e.preventDefault(); cycleHero(1); }
    if ((BIND.PREV_GRUNT || []).includes(e.code)) { e.preventDefault(); cycleHero(-1); }
    if ((BIND.STANCE || []).includes(e.code)) { e.preventDefault(); cycleStance(); }
    if ((BIND.FIRE || []).includes(e.code)) firingKey = true;
    if ((BIND.INVENTORY || []).includes(e.code)) openInv();
    if ((BIND.OBJECTIVES || []).includes(e.code)) { e.preventDefault(); toggleObjectives(); }
    if ((BIND.PAUSE || []).includes(e.code)) { paused = !paused; $('hudPause').style.display = paused ? 'block' : 'none'; }
  });
  addEventListener('keyup', e => {
    keys[e.code] = false;
    if ((BIND.FIRE || []).includes(e.code)) firingKey = false;
    if ((BIND.INVENTORY || []).includes(e.code)) closeInv(true);
  });
  const stage = $('gameStage');
  let dragging = false, lx = 0, ly = 0;
  stage.addEventListener('mousedown', e => {
    if (!running || paused) return;
    if (cutscene) { if (e.button === 0) endCutscene(); return; }
    if (e.button === 0) { firing = true; if (document.pointerLockElement !== renderer.domElement) { dragging = true; lx = e.clientX; ly = e.clientY; } }
    if (e.button === 2) aiming = true;
  });
  addEventListener('mouseup', e => { if (e.button === 0) { firing = false; dragging = false; } if (e.button === 2) aiming = false; });
  stage.addEventListener('click', () => { if (running && !paused && document.pointerLockElement !== renderer.domElement) renderer.domElement.requestPointerLock && renderer.domElement.requestPointerLock(); });
  addEventListener('mousemove', e => {
    if (!running || paused) return;
    if (document.pointerLockElement === renderer.domElement) { camYaw -= e.movementX * 0.0026; camPitch = clamp(camPitch + e.movementY * 0.0022, -0.9, 1.1); }
    else if (dragging) { camYaw -= (e.clientX - lx) * 0.005; camPitch = clamp(camPitch + (e.clientY - ly) * 0.004, -0.9, 1.1); lx = e.clientX; ly = e.clientY; }
  });
  stage.addEventListener('contextmenu', e => e.preventDefault());
  $('pzResume').addEventListener('click', () => { paused = false; $('hudPause').style.display = 'none'; });
  $('pzRestart').addEventListener('click', async () => { $('hudPause').style.display = 'none'; paused = false; await restart(); });
  $('pzQuit').addEventListener('click', () => { stopSim(); onExitCb && onExitCb(); });
  $('endMenu').addEventListener('click', () => { stopSim(); onExitCb && onExitCb(); });
  const erEl = $('endRestart');
  if (erEl) erEl.addEventListener('click', async () => { $('hudEnd').style.display = 'none'; await restart(); running = true; frame(); });
}
async function restart() {
  if (stingerEl) { try { stingerEl.pause(); } catch (e) { } stingerEl = null; }
  missionMusic(true);
  for (const A of allActors) { scene.remove(A.obj); }
  squad = []; enemies = []; allActors = []; prisoner = null;
  await spawnActors();
  setupObjectives(); buildCards(); hudDirty = true;
}
function stopSim() { running = false; cancelAnimationFrame(raf); missionMusic(false); if (stingerEl) { try { stingerEl.pause(); } catch (e) { } stingerEl = null; } }
let musicEl2 = null;
function missionMusic(on) {
  if (musicEl2) { try { musicEl2.pause(); } catch (e) { } musicEl2 = null; }
  if (!on) return;
  // Data/Sound DS-* containers, decoded (R2). Which track a mission's DLL
  // selected is not recovered (R1); the desert theatre uses DesertMusic1
  // until that choice is known. Not synthesized.
  const track = 'assets/music/DS-DesertMusic1.wav';
  AUDIO_LOG.push(track);
  try { musicEl2 = new Audio(track); musicEl2.loop = true; musicEl2.volume = 0.32; musicEl2.play().catch(() => {}); } catch (e) { }
}

/* ---------------- entry ---------------- */
export async function startSim({ loadout, onExit, onStep, missionId, missionLabel }) {
  const perfT0 = performance.now();
  MISSION_ID = missionId || 'mission1';
  MISSION_LABEL = missionLabel || MISSION_ID.toUpperCase();
  MODEL_DIR = MISSION_ID === 'mission1' ? 'assets/models/mission1'
    : MISSION_ID === 'training1' ? 'assets/models/training1' : `assets/models-survivors/${MISSION_ID}`;
  curLoadout = {};
  for (const name of ['Bradley', 'Ramirez', 'Jones', 'Foley']) {
    const lo = (loadout || {})[name];
    if (!lo) continue;
    const kitRows = (awaitUnitWpns())[name] || { wpns: [], items: [] };
    curLoadout[name] = lo;
    curLoadout[name]._kit = kitRows;
  }
  onExitCb = onExit;
  STEPFN = onStep || null;
  if (worldGroup) { scene.remove(worldGroup); worldGroup = null; }
  for (const A of allActors) scene.remove(A.obj);
  terrain.length = 0; terrainMeshes.length = 0; hCache.clear();
  VEHICLES = []; DOORS = []; driving = null;
  squad = []; enemies = []; allActors = []; prisoner = null;
  bridgePoint = null; extractRegion = null; c4Region = null; c4PropPos = null; pillarRegion = null; gateRegion = null;
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setClearColor(0xc9d4d9, 1);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.setSize(innerWidth, innerHeight);
    $('gameStage').appendChild(renderer.domElement);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 2200);
    clock = new THREE.Clock();
    muzzleTex = new THREE.TextureLoader().load('assets/ui/bitmaps/M15SHOTA.png');
    addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
  }
  const wj = await jget('data/tables/weapons.json'); WEAPONS = {}; for (const r of wj) WEAPONS[r.id] = r;
  const hj = await jget('data/tables/humans.json'); HUMANS = {}; for (const r of hj) HUMANS[r.name] = r;
  const uj = await jget('data/tables/units.json'); UNITS = {}; for (const r of uj) UNITS[r.name] = r;
  UNITS.Iraqi_Conscript = UNITS.Iraqi_Conscript || { name: 'Iraqi_Conscript', model: 'IRAQINFANTRY01_SANDY', hstat: 'IR_Infantryman00' };
  const uwj = await jget('data/tables/unitwpns.json'); UNITWPNS = {};
  for (const r of uwj) {
    const bag = UNITWPNS[r.id] = UNITWPNS[r.id] || { wpns: [], items: [], rows: [] };
    const row = { id: r.cells[1], kind: r.cells[2], amount: parseInt(r.cells[3], 10) || 0 };
    bag.rows.push(row);
    (row.kind === 'WEAPON' ? bag.wpns : bag.items).push(row.id);
  }
  const ij = await jget('data/tables/inven.json'); INVEN = {};
  for (const r of ij) INVEN[r.id] = { id: r.id, type: r.cells[1], model: r.cells[2], icon: r.cells[5], cells: r.cells };
  CONNOBJS = await jget('data/tables/connobjs.json').catch(() => ({}));
  const vj = await jget('data/tables/vehicles.json'); VSTAT = {}; for (const r of vj) VSTAT[r.name] = r.numbers;
  const dj = await jget('data/tables/doors.json'); DOORTAB = {};
  for (const r of dj) { const c = r.cells; DOORTAB[(c[1] || '').toLowerCase()] = { slide: [parseFloat(c[5]) / 100 || 0, parseFloat(c[6]) / 100 || 0, parseFloat(c[7]) / 100 || 0] }; }
  vehicleRulesText = (await jget('data/tables/vehiclestaterules.json').catch(() => ({}))).text || '';
  GRIPS = await jget('data/tables/grips.json').catch(() => ({}));
  const dk = await jget('data/tables/defaultkey.json').catch(() => ({}));
  BIND = {}; for (const a in dk) BIND[a] = dk[a].map(tok2code).filter(Boolean);
  GEN = await jget('data/loc/black_decade_Catalog_0001_GenStrs_loc.json').catch(() => ({}));
  LOC_M01 = await jget(MISSION_ID === 'training1' ? 'data/loc/black_decade_Training1_T01Strs_loc.json' : 'data/loc/black_decade_Mission1_M01Strs_loc.json').catch(() => ({}));
  SOUND_SUBDIR = (MISSION_ID === 'mission1' || MISSION_ID === 'training1') ? MISSION_ID : null;
  BANK_SAMPLES = SOUND_SUBDIR ? await jget(SOUND_SUBDIR === 'mission1' ? 'data/bank-samples.json' : `data/bank-samples-${SOUND_SUBDIR}.json`).catch(() => ({})) : {};
  GWINT_IDX = await jget('assets/ui/gwint/index.json').catch(() => ({}));
  onStep && onStep('SQUAD, WEAPONS & ZONE DATA', 0.08);
  MISSION = await jget(`data/missions/${MISSION_ID}.json`);
  const placed = await buildWorld();
  PERF.worldMs = Math.round(performance.now() - perfT0);
  onStep && onStep('DEPLOYING SQUAD', 0.78);
  await spawnActors();
  PERF.actorsMs = Math.round(performance.now() - perfT0 - PERF.worldMs);
  setupObjectives(); buildCards(); hudDirty = true;
  for (const id of ['pzTitle', 'pzResume', 'pzRestart', 'pzQuit']) {
    const el = $(id); el.innerHTML = '';
    el.appendChild(cdsText({ pzTitle: S('PAUSE', 'PAUSED'), pzResume: S('QUITTER', 'RESUME'), pzRestart: S('RESTART', 'RESTART LEVEL'), pzQuit: S('QUIT_TO_FE', 'MAIN MENU') }[id], { scale: 1.5 }));
  }
  bindInput();
  running = true; paused = false;
  onStep && onStep('INTRO SEQUENCE', 0.95);
  if (!(await startCutscene(cutShots()))) { missionMusic(true); snapCamera(); }
  PERF.totalMs = Math.round(performance.now() - perfT0);
  frame();
  return { placed };
}
function awaitUnitWpns() { return UNITWPNS; }

/* ---------------- test hooks ---------------- */
window.CDS_SIM = {
  state: () => ({
    playing: running, mission: MISSION_ID, speeds: SPEEDS,
    vehicles: VEHICLES.map(v => ({ model: v.model, vs: v.vsName, team: v.team, hp: v.hp, maxHp: v.maxHp, armour: v.armour, alive: v.alive, state: v.stateName, pos: v.pos.toArray().map(x => Math.round(x)) })),
    gates: DOORS.map(d => ({ name: d.name, open: +d.open.toFixed(2), target: d.target })),
    driving: driving ? driving.model : null,
    squad: squad.map(s => ({ name: dispName(s.name), state: s.stateName, clip: s.curClip ? s.curClip.getClip().name : '', hp: Math.round(s.hp), alive: s.alive, mode: s.mode, pos: s.pos.toArray().map(v => Math.round(v * 10) / 10), ammo: s.inv[s.held] ? s.inv[s.held].ammo : 0, held: s.inv[s.held] ? s.inv[s.held].id : '', inv: (s.inv || []).map(x => x.id), worn: s.worn || 0, wornMiss: s.wornMiss || [] })),
    active: activeIdx,
    prisoner: prisoner ? { pos: prisoner.pos.toArray(), alive: prisoner.alive } : null,
    enemies: { total: enemies.length, alive: enemies.filter(e => e.alive).length, sample: enemies.filter(e => e.alive).slice(0, 3).map(e => ({ hp: e.hp, state: e.state, pos: e.pos.toArray().map(v => Math.round(v)) })) },
    objIdx, hasC4, objectives: objectives.map(o => o.label), bridge: bridgePoint ? bridgePoint.toArray().map(v => Math.round(v)) : null,
    extract: extractRegion ? extractRegion.pos : null, c4: c4PropPos ? c4PropPos.toArray() : (c4Region ? c4Region.pos : null)
  }),
  key: (c, d = true) => { keys[c] = d; },
  tap: (c) => { keys[c] = true; setTimeout(() => { keys[c] = false; }, 150); },
  endMission: (won) => missionEnd(!!won, 'test hook'),
  guns: () => allActors.filter(a => a.team !== 'cs').map(a => ({ name: a.name, team: a.team, gun: !!(a.gunObj && a.gunObj.parent) })),
  fire: d => { firing = d; },
  aim: d => { aiming = d; },
  setMode: m => { if (squad[activeIdx]) squad[activeIdx].moveMode = m; },
  warp: (x, z) => { const M = squad[activeIdx]; if (M) { M.pos.x = x; M.pos.z = z; M.pos.y = groundH(x, z) + 0.2; } },
  look: (yaw, pitch) => { if (yaw != null) camYaw = yaw; if (pitch != null) camPitch = pitch; snapCamera(); },
  pause: (d, silent) => { paused = !!d; const el = document.getElementById('hudPause'); if (el) el.style.display = (paused && !silent) ? 'block' : 'none'; },
  frameActor: (mode) => {
    const M = squad[activeIdx]; if (!M || !camera) return null;
    const f = V3(Math.sin(M.yaw), 0, Math.cos(M.yaw));
    const side = V3(Math.cos(M.yaw), 0, -Math.sin(M.yaw));
    const p = M.pos.clone();
    if (mode === 'front') p.add(f.clone().multiplyScalar(3.6));
    else if (mode === 'side') p.add(side.clone().multiplyScalar(3.2));
    else p.add(f.clone().multiplyScalar(-4.2));
    p.y += 1.35;
    camera.position.copy(p);
    camera.lookAt(M.pos.x, M.pos.y + 1.15, M.pos.z);
    camera.fov = 42; camera.updateProjectionMatrix();
    return { clip: M.curClip ? M.curClip.getClip().name : '', state: M.stateName, worn: M.worn || 0, yaw: +M.yaw.toFixed(2) };
  },
  isolate: () => { squad.forEach((M, i) => { if (i !== activeIdx) { M.pos.x = 400 + i * 5; M.pos.z = 400; } }); },
  gearPos: () => {
    const M = squad[activeIdx]; if (!M) return [];
    M.obj.updateWorldMatrix(true, true);
    const origin = M.obj.getWorldPosition(new THREE.Vector3());
    const fwd = new THREE.Vector3(Math.sin(M.yaw), 0, Math.cos(M.yaw));
    const out = [];
    M.obj.traverse(o => {
      if (!o.isMesh) return;
      const p = o.getWorldPosition(new THREE.Vector3()).sub(origin);
      const along = p.x * fwd.x + p.z * fwd.z;
      out.push({ n: (o.name || '?').slice(0, 28), parent: (o.parent && o.parent.name || '').slice(0, 22), along: +along.toFixed(2), up: +p.y.toFixed(2) });
    });
    return out;
  },
  warpAll: (x, z) => { squad.forEach((M, i) => { M.pos.x = x + i * 1.6; M.pos.z = z + i; M.pos.y = groundH(M.pos.x, M.pos.z) + 0.2; }); },
  ground: (x, z) => groundList(x, z).map(v => +v.toFixed(1)),
  testShot: () => { const M = squad[activeIdx]; let b = null, bd = 1e9; for (const E of enemies) { if (!E.alive || E.hp < E.maxHp) continue; const d = E.pos.distanceTo(M.pos); if (d < bd) { bd = d; b = E; } } if (!b) { for (const E of enemies) { if (!E.alive) continue; const d = E.pos.distanceTo(M.pos); if (d < bd) { bd = d; b = E; } } } if (b) { const before = b.hp; fireHitscan(M, chestOf(b), wpn(M.inv[M.held].id).damage, 900); return { dist: Math.round(bd), before, after: b.hp }; } return null; },
  testVehicleHit: (wid, team) => { const V = VEHICLES.find(v => v.alive && (team ? v.team === team : v.team === 'iq')) || VEHICLES.find(v => v.alive); if (!V) return null; const before = V.hp; const r = hurtVehicle(V, wpn(wid).damage, V3(V.pos.x, V.pos.y + 1, V.pos.z)); return { model: V.model, armour: V.armour, before, after: V.hp, penetrated: r.penetrated, alive: V.alive }; },
  enterVehicle: () => { const V = VEHICLES.find(v => v.alive); if (!V || !squad[activeIdx]) return null; const M = squad[activeIdx]; M.pos.set(V.pos.x + 3, V.pos.y + 0.3, V.pos.z); enterVehicle(V); return V.model; },
  exitVehicle: () => exitVehicle(),
  killNearest: () => { const M = squad[activeIdx]; let b = null, bd = 1e9; for (const E of enemies) { if (!E.alive) continue; const d = E.pos.distanceTo(M.pos); if (d < bd) { bd = d; b = E; } } if (b) hurt(b, 1000, M.pos, false); return bd; },
  audio: () => AUDIO_LOG.slice(-40),
  bindings: () => ({ ...BIND }),
  strings: () => ({ PAUSE: S('PAUSE', 'PAUSED'), RESUME: S('QUITTER', 'RESUME'), RESTART: S('RESTART', 'RESTART LEVEL'), QUIT: S('QUIT_TO_FE', 'MAIN MENU'), FAILURE: S('FAILURE', 'MISSION FAILED'), OBJECTIVE: S('OBJECTIVE', 'OBJECTIVES') }),
  perf: () => ({ drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
    geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
    terrainMeshes: terrainMeshes.length, actors: allActors.length, vehicles: VEHICLES.length,
    timings: { ...PERF }, staticFrozen: STATIC_FROZEN }),
  cutscene: () => cutscene ? { active: true, shot: cutscene.i, shots: cutscene.shots.length, name: (cutscene.shots[cutscene.i] || {}).name || null, csActors: cutscene.actors.length } : { active: false },
  skipCutscene: () => { if (cutscene) endCutscene(); },
  envsnd: () => (MISSION.envsnd || []).map(e => ({ name: e.name, file: e.file, pos: e.pos, rOut: e.rOut, audio: 'GAP: .psf stream absent from supplied archives' }))
};
