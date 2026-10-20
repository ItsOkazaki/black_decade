/* =====================================================================
   CONFLICT: DESERT STORM — browser assembly
   A from-scratch engine built entirely from the original game's own
   decoded data: Catalog stat tables (Weaps/HStat), .loc briefing text,
   mission unit placements, EVO landscape/props, character models and
   the 79-clip animation library. No code from any previous project.
   ===================================================================== */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skClone } from 'three/addons/utils/SkeletonUtils.js';

const $ = id => document.getElementById(id);
const V3 = (x=0,y=0,z=0) => new THREE.Vector3(x,y,z);
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const rand = (a,b) => a + Math.random()*(b-a);

/* ---------------- data ---------------- */
let WDATA = {};          // original Weaps.txt rows, by weapon id (US_WPN_M16A2 …)
let MTEXT = {};          // original .loc briefing/objective text, by mission id
let MISSIONS = [];       // mission list
const loader = new GLTFLoader();
const texLoader = new THREE.TextureLoader();
const modelCache = {};
async function jget(url) { const r = await fetch(url); if (!r.ok) throw new Error(url); return r.json(); }
async function loadModel(url) {
  if (modelCache[url]) return modelCache[url];
  const g = await loader.loadAsync(url);
  modelCache[url] = g;
  return g;
}
function weaponDef(id) {
  if (WDATA[id]) return WDATA[id];
  // tolerant lookup: the tables name some guns slightly differently
  const want = id.replace(/^US_WPN_|^IR_WPN_/, '');
  for (const k in WDATA) if (k.replace(/^US_WPN_|^IR_WPN_/, '') === want) return WDATA[k];
  for (const k in WDATA) if (k.includes(want) || want.includes(k.replace(/^US_WPN_|^IR_WPN_/, ''))) return WDATA[k];
  return { id, label: want, dmg: 14, mag: 30, reload: 1.5, interval: 0.1, range: 800, model: '', fireOnMove: true };
}
function findWeaponId(re, fallback) {
  for (const k in WDATA) if (re.test(k)) return k;
  return fallback;
}

/* ---------------- audio (original .wav banks) ---------------- */
const AC = window.AudioContext ? new (window.AudioContext)() : null;
const sndCache = {};
function playSnd(path, vol = 1, rate = 1) {
  if (!AC) return;
  if (AC.state === 'suspended') AC.resume();
  const hit = sndCache[path];
  if (hit) { blip(hit, vol, rate); return; }
  fetch(path).then(r => r.ok ? r.arrayBuffer() : null).then(b => b && AC.decodeAudioData(b)).then(buf => {
    if (buf) { sndCache[path] = buf; blip(buf, vol, rate); }
  }).catch(() => {});
}
function blip(buf, vol, rate) {
  const s = AC.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
  const g = AC.createGain(); g.gain.value = clamp(vol, 0, 1);
  s.connect(g); g.connect(AC.destination); s.start();
}
let musicEl = null;
function music(path) {
  if (musicEl) { musicEl.pause(); musicEl = null; }
  if (!path) return;
  musicEl = new Audio(path); musicEl.loop = true; musicEl.volume = 0.5; musicEl.play().catch(() => {});
}
function weaponSound(id, dist = 0) {
  const bank = id.replace(/^US_WPN_|^IR_WPN_/, '');
  const vol = dist <= 0 ? 0.85 : clamp(1.15 - dist / 90, 0.04, 0.7);
  playSnd(`game/assets/sounds/${bank}_shot${1 + Math.floor(Math.random() * 2)}.wav`, vol, rand(0.96, 1.05));
}
function voice(name, vol = 0.7) { playSnd(`game/assets/sounds/voice/${name}.wav`, vol); }

/* ---------------- three setup ---------------- */
let renderer, scene, camera, clock;
let worldGroup = null, terrainMeshes = [];
const rayDown = new THREE.Raycaster();
const hCache = new Map();
function groundH(x, z) {
  const key = Math.round(x) + ',' + Math.round(z);
  if (hCache.has(key)) return hCache.get(key);
  rayDown.set(V3(x, 260, z), V3(0, -1, 0));
  rayDown.far = 520;
  const hits = rayDown.intersectObjects(terrainMeshes, true);
  const y = hits.length ? hits[0].point.y : 0;
  hCache.set(key, y);
  return y;
}
function losClear(a, b) {
  const d = a.distanceTo(b); const steps = Math.max(2, Math.floor(d / 6));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, z = a.z + (b.z - a.z) * t;
    if (groundH(x, z) > y + 0.4) return false;
  }
  return true;
}

/* ---------------- actors ---------------- */
let ANIMLIB = [];
const CLIP_PREF = {
  idle:   [/UPRIGHT_STANCE_WITH_RIFLE_IDLE01/i, /IDLE_LOOK_AROUND_WITH_GUN/i, /STANCE_WITH_RIFLE/i],
  idlePistol: [/UPRIGHT_STANCE_WITH_PISTOL_IDLE01/i],
  run:    [/UPRIGHT_RELAXED_RUN_WITH_RIFLE/i],
  runPistol: [/UPRIGHT_RELAXED_RUN_WITH_PISTOL/i],
  walkC:  [/CROUCHED_RELAXED_WALK_WITH_RIFLE/i],
  kneel:  [/KNEELING_STANCE_WITH_RIFLE/i, /KNEELING_STANCE_WITH_PISTOL_IDLE01/i],
  aim:    [/UPRIGHT_STANCE_WITH_RIFLE/i, /IDLE_LOOK_AROUND_WITH_GUN/i],
  death:  [/DEATH_BY_SHOTGUN_FORWARD/i, /DEATH/i, /DIE/i],
  prone:  [/PRONE.*RIFLE/i]
};
function pickClip(clips, prefs) {
  for (const re of prefs) { const c = clips.find(c => re.test(c.name)); if (c) return c; }
  return clips[0] || null;
}
function buildActor(gltfScene, clips, scale = 1) {
  const obj = gltfScene;
  obj.traverse(o => {
    if (!o.isMesh) return;
    if (/CONNECTOR|MARKER|HELPER/i.test(o.name)) o.visible = false;
    // the converter baked skinning-weight paint in as vertex colours — drop it
    if (o.geometry && o.geometry.hasAttribute('color')) o.geometry.deleteAttribute('color');
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of ms) if (m) m.vertexColors = false;
  });
  obj.scale.setScalar(scale);
  const mixer = new THREE.AnimationMixer(obj);
  const acts = {};
  for (const k in CLIP_PREF) { const c = pickClip(clips, CLIP_PREF[k]); if (c) acts[k] = mixer.clipAction(c); }
  const A = {
    obj, mixer, acts, cur: null, hp: 100, maxHp: 100, alive: true, crouch: false,
    pos: obj.position, yaw: 0, vy: 0, team: 'us', name: '', weapon: null,
    setAnim(name, fade = 0.18, once = false) {
      const a = this.acts[name]; if (!a || this.cur === a) return;
      if (this.cur) this.cur.fadeOut(fade);
      a.reset(); a.enabled = true; a.fadeIn(fade);
      if (once) { a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true; }
      a.play(); this.cur = a;
    },
    update(dt) { this.mixer.update(dt); }
  };
  return A;
}
function attachGun(actor, def) {
  if (actor.gunObj) { actor.gunObj.parent && actor.gunObj.parent.remove(actor.gunObj); actor.gunObj = null; }
  if (!def || !def.model) return;
  const url = `game/assets/models/weapons/${def.model}.glb`;
  loadModel(url).then(g => {
    let bone = null;
    actor.obj.traverse(o => { if (!bone && /GUNR CONNECTOR|R HAND/.test(o.name)) bone = o; });
    if (!bone) return;
    const gun = g.scene.clone(true);
    gun.rotation.set(0, Math.PI, 0);
    bone.add(gun); actor.gunObj = gun;
  }).catch(() => {});
}

