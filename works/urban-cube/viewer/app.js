import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const container = document.getElementById('canvas-container');
const labelsLayer = document.getElementById('labels-layer');
const sidebarEl = document.getElementById('sidebar');
const hudEl = document.getElementById('strata-hud');
const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
const btnToggleHud = document.getElementById('btn-toggle-hud');

// ---- Three.js シーン構築 ----
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070d1a);

const camera = new THREE.PerspectiveCamera(
  40,
  Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight),
  0.5,
  600
);
camera.position.set(50, 22, 54);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true,
  powerPreference: 'high-performance',
});
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
container.appendChild(renderer.domElement);

const pmremGen = new THREE.PMREMGenerator(renderer);
scene.environment = pmremGen.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.45;
pmremGen.dispose();

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.maxPolarAngle = Math.PI * 0.82;
controls.target.set(0, -11.5, 0);
controls.update();

// ライティング（サイバー／昼の2テーマ切替対応）
const hemiLight = new THREE.HemisphereLight(0x88b4e8, 0x1e293b, 0.75);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(0xfff5e4, 1.85);
sunLight.position.set(42, 68, 48);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(4096, 4096);
sunLight.shadow.camera.left = -45;
sunLight.shadow.camera.right = 45;
sunLight.shadow.camera.top = 45;
sunLight.shadow.camera.bottom = -45;
sunLight.shadow.camera.near = 10;
sunLight.shadow.camera.far = 190;
sunLight.shadow.bias = -0.0003;
sunLight.shadow.radius = 2.0;
scene.add(sunLight);

const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.72);
rimLight.position.set(-48, -10, -42);
scene.add(rimLight);

// 展示スタジオの繊細な床グリッド（キューブ台座下 Y = -35.25）
const floorGrid = new THREE.GridHelper(120, 40, 0x1e3a5f, 0x111d32);
floorGrid.position.y = -35.25;
scene.add(floorGrid);

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

const EXPLODE_OFFSETS = { l1: 27.0, l2: 19.5, l3: 12.0, l4: 6.0, l5: 0.5 };

const animGroups = {
  carHi1: new THREE.Group(),
  carHi2: new THREE.Group(),
  carLo1: new THREE.Group(),
  carLo2: new THREE.Group(),
  carLo3: new THREE.Group(),
  trainShallow: new THREE.Group(),
  trainDeep: new THREE.Group(),
  tbmCutter: new THREE.Group(),
};
layerGroups.l1.add(animGroups.carHi1, animGroups.carHi2);
layerGroups.l2.add(animGroups.carLo1, animGroups.carLo2, animGroups.carLo3);
layerGroups.l4.add(animGroups.trainShallow);
layerGroups.l5.add(animGroups.trainDeep, animGroups.tbmCutter);
// TBM カッターヘッド基準座標（南線シールド先端）
animGroups.tbmCutter.position.set(11.72, -24.0, 10.0);

const soilWalls = {
  front: [], // +X, +Z（手前2面）
  back: [],  // -X, -Z（奥2面）
};

const state = {
  meta: null,
  theme: 'cyber',
  explode: 0.0,
  soilFrontOpacity: 0.24,
  soilBackOpacity: 0.96,
  showLabels: true,
  autoRotate: false,
  autoDemo: false,
  paused: false,
  demoClock: 0.0,
  simTime: 0.0,
  sidebarOpen: window.innerWidth > 900,
  hudOpen: window.innerWidth > 900,
  layerVisible: { l1: true, l2: true, l3: true, l4: true, l5: true },
};

const CAMERA_PRESETS = {
  iso: { pos: [50, 20, 52], target: [0, -11.5, 0] },
  tbm: { pos: [30, -18.5, 24], target: [8.0, -24.0, 10.0] },
  subway: { pos: [14, -6.5, 36], target: [0, -11.0, 2.0] },
  lifeline: { pos: [34, 4.5, 32], target: [2.0, -3.5, 4.0] },
  exploded: { pos: [78, 34, 80], target: [0, 3.5, 0] },
  low: { pos: [36, -30, 38], target: [0, -15.0, 0] },
};

const LABEL_CAM_MAP = {
  VIADUCT: 'iso',
  CULVERT: 'lifeline',
  WATER: 'lifeline',
  SEWER: 'lifeline',
  SUBWAY: 'subway',
  PILES: 'low',
  TBM: 'tbm',
  SHIELD_N: 'tbm',
};

