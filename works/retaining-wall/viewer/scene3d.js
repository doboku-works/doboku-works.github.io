/**
 * RETAINING WALL LAB — Three.js パラメトリック 3D ジオラマ ＆ 力学・鉄筋・破壊ビジュアライザー
 *
 * 座標系 (SPEC.md 厳守):
 *   - 右手系 Y-up, 1 unit = 1.0 m, 縦断延長 L_z = 8.0 m (Z = -4.0 .. +4.0, 手前断面 Z = +4.0)
 *   - X = 0.0 : 底版つま先先端（前面端・転倒モーメント基準点 O）
 *   - +X 方向 : 背面（盛土側）、仮想背面位置 X = B
 *   - Y = 0.0 : 底版底面（均しコンクリート上面）
 *   - +Y 方向 : 上向き、擁壁天端 Y = H
 *
 * 外部 CDN 依存ゼロ: 'three', 'three/addons/controls/OrbitControls.js',
 * 'three/addons/environments/RoomEnvironment.js' のみ使用。
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// ============================================================================
// 定数 ＆ ユーティリティ
// ============================================================================

const L_Z = 8.0;
const HALF_Z = L_Z * 0.5;
const FRONT_Z = HALF_Z;
const BACK_Z = -HALF_Z;
const FRONT_EXT_X = 3.4;

const GAMMA_W = 9.81;

const THEME_CONFIG = {
  light: {
    bgColor: 0xe6edf6,
    fogColor: 0xe6edf6,
    fogNear: 68,
    fogFar: 175,
    exposure: 1.04,
    hemiSky: 0xf4f8ff,
    hemiGround: 0x9b8e7e,
    hemiInt: 0.78,
    keyInt: 1.48,
    fillInt: 0.48,
    rimInt: 0.42,
    floorColor: 0xdce5f0,
    gridMain: 0xb0bfcf,
    gridSub: 0xcbd6e4,
    plinthColor: 0x263140,
    wallEdgeColor: 0x334155,
    wallEdgeOpacity: 0.24,
  },
  dark: {
    bgColor: 0x0f172a,
    fogColor: 0x0f172a,
    fogNear: 68,
    fogFar: 175,
    exposure: 1.12,
    hemiSky: 0xbcd4f5,
    hemiGround: 0x3a322c,
    hemiInt: 0.52,
    keyInt: 1.65,
    fillInt: 0.58,
    rimInt: 0.68,
    floorColor: 0x111c30,
    gridMain: 0x334155,
    gridSub: 0x1e293b,
    plinthColor: 0x0b1120,
    wallEdgeColor: 0x94a3b8,
    wallEdgeOpacity: 0.34,
  },
};

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function degToRad(d) {
  return (d * Math.PI) / 180;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Group 内の全 BufferGeometry と動的 Material (_dynamic=true) を完全に解放してクリアする。
 * 共有マテリアル・プロシージャルテクスチャは維持し、スライダー操作時のリークをゼロに保つ。
 */
function clearGroupGeometries(group) {
  if (!group) return;
  const disposedMats = new Set();
  const disposeMat = (m) => {
    if (m && m.userData && m.userData._dynamic && !disposedMats.has(m)) {
      disposedMats.add(m);
      m.dispose();
    }
  };
  group.traverse((obj) => {
    if (obj === group) return;
    if (obj.geometry && typeof obj.geometry.dispose === 'function') {
      obj.geometry.dispose();
    }
    if (obj.material) {
      if (Array.isArray(obj.material)) {
        obj.material.forEach(disposeMat);
      } else {
        disposeMat(obj.material);
      }
    }
  });
  group.clear();
}

/**
 * ワールド座標系トライプラナー Box UV を割り当て、パラメトリック変形時に
 * 型枠目地・Pコン穴・地層・砕石テクスチャが歪まない実寸マッピングを保証する。
 */
function applyWorldBoxUVs(geometry, scaleU = 1.0, scaleV = 1.0, mode = 'triplanar') {
  const pos = geometry.attributes.position;
  if (!pos) return geometry;

  if (!geometry.attributes.normal) {
    geometry.computeVertexNormals();
  }
  const nrm = geometry.attributes.normal;
  const uvArr = new Float32Array(pos.count * 2);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nx = Math.abs(nrm.getX(i));
    const ny = Math.abs(nrm.getY(i));

    let u = 0;
    let v = 0;
    if (mode === 'road') {
      // 道路舗装: X を幅方向(車線・白線)、Z を縦断進行方向に割り当て
      u = x * scaleU;
      v = z * scaleV;
    } else if (ny >= 0.68) {
      u = x * scaleU;
      v = z * scaleV;
    } else if (nx >= 0.68) {
      u = z * scaleU;
      v = y * scaleV;
    } else {
      u = x * scaleU;
      v = y * scaleV;
    }
    uvArr[i * 2] = u;
    uvArr[i * 2 + 1] = v;
  }

  geometry.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
  return geometry;
}

/**
 * 2D Shape を Z = zStart .. zStart + depth に押し出し、ワールド UV を付与する。
 */
function extrudeXYShape(shape, depth, zStart, scaleU = 0.28, scaleV = 0.28, uvMode = 'triplanar') {
  const geom = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 8,
  });
  geom.translate(0, 0, zStart);
  geom.computeVertexNormals();
  applyWorldBoxUVs(geom, scaleU, scaleV, uvMode);
  return geom;
}

/**
 * 任意の始点 p1 -> 終点 p2 間に 8 角柱鋼棒ジオメトリの頂点・法線を追加（鉄筋バッチ生成用）
 */
function appendCylinderBar(positions, normals, x1, y1, z1, x2, y2, z2, radius, segs = 7) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dz = z2 - z1;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-4) return;

  const ax = dx / len;
  const ay = dy / len;
  const az = dz / len;

  // 軸に直交する基底ベクトル (u, v)
  let rx = 0;
  let ry = 1;
  let rz = 0;
  if (Math.abs(ay) > 0.92) {
    rx = 1;
    ry = 0;
    rz = 0;
  }
  // u = normalize(cross(r, a))
  let ux = ry * az - rz * ay;
  let uy = rz * ax - rx * az;
  let uz = rx * ay - ry * ax;
  const uLen = Math.hypot(ux, uy, uz) || 1;
  ux /= uLen;
  uy /= uLen;
  uz /= uLen;

  // v = cross(a, u)
  const vx = ay * uz - az * uy;
  const vy = az * ux - ax * uz;
  const vz = ax * uy - ay * ux;

  const step = (Math.PI * 2) / segs;
  for (let i = 0; i < segs; i++) {
    const a0 = i * step;
    const a1 = (i + 1) * step;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);

    const n0x = c0 * ux + s0 * vx;
    const n0y = c0 * uy + s0 * vy;
    const n0z = c0 * uz + s0 * vz;

    const n1x = c1 * ux + s1 * vx;
    const n1y = c1 * uy + s1 * vy;
    const n1z = c1 * uz + s1 * vz;

    const p00x = x1 + n0x * radius;
    const p00y = y1 + n0y * radius;
    const p00z = z1 + n0z * radius;

    const p01x = x1 + n1x * radius;
    const p01y = y1 + n1y * radius;
    const p01z = z1 + n1z * radius;

    const p10x = x2 + n0x * radius;
    const p10y = y2 + n0y * radius;
    const p10z = z2 + n0z * radius;

    const p11x = x2 + n1x * radius;
    const p11y = y2 + n1y * radius;
    const p11z = z2 + n1z * radius;

    // Triangle 1
    positions.push(p00x, p00y, p00z, p10x, p10y, p10z, p11x, p11y, p11z);
    normals.push(n0x, n0y, n0z, n0x, n0y, n0z, n1x, n1y, n1z);
    // Triangle 2
    positions.push(p00x, p00y, p00z, p11x, p11y, p11z, p01x, p01y, p01z);
    normals.push(n0x, n0y, n0z, n1x, n1y, n1z, n1x, n1y, n1z);
  }
}

/**
 * 頂点配列から軽量 3D 矢印（軸 + 円錐ヘッド）を作成するヘルパー
 */
function buildArrowMesh(from, to, shaftR, headR, headLen, material) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const totalLen = dir.length();
  if (totalLen < 0.04) return null;

  const actualHeadLen = Math.min(headLen, totalLen * 0.45);
  const shaftLen = Math.max(0.01, totalLen - actualHeadLen);

  const grp = new THREE.Group();
  const shaftGeom = new THREE.CylinderGeometry(shaftR, shaftR, shaftLen, 10);
  shaftGeom.translate(0, shaftLen * 0.5, 0);
  const shaft = new THREE.Mesh(shaftGeom, material);
  grp.add(shaft);

  const headGeom = new THREE.ConeGeometry(headR, actualHeadLen, 12);
  headGeom.translate(0, shaftLen + actualHeadLen * 0.5, 0);
  const head = new THREE.Mesh(headGeom, material);
  grp.add(head);

  grp.position.copy(from);
  const up = new THREE.Vector3(0, 1, 0);
  const dirNorm = dir.clone().normalize();
  if (dirNorm.y < -0.999) {
    grp.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
  } else {
    grp.quaternion.setFromUnitVectors(up, dirNorm);
  }
  return grp;
}

// ============================================================================
// プロシージャル PBR テクスチャ生成 (Canvas 512–1024px, 外部画像ゼロ)
// ============================================================================

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function finalizeTexture(canvas, { isColor = true, repeat = true, aniso = 8 } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.anisotropy = Math.min(8, Math.max(1, aniso));
  tex.needsUpdate = true;
  return tex;
}

/**
 * 1. 打ち放し RC コンクリート（1.8m×0.9m 型枠パネル目地＋Pコン穴＋色ムラ）
 */
function generateConcreteTextures(aniso) {
  const size = 1024;
  const diffCanvas = makeCanvas(size, size);
  const bumpCanvas = makeCanvas(size, size);
  const roughCanvas = makeCanvas(512, 512);

  const dCtx = diffCanvas.getContext('2d');
  const bCtx = bumpCanvas.getContext('2d');
  const rCtx = roughCanvas.getContext('2d');
  const rng = mulberry32(41021);

  // ベース塗潰し
  dCtx.fillStyle = '#c8cdd3';
  dCtx.fillRect(0, 0, size, size);
  bCtx.fillStyle = '#808080';
  bCtx.fillRect(0, 0, size, size);
  rCtx.fillStyle = '#c8c8c8';
  rCtx.fillRect(0, 0, 512, 512);

  // 型枠パネル 2列×4段 (1枚 = 512×256px = 実寸 1.8m×0.9m)
  const cols = 2;
  const rows = 4;
  const pw = size / cols;
  const ph = size / rows;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const shade = 197 + Math.floor((rng() - 0.5) * 12);
      dCtx.fillStyle = `rgb(${shade}, ${shade + 3}, ${shade + 7})`;
      dCtx.fillRect(c * pw, r * ph, pw, ph);

      // パネル内の上下わずかな養生グラデーション
      const grad = dCtx.createLinearGradient(0, r * ph, 0, (r + 1) * ph);
      grad.addColorStop(0, 'rgba(255,255,255,0.045)');
      grad.addColorStop(0.55, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(42,50,62,0.055)');
      dCtx.fillStyle = grad;
      dCtx.fillRect(c * pw, r * ph, pw, ph);
    }
  }

  // 自然なセメント色ムラ（大・中ブロッチ）
  for (let i = 0; i < 160; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const rad = 28 + rng() * 90;
    const light = rng() > 0.48;
    const g = dCtx.createRadialGradient(x, y, 2, x, y, rad);
    g.addColorStop(0, light ? 'rgba(244,247,252,0.09)' : 'rgba(72,82,96,0.085)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    dCtx.fillStyle = g;
    dCtx.fillRect(x - rad, y - rad, rad * 2, rad * 2);

    const rg = rCtx.createRadialGradient(x * 0.5, y * 0.5, 1, x * 0.5, y * 0.5, rad * 0.5);
    rg.addColorStop(0, light ? 'rgba(170,170,170,0.16)' : 'rgba(235,235,235,0.16)');
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    rCtx.fillStyle = rg;
    rCtx.fillRect((x - rad) * 0.5, (y - rad) * 0.5, rad, rad);
  }

  // 微細気泡・骨材粒子
  for (let i = 0; i < 6500; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const s = 0.8 + rng() * 1.9;
    const dark = rng() > 0.42;
    dCtx.fillStyle = dark ? 'rgba(62,70,82,0.13)' : 'rgba(250,252,255,0.12)';
    dCtx.fillRect(x, y, s, s);
    bCtx.fillStyle = dark ? 'rgba(92,92,92,0.35)' : 'rgba(155,155,155,0.3)';
    bCtx.fillRect(x, y, s, s);
  }

  // わずかな雨水縦すじ
  for (let i = 0; i < 24; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const h = 45 + rng() * 150;
    const g = dCtx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, 'rgba(75,85,99,0.08)');
    g.addColorStop(1, 'rgba(75,85,99,0)');
    dCtx.fillStyle = g;
    dCtx.fillRect(x, y, 2 + rng() * 4, h);
  }

  // 型枠目地ライン（横＆縦）
  for (let r = 0; r < rows; r++) {
    const y = r * ph;
    dCtx.fillStyle = 'rgba(55,63,75,0.52)';
    dCtx.fillRect(0, y, size, 3);
    dCtx.fillStyle = 'rgba(248,250,252,0.42)';
    dCtx.fillRect(0, y + 3, size, 2);

    bCtx.fillStyle = '#363636';
    bCtx.fillRect(0, y, size, 3);
    bCtx.fillStyle = '#a4a4a4';
    bCtx.fillRect(0, y + 3, size, 2);
  }
  for (let c = 0; c < cols; c++) {
    const x = c * pw;
    dCtx.fillStyle = 'rgba(55,63,75,0.46)';
    dCtx.fillRect(x, 0, 3, size);
    dCtx.fillStyle = 'rgba(248,250,252,0.35)';
    dCtx.fillRect(x + 3, 0, 2, size);

    bCtx.fillStyle = '#3c3c3c';
    bCtx.fillRect(x, 0, 3, size);
  }

  // セパレーター Pコン穴（各パネル 3列×2段 = 6穴）
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = c * pw;
      const y0 = r * ph;
      const xs = [0.165, 0.5, 0.835];
      const ys = [0.26, 0.74];
      for (const fx of xs) {
        for (const fy of ys) {
          const cx = x0 + fx * pw;
          const cy = y0 + fy * ph;

          // 外周面取り陰影
          const rimGrad = dCtx.createLinearGradient(cx - 10, cy - 10, cx + 10, cy + 10);
          rimGrad.addColorStop(0, 'rgba(42,48,58,0.68)');
          rimGrad.addColorStop(0.55, 'rgba(130,138,148,0.35)');
          rimGrad.addColorStop(1, 'rgba(246,249,255,0.62)');
          dCtx.beginPath();
          dCtx.arc(cx, cy, 10.5, 0, Math.PI * 2);
          dCtx.fillStyle = rimGrad;
          dCtx.fill();

          // 内側モルタル詰めプラグ
          dCtx.beginPath();
          dCtx.arc(cx, cy, 6.8, 0, Math.PI * 2);
          dCtx.fillStyle = '#a0a8b2';
          dCtx.fill();

          // 内側凹み影
          dCtx.beginPath();
          dCtx.arc(cx, cy, 6.8, Math.PI * 0.9, Math.PI * 1.9);
          dCtx.strokeStyle = 'rgba(30,36,46,0.52)';
          dCtx.lineWidth = 1.6;
          dCtx.stroke();

          // バンプマップ（深い円錐凹み）
          const bGrad = bCtx.createRadialGradient(cx, cy, 1, cx, cy, 11);
          bGrad.addColorStop(0, '#3a3a3a');
          bGrad.addColorStop(0.6, '#282828');
          bGrad.addColorStop(0.85, '#727272');
          bGrad.addColorStop(1, '#808080');
          bCtx.beginPath();
          bCtx.arc(cx, cy, 11, 0, Math.PI * 2);
          bCtx.fillStyle = bGrad;
          bCtx.fill();
        }
      }
    }
  }

  return {
    map: finalizeTexture(diffCanvas, { isColor: true, aniso }),
    bumpMap: finalizeTexture(bumpCanvas, { isColor: false, aniso }),
    roughnessMap: finalizeTexture(roughCanvas, { isColor: false, aniso }),
  };
}

/**
 * 2. 裏込め砕石（青灰角張った単粒度砕石 RC-40 / シームレスタイリング）
 */
function generateGravelTextures(aniso) {
  const size = 512;
  const dCanvas = makeCanvas(size, size);
  const bCanvas = makeCanvas(size, size);
  const dCtx = dCanvas.getContext('2d');
  const bCtx = bCanvas.getContext('2d');
  const rng = mulberry32(8831);

  dCtx.fillStyle = '#38414d';
  dCtx.fillRect(0, 0, size, size);
  bCtx.fillStyle = '#242424';
  bCtx.fillRect(0, 0, size, size);

  const palette = [
    '#66707d',
    '#798492',
    '#57616e',
    '#8c96a4',
    '#6d7682',
    '#4d5663',
    '#9aa3ae',
    '#737e8a',
  ];

  // 約 850 個の多角形砕石をトーラス折返し描画で完全シームレス化
  for (let i = 0; i < 860; i++) {
    const cx = rng() * size;
    const cy = rng() * size;
    const rad = 5.5 + rng() * 11.5;
    const verts = 5 + Math.floor(rng() * 3);
    const pts = [];
    const baseAngle = rng() * Math.PI * 2;
    for (let k = 0; k < verts; k++) {
      const a = baseAngle + (k / verts) * Math.PI * 2 + (rng() - 0.5) * 0.42;
      const r = rad * (0.68 + rng() * 0.45);
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    const fillCol = palette[Math.floor(rng() * palette.length)];
    const bumpVal = 115 + Math.floor(rng() * 120);

    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const px = cx + ox * size;
        const py = cy + oy * size;
        if (px < -24 || px > size + 24 || py < -24 || py > size + 24) continue;

        dCtx.beginPath();
        dCtx.moveTo(px + pts[0][0], py + pts[0][1]);
        for (let k = 1; k < verts; k++) {
          dCtx.lineTo(px + pts[k][0], py + pts[k][1]);
        }
        dCtx.closePath();
        dCtx.fillStyle = fillCol;
        dCtx.fill();
        dCtx.strokeStyle = 'rgba(26,32,40,0.68)';
        dCtx.lineWidth = 1.2;
        dCtx.stroke();

        // 上側ハイライトファセット
        dCtx.beginPath();
        dCtx.moveTo(px + pts[0][0] * 0.7, py + pts[0][1] * 0.7 - 1.2);
        dCtx.lineTo(px + pts[1][0] * 0.7, py + pts[1][1] * 0.7 - 1.2);
        dCtx.lineTo(px, py);
        dCtx.closePath();
        dCtx.fillStyle = 'rgba(235,242,250,0.22)';
        dCtx.fill();

        // バンプ
        bCtx.beginPath();
        bCtx.moveTo(px + pts[0][0], py + pts[0][1]);
        for (let k = 1; k < verts; k++) {
          bCtx.lineTo(px + pts[k][0], py + pts[k][1]);
        }
        bCtx.closePath();
        bCtx.fillStyle = `rgb(${bumpVal},${bumpVal},${bumpVal})`;
        bCtx.fill();
        bCtx.strokeStyle = '#181818';
        bCtx.lineWidth = 1.5;
        bCtx.stroke();
      }
    }
  }

  return {
    map: finalizeTexture(dCanvas, { isColor: true, aniso }),
    bumpMap: finalizeTexture(bCanvas, { isColor: false, aniso }),
  };
}

/**
 * 3. 地層断面カットアウェイ（背面盛土 backfill / 基礎地盤 subsoil）
 */
