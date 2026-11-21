import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// ---- グローバル状態 ----
const state = {
  meta: null,
  elBase: 245.0,
  step: 7,
  playing: false,
  playTimer: null,
  wireframe: false,
  measureMode: false,
  measurePts: [],
  selectedPartId: null,
  nodes: new Map(), // meshName -> THREE.Object3D
  layerVisible: {
    main_dam: true,
    joints_ws: true,
    sub_dam: true,
    apron: true,
    cutoff_vwall: true,
    swall_left: true,
    swall_right: true,
    left_levee: true,
    foot_prot: true,
    terrain: true,
    catwalk: false,
    color_blocks: false,
    excavation_vol: false,
    temp_site: false,
    crane_rings: false,
    contours: true,
    labels: true,
    water: true,
    water_flood: false,
    nature: true,
  },
  terrainOpacity: 1.0,
  simPlanCase: '150',
  dailySession: 0, // 0 = 通常4Dステップ連動, 1..N = 主堤日別打設3Dシミュレーション
  dailyPlaying: false,
  dailyTimer: null,
  simMethod: 'pump',
  simTemp: 'under25',
  simDailyLimit: 150,
  selectedLotId: null,
};

// ---- シーン・レンダラ初期化 ----
const container = document.getElementById('canvas-container');
const labelsLayer = document.getElementById('labels-layer');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xcbdbe8);
scene.fog = new THREE.FogExp2(0xcbdbe8, 0.0024);

const camera = new THREE.PerspectiveCamera(42, container.clientWidth / container.clientHeight, 0.3, 600);
camera.position.set(52, 34, 64);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true, // PNGスクリーンショット書き出し用
});
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;
renderer.localClippingEnabled = true;
container.appendChild(renderer.domElement);

// 環境光反射（PBR法線・コンクリート質感向上）
const pmremGen = new THREE.PMREMGenerator(renderer);
scene.environment = pmremGen.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 8;
controls.maxDistance = 240;
controls.target.set(3, 6.5, 6);
controls.update();

// ---- ライティング（日本の晴天山間渓流の自然光） ----
const hemiLight = new THREE.HemisphereLight(0xdceeff, 0x5c6854, 0.85);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(0xfff7e6, 2.05);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.near = 10;
sunLight.shadow.camera.far = 260;
const d = 78;
sunLight.shadow.camera.left = -d;
sunLight.shadow.camera.right = d;
sunLight.shadow.camera.top = d;
sunLight.shadow.camera.bottom = -d;
sunLight.shadow.bias = -0.0005;
scene.add(sunLight);

const fillLight = new THREE.DirectionalLight(0x9ec5e8, 0.42);
fillLight.position.set(-60, 35, -50);
scene.add(fillLight);

function updateSun(azDeg, elDeg) {
  const az = THREE.MathUtils.degToRad(azDeg);
  const el = THREE.MathUtils.degToRad(elDeg);
  const r = 115;
  sunLight.position.set(
    r * Math.cos(el) * Math.sin(az),
    r * Math.sin(el),
    r * Math.cos(el) * Math.cos(az)
  );
}
updateSun(138, 46);

// ---- 3軸クリッピングプレーン ----
const clipPlanes = {
  x: new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0),
  z: new THREE.Plane(new THREE.Vector3(0, 0, -1), 8),
  y: new THREE.Plane(new THREE.Vector3(0, -1, 0), 10),
};
const clipEnabled = { x: false, z: false, y: false };

function getActiveClipPlanes() {
  const list = [];
  if (clipEnabled.x) list.push(clipPlanes.x);
  if (clipEnabled.z) list.push(clipPlanes.z);
  if (clipEnabled.y) list.push(clipPlanes.y);
  return list;
}

function applyClippingToAll() {
  const active = getActiveClipPlanes();
  state.nodes.forEach((obj) => {
    obj.traverse((child) => {
      if (child.isMesh && child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m) => {
          m.clippingPlanes = active;
          m.clipShadows = true;
        });
      }
    });
  });
}

// ---- 補助オーバーレイグループ ----
const contoursGroup = new THREE.Group();
const craneRingsGroup = new THREE.Group();
const measureGroup = new THREE.Group();
scene.add(contoursGroup, craneRingsGroup, measureGroup);

// ---- カメラプリセット ----
const CAMERA_PRESETS = {
  iso_left: { pos: [50, 33, 62], target: [3, 6.5, 6] },
  iso_right: { pos: [-56, 36, 56], target: [2, 6.0, 6] },
  front: { pos: [2, 16, 62], target: [2, 6.5, 0] },
  upstream: { pos: [42, 34, -56], target: [4, 7.5, -4] },
  section_long: { pos: [64, 17, 10], target: [0, 6.0, 8] },
  plan: { pos: [4, 132, 8], target: [4, 4.0, 6] },
  levee_wall: { pos: [28, 18, 36], target: [10, 6.5, 6] },
  yard: { pos: [48, 22, 46], target: [18, 6.5, 16] },
};

let camAnim = null;
function moveCameraTo(presetKey) {
  const p = CAMERA_PRESETS[presetKey];
  if (!p) return;
  camAnim = {
    startPos: camera.position.clone(),
    endPos: new THREE.Vector3(...p.pos),
    startTarget: controls.target.clone(),
    endTarget: new THREE.Vector3(...p.target),
    t: 0,
  };
  document.querySelectorAll('#camera-presets button').forEach((b) => {
    b.classList.toggle('active', b.dataset.cam === presetKey);
  });
}

// ---- ノード名から工種レイヤー・施工ステップ可視性を判定 ----
function getLayerKey(name) {
  if (name.endsWith('_joints') || name.endsWith('_waterstops') || name.endsWith('_joints_step4') || name.endsWith('_waterstops_step4')) return 'joints_ws';
  if (name.startsWith('main_dam')) return 'main_dam';
  if (name.startsWith('sub_dam')) return 'sub_dam';
  if (name.startsWith('apron') || name === 'sub_apron') return 'apron';
  if (name === 'cutoff_vertical_wall') return 'cutoff_vwall';
  if (name.startsWith('side_wall_left') || name === 'side_wall_weep_pipes') return 'swall_left';
  if (name.startsWith('side_wall_right')) return 'swall_right';
  if (name.startsWith('left_bank_levee')) return 'left_levee';
  if (name === 'foot_protection') return 'foot_prot';
  if (name.startsWith('terrain_')) return 'terrain';
  if (name === 'excavation_volume') return 'excavation_vol';
  if (name.startsWith('temp_catwalk')) return 'catwalk';
  if (name.startsWith('temp_')) return 'temp_site';
  if (name === 'water_flood') return 'water_flood';
  if (name.startsWith('water_')) return 'water';
  if (name.startsWith('env_')) return 'nature';
  return 'other';
}

function isDiversionNode(name) {
  return (
    name === 'temp_cofferdam_p1' ||
    name.startsWith('temp_pipe_step') ||
    name.startsWith('temp_dewater_') ||
    name.startsWith('temp_notch_') ||
    name.startsWith('temp_divert_')
  );
}

