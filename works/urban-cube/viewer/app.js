import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createMetroWorld } from './metro_world.js?v=20261127-4';

const container = document.getElementById('canvas-container');
const labelsLayer = document.getElementById('labels-layer');
const sidebarEl = document.getElementById('sidebar');
const hudEl = document.getElementById('strata-hud');
const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
const btnToggleHud = document.getElementById('btn-toggle-hud');

// ---- Three.js シーン構築 ----
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050b18);
scene.fog = new THREE.FogExp2(0x060d1c, 0.0020);

const camera = new THREE.PerspectiveCamera(
  40,
  Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight),
  1.0,
  4500
);
camera.position.set(340, 175, 420);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true,
  powerPreference: 'high-performance',
});
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.0));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
container.appendChild(renderer.domElement);

const pmremGen = new THREE.PMREMGenerator(renderer);
scene.environment = pmremGen.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.42;
pmremGen.dispose();

// 選択的ポストプロセス（UnrealBloomPass — 光のマスタープラン夜景演出！フォールバック安全設計）
let composer = null;
let bloomPass = null;
async function setupPostProcessing() {
  try {
    const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
      import('three/addons/postprocessing/EffectComposer.js'),
      import('three/addons/postprocessing/RenderPass.js'),
      import('three/addons/postprocessing/UnrealBloomPass.js'),
      import('three/addons/postprocessing/OutputPass.js'),
    ]);
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    composer = new EffectComposer(renderer);
    composer.setPixelRatio(Math.min(window.devicePixelRatio, 2.0));
    composer.setSize(w, h);
    composer.addPass(new RenderPass(scene, camera));
    bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.20, 0.36, 0.94);
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
  } catch (e) {
    console.info('Postprocessing fallback to standard renderer:', e?.message || e);
    composer = null;
    bloomPass = null;
  }
}

function renderFrame() {
  if (composer && state.theme !== 'day') {
    composer.render();
  } else {
    renderer.render(scene, camera);
  }
}

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.maxPolarAngle = Math.PI * 0.84;
controls.maxDistance = 1480;
controls.minDistance = 16;
controls.target.set(20, 10.0, -30.0);
controls.update();

// ---- 3段グラデーション＆太陽散乱グロー・スカイドーム（1.8km超広域対応・半径2800m！） ----
const skyGeo = new THREE.SphereGeometry(2800, 40, 28);
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  uniforms: {
    uTop: { value: new THREE.Color(0x030712) },
    uMid: { value: new THREE.Color(0x0c1e3c) },
    uHorizon: { value: new THREE.Color(0x162d50) },
    uBottom: { value: new THREE.Color(0x040814) },
    uSunDir: { value: new THREE.Vector3(-0.5, 0.25, -0.8).normalize() },
    uSunColor: { value: new THREE.Color(0x38bdf8) },
    uSunGlow: { value: 0.14 },
  },
  vertexShader: `
    varying vec3 vWorldPos;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: `
    uniform vec3 uTop;
    uniform vec3 uMid;
    uniform vec3 uHorizon;
    uniform vec3 uBottom;
    uniform vec3 uSunDir;
    uniform vec3 uSunColor;
    uniform float uSunGlow;
    varying vec3 vWorldPos;
    void main() {
      vec3 dir = normalize(vWorldPos);
      float h = dir.y;
      vec3 col;
      if (h >= 0.0) {
        float t1 = smoothstep(0.0, 0.22, h);
        float t2 = smoothstep(0.14, 0.72, h);
        col = mix(uHorizon, uMid, t1);
        col = mix(col, uTop, t2);
      } else {
        col = mix(uHorizon, uBottom, pow(clamp(-h * 2.2, 0.0, 1.0), 0.65));
      }
      float sunAmt = max(dot(dir, normalize(uSunDir)), 0.0);
      col += uSunColor * (pow(sunAmt, 6.0) * uSunGlow + pow(sunAmt, 42.0) * uSunGlow * 1.4);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
});
const skyDome = new THREE.Mesh(skyGeo, skyMat);
scene.add(skyDome);

// ---- ライティング（3テーマ対応・ソフトシャドウ4096px） ----
const hemiLight = new THREE.HemisphereLight(0x88b8f0, 0x1e293b, 0.72);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(0xfff4e2, 1.65);
sunLight.position.set(88, 128, 92);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(4096, 4096);
sunLight.shadow.camera.left = -95;
sunLight.shadow.camera.right = 95;
sunLight.shadow.camera.top = 95;
sunLight.shadow.camera.bottom = -95;
sunLight.shadow.camera.near = 20;
sunLight.shadow.camera.far = 360;
sunLight.shadow.bias = -0.00035;
sunLight.shadow.normalBias = 0.04;
scene.add(sunLight);

const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.88);
rimLight.position.set(-100, 18, -88);
scene.add(rimLight);

const fillLight = new THREE.DirectionalLight(0xf59e0b, 0.25);
fillLight.position.set(70, -15, 85);
scene.add(fillLight);

// 展示スタジオの繊細な床グリッド（キューブ台座下 Y = -45.85）
const floorGrid = new THREE.GridHelper(280, 56, 0x1e3a5f, 0x0e192d);
floorGrid.position.y = -45.85;
scene.add(floorGrid);

