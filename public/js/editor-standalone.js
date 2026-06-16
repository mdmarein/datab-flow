/**
 * editor-standalone.js — Editor CSV en ventana independiente
 * dataB Flow · © 2026 mdmarein · GNU AGPLv3
 *
 * Se conecta a la ventana principal via BroadcastChannel.
 * Las operaciones se aplican localmente (feedback inmediato)
 * y se envían a la ventana principal para sincronizar el estado global.
 */

import { t, applyI18n } from './modules/i18n.js';
import { esc, toast } from './modules/utils.js';
import {
  requestState, sendOp, onCsvUpdate, onStateResponse, onThemeChange, onLangChange, closeChannel,
  onOverlayUpdate,
} from './modules/broadcast.js';
import {
  splitColumn, splitPreview,
  deleteColumns, addColumn, mergeColumns, mergePreview, reorderColumns, renameColumns,
  formatColumn, formatSample,
  applySpaces, applySpacesValue, applyRemoveByPos, removeByPosValue,
  applyCase, applyCaseValue, applyAddText, addTextValue, applyReplace, replaceValue,
} from './modules/prep.js';
import { toCSV } from './modules/parser.js';

const SINGLE_COL_TOOLS = new Set(['split', 'rename', 'format', 'case', 'spaces', 'remove_pos', 'add_text', 'replace']);

// ── Estado local ──────────────────────────────────────────────
let _csv            = null;
let _prepFormats    = { number: [], currency: [], date: [] };
let _page           = 0;
let _pageSize       = 16;
let _selCols        = new Set();
let _activeTool     = null;
let _sbExpanded     = false;
let _reorderOrder   = [];
let _prepHistory    = [];
let _redoHistory    = [];
let _pendingDelete  = new Set();
let _deletedCols    = new Set();
let _displayCols    = null;   // [{ type:'real'|'ghost', name, values? }] — orden visual con fantasmas
let _addedCols      = new Set();
let _editedCells        = new Set();  // "ri:ci" de celdas editadas directamente

// ── Overlay del flow ──────────────────────────────────────────
let _overlayData    = null;   // { cells: Map, excluded: Map } — recibido desde main window

function _deserializeOverlay(serialized) {
  if (!serialized) return null;
  return {
    cells:    new Map(serialized.cells    || []),
    excluded: new Map(serialized.excluded || []),
  };
}

// ── Herramientas ──────────────────────────────────────────────
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

// ── Bootstrap ─────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Sync theme and language on fresh load
  document.body.classList.toggle('light', localStorage.getItem('datab-theme') === 'light');
  applyI18n();
  _setStatus(t('editor.status_connecting'), 'neutral');
  _wireStatic();
  onLangChange((lang) => {
    localStorage.setItem('datab-lang', lang);
    location.reload();
  });
  onStateResponse((csv, prepFormats, filename, displayCols) => {
    _displayCols = displayCols || null;
    // Re-sync theme (handles reused window) and reset sidebar to collapsed
    document.body.classList.toggle('light', localStorage.getItem('datab-theme') === 'light');
    _sbExpanded = false;
    _activeTool = null;
    const sb       = document.getElementById('editor-sidebar');
    const iconExp  = document.getElementById('sb-icon-expand');
    const iconColl = document.getElementById('sb-icon-collapse');
    if (sb) { sb.classList.add('collapsed'); sb.classList.remove('expanded'); }
    if (iconExp)  iconExp.style.display  = 'none';
    if (iconColl) iconColl.style.display = '';
    _csv         = csv;
    _prepFormats = prepFormats || { number: [], date: [] };
    _setStatus(t('editor.status_connected'), 'connected');
    document.getElementById('editor-title')?.setAttribute('data-ready', '1');
    const fnEl = document.getElementById('editor-filename');
    if (fnEl && filename) {
      fnEl.textContent = filename;
      document.title = `${filename} — ${t('editor.title')}`;
    }
    _render();
  });
  onCsvUpdate((csv, displayCols) => {
    if (!csv) return;
    _csv = csv;
    _displayCols = displayCols || null;
    _selCols = new Set();
    _renderTable();
    _renderPagination();
    if (_sbExpanded && _activeTool) _renderToolPanel();
  });
  onOverlayUpdate((serialized) => {
    _overlayData = _deserializeOverlay(serialized);
    _renderTable();
  });
  onThemeChange((light) => {
    document.body.classList.toggle('light', light);
  });
  requestState();

  // Timeout de conexión
  setTimeout(() => {
    if (!_csv) _setStatus(t('editor.status_error'), 'error');
  }, 4000);

  window.addEventListener('beforeunload', closeChannel);
});

