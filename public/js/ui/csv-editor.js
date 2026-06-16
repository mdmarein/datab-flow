/**
 * csv-editor.js — Modal de edición de CSV (ventana principal)
 * dataB Flow · © 2026 mdmarein · GNU AGPLv3
 */

import { getState, setState, subscribe } from '../modules/state.js';
import { t } from '../modules/i18n.js';
import { toast, esc, $ } from '../modules/utils.js';
import { broadcastCsvUpdate } from '../modules/broadcast.js';
import { toCSV } from '../modules/parser.js';
import {
  splitColumn, splitPreview,
  deleteColumns, addColumn, mergeColumns, mergePreview, reorderColumns, renameColumns,
  formatColumn, formatSample,
  applySpaces, applySpacesValue, applyRemoveByPos, removeByPosValue,
  applyCase, applyCaseValue, applyAddText, addTextValue, applyReplace, replaceValue,
} from '../modules/prep.js';

// ── Módule state ──────────────────────────────────────────────
let _fieldSelectRefresh = null;

export function setFieldSelectRefresh(cb) { _fieldSelectRefresh = cb; }

let _page            = 0;
let _pageSize        = 16;
let _selCols         = new Set();
let _activeTool      = null;
let _sbExpanded      = false;
let _reorderOrder    = [];
let _redoHistory     = [];
let _pendingDelete   = new Set();

// ── Overlay del flow (correcciones reflejadas en el editor) ────
const _OV_KEYS = ['valItems','domItems','dupExcluded','testExcluded','companyNorms','step8Items','nameaiItems','homoResults','homoTargetMode','homoTargetColIdx'];
let _overlayUnsub  = null;
let _overlayCache  = null;
let _overlaySeen   = {};

/**
 * Construye un mapa de correcciones del flow para visualizarlas en el editor.
 * cells:    Map<"ri:ci", { newVal, type, orig }>
 * excluded: Map<ri, 'dup'|'test'>
 */
export function buildEditorOverlay(state) {
  const {
    valItems = [], domItems = [],
    dupExcluded, testExcluded,
    companyNorms = [], step8Items = [], nameaiItems = [],
    homoResults = [], homoTargetMode = '', homoTargetColIdx = -1,
    colIdx, empresaIdx, paisIdx, telIdx, nameaiIdx, apellaiIdx,
  } = state;

  const cells    = new Map();
  const excluded = new Map();

  if (dupExcluded)  for (const ri of dupExcluded)  excluded.set(ri, 'dup');
  if (testExcluded) for (const ri of testExcluded) excluded.set(ri, 'test');

  const _set = (ri, ci, newVal, type, orig, subType = null) => {
    if (ci == null || ci < 0) return;
    cells.set(`${ri}:${ci}`, { newVal: newVal ?? '', type, orig: orig ?? '', subType });
  };

  // Paso 3 — Validación email
  for (const v of valItems) {
    if (!v.checked) continue;
    const c = v.manualValue ?? v.autoFixed;
    if (c !== v.original) _set(v.rowIdx, colIdx, c, 'val', v.original);
  }
  // Paso 4 — Dominio email (sobreescribe validación)
  for (const d of domItems) {
    if (!d.checked) continue;
    const c = d.manualValue ?? d.corrected;
    if (c !== d.original) _set(d.rowIdx, colIdx, c, 'dom', d.original);
  }
  // Paso 7 — Empresa
  if (empresaIdx >= 0) {
    for (const norm of companyNorms) {
      if (!norm.rowIdxs?.length) continue;
      if (norm.clear) {
        for (const ri of norm.rowIdxs) _set(ri, empresaIdx, '', 'company_clear', norm.displayName);
      } else if (norm.newName !== norm.displayName) {
        for (const ri of norm.rowIdxs) _set(ri, empresaIdx, norm.newName, 'company', norm.displayName);
      }
    }
  }
  // Paso 8 — País y Teléfono
  for (const item of step8Items) {
    if (!item.checked) continue;
    if (paisIdx >= 0 && item.willChangePais && item.country) {
      _set(item.rowIdx, paisIdx, item.country.nameEs, 'country', item.originalPais ?? '');
    }
    if (telIdx >= 0) {
      const target = item.manualPhone != null ? item.manualPhone
        : item.phoneInvalid  ? ''
        : item.willChangeTel ? item.formattedPhone
        : null;
      if (target != null && target !== item.phone) {
        _set(item.rowIdx, telIdx, target, 'phone', item.phone ?? '');
      }
    }
  }
  // Paso 9 — Nombre / Apellido IA (con subType: ia / manual / case)
  for (const item of nameaiItems) {
    if (nameaiIdx >= 0 && item.editNombre != null && item.editNombre !== (item.origNombre ?? '')) {
      const st = item.nombreCaseModified ? 'case'
               : (item.aiNombre && item.editNombre === item.aiNombre) ? 'ia'
               : 'manual';
      _set(item.rowIdx, nameaiIdx, item.editNombre, 'name', item.origNombre ?? '', st);
    }
    if (apellaiIdx >= 0 && item.editApellido != null && item.editApellido !== (item.origApellido ?? '')) {
      const st = item.apellidoCaseModified ? 'case'
               : (item.aiApellido && item.editApellido === item.aiApellido) ? 'ia'
               : 'manual';
      _set(item.rowIdx, apellaiIdx, item.editApellido, 'name', item.origApellido ?? '', st);
    }
  }
  // Paso 10 — Homologación (solo columna existente, preview antes de aplicar)
  if (homoTargetMode === 'existing' && homoTargetColIdx >= 0) {
    for (const r of homoResults) {
      if (!r.canonical) continue;
      const st = r.status === 'js-match' ? 'var' : r.status === 'done' ? 'ia' : 'manual';
      for (const ri of (r.rowIdxs || [])) {
        _set(ri, homoTargetColIdx, r.canonical, 'homo', '', st);
      }
    }
  }

  return { cells, excluded };
}

function _getOverlay() {
  const state = getState();
  if (_OV_KEYS.some(k => state[k] !== _overlaySeen[k])) {
    _OV_KEYS.forEach(k => _overlaySeen[k] = state[k]);
    _overlayCache = buildEditorOverlay(state);
  }
  return _overlayCache || { cells: new Map(), excluded: new Map() };
}

const SINGLE_COL_TOOLS = new Set(['split', 'rename', 'format', 'case', 'spaces', 'remove_pos', 'add_text', 'replace']);

// ── Tool definitions ──────────────────────────────────────────
const TOOLS = [
  { id: 'delete',     icon: '<svg viewBox="0 0 14 14" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="2" width="12" height="10" rx="1.5"/><line x1="10.5" y1="2.5" x2="3.5" y2="11.5"/></svg>', labelKey: 'editor.tool.delete' },
  { id: 'add_col',    icon: '<svg viewBox="0 0 14 14" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="2" width="12" height="10" rx="1.5"/><line x1="7" y1="4.5" x2="7" y2="9.5"/><line x1="4.5" y1="7" x2="9.5" y2="7"/></svg>', labelKey: 'editor.tool.add_col' },
  { id: 'reorder',    icon: '⇅',  labelKey: 'editor.tool.reorder'    },
  { id: 'rename',     icon: '✎',  labelKey: 'editor.tool.rename'     },
  { id: 'split',      icon: '<svg viewBox="0 0 14 14" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="3.5" cy="3.5" r="1.5"/><circle cx="3.5" cy="10.5" r="1.5"/><line x1="5" y1="4" x2="12" y2="11"/><line x1="5" y1="10" x2="12" y2="3"/></svg>', labelKey: 'editor.tool.split' },
  { id: 'merge',      icon: '<svg viewBox="0 0 14 14" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="2" x2="7" y2="7"/><line x1="11" y1="2" x2="7" y2="7"/><line x1="7" y1="7" x2="7" y2="12"/></svg>', labelKey: 'editor.tool.merge' },
  { id: 'format',     icon: '#',  labelKey: 'editor.tool.format'     },
  { id: 'case',       icon: 'Aa', labelKey: 'editor.tool.case'       },
  { id: 'spaces',     icon: '▫',  labelKey: 'editor.tool.spaces'     },
  { id: 'remove_pos', icon: '⌦',  labelKey: 'editor.tool.remove_pos' },
  { id: 'add_text',   icon: '+T', labelKey: 'editor.tool.add_text'   },
  { id: 'replace',    icon: '⇄',  labelKey: 'editor.tool.replace'    },
];

// ── API pública ───────────────────────────────────────────────

export function openCsvEditor() {
  const { csv } = getState();
  const modal = document.getElementById('csv-editor-modal');
  if (!modal) return;
  if (!csv) { toast(t('editor.no_csv')); return; }
  modal.classList.remove('hidden');
  _page       = 0;
  _pageSize   = 16;
  _selCols    = new Set();
  _activeTool = null;
  _sbExpanded = false;
  _reorderOrder = [];
  _overlayCache = null;
  _overlaySeen  = {};
  // Suscribirse a cambios de estado del flow para re-renderizar overlay en tiempo real
  if (_overlayUnsub) _overlayUnsub();
  let _seenDisplayCols = getState().editorDisplayCols;
  _overlayUnsub = subscribe(state => {
    const overlayChanged = _OV_KEYS.some(k => state[k] !== _overlaySeen[k]);
    const displayChanged = state.editorDisplayCols !== _seenDisplayCols;
    if (overlayChanged || displayChanged) {
      _seenDisplayCols = state.editorDisplayCols;
      if (!document.querySelector('#editor-tbl input.cell-edit-input')) {
        _renderTable();
      }
    }
  });
  _syncPageSizePills();
  _initEditor();
}

export function closeCsvEditor() {
  document.getElementById('csv-editor-modal')?.classList.add('hidden');
  if (_overlayUnsub) { _overlayUnsub(); _overlayUnsub = null; }
}

// ── Inicialización ────────────────────────────────────────────

function _initEditor() {
  const { filename } = getState();
  const fnEl = document.getElementById('editor-filename');
  if (fnEl) fnEl.textContent = filename || '';
  _renderTable();
  _renderSidebar();
  _renderPagination();
  _wireHeader();
  _wireFooter();
}

function _wireHeader() {
  const btnUndo   = document.getElementById('btn-editor-undo');
  const btnRedo   = document.getElementById('btn-editor-redo');
  const btnSaveAs = document.getElementById('btn-editor-saveas');
  const btnToggle = document.getElementById('btn-sidebar-toggle');
  const btnClose  = document.getElementById('btn-editor-close');
  const btnWindow = document.getElementById('btn-editor-window');
  if (btnUndo)   btnUndo.onclick   = _undo;
  if (btnRedo)   btnRedo.onclick   = _redo;
  if (btnSaveAs) btnSaveAs.onclick = _saveAs;
  if (btnToggle) btnToggle.onclick = _toggleSidebar;
  if (btnClose)  btnClose.onclick  = closeCsvEditor;
  if (btnWindow) btnWindow.onclick = _openInWindow;
}

function _wireFooter() {
  const psEl    = document.getElementById('editor-page-size');
  const btnPrev = document.getElementById('editor-page-prev');
  const btnNext = document.getElementById('editor-page-next');
  if (psEl) {
    psEl.onclick = (e) => {
      const btn = e.target.closest('.fb[data-val]');
      if (!btn) return;
      psEl.querySelectorAll('.fb').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      _pageSize = parseInt(btn.dataset.val, 10) || 0;
      _page = 0;
      _renderTable();
      _renderPagination();
    };
  }
  if (btnPrev) btnPrev.onclick = () => { _page--; _renderTable(); _renderPagination(); };
  if (btnNext) btnNext.onclick = () => { _page++; _renderTable(); _renderPagination(); };
}

