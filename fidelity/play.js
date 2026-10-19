import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// PLAYABLE SLICE — Armstrong (real model/animations) + M16A2 with WEAPS.TXT
// behaviour (mag 30, reload 1.5 s, 86 ms interval), original sounds.

const MIS = (new URLSearchParams(location.search).get('m') || 'mission1').toLowerCase();
const IS_M1 = MIS === 'mission1';
const MISDIR = 'models/' + MIS + '/';
let MISNAME = 'MISSION 1 — RESCUE';
let worldBox = null;   // union of zone bounds, for clamps + briefing map
const container = document.getElementById('view');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xc4ad82);
scene.fog = new THREE.Fog(0xc4ad82, 90, 780);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 1600);
camera.position.set(4, 2.6, 8);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
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
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;   // shadows sit on their own floor (DesertStormFix notes the OG bleed-through)
scene.add(sun);
scene.add(sun.target);
const fill = new THREE.DirectionalLight(0xbcd2ff, 0.35);
fill.position.set(-6, 4, -8);
scene.add(fill);

const loader = new GLTFLoader();
const downRay = new THREE.Raycaster();
const DOWN_DIR = new THREE.Vector3(0, -1, 0);
function groundHitY(x, z, refY) {   // null = NO terrain there (the void) — never silently 0
  downRay.set(new THREE.Vector3(x, 90, z), DOWN_DIR);
  downRay.far = 220;
  const hits = downRay.intersectObjects(_groundMeshes, false);
  if (!hits.length) return null;
  if (refY === undefined) return hits[0].point.y;
  // highest surface at/below where the character already is: standing ON the
  // bridge deck you sample the deck, walking UNDER it you sample the ground —
  // rails and struts above your head no longer teleport you up or wall you off
  for (const h of hits) if (h.point.y <= refY + 0.55) return h.point.y;
  return null;
}
function groundY(x, z) { const h = groundHitY(x, z); return h === null ? 0 : h; }
// Can a character stand at (nx,nz) heading (dx,dz)? Blocks: no ground (void),
// cliffs/too-steep slopes, and ledges too high to step onto. Normal hills pass.
const _hitCache = new Map();   // quantised ground hits so collision stays cheap
function groundHitCached(x, z, refY) {
  const k = Math.round(x * 4) + ':' + Math.round(z * 4) + (refY === undefined ? '' : '@' + Math.round(refY * 2));
  let v = _hitCache.get(k);
  if (v === undefined) { v = groundHitY(x, z, refY); _hitCache.set(k, v); if (_hitCache.size > 12000) _hitCache.clear(); }
  return v;
}
function groundForY(p) { const h = groundHitCached(p.x, p.z, p.y + 0.45); return h === null ? groundYCached(p.x, p.z) : h; }
function slopeAt(x, z, refY) {
  // "mid-face" test: from a point embedded in a cliff face the ground keeps
  // rising steeply behind you AND dropping steeply ahead of you. A ledge rim
  // (rises behind, level with you) and a cliff foot (level, drops behind)
  // are honest ground — only the face itself fails.
  const hC = groundHitCached(x, z, refY);
  if (hC === null) return { steep: false, downX: 0, downZ: 0 };
  let mn = hC, mx = hC, dX = 0, dZ = 0;
  const S = [[0.55, 0], [-0.55, 0], [0, 0.55], [0, -0.55]];
  for (const [ox, oz] of S) {
    const h = groundHitCached(x + ox, z + oz, refY);
    if (h === null) continue;
    if (h > mx) mx = h;
    if (h < mn) { mn = h; dX = ox; dZ = oz; }
  }
  const L = Math.hypot(dX, dZ) || 1;
  return { steep: (mx - hC) > 0.85 && (hC - mn) > 0.85, downX: dX / L, downZ: dZ / L };
}
function canStandAt(nx, nz, dx, dz, refY) {
  if (gateBlockSeg && gateBlock(nx, nz)) return false;   // a closed gate is a wall
  const h = groundHitCached(nx, nz, refY);
  if (h === null) {
    // nothing in the step window: stepping off a real drop (ground exists
    // far below) is allowed for the player — he falls; the void stays shut
    if (refY === player.pos.y) { const gAbs = groundYCached(nx, nz); if (gAbs !== null && gAbs < refY - 0.5) return true; }
    return false;
  }
  const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
  const hF = groundHitCached(nx + dx * 0.6, nz + dz * 0.6, refY), hB = groundHitCached(nx - dx * 0.6, nz - dz * 0.6, refY);
  if (hF !== null && hB !== null && (hF - hB) / 1.2 > 1.25) return false;   // steep UP face blocks; steep DOWN is a ledge — you fall
  if (h - refY > 0.95) return false;                                                // ledge/cliff face
  if ((!player.airborne || refY !== player.pos.y) && h > refY - 0.5 && slopeAt(nx, nz, refY).steep) return false;   // a cliff face is ground nowhere — but stepping OFF an edge (a real drop) stays allowed: you fall
  return true;
}
const _groundMeshes = [];   // zone ground meshes only — never the whole world
const _gCache = new Map();
function groundYCached(x, z) {
  const k = Math.round(x * 2) + ':' + Math.round(z * 2);
  let v = _gCache.get(k);
  if (v === undefined) { v = groundY(x, z); _gCache.set(k, v); if (_gCache.size > 6000) _gCache.clear(); }
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
// aim pitch: rotate the spine bones so the character (and his rifle) really
// points up/down at the target, on top of the authored aim animation
function findAimBones(root) {
  const out = { spine: null, spine2: null, spine3: null, head: null };
  root.traverse(o => {
    const nm = (o.name || '').toUpperCase();
    if (nm === 'BIP01 SPINE1') out.spine = o;
    else if (nm === 'BIP01 SPINE2') out.spine2 = o;
    else if (nm === 'BIP01 SPINE3') out.spine3 = o;
    else if (nm === 'BIP01 HEAD') out.head = o;
  });
  return out;
}
const _aimQ = new THREE.Quaternion(), _aimAxis = new THREE.Vector3(0, 1, 0);
function _pitchBone(bone, ang) {
  if (!bone || !ang) return;
  _aimQ.setFromAxisAngle(_aimAxis, ang);
  bone.quaternion.multiply(_aimQ);
}
function applyAimPitch(bones, pitchUp) {
  // pitchUp > 0 = muzzle rising. Applied AFTER mixer.update(), so it bends
  // the animated torso/rifle up or down with the aim -- the whole character.
  if (!bones) return;
  const p = THREE.MathUtils.clamp(pitchUp, -1.0, 1.15);
  _pitchBone(bones.spine, -p * 0.38);
  _pitchBone(bones.spine2, -p * 0.34);
  _pitchBone(bones.spine3, -p * 0.22);
  _pitchBone(bones.head, -p * 0.30);   // his head looks up/down the aim too
}
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
SET.lowGfx = (navigator.hardwareConcurrency || 4) <= 4;
// the original game's difficulty: enemy toughness, aim, damage and nerve
const DIFFS = {
  EASY:   { name: 'EASY',   hp: 0.75, acc: 0.55, dmg: 0.55, react: 1.45 },
  NORMAL: { name: 'NORMAL', hp: 1.0,  acc: 1.0,  dmg: 1.0,  react: 1.0 },
  HARD:   { name: 'HARD',   hp: 1.25, acc: 1.45, dmg: 1.5,  react: 0.65 },
};
const DIFF = DIFFS[(() => { try { return localStorage.getItem('bd_diff'); } catch (e) { return null; } })()] || DIFFS.NORMAL;
const EXTRA_ANIMS = [];   // the recovered original animation library (models/play/animlib.glb)
try { // software rasterizers (SwiftShader/llvmpipe) mean this machine has no GPU path — start lean
  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const rn = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
  if (/swiftshader|llvmpipe|software rasterizer/i.test(rn)) { SET.lowGfx = true; console.log('software renderer:', rn); }
} catch (e) {}
if (SET.lowGfx) { renderer.shadowMap.enabled = false; renderer.setPixelRatio(1); }
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
// squad voice lines decoded from the game's own Bradley bank (mission1.sch)
const voiceAudio = {};
['spotted_infantry_loud','spotted_infantry_quiet','enemy_killed','im_hit','man_down',
 'advance_order_loud','advance_order_quiet','fire_at_will_loud'].forEach(n => {
  const a = new Audio('sounds/voice/' + n + '.wav'); a.preload = 'auto'; voiceAudio[n] = a;
});
const boomAudio = ['sounds/explosion1.wav', 'sounds/explosion2.wav'].map(u => { const a = new Audio(u); a.preload = 'auto'; return a; });
// enemy voices decoded from the game's MP_IraqiSoldier bank (mp_mission1.sch),
// bucketed by line energy: shouts / attack calls / pain cries / death cries / calm search talk
const evAudio = {};
for (let i = 1; i <= 18; i++) { const n = 'iraq' + String(i).padStart(2, '0'); const a = new Audio('sounds/voice/' + n + '.wav'); a.preload = 'auto'; evAudio[n] = a; }
const EVK = { spot: ['iraq01', 'iraq03', 'iraq07', 'iraq09', 'iraq18'], attack: ['iraq04', 'iraq08', 'iraq10', 'iraq11'],
  pain: ['iraq05', 'iraq15', 'iraq17'], death: ['iraq13', 'iraq14', 'iraq16'], search: ['iraq02', 'iraq06', 'iraq12'] };
let _evNext = 0, voicePlays = 0;
function playEnemyVoice(E, kind) {
  if (!playing || !E || !E.pos) return;
  const t = performance.now();
  if (t < _evNext) return;
  const d = camera.position.distanceTo(E.pos);
  if (d > 75) return;
  const list = EVK[kind] || EVK.spot;
  const a = evAudio[list[(Math.random() * list.length) | 0]];
  if (!a) return;
  _evNext = t + 1100; voicePlays++;
  try { a.volume = Math.max(0.05, Math.min(0.9, 1.15 - d / 75)) * (SET.vol || 1); a.currentTime = 0; a.play().catch(() => {}); } catch (e) {}
}
let _voiceNext = 0;
let _vLast = {};
function playVoice(name, vol = 0.55) {
  const a = voiceAudio[name]; if (!a) return;
  const t = performance.now();
  // a man under fire does NOT scream on every bullet: per-line cooldowns
  const gap = name === 'im_hit' ? 14000 : name === 'spotted_infantry_loud' ? 6000 : 2600;
  if (t - (_vLast[name] || 0) < gap) return; _vLast[name] = t;
  if (t < _voiceNext) return; _voiceNext = t + 1600;   // one call-out at a time
  try { a.volume = vol * (SET.vol || 1); a.currentTime = 0; a.play().catch(() => {}); } catch (e) {}
}
// footsteps: short movement samples from the game's shared bank, cycled by distance
let _actx = null, _noiseBuf = null;
function ensureAudio() {
  if (_actx) { if (_actx.state === 'suspended') _actx.resume().catch(() => {}); return _actx; }
  try {
    _actx = new (window.AudioContext || window.webkitAudioContext)();
    const len = Math.floor(_actx.sampleRate * 0.5);
    _noiseBuf = _actx.createBuffer(1, len, _actx.sampleRate);
    const d = _noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  } catch (e) { _actx = null; }
  return _actx;
}
function synthStep(speed, stance) {
  const ctx = ensureAudio(); if (!ctx || !_noiseBuf) return;
  const t0 = ctx.currentTime;
  const vol = Math.min(0.19, 0.032 + speed * 0.03) * (SET.vol || 1) * (stance === 'prone' ? 0.5 : 1);
  // soft gravel: a scatter of short noise grains low-passed into a hush —
  // no sine thump, no single repeating tap; every footfall is different grit
  const grains = stance === 'prone' ? 2 : 3;
  for (let i = 0; i < grains; i++) {
    const t = t0 + i * (0.03 + Math.random() * 0.022);
    const src = ctx.createBufferSource(); src.buffer = _noiseBuf;
    src.playbackRate.value = 0.5 + Math.random() * 0.35;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.value = 420 + Math.random() * 300; lp.Q.value = 0.4;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.value = 650 + Math.random() * 480; bp.Q.value = 0.55;
    const g = ctx.createGain();
    const gv = vol * (i === 0 ? 1 : 0.5) * (0.75 + Math.random() * 0.5);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0011, gv), t + 0.035);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17 + Math.random() * 0.06);
    src.connect(lp); lp.connect(bp); bp.connect(g); g.connect(ctx.destination);
    src.start(t, Math.random() * 0.4, 0.32); src.stop(t + 0.32);
  }
}
let _stepAlt = 0, _stepAcc = 0;
function updateFootsteps(dt, speed) {
  if (!speed || speed <= 0.1) { _stepAcc = 0; return; }
  _stepAcc += speed * dt;
  const stride = player.stance === 'prone' ? 0.85 : player.stance === 'crouch' ? 1.35 : speed > 3 ? 2.6 : 2.0;
  if (_stepAcc < stride) return;
  _stepAcc = 0;
  _stepAlt++;
  synthStep(speed, player.stance);
}
// desert ambience: looped filtered wind, started on deploy (user gesture)
let _ambOn = false;
function startAmbience() {
  if (_ambOn) return; _ambOn = true;
  try {
    const ctx = ensureAudio(); if (!ctx) return;
    const len = ctx.sampleRate * 3, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
    const g = ctx.createGain(); g.gain.value = 0.085 * (SET.vol || 1);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.09;
    const lg = ctx.createGain(); lg.gain.value = 0.02;
    lfo.connect(lg); lg.connect(g.gain);
    src.connect(f); f.connect(g); g.connect(ctx.destination);
    src.start(); lfo.start();
  } catch (e) { /* audio unavailable */ }
}
function playClick() { clickAudio.currentTime = 0; clickAudio.play().catch(() => {}); }

// ---- player ----
const player = {
  pos: new THREE.Vector3(0, 0, 1.5), yaw: 0.35, stance: 'stand', // stand|crouch|prone
  ammo: 30, reloading: false, reloadT: 0, nextShot: 0, moving: false,
  fireMode: 'AUTO', burstN: 0, semiLatch: false, actT: 0
};
// pose families: how a man carries each thing in his hands (original-game clips)
const POSE = {
  PISTOL: { aim: 'UPRIGHT_STANCE_WITH_PISTOL', walk: 'UPRIGHT_WALK_WITH_PISTOL', run: 'UPRIGHT_RELAXED_RUN_WITH_PISTOL', idle: 'UPRIGHT_RELAXED_WITH_PISTOL', crouchAim: 'KNEELING_STANCE_WITH_PISTOL' },
  LAW:    { aim: 'UPRIGHT_STANCE_WITH_LAW', walk: 'UPRIGHT_WALK_WITH_LAW', run: 'UPRIGHT_RELAXED_RUN_WITH_LAW', idle: 'UPRIGHT_RELAXED_WITH_LAW', crouchAim: 'KNEELING_STANCE_WITH_LAW' },
  ONEHAND:{ aim: null, walk: 'UPRIGHT_WALK_WITH_PISTOL', run: 'UPRIGHT_RELAXED_RUN_WITH_PISTOL', idle: 'UPRIGHT_RELAXED_WITH_PISTOL', crouchAim: 'KNEELING_STANCE_WITH_PISTOL' },
  BINOC:  { aim: 'UPRIGHT_USE_BINOCULARS', walk: 'UPRIGHT_WALK_WITH_PISTOL', run: 'UPRIGHT_RELAXED_RUN_WITH_PISTOL', idle: 'UPRIGHT_RELAXED_WITH_PISTOL', crouchAim: 'UPRIGHT_USE_BINOCULARS' },
};
function heldPose() {
  const s = curSlot();
  if (!s) return null;
  if (s.kind === 'item') return s.key === 'BINOCULARS' ? POSE.BINOC : POSE.ONEHAND;
  if (s.key === 'SIGP228') return POSE.PISTOL;
  if (s.key === 'LAW66' || s.key === 'RPG7') return POSE.LAW;
  if (s.key === 'KNIFE') return POSE.ONEHAND;
  return null;   // rifles keep the classic rifle set
}
function aimAllowed() { const s = curSlot(); return !!s && (s.kind === 'gun' || s.key === 'BINOCULARS'); }
// role weapons from WEAPS.TXT / Units.txt (Rifleman, Heavy Wpns, Engineer, Sniper)
function wavs(bank) {
  return [1, 2].map(i => { const a = new Audio(`sounds/${bank}_shot${i}.wav`); a.preload = 'auto'; return a; });
}
const WEAPONS = [BD.WEAPONS.M16A2, BD.WEAPONS.SAW, BD.WEAPONS.PSG1, BD.WEAPONS.BARRETT]; // role guns: rifle / SAW / engineer-marksman PSG1 / sniper
Object.values(BD.WEAPONS).forEach(w => { if (w.bank) w.snd = wavs(w.bank); w.alt = 0; });
GF.load();
setTimeout(() => { const fp = document.getElementById('forcePlay'); if (fp && !window.__playLoaded) { fp.dataset.armed = '1'; fp.style.display = 'block'; fp.onclick = (e) => { e.stopPropagation(); window.__playLoaded = true; window.__forcePlay = true; startEl.style.display = 'none'; playing = true; updateHUD(); }; } }, 45000);
let frameN = 0;
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
const E_ANIM = { walk: 'UPRIGHT_WALK_WITH_RIFLE', run: 'UPRIGHT_RELAXED_RUN_WITH_RIFLE',
  aim: 'UPRIGHT_AIM_RIFLE', idle: 'IDLE_LOOK_AROUND_WITH_GUN',
  deathF: 'DEATH_BY_SHOTGUN_FORWARD', deathB: 'DEATH_BY_SHOTGUN_BACKWARD' };
const E_SIGHT = 95, E_FIRE_RANGE = 72;   // m: guards see, shoot and chase at real ranges

function makeEnemyState(cfg) {
  return Object.assign({ obj: null, mixer: null, actions: {}, current: null, hp: Math.round(100 * DIFF.hp), alive: true,
    envY: 0, holdPost: false, path: null, pathGoal: null, grenadesLeft: 2, stillT: 0, seenT: -99,
    yaw: 0, state: 'patrol', wp: 0, spotT: 0, lostT: 0, burstLeft: 0, nextShot: 0,
    headBone: null, headGear: null, label: 'HOSTILE', props: [], faceConn: null, hatConn: null, typeIdx: 0 }, cfg);
}
// one enemy type: black-attire insurgent; variety = the game's own faces.
// Placements + patrol waypoint chains come from the real Mission1.env.
let enemies = [];
let ENV = null;
let PROPS = null, hawkObj = null, hawkRotor = null, a10Obj = null;
const ENEMY_TEX_POOL = ['textures/Insurgent_F1.png?v=1', 'textures/Insurgent_Officer.png?v=1',
  'textures/Insurgent_Mechanic.png?v=1', 'textures/Insurgent_Torturer.png?v=1'];
