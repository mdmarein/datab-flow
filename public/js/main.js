/**
 * main.js — Punto de entrada y orquestador del wizard
 * DataB Flow · Cleaning | Transformation | Governance · © 2026 mdmarein · GNU AGPLv3
 */

import { getState, setState, resetSession, rebuildWhitelist, subscribe } from './modules/state.js';
import { parseCSV, toCSV, schemaHash, detectIdColumns } from './modules/parser.js';
import { autoFixEmail } from './modules/validator.js';
import { correctDomain, correctSuffix } from './modules/domains.js';
import { findDuplicates, buildExcluded } from './modules/duplicates.js';
import {
  recordSession, recordColumnPreference,
  recordValidationDecision, recordDomainDecision,
  getSuggestedColumns, shouldSuggestFixType, generateInsights,
  recordCompanyDecisions, getLearnedJunkCompanies, getLearnedCompanyRenames,
  recordStartRowPreference, getStartRowPreference,
} from './modules/learning.js';
import {
  $, esc, show, hide, lock, unlock, toast, setWizardStep, buildWizardBar, _setFlowSteps,
  pct, truncate, syncCheckAll, downloadText, buildFinalRows, providerBadge,
} from './modules/utils.js';
import { BASE_JUNK_COMPANIES, BASE_WHITELIST, FIX_TYPES, FLOW_STEPS, DEFAULT_ENABLED_STEPS } from './modules/config.js';
import { buildJunkSet, isCompanyJunk, applyHomologateRules } from './modules/state.js';
import { buildCountryMaps, detectCountryFromEmail, detectCountryFromPhone, resolveFromColumn, formatPhone } from './modules/country.js';
import { renderStep3, renderStep4, renderStep5, renderStep6, renderStep7, renderStep7NoEmpresa, renderStep8, renderStep8ColSelector, renderStep9, renderStep9Progress, renderStep9ProgressThinking, renderStep10, renderStep10OllamaStatus, renderStep10Progress, renderStep11, renderStep11Progress, renderSummary, renderTestPatternPanel, resetStep8Filter, renderFieldSelect, renderFlowSelect, renderAnalysis, setHomoLibEditorOpen, setTagLibEditorOpen, renderC10ResultsOnly, updateC10ResultRow } from './ui/steps.js';
import { groupTagResults, buildTagValue } from './modules/tags.js';
import { checkOllamaAvailable, extractNameParts, analyzeFieldValues, callAI } from './modules/ai.js';
import { t, applyI18n, LANG } from './modules/i18n.js';
import { openLLMModal, closeLLMModal } from './modules/llm-config.js';
import { openCsvEditor, closeCsvEditor, setFieldSelectRefresh, buildEditorOverlay } from './ui/csv-editor.js';
import {
  broadcastCsvUpdate, sendStateResponse, onEditorReady, onEditorOp, broadcastTheme, broadcastLang,
  broadcastOverlayUpdate,
} from './modules/broadcast.js';
import {
  splitColumn, deleteColumns, addColumn, reorderColumns, renameColumns,
  formatColumn, applySpaces, applyRemoveByPos, applyCase, applyAddText, applyReplace,
  applyCaseValue,
} from './modules/prep.js';
import { kwMatchEmail, kwMatchField } from './modules/keywords.js';
import { parseXLSX } from './modules/xlsx-parser.js';

// ════════════════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════════════════
async function init() {
  // Feedback de carga inmediato
  const dz = document.getElementById('dz');
  if (dz) {
    const dzT = dz.querySelector('.dz-t');
    if (dzT) dzT.textContent = t('import.loading');
  }
  try {
    const res  = await fetch('/api/data', { signal: AbortSignal.timeout(15000) });
    const data = await res.json();
    const rules           = data.rules            || {};
    const dominioDefault  = data.dominioDefault   || {};
    const dominioCustom   = data.dominioCustom    || {};
    const test            = data.test             || {};
    const enterprise      = data.enterprise       || {};
    const learning        = data.learning         || {};

    const flowConfig = data.flowConfig || { version: 1, configs: [] };
    setState({
      defaultDomainRules:      data.domainDefaultRules        || [],
      customRules:             rules.customRules              || [],
      defaultRuleExclusions:   rules.defaultRuleExclusions   || [],
      defaultValidDomains:     dominioDefault.domains        || [],
      defaultValidExclusions:  dominioCustom.exclusions      || [],
      customWL:                dominioCustom.domains         || [],
      testPatterns:         test.patterns?.length       ? test.patterns : ['test'],
      customJunkCompanies:  enterprise.junkCompanies    || [],
      customJunkExclusions: enterprise.junkExclusions   || [],
      homologateRules:      data.homologate?.rules           || [],
      countryData:          (data.country?.countries)         || [],
      fieldLibraries:       _normalizeLibraries(data.fieldHomologated?.libraries || []),
      tagLibraries:         data.fieldTags?.libraries || [],
      learning,
      _flowConfig:          flowConfig,
    });
    _setFlowSteps(FLOW_STEPS);
    buildWizardBar({ ...DEFAULT_ENABLED_STEPS }, {}); // bar inicial con todos habilitados
    rebuildWhitelist();
    renderRules();
    renderWhitelist();
    toast(t('toast.data_loaded'));
  } catch {
    toast(t('toast.server_unavailable'), 'warn');
  } finally {
    if (dz) { const dzT = dz.querySelector('.dz-t'); if (dzT) dzT.textContent = t('import.drag'); }
  }

  setupDropZone();
  setupRulesPanel();
  setupNavButtons();
  _setupEditorBroadcast();
  setFieldSelectRefresh(() => _refreshFieldSelect());

  // Cargar presets de formato del servidor (no bloquea el init)
  fetch('/api/prep-formats').then(r => r.ok ? r.json() : null).then(d => {
    if (d) setState({ prepFormats: d });
  }).catch(() => {});

  // Cargar librería de corrección de terminaciones (no bloquea el init)
  fetch('/api/suffix-rules').then(r => r.ok ? r.json() : null).then(d => {
    if (d) { setState({ suffixRules: d }); renderSuffixList(); }
  }).catch(() => {});
}

// ════════════════════════════════════════════════════════════
//  WEB WORKER — procesamiento pesado fuera del hilo UI
// ════════════════════════════════════════════════════════════
let _worker = null;
let _workerPending = null; // { resolve, reject, expectedType }

function _getWorker() {
  if (_worker) return _worker;
  _worker = new Worker('/js/workers/csv-worker.js', { type: 'module' });
  _worker.onmessage = ({ data }) => {
    if (data.type === 'progress') { _updateWorkerProgress(data.pct); return; }
    if (data.type === 'error') {
      console.error('[worker]', data.step, data.message);
      if (_workerPending) { const rej = _workerPending.reject; _workerPending = null; rej(new Error(data.message)); }
      _hideWorkerProgress();
      return;
    }
    if (_workerPending && data.type === _workerPending.expectedType) {
      const res = _workerPending.resolve; _workerPending = null; res(data.result);
    }
  };
  _worker.onerror = e => {
    console.error('[worker] uncaught:', e);
    if (_workerPending) { const rej = _workerPending.reject; _workerPending = null; rej(new Error(e.message || 'Worker error')); }
    _hideWorkerProgress();
    _worker = null;
  };
  return _worker;
}

function _workerCall(type, payload) {
  return new Promise((resolve, reject) => {
    _workerPending = { resolve, reject, expectedType: type + ':done' };
    _getWorker().postMessage({ type, payload });
  });
}

// Indicador de progreso — esquina inferior derecha
let _progressEl = null;

function _showWorkerProgress(label) {
  if (!_progressEl) {
    _progressEl = document.createElement('div');
    _progressEl.innerHTML = `
      <div id="wp-label" style="font-size:12px;color:var(--t2);margin-bottom:6px"></div>
      <div style="height:3px;background:var(--border);border-radius:2px;overflow:hidden">
        <div id="wp-bar" style="height:100%;background:var(--accent);width:0%;transition:width .15s ease"></div>
      </div>
      <div id="wp-pct" style="font-size:11px;color:var(--t3);margin-top:4px;text-align:right">0%</div>
    `;
    Object.assign(_progressEl.style, {
      position: 'fixed', bottom: '24px', right: '24px', zIndex: '9999',
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: '8px', padding: '10px 14px', minWidth: '200px',
      boxShadow: '0 4px 16px rgba(0,0,0,.25)',
    });
    document.body.appendChild(_progressEl);
  }
  const lbl = _progressEl.querySelector('#wp-label'); if (lbl) lbl.textContent = label;
  const bar = _progressEl.querySelector('#wp-bar');   if (bar) bar.style.width = '0%';
  const pct = _progressEl.querySelector('#wp-pct');   if (pct) pct.textContent = '0%';
  _progressEl.style.display = 'block';
}

function _updateWorkerProgress(pct) {
  if (!_progressEl || _progressEl.style.display === 'none') return;
  const bar = _progressEl.querySelector('#wp-bar');   if (bar) bar.style.width = pct + '%';
  const el  = _progressEl.querySelector('#wp-pct');   if (el)  el.textContent  = pct + '%';
}

function _hideWorkerProgress() {
  if (_progressEl) _progressEl.style.display = 'none';
}

// Helper: serializar whitelistPatterns (RegExp[]) para postMessage
function _serializePatterns(patterns) {
  return patterns.map(rx => ({ source: rx.source, flags: rx.flags }));
}

let _cachedStickyHeader = null;
function _scrollToCard(el, smooth = false) {
  if (!el) return;
  let absTop = 0;
  let node = el;
  while (node) { absTop += node.offsetTop; node = node.offsetParent; }
  if (!_cachedStickyHeader) _cachedStickyHeader = document.querySelector('.sticky-top');
  const offset = _cachedStickyHeader ? _cachedStickyHeader.offsetHeight + 8 : 8;
  const target = Math.max(0, absTop - offset);
  if (smooth) {
    window.scrollTo({ top: target, behavior: 'smooth' });
  } else {
    window.scrollTo(window.scrollX, target);
  }
}

// ════════════════════════════════════════════════════════════
//  DROP ZONE — PASO 1
// ════════════════════════════════════════════════════════════
function setupDropZone() {
  const dz = $('dz');
  const fi = $('fi');

  dz.addEventListener('click', () => fi.click());
  fi.addEventListener('change', e => { if (e.target.files[0]) loadFile(e.target.files[0]); });
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', e => {
    e.preventDefault(); dz.classList.remove('over');
    if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
  });
  // Encoding selector — re-parsea el archivo con el encoding elegido
  $('encsel')?.addEventListener('change', e => {
    const { _rawBuf } = getState();
    if (!_rawBuf) return;
    _applyEncoding(_rawBuf, e.target.value, null, false);
  });
  // From-row spinner — cambia la fila usada como header
  $('from-row-up')?.addEventListener('click', () => {
    const cur = parseInt($('from-row-val')?.value || '1');
    _applyStartRow(cur + 1);
  });
  $('from-row-down')?.addEventListener('click', () => {
    const cur = parseInt($('from-row-val')?.value || '1');
    _applyStartRow(cur - 1);
  });
  $('from-row-val')?.addEventListener('change', e => {
    _applyStartRow(parseInt(e.target.value) || 1);
  });
  // Muestra buttons (import preview) — re-renderiza la tabla con la cantidad elegida
  $('prevcnt')?.addEventListener('click', e => {
    const btn = e.target.closest('.fb[data-val]');
    if (!btn) return;
    $('prevcnt').querySelectorAll('.fb').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    const { csv } = getState();
    if (csv) _renderCsvPreview(csv);
  });

  // btn-next1 y btn-back1 wired in setupNavButtons()
}

function _detectEncoding(buf) {
  const bytes = new Uint8Array(buf);
  if (bytes[0] === 0xFF && bytes[1] === 0xFE) return 'utf-16le';
  if (bytes[0] === 0xFE && bytes[1] === 0xFF) return 'utf-16be';
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    if (!text.includes('�')) return 'utf-8';
  } catch { /* fall through */ }
  return 'windows-1252';
}

function _decodeBuffer(buf, encKey) {
  let text = new TextDecoder(encKey).decode(buf);
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  return text;
}

const _ENC_LABELS = {
  'utf-8': 'UTF-8', 'windows-1252': 'Windows-1252', 'iso-8859-1': 'ISO-8859-1',
  'utf-16le': 'UTF-16 LE', 'utf-16be': 'UTF-16 BE', 'macintosh': 'Mac Roman',
};

function _scoreHeaderRow(row) {
  const FIELD_PATTERNS = [
    /email|mail|correo/i,
    /^nombres?$|^first.?names?$|^names?$/i,
    /^apellidos?$|^last.?names?$|^surnames?$/i,
    /empresa|compan[yi]|raz[oó]n.{0,8}social|negocio|organiz/i,
    /^tel[eé]?f?|^phone|^cel|whatsapp/i,
    /^pa[ií]s(\b|\s|$)|^country(\b|\s|$)/i,
  ];
  return row.filter(cell => FIELD_PATTERNS.some(p => p.test((cell || '').trim()))).length;
}

const _filenameKey = f => (f || '').toLowerCase().replace(/\.[^.]+$/, '').trim();

function _applyStartRow(n) {
  n = Math.max(1, Math.min(999, isNaN(n) ? 1 : n));  // display: 1-based (min=1)
  const frv = $('from-row-val');
  if (frv) frv.value = n;
  const autoLbl = $('from-row-auto');
  if (autoLbl) autoLbl.style.display = 'none';
  setState({ csvStartRow: n - 1 });  // estado: 0-based
  const { _rawBuf, _detectedEncoding, filename, learning } = getState();
  if (_rawBuf) _applyEncoding(_rawBuf, _detectedEncoding, null, true);
  // Recordar preferencia de fila por nombre de archivo
  if (filename) {
    const key = _filenameKey(filename);
    const updatedLearning = {
      ...(learning || {}),
      startRowPreferences: { ...(learning?.startRowPreferences || {}), [key]: { row: n - 1, ts: Date.now() } },
    };
    setState({ learning: updatedLearning });
    recordStartRowPreference(key, n - 1);
  }
}

function _applyEncoding(buf, encKey, filename, updateCols) {
  const text = _decodeBuffer(buf, encKey);
  let startRow = getState().csvStartRow || 0;

  if (filename !== null) {
    // New file — check learned preference first, then auto-detect
    const { learning } = getState();
    const learnedRow = getStartRowPreference(learning, _filenameKey(filename));
    if (learnedRow !== null) {
      startRow = learnedRow;
    } else {
      const rawParse   = parseCSV(text, 0);
      const candidates = [rawParse.headers, ...rawParse.rows.slice(0, 19)];
      let bestIdx = 0, bestScore = _scoreHeaderRow(candidates[0]);
      for (let i = 1; i < candidates.length; i++) {
        const s = _scoreHeaderRow(candidates[i]);
        if (s > bestScore) { bestScore = s; bestIdx = i; }
      }
      startRow = bestScore >= 1 ? bestIdx : 0;
    }
    setState({ csvStartRow: startRow });
    const frv = $('from-row-val');
    if (frv) frv.value = startRow + 1;  // display 1-based
    const autoLbl = $('from-row-auto');
    if (autoLbl) autoLbl.style.display = startRow > 0 ? '' : 'none';
  }

  const csv = parseCSV(text, startRow);
  if (!csv.headers.length) { toast(t('toast.read_error'), 'error'); return; }
  setState({ csv, _rawBuf: buf, _detectedEncoding: encKey });
  if (updateCols) {
    const hdrT = csv.headers.map(h => h.trim());
    const autoI = hdrT.findIndex(h => /email|mail|correo/i.test(h));
    const colIdx = autoI >= 0 ? autoI : 0;
    // _hasData: no auto-matchear columnas vacías
    const _hasData = i => i >= 0 && csv.rows.some(r => (r[i] || '').trim());
    const confirmedNombreIdx   = hdrT.findIndex(h => /^nombres?$|^first.?names?$|^names?$/i.test(h));
    const confirmedApellidoIdx = hdrT.findIndex(h => /^apellidos?$|^last.?names?$|^surnames?$/i.test(h));
    const confirmedEmpresaIdx  = hdrT.findIndex(h => /empresa[s]?|raz[oó]n\s*(?:de\s*)?social|nombre.{0,20}fant[aá]s[ií]a?|compan(?:y|ies?)(?:\s*name)?|business(?:\s*name)?|\borganiz|\bnegocio/i.test(h));
    const confirmedTelIdx      = hdrT.findIndex(h => /^tel[eé]?f?|^phone|^cel|whatsapp/i.test(h));
    const confirmedPaisIdx     = hdrT.findIndex(h => /^pa[ií]s(\b|\s|$)|^country(\b|\s|$)/i.test(h));
    const _h = csv.headers;
    const _g = i => _hasData(i) ? i : -1;
    setState({ colIdx, emailColName: _h[colIdx] || null,
      confirmedNombreIdx:   _g(confirmedNombreIdx),
      confirmedApellidoIdx: _g(confirmedApellidoIdx),
      confirmedEmpresaIdx:  _g(confirmedEmpresaIdx),
      confirmedTelIdx:      _g(confirmedTelIdx),
      confirmedPaisIdx:     _g(confirmedPaisIdx),
      confirmedNombreColName:   _g(confirmedNombreIdx)   >= 0 ? _h[confirmedNombreIdx]   : null,
      confirmedApellidoColName: _g(confirmedApellidoIdx) >= 0 ? _h[confirmedApellidoIdx] : null,
      confirmedEmpresaColName:  _g(confirmedEmpresaIdx)  >= 0 ? _h[confirmedEmpresaIdx]  : null,
      confirmedTelColName:      _g(confirmedTelIdx)      >= 0 ? _h[confirmedTelIdx]      : null,
      confirmedPaisColName:     _g(confirmedPaisIdx)     >= 0 ? _h[confirmedPaisIdx]     : null,
      _userClearedPais: false,
      _userClearedTel:  false,
    });
  } else {
    // Re-encoding: recompute colIdx from emailColName (structure unchanged)
    const { emailColName } = getState();
    if (emailColName) {
      const idx = csv.headers.indexOf(emailColName);
      if (idx >= 0) setState({ colIdx: idx });
    }
  }
  _renderCsvPreview(csv);
  return csv;
}

function _populateColSel(csv) {
  const sel = $('colsel');
  if (!sel || !csv) return;
  const { emailColName, editorDeletedCols, editorAddedCols } = getState();
  sel.innerHTML = '';
  csv.headers.forEach((h, i) => {
    const opt  = document.createElement('option');
    const name = h.trim() || `Col ${i + 1}`;
    if (editorDeletedCols?.has(h)) {
      opt.textContent = `✎ DEL · ${name}`;
      opt.style.color = 'var(--red, #f87171)';
    } else if (editorAddedCols?.has(h)) {
      opt.textContent = `✎ ADD · ${name}`;
      opt.style.color = 'var(--warn, #f59e0b)';
    } else {
      opt.textContent = name;
    }
    opt.value = i;
    sel.appendChild(opt);
  });
  const nameIdx = emailColName ? csv.headers.indexOf(emailColName) : -1;
  sel.value = nameIdx >= 0 ? nameIdx : 0;
  setState({ colIdx: parseInt(sel.value) });
  _autoSizeSelect(sel);
  _populateExtraColSels(csv);
}

function _autoSizeSelect(sel) {
  if (!sel) return;
  const text = sel.options[sel.selectedIndex]?.text || '';
  const sizer = document.createElement('span');
  sizer.style.cssText = 'position:fixed;top:-9999px;font-size:12px;padding:3px 6px;white-space:nowrap;visibility:hidden';
  sizer.textContent = text;
  document.body.appendChild(sizer);
  sel.style.width = Math.max(60, sizer.offsetWidth + 30) + 'px';
  document.body.removeChild(sizer);
}

function _populateExtraColSels(csv) {
  if (!csv) return;
  const { confirmedNombreIdx, confirmedApellidoIdx, confirmedEmpresaIdx, confirmedTelIdx } = getState();
  const noneOpt = `<option value="-1">— Ninguno —</option>`;
  const allOpts = csv.headers.map((h, i) =>
    `<option value="${i}">${h.trim() || `Col ${i + 1}`}</option>`
  ).join('');
  [
    ['sel-nombre',   confirmedNombreIdx],
    ['sel-apellido', confirmedApellidoIdx],
    ['sel-empresa',  confirmedEmpresaIdx],
    ['sel-tel',      confirmedTelIdx],
  ].forEach(([id, val]) => {
    const el = $(id);
    if (!el) return;
    el.innerHTML = noneOpt + allOpts;
    el.value = (val != null && val >= 0) ? val : -1;
    _autoSizeSelect(el);
  });
}

function loadFile(file) {
  const isXlsx = /\.xlsx$/i.test(file.name);
  if (!isXlsx && !/\.(csv|tsv)$/i.test(file.name)) { toast(t('toast.csv_only'), 'warn'); return; }
  const mb = file.size / 1024 / 1024;
  if (mb > 50) toast(t('import.file_large', mb.toFixed(1)), 'warn');
  else if (mb > 20) toast(t('import.file_medium', mb.toFixed(1)), 'warn');
  const reader = new FileReader();
  reader.onload = async e => {
    const buf = e.target.result;

    if (isXlsx) {
      let result;
      try { result = await parseXLSX(buf); }
      catch (err) { toast(err.message || t('toast.read_error'), 'error'); return; }

      const { headers, rows, sep, sheetName } = result;
      const csv = { headers, rows, sep };
      if (!headers.length) { toast(t('toast.read_error'), 'error'); return; }

      // Detección de columnas — misma lógica que _applyEncoding(updateCols=true)
      const hdrT = headers.map(h => h.trim());
      const autoI = hdrT.findIndex(h => /email|mail|correo/i.test(h));
      const colIdx = autoI >= 0 ? autoI : 0;
      const _hasData = i => i >= 0 && rows.some(r => (r[i] || '').trim());
      const nIdx  = hdrT.findIndex(h => /^nombres?$|^first.?names?$|^names?$/i.test(h));
      const aIdx  = hdrT.findIndex(h => /^apellidos?$|^last.?names?$|^surnames?$/i.test(h));
      const eIdx  = hdrT.findIndex(h => /empresa[s]?|raz[oó]n\s*(?:de\s*)?social|nombre.{0,20}fant[aá]s[ií]a?|compan(?:y|ies?)(?:\s*name)?|business(?:\s*name)?|\borganiz|\bnegocio/i.test(h));
      const tIdx  = hdrT.findIndex(h => /^tel[eé]?f?|^phone|^cel|whatsapp/i.test(h));
      const pIdx  = hdrT.findIndex(h => /^pa[ií]s(\b|\s|$)|^country(\b|\s|$)/i.test(h));
      const _g = i => _hasData(i) ? i : -1;
      setState({
        csv, filename: file.name, selectedColumns: null, selectedColumnNames: null,
        csvStartRow: 0, _rawBuf: null, _detectedEncoding: null,
        colIdx, emailColName: headers[colIdx] || null,
        confirmedNombreIdx:        _g(nIdx),
        confirmedApellidoIdx:      _g(aIdx),
        confirmedEmpresaIdx:       _g(eIdx),
        confirmedTelIdx:           _g(tIdx),
        confirmedPaisIdx:          _g(pIdx),
        confirmedNombreColName:    _g(nIdx)  >= 0 ? headers[nIdx]  : null,
        confirmedApellidoColName:  _g(aIdx)  >= 0 ? headers[aIdx]  : null,
        confirmedEmpresaColName:   _g(eIdx)  >= 0 ? headers[eIdx]  : null,
        confirmedTelColName:       _g(tIdx)  >= 0 ? headers[tIdx]  : null,
        confirmedPaisColName:      _g(pIdx)  >= 0 ? headers[pIdx]  : null,
      });

      // Encoding selector: no aplica para XLSX
      const encSel = $('encsel');
      if (encSel) { encSel.value = 'utf-8'; encSel.disabled = true; }
      const frv = $('from-row-val');
      if (frv) frv.value = 1;
      const autoLbl = $('from-row-auto');
      if (autoLbl) autoLbl.style.display = 'none';

      $('fchip').textContent = file.name;
      show('cfg1'); hide('dz');
      _renderCsvPreview(csv);
      _checkFilenameMatch(file.name);
      toast(t('import.rows_loaded_xlsx', rows.length, headers.length, sheetName));
      return;
    }

    // ── CSV / TSV ────────────────────────────────────────────────
    const encKey = _detectEncoding(buf);
    const csv    = _applyEncoding(buf, encKey, file.name, true);
    if (!csv) return;

    const encSel = $('encsel');
    if (encSel) { encSel.value = encKey; encSel.disabled = false; }

    const sepLabel = csv.sep === '\t' ? 'TSV·tab' : csv.sep === ';' ? 'CSV·punto y coma' : 'CSV·coma';
    setState({ filename: file.name, selectedColumns: null, selectedColumnNames: null });
    $('fchip').textContent = file.name;
    show('cfg1'); hide('dz');
    _checkFilenameMatch(file.name);
    toast(t('import.rows_loaded', csv.rows.length, csv.headers.length, sepLabel, _ENC_LABELS[encKey] || encKey));
  };
  reader.readAsArrayBuffer(file);
}

