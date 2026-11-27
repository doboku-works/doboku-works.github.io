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
    bgColor: 0xdde9f7,
    fogColor: 0xdde9f7,
    fogNear: 64,
    fogFar: 175,
    exposure: 1.05,
    hemiSky: 0xe6f2ff,
    hemiGround: 0x8f806e,
    hemiInt: 0.82,
    keyInt: 1.54,
    fillInt: 0.46,
    rimInt: 0.44,
    floorColor: 0xdce5f0,
    gridMain: 0xb0bfcf,
    gridSub: 0xcbd6e4,
    plinthColor: 0x24303f,
    wallEdgeColor: 0x334155,
    wallEdgeOpacity: 0.22,
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
 * bevelOpts 指定時は Z 方向のはみ出しを防ぎつつ面取りエッジを付与。
 */
function extrudeXYShape(
  shape,
  depth,
  zStart,
  scaleU = 0.28,
  scaleV = 0.28,
  uvMode = 'triplanar',
  bevelOpts = null
) {
  let geom;
  if (bevelOpts && bevelOpts.enabled) {
    const bt = Math.min(bevelOpts.thickness ?? 0.01, depth * 0.25);
    const bs = bevelOpts.size ?? 0.009;
    const innerDepth = Math.max(0.02, depth - bt * 2);
    geom = new THREE.ExtrudeGeometry(shape, {
      depth: innerDepth,
      bevelEnabled: true,
      bevelThickness: bt,
      bevelSize: bs,
      bevelSegments: bevelOpts.segments ?? 1,
      curveSegments: 8,
    });
    geom.translate(0, 0, zStart + bt);
  } else {
    geom = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: false,
      curveSegments: 8,
    });
    geom.translate(0, 0, zStart);
  }
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

  // わずかな雨水縦すじ・白華（エフロレッセンス）＆打設リフト陰影
  for (let r = 0; r < rows; r += 2) {
    const ly = r * ph;
    const liftGrad = dCtx.createLinearGradient(0, ly, 0, ly + 22);
    liftGrad.addColorStop(0, 'rgba(48,56,68,0.12)');
    liftGrad.addColorStop(1, 'rgba(48,56,68,0)');
    dCtx.fillStyle = liftGrad;
    dCtx.fillRect(0, ly, size, 22);
  }
  for (let i = 0; i < 42; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const h = 55 + rng() * 195;
    const isEfflo = rng() > 0.78;
    const g = dCtx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, isEfflo ? 'rgba(246,249,254,0.12)' : 'rgba(62,72,86,0.11)');
    g.addColorStop(1, 'rgba(62,72,86,0)');
    dCtx.fillStyle = g;
    dCtx.fillRect(x, y, 2 + rng() * 5, h);
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

  // うねる地層・転圧バンド（基礎地盤: 自然地層理、背面盛土: 30cm転圧リフト層理）
  const bands = isSubsoil ? 18 : 26;
  for (let b = 0; b < bands; b++) {
    const yBase = (b / bands) * size;
    const bandH = (size / bands) * (isSubsoil ? 0.5 + rng() * 0.75 : 0.42 + rng() * 0.55);
    const amp = isSubsoil ? 5 + rng() * 13 : 1.5 + rng() * 3.8;
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
        ? 'rgba(168,142,114,0.18)'
        : 'rgba(38,29,21,0.22)'
      : light
      ? 'rgba(228,198,154,0.20)'
      : 'rgba(92,66,38,0.17)';
    dCtx.fill();

    // 締固め層境・地層境界の細いアクセント線
    dCtx.strokeStyle = isSubsoil ? 'rgba(42,32,23,0.18)' : 'rgba(84,58,34,0.14)';
    dCtx.lineWidth = isSubsoil ? 1.6 : 1.1;
    dCtx.beginPath();
    for (let x = 0; x <= size; x += 32) {
      const y = yBase + Math.sin((x / size) * freq + phase) * amp;
      if (x === 0) dCtx.moveTo(x, y);
      else dCtx.lineTo(x, y);
    }
    dCtx.stroke();
  }

  // 基礎地盤の砂礫・支持層境界（下部ほど密実な暗褐色砂礫層を表現）
  if (isSubsoil) {
    const deepStratum = dCtx.createLinearGradient(0, size * 0.56, 0, size);
    deepStratum.addColorStop(0, 'rgba(40,32,26,0)');
    deepStratum.addColorStop(0.35, 'rgba(45,38,32,0.16)');
    deepStratum.addColorStop(1, 'rgba(28,24,22,0.28)');
    dCtx.fillStyle = deepStratum;
    dCtx.fillRect(0, size * 0.56, size, size * 0.44);
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
 * 4. 背面道路アスファルト舗装＋外側線・破線白線＋微細骨材バンプマップ
 */
function generateRoadTextures(aniso) {
  const size = 512;
  const dCanvas = makeCanvas(size, size);
  const rCanvas = makeCanvas(size, size);
  const bCanvas = makeCanvas(size, size);
  const dCtx = dCanvas.getContext('2d');
  const rCtx = rCanvas.getContext('2d');
  const bCtx = bCanvas.getContext('2d');
  const rng = mulberry32(30917);

  dCtx.fillStyle = '#383e47';
  dCtx.fillRect(0, 0, size, size);
  rCtx.fillStyle = '#d2d2d2';
  rCtx.fillRect(0, 0, size, size);
  bCtx.fillStyle = '#808080';
  bCtx.fillRect(0, 0, size, size);

  // 路肩際（側溝付近）のわずかな砂埃グラデーション
  const shoulderDust = dCtx.createLinearGradient(0, 0, size * 0.14, 0);
  shoulderDust.addColorStop(0, 'rgba(138,132,122,0.22)');
  shoulderDust.addColorStop(1, 'rgba(138,132,122,0)');
  dCtx.fillStyle = shoulderDust;
  dCtx.fillRect(0, 0, size * 0.14, size);

  // 縦方向タイヤ走行帯の微妙な艶・濃淡
  const trackPositions = [0.28, 0.56, 0.82];
  for (const tp of trackPositions) {
    const gx = tp * size;
    const g = dCtx.createLinearGradient(gx - 38, 0, gx + 38, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, 'rgba(18,22,28,0.22)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    dCtx.fillStyle = g;
    dCtx.fillRect(gx - 38, 0, 76, size);

    const rg = rCtx.createLinearGradient(gx - 32, 0, gx + 32, 0);
    rg.addColorStop(0, 'rgba(0,0,0,0)');
    rg.addColorStop(0.5, 'rgba(145,145,145,0.48)');
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    rCtx.fillStyle = rg;
    rCtx.fillRect(gx - 32, 0, 64, size);
  }

  // アスファルト骨材微粒子＋凹凸バンプ
  for (let i = 0; i < 14000; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const s = 0.8 + rng() * 1.8;
    const v = rng();
    dCtx.fillStyle =
      v < 0.45
        ? 'rgba(20,24,30,0.42)'
        : v < 0.85
        ? 'rgba(98,106,118,0.34)'
        : 'rgba(154,162,174,0.24)';
    dCtx.fillRect(x, y, s, s);
    bCtx.fillStyle = v < 0.5 ? 'rgba(65,65,65,0.45)' : 'rgba(195,195,195,0.45)';
    bCtx.fillRect(x, y, s, s);
  }

  // ごく繊細な経年ヘアークラック（2本）
  dCtx.strokeStyle = 'rgba(18,20,24,0.32)';
  bCtx.strokeStyle = 'rgba(32,32,32,0.55)';
  dCtx.lineWidth = 1.0;
  bCtx.lineWidth = 1.2;
  for (let c = 0; c < 2; c++) {
    let cx = size * (0.24 + c * 0.36);
    let cy = rng() * size * 0.4;
    dCtx.beginPath();
    bCtx.beginPath();
    dCtx.moveTo(cx, cy);
    bCtx.moveTo(cx, cy);
    for (let s = 0; s < 14; s++) {
      cx += (rng() - 0.48) * 14;
      cy += 12 + rng() * 14;
      dCtx.lineTo(cx, cy);
      bCtx.lineTo(cx, cy);
    }
    dCtx.stroke();
    bCtx.stroke();
  }

  // 路肩外側線（左端寄りに連続白線 — u=0.065 付近）
  dCtx.fillStyle = 'rgba(244,247,250,0.90)';
  dCtx.fillRect(Math.floor(size * 0.065), 0, 12, size);

  // 車線中央破線（u=0.68 付近）
  dCtx.fillStyle = 'rgba(244,247,250,0.86)';
  for (let y = 24; y < size; y += 128) {
    dCtx.fillRect(Math.floor(size * 0.68), y, 10, 66);
  }

  // 白線の自然な微細かすれ
  for (let i = 0; i < 480; i++) {
    const x = rng() > 0.5 ? size * 0.065 + rng() * 12 : size * 0.68 + rng() * 10;
    const y = rng() * size;
    dCtx.fillStyle = 'rgba(56,62,71,0.38)';
    dCtx.fillRect(x, y, 2, 2);
  }

  return {
    map: finalizeTexture(dCanvas, { isColor: true, aniso }),
    roughnessMap: finalizeTexture(rCanvas, { isColor: false, aniso }),
    bumpMap: finalizeTexture(bCanvas, { isColor: false, aniso }),
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
 * 8. 晴天スカイドーム調・スタジオ背景テクスチャ（明: 澄んだ青空＋薄雲＋遠景山並み / 暗: ナイトスタジオ）
 */
function generateStudioBackdrop(topHex, midHex, botHex, isLight = true) {
  const w = 1024;
  const h = 512;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const rng = mulberry32(isLight ? 202607 : 90911);

  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0.0, topHex);
  g.addColorStop(0.46, midHex);
  g.addColorStop(0.74, isLight ? '#eef4fb' : midHex);
  g.addColorStop(1.0, botHex);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  if (isLight) {
    // 柔らかな太陽グロウ（左上空）
    const sunG = ctx.createRadialGradient(w * 0.24, h * 0.16, 10, w * 0.24, h * 0.16, w * 0.34);
    sunG.addColorStop(0, 'rgba(255,252,240,0.52)');
    sunG.addColorStop(0.45, 'rgba(255,248,232,0.18)');
    sunG.addColorStop(1, 'rgba(255,248,232,0)');
    ctx.fillStyle = sunG;
    ctx.fillRect(0, 0, w, h);

    // 淡く上品な巻雲・積雲ベール（ラベルの可読性を損なわない低コントラスト）
    for (let i = 0; i < 24; i++) {
      const cx = rng() * w;
      const cy = h * (0.10 + rng() * 0.36);
      const rx = 65 + rng() * 145;
      const ry = 14 + rng() * 28;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, ry / rx);
      const cg = ctx.createRadialGradient(0, 0, rx * 0.08, 0, 0, rx);
      cg.addColorStop(0, 'rgba(255,255,255,0.34)');
      cg.addColorStop(0.6, 'rgba(252,254,255,0.14)');
      cg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.arc(0, 0, rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 遠景の淡い山並みシルエット（大気遠近法で背景に奥行きを付与）
    const drawRidge = (baseY, amp, freq1, freq2, phase, fill) => {
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += 16) {
        const t = x / w;
        const y =
          baseY -
          Math.sin(t * Math.PI * freq1 + phase) * amp -
          Math.sin(t * Math.PI * freq2 + phase * 1.7) * (amp * 0.42);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    };
    drawRidge(h * 0.67, 22, 2.2, 5.4, 0.8, 'rgba(182, 200, 220, 0.32)');
    drawRidge(h * 0.72, 16, 3.1, 7.2, 2.3, 'rgba(194, 208, 224, 0.28)');

    // 地平線の柔らかな靄（下半分を自然なスタジオトーンへなじませる）
    const mistG = ctx.createLinearGradient(0, h * 0.62, 0, h);
    mistG.addColorStop(0, 'rgba(226,236,246,0)');
    mistG.addColorStop(0.45, 'rgba(222,232,243,0.68)');
    mistG.addColorStop(1, botHex);
    ctx.fillStyle = mistG;
    ctx.fillRect(0, h * 0.62, w, h * 0.38);
  } else {
    // ダークモード用：繊細な星空＋地平線ブルーグロウ
    for (let i = 0; i < 80; i++) {
      const x = rng() * w;
      const y = rng() * h * 0.55;
      const a = 0.15 + rng() * 0.45;
      ctx.fillStyle = `rgba(226,238,255,${a.toFixed(2)})`;
      ctx.fillRect(x, y, 1.5, 1.5);
    }
  }
  return finalizeTexture(c, { isColor: true, repeat: false, aniso: 1 });
}

/**
 * 8b. 車両直下のソフト接地影（コンタクトシャドウ）テクスチャ
 */
function generateCarShadowTexture() {
  const c = makeCanvas(128, 256);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 128, 256);
  ctx.save();
  ctx.translate(64, 128);
  ctx.scale(0.55, 1.0);
  const g = ctx.createRadialGradient(0, 0, 18, 0, 0, 112);
  g.addColorStop(0, 'rgba(8,12,18,0.62)');
  g.addColorStop(0.55, 'rgba(10,14,20,0.36)');
  g.addColorStop(0.85, 'rgba(12,16,22,0.12)');
  g.addColorStop(1, 'rgba(12,16,22,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, 112, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  return finalizeTexture(c, { isColor: true, repeat: false, aniso: 2 });
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

/**
 * 大型プレキャスト積みブロック用 割肌（擬石風）コンクリートテクスチャ（Pコン穴なし・立体石肌陰影）
 */
function generateBlockConcreteTextures(aniso) {
  const diff = makeCanvas(512, 512);
  const dctx = diff.getContext('2d');
  const bump = makeCanvas(512, 512);
  const bctx = bump.getContext('2d');

  // ベース：自然石調の温かみのあるプレキャスト石肌グレー
  dctx.fillStyle = '#c1c8d0';
  dctx.fillRect(0, 0, 512, 512);
  bctx.fillStyle = '#808080';
  bctx.fillRect(0, 0, 512, 512);

  const rng = mulberry32(62419);

  // 割肌ブロックの立体破断面ファセット（上面ハイライト＋下面シャドウで本物の石肌凹凸）
  for (let i = 0; i < 210; i++) {
    const cx = rng() * 512;
    const cy = rng() * 512;
    const rx = 18 + rng() * 48;
    const ry = 10 + rng() * 28;
    const shade = Math.floor(170 + rng() * 44);
    const bVal = Math.floor(72 + rng() * 116);
    const verts = 5 + Math.floor(rng() * 3);
    const relPts = [];
    for (let v = 0; v < verts; v++) {
      const a = (v / verts) * Math.PI * 2 + (rng() - 0.5) * 0.4;
      const rScale = 0.68 + rng() * 0.44;
      relPts.push([Math.cos(a) * rx * rScale, Math.sin(a) * ry * rScale]);
    }

    for (const [ox, oy] of [
      [0, 0],
      [512, 0],
      [-512, 0],
      [0, 512],
      [0, -512],
    ]) {
      const grad = dctx.createLinearGradient(cx + ox, cy + oy - ry, cx + ox, cy + oy + ry);
      grad.addColorStop(0, `rgba(${Math.min(245, shade + 24)}, ${Math.min(248, shade + 26)}, ${Math.min(252, shade + 28)}, 0.34)`);
      grad.addColorStop(0.55, `rgba(${shade}, ${shade + 2}, ${shade + 5}, 0.24)`);
      grad.addColorStop(1, `rgba(${Math.max(70, shade - 36)}, ${Math.max(74, shade - 34)}, ${Math.max(80, shade - 30)}, 0.32)`);

      dctx.beginPath();
      bctx.beginPath();
      for (let v = 0; v < verts; v++) {
        const px = cx + ox + relPts[v][0];
        const py = cy + oy + relPts[v][1];
        if (v === 0) {
          dctx.moveTo(px, py);
          bctx.moveTo(px, py);
        } else {
          dctx.lineTo(px, py);
          bctx.lineTo(px, py);
        }
      }
      dctx.closePath();
      bctx.closePath();
      dctx.fillStyle = grad;
      dctx.fill();
      dctx.strokeStyle = 'rgba(58,66,78,0.14)';
      dctx.lineWidth = 1.0;
      dctx.stroke();

      bctx.fillStyle = `rgba(${bVal}, ${bVal}, ${bVal}, 0.42)`;
      bctx.fill();
    }
  }

  // ごく控えめな自然風化（薄い苔・雨跡トーン）
  for (let i = 0; i < 28; i++) {
    const x = rng() * 512;
    const y = rng() * 512;
    const rad = 18 + rng() * 44;
    const g = dctx.createRadialGradient(x, y, 2, x, y, rad);
    g.addColorStop(0, rng() > 0.5 ? 'rgba(92,102,88,0.09)' : 'rgba(78,86,96,0.11)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    dctx.fillStyle = g;
    dctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }

  // 細かい砂岩・骨材ノイズ
  for (let i = 0; i < 5800; i++) {
    const x = rng() * 512;
    const y = rng() * 512;
    const sz = 1 + rng() * 2.2;
    const light = rng() > 0.5;
    dctx.fillStyle = light ? 'rgba(245,248,252,0.24)' : 'rgba(66,74,86,0.23)';
    dctx.fillRect(x, y, sz, sz);
    bctx.fillStyle = light ? 'rgba(218,218,218,0.28)' : 'rgba(48,48,48,0.28)';
    bctx.fillRect(x, y, sz, sz);
  }

  return {
    map: finalizeTexture(diff, { isColor: true, repeat: true, aniso }),
    bumpMap: finalizeTexture(bump, { isColor: false, repeat: true, aniso }),
  };
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
    this._wallMeshes = [];
    this._wallEdgeLines = [];
    this._wallAccentMeshes = [];
    this._courseGroups = [];
    this._capGroup = null;
    this._hasActiveCourseOffset = false;
    this._carBasePose = { x: 0, y: 0, rotZ: 0, visible: false };
    this._wedgeGeomMeta = null;
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
      roadCrackStrip: null,
      slipArrows: null,
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
    // 主働崩壊くさび一体グループ（裏込め砕石＋すべり面内盛土＋縁石＋クラック前方道路）
    this.activeWedgeGroup = new THREE.Group();
    this.waterGroup = new THREE.Group();
    this.surchargeGroup = new THREE.Group();
    this.forcesGroup = new THREE.Group();
    this.failureFxGroup = new THREE.Group();

    this.rootGroup.add(
      this.groundGroup,
      this.activeWedgeGroup,
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
    const blockConc = generateBlockConcreteTextures(aniso);
    const gravel = generateGravelTextures(aniso);
    const backfill = generateSoilTextures('backfill', aniso);
    const subsoil = generateSoilTextures('subsoil', aniso);
    const road = generateRoadTextures(aniso);
    const grass = generateGrassTextures(aniso);
    const leanConc = generateLeanConcreteTexture(aniso);
    const caution = generateCautionTexture(aniso);
    const crackGrad = generateCrackGradientTexture(aniso);

    const skyLight = generateStudioBackdrop('#9dc3ea', '#d0e2f5', '#cfdbe8', true);
    const skyDark = generateStudioBackdrop('#080e1d', '#131f36', '#0c1426', false);
    const carShadow = generateCarShadowTexture();

    this._textures = {
      concMap: conc.map,
      concBump: conc.bumpMap,
      concRough: conc.roughnessMap,
      blockConcMap: blockConc.map,
      blockConcBump: blockConc.bumpMap,
      gravelMap: gravel.map,
      gravelBump: gravel.bumpMap,
      backfillMap: backfill.map,
      backfillBump: backfill.bumpMap,
      subsoilMap: subsoil.map,
      subsoilBump: subsoil.bumpMap,
      roadMap: road.map,
      roadRough: road.roughnessMap,
      roadBump: road.bumpMap,
      grassMap: grass.map,
      grassBump: grass.bumpMap,
      leanConcMap: leanConc,
      cautionMap: caution,
      crackGrad,
      skyLight,
      skyDark,
      carShadow,
    };

    this._materials = {
      // RC擁壁（通常：打ち放しコンクリート）
      concreteOpaque: new THREE.MeshStandardMaterial({
        map: conc.map,
        bumpMap: conc.bumpMap,
        bumpScale: 0.026,
        roughnessMap: conc.roughnessMap,
        roughness: 0.84,
        metalness: 0.04,
      }),
      // L型RC 伸縮目地（誘発目地ストリップ）＆地際雨跳ね帯
      expansionJoint: new THREE.MeshStandardMaterial({
        color: 0x3b424d,
        roughness: 0.94,
        metalness: 0.02,
      }),
      wallDampBase: new THREE.MeshBasicMaterial({
        color: 0x3d3832,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
      }),
      // 大型積みブロック（割肌プレキャストコンクリート・3トーン自然な個体差）
      blockOpaque: new THREE.MeshStandardMaterial({
        map: blockConc.map,
        bumpMap: blockConc.bumpMap,
        bumpScale: 0.048,
        roughness: 0.89,
        metalness: 0.03,
      }),
      blockOpaqueA: new THREE.MeshStandardMaterial({
        map: blockConc.map,
        bumpMap: blockConc.bumpMap,
        bumpScale: 0.048,
        color: 0xf7f9fb,
        roughness: 0.88,
        metalness: 0.03,
      }),
      blockOpaqueB: new THREE.MeshStandardMaterial({
        map: blockConc.map,
        bumpMap: blockConc.bumpMap,
        bumpScale: 0.048,
        color: 0xe6ebf0,
        roughness: 0.90,
        metalness: 0.03,
      }),
      blockOpaqueC: new THREE.MeshStandardMaterial({
        map: blockConc.map,
        bumpMap: blockConc.bumpMap,
        bumpScale: 0.048,
        color: 0xefede8,
        roughness: 0.91,
        metalness: 0.02,
      }),
      // 大型ブロック 基礎・天端笠コンクリート（無筋コンクリート）
      blockCapConcrete: new THREE.MeshStandardMaterial({
        map: leanConc,
        color: 0xd0d7e0,
        roughness: 0.86,
        metalness: 0.03,
      }),
      // 大型ブロック 胴込めコンクリート充填コア（内部構造透視用）
      blockFillConc: new THREE.MeshStandardMaterial({
        map: leanConc,
        color: 0x94a3b8,
        roughness: 0.90,
        metalness: 0.04,
      }),
      // 大型ブロック間 噛み合わせキー・連結ピン（シアン青銅強調）
      interlockPin: new THREE.MeshStandardMaterial({
        color: 0x0ea5e9,
        emissive: 0x0369a1,
        emissiveIntensity: 0.42,
        roughness: 0.28,
        metalness: 0.65,
      }),
      // 主働すべり面・道路縦断クラック表示用マテリアル
      slipPlaneGlow: new THREE.MeshBasicMaterial({
        color: 0xdc2626,
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      slipDashLine: new THREE.LineDashedMaterial({
        color: 0xef4444,
        dashSize: 0.24,
        gapSize: 0.12,
        transparent: true,
        opacity: 0.95,
      }),
      roadCrackDark: new THREE.MeshStandardMaterial({
        color: 0x1e1b18,
        roughness: 0.96,
        metalness: 0.02,
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
      // 道路舗装・芝生・模型台座・道路付帯施設・植栽
      road: new THREE.MeshStandardMaterial({
        map: road.map,
        roughnessMap: road.roughnessMap,
        bumpMap: road.bumpMap,
        bumpScale: 0.016,
        roughness: 0.88,
        metalness: 0.04,
      }),
      guardrailPost: new THREE.MeshStandardMaterial({
        color: 0xb9c3ce,
        roughness: 0.38,
        metalness: 0.72,
      }),
      guardrailBeam: new THREE.MeshStandardMaterial({
        color: 0xf1f5f9,
        roughness: 0.34,
        metalness: 0.28,
      }),
      reflectorOrange: new THREE.MeshStandardMaterial({
        color: 0xf97316,
        emissive: 0xea580c,
        emissiveIntensity: 0.35,
        roughness: 0.22,
        metalness: 0.12,
      }),
      gutterGrate: new THREE.MeshStandardMaterial({
        color: 0x3b4450,
        roughness: 0.48,
        metalness: 0.68,
      }),
      geotextileLine: new THREE.LineDashedMaterial({
        color: 0xf8fafc,
        dashSize: 0.14,
        gapSize: 0.08,
        transparent: true,
        opacity: 0.85,
      }),
      treeTrunk: new THREE.MeshStandardMaterial({
        color: 0x6b5344,
        roughness: 0.94,
        metalness: 0.0,
      }),
      foliageDark: new THREE.MeshStandardMaterial({
        color: 0x456b3d,
        roughness: 0.88,
        metalness: 0.0,
      }),
      foliageLight: new THREE.MeshStandardMaterial({
        color: 0x628c4e,
        roughness: 0.85,
        metalness: 0.0,
      }),
      grassTuft: new THREE.MeshStandardMaterial({
        color: 0x567c46,
        roughness: 0.92,
        metalness: 0.0,
        side: THREE.DoubleSide,
      }),
      lampGlow: new THREE.MeshBasicMaterial({ color: 0xfefce8 }),
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
      // 現代日本仕様コンパクトSUV 乗用車用 PBR マテリアル
      carBody: new THREE.MeshPhysicalMaterial({
        color: 0x38618c,
        roughness: 0.22,
        metalness: 0.42,
        clearcoat: 0.92,
        clearcoatRoughness: 0.08,
      }),
      carCladding: new THREE.MeshStandardMaterial({
        color: 0x222933,
        roughness: 0.78,
        metalness: 0.06,
      }),
      carChrome: new THREE.MeshStandardMaterial({
        color: 0xe2e8f0,
        roughness: 0.16,
        metalness: 0.92,
      }),
      carPlate: new THREE.MeshStandardMaterial({
        color: 0xf8fafc,
        roughness: 0.42,
        metalness: 0.05,
      }),
      carGlass: new THREE.MeshPhysicalMaterial({
        color: 0x111c2d,
        roughness: 0.06,
        metalness: 0.28,
        clearcoat: 1.0,
        clearcoatRoughness: 0.04,
      }),
      carTrim: new THREE.MeshStandardMaterial({
        color: 0x1e2631,
        roughness: 0.48,
        metalness: 0.22,
      }),
      carTire: new THREE.MeshStandardMaterial({
        color: 0x181d24,
        roughness: 0.88,
        metalness: 0.04,
      }),
      carRim: new THREE.MeshStandardMaterial({
        color: 0xd8e1ea,
        roughness: 0.22,
        metalness: 0.84,
      }),
      carBrake: new THREE.MeshStandardMaterial({
        color: 0x64748b,
        roughness: 0.44,
        metalness: 0.78,
      }),
      carHeadlight: new THREE.MeshBasicMaterial({ color: 0xf8fafc }),
      carDrl: new THREE.MeshBasicMaterial({ color: 0xe0f2fe }),
      carTaillight: new THREE.MeshBasicMaterial({ color: 0xdc2626 }),
      carShadow: new THREE.MeshBasicMaterial({
        map: carShadow,
        transparent: true,
        opacity: 0.78,
        depthWrite: false,
      }),
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
   * リアルスケール現代コンパクトSUV（全長 4.24m × 全幅 1.78m × 全高 1.54m、+Z 方向前方）
   * クリアコートメタリック塗装・ベジエ流線型ボディ・SUV樹脂クラッディング＆オーバーフェンダー・
   * 5本スポークアルミホイール・マルチLEDライト・ルーフレール・接地コンタクトシャドウ
   */
  _createCarSilhouette() {
    const car = new THREE.Group();

    // 0. 車体直下ソフト接地影（コンタクトシャドウ：路面密着感を劇的向上）
    const shGeom = new THREE.PlaneGeometry(2.12, 4.55);
    shGeom.rotateX(-Math.PI * 0.5);
    const shMesh = new THREE.Mesh(shGeom, this._materials.carShadow);
    shMesh.position.set(0, 0.015, 0);
    shMesh.renderOrder = 2;
    car.add(shMesh);

    // 1. 下回りブラック樹脂クラッディング（SUV前後バンパー下部＆サイドロッカーパネル）
    const cladShape = new THREE.Shape();
    cladShape.moveTo(-2.06, 0.22);
    cladShape.lineTo(2.06, 0.22);
    cladShape.lineTo(2.12, 0.34);
    cladShape.lineTo(2.08, 0.43);
    cladShape.lineTo(-2.08, 0.43);
    cladShape.lineTo(-2.12, 0.33);
    cladShape.closePath();
    const cladW = 1.66;
    const cladGeom = new THREE.ExtrudeGeometry(cladShape, {
      depth: cladW,
      bevelEnabled: true,
      bevelThickness: 0.045,
      bevelSize: 0.03,
      bevelSegments: 2,
    });
    cladGeom.translate(0, 0, -cladW * 0.5);
    cladGeom.rotateY(-Math.PI * 0.5);
    const cladMesh = new THREE.Mesh(cladGeom, this._materials.carCladding);
    cladMesh.castShadow = true;
    cladMesh.receiveShadow = true;
    car.add(cladMesh);

    // 2. 流線型メタリックボディ下部（ウエストライン以下・柔らかなベジエ造形、+X -> +Z 前方）
    const lowerShape = new THREE.Shape();
    lowerShape.moveTo(-2.05, 0.36);
    lowerShape.lineTo(2.05, 0.36);
    lowerShape.quadraticCurveTo(2.13, 0.52, 2.08, 0.72);
    lowerShape.quadraticCurveTo(2.03, 0.86, 1.84, 0.90);
    lowerShape.lineTo(1.06, 0.96);
    lowerShape.lineTo(-1.58, 0.99);
    lowerShape.quadraticCurveTo(-1.98, 0.96, -2.06, 0.82);
    lowerShape.quadraticCurveTo(-2.12, 0.58, -2.05, 0.36);
    lowerShape.closePath();
    const lowerW = 1.64;
    const lowerGeom = new THREE.ExtrudeGeometry(lowerShape, {
      depth: lowerW,
      bevelEnabled: true,
      bevelThickness: 0.07,
      bevelSize: 0.045,
      bevelSegments: 3,
      curveSegments: 10,
    });
    lowerGeom.translate(0, 0, -lowerW * 0.5);
    lowerGeom.rotateY(-Math.PI * 0.5);
    const lowerMesh = new THREE.Mesh(lowerGeom, this._materials.carBody);
    lowerMesh.castShadow = true;
    lowerMesh.receiveShadow = true;
    car.add(lowerMesh);

    // 3. 絞り込みのあるキャビン上部（実車同様ルーフ幅をわずかに絞り立体感を強調）
    const cabinShape = new THREE.Shape();
    cabinShape.moveTo(-1.56, 0.94);
    cabinShape.lineTo(1.04, 0.93);
    cabinShape.bezierCurveTo(0.84, 1.18, 0.56, 1.46, 0.32, 1.50);
    cabinShape.lineTo(-0.96, 1.50);
    cabinShape.quadraticCurveTo(-1.18, 1.49, -1.36, 1.38);
    cabinShape.lineTo(-1.62, 1.02);
    cabinShape.closePath();
    const cabinW = 1.38;
    const cabinGeom = new THREE.ExtrudeGeometry(cabinShape, {
      depth: cabinW,
      bevelEnabled: true,
      bevelThickness: 0.085,
      bevelSize: 0.045,
      bevelSegments: 3,
      curveSegments: 10,
    });
    cabinGeom.translate(0, 0, -cabinW * 0.5);
    cabinGeom.rotateY(-Math.PI * 0.5);
    const cabinMesh = new THREE.Mesh(cabinGeom, this._materials.carBody);
    cabinMesh.castShadow = true;
    cabinMesh.receiveShadow = true;
    car.add(cabinMesh);

    // リア・ルーフスポイラー
    const spoilGeom = new THREE.BoxGeometry(1.36, 0.055, 0.18);
    const spoil = new THREE.Mesh(spoilGeom, this._materials.carTrim);
    spoil.position.set(0, 1.47, -1.36);
    spoil.rotation.x = 0.12;
    car.add(spoil);

    // 4. キャビングラス（サイドウィンドウ帯・フロントガラス・リアガラス）
    const sideWinShape = new THREE.Shape();
    sideWinShape.moveTo(-1.38, 1.01);
    sideWinShape.lineTo(0.86, 0.99);
    sideWinShape.lineTo(0.32, 1.42);
    sideWinShape.lineTo(-0.98, 1.42);
    sideWinShape.closePath();
    const sideWinW = 1.565;
    const sideWinGeom = new THREE.ExtrudeGeometry(sideWinShape, {
      depth: sideWinW,
      bevelEnabled: false,
    });
    sideWinGeom.translate(0, 0, -sideWinW * 0.5);
    sideWinGeom.rotateY(-Math.PI * 0.5);
    car.add(new THREE.Mesh(sideWinGeom, this._materials.carGlass));

    // クローム・ウィンドウベルトラインモール＆ドアハンドル（左右）
    const beltGeom = new THREE.BoxGeometry(1.585, 0.025, 2.26);
    const belt = new THREE.Mesh(beltGeom, this._materials.carChrome);
    belt.position.set(0, 0.99, -0.25);
    car.add(belt);

    // B ピラー ＆ C ピラー（艶黒ピラー仕切り）
    const bPillar = new THREE.Mesh(new THREE.BoxGeometry(1.582, 0.44, 0.105), this._materials.carTrim);
    bPillar.position.set(0, 1.21, -0.14);
    car.add(bPillar);

    const cPillar = new THREE.Mesh(new THREE.BoxGeometry(1.582, 0.43, 0.14), this._materials.carTrim);
    cPillar.position.set(0, 1.21, -0.88);
    cPillar.rotation.x = 0.24;
    car.add(cPillar);

    // フロントウィンドウ傾斜クリアコートガラス
    const fDz = 1.02 - 0.34;
    const fDy = 1.47 - 0.95;
    const fLen = Math.hypot(fDz, fDy) * 0.92;
    const fAngle = Math.atan2(fDz, fDy);
    const frontWind = new THREE.Mesh(new THREE.BoxGeometry(1.34, fLen, 0.04), this._materials.carGlass);
    frontWind.position.set(0, 1.22, 0.71);
    frontWind.rotation.x = -fAngle;
    car.add(frontWind);

    // リアウィンドウ傾斜ガラス
    const rDz = 1.58 - 1.18;
    const rDy = 1.44 - 1.02;
    const rLen = Math.hypot(rDz, rDy) * 0.88;
    const rAngle = Math.atan2(rDz, rDy);
    const rearWind = new THREE.Mesh(new THREE.BoxGeometry(1.30, rLen, 0.04), this._materials.carGlass);
    rearWind.position.set(0, 1.23, -1.42);
    rearWind.rotation.x = rAngle;
    car.add(rearWind);

    // 5. ルーフレール（左右シルバー）＆シャークフィンアンテナ
    const railGeom = new THREE.BoxGeometry(0.055, 0.045, 1.46);
    for (const sx of [-0.55, 0.55]) {
      const rail = new THREE.Mesh(railGeom, this._materials.carChrome);
      rail.position.set(sx, 1.555, -0.34);
      car.add(rail);
    }
    const finShape = new THREE.Shape();
    finShape.moveTo(0, 0);
    finShape.lineTo(0.20, 0);
    finShape.lineTo(0.03, 0.09);
    finShape.closePath();
    const finGeom = new THREE.ExtrudeGeometry(finShape, { depth: 0.035, bevelEnabled: false });
    finGeom.translate(-0.10, 0, -0.0175);
    finGeom.rotateY(-Math.PI * 0.5);
    const fin = new THREE.Mesh(finGeom, this._materials.carBody);
    fin.position.set(0, 1.535, -0.92);
    car.add(fin);

    // 6. サイドミラー（ステー付き）＆前後ドアハンドル
    const stalkGeom = new THREE.BoxGeometry(0.11, 0.035, 0.045);
    const mirrorCapGeom = new THREE.BoxGeometry(0.16, 0.10, 0.13);
    const handleGeom = new THREE.BoxGeometry(0.045, 0.036, 0.16);
    for (const sx of [-1, 1]) {
      const stalk = new THREE.Mesh(stalkGeom, this._materials.carTrim);
      stalk.position.set(sx * 0.84, 0.99, 0.56);
      car.add(stalk);

      const mCap = new THREE.Mesh(mirrorCapGeom, this._materials.carBody);
      mCap.position.set(sx * 0.94, 1.03, 0.55);
      car.add(mCap);

      for (const hz of [0.16, -0.58]) {
        const hdl = new THREE.Mesh(handleGeom, this._materials.carChrome);
        hdl.position.set(sx * 0.895, 0.84, hz);
        car.add(hdl);
      }
    }

    // 7. フロントフェイス (+Z)：六角ダークグリル＋クロームバー＋LEDヘッドライト/DRL＋白ナンバープレート
    const grille = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.28, 0.06), this._materials.carTrim);
    grille.position.set(0, 0.61, 2.10);
    car.add(grille);

    const grilleChrome = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.035, 0.075), this._materials.carChrome);
    grilleChrome.position.set(0, 0.72, 2.105);
    car.add(grilleChrome);

    const lowerIntake = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.11, 0.06), this._materials.carCladding);
    lowerIntake.position.set(0, 0.34, 2.11);
    car.add(lowerIntake);

    const headGeom = new THREE.BoxGeometry(0.36, 0.10, 0.07);
    const drlGeom = new THREE.BoxGeometry(0.38, 0.028, 0.08);
    for (const sx of [-0.66, 0.66]) {
      const hl = new THREE.Mesh(headGeom, this._materials.carHeadlight);
      hl.position.set(sx, 0.73, 2.09);
      car.add(hl);

      const drl = new THREE.Mesh(drlGeom, this._materials.carDrl);
      drl.position.set(sx, 0.79, 2.092);
      car.add(drl);
    }

    // 前後日本仕様ナンバープレート（330mm×165mm 相当）
    const plateGeom = new THREE.BoxGeometry(0.34, 0.17, 0.025);
    const fPlate = new THREE.Mesh(plateGeom, this._materials.carPlate);
    fPlate.position.set(0, 0.45, 2.135);
    car.add(fPlate);

    const rPlate = new THREE.Mesh(plateGeom, this._materials.carPlate);
    rPlate.position.set(0, 0.56, -2.125);
    car.add(rPlate);

    // 8. リアビュー (-Z)：横一文字LEDテールランプ＋リアディフューザー＆クロームマフラー
    const tailBar = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.075, 0.06), this._materials.carTaillight);
    tailBar.position.set(0, 0.80, -2.09);
    car.add(tailBar);

    const tailInner = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.065), this._materials.carDrl);
    tailInner.position.set(0, 0.75, -2.095);
    car.add(tailInner);

    const exhaustGeom = new THREE.CylinderGeometry(0.042, 0.042, 0.14, 12);
    exhaustGeom.rotateX(Math.PI * 0.5);
    for (const sx of [-0.52, 0.52]) {
      const ex = new THREE.Mesh(exhaustGeom, this._materials.carChrome);
      ex.position.set(sx, 0.27, -2.09);
      car.add(ex);
    }

    // 9. 4輪タイヤ＋5本スポークアルミホイール＋ブレーキディスク＋SUVオーバーフェンダーアーチ
    const wheelR = 0.34;
    const wheelOffsets = [
      [-0.84, wheelR, 1.30],
      [0.84, wheelR, 1.30],
      [-0.84, wheelR, -1.28],
      [0.84, wheelR, -1.28],
    ];
    const fenderGeom = new THREE.TorusGeometry(wheelR + 0.055, 0.042, 8, 18, Math.PI);
    fenderGeom.rotateY(Math.PI * 0.5);

    const tireGeomShared = new THREE.CylinderGeometry(wheelR, wheelR, 0.24, 22);
    tireGeomShared.rotateZ(Math.PI * 0.5);
    const rimRingGeom = new THREE.CylinderGeometry(0.215, 0.215, 0.252, 18);
    rimRingGeom.rotateZ(Math.PI * 0.5);
    const brakeGeom = new THREE.CylinderGeometry(0.155, 0.155, 0.26, 14);
    brakeGeom.rotateZ(Math.PI * 0.5);
    const hubCapGeom = new THREE.CylinderGeometry(0.055, 0.055, 0.276, 12);
    hubCapGeom.rotateZ(Math.PI * 0.5);
    const spokeGeom = new THREE.BoxGeometry(0.272, 0.39, 0.036);

    for (const [wx, wy, wz] of wheelOffsets) {
      const wGrp = new THREE.Group();
      wGrp.position.set(wx, wy, wz);

      // タイヤ
      const tire = new THREE.Mesh(tireGeomShared.clone(), this._materials.carTire);
      tire.castShadow = true;
      wGrp.add(tire);

      // アルミホイールリム外周＋奥まったブレーキディスク
      wGrp.add(new THREE.Mesh(rimRingGeom.clone(), this._materials.carRim));
      wGrp.add(new THREE.Mesh(brakeGeom.clone(), this._materials.carBrake));
      wGrp.add(new THREE.Mesh(hubCapGeom.clone(), this._materials.carChrome));

      // 5本スポーク（2.5本の交差バーで放射5本表現）
      for (let sp = 0; sp < 5; sp++) {
        const spMesh = new THREE.Mesh(spokeGeom.clone(), this._materials.carRim);
        spMesh.rotation.x = (sp / 5) * Math.PI;
        wGrp.add(spMesh);
      }
      car.add(wGrp);

      // ブラック樹脂オーバーフェンダーアーチ
      const fender = new THREE.Mesh(fenderGeom.clone(), this._materials.carCladding);
      fender.position.set(wx > 0 ? 0.875 : -0.875, wy + 0.02, wz);
      car.add(fender);
    }

    // テンプレート一時ジオメトリ解放
    fenderGeom.dispose();
    tireGeomShared.dispose();
    rimRingGeom.dispose();
    brakeGeom.dispose();
    hubCapGeom.dispose();
    spokeGeom.dispose();

    return car;
  }

  // ==========================================================================
  // パラメータ・計算結果抽出（SPEC.md 準拠・フォールバック安全設計）
  // ==========================================================================

  _extractGeom(params, result) {
    const p = params || {};
    const rg = (result && result.geom) || {};
    const wallType =
      (rg.wallType || p.wallType || result?.wallType) === 'large_block' ? 'large_block' : 'l_wall';

    const H = clamp(Number(rg.H ?? p.H ?? 4.0) || 4.0, 2.0, 7.0);
    const embedDepth = clamp(
      Number(rg.embedDepth ?? p.embedDepth ?? 0.50) || 0.50,
      0.30,
      Math.min(1.20, H - 0.8)
    );
    const visibleHeight = Math.max(0.5, H - embedDepth);
    const betaDeg = clamp(Number(p.betaDeg ?? 0) || 0, 0, 25);
    const betaRad = degToRad(betaDeg);
    const qSurcharge = clamp(Number(p.qSurcharge ?? 10) || 0, 0, 40);
    const waterRatio = clamp(Number(p.waterRatio ?? 0) || 0, 0, 0.95);
    const kh = clamp(Number(p.kh ?? 0) || 0, 0, 0.35);

    if (wallType === 'large_block') {
      const B = clamp(Number(rg.B ?? p.B ?? 1.8) || 1.8, 1.4, 5.5);
      const t_base = clamp(Number(rg.t_base ?? p.t_base ?? 0.4) || 0.4, 0.25, H - 0.5);
      const frontSlope = clamp(Number(rg.frontSlope ?? p.frontSlope ?? 0.35) || 0.35, 0.2, 0.55);
      const blockDepth = clamp(
        Number(rg.blockDepth ?? p.blockDepth ?? rg.blockDepthTop ?? p.blockDepthTop ?? 1.2) || 1.2,
        0.65,
        2.0
      );
      const courseHeight = clamp(Number(rg.courseHeight ?? p.courseHeight ?? 0.5) || 0.5, 0.5, 1.0);
      const extraBase = Math.max(0.3, B - blockDepth);
      const footingToe = Number(rg.footingToe ?? clamp(extraBase * 0.35, 0.12, 0.24));
      const footingHeel = Number(rg.footingHeel ?? Math.max(0.12, B - blockDepth - footingToe));
      const H_stem = Math.max(0.5, H - t_base);
      const t_cap = Number(rg.t_cap ?? clamp(0.12, 0.08, H_stem * 0.12));
      const H_courses = Math.max(0.4, H_stem - t_cap);
      const nCourses = Number(rg.nCourses ?? Math.max(2, Math.round(H_courses / courseHeight)));
      const hCourse = Number(rg.hCourse ?? H_courses / nCourses);

      const x_front_bot = Number(rg.x_front_bot ?? footingToe);
      const x_back_bot = Number(rg.x_back_bot ?? x_front_bot + blockDepth);
      const x_front_top = Number(rg.x_front_top ?? x_front_bot + frontSlope * H_stem);
      const x_back_top = Number(rg.x_back_top ?? x_front_top + blockDepth);
      const slopeBack = frontSlope;
      const x_env_bot = Number(rg.x_env_bot ?? Math.max(0.35, x_back_bot - slopeBack * t_base));
      const x_env_top = Number(rg.x_env_top ?? x_back_top);
      const alphaDeg = Number(rg.alphaDeg ?? 90 + (Math.atan(slopeBack) * 180) / Math.PI);

      let courses = Array.isArray(rg.courses) && rg.courses.length > 0 ? rg.courses : null;
      if (!courses) {
        courses = [];
        for (let i = 0; i < nCourses; i++) {
          const y0 = t_base + i * hCourse;
          const y1 = y0 + hCourse;
          const xf0 = x_front_bot + frontSlope * (y0 - t_base);
          const xf1 = x_front_bot + frontSlope * (y1 - t_base);
          const xb0 = xf0 + blockDepth;
          const xb1 = xf1 + blockDepth;
          courses.push({ index: i, y0, y1, xf0, xf1, xb0, xb1, xBack: 0.5 * (xb0 + xb1) });
        }
      }
      const cap = rg.cap || {
        y0: H - t_cap,
        y1: H,
        xf0: x_front_bot + frontSlope * (H - t_cap - t_base),
        xf1: x_front_top,
        xb0: x_front_bot + frontSlope * (H - t_cap - t_base) + blockDepth,
        xb1: x_back_top,
        xBack: x_back_top,
      };

      const H_v = Number(rg.H_v ?? H);
      const H_w = Number(rg.H_w ?? waterRatio * H_stem);
      const fz = result?.failureZone || {};
      const phiDegVal = Number(p.phiDeg ?? 30.0) || 30.0;
      const slipAngleDeg = clamp(Number(fz.slipAngleDeg ?? (45 + phiDegVal * 0.5)), 30, 68);
      const slipOriginX = Number(fz.originX ?? Math.max(B, x_back_bot));
      const slipOriginY = Number(fz.originY ?? 0);
      const rawCrackX = Number(
        fz.crackX ?? Math.max(x_back_top + 0.85, slipOriginX + (H - slipOriginY) / Math.tan(degToRad(slipAngleDeg)))
      );
      const crackX = Math.max(x_back_top + 0.65, rawCrackX);
      const crackY = Number(fz.crackY ?? H + Math.max(0, crackX - x_back_top) * Math.tan(betaRad));

      const maxWallX = Math.max(B, x_back_top, x_back_bot, x_env_top);
      const backExt = Math.max(4.8, 0.96 * H);
      const X_min = -FRONT_EXT_X;
      const X_max = Math.max(maxWallX + backExt, crackX + 1.9);
      const Y_bot = -Math.max(2.75, 0.54 * H);

      return {
        wallType: 'large_block',
        H,
        embedDepth,
        visibleHeight,
        B,
        B_toe: footingToe,
        B_heel: footingHeel,
        t_top: blockDepth,
        t_stem: blockDepth,
        t_base,
        x_front: x_front_bot,
        x_front_bot,
        x_front_top,
        x_back_top,
        x_back_bot,
        x_env_bot,
        x_env_top,
        slopeBack,
        alphaDeg,
        frontSlope,
        blockDepth,
        blockDepthTop: blockDepth,
        courseHeight,
        t_cap,
        footingToe,
        footingHeel,
        nCourses,
        hCourse,
        courses,
        cap,
        fillConcrete: Boolean(rg.fillConcrete ?? p.fillConcrete),
        hasInterlock: rg.hasInterlock !== undefined ? Boolean(rg.hasInterlock) : Boolean(p.hasInterlock ?? true),
        xCG_wall: Number(rg.xCG_wall ?? B * 0.52),
        yCG_wall: Number(rg.yCG_wall ?? H * 0.45),
        hasKey: false,
        keyX: B * 0.5,
        keyDepth: 0,
        keyWidth: 0,
        betaDeg,
        betaRad,
        qSurcharge,
        waterRatio,
        kh,
        isSeismic: Boolean(result?.isSeismic ?? kh > 0),
        H_v,
        H_w,
        slipAngleDeg,
        slipOriginX,
        slipOriginY,
        crackX,
        crackY,
        X_min,
        X_max,
        Y_bot,
        gammaSoil: Number(p.gammaSoil ?? 18.0) || 18.0,
        phiDeg: phiDegVal,
        qa: Number(p.qa ?? 250.0) || 250.0,
      };
    }

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
    const fzL = result?.failureZone || {};
    const phiDegL = Number(p.phiDeg ?? 30.0) || 30.0;
    const slipAngleDeg = clamp(Number(fzL.slipAngleDeg ?? (45 + phiDegL * 0.5)), 30, 68);
    const slipOriginX = Number(fzL.originX ?? B);
    const slipOriginY = Number(fzL.originY ?? 0);
    const rawCrackXL = Number(
      fzL.crackX ?? (B + H / Math.tan(degToRad(slipAngleDeg)))
    );
    const crackX = Math.max(B + 0.55, rawCrackXL);
    const crackY = Number(fzL.crackY ?? H + Math.max(0, crackX - x_back_bot) * Math.tan(betaRad));

    const backExt = Math.max(4.8, 0.96 * H);
    const X_min = -FRONT_EXT_X;
    const X_max = Math.max(B + backExt, crackX + 1.9);
    const Y_bot = -Math.max(2.75, 0.54 * H + (hasKey ? 0.35 : 0));

    return {
      wallType: 'l_wall',
      H,
      embedDepth,
      visibleHeight,
      B,
      B_toe,
      B_heel,
      t_top,
      t_stem,
      t_base,
      x_front,
      x_front_bot: x_front,
      x_front_top: x_front,
      x_back_top,
      x_back_bot,
      xCG_wall: B * 0.52,
      yCG_wall: H * 0.5,
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
      slipAngleDeg,
      slipOriginX,
      slipOriginY,
      crackX,
      crackY,
      X_min,
      X_max,
      Y_bot,
      gammaSoil: Number(p.gammaSoil ?? 18.0) || 18.0,
      phiDeg: phiDegL,
      qa: Number(p.qa ?? 250.0) || 250.0,
    };
  }

  /**
   * 背面地表面標高 Y(x)
   * L型: X = B にて厳密に H_v = H + B_heel * tan(beta) に一致
   * 大型ブロック: 天端背面 x_back_top 起点から勾配 beta
   */
  _backGroundY(g, x) {
    const xStart = g.wallType === 'large_block' ? g.x_back_top : g.x_back_bot;
    if (x <= xStart) return g.H;
    return g.H + (x - xStart) * Math.tan(g.betaRad);
  }

  /**
   * 壁体前面の任意高さ y (t_base .. H) における X 座標
   */
  _wallFrontX(g, y) {
    if (g.wallType === 'large_block') {
      return g.x_front_bot + g.frontSlope * Math.max(0, y - g.t_base);
    }
    return g.x_front;
  }

  /**
   * 壁体背面の任意高さ y (t_base .. H) における X 座標
   */
  _stemBackX(g, y) {
    if (g.wallType === 'large_block') {
      if (y <= g.t_base) return g.x_back_bot;
      const t = clamp((y - g.t_base) / Math.max(0.05, g.H - g.t_base), 0, 1);
      return g.x_back_bot + (g.x_back_top - g.x_back_bot) * t;
    }
    const t = clamp((y - g.t_base) / Math.max(0.05, g.H - g.t_base), 0, 1);
    return g.x_back_bot + (g.x_back_top - g.x_back_bot) * t;
  }

  /**
   * 土圧作用面の任意高さ y (0 .. H_v) における X 座標
   * L型: 仮想背面 X = B 固定
   * 大型ブロック: 背面包絡傾斜面 x_back_bot + slopeBack * (y - t_base)
   */
  _backPlaneX(g, y) {
    if (g.wallType === 'large_block') {
      return Math.max(0.35, g.x_back_bot + g.slopeBack * (y - g.t_base));
    }
    return g.B;
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
    const effSpan = Math.max(g.B, g.x_back_top || g.B);
    const S = Math.max(g.H, effSpan * 1.15, 3.8) / 4.0;
    const cx = effSpan * 0.56;
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

    const isBlock = g.wallType === 'large_block';
    const earthMidY = g.H_v * 0.35;
    const earthMidP = this._sampleProfile(earthPts, earthMidY);
    const earthBaseX = this._backPlaneX(g, earthMidY);
    const earthPeakX = earthBaseX + Math.min(2.5, Math.max(0.65, earthMidP * pScale * 0.85));

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

    // 透視モード時（L型: 背面引張主鉄筋 / 大型ブロック: 中詰め・連結ピン内部構造）
    if (this.options.showRebar) {
      if (isBlock) {
        const fillLabel = g.fillConcrete ? '胴込めコン充填' : '中詰め砕石充填';
        const pinSub = g.hasInterlock ? `${fillLabel}＋連結ピン（青）` : `${fillLabel}（連結ピンなし）`;
        pushAnchor(
          'rebar',
          '内部構造透視',
          pinSub,
          'water',
          99,
          (this._wallFrontX(g, g.H * 0.55) + this._stemBackX(g, g.H * 0.55)) * 0.5,
          g.H * 0.55,
          1.4
        );
      } else {
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
    }

    // 大型ブロックの目地危険ピン（目地NG時最優先強調）
    if (isBlock && r?.checks?.joint?.enabled && !r.checks.joint.ok) {
      const jc = r.checks.joint;
      const yj = jc.criticalY;
      pushAnchor(
        'jointAlert',
        `${jc.criticalCourseNum}段目目地 NG`,
        `Fsj=${jc.fs.toFixed(2)}（基準 ${jc.limit.toFixed(2)}）`,
        'danger',
        98,
        this._wallFrontX(g, yj) - 0.08,
        yj + 0.06,
        FRONT_Z + 0.45
      );
    }

    // 破壊アクティブ時の道路陥没・主働すべり面ピンラベル（L型・大型ブロック共通）
    if (this._isFailureActive() && Number.isFinite(g.crackX)) {
      const roadOrSlope = g.qSurcharge > 0.5 && g.betaDeg <= 8.0 ? '道路陥没クラック' : '法面亀裂・陥没';
      const wDist = Math.max(0.2, g.crackX - g.x_back_top);
      pushAnchor(
        'roadCollapse',
        roadOrSlope,
        `主働すべり θ=${(g.slipAngleDeg ?? 60).toFixed(0)}° ／ 崩壊幅 ${wDist.toFixed(1)}m`,
        'danger',
        96,
        g.crackX,
        (g.crackY ?? g.H) + 0.42,
        FRONT_Z * 0.62
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
        const wMidY = yWater * 0.35;
        const wMidP = this._sampleProfile(waterPts, wMidY);
        const wBaseX = this._backPlaneX(g, wMidY);
        const waterPinX = wBaseX + Math.min(3.2, Math.max(1.1, (earthMidP + wMidP) * pScale * 0.9));
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
          (g.xCG_wall ?? g.B * 0.52) + 0.45,
          (g.yCG_wall ?? g.H * 0.5) + 0.58,
          FRONT_Z + 0.52
        );
      }

      pushAnchor(
        'virtualBack',
        isBlock ? `土圧作用面（α=${(g.alphaDeg ?? 90).toFixed(1)}°）` : '仮想背面（X=B）',
        `Hv=${g.H_v.toFixed(2)}m`,
        'structure',
        62,
        this._backPlaneX(g, g.H_v),
        g.H_v + 0.28,
        FRONT_Z + 0.14
      );
    }

    // 上載荷重
    if (g.qSurcharge > 0.5) {
      const sx = (isBlock ? g.x_back_top : g.B) + 1.35;
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
    const minWeepBase = Math.max(g.t_base, g.embedDepth ?? 0.50);
    const drainY = Math.max(minWeepBase + 0.32, minWeepBase + (g.H - minWeepBase) * 0.22);
    pushAnchor(
      'drain',
      g.waterRatio > 0.001 ? '水抜き孔（詰まり）' : '水抜き孔・砕石排水',
      g.waterRatio > 0.001 ? '排水不良 → 地下水位上昇' : '健全排水（6箇所）',
      g.waterRatio > 0.001 ? 'danger' : 'water',
      g.waterRatio > 0.001 ? 94 : 74,
      this._wallFrontX(g, drainY) - 0.08,
      drainY,
      1.8
    );

    // 根入れ深さ基準未満時の現場構造細目アラート（50cm未満 または 底版露出）
    if (r?.checks?.embedment && !r.checks.embedment.ok) {
      const emb = r.checks.embedment;
      pushAnchor(
        'embedmentAlert',
        `根入れ不足 Df=${(emb.df ?? g.embedDepth).toFixed(2)}m`,
        emb.statusJa || '最小根入れ 0.50m 未満（底版露出・洗掘注意）',
        'danger',
        92,
        Math.max(g.X_min + 1.0, -1.55),
        g.embedDepth + 0.16,
        FRONT_Z * 0.58
      );
    }

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
    if (isBlock) {
      pushAnchor(
        'wall',
        `大型ブロック積み（${g.nCourses}段・1:${g.frontSlope.toFixed(2)}）`,
        `H=${g.H.toFixed(2)}m × B=${g.B.toFixed(2)}m`,
        'structure',
        68,
        (g.x_front_top + g.x_back_top) * 0.5,
        g.H + 0.24,
        0.8
      );
    } else {
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
    }

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
      this.wallGroup.rotation.z !== 0 ||
      this._hasActiveCourseOffset
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
    clearGroupGeometries(this.activeWedgeGroup);
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
    this._wallMesh = null;
    this._wallEdgeLine = null;
    this._wallMeshes = [];
    this._wallEdgeLines = [];
    this._wallAccentMeshes = [];
    this._courseGroups = [];
    this._capGroup = null;
    this._hasActiveCourseOffset = false;

    const g = this._geom;
    const isGlass = Boolean(this.options.showRebar);

    if (g.wallType === 'large_block') {
      this._rebuildLargeBlockWall(g, isGlass);
      return;
    }

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

    this._wallMesh = new THREE.Mesh(
      wallGeom,
      isGlass ? this._materials.concreteGlass : this._materials.concreteOpaque
    );
    this._wallMesh.castShadow = !isGlass;
    this._wallMesh.receiveShadow = true;
    this._wallMesh.renderOrder = isGlass ? 6 : 0;
    this.wallMeshGroup.add(this._wallMesh);
    this._wallMeshes.push({ mesh: this._wallMesh, opaqueMat: this._materials.concreteOpaque });

    // CAD 輪郭エッジライン（視認性向上）
    const edgeGeom = new THREE.EdgesGeometry(wallGeom, 22);
    this._wallEdgeLine = new THREE.LineSegments(
      edgeGeom,
      isGlass ? this._materials.wallEdgeGlass : this._materials.wallEdge
    );
    this._wallEdgeLine.renderOrder = isGlass ? 7 : 1;
    this.wallMeshGroup.add(this._wallEdgeLine);
    this._wallEdgeLines.push(this._wallEdgeLine);

    // リアルディテール①：RC擁壁の伸縮目地（誘発目地・Z=0 中央の縦目地＋天端目地）
    const stemVisBot = Math.max(g.t_base, g.embedDepth ?? 0.50);
    const jointH = Math.max(0.25, g.H - stemVisBot);
    const ejFront = new THREE.Mesh(
      new THREE.BoxGeometry(0.014, jointH, 0.024),
      this._materials.expansionJoint
    );
    ejFront.position.set(g.x_front - 0.003, stemVisBot + jointH * 0.5, 0);
    ejFront.visible = !isGlass;
    this.wallMeshGroup.add(ejFront);
    this._wallAccentMeshes.push(ejFront);

    const ejTop = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(0.18, g.t_top - 0.01), 0.012, 0.024),
      this._materials.expansionJoint
    );
    ejTop.position.set(g.x_front + g.t_top * 0.5, g.H + 0.002, 0);
    ejTop.visible = !isGlass;
    this.wallMeshGroup.add(ejTop);
    this._wallAccentMeshes.push(ejTop);

    // リアルディテール②：前面GL地際の自然な雨跳ね・湿潤ウェザリング帯（Df < t_base時も底版にめり込まない）
    const dampH = Math.min(0.28, Math.max(0.12, (g.H - stemVisBot) * 0.14));
    const dampGeom = new THREE.PlaneGeometry(L_Z - 0.04, dampH);
    dampGeom.rotateY(-Math.PI * 0.5);
    const dampMesh = new THREE.Mesh(dampGeom, this._materials.wallDampBase);
    dampMesh.position.set(g.x_front - 0.007, stemVisBot + dampH * 0.5, 0);
    dampMesh.visible = !isGlass;
    dampMesh.renderOrder = 2;
    this.wallMeshGroup.add(dampMesh);
    this._wallAccentMeshes.push(dampMesh);

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

  /**
   * 大型積みブロック擁壁の3D造形（基礎コン＋面取り千鳥積み各段ブロック＋天端笠コン）
   * 各段を独立 courseGroup 化し、目地ズレ（段間滑動）アニメーションにそのまま対応する。
   */
  _rebuildLargeBlockWall(g, isGlass) {
    const addStructuralMesh = (geom, opaqueMat, parent, edgeThreshold = 26) => {
      const mesh = new THREE.Mesh(geom, isGlass ? this._materials.concreteGlass : opaqueMat);
      mesh.castShadow = !isGlass;
      mesh.receiveShadow = true;
      mesh.renderOrder = isGlass ? 6 : 0;
      parent.add(mesh);
      this._wallMeshes.push({ mesh, opaqueMat });

      const edgeGeom = new THREE.EdgesGeometry(geom, edgeThreshold);
      const edgeLine = new THREE.LineSegments(
        edgeGeom,
        isGlass ? this._materials.wallEdgeGlass : this._materials.wallEdge
      );
      edgeLine.renderOrder = isGlass ? 7 : 1;
      parent.add(edgeLine);
      this._wallEdgeLines.push(edgeLine);
      return mesh;
    };

    // 1. 基礎コンクリート（X = 0 .. B, Y = 0 .. t_base）— 段間ズレ時は静止
    const fShape = new THREE.Shape();
    fShape.moveTo(0, 0);
    fShape.lineTo(g.B, 0);
    fShape.lineTo(g.B, g.t_base);
    fShape.lineTo(0, g.t_base);
    fShape.closePath();
    const fGeom = extrudeXYShape(fShape, L_Z, BACK_Z, 0.5, 0.5);
    addStructuralMesh(fGeom, this._materials.blockCapConcrete, this.wallMeshGroup, 26);

    // 2. 各段ブロック（千鳥積み・3トーン石肌バリエーション＋V字面取り目地）
    const unitW = 1.0; // 標準大型ブロック幅 1.0m（L_Z=8.0m に 8 個 / 奇数段は半ブロック千鳥）
    const blockMats = [
      this._materials.blockOpaqueA,
      this._materials.blockOpaqueB,
      this._materials.blockOpaqueC,
    ];
    const bevelSz = 0.008;
    const bevelTh = 0.010;
    const dxInset = bevelSz * Math.hypot(1, g.frontSlope);

    for (let i = 0; i < g.courses.length; i++) {
      const c = g.courses[i];
      const courseGrp = new THREE.Group();
      courseGrp.userData.courseIndex = i;
      this.wallMeshGroup.add(courseGrp);
      this._courseGroups.push(courseGrp);

      // 外寸を厳密に (xf..xb, y0..y1) に保ちつつベベル面取りで立体 V 字目地を生成
      const yBot = c.y0 + bevelSz + 0.001;
      const yTop = c.y1 - bevelSz - 0.001;
      const xfBot = this._wallFrontX(g, yBot) + dxInset;
      const xfTop = this._wallFrontX(g, yTop) + dxInset;
      const xbBot = this._wallFrontX(g, yBot) + g.blockDepth - dxInset;
      const xbTop = this._wallFrontX(g, yTop) + g.blockDepth - dxInset;

      // 縦断方向の千鳥割付
      const spans = [];
      if (i % 2 === 0) {
        for (let z = BACK_Z; z < FRONT_Z - 1e-4; z += unitW) {
          spans.push([z, Math.min(FRONT_Z, z + unitW)]);
        }
      } else {
        spans.push([BACK_Z, BACK_Z + unitW * 0.5]);
        for (let z = BACK_Z + unitW * 0.5; z < FRONT_Z - unitW * 0.5 - 1e-4; z += unitW) {
          spans.push([z, z + unitW]);
        }
        spans.push([FRONT_Z - unitW * 0.5, FRONT_Z]);
      }

      const bShape = new THREE.Shape();
      bShape.moveTo(xfBot, yBot);
      bShape.lineTo(xbBot, yBot);
      bShape.lineTo(xbTop, yTop);
      bShape.lineTo(xfTop, yTop);
      bShape.closePath();

      for (let sIdx = 0; sIdx < spans.length; sIdx++) {
        const [z0Raw, z1Raw] = spans[sIdx];
        const z0 = z0Raw <= BACK_Z + 1e-4 ? BACK_Z : z0Raw + 0.002;
        const z1 = z1Raw >= FRONT_Z - 1e-4 ? FRONT_Z : z1Raw - 0.002;
        const depth = Math.max(0.08, z1 - z0);
        const bGeom = extrudeXYShape(bShape, depth, z0, 0.85, 0.85, 'triplanar', {
          enabled: true,
          thickness: bevelTh,
          size: bevelSz,
          segments: 1,
        });
        const matPick = blockMats[(i * 5 + sIdx * 7 + (i % 2)) % blockMats.length];
        addStructuralMesh(bGeom, matPick, courseGrp, 34);
      }
    }

    // 3. 天端笠コンクリート（前面・背面平行＋角面取り、最上段と一緒にスライド）
    const capGrp = new THREE.Group();
    const cap = g.cap;
    const capBev = 0.006;
    const capDx = capBev * Math.hypot(1, g.frontSlope);
    const capShape = new THREE.Shape();
    capShape.moveTo(cap.xf0 + capDx, cap.y0 + capBev);
    capShape.lineTo((cap.xb0 ?? cap.xf0 + g.blockDepth) - capDx, cap.y0 + capBev);
    capShape.lineTo((cap.xb1 ?? cap.xf1 + g.blockDepth) - capDx, cap.y1 - capBev);
    capShape.lineTo(cap.xf1 + capDx, cap.y1 - capBev);
    capShape.closePath();
    const capGeom = extrudeXYShape(capShape, L_Z, BACK_Z, 0.55, 0.55, 'triplanar', {
      enabled: true,
      thickness: 0.007,
      size: capBev,
      segments: 1,
    });
    addStructuralMesh(capGeom, this._materials.blockCapConcrete, capGrp, 34);
    this.wallMeshGroup.add(capGrp);
    this._capGroup = capGrp;

    // 危険目地がある場合は手前断面に赤ハイライトライン（静止時でも視認可能）
    const jc = this._result?.checks?.joint;
    if (jc && jc.enabled && !jc.ok && jc.criticalCourseIndex >= 0) {
      const cCrit = g.courses[jc.criticalCourseIndex];
      if (cCrit) {
        const yj = cCrit.y0;
        const jLinePts = [
          new THREE.Vector3(cCrit.xf0 - 0.03, yj, FRONT_Z + 0.035),
          new THREE.Vector3((cCrit.xb0 ?? cCrit.xf0 + g.blockDepth) + 0.03, yj, FRONT_Z + 0.035),
        ];
        const jLineGeom = new THREE.BufferGeometry().setFromPoints(jLinePts);
        const jLine = new THREE.Line(jLineGeom, this._materials.failureCrackEdge);
        jLine.renderOrder = 13;
        this.wallMeshGroup.add(jLine);
      }
    }
  }

  _applyWallGlassMode(isGlass) {
    for (const item of this._wallMeshes) {
      if (!item || !item.mesh) continue;
      item.mesh.material = isGlass ? this._materials.concreteGlass : item.opaqueMat;
      item.mesh.castShadow = !isGlass;
      item.mesh.renderOrder = isGlass ? 6 : 0;
    }
    for (const edgeLine of this._wallEdgeLines) {
      if (!edgeLine) continue;
      edgeLine.material = isGlass ? this._materials.wallEdgeGlass : this._materials.wallEdge;
      edgeLine.renderOrder = isGlass ? 7 : 1;
    }
    for (const acc of this._wallAccentMeshes || []) {
      if (acc) acc.visible = !isGlass;
    }
    // P-2: 透視モード時は裏込め砕石を半透明淡色化して内部構造・主鉄筋を際立たせる
    if (this._drainMesh) {
      this._drainMesh.material = isGlass
        ? this._materials.gravelGhost
        : this._materials.gravel;
      this._drainMesh.renderOrder = isGlass ? 4 : 0;
    }
    // M-7: 透視モード時は底面反力プリズムの不透明度を下げる
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
    const isBlock = g.wallType === 'large_block';

    const minWeepBase = Math.max(g.t_base, g.embedDepth ?? 0.50);
    const stemClearH = Math.max(0.6, g.H - minWeepBase);
    let yLow = clamp(minWeepBase + Math.max(0.28, stemClearH * 0.17), minWeepBase + 0.22, g.H - 0.55);
    let yHigh = clamp(minWeepBase + Math.min(stemClearH * 0.56, 2.2), yLow + 0.32, g.H - 0.35);

    if (isBlock && g.courses && g.courses.length >= 2) {
      // 根入れ GL より必ず上側（前面土に埋まらない段）を自動選択
      let lowIdx = g.courses.findIndex((c) => 0.5 * (c.y0 + c.y1) >= minWeepBase + 0.16);
      if (lowIdx < 0) lowIdx = Math.max(0, g.courses.length - 2);
      lowIdx = Math.min(lowIdx, g.courses.length - 1);
      const highIdx = clamp(
        Math.max(lowIdx + 1, Math.floor(lowIdx + (g.courses.length - lowIdx) * 0.52)),
        lowIdx,
        g.courses.length - 1
      );
      yLow = 0.5 * (g.courses[lowIdx].y0 + g.courses[lowIdx].y1);
      yHigh = 0.5 * (g.courses[highIdx].y0 + g.courses[highIdx].y1);
    }

    // 厳密に 6 本・対称千鳥配置
    const zCoords = [-3.0, -1.8, -0.6, 0.6, 1.8, 3.0];
    const isClogged = g.waterRatio > 0.001;
    const pipeR = 0.044;
    const slopeTilt = isBlock ? Math.atan(g.frontSlope) : 0;

    zCoords.forEach((zPos, idx) => {
      const isUpper = idx % 2 === 1;
      const yPos = isUpper ? yHigh : yLow;
      const xFrontAtY = this._wallFrontX(g, yPos);
      const xBack = this._stemBackX(g, yPos);
      const xStart = xFrontAtY - 0.025;
      const xEnd = xBack + 0.09;
      const len = Math.max(0.2, xEnd - xStart);
      const xMid = (xStart + xEnd) * 0.5;

      const holeGrp = new THREE.Group();
      if (isBlock && g.hCourse > 0) {
        const cIdx = clamp(Math.floor((yPos - g.t_base) / g.hCourse), 0, Math.max(0, g.nCourses - 1));
        holeGrp.userData.courseIndex = cIdx;
      } else {
        holeGrp.userData.courseIndex = -1;
      }
      this.weepGroup.add(holeGrp);

      // PVC パイプスリーブ（前面へわずかに下り勾配）
      const pipeGeom = new THREE.CylinderGeometry(pipeR, pipeR, len, 14);
      pipeGeom.rotateZ(Math.PI * 0.5 + 0.04);
      const pipeMesh = new THREE.Mesh(pipeGeom, this._materials.pvcPipe);
      pipeMesh.position.set(xMid, yPos, zPos);
      pipeMesh.castShadow = true;
      holeGrp.add(pipeMesh);

      if (isClogged) {
        // 水抜き孔詰まり：警戒赤キャップ＋パルスリング
        const capGeom = new THREE.CylinderGeometry(pipeR * 1.18, pipeR * 1.12, 0.065, 16);
        capGeom.rotateZ(Math.PI * 0.5);
        const capMesh = new THREE.Mesh(capGeom, this._materials.clogCap);
        capMesh.position.set(xStart - 0.012, yPos - 0.005, zPos);
        holeGrp.add(capMesh);

        const ringGeom = new THREE.RingGeometry(pipeR * 1.35, pipeR * 2.15, 20);
        ringGeom.rotateY(-Math.PI * 0.5);
        const ringMat = this._materials.clogHalo.clone();
        ringMat.userData._dynamic = true;
        const ringMesh = new THREE.Mesh(ringGeom, ringMat);
        ringMesh.position.set(xStart - 0.048, yPos - 0.005, zPos);
        ringMesh.userData.phase = idx * 0.85;
        holeGrp.add(ringMesh);
        this._clogPulseMeshes.push(ringMesh);
      } else {
        // 健全排水：開口暗部＋下段パイプからの排水滴り・湿潤すじ
        const boreGeom = new THREE.CircleGeometry(pipeR * 0.78, 14);
        boreGeom.rotateY(-Math.PI * 0.5);
        const boreMesh = new THREE.Mesh(boreGeom, this._materials.pipeBore);
        boreMesh.position.set(xStart - 0.004, yPos - 0.003, zPos);
        holeGrp.add(boreMesh);

        if (!isUpper) {
          // 湿潤すじ（前面コンクリート上のわずかな水跡：前面法勾配＆根入れGLへ追従）
          const streakBotY = minWeepBase + 0.02;
          const streakVertH = Math.max(0.18, yPos - streakBotY);
          const streakLen = isBlock ? streakVertH / Math.cos(slopeTilt) : streakVertH;
          const streakGeom = new THREE.PlaneGeometry(0.11, streakLen);
          streakGeom.rotateY(-Math.PI * 0.5);
          const streakMesh = new THREE.Mesh(streakGeom, this._materials.dampStreak);
          const yMidStreak = yPos - streakVertH * 0.5 - 0.02;
          const xMidStreak = this._wallFrontX(g, yMidStreak) - 0.012;
          streakMesh.position.set(xMidStreak, yMidStreak, zPos);
          if (isBlock) streakMesh.rotation.z = -slopeTilt;
          holeGrp.add(streakMesh);

          // 滴り水滴（2 粒ずつアニメーション）
          for (let d = 0; d < 2; d++) {
            const dropGeom = new THREE.SphereGeometry(0.022, 8, 8);
            dropGeom.scale(0.85, 1.45, 0.85);
            const dropMesh = new THREE.Mesh(dropGeom, this._materials.dripWater);
            dropMesh.position.set(xStart - 0.025, yPos - 0.04, zPos);
            dropMesh.userData = {
              topY: yPos - 0.03,
              botY: minWeepBase + 0.03,
              baseX: xStart - 0.022,
              phase: (idx * 0.37 + d * 0.5) % 1.0,
              speed: 0.62 + (idx % 3) * 0.08,
            };
            holeGrp.add(dropMesh);
            this._dripDrops.push(dropMesh);
          }
        }
      }
    });
  }

  // ==========================================================================
  // 3. 主鉄筋カットアウェイ透視（L型）／ 中詰め・連結ピン透視（大型ブロック）
  // ==========================================================================

  _rebuildRebar() {
    clearGroupGeometries(this.rebarGroup);
    const g = this._geom;

    if (g.wallType === 'large_block') {
      this._rebuildBlockInternalStructure(g);
      return;
    }

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

  /**
   * 大型積みブロックの内部構造透視（中詰め砕石 / 胴込めコン充填コア ＋ 目地連結ピン・噛み合わせキー）
   */
  _rebuildBlockInternalStructure(g) {
    const fillMat = g.fillConcrete ? this._materials.blockFillConc : this._materials.gravel;
    const zMin = BACK_Z + 0.14;
    const zMax = FRONT_Z - 0.14;

    for (let i = 0; i < g.courses.length; i++) {
      const c = g.courses[i];
      const grp = new THREE.Group();
      grp.userData.courseIndex = i;
      this.rebarGroup.add(grp);

      // 平行四辺形ブロック中空部充填コア（前面壁厚 0.20m の奥 〜 背面壁厚 0.12m の手前）
      const xb0 = c.xb0 ?? c.xf0 + g.blockDepth;
      const xb1 = c.xb1 ?? c.xf1 + g.blockDepth;
      const xInBot = c.xf0 + 0.20;
      const xInTop = c.xf1 + 0.20;
      const xOutBot = Math.max(xInBot + 0.12, xb0 - 0.12);
      const xOutTop = Math.max(xInTop + 0.12, xb1 - 0.12);
      const y0 = c.y0 + 0.035;
      const y1 = c.y1 - 0.035;

      if (xOutBot > xInBot + 0.06 && y1 > y0 + 0.06) {
        const coreShape = new THREE.Shape();
        coreShape.moveTo(xInBot, y0);
        coreShape.lineTo(xOutBot, y0);
        coreShape.lineTo(xOutTop, y1);
        coreShape.lineTo(xInTop, y1);
        coreShape.closePath();
        const coreGeom = extrudeXYShape(coreShape, zMax - zMin, zMin, 0.9, 0.9);
        const coreMesh = new THREE.Mesh(coreGeom, fillMat);
        coreMesh.renderOrder = 4;
        grp.add(coreMesh);
      }

      // 噛み合わせキー・連結ピン（hasInterlock ON 時: 各段目地に高視認シアン青ピン＆せん断キー）
      if (g.hasInterlock) {
        const xPinFront = c.xf0 + 0.18;
        const xPinBack = Math.max(xPinFront + 0.18, xb0 - 0.18);
        const xPinMid = 0.5 * (xPinFront + xPinBack);
        const yJoint = c.y0;

        // 水平せん断キー帯（目地全長）
        const keyBarGeom = new THREE.BoxGeometry(0.11, 0.075, zMax - zMin);
        const keyBar = new THREE.Mesh(keyBarGeom, this._materials.interlockPin);
        keyBar.position.set(xPinMid, yJoint, 0);
        keyBar.renderOrder = 11;
        grp.add(keyBar);

        // 鉛直連結ダボピン（Z方向 1.0m ピッチで上下段を貫通締結）
        const pinPos = [];
        const pinNrm = [];
        const nPins = 8;
        for (let k = 0; k < nPins; k++) {
          const pz = BACK_Z + 0.5 + k * 1.0;
          appendCylinderBar(
            pinPos,
            pinNrm,
            xPinFront,
            yJoint - 0.11,
            pz,
            xPinFront,
            yJoint + 0.11,
            pz,
            0.024,
            8
          );
          if (xPinBack - xPinFront > 0.35) {
            appendCylinderBar(
              pinPos,
              pinNrm,
              xPinBack,
              yJoint - 0.11,
              pz,
              xPinBack,
              yJoint + 0.11,
              pz,
              0.024,
              8
            );
          }
        }
        const pinGeom = new THREE.BufferGeometry();
        pinGeom.setAttribute('position', new THREE.Float32BufferAttribute(pinPos, 3));
        pinGeom.setAttribute('normal', new THREE.Float32BufferAttribute(pinNrm, 3));
        const pinMesh = new THREE.Mesh(pinGeom, this._materials.interlockPin);
        pinMesh.renderOrder = 11;
        grp.add(pinMesh);
      }
    }
  }

  // ==========================================================================
  // 4. 基礎砕石・均しコン・基礎地盤・裏込め砕石・背面盛土（beta 追従）・道路/芝
  // ==========================================================================

  _rebuildGroundAndDrain() {
    clearGroupGeometries(this.groundGroup);
    clearGroupGeometries(this.activeWedgeGroup);
    clearGroupGeometries(this.leanConcGroup);
    this._drainMesh = null;
    this._wedgeGeomMeta = null;
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

    // 4-3. カットアウェイ基礎地盤 ＆ 4-4. 前面芝生表層（根入れ深さ Df = g.embedDepth に厳密追従）
    const frontGroundY = clamp(Number(g.embedDepth ?? 0.50), 0.25, Math.max(0.35, g.H - 0.55));
    const grassThick = Math.min(0.08, Math.max(0.04, frontGroundY * 0.22));
    const coversBase = frontGroundY > g.t_base + 0.018;
    let frontSubTopY = frontGroundY - grassThick;
    // 底版上面付近で極薄スライバーや縮退辺が生じないよう安全クランプ
    const subCoversBase = coversBase && frontSubTopY > g.t_base + 0.018;
    if (coversBase && !subCoversBase) {
      frontSubTopY = Math.min(frontSubTopY, g.t_base - 0.006);
    }
    frontSubTopY = Math.max(0.05, frontSubTopY);

    const xFrontBaseEdge = Math.max(-0.01, this._wallFrontX(g, g.t_base + 0.008) - 0.008);
    const xFrontSubTop = Math.max(-0.01, this._wallFrontX(g, frontSubTopY) - 0.008);
    const xFrontGround = Math.max(-0.01, this._wallFrontX(g, frontGroundY) - 0.008);

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
    subShape.lineTo(-0.014, -leanThick);
    if (subCoversBase) {
      // 深い根入れ（Df - grassThick > t_base）：つま先／基礎コン上を越えて壁体前面まで基礎地盤で埋設
      subShape.lineTo(-0.014, g.t_base + 0.008);
      if (xFrontBaseEdge > -0.012) {
        subShape.lineTo(xFrontBaseEdge, g.t_base + 0.008);
      }
      subShape.lineTo(xFrontSubTop, frontSubTopY);
    } else {
      subShape.lineTo(-0.014, frontSubTopY);
    }
    subShape.lineTo(g.X_min, frontSubTopY);
    subShape.closePath();

    const subGeom = extrudeXYShape(subShape, L_Z, BACK_Z, 0.22, 0.22);
    const subMesh = new THREE.Mesh(subGeom, this._materials.subsoil);
    subMesh.receiveShadow = true;
    this.groundGroup.add(subMesh);

    // 4-4. 前面芝生表層（Df > t_base 時はつま先・基礎天端を覆い、Df <= t_base 時は基礎側面露出をリアル再現）
    const frontGrassShape = new THREE.Shape();
    frontGrassShape.moveTo(g.X_min, frontSubTopY);
    if (subCoversBase) {
      frontGrassShape.lineTo(xFrontSubTop, frontSubTopY);
      frontGrassShape.lineTo(xFrontGround, frontGroundY);
    } else if (coversBase) {
      frontGrassShape.lineTo(-0.014, frontSubTopY);
      frontGrassShape.lineTo(-0.014, g.t_base + 0.008);
      if (xFrontBaseEdge > -0.012) {
        frontGrassShape.lineTo(xFrontBaseEdge, g.t_base + 0.008);
      }
      frontGrassShape.lineTo(xFrontGround, frontGroundY);
    } else {
      frontGrassShape.lineTo(-0.014, frontSubTopY);
      frontGrassShape.lineTo(-0.014, frontGroundY);
    }
    frontGrassShape.lineTo(g.X_min, frontGroundY);
    frontGrassShape.closePath();
    const frontGrassGeom = extrudeXYShape(frontGrassShape, L_Z, BACK_Z, 0.42, 0.42);
    const frontGrassMesh = new THREE.Mesh(frontGrassGeom, this._materials.grass);
    frontGrassMesh.receiveShadow = true;
    this.groundGroup.add(frontGrassMesh);

    // 4-4b. 前面法尻・地際の控えめで自然な低木小株・下草アクセント（不自然なトゲを廃止し柔らかな小株造形へ）
    {
      const addTreeOrShrub = (tx, tz, trunkH, crownScale, hasTrunk) => {
        const treeGrp = new THREE.Group();
        treeGrp.position.set(tx, frontGroundY, tz);
        if (hasTrunk) {
          const trunkGeom = new THREE.CylinderGeometry(0.055 * crownScale, 0.095 * crownScale, trunkH, 8);
          const trunk = new THREE.Mesh(trunkGeom, this._materials.treeTrunk);
          trunk.position.y = trunkH * 0.5;
          trunk.castShadow = true;
          trunk.receiveShadow = true;
          treeGrp.add(trunk);
        }
        const blobs = hasTrunk
          ? [
              [0, trunkH + 0.44 * crownScale, 0, 0.56 * crownScale, true],
              [-0.32 * crownScale, trunkH + 0.25 * crownScale, 0.14 * crownScale, 0.40 * crownScale, false],
              [0.30 * crownScale, trunkH + 0.29 * crownScale, -0.12 * crownScale, 0.42 * crownScale, true],
              [0.05 * crownScale, trunkH + 0.72 * crownScale, -0.08 * crownScale, 0.38 * crownScale, false],
            ]
          : [
              [0, 0.22 * crownScale, 0, 0.32 * crownScale, false],
              [0.22 * crownScale, 0.17 * crownScale, 0.10 * crownScale, 0.25 * crownScale, true],
              [-0.20 * crownScale, 0.16 * crownScale, -0.08 * crownScale, 0.23 * crownScale, false],
            ];
        for (const [bx, by, bz, br, isLight] of blobs) {
          const bGeom = new THREE.IcosahedronGeometry(br, 1);
          const bMesh = new THREE.Mesh(
            bGeom,
            isLight ? this._materials.foliageLight : this._materials.foliageDark
          );
          bMesh.position.set(bx, by, bz);
          bMesh.scale.set(1.12, 0.84, 1.06);
          bMesh.castShadow = true;
          bMesh.receiveShadow = true;
          treeGrp.add(bMesh);
        }
        this.groundGroup.add(treeGrp);
      };

      // 奥角の広葉樹1本＋低木2株＋地際の低い草株クラスター（手前断面は100%クリア）
      addTreeOrShrub(g.X_min + 1.05, BACK_Z + 0.92, 1.38, 1.18, true);
      addTreeOrShrub(g.X_min + 2.05, BACK_Z + 0.68, 0, 0.88, false);
      addTreeOrShrub(g.X_min + 0.62, BACK_Z + 1.88, 0, 0.72, false);

      // 壁体前面・法尻沿いの低く柔らかな下草クラスター（3〜4株、Z < +1.2 奥側寄り）
      const tuftSpots = [
        [Math.min(-0.42, xFrontGround - 0.14), BACK_Z + 1.1, 0.32],
        [Math.min(-0.45, xFrontGround - 0.16), BACK_Z + 2.4, 0.26],
        [Math.min(-0.42, xFrontGround - 0.15), -0.35, 0.24],
        [g.X_min + 1.45, BACK_Z + 2.15, 0.28],
      ];
      for (const [tx, tz, sc] of tuftSpots) {
        const cl = new THREE.Group();
        cl.position.set(tx, frontGroundY, tz);
        for (const [ox, oy, oz, r] of [
          [0, 0.08 * sc, 0, 0.26 * sc],
          [0.14 * sc, 0.06 * sc, 0.08 * sc, 0.20 * sc],
          [-0.12 * sc, 0.06 * sc, -0.06 * sc, 0.18 * sc],
        ]) {
          const m = new THREE.Mesh(
            new THREE.IcosahedronGeometry(r, 1),
            this._materials.grassTuft
          );
          m.position.set(ox, oy, oz);
          m.scale.set(1.3, 0.55, 1.2);
          m.receiveShadow = true;
          cl.add(m);
        }
        this.groundGroup.add(cl);
      }
    }

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

    // 4-6. 裏込め砕石ドレーン層 ＆ 4-7. 背面盛土（主働すべり面で2分割） ＆ 4-8. 2層道路舗装/側溝/ガードレール/街灯
    const isRoadMode = g.qSurcharge > 0.5 && g.betaDeg <= 8.0;
    const asphaltThick = 0.09;
    const subbaseThick = 0.21;
    const wearThick = isRoadMode ? asphaltThick + subbaseThick : 0.08;
    const yBackAtMax = this._backGroundY(g, g.X_max);
    const clearGap = 0.014;
    const isRebarNow = Boolean(this.options.showRebar);

    // 道路2層舗装（アスファルト＋砕石路盤・L型側溝・防護柵・街灯）または芝生表層を splitX で 2 分割する共通ヘルパー
    const buildSplitSurface = (xStart, rawSplitX) => {
      const isRoad = isRoadMode;
      const minSplit = xStart + (isRoad ? 0.72 : 0.45);
      const splitX = clamp(rawSplitX, minSplit, g.X_max - 0.55);

      if (isRoad) {
        // ① L型街渠（段差付きコンクリート縁石＋側溝エプロン：崩壊くさび側 activeWedgeGroup）
        const curbX0 = xStart;
        const curbStepX = Math.min(splitX - 0.34, xStart + 0.24);
        const curbX1 = Math.min(splitX - 0.16, curbStepX + 0.24);
        const curbShape = new THREE.Shape();
        curbShape.moveTo(curbX0, g.H - wearThick);
        curbShape.lineTo(curbX1, this._backGroundY(g, curbX1) - wearThick);
        curbShape.lineTo(curbX1, this._backGroundY(g, curbX1) - 0.005);
        curbShape.lineTo(curbStepX, this._backGroundY(g, curbStepX) - 0.015);
        curbShape.lineTo(curbStepX - 0.02, this._backGroundY(g, curbStepX) + 0.11);
        curbShape.lineTo(curbX0, g.H + 0.11);
        curbShape.closePath();
        const curbGeom = extrudeXYShape(curbShape, L_Z, BACK_Z, 0.5, 0.5);
        const curbMesh = new THREE.Mesh(curbGeom, this._materials.curbConcrete);
        curbMesh.castShadow = true;
        curbMesh.receiveShadow = true;
        this.activeWedgeGroup.add(curbMesh);

        // 側溝グレーチング集水桝フタ（2箇所）
        const grateX = (curbStepX + curbX1) * 0.5;
        const grateY = this._backGroundY(g, grateX) - 0.006;
        for (const gz of [-2.1, 1.5]) {
          const gMesh = new THREE.Mesh(
            new THREE.BoxGeometry(Math.max(0.14, curbX1 - curbStepX - 0.03), 0.018, 0.56),
            this._materials.gutterGrate
          );
          gMesh.position.set(grateX, grateY, gz);
          gMesh.rotation.z = g.betaRad;
          this.activeWedgeGroup.add(gMesh);
        }

        // ② 路側Wビームガードレール（日本標準防護柵 Gr-C：activeWedgeGroup に所属し道路ごと傾き陥没！）
        const railX = curbX0 + Math.min(0.12, (curbStepX - curbX0) * 0.5);
        const railBaseY = this._backGroundY(g, railX) + 0.10;
        const postZs = [-3.35, -1.35, 0.65, 2.65];
        const postH = 0.74;
        for (const pz of postZs) {
          const post = new THREE.Mesh(
            new THREE.CylinderGeometry(0.048, 0.052, postH, 12),
            this._materials.guardrailPost
          );
          post.position.set(railX, railBaseY + postH * 0.5 - 0.04, pz);
          post.castShadow = true;
          post.receiveShadow = true;
          this.activeWedgeGroup.add(post);

          // 支柱トップキャップ＋オレンジ反射デリネーター
          const cap = new THREE.Mesh(
            new THREE.CylinderGeometry(0.056, 0.056, 0.025, 12),
            this._materials.guardrailPost
          );
          cap.position.set(railX, railBaseY + postH - 0.035, pz);
          this.activeWedgeGroup.add(cap);

          const refl = new THREE.Mesh(
            new THREE.BoxGeometry(0.025, 0.09, 0.055),
            this._materials.reflectorOrange
          );
          refl.position.set(railX + 0.052, railBaseY + postH - 0.09, pz);
          this.activeWedgeGroup.add(refl);
        }

        // Wビーム波形断面ガードレール本体（Z = -3.72 .. +3.40、手前カットアウェイ面には干渉しない！）
        const wShape = new THREE.Shape();
        wShape.moveTo(0, -0.15);
        wShape.lineTo(0.042, -0.11);
        wShape.lineTo(0.042, -0.045);
        wShape.lineTo(0.012, 0.0);
        wShape.lineTo(0.042, 0.045);
        wShape.lineTo(0.042, 0.11);
        wShape.lineTo(0, 0.15);
        wShape.lineTo(-0.018, 0.14);
        wShape.lineTo(0.022, 0.095);
        wShape.lineTo(0.022, 0.045);
        wShape.lineTo(-0.006, 0.0);
        wShape.lineTo(0.022, -0.045);
        wShape.lineTo(0.022, -0.095);
        wShape.lineTo(-0.018, -0.14);
        wShape.closePath();
        const railLen = 7.12;
        const railGeom = new THREE.ExtrudeGeometry(wShape, { depth: railLen, bevelEnabled: false });
        railGeom.translate(0, 0, -3.72);
        railGeom.computeVertexNormals();
        const railMesh = new THREE.Mesh(railGeom, this._materials.guardrailBeam);
        railMesh.position.set(railX + 0.046, railBaseY + 0.50, 0);
        railMesh.castShadow = true;
        railMesh.receiveShadow = true;
        this.activeWedgeGroup.add(railMesh);

        // ③ 2層道路舗装（上層: アスファルト 0.09m ＋ 下層: 砕石路盤 C-40 0.21m）を splitX で完全 2 分割
        const roadX0 = curbX1;
        const totalRoadW = Math.max(1.0, g.X_max - roadX0);
        const addRoadLayers = (xA, xB, targetGroup) => {
          if (xB - xA < 0.04) return;
          // 砕石路盤層（下層 0.21m）
          const sb = new THREE.Shape();
          sb.moveTo(xA, this._backGroundY(g, xA) - wearThick);
          sb.lineTo(xB, this._backGroundY(g, xB) - wearThick);
          sb.lineTo(xB, this._backGroundY(g, xB) - asphaltThick);
          sb.lineTo(xA, this._backGroundY(g, xA) - asphaltThick);
          sb.closePath();
          const sbGeom = extrudeXYShape(sb, L_Z, BACK_Z, 0.95, 0.95);
          const sbMesh = new THREE.Mesh(sbGeom, this._materials.gravelBase);
          sbMesh.receiveShadow = true;
          targetGroup.add(sbMesh);

          // アスファルト表層（上層 0.09m、白線UV連続）
          const s = new THREE.Shape();
          s.moveTo(xA, this._backGroundY(g, xA) - asphaltThick);
          s.lineTo(xB, this._backGroundY(g, xB) - asphaltThick);
          s.lineTo(xB, this._backGroundY(g, xB));
          s.lineTo(xA, this._backGroundY(g, xA));
          s.closePath();
          const geom = new THREE.ExtrudeGeometry(s, { depth: L_Z, bevelEnabled: false });
          geom.translate(0, 0, BACK_Z);
          geom.computeVertexNormals();
          const posAttr = geom.attributes.position;
          const uvArr = new Float32Array(posAttr.count * 2);
          for (let i = 0; i < posAttr.count; i++) {
            const px = posAttr.getX(i);
            const pz = posAttr.getZ(i);
            uvArr[i * 2] = (px - roadX0) / Math.min(totalRoadW, 6.2);
            uvArr[i * 2 + 1] = (pz + HALF_Z) * 0.25;
          }
          geom.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
          const mesh = new THREE.Mesh(geom, this._materials.road);
          mesh.receiveShadow = true;
          targetGroup.add(mesh);
        };
        addRoadLayers(roadX0, splitX, this.activeWedgeGroup);
        addRoadLayers(splitX, g.X_max, this.groundGroup);

        // ④ 奥側不動路肩の道路照明灯（スケール感演出・Z=-3.48 奥端配置で力学図・車を一切邪魔しない）
        const lampX = clamp(Math.max(splitX + 0.55, g.X_max - 0.85), roadX0 + 0.6, g.X_max - 0.35);
        const lampBaseY = this._backGroundY(g, lampX);
        const lampGrp = new THREE.Group();
        lampGrp.position.set(lampX, lampBaseY, BACK_Z + 0.52);

        const baseFlange = new THREE.Mesh(
          new THREE.CylinderGeometry(0.14, 0.18, 0.16, 12),
          this._materials.gutterGrate
        );
        baseFlange.position.y = 0.08;
        lampGrp.add(baseFlange);

        const poleH = 4.65;
        const pole = new THREE.Mesh(
          new THREE.CylinderGeometry(0.055, 0.095, poleH, 12),
          this._materials.guardrailPost
        );
        pole.position.y = poleH * 0.5;
        pole.castShadow = true;
        lampGrp.add(pole);

        // 道路中央側 (-X) へ伸びるカーブ照明アーム＋LED灯具
        const armCurve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(0, poleH - 0.12, 0),
          new THREE.Vector3(-0.32, poleH + 0.32, 0),
          new THREE.Vector3(-1.12, poleH + 0.42, 0),
        ]);
        const armMesh = new THREE.Mesh(
          new THREE.TubeGeometry(armCurve, 12, 0.036, 8, false),
          this._materials.guardrailPost
        );
        armMesh.castShadow = true;
        lampGrp.add(armMesh);

        const headHousing = new THREE.Mesh(
          new THREE.BoxGeometry(0.56, 0.085, 0.24),
          this._materials.carTrim
        );
        headHousing.position.set(-1.32, poleH + 0.41, 0);
        headHousing.rotation.z = 0.06;
        lampGrp.add(headHousing);

        const ledLens = new THREE.Mesh(
          new THREE.PlaneGeometry(0.46, 0.16),
          this._materials.lampGlow
        );
        ledLens.rotation.x = Math.PI * 0.5;
        ledLens.position.set(-1.32, poleH + 0.362, 0);
        lampGrp.add(ledLens);

        this.groundGroup.add(lampGrp);
      } else {
        const addTurfSlab = (xA, xB, targetGroup) => {
          if (xB - xA < 0.04) return;
          const s = new THREE.Shape();
          s.moveTo(xA, this._backGroundY(g, xA) - wearThick);
          if (g.wallType === 'l_wall' && xA < g.x_back_bot && xB > g.x_back_bot) {
            s.lineTo(g.x_back_bot, g.H - wearThick);
          }
          s.lineTo(xB, this._backGroundY(g, xB) - wearThick);
          s.lineTo(xB, this._backGroundY(g, xB));
          if (g.wallType === 'l_wall' && xA < g.x_back_bot && xB > g.x_back_bot) {
            s.lineTo(g.x_back_bot, g.H);
          }
          s.lineTo(xA, this._backGroundY(g, xA));
          s.closePath();
          const geom = extrudeXYShape(s, L_Z, BACK_Z, 0.36, 0.36);
          const mesh = new THREE.Mesh(geom, this._materials.grass);
          mesh.receiveShadow = true;
          targetGroup.add(mesh);
        };
        addTurfSlab(xStart, splitX, this.activeWedgeGroup);
        addTurfSlab(splitX, g.X_max, this.groundGroup);
      }

      return { splitX, splitY: this._backGroundY(g, splitX) };
    };

    if (g.wallType === 'large_block') {
      // 大型積みブロック用: 前面・背面完全平行の背面に沿う一定厚裏込め砕石ドレーン
      const drainThick = 0.38;
      const drainTopY = Math.max(g.t_base + 0.4, g.H - wearThick - 0.08);
      const xBotIn = g.x_back_bot + clearGap;
      const xTopIn = this._stemBackX(g, drainTopY) + clearGap;
      const xBotOut = Math.max(g.B + clearGap, xBotIn + drainThick);
      const xTopOut = xTopIn + drainThick;
      const yDrainBot = g.t_base + clearGap;

      // 吸出し防止マット（ジオテキスタイル）白破線を手前断面の砕石／盛土境界面へ配置
      const geoPtsB = [
        new THREE.Vector3(xBotOut, yDrainBot, FRONT_Z + 0.012),
        new THREE.Vector3(xTopOut, drainTopY, FRONT_Z + 0.012),
        new THREE.Vector3(xTopIn, drainTopY, FRONT_Z + 0.012),
      ];
      const geoLineB = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(geoPtsB),
        this._materials.geotextileLine
      );
      geoLineB.computeLineDistances();
      geoLineB.renderOrder = 5;
      this.activeWedgeGroup.add(geoLineB);

      const modeNow = this._result?.overall?.primaryFailure || 'none';
      const isJointSlide = modeNow === 'joint_sliding';
      const yJointSplit = isJointSlide
        ? clamp(Number(g.slipOriginY ?? g.t_base), g.t_base, drainTopY - 0.2)
        : 0;
      const useMidSplit = isJointSlide && yJointSplit > yDrainBot + 0.08;

      const xSlipOrigin = useMidSplit
        ? this._stemBackX(g, yJointSplit) + clearGap + drainThick
        : xBotOut;
      const ySlipOrigin = useMidSplit ? yJointSplit : 0.0;
      const minSplitBlock = Math.max(g.x_back_top + 0.65, xTopOut + 0.16);
      const rawSplitX = Math.max(minSplitBlock, g.crackX ?? minSplitBlock + 1.0);
      const { splitX, splitY } = buildSplitSurface(g.x_back_top, rawSplitX);
      const xCrackSub = splitX;
      const yCrackSub = splitY - wearThick;

      if (useMidSplit) {
        // 段間ズレ時: 目地高さ yJointSplit より下は不動 (groundGroup)、上は可動 (activeWedgeGroup)
        const xMidIn = this._stemBackX(g, yJointSplit) + clearGap;
        const xMidOut = xMidIn + drainThick;

        const drainLowShape = new THREE.Shape();
        drainLowShape.moveTo(xBotIn, yDrainBot);
        drainLowShape.lineTo(g.B + clearGap, yDrainBot);
        drainLowShape.lineTo(g.B + clearGap, 0.0);
        drainLowShape.lineTo(xBotOut, 0.0);
        drainLowShape.lineTo(xBotOut, yDrainBot);
        drainLowShape.lineTo(xMidOut, yJointSplit);
        drainLowShape.lineTo(xMidIn, yJointSplit);
        drainLowShape.closePath();
        const drainLowGeom = extrudeXYShape(drainLowShape, L_Z - 0.016, BACK_Z + 0.008, 0.9, 0.9);
        const drainLowMesh = new THREE.Mesh(
          drainLowGeom,
          isRebarNow ? this._materials.gravelGhost : this._materials.gravel
        );
        drainLowMesh.receiveShadow = true;
        this.groundGroup.add(drainLowMesh);

        const drainHighShape = new THREE.Shape();
        drainHighShape.moveTo(xMidIn, yJointSplit);
        drainHighShape.lineTo(xMidOut, yJointSplit);
        drainHighShape.lineTo(xTopOut, drainTopY);
        drainHighShape.lineTo(xTopIn, drainTopY);
        drainHighShape.closePath();
        const drainHighGeom = extrudeXYShape(drainHighShape, L_Z - 0.016, BACK_Z + 0.008, 0.9, 0.9);
        const drainHighMesh = new THREE.Mesh(
          drainHighGeom,
          isRebarNow ? this._materials.gravelGhost : this._materials.gravel
        );
        drainHighMesh.receiveShadow = true;
        drainHighMesh.renderOrder = isRebarNow ? 4 : 0;
        this.activeWedgeGroup.add(drainHighMesh);
        this._drainMesh = drainHighMesh;

        // 上部崩壊盛土くさび (activeWedgeGroup)
        const bfWedge = new THREE.Shape();
        bfWedge.moveTo(xMidOut, yJointSplit);
        bfWedge.lineTo(xCrackSub, yCrackSub);
        bfWedge.lineTo(g.x_back_top + clearGap, g.H - wearThick);
        bfWedge.lineTo(xTopIn, drainTopY);
        bfWedge.lineTo(xTopOut, drainTopY);
        bfWedge.closePath();
        const bfWedgeMesh = new THREE.Mesh(
          extrudeXYShape(bfWedge, L_Z - 0.016, BACK_Z + 0.008, 0.24, 0.24),
          this._materials.backfill
        );
        bfWedgeMesh.receiveShadow = true;
        this.activeWedgeGroup.add(bfWedgeMesh);

        // 下部＋後方不動盛土 (groundGroup)
        const bfFixed = new THREE.Shape();
        bfFixed.moveTo(xBotOut, 0.0);
        bfFixed.lineTo(g.X_max, 0.0);
        bfFixed.lineTo(g.X_max, yBackAtMax - wearThick);
        bfFixed.lineTo(xCrackSub, yCrackSub);
        bfFixed.lineTo(xMidOut, yJointSplit);
        bfFixed.lineTo(xBotOut, yDrainBot);
        bfFixed.closePath();
        const bfFixedMesh = new THREE.Mesh(
          extrudeXYShape(bfFixed, L_Z - 0.016, BACK_Z + 0.008, 0.24, 0.24),
          this._materials.backfill
        );
        bfFixedMesh.receiveShadow = true;
        this.groundGroup.add(bfFixedMesh);
      } else {
        // 基礎底面／1段目目地基準の全体崩壊くさび
        const drainShape = new THREE.Shape();
        drainShape.moveTo(xBotIn, yDrainBot);
        drainShape.lineTo(g.B + clearGap, yDrainBot);
        drainShape.lineTo(g.B + clearGap, 0.0);
        drainShape.lineTo(xBotOut, 0.0);
        drainShape.lineTo(xBotOut, yDrainBot);
        drainShape.lineTo(xTopOut, drainTopY);
        drainShape.lineTo(xTopIn, drainTopY);
        drainShape.closePath();

        const drainGeom = extrudeXYShape(drainShape, L_Z - 0.016, BACK_Z + 0.008, 0.9, 0.9);
        const drainMesh = new THREE.Mesh(
          drainGeom,
          isRebarNow ? this._materials.gravelGhost : this._materials.gravel
        );
        drainMesh.receiveShadow = true;
        drainMesh.renderOrder = isRebarNow ? 4 : 0;
        this.activeWedgeGroup.add(drainMesh);
        this._drainMesh = drainMesh;

        // 崩壊くさび盛土 (activeWedgeGroup)
        const bfWedge = new THREE.Shape();
        bfWedge.moveTo(xBotOut, 0.0);
        bfWedge.lineTo(xCrackSub, yCrackSub);
        bfWedge.lineTo(g.x_back_top + clearGap, g.H - wearThick);
        bfWedge.lineTo(xTopIn, drainTopY);
        bfWedge.lineTo(xTopOut, drainTopY);
        bfWedge.lineTo(xBotOut, yDrainBot);
        bfWedge.closePath();
        const bfWedgeMesh = new THREE.Mesh(
          extrudeXYShape(bfWedge, L_Z - 0.016, BACK_Z + 0.008, 0.24, 0.24),
          this._materials.backfill
        );
        bfWedgeMesh.receiveShadow = true;
        this.activeWedgeGroup.add(bfWedgeMesh);

        // 不動側盛土 (groundGroup)
        const bfFixed = new THREE.Shape();
        bfFixed.moveTo(xBotOut, 0.0);
        bfFixed.lineTo(g.X_max, 0.0);
        bfFixed.lineTo(g.X_max, yBackAtMax - wearThick);
        bfFixed.lineTo(xCrackSub, yCrackSub);
        bfFixed.closePath();
        const bfFixedMesh = new THREE.Mesh(
          extrudeXYShape(bfFixed, L_Z - 0.016, BACK_Z + 0.008, 0.24, 0.24),
          this._materials.backfill
        );
        bfFixedMesh.receiveShadow = true;
        this.groundGroup.add(bfFixedMesh);
      }

      this._wedgeGeomMeta = {
        originX: xSlipOrigin,
        originY: ySlipOrigin,
        splitX,
        splitY,
        slipRad: Math.atan2(Math.max(0.2, splitY - ySlipOrigin), Math.max(0.2, splitX - xSlipOrigin)),
      };
      return;
    }

    // L型擁壁用 4-6. 裏込め砕石ドレーン層（崩壊くさび側 activeWedgeGroup に統合）
    const drainThick = clamp(g.B_heel * 0.3, 0.24, 0.46);
    const drainTopY = Math.max(g.t_base + 0.4, g.H - wearThick - 0.08);
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

    const drainGeom = extrudeXYShape(drainShape, L_Z - 0.016, BACK_Z + 0.008, 0.9, 0.9);
    const drainMesh = new THREE.Mesh(
      drainGeom,
      isRebarNow ? this._materials.gravelGhost : this._materials.gravel
    );
    drainMesh.receiveShadow = true;
    drainMesh.renderOrder = isRebarNow ? 4 : 0;
    this.activeWedgeGroup.add(drainMesh);
    this._drainMesh = drainMesh;

    // 吸出し防止マット（ジオテキスタイル）白破線を手前断面の砕石／盛土境界面へ配置
    const geoPtsL = [
      new THREE.Vector3(xDrainPadOut, g.t_base + 0.18, FRONT_Z + 0.012),
      new THREE.Vector3(xDrainBotIn + drainThick, g.t_base + 0.22, FRONT_Z + 0.012),
      new THREE.Vector3(xDrainTopIn + drainThick, drainTopY, FRONT_Z + 0.012),
      new THREE.Vector3(xDrainTopIn, drainTopY, FRONT_Z + 0.012),
    ];
    const geoLineL = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(geoPtsL),
      this._materials.geotextileLine
    );
    geoLineL.computeLineDistances();
    geoLineL.renderOrder = 5;
    this.activeWedgeGroup.add(geoLineL);

    // 4-8 ＆ 4-7: L型擁壁の主働すべり面 (B, 0) -> (splitX, splitY) で盛土・道路を完全2分割
    const minSplitL = Math.max(g.B + 0.45, xDrainTopIn + drainThick + 0.25);
    const rawSplitXL = Math.max(minSplitL, g.crackX ?? minSplitL + 1.0);
    const { splitX, splitY } = buildSplitSurface(g.x_back_top, rawSplitXL);
    const xCrackSub = splitX;
    const yCrackSub = splitY - wearThick;

    // 崩壊くさび側盛土 (かかと上土塊＋主働くさび三角形 → activeWedgeGroup)
    const bfWedgeShape = new THREE.Shape();
    bfWedgeShape.moveTo(xDrainPadOut, yDrainBot);
    bfWedgeShape.lineTo(g.B + clearGap, yDrainBot);
    bfWedgeShape.lineTo(g.B + clearGap, 0.0);
    bfWedgeShape.lineTo(xCrackSub, yCrackSub);
    bfWedgeShape.lineTo(g.x_back_bot + clearGap, g.H - wearThick);
    bfWedgeShape.lineTo(g.x_back_top + clearGap, g.H - wearThick);
    bfWedgeShape.lineTo(xDrainTopIn, drainTopY);
    bfWedgeShape.lineTo(xDrainTopIn + drainThick, drainTopY);
    bfWedgeShape.lineTo(xDrainBotIn + drainThick, g.t_base + 0.22);
    bfWedgeShape.lineTo(xDrainPadOut, g.t_base + 0.18);
    bfWedgeShape.closePath();

    const bfWedgeGeom = extrudeXYShape(bfWedgeShape, L_Z - 0.016, BACK_Z + 0.008, 0.24, 0.24);
    const bfWedgeMesh = new THREE.Mesh(bfWedgeGeom, this._materials.backfill);
    bfWedgeMesh.receiveShadow = true;
    this.activeWedgeGroup.add(bfWedgeMesh);

    // 不動地盤側盛土（すべり面より後方 → groundGroup）
    const bfFixedShape = new THREE.Shape();
    bfFixedShape.moveTo(g.B + clearGap, 0.0);
    bfFixedShape.lineTo(g.X_max, 0.0);
    bfFixedShape.lineTo(g.X_max, yBackAtMax - wearThick);
    bfFixedShape.lineTo(xCrackSub, yCrackSub);
    bfFixedShape.closePath();

    const bfFixedGeom = extrudeXYShape(bfFixedShape, L_Z - 0.016, BACK_Z + 0.008, 0.24, 0.24);
    const bfFixedMesh = new THREE.Mesh(bfFixedGeom, this._materials.backfill);
    bfFixedMesh.receiveShadow = true;
    this.groundGroup.add(bfFixedMesh);

    this._wedgeGeomMeta = {
      originX: g.B + clearGap,
      originY: 0.0,
      splitX,
      splitY,
      slipRad: Math.atan2(Math.max(0.2, splitY), Math.max(0.2, splitX - (g.B + clearGap))),
    };
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

    // ▽ 水位三角シンボル (手前断面: 背面盛土内)
    const triX = Math.min(g.X_max - 0.6, Math.max(g.B, xAtWater) + 0.9);
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
      const carX = clamp(g.x_back_top + 1.82, g.x_back_top + 1.55, g.X_max - 1.15);
      const carY = this._backGroundY(g, carX);
      this._carGroup.position.set(carX, carY, -0.75);
      this._carGroup.rotation.set(0, 0, g.betaRad);
      this._carBasePose = { x: carX, y: carY, rotZ: g.betaRad, visible: true };
    } else {
      this._carBasePose = { x: 0, y: 0, rotZ: 0, visible: false };
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
    // 7-1. 仮想背面 (L型: X = B) ／ 土圧作用面 (大型ブロック: 傾斜背面 α)
    // ------------------------------------------------------------------------
    const xPlaneBot = this._backPlaneX(g, 0);
    const xPlaneTop = this._backPlaneX(g, g.H_v);
    const planeDx = xPlaneTop - xPlaneBot;
    const planeLen = Math.hypot(planeDx, g.H_v);
    const planeTilt = Math.atan2(planeDx, g.H_v);

    const vbPlaneGeom = new THREE.PlaneGeometry(L_Z, planeLen);
    vbPlaneGeom.rotateY(Math.PI * 0.5);
    const vbPlane = new THREE.Mesh(vbPlaneGeom, this._materials.virtualBackPlane);
    vbPlane.position.set(0.5 * (xPlaneBot + xPlaneTop), g.H_v * 0.5, 0);
    vbPlane.rotation.z = -planeTilt;
    vbPlane.renderOrder = 6;
    this.forcesGroup.add(vbPlane);

    const vbFrontLineGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(xPlaneBot, 0, FRONT_Z + 0.045),
      new THREE.Vector3(this._backPlaneX(g, g.H_v + 0.25), g.H_v + 0.25, FRONT_Z + 0.045),
    ]);
    const vbFrontLine = new THREE.Line(vbFrontLineGeom, this._materials.virtualBackDash);
    vbFrontLine.computeLineDistances();
    vbFrontLine.renderOrder = 9;
    this.forcesGroup.add(vbFrontLine);

    const vbTopLineGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(xPlaneTop, g.H_v + 0.03, BACK_Z),
      new THREE.Vector3(xPlaneTop, g.H_v + 0.03, FRONT_Z),
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

    const xBase = ysAll.map((y) => this._backPlaneX(g, y));
    const xAfterEarth = ysAll.map((y, idx) => xBase[idx] + this._sampleProfile(earthPts, y) * pScale);
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
      const qX0 = (g.wallType === 'large_block' ? g.x_back_top : g.x_back_bot) + 0.08;
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
            this._backPlaneX(g, y) +
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
      const xCG = g.xCG_wall ?? g.B * 0.52;
      const yCG = g.yCG_wall ?? g.H * 0.5;
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
    this.activeWedgeGroup.position.set(0, 0, 0);
    this.activeWedgeGroup.rotation.set(0, 0, 0);
    if (this._carBasePose && this._carBasePose.visible) {
      this._carGroup.position.set(this._carBasePose.x, this._carBasePose.y, -0.75);
      this._carGroup.rotation.set(0, 0, this._carBasePose.rotZ);
    }
    if (this._courseGroups && this._courseGroups.length > 0) {
      for (const cg of this._courseGroups) {
        cg.position.set(0, 0, 0);
        cg.rotation.set(0, 0, 0);
      }
    }
    if (this._capGroup) {
      this._capGroup.position.set(0, 0, 0);
      this._capGroup.rotation.set(0, 0, 0);
    }
    for (const child of this.weepGroup.children) {
      child.position.x = 0;
    }
    for (const child of this.rebarGroup.children) {
      child.position.x = 0;
    }
    this._hasActiveCourseOffset = false;
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
    this._resetWallPose();
    this._failureHandles.mode = mode;
    this.failureFxGroup.visible = true;

    if (mode === 'joint_sliding' && g.wallType === 'large_block' && g.courses && g.courses.length > 0) {
      // --- 段間滑動（目地ズレ）破壊 FX: クリティカル目地すべり赤帯＋ズレ矢印＋上段背面V字亀裂 ---
      const jc = this._result?.checks?.joint;
      const critIdx = clamp(Number(jc?.criticalCourseIndex ?? 0), 0, g.courses.length - 1);
      const cCrit = g.courses[critIdx];
      const yJoint = cCrit.y0;
      const xfJ = cCrit.xf0;
      const xbJ = cCrit.xb0 ?? cCrit.xf0 + g.blockDepth;
      const jWidth = Math.max(0.5, xbJ - xfJ);
      this._failureHandles.criticalCourseIndex = critIdx;

      const slipBandGeom = new THREE.BoxGeometry(jWidth + 0.42, 0.056, L_Z + 0.14);
      const slipBand = new THREE.Mesh(slipBandGeom, this._materials.failureWedge);
      slipBand.position.set(xfJ + jWidth * 0.5 - 0.14, yJoint, 0);
      slipBand.renderOrder = 11;
      this.failureFxGroup.add(slipBand);
      this._failureHandles.slipBand = slipBand;

      const arrowsGrp = new THREE.Group();
      const nA = 3;
      for (let i = 0; i < nA; i++) {
        const ax = xfJ + jWidth * (0.22 + i * 0.28);
        const arr = buildArrowMesh(
          new THREE.Vector3(ax + 0.36, yJoint + 0.06, FRONT_Z + 0.16),
          new THREE.Vector3(ax - 0.34, yJoint + 0.06, FRONT_Z + 0.16),
          0.036,
          0.105,
          0.24,
          this._materials.failureRedGlow
        );
        if (arr) arrowsGrp.add(arr);
      }
      this.failureFxGroup.add(arrowsGrp);
      this._failureHandles.slideArrows = arrowsGrp;

      // 目地高さ yJoint .. H の上段背面 V 字開口亀裂ウェッジ
      const upperH = Math.max(0.4, g.H - yJoint);
      const xBackJoint = this._stemBackX(g, yJoint);
      const taperDx = xBackJoint - g.x_back_top;
      const taperLen = Math.hypot(taperDx, upperH);
      const taperAngle = Math.atan2(taperDx, upperH);

      const vShape = new THREE.Shape();
      vShape.moveTo(0, 0);
      vShape.lineTo(0, taperLen);
      vShape.lineTo(-1.0, taperLen);
      vShape.lineTo(-0.35, 0);
      vShape.closePath();

      const vGeom = new THREE.ExtrudeGeometry(vShape, { depth: L_Z - 0.024, bevelEnabled: false });
      vGeom.translate(0, 0, BACK_Z + 0.012);
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

      const vOutPts = [
        new THREE.Vector3(-0.35, 0, FRONT_Z + 0.025),
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

      crackGrp.position.set(xBackJoint + 0.008, yJoint + 0.008, 0);
      crackGrp.rotation.z = taperAngle;
      crackGrp.scale.x = 0.001;
      this.failureFxGroup.add(crackGrp);
      this._failureHandles.crackGap = crackGrp;
    } else if (mode === 'sliding') {
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

      // M-8: つま先前面の赤警告押し出し帯（根入れ深さ Df に対応した前面土への受働圧縮を表示）
      const pushW = 0.72;
      const pushH = Math.max(0.30, (g.embedDepth ?? g.t_base) + 0.08);
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
            (g.x_front_top ?? g.x_front) - Math.sin(a) * rad + 0.2,
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
      // --- 支持力不足 FX (M-10): つま先めり込み＋前面地盤 GL(Df) せん断隆起マウンド＋すべり円弧 ---
      const frontGL = g.embedDepth ?? g.t_base;
      const maxFrontAvail = Math.max(1.8, -g.X_min - 0.55);
      const heaveW = Math.min(2.15, maxFrontAvail);
      const heaveShape = new THREE.Shape();
      heaveShape.moveTo(-heaveW, 0);
      heaveShape.quadraticCurveTo(-heaveW * 0.48, 1.0, -0.02, 0.12);
      heaveShape.lineTo(-0.02, 0);
      heaveShape.closePath();

      const heaveGeom = extrudeXYShape(heaveShape, L_Z - 0.02, BACK_Z + 0.01, 0.35, 0.35);
      const heaveMesh = new THREE.Mesh(heaveGeom, this._materials.grass);
      heaveMesh.position.set(0, frontGL - 0.01, 0);
      heaveMesh.scale.y = 0.001;
      heaveMesh.castShadow = true;
      heaveMesh.receiveShadow = true;
      this.failureFxGroup.add(heaveMesh);
      this._failureHandles.heaveMound = heaveMesh;

      // M-10: プランドトルすべり円弧の出口 X を必ず X_min + 0.40 以内に収容＆前面GL(Df)へ接続
      const xExitLimit = g.X_min + 0.65;
      const xExit = clamp(-heaveW * 0.88, xExitLimit, -1.45);
      const yDeep = Math.max(g.Y_bot + 0.65, -Math.min(1.08, 0.27 * g.H));
      const slipPts = [
        new THREE.Vector3(Math.min(g.B * 0.44, 1.15), -0.04, FRONT_Z + 0.09),
        new THREE.Vector3(0.08, yDeep * 0.72, FRONT_Z + 0.09),
        new THREE.Vector3(xExit * 0.4, yDeep, FRONT_Z + 0.09),
        new THREE.Vector3(xExit * 0.8, yDeep * 0.44, FRONT_Z + 0.09),
        new THREE.Vector3(xExit, frontGL - 0.02, FRONT_Z + 0.09),
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
        new THREE.Vector3(0.18, Math.max(g.t_base, frontGL) + 0.62, FRONT_Z + 0.14),
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

    // --- 全破壊モード共通：背面主働すべり面（赤破線＋斜めすべり矢印）＆ 道路縦断クラック帯 ---
    const meta = this._wedgeGeomMeta;
    if (meta && Number.isFinite(meta.splitX) && Number.isFinite(meta.originX)) {
      const ox = meta.originX;
      const oy = meta.originY;
      const sx = meta.splitX;
      const sy = meta.splitY;
      const dx = sx - ox;
      const dy = sy - oy;
      const slipLen = Math.hypot(dx, dy);

      if (slipLen > 0.35) {
        // 1. 手前断面 (Z = +4.036) の主働すべり面 赤破線
        const slipLinePts = [
          new THREE.Vector3(ox, oy, FRONT_Z + 0.036),
          new THREE.Vector3(sx, sy + 0.01, FRONT_Z + 0.036),
        ];
        const slipLineGeom = new THREE.BufferGeometry().setFromPoints(slipLinePts);
        const slipLine = new THREE.Line(slipLineGeom, this._materials.slipDashLine);
        slipLine.computeLineDistances();
        slipLine.renderOrder = 12;
        this.failureFxGroup.add(slipLine);

        // 2. すべり面に沿う斜め下前方の赤矢印 2 本（くさび滑落方向）
        const slipArrowsGrp = new THREE.Group();
        const ux = dx / slipLen;
        const uy = dy / slipLen;
        for (const frac of [0.36, 0.70]) {
          const mx = ox + dx * frac;
          const my = oy + dy * frac;
          const arr = buildArrowMesh(
            new THREE.Vector3(mx + ux * 0.28, my + uy * 0.28, FRONT_Z + 0.085),
            new THREE.Vector3(mx - ux * 0.34, my - uy * 0.34, FRONT_Z + 0.085),
            0.028,
            0.082,
            0.20,
            this._materials.failureRedGlow
          );
          if (arr) {
            arr.renderOrder = 13;
            slipArrowsGrp.add(arr);
          }
        }
        this.failureFxGroup.add(slipArrowsGrp);
        this._failureHandles.slipArrows = slipArrowsGrp;

        // 3. すべり面のうっすら赤いせん断帯プレート（断面を貫く3Dすべり面可視化）
        const planeTilt = Math.atan2(dx, dy);
        const slipPlateGeom = new THREE.PlaneGeometry(L_Z - 0.04, slipLen);
        slipPlateGeom.rotateY(Math.PI * 0.5);
        const slipPlate = new THREE.Mesh(slipPlateGeom, this._materials.slipPlaneGlow);
        slipPlate.position.set(0.5 * (ox + sx), 0.5 * (oy + sy), 0);
        slipPlate.rotation.z = -planeTilt;
        slipPlate.renderOrder = 8;
        this.failureFxGroup.add(slipPlate);

        // 4. 道路／法面上の縦断クラック帯（Z = -4 .. +4 全幅にギザギザ亀裂＋赤警告縁）
        const crackGrp = new THREE.Group();
        const crackRibbon = new THREE.Mesh(
          new THREE.BoxGeometry(1.0, 0.024, L_Z + 0.02),
          this._materials.roadCrackDark
        );
        crackRibbon.position.set(-0.5, 0.008, 0);
        crackRibbon.renderOrder = 10;
        crackGrp.add(crackRibbon);

        // ギザギザの舗装クラック赤警告ライン（手前〜奥へジグザグ）
        const zigPts = [];
        const nZig = 24;
        for (let iz = 0; iz <= nZig; iz++) {
          const z = BACK_Z + (iz / nZig) * L_Z;
          const jitter = (iz % 2 === 0 ? -0.35 : 0.05) + Math.sin(iz * 2.3) * 0.14;
          zigPts.push(new THREE.Vector3(jitter, 0.024, z));
        }
        const zigLine = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(zigPts),
          this._materials.failureCrackEdge
        );
        zigLine.renderOrder = 12;
        crackGrp.add(zigLine);

        crackGrp.position.set(sx, sy, 0);
        crackGrp.rotation.z = g.betaRad;
        crackGrp.scale.set(0.001, 1, 1);
        this.failureFxGroup.add(crackGrp);
        this._failureHandles.roadCrackStrip = crackGrp;
      }
    }
  }

  /**
   * 擁壁変位と土質力学的に連動する背面主働崩壊くさび（盛土・裏込め砕石・縁石・道路）＆乗用車の変位更新
   */
  _applyWedgeAndCarPose(dxWedge, dyWedge, wedgeTilt, ampNorm) {
    const meta = this._wedgeGeomMeta;
    if (!meta) return;

    const px = meta.splitX;
    const py = meta.splitY;
    const c = Math.cos(wedgeTilt);
    const s = Math.sin(wedgeTilt);

    // ピボット (px, py) まわりに前傾 +wedgeTilt（左側＝擁壁側が沈む）しつつ、斜め下前方 (-dxWedge, -dyWedge) へ滑落
    const posX = px - (px * c - py * s) - dxWedge;
    const posY = py - (px * s + py * c) - dyWedge;
    this.activeWedgeGroup.position.set(posX, posY, 0);
    this.activeWedgeGroup.rotation.set(0, 0, wedgeTilt);

    if (Math.abs(dxWedge) > 1e-5 || Math.abs(dyWedge) > 1e-5 || Math.abs(wedgeTilt) > 1e-5) {
      this._hasActiveCourseOffset = true;
    }

    // 道路縦断クラック帯の幅をくさび開口に同期
    if (this._failureHandles.roadCrackStrip) {
      const crackOpenW = Math.max(0.001, dxWedge * 1.15 + 0.04 * ampNorm);
      this._failureHandles.roadCrackStrip.scale.set(crackOpenW, 1, 1);
    }
    // すべり面矢印をわずかに下前方へ脈動スライド
    if (this._failureHandles.slipArrows) {
      this._failureHandles.slipArrows.position.set(-dxWedge * 0.45, -dyWedge * 0.45, 0);
    }

    // 乗用車（上載荷重）の路面追従：クラックより擁壁側にあれば一緒に陥没・前傾！
    if (this._carBasePose && this._carBasePose.visible) {
      const bx = this._carBasePose.x;
      const by = this._carBasePose.y;
      const br = this._carBasePose.rotZ;

      if (bx <= px - 0.25) {
        // 完全に崩壊くさび上の道路：activeWedgeGroup と同一の剛体変換で連動陥没・前傾
        const rx = bx * c - by * s + posX;
        const ry = bx * s + by * c + posY;
        this._carGroup.position.set(rx, ry, -0.75);
        this._carGroup.rotation.set(0, 0, br + wedgeTilt);
      } else if (bx < px + 0.85) {
        // クラック段差を跨いでいる：前輪が陥没側へ落ち込み車体が傾く
        const t = clamp((px + 0.85 - bx) / 1.10, 0, 1);
        const rx = bx - dxWedge * t * 0.7;
        const ry = by - dyWedge * t * 0.65;
        const extraPitch = Math.atan2(dyWedge * t * 0.75, 1.8) + wedgeTilt * t * 0.6;
        this._carGroup.position.set(rx, ry, -0.75);
        this._carGroup.rotation.set(0, 0, br + extraPitch);
      } else {
        // 不動側道路上：静止
        this._carGroup.position.set(bx, by, -0.75);
        this._carGroup.rotation.set(0, 0, br);
      }
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
    const slipRad = this._wedgeGeomMeta?.slipRad ?? degToRad(g.slipAngleDeg ?? 60);
    const tanSlip = Math.tan(slipRad);

    if (mode === 'joint_sliding' && g.wallType === 'large_block' && this._courseGroups.length > 0) {
      // 大型ブロック段間ズレ（目地滑動）: クリティカル目地より上段＋笠コン＋該当水抜き孔/内部構造のみ前へスライド
      const critIdx = clamp(
        Number(this._failureHandles.criticalCourseIndex ?? 0),
        0,
        this._courseGroups.length - 1
      );
      const slideDist = a * (0.16 + 0.14 * severity);
      this.wallGroup.position.set(0, 0, 0);
      this.wallGroup.rotation.set(0, 0, 0);
      this.leanConcGroup.position.set(0, 0, 0);
      this.leanConcGroup.rotation.set(0, 0, 0);

      for (let i = 0; i < this._courseGroups.length; i++) {
        this._courseGroups[i].position.set(i >= critIdx ? -slideDist : 0, 0, 0);
      }
      if (this._capGroup) {
        this._capGroup.position.set(-slideDist, 0, 0);
      }
      for (const child of this.weepGroup.children) {
        const cIdx = child.userData?.courseIndex ?? -1;
        child.position.x = cIdx >= critIdx ? -slideDist : 0;
      }
      for (const child of this.rebarGroup.children) {
        const cIdx = child.userData?.courseIndex ?? -1;
        child.position.x = cIdx >= critIdx ? -slideDist : 0;
      }
      this._hasActiveCourseOffset = slideDist > 1e-5;

      // 背面くさび＆道路も上段ズレに連動して斜め下へ陥没
      const dxW = slideDist * 0.78;
      const dyW = Math.min(0.36, dxW * tanSlip * 0.62);
      this._applyWedgeAndCarPose(dxW, dyW, a * 0.016, a);

      if (this._failureHandles.slideArrows) {
        this._failureHandles.slideArrows.position.x = -slideDist * 0.65;
      }
      if (this._failureHandles.crackGap) {
        this._failureHandles.crackGap.scale.x = Math.max(0.001, slideDist * 0.36);
      }
    } else if (mode === 'sliding') {
      // M-8: 誇張しすぎない自然な滑動変位量 (0.21..0.32m)
      const slideDist = a * (0.17 + 0.15 * severity);
      this.wallGroup.position.set(-slideDist, 0, 0);
      this.wallGroup.rotation.set(0, 0, 0);
      this.leanConcGroup.position.set(0, 0, 0);
      this.leanConcGroup.rotation.set(0, 0, 0);

      // 主働すべりくさび＆道路がすべり面に沿って斜め下へ滑落・段差陥没
      const dxW = slideDist * 0.80;
      const dyW = Math.min(0.42, dxW * tanSlip * 0.65);
      this._applyWedgeAndCarPose(dxW, dyW, a * 0.014, a);

      if (this._failureHandles.slideArrows) {
        this._failureHandles.slideArrows.position.x = -slideDist * 0.65;
      }
      if (this._failureHandles.crackGap) {
        this._failureHandles.crackGap.scale.x = Math.max(0.001, slideDist * 0.34);
      }
      if (this._failureHandles.frontPushBand) {
        const sx = Math.max(0.001, 0.35 + a * 0.72);
        const sy = Math.max(0.001, 0.3 + a * 0.85);
        this._failureHandles.frontPushBand.position.x = -slideDist - 0.01;
        this._failureHandles.frontPushBand.scale.set(sx, sy, 1);
      }
    } else if (mode === 'overturning') {
      // M-9: 転倒傾き角 (3.4°..6.0°) ＋ 背面くさび＆道路の連動陥没・前傾！
      const tiltRad = a * (0.052 + 0.052 * severity);
      this.wallGroup.position.set(0, 0, 0);
      this.wallGroup.rotation.set(0, 0, tiltRad);
      this.leanConcGroup.position.set(0, 0, 0);
      this.leanConcGroup.rotation.set(0, 0, 0);

      const dxTop = g.H * Math.sin(tiltRad);
      const dxW = dxTop * 0.62;
      const dyW = Math.min(0.45, dxW * tanSlip * 0.64);
      const wedgeTilt = tiltRad * 0.44;
      this._applyWedgeAndCarPose(dxW, dyW, wedgeTilt, a);

      if (this._failureHandles.upliftWedge) {
        this._failureHandles.upliftWedge.scale.y = Math.max(0.001, g.B * Math.sin(tiltRad));
      }
      if (this._failureHandles.overturnBackShadow) {
        this._failureHandles.overturnBackShadow.scale.x = Math.max(
          0.001,
          (g.H - g.t_base) * Math.sin(tiltRad) * 0.36
        );
      }
      if (this._failureHandles.pivotRing) {
        const s = 1.0 + 0.16 * Math.sin(this._elapsed * 6.0);
        this._failureHandles.pivotRing.scale.set(s, s, 1);
      }
    } else if (mode === 'bearing') {
      // M-10: つま先めり込み沈下＋前面隆起＋背面道路の連動陥没・クラック！
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

      const dxTop = g.H * Math.sin(tiltRad);
      const dxW = dxTop * 0.56;
      const dyW = Math.min(0.42, sinkY * 0.55 + dxW * tanSlip * 0.52);
      this._applyWedgeAndCarPose(dxW, dyW, tiltRad * 0.46, a);

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