function routeFor(px, pz, inst) {
  const home = new THREE.Vector3(px, 0, pz);
  const wps = (ENV && ENV.waypoints) || [];
  const prefix = (inst || '').replace(/[\s_]\d+$/, '');
  const mine = prefix ? wps.filter(w => (w.name || '').startsWith(prefix)) : [];
  if (mine.length > 1) {
    const byId = new Map(wps.map(w => [w.id, w]));
    let cur = mine.find(w => /_W0$/.test(w.name)) || mine[0];
    const pts = [], seen = new Set();
    while (cur && !seen.has(cur.id) && pts.length < 8) {
      seen.add(cur.id);
      pts.push(new THREE.Vector3(cur.pos[0], 0, cur.pos[2]));
      cur = byId.get(cur.next);
      if (cur && !mine.includes(cur)) break;
    }
    if (pts.length > 1) return [home, ...pts];
  }
  return [home];   // sentry: hold the exact env post
}
function buildEnemies() {
  enemies = [];
  buildWpGraph();
  // exactly the Iraqi HLOI placements from Mission1.env — no invented guards
  // use the fullest placement list (later missions name more Iraqi unit types)
  const list = (ENV.enemies && ENV.enemies.length >= (PROPS ? PROPS.enemiesHLOI.length : 0)) ? ENV.enemies : (PROPS ? PROPS.enemiesHLOI : []);
  list.forEach((e, i) => {
    const p = new THREE.Vector3(e.pos[0], 0, e.pos[2]);
    const wps = routeFor(p.x, p.z, e.inst);
    // single-point route = a posted sentry (tower, bunker, HMG): he fights
    // from that post and never abandons it
    enemies.push(makeEnemyState({ label: e.inst || 'INSURGENT', pos: p.clone(), home: p.clone(),
      envY: e.pos[1] || 0, holdPost: wps.length <= 1,
      yaw: e.yaw || 0, waypoints: wps, texture: ENEMY_TEX_POOL[i % 4] }));
  });
  for (const E of enemies) E.active = player.pos.distanceTo(E.pos) < ENEMY_ACTIVATE_DIST;
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
  E.hp = Math.round(100 * DIFF.hp); E.alive = true; E.state = 'patrol'; E.wp = 0; E.grenadesLeft = 2; E.stillT = 0; E.seenT = -99; E.path = null;
  E.memT = 0; E.alert = 0; E.lastSeen = null; E.coverPos = null; E.posture = 'stand'; E.searchPts = null; E.role = undefined;
  E.spotT = 0; E.lostT = 0; E.burstLeft = 0; E.invPos = null; E.invT = 0; E.pauseT = 0;
  if (!E.active && E.obj) { scene.remove(E.obj); E.obj = null; E.mixer = null; E.actions = {}; E.current = null; }
  else if (E.active && !E.obj && enemyFactory) enemyFactory(E);
  E.pos.copy(E.home || E.waypoints[0]);
  if (E.obj) { E.obj.position.copy(E.pos); E.obj.visible = true; }
  Object.values(E.actions).forEach(a => a.stop());
  E.current = null;
  enemySetAnim(E, E_ANIM.walk);
}
let enemyFactory = null;   // set inside load(): builds a materialised enemy
let LOADP = null;          // loading progress callback (set by load())
function updateCompass() {
  const im = document.getElementById('compassImg');
  if (!im) return;
  const yaw = (typeof camYaw !== 'undefined') ? camYaw : player.yaw;
  im.style.transform = 'rotate(' + (-yaw * 57.29578).toFixed(1) + 'deg)';
}
const UICLICK = new Audio('sounds/ui/click.wav');
function uiClick() { try { UICLICK.currentTime = 0; UICLICK.play().catch(() => {}); } catch (e) { /* audio is decoration */ } }
async function runJobs(items, fn, conc = 4) {
  let i = 0;
  const work = async () => { while (i < items.length) { const it = items[i++]; await fn(it); } };
  await Promise.all(Array.from({ length: Math.min(conc, items.length) }, work));
}
let _loadBeat = null;
function startLoadHeartbeat() {
  const t0 = performance.now();
  const beat = () => {
    const st = document.getElementById('stats');
    if (!st) return;
    st.dataset.base = st.dataset.base || st.textContent;
    st.textContent = st.dataset.base + '  ·  ' + Math.round((performance.now() - t0) / 1000) + 's';
  };
  _loadBeat = setInterval(beat, 500);
}
function loadNote(label) { const st = document.getElementById('stats'); if (st) { st.dataset.base = label; st.textContent = label; } }
function loadStep(pct, label) {
  const f = document.getElementById('loadfill'), p = document.getElementById('loadpct');
  if (f) f.style.width = pct + '%';
  if (p) p.textContent = Math.round(pct) + '%';
  if (label) loadNote(label);
}
const ENEMY_ACTIVATE_DIST = 160;
function updateEnemyActivation() {
  if (!enemyFactory) return;
  for (const E of enemies) {
    if (E.obj || !E.alive) continue;
    if (player.pos.distanceToSquared(E.pos) < ENEMY_ACTIVATE_DIST * ENEMY_ACTIVATE_DIST) enemyFactory(E);
  }
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
const ABU_NAMES = ['ABU HAMZA', 'ABU YOUSSEF', 'ABU OMAR', 'ABU KHALED', 'ABU SALEM',
  'ABU NASSER', 'ABU FARID', 'ABU ZIAD', 'ABU HASSAN', 'ABU MAHMOUD',
  'ABU TAREK', 'ABU WALID', 'ABU SAMIR', 'ABU RAFIK', 'ABU AZIZ'];
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
  E.abu = ABU_NAMES[typeIdx % ABU_NAMES.length];
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
    c.traverse(m => { if (m.isMesh) m.castShadow = !SET.lowGfx; });
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
  { name: 'CHERIF', model: 'models/play/Hero02_Ramirez.glb', tex: 'textures/Hero02_DZ_01.png?v=9', slot: [-1.3, -1.6] },
  { name: 'BOUDIAF', model: 'models/play/Hero03_Jones.glb', tex: 'textures/Hero03_DZ_01.png?v=3', slot: [1.3, -1.6] },
  { name: 'ZIANI', model: 'models/play/Hero04_Foley.glb', tex: 'textures/Hero04_DZ_01.png?v=3', slot: [0, -3.2] },
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

function hurtEnemy(E, dmg, head) {
  E.suppressedT = (typeof nowSec === 'number' ? nowSec : 0) + 2.5;
  if (!E.alive) return;
  if (dmg > 0 && E.hp > 0 && Math.random() < 0.10) playEnemyVoice(E, 'pain'); // a wounded man yells — sometimes
  E.hp -= dmg;
  if (dmg > 0 && E.hp > 0) {
    // shot at — even unseen, he turns to the fight and hunts the firing point
    // (alert stays clear: when he truly sees you, the contact shout still comes)
    E.lastSeen = player.pos.clone(); E.memT = Math.max(E.memT || 0, 20);
    if (E.state === 'patrol' || E.state === 'return' || E.state === 'investigate') { E.state = 'search'; makeSearch(E); }
  }
  if (E.hp <= 0) {
    E.alive = false;
    if (Math.random() < 0.45) playEnemyVoice(E, 'death');
    kills++;
    setCanvas('killsCv', GF.text('HOSTILES DOWN ' + kills, { size: 'S', color: '#e8a09a', scale: 1.5 }));
    enemySetAnim(E, head && E.actions['UPRIGHT_HEADSHOT'] ? 'UPRIGHT_HEADSHOT' : (Math.random() < 0.5 ? E_ANIM.deathF : E_ANIM.deathB), true);
    if (Math.random() < 0.4) playVoice('enemy_killed', 0.45);
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
  if (old.obj) old.obj.visible = true;   // in case he was hidden in the binocular eyes-view
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
let _spaceT = 0;
let kills = 0, missionDone = false;
const projectiles = [], rockets = [], smokes = [];
let migObj = null, migPos = new THREE.Vector3(-146.8, 0, -495.6), objMarker = null;
let prisonPos = new THREE.Vector3(-64, 0, -596), c4Pos = new THREE.Vector3(-232, 0, -458),
    bridgePos = new THREE.Vector3(-237.6, 0, -449.4);
function computeMissionPoints() {
  if (!IS_M1) return;
  const wp = ((ENV && ENV.waypoints) || []).filter(w => (w.name || '').includes('PRISON'));
  if (wp.length) prisonPos.set(wp.reduce((s, w) => s + w.pos[0], 0) / wp.length, 0,
                               wp.reduce((s, w) => s + w.pos[2], 0) / wp.length);
  if (PROPS && PROPS.Foley) prisonPos.set(PROPS.Foley[0], 0, PROPS.Foley[2]);
  c4Pos = trigPos('C4', c4Pos);
  bridgePos = trigPos('BRIDGE_BOOM_GROUND', bridgePos);
  migPos = trigPos('PROXTRIG_MIG', migPos);
  gateSwitchPos = trigPos('MAIN_GATE_SWITCH', gateSwitchPos);
}
const OBJ = [];
let objIdx = 0;

function makeInv(i) {
  return BD.LOADOUTS[i].map(s => {
    const o = { kind: s.kind, key: s.key, left: s.count !== undefined ? s.count : -1 };
    if (s.kind === 'gun') {
      const def = BD.WEAPONS[s.key];
      o.ammo = def.mag * (s.count || 1);
      // finite ammunition (OG rules): reloads draw from this reserve pool
      o.reserve = def.rocket ? Math.max(0, (s.count || 1) - 1) : def.mag * (def.mag >= 50 ? 3 : 6);
    }
    return o;
  }).filter(s => !(IS_M1 && s.key === 'C4'));   // M1: nobody carries C4 — it is recovered on the ground (objective 2)
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
  player.reloading = false; player.burstN = 0; player.semiLatch = false;
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
        m.castShadow = !SET.lowGfx;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        mats.forEach(mt => { if (mt.color) { mt = mt.clone(); mt.color.set(0x9aa183); m.material = mt; } });
      }
    });
    conn.add(c);
  }
}

function throwGrenade(kind) {
  setAnim('anim_10FF6EC2', true); player.actT = 0.6;   // overarm throw (recovered library clip)
  const tpl = modelCache[BD.ITEMS[kind].model];
  if (!tpl) return;
  const o = tpl.clone(true);
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
  o.position.copy(player.pos); o.position.y += 1.5;
  scene.add(o);
  projectiles.push({ obj: o, vel: dir.multiplyScalar(13).add(new THREE.Vector3(0, 4.5, 0)), kind, t: 1.5 });
}
function spawnSmoke(pos, scale = 7, life = 10, yOff = 1.6) {
  if (!spawnSmoke.tex) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 4, 64, 64, 62);
    g.addColorStop(0, 'rgba(200,200,195,0.85)'); g.addColorStop(1, 'rgba(200,200,195,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    spawnSmoke.tex = new THREE.CanvasTexture(c);
  }
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: spawnSmoke.tex, transparent: true, opacity: 0.75, depthWrite: false }));
  sp.position.copy(pos); sp.position.y += yOff; sp.scale.setScalar(scale);
  scene.add(sp);
  smokes.push({ pos: pos.clone(), t: life, obj: sp });
}
let AC = null;
function boomNoise() {
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === 'suspended') AC.resume();
    const t = AC.currentTime, len = Math.floor(AC.sampleRate * 0.45);
    const buf = AC.createBuffer(1, len, AC.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
    const s = AC.createBufferSource(); s.buffer = buf;
    const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380;
    const g = AC.createGain(); g.gain.setValueAtTime(0.55 * SET.vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    s.connect(f); f.connect(g); g.connect(AC.destination); s.start();
  } catch (e) { /* audio unavailable */ }
}
const fireballs = [];
function spawnFireball(pos, scale) {
  if (!fireballs.length) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 2, 64, 64, 62);
    g.addColorStop(0, 'rgba(255,244,205,1)'); g.addColorStop(0.35, 'rgba(255,166,64,0.92)');
    g.addColorStop(0.7, 'rgba(216,84,22,0.45)'); g.addColorStop(1, 'rgba(110,30,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    for (let i = 0; i < 8; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      sp.visible = false; scene.add(sp); fireballs.push({ sp, t: 0, life: 0.5, s0: 1 });
    }
  }
  const F = fireballs.find(f => f.t <= 0) || fireballs[0];
  F.sp.position.copy(pos); F.sp.position.y += 0.7;
  F.s0 = scale; F.t = F.life; F.sp.visible = true; F.sp.material.opacity = 1; F.sp.scale.setScalar(scale * 0.35);
}
let lastBoomAt = 0, shakeAmp = 0;
function explode(pos, r, dmg) {
  raiseAlert(pos, 48);
  lastBoomAt = performance.now() / 1000;
  boomNoise();
  spawnFireball(pos, r * 1.6);                       // the visible fireball the blasts were missing
  spawnSmoke(pos, r * 1.15, 6, 1.1); spawnSmoke(pos, r * 0.85, 8.5, 2.3); // dust/smoke column
  flash.position.copy(pos); flash.position.y += 1; flash.intensity = 300; flashT = 0.16;
  impact.position.copy(pos); impact.visible = true; impactT = 0.3; impact.scale.setScalar(r);
  const boomA = boomAudio[(Math.random() * boomAudio.length) | 0]; // the game's own explosion recording
  const bd = camera.position.distanceTo(pos);
  if (boomA) { try { boomA.volume = Math.max(0.06, Math.min(1, 1.5 - bd / 95)) * (SET.vol || 1); boomA.currentTime = 0; boomA.play().catch(() => {}); } catch (e) {} }
  if (bd < 30) shakeAmp = Math.max(shakeAmp, 0.16 + 0.5 * (1 - bd / 30));
  for (const E of enemies) {
    if (!E.alive) continue;
    const d = E.pos.distanceTo(pos);
    if (d < r + 1) hurtEnemy(E, dmg * Math.max(0.15, 1 - d / (r + 2)));
  }
  if (armor && armor.alive && armor.obj.position.distanceTo(pos) < 6.5) damageArmor(340);
  const pd = player.pos.distanceTo(pos);
  if (pd < r * 0.7) { playerHP -= 26 * (1 - pd / (r * 0.7)); dmgT = 0.5; if (playerHP <= 0) die('BLAST'); }
  if (objIdx === 2 && bridgePos.distanceTo(pos) < 18) completeMig();
}
function die(cause) {
  playerHP = 0;
  if (missionDone || !playing) return;
  playing = false; firing = false; aiming = false;
  if (actions && actions['DEATH_BY_SHOTGUN_BACKWARD']) setAnim('DEATH_BY_SHOTGUN_BACKWARD', true);
  const k = document.getElementById('kia');
  const kn = document.getElementById('kiaName');
  if (kn) kn.textContent = (members[activeIdx] ? members[activeIdx].name : 'BENALI') + ' — K.I.A.';
  const kc = document.getElementById('kiaCause');
  if (kc) kc.textContent = cause || '';
  if (k) k.style.display = 'flex';
  document.exitPointerLock?.();
  updateHUD();
}
function hurtPlayerFall(dmg) {
  if (dmg <= 0) return;
  playerHP -= dmg; dmgT = 0.55; boomNoise();
  if (playerHP <= 0) die('FATAL FALL');
  updateHUD();
}
function fireRocket() {
  const o = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.95), new THREE.MeshBasicMaterial({ color: 0xffe2ae }));
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
  o.position.copy(player.pos); o.position.y += 1.45;
  o.lookAt(o.position.clone().add(dir));
  scene.add(o);
  rockets.push({ obj: o, vel: dir.multiplyScalar(46), t: 4, trail: 0 });
  muzzlePuff(o.position.clone(), true);   // launcher blast (the game's own M15ShotA flame)
  camPitch = Math.min(1.12, camPitch + 0.05);   // the tube kicks up
  spawnSmoke(player.pos.clone().add(new THREE.Vector3(-Math.sin(player.yaw) * 1.3, 1.35, -Math.cos(player.yaw) * 1.3)), 2.4, 0.8, 0);   // backblast
}
function tryPlantC4() {
  const M = members[activeIdx];
  const s = M && M.inv ? M.inv.find(s2 => s2.key === 'C4' && (s2.left === undefined || s2.left > 0)) : null;
  if (!s) { const other = members.find((Mt, i) => i !== activeIdx && Mt.inv && Mt.inv.some(s2 => s2.key === 'C4' && (s2.left === undefined || s2.left > 0)));
    showMsg('NO C4 ON YOU', other ? other.name + ' IS CARRYING THE C4 — SWITCH TO HIM (PGUP / PGDN)' : 'RECOVER THE C4 CHARGES FIRST'); return; }
  if (!IS_M1) { showMsg('NO TARGET FOR C4', 'NO DEMOLITION TARGET IN THIS MISSION'); return; }
  if (objIdx === 0) { showMsg('NO TARGET FOR C4', 'RESCUE ZIANI FIRST'); return; }
  if (objIdx === 1) { showMsg('NO TARGET FOR C4', 'RECOVER THE C4 CHARGES FIRST'); return; }
  if (objIdx !== 2) { showMsg('NO TARGET FOR C4', 'THE C4 IS ALREADY PLANTED'); return; }
  if (dist2D(player.pos, bridgePos) > 8) { showMsg('GET TO THE BRIDGE TO PLANT THE C4'); return; }
  if (s.left !== undefined && s.left > 0) s.left--;
  buildItemBar();
  showMsg('PLANTING C4…');
  setAnim('KNEELING_PLANT_C4', true); player.actT = 2.5;   // kneels and plants the charge
  pendingC4 = 2.5;
}
function useItem(slot, now) {
  if (now < throwCd) return;
  if (slot.key === 'MEDIKIT') {
    if (slot.left <= 0) { playClick(); return; }
    if (pendingHeal > 0) return;   // already dressing a wound
    if (playerHP >= 100) { showMsg('HEALTH FULL'); return; }
    slot.left--; throwCd = now + 1.4; pendingHeal = 1.2;
    setAnim('anim_85ABBE9A', true); player.actT = 1.3;   // dressing the wound, one hand on the kit
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

// ---- team mechanics: medi-kit a mate, hand kit over (the game's squad rules) ----
function invSay(t) { const h = document.getElementById('invHint'); if (h) h.textContent = t; }
function tryHeal() {
  const M = members[activeIdx];
  if (!M || !M.inv) return;
  const idx = M.inv.findIndex(s => s.key === 'MEDIKIT' && s.left > 0);
  if (idx < 0) { showMsg('NO MEDI KIT', 'MEDI KITS LIVE IN THE INVENTORY — SPACE'); return; }
  let best = null, bd = 3.6;
  members.forEach((Mt, i) => {
    if (i === activeIdx || Mt.absent || Mt.prisoner || !Mt.obj) return;
    const d = Mt.pos.distanceTo(player.pos);
    if (d < bd && (!Mt.alive || Mt.hp < 100)) { bd = d; best = Mt; }
  });
  if (best) {
    M.inv[idx].left--; throwCd = nowSec + 1.2;
    if (!best.alive) { best.alive = true; best.hp = 45; mateSetAnim(best, ANIM.idle); showMsg('REVIVED', BD.NAMES[members.indexOf(best)] + ' IS BACK ON HIS FEET'); }
    else { best.hp = Math.min(100, best.hp + 55); showMsg('MEDI KIT', BD.NAMES[members.indexOf(best)] + ' PATCHED UP'); }
    buildItemBar(); updateHUD();
    return;
  }
  if (playerHP < 100) { useItem(M.inv[idx], nowSec); return; }
  showMsg('HEALTH FULL', 'NO WOUNDED MAN IN REACH');
}
function giveItem(ti, si) {
  const A = members[activeIdx], B = members[ti];
  if (!A || !B || !A.inv || !B.inv || ti === activeIdx) return;
  if (B.absent || B.prisoner || !B.alive) { invSay(BD.NAMES[ti] + ' IS NOT WITH THE SQUAD — NOTHING HANDED OVER.'); return; }
  if (B.pos.distanceTo(player.pos) > 30) { invSay('TOO FAR — GET CLOSER TO ' + BD.NAMES[ti] + ' TO HAND KIT OVER.'); return; }
  const s = A.inv[si];
  if (!s) return;
  const def = s.kind === 'gun' ? BD.WEAPONS[s.key] : BD.ITEMS[s.key];
  if (s.kind === 'item') {
    if (s.left <= 0) { invSay('NONE LEFT TO GIVE.'); return; }
    s.left--;
    const ex = B.inv.find(x => x.kind === 'item' && x.key === s.key);
    if (ex) ex.left++; else B.inv.push({ kind: 'item', key: s.key, left: 1 });
  } else {
    A.inv.splice(si, 1);
    B.inv.push({ kind: 'gun', key: s.key, ammo: s.ammo });
    setHeld(Math.min(A.held, A.inv.length - 1));
  }
  giveSel = -1;
  invSay(def.label + ' HANDED TO ' + BD.NAMES[ti] + '.');
  buildItemBar(); renderInv(); updateHUD();
}

// ---- mission objectives (triggers named in Mission1.env) ----
const dist2D = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function trigPos(name, fb) {
  const t = ENV && ENV.triggers.find(t => t.name === name);
  return t ? new THREE.Vector3(t.pos[0], 0, t.pos[2]) : fb;
}
let cloudLayers = [];
function applySky() {
  const sky = (PROPS && PROPS.sky) || {};
  const fogC = sky.fog ? new THREE.Color(sky.fog[0], sky.fog[1], sky.fog[2]) : new THREE.Color(0xc4ad82);
  scene.fog = new THREE.Fog(fogC, 120, 1500); // full-map draw distance
  const cv = document.createElement('canvas'); cv.width = 4; cv.height = 512;
  const g = cv.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#3d6396'); grad.addColorStop(0.45, '#7ba0c4');
  grad.addColorStop(0.75, '#b9c9d4'); grad.addColorStop(0.92, '#' + fogC.getHexString()); grad.addColorStop(1, '#' + fogC.getHexString());
  g.fillStyle = grad; g.fillRect(0, 0, 4, 512);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1420, 32, 16),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false }));
  dome.name = 'SKYDOME';
  scene.add(dome);
  scene.background = null;
  cloudLayers = [];
  const tl = new THREE.TextureLoader();
  [['textures/sky/cloud_soft.png', 5, 172, 0.5], ['textures/sky/cloud.png', 10, 158, 0.34]].forEach(([url, tile, h, op]) => {
    tl.load(url, t => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(tile, tile); t.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.Mesh(new THREE.CircleGeometry(1380, 40),
        new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: op, depthWrite: false, fog: false }));
      m.rotation.x = -Math.PI / 2; m.position.y = h;
      scene.add(m); cloudLayers.push(m);
    });
  });
  if (sky.sunDif) sun.color.setRGB(sky.sunDif[0], sky.sunDif[1], sky.sunDif[2]);
  if (sky.sunAmb) scene.traverse(o => { if (o.isHemisphereLight) o.color.setRGB(sky.sunAmb[0], sky.sunAmb[1], sky.sunAmb[2]); });
}

