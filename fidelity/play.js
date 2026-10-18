import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

// PLAYABLE SLICE — Armstrong (real model/animations) + M16A2 with WEAPS.TXT
// behaviour (mag 30, reload 1.5 s, 86 ms interval), original sounds.

const container = document.getElementById('view');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xc4ad82);
scene.fog = new THREE.Fog(0xc4ad82, 90, 780);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 1600);
camera.position.set(4, 2.6, 8);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);
const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();

scene.add(new THREE.HemisphereLight(0xdfeaff, 0x54482e, 1.0));
const sun = new THREE.DirectionalLight(0xffe2b0, 1.9);
sun.position.set(10, 16, 7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -30; sun.shadow.camera.right = 30;
sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -30;
sun.shadow.camera.far = 120;
scene.add(sun);
const fill = new THREE.DirectionalLight(0xbcd2ff, 0.35);
fill.position.set(-6, 4, -8);
scene.add(fill);

const loader = new GLTFLoader();
const downRay = new THREE.Raycaster();
const DOWN_DIR = new THREE.Vector3(0, -1, 0);
function groundY(x, z) {
  downRay.set(new THREE.Vector3(x, 90, z), DOWN_DIR);
  downRay.far = 220;
  const hits = downRay.intersectObject(world, true);
  return hits.length ? hits[0].point.y : 0;
}
const _gCache = new Map();
function groundYCached(x, z) {
  const k = Math.round(x * 2) + ':' + Math.round(z * 2);
  let v = _gCache.get(k);
  if (v === undefined) { v = groundY(x, z); _gCache.set(k, v); }
  return v;
}
const world = new THREE.Group();
scene.add(world);
const colliders = []; // {x,z,r} simple push-out circles

async function addModel(path, x, z, rotY = 0, colR = 0) {
  const g = await loader.loadAsync(path);
  g.scene.position.set(x, 0, z);
  g.scene.rotation.y = rotY;
  g.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  world.add(g.scene);
  if (colR) colliders.push({ x, z, r: colR });
  return g;
}

// ---- animation / weapon state ----
const ANIM = {
  idle: 'IDLE_LOOK_AROUND_WITH_GUN', aim: 'UPRIGHT_AIM_RIFLE',
  walk: 'UPRIGHT_WALK_WITH_RIFLE', run: 'UPRIGHT_RELAXED_RUN_WITH_RIFLE',
  reload: 'UPRIGHT_RELOAD', crouchWalk: 'CROUCHED_RELAXED_WALK_WITH_RIFLE',
  prone: 'PRONE_AIM_RIFLE', proneCrawl: 'PRONE_CRAWL_WITH_RIFLE',
  proneReload: 'PRONE_RELOAD_RIFLE', crouchAim: 'KNEELING_STANCE_WITH_RIFLE',
  proneTurnL: 'PRONE_TURN_LEFT_WITH_RIFLE', proneTurnR: 'PRONE_TURN_RIGHT_WITH_RIFLE'
};
let mixer = null, actions = {}, current = null;
let heroObj = null, gunConnector = null, rifleObj = null, rifleLObj = null;
const texPairs = []; // {mat, orig, enh}

function setAnim(name, once = false, fade) {
  if (fade === undefined) fade = transitionFade; // stance changes pass a slower blend
  if (!actions[name] || current === name && !once) return;
  if (current && actions[current]) actions[current].fadeOut(fade);
  const a = actions[name];
  a.reset(); a.enabled = true;
  a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat);
  a.clampWhenFinished = once;
  a.fadeIn(fade).play();
  current = name;
}

// Unsharp mask: out = src + (src - 3x3 blur) * amount. Recovers edge detail
// that smoothing upscale loses — visible on faces, hands, fabric, webbing.
function unsharp(ctx, w, h, amount) {
  const src = ctx.getImageData(0, 0, w, h), d = src.data;
  const blur = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = Math.min(w - 1, Math.max(0, x + dx)), yy = Math.min(h - 1, Math.max(0, y + dy));
      const o = (yy * w + xx) * 4; r += d[o]; g += d[o + 1]; b += d[o + 2]; n++;
    }
    const o = (y * w + x) * 3; blur[o] = r / n; blur[o + 1] = g / n; blur[o + 2] = b / n;
  }
  for (let i = 0, o = 0; i < w * h; i++, o += 4) {
    d[o] = d[o] + (d[o] - blur[i * 3]) * amount;
    d[o + 1] = d[o + 1] + (d[o + 1] - blur[i * 3 + 1]) * amount;
    d[o + 2] = d[o + 2] + (d[o + 2] - blur[i * 3 + 2]) * amount;
  }
  ctx.putImageData(src, 0, 0);
}

// texture enhance: 2x canvas upscale + max anisotropy (geometry stays 2002!)
function enhanceTextures(root) {
  root.traverse(o => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach(m => {
      if (!m.map || !m.map.image || texPairs.find(p => p.mat === m)) return;
      m.map.anisotropy = MAX_ANISO;
      try {
        const img = m.map.image;
        const f = Math.min(4, Math.max(1, Math.floor(1024 / img.width))); // cap 1024: unsharp cost
        const c = document.createElement('canvas');
        c.width = img.width * f; c.height = img.height * f;
        const ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        try { ctx.filter = 'contrast(1.06) saturate(1.08)'; } catch (e) {}
        ctx.drawImage(img, 0, 0, c.width, c.height);
        try { ctx.filter = 'none'; unsharp(ctx, c.width, c.height, 0.65); } catch (e) {}
        const enh = new THREE.CanvasTexture(c);
        enh.colorSpace = m.map.colorSpace;
        enh.flipY = m.map.flipY; // glTF textures are unflipped; canvas defaults flipped (scrambled the skin!)
        enh.repeat.copy(m.map.repeat); enh.offset.copy(m.map.offset);
        enh.anisotropy = MAX_ANISO;
        enh.wrapS = m.map.wrapS; enh.wrapT = m.map.wrapT;
        texPairs.push({ mat: m, orig: m.map, enh });
      } catch (e) { /* keep original */ }
    });
  });
}
// menu settings (localStorage, set on the main menu) — declared before first use
const SET = {
  sens: parseFloat(localStorage.getItem('bd_sens') || '1'),
  vol: parseFloat(localStorage.getItem('bd_vol') || '1'),
  enh: localStorage.getItem('bd_enh') !== '0',
  inv: localStorage.getItem('bd_inv') === '1',
};
let texOn = SET.enh;
const _btnTex = document.getElementById('btnTex');
if (_btnTex) _btnTex.addEventListener('click', (e) => {
  texOn = !texOn;
  texPairs.forEach(p => { p.mat.map = texOn ? p.enh : p.orig; p.mat.needsUpdate = true; });
  e.target.textContent = 'Texture enhance: ' + (texOn ? 'ON' : 'OFF');
  e.target.classList.toggle('on', texOn);
});

// two-handed grip alignment (same as scene test, hand sits 2 cm lower)
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _identityQ = new THREE.Quaternion();
const ALIGNED_STATES = ['AIMM_F', 'AIMM_R', 'AIMM_L', 'AIMM_B', 'CAIM_F', 'CAIM_R', 'CAIM_L']; // + ANIM.aim/prone/crouchAim, inline
function alignRifle() {
  if (!gunConnector || !rifleObj || !rifleLObj) return;
  gunConnector.getWorldPosition(_v1);
  rifleLObj.getWorldPosition(_v2);
  _v2.y += 0.02;
  _v2.sub(_v1).normalize();
  rifleObj.getWorldQuaternion(_q1);
  _v3.set(0, 1, 0).applyQuaternion(_q1);
  _q2.setFromUnitVectors(_v3, _v2);
  gunConnector.getWorldQuaternion(_q1);
  _q2.premultiply(_q1.clone().invert()).multiply(_q1);
  rifleObj.quaternion.premultiply(_q2);
}

// ---- sounds (original samples) ----
const shotAudio = ['sounds/M16A2_shot1.wav', 'sounds/M16A2_shot2.wav'].map(s => {
  const a = new Audio(s); a.preload = 'auto'; return a;
});
const clickAudio = new Audio('sounds/M16A2_click.wav'); clickAudio.preload = 'auto';
const akAudio = ['sounds/AK47_shot1.wav', 'sounds/AK47_shot2.wav'].map(s => {
  const a = new Audio(s); a.preload = 'auto'; return a;
});
let akAlt = 0;
function playAK(dist) {
  const a = akAudio[akAlt++ % 2];
  a.volume = THREE.MathUtils.clamp(1.15 - dist / 42, 0.12, 0.75) * SET.vol;
  a.currentTime = 0;
  a.play().catch(() => {});
}
let sAlt = 0;
function playShot() { const a = WPN.snd[WPN.alt++ % 2]; a.volume = 0.55 * SET.vol; a.currentTime = 0; a.play().catch(() => {}); }
function playClick() { clickAudio.currentTime = 0; clickAudio.play().catch(() => {}); }

// ---- player ----
const player = {
  pos: new THREE.Vector3(0, 0, 1.5), yaw: 0.35, stance: 'stand', // stand|crouch|prone
  ammo: 30, reloading: false, reloadT: 0, nextShot: 0, moving: false
};
// role weapons from WEAPS.TXT / Units.txt (Rifleman, Heavy Wpns, Engineer, Sniper)
function wavs(bank) {
  return [1, 2].map(i => { const a = new Audio(`sounds/${bank}_shot${i}.wav`); a.preload = 'auto'; return a; });
}
const WEAPONS = [BD.WEAPONS.M16A2, BD.WEAPONS.SAW, BD.WEAPONS.M16A2, BD.WEAPONS.BARRETT];
Object.values(BD.WEAPONS).forEach(w => { if (w.bank) w.snd = wavs(w.bank); w.alt = 0; });
GF.load();
let WPN = WEAPONS[0];
let prevStance = 'stand', transitionFade = 0.18; // stance changes blend slower (see setAnim)
// Stance ladder: stand(0) -> crouch(1) -> prone(2). Going prone or standing
// always passes through crouch, one step at a time, like the real game.
const STANCES = ['stand', 'crouch', 'prone'];
let stanceIdx = 0, targetStanceIdx = 0, stanceStepT = 0;
let proneLift = 0; // prone-aim pose sits ~9 cm under the floor; smoothed lift
// Authored ground speeds measured from the original clips (planted-foot
// velocity): animation rate = moveSpeed / authored, so feet never slide.
const AUTH = { walk: 1.19, run: 4.07, crouch: 1.01 };

// ---- enemies: IraqInfantry01 body + AK47. #1 insurgent (civilian mismatch),
// #2 Mujahid (cream thobe + 3D robe skirt, keffiyeh, beard, ammo bandolier) ----
const E_ANIM = { walk: 'UPRIGHT_WALK_WITH_RIFLE', aim: 'UPRIGHT_AIM_RIFLE',
  idle: 'IDLE_LOOK_AROUND_WITH_GUN', deathF: 'DEATH_BY_SHOTGUN_FORWARD', deathB: 'DEATH_BY_SHOTGUN_BACKWARD' };

function makeEnemyState(cfg) {
  return Object.assign({ obj: null, mixer: null, actions: {}, current: null, hp: 70, alive: true,
    yaw: 0, state: 'patrol', wp: 0, spotT: 0, lostT: 0, burstLeft: 0, nextShot: 0,
    headBone: null, headGear: null, label: 'HOSTILE', props: [], faceConn: null, hatConn: null, typeIdx: 0 }, cfg);
}
// one enemy type: black-attire insurgent; variety = the game's own faces.
// Placements + patrol waypoint chains come from the real Mission1.env.
let enemies = [];
let ENV = null;
const ENEMY_TEX_POOL = ['textures/Insurgent_F1.png?v=1', 'textures/Insurgent_Officer.png?v=1',
  'textures/Insurgent_Mechanic.png?v=1', 'textures/Insurgent_Torturer.png?v=1'];
