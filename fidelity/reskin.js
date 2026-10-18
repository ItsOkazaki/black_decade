import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// BLACK DECADE reskin proof: same hero, original UK-desert atlas vs the
// repainted ANP-woodland atlas (textures/Hero01_DZ_01.png).

const container = document.getElementById('view');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a2016);
scene.fog = new THREE.Fog(0x1a2016, 30, 90);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 300);
camera.position.set(0, 1.8, 17.5);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);
const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.05, 0);
controls.enableDamping = true;
controls.minDistance = 0.2;      // get right into a face
controls.maxDistance = 45;
controls.screenSpacePanning = true; // right-drag pans freely

const VIEWS = {
  all: [0, 1.05, 0, 0, 1.8, 17.5],
  s1: [-5, 1.45, 0, -4.5, 1.6, 2.3],
  s2: [-3, 1.45, 0, -2.5, 1.6, 2.3],
  s3: [-1, 1.45, 0, -0.5, 1.6, 2.3],
  s4: [1, 1.45, 0, 1.5, 1.6, 2.3],
  e1: [3, 1.45, 0, 3.5, 1.6, 2.3],
  e2: [5, 1.45, 0, 5.5, 1.6, 2.3],
  e3: [7, 1.45, 0, 7.5, 1.6, 2.3],
};
document.querySelectorAll('#views button').forEach(b => {
  b.addEventListener('click', () => {
    const v = VIEWS[b.dataset.v];
    if (!v) return;
    controls.target.set(v[0], v[1], v[2]);
    camera.position.set(v[3], v[4], v[5]);
  });
});

