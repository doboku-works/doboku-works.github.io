import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const container = document.getElementById('canvas-container');
const labelsLayer = document.getElementById('labels-layer');

// ---- Three.js シーン構築 ----
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xcce2f4);
scene.fog = new THREE.FogExp2(0xcce2f4, 0.0014);

const camera = new THREE.PerspectiveCamera(42, container.clientWidth / container.clientHeight, 0.5, 1200);
camera.position.set(112, 54, 118);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
container.appendChild(renderer.domElement);

// 金属（クロームピストン・鋼製車輪・無端ローラー・鋼2主桁）のリアル反射用 IBL 環境マップ
const pmremGen = new THREE.PMREMGenerator(renderer);
scene.environment = pmremGen.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;
pmremGen.dispose();

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.maxPolarAngle = Math.PI * 0.64;
controls.target.set(52, 13, 0);
controls.update();

// ライティング（澄んだ日本の河川風景）
scene.add(new THREE.HemisphereLight(0xdff0ff, 0x6b7c5c, 0.92));
const sunLight = new THREE.DirectionalLight(0xfff9ee, 1.98);
sunLight.position.set(85, 120, 95);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(4096, 4096);
sunLight.shadow.camera.left = -165;
sunLight.shadow.camera.right = 165;
sunLight.shadow.camera.top = 120;
sunLight.shadow.camera.bottom = -120;
sunLight.shadow.camera.near = 20;
sunLight.shadow.camera.far = 360;
sunLight.shadow.bias = -0.00025;
scene.add(sunLight);
const fillLight = new THREE.DirectionalLight(0xbcd8f5, 0.42);
fillLight.position.set(-90, 55, -80);
scene.add(fillLight);

// ---- アプリ状態 ----
const state = {
  meta: null,
  nodes: new Map(),
  // 送り出し可動グループ（主桁12ブロック＋手延べ機を子ノードとして統合移動＆リアルタイム弾性たわみ変形！）
  movingGroup: new THREE.Group(),
  // A1 押し出し装置 可動ラム＆油圧グリッパーグループ（ステップ送り出し往復伸縮！）
  pusherRamGroup: new THREE.Group(),
  // 地組ヤード 8輪ボギー送り出し台車ペア × 4組（2条クレーン軌条上を桁と連動走行！）
  trolleyGroups: [new THREE.Group(), new THREE.Group(), new THREE.Group(), new THREE.Group()],
  // 頂点変形キャッシュ: [{ mesh, origPos: Float32Array, kind: 'girder'|'nose', blkIndex: 1..12 }]
  deformTargets: [],
  u: 0.0, // 連続タイムライン 0.0 .. 1.0
  playing: false,
  speed: 1.0,
  deflScale: 1.0,
  followTip: false,
  wireframe: false,
  layerVisible: {
    girder: true,
    nose: true,
    substructure: true,
    deck: true,
    temp_yard: true,
    temp_safety: true,
    env: true,
    labels: true,
  },
};
scene.add(state.movingGroup);
scene.add(state.pusherRamGroup);
state.trolleyGroups.forEach((g) => scene.add(g));

// ---- カメラプリセット ----
const CAMERA_PRESETS = {
  overview: { pos: [118, 52, 114], target: [48, 12, 0] },
  a1_pusher: { pos: [2.2, 16.4, 13.6], target: [-5.4, 13.9, 2.8] },
  yard_trolley: { pos: [-15.5, 16.0, 10.6], target: [-24.5, 14.3, 2.2] },
  p1_roller: { pos: [47.2, 16.2, 8.8], target: [42.0, 14.2, 2.8] },
  p2_tip: { pos: [116, 24, 24], target: [84, 15.0, 0] },
  underside: { pos: [54.0, 9.6, 15.5], target: [70.0, 15.8, 0.0] },
  side: { pos: [62, 24, 152], target: [54, 13, 0] },
};

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

function getLayerKey(name) {
  if (name.startsWith('girder_deckplate_') || name.startsWith('girder_deckribs_')) return 'deck';
  if (name.startsWith('girder_')) return 'girder';
  if (name.startsWith('launching_nose')) return 'nose';
  if (name.startsWith('sub_')) return 'substructure';
  if (name.startsWith('deck_')) return 'deck';
  if (name.startsWith('temp_scaffold_') || name.startsWith('temp_road_prot_')) return 'temp_safety';
  if (name.startsWith('temp_')) return 'temp_yard';
  if (name.startsWith('env_')) return 'env';
  return 'other';
}