function routeFor(px, pz) {
  const wps = ENV.waypoints;
  let best = null, bd = 1e12;
  for (const w of wps) { const d = (w.pos[0] - px) ** 2 + (w.pos[2] - pz) ** 2; if (d < bd) { bd = d; best = w; } }
  if (!best || bd > 2500) {
    return [new THREE.Vector3(px, 0, pz), new THREE.Vector3(px + 7, 0, pz + 5),
            new THREE.Vector3(px - 5, 0, pz + 8), new THREE.Vector3(px + 2, 0, pz - 7)];
  }
  const byId = new Map(wps.map(w => [w.id, w]));
  const route = [new THREE.Vector3(best.pos[0], 0, best.pos[2])];
  let cur = byId.get(best.next), guard = 0;
  while (cur && guard++ < 4) {
    route.push(new THREE.Vector3(cur.pos[0], 0, cur.pos[2]));
    if (cur === best) break;
    cur = byId.get(cur.next);
  }
  return route.length > 1 ? route : [new THREE.Vector3(px, 0, pz), new THREE.Vector3(px + 6, 0, pz + 6)];
}
function buildEnemies() {
  enemies = [];
  const list = ENV.enemies.map(e => ({ pos: e.pos, label: e.inst || 'INSURGENT' }));
  for (const t of ENV.triggers) { // barracks garrisons (original spawn regions)
    if (t.name.startsWith('BARRACKS')) for (let k = 0; k < 2; k++)
      list.push({ pos: [t.pos[0] + k * 6 - 3, 0, t.pos[2] + (k ? 5 : -4)], label: 'BARRACKS GUARD' });
  }
  list.forEach((e, i) => {
    const p = new THREE.Vector3(e.pos[0], 0, e.pos[2]);
    enemies.push(makeEnemyState({ label: e.label, pos: p.clone(), home: p.clone(),
      waypoints: routeFor(p.x, p.z), texture: ENEMY_TEX_POOL[i % 4] }));
  });
}
let playerHP = 100, dmgT = 0;

function enemySetAnim(E, name, once = false) {
  if (!E.actions[name] || E.current === name) return;
  if (E.current && E.actions[E.current]) E.actions[E.current].fadeOut(0.2);
  const a = E.actions[name];
  a.reset(); a.enabled = true;
  a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat);
  a.clampWhenFinished = once;
  a.fadeIn(0.2).play();
  E.current = name;
}

function resetEnemy(E) {
  E.hp = 70; E.alive = true; E.state = 'patrol'; E.wp = 0;
  E.spotT = 0; E.lostT = 0; E.burstLeft = 0;
  E.pos.copy(E.home || E.waypoints[0]);
  if (E.obj) { E.obj.position.copy(E.pos); E.obj.visible = true; }
  Object.values(E.actions).forEach(a => a.stop());
  E.current = null;
  enemySetAnim(E, E_ANIM.walk);
}
// ---- enemy variety: 15 types = game faces x game props (ConnObjs.txt system) ----
// Faces are texture transplants; beards/moustaches plug into BIP01 FACE
// CONNECTOR, hats/shemaghs into BIP01 HAT CONNECTOR — the game's own system.
const FACE_TEX = {
  F1: 'textures/Insurgent_F1.png?v=1', Officer: 'textures/Insurgent_Officer.png?v=1',
  Mechanic: 'textures/Insurgent_Mechanic.png?v=1', Torturer: 'textures/Insurgent_Torturer.png?v=1',
};
const PROP_FILES = {
  Beard01: 'IR_Beard01.glb', Beard02: 'IR_Beard02.glb', Beard03: 'IR_Beard03.glb',
  Moustache01: 'IR_Moustache01.glb', Moustache02: 'IR_Moustache02.glb',
  ShemaghSandy: 'IR_Shemagh04_Sandy.glb', ShemaghRed: 'IR_Shemagh02_RedWhite.glb',
  BeretBlack: 'IR_Beret_Black.glb', BeretSandy: 'IR_Beret_Sandy.glb',
  HelmetGreen: 'IR_Helmet_Green.glb', HelmetWebbing: 'IR_Helmet_Webbing.glb',
  TankHat: 'IR_TankDriverHat.glb',
};
const ROSTER = [
  { face: 'F1', beard: 'Moustache01', hat: null },
  { face: 'Officer', beard: 'Beard01', hat: 'BeretBlack' },
  { face: 'Mechanic', beard: 'Beard02', hat: 'ShemaghSandy' },
  { face: 'Torturer', beard: 'Beard03', hat: null },
  { face: 'F1', beard: 'Beard02', hat: 'ShemaghRed' },
  { face: 'Officer', beard: 'Moustache02', hat: 'HelmetGreen' },
  { face: 'Mechanic', beard: null, hat: 'BeretSandy' },
  { face: 'Torturer', beard: 'Beard01', hat: 'ShemaghSandy' },
  { face: 'F1', beard: 'Beard03', hat: 'HelmetWebbing' },
  { face: 'Officer', beard: null, hat: null },
  { face: 'Mechanic', beard: 'Moustache01', hat: 'TankHat' },
  { face: 'Torturer', beard: 'Moustache02', hat: 'BeretBlack' },
  { face: 'F1', beard: 'Beard01', hat: null },
  { face: 'Officer', beard: 'Beard03', hat: 'ShemaghRed' },
  { face: 'Mechanic', beard: 'Beard02', hat: 'HelmetGreen' },
];
const propCache = {};   // name -> prop scene (clone per enemy)
const faceTexCache = {}; // face key -> THREE texture
let rosterOffset = 0;

function setEnemyType(E, type, typeIdx) {
  E.typeIdx = typeIdx;
  if (!E.obj) return;
  const tex = faceTexCache[type.face];
  if (tex) E.obj.traverse(o => {
    if (o.isMesh && o.name === 'NEWSKIN') {
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      ms.forEach(m => { if (m.map) { m.map = tex; m.needsUpdate = true; } });
    }
  });
  (E.props || []).forEach(p => p.parent && p.parent.remove(p));
  E.props = [];
  const attach = (propName, conn) => {
    if (!propName || !conn || !propCache[propName]) return;
    const c = propCache[propName].clone(true);
    c.traverse(m => { if (m.isMesh) m.castShadow = true; });
    conn.add(c);
    E.props.push(c);
  };
  attach(type.beard, E.faceConn);
  attach(type.hat, E.hatConn);
}

function resetEnemies(advance = false) {
  if (advance) {
    rosterOffset = (rosterOffset + 1) % ROSTER.length;
    enemies.forEach((E, i) => setEnemyType(E, ROSTER[(rosterOffset + i) % ROSTER.length], (rosterOffset + i) % ROSTER.length));
  }
  enemies.forEach(resetEnemy);
}

// ---- the squad: 4 Algerian soldiers, switchable (1-4), follow/hold (F) ----
const SQUAD_DEFS = [
  { name: 'CONNORS', model: 'models/play/Hero02_Ramirez.glb', tex: 'textures/Hero02_DZ_01.png?v=9', slot: [-1.3, -1.6] },
  { name: 'JONES', model: 'models/play/Hero03_Jones.glb', tex: 'textures/Hero03_DZ_01.png?v=3', slot: [1.3, -1.6] },
  { name: 'Foley', model: 'models/play/Hero04_Foley.glb', tex: 'textures/Hero04_DZ_01.png?v=3', slot: [0, -3.2] },
];
const members = [];   // [0] = Armstrong (starts controlled); 1-3 = mates
let activeIdx = 0;
let squadHold = false;
let squadFireFree = true;  // fire discipline: at will / hold fire (G)

function mateSetAnim(M, name, once = false) {
  if (!M.actions[name] || M.current === name) return;
  if (M.current && M.actions[M.current]) M.actions[M.current].fadeOut(0.2);
  const a = M.actions[name];
  a.reset(); a.enabled = true;
  a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat);
  a.clampWhenFinished = once;
  a.fadeIn(0.2).play();
  M.current = name;
}

function hurtEnemy(E, dmg) {
  if (!E.alive) return;
  E.hp -= dmg;
  if (E.hp <= 0) {
    E.alive = false;
    kills++;
    setCanvas('killsCv', GF.text('HOSTILES DOWN ' + kills, { size: 'S', color: '#e8a09a', scale: 1.5 }));
    enemySetAnim(E, Math.random() < 0.5 ? E_ANIM.deathF : E_ANIM.deathB, true);
  }
  updateHUD();
}

function switchTo(i) {
  if (i === activeIdx || !members[i] || !members[i].alive || !members[i].obj) return;
  const old = members[activeIdx];
  old.hp = playerHP;
  old.current = current;
  old.pos.copy(player.pos);
  old.yaw = player.yaw;
  old.ammo = player.ammo;
  const M = members[i];
  activeIdx = i;
  if (old.inv) { const os = old.inv[old.held]; if (os && os.kind === 'gun') os.ammo = player.ammo; }
  if (old.inv && old.held !== 0) { old.held = 0; setHeldModel(old); } // AI hands get the primary back
  if (M.inv) {
    const ms = M.inv[M.held];
    if (ms.kind === 'gun') { WPN = BD.WEAPONS[ms.key]; player.ammo = ms.ammo; }
  }
  buildItemBar(); renderInv();
  player.pos.copy(M.pos);
  player.yaw = M.yaw || player.yaw;
  playerHP = M.hp;
  player.stance = 'stand'; player.stanceTarget = 'stand';
  player.reloading = false; aiming = false; firing = false;
  heroObj = M.obj; mixer = M.mixer; actions = M.actions;
  rifleObj = M.heldObj || M.rifle; gunConnector = M.gunConn; rifleLObj = M.rifleL;
  Object.values(actions).forEach(a => a.stop());
  current = null;
  setAnim(ANIM.idle);
  updateHUD();
}

// ---- full inventory (UnitWpns.txt + Mission1.env loadouts, via loadout.js) ----
const modelCache = {}; // model path -> template scene (cloned per man)
const gearCache = {};
let settledFire = false, nowSec = 0, throwCd = 0, pendingHeal = 0, pendingC4 = 0;
let kills = 0, missionDone = false;
const projectiles = [], rockets = [], smokes = [];
let migObj = null, migPos = new THREE.Vector3(-146.8, 0, -495.6), objMarker = null;
const OBJ = [];
let objIdx = 0;

function makeInv(i) {
  return BD.LOADOUTS[i].map(s => {
    const o = { kind: s.kind, key: s.key, left: s.count !== undefined ? s.count : -1 };
    if (s.kind === 'gun') o.ammo = BD.WEAPONS[s.key].mag * (s.count || 1);
    return o;
  });
}
function heldInfo(M) {
  const s = M.inv[M.held];
  return { slot: s, def: s.kind === 'gun' ? BD.WEAPONS[s.key] : BD.ITEMS[s.key] };
}
function curSlot() { const M = members[activeIdx]; return M && M.inv ? M.inv[M.held] : null; }

function setHeldModel(M) {
  if (!M.gunConn || !M.inv) return;
  if (M.heldObj) { M.gunConn.remove(M.heldObj); M.heldObj = null; }
  const { def } = heldInfo(M);
  const tpl = def && modelCache[def.model];
  if (!tpl) return;
  const c = tpl.clone(true);
  c.traverse(o => { if (o.isMesh) o.castShadow = true; });
  M.gunConn.add(c);
  M.heldObj = c; M.rifle = c;
  if (M === members[activeIdx]) rifleObj = c;
}
function setHeld(i) {
  const M = members[activeIdx];
  if (!M || !M.inv) return;
  M.held = ((i % M.inv.length) + M.inv.length) % M.inv.length;
  player.reloading = false;
  setHeldModel(M);
  const s = M.inv[M.held];
  if (s.kind === 'gun') { WPN = BD.WEAPONS[s.key]; player.ammo = s.ammo; }
  buildItemBar(); renderInv(); updateHUD();
}