function generateSoilTextures(variant, aniso) {
  const size = 1024;
  const dCanvas = makeCanvas(size, size);
  const bCanvas = makeCanvas(512, 512);
  const dCtx = dCanvas.getContext('2d');
  const bCtx = bCanvas.getContext('2d');
  const isSubsoil = variant === 'subsoil';
  const rng = mulberry32(isSubsoil ? 99213 : 55107);

  // 水平層理グラデーション
  const grad = dCtx.createLinearGradient(0, 0, 0, size);
  if (isSubsoil) {
    grad.addColorStop(0.0, '#7e6953');
    grad.addColorStop(0.28, '#6e5b49');
    grad.addColorStop(0.62, '#5a4a3c');
    grad.addColorStop(1.0, '#44372d');
  } else {
    grad.addColorStop(0.0, '#b59268');
    grad.addColorStop(0.32, '#a6835a');
    grad.addColorStop(0.68, '#98754e');
    grad.addColorStop(1.0, '#8d6c47');
  }
  dCtx.fillStyle = grad;
  dCtx.fillRect(0, 0, size, size);

  bCtx.fillStyle = '#808080';
  bCtx.fillRect(0, 0, 512, 512);

  // うねる地層・転圧バンド
  const bands = isSubsoil ? 16 : 22;
  for (let b = 0; b < bands; b++) {
    const yBase = (b / bands) * size;
    const bandH = (size / bands) * (0.45 + rng() * 0.75);
    const amp = 4 + rng() * (isSubsoil ? 12 : 6);
    const freq = (1 + Math.floor(rng() * 3)) * Math.PI * 2;
    const phase = rng() * Math.PI * 2;

    dCtx.beginPath();
    dCtx.moveTo(0, yBase);
    for (let x = 0; x <= size; x += 32) {
      const y = yBase + Math.sin((x / size) * freq + phase) * amp;
      dCtx.lineTo(x, y);
    }
    for (let x = size; x >= 0; x -= 32) {
      const y = yBase + bandH + Math.sin((x / size) * freq + phase + 0.5) * amp;
      dCtx.lineTo(x, y);
    }
    dCtx.closePath();

    const light = rng() > 0.5;
    dCtx.fillStyle = isSubsoil
      ? light
        ? 'rgba(162,138,112,0.16)'
        : 'rgba(42,32,24,0.20)'
      : light
      ? 'rgba(222,192,148,0.18)'
      : 'rgba(98,70,42,0.15)';
    dCtx.fill();
  }

  // 砂粒・シルト粒の細粒度ノイズ
  for (let i = 0; i < 12000; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 0.8 + rng() * 2.1;
    const tone = rng();
    if (tone < 0.35) {
      dCtx.fillStyle = 'rgba(45,34,24,0.22)';
    } else if (tone < 0.7) {
      dCtx.fillStyle = 'rgba(235,214,180,0.18)';
    } else {
      dCtx.fillStyle = 'rgba(130,104,76,0.22)';
    }
    dCtx.fillRect(x, y, r, r);

    bCtx.fillStyle = tone < 0.5 ? 'rgba(90,90,90,0.35)' : 'rgba(165,165,165,0.35)';
    bCtx.fillRect(x * 0.5, y * 0.5, r * 0.7, r * 0.7);
  }

  // 礫・小石の混入（基礎地盤はやや大きめの玉石・砂礫）
  const pebbleCount = isSubsoil ? 320 : 180;
  for (let i = 0; i < pebbleCount; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const rx = (isSubsoil ? 3.5 : 2.0) + rng() * (isSubsoil ? 8.5 : 4.2);
    const ry = rx * (0.55 + rng() * 0.45);
    const rot = rng() * Math.PI;
    const pSh = 86 + Math.floor(rng() * 72);

    dCtx.save();
    dCtx.translate(x, y);
    dCtx.rotate(rot);
    dCtx.beginPath();
    dCtx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    dCtx.fillStyle = `rgb(${pSh + 8}, ${pSh + 3}, ${pSh - 4})`;
    dCtx.fill();
    dCtx.strokeStyle = 'rgba(32,24,18,0.42)';
    dCtx.lineWidth = 1;
    dCtx.stroke();
    dCtx.restore();

    bCtx.beginPath();
    bCtx.arc(x * 0.5, y * 0.5, rx * 0.5, 0, Math.PI * 2);
    bCtx.fillStyle = '#b4b4b4';
    bCtx.fill();
  }

  return {
    map: finalizeTexture(dCanvas, { isColor: true, aniso }),
    bumpMap: finalizeTexture(bCanvas, { isColor: false, aniso }),
  };
}

/**
 * 4. 背面道路アスファルト舗装＋外側線・破線白線
 */
function generateRoadTextures(aniso) {
  const size = 512;
  const dCanvas = makeCanvas(size, size);
  const rCanvas = makeCanvas(size, size);
  const dCtx = dCanvas.getContext('2d');
  const rCtx = rCanvas.getContext('2d');
  const rng = mulberry32(30917);

  dCtx.fillStyle = '#3b414a';
  dCtx.fillRect(0, 0, size, size);
  rCtx.fillStyle = '#cfcfcf';
  rCtx.fillRect(0, 0, size, size);

  // 縦方向タイヤ走行帯の微妙な艶・濃淡
  const trackPositions = [0.28, 0.56, 0.82];
  for (const tp of trackPositions) {
    const gx = tp * size;
    const g = dCtx.createLinearGradient(gx - 38, 0, gx + 38, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, 'rgba(20,24,30,0.18)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    dCtx.fillStyle = g;
    dCtx.fillRect(gx - 38, 0, 76, size);

    const rg = rCtx.createLinearGradient(gx - 32, 0, gx + 32, 0);
    rg.addColorStop(0, 'rgba(0,0,0,0)');
    rg.addColorStop(0.5, 'rgba(155,155,155,0.45)');
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    rCtx.fillStyle = rg;
    rCtx.fillRect(gx - 32, 0, 64, size);
  }

  // アスファルト骨材微粒子
  for (let i = 0; i < 11000; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const s = 0.8 + rng() * 1.6;
    const v = rng();
    dCtx.fillStyle =
      v < 0.45
        ? 'rgba(24,28,34,0.38)'
        : v < 0.85
        ? 'rgba(98,106,118,0.32)'
        : 'rgba(150,158,170,0.22)';
    dCtx.fillRect(x, y, s, s);
  }

  // 路肩外側線（左端寄りに連続白線 — u=0.075 付近）
  dCtx.fillStyle = 'rgba(242,245,248,0.88)';
  dCtx.fillRect(Math.floor(size * 0.065), 0, 12, size);

  // 車線中央破線（u=0.68 付近）
  dCtx.fillStyle = 'rgba(242,245,248,0.84)';
  for (let y = 24; y < size; y += 128) {
    dCtx.fillRect(Math.floor(size * 0.68), y, 10, 66);
  }

  // 白線の自然な微細かすれ
  for (let i = 0; i < 450; i++) {
    const x = rng() > 0.5 ? size * 0.065 + rng() * 12 : size * 0.68 + rng() * 10;
    const y = rng() * size;
    dCtx.fillStyle = 'rgba(58,64,73,0.35)';
    dCtx.fillRect(x, y, 2, 2);
  }

  return {
    map: finalizeTexture(dCanvas, { isColor: true, aniso }),
    roughnessMap: finalizeTexture(rCanvas, { isColor: false, aniso }),
  };
}

/**
 * 5. 建築模型調・上品な芝生テクスチャ
 */
function generateGrassTextures(aniso) {
  const size = 512;
  const dCanvas = makeCanvas(size, size);
  const bCanvas = makeCanvas(size, size);
  const dCtx = dCanvas.getContext('2d');
  const bCtx = bCanvas.getContext('2d');
  const rng = mulberry32(61903);

  dCtx.fillStyle = '#628454';
  dCtx.fillRect(0, 0, size, size);
  bCtx.fillStyle = '#787878';
  bCtx.fillRect(0, 0, size, size);

  // 自然な芝の濃淡パッチ
  for (let i = 0; i < 95; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const rad = 24 + rng() * 68;
    const warm = rng() > 0.5;
    const g = dCtx.createRadialGradient(x, y, 2, x, y, rad);
    g.addColorStop(0, warm ? 'rgba(130,158,92,0.18)' : 'rgba(62,92,52,0.2)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    dCtx.fillStyle = g;
    dCtx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }

  // 芝葉の細密な繊維
  for (let i = 0; i < 9000; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const len = 3 + rng() * 6;
    const ang = (rng() - 0.5) * 1.4 - Math.PI * 0.5;
    const shade = rng();
    dCtx.strokeStyle =
      shade < 0.35
        ? 'rgba(72,104,58,0.45)'
        : shade < 0.72
        ? 'rgba(114,146,86,0.42)'
        : 'rgba(148,172,108,0.34)';
    dCtx.lineWidth = 1.1;
    dCtx.beginPath();
    dCtx.moveTo(x, y);
    dCtx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    dCtx.stroke();

    bCtx.fillStyle = shade < 0.5 ? 'rgba(105,105,105,0.4)' : 'rgba(160,160,160,0.4)';
    bCtx.fillRect(x, y, 2, 2);
  }

  return {
    map: finalizeTexture(dCanvas, { isColor: true, aniso }),
    bumpMap: finalizeTexture(bCanvas, { isColor: false, aniso }),
  };
}

/**
 * 6. 均しコンクリート（粗めモルタル）
 */
function generateLeanConcreteTexture(aniso) {
  const size = 256;
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const rng = mulberry32(1291);
  ctx.fillStyle = '#aeb4bc';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 3600; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const d = rng() > 0.5;
    ctx.fillStyle = d ? 'rgba(74,82,92,0.2)' : 'rgba(240,244,248,0.2)';
    ctx.fillRect(x, y, 1.8, 1.8);
  }
  return finalizeTexture(c, { isColor: true, aniso });
}

/**
 * 7. 浮き上がり・破壊警戒ハッチングテクスチャ
 */
function generateCautionTexture(aniso) {
  const size = 256;
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(220,38,38,0.18)';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(239,68,68,0.88)';
  ctx.lineWidth = 18;
  for (let i = -size; i < size * 2; i += 44) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + size, size);
    ctx.stroke();
  }
  return finalizeTexture(c, { isColor: true, aniso });
}

/**
 * 8. スタジオ背景グラデーションテクスチャ（明/暗テーマ用）
 */
function generateStudioBackdrop(topHex, midHex, botHex) {
  const c = makeCanvas(64, 512);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0.0, topHex);
  g.addColorStop(0.58, midHex);
  g.addColorStop(1.0, botHex);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 512);
  return finalizeTexture(c, { isColor: true, repeat: false, aniso: 1 });
}

/**
 * 9. 滑動引張亀裂 V 字開口ウェッジ用 暗褐色土中影グラデーションテクスチャ (M-8)
 */
function generateCrackGradientTexture(aniso) {
  const c = makeCanvas(128, 256);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0.0, '#2c1e16');
  g.addColorStop(0.45, '#473225');
  g.addColorStop(0.85, '#5d4231');
  g.addColorStop(1.0, '#3a271c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 256);

  // 細かな土粒の暗影質感
  const rng = mulberry32(71042);
  for (let i = 0; i < 650; i++) {
    const x = rng() * 128;
    const y = rng() * 256;
    ctx.fillStyle = rng() > 0.5 ? 'rgba(20,12,8,0.28)' : 'rgba(130,96,68,0.18)';
    ctx.fillRect(x, y, 2, 2);
  }
  return finalizeTexture(c, { isColor: true, repeat: false, aniso });
}

// ============================================================================
// メインクラス: RetainingWallScene3D
// ============================================================================

export class RetainingWallScene3D {
  constructor(canvas) {
    if (!canvas) {
      throw new Error('RetainingWallScene3D: canvas element is required');
    }
    this.canvas = canvas;

    this.options = {
      showForces: true,
      showRebar: false,
      showFailureAnim: true,
      showLabels: true,
      theme: 'light',
    };

    this._params = null;
    this._result = null;
    this._geom = null;
    this._disposed = false;
    this._rebarDirty = true;

    // マイクロアニメ・破壊アニメ用時間トラッカ＆前回破壊状態 (M-12)
    this._clock = new THREE.Clock();
    this._elapsed = 0;
    this._animPhase = 0;
    this._prevFailureActive = false;
    this._prevFailureMode = 'none';

    // カメラプリセット・レスポンシブ自動フィット追跡 (M-6)
    this._activePreset = 'iso_cutaway';
    this._lastPresetAspect = 1.6;
    this._userCustomCamera = false;

    // 動的アニメ参照ハンドル
    this._dripDrops = [];
    this._waterShimmerMeshes = [];
    this._clogPulseMeshes = [];
    this._seismicPulseMeshes = [];
    this._drainMesh = null;
    this._bearingPrismMesh = null;
    this._bearingOkState = true;
    this._failureHandles = {
      mode: 'none',
      slideArrows: null,
      upliftWedge: null,
      overturnBackShadow: null,
      heaveMound: null,
      pivotRing: null,
      overturnArc: null,
      slipBand: null,
      crackGap: null,
      frontPushBand: null,
      bearingArc: null,
    };

    // 1. WebGLRenderer (PNG 保存対応のため preserveDrawingBuffer: true)
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = THEME_CONFIG.light.exposure;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // 2. Scene & Environment (RoomEnvironment IBL)
    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const roomEnv = new RoomEnvironment();
    this._envRT = pmrem.fromScene(roomEnv, 0.04);
    this.scene.environment = this._envRT.texture;
    roomEnv.dispose();
    pmrem.dispose();

    // 3. Camera & OrbitControls (モバイル縦画面広角後退にも対応する距離上限)
    const initW = Math.max(1, canvas.clientWidth || window.innerWidth || 1280);
    const initH = Math.max(1, canvas.clientHeight || window.innerHeight || 720);
    this.camera = new THREE.PerspectiveCamera(37, initW / initH, 0.15, 260);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 4.0;
    this.controls.maxDistance = 85.0;
    this.controls.maxPolarAngle = Math.PI * 0.56;
    this.controls.minPolarAngle = 0.08;
    this.controls.panSpeed = 0.85;
    this.controls.rotateSpeed = 0.78;
    this.controls.addEventListener('start', () => {
      this._userCustomCamera = true;
    });

    // 4. プロシージャルテクスチャ & 共有マテリアル生成（生涯1回のみ）
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this._initTexturesAndMaterials(maxAniso);

    // 5. ライティング ＆ スタジオ床構築
    this._initLightsAndStudio();

    // 6. シーン階層グループ
    this.rootGroup = new THREE.Group();
    this.scene.add(this.rootGroup);

    // 擁壁本体グループ（原点 = つま先先端 O (0,0,0) のため転倒回転軸と完全一致！）
    this.wallGroup = new THREE.Group();
    this.wallMeshGroup = new THREE.Group();
    this.weepGroup = new THREE.Group();
    this.rebarGroup = new THREE.Group();
    this.wallGroup.add(this.wallMeshGroup, this.weepGroup, this.rebarGroup);

    // 均しコンクリートは支持力沈下時に底版へ自然追従できるよう独立グループ化 (M-10)
    this.leanConcGroup = new THREE.Group();
    this.groundGroup = new THREE.Group();
    this.waterGroup = new THREE.Group();
    this.surchargeGroup = new THREE.Group();
    this.forcesGroup = new THREE.Group();
    this.failureFxGroup = new THREE.Group();

    this.rootGroup.add(
      this.groundGroup,
      this.leanConcGroup,
      this.wallGroup,
      this.waterGroup,
      this.surchargeGroup,
      this.forcesGroup,
      this.failureFxGroup
    );

    // 乗用車シルエット（再利用ジオメトリ、位置切替のみで超高速）
    this._carGroup = this._createCarSilhouette();
    this._carGroup.visible = false;
    this.surchargeGroup.add(this._carGroup);

    // 初期テーマ・サイズ・デフォルト視点
    this._applyTheme('light');
    this.resize();
    this._geom = this._extractGeom(null, null);
    this.setPresetCamera('iso_cutaway');
  }

  // ==========================================================================
  // 初期化ヘルパー
  // ==========================================================================

