/**
 * RETAINING WALL LAB — 擁壁 外的安定・目地安定計算エンジン
 * （L型 / 逆T型 RC擁壁 ＆ 大型積みブロック擁壁 対応）
 *
 * 道路土工「擁壁工指針」および地盤構造力学の考え方を参考にした
 * ブラウザ内リアルタイム安定計算モジュール（外部依存ゼロ・0ms計算）。
 *
 * 共通座標系（単位奥行き 1.0 m あたり）:
 *   X = 0.0 : 底版／基礎底面のつま先先端（転倒モーメント基準点 O）
 *   +X 方向 : 背面（盛土側）、基礎かかと先端は X = B
 *   Y = 0.0 : 底版／基礎底面（均しコンクリート上面）
 *   +Y 方向 : 上向き、擁壁天端高は Y = H
 *
 * 注意: メカニズム理解・学習・形式比較用の簡易計算エンジンです。
 * 実務設計では現地地盤調査・製品ごとの認定仕様および各種基準・構造細目に基づく詳細照査を行ってください。
 */

export const GAMMA_C = 24.5; // 鉄筋コンクリート単位体積重量 [kN/m³]
export const GAMMA_PLAIN_C = 23.5; // 無筋コンクリート単位体積重量 [kN/m³]（基礎・笠コン）
export const GAMMA_W = 9.81; // 水の単位体積重量 [kN/m³]
export const GAMMA_BLOCK_GRAVEL = 21.0; // 大型ブロック（中詰め砕石）合成単位体積重量 [kN/m³]
export const GAMMA_BLOCK_CONC = 23.0; // 大型ブロック（胴込めコン充填）合成単位体積重量 [kN/m³]
export const INTERLOCK_SHEAR_CAPACITY = 18.0; // ブロック間噛み合わせ・連結ピン有効せん断抵抗 [kN/m]

export const WALL_TYPES = {
  L_WALL: 'l_wall',
  LARGE_BLOCK: 'large_block',
};

export const MIN_EMBED_DEPTH = 0.50; // 道路土工・擁壁工指針 最小根入れ深さ [m]

export const PARAM_RANGES = {
  H: { min: 2.0, max: 7.0 },
  B: { min: 1.4, max: 5.5 },
  B_toe: { min: 0.0, max: 1.6 },
  t_top: { min: 0.25, max: 0.60 },
  t_stem: { min: 0.30, max: 0.85 },
  t_base: { min: 0.30, max: 0.85 },
  embedDepth: { min: 0.30, max: 1.20 },
  // 大型積みブロック固有パラメータ（前面・背面平行の規格ブロック断面）
  frontSlope: { min: 0.20, max: 0.55 },
  blockDepth: { min: 0.65, max: 2.00 },
  blockDepthTop: { min: 0.65, max: 2.00 },
  courseHeight: { min: 0.50, max: 1.00 },
  muJoint: { min: 0.40, max: 0.75 },
  // 共通荷重・地盤定数
  betaDeg: { min: 0, max: 25 },
  qSurcharge: { min: 0, max: 30 },
  waterRatio: { min: 0.0, max: 0.90 },
  phiDeg: { min: 20, max: 40 },
  gammaSoil: { min: 16.0, max: 21.0 },
  muBase: { min: 0.35, max: 0.70 },
  qa: { min: 80, max: 450 },
  kh: { min: 0.0, max: 0.25 },
};

export const DEFAULT_PARAMS = {
  wallType: 'l_wall',
  H: 4.0,
  B: 2.8,
  B_toe: 0.45,
  t_top: 0.30,
  t_stem: 0.42,
  t_base: 0.45,
  embedDepth: 0.50,
  hasKey: false,
  // 大型積みブロック固有デフォルト（前面・背面平行）
  frontSlope: 0.35,
  blockDepth: 1.20,
  blockDepthTop: 1.20,
  courseHeight: 0.50,
  muJoint: 0.60,
  hasInterlock: true,
  fillConcrete: false,
  // 共通荷重・地盤定数
  betaDeg: 0,
  qSurcharge: 10,
  waterRatio: 0.0,
  phiDeg: 30,
  gammaSoil: 18.0,
  muBase: 0.55,
  qa: 250,
  kh: 0.0,
};

export const LARGE_BLOCK_DEFAULTS = {
  ...DEFAULT_PARAMS,
  wallType: 'large_block',
  H: 4.0,
  B: 1.80,
  t_base: 0.40,
  embedDepth: 0.50,
  frontSlope: 0.35,
  blockDepth: 1.20,
  blockDepthTop: 1.20,
  courseHeight: 0.50,
  muJoint: 0.60,
  hasInterlock: true,
  fillConcrete: false,
  betaDeg: 0,
  qSurcharge: 10,
  waterRatio: 0.0,
  phiDeg: 30,
  gammaSoil: 18.0,
  muBase: 0.55,
  qa: 250,
  kh: 0.0,
};

export const PRESETS = [
  {
    id: 'standard',
    name: '① 標準設計（常時・全OK）',
    badge: '安全基準クリア',
    badgeType: 'ok',
    description:
      '全高4.0m・底版幅2.8mの標準RC L型擁壁。水抜き孔が健全に機能し、滑動・転倒・支持力の3基準すべてを余裕をもって満たします。',
    params: { ...DEFAULT_PARAMS },
  },
  {
    id: 'waterlog',
    name: '② 水抜き孔詰まり（水位上昇）',
    badge: '静水圧でNG',
    badgeType: 'ng',
    description:
      '水抜き孔の目詰まりにより背面地下水位が上昇（水位比85%）。巨大な残留静水圧と底面揚圧力が作用し、滑動および転倒（偏心過大）がNGとなります。',
    params: { ...DEFAULT_PARAMS, waterRatio: 0.85 },
  },
  {
    id: 'seismic',
    name: '③ 地震時（水平震度 kh=0.15）',
    badge: '物部・岡部式',
    badgeType: 'ng',
    description:
      'レベル1地震時（kh=0.15）。物部・岡部式による地震時土圧増大と慣性力で滑動NGとなりますが、底面突起（せん断キー）ONや底版幅拡大で回復できます。',
    params: { ...DEFAULT_PARAMS, kh: 0.15 },
  },
  {
    id: 'narrow',
    name: '④ 底版幅不足（転倒危険）',
    badge: '偏心 e > B/6',
    badgeType: 'ng',
    description:
      '底版幅を1.85mへ縮小した危険断面。かかと上の押さえ土重量と抵抗腕長が不足し、偏心距離がB/6を大幅に超過してかかと側が浮き上がります。',
    params: { ...DEFAULT_PARAMS, B: 1.85 },
  },
  {
    id: 'softsoil',
    name: '⑤ 軟弱地盤（支持力不足）',
    badge: 'つま先めり込み',
    badgeType: 'ng',
    description:
      '許容支持力度 qa=100 kN/m² の軟弱地盤。滑動・転倒は基準内ですが、つま先端の最大接地圧が許容値を超過します（つま先版や底版幅の拡大で改善）。',
    params: { ...DEFAULT_PARAMS, qa: 100 },
  },
];

export const BLOCK_PRESETS = [
  {
    id: 'block_standard',
    name: '① 標準積み（常時・全OK）',
    badge: '安全基準クリア',
    badgeType: 'ok',
    description:
      '全高4.0m・前面/背面平行（1:0.35）・控長1.20m・基礎幅1.80mの標準大型積みブロック擁壁。もたれ効果により土圧が低減され、基礎底面・全7段目地とも安全基準内です。',
    params: { ...LARGE_BLOCK_DEFAULTS },
  },
  {
    id: 'block_joint_slide',
    name: '② 目地ズレ危険（連結なし・地震）',
    badge: '段間滑動NG',
    badgeType: 'ng',
    description:
      '地震時（kh=0.12）にブロック間の噛み合わせ・連結ピンをOFFとしたケース。基礎底面は安定ですがブロック目地が先に滑動NGとなります（連結ピンONで全OKへ回復）。',
    params: {
      ...LARGE_BLOCK_DEFAULTS,
      B: 2.00,
      blockDepth: 1.25,
      blockDepthTop: 1.25,
      muBase: 0.68,
      muJoint: 0.52,
      hasInterlock: false,
      kh: 0.12,
    },
  },
  {
    id: 'block_waterlog',
    name: '③ 水抜き孔詰まり（水位上昇）',
    badge: '水圧・目地NG',
    badgeType: 'ng',
    description:
      '背面排水不良により地下水位比80%まで上昇。残留静水圧と底面・目地内の揚圧力が増大し、底面滑動・転倒および目地安定がNGとなります。',
    params: { ...LARGE_BLOCK_DEFAULTS, waterRatio: 0.80 },
  },
  {
    id: 'block_steep',
    name: '④ 急勾配・控え不足（転倒危険）',
    badge: '偏心過大',
    badgeType: 'ng',
    description:
      '急勾配1:0.20・ブロック控長0.80m・基礎幅1.40mのスリム断面。もたれ効果が小さく自重・腕長不足により偏心距離が許容核を超過します。',
    params: {
      ...LARGE_BLOCK_DEFAULTS,
      B: 1.40,
      frontSlope: 0.20,
      blockDepth: 0.80,
      blockDepthTop: 0.80,
      hasInterlock: true,
    },
  },
  {
    id: 'block_softsoil',
    name: '⑤ 軟弱地盤（支持力不足）',
    badge: 'つま先めり込み',
    badgeType: 'ng',
    description:
      '許容支持力度 qa=90 kN/m² の軟弱地盤（全高5.0m・1:0.30・胴込めコン充填）。滑動・転倒・目地はOKですが、大きな自重によりつま先接地圧が許容値を超過します。',
    params: {
      ...LARGE_BLOCK_DEFAULTS,
      H: 5.0,
      B: 1.90,
      frontSlope: 0.30,
      blockDepth: 1.30,
      blockDepthTop: 1.30,
      fillConcrete: true,
      qa: 90,
    },
  },
];

export function getPresetsForWallType(wallType = 'l_wall') {
  return wallType === WALL_TYPES.LARGE_BLOCK ? BLOCK_PRESETS : PRESETS;
}

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const MIN_HEEL_LENGTH = 0.30;
const KEY_DEPTH = 0.55;
const KEY_WIDTH = 0.45;
const UPLIFT_HEEL_FACTOR = 0.65;
const JOINT_UPLIFT_FACTOR = 0.50;
const KEY_PASSIVE_ETA = 0.50;
const MAX_DISPLAY_Q = 9999;

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function readNum(raw, fallback, range) {
  if (raw === null || raw === undefined || raw === '') {
    return range ? clamp(fallback, range.min, range.max) : fallback;
  }
  const n = Number(raw);
  const v = Number.isFinite(n) ? n : fallback;
  return range ? clamp(v, range.min, range.max) : v;
}

/**
 * 入力パラメータを仕様範囲・幾何制約に整合させる。
 * L型: t_stem >= t_top, B_heel >= 0.30m
 * 大型ブロック: wallType='large_block' およびブロック固有パラメータをクランプ
 */