function _setStatus(msg, state = 'neutral') {
  const el = document.getElementById('editor-sync-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = state === 'connected' ? 'var(--accent)' : state === 'error' ? 'var(--red)' : 'var(--t2)';
}

function _wireStatic() {
  // Undo / Redo
  document.getElementById('btn-editor-undo')?.addEventListener('click', _undo);
  document.getElementById('btn-editor-redo')?.addEventListener('click', _redo);

  // Guardar como
  document.getElementById('btn-editor-saveas')?.addEventListener('click', _saveAs);

  // Cerrar ventana
  document.getElementById('btn-editor-closewin')?.addEventListener('click', () => window.close());

  // Sidebar toggle
  document.getElementById('btn-sidebar-toggle')?.addEventListener('click', () => {
    _sbExpanded = !_sbExpanded;
    const sb       = document.getElementById('editor-sidebar');
    const iconExp  = document.getElementById('sb-icon-expand');
    const iconColl = document.getElementById('sb-icon-collapse');
    if (sb) { sb.classList.toggle('collapsed', !_sbExpanded); sb.classList.toggle('expanded', _sbExpanded); }
    if (iconExp)  iconExp.style.display  = _sbExpanded ? '' : 'none';
    if (iconColl) iconColl.style.display = _sbExpanded ? 'none' : '';
    _renderSidebar();
  });

  // Footer — page size
  const psEl = document.getElementById('editor-page-size');
  if (psEl) {
    psEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.fb[data-val]');
      if (!btn) return;
      psEl.querySelectorAll('.fb').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      _pageSize = parseInt(btn.dataset.val, 10) || 0;
      _page = 0;
      _renderTable();
      _renderPagination();
    });
  }
  document.getElementById('editor-page-prev')?.addEventListener('click', () => { _page--; _renderTable(); _renderPagination(); });
  document.getElementById('editor-page-next')?.addEventListener('click', () => { _page++; _renderTable(); _renderPagination(); });
}

function _render() {
  _renderTable();
  _renderSidebar();
  _renderPagination();
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
  if (!_csv) return;
  const tbl = document.getElementById('editor-tbl');
  if (!tbl) return;
  const { headers, rows } = _csv;
  const total = rows.length;
  const start = _pageSize > 0 ? _page * _pageSize : 0;
  const end   = _pageSize > 0 ? Math.min(start + _pageSize, total) : total;
  const vis   = rows.slice(start, end);

  // displayCols: orden visual con columnas reales + fantasmas en su posición original
  const _realCount = _displayCols ? _displayCols.filter(d => d.type === 'real').length : 0;
  const displayCols = (_displayCols && _realCount === headers.length)
    ? _displayCols
    : headers.map(name => ({ type: 'real', name }));

  let html = '<thead><tr><th class="eth-num">#</th>';
  let _thRealIdx = 0;
  for (const dcol of displayCols) {
    if (dcol.type === 'ghost') {
      html += `<th><div class="eth-wrap eth-deleted"><div class="eth-cb">
        <span class="eth-name" style="color:var(--red);text-decoration:line-through" title="${esc(dcol.name)}">${esc(dcol.name)}</span>
      </div></div></th>`;
    } else {
      const ci   = _thRealIdx++;
      const name = headers[ci] || `Col${ci + 1}`;
      const isDel = _deletedCols.has(name);
      const isAdd = _addedCols.has(name);
      const isSel = _selCols.has(ci);
      const cls   = isDel ? 'eth-deleted' : isAdd ? 'eth-added' : isSel ? 'eth-checked' : '';
      html += `<th><div class="eth-wrap${cls ? ' ' + cls : ''}" data-col="${ci}">
        <div class="eth-cb">
          <input type="checkbox" data-colidx="${ci}" ${isSel ? 'checked' : ''} style="cursor:pointer;accent-color:var(--accent)">
          <span class="eth-name" title="${esc(name)}">${esc(name)}</span>
        </div>
      </div></th>`;
    }
  }
  html += '</tr></thead><tbody>';
  const ov = _overlayData || { cells: new Map(), excluded: new Map() };
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
        } else if (_editedCells.has(`${absRi}:${ci}`)) {
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

  const riEl = document.getElementById('editor-rows-info');
  if (riEl) riEl.textContent = t('editor.rows_total', total);
}