// 水面用プロシージャル波紋ノーマルマップ
function createWaterNormalTexture() {
  const sz = 256;
  const data = new Uint8Array(sz * sz * 4);
  for (let y = 0; y < sz; y++) {
    for (let x = 0; x < sz; x++) {
      const u = (x / sz) * Math.PI * 2;
      const v = (y / sz) * Math.PI * 2;
      const dx = Math.cos(u * 4 + v * 2) * 0.45 + Math.cos(u * 9 - v * 5) * 0.25;
      const dy = Math.sin(v * 5 + u * 3) * 0.45 + Math.sin(v * 8 + u * 6) * 0.25;
      const idx = (y * sz + x) * 4;
      data[idx] = Math.round((dx * 0.5 + 0.5) * 255);
      data[idx + 1] = Math.round((dy * 0.5 + 0.5) * 255);
      data[idx + 2] = 240;
      data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, sz, sz, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(14, 3);
  tex.needsUpdate = true;
  return tex;
}
const waterNormalTex = createWaterNormalTexture();

// ---- シーン構造＆アニメーション状態 ----
const rootGroup = new THREE.Group();
scene.add(rootGroup);

const layerGroups = {
  l1: new THREE.Group(),
  l2: new THREE.Group(),
  l3: new THREE.Group(),
  l4: new THREE.Group(),
  l5: new THREE.Group(),
};
Object.values(layerGroups).forEach((g) => rootGroup.add(g));

const EXPLODE_OFFSETS = { l1: 56.0, l2: 36.0, l3: 20.0, l4: 10.0, l5: 0.5 };

const animGroups = {
  carHi1: new THREE.Group(),
  carHi2: new THREE.Group(),
  carHi3: new THREE.Group(),
  carHi4: new THREE.Group(),
  carLo1: new THREE.Group(),
  carLo2: new THREE.Group(),
  carLo3: new THREE.Group(),
  carLo4: new THREE.Group(),
  lrt1: new THREE.Group(),
  lrt2: new THREE.Group(),
  trainShallow1: new THREE.Group(),
  trainShallow2: new THREE.Group(),
  trainDeep: new THREE.Group(),
  tbmCutter: new THREE.Group(),
};
layerGroups.l1.add(animGroups.carHi1, animGroups.carHi2, animGroups.carHi3, animGroups.carHi4);
layerGroups.l2.add(animGroups.carLo1, animGroups.carLo2, animGroups.carLo3, animGroups.carLo4, animGroups.lrt1, animGroups.lrt2);
layerGroups.l4.add(animGroups.trainShallow1, animGroups.trainShallow2);
layerGroups.l5.add(animGroups.trainDeep, animGroups.tbmCutter);

// TBM カッターヘッド基準座標（南線シールド先端 X=+25.38, Y=-26.5, Z=+14.0）
animGroups.tbmCutter.position.set(25.38, -26.5, 14.0);

const soilWalls = {
  front: [], // +X, +Z（手前2面）
  back: [],  // -X, -Z（奥2面）
};
const buildingEmissiveMats = [];
const waterMeshes = [];

const state = {
  meta: null,
  theme: 'night',
  worldScale: 'full', // 'full' (1km完全シームレス・透けゼロ) | 'wide_xray' (1km広域地下X-Ray) | 'hybrid' (中心地下ピット) | 'core' (96mコア単体)
  explode: 0.0,
  soilFrontOpacity: 1.0,
  soilBackOpacity: 1.0,
  showLabels: true,
  autoRotate: false,
  autoDemo: false,
  paused: false,
  manualRender: false,
  demoClock: 0.0,
  simTime: 0.0,
  sidebarOpen: window.innerWidth > 960,
  hudOpen: window.innerWidth > 960,
  hudTab: 'strata',
  layerVisible: { l1: true, l2: true, l3: true, l4: true, l5: true },
};

let metroWorld = null;

const CAMERA_PRESETS = {
  metro: { pos: [315, 165, 365], target: [10, 8.0, -15.0] },
  wide_ug: { pos: [305, 112, 320], target: [-10, -18.0, -25.0] },
  cafe: { pos: [-18.0, 3.6, 24.4], target: [-18.0, 2.6, 4.0] },
  hub: { pos: [-108, 82, 108], target: [-135, 14.0, -80.0] },
  bay: { pos: [410, 112, 505], target: [175, 18.0, 190.0] },
  iso: { pos: [126, 62, 132], target: [0, -3.0, 2.0] },
  walkable: { pos: [54, 18, 56], target: [-6.0, 11.0, -10.0] },
  waterfront: { pos: [76, 22, 86], target: [16.0, -6.0, 24.0] },
  subway: { pos: [34, -6.5, 24], target: [1.0, -12.0, 2.0] },
  tbm: { pos: [58, -16.5, 42], target: [22.0, -26.5, 14.0] },
  flood: { pos: [48, -22.0, 82], target: [14.0, -32.0, 34.0] },
  exploded: { pos: [176, 74, 182], target: [0, 16.0, 0] },
  lifeline: { pos: [66, 6.0, 56], target: [8.0, -4.0, 14.0] },
  low: { pos: [88, -32.0, 96], target: [0, -18.0, 0] },
};

const LABEL_CAM_MAP = {
  METRO_STATION: 'hub',
  METRO_JCT: 'hub',
  METRO_BRIDGE: 'bay',
  METRO_ARCH: 'bay',
  METRO_PARK: 'wide_ug',
  METRO_UG_HUB: 'wide_ug',
  METRO_UG_PUMP: 'wide_ug',
  VIADUCT: 'iso',
  TOWER: 'walkable',
  CAFE_FLOWER: 'cafe',
  PEDDECK: 'walkable',
  LRT: 'walkable',
  WATERFRONT: 'waterfront',
  RAIN_TANK: 'waterfront',
  CULVERT: 'lifeline',
  SUBWAY: 'subway',
  PILES: 'low',
  TBM: 'tbm',
  FLOOD: 'flood',
};

const MACRO_LABELS = [
  { id: 'METRO_STATION', layer: 2, macroOnly: true, text: '東京型ターミナル駅 ＆ 新幹線（左側通行）', pos: [0, 36, -175] },
  { id: 'METRO_JCT', layer: 1, macroOnly: true, text: '首都高スタイル曲線JCT ＆ 緑案内標識', pos: [-215, 32, -18] },
  { id: 'METRO_BRIDGE', layer: 2, macroOnly: true, text: '東京港 2層トラス補剛吊り橋（主塔78m）', pos: [215, 82, 332] },
  { id: 'METRO_ARCH', layer: 2, macroOnly: true, text: '隅田川スタイル ニールセンアーチ鋼橋', pos: [272, 42, -18] },
  { id: 'METRO_PARK', layer: 2, macroOnly: true, text: '広域都市公園 ＆ 多目的遊水地（地下取水立坑）', pos: [-258, 18, 156] },
  { id: 'METRO_UG_HUB', layer: 4, macroOnly: true, ugOnly: true, text: '広域地下：ターミナル多層地下駅・地下街 (-12m)', pos: [0, -10, -175] },
  { id: 'METRO_UG_PUMP', layer: 5, macroOnly: true, ugOnly: true, text: '広域地下：隅田川排水機場・大深度放流立坑 (-37m)', pos: [212, -22, 14] },
];

function isMobileViewport() {
  return window.innerWidth <= 960;
}

function setSidebarOpen(open) {
  state.sidebarOpen = !!open;
  if (state.sidebarOpen && isMobileViewport() && state.hudOpen) {
    state.hudOpen = false;
    hudEl.classList.add('is-collapsed');
    btnToggleHud.classList.remove('is-hidden');
    btnToggleHud.setAttribute('aria-expanded', 'false');
  }
  sidebarEl.classList.toggle('is-collapsed', !state.sidebarOpen);
  btnToggleSidebar.classList.toggle('is-hidden', state.sidebarOpen);
  btnToggleSidebar.setAttribute('aria-expanded', String(state.sidebarOpen));
}

function setHudOpen(open) {
  state.hudOpen = !!open;
  if (state.hudOpen && isMobileViewport() && state.sidebarOpen) {
    state.sidebarOpen = false;
    sidebarEl.classList.add('is-collapsed');
    btnToggleSidebar.classList.remove('is-hidden');
    btnToggleSidebar.setAttribute('aria-expanded', 'false');
  }
  hudEl.classList.toggle('is-collapsed', !state.hudOpen);
  btnToggleHud.classList.toggle('is-hidden', state.hudOpen);
  btnToggleHud.setAttribute('aria-expanded', String(state.hudOpen));
}

function setHudTab(tab) {
  state.hudTab = tab;
  document.querySelectorAll('.hud-tab').forEach((b) => {
    const active = b.dataset.tab === tab;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', String(active));
  });
  document.getElementById('tab-strata').classList.toggle('active', tab === 'strata');
  document.getElementById('tab-policy').classList.toggle('active', tab === 'policy');
  document.getElementById('hud-tag').textContent = tab === 'strata' ? 'GL 0〜-44m' : 'MLIT 2030';
}

let camAnim = null;
function moveCameraTo(key) {
  const p = CAMERA_PRESETS[key];
  if (!p) return;
  camAnim = {
    startPos: camera.position.clone(),
    endPos: new THREE.Vector3(...p.pos),
    startTarget: controls.target.clone(),
    endTarget: new THREE.Vector3(...p.target),
    t: 0,
  };
  document.querySelectorAll('#camera-presets button').forEach((b) => b.classList.toggle('active', b.dataset.cam === key));
}

// ---- 3テーマ適用（ナイト・アーバン / トワイライト夕景 / デイライト模型） ----
const THEME_CYCLE = ['night', 'twilight', 'day'];
function setWorldScale(scaleMode) {
  state.worldScale = scaleMode;
  document.querySelectorAll('.scale-pill').forEach((b) => b.classList.toggle('active', b.dataset.scale === scaleMode));
  if (metroWorld) metroWorld.setWorldScale(scaleMode);
  const isMacro = scaleMode !== 'core';
  floorGrid.visible = !isMacro && state.theme !== 'day';
  // フォグ密度をスケールに応じて最適化（1.8km先の斜張橋・超高層群が美しく見える空気遠近！）
  if (state.theme === 'night') scene.fog.density = isMacro ? 0.00046 : 0.0014;
  else if (state.theme === 'twilight') scene.fog.density = isMacro ? 0.00042 : 0.0011;
  else scene.fog.density = isMacro ? 0.00032 : 0.0009;
  updateDisplay();
}

function applyTheme(theme) {
  const th = THEME_CYCLE.includes(theme) ? theme : 'night';
  state.theme = th;
  document.body.classList.remove('theme-night', 'theme-twilight', 'theme-day');
  document.body.classList.add(`theme-${th}`);

  document.querySelectorAll('.theme-pill').forEach((b) => b.classList.toggle('active', b.dataset.theme === th));
  const btn = document.getElementById('btn-theme');

  if (th === 'night') {
    skyMat.uniforms.uTop.value.setHex(0x030712);
    skyMat.uniforms.uMid.value.setHex(0x09162c);
    skyMat.uniforms.uHorizon.value.setHex(0x132644);
    skyMat.uniforms.uBottom.value.setHex(0x050b18);
    skyMat.uniforms.uSunDir.value.set(-0.55, 0.16, -0.82).normalize();
    skyMat.uniforms.uSunColor.value.setHex(0x2890c8);
    skyMat.uniforms.uSunGlow.value = 0.05;
    scene.background.setHex(0x050b18);
    scene.fog.color.setHex(0x091428);
    scene.fog.density = 0.0014;
    hemiLight.color.setHex(0x88b8f0);
    hemiLight.groundColor.setHex(0x1b263b);
    hemiLight.intensity = 0.72;
    sunLight.color.setHex(0xe8f0ff);
    sunLight.position.set(88, 128, 92);
    sunLight.intensity = 1.48;
    rimLight.color.setHex(0x38bdf8);
    rimLight.intensity = 0.92;
    fillLight.color.setHex(0xf59e0b);
    fillLight.intensity = 0.28;
    scene.environmentIntensity = 0.44;
    renderer.toneMappingExposure = 1.06;
    floorGrid.visible = true;
    if (bloomPass) { bloomPass.strength = 0.20; bloomPass.threshold = 0.94; }
    for (const m of buildingEmissiveMats) m.emissiveIntensity = 0.96;
    btn.textContent = '🌃 ナイト';
  } else if (th === 'twilight') {
    skyMat.uniforms.uTop.value.setHex(0x0f1638);
    skyMat.uniforms.uMid.value.setHex(0x4c2d5c);
    skyMat.uniforms.uHorizon.value.setHex(0xe07b42);
    skyMat.uniforms.uBottom.value.setHex(0x151126);
    skyMat.uniforms.uSunDir.value.set(-0.65, 0.12, -0.75).normalize();
    skyMat.uniforms.uSunColor.value.setHex(0xffd280);
    skyMat.uniforms.uSunGlow.value = 0.42;
    scene.background.setHex(0x16142a);
    scene.fog.color.setHex(0x3a2645);
    scene.fog.density = 0.0011;
    hemiLight.color.setHex(0xffc99e);
    hemiLight.groundColor.setHex(0x282442);
    hemiLight.intensity = 0.80;
    sunLight.color.setHex(0xffb56b);
    sunLight.position.set(135, 58, 72);
    sunLight.intensity = 2.15;
    rimLight.color.setHex(0x6366f1);
    rimLight.intensity = 0.88;
    fillLight.color.setHex(0xf97316);
    fillLight.intensity = 0.34;
    scene.environmentIntensity = 0.52;
    renderer.toneMappingExposure = 1.04;
    floorGrid.visible = true;
    if (bloomPass) { bloomPass.strength = 0.18; bloomPass.threshold = 0.95; }
    for (const m of buildingEmissiveMats) m.emissiveIntensity = 0.78;
    btn.textContent = '🌇 夕景';
  } else {
    skyMat.uniforms.uTop.value.setHex(0x4f9ae0);
    skyMat.uniforms.uMid.value.setHex(0x9bc8ee);
    skyMat.uniforms.uHorizon.value.setHex(0xe8f2fa);
    skyMat.uniforms.uBottom.value.setHex(0xc8d8e8);
    skyMat.uniforms.uSunDir.value.set(0.55, 0.55, 0.62).normalize();
    skyMat.uniforms.uSunColor.value.setHex(0xfff7dd);
    skyMat.uniforms.uSunGlow.value = 0.25;
    scene.background.setHex(0xd6e6f4);
    scene.fog.color.setHex(0xdceaf6);
    scene.fog.density = 0.0009;
    hemiLight.color.setHex(0xf0f8ff);
    hemiLight.groundColor.setHex(0x8894a4);
    hemiLight.intensity = 1.08;
    sunLight.color.setHex(0xfff9ee);
    sunLight.position.set(95, 140, 88);
    sunLight.intensity = 2.20;
    rimLight.color.setHex(0x93c5fd);
    rimLight.intensity = 0.35;
    fillLight.color.setHex(0xffffff);
    fillLight.intensity = 0.14;
    scene.environmentIntensity = 0.65;
    renderer.toneMappingExposure = 1.02;
    floorGrid.visible = false;
    for (const m of buildingEmissiveMats) m.emissiveIntensity = 0.08;
    btn.textContent = '☀ デイ';
  }
  if (metroWorld) metroWorld.setTheme(th);
  const isMacro = state.worldScale !== 'core';
  floorGrid.visible = !isMacro && th !== 'day';
  if (th === 'night') scene.fog.density = isMacro ? 0.00046 : 0.0014;
  else if (th === 'twilight') scene.fog.density = isMacro ? 0.00042 : 0.0011;
  else scene.fog.density = isMacro ? 0.00032 : 0.0009;
}

// ---- 地層ウォール透明度 ＆ 5層 Exploded View 更新 ----
function updateDisplay() {
  const e = state.explode;
  const hideUnderground = state.worldScale === 'full' && e < 0.01;
  for (const k of ['l1', 'l2', 'l3', 'l4', 'l5']) {
    layerGroups[k].position.y = EXPLODE_OFFSETS[k] * e;
    const isUg = (k === 'l3' || k === 'l4' || k === 'l5');
    layerGroups[k].visible = state.layerVisible[k] && !(hideUnderground && isUg);
  }

  const explodeFade = Math.max(0.0, 1.0 - e * 2.4);
  const fOp = hideUnderground ? 0.0 : state.soilFrontOpacity * explodeFade;
  const bOp = hideUnderground ? 0.0 : state.soilBackOpacity * explodeFade;

  const setWallList = (list, op) => {
    const nextTransparent = op < 0.98;
    const nextDepthWrite = op >= 0.95;
    for (const m of list) {
      m.visible = op > 0.02;
      if (m.material) {
        if (m.material.transparent !== nextTransparent) {
          m.material.transparent = nextTransparent;
          m.material.needsUpdate = true;
        }
        m.material.opacity = op;
        m.material.depthWrite = nextDepthWrite;
      }
    }
  };
  setWallList(soilWalls.front, fOp);
  setWallList(soilWalls.back, bOp);
}

// ---- 稼働ギミック更新（100% 日本の「左側通行」統一：+X東行き=北側-Z, -X西行き=南側+Z, +Z南行き=東側+X, -Z北行き=西側-X！） ----
function updateAnimations(tSec) {
  const wrap = (val, span) => ((((val + span * 0.5) % span) + span) % span) - span * 0.5;
  const vz = -18.0;

  // 首都高 走行車 4台（左側通行！東行き+X＝北側 vz-1.35 / vz-3.45、西行き-X＝南側 vz+1.35 / vz+3.45）
  animGroups.carHi1.position.set(wrap(tSec * 14.5, 88.0), 10.44, vz - 1.35);
  animGroups.carHi1.rotation.y = 0;
  animGroups.carHi2.position.set(wrap(tSec * 17.0 + 38.0, 88.0), 10.44, vz - 3.45);
  animGroups.carHi2.rotation.y = 0;
  animGroups.carHi3.position.set(-wrap(tSec * 15.2 + 12.0, 88.0), 10.44, vz + 1.35);
  animGroups.carHi3.rotation.y = Math.PI;
  animGroups.carHi4.position.set(-wrap(tSec * 11.8 + 52.0, 88.0), 10.44, vz + 3.45);
  animGroups.carHi4.rotation.y = Math.PI;

  // 東西大通り 走行一般車 4台（左側通行！東行き+X＝北側 vz-4.15 / vz-2.05、西行き-X＝南側 vz+2.05 / vz+4.15）
  animGroups.carLo1.position.set(wrap(tSec * 6.5 - 12.0, 84.0), 0.0, vz - 4.15);
  animGroups.carLo1.rotation.y = 0;
  animGroups.carLo2.position.set(wrap(tSec * 8.2 + 26.0, 86.0), 0.0, vz - 2.05);
  animGroups.carLo2.rotation.y = 0;
  animGroups.carLo3.position.set(-wrap(tSec * 7.8 + 8.0, 86.0), 0.0, vz + 2.05);
  animGroups.carLo3.rotation.y = Math.PI;
  animGroups.carLo4.position.set(-wrap(tSec * 6.9 + 46.0, 86.0), 0.0, vz + 4.15);
  animGroups.carLo4.rotation.y = Math.PI;

  // 南北トランジットモール 超低床連接LRT 2編成（左側通行！南行き+Z＝東側+1.75、北行き-Z＝西側-1.75）
  animGroups.lrt1.position.set(1.75, 0.08, wrap(tSec * 6.2 + 10.0, 78.0));
  animGroups.lrt1.rotation.y = 0;
  animGroups.lrt2.position.set(-1.75, 0.08, -wrap(tSec * 5.8 + 34.0, 78.0));
  animGroups.lrt2.rotation.y = Math.PI;

  // 浅層 開削RC地下駅 2編成すれ違い走行（左側通行！南行き+Z＝東側+4.0、北行き-Z＝西側-4.0）
  animGroups.trainShallow1.position.set(4.0, -15.25, wrap(tSec * 7.4 + 6.0, 70.0));
  animGroups.trainShallow2.position.set(-4.0, -15.25, -wrap(tSec * 6.8 + 32.0, 70.0));

  // 大深度 北線シールド地下鉄（X方向高速走行・浅層地下鉄の下を立体交差）
  animGroups.trainDeep.position.set(wrap(tSec * 9.5 + 14.0, 68.0), -27.9, -5.5);

  // 稼働中シールドマシン TBM カッターヘッド回転
  animGroups.tbmCutter.rotation.x = tSec * 1.45;

  // 運河＆大深度調節池の水面波紋スクロール
  waterNormalTex.offset.set(tSec * 0.06, Math.sin(tSec * 0.4) * 0.03);
  if (metroWorld) metroWorld.update(tSec);
}

// ---- ワンクリック表示モード ----
function clearActiveModeBtn() {
  document.querySelectorAll('.mode-btn.active').forEach((b) => b.classList.remove('active'));
}

function setMode(mode) {
  document.querySelectorAll('.mode-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  if (mode === 'cutaway') {
    state.explode = 0.0;
    state.soilFrontOpacity = 0.22;
    state.soilBackOpacity = 0.96;
  } else if (mode === 'solid') {
    state.explode = 0.0;
    state.soilFrontOpacity = 1.0;
    state.soilBackOpacity = 1.0;
  } else if (mode === 'skeleton') {
    state.explode = 0.0;
    state.soilFrontOpacity = 0.0;
    state.soilBackOpacity = 0.0;
  } else if (mode === 'explode') {
    setWorldScale('core');
    state.explode = 0.88;
    state.soilFrontOpacity = 0.18;
    state.soilBackOpacity = 0.88;
    moveCameraTo('exploded');
  }
  syncSlidersFromState();
  updateDisplay();
}

function syncSlidersFromState() {
  document.getElementById('sl-explode').value = String(Math.round(state.explode * 100));
  document.getElementById('val-explode').textContent = `${Math.round(state.explode * 100)} %`;
  document.getElementById('sl-soil-front').value = String(Math.round(state.soilFrontOpacity * 100));
  document.getElementById('val-soil-front').textContent = `${Math.round(state.soilFrontOpacity * 100)} %`;
  document.getElementById('sl-soil-back').value = String(Math.round(state.soilBackOpacity * 100));
  document.getElementById('val-soil-back').textContent = `${Math.round(state.soilBackOpacity * 100)} %`;
}

// ---- 3D ラベル（重なり回避＆パネル領域クリップ） ----
const labelElems = [];
function buildLabels(meta) {
  labelsLayer.innerHTML = '';
  labelElems.length = 0;
  const allLabels = [...MACRO_LABELS, ...(meta.labels || [])];
  for (const lb of allLabels) {
    const el = document.createElement('div');
    el.className = 'label-3d';
    el.textContent = lb.text;
    const camKey = LABEL_CAM_MAP[lb.id] || 'iso';
    el.title = 'クリックで該当エリアへカメラ移動';
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      moveCameraTo(camKey);
    });
    labelsLayer.appendChild(el);
    labelElems.push({
      el,
      id: lb.id,
      layer: lb.layer,
      macroOnly: !!lb.macroOnly,
      ugOnly: !!lb.ugOnly,
      basePos: new THREE.Vector3(...lb.pos),
      w: 0,
      h: 0,
    });
  }
}