  _initTexturesAndMaterials(aniso) {
    const conc = generateConcreteTextures(aniso);
    const gravel = generateGravelTextures(aniso);
    const backfill = generateSoilTextures('backfill', aniso);
    const subsoil = generateSoilTextures('subsoil', aniso);
    const road = generateRoadTextures(aniso);
    const grass = generateGrassTextures(aniso);
    const leanConc = generateLeanConcreteTexture(aniso);
    const caution = generateCautionTexture(aniso);
    const crackGrad = generateCrackGradientTexture(aniso);

    const skyLight = generateStudioBackdrop('#d5e2f2', '#e8eff7', '#cfdbe8');
    const skyDark = generateStudioBackdrop('#0a101f', '#131f36', '#0c1426');

    this._textures = {
      concMap: conc.map,
      concBump: conc.bumpMap,
      concRough: conc.roughnessMap,
      gravelMap: gravel.map,
      gravelBump: gravel.bumpMap,
      backfillMap: backfill.map,
      backfillBump: backfill.bumpMap,
      subsoilMap: subsoil.map,
      subsoilBump: subsoil.bumpMap,
      roadMap: road.map,
      roadRough: road.roughnessMap,
      grassMap: grass.map,
      grassBump: grass.bumpMap,
      leanConcMap: leanConc,
      cautionMap: caution,
      crackGrad,
      skyLight,
      skyDark,
    };

    this._materials = {
      // RC擁壁（通常：打ち放しコンクリート）
      concreteOpaque: new THREE.MeshStandardMaterial({
        map: conc.map,
        bumpMap: conc.bumpMap,
        bumpScale: 0.022,
        roughnessMap: conc.roughnessMap,
        roughness: 0.84,
        metalness: 0.04,
      }),
      // RC擁壁（主鉄筋カットアウェイ透視：クリア建築ガラス）
      concreteGlass: new THREE.MeshPhysicalMaterial({
        color: 0xdbeafe,
        transparent: true,
        opacity: 0.2,
        roughness: 0.14,
        metalness: 0.05,
        transmission: 0.0,
        depthWrite: false,
        side: THREE.FrontSide,
      }),
      // 擁壁輪郭エッジ
      wallEdge: new THREE.LineBasicMaterial({
        color: 0x334155,
        transparent: true,
        opacity: 0.24,
      }),
      wallEdgeGlass: new THREE.LineBasicMaterial({
        color: 0x3b82f6,
        transparent: true,
        opacity: 0.52,
      }),
      // 鉄筋：背面引張主鉄筋・かかと上端・つま先下端（赤〜橙で強調）
      rebarMain: new THREE.MeshStandardMaterial({
        color: 0xef4444,
        emissive: 0xb91c1c,
        emissiveIntensity: 0.38,
        roughness: 0.28,
        metalness: 0.6,
      }),
      // 鉄筋：前面配力筋・縦筋（鋼銀色）
      rebarDist: new THREE.MeshStandardMaterial({
        color: 0x94a3b8,
        emissive: 0x1e293b,
        emissiveIntensity: 0.14,
        roughness: 0.28,
        metalness: 0.78,
      }),
      // 均しコンクリート & 縁石
      leanConcrete: new THREE.MeshStandardMaterial({
        map: leanConc,
        roughness: 0.92,
        metalness: 0.02,
      }),
      curbConcrete: new THREE.MeshStandardMaterial({
        color: 0xd5dbe3,
        roughness: 0.82,
        metalness: 0.04,
      }),
      // 基礎砕石・裏込め砕石（＋鉄筋透視時淡色ゴースト P-2）
      gravel: new THREE.MeshStandardMaterial({
        map: gravel.map,
        bumpMap: gravel.bumpMap,
        bumpScale: 0.045,
        roughness: 0.94,
        metalness: 0.04,
      }),
      gravelGhost: new THREE.MeshStandardMaterial({
        map: gravel.map,
        color: 0xdce7f5,
        transparent: true,
        opacity: 0.26,
        roughness: 0.92,
        metalness: 0.0,
        depthWrite: false,
      }),
      gravelBase: new THREE.MeshStandardMaterial({
        map: gravel.map,
        bumpMap: gravel.bumpMap,
        bumpScale: 0.04,
        color: 0x8f99a6,
        roughness: 0.95,
        metalness: 0.04,
      }),
      // 背面盛土・基礎地盤
      backfill: new THREE.MeshStandardMaterial({
        map: backfill.map,
        bumpMap: backfill.bumpMap,
        bumpScale: 0.032,
        roughness: 0.94,
        metalness: 0.0,
      }),
      subsoil: new THREE.MeshStandardMaterial({
        map: subsoil.map,
        bumpMap: subsoil.bumpMap,
        bumpScale: 0.038,
        roughness: 0.95,
        metalness: 0.0,
      }),
      // 道路舗装・芝生・模型台座
      road: new THREE.MeshStandardMaterial({
        map: road.map,
        roughnessMap: road.roughnessMap,
        roughness: 0.88,
        metalness: 0.04,
      }),
      grass: new THREE.MeshStandardMaterial({
        map: grass.map,
        bumpMap: grass.bumpMap,
        bumpScale: 0.025,
        roughness: 0.92,
        metalness: 0.0,
      }),
      plinth: new THREE.MeshStandardMaterial({
        color: 0x263140,
        roughness: 0.65,
        metalness: 0.12,
      }),
      // 水抜き孔 PVC パイプ・排水滴・詰まり赤キャップ
      pvcPipe: new THREE.MeshStandardMaterial({
        color: 0x64748b,
        roughness: 0.42,
        metalness: 0.15,
      }),
      pipeBore: new THREE.MeshBasicMaterial({ color: 0x0f172a }),
      dampStreak: new THREE.MeshBasicMaterial({
        color: 0x334155,
        transparent: true,
        opacity: 0.26,
        depthWrite: false,
      }),
      dripWater: new THREE.MeshPhysicalMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.78,
        roughness: 0.08,
        metalness: 0.05,
      }),
      clogCap: new THREE.MeshStandardMaterial({
        color: 0xdc2626,
        emissive: 0x991b1b,
        emissiveIntensity: 0.42,
        roughness: 0.35,
        metalness: 0.1,
      }),
      clogHalo: new THREE.MeshBasicMaterial({
        color: 0xf87171,
        transparent: true,
        opacity: 0.72,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      // 地下水面・飽和帯
      waterSurface: new THREE.MeshPhysicalMaterial({
        color: 0x0ea5e9,
        emissive: 0x0369a1,
        emissiveIntensity: 0.25,
        transparent: true,
        opacity: 0.5,
        roughness: 0.12,
        metalness: 0.08,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      waterCutZone: new THREE.MeshBasicMaterial({
        color: 0x0284c7,
        transparent: true,
        opacity: 0.28,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      waterLine: new THREE.LineBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.95,
      }),
      // 3D 力学オーバーレイ（土圧橙・上載紫・静水青・反力緑/赤・地震紅・内核水緑）
      virtualBackPlane: new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.08,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      virtualBackDash: new THREE.LineDashedMaterial({
        color: 0x0284c7,
        dashSize: 0.22,
        gapSize: 0.13,
        transparent: true,
        opacity: 0.95,
      }),
      earthFill: new THREE.MeshStandardMaterial({
        color: 0xf97316,
        emissive: 0xc2410c,
        emissiveIntensity: 0.2,
        transparent: true,
        opacity: 0.46,
        roughness: 0.32,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      earthEdge: new THREE.LineBasicMaterial({ color: 0xea580c }),
      earthArrow: new THREE.MeshStandardMaterial({
        color: 0xea580c,
        emissive: 0x9a3412,
        emissiveIntensity: 0.25,
        roughness: 0.35,
      }),
      surchargeFill: new THREE.MeshStandardMaterial({
        color: 0x8b5cf6,
        emissive: 0x6d28d9,
        emissiveIntensity: 0.22,
        transparent: true,
        opacity: 0.44,
        roughness: 0.32,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      surchargeEdge: new THREE.LineBasicMaterial({ color: 0x7c3aed }),
      surchargeArrow: new THREE.MeshStandardMaterial({
        color: 0x7c3aed,
        emissive: 0x5b21b6,
        emissiveIntensity: 0.28,
        roughness: 0.32,
      }),
      waterPrismFill: new THREE.MeshStandardMaterial({
        color: 0x0ea5e9,
        emissive: 0x0369a1,
        emissiveIntensity: 0.24,
        transparent: true,
        opacity: 0.5,
        roughness: 0.22,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      waterPrismEdge: new THREE.LineBasicMaterial({ color: 0x0284c7 }),
      waterArrow: new THREE.MeshStandardMaterial({
        color: 0x0284c7,
        emissive: 0x075985,
        emissiveIntensity: 0.28,
        roughness: 0.28,
      }),
      bearingOkFill: new THREE.MeshStandardMaterial({
        color: 0x10b981,
        emissive: 0x047857,
        emissiveIntensity: 0.2,
        transparent: true,
        opacity: 0.46,
        roughness: 0.3,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      bearingOkFillRebar: new THREE.MeshStandardMaterial({
        color: 0x10b981,
        emissive: 0x047857,
        emissiveIntensity: 0.16,
        transparent: true,
        opacity: 0.2,
        roughness: 0.3,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      bearingOkEdge: new THREE.LineBasicMaterial({ color: 0x059669 }),
      bearingOkArrow: new THREE.MeshStandardMaterial({
        color: 0x059669,
        emissive: 0x065f46,
        emissiveIntensity: 0.24,
        roughness: 0.32,
      }),
      bearingNgFill: new THREE.MeshStandardMaterial({
        color: 0xef4444,
        emissive: 0xb91c1c,
        emissiveIntensity: 0.28,
        transparent: true,
        opacity: 0.54,
        roughness: 0.3,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      bearingNgFillRebar: new THREE.MeshStandardMaterial({
        color: 0xef4444,
        emissive: 0xb91c1c,
        emissiveIntensity: 0.2,
        transparent: true,
        opacity: 0.24,
        roughness: 0.3,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      bearingNgEdge: new THREE.LineBasicMaterial({ color: 0xdc2626 }),
      bearingNgArrow: new THREE.MeshStandardMaterial({
        color: 0xdc2626,
        emissive: 0x991b1b,
        emissiveIntensity: 0.34,
        roughness: 0.3,
      }),
      // 底面突起（せん断キー）受働抵抗強調・シアン青緑 (M-7)
      shearKeyEdge: new THREE.LineBasicMaterial({
        color: 0x06b6d4,
        transparent: true,
        opacity: 0.98,
      }),
      shearKeyPassiveFill: new THREE.MeshStandardMaterial({
        color: 0x06b6d4,
        emissive: 0x0e7490,
        emissiveIntensity: 0.34,
        transparent: true,
        opacity: 0.44,
        roughness: 0.25,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      shearKeyPassiveArrow: new THREE.MeshStandardMaterial({
        color: 0x0891b2,
        emissive: 0x155e75,
        emissiveIntensity: 0.42,
        roughness: 0.24,
        metalness: 0.12,
      }),
      qaDashLine: new THREE.LineDashedMaterial({
        color: 0xd97706,
        dashSize: 0.16,
        gapSize: 0.1,
      }),
      kernBand: new THREE.MeshStandardMaterial({
        color: 0x14b8a6,
        emissive: 0x0f766e,
        emissiveIntensity: 0.38,
        transparent: true,
        opacity: 0.78,
        roughness: 0.25,
      }),
      baseRail: new THREE.MeshBasicMaterial({
        color: 0x475569,
        transparent: true,
        opacity: 0.72,
      }),
      pinOk: new THREE.MeshStandardMaterial({
        color: 0x10b981,
        emissive: 0x059669,
        emissiveIntensity: 0.45,
        roughness: 0.22,
        metalness: 0.2,
      }),
      pinNg: new THREE.MeshStandardMaterial({
        color: 0xef4444,
        emissive: 0xdc2626,
        emissiveIntensity: 0.55,
        roughness: 0.22,
        metalness: 0.2,
      }),
      seismicArrow: new THREE.MeshStandardMaterial({
        color: 0xe11d48,
        emissive: 0xbe123c,
        emissiveIntensity: 0.45,
        roughness: 0.26,
      }),
      cautionZone: new THREE.MeshBasicMaterial({
        map: caution,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      // 破壊モード FX 用 (M-8, M-9, M-10)
      failureRedGlow: new THREE.MeshStandardMaterial({
        color: 0xef4444,
        emissive: 0xdc2626,
        emissiveIntensity: 0.55,
        roughness: 0.25,
      }),
      failureWedge: new THREE.MeshBasicMaterial({
        color: 0xef4444,
        transparent: true,
        opacity: 0.38,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
      failureCrackV: new THREE.MeshStandardMaterial({
        map: crackGrad,
        roughness: 0.95,
        metalness: 0.0,
        transparent: true,
        opacity: 0.92,
        side: THREE.DoubleSide,
      }),
      failureCrackEdge: new THREE.LineBasicMaterial({
        color: 0xef4444,
        transparent: true,
        opacity: 0.95,
      }),
      failurePushFront: new THREE.MeshStandardMaterial({
        map: caution,
        color: 0xf87171,
        emissive: 0xb91c1c,
        emissiveIntensity: 0.25,
        transparent: true,
        opacity: 0.72,
        roughness: 0.65,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      // 乗用車シルエット用 (P-2)
      carBody: new THREE.MeshStandardMaterial({
        color: 0xf1f5f9,
        roughness: 0.28,
        metalness: 0.16,
      }),
      carGlass: new THREE.MeshPhysicalMaterial({
        color: 0x162236,
        roughness: 0.08,
        metalness: 0.32,
        clearcoat: 0.85,
        clearcoatRoughness: 0.08,
      }),
      carTrim: new THREE.MeshStandardMaterial({
        color: 0x334155,
        roughness: 0.5,
        metalness: 0.25,
      }),
      carTire: new THREE.MeshStandardMaterial({
        color: 0x1f2937,
        roughness: 0.85,
        metalness: 0.05,
      }),
      carRim: new THREE.MeshStandardMaterial({
        color: 0xcbd5e1,
        roughness: 0.32,
        metalness: 0.7,
      }),
      carHeadlight: new THREE.MeshBasicMaterial({ color: 0xfef08a }),
      carTaillight: new THREE.MeshBasicMaterial({ color: 0xef4444 }),
    };
  }

  _initLightsAndStudio() {
    this._hemiLight = new THREE.HemisphereLight(0xf4f8ff, 0x9b8e7e, 0.78);
    this.scene.add(this._hemiLight);

    // 主太陽光（前面斜め左上から立体影）
    this._keyLight = new THREE.DirectionalLight(0xfffaf0, 1.48);
    this._keyLight.position.set(-9.5, 16.5, 11.5);
    this._keyLight.castShadow = true;
    this._keyLight.shadow.mapSize.set(2048, 2048);
    this._keyLight.shadow.camera.near = 2.0;
    this._keyLight.shadow.camera.far = 48.0;
    this._keyLight.shadow.camera.left = -13.5;
    this._keyLight.shadow.camera.right = 15.5;
    this._keyLight.shadow.camera.top = 13.5;
    this._keyLight.shadow.camera.bottom = -11.0;
    this._keyLight.shadow.bias = -0.0004;
    this._keyLight.shadow.normalBias = 0.025;
    this.scene.add(this._keyLight);

    // 補助フィルライト（断面カットアウェイ面を鮮明に照らす）
    this._fillLight = new THREE.DirectionalLight(0xdbeafe, 0.48);
    this._fillLight.position.set(11.0, 8.5, 12.0);
    this.scene.add(this._fillLight);

    // リムライト（背面シルエット強調）
    this._rimLight = new THREE.DirectionalLight(0xe0f2fe, 0.42);
    this._rimLight.position.set(-4.5, 10.0, -13.5);
    this.scene.add(this._rimLight);

    // スタジオ床（影受け＋薄い工学方眼グリッド）
    this._studioGroup = new THREE.Group();
    const floorGeom = new THREE.PlaneGeometry(140, 140);
    floorGeom.rotateX(-Math.PI / 2);
    this._floorMat = new THREE.ShadowMaterial({ opacity: 0.14 });
    this._floorMesh = new THREE.Mesh(floorGeom, this._floorMat);
    this._floorMesh.receiveShadow = true;
    this._studioGroup.add(this._floorMesh);

    this._gridHelper = new THREE.GridHelper(64, 64, 0xb0bfcf, 0xcbd6e4);
    if (Array.isArray(this._gridHelper.material)) {
      this._gridHelper.material.forEach((m) => {
        m.transparent = true;
        m.opacity = 0.34;
      });
    } else {
      this._gridHelper.material.transparent = true;
      this._gridHelper.material.opacity = 0.34;
    }
    this._studioGroup.add(this._gridHelper);
    this._studioGroup.position.y = -3.02;
    this.scene.add(this._studioGroup);
  }

  _applyTheme(themeName) {
    const key = themeName === 'dark' ? 'dark' : 'light';
    const cfg = THEME_CONFIG[key];
    this.options.theme = key;

    this.scene.background = key === 'dark' ? this._textures.skyDark : this._textures.skyLight;
    this.scene.fog = new THREE.Fog(cfg.fogColor, cfg.fogNear, cfg.fogFar);
    this.renderer.toneMappingExposure = cfg.exposure;

    this._hemiLight.color.setHex(cfg.hemiSky);
    this._hemiLight.groundColor.setHex(cfg.hemiGround);
    this._hemiLight.intensity = cfg.hemiInt;
    this._keyLight.intensity = cfg.keyInt;
    this._fillLight.intensity = cfg.fillInt;
    this._rimLight.intensity = cfg.rimInt;

    this._materials.plinth.color.setHex(cfg.plinthColor);
    this._materials.wallEdge.color.setHex(cfg.wallEdgeColor);
    this._materials.wallEdge.opacity = cfg.wallEdgeOpacity;
    this._floorMat.opacity = key === 'dark' ? 0.32 : 0.14;

    if (this._gridHelper) {
      this._studioGroup.remove(this._gridHelper);
      this._gridHelper.geometry.dispose();
      if (Array.isArray(this._gridHelper.material)) {
        this._gridHelper.material.forEach((m) => m.dispose());
      } else {
        this._gridHelper.material.dispose();
      }
      this._gridHelper = new THREE.GridHelper(64, 64, cfg.gridMain, cfg.gridSub);
      const mats = Array.isArray(this._gridHelper.material)
        ? this._gridHelper.material
        : [this._gridHelper.material];
      mats.forEach((m) => {
        m.transparent = true;
        m.opacity = key === 'dark' ? 0.28 : 0.35;
      });
      this._studioGroup.add(this._gridHelper);
    }
  }

  /**
   * 建築模型スケール普通乗用車シルエット（全長 4.1m × 全幅 1.72m × 全高 1.42m、Z 方向走行向き）
   * P-2: ダークガラスのフロント・リアウィンドウ＆サイドウィンドウ帯・ピラー・サイドミラーを追加
   */
  _createCarSilhouette() {
    const car = new THREE.Group();

    // 下部ボディ＋ルーフ本体（YZ 側面プロファイルを X 方向に押し出し）
    const bodyShape = new THREE.Shape();
    bodyShape.moveTo(-2.02, 0.24);
    bodyShape.lineTo(2.02, 0.24);
    bodyShape.lineTo(2.05, 0.48);
    bodyShape.lineTo(1.88, 0.72);
    bodyShape.lineTo(1.06, 0.8);
    bodyShape.lineTo(0.45, 1.36);
    bodyShape.lineTo(-0.78, 1.36);
    bodyShape.lineTo(-1.38, 0.82);
    bodyShape.lineTo(-1.98, 0.76);
    bodyShape.lineTo(-2.06, 0.48);
    bodyShape.closePath();

    // ローカル形状は XY なので、Y 軸周り +90° 回転させて車体を Z 軸方向に整列 (+Z が前方)
    const bodyW = 1.68;
    const bodyGeom = new THREE.ExtrudeGeometry(bodyShape, {
      depth: bodyW,
      bevelEnabled: true,
      bevelThickness: 0.05,
      bevelSize: 0.04,
      bevelSegments: 2,
    });
    bodyGeom.translate(0, 0, -bodyW * 0.5);
    bodyGeom.rotateY(Math.PI * 0.5);
    const bodyMesh = new THREE.Mesh(bodyGeom, this._materials.carBody);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    car.add(bodyMesh);

    // サイドウィンドウ（前後ガラス帯を左右面にフラッシュ装着、白ルーフ＆A/Cピラーを残す）
    const sideWinShape = new THREE.Shape();
    sideWinShape.moveTo(-1.14, 0.84);
    sideWinShape.lineTo(0.84, 0.83);
    sideWinShape.lineTo(0.38, 1.28);
    sideWinShape.lineTo(-0.7, 1.28);
    sideWinShape.closePath();
    const sideWinW = 1.79;
    const sideWinGeom = new THREE.ExtrudeGeometry(sideWinShape, {
      depth: sideWinW,
      bevelEnabled: false,
    });
    sideWinGeom.translate(0, 0, -sideWinW * 0.5);
    sideWinGeom.rotateY(Math.PI * 0.5);
    const sideWinMesh = new THREE.Mesh(sideWinGeom, this._materials.carGlass);
    car.add(sideWinMesh);

    // B ピラー（サイドガラス中央のダーク仕切り柱）
    const bPillarGeom = new THREE.BoxGeometry(1.805, 0.44, 0.11);
    const bPillar = new THREE.Mesh(bPillarGeom, this._materials.carTrim);
    bPillar.position.set(0, 1.06, -0.14);
    car.add(bPillar);

    // フロントウィンドウ（傾斜ダークガラス板: (z=1.06, y=0.80) -> (z=0.45, y=1.36)）
    const fDz = 1.06 - 0.45;
    const fDy = 1.36 - 0.8;
    const fLen = Math.hypot(fDz, fDy) * 0.88;
    const fAngle = Math.atan2(fDz, fDy);
    const frontWindGeom = new THREE.BoxGeometry(1.5, fLen, 0.045);
    const frontWind = new THREE.Mesh(frontWindGeom, this._materials.carGlass);
    frontWind.position.set(0, 1.09, 0.77);
    frontWind.rotation.x = -fAngle;
    car.add(frontWind);

    // リアウィンドウ（傾斜ダークガラス板: (z=-1.38, y=0.82) -> (z=-0.78, y=1.36)）
    const rDz = 1.38 - 0.78;
    const rDy = 1.36 - 0.82;
    const rLen = Math.hypot(rDz, rDy) * 0.88;
    const rAngle = Math.atan2(rDz, rDy);
    const rearWindGeom = new THREE.BoxGeometry(1.48, rLen, 0.045);
    const rearWind = new THREE.Mesh(rearWindGeom, this._materials.carGlass);
    rearWind.position.set(0, 1.1, -1.09);
    rearWind.rotation.x = rAngle;
    car.add(rearWind);

    // フロントグリル＆左右サイドミラー
    const grilleGeom = new THREE.BoxGeometry(0.92, 0.16, 0.06);
    const grille = new THREE.Mesh(grilleGeom, this._materials.carTrim);
    grille.position.set(0, 0.48, 2.04);
    car.add(grille);

    const mirrorGeom = new THREE.BoxGeometry(0.16, 0.09, 0.13);
    for (const sx of [-0.92, 0.92]) {
      const m = new THREE.Mesh(mirrorGeom, this._materials.carBody);
      m.position.set(sx, 0.88, 0.62);
      car.add(m);
    }

    // 4 輪タイヤ＋ホイールハブ
    const wheelOffsets = [
      [-0.84, 0.31, 1.24],
      [0.84, 0.31, 1.24],
      [-0.84, 0.31, -1.24],
      [0.84, 0.31, -1.24],
    ];
    for (const [wx, wy, wz] of wheelOffsets) {
      const tireGeom = new THREE.CylinderGeometry(0.31, 0.31, 0.22, 18);
      tireGeom.rotateZ(Math.PI * 0.5);
      const tire = new THREE.Mesh(tireGeom, this._materials.carTire);
      tire.position.set(wx, wy, wz);
      tire.castShadow = true;
      car.add(tire);

      const rimGeom = new THREE.CylinderGeometry(0.18, 0.18, 0.24, 12);
      rimGeom.rotateZ(Math.PI * 0.5);
      const rim = new THREE.Mesh(rimGeom, this._materials.carRim);
      rim.position.set(wx, wy, wz);
      car.add(rim);
    }

    // ヘッドライト (+Z 前面) ＆ テールライト (-Z 後面)
    const headGeom = new THREE.BoxGeometry(0.34, 0.1, 0.05);
    for (const sx of [-0.62, 0.62]) {
      const hl = new THREE.Mesh(headGeom, this._materials.carHeadlight);
      hl.position.set(sx, 0.62, 2.05);
      car.add(hl);
    }
    const tailGeom = new THREE.BoxGeometry(1.48, 0.09, 0.05);
    const tl = new THREE.Mesh(tailGeom, this._materials.carTaillight);
    tl.position.set(0, 0.65, -2.06);
    car.add(tl);

    return car;
  }

  // ==========================================================================
  // パラメータ・計算結果抽出（SPEC.md 準拠・フォールバック安全設計）
  // ==========================================================================

  _extractGeom(params, result) {
    const p = params || {};
    const rg = (result && result.geom) || {};

    const H = clamp(Number(rg.H ?? p.H ?? 4.0) || 4.0, 2.0, 7.0);
    const t_top = clamp(Number(rg.t_top ?? p.t_top ?? 0.3) || 0.3, 0.22, 0.7);
    const t_stem = clamp(Math.max(t_top, Number(rg.t_stem ?? p.t_stem ?? 0.42) || 0.42), t_top, 1.0);
    const t_base = clamp(Number(rg.t_base ?? p.t_base ?? 0.45) || 0.45, 0.25, H - 0.5);

    let B_toe = clamp(Number(rg.B_toe ?? p.B_toe ?? 0.45), 0.0, 2.0);
    if (!Number.isFinite(B_toe)) B_toe = 0.45;
    let B = clamp(Number(rg.B ?? p.B ?? 2.8) || 2.8, 1.2, 6.0);
    let B_heel = Number(rg.B_heel);
    if (!Number.isFinite(B_heel)) {
      B_heel = B - B_toe - t_stem;
    }
    if (B_heel < 0.3) {
      B_heel = 0.3;
      B = B_toe + t_stem + B_heel;
    }

    const betaDeg = clamp(Number(p.betaDeg ?? 0) || 0, 0, 25);
    const betaRad = degToRad(betaDeg);
    const qSurcharge = clamp(Number(p.qSurcharge ?? 10) || 0, 0, 40);
    const waterRatio = clamp(Number(p.waterRatio ?? 0) || 0, 0, 0.95);
    const kh = clamp(Number(p.kh ?? 0) || 0, 0, 0.35);
    const hasKey = Boolean(p.hasKey);

    const keyDepth = clamp(Number(rg.keyDepth ?? 0.55) || 0.55, 0.25, 1.2);
    const keyWidth = clamp(Number(rg.keyWidth ?? 0.45) || 0.45, 0.25, 0.85);
    const rawKeyX = Number(rg.keyX ?? B_toe + t_stem + 0.35 * B_heel);
    const keyX = clamp(rawKeyX, Math.max(keyWidth * 0.5 + 0.08, B_toe + t_stem * 0.5), B - keyWidth * 0.5 - 0.06);

    const H_v = Number(rg.H_v ?? H + B_heel * Math.tan(betaRad));
    const H_w = Number(rg.H_w ?? waterRatio * Math.max(0, H - t_base));

    const x_front = B_toe;
    const x_back_top = B_toe + t_top;
    const x_back_bot = B_toe + t_stem;
    const backExt = Math.max(4.6, 0.92 * H);
    const X_min = -FRONT_EXT_X;
    const X_max = B + backExt;
    const Y_bot = -Math.max(2.75, 0.54 * H + (hasKey ? 0.35 : 0));

    return {
      H,
      B,
      B_toe,
      B_heel,
      t_top,
      t_stem,
      t_base,
      x_front,
      x_back_top,
      x_back_bot,
      hasKey,
      keyX,
      keyDepth,
      keyWidth,
      betaDeg,
      betaRad,
      qSurcharge,
      waterRatio,
      kh,
      isSeismic: Boolean(result?.isSeismic ?? kh > 0),
      H_v,
      H_w,
      X_min,
      X_max,
      Y_bot,
      gammaSoil: Number(p.gammaSoil ?? 18.0) || 18.0,
      phiDeg: Number(p.phiDeg ?? 30.0) || 30.0,
      qa: Number(p.qa ?? 250.0) || 250.0,
    };
  }

  /**
   * 背面地表面標高 Y(x) — X = B にて厳密に H_v = H + B_heel * tan(beta) に一致
   */
  _backGroundY(g, x) {
    if (x <= g.x_back_bot) return g.H;
    return g.H + (x - g.x_back_bot) * Math.tan(g.betaRad);
  }

  /**
   * たて壁背面の任意高さ y (t_base .. H) における X 座標
   */
  _stemBackX(g, y) {
    const t = clamp((y - g.t_base) / Math.max(0.05, g.H - g.t_base), 0, 1);
    return g.x_back_bot + (g.x_back_top - g.x_back_bot) * t;
  }

  // ==========================================================================
  // 公開 API: update / setOptions / Camera / Labels / resize / render / dispose
  // ==========================================================================

  update(params, result) {
    if (this._disposed) return;
    this._params = params ? { ...params } : {};
    this._result = result || null;
    this._geom = this._extractGeom(this._params, this._result);
    this._rebarDirty = true;

    // 失敗アニメーション用配列クリア
    this._dripDrops = [];
    this._waterShimmerMeshes = [];
    this._clogPulseMeshes = [];
    this._seismicPulseMeshes = [];

    // スタジオ床の高さを底面台座直下へ追従
    this._studioGroup.position.y = this._geom.Y_bot - 0.22;

    // 各パラメトリックジオメトリを再構築（旧 BufferGeometry を即時 dispose）
    this._rebuildWall();
    this._rebuildWeepHoles();
    this._rebuildGroundAndDrain();
    this._rebuildWaterSurface();
    this._rebuildSurchargeVisual();

    if (this.options.showRebar) {
      this._rebuildRebar();
      this._rebarDirty = false;
      this.rebarGroup.visible = true;
    } else {
      clearGroupGeometries(this.rebarGroup);
      this.rebarGroup.visible = false;
    }

    this._rebuildForcesOverlay();
    this.forcesGroup.visible = Boolean(this.options.showForces);

    // M-12: 破壊アクティブ false->true または primaryFailure 種別変化時に位相を 0 リセット
    const isActiveNow = this._isFailureActive();
    const modeNow = isActiveNow ? this._result.overall.primaryFailure : 'none';
    if (!isActiveNow || !this._prevFailureActive || modeNow !== this._prevFailureMode) {
      this._animPhase = 0;
    }
    this._prevFailureActive = isActiveNow;
    this._prevFailureMode = modeNow;

    this._rebuildFailureFx();
    this._syncFailurePose(isActiveNow ? this._computeFailureWave(this._animPhase) : 0);
  }

  setOptions(opts = {}) {
    if (this._disposed || !opts) return;
    const prevRebar = this.options.showRebar;
    const prevTheme = this.options.theme;
    const prevActive = this._isFailureActive();

    if (typeof opts.showForces === 'boolean') {
      this.options.showForces = opts.showForces;
      this.forcesGroup.visible = opts.showForces;
    }
    if (typeof opts.showRebar === 'boolean') {
      this.options.showRebar = opts.showRebar;
    }
    if (typeof opts.showFailureAnim === 'boolean') {
      this.options.showFailureAnim = opts.showFailureAnim;
    }
    if (typeof opts.showLabels === 'boolean') {
      this.options.showLabels = opts.showLabels;
    }
    if (opts.theme && opts.theme !== prevTheme) {
      this._applyTheme(opts.theme);
    }

    // 主鉄筋透視モード切替時：擁壁コンクリート・裏込め砕石・底面反力透明度を一括切替 (M-7, P-2)
    if (this.options.showRebar !== prevRebar) {
      this._applyWallGlassMode(this.options.showRebar);
      if (this.options.showRebar) {
        if (this._rebarDirty && this._geom) {
          this._rebuildRebar();
          this._rebarDirty = false;
        }
        this.rebarGroup.visible = true;
      } else {
        this.rebarGroup.visible = false;
      }
    }

    // 破壊プレビュー状態変化の位相リセット＆再構築 (M-12)
    const activeNow = this._isFailureActive();
    if (!activeNow) {
      this._animPhase = 0;
      this._prevFailureActive = false;
      this._prevFailureMode = 'none';
      this._resetWallPose();
      this.failureFxGroup.visible = false;
    } else {
      const modeNow = this._result.overall.primaryFailure;
      if (!prevActive || modeNow !== this._prevFailureMode) {
        this._animPhase = 0;
      }
      this._prevFailureActive = true;
      this._prevFailureMode = modeNow;
      this._rebuildFailureFx();
      this._syncFailurePose(this._computeFailureWave(this._animPhase));
    }
  }

  setPresetCamera(name) {
    if (this._disposed) return;
    const presetName = name || 'iso_cutaway';
    this._activePreset = presetName;
    this._userCustomCamera = false;

    const g = this._geom || this._extractGeom(null, null);
    const S = Math.max(g.H, g.B * 1.15, 3.8) / 4.0;
    const cx = g.B * 0.56;
    const cy = g.H * 0.36;

    // M-6: ポートレート（390×844 等 aspect < 1.0）では水平 FOV 狭まりに応じてカメラ距離を自動後退
    const aspect = this.camera.aspect || 1.6;
    this._lastPresetAspect = aspect;
    const isPortrait = aspect < 1.0;
    const portraitScale = isPortrait ? clamp(1.16 / Math.max(aspect, 0.44), 1.0, 2.45) : 1.0;

    let basePos;
    let tgt;

    switch (presetName) {
      case 'section_front':
        tgt = [g.B * 0.76, g.H * 0.34 + (isPortrait ? 0.35 * S : 0), 3.6];
        basePos = [g.B * 0.76, g.H * 0.44 + (isPortrait ? 0.35 * S : 0), 18.8 * S];
        break;
      case 'back_drain':
        tgt = [g.B * 0.9, g.H * 0.46 + (isPortrait ? 0.3 * S : 0), 0.2];
        basePos = [g.B + 10.6 * S, g.H * 0.74 + 5.2 * S, 13.6 * S];
        break;
      case 'base_bearing':
        // M-10: 底面反力・突起・プランドトルすべり円弧全体が美しく収まる構図
        tgt = [g.B * 0.36, -0.34 + (isPortrait ? 0.25 * S : 0), 3.6];
        basePos = [g.B * 0.22 - 3.6 * S, 1.05, 13.8 * S];
        break;
      case 'top_overview':
        tgt = [cx + 0.15, g.H * 0.28, 0.0];
        basePos = [cx - 8.2 * S, g.H + 12.2 * S, 13.4 * S];
        break;
      case 'iso_cutaway':
      default:
        tgt = [cx + (isPortrait ? 0.55 : 0.25), cy + (isPortrait ? 0.48 * S : 0), 0.35];
        basePos = [cx - 9.2 * S, cy + 5.2 * S, 15.8 * S];
        break;
    }

    // ターゲットからのオフセットベクトルに portraitScale を掛けて滑らかに広角フィット
    const pos = [
      tgt[0] + (basePos[0] - tgt[0]) * portraitScale,
      tgt[1] + (basePos[1] - tgt[1]) * portraitScale,
      tgt[2] + (basePos[2] - tgt[2]) * portraitScale,
    ];

    this._applyCameraImmediate(pos, tgt);
  }

  _applyCameraImmediate(pos, tgt) {
    if (pos) {
      const px = Array.isArray(pos) ? pos[0] : pos.x;
      const py = Array.isArray(pos) ? pos[1] : pos.y;
      const pz = Array.isArray(pos) ? pos[2] : pos.z;
      if (Number.isFinite(px) && Number.isFinite(py) && Number.isFinite(pz)) {
        this.camera.position.set(px, py, pz);
      }
    }
    if (tgt) {
      const tx = Array.isArray(tgt) ? tgt[0] : tgt.x;
      const ty = Array.isArray(tgt) ? tgt[1] : tgt.y;
      const tz = Array.isArray(tgt) ? tgt[2] : tgt.z;
      if (Number.isFinite(tx) && Number.isFinite(ty) && Number.isFinite(tz)) {
        this.controls.target.set(tx, ty, tz);
      }
    }
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.camera.updateMatrixWorld();
  }

  setCamera(pos, tgt) {
    if (this._disposed) return;
    this._userCustomCamera = true;
    this._applyCameraImmediate(pos, tgt);
  }

  getCamera() {
    return {
      position: [
        Number(this.camera.position.x.toFixed(3)),
        Number(this.camera.position.y.toFixed(3)),
        Number(this.camera.position.z.toFixed(3)),
      ],
      target: [
        Number(this.controls.target.x.toFixed(3)),
        Number(this.controls.target.y.toFixed(3)),
        Number(this.controls.target.z.toFixed(3)),
      ],
    };
  }

  projectToScreen(worldPos) {
    const v =
      worldPos instanceof THREE.Vector3
        ? worldPos.clone()
        : Array.isArray(worldPos)
        ? new THREE.Vector3(worldPos[0], worldPos[1], worldPos[2])
        : new THREE.Vector3(worldPos.x, worldPos.y, worldPos.z);

    v.project(this.camera);
    const w = this.canvas.clientWidth || this.renderer.domElement.width;
    const h = this.canvas.clientHeight || this.renderer.domElement.height;
    return {
      x: (v.x * 0.5 + 0.5) * w,
      y: (-v.y * 0.5 + 0.5) * h,
      visible: v.z >= -1 && v.z <= 1,
      ndcZ: v.z,
    };
  }

  /**
   * 3D ピンラベル用のワールド座標アンカー配列を返す。
   * app.js の normalizeAnchorList / projectAnchorToScreen 契約と完全整合。
   */
  getLabelWorldAnchors() {
    const g = this._geom || this._extractGeom(null, null);
    const r = this._result;
    const bearing = r?.checks?.bearing;
    const ovt = r?.checks?.overturning;
    const forces = r?.forces;

    const dVal = clamp(Number(ovt?.d ?? g.B * 0.46), -0.25, g.B + 0.25);
    const eVal = Number(ovt?.e ?? 0);
    const yWater = this._getWaterLevelY(g, r);
    const { pScale, qScale } = this._getDiagramScales(g, r);
    const { earthPts, waterPts } = this._getLateralProfiles(g, r);

    const earthMidP = this._sampleProfile(earthPts, g.H_v * 0.35);
    const earthPeakX = g.B + Math.min(2.5, Math.max(0.65, earthMidP * pScale * 0.85));

    const qaAllow = Number(bearing?.qaAllow ?? (g.isSeismic ? g.qa * 1.5 : g.qa)) || 250;
    const q1 = Number(bearing?.q1 ?? 130);
    const qMax = Number(bearing?.qMax ?? q1);
    const q1Vis = Math.min(Number.isFinite(qMax) ? qMax : qaAllow * 2.3, qaAllow * 2.35, 850);
    const bearingMidY = -Math.max(0.55, q1Vis * qScale * 0.56);
    const qMaxStr = qMax >= 9000 ? '過大(転倒)' : `${qMax.toFixed(1)}`;

    const anchors = [];
    const pushAnchor = (id, text, sub, tone, priority, x, y, z) => {
      anchors.push({
        id,
        text,
        sub,
        tone,
        priority,
        worldPos: [x, y, z],
        pos: [x, y, z],
        x,
        y,
        z,
      });
    };

    // 主鉄筋カットアウェイ透視モード時は背面引張主鉄筋を最優先表示
    if (this.options.showRebar) {
      pushAnchor(
        'rebar',
        '背面引張主鉄筋（赤）',
        '片持ち曲げ引張側＋底版定着',
        'danger',
        99,
        this._stemBackX(g, g.H * 0.62),
        g.H * 0.62,
        1.4
      );
    }

    // 力学オーバーレイ関連ラベル
    if (this.options.showForces) {
      // M-4: 2D 断面図と完全統一（Pa_h + Pq_h 合計、生アンダースコア全廃）
      const paH = Number(forces?.Pa_h ?? 0);
      const pqH = Number(forces?.Pq_h ?? 0);
      const paTotal = paH + pqH;
      const hasSurch = pqH > 0.05 || g.qSurcharge > 0.5;
      const earthLabel = g.isSeismic
        ? hasSurch
          ? '地震時土圧 PAE+Pq'
          : '地震時主働土圧 PAE'
        : hasSurch
        ? '主働土圧合算 Pa+Pq'
        : '主働土圧 Pa';
      pushAnchor(
        'earthPressure',
        earthLabel,
        `${paTotal.toFixed(1)} kN/m`,
        'earth',
        95,
        earthPeakX,
        g.H_v * 0.38,
        FRONT_Z + 0.45
      );

      if (g.waterRatio > 0.001 && yWater > 0.05) {
        const pwH = Number(forces?.Pw_h ?? 0);
        const wMidP = this._sampleProfile(waterPts, yWater * 0.35);
        const waterPinX = g.B + Math.min(3.2, Math.max(1.1, (earthMidP + wMidP) * pScale * 0.9));
        pushAnchor(
          'waterPressure',
          '残留静水圧 Pw',
          `水位 ${yWater.toFixed(2)}m ／ ${pwH.toFixed(1)} kN/m`,
          'water',
          97,
          waterPinX,
          Math.max(0.4, yWater * 0.42),
          FRONT_Z + 0.48
        );
      }

      const bearingOk = bearing ? Boolean(bearing.ok) : true;
      const bearingX =
        bearing?.isTriangular && eVal < 0
          ? g.B - Math.min(g.B * 0.45, (bearing.contactLen ?? g.B) * 0.45)
          : Math.min(g.B * 0.36, (bearing?.contactLen ?? g.B) * 0.38);
      pushAnchor(
        'bearing',
        bearing?.isTriangular ? '底面反力（浮上り）' : '底面地盤反力',
        `qmax=${qMaxStr} / 許容 ${qaAllow.toFixed(0)} kN/m²`,
        bearingOk ? 'bearing' : 'danger',
        93,
        bearingX,
        bearingMidY,
        FRONT_Z + 0.48
      );

      const ovtOk = ovt ? Boolean(ovt.ok) : true;
      pushAnchor(
        'resultant',
        ovtOk ? '合力作用点（核内 OK）' : '偏心超過（転倒危険）',
        `d=${(ovt?.d ?? dVal).toFixed(2)}m ／ e=${eVal.toFixed(2)}m`,
        ovtOk ? 'ok' : 'danger',
        89,
        dVal,
        -0.06,
        FRONT_Z + 0.62
      );

      if (g.isSeismic) {
        const hIn = Number(forces?.H_inertia ?? 0);
        // P-2: 地震時水平慣性力ピンラベルを赤脈動矢印より +0.58m 上へオフセットして重なり防止
        pushAnchor(
          'inertia',
          '地震時水平慣性力',
          `kh=${g.kh.toFixed(2)} ／ ${hIn.toFixed(1)} kN/m`,
          'danger',
          91,
          g.B * 0.52 + 0.45,
          g.H * 0.5 + 0.58,
          FRONT_Z + 0.52
        );
      }

      pushAnchor(
        'virtualBack',
        '仮想背面（X=B）',
        `Hv=${g.H_v.toFixed(2)}m`,
        'structure',
        62,
        g.B,
        g.H_v + 0.28,
        FRONT_Z + 0.14
      );
    }

    // 上載荷重
    if (g.qSurcharge > 0.5) {
      const sx = g.B + 1.35;
      pushAnchor(
        'surcharge',
        '上載荷重 q',
        `${g.qSurcharge.toFixed(0)} kN/m²`,
        'surcharge',
        78,
        sx,
        this._backGroundY(g, sx) + 0.95,
        FRONT_Z * 0.42
      );
    }

    // 水抜き孔・排水状態
    pushAnchor(
      'drain',
      g.waterRatio > 0.001 ? '水抜き孔（詰まり）' : '水抜き孔・砕石排水',
      g.waterRatio > 0.001 ? '排水不良 → 地下水位上昇' : '健全排水（6箇所）',
      g.waterRatio > 0.001 ? 'danger' : 'water',
      g.waterRatio > 0.001 ? 94 : 74,
      g.x_front - 0.08,
      Math.max(g.t_base + 0.42, g.t_base + (g.H - g.t_base) * 0.24),
      1.8
    );

    // 底面突起（せん断キー）— M-7: 優先度 96 へ引き上げ＆反力ラベルと重ならない位置へ配置
    if (g.hasKey) {
      const rKey = Number(forces?.R_key ?? 0);
      pushAnchor(
        'shearKey',
        '底面突起（せん断キー）',
        `滑動抵抗 +${rKey.toFixed(1)} kN/m`,
        'ok',
        96,
        g.keyX + 0.12,
        -g.keyDepth - 0.44,
        FRONT_Z + 0.56
      );
    }

    // 擁壁本体
    pushAnchor(
      'wall',
      g.B_toe <= 0.01 ? 'L型 RC 擁壁' : '逆T型 RC 擁壁',
      `H=${g.H.toFixed(2)}m × B=${g.B.toFixed(2)}m`,
      'structure',
      68,
      g.x_front + g.t_top * 0.5,
      g.H + 0.24,
      0.8
    );

    return anchors;
  }

  resize() {
    if (this._disposed) return;
    const parent = this.canvas.parentElement;
    const w = Math.max(1, (parent ? parent.clientWidth : this.canvas.clientWidth) || window.innerWidth || 1280);
    const h = Math.max(1, (parent ? parent.clientHeight : this.canvas.clientHeight) || window.innerHeight || 720);

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    const newAspect = w / h;
    this.camera.aspect = newAspect;
    this.camera.updateProjectionMatrix();

    // M-6: ポートレート切替・大幅アスペクト比変化時に現在のプリセットカメラを自動広角再フィット
    if (
      this._activePreset &&
      !this._userCustomCamera &&
      this._geom &&
      Math.abs(newAspect - this._lastPresetAspect) > 0.08
    ) {
      this.setPresetCamera(this._activePreset);
    }
  }

  render(dtArg) {
    if (this._disposed) return;
    const clockDt = this._clock.getDelta();
    const dt =
      typeof dtArg === 'number' && Number.isFinite(dtArg)
        ? clamp(dtArg, 0, 0.05)
        : Math.min(clockDt, 0.05);
    this._elapsed += dt;

    // 1. 破壊プレビューアニメーション
    if (this._isFailureActive()) {
      this._animPhase = (this._animPhase + dt / 3.2) % 1.0;
      const amp = this._computeFailureWave(this._animPhase);
      this._syncFailurePose(amp);
    } else if (
      this.wallGroup.position.x !== 0 ||
      this.wallGroup.position.y !== 0 ||
      this.wallGroup.rotation.z !== 0
    ) {
      this._resetWallPose();
      this.failureFxGroup.visible = false;
    }

    // 2. 生き生きとした 60fps マイクロアニメーション（割り当てゼロ）
    this._updateMicroAnimations(dt);

    // 3. OrbitControls & WebGL レンダリング
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;

    this.controls.dispose();

    clearGroupGeometries(this.wallMeshGroup);
    clearGroupGeometries(this.weepGroup);
    clearGroupGeometries(this.rebarGroup);
    clearGroupGeometries(this.leanConcGroup);
    clearGroupGeometries(this.groundGroup);
    clearGroupGeometries(this.waterGroup);
    clearGroupGeometries(this.surchargeGroup);
    clearGroupGeometries(this.forcesGroup);
    clearGroupGeometries(this.failureFxGroup);

    // 乗用車のジオメトリ解放
    if (this._carGroup) {
      this._carGroup.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
      });
    }

    // スタジオ床・グリッド解放
    if (this._floorMesh) {
      this._floorMesh.geometry.dispose();
      this._floorMat.dispose();
    }
    if (this._gridHelper) {
      this._gridHelper.geometry.dispose();
      if (Array.isArray(this._gridHelper.material)) {
        this._gridHelper.material.forEach((m) => m.dispose());
      } else {
        this._gridHelper.material.dispose();
      }
    }

    // 共有マテリアル・テクスチャ・環境マップ解放
    Object.values(this._materials).forEach((m) => m && m.dispose());
    Object.values(this._textures).forEach((t) => t && t.dispose());
    if (this._envRT) this._envRT.dispose();

    this.renderer.dispose();
  }

  // ==========================================================================
  // 1. L型 / 逆T型 RC 擁壁本体（＋突起せん断キー統合）
  // ==========================================================================

  _rebuildWall() {
    clearGroupGeometries(this.wallMeshGroup);
    const g = this._geom;

    const shape = new THREE.Shape();
    // 原点 (0, 0) つま先底面端から反時計回りにプロファイル作成
    shape.moveTo(0, 0);

    if (g.hasKey) {
      const kL = g.keyX - g.keyWidth * 0.5;
      const kR = g.keyX + g.keyWidth * 0.5;
      const draft = 0.03;
      shape.lineTo(kL, 0);
      shape.lineTo(kL + draft, -g.keyDepth);
      shape.lineTo(kR - draft, -g.keyDepth);
      shape.lineTo(kR, 0);
    }

    shape.lineTo(g.B, 0);
    shape.lineTo(g.B, g.t_base);
    shape.lineTo(g.x_back_bot, g.t_base);
    shape.lineTo(g.x_back_top, g.H);
    shape.lineTo(g.x_front, g.H);

    if (g.B_toe > 0.005) {
      shape.lineTo(g.x_front, g.t_base);
      shape.lineTo(0, g.t_base);
    }
    shape.closePath();

    // 実寸 3.6m = 1 リピート (型枠パネル 1.8m × 0.9m)
    const wallGeom = extrudeXYShape(shape, L_Z, BACK_Z, 1 / 3.6, 1 / 3.6);
    const isGlass = Boolean(this.options.showRebar);

    this._wallMesh = new THREE.Mesh(
      wallGeom,
      isGlass ? this._materials.concreteGlass : this._materials.concreteOpaque
    );
    this._wallMesh.castShadow = !isGlass;
    this._wallMesh.receiveShadow = true;
    this._wallMesh.renderOrder = isGlass ? 6 : 0;
    this.wallMeshGroup.add(this._wallMesh);

    // CAD 輪郭エッジライン（視認性向上）
    const edgeGeom = new THREE.EdgesGeometry(wallGeom, 22);
    this._wallEdgeLine = new THREE.LineSegments(
      edgeGeom,
      isGlass ? this._materials.wallEdgeGlass : this._materials.wallEdge
    );
    this._wallEdgeLine.renderOrder = isGlass ? 7 : 1;
    this.wallMeshGroup.add(this._wallEdgeLine);

    // M-7: 突起（せん断キー）あり時は手前断面にシアン青緑の強調アウトラインを常時配置
    if (g.hasKey) {
      const kL = g.keyX - g.keyWidth * 0.5;
      const kR = g.keyX + g.keyWidth * 0.5;
      const draft = 0.03;
      const zKey = FRONT_Z + 0.042;
      const keyOutlinePts = [
        new THREE.Vector3(kL, 0, zKey),
        new THREE.Vector3(kL + draft, -g.keyDepth, zKey),
        new THREE.Vector3(kR - draft, -g.keyDepth, zKey),
        new THREE.Vector3(kR, 0, zKey),
        new THREE.Vector3(kL, 0, zKey),
      ];
      const keyLineGeom = new THREE.BufferGeometry().setFromPoints(keyOutlinePts);
      const keyLine = new THREE.Line(keyLineGeom, this._materials.shearKeyEdge);
      keyLine.renderOrder = 12;
      this.wallMeshGroup.add(keyLine);
    }
  }

  _applyWallGlassMode(isGlass) {
    if (this._wallMesh) {
      this._wallMesh.material = isGlass
        ? this._materials.concreteGlass
        : this._materials.concreteOpaque;
      this._wallMesh.castShadow = !isGlass;
      this._wallMesh.renderOrder = isGlass ? 6 : 0;
    }
    if (this._wallEdgeLine) {
      this._wallEdgeLine.material = isGlass
        ? this._materials.wallEdgeGlass
        : this._materials.wallEdge;
      this._wallEdgeLine.renderOrder = isGlass ? 7 : 1;
    }
    // P-2: 鉄筋透視モード時は裏込め砕石を半透明淡色化して背面引張赤主筋を際立たせる
    if (this._drainMesh) {
      this._drainMesh.material = isGlass
        ? this._materials.gravelGhost
        : this._materials.gravel;
      this._drainMesh.renderOrder = isGlass ? 4 : 0;
    }
    // M-7: 鉄筋透視モード時は底面反力プリズムの不透明度を下げて突起コンクリート輪郭＋赤U字筋を鮮明に透視
    if (this._bearingPrismMesh) {
      this._bearingPrismMesh.material = isGlass
        ? this._bearingOkState
          ? this._materials.bearingOkFillRebar
          : this._materials.bearingNgFillRebar
        : this._bearingOkState
        ? this._materials.bearingOkFill
        : this._materials.bearingNgFill;
    }
  }

  // ==========================================================================
  // 2. 水抜き孔パイプ 6 箇所（千鳥配置＋健全排水滴り／詰まり赤キャップ）
  // ==========================================================================

  _rebuildWeepHoles() {
    clearGroupGeometries(this.weepGroup);
    const g = this._geom;

    const stemClearH = Math.max(0.8, g.H - g.t_base);
    const yLow = clamp(g.t_base + Math.max(0.32, stemClearH * 0.2), g.t_base + 0.25, g.H - 0.55);
    const yHigh = clamp(g.t_base + Math.min(stemClearH * 0.58, 2.2), yLow + 0.35, g.H - 0.35);

    // 厳密に 6 本・対称千鳥配置
    const zCoords = [-3.0, -1.8, -0.6, 0.6, 1.8, 3.0];
    const isClogged = g.waterRatio > 0.001;
    const pipeR = 0.044;

    zCoords.forEach((zPos, idx) => {
      const isUpper = idx % 2 === 1;
      const yPos = isUpper ? yHigh : yLow;
      const xBack = this._stemBackX(g, yPos);
      const xStart = g.x_front - 0.025;
      const xEnd = xBack + 0.09;
      const len = Math.max(0.2, xEnd - xStart);
      const xMid = (xStart + xEnd) * 0.5;

      // PVC パイプスリーブ（前面へわずかに下り勾配）
      const pipeGeom = new THREE.CylinderGeometry(pipeR, pipeR, len, 14);
      pipeGeom.rotateZ(Math.PI * 0.5 + 0.04);
      const pipeMesh = new THREE.Mesh(pipeGeom, this._materials.pvcPipe);
      pipeMesh.position.set(xMid, yPos, zPos);
      pipeMesh.castShadow = true;
      this.weepGroup.add(pipeMesh);

      if (isClogged) {
        // 水抜き孔詰まり：警戒赤キャップ＋パルスリング
        const capGeom = new THREE.CylinderGeometry(pipeR * 1.18, pipeR * 1.12, 0.065, 16);
        capGeom.rotateZ(Math.PI * 0.5);
        const capMesh = new THREE.Mesh(capGeom, this._materials.clogCap);
        capMesh.position.set(xStart - 0.012, yPos - 0.005, zPos);
        this.weepGroup.add(capMesh);

        const ringGeom = new THREE.RingGeometry(pipeR * 1.35, pipeR * 2.15, 20);
        ringGeom.rotateY(-Math.PI * 0.5);
        const ringMat = this._materials.clogHalo.clone();
        ringMat.userData._dynamic = true;
        const ringMesh = new THREE.Mesh(ringGeom, ringMat);
        ringMesh.position.set(xStart - 0.048, yPos - 0.005, zPos);
        ringMesh.userData.phase = idx * 0.85;
        this.weepGroup.add(ringMesh);
        this._clogPulseMeshes.push(ringMesh);
      } else {
        // 健全排水：開口暗部＋下段パイプからの排水滴り・湿潤すじ
        const boreGeom = new THREE.CircleGeometry(pipeR * 0.78, 14);
        boreGeom.rotateY(-Math.PI * 0.5);
        const boreMesh = new THREE.Mesh(boreGeom, this._materials.pipeBore);
        boreMesh.position.set(xStart - 0.004, yPos - 0.003, zPos);
        this.weepGroup.add(boreMesh);

        if (!isUpper) {
          // 湿潤すじ（前面コンクリート上のわずかな水跡）
          const streakH = Math.max(0.25, yPos - g.t_base - 0.02);
          const streakGeom = new THREE.PlaneGeometry(0.11, streakH);
          streakGeom.rotateY(-Math.PI * 0.5);
          const streakMesh = new THREE.Mesh(streakGeom, this._materials.dampStreak);
          streakMesh.position.set(g.x_front - 0.004, yPos - streakH * 0.5 - 0.03, zPos);
          this.weepGroup.add(streakMesh);

          // 滴り水滴（2 粒ずつアニメーション）
          for (let d = 0; d < 2; d++) {
            const dropGeom = new THREE.SphereGeometry(0.022, 8, 8);
            dropGeom.scale(0.85, 1.45, 0.85);
            const dropMesh = new THREE.Mesh(dropGeom, this._materials.dripWater);
            dropMesh.position.set(xStart - 0.025, yPos - 0.04, zPos);
            dropMesh.userData = {
              topY: yPos - 0.03,
              botY: g.t_base + 0.03,
              baseX: xStart - 0.022,
              phase: (idx * 0.37 + d * 0.5) % 1.0,
              speed: 0.62 + (idx % 3) * 0.08,
            };
            this.weepGroup.add(dropMesh);
            this._dripDrops.push(dropMesh);
          }
        }
      }
    });
  }

  // ==========================================================================
  // 3. 主鉄筋カットアウェイ透視ゲージ（背面引張主鉄筋を赤で強調！）
  // ==========================================================================

  _rebuildRebar() {
    clearGroupGeometries(this.rebarGroup);
    const g = this._geom;

    const cov = 0.068;
    const rMain = 0.017; // 主鉄筋半径（視認性重視の明確な太さ）
    const rDist = 0.0105; // 配力筋半径

    const mainPos = [];
    const mainNrm = [];
    const distPos = [];
    const distNrm = [];

    const zMin = BACK_Z + 0.16;
    const zMax = FRONT_Z - 0.16;
    const nZ = 19; // 約 0.42m ピッチ

    // たて壁背面引張主鉄筋（片持ち梁曲げによる引張側＝背面＋かかと上端＋つま先下端）
    const xStemBackTop = g.x_back_top - cov;
    const xStemBackBot = g.x_back_bot - cov;
    const xStemFront = g.x_front + cov;
    const yCrest = g.H - cov;
    const yBaseTop = g.t_base - cov;
    const yBaseBot = cov;

    for (let iz = 0; iz < nZ; iz++) {
      const z = zMin + (iz / (nZ - 1)) * (zMax - zMin);

      // (1) 背面引張主鉄筋（たて壁背面沿い -> 底版内定着Lフック）
      appendCylinderBar(
        mainPos,
        mainNrm,
        xStemBackTop,
        yCrest,
        z,
        xStemBackBot,
        yBaseTop,
        z,
        rMain
      );
      appendCylinderBar(
        mainPos,
        mainNrm,
        xStemBackBot,
        yBaseTop,
        z,
        xStemBackBot,
        yBaseBot + 0.02,
        z,
        rMain
      );
      // 底版内への水平定着曲げ（つま先側へ定着）
      const anchorEndX = Math.max(cov + 0.04, xStemBackBot - Math.min(0.65, g.B * 0.25));
      appendCylinderBar(
        mainPos,
        mainNrm,
        xStemBackBot,
        yBaseBot + 0.02,
        z,
        anchorEndX,
        yBaseBot + 0.02,
        z,
        rMain
      );

      // (2) かかと版上端引張主鉄筋（土塊荷重で下向きに曲がるため上端が引張！）
      appendCylinderBar(
        mainPos,
        mainNrm,
        g.B - cov,
        yBaseTop,
        z,
        xStemFront,
        yBaseTop,
        z,
        rMain
      );
      // かかと先端 90° 下向きかぎフック
      appendCylinderBar(
        mainPos,
        mainNrm,
        g.B - cov,
        yBaseTop,
        z,
        g.B - cov,
        yBaseBot + 0.02,
        z,
        rMain
      );

      // (3) つま先版・底版下端引張主鉄筋（地盤反力で上向きに曲がるため下端が引張！）
      appendCylinderBar(
        mainPos,
        mainNrm,
        cov,
        yBaseBot,
        z,
        g.B - cov,
        yBaseBot,
        z,
        rMain
      );
      // つま先先端 90° 上向きかぎフック
      appendCylinderBar(
        mainPos,
        mainNrm,
        cov,
        yBaseBot,
        z,
        cov,
        yBaseTop,
        z,
        rMain
      );

      // (4) 突起（せん断キー）U字せん断補強主鉄筋 (M-7: 太さ・視認性を強調)
      if (g.hasKey) {
        const kxL = g.keyX - g.keyWidth * 0.5 + cov;
        const kxR = g.keyX + g.keyWidth * 0.5 - cov;
        const kyBot = -g.keyDepth + cov;
        appendCylinderBar(mainPos, mainNrm, kxL, yBaseTop, z, kxL, kyBot, z, rMain * 1.05);
        appendCylinderBar(mainPos, mainNrm, kxL, kyBot, z, kxR, kyBot, z, rMain * 1.05);
        appendCylinderBar(mainPos, mainNrm, kxR, kyBot, z, kxR, yBaseTop, z, rMain * 1.05);
      }

      // (5) 前面縦筋 ＆ 天端キャップ筋（鋼銀色）
      appendCylinderBar(
        distPos,
        distNrm,
        xStemFront,
        yBaseBot + 0.02,
        z,
        xStemFront,
        yCrest,
        z,
        rDist
      );
      // 天端 U 字連結筋
      appendCylinderBar(
        distPos,
        distNrm,
        xStemFront,
        yCrest,
        z,
        xStemBackTop,
        yCrest,
        z,
        rDist
      );
    }

    // (6) 縦断方向（Z 方向）配力鉄筋：たて壁背面・前面
    const nStemH = Math.max(5, Math.round((g.H - g.t_base) / 0.42));
    for (let ih = 0; ih <= nStemH; ih++) {
      const t = ih / nStemH;
      const y = g.t_base + 0.12 + t * Math.max(0.2, g.H - g.t_base - 0.24);
      const xb = this._stemBackX(g, y) - cov - 0.026;
      const xf = g.x_front + cov + 0.024;
      appendCylinderBar(distPos, distNrm, xb, y, zMin - 0.04, xb, y, zMax + 0.04, rDist);
      appendCylinderBar(distPos, distNrm, xf, y, zMin - 0.04, xf, y, zMax + 0.04, rDist);
    }

    // (7) 縦断方向（Z 方向）配力鉄筋：底版上端・下端
    const nBaseX = Math.max(5, Math.round(g.B / 0.45));
    for (let ix = 0; ix <= nBaseX; ix++) {
      const x = cov + 0.05 + (ix / nBaseX) * Math.max(0.2, g.B - 2 * cov - 0.1);
      appendCylinderBar(
        distPos,
        distNrm,
        x,
        yBaseBot + 0.025,
        zMin - 0.04,
        x,
        yBaseBot + 0.025,
        zMax + 0.04,
        rDist
      );
      if (x >= g.x_back_bot || x <= g.x_front) {
        appendCylinderBar(
          distPos,
          distNrm,
          x,
          yBaseTop - 0.025,
          zMin - 0.04,
          x,
          yBaseTop - 0.025,
          zMax + 0.04,
          rDist
        );
      }
    }

    // (8) 突起内縦断配力筋
    if (g.hasKey) {
      const kyMid = -g.keyDepth * 0.55;
      const kxL = g.keyX - g.keyWidth * 0.5 + cov + 0.02;
      const kxR = g.keyX + g.keyWidth * 0.5 - cov - 0.02;
      appendCylinderBar(distPos, distNrm, kxL, kyMid, zMin, kxL, kyMid, zMax, rDist);
      appendCylinderBar(distPos, distNrm, kxR, kyMid, zMin, kxR, kyMid, zMax, rDist);
    }

    const mainGeom = new THREE.BufferGeometry();
    mainGeom.setAttribute('position', new THREE.Float32BufferAttribute(mainPos, 3));
    mainGeom.setAttribute('normal', new THREE.Float32BufferAttribute(mainNrm, 3));
    const mainMesh = new THREE.Mesh(mainGeom, this._materials.rebarMain);
    mainMesh.renderOrder = 11;
    this.rebarGroup.add(mainMesh);

    const distGeom = new THREE.BufferGeometry();
    distGeom.setAttribute('position', new THREE.Float32BufferAttribute(distPos, 3));
    distGeom.setAttribute('normal', new THREE.Float32BufferAttribute(distNrm, 3));
    const distMesh = new THREE.Mesh(distGeom, this._materials.rebarDist);
    distMesh.renderOrder = 10;
    this.rebarGroup.add(distMesh);
  }

  // ==========================================================================
  // 4. 基礎砕石・均しコン・基礎地盤・裏込め砕石・背面盛土（beta 追従）・道路/芝
  // ==========================================================================

  _rebuildGroundAndDrain() {
    clearGroupGeometries(this.groundGroup);
    clearGroupGeometries(this.leanConcGroup);
    this._drainMesh = null;
    const g = this._geom;

    const leanThick = 0.08;
    const baseGravelThick = 0.2;
    const baseExcY = -(leanThick + baseGravelThick); // -0.28
    const leanPad = 0.14;
    const gravelPad = 0.32;

    // 4-1. 均しコンクリート (Y = -0.08 .. 0.0, M-10: 独立グループ化して支持力沈下時に底版追従)
    const addLeanRect = (x0, x1, y0, y1) => {
      if (x1 - x0 < 0.02) return;
      const s = new THREE.Shape();
      s.moveTo(x0, y0);
      s.lineTo(x1, y0);
      s.lineTo(x1, y1);
      s.lineTo(x0, y1);
      s.closePath();
      const geom = extrudeXYShape(s, L_Z - 0.012, BACK_Z + 0.006, 0.5, 0.5);
      const mesh = new THREE.Mesh(geom, this._materials.leanConcrete);
      mesh.receiveShadow = true;
      this.leanConcGroup.add(mesh);
    };

    if (g.hasKey) {
      const kL = g.keyX - g.keyWidth * 0.5;
      const kR = g.keyX + g.keyWidth * 0.5;
      addLeanRect(-leanPad, kL, -leanThick, 0);
      addLeanRect(kR, g.B + leanPad, -leanThick, 0);
      addLeanRect(kL - 0.05, kR + 0.05, -g.keyDepth - leanThick, -g.keyDepth);
    } else {
      addLeanRect(-leanPad, g.B + leanPad, -leanThick, 0);
    }

    // 4-2. 基礎砕石 (Y = -0.28 .. -0.08, 突起あり時は突起直下を包むクレードル形状)
    const gravelShape = new THREE.Shape();
    if (g.hasKey) {
      const kL = g.keyX - g.keyWidth * 0.5 - 0.05;
      const kR = g.keyX + g.keyWidth * 0.5 + 0.05;
      const keyBot = -g.keyDepth - leanThick;
      gravelShape.moveTo(-gravelPad, baseExcY);
      gravelShape.lineTo(kL - 0.12, baseExcY);
      gravelShape.lineTo(kL - 0.12, keyBot - 0.16);
      gravelShape.lineTo(kR + 0.12, keyBot - 0.16);
      gravelShape.lineTo(kR + 0.12, baseExcY);
      gravelShape.lineTo(g.B + gravelPad, baseExcY);
      gravelShape.lineTo(g.B + gravelPad, -leanThick);
      gravelShape.lineTo(kR, -leanThick);
      gravelShape.lineTo(kR, keyBot);
      gravelShape.lineTo(kL, keyBot);
      gravelShape.lineTo(kL, -leanThick);
      gravelShape.lineTo(-gravelPad, -leanThick);
      gravelShape.closePath();
    } else {
      gravelShape.moveTo(-gravelPad, baseExcY);
      gravelShape.lineTo(g.B + gravelPad, baseExcY);
      gravelShape.lineTo(g.B + gravelPad, -leanThick);
      gravelShape.lineTo(-gravelPad, -leanThick);
      gravelShape.closePath();
    }
    const baseGravelGeom = extrudeXYShape(gravelShape, L_Z, BACK_Z, 0.85, 0.85);
    const baseGravelMesh = new THREE.Mesh(baseGravelGeom, this._materials.gravelBase);
    baseGravelMesh.receiveShadow = true;
    this.groundGroup.add(baseGravelMesh);

    // 4-3. カットアウェイ基礎地盤 (Y_bot .. 基礎砕石下面 ＆ 前面地盤 Y = t_base - 0.06)
    const frontTopY = Math.max(0.12, g.t_base - 0.06);
    const subShape = new THREE.Shape();
    subShape.moveTo(g.X_min, g.Y_bot);
    subShape.lineTo(g.X_max, g.Y_bot);
    subShape.lineTo(g.X_max, 0.0);
    subShape.lineTo(g.B + gravelPad, 0.0);
    subShape.lineTo(g.B + gravelPad, baseExcY);

    if (g.hasKey) {
      const kL = g.keyX - g.keyWidth * 0.5 - 0.17;
      const kR = g.keyX + g.keyWidth * 0.5 + 0.17;
      const keyExcBot = -g.keyDepth - leanThick - 0.16;
      subShape.lineTo(kR, baseExcY);
      subShape.lineTo(kR, keyExcBot);
      subShape.lineTo(kL, keyExcBot);
      subShape.lineTo(kL, baseExcY);
    }

    subShape.lineTo(-gravelPad, baseExcY);
    subShape.lineTo(-gravelPad, -leanThick);
    // つま先前面 (X = -0.02) に沿って前面地盤へ滑らかに接続（つま先スラブ上面は視認可能！）
    subShape.lineTo(-0.02, -leanThick);
    subShape.lineTo(-0.02, frontTopY);
    subShape.lineTo(g.X_min, frontTopY);
    subShape.closePath();

    const subGeom = extrudeXYShape(subShape, L_Z, BACK_Z, 0.22, 0.22);
    const subMesh = new THREE.Mesh(subGeom, this._materials.subsoil);
    subMesh.receiveShadow = true;
    this.groundGroup.add(subMesh);

    // 4-4. 前面芝生表層 (X_min .. -0.02, Y = frontTopY .. t_base)
    const frontGrassShape = new THREE.Shape();
    frontGrassShape.moveTo(g.X_min, frontTopY);
    frontGrassShape.lineTo(-0.02, frontTopY);
    frontGrassShape.lineTo(-0.02, g.t_base);
    frontGrassShape.lineTo(g.X_min, g.t_base);
    frontGrassShape.closePath();
    const frontGrassGeom = extrudeXYShape(frontGrassShape, L_Z, BACK_Z, 0.42, 0.42);
    const frontGrassMesh = new THREE.Mesh(frontGrassGeom, this._materials.grass);
    frontGrassMesh.receiveShadow = true;
    this.groundGroup.add(frontGrassMesh);

    // 4-5. 建築模型ベース台座（ジオラマ下面の引き締まったダークスレート台座）
    const plinthH = 0.22;
    const plinthPad = 0.16;
    const plinthGeom = new THREE.BoxGeometry(
      g.X_max - g.X_min + plinthPad * 2,
      plinthH,
      L_Z + plinthPad * 2
    );
    const plinthMesh = new THREE.Mesh(plinthGeom, this._materials.plinth);
    plinthMesh.position.set((g.X_min + g.X_max) * 0.5, g.Y_bot - plinthH * 0.5, 0);
    plinthMesh.castShadow = true;
    plinthMesh.receiveShadow = true;
    this.groundGroup.add(plinthMesh);

    // 4-6. 裏込め砕石ドレーン層（M-9: かかと上面・背面に微小分離クリアランス＆Zインセットで Z-fighting 根絶）
    const drainThick = clamp(g.B_heel * 0.3, 0.24, 0.46);
    const drainTopY = Math.max(g.t_base + 0.4, g.H - 0.26);
    const clearGap = 0.014;
    const xDrainTopIn = this._stemBackX(g, drainTopY) + clearGap;
    const xDrainBotIn = g.x_back_bot + clearGap;
    const yDrainBot = g.t_base + clearGap;
    const xDrainPadOut = Math.min(g.B - 0.05, xDrainBotIn + drainThick + 0.32);

    const drainShape = new THREE.Shape();
    drainShape.moveTo(xDrainBotIn, yDrainBot);
    drainShape.lineTo(xDrainPadOut, yDrainBot);
    drainShape.lineTo(xDrainPadOut, g.t_base + 0.18);
    drainShape.lineTo(xDrainBotIn + drainThick, g.t_base + 0.22);
    drainShape.lineTo(xDrainTopIn + drainThick, drainTopY);
    drainShape.lineTo(xDrainTopIn, drainTopY);
    drainShape.closePath();

    // Z 方向を 14mm インセットして擁壁コンクリート断面 (Z = ±4.0) との共面 Z-fighting を完全防止
    const drainGeom = extrudeXYShape(drainShape, L_Z - 0.016, BACK_Z + 0.008, 0.9, 0.9);
    const isRebarNow = Boolean(this.options.showRebar);
    const drainMesh = new THREE.Mesh(
      drainGeom,
      isRebarNow ? this._materials.gravelGhost : this._materials.gravel
    );
    drainMesh.receiveShadow = true;
    drainMesh.renderOrder = isRebarNow ? 4 : 0;
    this.groundGroup.add(drainMesh);
    this._drainMesh = drainMesh;

    // 4-7. 背面盛土（地表面勾配 betaDeg にリアルタイム厳密追従＋Zインセット＆道路下面密閉）
    const wearThick = 0.07;
    const yBackAtMax = this._backGroundY(g, g.X_max);
    const bfShape = new THREE.Shape();

    bfShape.moveTo(xDrainPadOut, yDrainBot);
    bfShape.lineTo(g.B + clearGap, yDrainBot);
    bfShape.lineTo(g.B + clearGap, 0.0);
    bfShape.lineTo(g.X_max, 0.0);
    bfShape.lineTo(g.X_max, yBackAtMax - wearThick);
    bfShape.lineTo(g.x_back_bot + clearGap, g.H - wearThick);
    bfShape.lineTo(g.x_back_top + clearGap, g.H - wearThick);
    bfShape.lineTo(xDrainTopIn, drainTopY);
    bfShape.lineTo(xDrainTopIn + drainThick, drainTopY);
    bfShape.lineTo(xDrainBotIn + drainThick, g.t_base + 0.22);
    bfShape.lineTo(xDrainPadOut, g.t_base + 0.18);
    bfShape.closePath();

    const bfGeom = extrudeXYShape(bfShape, L_Z - 0.016, BACK_Z + 0.008, 0.24, 0.24);
    const bfMesh = new THREE.Mesh(bfGeom, this._materials.backfill);
    bfMesh.receiveShadow = true;
    this.groundGroup.add(bfMesh);

    // 4-8. 背面表層（道路アスファルト舗装＋縁石 OR 勾配芝生）
    const isRoad = g.qSurcharge > 0.5 && g.betaDeg <= 8.0;
    if (isRoad) {
      // コンクリート路肩縁石
      const curbX0 = g.x_back_top;
      const curbX1 = Math.min(g.X_max - 0.5, g.x_back_top + 0.34);
      const curbY0 = g.H - wearThick;
      const curbY1 = this._backGroundY(g, curbX1) + 0.06;
      const curbShape = new THREE.Shape();
      curbShape.moveTo(curbX0, curbY0);
      curbShape.lineTo(curbX1, this._backGroundY(g, curbX1) - wearThick);
      curbShape.lineTo(curbX1, curbY1);
      curbShape.lineTo(curbX0, g.H + 0.06);
      curbShape.closePath();
      const curbGeom = extrudeXYShape(curbShape, L_Z, BACK_Z, 0.5, 0.5);
      const curbMesh = new THREE.Mesh(curbGeom, this._materials.curbConcrete);
      curbMesh.castShadow = true;
      curbMesh.receiveShadow = true;
      this.groundGroup.add(curbMesh);

      // アスファルト舗装（白線が Z 方向に伸びる専用 UV）
      const roadX0 = curbX1;
      const roadW = Math.max(1.0, g.X_max - roadX0);
      const roadShape = new THREE.Shape();
      roadShape.moveTo(roadX0, this._backGroundY(g, roadX0) - wearThick);
      roadShape.lineTo(g.X_max, yBackAtMax - wearThick);
      roadShape.lineTo(g.X_max, yBackAtMax);
      roadShape.lineTo(roadX0, this._backGroundY(g, roadX0));
      roadShape.closePath();

      const roadGeom = new THREE.ExtrudeGeometry(roadShape, { depth: L_Z, bevelEnabled: false });
      roadGeom.translate(0, 0, BACK_Z);
      roadGeom.computeVertexNormals();
      // X 方向を roadX0..X_max -> u = 0..1 へ正規化して白線位置を路肩＆車線中央に固定
      const posAttr = roadGeom.attributes.position;
      const uvArr = new Float32Array(posAttr.count * 2);
      for (let i = 0; i < posAttr.count; i++) {
        const px = posAttr.getX(i);
        const pz = posAttr.getZ(i);
        uvArr[i * 2] = (px - roadX0) / Math.min(roadW, 6.2);
        uvArr[i * 2 + 1] = (pz + HALF_Z) * 0.25;
      }
      roadGeom.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));

      const roadMesh = new THREE.Mesh(roadGeom, this._materials.road);
      roadMesh.receiveShadow = true;
      this.groundGroup.add(roadMesh);
    } else {
      // 背面法面芝生表層（betaDeg に完全追従）
      const turfShape = new THREE.Shape();
      turfShape.moveTo(g.x_back_top, g.H - wearThick);
      turfShape.lineTo(g.x_back_bot, g.H - wearThick);
      turfShape.lineTo(g.X_max, yBackAtMax - wearThick);
      turfShape.lineTo(g.X_max, yBackAtMax);
      turfShape.lineTo(g.x_back_bot, g.H);
      turfShape.lineTo(g.x_back_top, g.H);
      turfShape.closePath();
      const turfGeom = extrudeXYShape(turfShape, L_Z, BACK_Z, 0.36, 0.36);
      const turfMesh = new THREE.Mesh(turfGeom, this._materials.grass);
      turfMesh.receiveShadow = true;
      this.groundGroup.add(turfMesh);
    }
  }

  // ==========================================================================
  // 5. 地下水面・飽和帯表現（waterRatio > 0 でリアル上昇！）
  // ==========================================================================

  _getWaterLevelY(g, result) {
    if (g.waterRatio <= 0.001) return 0;
    const wPts = this._parsePressurePts(result?.diagrams?.waterPressurePts);
    if (wPts && wPts.length >= 2) {
      let maxY = 0;
      for (const pt of wPts) {
        if (pt.y > maxY) maxY = pt.y;
      }
      if (maxY > 0.05) return Math.min(g.H - 0.05, maxY);
    }
    return Math.min(g.H - 0.05, g.H_w);
  }

  _rebuildWaterSurface() {
    clearGroupGeometries(this.waterGroup);
    const g = this._geom;
    if (g.waterRatio <= 0.001) return;

    const yWater = this._getWaterLevelY(g, this._result);
    if (yWater <= 0.04) return;

    const aboveBase = yWater > g.t_base + 0.025;
    const xAtWater = aboveBase ? this._stemBackX(g, yWater) : g.B;

    // 1. 手前断面 (Z = +4.015) の半透明青・飽和土塊オーバーレイ
    const satShape = new THREE.Shape();
    if (aboveBase) {
      satShape.moveTo(g.x_back_bot, g.t_base);
      satShape.lineTo(g.B, g.t_base);
      satShape.lineTo(g.B, 0.0);
      satShape.lineTo(g.X_max, 0.0);
      satShape.lineTo(g.X_max, yWater);
      satShape.lineTo(xAtWater, yWater);
      satShape.closePath();
    } else {
      // 低水位 (H_w <= t_base) 時：かかと背面側 (X = B .. X_max) のみ飽和表示（自己交差ゼロ）
      satShape.moveTo(g.B, 0.0);
      satShape.lineTo(g.X_max, 0.0);
      satShape.lineTo(g.X_max, yWater);
      satShape.lineTo(g.B, yWater);
      satShape.closePath();
    }

    const satGeom = new THREE.ShapeGeometry(satShape);
    satGeom.translate(0, 0, FRONT_Z + 0.015);
    const satMat = this._materials.waterCutZone.clone();
    satMat.userData._dynamic = true;
    const satMesh = new THREE.Mesh(satGeom, satMat);
    satMesh.renderOrder = 4;
    satMesh.userData.baseOpacity = 0.26;
    this.waterGroup.add(satMesh);
    this._waterShimmerMeshes.push(satMesh);

    // 2. 背面断面 (Z = -4.015) にも同飽和オーバーレイ
    const satBackGeom = new THREE.ShapeGeometry(satShape);
    satBackGeom.translate(0, 0, BACK_Z - 0.015);
    const satBackMesh = new THREE.Mesh(satBackGeom, satMat);
    satBackMesh.renderOrder = 4;
    this.waterGroup.add(satBackMesh);

    // 3. 半透明の地下水面シート（水平水面が断面を貫く）
    const wWidth = Math.max(0.2, g.X_max - xAtWater);
    const surfGeom = new THREE.PlaneGeometry(wWidth, L_Z + 0.04, 1, 1);
    surfGeom.rotateX(-Math.PI * 0.5);
    const surfMat = this._materials.waterSurface.clone();
    surfMat.userData._dynamic = true;
    const surfMesh = new THREE.Mesh(surfGeom, surfMat);
    surfMesh.position.set(xAtWater + wWidth * 0.5, yWater, 0);
    surfMesh.renderOrder = 5;
    surfMesh.userData.baseOpacity = 0.48;
    this.waterGroup.add(surfMesh);
    this._waterShimmerMeshes.push(surfMesh);

    // 4. 手前断面のくっきりした地下水面ライン (▽ 浸潤線)
    const linePts = [
      new THREE.Vector3(xAtWater, yWater, FRONT_Z + 0.025),
      new THREE.Vector3(g.X_max, yWater, FRONT_Z + 0.025),
    ];
    const lineGeom = new THREE.BufferGeometry().setFromPoints(linePts);
    const waterLine = new THREE.Line(lineGeom, this._materials.waterLine);
    waterLine.renderOrder = 6;
    this.waterGroup.add(waterLine);

    // ▽ 水位三角シンボル (手前断面 X = B + 0.9)
    const triX = Math.min(g.X_max - 0.6, g.B + 0.9);
    const triPts = [
      new THREE.Vector3(triX, yWater + 0.01, FRONT_Z + 0.03),
      new THREE.Vector3(triX - 0.14, yWater + 0.22, FRONT_Z + 0.03),
      new THREE.Vector3(triX + 0.14, yWater + 0.22, FRONT_Z + 0.03),
      new THREE.Vector3(triX, yWater + 0.01, FRONT_Z + 0.03),
    ];
    const triGeom = new THREE.BufferGeometry().setFromPoints(triPts);
    const triLine = new THREE.Line(triGeom, this._materials.waterLine);
    triLine.renderOrder = 6;
    this.waterGroup.add(triLine);
  }

  // ==========================================================================
  // 6. 上載荷重ビジュアル（乗用車シルエット＋路面配置）
  // ==========================================================================

  _rebuildSurchargeVisual() {
    const g = this._geom;
    const showCar = g.qSurcharge > 0.5 && g.betaDeg <= 8.0;
    this._carGroup.visible = showCar;

    if (showCar) {
      const carX = clamp(g.x_back_top + 1.65, g.x_back_top + 1.35, g.X_max - 1.15);
      const carY = this._backGroundY(g, carX);
      this._carGroup.position.set(carX, carY, -0.75);
      this._carGroup.rotation.set(0, 0, g.betaRad);
    }
  }

  // ==========================================================================
  // 7. 3D 空間力学オーバーレイ（土圧・水圧・上載圧・反力・ミドルサード・合力ピン）
  // ==========================================================================

  _parsePressurePts(rawPts) {
    if (!Array.isArray(rawPts) || rawPts.length < 2) return null;
    const out = [];
    for (const item of rawPts) {
      if (Array.isArray(item) && item.length >= 2) {
        const y = Number(item[0]);
        const p = Number(item[1]);
        if (Number.isFinite(y) && Number.isFinite(p)) out.push({ y, p: Math.max(0, p) });
      } else if (item && typeof item === 'object') {
        const y = Number(item.y ?? item.h ?? item.elev);
        const p = Number(item.p ?? item.q ?? item.val ?? item.value ?? item.pressure);
        if (Number.isFinite(y) && Number.isFinite(p)) out.push({ y, p: Math.max(0, p) });
      }
    }
    if (out.length < 2) return null;
    out.sort((a, b) => a.y - b.y);
    return out;
  }

  _sampleProfile(pts, y) {
    if (!pts || pts.length === 0) return 0;
    if (y <= pts[0].y + 1e-5) return pts[0].p;
    if (y >= pts[pts.length - 1].y - 1e-5) return pts[pts.length - 1].p;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (y >= a.y - 1e-5 && y <= b.y + 1e-5) {
        const span = b.y - a.y;
        if (span < 1e-5) return Math.max(a.p, b.p);
        const t = (y - a.y) / span;
        return a.p + (b.p - a.p) * t;
      }
    }
    return 0;
  }

  _getLateralProfiles(g, result) {
    const yWater = this._getWaterLevelY(g, result);
    const ka = Number(result?.coeff?.ka ?? 0.333) || 0.333;
    const deltaRad = degToRad(Number(result?.coeff?.deltaDeg ?? g.betaDeg) || 0);
    const kH = ka * Math.cos(deltaRad);

    let earthPts = this._parsePressurePts(result?.diagrams?.earthPressurePts);
    if (!earthPts) {
      const gammaSat = g.gammaSoil + 1.5;
      const gammaSub = Math.max(5.0, gammaSat - GAMMA_W);
      if (yWater > 0.05 && yWater < g.H_v - 0.05) {
        const pW = kH * g.gammaSoil * (g.H_v - yWater);
        const p0 = kH * (g.gammaSoil * (g.H_v - yWater) + gammaSub * yWater);
        earthPts = [
          { y: 0, p: p0 },
          { y: yWater, p: pW },
          { y: g.H_v, p: 0 },
        ];
      } else {
        earthPts = [
          { y: 0, p: kH * g.gammaSoil * g.H_v },
          { y: g.H_v, p: 0 },
        ];
      }
    }

    let surchargePts = this._parsePressurePts(result?.diagrams?.surchargePts);
    if (!surchargePts) {
      const pq = kH * g.qSurcharge;
      surchargePts =
        pq > 0.05
          ? [
              { y: 0, p: pq },
              { y: g.H_v, p: pq },
            ]
          : [];
    }

    let waterPts = this._parsePressurePts(result?.diagrams?.waterPressurePts);
    if (!waterPts) {
      waterPts =
        yWater > 0.05
          ? [
              { y: 0, p: GAMMA_W * yWater },
              { y: yWater, p: 0 },
            ]
          : [];
    }

    return { earthPts, surchargePts, waterPts, yWater };
  }

  _getDiagramScales(g, result) {
    const { earthPts, surchargePts, waterPts } = this._getLateralProfiles(g, result);
    const maxP = Math.max(
      35,
      this._sampleProfile(earthPts, 0) +
        this._sampleProfile(surchargePts, 0) +
        this._sampleProfile(waterPts, 0)
    );
    const pScale = clamp(2.85 / maxP, 0.015, 0.032);

    const qaAllow = Number(result?.checks?.bearing?.qaAllow ?? (g.isSeismic ? g.qa * 1.5 : g.qa)) || 250;
    const q1 = Number(result?.checks?.bearing?.q1 ?? 130) || 130;
    const refQ = Math.max(qaAllow * 1.25, Math.min(q1, qaAllow * 2.1), 160);
    const qScale = clamp(1.9 / refQ, 0.0024, 0.0085);

    return { pScale, qScale };
  }

  /**
   * 折れ線プロファイルから X = [x0(y), x1(y)] の 3D 半透明プリズムと枠線を作成
   */
  _addLayeredPressurePrism(ys, x0Arr, x1Arr, zFront, depth, fillMat, edgeMat, arrowMat) {
    let maxW = 0;
    for (let i = 0; i < ys.length; i++) {
      maxW = Math.max(maxW, x1Arr[i] - x0Arr[i]);
    }
    if (maxW < 0.02) return;

    const shape = new THREE.Shape();
    shape.moveTo(x0Arr[0], ys[0]);
    for (let i = 0; i < ys.length; i++) {
      shape.lineTo(x1Arr[i], ys[i]);
    }
    for (let i = ys.length - 1; i >= 0; i--) {
      shape.lineTo(x0Arr[i], ys[i]);
    }
    shape.closePath();

    const geom = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    geom.translate(0, 0, zFront);
    const mesh = new THREE.Mesh(geom, fillMat);
    mesh.renderOrder = 8;
    this.forcesGroup.add(mesh);

    const edgeGeom = new THREE.EdgesGeometry(geom, 18);
    const edges = new THREE.LineSegments(edgeGeom, edgeMat);
    edges.renderOrder = 9;
    this.forcesGroup.add(edges);

    // 水平力矢印（右 +X から左 -X 向きへ仮想背面を押す表現）
    const yLo = ys[0];
    const yHi = ys[ys.length - 1];
    const nArrows = clamp(Math.round((yHi - yLo) / 0.72), 2, 6);
    const zMid = zFront + depth * 0.5;

    for (let k = 0; k < nArrows; k++) {
      const f = (k + 0.5) / nArrows;
      const y = yLo + f * (yHi - yLo);
      // 線形補間で該当高さの x0, x1 を求める
      let x0 = x0Arr[0];
      let x1 = x1Arr[0];
      for (let i = 0; i < ys.length - 1; i++) {
        if (y >= ys[i] - 1e-5 && y <= ys[i + 1] + 1e-5) {
          const t = (y - ys[i]) / Math.max(1e-5, ys[i + 1] - ys[i]);
          x0 = x0Arr[i] + (x0Arr[i + 1] - x0Arr[i]) * t;
          x1 = x1Arr[i] + (x1Arr[i + 1] - x1Arr[i]) * t;
          break;
        }
      }
      if (x1 - x0 < 0.14) continue;
      const arrow = buildArrowMesh(
        new THREE.Vector3(x1 - 0.03, y, zMid),
        new THREE.Vector3(x0 + 0.02, y, zMid),
        0.022,
        0.068,
        0.16,
        arrowMat
      );
      if (arrow) {
        arrow.renderOrder = 10;
        this.forcesGroup.add(arrow);
      }
    }
  }

  _rebuildForcesOverlay() {
    clearGroupGeometries(this.forcesGroup);
    this._bearingPrismMesh = null;
    const g = this._geom;
    const r = this._result;

    const { earthPts, surchargePts, waterPts, yWater } = this._getLateralProfiles(g, r);
    const { pScale, qScale } = this._getDiagramScales(g, r);

    const zPrism = FRONT_Z + 0.06;
    const prismD = 0.4;

    // ------------------------------------------------------------------------
    // 7-1. 仮想背面 (X = B) の半透明基準面＋破線
    // ------------------------------------------------------------------------
    const vbPlaneGeom = new THREE.PlaneGeometry(L_Z, g.H_v);
    vbPlaneGeom.rotateY(Math.PI * 0.5);
    const vbPlane = new THREE.Mesh(vbPlaneGeom, this._materials.virtualBackPlane);
    vbPlane.position.set(g.B, g.H_v * 0.5, 0);
    vbPlane.renderOrder = 6;
    this.forcesGroup.add(vbPlane);

    const vbFrontLineGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(g.B, 0, FRONT_Z + 0.045),
      new THREE.Vector3(g.B, g.H_v + 0.25, FRONT_Z + 0.045),
    ]);
    const vbFrontLine = new THREE.Line(vbFrontLineGeom, this._materials.virtualBackDash);
    vbFrontLine.computeLineDistances();
    vbFrontLine.renderOrder = 9;
    this.forcesGroup.add(vbFrontLine);

    const vbTopLineGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(g.B, g.H_v + 0.03, BACK_Z),
      new THREE.Vector3(g.B, g.H_v + 0.03, FRONT_Z),
    ]);
    const vbTopLine = new THREE.Line(vbTopLineGeom, this._materials.virtualBackDash);
    vbTopLine.computeLineDistances();
    this.forcesGroup.add(vbTopLine);

    // ------------------------------------------------------------------------
    // 7-2. 水平圧分布プリズム（土圧橙 -> 上載圧紫 -> 静水圧青 を外側へ積層）
    // ------------------------------------------------------------------------
    const ySet = new Set([0, g.H_v]);
    for (const pt of earthPts) ySet.add(clamp(pt.y, 0, g.H_v));
    for (const pt of surchargePts) ySet.add(clamp(pt.y, 0, g.H_v));
    if (yWater > 0.05 && yWater < g.H_v) ySet.add(yWater);
    const ysAll = Array.from(ySet).sort((a, b) => a - b);

    const xBase = ysAll.map(() => g.B);
    const xAfterEarth = ysAll.map((y) => g.B + this._sampleProfile(earthPts, y) * pScale);
    const xAfterSurch = ysAll.map(
      (y, idx) => xAfterEarth[idx] + this._sampleProfile(surchargePts, y) * pScale
    );

    // ① 土圧分布プリズム（橙）
    this._addLayeredPressurePrism(
      ysAll,
      xBase,
      xAfterEarth,
      zPrism,
      prismD,
      this._materials.earthFill,
      this._materials.earthEdge,
      this._materials.earthArrow
    );

    // ② 上載圧帯（紫）＋地表面下向き載荷バー・矢印群
    if (g.qSurcharge > 0.5) {
      this._addLayeredPressurePrism(
        ysAll,
        xAfterEarth,
        xAfterSurch,
        zPrism + 0.015,
        prismD - 0.03,
        this._materials.surchargeFill,
        this._materials.surchargeEdge,
        this._materials.surchargeArrow
      );

      // 背面地表面上の紫色上載荷重分布バー＆下向き矢印群
      const qBarH = clamp(0.28 + (g.qSurcharge / 30) * 0.65, 0.28, 0.95);
      const qX0 = g.x_back_bot + 0.08;
      const qX1 = g.X_max - 0.12;
      const nQ = 6;
      const zQ = FRONT_Z - 0.15;

      const topBarPts = [
        new THREE.Vector3(qX0, this._backGroundY(g, qX0) + qBarH, zQ),
        new THREE.Vector3(qX1, this._backGroundY(g, qX1) + qBarH, zQ),
      ];
      const barGeom = new THREE.BufferGeometry().setFromPoints(topBarPts);
      this.forcesGroup.add(new THREE.Line(barGeom, this._materials.surchargeEdge));

      // 半透明帯パネル
      const qPanelShape = new THREE.Shape();
      qPanelShape.moveTo(qX0, this._backGroundY(g, qX0) + 0.04);
      qPanelShape.lineTo(qX1, this._backGroundY(g, qX1) + 0.04);
      qPanelShape.lineTo(qX1, this._backGroundY(g, qX1) + qBarH);
      qPanelShape.lineTo(qX0, this._backGroundY(g, qX0) + qBarH);
      qPanelShape.closePath();
      const qPanelGeom = new THREE.ShapeGeometry(qPanelShape);
      qPanelGeom.translate(0, 0, zQ);
      const qPanelMesh = new THREE.Mesh(qPanelGeom, this._materials.surchargeFill);
      qPanelMesh.renderOrder = 8;
      this.forcesGroup.add(qPanelMesh);

      for (let i = 0; i < nQ; i++) {
        const x = qX0 + ((i + 0.5) / nQ) * (qX1 - qX0);
        const ySurf = this._backGroundY(g, x);
        const arrow = buildArrowMesh(
          new THREE.Vector3(x, ySurf + qBarH, zQ),
          new THREE.Vector3(x, ySurf + 0.05, zQ),
          0.025,
          0.072,
          0.18,
          this._materials.surchargeArrow
        );
        if (arrow) this.forcesGroup.add(arrow);
      }
    }

    // ③ 静水圧分布プリズム（青/水色, waterRatio > 0 時）
    if (waterPts.length >= 2 && yWater > 0.05) {
      const ysW = ysAll.filter((y) => y <= yWater + 1e-4);
      if (ysW.length >= 2) {
        const xW0 = ysW.map(
          (y) =>
            g.B +
            (this._sampleProfile(earthPts, y) + this._sampleProfile(surchargePts, y)) * pScale
        );
        const xW1 = ysW.map((y, idx) => xW0[idx] + this._sampleProfile(waterPts, y) * pScale);
        this._addLayeredPressurePrism(
          ysW,
          xW0,
          xW1,
          zPrism + 0.03,
          prismD - 0.06,
          this._materials.waterPrismFill,
          this._materials.waterPrismEdge,
          this._materials.waterArrow
        );
      }
    }

    // ④ 地震時水平慣性力矢印 (kh > 0 時)
    const H_inertia = Number(r?.forces?.H_inertia ?? 0);
    if (g.isSeismic && (H_inertia > 0.1 || g.kh > 0.001)) {
      const xCG = g.B * 0.52;
      const yCG = g.H * 0.5;
      const lenI = clamp(0.85 + g.kh * 5.2, 0.9, 2.2);
      const inertiaArrow = buildArrowMesh(
        new THREE.Vector3(xCG + lenI, yCG, FRONT_Z + 0.44),
        new THREE.Vector3(xCG, yCG, FRONT_Z + 0.44),
        0.048,
        0.135,
        0.3,
        this._materials.seismicArrow
      );
      if (inertiaArrow) {
        inertiaArrow.renderOrder = 11;
        this.forcesGroup.add(inertiaArrow);
        this._seismicPulseMeshes.push(inertiaArrow);
      }
    }

    // ------------------------------------------------------------------------
    // 7-3. 底面地盤反力分布プリズム（緑/赤、台形 or 三角形浮き上がり対応）
    // ------------------------------------------------------------------------
    const br = r?.checks?.bearing;
    const ovt = r?.checks?.overturning;

    const bearingOk = br ? Boolean(br.ok) : true;
    const qaAllow = Number(br?.qaAllow ?? (g.isSeismic ? g.qa * 1.5 : g.qa)) || 250;
    const isTriangular = Boolean(br?.isTriangular);
    const eActual = Number(ovt?.e ?? 0);
    const isToeUplift = isTriangular && eActual < 0;
    const contactLen = clamp(Number(br?.contactLen ?? g.B), 0.12, g.B);
    const rawQ1 = Number(br?.q1 ?? 130);
    const rawQ2 = Number(br?.q2 ?? 40);

    // 極端な転倒時 q1=9999 でも画面内に美しく収まるよう上限クランプ
    const maxVisQ = Math.max(qaAllow * 2.35, 380);
    const q1Vis = clamp(Number.isFinite(rawQ1) ? rawQ1 : maxVisQ, 0, maxVisQ);
    const q2Vis = clamp(Number.isFinite(rawQ2) ? rawQ2 : 0, 0, maxVisQ);

    const xContactStart = isToeUplift ? Math.max(0, g.B - contactLen) : 0;
    const xContactEnd = isToeUplift ? g.B : contactLen;
    const yLeft = isToeUplift ? 0.0 : -Math.max(0.08, q1Vis * qScale);
    const yRight = isToeUplift
      ? -Math.max(0.08, q2Vis * qScale)
      : isTriangular
      ? 0.0
      : -Math.max(0.0, q2Vis * qScale);

    const bShape = new THREE.Shape();
    bShape.moveTo(xContactStart, 0);
    bShape.lineTo(xContactEnd, 0);
    if (yRight < -0.01) {
      bShape.lineTo(xContactEnd, yRight);
    }
    if (yLeft < -0.01) {
      bShape.lineTo(xContactStart, yLeft);
    }
    bShape.closePath();

    const isRebarNow = Boolean(this.options.showRebar);
    this._bearingOkState = bearingOk;
    const bFillMat = isRebarNow
      ? bearingOk
        ? this._materials.bearingOkFillRebar
        : this._materials.bearingNgFillRebar
      : bearingOk
      ? this._materials.bearingOkFill
      : this._materials.bearingNgFill;
    const bEdgeMat = bearingOk ? this._materials.bearingOkEdge : this._materials.bearingNgEdge;
    const bArrMat = bearingOk ? this._materials.bearingOkArrow : this._materials.bearingNgArrow;

    const bGeom = new THREE.ExtrudeGeometry(bShape, { depth: prismD, bevelEnabled: false });
    bGeom.translate(0, 0, zPrism);
    const bMesh = new THREE.Mesh(bGeom, bFillMat);
    bMesh.renderOrder = 8;
    this.forcesGroup.add(bMesh);
    this._bearingPrismMesh = bMesh;

    const bEdgeGeom = new THREE.EdgesGeometry(bGeom, 18);
    const bEdges = new THREE.LineSegments(bEdgeGeom, bEdgeMat);
    bEdges.renderOrder = 9;
    this.forcesGroup.add(bEdges);

    // M-7: 底面突起（せん断キー）あり時は手前断面最前面 (Z = +4.50) にシアン受働抵抗矢印＋突起強調ラインを配置
    if (g.hasKey) {
      const kL = g.keyX - g.keyWidth * 0.5;
      const kR = g.keyX + g.keyWidth * 0.5;
      const draft = 0.03;
      const zKeyFx = zPrism + prismD + 0.05;

      // 突起シルエットのシアン青緑ハイライト枠（反力プリズムの前面に投影して一目で視認可能）
      const projKeyPts = [
        new THREE.Vector3(kL, 0, zKeyFx),
        new THREE.Vector3(kL + draft, -g.keyDepth, zKeyFx),
        new THREE.Vector3(kR - draft, -g.keyDepth, zKeyFx),
        new THREE.Vector3(kR, 0, zKeyFx),
        new THREE.Vector3(kL, 0, zKeyFx),
      ];
      const projKeyGeom = new THREE.BufferGeometry().setFromPoints(projKeyPts);
      const projKeyLine = new THREE.Line(projKeyGeom, this._materials.shearKeyEdge);
      projKeyLine.renderOrder = 13;
      this.forcesGroup.add(projKeyLine);

      // 突起前面の受働土圧抵抗ウェッジ（シアン半透明三角帯）
      const wedgeW = clamp(0.62, 0.36, Math.max(0.4, kL - 0.05));
      const pKeyShape = new THREE.Shape();
      pKeyShape.moveTo(kL - 0.01, -0.02);
      pKeyShape.lineTo(kL - wedgeW, -g.keyDepth);
      pKeyShape.lineTo(kL + draft - 0.01, -g.keyDepth);
      pKeyShape.closePath();
      const pKeyGeom = new THREE.ShapeGeometry(pKeyShape);
      pKeyGeom.translate(0, 0, zKeyFx);
      const pKeyMesh = new THREE.Mesh(pKeyGeom, this._materials.shearKeyPassiveFill);
      pKeyMesh.renderOrder = 11;
      this.forcesGroup.add(pKeyMesh);

      // 突起前面を押すシアン青緑の受働抵抗矢印 2 本（+X 方向＝滑動に抵抗）
      const keyArrowYs = [-g.keyDepth * 0.42, -g.keyDepth * 0.78];
      for (const ky of keyArrowYs) {
        const kArrow = buildArrowMesh(
          new THREE.Vector3(kL - wedgeW - 0.24, ky, zKeyFx + 0.02),
          new THREE.Vector3(kL - 0.02, ky, zKeyFx + 0.02),
          0.028,
          0.082,
          0.19,
          this._materials.shearKeyPassiveArrow
        );
        if (kArrow) {
          kArrow.renderOrder = 13;
          this.forcesGroup.add(kArrow);
        }
      }
    }

    // 上向き地盤反力矢印群
    const spanC = Math.max(0.1, xContactEnd - xContactStart);
    const nBArr = clamp(Math.round(spanC / 0.45), 3, 7);
    const zMidB = zPrism + prismD * 0.5;
    for (let i = 0; i < nBArr; i++) {
      const f = (i + 0.5) / nBArr;
      const x = xContactStart + f * spanC;
      const yBot = yLeft + (yRight - yLeft) * f;
      if (Math.abs(yBot) < 0.16) continue;
      const arrow = buildArrowMesh(
        new THREE.Vector3(x, yBot + 0.03, zMidB),
        new THREE.Vector3(x, -0.02, zMidB),
        0.024,
        0.072,
        0.16,
        bArrMat
      );
      if (arrow) {
        arrow.renderOrder = 10;
        this.forcesGroup.add(arrow);
      }
    }

    // 許容支持力度 qaAllow の破線基準ライン
    const yQa = -qaAllow * qScale;
    const qaLineGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.28, yQa, zPrism + prismD + 0.03),
      new THREE.Vector3(g.B + 0.28, yQa, zPrism + prismD + 0.03),
    ]);
    const qaLine = new THREE.Line(qaLineGeom, this._materials.qaDashLine);
    qaLine.computeLineDistances();
    qaLine.renderOrder = 10;
    this.forcesGroup.add(qaLine);

    // 三角形分布時：浮き上がり非接地ゾーン明示（赤ハッチング警戒帯）
    if (isTriangular && contactLen < g.B - 0.03) {
      const gapW = g.B - contactLen;
      const gapH = 0.18;
      const gapCenterX = isToeUplift ? gapW * 0.5 : contactLen + gapW * 0.5;
      const gapGeom = new THREE.BoxGeometry(gapW, gapH, prismD + 0.04);
      const gapMesh = new THREE.Mesh(gapGeom, this._materials.cautionZone);
      gapMesh.position.set(gapCenterX, -gapH * 0.5 - 0.01, zPrism + prismD * 0.5);
      gapMesh.renderOrder = 9;
      this.forcesGroup.add(gapMesh);

      const gapEdge = new THREE.LineSegments(
        new THREE.EdgesGeometry(gapGeom),
        this._materials.bearingNgEdge
      );
      gapEdge.position.copy(gapMesh.position);
      gapEdge.renderOrder = 10;
      this.forcesGroup.add(gapEdge);
    }

    // 地下水あり時の底面揚圧力 U の三角形表示（シアン色、かかと側ピーク）
    const U_uplift = Number(r?.forces?.U_uplift ?? 0);
    if (g.waterRatio > 0.001 && (U_uplift > 0.1 || yWater > 0.05)) {
      const pUHeel = GAMMA_W * yWater * 0.65;
      const yU = -clamp(pUHeel * qScale * 1.4, 0.16, 0.95);
      const uShape = new THREE.Shape();
      uShape.moveTo(0, 0);
      uShape.lineTo(g.B, 0);
      uShape.lineTo(g.B, yU);
      uShape.closePath();
      const uGeom = new THREE.ShapeGeometry(uShape);
      uGeom.translate(0, 0, zPrism + prismD + 0.02);
      const uMesh = new THREE.Mesh(uGeom, this._materials.waterPrismFill);
      uMesh.renderOrder = 9;
      this.forcesGroup.add(uMesh);
    }

    // ------------------------------------------------------------------------
    // 7-4. ミドルサード (B/6) 内核帯 ＆ 合力作用点ピン (d, e)
    // ------------------------------------------------------------------------
    const zKern = zPrism + prismD + 0.07;
    const eLimit = Number(ovt?.eLimit ?? (g.isSeismic ? g.B / 3 : g.B / 6));
    const dActual = Number(ovt?.d ?? g.B * 0.45);
    const ovtOk = ovt ? Boolean(ovt.ok) : true;

    // 底版全幅ベースレール (0 .. B)
    const railGeom = new THREE.BoxGeometry(g.B, 0.036, 0.036);
    const railMesh = new THREE.Mesh(railGeom, this._materials.baseRail);
    railMesh.position.set(g.B * 0.5, 0.0, zKern);
    this.forcesGroup.add(railMesh);

    // 許容内核帯 (常時 [B/3, 2B/3], 地震時 [B/6, 5B/6])
    const kernW = clamp(eLimit * 2, 0.1, g.B);
    const kernGeom = new THREE.BoxGeometry(kernW, 0.1, 0.065);
    const kernMesh = new THREE.Mesh(kernGeom, this._materials.kernBand);
    kernMesh.position.set(g.B * 0.5, 0.0, zKern);
    kernMesh.renderOrder = 10;
    this.forcesGroup.add(kernMesh);

    // 中央 (B/2) ＆ 内核端ティックマーク
    const tickPositions = [g.B * 0.5 - eLimit, g.B * 0.5, g.B * 0.5 + eLimit];
    for (let i = 0; i < tickPositions.length; i++) {
      const tx = tickPositions[i];
      const th = i === 1 ? 0.22 : 0.17;
      const tGeom = new THREE.BoxGeometry(0.026, th, 0.08);
      const tMesh = new THREE.Mesh(tGeom, this._materials.baseRail);
      tMesh.position.set(tx, 0.0, zKern);
      this.forcesGroup.add(tMesh);
    }

    // 合力作用点ピン（OK: 緑、NG: 赤）＋傾斜合力ベクトル矢印
    const dVis = clamp(Number.isFinite(dActual) ? dActual : -0.25, -0.35, g.B + 0.35);
    const pinMat = ovtOk ? this._materials.pinOk : this._materials.pinNg;

    const pinGeom = new THREE.OctahedronGeometry(0.115, 0);
    const pinMesh = new THREE.Mesh(pinGeom, pinMat);
    pinMesh.position.set(dVis, 0.0, zKern + 0.05);
    pinMesh.renderOrder = 12;
    this.forcesGroup.add(pinMesh);

    // 合力傾斜矢印 (sumH / sumV の物理傾斜角で作用点 d へ突き刺す)
    const sumV = Math.max(1, Number(r?.forces?.sumV ?? 200));
    const sumH = Math.max(0, Number(r?.forces?.sumH ?? 65));
    const incAngle = clamp(Math.atan2(sumH, sumV), 0, 0.72);
    const rLen = 1.05;
    const rArrow = buildArrowMesh(
      new THREE.Vector3(dVis + Math.sin(incAngle) * rLen, Math.cos(incAngle) * rLen, zKern + 0.05),
      new THREE.Vector3(dVis, 0.09, zKern + 0.05),
      0.036,
      0.105,
      0.24,
      pinMat
    );
    if (rArrow) {
      rArrow.renderOrder = 12;
      this.forcesGroup.add(rArrow);
    }

    // 偏心距離 e の水平ブラケット線（B/2 -> dVis）
    if (Math.abs(dVis - g.B * 0.5) > 0.04) {
      const eLineGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(g.B * 0.5, 0.16, zKern + 0.04),
        new THREE.Vector3(dVis, 0.16, zKern + 0.04),
      ]);
      const eLine = new THREE.Line(
        eLineGeom,
        ovtOk ? this._materials.bearingOkEdge : this._materials.bearingNgEdge
      );
      eLine.renderOrder = 11;
      this.forcesGroup.add(eLine);
    }
  }

  // ==========================================================================
  // 8. 破壊挙動プレビューエフェクト ＆ アニメーション制御
  // ==========================================================================

  _isFailureActive() {
    return Boolean(
      this.options.showFailureAnim &&
        this._result &&
        this._result.overall &&
        !this._result.overall.ok &&
        this._result.overall.primaryFailure &&
        this._result.overall.primaryFailure !== 'none'
    );
  }

  _resetWallPose() {
    this.wallGroup.position.set(0, 0, 0);
    this.wallGroup.rotation.set(0, 0, 0);
    this.leanConcGroup.position.set(0, 0, 0);
    this.leanConcGroup.rotation.set(0, 0, 0);
  }

  _computeFailureWave(t) {
    // 0 -> 0.45: 滑らかに破壊変位へ移行, 0.45 -> 0.72: ピーク保持, 0.72 -> 1.0: 原位置復帰
    if (t < 0.45) {
      const u = t / 0.45;
      return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
    }
    if (t < 0.72) {
      return 1.0 + 0.018 * Math.sin((t - 0.45) * 44);
    }
    const u = (t - 0.72) / 0.28;
    return 1 - (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
  }

  _rebuildFailureFx() {
    clearGroupGeometries(this.failureFxGroup);
    this._failureHandles = {
      mode: 'none',
      slideArrows: null,
      upliftWedge: null,
      overturnBackShadow: null,
      heaveMound: null,
      pivotRing: null,
      overturnArc: null,
      slipBand: null,
      crackGap: null,
      frontPushBand: null,
      bearingArc: null,
    };

    if (!this._isFailureActive()) {
      this.failureFxGroup.visible = false;
      return;
    }

    const g = this._geom;
    const mode = this._result.overall.primaryFailure;
    this._failureHandles.mode = mode;
    this.failureFxGroup.visible = true;

    if (mode === 'sliding') {
      // --- 滑動破壊 FX (M-8): 底面すべり赤バンド＋水平赤矢印＋V字引張亀裂ウェッジ＋前面土押し出し警告帯 ---
      const slipBandGeom = new THREE.BoxGeometry(g.B + 0.55, 0.052, L_Z + 0.14);
      const slipBand = new THREE.Mesh(slipBandGeom, this._materials.failureWedge);
      slipBand.position.set(g.B * 0.5 - 0.18, -0.025, 0);
      slipBand.renderOrder = 10;
      this.failureFxGroup.add(slipBand);
      this._failureHandles.slipBand = slipBand;

      const arrowsGrp = new THREE.Group();
      const nA = 3;
      for (let i = 0; i < nA; i++) {
        const ax = g.B * (0.28 + i * 0.28);
        const arr = buildArrowMesh(
          new THREE.Vector3(ax + 0.42, -0.05, FRONT_Z + 0.14),
          new THREE.Vector3(ax - 0.34, -0.05, FRONT_Z + 0.14),
          0.036,
          0.105,
          0.24,
          this._materials.failureRedGlow
        );
        if (arr) arrowsGrp.add(arr);
      }
      this.failureFxGroup.add(arrowsGrp);
      this._failureHandles.slideArrows = arrowsGrp;

      // M-8: 真っ黒直方体を廃止し、たて壁背面テーパーに沿った上部が広がる V 字開口ウェッジ（暗褐色グラデ＋赤警告縁取り）
      const stemH = Math.max(0.5, g.H - g.t_base);
      const taperDx = g.x_back_bot - g.x_back_top;
      const taperLen = Math.hypot(taperDx, stemH);
      const taperAngle = Math.atan2(taperDx, stemH);

      const vShape = new THREE.Shape();
      vShape.moveTo(0, 0);
      vShape.lineTo(0, taperLen);
      vShape.lineTo(-1.0, taperLen);
      vShape.lineTo(-0.18, 0);
      vShape.closePath();

      const vGeom = new THREE.ExtrudeGeometry(vShape, { depth: L_Z - 0.024, bevelEnabled: false });
      vGeom.translate(0, 0, BACK_Z + 0.012);
      // 暗褐色グラデーションが底→天端で自然に掛かるよう UV を正規化
      const vPos = vGeom.attributes.position;
      const vUv = new Float32Array(vPos.count * 2);
      for (let i = 0; i < vPos.count; i++) {
        vUv[i * 2] = clamp(-vPos.getX(i), 0, 1);
        vUv[i * 2 + 1] = clamp(vPos.getY(i) / Math.max(0.1, taperLen), 0, 1);
      }
      vGeom.setAttribute('uv', new THREE.BufferAttribute(vUv, 2));

      const crackGrp = new THREE.Group();
      const crackMesh = new THREE.Mesh(vGeom, this._materials.failureCrackV);
      crackMesh.renderOrder = 8;
      crackGrp.add(crackMesh);

      // 手前断面の赤警告 V 字アウトライン
      const vOutPts = [
        new THREE.Vector3(-0.18, 0, FRONT_Z + 0.025),
        new THREE.Vector3(-1.0, taperLen, FRONT_Z + 0.025),
        new THREE.Vector3(0, taperLen, FRONT_Z + 0.025),
        new THREE.Vector3(0, 0, FRONT_Z + 0.025),
      ];
      const vOutLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(vOutPts),
        this._materials.failureCrackEdge
      );
      vOutLine.renderOrder = 11;
      crackGrp.add(vOutLine);

      crackGrp.position.set(g.x_back_bot + 0.008, g.t_base + 0.008, 0);
      crackGrp.rotation.z = taperAngle;
      crackGrp.scale.x = 0.001;
      this.failureFxGroup.add(crackGrp);
      this._failureHandles.crackGap = crackGrp;

      // M-8: つま先前面の赤警告押し出し帯（前面土への受働圧縮を示し貫通感を解消）
      const pushW = 0.72;
      const pushH = Math.max(0.28, g.t_base + 0.08);
      const pushShape = new THREE.Shape();
      pushShape.moveTo(0, 0);
      pushShape.lineTo(-pushW, 0);
      pushShape.quadraticCurveTo(-pushW * 0.55, pushH * 1.15, 0, pushH);
      pushShape.closePath();
      const pushGeom = extrudeXYShape(pushShape, L_Z + 0.03, BACK_Z - 0.015, 1.4, 1.4);
      const pushGrp = new THREE.Group();
      const pushMesh = new THREE.Mesh(pushGeom, this._materials.failurePushFront);
      pushMesh.renderOrder = 10;
      pushGrp.add(pushMesh);

      const pushEdge = new THREE.LineSegments(
        new THREE.EdgesGeometry(pushGeom, 25),
        this._materials.failureCrackEdge
      );
      pushEdge.renderOrder = 11;
      pushGrp.add(pushEdge);

      pushGrp.position.set(-0.02, 0, 0);
      pushGrp.scale.set(0.001, 0.001, 1);
      this.failureFxGroup.add(pushGrp);
      this._failureHandles.frontPushBand = pushGrp;
    } else if (mode === 'overturning') {
      // --- 転倒破壊 FX (M-9): つま先回転支点リング＋かかと浮き上がり隙間ウェッジ＋背面剥離影＋天端回転赤矢印 ---
      const pivotGeom = new THREE.TorusGeometry(0.15, 0.03, 12, 28);
      const pivotRing = new THREE.Mesh(pivotGeom, this._materials.failureRedGlow);
      pivotRing.position.set(0, 0, FRONT_Z + 0.12);
      pivotRing.renderOrder = 12;
      this.failureFxGroup.add(pivotRing);
      this._failureHandles.pivotRing = pivotRing;

      // かかと底面の浮き上がり隙間ウェッジ（polygonOffset 付きで Z-fighting ゼロ）
      const wedgeShape = new THREE.Shape();
      wedgeShape.moveTo(0, 0);
      wedgeShape.lineTo(g.B, 0);
      wedgeShape.lineTo(g.B, 1.0);
      wedgeShape.closePath();
      const wedgeGeom = new THREE.ExtrudeGeometry(wedgeShape, { depth: L_Z + 0.02, bevelEnabled: false });
      wedgeGeom.translate(0, 0, BACK_Z - 0.01);
      const wedgeMesh = new THREE.Mesh(wedgeGeom, this._materials.failureWedge);
      wedgeMesh.scale.y = 0.001;
      wedgeMesh.renderOrder = 10;
      this.failureFxGroup.add(wedgeMesh);
      this._failureHandles.upliftWedge = wedgeMesh;

      // M-9: たて壁背面が前傾離間した際の暗褐色V字剥離影（道路下面の不自然な白い空洞露出を防止）
      const stemH = Math.max(0.5, g.H - g.t_base);
      const taperDx = g.x_back_bot - g.x_back_top;
      const taperLen = Math.hypot(taperDx, stemH);
      const taperAngle = Math.atan2(taperDx, stemH);

      const ovShadowShape = new THREE.Shape();
      ovShadowShape.moveTo(0, 0);
      ovShadowShape.lineTo(0, taperLen);
      ovShadowShape.lineTo(-1.0, taperLen);
      ovShadowShape.lineTo(-0.04, 0);
      ovShadowShape.closePath();
      const ovShadowGeom = new THREE.ExtrudeGeometry(ovShadowShape, {
        depth: L_Z - 0.024,
        bevelEnabled: false,
      });
      ovShadowGeom.translate(0, 0, BACK_Z + 0.012);
      const ovPos = ovShadowGeom.attributes.position;
      const ovUv = new Float32Array(ovPos.count * 2);
      for (let i = 0; i < ovPos.count; i++) {
        ovUv[i * 2] = clamp(-ovPos.getX(i), 0, 1);
        ovUv[i * 2 + 1] = clamp(ovPos.getY(i) / Math.max(0.1, taperLen), 0, 1);
      }
      ovShadowGeom.setAttribute('uv', new THREE.BufferAttribute(ovUv, 2));
      const ovShadowMesh = new THREE.Mesh(ovShadowGeom, this._materials.failureCrackV);
      ovShadowMesh.position.set(g.x_back_bot + 0.008, g.t_base + 0.008, 0);
      ovShadowMesh.rotation.z = taperAngle;
      ovShadowMesh.scale.x = 0.001;
      ovShadowMesh.renderOrder = 7;
      this.failureFxGroup.add(ovShadowMesh);
      this._failureHandles.overturnBackShadow = ovShadowMesh;

      // 天端付近の転倒方向アーク矢印
      const arcGrp = new THREE.Group();
      const arcPts = [];
      const rad = 1.02;
      for (let i = 0; i <= 18; i++) {
        const a = 0.15 + (i / 18) * 0.85;
        arcPts.push(
          new THREE.Vector3(
            g.x_front - Math.sin(a) * rad + 0.2,
            g.H + Math.cos(a) * rad * 0.65 - 0.15,
            FRONT_Z + 0.15
          )
        );
      }
      const arcCurve = new THREE.CatmullRomCurve3(arcPts);
      const tubeGeom = new THREE.TubeGeometry(arcCurve, 20, 0.032, 10, false);
      arcGrp.add(new THREE.Mesh(tubeGeom, this._materials.failureRedGlow));

      const lastPt = arcPts[arcPts.length - 1];
      const prevPt = arcPts[arcPts.length - 2];
      const tipArrow = buildArrowMesh(
        prevPt,
        lastPt.clone().add(new THREE.Vector3().subVectors(lastPt, prevPt).normalize().multiplyScalar(0.22)),
        0.032,
        0.1,
        0.24,
        this._materials.failureRedGlow
      );
      if (tipArrow) arcGrp.add(tipArrow);
      this.failureFxGroup.add(arcGrp);
      this._failureHandles.overturnArc = arcGrp;
    } else if (mode === 'bearing') {
      // --- 支持力不足 FX (M-10): つま先めり込み＋前面地盤せん断隆起マウンド＋ブロック内収容すべり円弧 ---
      const maxFrontAvail = Math.max(1.8, -g.X_min - 0.55);
      const heaveW = Math.min(2.15, maxFrontAvail);
      const heaveShape = new THREE.Shape();
      heaveShape.moveTo(-heaveW, 0);
      heaveShape.quadraticCurveTo(-heaveW * 0.48, 1.0, -0.02, 0.12);
      heaveShape.lineTo(-0.02, 0);
      heaveShape.closePath();

      const heaveGeom = extrudeXYShape(heaveShape, L_Z - 0.02, BACK_Z + 0.01, 0.35, 0.35);
      const heaveMesh = new THREE.Mesh(heaveGeom, this._materials.grass);
      heaveMesh.position.set(0, g.t_base - 0.01, 0);
      heaveMesh.scale.y = 0.001;
      heaveMesh.castShadow = true;
      heaveMesh.receiveShadow = true;
      this.failureFxGroup.add(heaveMesh);
      this._failureHandles.heaveMound = heaveMesh;

      // M-10: プランドトルすべり円弧の出口 X を必ず X_min + 0.40 以内に収容＆チューブ半径 0.026 へ洗練
      const xExitLimit = g.X_min + 0.65;
      const xExit = clamp(-heaveW * 0.88, xExitLimit, -1.45);
      const yDeep = Math.max(g.Y_bot + 0.65, -Math.min(1.08, 0.27 * g.H));
      const slipPts = [
        new THREE.Vector3(Math.min(g.B * 0.44, 1.15), -0.04, FRONT_Z + 0.09),
        new THREE.Vector3(0.08, yDeep * 0.72, FRONT_Z + 0.09),
        new THREE.Vector3(xExit * 0.4, yDeep, FRONT_Z + 0.09),
        new THREE.Vector3(xExit * 0.8, yDeep * 0.44, FRONT_Z + 0.09),
        new THREE.Vector3(xExit, g.t_base - 0.02, FRONT_Z + 0.09),
      ];
      const slipCurve = new THREE.CatmullRomCurve3(slipPts);
      const slipTube = new THREE.TubeGeometry(slipCurve, 28, 0.026, 10, false);
      const bearingArc = new THREE.Group();
      bearingArc.add(new THREE.Mesh(slipTube, this._materials.failureRedGlow));

      // 隆起出口の上向きせん断矢印（出口矢印先端も X_min + 0.40 以内に厳密保持）
      const pEnd = slipPts[slipPts.length - 1];
      const pPrev = slipPts[slipPts.length - 2];
      const arrowTipX = Math.max(g.X_min + 0.45, pEnd.x - 0.14);
      const heaveArrow = buildArrowMesh(
        pPrev,
        new THREE.Vector3(arrowTipX, pEnd.y + 0.22, FRONT_Z + 0.09),
        0.026,
        0.084,
        0.2,
        this._materials.failureRedGlow
      );
      if (heaveArrow) bearingArc.add(heaveArrow);

      // つま先めり込み下向き矢印
      const punchArrow = buildArrowMesh(
        new THREE.Vector3(0.18, g.t_base + 0.62, FRONT_Z + 0.14),
        new THREE.Vector3(0.18, -0.08, FRONT_Z + 0.14),
        0.032,
        0.096,
        0.22,
        this._materials.failureRedGlow
      );
      if (punchArrow) bearingArc.add(punchArrow);

      this.failureFxGroup.add(bearingArc);
      this._failureHandles.bearingArc = bearingArc;
    }
  }

  _syncFailurePose(amp) {
    if (!this._isFailureActive()) {
      this._resetWallPose();
      this.failureFxGroup.visible = false;
      return;
    }

    const g = this._geom;
    const severity = clamp(Number(this._result?.overall?.severity ?? 0.6), 0.25, 1.0);
    const mode = this._failureHandles.mode;
    const a = Math.max(0, amp);

    if (mode === 'sliding') {
      // M-8: 誇張しすぎない自然な滑動変位量 (0.21..0.32m)
      const slideDist = a * (0.17 + 0.15 * severity);
      this.wallGroup.position.set(-slideDist, 0, 0);
      this.wallGroup.rotation.set(0, 0, 0);
      this.leanConcGroup.position.set(0, 0, 0);
      this.leanConcGroup.rotation.set(0, 0, 0);

      if (this._failureHandles.slideArrows) {
        this._failureHandles.slideArrows.position.x = -slideDist * 0.65;
      }
      if (this._failureHandles.crackGap) {
        this._failureHandles.crackGap.scale.x = Math.max(0.001, slideDist);
      }
      if (this._failureHandles.frontPushBand) {
        const sx = Math.max(0.001, 0.35 + a * 0.72);
        const sy = Math.max(0.001, 0.3 + a * 0.85);
        this._failureHandles.frontPushBand.position.x = -slideDist - 0.01;
        this._failureHandles.frontPushBand.scale.set(sx, sy, 1);
      }
    } else if (mode === 'overturning') {
      // M-9: 視覚的に明快かつかかと〜砕石干渉のない洗練された転倒傾き角 (3.4°..6.0°)
      const tiltRad = a * (0.052 + 0.052 * severity);
      this.wallGroup.position.set(0, 0, 0);
      this.wallGroup.rotation.set(0, 0, tiltRad);
      this.leanConcGroup.position.set(0, 0, 0);
      this.leanConcGroup.rotation.set(0, 0, 0);

      if (this._failureHandles.upliftWedge) {
        this._failureHandles.upliftWedge.scale.y = Math.max(0.001, g.B * Math.sin(tiltRad));
      }
      if (this._failureHandles.overturnBackShadow) {
        this._failureHandles.overturnBackShadow.scale.x = Math.max(
          0.001,
          (g.H - g.t_base) * Math.sin(tiltRad) * 0.92
        );
      }
      if (this._failureHandles.pivotRing) {
        const s = 1.0 + 0.16 * Math.sin(this._elapsed * 6.0);
        this._failureHandles.pivotRing.scale.set(s, s, 1);
      }
    } else if (mode === 'bearing') {
      // M-10: つま先めり込み沈下＋均しコンクリートも底版直下へ自然追従（貫通ゼロ）
      const sinkY = a * (0.14 + 0.18 * severity);
      const tiltRad = a * (0.04 + 0.045 * severity);
      const xP = g.B * 0.72;
      this.wallGroup.rotation.set(0, 0, tiltRad);
      this.wallGroup.position.set(
        xP * (1 - Math.cos(tiltRad)),
        -sinkY - xP * Math.sin(tiltRad) * 0.48,
        0
      );
      this.leanConcGroup.position.copy(this.wallGroup.position);
      this.leanConcGroup.rotation.copy(this.wallGroup.rotation);

      if (this._failureHandles.heaveMound) {
        this._failureHandles.heaveMound.scale.y = Math.max(0.001, a * (0.28 + 0.22 * severity));
      }
    }
  }

  // ==========================================================================
  // 9. 60fps マイクロアニメーション（排水滴り・地下水シマー・詰まり警戒パルス）
  // ==========================================================================

  _updateMicroAnimations(dt) {
    // 健全水抜き孔からの自然な水滴落下
    for (const drop of this._dripDrops) {
      const ud = drop.userData;
      ud.phase = (ud.phase + dt * ud.speed) % 1.0;
      const p = ud.phase;
      const y = ud.topY - p * p * Math.max(0.15, ud.topY - ud.botY);
      drop.position.set(ud.baseX - p * 0.05, y, drop.position.z);
      const sc = p < 0.15 ? p / 0.15 : p > 0.88 ? (1 - p) / 0.12 : 1.0;
      drop.scale.setScalar(Math.max(0.05, sc));
    }

    // 地下水面シマー
    for (const wm of this._waterShimmerMeshes) {
      if (wm.material) {
        const base = wm.userData.baseOpacity ?? 0.36;
        wm.material.opacity = base + 0.045 * Math.sin(this._elapsed * 2.4);
      }
    }

    // 詰まり赤キャップの警戒ハローパルス
    for (const ring of this._clogPulseMeshes) {
      const pulse = 0.5 + 0.5 * Math.sin(this._elapsed * 4.5 + (ring.userData.phase || 0));
      const s = 0.92 + pulse * 0.34;
      ring.scale.set(s, s, 1);
      if (ring.material) {
        ring.material.opacity = 0.35 + pulse * 0.5;
      }
    }

    // 地震時慣性力矢印の微脈動
    for (const sArrow of this._seismicPulseMeshes) {
      const sc = 1.0 + 0.045 * Math.sin(this._elapsed * 7.0);
      sArrow.scale.set(sc, sc, sc);
    }
  }
}