/* ---------------- game state ---------------- */
let SCREEN = 'title';
let MIS = 'mission1', MISNAME = '', playing = false, paused = false;
let squad = [], enemies = [], prisoner = null, activeIdx = 0;
let waypoints = [], triggers = [];
let objectives = [], objIdx = 0, hasC4 = false, planted = false, plantT = 0;
let startPos = V3(), hawkPos = null, c4Pos = null, bridgePos = V3(-225.91, 10, -488.17), extractPos = null;
let camYaw = 0, camPitch = 0.12, keys = {}, aiming = false, firing = false;
let lastHud = 0, toastTimer = null;
const tracers = [];
const fxSprites = [];
let muzzleTex = null, smokeTex = null;

/* ---------------- world building ---------------- */
async function buildWorld(misId, onStep) {
  if (worldGroup) { scene.remove(worldGroup); }
  worldGroup = new THREE.Group(); terrainMeshes = []; hCache.clear();
  scene.add(worldGroup);
  const base = `game/assets/models/${misId}`;
  const units = await jget(`${base}/units.json`);
  let props = null;
  try { props = await jget(`${base}/props.json`); } catch (e) { /* archive maps have no props */ }
  // sky + light, from the mission's own scene data where present
  const fogC = props && props.sky && props.sky.fog ? props.sky.fog : [0.79, 0.83, 0.84];
  scene.background = new THREE.Color(fogC[0], fogC[1], fogC[2]);
  scene.fog = new THREE.Fog(new THREE.Color(fogC[0], fogC[1], fogC[2]), 120, 900);
  const sun = new THREE.DirectionalLight(0xfff2d8, 2.6); sun.position.set(120, 220, 60); scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x8a7a5a, 0.9));
  onStep('TERRAIN', 0.15);
  // landscape zones (the original EVO scenes, converted)
  const zones = props && props.zones ? props.zones : [];
  const zoneScenes = props && props.scenes ? props.scenes : {};
  for (const z of zones) {
    try {
      const g = await loadModel(`${base}/${z.f}.glb`);
      const m = g.scene.clone(true);
      const sc = zoneScenes[z.m] || zoneScenes[z.f] || { p: [0,0,0], yaw: 0 };
      m.position.set(sc.p[0], sc.p[1], sc.p[2]); m.rotation.y = sc.yaw || 0;
      worldGroup.add(m); terrainMeshes.push(m);
    } catch (e) { /* missing zone mesh: skip */ }
  }
  onStep('OBJECTS', 0.4);
  // placed props/statics
  if (props && props.statics) {
    for (const s of props.statics) {
      try {
        const g = await loadModel(`${base}/props/${s.m}.glb`);
        const m = g.scene.clone(true);
        m.position.set(s.p[0], s.y || 0, s.p[1]); m.rotation.y = s.yaw || 0;
        worldGroup.add(m); terrainMeshes.push(m);
      } catch (e) { /* skip */ }
    }
  }
  // extraction helicopter, where the mission places one
  hawkPos = null;
  if (props && props.vehicles && props.vehicles.hawk && props.vehicles.hawk[0]) {
    const h = props.vehicles.hawk[0];
    hawkPos = V3(h.pos[0], h.pos[1], h.pos[2]);
    try {
      const g = await loadModel(`${base}/props/BLACKHAWK_UH60.glb`);
      const m = g.scene.clone(true);
      m.position.copy(hawkPos); m.rotation.y = h.yaw || 0;
      m.traverse(o => { if (/ROTOR/i.test(o.name)) rotors.push(o); });
      worldGroup.add(m);
    } catch (e) { /* no hawk model */ }
  }
  onStep('SQUAD', 0.6);
  return { units, props };
}
const rotors = [];