function rectsOverlap(a, b, pad = 0) {
  return !(a.right + pad < b.left || a.left - pad > b.right || a.bottom + pad < b.top || a.top - pad > b.bottom);
}

const _proj = new THREE.Vector3();
function updateLabels() {
  if (!state.showLabels) {
    labelsLayer.style.display = 'none';
    return;
  }
  labelsLayer.style.display = 'block';
  const w = container.clientWidth;
  const h = container.clientHeight;
  if (w <= 0 || h <= 0) return;

  const cRect = container.getBoundingClientRect();
  const blockedRects = [];
  if (state.sidebarOpen && sidebarEl) {
    const r = sidebarEl.getBoundingClientRect();
    blockedRects.push({ left: r.left - cRect.left, right: r.right - cRect.left, top: r.top - cRect.top, bottom: r.bottom - cRect.top });
  }
  if (state.hudOpen && hudEl) {
    const r = hudEl.getBoundingClientRect();
    blockedRects.push({ left: r.left - cRect.left, right: r.right - cRect.left, top: r.top - cRect.top, bottom: r.bottom - cRect.top });
  }

  const camDist = camera.position.length();
  const farMacroView = state.worldScale !== 'core' && camDist > 280;

  const placedRects = [];
  for (const item of labelElems) {
    if (item.macroOnly && state.worldScale === 'core') {
      item.el.style.display = 'none';
      continue;
    }
    if (item.ugOnly && state.worldScale !== 'wide_xray') {
      item.el.style.display = 'none';
      continue;
    }
    // 遠景1kmフライト俯瞰時は、中心コアの細かいラベルを自動非表示
    if (farMacroView && !item.macroOnly && item.id !== 'FLOOD' && item.id !== 'CAFE_FLOWER') {
      item.el.style.display = 'none';
      continue;
    }
    if (state.worldScale === 'full' && (item.id === 'FLOOD' || item.id === 'SUBWAY' || item.id === 'TBM' || item.id === 'PILES' || item.id === 'RAIN_TANK' || item.id === 'CULVERT')) {
      item.el.style.display = 'none';
      continue;
    }
    const lk = `l${item.layer}`;
    if (!state.layerVisible[lk]) {
      item.el.style.display = 'none';
      continue;
    }
    _proj.copy(item.basePos);
    _proj.y += (EXPLODE_OFFSETS[lk] || 0) * state.explode;
    _proj.applyMatrix4(rootGroup.matrixWorld).project(camera);

    if (_proj.z > 1 || _proj.z < -1) {
      item.el.style.display = 'none';
      continue;
    }

    const x = (_proj.x * 0.5 + 0.5) * w;
    const y = (-_proj.y * 0.5 + 0.5) * h;

    if (x < 16 || x > w - 16 || y < 26 || y > h - 30) {
      item.el.style.display = 'none';
      continue;
    }

    if (item.w === 0 || item.h === 0) {
      item.el.style.visibility = 'hidden';
      item.el.style.display = 'block';
      item.w = item.el.offsetWidth || 160;
      item.h = item.el.offsetHeight || 22;
      item.el.style.visibility = '';
    }

    const box = { left: x - item.w * 0.5, right: x + item.w * 0.5, top: y - item.h, bottom: y };
    if (box.left < 6 || box.right > w - 6 || box.top < 6) {
      item.el.style.display = 'none';
      continue;
    }

    let occluded = false;
    for (const br of blockedRects) {
      if (rectsOverlap(box, br, 4)) { occluded = true; break; }
    }
    if (occluded) { item.el.style.display = 'none'; continue; }

    let collided = false;
    for (const pr of placedRects) {
      if (rectsOverlap(box, pr, 6)) { collided = true; break; }
    }
    if (collided) { item.el.style.display = 'none'; continue; }

    placedRects.push(box);
    item.el.style.display = 'block';
    item.el.style.left = `${x}px`;
    item.el.style.top = `${y}px`;
  }
}

