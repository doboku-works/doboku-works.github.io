import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// ============================================================================
// 定数・SPEC.md 統一座標系定義
// ============================================================================
const DATA_URL = '../output/viewer_data.json';
const GLB_URL = '../output/river_levee_viewer.glb';

const GEOM = {
  X_MIN: -36.0,
  X_MAX: 48.0,
  Z_MIN: -16.0,
  Z_MAX: 16.0,
  DYNAMIC_Z_START: 2.0,
  CREST_Y: 5.0,
  HWL_Y: 4.0,
  CREST_X0: -2.5,
  CREST_X1: 2.5,
  TOE_RIVER_X: -12.5,
  TOE_LAND_X: 12.5,
  CLAY_TOP: 0.0,
  CLAY_BOT: -2.2,
  GRAVEL_BOT: -7.5,
  BASE_BOT: -13.0,
  LOW_BED_Y: -2.8,
  LOW_SLOPE_X0: -24.0,
  LOW_SLOPE_X1: -20.0,
};

const MODE_ORDER = ['overtop', 'seepage', 'piping', 'erosion'];

const MODE_META = {
  overtop: {
    badge: '① 越水決壊',
    measureNode: 'measure_overtop',
    defaultEffectOn: '天端・裏法コンクリートブロック被覆＋法尻保護工により逆行洗掘を抑制し破堤を回避',
    defaultEffectOff: 'クリックで「粘り強い堤防」を設置し、洗掘・破堤抑制効果を比較',
    recommendedPreset: 'overview_cutaway',
  },
  seepage: {
    badge: '② 浸透・すべり',
    measureNode: 'measure_seepage',
    defaultEffectOn: '砕石ドレーンと遮水シートで浸潤面を低下、安全率 Fs ≥ 1.20（照査 OK）を確保',
    defaultEffectOff: 'クリックで「裏法尻砕石ドレーン工＋遮水シート」を設置し、安全率 Fs 改善を比較',
    recommendedPreset: 'section_front',
  },
  piping: {
    badge: '③ パイピング噴砂',
    measureNode: 'measure_piping',
    defaultEffectOn: '鋼矢板（不透水層定着）で浸透路長を延長、局所動水勾配 i < 0.50 で噴砂・陥没を防止',
    defaultEffectOff: 'クリックで「遮水鋼矢板（不透水層根入れ）」を打設し、水圧遮断・噴砂防止を比較',
    recommendedPreset: 'section_front',
  },
  erosion: {
    badge: '④ 河床洗掘・侵食',
    measureNode: 'measure_erosion',
    defaultEffectOn: '連結コンクリートブロック護岸＋根固めブロック工により洗掘深を 0.4m 以下に抑制',
    defaultEffectOff: 'クリックで「連結ブロック護岸＋根固め工」を設置し、洗掘・崩落防止を比較',
    recommendedPreset: 'riverside_scour',
  },
};

// [C-03] 広角化＆左右パネル中央の空き領域に主役が丸ごと収まる最適化プリセット
const CAMERA_PRESETS = {
  overview_cutaway: {
    label: '断面カット鳥瞰',
    pos: [15.5, 18.0, 52.0],
    tgt: [1.0, -1.5, 3.0],
  },
  section_front: {
    label: '堤防正面断面',
    pos: [0.5, 1.8, 59.0],
    tgt: [0.5, -1.8, 12.0],
  },
  landside_boil: {
    label: '裏法尻・噴砂アップ',
    pos: [24.5, 8.2, 34.0],
    tgt: [10.0, 0.2, 12.5],
  },
  riverside_scour: {
    label: '川表・護岸洗掘',
    pos: [-28.5, 10.5, 36.0],
    tgt: [-11.0, -0.2, 11.0],
  },
  inland_town: {
    label: '住宅地・浸水視点',
    pos: [45.0, 12.5, 32.0],
    tgt: [16.5, 1.0, 3.0],
  },
  aerial: {
    label: '全体俯瞰',
    pos: [8.0, 39.0, 58.0],
    tgt: [3.5, -1.2, 0.0],
  },
};

const PRESET_ALIASES = {
  overview_cutaway: 'overview_cutaway',
  cutaway: 'overview_cutaway',
  overview: 'overview_cutaway',
  '断面カット鳥瞰': 'overview_cutaway',
  section_front: 'section_front',
  front: 'section_front',
  section: 'section_front',
  '堤防正面断面': 'section_front',
  landside_boil: 'landside_boil',
  boil: 'landside_boil',
  piping: 'landside_boil',
  '裏法尻・噴砂アップ': 'landside_boil',
  riverside_scour: 'riverside_scour',
  scour: 'riverside_scour',
  erosion: 'riverside_scour',
  '川表・護岸洗掘': 'riverside_scour',
  inland_town: 'inland_town',
  town: 'inland_town',
  inland: 'inland_town',
  '住宅地・浸水視点': 'inland_town',
  aerial: 'aerial',
  top: 'aerial',
  '全体俯瞰': 'aerial',
};

const FONT_STACK = '"Noto Sans JP", "BIZ UDPGothic", "Yu Gothic UI", "Hiragino Kaku Gothic ProN", "Meiryo", sans-serif';

// [P-01] 鮮やかなインライン SVG アイコン（ピンラベル用）
const SVG_SHIELD =
  '<svg class="pin-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3zm-1.06 13.54L7.4 12l1.41-1.41 2.12 2.12 4.24-4.24 1.41 1.41-5.64 5.66z"/></svg>';
const SVG_WARN =
  '<svg class="pin-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>';

// ============================================================================
// 数学・地形ヘルパー
// ============================================================================
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** SPEC.md 準拠の標準地盤＋堤防標高 */
function standardSurfaceY(x) {
  if (x <= GEOM.LOW_SLOPE_X0) return GEOM.LOW_BED_Y;
  if (x < GEOM.LOW_SLOPE_X1) {
    const t = (x - GEOM.LOW_SLOPE_X0) / (GEOM.LOW_SLOPE_X1 - GEOM.LOW_SLOPE_X0);
    return lerp(GEOM.LOW_BED_Y, 0.0, t);
  }
  if (x <= GEOM.TOE_RIVER_X) return 0.0;
  if (x < GEOM.CREST_X0) {
    const t = (x - GEOM.TOE_RIVER_X) / (GEOM.CREST_X0 - GEOM.TOE_RIVER_X);
    return lerp(0.0, GEOM.CREST_Y, t);
  }
  if (x <= GEOM.CREST_X1) return GEOM.CREST_Y;
  if (x < GEOM.TOE_LAND_X) {
    const t = (x - GEOM.CREST_X1) / (GEOM.TOE_LAND_X - GEOM.CREST_X1);
    return lerp(GEOM.CREST_Y, 0.0, t);
  }
  return 0.0;
}

/** ポリライン [[x, y], ...] から任意 X の Y を線形補間サンプリング */
function samplePolylineY(pts, x, fallbackFn = standardSurfaceY) {
  if (!Array.isArray(pts) || pts.length === 0) return fallbackFn(x);
  if (x <= pts[0][0]) return pts[0][1];
  const last = pts[pts.length - 1];
  if (x >= last[0]) return last[1];
  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid][0] <= x) lo = mid;
    else hi = mid;
  }
  const p0 = pts[lo];
  const p1 = pts[hi];
  const dx = p1[0] - p0[0];
  if (Math.abs(dx) < 1e-6) return p0[1];
  return lerp(p0[1], p1[1], (x - p0[0]) / dx);
}

/** 2D 座標配列の線形補間 */
function lerpPointArray(arrA, arrB, t) {
  if (!Array.isArray(arrA) || arrA.length === 0) return Array.isArray(arrB) ? arrB : [];
  if (!Array.isArray(arrB) || arrB.length === 0) return arrA;
  if (arrA.length === arrB.length) {
    const out = new Array(arrA.length);
    for (let i = 0; i < arrA.length; i++) {
      out[i] = [lerp(arrA[i][0], arrB[i][0], t), lerp(arrA[i][1], arrB[i][1], t)];
    }
    return out;
  }
  const n = Math.max(arrA.length, arrB.length);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const u = n > 1 ? i / (n - 1) : 0;
    const ia = u * (arrA.length - 1);
    const ib = u * (arrB.length - 1);
    const a0 = arrA[Math.floor(ia)];
    const a1 = arrA[Math.min(arrA.length - 1, Math.ceil(ia))];
    const fa = ia - Math.floor(ia);
    const b0 = arrB[Math.floor(ib)];
    const b1 = arrB[Math.min(arrB.length - 1, Math.ceil(ib))];
    const fb = ib - Math.floor(ib);
    out[i] = [lerp(lerp(a0[0], a1[0], fa), lerp(b0[0], b1[0], fb), t), lerp(lerp(a0[1], a1[1], fa), lerp(b0[1], b1[1], fb), t)];
  }
  return out;
}

/** pressure_grid のフレーム間線形補間（1D配列・2D配列両対応） */
function lerpPressureGrid(pg0, pg1, t) {
  if (!pg0) return pg1 ?? null;
  if (!pg1) return pg0;
  if (
    pg0.values &&
    pg1.values &&
    Array.isArray(pg0.values) &&
    Array.isArray(pg1.values) &&
    pg0.values.length === pg1.values.length &&
    typeof pg0.values[0] === 'number'
  ) {
    const vals = new Array(pg0.values.length);
    for (let i = 0; i < vals.length; i++) {
      vals[i] = lerp(pg0.values[i], pg1.values[i], t);
    }
    return {
      nx: pg0.nx,
      ny: pg0.ny,
      x_min: pg0.x_min,
      x_max: pg0.x_max,
      y_min: pg0.y_min,
      y_max: pg0.y_max,
      values: vals,
    };
  }
  return t < 0.5 ? pg0 : pg1;
}

/** 2フレーム間の完全補間（4D 60fps スムーズアニメーション） */
function interpolateFrames(f0, f1, t) {
  const near = t < 0.5 ? f0 : f1;
  const sc0 = f0.slip_circle || { cx: 8.5, cy: 8.0, r: 9.0, slide_prog: 0 };
  const sc1 = f1.slip_circle || sc0;

  const sl0 = Array.isArray(f0.streamlines) ? f0.streamlines : [];
  const sl1 = Array.isArray(f1.streamlines) ? f1.streamlines : sl0;
  const slCount = Math.min(sl0.length, sl1.length);
  const streamlines = [];
  for (let i = 0; i < slCount; i++) {
    streamlines.push(lerpPointArray(sl0[i], sl1[i], t));
  }

  return {
    t_hr: lerp(f0.t_hr ?? 0, f1.t_hr ?? 0, t),
    water_y: lerp(f0.water_y ?? -1.2, f1.water_y ?? -1.2, t),
    inland_flood_y: lerp(f0.inland_flood_y ?? 0, f1.inland_flood_y ?? 0, t),
    status: near.status || 'safe',
    status_label: near.status_label || '安全・照査 OK',
    stage_desc: near.stage_desc || '',
    fs_slope: lerp(f0.fs_slope ?? 1.8, f1.fs_slope ?? 1.8, t),
    slip_circle: {
      cx: lerp(sc0.cx ?? 8.5, sc1.cx ?? 8.5, t),
      cy: lerp(sc0.cy ?? 8.0, sc1.cy ?? 8.0, t),
      r: lerp(sc0.r ?? 9.0, sc1.r ?? 9.0, t),
      slide_prog: lerp(sc0.slide_prog ?? 0, sc1.slide_prog ?? 0, t),
    },
    hydraulic_grad: lerp(f0.hydraulic_grad ?? 0.08, f1.hydraulic_grad ?? 0.08, t),
    uplift_ratio: lerp(f0.uplift_ratio ?? 3.0, f1.uplift_ratio ?? 3.0, t),
    piping_prog: lerp(f0.piping_prog ?? 0, f1.piping_prog ?? 0, t),
    overtop_depth: lerp(f0.overtop_depth ?? 0, f1.overtop_depth ?? 0, t),
    scour_depth: lerp(f0.scour_depth ?? 0, f1.scour_depth ?? 0, t),
    breach_prog: lerp(f0.breach_prog ?? 0, f1.breach_prog ?? 0, t),
    phreatic_xy: lerpPointArray(f0.phreatic_xy, f1.phreatic_xy, t),
    profile_xy: lerpPointArray(f0.profile_xy, f1.profile_xy, t),
    streamlines,
    pressure_grid: lerpPressureGrid(f0.pressure_grid, f1.pressure_grid, t),
  };
}

/** [M-02] 補間済み実数値で stage_desc 内の全数値を KPI と 0.00m 誤差で完全同期 */
function syncStageDescNumbers(rawDesc, f, mode) {
  if (!rawDesc) return '';
  const wyStr = `${f.water_y >= 0 ? '+' : ''}${f.water_y.toFixed(2)}`;
  const fsStr = (f.fs_slope ?? 1.8).toFixed(2);
  const gradStr = (f.hydraulic_grad ?? 0.08).toFixed(2);
  const upliftStr = (f.uplift_ratio ?? 3.0).toFixed(2);
  const scourStr = (f.scour_depth ?? 0).toFixed(2);
  const floodStr = (f.inland_flood_y ?? 0).toFixed(2);
  const overStr = (f.overtop_depth ?? 0).toFixed(2);
  const progVal =
    mode === 'seepage'
      ? f.slip_circle?.slide_prog ?? 0
      : mode === 'piping'
        ? f.piping_prog ?? 0
        : f.breach_prog ?? 0;
  const progPct = String(Math.round(clamp(progVal, 0, 1) * 100));

  let s = rawDesc;
  // 水位数値同期（河川水位は/が、高水位( / )、水位）※ H.W.L.4.0m は固定基準値のため維持
  s = s.replace(/(河川水位(?:は|が)\s*)[+-]?\d+(?:\.\d+)?(\s*m)/g, `$1${wyStr}$2`);
  s = s.replace(/(高水位[（(]\s*)[+-]?\d+(?:\.\d+)?(\s*m[）)])/g, `$1${wyStr}$2`);
  s = s.replace(/(高水位\s+)[+-]?\d+(?:\.\d+)?(\s*m)/g, `$1${wyStr}$2`);
  s = s.replace(/(水位\s+)[+-]?\d+(?:\.\d+)?(\s*m)/g, `$1${wyStr}$2`);
  // 越流水深同期
  s = s.replace(/(越流水深\s*|越水深\s*)\d+(?:\.\d+)?(\s*m)/g, `$1${overStr}$2`);
  // すべり安全率 Fs 同期
  s = s.replace(/(Fs\s*=\s*)\d+(?:\.\d+)?/g, `$1${fsStr}`);
  // 局所動水勾配 i・揚圧力比 G/W 同期
  s = s.replace(/(\bi\s*=\s*)\d+(?:\.\d+)?/g, `$1${gradStr}`);
  s = s.replace(/(G\/W\s*=\s*)\d+(?:\.\d+)?/g, `$1${upliftStr}`);
  // 洗掘深同期（洗掘深は/が/スペース、洗掘を、深さ）
  s = s.replace(/(洗掘深(?:は|が)?\s*|洗掘を\s*|深さ\s*)\d+(?:\.\d+)?(\s*m)/g, `$1${scourStr}$2`);
  // 堤内地浸水深・氾濫深同期
  s = s.replace(/(浸水深(?:は|が)?\s*)\d+(?:\.\d+)?(\s*m)/g, `$1${floodStr}$2`);
  s = s.replace(/((?:浸水|氾濫)[（(]\s*)\d+(?:\.\d+)?(\s*m[）)])/g, `$1${floodStr}$2`);
  // 進行度 % 同期
  s = s.replace(/(進行度\s*)\d+(?:\.\d+)?(\s*%)/g, `$1${progPct}$2`);
  return s;
}

