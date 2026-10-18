import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Asset fidelity test: the REAL Hero01_Armstrong and GuardTower models,
// converted from FrontEnd/Hero01_Armstrong.evo and Mission1/GuardTower.evo.

const container = document.getElementById('view');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a2027);
scene.fog = new THREE.Fog(0x1a2027, 30, 90);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 300);
camera.position.set(6.5, 3.6, 8.5);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.4, 0);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xdfeaff, 0x54482e, 1.0));
const sun = new THREE.DirectionalLight(0xffe2b0, 1.8);
sun.position.set(8, 14, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);
const fill = new THREE.DirectionalLight(0xbcd2ff, 0.35);
fill.position.set(-6, 4, -8);
scene.add(fill);

// display ground
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(16, 48),
  new THREE.MeshStandardMaterial({ color: 0x8a7648, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.PolarGridHelper(16, 12, 8, 48, 0x5a5240, 0x3d382b);
grid.position.y = 0.01;
scene.add(grid);

const stage = new THREE.Group();
scene.add(stage);

const loader = new GLTFLoader();
const loaded = {};
let triangles = 0;
let mixer = null, animClips = [], currentAction = null;

function playAnim(name) {
  document.querySelectorAll('#animrow button').forEach(b =>
    b.classList.toggle('on', b.dataset.anim === name));
  if (!mixer) return;
  if (currentAction) { currentAction.fadeOut(0.2); currentAction = null; }
  if (!name) return; // T-pose
  const clip = THREE.AnimationClip.findByName(animClips, name);
  if (!clip) return;
  currentAction = mixer.clipAction(clip);
  currentAction.reset().fadeIn(0.2).play();
}
document.querySelectorAll('#animrow button').forEach(b =>
  b.addEventListener('click', () => playAnim(b.dataset.anim)));

function place(model, x, z) {
  model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  model.position.set(x, 0, z);
  stage.add(model);
  model.traverse(o => {
    if (o.isMesh) triangles += o.geometry.index
      ? o.geometry.index.count / 3
      : o.geometry.attributes.position.count / 3;
  });
}

async function load() {
  const stats = document.getElementById('stats');
  try {
    const hero = await loader.loadAsync('models/Hero01_Armstrong_anim.glb');
    loaded.hero = hero.scene;
    place(hero.scene, -1.6, 0);
    animClips = hero.animations || [];
    if (animClips.length) {
      mixer = new THREE.AnimationMixer(hero.scene);
      playAnim('IDLE_LOOK_AROUND_WITH_GUN');
    }
    const tower = await loader.loadAsync('models/GuardTower.glb');
    loaded.tower = tower.scene;
    place(tower.scene, 2.8, -1);
    window.__modelsLoaded = true;
    stats.innerHTML =
      '✔ <b>Hero01_Armstrong</b> — original character, skinned mesh, ' +
      'textures Hero01_UK_01 + bump map embedded, playing his original .prb animations<br>' +
      '✔ <b>GuardTower</b> — original environment piece, 10 materials/textures<br>' +
      'Total triangles rendered: ~' + Math.round(triangles).toLocaleString() +
      ' (authentic 2002 polycounts)<br>' +
      'Source: <code>FrontEnd/Hero01_Armstrong.evo</code>, <code>Mission1/GuardTower.evo</code>';
  } catch (err) {
    document.getElementById('err').textContent = '⚠ Model load failed: ' + err.message;
  }
}
load();

// camera focus buttons
function focus(target, dist, height) {
  controls.target.copy(target);
  const dir = camera.position.clone().sub(controls.target).normalize();
  camera.position.copy(target).add(dir.multiplyScalar(dist));
  camera.position.y = height;
}
const btns = { both: document.getElementById('btnBoth'), hero: document.getElementById('btnHero'), tower: document.getElementById('btnTower') };
function setActive(b) { Object.values(btns).forEach(x => x.classList.remove('on')); b.classList.add('on'); }
btns.both.addEventListener('click', () => { setActive(btns.both); focus(new THREE.Vector3(0.5, 1.4, 0), 11, 3.6); });
btns.hero.addEventListener('click', () => { setActive(btns.hero); focus(new THREE.Vector3(-1.6, 1.1, 0), 3.4, 1.5); });
btns.tower.addEventListener('click', () => { setActive(btns.tower); focus(new THREE.Vector3(2.8, 2.6, -1), 9, 4); });

let spin = true, wire = false;
const btnSpin = document.getElementById('btnSpin'), btnWire = document.getElementById('btnWire');
btnSpin.addEventListener('click', () => { spin = !spin; btnSpin.classList.toggle('on', spin); });
btnWire.addEventListener('click', () => {
  wire = !wire; btnWire.classList.toggle('on', wire);
  stage.traverse(o => { if (o.isMesh) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => m.wireframe = wire); } });
});

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  if (mixer) mixer.update(dt);
  if (spin) stage.rotation.y += dt * 0.35;
  controls.update();
  renderer.render(scene, camera);
}
animate();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