function _renderCsvPreview(csv) {
  const tbl = $('csv-prev-table');
  const more = $('csv-prev-more');
  if (!tbl) return;
  const cols = csv.headers;
  const maxStr = $('prevcnt')?.querySelector('.fb.on')?.dataset.val ?? '4';
  const maxRows = parseInt(maxStr, 10) || Infinity;

  // Columnas vacías en TODO el CSV
  const emptyCol = cols.map((_, i) => csv.rows.every(row => !(row[i] || '').trim()));
  const limit = isFinite(maxRows) ? maxRows : csv.rows.length;
  const displayRows = csv.rows.slice(0, limit);
  const rowIdxMap = new Map(csv.rows.map((r, i) => [r, i + 1]));
  const numTh = `<th style="white-space:nowrap;color:var(--t2);text-align:right;padding-right:8px">#</th>`;
  const thead = `<thead style="position:sticky;top:0;z-index:10"><tr>${numTh}${cols.map((h, i) =>
    `<th style="white-space:nowrap;color:${emptyCol[i] ? '#3B3B3B' : 'var(--t15)'}">${esc(h || '—')}</th>`
  ).join('')}</tr></thead>`;
  const tbody = `<tbody>${displayRows.map(row => {
    const num = rowIdxMap.get(row) ?? '';
    const numTd = `<td style="white-space:nowrap;color:var(--t2);text-align:right;padding-right:8px;font-variant-numeric:tabular-nums">${num}</td>`;
    return `<tr>${numTd}${cols.map((_, i) => { const v = (row[i] || '').trim().slice(0, 40); return `<td style="white-space:nowrap;color:${v ? '#A0A0A0' : '#3B3B3B'}">${v ? esc(v) : '—'}</td>`; }).join('')}</tr>`;
  }).join('')}</tbody>`;
  tbl.innerHTML = thead + tbody;
  if (more) more.textContent = t('res.total_rows', csv.rows.length);
  show('csv-preview1');
}

function _checkFilenameMatch(filename) {
  const { _flowConfig } = getState();
  if (!_flowConfig?.configs?.length) return;
  const tokenize = s => s.toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(t => t.length > 1);
  const ta = new Set(tokenize(filename));
  let bestMatch = null, bestScore = 0;
  _flowConfig.configs.forEach(cfg => {
    const tb = new Set(tokenize(cfg.pattern));
    const intersection = [...ta].filter(t => tb.has(t)).length;
    const union = new Set([...ta, ...tb]).size;
    const score = union > 0 ? intersection / union : 0;
    if (score > bestScore && score >= 0.4) { bestScore = score; bestMatch = cfg; }
  });
  if (bestMatch) {
    if (bestMatch.enabledSteps) setState({ enabledSteps: { ...DEFAULT_ENABLED_STEPS, ...bestMatch.enabledSteps } });
    if (bestMatch.selectedColumns) {
      setState({ selectedColumns: bestMatch.selectedColumns });
      const { csv: _rc } = getState();
      if (_rc) {
        const names = bestMatch.selectedColumns.map(i => _rc.headers[i]).filter(Boolean);
        setState({ selectedColumnNames: names });
      }
    }
    if (bestMatch.fieldAssignments) setState({ fieldAssignments: bestMatch.fieldAssignments });
    buildWizardBar(getState().enabledSteps, {});
    toast(t('misc.config_restored', bestMatch.pattern));
  }
}

async function _saveFlowConfig() {
  const { filename, enabledSteps, selectedColumns, fieldAssignments, _flowConfig } = getState();
  if (!filename) return;
  const configs = _flowConfig?.configs || [];
  const existing = configs.findIndex(c => c.pattern === filename);
  const entry = {
    pattern: filename,
    enabledSteps,
    selectedColumns: selectedColumns || null,
    fieldAssignments: Object.keys(fieldAssignments || {}).length ? fieldAssignments : null,
  };
  const updated = existing >= 0 ? configs.map((c, i) => i === existing ? entry : c) : [...configs, entry];
  const newConfig = { version: 1, configs: updated.slice(-30) };
  setState({ _flowConfig: newConfig });
  await fetch('/api/flow-config', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(newConfig),
  }).catch(() => {});
}

// ════════════════════════════════════════════════════════════
//  SETUP — SELECCIÓN DE CAMPOS Y FLUJO
// ════════════════════════════════════════════════════════════
function _fieldColIdxs() {
  const { confirmedNombreIdx: nombre, confirmedApellidoIdx: apellido,
          confirmedEmpresaIdx: empresa, confirmedTelIdx: tel, confirmedPaisIdx: pais } = getState();
  return { nombre: nombre ?? -1, apellido: apellido ?? -1, empresa: empresa ?? -1, tel: tel ?? -1, pais: pais ?? -1 };
}

function _onAssignColumn(colIdx, fieldKey) {
  if (fieldKey === null) {
    const { confirmedNombreIdx, confirmedApellidoIdx, confirmedEmpresaIdx, confirmedTelIdx, confirmedPaisIdx, colIdx: emailIdx } = getState();
    if (colIdx === emailIdx)             setState({ colIdx: -1, emailColName: null });
    if (colIdx === confirmedNombreIdx)   setState({ confirmedNombreIdx:   -1, confirmedNombreColName:   null });
    if (colIdx === confirmedApellidoIdx) setState({ confirmedApellidoIdx: -1, confirmedApellidoColName: null });
    if (colIdx === confirmedEmpresaIdx)  setState({ confirmedEmpresaIdx:  -1, confirmedEmpresaColName:  null });
    if (colIdx === confirmedTelIdx)      setState({ confirmedTelIdx:  -1, confirmedTelColName:  null, _userClearedTel:  true });
    if (colIdx === confirmedPaisIdx)     setState({ confirmedPaisIdx: -1, confirmedPaisColName: null, _userClearedPais: true });
  } else if (fieldKey === 'email') {
    const { csv } = getState();
    setState({ colIdx, emailColName: csv?.headers[colIdx] ?? null });
  } else {
    const { csv } = getState();
    const keyMap  = { nombre: 'confirmedNombreIdx', apellido: 'confirmedApellidoIdx', empresa: 'confirmedEmpresaIdx', tel: 'confirmedTelIdx', pais: 'confirmedPaisIdx' };
    const nameMap = { nombre: 'confirmedNombreColName', apellido: 'confirmedApellidoColName', empresa: 'confirmedEmpresaColName', tel: 'confirmedTelColName', pais: 'confirmedPaisColName' };
    const clearFlags = fieldKey === 'pais' ? { _userClearedPais: false }
                     : fieldKey === 'tel'  ? { _userClearedTel:  false }
                     : {};
    setState({ [keyMap[fieldKey]]: colIdx, [nameMap[fieldKey]]: csv?.headers[colIdx] ?? null, ...clearFlags });
  }
  _refreshFieldSelect();
}

function _emptyColCount(csv) {
  return csv.headers.filter((_, i) => csv.rows.every(row => !(row[i] || '').trim())).length;
}

function _refreshFieldSelect() {
  const { csv, colIdx, selectedColumns } = getState();
  if (!csv) return;
  renderFieldSelect(csv, colIdx, selectedColumns, _fieldColIdxs(), cols => {
    const names = cols ? cols.map(i => csv.headers[i]) : null;
    setState({ selectedColumns: cols, selectedColumnNames: names });
    const locked = cols === null ? _emptyColCount(csv) : csv.headers.length - cols.length;
    $('si-fields').textContent = locked > 0 ? t('fields.excluded_n', locked) : t('fields.all_included');
  }, _onAssignColumn);
}

function goFieldSelect() {
  const { csv } = getState();
  _populateColSel(csv);
  setWizardStep('fields');
  show('c-fields'); unlock('c-fields');
  const { selectedColumns } = getState();
  _refreshFieldSelect();
  const locked = selectedColumns ? csv.headers.length - selectedColumns.length : _emptyColCount(csv);
  $('si-fields').textContent = locked > 0 ? t('fields.excluded_n', locked) : t('fields.all_included');
  _scrollToCard($('c-fields'));
}

function goFlowSelect() {
  const { enabledSteps } = getState();
  setState({ omittedSteps: {} }); // reset mid-flow omissions when re-entering flow selection
  setWizardStep('flow');
  show('c-flow'); unlock('c-flow');
  renderFlowSelect(enabledSteps, (stepId, enabled) => {
    const curr = getState().enabledSteps;
    const ids = Array.isArray(stepId) ? stepId : [stepId];
    const updated = { ...curr, ...Object.fromEntries(ids.map(id => [id, enabled])) };
    setState({ enabledSteps: updated });
    buildWizardBar(updated, {});
    _updateFlowSummary(updated);
  });
  _updateFlowSummary(enabledSteps);
  _scrollToCard($('c-flow'));
}

function _updateFlowSummary(enabledSteps) {
  const emailActive = FLOW_STEPS.filter(s => s.group === 'email').some(s => enabledSteps[s.id] !== false) ? 1 : 0;
  const otherActive = FLOW_STEPS.filter(s => s.group !== 'email' && enabledSteps[s.id] !== false).length;
  const active = emailActive + otherActive;
  const total  = 1 + FLOW_STEPS.filter(s => s.group !== 'email').length;
  $('si-flow').textContent = t('flow.modules_active', active, total);
}

// ════════════════════════════════════════════════════════════
//  ANÁLISIS CSV — diagnóstico previo al flujo
// ════════════════════════════════════════════════════════════
function runCsvAnalysis() {
  const {
    csv, colIdx, customRules, defaultDomainRules, whitelist, whitelistPatterns,
    testPatterns, customJunkCompanies, customJunkExclusions, learning,
    defaultRuleExclusions,
  } = getState();
  const learnedPatterns = learning?.learnedPatterns || [];

  const total = csv.rows.filter(r => r.some(c => (c||'').trim())).length;

  // Detección de columnas (preferir confirmación del usuario sobre auto-detección)
  const hdr = csv.headers.map(h => (h||'').toLowerCase());
  const { confirmedNombreIdx, confirmedApellidoIdx, confirmedEmpresaIdx, confirmedTelIdx, confirmedPaisIdx: _cPaisA } = getState();
  const empresaIdx  = (confirmedEmpresaIdx  != null) ? confirmedEmpresaIdx  : hdr.findIndex(h => /empresa[s]?|raz[oó]n\s*(?:de\s*)?social|nombre.{0,20}fant[aá]s[ií]a?|compan(?:y|ies?)(?:\s*name)?|business(?:\s*name)?|\borganiz|\bnegocio/i.test(h));
  const paisIdx     = (_cPaisA != null) ? _cPaisA : hdr.findIndex(h => /^pa[ií]s(\b|\s|$)|^country(\b|\s|$)/i.test(h));
  const telIdx      = (confirmedTelIdx      != null) ? confirmedTelIdx      : hdr.findIndex(h => /^tel[eé]?f?|^phone|^cel|whatsapp/i.test(h));
  const nombreIdx   = (confirmedNombreIdx   != null) ? confirmedNombreIdx   : hdr.findIndex(h => /^nombres?$|^first.?names?$|^names?$/i.test(h.trim()));
  const apellidoIdx = (confirmedApellidoIdx != null) ? confirmedApellidoIdx : hdr.findIndex(h => /^apellidos?$|^last.?names?$|^surnames?$/i.test(h.trim()));
  const tagColIdx   = hdr.findIndex(h => /^tags?$|^etiquetas?$|^etiqueta$/i.test(h.trim()));

  // F1.2 — Set hoisted fuera del loop (antes: se creaba una vez por fila)
  const excludedDefaults = new Set(defaultRuleExclusions);

  // F1.1 — Setup empresa junk hoisted fuera del loop
  const pats = testPatterns.length > 0 ? testPatterns : ['test'];
  let exactJunkSet, junkPatterns;
  if (empresaIdx >= 0) {
    const learnedJunk = learning?.learnedJunkCompanies || [];
    ({ exactSet: exactJunkSet, patterns: junkPatterns } = buildJunkSet(customJunkCompanies, learnedJunk, customJunkExclusions));
  }

  const affectedRows = new Set();

  // F1.1 — PASADA ÚNICA: email + keywords + empresa + país/tel + nombre/apellido
  let emailFormat = 0, emailDomain = 0;
  let keywords = 0;
  let empresaEmpty = 0, empresaJunk = 0;
  let emptyPais = 0, totalTel = 0;
  let nombreEmpty = 0, apellidoEmpty = 0;

  for (let ri = 0; ri < csv.rows.length; ri++) {
    const row = csv.rows[ri];
    if (!row.some(c => (c||'').trim())) continue;

    const val = (row[colIdx] || '').trim();

    // Email: formato + dominio
    if (val) {
      if (autoFixEmail(val, {}).issues.length) { emailFormat++; affectedRows.add(ri); }
      if (correctDomain(val, whitelist, customRules, learnedPatterns, whitelistPatterns, excludedDefaults, defaultDomainRules)) { emailDomain++; affectedRows.add(ri); }
    }

    // Palabras clave (mismo criterio que el paso real: email + nombre/apellido/empresa)
    const kwMatch = (val && kwMatchEmail(val, pats))
      || (nombreIdx   >= 0 && kwMatchField((row[nombreIdx]   || '').trim(), pats))
      || (apellidoIdx >= 0 && kwMatchField((row[apellidoIdx] || '').trim(), pats))
      || (empresaIdx  >= 0 && kwMatchField((row[empresaIdx]  || '').trim(), pats));
    if (kwMatch) { keywords++; affectedRows.add(ri); }

    // Empresa vacía + junk
    if (empresaIdx >= 0) {
      const empresa = (row[empresaIdx] || '').trim();
      if (!empresa) { empresaEmpty++; affectedRows.add(ri); }
      else if (isCompanyJunk(empresa.toLowerCase().normalize('NFC'), exactJunkSet, junkPatterns)) { empresaJunk++; affectedRows.add(ri); }
    }

    // País / Teléfono
    if (paisIdx >= 0 && !(row[paisIdx] || '').trim()) { emptyPais++; affectedRows.add(ri); }
    if (telIdx  >= 0 &&  (row[telIdx]  || '').trim()) { totalTel++;  affectedRows.add(ri); }

    // Nombre / Apellido (solo si tiene email)
    if (val) {
      if (nombreIdx   >= 0 && !(row[nombreIdx]   || '').trim()) { nombreEmpty++;  affectedRows.add(ri); }
      if (apellidoIdx >= 0 && !(row[apellidoIdx] || '').trim()) { apellidoEmpty++; affectedRows.add(ri); }
    }
  }

  // Duplicados (separado — usa Map interno O(n))
  const dupGroups = findDuplicates(csv, colIdx, new Set([colIdx]), [], []);
  const duplicates = dupGroups.reduce((acc, g) => acc + g.rows.length - 1, 0);
  // F1.5 — for loop en lugar de slice(1)
  for (const g of dupGroups) {
    for (let i = 1; i < g.rows.length; i++) affectedRows.add(g.rows[i].rowIdx);
  }

  // Homologación — F1.3: sampling si hay más de 5000 filas
  const _excludeIdxs = new Set([colIdx, empresaIdx, paisIdx, telIdx, nombreIdx, apellidoIdx].filter(i => i >= 0));
  let homolCols = 0, homolUniqueTotal = 0;
  const HOMOL_SAMPLE = 5000;
  const sampleRows = csv.rows.length > HOMOL_SAMPLE
    ? (() => {
        const step = Math.ceil(csv.rows.length / HOMOL_SAMPLE);
        const out = [];
        for (let i = 0; i < csv.rows.length; i += step) out.push(csv.rows[i]);
        return out;
      })()
    : csv.rows;

  csv.headers.forEach((_, hi) => {
    if (_excludeIdxs.has(hi)) return;
    const vals = [...new Set(
      sampleRows.map(r => (r[hi] || '').trim()).filter(v => v && !/^\d+([.,]\d+)?$/.test(v))
    )];
    if (vals.length < 3) return;
    const wordFreq = {};
    vals.forEach(v => {
      new Set(v.toLowerCase().normalize('NFC').split(/[\s\-_,/]+/).filter(w => w.length > 2)).forEach(w => {
        wordFreq[w] = (wordFreq[w] || 0) + 1;
      });
    });
    if (Object.values(wordFreq).some(c => c >= 2)) { homolCols++; homolUniqueTotal += vals.length; }
  });

  const tagColName = tagColIdx >= 0 ? csv.headers[tagColIdx] : null;
  const stats = {
    total, emailFormat, emailDomain, duplicates, keywords,
    company:  { hasCol: empresaIdx  >= 0, total: empresaEmpty + empresaJunk, empty: empresaEmpty, junk: empresaJunk },
    country:  { hasCol: paisIdx     >= 0, emptyPais },
    phone:    { hasCol: telIdx      >= 0, totalTel  },
    nombre:   { hasCol: nombreIdx   >= 0, empty: nombreEmpty   },
    apellido: { hasCol: apellidoIdx >= 0, empty: apellidoEmpty },
    homolog:  { cols: homolCols, uniqueTotal: homolUniqueTotal },
    tagCol:   { hasCol: tagColIdx   >= 0, colName: tagColName },
  };
  stats.fixTotal    = affectedRows.size;
  stats.okTotal     = Math.max(0, total - affectedRows.size);
  stats.issuesTotal = emailFormat + emailDomain + duplicates + keywords +
    (empresaEmpty + empresaJunk) + emptyPais + totalTel + nombreEmpty + apellidoEmpty;

  const suggested = {
    rules:      false,
    validation: emailFormat > 0,
    domains:    emailDomain > 0,
    duplicates: duplicates  > 0,
    keywords:   keywords    > 0,
    company:    stats.company.hasCol && stats.company.total > 0,
    country:    (stats.country.hasCol || stats.phone.hasCol) && (emptyPais > 0 || totalTel > 0),
    fieldhomol: homolCols > 0,
    nameai:     (stats.nombre.hasCol || stats.apellido.hasCol) && (nombreEmpty + apellidoEmpty > 0),
    fieldtags:  tagColIdx >= 0,
  };

  return { stats, suggested };
}

async function goAnalysis() {
  const {
    csv, colIdx, customRules, defaultDomainRules, whitelist, whitelistPatterns,
    testPatterns, customJunkCompanies, customJunkExclusions, learning, defaultRuleExclusions,
  } = getState();

  // Extraer solo las columnas necesarias para minimizar la transferencia al worker
  const hdr = csv.headers.map(h => (h||'').toLowerCase());
  const { confirmedNombreIdx: _cNom, confirmedApellidoIdx: _cApe, confirmedEmpresaIdx: _cEmp, confirmedTelIdx: _cTel, confirmedPaisIdx: _cPais } = getState();
  const empresaIdx  = (_cEmp  != null) ? _cEmp  : hdr.findIndex(h => /empresa[s]?|raz[oó]n\s*(?:de\s*)?social|nombre.{0,20}fant[aá]s[ií]a?|compan(?:y|ies?)(?:\s*name)?|business(?:\s*name)?|\borganiz|\bnegocio/i.test(h));
  const paisIdx     = (_cPais != null) ? _cPais : hdr.findIndex(h => /^pa[ií]s(\b|\s|$)|^country(\b|\s|$)/i.test(h));
  const telIdx      = (_cTel  != null) ? _cTel  : hdr.findIndex(h => /^tel[eé]?f?|^phone|^cel|whatsapp/i.test(h));
  const nombreIdx   = (_cNom  != null) ? _cNom  : hdr.findIndex(h => /^nombres?$|^first.?names?$|^names?$/i.test(h.trim()));
  const apellidoIdx = (_cApe  != null) ? _cApe  : hdr.findIndex(h => /^apellidos?$|^last.?names?$|^surnames?$/i.test(h.trim()));
  const tagColIdx   = hdr.findIndex(h => /^tags?$|^etiquetas?$/i.test(h.trim()));

  const col = ci => ci >= 0 ? csv.rows.map(r => (r[ci] || '').trim()) : null;
  const emailCol    = col(colIdx);
  const empresaCol  = col(empresaIdx);
  const paisCol     = col(paisIdx);
  const telCol      = col(telIdx);
  const nombreCol   = col(nombreIdx);
  const apellidoCol = col(apellidoIdx);

  // Compactar filas para keywords (solo columnas especiales)
  const specialIdxs = [colIdx, empresaIdx, paisIdx, telIdx, nombreIdx, apellidoIdx].filter(i => i >= 0);
  const allCellsByRow = csv.rows.map(r => specialIdxs.map(i => (r[i] || '').trim().toLowerCase()));

  _showWorkerProgress('Analizando archivo...');
  let stats, suggested;
  try {
    ({ stats, suggested } = await _workerCall('analyze', {
      emailCol, empresaCol, paisCol, telCol, nombreCol, apellidoCol, allCellsByRow,
      colPresence: { empresaIdx, paisIdx, telIdx, nombreIdx, apellidoIdx },
      whitelist:          [...whitelist],
      whitelistPatternSrc: _serializePatterns(whitelistPatterns),
      customRules,
      defaultRules:       defaultDomainRules,
      learnedPatterns:    learning?.learnedPatterns || [],
      defaultRuleExclusions,
      testPatterns,
      customJunkCompanies,
      customJunkExclusions,
      learning,
    }));
  } catch (err) {
    console.warn('[goAnalysis] Worker falló, usando fallback síncrono:', err.message);
    ({ stats, suggested } = runCsvAnalysis());
  }
  _hideWorkerProgress();

  // El worker no detecta la columna de etiquetas (operación liviana, se resuelve acá)
  stats.tagCol = { hasCol: tagColIdx >= 0, colName: tagColIdx >= 0 ? csv.headers[tagColIdx] : null };
  suggested.fieldtags = tagColIdx >= 0;

  // Reglas sigue a Validación y Dominios; cada uno se activa según sus propios issues
  const enabledSteps = { ...suggested, rules: suggested.validation || suggested.domains };
  setState({ enabledSteps, omittedSteps: {} });
  buildWizardBar(enabledSteps, {});
  setWizardStep('analysis');
  show('c-analysis'); unlock('c-analysis');
  renderAnalysis(stats, enabledSteps);
  _scrollToCard($('c-analysis'));
}

// Navegar al siguiente paso habilitado después del actual
function _skipStep(stepId) {
  const { enabledSteps, omittedSteps } = getState();
  setState({
    enabledSteps:  { ...enabledSteps,  [stepId]: false },
    omittedSteps:  { ...omittedSteps,  [stepId]: true  },
  });
  buildWizardBar(getState().enabledSteps, getState().omittedSteps);
  _goNextEnabled(stepId);
}

function _enableStep(stepId) {
  const { enabledSteps, omittedSteps } = getState();
  if (enabledSteps[stepId] === false) {
    const newOmitted = { ...omittedSteps };
    delete newOmitted[stepId];
    setState({ enabledSteps: { ...enabledSteps, [stepId]: undefined }, omittedSteps: newOmitted });
  }
}

function _goNextEnabled(currentId) {
  const { enabledSteps } = getState();
  const order = FLOW_STEPS.map(s => s.id);
  const idx = order.indexOf(currentId);
  for (let i = idx + 1; i < order.length; i++) {
    if (enabledSteps[order[i]] !== false) { _goById(order[i]); return; }
  }
  showSummary();
}

// Navegar al paso habilitado anterior
function _goPrevEnabled(currentId) {
  const { enabledSteps } = getState();
  const order = ['flow', ...FLOW_STEPS.map(s => s.id)];
  const idx = order.indexOf(currentId);
  for (let i = idx - 1; i >= 0; i--) {
    if (order[i] === 'flow') { goFlowSelect(); return; }
    if (enabledSteps[order[i]] !== false) { _goById(order[i]); return; }
  }
  goFlowSelect();
}

function _goById(id) {
  const map = { rules: goStep2, validation: goStep3, domains: goStep4, duplicates: goStep5, keywords: goStep6, company: goStep7, country: goStep8, fieldhomol: goStep10, nameai: goStep9, fieldtags: goStep11 };
  map[id]?.();
}

// ════════════════════════════════════════════════════════════
//  PASO 2 — REGLAS
// ════════════════════════════════════════════════════════════
function goStep2() {
  const { enabledSteps } = getState();
  if (enabledSteps.rules === false) { goStep3(); return; }
  setWizardStep('rules');
  show('c2'); unlock('c2');
  updateSI2();
  renderDefaultRulesPanel();
  _scrollToCard($('c2'));
}

let _defaultRulesOpen = false;