function _updateColClasses() {
  if (!_csv) return;
  document.querySelectorAll('#editor-tbl thead .eth-wrap').forEach(wrap => {
    const ci   = parseInt(wrap.dataset.col, 10);
    const name = _csv.headers[ci] || '';
    wrap.className = 'eth-wrap';
    if (_deletedCols.has(name))  wrap.classList.add('eth-deleted');
    else if (_addedCols.has(name)) wrap.classList.add('eth-added');
    else if (_selCols.has(ci))   wrap.classList.add('eth-checked');
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
  const total      = _csv?.rows.length ?? 0;
  const totalPages = _pageSize > 0 ? Math.ceil(total / _pageSize) : 1;
  const lblEl      = document.getElementById('editor-page-lbl');
  const btnPrev    = document.getElementById('editor-page-prev');
  const btnNext    = document.getElementById('editor-page-next');
  if (lblEl)   lblEl.textContent = (_pageSize === 0 || totalPages <= 1) ? '' : t('editor.page_of', _page + 1, totalPages);
  if (btnPrev) btnPrev.disabled  = _page <= 0;
  if (btnNext) btnNext.disabled  = _pageSize === 0 || _page >= totalPages - 1;
}

// ── Sidebar ───────────────────────────────────────────────────

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
      <div class="editor-tool-panel" id="editor-tool-panel">${_buildPanel(_activeTool)}</div>`;
  }
  container.innerHTML = html;

  container.querySelectorAll('.editor-tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tool = btn.dataset.tool;
      if (!_sbExpanded) {
        _sbExpanded = true;
        const sb       = document.getElementById('editor-sidebar');
        const iconExp  = document.getElementById('sb-icon-expand');
        const iconColl = document.getElementById('sb-icon-collapse');
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
  const panel = document.getElementById('editor-tool-panel');
  if (!panel) return;
  panel.innerHTML = _buildPanel(_activeTool);
  _wirePanelEvents(_activeTool);
}

// ── Panel builders (igual a csv-editor.js) ───────────────────

function _warn(key, color = 'var(--red)') {
  return `<p class="editor-panel-label" style="color:${color};font-weight:700;font-style:italic;font-size:12px;text-align:right">${esc(t(key))}</p>`;
}

function _buildPanel(id) {
  switch (id) {
    case 'split':      return _pSplit();
    case 'merge':      return _pMerge();
    case 'delete':     return _pDelete();
    case 'add_col':    return _pAddCol();
    case 'reorder':    return _pReorder();
    case 'rename':     return _pRename();
    case 'format':     return _pFormat();
    case 'spaces':     return _pSpaces();
    case 'remove_pos': return _pRemovePos();
    case 'case':       return _pCase();
    case 'add_text':   return _pAddText();
    case 'replace':    return _pReplace();
    default: return '';
  }
}

function _pAddCol() {
  return `
    <div class="editor-panel-row">
      <label class="editor-panel-label">${esc(t('editor.add_col.name_label'))}</label>
      <input class="editor-panel-input" id="ep-addcol-name" placeholder="${esc(t('editor.add_col.name_ph'))}" autocomplete="off">
    </div>
    <div class="ep-btn-wrap"><button class="btn btn-xs btn-p" id="ep-addcol-apply">${esc(t('editor.add_col.apply'))}</button></div>`;
}

function _wAddCol() {
  const inp = document.getElementById('ep-addcol-name');
  inp?.focus();
  document.getElementById('ep-addcol-apply')?.addEventListener('click', () => {
    if (!_csv) return;
    const name = inp?.value.trim();
    if (!name) return;
    _pushHistory();
    _csv = addColumn(_csv, name);
    _addedCols.add(name);
    sendOp({ type: 'add_col', name });
    _selCols = new Set();
    _renderTable(); _renderPagination(); _renderSidebar();
    toast(t('toast.editor_col_added'));
  });
}

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

function _pMerge() {
  if (_selCols.size < 2) return _warn('editor.merge.need_cols');
  const defaultTitle = [..._selCols].sort((a, b) => a - b).map(i => _csv?.headers[i] ?? '').join('+');
  const seps  = _loadMergeSeps();
  const chips = seps.map((s, i) =>
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

function _pSplit() {
  if (_selCols.size !== 1) return _warn('editor.split.one_col');
  const colIdx  = [..._selCols][0];
  const colVals = (_csv?.rows || []).slice(0, 30).map(r => r[colIdx] ?? '');
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
        style="accent-color:var(--accent);cursor:pointer">
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

function _pDelete() {
  if (_pendingDelete.size === 0) return _warn('editor.delete.none', 'var(--red)');
  const items = [..._pendingDelete].map(i => {
    const name = _csv?.headers[i] || `Col${i+1}`;
    return `<div style="display:flex;align-items:center;gap:6px;padding:3px 0">
      <span class="ep-del-x" data-colidx="${i}" style="cursor:pointer;color:var(--red);font-size:13px;line-height:1;flex-shrink:0;user-select:none">✕</span>
      <span style="font-size:11px;color:var(--t1)">${esc(name)}</span>
    </div>`;
  }).join('');
  return `<div class="editor-panel-row">
    <p class="editor-panel-label"><strong>${esc(t('editor.delete.col_prefix'))}</strong></p>
    <div id="ep-delete-list">${items}</div>
  </div>
  <div class="ep-btn-wrap"><button class="btn btn-xs btn-red" id="ep-delete-apply">${esc(t('editor.delete.confirm'))}</button></div>`;
}

function _pReorder() {
  if (!_csv) return '';
  if (_reorderOrder.length !== _csv.headers.length) _reorderOrder = _csv.headers.map((_, i) => i);
  const rows = _reorderOrder.map((ci, pos) => {
    const name = _csv.headers[ci] || `Col${ci + 1}`;
    return `<div class="editor-preset-chip ep-reorder-item" data-pos="${pos}" style="cursor:grab;touch-action:none;user-select:none">
      <svg viewBox="0 0 10 14" width="9" height="13" fill="currentColor" style="opacity:.35;flex-shrink:0"><circle cx="3" cy="3" r="1"/><circle cx="7" cy="3" r="1"/><circle cx="3" cy="7" r="1"/><circle cx="7" cy="7" r="1"/><circle cx="3" cy="11" r="1"/><circle cx="7" cy="11" r="1"/></svg>
      <span style="font-size:10px;color:var(--t2);min-width:16px;flex-shrink:0">${pos + 1}.</span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(name)}</span>
      <span class="epc-rm" data-rop="up"   data-pos="${pos}">↑</span>
      <span class="epc-rm" data-rop="down" data-pos="${pos}">↓</span>
    </div>`;
  }).join('');
  return `<div class="editor-presets" id="ep-reorder-list">${rows}</div>
    <div class="ep-btn-wrap"><button class="btn btn-xs btn-p" id="ep-reorder-apply">${esc(t('editor.reorder.apply'))}</button></div>`;
}

function _pRename() {
  if (_selCols.size !== 1) return _warn('editor.split.one_col');
  const ci = [..._selCols][0];
  return `
    <div class="editor-panel-row">
      <label class="editor-panel-label">${esc(t('editor.rename.label'))}</label>
      <input class="editor-panel-input" id="ep-rename-input" value="${esc(_csv?.headers[ci] || '')}" placeholder="${esc(t('editor.rename.ph'))}" autocomplete="off">
    </div>
    <div class="ep-btn-wrap"><button class="btn btn-xs btn-p" id="ep-rename-apply">${esc(t('editor.rename.apply'))}</button></div>`;
}

const FMT_DEFAULTS = {
  number:   ['0000', '0000,00', '0.000', '0.000,00'],
  currency: ['$0000,00', '$0.000,00'],
  percent:  ['0000%', '0000,00%', '0.000%', '0.000,00%'],
  date:     ['dd/mm/yy', 'dd/mm/yyyy'],
};
const FMT_MAX = 10;
const FMT_TYPES = ['number', 'currency', 'percent', 'date'];

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
  const user    = (userPresets || []).filter(p => !defs.includes(p) && !hidden.includes(p));
  const all     = [...visDefs, ...user].slice(0, FMT_MAX);
  if (!all.length) return '';
  return `<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:3px" id="ep-fmt-${type}-pres">
    ${all.map(p => `<div class="editor-preset-chip" data-ptype="${type}" data-pattern="${esc(p)}" style="cursor:pointer">
      <span style="font-family:var(--mono);font-size:10px;flex:1">${esc(p)}</span>
      <span class="epc-rm" data-delfmt="${esc(type)}" data-delfmtpat="${esc(p)}">✕</span>
    </div>`).join('')}
  </div>`;
}

function _pFormat() {
  if (_selCols.size !== 1) return _warn('editor.split.one_col');
  const ci       = [..._selCols][0];
  const detected = _detectFmtType(_csv, ci);
  const tabBtns  = FMT_TYPES.map(tp =>
    `<button class="fb${detected === tp ? ' on' : ''}" data-fmtab="${tp}">${esc(t('editor.format.tab_' + tp))}</button>`
  ).join('');
  const mkSection = (tp, ph) => `
    <div id="ep-fmt-${tp}" style="display:${detected !== tp ? 'none' : 'flex'};flex-direction:column;gap:10px">
      <div class="editor-panel-row">
        <input class="editor-panel-input" id="ep-fmt-${tp}-pat" placeholder="${esc(ph)}" autocomplete="off">
        ${_buildFmtPresetsHtml(tp, _prepFormats[tp])}
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

function _pSpaces() {
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
      <input type="checkbox" data-mode="${id}" style="accent-color:var(--accent)">${esc(t(key))}</label>`).join('');
  return `<div class="editor-panel-row" style="gap:7px">${cbs}</div>
    <div class="editor-panel-row">
      <div class="editor-panel-label">${esc(t('editor.format.preview'))}</div>
      <div class="editor-split-prev" id="ep-spaces-prev" style="min-height:20px"></div>
    </div>
    <div class="ep-btn-wrap"><button class="btn btn-xs btn-p" id="ep-spaces-apply">${esc(t('editor.spaces.apply'))}</button></div>`;
}

// ── Edición inline de celda ──────────────────────────────────

function _startCellEdit(td) {
  const existing = document.querySelector('#editor-tbl input.cell-edit-input');
  if (existing && existing !== td.querySelector('.cell-edit-input')) existing.blur();

  const absRi = parseInt(td.dataset.rowabs);
  const ci    = parseInt(td.dataset.col);
  if (!_csv || absRi >= _csv.rows.length) return;

  const ov          = _overlayData || { cells: new Map(), excluded: new Map() };
  const raw         = _csv.rows[absRi]?.[ci] ?? '';
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
    const newVal = inp.value;
    if (newVal === effectiveVal) { _renderTable(); return; }
    // Actualizar csv local (feedback inmediato)
    _pushHistory();
    _csv = { ..._csv, rows: _csv.rows.map((r, ri) =>
      ri === absRi ? r.map((v, i) => i === ci ? newVal : v) : r
    )};
    _editedCells = new Set([..._editedCells, `${absRi}:${ci}`]);
    // Delegar a main window: actualiza estado + invalida overlay
    sendOp({ type: 'edit_cell', rowIdx: absRi, colIdx: ci, value: newVal, effectiveOld: effectiveVal });
    _renderTable();
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

function _moveCellFocus(absRi, ci, dir) {
  if (!_csv) return;
  const newCi = ci + dir;
  if (newCi < 0 || newCi >= _csv.headers.length) return;
  const next = document.querySelector(`#editor-tbl td[data-rowabs="${absRi}"][data-col="${newCi}"]`);
  if (next) _startCellEdit(next);
}

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

function _pRemovePos() {
  if (_selCols.size === 0) return _warn('editor.delete.none', 'var(--red)');
  return `
    <div style="display:flex;gap:3px;flex-wrap:wrap">
      <button class="fb on" data-rptab="from_to"      style="font-size:10px">${esc(t('editor.rempos.from_to'))}</button>
      <button class="fb"    data-rptab="first_last"   style="font-size:10px">${esc(t('editor.rempos.first_last'))}</button>
      <button class="fb"    data-rptab="before_after" style="font-size:10px">${esc(t('editor.rempos.before_after'))}</button>
    </div>
    <div id="ep-rp-from_to" style="display:flex;align-items:center;gap:8px;justify-content:flex-end">
      <label class="editor-panel-label">${esc(t('editor.rempos.from'))}</label>
      ${_numSpin('ep-rp-from', 1, 9999, 1)}
      <label class="editor-panel-label" style="margin-left:6px">${esc(t('editor.rempos.to'))}</label>
      ${_numSpin('ep-rp-to', 1, 9999, 1)}
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
        <input type="checkbox" id="ep-rp-mc" style="accent-color:var(--accent)">${esc(t('editor.rempos.match_case'))}</label>
    </div>
    <div class="editor-panel-row">
      <div class="editor-panel-label">${esc(t('editor.format.preview'))}</div>
      <div class="editor-split-prev" id="ep-rp-prev" style="min-height:20px"></div>
    </div>
    <div class="ep-btn-wrap"><button class="btn btn-xs btn-p" id="ep-rp-apply">${esc(t('editor.rempos.apply'))}</button></div>`;
}

function _pCase() {
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
      <input type="radio" name="ep-case-type" value="${id}" ${i === 0 ? 'checked' : ''}>
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

function _pAddText() {
  if (_selCols.size === 0) return _warn('editor.delete.none', 'var(--red)');
  return `
    <input class="editor-panel-input" id="ep-add-text" placeholder="${esc(t('editor.add.text_ph'))}" autocomplete="off">
    <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">
      <button class="fb on" data-addpos="start">${esc(t('editor.add.start'))}</button>
      <button class="fb"    data-addpos="end">${esc(t('editor.add.end'))}</button>
      <button class="fb"    data-addpos="between">${esc(t('editor.add.between'))}</button>
      ${_numSpin('ep-add-between-n', 1, 99, 2, 'display:none;margin-left:auto')}
    </div>
    <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--t1);cursor:pointer">
      <input type="checkbox" id="ep-add-skip" style="accent-color:var(--accent)" checked>${esc(t('editor.add.skip_empty'))}</label>
    <div class="editor-panel-row">
      <div class="editor-panel-label">${esc(t('editor.format.preview'))}</div>
      <div class="editor-split-prev" id="ep-add-prev" style="min-height:20px"></div>
    </div>
    <div class="ep-btn-wrap"><button class="btn btn-xs btn-p" id="ep-add-apply">${esc(t('editor.add.apply'))}</button></div>`;
}

function _pReplace() {
  if (_selCols.size === 0) return _warn('editor.delete.none', 'var(--red)');
  return `
    <div id="ep-repl-pairs">
      <div class="editor-panel-row" style="gap:4px">
        <input class="editor-panel-input ep-rf" placeholder="${esc(t('editor.replace.find_ph'))}" autocomplete="off" style="text-align:right">
        <input class="editor-panel-input ep-rr" placeholder="${esc(t('editor.replace.replace_ph'))}" autocomplete="off" style="text-align:right">
      </div>
    </div>
    <div class="editor-panel-row">
      <div class="editor-panel-label">${esc(t('editor.format.preview'))}</div>
      <div class="editor-split-prev" id="ep-repl-prev" style="min-height:20px"></div>
    </div>
    <div class="ep-btn-wrap"><button class="btn btn-xs btn-p" id="ep-repl-apply">${esc(t('editor.replace.apply'))}</button></div>`;
}

// ── Panel wiring ──────────────────────────────────────────────

function _wirePanelEvents(id) {
  switch (id) {
    case 'split':      _wSplit();     break;
    case 'merge':      _wMerge();     break;
    case 'delete':     _wDelete();    break;
    case 'add_col':    _wAddCol();    break;
    case 'reorder':    _wReorder();   break;
    case 'rename':     _wRename();    break;
    case 'format':     _wFormat();    break;
    case 'spaces':     _wSpaces();    break;
    case 'remove_pos': _wRemovePos(); break;
    case 'case':       _wCase();      break;
    case 'add_text':   _wAddText();   break;
    case 'replace':    _wReplace();   break;
  }
  _wireNumSpins();
}

function _updateMergePreview() {
  const prevEl = document.getElementById('ep-merge-preview');
  if (!prevEl || !_csv) return;
  const idxs      = [..._selCols].sort((a, b) => a - b);
  const sep       = document.getElementById('ep-merge-sep')?.value ?? ', ';
  const skipEmpty = document.getElementById('ep-merge-skip')?.checked ?? true;
  const rows = mergePreview(_csv, idxs, sep, skipEmpty, 3);
  prevEl.innerHTML = rows.map(({ result }) =>
    `<div class="editor-split-row"><span class="editor-split-part ep-new">${esc(result) || '&nbsp;'}</span></div>`
  ).join('');
}

function _wMerge() {
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
    if (!_csv || _selCols.size < 2) return;
    const sep          = document.getElementById('ep-merge-sep')?.value ?? ', ';
    const skipEmpty    = document.getElementById('ep-merge-skip')?.checked ?? true;
    const deleteSrc    = document.getElementById('ep-merge-del-src')?.checked ?? false;
    const customHeader = document.getElementById('ep-merge-title')?.value.trim() || null;
    const idxs         = [..._selCols].sort((a, b) => a - b);
    _saveLastMergeSep(sep);
    _pushHistory();
    _csv = mergeColumns(_csv, idxs, sep, skipEmpty, deleteSrc, customHeader);
    sendOp({ type: 'set_csv', csv: _csv });
    _selCols = new Set();
    _renderTable(); _renderPagination(); _renderSidebar();
    toast(t('toast.editor_merged'));
  });

  _updateMergePreview();
}