export function sanitizeParams(input = {}) {
  const src = { ...DEFAULT_PARAMS, ...(input || {}) };
  const wallType =
    src.wallType === WALL_TYPES.LARGE_BLOCK ? WALL_TYPES.LARGE_BLOCK : WALL_TYPES.L_WALL;

  const H = readNum(src.H, DEFAULT_PARAMS.H, PARAM_RANGES.H);
  const t_base = clamp(
    readNum(src.t_base, DEFAULT_PARAMS.t_base, PARAM_RANGES.t_base),
    PARAM_RANGES.t_base.min,
    Math.min(PARAM_RANGES.t_base.max, H - 0.5)
  );
  const embedDepth = clamp(
    readNum(src.embedDepth, DEFAULT_PARAMS.embedDepth, PARAM_RANGES.embedDepth),
    PARAM_RANGES.embedDepth.min,
    Math.min(PARAM_RANGES.embedDepth.max, H - 0.8)
  );
  const t_top = readNum(src.t_top, DEFAULT_PARAMS.t_top, PARAM_RANGES.t_top);
  const t_stem = clamp(
    Math.max(readNum(src.t_stem, DEFAULT_PARAMS.t_stem, PARAM_RANGES.t_stem), t_top),
    PARAM_RANGES.t_stem.min,
    PARAM_RANGES.t_stem.max
  );
  const B = readNum(src.B, DEFAULT_PARAMS.B, PARAM_RANGES.B);
  const maxToe = Math.max(0.0, B - t_stem - MIN_HEEL_LENGTH);
  const B_toe = clamp(
    readNum(src.B_toe, DEFAULT_PARAMS.B_toe, PARAM_RANGES.B_toe),
    0.0,
    maxToe
  );

  // 大型ブロック固有パラメータ（前面・背面平行：blockDepth が全段共通の水平控長）
  const frontSlope = readNum(src.frontSlope, DEFAULT_PARAMS.frontSlope, PARAM_RANGES.frontSlope);
  const rawBlockDepth =
    input && input.blockDepth !== undefined
      ? input.blockDepth
      : input && input.blockDepthTop !== undefined
        ? input.blockDepthTop
        : src.blockDepth ?? src.blockDepthTop;
  let blockDepth = readNum(rawBlockDepth, DEFAULT_PARAMS.blockDepth, PARAM_RANGES.blockDepth);
  let B_final = B;
  if (wallType === WALL_TYPES.LARGE_BLOCK) {
    // 基礎底幅 B >= blockDepth + 0.30m（前後フーチング最小 0.15m ずつ）を保証
    const minBase = blockDepth + 0.30;
    if (B_final < minBase) {
      if (input && input.B !== undefined && input.blockDepth === undefined && input.blockDepthTop === undefined) {
        blockDepth = clamp(B_final - 0.30, PARAM_RANGES.blockDepth.min, PARAM_RANGES.blockDepth.max);
        B_final = Math.max(B_final, blockDepth + 0.30);
      } else {
        B_final = clamp(minBase, PARAM_RANGES.B.min, PARAM_RANGES.B.max);
        blockDepth = Math.min(blockDepth, B_final - 0.30);
      }
    }
  }
  const courseHeight = readNum(
    src.courseHeight,
    DEFAULT_PARAMS.courseHeight,
    PARAM_RANGES.courseHeight
  );
  const muJoint = readNum(src.muJoint, DEFAULT_PARAMS.muJoint, PARAM_RANGES.muJoint);
  const hasInterlock =
    src.hasInterlock === undefined ? DEFAULT_PARAMS.hasInterlock : Boolean(src.hasInterlock);
  const fillConcrete =
    src.fillConcrete === undefined ? DEFAULT_PARAMS.fillConcrete : Boolean(src.fillConcrete);

  return {
    wallType,
    H,
    B: B_final,
    B_toe,
    t_top,
    t_stem,
    t_base,
    embedDepth,
    hasKey: Boolean(src.hasKey),
    frontSlope,
    blockDepth,
    blockDepthTop: blockDepth,
    courseHeight,
    muJoint,
    hasInterlock,
    fillConcrete,
    betaDeg: readNum(src.betaDeg, DEFAULT_PARAMS.betaDeg, PARAM_RANGES.betaDeg),
    qSurcharge: readNum(src.qSurcharge, DEFAULT_PARAMS.qSurcharge, PARAM_RANGES.qSurcharge),
    waterRatio: readNum(src.waterRatio, DEFAULT_PARAMS.waterRatio, PARAM_RANGES.waterRatio),
    phiDeg: readNum(src.phiDeg, DEFAULT_PARAMS.phiDeg, PARAM_RANGES.phiDeg),
    gammaSoil: readNum(src.gammaSoil, DEFAULT_PARAMS.gammaSoil, PARAM_RANGES.gammaSoil),
    muBase: readNum(src.muBase, DEFAULT_PARAMS.muBase, PARAM_RANGES.muBase),
    qa: readNum(src.qa, DEFAULT_PARAMS.qa, PARAM_RANGES.qa),
    kh: readNum(src.kh, DEFAULT_PARAMS.kh, PARAM_RANGES.kh),
  };
}

/**
 * 主働土圧係数（常時: クーロン式 / 地震時: 物部・岡部式）を計算する。
 * 鉛直仮想背面 (α = 90°), 壁面摩擦角 δ = β。
 * phi - thetaE - beta の下限保護 2° を適用し、斜面すべり限界付近の NaN/発散を防止する。
 */
function computeActiveEarthPressureCoeff(phiRad, betaRad, deltaRad, thetaERad) {
  const minDiffRad = 2.0 * DEG2RAD;
  const rawDiff = phiRad - thetaERad - betaRad;
  const clampedSlopeLimit = rawDiff < minDiffRad;
  const effectiveDiff = Math.max(minDiffRad, rawDiff);

  const cosPhiTheta = Math.cos(Math.max(minDiffRad, phiRad - thetaERad));
  const cosTheta = Math.cos(thetaERad);
  const cosDeltaTheta = Math.max(1e-4, Math.cos(deltaRad + thetaERad));
  const cosBeta = Math.max(1e-4, Math.cos(betaRad));

  const sinNum = Math.max(0, Math.sin(phiRad + deltaRad) * Math.sin(effectiveDiff));
  const rootTerm = Math.sqrt(sinNum / (cosDeltaTheta * cosBeta));
  const denom = cosTheta * cosDeltaTheta * (1 + rootTerm) * (1 + rootTerm);
  const ka = (cosPhiTheta * cosPhiTheta) / denom;

  return { ka, clampedSlopeLimit };
}

/**
 * 一般傾斜壁背面に対する主働土圧係数（常時: 一般クーロン式 / 地震時: 一般物部・岡部式）
 *
 * 角度定義（道路土工・擁壁工指針 準拠）:
 *   alphaRad : 壁背面角（鉛直=90°, 盛土側へもたれ傾き > 90°, 逆傾斜 < 90°）
 *   phiRad   : 背面土内部摩擦角 φ
 *   betaRad  : 地表面勾配角 β
 *   deltaRad : 壁面摩擦角 δ
 *   thetaERad: 地震合成角 θe = atan(kh)
 *
 * 水平成分係数: kaH = ka * sin(alpha - delta)
 * 鉛直成分係数: kaV = ka * cos(alpha - delta)  (下向き正)
 */
export function computeGeneralActiveEarthPressureCoeff(
  alphaRad,
  phiRad,
  betaRad,
  deltaRad,
  thetaERad = 0
) {
  const minDiffRad = 2.0 * DEG2RAD;
  const alphaSafe = clamp(alphaRad, 60 * DEG2RAD, 120 * DEG2RAD);
  const rawDiff = phiRad - thetaERad - betaRad;
  const clampedSlopeLimit = rawDiff < minDiffRad || Math.abs(alphaSafe - alphaRad) > 1e-6;
  const effectiveDiff = Math.max(minDiffRad, rawDiff);

  // 分母の sin(alpha - delta - thetaE) と sin(alpha + beta) の下限保護
  const alphaMinusDeltaTheta = clamp(alphaSafe - deltaRad - thetaERad, 15 * DEG2RAD, 165 * DEG2RAD);
  const alphaPlusBeta = clamp(alphaSafe + betaRad, 15 * DEG2RAD, 170 * DEG2RAD);
  const alphaPlusPhiTheta = clamp(alphaSafe + phiRad - thetaERad, 10 * DEG2RAD, 170 * DEG2RAD);

  const sinNum = Math.max(0, Math.sin(phiRad + deltaRad) * Math.sin(effectiveDiff));
  const sinDen = Math.max(1e-4, Math.sin(alphaMinusDeltaTheta) * Math.sin(alphaPlusBeta));
  const rootTerm = Math.sqrt(sinNum / sinDen);

  const sinAlpha = Math.max(1e-4, Math.sin(alphaSafe));
  const cosTheta = Math.max(1e-4, Math.cos(thetaERad));
  const sinAlphaPhiTheta = Math.sin(alphaPlusPhiTheta);
  const denom =
    cosTheta *
    sinAlpha *
    sinAlpha *
    Math.sin(alphaMinusDeltaTheta) *
    (1 + rootTerm) *
    (1 + rootTerm);

  const ka = (sinAlphaPhiTheta * sinAlphaPhiTheta) / denom;
  const kaH = ka * Math.sin(alphaSafe - deltaRad);
  const kaV = ka * Math.cos(alphaSafe - deltaRad);

  return {
    ka,
    kaH,
    kaV,
    alphaRadUsed: alphaSafe,
    clampedSlopeLimit,
  };
}

/**
 * クーロン／物部・岡部理論に基づく主働すべり面角 θ_slip [deg]（水平面から背面側へ立ち上がる角度）
 * 常時・鉛直壁 (α=90°)・水平地表面 (β=0°)・δ=0° で厳密に 45° + φ/2 に一致。
 * 地震時 (kh > 0) や背面勾配 β > 0 ではすべり角が浅くなり、道路側の崩壊幅が拡大する。
 */
export function computeActiveSlipAngleDeg(alphaRad, phiRad, betaRad, deltaRad, thetaERad = 0) {
  const minDiff = 3.0 * DEG2RAD;
  const phiEff = Math.max(8 * DEG2RAD, phiRad - thetaERad);
  const c1 = Math.max(minDiff, phiEff - betaRad);
  const tanC1 = Math.tan(c1);
  const cotC1 = 1 / Math.max(1e-4, tanC1);
  // 背面傾斜角の鉛直からの偏差 (90° - α): もたれ壁 (α > 90°) では負、鉛直で 0
  const psi = clamp(deltaRad + thetaERad + (Math.PI * 0.5 - alphaRad), -35 * DEG2RAD, 55 * DEG2RAD);
  const tanPsi = Math.tan(psi);

  const insideRoot = tanC1 * (tanC1 + cotC1) * Math.max(0.05, 1 + tanPsi * cotC1);
  const num = -tanC1 + Math.sqrt(Math.max(0, insideRoot));
  const den = Math.max(0.15, 1 + tanPsi * (tanC1 + cotC1));
  const slipRad = phiEff + Math.atan(num / den);
  return clamp(slipRad * RAD2DEG, 30, 68);
}

/**
 * すべり面起点 (originX, originY) から角度 slipAngleDeg で立ち上がる直線と
 * 背面地表面 Y(x) = H + max(0, x - xSlopeStart) * tan(beta) との交点（道路クラック位置）を算出。
 */
function computeSlipCrackExit(originX, originY, slipAngleDeg, H, xSlopeStart, betaRad) {
  const tanSlip = Math.tan(slipAngleDeg * DEG2RAD);
  const tanBeta = Math.tan(betaRad);
  // まず水平天端 (Y = H) との交点
  const xFlat = originX + Math.max(0.1, H - originY) / Math.max(0.15, tanSlip);
  if (xFlat <= xSlopeStart || tanBeta <= 1e-6) {
    return { crackX: xFlat, crackY: H };
  }
  // 勾配部 Y = H + (x - xSlopeStart)*tanBeta との解析交点
  const denom = Math.max(0.12, tanSlip - tanBeta);
  const crackX = (H - originY + originX * tanSlip - xSlopeStart * tanBeta) / denom;
  const safeCrackX = Math.max(xSlopeStart + 0.25, crackX);
  const crackY = H + Math.max(0, safeCrackX - xSlopeStart) * tanBeta;
  return { crackX: safeCrackX, crackY };
}