function renderDefaultRulesPanel() {
  const panel = $('default-rules-panel');
  if (!panel) return;
  const { defaultRuleExclusions, defaultDomainRules } = getState();
  const exclSet  = new Set(defaultRuleExclusions);
  const allRules = defaultDomainRules;
  const active   = allRules.filter(r => !exclSet.has(`${r.type}:${r.from}`));
  const excluded = allRules.filter(r => exclSet.has(`${r.type}:${r.from}`));

  const bodyDisp  = _defaultRulesOpen ? 'block' : 'none';
  const toggleLbl = _defaultRulesOpen ? `▼ ${t('misc.hide')}` : `▶ ${t('misc.view')}`;
  const mono      = 'font-family:var(--mono);font-size:11px';
  const chip      = t => `<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:var(--s3);color:var(--t2);flex-shrink:0;letter-spacing:.03em">${t}</span>`;
  const codeStyle = 'font-family:var(--mono);background:var(--s3);padding:1px 5px;border-radius:3px';

  const ruleRow = (r, isExcl) => `
    <div style="display:flex;align-items:center;gap:8px;padding:3px 0;${isExcl ? 'opacity:.4;' : ''}">
      ${chip(r.type)}
      <span style="${mono};${isExcl ? 'text-decoration:line-through;' : ''}color:var(--t1)">${esc(r.from)}</span>
      <span style="color:var(--t2);font-size:11px;flex-shrink:0">→</span>
      <span style="${mono};color:var(--t2)">${esc(r.to)}</span>
      ${isExcl
        ? `<button class="btn btn-g btn-xs" data-dr-restore="${esc(r.type)}:${esc(r.from)}" style="margin-left:auto;font-size:10px">${t('misc.restore')}</button>`
        : `<button class="ri-d" data-dr-excl="${esc(r.type)}:${esc(r.from)}" style="margin-left:auto;font-size:10px;opacity:.6" title="${t('misc.exclude')}">✕</button>`
      }
    </div>`;

  const headerRadius = _defaultRulesOpen ? 'var(--rs) var(--rs) 0 0' : 'var(--rs)';

  panel.innerHTML = `
    <div style="margin-top:10px">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--s2);border:1px solid var(--border);border-radius:${headerRadius};cursor:pointer" id="dr-hdr">
        <span style="font-size:11px;color:var(--t2)">
          ${t('rules.builtin')}
          <span style="color:var(--t1);margin-left:4px">${active.length} ${t('rules.active')}</span>
          ${excluded.length > 0 ? `<span style="color:var(--red);margin-left:4px">· ${excluded.length} ${t('rules.excluded')}</span>` : ''}
        </span>
        <button class="btn btn-g btn-xs" id="btn-dr-toggle">${toggleLbl}</button>
      </div>
      <div id="dr-body" style="display:${bodyDisp};border:1px solid var(--border);border-top:none;border-radius:0 0 var(--rs) var(--rs);background:var(--s2);padding:12px 14px">
        ${excluded.length > 0 ? `
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--red);margin-bottom:4px">${t('rules.excluded_lbl')} (${excluded.length})</div>
          <div style="max-height:120px;overflow-y:auto;margin-bottom:8px">${excluded.map(r => ruleRow(r, true)).join('')}</div>
          <div style="border-top:1px solid var(--border);margin:8px 0"></div>
        ` : ''}
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--t2);margin-bottom:4px">${t('rules.active_lbl')} (${active.length})</div>
        <div style="max-height:220px;overflow-y:auto">${active.map(r => ruleRow(r, false)).join('')}</div>
      </div>
    </div>`;

  const toggle = () => {
    _defaultRulesOpen = !_defaultRulesOpen;
    renderDefaultRulesPanel();
  };
  $('btn-dr-toggle')?.addEventListener('click', e => { e.stopPropagation(); toggle(); });
  $('dr-hdr')?.addEventListener('click', e => { if (!e.target.closest('#btn-dr-toggle')) toggle(); });

  panel.querySelectorAll('[data-dr-excl]').forEach(b => b.addEventListener('click', () => {
    const key = b.dataset.drExcl;
    const { defaultRuleExclusions } = getState();
    if (!defaultRuleExclusions.includes(key)) {
      setState({ defaultRuleExclusions: [...defaultRuleExclusions, key] });
      saveRules(); renderDefaultRulesPanel();
      toast(t('rules.toast_excluded', key.split(':')[1]));
    }
  }));

  panel.querySelectorAll('[data-dr-restore]').forEach(b => b.addEventListener('click', () => {
    const key = b.dataset.drRestore;
    setState({ defaultRuleExclusions: getState().defaultRuleExclusions.filter(k => k !== key) });
    saveRules(); renderDefaultRulesPanel();
    toast(t('rules.toast_restored', key.split(':')[1]));
  }));

}

function updateSI2() {
  const { customRules, defaultValidDomains, defaultValidExclusions, customWL } = getState();
  const effectiveWL = (defaultValidDomains.length - defaultValidExclusions.length) + customWL.length;
  $('si2').innerHTML = t('rules.si', customRules.length, effectiveWL);
}

export function renderRules() {
  const { customRules } = getState();
  const l = $('rlist');
  l.innerHTML = customRules.length
    ? customRules.map(r => `
        <div class="ri">
          <span class="ri-tp">${r.type}</span>
          <span class="ri-fr">${esc(r.from)}</span>
          <span class="ri-ar">→</span>
          <span class="ri-to">${esc(r.to)}</span>
          <span class="ri-src">${r.source === 'learned' ? `🧠 ${t('rules.learned')}` : 'custom'}</span>
          <button class="ri-d" data-id="${r.id}">✕</button>
        </div>`).join('')
    : `<div class="empty-rules">${t('rules.no_custom')}</div>`;
  l.querySelectorAll('.ri-d').forEach(b => b.addEventListener('click', () => {
    const { customRules } = getState();
    setState({ customRules: customRules.filter(r => r.id !== b.dataset.id) });
    renderRules(); updateSI2(); saveRules();
  }));
}

let _wlPanelOpen = false;

export function renderWhitelist() {
  const { customWL, defaultValidDomains, defaultValidExclusions } = getState();

  // ── Custom chips (sobre el panel built-in, igual que suffix-custom-list) ──
  const custContainer = $('wl-custom-list');
  if (custContainer) {
    custContainer.innerHTML = customWL.map(d =>
      `<span class="wl-chip cust" style="font-family:var(--mono)">
        ${esc(d)}
        <button class="xd" data-d="${esc(d)}" title="${t('misc.remove')}">✕</button>
      </span>`
    ).join('');
    custContainer.querySelectorAll('.xd').forEach(b => b.addEventListener('click', () => {
      const d = b.dataset.d;
      setState({ customWL: getState().customWL.filter(x => x !== d) });
      rebuildWhitelist(); renderWhitelist(); saveDominio(); updateSI2();
      toast(t('toast.domain_removed', d));
    }));
  }

  // ── Panel built-in colapsable a ancho de tarjeta ──
  const panel = $('wl-default-panel');
  if (!panel) return;

  const exclSet  = new Set(defaultValidExclusions);
  const active   = defaultValidDomains.filter(d => !exclSet.has(d));
  const excluded = defaultValidDomains.filter(d =>  exclSet.has(d));

  const bodyDisp  = _wlPanelOpen ? 'block' : 'none';
  const toggleLbl = _wlPanelOpen ? `▼ ${t('misc.hide')}` : `▶ ${t('misc.view')}`;
  const mono      = 'font-family:var(--mono);font-size:11px';

  const domRow = (d, isExcl) => `
    <div style="display:flex;align-items:center;gap:8px;padding:3px 0;${isExcl ? 'opacity:.4;' : ''}">
      <span style="${mono};${isExcl ? 'text-decoration:line-through;' : ''}color:var(--t1)">${esc(d)}</span>
      ${isExcl
        ? `<button class="btn btn-g btn-xs" data-wl-restore="${esc(d)}" style="margin-left:auto;font-size:10px">${t('misc.restore')}</button>`
        : `<button class="ri-d" data-wl-excl="${esc(d)}" style="margin-left:auto;font-size:10px;opacity:.6" title="${t('misc.exclude')}">✕</button>`
      }
    </div>`;

  panel.innerHTML = `
    <div style="margin-top:10px;margin-left:-14px;margin-right:-14px">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 14px;background:var(--s2);border-top:1px solid var(--border);border-bottom:${_wlPanelOpen ? '1px solid var(--border)' : 'none'};cursor:pointer" id="wl-builtin-hdr">
        <span style="font-size:11px;color:var(--t2)">
          ${t('rules.builtin')}
          <span style="color:var(--t1);margin-left:4px">${active.length} ${t('rules.active')}</span>
          ${excluded.length > 0 ? `<span style="color:var(--red);margin-left:4px">· ${excluded.length} ${t('rules.excluded')}</span>` : ''}
        </span>
        <button class="btn btn-g btn-xs" id="btn-wl-toggle">${toggleLbl}</button>
      </div>
      <div id="wl-builtin-body" style="display:${bodyDisp};background:var(--s2);padding:12px 14px;border-bottom:1px solid var(--border)">
        ${excluded.length > 0 ? `
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--red);margin-bottom:4px">${t('rules.excluded_lbl')} (${excluded.length})</div>
          <div style="max-height:120px;overflow-y:auto;margin-bottom:8px">${excluded.map(d => domRow(d, true)).join('')}</div>
          <div style="border-top:1px solid var(--border);margin:8px 0"></div>
        ` : ''}
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--t2);margin-bottom:4px">${t('rules.active_lbl')} (${active.length})</div>
        <div style="max-height:220px;overflow-y:auto">${active.map(d => domRow(d, false)).join('')}</div>
      </div>
    </div>`;

  const togglePanel = () => { _wlPanelOpen = !_wlPanelOpen; renderWhitelist(); };
  $('btn-wl-toggle')?.addEventListener('click', e => { e.stopPropagation(); togglePanel(); });
  $('wl-builtin-hdr')?.addEventListener('click', e => { if (!e.target.closest('#btn-wl-toggle')) togglePanel(); });

  panel.querySelectorAll('[data-wl-excl]').forEach(b => b.addEventListener('click', () => {
    const d = b.dataset.wlExcl;
    const { defaultValidExclusions } = getState();
    if (!defaultValidExclusions.includes(d)) {
      setState({ defaultValidExclusions: [...defaultValidExclusions, d] });
      rebuildWhitelist(); renderWhitelist(); saveDominio(); updateSI2();
      toast(t('rules.toast_excluded', d));
    }
  }));

  panel.querySelectorAll('[data-wl-restore]').forEach(b => b.addEventListener('click', () => {
    const d = b.dataset.wlRestore;
    setState({ defaultValidExclusions: getState().defaultValidExclusions.filter(x => x !== d) });
    rebuildWhitelist(); renderWhitelist(); saveDominio(); updateSI2();
    toast(t('rules.toast_restored', d));
  }));
}

let _suffixPanelOpen = false;

function renderSuffixList() {
  const { suffixRules } = getState();
  const allRules    = suffixRules?.rules || [];
  const customRules = allRules.filter(r => r.source !== 'default');
  const defRules    = allRules.filter(r => r.source === 'default');

  // Chips de reglas custom del usuario
  const custContainer = $('suffix-custom-list');
  if (custContainer) {
    custContainer.innerHTML = customRules.length
      ? customRules.map((r, i) =>
          `<span class="wl-chip cust" style="font-family:var(--mono)">
            .${esc(r.from)} → .${esc(r.to)}
            <button class="xd" data-from="${esc(r.from)}" title="${t('rules.suffix_del')}">✕</button>
          </span>`
        ).join('')
      : '';
    custContainer.querySelectorAll('.xd').forEach(b => b.addEventListener('click', async () => {
      const { suffixRules } = getState();
      const from = b.dataset.from;
      const newRules = suffixRules.rules.filter(r => r.from !== from);
      setState({ suffixRules: { ...suffixRules, rules: newRules } });
      renderSuffixList();
      const customOnly = newRules.filter(r => r.source !== 'default');
      await fetch('/api/suffix-rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules: customOnly }) }).catch(() => {});
    }));
  }

  // Panel colapsable de librería default
  const panel = $('suffix-default-panel');
  if (!panel) return;
  const bodyDisp  = _suffixPanelOpen ? 'block' : 'none';
  const toggleLbl = _suffixPanelOpen ? `▼ ${t('misc.hide')}` : `▶ ${t('misc.view')}`;
  const mono      = 'font-family:var(--mono);font-size:11px';
  const headerRadius = _suffixPanelOpen ? 'var(--rs) var(--rs) 0 0' : 'var(--rs)';

  panel.innerHTML = `
    <div style="margin-top:10px">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--s2);border:1px solid var(--border);border-radius:${headerRadius};cursor:pointer" id="suffix-hdr">
        <span style="font-size:11px;color:var(--t2)">
          ${t('rules.builtin')}
          <span style="color:var(--t1);margin-left:4px">${defRules.length} ${t('rules.active')}</span>
        </span>
        <button class="btn btn-g btn-xs" id="btn-suffix-toggle">${toggleLbl}</button>
      </div>
      <div id="suffix-body" style="display:${bodyDisp};border:1px solid var(--border);border-top:none;border-radius:0 0 var(--rs) var(--rs);background:var(--s2);padding:12px 14px">
        <div style="max-height:260px;overflow-y:auto">
          ${defRules.map(r => `
            <div style="display:flex;align-items:center;gap:8px;padding:3px 0">
              <span style="${mono};color:var(--t1)">.${esc(r.from)}</span>
              <span style="color:var(--t2);font-size:11px;flex-shrink:0">→</span>
              <span style="${mono};color:var(--t2)">.${esc(r.to)}</span>
              <button class="ri-d" data-sfx-del="${esc(r.from)}" style="margin-left:auto;font-size:10px;opacity:.6" title="${t('rules.suffix_del')}">✕</button>
            </div>`).join('')}
        </div>
      </div>
    </div>`;

  const toggle = () => { _suffixPanelOpen = !_suffixPanelOpen; renderSuffixList(); };
  $('btn-suffix-toggle')?.addEventListener('click', e => { e.stopPropagation(); toggle(); });
  $('suffix-hdr')?.addEventListener('click', e => { if (!e.target.closest('#btn-suffix-toggle')) toggle(); });

  panel.querySelectorAll('[data-sfx-del]').forEach(b => b.addEventListener('click', async () => {
    const { suffixRules } = getState();
    const from = b.dataset.sfxDel;
    const newRules = suffixRules.rules.filter(r => r.from !== from);
    setState({ suffixRules: { ...suffixRules, rules: newRules } });
    renderSuffixList();
    const customOnly = newRules.filter(r => r.source !== 'default');
    await fetch('/api/suffix-rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules: customOnly }) }).catch(() => {});
  }));
}

async function saveRules() {
  const { customRules, defaultRuleExclusions } = getState();
  try {
    await fetch('/api/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customRules, defaultRuleExclusions }),
    });
    show('saved-note');
    setTimeout(() => hide('saved-note'), 2000);
  } catch { /* offline */ }
}

async function saveDominio() {
  const { customWL, defaultValidExclusions } = getState();
  try {
    await fetch('/api/domain-valid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domains: customWL, exclusions: defaultValidExclusions }),
    });
    show('saved-note');
    setTimeout(() => hide('saved-note'), 2000);
  } catch { /* offline */ }
}

async function saveTestPatterns() {
  const { testPatterns } = getState();
  try {
    await fetch('/api/keywords', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patterns: testPatterns }),
    });
  } catch { /* offline */ }
}

async function saveEnterprise() {
  const { customJunkCompanies, customJunkExclusions } = getState();
  try {
    await fetch('/api/enterprise', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ junkCompanies: customJunkCompanies, junkExclusions: customJunkExclusions }),
    });
  } catch { /* offline */ }
}

function setupRulesPanel() {
  // Tabs
  document.querySelectorAll('.rtab').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('.rtab').forEach(x => x.classList.remove('on'));
    t.classList.add('on');
    $('rt-rules').classList.toggle('hidden', t.dataset.rt !== 'rules');
    $('rt-whitelist').classList.toggle('hidden', t.dataset.rt !== 'whitelist');
    $('rt-suffix').classList.toggle('hidden', t.dataset.rt !== 'suffix');
  }));

  // Custom provider select
  $('rule-to-prov').addEventListener('change', e => {
    $('rule-to-custom').classList.toggle('hidden', e.target.value !== '_custom');
  });

  // Agregar regla
  $('btn-add-rule').addEventListener('click', () => {
    const type = $('rule-type').value;
    const from = $('rule-from').value.trim().toLowerCase();
    const prov = $('rule-to-prov').value;
    const to   = prov === '_custom' ? $('rule-to-custom').value.trim().toLowerCase() : prov;
    if (!from)                { toast(t('toast.rules_enter_from'), 'warn'); return; }
    if (!to || !to.includes('.')) { toast(t('toast.rules_invalid_to'), 'warn'); return; }
    const { customRules } = getState();
    if (customRules.some(r => r.type === type && r.from === from)) { toast(t('toast.rules_exists'), 'warn'); return; }
    // Advertir si el mismo 'from' ya está cubierto por una regla de tipo diferente
    const conflict = customRules.find(r => r.type !== type && r.from === from);
    if (conflict) toast(t('toast.rule_conflict', from, conflict.type, conflict.to), 'warn');
    setState({ customRules: [{ type, from, to, id: Date.now().toString(), source: 'manual' }, ...customRules] });
    $('rule-from').value = ''; $('rule-to-custom').value = '';
    renderRules(); updateSI2(); saveRules();
    toast(t('toast.rule_added', from, to));
  });

  // Agregar dominio válido (acepta wildcards, ej: hotmail.com.*)
  $('btn-add-wl').addEventListener('click', () => {
    const d = $('wl-input').value.trim().toLowerCase();
    if (!d || !d.replace(/\*/g, 'x').includes('.')) { toast(t('toast.domain_invalid'), 'warn'); return; }
    const { customWL, defaultValidDomains } = getState();
    if (customWL.includes(d) || defaultValidDomains.includes(d)) { toast(t('toast.domain_exists'), 'warn'); return; }
    setState({ customWL: [...customWL, d] });
    rebuildWhitelist(); renderWhitelist(); saveDominio(); updateSI2();
    $('wl-input').value = '';
    toast(t('toast.domain_added', d));
  });

  $('btn-add-suffix').addEventListener('click', async () => {
    const from = $('suffix-from').value.trim().toLowerCase().replace(/^\.+/, '');
    const to   = $('suffix-to').value.trim().toLowerCase().replace(/^\.+/, '');
    if (!from || !to) { toast(t('toast.domain_invalid'), 'warn'); return; }
    const { suffixRules } = getState();
    const rules = suffixRules?.rules || [];
    if (rules.some(r => r.from === from)) { toast(t('toast.domain_exists'), 'warn'); return; }
    const newRules = [...rules, { from, to, source: 'custom' }];
    const updated  = { ...suffixRules, rules: newRules };
    setState({ suffixRules: updated });
    renderSuffixList();
    $('suffix-from').value = '';
    $('suffix-to').value   = '';
    const customOnly = newRules.filter(r => r.source !== 'default');
    await fetch('/api/suffix-rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules: customOnly }) }).catch(() => {});
  });

  renderSuffixList();
}

function _renderEmailColSelector(sbId, atbId, tbodyId, goFn) {
  const { csv } = getState();
  const atb = $(atbId);
  if (atb) atb.style.display = 'none';
  if (tbodyId) { const tb = $(tbodyId); if (tb) tb.innerHTML = ''; }
  const sb = $(sbId);
  if (!sb) return;
  const opts = [
    `<option value="-1">${t('country.none')}</option>`,
    ...csv.headers.map((h, i) => `<option value="${i}">${esc(h || 'Col ' + (i + 1))}</option>`),
  ].join('');
  sb.innerHTML = `<span><span style="color:var(--red)">${t('val.missing_email')} <strong>${t('val.email_label')}.</strong> ${t('val.select_email')}</span>
    <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-top:10px">
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--t2)">
        ${t('val.email_label')}
        <select id="email-col-sel-tmp" style="min-width:180px">${opts}</select>
      </label>
      <button class="btn btn-p btn-sm" id="btn-email-col-confirm">${t('country.confirm')}</button>
    </div></span>`;
  $('btn-email-col-confirm')?.addEventListener('click', () => {
    const idx = parseInt($('email-col-sel-tmp').value);
    if (idx >= 0) setState({ colIdx: idx, emailColName: csv.headers[idx] || null });
    sb.innerHTML = '';
    if (atb) atb.style.display = '';
    goFn();
  });
}

// ════════════════════════════════════════════════════════════
//  PASO 3 — VALIDACIÓN
// ════════════════════════════════════════════════════════════
async function goStep3() {
  const { enabledSteps } = getState();
  if (enabledSteps.validation === false) { goStep4(); return; }
  setWizardStep('validation');
  show('c3'); unlock('c3');
  const { csv, colIdx, learning } = getState();
  if (colIdx < 0) { _renderEmailColSelector('sb3', 'atb3', 'vbody', goStep3); _scrollToCard($('c3')); return; }

  const skipTranslit = !shouldSuggestFixType(learning, 'translit');
  const emailCol = csv.rows.map(r => (r[colIdx] || '').trim());

  _showWorkerProgress('Validando emails...');
  let valItems;
  try {
    valItems = await _workerCall('validate', { emailCol, skipTranslit });
  } catch (err) {
    console.warn('[goStep3] Worker falló, usando fallback síncrono:', err.message);
    valItems = [];
    for (let rowIdx = 0; rowIdx < csv.rows.length; rowIdx++) {
      const val = (csv.rows[rowIdx][colIdx] || '').trim();
      if (!val) continue;
      const { fixed, issues, changed } = autoFixEmail(val, { skipTranslit });
      if (issues.length) valItems.push({ rowIdx, original: val, autoFixed: fixed, manualValue: null, issues, checked: true, changed });
    }
  }
  _hideWorkerProgress();

  setState({ valItems });
  renderStep3(valItems, { onValidationDecision: handleValidationDecision });
  _scrollToCard($('c3'));
}

async function handleValidationDecision(fixType, accepted) {
  const { learning } = getState();
  await recordValidationDecision(learning, fixType, accepted);
}

// ════════════════════════════════════════════════════════════
//  PASO 4 — DOMINIOS
// ════════════════════════════════════════════════════════════
async function goStep4() {
  const { enabledSteps } = getState();
  if (enabledSteps.domains === false) { goStep5(); return; }
  setWizardStep('domains');
  show('c4'); unlock('c4');
  const { csv, colIdx, valItems, whitelist, whitelistPatterns, customRules, defaultDomainRules, learning, defaultRuleExclusions, suffixRules } = getState();
  if (colIdx < 0) { _renderEmailColSelector('sb4', 'atb4', 'dbody', goStep4); _scrollToCard($('c4')); return; }

  // Pase 1 — corrección de terminaciones (sobre el email ya formateado del paso 3)
  const validTldSet  = new Set(suffixRules?.validTlds || []);
  const suffixRuleList = suffixRules?.rules || [];
  const valMap4      = new Map((valItems || []).filter(v => v.checked).map(v => [v.rowIdx, v]));
  const suffixFixed  = new Map(); // rowIdx → { before, after }
  csv.rows.forEach((row, rowIdx) => {
    const orig    = (row[colIdx] || '').trim();
    if (!orig) return;
    const vf      = valMap4.get(rowIdx);
    const emailIn = vf ? (vf.manualValue || vf.autoFixed) : orig;
    const fixed   = correctSuffix(emailIn, suffixRuleList, validTldSet);
    if (fixed) suffixFixed.set(rowIdx, { before: emailIn, after: fixed });
  });

  const emailCol = csv.rows.map((r, ri) => {
    const sf = suffixFixed.get(ri);
    return sf ? sf.after : (r[colIdx] || '').trim();
  });

  _showWorkerProgress('Corrigiendo dominios...');
  let domItems;
  try {
    domItems = await _workerCall('correctDomains', {
      emailCol,
      whitelist:           [...whitelist],
      whitelistPatternSrc: _serializePatterns(whitelistPatterns),
      customRules,
      learnedPatterns:     learning?.learnedPatterns || [],
      defaultRuleExclusions,
      defaultRules:        defaultDomainRules,
      valItemsSer:         valItems,
    });
  } catch (err) {
    console.warn('[goStep4] Worker falló, usando fallback síncrono:', err.message);
    const valMap       = new Map(valItems.filter(v => v.checked).map(v => [v.rowIdx, v]));
    const excl         = new Set(defaultRuleExclusions);
    const learnedPats  = learning?.learnedPatterns || [];
    domItems = [];
    for (let rowIdx = 0; rowIdx < csv.rows.length; rowIdx++) {
      const orig = (csv.rows[rowIdx][colIdx] || '').trim();
      if (!orig) continue;
      const vf       = valMap.get(rowIdx);
      const sf       = suffixFixed.get(rowIdx);
      const emailIn  = sf ? sf.after : (vf ? (vf.manualValue || vf.autoFixed) : orig);
      const res      = correctDomain(emailIn, whitelist, customRules, learnedPats, whitelistPatterns, excl, defaultDomainRules);
      if (res) domItems.push({ rowIdx, emailIn: sf ? sf.before : emailIn, original: orig, ...res, manualValue: null, checked: true });
      else if (sf) {
        const [sfUser, sfOrigDom] = sf.before.split('@');
        domItems.push({ rowIdx, emailIn: sf.before, original: orig, user: sfUser, originalDomain: sfOrigDom, corrected: sf.after, correctedDomain: sf.after.split('@')[1], provider: 'suffix', source: 'suffix', manualValue: null, checked: true });
      }
    }
  }
  _hideWorkerProgress();

  // Para filas que el worker procesó pero que también tuvieron suffix fix,
  // corregir emailIn/user/originalDomain para mostrar el estado pre-suffix
  if (domItems) {
    for (const item of domItems) {
      const sf = suffixFixed.get(item.rowIdx);
      if (sf) {
        item.emailIn       = sf.before;
        item.user          = sf.before.split('@')[0];
        item.originalDomain = sf.before.split('@')[1];
      }
    }
  }

  // Mergear correcciones de suffix que el worker no capturó (email ya correcto para él)
  const domRowSet = new Set(domItems.map(d => d.rowIdx));
  suffixFixed.forEach(({ before, after }, rowIdx) => {
    if (!domRowSet.has(rowIdx)) {
      const orig = (csv.rows[rowIdx][colIdx] || '').trim();
      const [sfUser, sfOrigDom] = before.split('@');
      domItems.push({ rowIdx, emailIn: before, original: orig, user: sfUser, originalDomain: sfOrigDom, corrected: after, correctedDomain: after.split('@')[1], provider: 'suffix', source: 'suffix', manualValue: null, checked: true });
    }
  });

  setState({ domItems });
  renderStep4(domItems, { onDomainDecision: handleDomainDecision });
  _scrollToCard($('c4'));
}