// ---- 右HUD描画（地質柱状図 ＆ 都市デザイン・国交省白書最適化） ----
function renderHUD(meta) {
  const sc = document.getElementById('strata-chart');
  sc.innerHTML = meta.strata
    .map((s) => {
      const rgb = `rgb(${s.color[0]},${s.color[1]},${s.color[2]})`;
      const th = Math.abs(s.y_bot - s.y_top);
      const pad = Math.max(3, Math.round(th * 0.45));
      return `<div class="st-bar" style="background:${rgb};padding-top:${pad}px;padding-bottom:${pad}px" title="${s.desc}">
        <span><b>${s.name}</b></span>
        <span class="nv">${s.n_value}</span>
      </div>`;
    })
    .join('');

  const il = document.getElementById('infra-legend');
  il.innerHTML = meta.infra_depths
    .map((d) => {
      const cam = d.cam || 'iso';
      return `<div class="il-row" data-cam="${cam}" role="button" tabindex="0" title="クリックで「${d.name}」へフォーカス">
        <span class="il-left"><span class="il-dot" style="background:${d.color}"></span>${d.name}</span>
        <span class="il-gl">${d.gl}</span>
      </div>`;
    })
    .join('');

  il.querySelectorAll('.il-row').forEach((row) => {
    const go = () => {
      moveCameraTo(row.dataset.cam);
      if (isMobileViewport()) setHudOpen(false);
    };
    row.addEventListener('click', go);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    });
  });

  // Tab 2: 都市デザイン＆国交省白書最適化メトリクス
  const opt = meta.optimization;
  if (opt) {
    document.getElementById('opt-score').textContent = String(opt.overall_score);
    document.getElementById('opt-summary').textContent =
      `96m×96m (${opt.district_area_m2.toLocaleString()}m²) / 建築${opt.building_count}棟 / 樹木${opt.tree_count}本 / 杭${opt.pile_count}本`;

    document.getElementById('opt-metrics').innerHTML = opt.metrics
      .map(
        (m) => `<div class="opt-item">
          <div class="opt-row1"><span class="opt-label">${m.label}</span><span class="opt-val">${m.value}</span></div>
          <div class="opt-bar-bg"><div class="opt-bar-fill" style="width:${m.score}%"></div></div>
          <div class="opt-row2"><span>${m.target}</span><span>${m.source}</span></div>
        </div>`
      )
      .join('');
  }

  const refs = meta.policy_references || [];
  document.getElementById('policy-refs').innerHTML = refs
    .map((r) => `<div class="pol-card"><b>• ${r.title}</b> <span class="pol-src">(${r.source})</span><br>${r.detail}</div>`)
    .join('');
}