// worn kit on the game's own connectors (ConnObjs.txt SAS rows)
const CONN_NAMES = { SPINE1: 'BIP01_SPINE1_CONNECTOR', SPINE2: 'BIP01_SPINE2_CONNECTOR',
  SPINE2L: 'BIP01_SPINE2L_CONNECTOR', SPINE2R: 'BIP01_SPINE2R_CONNECTOR',
  HAT: 'BIP01_HAT_CONNECTOR', FACE: 'BIP01_FACE_CONNECTOR',
  HIPL: 'BIP01_HIPL_CONNECTOR', HIPR: 'BIP01_HIPR_CONNECTOR' };
function attachGear(obj, memberIdx) {
  const conns = {};
  obj.traverse(o => {
    const nm = (o.name || '').toUpperCase().replace(/ /g, '_');
    for (const tok of Object.keys(CONN_NAMES))
      if (nm === CONN_NAMES[tok]) conns[tok] = o;
  });
  for (const [tok, file] of BD.GEAR[memberIdx]) {
    const conn = conns[tok], tpl = gearCache[file];
    if (!conn || !tpl) continue;
    const c = tpl.clone(true);
    c.traverse(m => {
      if (m.isMesh) {
        m.castShadow = true;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        mats.forEach(mt => { if (mt.color) { mt = mt.clone(); mt.color.set(0x9aa183); m.material = mt; } });
      }
    });
    conn.add(c);
  }
}

function throwGrenade(kind) {
  const tpl = modelCache[BD.ITEMS[kind].model];
  if (!tpl) return;
  const o = tpl.clone(true);
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
  o.position.copy(player.pos); o.position.y += 1.5;
  scene.add(o);
  projectiles.push({ obj: o, vel: dir.multiplyScalar(13).add(new THREE.Vector3(0, 4.5, 0)), kind, t: 1.5 });
}
function spawnSmoke(pos) {
  if (!spawnSmoke.tex) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 4, 64, 64, 62);
    g.addColorStop(0, 'rgba(200,200,195,0.85)'); g.addColorStop(1, 'rgba(200,200,195,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    spawnSmoke.tex = new THREE.CanvasTexture(c);
  }
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: spawnSmoke.tex, transparent: true, opacity: 0.75, depthWrite: false }));
  sp.position.copy(pos); sp.position.y += 1.6; sp.scale.setScalar(7);
  scene.add(sp);
  smokes.push({ pos: pos.clone(), t: 10, obj: sp });
}
function explode(pos, r, dmg) {
  flash.position.copy(pos); flash.position.y += 1; flash.intensity = 200; flashT = 0.14;
  impact.position.copy(pos); impact.visible = true; impactT = 0.3; impact.scale.setScalar(r);
  const boom = BD.WEAPONS.LAW66.snd && BD.WEAPONS.LAW66.snd[0];
  if (boom) { boom.volume = 0.8 * SET.vol; boom.currentTime = 0; boom.play().catch(() => {}); }
  for (const E of enemies) {
    if (!E.alive) continue;
    const d = E.pos.distanceTo(pos);
    if (d < r + 1) hurtEnemy(E, dmg * Math.max(0.15, 1 - d / (r + 2)));
  }
  const pd = player.pos.distanceTo(pos);
  if (pd < r * 0.7) { playerHP -= 26 * (1 - pd / (r * 0.7)); dmgT = 0.5; if (playerHP <= 0) playerHP = 1; }
  if (objIdx === 1 && migPos.distanceTo(pos) < 16) completeMig();
}
function fireRocket() {
  const o = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.7), new THREE.MeshBasicMaterial({ color: 0xffca7a }));
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
  o.position.copy(player.pos); o.position.y += 1.45;
  o.lookAt(o.position.clone().add(dir));
  scene.add(o);
  rockets.push({ obj: o, vel: dir.multiplyScalar(42), t: 4 });
}
function tryPlantC4() {
  if (objIdx !== 1) { showMsg('NO TARGET FOR C4'); return; }
  if (dist2D(player.pos, migPos) > 7) { showMsg('GET TO THE MiG TO PLANT THE C4'); return; }
  showMsg('PLANTING C4…');
  pendingC4 = 2.5;
}
function useItem(slot, now) {
  if (now < throwCd) return;
  if (slot.key === 'MEDIKIT') {
    if (slot.left <= 0) { playClick(); return; }
    if (playerHP >= 100) { showMsg('HEALTH FULL'); return; }
    slot.left--; throwCd = now + 1.4; pendingHeal = 1.2;
    showMsg('DRESSING WOUND…'); buildItemBar(); updateHUD();
    return;
  }
  if (slot.key === 'BINOCULARS') return; // RMB zoom while held
  if (slot.key === 'C4') { tryPlantC4(); return; }
  if (slot.left <= 0) { playClick(); return; }
  slot.left--; throwCd = now + 0.55;
  throwGrenade(slot.key);
  buildItemBar(); updateHUD();
}

// ---- mission objectives (triggers named in Mission1.env) ----
const dist2D = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function trigPos(name, fb) {
  const t = ENV && ENV.triggers.find(t => t.name === name);
  return t ? new THREE.Vector3(t.pos[0], 0, t.pos[2]) : fb;
}
function buildObjectives() {
  OBJ.length = 0;
  OBJ.push({ text: 'ADVANCE NORTH — REACH THE BASE GATE', pos: trigPos('MAIN_GATE_SWITCH', new THREE.Vector3(-237.6, 0, -449.4)), r: 26 });
  migPos = trigPos('PROXTRIG_MIG', migPos);
  OBJ.push({ text: 'DESTROY THE CAPTURED MiG — C4 (JONES) OR LAW (Bradley)', pos: migPos, r: 9 });
  OBJ.push({ text: 'FALL BACK TO THE EXTRACTION POINT', pos: trigPos('PICKUP_BLACKHAWK_TRIGGER', new THREE.Vector3(-113.6, 0, -230.8)), r: 14 });
  objMarker = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.TextureLoader().load('textures/ui/gwint/IMAGE_OBJECTIVE.png'), transparent: true, depthTest: false }));
  objMarker.scale.setScalar(2.4);
  scene.add(objMarker);
  setObjectiveText();
}
function setCanvas(id, srcC) {
  const cv = document.getElementById(id);
  if (!cv || !srcC) return;
  cv.width = srcC.width; cv.height = srcC.height;
  cv.getContext('2d').drawImage(srcC, 0, 0);
}
function setObjectiveText() {
  if (!window.GF || !OBJ[objIdx]) return;
  setCanvas('objtext', GF.text(OBJ[objIdx].text, { size: 'S', color: '#ffe9a8', scale: 1.6 }));
  const sub = document.getElementById('objsub');
  if (sub) sub.textContent = 'OBJECTIVE ' + (objIdx + 1) + ' / ' + OBJ.length + ' — MISSION 1 · NORTHERN ALGERIA, 1994';
}
let msgT = 0;
function showMsg(title, sub) {
  setCanvas('msgtext', GF.text(title, { size: 'L', color: '#f0d9a0', scale: 2 }));
  const el = document.getElementById('msg');
  const sb = document.getElementById('msgsub');
  if (sb) sb.innerHTML = sub ? `<span style="font-size:12px;letter-spacing:.2em;color:#cfd4c4;text-shadow:1px 1px 3px #000">${sub}</span>` : '';
  if (el) el.style.opacity = 1;
  msgT = 3.2;
}
function completeMig() {
  if (objIdx !== 1) return;
  objIdx = 2;
  if (migObj) migObj.rotation.z = 0.12;
  spawnSmoke(migPos.clone());
  showMsg('MiG DESTROYED', 'FALL BACK TO THE EXTRACTION POINT');
  setObjectiveText(); updateHUD();
}
function resetSquadToStart() {
  const sp = ENV && ENV.start ? ENV.start.pos : [-120, 0, -234];
  player.pos.set(sp[0], 0, sp[2]);
  player.pos.y = groundYCached(player.pos.x, player.pos.z);
  members.forEach((M, i) => {
    M.alive = true; M.hp = 100;
    if (i !== activeIdx) { M.pos.set(sp[0] + i * 1.6 - 2, player.pos.y, sp[2] + 2 + i); M.obj.visible = true; }
  });
}

function buildItemBar() {
  const bar = document.getElementById('itembar');
  if (!bar) return;
  const M = members[activeIdx];
  if (!M || !M.inv) { bar.innerHTML = ''; return; }
  bar.innerHTML = M.inv.map((s, i) => {
    const def = s.kind === 'gun' ? BD.WEAPONS[s.key] : BD.ITEMS[s.key];
    const empty = (s.kind === 'item' && s.left === 0) || (s.key === 'LAW66' && s.ammo <= 0);
    const cnt = s.kind === 'item' && s.left > 0 ? s.left : (s.key === 'LAW66' ? s.ammo : '');
    return `<div class="slot ${i === M.held ? 'held' : ''} ${empty ? 'empty' : ''}" data-i="${i}"><span class="key">${i === M.held ? 'HELD' : ''}</span><img src="${BD.ICON(def.icon)}"><span class="cnt">${cnt}</span></div>`;
  }).join('');
  bar.querySelectorAll('.slot').forEach(el => el.addEventListener('click', () => setHeld(+el.dataset.i)));
}
let invOpen = false;
function renderInv() {
  if (!invOpen) return;
  const M = members[activeIdx];
  setCanvas('invTitle', GF.text((BD.NAMES[activeIdx] + ' — ' + BD.ROLES[activeIdx] + ' — INVENTORY'), { size: 'L', color: '#f0d9a0', scale: 1.4 }));
  setCanvas('invGearTitle', GF.text('WORN KIT', { size: 'L', color: '#9db38a', scale: 1.1 }));
  const box = document.getElementById('invSlots');
  box.innerHTML = M.inv.map((s, i) => {
    const def = s.kind === 'gun' ? BD.WEAPONS[s.key] : BD.ITEMS[s.key];
    const cnt = s.kind === 'item' ? (s.left > 0 ? '× ' + s.left : 'USED') : (s.key === 'LAW66' ? '× ' + s.ammo : (s.kind === 'gun' && !def.melee ? def.mag + ' RD MAG' : ''));
    return `<div class="slot ${i === M.held ? 'held' : ''}" data-i="${i}"><img src="${BD.ICON(def.icon)}"><span class="nm">${def.label}</span><span class="cnt">${cnt}</span></div>`;
  }).join('');
  box.querySelectorAll('.slot').forEach(el => el.addEventListener('click', () => setHeld(+el.dataset.i)));
  document.getElementById('invGear').textContent = BD.GEAR[activeIdx].map(g => g[2]).join('  ·  ');
}
function toggleInv(force) {
  invOpen = force !== undefined ? force : !invOpen;
  document.getElementById('inv').style.display = invOpen ? 'flex' : 'none';
  renderInv();
}