async function handleDomainDecision(pattern, target, accepted) {
  const { learning } = getState();
  const updated = await recordDomainDecision(learning, pattern, target, accepted);
  if (updated) setState({ learning: { ...learning, learnedPatterns: updated } });
}

// ════════════════════════════════════════════════════════════
//  PASO 5 — DUPLICADOS
// ════════════════════════════════════════════════════════════
let _keepMode = 'none';

async function goStep5() {
  const { enabledSteps } = getState();
  if (enabledSteps.duplicates === false) { goStep6(); return; }
  setWizardStep('duplicates');
  show('c5'); unlock('c5');

  const { csv, colIdx, valItems, domItems, learning } = getState();
  const hash    = schemaHash(csv.headers);
  const idCols  = detectIdColumns(csv.headers, csv.rows);

  const savedCols = getSuggestedColumns(learning, hash);
  const dupCols   = (savedCols && savedCols.length > 0) ? new Set(savedCols) : new Set([colIdx]);
  const dupColsArr = [...dupCols];

  // Enviar solo las columnas necesarias para minimizar datos transferidos
  const compactRows = csv.rows.map(r => {
    const out = new Array(csv.headers.length).fill('');
    for (const ci of dupColsArr) out[ci] = r[ci] || '';
    return out;
  });

  _showWorkerProgress('Detectando duplicados...');
  let dupGroups;
  try {
    const raw = await _workerCall('findDups', {
      rows: compactRows,
      headers: csv.headers,
      colIdx,
      dupColsArr,
      valItemsSer: valItems,
      domItemsSer: domItems,
    });
    // keepRowIdxs viene como Array desde el worker — restaurar como Set
    dupGroups = raw.map(g => ({ ...g, keepRowIdxs: new Set(g.keepRowIdxs) }));
  } catch (err) {
    console.warn('[goStep5] Worker falló, usando fallback síncrono:', err.message);
    dupGroups = findDuplicates(csv, colIdx, dupCols, valItems, domItems);
  }
  _hideWorkerProgress();

  // Auto-aplicar "Mantener completo"
  _keepMode = 'complete';
  _applyKeepMode(dupGroups, csv);

  const dupExcluded = buildExcluded(dupGroups);
  setState({ dupGroups, dupExcluded, dupCols, _idCols: idCols });
  renderStep5({
    csv, colIdx, dupGroups, dupCols, idCols,
    keepMode:       _keepMode,
    onColChange:    handleDupColChange,
    onGroupChange:  handleDupGroupChange,
    onKeepFirst:    handleKeepFirst,
    onKeepLast:     handleKeepLast,
    onKeepComplete: handleKeepMostComplete,
    resetExpanded:  true,
  });
  _scrollToCard($('c5'));
  if (savedCols) toast(t('toast.cols_restored'));
}

function _reRenderDupStep() {
  const { csv, colIdx, dupGroups, dupCols } = getState();
  renderStep5({
    csv, colIdx, dupGroups, dupCols, idCols: getState()._idCols,
    keepMode:       _keepMode,
    onColChange:    handleDupColChange,
    onGroupChange:  handleDupGroupChange,
    onKeepFirst:    handleKeepFirst,
    onKeepLast:     handleKeepLast,
    onKeepComplete: handleKeepMostComplete,
  });
}

function _applyKeepMode(dupGroups, csv) {
  if (_keepMode === 'first') {
    dupGroups.forEach(g => { g.keepRowIdxs = new Set([g.rows[0].rowIdx]); });
  } else if (_keepMode === 'last') {
    dupGroups.forEach(g => { g.keepRowIdxs = new Set([g.rows[g.rows.length - 1].rowIdx]); });
  } else if (_keepMode === 'complete') {
    dupGroups.forEach(g => {
      let best = g.rows[0], bestScore = -1;
      g.rows.forEach(r => {
        const score = (csv.rows[r.rowIdx] || []).filter(c => (c || '').trim() !== '').length;
        if (score > bestScore) { bestScore = score; best = r; }
      });
      g.keepRowIdxs = new Set([best.rowIdx]);
    });
  }
}

function handleDupColChange() {
  const { csv, colIdx, dupCols, valItems, domItems } = getState();
  const dupGroups   = findDuplicates(csv, colIdx, dupCols, valItems, domItems);
  _applyKeepMode(dupGroups, csv);
  const dupExcluded = buildExcluded(dupGroups);
  setState({ dupGroups, dupExcluded });
  _reRenderDupStep();
}

function handleDupGroupChange() {
  const { dupGroups } = getState();
  const dupExcluded = buildExcluded(dupGroups);
  setState({ dupExcluded });
}

function handleKeepFirst() {
  const { dupGroups } = getState();
  dupGroups.forEach(g => { g.keepRowIdxs = new Set([g.rows[0].rowIdx]); });
  const dupExcluded = buildExcluded(dupGroups);
  setState({ dupGroups, dupExcluded });
  _keepMode = 'first';
  _reRenderDupStep();
  toast(t('toast.dup_keep_first'));
}

function handleKeepLast() {
  const { dupGroups } = getState();
  dupGroups.forEach(g => { g.keepRowIdxs = new Set([g.rows[g.rows.length - 1].rowIdx]); });
  const dupExcluded = buildExcluded(dupGroups);
  setState({ dupGroups, dupExcluded });
  _keepMode = 'last';
  _reRenderDupStep();
  toast(t('toast.dup_keep_last'));
}

function handleKeepMostComplete() {
  const { dupGroups, csv } = getState();
  dupGroups.forEach(g => {
    let best = g.rows[0], bestScore = -1;
    g.rows.forEach(r => {
      const score = (csv.rows[r.rowIdx] || []).filter(c => (c || '').trim() !== '').length;
      if (score > bestScore) { bestScore = score; best = r; }
    });
    g.keepRowIdxs = new Set([best.rowIdx]);
  });
  const dupExcluded = buildExcluded(dupGroups);
  setState({ dupGroups, dupExcluded });
  _keepMode = 'complete';
  _reRenderDupStep();
  toast(t('toast.dup_keep_complete'));
}

// ════════════════════════════════════════════════════════════
//  PASO 6 — FILAS DE PRUEBA
// ════════════════════════════════════════════════════════════
function _findTestTargetCols(headers, colIdx) {
  const patterns = [
    { name: 'Nombre',   re: /nombre|first.?name/i },
    { name: 'Apellido', re: /apellido|last.?name|surname/i },
    { name: 'Empresa',  re: /empresa|company|organiz|negocio/i },
  ];
  const cols = [{ name: 'Email', idx: colIdx }];
  patterns.forEach(({ name, re }) => {
    const idx = headers.findIndex(h => re.test(h.trim()));
    if (idx !== -1 && idx !== colIdx) cols.push({ name, idx });
  });
  return cols;
}

function _addTestPattern(pattern) {
  const { testPatterns } = getState();
  const norm = pattern.trim().toLowerCase();
  if (!norm || testPatterns.some(p => p.toLowerCase() === norm)) {
    toast(t('toast.pattern_exists'), 'warn'); return;
  }
  setState({ testPatterns: [...testPatterns, pattern.trim()] });
  saveTestPatterns();
  goStep6();
  toast(t('toast.pattern_added', pattern.trim()));
}

function _removeTestPattern(pattern) {
  const { testPatterns } = getState();
  setState({ testPatterns: testPatterns.filter(p => p !== pattern) });
  saveTestPatterns();
  goStep6();
}

function goStep6() {
  const { enabledSteps } = getState();
  if (enabledSteps.keywords === false) { _goNextEnabled('keywords'); return; }
  const { csv, colIdx, dupExcluded, testPatterns } = getState();
  const patterns   = testPatterns.length > 0 ? testPatterns : ['test'];
  const targetCols = _findTestTargetCols(csv.headers, colIdx);

  const testItems = [];
  csv.rows.forEach((row, ri) => {
    if (dupExcluded.has(ri)) return;
    if (!row.some(c => (c||'').trim())) return;
    const matchedFields = [];
    targetCols.forEach(({ name, idx }) => {
      const val = (row[idx] || '').trim();
      if (!val) return;
      const matches = name === 'Email'
        ? kwMatchEmail(val, patterns)
        : kwMatchField(val, patterns);
      if (matches) matchedFields.push({ name, val });
    });
    if (matchedFields.length) testItems.push({ rowIdx: ri, row, matchedFields, checked: true });
  });

  const testExcluded = new Set(testItems.map(t => t.rowIdx));
  setState({ testItems, testExcluded });

  setWizardStep('keywords');
  show('c6'); unlock('c6');
  renderStep6(testItems, csv, colIdx);
  renderTestPatternPanel(patterns, { onAddPattern: _addTestPattern, onRemovePattern: _removeTestPattern });
  _scrollToCard($('c6'));
}

// ════════════════════════════════════════════════════════════
//  PASO 7 — NORMALIZAR EMPRESA
// ════════════════════════════════════════════════════════════

// Detecta si un valor de empresa es sospechoso para revisión manual (no auto-limpiado).
// Criterios: 2+ wildcards, 4+ chars repetidos, número ≥4 dígitos, todo mayúsculas,
// longitud sin espacios >23, o símbolos sospechosos.
function _computeReview(norm, patterns) {
  if (norm.clear || !norm.displayName) return false;
  const key  = norm.key;
  const name = norm.displayName;
  if (patterns.filter(p => key.includes(p)).length >= 2) return true;
  if (/(.)\1{3,}/.test(key)) return true;
  if (/\d{4,}/.test(key)) return true;
  if (/[a-zA-ZáéíóúüñÁÉÍÓÚÜÑ]/.test(name) && name === name.toUpperCase()) return true;
  if (name.replace(/\s/g, '').length > 23) return true;
  if (/[$%!?¿¡~^|\\<>{}]/.test(name)) return true;
  return false;
}