function setPaused(paused) {
  state.paused = !!paused;
  const btn = document.getElementById('btn-pause');
  btn.classList.toggle('paused', state.paused);
  btn.textContent = state.paused ? '▶ 停止中' : '⏸ 稼働中';
}

// ---- UI 結線 ----
function bindUI() {
  setSidebarOpen(state.sidebarOpen);
  setHudOpen(state.hudOpen);

  btnToggleSidebar.addEventListener('click', () => setSidebarOpen(true));
  document.getElementById('btn-close-sidebar').addEventListener('click', () => setSidebarOpen(false));
  btnToggleHud.addEventListener('click', () => setHudOpen(true));
  document.getElementById('btn-close-hud').addEventListener('click', () => setHudOpen(false));

  document.querySelectorAll('.hud-tab').forEach((b) => {
    b.addEventListener('click', () => setHudTab(b.dataset.tab));
  });
  document.querySelectorAll('#camera-presets button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.cam;
      if (k === 'exploded') {
        setMode('explode');
        return;
      }
      if (k === 'wide_ug') {
        setWorldScale('wide_xray');
        state.soilFrontOpacity = 0.0;
        state.soilBackOpacity = 0.0;
        syncSlidersFromState();
        updateDisplay();
        moveCameraTo('wide_ug');
        return;
      }
      if (k === 'iso' || k === 'tbm') {
        setWorldScale('hybrid');
        setMode('cutaway');
        moveCameraTo(k);
        return;
      }
      if (k === 'metro' || k === 'hub' || k === 'bay' || k === 'cafe') {
        setWorldScale('full');
        setMode('solid');
        moveCameraTo(k);
        return;
      }
      moveCameraTo(k);
    });
  });
  document.querySelectorAll('.scale-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sc = btn.dataset.scale;
      setWorldScale(sc);
      if (sc === 'core') moveCameraTo('iso');
      else if (sc === 'full') moveCameraTo('metro');
      else if (sc === 'wide_xray') {
        state.soilFrontOpacity = 0.0;
        state.soilBackOpacity = 0.0;
        syncSlidersFromState();
        updateDisplay();
        moveCameraTo('wide_ug');
      }
    });
  });
  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });
  document.querySelectorAll('.theme-pill').forEach((btn) => {
    btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
  });
  document.getElementById('sl-explode').addEventListener('input', (e) => {
    clearActiveModeBtn();
    state.explode = Number(e.target.value) / 100.0;
    syncSlidersFromState();
    updateDisplay();
  });
  document.getElementById('sl-soil-front').addEventListener('input', (e) => {
    clearActiveModeBtn();
    state.soilFrontOpacity = Number(e.target.value) / 100.0;
    syncSlidersFromState();
    updateDisplay();
  });
  document.getElementById('sl-soil-back').addEventListener('input', (e) => {
    clearActiveModeBtn();
    state.soilBackOpacity = Number(e.target.value) / 100.0;
    syncSlidersFromState();
    updateDisplay();
  });
  document.querySelectorAll('input[data-layer]').forEach((inp) => {
    inp.addEventListener('change', () => {
      state.layerVisible[inp.dataset.layer] = inp.checked;
      updateDisplay();
    });
  });
  document.getElementById('chk-labels').addEventListener('change', (e) => (state.showLabels = e.target.checked));
  document.getElementById('chk-rotate').addEventListener('change', (e) => (state.autoRotate = e.target.checked));
  document.getElementById('btn-pause').addEventListener('click', () => setPaused(!state.paused));
  document.getElementById('btn-theme').addEventListener('click', () => {
    const next = THEME_CYCLE[(THEME_CYCLE.indexOf(state.theme) + 1) % THEME_CYCLE.length];
    applyTheme(next);
  });
  document.getElementById('btn-auto-demo').addEventListener('click', (e) => {
    state.autoDemo = !state.autoDemo;
    state.demoClock = 0.0;
    e.currentTarget.classList.toggle('running', state.autoDemo);
    e.currentTarget.textContent = state.autoDemo ? '⏸ 停止' : '▶ デモ';
  });
  document.getElementById('btn-shot').addEventListener('click', () => {
    renderFrame();
    const a = document.createElement('a');
    a.href = renderer.domElement.toDataURL('image/png');
    a.download = `tokyo_metro_district_2030_${state.theme}.png`;
    a.click();
  });
}