function isVisibleAtStep(name, step) {
  // 地形の切替（上面＋側面地質断面ペア）
  if (name === 'terrain_existing' || name === 'terrain_existing_sides') return step <= 1;
  if (name === 'terrain_excavated' || name === 'terrain_excavated_sides') return step >= 2 && step <= 5;
  if (name === 'terrain_final' || name === 'terrain_final_sides') return step >= 6;
  if (name === 'excavation_volume') return state.layerVisible.excavation_vol;

  // 渓流水の段階切替（平常時 / 初期直置き管 / 現況河床到達前仮設管 / 仮水通しの段自然越流 / 水抜き孔自然流下 / 出水時）
  if (name === 'water_existing') return step === 0;
  if (name === 'water_phase1_flow') return step === 1 || step === 2;
  if (name === 'water_divert_B3') return step === 3;
  if (name === 'water_divert_B2') return false; // 日別3D打設再生のB3打設日(L2到達前)に切替出現
  if (name === 'water_temp_spillway_natural') return step === 4; // 現況河床L2到達＋仮水通しの段確保 → 水替え不要・自然越流！
  if (name === 'water_construction_natural') return step === 5;  // 主堤完成・水叩き未施工 → 下段水抜き孔から掘削底へ自然流下
  if (name === 'water_step6_apron_drain') return step === 6;     // 水叩き最後仕上げ後 → 下段水抜き孔から水叩き天端へ自然流下
  if (name === 'water_completed' || name === 'water_falls') return step === 7 && !state.layerVisible.water_flood;
  if (name === 'water_flood') return step === 7 && state.layerVisible.water_flood;

  // キャットウォーク＆昇降階段塔（STEP 4では下部2段＋昇降塔、STEP 5で全4段完成、強制表示ONなら全4段）
  if (name.startsWith('temp_catwalk_upper')) {
    return step === 5 || state.layerVisible.catwalk;
  }
  if (name.startsWith('temp_catwalk')) {
    return step === 4 || step === 5 || state.layerVisible.catwalk;
  }

  // ---- 段階的 地面直置き仮設排水・床掘り釜場（現況河床 L2 到達＆仮水通しの段確保で STEP 4 から完全撤去・水替え不要！） ----
  // STEP 1: 上流全面締切 ＋ 現況河床(水通し側)へ地面ベタ置き真っ直ぐ通し
  if (name === 'temp_cofferdam_p1') return step === 1 || step === 2;
  if (name === 'temp_pipe_step1' || name === 'temp_pipe_step1_bags') return step === 1;
  // STEP 2: 床掘りに合わせて掘削底(水通しB3側)の地面へ降ろして真っ直ぐ敷設替え
  if (name === 'temp_pipe_step2' || name === 'temp_pipe_step2_bags') return step === 2;

  // 床掘り水替え（上流基礎釜場・水中ポンプ・地面這わせ揚水ホース・ノッチタンク：STEP 2〜3 稼働）
  if (
    name === 'temp_dewater_sump_us' ||
    name === 'temp_dewater_pump_us' ||
    name === 'temp_dewater_mud_us' ||
    name === 'temp_dewater_hose_us' ||
    name.startsWith('temp_notch_')
  ) {
    return step === 2 || step === 3;
  }
  // 床掘り水替え（先端垂直壁根入れ最深部釜場・水中ポンプ・ホース：STEP 2 床掘工限定）
  if (
    name === 'temp_dewater_sump_vwall' ||
    name === 'temp_dewater_pump_vwall' ||
    name === 'temp_dewater_mud_vwall' ||
    name === 'temp_dewater_hose_vwall'
  ) {
    return step === 2;
  }
  // STEP 3（現況河床未満 L1 施工中のみ）: 半川導流土のう ＋ 仮水通しB3側(低段L1上土のう枕直置き)→完成主水叩きへ放流
  // ※STEP 4以降は現況河床(L2=EL.247.90m)到達＆仮水通しの段確保により仮設排水・締切は完全撤去（水替え不要）！
  if (name === 'temp_divert_coffer_B3' || name === 'temp_divert_pipe_B3_low' || name === 'temp_divert_bags_B3_low') {
    return step === 3;
  }
  if (name.startsWith('temp_divert_')) {
    return false;
  }

  // その他仮設設備・重機（ヤード・事務所・クレーン・バックホウ・ミキサー車）
  if (name === 'temp_backhoe_body' || name === 'temp_backhoe_parts') {
    return step === 2 || step === 3 || state.layerVisible.temp_site;
  }
  if (name.startsWith('temp_')) {
    return (step >= 1 && step <= 6) || state.layerVisible.temp_site;
  }

  // 構造物の段階施工（主堤を最初に上げ、水叩き・副堤・垂直壁・側壁は最後 STEP 6 で仕上げ！）
  if (name === 'apron_slab' || name === 'apron_baffles' || name === 'sub_apron' || name === 'cutoff_vertical_wall') return step >= 6;

  // 主堤ブロック×リフト個別判定（千鳥打設：STEP 3=L1、STEP 4=B1/B4 L4・B2 L3・B3 L2、STEP 5=全完成）
  if (state.meta?.lot_step_map && name in state.meta.lot_step_map) {
    return step >= state.meta.lot_step_map[name];
  }
  // 鉛直目地＆止水板（STEP 4 は打設済高＋止水板65cm先出し、STEP 5以降は全高）
  if (name === 'main_dam_joints_step4' || name === 'main_dam_waterstops_step4') return step === 4;
  if (name === 'main_dam_joints' || name === 'main_dam_waterstops') return step >= 5;
  if (name === 'main_dam_drains') return step >= 5;

  // 副堤・側壁・左岸堤も主堤完成後の STEP 6 で仕上げ
  if (name.startsWith('sub_dam_')) return step >= 6;
  if (name.startsWith('side_wall_')) return step >= 6;
  if (name.startsWith('left_bank_levee')) return step >= 6;
  if (name === 'foot_protection') return step >= 7;

  if (name.startsWith('env_boulders')) return step === 0 || step >= 6;
  if (name.startsWith('env_')) return true;

  return true;
}

function getActiveDailySchedule() {
  const pp = state.meta?.pouring_plan;
  if (!pp) return null;
  return state.simPlanCase === '110' ? pp.daily_schedule_110 : pp.daily_schedule_150;
}