// world pickups (medkits / C4 / ammo / heavy weapons) are NOT baked scenery:
// they sit on the ground and E takes them, like the original
const pickups = [], pickupSpawns = [];
let armor = null, armorSpawn = null;
let gateObj = null, gateL = null, gateR = null, gateT = 1, gateTarget = 1, gateSpawn = null, gateSceneSrc = null, gateBlockSeg = null, gateSwitchPos = null;
function buildGate(srcScene, g) {
  let src = null;
  srcScene.traverse(o => { if (!src && o.isMesh) src = o; });
  const geo = src && src.geometry; if (!geo || !geo.index) return;
  geo.computeBoundingBox();
  const bb = geo.boundingBox, cxm = (bb.min.x + bb.max.x) / 2;
  const posA = geo.attributes.position, idx = geo.index.array;
  const buckets = { post: [], L: [], R: [] };
  const groups = geo.groups.length ? geo.groups : [{ start: 0, count: idx.length, materialIndex: 0 }];
  const mats = Array.isArray(src.material) ? src.material : [src.material];
  for (const gr of groups) for (let i = gr.start; i < gr.start + gr.count; i += 3) {
    const a = idx[i], b = idx[i + 1], c = idx[i + 2];
    const cx = (posA.getX(a) + posA.getX(b) + posA.getX(c)) / 3;
    const dst = (cx < bb.min.x + 0.55 || cx > bb.max.x - 0.55) ? buckets.post : (cx < cxm ? buckets.L : buckets.R);
    dst.push([a, b, c, gr.materialIndex]);
  }
  const buildPart = (tris, shiftX) => {
    if (!tris.length) return null;
    const ng = new THREE.BufferGeometry();
    for (const name of Object.keys(geo.attributes)) ng.setAttribute(name, geo.attributes[name].clone());
    const nidx = [], nmats = []; let curMat = -1, gstart = 0;
    tris.forEach((t, i) => {
      nidx.push(t[0], t[1], t[2]);
      if (t[3] !== curMat) { if (curMat >= 0) ng.addGroup(gstart, i * 3 - gstart, nmats.length - 1); curMat = t[3]; nmats.push(mats[t[3]] || mats[0]); gstart = i * 3; }
    });
    if (tris.length) ng.addGroup(gstart, tris.length * 3 - gstart, nmats.length - 1);
    ng.setIndex(nidx);
    ng.translate(shiftX, 0, 0);
    const m = new THREE.Mesh(ng, nmats.length > 1 ? nmats : nmats[0]);
    m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
    return m;
  };
  gateObj = new THREE.Group();
  gateObj.position.set(g.x, g.y, g.z); gateObj.rotation.y = g.yaw;
  const post = buildPart(buckets.post, 0); if (post) gateObj.add(post);
  gateL = new THREE.Group(); gateL.position.set(bb.min.x + 0.3, 0, 0);
  const lm = buildPart(buckets.L, -(bb.min.x + 0.3)); if (lm) gateL.add(lm);
  gateR = new THREE.Group(); gateR.position.set(bb.max.x - 0.3, 0, 0);
  const rm = buildPart(buckets.R, -(bb.max.x - 0.3)); if (rm) gateR.add(rm);
  gateObj.add(gateL, gateR);
  scene.add(gateObj);
  const cs = Math.cos(g.yaw), sn = Math.sin(g.yaw);
  for (const lx of [bb.min.x + 0.3, bb.max.x - 0.3]) colliders.push({ x: g.x + lx * cs, z: g.z - lx * sn, r: 0.65, top: g.y + 3.2 });
  gateBlockSeg = { ax: g.x + (bb.min.x + 0.3) * cs, az: g.z - (bb.min.x + 0.3) * sn, bx: g.x + (bb.max.x - 0.3) * cs, bz: g.z - (bb.max.x - 0.3) * sn };
  applyGate();
}
function applyGate() {
  if (!gateL || !gateR) return;
  gateL.rotation.y = -gateT * 1.85;
  gateR.rotation.y = gateT * 1.85;
}
function updateGate(dt) {
  if (!gateObj || gateT === gateTarget) return;
  gateT += THREE.MathUtils.clamp(gateTarget - gateT, -dt * 0.5, dt * 0.5);
  applyGate();
}
function toggleGate() {
  gateTarget = gateTarget > 0.5 ? 0 : 1;
  playClick();
  showMsg(gateTarget ? 'MAIN GATE OPEN' : 'MAIN GATE CLOSED');
}
function gateBlock(x, z) {
  if (!gateBlockSeg || gateT > 0.55) return false;
  const { ax, az, bx, bz } = gateBlockSeg;
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
  let t = L2 ? ((x - ax) * dx + (z - az) * dz) / L2 : 0; t = Math.max(0, Math.min(1, t));
  const px = ax + dx * t - x, pz = az + dz * t - z;
  return (px * px + pz * pz) < 0.64;
}
const PICKUP_RULES = [
  [/^MEDIKIT/, 'medkit', 'MEDI KIT'],
  [/EXPLOSIVE01_C4/, 'c4', 'C4 CHARGE'],
  [/AMMOBOX|AK74_CLIP/, 'ammo', 'AMMUNITION'],
  [/^RPG7/, 'weapon:RPG7', 'RPG-7'],
  [/SNIPER02_PSG1/, 'weapon:PSG1', 'PSG-1'],
];
function pickupRule(m) { for (const r of PICKUP_RULES) if (r[0].test(m)) return r; return null; }
function nearestPickup() {
  let best = null, bd = 2.4;
  for (const p of pickups) { if (p.taken) continue; const d = Math.hypot(p.x - player.pos.x, p.z - player.pos.z); if (d < bd) { bd = d; best = p; } }
  return best;
}
function flashPickup(def, label) {
  const f = document.getElementById('itemFlash'); if (!f) return;
  const img = document.getElementById('itemFlashImg'), tx = document.getElementById('itemFlashTxt');
  if (img && def && def.icon) img.src = BD.ICON(def.icon);
  if (tx) tx.textContent = label || (def && def.label) || '';
  f.classList.remove('show'); void f.offsetWidth; f.classList.add('show');
}
function takePickup(p) {
  p.taken = true; if (p.obj) p.obj.visible = false;
  const M = members[activeIdx]; if (!M || !M.inv) return;
  if (p.type === 'medkit') {
    const s = M.inv.find(s2 => s2.key === 'MEDIKIT'); if (s) s.left += 2;
    flashPickup(BD.ITEMS.MEDIKIT, 'MEDI KIT ×2');
  } else if (p.type === 'ammo') {
    let s = curSlot();
    if (!s || s.kind !== 'gun' || BD.WEAPONS[s.key].rocket || BD.WEAPONS[s.key].melee) s = M.inv.find(s2 => s2.kind === 'gun' && !BD.WEAPONS[s2.key].rocket && !BD.WEAPONS[s2.key].melee);
    if (s) s.reserve = (s.reserve || 0) + 90;
    flashPickup({ icon: 'IMAGE_WEAPON_AMMOPACK' }, 'AMMUNITION +90');
  } else if (p.type === 'c4') {
    const s = M.inv.find(s2 => s2.key === 'C4'); if (s) s.left += 1; else M.inv.push({ kind: 'item', key: 'C4', left: 1 });
    flashPickup(BD.ITEMS.C4, 'C4 CHARGE');
    if (IS_M1 && objIdx === 1) { objIdx = 2; showMsg('C4 RECOVERED', OBJ[2].text); setObjectiveText(); }
    else if (IS_M1 && objIdx === 0) showMsg('C4 RECOVERED', 'RESCUE ZIANI — THEN PLANT IT ON THE BRIDGE');
  } else if (p.type.indexOf('weapon:') === 0) {
    const key = p.type.slice(7), def = BD.WEAPONS[key];
    const s = M.inv.find(s2 => s2.key === key);
    if (s) s.reserve = (s.reserve || 0) + (key === 'RPG7' ? 2 : def.mag);
    else M.inv.push({ kind: 'gun', key, ammo: def.mag, reserve: key === 'RPG7' ? 2 : def.mag * 3, left: -1 });
    flashPickup(def, def.label);
  }
  buildItemBar(); updateHUD();
}
async function buildArmor(sp) {
  try {
    const g = await loader.loadAsync(MISDIR + 'props/' + sp.m + '.glb');
    const o = g.scene;
    const bb = new THREE.Box3().setFromObject(o);
    // the mission data parks it in the gorge; groundY() would find the bridge
    // deck 15 m overhead and float the vehicle on the crossing
    const gy = (() => { const h = groundHitY(sp.x, sp.z, (sp.y || 0) + 0.6); return h !== null ? h : groundY(sp.x, sp.z); })();
    o.position.set(sp.x, gy - bb.min.y, sp.z);
    o.rotation.y = sp.yaw;
    o.traverse(m2 => { if (m2.isMesh) { m2.castShadow = !SET.lowGfx; m2.receiveShadow = true; const ms = Array.isArray(m2.material) ? m2.material : [m2.material]; ms.forEach(mm => { if (mm.color && mm.userData.c0 === undefined) mm.userData.c0 = mm.color.getHex(); }); } });
    scene.add(o);
    const fwd = new THREE.Vector3(Math.sin(sp.yaw), 0, Math.cos(sp.yaw));
    armor = { obj: o, hp: 900, alive: true, yaw: sp.yaw, wait: 2, dir: 1, fireT: 2.5, smokeT: 0,
      a: new THREE.Vector3(sp.x, 0, sp.z).addScaledVector(fwd, -17),
      b: new THREE.Vector3(sp.x, 0, sp.z).addScaledVector(fwd, 17),
      col: { x: sp.x, z: sp.z, r: 3.1, top: gy + 3.4 }, turret: null };
    o.traverse(m2 => { if (/turret/i.test(m2.name || '') && !armor.turret) armor.turret = m2; });
    colliders.push(armor.col);
  } catch (e) { console.warn('armor failed', e); }
}
function damageArmor(d) {
  if (!armor || !armor.alive) return;
  armor.hp -= d;
  if (armor.hp > 0) return;
  armor.alive = false;
  armor.obj.traverse(m2 => { if (m2.isMesh) { const ms = Array.isArray(m2.material) ? m2.material : [m2.material]; ms.forEach(mm => { if (mm.color) mm.color.multiplyScalar(0.32); }); } });
  flash.position.copy(armor.obj.position); flash.position.y += 2; flash.intensity = 220; flashT = 0.2;
  boomNoise();
  showMsg('ARMOUR DESTROYED', 'THE WAY PAST THE BRIDGE IS CLEAR');
}
function updateArmor(dt, now) {
  if (!armor || !armor.obj) return;
  const o = armor.obj;
  if (armor.col) { armor.col.x = o.position.x; armor.col.z = o.position.z; armor.col.top = o.position.y + 3.4; }
  if (!armor.alive) {
    armor.smokeT -= dt;
    if (armor.smokeT <= 0) { armor.smokeT = 0.14; spawnSmoke(o.position.clone(), 2.6, 1.6, 2.4); }
    return;
  }
  const tgt = armor.dir > 0 ? armor.b : armor.a;
  const to = new THREE.Vector3(tgt.x - o.position.x, 0, tgt.z - o.position.z);
  if (armor.wait > 0) armor.wait -= dt;
  else if (to.length() < 1.4) { armor.dir *= -1; armor.wait = 3.5; }
  else {
    to.normalize();
    const want = Math.atan2(to.x, to.z);
    let dy = want - armor.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
    armor.yaw += THREE.MathUtils.clamp(dy, -dt * 0.7, dt * 0.7);
    o.position.x += Math.sin(armor.yaw) * 2.0 * dt;
    o.position.z += Math.cos(armor.yaw) * 2.0 * dt;
    const gy = groundHitCached(o.position.x, o.position.z, o.position.y + 1);
    if (gy !== null) o.position.y += (gy - o.position.y) * Math.min(1, dt * 5);
    o.rotation.y = armor.yaw;
  }
  const d = o.position.distanceTo(player.pos);
  if (armor.turret) {
    const want = Math.atan2(player.pos.x - o.position.x, player.pos.z - o.position.z) - armor.yaw;
    let dy = ((want + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    armor.turret.rotation.y += THREE.MathUtils.clamp(dy, -dt * 0.8, dt * 0.8);
  }
  armor.fireT -= dt;
  if (playing && d < 75 && armor.fireT <= 0) {
    armor.fireT = 3.1;
    const from = new THREE.Vector3(o.position.x, o.position.y + 2.8, o.position.z);
    const dir = new THREE.Vector3().subVectors(new THREE.Vector3(player.pos.x, player.pos.y + 1.1, player.pos.z), from);
    raycaster.set(from, dir.clone().normalize()); raycaster.far = d;
    const blocked = raycaster.intersectObjects(_groundMeshes, false).length > 0;
    if (!blocked) {
      flash.position.copy(from); flash.intensity = 170; flashT = 0.09;
      boomNoise();
      setTimeout(() => {
        if (!playing || playerHP <= 0) return;
        const p = Math.max(0.1, 0.55 - d * 0.005);
        if (Math.random() < p) { playerHP -= 14; dmgT = 0.5; if (playerHP <= 0) die('ARMOUR CANNON'); updateHUD(); }
      }, 380);
    }
  }
}
// the checkpoint banner: a black GIA-style flag on the game's own flag pole
const banners = [];
let _flagTex = null;
function makeFlagTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 160;
  const x = c.getContext('2d');
  x.fillStyle = '#0b0b0b'; x.fillRect(0, 0, 256, 160);
  x.strokeStyle = '#ded9cc'; x.lineWidth = 3; x.strokeRect(7, 7, 242, 146);
  x.fillStyle = '#f2eee2'; x.textAlign = 'center';
  x.font = '700 33px serif'; x.fillText('لا إله إلا الله', 128, 64);
  x.font = '700 20px serif'; x.fillText('محمد رسول الله', 128, 97);
  x.fillRect(46, 120, 148, 4);
  x.beginPath(); x.moveTo(194, 116); x.lineTo(214, 122); x.lineTo(194, 128); x.fill();
  x.fillRect(38, 117, 8, 11);
  const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
}
function buildFlagBanners() {
  const sc = PROPS && PROPS.scenes && PROPS.scenes.FLAGPOLE;
  if (!sc) return;
  if (!_flagTex) _flagTex = makeFlagTexture();
  const geo = new THREE.PlaneGeometry(1.7, 1.05); geo.translate(0.87, 0, 0);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: _flagTex, side: THREE.DoubleSide, roughness: 0.92 }));
  m.position.set(sc.p[0], sc.p[1] + 6.1, sc.p[2]);
  scene.add(m); banners.push(m);
}

// every placed object in Mission1.env, baked to merged static geometry
async function buildStaticWorld() {
  if (!PROPS) return;
  const cache = {};
  const models = [...new Set(PROPS.statics.map(s => s.m))];
  let propsDone = 0;
  await runJobs(models, async m => {
    try { const sc = (await loader.loadAsync(MISDIR + 'props/' + m + '.glb')).scene; sc.updateMatrixWorld(true); cache[m] = sc; }
    catch (e) { console.warn('prop failed:', m); }
    propsDone++;
    if (LOADP) LOADP(72 + 10 * propsDone / Math.max(1, models.length), 'Placing the base — ' + m + '…');
  }, 4);
  const groups = new Map();
  const info = {};   // per-model bounds -> collider size
  for (const m of models) {
    const sc = cache[m]; if (!sc) continue;
    const bb = new THREE.Box3().setFromObject(sc);
    const sz = new THREE.Vector3(), ce = new THREE.Vector3();
    bb.getSize(sz); bb.getCenter(ce);
    info[m] = { sz, ce };
  }
  const NO_COL = /^(MIS1_BIG_BRIDGE|M1_ZONE2_CHAIN|DOOR|GOAT|AK74_CLIP|DYN_CUP|MEDIKIT|COOLERKEYS|DETONATOR|EXPLOSIVE01|TABLE)/;
  const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), EU = new THREE.Euler(), ONE = new THREE.Vector3(1, 1, 1), PV = new THREE.Vector3();
  for (const s of PROPS.statics) {
    const sc = cache[s.m]; if (!sc) continue;
    if (/^(MIG29|A10)/.test(s.m)) continue;   // aircraft fly (A-10 passes, the captured MiG is its own objective model) — never bake one frozen into the sky
    if (s.m === 'MISSION1GATE') { gateSpawn = { x: s.p[0], z: s.p[1], y: s.y, yaw: s.yaw || 0 }; gateSceneSrc = sc; continue; }   // the main gate is a working door, not scenery
    const pr = pickupRule(s.m);
    if (pr) { pickupSpawns.push({ m: s.m, x: s.p[0], z: s.p[1], type: pr[1], label: pr[2] }); continue; }
    if (/^(BMP2|T72|T62)/.test(s.m) && !armorSpawn) { armorSpawn = { m: s.m, x: s.p[0], z: s.p[1], y: s.y || 0, yaw: s.yaw || 0 }; continue; }
    let sy = s.y, vx = 0, vz = 0;
    if (/TRUCK|URAL|JEEP|TANK|APC|BMP|T72/.test(s.m)) {
      // vehicles sit on all their wheels: sample the ground at the footprint
      // corners and pitch/roll the body onto the slope (no more floating axles)
      const inf0 = info[s.m];
      if (inf0) {
        const fx = Math.sin(s.yaw || 0), fz = Math.cos(s.yaw || 0), rx = fz, rz = -fx;
        const hl = Math.max(1.2, inf0.sz.z * 0.36), hw = Math.max(0.9, inf0.sz.x * 0.36);
        const gh = (ox, oz) => { const h = groundHitY(s.p[0] + ox, s.p[1] + oz, s.y + 2.5); return h === null ? groundYCached(s.p[0] + ox, s.p[1] + oz) : h; };
        const hFL = gh(fx * hl + rx * hw, fz * hl + rz * hw), hFR = gh(fx * hl - rx * hw, fz * hl - rz * hw);
        const hBL = gh(-fx * hl + rx * hw, -fz * hl + rz * hw), hBR = gh(-fx * hl - rx * hw, -fz * hl - rz * hw);
        sy += THREE.MathUtils.clamp((hFL + hFR + hBL + hBR) / 4 - (s.y + inf0.ce.y - inf0.sz.y / 2), -3, 6);
        vx = THREE.MathUtils.clamp(Math.atan2(((hBL + hBR) - (hFL + hFR)) / 2, hl * 2), -0.3, 0.3);
        vz = THREE.MathUtils.clamp(Math.atan2(((hFR + hBR) - (hFL + hBL)) / 2, hw * 2), -0.3, 0.3);
      }
    }
    M4.compose(PV.set(s.p[0], sy, s.p[1]), Q.setFromEuler(EU.set(vx, s.yaw || 0, vz, 'YXZ')), ONE);
    sc.traverse(o => {
      if (!o.isMesh) return;
      o.material.side = THREE.DoubleSide;   // solid from every angle, no void
      const geo = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(M4, o.matrixWorld));
      geo.morphAttributes = {}; geo.morphTargetsRelative = false;   // merge hygiene (some zone props carry morphs)
      for (const a of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(a)) geo.deleteAttribute(a);
      const key = o.material.uuid + '|' + Object.keys(geo.attributes).sort().join(',');
      if (!groups.has(key)) groups.set(key, { mat: o.material, geos: [] });
      groups.get(key).geos.push(geo);
    });
    const inf = info[s.m];
    if (inf && !NO_COL.test(s.m)) {
      const r = Math.min(Math.max(inf.sz.x, inf.sz.z) / 2 * 0.85, 2.8);
      if (r >= 0.5) colliders.push({ x: s.p[0] + inf.ce.x, z: s.p[1] + inf.ce.z, r, top: sy + inf.ce.y + inf.sz.y / 2 });
    }
  }
  for (const grp of groups.values()) {
    let merged = null;
    try { merged = grp.geos.length === 1 ? grp.geos[0] : mergeGeometries(grp.geos, false); } catch (e) { merged = null; }
    for (const pgeo of (merged ? [merged] : grp.geos)) {
      const mesh = new THREE.Mesh(pgeo, grp.mat);
      mesh.receiveShadow = !SET.lowGfx;
      mesh.frustumCulled = false;
      world.add(mesh); _groundMeshes.push(mesh);
    }
  }
  if (gateSpawn && gateSceneSrc) buildGate(gateSceneSrc, gateSpawn);
  // building interiors (hut/garage/guardhouse scenes at their env roots)
  for (const it of (PROPS.interiors || [])) {
    try {
      const g = await loader.loadAsync(MISDIR + 'props/' + it.m + '.glb');
      g.scene.position.set(it.p[0], it.p[1], it.p[2]);
      g.scene.traverse(o => { if (o.isMesh) { o.receiveShadow = !SET.lowGfx; o.frustumCulled = false; o.material.side = THREE.DoubleSide; _groundMeshes.push(o); } });
      world.add(g.scene);
    } catch (e) { console.warn('interior failed:', it.m); }
  }
  // cutout materials (chain-link, camo netting, barbed wire): true alpha-tested
  // cutouts — not the dotted semi-transparent sorting shimmer
  world.traverse(o => {
    if (!o.isMesh) return;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    ms.forEach(m2 => { if (m2 && m2.transparent && m2.map) { m2.alphaTest = 0.42; m2.transparent = false; m2.side = THREE.DoubleSide; m2.needsUpdate = true; } });
  });
  // ground apron under the whole map: no blue void past the terrain edge
  if (worldBox) {
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(worldBox.max.x - worldBox.min.x + 700, worldBox.max.z - worldBox.min.z + 700),
      new THREE.MeshStandardMaterial({ color: 0xb59a6a, roughness: 1 }));
    apron.rotation.x = -Math.PI / 2;
    apron.position.set((worldBox.min.x + worldBox.max.x) / 2, worldBox.min.y - 1.5, (worldBox.min.z + worldBox.max.z) / 2);
    apron.receiveShadow = true;
    scene.add(apron);
  }
  // the extraction Black Hawk (env placement), rotor turning
  const hawk = PROPS.vehicles && PROPS.vehicles.hawk && PROPS.vehicles.hawk[0];
  if (hawk) {
    try {
      const g = await loader.loadAsync(MISDIR + 'props/BLACKHAWK_UH60.glb');
      hawkObj = g.scene;
      const lzT = ENV && ENV.triggers ? ENV.triggers.find(t => t.name === 'PICKUP_BLACKHAWK_TRIGGER') : null;
      const hx = lzT ? lzT.pos[0] : hawk.pos[0], hz = lzT ? lzT.pos[2] : hawk.pos[2];
      hawkObj.rotation.y = hawk.yaw || 0;
      hawkObj.position.set(hx, 0, hz);
      const hb = new THREE.Box3().setFromObject(hawkObj);
      hawkObj.position.y = groundY(hx, hz) + 0.05 - hb.min.y;   // skids on the ground
      hawkObj.traverse(o => { if (o.isMesh) { o.castShadow = !SET.lowGfx; if (/rotor|blade/i.test(o.name) && !hawkRotor) hawkRotor = o; } });
      scene.add(hawkObj);
    } catch (e) { console.warn('hawk failed'); }
  }
  try {
    a10Obj = (await loader.loadAsync('models/mission1/props/A10_SMALL.glb')).scene;   // one shared A-10 for every map
    a10Obj.visible = false;
    a10Obj.scale.setScalar(1.7);
    a10Obj.traverse(o => { if (o.isMesh) { o.frustumCulled = false; const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(mm => { mm.metalness = 0; mm.roughness = 0.85; if (!mm.map && mm.color) mm.color.set(0x9aa3a8); }); } });
    scene.add(a10Obj);
  } catch (e) { /* no jet */ }
  // interactive pickups, set on the ground where the env placed them
  for (const ps of pickupSpawns) {
    const tpl = cache[ps.m]; if (!tpl) continue;
    const o = tpl.clone(true);
    const bb = new THREE.Box3().setFromObject(o);
    o.position.set(ps.x, groundY(ps.x, ps.z) - bb.min.y + 0.03, ps.z);
    o.traverse(m2 => { if (m2.isMesh) { m2.castShadow = false; m2.receiveShadow = true; } });
    world.add(o);
    pickups.push({ obj: o, x: ps.x, z: ps.z, type: ps.type, label: ps.label, taken: false });
  }
  if (armorSpawn) await buildArmor(armorSpawn);
  buildFlagBanners();
}