scene.add(new THREE.HemisphereLight(0xdfeaff, 0x54482e, 1.05));
const sun = new THREE.DirectionalLight(0xffe2b0, 1.9);
sun.position.set(7, 13, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(20, 48),
  new THREE.MeshStandardMaterial({ color: 0x77743f, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const loader = new GLTFLoader();
const texLoader = new THREE.TextureLoader();
const mixers = [];

function prepHero(heroScene) {
  heroScene.traverse(o => {
    if (o.isMesh) {
      if (o.name === 'NEWSKIN') { o.castShadow = true; o.receiveShadow = true; }
      else {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(m => { const c = m.clone(); c.visible = false; o.material = c; });
      }
    }
  });
}

async function buildSoldier(x, dz) {  const hero = await loader.loadAsync('models/scene/Hero01_Armstrong.glb');
  prepHero(hero.scene);
  hero.scene.position.set(x, 0, 0);
  scene.add(hero.scene);
  // rifle at the game's connector
  const rifle = await loader.loadAsync('models/scene/Rifle02_M16wM203.glb');
  let conn = null;
  hero.scene.traverse(o => { if (o.name && o.name.toUpperCase().includes('GUNR')) conn = o; });
  if (conn) conn.add(rifle.scene);
  if (dz) await attachGearR(hero.scene, 0); // Bradley wears his kit on the roster page too
  if (dz) {
    const tex = await texLoader.loadAsync('textures/Hero01_DZ_01.png?v=8');
    tex.flipY = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = MAX_ANISO;
    hero.scene.traverse(o => {
      if (o.isMesh && o.name === 'NEWSKIN') {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(m => { if (m.map) { m.map = tex; m.needsUpdate = true; } });
      }
    });
  }
  const mixer = new THREE.AnimationMixer(hero.scene);
  const idle = THREE.AnimationClip.findByName(hero.animations, 'IDLE_LOOK_AROUND_WITH_GUN');
  if (idle) mixer.clipAction(idle).play();
  mixers.push(mixer);
}

// ---- enemies: same gear builders as play.js ----
const headGearPairs = [];
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
function triangleShell(root, selector, material, inflate, displace) {
  let skin = null;
  root.traverse(o => { if (o.isSkinnedMesh && o.name === 'NEWSKIN') skin = o; });
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
function buildHeadShells(root) {
  const scarfTex = keffiyehTexture();
  scarfTex.repeat.set(8, 8);
  const scarfMat = new THREE.MeshLambertMaterial({ map: scarfTex, side: THREE.DoubleSide });
  triangleShell(root,
    (dom, cen) => (dom.includes('HEAD') && !(cen[2] > 0.015 && cen[1] > 1.48 && cen[1] < 1.72)),
    scarfMat, 0.028);
  triangleShell(root,
    (dom, cen) => (dom.includes('NECK') || dom.includes('SPINE3') || dom.includes('SPINE2') || dom.includes('CLAVICLE')) &&
                  cen[1] > 1.34 && !(cen[2] > 0.09 && cen[1] < 1.52),
    scarfMat, 0.036);
  triangleShell(root,
    (dom, cen, uvCen) => (uvCen[0] > 0.165 && uvCen[0] < 0.345 && uvCen[1] > 0.485 && uvCen[1] < 0.615) ||
      ((dom.includes('HEAD') || dom.includes('NECK')) && cen[2] > 0.02 && cen[1] > 1.38 && cen[1] < 1.56),
    new THREE.MeshLambertMaterial({ map: beardTexture(), side: THREE.DoubleSide }), 0.016,
    (x, y, z) => {
      const t = THREE.MathUtils.clamp((1.60 - y) / 0.20, 0, 1);
      return [0, -0.085 * t, 0.010 * t];
    });
}
function robeTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#c4b693'; x.fillRect(0, 0, 256, 64);
  for (let i = 0; i < 256; i += 32) {
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
function buildMujahidGear(root) {
  const robeMat = new THREE.MeshLambertMaterial({ map: robeTexture(), side: THREE.DoubleSide });
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.27, 0.88, 14, 1, true), robeMat);
  skirt.position.y = 0.61;
  root.add(skirt);
  const strapMat = new THREE.MeshLambertMaterial({ color: 0x3f3a28 });
  const brassMat = new THREE.MeshLambertMaterial({ color: 0xa8873f });
  const strap = new THREE.Group();
  strap.add(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.56, 0.022), strapMat));
  for (let i = 0; i < 8; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.058, 0.028), brassMat);
    b.position.set(0, -0.22 + i * 0.063, 0.003);
    strap.add(b);
  }
  strap.position.set(0.02, 1.27, 0.145);
  strap.rotation.z = 0.62;
  root.add(strap);
  buildHeadShells(root);
  let headBone = null;
  root.traverse(o => {
    const nm = (o.name || '').toUpperCase();
    if (nm.includes('HEAD') && !nm.includes('END')) headBone = o;
  });
  const gear = new THREE.Group();
  const agalGeo = new THREE.TorusGeometry(0.125, 0.016, 8, 22);
  agalGeo.rotateY(Math.PI / 2);
  const agal = new THREE.Mesh(agalGeo, new THREE.MeshLambertMaterial({ color: 0x141210 }));
  agal.position.set(0.150, 0, -0.060);
  agal.castShadow = true;
  gear.add(agal);
  scene.add(gear);
  if (headBone) headGearPairs.push({ gear, bone: headBone });
}

function greenWrapTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#55663f'; x.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 128; i += 18) {
    x.fillStyle = 'rgba(30,40,20,0.35)'; x.fillRect(0, i, 128, 4);
    x.fillStyle = 'rgba(210,220,180,0.13)'; x.fillRect(0, i + 5, 128, 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 3);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function buildTurbanGear(root) {
  const wrapTex = greenWrapTexture();
  wrapTex.repeat.set(10, 10);
  triangleShell(root,
    (dom, cen) => (dom.includes('HEAD') && !(cen[2] > 0.015 && cen[1] > 1.48 && cen[1] < 1.72)),
    new THREE.MeshLambertMaterial({ map: wrapTex, side: THREE.DoubleSide }), 0.034);
  let headBone = null;
  root.traverse(o => {
    const nm = (o.name || '').toUpperCase();
    if (nm.includes('HEAD') && !nm.includes('END')) headBone = o;
  });
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
  scene.add(gear);
  if (headBone) headGearPairs.push({ gear, bone: headBone });
  const tailMat = new THREE.MeshLambertMaterial({ map: greenWrapTexture(), side: THREE.DoubleSide });
  [-0.075, 0.075].forEach((tx, i) => {
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.38, 0.016), tailMat);
    tail.position.set(tx, 1.13, 0.148);
    tail.rotation.set(-0.05, 0, i === 0 ? 0.06 : -0.06);
    tail.castShadow = true;
    root.add(tail);
  });
}

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
function buildHelmetGear(root) {
  let headBone = null;
  root.traverse(o => {
    const nm = (o.name || '').toUpperCase();
    if (nm.includes('HEAD') && !nm.includes('END')) headBone = o;
  });
  const gear = new THREE.Group();
  const camoMat = new THREE.MeshLambertMaterial({ map: desertCamoTexture(), side: THREE.DoubleSide });
  const shellGeo = new THREE.SphereGeometry(0.148, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.58);
  shellGeo.rotateZ(-Math.PI / 2);
  const shell = new THREE.Mesh(shellGeo, camoMat);
  shell.position.set(0.105, 0, -0.057);
  shell.scale.set(0.82, 1.06, 1.10);
  gear.add(shell);
  const brimGeo = new THREE.CylinderGeometry(0.165, 0.168, 0.016, 22);
  brimGeo.rotateZ(Math.PI / 2);
  const brim = new THREE.Mesh(brimGeo, camoMat);
  brim.position.set(0.068, 0, -0.057);
  gear.add(brim);
  gear.traverse(m => { if (m.isMesh) m.castShadow = true; });
  scene.add(gear);
  if (headBone) headGearPairs.push({ gear, bone: headBone });
}

async function attachProp(root, file, connKind) {
  let conn = null;
  root.traverse(o => {
    const nm = (o.name || '').toUpperCase();
    if (connKind === 'HAT' && nm.includes('HAT') && nm.includes('CONNECTOR')) conn = o;
    if (connKind === 'FACE' && nm.includes('FACE') && nm.includes('CONNECTOR')) conn = o;
  });
  if (!conn) return;
  const prop = await loader.loadAsync('models/props/' + file);
  prop.scene.traverse(m => { if (m.isMesh) m.castShadow = true; });
  conn.add(prop.scene);
}

async function buildEnemy(x, texture, gearKind, props) {
  const foe = await loader.loadAsync('models/enemy/IraqInfantry01_Sandy.glb');
  prepHero(foe.scene);
  const tex = await texLoader.loadAsync(texture);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = MAX_ANISO;
  foe.scene.traverse(o => {
    if (o.isMesh && o.name === 'NEWSKIN') {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(m => { if (m.map) { m.map = tex; m.needsUpdate = true; } });
    }
  });
  foe.scene.position.set(x, 0, 0);
  scene.add(foe.scene);
  const ak = await loader.loadAsync('models/enemy/Rifle05_AK47.glb');
  let conn = null;
  foe.scene.traverse(o => { if (o.name && o.name.toUpperCase().includes('GUNR')) conn = o; });
  if (conn) conn.add(ak.scene);
  if (gearKind === 'helmet') buildHelmetGear(foe.scene);
  for (const p of (props || [])) await attachProp(foe.scene, p[0], p[1]);
  if (gearKind === 'turban') buildTurbanGear(foe.scene);
  const mixer = new THREE.AnimationMixer(foe.scene);
  const idle = THREE.AnimationClip.findByName(foe.animations, 'IDLE_LOOK_AROUND_WITH_GUN');
  if (idle) mixer.clipAction(idle).play();
  mixers.push(mixer);
}

const gearCacheR = {};
async function attachGearR(obj, memberIdx) {
  for (const file of [...new Set(BD.GEAR[memberIdx].map(g => g[1]))])
    if (!gearCacheR[file]) gearCacheR[file] = (await loader.loadAsync('models/gear/' + file + '.glb')).scene;
  const conns = {};
  obj.traverse(o => {
    const nm = (o.name || '').toUpperCase();
    if (!nm.includes('CONNECTOR')) return;
    for (const tok of ['SPINE2L', 'SPINE2R', 'SPINE1', 'SPINE2', 'HAT', 'FACE', 'HIPL', 'HIPR'])
      if (nm.includes(tok)) { conns[tok] = o; break; }
  });
  for (const [tok, file] of BD.GEAR[memberIdx]) {
    const conn = conns[tok], tpl = gearCacheR[file];
    if (!conn || !tpl) continue;
    const c = tpl.clone(true);
    c.traverse(m => {
      if (m.isMesh) {
        m.castShadow = true;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        mats.forEach(mt => { if (mt.color) { const cl = mt.clone(); cl.color.set(0x9aa183); m.material = cl; } });
      }
    });
    conn.add(c);
  }
}