function fmt(n, digits = 2) {
  return Number.isFinite(n) ? n.toFixed(digits) : '—';
}

/**
 * 道路土工・擁壁工指針に基づく最小根入れ深さ（原則 Df >= 0.50m ＆ 基礎・底版上面被覆）チェック
 * 前面受働土圧は将来の掘削・洗掘等を考慮し安全側として外的安定計算には見込まない。
 */
function buildEmbedmentCheck(embedDepth, t_base) {
  const minRequired = MIN_EMBED_DEPTH;
  const meetsMin = embedDepth >= minRequired - 1e-6;
  const coversBase = embedDepth >= t_base - 1e-6;
  const ok = meetsMin && coversBase;
  let statusJa;
  if (!meetsMin) {
    statusJa = `最小根入れ ${fmt(minRequired, 2)}m 未満（道路土工指針の構造細目注意）`;
  } else if (!coversBase) {
    statusJa = `底版／基礎厚 ${fmt(t_base, 2)}m より浅く前面露出（根入れ不足注意）`;
  } else {
    statusJa = `最小根入れ基準（≥ ${fmt(minRequired, 2)}m）適合（前面受働土圧は安全側無視）`;
  }
  return {
    df: embedDepth,
    minRequired,
    meetsMin,
    coversBase,
    ok,
    passiveIgnored: true,
    statusJa,
  };
}

/**
 * 擁壁の外的安定（および大型ブロック時は全段目地安定）計算を実行する。
 * @param {Partial<typeof DEFAULT_PARAMS>} rawParams
 */
export function computeWallStability(rawParams = {}) {
  const params = sanitizeParams(rawParams);
  if (params.wallType === WALL_TYPES.LARGE_BLOCK) {
    return computeLargeBlockWallStability(params);
  }
  return computeLWallStability(params);
}

/**
 * L型 / 逆T型 RC擁壁の外的安定計算
 */