function isMobileViewport() {
  return window.innerWidth <= 900;
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

// ---- テーマ適用（サイバー・ネオン ⇔ 昼ミニチュア模型） ----
function applyTheme(theme) {
  state.theme = theme;
  const isDay = theme === 'day';
  document.body.classList.toggle('theme-day', isDay);
  document.body.classList.toggle('theme-cyber', !isDay);

  scene.background = new THREE.Color(isDay ? 0xdbe5f0 : 0x070d1a);
  hemiLight.color.setHex(isDay ? 0xf0f8ff : 0x88b4e8);
  hemiLight.groundColor.setHex(isDay ? 0x8a929e : 0x1e293b);
  hemiLight.intensity = isDay ? 1.05 : 0.72;
  sunLight.intensity = isDay ? 2.15 : 1.75;
  rimLight.intensity = isDay ? 0.35 : 0.85;
  scene.environmentIntensity = isDay ? 0.58 : 0.42;
  renderer.toneMappingExposure = isDay ? 1.04 : 1.12;
  floorGrid.visible = !isDay;
  document.getElementById('btn-theme').textContent = isDay ? '☀ サイバーへ' : '🌙 昼模型へ';
}

// ---- 地層ウォール透明度 ＆ 5層 Exploded View 更新 ----
function updateDisplay() {
  const e = state.explode;
  for (const k of ['l1', 'l2', 'l3', 'l4', 'l5']) {
    layerGroups[k].position.y = EXPLODE_OFFSETS[k] * e;
    layerGroups[k].visible = state.layerVisible[k];
  }

  // Explode中は地層断面ウォールを自動的にフェードアウトさせる
  const explodeFade = Math.max(0.0, 1.0 - e * 2.4);
  const fOp = state.soilFrontOpacity * explodeFade;
  const bOp = state.soilBackOpacity * explodeFade;

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

// ---- 稼働ギミック更新（車両・地下鉄立体交差・TBMカッターヘッド回転） ----
function updateAnimations(tSec) {
  const wrap = (val, span) => ((((val + span * 0.5) % span) + span) % span) - span * 0.5;

  // 高速道路 走行車（+X / -X）
  animGroups.carHi1.position.set(wrap(tSec * 9.5, 32.0), 9.26, 2.1);
  animGroups.carHi1.rotation.y = 0;
  animGroups.carHi2.position.set(-wrap(tSec * 8.2 + 12.0, 32.0), 9.26, -2.1);
  animGroups.carHi2.rotation.y = Math.PI;

  // 地表交差点 走行車（路線バス・タクシー・セダン）
  animGroups.carLo1.position.set(wrap(tSec * 4.5 - 6.0, 30.0), 0.0, 4.8);
  animGroups.carLo1.rotation.y = 0;
  animGroups.carLo2.position.set(-wrap(tSec * 5.2 + 4.0, 31.0), 0.0, -1.85);
  animGroups.carLo2.rotation.y = Math.PI;
  animGroups.carLo3.position.set(1.55, 0.0, wrap(tSec * 4.8 + 8.0, 31.0));
  animGroups.carLo3.rotation.y = -Math.PI * 0.5;

  // 浅層 開削RCボックス地下鉄（Z方向往復走行）
  animGroups.trainShallow.position.set(2.2, -13.15, wrap(tSec * 5.2 + 2.0, 24.0));

  // 大深度 北線シールド地下鉄（X方向走行・浅層地下鉄の下を立体交差）
  animGroups.trainDeep.position.set(wrap(tSec * 6.5 + 8.0, 24.0), -25.25, -10.0);

  // 稼働中シールドマシン TBM カッターヘッド回転
  animGroups.tbmCutter.rotation.x = tSec * 1.45;
}

// ---- ワンクリック表示モード ----
function clearActiveModeBtn() {
  document.querySelectorAll('.mode-btn.active').forEach((b) => b.classList.remove('active'));
}

function setMode(mode) {
  document.querySelectorAll('.mode-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  if (mode === 'cutaway') {
    state.explode = 0.0;
    state.soilFrontOpacity = 0.24;
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
    state.explode = 0.88;
    state.soilFrontOpacity = 0.20;
    state.soilBackOpacity = 0.90;
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

// ---- 3D ラベル（クリック連携＋重なり回避＋パネル領域クリップ） ----
const labelElems = [];
function buildLabels(meta) {
  labelsLayer.innerHTML = '';
  labelElems.length = 0;
  for (const lb of meta.labels || []) {
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
      basePos: new THREE.Vector3(...lb.pos),
      w: 0,
      h: 0,
    });
  }
}

function rectsOverlap(a, b, pad = 0) {
  return !(
    a.right + pad < b.left ||
    a.left - pad > b.right ||
    a.bottom + pad < b.top ||
    a.top - pad > b.bottom
  );
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

  // 表示中パネルの占有矩形（コンテナ相対）
  const cRect = container.getBoundingClientRect();
  const blockedRects = [];
  if (state.sidebarOpen && sidebarEl) {
    const r = sidebarEl.getBoundingClientRect();
    blockedRects.push({
      left: r.left - cRect.left,
      right: r.right - cRect.left,
      top: r.top - cRect.top,
      bottom: r.bottom - cRect.top,
    });
  }
  if (state.hudOpen && hudEl) {
    const r = hudEl.getBoundingClientRect();
    blockedRects.push({
      left: r.left - cRect.left,
      right: r.right - cRect.left,
      top: r.top - cRect.top,
      bottom: r.bottom - cRect.top,
    });
  }

  const placedRects = [];

  for (const item of labelElems) {
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

    // 画面端マージン外は非表示
    if (x < 16 || x > w - 16 || y < 26 || y > h - 30) {
      item.el.style.display = 'none';
      continue;
    }

    // 初回のみ幅・高さを実測キャッシュ（以降はレイアウト強制再計算なし）
    if (item.w === 0 || item.h === 0) {
      item.el.style.visibility = 'hidden';
      item.el.style.display = 'block';
      item.w = item.el.offsetWidth || 160;
      item.h = item.el.offsetHeight || 22;
      item.el.style.visibility = '';
    }

    const box = {
      left: x - item.w * 0.5,
      right: x + item.w * 0.5,
      top: y - item.h,
      bottom: y,
    };

    // 左右画面外にはみ出すラベルは非表示
    if (box.left < 6 || box.right > w - 6 || box.top < 6) {
      item.el.style.display = 'none';
      continue;
    }

    // 開いているサイドバー／地質HUDと重なる場合は非表示
    let occluded = false;
    for (const br of blockedRects) {
      if (rectsOverlap(box, br, 4)) {
        occluded = true;
        break;
      }
    }
    if (occluded) {
      item.el.style.display = 'none';
      continue;
    }

    // 上位ラベルとの重なり回避
    let collided = false;
    for (const pr of placedRects) {
      if (rectsOverlap(box, pr, 6)) {
        collided = true;
        break;
      }
    }
    if (collided) {
      item.el.style.display = 'none';
      continue;
    }

    placedRects.push(box);
    item.el.style.display = 'block';
    item.el.style.left = `${x}px`;
    item.el.style.top = `${y}px`;
  }
}

// ---- 右上 地質柱状図 HUD 描画 ----
function resolveInfraCamera(name) {
  if (name.includes('高架橋')) return 'iso';
  if (name.includes('ガス') || name.includes('共同溝') || name.includes('下水道')) return 'lifeline';
  if (name.includes('開削')) return 'subway';
  if (name.includes('シールド')) return 'tbm';
  if (name.includes('杭')) return 'low';
  return 'iso';
}

function renderStrataHUD(meta) {
  const sc = document.getElementById('strata-chart');
  sc.innerHTML = meta.strata
    .map((s) => {
      const rgb = `rgb(${s.color[0]},${s.color[1]},${s.color[2]})`;
      const th = Math.abs(s.y_bot - s.y_top);
      const pad = Math.max(3, Math.round(th * 0.65));
      return `<div class="st-bar" style="background:${rgb};padding-top:${pad}px;padding-bottom:${pad}px" title="${s.desc}">
        <span><b>${s.name}</b></span>
        <span class="nv">${s.n_value}</span>
      </div>`;
    })
    .join('');

  const il = document.getElementById('infra-legend');
  il.innerHTML = meta.infra_depths
    .map((d) => {
      const cam = resolveInfraCamera(d.name);
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
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        go();
      }
    });
  });
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

  document.querySelectorAll('#camera-presets button').forEach((btn) => {
    btn.addEventListener('click', () => moveCameraTo(btn.dataset.cam));
  });
  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
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
  document.getElementById('btn-theme').addEventListener('click', () => applyTheme(state.theme === 'cyber' ? 'day' : 'cyber'));
  document.getElementById('btn-auto-demo').addEventListener('click', (e) => {
    state.autoDemo = !state.autoDemo;
    state.demoClock = 0.0;
    e.currentTarget.classList.toggle('running', state.autoDemo);
    e.currentTarget.textContent = state.autoDemo ? '⏸ 停止' : '▶ デモ';
  });
  document.getElementById('btn-shot').addEventListener('click', () => {
    renderer.render(scene, camera);
    const a = document.createElement('a');
    a.href = renderer.domElement.toDataURL('image/png');
    a.download = `urban_cutaway_cube_${state.theme}.png`;
    a.click();
  });
}