function buildObjectives() {
  OBJ.length = 0;
  computeMissionPoints();
  if (IS_M1) {
    OBJ.push({ text: 'RESCUE ZIANI — HELD N.E. OF THE BRIDGE', pos: prisonPos, r: 6 });
    OBJ.push({ text: 'RECOVER THE C4 EXPLOSIVES', pos: c4Pos, r: 6 });
    OBJ.push({ text: 'PLANT THE C4 — DESTROY THE BRIDGE', pos: bridgePos, r: 9 });
    OBJ.push({ text: 'EXTRACTION — RETURN TO THE LZ WITH ZIANI', pos: trigPos('PICKUP_BLACKHAWK_TRIGGER', new THREE.Vector3(-113.6, 0, -230.8)), r: 14 });
  } else {
    const lz = trigPos('PICKUP_BLACKHAWK_TRIGGER', null) || trigPos('EXTRACTION', null)
      || new THREE.Vector3(player.pos.x, 0, player.pos.z);
    OBJ.push({ text: 'ELIMINATE ALL HOSTILES', pos: null, r: 0, type: 'clear' });
    OBJ.push({ text: 'EXTRACTION — REACH THE LZ', pos: lz, r: 16 });
  }
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
  if (f1Open) renderF1();
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
function finishMission() {
  missionDone = true; playing = false;
  const st = document.getElementById('stats');
  if (st) st.textContent = 'MISSION COMPLETE — ' + kills + ' hostiles down. Click to redeploy.';
  { const dg = document.getElementById('deployGo'); if (dg) { dg.textContent = '▶ REDEPLOY'; dg.style.display = 'block'; } }
  startEl.style.display = 'flex';
  document.exitPointerLock?.();
}
function completeMig() {
  if (objIdx !== 2) return;
  objIdx = 3;
  spawnSmoke(bridgePos.clone());
  showMsg('BRIDGE DESTROYED', 'FALL BACK TO THE EXTRACTION POINT');
  setObjectiveText(); updateHUD();
}
function restartMission() {
  // full mission reset WITHOUT reloading the page — assets stay in memory,
  // only the state is rebuilt: fresh kit, fresh ammo, everyone back on post
  playerHP = 100; missionDone = false; objIdx = 0; kills = 0; dmgT = 0;
  pendingC4 = 0; pendingHeal = 0; player.vy = 0; player.airborne = false;
  for (const R of rockets) scene.remove(R.obj); rockets.length = 0;
  for (const Pj of projectiles) scene.remove(Pj.obj); projectiles.length = 0;
  for (const Sk of smokes) scene.remove(Sk.obj); smokes.length = 0;
  members.forEach((M, i) => { M.inv = makeInv(i); M.held = 0; M.hp = 100; M.alive = true; });
  if (activeIdx !== 0) switchTo(0);
  resetEnemies(false);
  pickups.forEach(p => { p.taken = false; if (p.obj) p.obj.visible = true; });
  if (armor && armorSpawn) {
    armor.alive = true; armor.hp = 900; armor.fireT = 3; armor.wait = 1; armor.dir = 1; armor.yaw = armorSpawn.yaw;
    armor.obj.position.set(armorSpawn.x, (() => { const h = groundHitY(armorSpawn.x, armorSpawn.z, (armorSpawn.y || 0) + 0.6); return h !== null ? h : groundY(armorSpawn.x, armorSpawn.z); })(), armorSpawn.z);
    armor.obj.rotation.y = armorSpawn.yaw;
    armor.obj.traverse(m2 => { if (m2.isMesh) { const ms = Array.isArray(m2.material) ? m2.material : [m2.material]; ms.forEach(mm => { if (mm.userData.c0 !== undefined) mm.color.setHex(mm.userData.c0); }); } });
  }
  resetSquadToStart();
  setHeld(0);
  const k = document.getElementById('kia'); if (k) k.style.display = 'none';
  try { setCanvas('killsCv', GF.text('HOSTILES DOWN 0', { size: 'S', color: '#e8a09a', scale: 1.5 })); } catch (e) { /* decoration */ }
  setObjectiveText(); buildItemBar(); updateHUD();
}
function resetSquadToStart() {
  const sp = ENV && ENV.start ? ENV.start.pos : [-120, 0, -234];
  player.pos.set(sp[0], 0, sp[2]);
  player.pos.y = groundYCached(player.pos.x, player.pos.z);
  { const Z = members[3]; if (Z) Z.prisoner = true; if (IS_M1) { const c3 = document.getElementById('card3'); if (c3) c3.style.display = 'none'; } }
  members.forEach((M, i) => {
    if (M.absent) { M.alive = false; if (M.obj) M.obj.visible = false; return; }
    M.alive = true; M.hp = 100;
    if (M.prisoner) { M.pos.copy(prisonPos); M.pos.y = groundYCached(prisonPos.x, prisonPos.z); if (M.obj) M.obj.position.copy(M.pos); return; }
    if (i !== activeIdx) { M.pos.set(sp[0] + i * 1.6 - 2, player.pos.y, sp[2] + 2 + i); if (M.obj) M.obj.visible = true; }
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
  bar.querySelectorAll('.slot').forEach(el => el.addEventListener('click', () => {
    const i = +el.dataset.i, sl = M.inv[i];
    if (sl && sl.kind === 'item' && sl.key !== 'BINOCULARS') useItem(sl, nowSec);   // click = USE (the game's rule)
    else setHeld(i);
    if (quickInv) setQuickInv(false);
  }));
  bar.style.display = quickInv ? 'flex' : 'none';   // never a permanent bottom bar
}
let invOpen = false;
let f1Open = false;
function renderF1() {
  setCanvas('f1title', GF.text(MISNAME, { size: 'L', color: '#f0d9a0', scale: 1.5 }));
  const box = document.getElementById('f1objs');
  if (box) box.innerHTML = OBJ.map((O, i) => {
    const st = i < objIdx ? ['done', 'COMPLETE'] : i === objIdx ? ['cur', 'CURRENT'] : ['todo', 'PENDING'];
    return `<div class="f1row ${st[0]}"><span class="f1st">${st[1]}</span><span>${i + 1}. ${O.text}</span></div>`;
  }).join('');
  const st = document.getElementById('f1stats');
  if (st) st.textContent = 'HOSTILES DOWN ' + kills + ' OF ' + enemies.length + '   ·   SQUAD: ' + members.map((M, i) =>
    (M.absent ? M.name + ' — NOT ON THIS OP' : M.prisoner ? M.name + ' — CAPTIVE' : !M.alive ? M.name + ' — DOWN'
     : M.name + ' ' + Math.ceil(i === activeIdx ? playerHP : M.hp) + '%')).join('  ·  ');
}
function toggleF1(force) {
  f1Open = force !== undefined ? force : !f1Open;
  const w = document.getElementById('f1win');
  if (w) w.style.display = f1Open ? 'flex' : 'none';
  if (f1Open) renderF1();
}
let giveSel = -1;   // inventory slot picked to hand to a squadmate
function renderInv() {
  if (!invOpen) return;
  const M = members[activeIdx];
  setCanvas('invTitle', GF.text((BD.NAMES[activeIdx] + ' — ' + BD.ROLES[activeIdx] + ' — INVENTORY'), { size: 'L', color: '#f0d9a0', scale: 1.4 }));
  setCanvas('invGearTitle', GF.text('WORN KIT', { size: 'L', color: '#9db38a', scale: 1.1 }));
  const box = document.getElementById('invSlots');
  box.innerHTML = M.inv.map((s, i) => {
    const def = s.kind === 'gun' ? BD.WEAPONS[s.key] : BD.ITEMS[s.key];
    const cnt = s.kind === 'item' ? (s.left > 0 ? '× ' + s.left : 'USED') : (s.key === 'LAW66' ? '× ' + s.ammo : (s.kind === 'gun' && !def.melee ? def.mag + ' RD MAG' : ''));
    return `<div class="slot ${i === M.held ? 'held' : ''} ${i === giveSel ? 'sel' : ''}" data-i="${i}"><img src="${BD.ICON(def.icon)}"><span class="nm">${def.label}</span><span class="cnt">${cnt}</span></div>`;
  }).join('');
  box.querySelectorAll('.slot').forEach(el => {
    el.addEventListener('mouseenter', () => box.querySelectorAll('.slot').forEach(s => s.classList.toggle('hov', s === el)));
    el.addEventListener('click', () => { giveSel = +el.dataset.i; const sv = members[activeIdx].inv[giveSel]; invSay('SELECTED: ' + (sv.kind === 'gun' ? BD.WEAPONS[sv.key] : BD.ITEMS[sv.key]).label + ' — CLICK A SOLDIER ABOVE TO HAND IT OVER · DOUBLE-CLICK TO CARRY IT.'); renderInv(); });
    el.addEventListener('dblclick', () => setHeld(+el.dataset.i));
  });
  const sq = document.getElementById('invSquad');
  if (sq) {
    sq.innerHTML = members.map((Mt, i) => {
      if (Mt.absent || Mt.prisoner) return '';   // not found yet / not on this op: not in your inventory either
      const state = !Mt.alive ? 'DOWN' : Math.ceil(i === activeIdx ? playerHP : Mt.hp) + ' HP';
      const d = i === activeIdx ? 'YOU' : (Mt.absent || Mt.prisoner ? '—' : Math.round(Mt.pos.distanceTo(player.pos)) + ' M AWAY');
      return `<div class="mate${i === activeIdx ? ' self' : ''}" data-i="${i}"><img src="textures/portraits/sq${i + 1}.png?v=2"><div><b>${BD.NAMES[i]}</b><span>${state} · ${d}</span></div></div>`;
    }).join('');
    sq.querySelectorAll('.mate').forEach(el => el.addEventListener('click', () => {
      const ti = +el.dataset.i;
      if (ti === activeIdx) { invSay('THAT IS YOU — PICK A SLOT BELOW, THEN A SQUADMATE.'); return; }
      if (giveSel >= 0) giveItem(ti, giveSel);
      else invSay('PICK AN ITEM SLOT BELOW FIRST, THEN CLICK THE SOLDIER TO HAND IT OVER.');
    }));
  }
  document.getElementById('invGear').textContent = BD.GEAR[activeIdx].map(g => g[2]).join('  ·  ');
}
let quickInv = false;
function setQuickInv(open) {
  quickInv = !!open;
  const bar = document.getElementById('itembar');
  if (bar) bar.style.display = quickInv ? 'flex' : 'none';
  if (quickInv) buildItemBar();
}
function toggleInv(force) {
  invOpen = force !== undefined ? force : !invOpen;
  document.getElementById('inv').style.display = invOpen ? 'flex' : 'none';
  if (invOpen && !members.some((M, i) => i !== activeIdx && !M.absent && !M.prisoner))
    invSay('SOLO FOR NOW — RESCUE ZIANI AND KIT SHARING UNLOCKS WITH THE SQUAD.');
  renderInv();
}

const _sv = new THREE.Vector3();
// ---- wall collision, extracted from the world's own geometry ----
// Zone meshes carry no colliders in the heightfield world (vertical rays only
// see floors/roofs), so men walked straight through building walls. At load we
// harvest every near-vertical, body-height triangle edge into a 2D segment
// grid; characters get pushed out of those segments. Doorways and arches have
// no triangles, so they stay open — exactly like the real map.
const WALLCELL = 4, wallGrid = new Map(); let wallSegCount = 0;
function buildWallSegments() {
  wallGrid.clear(); wallSegCount = 0;
  world.updateMatrixWorld(true);
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  world.traverse(o => {
    if (!o.isMesh || o.userData.noWall) return;
    if ((o.name || '').toUpperCase().includes('GATE')) return;
    const g = o.geometry; if (!g || !g.attributes.position) return;
    const p = g.attributes.position, n = g.attributes.normal, idx = g.index;
    const triCount = idx ? idx.count / 3 : p.count / 3, m = o.matrixWorld;
    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      if (n && Math.abs(n.getY(i0)) > 0.5 && Math.abs(n.getY(i1)) > 0.5 && Math.abs(n.getY(i2)) > 0.5) continue; // floors/roofs — cheap skip
      A.fromBufferAttribute(p, i0).applyMatrix4(m); B.fromBufferAttribute(p, i1).applyMatrix4(m); C.fromBufferAttribute(p, i2).applyMatrix4(m);
      const ux = B.x - A.x, uy = B.y - A.y, uz = B.z - A.z, vx = C.x - A.x, vy = C.y - A.y, vz = C.z - A.z;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const nl = Math.hypot(nx, ny, nz); if (nl < 1e-9) continue;
      if (Math.abs(ny / nl) > 0.45) continue;                       // not wall-ish
      const y0 = Math.min(A.y, B.y, C.y), y1 = Math.max(A.y, B.y, C.y);
      if (y1 - y0 < 0.55) continue;                                  // curbs and trim don't block a man
      let P = null, Q = null, bl = 0.25;
      for (const [P1, Q1] of [[A, B], [B, C], [C, A]]) { const l = Math.hypot(P1.x - Q1.x, P1.z - Q1.z); if (l > bl) { bl = l; P = P1; Q = Q1; } }
      if (!P) continue;
      const seg = [P.x, P.z, Q.x, Q.z, y0, y1];
      const steps = Math.max(1, Math.ceil(bl / (WALLCELL * 0.5))), seen = new Set();
      for (let s2 = 0; s2 <= steps; s2++) {
        const k = Math.floor((seg[0] + (seg[2] - seg[0]) * s2 / steps) / WALLCELL) + ',' + Math.floor((seg[1] + (seg[3] - seg[1]) * s2 / steps) / WALLCELL);
        if (seen.has(k)) continue; seen.add(k);
        if (!wallGrid.has(k)) wallGrid.set(k, []);
        wallGrid.get(k).push(seg);
      }
      wallSegCount++;
    }
  });
  console.log('wall segments:', wallSegCount);
}
function wallPush(P, feetY, r) {
  if (!wallSegCount) return;
  const cx = Math.floor(P.x / WALLCELL), cz = Math.floor(P.z / WALLCELL);
  for (let ix = cx - 1; ix <= cx + 1; ix++) for (let iz = cz - 1; iz <= cz + 1; iz++) {
    const cell = wallGrid.get(ix + ',' + iz); if (!cell) continue;
    for (const s2 of cell) {
      // only a face that rises at least to the knee from where you stand is a
      // wall; the side of a ledge you're on top of must never push you back
      if (s2[5] <= feetY + 0.55 || s2[4] >= feetY + 1.5) continue;
      const dx = s2[2] - s2[0], dz = s2[3] - s2[1], L2 = dx * dx + dz * dz;
      if (L2 < 1e-8) continue;
      let t = ((P.x - s2[0]) * dx + (P.z - s2[1]) * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = s2[0] + dx * t, qz = s2[1] + dz * t;
      let px = P.x - qx, pz = P.z - qz;
      const d2 = px * px + pz * pz;
      if (d2 >= r * r) continue;
      if (d2 < 1e-10) { const il = 1 / Math.sqrt(L2); P.x = qx - dz * il * r; P.z = qz + dx * il * r; continue; }
      const push = (r - Math.sqrt(d2)) / Math.sqrt(d2);
      P.x += px * push; P.z += pz * push;
    }
  }
}
let mateAlt = 0;
function playMateShot(M) {
  raiseAlert(M.pos, 26);
  const a = M.wpn.snd[M.wpn.alt++ % 2];
  a.volume = THREE.MathUtils.clamp(1.1 - M.pos.distanceTo(player.pos) / 38, 0.08, 0.55) * SET.vol;
  a.currentTime = 0;
  a.play().catch(() => {});
}
const _tv = new THREE.Vector3();
function updateMate(M, dt, now) {
  if (!M.alive || !M.obj) return;
  if (M.prisoner) return;   // ZIANI waits at the prison until rescued
  M.stance = player.stance; // orders: the squad mirrors the stance of the man you're playing
  // field aid: a mate with a medi kit patches up a badly hurt man next to him
  M._aidCd = (M._aidCd || 0) - dt;
  if (M._aidCd <= 0 && M.inv) {
    const kit = M.inv.find(s => s.key === 'MEDIKIT' && s.left > 0);
    if (kit) {
      let tgt = -1;
      members.forEach((Mt, i) => {
        if (Mt.absent || Mt.prisoner || !Mt.alive) return;
        const hp = i === activeIdx ? playerHP : Mt.hp;
        const mp = i === activeIdx ? player.pos : Mt.pos;
        if (hp < 45 && M.pos.distanceTo(mp) < 3.2) tgt = i;
      });
      if (tgt < 0 && M.hp < 45) tgt = members.indexOf(M);
      if (tgt >= 0) {
        kit.left--; M._aidCd = 6;
        if (tgt === activeIdx) playerHP = Math.min(100, playerHP + 50);
        else members[tgt].hp = Math.min(100, members[tgt].hp + 50);
        updateHUD();
      }
    }
  }
  // nearest enemy he can actually SEE, out to his weapon's real reach.
  // (the old code keyed its LOS cache by E.id — enemies have no id, so every
  //  man shared one "undefined" verdict — and it only looked 26 m out with the
  //  eye ray pinned at y=1.5, under the terrain on half the maps.)
  const ENGAGE_R = M.wpn && M.wpn.type && M.wpn.type.includes('SNIPER') ? 78 : 68;
  M._losT = (M._losT || 0) - dt;
  if (M._losT <= 0) {
    M._losT = 0.3;
    M._losMap = M._losMap || new Map();
    const eyeY = M.pos.y + (M.stance === 'prone' ? 0.55 : M.stance === 'crouch' ? 1.05 : 1.55);
    const cand = [];
    for (const E of enemies) { if (!E.alive || !E.obj) continue; const d = E.pos.distanceTo(M.pos); if (d < ENGAGE_R) cand.push([d, E]); }
    cand.sort((a, b) => a[0] - b[0]);
    let checked = 0, nt = null;
    _sv.set(M.pos.x, eyeY, M.pos.z);
    for (const [d, E] of cand) {
      if (checked >= 4) break;   // round-robin: at most 4 fresh LOS rays per mate per tick
      checked++;
      _tv.set(E.pos.x - M.pos.x, (E.pos.y + 1.1) - eyeY, E.pos.z - M.pos.z);
      const dist = _tv.length(); _tv.normalize();
      raycaster.set(_sv, _tv); raycaster.far = dist;
      const vis = raycaster.intersectObjects(_groundMeshes, false).length === 0;
      M._losMap.set(E, vis);
      if (vis) { nt = E; break; }
    }
    if (!nt && M.tgt && M.tgt.alive && M._losMap.get(M.tgt) && M.pos.distanceTo(M.tgt.pos) < ENGAGE_R + 10) nt = M.tgt; // keep a confirmed target
    M.tgt = nt;
  }
  let tgt = M.tgt || null;
  // formation slot (or hold position)
  let slot;
  if (squadHold) slot = M.holdPos || M.pos;
  else {
    const [sx, sz] = M.slot || [0, -2];
    const cy = Math.cos(player.yaw), sy = Math.sin(player.yaw);
    slot = _sv.set(player.pos.x + cy * sx + sy * sz, 0, player.pos.z - sy * sx + cy * sz).clone();
  }
  M.aimPitch = tgt ? Math.atan2((tgt.pos.y + 1.2) - (M.pos.y + 1.45), Math.max(1, M.pos.distanceTo(tgt.pos))) : 0;
  if (!squadFireFree) { tgt = null; M.tgt = null; } // holding fire: no aiming, no shooting
  const to = new THREE.Vector3().subVectors(slot, M.pos); to.y = 0;
  const distSlot = to.length();
  M.moving = false;
  if (tgt) {
    // engage: face the enemy, aim from his current stance, burst fire
    const want = Math.atan2(tgt.pos.x - M.pos.x, tgt.pos.z - M.pos.z);
    let d2 = want - M.yaw;
    while (d2 > Math.PI) d2 -= Math.PI * 2;
    while (d2 < -Math.PI) d2 += Math.PI * 2;
    M.yaw += d2 * Math.min(1, dt * 6);
    mateSetAnim(M, M.stance === 'prone' ? ANIM.prone : M.stance === 'crouch' ? ANIM.crouchAim : ANIM.aim);
    if (now >= M.nextShot) {
      if (M.burstLeft <= 0) M.burstLeft = M.wpn.burst;
      M.burstLeft--;
      M.nextShot = now + (M.burstLeft > 0 ? M.wpn.interval : 0.8 + Math.random() * 0.7);
      playMateShot(M);
      if (Math.random() < M.wpn.acc) hurtEnemy(tgt, M.wpn.dmg);
    }
  } else if (distSlot > 0.55) {
    to.normalize();
    const cap = M.stance === 'prone' ? 1.5 : M.stance === 'crouch' ? 2.1 : 99; // he keeps the leader's stance even on the move
    const speed = Math.min(distSlot > 5 ? 3.2 : 1.35, cap);
    M.pos.addScaledVector(to, speed * dt);
    M.yaw = Math.atan2(to.x, to.z);
    const clip = M.stance === 'prone' ? ANIM.proneCrawl : M.stance === 'crouch' ? ANIM.crouchWalk : (speed > 2 ? ANIM.run : ANIM.walk);
    mateSetAnim(M, clip);
    if (M.actions[clip]) M.actions[clip].timeScale = speed / (clip === ANIM.proneCrawl ? 0.55 : clip === ANIM.crouchWalk ? AUTH.crouch : (speed > 2 ? AUTH.run : AUTH.walk));
    M.moving = true;
  } else {
    mateSetAnim(M, M.stance === 'prone' ? ANIM.prone : M.stance === 'crouch' ? ANIM.crouchAim : ANIM.idle);
  }
  for (const c of colliders) {
    if (c.top !== undefined && M.pos.y > c.top - 0.45) continue;
    const dx = M.pos.x - c.x, dz = M.pos.z - c.z;
    const d = Math.hypot(dx, dz), min = c.r + 0.35;
    if (d > 0.001 && d < min) { M.pos.x = c.x + dx / d * min; M.pos.z = c.z + dz / d * min; }
  }
  wallPush(M.pos, M.pos.y, 0.38);
  M.pos.y += (groundForY(M.pos) - M.pos.y) * Math.min(1, dt * 9);
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
  gear.traverse(m => { if (m.isMesh) m.castShadow = !SET.lowGfx; });
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
  gear.traverse(m => { if (m.isMesh) m.castShadow = !SET.lowGfx; });
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
let cutscene = null;
const M1_SUBS = [
  'Get that C4 rigged, quick. If they see us we\'re dead.',
  'I\'m on it, just another few seconds.',
  'Fire at will!!',
  'Roger that Voodoo-3. See you later. Over.',
  'Good to see you. What kept you?',
];
function cutLook(c) {
  if (c.kind === 'POS' && c.look) return new THREE.Vector3(c.look[0], c.look[1], c.look[2]);
  if (c.kind === 'OBJ') {
    const t = (c.targ || '').toUpperCase();
    if (t.includes('Foley')) return new THREE.Vector3(prisonPos.x, prisonPos.y + 1.5, prisonPos.z);
    if (t.includes('IRAQ')) { const E = enemies.find(e => e.pos); return E ? new THREE.Vector3(E.pos.x, E.pos.y + 1.5, E.pos.z) : new THREE.Vector3(player.pos.x, player.pos.y + 1.5, player.pos.z); }
    return new THREE.Vector3(player.pos.x, player.pos.y + 1.5, player.pos.z);
  }
  const p = ((c.look || [0, 0])[0]) * Math.PI / 180, y = ((c.look || [0, 0])[1]) * Math.PI / 180;
  return new THREE.Vector3(c.pos[0] + Math.sin(y) * 12, c.pos[1] + Math.tan(p) * 12 + 1.5, c.pos[2] + Math.cos(y) * 12);
}
function startCutscene() {
  // Directed mission-brief cinema, the way the original does it: an
  // establishing shot on the squad, then each objective IN ORDER with its
  // title, then back over the squad leader's shoulder. No random cameras.
  const B = (from, to, look, title, sub, dur) => ({ from, to, look, title, sub, dur });
  const V = (v, dx, dy, dz) => { const x = v.x + dx, z = v.z + dz; return new THREE.Vector3(x, Math.max(groundYCached(x, z) + dy, (v.y || 0) + dy), z); };
  const L = (v, dy) => new THREE.Vector3(v.x, (v.y || groundYCached(v.x, v.z)) + dy, v.z);
  const beats = [
    B(V(player.pos, 16, 8, 16), V(player.pos, 8, 3.4, 8), L(player.pos, 1.3), MISNAME,
      IS_M1 ? 'NORTHERN ALGERIA \u00b7 1994 \u2014 23:00. THEY ARE HOLDING ZIANI PAST THE BRIDGE.' : 'NORTHERN ALGERIA \u00b7 1994', 4.5),
  ];
  const objs = OBJ.filter(o => o.pos);
  objs.forEach((o, i) => {
    const short = o.text.split('\u2014')[0].trim();
    beats.push(B(V(o.pos, 14, 7, 14), V(o.pos, 7.5, 3.2, 7.5), L(o.pos, 1.4),
      (i + 1) + '. ' + short, o.text, 4));
  });
  if (!objs.length && enemies.length) {
    const E = enemies[0];
    beats.push(B(V(E.pos, 12, 6, 12), V(E.pos, 7, 3, 7), L(E.pos, 1.4), '1. ELIMINATE ALL HOSTILES', 'CLEAR THE THEATRE, THEN REACH THE LZ', 4));
  }
  beats.push(B(V(player.pos, 6, 3, 6), V(player.pos, 3, 1.9, 3), L(player.pos, 1.35), '',
    'YOUR ORDERS ARE IN \u2014 F1 ANY TIME. GOOD HUNTING.', 3.2));
  cutscene = { t: 0, beats, idx: -1, dur: beats.reduce((s2, b) => s2 + b.dur, 0) };
  document.body.classList.add('inCut');   // clean letterbox: HUD hidden until you own the squad
  const bt = document.getElementById('barTop'), bb = document.getElementById('barBot');
  if (bt) bt.style.display = 'block';
  if (bb) bb.style.display = 'block';
  startGameAudio();
}
function startGameAudio() {
  try {
    const gm = document.getElementById('gamemusic');
    if (gm && gm.paused) { gm.volume = 0.16 * (SET.vol || 1); gm.play().catch(() => {}); }
  } catch (e) { /* audio unavailable */ }
}
function endCutscene() { document.body.classList.remove('inCut'); const _m = document.getElementById('msg'); if (_m) _m.style.opacity = 0; msgT = 0; startGameAudio(); startAmbience(); if (!cutscene) { playing = true; return; } cutscene = null; playing = true; updateHUD(); renderer.domElement.requestPointerLock?.(); for (const id of ['barTop', 'barBot', 'csub']) { const el = document.getElementById(id); if (el) el.style.display = 'none'; } }
function safeStartCutscene() { try { startCutscene(); if (!cutscene) endCutscene(); } catch (e) { console.warn('cutscene failed:', e); document.body.classList.remove('inCut'); cutscene = null; playing = true; for (const id of ['barTop', 'barBot', 'csub']) { const el = document.getElementById(id); if (el) el.style.display = 'none'; } } }
addEventListener('mousedown', () => { if (cutscene) endCutscene(); });
startEl.addEventListener('click', (e) => {
  uiClick();
  // the briefing is inert until the DEPLOY button exists: no click can
  // strand the player on a 'STILL LOADING' message ever again
  if (!window.__playLoaded) return;
  if (!e.target.closest('#deployGo')) return;
  if (playerHP <= 0 || missionDone) {
    restartMission(); resetEnemies(true);
  }
  const h1 = startEl.querySelector('h1');
  if (h1) h1.textContent = '▶ CLICK TO PLAY';
  startEl.style.display = 'none';
  if (window.__deployedOnce && MIS === 'mission1') { playing = true; }   // M1 re-deploy: straight back in
  else { window.__deployedOnce = true; safeStartCutscene(); }
  updateHUD();
  renderer.domElement.requestPointerLock?.();
});
{ const kr = document.getElementById('kiaRestart');
  if (kr) kr.onclick = () => { restartMission(); playing = true; };   // instant: full ammo & kit, no reload
  const kb = document.getElementById('kiaBrief');
  if (kb) kb.onclick = () => { document.getElementById('kia').style.display = 'none'; startEl.style.display = 'flex'; };
}
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
  { // normal look keeps the original tight range; aiming unlocks full up/down
    const lim = (aiming || firing) ? [-1.02, 1.12] : [-0.15, 1.0];
    camPitch = THREE.MathUtils.clamp(camPitch + (SET.inv ? -dy : dy) * 0.0022 * sens * SET.sens, lim[0], lim[1]);
  }
});
renderer.domElement.addEventListener('mousedown', (e) => {
  if (!playing) return;
  if (e.button === 0) firing = true;
  if (e.button === 2 && aimAllowed()) aiming = true;   // a medikit is not aimed like a gun
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) { firing = false; dragging = false; player.semiLatch = false; player.burstN = 0; }
  if (e.button === 2) aiming = false;
});
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('keydown', (e) => {
  if (cutscene) { endCutscene(); return; }
  if (e.code === 'ControlLeft' || e.code === 'ControlRight') e.preventDefault();
  keys.add(e.code);
  if (e.code === 'KeyC' && playing) targetStanceIdx = targetStanceIdx === 1 ? 0 : 1;
  if (e.code === 'KeyX' && playing) targetStanceIdx = targetStanceIdx === 2 ? 0 : 2;
  if (e.code === 'F11') { e.preventDefault(); const el = document.getElementById('perf'); if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none'; }
  if (e.code === 'KeyR' && playing) startReload();

  if (e.code.startsWith('Digit') && playing) {
    const n = +e.code.slice(5);
    if (n >= 1 && n <= 4) switchTo(n - 1);
  }
  if (e.code === 'F1') { e.preventDefault(); if (playing || f1Open) toggleF1(); }
  if (e.code === 'Escape' && f1Open) toggleF1(false);
  if (e.code === 'KeyG' && playing) { squadFireFree = !squadFireFree; updateHUD(); }
  if (e.code === 'KeyF' && playing) {
    squadHold = !squadHold;
    if (squadHold) members.forEach((M, i) => { if (i !== activeIdx) M.holdPos = M.pos.clone(); });
    updateHUD();
  }
  if (e.code === 'KeyP') { playing = false; startEl.style.display = 'flex'; document.exitPointerLock?.(); }
  if (e.code === 'Tab' && playing) { e.preventDefault(); toggleInv(); }
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) _spaceT = performance.now(); }
  if (quickInv && playing && !e.repeat && (e.code === 'KeyW' || e.code === 'KeyS'))
    setHeld(members[activeIdx].held + (e.code === 'KeyS' ? 1 : -1));
  if (quickInv && playing && !e.repeat && (e.code === 'KeyA' || e.code === 'KeyD')) {
    const modes = ['AUTO', 'BURST', 'SEMI'];
    player.fireMode = modes[(modes.indexOf(player.fireMode) + (e.code === 'KeyD' ? 1 : modes.length - 1)) % modes.length];
    player.burstN = 0; player.semiLatch = false;
    showMsg('FIRE MODE', player.fireMode); updateHUD();
  }
  if (e.code === 'KeyL' && playing) {
    const sl = curSlot();
    if (sl) { if (sl.kind === 'item' && sl.key !== 'BINOCULARS') useItem(sl, nowSec); else setHeld(members[activeIdx].held); }
    if (quickInv) setQuickInv(false);
  }
  if (e.code === 'KeyQ' && playing && members[activeIdx]) setHeld(members[activeIdx].held + 1);
  if (e.code === 'KeyH' && playing) tryHeal();
  if (e.code === 'KeyE' && playing) {
    const pk = nearestPickup();
    if (pk) takePickup(pk);
    else {
      if (IS_M1 && gateSwitchPos && dist2D(player.pos, gateSwitchPos) < 3.2) toggleGate();
      const M = members[activeIdx];
      const hasC4 = M && M.inv && M.inv.some(s2 => s2.key === 'C4' && (s2.left === undefined || s2.left > 0));
      if (hasC4 && IS_M1 && objIdx === 2 && dist2D(player.pos, bridgePos) < 9) tryPlantC4();
      else if (IS_M1 && objIdx === 2 && dist2D(player.pos, bridgePos) < 9) { const holder = members.find((Mt, i) => i !== activeIdx && Mt.inv && Mt.inv.some(s2 => s2.key === 'C4' && (s2.left === undefined || s2.left > 0))); showMsg('NO C4 ON YOU', holder ? holder.name + ' IS CARRYING THE C4 — SWITCH TO HIM (PGUP / PGDN)' : 'RECOVER THE C4 CHARGES FIRST'); }
      // otherwise nothing to use here — the original stays silent too
    }
  }
});
addEventListener('wheel', (e) => {
  if (playing && (quickInv || invOpen) && members[activeIdx]) setHeld(members[activeIdx].held + (e.deltaY > 0 ? 1 : -1));   // the wheel only works while SPACE holds the strip open
});
addEventListener('keyup', (e) => {
  keys.delete(e.code);
  if (e.code === 'Space') {
    if (quickInv) setQuickInv(false);
    else if (playing && performance.now() - _spaceT < 230 && !player.airborne && player.stance !== 'prone') {
      player.airborne = true; player.vy = 7.6;   // tap = jump; hold = inventory
    }
  }
});

