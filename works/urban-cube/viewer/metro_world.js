/**
 * TOKYO REALITY 2030 — 1.0km × 1.0km リアル東京広域都市 ＆ 広域地下インフラ解剖 3Dエンジン (v4)
 *
 * 第2回品質改善ループ完全版:
 * 1. 4096×4096 超高精細地表 ＋ 全主要交差点 1024×1024 専用3Dデカール（ゼブラ・左側通行停止線・2連ダイヤ◇・矢印・自転車矢羽根・黄色点字ブロック・マンホール）
 * 2. 厳密左側通行・対岸正面視認の3D日本式横型3灯LED信号機 ＋ 縦型歩行者信号 ＋ 青看板テクスチャ ＋ 歩道ガードパイプ ＋ 多層有機クラウン街路樹＆植樹桝
 * 3. 日本仕様の土木構造物＆橋梁:
 *    - 首都高スタイル鋼箱桁＆耐震T型RC橋脚＆高精細「緑の案内標識」門型ゲート（東西・南北両軸）＆接線完全整合JCT曲線ランプ（壁高欄・分岐クッションドラム付）
 *    - 隅田川スタイル「ニールセンローゼ・タイドアーチ鋼橋」（ジャパンブルー補剛桁・上横構クロスブレース・水切り小判型RC橋脚・橋上照明）
 *    - 東京港スタイル「2層トラス補剛吊り橋（レインボーブリッジ風）」（懸垂線ケーブル完全定着・Xブレース主塔・壁高欄＆橋上照明・航路標識灯・東岸護岸接続）
 *    - 東京駅／高輪GW風ターミナル駅舎＆駅前ロータリー
 * 4. 厳選リアル東京建築（過密ゼロ・L字複合＆セットバック・超高層赤い航空障害灯）＋ ナイト／夕景／デイ連動の地面＆歩道トーン最適化
 * 5. 地上と連動する「1.0km 広域地下空間ネットワーク」＋ 地上建築＆舗装クリスタル透過「広域地下X-Ray」（ターミナル多層地下駅・地下街・隅田川直下シールド・遊水地取水立坑→大深度地下調節池→隅田川排水機場建屋＆放流立坑・支持杭群）
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Colab NVIDIA L4 GPU で生成した実写系シームレス PBR テクスチャ一式を読み込むローダー
function loadGpuPbrSet() {
  const loader = new THREE.TextureLoader();
  const loadTex = (file, isColor, rx = 1, ry = 1) => {
    const t = loader.load(`./assets/pbr/${file}?v=20261127-1`);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
    t.anisotropy = 8;
    if (isColor) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return {
    foliageAlbedo: loadTex('foliage_leaf_albedo.png', true, 2, 2),
    foliageNormal: loadTex('foliage_leaf_normal.png', false, 2, 2),
    concreteAlbedo: loadTex('concrete_arch_albedo.png', true, 2, 2),
    concreteNormal: loadTex('concrete_arch_normal.png', false, 2, 2),
    graniteAlbedo: loadTex('tokyo_granite_albedo.png', true, 3, 1),
    graniteNormal: loadTex('tokyo_granite_normal.png', false, 3, 1),
  };
}

// 流線型カスタム3D自動車メッシュ群（ExtrudeGeometry傾斜ボディ・ダークキャビンガラス・4輪タイヤ・左右分離ツインヘッドライト・リアLEDバー）
function createStreamlinedVehicleGeometries() {
  // 横断面プロファイル (+X=前, +Y=上)
  const sh = new THREE.Shape();
  sh.moveTo(-2.10, 0.24);
  sh.lineTo(2.12, 0.24);   // 下部アンダースカート
  sh.lineTo(2.16, 0.56);   // フロントバンパー
  sh.lineTo(1.88, 0.80);   // 傾斜ボンネット前端
  sh.lineTo(0.88, 0.90);   // ボンネット後端
  sh.lineTo(0.28, 1.44);   // 傾斜フロントガラス上端
  sh.lineTo(-0.92, 1.44);  // 流線ルーフ
  sh.lineTo(-1.58, 0.94);  // 傾斜リアウィンドウ下端
  sh.lineTo(-2.08, 0.86);  // トランク後端
  sh.lineTo(-2.14, 0.42);  // リアバンパー
  sh.closePath();

  const bodyGeo = new THREE.ExtrudeGeometry(sh, {
    depth: 1.72,
    bevelEnabled: true,
    bevelThickness: 0.08,
    bevelSize: 0.06,
    bevelSegments: 2,
  });
  bodyGeo.translate(0, 0, -0.86);

  // ダークガラスキャビン（フロント・サイド・リアウィンドウ一体化）
  const cabSh = new THREE.Shape();
  cabSh.moveTo(-1.44, 0.94);
  cabSh.lineTo(0.76, 0.92);
  cabSh.lineTo(0.24, 1.38);
  cabSh.lineTo(-0.88, 1.38);
  cabSh.closePath();
  const cabGeo = new THREE.ExtrudeGeometry(cabSh, { depth: 1.56, bevelEnabled: false });
  cabGeo.translate(0, 0, -0.78);

  // 4輪タイヤ（前後左右4本を1つの軽量BufferGeometryへ統合！）
  const wheelParts = [];
  for (const wx of [-1.28, 1.28]) {
    for (const wz of [-0.84, 0.84]) {
      const w = new THREE.CylinderGeometry(0.32, 0.32, 0.24, 10);
      w.rotateX(Math.PI * 0.5);
      w.translate(wx, 0.32, wz);
      wheelParts.push(w);
    }
  }
  const wheelsGeo = mergeGeometries(wheelParts, false);

  // 左右分離ツインLEDヘッドライト（+X前端）
  const hlL = new THREE.BoxGeometry(0.14, 0.22, 0.42);
  hlL.translate(2.14, 0.62, -0.58);
  const hlR = new THREE.BoxGeometry(0.14, 0.22, 0.42);
  hlR.translate(2.14, 0.62, 0.58);
  const headGeo = mergeGeometries([hlL, hlR], false);

  // リア連続LEDテールライトバー（-X後端）
  const tailGeo = new THREE.BoxGeometry(0.14, 0.18, 1.56);
  tailGeo.translate(-2.14, 0.68, 0);

  return { bodyGeo, cabGeo, wheelsGeo, headGeo, tailGeo };
}

const WORLD_HALF = 520;     // 1,040m × 1,040m（リアル東京 1km四方：丸の内〜日比谷公園〜隅田川〜東京湾）
const CORE_HALF = 48;       // 中心コア 96m × 96m
const APRON_LIMIT = 104;    // 地下透視ピット範囲

// 広域主要幹線道路グリッド（全交差点に専用3Dデカール・3D信号・歩行者信号・青看板・ガードパイプを構築！）
const EW_ROADS = [-320, -18, 138, 240];        // Z = -18 は中心コア大通り＆首都高軸
const NS_ROADS = [-350, -215, -122, 132, 412]; // X = -215 は南北首都高軸、X = 0 はLRTトランジットモール

function createRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// 隅田川風・東側大河川（緩やかな自然な曲線、幅約 88m〜112m）
export function getRiverCenterX(z) {
  return 272 + Math.sin(z * 0.0055) * 24;
}

export function getRiverHalfWidth(z) {
  const mouth = THREE.MathUtils.smoothstep(z, 130, 310);
  return 44 + mouth * 28;
}

// 東京港・南側海岸線
export function getCoastLineZ(x) {
  return 282 + Math.sin(x * 0.0052 + 0.4) * 18 - Math.max(0, (x - 160) * 0.06);
}

// 西側・日比谷公園風 広域都市公園＆多目的遊水地（流域治水）
function isCentralPark(x, z) {
  return x >= -335 && x <= -135 && z >= 62 && z <= 228;
}

function isRetentionBasin(x, z) {
  const dx = (x + 258) / 62;
  const dz = (z - 156) / 42;
  return dx * dx + dz * dz < 1.0;
}

function inCore(x, z, pad = 2) {
  return Math.abs(x) <= CORE_HALF + pad && Math.abs(z) <= CORE_HALF + pad;
}

function inFrontApron(x, z) {
  if (inCore(x, z, 0)) return false;
  return x >= -CORE_HALF && x <= APRON_LIMIT && z >= -CORE_HALF && z <= APRON_LIMIT;
}

function isClearCorridor(x, z) {
  if (inCore(x, z, 7)) return true;
  for (const gz of EW_ROADS) {
    if (Math.abs(z - gz) < (gz === -18 ? 22 : 17)) return true;
  }
  for (const gx of NS_ROADS) {
    if (Math.abs(x - gx) < (gx === -215 ? 21 : 17)) return true;
  }
  // 南北LRTトランジットモール (X = 0)
  if (Math.abs(x) < 17 && z > -155 && z < 285) return true;
  // 中心運河延伸 (Z = 33..43)
  if (z >= 25 && z <= 51 && x >= -335 && x <= getRiverCenterX(z) + 32) return true;
  // 東西新幹線＆ターミナル駅帯 (Z = -175)
  if (Math.abs(z + 175) < 32) return true;
  if (Math.abs(x) < 92 && z >= -222 && z <= -94) return true;
  // 首都高JCTエリア (X = -215, Z = -18, 半径 82m)
  if ((x + 215) ** 2 + (z + 18) ** 2 < 82 * 82) return true;
  // 大河川＋スーパー堤防（幅+24m）
  const rcx = getRiverCenterX(z);
  const rhw = getRiverHalfWidth(z);
  if (Math.abs(x - rcx) < rhw + 24) return true;
  // 湾岸・海（Z > coastLine - 18）
  if (z > getCoastLineZ(x) - 18) return true;
  // 広域公園＆多目的遊水地
  if (isCentralPark(x, z)) return true;
  return false;
}

// ============================================================================
// 0. プロシージャル日本標識＆超高精細交差点テクスチャ群（妥協ゼロの日本ディテール！）
// ============================================================================
function createRoadSignTexture(isShutoGreen) {
  const w = 512, h = 256;
  const cvs = document.createElement('canvas');
  cvs.width = w; cvs.height = h;
  const ctx = cvs.getContext('2d');

  // 首都高グリーン or 一般道国道ブルー
  ctx.fillStyle = isShutoGreen ? '#0b6d3c' : '#0f4c9c';
  ctx.fillRect(0, 0, w, h);

  // 日本標準の白枠（角丸風二重ライン）
  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = 10;
  ctx.strokeRect(12, 12, w - 24, h - 24);

  if (isShutoGreen) {
    // 首都高 C1 / B 湾岸線・出口案内風
    // 路線ナンバリング白丸＆緑文字バッジ
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath(); ctx.arc(74, 72, 34, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0b6d3c';
    ctx.font = 'bold 34px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('C1', 74, 84);

    // 方面テキスト（鮮明な日本語＋英字！）
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.font = 'bold 42px "Meiryo", sans-serif';
    ctx.fillText('銀座  ・  羽田', 124, 78);
    ctx.font = 'bold 22px sans-serif';
    ctx.fillStyle = '#dbeafe';
    ctx.fillText('Ginza          Haneda  (Bayshore)', 126, 114);

    // 左分岐・直進の日本式太矢印
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    // 直進矢印
    ctx.beginPath(); ctx.moveTo(210, 215); ctx.lineTo(210, 150); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(186, 174); ctx.lineTo(210, 146); ctx.lineTo(234, 174); ctx.stroke();
    // 左分岐矢印（左側通行 JCT）
    ctx.beginPath(); ctx.moveTo(395, 215); ctx.lineTo(395, 165); ctx.lineTo(345, 150); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(372, 138); ctx.lineTo(340, 150); ctx.lineTo(362, 174); ctx.stroke();
    ctx.fillStyle = '#fde047';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText('B 湾岸線 500m', 255, 215);
  } else {
    // 一般道 日本式青看板（交差点方面＆国道おにぎりマーク！）
    // 国道357/1号風 逆三角おにぎりバッジ
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.moveTo(64, 48); ctx.lineTo(106, 48); ctx.lineTo(85, 92); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#0f4c9c';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('15', 85, 74);

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.font = 'bold 38px "Meiryo", sans-serif';
    ctx.fillText('東京駅  ・  日本橋', 124, 78);
    ctx.font = 'bold 20px sans-serif';
    ctx.fillStyle = '#e0f2fe';
    ctx.fillText('Tokyo Sta.         Nihombashi', 126, 108);

    // 十字交差矢印図
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 12;
    ctx.beginPath(); ctx.moveTo(256, 224); ctx.lineTo(256, 134); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(234, 156); ctx.lineTo(256, 130); ctx.lineTo(278, 156); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(155, 182); ctx.lineTo(357, 182); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(175, 166); ctx.lineTo(150, 182); ctx.lineTo(175, 198); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(337, 166); ctx.lineTo(362, 182); ctx.lineTo(337, 198); ctx.stroke();
    ctx.font = 'bold 24px "Meiryo", sans-serif';
    ctx.fillText('日比谷', 40, 190);
    ctx.fillText('月島・湾岸', 372, 190);
  }

  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

// 1024×1024 カミソリのように鮮明な「日本式左側通行 交差点3Dペイントデカール」テクスチャ！
// 実寸 54m × 54m をカバー：ゼブラ横断歩道・左側通行太停止線・2連ひし形ダイヤ◇・進行方向矢印・自転車矢羽根・黄色点字ブロック・マンホール！
// isTNorth=true のときは湾岸通り(Z=+240)用の「北・東・西 T字路」デカール（南側へ道路が突き出さない！）を生成
function createCrispIntersectionTexture(isTNorth = false) {
  const sz = 1024;
  const spanM = 54.0;
  const cvs = document.createElement('canvas');
  cvs.width = sz; cvs.height = sz;
  const ctx = cvs.getContext('2d');
  ctx.clearRect(0, 0, sz, sz);

  const px = (m) => ((m + spanM * 0.5) / spanM) * sz;
  const len = (m) => (m / spanM) * sz;

  const hw = 7.2; // 交差点内の平均車道半幅

  // 中央クリーンアスファルトパッチ（下の低解像度線を完全に覆いシャープ化！）
  ctx.fillStyle = '#2d333d';
  const nsEndPx = isTNorth ? px(hw + 0.5) : sz;
  ctx.fillRect(px(-hw - 0.5), px(-spanM * 0.5), len((hw + 0.5) * 2), nsEndPx);
  ctx.fillRect(px(-spanM * 0.5), px(-hw - 0.5), sz, len((hw + 0.5) * 2));

  // 両端の自転車ブルーレーン（1.35m幅）＋白矢羽根ナビマーク！
  const drawBikeBand = (isEW) => {
    ctx.fillStyle = '#2466a6';
    for (const sgn of [-1, 1]) {
      const off = sgn * (hw - 0.68);
      if (isEW) {
        if (isTNorth && sgn > 0) {
          // T字路南端は東西方向へ連続貫通！
          ctx.fillRect(0, px(off - 0.65), sz, len(1.30));
        } else {
          ctx.fillRect(0, px(off - 0.65), px(-hw - 5.2), len(1.30));
          ctx.fillRect(px(hw + 5.2), px(off - 0.65), sz - px(hw + 5.2), len(1.30));
        }
      } else {
        ctx.fillRect(px(off - 0.65), 0, len(1.30), px(-hw - 5.2));
        if (!isTNorth) ctx.fillRect(px(off - 0.65), px(hw + 5.2), len(1.30), sz - px(hw + 5.2));
      }
    }
    // 自転車専用レーン白実線＆青い矢羽根ガイド
    ctx.fillStyle = '#eef2f6';
    for (const sgn of [-1, 1]) {
      const edge = sgn * (hw - 1.38);
      if (isEW) {
        if (isTNorth && sgn > 0) {
          ctx.fillRect(0, px(edge - 0.10), sz, len(0.20));
        } else {
          ctx.fillRect(0, px(edge - 0.10), px(-hw - 5.2), len(0.20));
          ctx.fillRect(px(hw + 5.2), px(edge - 0.10), sz - px(hw + 5.2), len(0.20));
        }
      } else {
        ctx.fillRect(px(edge - 0.10), 0, len(0.20), px(-hw - 5.2));
        if (!isTNorth) ctx.fillRect(px(edge - 0.10), px(hw + 5.2), len(0.20), sz - px(hw + 5.2));
      }
    }
  };
  drawBikeBand(true);
  drawBikeBand(false);

  // 中央黄色実線2本（交差点外のみ）
  ctx.fillStyle = '#eab308';
  for (const d of [-0.36, 0.14]) {
    ctx.fillRect(0, px(d), px(-hw - 5.2), len(0.24));
    ctx.fillRect(px(hw + 5.2), px(d), sz - px(hw + 5.2), len(0.24));
    ctx.fillRect(px(d), 0, len(0.24), px(-hw - 5.2));
    if (!isTNorth) ctx.fillRect(px(d), px(hw + 5.2), len(0.24), sz - px(hw + 5.2));
  }

  // 車線区分白破線（片側2車線）
  ctx.fillStyle = '#f1f5f9';
  for (const off of [-3.3, 3.3]) {
    for (let m = -25.5; m <= -13.0; m += 3.8) {
      ctx.fillRect(px(m), px(off - 0.09), len(2.0), len(0.18));
      ctx.fillRect(px(-m - 2.0), px(off - 0.09), len(2.0), len(0.18));
      ctx.fillRect(px(off - 0.09), px(m), len(0.18), len(2.0));
      if (!isTNorth) ctx.fillRect(px(off - 0.09), px(-m - 2.0), len(0.18), len(2.0));
    }
  }

  // クッキリ純白ゼブラ横断歩道（日本標準 0.50m白/0.50m黒ピッチ！T字路時は南側を描かない）
  ctx.fillStyle = '#f8fafc';
  for (const sgn of [-1, 1]) {
    const cx = sgn * (hw + 2.8);
    for (let z = -hw + 1.2; z <= hw - 1.5; z += 1.05) {
      ctx.fillRect(px(cx - 1.9), px(z), len(3.8), len(0.52));
    }
    if (isTNorth && sgn > 0) continue;
    const cz = sgn * (hw + 2.8);
    for (let x = -hw + 1.2; x <= hw - 1.5; x += 1.05) {
      ctx.fillRect(px(x), px(cz - 1.9), len(0.52), len(3.8));
    }
  }

  // ---- 日本式「左側通行」太停止線（幅0.60m・厳密位置！） ----
  // 東行き(+X): 北側(z < 0)の西手前
  ctx.fillRect(px(-hw - 6.2), px(-hw + 1.3), len(0.62), len(hw - 1.6));
  // 西行き(-X): 南側(z > 0)の東手前
  ctx.fillRect(px(hw + 5.58), px(0.3), len(0.62), len(hw - 1.6));
  // 南行き(+Z): 東側(x > 0)の北手前（+Zの左手=+X！）
  ctx.fillRect(px(0.3), px(-hw - 6.2), len(hw - 1.6), len(0.62));
  // 北行き(-Z): T字路時は不要
  if (!isTNorth) ctx.fillRect(px(-hw + 1.3), px(hw + 5.58), len(hw - 1.6), len(0.62));

  // ---- 進行方向白矢印（直進・左折・右折：左側通行！）＆ 2連ひし形ダイヤマーク（◇） ----
  const drawArrow = (mx, mz, dirAngle) => {
    ctx.save();
    ctx.translate(px(mx), px(mz));
    ctx.rotate(dirAngle);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(-len(1.6), -len(0.18), len(2.2), len(0.36));
    ctx.beginPath();
    ctx.moveTo(len(1.7), 0);
    ctx.lineTo(len(0.45), -len(0.65));
    ctx.lineTo(len(0.45), len(0.65));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };
  drawArrow(-16.5, -2.0, 0);
  drawArrow(-16.5, -4.6, 0);
  drawArrow(16.5, 2.0, Math.PI);
  drawArrow(16.5, 4.6, Math.PI);
  drawArrow(2.0, -16.5, Math.PI * 0.5);
  drawArrow(4.6, -16.5, Math.PI * 0.5);
  if (!isTNorth) {
    drawArrow(-2.0, 16.5, -Math.PI * 0.5);
    drawArrow(-4.6, 16.5, -Math.PI * 0.5);
  }

  // 2連ひし形ダイヤマーク（◇：日本の「この先横断歩道あり」の象徴！）
  const drawDiamond = (mx, mz, horiz) => {
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 4.2;
    ctx.beginPath();
    if (horiz) {
      ctx.moveTo(px(mx - 2.2), px(mz));
      ctx.lineTo(px(mx), px(mz - 0.85));
      ctx.lineTo(px(mx + 2.2), px(mz));
      ctx.lineTo(px(mx), px(mz + 0.85));
    } else {
      ctx.moveTo(px(mx), px(mz - 2.2));
      ctx.lineTo(px(mx + 0.85), px(mz));
      ctx.lineTo(px(mx), px(mz + 2.2));
      ctx.lineTo(px(mx - 0.85), px(mz));
    }
    ctx.closePath();
    ctx.stroke();
  };
  for (const dist of [21.5, 25.0]) {
    drawDiamond(-dist, -3.3, true);
    drawDiamond(dist, 3.3, true);
    drawDiamond(3.3, -dist, false);
    if (!isTNorth) drawDiamond(-3.3, dist, false);
  }

  // 交差点歩道隅の「黄色い点字ブロック（視覚障害者誘導用ブロック）」！
  ctx.fillStyle = '#facc15';
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const bx = sx * (hw + 1.4);
      const bz = sz * (hw + 1.4);
      if (!(isTNorth && sz > 0)) {
        ctx.fillRect(px(bx - 0.45), px(sz * (hw + 2.8) - 1.8), len(0.65), len(3.6));
      }
      ctx.fillRect(px(sx * (hw + 2.8) - 1.8), px(bz - 0.45), len(3.6), len(0.65));
    }
  }

  // 交差点中央の鋳鉄マンホール蓋（日本の土木ディテール！）
  ctx.fillStyle = '#475569';
  ctx.beginPath(); ctx.arc(px(1.6), px(-1.2), len(0.55), 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 2;
  ctx.stroke();

  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  tex.needsUpdate = true;
  return tex;
}

// ============================================================================
// 1. 4096×4096 超高精細 リアル東京・道路網＆街区ディテールマップ（のっぺり空き地ゼロ！）
// ============================================================================
function createTokyoGroundTexture() {
  const sz = 4096; // 1040m / 4096px = 0.25m/px の超高精細！
  const cvs = document.createElement('canvas');
  cvs.width = sz; cvs.height = sz;
  const ctx = cvs.getContext('2d');

  const toPx = (v) => ((v + WORLD_HALF) / (WORLD_HALF * 2)) * sz;
  const toLen = (m) => (m / (WORLD_HALF * 2)) * sz;
  const rng = createRng(4096);

  // ベース：上品な東京の街区舗装（中心コアのウォームグレー石舗装と自然に調和する洗練トーン！）
  ctx.fillStyle = '#6c737d';
  ctx.fillRect(0, 0, sz, sz);

  // 各街区ごとのリアルな都市ディテール（舗装トーン差・公開空地タイル・ポケットパーク緑地・パーキング区画線！）
  const xBlocks = [-520, -365, -335, -232, -198, -135, -108, -14, 14, 118, 146, 210, 340, 398, 426, 520];
  const zBlocks = [-520, -335, -305, -36, 0, 124, 152, 226, 254];
  const blockTones = ['#7c828a', '#747b84', '#82878e', '#787f88', '#868a90'];

  for (let ix = 0; ix < xBlocks.length - 1; ix += 2) {
    for (let iz = 0; iz < zBlocks.length - 1; iz += 2) {
      const x0 = xBlocks[ix], x1 = xBlocks[ix + 1];
      const z0 = zBlocks[iz], z1 = zBlocks[iz + 1];
      const bw = x1 - x0, bd = z1 - z0;
      const distCenter = Math.hypot((x0 + x1) * 0.5, (z0 + z1) * 0.5);
      // 中心コア周囲は中心コアのウォーム石舗装(#aea9a2)へ自然に馴染ませる！
      ctx.fillStyle = distCenter < 155 ? '#969694' : blockTones[(ix + iz) % blockTones.length];
      ctx.fillRect(toPx(x0), toPx(z0), toLen(bw), toLen(bd));

      // 街区内の細街路＆敷地境界ライン（リアルな東京の区画割り！）
      ctx.strokeStyle = 'rgba(20, 26, 36, 0.28)';
      ctx.lineWidth = 2;
      ctx.strokeRect(toPx(x0 + 3), toPx(z0 + 3), toLen(bw - 6), toLen(bd - 6));

      // 公開空地＆ポケットパーク芝生パッチ（空き地を「手抜き無地」にせず緑と広場で彩る！）
      const nSub = 2 + Math.floor(rng() * 3);
      for (let k = 0; k < nSub; k++) {
        const px0 = x0 + 8 + rng() * Math.max(4, bw - 34);
        const pz0 = z0 + 8 + rng() * Math.max(4, bd - 34);
        const pw = 12 + rng() * Math.min(26, bw * 0.35);
        const pd = 10 + rng() * Math.min(22, bd * 0.35);
        if (rng() < 0.55) {
          // ポケットパーク＆公開空地植栽
          ctx.fillStyle = '#477653';
          ctx.fillRect(toPx(px0), toPx(pz0), toLen(pw), toLen(pd));
          ctx.strokeStyle = '#9aa3ad';
          ctx.lineWidth = 2;
          ctx.strokeRect(toPx(px0), toPx(pz0), toLen(pw), toLen(pd));
        } else {
          // ウォーム御影石公開広場またはパーキング白線区画
          ctx.fillStyle = '#757d87';
          ctx.fillRect(toPx(px0), toPx(pz0), toLen(pw), toLen(pd));
          ctx.strokeStyle = 'rgba(241, 245, 249, 0.45)';
          ctx.lineWidth = 1.5;
          for (let sx = px0 + 3; sx < px0 + pw - 2; sx += 3.2) {
            ctx.beginPath();
            ctx.moveTo(toPx(sx), toPx(pz0 + 1.5));
            ctx.lineTo(toPx(sx), toPx(pz0 + pd * 0.45));
            ctx.stroke();
          }
        }
      }
    }
  }

  // 中心コア周囲（±115m）のウォーム石畳ほこみちグラデーション（中心コア石舗装と継ぎ目ゼロで自然に溶け込む！）
  const coreGrad = ctx.createRadialGradient(toPx(0), toPx(0), toLen(46), toPx(0), toPx(0), toLen(140));
  coreGrad.addColorStop(0, 'rgba(182, 178, 170, 0.88)');
  coreGrad.addColorStop(0.55, 'rgba(154, 154, 152, 0.42)');
  coreGrad.addColorStop(1, 'rgba(116, 123, 132, 0.0)');
  ctx.fillStyle = coreGrad;
  ctx.fillRect(toPx(-145), toPx(-145), toLen(290), toLen(290));

  // 繊細な歩道タイルグリッド目地
  ctx.strokeStyle = 'rgba(255,255,255,0.045)';
  ctx.lineWidth = 1;
  const tileStep = toLen(8);
  for (let p = 0; p < sz; p += tileStep) {
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, sz); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(sz, p); ctx.stroke();
  }

  // 日比谷公園風・西側広域都市公園 ＆ 多目的遊水地（流域治水グリーンインフラ）
  ctx.fillStyle = '#3f6f4b';
  ctx.fillRect(toPx(-335), toPx(62), toLen(200), toLen(166));
  // 園路＆円形噴水広場＆多目的遊水地（階段状親水護岸）
  ctx.strokeStyle = '#bfb6a2';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.ellipse(toPx(-258), toPx(156), toLen(74), toLen(54), 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#4e7e58';
  ctx.beginPath();
  ctx.ellipse(toPx(-258), toPx(156), toLen(66), toLen(46), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#185f7e';
  ctx.beginPath();
  ctx.ellipse(toPx(-258), toPx(156), toLen(56), toLen(36), 0, 0, Math.PI * 2);
  ctx.fill();

  // 隅田川両岸スーパー堤防（緩傾斜親水緑地帯）
  ctx.strokeStyle = '#427350';
  ctx.lineCap = 'round';
  ctx.lineWidth = toLen(144);
  ctx.beginPath();
  for (let z = -WORLD_HALF; z <= 320; z += 14) {
    const x = getRiverCenterX(z);
    if (z === -WORLD_HALF) ctx.moveTo(toPx(x), toPx(z));
    else ctx.lineTo(toPx(x), toPx(z));
  }
  ctx.stroke();

  // 湾岸プロムナード緑地
  ctx.fillStyle = '#457653';
  ctx.beginPath();
  ctx.moveTo(0, toPx(258));
  for (let x = -WORLD_HALF; x <= WORLD_HALF; x += 20) {
    ctx.lineTo(toPx(x), toPx(getCoastLineZ(x) - 20));
  }
  ctx.lineTo(sz, sz);
  ctx.lineTo(0, sz);
  ctx.closePath();
  ctx.fill();

  // ---- 全幹線道路の精密アスファルト＋自転車ブルーレーン＋日本式「左側通行」白線・黄線！ ----
  const drawEW = (z, wRoad) => {
    const hw = wRoad * 0.5;
    ctx.fillStyle = '#9aa0a8';
    ctx.fillRect(0, toPx(z - hw - 4.5), sz, toLen(wRoad + 9.0));
    ctx.fillStyle = '#2b313b';
    ctx.fillRect(0, toPx(z - hw), sz, toLen(wRoad));
    // 自転車専用ブルーレーン（両端 1.35m）
    ctx.fillStyle = '#2466a6';
    ctx.fillRect(0, toPx(z - hw), sz, toLen(1.35));
    ctx.fillRect(0, toPx(z + hw - 1.35), sz, toLen(1.35));
    // 中央黄色実線2本（日本標準）
    ctx.fillStyle = '#eab308';
    ctx.fillRect(0, toPx(z - 0.45), sz, toLen(0.28));
    ctx.fillRect(0, toPx(z + 0.17), sz, toLen(0.28));
    // 車線破線（片側2車線）
    ctx.strokeStyle = '#eef2f6';
    ctx.lineWidth = 2.6;
    ctx.setLineDash([18, 18]);
    for (const off of [-hw * 0.48, hw * 0.48]) {
      ctx.beginPath(); ctx.moveTo(0, toPx(z + off)); ctx.lineTo(sz, toPx(z + off)); ctx.stroke();
    }
    ctx.setLineDash([]);
    // 外側白実線
    ctx.fillStyle = '#eef2f6';
    ctx.fillRect(0, toPx(z - hw + 1.35), sz, toLen(0.22));
    ctx.fillRect(0, toPx(z + hw - 1.57), sz, toLen(0.22));
  };

  const drawNS = (x, wRoad) => {
    const hw = wRoad * 0.5;
    // 湾岸通り(Z=+240)南端でピタッとT字終端させ、海へ道路が沈む不整合を完全解消！
    const yEnd = toPx(246.7);
    ctx.fillStyle = '#9aa0a8';
    ctx.fillRect(toPx(x - hw - 4.5), 0, toLen(wRoad + 9.0), yEnd + toLen(4.5));
    ctx.fillStyle = '#2b313b';
    ctx.fillRect(toPx(x - hw), 0, toLen(wRoad), yEnd);
    ctx.fillStyle = '#2466a6';
    ctx.fillRect(toPx(x - hw), 0, toLen(1.35), yEnd);
    ctx.fillRect(toPx(x + hw - 1.35), 0, toLen(1.35), yEnd);
    ctx.fillStyle = '#eab308';
    ctx.fillRect(toPx(x - 0.45), 0, toLen(0.28), yEnd);
    ctx.fillRect(toPx(x + 0.17), 0, toLen(0.28), yEnd);
    ctx.strokeStyle = '#eef2f6';
    ctx.lineWidth = 2.6;
    ctx.setLineDash([18, 18]);
    for (const off of [-hw * 0.48, hw * 0.48]) {
      ctx.beginPath(); ctx.moveTo(toPx(x + off), 0); ctx.lineTo(toPx(x + off), yEnd); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = '#eef2f6';
    ctx.fillRect(toPx(x - hw + 1.35), 0, toLen(0.22), yEnd);
    ctx.fillRect(toPx(x + hw - 1.57), 0, toLen(0.22), yEnd);
  };

  // Z=-18 は中心コア(幅13.4m: 車道11m + 自転車1.2m×2)と 0.00m 誤差で完全一致！
  for (const gz of EW_ROADS) drawEW(gz, 13.4);
  for (const gx of NS_ROADS) drawNS(gx, gx === -215 ? 15.2 : 13.4);

  // 南北LRTトランジットモール（石畳＋芝生軌道：湾岸通り手前まで綺麗に延伸）
  ctx.fillStyle = '#9fa6ae';
  ctx.fillRect(toPx(-8.0), toPx(-145), toLen(16.0), toLen(392));
  ctx.fillStyle = '#3f8756';
  ctx.fillRect(toPx(-3.3), toPx(-145), toLen(6.6), toLen(392));

  // 日本式駅前ロータリー（丸の内・東京駅丸の内広場風！）
  ctx.fillStyle = '#a8aeb4';
  ctx.beginPath();
  ctx.ellipse(toPx(0), toPx(-128), toLen(68), toLen(28), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#2b313b';
  ctx.lineWidth = toLen(7.5);
  ctx.beginPath();
  ctx.ellipse(toPx(0), toPx(-128), toLen(52), toLen(20), 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#467e56';
  ctx.beginPath();
  ctx.ellipse(toPx(0), toPx(-128), toLen(36), toLen(12), 0, 0, Math.PI * 2);
  ctx.fill();

  // 中心運河延伸
  ctx.fillStyle = '#154d69';
  ctx.fillRect(toPx(-335), toPx(33), toLen(615), toLen(10));

  // 隅田川本流
  ctx.strokeStyle = '#0e3c56';
  ctx.lineWidth = toLen(92);
  ctx.beginPath();
  for (let z = -WORLD_HALF; z <= 320; z += 14) {
    const x = getRiverCenterX(z);
    if (z === -WORLD_HALF) ctx.moveTo(toPx(x), toPx(z));
    else ctx.lineTo(toPx(x), toPx(z));
  }
  ctx.stroke();

  // 東京湾ウォーターフロント海域
  ctx.fillStyle = '#0a2f46';
  ctx.beginPath();
  ctx.moveTo(0, toPx(282));
  for (let x = -WORLD_HALF; x <= WORLD_HALF; x += 20) {
    ctx.lineTo(toPx(x), toPx(getCoastLineZ(x)));
  }
  ctx.lineTo(sz, sz);
  ctx.lineTo(0, sz);
  ctx.closePath();
  ctx.fill();

  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  tex.needsUpdate = true;
  return tex;
}

// ============================================================================
// 2. 側面ファサード ＋ 専用屋上テクスチャ ＋ 高さ帯別実寸UVジオメトリ
// ============================================================================
function createFacadeTextures(variant) {
  const sz = 512;
  const cAlb = document.createElement('canvas');
  const cEmi = document.createElement('canvas');
  cAlb.width = cAlb.height = sz;
  cEmi.width = cEmi.height = sz;
  const da = cAlb.getContext('2d');
  const de = cEmi.getContext('2d');
  const rng = createRng(variant === 'cbd' ? 9101 : variant === 'warm' ? 9202 : 9303);

  da.fillStyle = variant === 'cbd' ? '#566678' : variant === 'warm' ? '#aca294' : '#94938e';
  da.fillRect(0, 0, sz, sz);
  de.fillStyle = '#000000';
  de.fillRect(0, 0, sz, sz);

  const rows = variant === 'cbd' ? 14 : 10;
  const cols = variant === 'cbd' ? 12 : 10;
  const rh = sz / rows;
  const cw = sz / cols;

  for (let r = 0; r < rows; r++) {
    const spH = rh * (variant === 'cbd' ? 0.28 : 0.34);
    da.fillStyle = variant === 'cbd' ? '#3c4b5d' : variant === 'warm' ? '#9a8e80' : '#808184';
    da.fillRect(0, r * rh, sz, spH);

    const floorLit = 0.18 + rng() * 0.42;
    for (let c = 0; c < cols; c++) {
      const x = c * cw + 3;
      const y = r * rh + spH + 2;
      const w = cw - 6;
      const h = rh - spH - 4;
      const p = rng();
      if (p < floorLit * 0.56) {
        const isWarm = variant !== 'cbd' || rng() < 0.65;
        da.fillStyle = isWarm ? '#eadac0' : '#cce0f2';
        de.fillStyle = isWarm ? '#d4a25a' : '#78b4de';
        da.fillRect(x, y, w, h);
        de.fillRect(x + 1, y + 1, w - 2, h - 2);
      } else if (p < floorLit) {
        da.fillStyle = '#486078';
        de.fillStyle = '#203246';
        da.fillRect(x, y, w, h);
        de.fillRect(x + 1, y + 1, w - 2, h - 2);
      } else {
        const t = Math.floor(28 + rng() * 20);
        da.fillStyle = `rgb(${t}, ${t + 14}, ${t + 26})`;
        da.fillRect(x, y, w, h);
      }
    }
  }

  const alb = new THREE.CanvasTexture(cAlb);
  alb.colorSpace = THREE.SRGBColorSpace;
  alb.wrapS = alb.wrapT = THREE.RepeatWrapping;
  alb.anisotropy = 8;

  const emi = new THREE.CanvasTexture(cEmi);
  emi.colorSpace = THREE.SRGBColorSpace;
  emi.wrapS = emi.wrapT = THREE.RepeatWrapping;
  emi.anisotropy = 8;
  return { alb, emi };
}

function createRoofTexture(withGreen) {
  const sz = 256;
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = sz;
  const ctx = cvs.getContext('2d');
  ctx.fillStyle = '#9aa3ae';
  ctx.fillRect(0, 0, sz, sz);
  ctx.fillStyle = '#626c7a';
  ctx.fillRect(14, 14, sz - 28, sz - 28);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 2;
  for (let i = 32; i < sz - 24; i += 32) {
    ctx.beginPath(); ctx.moveTo(i, 16); ctx.lineTo(i, sz - 16); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(16, i); ctx.lineTo(sz - 16, i); ctx.stroke();
  }
  if (withGreen) {
    ctx.fillStyle = '#437c52';
    ctx.fillRect(26, 26, sz - 52, sz * 0.44);
  }
  ctx.fillStyle = '#848f9e';
  ctx.fillRect(sz * 0.52, sz * 0.56, sz * 0.28, sz * 0.24);
  ctx.fillStyle = '#4c5766';
  ctx.fillRect(sz * 0.22, sz * 0.62, sz * 0.22, sz * 0.16);
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function createBuildingBoxGeo(vRepeat) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const uv = geo.attributes.uv;
  for (let face = 0; face < 6; face++) {
    if (face === 2 || face === 3) continue;
    for (let k = 0; k < 4; k++) {
      const idx = face * 4 + k;
      uv.setY(idx, uv.getY(idx) * vRepeat);
    }
  }
  uv.needsUpdate = true;
  return geo;
}

// ============================================================================
// 3. 1.0km 広域グラウンド（X-Ray 地下透視透過対応＋中心コア切開ピット！）
// ============================================================================
function buildSegmentedGround(groundTex) {
  const mainGroup = new THREE.Group();
  const apronGroup = new THREE.Group();
  const pitFrameGroup = new THREE.Group();

  const groundMat = new THREE.MeshStandardMaterial({
    map: groundTex,
    roughness: 0.88,
    metalness: 0.04,
    transparent: false,
    opacity: 1.0,
  });

  const xs = [-WORLD_HALF, -CORE_HALF, CORE_HALF, APRON_LIMIT, WORLD_HALF];
  const zs = [-WORLD_HALF, -CORE_HALF, CORE_HALF, APRON_LIMIT, WORLD_HALF];

  for (let ix = 0; ix < 4; ix++) {
    for (let iz = 0; iz < 4; iz++) {
      if (ix === 1 && iz === 1) continue;
      const x0 = xs[ix], x1 = xs[ix + 1];
      const z0 = zs[iz], z1 = zs[iz + 1];
      const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0, 1, 1);
      geo.rotateX(-Math.PI * 0.5);

      const pos = geo.attributes.position;
      const uv = geo.attributes.uv;
      const cx = (x0 + x1) * 0.5, cz = (z0 + z1) * 0.5;
      for (let i = 0; i < pos.count; i++) {
        const wx = pos.getX(i) + cx;
        const wz = pos.getZ(i) + cz;
        uv.setXY(i, (wx + WORLD_HALF) / (WORLD_HALF * 2), 1.0 - (wz + WORLD_HALF) / (WORLD_HALF * 2));
      }
      const mesh = new THREE.Mesh(geo, groundMat);
      mesh.position.set(cx, -0.02, cz);
      mesh.receiveShadow = true;

      if ((ix === 2 && iz === 1) || (ix === 1 && iz === 2) || (ix === 2 && iz === 2)) {
        apronGroup.add(mesh);
      } else {
        mainGroup.add(mesh);
      }
    }
  }

  // 地下透視ピットの繊細なシアンエッジ枠
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0x7dd3fc, emissive: 0x38bdf8, emissiveIntensity: 0.82, roughness: 0.25 });
  const pitWallMat = new THREE.MeshStandardMaterial({ color: 0x0e1a2e, roughness: 0.85, side: THREE.DoubleSide });
  const span = APRON_LIMIT + CORE_HALF;
  const mid = (APRON_LIMIT - CORE_HALF) * 0.5;
  const barS = new THREE.Mesh(new THREE.BoxGeometry(span, 0.45, 0.7), edgeMat);
  barS.position.set(mid, 0.05, APRON_LIMIT);
  const barE = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45, span), edgeMat);
  barE.position.set(APRON_LIMIT, 0.05, mid);
  const wallS = new THREE.Mesh(new THREE.PlaneGeometry(span, 44), pitWallMat);
  wallS.position.set(mid, -22, APRON_LIMIT);
  const wallE = new THREE.Mesh(new THREE.PlaneGeometry(span, 44), pitWallMat);
  wallE.rotation.y = -Math.PI * 0.5;
  wallE.position.set(APRON_LIMIT, -22, mid);
  const pitFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(span, span),
    new THREE.MeshStandardMaterial({ color: 0x091324, roughness: 0.78, metalness: 0.22 })
  );
  pitFloor.rotation.x = -Math.PI * 0.5;
  pitFloor.position.set(mid, -44.2, mid);
  pitFrameGroup.add(barS, barE, wallS, wallE, pitFloor);

  // 広域遠景地平線プレート
  const rimGeo = new THREE.RingGeometry(WORLD_HALF * 0.99, 2800, 64);
  rimGeo.rotateX(-Math.PI * 0.5);
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x081326, roughness: 0.72, metalness: 0.14 });
  const rimMesh = new THREE.Mesh(rimGeo, rimMat);
  rimMesh.position.y = -1.6;
  mainGroup.add(rimMesh);

  return { mainGroup, apronGroup, pitFrameGroup, groundMat, rimMat };
}

// ============================================================================
// 4. 手抜きゼロの3D広域道路インフラ（交差点高解像度3Dデカール・厳密左側通行3灯信号・歩行者信号・青看板・ガードパイプ・歩道縁石！）
// ============================================================================
function buildDetailed3DRoadEquipment(gpuPbr) {
  const mainGroup = new THREE.Group();
  const apronGroup = new THREE.Group();
  const curbGroupMain = new THREE.Group();
  const curbGroupApron = new THREE.Group();
  const dummy = new THREE.Object3D();

  // ---- (A) 物理3D かさ上げ歩道縁石ブロック（Colab GPU実写御影石PBR貼付＆X-Ray時非表示！） ----
  const curbGeo = new THREE.BoxGeometry(1, 0.18, 1);
  const curbMat = new THREE.MeshStandardMaterial({
    color: 0xc2c8d0,
    map: gpuPbr.graniteAlbedo,
    normalMap: gpuPbr.graniteNormal,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughness: 0.84,
    metalness: 0.04,
  });
  const medianMat = new THREE.MeshStandardMaterial({ color: 0x8a929c, roughness: 0.84 });
  const bushMat = new THREE.MeshStandardMaterial({ color: 0x366c46, roughness: 0.88 });

  // 縁石枠だけ細枠（幅4.2mの歩道帯）にして街区内部のポケットパークやタイルを覆い隠さない設計！
  // 東西運河帯(Z=30..46)を綺麗に跨いで分割し、歩道縁石が運河に突っ込む不整合を完全排除！
  const curbMain = [], curbApron = [];
  const xBlocks = [-500, -365, -335, -232, -198, -135, -108, -14, 14, 118, 146, 210, 340, 398, 426, 505];
  const zBlocks = [-500, -335, -305, -36, 0, 30, 46, 124, 152, 226, 254];
  for (let ix = 0; ix < xBlocks.length - 1; ix += 2) {
    for (let iz = 0; iz < zBlocks.length - 1; iz += 2) {
      const x0 = xBlocks[ix], x1 = xBlocks[ix + 1];
      const z0 = zBlocks[iz], z1 = zBlocks[iz + 1];
      const cx = (x0 + x1) * 0.5, cz = (z0 + z1) * 0.5;
      if (inCore(cx, cz, 45) || cz > getCoastLineZ(cx) - 18) continue;
      if (Math.abs(cx - getRiverCenterX(cz)) < getRiverHalfWidth(cz) + 22) continue;
      if ((cx + 215) ** 2 + (cz + 18) ** 2 < 78 * 78) continue;
      if (Math.abs(cz + 175) < 28) continue;
      if (z0 === 30 && z1 === 46 && cx >= -265 && cx <= getRiverCenterX(38)) continue;
      const bw = x1 - x0, bd = z1 - z0;
      const wSide = 4.2;
      const strips = [
        { x: cx, z: z0 + wSide * 0.5, sx: bw, sz: wSide },
        { x: cx, z: z1 - wSide * 0.5, sx: bw, sz: wSide },
        { x: x0 + wSide * 0.5, z: cz, sx: wSide, sz: Math.max(2, bd - wSide * 2) },
        { x: x1 - wSide * 0.5, z: cz, sx: wSide, sz: Math.max(2, bd - wSide * 2) },
      ];
      for (const s of strips) {
        const item = { x: s.x, y: 0.04, z: s.z, sx: s.sx, sz: s.sz };
        if (inFrontApron(s.x, s.z)) curbApron.push(item);
        else curbMain.push(item);
      }
    }
  }
  const emitCurbs = (list, tgt) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(curbGeo, curbMat, list.length);
    im.receiveShadow = true;
    for (let i = 0; i < list.length; i++) {
      dummy.position.set(list[i].x, list[i].y, list[i].z);
      dummy.scale.set(list[i].sx, 1, list[i].sz);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
    tgt.add(im);
  };
  emitCurbs(curbMain, curbGroupMain);
  emitCurbs(curbApron, curbGroupApron);
  mainGroup.add(curbGroupMain);
  apronGroup.add(curbGroupApron);

  // ---- (B) 全主要交差点の超高精細 1024px 3D路面標示デカール（十字路＆湾岸T字路専用！）＋ 厳密左側通行・日本式3灯LED信号機 ＋ 歩行者信号 ＋ 青看板 ＋ 白ガードパイプ！ ----
  const interTex = createCrispIntersectionTexture(false);
  const interTTex = createCrispIntersectionTexture(true);
  const interMat = new THREE.MeshStandardMaterial({
    map: interTex,
    transparent: true,
    roughness: 0.85,
    metalness: 0.04,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const interTMat = new THREE.MeshStandardMaterial({
    map: interTTex,
    transparent: true,
    roughness: 0.85,
    metalness: 0.04,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const interGeo = new THREE.PlaneGeometry(54.0, 54.0);
  interGeo.rotateX(-Math.PI * 0.5);

  const blueSignTex = createRoadSignTexture(false);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0xc2cbd4, roughness: 0.34, metalness: 0.68 });
  const housingMat = new THREE.MeshStandardMaterial({ color: 0x2c333c, roughness: 0.44, metalness: 0.52 });
  const greenLedMat = new THREE.MeshStandardMaterial({ color: 0x22f29c, emissive: 0x10d884, emissiveIntensity: 1.20 });
  const yellowDimMat = new THREE.MeshStandardMaterial({ color: 0x7a6320, roughness: 0.4 });
  const redLedMat = new THREE.MeshStandardMaterial({ color: 0xff3b3b, emissive: 0xef4444, emissiveIntensity: 1.20 });
  const darkLensMat = new THREE.MeshStandardMaterial({ color: 0x1e2530, roughness: 0.4 });
  const guardWhiteMat = new THREE.MeshStandardMaterial({ color: 0xeaf0f6, roughness: 0.38, metalness: 0.35 });
  const lampLedMat = new THREE.MeshStandardMaterial({ color: 0xfff0c8, emissive: 0xffd584, emissiveIntensity: 1.08 });

  const blueSignBack = new THREE.MeshStandardMaterial({ color: 0x9aa4b0, roughness: 0.6, metalness: 0.4 });
  const blueSignFront = new THREE.MeshStandardMaterial({
    map: blueSignTex,
    emissiveMap: blueSignTex,
    emissive: new THREE.Color(0x90c0f0),
    emissiveIntensity: 0.32,
    roughness: 0.34,
  });
  // BoxGeometry 6面: [+X, -X, +Y, -Y, +Z, -Z]。-X面がドライバー正面！
  const blueSignMats = [blueSignBack, blueSignFront, blueSignBack, blueSignBack, blueSignBack, blueSignBack];

  const sigPoles = [], sigArms = [], sigHeads = [];
  const sigLensG = [], sigLensY = [], sigLensR = [];
  const pedBodies = [], pedLights = [];
  const blueSigns = [], guardPipes = [];

  // 厳密な日本式左側通行・対岸正面視認シグナルユニット:
  //   ローカル座標系でポール=(0,0,0)、アームが +Z方向へ長さ3.8m、灯器正面が -X（進入してくるドライバー方向！）
  //   rotY = 0        → アーム+Z、正面-X（東行き +X ドライバー用：東北角に配置！）
  //   rotY = PI       → アーム-Z、正面+X（西行き -X ドライバー用：南西角に配置！）
  //   rotY = -PI/2    → アーム-X、正面-Z（南行き +Z ドライバー用：南東角に配置！）
  //   rotY = +PI/2    → アーム+X、正面+Z（北行き -Z ドライバー用：北西角に配置！）
  const pushJapanSignal = (px, pz, rotY, isGreen, withSign) => {
    const t = inFrontApron(px, pz) ? 'apron' : 'main';
    const sinR = Math.sin(rotY), cosR = Math.cos(rotY);
    const worldPt = (lx, ly, lz) => ({
      x: px + lx * cosR + lz * sinR,
      y: ly,
      z: pz - lx * sinR + lz * cosR,
      rotY,
      t,
    });
    sigPoles.push(worldPt(0, 3.05, 0));
    sigArms.push(worldPt(0, 5.55, 1.95));
    sigHeads.push(worldPt(0, 5.55, 2.75));

    // 横型3灯（左=+Z側: 青緑、中=0: 黄、右=-Z側: 赤 — 運転手から見て左から青・黄・赤の日本JIS標準！）
    // -X 向きに立って見た左手 = +Z側！右手 = -Z側！完全に日本JIS規格一致！
    if (isGreen) {
      sigLensG.push(worldPt(-0.18, 5.55, 3.16)); // 左灯＝青緑点灯！
    } else {
      sigLensR.push(worldPt(-0.18, 5.55, 2.34)); // 右灯＝赤点灯！
    }
    sigLensY.push(worldPt(-0.18, 5.55, 2.75));   // 中央＝黄消灯レンズ

    // 縦型2灯 歩行者用信号機（Y=3.2m）
    pedBodies.push(worldPt(-0.22, 3.25, 0.35));
    pedLights.push({ ...worldPt(-0.36, isGreen ? 3.08 : 3.42, 0.35), isG: isGreen });

    // 日本式青看板（灯器の上 Y=6.85m, 正面-X向き！）
    if (withSign) {
      blueSigns.push(worldPt(-0.08, 6.85, 2.10));
    }

    // 交差点歩道角の白い日本式ガードパイプ（歩道縁にピッタリ沿って車道へはみ出し0.00m！）
    guardPipes.push({ ...worldPt(2.4, 0.42, -0.35), sx: 3.6, sz: 0.14 });
    guardPipes.push({ ...worldPt(0.45, 0.42, -2.3), sx: 0.14, sz: 3.4 });
  };

  for (const gx of [...NS_ROADS, 0]) {
    for (const gz of EW_ROADS) {
      if (inCore(gx, gz, 12) || gz > getCoastLineZ(gx) - 14) continue;
      if (Math.abs(gx - getRiverCenterX(gz)) < getRiverHalfWidth(gz) + 18) continue;

      const tGrp = inFrontApron(gx, gz) ? apronGroup : mainGroup;
      const isT = (gz === 240);
      // 超高精細1024px 交差点デカール（湾岸通り Z=+240 は南へ飛び出さない専用T字路デカール！）
      if (gx !== 0) {
        const decal = new THREE.Mesh(interGeo, isT ? interTMat : interMat);
        decal.position.set(gx, 0.015, gz);
        decal.receiveShadow = true;
        tGrp.add(decal);
      }

      const ox = (gx === -215 ? 10.0 : 8.8);
      const oz = (gz === -18 ? 10.0 : 8.8);
      // 対岸正面視認の完璧な日本式左側通行配置（T字路時は南から進入する北行き信号を除外！）
      pushJapanSignal(gx + ox, gz - oz, 0, true, false);                // 東行き(+X)用：東北角・青
      pushJapanSignal(gx - ox, gz + oz, Math.PI, true, true);           // 西行き(-X)用：南西角・青（青看板正面+X！）
      pushJapanSignal(gx + ox, gz + oz, -Math.PI * 0.5, false, false);  // 南行き(+Z)用：南東角・赤
      if (!isT) pushJapanSignal(gx - ox, gz - oz, Math.PI * 0.5, false, true); // 北行き(-Z)用：北西角・赤
    }
  }

  // ---- (C) 広域幹線道路沿いの 3D 日本式道路照明灯（曲線アーム＋LED灯具）＆ 中央分離帯縁石＋植栽 ----
  const lampPoles = [], lampArms = [], lampHeads = [];
  const addLamp = (x, z, rotY) => {
    if (inCore(x, z, 8) || z > getCoastLineZ(x) - 10) return;
    if (Math.abs(x - getRiverCenterX(z)) < getRiverHalfWidth(z) + 14) return;
    // 東西延伸運河帯(Z=28..48)および運河橋アプローチ上には街路灯を置かない
    if (z >= 26 && z <= 50 && x >= -264 && x <= getRiverCenterX(38) - getRiverHalfWidth(38) + 12) return;
    const t = inFrontApron(x, z) ? 'apron' : 'main';
    const sx = Math.sin(rotY), cz = Math.cos(rotY);
    lampPoles.push({ x, y: 3.6, z, rotY, t });
    lampArms.push({ x: x + sx * 0.85, y: 7.25, z: z + cz * 0.85, rotY, t });
    lampHeads.push({ x: x + sx * 1.65, y: 7.30, z: z + cz * 1.65, rotY, t });
  };

  for (const gz of EW_ROADS) {
    const off = gz === -18 ? 9.8 : 8.2;
    for (let x = -480; x <= 480; x += 44) {
      if (NS_ROADS.some((nx) => Math.abs(x - nx) < 22) || Math.abs(x) < 18) continue;
      addLamp(x, gz - off, 0);
      addLamp(x + 22, gz + off, Math.PI);
    }
  }
  for (const gx of NS_ROADS) {
    const off = gx === -215 ? 9.8 : 8.2;
    for (let z = -480; z <= 250; z += 44) {
      if (EW_ROADS.some((ez) => Math.abs(z - ez) < 22)) continue;
      addLamp(gx - off, z, Math.PI * 0.5);
      addLamp(gx + off, z + 22, -Math.PI * 0.5);
    }
  }

  const emitPart = (items, geo, mat) => {
    for (const grpKey of ['main', 'apron']) {
      const sub = items.filter((it) => it.t === grpKey);
      if (!sub.length) continue;
      const im = new THREE.InstancedMesh(geo, mat, sub.length);
      for (let i = 0; i < sub.length; i++) {
        dummy.position.set(sub[i].x, sub[i].y, sub[i].z);
        dummy.rotation.set(0, sub[i].rotY || 0, 0);
        dummy.scale.set(sub[i].sx || 1, sub[i].sy || 1, sub[i].sz || 1);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      }
      im.instanceMatrix.needsUpdate = true;
      (grpKey === 'apron' ? apronGroup : mainGroup).add(im);
    }
  };

  emitPart(sigPoles, new THREE.CylinderGeometry(0.11, 0.14, 6.1, 8), poleMat);
  emitPart(sigArms, new THREE.BoxGeometry(0.14, 0.14, 3.9), poleMat);
  emitPart(sigHeads, new THREE.BoxGeometry(0.32, 0.48, 1.48), housingMat);
  emitPart(sigLensG, new THREE.CylinderGeometry(0.15, 0.15, 0.12, 10).rotateZ(Math.PI * 0.5), greenLedMat);
  emitPart(sigLensY, new THREE.CylinderGeometry(0.14, 0.14, 0.10, 10).rotateZ(Math.PI * 0.5), yellowDimMat);
  emitPart(sigLensR, new THREE.CylinderGeometry(0.15, 0.15, 0.12, 10).rotateZ(Math.PI * 0.5), redLedMat);
  emitPart(pedBodies, new THREE.BoxGeometry(0.24, 0.78, 0.34), housingMat);
  emitPart(pedLights.filter((p) => p.isG), new THREE.BoxGeometry(0.08, 0.22, 0.22), greenLedMat);
  emitPart(pedLights.filter((p) => !p.isG), new THREE.BoxGeometry(0.08, 0.22, 0.22), redLedMat);
  emitPart(blueSigns, new THREE.BoxGeometry(0.14, 1.38, 2.76), blueSignMats);
  emitPart(guardPipes, new THREE.BoxGeometry(1, 0.72, 1), guardWhiteMat);
  emitPart(lampPoles, new THREE.CylinderGeometry(0.10, 0.14, 7.2, 8), poleMat);
  emitPart(lampArms, new THREE.BoxGeometry(0.11, 0.11, 1.7), poleMat);
  emitPart(lampHeads, new THREE.BoxGeometry(0.52, 0.20, 1.35), lampLedMat);

  // 中央分離帯立体縁石＆低木植栽
  const medGeo = new THREE.BoxGeometry(1, 0.30, 1);
  const medItems = [];
  for (const gz of EW_ROADS) {
    if (gz === -18) continue;
    for (let x = -470; x <= 460; x += 64) {
      if (inCore(x, gz, 25) || NS_ROADS.some((nx) => Math.abs(x - nx) < 30) || Math.abs(x) < 26) continue;
      if (Math.abs(x - getRiverCenterX(gz)) < getRiverHalfWidth(gz) + 24) continue;
      medItems.push({ x, y: 0.15, z: gz, sx: 24, sz: 0.85, t: inFrontApron(x, gz) ? 'apron' : 'main' });
    }
  }
  for (const grpKey of ['main', 'apron']) {
    const sub = medItems.filter((it) => it.t === grpKey);
    if (!sub.length) continue;
    const imM = new THREE.InstancedMesh(medGeo, medianMat, sub.length);
    const imB = new THREE.InstancedMesh(medGeo, bushMat, sub.length);
    for (let i = 0; i < sub.length; i++) {
      dummy.position.set(sub[i].x, 0.14, sub[i].z);
      dummy.scale.set(sub[i].sx, 1, sub[i].sz);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      imM.setMatrixAt(i, dummy.matrix);

      dummy.position.set(sub[i].x, 0.48, sub[i].z);
      dummy.scale.set(sub[i].sx * 0.88, 1.35, sub[i].sz * 0.72);
      dummy.updateMatrix();
      imB.setMatrixAt(i, dummy.matrix);
    }
    imM.instanceMatrix.needsUpdate = true;
    imB.instanceMatrix.needsUpdate = true;
    (grpKey === 'apron' ? apronGroup : mainGroup).add(imM, imB);
  }

  return { mainGroup, apronGroup, curbMat, curbGroupMain, curbGroupApron, interMat, interTMat };
}

// ============================================================================
// 5. 日本仕様の橋梁群（隅田川ニールセンアーチ鋼橋・東京港2層トラス補剛吊り橋・都市運河橋・防潮水門）＆ 水面・船
// ============================================================================
function buildJapaneseWaterwaysAndBridges(waterNormalTex, gpuPbr) {
  const group = new THREE.Group();
  const apronGroup = new THREE.Group();

  // 通常時は完全不透明(transparent=false)にして海面・川面から地下が透ける怪奇現象を100%根絶！（wide_xray時のみ透視）
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x0f6690,
    emissive: 0x041d2c,
    emissiveIntensity: 0.30,
    roughness: 0.14,
    metalness: 0.28,
    envMapIntensity: 1.45,
    normalMap: waterNormalTex,
    normalScale: new THREE.Vector2(0.32, 0.32),
    transparent: false,
    opacity: 1.0,
  });

  // 隅田川水面
  const segs = 60;
  const rPos = [], rUv = [], rIdx = [];
  for (let i = 0; i <= segs; i++) {
    const z = -WORLD_HALF + (i / segs) * (310 + WORLD_HALF);
    const cx = getRiverCenterX(z);
    const hw = getRiverHalfWidth(z);
    rPos.push(cx - hw, 0.22, z, cx + hw, 0.22, z);
    rUv.push(0, i * 0.32, 1.4, i * 0.32);
    if (i < segs) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      rIdx.push(a, c, b, b, c, d);
    }
  }
  const rGeo = new THREE.BufferGeometry();
  rGeo.setAttribute('position', new THREE.Float32BufferAttribute(rPos, 3));
  rGeo.setAttribute('uv', new THREE.Float32BufferAttribute(rUv, 2));
  rGeo.setIndex(rIdx);
  rGeo.computeVertexNormals();
  const riverMesh = new THREE.Mesh(rGeo, waterMat);
  riverMesh.receiveShadow = true;
  group.add(riverMesh);

  // 東京湾海面
  const bayGeo = new THREE.PlaneGeometry(WORLD_HALF * 2, 260, 1, 1);
  bayGeo.rotateX(-Math.PI * 0.5);
  const bayUv = bayGeo.attributes.uv;
  for (let i = 0; i < bayUv.count; i++) bayUv.setXY(i, bayUv.getX(i) * 14, bayUv.getY(i) * 4);
  const bayMesh = new THREE.Mesh(bayGeo, waterMat);
  bayMesh.position.set(0, 0.20, 405);
  group.add(bayMesh);

  // 西側公園 多目的遊水地水面
  const basinGeo = new THREE.CircleGeometry(1, 36);
  basinGeo.rotateX(-Math.PI * 0.5);
  const basinMesh = new THREE.Mesh(basinGeo, waterMat);
  basinMesh.scale.set(56, 1, 36);
  basinMesh.position.set(-258, 0.16, 156);
  group.add(basinMesh);

  // 中心コア運河(Z=33..43, X=-48..+48)から東西へシームレス延伸する3D親水運河＆護岸縁石（東側エプロン区間はapronGroup分離で中心地下ピット時の宙浮きゼロ！）
  const canalWallMat = new THREE.MeshStandardMaterial({
    color: 0xd0d4da,
    map: gpuPbr.concreteAlbedo,
    normalMap: gpuPbr.concreteNormal,
    normalScale: new THREE.Vector2(0.45, 0.45),
    roughness: 0.80,
  });
  const addCanalExt = (x0, x1, targetGrp) => {
    const len = x1 - x0;
    const cx = (x0 + x1) * 0.5;
    const cw = new THREE.PlaneGeometry(len, 9.6, 1, 1);
    cw.rotateX(-Math.PI * 0.5);
    const uv = cw.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (len / 20), uv.getY(i));
    const cMesh = new THREE.Mesh(cw, waterMat);
    cMesh.position.set(cx, 0.03, 38.0);
    const qN = new THREE.Mesh(new THREE.BoxGeometry(len, 0.34, 0.82), canalWallMat);
    qN.position.set(cx, 0.14, 33.0);
    const qS = qN.clone(); qS.position.z = 43.0;
    targetGrp.add(cMesh, qN, qS);
  };
  const riverMouthX = getRiverCenterX(38) - getRiverHalfWidth(38) + 4;
  addCanalExt(-258, -CORE_HALF, group);
  addCanalExt(CORE_HALF, APRON_LIMIT, apronGroup); // 中心地下ピット開削時は非表示化！
  addCanalExt(APRON_LIMIT, riverMouthX, group);

  // 中心コア運河境界(X=±48m)の日本式都市運河 歩道小橋（中心コア掘り込み運河と広域運河の視覚境界を橋で優雅に統合！）
  const canalFootDeckMat = new THREE.MeshStandardMaterial({ color: 0x9aa4ae, map: gpuPbr.graniteAlbedo, normalMap: gpuPbr.graniteNormal, roughness: 0.78 });
  const canalRailMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.45, metalness: 0.35 });
  const canalLampMat = new THREE.MeshStandardMaterial({ color: 0xffe4ad, emissive: 0xf59e0b, emissiveIntensity: 0.92 });
  for (const [bx, tgt] of [[-CORE_HALF, group], [CORE_HALF, apronGroup]]) {
    const fDeck = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.48, 12.2), canalFootDeckMat);
    fDeck.position.set(bx, 0.42, 38.0);
    const rW = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.92, 12.0), canalRailMat);
    rW.position.set(bx - 2.0, 1.05, 38.0);
    const rE = rW.clone(); rE.position.x = bx + 2.0;
    tgt.add(fDeck, rW, rE);
    for (const sx of [-2.0, 2.0]) {
      for (const sz of [-5.8, 5.8]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.55, 0.55), canalWallMat);
        post.position.set(bx + sx, 0.95, 38.0 + sz);
        const cap = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.30, 0.42), canalLampMat);
        cap.position.set(bx + sx, 1.85, 38.0 + sz);
        tgt.add(post, cap);
      }
    }
  }

  // 運河合流部 隅田川「鋼製ローラーゲート防潮水門」（豊洲・東雲水門スタイルのジャパンブルー水門！）
  const sluiceBlueMat = new THREE.MeshStandardMaterial({ color: 0x2d7ab8, roughness: 0.34, metalness: 0.56 });
  const sluiceX = riverMouthX - 6;
  for (const sz of [31.4, 44.6]) {
    const tower = new THREE.Mesh(new THREE.BoxGeometry(3.2, 12.5, 2.6), canalWallMat);
    tower.position.set(sluiceX, 6.25, sz);
    group.add(tower);
  }
  const sluiceHouse = new THREE.Mesh(new THREE.BoxGeometry(3.8, 3.2, 16.4), sluiceBlueMat);
  sluiceHouse.position.set(sluiceX, 12.6, 38.0);
  const sluiceGate = new THREE.Mesh(new THREE.BoxGeometry(0.65, 3.6, 10.6), sluiceBlueMat);
  sluiceGate.position.set(sluiceX, 5.2, 38.0);
  group.add(sluiceHouse, sluiceGate);

  // 隅田川西岸 排水機場 地上ポンプ建屋＆放流ゲート（運河から独立した北岸 Z=14.0 へ完全整合配置！地下放流立坑と真下で直結！）
  const pumpHouseMat = new THREE.MeshStandardMaterial({
    color: 0xc2ccd6,
    map: gpuPbr.concreteAlbedo,
    normalMap: gpuPbr.concreteNormal,
    roughness: 0.52,
    metalness: 0.25,
  });
  const pumpGlassMat = new THREE.MeshStandardMaterial({ color: 0x7dd3fc, emissive: 0x0ea5e9, emissiveIntensity: 0.45, roughness: 0.18, metalness: 0.4 });
  const pumpHouse = new THREE.Mesh(new THREE.BoxGeometry(19, 9.2, 15), pumpHouseMat);
  pumpHouse.position.set(212, 4.6, 14.0);
  const pumpGate = new THREE.Mesh(new THREE.BoxGeometry(10, 3.8, 10), pumpGlassMat);
  pumpGate.position.set(224, 2.2, 14.0);
  group.add(pumpHouse, pumpGate);

  // 隅田川横断 東西幹線道路3本(Z=-320, +138, +240)の日本式連続鋼箱桁橋（川の上を車がそのまま走る不整合を完全解消！）
  const roadBridgeSteel = new THREE.MeshStandardMaterial({ color: 0x5c748c, roughness: 0.36, metalness: 0.62 });
  const roadBridgeDeck = new THREE.MeshStandardMaterial({ color: 0x2b313b, roughness: 0.85 });
  const roadBridgeWall = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.65 });
  const roadBridgeLine = new THREE.MeshStandardMaterial({ color: 0xeab308, roughness: 0.6 });
  const roadBridgeLamp = new THREE.MeshStandardMaterial({ color: 0xffe4ad, emissive: 0xf59e0b, emissiveIntensity: 0.90 });

  // 南北幹線道路(X=-122, X=+132)が東西運河(Z=33..43)を渡る「日本式都市運河道路橋 2橋」（運河による道路水没を完全解消！）
  for (const bxRoad of [-122, 132]) {
    const cSpan = 12.6;
    const cDeckY = 0.72;
    const cGirder = new THREE.Mesh(new THREE.BoxGeometry(15.2, 0.55, cSpan), roadBridgeSteel);
    cGirder.position.set(bxRoad, cDeckY - 0.32, 38.0);
    const cTop = new THREE.Mesh(new THREE.BoxGeometry(13.4, 0.14, cSpan), roadBridgeDeck);
    cTop.position.set(bxRoad, cDeckY, 38.0);
    const cYLine = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.04, cSpan), roadBridgeLine);
    cYLine.position.set(bxRoad, cDeckY + 0.08, 38.0);
    const cWallW = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.92, cSpan + 0.4), roadBridgeWall);
    cWallW.position.set(bxRoad - 7.35, cDeckY + 0.42, 38.0);
    const cWallE = cWallW.clone(); cWallE.position.x = bxRoad + 7.35;
    group.add(cGirder, cTop, cYLine, cWallW, cWallE);
    // 南北アプローチスロープ(8.5m)＋両脇壁高欄＋4隅の親柱＆LED灯具！
    const sLen = 8.5;
    const tilt = Math.atan2(cDeckY, sLen);
    for (const sgn of [-1, 1]) {
      const sz = 38.0 + sgn * (cSpan * 0.5 + sLen * 0.5 - 0.3);
      const sl = new THREE.Mesh(new THREE.BoxGeometry(14.8, 0.34, sLen), roadBridgeDeck);
      sl.position.set(bxRoad, cDeckY * 0.5 - 0.14, sz);
      sl.rotation.x = sgn * tilt;
      const swW = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.78, sLen), roadBridgeWall);
      swW.position.set(bxRoad - 7.35, cDeckY * 0.5 + 0.34, sz);
      swW.rotation.x = sgn * tilt;
      const swE = swW.clone(); swE.position.x = bxRoad + 7.35;
      group.add(sl, swW, swE);
      for (const sx of [-7.35, 7.35]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.82, 1.8, 0.82), canalWallMat);
        post.position.set(bxRoad + sx, cDeckY + 0.75, 38.0 + sgn * (cSpan * 0.5));
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.36, 0.55), roadBridgeLamp);
        lamp.position.set(bxRoad + sx, cDeckY + 1.80, 38.0 + sgn * (cSpan * 0.5));
        group.add(post, lamp);
      }
    }
  }

  for (const bzRoad of [-320, 138, 240]) {
    const rcx = getRiverCenterX(bzRoad);
    const rhw = getRiverHalfWidth(bzRoad);
    const span = rhw * 2 + 28;
    const deckY = 2.05;
    // 主桁＋アスファルト路面＋中央黄線＋両側コンクリート壁高欄
    const girder = new THREE.Mesh(new THREE.BoxGeometry(span, 1.15, 15.2), roadBridgeSteel);
    girder.position.set(rcx, deckY - 0.65, bzRoad);
    const roadTop = new THREE.Mesh(new THREE.BoxGeometry(span, 0.18, 13.4), roadBridgeDeck);
    roadTop.position.set(rcx, deckY, bzRoad);
    const yLine = new THREE.Mesh(new THREE.BoxGeometry(span, 0.05, 0.45), roadBridgeLine);
    yLine.position.set(rcx, deckY + 0.11, bzRoad);
    const wN = new THREE.Mesh(new THREE.BoxGeometry(span, 0.95, 0.55), roadBridgeWall);
    wN.position.set(rcx, deckY + 0.48, bzRoad - 7.35);
    const wS = wN.clone(); wS.position.z = bzRoad + 7.35;
    group.add(girder, roadTop, yLine, wN, wS);

    // 両岸アプローチスロープ＋連続壁高欄（水平道路 Y=0.0 ↔ 橋面 Y=2.05 を一体接続！）
    for (const sgn of [-1, 1]) {
      const slopeLen = 18.0;
      const sx = rcx + sgn * (span * 0.5 + slopeLen * 0.5 - 0.5);
      const ang = sgn * -Math.atan2(deckY, slopeLen);
      const slope = new THREE.Mesh(new THREE.BoxGeometry(slopeLen, 0.6, 14.8), roadBridgeDeck);
      slope.position.set(sx, deckY * 0.5 - 0.25, bzRoad);
      slope.rotation.z = ang;
      const swN = new THREE.Mesh(new THREE.BoxGeometry(slopeLen, 0.85, 0.52), roadBridgeWall);
      swN.position.set(sx, deckY * 0.5 + 0.42, bzRoad - 7.35);
      swN.rotation.z = ang;
      const swS = swN.clone(); swS.position.z = bzRoad + 7.35;
      group.add(slope, swN, swS);
    }
    // 水切り小判型RC橋脚 2基 ＋ 橋上LED照明灯
    for (const pOff of [-rhw * 0.45, rhw * 0.45]) {
      const pier = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.5, 3.0, 14), canalWallMat);
      pier.scale.set(1.0, 1.0, 3.2);
      pier.position.set(rcx + pOff, 0.5, bzRoad);
      group.add(pier);
    }
    for (let lx = rcx - span * 0.4; lx <= rcx + span * 0.4; lx += 28) {
      for (const sgn of [-1, 1]) {
        const lp = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.12, 4.8, 6), roadBridgeWall);
        lp.position.set(lx, deckY + 2.8, bzRoad + sgn * 7.2);
        const lh = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 1.1), roadBridgeLamp);
        lh.position.set(lx, deckY + 5.15, bzRoad + sgn * 6.7);
        group.add(lp, lh);
      }
    }
  }

  // ---- 日本型ランドマーク橋梁①：レインボーブリッジ風「2層トラス補剛吊り橋」（東京港 Z = +332m） ----
  const whiteSteel = new THREE.MeshStandardMaterial({ color: 0xecf2f8, roughness: 0.28, metalness: 0.55 });
  const trussSteel = new THREE.MeshStandardMaterial({ color: 0xc2d0de, roughness: 0.36, metalness: 0.62 });
  const concMat = new THREE.MeshStandardMaterial({
    color: 0xd0d6dc,
    map: gpuPbr.concreteAlbedo,
    normalMap: gpuPbr.concreteNormal,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughness: 0.80,
  });
  const roadDark = new THREE.MeshStandardMaterial({ color: 0x2a303a, roughness: 0.86 });
  const yellowLineMat = new THREE.MeshStandardMaterial({ color: 0xeab308, roughness: 0.6 });
  const whiteLineMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.6 });
  const cableMat = new THREE.MeshStandardMaterial({ color: 0xe2eaf2, roughness: 0.30, metalness: 0.68 });
  const warmLedMat = new THREE.MeshStandardMaterial({ color: 0xffe4ad, emissive: 0xf59e0b, emissiveIntensity: 0.92 });
  const navGreen = new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x22c55e, emissiveIntensity: 1.35 });
  const navRed = new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xef4444, emissiveIntensity: 1.35 });
  const grassLandMat = new THREE.MeshStandardMaterial({ color: 0x457a54, roughness: 0.88 });

  const bz = 332;
  const bCenter = 215; // 1km枠内で両側アンカレイジ＆東岸お台場風護岸まで美しく収まる最適中心！
  const bStart = -215, bEnd = WORLD_HALF;
  const bLen = bEnd - bStart;
  const bMid = (bStart + bEnd) * 0.5;

  // 東側・お台場風ウォーターフロント人工護岸テラス（吊り橋東端アンカレイジを陸地へ自然接続！）
  const odaibaDeck = new THREE.Mesh(new THREE.BoxGeometry(118, 4.2, 165), concMat);
  odaibaDeck.position.set(WORLD_HALF - 58, 1.2, bz + 25);
  const odaibaPark = new THREE.Mesh(new THREE.BoxGeometry(106, 0.5, 148), grassLandMat);
  odaibaPark.position.set(WORLD_HALF - 56, 3.55, bz + 25);
  group.add(odaibaDeck, odaibaPark);

  // 2層トラス補剛桁（上層：首都高＋下層：一般道＆ゆりかもめ風新交通！）
  const upperDeck = new THREE.Mesh(new THREE.BoxGeometry(bLen, 1.35, 18.8), whiteSteel);
  upperDeck.position.set(bMid, 24.5, bz);
  const upperRoad = new THREE.Mesh(new THREE.BoxGeometry(bLen, 0.25, 16.2), roadDark);
  upperRoad.position.set(bMid, 25.25, bz);
  // 上層道路：首都高風の白いコンクリート壁高欄＆中央黄色ライン＆白外側線
  for (const sgn of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(bLen, 1.15, 0.65), whiteSteel);
    wall.position.set(bMid, 25.75, bz + sgn * 8.75);
    const wline = new THREE.Mesh(new THREE.BoxGeometry(bLen, 0.05, 0.22), whiteLineMat);
    wline.position.set(bMid, 25.40, bz + sgn * 7.4);
    group.add(wall, wline);
  }
  const yCenter = new THREE.Mesh(new THREE.BoxGeometry(bLen, 0.06, 0.42), yellowLineMat);
  yCenter.position.set(bMid, 25.40, bz);
  const lowerDeck = new THREE.Mesh(new THREE.BoxGeometry(bLen, 1.25, 18.8), trussSteel);
  lowerDeck.position.set(bMid, 18.8, bz);
  group.add(upperDeck, upperRoad, yCenter, lowerDeck);

  // 橋上LED照明ポール（等間隔で東京港夜景に映える！）
  for (let lx = bStart + 24; lx < bEnd - 18; lx += 38) {
    for (const sgn of [-1, 1]) {
      const lp = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 6.2, 6), whiteSteel);
      lp.position.set(lx, 29.0, bz + sgn * 8.6);
      const lh = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.22, 1.4), warmLedMat);
      lh.position.set(lx, 32.0, bz + sgn * 7.9);
      group.add(lp, lh);
    }
  }

  // 2層桁を繋ぐ日本式ウォーレントラス斜材
  const trussStep = 14;
  for (let tx = bCenter - 196; tx < bCenter + 196; tx += trussStep) {
    for (const sgn of [-1, 1]) {
      const pA = new THREE.Vector3(tx, 19.2, bz + sgn * 8.9);
      const pB = new THREE.Vector3(tx + trussStep * 0.5, 24.4, bz + sgn * 8.9);
      const pC = new THREE.Vector3(tx + trussStep, 19.2, bz + sgn * 8.9);
      for (const [p0, p1] of [[pA, pB], [pB, pC]]) {
        const v = p1.clone().sub(p0);
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.30, v.length(), 6), trussSteel);
        bar.position.copy(p0).add(p1).multiplyScalar(0.5);
        bar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.normalize());
        group.add(bar);
      }
    }
  }

  // 航路中央の緑・赤 航路標識灯
  const ng = new THREE.Mesh(new THREE.SphereGeometry(1.15, 8, 8), navGreen);
  ng.position.set(bCenter, 17.5, bz + 9.5);
  const nr1 = new THREE.Mesh(new THREE.SphereGeometry(0.95, 8, 8), navRed);
  nr1.position.set(bCenter - 76, 17.5, bz + 9.5);
  const nr2 = nr1.clone(); nr2.position.x = bCenter + 76;
  group.add(ng, nr1, nr2);

  // 重厚コンクリート・アンカレイジ橋台 2基（主ケーブル完全定着！）
  const ancL = bCenter - 205, ancR = bCenter + 205;
  for (const ax of [ancL, ancR]) {
    const anc = new THREE.Mesh(new THREE.BoxGeometry(30, 29, 26), concMat);
    anc.position.set(ax, 12.2, bz);
    anc.castShadow = true;
    group.add(anc);
  }
  // アプローチ高架の日本式RC橋脚
  for (let px = bStart + 28; px < bEnd - 15; px += 46) {
    if (px > ancL - 20 && px < ancR + 20) continue;
    const col = new THREE.Mesh(new THREE.BoxGeometry(3.2, 18.6, 12.0), concMat);
    col.position.set(px, 9.3, bz);
    group.add(col);
  }

  // 白亜ツインタワー主塔 2基（高さ 78m＋Xクロスブレース）
  const towerXs = [bCenter - 102, bCenter + 102];
  for (const tx of towerXs) {
    const cais = new THREE.Mesh(new THREE.BoxGeometry(16, 6, 30), concMat);
    cais.position.set(tx, 1.5, bz);
    group.add(cais);
    for (const sgn of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(3.8, 76, 3.8), whiteSteel);
      leg.position.set(tx, 40, bz + sgn * 10.6);
      leg.castShadow = true;
      group.add(leg);
    }
    for (const hy of [18, 46, 75]) {
      const bm = new THREE.Mesh(new THREE.BoxGeometry(3.4, 3.0, 23), whiteSteel);
      bm.position.set(tx, hy, bz);
      group.add(bm);
    }
    for (const dir of [-1, 1]) {
      const p0 = new THREE.Vector3(tx, 47, bz - dir * 10.2);
      const p1 = new THREE.Vector3(tx, 74, bz + dir * 10.2);
      const v = p1.clone().sub(p0);
      const diag = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.68, v.length(), 8), whiteSteel);
      diag.position.copy(p0).add(p1).multiplyScalar(0.5);
      diag.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.normalize());
      group.add(diag);
    }
    const crown = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.2, 24), warmLedMat);
    crown.position.set(tx, 77.6, bz);
    group.add(crown);
  }

  // ピンと張る放物線メイン吊りケーブル（アンカレイジ天端 Y=24.0 ↔ 主塔頂 Y=76.0 に完全定着！）＆ 垂直ハンガーロープ
  const cableYAt = (x) => {
    const tL = towerXs[0], tR = towerXs[1];
    if (x >= tL && x <= tR) {
      const u = (x - bCenter) / 102;
      return 27.6 + 48.4 * u * u;
    } else if (x < tL) {
      const u = Math.max(0, (x - ancL) / (tL - ancL));
      return 24.0 + 52.0 * Math.pow(u, 1.38);
    } else {
      const u = Math.max(0, (ancR - x) / (ancR - tR));
      return 24.0 + 52.0 * Math.pow(u, 1.38);
    }
  };
  for (const sgn of [-1, 1]) {
    const pts = [];
    for (let x = ancL; x <= ancR; x += 8) {
      pts.push(new THREE.Vector3(x, cableYAt(x), bz + sgn * 10.2));
    }
    pts.push(new THREE.Vector3(ancR, 24.0, bz + sgn * 10.2));
    const mc = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 56, 0.66, 8, false), cableMat);
    group.add(mc);
    for (let x = ancL + 16; x <= ancR - 16; x += 15) {
      if (Math.abs(x - towerXs[0]) < 6 || Math.abs(x - towerXs[1]) < 6) continue;
      const cy = cableYAt(x);
      const h = cy - 24.5;
      if (h > 1.5) {
        const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, h, 6), cableMat);
        rope.position.set(x, 24.5 + h * 0.5, bz + sgn * 10.2);
        group.add(rope);
      }
    }
  }

  // ---- 日本型ランドマーク橋梁②：隅田川スタイル「ニールセンローゼ・タイドアーチ鋼橋」（大河川 Z = -18m） ----
  const archX = getRiverCenterX(-18);
  const archSpan = 124;
  const japanBlueSteel = new THREE.MeshStandardMaterial({ color: 0x4b89b8, roughness: 0.32, metalness: 0.58 }); // 永代橋・清洲橋ジャパンブルー！
  // 水切り小判型RC橋脚＋海中基礎フーチング
  for (const px of [archX - archSpan * 0.5, archX + archSpan * 0.5]) {
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.6, 2.4, 16), concMat);
    foot.scale.set(1.0, 1.0, 2.7);
    foot.position.set(px, 0.4, -18);
    const pier = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.6, 10.5, 16), concMat);
    pier.scale.set(1.0, 1.0, 2.6);
    pier.position.set(px, 4.8, -18);
    group.add(foot, pier);
  }
  // ジャパンブルー補剛タイガーダー（アーチ橋の引き締まった水平主桁！）
  for (const sgn of [-1, 1]) {
    const tie = new THREE.Mesh(new THREE.BoxGeometry(archSpan + 6, 1.65, 1.0), japanBlueSteel);
    tie.position.set(archX, 10.4, -18 + sgn * 6.4);
    group.add(tie);
  }
  const archPts = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const x = archX - archSpan * 0.5 + t * archSpan;
    const y = 10.4 + Math.sin(t * Math.PI) * 28.0;
    archPts.push(new THREE.Vector3(x, y, 0));
  }
  const archCurve = new THREE.CatmullRomCurve3(archPts);
  for (const sgn of [-1, 1]) {
    const rib = new THREE.Mesh(new THREE.TubeGeometry(archCurve, 28, 1.15, 8, false), japanBlueSteel);
    rib.position.z = -18 + sgn * 6.4;
    rib.castShadow = true;
    group.add(rib);
  }
  // 上横構クロスブレース
  for (let i = 4; i <= 18; i += 3) {
    const pA = archPts[i], pB = archPts[i + 3];
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.95, 13.0), japanBlueSteel);
    strut.position.set(pA.x, pA.y, -18);
    group.add(strut);
    if (pB) {
      for (const sgn of [-1, 1]) {
        const v0 = new THREE.Vector3(pA.x, pA.y, -18 - sgn * 6.2);
        const v1 = new THREE.Vector3(pB.x, pB.y, -18 + sgn * 6.2);
        const dv = v1.clone().sub(v0);
        const br = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, dv.length(), 6), japanBlueSteel);
        br.position.copy(v0).add(v1).multiplyScalar(0.5);
        br.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dv.normalize());
        group.add(br);
      }
    }
  }
  // ニールセン斜め吊り材ケーブル（V字交差）
  for (let i = 3; i <= 21; i += 2) {
    const p = archPts[i];
    for (const sgn of [-1, 1]) {
      for (const tilt of [-4.6, 4.6]) {
        const p0 = new THREE.Vector3(p.x, p.y, -18 + sgn * 6.4);
        const p1 = new THREE.Vector3(p.x + tilt, 10.4, -18 + sgn * 6.4);
        const dv = p1.clone().sub(p0);
        const cab = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, dv.length(), 6), cableMat);
        cab.position.copy(p0).add(p1).multiplyScalar(0.5);
        cab.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dv.normalize());
        group.add(cab);
      }
    }
  }

  // 隅田川＆東京湾 水上バス（ヒミコ風デザイン船 3隻）
  const ships = [];
  const shipHullMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.28, metalness: 0.35 });
  const shipCabinMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.22, metalness: 0.55 });
  const shipLightMat = new THREE.MeshStandardMaterial({ color: 0xfff0c8, emissive: 0xffd27d, emissiveIntensity: 0.95 });
  for (let i = 0; i < 3; i++) {
    const g = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(6.4, 2.0, 20.0), shipHullMat);
    hull.position.y = 1.0;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(5.0, 2.2, 12.0), shipCabinMat);
    cab.position.set(0, 2.8, -1.0);
    const glow = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.7, 10.5), shipLightMat);
    glow.position.set(0, 2.8, -1.0);
    g.add(hull, cab, glow);
    group.add(g);
    ships.push({ group: g, idx: i });
  }

  return { group, apronGroup, waterMat, ships };
}

// ============================================================================
// 6. 首都高スタイル高架橋＆JCT（接線完全整合＆高精細緑標識！）＋ ターミナル駅 ＋ 精巧3D左側通行車両群
// ============================================================================
function buildJapaneseTransitAndVehicles(gpuPbr) {
  const group = new THREE.Group();
  const apronParts = new THREE.Group();

  const steelMat = new THREE.MeshStandardMaterial({ color: 0x60768c, roughness: 0.34, metalness: 0.64 });
  const concMat = new THREE.MeshStandardMaterial({
    color: 0xd2d8de,
    map: gpuPbr.concreteAlbedo,
    normalMap: gpuPbr.concreteNormal,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughness: 0.80,
    metalness: 0.06,
  });
  const seismicBandMat = new THREE.MeshStandardMaterial({ color: 0x7c8794, roughness: 0.50, metalness: 0.45 });
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x2b313b, roughness: 0.86 });
  const soundWallMat = new THREE.MeshStandardMaterial({ color: 0x9bd4f0, roughness: 0.16, metalness: 0.22, transparent: true, opacity: 0.45, side: THREE.DoubleSide });
  const shutoSignTex = createRoadSignTexture(true);
  const shutoSignFace = new THREE.MeshStandardMaterial({
    map: shutoSignTex,
    emissiveMap: shutoSignTex,
    emissive: new THREE.Color(0x78e8a8),
    emissiveIntensity: 0.38,
    roughness: 0.32,
  });
  const shutoSignBack = new THREE.MeshStandardMaterial({ color: 0x8a94a0, roughness: 0.6, metalness: 0.35 });
  const shutoSignEW = [shutoSignFace, shutoSignFace, shutoSignBack, shutoSignBack, shutoSignBack, shutoSignBack]; // ±X正面（東西道路用）
  const shutoSignNS = [shutoSignBack, shutoSignBack, shutoSignBack, shutoSignBack, shutoSignFace, shutoSignFace]; // ±Z正面（南北道路用）
  const cushionMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0xca8a04, emissiveIntensity: 0.45, roughness: 0.4 });
  const glassRoofMat = new THREE.MeshStandardMaterial({
    color: 0xaad8f2, emissive: 0x1e5578, emissiveIntensity: 0.45, roughness: 0.14, metalness: 0.35, transparent: true, opacity: 0.70, side: THREE.DoubleSide,
  });
  const cyanLedMat = new THREE.MeshStandardMaterial({ color: 0x7dd3fc, emissive: 0x38bdf8, emissiveIntensity: 0.82 });
  const warmLedMat = new THREE.MeshStandardMaterial({ color: 0xffe4b5, emissive: 0xf59e0b, emissiveIntensity: 0.82 });

  // ---- (1) 首都高スタイル東西高架橋（Z = -18m, 中心コア l1_viaduct と幅・高さ・色・遮音壁を完全一致！） ----
  const whiteLineMat = new THREE.MeshStandardMaterial({ color: 0xeef2f6, roughness: 0.68 });
  const addShutoSeg = (x0, x1, targetGroup) => {
    const len = x1 - x0;
    const cx = (x0 + x1) * 0.5;
    const box = new THREE.Mesh(new THREE.BoxGeometry(len, 1.72, 11.0), steelMat);
    box.position.set(cx, 9.48, -18.0);
    box.castShadow = true;
    const surf = new THREE.Mesh(new THREE.BoxGeometry(len, 0.10, 9.9), roadMat);
    surf.position.set(cx, 10.38, -18.0);
    // 中心コアと連続する中央白線・外側線
    const lnC = new THREE.Mesh(new THREE.BoxGeometry(len, 0.04, 0.28), whiteLineMat);
    lnC.position.set(cx, 10.44, -18.0);
    const lnN = new THREE.Mesh(new THREE.BoxGeometry(len, 0.04, 0.18), whiteLineMat);
    lnN.position.set(cx, 10.44, -22.58);
    const lnS = lnN.clone(); lnS.position.z = -13.42;
    const barN = new THREE.Mesh(new THREE.BoxGeometry(len, 0.90, 0.55), concMat);
    barN.position.set(cx, 10.80, -23.22);
    const barS = barN.clone(); barS.position.z = -12.78;
    const swN = new THREE.Mesh(new THREE.BoxGeometry(len, 1.40, 0.08), soundWallMat);
    swN.position.set(cx, 11.95, -23.32);
    const swS = swN.clone(); swS.position.z = -12.68;
    const ledN = new THREE.Mesh(new THREE.BoxGeometry(len, 0.14, 0.12), cyanLedMat);
    ledN.position.set(cx, 9.96, -23.42);
    const ledS = ledN.clone(); ledS.position.z = -12.58;
    targetGroup.add(box, surf, lnC, lnN, lnS, barN, barS, swN, swS, ledN, ledS);

    for (let px = x0 + 22; px < x1 - 16; px += 44) {
      if (Math.abs(px - getRiverCenterX(-18)) < 68) continue;
      if (Math.abs(px + 215) < 28) continue;
      const col = new THREE.Mesh(new THREE.BoxGeometry(2.4, 7.6, 2.4), concMat);
      col.position.set(px, 3.8, -18.0);
      const band = new THREE.Mesh(new THREE.BoxGeometry(2.58, 2.4, 2.58), seismicBandMat);
      band.position.set(px, 2.4, -18.0);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(2.5, 1.3, 8.8), concMat);
      cap.position.set(px, 7.95, -18.0);
      targetGroup.add(col, band, cap);
    }
  };
  addShutoSeg(-WORLD_HALF, -CORE_HALF, group);
  addShutoSeg(CORE_HALF, APRON_LIMIT, apronParts);
  addShutoSeg(APRON_LIMIT, WORLD_HALF, group);

  // 首都高 高精細「緑の案内標識」門型ゲート（東西高架 Z=-18：道路に対して完全垂直＝ドライバー正面視認！）
  for (const gx of [-112, 160]) {
    const p1 = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 7.4, 8), concMat);
    p1.position.set(gx, 14.0, -23.5);
    const p2 = p1.clone(); p2.position.z = -12.5;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 11.6), concMat);
    beam.position.set(gx, 17.5, -18.0);
    const sign1 = new THREE.Mesh(new THREE.BoxGeometry(0.24, 2.45, 4.9), shutoSignEW);
    sign1.position.set(gx, 16.5, -20.6);
    const sign2 = new THREE.Mesh(new THREE.BoxGeometry(0.24, 2.45, 4.9), shutoSignEW);
    sign2.position.set(gx, 16.5, -15.4);
    group.add(p1, p2, beam, sign1, sign2);
  }

  // ---- (2) 南北首都高バイパス（X = -215m, Y = 17.5m ＋ 壁高欄 ＋ 緑案内門型ゲート！） ----
  const nsBox = new THREE.Mesh(new THREE.BoxGeometry(11.6, 1.8, WORLD_HALF * 2), steelMat);
  nsBox.position.set(-215, 17.0, 0);
  const nsRoad = new THREE.Mesh(new THREE.BoxGeometry(10.2, 0.18, WORLD_HALF * 2), roadMat);
  nsRoad.position.set(-215, 17.98, 0);
  const nsWallW = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.05, WORLD_HALF * 2), concMat);
  nsWallW.position.set(-220.6, 18.4, 0);
  const nsWallE = nsWallW.clone(); nsWallE.position.x = -209.4;
  const nsLed1 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, WORLD_HALF * 2), cyanLedMat);
  nsLed1.position.set(-220.9, 17.3, 0);
  const nsLed2 = nsLed1.clone(); nsLed2.position.x = -209.1;
  group.add(nsBox, nsRoad, nsWallW, nsWallE, nsLed1, nsLed2);

  // 南北首都高の緑案内標識門型ゲート（JCT手前 Z = +92 / Z = -118：道路に対して完全垂直！）
  for (const gz of [92, -118]) {
    const p1 = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 7.2, 8), concMat);
    p1.position.set(-220.7, 21.5, gz);
    const p2 = p1.clone(); p2.position.x = -209.3;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(12.0, 0.45, 0.45), concMat);
    beam.position.set(-215, 25.0, gz);
    const sign1 = new THREE.Mesh(new THREE.BoxGeometry(4.9, 2.45, 0.24), shutoSignNS);
    sign1.position.set(-217.6, 24.0, gz);
    const sign2 = new THREE.Mesh(new THREE.BoxGeometry(4.9, 2.45, 0.24), shutoSignNS);
    sign2.position.set(-212.4, 24.0, gz);
    group.add(p1, p2, beam, sign1, sign2);
  }

  for (let pz = -490; pz <= 490; pz += 48) {
    if (Math.abs(pz + 18) < 34) continue;
    const col = new THREE.Mesh(new THREE.BoxGeometry(2.6, 15.0, 2.6), concMat);
    col.position.set(-215, 7.5, pz);
    const band = new THREE.Mesh(new THREE.BoxGeometry(2.8, 2.6, 2.8), seismicBandMat);
    band.position.set(-215, 2.6, pz);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(8.8, 1.4, 2.7), concMat);
    cap.position.set(-215, 15.4, pz);
    group.add(col, band, cap);
  }

  // ---- (3) 首都高スタイル曲線ループJCT（X = -215m, Z = -18m, 始終端接線完全整合＋壁高欄＋分岐クッションドラム！） ----
  const jx = -215, jz = -18;
  const jctCurves = [];
  const makeRampCurve = (pts) => {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(jx + p[0], p[1], jz + p[2])));
    jctCurves.push(curve);
    const samples = curve.getPoints(36);
    for (let i = 0; i < samples.length - 1; i++) {
      const a = samples[i], b = samples[i + 1];
      const dir = b.clone().sub(a);
      const len = dir.length();
      const mid = a.clone().add(b).multiplyScalar(0.5);
      // 鋼箱桁＋舗装面＋両サイド白い壁高欄を一体化した美しい首都高ランプ断面！
      const gSeg = new THREE.Group();
      gSeg.position.copy(mid);
      gSeg.lookAt(b);
      const box = new THREE.Mesh(new THREE.BoxGeometry(6.0, 1.35, len + 0.55), steelMat);
      const rd = new THREE.Mesh(new THREE.BoxGeometry(5.1, 0.14, len + 0.55), roadMat);
      rd.position.y = 0.72;
      const wL = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.85, len + 0.55), concMat);
      wL.position.set(-2.78, 1.05, 0);
      const wR = wL.clone(); wR.position.x = 2.78;
      const led = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.18, len + 0.45), warmLedMat);
      led.position.y = -0.68;
      gSeg.add(box, rd, wL, wR, led);
      group.add(gSeg);

      if (i % 7 === 4 && mid.y > 4.0) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.15, mid.y - 0.5, 10), concMat);
        col.position.set(mid.x, (mid.y - 0.5) * 0.5, mid.z);
        group.add(col);
      }
    }
    // 分岐・合流ノーズ部の黄色クッションドラム（車線中心を避け、進行方向に対して側方ノーズ3.3mへ正確に配置！）
    const pStart = samples[2];
    const pNext = samples[3];
    const tDir = pNext.clone().sub(pStart).normalize();
    const sideVec = new THREE.Vector3(-tDir.z, 0, tDir.x).normalize();
    const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.78, 1.10, 10), cushionMat);
    nose.position.set(pStart.x + sideVec.x * 3.35, pStart.y + 1.25, pStart.z + sideVec.z * 3.35);
    group.add(nose);
  };
  // 始点・終点の2点を本線軸と完全平行に配置し、鋭角な突き出し・段差を 0.00m に完全整合！
  makeRampCurve([[-108, 9.52, -3.2], [-84, 9.65, -3.5], [-56, 12.8, -22], [-26, 15.6, -54], [-3.2, 16.95, -82], [-3.2, 17.02, -104]]);
  makeRampCurve([[108, 9.52, 3.2], [84, 9.65, 3.5], [56, 12.8, 22], [26, 15.6, 54], [3.2, 16.95, 82], [3.2, 17.02, 104]]);
  makeRampCurve([[3.2, 17.02, -108], [3.2, 17.10, -84], [26, 20.6, -56], [58, 15.8, -22], [86, 9.65, -3.5], [108, 9.52, -3.2]]);
  makeRampCurve([[-3.2, 17.02, 108], [-3.2, 17.10, 84], [-26, 20.6, 56], [-58, 15.8, 22], [-86, 9.65, 3.5], [-108, 9.52, 3.2]]);

  // ---- (4) 高輪ゲートウェイ／東京駅風・日本型ターミナル駅舎（Z = -175m）＆ 新幹線高架（左側通行！） ----
  const railZ = -175;
  const rDeck = new THREE.Mesh(new THREE.BoxGeometry(WORLD_HALF * 2, 1.8, 22.0), concMat);
  rDeck.position.set(0, 12.2, railZ);
  group.add(rDeck);

  // 新幹線 隅田川横断部：日本式ワーレントラス鋼鉄橋（川を無橋脚で飛ばず土木的に完全整合！）
  const rRivX = getRiverCenterX(railZ);
  const rTrussSpan = 120;
  const rTrussSteel = new THREE.MeshStandardMaterial({ color: 0x7a8a9c, roughness: 0.36, metalness: 0.64 });
  for (const sgn of [-1, 1]) {
    const topCh = new THREE.Mesh(new THREE.BoxGeometry(rTrussSpan, 0.9, 0.9), rTrussSteel);
    topCh.position.set(rRivX, 24.5, railZ + sgn * 10.4);
    const botCh = new THREE.Mesh(new THREE.BoxGeometry(rTrussSpan, 0.9, 0.9), rTrussSteel);
    botCh.position.set(rRivX, 13.2, railZ + sgn * 10.4);
    group.add(topCh, botCh);
    const stepT = 15;
    for (let tx = rRivX - rTrussSpan * 0.5; tx < rRivX + rTrussSpan * 0.5; tx += stepT) {
      const p0 = new THREE.Vector3(tx, 13.2, railZ + sgn * 10.4);
      const p1 = new THREE.Vector3(tx + stepT * 0.5, 24.5, railZ + sgn * 10.4);
      const p2 = new THREE.Vector3(tx + stepT, 13.2, railZ + sgn * 10.4);
      for (const [pa, pb] of [[p0, p1], [p1, p2]]) {
        const dv = pb.clone().sub(pa);
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, dv.length(), 6), rTrussSteel);
        bar.position.copy(pa).add(pb).multiplyScalar(0.5);
        bar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dv.normalize());
        group.add(bar);
      }
    }
  }
  for (let tx = rRivX - rTrussSpan * 0.5 + 15; tx <= rRivX + rTrussSpan * 0.5 - 15; tx += 15) {
    const cross = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 21.0), rTrussSteel);
    cross.position.set(tx, 24.5, railZ);
    group.add(cross);
  }
  for (const px of [rRivX - rTrussSpan * 0.5, rRivX + rTrussSpan * 0.5]) {
    const pier = new THREE.Mesh(new THREE.CylinderGeometry(3.0, 3.4, 12.0, 14), concMat);
    pier.scale.set(1.0, 1.0, 3.4);
    pier.position.set(px, 5.6, railZ);
    group.add(pier);
  }

  // 南北LRT 広域延伸ステンレスレール4本（中心コア ±48m の X=±1.75±0.54 と完全直結＆湾岸通り手前 Z=232 で終点車止め！）
  const railSteelMat = new THREE.MeshStandardMaterial({ color: 0xc8d2de, roughness: 0.28, metalness: 0.82 });
  for (const [z0, z1, tgt] of [[-142, -CORE_HALF, group], [CORE_HALF, APRON_LIMIT, apronParts], [APRON_LIMIT, 232, group]]) {
    const rLen = z1 - z0;
    const rMid = (z0 + z1) * 0.5;
    for (const cx of [-1.75, 1.75]) {
      for (const dr of [-0.54, 0.54]) {
        const rBar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, rLen), railSteelMat);
        rBar.position.set(cx + dr, 0.06, rMid);
        tgt.add(rBar);
      }
    }
  }
  const lrtEndStop = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.55, 1.2), concMat);
  lrtEndStop.position.set(0, 0.28, 232.6);
  group.add(lrtEndStop);
  for (let px = -490; px <= 490; px += 44) {
    if (Math.abs(px) < 82 || Math.abs(px - getRiverCenterX(railZ)) < 58) continue;
    for (const sgn of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(2.2, 11.4, 2.2), concMat);
      p.position.set(px, 5.7, railZ + sgn * 7.2);
      group.add(p);
    }
  }
  const vaultGeo = new THREE.CylinderGeometry(28, 28, 152, 24, 1, true, 0, Math.PI);
  vaultGeo.rotateZ(Math.PI * 0.5);
  vaultGeo.scale(1, 0.54, 1);
  const vault = new THREE.Mesh(vaultGeo, glassRoofMat);
  vault.position.set(0, 12.5, railZ);
  group.add(vault);

  const ribMat = new THREE.MeshStandardMaterial({ color: 0xecf2f8, roughness: 0.28, metalness: 0.62 });
  for (let rx = -74; rx <= 74; rx += 18.5) {
    const rGeo = new THREE.TorusGeometry(28.2, 0.78, 8, 24, Math.PI);
    rGeo.rotateY(Math.PI * 0.5);
    rGeo.scale(1, 0.54, 1);
    const rib = new THREE.Mesh(rGeo, ribMat);
    rib.position.set(rx, 12.5, railZ);
    group.add(rib);
  }
  const stBase = new THREE.Mesh(new THREE.BoxGeometry(156, 12.2, 46), new THREE.MeshStandardMaterial({ color: 0x3b4858, roughness: 0.45, metalness: 0.35 }));
  stBase.position.set(0, 6.1, railZ);
  const stGlow = new THREE.Mesh(new THREE.BoxGeometry(148, 2.8, 48), warmLedMat);
  stGlow.position.set(0, 9.4, railZ);
  group.add(stBase, stGlow);

  // 日本式駅前ロータリー・ペデストリアンリングデッキ＆バスシェルター
  const ringDeck = new THREE.Mesh(new THREE.TorusGeometry(40, 3.6, 8, 36), concMat);
  ringDeck.rotateX(Math.PI * 0.5);
  ringDeck.scale.set(1.26, 0.54, 0.28);
  ringDeck.position.set(0, 5.8, -128);
  const ringLed = new THREE.Mesh(new THREE.TorusGeometry(40, 0.45, 6, 36), warmLedMat);
  ringLed.rotateX(Math.PI * 0.5);
  ringLed.scale.set(1.26, 0.54, 1.0);
  ringLed.position.set(0, 5.0, -128);
  group.add(ringDeck, ringLed);

  // 新幹線・都市特急 2編成（100% 左側通行！）
  const railTrains = [];
  const shinkBody = new THREE.MeshStandardMaterial({ color: 0xf4f8fc, roughness: 0.22, metalness: 0.45 });
  const shinkBlue = new THREE.MeshStandardMaterial({ color: 0x0284c7, emissive: 0x0284c7, emissiveIntensity: 0.45 });
  const shinkWin = new THREE.MeshStandardMaterial({ color: 0xfff5d6, emissive: 0xffdf90, emissiveIntensity: 0.92 });
  for (let i = 0; i < 2; i++) {
    const dir = i === 0 ? 1 : -1;
    const tg = new THREE.Group();
    const b = new THREE.Mesh(new THREE.BoxGeometry(72, 3.4, 3.3), shinkBody);
    b.position.y = 1.9;
    const s = new THREE.Mesh(new THREE.BoxGeometry(72.2, 0.55, 3.38), shinkBlue);
    s.position.y = 1.3;
    const w = new THREE.Mesh(new THREE.BoxGeometry(68, 0.9, 3.36), shinkWin);
    w.position.y = 2.4;
    tg.add(b, s, w);
    group.add(tg);
    railTrains.push({ group: tg, dir, z: railZ + (dir > 0 ? -4.5 : 4.5) });
  }

  // ---- (5) 流線型カスタム3Dミニチュア車両群 152台（傾斜ボディ＋ダークガラスキャビン＋4輪タイヤ＋左右ツインLEDライト！100%左側通行！） ----
  const vehCount = 152;
  const { bodyGeo, cabGeo, wheelsGeo, headGeo, tailGeo } = createStreamlinedVehicleGeometries();

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.22, metalness: 0.48 });
  const cabMat = new THREE.MeshStandardMaterial({ color: 0x16202e, roughness: 0.14, metalness: 0.72 });
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1e242c, roughness: 0.78, metalness: 0.25 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xfff6dc, emissive: 0xfff0c2, emissiveIntensity: 1.20 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0xff3030, emissive: 0xff2222, emissiveIntensity: 1.30 });

  const instBody = new THREE.InstancedMesh(bodyGeo, bodyMat, vehCount);
  const instCab = new THREE.InstancedMesh(cabGeo, cabMat, vehCount);
  const instWheels = new THREE.InstancedMesh(wheelsGeo, wheelMat, vehCount);
  const instHead = new THREE.InstancedMesh(headGeo, headMat, vehCount);
  const instTail = new THREE.InstancedMesh(tailGeo, tailMat, vehCount);

  const vehPalette = [
    new THREE.Color(0xf1f5f9),
    new THREE.Color(0x334155),
    new THREE.Color(0x94a3b8),
    new THREE.Color(0x1e293b),
    new THREE.Color(0xf5c518), // 東京イエロータクシー
    new THREE.Color(0x2563eb),
    new THREE.Color(0xdc2626),
  ];

  const vehItems = [];
  const rng = createRng(8811);
  for (let i = 0; i < vehCount; i++) {
    instBody.setColorAt(i, vehPalette[i % vehPalette.length]);
    const dir = i % 2 === 0 ? 1 : -1;
    let mode;
    if (i < 38) mode = 'hi_ew';
    else if (i < 66) mode = 'hi_ns';
    else if (i < 86) mode = 'jct';
    else if (i < 110) mode = 'bridge';
    else if (i < 132) mode = 'st_ew';
    else mode = 'st_ns';

    const laneIdx = i % 2;
    vehItems.push({
      mode,
      dir,
      laneIdx,
      roadIdx: Math.floor(rng() * 3),
      speed: mode === 'jct' ? 0.08 + rng() * 0.04 : (mode.startsWith('st_') ? 14 + rng() * 8 : 28 + rng() * 14),
      phase: rng(),
      curveIdx: i % jctCurves.length,
    });
  }
  instBody.instanceColor.needsUpdate = true;
  group.add(instBody, instCab, instWheels, instHead, instTail);

  return {
    group,
    apronParts,
    railTrains,
    vehicles: { instBody, instCab, instWheels, instHead, instTail, headMat, tailMat, items: vehItems },
    jctCurves,
  };
}

// ============================================================================
// 7. リアル東京建築群（厳選約215棟・L字複合＆セットバック・超高層赤い航空障害灯！）＆ GPU実写葉クラウン街路樹
// ============================================================================
function buildTokyoCityAndParks(gpuPbr) {
  const mainGroup = new THREE.Group();
  const apronGroup = new THREE.Group();

  const facCBD = createFacadeTextures('cbd');
  const facWarm = createFacadeTextures('warm');
  const facRes = createFacadeTextures('res');
  const roofPlainTex = createRoofTexture(false);
  const roofGreenTex = createRoofTexture(true);

  const matRoofPlain = new THREE.MeshStandardMaterial({ map: roofPlainTex, roughness: 0.84, metalness: 0.12 });
  const matRoofGreen = new THREE.MeshStandardMaterial({ map: roofGreenTex, roughness: 0.86, metalness: 0.08 });
  const matPenthouse = new THREE.MeshStandardMaterial({ color: 0x7b8694, roughness: 0.72, metalness: 0.25 });

  const matCBDSide = new THREE.MeshStandardMaterial({
    map: facCBD.alb, emissiveMap: facCBD.emi, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.88, roughness: 0.24, metalness: 0.48,
  });
  const matWarmSide = new THREE.MeshStandardMaterial({
    map: facWarm.alb, emissiveMap: facWarm.emi, emissive: new THREE.Color(0xffe6c2), emissiveIntensity: 0.80, roughness: 0.56, metalness: 0.16,
  });
  const matResSide = new THREE.MeshStandardMaterial({
    map: facRes.alb, emissiveMap: facRes.emi, emissive: new THREE.Color(0xffe2b8), emissiveIntensity: 0.66, roughness: 0.74, metalness: 0.06,
  });

  const matsCBD = [matCBDSide, matCBDSide, matRoofPlain, matRoofPlain, matCBDSide, matCBDSide];
  const matsWarm = [matWarmSide, matWarmSide, matRoofGreen, matRoofPlain, matWarmSide, matWarmSide];
  const matsRes = [matResSide, matResSide, matRoofPlain, matRoofPlain, matResSide, matResSide];
  const crownMat = new THREE.MeshStandardMaterial({ color: 0xffdf9e, emissive: 0xf59e0b, emissiveIntensity: 0.90, roughness: 0.2 });
  const beaconRedMat = new THREE.MeshStandardMaterial({ color: 0xff3b3b, emissive: 0xff1e1e, emissiveIntensity: 1.65 });

  const buckets = {
    cbdHighMain: [], cbdMidMain: [], cbdMidApron: [],
    warmMidMain: [], warmLowMain: [], warmLowApron: [],
    resLowMain: [], resLowApron: [],
    pentMain: [], pentApron: [], crownsMain: [], beaconsMain: [],
  };

  const rng = createRng(2036);
  const step = 36;

  const evalTokyoHeight = (x, z) => {
    const d1 = Math.hypot((x - 10) / 185, (z + 250) / 145);
    const h1 = Math.exp(-d1 * d1 * 1.45) * 124;
    const d1b = Math.hypot((x - 15) / 135, (z + 90) / 85);
    const h1b = Math.exp(-d1b * d1b * 1.4) * 62;
    const d2 = Math.hypot((x - 415) / 115, (z - 20) / 155);
    const h2 = Math.exp(-d2 * d2 * 1.5) * 86;

    let h = 11 + Math.max(h1, h1b, h2);
    const rDist = Math.abs(x - getRiverCenterX(z)) - getRiverHalfWidth(z);
    if (rDist < 48) h *= 0.45 + 0.55 * Math.max(0, rDist / 48);
    const cDist = getCoastLineZ(x) - z;
    if (cDist > 0 && cDist < 55) h *= 0.45 + 0.55 * (cDist / 55);
    return Math.max(10.0, h * (0.72 + rng() * 0.52));
  };

  let totalBuildings = 0;
  const tallTowerCoords = [];

  for (let gx = -475; gx <= 475; gx += step) {
    for (let gz = -475; gz <= 265; gz += step) {
      if (rng() < 0.22) continue; // 引き算の美学：ポケットパーク・公開空地のゆとり！
      const x = gx + (rng() - 0.5) * 11.0;
      const z = gz + (rng() - 0.5) * 11.0;
      if (isClearCorridor(x, z)) continue;

      const h = evalTokyoHeight(x, z);
      const w = Math.min(28, 13 + rng() * 13 + (h > 68 ? 4 : 0));
      const d = Math.min(28, 12 + rng() * 13 + (h > 68 ? 4 : 0));
      const rotY = rng() < 0.5 ? 0 : Math.PI * 0.5;
      const apron = inFrontApron(x, z);

      if (h > 56) {
        const hPod = Math.min(13, h * 0.22);
        const hMid = h * 0.64;
        const hTop = h - hMid;
        const tMid = apron ? buckets.cbdMidApron : buckets.cbdMidMain;
        const tHigh = apron ? buckets.cbdMidApron : buckets.cbdHighMain;
        tMid.push({ x, y: hPod * 0.5, z, sx: w * 1.12, sy: hPod, sz: d * 1.12, rotY, tint: 0.92 + rng() * 0.12 });
        tHigh.push({ x, y: hMid * 0.5, z, sx: w * 0.90, sy: hMid, sz: d * 0.90, rotY, tint: 0.94 + rng() * 0.12 });
        tMid.push({ x, y: hMid + hTop * 0.5, z, sx: w * 0.72, sy: hTop, sz: d * 0.72, rotY, tint: 0.96 + rng() * 0.10 });
        (apron ? buckets.pentApron : buckets.pentMain).push({ x, y: h + 1.8, z, sx: w * 0.36, sy: 3.6, sz: d * 0.36, rotY });
        if (!apron && h > 70) {
          buckets.crownsMain.push({ x, y: h + 0.45, z, sx: w * 0.74, sy: 0.85, sz: d * 0.74, rotY });
          // 東京の高層ビルの象徴：屋上赤い航空障害灯！
          buckets.beaconsMain.push({ x: x + w * 0.28, y: h + 3.9, z: z + d * 0.28, sx: 1.0, sy: 1.0, sz: 1.0, rotY: 0 });
          tallTowerCoords.push({ x, z });
        }
      } else if (h > 26) {
        const isGlass = rng() < 0.46;
        const list = isGlass
          ? (apron ? buckets.cbdMidApron : buckets.cbdMidMain)
          : (apron ? buckets.warmLowApron : buckets.warmMidMain);
        list.push({ x, y: h * 0.38, z, sx: w, sy: h * 0.76, sz: d, rotY, tint: 0.92 + rng() * 0.14 });
        list.push({ x, y: h * 0.88, z, sx: w * 0.76, sy: h * 0.24, sz: d * 0.76, rotY, tint: 0.95 + rng() * 0.12 });
        (apron ? buckets.pentApron : buckets.pentMain).push({ x, y: h + 1.3, z, sx: w * 0.32, sy: 2.6, sz: d * 0.32, rotY });
      } else {
        // 中低層街区：単調な箱のポツン配置を避け、L字型複合・低層ウィング付きなどリアル東京の多様なシルエット！
        const isWarm = rng() < 0.54;
        const list = isWarm
          ? (apron ? buckets.warmLowApron : buckets.warmLowMain)
          : (apron ? buckets.resLowApron : buckets.resLowMain);
        list.push({ x, y: h * 0.5, z, sx: w, sy: h, sz: d * 0.72, rotY, tint: 0.88 + rng() * 0.18 });
        if (rng() < 0.65) {
          // L字ウィングまたは低層商業基壇（街区に自然な密度と生活感！）
          const hWing = h * (0.48 + rng() * 0.26);
          list.push({ x: x + (rng() < 0.5 ? 1 : -1) * w * 0.24, y: hWing * 0.5, z: z + d * 0.26, sx: w * 0.58, sy: hWing, sz: d * 0.54, rotY, tint: 0.92 + rng() * 0.12 });
        }
        (apron ? buckets.pentApron : buckets.pentMain).push({ x, y: h + 1.0, z, sx: w * 0.28, sy: 2.0, sz: d * 0.26, rotY });
      }
      totalBuildings++;
    }
  }

  const geoHigh = createBuildingBoxGeo(3.2);
  const geoMid = createBuildingBoxGeo(1.7);
  const geoLow = createBuildingBoxGeo(0.95);
  const geoPlain = new THREE.BoxGeometry(1, 1, 1);
  const geoBeacon = new THREE.SphereGeometry(0.65, 8, 8);
  const dummy = new THREE.Object3D();
  const cTmp = new THREE.Color();

  const emitInst = (items, geo, mat, target, castShadow = false) => {
    if (!items.length) return;
    const im = new THREE.InstancedMesh(geo, mat, items.length);
    im.castShadow = castShadow;
    im.receiveShadow = true;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      dummy.position.set(it.x, it.y, it.z);
      dummy.scale.set(it.sx, it.sy, it.sz);
      dummy.rotation.set(0, it.rotY || 0, 0);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
      if (it.tint !== undefined) { cTmp.setScalar(it.tint); im.setColorAt(i, cTmp); }
    }
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    target.add(im);
  };

  emitInst(buckets.cbdHighMain, geoHigh, matsCBD, mainGroup, true);
  emitInst(buckets.cbdMidMain, geoMid, matsCBD, mainGroup, false);
  emitInst(buckets.cbdMidApron, geoMid, matsCBD, apronGroup, false);
  emitInst(buckets.warmMidMain, geoMid, matsWarm, mainGroup, false);
  emitInst(buckets.warmLowMain, geoLow, matsWarm, mainGroup, false);
  emitInst(buckets.warmLowApron, geoLow, matsWarm, apronGroup, false);
  emitInst(buckets.resLowMain, geoLow, matsRes, mainGroup, false);
  emitInst(buckets.resLowApron, geoLow, matsRes, apronGroup, false);
  emitInst(buckets.pentMain, geoPlain, matPenthouse, mainGroup, false);
  emitInst(buckets.pentApron, geoPlain, matPenthouse, apronGroup, false);
  emitInst(buckets.crownsMain, geoPlain, crownMat, mainGroup, false);
  emitInst(buckets.beaconsMain, geoBeacon, beaconRedMat, mainGroup, false);

  // ---- 多層有機クラウン街路樹 ＆ 植樹桝（単一ポリゴン玉を完全廃止！3層クラスター樹冠＋幹＋御影石植樹桝！） ----
  const treeMain = [], treeApron = [];
  const pushTree = (x, z, sc, isStreet = false) => {
    if (inCore(x, z, 6)) return;
    // 東西延伸運河帯(Z=28..48)および隅田川道路橋アプローチ上へ木が生えるのを完全防止！
    if (z >= 27 && z <= 49 && x >= -264 && x <= getRiverCenterX(38) - getRiverHalfWidth(38) + 14) return;
    (inFrontApron(x, z) ? treeApron : treeMain).push({ x, y: 0, z, sc, isStreet });
  };
  for (let i = 0; i < 330; i++) {
    const x = -330 + rng() * 190;
    const z = 66 + rng() * 158;
    if (isRetentionBasin(x, z)) continue;
    pushTree(x, z, 0.88 + rng() * 0.78, false);
  }
  for (let i = 0; i < 230; i++) {
    const z = -490 + rng() * 760;
    const rcx = getRiverCenterX(z), rhw = getRiverHalfWidth(z);
    const x = rcx + (rng() < 0.5 ? -1 : 1) * (rhw + 9 + rng() * 14);
    if (Math.abs(z + 18) < 16 || Math.abs(z + 175) < 22) continue;
    pushTree(x, z, 0.84 + rng() * 0.62, false);
  }
  for (let i = 0; i < 150; i++) {
    const x = -490 + rng() * 980;
    const cz = getCoastLineZ(x);
    if (Math.abs(x - getRiverCenterX(cz)) < 75) continue;
    pushTree(x, cz - 8 - rng() * 12, 0.84 + rng() * 0.62, false);
  }
  // 幹線道路沿いのケヤキ並木（御影石植樹桝付き！）
  for (const gz of EW_ROADS) {
    const off = gz === -18 ? 11.4 : 9.6;
    for (let x = -470; x <= 470; x += 26) {
      if (NS_ROADS.some((nx) => Math.abs(x - nx) < 24) || Math.abs(x) < 18) continue;
      if (Math.abs(x - getRiverCenterX(gz)) < getRiverHalfWidth(gz) + 18) continue;
      pushTree(x, gz - off, 0.76, true);
      pushTree(x, gz + off, 0.76, true);
    }
  }
  for (const gx of NS_ROADS) {
    const off = gx === -215 ? 11.4 : 9.6;
    for (let z = -470; z <= 250; z += 28) {
      if (EW_ROADS.some((ez) => Math.abs(z - ez) < 24)) continue;
      if (Math.abs(gx - getRiverCenterX(z)) < getRiverHalfWidth(z) + 18) continue;
      pushTree(gx - off, z, 0.76, true);
      pushTree(gx + off, z, 0.76, true);
    }
  }

  const trunkGeo = new THREE.CylinderGeometry(0.24, 0.36, 3.6, 6);
  const crownGeo = new THREE.DodecahedronGeometry(2.15, 1);
  const planterGeo = new THREE.BoxGeometry(1.9, 0.32, 1.9);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c4632, roughness: 0.92 });
  // Colab L4 GPU 生成の実写ケヤキ葉クラスター PBR（Albedo + Normal）でポリゴン玉感を完全払拭！
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0xd8f4d4,
    map: gpuPbr.foliageAlbedo,
    normalMap: gpuPbr.foliageNormal,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughness: 0.82,
    metalness: 0.0,
  });
  const planterMat = new THREE.MeshStandardMaterial({ color: 0x7c848e, roughness: 0.85 });

  const buildTreeInst = (list, target) => {
    if (!list.length) return;
    const imT = new THREE.InstancedMesh(trunkGeo, trunkMat, list.length);
    const imC = new THREE.InstancedMesh(crownGeo, leafMat, list.length * 3); // 1本あたり3層有機クラスター！
    const streetList = list.filter((t) => t.isStreet);
    const imP = streetList.length ? new THREE.InstancedMesh(planterGeo, planterMat, streetList.length) : null;

    let cIdx = 0;
    let pIdx = 0;
    const offsets = [
      [0.0, 5.1, 0.0, 1.10, 0.90],
      [0.85, 4.3, 0.55, 0.86, 0.78],
      [-0.78, 4.4, -0.58, 0.82, 0.76],
    ];
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      dummy.position.set(t.x, 1.8 * t.sc, t.z);
      dummy.scale.set(t.sc, t.sc, t.sc);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      imT.setMatrixAt(i, dummy.matrix);

      if (t.isStreet && imP) {
        dummy.position.set(t.x, 0.16, t.z);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        imP.setMatrixAt(pIdx++, dummy.matrix);
      }

      const ang = (i * 1.37) % (Math.PI * 2);
      const ca = Math.cos(ang), sa = Math.sin(ang);
      for (let k = 0; k < 3; k++) {
        const [ox, oy, oz, sx, sy] = offsets[k];
        const rx = ox * ca - oz * sa;
        const rz = ox * sa + oz * ca;
        dummy.position.set(t.x + rx * t.sc, oy * t.sc, t.z + rz * t.sc);
        dummy.scale.set(t.sc * sx, t.sc * sy, t.sc * sx);
        dummy.rotation.set(k * 0.4, ang + k, 0);
        dummy.updateMatrix();
        imC.setMatrixAt(cIdx, dummy.matrix);
        cTmp.setHSL(0.32 + (((i + k) % 7) - 3) * 0.014, 0.16, 0.72 + k * 0.05 + ((i % 5) - 2) * 0.03);
        imC.setColorAt(cIdx, cTmp);
        cIdx++;
      }
    }
    imT.instanceMatrix.needsUpdate = true;
    imC.instanceMatrix.needsUpdate = true;
    imC.instanceColor.needsUpdate = true;
    target.add(imT, imC);
    if (imP) { imP.instanceMatrix.needsUpdate = true; target.add(imP); }
  };
  buildTreeInst(treeMain, mainGroup);
  buildTreeInst(treeApron, apronGroup);

  return {
    mainGroup,
    apronGroup,
    emissiveMats: [matCBDSide, matWarmSide, matResSide],
    xrayBldgMats: [matCBDSide, matWarmSide, matResSide, matRoofPlain, matRoofGreen, matPenthouse],
    tallTowerCoords,
    stats: { totalBuildings, totalTrees: treeMain.length + treeApron.length },
  };
}

// ============================================================================
// 8. 地上と完全連動する「1.0km 広域地下空間ネットワーク」！！
// ============================================================================
function buildWideUndergroundNetwork(tallTowerCoords) {
  const group = new THREE.Group();
  group.name = 'wide_underground_1000m';

  const rcMat = new THREE.MeshStandardMaterial({ color: 0x9aa4b0, roughness: 0.78, metalness: 0.12 });
  const shieldMat = new THREE.MeshStandardMaterial({ color: 0xbfc8d4, roughness: 0.72, metalness: 0.18 });
  const subwayGlowMat = new THREE.MeshStandardMaterial({ color: 0x4ade80, emissive: 0x22c55e, emissiveIntensity: 1.05 });
  const concourseGlassMat = new THREE.MeshStandardMaterial({ color: 0x7dd3fc, emissive: 0x0ea5e9, emissiveIntensity: 0.85, transparent: true, opacity: 0.78 });
  const floodPipeMat = new THREE.MeshStandardMaterial({ color: 0x5c7c96, roughness: 0.66, metalness: 0.24 });
  const floodWaterMat = new THREE.MeshStandardMaterial({ color: 0x38d0ff, emissive: 0x0ea5e9, emissiveIntensity: 1.05, transparent: true, opacity: 0.82 });
  const culvertMat = new THREE.MeshStandardMaterial({ color: 0xf97316, emissive: 0xea580c, emissiveIntensity: 0.82 });
  const waterPipeMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0284c7, emissiveIntensity: 0.82 });
  const pileTipMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0xca8a04, emissiveIntensity: 0.72 });
  const pumpHouseMat = new THREE.MeshStandardMaterial({ color: 0xb6c2ce, roughness: 0.45, metalness: 0.35 });

  // ---- (1) 広域 開削地下鉄網 ＆ ターミナル駅直下「巨大多層地下駅・地下街コンコース」（GL -12.5m） ----
  const subN = new THREE.Mesh(new THREE.BoxGeometry(13.6, 7.4, 412), rcMat);
  subN.position.set(0, -12.5, -254);
  const subS = new THREE.Mesh(new THREE.BoxGeometry(13.6, 7.4, 212), rcMat);
  subS.position.set(0, -12.5, 154);
  const subLineN = new THREE.Mesh(new THREE.BoxGeometry(14.2, 1.1, 412), subwayGlowMat);
  subLineN.position.set(0, -9.8, -254);
  const subLineS = new THREE.Mesh(new THREE.BoxGeometry(14.2, 1.1, 212), subwayGlowMat);
  subLineS.position.set(0, -9.8, 154);
  group.add(subN, subS, subLineN, subLineS);

  // ターミナル駅直下 巨大地下街＆多層乗換コンコース（X=-95..+95, Z=-175, Y=-7..-15m）＋エスカレーター光柱！
  const hubHall = new THREE.Mesh(new THREE.BoxGeometry(165, 8.5, 52), rcMat);
  hubHall.position.set(0, -11.5, -175);
  const hubAtrium = new THREE.Mesh(new THREE.BoxGeometry(158, 3.6, 54), concourseGlassMat);
  hubAtrium.position.set(0, -9.5, -175);
  for (const ax of [-50, 0, 50]) {
    const esc = new THREE.Mesh(new THREE.BoxGeometry(9.0, 12.0, 9.0), concourseGlassMat);
    esc.position.set(ax, -5.8, -175);
    group.add(esc);
  }
  // 東西分岐地下鉄線（Z = -175m, Y = -18.5m, 1km貫通）
  const subEW = new THREE.Mesh(new THREE.BoxGeometry(920, 6.8, 12.8), rcMat);
  subEW.position.set(0, -18.5, -175);
  const subEWLine = new THREE.Mesh(new THREE.BoxGeometry(920, 1.0, 13.4), concourseGlassMat);
  subEWLine.position.set(0, -16.0, -175);
  group.add(hubHall, hubAtrium, subEW, subEWLine);

  // ---- (2) 広域 大深度鉄道シールド複線網（GL -26.0m / -26.5m：隅田川直下を潜って東岸立坑へ！） ----
  const cylGeoX = (len, r) => { const g = new THREE.CylinderGeometry(r, r, len, 20); g.rotateZ(Math.PI * 0.5); return g; };
  const shNW = new THREE.Mesh(cylGeoX(432, 3.8), shieldMat);
  shNW.position.set(-264, -26.0, -5.5);
  const shNE = new THREE.Mesh(cylGeoX(432, 3.8), shieldMat);
  shNE.position.set(264, -26.0, -5.5);
  const shSW = new THREE.Mesh(cylGeoX(272, 3.8), shieldMat);
  shSW.position.set(-184, -26.5, 14.0);
  // 大深度シールド導光リング（X-Ray時に視認性抜群！）
  for (let rx = -440; rx <= 440; rx += 64) {
    if (Math.abs(rx) < 55) continue;
    const rg = new THREE.Mesh(new THREE.TorusGeometry(4.05, 0.25, 6, 18), concourseGlassMat);
    rg.rotateY(Math.PI * 0.5);
    rg.position.set(rx, -26.0, -5.5);
    group.add(rg);
  }
  // 大深度シールド発進・到達立坑（Φ16m：西 X=-320, 東岸副都心 X=+412）
  for (const [sx, sz] of [[-320, 4.0], [412, -5.5]]) {
    const sh = new THREE.Mesh(new THREE.CylinderGeometry(8.5, 8.5, 32, 24), rcMat);
    sh.position.set(sx, -16.5, sz);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(8.8, 0.60, 8, 24), concourseGlassMat);
    ring.rotateX(Math.PI * 0.5);
    ring.position.set(sx, -26.0, sz);
    group.add(sh, ring);
  }
  group.add(shNW, shNE, shSW);

  // ---- (3) 広域 流域治水・大深度地下調節池＆地下河川ネットワーク（GL -37.2m / GL-40m帯！） ----
  const flW = new THREE.Mesh(cylGeoX(432, 4.6), floodPipeMat);
  flW.position.set(-264, -37.2, 36.0);
  const flE = new THREE.Mesh(cylGeoX(216, 4.6), floodPipeMat);
  flE.position.set(156, -37.2, 36.0);
  const flGlowW = new THREE.Mesh(cylGeoX(432, 2.3), floodWaterMat);
  flGlowW.position.set(-264, -37.2, 36.0);
  const flGlowE = new THREE.Mesh(cylGeoX(216, 2.3), floodWaterMat);
  flGlowE.position.set(156, -37.2, 36.0);
  group.add(flW, flE, flGlowW, flGlowE);

  // 西側広域公園・多目的遊水地（X=-258, Z=+156）直下の巨大取水立坑（Φ14m）→ 調節池接続地下河川！
  const parkShaft = new THREE.Mesh(new THREE.CylinderGeometry(7.2, 7.2, 40, 24), floodPipeMat);
  parkShaft.position.set(-258, -20.0, 156);
  const parkShaftGlow = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.6, 39, 16), floodWaterMat);
  parkShaftGlow.position.set(-258, -20.0, 156);
  const connGeo = new THREE.CylinderGeometry(4.0, 4.0, 120, 18);
  connGeo.rotateX(Math.PI * 0.5);
  const parkConn = new THREE.Mesh(connGeo, floodPipeMat);
  parkConn.position.set(-258, -37.2, 96);
  const parkConnW = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 120, 14).rotateX(Math.PI * 0.5), floodWaterMat);
  parkConnW.position.set(-258, -37.2, 96);
  group.add(parkShaft, parkShaftGlow, parkConn, parkConnW);

  // 東岸・隅田川排水機場＆巨大放流立坑（X = +212, Z = +14.0：運河北岸の地上ポンプ建屋真下へ完全一致＋調節池Z=36から地下連絡暗渠で直結！）
  const pumpShaft = new THREE.Mesh(new THREE.CylinderGeometry(8.2, 8.2, 42, 24), floodPipeMat);
  pumpShaft.position.set(212, -21.0, 14.0);
  const pumpGlow = new THREE.Mesh(new THREE.TorusGeometry(8.6, 0.72, 8, 24), floodWaterMat);
  pumpGlow.rotateX(Math.PI * 0.5);
  pumpGlow.position.set(212, -37.0, 14.0);
  const pumpLinkGeo = new THREE.CylinderGeometry(4.2, 4.2, 24, 18);
  pumpLinkGeo.rotateX(Math.PI * 0.5);
  const pumpLink = new THREE.Mesh(pumpLinkGeo, floodPipeMat);
  pumpLink.position.set(212, -37.2, 25.0);
  const pumpLinkW = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 24, 14).rotateX(Math.PI * 0.5), floodWaterMat);
  pumpLinkW.position.set(212, -37.2, 25.0);
  group.add(pumpShaft, pumpGlow, pumpLink, pumpLinkW);

  // ---- (4) 広域 2連共同溝 ＆ 上下水道幹線ネットワーク（GL -3.9m） ----
  const culW = new THREE.Mesh(new THREE.BoxGeometry(432, 3.0, 4.6), culvertMat);
  culW.position.set(-264, -3.9, 12.5);
  const culE = new THREE.Mesh(new THREE.BoxGeometry(200, 3.0, 4.6), culvertMat);
  culE.position.set(148, -3.9, 12.5);
  const watW = new THREE.Mesh(cylGeoX(432, 0.85), waterPipeMat);
  watW.position.set(-264, -2.5, -25.5);
  const watE = new THREE.Mesh(cylGeoX(432, 0.85), waterPipeMat);
  watE.position.set(264, -2.5, -25.5);
  group.add(culW, culE, watW, watE);

  // ---- (5) 広域超高層ビル＆橋脚の場所打ちRC支持杭（東京礫層 Dg -32.5m 定着を広域可視化！） ----
  const pileGeo = new THREE.CylinderGeometry(0.95, 0.95, 31.5, 8);
  const tipGeo = new THREE.CylinderGeometry(1.12, 1.12, 5.5, 8);
  const pileCoords = [];
  for (const tc of tallTowerCoords.slice(0, 45)) {
    for (const dx of [-5.5, 5.5]) {
      for (const dz of [-5.5, 5.5]) {
        pileCoords.push({ x: tc.x + dx, z: tc.z + dz });
      }
    }
  }
  if (pileCoords.length) {
    const dummy = new THREE.Object3D();
    const imP = new THREE.InstancedMesh(pileGeo, rcMat, pileCoords.length);
    const imT = new THREE.InstancedMesh(tipGeo, pileTipMat, pileCoords.length);
    for (let i = 0; i < pileCoords.length; i++) {
      dummy.position.set(pileCoords[i].x, -16.5, pileCoords[i].z);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      imP.setMatrixAt(i, dummy.matrix);

      dummy.position.set(pileCoords[i].x, -29.8, pileCoords[i].z);
      dummy.updateMatrix();
      imT.setMatrixAt(i, dummy.matrix);
    }
    imP.instanceMatrix.needsUpdate = true;
    imT.instanceMatrix.needsUpdate = true;
    group.add(imP, imT);
  }

  // GL-40.0m 大深度地下法 広域基準ネオン枠
  const lawMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0ea5e9, emissiveIntensity: 0.85 });
  for (const sgn of [-1, 1]) {
    const bX = new THREE.Mesh(new THREE.BoxGeometry(WORLD_HALF * 1.9, 0.35, 0.35), lawMat);
    bX.position.set(0, -40.0, sgn * (WORLD_HALF * 0.95));
    const bZ = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, WORLD_HALF * 1.9), lawMat);
    bZ.position.set(sgn * (WORLD_HALF * 0.95), -40.0, 0);
    group.add(bX, bZ);
  }

  return group;
}

// ============================================================================
// 公開エントリ：1.0km リアル東京 ＆ 広域地下インフラ解剖ワールド (v4)
// ============================================================================
export function createMetroWorld(waterNormalTex) {
  const root = new THREE.Group();
  root.name = 'tokyo_reality_1000m';

  const gpuPbr = loadGpuPbrSet();
  const groundTex = createTokyoGroundTexture();
  const { mainGroup: groundMain, apronGroup: groundApron, pitFrameGroup, groundMat, rimMat } = buildSegmentedGround(groundTex);
  const { mainGroup: roadEqMain, apronGroup: roadEqApron, curbMat, curbGroupMain, curbGroupApron, interMat, interTMat } = buildDetailed3DRoadEquipment(gpuPbr);
  const { group: waterGroup, apronGroup: waterApron, waterMat, ships } = buildJapaneseWaterwaysAndBridges(waterNormalTex, gpuPbr);
  const { group: transitGroup, apronParts: transitApron, railTrains, vehicles, jctCurves } = buildJapaneseTransitAndVehicles(gpuPbr);
  const { mainGroup: cityMain, apronGroup: cityApron, emissiveMats, xrayBldgMats, tallTowerCoords, stats } = buildTokyoCityAndParks(gpuPbr);
  const wideUnderground = buildWideUndergroundNetwork(tallTowerCoords);

  const apronAll = new THREE.Group();
  apronAll.add(groundApron, roadEqApron, waterApron, transitApron, cityApron);

  root.add(groundMain, roadEqMain, waterGroup, transitGroup, cityMain, apronAll, pitFrameGroup, wideUnderground);

  const dummy = new THREE.Object3D();
  const pTmp = new THREE.Vector3();
  const tTmp = new THREE.Vector3();

  // 流線型カスタム3D車両の5パーツ（傾斜ボディ・ガラスキャビン・4輪タイヤ・ツインヘッドライト・連続テールバー）を一括配置
  function placeVehicle(i, x, y, z, yawRad) {
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, yawRad, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    vehicles.instBody.setMatrixAt(i, dummy.matrix);
    vehicles.instCab.setMatrixAt(i, dummy.matrix);
    vehicles.instWheels.setMatrixAt(i, dummy.matrix);
    vehicles.instHead.setMatrixAt(i, dummy.matrix);
    vehicles.instTail.setMatrixAt(i, dummy.matrix);
  }

  function update(tSec) {
    if (!root.visible) return;
    const wrap = (val, span) => ((((val + span * 0.5) % span) + span) % span) - span * 0.5;

    // 新幹線（100% 左側通行！）
    for (const tr of railTrains) {
      const x = tr.dir * wrap(tSec * 56 + (tr.dir > 0 ? 110 : -240), 1000);
      tr.group.position.set(x, 13.1, tr.z);
    }

    // 隅田川＆東京湾 水上バス
    for (const sh of ships) {
      if (sh.idx < 2) {
        const z = (sh.idx === 0 ? 1 : -1) * wrap(tSec * 10 + sh.idx * 210, 620) - 90;
        const x = getRiverCenterX(z) + (sh.idx === 0 ? 14 : -14);
        sh.group.position.set(x, 0.22, z);
        sh.group.rotation.y = sh.idx === 0 ? 0 : Math.PI;
      } else {
        const x = wrap(tSec * 12 + 120, 860);
        sh.group.position.set(x, 0.22, 388);
        sh.group.rotation.y = Math.PI * 0.5;
      }
    }

    // 152台の精巧3Dミニチュア車両（100% 日本の左側通行！！）
    const stEWs = [-320, 138, 240];
    const stNSs = [-350, -122, 132];
    const items = vehicles.items;
    for (let i = 0; i < items.length; i++) {
      const f = items[i];
      const laneOff = 1.45 + f.laneIdx * 2.15;
      if (f.mode === 'hi_ew') {
        const x = f.dir * wrap(tSec * f.speed + f.phase * 1000, 1020);
        const z = -18.0 + (f.dir > 0 ? -laneOff : laneOff);
        placeVehicle(i, x, 10.44, z, f.dir > 0 ? 0 : Math.PI);
      } else if (f.mode === 'hi_ns') {
        const z = f.dir * wrap(tSec * f.speed + f.phase * 1000, 1020);
        const x = -215.0 + (f.dir > 0 ? laneOff : -laneOff);
        placeVehicle(i, x, 18.02, z, f.dir > 0 ? -Math.PI * 0.5 : Math.PI * 0.5);
      } else if (f.mode === 'bridge') {
        const span = WORLD_HALF - (-215) - 10;
        const raw = ((f.phase * span + (f.dir > 0 ? tSec * f.speed : span - tSec * f.speed)) % span + span) % span;
        const x = -210 + raw;
        const z = 332.0 + (f.dir > 0 ? -(2.1 + f.laneIdx * 2.4) : (2.1 + f.laneIdx * 2.4));
        placeVehicle(i, x, 25.38, z, f.dir > 0 ? 0 : Math.PI);
      } else if (f.mode === 'st_ew') {
        const gz = stEWs[f.roadIdx % stEWs.length];
        const x = f.dir * wrap(tSec * f.speed + f.phase * 960, 980);
        const z = gz + (f.dir > 0 ? -(1.95 + f.laneIdx * 2.05) : (1.95 + f.laneIdx * 2.05));
        // 隅田川の新設3D鋼桁道路橋を通過する際、アプローチスロープと橋面高さ(Y=+2.10)へ滑らか連動！
        const rcx = getRiverCenterX(gz);
        const rhw = getRiverHalfWidth(gz);
        const distRiv = Math.abs(x - rcx);
        const halfDeck = rhw + 14;
        let vy = 0.0;
        if (distRiv <= halfDeck) vy = 2.10;
        else if (distRiv < halfDeck + 18) vy = 2.10 * (1.0 - (distRiv - halfDeck) / 18.0);
        placeVehicle(i, x, vy, z, f.dir > 0 ? 0 : Math.PI);
      } else if (f.mode === 'st_ns') {
        const gx = stNSs[f.roadIdx % stNSs.length];
        // 湾岸通り手前(Z=+228)で折り返し、海へ車が突っ込む不整合を完全防止！
        const z = -120 + f.dir * wrap(tSec * f.speed + f.phase * 680, 690);
        const x = gx + (f.dir > 0 ? (1.95 + f.laneIdx * 2.05) : -(1.95 + f.laneIdx * 2.05));
        // 東西運河(Z=38)の新設都市運河橋(X=-122, +132)通過時は橋面(Y=+0.74)へ滑らか連動！
        let vy = 0.0;
        if (gx === -122 || gx === 132) {
          const dzc = Math.abs(z - 38.0);
          if (dzc <= 6.3) vy = 0.74;
          else if (dzc < 14.8) vy = 0.74 * (1.0 - (dzc - 6.3) / 8.5);
        }
        placeVehicle(i, x, vy, z, f.dir > 0 ? -Math.PI * 0.5 : Math.PI * 0.5);
      } else {
        const rawU = (f.phase + tSec * f.speed) % 1.0;
        const u = Math.min(0.999, Math.max(0.001, rawU < 0 ? rawU + 1.0 : rawU));
        const curve = jctCurves[f.curveIdx];
        if (curve) {
          curve.getPointAt(u, pTmp);
          curve.getTangentAt(u, tTmp);
          const yaw = Math.atan2(-tTmp.z, tTmp.x);
          placeVehicle(i, pTmp.x, pTmp.y + 0.78, pTmp.z, yaw);
        }
      }
    }
    vehicles.instBody.instanceMatrix.needsUpdate = true;
    vehicles.instCab.instanceMatrix.needsUpdate = true;
    vehicles.instWheels.instanceMatrix.needsUpdate = true;
    vehicles.instHead.instanceMatrix.needsUpdate = true;
    vehicles.instTail.instanceMatrix.needsUpdate = true;
  }

  function setWorldScale(scaleMode) {
    if (scaleMode === 'core') {
      root.visible = false;
      return;
    }
    root.visible = true;
    const isXray = scaleMode === 'wide_xray';
    apronAll.visible = (scaleMode === 'full' || isXray);
    pitFrameGroup.visible = (scaleMode === 'hybrid');
    // 重要：地上モード('full')および中心ピット('hybrid')では広域地下網を完全非表示にして、海や地面から地下が透ける違和感を100%撲滅！
    wideUnderground.visible = isXray;

    // 広域地下X-Ray時のみ地面・歩道縁石・交差点デカール・広域建築・水面をクリスタル半透明へ切替！
    groundMat.transparent = isXray;
    groundMat.opacity = isXray ? 0.22 : 1.0;
    groundMat.depthWrite = !isXray;
    groundMat.needsUpdate = true;

    curbGroupMain.visible = !isXray;
    curbGroupApron.visible = !isXray;

    interMat.opacity = isXray ? 0.30 : 1.0;
    interMat.depthWrite = !isXray;
    interMat.needsUpdate = true;
    interTMat.opacity = isXray ? 0.30 : 1.0;
    interTMat.depthWrite = !isXray;
    interTMat.needsUpdate = true;

    for (const bm of xrayBldgMats) {
      bm.transparent = isXray;
      bm.opacity = isXray ? 0.24 : 1.0;
      bm.depthWrite = !isXray;
      bm.needsUpdate = true;
    }

    waterMat.transparent = isXray;
    waterMat.opacity = isXray ? 0.26 : 1.0;
    waterMat.depthWrite = !isXray;
    waterMat.needsUpdate = true;
  }

  function setTheme(theme) {
    const isDay = theme === 'day';
    const isTwi = theme === 'twilight';
    for (const m of emissiveMats) {
      m.emissiveIntensity = isDay ? 0.05 : isTwi ? 0.72 : 0.94;
    }
    // ナイト時の地面白飛びを解消し、しっとりした東京の夜景舗装＋光り輝く車両＆街路灯を演出！
    groundMat.color.setHex(isDay ? 0xffffff : isTwi ? 0xc8bab0 : 0x6c7a90);
    curbMat.color.setHex(isDay ? 0xc8ced6 : isTwi ? 0xa69c94 : 0x5c687c);
    interMat.color.setHex(isDay ? 0xffffff : isTwi ? 0xd2c4ba : 0x8a98ae);
    interTMat.color.setHex(isDay ? 0xffffff : isTwi ? 0xd2c4ba : 0x8a98ae);
    vehicles.headMat.emissiveIntensity = isDay ? 0.25 : 1.25;
    vehicles.tailMat.emissiveIntensity = isDay ? 0.35 : 1.35;
    rimMat.color.setHex(isDay ? 0x8bb8d8 : isTwi ? 0x261d34 : 0x071122);
  }

  return {
    root,
    update,
    setWorldScale,
    setTheme,
    stats,
  };
}