function updateSceneVisibility() {
  const sched = state.dailySession > 0 ? getActiveDailySchedule() : null;
  const activeDay = sched ? sched.days[state.dailySession - 1] : null;
  const todayLots = new Set(activeDay ? activeDay.lot_ids : []);
  const lotToSes = sched ? sched.lot_to_session : null;
  const dMode = activeDay ? activeDay.diversion_mode : null;
  const maxLiftReached = activeDay ? Math.max(...Object.values(activeDay.state_lifts || { 1: 0 })) : 0;

  state.nodes.forEach((obj, name) => {
    const lk = getLayerKey(name);
    let vis = isVisibleAtStep(name, state.step);

    // 日別打設シミュレーションモード中（dailySession > 0）：主堤ブロック＋段階的水替え・切り回しを1日単位で精密制御！
    if (sched && lotToSes && name in lotToSes) {
      vis = lotToSes[name] <= state.dailySession && state.layerVisible.main_dam;
    } else if (sched && (name === 'main_dam_joints' || name === 'main_dam_waterstops')) {
      vis = state.dailySession >= sched.total_sessions && state.layerVisible.joints_ws;
    } else if (sched && (name === 'main_dam_joints_step4' || name === 'main_dam_waterstops_step4')) {
      vis = state.dailySession < sched.total_sessions && state.dailySession >= 3 && state.layerVisible.joints_ws;
    } else if (sched && name === 'main_dam_drains') {
      vis = (dMode === 'phase3_none_natural' || (activeDay?.state_lifts?.[2] >= 3 && activeDay?.state_lifts?.[3] >= 3)) && state.layerVisible.main_dam;
    } else if (sched && name.startsWith('temp_catwalk_upper')) {
      vis = (maxLiftReached >= 5 || state.layerVisible.catwalk);
    } else if (sched && name.startsWith('temp_catwalk')) {
      vis = (maxLiftReached >= 2 || state.layerVisible.catwalk);
    } else if (sched && isDiversionNode(name)) {
      const pLv = activeDay?.diversion_pipe_level || 'low';
      if (dMode === 'phase1_bypass_pump') {
        vis =
          name === 'temp_divert_coffer_B3' ||
          name === 'temp_divert_pipe_B3_low' ||
          name === 'temp_divert_bags_B3_low' ||
          name === 'temp_dewater_sump_us' ||
          name === 'temp_dewater_pump_us' ||
          name === 'temp_dewater_mud_us' ||
          name === 'temp_dewater_hose_us' ||
          name.startsWith('temp_notch_');
      } else if (dMode === 'phase2_through_B3') {
        vis =
          name === 'temp_divert_coffer_B3' ||
          name === (pLv === 'mid' ? 'temp_divert_pipe_B3_mid' : 'temp_divert_pipe_B3_low') ||
          name === (pLv === 'mid' ? 'temp_divert_bags_B3_mid' : 'temp_divert_bags_B3_low');
      } else if (dMode === 'phase2_through_B2') {
        vis =
          name === 'temp_divert_coffer_B2' ||
          name === (pLv === 'mid' ? 'temp_divert_pipe_B2_mid' : 'temp_divert_pipe_B2_low') ||
          name === (pLv === 'mid' ? 'temp_divert_bags_B2_mid' : 'temp_divert_bags_B2_low');
      } else {
        // phase3_temp_spillway_natural / phase3_none_natural: 現況河床到達＆仮水通しの段確保により仮設排水・締切はすべて不要・完全撤去！
        vis = false;
      }
    } else if (
      sched &&
      (name === 'water_phase1_flow' ||
        name === 'water_divert_B3' ||
        name === 'water_divert_B2' ||
        name === 'water_temp_spillway_natural' ||
        name === 'water_construction_natural' ||
        name === 'water_step6_apron_drain')
    ) {
      if (dMode === 'phase1_bypass_pump' || dMode === 'phase2_through_B3') vis = name === 'water_divert_B3' && state.layerVisible.water;
      else if (dMode === 'phase2_through_B2') vis = name === 'water_divert_B2' && state.layerVisible.water;
      else if (dMode === 'phase3_temp_spillway_natural') vis = name === 'water_temp_spillway_natural' && state.layerVisible.water;
      else if (dMode === 'phase3_none_natural') vis = name === 'water_construction_natural' && state.layerVisible.water;
      else vis = false;
    } else if (lk === 'excavation_vol') {
      vis = state.layerVisible.excavation_vol;
    } else if (lk === 'temp_site' || lk === 'catwalk') {
      vis = isVisibleAtStep(name, state.step);
    } else if (lk in state.layerVisible) {
      vis = vis && state.layerVisible[lk];
    }

    obj.visible = vis;

    // 当日同時打設ブロックを鮮やかなオレンジにハイライト！
    if (sched && lotToSes && name in lotToSes) {
      obj.traverse((c) => {
        if (c.isMesh && c.material && c.material.emissive) {
          c.material.emissive.setHex(todayLots.has(name) ? 0xb45309 : 0x000000);
        }
      });
    }
  });

  contoursGroup.visible = state.layerVisible.contours;
  craneRingsGroup.visible = state.layerVisible.crane_rings || (state.step >= 3 && state.step <= 6 && state.layerVisible.temp_site);
  labelsLayer.style.display = state.layerVisible.labels ? 'block' : 'none';
}

function setDailySession(sessionNum) {
  const sched = getActiveDailySchedule();
  if (!sched) return;
  const maxS = sched.total_sessions;
  state.dailySession = Math.max(0, Math.min(maxS, Number(sessionNum)));
  const sl = document.getElementById('daily-session-slider');
  const tx = document.getElementById('daily-session-txt');
  if (sl) {
    sl.max = String(maxS);
    sl.value = String(state.dailySession);
  }
  if (state.dailySession === 0) {
    if (tx) tx.textContent = '通常';
    clearSelectionHighlight();
    document.getElementById('inspector-hud').classList.add('hidden');
    updateSceneVisibility();
    renderPouringPlanUI();
    return;
  }

  // 施工中背景（STEP 4 地形・仮設・キャットウォーク）へ自動切り替え
  if (state.step !== 4 && state.step !== 5) {
    state.step = 4;
    document.getElementById('step-slider').value = '4';
  }
  const d = sched.days[state.dailySession - 1];
  if (tx) tx.textContent = `第${d.session}回`;
  document.getElementById('step-name').textContent =
    `日別打設 第${d.session}回 (Day ${d.cal_day}): ${d.lot_labels.join(' + ')} [${d.total_volume_m3}m³]`;
  document.getElementById('step-desc').textContent =
    `${d.diversion_label} ／ 仮水通し 幅${d.temp_spillway_width_m}m・深さ${d.temp_spillway_depth_m}m`;

  const divBadgeCls =
    d.diversion_mode === 'phase3_none_natural' || d.diversion_mode === 'phase3_temp_spillway_natural'
      ? 'st-ok'
      : d.diversion_mode === 'phase1_bypass_pump'
      ? 'st-warn'
      : '';
  document.getElementById('insp-title').textContent =
    `📅 第${d.session}回打設（Day ${d.cal_day}・${d.is_multi_block ? `${d.block_count}ブロック同時` : '単独'}）`;
  document.getElementById('insp-body').innerHTML = `
    <div><strong>${d.lot_labels.join(' ＋ ')}</strong> <span class="st-badge ${d.is_multi_block ? 'st-ok' : 'st-warn'}">${d.status}</span></div>
    <div class="insp-kv">
      <span class="k">日合算打設量</span><span class="v">${d.total_volume_m3.toFixed(1)} m³（上限 ${sched.daily_limit_m3} m³）</span>
      <span class="k">10t生コン車</span><span class="v">${d.trucks_10t} 台 / 所要 ${d.work_hours.toFixed(1)} h</span>
      <span class="k">左右袖天端</span><span class="v">EL.${d.wing_el_m.toFixed(2)} m</span>
      <span class="k">仮水通し底</span><span class="v">EL.${d.temp_spillway_el_m.toFixed(2)} m</span>
      <span class="k">仮水通し断面</span><span class="v">幅 ${d.temp_spillway_width_m.toFixed(1)} m × 深さ ${d.temp_spillway_depth_m.toFixed(2)} m</span>
      <span class="k">仮設水替え</span><span class="v"><span class="st-badge ${divBadgeCls}" style="white-space:normal">${d.diversion_label}</span></span>
    </div>
  `;
  document.getElementById('inspector-hud').classList.remove('hidden');
  updateSceneVisibility();
  renderPouringPlanUI();
  const selTr = document.querySelector('#daily-table tbody tr.selected');
  if (selTr) selTr.scrollIntoView({ block: 'center' });
}