function _getSplitDelim() {
  const type = document.querySelector('input[name="ep-split-type"]:checked')?.value;
  if (!type || type !== 'custom') return SPLIT_DELIM_MAP[type] ?? ' ';
  return document.getElementById('ep-split-custom')?.value ?? '';
}

function _updateSplitPreview() {
  const prevEl = document.getElementById('ep-split-preview');
  if (!prevEl) return;
  const colIdx = [..._selCols][0];
  const delim  = _getSplitDelim();
  if (!delim || !_csv) { prevEl.innerHTML = ''; return; }
  const rows = splitPreview(_csv, colIdx, delim, 3);
  prevEl.innerHTML = rows.map(parts =>
    `<div class="editor-split-row">${parts.map((p, i) =>
      `<span class="editor-split-part ${i === 0 ? 'ep0' : 'ep-new'}">${esc(p) || '&nbsp;'}</span>`
    ).join('')}</div>`).join('');
}

function _wSplit() {
  const colIdx  = [..._selCols][0];
  const cusWrap = document.getElementById('ep-split-custom-wrap');

  document.querySelectorAll('input[name="ep-split-type"]').forEach(r => {
    r.addEventListener('change', () => {
      if (cusWrap) cusWrap.style.display = r.value === 'custom' ? 'flex' : 'none';
      _updateSplitPreview();
    });
  });

  const cusInp = document.getElementById('ep-split-custom');
  cusInp?.addEventListener('input', _updateSplitPreview);
  cusInp?.addEventListener('blur', () => {
    const val = cusInp.value.trim();
    if (!val) return;
    const arr = _loadSplitCustom();
    if (!arr.includes(val)) { arr.unshift(val); if (arr.length > 3) arr.length = 3; _saveSplitCustom(arr); _renderToolPanel(); }
  });

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

  document.getElementById('ep-split-apply')?.addEventListener('click', () => {
    if (!_csv) return;
    const delim = _getSplitDelim();
    if (!delim) return;
    const { csv: newCsv, newColCount } = splitColumn(_csv, colIdx, delim);
    if (newColCount === 0) return;
    const origName   = _csv.headers[colIdx] || `Col${colIdx + 1}`;
    const addedNames = Array.from({ length: newColCount }, (_, i) => `${origName}_${i + 2}`);
    _pushHistory();
    _csv = newCsv;
    addedNames.forEach(n => _addedCols.add(n));
    sendOp({ type: 'split', colIdx, delimiter: delim, addedNames });
    _selCols = new Set();
    _renderTable(); _renderPagination(); _renderSidebar();
    toast(t('toast.editor_split_ok', newColCount));
  });

  _updateSplitPreview();
}