// Detecta si un valor de empresa es numérico puro, código alfanumérico corto
// (DNI, CUIT, Plus Code tipo "70x7+", teléfonos, etc.) o relleno de teclado (aaaa, xxxx).
function _isNumericOrCode(key) {
  if (!key) return false;
  // Carácter repetido 3+ veces seguidas (aaaa, oooo, xxxx, 1111, ...)
  if (/(.)\1{3,}/.test(key)) return true;
  if (!/\d/.test(key)) return false;
  // Solo dígitos y puntuación típica (DNI, CUIT, teléfonos)
  if (/^[\d\s.\-\/+()\[\]]+$/.test(key)) return true;
  // Código alfanumérico: quitando dígitos y puntuación quedan ≤ 2 letras sueltas
  // Ejemplo: "70x7+" → quita "70","7","+" → queda "x" (1 letra)
  const letters = key.replace(/[\d\s.\-\/+()\[\]@#*]/g, '');
  return letters.length <= 2;
}

function goStep7() {
  const { enabledSteps } = getState();
  if (enabledSteps.company === false) { _goNextEnabled('company'); return; }
  const { csv } = getState();

  // Auto-detect columna empresa (usar confirmación del usuario si existe)
  const { confirmedEmpresaIdx: _cfEmp } = getState();
  const detected = (_cfEmp != null) ? _cfEmp : csv.headers.findIndex(h => /empresa[s]?|raz[oó]n\s*(?:de\s*)?social|nombre.{0,20}fant[aá]s[ií]a?|compan(?:y|ies?)(?:\s*name)?|business(?:\s*name)?|\borganiz|\bnegocio/i.test(h.trim()));
  setState({ empresaIdx: detected });

  // Poblar select de columna
  const sel = $('empresa-col-sel');
  if (sel) {
    sel.innerHTML = csv.headers.map((h, i) =>
      `<option value="${i}" ${i === detected ? 'selected' : ''}>${esc(h.trim() || `Col ${i + 1}`)}</option>`
    ).join('');
    sel.onchange = () => {
      setState({ empresaIdx: parseInt(sel.value) });
      _recomputeStep7();
    };
  }

  setWizardStep('company');
  show('c7'); unlock('c7');

  if (detected === -1) {
    renderStep7NoEmpresa();
    _scrollToCard($('c7'));
    return;
  }

  const empresaIdx = detected;
  const { dupExcluded, testExcluded, customJunkCompanies, customJunkExclusions, homologateRules, learning } = getState();

  const learnedJunk    = getLearnedJunkCompanies(learning);
  const learnedRenames = getLearnedCompanyRenames(learning);
  const { exactSet, patterns } = buildJunkSet(customJunkCompanies, learnedJunk, customJunkExclusions);

  const groupMap = new Map();
  csv.rows.forEach((row, ri) => {
    if (dupExcluded.has(ri) || testExcluded.has(ri)) return;
    if (!row.some(c => (c||'').trim())) return;
    const empresa = (row[empresaIdx] || '').trim().replace(/\s{2,}/g, ' ');
    const key     = empresa ? empresa.toLowerCase().normalize('NFC') : `__empty_${ri}`;
    if (!groupMap.has(key)) {
      groupMap.set(key, { key, displayName: empresa, rowIdxs: [], newName: empresa, clear: false, learned: false, homologated: false, review: false });
    }
    groupMap.get(key).rowIdxs.push(ri);
  });

  for (const norm of groupMap.values()) {
    // AUTO-HOMOLOGADO primero
    if (norm.key && learnedRenames[norm.key]) {
      norm.newName = learnedRenames[norm.key];
      norm.learned = true;
    }
    if (norm.displayName) {
      const { result, changed } = applyHomologateRules(norm.newName, homologateRules);
      if (changed) { norm.newName = result; norm.homologated = true; }
    }
    if (!norm.homologated && norm.newName !== norm.displayName) {
      norm.homologated = true;
    }
    // AUTO-LIMPIEZA después
    if (norm.homologated && !norm.newName) norm.clear = true;  // homologado a vacío = limpieza
    if (isCompanyJunk(norm.key, exactSet, patterns)) {
      norm.clear   = true;
      norm.learned = learnedJunk.includes(norm.key);
    }
    if (!norm.clear && norm.key && !norm.key.startsWith('__empty_') && _isNumericOrCode(norm.key)) norm.clear = true;
    // REVISAR — sospechoso pero no auto-limpiado
    norm.review = _computeReview(norm, patterns);
  }

  const companyNorms = [...groupMap.values()].sort((a, b) => {
    if (!a.displayName && b.displayName) return 1;
    if (a.displayName && !b.displayName) return -1;
    return a.displayName.localeCompare(b.displayName, 'es', { sensitivity: 'base' });
  });

  setState({ companyNorms });
  _renderStep7Full(true);
  _scrollToCard($('c7'));
}

// Re-cómputo sin re-detectar columna ni re-inicializar navegación
function _recomputeStep7() {
  const { csv, dupExcluded, testExcluded, customJunkCompanies, customJunkExclusions, homologateRules, learning, empresaIdx } = getState();
  if (empresaIdx === -1) { renderStep7NoEmpresa(); return; }
  const learnedJunk    = getLearnedJunkCompanies(learning);
  const learnedRenames = getLearnedCompanyRenames(learning);
  const { exactSet, patterns } = buildJunkSet(customJunkCompanies, learnedJunk, customJunkExclusions);
  const groupMap = new Map();
  csv.rows.forEach((row, ri) => {
    if (dupExcluded.has(ri) || testExcluded.has(ri)) return;
    if (!row.some(c => (c||'').trim())) return;
    const empresa = (row[empresaIdx] || '').trim().replace(/\s{2,}/g, ' ');
    const key     = empresa ? empresa.toLowerCase().normalize('NFC') : `__empty_${ri}`;
    if (!groupMap.has(key))
      groupMap.set(key, { key, displayName: empresa, rowIdxs: [], newName: empresa, clear: false, learned: false, homologated: false, review: false });
    groupMap.get(key).rowIdxs.push(ri);
  });
  for (const norm of groupMap.values()) {
    // AUTO-HOMOLOGADO primero
    if (norm.key && learnedRenames[norm.key]) { norm.newName = learnedRenames[norm.key]; norm.learned = true; }
    if (norm.displayName) {
      const { result, changed } = applyHomologateRules(norm.newName, homologateRules);
      if (changed) { norm.newName = result; norm.homologated = true; }
    }
    if (!norm.homologated && norm.newName !== norm.displayName) { norm.homologated = true; }
    // AUTO-LIMPIEZA después
    if (norm.homologated && !norm.newName) norm.clear = true;  // homologado a vacío = limpieza
    if (isCompanyJunk(norm.key, exactSet, patterns)) { norm.clear = true; norm.learned = learnedJunk.includes(norm.key); }
    if (!norm.clear && norm.key && !norm.key.startsWith('__empty_') && _isNumericOrCode(norm.key)) norm.clear = true;
    // REVISAR — sospechoso pero no auto-limpiado
    norm.review = _computeReview(norm, patterns);
  }
  const companyNorms = [...groupMap.values()].sort((a, b) => {
    if (!a.displayName && b.displayName) return 1;
    if (a.displayName && !b.displayName) return -1;
    return a.displayName.localeCompare(b.displayName, 'es', { sensitivity: 'base' });
  });
  setState({ companyNorms });
  _renderStep7Full(false);
}

function _renderStep7Full(resetPanels = false) {
  const { companyNorms, csv, empresaIdx, colIdx, customJunkCompanies, customJunkExclusions, homologateRules, learning } = getState();
  const learnedJunk = getLearnedJunkCompanies(learning);
  renderStep7({
    companyNorms, csv, empresaIdx, colIdx,
    baseJunk:   BASE_JUNK_COMPANIES,
    learnedJunk,
    customJunk:  customJunkCompanies,
    exclusions:  customJunkExclusions,
    homologateRules,
    resetPanels,
    onAddJunk:          _addJunkCompany,
    onRemoveCustom:     _removeJunkCompany,
    onExcludeBase:      _excludeJunkValue,
    onRestoreExcluded:  _restoreJunkValue,
    onAddHomologate:    _addHomologateRule,
    onRemoveHomologate: _removeHomologateRule,
    // onClearToggle no se pasa: checkbox Limpiar es solo de sesión
  });
}

function _addJunkCompany(value) {
  const { customJunkCompanies } = getState();
  const norm = value.trim().toLowerCase().normalize('NFC');
  if (!norm || customJunkCompanies.some(j => j.toLowerCase().normalize('NFC') === norm)) return;
  setState({ customJunkCompanies: [...customJunkCompanies, value.trim()] });
  saveEnterprise();
  _recomputeStep7();
  toast(t('toast.junk_added', value.trim()));
}

function _removeJunkCompany(value) {
  const { customJunkCompanies } = getState();
  setState({ customJunkCompanies: customJunkCompanies.filter(j => j !== value) });
  saveEnterprise();
  _recomputeStep7();
  toast(t('toast.junk_removed', value));
}

function _excludeJunkValue(normKey) {
  const { customJunkExclusions } = getState();
  if (!customJunkExclusions.includes(normKey)) {
    setState({ customJunkExclusions: [...customJunkExclusions, normKey] });
    saveEnterprise();
    _recomputeStep7();
  }
}

function _restoreJunkValue(normKey) {
  const { customJunkExclusions } = getState();
  setState({ customJunkExclusions: customJunkExclusions.filter(e => e !== normKey) });
  saveEnterprise();
  _recomputeStep7();
}

// Limpiar checkbox es solo de sesión — no persiste en enterprise-clean.json.
// Para guardar una empresa permanentemente, usar el botón "+ Agregar" del panel.

async function saveHomologate() {
  const { homologateRules } = getState();
  await fetch('/api/enterprise-homologate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rules: homologateRules }),
  }).catch(() => {});
}

function _addHomologateRule(find, replace) {
  const { homologateRules } = getState();
  const normFind    = find.trim().toLowerCase();
  const normReplace = replace.trim();   // puede ser vacío (elimina el texto)
  if (!normFind) return;
  if (homologateRules.some(r => r.find.toLowerCase() === normFind)) {
    toast(t('toast.rule_exists'), 'warn'); return;
  }
  setState({ homologateRules: [...homologateRules, { find: normFind, replace: normReplace }] });
  saveHomologate();
  _recomputeStep7();
  const replaceLabel = normReplace !== '' ? `"${normReplace}"` : t('toast.homol_empty');
  toast(t('toast.homol_rule_added', normFind, replaceLabel));
}

function _removeHomologateRule(find) {
  const { homologateRules } = getState();
  setState({ homologateRules: homologateRules.filter(r => r.find !== find) });
  saveHomologate();
  _recomputeStep7();
  toast(t('toast.homol_rule_deleted', find));
}

// ════════════════════════════════════════════════════════════
//  PASO 8 — PAÍS Y TELÉFONO
// ════════════════════════════════════════════════════════════

function _normHeader(h) {
  return h.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function _runStep8Analysis(paisIdx, telIdx) {
  const { csv, colIdx, dupExcluded, testExcluded, countryData, valItems, domItems } = getState();
  buildCountryMaps(countryData);

  // Mapas de correcciones de pasos anteriores para leer el email ya corregido
  const _valMap = new Map((valItems || []).map(v => [v.rowIdx, v]));
  const _domMap = new Map((domItems || []).map(d => [d.rowIdx, d]));

  const step8Items = [];
  csv.rows.forEach((row, ri) => {
    if (dupExcluded.has(ri) || testExcluded.has(ri)) return;
    if (!row.some(c => (c||'').trim())) return;

    // Bug 1 fix: aplicar correcciones de val/dom al email
    let email = (row[colIdx] || '').trim();
    const vf = _valMap.get(ri);
    const df = _domMap.get(ri);
    if (vf?.checked) email = vf.manualValue ?? vf.autoFixed ?? email;
    if (df?.checked) email = df.manualValue ?? df.corrected ?? email;

    const phone        = telIdx  >= 0 ? (row[telIdx]  || '').trim() : '';
    const originalPais = paisIdx >= 0 ? (row[paisIdx] || '').trim() : '';
    let country = null;
    let source  = null;

    if (paisIdx >= 0 && originalPais) {
      country = resolveFromColumn(originalPais);
      if (country) source = 'column';
    }
    if (!country && email) {
      country = detectCountryFromEmail(email);
      if (country) source = 'email';
    }
    if (!country && phone) {
      country = detectCountryFromPhone(phone);
      if (country) source = 'phone';
    }

    // Bug 2 fix: saltar filas sin nada relevante para el paso 8
    if (!phone && !originalPais && !country) return;

    const formattedPhone = country && phone ? formatPhone(phone, country) : phone;
    const willChangePais = paisIdx >= 0 && !originalPais && !!country;
    const willChangeTel  = telIdx  >= 0 && !!phone && !!country && formattedPhone !== phone;
    const _pd = phone.replace(/\D/g, '').length;
    const phoneInvalid   = !!phone && (_pd <= 5 || _pd >= 16);

    step8Items.push({
      rowIdx: ri, email, phone, country, source,
      originalPais, formattedPhone, willChangePais, willChangeTel,
      manualPhone: null, phoneInvalid,
      checked: willChangePais || willChangeTel,
    });
  });

  setState({ paisIdx, telIdx, step8Items });
  return step8Items;
}

function _recomputeStep8Item(item, country, iso2, paisIdx, telIdx) {
  const formattedPhone = country && item.phone ? formatPhone(item.phone, country) : item.phone;
  const willChangePais = paisIdx >= 0 && !item.originalPais && !!country;
  const willChangeTel  = telIdx  >= 0 && !!item.phone && !!country && formattedPhone !== item.phone;
  // Preservar manualPhone: solo resetear si el teléfono ya no es inválido y no hay corrección pendiente
  const manualPhone = item.phoneInvalid ? item.manualPhone : null;
  return { ...item, country, source: iso2 ? 'manual' : null,
    formattedPhone, willChangePais, willChangeTel,
    manualPhone,
    checked: willChangePais || willChangeTel || (item.phoneInvalid && !!manualPhone) };
}

function _handleStep8CountryChange(rowIdx, iso2) {
  const { step8Items, countryData, paisIdx, telIdx } = getState();
  const country = iso2 ? countryData.find(c => c.iso2 === iso2) || null : null;
  const updated = step8Items.map(i =>
    i.rowIdx === rowIdx ? _recomputeStep8Item(i, country, iso2, paisIdx, telIdx) : i
  );
  setState({ step8Items: updated });
}

function _handleStep8CheckChange(rowIdx, checked) {
  const { step8Items } = getState();
  setState({ step8Items: step8Items.map(i => i.rowIdx === rowIdx ? { ...i, checked } : i) });
}

function _handleStep8CheckAll(checked) {
  const { step8Items } = getState();
  setState({
    step8Items: step8Items.map(i =>
      (i.willChangePais || i.willChangeTel) ? { ...i, checked } : i
    ),
  });
}

function _handleStep8PhoneChange(rowIdx, value) {
  const { step8Items } = getState();
  setState({
    step8Items: step8Items.map(i => {
      if (i.rowIdx !== rowIdx) return i;
      const manualPhone = value !== i.formattedPhone ? value : null;
      // Si era inválido: limpiar phoneInvalid cuando la corrección manual es válida (6-15 dígitos)
      let { phoneInvalid } = i;
      if (phoneInvalid) {
        const digits = (value || '').replace(/\D/g, '').length;
        phoneInvalid = !value || digits < 6 || digits > 15;
      }
      // Si se resolvió el inválido, marcar checked para que se aplique al CSV final
      const checked = (!phoneInvalid && i.phoneInvalid) ? true : i.checked;
      return { ...i, manualPhone, phoneInvalid, checked };
    }),
  });
}

function _reRenderStep8() {
  // Preservar scroll del contenedor de la tabla antes de re-renderizar
  const savedScroll = document.getElementById('s8-scroll')?.scrollTop || 0;
  const { step8Items, countryData, paisIdx, telIdx } = getState();
  renderStep8({
    step8Items, countryData, paisIdx, telIdx,
    onCountryChange: (ri, iso2) => { _handleStep8CountryChange(ri, iso2); _reRenderStep8(); },
    onCheckChange:   (ri, chk)  => { _handleStep8CheckChange(ri, chk);   _reRenderStep8(); },
    onCheckAll:      chk        => { _handleStep8CheckAll(chk);           _reRenderStep8(); },
    onPhoneChange:   (ri, val)  => _handleStep8PhoneChange(ri, val),
    onFilterChange:  ()         => _reRenderStep8(),
  });
  if (savedScroll) {
    const el = document.getElementById('s8-scroll');
    if (el) el.scrollTop = savedScroll;
  }
}

function _handleStep8ColsConfirmed(paisIdx, telIdx) {
  setState({ paisIdx, telIdx });
  if (paisIdx === -1 && telIdx === -1) {
    $('sb8').innerHTML = `<span style="color:var(--t2)">${t('country.step_skipped')}</span>`;
    $('si8').textContent = t('misc.no_changes');
    $('step8-panel').innerHTML = '';
    return;
  }
  _runStep8Analysis(paisIdx, telIdx);
  resetStep8Filter();
  _reRenderStep8();
}

function goStep8() {
  const { enabledSteps } = getState();
  if (enabledSteps.country === false) { _goNextEnabled('country'); return; }
  const { csv, countryData } = getState();
  setWizardStep('country');
  show('c8'); unlock('c8');

  if (!countryData?.length) {
    $('step8-panel').innerHTML = `<div class="sum-box" style="color:var(--t2)">${t('country.no_data')}</div>`;
    _scrollToCard($('c8'));
    return;
  }

  const headers = csv.headers;
  const { confirmedPaisIdx: cPais, confirmedTelIdx: cTel, _userClearedPais, _userClearedTel } = getState();
  const paisIdx = _userClearedPais  ? -1
                : (cPais != null && cPais >= 0) ? cPais
                : headers.findIndex(h => {
                    const n = _normHeader(h);
                    return n.includes('pais') || n.includes('country') || n.includes('nacion');
                  });
  const telIdx  = _userClearedTel   ? -1
                : (cTel != null && cTel >= 0) ? cTel
                : headers.findIndex(h => {
                    const n = _normHeader(h);
                    return n.includes('telefono') || n.includes('phone') || n.includes('celular') || n.includes('whatsapp') || n.includes('movil') || n.includes('móvil');
                  });

  if (paisIdx < 0 || telIdx < 0) {
    renderStep8ColSelector(headers, _handleStep8ColsConfirmed, paisIdx, telIdx);
  } else {
    _runStep8Analysis(paisIdx, telIdx);
    resetStep8Filter();
    _reRenderStep8();
    const detectedNames = [
      paisIdx >= 0 && t('country.pais_detected', headers[paisIdx]),
      telIdx  >= 0 && t('country.tel_detected', headers[telIdx]),
    ].filter(Boolean).join(' · ');
    toast(`✓ ${detectedNames}`);
  }
  _scrollToCard($('c8'));
}

// ════════════════════════════════════════════════════════════
//  PASO 10 — HOMOLOGACIÓN DE CAMPOS
// ════════════════════════════════════════════════════════════
let _homoAbortCtrl = null;

async function goStep10() {
  const { enabledSteps } = getState();
  if (enabledSteps.fieldhomol === false) { _goNextEnabled('fieldhomol'); return; }
  setWizardStep('fieldhomol');
  show('c10'); unlock('c10');

  // Limpiar tarjetas frozen de sesiones anteriores
  const sessCont = $('homo-sessions-container');
  if (sessCont) sessCont.innerHTML = '';

  setState({
    homoSrcCols: [], homoTargetMode: 'new', homoTargetName: '',
    homoTargetColIdx: -1, homoSelectedLibId: '',
    homoLibEntries: [], homoLibName: '', homoResults: [], aiStatus10: 'checking',
    homoSessions: [], homoSessionCount: 0, homoSessionSummaries: [],
  });

  let aiProviders = getState().aiProviders || [];
  if (!aiProviders.length) {
    const cfg = await fetch('/api/ai-config').then(r => r.json()).catch(() => ({}));
    aiProviders = Array.isArray(cfg.providers) ? cfg.providers : [];
    setState({ aiProviders });
  }
  const pid = getState().selectedProviderId || aiProviders[0]?.id || '';
  if (!getState().selectedProviderId && pid) setState({ selectedProviderId: pid });

  if (!getState()._homoPrompts) {
    const [promptData, cfg] = await Promise.all([
      fetch('/api/ai-prompts').then(r => r.json()).catch(() => ({})),
      fetch('/api/ai-config').then(r => r.json()).catch(() => ({})),
    ]);
    setState({
      _homoPrompts: promptData,
      homoPromptGenCustom:   cfg.homoPromptGen   || null,
      homoPromptMatchCustom: cfg.homoPromptMatch || null,
    });
  }

  _renderStep10Full();
  _scrollToCard($('c10'));

  const { aiProviders: providers, selectedProviderId } = getState();
  const provider = providers.find(p => p.id === selectedProviderId) || providers[0];
  const ok = provider ? await checkOllamaAvailable(provider.url) : false;
  setState({ aiStatus10: ok === true ? 'ok' : ok === 'cold' ? 'cold' : 'error' });
  _renderStep10Full();
}

function _renderStep10Full() {
  const { csv, colIdx, homoSrcCols, homoTargetMode, homoTargetName,
          homoTargetColIdx, homoSelectedLibId, homoLibEntries,
          homoLibName, homoResults, homoSessions, homoSessionCount, aiProviders, selectedProviderId, aiStatus10,
          fieldLibraries, _homoPrompts, homoPromptGenCustom, homoPromptMatchCustom } = getState();
  const genKey   = LANG === 'en' ? 'homoLibGen_en' : 'homoLibGen';
  const matchKey = LANG === 'en' ? 'homoMatch_en'  : 'homoMatch';
  const homoPromptGen   = homoPromptGenCustom   || _homoPrompts?.[genKey]?.user   || '';
  const homoPromptMatch = homoPromptMatchCustom || _homoPrompts?.[matchKey]?.user || '';
  renderStep9({
    csv, colIdx,
    homoSrcCols:        homoSrcCols        || [],
    homoTargetMode:     homoTargetMode     || 'new',
    homoTargetName:     homoTargetName     || '',
    homoTargetColIdx:   homoTargetColIdx   ?? -1,
    homoSelectedLibId:  homoSelectedLibId  || '',
    homoLibraries:      fieldLibraries     || [],
    homoLibEntries:     homoLibEntries     || [],
    homoLibName:        homoLibName        || '',
    homoResults:        homoResults        || [],
    homoSessions:       homoSessions       || [],
    homoSessionCount:   homoSessionCount   || 0,
    aiProviders:        aiProviders        || [],
    selectedProviderId10: selectedProviderId || '',
    aiStatus10:         aiStatus10         || 'checking',
    homoPromptGen,
    homoPromptMatch,
    onSrcColToggle:     _homoToggleSrcCol,
    onTargetModeChange: _homoSetTargetMode,
    onTargetNameChange: _homoSetTargetName,
    onTargetColChange:  _homoSetTargetCol,
    onLibSelect:        _homoSelectLib,
    onEditCanonical:    _homoEditCanonical,
    onAddVariant:       _homoAddVariant,
    onRemoveVariant:    _homoRemoveVariant,
    onAddCanonical:     _homoAddCanonical,
    onDeleteCanonical:  _homoDeleteCanonical,
    onLibNameChange:    _homoSetLibName,
    onSaveLib:          _homoSaveLib,
    onNewLib:           _homoNewLib,
    onEditLib:          _homoEditLib,
    onDeleteLib:        _homoDeleteLib,
    onGenLibWithAI:     _homoGenLibWithAI,
    onApplyVariants:    _homoApplyVariants,
    onRunHomolog:       _homoRunHomolog,
    onCancelHomolog:    _homoCancelHomolog,
    onSkip:             _homoSkip,
    onOtro:             _homoApplyAndRepeat,
    onApply:            _homoApply,
    onSavePromptGen:    _homoSavePromptGen,
    onSavePromptMatch:  _homoSavePromptMatch,
    onEditCanonicalResult: _homoEditCanonicalResult,
    onProvider10Change: _homoProviderChange,
    onRetryHomo:        _homoRetryOllama,
    onRender:           _renderStep10Full,
  });
}

function _homoToggleSrcCol(colIdx) {
  setState({ homoSrcCols: [colIdx] });
  _renderStep10Full();
}

function _homoSetTargetMode(mode) { setState({ homoTargetMode: mode }); _renderStep10Full(); }
function _homoSetTargetName(name) { setState({ homoTargetName: name }); /* no re-render: input already has the value */ }
function _homoSetTargetCol(idx)   { setState({ homoTargetColIdx: idx }); _renderStep10Full(); }
function _homoSelectLib(libId) {
  const { fieldLibraries } = getState();
  const lib = (fieldLibraries || []).find(l => (l.id || l.name) === libId);
  const entries = lib ? (lib.entries || []).map(e => ({ canonical: e.canonical || '', variants: [...(e.variants || [])] })) : [];
  setState({ homoSelectedLibId: libId, homoLibEntries: entries, homoLibName: lib?.name || '' });
  _renderStep10Full();
}

function _homoNewLib() {
  setState({ homoLibEntries: [], homoLibName: '' });
  _renderStep10Full();
}

function _homoEditLib(libId) {
  const { fieldLibraries } = getState();
  const lib = (fieldLibraries || []).find(l => (l.id || l.name) === libId);
  if (!lib) return;
  const entries = (lib.entries || []).map(e => ({ canonical: e.canonical || '', variants: [...(e.variants || [])] }));
  setState({ homoLibEntries: entries, homoLibName: lib.name });
  _renderStep10Full();
}

function _homoDeleteLib(libId) {
  const { fieldLibraries } = getState();
  const lib = (fieldLibraries || []).find(l => (l.id || l.name) === libId);
  if (!lib) return;
  if (!confirm(`¿Eliminar la biblioteca "${lib.name}"?`)) return;
  setState({ fieldLibraries: fieldLibraries.filter(l => (l.id || l.name) !== libId) });
  _saveFieldLibraries();
  _renderStep10Full();
  toast(`Biblioteca "${lib.name}" eliminada`);
}

function _homoEditCanonical(idx, value) {
  const { homoLibEntries } = getState();
  setState({ homoLibEntries: homoLibEntries.map((e, i) => i === idx ? { ...e, canonical: value } : e) });
  _renderStep10Full();
}

function _homoAddVariant(idx, value) {
  if (!value.trim()) return;
  const { homoLibEntries } = getState();
  setState({
    homoLibEntries: homoLibEntries.map((e, i) =>
      i !== idx || e.variants.includes(value.trim()) ? e : { ...e, variants: [...e.variants, value.trim()] }
    ),
  });
  _renderStep10Full();
}

function _homoRemoveVariant(idx, varIdx) {
  const { homoLibEntries } = getState();
  setState({
    homoLibEntries: homoLibEntries.map((e, i) =>
      i === idx ? { ...e, variants: e.variants.filter((_, vi) => vi !== varIdx) } : e
    ),
  });
  _renderStep10Full();
}

function _homoAddCanonical() {
  const { homoLibEntries } = getState();
  setState({ homoLibEntries: [...homoLibEntries, { canonical: '', variants: [] }] });
  _renderStep10Full();
}

function _homoDeleteCanonical(idx) {
  const { homoLibEntries } = getState();
  setState({ homoLibEntries: homoLibEntries.filter((_, i) => i !== idx) });
  _renderStep10Full();
}

function _homoSetLibName(name) { setState({ homoLibName: name }); }

function _homoSaveLib() {
  const { homoLibEntries, homoLibName, fieldLibraries } = getState();
  const name    = (homoLibName || '').trim();
  if (!name) { toast('Ingresá un nombre para la biblioteca', 'warn'); return; }
  const entries = homoLibEntries.filter(e => e.canonical.trim());
  if (!entries.length) { toast('Agregá al menos un canónico', 'warn'); return; }
  const existing = (fieldLibraries || []).find(l => l.name.trim().toLowerCase() === name.toLowerCase());
  let updated;
  if (existing) {
    updated = fieldLibraries.map(l => l.id === existing.id ? { ...l, entries, updatedAt: new Date().toISOString() } : l);
    toast(`Biblioteca "${name}" actualizada`);
  } else {
    updated = [...(fieldLibraries || []), { id: 'hlib_' + Date.now(), name, entries, createdAt: new Date().toISOString() }];
    toast(`Biblioteca "${name}" guardada`);
  }
  setState({ fieldLibraries: updated });
  _saveFieldLibraries();
  setHomoLibEditorOpen(false);
  _renderStep10Full();
}

function _buildUniqueValuesPerField(csv, srcCols, dupExcluded, testExcluded) {
  return srcCols.map(fi => {
    const name = csv.headers[fi] || `Campo ${fi + 1}`;
    const seen = new Set();
    csv.rows.forEach((row, ri) => {
      if (dupExcluded?.has(ri) || testExcluded?.has(ri)) return;
      if (!row.some(c => (c || '').trim())) return;
      const val = (row[fi] || '').trim();
      if (val) seen.add(val);
    });
    return { name, values: [...seen] };
  });
}

// Pre-matching avanzado: contención + consenso multi-campo
// Normalización insensible a mayúsculas Y acentos para comparación de homologación.
// NFD descompone los chars (é → e + combining), luego se eliminan los diacríticos.
const _normCI = s => (s || '').trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function _preMatchAdvanced(srcValues, libEntries) {
  const norm = v => ' ' + _normCI(v) + ' ';
  const texts = srcValues.map(v => norm(v));
  const nonEmpty = texts.filter(t => t.trim().length > 0);
  if (!nonEmpty.length) return null;

  // Paso 1: algún campo contiene exactamente una variante completa (≥4 chars)
  for (const entry of libEntries) {
    const terms = [entry.canonical, ...(entry.variants || [])].map(t => _normCI(t)).filter(t => t.length >= 4);
    for (const term of terms) {
      const padded = ' ' + term + ' ';
      for (const ft of texts) {
        if (ft.includes(padded)) return entry.canonical;
      }
    }
  }

  // Paso 2: misma variante (≥3 chars) encontrada en 2+ campos → consenso
  for (const entry of libEntries) {
    const terms = [entry.canonical, ...(entry.variants || [])].map(t => _normCI(t)).filter(t => t.length >= 3);
    for (const term of terms) {
      const padded = ' ' + term + ' ';
      if (texts.filter(ft => ft.includes(padded)).length >= 2) return entry.canonical;
    }
  }

  return null;
}

function _homoSetupResults() {
  const { csv, homoSrcCols, homoLibEntries, dupExcluded, testExcluded } = getState();

  // Mapa de lookup para JS pre-matching exacto: texto normalizado (sin case ni acentos) → canónico
  const canonicalLookup = new Map();
  for (const entry of (homoLibEntries || [])) {
    const canon = (entry.canonical || '').trim();
    if (!canon) continue;
    canonicalLookup.set(_normCI(canon), canon);
    for (const v of (entry.variants || [])) {
      const vn = (v || '').trim();
      if (vn) canonicalLookup.set(_normCI(vn), canon);
    }
  }

  // Agrupar filas por combinación de valores fuente
  const comboMap = new Map();
  csv.rows.forEach((row, ri) => {
    if (dupExcluded?.has(ri) || testExcluded?.has(ri)) return;
    if (!row.some(c => (c || '').trim())) return;
    const srcValues = homoSrcCols.map(fi => (row[fi] || '').trim());
    const key = JSON.stringify(srcValues);
    if (!comboMap.has(key)) comboMap.set(key, { srcValues, rowIdxs: [] });
    comboMap.get(key).rowIdxs.push(ri);
  });

  // Construir resultados con pre-matching (exacto → avanzado → pendiente para IA)
  const homoResults = [...comboMap.values()].map(({ srcValues, rowIdxs }) => {
    let canonical = null;
    let status = 'pending';
    // 1. Match exacto (insensible a mayúsculas y acentos)
    for (const val of srcValues) {
      const k = _normCI(val);
      if (canonicalLookup.has(k)) { canonical = canonicalLookup.get(k); status = 'js-match'; break; }
    }
    // 2. Match avanzado (contención + multi-campo)
    if (status === 'pending') {
      const adv = _preMatchAdvanced(srcValues, homoLibEntries || []);
      if (adv) { canonical = adv; status = 'js-match'; }
    }
    return { srcValues, canonical, status, rowIdxs };
  });

  setState({ homoResults });
}

function _homoApplyVariants() {
  const { homoSrcCols, homoLibEntries } = getState();
  if (!homoSrcCols.length) { toast('Seleccioná al menos un campo fuente', 'warn'); return; }
  if (!homoLibEntries.length) { toast('Seleccioná o creá una biblioteca', 'warn'); return; }
  _homoSetupResults();
  _renderStep10Full();
}

function _homoEditCanonicalResult(ri, value) {
  const { homoResults } = getState();
  const updated = homoResults.map((r, i) => i === ri ? { ...r, canonical: value || null, status: 'manual' } : r);
  setState({ homoResults: updated });
  _renderStep10Full();
}

async function _homoSavePromptGen(value) {
  setState({ homoPromptGenCustom: value === null ? null : value });
  try {
    await fetch('/api/ai-config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ homoPromptGen: value }),
    });
    toast(value !== null ? 'Prompt de librería guardado' : 'Prompt de librería restaurado');
  } catch { toast('Error al guardar el prompt', 'error'); }
  _renderStep10Full();
}

async function _homoSavePromptMatch(value) {
  setState({ homoPromptMatchCustom: value === null ? null : value });
  try {
    await fetch('/api/ai-config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ homoPromptMatch: value }),
    });
    toast(value !== null ? 'Prompt de homologación guardado' : 'Prompt de homologación restaurado');
  } catch { toast('Error al guardar el prompt', 'error'); }
  _renderStep10Full();
}

async function _homoGenLibWithAI() {
  const { csv, homoSrcCols, aiProviders, selectedProviderId, aiStatus10,
          dupExcluded, testExcluded, _homoPrompts } = getState();
  if (aiStatus10 !== 'ok' && aiStatus10 !== 'cold') { toast('IA no disponible', 'warn'); return; }

  const fieldData   = _buildUniqueValuesPerField(csv, homoSrcCols, dupExcluded, testExcluded);
  const totalUnique = fieldData.reduce((a, f) => a + f.values.length, 0);

  renderStep9ProgressThinking();
  setState({ homoLibEntries: [] });
  _renderStep10Full();

  const entries = totalUnique <= 250
    ? await _homoGenLibSingle(fieldData, selectedProviderId, _homoPrompts)
    : await _homoGenLibChunked(fieldData, selectedProviderId, _homoPrompts);

  renderStep9Progress(0, 0);

  if (!entries) {
    toast('La IA no pudo generar la biblioteca', 'error');
    _renderStep10Full();
    return;
  }

  setState({ homoLibEntries: entries, homoLibName: '' });
  setHomoLibEditorOpen(true);
  _renderStep10Full();
}

async function _homoGenLibSingle(fieldData, providerId, promptData) {
  const promptKey = LANG === 'en' ? 'homoLibGen_en' : 'homoLibGen';
  const { homoPromptGenCustom } = getState();
  const template  = homoPromptGenCustom || promptData?.[promptKey]?.user || '';
  const fieldValuesStr = fieldData.map(f =>
    `Campo "${f.name}":\n${f.values.slice(0, 150).join('\n')}`
  ).join('\n\n');
  const result = await callAI(template.replace('{{FIELD_VALUES}}', fieldValuesStr), { providerId, promptKey });
  if (!result?.ok) return null;
  try {
    const parsed = JSON.parse(result.text);
    return (parsed.library || []).map(e => ({ canonical: e.canonical || '', variants: e.variants || [] }));
  } catch { return null; }
}

async function _homoGenLibChunked(fieldData, providerId, promptData) {
  const genKey    = LANG === 'en' ? 'homoLibGen_en'   : 'homoLibGen';
  const mergeKey  = LANG === 'en' ? 'homoLibMerge_en' : 'homoLibMerge';
  const { homoPromptGenCustom } = getState();
  const genTpl    = homoPromptGenCustom || promptData?.[genKey]?.user   || '';
  const mergeTpl  = promptData?.[mergeKey]?.user || '';

  // Dividir en chunks de ≤150 valores únicos totales
  const chunks = [];
  let cur = [], count = 0;
  for (const field of fieldData) {
    let i = 0;
    while (i < field.values.length) {
      const slice = field.values.slice(i, i + (150 - count));
      const existing = cur.find(f => f.name === field.name);
      if (existing) existing.values.push(...slice); else cur.push({ name: field.name, values: slice });
      count += slice.length;
      i     += slice.length;
      if (count >= 150 && i < field.values.length) { chunks.push(cur); cur = []; count = 0; }
    }
  }
  if (cur.length) chunks.push(cur);

  const total = chunks.length + 1;
  const partials = [];
  for (let ci = 0; ci < chunks.length; ci++) {
    renderStep9Progress(ci + 1, total);
    const fvStr  = chunks[ci].map(f => `Campo "${f.name}":\n${f.values.join('\n')}`).join('\n\n');
    const result = await callAI(genTpl.replace('{{FIELD_VALUES}}', fvStr), { providerId, promptKey: genKey });
    if (!result?.ok) return null;
    try { const p = JSON.parse(result.text); if (p.library) partials.push(p.library); } catch { return null; }
  }

  renderStep9Progress(total, total);
  const mergeResult = await callAI(
    mergeTpl.replace('{{LIBRARIES}}', JSON.stringify(partials, null, 2)),
    { providerId, promptKey: mergeKey }
  );
  if (!mergeResult?.ok) return null;
  try {
    const parsed = JSON.parse(mergeResult.text);
    return (parsed.library || []).map(e => ({ canonical: e.canonical || '', variants: e.variants || [] }));
  } catch { return null; }
}