function _syncPageSizePills() {
  const psEl = document.getElementById('editor-page-size');
  if (!psEl) return;
  psEl.querySelectorAll('.fb').forEach(b => {
    b.classList.toggle('on', parseInt(b.dataset.val, 10) === _pageSize);
  });
}

// ── Tabla ─────────────────────────────────────────────────────

const _FLOW_COLORS = {
  val:           'var(--fmt)',
  dom:           'var(--accent)',
  company:       'var(--accent)',
  company_clear: 'var(--red)',
  country:       'var(--accent)',
  phone:         'var(--accent)',
  name:          'var(--accent)',
  homo:          'var(--accent)',
};
const _SUBTYPE_COLORS = { ia: 'var(--ai)', manual: 'var(--warn)', case: 'var(--t2)', var: 'var(--accent)' };
const _SUBTYPE_TAG    = { ia: '<span class="tag-ia">IA</span>', manual: '<span class="tag-man">✎</span>', case: '<span class="tag-case">Aa</span>', var: '<span class="tag-var">{V}</span>' };

function _renderTable() {
  const { csv, editorDeletedCols, editorDisplayCols, editorAddedCols, editorEditedCells } = getState();
  if (!csv) return;
  const tbl = document.getElementById('editor-tbl');
  if (!tbl) return;

  const { headers, rows } = csv;
  const total = rows.length;
  const start = _pageSize > 0 ? _page * _pageSize : 0;
  const end   = _pageSize > 0 ? Math.min(start + _pageSize, total) : total;
  const vis   = rows.slice(start, end);

  // displayCols: orden visual con columnas reales + fantasmas en su posición original
  // Si el nº de reales en displayCols no coincide con headers.length (desincronización), resetear
  const _realCount = editorDisplayCols ? editorDisplayCols.filter(d => d.type === 'real').length : 0;
  const displayCols = (editorDisplayCols && _realCount === headers.length)
    ? editorDisplayCols
    : headers.map(name => ({ type: 'real', name }));

  // THEAD
  let html = '<thead><tr><th class="eth-num">#</th>';
  let _thRealIdx = 0;
  for (const dcol of displayCols) {
    if (dcol.type === 'ghost') {
      html += `<th><div class="eth-wrap eth-deleted"><div class="eth-cb">
        <span class="eth-name" style="color:var(--red);text-decoration:line-through" title="${esc(dcol.name)}">${esc(dcol.name)}</span>
      </div></div></th>`;
    } else {
      const ci      = _thRealIdx++;
      const name    = headers[ci] || `Col${ci + 1}`;
      const isAdded   = editorAddedCols.has(name);
      const isChecked = _selCols.has(ci);
      const cls = isAdded ? 'eth-added' : isChecked ? 'eth-checked' : '';
      html += `<th><div class="eth-wrap${cls ? ' ' + cls : ''}" data-col="${ci}">
        <div class="eth-cb">
          <input type="checkbox" data-colidx="${ci}" ${isChecked ? 'checked' : ''} style="cursor:pointer;accent-color:var(--accent)">
          <span class="eth-name" title="${esc(name)}">${esc(name)}</span>
        </div>
        <div class="eth-ops" id="eth-ops-${ci}"></div>
      </div></th>`;
    }
  }
  html += '</tr></thead>';

  // TBODY — con overlay de correcciones del flow
  const ov = _getOverlay();
  const _edited = editorEditedCells || new Set();
  html += '<tbody>';
  for (let ri = 0; ri < vis.length; ri++) {
    const row   = vis[ri];
    const absRi = start + ri;
    const excl  = ov.excluded.get(absRi);
    html += `<tr${excl ? ' class="etr-excl"' : ''}>`;
    html += `<td class="etn">${absRi + 1}${excl ? `<span class="etc-badge etc-badge-${excl}">${excl.toUpperCase()}</span>` : ''}</td>`;
    let _tdRealIdx = 0;
    for (const dcol of displayCols) {
      if (dcol.type === 'ghost') {
        const val = dcol.values[absRi] ?? '';
        html += `<td style="color:var(--red)" title="${esc(dcol.name)}">${esc(val)}</td>`;
      } else {
        const ci   = _tdRealIdx++;
        const raw  = row[ci] ?? '';
        const corr = ov.cells.get(`${absRi}:${ci}`);
        if (corr) {
          const isEmpty = corr.newVal === '';
          const color   = isEmpty ? '' : (corr.subType ? (_SUBTYPE_COLORS[corr.subType] || _FLOW_COLORS[corr.type]) : _FLOW_COLORS[corr.type]) || 'var(--accent)';
          const cls     = isEmpty ? 'etc-clear' : 'etc-flow';
          const display = isEmpty ? '—' : corr.newVal;
          const badge   = (!isEmpty && corr.subType) ? (_SUBTYPE_TAG[corr.subType] || '') : '';
          const style   = color ? ` style="color:${color}"` : '';
          html += `<td class="${cls}"${style} data-rowabs="${absRi}" data-col="${ci}" title="${esc(corr.orig)} → ${esc(isEmpty ? '(vacío)' : corr.newVal)}">${esc(display)}${badge}</td>`;
        } else if (_edited.has(`${absRi}:${ci}`)) {
          html += `<td class="etc-edited" data-rowabs="${absRi}" data-col="${ci}" title="${esc(raw)}">${esc(raw)}</td>`;
        } else {
          html += `<td data-rowabs="${absRi}" data-col="${ci}" title="${esc(raw)}">${esc(raw)}</td>`;
        }
      }
    }
    html += '</tr>';
  }
  html += '</tbody>';
  tbl.innerHTML = html;

  // Wire checkboxes
  tbl.querySelectorAll('thead input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const idx = parseInt(e.target.dataset.colidx, 10);
      if (e.target.checked) {
        if (SINGLE_COL_TOOLS.has(_activeTool)) {
          _selCols.forEach(prev => {
            const prevCb = tbl.querySelector(`thead input[data-colidx="${prev}"]`);
            if (prevCb) prevCb.checked = false;
          });
          _selCols.clear();
        }
        _selCols.add(idx);
        if (_activeTool === 'delete') _pendingDelete.add(idx);
      } else {
        _selCols.delete(idx);
        if (_activeTool === 'delete') _pendingDelete.delete(idx);
      }
      _updateColClasses();
      if (_sbExpanded && _activeTool) _renderToolPanel();
    });
  });

  // Doble clic en celda → edición inline
  tbl.querySelector('tbody')?.addEventListener('dblclick', e => {
    const td = e.target.closest('td[data-rowabs]');
    if (!td) return;
    _startCellEdit(td);
  });

  // Row info
  const riEl = document.getElementById('editor-rows-info');
  if (riEl) riEl.textContent = t('editor.rows_total', total);
}

function _updateColClasses() {
  const { editorDeletedCols, editorAddedCols, csv } = getState();
  document.querySelectorAll('#editor-tbl thead .eth-wrap').forEach(wrap => {
    const ci   = parseInt(wrap.dataset.col, 10);
    const name = csv?.headers[ci] || '';
    wrap.className = 'eth-wrap';
    if (editorDeletedCols.has(name))    wrap.classList.add('eth-deleted');
    else if (editorAddedCols.has(name)) wrap.classList.add('eth-added');
    else if (_selCols.has(ci))          wrap.classList.add('eth-checked');
  });
}

function _syncSelCols() {
  document.querySelectorAll('#editor-tbl thead input[type=checkbox]').forEach(cb => {
    cb.checked = _selCols.has(parseInt(cb.dataset.colidx, 10));
  });
  _updateColClasses();
}

// ── Paginación ────────────────────────────────────────────────

function _renderPagination() {
  const { csv } = getState();
  const total      = csv?.rows.length ?? 0;
  const totalPages = _pageSize > 0 ? Math.ceil(total / _pageSize) : 1;
  const lblEl      = document.getElementById('editor-page-lbl');
  const btnPrev    = document.getElementById('editor-page-prev');
  const btnNext    = document.getElementById('editor-page-next');
  if (lblEl)   lblEl.textContent  = (_pageSize === 0 || totalPages <= 1) ? '' : t('editor.page_of', _page + 1, totalPages);
  if (btnPrev) btnPrev.disabled   = _page <= 0;
  if (btnNext) btnNext.disabled   = _pageSize === 0 || _page >= totalPages - 1;
}

// ── Sidebar ───────────────────────────────────────────────────

function _toggleSidebar() {
  _sbExpanded = !_sbExpanded;
  const sb        = document.getElementById('editor-sidebar');
  const iconExp   = document.getElementById('sb-icon-expand');
  const iconColl  = document.getElementById('sb-icon-collapse');
  if (sb) { sb.classList.toggle('collapsed', !_sbExpanded); sb.classList.toggle('expanded', _sbExpanded); }
  if (iconExp)  iconExp.style.display  = _sbExpanded ? '' : 'none';
  if (iconColl) iconColl.style.display = _sbExpanded ? 'none' : '';
  _renderSidebar();
}

function _renderSidebar() {
  const container = document.getElementById('editor-sb-tools');
  if (!container) return;

  // Sync CSS to JS state — prevents mismatch on reopen
  const sb       = document.getElementById('editor-sidebar');
  const iconExp  = document.getElementById('sb-icon-expand');
  const iconColl = document.getElementById('sb-icon-collapse');
  if (sb) { sb.classList.toggle('collapsed', !_sbExpanded); sb.classList.toggle('expanded', _sbExpanded); }
  if (iconExp)  iconExp.style.display  = _sbExpanded ? '' : 'none';
  if (iconColl) iconColl.style.display = _sbExpanded ? 'none' : '';

  let html = '';
  for (const tool of TOOLS) {
    const active = _activeTool === tool.id;
    html += `<button class="editor-tool-btn${active ? ' active' : ''}" data-tool="${tool.id}" title="${esc(t(tool.labelKey))}">
      <span class="etb-icon">${tool.icon}</span>
      ${_sbExpanded ? `<span class="etb-label">${esc(t(tool.labelKey))}</span>` : ''}
    </button>`;
  }
  if (_sbExpanded && _activeTool) {
    html += `<div class="editor-panel-divider" style="margin:6px 0"></div>
      <div class="editor-tool-panel" id="editor-tool-panel">${_buildToolPanel(_activeTool)}</div>`;
  }
  container.innerHTML = html;

  container.querySelectorAll('.editor-tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tool = btn.dataset.tool;
      if (!_sbExpanded) {
        _sbExpanded = true;
        const sb        = document.getElementById('editor-sidebar');
        const iconExp   = document.getElementById('sb-icon-expand');
        const iconColl  = document.getElementById('sb-icon-collapse');
        if (sb) { sb.classList.remove('collapsed'); sb.classList.add('expanded'); }
        if (iconExp)  iconExp.style.display  = '';
        if (iconColl) iconColl.style.display = 'none';
        _activeTool = tool;
        if (tool === 'delete') _pendingDelete = new Set(_selCols);
        if (SINGLE_COL_TOOLS.has(tool) && _selCols.size > 1) { const first = [..._selCols][0]; _selCols.clear(); _selCols.add(first); }
      } else {
        if (tool === 'delete' && _activeTool !== tool) _pendingDelete = new Set(_selCols);
        if (SINGLE_COL_TOOLS.has(tool) && _activeTool !== tool && _selCols.size > 1) { const first = [..._selCols][0]; _selCols.clear(); _selCols.add(first); }
        _activeTool = (_activeTool === tool) ? null : tool;
      }
      _renderSidebar();
      _syncSelCols();
    });
  });

  if (_sbExpanded && _activeTool) _wirePanelEvents(_activeTool);
}