/* spawn the squad + enemies from the mission's own unit placement */
async function spawnActors(units, props) {
  squad = []; enemies = []; prisoner = null;
  const lib = await loadModel('game/assets/models/play/animlib.glb');
  ANIMLIB = lib.animations || [];
  startPos = V3(units.start.pos[0], units.start.pos[1], units.start.pos[2]);
  waypoints = units.waypoints || [];
  triggers = units.triggers || [];
  const heroFiles = ['Hero01_Armstrong', 'Hero02_Ramirez', 'Hero03_Jones', 'Hero04_Foley'];
  const heroNames = ['BRADLEY', 'CONNORS', 'JONES', 'FOLEY'];
  const heroWeapons = [
    ['US_WPN_M16A2', 'US_WPN_SIGP228', findWeaponId(/LAW66/i, 'US_WPN_M16A2')],
    [findWeaponId(/SAW|M249|M60/i, 'US_WPN_M16A2'), 'US_WPN_SIGP228'],
    ['US_WPN_M16A2', 'US_WPN_SIGP228'],
    [findWeaponId(/PSG1|SNIPER/i, 'US_WPN_M16A2'), 'US_WPN_SIGP228']
  ];
  const isM1 = MIS === 'mission1';
  const squadCount = isM1 ? 3 : 4;               // Foley is the POW in mission 1
  for (let i = 0; i < squadCount; i++) {
    const g = await loadModel(`game/assets/models/play/${heroFiles[i]}.glb`);
    const A = buildActor(g.scene, [...(g.animations || []), ...ANIMLIB]);
    A.team = 'us'; A.name = heroNames[i]; A.maxHp = 150; A.hp = 150; A.heroIdx = i;
    const off = [[0, 0], [-1.6, -1.2], [1.6, -1.2], [0, -2.6]][i];
    A.pos.set(startPos.x + off[0], startPos.y + 2, startPos.z + off[1]);
    A.yaw = units.start.yaw || 0;
    A.inv = heroWeapons[i].map(w => ({ id: w, ammo: weaponDef(w).mag, reserve: weaponDef(w).mag * 6 }));
    A.held = 0;
    attachGun(A, weaponDef(A.inv[0].id));
    A.setAnim('idle');
    scene.add(A.obj); squad.push(A);
  }
  // Foley, the prisoner (mission 1— from the mission's own placement)
  if (isM1 && props && props.Foley && props.Foley.length >= 3) {
    const p = props.Foley;
    const g = await loadModel('game/assets/models/play/Hero04_Foley.glb');
    const A = buildActor(g.scene, [...(g.animations || []), ...ANIMLIB]);
    A.team = 'pow'; A.name = 'FOLEY'; A.maxHp = 150; A.hp = 150; A.heroIdx = 3;
    A.pos.set(p[0], p[1] + 0.2, p[2]);
    A.inv = [[findWeaponId(/PSG1|SNIPER/i, 'US_WPN_M16A2'), 'US_WPN_SIGP228']].flat().map(w => ({ id: w, ammo: weaponDef(w).mag, reserve: weaponDef(w).mag * 6 }));
    A.held = 0;
    A.setAnim('kneel');
    scene.add(A.obj); prisoner = A;
  }
  // hostiles — Iraqi infantry exactly where the mission file puts them
  const eg = await loadModel('game/assets/models/enemy/IraqInfantry01_Sandy.glb');
  const eClips = [...(eg.animations || []), ...ANIMLIB];
  for (const e of units.enemies || []) {
    const A = buildActor(skClone(eg.scene), eClips);
    A.team = 'iq'; A.name = e.unit || 'Iraqi'; A.maxHp = 48; A.hp = 48;   // HStat: IR_Infantryman = 48
    A.pos.set(e.pos[0], e.pos[1] + 0.4, e.pos[2]);
    A.yaw = e.yaw || 0;
    A.weaponId = e.weapon || 'IR_WPN_AK47';
    A.post = A.pos.clone(); A.state = 'post'; A.memT = 0; A.lastSeen = null;
    A.wp = nearestWp(A.pos); A.burst = 0; A.nextShot = 0; A.think = Math.random() * 0.3;
    attachGun(A, weaponDef(A.weaponId));
    A.setAnim('idle');
    scene.add(A.obj); enemies.push(A);
  }
  activeIdx = 0;
}
function nearestWp(p) {
  let bi = -1, bd = 1e12;
  waypoints.forEach((w, i) => { const d = (w.pos[0]-p.x)**2 + (w.pos[2]-p.z)**2; if (d < bd) { bd = d; bi = i; } });
  return bi;
}