async function _homoRunHomolog() {
  const { homoResults, homoLibEntries, homoSrcCols, csv, selectedProviderId,
          aiStatus10, _homoPrompts } = getState();
  if (aiStatus10 !== 'ok' && aiStatus10 !== 'cold') { toast('IA no disponible', 'warn'); return; }

  _homoAbortCtrl = new AbortController();
  const { signal } = _homoAbortCtrl;

  const cancelBtn = $('btn-c10-cancel-homolog');
  const runBtn    = $('btn-c10-run-homolog');
  if (cancelBtn) cancelBtn.style.display = '';
  if (runBtn)    runBtn.style.display    = 'none';

  const promptKey = LANG === 'en' ? 'homoMatch_en' : 'homoMatch';
  const { homoPromptMatchCustom } = getState();
  const template  = homoPromptMatchCustom || _homoPrompts?.[promptKey]?.user || '';
  const libJson   = JSON.stringify(homoLibEntries.map(e => ({ canonical: e.canonical, variants: e.variants })));
  const headers   = homoSrcCols.map(fi => csv.headers[fi] || `Campo ${fi + 1}`);

  // Excluir combinaciones sin valor real — no tiene sentido pedirle a la IA que homologue un campo vacío
  const pending = (homoResults || []).filter(r => r.status === 'pending' && r.srcValues.some(v => (v || '').trim()));
  let done = 0;
  renderStep9Progress(0, pending.length);

  for (const result of pending) {
    if (signal.aborted) break;
    // Saltar filas que el usuario editó manualmente durante el proceso
    if (result.status === 'manual') { done++; renderStep9Progress(done, pending.length); continue; }
    const fvStr = result.srcValues.map((v, i) => `${headers[i]}: ${v || '—'}`).join('\n');
    const prompt = template.replace('{{FIELD_VALUES}}', fvStr).replace('{{LIBRARY}}', libJson);
    const aiResult = await callAI(prompt, { providerId: selectedProviderId, promptKey, signal });
    if (signal.aborted) break;
    // Re-verificar: el usuario puede haber editado mientras esperábamos la respuesta de la IA
    if (result.status === 'manual') { done++; renderStep9Progress(done, pending.length); continue; }
    if (aiResult?.ok) {
      try {
        const parsed     = JSON.parse(aiResult.text);
        result.canonical = parsed.canonical || null;
      } catch { result.canonical = null; }
    } else { result.canonical = null; }
    result.status = 'done';
    done++;
    const { homoResults: cur, homoSrcCols: sc, csv: curCsv } = getState();
    setState({ homoResults: [...cur] });
    renderStep9Progress(done, pending.length);
    // Actualización quirúrgica: solo la fila que cambió, sin destruir ediciones en curso
    const ri = getState().homoResults.indexOf(result);
    if (!updateC10ResultRow(ri, result)) {
      renderC10ResultsOnly({ homoResults: getState().homoResults, homoSrcCols: sc, csv: curCsv });
    }
  }

  renderStep9Progress(0, 0);
  if (cancelBtn) cancelBtn.style.display = 'none';
  if (runBtn)    runBtn.style.display    = '';
  _homoAbortCtrl = null;
  _renderStep10Full();
}

function _homoCancelHomolog() { _homoAbortCtrl?.abort(); }

function _homoSkip() {
  // Limpiar sesión activa sin aplicar; las anteriores (vía Otro) ya están en el CSV
  setState({ homoResults: [], homoSrcCols: [] });
  _skipStep('fieldhomol');
}

function _homoApply() {
  const { homoResults, homoSrcCols, homoTargetMode, homoTargetName, homoTargetColIdx } = getState();
  let { csv } = getState();

  // Aplica solo la sesión activa (las anteriores ya se aplicaron vía "Otro")
  if ((homoResults || []).some(r => r.canonical) && homoSrcCols?.length > 0) {
    const rowToCanonical = new Map();
    for (const r of (homoResults || [])) {
      for (const ri of r.rowIdxs) rowToCanonical.set(ri, r.canonical || '');
    }
    if (homoTargetMode === 'new') {
      const name = (homoTargetName || 'Homologado').trim();
      csv = { ...csv, headers: [...csv.headers, name], rows: csv.rows.map((row, ri) => [...row, rowToCanonical.get(ri) || '']) };
    } else {
      const fi = homoTargetColIdx;
      csv = { ...csv, rows: csv.rows.map((row, ri) => { const r = [...row]; if (rowToCanonical.has(ri)) r[fi] = rowToCanonical.get(ri); return r; }) };
    }
    setState({ csv });
    broadcastCsvUpdate(csv);
  }

  toast('Homologación aplicada');
  _enableStep('fieldhomol');
  _goNextEnabled('fieldhomol');
}

function _homoApplyAndRepeat() {
  const { homoResults, homoSrcCols, homoTargetMode, homoTargetName, homoTargetColIdx,
          homoSessions, homoSessionCount, homoSessionSummaries } = getState();
  let { csv } = getState();

  // Capturar headers ANTES de aplicar (para mostrar nombres correctos en la tarjeta frozen)
  const prevHeaders = [...csv.headers];

  // Aplicar al CSV ahora
  const rowToCanonical = new Map();
  for (const r of (homoResults || [])) {
    for (const ri of r.rowIdxs) rowToCanonical.set(ri, r.canonical || '');
  }
  if (homoTargetMode === 'new') {
    const name = (homoTargetName || 'Homologado').trim();
    csv = { ...csv, headers: [...csv.headers, name], rows: csv.rows.map((row, ri) => [...row, rowToCanonical.get(ri) || '']) };
  } else {
    const fi = homoTargetColIdx;
    csv = { ...csv, rows: csv.rows.map((row, ri) => { const r = [...row]; if (rowToCanonical.has(ri)) r[fi] = rowToCanonical.get(ri); return r; }) };
  }

  // Calcular stats de la sesión para la tarjeta frozen y el resumen
  const fieldNames  = (homoSrcCols || []).map(fi => prevHeaders[fi] || `Col ${fi+1}`).join(', ');
  const destName    = homoTargetMode === 'new' ? (homoTargetName || 'Homologado').trim() : (prevHeaders[homoTargetColIdx] || '');
  const completados = (homoResults || []).filter(r => r.canonical).reduce((a, r) => a + r.rowIdxs.length, 0);
  const total       = (homoResults || []).reduce((a, r) => a + r.rowIdxs.length, 0);
  const sessionNum  = homoSessionCount + 1; // 1-based para la primera sesión
  const label       = sessionNum === 1 ? '08' : `08/0${sessionNum}`;
  const nextLabel   = `08/0${sessionNum + 1}`;

  // Construir tabla de resultados para el toggle "Ver"
  const srcHdrs = (homoSrcCols || []).map((fi, idx) => {
    const COLS = ['#60A5FA','#34D399','#F59E0B','#C084FC','#F87171','#22D3EE','#FB923C','#A3E635'];
    return `<th style="color:${COLS[idx % COLS.length]}">${esc(prevHeaders[fi] || `Col ${fi+1}`)}</th>`;
  }).join('');
  const resultRows = (homoResults || []).map(r => {
    const srcCells = (r.srcValues || []).map(v => `<td><span class="mono t-dim" style="font-size:11px">${esc(v||'—')}</span></td>`).join('');
    const badge =
      r.status === 'js-match' ? `<span class="tag tag-var">{V}</span>` :
      r.status === 'done'     ? (r.canonical ? `<span class="tag tag-ia">IA</span>`  : `<span style="color:var(--t3);font-size:10px">—</span>`) :
      r.status === 'manual'   ? (r.canonical ? `<span class="tag tag-man">✎</span>` : `<span style="color:var(--t3);font-size:10px">—</span>`) :
      `<span style="color:var(--t3);font-size:10px">—</span>`;
    const cColor = r.canonical
      ? (r.status==='manual' ? 'var(--warn)' : r.status==='done' ? 'var(--ai)' : 'var(--accent)')
      : 'var(--t3)';
    const rowNums = r.rowIdxs.length <= 3
      ? r.rowIdxs.map(i => i + 2).join(', ')
      : `${r.rowIdxs[0]+2}…(${r.rowIdxs.length})`;
    return `<tr>
      <td><span class="mono t-dim" style="font-size:10px">${esc(rowNums)}</span></td>
      ${srcCells}
      <td style="font-size:12px;font-weight:500;color:${cColor}">${esc(r.canonical||'—')}</td>
      <td>${badge}</td>
    </tr>`;
  }).join('');

  const resultsId = `homo-frozen-results-${sessionNum}`;

  // Insertar tarjeta frozen en el contenedor
  const container = $('homo-sessions-container');
  if (container) {
    const frozenCard = document.createElement('div');
    frozenCard.className = 'card';
    frozenCard.style.marginBottom = '10px';
    frozenCard.innerHTML = `
      <div class="card-title">
        <span class="card-num">${label}</span> — <span>${t('homol.title') || 'Homologación de campos'}</span>
        <span class="card-done-badge">✓ Aplicada</span>
        <span class="card-done-summary">${esc(fieldNames)} → <span style="color:var(--accent)">${esc(destName)}</span> · ${completados} / ${total}</span>
        <button id="btn-ver-${resultsId}" class="btn btn-g btn-xs" style="margin-left:auto;font-size:11px">▶ Ver</button>
      </div>
      <div id="${resultsId}" style="display:none;margin-top:8px">
        <div class="twrap" style="max-height:240px;overflow-y:auto">
          <table style="width:100%;border-collapse:separate;border-spacing:0;font-size:12px">
            <thead style="position:sticky;top:0;z-index:10;isolation:isolate">
              <tr>
                <th style="min-width:54px;font-size:10px">Fila(s)</th>
                ${srcHdrs}
                <th>→ Canónico</th>
                <th style="width:44px">Est.</th>
              </tr>
            </thead>
            <tbody>${resultRows || `<tr><td colspan="99" style="padding:10px;text-align:center;color:var(--t3)">Sin resultados</td></tr>`}</tbody>
          </table>
        </div>
      </div>`;
    container.appendChild(frozenCard);

    // Toggle Ver / Ocultar
    frozenCard.querySelector(`#btn-ver-${resultsId}`)?.addEventListener('click', function() {
      const panel = frozenCard.querySelector(`#${resultsId}`);
      const open  = panel.style.display === 'none';
      panel.style.display = open ? '' : 'none';
      this.textContent   = open ? '▾ Ocultar' : '▶ Ver';
    });
  }

  // Actualizar título del card activo al siguiente número
  const titleEl = $('ct10');
  if (titleEl) titleEl.innerHTML = `<span class="card-num">${nextLabel}</span> — <span>${t('homol.title') || 'Homologación de campos'}</span>`;

  const snapshot = {
    srcCols: [...(homoSrcCols || [])], srcHeaders: prevHeaders,
    results: [...(homoResults || [])],
    targetMode: homoTargetMode || 'new', targetName: homoTargetName || '', targetColIdx: homoTargetColIdx ?? -1,
  };
  const summary = { label, fieldNames, destName, completados, total };

  setState({
    csv,
    homoSessions:         [...(homoSessions || []), snapshot],
    homoSessionCount:     sessionNum,
    homoSessionSummaries: [...(homoSessionSummaries || []), summary],
    homoResults:          [],
    homoSrcCols:          [],
    homoTargetMode:       'new',
    homoTargetName:       '',
    homoTargetColIdx:     -1,
  });
  broadcastCsvUpdate(csv);
  _renderStep10Full();
}

function _homoProviderChange(newId) {
  const { aiProviders } = getState();
  setState({ selectedProviderId: newId, aiStatus10: 'checking' });
  _renderStep10Full();
  const provider = (aiProviders || []).find(p => p.id === newId);
  checkOllamaAvailable(provider?.url || '').then(ok => {
    setState({ aiStatus10: ok === true ? 'ok' : ok === 'cold' ? 'cold' : 'error' });
    _renderStep10Full();
  });
}

function _homoRetryOllama() {
  const { aiProviders, selectedProviderId } = getState();
  const provider = (aiProviders || []).find(p => p.id === selectedProviderId);
  setState({ aiStatus10: 'checking' });
  _renderStep10Full();
  checkOllamaAvailable(provider?.url || '').then(ok => {
    setState({ aiStatus10: ok === true ? 'ok' : ok === 'cold' ? 'cold' : 'error' });
    _renderStep10Full();
    if (ok) toast(t('toast.connected'));
    else toast(t('toast.server_no_response'), 'error');
  });
}

// Normaliza el formato antiguo {values:[...]} al nuevo {entries:[{canonical,variants}]}
function _normalizeLibraries(libs) {
  return (libs || []).map(lib => {
    if (lib.entries) return lib;
    const entries = (lib.values || []).map(v => ({ canonical: v, variants: [] }));
    return { ...lib, entries };
  });
}

async function _saveFieldLibraries() {
  const { fieldLibraries } = getState();
  await fetch('/api/field-homologated', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ libraries: fieldLibraries }),
  }).catch(() => {});
}


// ════════════════════════════════════════════════════════════
//  PASO 9 — COMPLETAR NOMBRE/APELLIDO CON IA
// ════════════════════════════════════════════════════════════
let _nameAIAbortCtrl = null;

async function goStep9() {
  const { enabledSteps } = getState();
  if (enabledSteps.nameai === false) { _goNextEnabled('nameai'); return; }
  setWizardStep('nameai');
  show('c9'); unlock('c9');

  // Cargar prompt desde config si aún no está en estado (por idioma)
  let aiPrompt = getState().aiPrompt;
  if (!aiPrompt) {
    try {
      const [cfg, prompts] = await Promise.all([
        fetch('/api/ai-config').then(r => r.json()),
        fetch('/api/ai-prompts').then(r => r.json()).catch(() => ({})),
      ]);
      const defaultKey = LANG === 'en' ? 'nameExtractor_en' : 'nameExtractor';
      const defaultPrompt = prompts[defaultKey]?.user || prompts.nameExtractor?.user || '';
      const customKey = LANG === 'en' ? 'prompt_en' : 'prompt_es';
      aiPrompt = cfg[customKey] || defaultPrompt;
      setState({ aiPrompt, _nameaiDefaultPrompt: defaultPrompt });
    } catch { /* usa default de ai.js */ }
  }

  const { csv, colIdx, dupExcluded, testExcluded } = getState();

  // Auto-detectar columnas nombre y apellido (preferir confirmación del usuario)
  const { confirmedNombreIdx: _cN, confirmedApellidoIdx: _cA, confirmedEmpresaIdx: _cEmpN } = getState();
  const nameaiIdx  = (_cN    != null) ? _cN    : csv.headers.findIndex(h => /nombre|first.?name/i.test(h.trim()));
  const apellaiIdx = (_cA    != null) ? _cA    : csv.headers.findIndex(h => /apellido|last.?name|surname/i.test(h.trim()));
  // Detectar empresa localmente para mostrar en la tabla (goStep7 aún no corrió)
  const _empresaIdxLocal = (_cEmpN != null) ? _cEmpN : csv.headers.findIndex(h =>
    /empresa[s]?|raz[oó]n\s*(?:de\s*)?social|nombre.{0,20}fant[aá]s[ií]a?|compan(?:y|ies?)(?:\s*name)?|business(?:\s*name)?|\borganiz|\bnegocio/i.test(h.trim())
  );

  // Incluir todas las filas no excluidas con email — needsCompletion indica si falta algún campo
  const nameaiItems = [];
  csv.rows.forEach((row, ri) => {
    if (dupExcluded.has(ri) || testExcluded.has(ri)) return;
    if (!row.some(c => (c||'').trim())) return;
    const email     = (row[colIdx] || '').trim();
    if (!email) return;
    const origNom   = nameaiIdx  >= 0 ? (row[nameaiIdx]  || '').trim() : '';
    const origApell = apellaiIdx >= 0 ? (row[apellaiIdx] || '').trim() : '';
    const needsNom   = nameaiIdx  >= 0 && !origNom;
    const needsApell = apellaiIdx >= 0 && !origApell;
    const needsCompletion = needsNom || needsApell;
    nameaiItems.push({
      rowIdx: ri, email,
      empresa: _empresaIdxLocal >= 0 ? (row[_empresaIdxLocal] || '').trim() : '',
      origNombre: origNom, origApellido: origApell,
      // Filas que necesitan completar: normalizar case del valor existente (comportamiento previo)
      // Filas ya completas: mantener valor original sin tocar hasta que el usuario lo cambie
      editNombre:   needsCompletion
        ? (origNom   ? applyCaseValue(origNom,   'lower_cap') : '')
        : origNom,
      editApellido: needsCompletion
        ? (origApell ? applyCaseValue(origApell, 'lower_cap') : '')
        : origApell,
      aiNombre: '', aiApellido: '',
      nombreChecked:   needsNom,
      apellidoChecked: needsApell,
      status: 'pending', needsNom, needsApell, needsCompletion, caseModified: false,
    });
  });

  // Cargar providers disponibles
  let aiProviders = getState().aiProviders || [];
  if (!aiProviders.length) {
    try {
      const r = await fetch('/api/ai-config');
      const d = await r.json();
      aiProviders = Array.isArray(d.providers) ? d.providers : [];
      setState({ aiProviders });
    } catch { /* sin providers */ }
  }
  const selectedProviderId = getState().selectedProviderId || aiProviders[0]?.id || '';
  if (!getState().selectedProviderId && selectedProviderId) setState({ selectedProviderId });

  setState({ nameaiIdx, apellaiIdx, nameaiItems, nameaiFields: ['nombre', 'apellido'] });
  _renderNameAIFull(nameaiItems, nameaiIdx, apellaiIdx, aiPrompt);
  _scrollToCard($('c9'));

  // Health check no bloqueante al entrar al paso
  const selProvider = aiProviders.find(p => p.id === selectedProviderId);
  renderStep10OllamaStatus('checking', aiProviders, selectedProviderId, handleStep10ProviderChange);
  checkOllamaAvailable(selProvider?.url).then(ok =>
    renderStep10OllamaStatus(ok === true ? 'ok' : ok === 'cold' ? 'cold' : 'error', aiProviders, selectedProviderId, handleStep10ProviderChange)
  );
}

function _renderNameAIFull(nameaiItems, nameaiIdx, apellaiIdx, aiPrompt) {
  renderStep10({
    nameaiItems, nameaiIdx, apellaiIdx, aiPrompt,
    onAnalyze:        handleNameAIAnalyze,
    onCancel:         handleNameAICancel,
    onCheckNombre:    handleNameAICheckNombre,
    onCheckApellido:  handleNameAICheckApellido,
    onEditNombre:     handleNameAIEditNombre,
    onEditApellido:   handleNameAIEditApellido,
    onRetryOllama:    handleNameAIRetryOllama,
    onSavePrompt:     handleNameAISavePrompt,
    onLowerCapAll:    handleNameAILowerCapAll,
  });
}

function handleNameAILowerCapAll() {
  const { nameaiItems, nameaiIdx, apellaiIdx, aiPrompt } = getState();
  const _needsCase = v => !!v && applyCaseValue(v, 'lower_cap') !== v;
  const updated = nameaiItems.map(i => {
    const newNom   = _needsCase(i.editNombre)   ? applyCaseValue(i.editNombre,   'lower_cap') : i.editNombre;
    const newApell = _needsCase(i.editApellido) ? applyCaseValue(i.editApellido, 'lower_cap') : i.editApellido;
    const changed  = newNom !== i.editNombre || newApell !== i.editApellido;
    return changed
      ? { ...i, editNombre: newNom, editApellido: newApell, caseModified: true,
          nombreCaseModified: newNom !== i.editNombre, apellidoCaseModified: newApell !== i.editApellido }
      : i;
  });
  setState({ nameaiItems: updated });
  _renderNameAIFull(updated, nameaiIdx, apellaiIdx, aiPrompt);
}

async function handleNameAIAnalyze(promptText) {
  const { aiProviders, selectedProviderId, provider } = _getStep10ProviderContext();
  const ok = await checkOllamaAvailable(provider?.url);
  if (!ok && ok !== 'cold') {
    renderStep10OllamaStatus('error', aiProviders, selectedProviderId, handleStep10ProviderChange);
    toast(t('toast.llm_no_response'), 'error');
    return;
  }

  _nameAIAbortCtrl = new AbortController();
  let { nameaiItems, nameaiIdx, apellaiIdx, aiPrompt } = getState();
  let pending = nameaiItems.filter(i => i.status === 'pending' && (i.nombreChecked || i.apellidoChecked));
  // Si no hay pendientes pero hay procesados, resetear para permitir re-run limpio
  if (!pending.length && nameaiItems.some(i => i.status === 'done' && (i.nombreChecked || i.apellidoChecked))) {
    nameaiItems = nameaiItems.map(i =>
      i.status === 'done' && (i.nombreChecked || i.apellidoChecked)
        ? { ...i, status: 'pending', aiNombre: '', aiApellido: '',
            editNombre:   i.editNombre   === i.aiNombre   ? i.origNombre   : i.editNombre,
            editApellido: i.editApellido === i.aiApellido ? i.origApellido : i.editApellido }
        : { ...i }
    );
    setState({ nameaiItems });
    pending = nameaiItems.filter(i => i.status === 'pending' && (i.nombreChecked || i.apellidoChecked));
  }
  if (!pending.length) { toast(t('toast.no_fields_process'), 'warn'); return; }

  const _waitTime = provider?.waitTime || 0;
  const PER_ITEM_TIMEOUT_MS = 45000; // 45s por ítem: falla rápido si el modelo no responde

  // Deshabilitar botón durante el proceso
  const btn = $('btn-nameai-analyze');
  if (btn) { btn.disabled = true; btn.textContent = t('misc.processing'); }

  renderStep10Progress(0, pending.length);
  let errCount = 0;

  for (let i = 0; i < pending.length; i++) {
    if (_nameAIAbortCtrl.signal.aborted) break;

    renderStep10Progress(i + 1, pending.length);
    const item = pending[i];

    // Timeout por ítem independiente del cancel global
    const itemCtrl  = new AbortController();
    const timeoutId = setTimeout(() => itemCtrl.abort(), PER_ITEM_TIMEOUT_MS);
    const onCancel  = () => itemCtrl.abort();
    _nameAIAbortCtrl.signal.addEventListener('abort', onCancel, { once: true });

    const result = await extractNameParts(item.email, {
      signal:       itemCtrl.signal,
      customPrompt: promptText || undefined,
      nombre:       item.editNombre,
      apellido:     item.editApellido,
      providerId:   selectedProviderId || undefined,
    });

    clearTimeout(timeoutId);
    _nameAIAbortCtrl.signal.removeEventListener('abort', onCancel);

    if (_nameAIAbortCtrl.signal.aborted) break;

    const timedOut = itemCtrl.signal.aborted;
    if (timedOut || !result.ok) {
      item.status = 'error';
      errCount++;
    } else {
      // Solo sobrescribir el campo si el checkbox estaba marcado Y la IA encontró algo
      if (item.nombreChecked && result.firstName) {
        item.aiNombre    = result.firstName;
        item.editNombre  = result.firstName;
      }
      if (item.apellidoChecked && result.lastName) {
        item.aiApellido  = result.lastName;
        item.editApellido = result.lastName;
      }
      item.status = 'done';
    }

    setState({ nameaiItems: [...nameaiItems] });
    if (_waitTime > 0 && i < pending.length - 1) await new Promise(r => setTimeout(r, _waitTime));

    // Actualizar tabla progresivamente sin tocar el panel de acción
    renderStep10({ nameaiItems, nameaiIdx, apellaiIdx, aiPrompt, tableOnly: true,
      onAnalyze:       handleNameAIAnalyze,
      onCancel:        handleNameAICancel,
      onCheckNombre:   handleNameAICheckNombre,
      onCheckApellido: handleNameAICheckApellido,
      onEditNombre:    handleNameAIEditNombre,
      onEditApellido:  handleNameAIEditApellido,
      onRetryOllama:   handleNameAIRetryOllama,
      onSavePrompt:    handleNameAISavePrompt,
    });
  }

  // Limpiar progreso y restaurar botón via re-render completo
  const progressEl = $('c9-progress');
  if (progressEl) progressEl.innerHTML = '';
  const fresh = getState();
  _renderNameAIFull(fresh.nameaiItems, fresh.nameaiIdx, fresh.apellaiIdx, fresh.aiPrompt);
  const { aiProviders: freshProviders = [], selectedProviderId: freshPid = '' } = fresh;
  renderStep10OllamaStatus('ok', freshProviders, freshPid, handleStep10ProviderChange);

  const done = fresh.nameaiItems.filter(i => i.status === 'done' && (i.aiNombre || i.aiApellido)).length;
  if (!_nameAIAbortCtrl.signal.aborted) {
    if (errCount > 0) toast(`⚠ ${errCount} ítems sin respuesta del modelo (timeout). Podés reintentar.`, 'warn');
    else toast(t('toast.ai_analysis_done', done));
  }
}

function handleNameAICancel() {
  _nameAIAbortCtrl?.abort();
  const progressEl = $('c9-progress');
  if (progressEl) progressEl.innerHTML = '';
  toast(t('toast.processing_cancelled'));
}

async function handleNameAISavePrompt(promptText) {
  const customKey = LANG === 'en' ? 'prompt_en' : 'prompt_es';
  const body = { [customKey]: promptText !== null ? promptText : null };
  try {
    await fetch('/api/ai-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const [cfg, prompts] = await Promise.all([
      fetch('/api/ai-config').then(r => r.json()),
      fetch('/api/ai-prompts').then(r => r.json()).catch(() => ({})),
    ]);
    const defaultKey    = LANG === 'en' ? 'nameExtractor_en' : 'nameExtractor';
    const defaultPrompt = prompts[defaultKey]?.user || prompts.nameExtractor?.user || '';
    const saved = cfg[customKey] || defaultPrompt;
    setState({ aiPrompt: saved, _nameaiDefaultPrompt: defaultPrompt });
    const ta = $('c9-prompt-ta');
    if (ta) ta.value = saved;
    toast(promptText !== null ? t('toast.prompt_saved') : t('toast.prompt_restored'));
  } catch {
    toast(t('toast.prompt_save_error'), 'error');
  }
}