function _renderToolPanel() {
  if (!_sbExpanded || !_activeTool) return;
  const panel = document.getElementById('editor-tool-panel');
  if (!panel) return;
  panel.innerHTML = _buildToolPanel(_activeTool);
  _wirePanelEvents(_activeTool);
}

// ── Tool panel builders ───────────────────────────────────────

function _buildToolPanel(id) {
  switch (id) {
    case 'split':      return _panelSplit();
    case 'merge':      return _panelMerge();
    case 'delete':     return _panelDelete();
    case 'add_col':    return _panelAddCol();
    case 'reorder':    return _panelReorder();
    case 'rename':     return _panelRename();
    case 'format':     return _panelFormat();
    case 'spaces':     return _panelSpaces();
    case 'remove_pos': return _panelRemovePos();
    case 'case':       return _panelCase();
    case 'add_text':   return _panelAddText();
    case 'replace':    return _panelReplace();
    default: return '';
  }
}

function _warn(key, color = 'var(--red)') {
  return `<p class="editor-panel-label" style="color:${color};font-weight:700;font-style:italic;font-size:12px;text-align:right">${esc(t(key))}</p>`;
}

// 1 — Split
// 2 — Merge  (inserted after split)
function _loadMergeSeps() {
  try {
    const saved = JSON.parse(localStorage.getItem('editor_presets_merge_sep') || 'null');
    return saved ?? [', ', ' '];
  } catch { return [', ', ' ']; }
}
function _saveMergeSeps(arr) {
  try { localStorage.setItem('editor_presets_merge_sep', JSON.stringify(arr)); } catch {}
}
function _getLastMergeSep() {
  try { return localStorage.getItem('editor_merge_last_sep') ?? ', '; } catch { return ', '; }
}
function _saveLastMergeSep(val) {
  try { localStorage.setItem('editor_merge_last_sep', val); } catch {}
}

function _panelMerge() {
  if (_selCols.size < 2) return _warn('editor.merge.need_cols');
  const { csv } = getState();
  const defaultTitle = [..._selCols].sort((a, b) => a - b).map(i => csv?.headers[i] ?? '').join('+');
  const seps    = _loadMergeSeps();
  const chips   = seps.map((s, i) =>
    `<div class="editor-preset-chip" data-mergesep="${i}" style="cursor:pointer">
      <span style="flex:1;font-family:var(--mono);font-size:10px">${esc(JSON.stringify(s))}</span>
      <span class="epc-rm" data-delmrg="${i}">✕</span>
    </div>`).join('');
  return `
    <div class="editor-panel-row">
      <label class="editor-panel-label">${esc(t('editor.merge.sep_label'))}</label>
      <input class="editor-panel-input" id="ep-merge-sep" value="${esc(_getLastMergeSep())}" placeholder="${esc(t('editor.merge.sep_ph'))}" autocomplete="off">
    </div>
    ${chips ? `<div class="editor-panel-row">
      <div class="editor-panel-label">${esc(t('editor.merge.sep_presets'))}</div>
      <div class="editor-presets" id="ep-merge-sep-pres" style="display:grid;grid-template-columns:repeat(3,1fr);gap:3px">${chips}</div>
    </div>` : ''}
    <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--t1);cursor:pointer">
      <input type="checkbox" id="ep-merge-skip" style="accent-color:var(--accent)" checked>${esc(t('editor.merge.skip_empty'))}
    </label>
    <div class="editor-panel-row">
      <label class="editor-panel-label">${esc(t('editor.merge.col_name'))}</label>
      <input class="editor-panel-input" id="ep-merge-title" value="${esc(defaultTitle)}" autocomplete="off">
    </div>
    <div class="editor-panel-row">
      <label class="editor-panel-label">${esc(t('editor.merge.preview'))}</label>
      <div class="editor-split-prev" id="ep-merge-preview" style="min-height:24px"></div>
    </div>
    <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--t1);cursor:pointer">
      <input type="checkbox" id="ep-merge-del-src">${esc(t('editor.merge.del_sources'))}
    </label>
    <div class="ep-btn-wrap">
      <button class="btn btn-xs btn-p" id="ep-merge-apply">${esc(t('editor.merge.apply'))}</button>
    </div>`;
}

function _loadSplitCustom() {
  try { return JSON.parse(localStorage.getItem('editor_split_custom') || '[]'); } catch { return []; }
}
function _saveSplitCustom(arr) {
  try { localStorage.setItem('editor_split_custom', JSON.stringify(arr)); } catch {}
}

function _detectSplitType(colVals) {
  const vals = colVals.filter(v => v !== '');
  if (!vals.length) return { type: 'custom', custom: '' };
  const n = vals.length;
  const thresh = Math.max(1, Math.ceil(n * 0.6));
  if (vals.filter(v => v.includes('\n')).length >= thresh) return { type: 'linebreak', custom: '' };
  if (vals.filter(v => v.includes(',')).length  >= thresh) return { type: 'comma',     custom: '' };
  if (vals.filter(v => v.includes(';')).length  >= thresh) return { type: 'semicolon', custom: '' };
  if (vals.filter(v => v.includes(' ')).length  >= Math.ceil(n * 0.75)) return { type: 'space', custom: '' };
  // custom: find most frequent non-alphanumeric, non-space char
  const freq = {};
  for (const v of vals)
    for (const ch of new Set(v.replace(/[\p{L}\p{N}\s]/gu, '')))
      freq[ch] = (freq[ch] || 0) + 1;
  const best = Object.entries(freq).filter(([,c]) => c >= thresh).sort((a,b) => b[1]-a[1])[0];
  return best ? { type: 'custom', custom: best[0] } : { type: 'custom', custom: '' };
}

const SPLIT_OPTS = [
  { value: 'space',     key: 'editor.split.opt_space'     },
  { value: 'linebreak', key: 'editor.split.opt_linebreak'  },
  { value: 'comma',     key: 'editor.split.opt_comma'      },
  { value: 'semicolon', key: 'editor.split.opt_semicolon'  },
  { value: 'custom',    key: 'editor.split.opt_custom'     },
];
const SPLIT_DELIM_MAP = { space: ' ', linebreak: '\n', comma: ',', semicolon: ';' };

function _panelSplit() {
  if (_selCols.size !== 1) return _warn('editor.split.one_col');
  const { csv } = getState();
  const colIdx  = [..._selCols][0];
  const colVals = (csv?.rows || []).slice(0, 30).map(r => r[colIdx] ?? '');
  const detected = _detectSplitType(colVals);

  const customs = _loadSplitCustom();
  const chips   = customs.map((s, i) =>
    `<div class="editor-preset-chip" data-splitcus="${i}" style="cursor:pointer">
      <span style="flex:1;font-family:var(--mono);font-size:10px">${esc(JSON.stringify(s))}</span>
      <span class="epc-rm" data-delcus="${i}">✕</span>
    </div>`).join('');
  const opts = SPLIT_OPTS.map(({ value, key }) =>
    `<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--t1);cursor:pointer">
      <input type="radio" name="ep-split-type" value="${value}" ${value === detected.type ? 'checked' : ''}
        style="accent-color:var(--accent);cursor:pointer;align-self:center">
      ${value === 'custom' ? `<span>${esc(t(key))}:</span>` : `<span>${esc(t(key))}</span>`}
    </label>`).join('');
  const showCustom = detected.type === 'custom';
  return `
    <div class="editor-panel-row">
      <div class="editor-panel-label">${esc(t('editor.split.val_label'))}</div>
      <div style="display:flex;flex-direction:column;gap:5px">${opts}</div>
    </div>
    <div id="ep-split-custom-wrap" style="display:${showCustom ? 'flex' : 'none'};flex-direction:column;gap:6px">
      <input class="editor-panel-input" id="ep-split-custom" value="${esc(detected.custom)}" autocomplete="off">
      ${chips ? `<div class="editor-panel-row">
        <div class="editor-panel-label">${esc(t('editor.split.custom_saved'))}</div>
        <div class="editor-presets" id="ep-split-cus-pres" style="display:grid;grid-template-columns:repeat(3,1fr);gap:3px">${chips}</div>
      </div>` : ''}
    </div>
    <div class="editor-panel-row">
      <label class="editor-panel-label">${esc(t('editor.split.preview'))}</label>
      <div class="editor-split-prev" id="ep-split-preview" style="min-height:24px"></div>
    </div>
    <div class="ep-btn-wrap"><button class="btn btn-xs btn-p" id="ep-split-apply">${esc(t('editor.split.apply'))}</button></div>`;
}

// 2 — Delete
function _panelDelete() {
  if (_pendingDelete.size === 0) return _warn('editor.delete.none', 'var(--red)');
  const { csv } = getState();
  const items = [..._pendingDelete].map(i => {
    const name = csv?.headers[i] || `Col${i+1}`;
    return `<div style="display:flex;align-items:center;gap:6px;padding:3px 0">
      <span class="ep-del-x" data-colidx="${i}" style="cursor:pointer;width:14px;height:14px;border:1.5px solid var(--red);border-radius:2px;background:transparent;display:inline-flex;align-items:center;justify-content:center;color:var(--red);font-size:9px;font-weight:700;line-height:1;padding:0;flex-shrink:0;user-select:none">✕</span>
      <span style="font-size:11px;color:var(--t1)">${esc(name)}</span>
    </div>`;
  }).join('');
  return `
    <div class="editor-panel-row">
      <p class="editor-panel-label"><strong>${esc(t('editor.delete.col_prefix'))}</strong></p>
      <div id="ep-delete-list">${items}</div>
    </div>
    <div class="ep-btn-wrap"><button class="btn btn-xs btn-red" id="ep-delete-apply">${esc(t('editor.delete.confirm'))}</button></div>`;
}

// 2b — Add column
function _panelAddCol() {
  return `
    <div class="editor-panel-row">
      <label class="editor-panel-label">${esc(t('editor.add_col.name_label'))}</label>
      <input class="editor-panel-input" id="ep-addcol-name" placeholder="${esc(t('editor.add_col.name_ph'))}" autocomplete="off">
    </div>
    <div class="ep-btn-wrap"><button class="btn btn-xs btn-p" id="ep-addcol-apply">${esc(t('editor.add_col.apply'))}</button></div>`;
}

// 3 — Reorder
function _panelReorder() {
  const { csv } = getState();
  if (!csv) return '';
  if (_reorderOrder.length !== csv.headers.length) _reorderOrder = csv.headers.map((_, i) => i);
  const rows = _reorderOrder.map((ci, pos) => {
    const name = csv.headers[ci] || `Col${ci + 1}`;
    const moved = ci !== pos;
    return `<div class="editor-preset-chip ep-reorder-item" data-pos="${pos}" style="cursor:grab;touch-action:none;user-select:none">
      <svg viewBox="0 0 10 14" width="9" height="13" fill="currentColor" style="opacity:.35;flex-shrink:0"><circle cx="3" cy="3" r="1"/><circle cx="7" cy="3" r="1"/><circle cx="3" cy="7" r="1"/><circle cx="7" cy="7" r="1"/><circle cx="3" cy="11" r="1"/><circle cx="7" cy="11" r="1"/></svg>
      <span style="font-size:10px;color:var(--t2);min-width:16px;flex-shrink:0">${pos + 1}.</span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap${moved ? ';color:var(--accent)' : ''}">${esc(name)}</span>
      <span class="epc-rm" data-rop="up"   data-pos="${pos}" title="Subir">↑</span>
      <span class="epc-rm" data-rop="down" data-pos="${pos}" title="Bajar">↓</span>
    </div>`;
  }).join('');
  return `
    <div class="editor-presets" id="ep-reorder-list">${rows}</div>
    <div class="ep-btn-wrap"><button class="btn btn-xs btn-p" id="ep-reorder-apply">${esc(t('editor.reorder.apply'))}</button></div>`;
}

