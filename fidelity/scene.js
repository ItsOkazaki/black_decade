import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// REAL SCENE TEST — every asset converted from the original archives:
// hero + rifle (attached at the game's own Bip01 GunR Connector),
// Mission 1 environment pieces, original M16A2 sounds from mission1.sch.

const container = document.getElementById('view');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2118);
scene.fog = new THREE.Fog(0x2a2118, 35, 110);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 300);
camera.position.set(5.5, 2.8, 8);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.2, 0.5);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xdfeaff, 0x54482e, 1.0));
const sun = new THREE.DirectionalLight(0xffe2b0, 1.9);
sun.position.set(10, 16, 7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -18; sun.shadow.camera.right = 18;
sun.shadow.camera.top = 18; sun.shadow.camera.bottom = -18;
scene.add(sun);
const fill = new THREE.DirectionalLight(0xbcd2ff, 0.35);
fill.position.set(-6, 4, -8);
scene.add(fill);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(34, 48),
  new THREE.MeshStandardMaterial({ color: 0x9a7f4e, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const loader = new GLTFLoader();
let mixer = null, animClips = [], currentAction = null;
let flash = null;
let gunConnector = null, rifleObj = null, rifleLObj = null;
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();

// Two-handed grip: the rifle's origin stays pinned at the right hand's
// GunR connector; each frame we rotate it the few degrees needed for the
// barrel line to pass through the left hand's RifleL connector point —
// the alignment the original engine's hand IK produced.
function alignRifle() {
  if (!gunConnector || !rifleObj || !rifleLObj) return;
  gunConnector.getWorldPosition(_v1);
  rifleLObj.getWorldPosition(_v2);
  _v2.y += 0.02; // hand sits a touch lower on the fore-end (user-tuned)
  _v2.sub(_v1).normalize();                                    // desired barrel dir
  rifleObj.getWorldQuaternion(_q1);
  _v3.set(0, 1, 0).applyQuaternion(_q1);                       // current barrel dir
  _q2.setFromUnitVectors(_v3, _v2);                            // world-space correction
  gunConnector.getWorldQuaternion(_q1);
  _q2.premultiply(_q1.clone().invert()).multiply(_q1);         // -> connector space
  rifleObj.quaternion.premultiply(_q2);
}

async function addModel(path, x, z, rotY = 0) {
  const g = await loader.loadAsync(path);
  g.scene.position.set(x, 0, z);
  g.scene.rotation.y = rotY;
  g.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  scene.add(g.scene);
  return g;
}

let currentAnimName = 'IDLE_LOOK_AROUND_WITH_GUN';
function playAnim(name) {
  currentAnimName = name;
  document.querySelectorAll('#animrow button').forEach(b =>
    b.classList.toggle('on', b.dataset.anim === name));
  if (!mixer) return;
  if (currentAction) currentAction.fadeOut(0.2);
  const clip = THREE.AnimationClip.findByName(animClips, name);
  if (!clip) return;
  currentAction = mixer.clipAction(clip);
  currentAction.reset().fadeIn(0.2).play();
}
document.querySelectorAll('#animrow button').forEach(b =>
  b.addEventListener('click', () => playAnim(b.dataset.anim)));

async function load() {
  const stats = document.getElementById('stats');
  try {
    // environment corner (Mission1 originals)
    await addModel('models/GuardTower.glb', -8, -5, 0.5);
    await addModel('models/scene/Mission1_GuardHouse_Exterior.glb', 7.5, -7, -0.4);
    await addModel('models/scene/M3_Tent01.glb', -3.5, -10, 0.9);
    await addModel('models/scene/SandBags2_High_Corner.glb', -3.1, 1.6, 0.8);
    await addModel('models/scene/Crate2.glb', 2.6, 0.2, 0.3);
    await addModel('models/scene/Crate2.glb', 2.6, 1.35, -0.2);
    await addModel('models/scene/Crate2.glb', 3.9, 0.75, 0.7);
    await addModel('models/scene/Dyn_Barrel1_Static.glb', -4.2, -1.5, 0);
    await addModel('models/scene/Dyn_Barrel1_Static.glb', -3.6, -2.2, 0);

    // hero with connector helpers: hide every helper proxy mesh except the real skin
    const hero = await loader.loadAsync('models/scene/Hero01_Armstrong.glb');
    hero.scene.position.set(0, 0, 1.5);
    hero.scene.rotation.y = 0.35;
    hero.scene.traverse(o => {
      if (o.isMesh) {
        if (o.name === 'NEWSKIN') { o.castShadow = true; o.receiveShadow = true; }
        else {
          // Hide helper proxy geometry via its MATERIAL, not object.visible:
          // connector nodes are meshes too, and visible=false on a parent
          // would hide the rifle attached underneath it.
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach(m => { const c = m.clone(); c.visible = false; o.material = c; });
        }
      }
    });
    scene.add(hero.scene);
    animClips = hero.animations || [];
    mixer = new THREE.AnimationMixer(hero.scene);

    // rifle on the game's own connector (WEAPS.TXT: 'Bip01 GunR Connector';
    // GLTFLoader sanitises node names, spaces become underscores)
    const rifle = await loader.loadAsync('models/scene/Rifle02_M16wM203.glb');
    let connector = null;
    hero.scene.traverse(o => { if (o.name && o.name.toUpperCase().includes('GUNR')) connector = o; });
    if (connector) {
      connector.add(rifle.scene);
      rifle.scene.traverse(o => { if (o.isMesh) o.castShadow = true; });
      gunConnector = connector;
      rifleObj = rifle.scene;
      hero.scene.traverse(o => { if (o.name && o.name.toUpperCase().includes('RIFLEL')) rifleLObj = o; });
    } else {
      document.getElementById('err').textContent = '⚠ Gun connector not found — rifle not attached.';
    }
    // muzzle flash light at scene level (toggled on fire)
    flash = new THREE.PointLight(0xffc266, 0, 9);
    flash.position.set(0.4, 1.45, 3.2);
    scene.add(flash);

    playAnim('UPRIGHT_AIM_RIFLE');
    window.__sceneLoaded = true;
    stats.innerHTML =
      '✔ Armstrong + Rifle02_M16wM203 at <code>Bip01 GunR Connector</code>, fore-end aligned each frame to his left hand\'s <code>RifleL</code> point (two-handed grip)<br>' +
      '✔ Guard tower, guard house, tent, sandbag corner, crates, barrels — all Mission1 originals<br>' +
      '✔ Animations: aim / idle / crouch-walk / prone from original .prb files<br>' +
      '✔ FIRE plays the original M16A2 samples from mission1.sch';
  } catch (err) {
    document.getElementById('err').textContent = '⚠ Scene load failed: ' + err.message;
  }
}
load();

// ---- firing: the original shot samples only. The bank's other two samples
// (click = weapon mechanism/reload click, tail = distant-fire echo) are NOT
// layered onto the player's own shot. ----
const shotAudio = ['sounds/M16A2_shot1.wav', 'sounds/M16A2_shot2.wav'].map(s => {
  const a = new Audio(s); a.preload = 'auto'; return a;
});
let si = 0, flashT = 0;
document.getElementById('btnFire').addEventListener('click', () => {
  const a = shotAudio[si++ % shotAudio.length];
  a.currentTime = 0;
  a.play().catch(() => {});
  if (flash) { flash.intensity = 60; flashT = 0.06; }
});

// ---- turntable ----
let spin = false;
const btnSpin = document.getElementById('btnSpin');
btnSpin.addEventListener('click', () => { spin = !spin; btnSpin.classList.toggle('on', spin); });

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  if (mixer) mixer.update(dt);
  if (currentAnimName !== 'IDLE_LOOK_AROUND_WITH_GUN') alignRifle(); // idle = one-hand carry pose
  if (flashT > 0) { flashT -= dt; if (flashT <= 0 && flash) flash.intensity = 0; }
  if (spin) {
    const t = controls.target;
    const dx = camera.position.x - t.x, dz = camera.position.z - t.z;
    const c = Math.cos(dt * 0.4), s = Math.sin(dt * 0.4);
    camera.position.x = t.x + dx * c - dz * s;
    camera.position.z = t.z + dx * s + dz * c;
  }
  controls.update();
  renderer.render(scene, camera);
}
animate();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