function _getStep10ProviderContext() {
  const { aiProviders = [], selectedProviderId = '' } = getState();
  const provider = aiProviders.find(p => p.id === selectedProviderId) || aiProviders[0];
  return { aiProviders, selectedProviderId: provider?.id || '', provider };
}

function handleStep10ProviderChange(newId) {
  setState({ selectedProviderId: newId });
  const { aiProviders } = getState();
  const provider = aiProviders.find(p => p.id === newId);
  renderStep10OllamaStatus('checking', aiProviders, newId, handleStep10ProviderChange);
  checkOllamaAvailable(provider?.url).then(ok => {
    renderStep10OllamaStatus(ok === true ? 'ok' : ok === 'cold' ? 'cold' : 'error', aiProviders, newId, handleStep10ProviderChange);
    if (ok) toast(t('toast.provider_connected', provider?.label || newId));
    else toast(t('toast.provider_no_resp', provider?.label || newId), 'error');
  });
}

function handleNameAIRetryOllama() {
  const { aiProviders, selectedProviderId, provider } = _getStep10ProviderContext();
  renderStep10OllamaStatus('checking', aiProviders, selectedProviderId, handleStep10ProviderChange);
  checkOllamaAvailable(provider?.url).then(ok => {
    renderStep10OllamaStatus(ok === true ? 'ok' : ok === 'cold' ? 'cold' : 'error', aiProviders, selectedProviderId, handleStep10ProviderChange);
    if (ok) toast(t('toast.connected'));
    else toast(t('toast.server_no_response'), 'error');
  });
}

function handleNameAICheckNombre(idx, checked) {
  const { nameaiItems } = getState();
  nameaiItems[idx].nombreChecked = checked;
  setState({ nameaiItems: [...nameaiItems] });
}

function handleNameAICheckApellido(idx, checked) {
  const { nameaiItems } = getState();
  nameaiItems[idx].apellidoChecked = checked;
  setState({ nameaiItems: [...nameaiItems] });
}

function handleNameAIEditNombre(idx, value) {
  const { nameaiItems } = getState();
  nameaiItems[idx].editNombre = value;
  nameaiItems[idx].nombreCaseModified = false;
  nameaiItems[idx].caseModified = !!nameaiItems[idx].apellidoCaseModified;
  setState({ nameaiItems: [...nameaiItems] });
}

function handleNameAIEditApellido(idx, value) {
  const { nameaiItems } = getState();
  nameaiItems[idx].editApellido = value;
  nameaiItems[idx].apellidoCaseModified = false;
  nameaiItems[idx].caseModified = !!nameaiItems[idx].nombreCaseModified;
  setState({ nameaiItems: [...nameaiItems] });
}

// ════════════════════════════════════════════════════════════
//  RESUMEN Y EXPORT
// ════════════════════════════════════════════════════════════
async function showSummary() {
  const { csv, colIdx, valItems, domItems, dupGroups, dupExcluded,
    testExcluded, testItems, testPatterns, empresaIdx, companyNorms, paisIdx, telIdx, step8Items,
    fieldNorms, fieldSelectedCols, nameaiItems, nameaiIdx, apellaiIdx,
    homoResults, homoSessionSummaries,
    tagResults, tagGlobalTag,
    filename, learning } = getState();
  const { finalRows, changeLog, dupLog, testLog } = buildFinalRows(
    csv, colIdx, valItems, domItems, dupExcluded, testExcluded, empresaIdx, companyNorms,
    step8Items, paisIdx, telIdx, fieldNorms, fieldSelectedCols, nameaiItems, nameaiIdx, apellaiIdx
  );
  setState({ _finalRows: finalRows, _changeLog: changeLog, _dupLog: dupLog, _testLog: testLog });

  // Registrar preferencias de columnas — solo si el paso de duplicados se ejecutó
  // (si fue skipeado, dupCols queda vacío y guardar [] corrompería la preferencia)
  const hash = schemaHash(csv.headers);
  const { dupCols, enabledSteps } = getState();
  if (enabledSteps.duplicates !== false && dupCols.size > 0) {
    await recordColumnPreference(hash, [...dupCols]);
  }

  // Stats de sesión
  const companyEdited      = companyNorms.filter(n => n.clear || n.newName !== n.displayName).reduce((acc, n) => acc + n.rowIdxs.length, 0);
  const companyTotal       = companyNorms.reduce((acc, n) => acc + n.rowIdxs.length, 0);
  const companyEmpty       = companyNorms.filter(n => !n.displayName).reduce((acc, n) => acc + n.rowIdxs.length, 0);
  const companyAutoCleared = companyNorms.filter(n => n.clear).reduce((acc, n) => acc + n.rowIdxs.length, 0);
  const companyHomologated = companyNorms.filter(n => n.homologated && !n.clear).reduce((acc, n) => acc + n.rowIdxs.length, 0);
  const companyManual      = companyNorms.filter(n => !n.clear && !n.homologated && n.newName !== n.displayName).reduce((acc, n) => acc + n.rowIdxs.length, 0);

  const countryFilled        = step8Items.filter(i => i.checked && i.willChangePais).length;
  const phoneFormatted       = step8Items.filter(i => i.checked && i.willChangeTel && !i.phoneInvalid).length;
  const countryManual        = step8Items.filter(i => i.checked && i.source === 'manual').length;
  const phoneManual          = step8Items.filter(i => i.checked && i.manualPhone != null && i.manualPhone !== i.formattedPhone).length;
  const phoneInvalidTotal    = step8Items.filter(i => i.phoneInvalid).length;
  const phoneInvalidCorrected = step8Items.filter(i => i.phoneInvalid && i.checked && i.manualPhone != null && i.manualPhone !== '').length;

  const analizadas8  = step8Items.length;
  const paisAuto     = step8Items.filter(i => i.willChangePais && i.source !== 'manual').length;
  const paisManual   = step8Items.filter(i => i.source === 'manual').length;
  const paisVacio    = step8Items.filter(i => !i.country && !i.originalPais).length;
  const paisValidos  = step8Items.filter(i => !!i.country).length;
  const telAuto      = step8Items.filter(i => i.willChangeTel && !i.phoneInvalid).length;
  const telManual    = step8Items.filter(i => i.manualPhone != null && i.manualPhone !== '').length;
  const telVacio     = step8Items.filter(i => !i.phone).length;
  const telValidos   = step8Items.filter(i => !!i.phone && !i.phoneInvalid).length;
  const paisInvalido = step8Items.filter(i => !!i.originalPais && !i.country).length;
  const telInvalido  = step8Items.filter(i => i.phoneInvalid).length;

  const valInvalidos  = valItems.filter(v => v.issues.some(i => i.type === FIX_TYPES.INVALID_CHAR)).length;
  const valAcentos    = valItems.filter(v => v.issues.some(i => i.type === FIX_TYPES.TRANSLIT)).length;
  const valMayusculas = valItems.filter(v => v.issues.some(i => i.type === FIX_TYPES.LOWERCASE)).length;
  const valEspacios   = valItems.filter(v => v.issues.some(i => i.type === FIX_TYPES.SPACES)).length;

  const domByProvider = {};
  domItems.forEach(d => { domByProvider[d.provider] = (domByProvider[d.provider] || 0) + 1; });

  const activePatterns = testPatterns.length > 0 ? testPatterns : ['test'];
  const testPatternCounts = activePatterns.map(p => ({
    pattern: p,
    count: testItems.filter(t => t.matchedFields.some(f => f.val.toLowerCase().includes(p.toLowerCase()))).length,
  }));

  const dupTotal    = csv.rows.filter(r => r.some(c => (c||'').trim())).length;
  const dupInGroups = dupGroups.reduce((acc, g) => acc + g.rows.length, 0);
  const dupUnicos   = dupTotal - dupInGroups;

  const stats = {
    filename,
    total:          dupTotal,
    valFixed:       valItems.filter(v => v.checked).length,
    domFixed:       domItems.filter(d => d.checked).length,
    dupRemoved:     dupExcluded.size,
    dupGroups:      dupGroups.length,
    dupInGroups,
    dupUnicos,
    testRemoved:    testExcluded.size,
    companyEdited,
    companyTotal,
    companyEmpty,
    companyAutoCleared,
    companyHomologated,
    companyManual,
    countryFilled,
    phoneFormatted,
    countryManual,
    phoneManual,
    phoneInvalidTotal,
    phoneInvalidCorrected,
    analizadas8,
    paisAuto,
    paisManual,
    paisVacio,
    paisInvalido,
    paisValidos,
    telAuto,
    telManual,
    telVacio,
    telInvalido,
    telValidos,
    valInvalidos,
    valAcentos,
    valMayusculas,
    valEspacios,
    domByProvider,
    testPatternCounts,
    finalRows:      finalRows.length,
    customRulesCount: getState().customRules?.length || 0,
    customWLCount:    (getState().customWL?.length || 0) + (getState().defaultValidDomains?.length || 0) - (getState().defaultValidExclusions?.length || 0),
    fieldHomolChanged: Object.values(fieldNorms)
      .flatMap(norms => norms.filter(n => n.changed))
      .reduce((acc, n) => acc + n.rowIdxs.length, 0),
    fieldHomolFields:        fieldSelectedCols.length,
    fieldHomolUniqueInitial: Object.values(fieldNorms).flatMap(n => n).length,
    fieldHomolUniqueFinal:   Object.values(fieldNorms).reduce((acc, norms) =>
      acc + new Set(norms.map(n => n.newValue)).size, 0),
    fieldHomolIA:            Object.values(fieldNorms).flatMap(n => n).filter(n => n.source === 'ai'     && n.changed).length,
    fieldHomolManual:        Object.values(fieldNorms).flatMap(n => n).filter(n => n.source === 'manual' && n.changed).length,
    fieldHomolHomologados:   Object.values(fieldNorms).flatMap(n => n).filter(n => n.changed).length,
    // Stats de homoResults (nueva homologación por columna)
    homoVariante: (homoResults || []).filter(r => r.status === 'js-match' && r.canonical).reduce((a, r) => a + r.rowIdxs.length, 0),
    homoIA:       (homoResults || []).filter(r => r.status === 'done'     && r.canonical).reduce((a, r) => a + r.rowIdxs.length, 0),
    homoManual:   (homoResults || []).filter(r => r.status === 'manual'   && r.canonical).reduce((a, r) => a + r.rowIdxs.length, 0),
    homoTotal:    (homoResults || []).filter(r => r.canonical).reduce((a, r) => a + r.rowIdxs.length, 0),
    // Stats de tagResults
    tagTotal:     (tagResults || []).reduce((a, r) => a + r.rowIdxs.length, 0),
    tagMatch:     (tagResults || []).filter(r => r.status === 'match'  && r.tag).reduce((a, r) => a + r.rowIdxs.length, 0),
    tagIA:        (tagResults || []).filter(r => r.status === 'ia'     && r.tag).reduce((a, r) => a + r.rowIdxs.length, 0),
    tagManual:    (tagResults || []).filter(r => r.status === 'manual' && r.tag).reduce((a, r) => a + r.rowIdxs.length, 0),
    tagCompleted: (tagResults || []).filter(r => r.tag).reduce((a, r) => a + r.rowIdxs.length, 0),
    tagGlobalTag: (tagGlobalTag || '').trim(),
    nameaiNombresIA:   nameaiItems.filter(i => i.needsNom   && i.aiNombre   && i.editNombre   === i.aiNombre).length,
    nameaiApellidosIA: nameaiItems.filter(i => i.needsApell && i.aiApellido && i.editApellido === i.aiApellido).length,
    nameaiManualN:     nameaiItems.filter(i => i.editNombre   && i.editNombre   !== (i.origNombre   || '') && i.editNombre   !== (i.aiNombre   || '')).length,
    nameaiManualA:     nameaiItems.filter(i => i.editApellido && i.editApellido !== (i.origApellido || '') && i.editApellido !== (i.aiApellido || '')).length,
  };
  await recordSession(stats);

  // Registrar decisiones de empresa para aprendizaje
  const updatedCompany = await recordCompanyDecisions(learning, companyNorms);
  const updatedLearning = updatedCompany
    ? { ...learning, learnedJunkCompanies: updatedCompany.learnedJunk, learnedRenames: updatedCompany.learnedRenames }
    : learning;
  setState({ learning: updatedLearning });

  // Insights comparativos
  const insights = generateInsights(updatedLearning, stats);

  renderSummary({ stats, finalRows, changeLog, dupLog, testLog, insights, csv, colIdx, fieldSelectedCols, homoSessionSummaries: homoSessionSummaries || [], tagGlobalTag: (tagGlobalTag||'').trim() });
  setWizardStep('summary');
  show('res-card');
  _scrollToCard($('res-card'));
}

function _exportDomainCorrections() {
  const { csv, colIdx, valItems, domItems, filename } = getState();
  if (!csv || colIdx == null) return;

  const valMap = new Map((valItems || []).map(v => [v.rowIdx, v]));
  const domMap = new Map((domItems || []).map(d => [d.rowIdx, d]));

  const rows = [];
  csv.rows.forEach((row, ri) => {
    const rawEmail = (row[colIdx] || '').trim();
    if (!rawEmail) return;

    let corrected = rawEmail;
    const vf = valMap.get(ri);
    if (vf && vf.checked) corrected = vf.manualValue || vf.autoFixed;
    const df = domMap.get(ri);
    if (df && df.checked) corrected = df.manualValue || df.corrected;

    if (corrected !== rawEmail) rows.push([rawEmail, corrected]);
  });

  const headers = [t('dom.export_col_original'), t('dom.export_col_corrected')];
  downloadText(toCSV(headers, rows, ','), filename.replace(/\.csv$/i, '') + '_emails.csv');
  toast(t('dom.export_ok'));
}

function exportMain() {
  const { _finalRows, csv, filename, selectedColumns } = getState();
  if (!_finalRows) return;
  const keepCols = selectedColumns?.length ? selectedColumns : csv.headers.map((_, i) => i);
  const headers  = keepCols.map(i => csv.headers[i]);
  const rows     = _finalRows.map(({ row }) => keepCols.map(i => row[i]));
  downloadText(toCSV(headers, rows, csv.sep), filename.replace(/\.csv$/i, '') + '_corregido.csv');
  toast(t('toast.csv_exported'));
}

function exportUnifiedLog() {
  const { _finalRows, _dupLog, _testLog, csv, colIdx, filename,
          empresaIdx, paisIdx, telIdx, nameaiIdx, apellaiIdx,
          fieldSelectedCols } = getState();
  if (!_finalRows) { toast(t('toast.summary_first'), 'warn'); return; }

  // Columnas "modificables" — aquellas que algún paso puede cambiar
  const modifiableCols = new Set(
    [colIdx, empresaIdx, paisIdx, telIdx, nameaiIdx, apellaiIdx,
     ...(fieldSelectedCols || [])].filter(i => i != null && i >= 0)
  );

  // Lookup maps
  const finalRowMap = new Map((_finalRows || []).map(fr => [fr.rowIdx, fr.row]));
  const dupSet      = new Set((_dupLog  || []).map(d => d.fila - 2));
  const testSet     = new Set((_testLog || []).map(d => d.fila - 2));
  const isHomolCol  = new Set(fieldSelectedCols || []);

  // Etiqueta de acción para un cambio de columna
  const _actionLabel = (hdr, origVal, newVal, ci) => {
    const name = hdr || `Col${ci + 1}`;
    if (!origVal && newVal)  return `${name} agregado`;
    if (origVal  && !newVal) return `${name} limpiado`;
    if (isHomolCol.has(ci))  return `${name} homologado`;
    return `${name} modificado`;
  };

  // Paso 1: construir datos de fila + detectar qué columnas tuvieron cambios reales
  const modifiedColSet = new Set();
  const rowData = [];
  csv.rows.forEach((origRow, ri) => {
    if (!origRow.some(c => (c || '').trim())) return;
    if (dupSet.has(ri)) {
      rowData.push({ origRow, finalRow: null, accion: 'Eliminado por duplicado' });
      return;
    }
    if (testSet.has(ri)) {
      rowData.push({ origRow, finalRow: null, accion: 'Eliminado por palabra clave' });
      return;
    }
    const finalRow = finalRowMap.get(ri) || origRow;
    const actions  = [];
    for (const ci of modifiableCols) {
      const ov = (origRow[ci]  || '').trim();
      const nv = (finalRow[ci] || '').trim();
      if (ov !== nv) {
        modifiedColSet.add(ci);
        actions.push(_actionLabel(csv.headers[ci], ov, nv, ci));
      }
    }
    rowData.push({ origRow, finalRow, accion: actions.join(', ') });
  });

  // Paso 2: construir encabezados — insertar "X modificado" solo para columnas con cambios reales
  const outHeaders = ['Acciones realizadas'];
  for (let i = 0; i < csv.headers.length; i++) {
    outHeaders.push(csv.headers[i] || `Col${i + 1}`);
    if (modifiedColSet.has(i)) outHeaders.push(`${csv.headers[i] || `Col${i + 1}`} modificado`);
  }

  // Paso 3: construir filas de salida
  const rows = rowData.map(({ origRow, finalRow, accion }) => {
    const r = [accion];
    for (let i = 0; i < csv.headers.length; i++) {
      r.push(origRow[i] ?? '');
      if (modifiedColSet.has(i)) {
        if (finalRow) {
          const ov = (origRow[i]  || '').trim();
          const nv = (finalRow[i] || '').trim();
          r.push(ov !== nv ? nv : '');
        } else {
          r.push('');
        }
      }
    }
    return r;
  });

  downloadText(toCSV(outHeaders, rows, csv.sep), filename.replace(/\.csv$/i, '') + '_log_completo.csv');
  toast(t('toast.log_downloaded'));
}

// ════════════════════════════════════════════════════════════
//  BOTONES DE NAVEGACIÓN
// ════════════════════════════════════════════════════════════
function setupNavButtons() {
  // Setup steps
  $('btn-next1').addEventListener('click',       goFieldSelect);
  // Column assignment is handled via chip "Asignar" buttons in renderFieldSelect
  $('btn-back1').addEventListener('click', () => {
    setState({ csv: null, csvStartRow: 0 }); hide('cfg1'); hide('csv-preview1'); show('dz');
    $('fi').value = '';
    const frv = $('from-row-val'); if (frv) frv.value = 1;
    const autoLbl = $('from-row-auto'); if (autoLbl) autoLbl.style.display = 'none';
    setWizardStep('import');
  });
  $('btn-next-fields').addEventListener('click',   () => { _saveFlowConfig(); goAnalysis(); });
  $('btn-next-analysis').addEventListener('click', () => { _saveFlowConfig(); goFlowSelect(); });
  $('btn-next-flow').addEventListener('click', () => {
    _saveFlowConfig();
    show('wz');
    document.body.classList.add('wz-visible');
    goStep2();
  });
  // Processing steps — Aplicar (navigate, keep step enabled)
  $('btn-next2').addEventListener('click',  () => _goNextEnabled('rules'));
  $('btn-next3').addEventListener('click',  () => { _enableStep('validation');  _goNextEnabled('validation'); });
  $('btn-next4').addEventListener('click',  () => { _enableStep('domains');     _goNextEnabled('domains'); });
  $('btn-export-domains').addEventListener('click', _exportDomainCorrections);
  $('btn-next5').addEventListener('click',  () => { _enableStep('duplicates');  _goNextEnabled('duplicates'); });
  $('btn-next6').addEventListener('click',  () => { _enableStep('keywords');    _goNextEnabled('keywords'); });
  $('btn-next7').addEventListener('click',  () => { _enableStep('company');     _goNextEnabled('company'); });
  $('btn-next8').addEventListener('click',  () => { _enableStep('country');     _goNextEnabled('country'); });
  $('btn-next9').addEventListener('click',  () => { _enableStep('nameai');      _goNextEnabled('nameai'); });

  // Omitir — skip step without applying, mark as disabled
  $('btn-skip5').addEventListener('click',  () => _skipStep('duplicates'));
  $('btn-skip7').addEventListener('click',  () => _skipStep('company'));
  $('btn-skip8')?.addEventListener('click',  () => _skipStep('country'));
  $('btn-dl-main').addEventListener('click', exportMain);
  $('btn-dl-unified').addEventListener('click', exportUnifiedLog);
  $('btn-llm-config').addEventListener('click', openLLMModal);
  _initLearningModal();
  $('btn-csv-editor')?.addEventListener('click', () => {
    const { csv } = getState();
    if (!csv) { toast(t('editor.no_csv')); return; }
    openCsvEditor();
  });
  _initTheme();
  $('btn-restart').addEventListener('click', () => {
    resetSession();
    ['c-fields','c-analysis','c-flow','c2','c3','c4','c5','c6','c7','c8','c10','c9','c11'].forEach(id => { hide(id); lock(id); });
    hide('res-card'); hide('cfg1'); hide('csv-preview1'); show('dz');
    $('fi').value = '';
    hide('wz');
    document.body.classList.remove('wz-visible');
    // Limpiar tarjetas frozen de sesiones de Homologación
    const sessCont = $('homo-sessions-container');
    if (sessCont) sessCont.innerHTML = '';
    // Resetear título de c10 al número original
    const ct10 = $('ct10');
    if (ct10) ct10.innerHTML = `<span class="card-num">10</span> — <span>${t('homol.title') || 'Homologación de campos'}</span>`;
    buildWizardBar(getState().enabledSteps, {});
    toast('✓ Listo para un nuevo proceso');
  });

  // Wizard bar click — navegar a pasos ya completados
  $('wz').addEventListener('click', e => {
    const step = e.target.closest('.wz-step.done');
    if (!step) return;
    const sid = step.dataset.sid;
    const cardMap = {
      rules: 'c2', validation: 'c3', domains: 'c4',
      duplicates: 'c5', keywords: 'c6',
      nameai: 'c9', company: 'c7', country: 'c8', fieldhomol: 'c10',
    };
    const goMap = {
      rules:      goStep2,
      validation: goStep3,
      domains:    goStep4,
      duplicates: goStep5,
      keywords:   goStep6,
      nameai:     goStep9,
      company:    goStep7,
      country:    goStep8,
      fieldhomol: goStep10,
    };
    if (goMap[sid]) {
      goMap[sid]();
      const cardEl = $(cardMap[sid]);
      if (cardEl) _scrollToCard(cardEl, true);
    }
  });
}

// ════════════════════════════════════════════════════════════
//  TEMA CLARO / OSCURO
// ════════════════════════════════════════════════════════════
function _initTheme() {
  const STORAGE_KEY = 'datab-theme';
  const btn  = $('btn-theme');
  const sun  = $('theme-icon-sun');
  const moon = $('theme-icon-moon');

  function _apply(light) {
    document.body.classList.toggle('light', light);
    sun.style.display  = light ? 'block' : 'none';
    moon.style.display = light ? 'none'  : 'block';
    btn.title = light ? t('header.theme_dark') : t('header.theme_light');
  }

  const saved = localStorage.getItem(STORAGE_KEY);
  _apply(saved === 'light');

  btn.addEventListener('click', () => {
    const isLight = document.body.classList.toggle('light');
    localStorage.setItem(STORAGE_KEY, isLight ? 'light' : 'dark');
    _apply(isLight);
    broadcastTheme(isLight);
  });
}

// ════════════════════════════════════════════════════════════
//  IDIOMA ES / EN
// ════════════════════════════════════════════════════════════
function _initLang() {
  const STORAGE_KEY = 'datab-lang';
  const btn = $('btn-lang');
  if (!btn) return;

  // Actualizar label del botón según idioma activo
  btn.textContent  = t('header.lang_btn');
  btn.title        = t('header.lang_title');
  btn.setAttribute('aria-label', t('header.lang_title'));

  btn.addEventListener('click', () => {
    const next = LANG === 'es' ? 'en' : 'es';
    localStorage.setItem(STORAGE_KEY, next);
    broadcastLang(next);
    location.reload();
  });
}

// ════════════════════════════════════════════════════════════
//  EDITOR CSV — BroadcastChannel (ventana externa)
// ════════════════════════════════════════════════════════════
const _OV_KEYS_MAIN = ['valItems','domItems','dupExcluded','testExcluded','companyNorms','step8Items','nameaiItems'];
let _ovSeenMain = {};

function _buildAndBroadcastOverlay(state) {
  const ov = buildEditorOverlay(state);
  broadcastOverlayUpdate({
    cells:    [...ov.cells.entries()],
    excluded: [...ov.excluded.entries()],
  });
}