// 4 — Rename
function _panelRename() {
  if (_selCols.size !== 1) return _warn('editor.split.one_col');
  const { csv } = getState();
  const ci = [..._selCols][0];
  return `
    <div class="editor-panel-row">
      <label class="editor-panel-label">${esc(t('editor.rename.label'))}</label>
      <input class="editor-panel-input" id="ep-rename-input" value="${esc(csv?.headers[ci] || '')}" placeholder="${esc(t('editor.rename.ph'))}" autocomplete="off">
    </div>
    <div class="ep-btn-wrap"><button class="btn btn-xs btn-p" id="ep-rename-apply">${esc(t('editor.rename.apply'))}</button></div>`;
}

// 5 — Format
const FMT_DEFAULTS = {
  number:   ['0000', '0000,00', '0.000', '0.000,00'],
  currency: ['$0000,00', '$0.000,00'],
  percent:  ['0000%', '0000,00%', '0.000%', '0.000,00%'],
  date:     ['dd/mm/yy', 'dd/mm/yyyy'],
};
const FMT_MAX = 10;

function _detectFmtType(csv, ci) {
  const vals = (csv?.rows || []).slice(0, 20).map(r => (r[ci] ?? '').trim()).filter(Boolean);
  if (!vals.length) return 'number';
  if (vals.filter(v => /^\$[\d.,]/.test(v)).length / vals.length > 0.5) return 'currency';
  if (vals.filter(v => /^\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}$/.test(v) || /^\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}$/.test(v)).length / vals.length > 0.6) return 'date';
  return 'number';
}

function _getFmtHidden(type) {
  try { return JSON.parse(localStorage.getItem('editor_fmt_hidden') || '{}')[type] || []; } catch { return []; }
}
function _addFmtHidden(type, pat) {
  try {
    const stored = JSON.parse(localStorage.getItem('editor_fmt_hidden') || '{}');
    const arr = stored[type] || [];
    if (!arr.includes(pat)) arr.push(pat);
    stored[type] = arr;
    localStorage.setItem('editor_fmt_hidden', JSON.stringify(stored));
  } catch {}
}

function _buildFmtPresetsHtml(type, userPresets) {
  const defs    = FMT_DEFAULTS[type] || [];
  const hidden  = _getFmtHidden(type);
  const visDefs = defs.filter(p => !hidden.includes(p));
  // Normalizar: acepta tanto strings como {label,pattern} de versiones anteriores
  const normalize = p => (typeof p === 'string' ? p : (p?.pattern || p?.label || '')).trim();
  const normUser  = (userPresets || []).map(normalize).filter(Boolean);
  const user      = normUser.filter(p => !defs.includes(p) && !hidden.includes(p));
  const all     = [...visDefs, ...user].slice(0, FMT_MAX);
  if (!all.length) return '';
  return `<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:3px" id="ep-fmt-${type}-pres">
    ${all.map(p => `<div class="editor-preset-chip" data-ptype="${type}" data-pattern="${esc(p)}" style="cursor:pointer">
      <span style="font-family:var(--mono);font-size:10px;flex:1">${esc(p)}</span>
      <span class="epc-rm" data-delfmt="${esc(type)}" data-delfmtpat="${esc(p)}">✕</span>
    </div>`).join('')}
  </div>`;
}

function _panelFormat() {
  if (_selCols.size !== 1) return _warn('editor.split.one_col');
  const { prepFormats, csv } = getState();
  const ci       = [..._selCols][0];
  const detected = _detectFmtType(csv, ci);
  const tabs = ['number', 'currency', 'percent', 'date'];
  const tabBtns = tabs.map(tp =>
    `<button class="fb${detected === tp ? ' on' : ''}" data-fmtab="${tp}">${esc(t('editor.format.tab_' + tp))}</button>`
  ).join('');
  const mkSection = (tp, ph) => `
    <div id="ep-fmt-${tp}" style="display:${detected !== tp ? 'none' : 'flex'};flex-direction:column;gap:10px">
      <div class="editor-panel-row">
        <input class="editor-panel-input" id="ep-fmt-${tp}-pat" placeholder="${esc(ph)}" autocomplete="off">
        ${_buildFmtPresetsHtml(tp, prepFormats?.[tp])}
      </div>
      <div class="editor-panel-row">
        <div class="editor-panel-label">${esc(t('editor.format.preview'))}</div>
        <div class="editor-split-prev" id="ep-fmt-${tp}-prev" style="min-height:20px"></div>
      </div>
      <div class="ep-btn-wrap"><button class="btn btn-xs btn-p" id="ep-fmt-${tp}-apply">${esc(t('editor.format.apply'))}</button></div>
    </div>`;
  return `
    <div style="display:flex;gap:4px;flex-wrap:wrap">${tabBtns}</div>
    ${mkSection('number',   '0000,00')}
    ${mkSection('currency', '$0000,00')}
    ${mkSection('percent',  '0000%')}
    ${mkSection('date',     'dd/mm/yyyy')}`;
}

// 6 — Spaces
function _panelSpaces() {
  if (_selCols.size === 0) return _warn('editor.delete.none', 'var(--red)');
  const MODES = [
    ['leading',    'editor.spaces.leading'   ],
    ['between',    'editor.spaces.between'   ],
    ['all',        'editor.spaces.all'       ],
    ['linebreaks', 'editor.spaces.linebreaks'],
    ['html_ent',   'editor.spaces.html_ent'  ],
    ['html_tags',  'editor.spaces.html_tags' ],
    ['delimiters', 'editor.spaces.delimiters'],
    ['nonprint',   'editor.spaces.nonprint'  ],
  ];
  const cbs = MODES.map(([id, key]) =>
    `<label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--t1);cursor:pointer">
      <input type="checkbox" data-mode="${id}" style="accent-color:var(--accent)">${esc(t(key))}
    </label>`).join('');
  return `
    <div class="editor-panel-row" style="gap:7px">${cbs}</div>
    <div class="editor-panel-row">
      <div class="editor-panel-label">${esc(t('editor.format.preview'))}</div>
      <div class="editor-split-prev" id="ep-spaces-prev" style="min-height:20px"></div>
    </div>
    <div class="ep-btn-wrap"><button class="btn btn-xs btn-p" id="ep-spaces-apply">${esc(t('editor.spaces.apply'))}</button></div>`;
}

// ── Numeric spinner component ─────────────────────────────────

function _numSpin(id, min, max, val, wrapStyle) {
  return `<div class="ep-num-spin"${wrapStyle ? ` style="${wrapStyle}"` : ''}>
    <input type="text" id="${id}" class="ep-nsv" value="${val}" data-min="${min}" data-max="${max}" inputmode="numeric">
    <div class="ep-nsb">
      <button type="button" data-spin="up">▴</button>
      <button type="button" data-spin="down">▾</button>
    </div>
  </div>`;
}

function _wireNumSpins() {
  document.querySelectorAll('.ep-num-spin [data-spin]').forEach(btn => {
    btn.addEventListener('click', () => {
      const inp = btn.closest('.ep-num-spin')?.querySelector('.ep-nsv');
      if (!inp) return;
      const mn = parseInt(inp.dataset.min ?? '0');
      const mx = parseInt(inp.dataset.max ?? '9999');
      let v = parseInt(inp.value) || mn;
      v = btn.dataset.spin === 'up' ? Math.min(mx, v + 1) : Math.max(mn, v - 1);
      inp.value = v;
      inp.dispatchEvent(new Event('input'));
    });
  });
}

// 7 — Remove by position
function _panelRemovePos() {
  if (_selCols.size === 0) return _warn('editor.delete.none', 'var(--red)');
  return `
    <div style="display:flex;gap:3px;flex-wrap:wrap">
      <button class="fb on" data-rptab="from_to"    style="font-size:10px">${esc(t('editor.rempos.from_to'))}</button>
      <button class="fb"    data-rptab="first_last"  style="font-size:10px">${esc(t('editor.rempos.first_last'))}</button>
      <button class="fb"    data-rptab="before_after" style="font-size:10px">${esc(t('editor.rempos.before_after'))}</button>
    </div>
    <div id="ep-rp-from_to" style="display:flex;align-items:center;gap:8px;justify-content:flex-end">
      <label class="editor-panel-label">${esc(t('editor.rempos.from'))}</label>
      ${_numSpin('ep-rp-from', 0, 9999, 0)}
      <label class="editor-panel-label" style="margin-left:6px">${esc(t('editor.rempos.to'))}</label>
      ${_numSpin('ep-rp-to', 0, 9999, 0)}
    </div>
    <div id="ep-rp-first_last" style="display:none;align-items:center;gap:6px">
      <button class="fb on" data-rpside="first">${esc(t('editor.rempos.first'))}</button>
      <button class="fb"    data-rpside="last">${esc(t('editor.rempos.last'))}</button>
      ${_numSpin('ep-rp-n', 1, 9999, 1, 'margin-left:auto')}
    </div>
    <div id="ep-rp-before_after" style="display:none;flex-direction:column;gap:6px">
      <div style="display:flex;gap:4px">
        <button class="fb on" data-rpside2="before">${esc(t('editor.rempos.before'))}</button>
        <button class="fb"    data-rpside2="after">${esc(t('editor.rempos.after'))}</button>
      </div>
      <input class="editor-panel-input" id="ep-rp-text" placeholder="${esc(t('editor.rempos.text_ph'))}" autocomplete="off">
      <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--t1);cursor:pointer">
        <input type="checkbox" id="ep-rp-mc" style="accent-color:var(--accent)">${esc(t('editor.rempos.match_case'))}
      </label>
    </div>
    <div class="editor-panel-row">
      <div class="editor-panel-label">${esc(t('editor.format.preview'))}</div>
      <div class="editor-split-prev" id="ep-rp-prev" style="min-height:20px"></div>
    </div>
    <div class="ep-btn-wrap"><button class="btn btn-xs btn-p" id="ep-rp-apply">${esc(t('editor.rempos.apply'))}</button></div>`;
}

// 8 — Case
function _panelCase() {
  if (_selCols.size === 0) return _warn('editor.delete.none', 'var(--red)');
  const MODES = [
    ['sentence',    'editor.case.sentence'   ],
    ['capitalize',  'editor.case.capitalize' ],
    ['lower_cap_w', 'editor.case.lower_cap_w'],
    ['lower_cap',   'editor.case.lower_cap'  ],
    ['lower',       'editor.case.lower'      ],
    ['upper',       'editor.case.upper'      ],
    ['toggle',      'editor.case.toggle'     ],
  ];
  const radios = MODES.map(([id, key], i) =>
    `<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--t1);cursor:pointer">
      <input type="radio" name="ep-case-type" value="${id}" ${i === 0 ? 'checked' : ''} style="accent-color:var(--accent);cursor:pointer;align-self:center">
      <span>${esc(t(key))}</span>
    </label>`).join('');
  return `
    <div class="editor-panel-row">
      <label class="editor-panel-label">${esc(t('editor.case.val_label'))}</label>
      <div style="display:flex;flex-direction:column;gap:6px">${radios}</div>
    </div>
    <div class="editor-panel-row">
      <div class="editor-panel-label">${esc(t('editor.format.preview'))}</div>
      <div class="editor-split-prev" id="ep-case-prev" style="min-height:20px"></div>
    </div>
    <div class="ep-btn-wrap"><button class="btn btn-xs btn-p" id="ep-case-apply">${esc(t('editor.case.apply'))}</button></div>`;
}