function _wDelete() {
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
    if (!_csv || !_pendingDelete.size) return;
    const sortedIdxs = [..._pendingDelete].sort((a, b) => a - b);
    const names = sortedIdxs.map(i => _csv.headers[i]).filter(Boolean);
    // Construir displayCols con fantasmas en su posición original
    const base = _displayCols || _csv.headers.map(name => ({ type: 'real', name }));
    const newDisplay = [...base];
    let realCount = 0, dPtr = 0;
    for (let i = 0; i < newDisplay.length; i++) {
      if (newDisplay[i].type === 'ghost') continue;
      if (dPtr < sortedIdxs.length && realCount === sortedIdxs[dPtr]) {
        newDisplay[i] = { type: 'ghost', name: newDisplay[i].name, values: _csv.rows.map(r => r[sortedIdxs[dPtr]] ?? '') };
        dPtr++;
      }
      realCount++;
    }
    _pushHistory();
    _csv = deleteColumns(_csv, sortedIdxs);
    _displayCols = newDisplay;
    names.forEach(n => _deletedCols.add(n));
    sendOp({ type: 'delete', colIdxs: sortedIdxs, deletedNames: names });
    _selCols = new Set();
    _pendingDelete = new Set();
    _renderTable(); _renderPagination(); _renderSidebar();
    toast(t('toast.editor_deleted', idxs.length));
  });
}