// ---- FEM 解析結果の連続補間 ----
function sampleMechanics(stageNum, xFront) {
  const steps = state.meta?.mechanics?.steps || [];
  if (!steps.length) return null;
  const stageSteps = steps.filter((s) => s.launch_stage === stageNum);
  const list = stageSteps.length ? stageSteps : steps;
  if (xFront <= list[0].x_front) return list[0];
  if (xFront >= list[list.length - 1].x_front) return list[list.length - 1];
  for (let i = 0; i < list.length - 1; i++) {
    const a = list[i];
    const b = list[i + 1];
    if (xFront >= a.x_front && xFront <= b.x_front) {
      const t = (xFront - a.x_front) / Math.max(b.x_front - a.x_front, 1e-5);
      const lerpA = (k) => a[k] + (b[k] - a[k]) * t;
      const reactions = {};
      for (const rk of Object.keys(a.reactions_kn)) {
        reactions[rk] = a.reactions_kn[rk] + (b.reactions_kn[rk] - a.reactions_kn[rk]) * t;
      }
      const w_mm = a.w_mm.map((v, idx) => v + (b.w_mm[idx] - v) * t);
      const M_knm = a.M_knm.map((v, idx) => v + (b.M_knm[idx] - v) * t);
      return {
        x_front: xFront,
        girder_len: a.girder_len,
        x_tip: xFront + (state.meta.launching_nose.length_m ?? 34),
        tip_deflection_mm: lerpA('tip_deflection_mm'),
        max_pier_reaction_kn: lerpA('max_pier_reaction_kn'),
        patch_ratio_pct: lerpA('patch_ratio_pct'),
        max_neg_moment_knm: lerpA('max_neg_moment_knm'),
        reactions_kn: reactions,
        s_norm: a.s_norm,
        w_mm,
        M_knm,
      };
    }
  }
  return list[list.length - 1];
}

function interpDeflectionMeters(mech, sNorm) {
  if (!mech || !mech.s_norm?.length) return 0.0;
  const sn = Math.max(0.0, Math.min(1.0, sNorm));
  const arr = mech.s_norm;
  const wArr = mech.w_mm;
  const f = sn * (arr.length - 1);
  const i0 = Math.floor(f);
  const i1 = Math.min(arr.length - 1, i0 + 1);
  const t = f - i0;
  return ((wArr[i0] + (wArr[i1] - wArr[i0]) * t) * 0.001) * state.deflScale;
}

// ---- BMD & たわみ曲線 Canvas ライブ描画 ----
const bmdCanvas = document.getElementById('bmd-canvas');
const bmdCtx = bmdCanvas.getContext('2d');

function drawBmdCanvas(mech) {
  const W = bmdCanvas.width;
  const H = bmdCanvas.height;
  bmdCtx.clearRect(0, 0, W, H);
  bmdCtx.fillStyle = '#0f172a';
  bmdCtx.fillRect(0, 0, W, H);

  const midY = H * 0.48;
  bmdCtx.strokeStyle = 'rgba(148,163,184,0.35)';
  bmdCtx.lineWidth = 1;
  bmdCtx.beginPath();
  bmdCtx.moveTo(8, midY);
  bmdCtx.lineTo(W - 8, midY);
  bmdCtx.stroke();

  if (!mech || !mech.w_mm) return;
  const n = mech.w_mm.length;
  const L_nose = state.meta.launching_nose.length_m;
  const L_tot = mech.girder_len + L_nose;
  const noseX = 8 + (mech.girder_len / Math.max(L_tot, 1)) * (W - 16);

  // 主桁 / 手延べ機境界線
  bmdCtx.strokeStyle = 'rgba(234, 88, 12, 0.55)';
  bmdCtx.setLineDash([3, 3]);
  bmdCtx.beginPath();
  bmdCtx.moveTo(noseX, 4);
  bmdCtx.lineTo(noseX, H - 4);
  bmdCtx.stroke();
  bmdCtx.setLineDash([]);

  // 曲げモーメント BMD（橙）
  bmdCtx.strokeStyle = '#f59e0b';
  bmdCtx.lineWidth = 1.6;
  bmdCtx.beginPath();
  for (let i = 0; i < n; i++) {
    const px = 8 + (i / (n - 1)) * (W - 16);
    // 負曲げを上側、正曲げを下側（構造力学慣習）
    const py = midY + (mech.M_knm[i] / 14000.0) * (H * 0.40);
    if (i === 0) bmdCtx.moveTo(px, py);
    else bmdCtx.lineTo(px, py);
  }
  bmdCtx.stroke();

  // 弾性たわみ曲線（シアン・下向きが下）
  bmdCtx.strokeStyle = '#38bdf8';
  bmdCtx.lineWidth = 2.0;
  bmdCtx.beginPath();
  for (let i = 0; i < n; i++) {
    const px = 8 + (i / (n - 1)) * (W - 16);
    const py = midY - (mech.w_mm[i] / 850.0) * (H * 0.44);
    if (i === 0) bmdCtx.moveTo(px, py);
    else bmdCtx.lineTo(px, py);
  }
  bmdCtx.stroke();
}