// 9 — Add text
function _panelAddText() {
  if (_selCols.size === 0) return _warn('editor.delete.none', 'var(--red)');
  const pres    = _loadLSPresets('addtext');
  const presHtml = pres.map((p, pi) =>
    `<div class="editor-preset-chip" data-addpre="${pi}" style="cursor:pointer">
      <span style="flex:1;font-family:var(--mono);font-size:10px">${esc(p.text)}</span>
      <span style="color:var(--t2);font-size:9px">${p.pos === 'start' ? '←' : p.pos === 'end' ? '→' : `↔${p.n ?? 2}`}</span>
      <span class="epc-rm" data-deladd="${pi}">✕</span>
    </div>`).join('');
  return `
    <input class="editor-panel-input" id="ep-add-text" placeholder="${esc(t('editor.add.text_ph'))}" autocomplete="off">
    <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">
      <button class="fb on" data-addpos="start">${esc(t('editor.add.start'))}</button>
      <button class="fb"    data-addpos="end">${esc(t('editor.add.end'))}</button>
      <button class="fb"    data-addpos="between">${esc(t('editor.add.between'))}</button>
      ${_numSpin('ep-add-between-n', 1, 99, 2, 'display:none;margin-left:auto')}
    </div>
    <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--t1);cursor:pointer">
      <input type="checkbox" id="ep-add-skip" style="accent-color:var(--accent)" checked>${esc(t('editor.add.skip_empty'))}
    </label>
    ${presHtml ? `<div class="editor-panel-row">
      <div class="editor-panel-label">${esc(t('editor.add.presets'))}</div>
      <div class="editor-presets" id="ep-add-pres">${presHtml}</div>
    </div><div class="editor-panel-divider"></div>` : ''}
    <div class="editor-panel-row">
      <div class="editor-panel-label">${esc(t('editor.format.preview'))}</div>
      <div class="editor-split-prev" id="ep-add-prev" style="min-height:20px"></div>
    </div>
    <div class="ep-btn-wrap">
      <button class="btn btn-xs btn-p" id="ep-add-apply">${esc(t('editor.add.apply'))}</button>
    </div>`;
}

// 10 — Replace
function _panelReplace() {
  if (_selCols.size === 0) return _warn('editor.delete.none', 'var(--red)');
  const pres    = _loadLSPresets('replace');
  const presHtml = pres.map((p, pi) =>
    `<div class="editor-preset-chip" data-replpre="${pi}" style="cursor:pointer">
      <span style="flex:1;font-family:var(--mono);font-size:10px">${esc(p.label || p.pairs?.[0]?.find || '')}</span>
      <span class="epc-rm" data-delrepl="${pi}">✕</span>
    </div>`).join('');
  return `
    <div id="ep-repl-pairs">
      <div class="editor-panel-row" style="gap:4px">
        <input class="editor-panel-input ep-rf" placeholder="${esc(t('editor.replace.find_ph'))}" autocomplete="off" style="text-align:right">
        <input class="editor-panel-input ep-rr" placeholder="${esc(t('editor.replace.replace_ph'))}" autocomplete="off" style="text-align:right">
      </div>
    </div>
    ${presHtml ? `<div class="editor-panel-row">
      <div class="editor-panel-label">${esc(t('editor.replace.presets'))}</div>
      <div class="editor-presets" id="ep-repl-pres">${presHtml}</div>
    </div><div class="editor-panel-divider"></div>` : ''}
    <div class="editor-panel-row">
      <div class="editor-panel-label">${esc(t('editor.format.preview'))}</div>
      <div class="editor-split-prev" id="ep-repl-prev" style="min-height:20px"></div>
    </div>
    <div class="ep-btn-wrap">
      <button class="btn btn-xs btn-p" id="ep-repl-apply">${esc(t('editor.replace.apply'))}</button>
    </div>`;
}

// ── Panel wiring ──────────────────────────────────────────────

function _wirePanelEvents(id) {
  switch (id) {
    case 'split':      _wireSplit();     break;
    case 'merge':      _wireMerge();     break;
    case 'delete':     _wireDelete();    break;
    case 'add_col':    _wireAddCol();    break;
    case 'reorder':    _wireReorder();   break;
    case 'rename':     _wireRename();    break;
    case 'format':     _wireFormat();    break;
    case 'spaces':     _wireSpaces();    break;
    case 'remove_pos': _wireRemovePos(); break;
    case 'case':       _wireCase();      break;
    case 'add_text':   _wireAddText();   break;
    case 'replace':    _wireReplace();   break;
  }
  _wireNumSpins();
}

function _getSplitDelim() {
  const type = document.querySelector('input[name="ep-split-type"]:checked')?.value;
  if (!type || type !== 'custom') return SPLIT_DELIM_MAP[type] ?? ' ';
  return document.getElementById('ep-split-custom')?.value ?? '';
}

function _updateSplitPreview() {
  const { csv } = getState();
  const prevEl  = document.getElementById('ep-split-preview');
  if (!prevEl) return;
  const colIdx = [..._selCols][0];
  const delim  = _getSplitDelim();
  if (!delim || !csv) { prevEl.innerHTML = ''; return; }
  const rows = splitPreview(csv, colIdx, delim, 3);
  prevEl.innerHTML = rows.map(parts =>
    `<div class="editor-split-row">${parts.map((p, i) =>
      `<span class="editor-split-part ${i === 0 ? 'ep0' : 'ep-new'}">${esc(p) || '&nbsp;'}</span>`
    ).join('')}</div>`
  ).join('');
}

function _wireSplit() {
  const colIdx  = [..._selCols][0];
  const cusWrap = document.getElementById('ep-split-custom-wrap');

  // Radio change
  document.querySelectorAll('input[name="ep-split-type"]').forEach(r => {
    r.addEventListener('change', () => {
      if (cusWrap) cusWrap.style.display = r.value === 'custom' ? 'flex' : 'none';
      _updateSplitPreview();
    });
  });

  // Custom input → preview + auto-save on blur (max 3)
  const cusInp = document.getElementById('ep-split-custom');
  cusInp?.addEventListener('input', _updateSplitPreview);
  cusInp?.addEventListener('blur', () => {
    const val = cusInp.value.trim();
    if (!val) return;
    const arr = _loadSplitCustom();
    if (!arr.includes(val)) { arr.unshift(val); if (arr.length > 3) arr.length = 3; _saveSplitCustom(arr); _renderToolPanel(); }
  });

  // Custom presets chips
  document.getElementById('ep-split-cus-pres')?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-splitcus]');
    const del  = e.target.closest('[data-delcus]');
    if (del) {
      const idx = parseInt(del.dataset.delcus, 10);
      const arr = _loadSplitCustom(); arr.splice(idx, 1); _saveSplitCustom(arr);
      _renderToolPanel(); return;
    }
    if (chip) {
      const inp = document.getElementById('ep-split-custom');
      if (inp) { inp.value = _loadSplitCustom()[parseInt(chip.dataset.splitcus, 10)] ?? ''; _updateSplitPreview(); }
    }
  });

  // Apply
  document.getElementById('ep-split-apply')?.addEventListener('click', () => {
    const { csv } = getState();
    const delim = _getSplitDelim();
    if (!delim || !csv) return;
    const { csv: newCsv, newColCount } = splitColumn(csv, colIdx, delim);
    if (newColCount === 0) return;
    const origName   = csv.headers[colIdx] || `Col${colIdx + 1}`;
    const addedNames = Array.from({ length: newColCount }, (_, i) => `${origName}_${i + 2}`);
    const { editorAddedCols, editorOpsCount, editorToolsUsed } = getState();
    _pushHistory();
    setState({ csv: newCsv, editorAddedCols: new Set([...editorAddedCols, ...addedNames]),
      editorOpsCount: (editorOpsCount || 0) + 1, editorToolsUsed: new Set([...(editorToolsUsed || []), 'split']) });
    _commitCsv(newCsv);
    _selCols = new Set();
    _renderTable(); _renderPagination(); _renderSidebar();
    toast(t('toast.editor_split_ok', newColCount));
  });

  // Initial preview with Space
  _updateSplitPreview();
}

function _updateMergePreview() {
  const { csv } = getState();
  const prevEl  = document.getElementById('ep-merge-preview');
  if (!prevEl || !csv) return;
  const idxs      = [..._selCols].sort((a, b) => a - b);
  const sep       = document.getElementById('ep-merge-sep')?.value ?? ', ';
  const skipEmpty = document.getElementById('ep-merge-skip')?.checked ?? true;
  const rows = mergePreview(csv, idxs, sep, skipEmpty, 3);
  prevEl.innerHTML = rows.map(({ result }) =>
    `<div class="editor-split-row"><span class="editor-split-part ep-new">${esc(result) || '&nbsp;'}</span></div>`
  ).join('');
}

function _wireMerge() {
  document.getElementById('ep-merge-sep-pres')?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-mergesep]');
    const del  = e.target.closest('[data-delmrg]');
    if (del) {
      const idx = parseInt(del.dataset.delmrg, 10);
      const seps = _loadMergeSeps(); seps.splice(idx, 1); _saveMergeSeps(seps);
      _renderToolPanel(); return;
    }
    if (chip) {
      const seps = _loadMergeSeps();
      const inp  = document.getElementById('ep-merge-sep');
      if (inp) { inp.value = seps[parseInt(chip.dataset.mergesep, 10)] ?? ''; _updateMergePreview(); }
    }
  });

  const mergeInp = document.getElementById('ep-merge-sep');
  mergeInp?.addEventListener('input', _updateMergePreview);
  mergeInp?.addEventListener('blur', () => {
    const val = mergeInp.value;
    if (val === '') return;
    const seps = _loadMergeSeps();
    if (!seps.includes(val)) { seps.unshift(val); if (seps.length > 3) seps.length = 3; _saveMergeSeps(seps); _renderToolPanel(); }
  });

  document.getElementById('ep-merge-skip')?.addEventListener('change', _updateMergePreview);

  document.getElementById('ep-merge-apply')?.addEventListener('click', () => {
    const { csv } = getState();
    if (!csv || _selCols.size < 2) return;
    const sep         = document.getElementById('ep-merge-sep')?.value ?? ', ';
    const skipEmpty   = document.getElementById('ep-merge-skip')?.checked ?? true;
    const deleteSrc   = document.getElementById('ep-merge-del-src')?.checked ?? false;
    const customHeader = document.getElementById('ep-merge-title')?.value.trim() || null;
    const idxs        = [..._selCols].sort((a, b) => a - b);
    _saveLastMergeSep(sep);
    const { editorOpsCount, editorToolsUsed } = getState();
    _pushHistory();
    setState({ csv: mergeColumns(csv, idxs, sep, skipEmpty, deleteSrc, customHeader),
      editorOpsCount: (editorOpsCount || 0) + 1, editorToolsUsed: new Set([...(editorToolsUsed || []), 'merge']) });
    _commitCsv(getState().csv);
    _selCols = new Set();
    _renderTable(); _renderPagination(); _renderSidebar();
    toast(t('toast.editor_merged'));
  });

  _updateMergePreview();
}

function _commitCsv(csv) {
  const { editorDisplayCols } = getState();
  broadcastCsvUpdate(csv, editorDisplayCols || null);
  _rerenderFieldSelect();
}

function _rerenderFieldSelect() {
  const { csv: curCsv } = getState();
  if (curCsv) _recomputeFieldIndices(curCsv);
  if (_fieldSelectRefresh && $('c-fields') && !$('c-fields').classList.contains('hidden')) {
    _fieldSelectRefresh();
  }
}