// 主堤打設ブロック色分け（B1=青, B2=緑, B3=黄, B4=橙）
const BLOCK_TINTS = {
  1: new THREE.Color(0x7cc4fa),
  2: new THREE.Color(0x86efac),
  3: new THREE.Color(0xfde047),
  4: new THREE.Color(0xfdba74),
};

function applyBlockColorMode() {
  const on = state.layerVisible.color_blocks;
  for (const lot of state.meta?.pouring_plan?.lots || []) {
    const obj = state.nodes.get(lot.part_id);
    if (!obj) continue;
    obj.traverse((c) => {
      if (c.isMesh && c.material) {
        if (!c.userData.origColor) c.userData.origColor = c.material.color.clone();
        if (on) {
          const base = BLOCK_TINTS[lot.block] || new THREE.Color(0xffffff);
          const liftShade = 0.78 + (lot.lift / 7.0) * 0.28;
          c.material.color.copy(base).multiplyScalar(liftShade);
        } else {
          c.material.color.copy(c.userData.origColor);
        }
      }
    });
  }
}

function updateTerrainOpacity(val) {
  state.terrainOpacity = val;
  [
    'terrain_existing', 'terrain_existing_sides',
    'terrain_excavated', 'terrain_excavated_sides',
    'terrain_final', 'terrain_final_sides',
  ].forEach((tName) => {
    const obj = state.nodes.get(tName);
    if (!obj) return;
    obj.traverse((child) => {
      if (child.isMesh && child.material) {
        child.material.transparent = val < 0.99;
        child.material.opacity = val;
        child.material.depthWrite = val >= 0.99;
        child.material.needsUpdate = true;
      }
    });
  });
}

// ---- 等高線・クレーン作業半径リング構築 ----
function buildOverlays(meta) {
  // 1. 等高線（1m一般曲線・5m計曲線）
  const minorPts = [];
  const majorPts = [];
  for (const lv of meta.contours || []) {
    const target = lv.major ? majorPts : minorPts;
    for (const seg of lv.segments) {
      target.push(seg[0], seg[1], seg[2], seg[3], seg[4], seg[5]);
    }
  }
  if (minorPts.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(minorPts, 3));
    const m = new THREE.LineBasicMaterial({ color: 0xf1f5f9, transparent: true, opacity: 0.28 });
    contoursGroup.add(new THREE.LineSegments(g, m));
  }
  if (majorPts.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(majorPts, 3));
    const m = new THREE.LineBasicMaterial({ color: 0xfef08a, transparent: true, opacity: 0.72 });
    contoursGroup.add(new THREE.LineSegments(g, m));
  }

  // 2. 25t ラフテレーンクレーン作業半径リング
  const cp = meta.crane_plan;
  if (cp) {
    const [cx, cy, cz] = cp.center;
    const colors = [0x22c55e, 0xf59e0b, 0xef4444];
    cp.radii_m.forEach((rad, i) => {
      const pts = [];
      const segs = 72;
      for (let k = 0; k <= segs; k++) {
        const a = (k / segs) * Math.PI * 2;
        pts.push(new THREE.Vector3(cx + Math.cos(a) * rad, cy + 0.35, cz + Math.sin(a) * rad));
      }
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      const m = new THREE.LineDashedMaterial({
        color: colors[i % colors.length],
        dashSize: 1.2,
        gapSize: 0.6,
        transparent: true,
        opacity: 0.9,
      });
      const line = new THREE.Line(g, m);
      line.computeLineDistances();
      craneRingsGroup.add(line);
    });
  }
}

// ---- 3Dスクリーン投影ラベル ----
const labelElements = [];
function buildLabels(meta) {
  labelsLayer.innerHTML = '';
  labelElements.length = 0;

  for (const ann of meta.annotations || []) {
    const el = document.createElement('div');
    el.className = 'label-3d';
    el.textContent = ann.label;
    labelsLayer.appendChild(el);
    labelElements.push({
      el,
      pos: new THREE.Vector3(...ann.position),
      minStep: ann.step_built,
      layerKey: ann.mesh_keys?.length ? getLayerKey(ann.mesh_keys[0]) : null,
      isStation: false,
    });
  }

  for (const st of meta.stations || []) {
    const el = document.createElement('div');
    el.className = 'label-3d label-station';
    el.textContent = `${st.name} (EL.${st.bed_el_m.toFixed(1)})`;
    labelsLayer.appendChild(el);
    labelElements.push({
      el,
      pos: new THREE.Vector3(st.x, st.y + 1.4, st.z),
      minStep: 0,
      isStation: true,
    });
  }
}

const _projVec = new THREE.Vector3();
function updateLabels() {
  if (!state.layerVisible.labels) return;
  const w = container.clientWidth;
  const h = container.clientHeight;
  for (const item of labelElements) {
    if (!item.isStation) {
      const layerOff = item.layerKey && item.layerKey in state.layerVisible && !state.layerVisible[item.layerKey];
      if (state.step < item.minStep || layerOff) {
        item.el.style.display = 'none';
        continue;
      }
    }
    _projVec.copy(item.pos).project(camera);
    if (_projVec.z > 1.0 || _projVec.z < -1.0) {
      item.el.style.display = 'none';
      continue;
    }
    const sx = (_projVec.x * 0.5 + 0.5) * w;
    const sy = (-_projVec.y * 0.5 + 0.5) * h;
    item.el.style.display = 'block';
    item.el.style.left = `${sx}px`;
    item.el.style.top = `${sy}px`;
  }
}

// ---- 数量表パネル生成 ----
function renderQuantitiesUI(meta) {
  const q = meta.quantities;
  const s = q.summary;
  const cardsEl = document.getElementById('qty-summary-cards');
  cardsEl.innerHTML = `
    <div class="qty-card"><div class="k">コンクリート総量</div><div class="v">${s.total_concrete_m3.toLocaleString()} m³</div></div>
    <div class="qty-card"><div class="k">床掘土量合計</div><div class="v">${s.total_excavation_m3.toLocaleString()} m³</div></div>
    <div class="qty-card"><div class="k">左岸堤盛土量</div><div class="v">${s.total_embankment_m3.toLocaleString()} m³</div></div>
    <div class="qty-card"><div class="k">型枠参考面積</div><div class="v">${s.total_formwork_m2.toLocaleString()} m²</div></div>
  `;

  const tbody = document.querySelector('#qty-table tbody');
  tbody.innerHTML = q.items
    .map(
      (r) =>
        `<tr title="${r.note}"><td><strong>${r.name}</strong><br><span style="color:#94a3b8;font-size:10px">${r.category}</span></td><td class="num">${r.quantity.toLocaleString()}</td><td>${r.unit}</td></tr>`
    )
    .join('');

  const liftBody = document.querySelector('#lift-table tbody');
  liftBody.innerHTML = q.main_dam_lifts
    .map(
      (l, i) =>
        `<tr><td>${l.part_id}</td><td>EL.${l.el_min_m.toFixed(1)}〜${l.el_max_m.toFixed(1)}</td><td class="num">${l.volume_m3.toLocaleString()}</td></tr>`
    )
    .join('');
}