function _wReorder() {
  if (!_csv) return;
  if (_reorderOrder.length !== _csv.headers.length) _reorderOrder = _csv.headers.map((_, i) => i);

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
    if (!_csv) return;
    _pushHistory();
    _csv = reorderColumns(_csv, _reorderOrder);
    sendOp({ type: 'reorder', newOrder: [..._reorderOrder] });
    _reorderOrder = _csv.headers.map((_, i) => i);
    _selCols = new Set();
    _renderTable(); _renderPagination();
    toast(t('toast.editor_op_ok'));
  });
}

function _wRename() {
  document.getElementById('ep-rename-apply')?.addEventListener('click', () => {
    if (!_csv) return;
    const ci   = [..._selCols][0];
    const name = document.getElementById('ep-rename-input')?.value.trim();
    if (!name) return;
    _pushHistory();
    _csv = renameColumns(_csv, { [ci]: name });
    sendOp({ type: 'rename', renames: { [ci]: name } });
    _renderTable(); _renderSidebar();
    toast(t('toast.editor_op_ok'));
  });
}

function _colSamples() {
  const ci = [..._selCols][0];
  if (!_csv || ci == null) return [];
  return _csv.rows.map(r => (r[ci] ?? '').trim()).filter(Boolean).slice(0, 3);
}

function _previewHtml(samples, fn) {
  return samples.map(v =>
    `<span style="font-family:var(--mono);font-size:10px;color:var(--warn);display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(fn(v))}</span>`
  ).join('');
}