function _setupEditorBroadcast() {
  onEditorReady(() => {
    const state = getState();
    if (state.csv) {
      sendStateResponse(state.csv, state.prepFormats, state.filename, state.editorDisplayCols || null);
      // Enviar overlay inicial al editor standalone
      _buildAndBroadcastOverlay(state);
      _OV_KEYS_MAIN.forEach(k => _ovSeenMain[k] = state[k]);
    }
  });
  onEditorOp((op) => {
    if (!op?.type) return;
    const { csv, prepHistory, editorDeletedCols, editorAddedCols } = getState();
    if (!csv) return;
    _applyEditorOp(op, csv, prepHistory, editorDeletedCols, editorAddedCols);
  });
  // Suscribirse a cambios del flow y transmitir overlay al editor standalone
  subscribe(state => {
    if (_OV_KEYS_MAIN.some(k => state[k] !== _ovSeenMain[k])) {
      _OV_KEYS_MAIN.forEach(k => _ovSeenMain[k] = state[k]);
      _buildAndBroadcastOverlay(state);
    }
  });
}

/**
 * Limpia el item de overlay del flow para la celda editada (versión main.js).
 * Mismo contrato que _invalidateOverlayForCell en csv-editor.js.
 */
function _invalidateOverlayForCellMain(absRi, ci, newVal) {
  const {
    colIdx, empresaIdx,
    telIdx: eTel, nameaiIdx: eNom, apellaiIdx: eApe,
    valItems, domItems, companyNorms, step8Items, nameaiItems,
  } = getState();

  if (ci === colIdx) {
    setState({
      valItems: (valItems  || []).filter(v => v.rowIdx !== absRi),
      domItems: (domItems  || []).filter(d => d.rowIdx !== absRi),
    });
  } else if (empresaIdx >= 0 && ci === empresaIdx) {
    const newNorms = (companyNorms || [])
      .map(n => ({ ...n, rowIdxs: n.rowIdxs.filter(ri => ri !== absRi) }))
      .filter(n => n.rowIdxs.length > 0);
    setState({ companyNorms: newNorms });
  } else if (eTel >= 0 && ci === eTel) {
    const digits = (newVal || '').replace(/\D/g, '').length;
    const phoneInvalid = !!newVal && (digits <= 5 || digits >= 16);
    setState({
      step8Items: (step8Items || []).map(i =>
        i.rowIdx === absRi
          ? { ...i, phone: newVal, formattedPhone: newVal, phoneInvalid, willChangeTel: false, manualPhone: null }
          : i
      ),
    });
  } else if (eNom >= 0 && ci === eNom) {
    setState({
      nameaiItems: (nameaiItems || []).map(i =>
        i.rowIdx === absRi ? { ...i, origNombre: newVal, editNombre: newVal } : i
      ),
    });
  } else if (eApe >= 0 && ci === eApe) {
    setState({
      nameaiItems: (nameaiItems || []).map(i =>
        i.rowIdx === absRi ? { ...i, origApellido: newVal, editApellido: newVal } : i
      ),
    });
  }
  const { paisIdx: ePais } = getState();
  if (ePais >= 0 && ci === ePais) {
    const { step8Items: s8 } = getState();
    setState({
      step8Items: (s8 || []).map(i =>
        i.rowIdx === absRi ? { ...i, willChangePais: false } : i
      ),
    });
  }
}

function _applyEditorOp(op, csv, prepHistory, editorDeletedCols, editorAddedCols) {
  const hist = [...(prepHistory || [])];
  let newCsv     = csv;
  let newDeleted = new Set(editorDeletedCols);
  let newAdded   = new Set(editorAddedCols);

  if (op.type === 'undo') {
    if (!hist.length) return;
    const prev = hist.pop();
    newCsv     = prev.csv;
    newDeleted = prev.editorDeletedCols;
    newAdded   = prev.editorAddedCols;
    setState({ csv: newCsv, prepHistory: hist, editorDeletedCols: newDeleted, editorAddedCols: newAdded });
  } else if (op.type === 'set_csv') {
    if (!op.csv) return;
    newCsv = op.csv;
    setState({ csv: newCsv });
  } else {
  // Snapshot para undo
  hist.push({
    csv: { headers: [...csv.headers], rows: csv.rows.map(r => [...r]), sep: csv.sep },
    editorDeletedCols: new Set(editorDeletedCols),
    editorAddedCols:   new Set(editorAddedCols),
  });
  if (hist.length > 30) hist.shift();

  switch (op.type) {
    case 'split': {
      const { csv: c } = splitColumn(csv, op.colIdx, op.delimiter);
      newCsv = c;
      (op.addedNames || []).forEach(n => newAdded.add(n));
      break;
    }
    case 'delete': {
      const sortedIdxs = [...(op.colIdxs || [])].sort((a, b) => a - b);
      const { editorDisplayCols: _edc } = getState();
      const _base = _edc || csv.headers.map(name => ({ type: 'real', name }));
      const _newDisp = [..._base];
      let _rc = 0, _dp = 0;
      for (let _i = 0; _i < _newDisp.length; _i++) {
        if (_newDisp[_i].type === 'ghost') continue;
        if (_dp < sortedIdxs.length && _rc === sortedIdxs[_dp]) {
          _newDisp[_i] = { type: 'ghost', name: _newDisp[_i].name, values: csv.rows.map(r => r[sortedIdxs[_dp]] ?? '') };
          _dp++;
        }
        _rc++;
      }
      newCsv = deleteColumns(csv, sortedIdxs);
      (op.deletedNames || []).forEach(n => newDeleted.add(n));
      setState({ editorDisplayCols: _newDisp });
      break;
    }
    case 'add_col':
      newCsv = addColumn(csv, op.name);
      newAdded.add(op.name);
      newDeleted.delete(op.name);
      break;
    case 'reorder':
      newCsv = reorderColumns(csv, op.newOrder);
      break;
    case 'rename':
      newCsv = renameColumns(csv, op.renames);
      break;
    case 'format':
      newCsv = formatColumn(csv, op.colIdx, op.ftype, op.pattern);
      break;
    case 'spaces': {
      let c = csv;
      for (const ci of (op.colIdxs || [])) c = applySpaces(c, ci, op.modes);
      newCsv = c;
      break;
    }
    case 'remove_pos': {
      let c = csv;
      for (const ci of (op.colIdxs || [])) c = applyRemoveByPos(c, ci, op.mode, op.opts);
      newCsv = c;
      break;
    }
    case 'case': {
      let c = csv;
      for (const ci of (op.colIdxs || [])) c = applyCase(c, ci, op.mode);
      newCsv = c;
      break;
    }
    case 'add_text': {
      let c = csv;
      for (const ci of (op.colIdxs || [])) c = applyAddText(c, ci, op.text, op.position, op.skipEmpty);
      newCsv = c;
      break;
    }
    case 'replace': {
      let c = csv;
      for (const ci of (op.colIdxs || [])) c = applyReplace(c, ci, op.pairs);
      newCsv = c;
      break;
    }
    case 'edit_cell': {
      // Edición directa de una celda — actualiza el valor en csv.rows
      const { rowIdx: eRi, colIdx: eCi, value: eVal, effectiveOld } = op;
      if (eVal === effectiveOld) return;
      newCsv = { ...csv, rows: csv.rows.map((r, ri) =>
        ri === eRi ? r.map((v, i) => i === eCi ? eVal : v) : r
      )};
      break;
    }
    default: return;
  }

  const { editorOpsCount: _eoc, editorToolsUsed: _etu, editorCellEdits: _ece, editorEditedCells: _eec } = getState();
  const _isCellEdit = op.type === 'edit_cell';
  setState({
    csv: newCsv, prepHistory: hist, editorDeletedCols: newDeleted, editorAddedCols: newAdded,
    ...(_isCellEdit
      ? { editorCellEdits: (_ece || 0) + 1,
          editorEditedCells: new Set([...(_eec || []), `${op.rowIdx}:${op.colIdx}`]) }
      : { editorOpsCount: (_eoc || 0) + 1,
          editorToolsUsed: new Set([...(_etu || []), op.type]) }),
  });
  // Para edición de celda: invalidar el overlay del flow afectado por la edición
  if (_isCellEdit) _invalidateOverlayForCellMain(op.rowIdx, op.colIdx, op.value);
  } // end else (normal op)

  // Recompute all confirmed field indices from stored names; fallback al CSV viejo si no hay nombre guardado
  const { emailColName: eName,
          confirmedNombreIdx: _nIdx,   confirmedNombreColName,
          confirmedApellidoIdx: _aIdx, confirmedApellidoColName,
          confirmedEmpresaIdx: _eIdx,  confirmedEmpresaColName,
          confirmedTelIdx: _tIdx,      confirmedTelColName,
          confirmedPaisIdx: _pIdx,     confirmedPaisColName,
          selectedColumnNames } = getState();
  const _resolveName = (storedName, idx) =>
    storedName ?? (idx != null && idx >= 0 ? csv.headers[idx] : null);
  const _reIdx = name => (name != null ? newCsv.headers.indexOf(name) : null);
  const nName = _resolveName(confirmedNombreColName,   _nIdx);
  const aName = _resolveName(confirmedApellidoColName, _aIdx);
  const eNameC = _resolveName(confirmedEmpresaColName, _eIdx);
  const tName = _resolveName(confirmedTelColName,      _tIdx);
  const pName = _resolveName(confirmedPaisColName,     _pIdx);
  if (eName) {
    const nameIdx = newCsv.headers.indexOf(eName);
    if (nameIdx >= 0) setState({ colIdx: nameIdx });
  }
  setState({
    confirmedNombreIdx:       _reIdx(nName),  confirmedNombreColName:   nName,
    confirmedApellidoIdx:     _reIdx(aName),  confirmedApellidoColName: aName,
    confirmedEmpresaIdx:      _reIdx(eNameC), confirmedEmpresaColName:  eNameC,
    confirmedTelIdx:          _reIdx(tName),  confirmedTelColName:      tName,
    confirmedPaisIdx:         _reIdx(pName),  confirmedPaisColName:     pName,
  });
  // Recomputar selectedColumns desde nombres guardados; sincronizar nombres con nuevo CSV
  if (selectedColumnNames) {
    const newSel = selectedColumnNames.map(n => newCsv.headers.indexOf(n)).filter(i => i >= 0);
    const newCols = newSel.length === newCsv.headers.length ? null : newSel;
    const newNames = newCols ? newCols.map(i => newCsv.headers[i]) : null;
    setState({ selectedColumns: newCols, selectedColumnNames: newNames });
  }

  broadcastCsvUpdate(newCsv, getState().editorDisplayCols || null);

  // Paso A (Importar) siempre está visible — mantener su vista previa al día
  if ($('csv-prev-table')) _renderCsvPreview(newCsv);

  // Re-render field selection if that step is currently visible
  if ($('c-fields') && !$('c-fields').classList.contains('hidden')) {
    _populateColSel(newCsv);
    _populateExtraColSels(newCsv);
    _refreshFieldSelect();
  }
}

// ════════════════════════════════════════════════════════════
//  LEARNING MODAL
// ════════════════════════════════════════════════════════════
function _initLearningModal() {
  const modal   = $('learning-modal');
  const openBtn = $('btn-learning');
  const closeBtn = $('btn-learning-modal-close');

  const _open  = () => modal?.classList.remove('hidden');
  const _close = () => modal?.classList.add('hidden');

  openBtn?.addEventListener('click', _open);
  closeBtn?.addEventListener('click', _close);
  modal?.addEventListener('click', e => { if (e.target === modal) _close(); });

  // ── Exportar ──
  $('btn-learning-export')?.addEventListener('click', async () => {
    try {
      const res  = await fetch('/api/learning');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const date     = new Date().toISOString().slice(0, 10);
      const filename = `datab-flow-learning-${date}.json`;
      const content  = JSON.stringify(data, null, 2);
      if (window.showSaveFilePicker) {
        try {
          const fh = await window.showSaveFilePicker({ suggestedName: filename, types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }] });
          const writable = await fh.createWritable();
          await writable.write(content);
          await writable.close();
        } catch (err) {
          if (err.name !== 'AbortError') throw err;
          return;
        }
      } else {
        downloadText(content, filename, 'application/json');
      }
      toast(t('learning.export_ok'));
    } catch (e) {
      toast(t('learning.error') + ': ' + e.message);
    }
  });

  // ── Importar — seleccionar archivo ──
  let _importData = null;
  const fileInput    = $('learning-import-file');
  const fileNameEl   = $('learning-import-filename');
  const applyImport  = $('btn-learning-import-apply');

  $('btn-learning-import-pick')?.addEventListener('click', () => fileInput?.click());

  fileInput?.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        _importData = JSON.parse(e.target.result);
        if (!_importData?.version) throw new Error();
        fileNameEl.textContent = file.name;
        if (applyImport) applyImport.disabled = false;
      } catch {
        _importData = null;
        fileNameEl.textContent = t('learning.import_invalid');
        if (applyImport) applyImport.disabled = true;
      }
    };
    reader.readAsText(file);
  });

  applyImport?.addEventListener('click', async () => {
    if (!_importData) return;
    try {
      const res = await fetch('/api/learning/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(_importData),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setState({ learning: body.data });
      _importData = null;
      fileNameEl.textContent = '';
      if (applyImport) applyImport.disabled = true;
      if (fileInput) fileInput.value = '';
      toast(t('learning.import_ok'));
      _close();
    } catch {
      toast(t('learning.error'));
    }
  });

  // ── Resetear ──
  $('btn-learning-reset')?.addEventListener('click', async () => {
    if (!confirm(t('learning.reset_confirm'))) return;
    try {
      await fetch('/api/learning/reset', { method: 'POST' });
      setState({ learning: null });
      toast(t('learning.reset_ok'));
      _close();
    } catch {
      toast(t('learning.error'));
    }
  });
}

// ════════════════════════════════════════════════════════════
//  PASO 11 — ETIQUETAS DE CAMPO
// ════════════════════════════════════════════════════════════
let _tagAbortCtrl = null;

async function goStep11() {
  const { enabledSteps } = getState();
  if (enabledSteps.fieldtags === false) { _goNextEnabled('fieldtags'); return; }
  setWizardStep('fieldtags');
  show('c11'); unlock('c11');

  setState({
    tagSrcCol: -1, tagTargetMode: 'new', tagTargetName: 'Tags',
    tagTargetColIdx: -1, tagResults: [], aiStatus11: 'checking',
  });

  _renderStep11Full();
  _scrollToCard($('c11'));

  // Verificar proveedor AI disponible
  const { aiProviders, selectedProviderId } = getState();
  const provider = (aiProviders || []).find(p => p.id === selectedProviderId);
  if (provider) {
    const ok = await checkOllamaAvailable(provider?.url);
    setState({ aiStatus11: ok === true ? 'ok' : ok === 'cold' ? 'cold' : 'error' });
    _renderStep11Full();
  }
}

function _renderStep11Full() {
  const {
    csv, colIdx, tagSrcCol, tagTargetMode, tagTargetName, tagTargetColIdx,
    tagLibraries, tagLibEntries, tagLibName, tagSelectedLibId,
    tagGlobalTag, tagResults, tagPromptMatch,
    aiStatus11, aiProviders, selectedProviderId,
  } = getState();
  renderStep11({
    csv, colIdx, tagSrcCol, tagTargetMode, tagTargetName, tagTargetColIdx,
    tagLibraries, tagLibEntries, tagLibName, tagSelectedLibId,
    tagGlobalTag, tagResults, tagPromptMatch,
    aiStatus11, aiProviders, selectedProviderId11: selectedProviderId,
    onSrcColChange:    _tagSetSrcCol,
    onTargetModeChange: m => { setState({ tagTargetMode: m }); _renderStep11Full(); },
    onTargetNameChange: v => { setState({ tagTargetName: v }); _renderStep11Full(); },
    onTargetColChange:  i => { setState({ tagTargetColIdx: i }); _renderStep11Full(); },
    onLibSelect:       _tagSelectLib,
    onNewLib:          _tagNewLib,
    onEditLib:         _tagEditLib,
    onDeleteLib:       _tagDeleteLib,
    onSaveLib:         _tagSaveLib,
    onLibNameChange:   v => setState({ tagLibName: v }),
    onEditEntry:       _tagEditEntry,
    onAddEntry:        _tagAddEntry,
    onDeleteEntry:     _tagDeleteEntry,
    onGlobalTagChange: v => { setState({ tagGlobalTag: v }); },
    onApplyMatch:      _tagsMatchLib,
    onRunAI:           _tagsRunAI,
    onCancelAI:        _tagsCancelAI,
    onEditTagResult:   _tagsEditResult,
    onApply:           _tagsApply,
    onSkip:            () => _skipStep('fieldtags'),
    onRender:          _renderStep11Full,
    onSavePromptMatch: v => { setState({ tagPromptMatch: v || '' }); _renderStep11Full(); },
    onProvider11Change: _tagProviderChange,
    onRetryAI:         () => { setState({ aiStatus11: 'checking' }); _renderStep11Full(); goStep11(); },
  });
}

function _tagSetSrcCol(colIdx) {
  setState({ tagSrcCol: colIdx, tagResults: [] });
  _renderStep11Full();
}

function _tagProviderChange(newId) {
  const { aiProviders } = getState();
  setState({ selectedProviderId: newId, aiStatus11: 'checking' });
  _renderStep11Full();
  const provider = (aiProviders || []).find(p => p.id === newId);
  if (provider) checkOllamaAvailable(provider?.url).then(ok => {
    setState({ aiStatus11: ok === true ? 'ok' : ok === 'cold' ? 'cold' : 'error' });
    _renderStep11Full();
  });
}

function _tagSelectLib(libId) {
  const { tagLibraries } = getState();
  const lib = (tagLibraries || []).find(l => (l.id || l.name) === libId);
  setState({ tagSelectedLibId: libId, tagLibEntries: lib ? [...(lib.entries || [])] : [], tagLibName: lib?.name || '' });
  _renderStep11Full();
}

function _tagNewLib() {
  setState({ tagSelectedLibId: '', tagLibEntries: [], tagLibName: '' });
  setTagLibEditorOpen(true);
  _renderStep11Full();
}

function _tagEditLib(libId) {
  const { tagLibraries } = getState();
  const lib = (tagLibraries || []).find(l => (l.id || l.name) === libId);
  if (!lib) return;
  setState({ tagSelectedLibId: libId, tagLibEntries: [...(lib.entries || [])], tagLibName: lib.name || '' });
  setTagLibEditorOpen(true);
  _renderStep11Full();
}

function _tagDeleteLib(libId) {
  const { tagLibraries } = getState();
  const updated = (tagLibraries || []).filter(l => (l.id || l.name) !== libId);
  setState({ tagLibraries: updated, tagSelectedLibId: '', tagLibEntries: [], tagLibName: '' });
  _tagPersistLibs(updated);
  _renderStep11Full();
}

function _tagAddEntry() {
  const { tagLibEntries } = getState();
  setState({ tagLibEntries: [...tagLibEntries, { value: '', tag: '' }] });
  _renderStep11Full();
}

function _tagEditEntry(idx, field, value) {
  const { tagLibEntries } = getState();
  const updated = tagLibEntries.map((e, i) => i === idx ? { ...e, [field]: value } : e);
  setState({ tagLibEntries: updated });
}

function _tagDeleteEntry(idx) {
  const { tagLibEntries } = getState();
  setState({ tagLibEntries: tagLibEntries.filter((_, i) => i !== idx) });
  _renderStep11Full();
}

async function _tagSaveLib() {
  const { tagLibraries, tagLibEntries, tagLibName, tagSelectedLibId } = getState();
  const name    = (tagLibName || '').trim();
  if (!name) { toast(t('tags.lib_name_required') || 'El nombre de la biblioteca es requerido'); return; }
  const entries = tagLibEntries.filter(e => e.value.trim());
  const libs    = [...(tagLibraries || [])];
  const existIdx = libs.findIndex(l => (l.id || l.name) === tagSelectedLibId);
  const libId   = tagSelectedLibId || `tlib-${Date.now()}`;
  const newLib  = { id: libId, name, entries };
  if (existIdx >= 0) libs[existIdx] = newLib; else libs.push(newLib);
  setState({ tagLibraries: libs, tagSelectedLibId: libId, tagLibName: name, tagLibEntries: entries });
  setTagLibEditorOpen(false);
  await _tagPersistLibs(libs);
  toast(t('tags.lib_saved') || 'Biblioteca guardada');
  _renderStep11Full();
}

async function _tagPersistLibs(libraries) {
  try {
    const res = await fetch('/api/field-tags', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ libraries }) });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('[tags] save error:', err);
      toast('Error al guardar la librería — reiniciá el servidor', 'error');
    }
  } catch (e) {
    console.error('[tags] save fetch error:', e);
    toast('Error de conexión al guardar la librería', 'error');
  }
}

function _tagsMatchLib() {
  const { csv, tagSrcCol, tagLibEntries, dupExcluded, testExcluded } = getState();
  if (tagSrcCol < 0) { toast(t('tags.no_src') || 'Seleccioná un campo fuente'); return; }
  const results = groupTagResults(csv, tagSrcCol, tagLibEntries, dupExcluded, testExcluded);
  setState({ tagResults: results });
  _renderStep11Full();
}

async function _tagsRunAI() {
  const { csv, tagSrcCol, tagResults, tagLibEntries, tagPromptMatch, aiProviders, selectedProviderId,
    dupExcluded, testExcluded } = getState();
  if (tagSrcCol < 0) { toast(t('tags.no_src') || 'Seleccioná un campo fuente'); return; }
  const unmatched = (tagResults.length ? tagResults : groupTagResults(csv, tagSrcCol, tagLibEntries, dupExcluded, testExcluded)).filter(r => !r.tag);
  if (!unmatched.length) { toast(t('tags.all_matched') || 'Todos los valores tienen tag'); return; }

  const provider = (aiProviders || []).find(p => p.id === selectedProviderId);
  if (!provider) { toast(t('ai.no_provider') || 'Sin proveedor IA'); return; }

  _tagAbortCtrl = new AbortController();
  const cancelBtn = $('btn-c11-run-ai');
  const runBtn    = $('btn-c11-cancel-ai');
  if (cancelBtn) cancelBtn.style.display = 'none';
  if (runBtn)    runBtn.style.display    = '';

  const baseResults = tagResults.length ? [...tagResults] : groupTagResults(csv, tagSrcCol, tagLibEntries, dupExcluded, testExcluded);
  setState({ tagResults: baseResults });

  const libSummary = tagLibEntries.map(e => `"${e.value}" → "${e.tag}"`).join(', ');
  const promptBase = tagPromptMatch || `Dado el valor de campo "{{VALUE}}" y la librería de tags [${libSummary}], sugerí el tag más apropiado. Si no encontrás un match razonable respondé con vacío. Solo respondé con el tag, sin explicaciones.`;

  let done = 0;
  for (const group of unmatched) {
    if (_tagAbortCtrl?.signal.aborted) break;
    const prompt = promptBase.replace('{{VALUE}}', group.value);
    try {
      const resp = await callAI(prompt, { signal: _tagAbortCtrl?.signal, providerId: provider.id });
      const tag  = (resp || '').trim().replace(/^["']|["']$/g, '');
      const ri   = baseResults.findIndex(r => r.value === group.value);
      if (ri >= 0) {
        baseResults[ri] = { ...baseResults[ri], tag: tag || '', status: tag ? 'ia' : 'no-match' };
      }
    } catch {}
    done++;
    renderStep11Progress(done, unmatched.length);
    setState({ tagResults: [...baseResults] });
    _renderStep11Full();
  }

  renderStep11Progress(0, 0);
  if (cancelBtn) cancelBtn.style.display = '';
  if (runBtn)    runBtn.style.display    = 'none';
  _tagAbortCtrl = null;
  _renderStep11Full();
}

function _tagsCancelAI() {
  _tagAbortCtrl?.abort();
}

function _tagsEditResult(idx, value) {
  const { tagResults } = getState();
  const updated = tagResults.map((r, i) => i === idx ? { ...r, tag: value, status: value ? 'manual' : r.status } : r);
  setState({ tagResults: updated });
  _renderStep11Full();
}

function _tagsApply() {
  const { csv, tagResults, tagSrcCol, tagTargetMode, tagTargetName, tagTargetColIdx, tagGlobalTag } = getState();

  const rowToTag = new Map();
  for (const r of (tagResults || [])) {
    const finalTag = buildTagValue(r.tag, tagGlobalTag);
    for (const ri of r.rowIdxs) rowToTag.set(ri, finalTag);
  }

  let newCsv;
  if (tagTargetMode === 'new') {
    const name = (tagTargetName || 'Tags').trim();
    newCsv = { ...csv, headers: [...csv.headers, name], rows: csv.rows.map((row, ri) => [...row, rowToTag.get(ri) || buildTagValue('', tagGlobalTag)]) };
  } else {
    const fi = tagTargetColIdx;
    newCsv = { ...csv, rows: csv.rows.map((row, ri) => { const r = [...row]; if (rowToTag.has(ri)) r[fi] = rowToTag.get(ri); return r; }) };
  }

  setState({ csv: newCsv });
  broadcastCsvUpdate(newCsv);
  toast(t('tags.applied') || 'Etiquetas aplicadas');
  _enableStep('fieldtags');
  _goNextEnabled('fieldtags');
}

// ════════════════════════════════════════════════════════════
//  ARRANCAR
// ════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => { init(); applyI18n(); _initLang(); });