// ---- 打設割り・1日打設上限・技術基準UI ----
function evaluateLotDynamic(lot) {
  const ps = state.meta.pouring_plan.standards;
  const rate = state.simMethod === 'pump' ? ps.pump_rate_m3_per_h : ps.crane_rate_m3_per_h;
  const cjLim = state.simTemp === 'over25' ? ps.cold_joint_limit_over25c_h : ps.cold_joint_limit_under25c_h;
  const lim = state.simDailyLimit;
  const layerTime = (lot.pour_area_m2 * lot.layer_thickness_m) / rate;
  const pourTime = lot.volume_m3 / rate;

  if (lot.volume_m3 > lim) {
    return { badge: 'st-over', text: `上限超(>${lim})`, pourTime, layerTime };
  }
  if (layerTime > cjLim) {
    return { badge: 'st-warn', text: 'たわら打ち', pourTime, layerTime };
  }
  if (lot.volume_m3 < 50) {
    return { badge: 'st-warn', text: '小規模', pourTime, layerTime };
  }
  return { badge: 'st-ok', text: 'OK', pourTime, layerTime };
}

function renderPouringPlanUI() {
  const pp = state.meta?.pouring_plan;
  if (!pp) return;
  const lots = pp.lots;
  const sched = getActiveDailySchedule();

  const sl = document.getElementById('daily-session-slider');
  if (sl && sched) sl.max = String(sched.total_sessions);

  document.getElementById('pouring-kpi-cards').innerHTML = `
    <div class="qty-card"><div class="k">総打設回数 (28ロット)</div><div class="v">${sched.total_sessions} 回 (${sched.total_calendar_days}日)</div></div>
    <div class="qty-card"><div class="k">複数ブロック同時打設</div><div class="v" style="color:#86efac">${sched.multi_block_sessions} 回</div></div>
    <div class="qty-card"><div class="k">日平均 / 最大打設量</div><div class="v">${sched.avg_daily_volume_m3} / ${sched.max_daily_volume_m3}m³</div></div>
    <div class="qty-card"><div class="k">仮水通し確保</div><div class="v" style="color:#86efac">全日程 確保 ✅</div></div>
  `;

  // 日別工程表
  const dbody = document.querySelector('#daily-table tbody');
  if (dbody && sched) {
    dbody.innerHTML = sched.days
      .map((d) => {
        const sel = state.dailySession === d.session ? 'selected' : '';
        const bdg = d.is_multi_block ? 'st-ok' : (d.total_volume_m3 < 50 ? 'st-warn' : '');
        const divColor =
          d.diversion_mode === 'phase3_none_natural' || d.diversion_mode === 'phase3_temp_spillway_natural'
            ? '#86efac'
            : d.diversion_mode === 'phase1_bypass_pump'
            ? '#fbbf24'
            : d.diversion_mode === 'phase2_through_B2'
            ? '#f472b6'
            : '#38bdf8';
        return `<tr data-ses="${d.session}" class="${sel}">
          <td><strong>#${d.session}</strong><br><span style="color:#94a3b8;font-size:9.5px">D${d.cal_day}</span></td>
          <td>${d.lot_labels.join('<br>+ ')}${d.is_multi_block ? ` <span class="st-badge ${bdg}">${d.block_count}同時</span>` : ''}</td>
          <td class="num">${d.total_volume_m3.toFixed(0)}</td>
          <td style="font-size:9.5px">深${d.temp_spillway_depth_m.toFixed(1)}m<br><span style="color:${divColor};font-weight:600">${d.diversion_short || ''}</span></td>
        </tr>`;
      })
      .join('');
    dbody.querySelectorAll('tr').forEach((tr) => {
      tr.addEventListener('click', () => setDailySession(Number(tr.dataset.ses)));
    });
  }

  const tbody = document.querySelector('#pouring-table tbody');
  tbody.innerHTML = lots
    .map((lot) => {
      const ev = evaluateLotDynamic(lot);
      const sel = state.selectedLotId === lot.part_id ? 'selected' : '';
      return `<tr data-lot="${lot.part_id}" class="${sel}">
        <td><strong>${lot.block_name}-${lot.lift_name}</strong></td>
        <td class="num">${lot.volume_m3.toFixed(1)}</td>
        <td class="num">${lot.trucks_10t}</td>
        <td>${lot.wait_label.replace(/\d日/, '')}</td>
        <td><span class="st-badge ${ev.badge}">${ev.text}</span></td>
      </tr>`;
    })
    .join('');

  tbody.querySelectorAll('tr').forEach((tr) => {
    tr.addEventListener('click', () => selectLotById(tr.dataset.lot));
  });

  const jc = pp.joint_check;
  const cw = pp.catwalk_standards;
  document.getElementById('standards-box').innerHTML = `
    <div class="std-card">
      <strong>① 地面直置き仮設排水・敷設替え・現況河床到達後の水替え不要化</strong>
      ・<b>Phase 1 (STEP 1〜2)</b>：仮設管(φ700)は持ち上げず、<b>水通し側(中央B3)の現況河床→掘削底へ地面ベタ置き真っ直ぐ通し</b>＋<b>床掘り釜場×2・水中ポンプ・ノッチタンク</b><br>
      ・<b>Phase 2 (STEP 3 / Day 1〜10)</b>：<b>現況河床(L2=EL.247.90m)</b>まで打設完了する間のみ B3↔B2 へ地面/天端直置き敷設替え<br>
      ・<b>Phase 3 (STEP 4〜6 / Day 13〜36 後半11回)</b>：現況河床到達＆<b>仮水通しの段確保により水替え不要・仮設排水全撤去</b>→自然越流＆下段水抜き孔(EL.248.25m)自然流下 <span class="ok">✅</span>
    </div>
    <div class="std-card">
      <strong>② 仮水通し＆複数ブロック同時打設ルール</strong>
      ・中央水通し部(B2/B3)は<b>常に左右袖(B1/B4)より1段以上低く</b>保ち、出水時の仮水通し断面を確保 <span class="ok">✅</span><br>
      ・鉛直目地で<b>同一リフトに隣接しないブロック</b>（例: B1+B4, B1-L6+B3-L4 等）は同日複数打設で工期・損料を圧縮（28ロット → <b>20回</b> / 110m³案 <b>24回</b>）
    </div>
    <div class="std-card">
      <strong>③ 1日打設量上限・養生・鉛直目地 [河川砂防技術基準]</strong>
      ・日上限目安：クレーン1台 <b>〜110m³/日</b>（18m³/h×6h）／ ポンプ併用 <b>〜150m³/日</b>（28m³/h・国交省歩掛上限）<br>
      ・鉛直目地：9〜15m基準 → <b>${jc.block_widths_m.join(' / ')}m</b>・肩離れ <b>3.25m≧2.0m</b>・塩ビ止水板240mm <span class="ok">✅</span><br>
      ・打継養生：L1(0.95m) <b>中2日</b> / L2〜L4,L6(1.45m) <b>中3日</b> / L5(1.70m) <b>中4日</b>
    </div>
    <div class="std-card">
      <strong>④ キャットウォーク基準 [安衛則 第552・563条]</strong>
      ・基礎高 <b>${cw.install_threshold_height_m}m以上</b> / 垂直 <b>${cw.vertical_pitch_m}mピッチ</b><br>
      ・床幅 <b>${Math.round(cw.deck_width_m * 100)}cm</b>(≧40) / 手すり <b>${Math.round(cw.handrail_height_m * 100)}cm</b>(≧85) / 中桟 <b>${Math.round(cw.midrail_height_m * 100)}cm</b> / 幅木 <b>${Math.round(cw.toeboard_height_m * 100)}cm</b>(≧10) <span class="ok">✅</span>
    </div>
  `;
}