/* ---------------- combat ---------------- */
function eyeOf(A) { return V3(A.pos.x, A.pos.y + (A.crouch ? 1.05 : 1.55), A.pos.z); }
function chestOf(A) { return V3(A.pos.x, A.pos.y + 1.15, A.pos.z); }
function muzzleOf(A) { const e = eyeOf(A); return e.add(V3(Math.sin(A.yaw), 0, Math.cos(A.yaw)).multiplyScalar(0.55)); }
function spawnTracer(a, b, colHex) {
  let T = tracers.find(t => t.life <= 0);
  if (!T) {
    if (tracers.length > 40) return;
    T = { obj: new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.025, 1), new THREE.MeshBasicMaterial({ color: 0xffe2ae, transparent: true })), life: 0 };
    T.obj.frustumCulled = false; scene.add(T.obj); tracers.push(T);
  }
  const len = a.distanceTo(b); if (len < 2) return;
  T.obj.material.color.setHex(colHex);
  T.obj.position.copy(a).lerp(b, 0.5);
  T.obj.lookAt(b); T.obj.scale.set(1, 1, len); T.obj.visible = true; T.life = 0.07;
}
function flashAt(p, big = false) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: muzzleTex, transparent: true, depthWrite: false }));
  s.position.copy(p); const sc = big ? 1.5 : 0.8; s.scale.set(sc, sc * 0.6, 1);
  s.material.rotation = Math.random() * 6.3;
  scene.add(s); fxSprites.push({ sp: s, t: 0.07, max: 0.07 });
}
function damage(A, dmg, fromPos) {
  if (!A.alive) return;
  A.hp -= dmg;
  if (A.team === 'iq') { A.lastSeen = fromPos ? fromPos.clone() : A.lastSeen; A.memT = 20; if (A.state === 'post') A.state = 'alert'; }
  if (A.hp <= 0) kill(A);
}
function kill(A) {
  A.alive = false; A.hp = 0; A.setAnim('death', 0.08, true);
  if (A.team === 'iq' && Math.random() < 0.5) voice('enemy_killed', 0.5);
  checkObjectives();
}
function fireHitscan(shooter, targetPos, dmg, opts = {}) {
  // nearest actor intersected by the shot line (sphere test, head bonus)
  let best = null, bestT = 1e9;
  const dir = targetPos.clone().sub(muzzleOf(shooter)).normalize();
  const org = muzzleOf(shooter);
  const pool = shooter.team === 'us' ? enemies : squad.concat(prisoner && prisoner.team === 'us' ? [prisoner] : []);
  for (const T of pool) {
    if (!T.alive || T === shooter) continue;
    const c = chestOf(T);
    const to = c.clone().sub(org); const t = to.dot(dir);
    if (t < 1 || t > (opts.range || 800)) continue;
    const p = org.clone().add(dir.clone().multiplyScalar(t));
    const dHead = p.distanceTo(V3(T.pos.x, T.pos.y + 1.55, T.pos.z));
    const dBody = p.distanceTo(c);
    if (Math.min(dHead, dBody) < 0.62 && t < bestT) { bestT = t; best = { T, head: dHead < dBody, point: p }; }
  }
  const end = best ? best.point : org.clone().add(dir.multiplyScalar(opts.range || 300));
  spawnTracer(org, end, shooter.team === 'us' ? 0xffe2ae : 0xffc9a0);
  flashAt(org, !!opts.big);
  if (best) damage(best.T, dmg * (best.head ? 3 : 1), shooter.pos);
  return best;
}
function heroFire(now) {
  const M = squad[activeIdx]; if (!M || !M.alive) return;
  const slot = M.inv[M.held]; const def = weaponDef(slot.id);
  if (now < (M.nextShot || 0)) return;
  if (slot.ammo <= 0) { reload(M); return; }
  M.nextShot = now + def.interval * 1000;
  slot.ammo--;
  const dirV = V3(-Math.sin(camYaw) * Math.cos(camPitch), Math.sin(camPitch), -Math.cos(camYaw) * Math.cos(camPitch));
  const from = camera.position.clone();
  const target = from.clone().add(dirV.multiplyScalar(def.range || 400));
  M.yaw = camYaw + Math.PI;
  weaponSound(slot.id, 0);
  gunNoise(M.pos, 55);
  const hit = fireHitscan(M, target, def.dmg, { range: def.range, big: /LAW|RPG/i.test(slot.id) });
  if (hit) { const h = $('hitm'); h.style.display = 'block'; setTimeout(() => h.style.display = 'none', 90); }
}
function gunNoise(pos, r) {
  for (const E of enemies) if (E.alive && E.pos.distanceTo(pos) < r && E.state === 'post') {
    E.state = 'alert'; E.lastSeen = pos.clone(); E.memT = 14;
  }
}
function reload(M) {
  const slot = M.inv[M.held]; const def = weaponDef(slot.id);
  if (slot.ammo >= def.mag || slot.reserve <= 0 || M.reloading) return;
  M.reloading = true;
  playSnd('game/assets/sounds/ui/click2.wav', 0.5);
  setTimeout(() => {
    const take = Math.min(def.mag - slot.ammo, slot.reserve);
    slot.ammo += take; slot.reserve -= take; M.reloading = false;
  }, def.reload * 1000);
}
function switchHero(i) {
  if (i < 0 || i >= squad.length || !squad[i].alive || i === activeIdx) return;
  activeIdx = i;
  const M = squad[i];
  camYaw = M.yaw + Math.PI;
  flashHud();
}
function switchWeapon(d) {
  const M = squad[activeIdx]; if (!M) return;
  M.held = ((M.held + d) % M.inv.length + M.inv.length) % M.inv.length;
  attachGun(M, weaponDef(M.inv[M.held].id));
  playSnd('game/assets/sounds/ui/click.wav', 0.5);
  flashHud();
}