function updateMechanicsHUD(mech, noseVisible, isCompleted, isJackdown = false, jackRemainM = 0.0, deckPourCount = -1) {
  const allow = state.meta?.mechanics?.allowable_patch_load_kn ?? 1850;
  if (!mech || isCompleted || deckPourCount >= 0) {
    const isDeckPhase = deckPourCount >= 0 && !isCompleted;
    document.getElementById('m-xfront').textContent = isCompleted || isDeckPhase ? '136.0 m' : '---';
    document.getElementById('m-xtip').textContent = isCompleted || isDeckPhase ? '解体済' : '---';
    document.getElementById('m-defl').textContent = isDeckPhase ? `打設 ${deckPourCount}/8` : '0.0 mm';
    document.getElementById('m-patch').textContent = isCompleted ? '合成床版済' : isDeckPhase ? '配筋・打設' : '0.0 %';
    document.getElementById('m-negm').textContent = isCompleted ? '完成供用中' : isDeckPhase ? '床版コンクリート打設中' : '待機中';
    ['A1', 'P1', 'P2', 'A2'].forEach((k) => {
      document.getElementById(`bar-${k}`).style.width = isCompleted || isDeckPhase ? '55%' : '0%';
      document.getElementById(`val-${k}`).textContent = isCompleted || isDeckPhase ? '着座済' : '0 kN';
    });
    drawBmdCanvas(null);
    return;
  }

  document.getElementById('m-xfront').textContent = `${mech.x_front.toFixed(1)} m`;
  document.getElementById('m-xtip').textContent = noseVisible ? `${mech.x_tip.toFixed(1)} m` : '解体済';
  if (isJackdown) {
    document.getElementById('m-defl').textContent = `残 ${jackRemainM.toFixed(2)} m`;
    document.getElementById('m-patch').textContent = '降下中';
  } else {
    document.getElementById('m-defl').textContent = `${mech.tip_deflection_mm.toFixed(0)} mm`;
    document.getElementById('m-patch').textContent = `${mech.patch_ratio_pct.toFixed(1)} %`;
  }
  document.getElementById('m-negm').textContent = `Max -M: ${Math.round(mech.max_neg_moment_knm).toLocaleString()} kN·m`;

  ['A1', 'P1', 'P2', 'A2'].forEach((k) => {
    const rv = mech.reactions_kn[k] ?? 0;
    const pct = Math.min(100, (rv / allow) * 100);
    document.getElementById(`bar-${k}`).style.width = `${pct.toFixed(1)}%`;
    document.getElementById(`val-${k}`).textContent = `${Math.round(rv)} kN`;
  });
  drawBmdCanvas(mech);
}