function selectLotById(lotId) {
  clearSelectionHighlight();
  const lot = (state.meta?.pouring_plan?.lots || []).find((l) => l.part_id === lotId);
  if (!lot) return;
  state.selectedLotId = lotId;
  const obj = state.nodes.get(lotId);
  if (obj) {
    obj.traverse((c) => {
      if (c.isMesh && c.material && c.material.emissive) {
        c.material.emissive.setHex(0x8a3d00);
      }
    });
  }
  const ev = evaluateLotDynamic(lot);
  const ratio = ((lot.volume_m3 / state.simDailyLimit) * 100).toFixed(0);
  document.getElementById('insp-title').textContent = `🧱 主堤打設ロット ${lot.block_name}-${lot.lift_name}`;
  document.getElementById('insp-body').innerHTML = `
    <div>打設順 #${lot.seq}（${lot.is_spillway_block ? '水通し部・後行' : '袖部・先行'}） <span class="st-badge ${ev.badge}">${ev.text}</span></div>
    <div class="insp-kv">
      <span class="k">打設量</span><span class="v">${lot.volume_m3.toFixed(1)} m³（上限比 ${ratio}%）</span>
      <span class="k">ブロック幅</span><span class="v">${lot.block_width_m.toFixed(2)} m × リフト高 ${lot.lift_height_m.toFixed(2)} m</span>
      <span class="k">標高範囲</span><span class="v">EL.${lot.el_min_m.toFixed(2)}m 〜 EL.${lot.el_max_m.toFixed(2)}m</span>
      <span class="k">生コン車</span><span class="v">10t車 ${lot.trucks_10t} 台（4.25m³/台）</span>
      <span class="k">打設時間</span><span class="v">${ev.pourTime.toFixed(1)} h（1層打重ね ${ev.layerTime.toFixed(2)} h / ${lot.n_layers}層）</span>
      <span class="k">次リフト養生</span><span class="v">${lot.wait_label}</span>
    </div>
  `;
  document.getElementById('inspector-hud').classList.remove('hidden');
  renderPouringPlanUI();
}

// ---- クリック選択・ハイライト & 2点間計測 ----
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const cursorReadout = document.getElementById('cursor-coords');

function getInteractableMeshes() {
  const list = [];
  state.nodes.forEach((obj) => {
    if (!obj.visible) return;
    obj.traverse((child) => {
      if (child.isMesh) list.push(child);
    });
  });
  return list;
}

function clearSelectionHighlight() {
  state.nodes.forEach((obj) => {
    obj.traverse((c) => {
      if (c.isMesh && c.material && c.material.emissive) {
        c.material.emissive.setHex(0x000000);
      }
    });
  });
  state.selectedPartId = null;
}

function selectPartById(partId) {
  clearSelectionHighlight();
  const ann = (state.meta?.annotations || []).find((a) => a.id === partId);
  if (!ann) return;
  state.selectedPartId = partId;
  for (const mk of ann.mesh_keys) {
    const obj = state.nodes.get(mk);
    if (!obj) continue;
    obj.traverse((c) => {
      if (c.isMesh && c.material && c.material.emissive) {
        c.material.emissive.setHex(0x1e4d6b);
      }
    });
  }
  document.getElementById('insp-title').textContent = `🏗 ${ann.label}`;
  document.getElementById('insp-body').innerHTML = `
    <div>${ann.role}</div>
    <div class="insp-kv">
      <span class="k">体積(3D)</span><span class="v">${ann.volume_m3.toLocaleString()} m³</span>
      <span class="k">標高範囲</span><span class="v">EL.${ann.el_min_m.toFixed(2)}m 〜 EL.${ann.el_max_m.toFixed(2)}m</span>
      <span class="k">設計諸元</span><span class="v">${ann.dimensions}</span>
      <span class="k">完成工程</span><span class="v">STEP ${ann.step_built}</span>
    </div>
  `;
  document.getElementById('inspector-hud').classList.remove('hidden');
}

function addMeasurePoint(pt) {
  if (state.measurePts.length >= 2) {
    clearMeasure();
  }
  state.measurePts.push(pt.clone());

  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 14, 14),
    new THREE.MeshBasicMaterial({ color: 0xf59e0b })
  );
  sphere.position.copy(pt);
  measureGroup.add(sphere);

  const hud = document.getElementById('measure-hud');
  const body = document.getElementById('measure-body');
  hud.classList.remove('hidden');

  if (state.measurePts.length === 1) {
    body.innerHTML = `点1: X=${pt.x.toFixed(2)}m, Z=${pt.z.toFixed(2)}m, EL.${(state.elBase + pt.y).toFixed(2)}m<br>2点目をクリックしてください。`;
  } else {
    const [p1, p2] = state.measurePts;
    const lineGeo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xfbbf24 }));
    measureGroup.add(line);

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dz = p2.z - p1.z;
    const horiz = Math.hypot(dx, dz);
    const dist3d = p1.distanceTo(p2);
    const slopePct = horiz > 0.01 ? (Math.abs(dy) / horiz) * 100 : 0;
    const slopeRatio = Math.abs(dy) > 0.01 ? `1 : ${(horiz / Math.abs(dy)).toFixed(2)}` : '水平';

    body.innerHTML = `
      <div class="insp-kv">
        <span class="k">斜距離</span><span class="v">${dist3d.toFixed(2)} m</span>
        <span class="k">水平距離</span><span class="v">${horiz.toFixed(2)} m</span>
        <span class="k">標高差 ΔEL</span><span class="v">${dy >= 0 ? '+' : ''}${dy.toFixed(2)} m</span>
        <span class="k">勾配</span><span class="v">${slopePct.toFixed(1)}% (${slopeRatio})</span>
        <span class="k">点1 EL</span><span class="v">EL.${(state.elBase + p1.y).toFixed(2)} m</span>
        <span class="k">点2 EL</span><span class="v">EL.${(state.elBase + p2.y).toFixed(2)} m</span>
      </div>
    `;
  }
}