/* ---------------- AI ---------------- */
function moveActor(A, tx, tz, speed, dt) {
  const dx = tx - A.pos.x, dz = tz - A.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.3) return true;
  const step = Math.min(d, speed * dt);
  const nx = A.pos.x + dx / d * step, nz = A.pos.z + dz / d * step;
  const gy = groundH(nx, nz), cy = groundH(A.pos.x, A.pos.z);
  if (gy - cy > 1.15 && A.vy <= 0) return false;          // cliff / wall: don't climb
  A.pos.x = nx; A.pos.z = nz;
  A.yaw = Math.atan2(dx, dz);
  return d - step < 0.35;
}
function senseEnemy(E, dt) {
  E.think -= dt; if (E.think > 0) return;
  E.think = 0.22;
  let seen = null, sd = 1e9;
  for (const M of squad.concat(prisoner && prisoner.team === 'us' ? [prisoner] : [])) {
    if (!M.alive) continue;
    const d = E.pos.distanceTo(M.pos);
    if (d > 95) continue;
    const ang = Math.abs(((Math.atan2(M.pos.x - E.pos.x, M.pos.z - E.pos.z) - E.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    const near = d < 7 || (M === squad[activeIdx] && !M.crouch && d < 15);
    if ((ang < 1.15 || near) && losClear(eyeOf(E), chestOf(M)) && d < sd) { seen = M; sd = d; }
  }
  if (seen) {
    if (E.state === 'post') voice(Math.random() < 0.5 ? 'fire_at_will_loud' : 'advance_order_loud', clamp(1 - sd / 80, 0.1, 0.7));
    E.state = 'engage'; E.target = seen; E.lastSeen = seen.pos.clone(); E.memT = 22;
  } else if (E.memT > 0) {
    E.memT -= 0.22;
    if (E.state === 'engage') E.state = 'alert';
    if (E.memT <= 0) { E.state = 'post'; E.target = null; }
  }
}
function enemyAct(E, dt, now) {
  if (!E.alive) return;
  senseEnemy(E, dt);
  const def = weaponDef(E.weaponId || 'IR_WPN_AK47');
  let moving = false;
  if (E.state === 'engage' && E.target && E.target.alive) {
    const T = E.target, d = E.pos.distanceTo(T.pos);
    E.yaw = Math.atan2(T.pos.x - E.pos.x, T.pos.z - E.pos.z);
    if (d > 55) { moveActor(E, T.pos.x, T.pos.z, 3.1, dt); moving = true; }
    else if (losClear(eyeOf(E), chestOf(T)) && now > (E.nextShot || 0)) {
      E.nextShot = now + (def.interval * 1000) * rand(2.2, 3.4);
      weaponSound(E.weaponId || 'IR_WPN_AK47', d);
      gunNoise(E.pos, 40);
      // OG bullets hurt; accuracy keeps it fair at range
      const spread = clamp(0.02 + d / 900, 0.02, 0.09);
      const tp = chestOf(T).add(V3(rand(-1, 1) * spread * d, rand(-0.4, 0.8) * spread * d, rand(-1, 1) * spread * d));
      fireHitscan(E, tp, Math.max(2, def.dmg * 0.32), { range: def.range });
    }
  } else if (E.state === 'alert' && E.lastSeen) {
    if (moveActor(E, E.lastSeen.x, E.lastSeen.z, 2.4, dt)) { E.lastSeen = null; }
    moving = true;
  } else {
    // hold position / walk the mission's waypoint chain
    if (E.wp >= 0 && waypoints[E.wp]) {
      const w = waypoints[E.wp];
      const d = Math.hypot(w.pos[0] - E.pos.x, w.pos[2] - E.pos.z);
      if (d > 14) { if (moveActor(E, w.pos[0], w.pos[2], 1.5, dt)) { /* walking */ } moving = d > 1.2; }
      else if (Math.random() < dt * 0.05) E.wp = (w.next !== undefined && waypoints[w.next]) ? w.next : E.wp;
    }
  }
  E.setAnim(moving ? 'run' : (E.state === 'engage' ? 'aim' : 'idle'));
}
function mateAct(M, dt, now) {
  if (!M.alive || M === squad[activeIdx]) return;
  const L = squad[activeIdx];
  const idx = squad.indexOf(M);
  const bx = L.pos.x + Math.sin(L.yaw) * -2.4 + Math.cos(L.yaw) * (idx - 1) * 1.9;
  const bz = L.pos.z + Math.cos(L.yaw) * -2.4 - Math.sin(L.yaw) * (idx - 1) * 1.9;
  const d = Math.hypot(bx - M.pos.x, bz - M.pos.z);
  let moving = false;
  if (d > 1.6) { moveActor(M, bx, bz, d > 14 ? 4.4 : 3.2, dt); moving = true; }
  else M.yaw = L.yaw;
  M.crouch = L.crouch;
  // engage what they can see
  let best = null, bd = 60;
  for (const E of enemies) {
    if (!E.alive) continue;
    const dd = M.pos.distanceTo(E.pos);
    if (dd < bd && losClear(eyeOf(M), chestOf(E))) { best = E; bd = dd; }
  }
  if (best && now > (M.nextShot || 0)) {
    const def = weaponDef(M.inv[M.held].id);
    M.nextShot = now + def.interval * 1000 * 2.6;
    M.yaw = Math.atan2(best.pos.x - M.pos.x, best.pos.z - M.pos.z);
    weaponSound(M.inv[M.held].id, bd);
    fireHitscan(M, chestOf(best), def.dmg, { range: def.range });
  }
  M.setAnim(moving ? 'run' : (M.crouch ? 'kneel' : 'idle'));
}

/* ---------------- objectives ---------------- */
const OBJ_LABEL = ['RESCUE FOLEY', 'FIND THE C4', 'DESTROY THE BRIDGE', 'EXTRACTION'];
function setupObjectives() {
  hasC4 = false; planted = false; plantT = 0; objIdx = 0;
  const t = MTEXT[MIS];
  const trig = n => { const x = triggers.find(t => t.name === n); return x ? V3(x.pos[0], x.pos[1], x.pos[2]) : null; };
  c4Pos = trig('C4');
  extractPos = trig('PICKUP_BLACKHAWK_TRIGGER') || (hawkPos ? hawkPos.clone() : startPos.clone());
  if (MIS === 'mission1' && t) {
    objectives = t.objectives.map((o, i) => ({ label: OBJ_LABEL[i] || o.id, text: o.text, done: false }));
  } else {
    const n = enemies.length;
    objectives = [
      { label: 'ELIMINATE HOSTILES', text: `Eliminate all hostile forces in the area (${n}).`, done: false },
      { label: 'EXTRACTION', text: 'Return to the landing zone for helicopter extraction.', done: false }
    ];
  }
  refreshObjPanel();
}
function toast(label, text) {
  const el = $('objToast');
  el.innerHTML = `<b>${label}</b>${text}`;
  el.style.opacity = 1;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.style.opacity = 0, 5200);
}
function refreshObjPanel() {
  $('objList').innerHTML = objectives.map((o, i) =>
    `<li class="${o.done ? 'done' : ''}">${i === objIdx && !o.done ? '▶ ' : ''}<b>${o.label}</b> — ${o.text}</li>`).join('');
}
function checkObjectives() {
  if (MIS !== 'mission1') {
    if (objIdx === 0 && enemies.every(e => !e.alive)) {
      objectives[0].done = true; objIdx = 1;
      toast('OBJECTIVE COMPLETE', 'All hostiles eliminated. Return to the LZ.');
      refreshObjPanel();
    }
    return;
  }
  // mission 1 chain is proximity-driven in interactTick; kills only feed counters
}
function rescueFoley() {
  if (!prisoner) return;
  prisoner.team = 'us'; prisoner.name = 'FOLEY';
  attachGun(prisoner, weaponDef(prisoner.inv[0].id));
  squad.push(prisoner); prisoner = null;
  objectives[0].done = true; objIdx = 1;
  toast('FOLEY RESCUED', objectives[1].text);
  voice('enemy_killed', 0.4);
  refreshObjPanel(); flashHud();
}
function explodeBridge() {
  planted = true;
  objectives[2].done = true; objIdx = 3;
  const p = bridgePos.clone(); p.y = groundH(p.x, p.z) + 3;
  for (let i = 0; i < 5; i++) setTimeout(() => flashAt(p.clone().add(V3(rand(-4, 4), rand(0, 3), rand(-4, 4))), true), i * 160);
  playSnd('game/assets/sounds/explosion1.wav', 1);
  setTimeout(() => playSnd('game/assets/sounds/explosion2.wav', 0.9), 300);
  toast('BRIDGE DESTROYED', objectives[3].text);
  refreshObjPanel();
}
function missionComplete() {
  playing = false;
  $('endTitle').textContent = 'MISSION COMPLETE';
  $('endSub').textContent = MISNAME + ' — objectives achieved';
  $('endOv').style.display = 'block';
  music(null);
}
function missionFailed(who) {
  if (!playing) return;
  playing = false;
  $('endTitle').textContent = 'MISSION FAILED';
  $('endSub').textContent = who + ' is down. The squad cannot continue.';
  $('endOv').style.display = 'block';
  music(null);
}

/* ---------------- interaction / per-frame checks ---------------- */
function interactTick(dt) {
  const M = squad[activeIdx]; if (!M || !M.alive) { $('prompt').style.display = 'none'; return; }
  let prompt = null, act = null;
  if (MIS === 'mission1') {
    if (objIdx === 0 && prisoner) {
      const d = M.pos.distanceTo(prisoner.pos);
      if (d < 6) { prompt = 'F — RESCUE FOLEY'; act = rescueFoley; }
    } else if (objIdx === 1 && c4Pos) {
      const d = M.pos.distanceTo(c4Pos);
      if (d < 5) { prompt = 'F — TAKE THE C4'; act = () => {
        hasC4 = true; objectives[1].done = true; objIdx = 2;
        toast('C4 RECOVERED', objectives[2].text); refreshObjPanel(); playSnd('game/assets/sounds/ui/click.wav', 0.7);
      }; }
    } else if (objIdx === 2 && hasC4) {
      const d = M.pos.distanceTo(bridgePos);
      if (d < 8) {
        prompt = plantT > 0 ? 'PLANTING…' : 'F — PLANT THE C4 ON THE STRUT';
        act = () => { plantT = 2.6; };
        if (plantT > 0) {
          plantT -= dt; M.setAnim('kneel');
          if (plantT <= 0) explodeBridge();
        }
      }
    } else if (objIdx === 3 && extractPos) {
      const d = M.pos.distanceTo(extractPos);
      const foleyNear = !squad.find(s => s.name === 'FOLEY') || squad.find(s => s.name === 'FOLEY').pos.distanceTo(extractPos) < 26;
      if (d < 9 && foleyNear) { missionComplete(); return; }
      if (d < 9) prompt = 'FOLEY MUST REACH THE LZ';
    }
  } else {
    if (objIdx === 1 && extractPos && M.pos.distanceTo(extractPos) < 9) { missionComplete(); return; }
  }
  const pr = $('prompt');
  if (prompt) { pr.textContent = prompt; pr.style.display = 'block'; } else pr.style.display = 'none';
  if (act && keys['KeyF']) { act(); keys['KeyF'] = false; }
}

/* ---------------- HUD ---------------- */
function flashHud() { lastHud = 0; }
function buildCards() {
  $('squadCards').innerHTML = squad.map((M, i) =>
    `<div class="scard ${i === activeIdx ? 'act' : ''} ${M.alive ? '' : 'dead'}" id="card${i}">
       <img src="game/assets/textures/portraits/sq${M.heroIdx + 1}.png" alt="">
       <div class="nm">${M.name}</div><div class="hpbar"><i id="hp${i}"></i></div></div>`).join('');
}
function updateHud(now) {
  if (now - lastHud < 120) return;
  lastHud = now;
  squad.forEach((M, i) => { const b = $('hp' + i); if (b) b.style.width = clamp(M.hp / M.maxHp * 100, 0, 100) + '%'; });
  document.querySelectorAll('.scard').forEach((c, i) => {
    c.classList.toggle('act', i === activeIdx);
    if (squad[i]) c.classList.toggle('dead', !squad[i].alive);
  });
  const M = squad[activeIdx];
  if (M && M.inv) {
    const slot = M.inv[M.held], def = weaponDef(slot.id);
    $('gunName').textContent = def.label || slot.id;
    $('gunAmmo').innerHTML = `${slot.ammo} <small>/ ${slot.reserve}${M.reloading ? ' · RELOADING' : ''}</small>`;
  }
  if ($('objPanel').style.display === 'block') refreshObjPanel();
}

/* ---------------- input ---------------- */
function bindInput() {
  addEventListener('keydown', e => {
    keys[e.code] = true;
    if (SCREEN === 'title' && (e.code === 'Enter' || e.code === 'Space')) { toMenu(); return; }
    if (!playing) return;
    if (e.code === 'Digit1') switchHero(0);
    if (e.code === 'Digit2') switchHero(1);
    if (e.code === 'Digit3') switchHero(2);
    if (e.code === 'Digit4') switchHero(3);
    if (e.code === 'Tab') { e.preventDefault(); let n = activeIdx; do { n = (n + 1) % squad.length; } while (!squad[n].alive && n !== activeIdx); switchHero(n); }
    if (e.code === 'KeyR') reload(squad[activeIdx]);
    if (e.code === 'KeyC') { const M = squad[activeIdx]; if (M) M.crouch = !M.crouch; }
    if (e.code === 'KeyQ') switchWeapon(-1);
    if (e.code === 'KeyE') switchWeapon(1);
    if (e.code === 'F1') { e.preventDefault(); const p = $('objPanel'); p.style.display = p.style.display === 'block' ? 'none' : 'block'; if (p.style.display === 'block') refreshObjPanel(); }
    if (e.code === 'Escape') togglePause();
  });
  addEventListener('keyup', e => keys[e.code] = false);
  const cv = renderer.domElement;
  let dragging = false, lx = 0, ly = 0;
  cv.addEventListener('mousedown', e => {
    if (!playing || paused) return;
    if (e.button === 0) { firing = true; if (document.pointerLockElement !== cv) { dragging = true; lx = e.clientX; ly = e.clientY; } }
    if (e.button === 2) aiming = true;
  });
  addEventListener('mouseup', e => { if (e.button === 0) { firing = false; dragging = false; } if (e.button === 2) aiming = false; });
  cv.addEventListener('click', () => { if (playing && !paused && document.pointerLockElement !== cv) cv.requestPointerLock && cv.requestPointerLock(); });
  addEventListener('mousemove', e => {
    if (!playing || paused) return;
    if (document.pointerLockElement === cv) {
      camYaw -= e.movementX * 0.0026; camPitch = clamp(camPitch + e.movementY * 0.0022, -0.9, 1.1);
    } else if (dragging) {
      camYaw -= (e.clientX - lx) * 0.005; camPitch = clamp(camPitch + (e.clientY - ly) * 0.004, -0.9, 1.1);
      lx = e.clientX; ly = e.clientY;
    }
  });
  cv.addEventListener('contextmenu', e => e.preventDefault());
  addEventListener('wheel', e => { if (playing && !paused) switchWeapon(e.deltaY > 0 ? 1 : -1); });
}
function togglePause() {
  if (!playing) return;
  paused = !paused;
  $('pauseOv').style.display = paused ? 'block' : 'none';
  if (!paused && document.pointerLockElement) document.exitPointerLock();
}

/* ---------------- per-frame update ---------------- */
function updatePlayer(dt, now) {
  const M = squad[activeIdx]; if (!M || !M.alive) return;
  let mx = 0, mz = 0;
  if (keys['KeyW']) mz += 1; if (keys['KeyS']) mz -= 1;
  if (keys['KeyA']) mx -= 1; if (keys['KeyD']) mx += 1;
  const run = keys['ShiftLeft'] || keys['ShiftRight'];
  const speed = M.crouch ? 1.15 : (run ? 4.6 : 3.1);
  const moving = (mx !== 0 || mz !== 0);
  if (moving) {
    const sin = Math.sin(camYaw), cos = Math.cos(camYaw);
    const wx = (mx * cos - mz * sin), wz = (-mz * cos - mx * sin);
    const L = Math.hypot(wx, wz) || 1;
    moveActor(M, M.pos.x + wx / L * 10, M.pos.z + wz / L * 10, speed, dt);
    if (!aiming) M.yaw = Math.atan2(wx, wz);
  }
  if (aiming) M.yaw = camYaw + Math.PI;
  // gravity / ground snap
  const gy = groundH(M.pos.x, M.pos.z);
  if (M.pos.y > gy + 0.02) { M.vy -= 22 * dt; M.pos.y = Math.max(gy, M.pos.y + M.vy * dt); if (M.pos.y <= gy) M.vy = 0; }
  else { M.pos.y = gy; M.vy = 0; }
  M.setAnim(aiming ? 'aim' : (moving ? (M.crouch ? 'walkC' : 'run') : (M.crouch ? 'kneel' : 'idle')));
  if (firing && !paused) heroFire(now);
  // camera: third person, over-shoulder while aiming
  const dist = aiming ? 2.1 : 4.4;
  const back = V3(Math.sin(camYaw) * Math.cos(camPitch), -Math.sin(camPitch), Math.cos(camYaw) * Math.cos(camPitch));
  const head = V3(M.pos.x, M.pos.y + 1.62, M.pos.z);
  const cd = head.clone().add(back.multiplyScalar(dist));
  cd.y = Math.max(cd.y, groundH(cd.x, cd.z) + 0.35);
  camera.position.lerp(cd, 1 - Math.pow(0.0001, dt));
  const look = head.clone().add(V3(-Math.sin(camYaw) * Math.cos(camPitch), Math.sin(camPitch), -Math.cos(camYaw) * Math.cos(camPitch)).multiplyScalar(30));
  if (aiming) look.add(V3(Math.cos(camYaw) * 0.55, 0, -Math.sin(camYaw) * 0.55));
  camera.lookAt(look);
  camera.fov += ((aiming ? 38 : 62) - camera.fov) * Math.min(1, dt * 10);
  camera.updateProjectionMatrix();
  $('xhair').style.display = aiming ? 'block' : 'none';
}
function settle(A, dt) {
  const gy = groundH(A.pos.x, A.pos.z);
  if (A.pos.y > gy + 0.02) { A.vy -= 22 * dt; A.pos.y = Math.max(gy, A.pos.y + A.vy * dt); if (A.pos.y <= gy) A.vy = 0; }
  else A.pos.y = gy;
  A.obj.position.copy(A.pos);
  A.obj.rotation.y = A.yaw;
}
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  const now = performance.now();
  if (playing && !paused) {
    updatePlayer(dt, now);
    for (const M of squad) mateAct(M, dt, now);
    for (const E of enemies) enemyAct(E, dt, now);
    if (prisoner) { prisoner.setAnim('kneel'); settle(prisoner, dt); prisoner.update(dt); }
    for (const A of squad.concat(enemies)) { if (A !== squad[activeIdx] || true) settle(A, dt); A.update(dt); }
    for (const r of rotors) r.rotation.z += dt * 9;
    interactTick(dt);
    for (const T of tracers) if (T.life > 0) { T.life -= dt; T.obj.material.opacity = Math.max(0, T.life / 0.07); if (T.life <= 0) T.obj.visible = false; }
    for (let i = fxSprites.length - 1; i >= 0; i--) { const f = fxSprites[i]; f.t -= dt; f.sp.material.opacity = Math.max(0, f.t / f.max); if (f.t <= 0) { scene.remove(f.sp); fxSprites.splice(i, 1); } }
    updateHud(now);
    // squad wipe / leader death
    if (!squad.some(s => s.alive)) missionFailed('The squad');
    else if (prisoner && !prisoner.alive) missionFailed('Foley');
  }
  renderer.render(scene, camera);
}

/* ---------------- screens & flow ---------------- */
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('on'));
  $(id).classList.add('on');
  SCREEN = id;
}
function toMenu() { show('menu'); music('game/assets/sounds/music/menu.wav'); cgMenuSel(); }
function cgMenuSel() { playSnd('game/assets/sounds/ui/click.wav', 0.6); }
let selMission = 'mission1';
function openBrief(id) {
  selMission = id;
  const me = MISSIONS.find(m => m.id === id) || { name: id };
  MISNAME = me.name;
  const t = MTEXT[id];
  $('brMission').textContent = me.name.toUpperCase();
  $('brHead').textContent = t ? t.heading : me.name.replace(/^MISSION \d+ — /, '').toUpperCase();
  $('brDate').textContent = t ? t.date : 'KUWAIT, 1991';
  $('brText').textContent = t ? t.brief :
    'Coalition forces are advancing into Kuwait. Your squad will deploy into the combat zone, eliminate Iraqi resistance and return to the landing zone for extraction.';
  const objs = t ? t.objectives : [
    { id: 'Eliminate', text: 'Eliminate all hostile forces in the area.' },
    { id: 'Extraction', text: 'Return to the landing zone for helicopter extraction.' }];
  $('brObjs').innerHTML = objs.map(o => `<li><b>${o.id}</b> — ${o.text}</li>`).join('');
  $('briefLoad').style.display = 'none';
  $('briefStatus').textContent = '';
  $('brDeploy').classList.remove('dim');
  show('brief');
}
async function startMission(id) {
  MIS = id;
  const me = MISSIONS.find(m => m.id === id); MISNAME = me ? me.name : id;
  $('briefLoad').style.display = 'block';
  $('brDeploy').classList.add('dim');
  const step = (label, f) => { $('briefBar').style.width = (f * 100) + '%'; $('briefStatus').textContent = label; };
  step('LOADING MISSION DATA', 0.05);
  try {
    const { units, props } = await buildWorld(id, step);
    step('DEPLOYING SQUAD', 0.7);
    await spawnActors(units, props);
    step('FINAL CHECKS', 0.9);
    setupObjectives();
    buildCards(); flashHud();
    camYaw = (units.start.yaw || 0) + Math.PI;
    // original-film style location card, where the mission carries one
    show('game'); playing = true; paused = false;
    $('pauseOv').style.display = 'none'; $('endOv').style.display = 'none';
    music(null);
    const intro = MTEXT[id] && MTEXT[id].intro;
    if (intro && intro[0]) {
      $('cineT').style.display = $('cineB').style.display = 'block';
      $('cineTxt').style.display = 'block';
      $('cineTxt').textContent = intro[0];
      setTimeout(() => { $('cineTxt').textContent = intro[1] || ''; }, 2300);
      setTimeout(() => { $('cineT').style.display = $('cineB').style.display = 'none'; $('cineTxt').style.display = 'none'; }, 4600);
    }
    toast(objectives[0].label, objectives[0].text);
    step('DEPLOYED', 1);
  } catch (err) {
    $('briefStatus').textContent = 'FAILED TO LOAD: ' + err.message;
    $('brDeploy').classList.remove('dim');
  }
}