function startReload() {
  const s0 = curSlot();
  if (!s0 || s0.kind !== 'gun' || BD.WEAPONS[s0.key].melee) return;
  if (BD.WEAPONS[s0.key].rocket && s0.key !== 'RPG7') return;   // the LAW is a single-shot disposable tube
  if (player.reloading || player.ammo === WPN.mag) return;
  if ((s0.reserve || 0) <= 0) { playClick(); showMsg('NO RESERVE AMMO', 'FIND AN AMMO BOX'); return; }
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

/* ---- tracers: pooled streaks so every shot reads on screen ---- */
const tracers = [];
// original-game FX sprites: FrontEnd/M15ShotA (muzzle blast) + Metal_Decal (strike marks)
const _m15Tex = new THREE.TextureLoader().load('textures/fx/m15shot.png');
const _decalTex = new THREE.TextureLoader().load('textures/fx/metal_decal.png');
const _mzlPool = [], _decalPool = [];
for (let i = 0; i < 6; i++) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: _m15Tex, transparent: true, opacity: 0, depthWrite: false })); sp.visible = false; scene.add(sp); _mzlPool.push({ sp, t: 0 }); }
for (let i = 0; i < 14; i++) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: _decalTex, transparent: true, opacity: 0, depthWrite: false })); sp.scale.set(0.42, 0.42, 1); sp.visible = false; scene.add(sp); _decalPool.push({ sp, t: 0 }); }
let _decalI = 0;
function muzzlePuff(p, big) { const s = _mzlPool.find(x => x.t <= 0) || _mzlPool[0]; s.sp.position.copy(p); s.sp.scale.set(big ? 1.6 : 0.95, big ? 0.85 : 0.5, 1); s.sp.material.rotation = Math.random() * 6.28; s.t = 0.07; s.sp.visible = true; }
function spawnDecal(p) { const s = _decalPool[_decalI++ % _decalPool.length]; s.sp.position.copy(p); s.t = 6; s.sp.visible = true; s.sp.material.opacity = 0.85; s.sp.material.rotation = Math.random() * 6.28; }
function updateFxSprites(dt) {
  for (const s of _mzlPool) if (s.t > 0) { s.t -= dt; s.sp.material.opacity = Math.max(0, s.t / 0.07) * 0.95; if (s.t <= 0) s.sp.visible = false; }
  for (const s of _decalPool) if (s.t > 0) { s.t -= dt; if (s.t < 1.2) s.sp.material.opacity = Math.max(0, s.t / 1.2) * 0.85; if (s.t <= 0) s.sp.visible = false; }
}

function spawnTracer(a, b, col = 0xffe2ae, w = 1) {
  let T = tracers.find(t => t.life <= 0);
  if (!T) {
    if (tracers.length > 30) return;
    T = { obj: new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.022, 1), new THREE.MeshBasicMaterial({ color: 0xffe2ae, transparent: true, opacity: 0 })), life: 0 };
    T.obj.frustumCulled = false;
    scene.add(T.obj); tracers.push(T);
  }
  const len = a.distanceTo(b); if (len < 2) return;
  T.obj.material.color.setHex(col);
  T.obj.position.copy(a).add(b).multiplyScalar(0.5);
  T.obj.lookAt(b);
  T.obj.scale.set(w, w, len);
  T.obj.visible = true;
  T.life = 0.07;
}
function updateTracers(dt) {
  for (const T of tracers) {
    if (T.life <= 0) continue;
    T.life -= dt;
    T.obj.material.opacity = Math.max(0, T.life / 0.07) * 0.8;
    if (T.life <= 0) T.obj.visible = false;
  }
}
function doFire(now) {
  const M = members[activeIdx];
  if (!M || !M.inv) return;
  const slot = M.inv[M.held];
  if (slot.kind === 'item') { if (!player.itemLatch) { player.itemLatch = true; useItem(slot, now); } return; }
  const W = BD.WEAPONS[slot.key];
  if (W.melee) { // combat knife: silent, close only
    if (now < player.nextShot) return;
    player.nextShot = now + W.interval;
    playClick();
    setAnim('UPRIGHT_STEALTH_KNIFE', true); player.actT = 0.55;   // the slash, not a gun-shot
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
  const _fm = (slot.key === 'M16A2' || slot.key === 'SAW') ? player.fireMode : 'AUTO';
  if (_fm === 'SEMI' && player.semiLatch) return;
  gunshotNoise(player.pos, slot.key === 'SIGP228' ? 15 : W.rocket ? 95 : 62);
  window.__lastShotT = now;   // enemies duck when your shots start cracking
  player.nextShot = now + W.interval;
  if (player.ammo <= 0) { playClick(); player.nextShot = now + 0.3; return; }
  player.ammo--; slot.ammo = player.ammo;
  playShot();
  if (_fm === 'SEMI') player.semiLatch = true;
  if (_fm === 'BURST') { player.burstN++; if (player.burstN >= 3) { player.burstN = 0; player.nextShot = now + 0.34; } }
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
    if (hitE && hitE.alive) {
      const hh = hitE.posture === 'prone' ? 0.45 : hitE.posture === 'crouch' ? 1.05 : 1.5;
      const head = hits[0].point.y > hitE.pos.y + hh;   // a head shot is earned now, not a one-hit gift
      hurtEnemy(hitE, Math.round(W.dmg * (head ? 2.6 : 1)), head);
    } else spawnDecal(hits[0].point);
  }
  muzzlePuff(rifleObj ? flash.position : new THREE.Vector3(player.pos.x, player.pos.y + 1.42, player.pos.z), slot.key === 'BARRETT' || slot.key === 'PSG1');
  { // visible tracer from the muzzle to the strike (or downrange on a miss)
    const mz = rifleObj ? flash.position.clone() : new THREE.Vector3(player.pos.x, player.pos.y + 1.42, player.pos.z);
    const end = hits.length ? hits[0].point : raycaster.ray.at(170, new THREE.Vector3());
    const big = slot.key === 'BARRETT' || slot.key === 'PSG1';
    spawnTracer(mz, end, big ? 0xfff3cf : 0xffe0a1, big ? 2.6 : 1);
  }
  updateHUD();
}

// steer with wall-sliding: try the wanted heading, then ±40°, then ±80° —
// men flow around hillsides instead of grinding straight into them. A step
// that drops more than maxDrop is refused: soldiers contour along a hill
// and pick a walkable line down instead of falling off the edge.
function enemyStep(E, dx, dz, speed, dt, maxDrop = 1.35) {
  const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
  const base = Math.atan2(dx, dz);
  for (const off of [0, 0.65, -0.65, 1.25, -1.25, 1.9, -1.9]) {
    const a = base + off, sx = Math.sin(a), sz = Math.cos(a);
    const nx = E.pos.x + sx * speed * dt, nz = E.pos.z + sz * speed * dt;
    if (!canStandAt(nx, nz, sx, sz, E.pos.y)) continue;
    const h = groundHitCached(nx, nz, E.pos.y);
    if (h === null || E.pos.y - h > maxDrop) continue;   // cliff edge: find another way down
    E.pos.x = nx; E.pos.z = nz;
    let dy = a - E.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
    E.yaw += THREE.MathUtils.clamp(dy, -dt * 5, dt * 5);
    return true;
  }
  return false;
}
// where a man of this role belongs around the target: a fireteam ring, not
// a conga line — point pushes closest, base anchors at range, flank swings wide
function formationPos(E, T) {
  const rangeWanted = E.role === 'point' ? 19 : E.role === 'flank' ? 25 : 34;
  let ang = Math.atan2(E.pos.x - T.pos.x, E.pos.z - T.pos.z);
  if (E.role === 'flank') ang += (E.flankSide || 1) * 1.0;
  return new THREE.Vector3(T.pos.x + Math.sin(ang) * rangeWanted, 0, T.pos.z + Math.cos(ang) * rangeWanted);
}
// find a nearby spot that actually hides him from the target (LOS-blocked)
function findCover(E, T) {
  const away = Math.atan2(E.pos.x - T.pos.x, E.pos.z - T.pos.z);
  const chestY = T.pos.y + 1.2;
  for (const [ang, r] of [[away, 5], [away + 0.8, 5], [away - 0.8, 5], [away + 1.6, 6], [away - 1.6, 6], [away, 8], [away + 0.5, 3.5], [away - 0.5, 3.5]]) {
    const x = E.pos.x + Math.sin(ang) * r, z = E.pos.z + Math.cos(ang) * r;
    const h = groundHitCached(x, z, E.pos.y);
    if (h === null || Math.abs(h - E.pos.y) > 1.2) continue;
    if (!canStandAt(x, z, Math.sin(ang), Math.cos(ang), E.pos.y)) continue;
    const from = new THREE.Vector3(x, h + 1.1, z);
    raycaster.set(from, new THREE.Vector3(T.pos.x - x, chestY - from.y, T.pos.z - z).normalize());
    raycaster.far = Math.hypot(T.pos.x - x, T.pos.z - z);
    if (raycaster.intersectObjects(_groundMeshes, false).length > 0) return new THREE.Vector3(x, h, z);
  }
  return null;
}
let grenadesThrown = 0;
function enemyGrenade(E, T) {
  grenadesThrown++;
  const o = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), new THREE.MeshBasicMaterial({ color: 0x2a2f22 }));
  o.position.set(E.pos.x, E.pos.y + 1.5, E.pos.z);
  scene.add(o);
  const dir = new THREE.Vector3().subVectors(T.pos, o.position);
  const d = Math.hypot(dir.x, dir.z);
  dir.normalize();
  projectiles.push({ obj: o, vel: dir.multiplyScalar(13).add(new THREE.Vector3(0, 5.2, 0)), kind: 'FRAG', t: THREE.MathUtils.clamp(d / 12, 0.7, 2.4) });
}
// a rifle crack carries: men in earshot move toward it (the silenced pistol
// barely whispers). Close shots give them the area for free.
function gunshotNoise(pos, radius) {
  for (const E of enemies) {
    if (!E.alive || !E.obj) continue;
    const d = E.pos.distanceTo(pos);
    if (d > radius) continue;
    if (E.holdPost) { E.alert = 1; continue; }
    if (E.state === 'patrol' || E.state === 'return' || E.state === 'investigate') {
      E.invPos = new THREE.Vector3(pos.x + (Math.random() - 0.5) * 6, pos.y, pos.z + (Math.random() - 0.5) * 6);
      E.invT = 6.5; E.spotT = 0; E.state = 'investigate';
      if (d < 30) E.lastSeen = pos.clone();
    } else if (E.state === 'search' && d < 42) E.lastSeen = pos.clone();
  }
}
// a man in contact shouts: nearby squadmates who can't see you yet still
// come to the fight (they must win their own line of sight to shoot)
function contactAlert(src) {
  for (const E of enemies) {
    if (E === src || !E.alive) continue;
    if (E.pos.distanceTo(src.pos) > 44) continue;
    if (E.holdPost) { E.alert = Math.max(E.alert, 0.8); continue; }
    if (E.state === 'patrol' || E.state === 'investigate' || E.state === 'return') {
      E.lastSeen = src.lastSeen ? src.lastSeen.clone() : src.pos.clone();
      E.memT = 20; E.state = 'search'; makeSearch(E);
    } else if (E.state === 'search' && src.lastSeen) { E.lastSeen = src.lastSeen.clone(); E.memT = Math.max(E.memT, 12); }
  }
}
const _powTex = new THREE.TextureLoader().load('textures/fx/pow_skin.png');
_powTex.flipY = false; _powTex.colorSpace = THREE.SRGBColorSpace;
let powMats = null;
function applyPOWSkin() {
  const Z = members[3]; if (!Z || !Z.obj || powMats) return; powMats = [];
  Z.obj.traverse(o => { if (o.isMesh && o.name === 'NEWSKIN') { (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) { powMats.push([m, m.map]); m.map = _powTex; m.needsUpdate = true; } }); } });
}
function restorePOWSkin() { if (powMats) powMats.forEach(([m, t]) => { m.map = t; m.needsUpdate = true; }); powMats = null; }