function clearMeasure() {
  state.measurePts = [];
  while (measureGroup.children.length) {
    measureGroup.remove(measureGroup.children[0]);
  }
  document.getElementById('measure-body').textContent = 'モデル上の2点をクリックしてください。';
}

let pointerDownPos = { x: 0, y: 0 };
renderer.domElement.addEventListener('pointerdown', (e) => {
  pointerDownPos = { x: e.clientX, y: e.clientY };
});

renderer.domElement.addEventListener('pointermove', (e) => {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(getInteractableMeshes(), false);
  if (hits.length > 0) {
    const p = hits[0].point;
    const bank = p.x >= 0 ? '左岸' : '右岸';
    cursorReadout.textContent = `EL.${(state.elBase + p.y).toFixed(2)}m | ${bank} ${Math.abs(p.x).toFixed(1)}m | Z=${p.z.toFixed(1)}m`;
  }
});

renderer.domElement.addEventListener('pointerup', (e) => {
  if (Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y) > 5) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(getInteractableMeshes(), false);
  if (hits.length === 0) return;

  if (state.measureMode) {
    addMeasurePoint(hits[0].point);
    return;
  }

  // 親ノード名から主堤個別ロット または 構造物IDを検索
  let cur = hits[0].object;
  while (cur) {
    if (cur.name && state.meta?.lot_step_map?.[cur.name]) {
      selectLotById(cur.name);
      return;
    }
    if (cur.name && state.meta?.mesh_to_part?.[cur.name]) {
      selectPartById(state.meta.mesh_to_part[cur.name]);
      return;
    }
    cur = cur.parent;
  }
});

// ---- 4D 施工ステップ制御 ----
function setStep(stepIdx) {
  state.step = Math.max(0, Math.min(7, Number(stepIdx)));
  document.getElementById('step-slider').value = String(state.step);
  const info = state.meta?.construction_steps?.[state.step];
  if (info) {
    document.getElementById('step-name').textContent = info.name;
    document.getElementById('step-desc').textContent = info.description;
  }
  updateSceneVisibility();
}

function togglePlay() {
  state.playing = !state.playing;
  const btn = document.getElementById('btn-step-play');
  if (state.playing) {
    btn.textContent = '⏸ 停止';
    if (state.step === 7) setStep(0);
    state.playTimer = setInterval(() => {
      if (state.step >= 7) {
        setStep(0);
      } else {
        setStep(state.step + 1);
      }
    }, 2400);
  } else {
    btn.textContent = '▶ 再生';
    clearInterval(state.playTimer);
  }
}