const _sv = new THREE.Vector3();
let mateAlt = 0;
function playMateShot(M) {
  const a = M.wpn.snd[M.wpn.alt++ % 2];
  a.volume = THREE.MathUtils.clamp(1.1 - M.pos.distanceTo(player.pos) / 38, 0.08, 0.55) * SET.vol;
  a.currentTime = 0;
  a.play().catch(() => {});
}
function updateMate(M, dt, now) {
  if (!M.alive || !M.obj) return;
  // nearest visible enemy
  let tgt = null, td = 26;
  for (const E of enemies) {
    if (!E.alive || !E.obj) continue;
    const d = M.pos.distanceTo(E.pos);
    if (d > td) continue;
    _sv.set(M.pos.x, 1.5, M.pos.z);
    const dir = new THREE.Vector3(E.pos.x - M.pos.x, 0, E.pos.z - M.pos.z).normalize();
    raycaster.set(_sv, dir); raycaster.far = d;
    if (raycaster.intersectObject(world, true).length === 0) { tgt = E; td = d; }
  }
  // formation slot (or hold position)
  let slot;
  if (squadHold) slot = M.holdPos || M.pos;
  else {
    const [sx, sz] = M.slot || [0, -2];
    const cy = Math.cos(player.yaw), sy = Math.sin(player.yaw);
    slot = _sv.set(player.pos.x + cy * sx + sy * sz, 0, player.pos.z - sy * sx + cy * sz).clone();
  }
  if (!squadFireFree) tgt = null; // holding fire: no aiming, no shooting
  const to = new THREE.Vector3().subVectors(slot, M.pos); to.y = 0;
  const distSlot = to.length();
  M.moving = false;
  if (tgt && distSlot < 3.2) {
    // engage: face the enemy, aim, burst fire
    const want = Math.atan2(tgt.pos.x - M.pos.x, tgt.pos.z - M.pos.z);
    let d2 = want - M.yaw;
    while (d2 > Math.PI) d2 -= Math.PI * 2;
    while (d2 < -Math.PI) d2 += Math.PI * 2;
    M.yaw += d2 * Math.min(1, dt * 6);
    mateSetAnim(M, ANIM.aim);
    if (now >= M.nextShot) {
      if (M.burstLeft <= 0) M.burstLeft = M.wpn.burst;
      M.burstLeft--;
      M.nextShot = now + (M.burstLeft > 0 ? M.wpn.interval : 0.8 + Math.random() * 0.7);
      playMateShot(M);
      if (Math.random() < M.wpn.acc) hurtEnemy(tgt, M.wpn.dmg);
    }
  } else if (distSlot > 0.55) {
    to.normalize();
    const speed = distSlot > 5 ? 3.2 : 1.35;
    M.pos.addScaledVector(to, speed * dt);
    M.yaw = Math.atan2(to.x, to.z);
    const clip = speed > 2 ? ANIM.run : ANIM.walk;
    mateSetAnim(M, clip);
    if (M.actions[clip]) M.actions[clip].timeScale = speed / (speed > 2 ? AUTH.run : AUTH.walk);
    M.moving = true;
  } else {
    mateSetAnim(M, tgt ? ANIM.aim : ANIM.idle);
  }
  M.pos.y += (groundYCached(M.pos.x, M.pos.z) - M.pos.y) * Math.min(1, dt * 9);
  M.obj.position.copy(M.pos);
  M.obj.rotation.y = M.yaw;
}

// ---- Terrorist turban + scarf (green wrap, from reference) ----
function greenWrapTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#55663f'; x.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 128; i += 18) { // wrapped cloth bands
    x.fillStyle = 'rgba(30,40,20,0.35)'; x.fillRect(0, i, 128, 4);
    x.fillStyle = 'rgba(210,220,180,0.13)'; x.fillRect(0, i + 5, 128, 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 3);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildTurbanGear(E) {
  const wrapTex = greenWrapTexture();
  wrapTex.repeat.set(10, 10);
  // turban base: skinned shell over his own head (minus face) — cannot float
  triangleShell(E,
    (dom, cen) => (dom.includes('HEAD') && !(cen[2] > 0.015 && cen[1] > 1.48 && cen[1] < 1.72)),
    new THREE.MeshLambertMaterial({ map: wrapTex, side: THREE.DoubleSide }), 0.034);
  // bone-riding extras: top bunch + lower wrap band + chest scarf tails
  const gear = new THREE.Group();
  const wrapMat = new THREE.MeshLambertMaterial({ map: greenWrapTexture(), side: THREE.DoubleSide });
  const bunch = new THREE.Mesh(new THREE.SphereGeometry(0.078, 12, 10), wrapMat);
  bunch.position.set(0.20, 0.015, -0.05);
  bunch.scale.set(0.85, 1.15, 1.15);
  gear.add(bunch);
  const bandGeo = new THREE.TorusGeometry(0.148, 0.021, 8, 22);
  bandGeo.rotateY(Math.PI / 2);
  const band = new THREE.Mesh(bandGeo, new THREE.MeshLambertMaterial({ color: 0x3d4c2e, side: THREE.DoubleSide }));
  band.position.set(0.082, 0, -0.058);
  gear.add(band);
  gear.traverse(m => { if (m.isMesh) m.castShadow = true; });
  E.headGear = gear;
  scene.add(gear);
  // green scarf tails hanging on his chest (root-attached, torso stays upright)
  const tailMat = new THREE.MeshLambertMaterial({ map: greenWrapTexture(), side: THREE.DoubleSide });
  [-0.075, 0.075].forEach((tx, i) => {
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.38, 0.016), tailMat);
    tail.position.set(tx, 1.13, 0.148);
    tail.rotation.set(-0.05, 0, i === 0 ? 0.06 : -0.06);
    tail.castShadow = true;
    E.obj.add(tail);
  });
}

// ---- Desert Fighter helmet (PASGT-style, CDS2 DLC look) ----
// Bone-local head frame (measured): +X up, centre (0.097, 0, -0.061).
function desertCamoTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#b39d72'; x.fillRect(0, 0, 256, 256);
  const cols = ['#9a8258', '#7d6c48', '#c2ab7e', '#6b5a3c'];
  for (let i = 0; i < 110; i++) {
    x.fillStyle = cols[i % 4];
    x.globalAlpha = 0.75;
    x.beginPath();
    x.ellipse(Math.random() * 256, Math.random() * 256, 12 + Math.random() * 30, 6 + Math.random() * 12, Math.random() * 3, 0, 7);
    x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 1);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildHelmetGear(E) {
  const gear = new THREE.Group();
  const camoMat = new THREE.MeshLambertMaterial({ map: desertCamoTexture(), side: THREE.DoubleSide });
  const shellGeo = new THREE.SphereGeometry(0.148, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.58);
  shellGeo.rotateZ(-Math.PI / 2); // pole -> local +X (up)
  const shell = new THREE.Mesh(shellGeo, camoMat);
  shell.position.set(0.105, 0, -0.057);
  shell.scale.set(0.82, 1.06, 1.10);
  gear.add(shell);
  const brimGeo = new THREE.CylinderGeometry(0.165, 0.168, 0.016, 22);
  brimGeo.rotateZ(Math.PI / 2); // disc axis -> local X (up)
  const brim = new THREE.Mesh(brimGeo, camoMat);
  brim.position.set(0.068, 0, -0.057);
  gear.add(brim);
  gear.traverse(m => { if (m.isMesh) m.castShadow = true; });
  E.headGear = gear;
  scene.add(gear);
}

// ---- Mujahid 3D gear (real geometry, follows the skeleton) ----
function keffiyehTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#e9e3d3'; x.fillRect(0, 0, 128, 128);
  x.strokeStyle = 'rgba(120,112,96,0.85)'; x.lineWidth = 2;
  for (let i = 0; i <= 128; i += 16) {
    x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 128); x.stroke();
    x.beginPath(); x.moveTo(0, i); x.lineTo(128, i); x.stroke();
  }
  x.strokeStyle = 'rgba(60,56,48,0.9)'; x.lineWidth = 3;
  x.beginPath(); x.moveTo(0, 64); x.lineTo(128, 64); x.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 2);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function beardTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#241a10'; x.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 500; i++) {
    x.fillStyle = `rgba(${40 + Math.random() * 40 | 0},${30 + Math.random() * 26 | 0},18,0.5)`;
    x.fillRect(Math.random() * 64, Math.random() * 64, 1.5, 3 + Math.random() * 5);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(5, 5);
  return t;
}

// Build a skinned "shell" from a subset of the body's own triangles,
// inflated along bind normals — perfect fit, follows all animations.
// Optional displace(i, x, y, z) -> [dx, dy, dz] reshapes bind vertices.
function triangleShell(E, selector, material, inflate, displace) {
  let skin = null;
  E.obj.traverse(o => { if (o.isSkinnedMesh && o.name === 'NEWSKIN') skin = o; });
  if (!skin) return null;
  const geo = skin.geometry;
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const uvA = geo.attributes.uv;
  const sI = geo.attributes.skinIndex.array, sW = geo.attributes.skinWeight.array;
  const bones = skin.skeleton.bones;
  const domName = i => {
    let bi = 0, bw = -1;
    for (let k = 0; k < 4; k++) if (sW[i * 4 + k] > bw) { bw = sW[i * 4 + k]; bi = sI[i * 4 + k]; }
    return (bones[bi].name || '').toUpperCase();
  };
  const idx = geo.index.array;
  const keep = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], cc = idx[t + 2];
    const doms = [domName(a), domName(b), domName(cc)];
    const dom = doms.sort((p, q) => doms.filter(v => v === q).length - doms.filter(v => v === p).length)[0];
    const cen = [0, 1, 2].map(k => (pos.getComponent(a, k) + pos.getComponent(b, k) + pos.getComponent(cc, k)) / 3);
    const uvCen = uvA ? [0, 1].map(k => (uvA.getComponent(a, k) + uvA.getComponent(b, k) + uvA.getComponent(cc, k)) / 3) : [0, 0];
    if (selector(dom, cen, uvCen)) keep.push(a, b, cc);
  }
  if (!keep.length) return null;
  const p2 = new Float32Array(pos.array);
  for (let i = 0; i < pos.count; i++) {
    p2[i * 3] += nor.getX(i) * inflate;
    p2[i * 3 + 1] += nor.getY(i) * inflate;
    p2[i * 3 + 2] += nor.getZ(i) * inflate;
    if (displace) {
      const d = displace(pos.getX(i), pos.getY(i), pos.getZ(i));
      p2[i * 3] += d[0]; p2[i * 3 + 1] += d[1]; p2[i * 3 + 2] += d[2];
    }
  }
  const g2 = new THREE.BufferGeometry();
  g2.setAttribute('position', new THREE.BufferAttribute(p2, 3));
  g2.setAttribute('normal', nor);
  if (geo.attributes.uv) g2.setAttribute('uv', geo.attributes.uv);
  g2.setAttribute('skinIndex', geo.attributes.skinIndex);
  g2.setAttribute('skinWeight', geo.attributes.skinWeight);
  g2.setIndex(keep);
  const mesh = new THREE.SkinnedMesh(g2, material);
  mesh.bind(skin.skeleton, skin.bindMatrix);
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  skin.parent.add(mesh);
  return mesh;
}

function buildHeadShells(E) {
  const scarfTex = keffiyehTexture();
  scarfTex.repeat.set(8, 8);
  const scarfMat = new THREE.MeshLambertMaterial({ map: scarfTex, side: THREE.DoubleSide });
  // main wrap: head minus face, puffier so it reads as cloth over hair
  triangleShell(E,
    (dom, cen) => (dom.includes('HEAD') && !(cen[2] > 0.015 && cen[1] > 1.48 && cen[1] < 1.72)),
    scarfMat, 0.028);
  // drape: neck/upper-back/shoulders shell — cloth hanging to the shoulders
  triangleShell(E,
    (dom, cen) => (dom.includes('NECK') || dom.includes('SPINE3') || dom.includes('SPINE2') || dom.includes('CLAVICLE')) &&
                  cen[1] > 1.34 && !(cen[2] > 0.09 && cen[1] < 1.52),
    scarfMat, 0.036);
  // long beard: lower-face island (by measured UV) + front throat, stretched down
  triangleShell(E,
    (dom, cen, uvCen) => (uvCen[0] > 0.165 && uvCen[0] < 0.345 && uvCen[1] > 0.485 && uvCen[1] < 0.615) ||
      ((dom.includes('HEAD') || dom.includes('NECK')) && cen[2] > 0.02 && cen[1] > 1.38 && cen[1] < 1.56),
    new THREE.MeshLambertMaterial({ map: beardTexture(), side: THREE.DoubleSide }), 0.016,
    (x, y, z) => {
      const t = THREE.MathUtils.clamp((1.60 - y) / 0.20, 0, 1);
      return [0, -0.085 * t, 0.010 * t]; // lower verts hang further: beard length
    });
}

function robeTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#c4b693'; x.fillRect(0, 0, 256, 64);
  for (let i = 0; i < 256; i += 32) { // soft vertical folds
    const gr = x.createLinearGradient(i, 0, i + 32, 0);
    gr.addColorStop(0, 'rgba(90,80,58,0.20)');
    gr.addColorStop(0.5, 'rgba(255,252,240,0.10)');
    gr.addColorStop(1, 'rgba(90,80,58,0.20)');
    x.fillStyle = gr; x.fillRect(i, 0, 32, 64);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 1);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildMujahidGear(E) {
  const robeMat = new THREE.MeshLambertMaterial({ map: robeTexture(), side: THREE.DoubleSide });
  // long thobe skirt (waist -> above ankles), child of the root
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.27, 0.88, 14, 1, true), robeMat);
  skirt.position.y = 0.61;
  E.obj.add(skirt);
  // 3D ammo bandolier across the chest
  const strapMat = new THREE.MeshLambertMaterial({ color: 0x3f3a28 });
  const brassMat = new THREE.MeshLambertMaterial({ color: 0xa8873f });
  const strap = new THREE.Group();
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.56, 0.022), strapMat);
  strap.add(band);
  for (let i = 0; i < 8; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.058, 0.028), brassMat);
    b.position.set(0, -0.22 + i * 0.063, 0.003);
    strap.add(b);
  }
  strap.position.set(0.02, 1.27, 0.145);
  strap.rotation.z = 0.62;
  E.obj.add(strap);
  // scarf + beard are skinned shells grown from his own head (buildHeadShells);
  // only the black agal cord rides the bone as a rigid piece. MEASURED
  // bone-local frame: local +X = up, head centre at local (0.097, 0, -0.061).
  buildHeadShells(E);
  const gear = new THREE.Group();
  const agalGeo = new THREE.TorusGeometry(0.125, 0.016, 8, 22);
  agalGeo.rotateY(Math.PI / 2); // ring axis -> local X (up)
  const agal = new THREE.Mesh(agalGeo, new THREE.MeshLambertMaterial({ color: 0x141210 }));
  agal.position.set(0.150, 0, -0.060);
  agal.castShadow = true;
  gear.add(agal);
  E.headGear = gear;
  scene.add(gear);
}

const _hgPos = new THREE.Vector3(), _hgQuat = new THREE.Quaternion();
function positionHeadGear(E) {
  if (!E.headGear || !E.headBone) return;
  E.headBone.getWorldPosition(_hgPos);
  E.headBone.getWorldQuaternion(_hgQuat);
  E.headGear.position.copy(_hgPos); // gear sits exactly on the bone pivot
  E.headGear.quaternion.copy(_hgQuat);
}
const keys = new Set();
let playing = false, locked = false, dragging = false;
let camYaw = 0, camPitch = 0.32, aiming = false, firing = false;
let aimT = 0; // time spent raising into the aim pose; first shot waits for it

const startEl = document.getElementById('start');
startEl.addEventListener('click', () => {
  if (playerHP <= 0 || missionDone) {
    playerHP = 100; missionDone = false; objIdx = 0; kills = 0;
    resetEnemies(true); resetSquadToStart(); setObjectiveText();
    setCanvas('killsCv', GF.text('HOSTILES DOWN 0', { size: 'S', color: '#e8a09a', scale: 1.5 }));
  }
  const h1 = startEl.querySelector('h1');
  if (h1) h1.textContent = '▶ CLICK TO PLAY';
  startEl.style.display = 'none';
  playing = true;
  updateHUD();
  renderer.domElement.requestPointerLock?.();
});
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer.domElement;
});
let lastMX = null, lastMY = null;
document.addEventListener('mousemove', (e) => {
  if (!playing) { lastMX = e.clientX; lastMY = e.clientY; return; }
  // Hover-look: the preview iframe usually blocks pointer-lock, so plain mouse
  // movement steers the camera (client deltas). Locked mode uses movementX.
  let dx = 0, dy = 0;
  if (locked) { dx = e.movementX; dy = e.movementY; }
  else if (lastMX !== null) { dx = e.clientX - lastMX; dy = e.clientY - lastMY; }
  lastMX = e.clientX; lastMY = e.clientY;
  const sens = (aiming || firing) ? 0.55 : 1.0; // finer control while aiming (original had this backwards)
  camYaw -= dx * 0.0026 * sens * SET.sens;
  camPitch = THREE.MathUtils.clamp(camPitch + (SET.inv ? -dy : dy) * 0.0022 * sens * SET.sens, -0.15, 1.0);
});
renderer.domElement.addEventListener('mousedown', (e) => {
  if (!playing) return;
  if (e.button === 0) firing = true;
  if (e.button === 2) aiming = true;
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) { firing = false; dragging = false; }
  if (e.button === 2) aiming = false;
});
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('keydown', (e) => {
  if (e.code === 'ControlLeft' || e.code === 'ControlRight') e.preventDefault();
  keys.add(e.code);
  if (e.code === 'KeyC' && playing) targetStanceIdx = targetStanceIdx === 1 ? 0 : 1;
  if (e.code === 'KeyX' && playing) targetStanceIdx = targetStanceIdx === 2 ? 0 : 2;
  if (e.code === 'KeyR' && playing) startReload();
  if (e.code === 'KeyT' && playing) { resetEnemies(true); playerHP = 100; updateHUD(); }
  if (e.code.startsWith('Digit') && playing) {
    const n = +e.code.slice(5);
    if (n >= 1 && n <= 4) switchTo(n - 1);
  }
  if (e.code === 'KeyG' && playing) { squadFireFree = !squadFireFree; updateHUD(); }
  if (e.code === 'KeyF' && playing) {
    squadHold = !squadHold;
    if (squadHold) members.forEach((M, i) => { if (i !== activeIdx) M.holdPos = M.pos.clone(); });
    updateHUD();
  }
  if (e.code === 'KeyP') { playing = false; startEl.style.display = 'flex'; document.exitPointerLock?.(); }
  if (e.code === 'Tab' && playing) { e.preventDefault(); toggleInv(); }
  if (e.code === 'KeyQ' && playing && members[activeIdx]) setHeld(members[activeIdx].held + 1);
  if (e.code === 'KeyH' && playing) {
    const M = members[activeIdx];
    const idx = M && M.inv ? M.inv.findIndex(s => s.key === 'MEDIKIT') : -1;
    if (idx >= 0) useItem(M.inv[idx], nowSec);
  }
  if (e.code === 'KeyE' && playing) {
    const s = curSlot();
    if (s && s.key === 'C4') tryPlantC4();
    else showMsg('NOTHING TO USE HERE', 'C4 IS CARRIED BY JONES — SWITCH WITH 1-4');
  }
});
addEventListener('wheel', (e) => {
  if (playing && !invOpen && members[activeIdx]) setHeld(members[activeIdx].held + (e.deltaY > 0 ? 1 : -1));
});
addEventListener('keyup', (e) => keys.delete(e.code));

function startReload() {
  const s0 = curSlot();
  if (!s0 || s0.kind !== 'gun' || BD.WEAPONS[s0.key].melee || BD.WEAPONS[s0.key].rocket) return;
  if (player.reloading || player.ammo === WPN.mag) return;
  player.reloading = true;
  player.reloadT = WPN.reload;
  playClick(); // mechanism click — the bank's click sample, used at reload start
  // animation chosen in the main loop (prone reload / moving blend / standing)
}

const flash = new THREE.PointLight(0xffc266, 0, 10);
scene.add(flash);
let flashT = 0;
const impact = new THREE.Mesh(
  new THREE.SphereGeometry(0.045, 8, 8),
  new THREE.MeshBasicMaterial({ color: 0xffd9a0 }));
impact.visible = false;
scene.add(impact);
let impactT = 0;
const raycaster = new THREE.Raycaster();

function doFire(now) {
  const M = members[activeIdx];
  if (!M || !M.inv) return;
  const slot = M.inv[M.held];
  if (slot.kind === 'item') { useItem(slot, now); return; }
  const W = BD.WEAPONS[slot.key];
  if (W.melee) { // combat knife: silent, close only
    if (now < player.nextShot) return;
    player.nextShot = now + W.interval;
    playClick();
    let best = null, bd = 2.4;
    for (const E of enemies) {
      if (!E.alive) continue;
      const d = E.pos.distanceTo(player.pos);
      if (d < bd) { bd = d; best = E; }
    }
    if (best) hurtEnemy(best, W.dmg);
    return;
  }
  if (player.reloading || now < player.nextShot) return;
  if (!settledFire) return; // guns need the aim raised + settled stance (original rules)
  player.nextShot = now + W.interval;
  if (player.ammo <= 0) { playClick(); player.nextShot = now + 0.3; return; }
  player.ammo--; slot.ammo = player.ammo;
  playShot();
  if (rifleObj) {
    const m = rifleObj.localToWorld(new THREE.Vector3(0, 0.66, 0));
    flash.position.copy(m);
    flash.intensity = 60; flashT = 0.05;
  }
  if (W.rocket) { fireRocket(); buildItemBar(); updateHUD(); return; }
  // hitscan from camera centre
  raycaster.setFromCamera({ x: 0, y: 0 }, camera);
  raycaster.far = 220;
  const targets = [world, ...enemies.filter(E => E.obj && E.alive).map(E => E.obj)];
  const hits = raycaster.intersectObjects(targets, true);
  if (hits.length) {
    impact.position.copy(hits[0].point);
    impact.visible = true; impactT = 0.12; impact.scale.setScalar(1);
    let n = hits[0].object, hitE = null;
    while (n && !hitE) {
      hitE = enemies.find(E => E.obj === n) || null;
      n = n.parent;
    }
    if (hitE && hitE.alive) hurtEnemy(hitE, W.dmg);
  }
  updateHUD();
}