function computeLWallStability(params) {
  const {
    H,
    B,
    B_toe,
    t_top,
    t_stem,
    t_base,
    embedDepth,
    hasKey,
    betaDeg,
    qSurcharge,
    waterRatio,
    phiDeg,
    gammaSoil,
    muBase,
    qa,
    kh,
  } = params;

  const isSeismic = kh > 1e-9;

  // --- 1. 断面ジオメトリ計算 ---
  const H_stem = H - t_base;
  const B_heel = B - B_toe - t_stem;
  const x_front = B_toe;
  const x_back_top = B_toe + t_top;
  const x_back_bot = B_toe + t_stem;
  const w_taper = Math.max(0, t_stem - t_top);

  const betaRad = betaDeg * DEG2RAD;
  const phiRad = phiDeg * DEG2RAD;
  const deltaRad = betaRad; // 仮想背面での壁面摩擦角 δ = β
  const thetaERad = isSeismic ? Math.atan(kh) : 0;

  const h_slope = B_heel * Math.tan(betaRad);
  const H_v = H + h_slope; // 仮想背面（X = B）の全高
  const H_w = waterRatio * H_stem; // 背面地下水位（Y = 0 からの標高）

  const keyDepth = KEY_DEPTH;
  const keyWidth = KEY_WIDTH;
  const rawKeyX = B_toe + t_stem + 0.35 * B_heel;
  const keyX = clamp(rawKeyX, keyWidth / 2 + 0.05, Math.max(keyWidth / 2 + 0.05, B - keyWidth / 2));

  const geom = {
    wallType: WALL_TYPES.L_WALL,
    H,
    B,
    B_toe,
    B_heel,
    t_top,
    t_stem,
    t_base,
    embedDepth,
    visibleHeight: Math.max(0.5, H - embedDepth),
    H_stem,
    H_v,
    H_w,
    x_front,
    x_back_top,
    x_back_bot,
    hasKey,
    keyX,
    keyDepth,
    keyWidth,
  };

  // --- 2. 土圧係数・地盤定数 ---
  const gammaSat = gammaSoil + 1.5;
  const gammaSub = gammaSat - GAMMA_W;
  const { ka, clampedSlopeLimit } = computeActiveEarthPressureCoeff(
    phiRad,
    betaRad,
    deltaRad,
    thetaERad
  );
  const kaH = ka * Math.cos(deltaRad);
  const kaV = ka * Math.sin(deltaRad);

  // 基礎地盤の内部摩擦角 φ_B（底面摩擦角 δ_B = atan(μ) と背面土 φ の整合から設定）
  const phiBaseRad = clamp(Math.max(phiRad, Math.atan(muBase) * 1.15), 20 * DEG2RAD, 42 * DEG2RAD);
  const tanPass = Math.tan(Math.PI / 4 + phiBaseRad / 2);
  const kpBase = tanPass * tanPass;
  const kaBase = 1 / kpBase;

  const coeff = {
    ka,
    kaH,
    kaV,
    alphaDeg: 90,
    deltaDeg: deltaRad * RAD2DEG,
    thetaEDeg: thetaERad * RAD2DEG,
    kpBase,
    kaBase,
    phiBaseDeg: phiBaseRad * RAD2DEG,
    gammaSat,
    gammaSub,
    clampedSlopeLimit,
  };

  // --- 3. 擁壁コンクリート自重 ---
  const W_base = GAMMA_C * B * t_base;
  const x_base = B / 2;
  const y_base = t_base / 2;

  const W_stem_rect = GAMMA_C * t_top * H_stem;
  const x_stem_rect = x_front + t_top / 2;
  const y_stem_rect = t_base + H_stem / 2;

  const W_stem_tri = GAMMA_C * 0.5 * w_taper * H_stem;
  const x_stem_tri = x_back_top + w_taper / 3;
  const y_stem_tri = t_base + H_stem / 3;

  const W_key = hasKey ? GAMMA_C * keyWidth * keyDepth : 0;
  const x_key = keyX;
  const y_key_inertia = 0; // 地中埋設部（Y < 0）のため転倒モーメント腕長は 0

  const W_conc = W_base + W_stem_rect + W_stem_tri + W_key;

  // --- 4. 仮想背面内の土塊重量（全応力境界法：水面下は γ_sat、境界水圧は Pw & U として外力載荷） ---
  const h_sat_heel = clamp(H_w - t_base, 0, H_stem);
  const h_dry_heel = H_stem - h_sat_heel;

  const W_soil_rect_dry = gammaSoil * B_heel * h_dry_heel;
  const y_soil_rect_dry = t_base + h_sat_heel + h_dry_heel / 2;
  const W_soil_rect_sat = gammaSat * B_heel * h_sat_heel;
  const y_soil_rect_sat = t_base + h_sat_heel / 2;
  const W_soil_rect = W_soil_rect_dry + W_soil_rect_sat;
  const x_soil_rect = x_back_bot + B_heel / 2;
  const y_soil_rect =
    W_soil_rect > 1e-9
      ? (W_soil_rect_dry * y_soil_rect_dry + W_soil_rect_sat * y_soil_rect_sat) / W_soil_rect
      : t_base + H_stem / 2;

  // たて壁背面テーパー上三角形土塊（地下水面交差を厳密積分）
  const A_wedge = 0.5 * w_taper * H_stem;
  const W_wedge_base = gammaSoil * A_wedge;
  const x_wedge_base = x_back_top + (2 / 3) * w_taper;
  const y_wedge_base = t_base + (2 / 3) * H_stem;

  const w_sat_wedge = H_stem > 1e-9 ? w_taper * (h_sat_heel / H_stem) : 0;
  const W_wedge_sat_add = (gammaSat - gammaSoil) * 0.5 * w_sat_wedge * h_sat_heel;
  const x_wedge_sat = x_back_bot - w_sat_wedge / 3;
  const y_wedge_sat = t_base + (2 / 3) * h_sat_heel;

  const W_soil_wedge = W_wedge_base + W_wedge_sat_add;
  const x_soil_wedge =
    W_soil_wedge > 1e-9
      ? (W_wedge_base * x_wedge_base + W_wedge_sat_add * x_wedge_sat) / W_soil_wedge
      : x_back_top;
  const y_soil_wedge =
    W_soil_wedge > 1e-9
      ? (W_wedge_base * y_wedge_base + W_wedge_sat_add * y_wedge_sat) / W_soil_wedge
      : t_base + (2 / 3) * H_stem;

  // 背面地表面勾配部三角形土塊（H_w <= 0.9*H_stem < H より常に湿潤土）
  const W_soil_slope = gammaSoil * 0.5 * B_heel * h_slope;
  const x_soil_slope = x_back_bot + (2 / 3) * B_heel;
  const y_soil_slope = H + h_slope / 3;

  const W_soil = W_soil_rect + W_soil_wedge + W_soil_slope;

  // かかと版上の上載荷重
  const W_q = qSurcharge * B_heel;
  const x_q = x_back_bot + B_heel / 2;

  // --- 5. 仮想背面における有効土圧・上載土圧・静水圧・底面揚圧力 ---
  const H_1 = Math.max(0, H_v - H_w); // 地下水面より上の土層厚
  const p_ah_water = kaH * gammaSoil * H_1; // Y = H_w での水平有効土圧
  const p_ah_bottom = kaH * (gammaSoil * H_1 + gammaSub * H_w); // Y = 0 での水平有効土圧

  // 有効土圧（自重分）を上部三角形・下部矩形・下部三角形へ厳密分解
  const Pa1_h = 0.5 * p_ah_water * H_1;
  const y_Pa1 = H_w + H_1 / 3;

  const Pa2_h = p_ah_water * H_w;
  const y_Pa2 = H_w / 2;

  const Pa3_h = 0.5 * kaH * gammaSub * H_w * H_w;
  const y_Pa3 = H_w / 3;

  const Pa_h = Pa1_h + Pa2_h + Pa3_h;
  const Mt_Pa = Pa1_h * y_Pa1 + Pa2_h * y_Pa2 + Pa3_h * y_Pa3;
  const y_Pa = Pa_h > 1e-9 ? Mt_Pa / Pa_h : H_v / 3;

  const Pa_soil_v =
    0.5 * kaV * gammaSoil * H_1 * H_1 +
    kaV * gammaSoil * H_1 * H_w +
    0.5 * kaV * gammaSub * H_w * H_w;

  // 上載荷重による主働土圧（矩形分布）
  const p_qh = kaH * qSurcharge;
  const Pq_h = p_qh * H_v;
  const y_Pq = H_v / 2;
  const Mt_Pq = Pq_h * y_Pq;
  const Pq_v = kaV * qSurcharge * H_v;

  const Pa_v = Pa_soil_v + Pq_v;

  // 背面残留静水圧（三角形分布、Y = 0 .. H_w）
  const p_w_bottom = GAMMA_W * H_w;
  const Pw_h = 0.5 * p_w_bottom * H_w;
  const y_Pw = H_w / 3;
  const Mt_Pw = Pw_h * y_Pw;

  // 底面揚圧力（かかと側 0.65 * γ_w * H_w → つま先側 0 の三角形、上向き鉛直力・転倒モーメント増大）
  const pu_heel = UPLIFT_HEEL_FACTOR * GAMMA_W * H_w;
  const U_uplift = 0.5 * pu_heel * B;
  const x_uplift = (2 / 3) * B;
  const Mt_U = U_uplift * x_uplift;

  // --- 6. 地震時水平慣性力 ---
  const H_in_conc = isSeismic ? kh * W_conc : 0;
  const Mt_in_conc = isSeismic
    ? kh * (W_base * y_base + W_stem_rect * y_stem_rect + W_stem_tri * y_stem_tri + W_key * y_key_inertia)
    : 0;
  const y_in_conc = H_in_conc > 1e-9 ? Mt_in_conc / H_in_conc : 0;

  const H_in_soil = isSeismic ? kh * W_soil : 0;
  const Mt_in_soil = isSeismic
    ? kh * (W_soil_rect * y_soil_rect + W_soil_wedge * y_soil_wedge + W_soil_slope * y_soil_slope)
    : 0;
  const y_in_soil = H_in_soil > 1e-9 ? Mt_in_soil / H_in_soil : 0;

  const H_inertia = H_in_conc + H_in_soil;
  const Mt_inertia = Mt_in_conc + Mt_in_soil;

  // --- 7. 合計力・モーメント ---
  const sumV = W_conc + W_soil + W_q + Pa_v - U_uplift;
  const sumH = Pa_h + Pq_h + Pw_h + H_inertia;

  const Mr_base = W_base * x_base;
  const Mr_stem_rect = W_stem_rect * x_stem_rect;
  const Mr_stem_tri = W_stem_tri * x_stem_tri;
  const Mr_key = W_key * x_key;
  const Mr_soil_rect = W_soil_rect * x_soil_rect;
  const Mr_soil_wedge = W_soil_wedge * x_soil_wedge;
  const Mr_soil_slope = W_soil_slope * x_soil_slope;
  const Mr_q = W_q * x_q;
  const Mr_Pa_soil = Pa_soil_v * B;
  const Mr_Pq = Pq_v * B;

  const Mr =
    Mr_base +
    Mr_stem_rect +
    Mr_stem_tri +
    Mr_key +
    Mr_soil_rect +
    Mr_soil_wedge +
    Mr_soil_slope +
    Mr_q +
    Mr_Pa_soil +
    Mr_Pq;

  const Mt = Mt_Pa + Mt_Pq + Mt_Pw + Mt_U + Mt_inertia;
  const M_net = Mr - Mt;

  // --- 8. 滑動抵抗（底面摩擦 ＋ 突起受働抵抗） ---
  const R_friction = Math.max(0, sumV) * muBase;

  // 突起（せん断キー）受働土圧抵抗増分:
  // 底版下面深さ d_k に作用するランキン受働−主働差圧に、前方底版拘束上載圧寄与を含め安全低減 η=0.5 を乗じる
  const gammaBase = gammaSoil + 1.0;
  const qOverburdenKey = 0.25 * Math.max(0, sumV / B);
  const R_key = hasKey
    ? KEY_PASSIVE_ETA *
      (kpBase - kaBase) *
      (0.5 * gammaBase * keyDepth * keyDepth + qOverburdenKey * keyDepth)
    : 0;

  const keyDetail = {
    eta: KEY_PASSIVE_ETA,
    kpBase,
    kaBase,
    gammaBase,
    keyDepth,
    qOverburden: qOverburdenKey,
    R_key,
  };
  coeff.keyDetail = { ...keyDetail };

  const sumR = R_friction + R_key;
  const y_sumH = sumH > 1e-9 ? (Mt_Pa + Mt_Pq + Mt_Pw + Mt_inertia) / sumH : H / 3;

  const forces = {
    W_conc,
    W_soil,
    W_q,
    Pa_v,
    U_uplift,
    sumV,
    Pa_h,
    Pq_h,
    Pw_h,
    H_inertia,
    sumH,
    R_friction,
    R_key,
    sumR,
    y_sumH,
    keyDetail: { ...keyDetail },
  };

  const moments = {
    Mr,
    Mt,
    M_net,
  };

  // --- 9. 3大外的安定照査 ---
  // (1) 滑動照査
  const fssLimit = isSeismic ? 1.20 : 1.50;
  const fss = sumH > 1e-9 ? sumR / sumH : 99.9;
  const slidingOk = fss >= fssLimit && sumV > 0;
  const sliding = {
    fs: fss,
    limit: fssLimit,
    ok: slidingOk,
    ratio: fss / fssLimit,
  };

  // (2) 転倒照査（安全率 & 偏心距離）
  const fsoLimit = isSeismic ? 1.20 : 1.50;
  const fso = Mt > 1e-9 ? Mr / Mt : 99.9;
  const d = sumV > 1e-9 ? M_net / sumV : -B;
  const e = B / 2 - d;
  const eLimit = isSeismic ? B / 3 : B / 6;
  const eRatio = Math.abs(e) / eLimit;
  const overturningOk = Math.abs(e) <= eLimit && fso >= fsoLimit && sumV > 0 && d > 0;

  let upliftGapWidth = 0;
  if (sumV <= 1e-9 || d <= 0) {
    upliftGapWidth = B;
  } else if (e > B / 6) {
    upliftGapWidth = Math.max(0, B - 3 * d);
  } else if (e < -B / 6) {
    upliftGapWidth = Math.max(0, B - 3 * (B - d));
  }

  const overturning = {
    fs: fso,
    fsLimit: fsoLimit,
    d,
    e,
    eLimit,
    eRatio,
    ok: overturningOk,
    upliftGapWidth,
  };

  // (3) 支持力照査（台形分布 / 三角形有効幅 3d 自動切替）
  const qaAllow = isSeismic ? 1.5 * qa : qa;
  let q1 = 0;
  let q2 = 0;
  let isTriangular = false;
  let contactLen = B;

  if (sumV <= 1e-9 || d <= 0) {
    q1 = MAX_DISPLAY_Q;
    q2 = 0;
    isTriangular = true;
    contactLen = 0;
  } else if (Math.abs(e) <= B / 6) {
    q1 = (sumV / B) * (1 + (6 * e) / B);
    q2 = (sumV / B) * (1 - (6 * e) / B);
    isTriangular = false;
    contactLen = B;
  } else if (e > B / 6) {
    q1 = Math.min(MAX_DISPLAY_Q, (2 * sumV) / (3 * d));
    q2 = 0;
    isTriangular = true;
    contactLen = Math.min(B, 3 * d);
  } else {
    // 極端なかかと側偏心（e < -B/6）
    const dHeel = B - d;
    if (dHeel <= 0) {
      q1 = 0;
      q2 = MAX_DISPLAY_Q;
      isTriangular = true;
      contactLen = 0;
    } else {
      q1 = 0;
      q2 = Math.min(MAX_DISPLAY_Q, (2 * sumV) / (3 * dHeel));
      isTriangular = true;
      contactLen = Math.min(B, 3 * dHeel);
    }
  }

  const qMax = Math.max(q1, q2);
  const fsb = qMax > 1e-9 ? qaAllow / qMax : 99.9;
  const bearingOk = qMax <= qaAllow && sumV > 0 && d > 0;

  const bearing = {
    q1,
    q2,
    qMax,
    qaAllow,
    fs: fsb,
    ok: bearingOk,
    isTriangular,
    contactLen,
  };

  const joint = {
    enabled: false,
    ok: true,
    fs: 99.9,
    limit: fssLimit,
    ratio: 99.9,
    criticalCourseIndex: -1,
    criticalCourseNum: 0,
    criticalY: 0,
    criticalWidth: 0,
    criticalSumV: 0,
    criticalSumH: 0,
    criticalSumR: 0,
    criticalE: 0,
    criticalELimit: 1,
    criticalERatio: 0,
    criticalFso: 99.9,
    criticalSlideOk: true,
    criticalOverturnOk: true,
    courses: [],
  };

  const embedment = buildEmbedmentCheck(embedDepth, t_base);
  const checks = { sliding, overturning, bearing, joint, embedment };

  // --- 10. 総合判定・主破壊モード・深刻度 ---
  const overallOk = slidingOk && overturningOk && bearingOk;

  const isCompleteOverturn = d <= 0 || sumV <= 1e-9;
  const defOver = overturningOk
    ? 0
    : isCompleteOverturn
      ? 10.0
      : Math.max(0.01, eRatio - 1.0, fsoLimit / Math.max(fso, 0.01) - 1.0);
  const defSlide = slidingOk ? 0 : Math.max(0.01, fssLimit / Math.max(fss, 0.01) - 1.0);
  const defBear = bearingOk
    ? 0
    : isCompleteOverturn
      ? 2.0
      : Math.min(5.0, Math.max(0.01, qMax / Math.max(qaAllow, 1.0) - 1.0));

  let primaryFailure = 'none';
  let maxDeficit = 0;
  if (!overallOk) {
    const candidates = [
      { mode: 'overturning', def: defOver },
      { mode: 'sliding', def: defSlide },
      { mode: 'bearing', def: defBear },
    ].sort((a, b) => b.def - a.def);
    primaryFailure = candidates[0].mode;
    maxDeficit = candidates[0].def;
  }

  const severity = overallOk ? 0 : clamp(0.15 + maxDeficit * 0.9, 0.15, 1.0);

  let summaryJa;
  if (overallOk) {
    summaryJa = isSeismic
      ? `地震時（kh=${fmt(kh, 2)}）の全基準を満たしています`
      : '滑動・転倒・支持力すべて基準値を満たしています';
  } else {
    // 見出し（転倒 → 滑動 → 支持力）と列挙順序を一貫させる
    const ngList = [];
    if (!overturningOk) ngList.push('転倒');
    if (!slidingOk) ngList.push('滑動');
    if (!bearingOk) ngList.push('支持力');
    const ngTag = ngList.join('・');

    if (primaryFailure === 'overturning') {
      if (isCompleteOverturn) {
        summaryJa = '転倒モーメント超過で完全転倒の危険（底版幅の拡大が必要）';
      } else if (ngList.length > 1) {
        summaryJa = `偏心 e=${fmt(e, 2)}m が許容値 ${fmt(eLimit, 2)}m 超過（${ngTag}NG）`;
      } else {
        summaryJa = `偏心 e=${fmt(e, 2)}m が許容値 ${fmt(eLimit, 2)}m 超過（かかと浮き上がり）`;
      }
    } else if (primaryFailure === 'sliding') {
      if (isSeismic && !hasKey && ngList.length === 1) {
        summaryJa = `滑動安全率 Fss=${fmt(fss, 2)}（基準 ${fmt(fssLimit, 2)} 未満）— 断面寸法の『底面突起』ONで改善可能`;
      } else if (H_w > 0.5 && ngList.length > 1) {
        summaryJa = `背面水圧・揚圧力で Fss=${fmt(fss, 2)}（基準 ${fmt(fssLimit, 2)} 未満・${ngTag}NG）`;
      } else if (ngList.length > 1) {
        summaryJa = `滑動安全率 Fss=${fmt(fss, 2)}（基準 ${fmt(fssLimit, 2)} 未満・${ngTag}NG）`;
      } else {
        summaryJa = `滑動安全率 Fss=${fmt(fss, 2)}（基準 ${fmt(fssLimit, 2)} 未満）`;
      }
    } else {
      if (ngList.length > 1) {
        summaryJa = `最大接地圧 qmax=${fmt(qMax, 1)}（許容 ${fmt(qaAllow, 0)} kN/m² 超過・${ngTag}NG）`;
      } else {
        summaryJa = `最大接地圧 qmax=${fmt(qMax, 1)}（許容 ${fmt(qaAllow, 0)} kN/m² 超過）— 底版・つま先拡大で改善`;
      }
    }
  }

  const overall = {
    ok: overallOk,
    primaryFailure,
    severity,
    summaryJa,
  };

  // --- 11. 2D/3D 描画用 分布図座標配列 ---
  const earthPressurePts =
    H_w > 1e-4
      ? [
          { y: H_v, p: 0 },
          { y: H_w, p: p_ah_water },
          { y: 0, p: p_ah_bottom },
        ]
      : [
          { y: H_v, p: 0 },
          { y: 0, p: p_ah_bottom },
        ];

  const waterPressurePts =
    H_w > 1e-4
      ? [
          { y: H_w, p: 0 },
          { y: 0, p: p_w_bottom },
        ]
      : [];

  const surchargePts =
    qSurcharge > 1e-4
      ? [
          { y: H_v, p: p_qh },
          { y: 0, p: p_qh },
        ]
      : [];

  let bearingPts;
  if (sumV <= 1e-9 || d <= 0) {
    bearingPts = [
      { x: 0, q: q1 },
      { x: Math.min(0.1, B), q: 0 },
      { x: B, q: 0 },
    ];
  } else if (!isTriangular) {
    bearingPts = [
      { x: 0, q: q1 },
      { x: B, q: q2 },
    ];
  } else if (e > B / 6) {
    bearingPts = [
      { x: 0, q: q1 },
      { x: contactLen, q: 0 },
      { x: B, q: 0 },
    ];
  } else {
    bearingPts = [
      { x: 0, q: 0 },
      { x: Math.max(0, B - contactLen), q: 0 },
      { x: B, q: q2 },
    ];
  }

  const upliftPts =
    H_w > 1e-4
      ? [
          { x: 0, p: 0 },
          { x: B, p: pu_heel },
        ]
      : [];

  const diagrams = {
    earthPressurePts,
    waterPressurePts,
    surchargePts,
    bearingPts,
    upliftPts,
  };

  // --- 12. 検算シート用ブレークダウン行配列 ---
  const breakdownRows = [];

  breakdownRows.push({
    id: 'W_base',
    category: 'weight',
    name: '底版コンクリート自重',
    formula: `${fmt(GAMMA_C, 1)} × ${fmt(B)} × ${fmt(t_base)}`,
    V: W_base,
    H: 0,
    armV: x_base,
    armH: null,
    Mr: Mr_base,
    Mt: 0,
  });

  breakdownRows.push({
    id: 'W_stem_rect',
    category: 'weight',
    name: 'たて壁矩形部コンクリート',
    formula: `${fmt(GAMMA_C, 1)} × ${fmt(t_top)} × ${fmt(H_stem)}`,
    V: W_stem_rect,
    H: 0,
    armV: x_stem_rect,
    armH: null,
    Mr: Mr_stem_rect,
    Mt: 0,
  });

  if (w_taper > 1e-6) {
    breakdownRows.push({
      id: 'W_stem_tri',
      category: 'weight',
      name: 'たて壁背面テーパー部',
      formula: `0.5 × ${fmt(GAMMA_C, 1)} × ${fmt(w_taper)} × ${fmt(H_stem)}`,
      V: W_stem_tri,
      H: 0,
      armV: x_stem_tri,
      armH: null,
      Mr: Mr_stem_tri,
      Mt: 0,
    });
  }

  if (hasKey) {
    breakdownRows.push({
      id: 'W_key',
      category: 'weight',
      name: '底面突起（せん断キー）自重',
      formula: `${fmt(GAMMA_C, 1)} × ${fmt(keyWidth)} × ${fmt(keyDepth)}`,
      V: W_key,
      H: 0,
      armV: x_key,
      armH: null,
      Mr: Mr_key,
      Mt: 0,
    });
  }

  breakdownRows.push({
    id: 'W_soil_rect',
    category: 'soil',
    name: 'かかと版上盛土（矩形部）',
    formula:
      h_sat_heel > 1e-4
        ? `${fmt(B_heel)} × (湿潤${fmt(h_dry_heel)}m×${fmt(gammaSoil, 1)} + 飽和${fmt(h_sat_heel)}m×${fmt(gammaSat, 1)})`
        : `${fmt(gammaSoil, 1)} × ${fmt(B_heel)} × ${fmt(H_stem)}`,
    V: W_soil_rect,
    H: 0,
    armV: x_soil_rect,
    armH: null,
    Mr: Mr_soil_rect,
    Mt: 0,
  });

  if (w_taper > 1e-6) {
    breakdownRows.push({
      id: 'W_soil_wedge',
      category: 'soil',
      name: 'たて壁背面テーパー上盛土',
      formula: `0.5 × ${fmt(w_taper)} × ${fmt(H_stem)} × γ`,
      V: W_soil_wedge,
      H: 0,
      armV: x_soil_wedge,
      armH: null,
      Mr: Mr_soil_wedge,
      Mt: 0,
    });
  }

  if (h_slope > 1e-6) {
    breakdownRows.push({
      id: 'W_soil_slope',
      category: 'soil',
      name: `背面勾配部盛土（β=${fmt(betaDeg, 1)}°）`,
      formula: `0.5 × ${fmt(gammaSoil, 1)} × ${fmt(B_heel)} × ${fmt(h_slope)}`,
      V: W_soil_slope,
      H: 0,
      armV: x_soil_slope,
      armH: null,
      Mr: Mr_soil_slope,
      Mt: 0,
    });
  }

  if (W_q > 1e-6) {
    breakdownRows.push({
      id: 'W_q',
      category: 'surcharge',
      name: 'かかと版上 上載荷重',
      formula: `${fmt(qSurcharge, 1)} × ${fmt(B_heel)}`,
      V: W_q,
      H: 0,
      armV: x_q,
      armH: null,
      Mr: Mr_q,
      Mt: 0,
    });
  }

  breakdownRows.push({
    id: 'Pa_soil',
    category: 'earth',
    name: isSeismic
      ? `地震時主働土圧（KAE=${fmt(ka, 3)}）`
      : `常時主働土圧（KA=${fmt(ka, 3)}）`,
    formula:
      H_w > 1e-4
        ? `有効土圧（水面上下区分、Hv=${fmt(H_v)}m, Hw=${fmt(H_w)}m）`
        : `0.5 × ${fmt(kaH, 3)} × ${fmt(gammaSoil, 1)} × ${fmt(H_v)}²`,
    V: Pa_soil_v,
    H: Pa_h,
    armV: Pa_soil_v > 1e-9 ? B : null,
    armH: y_Pa,
    Mr: Mr_Pa_soil,
    Mt: Mt_Pa,
  });

  if (Pq_h > 1e-6 || Pq_v > 1e-6) {
    breakdownRows.push({
      id: 'Pq',
      category: 'earth',
      name: '上載荷重による主働土圧',
      formula: `${fmt(kaH, 3)} × ${fmt(qSurcharge, 1)} × ${fmt(H_v)}`,
      V: Pq_v,
      H: Pq_h,
      armV: Pq_v > 1e-9 ? B : null,
      armH: y_Pq,
      Mr: Mr_Pq,
      Mt: Mt_Pq,
    });
  }

  if (H_w > 1e-4) {
    breakdownRows.push({
      id: 'Pw',
      category: 'water',
      name: '背面残留静水圧',
      formula: `0.5 × ${fmt(GAMMA_W, 2)} × ${fmt(H_w)}²`,
      V: 0,
      H: Pw_h,
      armV: null,
      armH: y_Pw,
      Mr: 0,
      Mt: Mt_Pw,
    });

    breakdownRows.push({
      id: 'U_uplift',
      category: 'water',
      name: '底面揚圧力（上向き）',
      formula: `-0.5 × (0.65×${fmt(GAMMA_W, 2)}×${fmt(H_w)}) × ${fmt(B)}`,
      V: -U_uplift,
      H: 0,
      armV: x_uplift,
      armH: null,
      Mr: 0,
      Mt: Mt_U,
    });
  }

  if (isSeismic) {
    breakdownRows.push({
      id: 'H_inertia_conc',
      category: 'seismic',
      name: '地震時水平慣性力（擁壁本体）',
      formula: `${fmt(kh, 2)} × ${fmt(W_conc, 1)}`,
      V: 0,
      H: H_in_conc,
      armV: null,
      armH: y_in_conc,
      Mr: 0,
      Mt: Mt_in_conc,
    });

    breakdownRows.push({
      id: 'H_inertia_soil',
      category: 'seismic',
      name: '地震時水平慣性力（背面盛土）',
      formula: `${fmt(kh, 2)} × ${fmt(W_soil, 1)}`,
      V: 0,
      H: H_in_soil,
      armV: null,
      armH: y_in_soil,
      Mr: 0,
      Mt: Mt_in_soil,
    });
  }

  // 主働すべり面（転倒・滑動・支持力破壊時の背面盛土・道路陥没クラック位置）
  const slipAngleDeg = computeActiveSlipAngleDeg(Math.PI * 0.5, phiRad, betaRad, deltaRad, thetaERad);
  const slipOriginX = B;
  const slipOriginY = 0;
  const { crackX, crackY } = computeSlipCrackExit(
    slipOriginX,
    slipOriginY,
    slipAngleDeg,
    H,
    x_back_bot,
    betaRad
  );
  const failureZone = {
    slipAngleDeg,
    originX: slipOriginX,
    originY: slipOriginY,
    crackX,
    crackY,
    wedgeWidthFromCrest: Math.max(0.2, crackX - x_back_top),
  };

  return {
    wallType: WALL_TYPES.L_WALL,
    params,
    isSeismic,
    geom,
    coeff,
    forces,
    moments,
    checks,
    overall,
    failureZone,
    diagrams,
    breakdownRows,
  };
}