// ---- 連続タイムライン u ∈ [0, 1] からの全シーン精密更新 ----
function applySimulationAt(uRaw) {
  if (!state.meta) return;
  const u = Math.max(0.0, Math.min(1.0, Number(uRaw)));
  state.u = u;
  document.getElementById('timeline-slider').value = String(Math.round(u * 1000));

  const br = state.meta.bridge;
  const L_tot = br.total_length_m;         // 136.0
  const L_stg = L_tot / 3.0;               // 45.3333
  const L_nose = state.meta.launching_nose.length_m; // 34.0
  const yLaunch = br.launch_soffit_y;      // 14.60
  const yFinal = br.final_soffit_y;        // 13.45

  // 該当ステージ判定
  const stages = state.meta.stages;
  let activeStage = stages[stages.length - 1];
  for (const st of stages) {
    if (u >= st.u_start && (u < st.u_end || st.id === stages.length - 1)) {
      activeStage = st;
      break;
    }
  }
  document.getElementById('stage-name').textContent = activeStage.name;
  document.getElementById('stage-desc').textContent = activeStage.desc;
  document.querySelectorAll('.stage-item').forEach((el) => el.classList.toggle('active', Number(el.dataset.id) === activeStage.id));

  // 各物理量の計算
  let xFront = 0.0;
  let ySoffit = yLaunch;
  let visibleBlocks = 0;    // 0..12
  let assemblingBlock = 0;  // クレーン降下中ブロック番号 (1..12)
  let assembleDropY = 0.0;
  let showNose = false;
  let noseLiftY = 0.0;
  let launchStageForMech = 1;
  let activeMech = null;
  let isJackdown = false;
  let jackdownT = 0.0;
  let visibleRebar = 0;      // STAGE 9: 上側配筋進捗 (0..8)
  let visibleConc = 0;       // STAGE 9: 現場打ち床版コンクリート打設進捗 (0..8)
  let isDeckPourPhase = false;
  let isCompleted = false;

  if (u < 0.05) {
    // Stage 1: 仮設工のみ
    visibleBlocks = 0;
    showNose = false;
  } else if (u < 0.12) {
    // Stage 2: 1次地組（手延べ機 + G1..G4 を順次クレーン上架！）
    const t = (u - 0.05) / 0.07;
    xFront = 0.0;
    showNose = true;
    const stepF = t * 5.0; // 0..1: nose, 1..5: G1..G4
    if (stepF < 1.0) {
      noseLiftY = (1.0 - stepF) * 4.5;
      visibleBlocks = 0;
    } else {
      visibleBlocks = Math.min(4, Math.ceil(stepF - 1.0));
      assemblingBlock = visibleBlocks;
      assembleDropY = (1.0 - ((stepF - 1.0) % 1.0 || 1.0)) * 4.0;
    }
    activeMech = sampleMechanics(1, 0.0);
  } else if (u < 0.28) {
    // Stage 3: 1次送り出し (0 -> 45.33m, P1到達!)
    const t = (u - 0.12) / 0.16;
    xFront = t * L_stg;
    visibleBlocks = 4;
    showNose = true;
    launchStageForMech = 1;
    activeMech = sampleMechanics(1, xFront);
  } else if (u < 0.35) {
    // Stage 4: 2次地組 (G5..G8 を空いたヤードへ上架連結!)
    const t = (u - 0.28) / 0.07;
    xFront = L_stg;
    showNose = true;
    const f = t * 4.0;
    visibleBlocks = 4 + Math.min(4, Math.ceil(f));
    assemblingBlock = visibleBlocks;
    assembleDropY = (1.0 - (f % 1.0 || 1.0)) * 4.0;
    activeMech = sampleMechanics(1, L_stg);
  } else if (u < 0.54) {
    // Stage 5: 2次送り出し (45.33 -> 90.67m, 52m低水路横断 -> P2到達!)
    const t = (u - 0.35) / 0.19;
    xFront = L_stg + t * L_stg;
    visibleBlocks = 8;
    showNose = true;
    launchStageForMech = 2;
    activeMech = sampleMechanics(2, xFront);
  } else if (u < 0.61) {
    // Stage 6: 3次地組 (G9..G12 上架・全長136m一体化!)
    const t = (u - 0.54) / 0.07;
    xFront = L_stg * 2.0;
    showNose = true;
    const f = t * 4.0;
    visibleBlocks = 8 + Math.min(4, Math.ceil(f));
    assemblingBlock = visibleBlocks;
    assembleDropY = (1.0 - (f % 1.0 || 1.0)) * 4.0;
    activeMech = sampleMechanics(2, L_stg * 2.0);
  } else if (u < 0.76) {
    // Stage 7: 最終送り出し (90.67 -> 136.0m, 右岸道路横断 -> A2到達!)
    const t = (u - 0.61) / 0.15;
    xFront = L_stg * 2.0 + t * L_stg;
    visibleBlocks = 12;
    showNose = true;
    launchStageForMech = 3;
    activeMech = sampleMechanics(3, xFront);
  } else if (u < 0.85) {
    // Stage 8: 手延べ機解体(0.76..0.80) -> サンドル・ジャッキダウン降下(0.80..0.85: -1.15m!)
    xFront = L_tot;
    visibleBlocks = 12;
    activeMech = sampleMechanics(3, L_tot);
    if (u < 0.80) {
      const t = (u - 0.76) / 0.04;
      showNose = true;
      noseLiftY = t * 8.5;
      ySoffit = yLaunch;
    } else {
      const t = (u - 0.80) / 0.05;
      showNose = false;
      isJackdown = true;
      jackdownT = Math.max(0.0, Math.min(1.0, t));
      ySoffit = yLaunch - (yLaunch - yFinal) * jackdownT;
    }
  } else if (u < 0.93) {
    // Stage 9: 先行敷設済み底鋼板パネル上への上側配筋 ＆ 現場打ち床版コンクリート順次打設（A1 -> A2）
    const t = (u - 0.85) / 0.08;
    xFront = L_tot;
    ySoffit = yFinal;
    visibleBlocks = 12;
    showNose = false;
    isDeckPourPhase = true;
    visibleRebar = Math.min(8, Math.max(1, Math.ceil(t * 14.0)));
    visibleConc = Math.min(8, Math.max(0, Math.floor(((t - 0.14) / 0.86) * 8.0) + 1));
  } else {
    // Stage 10: 床版打設完了・仮設全撤去・壁高欄・2車線舗装・アプローチ接続・完成供用!
    xFront = L_tot;
    ySoffit = yFinal;
    visibleBlocks = 12;
    showNose = false;
    visibleRebar = 8;
    visibleConc = 8;
    isCompleted = true;
  }

  // 可動グループの位置更新
  state.movingGroup.position.set(xFront, ySoffit, 0);

  // リアルタイム弾性たわみ変形（送り出しステージ中のみ滑らかに変形、降下・床版・完成後はゼロ）
  const applyDefl = activeMech !== null && !isCompleted && !isJackdown && !isDeckPourPhase;
  const gLenCur = applyDefl ? activeMech.girder_len : L_tot;
  const totCur = gLenCur + L_nose;

  for (const dt of state.deformTargets) {
    const posAttr = dt.mesh.geometry.attributes.position;
    const orig = dt.origPos;
    const arr = posAttr.array;

    if (dt.kind === 'nose') {
      const extraY = noseLiftY;
      for (let i = 0; i < arr.length; i += 3) {
        const lx = orig[i];
        let dy = extraY;
        if (applyDefl && noseLiftY < 0.01) {
          const sNorm = (lx + gLenCur) / Math.max(totCur, 1.0);
          dy += interpDeflectionMeters(activeMech, sNorm);
        }
        arr[i + 1] = orig[i + 1] + dy;
      }
      posAttr.needsUpdate = true;
    } else {
      const dropY = dt.blkIndex === assemblingBlock ? assembleDropY : 0.0;
      for (let i = 0; i < arr.length; i += 3) {
        const lx = orig[i];
        let dy = dropY;
        if (applyDefl && dropY < 0.01 && dt.blkIndex <= Math.round(gLenCur / (L_tot / 12.0))) {
          const sNorm = (lx + gLenCur) / Math.max(totCur, 1.0);
          dy += interpDeflectionMeters(activeMech, sNorm);
        }
        arr[i + 1] = orig[i + 1] + dy;
      }
      posAttr.needsUpdate = true;
    }
  }

  // A1 油圧押し出し装置 可動ラム＆油圧グリッパーのステップ往復伸縮アニメーション（1.35mサイクル）
  const isLaunching = (u >= 0.12 && u < 0.28) || (u >= 0.35 && u < 0.54) || (u >= 0.61 && u < 0.76);
  if (isLaunching) {
    const ph = (xFront % 1.35) / 1.35;
    const stroke = ph < 0.80 ? (ph / 0.80) * 1.12 : (1.0 - (ph - 0.80) / 0.20) * 1.12;
    state.pusherRamGroup.position.x = stroke;
  } else {
    state.pusherRamGroup.position.x = 0.48;
  }

  // 地組ヤード 8輪ボギー送り出し台車ペア × 4組（2条クレーン軌条 -59.0..-12.5m 上を桁と連動走行！）
  const railMin = -59.0;
  const railSpan = 46.5;
  for (let k = 0; k < state.trolleyGroups.length; k++) {
    const baseOff = (k + 0.5) * (railSpan / state.trolleyGroups.length);
    const tx = railMin + (((baseOff + xFront) % railSpan) + railSpan) % railSpan;
    state.trolleyGroups[k].position.x = tx;
  }

  // 全ノードの可視性更新
  state.nodes.forEach((obj, name) => {
    const lk = getLayerKey(name);
    let vis = lk in state.layerVisible ? state.layerVisible[lk] : true;

    if (name.startsWith('girder_')) {
      const m = name.match(/_(\d{2})$/);
      const bi = m ? parseInt(m[1], 10) : 1;
      vis = vis && bi <= visibleBlocks;
      // 底鋼板上面のずれ止めTリブは完成(STAGE 10)でコンクリート内埋設、仮設安全手すりもSTAGE 10で壁高欄へ置換！
      if (name.startsWith('girder_deckribs_') && isCompleted) vis = false;
      if (name.startsWith('girder_safety_') && isCompleted) vis = false;
    } else if (name.startsWith('launching_nose')) {
      vis = vis && showNose;
    } else if (name.startsWith('deck_rebar_')) {
      // 上側鉄筋（STAGE 9 で先行配筋、コンクリート打設済みブロックでは内部へ埋設！）
      const dm = name.match(/_(\d{2})$/);
      const di = dm ? parseInt(dm[1], 10) : 1;
      vis = vis && isDeckPourPhase && di <= visibleRebar && di > visibleConc;
    } else if (name.startsWith('deck_conc_')) {
      // 現場打ち床版コンクリート（STAGE 9 で A1->A2 へ順次打設、STAGE 10 で全区間完成！）
      const dm = name.match(/_(\d{2})$/);
      const di = dm ? parseInt(dm[1], 10) : 1;
      vis = vis && (isCompleted || (isDeckPourPhase && di <= visibleConc));
    } else if (name.startsWith('deck_') || name.endsWith('_parapet')) {
      vis = vis && isCompleted;
    } else if (name.startsWith('temp_rollers_')) {
      vis = vis && !isJackdown && !isDeckPourPhase && !isCompleted;
    } else if (name === 'temp_jackdown_sandles_hi') {
      vis = vis && isJackdown && jackdownT < 0.52;
    } else if (name === 'temp_jackdown_sandles_lo') {
      vis = vis && isJackdown;
    } else if (name === 'temp_jackdown_jacks' || name === 'temp_jackdown_beams') {
      vis = vis && isJackdown;
      if (vis) obj.position.y = ySoffit;
    } else if (name.startsWith('temp_')) {
      vis = vis && !isCompleted;
    }
    obj.visible = vis;
  });

  // 完成時は仮設ラベルを自動整理
  for (const item of labelElems) {
    if (item.id === 'YARD' || item.id === 'DISM' || item.id === 'PUSHER' || item.id === 'TROLLEY') {
      item.hiddenByStage = isCompleted;
    } else if (item.id === 'P1') {
      item.el.textContent = isCompleted || isDeckPourPhase ? 'P1橋脚 (X=42m)' : item.origText;
    } else if (item.id === 'ROAD_L') {
      item.el.textContent = isCompleted ? '供用中 左岸堤防道路' : item.origText;
    } else if (item.id === 'ROAD_R') {
      item.el.textContent = isCompleted ? '供用中 右岸堤防道路' : item.origText;
    }
  }

  // カメラ自動追従モード（手延べ機先端を追跡）
  if (state.followTip && showNose && !isCompleted) {
    const tipWorldX = xFront + L_nose * 0.72;
    controls.target.set(tipWorldX, 14.5, 0);
  }

  updateMechanicsHUD(activeMech, showNose, isCompleted, isJackdown, Math.max(0, ySoffit - yFinal), isDeckPourPhase ? visibleConc : -1);
}