function updateEnemy(E, dt, now) {
  if (!E.obj || !E.mixer || !E.alive) return;
  // target = nearest living squad member (you or a mate)
  let T = { pos: player.pos, stance: player.stance, moving: player.moving, mate: null };
  let best = player.pos.distanceTo(E.pos);
  members.forEach((M, i) => {
    if (i === activeIdx || !M.alive) return;
    const d = M.pos.distanceTo(E.pos);
    if (d < best) { best = d; T = { pos: M.pos, stance: 'stand', moving: M.moving, mate: M }; }
  });
  const toPlayer = new THREE.Vector3().subVectors(T.pos, E.pos);
  const dist = toPlayer.length();
  const flat = Math.atan2(toPlayer.x, toPlayer.z);
  let dyaw = flat - E.yaw;
  while (dyaw > Math.PI) dyaw -= Math.PI * 2;
  while (dyaw < -Math.PI) dyaw += Math.PI * 2;
  // line of sight: enemy head -> player chest, blocked by environment
  const head = new THREE.Vector3(E.pos.x, 1.55, E.pos.z);
  const chest = new THREE.Vector3(T.pos.x, 1.25, T.pos.z);
  const dir = new THREE.Vector3().subVectors(chest, head);
  raycaster.set(head, dir.clone().normalize());
  raycaster.far = dist;
  if (E.losT === undefined || E.losT <= 0) {
    E._blocked = raycaster.intersectObject(world, true).length > 0 ||
      smokes.some(S => S.t > 0 && (S.pos.distanceTo(E.pos) < 7 || S.pos.distanceTo(T.pos) < 7));
    E.losT = 0.15;
  } else E.losT -= dt;
  const blocked = E._blocked;
  const canSee = dist < 30 && (Math.cos(dyaw) > 0.25 || dist < 7) && !blocked;

  if (E.state === 'engage') {
    enemySetAnim(E, E_ANIM.aim);
    E.yaw += dyaw * Math.min(1, dt * 5);
    if (canSee) E.lostT = 0;
    else {
      E.lostT += dt;
      if (E.lostT > 2.5) { E.state = 'patrol'; E.spotT = 0; enemySetAnim(E, E_ANIM.walk); }
    }
    if (canSee && now >= E.nextShot) {
      if (E.burstLeft <= 0) E.burstLeft = 3 + Math.floor(Math.random() * 3);
      E.burstLeft--;
      E.nextShot = now + (E.burstLeft > 0 ? 0.115 : 0.85 + Math.random() * 0.75);
      playAK(dist);
      flash.position.set(E.pos.x + Math.sin(E.yaw) * 0.7, 1.35, E.pos.z + Math.cos(E.yaw) * 0.7);
      flash.intensity = 40; flashT = 0.05;
      let p = dist < 12 ? 0.50 : dist < 22 ? 0.33 : 0.20;
      if (T.stance === 'crouch') p *= 0.75;
      else if (T.stance === 'prone') p *= 0.55;
      if (T.moving) p *= 0.8;
      if (Math.random() < p) {
        if (T.mate) {
          T.mate.hp -= 8 + Math.random() * 6;
          if (T.mate.hp <= 0) {
            T.mate.hp = 0; T.mate.alive = false;
            mateSetAnim(T.mate, 'DEATH_BY_SHOTGUN_BACKWARD', true);
          }
        } else {
          playerHP -= 8 + Math.random() * 6;
          dmgT = 0.45;
          if (playerHP <= 0) {
            playerHP = 0;
            playing = false;
            const h1 = startEl.querySelector('h1');
            if (h1) h1.textContent = 'WOUNDED — CLICK TO RE-DEPLOY';
            const st = document.getElementById('stats');
            if (st) st.textContent = 'WOUNDED — click to re-deploy.';
            startEl.style.display = 'flex';
            document.exitPointerLock?.();
          }
        }
        updateHUD();
      }
    }
  } else { // patrol between waypoints
    if (canSee) {
      E.spotT += dt;
      if (E.spotT > 0.55) { E.state = 'engage'; E.nextShot = now + 0.4; }
    } else E.spotT = Math.max(0, E.spotT - dt * 0.5);
    const wp = E.waypoints[E.wp];
    const to = new THREE.Vector3().subVectors(wp, E.pos);
    to.y = 0;
    if (to.length() < 0.7) {
      E.wp = (E.wp + 1) % E.waypoints.length;
    } else {
      to.normalize();
      E.pos.addScaledVector(to, 1.25 * dt);
      const want = Math.atan2(to.x, to.z);
      let d2 = want - E.yaw;
      while (d2 > Math.PI) d2 -= Math.PI * 2;
      while (d2 < -Math.PI) d2 += Math.PI * 2;
      E.yaw += d2 * Math.min(1, dt * 4);
      if (E.actions[E_ANIM.walk]) E.actions[E_ANIM.walk].timeScale = 1.25 / AUTH.walk;
    }
  }
  E.pos.y += (groundYCached(E.pos.x, E.pos.z) - E.pos.y) * Math.min(1, dt * 9);
  E.obj.position.copy(E.pos);
  E.obj.rotation.y = E.yaw;
}

function updateHUD() {
  const ad = document.getElementById('ammoDigits');
  if (ad) {
    const sv = String(player.ammo);
    if (ad.dataset.v !== sv) {
      ad.dataset.v = sv;
      ad.innerHTML = sv.split('').map(ch => `<img src="textures/ui/gwint/IMAGE_${ch}.png">`).join('');
    }
  }
  const mt = document.getElementById('magtext');
  if (mt) {
    const M = members[activeIdx];
    const s = M && M.inv ? M.inv[M.held] : null;
    const def = s ? (s.kind === 'gun' ? BD.WEAPONS[s.key] : BD.ITEMS[s.key]) : WPN;
    mt.textContent = (def.label || '') + (s && s.kind === 'gun' && !def.melee ? ' · ' + player.ammo + '/' + WPN.mag : '') + (player.reloading ? ' · RELOADING' : '');
    const wi = document.querySelector('#wpnbox .wicon');
    if (wi) { const srcI = BD.ICON(def.icon); if (wi.dataset.s !== srcI) { wi.dataset.s = srcI; wi.src = srcI; } }
  }
  const st = document.getElementById('stancetext');
  if (st) st.textContent = player.stance.toUpperCase() + (aiming ? ' · AIM' : '');
  document.getElementById('stance').textContent =
    player.stance.toUpperCase() + (aiming ? ' · AIMING' : '');
  const hpEl = document.getElementById('hp');
  if (hpEl) hpEl.textContent = 'INTEGRITY ' + Math.max(0, Math.ceil(playerHP));
  // game-style squad cards + objective + orders
  members.forEach((M, i) => {
    const card = document.getElementById('card' + i);
    if (!card) return;
    const hpv = !M.alive ? 0 : Math.max(0, Math.ceil(i === activeIdx ? playerHP : M.hp));
    card.classList.toggle('active', i === activeIdx);
    card.classList.toggle('down', !M.alive);
    const pb = document.getElementById('pb' + i);
    pb.style.width = hpv + '%';
    pb.className = hpv <= 30 ? 'low' : '';
    document.getElementById('ps' + i).textContent = !M.alive ? 'DOWN' :
      i === activeIdx ? '▶ YOU · ' + player.stance.toUpperCase() : (M.moving ? 'ON THE MOVE' : (squadHold ? 'HOLDING' : 'READY'));
  });
  const leftEl = document.getElementById('left');
  if (leftEl) leftEl.textContent = enemies.filter(E => E.alive).length;
  const om = document.getElementById('ordMove');
  if (om) om.textContent = squadHold ? 'HOLD POSITION' : 'FOLLOW';
  const of = document.getElementById('ordFire');
  if (of) of.textContent = squadFireFree ? 'AT WILL' : 'HELD';
  const sqEl = document.getElementById('squad');
  if (sqEl && members.length) sqEl.textContent = 'SQUAD ' + members.map((M, i) =>
    (i === activeIdx ? '▶' : '') + M.name + ' ' + (!M.alive ? 'DOWN' : Math.max(0, Math.ceil(i === activeIdx ? playerHP : M.hp)))).join(' · ') + (squadHold ? ' · HOLDING' : '');
  const foeEl = document.getElementById('foe');
  if (foeEl) foeEl.textContent = 'HOSTILES ' + enemies.filter(E => E.alive).length + '/' + enemies.length;
  document.getElementById('cross').style.display = aiming ? 'block' : 'none';
}