async function buildHero2(x, model, texUrl, memberIdx) {
  const hero = await loader.loadAsync(model);
  prepHero(hero.scene);
  const tex = await texLoader.loadAsync(texUrl);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = MAX_ANISO;
  hero.scene.traverse(o => {
    if (o.isMesh && o.name === 'NEWSKIN') {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(m => { if (m.map) { m.map = tex; m.needsUpdate = true; } });
    }
  });
  hero.scene.position.set(x, 0, 0);
  scene.add(hero.scene);
  const wdef = [BD.WEAPONS.M16A2, BD.WEAPONS.SAW, BD.WEAPONS.M16A2, BD.WEAPONS.BARRETT][memberIdx];
  const rifle = await loader.loadAsync(wdef.model);
  let conn = null;
  hero.scene.traverse(o => { if (o.name && o.name.toUpperCase().includes('GUNR')) conn = o; });
  if (conn) conn.add(rifle.scene);
  await attachGearR(hero.scene, memberIdx);
  const mixer = new THREE.AnimationMixer(hero.scene);
  const idle = THREE.AnimationClip.findByName(hero.animations, 'IDLE_LOOK_AROUND_WITH_GUN');
  if (idle) mixer.clipAction(idle).play();
  mixers.push(mixer);
}

async function load() {
  try {
    const tower = await loader.loadAsync('models/GuardTower.glb');
    tower.scene.position.set(0.5, 0, -6.5);
    tower.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(tower.scene);
    await buildSoldier(-7, false);
    await buildSoldier(-5, true);
    await buildHero2(-3, 'models/play/Hero02_Ramirez.glb', 'textures/Hero02_DZ_01.png?v=9', 1);
    await buildHero2(-1, 'models/play/Hero03_Jones.glb', 'textures/Hero03_DZ_01.png?v=2', 2);
    await buildHero2(1, 'models/play/Hero04_Foley.glb', 'textures/Hero04_DZ_01.png?v=2', 3);
    await buildEnemy(3, 'textures/Insurgent_F1.png?v=1', null, [['IR_Moustache01.glb', 'FACE']]);
    await buildEnemy(5, 'textures/Insurgent_Officer.png?v=1', null, [['IR_Beard01.glb', 'FACE'], ['IR_Beret_Black.glb', 'HAT']]);
    await buildEnemy(7, 'textures/Insurgent_Mechanic.png?v=1', null, [['IR_Beard02.glb', 'FACE'], ['IR_Shemagh04_Sandy.glb', 'HAT']]);
    window.__dzLoaded = true;
    document.getElementById('stats').innerHTML =
      '✔ The four men wear their ConnObjs.txt kit — caps/hats, backpacks, belt ' +
      'pouches — plugged into the same connectors the game uses, with their role weapons<br>' +
      '✔ Enemies: the black-attire insurgent with the game\'s own faces, beards, ' +
      'shemaghs and berets (15-type roster in game) — orbit right up to them and judge the look';
  } catch (err) {
    document.getElementById('err').textContent = '⚠ Load failed: ' + err.message;
  }
}
load();

const clock = new THREE.Clock();
const _hgP = new THREE.Vector3(), _hgQ = new THREE.Quaternion();
function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  mixers.forEach(m => m.update(dt));
  headGearPairs.forEach(({ gear, bone }) => {
    bone.getWorldPosition(_hgP);
    bone.getWorldQuaternion(_hgQ);
    gear.position.copy(_hgP);
    gear.quaternion.copy(_hgQ);
  });
  controls.update();
  renderer.render(scene, camera);
}
animate();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
