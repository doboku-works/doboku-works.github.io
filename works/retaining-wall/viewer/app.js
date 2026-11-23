import * as THREE from 'three';
import { DEFAULT_PARAMS, PRESETS, computeWallStability } from './engine.js';
import { RetainingWallScene3D } from './scene3d.js';

// ============================================================================
// 状態管理・定数
// ============================================================================
const MOBILE_BREAKPOINT = 768;

const PARAM_LIMITS = {
  H: [2.0, 7.0],
  B: [1.4, 5.5],
  B_toe: [0.0, 1.6],
  t_top: [0.25, 0.60],
  t_stem: [0.30, 0.85],
  t_base: [0.30, 0.85],
  betaDeg: [0, 25],
  qSurcharge: [0, 30],
  waterRatio: [0, 0.90],
  phiDeg: [20, 40],
  gammaSoil: [16.0, 21.0],
  muBase: [0.35, 0.70],
  qa: [80, 450],
  kh: [0, 0.25],
};

const state = {
  ready: false,
  params: sanitizeParams({ ...DEFAULT_PARAMS }),
  options: {
    showForces: true,
    showRebar: false,
    showFailureAnim: true,
    showLabels: true,
    theme: 'light',
  },
  activePresetId: 'standard',
  activeControlTab: 'geom',
  activeMonitorTab: 'overview',
  activeCameraPreset: 'iso_cutaway',
  panels: {
    left: window.innerWidth > MOBILE_BREAKPOINT,
    right: window.innerWidth > MOBILE_BREAKPOINT,
  },
  result: null,
};

let scene3d = null;
let rafId = 0;
let lastFrameTime = performance.now();
const pinDomMap = new Map();
const projVec = new THREE.Vector3();

// DOM 参照キャッシュ
const dom = {};

// ============================================================================
// ユーティリティ
// ============================================================================
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  if (!Number.isFinite(n)) return '∞';
  return Number(n).toFixed(digits);
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isMobileView() {
  return window.innerWidth <= MOBILE_BREAKPOINT;
}

function sanitizeParams(raw, changedKey = null) {
  const p = { ...DEFAULT_PARAMS, ...raw };

  for (const [key, [min, max]] of Object.entries(PARAM_LIMITS)) {
    if (typeof p[key] === 'number' && Number.isFinite(p[key])) {
      p[key] = clamp(p[key], min, max);
    } else if (typeof DEFAULT_PARAMS[key] === 'number') {
      p[key] = DEFAULT_PARAMS[key];
    }
  }
  p.hasKey = Boolean(p.hasKey);

  // たて壁天端厚 <= たて壁基部厚 を保証
  const defaultTop = typeof DEFAULT_PARAMS.t_top === 'number' ? DEFAULT_PARAMS.t_top : 0.30;
  p.t_top = clamp(Math.min(p.t_top ?? defaultTop, p.t_stem), 0.25, p.t_stem);

  // かかと版長 B_heel = B - B_toe - t_stem >= 0.30 m を常に保証
  const minHeel = 0.30;
  if (p.B - p.B_toe - p.t_stem < minHeel) {
    if (changedKey === 'B') {
      p.B_toe = clamp(p.B - p.t_stem - minHeel, 0.0, PARAM_LIMITS.B_toe[1]);
      if (p.B - p.B_toe - p.t_stem < minHeel) {
        p.B = clamp(p.B_toe + p.t_stem + minHeel, PARAM_LIMITS.B[0], PARAM_LIMITS.B[1]);
      }
    } else if (changedKey === 'B_toe') {
      p.B_toe = clamp(p.B - p.t_stem - minHeel, 0.0, PARAM_LIMITS.B_toe[1]);
    } else {
      const maxToe = Math.max(0, p.B - p.t_stem - minHeel);
      if (p.B_toe > maxToe) {
        p.B_toe = maxToe;
      }
      if (p.B - p.B_toe - p.t_stem < minHeel) {
        p.B = clamp(p.B_toe + p.t_stem + minHeel, PARAM_LIMITS.B[0], PARAM_LIMITS.B[1]);
      }
    }
  }

  return p;
}

function extractPresetParams(preset) {
  if (!preset) return { ...DEFAULT_PARAMS };
  if (preset.params && typeof preset.params === 'object') {
    return { ...DEFAULT_PARAMS, ...preset.params };
  }
  const merged = { ...DEFAULT_PARAMS };
  for (const key of Object.keys(DEFAULT_PARAMS)) {
    if (key in preset) {
      merged[key] = preset[key];
    }
  }
  return merged;
}

function getPresetBadgeTone(preset) {
  const id = String(preset?.id ?? '');
  if (id === 'standard') return 'tone-ok';
  if (id === 'waterlog') return 'tone-water';
  if (id === 'seismic') return 'tone-seismic';
  return 'tone-danger';
}

function normalizeFailureHeadline(result) {
  const overall = result?.overall ?? {};
  if (overall.ok) return '全項目 OK（安定）';

  // engine.js の summaryJa と同一順序（滑動 → 転倒 → 支持力）に統一
  const ngTags = [];
  if (result?.checks?.sliding && !result.checks.sliding.ok) ngTags.push('滑動危険');
  if (result?.checks?.overturning && !result.checks.overturning.ok) ngTags.push('転倒危険');
  if (result?.checks?.bearing && !result.checks.bearing.ok) ngTags.push('支持力不足');

  if (ngTags.length > 0) {
    return `NG：${ngTags.join('・')}`;
  }

  const pf = overall.primaryFailure;
  if (pf === 'sliding') return 'NG：滑動危険';
  if (pf === 'overturning') return 'NG：転倒危険';
  if (pf === 'bearing') return 'NG：支持力不足';
  return 'NG：安定基準未達';
}

function formatOverallSummary(result) {
  const overall = result?.overall ?? {};
  if (overall.ok) {
    return result.isSeismic
      ? `地震時（kh=${fmt(result.params?.kh ?? 0, 2)}）の滑動・転倒・支持力すべて基準内`
      : '滑動・転倒・支持力のすべてが安全基準を満たしています';
  }
  const raw = String(overall.summaryJa || '').trim();
  // 見出しと重複する「安定照査 NG（...）：」接頭辞を取り除き、理由を簡潔明瞭に表示
  const stripped = raw.replace(/^安定照査\s*NG（[^）]*）：/, '').trim();
  return stripped || '赤字の照査項目が基準未達です。底版幅や排水条件を調整してください';
}

function normalizeMobileFailureShort(result) {
  if (result?.overall?.ok) return 'OK 安定';
  const pf = result?.overall?.primaryFailure;
  if (pf === 'overturning') return 'NG 転倒';
  if (pf === 'sliding') return 'NG 滑動';
  if (pf === 'bearing') return 'NG 支持力';
  if (result?.checks?.overturning && !result.checks.overturning.ok) return 'NG 転倒';
  if (result?.checks?.sliding && !result.checks.sliding.ok) return 'NG 滑動';
  if (result?.checks?.bearing && !result.checks.bearing.ok) return 'NG 支持力';
  return 'NG 危険';
}

// ============================================================================
// DOM キャッシュ & プリセット生成
// ============================================================================
function cacheDom() {
  const ids = [
    'canvas3d', 'label-layer', 'topbar', 'panel-left', 'panel-right',
    'btn-toggle-left', 'btn-toggle-right', 'btn-close-left', 'btn-close-right',
    'btn-reset', 'btn-export-png', 'btn-export-png-mobile',
    'mobile-status-pill', 'mobile-status-text',
    'preset-list', 'diagram2d',
    'val-H', 'val-B', 'val-B_toe', 'val-t_stem', 'val-t_base',
    'val-B_heel', 'val-BH_ratio',
    'val-waterRatio', 'val-kh', 'val-qSurcharge', 'val-betaDeg',
    'val-phiDeg', 'val-gammaSoil', 'val-muBase', 'val-qa', 'val-qa-seismic',
    'badge-water-state', 'badge-kh-state',
    'mode-badge', 'overall-banner', 'overall-icon', 'overall-headline', 'overall-summary',
    'card-sliding', 'badge-sliding', 'val-fss', 'val-fss-limit', 'bar-sliding', 'mark-sliding', 'sub-sliding', 'hint-sliding',
    'card-overturning', 'badge-overturning', 'val-e', 'val-e-limit', 'val-fso', 'val-fso-limit',
    'ecc-kern-zone', 'ecc-marker', 'ecc-kern-label', 'sub-overturning',
    'card-bearing', 'badge-bearing', 'val-qmax', 'val-qa-allow', 'val-fsb', 'bar-bearing', 'sub-bearing',
    'formula-theory-tag', 'kv-ka-label', 'kv-ka-val', 'kv-angles-val', 'kv-heights-val',
    'kv-forces-val', 'kv-moments-val', 'kv-ecc-val',
    'live-formulas', 'breakdown-tbody',
  ];
  for (const id of ids) {
    dom[id] = document.getElementById(id);
  }
  dom.rangeInputs = Array.from(document.querySelectorAll('input[type="range"][data-param]'));
  dom.boolInputs = Array.from(document.querySelectorAll('input[type="checkbox"][data-param]'));
  dom.optInputs = Array.from(document.querySelectorAll('input[type="checkbox"][data-opt]'));
  dom.ctrlTabs = Array.from(document.querySelectorAll('[data-ctrl-tab]'));
  dom.monTabs = Array.from(document.querySelectorAll('[data-mon-tab]'));
  dom.camBtns = Array.from(document.querySelectorAll('[data-cam]'));
  dom.waterItem = document.querySelector('.slider-item-water');
  dom.seismicItem = document.querySelector('.slider-item-seismic');
}

function buildPresetButtons() {
  if (!dom['preset-list'] || !Array.isArray(PRESETS)) return;
  dom['preset-list'].innerHTML = '';

  for (const preset of PRESETS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'preset-btn';
    btn.dataset.presetId = preset.id;
    if (preset.description) btn.title = preset.description;

    const nameSpan = document.createElement('span');
    nameSpan.className = 'preset-name';
    nameSpan.textContent = preset.name || preset.id;

    const badgeSpan = document.createElement('span');
    badgeSpan.className = `preset-badge ${getPresetBadgeTone(preset)}`;
    badgeSpan.textContent = preset.badge || preset.tag || '';

    btn.appendChild(nameSpan);
    if (badgeSpan.textContent) btn.appendChild(badgeSpan);

    btn.addEventListener('click', () => {
      applyPreset(preset.id);
    });

    dom['preset-list'].appendChild(btn);
  }
}