async function load() {
  const stats = document.getElementById('stats');
  try {
    stats.textContent = 'Loading Mission 1 — the real base…';
    ENV = await (await fetch('models/mission1/units.json')).json();
    await Promise.all(['Mis1_Zone1', 'Mis1_Zone1A', 'Mis1_Zone1_Bridge', 'Mis1_Zone2', 'Mis1_Zone2A', 'Mis1_Zone3', 'Mis1_Zone3A', 'Mis1_Zone4'].map(async z => {
      const g = await loader.loadAsync('models/mission1/' + z + '.glb');
      g.scene.traverse(o => { if (o.isMesh) o.receiveShadow = true; });
      world.add(g.scene);
    }));
    stats.textContent = 'Base loaded — kitting out the squad…';
    if (ENV.start) player.pos.set(ENV.start.pos[0], 0, ENV.start.pos[2]);
    player.pos.y = groundY(player.pos.x, player.pos.z);
    buildEnemies();
    buildObjectives();
    { // the captured MiG — Mission1.env PROXTRIG_MIG
      const mig = await loader.loadAsync('models/mission1/MIG29.glb');
      migObj = mig.scene;
      migObj.position.copy(migPos);
      migObj.position.y = groundY(migPos.x, migPos.z);
      migObj.rotation.y = 0.7;
      migPos.y = migObj.position.y + 1;
      migObj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      scene.add(migObj);
    }
    // preload every weapon/item/gear model once (cloned per soldier)
    for (const def of [...Object.values(BD.WEAPONS), ...Object.values(BD.ITEMS)])
      modelCache[def.model] = (await loader.loadAsync(def.model)).scene;
    for (const file of [...new Set(BD.GEAR.flat().map(g => g[1]))])
      gearCache[file] = (await loader.loadAsync('models/gear/' + file + '.glb')).scene;

    const hero = await loader.loadAsync('models/play/Hero01_Armstrong.glb');
    heroObj = hero.scene;
    heroObj.position.copy(player.pos);
    heroObj.traverse(o => {
      if (o.isMesh) {
        if (o.name === 'NEWSKIN') { o.castShadow = true; o.receiveShadow = true; }
        else {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach(m => { const c = m.clone(); c.visible = false; o.material = c; });
        }
      }
    });
    scene.add(heroObj);
    mixer = new THREE.AnimationMixer(heroObj);
    (hero.animations || []).forEach(c => actions[c.name] = mixer.clipAction(c));
    // Lock root/pelvis XZ drift in every clip (keep Y height/bob): removes the
    // small positional snap at each loop point.
    hero.animations.forEach(c => c.tracks.forEach(t => {
      if ((t.name === 'BIP01.position' || t.name === 'BIP01_PELVIS.position') && t.values.length >= 3) {
        const x0 = t.values[0], z0 = t.values[2];
        for (let i = 0; i < t.values.length; i += 3) { t.values[i] = x0; t.values[i + 2] = z0; }
      }
    }));
    // Bake a loop crossfade into cyclic clips: blend the tail of each track
    // into its first frame, so the loop point closes seamlessly (the original
    // engine crossfades this seam at runtime).
    function bakeSeam(clip, fade) {
      const dur = clip.duration;
      clip.tracks.forEach(t => {
        const size = t.values.length / t.times.length;
        for (let i = 0; i < t.times.length; i++) {
          const time = t.times[i];
          if (time < dur - fade) continue;
          const a = (time - (dur - fade)) / fade, o = i * size;
          if (size === 4) THREE.Quaternion.slerpFlat(t.values, o, t.values, o, t.values, 0, a);
          else for (let k = 0; k < size; k++) t.values[o + k] += (t.values[k] - t.values[o + k]) * a;
        }
      });
    }
    ['UPRIGHT_WALK_WITH_RIFLE', 'UPRIGHT_RELAXED_RUN_WITH_RIFLE', 'CROUCHED_RELAXED_WALK_WITH_RIFLE',
     'PRONE_CRAWL_WITH_RIFLE', 'UPRIGHT_STRAFEE_WITH_RIFLE', 'UPRIGHT_STRAFEW_WITH_RIFLE',
     'CROUCHED_STRAFEE_WITH_RIFLE', 'CROUCHED_STRAFEW_WITH_RIFLE'
    ].forEach(n => { const c = THREE.AnimationClip.findByName(hero.animations, n); if (c) bakeSeam(c, 0.12); });
    const idleClip = THREE.AnimationClip.findByName(hero.animations, ANIM.idle);
    if (idleClip) bakeSeam(idleClip, 0.35);
    // Aim-move blends: legs from a locomotion clip, upper body from the aim
    // clip — how the original presents strafing while aiming. The ROOT
    // quaternion also comes from the aim clip, else the walk root twists the
    // whole upper body (gun pointing left while walking straight).
    const isLower = n => ((n.startsWith('BIP01.') && n !== 'BIP01.quaternion') || n.includes('_PELVIS.') || /(THIGH|CALF|FOOT|TOE)/.test(n));
    function buildBlend(legName, upperName, outName) {
      const leg = THREE.AnimationClip.findByName(hero.animations, legName);
      const upper = THREE.AnimationClip.findByName(hero.animations, upperName);
      if (!leg || !upper) return null;
      const tracks = [...leg.tracks.filter(t => isLower(t.name)),
                      ...upper.tracks.filter(t => !isLower(t.name))];
      const clip = new THREE.AnimationClip(outName, Math.max(leg.duration, upper.duration), tracks);
      actions[outName] = mixer.clipAction(clip);
      return clip;
    }
    const aimMoveF = buildBlend(ANIM.walk, ANIM.aim, 'AIMM_F');
    buildBlend('UPRIGHT_STRAFEE_WITH_RIFLE', ANIM.aim, 'AIMM_R');
    buildBlend('UPRIGHT_STRAFEW_WITH_RIFLE', ANIM.aim, 'AIMM_L');
    if (aimMoveF) actions['AIMM_B'] = mixer.clipAction(aimMoveF); // played in reverse
    buildBlend(ANIM.walk, ANIM.reload, 'RELOADMOVE'); // reload on the move: legs keep walking
    // Crouch family: crouched locomotion legs + AIM upper body (the kneeling
    // clip alone holds the rifle low — blended with aim he actually points it)
    buildBlend(ANIM.crouchWalk, ANIM.aim, 'CAIM_F');
    buildBlend('CROUCHED_STRAFEE_WITH_RIFLE', ANIM.aim, 'CAIM_R');
    buildBlend('CROUCHED_STRAFEW_WITH_RIFLE', ANIM.aim, 'CAIM_L');
    const caimStill = buildBlend(ANIM.crouchAim, ANIM.aim, 'CAIM_STILL');
    if (caimStill) actions[ANIM.crouchAim] = actions['CAIM_STILL']; // kneel + pointing
    buildBlend(ANIM.crouchWalk, ANIM.reload, 'RELOADCROUCH'); // reload without standing up
    buildBlend(ANIM.crouchAim, ANIM.reload, 'RELOADCROUCHSTILL'); // kneeling legs: no slow-mo, no stepping

    const rifle = await loader.loadAsync('models/scene/Rifle02_M16wM203.glb');
    heroObj.traverse(o => { if (o.name && o.name.toUpperCase().includes('GUNR')) gunConnector = o; });
    heroObj.traverse(o => { if (o.name && o.name.toUpperCase().includes('RIFLEL')) rifleLObj = o; });
    if (gunConnector) {
      gunConnector.add(rifle.scene);
      rifleObj = rifle.scene;
      // No roll: measured headlessly, at identity the sight side points
      // exactly up and the barrel exactly forward in the aim pose.
      rifleObj.traverse(o => { if (o.isMesh) o.castShadow = true; });
    }
    // BLACK DECADE: the player wears the ANP woodland reskin atlas
    try {
      const dzTex = await new THREE.TextureLoader().loadAsync('textures/Hero01_DZ_01.png?v=8');
      dzTex.flipY = false;
      dzTex.colorSpace = THREE.SRGBColorSpace;
      dzTex.anisotropy = MAX_ANISO;
      heroObj.traverse(o => {
        if (o.isMesh && o.name === 'NEWSKIN') {
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          ms.forEach(m => { if (m.map) { m.map = dzTex; m.needsUpdate = true; } });
        }
      });
    } catch (e) { /* fall back to the original atlas */ }
    enhanceTextures(heroObj);
    if (rifleObj) enhanceTextures(rifleObj);
    texPairs.forEach(p => { p.mat.map = p.enh; p.mat.needsUpdate = true; }); // default ON

    // ---- the enemies: preload the variety system (faces + props) ----
    for (const [k, url] of Object.entries(FACE_TEX)) {
      const t = await new THREE.TextureLoader().loadAsync(url);
      t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = MAX_ANISO;
      faceTexCache[k] = t;
    }
    for (const name of [...new Set(ROSTER.flatMap(t => [t.beard, t.hat].filter(Boolean)))]) {
      propCache[name] = (await loader.loadAsync('models/props/' + PROP_FILES[name])).scene;
    }
    const foeTemplate = await loader.loadAsync('models/enemy/IraqInfantry01_Sandy.glb');
    const akTemplate = (await loader.loadAsync('models/enemy/Rifle05_AK47.glb')).scene;
    const texByUrl = {};
    Object.entries(FACE_TEX).forEach(([k, u]) => { texByUrl[u] = faceTexCache[k]; });
    stats.textContent = 'Deploying ' + enemies.length + ' hostiles…';
    enemies.forEach(E => loadEnemy(E));

    // ---- the squad ----
    members.push({ name: 'Bradley', wpn: WEAPONS[0], ammo: WEAPONS[0].mag, obj: heroObj, mixer, actions, rifle: rifleObj,
      gunConn: gunConnector, rifleL: rifleLObj, pos: player.pos.clone(), yaw: player.yaw,
      hp: 100, alive: true, current: null, slot: null });
    members[0].inv = makeInv(0); members[0].held = 0;
    attachGear(heroObj, 0);
    members[0].heldObj = rifleObj; // the loader-attached M16 — setHeldModel swaps it for the cache clone
    setHeldModel(members[0]);
    player.ammo = members[0].inv[0].ammo;
    for (const def of SQUAD_DEFS) await loadMate(def);

    async function loadMate(def) {
      const glb = await loader.loadAsync(def.model);
      const widx = members.length;
      const M = { name: def.name, wpn: WEAPONS[widx], ammo: WEAPONS[widx].mag, obj: glb.scene, actions: {}, current: null,
        pos: new THREE.Vector3(player.pos.x + def.slot[0], 0, player.pos.z + def.slot[1]),
        yaw: Math.PI, hp: 100, alive: true, burstLeft: 0, nextShot: 0, moving: false, slot: def.slot };
      M.obj.position.copy(M.pos);
      M.obj.traverse(o => {
        if (o.isMesh) {
          if (o.name === 'NEWSKIN') { o.castShadow = true; o.receiveShadow = true; }
          else {
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            mats.forEach(m => { const c = m.clone(); c.visible = false; o.material = c; });
          }
        }
      });
      try {
        const t = await new THREE.TextureLoader().loadAsync(def.tex);
        t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = MAX_ANISO;
        M.obj.traverse(o => {
          if (o.isMesh && o.name === 'NEWSKIN') {
            const ms = Array.isArray(o.material) ? o.material : [o.material];
            ms.forEach(m => { if (m.map) { m.map = t; m.needsUpdate = true; } });
          }
        });
      } catch (e) { /* original uniform fallback */ }
      scene.add(M.obj);
      M.mixer = new THREE.AnimationMixer(M.obj);
      (glb.animations || []).forEach(c => M.actions[c.name] = M.mixer.clipAction(c));
      M.obj.traverse(o => {
        const nm = (o.name || '').toUpperCase();
        if (nm.includes('GUNR')) M.gunConn = o;
        if (nm.includes('RIFLEL')) M.rifleL = o;
      });
      M.inv = makeInv(widx); M.held = 0;
      attachGear(M.obj, widx);
      setHeldModel(M);
      mateSetAnim(M, ANIM.idle);
      members.push(M);
    }

    function loadEnemy(E) {
    E.obj = skeletonClone(foeTemplate.scene);
    E.obj.position.copy(E.pos);
    E.obj.traverse(o => {
      if (o.isMesh) {
        if (o.name === 'NEWSKIN') {
          o.castShadow = true; o.receiveShadow = true;
          o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone();
        } else {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach(m => { const c = m.clone(); c.visible = false; o.material = c; });
        }
      }
    });
    const insTex = texByUrl[E.texture];
    if (insTex) E.obj.traverse(o => {
      if (o.isMesh && o.name === 'NEWSKIN') {
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        ms.forEach(m => { if (m.map) { m.map = insTex; m.needsUpdate = true; } });
      }
    });
    scene.add(E.obj);
    E.mixer = new THREE.AnimationMixer(E.obj);
    (foeTemplate.animations || []).forEach(c => E.actions[c.name] = E.mixer.clipAction(c));
    const ak = akTemplate.clone(true);
    let eConn = null;
    E.obj.traverse(o => { if (o.name && o.name.toUpperCase().includes('GUNR')) eConn = o; });
    if (eConn) {
      eConn.add(ak);
      ak.traverse(o => { if (o.isMesh) o.castShadow = true; });
    }
    E.obj.traverse(o => {
      const nm = (o.name || '').toUpperCase();
      if (nm.includes('HEAD') && !nm.includes('CONNECTOR') && !nm.includes('END')) E.headBone = o;
      if (nm.includes('HAT') && nm.includes('CONNECTOR')) E.hatConn = o;
      if (nm.includes('FACE') && nm.includes('CONNECTOR')) E.faceConn = o;
    });
    { const ti = enemies.indexOf(E); setEnemyType(E, ROSTER[ti % ROSTER.length], ti % ROSTER.length); }
    E.pos.y = groundY(E.pos.x, E.pos.z);
    E.obj.position.copy(E.pos);
    enemySetAnim(E, E_ANIM.walk);
    }

    setAnim(ANIM.idle);
    window.__playLoaded = true;
    stats.innerHTML = '✔ Loaded — Mission 1: the real base (' + enemies.length +
      ' hostiles placed from Mission1.env). Full game inventory on TAB.';
    buildItemBar();
    GF.load().then(() => {
      setCanvas('startTitle', GF.text('BLACK DECADE', { size: 'L', color: '#f0d9a0', scale: 2.6 }));
      setCanvas('deployBtn', GF.text('▶ CLICK TO DEPLOY', { size: 'L', color: '#b7e39a', scale: 1.5 }));
      setObjectiveText();
      setCanvas('killsCv', GF.text('HOSTILES DOWN 0', { size: 'S', color: '#e8a09a', scale: 1.5 }));
    });
    updateHUD();
  } catch (err) {
    document.getElementById('err').textContent = '⚠ Load failed: ' + err.message;
    if (stats) stats.textContent = '⚠ Load failed: ' + err.message;
    console.error(err);
  }
}
load();