// ---- ラベル構築＆投影 ----
const labelElems = [];
function buildLabels(meta) {
  labelsLayer.innerHTML = '';
  labelElems.length = 0;
  for (const lb of meta.labels || []) {
    const el = document.createElement('div');
    el.className = 'label-3d';
    el.textContent = lb.text;
    labelsLayer.appendChild(el);
    labelElems.push({ id: lb.id, origText: lb.text, hiddenByStage: false, el, pos: new THREE.Vector3(...lb.pos) });
  }
}

const _proj = new THREE.Vector3();
function updateLabels() {
  if (!state.layerVisible.labels) {
    labelsLayer.style.display = 'none';
    return;
  }
  labelsLayer.style.display = 'block';
  const w = container.clientWidth;
  const h = container.clientHeight;
  for (const item of labelElems) {
    if (item.hiddenByStage) {
      item.el.style.display = 'none';
      continue;
    }
    _proj.copy(item.pos).project(camera);
    if (_proj.z > 1 || _proj.z < -1) {
      item.el.style.display = 'none';
      continue;
    }
    item.el.style.display = 'block';
    item.el.style.left = `${(_proj.x * 0.5 + 0.5) * w}px`;
    item.el.style.top = `${(-_proj.y * 0.5 + 0.5) * h}px`;
  }
}