function syncPresetHighlight() {
  const buttons = dom['preset-list']?.querySelectorAll('.preset-btn') ?? [];
  for (const btn of buttons) {
    btn.classList.toggle('is-active', btn.dataset.presetId === state.activePresetId);
  }
}

// ============================================================================
// コントロール同期
// ============================================================================
function updateRangeTrackFill(input) {
  const min = parseFloat(input.min);
  const max = parseFloat(input.max);
  const val = parseFloat(input.value);
  const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
  input.style.setProperty('--fill-pct', `${clamp(pct, 0, 100).toFixed(2)}%`);
}

function syncControlsFromState() {
  const p = state.params;

  for (const input of dom.rangeInputs) {
    const key = input.dataset.param;
    if (key in p) {
      input.value = String(p[key]);
      updateRangeTrackFill(input);
    }
  }
  for (const input of dom.boolInputs) {
    const key = input.dataset.param;
    if (key in p) {
      input.checked = Boolean(p[key]);
    }
  }
  for (const input of dom.optInputs) {
    const key = input.dataset.opt;
    if (key in state.options) {
      input.checked = Boolean(state.options[key]);
    }
  }

  const hw = p.waterRatio * Math.max(0, p.H - p.t_base);
  const bHeel = Math.max(0, p.B - p.B_toe - p.t_stem);

  dom['val-H'].textContent = `${fmt(p.H, 2)} m`;
  dom['val-B'].textContent = `${fmt(p.B, 2)} m`;
  dom['val-B_toe'].textContent = `${fmt(p.B_toe, 2)} m`;
  dom['val-t_stem'].textContent = `${fmt(p.t_stem, 2)} m`;
  dom['val-t_base'].textContent = `${fmt(p.t_base, 2)} m`;
  dom['val-B_heel'].textContent = `${fmt(bHeel, 2)} m`;
  dom['val-BH_ratio'].textContent = fmt(p.B / p.H, 2);

  dom['val-waterRatio'].textContent = `${Math.round(p.waterRatio * 100)}% (${fmt(hw, 2)}m)`;
  dom['val-kh'].textContent = fmt(p.kh, 2);
  dom['val-qSurcharge'].textContent = `${Math.round(p.qSurcharge)} kN/m²`;
  dom['val-betaDeg'].textContent = `${Math.round(p.betaDeg)}°`;

  dom['val-phiDeg'].textContent = `${Math.round(p.phiDeg)}°`;
  dom['val-gammaSoil'].textContent = `${fmt(p.gammaSoil, 1)} kN/m³`;
  dom['val-muBase'].textContent = fmt(p.muBase, 2);
  dom['val-qa'].textContent = `${Math.round(p.qa)} kN/m²`;
  dom['val-qa-seismic'].textContent = String(Math.round(p.qa * 1.5));

  // 水抜き孔・地震状態のインラインフィードバック
  if (dom['badge-water-state']) {
    const clogged = p.waterRatio > 0.005;
    dom['badge-water-state'].textContent = clogged ? '水抜き孔詰まり' : '排水良好';
    dom['badge-water-state'].className = `inline-chip ${clogged ? 'chip-water' : 'chip-ok'}`;
    dom.waterItem?.classList.toggle('is-engaged', clogged);
  }
  if (dom['badge-kh-state']) {
    const seis = p.kh > 0.0001;
    dom['badge-kh-state'].textContent = seis ? '地震時' : '常時';
    dom['badge-kh-state'].className = `inline-chip ${seis ? 'chip-warn' : 'chip-muted'}`;
    dom.seismicItem?.classList.toggle('is-engaged', seis);
  }

  syncPresetHighlight();
}

// ============================================================================
// パネル開閉・タブ切替・カメラ切替
// ============================================================================
function applyPanelState() {
  const { left, right } = state.panels;
  dom['panel-left'].classList.toggle('is-collapsed', !left);
  dom['panel-right'].classList.toggle('is-collapsed', !right);
  dom['btn-toggle-left'].setAttribute('aria-expanded', String(left));
  dom['btn-toggle-right'].setAttribute('aria-expanded', String(right));

  // 右パネルが開いた直後は 2D Canvas を最新サイズで再描画
  if (right && state.result) {
    requestAnimationFrame(() => {
      drawSectionDiagram2D(dom['diagram2d'], state.params, state.result);
    });
  }
}

function setPanels(next) {
  if (typeof next?.left === 'boolean') {
    state.panels.left = next.left;
    if (isMobileView() && next.left && next.right === undefined) {
      state.panels.right = false;
    }
  }
  if (typeof next?.right === 'boolean') {
    state.panels.right = next.right;
    if (isMobileView() && next.right && next.left === undefined) {
      state.panels.left = false;
    }
  }
  // モバイルでは同時オープン防止
  if (isMobileView() && state.panels.left && state.panels.right) {
    state.panels.left = false;
  }
  applyPanelState();
}

function setControlTab(tabName) {
  if (!['geom', 'load', 'soil'].includes(tabName)) return;
  state.activeControlTab = tabName;
  for (const btn of dom.ctrlTabs) {
    const active = btn.dataset.ctrlTab === tabName;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', String(active));
  }
  for (const id of ['geom', 'load', 'soil']) {
    const pane = document.getElementById(`ctrl-pane-${id}`);
    pane?.classList.toggle('is-active', id === tabName);
  }
}

function setMonitorTab(tabName) {
  if (!['overview', 'formulas'].includes(tabName)) return;
  state.activeMonitorTab = tabName;
  for (const btn of dom.monTabs) {
    const active = btn.dataset.monTab === tabName;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', String(active));
  }
  for (const id of ['overview', 'formulas']) {
    const pane = document.getElementById(`mon-pane-${id}`);
    pane?.classList.toggle('is-active', id === tabName);
  }
  if (tabName === 'overview' && state.result) {
    requestAnimationFrame(() => {
      drawSectionDiagram2D(dom['diagram2d'], state.params, state.result);
    });
  }
}

function setCameraPreset(name) {
  state.activeCameraPreset = name;
  for (const btn of dom.camBtns) {
    btn.classList.toggle('is-active', btn.dataset.cam === name);
  }
  if (scene3d && typeof scene3d.setPresetCamera === 'function') {
    scene3d.setPresetCamera(name);
  }
}

// ============================================================================
// 右パネル：安定照査モニター ＆ 計算途中式 更新
// ============================================================================
const OK_ICON_SVG = `
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="10" cy="10" r="8" />
    <polyline points="6.5 10.2 9 12.7 13.8 7.5" />
  </svg>
`;

const NG_ICON_SVG = `
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M10 2.5L18 16.5H2L10 2.5z" />
    <line x1="10" y1="7.8" x2="10" y2="11.8" />
    <circle cx="10" cy="14.3" r="0.9" fill="currentColor" stroke="none" />
  </svg>
`;