// ---- GLB ロード＆階層自動振り分け ----
async function init() {
  bindUI();
  const loadingText = document.getElementById('loading-text');
  try {
    const resp = await fetch('../output/viewer_data.json');
    state.meta = await resp.json();
    renderStrataHUD(state.meta);
    buildLabels(state.meta);

    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync('../output/urban_cutaway_cube.glb');
    const maxAniso = renderer.capabilities.getMaxAnisotropy();

    const buckets = {
      l1: [], l2: [], l3: [], l4: [], l5: [],
      carHi1: [], carHi2: [], carLo1: [], carLo2: [], carLo3: [],
      trainShallow: [], trainDeep: [], tbmCutter: [],
      root: [],
    };

    gltf.scene.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = !obj.name.startsWith('soil_wall_');
        obj.receiveShadow = true;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          if (!m) continue;
          if (m.map) m.map.anisotropy = maxAniso;
          if (m.normalMap) m.normalMap.anisotropy = maxAniso;
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
      else if (n.startsWith('l2_car_lo_01_')) buckets.carLo1.push(obj);
      else if (n.startsWith('l2_car_lo_02_')) buckets.carLo2.push(obj);
      else if (n.startsWith('l2_car_lo_03_')) buckets.carLo3.push(obj);
      else if (n.startsWith('l4_train_shallow_')) buckets.trainShallow.push(obj);
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

    applyTheme('cyber');
    setMode('cutaway');
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
  for (const item of labelElems) {
    item.w = 0;
    item.h = 0;
  }
}
window.addEventListener('resize', handleResize);

let lastNow = performance.now();
function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (now - lastNow) / 1000.0);
  lastNow = now;

  if (!state.paused) {
    state.simTime += dt;
    updateAnimations(state.simTime);
  }

  if (state.autoRotate) {
    rootGroup.rotation.y += dt * 0.25;
  }

  if (state.autoDemo) {
    state.demoClock += dt;
    const ph = (state.demoClock % 14.0) / 14.0;
    rootGroup.rotation.y = ph * Math.PI * 2.0;

    let nextExplode = 0.0;
    if (ph < 0.30) nextExplode = 0.0;
    else if (ph < 0.45) nextExplode = ((ph - 0.30) / 0.15) * 0.90;
    else if (ph < 0.72) nextExplode = 0.90;
    else if (ph < 0.88) nextExplode = (1.0 - (ph - 0.72) / 0.16) * 0.90;
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
  renderer.render(scene, camera);
  updateLabels();
}