// ---- GLB ロード＆階層自動振り分け ----
async function init() {
  bindUI();
  await setupPostProcessing();
  const loadingText = document.getElementById('loading-text');
  try {
    const resp = await fetch('../output/viewer_data.json?v=20261127-2');
    state.meta = await resp.json();
    renderHUD(state.meta);
    buildLabels(state.meta);

    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync('../output/urban_cutaway_cube.glb?v=20261127-2');
    const maxAniso = renderer.capabilities.getMaxAnisotropy();

    const buckets = {
      l1: [], l2: [], l3: [], l4: [], l5: [],
      carHi1: [], carHi2: [], carHi3: [], carHi4: [],
      carLo1: [], carLo2: [], carLo3: [], carLo4: [],
      lrt1: [], lrt2: [],
      trainShallow1: [], trainShallow2: [],
      trainDeep: [], tbmCutter: [],
      root: [],
    };

    gltf.scene.traverse((obj) => {
      if (obj.isMesh) {
        const noCast = obj.name.startsWith('soil_wall_') || obj.name.includes('_water') || obj.name.includes('_glass') || obj.name.includes('soundwall');
        obj.castShadow = !noCast;
        obj.receiveShadow = true;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          if (!m) continue;
          if (m.map) m.map.anisotropy = maxAniso;
          if (m.normalMap) m.normalMap.anisotropy = maxAniso;
          if (m.emissiveMap) {
            m.emissiveMap.anisotropy = maxAniso;
            buildingEmissiveMats.push(m);
          }
          if (obj.name === 'l2_canal_water' || obj.name === 'l5_flood_water') {
            const isCanal = obj.name === 'l2_canal_water';
            // 念のため全頂点に有効な非ゼロUVを保証（normalMapのdFdx/dFdy=NaNによるBloom黒ブロック完全防止！）
            const posAttr = obj.geometry.attributes.position;
            if (posAttr) {
              const uvs = new Float32Array(posAttr.count * 2);
              for (let i = 0; i < posAttr.count; i++) {
                const vx = posAttr.getX(i);
                const vy = posAttr.getY(i);
                const vz = posAttr.getZ(i);
                uvs[i * 2] = (vx + vy * 0.4) * 0.08;
                uvs[i * 2 + 1] = (vz + vy * 0.4) * 0.08;
              }
              obj.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
              obj.geometry.computeVertexNormals();
            }
            obj.material = new THREE.MeshStandardMaterial({
              color: isCanal ? 0x1688b2 : 0x18bce8,
              emissive: isCanal ? 0x05283a : 0x06486b,
              emissiveIntensity: isCanal ? 0.32 : 0.65,
              roughness: 0.10,
              metalness: 0.24,
              envMapIntensity: 1.55,
              normalMap: waterNormalTex,
              normalScale: new THREE.Vector2(0.38, 0.38),
              transparent: true,
              opacity: isCanal ? 0.82 : 0.72,
              side: THREE.DoubleSide,
            });
            waterMeshes.push(obj);
          }
        }
        if (obj.name === 'soil_wall_x_pos' || obj.name === 'soil_wall_z_pos') soilWalls.front.push(obj);
        if (obj.name === 'soil_wall_x_neg' || obj.name === 'soil_wall_z_neg') soilWalls.back.push(obj);
      }
      if (!obj.name || obj === gltf.scene) return;
      const pName = obj.parent?.name || '';
      if (pName && pName === obj.name) return;
      if (obj.parent && obj.parent !== gltf.scene && pName && !pName.startsWith('Scene')) return;

      const n = obj.name;
      if (n.startsWith('l1_car_hi_01_')) buckets.carHi1.push(obj);
      else if (n.startsWith('l1_car_hi_02_')) buckets.carHi2.push(obj);
      else if (n.startsWith('l1_car_hi_03_')) buckets.carHi3.push(obj);
      else if (n.startsWith('l1_car_hi_04_')) buckets.carHi4.push(obj);
      else if (n.startsWith('l2_car_lo_01_')) buckets.carLo1.push(obj);
      else if (n.startsWith('l2_car_lo_02_')) buckets.carLo2.push(obj);
      else if (n.startsWith('l2_car_lo_03_')) buckets.carLo3.push(obj);
      else if (n.startsWith('l2_car_lo_04_')) buckets.carLo4.push(obj);
      else if (n.startsWith('l2_lrt_01_')) buckets.lrt1.push(obj);
      else if (n.startsWith('l2_lrt_02_')) buckets.lrt2.push(obj);
      else if (n.startsWith('l4_train_shallow_01_')) buckets.trainShallow1.push(obj);
      else if (n.startsWith('l4_train_shallow_02_')) buckets.trainShallow2.push(obj);
      else if (n.startsWith('l5_train_deep_')) buckets.trainDeep.push(obj);
      else if (n.startsWith('l5_tbm_cutter_')) buckets.tbmCutter.push(obj);
      else if (n.startsWith('l1_')) buckets.l1.push(obj);
      else if (n.startsWith('l2_')) buckets.l2.push(obj);
      else if (n.startsWith('l3_')) buckets.l3.push(obj);
      else if (n.startsWith('l4_')) buckets.l4.push(obj);
      else if (n.startsWith('l5_')) buckets.l5.push(obj);
      else buckets.root.push(obj);
    });

    for (const k of ['l1', 'l2', 'l3', 'l4', 'l5']) buckets[k].forEach((o) => layerGroups[k].add(o));
    for (const k of Object.keys(animGroups)) buckets[k].forEach((o) => animGroups[k].add(o));
    buckets.root.forEach((o) => rootGroup.add(o));

    // 1.0km × 1.0km リアル東京 ＆ 広域地下インフラ解剖ワールドを生成・統合！
    metroWorld = createMetroWorld(waterNormalTex);
    rootGroup.add(metroWorld.root);
    if (state.meta?.optimization) {
      const totalB = state.meta.optimization.building_count + metroWorld.stats.totalBuildings;
      const totalT = state.meta.optimization.tree_count + metroWorld.stats.totalTrees;
      document.getElementById('opt-summary').textContent =
        `1km東京 (1.08km²) / 厳選建築${totalB}棟 / 並木・都市林${totalT}本 / 1km広域地下網`;
    }

    applyTheme('night');
    setWorldScale('full');
    setMode('solid');
    updateAnimations(0.0);
    document.getElementById('loading-overlay').classList.add('hidden');
  } catch (err) {
    loadingText.textContent = `読み込みエラー: ${err.message}`;
    console.error(err);
  }
}