/**
 * Recomputa todos los índices de campo confirmados usando los nombres guardados.
 * Necesario después de cualquier op estructural del editor embebido (delete, add, reorder, etc.)
 * porque esas ops llaman _commitCsv pero NO pasan por _applyEditorOp (que tiene el recompute).
 */
function _recomputeFieldIndices(newCsv) {
  const {
    emailColName,
    confirmedNombreColName, confirmedApellidoColName, confirmedEmpresaColName,
    confirmedTelColName, confirmedPaisColName,
    selectedColumnNames,
  } = getState();

  const _ri = name => (name != null ? newCsv.headers.indexOf(name) : null);

  const upd = {
    confirmedNombreIdx:   _ri(confirmedNombreColName),
    confirmedApellidoIdx: _ri(confirmedApellidoColName),
    confirmedEmpresaIdx:  _ri(confirmedEmpresaColName),
    confirmedTelIdx:      _ri(confirmedTelColName),
    confirmedPaisIdx:     _ri(confirmedPaisColName),
  };
  if (emailColName != null) {
    const idx = newCsv.headers.indexOf(emailColName);
    upd.colIdx = idx >= 0 ? idx : -1;
  }
  if (selectedColumnNames) {
    const newSel = selectedColumnNames.map(n => newCsv.headers.indexOf(n)).filter(i => i >= 0);
    const newCols = newSel.length === newCsv.headers.length ? null : newSel;
    upd.selectedColumns     = newCols;
    upd.selectedColumnNames = newCols ? newCols.map(i => newCsv.headers[i]) : null;
  }
  setState(upd);
}

function _wireDelete() {
  document.getElementById('ep-delete-list')?.addEventListener('click', (e) => {
    const x = e.target.closest('.ep-del-x');
    if (!x) return;
    const idx = parseInt(x.dataset.colidx, 10);
    _pendingDelete.delete(idx);
    _selCols.delete(idx);
    const cb = document.querySelector(`#editor-tbl thead input[data-colidx="${idx}"]`);
    if (cb) cb.checked = false;
    _updateColClasses();
    _renderToolPanel();
  });

  document.getElementById('ep-delete-apply')?.addEventListener('click', () => {
    const { csv, editorDeletedCols, editorDisplayCols, editorOpsCount, editorToolsUsed } = getState();
    if (!csv || !_pendingDelete.size) return;
    const sortedIdxs = [..._pendingDelete].sort((a, b) => a - b);
    const names = sortedIdxs.map(i => csv.headers[i]).filter(Boolean);
    // Construir displayCols con los fantasmas en su posición original
    const base = editorDisplayCols || csv.headers.map(name => ({ type: 'real', name }));
    const newDisplay = [...base];
    let realCount = 0, dPtr = 0;
    for (let i = 0; i < newDisplay.length; i++) {
      if (newDisplay[i].type === 'ghost') continue;
      if (dPtr < sortedIdxs.length && realCount === sortedIdxs[dPtr]) {
        newDisplay[i] = { type: 'ghost', name: newDisplay[i].name, values: csv.rows.map(r => r[sortedIdxs[dPtr]] ?? '') };
        dPtr++;
      }
      realCount++;
    }
    _pushHistory();
    setState({ csv: deleteColumns(csv, sortedIdxs), editorDeletedCols: new Set([...editorDeletedCols, ...names]),
      editorDisplayCols: newDisplay,
      editorOpsCount: (editorOpsCount || 0) + 1, editorToolsUsed: new Set([...(editorToolsUsed || []), 'delete']) });
    _commitCsv(getState().csv);
    _selCols = new Set();
    _pendingDelete = new Set();
    _renderTable(); _renderPagination(); _renderSidebar();
    _rerenderFieldSelect();
    toast(t('toast.editor_deleted', idxs.length));
  });
}

function _wireAddCol() {
  const inp = document.getElementById('ep-addcol-name');
  inp?.focus();
  document.getElementById('ep-addcol-apply')?.addEventListener('click', () => {
    const { csv, editorAddedCols, editorDeletedCols, editorOpsCount, editorToolsUsed } = getState();
    if (!csv) return;
    const name = inp?.value.trim();
    if (!name) return;
    _pushHistory();
    const newCsv = addColumn(csv, name);
    const newDeletedCols = new Set(editorDeletedCols);
    newDeletedCols.delete(name);
    setState({ csv: newCsv, editorAddedCols: new Set([...editorAddedCols, name]), editorDeletedCols: newDeletedCols,
      editorOpsCount: (editorOpsCount || 0) + 1, editorToolsUsed: new Set([...(editorToolsUsed || []), 'add_col']) });
    _commitCsv(newCsv);
    _selCols = new Set();
    _renderTable(); _renderPagination(); _renderSidebar();
    _rerenderFieldSelect();
    toast(t('toast.editor_col_added'));
  });
}

function _wireReorder() {
  const { csv } = getState();
  if (!csv) return;
  if (_reorderOrder.length !== csv.headers.length) _reorderOrder = csv.headers.map((_, i) => i);

  const list = document.getElementById('ep-reorder-list');
  if (!list) return;

  // Flechas
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-rop]');
    if (!btn) return;
    const pos = parseInt(btn.dataset.pos, 10);
    const op  = btn.dataset.rop;
    if (op === 'up' && pos > 0)
      [_reorderOrder[pos - 1], _reorderOrder[pos]] = [_reorderOrder[pos], _reorderOrder[pos - 1]];
    else if (op === 'down' && pos < _reorderOrder.length - 1)
      [_reorderOrder[pos], _reorderOrder[pos + 1]] = [_reorderOrder[pos + 1], _reorderOrder[pos]];
    _renderToolPanel();
  });

  // Drag-and-drop
  let _dragIdx = null, _ghost = null, _dropIdx = null, _startRect = null;

  const _cleanup = () => {
    if (_ghost) { _ghost.remove(); _ghost = null; }
    list.querySelectorAll('.ep-reorder-item').forEach(el =>
      el.classList.remove('ep-dragging', 'ep-drop-before', 'ep-drop-after'));
    _dragIdx = _dropIdx = _startRect = null;
  };

  list.addEventListener('pointerdown', (e) => {
    if (e.target.closest('[data-rop]')) return;
    const item = e.target.closest('.ep-reorder-item');
    if (!item) return;
    _dragIdx   = parseInt(item.dataset.pos, 10);
    _startRect = item.getBoundingClientRect();
    _ghost = item.cloneNode(true);
    Object.assign(_ghost.style, {
      position: 'fixed', left: `${_startRect.left}px`, width: `${_startRect.width}px`,
      top: `${_startRect.top}px`, opacity: '0.9', pointerEvents: 'none',
      zIndex: '9999', margin: '0', boxShadow: '0 4px 14px rgba(0,0,0,.35)',
    });
    document.body.appendChild(_ghost);
    item.classList.add('ep-dragging');
    list.setPointerCapture(e.pointerId);
  });

  list.addEventListener('pointermove', (e) => {
    if (_dragIdx === null || !_ghost || !_startRect) return;
    _ghost.style.top = `${e.clientY - _startRect.height / 2}px`;
    const items = [...list.querySelectorAll('.ep-reorder-item')];
    let newDrop = items.length;
    for (let i = 0; i < items.length; i++) {
      const r = items[i].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) { newDrop = i; break; }
    }
    if (newDrop !== _dropIdx) {
      _dropIdx = newDrop;
      items.forEach(el => el.classList.remove('ep-drop-before', 'ep-drop-after'));
      if (newDrop < items.length) items[newDrop].classList.add('ep-drop-before');
      else items[items.length - 1].classList.add('ep-drop-after');
    }
  });

  list.addEventListener('pointerup', () => {
    if (_dragIdx === null) return;
    if (_dropIdx !== null && _dropIdx !== _dragIdx && _dropIdx !== _dragIdx + 1) {
      const moved = _reorderOrder.splice(_dragIdx, 1)[0];
      _reorderOrder.splice(_dropIdx > _dragIdx ? _dropIdx - 1 : _dropIdx, 0, moved);
    }
    _cleanup();
    _renderToolPanel();
  });

  list.addEventListener('pointercancel', _cleanup);

  document.getElementById('ep-reorder-apply')?.addEventListener('click', () => {
    const { csv, editorOpsCount, editorToolsUsed } = getState();
    const newCsv = reorderColumns(csv, _reorderOrder);
    _pushHistory();
    setState({ csv: newCsv,
      editorOpsCount: (editorOpsCount || 0) + 1, editorToolsUsed: new Set([...(editorToolsUsed || []), 'reorder']) });
    _commitCsv(newCsv);
    _reorderOrder = newCsv.headers.map((_, i) => i);
    _selCols = new Set();
    _renderTable(); _renderPagination();
    toast(t('toast.editor_op_ok'));
  });
}

function _wireRename() {
  document.getElementById('ep-rename-apply')?.addEventListener('click', () => {
    const { csv, editorOpsCount, editorToolsUsed } = getState();
    const ci = [..._selCols][0];
    const name = document.getElementById('ep-rename-input')?.value.trim();
    if (!name) return;
    _pushHistory();
    const newCsv = renameColumns(csv, { [ci]: name });
    setState({ csv: newCsv,
      editorOpsCount: (editorOpsCount || 0) + 1, editorToolsUsed: new Set([...(editorToolsUsed || []), 'rename']) });
    _commitCsv(newCsv);
    _renderTable(); _renderSidebar();
    toast(t('toast.editor_op_ok'));
  });
}

function _colSamples() {
  const { csv } = getState();
  const ci = [..._selCols][0];
  if (!csv || ci == null) return [];
  return csv.rows.map(r => (r[ci] ?? '').trim()).filter(Boolean).slice(0, 3);
}

function _previewHtml(samples, fn) {
  return samples.map(v =>
    `<span style="font-family:var(--mono);font-size:10px;color:var(--warn);display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(fn(v))}</span>`
  ).join('');
}