// ---- UIイベント結線 ----
function bindUI() {
  // タブ切替
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });

  // カメラプリセット
  document.querySelectorAll('#camera-presets button').forEach((btn) => {
    btn.addEventListener('click', () => moveCameraTo(btn.dataset.cam));
  });

  // レイヤーチェックボックス
  document.querySelectorAll('input[data-layer]').forEach((inp) => {
    inp.addEventListener('change', () => {
      state.layerVisible[inp.dataset.layer] = inp.checked;
      if (inp.dataset.layer === 'color_blocks') {
        applyBlockColorMode();
      } else {
        updateSceneVisibility();
      }
    });
  });

  // 日別複数同時打設スケジュールUI
  const planCaseEl = document.getElementById('sim-plan-case');
  const dailySlider = document.getElementById('daily-session-slider');
  const btnDailyPlay = document.getElementById('btn-daily-play');
  const btnDailyReset = document.getElementById('btn-daily-reset');
  if (planCaseEl) {
    planCaseEl.addEventListener('change', () => {
      state.simPlanCase = planCaseEl.value;
      if (state.dailySession > 0) setDailySession(1);
      else renderPouringPlanUI();
    });
  }
  if (dailySlider) {
    dailySlider.addEventListener('input', () => setDailySession(Number(dailySlider.value)));
  }
  if (btnDailyPlay) {
    btnDailyPlay.addEventListener('click', () => {
      state.dailyPlaying = !state.dailyPlaying;
      if (state.dailyPlaying) {
        btnDailyPlay.textContent = '⏸ 日別停止';
        const sched = getActiveDailySchedule();
        if (state.dailySession === 0 || state.dailySession >= sched.total_sessions) setDailySession(1);
        state.dailyTimer = setInterval(() => {
          const sc = getActiveDailySchedule();
          if (state.dailySession >= sc.total_sessions) {
            setDailySession(1);
          } else {
            setDailySession(state.dailySession + 1);
          }
        }, 1250);
      } else {
        btnDailyPlay.textContent = '▶ 日別打設再生';
        clearInterval(state.dailyTimer);
      }
    });
  }
  if (btnDailyReset) {
    btnDailyReset.addEventListener('click', () => {
      if (state.dailyPlaying) {
        state.dailyPlaying = false;
        clearInterval(state.dailyTimer);
        if (btnDailyPlay) btnDailyPlay.textContent = '▶ 日別打設再生';
      }
      setDailySession(0);
    });
  }

  // 打設上限シミュレータUI
  const simMethod = document.getElementById('sim-method');
  const simTemp = document.getElementById('sim-temp');
  const simLim = document.getElementById('sim-daily-limit');
  const onSim = () => {
    state.simMethod = simMethod.value;
    state.simTemp = simTemp.value;
    state.simDailyLimit = Number(simLim.value);
    document.getElementById('sim-daily-limit-val').textContent = `${state.simDailyLimit} m³`;
    renderPouringPlanUI();
    if (state.selectedLotId) selectLotById(state.selectedLotId);
  };
  simMethod.addEventListener('change', onSim);
  simTemp.addEventListener('change', onSim);
  simLim.addEventListener('input', onSim);

  // 地形透過
  const tOp = document.getElementById('terrain-opacity');
  tOp.addEventListener('input', () => {
    const v = parseFloat(tOp.value);
    document.getElementById('terrain-opacity-val').textContent = `${Math.round(v * 100)}%`;
    updateTerrainOpacity(v);
  });

  // 日照スライダー
  const sunAz = document.getElementById('sun-azimuth');
  const sunEl = document.getElementById('sun-elevation');
  const onSun = () => {
    document.getElementById('sun-azimuth-val').textContent = `${sunAz.value}°`;
    document.getElementById('sun-elevation-val').textContent = `${sunEl.value}°`;
    updateSun(Number(sunAz.value), Number(sunEl.value));
  };
  sunAz.addEventListener('input', onSun);
  sunEl.addEventListener('input', onSun);

  // 断面カット
  const bindClip = (axis, enId, valId, txtId, fmt) => {
    const en = document.getElementById(enId);
    const sl = document.getElementById(valId);
    const tx = document.getElementById(txtId);
    const update = () => {
      clipEnabled[axis] = en.checked;
      const v = parseFloat(sl.value);
      clipPlanes[axis].constant = v;
      tx.textContent = fmt(v);
      applyClippingToAll();
    };
    en.addEventListener('change', update);
    sl.addEventListener('input', update);
  };
  bindClip('x', 'clip-x-en', 'clip-x-val', 'clip-x-txt', (v) => `${v.toFixed(1)} m`);
  bindClip('z', 'clip-z-en', 'clip-z-val', 'clip-z-txt', (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)} m`);
  bindClip('y', 'clip-y-en', 'clip-y-val', 'clip-y-txt', (v) => `EL.${(state.elBase + v).toFixed(1)}m`);

  document.querySelectorAll('[data-clip-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.clipPreset;
      const setC = (enX, vx, enZ, vz, enY, vy) => {
        document.getElementById('clip-x-en').checked = enX;
        document.getElementById('clip-x-val').value = vx;
        document.getElementById('clip-z-en').checked = enZ;
        document.getElementById('clip-z-val').value = vz;
        document.getElementById('clip-y-en').checked = enY;
        document.getElementById('clip-y-val').value = vy;
        ['clip-x-en', 'clip-z-en', 'clip-y-en'].forEach((id) =>
          document.getElementById(id).dispatchEvent(new Event('change'))
        );
      };
      if (k === 'long_center') {
        setC(true, 0.0, false, 8, false, 10);
        moveCameraTo('section_long');
      } else if (k === 'cross_main') {
        setC(false, 0, true, -2.5, false, 10);
        moveCameraTo('front');
      } else if (k === 'cross_apron') {
        setC(false, 0, true, 8.5, false, 10);
        moveCameraTo('front');
      } else {
        setC(false, 0, false, 8, false, 10);
      }
    });
  });

  // タイムライン
  document.getElementById('step-slider').addEventListener('input', (e) => setStep(e.target.value));
  document.getElementById('btn-step-prev').addEventListener('click', () => setStep(state.step - 1));
  document.getElementById('btn-step-next').addEventListener('click', () => setStep(state.step + 1));
  document.getElementById('btn-step-play').addEventListener('click', togglePlay);

  // 計測・ワイヤーフレーム・PNG保存・インスペクタ閉じる
  document.getElementById('btn-measure').addEventListener('click', (e) => {
    state.measureMode = !state.measureMode;
    e.currentTarget.classList.toggle('active', state.measureMode);
    document.getElementById('measure-hud').classList.toggle('hidden', !state.measureMode);
    if (!state.measureMode) clearMeasure();
  });
  document.getElementById('btn-measure-clear').addEventListener('click', clearMeasure);

  document.getElementById('btn-wireframe').addEventListener('click', (e) => {
    state.wireframe = !state.wireframe;
    e.currentTarget.classList.toggle('active', state.wireframe);
    state.nodes.forEach((obj) => {
      obj.traverse((c) => {
        if (c.isMesh && c.material) {
          c.material.wireframe = state.wireframe;
        }
      });
    });
  });

  document.getElementById('btn-screenshot').addEventListener('click', () => {
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `sabo_dam_step${state.step}.png`;
    a.click();
  });

  document.getElementById('btn-insp-close').addEventListener('click', () => {
    clearSelectionHighlight();
    document.getElementById('inspector-hud').classList.add('hidden');
  });
}

// ---- メインロード ----
async function init() {
  bindUI();
  const loadingText = document.getElementById('loading-text');

  try {
    const metaResp = await fetch('../output/viewer_data.json');
    state.meta = await metaResp.json();
    state.elBase = state.meta.project.elevation_base_m ?? 245.0;

    document.getElementById('project-title').textContent = state.meta.project.name;
    document.getElementById('project-subtitle').textContent = state.meta.project.subtitle;
    renderQuantitiesUI(state.meta);
    renderPouringPlanUI();
    buildOverlays(state.meta);
    buildLabels(state.meta);

    loadingText.textContent = '3Dモデル（sabo_dam_viewer.glb）を展開中...';
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync('../output/sabo_dam_viewer.glb');

    gltf.scene.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = !obj.name.startsWith('water_') && obj.name !== 'excavation_volume';
        obj.receiveShadow = true;
        // 個別に透過・ハイライト制御するためマテリアルを複製
        if (obj.material) {
          obj.material = obj.material.clone();
          if (obj.name.startsWith('water_') || obj.name === 'excavation_volume') {
            obj.material.side = THREE.DoubleSide;
          }
          if (obj.name.startsWith('terrain_')) {
            obj.material.roughness = 0.94;
            obj.material.metalness = 0.02;
          }
        }
      }
      if (obj.name && obj !== gltf.scene) {
        // ノード名またはジオメトリ名で登録
        state.nodes.set(obj.name, obj);
      }
    });

    scene.add(gltf.scene);
    setStep(7);
    document.getElementById('loading-overlay').classList.add('hidden');
  } catch (err) {
    loadingText.textContent = `読み込みエラー: ${err.message}`;
    console.error(err);
  }
}

// ---- アニメーションループ ----
window.addEventListener('resize', () => {
  const w = container.clientWidth;
  const h = container.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
});

function animate() {
  requestAnimationFrame(animate);
  if (camAnim) {
    camAnim.t = Math.min(1, camAnim.t + 0.065);
    const ease = 1 - Math.pow(1 - camAnim.t, 3);
    camera.position.lerpVectors(camAnim.startPos, camAnim.endPos, ease);
    controls.target.lerpVectors(camAnim.startTarget, camAnim.endTarget, ease);
    if (camAnim.t >= 1) camAnim = null;
  }
  controls.update();
  renderer.render(scene, camera);
  updateLabels();
}

init();
animate();

// デモ録画・自動カメラ演出用 API（通常操作には影響しない）
window.__demoApi = {
  isReady: () => document.getElementById('loading-overlay').classList.contains('hidden'),
  setCamera: (pos, target) => {
    camAnim = null;
    camera.position.set(pos[0], pos[1], pos[2]);
    controls.target.set(target[0], target[1], target[2]);
    controls.update();
    renderer.render(scene, camera);
    updateLabels();
  },
  setStep: (s) => {
    if (state.dailySession > 0) setDailySession(0);
    setStep(s);
    renderer.render(scene, camera);
    updateLabels();
  },
  setDailySession: (n) => {
    setDailySession(n);
    renderer.render(scene, camera);
    updateLabels();
  },
  setTab: (tabName) => {
    const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
    if (btn) btn.click();
  },
  setLayer: (layerKey, checked) => {
    const inp = document.querySelector(`input[data-layer="${layerKey}"]`);
    if (inp && inp.checked !== checked) {
      inp.checked = checked;
      inp.dispatchEvent(new Event('change'));
    }
  },
  setTerrainOpacity: (val) => {
    const sl = document.getElementById('terrain-opacity');
    if (sl) {
      sl.value = String(val);
      sl.dispatchEvent(new Event('input'));
    }
  },
  setClipZ: (enabled, zVal) => {
    const en = document.getElementById('clip-z-en');
    const sl = document.getElementById('clip-z-val');
    if (en && sl) {
      en.checked = enabled;
      sl.value = String(zVal);
      en.dispatchEvent(new Event('change'));
      sl.dispatchEvent(new Event('input'));
    }
  },
  renderNow: () => {
    controls.update();
    renderer.render(scene, camera);
    updateLabels();
  },
};