function handleResize() {
  const w = Math.max(1, container.clientWidth);
  const h = Math.max(1, container.clientHeight);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  if (composer) composer.setSize(w, h);
  for (const item of labelElems) { item.w = 0; item.h = 0; }
}
window.addEventListener('resize', handleResize);

let lastNow = performance.now();
function animate(now) {
  requestAnimationFrame(animate);
  if (state.manualRender) return;
  const dt = Math.min(0.05, (now - lastNow) / 1000.0);
  lastNow = now;

  if (!state.paused) {
    state.simTime += dt;
    updateAnimations(state.simTime);
  }

  if (state.autoRotate) {
    rootGroup.rotation.y += dt * 0.20;
  }

  if (state.autoDemo) {
    state.demoClock += dt;
    const ph = (state.demoClock % 16.0) / 16.0;
    rootGroup.rotation.y = ph * Math.PI * 2.0;

    let nextExplode = 0.0;
    if (ph < 0.30) nextExplode = 0.0;
    else if (ph < 0.46) nextExplode = ((ph - 0.30) / 0.16) * 0.88;
    else if (ph < 0.72) nextExplode = 0.88;
    else if (ph < 0.88) nextExplode = (1.0 - (ph - 0.72) / 0.16) * 0.88;
    else nextExplode = 0.0;

    if (Math.abs(nextExplode - state.explode) > 1e-4) {
      state.explode = nextExplode;
      syncSlidersFromState();
      updateDisplay();
    }
  }

  if (camAnim) {
    camAnim.t = Math.min(1, camAnim.t + 0.065);
    const e = 1 - Math.pow(1 - camAnim.t, 3);
    camera.position.lerpVectors(camAnim.startPos, camAnim.endPos, e);
    controls.target.lerpVectors(camAnim.startTarget, camAnim.endTarget, e);
    if (camAnim.t >= 1) camAnim = null;
  }

  controls.update();
  renderFrame();
  updateLabels();
}