// ---- UI 結線 ----
function renderSideUI(meta) {
  const sl = document.getElementById('stage-list');
  sl.innerHTML = meta.stages
    .map((s) => `<button class="stage-item" data-id="${s.id}" data-u="${(s.u_start + s.u_end) * 0.5}">${s.name}</button>`)
    .join('');
  sl.querySelectorAll('.stage-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const st = meta.stages[Number(btn.dataset.id)];
      const isLast = st.id === meta.stages.length - 1;
      const targetU = st.id === 0 ? 0.02 : isLast ? 0.98 : st.u_start + (st.u_end - st.u_start) * 0.65;
      applySimulationAt(targetU);
    });
  });

  const q = meta.quantities;
  const qs = q.summary;
  document.getElementById('qty-cards').innerHTML = `
    <div class="qty-card"><div class="k">橋長 / 鋼重</div><div class="v">${qs.bridge_length_m}m / ${qs.steel_weight_t}t</div></div>
    <div class="qty-card"><div class="k">手延べ機</div><div class="v">${qs.nose_length_m}m / ${qs.nose_weight_t}t</div></div>
    <div class="qty-card"><div class="k">最大先端たわみ</div><div class="v" style="color:#fbbf24">-${qs.max_tip_deflection_mm} mm</div></div>
    <div class="qty-card"><div class="k">最大反力 / 照査</div><div class="v" style="color:#4ade80">${qs.max_pier_reaction_kn}kN (${qs.max_patch_ratio_pct}%)</div></div>
  `;
  document.querySelector('#qty-table tbody').innerHTML = q.items
    .map((it) => `<tr title="${it.note}"><td><strong>${it.name}</strong><br><span style="color:#94a3b8;font-size:9.5px">${it.note}</span></td><td class="num">${it.quantity}</td><td>${it.unit}</td></tr>`)
    .join('');
}