function _wFormat() {
  const ALL_FMT = ['number', 'currency', 'percent', 'date'];

  const _updateFmtPreview = (type) => {
    const prevEl = document.getElementById(`ep-fmt-${type}-prev`);
    if (!prevEl || !_csv) return;
    const ci  = [..._selCols][0];
    const pat = document.getElementById(`ep-fmt-${type}-pat`)?.value.trim();
    if (!pat) { prevEl.innerHTML = ''; return; }
    const samples = _csv.rows.map(r => (r[ci] ?? '').trim()).filter(Boolean).slice(0, 3);
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
    const defs = FMT_DEFAULTS[type] || [];
    const user = (_prepFormats[type] || []).filter(p => !defs.includes(p));
    const all  = [...defs, ...user];
    if (all.includes(pat)) return;
    if (all.length >= FMT_MAX) return;
    _prepFormats = { ..._prepFormats, [type]: [...user, pat] };
    fetch('/api/prep-formats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(_prepFormats) }).catch(() => {});
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
          _prepFormats = { ..._prepFormats, [tp]: (_prepFormats[tp] || []).filter(p => p !== pat) };
          fetch('/api/prep-formats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(_prepFormats) }).catch(() => {});
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
      if (!_csv) return;
      const ci  = [..._selCols][0];
      const pat = document.getElementById(`ep-fmt-${type}-pat`)?.value.trim();
      if (!pat) return;
      _pushHistory();
      _csv = formatColumn(_csv, ci, type, pat);
      sendOp({ type: 'format', colIdx: ci, ftype: type, pattern: pat });
      _renderTable();
      toast(t('toast.editor_op_ok'));
    });

    _updateFmtPreview(type);
  });
}

function _wSpaces() {
  const _getCb = mode => document.querySelector(`#editor-tool-panel input[data-mode="${mode}"]`);
  const _getModes = () => [...document.querySelectorAll('#editor-tool-panel input[data-mode]:checked')].map(cb => cb.dataset.mode);

  const _applyExclusion = (changedMode, isChecked) => {
    if (!isChecked) return;
    if (changedMode === 'all') {
      ['leading', 'between'].forEach(m => { const cb = _getCb(m); if (cb) cb.checked = false; });
    } else if (changedMode === 'leading' || changedMode === 'between') {
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
    if (!_csv) return;
    const modes = _getModes();
    if (!modes.length) return;
    _pushHistory();
    const colIdxs = [..._selCols];
    let newCsv = _csv;
    for (const ci of colIdxs) newCsv = applySpaces(newCsv, ci, modes);
    _csv = newCsv;
    sendOp({ type: 'spaces', colIdxs, modes });
    _renderTable();
    toast(t('toast.editor_op_ok'));
  });
}

function _wRemovePos() {
  let rpMode = 'from_to', rpSide = 'first', rpSide2 = 'before';

  const _getRpOpts = () => {
    if (rpMode === 'from_to')    return { from: parseInt(document.getElementById('ep-rp-from')?.value||'1'), to: parseInt(document.getElementById('ep-rp-to')?.value||'1') };
    if (rpMode === 'first_last') return { side: rpSide, n: parseInt(document.getElementById('ep-rp-n')?.value||'1') };
    return { side: rpSide2, text: document.getElementById('ep-rp-text')?.value||'', matchCase: document.getElementById('ep-rp-mc')?.checked??false };
  };
  const _updateRpPreview = () => {
    const prevEl = document.getElementById('ep-rp-prev');
    if (!prevEl) return;
    const samples = _colSamples();
    if (!samples.length) { prevEl.innerHTML = ''; return; }
    prevEl.innerHTML = _previewHtml(samples, v => removeByPosValue(v, rpMode, _getRpOpts()));
  };

  document.querySelectorAll('[data-rptab]').forEach(btn => {
    btn.addEventListener('click', () => {
      rpMode = btn.dataset.rptab;
      document.querySelectorAll('[data-rptab]').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      ['from_to','first_last','before_after'].forEach(id => {
        const el = document.getElementById(`ep-rp-${id}`);
        if (el) el.style.display = id === rpMode ? 'flex' : 'none';
      });
      _updateRpPreview();
    });
  });

  document.querySelectorAll('[data-rpside]').forEach(btn => {
    btn.addEventListener('click', () => { rpSide = btn.dataset.rpside; document.querySelectorAll('[data-rpside]').forEach(b => b.classList.remove('on')); btn.classList.add('on'); _updateRpPreview(); });
  });
  document.querySelectorAll('[data-rpside2]').forEach(btn => {
    btn.addEventListener('click', () => { rpSide2 = btn.dataset.rpside2; document.querySelectorAll('[data-rpside2]').forEach(b => b.classList.remove('on')); btn.classList.add('on'); _updateRpPreview(); });
  });

  ['ep-rp-from','ep-rp-to','ep-rp-n','ep-rp-text'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', _updateRpPreview);
  });
  document.getElementById('ep-rp-mc')?.addEventListener('change', _updateRpPreview);
  _updateRpPreview();

  document.getElementById('ep-rp-apply')?.addEventListener('click', () => {
    if (!_csv) return;
    const opts = _getRpOpts();
    _pushHistory();
    const colIdxs = [..._selCols];
    let newCsv = _csv;
    for (const ci of colIdxs) newCsv = applyRemoveByPos(newCsv, ci, rpMode, opts);
    _csv = newCsv;
    sendOp({ type: 'remove_pos', colIdxs, mode: rpMode, opts });
    _renderTable();
    toast(t('toast.editor_op_ok'));
  });
}