function updateMonitorUI(params, result) {
  if (!result) return;
  const { isSeismic, geom, coeff, forces, moments, checks, overall } = result;

  // モードバッジ（[M-1] コンパクト表記でヘッダー衝突ゼロ）
  dom['mode-badge'].textContent = isSeismic ? `地震 kh=${fmt(params.kh, 2)}` : '常時';
  dom['mode-badge'].className = `mode-badge ${isSeismic ? 'is-seismic' : 'is-normal'}`;

  // 総合判定バナー（[P-1] 項目順統一＆孤立改行防止）
  const ok = Boolean(overall?.ok);
  dom['overall-banner'].className = `overall-banner ${ok ? 'is-ok' : 'is-ng'}`;
  dom['overall-icon'].innerHTML = ok ? OK_ICON_SVG : NG_ICON_SVG;
  dom['overall-headline'].textContent = normalizeFailureHeadline(result);
  dom['overall-summary'].textContent = formatOverallSummary(result);

  // モバイル用トップバー総合バッジ
  dom['mobile-status-pill'].className = `mobile-status-pill ${ok ? 'is-ok' : 'is-ng'}`;
  dom['mobile-status-text'].textContent = normalizeMobileFailureShort(result);

  // ① 滑動照査
  const sl = checks.sliding;
  dom['card-sliding'].className = `check-card ${sl.ok ? 'is-ok' : 'is-ng'}`;
  dom['badge-sliding'].className = `judge-badge ${sl.ok ? 'is-ok' : 'is-ng'}`;
  dom['badge-sliding'].textContent = sl.ok ? 'OK' : 'NG';
  dom['val-fss'].textContent = sl.fs > 99 ? '>99' : fmt(sl.fs, 2);
  dom['val-fss-limit'].textContent = `≥ ${fmt(sl.limit, 2)}`;

  const slMaxScale = sl.limit * 2.0; // 基準線がちょうど 50%
  const slPct = clamp((sl.fs / slMaxScale) * 100, 3, 100);
  dom['bar-sliding'].style.width = `${slPct.toFixed(1)}%`;
  dom['mark-sliding'].style.left = '50%';

  const keyBonus = (forces.R_key ?? 0) > 0.05 ? `（突起 +${fmt(forces.R_key, 1)}）` : '';
  dom['sub-sliding'].textContent = `抵抗 ΣR ${fmt(forces.sumR, 1)} kN${keyBonus} ／ 水平力 ΣH ${fmt(forces.sumH, 1)} kN`;

  // [P-3] 滑動 NG かつ突起 OFF 時の改善ヒント
  if (dom['hint-sliding']) {
    if (!sl.ok && !params.hasKey) {
      dom['hint-sliding'].hidden = false;
      dom['hint-sliding'].innerHTML = `
        <svg class="ico-sm" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="9" cy="9" r="7.5" />
          <line x1="9" y1="8.2" x2="9" y2="12.5" />
          <circle cx="9" cy="5.7" r="0.8" fill="currentColor" stroke="none" />
        </svg>
        <span>ヒント：「底面突起」ONや底版幅拡大で滑動抵抗を改善</span>
      `;
    } else {
      dom['hint-sliding'].hidden = true;
      dom['hint-sliding'].textContent = '';
    }
  }

  // ② 転倒照査
  const ot = checks.overturning;
  dom['card-overturning'].className = `check-card ${ot.ok ? 'is-ok' : 'is-ng'}`;
  dom['badge-overturning'].className = `judge-badge ${ot.ok ? 'is-ok' : 'is-ng'}`;
  dom['badge-overturning'].textContent = ot.ok ? 'OK' : 'NG';
  dom['val-e'].textContent = `${fmt(Math.abs(ot.e), 2)} m`;
  dom['val-e-limit'].textContent = `≤ ${isSeismic ? 'B/3' : 'B/6'} (${fmt(ot.eLimit, 2)}m)`;
  dom['val-fso'].textContent = ot.fs > 99 ? '>99' : fmt(ot.fs, 2);
  dom['val-fso-limit'].textContent = `≥ ${fmt(ot.fsLimit, 2)}`;

  // 偏心バー（左端0%=つま先 X=0、右端100%=かかと X=B）
  const kernHalfPct = isSeismic ? 33.333 : 16.667;
  dom['ecc-kern-zone'].style.left = `${(50 - kernHalfPct).toFixed(2)}%`;
  dom['ecc-kern-zone'].style.width = `${(kernHalfPct * 2).toFixed(2)}%`;
  dom['ecc-kern-label'].textContent = isSeismic ? '許容 ±B/3' : '核内 ±B/6';

  const dRatio = geom.B > 0 ? clamp(ot.d / geom.B, 0, 1) : 0.5;
  dom['ecc-marker'].style.left = `${(dRatio * 100).toFixed(1)}%`;

  const sideText = ot.e > 0.01 ? 'つま先側へ偏心' : ot.e < -0.01 ? 'かかと側へ偏心' : 'ほぼ中央';
  const upliftW = ot.upliftGapWidth ?? Math.max(0, geom.B - (checks.bearing.contactLen ?? geom.B));
  if (ot.d <= 0) {
    dom['sub-overturning'].textContent = '合力が底版つま先外へ逸脱（完全転倒状態）';
  } else if (upliftW > 0.02) {
    dom['sub-overturning'].textContent = `作用位置 d=${fmt(ot.d, 2)} m ／ かかと側浮き上がり ${fmt(upliftW, 2)} m`;
  } else {
    dom['sub-overturning'].textContent = `作用位置 d=${fmt(ot.d, 2)} m（${sideText}・全面接地）`;
  }

  // ③ 支持力照査
  const br = checks.bearing;
  dom['card-bearing'].className = `check-card ${br.ok ? 'is-ok' : 'is-ng'}`;
  dom['badge-bearing'].className = `judge-badge ${br.ok ? 'is-ok' : 'is-ng'}`;
  dom['badge-bearing'].textContent = br.ok ? 'OK' : 'NG';

  const qMaxOver = !Number.isFinite(br.qMax) || br.qMax >= 9990;
  dom['val-qmax'].textContent = qMaxOver ? '∞' : fmt(br.qMax, 1);
  dom['val-qa-allow'].textContent = `≤ ${fmt(br.qaAllow, 0)}`;
  dom['val-fsb'].textContent = qMaxOver ? '0.00' : (br.fs > 99 ? '>99' : fmt(br.fs, 2));

  // 使用率バー（100%許容が左から 80% の基準線に来るよう 1.25倍スケール）
  const usageRatio = br.qaAllow > 0 ? (qMaxOver ? 1.25 : br.qMax / br.qaAllow) : 1.25;
  const brPct = clamp((usageRatio / 1.25) * 100, 2, 100);
  dom['bar-bearing'].style.width = `${brPct.toFixed(1)}%`;
  const brMark = dom['card-bearing'].querySelector('.gauge-mark');
  if (brMark) brMark.style.left = '80%';

  if (ot.d <= 0 || qMaxOver) {
    dom['sub-bearing'].textContent = 'つま先エッジへ無限大集中応力（転倒による破壊）';
  } else if (br.isTriangular && ot.e < 0) {
    dom['sub-bearing'].textContent = `つま先 0.0 ／ かかと q₂ ${fmt(br.q2, 1)} kN/m²（三角形分布・接地長 ${fmt(br.contactLen, 2)}m）`;
  } else if (br.isTriangular) {
    dom['sub-bearing'].textContent = `つま先 q₁ ${fmt(br.q1, 1)} ／ かかと 0.0 kN/m²（三角形分布・接地長 ${fmt(br.contactLen, 2)}m）`;
  } else {
    dom['sub-bearing'].textContent = `つま先 q₁ ${fmt(br.q1, 1)} ／ かかと q₂ ${fmt(br.q2, 1)} kN/m²（台形分布・全面接地）`;
  }

  // タブ2：計算途中式 ＆ 検算シート
  updateFormulasTab(params, result);
}