function bindUI() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });

  document.querySelectorAll('#camera-presets button').forEach((btn) => {
    btn.addEventListener('click', () => moveCameraTo(btn.dataset.cam));
  });

  document.querySelectorAll('input[data-layer]').forEach((inp) => {
    inp.addEventListener('change', () => {
      state.layerVisible[inp.dataset.layer] = inp.checked;
      applySimulationAt(state.u);
    });
  });

  document.getElementById('sim-speed').addEventListener('change', (e) => (state.speed = Number(e.target.value)));
  document.getElementById('defl-scale').addEventListener('change', (e) => {
    state.deflScale = Number(e.target.value);
    applySimulationAt(state.u);
  });
  document.getElementById('chk-follow-tip').addEventListener('change', (e) => (state.followTip = e.target.checked));

  const slider = document.getElementById('timeline-slider');
  slider.addEventListener('input', () => applySimulationAt(Number(slider.value) / 1000.0));

  const btnPlay = document.getElementById('btn-play');
  btnPlay.addEventListener('click', () => {
    state.playing = !state.playing;
    btnPlay.classList.toggle('playing', state.playing);
    btnPlay.textContent = state.playing ? '⏸ 一時停止' : '▶ 送り出し再生';
    if (state.playing && state.u >= 0.995) applySimulationAt(0.0);
  });

  document.getElementById('btn-prev').addEventListener('click', () => {
    const stages = state.meta?.stages || [];
    for (let i = stages.length - 1; i >= 0; i--) {
      if (stages[i].u_start < state.u - 0.01) {
        applySimulationAt(stages[i].u_start + 0.005);
        return;
      }
    }
    applySimulationAt(0.0);
  });
  document.getElementById('btn-next').addEventListener('click', () => {
    const stages = state.meta?.stages || [];
    for (const s of stages) {
      if (s.u_start > state.u + 0.01) {
        applySimulationAt(s.u_start + 0.01);
        return;
      }
    }
    applySimulationAt(0.99);
  });

  document.getElementById('btn-wireframe').addEventListener('click', (e) => {
    state.wireframe = !state.wireframe;
    e.currentTarget.classList.toggle('active', state.wireframe);
    scene.traverse((c) => {
      if (c.isMesh && c.material) c.material.wireframe = state.wireframe;
    });
  });

  document.getElementById('btn-screenshot').addEventListener('click', () => {
    renderer.render(scene, camera);
    const a = document.createElement('a');
    a.href = renderer.domElement.toDataURL('image/png');
    a.download = `bridge_launch_${Math.round(state.u * 100)}.png`;
    a.click();
  });
}