function makeSearch(E) {
  E.searchPts = [];
  const c = E.lastSeen || E.pos;
  for (let i = 0; i < 4; i++) {
    const a = Math.random() * 6.283, r = 4 + Math.random() * 9;
    const x = c.x + Math.sin(a) * r, z = c.z + Math.cos(a) * r;
    const h = groundHitCached(x, z, E.pos.y);
    if (h !== null && Math.abs(h - E.pos.y) < 1.6) E.searchPts.push(new THREE.Vector3(x, h, z));
  }
  if (!E.searchPts.length) E.searchPts.push(c.clone());
  E.searchI = 0; E.lookT = 0;
}
function raiseAlert(pos, radius) {
  for (const E of enemies) {
    if (!E.alive || E.state !== 'patrol') continue;
    if (E.pos.distanceTo(pos) >= (radius || 30)) continue;
    if (!E.holdPost) { E.state = 'investigate'; E.invPos = pos.clone(); E.invT = 6; E.spotT = 0; }
    else E.alert = Math.max(E.alert, 0.6);   // sentries perk up, stay put
  }
}
/* ---- routing: the mission file ships a waypoint graph (id/next links) --
 * Long enemy travel follows those authored routes instead of walking in a
 * straight line into walls and hillsides; only short hops steer directly. */
let wpGraph = null;
function buildWpGraph() {
  const wps = (ENV && ENV.waypoints) || [];
  if (!wps.length) { wpGraph = null; return; }
  const pts = wps.map(w => new THREE.Vector3(w.pos[0], 0, w.pos[2]));
  const idx = new Map(wps.map((w, i) => [w.id, i]));
  const adj = new Map();
  const link = (a, b) => { if (a === b) return; if (!adj.has(a)) adj.set(a, new Set()); adj.get(a).add(b); };
  wps.forEach((w, i) => { const j = idx.get(w.next); if (j !== undefined) { link(i, j); link(j, i); } });
  wpGraph = { pts, adj };
}
function wpPath(fromPos, toPos) {
  if (!wpGraph || !wpGraph.adj.size) return null;
  const { pts, adj } = wpGraph;
  let si = 0, gi = 0, bd = 1e18, bg = 1e18;
  for (let i = 0; i < pts.length; i++) {
    const ds = (pts[i].x - fromPos.x) ** 2 + (pts[i].z - fromPos.z) ** 2;
    const dg = (pts[i].x - toPos.x) ** 2 + (pts[i].z - toPos.z) ** 2;
    if (ds < bd) { bd = ds; si = i; } if (dg < bg) { bg = dg; gi = i; }
  }
  if (si === gi) return [toPos.clone()];
  const prev = new Map([[si, -1]]); const q = [si];
  while (q.length) {
    const c = q.shift(); if (c === gi) break;
    for (const n of (adj.get(c) || [])) if (!prev.has(n)) { prev.set(n, c); q.push(n); }
  }
  if (!prev.has(gi)) return null;
  const path = []; let c = gi;
  while (c !== -1) { path.push(pts[c].clone()); c = prev.get(c); }
  path.reverse(); path.push(toPos.clone());
  return path;
}
function moveToward(E, target, speed, dt) {
  let tp = target;
  const d = Math.hypot(target.x - E.pos.x, target.z - E.pos.z);
  if (d > 25) {
    if (!E.path || !E.path.length || !E.pathGoal || E.pathGoal.distanceToSquared(target) > 100) {
      E.path = wpPath(E.pos, target); E.pathGoal = target.clone();
    }
    if (E.path && E.path.length) {
      tp = E.path[0];
      if (Math.hypot(tp.x - E.pos.x, tp.z - E.pos.z) < 1.8) { E.path.shift(); tp = E.path[0] || target; }
    }
  } else E.path = null;
  if (enemyStep(E, tp.x - E.pos.x, tp.z - E.pos.z, speed, dt)) { E._moving = true; return true; }
  return false;
}