function updateFormulasTab(params, result) {
  const { isSeismic, geom, coeff, forces, moments, checks, breakdownRows } = result;

  dom['formula-theory-tag'].textContent = isSeismic ? '物部・岡部式（地震時）' : 'クーロン式（常時）';
  dom['kv-ka-label'].innerHTML = isSeismic ? '地震時土圧係数 K<sub>AE</sub>' : '主働土圧係数 K<sub>A</sub>';
  dom['kv-ka-val'].textContent = fmt(coeff.ka, 3);
  dom['kv-angles-val'].textContent = `${fmt(coeff.deltaDeg, 1)}° ／ ${fmt(coeff.thetaEDeg, 1)}°`;
  dom['kv-heights-val'].textContent = `${fmt(geom.H_v, 2)} m ／ ${fmt(geom.H_w, 2)} m`;
  dom['kv-forces-val'].textContent = `${fmt(forces.sumV, 1)} ／ ${fmt(forces.sumH, 1)} kN`;
  dom['kv-moments-val'].textContent = `${fmt(moments.Mr, 1)} ／ ${fmt(moments.Mt, 1)} kN·m`;
  dom['kv-ecc-val'].textContent = `${fmt(checks.overturning.d, 2)} m ／ ${fmt(checks.overturning.e, 2)} m`;

  // [C-1][P-3] ライブ代入計算式カード（一般式＋数値代入の 2 段折り返し構造・右端クリップ完全 0 件）
  const sl = checks.sliding;
  const ot = checks.overturning;
  const br = checks.bearing;
  const hasKeyActive = Boolean(params.hasKey) && (forces.R_key ?? 0) > 0.05;
  const keyTermSym = hasKeyActive ? ' + Rkey' : '';
  const keyTermNum = hasKeyActive ? ` + ${fmt(forces.R_key, 1)}` : '';

  // [P-3] 突起 Rkey 根拠行（result.coeff?.keyDetail 優先・未定義時は安全フォールバック）
  let keyDetailHtml = '';
  if (params.hasKey) {
    const kd = coeff.keyDetail || {};
    const eta = kd.eta ?? 0.50;
    const kpB = kd.kpBase ?? coeff.kpBase ?? 3.0;
    const kaB = kd.kaBase ?? coeff.kaBase ?? (1 / kpB);
    const dk = kd.keyDepth ?? geom.keyDepth ?? 0.55;
    const gammaB = kd.gammaBase ?? (params.gammaSoil + 1.0);
    const qPrime = kd.qOverburdenKey ?? (0.25 * Math.max(0, forces.sumV / Math.max(0.1, geom.B)));
    keyDetailHtml = `
      <div class="formula-eq-block formula-eq-key">
        <div class="formula-eq-general">突起抵抗: Rkey = η(Kp−Ka)(½γb·dk² + q'·dk)</div>
        <div class="formula-eq-calc">= ${fmt(eta, 2)}×(${fmt(kpB, 2)}−${fmt(kaB, 2)})×(0.5×${fmt(gammaB, 1)}×${fmt(dk, 2)}² + ${fmt(qPrime, 1)}×${fmt(dk, 2)}) = ${fmt(forces.R_key, 1)} kN/m</div>
      </div>
    `;
  }

  // [P-3] 滑動 NG 時の改善ヒント
  const slidingHintHtml = (!sl.ok && !params.hasKey)
    ? `<div class="formula-hint-box">ヒント：「断面寸法」の『底面突起』ON または底版幅拡大で滑動 OK へ回復できます</div>`
    : '';

  // [P-3] 支持力分布公式（台形 / つま先側三角形 / かかと側三角形 e < 0 / 完全転倒）
  let bearingFormulaHtml = '';
  if (ot.d <= 0) {
    bearingFormulaHtml = `
      <div class="formula-eq-block">
        <div class="formula-eq-general">合力が底版外へ逸脱（d ≤ 0）</div>
        <div class="formula-eq-calc">d = ${fmt(ot.d, 2)} m ≤ 0 → <span class="eq-ng">転倒極限のため q₁ = ∞ (NG)</span></div>
      </div>
    `;
  } else if (br.isTriangular && ot.e < 0) {
    const dHeel = Math.max(0.001, geom.B - ot.d);
    bearingFormulaHtml = `
      <div class="formula-eq-block">
        <div class="formula-eq-general">|e| &gt; B/6（かかと側偏心・三角形）: q₂ = 2·ΣV / (3(B−d))</div>
        <div class="formula-eq-calc">= 2×${fmt(forces.sumV, 1)} / (3×${fmt(dHeel, 2)}) = ${fmt(br.q2, 1)} kN/m²（つま先 q₁ = 0）</div>
      </div>
    `;
  } else if (br.isTriangular) {
    bearingFormulaHtml = `
      <div class="formula-eq-block">
        <div class="formula-eq-general">|e| &gt; B/6（つま先側偏心・三角形）: q₁ = 2·ΣV / (3d)</div>
        <div class="formula-eq-calc">= 2×${fmt(forces.sumV, 1)} / (3×${fmt(ot.d, 2)}) = ${fmt(br.q1, 1)} kN/m²（かかと q₂ = 0）</div>
      </div>
    `;
  } else {
    bearingFormulaHtml = `
      <div class="formula-eq-block">
        <div class="formula-eq-general">|e| ≤ B/6（全面接地・台形）: q₁,₂ = (ΣV / B)(1 ± 6e / B)</div>
        <div class="formula-eq-calc">(${fmt(forces.sumV, 1)}/${fmt(geom.B, 2)})(1 ± ${fmt((6 * ot.e) / geom.B, 3)}) → q₁=${fmt(br.q1, 1)} / q₂=${fmt(br.q2, 1)} kN/m²</div>
      </div>
    `;
  }

  const slCmp = sl.ok ? '≥' : '&lt;';
  const fsoOk = ot.fs >= ot.fsLimit;
  const eccOk = Math.abs(ot.e) <= ot.eLimit && ot.d > 0;
  const eLimSym = isSeismic ? 'B/3' : 'B/6';
  const qMaxDisp = br.qMax >= 9990 ? '∞' : fmt(br.qMax, 1);
  const fsbDisp = br.qMax >= 9990 ? '0.00' : fmt(br.fs, 2);

  dom['live-formulas'].innerHTML = `
    <div class="formula-card">
      <div class="formula-card-head">
        <span class="formula-card-title">① 滑動安全率 F<sub>ss</sub></span>
        <span class="judge-badge ${sl.ok ? 'is-ok' : 'is-ng'}">${sl.ok ? 'OK' : 'NG'}</span>
      </div>
      <div class="formula-eq-block">
        <div class="formula-eq-general">Fss = (ΣV·μ${keyTermSym}) / ΣH</div>
        <div class="formula-eq-calc">= (${fmt(forces.sumV, 1)}×${fmt(params.muBase, 2)}${keyTermNum}) / ${fmt(forces.sumH, 1)} = <span class="${sl.ok ? 'eq-ok' : 'eq-ng'}">${fmt(sl.fs, 2)} ${slCmp} ${fmt(sl.limit, 2)} (${sl.ok ? 'OK' : 'NG'})</span></div>
      </div>
      ${keyDetailHtml}
      ${slidingHintHtml}
    </div>

    <div class="formula-card">
      <div class="formula-card-head">
        <span class="formula-card-title">② 転倒安全率 F<sub>so</sub> ＆ 偏心距離 e</span>
        <span class="judge-badge ${ot.ok ? 'is-ok' : 'is-ng'}">${ot.ok ? 'OK' : 'NG'}</span>
      </div>
      <div class="formula-eq-block">
        <div class="formula-eq-general">Fso = Mr / Mt</div>
        <div class="formula-eq-calc">= ${fmt(moments.Mr, 1)} / ${fmt(moments.Mt, 1)} = <span class="${fsoOk ? 'eq-ok' : 'eq-ng'}">${fmt(ot.fs, 2)} ${fsoOk ? '≥' : '&lt;'} ${fmt(ot.fsLimit, 2)} (${fsoOk ? 'OK' : 'NG'})</span></div>
      </div>
      <div class="formula-eq-block">
        <div class="formula-eq-general">d = (Mr − Mt) / ΣV,  e = B/2 − d</div>
        <div class="formula-eq-calc">d = ${fmt(ot.d, 2)} m → |e| = <span class="${eccOk ? 'eq-ok' : 'eq-ng'}">${fmt(Math.abs(ot.e), 2)} ${eccOk ? '≤' : '&gt;'} ${eLimSym} (${fmt(ot.eLimit, 2)} m)</span></div>
      </div>
    </div>

    <div class="formula-card">
      <div class="formula-card-head">
        <span class="formula-card-title">③ 地盤反力度 q<sub>max</sub> ＆ 許容支持力度 q<sub>a</sub></span>
        <span class="judge-badge ${br.ok ? 'is-ok' : 'is-ng'}">${br.ok ? 'OK' : 'NG'}</span>
      </div>
      ${bearingFormulaHtml}
      <div class="formula-eq-block">
        <div class="formula-eq-general">Fsb = qa,allow / qmax（許容 ${fmt(br.qaAllow, 0)} kN/m²）</div>
        <div class="formula-eq-calc">= ${fmt(br.qaAllow, 0)} / ${qMaxDisp} = <span class="${br.ok ? 'eq-ok' : 'eq-ng'}">${fsbDisp} ${br.ok ? '≥' : '&lt;'} 1.00 (${br.ok ? 'OK' : 'NG'})</span></div>
      </div>
    </div>
  `;

  // [M-3] 荷重・モーメント一覧表（M 列を縦 2 段積みでスリム化し、荷重項目列を拡幅）
  const rows = Array.isArray(breakdownRows) ? breakdownRows : [];
  let tbodyHtml = '';

  for (const r of rows) {
    const label = r.label ?? r.name ?? r.item ?? '荷重要素';
    const formulaText = r.formula ? `<div class="row-formula">${escapeHtml(r.formula)}</div>` : '';
    const vVal = Number(r.V ?? r.v ?? r.vertical ?? 0);
    const hVal = Number(r.H ?? r.h ?? r.horizontal ?? 0);

    const hasArmV = r.armV !== null && r.armV !== undefined && Number.isFinite(Number(r.armV));
    const hasArmH = r.armH !== null && r.armH !== undefined && Number.isFinite(Number(r.armH));
    let armHtml = '—';
    if (hasArmV && hasArmH) {
      armHtml = `<div class="m-stack"><span>${fmt(Number(r.armV), 2)}</span><span>${fmt(Number(r.armH), 2)}</span></div>`;
    } else if (hasArmV) {
      armHtml = fmt(Number(r.armV), 2);
    } else if (hasArmH) {
      armHtml = fmt(Number(r.armH), 2);
    } else {
      const fallbackArm = r.arm ?? r.leverArm ?? r.xArm ?? r.yArm ?? null;
      if (fallbackArm !== null && Number.isFinite(Number(fallbackArm))) {
        armHtml = fmt(Number(fallbackArm), 2);
      }
    }

    let mrVal = Number(r.Mr ?? r.mr ?? 0);
    let mtVal = Number(r.Mt ?? r.mt ?? 0);
    if (mrVal === 0 && mtVal === 0 && (r.M !== undefined || r.moment !== undefined)) {
      const m = Number(r.M ?? r.moment ?? 0);
      if (r.type === 'overturn' || r.isOverturning || m < 0) {
        mtVal = Math.abs(m);
      } else {
        mrVal = Math.abs(m);
      }
    }

    let mCellHtml = '—';
    if (mrVal > 0.01 && mtVal > 0.01) {
      mCellHtml = `<div class="m-stack"><div class="m-pos">+${fmt(mrVal, 1)}</div><div class="m-neg">-${fmt(mtVal, 1)}</div></div>`;
    } else if (mrVal > 0.01) {
      mCellHtml = `<span class="m-pos">+${fmt(mrVal, 1)}</span>`;
    } else if (mtVal > 0.01) {
      mCellHtml = `<span class="m-neg">-${fmt(mtVal, 1)}</span>`;
    }

    tbodyHtml += `
      <tr>
        <td class="col-item"><div>${escapeHtml(label)}</div>${formulaText}</td>
        <td class="col-num">${Math.abs(vVal) > 0.01 ? fmt(vVal, 1) : '—'}</td>
        <td class="col-num">${Math.abs(hVal) > 0.01 ? fmt(hVal, 1) : '—'}</td>
        <td class="col-num">${armHtml}</td>
        <td class="col-num">${mCellHtml}</td>
      </tr>
    `;
  }

  // 合計行（M 列を縦 2 段積み）
  tbodyHtml += `
    <tr class="row-total">
      <td class="col-item">合計（ΣV・ΣH・M）</td>
      <td class="col-num">${fmt(forces.sumV, 1)}</td>
      <td class="col-num">${fmt(forces.sumH, 1)}</td>
      <td class="col-num">—</td>
      <td class="col-num"><div class="m-stack"><div class="m-pos">+${fmt(moments.Mr, 1)}</div><div class="m-neg">-${fmt(moments.Mt, 1)}</div></div></td>
    </tr>
  `;

  dom['breakdown-tbody'].innerHTML = tbodyHtml;
}

// ============================================================================
// 2x 高DPI 2D 断面力学図 Canvas レンダラー（文字重なりゼロ保証）
// ============================================================================
function normalizeDiagramPts(rawPts, axisKey1, axisKey2) {
  if (!Array.isArray(rawPts) || rawPts.length === 0) return [];
  return rawPts
    .map((pt) => {
      if (Array.isArray(pt) && pt.length >= 2) {
        return { a: Number(pt[0]), b: Number(pt[1]) };
      }
      if (pt && typeof pt === 'object') {
        const a = pt[axisKey1] ?? pt.y ?? pt.x ?? pt.h ?? pt.pos ?? 0;
        const b = pt[axisKey2] ?? pt.p ?? pt.q ?? pt.pressure ?? pt.val ?? pt.value ?? 0;
        return { a: Number(a), b: Number(b) };
      }
      return null;
    })
    .filter((pt) => pt && Number.isFinite(pt.a) && Number.isFinite(pt.b));
}

function drawPillLabel(ctx, text, x, y, options = {}) {
  const {
    align = 'center',
    baseline = 'middle',
    font = '700 10px "Noto Sans JP", "BIZ UDPGothic", "Yu Gothic UI", sans-serif',
    color = '#0f172a',
    bg = 'rgba(255,255,255,0.92)',
    border = null,
    padX = 4,
    padY = 2,
  } = options;

  ctx.save();
  ctx.font = font;
  const metrics = ctx.measureText(text);
  const textW = metrics.width;
  const textH = 11;
  const boxW = textW + padX * 2;
  const boxH = textH + padY * 2;

  let bx = x - boxW / 2;
  if (align === 'left') bx = x;
  else if (align === 'right') bx = x - boxW;

  let by = y - boxH / 2;
  if (baseline === 'top') by = y;
  else if (baseline === 'bottom') by = y - boxH;

  // 背景角丸矩形
  const r = 3;
  ctx.beginPath();
  ctx.roundRect(bx, by, boxW, boxH, r);
  ctx.fillStyle = bg;
  ctx.fill();
  if (border) {
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, bx + boxW / 2, by + boxH / 2 + 0.5);
  ctx.restore();
}