function _wireFormat() {
  const ALL_FMT = ['number', 'currency', 'percent', 'date'];

  const _updateFmtPreview = (type) => {
    const prevEl = document.getElementById(`ep-fmt-${type}-prev`);
    if (!prevEl) return;
    const { csv } = getState();
    const ci  = [..._selCols][0];
    const pat = document.getElementById(`ep-fmt-${type}-pat`)?.value.trim();
    if (!pat || !csv) { prevEl.innerHTML = ''; return; }
    const samples = csv.rows.map(r => (r[ci] ?? '').trim()).filter(Boolean).slice(0, 3);
    if (!samples.length) { prevEl.innerHTML = ''; return; }
    prevEl.innerHTML = _previewHtml(samples, v => formatSample(v, type, pat));
  };

  document.querySelectorAll('[data-fmtab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tp = btn.dataset.fmtab;
      document.querySelectorAll('[data-fmtab]').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      ALL_FMT.forEach(t2 => {
        const el = document.getElementById(`ep-fmt-${t2}`);
        if (el) el.style.display = t2 === tp ? 'flex' : 'none';
      });
      _updateFmtPreview(tp);
    });
  });

  const _doAutoSave = (type, pat) => {
    if (!pat) return;
    const { prepFormats } = getState();
    const defs = FMT_DEFAULTS[type] || [];
    const user = (prepFormats?.[type] || []).filter(p => !defs.includes(p));
    const all  = [...defs, ...user];
    if (all.includes(pat)) return;
    if (all.length >= FMT_MAX) return;
    const nf = { ...prepFormats, [type]: [...user, pat] };
    setState({ prepFormats: nf });
    fetch('/api/prep-formats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(nf) }).catch(() => {});
    _renderToolPanel();
  };

  ALL_FMT.forEach(type => {
    const inp = document.getElementById(`ep-fmt-${type}-pat`);
    if (inp) {
      inp.addEventListener('blur',  () => _doAutoSave(type, inp.value.trim()));
      inp.addEventListener('input', () => {
        document.getElementById(`ep-fmt-${type}-pres`)?.querySelectorAll('.editor-preset-chip').forEach(c => c.classList.remove('active'));
        _updateFmtPreview(type);
      });
    }

    document.getElementById(`ep-fmt-${type}-pres`)?.addEventListener('click', (e) => {
      const del = e.target.closest('[data-delfmt]');
      if (del) {
        const tp  = del.dataset.delfmt;
        const pat = del.dataset.delfmtpat;
        if (FMT_DEFAULTS[tp]?.includes(pat)) {
          _addFmtHidden(tp, pat);
        } else {
          const { prepFormats } = getState();
          const nf = { ...prepFormats, [tp]: (prepFormats[tp] || []).filter(p => p !== pat) };
          setState({ prepFormats: nf });
          fetch('/api/prep-formats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(nf) }).catch(() => {});
        }
        _renderToolPanel();
        return;
      }
      const chip = e.target.closest('[data-ptype]');
      if (!chip) return;
      const ptype = chip.dataset.ptype;
      document.getElementById(`ep-fmt-${ptype}-pres`)?.querySelectorAll('.editor-preset-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const i = document.getElementById(`ep-fmt-${ptype}-pat`);
      if (i) { i.value = chip.dataset.pattern; _updateFmtPreview(ptype); }
    });

    document.getElementById(`ep-fmt-${type}-apply`)?.addEventListener('click', () => {
      const { csv, editorOpsCount, editorToolsUsed } = getState();
      const ci  = [..._selCols][0];
      const pat = document.getElementById(`ep-fmt-${type}-pat`)?.value.trim();
      if (!pat) return;
      _pushHistory();
      setState({ csv: formatColumn(csv, ci, type, pat),
        editorOpsCount: (editorOpsCount || 0) + 1, editorToolsUsed: new Set([...(editorToolsUsed || []), 'format']) });
      _commitCsv(getState().csv);
      _renderTable();
      toast(t('toast.editor_op_ok'));
    });

    // Mostrar preview inicial si hay patrón por defecto
    _updateFmtPreview(type);
  });
}

function _wireSpaces() {
  const _getCb = mode => document.querySelector(`#editor-tool-panel input[data-mode="${mode}"]`);
  const _getModes = () => [...document.querySelectorAll('#editor-tool-panel input[data-mode]:checked')].map(cb => cb.dataset.mode);

  const _applyExclusion = (changedMode, isChecked) => {
    if (!isChecked) return;
    if (changedMode === 'all') {
      // "Quitar todos" excluye "inicio/final" y "entre palabras"
      ['leading', 'between'].forEach(m => { const cb = _getCb(m); if (cb) cb.checked = false; });
    } else if (changedMode === 'leading' || changedMode === 'between') {
      // Activar cualquiera de los dos deselecciona "Quitar todos"
      const cb = _getCb('all'); if (cb) cb.checked = false;
    }
  };

  const _updateSpacesPreview = () => {
    const prevEl = document.getElementById('ep-spaces-prev');
    if (!prevEl) return;
    const samples = _colSamples();
    const modes = _getModes();
    if (!samples.length || !modes.length) { prevEl.innerHTML = ''; return; }
    prevEl.innerHTML = _previewHtml(samples, v => applySpacesValue(v, modes));
  };

  document.querySelectorAll('#editor-tool-panel input[data-mode]').forEach(cb => {
    cb.addEventListener('change', e => {
      _applyExclusion(e.target.dataset.mode, e.target.checked);
      _updateSpacesPreview();
    });
  });

  document.getElementById('ep-spaces-apply')?.addEventListener('click', () => {
    const { csv, editorOpsCount, editorToolsUsed } = getState();
    const modes = _getModes();
    if (!modes.length) return;
    _pushHistory();
    let newCsv = csv;
    for (const ci of _selCols) newCsv = applySpaces(newCsv, ci, modes);
    setState({ csv: newCsv,
      editorOpsCount: (editorOpsCount || 0) + 1, editorToolsUsed: new Set([...(editorToolsUsed || []), 'spaces']) });
    _commitCsv(newCsv);
    _renderTable();
    toast(t('toast.editor_op_ok'));
  });
}

function _wireRemovePos() {
  let rpMode  = 'from_to';
  let rpSide  = 'first';
  let rpSide2 = 'before';

  const _getRpOpts = () => {
    if (rpMode === 'from_to')    return { from: parseInt(document.getElementById('ep-rp-from')?.value || '1'), to: parseInt(document.getElementById('ep-rp-to')?.value || '1') };
    if (rpMode === 'first_last') return { side: rpSide, n: parseInt(document.getElementById('ep-rp-n')?.value || '1') };
    return { side: rpSide2, text: document.getElementById('ep-rp-text')?.value || '', matchCase: document.getElementById('ep-rp-mc')?.checked ?? false };
  };
  const _updateRpPreview = () => {
    const prevEl = document.getElementById('ep-rp-prev');
    if (!prevEl) return;
    const samples = _colSamples();
    if (!samples.length) { prevEl.innerHTML = ''; return; }
    const opts = _getRpOpts();
    prevEl.innerHTML = _previewHtml(samples, v => removeByPosValue(v, rpMode, opts));
  };

  document.querySelectorAll('[data-rptab]').forEach(btn => {
    btn.addEventListener('click', () => {
      rpMode = btn.dataset.rptab;
      document.querySelectorAll('[data-rptab]').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      ['from_to', 'first_last', 'before_after'].forEach(id => {
        const el = document.getElementById(`ep-rp-${id}`);
        if (el) el.style.display = id === rpMode ? 'flex' : 'none';
      });
      _updateRpPreview();
    });
  });

  document.querySelectorAll('[data-rpside]').forEach(btn => {
    btn.addEventListener('click', () => {
      rpSide = btn.dataset.rpside;
      document.querySelectorAll('[data-rpside]').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      _updateRpPreview();
    });
  });

  document.querySelectorAll('[data-rpside2]').forEach(btn => {
    btn.addEventListener('click', () => {
      rpSide2 = btn.dataset.rpside2;
      document.querySelectorAll('[data-rpside2]').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      _updateRpPreview();
    });
  });

  const fromEl = document.getElementById('ep-rp-from');
  const toEl   = document.getElementById('ep-rp-to');
  const _clampPos = el => { const v = parseInt(el.value); if (isNaN(v) || v < 0) el.value = 0; };
  fromEl?.addEventListener('input', () => {
    _clampPos(fromEl);
    if (toEl && parseInt(fromEl.value) > parseInt(toEl.value)) toEl.value = fromEl.value;
    _updateRpPreview();
  });
  toEl?.addEventListener('input', () => {
    _clampPos(toEl);
    if (fromEl && parseInt(toEl.value) < parseInt(fromEl.value)) fromEl.value = toEl.value;
    _updateRpPreview();
  });
  ['ep-rp-n','ep-rp-text'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', _updateRpPreview);
  });
  document.getElementById('ep-rp-mc')?.addEventListener('change', _updateRpPreview);
  _updateRpPreview();

  document.getElementById('ep-rp-apply')?.addEventListener('click', () => {
    const { csv, editorOpsCount, editorToolsUsed } = getState();
    const opts = _getRpOpts();
    _pushHistory();
    let newCsv = csv;
    for (const ci of _selCols) newCsv = applyRemoveByPos(newCsv, ci, rpMode, opts);
    setState({ csv: newCsv,
      editorOpsCount: (editorOpsCount || 0) + 1, editorToolsUsed: new Set([...(editorToolsUsed || []), 'remove_pos']) });
    _commitCsv(newCsv);
    _renderTable();
    toast(t('toast.editor_op_ok'));
  });
}

function _wireCase() {
  const _updateCasePreview = () => {
    const prevEl = document.getElementById('ep-case-prev');
    if (!prevEl) return;
    const { csv } = getState();
    const ci = [..._selCols][0];
    const mode = document.querySelector('input[name="ep-case-type"]:checked')?.value || 'sentence';
    if (!csv) { prevEl.innerHTML = ''; return; }
    const samples = _colSamples();
    if (!samples.length) { prevEl.innerHTML = ''; return; }
    prevEl.innerHTML = _previewHtml(samples, v => applyCaseValue(v, mode));
  };

  document.querySelectorAll('input[name="ep-case-type"]').forEach(r => {
    r.addEventListener('change', _updateCasePreview);
  });
  _updateCasePreview();

  document.getElementById('ep-case-apply')?.addEventListener('click', () => {
    const { csv, editorOpsCount, editorToolsUsed } = getState();
    const caseMode = document.querySelector('input[name="ep-case-type"]:checked')?.value || 'sentence';
    _pushHistory();
    let newCsv = csv;
    for (const ci of _selCols) newCsv = applyCase(newCsv, ci, caseMode);
    setState({ csv: newCsv,
      editorOpsCount: (editorOpsCount || 0) + 1, editorToolsUsed: new Set([...(editorToolsUsed || []), 'case']) });
    _commitCsv(newCsv);
    _renderTable();
    toast(t('toast.editor_op_ok'));
  });
}

function _wireAddText() {
  const _getPos    = () => document.querySelector('[data-addpos].on')?.dataset.addpos || 'start';
  const _getN      = () => parseInt(document.getElementById('ep-add-between-n')?.value || '2');
  const nWrap      = document.getElementById('ep-add-between-n')?.closest('.ep-num-spin');
  const _syncN     = (pos) => { if (nWrap) nWrap.style.display = pos === 'between' ? 'flex' : 'none'; };
  const _updateAddPreview = () => {
    const prevEl = document.getElementById('ep-add-prev');
    if (!prevEl) return;
    const samples = _colSamples();
    if (!samples.length) { prevEl.innerHTML = ''; return; }
    const text = document.getElementById('ep-add-text')?.value ?? '';
    const skip = document.getElementById('ep-add-skip')?.checked ?? true;
    prevEl.innerHTML = _previewHtml(samples, v => addTextValue(v, text, _getPos(), skip, _getN()));
  };

  document.querySelectorAll('[data-addpos]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-addpos]').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      _syncN(btn.dataset.addpos);
      _updateAddPreview();
    });
  });
  document.getElementById('ep-add-text')?.addEventListener('input', _updateAddPreview);
  document.getElementById('ep-add-between-n')?.addEventListener('input', _updateAddPreview);
  document.getElementById('ep-add-skip')?.addEventListener('change', _updateAddPreview);

  document.getElementById('ep-add-pres')?.addEventListener('click', (e) => {
    const del = e.target.closest('[data-deladd]');
    if (del) {
      const ps = _loadLSPresets('addtext');
      ps.splice(parseInt(del.dataset.deladd, 10), 1);
      _saveLSPresets('addtext', ps);
      _renderToolPanel();
      return;
    }
    const chip = e.target.closest('[data-addpre]');
    if (!chip) return;
    const p = _loadLSPresets('addtext')[parseInt(chip.dataset.addpre, 10)];
    if (!p) return;
    const inp = document.getElementById('ep-add-text');
    if (inp) inp.value = p.text;
    document.querySelectorAll('[data-addpos]').forEach(b => b.classList.toggle('on', b.dataset.addpos === p.pos));
    const nInp = document.getElementById('ep-add-between-n');
    if (p.pos === 'between' && nInp) { nInp.value = p.n ?? 2; }
    _syncN(p.pos);
  });

  document.getElementById('ep-add-apply')?.addEventListener('click', () => {
    const { csv, editorOpsCount, editorToolsUsed } = getState();
    const text = document.getElementById('ep-add-text')?.value ?? '';
    if (!text) return;
    const pos  = _getPos();
    const skip = document.getElementById('ep-add-skip')?.checked ?? true;
    const n    = _getN();
    _pushHistory();
    let newCsv = csv;
    for (const ci of _selCols) newCsv = applyAddText(newCsv, ci, text, pos, skip, n);
    setState({ csv: newCsv,
      editorOpsCount: (editorOpsCount || 0) + 1, editorToolsUsed: new Set([...(editorToolsUsed || []), 'add_text']) });
    _commitCsv(newCsv);
    _renderTable();
    toast(t('toast.editor_op_ok'));
  });

}