// ---- メインロード ----
async function init() {
  bindUI();
  const loadingText = document.getElementById('loading-text');
  try {
    const resp = await fetch('../output/viewer_data.json');
    state.meta = await resp.json();
    document.getElementById('project-title').textContent = state.meta.project.name;
    document.getElementById('project-subtitle').textContent = state.meta.project.subtitle;
    renderSideUI(state.meta);
    buildLabels(state.meta);

    loadingText.textContent = '3Dモデル（bridge_launching_viewer.glb）を展開中...';
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync('../output/bridge_launching_viewer.glb');

    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const toMove = [];
    const toPusherRam = [];
    const toTrolleys = [[], [], [], []];
    gltf.scene.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = !obj.name.startsWith('env_river_water');
        obj.receiveShadow = true;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          if (!m) continue;
          if (m.map) m.map.anisotropy = maxAniso;
          if (m.normalMap) m.normalMap.anisotropy = maxAniso;
        }
      }
      if (obj.name && obj !== gltf.scene) {
        if (!state.nodes.has(obj.name)) {
          state.nodes.set(obj.name, obj);
        }
        const pName = obj.parent?.name || '';
        const parentIsMoving = pName.startsWith('girder_') || pName.startsWith('launching_nose');
        if (!parentIsMoving && (obj.name.startsWith('girder_') || obj.name.startsWith('launching_nose'))) {
          toMove.push(obj);
        } else if (!pName.startsWith('temp_pusher_ram_') && obj.name.startsWith('temp_pusher_ram_')) {
          toPusherRam.push(obj);
        } else if (!pName.startsWith('temp_trolley_') && obj.name.startsWith('temp_trolley_')) {
          const tm = obj.name.match(/^temp_trolley_(\d{2})_/);
          if (tm) {
            const ti = parseInt(tm[1], 10) - 1;
            if (ti >= 0 && ti < toTrolleys.length) toTrolleys[ti].push(obj);
          }
        }
      }
    });

    scene.add(gltf.scene);

    // 押し出し装置 可動ラム＆油圧グリッパーをグループ化
    for (const obj of toPusherRam) state.pusherRamGroup.add(obj);
    // 地組ヤード 8輪ボギー送り出し台車ペア × 4組をグループ化
    for (let k = 0; k < toTrolleys.length; k++) {
      for (const obj of toTrolleys[k]) state.trolleyGroups[k].add(obj);
    }

    // 可動部（主桁12ブロック＋手延べ機）を movingGroup へ移し、弾性たわみ変形用の初期頂点座標をキャッシュ
    const seenMeshIds = new Set();
    for (const obj of toMove) {
      state.movingGroup.add(obj);
      const isNose = obj.name.startsWith('launching_nose');
      const m = obj.name.match(/_(\d{2})$/);
      const blkIdx = m ? parseInt(m[1], 10) : 0;
      obj.traverse((c) => {
        if (c.isMesh && c.geometry?.attributes?.position && !seenMeshIds.has(c.uuid)) {
          seenMeshIds.add(c.uuid);
          c.geometry = c.geometry.clone();
          const origPos = new Float32Array(c.geometry.attributes.position.array);
          state.deformTargets.push({ mesh: c, origPos, kind: isNose ? 'nose' : 'girder', blkIndex: blkIdx });
        }
      });
    }

    // 初期表示は一番ドラマチックな 2次送り出し・中央52m低水路横断＆最大たわみ（u = 0.410）！
    applySimulationAt(0.410);
    document.getElementById('loading-overlay').classList.add('hidden');
  } catch (err) {
    loadingText.textContent = `読み込みエラー: ${err.message}`;
    console.error(err);
  }
}

window.addEventListener('resize', () => {
  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(container.clientWidth, container.clientHeight);
});

let lastTime = performance.now();
function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (now - lastTime) / 1000.0);
  lastTime = now;

  if (state.playing) {
    const nextU = state.u + dt * 0.042 * state.speed;
    if (nextU >= 1.0) {
      applySimulationAt(1.0);
      state.playing = false;
      const bp = document.getElementById('btn-play');
      bp.classList.remove('playing');
      bp.textContent = '▶ 送り出し再生';
    } else {
      applySimulationAt(nextU);
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

// 自動録画・実機テスト用 API
window.__demoApi = {
  isReady: () => document.getElementById('loading-overlay').classList.contains('hidden'),
  setU: (u) => {
    applySimulationAt(u);
    renderer.render(scene, camera);
    updateLabels();
  },
  setDeflScale: (sc) => {
    state.deflScale = Number(sc);
    document.getElementById('defl-scale').value = Number(sc).toFixed(1);
    applySimulationAt(state.u);
    renderer.render(scene, camera);
  },
  setCamera: (pos, tgt) => {
    camAnim = null;
    camera.position.set(pos[0], pos[1], pos[2]);
    controls.target.set(tgt[0], tgt[1], tgt[2]);
    controls.update();
    renderer.render(scene, camera);
    updateLabels();
  },
  setLayer: (k, v) => {
    const inp = document.querySelector(`input[data-layer="${k}"]`);
    if (inp && inp.checked !== v) {
      inp.checked = v;
      inp.dispatchEvent(new Event('change'));
    }
  },
  setTab: (t) => {
    const b = document.querySelector(`.tab-btn[data-tab="${t}"]`);
    if (b) b.click();
  },
};