/** ポリラインから Z=const 平面上の太いリボンジオメトリを構築（可変幅配列も対応） */
function buildRibbonGeometry(pts, widthOrArr, zPos, outGeo = null) {
  const n = pts ? pts.length : 0;
  if (n < 2) return null;
  const positions = new Float32Array(n * 2 * 3);
  const uvs = new Float32Array(n * 2 * 2);
  const indices = [];

  let accumLen = 0;
  const lens = new Float32Array(n);
  for (let i = 1; i < n; i++) {
    accumLen += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    lens[i] = accumLen;
  }
  const totalLen = Math.max(accumLen, 1e-4);
  const isArr = Array.isArray(widthOrArr);

  for (let i = 0; i < n; i++) {
    const pPrev = pts[Math.max(0, i - 1)];
    const pNext = pts[Math.min(n - 1, i + 1)];
    let tx = pNext[0] - pPrev[0];
    let ty = pNext[1] - pPrev[1];
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    const nx = -ty;
    const ny = tx;

    const halfW = (isArr ? widthOrArr[i] : widthOrArr) * 0.5;
    const px = pts[i][0];
    const py = pts[i][1];
    const vIdx = i * 2;
    positions[vIdx * 3 + 0] = px + nx * halfW;
    positions[vIdx * 3 + 1] = py + ny * halfW;
    positions[vIdx * 3 + 2] = zPos;

    positions[(vIdx + 1) * 3 + 0] = px - nx * halfW;
    positions[(vIdx + 1) * 3 + 1] = py - ny * halfW;
    positions[(vIdx + 1) * 3 + 2] = zPos;

    const u = lens[i] / totalLen;
    uvs[vIdx * 2 + 0] = u;
    uvs[vIdx * 2 + 1] = 0;
    uvs[(vIdx + 1) * 2 + 0] = u;
    uvs[(vIdx + 1) * 2 + 1] = 1;

    if (i < n - 1) {
      const a = vIdx;
      const b = vIdx + 1;
      const c = vIdx + 2;
      const d = vIdx + 3;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geo = outGeo || new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// ============================================================================
// プロシージャルテクスチャ生成（外部画像依存ゼロ）
// ============================================================================
function createWaterFlowTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#a0a8b0';
  ctx.fillRect(0, 0, 256, 256);

  // 流下方向の柔らかい波筋と白泡
  for (let i = 0; i < 190; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const w = 2 + Math.random() * 5.5;
    const h = 16 + Math.random() * 44;
    const bright = 165 + Math.floor(Math.random() * 90);
    const alpha = 0.08 + Math.random() * 0.20;
    ctx.fillStyle = `rgba(${bright}, ${bright + 4}, ${bright + 8}, ${alpha})`;
    ctx.fillRect(x, y, w, h);
    if (y + h > 256) ctx.fillRect(x, y - 256, w, h);
  }
  for (let i = 0; i < 130; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const r = 1 + Math.random() * 3.0;
    ctx.fillStyle = `rgba(255, 255, 255, ${0.08 + Math.random() * 0.16})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 4);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** [C-06] 木目調を完全脱却した爽やかで迫力ある白泡＋濁流水脈テクスチャ */
function createWaterfallFoamTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');

  // 明るい青灰〜黄土水色のベース
  const baseGrad = ctx.createLinearGradient(0, 0, 256, 0);
  baseGrad.addColorStop(0.0, '#9db4bf');
  baseGrad.addColorStop(0.35, '#bfd2dc');
  baseGrad.addColorStop(0.65, '#c4b8a6');
  baseGrad.addColorStop(1.0, '#9eb5c0');
  ctx.fillStyle = baseGrad;
  ctx.fillRect(0, 0, 256, 256);

  // 高速落下する白泡リボンと飛沫の筋
  for (let i = 0; i < 280; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const w = 1.5 + Math.random() * 6.0;
    const h = 14 + Math.random() * 58;
    const isBrightFoam = Math.random() > 0.25;
    ctx.fillStyle = isBrightFoam
      ? `rgba(248, 252, 255, ${0.24 + Math.random() * 0.52})`
      : `rgba(116, 146, 162, ${0.18 + Math.random() * 0.28})`;
    ctx.fillRect(x, y, w, h);
    if (y + h > 256) ctx.fillRect(x, y - 256, w, h);
  }

  // 細かな気泡ドット
  for (let i = 0; i < 180; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const r = 1.2 + Math.random() * 3.8;
    ctx.fillStyle = `rgba(255, 255, 255, ${0.18 + Math.random() * 0.35})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createSoilSectionTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#a37b50';
  ctx.fillRect(0, 0, 256, 256);

  for (let y = 0; y < 256; y += 12) {
    ctx.fillStyle = y % 24 === 0 ? 'rgba(90, 60, 32, 0.14)' : 'rgba(210, 175, 130, 0.10)';
    ctx.fillRect(0, y, 256, 6);
  }
  for (let i = 0; i < 1600; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const r = 0.6 + Math.random() * 2.1;
    const tone = Math.random();
    ctx.fillStyle =
      tone < 0.35
        ? 'rgba(72, 48, 26, 0.32)'
        : tone < 0.72
          ? 'rgba(196, 158, 112, 0.28)'
          : 'rgba(130, 108, 84, 0.25)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(0.18, 0.18);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** [C-04] パイピング水みち用の不規則な濁水空洞グラデーションテクスチャ */
function createPipingChannelTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d');

  // 縦方向(V): 縁は崩れ土砂の暗褐色 → 中心は泥水が流れる暗青茶の空洞
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0.0, 'rgba(92, 58, 30, 0.0)');
  g.addColorStop(0.16, 'rgba(98, 62, 32, 0.85)');
  g.addColorStop(0.32, 'rgba(38, 26, 16, 0.94)');
  g.addColorStop(0.50, 'rgba(66, 52, 36, 0.90)');
  g.addColorStop(0.68, 'rgba(38, 26, 16, 0.94)');
  g.addColorStop(0.84, 'rgba(98, 62, 32, 0.85)');
  g.addColorStop(1.0, 'rgba(92, 58, 30, 0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 64);

  // 水みち内を流れる微細な泥水・砂筋
  for (let i = 0; i < 140; i++) {
    const x = Math.random() * 256;
    const y = 16 + Math.random() * 32;
    const w = 10 + Math.random() * 26;
    const h = 1.5 + Math.random() * 3;
    ctx.fillStyle =
      Math.random() > 0.45
        ? `rgba(180, 145, 96, ${0.18 + Math.random() * 0.25})`
        : `rgba(110, 165, 195, ${0.16 + Math.random() * 0.22})`;
    ctx.fillRect(x, y, w, h);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(3, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** [C-04] 真っ黒ベタ円板を廃止し、自然な放射グラデ＋崩落土砂＆亀裂の陥没ゆるみテクスチャ */
function createSinkholeTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);

  // 外周の湿潤ゆるみ土砂 → 中心の崩落空洞（完全真っ黒にはせず立体感を残す）
  const g = ctx.createRadialGradient(128, 140, 14, 128, 132, 118);
  g.addColorStop(0.0, 'rgba(34, 23, 14, 0.92)');
  g.addColorStop(0.38, 'rgba(62, 42, 24, 0.82)');
  g.addColorStop(0.68, 'rgba(112, 78, 44, 0.46)');
  g.addColorStop(0.88, 'rgba(138, 102, 62, 0.16)');
  g.addColorStop(1.0, 'rgba(138, 102, 62, 0.0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(128, 134, 118, 92, 0, 0, Math.PI * 2);
  ctx.fill();

  // 周囲の崩落土塊テクスチャ粒子
  for (let i = 0; i < 260; i++) {
    const ang = Math.random() * Math.PI * 2;
    const rad = 18 + Math.random() * 88;
    const px = 128 + Math.cos(ang) * rad;
    const py = 132 + Math.sin(ang) * rad * 0.78;
    const r = 1.2 + Math.random() * 3.8;
    ctx.fillStyle =
      Math.random() > 0.5
        ? `rgba(155, 114, 72, ${0.22 + Math.random() * 0.32})`
        : `rgba(48, 32, 18, ${0.28 + Math.random() * 0.32})`;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 上方へ走る細かな沈下亀裂スジ
  ctx.strokeStyle = 'rgba(38, 24, 14, 0.72)';
  ctx.lineWidth = 2.2;
  for (let k = 0; k < 5; k++) {
    const bx = 86 + k * 21;
    ctx.beginPath();
    ctx.moveTo(bx, 116);
    ctx.lineTo(bx + (k - 2) * 5, 76 + Math.random() * 14);
    ctx.lineTo(bx + (k - 2) * 9, 34 + Math.random() * 16);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createSoftParticleTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.75, 'rgba(255,255,255,0.22)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createSkyTexture(stormy) {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  if (stormy) {
    g.addColorStop(0.0, '#132238');
    g.addColorStop(0.36, '#2a3f5a');
    g.addColorStop(0.55, '#465c74');
    g.addColorStop(0.68, '#2d3d52');
    g.addColorStop(1.0, '#0d1728');
  } else {
    g.addColorStop(0.0, '#1d5fa7');
    g.addColorStop(0.38, '#66a9df');
    g.addColorStop(0.56, '#c6e2f5');
    g.addColorStop(0.68, '#7a95ad');
    g.addColorStop(1.0, '#182638');
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ============================================================================
// 高DPI 2段リアルタイム工学チャートレンダラー [M-04][C-01]
// ============================================================================
class HudChartRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cssW = 328;
    this.cssH = 242;
    this.resize();
  }

  resize() {
    const rect = this.canvas.parentElement?.getBoundingClientRect();
    if (!rect || rect.width < 40 || rect.height < 40) return;
    const dpr = Math.max(window.devicePixelRatio || 1, 2);
    this.cssW = Math.round(rect.width);
    this.cssH = Math.round(rect.height);
    this.canvas.width = Math.round(this.cssW * dpr);
    this.canvas.height = Math.round(this.cssH * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw(state, data) {
    const ctx = this.ctx;
    const W = this.cssW;
    const H = this.cssH;
    if (!data || !data.modes || !data.modes[state.mode]) return;

    const modeObj = data.modes[state.mode];
    const activeCase = state.mitigated ? modeObj.mitigated : modeObj.unmitigated;
    const altCase = state.mitigated ? modeObj.unmitigated : modeObj.mitigated;
    const frames = activeCase?.frames || [];
    const altFrames = altCase?.frames || [];
    if (frames.length < 2) return;

    const maxT = frames[frames.length - 1].t_hr || 24.0;
    const curT = state.tHr;
    const curFrame = state.currentFrame;

    // 背景クリア
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#070e1c';
    ctx.fillRect(0, 0, W, H);

    // 狭幅時は下段ヘッダーを2行構成にして文字衝突を完全防止 [C-01]
    const narrowBottomHeader = W < 304;
    const padL = 44;
    const padR = 12;
    const plotW = Math.max(80, W - padL - padR);

    const topHeaderH = 23;
    const botHeaderH = narrowBottomHeader ? 34 : 24;
    const footerH = 19;
    const availH = Math.max(100, H - topHeaderH - botHeaderH - footerH - 8);
    const topH = Math.floor(availH * 0.47);
    const topBox = { x: padL, y: topHeaderH, w: plotW, h: topH };
    const botBox = { x: padL, y: topBox.y + topBox.h + botHeaderH + 4, w: plotW, h: Math.max(50, H - (topBox.y + topBox.h + botHeaderH + 4) - footerH) };

    // 中央区切り線
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(8, topBox.y + topBox.h + 5);
    ctx.lineTo(W - 8, topBox.y + topBox.h + 5);
    ctx.stroke();

    const toX = (t) => padL + clamp(t / maxT, 0, 1) * plotW;

    // ---------------------------------------------------------
    // 上段: 河川水位ハイドログラフ (m)
    // ---------------------------------------------------------
    this._drawPanelGrid(topBox, -3.0, 6.2, [-2, 0, 2, 4, 6], 0, maxT, false);
    this._drawTopHeader(
      '河川水位ハイドログラフ (m)',
      `現在 ${(curFrame.water_y >= 0 ? '+' : '') + curFrame.water_y.toFixed(2)}m`,
      topBox.y - 6,
      W,
      '#7dd3fc'
    );

    const yWater = (v) => topBox.y + topBox.h - clamp((v - -3.0) / (6.2 - -3.0), 0, 1) * topBox.h;

    // [M-04] 1) 破線のみ先に描画
    this._drawRefStroke(topBox, yWater(5.0), '#f87171');
    this._drawRefStroke(topBox, yWater(4.0), '#fbbf24');

    // 2) 水位エリア塗り＋折れ線
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < frames.length; i++) {
      const px = toX(frames[i].t_hr);
      const py = yWater(frames[i].water_y);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    const areaGrad = ctx.createLinearGradient(0, topBox.y, 0, topBox.y + topBox.h);
    areaGrad.addColorStop(0, 'rgba(56, 189, 248, 0.32)');
    areaGrad.addColorStop(1, 'rgba(56, 189, 248, 0.02)');
    ctx.lineTo(toX(frames[frames.length - 1].t_hr), topBox.y + topBox.h);
    ctx.lineTo(toX(frames[0].t_hr), topBox.y + topBox.h);
    ctx.closePath();
    ctx.fillStyle = areaGrad;
    ctx.fill();

    ctx.beginPath();
    for (let i = 0; i < frames.length; i++) {
      const px = toX(frames[i].t_hr);
      const py = yWater(frames[i].water_y);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.0;
    ctx.stroke();
    ctx.restore();

    // 3) [M-04] 基準線ラベルピルを折れ線の最前面に描画（H.W.L.は左端余白、天端は右端余白で被りゼロ）
    this._drawRefPill(topBox, yWater(4.0), 'H.W.L. 4.0m', '#fbbf24', 'left', 'below');
    this._drawRefPill(topBox, yWater(5.0), '天端 5.0m', '#f87171', 'right', 'above');

    // 4) 現在時刻カーソル＆ドット（上段）
    this._drawCursor(topBox, toX(curT), yWater(curFrame.water_y), '#38bdf8');

    // ---------------------------------------------------------
    // 下段: モード別 最重要照査指標（無対策 vs 対策工 比較線付き）
    // ---------------------------------------------------------
    const cfg = this._getBottomMetricConfig(state.mode, state.mitigated);
    this._drawPanelGrid(botBox, cfg.min, cfg.max, cfg.ticks, cfg.tickDecimals, maxT, true);

    const curMetricVal = cfg.getter(curFrame);
    const legendLabel = state.mitigated ? '実線:対策ON / 点線:無対策' : '実線:無対策 / 点線:対策ON';
    this._drawBottomHeader(cfg.title, `${cfg.fmt(curMetricVal)}`, legendLabel, botBox.y, W, cfg.lineColor, narrowBottomHeader);

    const yBot = (v) => botBox.y + botBox.h - clamp((v - cfg.min) / (cfg.max - cfg.min), 0, 1) * botBox.h;

    // 1) 基準線の破線
    for (const ref of cfg.refs) {
      this._drawRefStroke(botBox, yBot(ref.val), ref.color);
    }

    // 2) 反対ケースの比較ゴースト点線
    if (altFrames.length >= 2) {
      ctx.save();
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      for (let i = 0; i < altFrames.length; i++) {
        const px = toX(altFrames[i].t_hr);
        const py = yBot(cfg.getter(altFrames[i]));
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = state.mitigated ? 'rgba(248, 113, 113, 0.56)' : 'rgba(52, 211, 153, 0.65)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.restore();
    }

    // 3) 越水モードのみ補助線として浸水深(青)を描画
    if (state.mode === 'overtop') {
      ctx.save();
      ctx.beginPath();
      for (let i = 0; i < frames.length; i++) {
        const px = toX(frames[i].t_hr);
        const py = yBot(frames[i].inland_flood_y ?? 0);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.restore();
    }

    // 4) 現在ケースのメイン実線
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < frames.length; i++) {
      const px = toX(frames[i].t_hr);
      const py = yBot(cfg.getter(frames[i]));
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = cfg.lineColor;
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.restore();

    // 5) 基準線ラベルピルを最前面に描画
    for (const ref of cfg.refs) {
      this._drawRefPill(botBox, yBot(ref.val), ref.label, ref.color, ref.align, ref.pos);
    }

    // 6) 現在時刻カーソル＆ドット（下段）
    this._drawCursor(botBox, toX(curT), yBot(curMetricVal), cfg.lineColor);
  }

  /** [M-04] モード別チャート定義（色名一致・piping 小数2桁統一） */
  _getBottomMetricConfig(mode, mitigated) {
    if (mode === 'seepage') {
      return {
        title: 'すべり安全率 Fs',
        min: 0.5,
        max: 2.1,
        ticks: [0.6, 1.0, 1.4, 1.8],
        tickDecimals: 1,
        getter: (f) => f.fs_slope ?? 1.5,
        fmt: (v) => `Fs=${v.toFixed(2)}`,
        lineColor: mitigated ? '#34d399' : '#fbbf24',
        refs: [
          { val: 1.2, label: '基準 Fs=1.20', color: '#34d399', align: 'right', pos: 'above' },
          { val: 1.0, label: '崩壊 Fs=1.00', color: '#f87171', align: 'left', pos: 'below' },
        ],
      };
    }
    if (mode === 'piping') {
      return {
        title: '局所動水勾配 i',
        min: 0.0,
        max: 1.0,
        ticks: [0.0, 0.25, 0.5, 0.75, 1.0],
        tickDecimals: 2,
        getter: (f) => f.hydraulic_grad ?? 0.1,
        fmt: (v) => `i=${v.toFixed(2)}`,
        lineColor: mitigated ? '#34d399' : '#fb923c',
        refs: [{ val: 0.5, label: '限界基準 i=0.50', color: '#f87171', align: 'left', pos: 'above' }],
      };
    }
    if (mode === 'erosion') {
      return {
        title: '河床・表法洗掘深 (m)',
        min: 0.0,
        max: 4.0,
        ticks: [0, 1, 2, 3, 4],
        tickDecimals: 0,
        getter: (f) => f.scour_depth ?? 0,
        fmt: (v) => `${v.toFixed(2)}m`,
        lineColor: mitigated ? '#34d399' : '#38bdf8',
        refs: [{ val: 1.5, label: '危険洗掘 1.5m', color: '#fb923c', align: 'left', pos: 'above' }],
      };
    }
    // overtop: 無対策時は鮮やかな橙 #fb923c、対策ON時は緑 #34d399 とタイトル表記を完全一致！
    return {
      title: mitigated ? '洗掘深(緑) / 浸水深(青)' : '洗掘深(橙) / 浸水深(青)',
      min: 0.0,
      max: 4.0,
      ticks: [0, 1, 2, 3, 4],
      tickDecimals: 0,
      getter: (f) => f.scour_depth ?? 0,
      fmt: (v) => `${v.toFixed(2)}m`,
      lineColor: mitigated ? '#34d399' : '#fb923c',
      refs: [{ val: 2.0, label: '破堤危険 2.0m', color: '#fbbf24', align: 'left', pos: 'above' }],
    };
  }

  _drawTopHeader(leftText, rightText, yBaseline, W, rightColor) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = `700 11.5px ${FONT_STACK}`;
    ctx.fillStyle = '#e2e8f0';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(leftText, 10, yBaseline);

    ctx.font = `700 11px ${FONT_STACK}`;
    ctx.fillStyle = rightColor;
    ctx.textAlign = 'right';
    ctx.fillText(rightText, W - 10, yBaseline);
    ctx.restore();
  }

  /** [C-01] 下段ヘッダー：狭幅時は2行に折り返してタイトルと凡例の衝突を完全防止 */
  _drawBottomHeader(title, valueText, legendText, boxTopY, W, valColor, twoLines) {
    const ctx = this.ctx;
    ctx.save();
    ctx.textBaseline = 'alphabetic';
    if (twoLines) {
      // 1行目: タイトル(左) + 現在値(右)
      ctx.font = `700 11px ${FONT_STACK}`;
      ctx.fillStyle = '#e2e8f0';
      ctx.textAlign = 'left';
      ctx.fillText(title, 10, boxTopY - 17);

      ctx.fillStyle = valColor;
      ctx.textAlign = 'right';
      ctx.fillText(valueText, W - 10, boxTopY - 17);

      // 2行目: 比較凡例(右寄せ)
      ctx.font = `600 9.5px ${FONT_STACK}`;
      ctx.fillStyle = '#94a3b8';
      ctx.textAlign = 'right';
      ctx.fillText(legendText, W - 10, boxTopY - 5);
    } else {
      ctx.font = `700 11px ${FONT_STACK}`;
      ctx.fillStyle = '#e2e8f0';
      ctx.textAlign = 'left';
      ctx.fillText(title, 10, boxTopY - 6);

      ctx.font = `600 9.8px ${FONT_STACK}`;
      ctx.fillStyle = valColor;
      ctx.textAlign = 'right';
      ctx.fillText(`${valueText}  ${legendText}`, W - 10, boxTopY - 6);
    }
    ctx.restore();
  }

  _drawPanelGrid(box, minV, maxV, ticks, tickDecimals, maxT, showTimeAxis) {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.56)';
    ctx.fillRect(box.x, box.y, box.w, box.h);

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
    ctx.lineWidth = 1;
    ctx.font = `600 10.5px ${FONT_STACK}`;
    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (const v of ticks) {
      const py = box.y + box.h - ((v - minV) / (maxV - minV)) * box.h;
      if (py < box.y - 1 || py > box.y + box.h + 1) continue;
      ctx.beginPath();
      ctx.moveTo(box.x, py);
      ctx.lineTo(box.x + box.w, py);
      ctx.stroke();
      const label = tickDecimals > 0 ? v.toFixed(tickDecimals) : String(v);
      ctx.fillText(label, box.x - 5, py);
    }

    const timeTicks = [0, 6, 12, 18, 24];
    ctx.textBaseline = 'top';
    for (const h of timeTicks) {
      const px = box.x + (h / maxT) * box.w;
      ctx.beginPath();
      ctx.moveTo(px, box.y);
      ctx.lineTo(px, box.y + box.h);
      ctx.stroke();
      if (showTimeAxis) {
        ctx.textAlign = h === 0 ? 'left' : h === 24 ? 'right' : 'center';
        ctx.fillText(`${h}h`, px, box.y + box.h + 4);
      }
    }

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.28)';
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.restore();
  }

  _drawRefStroke(box, py, color) {
    if (py < box.y + 1 || py > box.y + box.h - 1) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(box.x, py);
    ctx.lineTo(box.x + box.w, py);
    ctx.stroke();
    ctx.restore();
  }

  _drawRefPill(box, py, label, color, align = 'left', pos = 'above') {
    if (py < box.y + 1 || py > box.y + box.h - 1) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.font = `700 10.5px ${FONT_STACK}`;
    const textW = ctx.measureText(label).width;
    const padX = 5;
    const pillH = 14;
    const pillW = textW + padX * 2;
    const pillX = align === 'right' ? box.x + box.w - pillW - 3 : box.x + 3;
    let pillY = pos === 'below' ? py + 2 : py - pillH - 2;
    pillY = clamp(pillY, box.y + 1, box.y + box.h - pillH - 1);

    ctx.fillStyle = 'rgba(7, 14, 28, 0.94)';
    ctx.fillRect(pillX, pillY, pillW, pillH);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 0.8;
    ctx.strokeRect(pillX, pillY, pillW, pillH);
    ctx.globalAlpha = 1.0;

    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, pillX + padX, pillY + pillH * 0.5 + 0.5);
    ctx.restore();
  }

  _drawCursor(box, px, py, color) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = 'rgba(248, 250, 252, 0.76)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.moveTo(px, box.y);
    ctx.lineTo(px, box.y + box.h);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.arc(px, clamp(py, box.y, box.y + box.h), 4.2, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.restore();
  }
}

// ============================================================================
// リアルタイム 3D 物理ビジュアライゼーション・マネージャー
// ============================================================================
class PhysicsVisualizer {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = 'physics_visuals_root';
    this.scene.add(this.root);

    this.texWaterFlow = createWaterFlowTexture();
    this.texWaterfall = createWaterfallFoamTexture();
    this.texSoil = createSoilSectionTexture();
    this.texPiping = createPipingChannelTexture();
    this.texSinkhole = createSinkholeTexture();
    this.texParticle = createSoftParticleTexture();

    this._initRiverWater();
    this._initInlandFlood();
    this._initDynamicLevee();
    this._initSeepageVisuals();
    this._initOvertopVisuals();
    this._initSlipVisuals();
    this._initPipingVisuals();
    this._initErosionVisuals();

    this._clockSec = 0;
    this._lastGeomKey = '';
  }

  // --------------------------------------------------------------------------
  // 1. 河川水面 ＋ クリアガラス透過断面水壁 ＋ 水位メニスカス線 [C-06][M-05]
  // --------------------------------------------------------------------------
  _initRiverWater() {
    this.riverGroup = new THREE.Group();
    this.root.add(this.riverGroup);

    this.riverSegX = 28;
    this.riverSegZ = 24;
    const vertCount = (this.riverSegX + 1) * (this.riverSegZ + 1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertCount * 3), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(vertCount * 2), 2));
    const idx = [];
    for (let iz = 0; iz < this.riverSegZ; iz++) {
      for (let ix = 0; ix < this.riverSegX; ix++) {
        const a = iz * (this.riverSegX + 1) + ix;
        const b = a + 1;
        const c = a + (this.riverSegX + 1);
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    geo.setIndex(idx);

    this.riverMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#2590bd'),
      map: this.texWaterFlow,
      roughness: 0.24,
      metalness: 0.04,
      transparent: true,
      opacity: 0.82,
      side: THREE.DoubleSide,
    });
    this.riverSurfaceMesh = new THREE.Mesh(geo, this.riverMat);
    this.riverSurfaceMesh.receiveShadow = true;
    this.riverGroup.add(this.riverSurfaceMesh);

    // [M-05] 透過度の高いクリアガラス風断面水壁（Z=16.0 へ密着して白隙間線ゼロ・水中護岸が透けて見える）
    this.riverWallMat = new THREE.MeshLambertMaterial({
      color: new THREE.Color('#38a3d1'),
      transparent: true,
      opacity: 0.38,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.riverFrontWall = new THREE.Mesh(new THREE.BufferGeometry(), this.riverWallMat);
    this.riverBackWall = new THREE.Mesh(new THREE.BufferGeometry(), this.riverWallMat);
    this.riverGroup.add(this.riverFrontWall, this.riverBackWall);

    // [M-05] 手前断面の水位メニスカス発光ライン
    this.meniscusMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#bae6fd'),
      transparent: true,
      opacity: 0.68,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.riverMeniscusMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.meniscusMat);
    this.riverGroup.add(this.riverMeniscusMesh);

    // 明度を改善した清流ブルー → 明るい黄土茶濁流
    this._colClear = new THREE.Color('#2590bd');
    this._colTurbid = new THREE.Color('#8f7250');
    this._colWallClear = new THREE.Color('#3ca8d6');
    this._colWallTurbid = new THREE.Color('#9a7d58');
    this._colMeniscusClear = new THREE.Color('#bae6fd');
    this._colMeniscusTurbid = new THREE.Color('#ede2d1');
  }

  /** [C-06] 越水時は表法肩 GEOM.CREST_X0 (-2.5) で正確に止め、waterfallMesh との天端重複を完全排除 */
  _findWaterRightX(wy, profile, useStandardOnly, frame) {
    if (frame.overtop_depth > 0.015) {
      return GEOM.CREST_X0;
    }
    if (!useStandardOnly && frame.breach_prog > 0.62 && wy > 0.6) {
      return lerp(-2.0, 12.2, clamp((frame.breach_prog - 0.62) / 0.38, 0, 1));
    }
    const sampleFn = useStandardOnly ? standardSurfaceY : (x) => samplePolylineY(profile, x);
    let rightX = -24.0;
    const step = 0.25;
    for (let x = -24.0; x <= 12.5; x += step) {
      const sy = sampleFn(x);
      if (sy <= wy + 0.02) {
        rightX = x;
      } else {
        const prevY = sampleFn(x - step);
        if (sy > prevY + 1e-4) {
          const frac = clamp((wy - prevY) / (sy - prevY), 0, 1);
          rightX = x - step + frac * step;
        }
        break;
      }
    }
    return clamp(rightX, -23.5, 12.5);
  }

  _updateRiverWater(frame, mode, dt, geomDirty) {
    const wy = frame.water_y;
    const profile = frame.profile_xy;
    const isErosion = mode === 'erosion';
    const flowSpeed = isErosion ? 1.85 : lerp(0.35, 1.25, clamp((wy + 1.5) / 6.5, 0, 1));
    this.texWaterFlow.offset.y -= dt * flowSpeed;

    const turbidity = clamp((wy + 1.0) / 4.2 + (isErosion ? 0.14 : 0), 0, 1);
    this.riverMat.color.copy(this._colClear).lerp(this._colTurbid, turbidity);
    this.riverMat.opacity = lerp(0.76, 0.86, turbidity);
    this.riverWallMat.color.copy(this._colWallClear).lerp(this._colWallTurbid, turbidity);
    this.riverWallMat.opacity = lerp(0.34, 0.44, turbidity);
    this.meniscusMat.color.copy(this._colMeniscusClear).lerp(this._colMeniscusTurbid, turbidity);

    const rightXBack = this._findWaterRightX(wy, profile, true, frame);
    const rightXFront = this._findWaterRightX(wy, profile, false, frame);
    this.currentWaterRightX = rightXFront;

    const pos = this.riverSurfaceMesh.geometry.attributes.position;
    const uv = this.riverSurfaceMesh.geometry.attributes.uv;
    const amp = lerp(0.03, isErosion ? 0.14 : 0.09, turbidity);
    const t = this._clockSec;
    const x0 = GEOM.X_MIN + 0.02;
    const z0 = GEOM.Z_MIN + 0.02;
    const z1 = GEOM.Z_MAX - 0.02;
    const isOvertop = (frame.overtop_depth ?? 0) > 0.015;

    let ptr = 0;
    for (let iz = 0; iz <= this.riverSegZ; iz++) {
      const vz = iz / this.riverSegZ;
      const z = lerp(z0, z1, vz);
      const wZ = smoothstep(GEOM.DYNAMIC_Z_START, 7.2, z);
      const x1 = lerp(rightXBack, rightXFront, wZ) + (isOvertop ? 0.0 : 0.06);
      for (let ix = 0; ix <= this.riverSegX; ix++) {
        const vx = ix / this.riverSegX;
        const x = lerp(x0, x1, vx);
        // 越水接続部・岸際では波振幅を0へ収束させて滑らか接続
        const shoreFade = smoothstep(0.0, 0.14, 1.0 - vx);
        const wave =
          (Math.sin(x * 0.55 + t * 2.8) * 0.55 +
            Math.cos(z * 0.42 - t * (flowSpeed * 3.8)) * 0.45 +
            Math.sin((x + z) * 0.7 - t * 3.2) * 0.25) *
          amp *
          shoreFade;
        pos.setXYZ(ptr, x, wy + wave, z);
        uv.setXY(ptr, (x - x0) * 0.07, (z - z0) * 0.07);
        ptr++;
      }
    }
    pos.needsUpdate = true;
    uv.needsUpdate = true;
    this.riverSurfaceMesh.geometry.computeVertexNormals();

    if (!geomDirty) return;

    // 手前クリアガラス断面水壁 (Z = +16.00 で密着)
    const samples = 28;
    const xFrontEnd = rightXFront + (isOvertop ? 0.0 : 0.04);
    const frontShape = new THREE.Shape();
    frontShape.moveTo(x0, wy);
    frontShape.lineTo(xFrontEnd, wy);
    for (let i = samples; i >= 0; i--) {
      const x = lerp(x0, xFrontEnd, i / samples);
      const bedY = Math.min(wy - 0.01, samplePolylineY(profile, x));
      frontShape.lineTo(x, bedY);
    }
    frontShape.closePath();
    const frontGeo = new THREE.ShapeGeometry(frontShape);
    frontGeo.translate(0, 0, GEOM.Z_MAX);
    this.riverFrontWall.geometry.dispose();
    this.riverFrontWall.geometry = frontGeo;

    // 手前水位メニスカス線
    const menPts = [
      [x0, wy],
      [xFrontEnd, wy],
    ];
    const menGeo = buildRibbonGeometry(menPts, 0.14, GEOM.Z_MAX + 0.025);
    if (menGeo) {
      this.riverMeniscusMesh.geometry.dispose();
      this.riverMeniscusMesh.geometry = menGeo;
    }

    // 奥側断面水壁 (Z = -16.00)
    const xBackEnd = rightXBack + (isOvertop ? 0.0 : 0.04);
    const backShape = new THREE.Shape();
    backShape.moveTo(x0, wy);
    backShape.lineTo(xBackEnd, wy);
    for (let i = samples; i >= 0; i--) {
      const x = lerp(x0, xBackEnd, i / samples);
      const bedY = Math.min(wy - 0.01, standardSurfaceY(x));
      backShape.lineTo(x, bedY);
    }
    backShape.closePath();
    const backGeo = new THREE.ShapeGeometry(backShape);
    backGeo.translate(0, 0, GEOM.Z_MIN);
    this.riverBackWall.geometry.dispose();
    this.riverBackWall.geometry = backGeo;
  }

  // --------------------------------------------------------------------------
  // 2. 堤内地氾濫水面（inland_flood_y > 0）
  // --------------------------------------------------------------------------
  _initInlandFlood() {
    this.inlandGroup = new THREE.Group();
    this.inlandGroup.visible = false;
    this.root.add(this.inlandGroup);

    const w = GEOM.X_MAX - GEOM.TOE_LAND_X;
    const d = GEOM.Z_MAX - GEOM.Z_MIN - 0.04;
    const geo = new THREE.PlaneGeometry(w, d, 24, 18);
    geo.rotateX(-Math.PI / 2);

    this.inlandMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#8c6f4d'),
      map: this.texWaterFlow,
      roughness: 0.25,
      metalness: 0.04,
      transparent: true,
      opacity: 0.82,
      side: THREE.DoubleSide,
    });
    this.inlandSurface = new THREE.Mesh(geo, this.inlandMat);
    this.inlandSurface.position.set((GEOM.TOE_LAND_X + GEOM.X_MAX) * 0.5, 0.1, 0);
    this.inlandGroup.add(this.inlandSurface);

    this.inlandWallMat = new THREE.MeshLambertMaterial({
      color: new THREE.Color('#8a6e4d'),
      transparent: true,
      opacity: 0.44,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.inlandFrontWall = new THREE.Mesh(new THREE.PlaneGeometry(w, 1), this.inlandWallMat);
    this.inlandFrontWall.position.set((GEOM.TOE_LAND_X + GEOM.X_MAX) * 0.5, 0.5, GEOM.Z_MAX);
    this.inlandGroup.add(this.inlandFrontWall);

    this._inlandBasePos = new Float32Array(geo.attributes.position.array);
  }

  _updateInlandFlood(frame) {
    const fy = frame.inland_flood_y ?? 0;
    if (fy <= 0.008) {
      this.inlandGroup.visible = false;
      return;
    }
    this.inlandGroup.visible = true;
    const t = this._clockSec;
    const pos = this.inlandSurface.geometry.attributes.position;
    const base = this._inlandBasePos;
    const amp = clamp(fy * 0.045, 0.012, 0.065);
    for (let i = 0; i < pos.count; i++) {
      const bx = base[i * 3 + 0];
      const bz = base[i * 3 + 2];
      const ripple = Math.sin(bx * 0.5 - t * 2.6) * Math.cos(bz * 0.45 + t * 1.9) * amp;
      pos.setY(i, fy + ripple);
    }
    pos.needsUpdate = true;
    this.inlandSurface.geometry.computeVertexNormals();

    this.inlandFrontWall.scale.set(1, fy, 1);
    this.inlandFrontWall.position.y = fy * 0.5;
  }

  // --------------------------------------------------------------------------
  // 3. 動的変形堤体メッシュ（滑らかなU字/斜壁遷移＋断面キャップ＋洗掘クレーター） [M-05][M-06]
  // --------------------------------------------------------------------------
  _initDynamicLevee() {
    this.dynLeveeGroup = new THREE.Group();
    this.dynLeveeGroup.visible = false;
    this.root.add(this.dynLeveeGroup);

    this.dynSurfaceMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.88,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });
    this.dynSurfaceMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.dynSurfaceMat);
    this.dynSurfaceMesh.castShadow = true;
    this.dynSurfaceMesh.receiveShadow = true;
    this.dynLeveeGroup.add(this.dynSurfaceMesh);

    this.dynFrontCapMat = new THREE.MeshStandardMaterial({
      map: this.texSoil,
      color: new THREE.Color('#c59f75'),
      roughness: 0.92,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });
    this.dynFrontCapGroup = new THREE.Group();
    this.dynLeveeGroup.add(this.dynFrontCapGroup);

    // 洗掘クレーター（地盤面以下へのえぐれ）
    this.scourPocketGroup = new THREE.Group();
    this.root.add(this.scourPocketGroup);

    this.scourCutMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#4d3927'),
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    this.scourLoftMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.94,
      metalness: 0.02,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    this.scourTopMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#523c26'),
      roughness: 0.95,
      transparent: true,
      opacity: 0.84,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });

    this._colGrass = new THREE.Color('#5a803b');
    this._colRoad = new THREE.Color('#4d5561');
    this._colSoilDry = new THREE.Color('#996d43');
    this._colSoilWet = new THREE.Color('#5e3f25');
    this._colClayBed = new THREE.Color('#6b5a46');
    this._colGravelBed = new THREE.Color('#7a6c58');
  }

  /** GLBの levee_core_front / ground_clay_river_front と動的堤体・洗掘孔をシームレス連携 */
  updateDynamicLevee(frame, mode, glbNodes) {
    const profile = frame.profile_xy;
    let maxLeveeDiff = 0;
    const xSamples = 54;
    const xs = new Float32Array(xSamples);
    const stdYs = new Float32Array(xSamples);
    const curYs = new Float32Array(xSamples);

    for (let i = 0; i < xSamples; i++) {
      const x = lerp(GEOM.TOE_RIVER_X, GEOM.TOE_LAND_X, i / (xSamples - 1));
      xs[i] = x;
      stdYs[i] = standardSurfaceY(x);
      curYs[i] = samplePolylineY(profile, x);
      const diff = Math.abs(stdYs[i] - curYs[i]);
      if (diff > maxLeveeDiff) maxLeveeDiff = diff;
    }

    const slideProg = frame.slip_circle?.slide_prog ?? 0;
    const scourDepth = frame.scour_depth ?? 0;
    const needDynamic =
      (frame.breach_prog ?? 0) > 0.01 ||
      scourDepth > 0.05 ||
      (frame.piping_prog ?? 0) > 0.55 ||
      slideProg > 0.02 ||
      maxLeveeDiff > 0.05;

    if (glbNodes.levee_core_front) {
      glbNodes.levee_core_front.visible = !needDynamic;
    }

    // [M-05] GLB の川側前面粘土層 (ground_clay_river_front) を洗掘時に自動非表示にして動的洗掘へ切替
    if (glbNodes.ground_clay_river_front) {
      const hideRiverClay = mode === 'erosion' && scourDepth > 0.12;
      glbNodes.ground_clay_river_front.visible = !hideRiverClay;
    }

    // 破堤・大規模変状時に手前天端のガードレール等を非表示にして宙浮きを防止
    if (glbNodes.frontRoadDetails && glbNodes.frontRoadDetails.length > 0) {
      const hideDetails =
        (frame.breach_prog ?? 0) > 0.22 ||
        (frame.piping_prog ?? 0) > 0.70 ||
        (mode === 'erosion' && scourDepth > 1.35);
      for (const obj of glbNodes.frontRoadDetails) {
        obj.visible = !hideDetails;
      }
    }

    // 洗掘クレーター（地盤面以下へのえぐれ）更新
    this._updateScourPockets(frame, mode, Boolean(glbNodes.ground_clay_river_front && mode === 'erosion' && scourDepth > 0.12));

    if (!needDynamic) {
      this.dynLeveeGroup.visible = false;
      return;
    }

    this.dynLeveeGroup.visible = true;

    // [M-06] Z=+2.0..+9.0 にかけてU字/斜壁状に滑らか遷移（包丁切り落とし感を完全払拭）
    const zSlices = [
      { z: GEOM.DYNAMIC_Z_START, w: 0.0 },
      { z: 3.2, w: 0.14 },
      { z: 4.6, w: 0.38 },
      { z: 6.2, w: 0.68 },
      { z: 8.0, w: 0.92 },
      { z: 10.5, w: 1.0 },
      { z: GEOM.Z_MAX, w: 1.0 },
    ];
    const nz = zSlices.length;
    const vertCount = nz * xSamples;
    const positions = new Float32Array(vertCount * 3);
    const colors = new Float32Array(vertCount * 3);
    const tmpCol = new THREE.Color();

    for (let iz = 0; iz < nz; iz++) {
      const z = zSlices[iz].z;
      const w = zSlices[iz].w;
      for (let ix = 0; ix < xSamples; ix++) {
        const x = xs[ix];
        const sy = stdYs[ix];
        const dy = Math.max(0.0, curYs[ix]);
        const y = Math.max(0.0, lerp(sy, dy, w));
        const vi = iz * xSamples + ix;
        positions[vi * 3 + 0] = x;
        positions[vi * 3 + 1] = y;
        positions[vi * 3 + 2] = z;

        const cutDepth = sy - y;
        const phY = samplePolylineY(frame.phreatic_xy, x, () => -1.0);
        if (cutDepth > 0.08) {
          const wet = smoothstep(phY + 0.6, phY - 0.5, y);
          tmpCol.copy(this._colSoilDry).lerp(this._colSoilWet, wet);
        } else if (Math.abs(x) <= GEOM.CREST_X1 + 0.05 && y >= GEOM.CREST_Y - 0.12) {
          tmpCol.copy(this._colRoad);
        } else {
          tmpCol.copy(this._colGrass);
        }
        colors[vi * 3 + 0] = tmpCol.r;
        colors[vi * 3 + 1] = tmpCol.g;
        colors[vi * 3 + 2] = tmpCol.b;
      }
    }

    const indices = [];
    for (let iz = 0; iz < nz - 1; iz++) {
      for (let ix = 0; ix < xSamples - 1; ix++) {
        const a = iz * xSamples + ix;
        const b = a + 1;
        const c = a + xSamples;
        const d = c + 1;
        const maxH = Math.max(
          positions[a * 3 + 1],
          positions[b * 3 + 1],
          positions[c * 3 + 1],
          positions[d * 3 + 1]
        );
        if (maxH <= 0.02) continue;
        indices.push(a, c, b, b, c, d);
      }
    }

    const surfGeo = new THREE.BufferGeometry();
    surfGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    surfGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    surfGeo.setIndex(indices);
    surfGeo.computeVertexNormals();
    this.dynSurfaceMesh.geometry.dispose();
    this.dynSurfaceMesh.geometry = surfGeo;

    // 手前断面キャップ (Z = +16.0)
    while (this.dynFrontCapGroup.children.length > 0) {
      const ch = this.dynFrontCapGroup.children.pop();
      ch.geometry.dispose();
    }

    let segStart = -1;
    for (let ix = 0; ix <= xSamples; ix++) {
      const h = ix < xSamples ? Math.max(0, curYs[ix]) : 0;
      if (h > 0.02 && segStart < 0) {
        segStart = Math.max(0, ix - 1);
      } else if ((h <= 0.02 || ix === xSamples) && segStart >= 0) {
        const segEnd = Math.min(xSamples - 1, ix);
        if (segEnd - segStart >= 1) {
          const shape = new THREE.Shape();
          shape.moveTo(xs[segStart], 0);
          for (let k = segStart; k <= segEnd; k++) {
            shape.lineTo(xs[k], Math.max(0, curYs[k]));
          }
          shape.lineTo(xs[segEnd], 0);
          shape.closePath();
          const capGeo = new THREE.ShapeGeometry(shape);
          capGeo.translate(0, 0, GEOM.Z_MAX);
          this.dynFrontCapGroup.add(new THREE.Mesh(capGeo, this.dynFrontCapMat));
        }
        segStart = -1;
      }
    }
  }

  /** [M-05] 河床・法尻の洗掘クレーターを立体ロフト＆断面でリアル表現 */
  _updateScourPockets(frame, mode, riverClayHidden) {
    while (this.scourPocketGroup.children.length > 0) {
      const ch = this.scourPocketGroup.children.pop();
      ch.geometry.dispose();
    }
    const profile = frame.profile_xy;
    if (!Array.isArray(profile) || profile.length < 4) return;

    // ground_clay_river_front が非表示になった場合は X=-24..-12.5 全体の動的河床・高水敷ロフトを描画
    if (riverClayHidden) {
      const nx = 28;
      const zSlices = [
        { z: GEOM.DYNAMIC_Z_START, w: 0.0 },
        { z: 4.5, w: 0.35 },
        { z: 7.5, w: 0.85 },
        { z: GEOM.Z_MAX, w: 1.0 },
      ];
      const nz = zSlices.length;
      const pos = new Float32Array(nx * nz * 3);
      const col = new Float32Array(nx * nz * 3);
      const cTmp = new THREE.Color();

      for (let iz = 0; iz < nz; iz++) {
        const z = zSlices[iz].z;
        const w = zSlices[iz].w;
        for (let ix = 0; ix < nx; ix++) {
          const x = lerp(-24.0, GEOM.TOE_RIVER_X, ix / (nx - 1));
          const sy = standardSurfaceY(x);
          const dy = Math.min(0.0, samplePolylineY(profile, x));
          const y = lerp(sy, dy, w);
          const vi = iz * nx + ix;
          pos[vi * 3 + 0] = x;
          pos[vi * 3 + 1] = y;
          pos[vi * 3 + 2] = z;

          const cut = sy - y;
          if (cut > 0.1) {
            cTmp.copy(y < GEOM.CLAY_BOT ? this._colGravelBed : this._colClayBed);
          } else {
            cTmp.copy(x > -20.0 ? this._colGrass : this._colClayBed);
          }
          col[vi * 3 + 0] = cTmp.r;
          col[vi * 3 + 1] = cTmp.g;
          col[vi * 3 + 2] = cTmp.b;
        }
      }
      const idx = [];
      for (let iz = 0; iz < nz - 1; iz++) {
        for (let ix = 0; ix < nx - 1; ix++) {
          const a = iz * nx + ix;
          const b = a + 1;
          const c = a + nx;
          const d = c + 1;
          idx.push(a, c, b, b, c, d);
        }
      }
      const loftGeo = new THREE.BufferGeometry();
      loftGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      loftGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      loftGeo.setIndex(idx);
      loftGeo.computeVertexNormals();
      this.scourPocketGroup.add(new THREE.Mesh(loftGeo, this.scourLoftMat));
    }

    // 手前断面 (Z = +16.02) の洗掘えぐれ断面＆法尻クレーター
    const n = 72;
    const xs = [];
    const stdYs = [];
    const curYs = [];
    for (let i = 0; i < n; i++) {
      const x = lerp(-34.0, 22.0, i / (n - 1));
      xs.push(x);
      stdYs.push(standardSurfaceY(x));
      curYs.push(samplePolylineY(profile, x));
    }

    let start = -1;
    for (let i = 0; i <= n; i++) {
      const isScoured = i < n && curYs[i] < Math.min(0.02, stdYs[i]) - 0.10;
      if (isScoured && start < 0) {
        start = Math.max(0, i - 1);
      } else if (!isScoured && start >= 0) {
        const end = Math.min(n - 1, i);
        if (end - start >= 2) {
          const shape = new THREE.Shape();
          shape.moveTo(xs[start], Math.min(0.0, stdYs[start]));
          for (let k = start; k <= end; k++) {
            shape.lineTo(xs[k], Math.min(0.0, stdYs[k]));
          }
          for (let k = end; k >= start; k--) {
            shape.lineTo(xs[k], curYs[k]);
          }
          shape.closePath();
          const cutGeo = new THREE.ShapeGeometry(shape);
          cutGeo.translate(0, 0, GEOM.Z_MAX + 0.02);
          this.scourPocketGroup.add(new THREE.Mesh(cutGeo, this.scourCutMat));

          // 裏法尻など地表に露出する洗掘クレーター上面（川側がすでに動的ロフト済みなら重複回避）
          if (!riverClayHidden || xs[start] > 0) {
            const xMin = xs[start];
            const xMax = xs[end];
            const topY = Math.min(0.0, stdYs[Math.floor((start + end) * 0.5)]) + 0.025;
            const topGeo = new THREE.PlaneGeometry(Math.max(0.5, xMax - xMin), 11.2);
            topGeo.rotateX(-Math.PI / 2);
            const topMesh = new THREE.Mesh(topGeo, this.scourTopMat);
            topMesh.position.set((xMin + xMax) * 0.5, topY, 10.35);
            this.scourPocketGroup.add(topMesh);
          }
        }
        start = -1;
      }
    }
  }

  // --------------------------------------------------------------------------
  // 4. 堤体内 浸潤面（飽和帯）＋ 矢尻型浸透流線粒子 [C-02][C-04][M-07]
  // --------------------------------------------------------------------------
  _initSeepageVisuals() {
    this.seepageGroup = new THREE.Group();
    this.root.add(this.seepageGroup);

    this.phreaticPolyMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#38bdf8'),
      transparent: true,
      opacity: 0.34,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.phreaticPolyMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.phreaticPolyMat);
    this.seepageGroup.add(this.phreaticPolyMesh);

    // 浸潤線の暗色縁取り＋高輝度シアン芯線
    this.phreaticHaloMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#082032'),
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.phreaticHaloMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.phreaticHaloMat);
    this.seepageGroup.add(this.phreaticHaloMesh);

    this.phreaticLineMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#7dd3fc'),
      transparent: true,
      opacity: 0.96,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.phreaticLineMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.phreaticLineMat);
    this.seepageGroup.add(this.phreaticLineMesh);

    // 流線ガイド（暗色縁取り＋細身発光芯線）
    this.streamHaloGroup = new THREE.Group();
    this.streamRibbonGroup = new THREE.Group();
    this.seepageGroup.add(this.streamHaloGroup, this.streamRibbonGroup);

    this.streamHaloMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#071324'),
      transparent: true,
      opacity: 0.52,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.streamRibbonMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#38bdf8'),
      transparent: true,
      opacity: 0.78,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    // [C-04] 巨大球を完全廃止 → 流線接線方向を向く繊細な矢尻/コーン型 InstancedMesh
    this.maxStreamParticles = 140;
    const arrowGeo = new THREE.ConeGeometry(0.068, 0.34, 6);
    // Cone の先端はデフォルト +Y 向き → -90° Z 回転で +X（角度0）向きへ整列
    arrowGeo.rotateZ(-Math.PI / 2);
    const arrowMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ffffff'),
      transparent: true,
      opacity: 0.96,
    });
    this.streamParticles = new THREE.InstancedMesh(arrowGeo, arrowMat, this.maxStreamParticles);
    this.streamParticles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.streamParticles.frustumCulled = false;
    this.seepageGroup.add(this.streamParticles);

    this._dummy = new THREE.Object3D();
    this._tmpColor = new THREE.Color();
    this._streamPhase = 0;
  }

  _updateSeepageVisuals(frame, mode, mitigated, showSeepage, dt, geomDirty) {
    this.seepageGroup.visible = showSeepage;
    if (!showSeepage) return;

    const ph = frame.phreatic_xy;
    const profile = frame.profile_xy;
    const lines = Array.isArray(frame.streamlines) ? frame.streamlines : [];
    const grad = frame.hydraulic_grad ?? 0.1;
    const isHighGrad = mode === 'piping' && grad >= 0.48;

    if (geomDirty) {
      if (Array.isArray(ph) && ph.length >= 2) {
        // [M-07] seepage 対策 ON 時は砕石ドレーン内 (X <= 12.1) で自然に Y=0 へ収束クリップ
        const clipDrain = mode === 'seepage' && mitigated;
        const maxXClip = clipDrain ? 12.1 : GEOM.TOE_LAND_X;

        const clampedPts = [];
        for (let i = 0; i < ph.length; i++) {
          const px = ph[i][0];
          if (px > maxXClip) {
            if (clampedPts.length > 0 && clampedPts[clampedPts.length - 1][0] < maxXClip) {
              const prev = clampedPts[clampedPts.length - 1];
              const frac = clamp((maxXClip - prev[0]) / Math.max(1e-4, px - prev[0]), 0, 1);
              const pyRaw = lerp(prev[1], ph[i][1], frac);
              const pyEnd = clipDrain ? 0.0 : clamp(pyRaw, 0.0, Math.max(0, samplePolylineY(profile, maxXClip)));
              clampedPts.push([maxXClip, pyEnd]);
            }
            break;
          }
          const maxSurf = Math.max(0, samplePolylineY(profile, px));
          let py = clamp(ph[i][1], 0.0, maxSurf);
          if (clipDrain && px > 10.6) {
            // ドレーン進入部 (X=10.6..12.1) で Y=0 へ滑らかに引き下げ収束
            py *= 1.0 - smoothstep(10.6, 12.1, px);
          }
          clampedPts.push([px, py]);
        }

        let maxH = 0;
        for (const p of clampedPts) if (p[1] > maxH) maxH = p[1];

        if (maxH > 0.06 && clampedPts.length >= 2) {
          // [C-02] 川側垂直絶壁カット修正：TOE_RIVER_X (-12.5), 0 から表法面を登って phreatic[0] へ滑らか接続！
          const shape = new THREE.Shape();
          const startX = Math.min(GEOM.TOE_RIVER_X, clampedPts[0][0]);
          shape.moveTo(startX, 0);

          const phStartX = clampedPts[0][0];
          if (phStartX > startX + 0.05) {
            const climbSteps = 12;
            for (let s = 1; s < climbSteps; s++) {
              const cx = lerp(startX, phStartX, s / climbSteps);
              const cy = clamp(samplePolylineY(profile, cx), 0.0, Math.max(0.0, frame.water_y));
              shape.lineTo(cx, cy);
            }
          }
          for (const p of clampedPts) shape.lineTo(p[0], p[1]);
          const endX = clampedPts[clampedPts.length - 1][0];
          shape.lineTo(endX, 0);
          shape.closePath();

          const polyGeo = new THREE.ShapeGeometry(shape);
          polyGeo.translate(0, 0, GEOM.Z_MAX + 0.048);
          this.phreaticPolyMesh.geometry.dispose();
          this.phreaticPolyMesh.geometry = polyGeo;
          this.phreaticPolyMesh.visible = true;

          const haloGeo = buildRibbonGeometry(clampedPts, 0.25, GEOM.Z_MAX + 0.082);
          const lineGeo = buildRibbonGeometry(clampedPts, 0.14, GEOM.Z_MAX + 0.090);
          if (haloGeo && lineGeo) {
            this.phreaticHaloMesh.geometry.dispose();
            this.phreaticHaloMesh.geometry = haloGeo;
            this.phreaticLineMesh.geometry.dispose();
            this.phreaticLineMesh.geometry = lineGeo;
            this.phreaticHaloMesh.visible = true;
            this.phreaticLineMesh.visible = true;
          }
        } else {
          this.phreaticPolyMesh.visible = false;
          this.phreaticHaloMesh.visible = false;
          this.phreaticLineMesh.visible = false;
        }
      } else {
        this.phreaticPolyMesh.visible = false;
        this.phreaticHaloMesh.visible = false;
        this.phreaticLineMesh.visible = false;
      }

      // 流線ガイドリボン（暗色縁取り＋細身発光芯線）
      while (this.streamHaloGroup.children.length > 0) {
        this.streamHaloGroup.children.pop().geometry.dispose();
      }
      while (this.streamRibbonGroup.children.length > 0) {
        this.streamRibbonGroup.children.pop().geometry.dispose();
      }
      for (let li = 0; li < lines.length; li++) {
        const pts = lines[li];
        if (!Array.isArray(pts) || pts.length < 2) continue;
        const hGeo = buildRibbonGeometry(pts, 0.11, GEOM.Z_MAX + 0.096);
        const rGeo = buildRibbonGeometry(pts, 0.052, GEOM.Z_MAX + 0.102);
        if (hGeo) this.streamHaloGroup.add(new THREE.Mesh(hGeo, this.streamHaloMat));
        if (rGeo) this.streamRibbonGroup.add(new THREE.Mesh(rGeo, this.streamRibbonMat));
      }
    }

    const speedFactor = lerp(0.16, isHighGrad ? 0.72 : 0.42, clamp(grad / 0.8, 0, 1));
    this._streamPhase = (this._streamPhase + dt * speedFactor) % 1.0;

    if (isHighGrad) {
      this.streamRibbonMat.color.set('#fb7185');
      this.streamRibbonMat.opacity = 0.84;
    } else if (grad >= 0.32) {
      this.streamRibbonMat.color.set('#38bdf8');
      this.streamRibbonMat.opacity = 0.72;
    } else {
      this.streamRibbonMat.color.set('#38bdf8');
      this.streamRibbonMat.opacity = 0.56;
    }

    // 矢尻コーン粒子を各流線の接線方向へ向けて配置・滑走
    let instIdx = 0;
    const particlesPerLine = lines.length > 0 ? Math.min(10, Math.floor(this.maxStreamParticles / lines.length)) : 0;

    for (let li = 0; li < lines.length; li++) {
      const pts = lines[li];
      if (!Array.isArray(pts) || pts.length < 2) continue;

      const cumLen = new Float32Array(pts.length);
      for (let k = 1; k < pts.length; k++) {
        cumLen[k] = cumLen[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
      }
      const totalL = cumLen[pts.length - 1];
      if (totalL < 0.25) continue;

      const isDeepGravel = pts[Math.floor(pts.length * 0.5)][1] < -2.0;

      for (let pi = 0; pi < particlesPerLine && instIdx < this.maxStreamParticles; pi++) {
        const u = (pi / particlesPerLine + this._streamPhase + li * 0.17) % 1.0;
        const targetL = u * totalL;
        let seg = 0;
        while (seg < pts.length - 2 && cumLen[seg + 1] < targetL) seg++;
        const segLen = Math.max(1e-4, cumLen[seg + 1] - cumLen[seg]);
        const f = clamp((targetL - cumLen[seg]) / segLen, 0, 1);
        const px = lerp(pts[seg][0], pts[seg + 1][0], f);
        const py = lerp(pts[seg][1], pts[seg + 1][1], f);

        // 接線方向角度を算出して矢尻を進行方向へ回転
        const dx = pts[seg + 1][0] - pts[seg][0];
        const dy = pts[seg + 1][1] - pts[seg][1];
        const angle = Math.atan2(dy, dx);

        this._dummy.position.set(px, py, GEOM.Z_MAX + 0.135);
        this._dummy.rotation.set(0, 0, angle);
        const sc = isHighGrad && isDeepGravel ? 1.15 : 0.96;
        this._dummy.scale.set(sc, sc, sc);
        this._dummy.updateMatrix();
        this.streamParticles.setMatrixAt(instIdx, this._dummy.matrix);

        if (isHighGrad && isDeepGravel && px > 4.0) {
          this._tmpColor.set('#ff4d4f');
        } else if (isHighGrad && isDeepGravel) {
          this._tmpColor.set('#fbbf24');
        } else {
          this._tmpColor.set('#e0f2fe');
        }
        this.streamParticles.setColorAt(instIdx, this._tmpColor);
        instIdx++;
      }
    }

    this.streamParticles.count = instIdx;
    this.streamParticles.instanceMatrix.needsUpdate = true;
    if (this.streamParticles.instanceColor) {
      this.streamParticles.instanceColor.needsUpdate = true;
    }
  }

  // --------------------------------------------------------------------------
  // 5. 越水瀑布リボン ＆ 白波飛沫パーティクル [C-06][M-06]
  // --------------------------------------------------------------------------
  _initOvertopVisuals() {
    this.overtopGroup = new THREE.Group();
    this.overtopGroup.visible = false;
    this.root.add(this.overtopGroup);

    this.waterfallMat = new THREE.MeshStandardMaterial({
      map: this.texWaterfall,
      color: new THREE.Color('#dce8ee'),
      roughness: 0.26,
      metalness: 0.04,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
    });
    this.waterfallMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.waterfallMat);
    this.overtopGroup.add(this.waterfallMesh);

    // [M-06] 増強された白波飛沫パーティクル（360粒）
    this.splashCount = 360;
    const sPos = new Float32Array(this.splashCount * 3);
    const sCol = new Float32Array(this.splashCount * 3);
    this.splashData = [];
    for (let i = 0; i < this.splashCount; i++) {
      this.splashData.push({
        phase: Math.random(),
        speed: 0.7 + Math.random() * 0.85,
        zOff: Math.random(),
        vx: 1.8 + Math.random() * 4.8,
        vy: 1.5 + Math.random() * 4.0,
        vz: (Math.random() - 0.5) * 2.2,
      });
      const white = 0.88 + Math.random() * 0.12;
      sCol[i * 3 + 0] = white;
      sCol[i * 3 + 1] = white * 0.98;
      sCol[i * 3 + 2] = white * 0.96;
    }
    const sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
    sGeo.setAttribute('color', new THREE.BufferAttribute(sCol, 3));
    const sMat = new THREE.PointsMaterial({
      size: 0.72,
      map: this.texParticle,
      vertexColors: true,
      transparent: true,
      opacity: 0.86,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    this.splashPoints = new THREE.Points(sGeo, sMat);
    this.overtopGroup.add(this.splashPoints);
  }

  _updateOvertopVisuals(frame, mode, mitigated, dt) {
    const oDepth = frame.overtop_depth ?? 0;
    const breachFlow = mode === 'overtop' && (frame.breach_prog ?? 0) > 0.35 && frame.water_y > 0.8;
    const active = oDepth > 0.015 || breachFlow;
    this.overtopGroup.visible = active;
    if (!active) return;

    this.texWaterfall.offset.y -= dt * (mitigated ? 2.4 : 3.5);

    const profile = frame.profile_xy;
    const isFullCrestOvertop = oDepth > 0.015;
    const zStart = isFullCrestOvertop ? -15.86 : 3.2;
    const zEnd = 15.92;
    const nx = 36;
    const nz = isFullCrestOvertop ? 20 : 12;
    // [C-06] 越水時は表法肩 GEOM.CREST_X0 (-2.5) から正確に開始し河川水面とZ-fighting完全ゼロ！
    const xStart = isFullCrestOvertop ? GEOM.CREST_X0 : -4.5;
    const xEnd = 15.6;

    const pos = new Float32Array((nx + 1) * (nz + 1) * 3);
    const uv = new Float32Array((nx + 1) * (nz + 1) * 2);
    const idx = [];
    const effDepth = Math.max(oDepth, breachFlow ? clamp((frame.water_y - 0.5) * 0.32, 0.15, 0.72) : 0.12);
    const t = this._clockSec;

    let ptr = 0;
    for (let iz = 0; iz <= nz; iz++) {
      const vz = iz / nz;
      const z = lerp(zStart, zEnd, vz);
      const wZ = smoothstep(GEOM.DYNAMIC_Z_START, 7.2, z);
      for (let ix = 0; ix <= nx; ix++) {
        const vx = ix / nx;
        const x = lerp(xStart, xEnd, vx);
        const stdY = Math.max(0.0, standardSurfaceY(x));
        const defY = Math.max(0.0, samplePolylineY(profile, x));
        const surfY = lerp(stdY, defY, wZ);

        let y;
        if (isFullCrestOvertop && x <= GEOM.CREST_X1) {
          // 天端上は河川水面 wy から裏法肩へ段差ゼロ・Z-fightingゼロで連続流下
          const crestU = clamp((x - GEOM.CREST_X0) / (GEOM.CREST_X1 - GEOM.CREST_X0), 0, 1);
          const endY = Math.max(surfY + 0.08, surfY + oDepth * 0.72);
          const ripple = Math.sin(x * 2.2 - t * 12.0 + z * 0.5) * 0.032 * crestU;
          y = Math.max(surfY + 0.06, lerp(frame.water_y, endY, crestU) + ripple);
        } else {
          const slopeThick = effDepth * 0.62 + (x > 11.5 ? 0.22 : 0.08);
          const turbulence = Math.sin(x * 1.9 - t * 14.0 + z * 0.6) * 0.06;
          y = surfY + slopeThick + turbulence;
        }

        pos[ptr * 3 + 0] = x;
        pos[ptr * 3 + 1] = y;
        pos[ptr * 3 + 2] = z;
        uv[ptr * 2 + 0] = vz * (isFullCrestOvertop ? 5.0 : 2.2);
        uv[ptr * 2 + 1] = vx * 3.2;
        ptr++;
      }
    }
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const a = iz * (nx + 1) + ix;
        const b = a + 1;
        const c = a + (nx + 1);
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    this.waterfallMesh.geometry.dispose();
    this.waterfallMesh.geometry = geo;

    // 飛沫・白波パーティクル（破堤口通過流・裏法尻衝突部）
    const pAttr = this.splashPoints.geometry.attributes.position;
    const bp = frame.breach_prog ?? 0;
    const hitX = bp > 0.55 ? lerp(6.0, 11.5, 0.5) : clamp(12.5 - bp * 6.0, 4.5, 12.8);
    const hitY = Math.max(0.15, samplePolylineY(profile, hitX));
    const intensity = clamp(effDepth * 2.4 + bp * 0.45, 0.4, 1.5) * (mitigated ? 0.65 : 1.2);
    const splashZ0 = mitigated ? -14.5 : 3.4;

    for (let i = 0; i < this.splashCount; i++) {
      const d = this.splashData[i];
      d.phase = (d.phase + dt * d.speed) % 1.0;
      const u = d.phase;
      const px = hitX + d.vx * u * intensity;
      const py = hitY + d.vy * u * intensity - 4.8 * u * u * intensity;
      const pz = lerp(splashZ0, zEnd - 0.3, d.zOff) + d.vz * u;
      pAttr.setXYZ(i, px, Math.max(0.06, py), pz);
    }
    pAttr.needsUpdate = true;
  }

  // --------------------------------------------------------------------------
  // 6. 浸透・円弧すべり可視化（断面内楔形亀裂＋滑落土塊＋押し出し隆起） [C-05]
  // --------------------------------------------------------------------------
  _initSlipVisuals() {
    this.slipGroup = new THREE.Group();
    this.slipGroup.visible = false;
    this.root.add(this.slipGroup);

    this.slipArcMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ef4444'),
      transparent: true,
      opacity: 0.96,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.slipArcMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.slipArcMat);
    this.slipGroup.add(this.slipArcMesh);

    this.slipPivot = new THREE.Group();
    this.slipGroup.add(this.slipPivot);

    // 芝生上面＋濡れた暗褐色断面の高コントラスト滑落土塊
    this.slipBlockMatSide = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#537836'),
      roughness: 0.88,
    });
    this.slipBlockMatCap = new THREE.MeshStandardMaterial({
      map: this.texSoil,
      color: new THREE.Color('#805532'),
      roughness: 0.92,
    });
    this.slipBlockMesh = new THREE.Mesh(new THREE.BufferGeometry(), [
      this.slipBlockMatCap,
      this.slipBlockMatSide,
    ]);
    this.slipBlockMesh.castShadow = true;
    this.slipBlockMesh.visible = false;
    this.slipPivot.add(this.slipBlockMesh);

    // [C-05] 巨大黒箱を廃止 → 天端表面 (Y <= surfY) 内に完全に収まる楔形スリット亀裂
    this.crackMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#3b2515'),
      roughness: 0.96,
      side: THREE.DoubleSide,
    });
    this.crackMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.crackMat);
    this.crackMesh.visible = false;
    this.slipGroup.add(this.crackMesh);

    // 裏法尻押し出し隆起マウンド
    const debrisGeo = new THREE.SphereGeometry(1.0, 18, 12);
    const debrisMat = new THREE.MeshStandardMaterial({
      map: this.texSoil,
      color: new THREE.Color('#754f2d'),
      roughness: 0.96,
    });
    this.debrisMound = new THREE.Mesh(debrisGeo, debrisMat);
    this.debrisMound.visible = false;
    this.slipGroup.add(this.debrisMound);

    this._lastSlipKey = '';
  }

  _updateSlipVisuals(frame, mode, mitigated) {
    const sc = frame.slip_circle;
    const slideProg = sc?.slide_prog ?? 0;
    const showSlip = mode === 'seepage' || slideProg > 0.01;
    this.slipGroup.visible = showSlip;
    if (!showSlip || !sc) return;

    const { cx, cy, r } = sc;
    const fs = frame.fs_slope ?? 1.5;

    const arcPts = [];
    const steps = 72;
    for (let i = 0; i <= steps; i++) {
      const ang = Math.PI + (i / steps) * Math.PI;
      const x = cx + r * Math.cos(ang);
      const y = cy + r * Math.sin(ang);
      if (x < -3.5 || x > 15.5) continue;
      const surfY = standardSurfaceY(x);
      if (y <= surfY + 0.06 && y >= -0.9) {
        arcPts.push([x, y]);
      }
    }

    if (arcPts.length >= 2) {
      const arcGeo = buildRibbonGeometry(arcPts, slideProg > 0.02 || fs < 1.2 ? 0.25 : 0.16, GEOM.Z_MAX + 0.145);
      if (arcGeo) {
        this.slipArcMesh.geometry.dispose();
        this.slipArcMesh.geometry = arcGeo;
      }
      if (fs < 1.0 || slideProg > 0.02) {
        const pulse = 0.80 + 0.20 * Math.sin(this._clockSec * 7.5);
        this.slipArcMat.color.set('#ef4444');
        this.slipArcMat.opacity = pulse;
      } else if (fs < 1.2) {
        this.slipArcMat.color.set('#f59e0b');
        this.slipArcMat.opacity = 0.92;
      } else {
        this.slipArcMat.color.set(mitigated ? '#34d399' : '#fbbf24');
        this.slipArcMat.opacity = mitigated ? 0.58 : 0.72;
      }
      this.slipArcMesh.visible = true;
    } else {
      this.slipArcMesh.visible = false;
    }

    // 回転滑落する裏法土塊 (slide_prog > 0.01)
    if (slideProg > 0.01 && arcPts.length >= 4) {
      const slipKey = `${cx.toFixed(1)}_${cy.toFixed(1)}_${r.toFixed(1)}`;
      if (slipKey !== this._lastSlipKey) {
        this._lastSlipKey = slipKey;
        const shape = new THREE.Shape();
        const pFirst = arcPts[0];
        const pLast = arcPts[arcPts.length - 1];
        shape.moveTo(pFirst[0] - cx, pFirst[1] - cy);
        for (let i = 1; i < arcPts.length; i++) {
          shape.lineTo(arcPts[i][0] - cx, arcPts[i][1] - cy);
        }
        const topSteps = 16;
        for (let i = topSteps; i >= 0; i--) {
          const x = lerp(pFirst[0], pLast[0], i / topSteps);
          const y = standardSurfaceY(x);
          shape.lineTo(x - cx, y - cy);
        }
        shape.closePath();

        const extGeo = new THREE.ExtrudeGeometry(shape, {
          depth: 12.2,
          bevelEnabled: false,
        });
        extGeo.translate(0, 0, 3.8);
        this.slipBlockMesh.geometry.dispose();
        this.slipBlockMesh.geometry = extGeo;
      }

      this.slipPivot.position.set(cx, cy, 0);
      // [C-05] 0.24 rad の絶妙な回転滑動で滑落崖と裏法尻押し出し隆起を明瞭表示
      this.slipPivot.rotation.z = slideProg * 0.24;
      this.slipBlockMesh.visible = true;

      // [C-05] 断面内側に完全に収まる楔形スリット亀裂（天端 Y<=surfY より上に絶対飛び出さない！）
      const topX = arcPts[0][0];
      const topSurfY = Math.min(GEOM.CREST_Y, standardSurfaceY(topX));
      const crackW = 0.28 + slideProg * 0.65;
      const crackDepth = 0.75 + slideProg * 1.15;
      const rightSurfY = Math.min(GEOM.CREST_Y, standardSurfaceY(topX + crackW));

      const wedgeShape = new THREE.Shape();
      wedgeShape.moveTo(topX, topSurfY - 0.02);
      wedgeShape.lineTo(topX + crackW, rightSurfY - 0.02);
      wedgeShape.lineTo(topX + crackW * 0.35, Math.max(0.2, topSurfY - crackDepth));
      wedgeShape.closePath();

      const wedgeGeo = new THREE.ExtrudeGeometry(wedgeShape, {
        depth: 11.8,
        bevelEnabled: false,
      });
      wedgeGeo.translate(0, 0, 4.18);
      this.crackMesh.geometry.dispose();
      this.crackMesh.geometry = wedgeGeo;
      this.crackMesh.visible = true;

      // 裏法尻の押し出し隆起土砂マウンド
      this.debrisMound.visible = true;
      this.debrisMound.position.set(13.0 + slideProg * 1.35, 0.15 + slideProg * 0.38, 10.2);
      this.debrisMound.scale.set(1.3 + slideProg * 2.1, 0.35 + slideProg * 0.85, 5.6);
    } else {
      this.slipBlockMesh.visible = false;
      this.crackMesh.visible = false;
      this.debrisMound.visible = false;
    }
  }

  // --------------------------------------------------------------------------
  // 7. 基礎地盤パイピング ＆ 噴砂（実解析1D pressure_grid 双線形ヒートマップ・空洞・陥没） [C-04]
  // --------------------------------------------------------------------------
  _initPipingVisuals() {
    this.pipingGroup = new THREE.Group();
    this.root.add(this.pipingGroup);

    // (A) 実解析 pressure_grid 1D/2D 両対応・双線形補間ヒートマップ
    this.pressureCanvas = document.createElement('canvas');
    this.pressureCanvas.width = 160;
    this.pressureCanvas.height = 48;
    this.pressureCtx = this.pressureCanvas.getContext('2d');
    this.pressureImgData = this.pressureCtx.createImageData(160, 48);
    this.pressureTex = new THREE.CanvasTexture(this.pressureCanvas);
    this.pressureTex.minFilter = THREE.LinearFilter;
    this.pressureTex.magFilter = THREE.LinearFilter;

    // 範囲: X = -24..+24 (幅 48m), Y = -7.5..0.0 (高 7.5m) → 基礎地盤（粘土＋砂礫層）へ完全一致
    const pGeo = new THREE.PlaneGeometry(48.0, 7.5);
    const pMat = new THREE.MeshBasicMaterial({
      map: this.pressureTex,
      transparent: true,
      opacity: 0.84,
      depthWrite: false,
    });
    this.pressureMesh = new THREE.Mesh(pGeo, pMat);
    this.pressureMesh.position.set(0.0, -3.75, GEOM.Z_MAX + 0.042);
    this.pressureMesh.visible = false;
    this.pipingGroup.add(this.pressureMesh);

    // (B) 裏法尻の揚圧力上向き矢印群
    this.upliftGroup = new THREE.Group();
    this.upliftGroup.visible = false;
    const arrowMat = new THREE.MeshBasicMaterial({ color: '#ff4d4f' });
    for (let i = 0; i < 3; i++) {
      const aGroup = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.10, 0.95, 8), arrowMat);
      shaft.position.y = 0.48;
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.50, 10), arrowMat);
      head.position.y = 1.18;
      aGroup.add(shaft, head);
      aGroup.position.set(12.2 + i * 1.15, -2.35, GEOM.Z_MAX + 0.16);
      this.upliftGroup.add(aGroup);
    }
    this.pipingGroup.add(this.upliftGroup);

    // (C) [C-04] 不規則な濁水空洞パイプ（単調な黒帯＋黄点滅を廃止！）
    this.tunnelMat = new THREE.MeshBasicMaterial({
      map: this.texPiping,
      transparent: true,
      opacity: 0.96,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.tunnelMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.tunnelMat);
    this.tunnelMesh.visible = false;
    this.pipingGroup.add(this.tunnelMesh);

    // [C-04] 真っ黒ベタ2D円板を完全廃止 → 放射グラデ＋崩落土砂＆亀裂の立体的陥没表現
    this.sinkVoidMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(5.2, 3.8),
      new THREE.MeshBasicMaterial({
        map: this.texSinkhole,
        transparent: true,
        opacity: 0.94,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    this.sinkVoidMesh.position.set(1.5, -0.4, GEOM.Z_MAX + 0.11);
    this.sinkVoidMesh.visible = false;
    this.pipingGroup.add(this.sinkVoidMesh);

    // (D) 噴砂丘（サンドボイル）2基 ＋ 噴出濁水・砂粒子
    this.boilGroup = new THREE.Group();
    this.boilGroup.visible = false;
    this.pipingGroup.add(this.boilGroup);

    const coneMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#bfa073'),
      roughness: 0.96,
    });
    const craterMat = new THREE.MeshBasicMaterial({ color: '#47301d' });

    this.boilMounds = [];
    const boilPositions = [
      { x: 13.35, z: 14.9, scale: 1.0 },
      { x: 14.05, z: 10.6, scale: 0.78 },
    ];
    for (const bp of boilPositions) {
      const m = new THREE.Group();
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 1.45, 0.75, 18), coneMat);
      cone.position.y = 0.37;
      const crater = new THREE.Mesh(new THREE.CircleGeometry(0.31, 14), craterMat);
      crater.rotation.x = -Math.PI / 2;
      crater.position.y = 0.76;
      m.add(cone, crater);
      m.position.set(bp.x, 0.0, bp.z);
      this.boilGroup.add(m);
      this.boilMounds.push({ group: m, baseScale: bp.scale, x: bp.x, z: bp.z });
    }

    this.boilParticleCount = 240;
    const bPos = new Float32Array(this.boilParticleCount * 3);
    const bCol = new Float32Array(this.boilParticleCount * 3);
    this.boilSeeds = [];
    for (let i = 0; i < this.boilParticleCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spread = 0.25 + Math.random() * 1.15;
      this.boilSeeds.push({
        moundIdx: i % boilPositions.length,
        phase: Math.random(),
        speed: 0.8 + Math.random() * 0.9,
        vx: Math.cos(angle) * spread,
        vz: Math.sin(angle) * spread,
        vy: 2.0 + Math.random() * 2.8,
      });
      const isSand = Math.random() > 0.45;
      bCol[i * 3 + 0] = isSand ? 0.82 : 0.66;
      bCol[i * 3 + 1] = isSand ? 0.68 : 0.54;
      bCol[i * 3 + 2] = isSand ? 0.46 : 0.38;
    }
    const bGeo = new THREE.BufferGeometry();
    bGeo.setAttribute('position', new THREE.BufferAttribute(bPos, 3));
    bGeo.setAttribute('color', new THREE.BufferAttribute(bCol, 3));
    this.boilParticles = new THREE.Points(
      bGeo,
      new THREE.PointsMaterial({
        size: 0.42,
        map: this.texParticle,
        vertexColors: true,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      })
    );
    this.boilGroup.add(this.boilParticles);

    // (E) 地中パイピング空洞内を川側→噴砂丘へ吸い出される微細砂粒パーティクル
    this.pipeSandCount = 64;
    const psPos = new Float32Array(this.pipeSandCount * 3);
    this.pipeSandPhases = new Float32Array(this.pipeSandCount);
    for (let i = 0; i < this.pipeSandCount; i++) {
      this.pipeSandPhases[i] = Math.random();
    }
    const psGeo = new THREE.BufferGeometry();
    psGeo.setAttribute('position', new THREE.BufferAttribute(psPos, 3));
    this.pipeSandPoints = new THREE.Points(
      psGeo,
      new THREE.PointsMaterial({
        size: 0.24,
        color: new THREE.Color('#e6c28b'),
        map: this.texParticle,
        transparent: true,
        opacity: 0.88,
        depthWrite: false,
      })
    );
    this.pipeSandPoints.visible = false;
    this.pipingGroup.add(this.pipeSandPoints);

    this._lastPipePts = [];
    this.heatmapActive = false;
  }

  _updatePipingVisuals(frame, mode, mitigated, showSeepage, dt, geomDirty) {
    const grad = frame.hydraulic_grad ?? 0.08;
    const prog = frame.piping_prog ?? 0;
    const isPipingMode = mode === 'piping';

    const showHeatmap = showSeepage && (isPipingMode || grad > 0.35);
    this.heatmapActive = showHeatmap;
    this.pressureMesh.visible = showHeatmap;
    if (showHeatmap && geomDirty) {
      this._renderPressureHeatmap(frame, mitigated, isPipingMode);
    }

    // 揚圧力矢印
    const showUplift = isPipingMode && !mitigated && grad >= 0.38;
    this.upliftGroup.visible = showUplift;
    if (showUplift) {
      const bob = Math.sin(this._clockSec * 6.5) * 0.14;
      const sc = clamp((grad - 0.3) * 1.8, 0.55, 1.3);
      this.upliftGroup.children.forEach((a, idx) => {
        a.position.y = -2.35 + bob + (idx % 2) * 0.08;
        a.scale.set(1, sc, 1);
      });
    }

    // [C-04] 不規則幅の濁水空洞トンネル（UVスクロールで泥水が右へ吸い出される動きを演出）
    if (prog > 0.04) {
      this.texPiping.offset.x += dt * (0.9 + prog * 1.4);
      if (geomDirty || this._lastPipePts.length === 0) {
        const xTip = lerp(12.2, -12.2, clamp(prog / 0.85, 0, 1));
        const pipePts = [
          [13.35, 0.02],
          [13.15, -0.85],
          [12.75, -2.22],
        ];
        const widths = [0.46, 0.42, 0.55];
        const segs = 20;
        const baseThick = lerp(0.32, 0.88, prog);
        for (let i = 1; i <= segs; i++) {
          const u = i / segs;
          const x = lerp(12.75, xTip, u);
          const zig = Math.sin(u * 13.0) * 0.14 + Math.cos(u * 23.0) * 0.06;
          pipePts.push([x, -2.38 + zig]);
          // 先端へ向かって不規則に細くなる有機的な水みち幅
          const taper = 1.0 - 0.55 * Math.pow(u, 1.6);
          const irreg = 0.84 + 0.28 * Math.sin(u * 19.0 + 1.1);
          widths.push(baseThick * taper * irreg);
        }
        this._lastPipePts = pipePts;
        const tGeo = buildRibbonGeometry(pipePts, widths, GEOM.Z_MAX + 0.112);
        if (tGeo) {
          this.tunnelMesh.geometry.dispose();
          this.tunnelMesh.geometry = tGeo;
        }
      }
      this.tunnelMesh.visible = true;

      // パイプ内を川側先端 → 裏法尻噴砂口へ吸い出される微細砂粒
      const pts = this._lastPipePts;
      if (pts.length >= 2) {
        this.pipeSandPoints.visible = true;
        const psAttr = this.pipeSandPoints.geometry.attributes.position;
        for (let i = 0; i < this.pipeSandCount; i++) {
          this.pipeSandPhases[i] = (this.pipeSandPhases[i] + dt * (0.48 + prog * 0.65)) % 1.0;
          const fIdx = (1.0 - this.pipeSandPhases[i]) * (pts.length - 1);
          const i0 = Math.floor(fIdx);
          const i1 = Math.min(pts.length - 1, i0 + 1);
          const fr = fIdx - i0;
          const px = lerp(pts[i0][0], pts[i1][0], fr);
          const py = lerp(pts[i0][1], pts[i1][1], fr) + Math.sin(i * 3.1 + this._clockSec * 12) * 0.09;
          psAttr.setXYZ(i, px, py, GEOM.Z_MAX + 0.132);
        }
        psAttr.needsUpdate = true;
      }

      // 貫通時の堤体直下ゆるみ・陥没表現（上部沈下と連動）
      if (prog > 0.60) {
        const s = smoothstep(0.60, 1.0, prog);
        const crestDropY = samplePolylineY(frame.profile_xy, 1.5);
        this.sinkVoidMesh.visible = true;
        this.sinkVoidMesh.position.set(1.2, Math.min(-0.1, crestDropY * 0.25 - 0.65), GEOM.Z_MAX + 0.108);
        this.sinkVoidMesh.scale.set(0.55 + 0.65 * s, 0.55 + 0.65 * s, 1);
      } else {
        this.sinkVoidMesh.visible = false;
      }
    } else {
      this.tunnelMesh.visible = false;
      this.sinkVoidMesh.visible = false;
      this.pipeSandPoints.visible = false;
    }

    // 噴砂丘＆濁水・砂粒子噴出
    if (prog > 0.06) {
      this.boilGroup.visible = true;
      const moundGrowth = clamp((prog - 0.06) / 0.55, 0.15, 1.15);
      for (const bm of this.boilMounds) {
        bm.group.scale.setScalar(bm.baseScale * moundGrowth);
      }
      const pAttr = this.boilParticles.geometry.attributes.position;
      const jetPower = clamp(prog * 1.45, 0.35, 1.35);
      for (let i = 0; i < this.boilParticleCount; i++) {
        const sd = this.boilSeeds[i];
        sd.phase = (sd.phase + dt * sd.speed) % 1.0;
        const u = sd.phase;
        const bm = this.boilMounds[sd.moundIdx];
        const topY = 0.72 * bm.baseScale * moundGrowth;
        const px = bm.x + sd.vx * u * jetPower;
        const pz = bm.z + sd.vz * u * jetPower;
        const py = topY + sd.vy * u * jetPower - 4.4 * u * u * jetPower;
        pAttr.setXYZ(i, px, Math.max(0.08, py), pz);
      }
      pAttr.needsUpdate = true;
    } else {
      this.boilGroup.visible = false;
    }
  }

  /** [C-04] 実解析 pressure_grid (1D配列 nx×ny / 2D配列両対応) 双線形補間ヒートマップ */
  _renderPressureHeatmap(frame, mitigated, isPipingMode) {
    const ctx = this.pressureCtx;
    const W = this.pressureCanvas.width;
    const H = this.pressureCanvas.height;
    const img = this.pressureImgData;
    const data = img.data;

    const xMin = -24.0;
    const xMax = 24.0;
    const yMin = -7.5;
    const yMax = 0.0;

    const pg = frame.pressure_grid;
    const has1D =
      pg &&
      typeof pg.nx === 'number' &&
      typeof pg.ny === 'number' &&
      Array.isArray(pg.values) &&
      pg.values.length >= pg.nx * pg.ny &&
      typeof pg.values[0] === 'number';
    let grid2D = null;
    if (!has1D) {
      if (Array.isArray(pg) && pg.length > 1 && Array.isArray(pg[0]) && typeof pg[0][0] === 'number') {
        grid2D = pg;
      } else if (pg && Array.isArray(pg.values) && Array.isArray(pg.values[0])) {
        grid2D = pg.values;
      }
    }

    // 1D 実解析データの砂礫層最大値を確認し、無対策・対策工の相対差を鮮明かつ忠実に表現
    let pgX0 = -24.0;
    let pgX1 = 24.0;
    let pgY0 = -8.0;
    let pgY1 = 4.5;
    let maxSubsoilVal = 0.01;
    if (has1D) {
      pgX0 = pg.x_min ?? -24.0;
      pgX1 = pg.x_max ?? 24.0;
      pgY0 = pg.y_min ?? -8.0;
      pgY1 = pg.y_max ?? 4.5;
      for (let iy = 0; iy < pg.ny; iy++) {
        const yRow = lerp(pgY0, pgY1, iy / Math.max(1, pg.ny - 1));
        if (yRow > 0.2) continue;
        for (let ix = 0; ix < pg.nx; ix++) {
          const v = pg.values[iy * pg.nx + ix];
          if (v > maxSubsoilVal) maxSubsoilVal = v;
        }
      }
    }

    const headNorm = clamp((frame.water_y + 1.5) / 6.0, 0.04, 1.0);
    const gradNorm = clamp((frame.hydraulic_grad ?? 0.1) / 0.78, 0.05, 1.0);

    // 1D グリッド双線形補間サンプラー
    const sample1D = (wx, wy) => {
      const fx = clamp((wx - pgX0) / Math.max(1e-4, pgX1 - pgX0), 0, 1) * (pg.nx - 1);
      const fy = clamp((wy - pgY0) / Math.max(1e-4, pgY1 - pgY0), 0, 1) * (pg.ny - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(pg.nx - 1, x0 + 1);
      const y0 = Math.floor(fy);
      const y1 = Math.min(pg.ny - 1, y0 + 1);
      const tx = fx - x0;
      const ty = fy - y0;
      const v00 = pg.values[y0 * pg.nx + x0];
      const v10 = pg.values[y0 * pg.nx + x1];
      const v01 = pg.values[y1 * pg.nx + x0];
      const v11 = pg.values[y1 * pg.nx + x1];
      return lerp(lerp(v00, v10, tx), lerp(v01, v11, tx), ty);
    };

    for (let iy = 0; iy < H; iy++) {
      const vy = 1.0 - iy / (H - 1); // 0=bottom(-7.5), 1=top(0.0)
      const y = lerp(yMin, yMax, vy);
      for (let ix = 0; ix < W; ix++) {
        const vx = ix / (W - 1);
        const x = lerp(xMin, xMax, vx);

        let p = 0;
        if (has1D) {
          const raw = sample1D(x, y);
          // 実解析データを忠実に描画しつつ、無対策(最大~0.5-0.65)と対策ON(左1.0/右0.07)の対比を視認しやすく正規化
          const normScale = mitigated ? Math.max(0.85, maxSubsoilVal) : Math.max(0.48, maxSubsoilVal);
          p = clamp(raw / normScale, 0, 1);
          // 鋼矢板 ON では矢板(X=-11.8)境界のにじみを引き締め、川側高圧(赤) vs 堤内低圧(青)を際立たせる
          if (mitigated && isPipingMode && x > -11.6) {
            p = Math.min(p, clamp(raw * 1.15, 0.04, 0.24));
          }
        } else if (grid2D) {
          const fy = vy * (grid2D.length - 1);
          const y0 = Math.floor(fy);
          const y1 = Math.min(grid2D.length - 1, y0 + 1);
          const row0 = grid2D[y0];
          const row1 = grid2D[y1];
          const fx = vx * (row0.length - 1);
          const x0 = Math.floor(fx);
          const x1 = Math.min(row0.length - 1, x0 + 1);
          p = clamp(lerp(lerp(row0[x0], row0[x1], fx - x0), lerp(row1[x0], row1[x1], fx - x0), fy - y0), 0, 1);
        } else {
          let xDecay = clamp(1.0 - (x + 22.0) / 42.0, 0.0, 1.0);
          if (mitigated && x > -11.8) xDecay *= 0.22;
          p = headNorm * xDecay;
        }

        // 裏法尻の揚圧力集中（無対策時のみ粘土被覆層底面〜裏法尻の局所集中を補強）
        if (!mitigated && isPipingMode && gradNorm > 0.35 && x > 8.5 && x < 16.5 && y > -3.4) {
          const distBoil = Math.hypot((x - 12.6) / 3.8, (y + 1.8) / 1.9);
          const hotspot = Math.max(0, 1.0 - distBoil) * gradNorm * 0.96;
          p = clamp(Math.max(p, hotspot), 0, 1);
        }

        // 第2層砂礫層 (Y=-7.5..-2.2) を主表示、第1層粘土 (Y>-2.2) は裏法尻側＆川側高圧端のみ柔らかく表示
        let mask = 0.96;
        if (y > GEOM.CLAY_BOT) {
          if (x < -11.5) {
            mask = smoothstep(0.0, -2.0, y) * 0.72;
          } else if (x >= 9.0 && x <= 17.5) {
            mask = mitigated ? 0.24 : smoothstep(0.0, -1.6, y) * 0.85 + 0.12;
          } else {
            mask = 0.14;
          }
        }
        // 低水路の川底 (Y=-2.8) より上の水空間はカット
        if (x < -20.0 && y > standardSurfaceY(x)) {
          mask = 0.0;
        }

        const val = clamp(p, 0, 1);
        const alpha = mask <= 0.01 ? 0 : Math.floor(clamp((0.28 + val * 0.72) * mask * 195, 0, 205));

        // 鮮明な工学ヒートマップ: 濃青(低) → シアン → 黄 → 橙 → 赤(高)
        let r = 0;
        let g = 0;
        let b = 0;
        if (val < 0.28) {
          const k = val / 0.28;
          r = lerp(24, 56, k);
          g = lerp(78, 189, k);
          b = lerp(216, 248, k);
        } else if (val < 0.58) {
          const k = (val - 0.28) / 0.30;
          r = lerp(56, 250, k);
          g = lerp(189, 204, k);
          b = lerp(248, 21, k);
        } else if (val < 0.80) {
          const k = (val - 0.58) / 0.22;
          r = lerp(250, 249, k);
          g = lerp(204, 115, k);
          b = lerp(21, 22, k);
        } else {
          const k = (val - 0.80) / 0.20;
          r = lerp(249, 239, k);
          g = lerp(115, 48, k);
          b = lerp(22, 48, k);
        }

        const idx = (iy * W + ix) * 4;
        data[idx + 0] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = alpha;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.pressureTex.needsUpdate = true;
  }

  // --------------------------------------------------------------------------
  // 8. 河床洗掘・川表高速渦流 ＆ 崩落土砂粒子
  // --------------------------------------------------------------------------
  _initErosionVisuals() {
    this.erosionGroup = new THREE.Group();
    this.erosionGroup.visible = false;
    this.root.add(this.erosionGroup);

    this.streakMeshes = [];
    const streakMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#eef6fc'),
      transparent: true,
      opacity: 0.44,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    for (let i = 0; i < 10; i++) {
      const geo = new THREE.PlaneGeometry(0.45 + (i % 3) * 0.25, 6.0 + (i % 4) * 1.8);
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, streakMat);
      m.userData = {
        x: -26.0 + i * 1.55,
        zOffset: (i * 3.7) % 30.0,
        speed: 14.0 + (i % 3) * 4.5,
      };
      this.erosionGroup.add(m);
      this.streakMeshes.push(m);
    }

    this.vortexGroup = new THREE.Group();
    this.erosionGroup.add(this.vortexGroup);

    const vCount = 160;
    const vPos = new Float32Array(vCount * 3);
    const vCol = new Float32Array(vCount * 3);
    this.vortexSeeds = [];
    for (let i = 0; i < vCount; i++) {
      this.vortexSeeds.push({
        angle: Math.random() * Math.PI * 2,
        radius: 0.6 + Math.random() * 2.6,
        z: 3.5 + Math.random() * 12.0,
        speed: 3.0 + Math.random() * 3.5,
        yOff: Math.random(),
      });
      const sand = 0.62 + Math.random() * 0.30;
      vCol[i * 3 + 0] = sand;
      vCol[i * 3 + 1] = sand * 0.80;
      vCol[i * 3 + 2] = sand * 0.56;
    }
    const vGeo = new THREE.BufferGeometry();
    vGeo.setAttribute('position', new THREE.BufferAttribute(vPos, 3));
    vGeo.setAttribute('color', new THREE.BufferAttribute(vCol, 3));
    this.vortexPoints = new THREE.Points(
      vGeo,
      new THREE.PointsMaterial({
        size: 0.60,
        map: this.texParticle,
        vertexColors: true,
        transparent: true,
        opacity: 0.78,
        depthWrite: false,
      })
    );
    this.vortexGroup.add(this.vortexPoints);
  }

  _updateErosionVisuals(frame, mode, mitigated, dt) {
    const active = mode === 'erosion' && frame.water_y > 0.2;
    this.erosionGroup.visible = active;
    if (!active) return;

    const wy = frame.water_y;
    const scour = frame.scour_depth ?? 0;

    for (const m of this.streakMeshes) {
      const ud = m.userData;
      ud.zOffset = (ud.zOffset + dt * ud.speed) % 30.0;
      const z = -15.0 + ud.zOffset;
      const x = Math.min(ud.x, (this.currentWaterRightX ?? -12.0) - 0.8);
      m.position.set(x, wy + 0.08, z);
    }

    const showVortex = !mitigated && scour > 0.22;
    this.vortexGroup.visible = showVortex;
    if (showVortex) {
      const pAttr = this.vortexPoints.geometry.attributes.position;
      const cx = -13.5 + clamp(scour * 1.4, 0, 4.5);
      const cy = clamp(-0.8 + scour * 0.35, -1.5, 1.2);
      for (let i = 0; i < this.vortexSeeds.length; i++) {
        const s = this.vortexSeeds[i];
        s.angle += dt * s.speed;
        const r = s.radius * (0.65 + clamp(scour * 0.3, 0, 0.8));
        const px = cx + Math.cos(s.angle) * r;
        const py = cy + Math.sin(s.angle) * r * 0.6 + Math.sin(this._clockSec * 4 + s.yOff * 6) * 0.4;
        pAttr.setXYZ(i, px, clamp(py, -2.5, wy - 0.08), s.z);
      }
      pAttr.needsUpdate = true;
    }
  }

  // --------------------------------------------------------------------------
  // 全エフェクト統合フレーム更新
  // --------------------------------------------------------------------------
  update(frame, state, glbNodes, dt, forceRebuild = false) {
    this._clockSec += dt;
    const geomKey = `${state.mode}|${state.mitigated ? 1 : 0}|${state.showSeepage ? 1 : 0}|${(frame.t_hr ?? 0).toFixed(4)}`;
    const geomDirty = forceRebuild || geomKey !== this._lastGeomKey;
    this._lastGeomKey = geomKey;

    if (geomDirty) {
      this.updateDynamicLevee(frame, state.mode, glbNodes);
    }
    this._updateRiverWater(frame, state.mode, dt, geomDirty);
    this._updateInlandFlood(frame);
    this._updateSeepageVisuals(frame, state.mode, state.mitigated, state.showSeepage, dt, geomDirty);
    this._updateOvertopVisuals(frame, state.mode, state.mitigated, dt);
    this._updateSlipVisuals(frame, state.mode, state.mitigated);
    this._updatePipingVisuals(frame, state.mode, state.mitigated, state.showSeepage, dt, geomDirty);
    this._updateErosionVisuals(frame, state.mode, state.mitigated, dt);
  }
}

// ============================================================================
// 3D ピンラベル管理（実DOM UI パネル完全回避 ＋ SVGアイコン ＋ 破堤口切替） [C-03][M-06][P-01]
// ============================================================================
class PinLabelManager {
  constructor(container) {
    this.container = container;
    this.elMap = new Map();
    this._projVec = new THREE.Vector3();
    this.panelEls = {
      topbar: document.getElementById('topbar'),
      presets: document.getElementById('camera-presets'),
      left: document.getElementById('left-panel'),
      hud: document.getElementById('hud-panel'),
      timeline: document.getElementById('timeline-bar'),
    };
  }

  /** 実画面上の表示中 UI パネル矩形から 3D ラベルの安全配置矩形を計算 */
  _computeSafeRect(width, height) {
    const margin = 8;
    let left = margin;
    let right = width - margin;
    let top = 56;
    let bottom = height - 100;

    const topRect = this.panelEls.topbar?.getBoundingClientRect();
    if (topRect && topRect.height > 0) {
      top = Math.max(top, topRect.bottom + margin);
    }
    // モバイル2段目カメラプリセットバー
    if (width <= 768 && this.panelEls.presets) {
      const pr = this.panelEls.presets.getBoundingClientRect();
      if (pr.height > 0 && pr.top >= (topRect?.bottom ?? 40) - 4) {
        top = Math.max(top, pr.bottom + margin);
      }
    }

    const tlRect = this.panelEls.timeline?.getBoundingClientRect();
    if (tlRect && tlRect.height > 0 && tlRect.top < height) {
      bottom = Math.min(bottom, tlRect.top - margin);
    }

    const leftEl = this.panelEls.left;
    if (leftEl && !leftEl.classList.contains('collapsed')) {
      const lr = leftEl.getBoundingClientRect();
      if (lr.width > 0 && lr.right > 0 && lr.right < width * 0.65) {
        left = Math.max(left, lr.right + margin);
      }
    }

    const hudEl = this.panelEls.hud;
    if (hudEl && !hudEl.classList.contains('hud-collapsed')) {
      const hr = hudEl.getBoundingClientRect();
      if (hr.width > 0 && hr.left < width && hr.left > width * 0.35) {
        right = Math.min(right, hr.left - margin);
      }
    }

    return { left, right, top, bottom };
  }

  update(camera, width, height, state) {
    if (!state.showLabels || !state.hudVisible || !state.currentFrame) {
      this.container.style.display = 'none';
      return;
    }
    // モバイルで左パネルまたはHUDが開いているときはピンを隠してスッキリ視認性維持
    if (width <= 768) {
      const lOpen = !this.panelEls.left?.classList.contains('collapsed');
      const hOpen = !this.panelEls.hud?.classList.contains('hud-collapsed');
      if (lOpen || hOpen) {
        this.container.style.display = 'none';
        return;
      }
    }

    this.container.style.display = 'block';
    const safe = this._computeSafeRect(width, height);
    if (safe.right - safe.left < 110 || safe.bottom - safe.top < 80) {
      this.container.style.display = 'none';
      return;
    }

    const f = state.currentFrame;
    const isBreached = (f.breach_prog ?? 0) > 0.60;

    // [M-06] 破堤完了時は「堤防天端 (+5.0m)」を「破堤口（天端流出）」へ自動切替！
    const pins = [
      isBreached
        ? { id: 'crest', text: '破堤口（天端流出）', icon: 'warn', pos: [0.0, 2.2, 13.5], cls: 'pin-danger', prio: 9 }
        : { id: 'crest', text: '堤防天端 (+5.0m)', icon: 'dot', pos: [0.0, 5.25, 14.5], cls: '', prio: 6 },
      {
        id: 'river',
        text: `河川水位 (${f.water_y >= 0 ? '+' : ''}${f.water_y.toFixed(1)}m)`,
        icon: 'dot',
        pos: [-18.5, Math.max(-0.8, f.water_y + 0.55), 11.5],
        cls: 'pin-water',
        prio: 8,
      },
      {
        id: 'inland',
        text: f.inland_flood_y > 0.05 ? `住宅地浸水 (${f.inland_flood_y.toFixed(2)}m)` : '堤内地（住宅地）',
        icon: f.inland_flood_y > 0.15 ? 'warn' : 'dot',
        pos: [24.0, Math.max(2.6, f.inland_flood_y + 2.2), 4.0],
        cls: f.inland_flood_y > 0.15 ? 'pin-danger' : '',
        prio: 7,
      },
      { id: 'clay', text: '第1層 粘性土被覆', icon: 'dot', pos: [14.0, -1.1, 16.0], cls: 'pin-layer', prio: 3 },
      { id: 'gravel', text: '第2層 透水砂礫層', icon: 'dot', pos: [0.0, -4.8, 16.0], cls: 'pin-layer', prio: 4 },
      { id: 'base', text: '第3層 不透水基盤', icon: 'dot', pos: [0.0, -10.2, 16.0], cls: 'pin-layer', prio: 2 },
    ];

    // モード＆対策状態に応じた最優先強調ピン（SVG アイコン使用 [P-01]）
    if (state.mode === 'overtop') {
      if (state.mitigated) {
        pins.push({ id: 'dyn', text: '粘り強い堤防（ブロック被覆＋法尻保護）', icon: 'shield', pos: [7.2, 3.2, 13.0], cls: 'pin-measure', prio: 10 });
      } else if (f.overtop_depth > 0.02 || f.breach_prog > 0.15) {
        pins.push({ id: 'dyn', text: '越水・裏法尻の逆行洗掘（ヘッドカット）', icon: 'warn', pos: [8.5, 2.9, 14.5], cls: 'pin-danger', prio: 10 });
      }
    } else if (state.mode === 'seepage') {
      if (state.mitigated) {
        pins.push({ id: 'dyn', text: '砕石ドレーン工（浸潤面を低下）', icon: 'shield', pos: [10.8, 1.4, 15.6], cls: 'pin-measure', prio: 10 });
      } else {
        pins.push({ id: 'dyn', text: `危険すべり円弧 (Fs=${f.fs_slope.toFixed(2)})`, icon: f.fs_slope < 1.2 ? 'warn' : 'dot', pos: [8.2, 3.4, 15.8], cls: f.fs_slope < 1.2 ? 'pin-danger' : '', prio: 10 });
      }
    } else if (state.mode === 'piping') {
      if (state.mitigated) {
        pins.push({ id: 'dyn', text: '遮水鋼矢板（不透水層に根入れ定着）', icon: 'shield', pos: [-11.5, -3.5, 15.8], cls: 'pin-measure', prio: 10 });
      } else if (f.piping_prog > 0.06 || f.hydraulic_grad >= 0.45) {
        pins.push({ id: 'dyn', text: `裏法尻 噴砂（ボイリング）i=${f.hydraulic_grad.toFixed(2)}`, icon: 'warn', pos: [12.5, 1.9, 15.0], cls: 'pin-danger', prio: 10 });
      }
    } else if (state.mode === 'erosion') {
      if (state.mitigated) {
        pins.push({ id: 'dyn', text: '連結ブロック護岸＋根固めブロック工', icon: 'shield', pos: [-11.0, 2.1, 13.5], cls: 'pin-measure', prio: 10 });
      } else if (f.scour_depth > 0.25) {
        pins.push({ id: 'dyn', text: `河床・表法尻洗掘 (${f.scour_depth.toFixed(2)}m)`, icon: 'warn', pos: [-13.5, 1.4, 14.2], cls: 'pin-danger', prio: 10 });
      }
    }

    const activeIds = new Set();
    const projected = [];
    for (const p of pins) {
      this._projVec.set(p.pos[0], p.pos[1], p.pos[2]).project(camera);
      if (this._projVec.z > 1.0 || this._projVec.z < -1.0) continue;
      const sx = (this._projVec.x * 0.5 + 0.5) * width;
      const sy = (-this._projVec.y * 0.5 + 0.5) * height;
      // 画面完全外なら除外
      if (sx < -40 || sx > width + 40 || sy < -20 || sy > height + 20) continue;
      projected.push({ ...p, sx, sy });
    }

    // [C-03] 優先度降順で安全矩形内に配置（パネル裏埋没ゼロ＆ピン同士重なりゼロ）
    projected.sort((a, b) => b.prio - a.prio);
    const placedBoxes = [];

    for (const item of projected) {
      const estW = Math.min(280, item.text.length * 10.6 + (item.icon !== 'dot' ? 32 : 24));
      const estH = 26;
      const halfW = estW * 0.5;

      const minX = safe.left + halfW + 2;
      const maxX = safe.right - halfW - 2;
      const minY = safe.top + estH + 4;
      const maxY = safe.bottom - 4;
      if (minX > maxX || minY > maxY) continue;

      let x = item.sx;
      let y = item.sy;
      const outOfSafe = x < minX || x > maxX || y < minY || y > maxY;
      let clamped = false;

      if (outOfSafe) {
        // 低優先度の背景ラベル（地層等）がパネル領域に掛かる場合は潔く非表示！
        if (item.prio < 8) continue;
        // 高優先度ラベル（現象・対策工・水位）は安全領域内へスマートクランプ（元位置から離れすぎなら非表示）
        if (Math.abs(x - clamp(x, minX, maxX)) > 220 || Math.abs(y - clamp(y, minY, maxY)) > 160) continue;
        x = clamp(x, minX, maxX);
        y = clamp(y, minY, maxY);
        clamped = true;
      }

      // 配置済み他ピンとの重なり回避
      let collided = false;
      for (const b of placedBoxes) {
        if (Math.abs(x - b.x) < (estW + b.w) * 0.5 + 8 && Math.abs(y - b.y) < estH + 8) {
          if (item.prio >= 8) {
            const tryUp = b.y - estH - 8;
            const tryDown = b.y + estH + 8;
            if (tryUp >= minY) {
              y = tryUp;
              clamped = true;
            } else if (tryDown <= maxY) {
              y = tryDown;
              clamped = true;
            } else {
              collided = true;
              break;
            }
          } else {
            collided = true;
            break;
          }
        }
      }
      if (collided) continue;

      // ずらした後も再チェックして完全非衝突を保証
      let secondHit = false;
      for (const b of placedBoxes) {
        if (Math.abs(x - b.x) < (estW + b.w) * 0.5 + 4 && Math.abs(y - b.y) < estH + 4) {
          secondHit = true;
          break;
        }
      }
      if (secondHit) continue;

      placedBoxes.push({ x, y, w: estW });
      activeIds.add(item.id);

      let el = this.elMap.get(item.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'pin-label';
        el.innerHTML = '<span class="pin-icon-slot"></span><span class="pin-text"></span>';
        this.container.appendChild(el);
        this.elMap.set(item.id, el);
      }
      el.className = `pin-label ${item.cls}${clamped ? ' pin-clamped' : ''}`;
      const iconKey = item.icon;
      if (el.dataset.iconKey !== iconKey) {
        el.dataset.iconKey = iconKey;
        const slot = el.querySelector('.pin-icon-slot');
        slot.innerHTML = iconKey === 'shield' ? SVG_SHIELD : iconKey === 'warn' ? SVG_WARN : '<span class="pin-dot"></span>';
      }
      el.querySelector('.pin-text').textContent = item.text;
      el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) translate(-50%, -100%)`;
      el.style.opacity = '1';
      el.style.display = 'inline-flex';
    }

    for (const [id, el] of this.elMap.entries()) {
      if (!activeIds.has(id)) {
        el.style.display = 'none';
      }
    }
  }
}

// ============================================================================
// メインアプリケーション
// ============================================================================
class RiverLeveeApp {
  constructor() {
    this.dom = {
      canvas: document.getElementById('webgl-canvas'),
      labelsLayer: document.getElementById('labels-layer'),
      loadingOverlay: document.getElementById('loading-overlay'),
      loadingStatus: document.getElementById('loading-status'),
      loadingBarFill: document.getElementById('loading-bar-fill'),
      btnRetry: document.getElementById('btn-retry-load'),
      uiRoot: document.getElementById('ui-root'),
      leftPanel: document.getElementById('left-panel'),
      hudPanel: document.getElementById('hud-panel'),
      projectSubtitle: document.getElementById('project-subtitle'),
      btnToggleLeft: document.getElementById('btn-toggle-left'),
      btnToggleHud: document.getElementById('btn-toggle-hud'),
      btnQuickMitigate: document.getElementById('btn-quick-mitigate'),
      quickMitigateLabel: document.getElementById('quick-mitigate-label'),
      btnAutoDemo: document.getElementById('btn-auto-demo'),
      btnSavePng: document.getElementById('btn-save-png'),
      presetBtns: Array.from(document.querySelectorAll('.preset-btn')),
      modeCards: Array.from(document.querySelectorAll('.mode-card')),
      mitigationCard: document.getElementById('mitigation-card'),
      mitigationStateText: document.getElementById('mitigation-state-text'),
      mitigationMeasureName: document.getElementById('mitigation-measure-name'),
      mitigationEffectBadge: document.getElementById('mitigation-effect-badge'),
      toggleSeepageVis: document.getElementById('toggle-seepage-vis'),
      toggleLabels: document.getElementById('toggle-labels'),
      toggleWeather: document.getElementById('toggle-weather'),
      toggleHighlightMeasure: document.getElementById('toggle-highlight-measure'),
      mechanismTitle: document.getElementById('mechanism-title'),
      mechanismShareNote: document.getElementById('mechanism-share-note'),
      mechanismList: document.getElementById('mechanism-list'),
      statusBadge: document.getElementById('status-badge'),
      kpiWaterCard: document.getElementById('kpi-water-card'),
      kpiWaterVal: document.getElementById('kpi-water-val'),
      kpiWaterSub: document.getElementById('kpi-water-sub'),
      kpiFsCard: document.getElementById('kpi-fs-card'),
      kpiFsVal: document.getElementById('kpi-fs-val'),
      kpiFsSub: document.getElementById('kpi-fs-sub'),
      kpiGradCard: document.getElementById('kpi-grad-card'),
      kpiGradVal: document.getElementById('kpi-grad-val'),
      kpiGradSub: document.getElementById('kpi-grad-sub'),
      kpiDamageCard: document.getElementById('kpi-damage-card'),
      kpiDamageLabel: document.getElementById('kpi-damage-label'),
      kpiDamageVal: document.getElementById('kpi-damage-val'),
      kpiDamageUnit: document.getElementById('kpi-damage-unit'),
      kpiDamageSub: document.getElementById('kpi-damage-sub'),
      hudChart: document.getElementById('hud-chart'),
      pressureLegend: document.getElementById('pressure-legend'),
      stageIndicator: document.getElementById('stage-indicator'),
      stageModeBadge: document.getElementById('stage-mode-badge'),
      stageDesc: document.getElementById('stage-desc'),
      btnReset: document.getElementById('btn-reset'),
      btnPlay: document.getElementById('btn-play'),
      playIcon: document.getElementById('play-icon'),
      btnSpeed: document.getElementById('btn-speed'),
      timeSlider: document.getElementById('time-slider'),
      timeValue: document.getElementById('time-value'),
      toast: document.getElementById('toast'),
    };

    this.state = {
      ready: false,
      mode: 'overtop',
      mitigated: false,
      progress: 0.0,
      tHr: 0.0,
      playing: true,
      speed: 1.0,
      showSeepage: true,
      showLabels: true,
      stormyWeather: true,
      highlightMeasure: false,
      hudVisible: true,
      autoDemo: false,
      preset: 'overview_cutaway',
      currentFrame: null,
    };

    this.data = null;
    this.glbNodes = {
      measure_overtop: null,
      measure_seepage: null,
      measure_piping: null,
      measure_erosion: null,
      levee_core_front: null,
      levee_road_details: null,
      ground_clay_river_front: null,
      frontRoadDetails: [],
    };
    this.measureAnim = { active: false, timer: 0, node: null, baseY: 0 };
    this.cameraTween = null;
    this.autoDemoState = { stepIdx: 0, holdTimer: 0 };
    this._toastTimer = null;
    this._lastUiKey = '';

    // [C-01] モバイル初期ロード時は左パネル・右HUDを自動折りたたみして3Dビュー70%以上確保
    this._applyInitialResponsiveState();

    this._initThree();
    this.physics = new PhysicsVisualizer(this.scene);
    this.chart = new HudChartRenderer(this.dom.hudChart);
    this.labels = new PinLabelManager(this.dom.labelsLayer);

    this.setPlaying(this.state.playing);
    this._bindEvents();
    this._exposeApi();
    this._loadAssets();
    this._startLoop();
  }

  _applyInitialResponsiveState() {
    if (window.innerWidth <= 768) {
      this.dom.leftPanel.classList.add('collapsed');
      document.body.classList.add('left-collapsed');
      this.dom.hudPanel.classList.add('hud-collapsed');
    }
  }

  // --------------------------------------------------------------------------
  // Three.js シーン初期化
  // --------------------------------------------------------------------------
  _initThree() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.dom.canvas,
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2('#293b52', 0.0040);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.58;
    pmrem.dispose();

    this.skyMat = new THREE.MeshBasicMaterial({
      map: createSkyTexture(true),
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.skyDome = new THREE.Mesh(new THREE.SphereGeometry(340, 24, 16), this.skyMat);
    this.scene.add(this.skyDome);

    this.camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.2, 650);
    const initP = CAMERA_PRESETS.overview_cutaway;
    this.camera.position.set(...initP.pos);

    this.controls = new OrbitControls(this.camera, this.dom.canvas);
    this.controls.target.set(...initP.tgt);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 145;
    this.controls.maxPolarAngle = Math.PI * 0.51;
    this.controls.update();

    // [P-03] ユーザー手動カメラ操作時はカメラ補間＆プリセットアクティブ状態を解除
    this.controls.addEventListener('start', () => {
      this.cameraTween = null;
      this._clearActivePreset();
    });

    this.hemiLight = new THREE.HemisphereLight('#bed4e8', '#303b4a', 0.90);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight('#edf3fa', 1.72);
    this.sunLight.position.set(28, 44, 34);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.left = -52;
    this.sunLight.shadow.camera.right = 56;
    this.sunLight.shadow.camera.top = 34;
    this.sunLight.shadow.camera.bottom = -34;
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 140;
    this.sunLight.shadow.bias = -0.0005;
    this.scene.add(this.sunLight);

    this.rimLight = new THREE.DirectionalLight('#8ac0ec', 0.60);
    this.rimLight.position.set(-36, 18, 26);
    this.scene.add(this.rimLight);

    const floorGeo = new THREE.PlaneGeometry(360, 360);
    floorGeo.rotateX(-Math.PI / 2);
    const floorMat = new THREE.MeshStandardMaterial({
      color: '#0e1726',
      roughness: 0.92,
      metalness: 0.08,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.y = -13.65;
    floor.receiveShadow = true;
    this.scene.add(floor);

    this._applyWeatherLighting(true);
  }

  _applyWeatherLighting(stormy) {
    this.state.stormyWeather = stormy;
    if (this.skyMat.map) this.skyMat.map.dispose();
    this.skyMat.map = createSkyTexture(stormy);
    this.skyMat.needsUpdate = true;

    if (stormy) {
      this.scene.fog.color.set('#28394f');
      this.scene.fog.density = 0.0040;
      this.hemiLight.color.set('#bad0e5');
      this.hemiLight.groundColor.set('#2d3746');
      this.hemiLight.intensity = 0.90;
      this.sunLight.color.set('#e5eef8');
      this.sunLight.intensity = 1.68;
      this.scene.environmentIntensity = 0.56;
      this.renderer.toneMappingExposure = 1.07;
    } else {
      this.scene.fog.color.set('#a8cde8');
      this.scene.fog.density = 0.0020;
      this.hemiLight.color.set('#d8efff');
      this.hemiLight.groundColor.set('#535f4d');
      this.hemiLight.intensity = 1.08;
      this.sunLight.color.set('#fff5e0');
      this.sunLight.intensity = 2.38;
      this.scene.environmentIntensity = 0.74;
      this.renderer.toneMappingExposure = 1.12;
    }

    this.dom.toggleWeather.classList.toggle('active', stormy);
    this.dom.toggleWeather.setAttribute('aria-pressed', String(stormy));
    this.dom.toggleWeather.innerHTML = `<span class="chip-dot"></span>${stormy ? '曇天洪水ライティング' : '晴天デイライト'}`;
  }

  // --------------------------------------------------------------------------
  // GLB & JSON アセット読み込み
  // --------------------------------------------------------------------------
  async _loadAssets() {
    this.dom.btnRetry.classList.add('hidden');
    this.dom.loadingBarFill.style.width = '22%';
    this.dom.loadingStatus.textContent = '物理シミュレーション JSON と 3D ジオラマ GLB を読み込んでいます…';

    try {
      const loader = new GLTFLoader();
      const [jsonRes, gltf] = await Promise.all([
        fetch(DATA_URL, { cache: 'no-store' }).then((r) => {
          if (!r.ok) throw new Error(`viewer_data.json 読込エラー (HTTP ${r.status})`);
          return r.json();
        }),
        new Promise((resolve, reject) => {
          loader.load(
            GLB_URL,
            (g) => resolve(g),
            (ev) => {
              if (ev.total > 0) {
                const pct = 25 + Math.round((ev.loaded / ev.total) * 65);
                this.dom.loadingBarFill.style.width = `${pct}%`;
              }
            },
            (err) => reject(err)
          );
        }),
      ]);

      this.dom.loadingBarFill.style.width = '94%';
      this.data = jsonRes;
      this._setupGlbScene(gltf.scene);

      // [P-02] サブタイトルは簡潔な表現を保持（重複連結を防止）
      if (this.data.project?.subtitle) {
        const sub = this.data.project.subtitle.replace(/国土交通省「河川堤防の構造検討の手引き」/, '国交省「手引き」');
        this.dom.projectSubtitle.textContent = sub.includes('新瑞穂川') ? sub : `新瑞穂川（架空モデル）｜${sub}`;
      }

      this.state.ready = true;
      this.setMode('overtop', { resetProgress: true, silent: true });
      this.setMitigated(false, { silent: true });
      this.setProgress(0.0);

      this.dom.loadingBarFill.style.width = '100%';
      setTimeout(() => {
        this.dom.loadingOverlay.classList.add('is-hidden');
        this.chart.resize();
        this._updateFrameAndUi(0, true);
      }, 180);
    } catch (err) {
      console.error('[RiverLeveeApp] Asset load failed:', err);
      this.dom.loadingStatus.textContent = `読み込みに失敗しました: ${err?.message || err}（生成完了後に再読み込みしてください）`;
      this.dom.btnRetry.classList.remove('hidden');
    }
  }

  _setupGlbScene(modelRoot) {
    if (this.glbRoot) this.scene.remove(this.glbRoot);
    this.glbRoot = modelRoot;
    this.scene.add(modelRoot);

    const wantedNames = [
      'levee_core_front',
      'levee_static_back',
      'levee_road_details',
      'ground_clay_river_front',
      'measure_overtop',
      'measure_seepage',
      'measure_piping',
      'measure_erosion',
      'ground_impermeable',
      'ground_gravel',
      'ground_clay',
    ];

    modelRoot.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          if (m && m.emissive) {
            m.userData._origEmissive = m.emissive.clone();
            m.userData._origEmissiveIntensity = m.emissiveIntensity ?? 1.0;
          }
        }
      }
      const n = (obj.name || '').trim();
      for (const target of wantedNames) {
        if (n === target) {
          this.glbNodes[target] = obj;
        } else if (!this.glbNodes[target] && n.toLowerCase() === target) {
          this.glbNodes[target] = obj;
        }
      }
    });

    // levee_road_details の手前天端ガードレール・距離標のみを抽出（水位標尺・側溝は維持）
    this.glbNodes.frontRoadDetails = [];
    if (this.glbNodes.levee_road_details) {
      this.glbNodes.levee_road_details.updateMatrixWorld(true);
      const box = new THREE.Box3();
      const center = new THREE.Vector3();
      this.glbNodes.levee_road_details.traverse((ch) => {
        if (!ch.isMesh) return;
        const nm = (ch.name || '').toLowerCase();
        if (nm.includes('gauge') || nm.includes('ditch')) return;
        if (nm.includes('guardrail') || nm.includes('km_post') || nm.includes('km_sign')) {
          this.glbNodes.frontRoadDetails.push(ch);
          return;
        }
        box.setFromObject(ch);
        box.getCenter(center);
        if (center.z > 2.4 && center.x > -4.0 && center.x < 4.0) {
          this.glbNodes.frontRoadDetails.push(ch);
        }
      });
    }

    for (const key of ['measure_overtop', 'measure_seepage', 'measure_piping', 'measure_erosion']) {
      const node = this.glbNodes[key];
      if (node) {
        node.visible = false;
        node.userData._baseY = node.position.y;
      }
    }
  }

  // --------------------------------------------------------------------------
  // 対策工ノードの表示・切替アニメーション・ハイライト
  // --------------------------------------------------------------------------
  _syncMeasureNodes(triggerAnim = false) {
    const activeKey = MODE_META[this.state.mode]?.measureNode;
    for (const key of ['measure_overtop', 'measure_seepage', 'measure_piping', 'measure_erosion']) {
      const node = this.glbNodes[key];
      if (!node) continue;
      const shouldShow = this.state.mitigated && key === activeKey;
      node.visible = shouldShow;
      if (shouldShow) {
        node.position.y = node.userData._baseY ?? 0;
        if (triggerAnim) {
          this.measureAnim = {
            active: true,
            timer: 0,
            node,
            baseY: node.userData._baseY ?? 0,
          };
        }
      }
    }
    this._applyMeasureHighlight(0);
  }

  _applyMeasureHighlight(flashStrength = 0) {
    const activeKey = MODE_META[this.state.mode]?.measureNode;
    const node = this.glbNodes[activeKey];
    if (!node) return;
    const boost = Math.max(this.state.highlightMeasure ? 0.45 : 0.0, flashStrength);

    node.traverse((ch) => {
      if (!ch.isMesh) return;
      const mats = Array.isArray(ch.material) ? ch.material : [ch.material];
      for (const m of mats) {
        if (!m || !m.emissive) continue;
        if (boost > 0.01) {
          m.emissive.set('#10b981');
          m.emissiveIntensity = boost;
        } else if (m.userData._origEmissive) {
          m.emissive.copy(m.userData._origEmissive);
          m.emissiveIntensity = m.userData._origEmissiveIntensity ?? 1.0;
        } else {
          m.emissive.set('#000000');
          m.emissiveIntensity = 0;
        }
      }
    });
  }

  // --------------------------------------------------------------------------
  // 状態変更メソッド（UI と window.__leveeApi 共通）
  // --------------------------------------------------------------------------
  setMode(modeId, opts = {}) {
    if (!MODE_META[modeId]) return;
    this.state.mode = modeId;

    for (const btn of this.dom.modeCards) {
      btn.classList.toggle('active', btn.dataset.mode === modeId);
    }

    const modeObj = this.data?.modes?.[modeId];
    if (modeObj) {
      this.dom.mechanismTitle.textContent = `${modeObj.name || MODE_META[modeId].badge} のメカニズム`;
      this.dom.mechanismShareNote.textContent = modeObj.share_note || modeObj.short || '';
      const pts = Array.isArray(modeObj.mechanism_points) ? modeObj.mechanism_points : [];
      this.dom.mechanismList.innerHTML = pts.map((p) => `<li>${this._escapeHtml(p)}</li>`).join('');
      this.dom.mitigationMeasureName.textContent = modeObj.measure_name || '';
    }

    if (opts.resetProgress) {
      this.state.progress = 0.0;
    }

    this._syncMitigationUi();
    this._syncMeasureNodes(this.state.mitigated);
    this._updateFrameAndUi(0, true);

    if (!opts.silent) {
      this._showToast(`${MODE_META[modeId].badge} に切替`);
    }
  }

  setMitigated(flag, opts = {}) {
    const next = Boolean(flag);
    const changed = next !== this.state.mitigated;
    this.state.mitigated = next;

    this._syncMitigationUi();
    this._syncMeasureNodes(changed && next);
    this._updateFrameAndUi(0, true);

    if (!opts.silent && changed) {
      const mName = this.data?.modes?.[this.state.mode]?.measure_name || '対策工';
      this._showToast(next ? `対策工 ON：${mName}` : '対策工 OFF（無対策シミュレーション）');
    }
  }

  _syncMitigationUi() {
    const on = this.state.mitigated;
    const card = this.dom.mitigationCard;
    card.classList.toggle('is-on', on);
    card.classList.toggle('is-off', !on);
    card.setAttribute('aria-pressed', String(on));

    this.dom.mitigationStateText.textContent = on ? 'ON（対策工 設置中）' : 'OFF（無対策・危険）';
    const meta = MODE_META[this.state.mode];
    this.dom.mitigationEffectBadge.textContent = on ? meta.defaultEffectOn : meta.defaultEffectOff;

    // モバイルクイック対策工ボタン同期
    if (this.dom.btnQuickMitigate) {
      this.dom.btnQuickMitigate.classList.toggle('is-on', on);
      this.dom.btnQuickMitigate.classList.toggle('is-off', !on);
      this.dom.btnQuickMitigate.setAttribute('aria-pressed', String(on));
      this.dom.quickMitigateLabel.textContent = on ? '対策 ON' : '対策 OFF';
    }
  }

  setProgress(p) {
    this.state.progress = clamp(Number(p) || 0, 0, 1);
    this._updateFrameAndUi(0, true);
  }

  setTimeHr(hr) {
    const frames = this._getActiveFrames();
    const maxT = frames.length > 0 ? frames[frames.length - 1].t_hr || 24.0 : 24.0;
    this.setProgress(clamp((Number(hr) || 0) / maxT, 0, 1));
  }

  setPlaying(flag) {
    this.state.playing = Boolean(flag);
    this.dom.playIcon.textContent = this.state.playing ? '⏸' : '▶';
  }

  /** [P-03] プリセットのアクティブ状態を解除 */
  _clearActivePreset() {
    if (this.state.preset === null) return;
    this.state.preset = null;
    for (const btn of this.dom.presetBtns) {
      btn.classList.remove('active');
    }
  }

  setCamera(pos, tgt, instant = true, fromPreset = false) {
    if (!Array.isArray(pos) || !Array.isArray(tgt)) return;
    if (!fromPreset) {
      this._clearActivePreset();
    }
    if (instant) {
      this.cameraTween = null;
      this.camera.position.set(pos[0], pos[1], pos[2]);
      this.controls.target.set(tgt[0], tgt[1], tgt[2]);
      this.controls.update();
    } else {
      this.cameraTween = {
        t: 0,
        dur: 0.72,
        fromPos: this.camera.position.clone(),
        toPos: new THREE.Vector3(pos[0], pos[1], pos[2]),
        fromTgt: this.controls.target.clone(),
        toTgt: new THREE.Vector3(tgt[0], tgt[1], tgt[2]),
      };
    }
  }

  setPreset(name, instant = false) {
    const key = PRESET_ALIASES[name] || PRESET_ALIASES[String(name || '').toLowerCase()];
    if (!key || !CAMERA_PRESETS[key]) return;
    this.state.preset = key;
    const p = CAMERA_PRESETS[key];
    this.setCamera(p.pos, p.tgt, instant, true);
    for (const btn of this.dom.presetBtns) {
      btn.classList.toggle('active', btn.dataset.preset === key);
    }
  }

  setLabels(flag) {
    this.state.showLabels = Boolean(flag);
    this.dom.toggleLabels.classList.toggle('active', this.state.showLabels);
    this.dom.toggleLabels.setAttribute('aria-pressed', String(this.state.showLabels));
  }

  setHudVisible(flag) {
    this.state.hudVisible = Boolean(flag);
    this.dom.uiRoot.classList.toggle('ui-hidden', !this.state.hudVisible);
    if (this.state.hudVisible) {
      this.chart.resize();
      if (this.state.currentFrame) this.chart.draw(this.state, this.data);
    }
  }

  // --------------------------------------------------------------------------
  // フレーム取得・3D＆HUD更新
  // --------------------------------------------------------------------------
  _getActiveFrames() {
    const m = this.data?.modes?.[this.state.mode];
    if (!m) return [];
    const c = this.state.mitigated ? m.mitigated : m.unmitigated;
    return c?.frames || [];
  }

  _sampleCurrentFrame() {
    const frames = this._getActiveFrames();
    if (frames.length === 0) return null;
    if (frames.length === 1) return frames[0];
    const fIdx = this.state.progress * (frames.length - 1);
    const i0 = Math.floor(fIdx);
    const i1 = Math.min(frames.length - 1, i0 + 1);
    const frac = fIdx - i0;
    return interpolateFrames(frames[i0], frames[i1], frac);
  }

  _updateFrameAndUi(dt, forceUi = false) {
    if (!this.state.ready) return;
    const frame = this._sampleCurrentFrame();
    if (!frame) return;

    this.state.currentFrame = frame;
    this.state.tHr = frame.t_hr;

    this.physics.update(frame, this.state, this.glbNodes, dt, forceUi);

    const uiKey = `${this.state.mode}|${this.state.mitigated ? 1 : 0}|${this.state.showSeepage ? 1 : 0}|${frame.t_hr.toFixed(4)}|${frame.status}`;
    if (forceUi || uiKey !== this._lastUiKey) {
      this._lastUiKey = uiKey;
      this._updateHud(frame);
      this._updateTimelineUi(frame);
      this.chart.draw(this.state, this.data);
    }
  }

  _updateHud(f) {
    const status = f.status || 'safe';
    const badge = this.dom.statusBadge;
    badge.className = `status-badge status-${status}`;
    badge.textContent = f.status_label || this._defaultStatusLabel(status);

    // 1. 河川水位 KPI
    const wy = f.water_y ?? -1.2;
    this.dom.kpiWaterVal.textContent = (wy >= 0 ? '+' : '') + wy.toFixed(2);
    const margin = GEOM.CREST_Y - wy;
    this.dom.kpiWaterSub.textContent =
      margin < 0
        ? `天端を ${Math.abs(margin).toFixed(2)}m 越水！`
        : wy >= GEOM.HWL_Y
          ? `H.W.L. 超過 +${(wy - GEOM.HWL_Y).toFixed(2)}m`
          : `天端 +5.0m まで余裕 ${margin.toFixed(2)}m`;
    this._setCardTone(this.dom.kpiWaterCard, wy >= GEOM.CREST_Y ? 'crit' : wy >= GEOM.HWL_Y ? 'warn' : 'none');

    // 2. すべり安全率 Fs KPI
    const fs = f.fs_slope ?? 1.8;
    this.dom.kpiFsVal.textContent = fs.toFixed(2);
    if (fs < 1.0) {
      this.dom.kpiFsSub.textContent = 'すべり崩壊発生 (Fs < 1.00)';
      this._setCardTone(this.dom.kpiFsCard, 'crit');
    } else if (fs < 1.2) {
      this.dom.kpiFsSub.textContent = '照査基準 1.20 未満（危険）';
      this._setCardTone(this.dom.kpiFsCard, 'warn');
    } else {
      this.dom.kpiFsSub.textContent = this.state.mitigated && this.state.mode === 'seepage' ? '対策工により照査 OK' : '裏法面 安定 (照査 OK)';
      this._setCardTone(this.dom.kpiFsCard, this.state.mitigated && this.state.mode === 'seepage' ? 'good' : 'none');
    }

    // 3. 局所動水勾配 i KPI
    const grad = f.hydraulic_grad ?? 0.08;
    const uplift = f.uplift_ratio ?? 3.0;
    this.dom.kpiGradVal.textContent = grad.toFixed(2);
    this.dom.kpiGradSub.textContent = `揚圧力比 G/W: ${uplift.toFixed(2)}`;
    if (grad >= 0.5 || uplift < 1.0) {
      this._setCardTone(this.dom.kpiGradCard, 'crit');
    } else if (grad >= 0.38) {
      this._setCardTone(this.dom.kpiGradCard, 'warn');
    } else {
      this._setCardTone(this.dom.kpiGradCard, this.state.mitigated && this.state.mode === 'piping' ? 'good' : 'none');
    }

    // 4. モード別主要指標 KPI
    const scour = f.scour_depth ?? 0;
    const flood = f.inland_flood_y ?? 0;
    const oDepth = f.overtop_depth ?? 0;
    if (this.state.mode === 'overtop') {
      this.dom.kpiDamageLabel.innerHTML = '洗掘深 / 浸水深 <span class="kpi-ref">越水</span>';
      this.dom.kpiDamageVal.textContent = Math.max(scour, flood).toFixed(2);
      this.dom.kpiDamageUnit.textContent = 'm';
      this.dom.kpiDamageSub.textContent = `越水 ${oDepth.toFixed(2)}m ｜ 浸水 ${flood.toFixed(2)}m`;
      this._setCardTone(this.dom.kpiDamageCard, flood > 0.3 || scour > 1.8 ? 'crit' : oDepth > 0.02 || scour > 0.4 ? 'warn' : 'none');
    } else if (this.state.mode === 'piping') {
      this.dom.kpiDamageLabel.innerHTML = '空洞進行 / 浸水深 <span class="kpi-ref">基礎</span>';
      this.dom.kpiDamageVal.textContent = Math.round((f.piping_prog ?? 0) * 100);
      this.dom.kpiDamageUnit.textContent = '%';
      this.dom.kpiDamageSub.textContent = `堤内地浸水 ${flood.toFixed(2)}m`;
      this._setCardTone(this.dom.kpiDamageCard, (f.piping_prog ?? 0) > 0.5 ? 'crit' : (f.piping_prog ?? 0) > 0.08 ? 'warn' : this.state.mitigated ? 'good' : 'none');
    } else if (this.state.mode === 'erosion') {
      this.dom.kpiDamageLabel.innerHTML = '河床・表法洗掘深 <span class="kpi-ref">川表</span>';
      this.dom.kpiDamageVal.textContent = scour.toFixed(2);
      this.dom.kpiDamageUnit.textContent = 'm';
      this.dom.kpiDamageSub.textContent = `堤内地浸水 ${flood.toFixed(2)}m`;
      this._setCardTone(this.dom.kpiDamageCard, scour >= 1.5 ? 'crit' : scour >= 0.5 ? 'warn' : this.state.mitigated ? 'good' : 'none');
    } else {
      this.dom.kpiDamageLabel.innerHTML = 'すべり滑動 / 浸水 <span class="kpi-ref">裏法</span>';
      this.dom.kpiDamageVal.textContent = Math.round((f.slip_circle?.slide_prog ?? 0) * 100);
      this.dom.kpiDamageUnit.textContent = '%';
      this.dom.kpiDamageSub.textContent = `堤内地浸水 ${flood.toFixed(2)}m`;
      this._setCardTone(this.dom.kpiDamageCard, (f.slip_circle?.slide_prog ?? 0) > 0.3 ? 'crit' : (f.slip_circle?.slide_prog ?? 0) > 0.02 ? 'warn' : this.state.mitigated ? 'good' : 'none');
    }

    // [C-04] 間隙水圧カラーバー凡例の表示切替
    if (this.dom.pressureLegend) {
      this.dom.pressureLegend.classList.toggle('hidden', !this.physics.heatmapActive);
    }
  }

  _setCardTone(el, tone) {
    el.classList.remove('is-warn', 'is-crit', 'is-good');
    if (tone === 'warn') el.classList.add('is-warn');
    else if (tone === 'crit') el.classList.add('is-crit');
    else if (tone === 'good') el.classList.add('is-good');
  }

  _defaultStatusLabel(status) {
    if (status === 'breached') return '破堤・決壊';
    if (status === 'danger') return '危険（照査NG）';
    if (status === 'caution') return '警戒水位';
    return '安全・照査 OK';
  }

  _updateTimelineUi(f) {
    const pct = this.state.progress * 100;
    this.dom.timeSlider.value = String(Math.round(this.state.progress * 1000));
    this.dom.timeSlider.style.background = `linear-gradient(90deg, ${
      this.state.mitigated ? '#10b981' : '#38bdf8'
    } ${pct}%, rgba(148, 163, 184, 0.28) ${pct}%)`;
    this.dom.timeValue.textContent = f.t_hr.toFixed(1).padStart(4, '0');

    const status = f.status || 'safe';
    this.dom.stageIndicator.className = `stage-indicator status-${status}`;
    const meta = MODE_META[this.state.mode];
    this.dom.stageModeBadge.textContent = `${meta.badge}｜${this.state.mitigated ? '対策工 ON' : '無対策'}`;
    this.dom.stageModeBadge.classList.toggle('is-mitigated', this.state.mitigated);

    // [M-02] KPI 数値とタイムライン解説文の完全同期！
    const syncedDesc = syncStageDescNumbers(f.stage_desc || f.status_label || '', f, this.state.mode);
    this.dom.stageDesc.textContent = syncedDesc;
  }

  // --------------------------------------------------------------------------
  // 自動デモ進行
  // --------------------------------------------------------------------------
  _stepAutoDemo(dt) {
    if (!this.state.autoDemo) return;
    if (this.autoDemoState.holdTimer > 0) {
      this.autoDemoState.holdTimer -= dt;
      return;
    }

    this.state.progress += dt * 0.11;
    if (this.state.progress >= 1.0) {
      this.state.progress = 1.0;
      if (!this.state.mitigated) {
        this.setMitigated(true);
        this.autoDemoState.holdTimer = 2.6;
      } else {
        const curIdx = MODE_ORDER.indexOf(this.state.mode);
        const nextMode = MODE_ORDER[(curIdx + 1) % MODE_ORDER.length];
        this.setMitigated(false, { silent: true });
        this.setMode(nextMode, { resetProgress: true });
        this.setPreset(MODE_META[nextMode].recommendedPreset, false);
        this.autoDemoState.holdTimer = 0.6;
      }
    }
  }

  _stopAutoDemo() {
    if (!this.state.autoDemo) return;
    this.state.autoDemo = false;
    this.dom.btnAutoDemo.classList.remove('active');
  }

  // --------------------------------------------------------------------------
  // UI イベントバインド
  // --------------------------------------------------------------------------
  _bindEvents() {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.chart.resize();
      if (this.state.ready && this.state.currentFrame) {
        this.chart.draw(this.state, this.data);
      }
    });

    this.dom.btnRetry.addEventListener('click', () => this._loadAssets());

    // 左パネル開閉（モバイル時は右HUDと排他にして重なり防止）
    this.dom.btnToggleLeft.addEventListener('click', () => {
      const collapsed = this.dom.leftPanel.classList.toggle('collapsed');
      document.body.classList.toggle('left-collapsed', collapsed);
      if (!collapsed && window.innerWidth <= 768) {
        this.dom.hudPanel.classList.add('hud-collapsed');
      }
    });

    // 右HUD開閉（モバイル時は左パネルと排他＆開いた瞬間にチャート再計測）
    this.dom.btnToggleHud.addEventListener('click', () => {
      const collapsed = this.dom.hudPanel.classList.toggle('hud-collapsed');
      if (!collapsed) {
        if (window.innerWidth <= 768) {
          this.dom.leftPanel.classList.add('collapsed');
          document.body.classList.add('left-collapsed');
        }
        setTimeout(() => {
          this.chart.resize();
          if (this.state.ready && this.state.currentFrame) {
            this.chart.draw(this.state, this.data);
          }
        }, 40);
      }
    });

    // モバイル用トップバー クイック対策工切替
    if (this.dom.btnQuickMitigate) {
      this.dom.btnQuickMitigate.addEventListener('click', () => {
        this._stopAutoDemo();
        this.setMitigated(!this.state.mitigated);
      });
    }

    for (const btn of this.dom.presetBtns) {
      btn.addEventListener('click', () => {
        this._stopAutoDemo();
        this.setPreset(btn.dataset.preset, false);
      });
    }

    for (const card of this.dom.modeCards) {
      card.addEventListener('click', () => {
        this._stopAutoDemo();
        this.setMode(card.dataset.mode, { resetProgress: false });
      });
    }

    const toggleMit = () => {
      this._stopAutoDemo();
      this.setMitigated(!this.state.mitigated);
    };
    this.dom.mitigationCard.addEventListener('click', toggleMit);
    this.dom.mitigationCard.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleMit();
      }
    });

    this.dom.toggleSeepageVis.addEventListener('click', () => {
      this.state.showSeepage = !this.state.showSeepage;
      this.dom.toggleSeepageVis.classList.toggle('active', this.state.showSeepage);
      this.dom.toggleSeepageVis.setAttribute('aria-pressed', String(this.state.showSeepage));
      this._updateFrameAndUi(0, true);
    });

    this.dom.toggleLabels.addEventListener('click', () => {
      this.setLabels(!this.state.showLabels);
    });

    this.dom.toggleWeather.addEventListener('click', () => {
      this._applyWeatherLighting(!this.state.stormyWeather);
    });

    this.dom.toggleHighlightMeasure.addEventListener('click', () => {
      this.state.highlightMeasure = !this.state.highlightMeasure;
      this.dom.toggleHighlightMeasure.classList.toggle('active', this.state.highlightMeasure);
      this.dom.toggleHighlightMeasure.setAttribute('aria-pressed', String(this.state.highlightMeasure));
      if (this.state.highlightMeasure && !this.state.mitigated) {
        this.setMitigated(true);
      } else {
        this._applyMeasureHighlight(0);
      }
    });

    this.dom.btnPlay.addEventListener('click', () => {
      this._stopAutoDemo();
      if (!this.state.playing && this.state.progress >= 0.999) {
        this.state.progress = 0.0;
      }
      this.setPlaying(!this.state.playing);
    });

    this.dom.btnReset.addEventListener('click', () => {
      this._stopAutoDemo();
      this.setProgress(0.0);
    });

    const speeds = [0.5, 1.0, 2.0];
    this.dom.btnSpeed.addEventListener('click', () => {
      const idx = speeds.indexOf(this.state.speed);
      this.state.speed = speeds[(idx + 1) % speeds.length];
      this.dom.btnSpeed.textContent = `${this.state.speed.toFixed(1)}×`;
    });

    this.dom.timeSlider.addEventListener('input', (e) => {
      this._stopAutoDemo();
      this.setPlaying(false);
      this.setProgress(Number(e.target.value) / 1000);
    });

    this.dom.btnAutoDemo.addEventListener('click', () => {
      this.state.autoDemo = !this.state.autoDemo;
      this.dom.btnAutoDemo.classList.toggle('active', this.state.autoDemo);
      if (this.state.autoDemo) {
        this.setPlaying(true);
        this.setMitigated(false, { silent: true });
        this.setProgress(0.0);
        this.setPreset(MODE_META[this.state.mode].recommendedPreset, false);
        this._showToast('自動デモ再生を開始しました（4モード＋対策工比較）');
      } else {
        this._showToast('自動デモを停止しました');
      }
    });

    this.dom.btnSavePng.addEventListener('click', () => {
      this.renderer.render(this.scene, this.camera);
      const url = this.dom.canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `river_levee_${this.state.mode}_${this.state.mitigated ? 'mitigated' : 'unmitigated'}_${this.state.tHr.toFixed(1)}h.png`;
      a.click();
      this._showToast('3D ビューを PNG 画像として保存しました');
    });
  }

  // --------------------------------------------------------------------------
  // QA・録画用 window.__leveeApi
  // --------------------------------------------------------------------------
  _exposeApi() {
    window.__leveeApi = {
      isReady: () => Boolean(this.state.ready),
      setMode: (modeId) => {
        this._stopAutoDemo();
        this.setMode(modeId, { resetProgress: false, silent: true });
      },
      setMitigated: (bool) => {
        this._stopAutoDemo();
        this.setMitigated(Boolean(bool), { silent: true });
      },
      setProgress: (p) => {
        this._stopAutoDemo();
        this.setPlaying(false);
        this.setProgress(p);
      },
      setTimeHr: (hr) => {
        this._stopAutoDemo();
        this.setPlaying(false);
        this.setTimeHr(hr);
      },
      setCamera: (pos, tgt) => {
        this.setCamera(pos, tgt, true, false);
      },
      setPreset: (name) => {
        this.setPreset(name, true);
      },
      setLabels: (bool) => {
        this.setLabels(Boolean(bool));
      },
      setHudVisible: (bool) => {
        this.setHudVisible(Boolean(bool));
      },
      setPlaying: (bool) => {
        this.setPlaying(Boolean(bool));
      },
      getState: () => ({
        ready: this.state.ready,
        mode: this.state.mode,
        mitigated: this.state.mitigated,
        progress: this.state.progress,
        t_hr: this.state.tHr,
        playing: this.state.playing,
        preset: this.state.preset,
        showLabels: this.state.showLabels,
        hudVisible: this.state.hudVisible,
        status: this.state.currentFrame?.status || null,
        status_label: this.state.currentFrame?.status_label || null,
        metrics: this.state.currentFrame
          ? {
              water_y: this.state.currentFrame.water_y,
              inland_flood_y: this.state.currentFrame.inland_flood_y,
              fs_slope: this.state.currentFrame.fs_slope,
              hydraulic_grad: this.state.currentFrame.hydraulic_grad,
              uplift_ratio: this.state.currentFrame.uplift_ratio,
              piping_prog: this.state.currentFrame.piping_prog,
              overtop_depth: this.state.currentFrame.overtop_depth,
              scour_depth: this.state.currentFrame.scour_depth,
              breach_prog: this.state.currentFrame.breach_prog,
            }
          : null,
        camera: {
          pos: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
          tgt: [this.controls.target.x, this.controls.target.y, this.controls.target.z],
        },
      }),
    };
  }

  // --------------------------------------------------------------------------
  // メインレンダリングループ (60fps)
  // --------------------------------------------------------------------------
  _startLoop() {
    let lastTime = performance.now();
    const tick = (now) => {
      requestAnimationFrame(tick);
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;

      if (this.cameraTween) {
        const tw = this.cameraTween;
        tw.t += dt;
        const u = smoothstep(0, tw.dur, tw.t);
        this.camera.position.lerpVectors(tw.fromPos, tw.toPos, u);
        this.controls.target.lerpVectors(tw.fromTgt, tw.toTgt, u);
        if (tw.t >= tw.dur) this.cameraTween = null;
      }
      this.controls.update();

      if (this.measureAnim.active && this.measureAnim.node) {
        this.measureAnim.timer += dt;
        const u = clamp(this.measureAnim.timer / 0.72, 0, 1);
        const ease = 1 - Math.pow(1 - u, 3);
        const isPiping = this.state.mode === 'piping';
        const dropOffset = isPiping ? 2.4 : 0.85;
        this.measureAnim.node.position.y = this.measureAnim.baseY + (1 - ease) * dropOffset;
        this._applyMeasureHighlight((1 - u) * 0.9);
        if (u >= 1) {
          this.measureAnim.node.position.y = this.measureAnim.baseY;
          this.measureAnim.active = false;
          this._applyMeasureHighlight(0);
        }
      }

      if (this.state.ready) {
        if (this.state.autoDemo) {
          this._stepAutoDemo(dt);
        } else if (this.state.playing) {
          this.state.progress += (dt / 18.0) * this.state.speed;
          if (this.state.progress >= 1.0) {
            this.state.progress = 0.0;
          }
        }
        this._updateFrameAndUi(dt, false);
        this.labels.update(this.camera, window.innerWidth, window.innerHeight, this.state);
      }

      this.renderer.render(this.scene, this.camera);
    };
    requestAnimationFrame(tick);
  }

  _showToast(msg) {
    this.dom.toast.textContent = msg;
    this.dom.toast.classList.add('is-visible');
    if (this._toastTimer) clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      this.dom.toast.classList.remove('is-visible');
    }, 2400);
  }

  _escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

new RiverLeveeApp();