function _wireReplace() {
  const pairsEl = document.getElementById('ep-repl-pairs');
  const _getPairs = () => {
    const finds = [...document.querySelectorAll('#ep-repl-pairs .ep-rf')].map(i => i.value);
    const repls = [...document.querySelectorAll('#ep-repl-pairs .ep-rr')].map(i => i.value);
    return finds.map((f, i) => ({ find: f, replace: repls[i] ?? '' })).filter(p => p.find);
  };
  const _updateReplPreview = () => {
    const prevEl = document.getElementById('ep-repl-prev');
    if (!prevEl) return;
    const samples = _colSamples();
    const pairs = _getPairs();
    if (!samples.length || !pairs.length) { prevEl.innerHTML = ''; return; }
    prevEl.innerHTML = _previewHtml(samples, v => replaceValue(v, pairs));
  };
  pairsEl?.addEventListener('input', _updateReplPreview);

  document.getElementById('ep-repl-pres')?.addEventListener('click', (e) => {
    const del = e.target.closest('[data-delrepl]');
    if (del) {
      const ps = _loadLSPresets('replace');
      ps.splice(parseInt(del.dataset.delrepl, 10), 1);
      _saveLSPresets('replace', ps);
      _renderToolPanel();
      return;
    }
    const chip = e.target.closest('[data-replpre]');
    if (!chip || !pairsEl) return;
    const preset = _loadLSPresets('replace')[parseInt(chip.dataset.replpre, 10)];
    if (!preset) return;
    pairsEl.innerHTML = preset.pairs.map(p =>
      `<div class="editor-panel-row" style="gap:4px">
        <input class="editor-panel-input ep-rf" placeholder="${esc(t('editor.replace.find_ph'))}" value="${esc(p.find)}" autocomplete="off">
        <input class="editor-panel-input ep-rr" placeholder="${esc(t('editor.replace.replace_ph'))}" value="${esc(p.replace)}" autocomplete="off">
      </div>`).join('');
    _updateReplPreview();
  });

  document.getElementById('ep-repl-apply')?.addEventListener('click', () => {
    const { csv, editorOpsCount, editorToolsUsed } = getState();
    const pairs = _getPairs();
    if (!pairs.length) return;
    _pushHistory();
    let newCsv = csv;
    for (const ci of _selCols) newCsv = applyReplace(newCsv, ci, pairs);
    setState({ csv: newCsv,
      editorOpsCount: (editorOpsCount || 0) + 1, editorToolsUsed: new Set([...(editorToolsUsed || []), 'replace']) });
    _commitCsv(newCsv);
    _renderTable();
    toast(t('toast.editor_op_ok'));
  });

}

// ── History / Undo ────────────────────────────────────────────

function _pushHistory() {
  const { csv, prepHistory, editorDeletedCols, editorDisplayCols, editorAddedCols } = getState();
  const hist = [...(prepHistory || [])];
  hist.push({
    csv: { headers: [...csv.headers], rows: csv.rows.map(r => [...r]), sep: csv.sep },
    editorDeletedCols:  new Set(editorDeletedCols),
    editorDisplayCols:  editorDisplayCols ? [...editorDisplayCols] : null,
    editorAddedCols:    new Set(editorAddedCols),
  });
  if (hist.length > 30) hist.shift();
  setState({ prepHistory: hist });
  _redoHistory = [];
}

function _undo() {
  const { csv, prepHistory, editorDeletedCols, editorDisplayCols, editorAddedCols } = getState();
  if (!prepHistory?.length) { toast(t('toast.editor_undo_empty')); return; }
  _redoHistory.push({
    csv: { headers: [...csv.headers], rows: csv.rows.map(r => [...r]), sep: csv.sep },
    editorDeletedCols:  new Set(editorDeletedCols),
    editorDisplayCols:  editorDisplayCols ? [...editorDisplayCols] : null,
    editorAddedCols:    new Set(editorAddedCols),
  });
  if (_redoHistory.length > 30) _redoHistory.shift();
  const hist = [...prepHistory];
  const prev = hist.pop();
  setState({ csv: prev.csv, prepHistory: hist,
    editorDeletedCols:  prev.editorDeletedCols,
    editorDisplayCols:  prev.editorDisplayCols || null,
    editorAddedCols:    prev.editorAddedCols });
  _commitCsv(prev.csv);
  _selCols = new Set();
  _renderTable(); _renderPagination(); _renderSidebar();
  toast(t('toast.editor_undo_ok'));
}

function _redo() {
  if (!_redoHistory.length) { toast(t('toast.editor_redo_empty')); return; }
  const { csv, prepHistory, editorDeletedCols, editorDisplayCols, editorAddedCols } = getState();
  const hist = [...(prepHistory || [])];
  hist.push({
    csv: { headers: [...csv.headers], rows: csv.rows.map(r => [...r]), sep: csv.sep },
    editorDeletedCols:  new Set(editorDeletedCols),
    editorDisplayCols:  editorDisplayCols ? [...editorDisplayCols] : null,
    editorAddedCols:    new Set(editorAddedCols),
  });
  if (hist.length > 30) hist.shift();
  const next = _redoHistory.pop();
  setState({ csv: next.csv, prepHistory: hist,
    editorDeletedCols:  next.editorDeletedCols,
    editorDisplayCols:  next.editorDisplayCols || null,
    editorAddedCols:    next.editorAddedCols });
  _commitCsv(next.csv);
  _selCols = new Set();
  _renderTable(); _renderPagination(); _renderSidebar();
  toast(t('toast.editor_redo_ok'));
}

async function _saveAs() {
  const { csv, filename } = getState();
  if (!csv) return;
  const text = toCSV(csv.headers, csv.rows, csv.sep || ',');
  const now  = new Date();
  const pad  = n => String(n).padStart(2, '0');
  const ts   = `_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;
  const base = filename || 'export.csv';
  const dot  = base.lastIndexOf('.');
  const suggestedName = dot > 0 ? base.slice(0, dot) + ts + base.slice(dot) : base + ts + '.csv';

  if ('showSaveFilePicker' in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        startIn: 'downloads',
        types: [{ description: 'CSV', accept: { 'text/csv': ['.csv'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      toast(t('toast.editor_saved'));
    } catch (e) {
      if (e.name !== 'AbortError') toast(t('toast.editor_save_error'));
    }
  } else {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: suggestedName });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast(t('toast.editor_saved'));
  }
}

// ── Ventana externa ───────────────────────────────────────────

function _openInWindow() {
  const win = window.open('/editor.html', 'databflow-editor', 'width=1200,height=700,resizable=yes');
  if (!win) { toast('Pop-up bloqueado — habilitá pop-ups para esta página'); return; }
  closeCsvEditor();
}

// ── Edición inline de celda ──────────────────────────────────

function _startCellEdit(td) {
  // Si ya hay un input activo, guardarlo primero
  const existing = document.querySelector('#editor-tbl input.cell-edit-input');
  if (existing && existing !== td.querySelector('.cell-edit-input')) existing.blur();

  const absRi = parseInt(td.dataset.rowabs);
  const ci    = parseInt(td.dataset.col);
  const { csv } = getState();
  if (!csv || absRi >= csv.rows.length) return;

  // Valor efectivo: overlay corrected > raw
  const ov          = _getOverlay();
  const raw         = csv.rows[absRi]?.[ci] ?? '';
  const corr        = ov.cells.get(`${absRi}:${ci}`);
  const effectiveVal = corr ? corr.newVal : raw;

  td.innerHTML = '';
  td.style.padding = '0';
  const inp = document.createElement('input');
  inp.className = 'cell-edit-input';
  inp.value = effectiveVal;
  td.appendChild(inp);
  inp.focus();
  inp.select();

  let saved = false;

  const _save = () => {
    if (saved) return;
    saved = true;
    td.style.padding = '';
    _commitCellEdit(absRi, ci, inp.value, effectiveVal);
  };
  const _cancel = () => {
    if (saved) return;
    saved = true;
    td.style.padding = '';
    _renderTable();
  };

  inp.addEventListener('blur', _save);
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      inp.removeEventListener('blur', _save);
      _save();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      inp.removeEventListener('blur', _save);
      _cancel();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      inp.removeEventListener('blur', _save);
      _save();
      _moveCellFocus(absRi, ci, e.shiftKey ? -1 : 1);
    }
  });
}

function _commitCellEdit(absRi, ci, newVal, effectiveOld) {
  if (newVal === effectiveOld) { _renderTable(); return; }

  const { csv, editorCellEdits, editorEditedCells } = getState();
  const newRows = csv.rows.map((r, ri) =>
    ri === absRi ? r.map((v, i) => i === ci ? newVal : v) : r
  );
  const newCsv = { ...csv, rows: newRows };

  _invalidateOverlayForCell(absRi, ci, newVal);
  _pushHistory();
  setState({ csv: newCsv, editorCellEdits: (editorCellEdits || 0) + 1,
    editorEditedCells: new Set([...(editorEditedCells || []), `${absRi}:${ci}`]) });
  _commitCsv(newCsv);
  _renderTable();
}

function _moveCellFocus(absRi, ci, dir) {
  const { csv } = getState();
  if (!csv) return;
  const newCi = ci + dir;
  if (newCi < 0 || newCi >= csv.headers.length) return;
  const next = document.querySelector(`#editor-tbl td[data-rowabs="${absRi}"][data-col="${newCi}"]`);
  if (next) _startCellEdit(next);
}

/**
 * Limpia el item de overlay del flow que corresponde a la celda editada.
 * Previene que buildFinalRows sobreescriba el valor del usuario con la corrección antigua.
 */
function _invalidateOverlayForCell(absRi, ci, newVal) {
  const {
    colIdx, empresaIdx,
    telIdx: eTel, nameaiIdx: eNom, apellaiIdx: eApe,
    valItems, domItems, companyNorms, step8Items, nameaiItems,
  } = getState();

  if (ci === colIdx) {
    // Email: eliminar correcciones de validación y dominio para esta fila
    setState({
      valItems: (valItems  || []).filter(v => v.rowIdx !== absRi),
      domItems: (domItems  || []).filter(d => d.rowIdx !== absRi),
    });
  } else if (empresaIdx >= 0 && ci === empresaIdx) {
    // Empresa: quitar esta fila del grupo de norma que la contenía
    const newNorms = (companyNorms || [])
      .map(n => ({ ...n, rowIdxs: n.rowIdxs.filter(ri => ri !== absRi) }))
      .filter(n => n.rowIdxs.length > 0);
    setState({ companyNorms: newNorms });
  } else if (eTel >= 0 && ci === eTel) {
    // Teléfono: actualizar item para que buildFinalRows use el nuevo valor
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

// ── localStorage presets ──────────────────────────────────────

function _loadLSPresets(key) {
  try { return JSON.parse(localStorage.getItem(`editor_presets_${key}`) || '[]'); } catch { return []; }
}
function _saveLSPresets(key, arr) {
  try { localStorage.setItem(`editor_presets_${key}`, JSON.stringify(arr)); } catch {}
}