// ---- main loop ----
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const now = clock.elapsedTime;

  if (playing && heroObj) {
    nowSec = now;
    // thrown items, rockets, smoke, healing, C4, objectives
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const P = projectiles[i];
      P.vel.y -= 9.8 * dt;
      P.obj.position.addScaledVector(P.vel, dt);
      const gy = groundYCached(P.obj.position.x, P.obj.position.z) + 0.05;
      if (P.obj.position.y <= gy) {
        P.obj.position.y = gy;
        if (P.kind === 'SMOKE') { spawnSmoke(P.obj.position.clone()); scene.remove(P.obj); projectiles.splice(i, 1); continue; }
        P.vel.set(0, 0, 0);
      }
      P.t -= dt;
      if (P.kind === 'FRAG' && P.t <= 0) { explode(P.obj.position.clone(), 6.5, 95); scene.remove(P.obj); projectiles.splice(i, 1); }
    }
    for (let i = rockets.length - 1; i >= 0; i--) {
      const R = rockets[i];
      R.obj.position.addScaledVector(R.vel, dt);
      R.t -= dt;
      const gy = groundYCached(R.obj.position.x, R.obj.position.z);
      const hitE = enemies.some(E => E.alive && E.pos.distanceTo(R.obj.position) < 1.4);
      if (R.t <= 0 || R.obj.position.y <= gy + 0.1 || hitE || R.obj.position.distanceTo(migPos) < 3) {
        explode(R.obj.position.clone(), 7, 300);
        scene.remove(R.obj); rockets.splice(i, 1);
      }
    }
    for (let i = smokes.length - 1; i >= 0; i--) {
      const S = smokes[i];
      S.t -= dt;
      S.obj.material.opacity = Math.min(0.75, S.t * 0.4);
      if (S.t <= 0) { scene.remove(S.obj); smokes.splice(i, 1); }
    }
    if (pendingHeal > 0) { pendingHeal -= dt; if (pendingHeal <= 0) { playerHP = Math.min(100, playerHP + 55); showMsg('WOUND DRESSED'); updateHUD(); } }
    if (pendingC4 > 0) { pendingC4 -= dt; if (pendingC4 <= 0) explode(migPos.clone(), 16, 500); }
    if (!missionDone && OBJ.length) {
      const O = OBJ[objIdx];
      if (objIdx === 0 && dist2D(player.pos, O.pos) < O.r) {
        objIdx = 1; showMsg('OBJECTIVE COMPLETE', OBJ[1].text); setObjectiveText(); updateHUD();
      } else if (objIdx === 2) {
        const allIn = members.every((M, i) => !M.alive || i === activeIdx || dist2D(M.pos, O.pos) < 30);
        if (dist2D(player.pos, O.pos) < O.r && allIn) {
          missionDone = true; playing = false;
          const st = document.getElementById('stats');
          if (st) st.textContent = 'MISSION COMPLETE — ' + kills + ' hostiles down. Click to redeploy.';
          setCanvas('deployBtn', GF.text('▶ REDEPLOY', { size: 'L', color: '#b7e39a', scale: 1.5 }));
          startEl.style.display = 'flex';
          document.exitPointerLock?.();
        }
      }
    }
    if (objMarker && OBJ[objIdx]) {
      const O = OBJ[objIdx];
      objMarker.position.set(O.pos.x, groundYCached(O.pos.x, O.pos.z) + 6 + Math.sin(now * 2) * 0.6, O.pos.z);
    }
    if (msgT > 0) { msgT -= dt; if (msgT <= 0) document.getElementById('msg').style.opacity = 0; }
    // stance ladder stepping (stand <-> crouch <-> prone, never direct)
    if (stanceIdx !== targetStanceIdx) {
      stanceStepT -= dt;
      if (stanceStepT <= 0) {
        stanceIdx += Math.sign(targetStanceIdx - stanceIdx);
        player.stance = STANCES[stanceIdx];
        stanceStepT = 0.28;
      }
    }
    // movement (camera-relative)
    const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const s = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    const walkMode = keys.has('ControlLeft') || keys.has('ControlRight'); // CDS: Ctrl = walk
    const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const fwd = new THREE.Vector3(-Math.sin(camYaw), 0, -Math.cos(camYaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const move = new THREE.Vector3().addScaledVector(fwd, f).addScaledVector(right, s);
    player.moving = move.lengthSq() > 0;
    if (player.reloading && player.stance !== 'stand') { move.set(0, 0, 0); player.moving = false; } // crouch/prone reload = planted; standing may reload-walk
    let speed = 0;
    if (player.moving) {
      move.normalize();
      speed = player.stance === 'prone' ? 0.55 : player.stance === 'crouch' ? 1.05 : walkMode ? 1.3 : sprint ? 4.3 : 3.4;
      if ((aiming || firing) && player.stance === 'stand') speed = Math.min(speed, 1.1); // tactical aim-walk
      if (player.reloading && player.stance === 'stand') speed = Math.min(speed, 1.3); // no running mid-reload
      player.pos.addScaledVector(move, speed * dt);
      player.pos.x = THREE.MathUtils.clamp(player.pos.x, -352, 24);
      player.pos.z = THREE.MathUtils.clamp(player.pos.z, -700, -78);
      colliders.forEach(c => {
        const dx = player.pos.x - c.x, dz = player.pos.z - c.z;
        const d = Math.hypot(dx, dz), min = c.r + 0.42;
        if (d > 0.001 && d < min) {
          player.pos.x = c.x + dx / d * min;
          player.pos.z = c.z + dz / d * min;
        }
      });
    }
    // facing: aim/fire -> camera direction; otherwise movement direction
    const wantYaw = (aiming || firing)
      ? Math.atan2(fwd.x, fwd.z)
      : player.moving ? Math.atan2(move.x, move.z) : player.yaw;
    let dy = wantYaw - player.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    player.yaw += dy * Math.min(1, dt * 10);
    player.pos.y += (groundYCached(player.pos.x, player.pos.z) - player.pos.y) * Math.min(1, dt * 10);
    heroObj.position.copy(player.pos);
    // prone-aim's bones sit at/below y=0 (pelvis 0.024, calves -0.005):
    // lift just enough for boots to rest on the ground, per-pose.
    const liftTarget = player.stance === 'prone' ? (current === ANIM.prone ? 0.09 : 0.02) : 0;
    proneLift += (liftTarget - proneLift) * Math.min(1, dt * 6);
    heroObj.position.y += proneLift;
    heroObj.rotation.y = player.yaw;

    // stance changes get a longer crossfade (no snapping between poses)
    transitionFade = player.stance !== prevStance ? 0.30 : 0.18;
    if (player.stance !== prevStance) prevStance = player.stance;

    // reload timer (WEAPS.TXT: 1.5 s) + context animation
    if (player.reloading) {
      const wantReload = player.stance === 'prone' ? ANIM.proneReload
        : player.stance === 'crouch' ? (player.moving ? 'RELOADCROUCH' : 'RELOADCROUCHSTILL')
        : (player.moving ? 'RELOADMOVE' : ANIM.reload);
      if (current !== wantReload && actions[wantReload]) setAnim(wantReload, true);
      if (wantReload === 'RELOADMOVE' && actions[wantReload])
        actions[wantReload].timeScale = speed / AUTH.walk;
      if (wantReload === 'RELOADCROUCH' && actions[wantReload])
        actions[wantReload].timeScale = speed / AUTH.crouch; // full-speed reload, legs matched
      player.reloadT -= dt;
      if (player.reloadT <= 0) {
        player.reloading = false; player.ammo = WPN.mag;
        const s1 = curSlot(); if (s1 && s1.kind === 'gun') s1.ammo = player.ammo;
        buildItemBar(); updateHUD();
      }
    }
    aimT = (aiming || firing) ? aimT + dt : 0;
    settledFire = aimT > 0.22 && (player.stance === 'stand' || !player.moving); // crouch/prone: planted to shoot
    if (firing && !player.reloading) doFire(now);

    // animation selection
    if (!player.reloading) {
      if (player.stance === 'prone') {
        const nm = player.moving && actions[ANIM.proneCrawl] ? ANIM.proneCrawl : ANIM.prone;
        setAnim(nm);
      } else if (player.stance === 'crouch') {
        if (aiming || firing) {
          if (player.moving) { // crouch aim-move: crouched legs + kneeling aim upper
            let nm = 'CAIM_F';
            if (Math.abs(s) >= Math.abs(f) && s !== 0) nm = s > 0 ? 'CAIM_R' : 'CAIM_L';
            if (actions[nm]) { setAnim(nm); actions[nm].timeScale = speed / AUTH.crouch; }
            else setAnim(ANIM.crouchAim);
          } else setAnim(ANIM.crouchAim); // the kneeling shooting stance
        } else {
          setAnim(ANIM.crouchWalk);
          if (actions[ANIM.crouchWalk]) actions[ANIM.crouchWalk].timeScale = player.moving ? speed / AUTH.crouch : 0;
        }
      } else if (aiming || firing) {
        if (player.moving) { // aim-move blends: locomotion legs + aiming upper body
          let nm = 'AIMM_F';
          if (Math.abs(s) >= Math.abs(f) && s !== 0) nm = s > 0 ? 'AIMM_R' : 'AIMM_L';
          else if (f < 0) nm = 'AIMM_B';
          if (actions[nm]) { setAnim(nm); actions[nm].timeScale = nm === 'AIMM_B' ? -speed / AUTH.walk : speed / AUTH.walk; }
          else setAnim(ANIM.aim);
        } else setAnim(ANIM.aim, false, 0.28);
      } else if (player.moving) {
        const nm = walkMode ? ANIM.walk : ANIM.run;
        setAnim(nm);
        if (actions[nm]) actions[nm].timeScale = walkMode ? speed / AUTH.walk : speed / AUTH.run;
      } else setAnim(ANIM.idle);
    }
    enemies.forEach(E => updateEnemy(E, dt, now));
    members.forEach((M, i) => { if (i !== activeIdx) updateMate(M, dt, now); });
    updateHUD();
  }

  if (mixer) mixer.update(dt);
  enemies.forEach(E => { if (E.mixer) E.mixer.update(dt); positionHeadGear(E); });
  members.forEach((M, i) => { if (i !== activeIdx && M.mixer) M.mixer.update(dt); });
  if (dmgT > 0) {
    dmgT -= dt;
    const dEl = document.getElementById('dmg');
    if (dEl) dEl.style.opacity = Math.max(0, Math.min(1, dmgT * 1.6));
  }
  // Grip alignment ONLY in two-handed poses (aim, aim-move, prone, crouch).
  // In relaxed walk/run/idle his left arm swings free or carries — aligning
  // there drags the rifle after the swinging hand (the "bugged gun" bug).
  // Outside aligned poses the rifle eases back to its authored orientation.
  if (rifleObj) {
    const _slot0 = curSlot();
    const _longGun = _slot0 && _slot0.kind === 'gun' && !_slot0.key.includes('SIG') && _slot0.key !== 'KNIFE' && _slot0.key !== 'LAW66';
    const aligned = _longGun && !player.reloading &&
      (current === ANIM.aim || current === ANIM.prone || current === ANIM.crouchWalk ||
       current === ANIM.crouchAim || current === ANIM.proneCrawl || ALIGNED_STATES.includes(current));
    if (aligned) alignRifle();
    else rifleObj.quaternion.slerp(_identityQ, Math.min(1, dt * 8));
  }

  // camera follow (+ aim zoom: narrower FOV, over-the-shoulder)
  if (heroObj) {
    const aimNow = aiming || firing;
    const _hs = curSlot();
    const targetFov = _hs && _hs.key === 'BINOCULARS' && aiming ? 11 : aimNow ? 33 : 50;
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 9);
      camera.updateProjectionMatrix();
    }
    const dist = aimNow ? 1.9 : 4.3;
    const rgt = new THREE.Vector3(Math.cos(camYaw), 0, -Math.sin(camYaw));
    const shoulder = aimNow ? 0.55 : 0.12;
    const cx = player.pos.x + Math.sin(camYaw) * Math.cos(camPitch) * dist + rgt.x * shoulder;
    const cz = player.pos.z + Math.cos(camYaw) * Math.cos(camPitch) * dist + rgt.z * shoulder;
    const cy = player.pos.y + 1.55 + Math.sin(camPitch) * dist;
    camera.position.lerp(new THREE.Vector3(cx, cy, cz), 1 - Math.pow(0.0001, dt));
    camera.lookAt(player.pos.x + rgt.x * (aimNow ? 0.4 : 0),
                  player.pos.y + (aimNow ? 1.42 : 1.35),
                  player.pos.z + rgt.z * (aimNow ? 0.4 : 0));
  }

  sun.position.set(player.pos.x + 25, player.pos.y + 38, player.pos.z + 14);
  sun.target.position.copy(player.pos);
  sun.target.updateMatrixWorld();
  if (flashT > 0) { flashT -= dt; if (flashT <= 0) flash.intensity = 0; }
  if (impactT > 0) { impactT -= dt; impact.scale.setScalar(1 + (0.12 - impactT) * 8); if (impactT <= 0) impact.visible = false; }
  const cImg = document.getElementById('compassImg');
  if (cImg) cImg.style.transform = `rotate(${(-camYaw * 57.2958).toFixed(1)}deg)`;
  renderer.render(scene, camera);
}
animate();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