function drawArrow(ctx, x1, y1, x2, y2, color, lineWidth = 1.6, headLen = 6) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  const ang = Math.atan2(dy, dx);

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLen * Math.cos(ang - 0.42), y2 - headLen * Math.sin(ang - 0.42));
  ctx.lineTo(x2 - headLen * Math.cos(ang + 0.42), y2 - headLen * Math.sin(ang + 0.42));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawSectionDiagram2D(canvas, params, result) {
  if (!canvas || !result) return;
  const rect = canvas.getBoundingClientRect();
  const cssW = Math.max(240, Math.floor(rect.width || 336));
  const cssH = Math.max(200, Math.floor(rect.height || 274));
  const dpr = Math.max(2, window.devicePixelRatio || 1);

  if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.save();
  ctx.scale(dpr, dpr);

  // 背景と薄い方眼
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cssW, cssH);

  ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
  ctx.lineWidth = 1;
  for (let gx = 16; gx < cssW; gx += 18) {
    ctx.beginPath();
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, cssH);
    ctx.stroke();
  }
  for (let gy = 16; gy < cssH; gy += 18) {
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(cssW, gy);
    ctx.stroke();
  }

  const { geom, forces, checks, isSeismic, diagrams } = result;
  const H = geom.H;
  const B = geom.B;
  const B_toe = geom.B_toe;
  const t_top = geom.t_top;
  const t_stem = geom.t_stem;
  const t_base = geom.t_base;
  const H_v = geom.H_v ?? H;
  const H_w = geom.H_w ?? 0;
  const hasKey = Boolean(params.hasKey);
  const keyDepth = hasKey ? (geom.keyDepth ?? 0.55) : 0;
  const keyWidth = geom.keyWidth ?? 0.45;
  const keyX = geom.keyX ?? (B_toe + t_stem + 0.35 * Math.max(0.3, B - B_toe - t_stem));
  const betaRad = (params.betaDeg * Math.PI) / 180;

  // 余白設計（文字重なり・見切れ完全防止）
  const padL = 48;
  const padR = 116;
  const padT = 38;
  const padB = 68;

  const drawW = Math.max(80, cssW - padL - padR);
  const drawH = Math.max(80, cssH - padT - padB);

  // 等方スケール（擁壁断面が正しい縦横比で収まる）
  const worldW = B + 0.30;
  const worldH = Math.max(H_v, H) + 0.20;
  const scale = Math.min(drawW / worldW, drawH / worldH);

  // 原点 O (X=0, Y=0) のスクリーン位置
  const originX = padL + Math.max(0, (drawW - B * scale) * 0.36);
  const originY = cssH - padB;

  const toX = (wx) => originX + wx * scale;
  const toY = (wy) => originY - wy * scale;

  // 1. 背面盛土ポリゴン（[M-5] engine.js / scene3d.js と完全一致する xStemBackBot 起点）
  const xStemBackTop = B_toe + t_top;
  const xStemBackBot = B_toe + t_stem;
  const soilRightX = B + Math.min(0.42, 20 / scale);
  const ySlopeAt = (wx) => H + Math.max(0, wx - xStemBackBot) * Math.tan(betaRad);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(toX(xStemBackBot), toY(t_base));
  ctx.lineTo(toX(xStemBackTop), toY(H));
  ctx.lineTo(toX(xStemBackBot), toY(H));
  ctx.lineTo(toX(soilRightX), toY(ySlopeAt(soilRightX)));
  ctx.lineTo(toX(soilRightX), toY(0));
  ctx.lineTo(toX(B), toY(0));
  ctx.lineTo(toX(B), toY(t_base));
  ctx.closePath();
  const soilGrad = ctx.createLinearGradient(0, toY(H_v), 0, toY(0));
  soilGrad.addColorStop(0, '#fef3c7');
  soilGrad.addColorStop(1, '#fde68a');
  ctx.fillStyle = soilGrad;
  ctx.globalAlpha = 0.58;
  ctx.fill();
  ctx.restore();

  // 2. 地下水面・飽和領域（H_w > 0 のとき、H_w は底面 Y=0 からの標高）
  if (H_w > 0.02) {
    const waterY = H_w;
    // 水面高さでのたて壁背面 X 座標
    const stemRatio = clamp((waterY - t_base) / Math.max(0.01, H - t_base), 0, 1);
    const xStemAtWater = xStemBackBot + (xStemBackTop - xStemBackBot) * stemRatio;

    ctx.save();
    if (waterY > t_base) {
      ctx.beginPath();
      ctx.moveTo(toX(xStemBackBot), toY(t_base));
      ctx.lineTo(toX(xStemAtWater), toY(waterY));
      ctx.lineTo(toX(soilRightX), toY(waterY));
      ctx.lineTo(toX(soilRightX), toY(0));
      ctx.lineTo(toX(B), toY(0));
      ctx.lineTo(toX(B), toY(t_base));
      ctx.closePath();
      ctx.fillStyle = 'rgba(14, 165, 233, 0.24)';
      ctx.fill();

      // 水面ライン
      ctx.strokeStyle = '#0284c7';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 2.5]);
      ctx.beginPath();
      ctx.moveTo(toX(xStemAtWater), toY(waterY));
      ctx.lineTo(toX(soilRightX), toY(waterY));
      ctx.stroke();
      ctx.setLineDash([]);

      // ▽ 水面シンボル
      const triX = toX((xStemAtWater + B) * 0.52);
      const triY = toY(waterY);
      ctx.fillStyle = '#0284c7';
      ctx.beginPath();
      ctx.moveTo(triX, triY);
      ctx.lineTo(triX - 4, triY - 6);
      ctx.lineTo(triX + 4, triY - 6);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(14, 165, 233, 0.24)';
      ctx.fillRect(toX(B), toY(waterY), toX(soilRightX) - toX(B), toY(0) - toY(waterY));
    }
    ctx.restore();
  }

  // 地表面実線（xStemBackTop → xStemBackBot 水平、xStemBackBot 以降 β 勾配で X=B の Hv に完全一致）
  ctx.save();
  ctx.strokeStyle = '#92400e';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(toX(xStemBackTop), toY(H));
  ctx.lineTo(toX(xStemBackBot), toY(H));
  ctx.lineTo(toX(soilRightX), toY(ySlopeAt(soilRightX)));
  ctx.stroke();
  ctx.restore();

  // 3. 上載荷重矢印群 (q > 0)（[M-5] ラベルを矢印頂点より明確に上へ離して干渉ゼロ）
  if (params.qSurcharge > 0.5) {
    const qSpanStart = xStemBackBot + 0.08;
    const qSpanEnd = Math.max(qSpanStart + 0.2, B - 0.04);
    const arrowCount = 4;
    const arrowLen = 11;
    let minArrowTopY = Infinity;
    for (let i = 0; i < arrowCount; i++) {
      const wx = qSpanStart + ((qSpanEnd - qSpanStart) * (i + 0.5)) / arrowCount;
      const wy = ySlopeAt(wx);
      const topY = toY(wy) - 1 - arrowLen;
      if (topY < minArrowTopY) minArrowTopY = topY;
      drawArrow(ctx, toX(wx), topY, toX(wx), toY(wy) - 1, '#7c3aed', 1.3, 4.2);
    }
    const qMidX = clamp(toX((qSpanStart + qSpanEnd) * 0.5), padL + 26, cssW - 58);
    // ピル高さ ~15px の下端が minArrowTopY - 3 より上になるよう厳密配置
    const qLabelY = Math.max(9, minArrowTopY - 11);
    drawPillLabel(ctx, `q=${Math.round(params.qSurcharge)} kN/m²`, qMidX, qLabelY, {
      color: '#6d28d9',
      bg: 'rgba(245, 243, 255, 0.96)',
      border: '#ddd6fe',
      font: '700 9px "Noto Sans JP", "BIZ UDPGothic", sans-serif',
      padX: 4,
      padY: 1.5,
    });
  }

  // 4. 基礎地盤ライン（底面）
  ctx.save();
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(toX(-0.35), toY(0));
  ctx.lineTo(toX(soilRightX), toY(0));
  ctx.stroke();
  ctx.restore();

  // 5. L型擁壁コンクリート断面ポリゴン
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(toX(0), toY(0));
  ctx.lineTo(toX(0), toY(t_base));
  ctx.lineTo(toX(B_toe), toY(t_base));
  ctx.lineTo(toX(B_toe), toY(H));
  ctx.lineTo(toX(xStemBackTop), toY(H));
  ctx.lineTo(toX(xStemBackBot), toY(t_base));
  ctx.lineTo(toX(B), toY(t_base));
  ctx.lineTo(toX(B), toY(0));
  if (hasKey) {
    const kR = Math.min(B - 0.05, keyX + keyWidth / 2);
    const kL = Math.max(0.05, keyX - keyWidth / 2);
    ctx.lineTo(toX(kR), toY(0));
    ctx.lineTo(toX(kR), toY(-keyDepth));
    ctx.lineTo(toX(kL), toY(-keyDepth));
    ctx.lineTo(toX(kL), toY(0));
  }
  ctx.closePath();
  const concGrad = ctx.createLinearGradient(toX(0), toY(H), toX(B), toY(0));
  concGrad.addColorStop(0, '#cbd5e1');
  concGrad.addColorStop(1, '#94a3b8');
  ctx.fillStyle = concGrad;
  ctx.fill();
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // 原点 O（つま先先端）マーカー
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.arc(toX(0), toY(0), 2.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 6. 仮想背面破線 (X = B)
  const vBackX = toX(B);
  const vBackTopY = toY(H_v);
  ctx.save();
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1.25;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(vBackX, toY(0));
  ctx.lineTo(vBackX, vBackTopY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // 7. 仮想背面右側の水平圧力分布（土圧・水圧・上載圧）
  let earthPts = normalizeDiagramPts(diagrams?.earthPressurePts, 'y', 'p');
  let waterPts = normalizeDiagramPts(diagrams?.waterPressurePts, 'y', 'p');
  let surPts = normalizeDiagramPts(diagrams?.surchargePts, 'y', 'p');

  // フォールバック生成（万一 diagrams が空の場合も正確に描画）
  if (earthPts.length < 2) {
    const pBot = (2 * (forces.Pa_h ?? 0)) / Math.max(0.1, H_v);
    earthPts = [{ a: 0, b: pBot }, { a: H_v, b: 0 }];
  }
  if (waterPts.length < 2 && H_w > 0.01) {
    waterPts = [{ a: 0, b: 9.81 * H_w }, { a: H_w, b: 0 }];
  }
  if (surPts.length < 2 && params.qSurcharge > 0.1) {
    const pq = (forces.Pq_h ?? 0) / Math.max(0.1, H_v);
    surPts = [{ a: 0, b: pq }, { a: H_v, b: pq }];
  }

  // 最大圧力を計算して右側描画幅 (最大 64px) にスケーリング
  const maxEarthP = earthPts.reduce((m, pt) => Math.max(m, pt.b), 0);
  const maxWaterP = waterPts.reduce((m, pt) => Math.max(m, pt.b), 0);
  const maxSurP = surPts.reduce((m, pt) => Math.max(m, pt.b), 0);
  const maxHorizP = Math.max(10, maxEarthP + maxSurP, maxWaterP);
  const maxPressurePx = clamp(cssW - vBackX - 76, 28, 56);
  const pScale = maxPressurePx / maxHorizP;

  // 7a. 上載圧 (薄紫)
  if (surPts.length >= 2 && maxSurP > 0.1) {
    const sorted = [...surPts].sort((p1, p2) => p1.a - p2.a);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(vBackX, toY(sorted[0].a));
    for (const pt of sorted) {
      ctx.lineTo(vBackX + pt.b * pScale, toY(pt.a));
    }
    ctx.lineTo(vBackX, toY(sorted[sorted.length - 1].a));
    ctx.closePath();
    ctx.fillStyle = 'rgba(124, 58, 237, 0.16)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(124, 58, 237, 0.65)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 2]);
    ctx.stroke();
    ctx.restore();
  }

  // 7b. 有効主働土圧 (橙)
  if (earthPts.length >= 2 && maxEarthP > 0.1) {
    const sorted = [...earthPts].sort((p1, p2) => p1.a - p2.a);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(vBackX, toY(sorted[0].a));
    for (const pt of sorted) {
      ctx.lineTo(vBackX + pt.b * pScale, toY(pt.a));
    }
    ctx.lineTo(vBackX, toY(sorted[sorted.length - 1].a));
    ctx.closePath();
    ctx.fillStyle = 'rgba(234, 88, 12, 0.24)';
    ctx.fill();
    ctx.strokeStyle = '#ea580c';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();

    // 土圧合力矢印
    const paArrowY = toY(H_v * 0.38);
    drawArrow(ctx, vBackX + Math.min(maxPressurePx, 36) + 6, paArrowY, vBackX + 2, paArrowY, '#c2410c', 1.8, 5.5);
  }

  // 7c. 静水圧 (青)
  if (waterPts.length >= 2 && maxWaterP > 0.1 && H_w > 0.02) {
    const sorted = [...waterPts].sort((p1, p2) => p1.a - p2.a);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(vBackX, toY(sorted[0].a));
    for (const pt of sorted) {
      ctx.lineTo(vBackX + pt.b * pScale, toY(pt.a));
    }
    ctx.lineTo(vBackX, toY(sorted[sorted.length - 1].a));
    ctx.closePath();
    ctx.fillStyle = 'rgba(2, 132, 199, 0.28)';
    ctx.fill();
    ctx.strokeStyle = '#0284c7';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();

    const pwArrowY = toY(H_w * 0.33);
    drawArrow(ctx, vBackX + Math.min(maxPressurePx, 34) + 4, pwArrowY, vBackX + 2, pwArrowY, '#0369a1', 1.8, 5.5);
  }

  // 7d. 水平力数値ラベル（[M-4] 3D ピンラベルと表記・単位 /m を完全統一）
  const labelRightX = cssW - 4;
  const paSoilH = forces.Pa_h ?? 0;
  const pqH = forces.Pq_h ?? 0;
  const paTotal = paSoilH + pqH;
  const hasPq = pqH > 0.05;
  const earthSym = isSeismic ? (hasPq ? 'PAE+Pq' : 'PAE') : (hasPq ? 'Pa+Pq' : 'Pa');
  const earthLabelText = `${earthSym} ${fmt(paTotal, 1)} kN/m`;

  let paLabelY = clamp(toY(H_v * 0.68), padT + 6, originY - 36);
  const pwTotal = forces.Pw_h ?? 0;
  let pwLabelY = null;

  if (pwTotal > 0.5) {
    pwLabelY = clamp(toY(H_w * 0.34), padT + 26, originY - 12);
    if (Math.abs(pwLabelY - paLabelY) < 20) {
      paLabelY = Math.max(padT + 4, pwLabelY - 21);
    }
    drawPillLabel(ctx, `Pw ${fmt(pwTotal, 1)} kN/m`, labelRightX, pwLabelY, {
      align: 'right',
      color: '#0369a1',
      bg: 'rgba(240, 249, 255, 0.96)',
      border: '#bae6fd',
      font: '700 9px "Noto Sans JP", "BIZ UDPGothic", sans-serif',
      padX: 4,
      padY: 1.5,
    });
  }

  drawPillLabel(ctx, earthLabelText, labelRightX, paLabelY, {
    align: 'right',
    color: '#c2410c',
    bg: 'rgba(255, 247, 237, 0.96)',
    border: '#fed7aa',
    font: '700 9px "Noto Sans JP", "BIZ UDPGothic", sans-serif',
    padX: 4,
    padY: 1.5,
  });

  // 8. 底面下の地盤反力分布・ミドルサード許容核・底面揚圧力 U・合力作用点 e
  const br = checks.bearing;
  const ot = checks.overturning;
  const baseTopY = toY(0) + (hasKey ? Math.min(9, keyDepth * scale * 0.32) : 3);
  const maxBearPx = 28;

  // 8a. 許容核帯（常時 B/6 核 = [B/3, 2B/3]、地震時 B/3 核 = [B/6, 5B/6]）
  const kernL = isSeismic ? B / 6 : B / 3;
  const kernR = isSeismic ? (5 * B) / 6 : (2 * B) / 3;
  ctx.save();
  ctx.fillStyle = 'rgba(16, 185, 129, 0.28)';
  ctx.fillRect(toX(kernL), toY(0) + 1, toX(kernR) - toX(kernL), 6);
  ctx.strokeStyle = '#059669';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(toX(kernL), toY(0));
  ctx.lineTo(toX(kernL), toY(0) + 8);
  ctx.moveTo(toX(kernR), toY(0));
  ctx.lineTo(toX(kernR), toY(0) + 8);
  ctx.stroke();
  ctx.restore();

  // 8b. 地盤反力分布ポリゴン（diagrams.bearingPts に完全準拠）
  const q1 = Number.isFinite(br.q1) ? Math.min(br.q1, 9999) : 9999;
  const q2 = Number.isFinite(br.q2) ? Math.max(0, br.q2) : 0;
  const qRef = Math.max(10, br.qaAllow * 1.05, Math.min(br.qMax, br.qaAllow * 1.5));
  const h1 = ot.d <= 0 ? maxBearPx : clamp((q1 / qRef) * maxBearPx, q1 > 0.1 ? 3 : 0, maxBearPx);
  const h2 = ot.d <= 0 ? 0 : clamp((q2 / qRef) * maxBearPx, q2 > 0.1 ? 3 : 0, maxBearPx);
  const bearingPts = normalizeDiagramPts(diagrams?.bearingPts, 'x', 'q');

  const bearFill = br.ok ? 'rgba(13, 148, 136, 0.24)' : 'rgba(220, 38, 38, 0.24)';
  const bearStroke = br.ok ? '#0d9488' : '#dc2626';

  ctx.save();
  ctx.beginPath();
  if (bearingPts.length >= 2) {
    const sorted = [...bearingPts].sort((p1, p2) => p1.a - p2.a);
    ctx.moveTo(toX(sorted[0].a), baseTopY);
    for (const pt of sorted) {
      const qv = Number.isFinite(pt.b) ? Math.min(pt.b, 9999) : 9999;
      const hp = qv <= 0.05 ? 0 : clamp((qv / qRef) * maxBearPx, 3, maxBearPx);
      ctx.lineTo(toX(pt.a), baseTopY + hp);
    }
    ctx.lineTo(toX(sorted[sorted.length - 1].a), baseTopY);
  } else {
    const contactEndX = ot.d <= 0 ? 0.15 * B : clamp(br.contactLen ?? B, 0.05, B);
    ctx.moveTo(toX(0), baseTopY);
    ctx.lineTo(toX(0), baseTopY + h1);
    ctx.lineTo(toX(contactEndX), baseTopY + h2);
    ctx.lineTo(toX(contactEndX), baseTopY);
  }
  ctx.closePath();
  ctx.fillStyle = bearFill;
  ctx.fill();
  ctx.strokeStyle = bearStroke;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 浮き上がり区間表示（非接地部）
  const contactLenVal = br.contactLen ?? B;
  if (contactLenVal < B - 0.04) {
    const gapStart = ot.e >= 0 ? contactLenVal : 0;
    const gapEnd = ot.e >= 0 ? B : B - contactLenVal;
    ctx.strokeStyle = '#dc2626';
    ctx.lineWidth = 1.25;
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.moveTo(toX(gapStart), baseTopY + 2);
    ctx.lineTo(toX(gapEnd), baseTopY + 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();

  // 8b-2. [M-5] 底面揚圧力 U（H_w > 0 時：破線シアン三角形＋上向き小矢印＋右余白ラベル）
  const uForce = forces.U_uplift ?? 0;
  if (H_w > 0.02 && uForce > 0.1) {
    const puHeel = 0.65 * 9.81 * H_w;
    const uPx = clamp((puHeel / qRef) * maxBearPx, 8, 22);
    const uBaseY = toY(0) + 1;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(toX(0), uBaseY);
    ctx.lineTo(toX(B), uBaseY);
    ctx.lineTo(toX(B), uBaseY + uPx);
    ctx.closePath();
    ctx.fillStyle = 'rgba(6, 182, 212, 0.22)';
    ctx.fill();
    ctx.strokeStyle = '#0891b2';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([3.5, 2]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // 揚圧力合力点 X = (2/3)B の上向き小矢印
    const ux = toX((2 / 3) * B);
    drawArrow(ctx, ux, uBaseY + uPx * 0.72 + 5, ux, uBaseY + 1, '#0891b2', 1.35, 4);

    // 揚圧力ラベルを右余白下段（Pw の下・e の上・反力と完全分離）へ配置
    const uLabelY = clamp(
      baseTopY + 18,
      (pwLabelY !== null ? pwLabelY + 19 : originY + 8),
      cssH - 30
    );
    const uText = `揚圧力 U ${fmt(uForce, 1)} kN/m`;

    // 細いシアン破線リーダーでかかと底面の揚圧力三角形へ接続
    ctx.save();
    ctx.strokeStyle = 'rgba(8, 145, 178, 0.75)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2.5, 2]);
    ctx.beginPath();
    ctx.moveTo(toX(B) + 1, uBaseY + uPx * 0.55);
    ctx.lineTo(Math.max(toX(B) + 8, cssW - 92), uLabelY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    drawPillLabel(ctx, uText, labelRightX, uLabelY, {
      align: 'right',
      color: '#0e7490',
      bg: 'rgba(236, 254, 255, 0.96)',
      border: '#a5f3fc',
      font: '700 8.8px "Noto Sans JP", "BIZ UDPGothic", sans-serif',
      padX: 3.5,
      padY: 1.5,
    });
  }

  // 8c. 合力作用点 d & 偏心矢印
  const dClamped = clamp(ot.d, 0, B);
  const rx = toX(dClamped);
  const rColor = ot.ok ? '#059669' : '#dc2626';
  drawArrow(ctx, rx, baseTopY + maxBearPx + 12, rx, toY(0) + 2, rColor, 1.8, 5.5);

  // q1 / q2 ラベル（狭い底版幅でも左右へ自動逃がしで衝突ゼロ）
  const q1Text = ot.d <= 0 || q1 >= 9990 ? 'q₁=∞' : `q₁=${fmt(q1, 0)}`;
  const q2Text = br.isTriangular && ot.e >= 0 ? '浮上(0)' : (ot.d <= 0 ? '浮上(0)' : `q₂=${fmt(q2, 0)}`);
  const basePxW = toX(B) - toX(0);
  const q1Align = basePxW < 78 ? 'right' : 'left';
  const q1X = basePxW < 78 ? Math.max(40, toX(0) - 2) : Math.max(4, toX(0) - 2);
  const q2Align = basePxW < 78 ? 'left' : 'right';
  const q2X = basePxW < 78 ? Math.min(cssW - 96, toX(B) + 3) : toX(B) + 2;

  drawPillLabel(ctx, q1Text, q1X, baseTopY + h1 + 8, {
    align: q1Align,
    color: br.ok ? '#0f766e' : '#b91c1c',
    bg: 'rgba(255,255,255,0.92)',
    font: '700 9px "Noto Sans JP", "BIZ UDPGothic", sans-serif',
  });

  drawPillLabel(ctx, q2Text, q2X, baseTopY + Math.max(h2, 9) + 8, {
    align: q2Align,
    color: (br.isTriangular && ot.e >= 0) ? '#b91c1c' : '#0f766e',
    bg: 'rgba(255,255,255,0.92)',
    font: '700 9px "Noto Sans JP", "BIZ UDPGothic", sans-serif',
  });

  // 偏心距離 e ラベル（最下部右端に配置し B 寸法・揚圧力と衝突しない）
  drawPillLabel(ctx, `e=${fmt(ot.e, 2)}m`, cssW - 4, cssH - 11, {
    align: 'right',
    color: ot.ok ? '#047857' : '#b91c1c',
    bg: ot.ok ? 'rgba(236, 253, 245, 0.96)' : 'rgba(254, 242, 242, 0.96)',
    border: ot.ok ? '#a7f3d0' : '#fecaca',
    font: '700 9px "Noto Sans JP", "BIZ UDPGothic", sans-serif',
  });

  // 9. 寸法線：全高 H（左側）・底版幅 B（最下部）
  const dimHX = Math.max(16, toX(0) - 22);
  ctx.save();
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(dimHX, toY(H));
  ctx.lineTo(dimHX, toY(0));
  ctx.moveTo(dimHX - 4, toY(H));
  ctx.lineTo(dimHX + 4, toY(H));
  ctx.moveTo(dimHX - 4, toY(0));
  ctx.lineTo(dimHX + 4, toY(0));
  ctx.stroke();
  ctx.restore();

  drawPillLabel(ctx, `H=${fmt(H, 1)}m`, Math.max(24, dimHX), (toY(H) + toY(0)) * 0.5, {
    align: 'center',
    color: '#1e293b',
    bg: 'rgba(248, 250, 252, 0.95)',
    border: '#cbd5e1',
    font: '700 9.5px "Noto Sans JP", "BIZ UDPGothic", sans-serif',
  });

  const dimBY = cssH - 12;
  ctx.save();
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(toX(0), dimBY);
  ctx.lineTo(toX(B), dimBY);
  ctx.moveTo(toX(0), dimBY - 4);
  ctx.lineTo(toX(0), dimBY + 4);
  ctx.moveTo(toX(B), dimBY - 4);
  ctx.lineTo(toX(B), dimBY + 4);
  ctx.stroke();
  ctx.restore();

  drawPillLabel(ctx, `B=${fmt(B, 2)}m`, (toX(0) + toX(B)) * 0.5, dimBY, {
    align: 'center',
    color: '#1e293b',
    bg: 'rgba(248, 250, 252, 0.95)',
    border: '#cbd5e1',
    font: '700 9.5px "Noto Sans JP", "BIZ UDPGothic", sans-serif',
  });

  ctx.restore();
}

// ============================================================================
// 3D ピンラベル投影 ＆ UI パネル回避・相互衝突回避システム
// ============================================================================
function getBlockedUiRects() {
  const rects = [];
  const margin = 8;

  const topEl = dom['topbar'];
  if (topEl) {
    const r = topEl.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      rects.push({
        left: r.left - margin,
        top: r.top - margin,
        right: r.right + margin,
        bottom: r.bottom + margin,
      });
    }
  }

  for (const [panelKey, el] of [['left', dom['panel-left']], ['right', dom['panel-right']]]) {
    if (!state.panels[panelKey] || !el) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      rects.push({
        left: r.left - margin,
        top: r.top - margin,
        right: r.right + margin,
        bottom: r.bottom + margin,
      });
    }
  }
  return rects;
}

function rectsOverlap(a, b, pad = 0) {
  return !(
    a.right + pad <= b.left ||
    a.left - pad >= b.right ||
    a.bottom + pad <= b.top ||
    a.top - pad >= b.bottom
  );
}

function normalizeAnchorList(rawAnchors) {
  if (!rawAnchors) return [];
  const arr = Array.isArray(rawAnchors)
    ? rawAnchors
    : Object.entries(rawAnchors).map(([id, val]) => ({ id, ...(val || {}) }));

  return arr
    .map((a, idx) => {
      if (!a) return null;
      const id = String(a.id ?? a.key ?? `pin-${idx}`);
      const text = String(a.text ?? a.label ?? a.title ?? '').trim();
      if (!text) return null;
      const sub = String(a.subtext ?? a.sub ?? a.value ?? '').trim();
      const tone = String(a.tone ?? a.type ?? a.kind ?? 'structure');
      const priority = typeof a.priority === 'number' ? a.priority : (20 - idx);
      const pos = a.worldPos ?? a.pos ?? a.position ?? null;
      return { id, text, sub, tone, priority, pos, screenX: a.screenX, screenY: a.screenY };
    })
    .filter(Boolean);
}

function projectAnchorToScreen(anchor, viewW, viewH) {
  if (typeof anchor.screenX === 'number' && typeof anchor.screenY === 'number') {
    return { x: anchor.screenX, y: anchor.screenY, visible: true };
  }
  if (!anchor.pos || !scene3d) return { x: 0, y: 0, visible: false };

  if (Array.isArray(anchor.pos) && anchor.pos.length >= 3) {
    projVec.set(anchor.pos[0], anchor.pos[1], anchor.pos[2]);
  } else if (typeof anchor.pos.x === 'number') {
    projVec.set(anchor.pos.x, anchor.pos.y, anchor.pos.z);
  } else {
    return { x: 0, y: 0, visible: false };
  }

  if (typeof scene3d.projectToScreen === 'function') {
    const res = scene3d.projectToScreen(projVec);
    if (res && typeof res.x === 'number') return res;
  }

  const cam = scene3d.camera ?? scene3d.getCameraObject?.() ?? null;
  if (!cam || typeof projVec.project !== 'function') {
    return { x: 0, y: 0, visible: false };
  }

  projVec.project(cam);
  if (projVec.z < -1 || projVec.z > 1) {
    return { x: 0, y: 0, visible: false };
  }

  return {
    x: (projVec.x * 0.5 + 0.5) * viewW,
    y: (-projVec.y * 0.5 + 0.5) * viewH,
    visible: true,
  };
}

function hideAllPinLabels() {
  for (const el of pinDomMap.values()) {
    el.classList.remove('is-visible');
  }
}

function updatePinLabels() {
  if (!dom['label-layer'] || !scene3d || !state.options.showLabels) {
    hideAllPinLabels();
    return;
  }

  const rawAnchors = typeof scene3d.getLabelWorldAnchors === 'function'
    ? scene3d.getLabelWorldAnchors()
    : [];
  const anchors = normalizeAnchorList(rawAnchors);

  if (anchors.length === 0) {
    hideAllPinLabels();
    return;
  }

  const viewW = window.innerWidth;
  const viewH = window.innerHeight;
  const edgePad = 10;
  const blockedRects = getBlockedUiRects();
  const placedRects = [];
  const activeIds = new Set();

  // 優先度降順にソート
  anchors.sort((a, b) => b.priority - a.priority);

  // オフセット試行候補（衝突回避用）
  const offsets = [
    [0, -14],
    [0, -34],
    [0, 14],
    [24, -14],
    [-24, -14],
  ];

  for (const anchor of anchors) {
    activeIds.add(anchor.id);

    let el = pinDomMap.get(anchor.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'pin-label';
      el.innerHTML = '<span class="pin-accent"></span><div class="pin-text-col"><span class="pin-main"></span><span class="pin-sub"></span></div>';
      dom['label-layer'].appendChild(el);
      pinDomMap.set(anchor.id, el);
    }

    el.dataset.tone = anchor.tone;
    const mainSpan = el.querySelector('.pin-main');
    const subSpan = el.querySelector('.pin-sub');
    if (mainSpan.textContent !== anchor.text) mainSpan.textContent = anchor.text;
    if (subSpan.textContent !== anchor.sub) {
      subSpan.textContent = anchor.sub;
      subSpan.style.display = anchor.sub ? '' : 'none';
    }

    const pt = projectAnchorToScreen(anchor, viewW, viewH);
    if (!pt.visible) {
      el.classList.remove('is-visible');
      continue;
    }

    const w = el.offsetWidth || 96;
    const h = el.offsetHeight || 26;
    let chosenRect = null;

    for (const [ox, oy] of offsets) {
      const cx = pt.x + ox;
      const cy = pt.y + oy;
      const candidate = {
        left: cx - w * 0.5,
        top: cy - h * 0.5,
        right: cx + w * 0.5,
        bottom: cy + h * 0.5,
      };

      // ビューポート端チェック
      if (
        candidate.left < edgePad ||
        candidate.top < edgePad ||
        candidate.right > viewW - edgePad ||
        candidate.bottom > viewH - edgePad
      ) {
        continue;
      }

      // UI パネル・トップバーとの重複チェック（完全回避）
      let blocked = false;
      for (const br of blockedRects) {
        if (rectsOverlap(candidate, br, 0)) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;

      // 他ピンラベルとの衝突チェック
      let collided = false;
      for (const pr of placedRects) {
        if (rectsOverlap(candidate, pr, 6)) {
          collided = true;
          break;
        }
      }
      if (collided) continue;

      chosenRect = candidate;
      break;
    }

    if (chosenRect) {
      placedRects.push(chosenRect);
      el.style.transform = `translate3d(${Math.round(chosenRect.left)}px, ${Math.round(chosenRect.top)}px, 0)`;
      el.classList.add('is-visible');
    } else {
      el.classList.remove('is-visible');
    }
  }

  // 不要になった古いピンDOMを掃除
  for (const [id, el] of pinDomMap.entries()) {
    if (!activeIds.has(id)) {
      el.remove();
      pinDomMap.delete(id);
    }
  }
}

// ============================================================================
// コア更新パイプライン（0ms リアルタイム計算 ＆ 3D/2D 同期）
// ============================================================================
function recomputeAndSync() {
  const result = computeWallStability(state.params);
  state.result = result;

  syncControlsFromState();
  updateMonitorUI(state.params, result);

  if (scene3d && typeof scene3d.update === 'function') {
    scene3d.update(state.params, result);
  }

  if (state.panels.right && state.activeMonitorTab === 'overview') {
    drawSectionDiagram2D(dom['diagram2d'], state.params, result);
  }
  return result;
}

function applyPreset(presetId) {
  const preset = Array.isArray(PRESETS)
    ? PRESETS.find((p) => p.id === presetId)
    : null;
  if (!preset) return null;

  state.activePresetId = preset.id;
  state.params = sanitizeParams(extractPresetParams(preset));

  // [M-11] シナリオの注目パラメータがすぐ分かるように左タブを適切に切替・復帰
  if (preset.id === 'waterlog' || preset.id === 'seismic') {
    setControlTab('load');
  } else if (preset.id === 'softsoil') {
    setControlTab('soil');
  } else if (preset.id === 'standard' || preset.id === 'narrow') {
    setControlTab('geom');
  }

  return recomputeAndSync();
}

function setParams(partial, changedKey = null) {
  if (!partial || typeof partial !== 'object') return state.result;
  state.activePresetId = null;
  state.params = sanitizeParams({ ...state.params, ...partial }, changedKey);
  return recomputeAndSync();
}

function setOptions(partial) {
  if (!partial || typeof partial !== 'object') return state.options;
  state.options = { ...state.options, ...partial };
  for (const input of dom.optInputs) {
    const key = input.dataset.opt;
    if (key in state.options) {
      input.checked = Boolean(state.options[key]);
    }
  }
  if (scene3d && typeof scene3d.setOptions === 'function') {
    scene3d.setOptions({ ...state.options });
  }
  if (!state.options.showLabels) {
    hideAllPinLabels();
  }
  return state.options;
}

// ============================================================================
// PNG 書き出し
// ============================================================================
function exportCanvasPng() {
  if (!dom['canvas3d']) return;
  if (scene3d && typeof scene3d.render === 'function') {
    scene3d.render(0);
  }
  try {
    const dataUrl = dom['canvas3d'].toDataURL('image/png');
    const link = document.createElement('a');
    const now = new Date();
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      '-',
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0'),
    ].join('');
    link.download = `retaining-wall-3d-${stamp}.png`;
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch (err) {
    console.warn('PNG保存に失敗しました:', err);
  }
}

// ============================================================================
// イベント結線
// ============================================================================
function bindEvents() {
  // パネル開閉
  dom['btn-toggle-left'].addEventListener('click', () => {
    setPanels({ left: !state.panels.left });
  });
  dom['btn-toggle-right'].addEventListener('click', () => {
    setPanels({ right: !state.panels.right });
  });
  dom['btn-close-left'].addEventListener('click', () => {
    setPanels({ left: false });
  });
  dom['btn-close-right'].addEventListener('click', () => {
    setPanels({ right: false });
  });
  dom['mobile-status-pill'].addEventListener('click', () => {
    setPanels({ right: !state.panels.right });
  });

  // パラメータ初期化（[M-11] 左パネルタブも必ず断面寸法へ復帰）
  dom['btn-reset'].addEventListener('click', () => {
    const hasStandard = Array.isArray(PRESETS) && PRESETS.some((p) => p.id === 'standard');
    if (hasStandard) {
      applyPreset('standard');
    } else {
      state.activePresetId = null;
      state.params = sanitizeParams({ ...DEFAULT_PARAMS });
      setControlTab('geom');
      recomputeAndSync();
    }
  });

  // PNG 保存
  dom['btn-export-png'].addEventListener('click', exportCanvasPng);
  dom['btn-export-png-mobile'].addEventListener('click', exportCanvasPng);

  // カメラプリセット
  for (const btn of dom.camBtns) {
    btn.addEventListener('click', () => {
      setCameraPreset(btn.dataset.cam);
    });
  }

  // 左パネルカテゴリタブ
  for (const btn of dom.ctrlTabs) {
    btn.addEventListener('click', () => {
      setControlTab(btn.dataset.ctrlTab);
    });
  }

  // 右パネル照査タブ
  for (const btn of dom.monTabs) {
    btn.addEventListener('click', () => {
      setMonitorTab(btn.dataset.monTab);
    });
  }

  // スライダー 0ms リアルタイム更新（input イベント）
  for (const input of dom.rangeInputs) {
    input.addEventListener('input', () => {
      const key = input.dataset.param;
      const val = parseFloat(input.value);
      if (!Number.isFinite(val)) return;
      setParams({ [key]: val }, key);
    });
  }

  // ブールパラメータ（底面突起）
  for (const input of dom.boolInputs) {
    input.addEventListener('change', () => {
      const key = input.dataset.param;
      setParams({ [key]: input.checked }, key);
    });
  }

  // 3D 表示トグル
  for (const input of dom.optInputs) {
    input.addEventListener('change', () => {
      const key = input.dataset.opt;
      setOptions({ [key]: input.checked });
    });
  }

  // リサイズ追従
  let wasMobile = isMobileView();
  window.addEventListener('resize', () => {
    if (scene3d && typeof scene3d.resize === 'function') {
      scene3d.resize();
    }
    const nowMobile = isMobileView();
    if (nowMobile !== wasMobile) {
      wasMobile = nowMobile;
      if (nowMobile) {
        state.panels.left = false;
        state.panels.right = false;
      } else {
        state.panels.left = true;
        state.panels.right = true;
      }
      applyPanelState();
    }
    if (state.panels.right && state.activeMonitorTab === 'overview' && state.result) {
      drawSectionDiagram2D(dom['diagram2d'], state.params, state.result);
    }
  });

  // 2D 断面図ラッパーのサイズ変化監視
  if (typeof ResizeObserver !== 'undefined' && dom['diagram2d']?.parentElement) {
    const ro = new ResizeObserver(() => {
      if (state.panels.right && state.activeMonitorTab === 'overview' && state.result) {
        drawSectionDiagram2D(dom['diagram2d'], state.params, state.result);
      }
    });
    ro.observe(dom['diagram2d'].parentElement);
  }
}

// ============================================================================
// メインレンダリングループ
// ============================================================================
function animationLoop(now) {
  rafId = requestAnimationFrame(animationLoop);
  const dt = Math.min(0.05, Math.max(0, (now - lastFrameTime) / 1000));
  lastFrameTime = now;

  if (scene3d && typeof scene3d.render === 'function') {
    scene3d.render(dt);
  }
  updatePinLabels();
}

// ============================================================================
// QA ＆ 録画用グローバル API（SPEC.md 準拠）
// ============================================================================
window.__wallApi = {
  isReady() {
    return Boolean(state.ready);
  },

  setPreset(id) {
    return applyPreset(id);
  },

  setParams(partial) {
    return setParams(partial);
  },

  setOptions(partial) {
    return setOptions(partial);
  },

  setCamera(pos, tgt) {
    if (scene3d && typeof scene3d.setCamera === 'function') {
      scene3d.setCamera(pos, tgt);
      if (typeof scene3d.render === 'function') scene3d.render(0);
      updatePinLabels();
    }
  },

  setCameraPreset(name) {
    setCameraPreset(name);
    if (scene3d && typeof scene3d.render === 'function') scene3d.render(0);
    updatePinLabels();
  },

  setTab(tabName) {
    if (tabName === 'overview' || tabName === 'formulas') {
      setMonitorTab(tabName);
    } else if (tabName === 'geom' || tabName === 'load' || tabName === 'soil') {
      setControlTab(tabName);
    }
  },

  setPanels(next) {
    setPanels(next || {});
    updatePinLabels();
  },

  getState() {
    return {
      ready: state.ready,
      params: { ...state.params },
      options: { ...state.options },
      activePresetId: state.activePresetId,
      activeControlTab: state.activeControlTab,
      activeMonitorTab: state.activeMonitorTab,
      activeCameraPreset: state.activeCameraPreset,
      panels: { ...state.panels },
      result: state.result,
      camera: scene3d && typeof scene3d.getCamera === 'function' ? scene3d.getCamera() : null,
    };
  },
};

// ============================================================================
// 起動シーケンス
// ============================================================================
function boot() {
  cacheDom();
  buildPresetButtons();
  applyPanelState();
  bindEvents();

  scene3d = new RetainingWallScene3D(dom['canvas3d']);
  if (typeof scene3d.setOptions === 'function') {
    scene3d.setOptions({ ...state.options });
  }
  if (typeof scene3d.resize === 'function') {
    scene3d.resize();
  }

  // 初期シナリオ反映
  const hasStandard = Array.isArray(PRESETS) && PRESETS.some((p) => p.id === 'standard');
  if (hasStandard) {
    state.activePresetId = 'standard';
    state.params = sanitizeParams(extractPresetParams(PRESETS.find((p) => p.id === 'standard')));
  }

  recomputeAndSync();
  setCameraPreset('iso_cutaway');

  if (typeof scene3d.render === 'function') {
    scene3d.render(0);
  }
  updatePinLabels();

  state.ready = true;
  lastFrameTime = performance.now();
  rafId = requestAnimationFrame(animationLoop);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