init();
requestAnimationFrame(animate);

// 自動録画・QA用 API
window.__demoApi = {
  isReady: () => document.getElementById('loading-overlay').classList.contains('hidden'),
  setTheme: (th) => { applyTheme(th); renderer.render(scene, camera); },
  setMode: (m) => { setMode(m); renderer.render(scene, camera); },
  setExplode: (v) => { state.explode = Number(v); syncSlidersFromState(); updateDisplay(); renderer.render(scene, camera); },
  setSoilOpacity: (f, b) => { state.soilFrontOpacity = Number(f); state.soilBackOpacity = Number(b); syncSlidersFromState(); updateDisplay(); renderer.render(scene, camera); },
  setRootRotY: (rad) => { rootGroup.rotation.y = Number(rad); renderer.render(scene, camera); },
  setSimTime: (t) => { state.simTime = Number(t); updateAnimations(state.simTime); renderer.render(scene, camera); },
  setLabels: (v) => { state.showLabels = !!v; document.getElementById('chk-labels').checked = !!v; updateLabels(); },
  setPaused: (v) => { setPaused(!!v); },
  setPanels: (left, right) => { setSidebarOpen(!!left); setHudOpen(!!right); updateLabels(); },
  setCamera: (pos, tgt) => {
    camAnim = null;
    camera.position.set(pos[0], pos[1], pos[2]);
    controls.target.set(tgt[0], tgt[1], tgt[2]);
    controls.update();
    renderer.render(scene, camera);
    updateLabels();
  },
};
