/**
 * RETAINING WALL LAB — L型擁壁 外的安定計算エンジン
 *
 * 道路土工「擁壁工指針」および地盤構造力学の考え方を参考にした
 * ブラウザ内リアルタイム安定計算モジュール（外部依存ゼロ・0ms計算）。
 *
 * 共通座標系（単位奥行き 1.0 m あたり）:
 *   X = 0.0 : 底版つま先先端（転倒モーメント基準点 O）
 *   +X 方向 : 背面（盛土側）、かかと版先端（仮想背面）は X = B
 *   Y = 0.0 : 底版底面（均しコンクリート上面）
 *   +Y 方向 : 上向き、擁壁天端高は Y = H
 *
 * 注意: メカニズム理解・学習用の簡易計算エンジンです。
 * 実務設計では現地地盤調査および各種基準・構造細目に基づく詳細照査を行ってください。
 */

export const GAMMA_C = 24.5; // 鉄筋コンクリート単位体積重量 [kN/m³]
export const GAMMA_W = 9.81; // 水の単位体積重量 [kN/m³]

export const PARAM_RANGES = {
  H: { min: 2.0, max: 7.0 },
  B: { min: 1.4, max: 5.5 },
  B_toe: { min: 0.0, max: 1.6 },
  t_top: { min: 0.25, max: 0.60 },
  t_stem: { min: 0.30, max: 0.85 },
  t_base: { min: 0.30, max: 0.85 },
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
  H: 4.0,
  B: 2.8,
  B_toe: 0.45,
  t_top: 0.30,
  t_stem: 0.42,
  t_base: 0.45,
  hasKey: false,
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

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const MIN_HEEL_LENGTH = 0.30;
const KEY_DEPTH = 0.55;
const KEY_WIDTH = 0.45;
const UPLIFT_HEEL_FACTOR = 0.65;
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
 * 入力パラメータを仕様範囲・幾何制約（t_stem >= t_top, B_heel >= 0.30m）に整合させる。
 */
export function sanitizeParams(input = {}) {
  const src = { ...DEFAULT_PARAMS, ...(input || {}) };

  const H = readNum(src.H, DEFAULT_PARAMS.H, PARAM_RANGES.H);
  const t_base = clamp(
    readNum(src.t_base, DEFAULT_PARAMS.t_base, PARAM_RANGES.t_base),
    PARAM_RANGES.t_base.min,
    Math.min(PARAM_RANGES.t_base.max, H - 0.5)
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

  return {
    H,
    B,
    B_toe,
    t_top,
    t_stem,
    t_base,
    hasKey: Boolean(src.hasKey),
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

function fmt(n, digits = 2) {
  return Number.isFinite(n) ? n.toFixed(digits) : '—';
}

/**
 * L型擁壁の外的安定計算を実行する。
 * @param {Partial<typeof DEFAULT_PARAMS>} rawParams
 */
export function computeWallStability(rawParams = {}) {
  const params = sanitizeParams(rawParams);
  const {
    H,
    B,
    B_toe,
    t_top,
    t_stem,
    t_base,
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
    H,
    B,
    B_toe,
    B_heel,
    t_top,
    t_stem,
    t_base,
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

  const checks = { sliding, overturning, bearing };

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

  return {
    params,
    isSeismic,
    geom,
    coeff,
    forces,
    moments,
    checks,
    overall,
    diagrams,
    breakdownRows,
  };
}