/* ---------------- boot ---------------- */
async function boot() {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  $('game').appendChild(renderer.domElement);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 2000);
  clock = new THREE.Clock();
  muzzleTex = texLoader.load('game/assets/textures/fx/m15shot.png');
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
  bindInput();
  // data first: the original stat tables + mission list + briefing text
  const w = await jget('game/data/og-weapons.json');
  for (const r of w) WDATA[r.id] = { ...r, label: r.id.replace(/^US_WPN_|^IR_WPN_/, '') };
  try { MTEXT = await jget('game/data/mission-text.json'); } catch (e) { MTEXT = {}; }
  MISSIONS = (await jget('game/missions.json')).filter(m => !/mp|training/.test(m.id));
  const grid = $('missionGrid');
  grid.innerHTML = MISSIONS.map(m =>
    `<div class="mcard" data-m="${m.id}"><img src="game/assets/textures/ui/missions/${m.id}.jpg" onerror="this.style.display='none'"><div>${m.name}</div></div>`).join('');
  grid.querySelectorAll('.mcard').forEach(c => c.addEventListener('click', () => { cgMenuSel(); openBrief(c.dataset.m); }));
  // menu wiring
  $('title').addEventListener('click', toMenu);
  $('miCampaign').addEventListener('click', () => { cgMenuSel(); show('missions'); });
  $('miQuick').addEventListener('click', () => { cgMenuSel(); openBrief('mission1'); });
  $('miHow').addEventListener('click', () => { cgMenuSel(); show('how'); });
  $('howBack').addEventListener('click', () => { cgMenuSel(); show('menu'); });
  $('misBack').addEventListener('click', () => { cgMenuSel(); show('menu'); });
  $('brBack').addEventListener('click', () => { cgMenuSel(); show('missions'); });
  $('brDeploy').addEventListener('click', () => startMission(selMission));
  $('pzResume').addEventListener('click', togglePause);
  $('pzRestart').addEventListener('click', () => { $('pauseOv').style.display = 'none'; paused = false; show('brief'); startMission(MIS); });
  $('pzQuit').addEventListener('click', () => { playing = false; paused = false; $('pauseOv').style.display = 'none'; toMenu(); });
  $('endMenu').addEventListener('click', () => { $('endOv').style.display = 'none'; toMenu(); });
  $('endNext').addEventListener('click', () => { $('endOv').style.display = 'none'; show('missions'); });
  document.querySelectorAll('.mitem, .btn').forEach(el => el.addEventListener('mouseenter', () => playSnd('game/assets/sounds/ui/click2.wav', 0.25)));
  frame();
}
boot().catch(e => { console.error(e); });
/* ---------------- test hooks (headless verification) ---------------- */
window.CDS_TEST = {
  state: () => ({
    screen: SCREEN, mission: MIS, playing,
    squad: squad.map(s => ({ name: s.name, hp: Math.round(s.hp), alive: s.alive, pos: s.pos.toArray().map(v => Math.round(v * 10) / 10) })),
    active: activeIdx,
    enemies: { total: enemies.length, alive: enemies.filter(e => e.alive).length },
    objIdx, hasC4, objectives: objectives.map(o => o.label),
    prisoner: prisoner ? { pos: prisoner.pos.toArray() } : null,
    camPos: camera ? camera.position.toArray() : null
  }),
  start: id => startMission(id),
  warp: (x, z) => { const M = squad[activeIdx]; if (M) { M.pos.x = x; M.pos.z = z; M.pos.y = groundH(x, z) + 0.2; } },
  warpAll: (x, z) => { squad.forEach((M, i) => { M.pos.x = x + i * 1.5; M.pos.z = z + i; M.pos.y = groundH(M.pos.x, M.pos.z) + 0.2; }); },
  killNearest: () => { const M = squad[activeIdx]; let b = null, bd = 1e9; for (const E of enemies) { if (!E.alive) continue; const d = E.pos.distanceTo(M.pos); if (d < bd) { bd = d; b = E; } } if (b) kill(b); return bd; },
  giveC4: () => { hasC4 = true; },
  mats: () => { const out = []; const A = squad[0]; if (!A) return out;
    A.obj.traverse(o => { if (o.isMesh) { const m = Array.isArray(o.material) ? o.material[0] : o.material;
      out.push({ mesh: o.name, vc: !!(m && m.vertexColors), hasColorAttr: !!(o.geometry && o.geometry.hasAttribute('color')), norm: !!(m && m.normalMap), map: !!(m && m.map), vis: o.visible }); } });
    return out; },
  key: (code, down = true) => { keys[code] = down; },
  fire: d => { firing = d; }
};