function updateEnemy(E, dt, now) {
  if (E.homeYaw === undefined) { E.homeYaw = E.yaw; E.homePos = E.pos.clone(); E.pauseT = 0; E.scanPh = Math.random() * 6.28; E.lastSeen = null; E.alertT = 0; E.phaseT = 1 + Math.random() * 2; E.planted = false;
    E.posture = 'stand'; E.memT = 0; E.alert = 0; E.thinkT = Math.random() * 0.4; E.role = undefined; E.flankSide = 1;
    E.grenadeCd = now + 6 + Math.random() * 10; E.crouchPref = 0.35 + Math.random() * 0.5; E.suppressedT = 0; E.duckUntil = 0; E.coverPos = null; E.hideUntil = 0; E.searchPts = null; E.searchI = 0; E.lookT = 0; }
  if (E.obj) { const vis = player.pos.distanceToSquared(E.pos) < 22500; if (E.obj.visible !== vis) E.obj.visible = vis; }
  if (!E.obj || !E.mixer || !E.alive) return;
  // target = nearest living squad member (you or a mate)
  let T = { pos: player.pos, stance: player.stance, moving: player.moving, mate: null };
  let best = player.pos.distanceTo(E.pos);
  members.forEach((M, i) => {
    if (i === activeIdx || !M.alive || M.prisoner || M.absent) return;   // captives are not targets
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
  const headH = E.posture === 'prone' ? 0.55 : E.posture === 'crouch' ? 1.15 : 1.55;
  const head = new THREE.Vector3(E.pos.x, E.pos.y + headH, E.pos.z);
  const chest = new THREE.Vector3(T.pos.x, T.pos.y + 1.2, T.pos.z);
  const dir = new THREE.Vector3().subVectors(chest, head);
  raycaster.set(head, dir.clone().normalize());
  raycaster.far = dist;
  if (E.losT === undefined || E.losT <= 0) {
    E._blocked = raycaster.intersectObjects(_groundMeshes, false).length > 0 ||
      smokes.some(S => S.t > 0 && (S.pos.distanceTo(E.pos) < 7 || S.pos.distanceTo(T.pos) < 7));
    E.losT = 0.15;
  } else E.losT -= dt;
  const blocked = E._blocked;
  // ~150 deg frontal cone (plus point-blank awareness) + a detection build-up:
  // distant / crouched / prone / still targets take seconds to be spotted.
  const canSee = dist < E_SIGHT && (Math.cos(dyaw) > 0.26 || dist < 6 || (T.stance === 'stand' && dist < 14)) && !blocked;   // no eyes behind his head — but a standing man at 14 m is in his face
  E._canSee = canSee;
  E.spotNeed = (dist < 18 ? 0.35 : dist < 45 ? 0.7 : 1.3)
    * (T.stance === 'crouch' ? 1.7 : T.stance === 'prone' ? 2.6 : 1)
    * (!T.moving && dist > 15 ? 1.5 : 1);
  E.aimPitch = Math.atan2((T.pos.y + 1.25) - (E.pos.y + headH + 0.1), Math.max(1, dist));

  if (E.state === 'engage') {
    if (canSee) {
      if (!E.alert) playEnemyVoice(E, Math.random() < 0.55 ? 'spot' : 'attack'); // first sight — he shouts the contact
      E.lastSeen = T.pos.clone(); E.memT = 26; E.alert = 1; E.lostT = 0; E.seenT = now;
      E.stillT = T.moving ? 0 : (E.stillT || 0) + dt;
      if (now > E.alertT) { E.alertT = now + 7; contactAlert(E); }   // shout the contact to nearby guards
    } else {
      E.lostT += dt;
      // he does NOT forget you the second you break line of sight
      if (E.lostT > 1.2 && E.lastSeen && !E.holdPost) { E.state = 'search'; makeSearch(E); if (Math.random() < 0.5) playEnemyVoice(E, 'search'); }
      else if (E.holdPost) { E.memT = Math.max(0, E.memT - dt); if (E.memT <= 0) E.state = 'return'; }
      // blind but alerted: turn toward where you last saw/heard him — a
      // soldier does not stare at the wrong wall for a minute
      const lt = E.lastSeen || T.pos;
      let dy2 = Math.atan2(lt.x - E.pos.x, lt.z - E.pos.z) - E.yaw;
      while (dy2 > Math.PI) dy2 -= Math.PI * 2; while (dy2 < -Math.PI) dy2 += Math.PI * 2;
      E.yaw += dy2 * Math.min(1, dt * 2.6);
    }
    // --- think cycle (~3 Hz): role, posture, cover, grenades ---
    E.thinkT -= dt;
    if (E.thinkT <= 0) {
      E.thinkT = 0.35 + Math.random() * 0.2;
      if (E.role === undefined) { const ri = enemies.indexOf(E) % 3; E.role = ri === 0 ? 'point' : ri === 1 ? 'base' : 'flank'; E.flankSide = (enemies.indexOf(E) % 2) ? 1 : -1; }
      if ((E.hp <= 26 || now < E.suppressedT) && now > E.hideUntil && !E.coverPos && !E.holdPost) {
        const c = findCover(E, T);
        if (c) { E.coverPos = c; E.hideUntil = now + 2.4 + Math.random() * 2.2; }
      }
      if (now - (window.__lastShotT || -9) < 0.45 && canSee && Math.random() < 0.55) E.duckUntil = now + 1 + Math.random();   // incoming fire: duck
      const settled = canSee && dist <= E_FIRE_RANGE;
      E.wantPosture = now < E.duckUntil ? 'crouch' : settled ? (dist > 48 ? 'prone' : (Math.random() < E.crouchPref ? 'crouch' : 'stand')) : 'stand';
    }
    E._moving = false;
    let firing = false;
    if (E.holdPost && !E.coverPos) {
      // posted sentry: fight from the post — tower floor, bunker, HMG — the
      // mission data put him somewhere that matters; he does not leave it
      if (canSee && dist <= E_FIRE_RANGE) firing = true;
      else if (!canSee) E.yaw += Math.sin(now * 0.55 + E.scanPh) * dt * 1.1;   // scan the approaches
    } else if (E.coverPos) {
      // break contact: run for the cover spot, stay down, then re-engage
      const to = new THREE.Vector3().subVectors(E.coverPos, E.pos); to.y = 0;
      if (to.length() > 0.8) {
        if (enemyStep(E, to.x, to.z, 4.4, dt)) E._moving = true;
        enemySetAnim(E, E_ANIM.run); if (E.actions[E_ANIM.run]) E.actions[E_ANIM.run].timeScale = 4.4 / AUTH.run;
        E.posture = 'stand';
      } else {
        E.posture = 'crouch';
        enemySetAnim(E, 'KNEELING_STANCE_WITH_RIFLE');
        if (now > E.hideUntil) E.coverPos = null;
      }
    } else if (canSee) {
      const inBand = dist <= E_FIRE_RANGE && dist >= 12;
      if (E.role === 'base' && inBand && dist > 16) {
        firing = true;   // base of fire: anchor the position and shoot
      } else {
        // point & flank men (and anyone out of range) move to their ring
        // position around the target — a formation, not a conga line
        const dp = formationPos(E, T);
        const to = new THREE.Vector3().subVectors(dp, E.pos); to.y = 0;
        if (to.length() > 2.6 || !inBand) {
          if (moveToward(E, dp, 4.35, dt)) E._moving = true;
          enemySetAnim(E, E_ANIM.run);
          if (E.actions[E_ANIM.run]) E.actions[E_ANIM.run].timeScale = 4.35 / AUTH.run;
        } else firing = true;
        if (dist > E_FIRE_RANGE && to.length() <= 2.6) {
          // ring spot unreachable/far: just close on the target
          if (enemyStep(E, toPlayer.x, toPlayer.z, 4.35, dt)) E._moving = true;
          enemySetAnim(E, E_ANIM.run);
        }
      }
    }
    E.planted = firing && !E._moving;
    if (firing) {
      E.posture = E._moving ? 'stand' : (E.wantPosture || 'stand');
      if (E.posture === 'prone') enemySetAnim(E, 'PRONE_AIM_RIFLE');
      else if (E.posture === 'crouch') enemySetAnim(E, 'KNEELING_STANCE_WITH_RIFLE');
      else enemySetAnim(E, E_ANIM.aim);
    } else if (!E.coverPos && !E._moving) E.posture = 'stand';
    if (canSee) E.yaw += dyaw * Math.min(1, dt * 6);
    // grenades are a flush-out weapon, not a greeting: he throws when you
    // duck out of sight (fresh last-seen) or sit dug-in under his sights —
    // never just because he can see you moving in the open
    {
      const gTarget = canSee ? T.pos : (E.lastSeen && (now - E.seenT) < 6 ? E.lastSeen : null);
      if (gTarget && !E._moving && !E.coverPos && now > E.grenadeCd && (E.grenadesLeft ?? 2) > 0) {
        const gd = E.pos.distanceTo(gTarget);
        if (gd > 9 && gd < 31 && (!canSee || (E.stillT || 0) > 2.2)) {
          E.grenadeCd = now + 16 + Math.random() * 12;
          playEnemyVoice(E, 'attack'); // he yells as the grenade comes over
          E.grenadesLeft--;
          enemyGrenade(E, { pos: gTarget });
          enemySetAnim(E, 'anim_10FF6EC2', true);
          if (E.actions['anim_10FF6EC2']) E.actions['anim_10FF6EC2'].timeScale = 1.2;
        }
      }
    }
    if (canSee && dist <= E_FIRE_RANGE && !E.coverPos && now >= E.nextShot) {
      if (E.burstLeft <= 0) E.burstLeft = 3 + Math.floor(Math.random() * 3);
      E.burstLeft--;
      E.nextShot = now + (E.burstLeft > 0 ? 0.115 : 0.85 + Math.random() * 0.75);
      playAK(dist);
      flash.position.set(E.pos.x + Math.sin(E.yaw) * 0.7, E.pos.y + headH + 0.1, E.pos.z + Math.cos(E.yaw) * 0.7);
      flash.intensity = 40; flashT = 0.05;
      spawnTracer(flash.position.clone(), new THREE.Vector3(T.pos.x + (Math.random() - 0.5) * 1.4, T.pos.y + 1.15 + (Math.random() - 0.5) * 0.8, T.pos.z + (Math.random() - 0.5) * 1.4), 0xffc9a0, 0.8);
      let p = dist < 12 ? 0.50 : dist < 25 ? 0.36 : dist < 45 ? 0.26 : 0.17;
      if (E._moving) p *= 0.55; else if (E.planted) p *= 1.15;   // running snaps shots off; planted fires true
      if (E.posture === 'prone') p *= 1.12; else if (E.posture === 'crouch') p *= 1.06;
      if (T.stance === 'crouch') p *= 0.75;
      else if (T.stance === 'prone') p *= 0.55;
      if (T.moving) p *= 0.8;
      p *= DIFF.acc;
      if (Math.random() < p) {
        if (T.mate) {
          if (!T.mate.prisoner) T.mate.hp -= (8 + Math.random() * 6) * DIFF.dmg;   // a captive is never shot
          if (T.mate.hp <= 0) {
            T.mate.hp = 0; T.mate.alive = false;
            mateSetAnim(T.mate, 'DEATH_BY_SHOTGUN_BACKWARD', true);
            playVoice('man_down', 0.6);
          }
        } else {
          playerHP -= (8 + Math.random() * 6) * DIFF.dmg;
          dmgT = 0.45;
          if (Math.random() < 0.08) playVoice('im_hit', 0.42);   // rare pain reaction, not a scream track
          if (playerHP <= 0) die('HOSTILE FIRE');
        }
        updateHUD();
      }
    }
  } else if (E.state === 'search') {
    // hunting: sweep the last-seen ground point to point, weapon up
    E.memT -= dt;
    if (canSee) {
      E.spotT += dt;
      if (E.spotT > 0.45) { E.state = 'engage'; E.nextShot = now + 0.3 * DIFF.react; E.lastSeen = T.pos.clone(); E.memT = 26; }
    } else E.spotT = Math.max(0, E.spotT - dt);
    if (E.memT <= 0) { E.state = 'return'; E.alert = 0; }
    else {
      // flushing the last-seen cover on the way in
      if ((E.grenadesLeft ?? 2) > 0 && now > E.grenadeCd && E.lastSeen && (now - E.seenT) < 9 && !canSee) {
        const gd = E.pos.distanceTo(E.lastSeen);
        if (gd > 9 && gd < 31) {
          E.grenadeCd = now + 16 + Math.random() * 12; playEnemyVoice(E, 'attack'); E.grenadesLeft--;
          enemyGrenade(E, { pos: E.lastSeen });
          enemySetAnim(E, 'anim_10FF6EC2', true);
          if (E.actions['anim_10FF6EC2']) E.actions['anim_10FF6EC2'].timeScale = 1.2;
        }
      }
      const tp = (E.searchPts && E.searchPts[E.searchI]) || E.lastSeen || E.homePos;
      const to = new THREE.Vector3().subVectors(tp, E.pos); to.y = 0;
      if (E.lookT > 0) {
        E.lookT -= dt;
        E.posture = 'crouch';
        enemySetAnim(E, 'KNEELING_STANCE_WITH_RIFLE');
        E.yaw += Math.sin(now * 0.8 + E.scanPh) * dt * 1.6;
      } else if (to.length() < 1.2) {
        E.lookT = 1.3 + Math.random();
        E.searchI = (E.searchI + 1) % Math.max(1, (E.searchPts || []).length);
        if (E.searchI === 0 && E.memT < 14) makeSearch(E);   // still warm: widen the sweep once
      } else {
        if (moveToward(E, tp, 3.9, dt)) E._moving = true;
        enemySetAnim(E, E_ANIM.run);
        if (E.actions[E_ANIM.run]) E.actions[E_ANIM.run].timeScale = 3.9 / AUTH.run;
        E.posture = 'stand';
      }
    }
  } else if (E.state === 'return') {
    // memory cold: walk back to his post like nothing — no, like a soldier
    if (canSee) {
      E.spotT += dt;
      if (E.spotT > E.spotNeed * 0.6) { E.state = 'engage'; E.nextShot = now + 0.35 * DIFF.react; E.lastSeen = T.pos.clone(); E.memT = 26; }
    } else E.spotT = Math.max(0, E.spotT - dt * 0.5);
    const to = new THREE.Vector3().subVectors(E.homePos, E.pos); to.y = 0;
    if (to.length() < 1.3) { E.state = 'patrol'; enemySetAnim(E, E_ANIM.walk); }
    else {
      moveToward(E, E.homePos, 1.7, dt);
      enemySetAnim(E, E_ANIM.walk);
      if (E.actions[E_ANIM.walk]) E.actions[E_ANIM.walk].timeScale = 1.7 / AUTH.walk;
      E.posture = 'stand';
    }
  } else if (E.state === 'investigate') {
    // heard something: move to the spot, look around, then return to post
    if (canSee) {
      E.spotT += dt;
      if (E.spotT > E.spotNeed * 0.6) { E.state = 'engage'; E.nextShot = now + 0.35 * DIFF.react; }
    } else E.spotT = Math.max(0, E.spotT - dt * 0.5);
    const tp = E.invPos || E.homePos;
    const to = new THREE.Vector3().subVectors(tp, E.pos); to.y = 0;
    if (to.length() < 1.3) {
      enemySetAnim(E, E_ANIM.idle);
      E.invT -= dt;
      E.yaw += Math.sin(now * 0.7 + E.scanPh) * dt * 1.1;
      if (E.invT <= 0) { E.state = 'return'; }
    } else {
      moveToward(E, tp, 3.9, dt);
      enemySetAnim(E, E_ANIM.run);
      if (E.actions[E_ANIM.run]) E.actions[E_ANIM.run].timeScale = 3.9 / AUTH.run;
    }
  } else { // patrol between waypoints
    if (canSee) {
      E.spotT += dt;
      if (E.spotT > E.spotNeed) {
        E.state = 'engage'; E.nextShot = now + 0.45 * DIFF.react; E.lastSeen = T.pos.clone(); E.memT = 26; E.alert = 1;
        if (Math.random() < 0.55) playVoice('spotted_infantry_loud', 0.5);
        if (Math.random() < 0.5) raiseAlert(E.pos, 22);   // only sometimes does a shout carry (alerts keep last-seen only)
      }
    } else E.spotT = Math.max(0, E.spotT - dt * 0.5);
    if (E.waypoints.length <= 1) {
      // sentry on his env post: stands and scans around his env heading
      enemySetAnim(E, E_ANIM.idle);
      // sentry scan: his eyes wander a wide arc, then he re-posts on a new facing
      if (now > (E.scanT || 0)) { E.scanT = now + 4 + Math.random() * 5; E.scanC = E.homeYaw + (Math.random() - 0.5) * 6.0; }
      { const des = (E.scanC ?? E.homeYaw) + Math.sin(now * 0.5 + E.scanPh) * 0.45;
        let dd = des - E.yaw; while (dd > Math.PI) dd -= Math.PI * 2; while (dd < -Math.PI) dd += Math.PI * 2;
        E.yaw += Math.max(-dt * 1.1, Math.min(dt * 1.1, dd)); }
    } else if (E.pauseT > 0) {
      // pause at the waypoint and look around (original guard behaviour)
      E.pauseT -= dt;
      enemySetAnim(E, E_ANIM.idle);
      E.yaw += Math.sin(now * 0.55 + E.scanPh) * dt * 0.9;
    } else {
      const wp = E.waypoints[E.wp];
      const to = new THREE.Vector3().subVectors(wp, E.pos);
      to.y = 0;
      if (to.length() < 0.7) {
        E.wp = (E.wp + 1) % E.waypoints.length;
        E.pauseT = 1.6 + Math.random() * 2.2;
        enemySetAnim(E, E_ANIM.idle);
      } else {
        to.normalize();
        if (enemyStep(E, to.x, to.z, 1.25, dt)) {
          E.stuckT = 0;
          enemySetAnim(E, E_ANIM.walk);
          if (E.actions[E_ANIM.walk]) E.actions[E_ANIM.walk].timeScale = 1.25 / AUTH.walk;
        } else {
          // boxed in by the ground: scan like a sentry, then try the next leg
          E.stuckT = (E.stuckT || 0) + dt;
          enemySetAnim(E, E_ANIM.idle);
          if (now > (E.scanT || 0)) { E.scanT = now + 4 + Math.random() * 5; E.scanC = E.yaw + (Math.random() - 0.5) * 6.0; }
          { const des = (E.scanC ?? E.yaw) + Math.sin(now * 0.5 + E.scanPh) * 0.45;
            let dd = des - E.yaw; while (dd > Math.PI) dd -= Math.PI * 2; while (dd < -Math.PI) dd += Math.PI * 2;
            E.yaw += Math.max(-dt * 1.1, Math.min(dt * 1.1, dd)); }
          if (E.stuckT > 6) { E.stuckT = 0; E.wp = (E.wp + 1) % E.waypoints.length; E.pauseT = 1.2; }
        }
      }
    }
  }
  // solid world: enemies do not walk through vehicles/crates either
  for (const c of colliders) {
    if (c.top !== undefined && E.pos.y > c.top - 0.45) continue;
    const dx = E.pos.x - c.x, dz = E.pos.z - c.z;
    const d = Math.hypot(dx, dz), min = c.r + 0.35;
    if (d > 0.001 && d < min) { E.pos.x = c.x + dx / d * min; E.pos.z = c.z + dz / d * min; }
  }
  // fireteam spacing: never stack two men on the same firing spot
  for (const O of enemies) {
    if (O === E || !O.alive) continue;
    const dx = E.pos.x - O.pos.x, dz = E.pos.z - O.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > 0.0001 && d2 < 4.4) { const d = Math.sqrt(d2); E.pos.x += dx / d * (2.1 - d) * 0.5; E.pos.z += dz / d * (2.1 - d) * 0.5; }
  }
  wallPush(E.pos, E.pos.y, 0.38);
  E.pos.y += (groundForY(E.pos) - E.pos.y) * Math.min(1, dt * 9);
  E.obj.position.copy(E.pos);
  E.obj.rotation.y = E.yaw;
}

function updateHUD() {
  const ad = document.getElementById('ammoDigits');
  if (ad) {
    // guns show magazine rounds; items show how many are left (binoculars: none)
    const _hs2 = curSlot();
    const sv = _hs2 && _hs2.kind === 'item' ? (_hs2.left >= 0 ? String(_hs2.left) : '') : String(player.ammo);
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
    mt.textContent = (def.label || '') + (s && (s.key === 'M16A2' || s.key === 'SAW') ? ' · ' + player.fireMode : '')
      + (s && s.kind === 'gun' && !BD.WEAPONS[s.key].rocket ? ' · ' + Math.floor((s.reserve || 0) / Math.max(1, def.mag || 1)) + ' SPARE MAG' + (Math.floor((s.reserve || 0) / Math.max(1, def.mag || 1)) === 1 ? '' : 'S') : '')
      + (s && s.key === 'RPG7' ? ' · ' + (s.reserve || 0) + ' RCK' : '')
      + (player.reloading ? ' · RELOADING' : '');
    const wi = document.querySelector('#wpnbox .wicon');
    if (wi) { const srcI = BD.ICON(def.icon); if (wi.dataset.s !== srcI) { wi.dataset.s = srcI; wi.src = srcI; } }
    const ls = document.getElementById('lawSight');
    if (ls) { const on = !!(playing && (aiming || firing) && s && s.key === 'LAW66'); if (ls.style.display !== (on ? 'block' : 'none')) ls.style.display = on ? 'block' : 'none'; }
    const rs5 = document.getElementById('rpgSight');
    if (rs5) { const on = !!(playing && (aiming || firing) && s && s.key === 'RPG7'); if (rs5.style.display !== (on ? 'block' : 'none')) rs5.style.display = on ? 'block' : 'none'; }
    const bo5 = document.getElementById('binocOv');
    if (bo5) { const on = !!(playing && aiming && s && s.key === 'BINOCULARS'); if (bo5.style.display !== (on ? 'block' : 'none')) bo5.style.display = on ? 'block' : 'none'; }
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
    const pw = document.getElementById('pw' + i);
    if (pw && M.inv) { const hd = M.inv[M.held] || M.inv[0]; const hdDef = hd ? (hd.kind === 'gun' ? BD.WEAPONS[hd.key] : BD.ITEMS[hd.key]) : null; if (hdDef) { const ps = BD.ICON(hdDef.icon); if (pw.dataset.s !== ps) { pw.dataset.s = ps; pw.src = ps; } } }
    const pi = document.getElementById('pi' + i);
    if (pi) {
      const ic = M.prisoner ? 'IMAGE_VIP' : !M.alive ? 'IMAGE_DOGTAGSINGLE' : i === activeIdx ? 'IMAGE_ORDER_RADIO'
        : squadHold ? 'IMAGE_HOLDFIRE' : (!squadFireFree ? 'IMAGE_FOLLOW' : 'IMAGE_HOLD');
      const p = 'textures/ui/gwint/' + ic + '.png';
      if (pi.dataset.s !== p) { pi.dataset.s = p; pi.src = p; }
    }
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
  const _cx = document.getElementById('cross');
  if (_cx) _cx.style.display = (playing && (aiming || firing) && !invOpen && !f1Open && !(aiming && curSlot() && curSlot().key === 'BINOCULARS')) ? 'block' : 'none';   // the glasses draw their own glass
}

async function load() {
  const stats = document.getElementById('stats');
  try {
    startLoadHeartbeat();
    loadNote('Loading ' + MISNAME + ' — the real base…');
    ENV = await (await fetch(MISDIR + 'units.json')).json();
    try { PROPS = await (await fetch(MISDIR + 'props.json')).json(); } catch (e) { PROPS = null; }
    try { const ml = await (await fetch('missions.json')).json(); const me = ml.find(e => e.id === MIS); if (me) MISNAME = me.name; } catch (e) { /* default name */ }
    { const mb = document.getElementById('misBriefLine'); if (mb) mb.textContent = MISNAME; }
    { const gi = document.querySelector('#gpsmap img'); if (gi) { gi.src = 'textures/ui/maps/' + MIS + '.png'; gi.onerror = () => { gi.onerror = null; gi.src = 'textures/ui/mission1map.png'; }; }
      if (MIS !== 'mission1') { const gm = document.getElementById('gpsmap'); if (gm) gm.querySelectorAll('svg,.gpsdot').forEach(el => el.style.display = 'none'); }
      const gt = document.querySelector('#gpstext b'); if (gt && MIS !== 'mission1') gt.textContent = MISNAME; }
    applySky();
    loadStep(4, 'Loading ' + MISNAME + ' — mission data…');
    const zoneList = (PROPS && PROPS.zones && PROPS.zones.length) ? PROPS.zones
      : [{ f: 'Mis1_Zone1', m: 'MIS1_ZONE1' }, { f: 'Mis1_Zone1A', m: 'MIS1_ZONE1A' }, { f: 'Mis1_Zone1_Bridge', m: 'MIS1_ZONE1_BRIDGE' },
         { f: 'Mis1_Zone2', m: 'MIS1_ZONE2' }, { f: 'Mis1_Zone2A', m: 'MIS1_ZONE2A' }, { f: 'Mis1_Zone3', m: 'MIS1_ZONE3' },
         { f: 'Mis1_Zone3A', m: 'MIS1_ZONE3A' }, { f: 'Mis1_Zone4', m: 'MIS1_ZONE4' }];
    let zonesDone = 0;
    await runJobs(zoneList, async zn => {
      try {
      const g = await loader.loadAsync(MISDIR + zn.f + '.glb');
      g.scene.updateMatrixWorld(true);
      const groups = new Map();
      g.scene.traverse(o => {
        if (!o.isMesh) return;
        const geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
        for (const a of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(a)) geo.deleteAttribute(a);
        const key = o.material.uuid + '|' + Object.keys(geo.attributes).sort().join(',');
        if (!groups.has(key)) groups.set(key, { mat: o.material, geos: [] });
        groups.get(key).geos.push(geo);
      });
      const tf = (PROPS && PROPS.scenes && PROPS.scenes[zn.m]) || null;
      for (const grp of groups.values()) {
        let merged = null;
        try { merged = grp.geos.length === 1 ? grp.geos[0] : mergeGeometries(grp.geos, false); } catch (e) { merged = null; }
        for (const pgeo of (merged ? [merged] : grp.geos)) {
          const mesh = new THREE.Mesh(pgeo, grp.mat);
          mesh.receiveShadow = !SET.lowGfx;
          mesh.frustumCulled = false;
          mesh.castShadow = false;   // zones never cast
          if (tf) { mesh.position.set(tf.p[0], tf.p[1], tf.p[2]); mesh.rotation.y = tf.yaw; }
          world.add(mesh);
          _groundMeshes.push(mesh);  // static world for ground/LOS raycasts
          mesh.updateMatrix();
          pgeo.computeBoundingBox();
          const bb = pgeo.boundingBox.clone().applyMatrix4(mesh.matrix);
          worldBox = worldBox ? worldBox.union(bb) : bb;
        }
      }
      } catch (e) { console.warn('zone failed:', zn.f); }
      zonesDone++;
      loadStep(4 + 66 * zonesDone / zoneList.length, 'World ' + zonesDone + '/' + zoneList.length + ' — ' + zn.f + '…');
    }, 4);
    LOADP = loadStep;
    loadStep(72, 'Placing the base — vehicles, bridge, buildings…');
    await buildStaticWorld();
    loadStep(85, 'Making the base solid — walls and cover…');
    buildWallSegments();
    loadStep(88, 'Base loaded — kitting out the squad…');
    if (ENV.start) player.pos.set(ENV.start.pos[0], 0, ENV.start.pos[2]);
    player.pos.y = groundY(player.pos.x, player.pos.z);
    buildEnemies();
    buildObjectives();
    if (IS_M1) { // the captured MiG — Mission1.env PROXTRIG_MIG
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
    await Promise.all([...Object.values(BD.WEAPONS), ...Object.values(BD.ITEMS)].map(async def => {
      try { modelCache[def.model] = (await loader.loadAsync(def.model)).scene; } catch (e) { console.warn('model failed:', def.model); }
    }));
    await Promise.all([...new Set(BD.GEAR.flat().map(g => g[1]))].map(async file => {
      try { gearCache[file] = (await loader.loadAsync('models/gear/' + file + '.glb')).scene; } catch (e) { console.warn('gear failed:', file); }
    }));

    try { const alib = await loader.loadAsync('models/play/animlib.glb'); EXTRA_ANIMS.push(...(alib.animations || [])); } catch (e) { console.warn('animlib', e); }
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
      rifleObj.traverse(o => { if (o.isMesh) o.castShadow = !SET.lowGfx; });
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
    loadStep(94, 'Deploying hostiles…');
    const foeTemplate = await loader.loadAsync('models/enemy/IraqInfantry01_Sandy.glb');
    // One shared BIP01 rig: the foe template alone lacks kneel/prone clips and
    // the heroes lack death clips — merge both libraries so EVERY soldier
    // (enemy, squad mate, player) can kneel, go prone, and fall dead.
    const animLib = [...EXTRA_ANIMS, ...(foeTemplate.animations || []), ...(hero.animations || [])];
    for (const c of animLib) if (!actions[c.name]) actions[c.name] = mixer.clipAction(c);
    const akTemplate = (await loader.loadAsync('models/enemy/Rifle05_AK47.glb')).scene;
    const texByUrl = {};
    Object.entries(FACE_TEX).forEach(([k, u]) => { texByUrl[u] = faceTexCache[k]; });
    enemyFactory = createEnemyObjects;
    loadNote('Deploying ' + enemies.length + ' hostiles…');
    enemies.forEach(E => loadEnemy(E));

    // ---- the squad ----
    members.push({ name: 'BENALI', wpn: WEAPONS[0], ammo: WEAPONS[0].mag, obj: heroObj, mixer, actions, rifle: rifleObj,
      gunConn: gunConnector, rifleL: rifleLObj, pos: player.pos.clone(), yaw: player.yaw,
      hp: 100, alive: true, current: null, slot: null });
    members[0].inv = makeInv(0); members[0].held = 0;
    attachGear(heroObj, 0);
    members[0].heldObj = rifleObj; // the loader-attached M16 — setHeldModel swaps it for the cache clone
    setHeldModel(members[0]);
    player.ammo = members[0].inv[0].ammo;
    for (const def of SQUAD_DEFS) await loadMate(def);
    if (IS_M1) applyPOWSkin();   // the captive waits in the game's PoW skin until rescued
    if (IS_M1) {
      // Mission 1 is a SOLO rescue in the original: BENALI deploys alone,
      // CHERIF/BOUDIAF are not on this op, ZIANI is the prisoner — and he does
      // not appear on the HUD until he is found and freed.
      [1, 2].forEach(i => { const M = members[i]; if (M) { M.absent = true; M.alive = false; if (M.obj) M.obj.visible = false; const c = document.getElementById('card' + i); if (c) c.style.display = 'none'; } });
      { const Z = members[3]; if (Z && Z.obj) { Z.prisoner = true; Z.pos.copy(prisonPos); Z.pos.y = groundY(prisonPos.x, prisonPos.z); Z.obj.position.copy(Z.pos); } }
      { const c3 = document.getElementById('card3'); if (c3) c3.style.display = 'none'; }
    }

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
      M.aimBones = findAimBones(M.obj);
      M.mixer = new THREE.AnimationMixer(M.obj);
      (glb.animations || []).forEach(c => M.actions[c.name] = M.mixer.clipAction(c));
      for (const c of animLib) if (!M.actions[c.name]) M.actions[c.name] = M.mixer.clipAction(c);
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

    function createEnemyObjects(E) {
    if (E.obj) return;
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
    for (const c of animLib) if (!E.actions[c.name]) E.actions[c.name] = E.mixer.clipAction(c);
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
    { const hRef = groundHitY(E.pos.x, E.pos.z, (E.envY || 0) + 0.6);
      E.pos.y = hRef !== null ? hRef : groundY(E.pos.x, E.pos.z); }
    if (E.home) E.home.y = E.pos.y;   // respawns land on the same platform
    E.obj.position.copy(E.pos);
    E.aimBones = findAimBones(E.obj);
    enemySetAnim(E, E_ANIM.walk);
    };
    function loadEnemy(E) { if (E.active && typeof enemyFactory === 'function') enemyFactory(E); }

    setAnim(ANIM.idle);
    window.__playLoaded = true;
    if (new URLSearchParams(location.search).get('redeploy') === '1') { startEl.style.display = 'none'; playing = true; }
    if (_loadBeat) { clearInterval(_loadBeat); _loadBeat = null; }
    loadStep(100, 'Loaded — ' + enemies.length + ' hostiles placed from the mission data.');
    { const dg = document.getElementById('deployGo'); if (dg) dg.style.display = 'block'; }
    { const bo = document.getElementById('briefObjs'); if (bo && MIS !== 'mission1' && OBJ.length) bo.innerHTML = OBJ.map((o, i) => (i + 1) + ' · <b>' + o.text + '</b>').join('<br>'); }   // every other mission briefs its OWN objectives, not M1's
    stats.innerHTML = '✔ LOADED — CLICK DEPLOY TO BEGIN (' + enemies.length +
      ' hostiles placed from the mission .env). Full game inventory on TAB.';
    buildItemBar();
    GF.load().then(() => {
      try { setCanvas('startTitle', GF.text(MISNAME, { size: 'L', color: '#f0d9a0', scale: 2.2 })); } catch (e) { /* title is decoration */ }
      setObjectiveText();
      setCanvas('killsCv', GF.text('HOSTILES DOWN 0', { size: 'S', color: '#e8a09a', scale: 1.5 }));
    });
    updateHUD();
    updateCompass();
  } catch (err) {
    if (_loadBeat) { clearInterval(_loadBeat); _loadBeat = null; }
    const p = document.getElementById('loadpct');
    if (p) p.textContent = 'STUCK';
    document.getElementById('err').textContent = '⚠ Load failed: ' + err.message;
    if (stats) stats.textContent = '⚠ Load failed: ' + err.message + ' — refresh the page to retry.';
    console.error(err);
  }
}
load();

// ---- main loop ----
const clock = new THREE.Clock();
let _fpsAcc = 0, _fpsN = 0, _fpsT = 0;
const _perf = { n: 0, last: 0, worst: 0 };
function animate() {
  requestAnimationFrame(animate);
  { const el = document.getElementById('perf');
    if (el && el.style.display !== 'none') {
      _perf.n++;
      const nowMs = performance.now();
      if (_perf.last && nowMs - _perf.last >= 500) {
        el.textContent = 'FPS ' + Math.round(_perf.n * 1000 / (nowMs - _perf.last)) + ' · ' + (1000 / Math.max(1, _perf.n)).toFixed(1) + ' MS/FRAME (WALL)';
        _perf.n = 0; _perf.last = nowMs;
      } else if (!_perf.last) _perf.last = nowMs;
    } }
  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 0.05);
  { // adaptive quality: shed pixels before shedding frames
    const raw = rawDt;
    _fpsAcc += raw; _fpsN++; _fpsT += raw;
    if (_fpsT > 2) {
      const avg = _fpsAcc / Math.max(1, _fpsN);
      _fpsAcc = 0; _fpsN = 0; _fpsT = 0;
      if (avg > 0.034) {
        // GPU-bound: shed pixels first, then the shadow pass entirely
        if (renderer.getPixelRatio() > 0.85) renderer.setPixelRatio(Math.max(0.85, renderer.getPixelRatio() - 0.25));
        else if (sun.castShadow) { sun.castShadow = false; console.info('adaptive quality: shadows off'); }
      }
      else if (avg < 0.015 && renderer.getPixelRatio() < 1.5 && !SET.lowGfx) renderer.setPixelRatio(Math.min(1.5, renderer.getPixelRatio() + 0.15));
    }
  }
  const now = clock.elapsedTime;

  if (cutscene && heroObj) {
    // mission-brief cutscene: one beat per objective (skip with any key/click)
    cutscene.t += dt;
    let acc = 0, b = cutscene.beats[cutscene.beats.length - 1], bi = cutscene.beats.length - 1, bt = 1;
    for (let i = 0; i < cutscene.beats.length; i++) {
      const B2 = cutscene.beats[i];
      if (cutscene.t < acc + B2.dur) { b = B2; bi = i; bt = (cutscene.t - acc) / B2.dur; break; }
      acc += B2.dur;
    }
    if (bi !== cutscene.idx) { cutscene.idx = bi; if (b.title) showMsg(b.title, ''); const cs = document.getElementById('csub'); if (cs) { cs.textContent = b.sub || ''; cs.style.display = b.sub ? 'block' : 'none'; } }   // one subtitle only (bottom), title only (top)
    const u = bt * bt * (3 - 2 * bt);
    camera.position.lerpVectors(b.from, b.to, u);
    const cgy = groundYCached(camera.position.x, camera.position.z) + 1.5;
    if (camera.position.y < cgy) camera.position.y = cgy;
    camera.lookAt(b.look);
    if (cutscene.t >= cutscene.dur) endCutscene();
  }
  if (playing && heroObj && !f1Open) {
    nowSec = now;
    sun.position.set(player.pos.x + 10, 16, player.pos.z + 7);
    sun.target.position.copy(player.pos);
    // thrown items, rockets, smoke, healing, C4, objectives
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const P = projectiles[i];
      P.vel.y -= 13 * dt;
      P.obj.position.addScaledVector(P.vel, dt);
      const gy0 = groundHitCached(P.obj.position.x, P.obj.position.z, P.obj.position.y + 0.3);
      const gy = (gy0 === null ? -999 : gy0) + 0.05;
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
      // ground just BELOW the rocket — never the highest surface in the
      // column (a rocket under the bridge must not blow up on the deck)
      const gy = groundHitCached(R.obj.position.x, R.obj.position.z, R.obj.position.y + 0.3);
      const hitE = enemies.some(E => E.alive && E.pos.distanceTo(R.obj.position) < 1.4);
      const hitArmor = armor && armor.alive && R.obj.position.distanceTo(armor.obj.position.clone().add(new THREE.Vector3(0, 1.6, 0))) < 3.6;
      R.trail -= dt;
      if (R.trail <= 0) { R.trail = 0.045; spawnSmoke(R.obj.position.clone(), 1.15, 0.55, 0); }
      if (R.t <= 0 || (gy !== null && R.obj.position.y <= gy + 0.1) || hitE || hitArmor || R.obj.position.distanceTo(migPos) < 3) {
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
    if (pendingC4 > 0) { pendingC4 -= dt; if (pendingC4 <= 0) explode(bridgePos.clone(), 16, 500); }
    if (!missionDone && OBJ.length) {
      const O = OBJ[objIdx];
      if (O.type === 'clear') {
        if (enemies.length && enemies.every(E => !E.alive)) {
          objIdx++;
          showMsg('AREA CLEAR', OBJ[objIdx] ? OBJ[objIdx].text : '');
          setObjectiveText(); updateHUD();
        }
      } else if (!IS_M1 && objIdx === OBJ.length - 1 && O.pos && dist2D(player.pos, O.pos) < O.r) {
        finishMission();
      } else if (objIdx === 0 && dist2D(player.pos, O.pos) < O.r) {
        objIdx = members.some(Mt => Mt.inv && Mt.inv.some(s2 => s2.key === 'C4' && (s2.left === undefined || s2.left > 0))) ? 2 : 1; // C4 may already be recovered — never strand the chain
        { const Z = members[3]; if (Z && Z.prisoner) { Z.prisoner = false; restorePOWSkin(); const c3 = document.getElementById('card3'); if (c3) c3.style.display = ''; showMsg('ZIANI', '\u201cGOOD TO SEE YOU. WHAT KEPT YOU?\u201d'); } else showMsg('OBJECTIVE COMPLETE', OBJ[objIdx].text); }
        setObjectiveText(); updateHUD();
      } else if (objIdx === 3) {
        const allIn = members.every((M, i) => !M.alive || i === activeIdx || dist2D(M.pos, O.pos) < 30);
        if (dist2D(player.pos, O.pos) < O.r && allIn) finishMission();
      }
    }
    if (objMarker) {
      const O = OBJ[objIdx];
      if (O && O.pos) { objMarker.visible = true; objMarker.position.set(O.pos.x, groundYCached(O.pos.x, O.pos.z) + 6 + Math.sin(now * 2) * 0.6, O.pos.z); }
      else objMarker.visible = false;   // position-less objectives (ELIMINATE) show no floating marker
    }
    if (msgT > 0) { msgT -= dt; if (msgT <= 0) document.getElementById('msg').style.opacity = 0; }
    if (keys.has('Space') && !quickInv && !invOpen && performance.now() - _spaceT > 230) setQuickInv(true);
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
    let f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    let s = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    if (quickInv) { f = 0; s = 0; }
    const walkMode = keys.has('ControlLeft') || keys.has('ControlRight'); // CDS: Ctrl = walk
    const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');   // Shift = sprint, SPACE = inventory
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
      const stepLen = speed * dt, cb = worldBox;
      const tryStep = (ax, az) => {
        if (!ax && !az) return false;
        const nx = THREE.MathUtils.clamp(player.pos.x + ax, cb ? cb.min.x + 1 : -352, cb ? cb.max.x - 1 : 24);
        const nz = THREE.MathUtils.clamp(player.pos.z + az, cb ? cb.min.z + 1 : -700, cb ? cb.max.z - 1 : -78);
        if (player.airborne) { if (groundHitCached(nx, nz) === null && groundHitCached(nx, nz, player.pos.y + 0.55) === null) return false; }
        else if (!canStandAt(nx, nz, move.x, move.z, player.pos.y)) return false;   // void / cliff face: blocked
        player.pos.x = nx; player.pos.z = nz; return true;
      };
      const stepped = tryStep(move.x * stepLen, move.z * stepLen)
        || tryStep(move.x * stepLen, 0) || tryStep(0, move.z * stepLen);   // slide along the face
      if (!stepped) { player.moving = false; speed = 0; }
      for (const c of colliders) {
        if (c.top !== undefined && player.pos.y > c.top - 0.45) continue;   // standing on it
        const dx = player.pos.x - c.x, dz = player.pos.z - c.z;
        const d = Math.hypot(dx, dz), min = c.r + 0.42;
        if (d > 0.001 && d < min) {
          player.pos.x = c.x + dx / d * min;
          player.pos.z = c.z + dz / d * min;
        }
      }
      wallPush(player.pos, player.pos.y, 0.42); // buildings are solid — no walking through walls
    }
    // facing: aim/fire -> camera direction; otherwise movement direction
    const wantYaw = (aiming || firing)
      ? Math.atan2(fwd.x, fwd.z)
      : player.moving ? Math.atan2(move.x, move.z) : player.yaw;
    let dy = wantYaw - player.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    player.yaw += dy * Math.min(1, dt * 10);
    if (groundHitCached(player.pos.x, player.pos.z) === null && player._safePos) player.pos.copy(player._safePos);   // void failsafe
    else player._safePos = player.pos.clone();
    // vertical: walking sticks to the ground, but step off a ledge/hill edge
    // and you FALL — gravity, impact, and damage scaled by the drop
    if (player.vy === undefined) { player.vy = 0; player.airborne = false; }
    {
      const gy = groundHitCached(player.pos.x, player.pos.z, player.pos.y + 0.45);
      if (gy !== null) {
        if (!player.airborne && gy < player.pos.y - 0.42) { player.airborne = true; player.vy = 0; }
        if (player.airborne) {
          player.vy -= 22 * dt;
          player.pos.y += player.vy * dt;
          if (player.pos.y <= gy) {
            player.pos.y = gy;
            const impactV = -player.vy;
            player.airborne = false; player.vy = 0;
            if (impactV > 10) hurtPlayerFall(Math.round((impactV - 10) * 6));   // ~9 m hurts badly, ~16 m+ kills
          }
        } else player.pos.y += (gy - player.pos.y) * Math.min(1, dt * 12);
      } else if (player.airborne) {
        player.vy -= 22 * dt; player.pos.y += player.vy * dt;   // ground still far below: keep falling
      } else {
        const gAbs = groundYCached(player.pos.x, player.pos.z);
        if (gAbs !== null && gAbs < player.pos.y - 0.42) { player.airborne = true; player.vy = 0; }   // stepped off a drop taller than the step window
      }
    }
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
        player.reloading = false;
        const s1 = curSlot();
        const take = s1 ? Math.min(WPN.mag - player.ammo, Math.max(0, s1.reserve || 0)) : WPN.mag - player.ammo;
        player.ammo += take;
        if (s1 && s1.kind === 'gun') { s1.reserve = Math.max(0, (s1.reserve || 0) - take); s1.ammo = player.ammo; }
        buildItemBar(); updateHUD();
      }
    }
    if (!firing) player.itemLatch = false;
    if (aiming && !aimAllowed()) aiming = false;   // swapped to an item in hand: the aim comes down
    aimT = (aiming || firing) ? aimT + dt : 0;
    settledFire = aimT > 0.22 && (player.stance === 'stand' || !player.moving); // crouch/prone: planted to shoot
    if (firing && !player.reloading) doFire(now);

    // animation selection — the pose follows what's actually in his hands
    if (player.actT > 0) player.actT -= dt;   // slash / throw / dressing / planting owns the body
    else if (!player.reloading) {
      const PO = heldPose();
      const cs = curSlot();
      if (player.airborne && actions['FALLING_MID_AIR']) setAnim('FALLING_MID_AIR');
      else if (player.stance === 'prone') {
        const nm = cs && cs.key === 'BINOCULARS' && aiming && actions['PRONE_USE_BINOCULARS'] ? 'PRONE_USE_BINOCULARS'
          : (player.moving && actions[ANIM.proneCrawl] ? ANIM.proneCrawl : ANIM.prone);
        setAnim(nm);
      } else if (player.stance === 'crouch') {
        if ((aiming || firing) && PO && PO.crouchAim && actions[PO.crouchAim]) setAnim(PO.crouchAim);
        else if (aiming || firing) {
          if (player.moving) { // crouch aim-move: crouched legs + kneeling aim upper
            let nm = 'CAIM_F';
            if (Math.abs(s) >= Math.abs(f) && s !== 0) nm = s > 0 ? 'CAIM_R' : 'CAIM_L';
            if (actions[nm]) { setAnim(nm); actions[nm].timeScale = speed / AUTH.crouch; }
            else setAnim(ANIM.crouchAim);
          } else setAnim(ANIM.crouchAim); // the kneeling shooting stance
        } else if (PO && PO.walk && actions[PO.walk]) { setAnim(PO.walk); actions[PO.walk].timeScale = player.moving ? speed / AUTH.crouch : 0; }
        else {
          setAnim(ANIM.crouchWalk);
          if (actions[ANIM.crouchWalk]) actions[ANIM.crouchWalk].timeScale = player.moving ? speed / AUTH.crouch : 0;
        }
      } else if ((aiming || firing) && PO && PO.aim) {
        setAnim(player.moving && actions[PO.walk] ? PO.walk : PO.aim);   // pistol up / LAW shouldered / glasses raised
      } else if (aiming || firing) {
        if (player.moving) { // aim-move blends: locomotion legs + aiming upper body
          let nm = 'AIMM_F';
          if (Math.abs(s) >= Math.abs(f) && s !== 0) nm = s > 0 ? 'AIMM_R' : 'AIMM_L';
          else if (f < 0) nm = 'AIMM_B';
          if (actions[nm]) { setAnim(nm); actions[nm].timeScale = nm === 'AIMM_B' ? -speed / AUTH.walk : speed / AUTH.walk; }
          else setAnim(ANIM.aim);
        } else setAnim(ANIM.aim, false, 0.28);
      } else if (player.moving) {
        const nm = PO && PO.walk ? (walkMode ? PO.walk : PO.run) : (walkMode ? ANIM.walk : ANIM.run);
        setAnim(nm);
        if (actions[nm]) actions[nm].timeScale = walkMode ? speed / AUTH.walk : speed / AUTH.run;
      } else setAnim(PO && PO.idle && actions[PO.idle] ? PO.idle : ANIM.idle);
    }
    updateEnemyActivation();
    updateFootsteps(dt, player.moving ? speed : 0);
    enemies.forEach(E => updateEnemy(E, dt, now));
    updateArmor(dt, now);
    updateGate(dt);
    updateTracers(dt);
    if (IS_M1 && gateSwitchPos) invSay(dist2D(player.pos, gateSwitchPos) < 3.5 ? 'E — GATE SWITCH' : '');
    for (const b of banners) { b.rotation.y = Math.sin(now * 1.25) * 0.38; b.rotation.z = Math.sin(now * 1.7) * 0.05; }
    for (const p of pickups) if (!p.taken && p.obj) p.obj.rotation.y += dt * 0.7;
    members.forEach((M, i) => { if (i !== activeIdx) updateMate(M, dt, now); });
    updateHUD();
  }

  updateFxSprites(dt);
  if (mixer) mixer.update(dt);
  // aim pitch: your spine follows the camera pitch; AI spines track their target
  if (heroObj) {
    if (!heroObj.userData.aimBones) heroObj.userData.aimBones = findAimBones(heroObj);
    if (aiming || firing || current === ANIM.aim) applyAimPitch(heroObj.userData.aimBones, -camPitch * 0.95);   // aim pitch shows while AIMING (spine + head), like the original
  }
  frameN++;
  enemies.forEach((E, ei) => { if (E.mixer) { const dc = E.pos.distanceToSquared(player.pos); const step = dc > 12100 ? 4 : dc > 3600 ? 2 : 1; if (step === 1 || ((frameN + ei) % step) === 0) { E.mixer.update(dt * step); if (E.alive && (E.state === 'engage' || E.aimPitch)) applyAimPitch(E.aimBones, E.aimPitch || 0); } } positionHeadGear(E); });
  members.forEach((M, i) => { if (i !== activeIdx && M.mixer) { M.mixer.update(dt); if (M.aimPitch) applyAimPitch(M.aimBones, M.aimPitch); } });
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
  if (heroObj && !cutscene) {
    const aimNow = aiming || firing;
    const _hs = curSlot();
    const targetFov = _hs && _hs.key === 'BINOCULARS' && aiming ? 11 : aimNow ? 33 : 50;
    // through the glasses = eyes view: camera in the hero's head, body hidden
    const binocNow = !!(_hs && _hs.key === 'BINOCULARS' && aiming);
    if (heroObj) heroObj.visible = !binocNow;
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 9);
      camera.updateProjectionMatrix();
    }
    const dist = binocNow ? 0 : aimNow ? 1.9 : 4.3;
    const rgt = new THREE.Vector3(Math.cos(camYaw), 0, -Math.sin(camYaw));
    const shoulder = binocNow ? 0 : aimNow ? 0.55 : 0.12;
    const cx = player.pos.x + Math.sin(camYaw) * Math.cos(camPitch) * dist + rgt.x * shoulder;
    const cz = player.pos.z + Math.cos(camYaw) * Math.cos(camPitch) * dist + rgt.z * shoulder;
    let cy = player.pos.y + 1.55 + Math.sin(camPitch) * dist;
    cy = Math.max(cy, groundYCached(cx, cz) + 0.45);   // looking up must not bury the camera
    camera.position.lerp(new THREE.Vector3(cx, cy, cz), 1 - Math.pow(0.0001, dt));
    if (aimNow) { // aiming: the camera pitches with your aim so uphill/downhill targets sit under the crosshair
      const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
      camera.lookAt(player.pos.x + fx * 12 + rgt.x * 0.4,
                    player.pos.y + 1.42 - Math.sin(camPitch) * 12,
                    player.pos.z + fz * 12 + rgt.z * 0.4);
    } else {        // normal play: the original camera (fixed head-height look)
      camera.lookAt(player.pos.x + rgt.x * 0,
                    player.pos.y + 1.35,
                    player.pos.z + rgt.z * 0);
    }
  }

  sun.position.set(player.pos.x + 25, player.pos.y + 38, player.pos.z + 14);
  sun.target.position.copy(player.pos);
  sun.target.updateMatrixWorld();
  if (flashT > 0) { flashT -= dt; if (flashT <= 0) flash.intensity = 0; }
  if (hawkRotor) hawkRotor.rotation.y += dt * 22;
  cloudLayers.forEach((c, i) => { if (c.material.map) { c.material.map.offset.x += dt * (i ? 0.0016 : 0.0009); c.position.x = camera.position.x; c.position.z = camera.position.z; } });
  const dome = scene.getObjectByName('SKYDOME'); if (dome) dome.position.copy(camera.position);
  if (a10Obj) { // A-10 flyover: a single LEVEL pass every ~85 s (fixed altitude, no bobbing)
    if (a10Obj.userData.alt === undefined) {
      let mx = 0;
      for (let i = 0; i <= 20; i++) mx = Math.max(mx, groundYCached(-430 + i * 28, -730 + i * 28));
      a10Obj.userData.alt = mx + 46;
    }
    const T = 85, PASS = 11, k = now % T;
    if (k < PASS) {
      const u = k / PASS;
      a10Obj.visible = true;
      a10Obj.position.set(-430 + u * 560, a10Obj.userData.alt, -730 + u * 560);
      a10Obj.rotation.set(0, Math.atan2(560, 560) + Math.PI, 0.06);
    } else a10Obj.visible = false;
  }
  if (impactT > 0) { impactT -= dt; impact.scale.setScalar(1 + (0.12 - impactT) * 8); if (impactT <= 0) impact.visible = false; }
  for (const F of fireballs) { if (F.t > 0) { F.t -= dt; const k = 1 - Math.max(0, F.t) / F.life; F.sp.scale.setScalar(F.s0 * (0.35 + k * 1.6)); F.sp.material.opacity = Math.max(0, 1 - k * 1.2); if (F.t <= 0) F.sp.visible = false; } }
  if (shakeAmp > 0.003) { camera.position.x += (Math.random() - 0.5) * shakeAmp * 0.14; camera.position.y += (Math.random() - 0.5) * shakeAmp * 0.1; shakeAmp *= Math.pow(0.002, dt); } else shakeAmp = 0;
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