function _wCase() {
  const _updateCasePreview = () => {
    const prevEl = document.getElementById('ep-case-prev');
    if (!prevEl || !_csv) { if (prevEl) prevEl.innerHTML = ''; return; }
    const ci = [..._selCols][0];
    const mode = document.querySelector('input[name="ep-case-type"]:checked')?.value || 'sentence';
    const samples = _colSamples();
    if (!samples.length) { prevEl.innerHTML = ''; return; }
    prevEl.innerHTML = _previewHtml(samples, v => applyCaseValue(v, mode));
  };

  document.querySelectorAll('input[name="ep-case-type"]').forEach(r => {
    r.addEventListener('change', _updateCasePreview);
  });
  _updateCasePreview();

  document.getElementById('ep-case-apply')?.addEventListener('click', () => {
    if (!_csv) return;
    const caseMode = document.querySelector('input[name="ep-case-type"]:checked')?.value || 'sentence';
    _pushHistory();
    const colIdxs = [..._selCols];
    let newCsv = _csv;
    for (const ci of colIdxs) newCsv = applyCase(newCsv, ci, caseMode);
    _csv = newCsv;
    sendOp({ type: 'case', colIdxs, mode: caseMode });
    _renderTable();
    toast(t('toast.editor_op_ok'));
  });
}

function _wAddText() {
  const _getPos = () => document.querySelector('[data-addpos].on')?.dataset.addpos || 'start';
  const _getN   = () => parseInt(document.getElementById('ep-add-between-n')?.value || '2');
  const nWrap   = document.getElementById('ep-add-between-n')?.closest('.ep-num-spin');
  const _syncN  = (pos) => { if (nWrap) nWrap.style.display = pos === 'between' ? 'flex' : 'none'; };
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

  document.getElementById('ep-add-apply')?.addEventListener('click', () => {
    if (!_csv) return;
    const text = document.getElementById('ep-add-text')?.value ?? '';
    if (!text) return;
    const pos  = _getPos();
    const skip = document.getElementById('ep-add-skip')?.checked ?? true;
    const n    = _getN();
    _pushHistory();
    const colIdxs = [..._selCols];
    let newCsv = _csv;
    for (const ci of colIdxs) newCsv = applyAddText(newCsv, ci, text, pos, skip, n);
    _csv = newCsv;
    sendOp({ type: 'add_text', colIdxs, text, position: pos, skipEmpty: skip, betweenN: n });
    _renderTable();
    toast(t('toast.editor_op_ok'));
  });
}

function _wReplace() {
  const pairsEl = document.getElementById('ep-repl-pairs');
  const _getPairs = () => {
    const fs = [...document.querySelectorAll('#ep-repl-pairs .ep-rf')].map(i => i.value);
    const rs = [...document.querySelectorAll('#ep-repl-pairs .ep-rr')].map(i => i.value);
    return fs.map((f, i) => ({ find: f, replace: rs[i] ?? '' })).filter(p => p.find);
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

  document.getElementById('ep-repl-apply')?.addEventListener('click', () => {
    if (!_csv) return;
    const pairs = _getPairs();
    if (!pairs.length) return;
    _pushHistory();
    const colIdxs = [..._selCols];
    let newCsv = _csv;
    for (const ci of colIdxs) newCsv = applyReplace(newCsv, ci, pairs);
    _csv = newCsv;
    sendOp({ type: 'replace', colIdxs, pairs });
    _renderTable();
    toast(t('toast.editor_op_ok'));
  });
}

// ── Undo ──────────────────────────────────────────────────────

function _pushHistory() {
  const snap = {
    csv: { headers: [..._csv.headers], rows: _csv.rows.map(r => [...r]), sep: _csv.sep },
    deletedCols:  new Set(_deletedCols),
    displayCols:  _displayCols ? [..._displayCols] : null,
    addedCols:    new Set(_addedCols),
  };
  _prepHistory.push(snap);
  if (_prepHistory.length > 30) _prepHistory.shift();
  _redoHistory = [];
}

function _undo() {
  if (!_prepHistory.length) { toast(t('toast.editor_undo_empty')); return; }
  const cur = {
    csv: { headers: [..._csv.headers], rows: _csv.rows.map(r => [...r]), sep: _csv.sep },
    deletedCols:  new Set(_deletedCols),
    displayCols:  _displayCols ? [..._displayCols] : null,
    addedCols:    new Set(_addedCols),
  };
  _redoHistory.push(cur);
  if (_redoHistory.length > 30) _redoHistory.shift();
  const prev = _prepHistory.pop();
  _csv         = prev.csv;
  _deletedCols = prev.deletedCols;
  _displayCols = prev.displayCols || null;
  _addedCols   = prev.addedCols;
  sendOp({ type: 'undo' });
  _selCols = new Set();
  _renderTable(); _renderPagination(); _renderSidebar();
  toast(t('toast.editor_undo_ok'));
}

function _redo() {
  if (!_redoHistory.length) { toast(t('toast.editor_redo_empty')); return; }
  const cur = {
    csv: { headers: [..._csv.headers], rows: _csv.rows.map(r => [...r]), sep: _csv.sep },
    deletedCols:  new Set(_deletedCols),
    displayCols:  _displayCols ? [..._displayCols] : null,
    addedCols:    new Set(_addedCols),
  };
  _prepHistory.push(cur);
  if (_prepHistory.length > 30) _prepHistory.shift();
  const next = _redoHistory.pop();
  _csv         = next.csv;
  _deletedCols = next.deletedCols;
  _displayCols = next.displayCols || null;
  _addedCols   = next.addedCols;
  sendOp({ type: 'set_csv', csv: next.csv });
  _selCols = new Set();
  _renderTable(); _renderPagination(); _renderSidebar();
  toast(t('toast.editor_redo_ok'));
}

async function _saveAs() {
  if (!_csv) return;
  const text = toCSV(_csv.headers, _csv.rows, _csv.sep || ',');
  const now  = new Date();
  const pad  = n => String(n).padStart(2, '0');
  const ts   = `_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;
  const base = document.getElementById('editor-filename')?.textContent?.trim() || 'export.csv';
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