/**
 * 大型積みブロック擁壁の外的安定（基礎底面3照査）＋ 全段目地安定（段間滑動・偏心）計算
 *
 * 力学モデル（前面・背面完全平行のもたれ式大型積みブロック標準断面）:
 *   - 基礎コンクリート (X ∈ [0, B], Y ∈ [0, t_base]) 上に、前面法勾配 1:m と同一勾配で
 *     背面も完全平行な規格ブロック（全段共通控長 Db = blockDepth）を N 段積載＋天端笠コン
 *   - 背面傾斜面（壁背面角 α = 90° + atan(m)）へ一般クーロン式（常時）／一般物部・岡部式（地震時）を適用
 *   - 基礎かかと張り出し部上の背面傾斜壁下に挟まる三角形盛土重量も厳密計上
 *   - 基礎底面の3照査に加え、全段目地 j = 0..N-1（接触幅 bj = Db）で段間滑動・前面開き偏心を照査
 */
function computeLargeBlockWallStability(params) {
  const {
    H,
    B,
    t_base,
    embedDepth,
    frontSlope,
    blockDepth,
    courseHeight,
    muJoint,
    hasInterlock,
    fillConcrete,
    betaDeg,
    qSurcharge,
    waterRatio,
    phiDeg,
    gammaSoil,
    muBase,
    qa,
    kh,
  } = params;

  const isSeismic = kh > 1e-9;
  const gammaBlock = fillConcrete ? GAMMA_BLOCK_CONC : GAMMA_BLOCK_GRAVEL;
  const interlockCap = hasInterlock ? INTERLOCK_SHEAR_CAPACITY : 0;

  // --- 1. 断面ジオメトリ ＆ 前面・背面完全平行の各段ブロック幾何 ---
  const extraBase = Math.max(0.30, B - blockDepth);
  const footingToe = clamp(extraBase * 0.35, 0.12, 0.24);
  const footingHeel = Math.max(0.12, B - blockDepth - footingToe);
  const H_stem = Math.max(0.5, H - t_base);
  const t_cap = clamp(0.12, 0.08, Math.max(0.08, H_stem * 0.12));
  const H_courses = Math.max(0.4, H_stem - t_cap);
  const nCourses = Math.max(2, Math.round(H_courses / courseHeight));
  const hCourse = H_courses / nCourses;

  const x_front_bot = footingToe;
  const x_back_bot = x_front_bot + blockDepth;
  const x_front_top = x_front_bot + frontSlope * H_stem;
  const x_back_top = x_front_top + blockDepth; // 前面・背面完全平行！

  // 背面傾斜面: 前面と完全に同じ勾配 frontSlope
  const slopeBack = frontSlope;
  const backEnvX = (y) => Math.max(0.35, x_back_bot + slopeBack * (y - t_base));
  const x_env_bot = backEnvX(0);
  const x_env_top = x_back_top;

  // 壁背面角 α = 90° + atan(m)（前面と平行）
  const alphaDegRaw = 90 + Math.atan(slopeBack) * RAD2DEG;
  const alphaRadRaw = alphaDegRaw * DEG2RAD;

  // 各段ブロック (下から i = 0 .. nCourses - 1) の厳密な平行四辺形幾何・重心・重量
  const courses = [];
  let W_blocks = 0;
  let Mr_blocks = 0;
  let Wy_blocks = 0;

  for (let i = 0; i < nCourses; i++) {
    const y0 = t_base + i * hCourse;
    const y1 = y0 + hCourse;
    const xf0 = x_front_bot + frontSlope * (y0 - t_base);
    const xf1 = x_front_bot + frontSlope * (y1 - t_base);
    const xb0 = xf0 + blockDepth;
    const xb1 = xf1 + blockDepth;
    const area = blockDepth * hCourse;
    const xG = 0.5 * (xf0 + xf1) + 0.5 * blockDepth;
    const yG = 0.5 * (y0 + y1);
    const weight = gammaBlock * area;

    W_blocks += weight;
    Mr_blocks += weight * xG;
    Wy_blocks += weight * yG;

    courses.push({
      index: i,
      y0,
      y1,
      xf0,
      xf1,
      xb0,
      xb1,
      xBack: 0.5 * (xb0 + xb1),
      wBot: blockDepth,
      wTop: blockDepth,
      area,
      weight,
      xG,
      yG,
    });
  }

  // 天端笠コンクリート (Y = H - t_cap .. H, 前面・背面平行)
  const capY0 = H - t_cap;
  const capY1 = H;
  const capXf0 = x_front_bot + frontSlope * (capY0 - t_base);
  const capXf1 = x_front_top;
  const capXb0 = capXf0 + blockDepth;
  const capXb1 = capXf1 + blockDepth;
  const capArea = blockDepth * t_cap;
  const capXG = 0.5 * (capXf0 + capXf1) + 0.5 * blockDepth;
  const capYG = capY0 + t_cap * 0.5;
  const W_cap = GAMMA_PLAIN_C * capArea;
  const Mr_cap = W_cap * capXG;
  const Wy_cap = W_cap * capYG;

  const cap = {
    y0: capY0,
    y1: capY1,
    xf0: capXf0,
    xf1: capXf1,
    xb0: capXb0,
    xb1: capXb1,
    xBack: capXb1,
    area: capArea,
    weight: W_cap,
    xG: capXG,
    yG: capYG,
  };

  // 基礎コンクリート (X = 0 .. B, Y = 0 .. t_base)
  const W_footing = GAMMA_PLAIN_C * B * t_base;
  const x_footing = B * 0.5;
  const y_footing = t_base * 0.5;
  const Mr_footing = W_footing * x_footing;
  const Wy_footing = W_footing * y_footing;

  // 基礎かかと張り出し部（x = x_back_bot .. B, y = t_base）上の背面平行壁下に挟まる三角形盛土
  const hTriHeel = Math.min(H_stem, footingHeel / Math.max(0.05, frontSlope));
  const areaSoilHeel = 0.5 * footingHeel * hTriHeel;
  const W_soil_heel = gammaSoil * areaSoilHeel;
  const x_soil_heel = x_back_bot + (2 / 3) * footingHeel;
  const y_soil_heel = t_base + hTriHeel / 3;
  const Mr_soil_heel = W_soil_heel * x_soil_heel;

  const W_conc = W_footing + W_blocks + W_cap;
  const xCG_wall = W_conc > 1e-9 ? (Mr_footing + Mr_blocks + Mr_cap) / W_conc : B * 0.5;
  const yCG_wall = W_conc > 1e-9 ? (Wy_footing + Wy_blocks + Wy_cap) / W_conc : H * 0.45;
  const x_blocks_cg = W_blocks > 1e-9 ? Mr_blocks / W_blocks : B * 0.5;

  const H_v = H;
  const H_w = waterRatio * H_stem; // 背面地下水位（底面 Y=0 からの標高）

  // --- 2. 土圧係数・地盤定数（一般クーロン式 / 一般物部・岡部式） ---
  const betaRad = betaDeg * DEG2RAD;
  const phiRad = phiDeg * DEG2RAD;
  // 壁背面直接作用時の壁面摩擦角（安全側標準: 常時 φ/2 最大20° / 地震時 φ/3 最大15°）
  const deltaDeg = isSeismic ? Math.min(15, phiDeg / 3) : Math.min(20, phiDeg * 0.5);
  const deltaRad = deltaDeg * DEG2RAD;
  const thetaERad = isSeismic ? Math.atan(kh) : 0;

  const gammaSat = gammaSoil + 1.5;
  const gammaSub = gammaSat - GAMMA_W;

  const { ka, kaH, kaV, alphaRadUsed, clampedSlopeLimit } =
    computeGeneralActiveEarthPressureCoeff(alphaRadRaw, phiRad, betaRad, deltaRad, thetaERad);
  const alphaDegUsed = alphaRadUsed * RAD2DEG;

  const phiBaseRad = clamp(Math.max(phiRad, Math.atan(muBase) * 1.15), 20 * DEG2RAD, 42 * DEG2RAD);
  const tanPass = Math.tan(Math.PI / 4 + phiBaseRad / 2);
  const kpBase = tanPass * tanPass;
  const kaBase = 1 / kpBase;

  const geom = {
    wallType: WALL_TYPES.LARGE_BLOCK,
    H,
    B,
    B_toe: footingToe,
    B_heel: footingHeel,
    t_top: blockDepth,
    t_stem: blockDepth,
    t_base,
    embedDepth,
    visibleHeight: Math.max(0.5, H - embedDepth),
    H_stem,
    H_v,
    H_w,
    x_front: x_front_bot,
    x_front_bot,
    x_front_top,
    x_back_top,
    x_back_bot,
    x_env_bot,
    x_env_top,
    slopeBack,
    alphaDeg: alphaDegUsed,
    alphaDegRaw,
    frontSlope,
    blockDepth,
    blockDepthTop: blockDepth,
    courseHeight,
    t_cap,
    footingToe,
    footingHeel,
    nCourses,
    hCourse,
    gammaBlock,
    fillConcrete,
    hasInterlock,
    courses,
    cap,
    xCG_wall,
    yCG_wall,
    hasKey: false,
    keyX: B * 0.5,
    keyDepth: 0,
    keyWidth: 0,
  };

  // --- 3. 任意標高 yBot .. H 区間の背面土圧・上載土圧・静水圧の厳密積分ヘルパー ---
  const kaRatioV = kaH > 1e-9 ? kaV / kaH : 0;
  const pAhAt = (y) => {
    const yc = clamp(y, 0, H_v);
    if (yc >= H_w) {
      return kaH * gammaSoil * (H_v - yc);
    }
    return kaH * (gammaSoil * (H_v - H_w) + gammaSub * (H_w - yc));
  };

  function integrateTrapezoid(ya, yb, pa, pb, yRef, xPivot) {
    const L = yb - ya;
    if (L <= 1e-9) {
      return { Fh: 0, Fv: 0, MtH: 0, MvNet: 0, yc: ya };
    }
    const Fh = 0.5 * (pa + pb) * L;
    const sumP = pa + pb;
    const yc = sumP > 1e-9 ? ya + (L / 3) * ((pa + 2 * pb) / sumP) : 0.5 * (ya + yb);
    const MtH = Fh * Math.max(0, yc - yRef);
    const Fv = Fh * kaRatioV;
    const xc = backEnvX(yc);
    const MvNet = Fv * (xc - xPivot);
    return { Fh, Fv, MtH, MvNet, yc };
  }

  function integrateBackPressures(yBot, xPivot) {
    const yStart = clamp(yBot, 0, H_v);
    let seg1 = { Fh: 0, Fv: 0, MtH: 0, MvNet: 0 };
    let seg2 = { Fh: 0, Fv: 0, MtH: 0, MvNet: 0 };
    if (H_w > yStart + 1e-9 && H_w < H_v - 1e-9) {
      seg1 = integrateTrapezoid(H_w, H_v, pAhAt(H_w), 0, yStart, xPivot);
      seg2 = integrateTrapezoid(yStart, H_w, pAhAt(yStart), pAhAt(H_w), yStart, xPivot);
    } else {
      seg1 = integrateTrapezoid(yStart, H_v, pAhAt(yStart), 0, yStart, xPivot);
    }
    const Pa_h = seg1.Fh + seg2.Fh;
    const Pa_soil_v = seg1.Fv + seg2.Fv;
    const Mt_Pa_h = seg1.MtH + seg2.MtH;
    const Mv_Pa_net = seg1.MvNet + seg2.MvNet;
    const y_Pa = Pa_h > 1e-9 ? yStart + Mt_Pa_h / Pa_h : yStart + (H_v - yStart) / 3;
    const x_Pa = Math.abs(Pa_soil_v) > 1e-9 ? xPivot + Mv_Pa_net / Pa_soil_v : backEnvX(y_Pa);

    const p_qh = kaH * qSurcharge;
    const L_q = Math.max(0, H_v - yStart);
    const Pq_h = p_qh * L_q;
    const y_Pq = yStart + L_q * 0.5;
    const Mt_Pq_h = Pq_h * (y_Pq - yStart);
    const Pq_v = kaV * qSurcharge * L_q;
    const x_Pq = backEnvX(y_Pq);
    const Mv_Pq_net = Pq_v * (x_Pq - xPivot);

    const hwEff = Math.max(0, H_w - yStart);
    const Pw_h = 0.5 * GAMMA_W * hwEff * hwEff;
    const y_Pw = yStart + hwEff / 3;
    const Mt_Pw = Pw_h * (hwEff / 3);

    return {
      Pa_h,
      Pa_soil_v,
      Mt_Pa_h,
      Mv_Pa_net,
      y_Pa,
      x_Pa,
      p_qh,
      Pq_h,
      Pq_v,
      Mt_Pq_h,
      Mv_Pq_net,
      y_Pq,
      x_Pq,
      Pw_h,
      y_Pw,
      Mt_Pw,
      hwEff,
    };
  }

  // --- 4. 基礎底面 (Y=0, X_pivot=0) の全荷重・モーメント ---
  const baseP = integrateBackPressures(0, 0);
  const Pa_h = baseP.Pa_h;
  const Pa_soil_v = baseP.Pa_soil_v;
  const Pq_h = baseP.Pq_h;
  const Pq_v = baseP.Pq_v;
  const Pa_v = Pa_soil_v + Pq_v;
  const Pw_h = baseP.Pw_h;

  // 底面揚圧力 U
  const pu_heel = UPLIFT_HEEL_FACTOR * GAMMA_W * H_w;
  const U_uplift = 0.5 * pu_heel * B;
  const x_uplift = (2 / 3) * B;
  const Mt_U = U_uplift * x_uplift;

  // 地震時水平慣性力（擁壁本体: 基礎＋ブロック＋笠コン）
  const H_inertia = isSeismic ? kh * W_conc : 0;
  const Mt_inertia = isSeismic ? kh * (Wy_footing + Wy_blocks + Wy_cap) : 0;

  // 鉛直土圧成分のモーメントを Mr (>=0) / Mt (>=0) へ符号振り分け（厳密保存則保証）
  const Mr_Pa_soil = Math.max(0, baseP.Mv_Pa_net);
  const Mt_Pa_v = Math.max(0, -baseP.Mv_Pa_net);
  const Mr_Pq = Math.max(0, baseP.Mv_Pq_net);
  const Mt_Pq_v = Math.max(0, -baseP.Mv_Pq_net);

  const sumV = W_conc + W_soil_heel + Pa_v - U_uplift;
  const sumH = Pa_h + Pq_h + Pw_h + H_inertia;

  const Mr = Mr_footing + Mr_blocks + Mr_cap + Mr_soil_heel + Mr_Pa_soil + Mr_Pq;
  const Mt = baseP.Mt_Pa_h + Mt_Pa_v + baseP.Mt_Pq_h + Mt_Pq_v + baseP.Mt_Pw + Mt_U + Mt_inertia;
  const M_net = Mr - Mt;

  const R_friction = Math.max(0, sumV) * muBase;
  const R_key = 0;
  const sumR = R_friction;
  const y_sumH =
    sumH > 1e-9 ? (baseP.Mt_Pa_h + baseP.Mt_Pq_h + baseP.Mt_Pw + Mt_inertia) / sumH : H / 3;

  const gammaBase = gammaSoil + 1.0;
  const keyDetail = {
    eta: KEY_PASSIVE_ETA,
    kpBase,
    kaBase,
    gammaBase,
    keyDepth: 0,
    qOverburden: 0,
    R_key: 0,
  };

  const coeff = {
    ka,
    kaH,
    kaV,
    alphaDeg: alphaDegUsed,
    deltaDeg,
    thetaEDeg: thetaERad * RAD2DEG,
    kpBase,
    kaBase,
    phiBaseDeg: phiBaseRad * RAD2DEG,
    gammaSat,
    gammaSub,
    gammaBlock,
    muJoint,
    interlockCapacity: interlockCap,
    clampedSlopeLimit,
    keyDetail: { ...keyDetail },
  };

  const forces = {
    W_conc,
    W_footing,
    W_blocks,
    W_cap,
    W_soil: W_soil_heel,
    W_q: 0,
    Pa_v,
    U_uplift,
    sumV,
    Pa_h,
    Pq_h,
    Pw_h,
    H_inertia,
    sumH,
    R_friction,
    R_key,
    sumR,
    y_sumH,
    keyDetail: { ...keyDetail },
  };

  const moments = { Mr, Mt, M_net };

  // --- 5. 基礎底面 3大外的安定照査 ---
  const fssLimit = isSeismic ? 1.20 : 1.50;
  const fss = sumH > 1e-9 ? sumR / sumH : 99.9;
  const slidingOk = fss >= fssLimit && sumV > 0;
  const sliding = {
    fs: fss,
    limit: fssLimit,
    ok: slidingOk,
    ratio: fss / fssLimit,
  };

  const fsoLimit = isSeismic ? 1.20 : 1.50;
  const fso = Mt > 1e-9 ? Mr / Mt : 99.9;
  const d = sumV > 1e-9 ? M_net / sumV : -B;
  const e = B / 2 - d;
  const eLimit = isSeismic ? B / 3 : B / 6;
  const eRatio = Math.abs(e) / eLimit;
  const overturningOk = Math.abs(e) <= eLimit && fso >= fsoLimit && sumV > 0 && d > 0;

  let upliftGapWidth = 0;
  if (sumV <= 1e-9 || d <= 0) {
    upliftGapWidth = B;
  } else if (e > B / 6) {
    upliftGapWidth = Math.max(0, B - 3 * d);
  } else if (e < -B / 6) {
    upliftGapWidth = Math.max(0, B - 3 * (B - d));
  }

  const overturning = {
    fs: fso,
    fsLimit: fsoLimit,
    d,
    e,
    eLimit,
    eRatio,
    ok: overturningOk,
    upliftGapWidth,
  };

  const qaAllow = isSeismic ? 1.5 * qa : qa;
  let q1 = 0;
  let q2 = 0;
  let isTriangular = false;
  let contactLen = B;

  if (sumV <= 1e-9 || d <= 0) {
    q1 = MAX_DISPLAY_Q;
    q2 = 0;
    isTriangular = true;
    contactLen = 0;
  } else if (Math.abs(e) <= B / 6) {
    q1 = (sumV / B) * (1 + (6 * e) / B);
    q2 = (sumV / B) * (1 - (6 * e) / B);
    isTriangular = false;
    contactLen = B;
  } else if (e > B / 6) {
    q1 = Math.min(MAX_DISPLAY_Q, (2 * sumV) / (3 * d));
    q2 = 0;
    isTriangular = true;
    contactLen = Math.min(B, 3 * d);
  } else {
    const dHeel = B - d;
    if (dHeel <= 0) {
      q1 = 0;
      q2 = MAX_DISPLAY_Q;
      isTriangular = true;
      contactLen = 0;
    } else {
      q1 = 0;
      q2 = Math.min(MAX_DISPLAY_Q, (2 * sumV) / (3 * dHeel));
      isTriangular = true;
      contactLen = Math.min(B, 3 * dHeel);
    }
  }

  const qMax = Math.max(q1, q2);
  const fsb = qMax > 1e-9 ? qaAllow / qMax : 99.9;
  const bearingOk = qMax <= qaAllow && sumV > 0 && d > 0;

  const bearing = {
    q1,
    q2,
    qMax,
    qaAllow,
    fs: fsb,
    ok: bearingOk,
    isTriangular,
    contactLen,
  };

  // --- 6. 全段ブロック目地安定照査（平行積み: 全段目地接触幅 bj = blockDepth） ---
  const jointCourses = [];
  for (let j = 0; j < nCourses; j++) {
    const c = courses[j];
    const yj = c.y0;
    const xfj = c.xf0;
    const xbj = c.xb0;
    const bj = blockDepth;

    let wAbove = W_cap;
    let mrAbove = W_cap * (capXG - xfj);
    let mtInAbove = isSeismic ? kh * W_cap * Math.max(0, capYG - yj) : 0;
    for (let i = j; i < nCourses; i++) {
      const ci = courses[i];
      wAbove += ci.weight;
      mrAbove += ci.weight * (ci.xG - xfj);
      if (isSeismic) {
        mtInAbove += kh * ci.weight * Math.max(0, ci.yG - yj);
      }
    }
    const hInAbove = isSeismic ? kh * wAbove : 0;

    const jp = integrateBackPressures(yj, xfj);

    // 目地内間隙水圧（揚圧力）
    const puj = JOINT_UPLIFT_FACTOR * GAMMA_W * jp.hwEff;
    const uJoint = 0.5 * puj * bj;
    const mtUJoint = uJoint * ((2 / 3) * bj);

    const sumVj = wAbove + jp.Pa_soil_v + jp.Pq_v - uJoint;
    const sumHj = jp.Pa_h + jp.Pq_h + jp.Pw_h + hInAbove;
    const sumRj = Math.max(0, sumVj) * muJoint + interlockCap;

    const mrJ =
      Math.max(0, mrAbove) + Math.max(0, jp.Mv_Pa_net) + Math.max(0, jp.Mv_Pq_net);
    const mtJ =
      Math.max(0, -mrAbove) +
      jp.Mt_Pa_h +
      Math.max(0, -jp.Mv_Pa_net) +
      jp.Mt_Pq_h +
      Math.max(0, -jp.Mv_Pq_net) +
      jp.Mt_Pw +
      mtUJoint +
      mtInAbove;

    const fsSlideJ = sumHj > 1e-9 ? sumRj / sumHj : 99.9;
    const slideOkJ = fsSlideJ >= fssLimit && sumVj > 0;

    const fsoJ = mtJ > 1e-9 ? mrJ / mtJ : 99.9;
    const dj = sumVj > 1e-9 ? (mrJ - mtJ) / sumVj : -bj;
    const ej = bj * 0.5 - dj;
    const eLimitJ = isSeismic ? bj / 3 : bj / 6;
    // もたれ平行積みでは背面側偏心 (ej < 0) は背面盛土に支えられるため、
    // 前面側転倒開き (ej <= eLimitJ) を厳格判定し、背面側は極端なはみ出し (-0.48*bj) まで許容
    const eBackLimitJ = 0.48 * bj;
    const eRatioJ = ej >= 0 ? ej / eLimitJ : Math.abs(ej) / eBackLimitJ;
    const overturnOkJ =
      ej <= eLimitJ && ej >= -eBackLimitJ && fsoJ >= fsoLimit && sumVj > 0 && dj > 0;

    const defSlideJ = slideOkJ ? 0 : Math.max(0.01, fssLimit / Math.max(fsSlideJ, 0.01) - 1.0);
    const defOverJ = overturnOkJ
      ? 0
      : dj <= 0 || sumVj <= 1e-9
        ? 5.0
        : Math.max(0.01, eRatioJ - 1.0, fsoLimit / Math.max(fsoJ, 0.01) - 1.0);
    const deficitJ = Math.max(defSlideJ, defOverJ);

    jointCourses.push({
      courseIndex: j,
      courseNum: j + 1,
      y: yj,
      xf: xfj,
      xb: xbj,
      width: bj,
      sumV: sumVj,
      sumH: sumHj,
      sumR: sumRj,
      fsSlide: fsSlideJ,
      slideOk: slideOkJ,
      d: dj,
      e: ej,
      eLimit: eLimitJ,
      eRatio: eRatioJ,
      fso: fsoJ,
      overturnOk: overturnOkJ,
      ok: slideOkJ && overturnOkJ,
      deficit: deficitJ,
    });
  }

  let criticalJoint = jointCourses[0];
  let minSlideJoint = jointCourses[0];
  for (const jc of jointCourses) {
    if (jc.fsSlide < minSlideJoint.fsSlide) minSlideJoint = jc;
    if (jc.deficit > criticalJoint.deficit + 1e-9) {
      criticalJoint = jc;
    } else if (
      Math.abs(jc.deficit - criticalJoint.deficit) <= 1e-9 &&
      jc.fsSlide < criticalJoint.fsSlide
    ) {
      criticalJoint = jc;
    }
  }
  const jointOk = jointCourses.every((jc) => jc.ok);

  const joint = {
    enabled: true,
    ok: jointOk,
    fs: minSlideJoint.fsSlide,
    limit: fssLimit,
    ratio: minSlideJoint.fsSlide / fssLimit,
    criticalCourseIndex: criticalJoint.courseIndex,
    criticalCourseNum: criticalJoint.courseNum,
    criticalY: criticalJoint.y,
    criticalWidth: criticalJoint.width,
    criticalSumV: criticalJoint.sumV,
    criticalSumH: criticalJoint.sumH,
    criticalSumR: criticalJoint.sumR,
    criticalE: criticalJoint.e,
    criticalELimit: criticalJoint.eLimit,
    criticalERatio: criticalJoint.eRatio,
    criticalFso: criticalJoint.fso,
    criticalSlideOk: criticalJoint.slideOk,
    criticalOverturnOk: criticalJoint.overturnOk,
    interlockBonus: interlockCap,
    courses: jointCourses,
  };

  const embedment = buildEmbedmentCheck(embedDepth, t_base);
  const checks = { sliding, overturning, bearing, joint, embedment };

  // --- 7. 総合判定・主破壊モード・深刻度 ---
  const overallOk = slidingOk && overturningOk && bearingOk && jointOk;
  const isCompleteOverturn = d <= 0 || sumV <= 1e-9;

  const defOver = overturningOk
    ? 0
    : isCompleteOverturn
      ? 10.0
      : Math.max(0.01, eRatio - 1.0, fsoLimit / Math.max(fso, 0.01) - 1.0);
  const defSlide = slidingOk ? 0 : Math.max(0.01, fssLimit / Math.max(fss, 0.01) - 1.0);
  const defBear = bearingOk
    ? 0
    : isCompleteOverturn
      ? 2.0
      : Math.min(5.0, Math.max(0.01, qMax / Math.max(qaAllow, 1.0) - 1.0));
  const defJoint = jointOk ? 0 : Math.min(5.0, Math.max(0.01, criticalJoint.deficit));
  // 目地滑動はOKで基礎転倒もNGのときは全体転倒 (overturning) を主破壊モードとする
  const jointSlideOnlyDef = !criticalJoint.slideOk ? defJoint : overturningOk ? defJoint : 0;

  let primaryFailure = 'none';
  let maxDeficit = 0;
  if (!overallOk) {
    const candidates = [
      { mode: 'overturning', def: defOver },
      { mode: 'joint_sliding', def: jointSlideOnlyDef },
      { mode: 'sliding', def: defSlide },
      { mode: 'bearing', def: defBear },
    ].sort((a, b) => b.def - a.def);
    primaryFailure = candidates[0].mode;
    maxDeficit = candidates[0].def;
  }

  const severity = overallOk ? 0 : clamp(0.15 + maxDeficit * 0.9, 0.15, 1.0);

  let summaryJa;
  if (overallOk) {
    summaryJa = isSeismic
      ? `地震時（kh=${fmt(kh, 2)}）の基礎底面・全${nCourses}段目地とも基準内です`
      : `基礎底面（滑動・転倒・支持力）および全${nCourses}段目地すべて基準内です`;
  } else {
    const ngList = [];
    if (!overturningOk) ngList.push('転倒');
    if (!slidingOk) ngList.push('底面滑動');
    if (!jointOk) ngList.push('目地');
    if (!bearingOk) ngList.push('支持力');
    const ngTag = ngList.join('・');

    if (primaryFailure === 'joint_sliding') {
      if (!criticalJoint.slideOk && !hasInterlock && ngList.length === 1) {
        summaryJa = `${criticalJoint.courseNum}段目目地の滑動安全率 Fsj=${fmt(criticalJoint.fsSlide, 2)}（基準 ${fmt(fssLimit, 2)} 未満）— 『連結ピン・噛み合わせ』ONで改善可能`;
      } else if (!criticalJoint.slideOk) {
        summaryJa = `${criticalJoint.courseNum}段目目地で段間滑動 Fsj=${fmt(criticalJoint.fsSlide, 2)}（${ngTag}NG）`;
      } else {
        summaryJa = `${criticalJoint.courseNum}段目目地で偏心超過 e=${fmt(criticalJoint.e, 2)}m（${ngTag}NG）`;
      }
    } else if (primaryFailure === 'overturning') {
      if (isCompleteOverturn) {
        summaryJa = '転倒モーメント超過で完全転倒の危険（控長・基礎幅・法勾配の拡大が必要）';
      } else {
        summaryJa = `基礎底面の偏心 e=${fmt(e, 2)}m が許容値 ${fmt(eLimit, 2)}m 超過（${ngTag}NG）`;
      }
    } else if (primaryFailure === 'sliding') {
      summaryJa =
        H_w > 0.5
          ? `背面水圧・揚圧力で底面滑動 Fss=${fmt(fss, 2)}（基準 ${fmt(fssLimit, 2)} 未満・${ngTag}NG）`
          : `底面滑動安全率 Fss=${fmt(fss, 2)}（基準 ${fmt(fssLimit, 2)} 未満・${ngTag}NG）`;
    } else {
      summaryJa =
        ngList.length > 1
          ? `最大接地圧 qmax=${fmt(qMax, 1)}（許容 ${fmt(qaAllow, 0)} kN/m² 超過・${ngTag}NG）`
          : `最大接地圧 qmax=${fmt(qMax, 1)}（許容 ${fmt(qaAllow, 0)} kN/m² 超過）— 基礎幅拡大や中詰め砕石で改善`;
    }
  }

  const overall = {
    ok: overallOk,
    primaryFailure,
    severity,
    summaryJa,
  };

  // --- 8. 主働すべり面・背面道路崩壊ジオメトリ ---
  const slipAngleDeg = computeActiveSlipAngleDeg(alphaRadUsed, phiRad, betaRad, deltaRad, thetaERad);
  const isJointMode = primaryFailure === 'joint_sliding' && criticalJoint;
  const slipOriginX = isJointMode ? criticalJoint.xb : Math.max(B, x_back_bot);
  const slipOriginY = isJointMode ? criticalJoint.y : 0;
  const { crackX, crackY } = computeSlipCrackExit(
    slipOriginX,
    slipOriginY,
    slipAngleDeg,
    H,
    x_back_top,
    betaRad
  );
  // クラック出口が常にブロック天端背面 x_back_top より十分に後ろへ出るよう保証
  const safeCrackX = Math.max(x_back_top + 0.65, crackX);
  const safeCrackY = H + Math.max(0, safeCrackX - x_back_top) * Math.tan(betaRad);
  const failureZone = {
    slipAngleDeg,
    originX: slipOriginX,
    originY: slipOriginY,
    crackX: safeCrackX,
    crackY: safeCrackY,
    wedgeWidthFromCrest: Math.max(0.65, safeCrackX - x_back_top),
  };

  // --- 9. 2D/3D 描画用 分布図座標配列 ---
  const p_ah_water = pAhAt(H_w);
  const p_ah_bottom = pAhAt(0);
  const earthPressurePts =
    H_w > 1e-4
      ? [
          { y: H_v, p: 0 },
          { y: H_w, p: p_ah_water },
          { y: 0, p: p_ah_bottom },
        ]
      : [
          { y: H_v, p: 0 },
          { y: 0, p: p_ah_bottom },
        ];

  const waterPressurePts =
    H_w > 1e-4
      ? [
          { y: H_w, p: 0 },
          { y: 0, p: GAMMA_W * H_w },
        ]
      : [];

  const surchargePts =
    qSurcharge > 1e-4
      ? [
          { y: H_v, p: baseP.p_qh },
          { y: 0, p: baseP.p_qh },
        ]
      : [];

  let bearingPts;
  if (sumV <= 1e-9 || d <= 0) {
    bearingPts = [
      { x: 0, q: q1 },
      { x: Math.min(0.1, B), q: 0 },
      { x: B, q: 0 },
    ];
  } else if (!isTriangular) {
    bearingPts = [
      { x: 0, q: q1 },
      { x: B, q: q2 },
    ];
  } else if (e > B / 6) {
    bearingPts = [
      { x: 0, q: q1 },
      { x: contactLen, q: 0 },
      { x: B, q: 0 },
    ];
  } else {
    bearingPts = [
      { x: 0, q: 0 },
      { x: Math.max(0, B - contactLen), q: 0 },
      { x: B, q: q2 },
    ];
  }

  const upliftPts =
    H_w > 1e-4
      ? [
          { x: 0, p: 0 },
          { x: B, p: pu_heel },
        ]
      : [];

  const diagrams = {
    earthPressurePts,
    waterPressurePts,
    surchargePts,
    bearingPts,
    upliftPts,
  };

  // --- 10. 検算シート用ブレークダウン行配列（厳密保存則一致） ---
  const breakdownRows = [];

  breakdownRows.push({
    id: 'W_footing',
    category: 'weight',
    name: '基礎コンクリート自重',
    formula: `${fmt(GAMMA_PLAIN_C, 1)} × ${fmt(B)} × ${fmt(t_base)}`,
    V: W_footing,
    H: 0,
    armV: x_footing,
    armH: null,
    Mr: Mr_footing,
    Mt: 0,
  });

  breakdownRows.push({
    id: 'W_blocks',
    category: 'weight',
    name: `平行大型ブロック部（${nCourses}段・控長${fmt(blockDepth)}m・${fillConcrete ? '胴込めコン' : '中詰め砕石'}）`,
    formula: `γb=${fmt(gammaBlock, 1)} × Db=${fmt(blockDepth)} × Hblk=${fmt(H_courses)}`,
    V: W_blocks,
    H: 0,
    armV: x_blocks_cg,
    armH: null,
    Mr: Mr_blocks,
    Mt: 0,
  });

  breakdownRows.push({
    id: 'W_cap',
    category: 'weight',
    name: '天端笠コンクリート自重',
    formula: `${fmt(GAMMA_PLAIN_C, 1)} × ${fmt(blockDepth)} × ${fmt(t_cap)}`,
    V: W_cap,
    H: 0,
    armV: capXG,
    armH: null,
    Mr: Mr_cap,
    Mt: 0,
  });

  if (W_soil_heel > 1e-6) {
    breakdownRows.push({
      id: 'W_soil_heel',
      category: 'soil',
      name: '基礎かかと上 三角盛土',
      formula: `0.5 × ${fmt(gammaSoil, 1)} × ${fmt(footingHeel)} × ${fmt(hTriHeel)}`,
      V: W_soil_heel,
      H: 0,
      armV: x_soil_heel,
      armH: null,
      Mr: Mr_soil_heel,
      Mt: 0,
    });
  }

  breakdownRows.push({
    id: 'Pa_soil',
    category: 'earth',
    name: isSeismic
      ? `地震時主働土圧（平行背面 α=${fmt(alphaDegUsed, 1)}°, KAE=${fmt(ka, 3)}）`
      : `常時主働土圧（平行背面 α=${fmt(alphaDegUsed, 1)}°, KA=${fmt(ka, 3)}）`,
    formula:
      H_w > 1e-4
        ? `傾斜背面有効土圧（δ=${fmt(deltaDeg, 1)}°, Hw=${fmt(H_w)}m）`
        : `0.5 × ${fmt(kaH, 3)} × ${fmt(gammaSoil, 1)} × ${fmt(H_v)}²（δ=${fmt(deltaDeg, 1)}°）`,
    V: Pa_soil_v,
    H: Pa_h,
    armV: Math.abs(Pa_soil_v) > 1e-9 ? baseP.x_Pa : null,
    armH: baseP.y_Pa,
    Mr: Mr_Pa_soil,
    Mt: baseP.Mt_Pa_h + Mt_Pa_v,
  });

  if (Pq_h > 1e-6 || Math.abs(Pq_v) > 1e-6) {
    breakdownRows.push({
      id: 'Pq',
      category: 'earth',
      name: '上載荷重による主働土圧',
      formula: `${fmt(kaH, 3)} × ${fmt(qSurcharge, 1)} × ${fmt(H_v)}`,
      V: Pq_v,
      H: Pq_h,
      armV: Math.abs(Pq_v) > 1e-9 ? baseP.x_Pq : null,
      armH: baseP.y_Pq,
      Mr: Mr_Pq,
      Mt: baseP.Mt_Pq_h + Mt_Pq_v,
    });
  }

  if (H_w > 1e-4) {
    breakdownRows.push({
      id: 'Pw',
      category: 'water',
      name: '背面残留静水圧',
      formula: `0.5 × ${fmt(GAMMA_W, 2)} × ${fmt(H_w)}²`,
      V: 0,
      H: Pw_h,
      armV: null,
      armH: baseP.y_Pw,
      Mr: 0,
      Mt: baseP.Mt_Pw,
    });

    breakdownRows.push({
      id: 'U_uplift',
      category: 'water',
      name: '基礎底面揚圧力（上向き）',
      formula: `-0.5 × (0.65×${fmt(GAMMA_W, 2)}×${fmt(H_w)}) × ${fmt(B)}`,
      V: -U_uplift,
      H: 0,
      armV: x_uplift,
      armH: null,
      Mr: 0,
      Mt: Mt_U,
    });
  }

  if (isSeismic) {
    breakdownRows.push({
      id: 'H_inertia_conc',
      category: 'seismic',
      name: '地震時水平慣性力（擁壁本体）',
      formula: `${fmt(kh, 2)} × ${fmt(W_conc, 1)}（重心高 ${fmt(yCG_wall, 2)}m）`,
      V: 0,
      H: H_inertia,
      armV: null,
      armH: yCG_wall,
      Mr: 0,
      Mt: Mt_inertia,
    });
  }

  return {
    wallType: WALL_TYPES.LARGE_BLOCK,
    params,
    isSeismic,
    geom,
    coeff,
    forces,
    moments,
    checks,
    overall,
    failureZone,
    diagrams,
    breakdownRows,
  };
}