// ---- headless self-test hooks (snapshot system) ----
window.BD_TEST = {
  state: () => ({ playing, objIdx, hp: Math.round(playerHP), ammo: player.ammo,
    slot: (() => { const s2 = curSlot(); return s2 ? { key: s2.key, kind: s2.kind, reserve: s2.reserve, left: s2.left } : null; })(),
    anim: current, aiming: aiming, diff: DIFF.name,
    sights: { law: (document.getElementById('lawSight') || {}).style?.display || '', rpg: (document.getElementById('rpgSight') || {}).style?.display || '', binoc: (document.getElementById('binocOv') || {}).style?.display || '' },
    fx: { mzl: _mzlPool.some(x => x.sp.visible), decals: _decalPool.filter(x => x.sp.visible).length },
    pos: player.pos.toArray().map(v => +v.toFixed(1)), airborne: !!player.airborne, vy: +(player.vy || 0).toFixed(1), rockets: rockets.length, rocketPos: rockets.length ? rockets[0].obj.position.toArray().map(v => +v.toFixed(1)) : null,
    kia: (document.getElementById('kia') || {}).style ? document.getElementById('kia').style.display : '',
    enemies: enemies.filter(E => E.alive).map(E => ({ st: E.state, hp: Math.round(E.hp), x: +E.pos.x.toFixed(1), y: +E.pos.y.toFixed(1), z: +E.pos.z.toFixed(1), d: +E.pos.distanceTo(player.pos).toFixed(1), planted: !!E.planted, moving: !!E._moving, posture: E.posture || 'stand', mem: Math.round(E.memT || 0), see: !!E._canSee, hold: !!E.holdPost, yaw: +E.yaw.toFixed(2), gr: E.grenadesLeft ?? 2, ls: E.lastSeen ? [+E.lastSeen.x.toFixed(0), +E.lastSeen.z.toFixed(0)] : null })),
    corpses: enemies.filter(E => !E.alive).slice(0, 6).map(E => ({ anim: E.current, x: +E.pos.x.toFixed(1), z: +E.pos.z.toFixed(1) })),
    grenadesThrown, gate: +gateT.toFixed(2), gateBuilt: !!gateObj,
    pickups: pickups.map(p => ({ t: p.type, x: p.x, z: p.z, d: +Math.hypot(p.x - player.pos.x, p.z - player.pos.z).toFixed(1), taken: p.taken })),
    armor: armor ? { hp: armor.hp, alive: armor.alive, x: +armor.obj.position.x.toFixed(1), y: +armor.obj.position.y.toFixed(1), z: +armor.obj.position.z.toFixed(1) } : null,
    hasC4: members.some(M => M.inv && M.inv.some(s2 => s2.key === 'C4')),
    boomAt: Math.round(lastBoomAt), walls: wallSegCount, voicePlays,
    mates: members.map((M, i) => ({ i, stance: M.stance || 'stand', tgt: !!(M.tgt && M.tgt.alive), alive: M.alive, absent: !!M.absent })),
    wpns: members.map(M => M.wpn ? M.wpn.label : null) }),
  teleport(x, z) { player.pos.set(x, groundY(x, z), z); player.vy = 0; player.airborne = false; },
  pitch(v) { camPitch = v; },
  dbg() { return { pos: [player.pos.x, player.pos.y, player.pos.z], safe: player._safePos ? [player._safePos.x, player._safePos.y, player._safePos.z] : null, vy: player.vy, air: player.airborne, moving: player.moving, stance: player.stance }; },
  camDir() { const v = new THREE.Vector3(); camera.getWorldDirection(v); return { camYaw: +camYaw.toFixed(3), camPitch: +camPitch.toFixed(3), dir: [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)], playerYaw: +player.yaw.toFixed(3) }; },
  drop(h) { player.pos.y += h; player.airborne = true; player.vy = 0; },
  facePlayer(x, z) { /* point camera from player toward x,z */ const dx = x - player.pos.x, dz = z - player.pos.z; camYaw = Math.atan2(-dx, -dz); },
  key(code, down) { if (down) keys.add(code); else keys.delete(code); },
  aim(on) { aiming = !!on; firing = !!on; if (on) { aimT = 1; settledFire = true; } },
  look(on) { aiming = !!on; if (on) aimT = 1; },
  give(key) { const M = members[activeIdx]; const def = BD.WEAPONS[key]; M.inv.push({ kind: 'gun', key, ammo: def.mag, reserve: key === 'RPG7' ? 3 : 0, left: -1 }); setHeld(M.inv.length - 1); },
  select(key) { const M = members[activeIdx]; const i = M.inv.findIndex(s2 => s2.key === key); if (i >= 0) setHeld(i); },
  hurt(n) { playerHP -= n; if (playerHP <= 0) die('TEST'); },
  setHP(v) { playerHP = v; },
  aggro() { let n = 0; for (const E of enemies) { if (!E.alive) continue; if (E.pos.distanceTo(player.pos) < 70) { E.state = 'engage'; E.lastSeen = player.pos.clone(); E.memT = 26; E.nextShot = nowSec + 0.5; if (n === 0) E.grenadeCd = nowSec + 0.5; n++; } } },
  slay() { const E = enemies.filter(e2 => e2.alive).sort((a, b) => a.pos.distanceTo(player.pos) - b.pos.distanceTo(player.pos))[0]; if (!E) return null; hurtEnemy(E, 999); return { anim: E.current, x: +E.pos.x.toFixed(1), z: +E.pos.z.toFixed(1) }; },
  pressE() { dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' })); },
  powSkin() { return { applied: !!powMats, prisoner: !!(members[3] && members[3].prisoner) }; },
  bones() { const out = {}; if (!heroObj) return { err: 'no hero' }; heroObj.updateMatrixWorld(true); const seen = []; heroObj.traverse(o => { if (o.name) seen.push(o.name); }); out._n = seen.length; out._sample = seen.filter(x => /ARM|HAND|HEAD/.test(x)).slice(0, 8); for (const nm of ['BIP01_R_UPPERARM', 'BIP01_R_FOREARM', 'BIP01_HEAD', 'BIP01_L_UPPERARM', 'BIP01_PELVIS']) { const o = heroObj.getObjectByName(nm); if (o) { const v = new THREE.Vector3(); o.getWorldPosition(v); { const v = new THREE.Vector3(); o.getWorldPosition(v); const q = new THREE.Quaternion(); o.getWorldQuaternion(q); out[nm] = [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2), 'q', +q.x.toFixed(2), +q.y.toFixed(2), +q.z.toFixed(2), +q.w.toFixed(2)]; } } } return out; },
  hitNearest(dmg, head) { const E = enemies.filter(e2 => e2.alive).sort((a, b) => a.pos.distanceTo(player.pos) - b.pos.distanceTo(player.pos))[0]; if (!E) return null; const before = E.hp; hurtEnemy(E, dmg, !!head); return { before, after: E.hp, alive: E.alive, st: E.state, anim: E.current }; },
  toggleGate() { toggleGate(); return gateTarget; },
  reload() { startReload(); },
  giveItem(key, n = 1) { const M = members[activeIdx]; if (M && M.inv) { const s = M.inv.find(s2 => s2.key === key); if (s) s.left = (s.left || 0) + n; else M.inv.push({ kind: 'item', key, left: n }); } },
  wallAt(x, z) { const P = new THREE.Vector3(x, 0, z); wallPush(P, groundY(x, z), 0.42); return Math.hypot(P.x - x, P.z - z) > 0.01; },
  matePos(i, x, z) { const M = members[i]; if (M) { M.pos.set(x, groundY(x, z), z); if (M.obj) M.obj.position.copy(M.pos); } },
  setStance(s) { const i = STANCES.indexOf(s); if (i >= 0) { targetStanceIdx = i; stanceIdx = i; player.stance = s; } },
};