init();
requestAnimationFrame(animate);

// 自動録画・品質検品 QA 用 API
window.__demoApi = {
  isReady: () => document.getElementById('loading-overlay').classList.contains('hidden'),
  setTheme: (th) => { applyTheme(th); renderFrame(); },
  setWorldScale: (sc) => { setWorldScale(sc); renderFrame(); },
  setMode: (m) => { setMode(m); renderFrame(); },
  setHudTab: (tab) => { setHudTab(tab); },
  setExplode: (v) => { state.explode = Number(v); syncSlidersFromState(); updateDisplay(); renderFrame(); },
  setSoilOpacity: (f, b) => { state.soilFrontOpacity = Number(f); state.soilBackOpacity = Number(b); syncSlidersFromState(); updateDisplay(); renderFrame(); },
  setRootRotY: (rad) => { rootGroup.rotation.y = Number(rad); renderFrame(); },
  setSimTime: (t) => { state.simTime = Number(t); updateAnimations(state.simTime); renderFrame(); },
  setLabels: (v) => { state.showLabels = !!v; document.getElementById('chk-labels').checked = !!v; updateLabels(); },
  setPaused: (v) => { setPaused(!!v); },
  setPanels: (left, right) => { setSidebarOpen(!!left); setHudOpen(!!right); updateLabels(); },
  setActiveCamBtn: (key) => {
    document.querySelectorAll('#camera-presets button').forEach((b) => b.classList.toggle('active', b.dataset.cam === key));
  },
  setManualRender: (v) => { state.manualRender = !!v; },
  applyFrame: (cfg) => {
    if (cfg.theme) applyTheme(cfg.theme);
    if (cfg.scale) setWorldScale(cfg.scale);
    if (cfg.mode) setMode(cfg.mode);
    state.explode = Number(cfg.explode || 0);
    state.soilFrontOpacity = Number(cfg.soil[0]);
    state.soilBackOpacity = Number(cfg.soil[1]);
    updateDisplay();
    rootGroup.rotation.y = Number(cfg.rot || 0);
    state.showLabels = !!cfg.labels;
    state.simTime = Number(cfg.t || 0);
    updateAnimations(state.simTime);
    camAnim = null;
    camera.position.set(cfg.cam[0], cfg.cam[1], cfg.cam[2]);
    controls.target.set(cfg.tgt[0], cfg.tgt[1], cfg.tgt[2]);
    controls.update();
    renderFrame();
    updateLabels();
  },
  setCamera: (pos, tgt) => {
    camAnim = null;
    camera.position.set(pos[0], pos[1], pos[2]);
    controls.target.set(tgt[0], tgt[1], tgt[2]);
    controls.update();
    renderFrame();
    updateLabels();
  },
};
