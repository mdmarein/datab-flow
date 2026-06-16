/**
 * steps.js — Render de cada paso del wizard + resumen final
 * dataB Flow · Cleaning | Transformation | Governance · © 2026 mdmarein · GNU AGPLv3
 */

import { getState, setState } from '../modules/state.js';
import { $, esc, show, hide, pct, truncate, syncCheckAll, providerBadge, toast } from '../modules/utils.js';
import { buildExcluded, findDuplicates } from '../modules/duplicates.js';
import { FIX_TYPES, FLOW_STEPS } from '../modules/config.js';
import { t } from '../modules/i18n.js';

const KW_COLORS = ['#EA4335', '#F87171', '#F59E0B', '#C084FC', '#60A5FA'];
// Colores para chips de campos fuente en homologación (border, text)
const _CHIP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><rect x="7" y="7" width="10" height="10" rx="1.5"/><rect x="9.5" y="9.5" width="5" height="5" rx="0.5"/><line x1="7" y1="9.5" x2="4" y2="9.5"/><line x1="7" y1="12" x2="4" y2="12"/><line x1="7" y1="14.5" x2="4" y2="14.5"/><line x1="17" y1="9.5" x2="20" y2="9.5"/><line x1="17" y1="12" x2="20" y2="12"/><line x1="17" y1="14.5" x2="20" y2="14.5"/><line x1="9.5" y1="7" x2="9.5" y2="4"/><line x1="12" y1="7" x2="12" y2="4"/><line x1="14.5" y1="7" x2="14.5" y2="4"/><line x1="9.5" y1="17" x2="9.5" y2="20"/><line x1="12" y1="17" x2="12" y2="20"/><line x1="14.5" y1="17" x2="14.5" y2="20"/></svg>`;

const FIELD_COLORS = [
  ['#60A5FA', '#60A5FA'], // blue
  ['#34D399', '#34D399'], // green
  ['#F59E0B', '#F59E0B'], // amber
  ['#C084FC', '#C084FC'], // purple
  ['#F87171', '#F87171'], // red
  ['#22D3EE', '#22D3EE'], // cyan
  ['#FB923C', '#FB923C'], // orange
  ['#A3E635', '#A3E635'], // lime
];
let _kwPatternColors = {};

function _kwHighlight(val, patternColors) {
  let best = null;
  for (const [p, color] of Object.entries(patternColors)) {
    const idx = val.toLowerCase().indexOf(p);
    if (idx !== -1 && (!best || idx < best.idx)) best = { idx, len: p.length, color };
  }
  if (!best) return esc(val);
  const { idx, len, color } = best;
  return esc(val.slice(0, idx))
    + `<span style="color:${color};font-weight:600">${esc(val.slice(idx, idx + len))}</span>`
    + esc(val.slice(idx + len));
}

// ════════════════════════════════════════════════════════════
//  PASO 3 — VALIDACIÓN
// ════════════════════════════════════════════════════════════
const V_PAGE_SIZE = 200;
let vFilter = 'all';
let _vPage = 0;

export function renderStep3(valItems, { onValidationDecision } = {}) {
  vFilter = 'all'; _vPage = 0;
  document.querySelectorAll('[data-vf]').forEach(b => b.classList.toggle('on', b.dataset.vf === 'all'));
  _updateSB3(valItems);
  _renderValTable(valItems, onValidationDecision);
  _setupValToolbar(valItems, onValidationDecision);
}

function _updateSB3(items) {
  const autofix    = items.filter(v => v.changed).length;
  const invalidos  = items.filter(v => v.issues.some(i => i.type === FIX_TYPES.INVALID_CHAR)).length;
  const translits  = items.filter(v => v.issues.some(i => i.type === FIX_TYPES.TRANSLIT)).length;
  const mayusculas = items.filter(v => v.issues.some(i => i.type === FIX_TYPES.LOWERCASE)).length;
  const espacios   = items.filter(v => v.issues.some(i => i.type === FIX_TYPES.SPACES)).length;
  const { csv } = getState();
  const total   = csv.rows.filter(r => r.some(c => (c||'').trim())).length;
  $('sb3').innerHTML = `
    <div class="sum-item"><div class="sum-n dim">${total}</div><div class="sum-l">${t('stat.analyzed')}</div></div>
    <div class="sum-item"><div class="sum-n fmtc">${items.length}</div><div class="sum-l">${t('stat.issues')}</div></div>
    <div class="sum-item"><div class="sum-n" style="color:var(--ad)">${autofix}</div><div class="sum-l">${t('stat.autofixed')}</div></div>
    ${invalidos  > 0 ? `<div class="sum-item"><div class="sum-n" style="color:var(--red)">${invalidos}</div><div class="sum-l">${t('stat.invalid')}</div></div>` : ''}
    ${translits  > 0 ? `<div class="sum-item"><div class="sum-n" style="color:var(--warn)">${translits}</div><div class="sum-l">${t('stat.accents')}</div></div>` : ''}
    ${mayusculas > 0 ? `<div class="sum-item"><div class="sum-n" style="color:var(--fmt)">${mayusculas}</div><div class="sum-l">${t('stat.uppercase')}</div></div>` : ''}
    ${espacios   > 0 ? `<div class="sum-item"><div class="sum-n" style="color:var(--accent)">${espacios}</div><div class="sum-l">${t('stat.spaces')}</div></div>` : ''}`;
}

function _renderValTable(valItems, onValidationDecision) {
  const tbody = $('vbody');
  tbody.innerHTML = '';

  // Construir lista filtrada con índices originales en valItems (sin indexOf — O(n) total)
  const visPairs = []; // [{ item, ri }]
  for (let ri = 0; ri < valItems.length; ri++) {
    const item = valItems[ri];
    const show = vFilter === 'invalido'  ? item.issues.some(i => i.type === FIX_TYPES.INVALID_CHAR)
               : vFilter === 'translit'  ? item.issues.some(i => i.type === FIX_TYPES.TRANSLIT)
               : vFilter === 'mayus'     ? item.issues.some(i => i.type === FIX_TYPES.LOWERCASE)
               : vFilter === 'espacios'  ? item.issues.some(i => i.type === FIX_TYPES.SPACES)
               : true;
    if (show) visPairs.push({ item, ri });
  }

  if (!visPairs.length) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty"><div class="empty-ico">✓</div><div class="empty-msg">${t('empty.no_format')}</div></div></td></tr>`;
    _syncVCA(valItems); _updateSI3(valItems); _renderVPager(0, 0, valItems, onValidationDecision); return;
  }

  // Paginación
  const totalPages = Math.ceil(visPairs.length / V_PAGE_SIZE);
  _vPage = Math.min(_vPage, totalPages - 1);
  const pageItems = visPairs.slice(_vPage * V_PAGE_SIZE, (_vPage + 1) * V_PAGE_SIZE);

  const _ibClass = t => t === FIX_TYPES.INVALID_CHAR || t === FIX_TYPES.NO_AT || t === FIX_TYPES.MULTI_AT || t === FIX_TYPES.LENGTH ? 'ib-err'
                      : t === FIX_TYPES.TRANSLIT ? 'ib-warn'
                      : t === FIX_TYPES.LOWERCASE ? 'ib-fmt'
                      : 'ib-acc';

  const frag = document.createDocumentFragment();
  for (const { item, ri } of pageItems) {
    const tr  = document.createElement('tr');
    tr.className = item.checked ? 'row-on' : '';
    const badges = item.issues.map(i => `<span class="${_ibClass(i.type)}">${esc(i.msg)}</span>`).join('');
    const isMod  = item.manualValue && item.manualValue !== item.autoFixed;
    const disp   = item.manualValue || item.autoFixed;
    const changed = disp !== item.original;

    tr.innerHTML = `
      <td><div class="cbc"><input type="checkbox" data-vi="${ri}" ${item.checked ? 'checked' : ''}></div></td>
      <td><span class="mono t-dim">${item.rowIdx + 2}</span></td>
      <td><span class="t-orig">${esc(item.original)}</span></td>
      <td style="max-width:280px">${badges}</td>
      <td><div class="ewrap">
        ${changed ? `<span class="t-bad">${esc(item.original)}</span><span class="arr">→</span>` : ''}
        <input class="ei${isMod ? ' mod' : ''}" data-vi="${ri}" value="${esc(disp)}" placeholder="${t('val.no_change_ph')}">
        ${isMod ? `<button class="restore" data-vi="${ri}" title="${t('misc.restore')}">↺</button>` : ''}
      </div></td>`;

    tr.querySelector('input[type=checkbox]').addEventListener('change', e => {
      const i = parseInt(e.target.dataset.vi);
      valItems[i].checked = e.target.checked;
      tr.className = e.target.checked ? 'row-on' : '';
      _syncVCA(valItems); _updateSI3(valItems);
      if (onValidationDecision) {
        valItems[i].issues.forEach(issue => {
          if (issue.applied) onValidationDecision(issue.type, e.target.checked);
        });
      }
    });
    tr.querySelector('.ei').addEventListener('input', e => {
      const i = parseInt(e.target.dataset.vi);
      const v = e.target.value.trim();
      valItems[i].manualValue = v !== valItems[i].autoFixed ? v : null;
      e.target.classList.toggle('mod', !!valItems[i].manualValue);
    });
    const rb = tr.querySelector('.restore');
    if (rb) rb.addEventListener('click', () => {
      valItems[parseInt(rb.dataset.vi)].manualValue = null;
      _renderValTable(valItems, onValidationDecision);
    });
    frag.appendChild(tr);
  }
  tbody.appendChild(frag);
  _syncVCA(valItems); _updateSI3(valItems);
  _renderVPager(visPairs.length, totalPages, valItems, onValidationDecision);
}

function _renderVPager(total, totalPages, valItems, onValidationDecision) {
  let pager = $('v-pager');
  if (!pager) {
    pager = document.createElement('div');
    pager.id = 'v-pager';
    pager.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 0;font-size:13px;color:var(--t2)';
    $('vbody')?.closest('table')?.after(pager);
  }
  if (totalPages <= 1) { pager.innerHTML = ''; return; }
  pager.innerHTML = `
    <button id="vp-prev" class="btn-sm" ${_vPage === 0 ? 'disabled' : ''}>←</button>
    <span>${_vPage + 1} / ${totalPages} &nbsp;<span style="color:var(--t3)">(${total} registros)</span></span>
    <button id="vp-next" class="btn-sm" ${_vPage >= totalPages - 1 ? 'disabled' : ''}>→</button>`;
  pager.querySelector('#vp-prev')?.addEventListener('click', () => { _vPage--; _renderValTable(valItems, onValidationDecision); });
  pager.querySelector('#vp-next')?.addEventListener('click', () => { _vPage++; _renderValTable(valItems, onValidationDecision); });
}

function _syncVCA(items) { syncCheckAll('vca', items); }
function _updateSI3(items) {
  const sel = items.filter(v => v.checked).length;
  $('si3').innerHTML = t('val.corrections_sel', sel, items.length);
}

function _setupValToolbar(valItems, onValidationDecision) {
  const all = $('v-all'), none = $('v-none'), ca = $('vca');
  all?.addEventListener('click', () => {
    valItems.forEach(v => v.checked = true);
    all.classList.add('on'); none.classList.remove('on');
    _renderValTable(valItems, onValidationDecision);
  });
  none?.addEventListener('click', () => {
    valItems.forEach(v => v.checked = false);
    none.classList.add('on'); all.classList.remove('on');
    _renderValTable(valItems, onValidationDecision);
  });
  ca?.addEventListener('change', e => {
    valItems.forEach(v => v.checked = e.target.checked);
    if (e.target.checked) { all?.classList.add('on'); none?.classList.remove('on'); }
    else { none?.classList.add('on'); all?.classList.remove('on'); }
    _renderValTable(valItems, onValidationDecision);
  });
  document.querySelectorAll('[data-vf]').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('[data-vf]').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); vFilter = b.dataset.vf; _vPage = 0;
    _renderValTable(valItems, onValidationDecision);
  }));
  // Actualizar contadores en los botones de filtro
  const vfCounts = {
    all:      valItems.length,
    invalido: valItems.filter(v => v.issues.some(i => i.type === FIX_TYPES.INVALID_CHAR)).length,
    translit: valItems.filter(v => v.issues.some(i => i.type === FIX_TYPES.TRANSLIT)).length,
    mayus:    valItems.filter(v => v.issues.some(i => i.type === FIX_TYPES.LOWERCASE)).length,
    espacios: valItems.filter(v => v.issues.some(i => i.type === FIX_TYPES.SPACES)).length,
  };
  document.querySelectorAll('[data-vf]').forEach(b => {
    b.querySelector('.fb-cnt')?.remove();
    b.insertAdjacentHTML('beforeend', `<span class="fb-cnt">${vfCounts[b.dataset.vf] ?? 0}</span>`);
  });
}

// ════════════════════════════════════════════════════════════
//  PASO 4 — DOMINIOS
// ════════════════════════════════════════════════════════════
const D_PAGE_SIZE = 200;
let dFilter = 'all';
let _dPage = 0;

export function renderStep4(domItems, { onDomainDecision } = {}) {
  _dPage = 0;
  const { csv } = getState();
  const total   = csv.rows.filter(r => r.some(c => (c||'').trim())).length;
  const byProv  = {};
  domItems.forEach(d => { byProv[d.provider] = (byProv[d.provider] || 0) + 1; });
  $('sb4').innerHTML = `
    <div class="sum-item"><div class="sum-n dim">${total}</div><div class="sum-l">${t('stat.analyzed')}</div></div>
    <div class="sum-item"><div class="sum-n redc">${domItems.length}</div><div class="sum-l">${t('stat.domain_errors')}</div></div>
    ${Object.entries(byProv).filter(([,v]) => v > 0).map(([k,v]) =>
      `<div class="sum-item"><div class="sum-n" style="color:var(--${k === 'suffix' ? 'warn' : 'accent'})">${v}</div><div class="sum-l">${k}</div></div>`
    ).join('')}`;
  dFilter = 'all';
  // Generar botones de filtro dinámicamente — solo proveedores con >0 errores
  const domPf = $('dom-pf');
  if (domPf) {
    const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
    domPf.innerHTML = Object.entries(byProv)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `<button class="fb" data-df="${esc(k)}">${esc(cap(k))}<span class="fb-cnt">${v}</span></button>`)
      .join('');
  }
  // Actualizar "Todos" con count total y marcarlo activo
  const allDfBtn = document.querySelector('[data-df="all"]');
  if (allDfBtn) {
    allDfBtn.querySelector('.fb-cnt')?.remove();
    allDfBtn.insertAdjacentHTML('beforeend', `<span class="fb-cnt">${domItems.length}</span>`);
    allDfBtn.classList.add('on');
  }
  _renderDomTable(domItems, onDomainDecision);
  _setupDomToolbar(domItems, onDomainDecision);
}

function _renderDomTable(domItems, onDomainDecision) {
  const tbody = $('dbody');
  tbody.innerHTML = '';

  // Construir lista filtrada con índices originales en domItems (sin indexOf — O(n) total)
  const visPairs = [];
  for (let ri = 0; ri < domItems.length; ri++) {
    if (dFilter === 'all' || domItems[ri].provider === dFilter) visPairs.push({ item: domItems[ri], ri });
  }

  if (!visPairs.length) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty"><div class="empty-ico">✓</div><div class="empty-msg">${dFilter !== 'all' ? t('dom.no_provider_err') : t('empty.no_domain')}</div></div></td></tr>`;
    _syncDCA(domItems); _updateSI4(domItems); _renderDPager(0, 0, domItems, onDomainDecision); return;
  }

  // Paginación
  const totalPages = Math.ceil(visPairs.length / D_PAGE_SIZE);
  _dPage = Math.min(_dPage, totalPages - 1);
  const pageItems = visPairs.slice(_dPage * D_PAGE_SIZE, (_dPage + 1) * D_PAGE_SIZE);

  const frag = document.createDocumentFragment();
  for (const { item, ri } of pageItems) {
    const tr  = document.createElement('tr');
    tr.className = item.checked ? 'row-on' : '';
    const isMod = item.manualValue && item.manualValue !== item.corrected;
    const disp  = item.manualValue || item.corrected;
    const learnedBadge = item.source === 'learned'
      ? `<span class="tag tag-fix" title="Aprendida de sesiones anteriores">🧠</span>`
      : '';

    tr.innerHTML = `
      <td><div class="cbc"><input type="checkbox" data-di="${ri}" ${item.checked ? 'checked' : ''}></div></td>
      <td><span class="mono t-dim">${item.rowIdx + 2}</span></td>
      <td><span class="t-orig">${esc(item.emailIn)}</span></td>
      <td><div class="ewrap">
        <span class="mono t-dim">${esc(item.user)}</span><span class="mono t-dim">@</span><span class="t-bad">${esc(item.originalDomain)}</span>
        <span class="arr">→</span>
        <input class="ei${isMod ? ' mod' : ''}" data-di="${ri}" value="${esc(disp)}">
        ${isMod ? `<button class="restore" data-di="${ri}" title="Restaurar">↺</button>` : ''}
      </div></td>
      <td>${providerBadge(item.provider)} ${learnedBadge}</td>`;

    tr.querySelector('input[type=checkbox]').addEventListener('change', e => {
      const i = parseInt(e.target.dataset.di);
      domItems[i].checked = e.target.checked;
      tr.className = e.target.checked ? 'row-on' : '';
      _syncDCA(domItems); _updateSI4(domItems);
      if (onDomainDecision) onDomainDecision(item.originalDomain, item.correctedDomain, e.target.checked);
    });
    tr.querySelector('.ei').addEventListener('input', e => {
      const i = parseInt(e.target.dataset.di);
      const v = e.target.value.trim();
      domItems[i].manualValue = v !== domItems[i].corrected ? v : null;
      e.target.classList.toggle('mod', !!domItems[i].manualValue);
    });
    const rb = tr.querySelector('.restore');
    if (rb) rb.addEventListener('click', () => { domItems[parseInt(rb.dataset.di)].manualValue = null; _renderDomTable(domItems, onDomainDecision); });
    frag.appendChild(tr);
  }
  tbody.appendChild(frag);
  _syncDCA(domItems); _updateSI4(domItems);
  _renderDPager(visPairs.length, totalPages, domItems, onDomainDecision);
}

function _renderDPager(total, totalPages, domItems, onDomainDecision) {
  let pager = $('d-pager');
  if (!pager) {
    pager = document.createElement('div');
    pager.id = 'd-pager';
    pager.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 0;font-size:13px;color:var(--t2)';
    $('dbody')?.closest('table')?.after(pager);
  }
  if (totalPages <= 1) { pager.innerHTML = ''; return; }
  pager.innerHTML = `
    <button id="dp-prev" class="btn-sm" ${_dPage === 0 ? 'disabled' : ''}>←</button>
    <span>${_dPage + 1} / ${totalPages} &nbsp;<span style="color:var(--t3)">(${total} registros)</span></span>
    <button id="dp-next" class="btn-sm" ${_dPage >= totalPages - 1 ? 'disabled' : ''}>→</button>`;
  pager.querySelector('#dp-prev')?.addEventListener('click', () => { _dPage--; _renderDomTable(domItems, onDomainDecision); });
  pager.querySelector('#dp-next')?.addEventListener('click', () => { _dPage++; _renderDomTable(domItems, onDomainDecision); });
}

function _syncDCA(items) { syncCheckAll('dca', items); }
function _updateSI4(items) {
  const sel = items.filter(d => d.checked).length;
  $('si4').innerHTML = t('dom.corrections_sel', sel, items.length);
}
function _setupDomToolbar(domItems, onDomainDecision) {
  const dall = $('d-all'), dnone = $('d-none');
  dall?.addEventListener('click', () => {
    domItems.forEach(d => d.checked = true);
    dall.classList.add('on'); dnone.classList.remove('on');
    _renderDomTable(domItems, onDomainDecision);
  });
  dnone?.addEventListener('click', () => {
    domItems.forEach(d => d.checked = false);
    dnone.classList.add('on'); dall.classList.remove('on');
    _renderDomTable(domItems, onDomainDecision);
  });
  $('dca')?.addEventListener('change', e => {
    domItems.forEach(d => d.checked = e.target.checked);
    if (e.target.checked) { dall?.classList.add('on'); dnone?.classList.remove('on'); }
    else { dnone?.classList.add('on'); dall?.classList.remove('on'); }
    _renderDomTable(domItems, onDomainDecision);
  });
  document.querySelectorAll('[data-df]').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('[data-df]').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); dFilter = b.dataset.df; _dPage = 0;
    _renderDomTable(domItems, onDomainDecision);
  }));
}

// ════════════════════════════════════════════════════════════
//  PASO 5 — DUPLICADOS
// ════════════════════════════════════════════════════════════
export function renderStep5({ csv, colIdx, dupGroups, dupCols, idCols, keepMode = 'none', onColChange, onGroupChange, onKeepFirst, onKeepLast, onKeepComplete, resetExpanded = false }) {
  _updateSB5(csv, dupGroups);
  _renderColChips(csv, colIdx, dupCols, idCols, onColChange);
  _renderDupGroups(dupGroups, csv, colIdx, onGroupChange);
  _updateSI5(csv, dupGroups);
  const btnKf = $('btn-kf'); if (btnKf) btnKf.onclick = onKeepFirst;
  const btnKl = $('btn-kl'); if (btnKl) btnKl.onclick = onKeepLast;
  const btnKc = $('btn-kc'); if (btnKc) btnKc.onclick = onKeepComplete;
  const _km = { first: btnKf, last: btnKl, complete: btnKc };
  [btnKf, btnKl, btnKc].forEach(b => { if (b) { b.classList.remove('btn-oa'); b.classList.add('btn-g'); } });
  const activeBtn = _km[keepMode];
  if (activeBtn) { activeBtn.classList.remove('btn-g'); activeBtn.classList.add('btn-oa'); }
}

function _renderColChips(csv, colIdx, dupCols, idCols, onColChange) {
  const cont = $('col-chips');
  const allOn = csv.headers.every((_, i) => dupCols.has(i));
  const someOn = csv.headers.some((_, i) => dupCols.has(i));

  const chips = csv.headers.map((h, i) => {
    const on      = dupCols.has(i);
    const isEmail = i === colIdx;
    const badge   = isEmail ? ` <em style="font-size:9px;color:var(--accent)">(email)</em>` : '';
    return `<span class="col-chip"><label>
      <input type="checkbox" data-ci="${i}" ${on ? 'checked' : ''}>
      <span>${esc(h.trim() || `Col ${i+1}`)}${badge}</span>
    </label></span>`;
  }).join('');

  cont.innerHTML = `
    <span class="col-chip" style="margin-right:6px"><label style="border-color:var(--bhi)">
      <input type="checkbox" id="cc-all" ${allOn ? 'checked' : ''}>
      <span style="color:var(--t1);font-weight:500">${t('filter.all')}</span>
    </label></span>
    <span style="color:var(--border);font-size:14px;line-height:1;margin-right:6px">|</span>
    ${chips}`;

  const cbAll = $('cc-all');
  cbAll.indeterminate = !allOn && someOn;
  cbAll.addEventListener('change', e => {
    if (e.target.checked) csv.headers.forEach((_, i) => dupCols.add(i));
    else { dupCols.clear(); dupCols.add(colIdx); }
    onColChange();
  });

  cont.querySelectorAll('input[data-ci]').forEach(cb => {
    cb.addEventListener('change', e => {
      const ci = parseInt(e.target.dataset.ci);
      if (e.target.checked) dupCols.add(ci);
      else {
        if (ci === colIdx) { e.target.checked = true; return; }
        dupCols.delete(ci);
      }
      onColChange();
    });
  });
}

function _renderDupGroups(dupGroups, csv, colIdx, onGroupChange) {
  const cont = $('dgrps');
  const savedScroll = cont ? cont.scrollTop : 0;
  const { dupExcluded } = getState();

  $('dup-sum').innerHTML = dupGroups.length
    ? t('dup.groups_summary', dupGroups.length, dupExcluded.size)
    : t('dup.no_dups');
  _updateSB5(csv, dupGroups);

  if (!dupGroups.length) {
    cont.innerHTML = `<div class="empty"><div class="empty-ico">✓</div><div class="empty-msg">${t('empty.no_dups')}</div></div>`;
    return;
  }

  const { _idCols } = getState();
  const ctxCols = csv.headers.map((h, i) => ({ h: h.trim(), i }))
    .filter(({ h, i }) => i !== colIdx && !_idCols.has(i) && h).slice(0, 5);

  const _rowFields = rowIdx => {
    const rowData = csv.rows[rowIdx] || [];
    return ctxCols.map(({ h, i }) => {
      const v = (rowData[i] || '').trim();
      return v ? `<span class="dfield"><span class="dfield-k">${esc(h)}:</span><span class="dfield-v">${esc(truncate(v, 24))}</span></span>` : '';
    }).filter(Boolean).join('');
  };

  cont.innerHTML = '';
  dupGroups.forEach((grp, gi) => {
    const keeping = grp.keepRowIdxs.size;
    const excl    = grp.rows.length - keeping;

    // ── Cabecera de grupo ──
    const gh = document.createElement('div');
    gh.className = 'dlst-gh';
    gh.innerHTML = `
      <span class="dlst-gh-ico">◈</span>
      <span class="dlst-gh-email">${esc(grp.email)}</span>
      <span class="dlst-gh-cnt">${t('dup.row_count', grp.rows.length)}</span>
      <span class="dlst-gh-meta">${t('dup.counts_summary', keeping, excl)}</span>`;
    cont.appendChild(gh);

    // ── Filas del grupo ──
    grp.rows.forEach(r => {
      const isKeep = grp.keepRowIdxs.has(r.rowIdx);
      const fields = _rowFields(r.rowIdx);
      const row    = document.createElement('div');
      row.className = `drow ${isKeep ? 'keep' : 'excl'}`;
      row.innerHTML = `
        <div class="cbc" style="min-width:22px;flex-shrink:0">
          <input type="checkbox" data-gi="${gi}" data-ri="${r.rowIdx}" ${isKeep ? 'checked' : ''}
                 title="${isKeep ? t('dup.tooltip_uncheck') : t('dup.tooltip_check')}">
        </div>
        <span class="drow-num">F${r.rowIdx + 2}</span>
        <div class="drow-body">
          <div class="drow-email">${esc(r.original)}${r.finalEmail !== r.original.toLowerCase() ? ` <span style="color:var(--accent);font-size:10px">→ ${esc(r.finalEmail)}</span>` : ''}</div>
          ${fields ? `<div class="drow-fields">${fields}</div>` : ''}
        </div>
        <div class="drow-act"><span class="${isKeep ? 'da-keep' : 'da-excl'}">${isKeep ? t('dup.action_keep') : t('dup.action_excl')}</span></div>`;

      row.querySelector('input[type=checkbox]').addEventListener('change', e => {
        const g  = dupGroups[parseInt(e.target.dataset.gi)];
        const ri = parseInt(e.target.dataset.ri);
        if (e.target.checked) {
          g.keepRowIdxs.add(ri);
        } else {
          if (g.keepRowIdxs.size <= 1) { e.target.checked = true; return; }
          g.keepRowIdxs.delete(ri);
        }
        setState({ dupExcluded: buildExcluded(dupGroups) });
        onGroupChange();
        _renderDupGroups(dupGroups, csv, colIdx, onGroupChange);
        _updateSI5(csv, dupGroups);
      });

      cont.appendChild(row);
    });
  });

  if (cont && savedScroll) cont.scrollTop = savedScroll;
}

function _updateSB5(csv, dupGroups) {
  const { dupExcluded } = getState();
  const total      = csv.rows.filter(r => r.some(c => (c||'').trim())).length;
  const eliminados = dupExcluded.size;
  const unicos     = total - eliminados;
  const agrupadas  = dupGroups.reduce((acc, grp) => acc + grp.rows.length, 0);
  $('sb5').innerHTML = `
    <div class="sum-item"><div class="sum-n dim">${total}</div><div class="sum-l">${t('stat.analyzed')}</div></div>
    <div class="sum-item"><div class="sum-n" style="color:#C084FC">${agrupadas}</div><div class="sum-l">${t('stat.grouped_rows')}</div></div>
    <div class="sum-item"><div class="sum-n" style="color:var(--red)">${eliminados}</div><div class="sum-l">${t('stat.duplicates')}</div></div>
    <div class="sum-item"><div class="sum-n" style="color:var(--accent)">${unicos}</div><div class="sum-l">${t('stat.unique')}</div></div>`;
}

function _updateSI5(csv, dupGroups) {
  const { dupExcluded } = getState();
  const total     = csv.rows.filter(r => r.some(c => (c||'').trim())).length;
  const agrupadas = dupGroups.reduce((acc, grp) => acc + grp.rows.length, 0);
  $('si5').innerHTML = t('dup.rows_csv', total - dupExcluded.size, total, agrupadas);
}

// ════════════════════════════════════════════════════════════
//  PASO 6 — FILAS DE PRUEBA
// ════════════════════════════════════════════════════════════
export function renderTestPatternPanel(patterns, { onAddPattern, onRemovePattern } = {}) {
  const panel = $('test-pattern-panel');
  if (!panel) return;

  const chips = patterns.map((p, i) => {
    const c = KW_COLORS[i % KW_COLORS.length];
    return `<span class="wl-chip cust" style="border-color:${c};color:${c}">${esc(p)}<button class="xd" data-p="${esc(p)}" title="${t('misc.remove')}">✕</button></span>`;
  }).join('');

  panel.innerHTML = `
    <div style="background:var(--s2);border:1px solid var(--border);border-radius:var(--rs);padding:12px 15px;margin-bottom:14px">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--t2);margin-bottom:8px">${t('tp.keywords_title')} <span style="font-size:9px;font-weight:400;text-transform:none;letter-spacing:0">(${t('tp.keywords_hint')})</span></div>
      <div class="wl-list" style="margin-bottom:10px">${chips || `<span style="font-size:11px;color:var(--t2);font-style:italic">${t('tp.no_patterns')}</span>`}</div>
      <div class="radd">
        <input type="text" id="tp-input" placeholder="${t('tp.add_ph')}" style="width:240px">
        <button class="btn btn-p btn-xs" id="btn-add-tp">${t('rules.add_btn')}</button>
      </div>
    </div>`;

  panel.querySelectorAll('.xd').forEach(b => {
    b.addEventListener('click', () => onRemovePattern?.(b.dataset.p));
  });
  $('btn-add-tp')?.addEventListener('click', () => {
    const v = $('tp-input')?.value || '';
    if (v.trim()) onAddPattern?.(v);
  });
  $('tp-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { const v = e.target.value; if (v.trim()) onAddPattern?.(v); }
  });
}

export function renderStep6(testItems, csv, colIdx) {
  const { testPatterns } = getState();
  const patterns = testPatterns.length > 0 ? testPatterns : ['test'];
  const total = testItems.length;

  const patternColors = Object.fromEntries(
    patterns.map((p, i) => [p.toLowerCase(), KW_COLORS[i % KW_COLORS.length]])
  );
  _kwPatternColors = patternColors;

  const patternChips = patterns.map((p, i) => {
    const color = KW_COLORS[i % KW_COLORS.length];
    const cnt = testItems.filter(t => t.matchedFields.some(f => f.val.toLowerCase().includes(p.toLowerCase()))).length;
    return `<div class="sum-item"><div class="sum-n" style="color:${color}">${cnt}</div><div class="sum-l">${esc(p)}</div></div>`;
  }).join('');

  $('sb6').innerHTML = total > 0
    ? `<div class="sum-item"><div class="sum-n dim">${total}</div><div class="sum-l">${t('stat.found')}</div></div>${patternChips}`
    : `<div class="sum-item"><div class="sum-n acc">✓</div><div class="sum-l">${t('stat.no_match')}</div></div>`;

  _renderTestList(testItems, colIdx, patternColors);
  _renderT6Bar(testItems, colIdx);
  _updateSI6(testItems);
}

function _renderT6Bar(testItems, colIdx) {
  const el = $('t6-bar');
  if (!el || !testItems.length) { if (el) el.innerHTML = ''; return; }

  const total    = testItems.length;
  const checked  = testItems.filter(t => t.checked).length;
  const allChk   = checked === total;
  const noneChk  = checked === 0;

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin:8px 0">
      <button class="btn btn-g btn-xs${allChk ? ' on' : ''}" id="t6-all">${t('kw.select_all')}</button>
      <button class="btn btn-g btn-xs${noneChk ? ' on' : ''}" id="t6-none">${t('kw.select_none')}</button>
      <span style="font-size:11px;color:var(--t2);margin-left:auto">
        ${t('kw.sel_of', checked, total)}
        ${noneChk ? ` · <span style="color:var(--warn)">${t('kw.none_marked', total)}</span>` : ''}
      </span>
    </div>`;

  $('t6-all')?.addEventListener('click', () => {
    testItems.forEach(t => t.checked = true);
    setState({ testExcluded: new Set(testItems.map(t => t.rowIdx)) });
    _renderTestList(testItems, colIdx, _kwPatternColors);
    _renderT6Bar(testItems, colIdx);
    _updateSI6(testItems);
  });
  $('t6-none')?.addEventListener('click', () => {
    testItems.forEach(t => t.checked = false);
    setState({ testExcluded: new Set() });
    _renderTestList(testItems, colIdx, _kwPatternColors);
    _renderT6Bar(testItems, colIdx);
    _updateSI6(testItems);
  });
}

function _renderTestList(testItems, colIdx, patternColors = {}) {
  const cont = $('test-list');
  if (!testItems.length) {
    cont.innerHTML = `<div class="empty"><div class="empty-ico">✓</div><div class="empty-msg">${t('empty.no_test')}</div></div>`;
    return;
  }

  const _testScrollSaved = cont.querySelector('.twrap')?.scrollTop || 0;
  cont.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.className = 'twrap';
  wrapper.style.cssText = 'max-height:450px;overflow-y:auto';
  cont.appendChild(wrapper);

  testItems.forEach((item, ti) => {
    const d = document.createElement('div');
    d.style.cssText = 'display:flex;align-items:flex-start;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border);';

    const email = (item.row[colIdx] || '').trim();
    const fieldsHtml = item.matchedFields.map(({ name, val }) =>
      `<span class="dfield"><span class="dfield-k">${esc(name)}:</span><span class="dfield-v">${_kwHighlight(val, patternColors)}</span></span>`
    ).join('');

    d.innerHTML = `
      <div class="cbc" style="min-width:22px;flex-shrink:0;margin-top:2px">
        <input type="checkbox" data-ti="${ti}" ${item.checked ? 'checked' : ''}>
      </div>
      <span class="drow-num" style="flex-shrink:0">F${item.rowIdx + 2}</span>
      <div style="flex:1;min-width:0">
        <div class="drow-email">${esc(email)}</div>
        ${fieldsHtml ? `<div class="drow-fields">${fieldsHtml}</div>` : ''}
      </div>
      <div class="drow-act">
        <span class="${item.checked ? 'da-excl' : 'da-keep'}">${item.checked ? t('kw.action_remove') : t('kw.action_keep')}</span>
      </div>`;

    d.querySelector('input[type=checkbox]').addEventListener('change', e => {
      const i = parseInt(e.target.dataset.ti);
      testItems[i].checked = e.target.checked;
      const testExcluded = new Set(testItems.filter(t => t.checked).map(t => t.rowIdx));
      setState({ testExcluded });
      // Actualizar solo el badge de acción de esta fila (sin re-renderizar la lista)
      const actSpan = d.querySelector('.drow-act span');
      if (actSpan) {
        actSpan.className = e.target.checked ? 'da-excl' : 'da-keep';
        actSpan.textContent = e.target.checked ? t('kw.action_remove') : t('kw.action_keep');
      }
      _renderT6Bar(testItems, colIdx);
      _updateSI6(testItems);
    });

    wrapper.appendChild(d);
  });
  if (_testScrollSaved) wrapper.scrollTop = _testScrollSaved;
}

function _updateSI6(testItems) {
  const excl = testItems.filter(t => t.checked).length;
  $('si6').innerHTML = excl > 0 ? t('kw.to_remove', excl) : t('kw.none_to_remove');
  const btn = $('btn-next6');
  if (btn) btn.innerHTML = `${t('misc.continue')} <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>`;
}

// ════════════════════════════════════════════════════════════
//  PASO 7 — NORMALIZAR EMPRESA
// ════════════════════════════════════════════════════════════
let _junkPanelOpen       = false;
let _homologatePanelOpen = false;

function _c7Counts(companyNorms) {
  const rows = fn => companyNorms.filter(fn).reduce((acc, n) => acc + n.rowIdxs.length, 0);
  let vaciasCount = rows(n => !n.displayName && !n.newName);
  if (_c7Filter === 'vacias' && _vaciasSubFilter === 1 && _c7Csv && _c7ColIdx != null) {
    vaciasCount = companyNorms.filter(n => {
      if (!(!n.displayName && !n.newName)) return false;
      const row = _c7Csv.rows?.[n.rowIdxs[0]];
      if (!row) return false;
      let e = row[_c7ColIdx] || '';
      const df = getState().domainFixes?.[n.rowIdxs[0]];
      if (df?.checked) e = df.manualValue || df.corrected;
      return !_isPersonalEmail(e);
    }).reduce((acc, n) => acc + n.rowIdxs.length, 0);
  }
  return {
    all:         companyNorms.reduce((acc, n) => acc + n.rowIdxs.length, 0),
    autoclean:   rows(n => n.clear),
    autohomolog: rows(n => n.homologated && !n.clear),
    vacias:      vaciasCount,
    dominio:     rows(n => !!n._fromDomain),
    manual:      rows(n => !n.clear && !n.homologated && !n._fromDomain && n.newName !== n.displayName),
    review:      rows(n => n.review && !n.clear && !n.homologated && !!n.displayName && n.newName === n.displayName),
    sinmodif:    rows(n => !n.clear && !n.review && !n.homologated && n.displayName && n.newName === n.displayName),
  };
}

function _updateC7Counts(companyNorms) {
  const counts = _c7Counts(companyNorms);
  document.querySelectorAll('[data-c7f]').forEach(btn => {
    const span = btn.querySelector('span');
    if (span) span.textContent = counts[btn.dataset.c7f] ?? '';
  });
}

function _renderC7FilterBar(companyNorms, csv, colIdx, onClearToggle) {
  const atb = $('atb7');
  if (!atb) return;
  _c7Csv = csv;
  _c7ColIdx = colIdx;
  const counts = _c7Counts(companyNorms);
  const defs = [
    { id: 'all',         label: t('filter.all_f') },
    { id: 'autohomolog', label: t('filter.autohomolog') },
    { id: 'autoclean',   label: t('filter.autoclean') },
    { id: 'vacias',      label: t('stat.empty_col_f') },
    { id: 'manual',      label: t('filter.manual_f') },
    { id: 'review',      label: t('filter.review') },
    { id: 'sinmodif',    label: t('filter.unmodified') },
  ];

  const hasDomainFilled = companyNorms.some(n => n._fromDomain);
  const showFillBtn = _c7Filter === 'vacias' && _vaciasSubFilter === 1 && !hasDomainFilled;
  const fillBarHtml = showFillBtn
    ? `<div style="width:100%;margin-top:4px">
        <button class="btn btn-g btn-xs" id="btn-c7-filldomain" style="font-size:11px;padding:4px 10px">
          ✦ ${t('comp.fill_domain')}
        </button>
      </div>`
    : '';

  const domPillHtml = hasDomainFilled
    ? (() => {
        const isDomActive = _c7Filter === 'dominio';
        return `<button class="fb${isDomActive ? ' on' : ''}" data-c7f="dominio">
          ${t('comp.domain_filter')} <span style="opacity:.65;font-size:10px;margin-left:2px">${counts.dominio}</span>
        </button>`;
      })()
    : '';

  atb.innerHTML = `
    ${defs.map(f => {
      const isOn  = _c7Filter === f.id;
      const isBiz = isOn && f.id === 'vacias' && _vaciasSubFilter === 1;
      const style = isBiz ? ' style="background:var(--ok,#22c55e);color:#000;border-color:var(--ok,#22c55e)"' : '';
      return `<button class="fb${isOn ? ' on' : ''}" data-c7f="${f.id}"${style}>
        ${f.label} <span style="opacity:.65;font-size:10px;margin-left:2px">${counts[f.id]}</span>
      </button>`;
    }).join('')}
    ${domPillHtml}
    ${fillBarHtml}`;

  atb.querySelectorAll('[data-c7f]').forEach(b => {
    b.onclick = () => {
      const fid = b.dataset.c7f;
      if (fid === 'vacias' && _c7Filter === 'vacias') {
        _vaciasSubFilter = _vaciasSubFilter === 0 ? 1 : 0;
      } else {
        _c7Filter = fid;
        _vaciasSubFilter = 0;
      }
      _renderCompanyList(companyNorms, csv, colIdx, onClearToggle);
      _renderC7FilterBar(companyNorms, csv, colIdx, onClearToggle);
    };
  });

  if (showFillBtn) {
    $('btn-c7-filldomain')?.addEventListener('click', () => {
      const CONN = new Set(['el','con','de','del','y','la','en','los','las','un','una','por','a','o']);
      const _cap = s => {
        let first = true;
        return s.replace(/\S+/g, w => {
          const r = (!first && CONN.has(w.toLowerCase())) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1);
          first = false;
          return r;
        });
      };
      companyNorms.forEach(n => {
        if (!(!n.displayName && !n.newName)) return;
        const row = csv?.rows?.[n.rowIdxs[0]];
        if (!row) return;
        let e = row[colIdx] || '';
        const df = getState().domainFixes?.[n.rowIdxs[0]];
        if (df?.checked) e = df.manualValue || df.corrected;
        if (_isPersonalEmail(e)) return;
        const m = e.match(/@([^.@]+)\./);
        if (!m) return;
        n.newName = _cap(m[1].toLowerCase());
        n._case = 'lower_capitalize';
        n._fromDomain = true;
      });
      setState({ companyNorms: [...companyNorms] });
      _renderCompanyList(companyNorms, csv, colIdx, onClearToggle);
      _renderC7FilterBar(companyNorms, csv, colIdx, onClearToggle);
      _updateSI7(companyNorms);
    });
  }
}

function _updateSB7(companyNorms) {
  const total       = companyNorms.reduce((acc, n) => acc + n.rowIdxs.length, 0);
  const rows = fn => companyNorms.filter(fn).reduce((acc, n) => acc + n.rowIdxs.length, 0);
  const vacias      = rows(n => !n.displayName && !n.newName);
  const autoCleared = rows(n => n.clear);
  const homologated = rows(n => n.homologated && !n.clear);
  const domain      = rows(n => !!n._fromDomain);
  const manuales    = rows(n => !n.clear && !n.homologated && !n._fromDomain && n.newName !== n.displayName);
  const review      = rows(n => n.review && !n.clear && !n.homologated && !!n.displayName && n.newName === n.displayName);
  const sinModif    = rows(n => !n.clear && !n.review && !n.homologated && n.displayName && n.newName === n.displayName);
  $('sb7').innerHTML = `
    <div class="sum-item"><div class="sum-n dim">${total}</div><div class="sum-l">${t('stat.analyzed')}</div></div>
    ${vacias      > 0 ? `<div class="sum-item"><div class="sum-n" style="color:var(--t2)">${vacias}</div><div class="sum-l">${t('stat.empty_col_f')}</div></div>` : ''}
    ${homologated > 0 ? `<div class="sum-item"><div class="sum-n" style="color:var(--fmt)">${homologated}</div><div class="sum-l">${t('stat.autohomolog')}</div></div>` : ''}
    ${domain      > 0 ? `<div class="sum-item"><div class="sum-n" style="color:cyan">${domain}</div><div class="sum-l">Domain</div></div>` : ''}
    ${autoCleared > 0 ? `<div class="sum-item"><div class="sum-n" style="color:var(--red)">${autoCleared}</div><div class="sum-l">${t('stat.autoclean')}</div></div>` : ''}
    ${review      > 0 ? `<div class="sum-item"><div class="sum-n" style="color:var(--dup)">${review}</div><div class="sum-l">${t('stat.review')}</div></div>` : ''}
    ${manuales    > 0 ? `<div class="sum-item"><div class="sum-n" style="color:var(--warn)">${manuales}</div><div class="sum-l">${t('stat.manual_f')}</div></div>` : ''}
    ${sinModif    > 0 ? `<div class="sum-item"><div class="sum-n" style="color:var(--t0)">${sinModif}</div><div class="sum-l">${t('stat.unmodified')}</div></div>` : ''}`;
}

export function renderStep7({ companyNorms, csv, empresaIdx, colIdx,
  baseJunk = [], learnedJunk = [], customJunk = [], exclusions = [],
  homologateRules = [], resetPanels = false,
  onAddJunk, onRemoveCustom, onExcludeBase, onRestoreExcluded,
  onAddHomologate, onRemoveHomologate, onClearToggle }) {
  if (resetPanels) { _junkPanelOpen = false; _homologatePanelOpen = false; _c7Filter = 'all'; _vaciasSubFilter = 0; }
  _updateSB7(companyNorms);

  _renderHomologatePanel(homologateRules, onAddHomologate, onRemoveHomologate);
  _renderJunkPanel(baseJunk, learnedJunk, customJunk, exclusions, onAddJunk, onRemoveCustom, onExcludeBase, onRestoreExcluded);

  _c7Filter = 'all';
  _renderC7FilterBar(companyNorms, csv, colIdx, onClearToggle);
  _renderCompanyList(companyNorms, csv, colIdx, onClearToggle);
  _updateSI7(companyNorms);
}

function _renderJunkPanel(baseJunk, learnedJunk, customJunk, exclusions, onAddJunk, onRemoveCustom, onExcludeBase, onRestoreExcluded) {
  const panel = $('junk-panel');
  if (!panel) return;

  const exclSet = new Set((exclusions || []).map(s => s.toLowerCase().normalize('NFC')));

  const _chip = (j, { isLearned = false, isCustom = false } = {}) => {
    const key      = j.toLowerCase().normalize('NFC');
    const excluded = exclSet.has(key);
    const label    = isLearned ? `🧠 ${esc(j)}` : esc(j);
    if (excluded) {
      const style = 'opacity:.45;text-decoration:line-through;' + (isLearned ? 'border-color:var(--accent);color:var(--accent)' : '');
      return `<span class="wl-chip" style="${style}" title="${t('junk.excluded_chip_title')}">${label} <button class="xd" data-j="${esc(j)}" data-restore="1" title="${t('misc.restore')}">↺</button></span>`;
    }
    if (isCustom) {
      return `<span class="wl-chip cust">${esc(j)}<button class="xd" data-j="${esc(j)}" title="${t('misc.remove')}">✕</button></span>`;
    }
    const style = isLearned ? 'border-color:var(--accent);color:var(--accent)' : '';
    const title = isLearned ? t('tp.learned_title') : t('tp.base_title');
    return `<span class="wl-chip" style="${style}" title="${title}">${label}<button class="xd" data-j="${esc(j)}" data-exclude="1" title="${t('misc.exclude')}">✕</button></span>`;
  };

  const baseChips    = baseJunk.map(j => _chip(j)).join('');
  const learnedChips = learnedJunk.map(j => _chip(j, { isLearned: true })).join('');
  const customChips  = customJunk.map(j => _chip(j, { isCustom: true })).join('');
  const total = baseJunk.length + learnedJunk.length + customJunk.length;

  const bodyHtml = `
    <div class="wl-list" style="margin-bottom:10px;max-height:140px;overflow-y:auto">${baseChips}${learnedChips}${customChips}</div>
    <div class="radd">
      <input type="text" id="junk-input" placeholder="${t('junk.add_ph')}" style="width:230px">
      <button class="btn btn-p btn-xs" id="btn-add-junk">${t('rules.add_btn')}</button>
    </div>`;

  panel.innerHTML = `
    <div class="dgrp" style="margin-bottom:8px">
      <div class="dgrp-h" id="junk-panel-hdr" style="cursor:pointer">
        <span style="font-size:11px;font-weight:600;color:var(--t1);text-transform:uppercase;letter-spacing:.06em">${t('comp.autoclean')}</span>
        <span style="font-size:10px;color:var(--t2);margin-left:6px">${t('junk.count_hint', total)}</span>
        <span style="flex:1"></span>
        <button class="btn btn-g btn-xs" id="junk-panel-toggle">${_junkPanelOpen ? t('comp.hide') : t('comp.expand')}</button>
      </div>
      <div id="junk-panel-body" class="${_junkPanelOpen ? '' : 'hidden'}" style="padding:12px 15px;background:var(--s2);border:1px solid var(--border);border-top:none;border-radius:0 0 var(--rs) var(--rs)">
        ${bodyHtml}
      </div>
    </div>`;

  const _toggleJunk = () => {
    _junkPanelOpen = !_junkPanelOpen;
    $('junk-panel-body')?.classList.toggle('hidden', !_junkPanelOpen);
    const btn = $('junk-panel-toggle');
    if (btn) btn.textContent = _junkPanelOpen ? t('comp.hide') : t('comp.expand');
  };
  $('junk-panel-toggle')?.addEventListener('click', e => { e.stopPropagation(); _toggleJunk(); });
  $('junk-panel-hdr')?.addEventListener('click', e => { if (!e.target.closest('#junk-panel-toggle')) _toggleJunk(); });

  panel.querySelectorAll('.xd').forEach(b => {
    b.addEventListener('click', () => {
      const j = b.dataset.j;
      if (b.dataset.restore === '1') onRestoreExcluded?.(j);
      else if (b.dataset.exclude === '1') onExcludeBase?.(j);
      else onRemoveCustom?.(j);
    });
  });
  $('btn-add-junk')?.addEventListener('click', () => {
    const v = $('junk-input')?.value || '';
    if (v.trim()) onAddJunk?.(v);
  });
  $('junk-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { const v = e.target.value; if (v.trim()) onAddJunk?.(v); }
  });
}

function _renderHomologatePanel(homologateRules, onAddHomologate, onRemoveHomologate) {
  const panel = $('homologate-panel');
  if (!panel) return;

  const chips = (homologateRules || []).map(r => {
    const replaceLabel = r.replace !== '' ? `<span style="color:var(--accent);font-weight:600">${esc(r.replace)}</span>`
                                          : `<span style="color:var(--t2);font-style:italic">(eliminar)</span>`;
    return `<span class="wl-chip cust" style="border-color:rgba(96,165,250,.35)">
       <span style="color:var(--warn)">${esc(r.find)}</span>
       <span style="color:var(--t2);margin:0 4px">→</span>
       ${replaceLabel}
       <button class="xd" data-find="${esc(r.find)}" title="Quitar regla">✕</button>
     </span>`;
  }).join('');

  const bodyHtml = `
    <div style="font-size:10px;color:var(--t2);margin-bottom:8px">
      Usá <code style="background:var(--s3);padding:1px 4px;border-radius:3px">*</code> como comodín (ej: <code style="background:var(--s3);padding:1px 4px;border-radius:3px">s.a*</code> incluye s.a, s.a., S.A · <code style="background:var(--s3);padding:1px 4px;border-radius:3px">*.r.l*</code> incluye s.r.l, s.r.l.)
      · Dejá el reemplazo vacío para eliminar el texto.
    </div>
    <div class="wl-list" style="margin-bottom:10px;min-height:20px">${chips || `<em style="font-size:11px;color:var(--t2)">${t('homol.no_rules')}</em>`}</div>
    <div class="radd">
      <input type="text" id="homologate-find"    placeholder="${t('homol.find_ph')}" style="width:160px">
      <span style="color:var(--t2);font-size:12px">→</span>
      <input type="text" id="homologate-replace" placeholder="${t('homol.replace_ph')}" style="width:155px">
      <button class="btn btn-p btn-xs" id="btn-add-homologate">${t('rules.add_btn')}</button>
    </div>`;

  const n = (homologateRules || []).length;
  panel.innerHTML = `
    <div class="dgrp" style="margin-bottom:8px">
      <div class="dgrp-h" id="homologate-panel-hdr" style="cursor:pointer">
        <span style="font-size:11px;font-weight:600;color:var(--t1);text-transform:uppercase;letter-spacing:.06em">${t('comp.autohomolog')}</span>
        <span style="font-size:10px;color:var(--t2);margin-left:6px">${t('homol.substrings_hint', n)}</span>
        <span style="flex:1"></span>
        <button class="btn btn-g btn-xs" id="homologate-panel-toggle">${_homologatePanelOpen ? t('comp.hide') : t('comp.expand')}</button>
      </div>
      <div id="homologate-panel-body" class="${_homologatePanelOpen ? '' : 'hidden'}" style="padding:12px 15px;background:var(--s2);border:1px solid var(--border);border-top:none;border-radius:0 0 var(--rs) var(--rs)">
        ${bodyHtml}
      </div>
    </div>`;

  const _toggleHom = () => {
    _homologatePanelOpen = !_homologatePanelOpen;
    $('homologate-panel-body')?.classList.toggle('hidden', !_homologatePanelOpen);
    const btn = $('homologate-panel-toggle');
    if (btn) btn.textContent = _homologatePanelOpen ? t('comp.hide') : t('comp.expand');
  };
  $('homologate-panel-toggle')?.addEventListener('click', e => { e.stopPropagation(); _toggleHom(); });
  $('homologate-panel-hdr')?.addEventListener('click', e => { if (!e.target.closest('#homologate-panel-toggle')) _toggleHom(); });

  panel.querySelectorAll('.xd[data-find]').forEach(b => {
    b.addEventListener('click', () => onRemoveHomologate?.(b.dataset.find));
  });

  const _addRule = () => {
    const find    = $('homologate-find')?.value  || '';
    const replace = $('homologate-replace')?.value ?? '';   // vacío es válido
    if (find.trim()) { onAddHomologate?.(find, replace); }
    else { toast('Ingresá el patrón a buscar', 'warn'); }
  };
  $('btn-add-homologate')?.addEventListener('click', _addRule);
  $('homologate-find')?.addEventListener('keydown',    e => { if (e.key === 'Enter') $('homologate-replace')?.focus(); });
  $('homologate-replace')?.addEventListener('keydown', e => { if (e.key === 'Enter') _addRule(); });
}

export function renderStep7NoEmpresa() {
  $('sb7').innerHTML = `<div class="sum-item"><div class="sum-n" style="color:var(--t2)">—</div><div class="sum-l">${t('empty.no_company_col')}</div></div>`;
  $('comp-list').innerHTML = `<div class="empty"><div class="empty-ico">ℹ</div><div class="empty-msg">${t('comp.no_col_msg')}</div></div>`;
  $('si7').textContent = t('comp.no_col_si');
}

function _renderCompanyList(companyNorms, csv, colIdx, onClearToggle) {
  const cont = $('comp-list');
  const _savedScroll = cont.querySelector('.twrap')?.scrollTop || 0;
  cont.innerHTML = '';

  // Email corregido: aplica correcciones de validación y dominio sobre el original
  const { valItems = [], domItems = [] } = getState();
  const _valMap = new Map(valItems.map(v => [v.rowIdx, v]));
  const _domMap = new Map(domItems.map(d => [d.rowIdx, d]));
  const _corrected = ri => {
    let e = (csv && colIdx != null) ? ((csv.rows[ri] || [])[colIdx] || '').trim() : '';
    const vf = _valMap.get(ri);
    const df = _domMap.get(ri);
    if (vf?.checked) e = vf.manualValue || vf.autoFixed;
    if (df?.checked) e = df.manualValue || df.corrected;
    return e;
  };

  const filtered = _c7Filter === 'autoclean'   ? companyNorms.filter(n => n.clear)
                 : _c7Filter === 'autohomolog' ? companyNorms.filter(n => n.homologated && !n.clear)
                 : _c7Filter === 'vacias'      ? companyNorms.filter(n => {
                     if (!(!n.displayName && !n.newName)) return false;
                     if (_vaciasSubFilter === 1 && csv && colIdx != null) {
                       const email = _corrected(n.rowIdxs[0]);
                       return !_isPersonalEmail(email);
                     }
                     return true;
                   })
                 : _c7Filter === 'dominio'     ? companyNorms.filter(n => !!n._fromDomain)
                 : _c7Filter === 'manual'      ? companyNorms.filter(n => !n.clear && !n.homologated && !n._fromDomain && n.newName !== n.displayName)
                 : _c7Filter === 'review'      ? companyNorms.filter(n => n.review && !n.clear && !n.homologated && !!n.displayName && n.newName === n.displayName)
                 : _c7Filter === 'sinmodif'    ? companyNorms.filter(n => !n.clear && !n.review && !n.homologated && n.displayName && n.newName === n.displayName)
                 : companyNorms;

  if (filtered.length === 0) {
    cont.innerHTML = `<div class="empty"><div class="empty-ico">✓</div><div class="empty-msg">${t('empty.no_category')}</div></div>`;
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'twrap';
  wrapper.style.cssText = 'max-height:450px;overflow-y:auto';
  cont.appendChild(wrapper);

  // Mapa índice original → ni (evita indexOf O(n²) dentro del forEach)
  const normToIdx = new Map(companyNorms.map((n, i) => [n, i]));
  filtered.forEach((norm) => {
    const ni = normToIdx.get(norm);
    const d = document.createElement('div');
    d.style.cssText = 'display:flex;flex-direction:column;padding:10px 14px;border-bottom:1px solid var(--border);gap:4px;';

    const sampleEmail = norm.rowIdxs.length ? _corrected(norm.rowIdxs[0]) : '';

    const labelHtml = norm.displayName
      ? `<span style="font-family:var(--mono);font-size:12px;color:var(--t0)">${esc(norm.displayName)}</span>`
      : `<span style="font-size:11px;color:var(--t2);font-style:italic">(vacío)</span>`;
    const isReview         = norm.review && !norm.clear && !norm.homologated && !!norm.displayName && norm.newName === norm.displayName;
    const inputColor = norm.clear
      ? 'color:var(--red);text-decoration:line-through;opacity:.6;pointer-events:none'
      : norm.homologated
        ? 'color:var(--fmt)'
        : isReview
          ? 'color:var(--dup)'
          : (norm.newName !== norm.displayName ? 'color:var(--warn)' : '');

    const learnedBadge     = norm.learned ? `<span title="${t('tp.learned_title')}" style="font-size:10px;margin-left:4px">🧠</span>` : '';
    const homologatedBadge = (norm.homologated && !norm.clear) ? `<span title="${t('comp.autohomolog')}" style="font-size:10px;margin-left:4px;color:var(--fmt)">≈</span>` : '';
    const reviewBadge      = isReview ? `<span title="${t('filter.review')}" style="font-size:10px;margin-left:4px;color:var(--dup)">⚠</span>` : '';

    d.innerHTML = `
      ${sampleEmail ? `<div style="font-size:10px;color:var(--t2);font-family:var(--mono);word-break:break-all">${esc(sampleEmail)}</div>` : ''}
      <div style="display:flex;align-items:center;gap:10px">
        <div style="flex:0 0 160px;min-width:0;overflow:hidden">
          ${labelHtml}${learnedBadge}${homologatedBadge}${reviewBadge}
          <div style="font-size:10px;color:var(--t2);margin-top:2px">${norm.rowIdxs.length} fila${norm.rowIdxs.length !== 1 ? 's' : ''}</div>
        </div>
        <input class="ei comp-input${norm.homologated && !norm.clear ? ' homologated' : (!norm.clear && norm.newName !== norm.displayName ? ' mod' : '')}" data-ni="${ni}" value="${esc(norm.newName)}" placeholder="${t('comp.company_ph')}" style="flex:1;${inputColor}">
        <select class="comp-case" data-ni="${ni}" style="flex-shrink:0;font-size:11px;padding:4px 22px 4px 7px" title="Transformar texto">
          <option value="">— case —</option>
          <option value="lower" ${norm._case === 'lower' ? 'selected' : ''}>lower</option>
          <option value="capitalize" ${norm._case === 'capitalize' ? 'selected' : ''}>Capitalize</option>
          <option value="lower_capitalize" ${norm._case === 'lower_capitalize' ? 'selected' : ''}>lower & Capitalize</option>
          <option value="upper" ${norm._case === 'upper' ? 'selected' : ''}>UPPER</option>
        </select>
        <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--t2);white-space:nowrap;cursor:pointer;flex-shrink:0">
          <input type="checkbox" class="comp-clear" data-ni="${ni}" ${norm.clear ? 'checked' : ''}> Limpiar
        </label>
      </div>`;

    const input = d.querySelector('.comp-input');
    if (input) {
      input.value = norm.newName;
      input.addEventListener('input', e => {
        const i = parseInt(e.target.dataset.ni);
        companyNorms[i].newName = e.target.value;
        if (companyNorms[i].homologated) {
          companyNorms[i].homologated = false;
          e.target.style.color = 'var(--warn)';
          e.target.classList.remove('homologated');
        }
        if (companyNorms[i]._fromDomain) companyNorms[i]._fromDomain = false;
        if (companyNorms[i].review && e.target.value !== companyNorms[i].displayName) {
          companyNorms[i].review = false;
          e.target.style.color = 'var(--warn)';
        }
        e.target.classList.toggle('mod', e.target.value !== companyNorms[i].displayName);
        setState({ companyNorms: [...companyNorms] });
        _updateSI7(companyNorms);
        _updateC7Counts(companyNorms);
      });
    }

    const caseSel = d.querySelector('.comp-case');
    if (caseSel) {
      caseSel.addEventListener('change', e => {
        const i   = parseInt(e.target.dataset.ni);
        const mode = e.target.value;
        companyNorms[i]._case = mode;
        if (!mode) return;
        const inp  = d.querySelector('.comp-input');
        if (!inp) return;
        const cur  = inp.value;
        const CONN = new Set(['el','con','de','del','y','la','en','los','las','un','una','por','a','o']);
        const _capitalize = s => {
          let first = true;
          return s.replace(/\S+/g, w => {
            const r = (!first && CONN.has(w.toLowerCase())) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1);
            first = false;
            return r;
          });
        };
        const next = mode === 'lower'             ? cur.toLowerCase()
                   : mode === 'upper'             ? cur.toUpperCase()
                   : mode === 'lower_capitalize'  ? _capitalize(cur.toLowerCase())
                   : _capitalize(cur);
        inp.value = next;
        companyNorms[i].newName = next;
        if (companyNorms[i].homologated) {
          companyNorms[i].homologated = false;
          inp.style.color = 'var(--warn)';
          inp.classList.remove('homologated');
        }
        if (companyNorms[i]._fromDomain) companyNorms[i]._fromDomain = false;
        if (companyNorms[i].review && next !== companyNorms[i].displayName) {
          companyNorms[i].review = false;
          inp.style.color = 'var(--warn)';
        }
        inp.classList.toggle('mod', next !== companyNorms[i].displayName);
        setState({ companyNorms: [...companyNorms] });
        _updateSI7(companyNorms);
        _updateC7Counts(companyNorms);
      });
    }

    const clearCb = d.querySelector('.comp-clear');
    if (clearCb) {
      clearCb.addEventListener('change', e => {
        const i = parseInt(e.target.dataset.ni);
        companyNorms[i].clear = e.target.checked;
        setState({ companyNorms: [...companyNorms] });
        const inp = d.querySelector('.comp-input');
        if (inp) {
          inp.style.opacity        = e.target.checked ? '.4' : '1';
          inp.style.pointerEvents  = e.target.checked ? 'none' : '';
          inp.style.textDecoration = e.target.checked ? 'line-through' : '';
        }
        _updateSI7(companyNorms);
        _updateC7Counts(companyNorms);
        if (onClearToggle) onClearToggle(companyNorms[i], e.target.checked);
      });
    }

    wrapper.appendChild(d);
  });
  if (_savedScroll) wrapper.scrollTop = _savedScroll;
}

function _updateSI7(companyNorms) {
  const edited      = companyNorms.filter(n => n.clear || n.newName !== n.displayName).length;
  const cleared     = companyNorms.filter(n => n.clear).length;
  const homologated = companyNorms.filter(n => n.homologated && !n.clear).length;
  $('si7').innerHTML = edited > 0 ? t('comp.si7_html', edited, cleared, homologated) : t('misc.no_changes');
  _updateSB7(companyNorms);
}

// ════════════════════════════════════════════════════════════
//  PASO 8 — PAÍS Y TELÉFONO
// ════════════════════════════════════════════════════════════
let _c7Filter = 'all';
let _vaciasSubFilter = 0; // 0 = todas las vacías, 1 = solo dominios no personales
let _c7Csv = null;
let _c7ColIdx = null;
let _s8Filter = 'all';

const _PERSONAL_DOMAIN_PREFIXES = [
  '@gmail.','@hotmail.','@yahoo.','@aol.','@msn.','@ymail.','@outlook.',
  '@icloud.','@me.com','@zoho.','@proton.','@yandex.','@titan.','@starmail.','@tuta.',
  '@disroot.','@mailfence.','@fastmail.','@live.','@tutanota.','@gmx.',
  '@email.','@usa.','@engineer.','@consultant.',
];
const _PERSONAL_DOMAIN_EXACT = ['@mail.ru'];

function _isPersonalEmail(email) {
  const e = (email || '').toLowerCase();
  return _PERSONAL_DOMAIN_PREFIXES.some(d => e.includes(d))
      || _PERSONAL_DOMAIN_EXACT.some(d => e.endsWith(d));
}
export function resetStep8Filter() { _s8Filter = 'all'; }

/**
 * Muestra selector de columnas cuando no se detectaron País ni Teléfono automáticamente.
 * @param {string[]} headers - Encabezados del CSV
 * @param {Function} onConfirm - callback(paisIdx, telIdx)
 */
export function renderStep8ColSelector(headers, onConfirm) {
  const panel = $('step8-panel');
  if (!panel) return;

  const opts = [`<option value="-1">${t('country.none')}</option>`,
    ...headers.map((h, i) => `<option value="${i}">${esc(h || 'Col ' + (i+1))}</option>`),
  ].join('');

  panel.innerHTML = `
    <div class="sum-box" style="margin-bottom:14px;color:var(--t1)">
      ${t('country.no_auto')}<br>
      ${t('country.select_hint')}
    </div>
    <div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:16px">
      <label style="font-size:12px;color:var(--t2)">
        ${t('country.col_pais')}<br>
        <select id="col-sel-pais" style="margin-top:5px;min-width:190px">${opts}</select>
      </label>
      <label style="font-size:12px;color:var(--t2)">
        ${t('country.col_tel')}<br>
        <select id="col-sel-tel" style="margin-top:5px;min-width:190px">${opts}</select>
      </label>
    </div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-p btn-sm" id="btn-step8-confirm">${t('country.confirm')}</button>
      <button class="btn btn-g btn-sm" id="btn-step8-skip">${t('country.skip')}</button>
    </div>`;

  const si8 = $('si8');
  if (si8) si8.textContent = t('country.select_cols');

  $('btn-step8-confirm').addEventListener('click', () => {
    const pi = parseInt($('col-sel-pais').value);
    const ti = parseInt($('col-sel-tel').value);
    onConfirm(pi, ti);
  });
  $('btn-step8-skip').addEventListener('click', () => onConfirm(-1, -1));
}

/**
 * Tabla de revisión: muestra antes/después por fila, con checkboxes y selectores editables.
 */
export function renderStep8({ step8Items, countryData, paisIdx, telIdx, onCountryChange, onCheckChange, onCheckAll, onPhoneChange, onFilterChange }) {
  const panel = $('step8-panel');
  if (!panel) return;
  const _s8ScrollSaved = panel.querySelector('#s8-scroll > div')?.scrollTop || 0;

  const hasPais = paisIdx >= 0;
  const hasTel  = telIdx  >= 0;

  // Stats por categoría (todos los items, no solo los con cambios)
  const analizadas   = step8Items.length;
  const willChange   = step8Items.filter(i => i.willChangePais || i.willChangeTel);
  const unresolved   = step8Items.filter(i => !i.country);
  const checkedCnt   = willChange.filter(i => i.checked).length;

  const paisAuto     = step8Items.filter(i => i.willChangePais && i.source !== 'manual').length;
  const paisManual   = step8Items.filter(i => i.source === 'manual').length;
  const paisVacio    = step8Items.filter(i => !i.country && !i.originalPais).length;
  const paisInvalido = step8Items.filter(i => !!i.originalPais && !i.country).length;
  const paisValidos  = step8Items.filter(i => !!i.country).length;

  const telAuto      = step8Items.filter(i => i.willChangeTel && !i.phoneInvalid).length;
  const telManual    = step8Items.filter(i => i.manualPhone != null && i.manualPhone !== '').length;
  const telVacio     = step8Items.filter(i => !i.phone).length;
  const telInvalido  = step8Items.filter(i => i.phoneInvalid).length;
  const telValidos   = step8Items.filter(i => !!i.phone && !i.phoneInvalid).length;

  // Filtro activo — opera sobre todos los items
  const filtered = _s8Filter === 'pais-auto'     ? step8Items.filter(i => i.willChangePais && i.source !== 'manual')
                 : _s8Filter === 'pais-manual'   ? step8Items.filter(i => i.source === 'manual')
                 : _s8Filter === 'pais-vacio'    ? step8Items.filter(i => !i.country && !i.originalPais)
                 : _s8Filter === 'pais-invalido' ? step8Items.filter(i => !!i.originalPais && !i.country)
                 : _s8Filter === 'pais-validos'  ? step8Items.filter(i => !!i.country)
                 : _s8Filter === 'tel-auto'      ? step8Items.filter(i => i.willChangeTel && !i.phoneInvalid)
                 : _s8Filter === 'tel-manual'    ? step8Items.filter(i => i.manualPhone != null && i.manualPhone !== '')
                 : _s8Filter === 'tel-vacio'     ? step8Items.filter(i => !i.phone)
                 : _s8Filter === 'tel-invalido'  ? step8Items.filter(i => i.phoneInvalid)
                 : _s8Filter === 'tel-validos'   ? step8Items.filter(i => !!i.phone && !i.phoneInvalid)
                 : step8Items;

  // Stats box
  const sb8 = $('sb8');
  if (sb8) sb8.innerHTML = `
    <div class="sum-item"><div class="sum-n dim">${analizadas}</div><div class="sum-l">${t('stat.analyzed_f')}</div></div>
    <div style="width:1px;background:var(--border);align-self:stretch;margin:0 4px"></div>
    <div class="sum-item" style="justify-content:center;flex-direction:column;align-items:center;gap:2px"><div style="font-size:15px;line-height:1">🌍</div><div style="font-size:9px;color:var(--t2);text-transform:uppercase;letter-spacing:.05em;font-weight:600">${t('country.country')}</div></div>
    <div class="sum-item"><div class="sum-n fmtc">${paisAuto}</div><div class="sum-l">${t('stat.auto')}</div></div>
    <div class="sum-item"><div class="sum-n" style="color:var(--warn)">${paisManual}</div><div class="sum-l">${t('stat.manual')}</div></div>
    <div class="sum-item"><div class="sum-n" style="color:var(--t2)">${paisVacio}</div><div class="sum-l">${t('stat.empty_v')}</div></div>
    <div class="sum-item"><div class="sum-n redc">${paisInvalido}</div><div class="sum-l">${t('stat.invalid_v')}</div></div>
    <div class="sum-item"><div class="sum-n dim">${paisValidos}</div><div class="sum-l">${t('stat.valid')}</div></div>
    <div style="width:1px;background:var(--border);align-self:stretch;margin:0 4px"></div>
    <div class="sum-item" style="justify-content:center;flex-direction:column;align-items:center;gap:2px"><div style="font-size:15px;line-height:1">📱</div><div style="font-size:9px;color:var(--t2);text-transform:uppercase;letter-spacing:.05em;font-weight:600">${t('country.phone')}</div></div>
    <div class="sum-item"><div class="sum-n fmtc">${telAuto}</div><div class="sum-l">${t('stat.auto')}</div></div>
    <div class="sum-item"><div class="sum-n" style="color:var(--warn)">${telManual}</div><div class="sum-l">${t('stat.manual')}</div></div>
    <div class="sum-item"><div class="sum-n" style="color:var(--t2)">${telVacio}</div><div class="sum-l">${t('stat.empty_v')}</div></div>
    <div class="sum-item"><div class="sum-n redc">${telInvalido}</div><div class="sum-l">${t('stat.invalid_v')}</div></div>
    <div class="sum-item"><div class="sum-n dim">${telValidos}</div><div class="sum-l">${t('stat.valid')}</div></div>`;

  const si8 = $('si8');
  if (si8) si8.innerHTML = t('country.sel_of', checkedCnt, willChange.length);

  if (!step8Items.length) {
    panel.innerHTML = `<div class="sum-box" style="color:var(--t2)">${t('empty.no_filter')}</div>`;
    return;
  }

  // Selector global "aplicar a todos sin resolver"
  const freq = _step8FreqCountry(step8Items.filter(i => i.country)) || countryData[0] || null;
  // Sin pre-selección en HTML → se setea por JS usando data-selected (se reutiliza en cada fila)
  const countryOptsNoSel = [
    '<option value="">— elegir —</option>',
    ...countryData.map(c => `<option value="${c.iso2}">${esc(c.nameEs)}</option>`),
  ].join('');
  // Para el selector global sí pre-seleccionamos el más frecuente
  const countryOptsFreq = [
    '<option value="">— elegir país —</option>',
    ...countryData.map(c =>
      `<option value="${c.iso2}"${freq?.iso2 === c.iso2 ? ' selected' : ''}>${esc(c.nameEs)}</option>`
    ),
  ].join('');

  // Check-all state
  const allChecked  = willChange.length > 0 && willChange.every(i => i.checked);
  const someChecked = willChange.some(i => i.checked);

  panel.innerHTML = `
    ${unresolved.length > 0 ? `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;padding:10px 14px;background:var(--s2);border:1px solid var(--border);border-radius:var(--rs);flex-wrap:wrap">
      <span style="font-size:11px;color:var(--t2)">${t('country.apply_unresolved')}</span>
      <select id="apply-all-sel" style="min-width:190px;font-size:11px">${countryOptsFreq}</select>
      <button class="btn btn-g btn-xs" id="btn-s8-apply-all">${t('country.apply')}</button>
    </div>` : ''}
    <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:10px;align-items:center;justify-content:flex-end">
      <button class="fb${_s8Filter==='all'?' on':''}" data-s8f="all">${t('filter.all')} <span style="opacity:.65;font-size:10px;margin-left:2px">${analizadas}</span></button>
      <span style="color:var(--border);font-size:14px;line-height:1;padding:0 2px">|</span>
      <span style="font-size:10px;color:var(--t2)">🌍</span>
      <button class="fb${_s8Filter==='pais-auto'?' on':''}" data-s8f="pais-auto">${t('stat.auto')} <span style="opacity:.65;font-size:10px;margin-left:2px">${paisAuto}</span></button>
      <button class="fb${_s8Filter==='pais-manual'?' on':''}" data-s8f="pais-manual">${t('stat.manual')} <span style="opacity:.65;font-size:10px;margin-left:2px">${paisManual}</span></button>
      <button class="fb${_s8Filter==='pais-vacio'?' on':''}" data-s8f="pais-vacio">${t('stat.empty_v')} <span style="opacity:.65;font-size:10px;margin-left:2px">${paisVacio}</span></button>
      <button class="fb${_s8Filter==='pais-invalido'?' on':''}" data-s8f="pais-invalido">${t('stat.invalid_v')} <span style="opacity:.65;font-size:10px;margin-left:2px">${paisInvalido}</span></button>
      <button class="fb${_s8Filter==='pais-validos'?' on':''}" data-s8f="pais-validos">${t('stat.valid')} <span style="opacity:.65;font-size:10px;margin-left:2px">${paisValidos}</span></button>
      <span style="color:var(--border);font-size:14px;line-height:1;padding:0 2px">|</span>
      <span style="font-size:10px;color:var(--t2)">📱</span>
      <button class="fb${_s8Filter==='tel-auto'?' on':''}" data-s8f="tel-auto">${t('stat.auto')} <span style="opacity:.65;font-size:10px;margin-left:2px">${telAuto}</span></button>
      <button class="fb${_s8Filter==='tel-manual'?' on':''}" data-s8f="tel-manual">${t('stat.manual')} <span style="opacity:.65;font-size:10px;margin-left:2px">${telManual}</span></button>
      <button class="fb${_s8Filter==='tel-vacio'?' on':''}" data-s8f="tel-vacio">${t('stat.empty_v')} <span style="opacity:.65;font-size:10px;margin-left:2px">${telVacio}</span></button>
      <button class="fb${_s8Filter==='tel-invalido'?' on':''}" data-s8f="tel-invalido">${t('stat.invalid_v')} <span style="opacity:.65;font-size:10px;margin-left:2px">${telInvalido}</span></button>
      <button class="fb${_s8Filter==='tel-validos'?' on':''}" data-s8f="tel-validos">${t('stat.valid')} <span style="opacity:.65;font-size:10px;margin-left:2px">${telValidos}</span></button>
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <button class="btn btn-g btn-xs${allChecked ? ' on' : ''}" id="s8-all">${t('country.select_all')}</button>
      <button class="btn btn-g btn-xs${!someChecked ? ' on' : ''}" id="s8-none">${t('country.select_none')}</button>
      <span style="font-size:11px;color:var(--t2);margin-left:auto">
        ${t('country.sel_of', checkedCnt, willChange.length)}
        ${unresolved.length ? ` · ${t('country.unresolved', unresolved.length)}` : ''}
      </span>
    </div>
    <div id="s8-scroll" style="border:1px solid var(--border);border-radius:var(--rs);overflow-x:auto">
      <div style="overflow-y:auto;max-height:450px">
      <table>
        <thead style="position:sticky;top:0;z-index:10;isolation:isolate"><tr>
          <th style="width:36px"></th>
          <th style="width:44px">${t('country.row')}</th>
          <th>${t('country.email')}</th>
          <th>${hasPais ? t('country.country') : t('country.no_col')}</th>
          ${hasTel ? `<th>${t('country.phone')}</th>` : ''}
          <th style="width:72px">${t('country.source')}</th>
        </tr></thead>
        <tbody id="step8-tbody">
          ${filtered.length
            ? filtered.map(item => _renderStep8Row(item, countryOptsNoSel, hasTel)).join('')
            : `<tr><td colspan="6"><div class="empty"><div class="empty-ico">✓</div><div class="empty-msg">${t('empty.no_filter')}</div></div></td></tr>`}
        </tbody>
      </table>
      </div>
    </div>`;

  if (_s8ScrollSaved) { const sd = panel.querySelector('#s8-scroll > div'); if (sd) sd.scrollTop = _s8ScrollSaved; }

  $('s8-all')?.addEventListener('click', () => onCheckAll?.(true));
  $('s8-none')?.addEventListener('click', () => onCheckAll?.(false));

  $('btn-s8-apply-all')?.addEventListener('click', () => {
    const iso2 = $('apply-all-sel').value;
    if (!iso2) return;
    unresolved.forEach(item => onCountryChange?.(item.rowIdx, iso2));
    toast(t('toast.country_applied'));
  });

  document.querySelectorAll('#step8-tbody .s8-row-cb').forEach(cb => {
    cb.addEventListener('change', e => onCheckChange?.(parseInt(e.target.dataset.ri), e.target.checked));
  });

  // Selectores de país: setear valor vía data-selected y escuchar cambios
  document.querySelectorAll('#step8-tbody .s8-csel').forEach(sel => {
    if (sel.dataset.selected) sel.value = sel.dataset.selected;
    sel.addEventListener('change', () => onCountryChange?.(parseInt(sel.dataset.ri), sel.value));
  });

  // Inputs de teléfono: edición sin re-render — valida dígitos en tiempo real
  document.querySelectorAll('#step8-tbody .s8-tel-input').forEach(inp => {
    inp.addEventListener('input', e => {
      const val    = e.target.value;
      const digits = val.replace(/\D/g, '').length;
      const inv    = !!val && (digits <= 5 || digits >= 16);
      e.target.classList.toggle('mod', val !== e.target.dataset.orig);
      e.target.style.borderColor = inv ? 'var(--red)' : '';
      e.target.style.color       = inv ? 'var(--red)' : 'var(--t0)';
      onPhoneChange?.(parseInt(e.target.dataset.ri), val);
    });
    // Al salir del input (blur/Enter): actualizar stats si cambió el estado inválido→válido
    inp.addEventListener('change', e => {
      onPhoneChange?.(parseInt(e.target.dataset.ri), e.target.value);
      onFilterChange?.();
    });
  });

  // Filtros
  document.querySelectorAll('[data-s8f]').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('[data-s8f]').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      _s8Filter = b.dataset.s8f;
      onFilterChange?.();
    });
  });
}

function _renderStep8Row(item, countryOptsNoSel, hasTel) {
  const srcLabel = { email: '📧 email', phone: '📱 tel.', column: '📋 col.', manual: '✍️ manual' }[item.source] || '—';
  const srcStyle = item.source === 'manual'
    ? 'background:rgba(255,165,0,.12);color:var(--warn)'
    : item.source === 'column'
    ? 'background:rgba(100,100,100,.08);color:var(--t2)'
    : 'background:rgba(96,220,200,.1);color:var(--fmt)';
  const srcBadge = `<span class="tag" style="font-size:9px;padding:2px 6px;${srcStyle}">${srcLabel}</span>`;

  const isUnresolved = !item.country;
  const cbDisabled   = isUnresolved;

  // Selector de país — siempre visible en todos los casos
  // Color: naranja (--fmt) si fue auto-detectado; gris tenue si ya venía de la columna; warn si sin resolver
  const isDetected = !isUnresolved && item.source !== 'column';
  const selColor   = isUnresolved  ? 'var(--warn)'
                   : isDetected    ? 'var(--fmt)'
                   : 'var(--t2)';
  const selBorder  = isDetected || isUnresolved ? `border-color:${selColor}` : '';

  const beforeHtml = item.willChangePais && item.originalPais
    ? `<span class="t-bad" style="font-size:11px;white-space:nowrap">${esc(item.originalPais)}</span><span class="arr" style="color:var(--t0)">→</span>`
    : '';

  const paisCell = `<td>
    <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
      ${beforeHtml}
      <select class="s8-csel" data-ri="${item.rowIdx}" data-selected="${esc(item.country?.iso2 || '')}"
        style="min-width:140px;font-size:11px;color:${selColor};${selBorder}">
        ${countryOptsNoSel}
      </select>
    </div>
  </td>`;

  // Tel cell — phoneInvalid tiene prioridad (input vacío), luego willChangeTel (pre-relleno)
  let telCell = '';
  if (hasTel) {
    if (item.phoneInvalid) {
      // Inválido sin auto-formato — input vacío para corrección manual
      const displayVal = item.manualPhone != null ? item.manualPhone : '';
      const inputInv   = !!displayVal && _telInvalid(displayVal);
      const inputStyle = `width:130px;font-family:var(--mono);${inputInv ? 'border-color:var(--red);color:var(--red)' : 'color:var(--t0)'}`;
      telCell = `<td>
        <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
          <span class="mono" style="font-size:11px;white-space:nowrap;color:var(--red)">⚠ ${esc(item.phone || '—')}</span>
          <span class="arr" style="color:var(--t0)">→</span>
          <input class="ei s8-tel-input"
            data-ri="${item.rowIdx}"
            data-orig=""
            value="${esc(displayVal)}"
            style="${inputStyle}"
            placeholder="${t('country.enter_num_ph')}">
        </div>
      </td>`;
    } else if (item.willChangeTel) {
      // Auto-formato válido — input pre-relleno con el número formateado
      const displayPhone = item.manualPhone != null ? item.manualPhone : item.formattedPhone;
      const isMod        = item.manualPhone != null && item.manualPhone !== item.formattedPhone;
      const finalInv     = _telInvalid(displayPhone);
      const inputColor   = finalInv ? 'var(--red)' : 'var(--fmt)';
      const inputBorder  = finalInv ? 'border-color:var(--red);' : '';
      const warnBadge    = finalInv
        ? `<span style="font-size:10px;color:var(--red)" title="Inválido: debe tener entre 6 y 15 dígitos">⚠</span>`
        : '';
      telCell = `<td>
        <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
          <span class="mono" style="font-size:11px;white-space:nowrap;color:var(--t2)">${esc(item.phone || '—')}</span>
          <span class="arr" style="color:var(--t0)">→</span>
          <input class="ei s8-tel-input${isMod ? ' mod' : ''}"
            data-ri="${item.rowIdx}"
            data-orig="${esc(item.formattedPhone || '')}"
            value="${esc(displayPhone || '')}"
            style="width:130px;font-family:var(--mono);${inputBorder}color:${inputColor}">
          ${warnBadge}
        </div>
      </td>`;
    } else {
      // Sin cambio, sin inválido — texto estático tenue
      telCell = `<td><span class="mono" style="font-size:11px;color:var(--t2)">${esc(item.phone || '—')}</span></td>`;
    }
  }

  return `<tr class="${item.checked ? 'row-on' : ''}">
    <td><div class="cbc">
      <input type="checkbox" class="s8-row-cb" data-ri="${item.rowIdx}"
        ${item.checked ? 'checked' : ''} ${cbDisabled ? 'disabled title="Asigná un país primero"' : ''}>
    </div></td>
    <td><span class="mono t-dim">${item.rowIdx + 2}</span></td>
    <td><span style="font-size:11px">${esc(item.email)}</span></td>
    ${paisCell}
    ${telCell}
    <td>${srcBadge}</td>
  </tr>`;
}

function _telDigits(phone) { return (phone || '').replace(/\D/g, '').length; }
function _telInvalid(phone) { if (!phone) return false; const n = _telDigits(phone); return n <= 5 || n >= 16; }

function _step8FreqCountry(items) {
  const counts = {};
  for (const item of items) {
    if (item.country?.iso2) {
      if (!counts[item.country.iso2]) counts[item.country.iso2] = { n: 0, c: item.country };
      counts[item.country.iso2].n++;
    }
  }
  return Object.values(counts).sort((a, b) => b.n - a.n)[0]?.c || null;
}

// ════════════════════════════════════════════════════════════
//  RESUMEN FINAL
// ════════════════════════════════════════════════════════════
//  SELECCIÓN DE CAMPOS
// ════════════════════════════════════════════════════════════
const _EDIT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="10" height="10"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;

let _assignOpenForCol = -1;
let _showEmptyCols = false;

export function renderFieldSelect(csv, emailColIdx, selectedColumns, fieldColIdxs, onChange, onAssignColumn) {
  const cont = $('fields-list');
  if (!cont) return;
  const { editorDeletedCols, editorAddedCols } = getState();
  const emptyCol = csv.headers.map((_, i) => csv.rows.every(row => !(row[i] || '').trim()));
  const keepSet = selectedColumns
    ? new Set(selectedColumns)
    : new Set(csv.headers.map((_, i) => i).filter(i => !emptyCol[i]));

  const _fci = fieldColIdxs || {};
  const _allFields = [
    { key: 'email',    label: 'eMail',                    idx: emailColIdx          },
    { key: 'nombre',   label: t('fs.nombre')   || 'Nombre',   idx: _fci.nombre   ?? -1 },
    { key: 'apellido', label: t('fs.apellido') || 'Apellido', idx: _fci.apellido ?? -1 },
    { key: 'empresa',  label: t('fs.empresa')  || 'Empresa',  idx: _fci.empresa  ?? -1 },
    { key: 'tel',      label: t('fs.tel')      || 'Teléfono', idx: _fci.tel      ?? -1 },
    { key: 'pais',     label: t('fs.pais')     || 'País',     idx: _fci.pais     ?? -1 },
  ];

  function rebuild() {
    // ── Confirm strip ──────────────────────────────────────────────
    const strip = $('col-confirm-strip');
    const emptyCount = csv.headers.filter((_, i) => emptyCol[i]).length;
    if (strip) {
      const SEP = `<span style="color:var(--border);margin:0 5px">|</span>`;
      const fieldsHtml = _allFields.map(f => {
        const ok      = f.idx >= 0;
        const colName = ok ? (csv.headers[f.idx]?.trim() || `Col ${f.idx + 1}`) : null;
        const icon    = ok ? '✓' : '○';
        const iconColor = ok ? 'var(--dup)' : 'var(--t3)';
        return `<span style="font-size:11px;white-space:nowrap">` +
          `<span style="color:var(--dup)">${f.label}:</span> ` +
          `<span style="color:var(--t2)">${colName ? esc(colName) : '—'}</span> ` +
          `<span style="color:${iconColor}">${icon}</span>` +
          `</span>`;
      }).join(SEP);
      const emptyBtnHtml = emptyCount > 0
        ? `<button id="btn-toggle-empty" style="font-size:11px;color:#555555;background:#161616;border:1px solid #3B3B3B;cursor:pointer;padding:2px 8px;border-radius:9px;white-space:nowrap;flex-shrink:0">${_showEmptyCols ? t('fs.hide_empty') : t('fs.show_empty') + ' (' + emptyCount + ')'}</button>`
        : '';
      strip.innerHTML = `<div style="display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap;row-gap:4px">
        <div style="flex:1;min-width:180px;display:flex;flex-wrap:wrap;align-items:center;gap:4px 0">
          <span style="font-size:11px;font-weight:600;color:var(--t2);margin-right:6px;white-space:nowrap">${t('fs.matched')} &gt;</span>${fieldsHtml}
        </div>
        ${emptyBtnHtml}
      </div>`;
      $('btn-toggle-empty')?.addEventListener('click', () => {
        _showEmptyCols = !_showEmptyCols;
        rebuild();
      });
    }

    // ── Grid de chips ──────────────────────────────────────────────
    cont.innerHTML = '';
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px';

    const _baseAssign = _allFields.filter(f => f.key !== 'email' && f.idx < 0);
    const _emailField = _allFields.find(f => f.key === 'email');

    const allIdxs = csv.headers.map((_, i) => i);
    const headerOrder = [
      ...allIdxs.filter(i => !emptyCol[i]),
      ...(_showEmptyCols ? allIdxs.filter(i => emptyCol[i]) : []),
    ];

    headerOrder.forEach(i => {
      const h = csv.headers[i];
      const isEmail   = i === emailColIdx;
      const checked   = keepSet.has(i);
      const isEmpty   = emptyCol[i];
      const isDeleted = editorDeletedCols?.has(h) && !editorAddedCols?.has(h);
      const isAdded   = editorAddedCols?.has(h);
      const item = document.createElement('label');
      let borderColor = checked ? (isEmpty ? '#3B3B3B' : 'var(--accent)') : (isEmpty ? '#3B3B3B' : 'var(--border)');
      let bgColor     = isEmpty ? '#161616' : (checked ? 'var(--abg)' : '#161616');
      if (isDeleted) { borderColor = 'var(--red)';  bgColor = 'var(--rbg)'; }
      if (isAdded)   { borderColor = 'var(--warn)'; bgColor = 'var(--wbg)'; }
      item.style.cssText = `display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:var(--rs);border:1px solid ${borderColor};background:${bgColor};cursor:pointer`;
      const nameColor  = isEmpty ? '#555555' : isDeleted ? 'var(--red)' : isAdded ? 'var(--warn)' : checked ? 'var(--t1)' : 'var(--t2)';
      const nameStyle  = isDeleted ? 'text-decoration:line-through' : '';
      const editorBadge = isAdded
        ? `<span style="color:var(--warn);margin-left:auto;display:flex;align-items:center;gap:3px;font-size:10px;flex-shrink:0">${_EDIT_ICON} ADD</span>`
        : isDeleted
        ? `<span style="color:var(--red);margin-left:auto;display:flex;align-items:center;gap:3px;font-size:10px;flex-shrink:0">${_EDIT_ICON} DEL</span>`
        : '';
      const specialLabel =
        isEmail             ? 'email'    :
        i === _fci.nombre   ? 'nombre'   :
        i === _fci.apellido ? 'apellido' :
        i === _fci.empresa  ? 'empresa'  :
        i === _fci.tel      ? 'tel'      :
        i === _fci.pais     ? 'pais'     : null;

      const availableToAssign = (emailColIdx < 0 && i !== emailColIdx && _emailField)
        ? [..._baseAssign, _emailField]
        : _baseAssign;
      const isAssignOpen  = _assignOpenForCol === i;
      const showAssign    = !specialLabel && !isEmpty && !isDeleted && !isAdded && availableToAssign.length > 0;

      function rightSide() {
        if (isDeleted || isAdded) return editorBadge;
        if (specialLabel) {
          const canUnassign = true;
          const badgeText = specialLabel === 'email' ? 'email' : (t(`fs.badge_${specialLabel}`) || specialLabel);
          return `<span class="col-type-badge" data-ci="${i}" style="font-size:10px;color:var(--dup);margin-left:auto;flex-shrink:0;${canUnassign ? 'cursor:pointer' : ''}">${badgeText}${canUnassign ? ' ×' : ''}</span>`;
        }
        if (isAssignOpen) {
          return `<select class="sel-assign" data-ci="${i}" style="font-size:10px;padding:1px 3px;border-radius:var(--rs);border:1px solid var(--border);background:var(--s2);color:var(--t1);margin-left:auto;flex-shrink:0;max-width:90px">
            <option value="">${t('fs.type_ph')}</option>
            ${availableToAssign.map(f => `<option value="${f.key}">${f.label}</option>`).join('')}
          </select>`;
        }
        if (showAssign) return `<button class="btn-assign" data-ci="${i}" style="font-size:10px;color:var(--t2);margin-left:auto;background:none;border:none;cursor:pointer;padding:0 2px;flex-shrink:0;white-space:nowrap">${t('fs.assign')} ▾</button>`;
        if (isEmpty) return `<span style="font-size:10px;color:#555555;margin-left:auto">vacío</span>`;
        return '';
      }

      item.innerHTML = `
        <input type="checkbox" ${checked ? 'checked' : ''} data-ci="${i}" style="accent-color:var(--accent)">
        <span style="font-size:12px;color:${nameColor};${nameStyle}">${esc(h.trim() || `Col ${i + 1}`)}</span>
        ${rightSide()}`;

      item.querySelector('input')?.addEventListener('change', e => {
        if (e.target.checked) keepSet.add(i); else keepSet.delete(i);
        const cols = keepSet.size === csv.headers.length ? null : [...keepSet].sort((a, b) => a - b);
        onChange?.(cols);
        rebuild();
      });
      item.querySelector('.btn-assign')?.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation();
        _assignOpenForCol = i;
        rebuild();
      });
      item.querySelector('.sel-assign')?.addEventListener('change', e => {
        const fieldKey = e.target.value;
        _assignOpenForCol = -1;
        if (fieldKey) onAssignColumn?.(i, fieldKey);
        else rebuild();
      });
      item.querySelector('.col-type-badge')?.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation();
        onAssignColumn?.(parseInt(e.currentTarget.dataset.ci), null);
      });
      grid.appendChild(item);
    });

    // Phantom entries for columns deleted via CSV editor
    if (editorDeletedCols?.size) {
      const currentNames = new Set(csv.headers);
      editorDeletedCols.forEach(name => {
        if (currentNames.has(name)) return;
        if (editorAddedCols?.has(name)) return;
        const item = document.createElement('label');
        item.style.cssText = `display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:var(--rs);border:1px solid var(--red);background:var(--rbg);cursor:not-allowed;opacity:.8`;
        item.innerHTML = `
          <input type="checkbox" disabled class="cb-deleted">
          <span style="font-size:12px;color:var(--red);text-decoration:line-through">${esc(name)}</span>
          <span style="color:var(--red);margin-left:auto;display:flex;align-items:center;gap:3px;font-size:10px;flex-shrink:0">${_EDIT_ICON} DEL</span>`;
        grid.appendChild(item);
      });
    }
    cont.appendChild(grid);
    // Stats box
    const excl        = csv.headers.length - keepSet.size;
    const emptyCnt    = emptyCol.filter(Boolean).length;
    const delCnt      = editorDeletedCols?.size || 0;
    const addCnt      = editorAddedCols?.size   || 0;
    const matchCount   = _allFields.filter(f => f.idx >= 0).length;
    const noMatchCount = _allFields.length - matchCount;
    $('sb-fields').innerHTML = `
      <div class="sum-item"><div class="sum-n dim">${csv.headers.length}</div><div class="sum-l">${t('stat.total_fields')}</div></div>
      <div class="sum-item"><div class="sum-n acc">${keepSet.size}</div><div class="sum-l">${t('stat.included')}</div></div>
      ${excl > 0 ? `<div class="sum-item"><div class="sum-n" style="color:#fff">${excl}</div><div class="sum-l">${t('stat.excluded')}</div></div>` : ''}
      ${emptyCnt > 0 ? `<div class="sum-item"><div class="sum-n" style="color:#3B3B3B">${emptyCnt}</div><div class="sum-l">${t('stat.empty_col')}</div></div>` : ''}
      <div class="sum-item"><div class="sum-n" style="color:var(--dup)">${matchCount}</div><div class="sum-l">Match</div></div>
      ${noMatchCount > 0 ? `<div class="sum-item"><div class="sum-n" style="color:var(--t2)">${noMatchCount}</div><div class="sum-l">No Match</div></div>` : ''}
      ${delCnt > 0 ? `<div class="sum-item"><div class="sum-n" style="color:var(--red)">${delCnt}</div><div class="sum-l">Eliminadas</div></div>` : ''}
      ${addCnt > 0 ? `<div class="sum-item"><div class="sum-n" style="color:var(--warn)">${addCnt}</div><div class="sum-l">Agregadas</div></div>` : ''}`;
  }
  rebuild();
}

// ════════════════════════════════════════════════════════════
//  SELECCIÓN DE FLUJO
// ════════════════════════════════════════════════════════════
const FLOW_GROUP_LABELS = () => ({ email: t('flow.email'), filters: t('flow.filters'), enrichment: t('flow.enrichment'), ai: t('flow.ai'), corregir: t('flow.corregir'), homologar: t('flow.homologar') });

export function renderFlowSelect(enabledSteps, onChange) {
  const cont = $('flow-groups');
  if (!cont) return;
  cont.innerHTML = '';

  // Contenedor horizontal en desktop, vertical en mobile
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px;align-items:stretch';
  cont.appendChild(wrapper);

  // Todos los grupos se renderizan como cards con header, en el orden de FLOW_STEPS
  const groupedGroups = ['email', 'filters', 'corregir', 'homologar'];
  const individualSteps = []; // ya no hay pasos individuales

  const groups = [...new Set(FLOW_STEPS.map(s => s.group))];
  groups.forEach(group => {
    const steps = FLOW_STEPS.filter(s => s.group === group);
    const isEmail   = group === 'email';
    const isFilters = group === 'filters';

    // Grupos 'email' y 'filters' → card con header de grupo
    const card = document.createElement('div');
    card.style.cssText = 'flex:1;min-width:160px;display:flex;flex-direction:column;border:1px solid var(--border);border-radius:var(--rs);padding:10px 12px;background:var(--s2)';

    const title = document.createElement('div');
    title.style.cssText = 'font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--t2);margin-bottom:8px';
    title.textContent = FLOW_GROUP_LABELS()[group] || group;
    card.appendChild(title);

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;flex-direction:column;gap:6px;flex:1';

    if (isEmail) {
      // Checkbox compartido (caja propia, alto completo) + 3 cajas de título (Reglas/Validación/Dominios)
      const anyEnabled = steps.some(s => enabledSteps[s.id] !== false);
      const cbColor    = anyEnabled ? 'var(--t1)' : 'var(--t2)';
      const borderC    = anyEnabled ? 'var(--accent)' : 'var(--border)';
      const bgC        = anyEnabled ? 'var(--abg)' : 'var(--s3)';

      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;align-items:stretch;gap:8px;cursor:pointer';

      const cbBox = document.createElement('div');
      cbBox.style.cssText = `display:flex;align-items:center;justify-content:center;padding:0 12px;border-radius:var(--rs);border:1px solid ${borderC};background:${bgC};flex-shrink:0`;
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = anyEnabled;
      cb.style.cssText = 'accent-color:var(--accent);flex-shrink:0;cursor:pointer';
      cb.addEventListener('change', e => {
        onChange?.(steps.map(s => s.id), e.target.checked);
        renderFlowSelect(getState().enabledSteps, onChange);
      });
      cbBox.appendChild(cb);
      wrap.appendChild(cbBox);

      const labelsCol = document.createElement('div');
      labelsCol.style.cssText = 'display:flex;flex-direction:column;gap:6px;flex:1';
      steps.forEach(step => {
        const lblBox = document.createElement('div');
        lblBox.style.cssText = `padding:8px 12px;border-radius:var(--rs);border:1px solid ${borderC};background:${bgC};font-size:12px;color:${cbColor};font-weight:500`;
        lblBox.textContent = t('step.' + step.id) || step.label;
        labelsCol.appendChild(lblBox);
      });
      wrap.appendChild(labelsCol);

      // Click en cualquier parte del bloque togglea el checkbox compartido
      wrap.addEventListener('click', e => {
        if (e.target === cb) return;
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      });
      row.appendChild(wrap);

    } else {
      // Grupo filters — igual que antes
      steps.forEach(step => {
        const enabled = enabledSteps[step.id] !== false;
        const item = document.createElement('label');
        item.style.cssText = `flex:1;display:flex;align-items:center;justify-content:flex-start;gap:8px;padding:8px 10px;border-radius:var(--rs);border:1px solid ${enabled ? 'var(--accent)' : 'var(--border)'};background:${enabled ? 'var(--abg)' : 'var(--s3)'};cursor:pointer`;
        item.innerHTML = `
          <input type="checkbox" ${enabled ? 'checked' : ''} data-sid="${step.id}" style="accent-color:var(--accent);flex-shrink:0">
          <div style="font-size:12px;color:${enabled ? 'var(--t1)' : 'var(--t2)'};">${t('step.' + step.id) || step.label}</div>`;
        item.querySelector('input').addEventListener('change', e => {
          onChange?.(step.id, e.target.checked);
          renderFlowSelect(getState().enabledSteps, onChange);
        });
        row.appendChild(item);
      });
    }

    card.appendChild(row);
    wrapper.appendChild(card);
  });

  // Pasos individuales (enrichment + ai) en el orden de FLOW_STEPS
  individualSteps.forEach(step => {
    const enabled = enabledSteps[step.id] !== false;
    const card = document.createElement('div');
    card.style.cssText = 'display:flex;flex-direction:column;border:1px solid var(--border);border-radius:var(--rs);padding:10px 12px;background:var(--s2);flex:0 1 auto';
    const item = document.createElement('label');
    item.style.cssText = `flex:1;display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:var(--rs);border:1px solid ${enabled ? 'var(--accent)' : 'var(--border)'};background:${enabled ? 'var(--abg)' : 'var(--s3)'};cursor:pointer`;
    item.innerHTML = `
      <input type="checkbox" ${enabled ? 'checked' : ''} data-sid="${step.id}" style="accent-color:var(--accent);flex-shrink:0">
      <div style="font-size:12px;color:${enabled ? 'var(--t1)' : 'var(--t2)'};">${t('step.' + step.id) || step.label}</div>`;
    item.querySelector('input').addEventListener('change', e => {
      onChange?.(step.id, e.target.checked);
      renderFlowSelect(getState().enabledSteps, onChange);
    });
    card.appendChild(item);
    wrapper.appendChild(card);
  });

  // Stats box
  const emailActive = FLOW_STEPS.filter(s => s.group === 'email').some(s => enabledSteps[s.id] !== false) ? 1 : 0;
  const otherActive = FLOW_STEPS.filter(s => s.group !== 'email' && enabledSteps[s.id] !== false).length;
  const activeCount = emailActive + otherActive;
  const totalMods   = 1 + FLOW_STEPS.filter(s => s.group !== 'email').length;
  $('sb-flow').innerHTML = `
    <div class="sum-item"><div class="sum-n dim">${totalMods}</div><div class="sum-l">${t('stat.modules')}</div></div>
    <div class="sum-item"><div class="sum-n acc">${activeCount}</div><div class="sum-l">${t('stat.active')}</div></div>
    <div class="sum-item"><div class="sum-n" style="color:var(--t2)">${totalMods - activeCount}</div><div class="sum-l">${t('stat.skipped')}</div></div>`;
}

// ════════════════════════════════════════════════════════════
//  ANÁLISIS CSV
// ════════════════════════════════════════════════════════════
export function renderAnalysis(stats, suggested) {
  const sbEl   = $('sb-analysis');
  const listEl = $('analysis-list');
  const siEl   = $('si-analysis');
  if (!listEl) return;

  if (sbEl) sbEl.innerHTML = `
    <div class="sum-item"><div class="sum-n dim">${stats.total}</div><div class="sum-l">${t('stat.rows')}</div></div>
    <div class="sum-item"><div class="sum-n" style="color:var(--red)">${stats.fixTotal}</div><div class="sum-l">${t('stat.fix_rows')}</div></div>
    <div class="sum-item"><div class="sum-n" style="color:var(--t2)">${stats.okTotal}</div><div class="sum-l">${t('stat.ok_rows')}</div></div>
    <div class="sum-item"><div class="sum-n acc">${stats.issuesTotal}</div><div class="sum-l">${t('stat.issue_count')}</div></div>`;

  const chip = on => on
    ? `<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:rgba(0,229,180,.08);color:var(--accent);border:1px solid rgba(0,229,180,.3)">${t('analysis.enabled')}</span>`
    : `<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:var(--s3);color:var(--t2);border:1px solid var(--border)">${t('analysis.skip_chip')}</span>`;

  const countEl = val => val > 0
    ? `<div class="sum-n acc" style="min-width:32px;text-align:right">${val}</div>`
    : `<div class="sum-n dim" style="min-width:32px;text-align:right">0</div>`;

  const makeRow = (icon, label, detail, count, stepId) => `
    <div style="display:flex;align-items:center;gap:14px;padding:10px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:15px;width:20px;text-align:center;flex-shrink:0">${icon}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:500;color:var(--t1)">${label}</div>
        <div style="font-size:11px;color:var(--t2);margin-top:1px">${esc(detail)}</div>
      </div>
      <div style="display:flex;align-items:center;gap:12px;flex-shrink:0">
        ${countEl(count)}
        ${chip(stepId === 'validation' ? (suggested.validation || suggested.domains) : suggested[stepId])}
      </div>
    </div>`;

  const emailCount = stats.emailFormat + stats.emailDomain;
  const emailDetail = [
    stats.emailFormat > 0 && t('analysis.with_format', stats.emailFormat),
    stats.emailDomain > 0 && t('analysis.with_domain', stats.emailDomain),
  ].filter(Boolean).join(' · ') || t('analysis.no_issues');

  const companyDetail = stats.company.hasCol
    ? ([
        stats.company.empty > 0 && t('analysis.empty_f', stats.company.empty),
        stats.company.junk  > 0 && t('analysis.junk', stats.company.junk),
      ].filter(Boolean).join(' · ') || t('analysis.no_issues'))
    : t('analysis.no_col');

  const countryDetail = (stats.country.hasCol || stats.phone.hasCol)
    ? ([
        stats.country.emptyPais > 0 && t('analysis.empty_countries', stats.country.emptyPais),
        stats.phone.totalTel    > 0 && t('analysis.phones_fmt', stats.phone.totalTel),
      ].filter(Boolean).join(' · ') || t('analysis.no_issues'))
    : t('analysis.no_country');

  const nameDetail = (stats.nombre.hasCol || stats.apellido.hasCol)
    ? ([
        stats.nombre.empty   > 0 && t('analysis.empty_names', stats.nombre.empty),
        stats.apellido.empty > 0 && t('analysis.empty_surnames', stats.apellido.empty),
      ].filter(Boolean).join(' · ') || t('analysis.no_issues'))
    : t('analysis.no_names');

  const homolDetail = (stats.homolog?.cols || 0) > 0
    ? t('analysis.homol_detail', stats.homolog.cols, stats.homolog.uniqueTotal)
    : t('analysis.no_homol');

  const tagDetail = stats.tagCol?.hasCol
    ? (stats.tagCol?.colName ? `Columna "${stats.tagCol.colName}" detectada` : t('analysis.tag_col_found'))
    : t('analysis.no_tag_col');

  const rows = [
    makeRow('✉',  t('res.validation'),        emailDetail,                                            emailCount,                                               'validation'),
    makeRow('🔁', t('res.duplicates'),        t('analysis.dup_rows', stats.duplicates),               stats.duplicates,                                         'duplicates'),
    makeRow('🔑', t('res.keywords'),          t('analysis.kw_rows', stats.keywords),                  stats.keywords,                                           'keywords'),
    makeRow('🤖', t('step.nameai'),           nameDetail,                                             (stats.nombre.empty||0) + (stats.apellido.empty||0),      'nameai'),
    makeRow('🏢', t('res.company'),           companyDetail,                                          stats.company.total,                                      'company'),
    makeRow('🌍', t('res.country'),           countryDetail,                                          (stats.country.emptyPais||0) + (stats.phone.totalTel||0), 'country'),
    makeRow('📋', t('res.homol'),             homolDetail,                                            stats.homolog?.uniqueTotal || 0,                          'fieldhomol'),
    makeRow('🏷', t('step.fieldtags') || 'Etiquetas', tagDetail,                                     0,                                                        'fieldtags'),
  ];
  // Quitar border-bottom de la última fila para evitar doble línea con el step-bar
  rows[rows.length - 1] = rows[rows.length - 1].replace('border-bottom:1px solid var(--border)', 'border-bottom:none');
  listEl.innerHTML = rows.join('');

  const emailOn    = suggested.validation || suggested.domains ? 1 : 0;
  const activeCount = emailOn + ['duplicates','keywords','company','country','nameai','fieldhomol','fieldtags'].filter(k => suggested[k]).length;
  const totalMods  = 8;
  if (siEl) siEl.textContent = t('analysis.modules_lbl', activeCount, totalMods);
}

// ════════════════════════════════════════════════════════════
//  PASO 10 — HOMOLOGACIÓN DE CAMPOS
// ════════════════════════════════════════════════════════════
let _homoCallbacks   = {};
let _homoSrcOpen         = true;   // Campos fuente: expanded by default
let _homoPromptGenOpen   = false;  // Prompt generador librería
let _homoPromptMatchOpen = false;  // Prompt homologación por fila
let _homoLibEditorOpen   = false;  // Editor de biblioteca inline
let _homoLibsListOpen    = false;  // Lista completa de bibliotecas
let _homoFilter          = 'todas'; // Filtro activo en resultados

export function renderStep9({
  csv, colIdx,
  homoSrcCols = [], homoTargetMode = 'new', homoTargetName = '', homoTargetColIdx = -1,
  homoLibraries = [], homoLibEntries = [], homoLibName = '',
  homoSelectedLibId = '',
  homoResults = [],
  homoSessions = [],
  homoSessionCount = 0,
  aiProviders = [], selectedProviderId10 = '', aiStatus10 = 'idle',
  homoPromptGen = '', homoPromptMatch = '',
  onSrcColToggle, onTargetModeChange, onTargetNameChange, onTargetColChange,
  onLibSelect,
  onEditCanonical, onAddVariant, onRemoveVariant, onAddCanonical, onDeleteCanonical,
  onLibNameChange, onSaveLib,
  onNewLib, onEditLib, onDeleteLib,
  onGenLibWithAI, onApplyVariants, onRunHomolog, onCancelHomolog, onApply, onSkip, onOtro,
  onSavePromptGen, onSavePromptMatch,
  onEditCanonicalResult, onRender,
  onProvider10Change, onRetryHomo,
}) {
  _homoCallbacks = {
    onSrcColToggle, onTargetModeChange, onTargetNameChange, onTargetColChange,
    onLibSelect,
    onEditCanonical, onAddVariant, onRemoveVariant, onAddCanonical, onDeleteCanonical,
    onLibNameChange, onSaveLib,
    onNewLib, onEditLib, onDeleteLib,
    onGenLibWithAI, onApplyVariants, onRunHomolog, onCancelHomolog, onApply, onSkip, onOtro,
    onSavePromptGen, onSavePromptMatch,
    onEditCanonicalResult, onRender, onRetryHomo,
  };
  _renderC10AIStatus(aiStatus10, aiProviders, selectedProviderId10, onProvider10Change);
  _updateSB10Homo(homoResults, { homoSrcCols, csv, homoLibraries, homoSelectedLibId, homoLibEntries });
  _renderC10Body({ csv, colIdx, homoSrcCols, homoTargetMode, homoTargetName, homoTargetColIdx,
    homoLibraries, homoLibEntries, homoLibName, homoSelectedLibId,
    homoPromptGen, homoPromptMatch, homoSessions });
  _renderC10Results({ homoResults, homoSrcCols, csv });
  _renderC10Actions({ homoResults, homoLibEntries, homoSrcCols, homoTargetMode, homoTargetName, homoTargetColIdx, homoSessionCount });
}

function _renderC10AIStatus(status, providers, selectedId, onProviderChange) {
  const el = $('c10-ai-status');
  if (!el) return;

  const selStyle = 'background:transparent;border:none;color:inherit;font-size:13px;font-family:var(--sans);font-weight:500;cursor:pointer;outline:none;max-width:320px';
  const selHtml = providers.length
    ? `<select id="c10-provider-select" style="${selStyle}">
        ${providers.map(p => `<option value="${esc(p.id)}"${p.id === selectedId ? ' selected' : ''}>${esc(p.label)} · ${esc(p.model)}</option>`).join('')}
       </select>`
    : `<span style="font-size:13px">${t('ai.no_providers')}</span>`;

  if (status === 'checking') {
    el.innerHTML = `<div class="ollama-banner ollama-checking" style="display:flex;align-items:center;gap:10px">
      <span class="ollama-dot ollama-dot-checking"></span>
      ${selHtml}
      <span style="font-size:11px;color:var(--t2);margin-left:2px">${t('ai.checking')}</span>
    </div>`;
  } else if (status === 'ok') {
    el.innerHTML = `<div class="ollama-banner ollama-ok" style="display:flex;align-items:center;gap:10px">
      <span class="ollama-dot ollama-dot-ok"></span>
      ${selHtml}
      <span style="font-size:11px;color:var(--accent);margin-left:2px">${t('ai.connected')}</span>
    </div>`;
  } else if (status === 'cold') {
    el.innerHTML = `<div class="ollama-banner ollama-ok" style="display:flex;align-items:center;gap:10px">
      <span class="ollama-dot" style="background:var(--warn)"></span>
      ${selHtml}
      <span style="font-size:11px;color:var(--warn);margin-left:2px">${t('ai.cold')}</span>
    </div>`;
  } else {
    const model = providers.find(p => p.id === selectedId)?.model || '';
    el.innerHTML = `<div class="ollama-banner ollama-error">
      <div class="ollama-err-hdr" style="display:flex;align-items:center;gap:10px">
        <span class="ollama-dot ollama-dot-err"></span>
        ${selHtml}
        <span style="font-size:11px;color:var(--red);margin-left:2px">${t('ai.no_response')}</span>
      </div>
      <div class="ollama-instructions">
        ${model ? `<code>ollama run ${esc(model)}</code>` : ''}
        <button class="btn btn-g btn-xs" id="btn-retry-homo">${t('ai.retry')}</button>
      </div>
    </div>`;
    $('btn-retry-homo')?.addEventListener('click', () => _homoCallbacks.onRetryHomo?.());
  }

  $('c10-provider-select')?.addEventListener('change', e => onProviderChange?.(e.target.value));
}

function _updateSB10Homo(homoResults, { homoSrcCols = [], csv, homoLibraries = [], homoSelectedLibId = '', homoLibEntries = [] } = {}) {
  const sb = $('sb10');
  if (!sb) return;
  if (!homoSrcCols.length) { sb.innerHTML = ''; return; }

  let statsHtml = '';
  if (homoResults.length) {
    const totalAll    = homoResults.reduce((a, r) => a + r.rowIdxs.length, 0);
    const variantRows = homoResults.filter(r => r.status === 'js-match' && r.canonical).reduce((a, r) => a + r.rowIdxs.length, 0);
    const iaRows      = homoResults.filter(r => r.status === 'done'     && r.canonical).reduce((a, r) => a + r.rowIdxs.length, 0);
    const manualRows  = homoResults.filter(r => r.status === 'manual'   && r.canonical).reduce((a, r) => a + r.rowIdxs.length, 0);
    const vaciosRows  = homoResults.filter(r => !r.canonical).reduce((a, r) => a + r.rowIdxs.length, 0);
    const completados = variantRows + iaRows + manualRows;
    statsHtml = `
      <div class="sum-item"><div class="sum-n dim">${totalAll}</div><div class="sum-l">Total</div></div>
      ${variantRows ? `<div class="sum-item"><div class="sum-n" style="color:var(--accent)">${variantRows}</div><div class="sum-l">${t('homol.lbl_variante') || 'Variante'}</div></div>` : ''}
      <div class="sum-item"><div class="sum-n" style="color:var(--ai)">${iaRows}</div><div class="sum-l">IA</div></div>
      <div class="sum-item"><div class="sum-n" style="color:var(--warn)">${manualRows}</div><div class="sum-l">${t('stat.manual') || 'Manual'}</div></div>
      ${vaciosRows  ? `<div class="sum-item"><div class="sum-n" style="color:var(--t2)">${vaciosRows}</div><div class="sum-l">Vacíos</div></div>` : ''}
      <div class="sum-item"><div class="sum-n dim">${completados}</div><div class="sum-l">Completados</div></div>`;
  }

  sb.innerHTML = statsHtml;
}

function _renderC10Body({ csv, colIdx, homoSrcCols, homoTargetMode, homoTargetName, homoTargetColIdx,
  homoLibraries, homoLibEntries, homoLibName, homoSelectedLibId,
  homoPromptGen, homoPromptMatch, homoSessions }) {
  const el = $('c10-body');
  if (!el || !csv) return;
  const _twrapScroll = el.querySelector('.twrap')?.scrollTop || 0;

  // ── Sesiones completadas (read-only) ──────────────────────
  // Las sesiones completadas se renderizan en #homo-sessions-container (DOM externo), no aquí.


  // ── Campos fuente ─────────────────────────────────────────
  const srcCols = csv.headers.map((h, i) => ({ h, i })).filter(({ i }) => {
    if (i === colIdx) return false;
    return csv.rows.some(row => (row[i] ?? '').toString().trim() !== '');
  });
  const _homoColor = (FIELD_COLORS[0])[0];
  const colChips = srcCols.map(({ h, i }) => {
    const isSelected = homoSrcCols.indexOf(i) !== -1;
    const chipStyle  = isSelected ? `border-color:${_homoColor};color:${_homoColor};background:${_homoColor}18` : '';
    return `<span class="col-chip" style="${chipStyle}"><label>
      <input type="radio" name="homo-src-col" data-ci="${i}" ${isSelected ? 'checked' : ''}><span>${esc(h.trim() || `Col ${i+1}`)}</span>
    </label></span>`;
  }).join('');

  // ── Campo destino ─────────────────────────────────────────
  const targetCols = csv.headers.map((h, i) =>
    `<option value="${i}"${homoTargetColIdx === i ? ' selected' : ''}>${esc(h)}</option>`
  ).join('');

  // ── Librería ──────────────────────────────────────────────
  const homoLibs   = [...(homoLibraries || [])].sort((a, b) => a.name.localeCompare(b.name));
  const selLib     = homoLibs.find(l => (l.id || l.name) === homoSelectedLibId);
  const libOptions = homoLibs.length
    ? homoLibs.map(l => `<option value="${esc(l.id || l.name)}"${(l.id || l.name) === homoSelectedLibId ? ' selected' : ''}>${esc(l.name)} (${t('homol.lbl_canonicos', (l.entries || []).length) || `${(l.entries || []).length} canónicos`})</option>`).join('')
    : `<option value="">${t('homol.no_libs') || '— Sin bibliotecas —'}</option>`;

  // ── Editor inline ─────────────────────────────────────────
  const entries       = homoLibEntries || [];
  const totalVariants = entries.reduce((a, e) => a + (e.variants || []).length, 0);
  const editorRows    = entries.map((entry, idx) => {
    const varChips = (entry.variants || []).map((v, vi) =>
      `<span style="display:inline-flex;align-items:center;gap:2px;background:var(--s3);border:1px solid var(--border);border-radius:8px;padding:1px 6px;font-size:11px;font-family:var(--mono)">
        ${esc(v)}<button class="homo-rm-variant" data-idx="${idx}" data-vi="${vi}" style="background:transparent;border:none;cursor:pointer;color:var(--t3);font-size:11px;padding:0 1px;line-height:1">×</button>
      </span>`
    ).join('');
    return `<tr>
      <td style="padding:5px 8px;vertical-align:middle">
        <input class="ei homo-canonical-inp" data-idx="${idx}" value="${esc(entry.canonical)}" style="min-width:120px;font-weight:500;font-size:12px">
      </td>
      <td style="padding:5px 8px">
        <div style="display:flex;flex-wrap:wrap;gap:3px;align-items:center">
          ${varChips}
          <input class="homo-add-var-inp ei" data-idx="${idx}" placeholder="+ variante" style="min-width:70px;font-size:11px;padding:2px 5px">
          <button class="homo-add-var-btn btn btn-g btn-xs" data-idx="${idx}" style="padding:2px 6px">+</button>
        </div>
      </td>
      <td style="padding:5px 6px;text-align:right"><button class="homo-del-entry btn btn-g btn-xs" data-idx="${idx}" style="color:var(--red)">✕</button></td>
    </tr>`;
  }).join('');

  // ── Prompt collapsibles ───────────────────────────────────
  const promptGenBody   = _homoPromptGenOpen   ? 'block' : 'none';
  const promptMatchBody = _homoPromptMatchOpen ? 'block' : 'none';
  const togLblGen   = _homoPromptGenOpen   ? `&#x25BE; ${t('homol.hide') || 'Ocultar'}` : `&#x25B8; ${t('homol.btn_view') || 'Ver'}`;
  const togLblMatch = _homoPromptMatchOpen ? `&#x25BE; ${t('homol.hide') || 'Ocultar'}` : `&#x25B8; ${t('homol.btn_view') || 'Ver'}`;
  const viewLibsLbl = _homoLibsListOpen ? (t('homol.hide_libs') || '&#x2039; Ocultar') : (t('homol.view_libs', homoLibs.length) || `&#x203A; Ver todas (${homoLibs.length})`);

  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:0">

      <!-- CAMPOS FUENTE — siempre visible, sin toggle -->
      <div class="homo-section">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
          <span style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--t2)">${t('homol.src_title') || 'Campos fuente'}</span>
          <span style="font-size:11px;color:var(--t3);text-transform:none;letter-spacing:0">${t('homol.src_hint') || '(seleccioná uno o más)'}</span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${colChips || `<span style="font-size:12px;color:var(--t2)">${t('homol.src_empty') || 'No hay columnas disponibles'}</span>`}
        </div>
      </div>

      <!-- CAMPO DESTINO — título y selectores en la misma línea -->
      <div class="homo-section">
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
          <span style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--t2);white-space:nowrap">${t('homol.target_title') || 'Campo destino'}</span>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;white-space:nowrap">
            <input type="radio" name="homo-target-mode" value="new" ${homoTargetMode === 'new' ? 'checked' : ''} style="accent-color:var(--accent)">
            ${t('homol.target_new') || 'Nuevo campo'}
            <input type="text" id="homo-target-name" placeholder="Nombre…" value="${esc(homoTargetName)}"
              style="display:${homoTargetMode === 'new' ? 'inline-block' : 'none'};margin-left:6px;width:180px;font-size:12px;background:transparent;color:var(--accent);border:1px solid var(--border);border-radius:var(--rs);padding:3px 8px;outline:none">
          </label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;white-space:nowrap">
            <input type="radio" name="homo-target-mode" value="existing" ${homoTargetMode === 'existing' ? 'checked' : ''} style="accent-color:var(--accent)">
            ${t('homol.target_existing') || 'Campo existente'}
            <select id="homo-target-col" style="display:${homoTargetMode === 'existing' ? 'inline-block' : 'none'};margin-left:6px">${targetCols}</select>
          </label>
        </div>
      </div>

      <!-- LIBRERÍA -->
      <div class="homo-section">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--t2);margin-bottom:8px">${t('homol.lib_section') || 'Librería de campos homologados'}</div>

        <!-- PROMPT GENERADOR — fondo transparente, solo borde -->
        <div style="margin-bottom:10px;padding:8px 10px;background:transparent;border-radius:6px;border:1px solid var(--border)">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--t2)">${t('homol.prompt_gen_lbl') || 'Prompt — Generador de librería IA'}</span>
            <button class="btn btn-g btn-xs" id="btn-prompt-gen-toggle">${togLblGen}</button>
          </div>
          <div id="homo-prompt-gen-body" style="display:${promptGenBody};margin-top:8px">
            <textarea id="homo-prompt-gen-ta" style="width:100%;height:110px;font-family:var(--mono);font-size:11px;line-height:1.5;background:var(--s2);border:1px solid var(--border);border-radius:var(--rs);color:var(--t0);padding:8px;resize:vertical;outline:none;box-sizing:border-box">${esc(homoPromptGen || '')}</textarea>
            <div style="display:flex;gap:6px;margin-top:6px">
              <button class="btn btn-g btn-xs" id="btn-prompt-gen-reset">${t('homol.btn_restore') || 'Restaurar'}</button>
              <button class="btn btn-p btn-xs" id="btn-prompt-gen-save">${t('homol.btn_save') || 'Guardar'}</button>
            </div>
          </div>
        </div>

        <!-- Biblioteca: botones + Seleccionar en la misma línea -->
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
          <span style="font-size:12px;color:var(--t2)">${t('libs.library_lbl') || 'Biblioteca'}:</span>
          <button class="btn btn-g btn-sm" id="btn-homo-new-manual" style="font-size:12px">${t('homol.btn_new_manual') || 'Nueva manual'}</button>
          <button class="btn btn-g btn-sm" id="btn-homo-new-ia" style="font-size:12px">${t('homol.btn_new_ia') || 'Nueva IA'}</button>
          ${homoLibs.length ? `<button class="btn btn-g btn-xs" id="btn-homo-view-libs" data-count="${homoLibs.length}" style="font-size:11px">${viewLibsLbl}</button>` : ''}
          <span style="flex:1"></span>
          <span style="font-size:12px;color:var(--t2)">${t('homol.btn_select') || 'Seleccionar:'}</span>
          <select id="homo-lib-sel" style="min-width:200px">
            <option value="">Librería para homologar campos</option>
            ${homoLibs.map(l => `<option value="${esc(l.id || l.name)}"${(l.id || l.name) === homoSelectedLibId ? ' selected' : ''}>${esc(l.name)} (${(l.entries || []).length} canónicos)</option>`).join('')}
          </select>
          ${selLib ? `<button class="btn btn-g btn-xs homo-lib-edit" data-lid="${esc(selLib.id || selLib.name)}" style="font-size:11px">${t('homol.btn_edit') || 'Editar'}</button>` : ''}
        </div>

        <!-- Lista completa desplegable -->
        <div id="homo-libs-list" style="display:${_homoLibsListOpen ? '' : 'none'};margin-bottom:8px">
          <div style="display:flex;flex-direction:column;gap:4px;max-height:160px;overflow-y:auto">
            ${homoLibs.map(l => `
              <div style="display:flex;align-items:center;gap:8px;padding:4px 6px;background:var(--s3);border-radius:6px;font-size:12px">
                <span style="flex:1;color:var(--t1)">${esc(l.name)}</span>
                <span style="color:var(--t3);font-size:11px">${t('homol.lbl_canonicos', (l.entries || []).length) || `${(l.entries || []).length} canónicos`}</span>
                <button class="btn btn-g btn-xs homo-lib-edit" data-lid="${esc(l.id || l.name)}" style="font-size:10px;padding:1px 6px">${t('homol.btn_edit') || 'Editar'}</button>
                <button class="btn btn-xs homo-lib-del" data-lid="${esc(l.id || l.name)}" style="font-size:10px;padding:1px 6px;background:rgba(255,90,90,.08);color:var(--warn);border-color:rgba(255,90,90,.2)">${t('homol.btn_delete') || 'Eliminar'}</button>
              </div>`).join('')}
          </div>
        </div>

        <!-- Editor inline -->
        <div id="homo-lib-editor" style="display:${_homoLibEditorOpen ? '' : 'none'};margin-top:12px;padding:10px;background:var(--s3);border-radius:8px;border:1px solid var(--border)">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">
            <input type="text" id="homo-lib-name-inp" placeholder="${t('homol.lib_name_ph') || 'Nombre de la biblioteca'}" value="${esc(homoLibName || '')}"
              style="flex:1;min-width:160px;font-size:12px">
            <span style="font-size:11px;color:var(--t2)">${t('homol.lbl_canonicos', entries.length) || `${entries.length} canónicos`} · ${totalVariants} ${t('homol.col_variants') || 'variantes'}</span>
          </div>
          <div class="twrap" style="max-height:300px;overflow-y:auto">
            <table style="width:100%;border-collapse:separate;border-spacing:0;font-size:12px">
              <thead style="position:sticky;top:0;z-index:10;isolation:isolate">
                <tr><th style="min-width:130px">${t('homol.col_canonical') || 'Canónico'}</th><th>${t('homol.col_variants') || 'Variantes'}</th><th style="width:36px"></th></tr>
              </thead>
              <tbody>${editorRows || `<tr><td colspan="3" style="padding:14px;text-align:center;color:var(--t2);font-size:12px">${t('homol.no_canonicals') || 'Sin canónicos todavía'}</td></tr>`}</tbody>
            </table>
          </div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:8px">
            <button class="btn btn-g btn-xs" id="homo-add-canonical">${t('homol.btn_add_canonical') || '+ Canónico'}</button>
            <span style="flex:1"></span>
            <button class="btn btn-g btn-sm" id="btn-c10-close-editor">${t('homol.collapse') || 'Cancelar'}</button>
            <button class="btn btn-p btn-sm" id="btn-c10-save-lib">${t('homol.btn_save_lib') || 'Guardar biblioteca'}</button>
          </div>
        </div>
      </div>

      <!-- PROMPT HOMOLOGACIÓN — caja con fondo gris -->
      <div class="homo-section">
        <div style="padding:8px 10px;background:var(--s3);border-radius:6px;border:1px solid var(--border)">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--t2)">${t('homol.prompt_match_lbl') || 'Prompt — Homologación por fila IA'}</span>
            <button class="btn btn-g btn-xs" id="btn-prompt-match-toggle">${togLblMatch}</button>
          </div>
          <div id="homo-prompt-match-body" style="display:${promptMatchBody};margin-top:8px">
            <textarea id="homo-prompt-match-ta" style="width:100%;height:110px;font-family:var(--mono);font-size:11px;line-height:1.5;background:var(--s2);border:1px solid var(--border);border-radius:var(--rs);color:var(--t0);padding:8px;resize:vertical;outline:none;box-sizing:border-box">${esc(homoPromptMatch || '')}</textarea>
            <div style="display:flex;gap:6px;margin-top:6px">
              <button class="btn btn-g btn-xs" id="btn-prompt-match-reset">${t('homol.btn_restore') || 'Restaurar'}</button>
              <button class="btn btn-p btn-xs" id="btn-prompt-match-save">${t('homol.btn_save') || 'Guardar'}</button>
            </div>
          </div>
        </div>
      </div>

      <!-- ACCIONES PASO 1 / PASO 2 + FILTROS -->
      <div class="homo-section" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;border-bottom:none">
        <span style="font-size:11px;color:var(--t2)">${t('homol.step1') || 'PASO 1'}</span>
        <button class="btn btn-p btn-sm" id="btn-c10-apply-variants">${t('homol.btn_apply_variants') || 'Variante'}</button>
        <span style="color:var(--border);font-size:14px">|</span>
        <span style="font-size:11px;color:var(--t2)">${t('homol.step2') || 'PASO 2'}</span>
        <button class="btn btn-p btn-sm" id="btn-c10-run-homolog">${_CHIP_SVG} IA</button>
        <button class="btn btn-g btn-sm" id="btn-c10-cancel-homolog" style="display:none">${t('homol.collapse') || 'Cancelar'}</button>
        <span style="flex:1"></span>
        <div id="homo-filter-bar" style="display:flex;gap:4px;flex-wrap:wrap">
          ${['todas','vacios','completo','variante','ia','manual'].map(f => {
            const lbl = f === 'todas' ? 'Todas' : f === 'vacios' ? 'Vacíos' : f === 'completo' ? 'Completo' : f === 'variante' ? 'Variante' : f === 'ia' ? 'IA' : 'Manual';
            return `<button class="fb${_homoFilter === f ? ' on' : ''}" data-hf="${f}" style="font-size:10px;padding:2px 8px">${lbl}</button>`;
          }).join('')}
        </div>
      </div>

    </div>`;

  if (_twrapScroll) { const tw = el.querySelector('.twrap'); if (tw) tw.scrollTop = _twrapScroll; }

  // ── Events ────────────────────────────────────────────────
  el.querySelectorAll('input[name="homo-src-col"]').forEach(r =>
    r.addEventListener('change', e => _homoCallbacks.onSrcColToggle?.(+e.target.dataset.ci))
  );

  // Target mode — radio + inline input swap
  el.querySelectorAll('input[name="homo-target-mode"]').forEach(r =>
    r.addEventListener('change', e => {
      $('homo-target-name').style.display   = e.target.value === 'new'      ? 'inline-block' : 'none';
      $('homo-target-col').style.display    = e.target.value === 'existing' ? 'inline-block' : 'none';
      _homoCallbacks.onTargetModeChange?.(e.target.value);
    })
  );
  $('homo-target-name')?.addEventListener('input', e => _homoCallbacks.onTargetNameChange?.(e.target.value));
  $('homo-target-col')?.addEventListener('change', e => _homoCallbacks.onTargetColChange?.(+e.target.value));

  // Library selector
  $('homo-lib-sel')?.addEventListener('change', e => _homoCallbacks.onLibSelect?.(e.target.value));
  el.querySelectorAll('.homo-lib-edit').forEach(btn =>
    btn.addEventListener('click', () => { _homoLibEditorOpen = true; _homoCallbacks.onEditLib?.(btn.dataset.lid); })
  );
  el.querySelectorAll('.homo-lib-del').forEach(btn =>
    btn.addEventListener('click', () => _homoCallbacks.onDeleteLib?.(btn.dataset.lid))
  );
  $('btn-homo-new-manual')?.addEventListener('click', () => { _homoLibEditorOpen = true; _homoCallbacks.onNewLib?.(); });
  $('btn-homo-new-ia')?.addEventListener('click',     () => _homoCallbacks.onGenLibWithAI?.());
  $('btn-homo-view-libs')?.addEventListener('click', () => {
    _homoLibsListOpen = !_homoLibsListOpen;
    const list = $('homo-libs-list');
    const btn  = $('btn-homo-view-libs');
    if (list) list.style.display = _homoLibsListOpen ? '' : 'none';
    if (btn) {
      const count = btn.dataset.count || '';
      btn.innerHTML = _homoLibsListOpen ? '▲ Ocultar' : `▶ Ver todas (${count})`;
    }
  });

  // Library editor
  $('homo-lib-name-inp')?.addEventListener('input', e => _homoCallbacks.onLibNameChange?.(e.target.value));
  el.querySelectorAll('.homo-canonical-inp').forEach(inp =>
    inp.addEventListener('change', e => _homoCallbacks.onEditCanonical?.(+e.target.dataset.idx, e.target.value.trim()))
  );
  el.querySelectorAll('.homo-rm-variant').forEach(btn =>
    btn.addEventListener('click', () => _homoCallbacks.onRemoveVariant?.(+btn.dataset.idx, +btn.dataset.vi))
  );
  const addVar = (inp) => {
    const val = (inp?.value || '').trim();
    if (val) { _homoCallbacks.onAddVariant?.(+inp.dataset.idx, val); inp.value = ''; }
  };
  el.querySelectorAll('.homo-add-var-btn').forEach(btn =>
    btn.addEventListener('click', () => addVar(el.querySelector(`.homo-add-var-inp[data-idx="${btn.dataset.idx}"]`)))
  );
  el.querySelectorAll('.homo-add-var-inp').forEach(inp =>
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') addVar(inp); })
  );
  $('homo-add-canonical')?.addEventListener('click',     () => _homoCallbacks.onAddCanonical?.());
  $('btn-c10-save-lib')?.addEventListener('click',       () => _homoCallbacks.onSaveLib?.());
  $('btn-c10-close-editor')?.addEventListener('click',   () => { _homoLibEditorOpen = false; _homoCallbacks.onRender?.(); });

  // Prompts gen
  $('btn-prompt-gen-toggle')?.addEventListener('click', () => {
    _homoPromptGenOpen = !_homoPromptGenOpen;
    const body = $('homo-prompt-gen-body');
    const btn  = $('btn-prompt-gen-toggle');
    if (body) body.style.display = _homoPromptGenOpen ? 'block' : 'none';
    if (btn)  btn.innerHTML = _homoPromptGenOpen ? '&#x25BE; Ocultar' : '&#x25B8; Ver';
  });
  $('btn-prompt-gen-save')?.addEventListener('click',  () => _homoCallbacks.onSavePromptGen?.($('homo-prompt-gen-ta')?.value));
  $('btn-prompt-gen-reset')?.addEventListener('click', () => _homoCallbacks.onSavePromptGen?.(null));

  // Prompts match
  $('btn-prompt-match-toggle')?.addEventListener('click', () => {
    _homoPromptMatchOpen = !_homoPromptMatchOpen;
    const body = $('homo-prompt-match-body');
    const btn  = $('btn-prompt-match-toggle');
    if (body) body.style.display = _homoPromptMatchOpen ? 'block' : 'none';
    if (btn)  btn.innerHTML = _homoPromptMatchOpen ? '&#x25BE; Ocultar' : '&#x25B8; Ver';
  });
  $('btn-prompt-match-save')?.addEventListener('click',  () => _homoCallbacks.onSavePromptMatch?.($('homo-prompt-match-ta')?.value));
  $('btn-prompt-match-reset')?.addEventListener('click', () => _homoCallbacks.onSavePromptMatch?.(null));

  // Paso 1 / Paso 2
  $('btn-c10-apply-variants')?.addEventListener('click',  () => _homoCallbacks.onApplyVariants?.());
  $('btn-c10-run-homolog')?.addEventListener('click',     () => _homoCallbacks.onRunHomolog?.());
  $('btn-c10-cancel-homolog')?.addEventListener('click',  () => _homoCallbacks.onCancelHomolog?.());

  // Filtros de resultados
  $('homo-filter-bar')?.querySelectorAll('button[data-hf]').forEach(btn =>
    btn.addEventListener('click', e => {
      _homoFilter = e.target.dataset.hf;
      $('homo-filter-bar')?.querySelectorAll('button[data-hf]').forEach(b => b.classList.toggle('on', b.dataset.hf === _homoFilter));
      _homoCallbacks.onRender?.();
    })
  );
}

export function setHomoLibEditorOpen(open) { _homoLibEditorOpen = open; }

function _renderC10Results({ homoResults, homoSrcCols, csv }) {
  const el = $('c10-results');
  if (!el) return;
  if (!homoResults?.length) { el.innerHTML = ''; return; }

  // Keep original index (ri) for data-ri binding on inputs
  const indexedResults = homoResults.map((r, ri) => ({ r, ri })).filter(({ r }) => {
    if (_homoFilter === 'vacios')   return !r.canonical;
    if (_homoFilter === 'completo') return  !!r.canonical;
    if (_homoFilter === 'variante') return r.status === 'js-match';
    if (_homoFilter === 'ia')       return r.status === 'done' && !!r.canonical;
    if (_homoFilter === 'manual')   return r.status === 'manual' && !!r.canonical;
    return true;
  });

  const srcHeaders = (homoSrcCols || []).map(fi => (csv?.headers[fi]) || `Campo ${fi + 1}`);
  const colHdrs    = srcHeaders.map((h, idx) => {
    const color = (FIELD_COLORS[idx % FIELD_COLORS.length] || FIELD_COLORS[0])[0];
    return `<th style="color:${color}">${esc(h)}</th>`;
  }).join('');
  const resultRows = indexedResults.map(({ r, ri }) => {
    const srcCells    = (r.srcValues || []).map(v => `<td><span class="mono t-dim" style="font-size:11px">${esc(v || '—')}</span></td>`).join('');
    const statusBadge =
      r.status === 'js-match' ? `<span class="tag tag-var">{V}</span>` :
      r.status === 'done'     ? (r.canonical ? `<span class="tag tag-ia">IA</span>` : `<span style="color:var(--t3);font-size:10px">—</span>`) :
      r.status === 'manual'   ? (r.canonical ? `<span class="tag tag-man">✎</span>` : `<span style="color:var(--t3);font-size:10px">—</span>`) :
      `<span style="color:var(--t3);font-size:10px">—</span>`;
    const rowNums = r.rowIdxs.length <= 3
      ? r.rowIdxs.map(i => i + 2).join(', ')
      : `${r.rowIdxs[0]+2}…(${r.rowIdxs.length})`;
    return `<tr>
      <td><span class="mono t-dim" style="font-size:10px">${esc(rowNums)}</span></td>
      ${srcCells}
      <td><input class="ei homo-result-canon" data-ri="${ri}" value="${esc(r.canonical || '')}" placeholder="—" style="min-width:110px;font-size:12px;font-weight:500;color:${r.canonical ? (r.status === 'manual' ? 'var(--warn)' : r.status === 'done' ? 'var(--ai)' : 'var(--accent)') : (r.status === 'manual' ? 'var(--t2)' : 'var(--t3)')}"></td>
      <td>${statusBadge}</td>
    </tr>`;
  }).join('');

  // Preserve scroll position of the table wrapper across re-renders
  const prevScroll = el.querySelector('.twrap')?.scrollTop || 0;
  el.innerHTML = `
    <div style="margin-top:2px">
      <div class="twrap" style="max-height:420px;overflow-y:auto">
        <table style="width:100%;border-collapse:separate;border-spacing:0;font-size:12px">
          <thead style="position:sticky;top:0;z-index:10;isolation:isolate">
            <tr><th style="min-width:54px;font-size:10px">Fila(s)</th>${colHdrs}<th>→ Canónico</th><th style="width:44px">Est.</th></tr>
          </thead>
          <tbody>${resultRows}</tbody>
        </table>
      </div>
    </div>`;
  const newTwrap = el.querySelector('.twrap');
  if (newTwrap && prevScroll) newTwrap.scrollTop = prevScroll;

  el.querySelectorAll('.homo-result-canon').forEach(inp =>
    inp.addEventListener('change', e => _homoCallbacks.onEditCanonicalResult?.(+e.target.dataset.ri, e.target.value.trim()))
  );
}

export function renderC10ResultsOnly({ homoResults, homoSrcCols, csv }) {
  _renderC10Results({ homoResults, homoSrcCols, csv });
}

/**
 * Actualiza una sola fila de resultados sin reconstruir la tabla.
 * Preserva cualquier edición manual en curso en otros inputs.
 * Retorna false si la fila no existe en el DOM (fallback a full render necesario).
 */
export function updateC10ResultRow(ri, result) {
  const inp = document.querySelector(`.homo-result-canon[data-ri="${ri}"]`);
  if (!inp) return false;
  // No sobrescribir si el usuario está escribiendo en este input
  if (document.activeElement !== inp) {
    inp.value = result.canonical || '';
    inp.style.color = result.canonical
      ? (result.status === 'manual' ? 'var(--warn)' : result.status === 'done' ? 'var(--ai)' : 'var(--accent)')
      : (result.status === 'manual' ? 'var(--t2)' : 'var(--t3)');
  }
  // Actualizar badge de estado (el td siguiente al td del input)
  const badgeTd = inp.closest('td')?.nextElementSibling;
  if (badgeTd) {
    badgeTd.innerHTML =
      result.status === 'js-match' ? `<span class="tag tag-var">{V}</span>`
      : result.status === 'manual' ? (result.canonical ? `<span class="tag tag-man">✎</span>` : `<span style="color:var(--t3);font-size:10px">—</span>`)
      : result.status === 'done'   ? (result.canonical ? `<span class="tag tag-ia">IA</span>` : `<span style="color:var(--t3);font-size:10px">—</span>`)
      : `<span style="color:var(--t3);font-size:10px">—</span>`;
  }
  return true;
}

function _renderC10Actions({ homoResults, homoLibEntries, homoSrcCols, homoTargetMode, homoTargetName, homoTargetColIdx, homoSessionCount } = {}) {
  const el = $('c10-actions');
  if (!el) return;
  const svgArr       = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>`;
  const hasResults   = (homoResults || []).some(r => r.canonical);
  const validTarget  = homoSrcCols?.length > 0 &&
    (homoTargetMode === 'new' ? (homoTargetName || '').trim().length > 0 : (homoTargetColIdx ?? -1) >= 0);
  const canOtro      = hasResults && validTarget;
  const canContinuar = (hasResults && validTarget) || (homoSessionCount || 0) > 0;
  el.innerHTML = `
    <button class="btn btn-skip btn-sm" id="btn-skip10">${t('misc.skip') || 'Omitir'}</button>
    <button class="btn btn-sm" id="btn-otro10" style="border:1px solid var(--accent);color:var(--accent);background:transparent"${!canOtro ? ' disabled' : ''}>${t('misc.otro') || 'Otro'} ▼</button>
    <button class="btn btn-p btn-sm" id="btn-next10"${!canContinuar ? ' disabled' : ''}>${t('misc.continuar') || 'Continuar'} ${svgArr}</button>`;
  $('btn-skip10')?.addEventListener('click',  () => _homoCallbacks.onSkip?.());
  $('btn-otro10')?.addEventListener('click',  () => _homoCallbacks.onOtro?.());
  $('btn-next10')?.addEventListener('click',  () => _homoCallbacks.onApply?.());
}


// ════════════════════════════════════════════════════════════
//  PASO 9 — COMPLETAR NOMBRE/APELLIDO CON IA
// ════════════════════════════════════════════════════════════
let _step9Callbacks = {};
let _step9PromptOpen = false;
let _s10Filter  = 'vacios';
let _s10Items   = [];
let _s10HasName = false;
let _s10HasApell = false;

function _updateSB10(items, hasName, hasApell) {
  const sb = $('sb9');
  if (!sb) return;
  const sinNombre      = items.filter(i => i.needsNom  && !i.editNombre).length;
  const sinApellido    = items.filter(i => i.needsApell && !i.editApellido).length;
  const aProcesar      = sinNombre + sinApellido;
  const nombresIA      = items.filter(i => i.needsNom   && i.aiNombre   && i.editNombre   === i.aiNombre).length;
  const apellidosIA    = items.filter(i => i.needsApell && i.aiApellido && i.editApellido === i.aiApellido).length;
  const nombresManual  = items.filter(i => i.editNombre   && i.editNombre   !== (i.origNombre||'')   && i.editNombre   !== (i.aiNombre||'')   && !i.nombreCaseModified).length;
  const apellidosManual= items.filter(i => i.editApellido && i.editApellido !== (i.origApellido||'') && i.editApellido !== (i.aiApellido||'') && !i.apellidoCaseModified).length;
  const caseNombres    = items.filter(i => !!i.nombreCaseModified).length;
  const caseApellidos  = items.filter(i => !!i.apellidoCaseModified).length;
  const totalCase      = caseNombres + caseApellidos;
  const totalCompletados = nombresIA + apellidosIA + nombresManual + apellidosManual + totalCase;
  sb.innerHTML = `
    <div class="sum-item"><div class="sum-n dim">${aProcesar}</div><div class="sum-l">${t('stat.to_process')}</div></div>
    ${hasName  ? `<div class="sum-item"><div class="sum-n" style="color:var(--red)">${sinNombre}</div><div class="sum-l">${t('stat.no_name')}</div></div>`   : ''}
    ${hasApell ? `<div class="sum-item"><div class="sum-n" style="color:var(--red)">${sinApellido}</div><div class="sum-l">${t('stat.no_surname')}</div></div>` : ''}
    ${hasName  ? `<div class="sum-item"><div class="sum-n" style="color:var(--ai)">${nombresIA}</div><div class="sum-l">${t('stat.ai_names')}</div></div>`   : ''}
    ${hasApell ? `<div class="sum-item"><div class="sum-n" style="color:var(--ai)">${apellidosIA}</div><div class="sum-l">${t('stat.ai_surnames')}</div></div>` : ''}
    ${hasName  ? `<div class="sum-item"><div class="sum-n" style="color:var(--warn)">${nombresManual}</div><div class="sum-l">${t('stat.manual_names')}</div></div>`   : ''}
    ${hasApell ? `<div class="sum-item"><div class="sum-n" style="color:var(--warn)">${apellidosManual}</div><div class="sum-l">${t('stat.manual_surnames')}</div></div>` : ''}
    ${totalCase > 0 ? `<div class="sum-item"><div class="sum-n" style="color:var(--t2)">${totalCase}</div><div class="sum-l">Case</div></div>` : ''}
    ${totalCompletados > 0 ? `<div class="sum-item"><div class="sum-n fmtc">${totalCompletados}</div><div class="sum-l">${t('stat.completed')}</div></div>` : ''}`;
}

function _renderC9FilterBar(items) {
  const atb = $('atb9');
  if (!atb) return;

  const _hasIA     = i => (i.aiNombre   && i.editNombre   === i.aiNombre)   || (i.aiApellido && i.editApellido === i.aiApellido);
  const _hasManual = i =>
    (i.editNombre   && i.editNombre   !== (i.origNombre||'')   && i.editNombre   !== (i.aiNombre||'')   && !i.nombreCaseModified) ||
    (i.editApellido && i.editApellido !== (i.origApellido||'') && i.editApellido !== (i.aiApellido||'') && !i.apellidoCaseModified);

  const counts = {
    all_rows:    items.length,
    vacios:      items.filter(i => i.needsCompletion).length,
    completados: items.filter(i => _hasIA(i) || _hasManual(i) || i.caseModified).length,
    ia:          items.filter(i => _hasIA(i)).length,
    manual:      items.filter(i => _hasManual(i)).length,
    case:        items.filter(i => i.caseModified).length,
  };

  const defs = [
    { id: 'all_rows',    label: t('filter.all') || 'Todos' },
    { id: 'vacios',      label: 'Vacío' },
    { id: 'completados', label: 'Completo' },
    { id: 'ia',          label: 'IA' },
    { id: 'manual',      label: t('stat.manual') || 'Manual' },
    { id: 'case',        label: 'Case' },
  ];

  const cnt = id => `<span style="opacity:.65;font-size:10px;margin-left:2px">${counts[id]}</span>`;

  // Botones de acción a la izquierda, filtros a la derecha
  atb.innerHTML = `
    <span style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--t2);white-space:nowrap">${t('homol.step1') || 'PASO 1'}</span>
    <button class="btn btn-p btn-sm" id="btn-s10-lower-cap" style="white-space:nowrap">Aa Case</button>
    <span style="color:var(--border);font-size:14px;margin:0 2px">|</span>
    <span style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--t2);white-space:nowrap">${t('homol.step2') || 'PASO 2'}</span>
    <button class="btn btn-p btn-sm" id="btn-nameai-analyze-bar">${_CHIP_SVG} IA</button>
    <span style="flex:1"></span>
    ${defs.map(f => `<button class="fb${_s10Filter === f.id ? ' on' : ''}" data-s10f="${f.id}">${f.label}${cnt(f.id)}</button>`).join('')}`;

  atb.querySelectorAll('[data-s10f]').forEach(b => {
    b.onclick = () => {
      _s10Filter = b.dataset.s10f;
      atb.querySelectorAll('[data-s10f]').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      _renderC9TableOnly(_s10Items, _s10HasName, _s10HasApell);
    };
  });
  $('btn-s10-lower-cap')?.addEventListener('click', () => _step9Callbacks.onLowerCapAll?.());
  $('btn-nameai-analyze-bar')?.addEventListener('click', () => {
    const ta = $('c9-prompt-ta');
    const { aiPrompt } = getState?.() || {};
    _step9Callbacks.onAnalyze?.(ta ? ta.value : (aiPrompt || ''));
  });
}

function _applyS10Filter(items) {
  const _hasIA     = i => (i.aiNombre   && i.editNombre   === i.aiNombre)   || (i.aiApellido && i.editApellido === i.aiApellido);
  const _hasManual = i =>
    (i.editNombre   && i.editNombre   !== (i.origNombre||'')   && i.editNombre   !== (i.aiNombre||'')   && !i.nombreCaseModified) ||
    (i.editApellido && i.editApellido !== (i.origApellido||'') && i.editApellido !== (i.aiApellido||'') && !i.apellidoCaseModified);
  if (_s10Filter === 'vacios')      return items.filter(i => i.needsCompletion);
  if (_s10Filter === 'completados') return items.filter(i => _hasIA(i) || _hasManual(i) || i.caseModified);
  if (_s10Filter === 'ia')          return items.filter(i => _hasIA(i));
  if (_s10Filter === 'manual')      return items.filter(i => _hasManual(i));
  if (_s10Filter === 'case')        return items.filter(i => i.caseModified);
  return items; // 'all_rows' = Todos (y cualquier otro valor)
}

function _renderC9TableOnly(nameaiItems, hasName, hasApell) {
  const { onCheckNombre, onCheckApellido, onEditNombre, onEditApellido, onAnalyze, onCancel } = _step9Callbacks;
  const tableEl = $('c9-table');
  if (!tableEl) return;

  if (nameaiItems.length === 0) {
    tableEl.innerHTML = `<div class="empty"><div class="empty-ico">✓</div><div class="empty-msg">${t('empty.all_complete')}</div></div>`;
    return;
  }

  const filtered = _applyS10Filter(nameaiItems);

  const nameHdr  = hasName  ? `<th><div class="cbc" style="gap:6px"><input type="checkbox" id="ca-nombre"><span style="font-weight:600;font-size:11px">${t('nameai.col_nombre')}</span></div></th>`   : '';
  const apellHdr = hasApell ? `<th><div class="cbc" style="gap:6px"><input type="checkbox" id="ca-apellido"><span style="font-weight:600;font-size:11px">${t('nameai.col_apellido')}</span></div></th>` : '';
  const thead = `<thead><tr><th>${t('country.row')}</th><th>${t('country.email')}</th>${nameHdr}${apellHdr}</tr></thead>`;

  const tbody = document.createElement('tbody');
  filtered.forEach(item => {
    const origIdx = nameaiItems.indexOf(item);
    const tr = document.createElement('tr');
    const errDot = item.status === 'error' ? `<span style="color:var(--red);font-size:9px;margin-left:4px">error</span>` : '';

    const makeCell = (checked, value, field) => {
      const aiVal        = field === 'nombre' ? item.aiNombre   : item.aiApellido;
      const origVal      = field === 'nombre' ? item.origNombre : item.origApellido;
      const fieldCaseMod = field === 'nombre' ? item.nombreCaseModified : item.apellidoCaseModified;
      const isAI         = !!aiVal && value === aiVal;
      const isMod        = !!value && value !== (origVal || '') && value !== (aiVal || '');
      const isCase       = !isAI && !!fieldCaseMod;
      const isManual     = !isAI && !isCase && isMod;
      const inpStyle     = isAI ? ';color:var(--ai)' : isCase ? ';color:var(--t2)' : isMod ? ';color:var(--warn)' : '';
      const iconHtml     = isAI     ? `<span class="tag tag-ia">IA</span>`
                         : isManual ? `<span class="tag tag-man">✎</span>`
                         : isCase   ? `<span class="tag tag-case">Aa</span>`
                         : '';
      return `<td style="white-space:nowrap">
        <div class="cbc" style="gap:6px;align-items:center">
          <input type="checkbox" data-field="${field}" ${checked ? 'checked' : ''} style="flex-shrink:0">
          <input class="ei" data-field="${field}" placeholder="—" value="${esc(value)}" style="min-width:90px${inpStyle}">
          <span style="display:inline-flex;align-items:center;justify-content:center;min-width:28px;flex-shrink:0">${iconHtml}</span>
        </div>
      </td>`;
    };

    const nameCell  = hasName  ? makeCell(item.nombreChecked,   item.editNombre,   'nombre')   : '';
    const apellCell = hasApell ? makeCell(item.apellidoChecked, item.editApellido, 'apellido') : '';

    tr.innerHTML = `
      <td><span class="mono t-dim">${item.rowIdx + 2}</span></td>
      <td>
        <span class="t-orig">${esc(item.email)}</span>${errDot}
        ${item.empresa ? `<div style="font-size:10px;color:var(--t2);margin-top:1px;line-height:1.2">${esc(item.empresa)}</div>` : ''}
      </td>
      ${nameCell}${apellCell}`;

    tr.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', e => {
        if (e.target.dataset.field === 'nombre')   onCheckNombre?.(origIdx, e.target.checked);
        if (e.target.dataset.field === 'apellido') onCheckApellido?.(origIdx, e.target.checked);
      });
    });
    tr.querySelectorAll('input.ei').forEach(inp => {
      inp.addEventListener('input', e => {
        const field = e.target.dataset.field;
        const val   = e.target.value;
        if (field === 'nombre')   onEditNombre?.(origIdx, val);
        if (field === 'apellido') onEditApellido?.(origIdx, val);
        const ai      = field === 'nombre' ? item.aiNombre   : item.aiApellido;
        const orig    = field === 'nombre' ? item.origNombre : item.origApellido;
        const caseMod = field === 'nombre' ? item.nombreCaseModified : item.apellidoCaseModified;
        const isAI2     = !!ai && val === ai;
        const isMod2    = !!val && val !== (orig || '') && val !== (ai || '');
        const isManual2 = !isAI2 && !caseMod && isMod2;
        const isCase2   = !isAI2 && !!caseMod;
        e.target.style.color = isAI2 ? 'var(--ai)' : isCase2 ? 'var(--t2)' : isMod2 ? 'var(--warn)' : '';
        const iconHtml2 = isAI2     ? `<span class="tag tag-ia">IA</span>`
                        : isManual2 ? `<span class="tag tag-man">✎</span>`
                        : isCase2   ? `<span class="tag tag-case">Aa</span>`
                        : '';
        const iconSpan = e.target.parentElement?.querySelector('span[style*="min-width:28px"]');
        if (iconSpan) iconSpan.innerHTML = iconHtml2;
        _updateSB10(_s10Items, _s10HasName, _s10HasApell);
      });
    });
    tbody.appendChild(tr);
  });

  if (!filtered.length) {
    tableEl.innerHTML = `<div class="empty"><div class="empty-ico">✓</div><div class="empty-msg">${t('empty.no_filter_dot')}</div></div>`;
  } else {
    tableEl.innerHTML = `<div class="twrap" style="max-height:450px;overflow-y:auto"><table>${thead}</table></div>`;
    tableEl.querySelector('table').appendChild(tbody);
  }

  // Select-all por columna — solo sobre filas que necesitan completar
  const caN = $('ca-nombre');
  const caA = $('ca-apellido');
  if (caN) {
    const total = nameaiItems.filter(i => i.needsNom).length;
    const sel   = nameaiItems.filter(i => i.nombreChecked).length;
    caN.checked       = total > 0 && sel === total;
    caN.indeterminate = sel > 0 && sel < total;
    caN.addEventListener('change', e => {
      nameaiItems.forEach((item, i) => { item.nombreChecked = e.target.checked; onCheckNombre?.(i, e.target.checked); });
      _renderC9TableOnly(nameaiItems, hasName, hasApell);
      _renderC9FilterBar(nameaiItems);
    });
  }
  if (caA) {
    const total = nameaiItems.filter(i => i.needsApell).length;
    const sel   = nameaiItems.filter(i => i.apellidoChecked).length;
    caA.checked       = total > 0 && sel === total;
    caA.indeterminate = sel > 0 && sel < total;
    caA.addEventListener('change', e => {
      nameaiItems.forEach((item, i) => { item.apellidoChecked = e.target.checked; onCheckApellido?.(i, e.target.checked); });
      _renderC9TableOnly(nameaiItems, hasName, hasApell);
      _renderC9FilterBar(nameaiItems);
    });
  }
}

export function renderStep10({ nameaiItems, nameaiIdx, apellaiIdx, aiPrompt,
  tableOnly = false,
  onAnalyze, onCancel, onCheckNombre, onCheckApellido, onEditNombre, onEditApellido, onRetryOllama, onSavePrompt,
  onLowerCapAll }) {
  _step9Callbacks = { onAnalyze, onCancel, onCheckNombre, onCheckApellido, onEditNombre, onEditApellido, onRetryOllama, onSavePrompt, onLowerCapAll };

  const hasName  = nameaiIdx >= 0;
  const hasApell = apellaiIdx >= 0;

  // Stats box — siempre actualizar, incluso durante procesamiento tableOnly
  _updateSB10(nameaiItems, hasName, hasApell);

  if (!tableOnly) {
    // Editor de prompt
    const actionEl = $('c9-action');
    if (actionEl) {
      const noFields  = !hasName && !hasApell;
      const promptVal = esc(aiPrompt || '');
      const bodyDisp  = _step9PromptOpen ? 'block' : 'none';
      const toggleLbl = _step9PromptOpen ? `&#x25BE; ${t('misc.hide_prompt')}` : `&#x25B8; ${t('misc.view_prompt')}`;
      actionEl.innerHTML = `
        <div class="c9-prompt-wrap">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <span style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--t2)">${t('nameai.prompt_lbl')} <span style="color:var(--t2);text-transform:none;letter-spacing:0">— placeholders: <code style="font-family:var(--mono);background:var(--s3);padding:1px 5px;border-radius:3px">{{EMAIL}}</code> <code style="font-family:var(--mono);background:var(--s3);padding:1px 5px;border-radius:3px">{{NOMBRE}}</code> <code style="font-family:var(--mono);background:var(--s3);padding:1px 5px;border-radius:3px">{{APELLIDO}}</code></span></span>
            <button class="btn btn-g btn-xs" id="btn-prompt-toggle">${toggleLbl}</button>
          </div>
          <div id="c9-prompt-body" style="display:${bodyDisp}">
            <textarea id="c9-prompt-ta" style="width:100%;height:120px;font-family:var(--mono);font-size:11px;line-height:1.55;background:var(--s2);border:1px solid var(--border);border-radius:var(--rs);color:var(--t0);padding:10px;resize:vertical;outline:none">${promptVal}</textarea>
            <div style="display:flex;gap:6px;margin-top:6px">
              <button class="btn btn-g btn-xs" id="btn-prompt-reset">${t('misc.restore')}</button>
              <button class="btn btn-p btn-xs" id="btn-prompt-save">${t('misc.save')}</button>
            </div>
          </div>
        </div>`;

      $('btn-prompt-toggle')?.addEventListener('click', () => {
        _step9PromptOpen = !_step9PromptOpen;
        const body = $('c9-prompt-body');
        const btn  = $('btn-prompt-toggle');
        if (body) body.style.display = _step9PromptOpen ? 'block' : 'none';
        if (btn)  btn.innerHTML = _step9PromptOpen ? `&#x25BE; ${t('misc.hide_prompt')}` : `&#x25B8; ${t('misc.view_prompt')}`;
      });
      $('btn-prompt-save')?.addEventListener('click', () => {
        const ta = $('c9-prompt-ta');
        if (ta) onSavePrompt?.(ta.value);
      });
      $('btn-prompt-reset')?.addEventListener('click', () => onSavePrompt?.(null));
    }
  }

  // Guardar estado para que filtros y re-renders posteriores funcionen
  _s10Items    = nameaiItems;
  _s10HasName  = hasName;
  _s10HasApell = hasApell;

  _renderC9FilterBar(nameaiItems);
  _renderC9TableOnly(nameaiItems, hasName, hasApell);
}

export function renderStep10OllamaStatus(status, providers = [], selectedId = '', onProviderChange) {
  const el = $('c9-ollama-status');
  if (!el) return;

  const selStyle = 'background:transparent;border:none;color:inherit;font-size:13px;font-family:var(--sans);font-weight:500;cursor:pointer;outline:none;max-width:320px';
  const selHtml = providers.length
    ? `<select id="c9-provider-select" style="${selStyle}">
        ${providers.map(p => `<option value="${esc(p.id)}"${p.id === selectedId ? ' selected' : ''}>${esc(p.label)} · ${esc(p.model)}</option>`).join('')}
       </select>`
    : `<span style="font-size:13px">${t('ai.no_providers')}</span>`;

  const analyzeBtn = $('btn-nameai-analyze-bar');

  if (status === 'checking') {
    el.innerHTML = `<div class="ollama-banner ollama-checking" style="display:flex;align-items:center;gap:10px">
      <span class="ollama-dot ollama-dot-checking"></span>
      ${selHtml}
      <span style="font-size:11px;color:var(--t2);margin-left:2px">${t('ai.checking')}</span>
    </div>`;
  } else if (status === 'ok') {
    el.innerHTML = `<div class="ollama-banner ollama-ok" style="display:flex;align-items:center;gap:10px">
      <span class="ollama-dot ollama-dot-ok"></span>
      ${selHtml}
      <span style="font-size:11px;color:var(--accent);margin-left:2px">${t('ai.connected')}</span>
    </div>`;
    if (analyzeBtn) analyzeBtn.disabled = false;
  } else if (status === 'cold') {
    el.innerHTML = `<div class="ollama-banner ollama-ok" style="display:flex;align-items:center;gap:10px">
      <span class="ollama-dot" style="background:var(--warn)"></span>
      ${selHtml}
      <span style="font-size:11px;color:var(--warn);margin-left:2px">${t('ai.cold')}</span>
    </div>`;
    if (analyzeBtn) analyzeBtn.disabled = false;
  } else {
    const model = providers.find(p => p.id === selectedId)?.model || '';
    el.innerHTML = `<div class="ollama-banner ollama-error">
      <div class="ollama-err-hdr" style="display:flex;align-items:center;gap:10px">
        <span class="ollama-dot ollama-dot-err"></span>
        ${selHtml}
        <span style="font-size:11px;color:var(--red);margin-left:2px">${t('ai.no_response')}</span>
      </div>
      <div class="ollama-instructions">
        ${model ? `<code>ollama run ${esc(model)}</code>` : ''}
        <button class="btn btn-g btn-xs" id="btn-retry-ollama">${t('ai.retry')}</button>
      </div>
    </div>`;
    $('btn-retry-ollama')?.addEventListener('click', () => _step9Callbacks.onRetryOllama?.());
    if (analyzeBtn) analyzeBtn.disabled = true;
  }

  $('c9-provider-select')?.addEventListener('change', e => onProviderChange?.(e.target.value));
}


export function renderStep9ProgressThinking() {
  const panel = $('c10-progress');
  if (!panel) return;
  panel.innerHTML = `
    <div style="margin:6px 0 2px">
      <div style="height:5px;background:var(--border);border-radius:3px;overflow:hidden;position:relative">
        <div style="position:absolute;height:100%;width:35%;background:var(--accent);border-radius:3px;animation:c10-thinking 1.2s ease-in-out infinite alternate"></div>
      </div>
      <div style="font-size:11px;color:var(--t2);margin-top:4px">${t('ai.processing')}</div>
    </div>`;
}

export function renderStep9Progress(current, total) {
  const panel = $('c10-progress');
  if (!panel) return;
  if (!total) { panel.innerHTML = ''; return; }
  const p = Math.round(current / total * 100);
  panel.innerHTML = `
    <div style="margin:6px 0 2px;display:flex;align-items:center;gap:10px">
      <div style="flex:1">
        <div style="height:5px;background:var(--border);border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${p}%;background:var(--accent);border-radius:3px;transition:width 0.25s"></div>
        </div>
        <div style="font-size:11px;color:var(--t2);margin-top:4px">${t('ai.applying', current, total, p)}</div>
      </div>
      <button id="btn-c10-progress-cancel" class="btn btn-xs" style="flex-shrink:0;color:var(--red);border:1px solid var(--red);background:transparent">${t('misc.cancel') || 'Cancelar'}</button>
    </div>`;
  $('btn-c10-progress-cancel')?.addEventListener('click', () => _homoCallbacks.onCancelHomolog?.());
}

export function renderStep10Progress(current, total) {
  const panel = $('c9-progress');
  if (!panel) return;
  const p = total > 0 ? Math.round(current / total * 100) : 0;
  panel.innerHTML = `
    <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
      <div style="flex:1;min-width:160px">
        <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${p}%;background:var(--accent);transition:width 0.25s"></div>
        </div>
        <div style="font-size:11px;color:var(--t2);margin-top:4px">${current} de ${total} · ${p}%</div>
      </div>
      <button class="btn btn-xs" id="btn-nameai-cancel" style="flex-shrink:0;color:var(--red);border:1px solid var(--red);background:transparent">${t('misc.cancel')}</button>
    </div>`;
  $('btn-nameai-cancel')?.addEventListener('click', () => _step9Callbacks.onCancel?.());
}

// ════════════════════════════════════════════════════════════
//  RESUMEN FINAL
// ════════════════════════════════════════════════════════════
export function renderSummary({ stats, finalRows, changeLog, dupLog, testLog, insights, csv, colIdx, fieldSelectedCols = [], homoSessionSummaries = [], tagGlobalTag = '' }) {
  const { filename, editorDeletedCols, editorAddedCols } = getState();

  // Helper seguro: asigna solo si el elemento existe
  const set = (id, fn) => { const el = $(id); if (el) fn(el); };

  set('res-filename', el => el.textContent = filename);

  // Score de calidad
  const problemRows = new Set([
    ...getState().valItems.map(v => v.rowIdx),
    ...getState().domItems.map(d => d.rowIdx),
  ]).size + stats.dupRemoved + (stats.testRemoved || 0);
  const score = Math.max(0, Math.round((1 - problemRows / (stats.total || 1)) * 100));
  const color = score >= 90 ? 'var(--accent)' : score >= 70 ? 'var(--warn)' : 'var(--red)';

  set('score-ring', ring => {
    const circ = 213.6;
    ring.style.stroke           = color;
    ring.style.strokeDashoffset = circ;
    setTimeout(() => { ring.style.strokeDashoffset = circ - (circ * score / 100); }, 100);
  });
  set('score-pct',   el => { el.textContent = score + '%'; el.style.color = color; });
  const grade = score >= 95 ? t('res.excellent') : score >= 85 ? t('res.good') : score >= 70 ? t('res.regular') : t('res.low');
  set('score-grade', el => { el.textContent = `${t('res.quality')} ${grade}`; el.style.color = color; });
  set('score-desc',  el => el.textContent = t('res.score_desc', problemRows, stats.total, stats.finalRows));

  // Insights de aprendizaje
  const insightHtml = insights?.length
    ? insights.map(i => `<div class="insight insight-${i.type}">
        <span class="insight-ico">${i.type === 'warn' ? '⚠' : i.type === 'good' ? '✓' : 'ℹ'}</span>
        <span>${esc(i.msg)}</span>
      </div>`).join('')
    : '';
  set('res-insights', el => {
    el.innerHTML = insightHtml;
    el.style.display = insightHtml ? 'flex' : 'none';
  });

  // Tabla resumen
  const T = stats.total;
  const bar = (n, color) => `<div class="rbar-bg"><div class="rbar-fg" style="width:${T > 0 ? Math.round(n/T*100) : 0}%;background:${color}"></div></div>`;
  const valSubParts = [
    stats.valInvalidos  > 0 && `${t('filter.invalid')} ${stats.valInvalidos}`,
    stats.valAcentos    > 0 && `${t('filter.translit')} ${stats.valAcentos}`,
    stats.valMayusculas > 0 && `${t('filter.uppercase')} ${stats.valMayusculas}`,
    stats.valEspacios   > 0 && `${t('filter.spaces')} ${stats.valEspacios}`,
  ].filter(Boolean).join(' · ') || t('res.val_default');
  const domProviderStr = stats.domByProvider
    ? Object.entries(stats.domByProvider).filter(([,v]) => v > 0).map(([k,v]) => `${k} ${v}`).join(' · ')
    : 'gmail, hotmail, outlook, yahoo';
  const testSub = stats.testPatternCounts?.length
    ? stats.testPatternCounts.map(({ pattern, count }) => `${pattern} ${count}`).join(' · ')
    : t('res.removed_lbl');
  const testRow = (stats.testRemoved > 0) ? `
    <div class="res-row"><div class="res-row-ico" style="background:rgba(255,170,0,.1)">⚠</div>
      <div class="res-row-label">Eliminación por palabra clave<div class="res-row-sub">${testSub}</div></div>
      <div class="res-row-bar">${bar(stats.testRemoved,'var(--warn)')}</div><div class="res-row-pct">${pct(stats.testRemoved,T)}</div><div class="res-row-num" style="color:var(--warn)">${stats.testRemoved}</div>
    </div>` : '';
  const compSubParts = [
    stats.companyTotal        > 0 && `${stats.companyTotal} ${t('res.analyzed_m')}`,
    stats.companyEmpty        > 0 && `${stats.companyEmpty} ${t('res.empty_f')}`,
    stats.companyAutoCleared  > 0 && `${stats.companyAutoCleared} ${t('res.auto_cleared_f')}`,
    stats.companyHomologated  > 0 && `${stats.companyHomologated} ${t('res.homologated_f')}`,
    stats.companyManual       > 0 && `${stats.companyManual} ${t('res.manual_m')}`,
  ].filter(Boolean).join(' · ');
  const compRow = (stats.companyEdited > 0) ? `
    <div class="res-row"><div class="res-row-ico" style="background:rgba(100,180,255,.1)">🏢</div>
      <div class="res-row-label">Empresa normalizada<div class="res-row-sub">${compSubParts || '—'}</div></div>
      <div class="res-row-bar">${bar(stats.companyEdited,'var(--accent)')}</div><div class="res-row-pct">${pct(stats.companyEdited,T)}</div><div class="res-row-num" style="color:var(--accent)">${stats.companyEdited}</div>
    </div>` : '';
  const countryTotal = (stats.paisAuto || 0) + (stats.paisManual || 0) + (stats.telAuto || 0) + (stats.telManual || 0);
  const hasCountryData = (stats.analizadas8 || 0) > 0;
  const paisParts = t('res.pais_sub', stats.paisAuto || 0, stats.paisManual || 0, stats.paisVacio || 0, stats.paisInvalido || 0, stats.paisValidos || 0);
  const telParts  = t('res.pais_sub', stats.telAuto  || 0, stats.telManual  || 0, stats.telVacio  || 0, stats.telInvalido  || 0, stats.telValidos  || 0);
  const countrySubParts = t('res.country_sub', paisParts, telParts);
  const countryRow = hasCountryData ? `
    <div class="res-row"><div class="res-row-ico" style="background:rgba(130,200,255,.1)">🌍</div>
      <div class="res-row-label">País / Teléfono<div class="res-row-sub">${countrySubParts || '—'}</div></div>
      <div class="res-row-bar">${bar(countryTotal,'var(--accent)')}</div><div class="res-row-pct">${pct(countryTotal,T)}</div><div class="res-row-num" style="color:var(--accent)">${countryTotal}</div>
    </div>` : '';
  const { enabledSteps } = getState();
  const _skip = (ico, label, sub) =>
    `<div class="res-row" style="opacity:.35">
      <div class="res-row-ico" style="background:var(--s2);color:var(--t2)">${ico}</div>
      <div class="res-row-label" style="color:var(--t2)">${label}<div class="res-row-sub">${t('res.skipped_suffix')}${sub ? ' · ' + sub : ''}</div></div>
      <div class="res-row-bar"></div><div class="res-row-pct" style="color:var(--t2)">—</div><div class="res-row-num" style="color:var(--t2)">—</div>
    </div>`;

  const rulesRow = enabledSteps.rules === false
    ? _skip('⚙', t('res.rules'), null)
    : `<div class="res-row"><div class="res-row-ico" style="background:rgba(160,160,160,.08)">⚙</div>
        <div class="res-row-label">${t('res.rules')}<div class="res-row-sub">${stats.customRulesCount} custom · ${stats.customWLCount} ${t('res.valid_domains')}</div></div>
        <div class="res-row-bar"></div><div class="res-row-pct" style="color:var(--t2)">—</div><div class="res-row-num" style="color:var(--t2)">${stats.customRulesCount + stats.customWLCount}</div>
      </div>`;
  const valRow = enabledSteps.validation === false
    ? _skip('✍️', t('res.validation'), null)
    : `<div class="res-row"><div class="res-row-ico" style="background:var(--fbg)">✍️</div>
        <div class="res-row-label">${t('res.validation')}<div class="res-row-sub">${valSubParts}</div></div>
        <div class="res-row-bar">${bar(stats.valFixed,'var(--fmt)')}</div><div class="res-row-pct">${pct(stats.valFixed,T)}</div><div class="res-row-num" style="color:var(--fmt)">${stats.valFixed}</div>
      </div>`;
  const domRow = enabledSteps.domains === false
    ? _skip('@', t('res.domains'), null)
    : `<div class="res-row"><div class="res-row-ico" style="background:var(--abg)">@</div>
        <div class="res-row-label">${t('res.domains')}<div class="res-row-sub">${domProviderStr}</div></div>
        <div class="res-row-bar">${bar(stats.domFixed,'var(--accent)')}</div><div class="res-row-pct">${pct(stats.domFixed,T)}</div><div class="res-row-num" style="color:var(--accent)">${stats.domFixed}</div>
      </div>`;
  const dupRow = enabledSteps.duplicates === false
    ? _skip('⊗', t('res.duplicates'), null)
    : `<div class="res-row"><div class="res-row-ico" style="background:var(--dbg)">⊗</div>
        <div class="res-row-label">${t('res.duplicates')}<div class="res-row-sub">${T} ${t('res.analyzed_m')} · ${stats.dupRemoved} ${t('res.duplicates_m')} · ${T - stats.dupRemoved} ${t('res.unique_m')}</div></div>
        <div class="res-row-bar">${bar(stats.dupRemoved,'var(--dup)')}</div><div class="res-row-pct">${pct(stats.dupRemoved,T)}</div><div class="res-row-num" style="color:var(--dup)">${stats.dupRemoved}</div>
      </div>`;
  const kwRow = enabledSteps.keywords === false
    ? _skip('⚠', t('res.keywords'), null)
    : stats.testRemoved > 0
      ? `<div class="res-row"><div class="res-row-ico" style="background:rgba(255,170,0,.1)">⚠</div>
          <div class="res-row-label">${t('res.kw_removal')}<div class="res-row-sub">${testSub}</div></div>
          <div class="res-row-bar">${bar(stats.testRemoved,'var(--warn)')}</div><div class="res-row-pct">${pct(stats.testRemoved,T)}</div><div class="res-row-num" style="color:var(--warn)">${stats.testRemoved}</div>
        </div>`
      : `<div class="res-row"><div class="res-row-ico" style="background:rgba(255,170,0,.06)">⚠</div>
          <div class="res-row-label">${t('res.keywords')}<div class="res-row-sub">${t('res.no_match')}</div></div>
          <div class="res-row-bar">${bar(0,'var(--warn)')}</div><div class="res-row-pct">${pct(0,T)}</div><div class="res-row-num" style="color:var(--t2)">0</div>
        </div>`;
  const nameaiNombresIA   = stats.nameaiNombresIA   || 0;
  const nameaiApellidosIA = stats.nameaiApellidosIA || 0;
  const nameaiManualN     = stats.nameaiManualN     || 0;
  const nameaiManualA     = stats.nameaiManualA     || 0;
  const nameaiTotal = nameaiNombresIA + nameaiApellidosIA + nameaiManualN + nameaiManualA;
  const nameaiSubParts = [
    nameaiNombresIA   > 0 && `<span style="color:var(--accent)">${t('res.nameai_ia_n', nameaiNombresIA)}</span>`,
    nameaiApellidosIA > 0 && `<span style="color:var(--accent)">${t('res.nameai_ia_a', nameaiApellidosIA)}</span>`,
    nameaiManualN     > 0 && `<span style="color:var(--warn)">${t('res.nameai_manual_n', nameaiManualN)}</span>`,
    nameaiManualA     > 0 && `<span style="color:var(--warn)">${t('res.nameai_manual_a', nameaiManualA)}</span>`,
  ].filter(Boolean).join(' · ');
  const nameaiColor = (nameaiManualN + nameaiManualA > 0 && nameaiNombresIA + nameaiApellidosIA === 0) ? 'var(--warn)' : 'var(--accent)';
  const nameaiRow = enabledSteps.nameai === false
    ? _skip('✦', t('res.nameai'), null)
    : nameaiTotal > 0
      ? `<div class="res-row"><div class="res-row-ico" style="background:rgba(0,229,180,.08)">✦</div>
          <div class="res-row-label">${t('res.nameai')}<div class="res-row-sub">${nameaiSubParts}</div></div>
          <div class="res-row-bar">${bar(nameaiTotal, nameaiColor)}</div><div class="res-row-pct">${pct(nameaiTotal, T)}</div>
          <div class="res-row-num" style="color:${nameaiColor}">${nameaiTotal}</div>
        </div>`
      : `<div class="res-row"><div class="res-row-ico" style="background:rgba(0,229,180,.04)">✦</div>
          <div class="res-row-label">${t('res.nameai')}<div class="res-row-sub">${t('res.no_completed')}</div></div>
          <div class="res-row-bar">${bar(0,'var(--accent)')}</div><div class="res-row-pct">${pct(0,T)}</div><div class="res-row-num" style="color:var(--t2)">0</div>
        </div>`;

  const empRow = enabledSteps.company === false
    ? _skip('🏢', t('res.company'), null)
    : stats.companyEdited > 0
      ? `<div class="res-row"><div class="res-row-ico" style="background:rgba(100,180,255,.1)">🏢</div>
          <div class="res-row-label">${t('res.company')}<div class="res-row-sub">${compSubParts || '—'}</div></div>
          <div class="res-row-bar">${bar(stats.companyEdited,'var(--accent)')}</div><div class="res-row-pct">${pct(stats.companyEdited,T)}</div><div class="res-row-num" style="color:var(--accent)">${stats.companyEdited}</div>
        </div>`
      : `<div class="res-row"><div class="res-row-ico" style="background:rgba(100,180,255,.06)">🏢</div>
          <div class="res-row-label">${t('res.company')}<div class="res-row-sub">${t('res.no_changes')}</div></div>
          <div class="res-row-bar">${bar(0,'var(--accent)')}</div><div class="res-row-pct">${pct(0,T)}</div><div class="res-row-num" style="color:var(--t2)">0</div>
        </div>`;
  const homolRow = (() => {
    if (enabledSteps.fieldhomol === false) return _skip('⇄', t('res.homol'), null);
    const homoTotal    = stats.homoTotal    || 0;
    const homoVariante = stats.homoVariante || 0;
    const homoIA       = stats.homoIA       || 0;
    const homoManual   = stats.homoManual   || 0;

    // Total acumulado incluyendo sesiones previas (via Otro)
    const prevTotal = (homoSessionSummaries || []).reduce((a, s) => a + (s.completados || 0), 0);
    const grandTotal = homoTotal + prevTotal;

    if (!grandTotal) {
      return `<div class="res-row"><div class="res-row-ico" style="background:rgba(160,200,255,.06)">⇄</div>
        <div class="res-row-label">${t('res.homol')}<div class="res-row-sub">${t('res.no_homol_changes')}</div></div>
        <div class="res-row-bar">${bar(0,'var(--fmt)')}</div><div class="res-row-pct" style="color:var(--t2)">—</div><div class="res-row-num" style="color:var(--t2)">0</div>
      </div>`;
    }

    // Detalle de sesiones previas (vía Otro)
    const sessionLines = (homoSessionSummaries || []).map(s =>
      `<span style="color:var(--t2)">${esc(s.label)} · ${esc(s.fieldNames)} → <span style="color:var(--accent)">${esc(s.destName)}</span> · ${s.completados}</span>`
    ).join('<br>');

    // Sesión activa (la última / única si no hubo Otro)
    const activeLabel = (homoSessionSummaries || []).length > 0
      ? `08/0${(homoSessionSummaries.length + 1)}`
      : '08';
    const activeLine = homoTotal > 0
      ? `<span style="color:var(--t2)">${activeLabel} · ${[
          homoVariante > 0 && `Variante ${homoVariante}`,
          homoIA       > 0 && `IA ${homoIA}`,
          homoManual   > 0 && `Manual ${homoManual}`,
        ].filter(Boolean).join(' · ')} · ${homoTotal}</span>`
      : '';

    const allLines = [sessionLines, activeLine].filter(Boolean).join('<br>');
    const totalLine = (homoSessionSummaries || []).length > 0
      ? `<span style="color:var(--t2);font-weight:600">Total · ${grandTotal}</span>`
      : '';
    const subContent = [allLines, totalLine].filter(Boolean).join('<br>');

    return `<div class="res-row"><div class="res-row-ico" style="background:rgba(160,200,255,.1)">⇄</div>
      <div class="res-row-label">${t('res.homol')}<div class="res-row-sub" style="line-height:1.8">${subContent}</div></div>
      <div class="res-row-bar">${bar(grandTotal,'var(--fmt)')}</div>
      <div class="res-row-pct">${pct(grandTotal,T)}</div>
      <div class="res-row-num" style="color:var(--fmt)">${grandTotal}</div>
    </div>`;
  })();
  const cntRow = enabledSteps.country === false
    ? _skip('🌍', t('res.country'), null)
    : hasCountryData
      ? `<div class="res-row"><div class="res-row-ico" style="background:rgba(130,200,255,.1)">🌍</div>
          <div class="res-row-label">${t('res.country')}<div class="res-row-sub">${countrySubParts}</div></div>
          <div class="res-row-bar">${bar(countryTotal,'var(--accent)')}</div><div class="res-row-pct">${pct(countryTotal,T)}</div><div class="res-row-num" style="color:var(--accent)">${countryTotal}</div>
        </div>`
      : `<div class="res-row"><div class="res-row-ico" style="background:rgba(130,200,255,.06)">🌍</div>
          <div class="res-row-label">${t('res.country')}<div class="res-row-sub">${t('res.no_col_detected')}</div></div>
          <div class="res-row-bar"></div><div class="res-row-pct" style="color:var(--t2)">—</div><div class="res-row-num" style="color:var(--t2)">—</div>
        </div>`;

  const { editorCellEdits, editorOpsCount, editorToolsUsed } = getState();
  const delNames = editorDeletedCols?.size ? [...editorDeletedCols].map(n => esc(n)).join(', ') : '';
  const addNames = editorAddedCols?.size   ? [...editorAddedCols].map(n => esc(n)).join(', ')   : '';
  const _cellEdits = editorCellEdits || 0;
  const _opsCount  = editorOpsCount  || 0;
  const _toolsUsed = editorToolsUsed || new Set();
  const totalEditorChanges = (editorDeletedCols?.size || 0) + (editorAddedCols?.size || 0) + _cellEdits + _opsCount;
  const TOOL_LABELS = { delete:'Eliminar col.', add_col:'Agregar col.', reorder:'Reordenar', rename:'Renombrar',
    split:'Dividir', merge:'Fusionar', format:'Formato', case:'Mayúsculas', spaces:'Espacios',
    remove_pos:'Eliminar pos.', add_text:'Agregar texto', replace:'Reemplazar' };
  const toolSubParts = [];
  if (delNames)    toolSubParts.push(`<span style="color:var(--red)">${editorDeletedCols.size} col. eliminada${editorDeletedCols.size > 1 ? 's' : ''}: ${delNames}</span>`);
  if (addNames)    toolSubParts.push(`<span style="color:var(--warn)">${editorAddedCols.size} col. agregada${editorAddedCols.size > 1 ? 's' : ''}: ${addNames}</span>`);
  if (_cellEdits)  toolSubParts.push(`<span style="color:var(--fmt)">${_cellEdits} celda${_cellEdits > 1 ? 's' : ''} editada${_cellEdits > 1 ? 's' : ''}</span>`);
  if (_toolsUsed.size) {
    const toolList = [..._toolsUsed].map(id => TOOL_LABELS[id] || id).join(', ');
    toolSubParts.push(`<span style="color:var(--t2)">Herramientas: ${toolList}</span>`);
  }
  const editorColRow = totalEditorChanges > 0 ? `
    <div class="res-row"><div class="res-row-ico" style="background:rgba(160,160,160,.08)">✍️</div>
      <div class="res-row-label">Editor CSV<div class="res-row-sub">${toolSubParts.join(' · ') || '—'}</div></div>
      <div class="res-row-bar"></div>
      <div class="res-row-pct" style="color:var(--t2)">—</div>
      <div class="res-row-num" style="color:var(--t2)">${totalEditorChanges}</div>
    </div>` : '';

  const tagRow = (() => {
    if (enabledSteps.fieldtags === false) return _skip('🏷', t('tags.title') || 'Etiquetar por valor', null);
    const tagCompleted = stats.tagCompleted || 0;
    const tagTotal     = stats.tagTotal     || 0;
    const tagMatch     = stats.tagMatch     || 0;
    const tagIA        = stats.tagIA        || 0;
    const tagManual    = stats.tagManual    || 0;
    const tagGlobalVal = stats.tagGlobalTag || '';
    if (!tagCompleted && !tagTotal) {
      return `<div class="res-row"><div class="res-row-ico" style="background:rgba(167,139,250,.06)">🏷</div>
        <div class="res-row-label">${t('tags.title') || 'Etiquetar por valor'}<div class="res-row-sub">${t('res.no_tag_changes')}</div></div>
        <div class="res-row-bar">${bar(0,'var(--ai)')}</div><div class="res-row-pct" style="color:var(--t2)">—</div><div class="res-row-num" style="color:var(--t2)">0</div>
      </div>`;
    }
    const subParts = [
      tagGlobalVal && `<span style="color:var(--accent);font-weight:500">Global: ${esc(tagGlobalVal)}</span>`,
      tagTotal   > 0 && `Total ${tagTotal}`,
      tagMatch   > 0 && `<span style="color:var(--accent)">Librería ${tagMatch}</span>`,
      tagIA      > 0 && `<span style="color:var(--ai)">IA ${tagIA}</span>`,
      tagManual  > 0 && `<span style="color:var(--warn)">Manual ${tagManual}</span>`,
    ].filter(Boolean).join(' · ');
    return `<div class="res-row"><div class="res-row-ico" style="background:rgba(167,139,250,.1)">🏷</div>
      <div class="res-row-label">${t('tags.title') || 'Etiquetar por valor'}<div class="res-row-sub">${subParts}</div></div>
      <div class="res-row-bar">${bar(tagCompleted,'var(--ai)')}</div>
      <div class="res-row-pct">${pct(tagCompleted,T)}</div>
      <div class="res-row-num" style="color:var(--ai)">${tagCompleted}</div>
    </div>`;
  })();

  set('res-rows', el => { el.innerHTML = `
    <div class="res-row"><div class="res-row-ico" style="background:rgba(160,160,160,.1)">📋</div>
      <div class="res-row-label">${t('res.analyzed_rows')}<div class="res-row-sub">${t('res.original_total')}</div></div>
      <div class="res-row-bar">${bar(T,'var(--t2)')}</div><div class="res-row-pct">${pct(T,T)}</div><div class="res-row-num" style="color:var(--t1)">${T}</div>
    </div>
    ${editorColRow}${rulesRow}${valRow}${domRow}${dupRow}${kwRow}${nameaiRow}${empRow}${cntRow}${homolRow}${tagRow}
    <div class="res-row" style="background:rgba(0,229,180,.04)"><div class="res-row-ico" style="background:var(--accent)">✓</div>
      <div class="res-row-label" style="color:var(--t0);font-weight:600">${t('res.final_csv')}<div class="res-row-sub" style="color:var(--t2)">${t('res.ready_export')}</div></div>
      <div class="res-row-bar">${bar(stats.finalRows,'var(--accent)')}</div><div class="res-row-pct" style="color:var(--accent)">${pct(stats.finalRows,T)}</div><div class="res-row-num" style="color:var(--accent);font-size:22px">${stats.finalRows}</div>
    </div>`; });

  // Preview — función interna re-invocable desde el selector de cantidad
  const _renderResPrev = () => {
    const maxStr   = $('res-prevcnt')?.querySelector('.fb.on')?.dataset.val ?? '5';
    const limit    = parseInt(maxStr, 10) || Infinity;
    const visCols  = csv.headers.map((h, i) => ({ h, i }));
    const rows     = isFinite(limit) ? finalRows.slice(0, limit) : finalRows;
    const stickyTh = 'position:sticky;top:0;z-index:1;background:var(--s2)';
    const numTh    = `<th style="${stickyTh};white-space:nowrap;color:var(--t2);text-align:right;padding-right:8px">#</th>`;
    const thead    = `<thead><tr>${numTh}${visCols.map(({ h }) => `<th>${esc(h || '—')}</th>`).join('')}</tr></thead>`;
    const tbody    = `<tbody>${rows.map(({ row, changed }, idx) => {
      const numTd = `<td style="color:var(--t2);text-align:right;padding-right:8px;font-variant-numeric:tabular-nums">${idx + 1}</td>`;
      return `<tr>${numTd}${visCols.map(({ i }) => {
        const v = (row[i] || '').trim();
        return `<td class="${i === colIdx && changed ? 'ch' : ''}" title="${esc(v)}">${esc(v.length > 24 ? v.slice(0, 24) + '…' : v) || '—'}</td>`;
      }).join('')}</tr>`;
    }).join('')}</tbody>`;
    set('prev-table', el => el.innerHTML = thead + tbody);
    set('prev-more',  el => el.textContent = '');
  };
  _renderResPrev();

  const resPrevCnt = $('res-prevcnt');
  if (resPrevCnt) resPrevCnt.addEventListener('click', e => {
    const btn = e.target.closest('.fb[data-val]');
    if (!btn) return;
    resPrevCnt.querySelectorAll('.fb').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    _renderResPrev();
  });

  // Label total + botones de export condicionales
  const subParts = [t('res.sub_originals', T) || `${T} originales`];
  if (stats.dupRemoved)   subParts.push(t('res.sub_dups',  stats.dupRemoved)  || `−${stats.dupRemoved} duplicados`);
  if (stats.testRemoved)  subParts.push(t('res.sub_test',  stats.testRemoved) || `−${stats.testRemoved} prueba`);
  set('preview-total-label', el => el.innerHTML = t('res.final_rows_lbl', stats.finalRows, T, subParts.join(' ')));
}

// ════════════════════════════════════════════════════════════
//  PASO 11 — ETIQUETAS DE CAMPO
// ════════════════════════════════════════════════════════════
let _tagCallbacks   = {};
let _tagFilter      = 'todas';
let _tagLibEditorOpen  = false;
let _tagLibsListOpen   = false;
let _tagPromptOpen     = false;

export function setTagLibEditorOpen(open) { _tagLibEditorOpen = open; }

function _updateSB11(tagResults, { tagSrcCol = -1 } = {}) {
  const sb = $('sb11');
  if (!sb) return;
  if (tagSrcCol < 0 || !tagResults.length) { sb.innerHTML = ''; return; }

  const totalAll   = tagResults.reduce((a, r) => a + r.rowIdxs.length, 0);
  const matchRows  = tagResults.filter(r => r.status === 'match')   .reduce((a, r) => a + r.rowIdxs.length, 0);
  const iaRows     = tagResults.filter(r => r.status === 'ia')      .reduce((a, r) => a + r.rowIdxs.length, 0);
  const manualRows = tagResults.filter(r => r.status === 'manual'   && r.tag).reduce((a, r) => a + r.rowIdxs.length, 0);
  const noMatch    = tagResults.filter(r => !r.tag)                 .reduce((a, r) => a + r.rowIdxs.length, 0);
  const completados = matchRows + iaRows + manualRows;

  sb.innerHTML = `
    <div class="sum-item"><div class="sum-n dim">${totalAll}</div><div class="sum-l">Total</div></div>
    ${matchRows  ? `<div class="sum-item"><div class="sum-n" style="color:var(--accent)">${matchRows}</div><div class="sum-l">Match</div></div>` : ''}
    <div class="sum-item"><div class="sum-n" style="color:var(--ai)">${iaRows}</div><div class="sum-l">IA</div></div>
    <div class="sum-item"><div class="sum-n" style="color:var(--warn)">${manualRows}</div><div class="sum-l">${t('stat.manual') || 'Manual'}</div></div>
    ${noMatch    ? `<div class="sum-item"><div class="sum-n" style="color:var(--t2)">${noMatch}</div><div class="sum-l">${t('tags.no_match') || 'Sin match'}</div></div>` : ''}
    <div class="sum-item"><div class="sum-n dim">${completados}</div><div class="sum-l">${t('tags.completados') || 'Completados'}</div></div>`;
}

function _renderC11Results({ tagResults, csv, tagSrcCol }) {
  const el = $('c11-results');
  if (!el) return;
  if (!tagResults?.length) { el.innerHTML = ''; return; }

  const indexed = tagResults.map((r, ri) => ({ r, ri })).filter(({ r }) => {
    if (_tagFilter === 'sin-match') return !r.tag;
    if (_tagFilter === 'completo')  return  !!r.tag;
    if (_tagFilter === 'match')     return r.status === 'match';
    if (_tagFilter === 'ia')        return r.status === 'ia';
    if (_tagFilter === 'manual')    return r.status === 'manual' && !!r.tag;
    return true;
  });

  const statusBadge = r =>
    r.status === 'match'  ? `<span class="tag tag-var">{V}</span>` :
    r.status === 'ia'     ? (r.tag ? `<span class="tag tag-ia">IA</span>` : `<span style="color:var(--t3);font-size:10px">—</span>`) :
    r.status === 'manual' ? (r.tag ? `<span class="tag tag-man">✎</span>` : `<span style="color:var(--t3);font-size:10px">—</span>`) :
    `<span style="color:var(--t3);font-size:10px">—</span>`;

  const srcHeader = csv?.headers?.[tagSrcCol] || `Campo ${tagSrcCol + 1}`;
  const resultRows = indexed.map(({ r, ri }) => {
    const rowNums = r.rowIdxs.length === 1
      ? `${r.rowIdxs[0] + 2}`
      : `${r.rowIdxs[0] + 2} (×${r.rowIdxs.length})`;
    const tagColor = r.tag
      ? (r.status === 'manual' ? 'var(--warn)' : r.status === 'ia' ? 'var(--ai)' : 'var(--accent)')
      : (r.status === 'manual' ? 'var(--t2)' : 'var(--t3)');
    return `<tr>
      <td><span class="mono t-dim" style="font-size:10px">${esc(rowNums)}</span></td>
      <td><span class="mono t-dim" style="font-size:11px">${esc(r.value || '—')}</span></td>
      <td><input class="ei tag-result-inp" data-ri="${ri}" value="${esc(r.tag || '')}" placeholder="—"
        style="min-width:110px;font-size:12px;font-weight:500;color:${tagColor}"></td>
      <td>${statusBadge(r)}</td>
    </tr>`;
  }).join('');

  const prevScroll = el.querySelector('.twrap')?.scrollTop || 0;
  el.innerHTML = `
    <div style="margin-top:2px">
      <div class="twrap" style="max-height:420px;overflow-y:auto">
        <table style="width:100%;border-collapse:separate;border-spacing:0;font-size:12px">
          <thead style="position:sticky;top:0;z-index:10;isolation:isolate">
            <tr>
              <th style="min-width:54px;font-size:10px">${t('country.row') || 'Fila(s)'}</th>
              <th style="color:var(--accent)">${esc(srcHeader)}</th>
              <th>→ Tag</th>
              <th style="width:44px">Est.</th>
            </tr>
          </thead>
          <tbody>${resultRows}</tbody>
        </table>
      </div>
    </div>`;
  const newTwrap = el.querySelector('.twrap');
  if (newTwrap && prevScroll) newTwrap.scrollTop = prevScroll;

  el.querySelectorAll('.tag-result-inp').forEach(inp =>
    inp.addEventListener('change', e => _tagCallbacks.onEditTagResult?.(+e.target.dataset.ri, e.target.value.trim()))
  );
}

function _renderC11Actions({ tagResults, tagSrcCol, tagTargetMode, tagTargetName, tagTargetColIdx } = {}) {
  const el = $('c11-actions');
  if (!el) return;
  const svgArr  = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>`;
  const hasTag  = (tagResults || []).some(r => r.tag);
  const canApply = hasTag && tagSrcCol >= 0 &&
    (tagTargetMode === 'new' ? (tagTargetName || '').trim().length > 0 : (tagTargetColIdx ?? -1) >= 0);
  el.innerHTML = `
    <button class="btn btn-skip btn-sm" id="btn-skip11">${t('misc.skip') || 'Omitir'}</button>
    <button class="btn btn-p btn-sm"    id="btn-next11"${!canApply ? ' disabled' : ''}>${t('misc.continuar') || 'Continuar'} ${svgArr}</button>`;
  $('btn-skip11')?.addEventListener('click', () => _tagCallbacks.onSkip?.());
  $('btn-next11')?.addEventListener('click', () => _tagCallbacks.onApply?.());
}

export function renderStep11({
  csv, colIdx, tagSrcCol, tagTargetMode, tagTargetName, tagTargetColIdx,
  tagLibraries, tagLibEntries, tagLibName, tagSelectedLibId,
  tagGlobalTag, tagResults, tagPromptMatch,
  aiStatus11, aiProviders, selectedProviderId11,
  onSrcColChange, onTargetModeChange, onTargetNameChange, onTargetColChange,
  onLibSelect, onNewLib, onEditLib, onDeleteLib, onSaveLib,
  onLibNameChange, onEditEntry, onAddEntry, onDeleteEntry,
  onGlobalTagChange, onApplyMatch, onRunAI, onCancelAI,
  onEditTagResult, onApply, onSkip, onRender,
  onSavePromptMatch, onProvider11Change, onRetryAI,
}) {
  _tagCallbacks = {
    onSrcColChange, onTargetModeChange, onTargetNameChange, onTargetColChange,
    onLibSelect, onNewLib, onEditLib, onDeleteLib, onSaveLib,
    onLibNameChange, onEditEntry, onAddEntry, onDeleteEntry,
    onGlobalTagChange, onApplyMatch, onRunAI, onCancelAI,
    onEditTagResult, onApply, onSkip, onRender,
    onSavePromptMatch, onProvider11Change, onRetryAI,
  };

  _updateSB11(tagResults || [], { tagSrcCol });

  // ── AI status bar ─────────────────────────────────────────
  const aiEl = $('c11-ai-status');
  if (aiEl) {
    const providers  = aiProviders || [];
    const selectedId = selectedProviderId11 || '';
    const selHtml    = providers.length > 1
      ? `<select id="c11-provider-select" style="font-size:11px;background:var(--s2);border:1px solid var(--border);color:var(--t1);border-radius:4px;padding:2px 6px">${providers.map(p => `<option value="${esc(p.id)}"${p.id===selectedId?' selected':''}>${esc(p.label||p.id)}</option>`).join('')}</select>`
      : providers.length ? `<span style="font-size:11px;color:var(--t2)">${esc(providers[0].label||providers[0].id)}</span>` : '';
    if (aiStatus11 === 'ok' || aiStatus11 === 'cold') {
      const dot = aiStatus11 === 'ok' ? 'ollama-dot-ok' : '';
      aiEl.innerHTML = `<div class="ollama-banner ollama-ok" style="display:flex;align-items:center;gap:10px"><span class="ollama-dot ${dot}"></span>${selHtml}<span style="font-size:11px;color:var(--accent);margin-left:2px">${t('ai.connected')}</span></div>`;
    } else if (aiStatus11 === 'checking') {
      aiEl.innerHTML = `<div class="ollama-banner ollama-checking" style="display:flex;align-items:center;gap:10px"><span class="ollama-dot ollama-dot-checking"></span>${selHtml}<span style="font-size:11px;color:var(--t2);margin-left:2px">${t('ai.checking')}</span></div>`;
    } else {
      const model = providers.find(p => p.id === selectedId)?.model || '';
      aiEl.innerHTML = `<div class="ollama-banner ollama-error"><div class="ollama-err-hdr" style="display:flex;align-items:center;gap:10px"><span class="ollama-dot ollama-dot-err"></span>${selHtml}<span style="font-size:11px;color:var(--red);margin-left:2px">${t('ai.no_response')}</span></div><div class="ollama-instructions">${model?`<code>ollama run ${esc(model)}</code>`:''}<button class="btn btn-g btn-xs" id="btn-retry-tags">${t('ai.retry')}</button></div></div>`;
      $('btn-retry-tags')?.addEventListener('click', () => _tagCallbacks.onRetryAI?.());
    }
    $('c11-provider-select')?.addEventListener('change', e => onProvider11Change?.(e.target.value));
  }

  // ── Body ──────────────────────────────────────────────────
  const bodyEl = $('c11-body');
  if (!bodyEl) return;

  const srcCols = (csv?.headers || []).map((h, i) => ({ h, i })).filter(({ i }) =>
    i !== colIdx && (csv?.rows || []).some(row => (row[i] ?? '').toString().trim() !== '')
  );
  const colChips = srcCols.map(({ h, i }) => {
    const sel = tagSrcCol === i;
    return `<span class="col-chip" style="${sel ? 'border-color:var(--accent);color:var(--accent);background:rgba(0,229,180,.08)' : ''}"><label>
      <input type="radio" name="tag-src-col" data-ci="${i}" ${sel ? 'checked' : ''}><span>${esc(h.trim() || `Col ${i+1}`)}</span>
    </label></span>`;
  }).join('');

  const targetCols = (csv?.headers || []).map((h, i) =>
    `<option value="${i}"${tagTargetColIdx === i ? ' selected' : ''}>${esc(h)}</option>`
  ).join('');

  const tagLibs  = [...(tagLibraries || [])].sort((a, b) => a.name.localeCompare(b.name));
  const selLib   = tagLibs.find(l => (l.id || l.name) === tagSelectedLibId);
  const entries  = tagLibEntries || [];

  const editorRows = entries.map((e, idx) =>
    `<tr>
      <td style="padding:5px 8px"><input class="ei tag-val-inp" data-idx="${idx}" value="${esc(e.value)}" placeholder="${t('tags.col_value')||'Valor campo'}" style="min-width:120px;font-size:12px"></td>
      <td style="padding:5px 8px"><input class="ei tag-tag-inp" data-idx="${idx}" value="${esc(e.tag)}"   placeholder="${t('tags.col_tag')||'Tag'}"         style="min-width:120px;font-size:12px;color:var(--accent)"></td>
      <td style="padding:5px 6px;text-align:right"><button class="tag-del-entry btn btn-g btn-xs" data-idx="${idx}" style="color:var(--red)">✕</button></td>
    </tr>`
  ).join('');

  const libsListHtml = _tagLibsListOpen
    ? tagLibs.map(l => `<div style="display:flex;align-items:center;gap:8px;padding:4px 6px;background:var(--s3);border-radius:6px;font-size:12px">
        <span style="flex:1;color:var(--t1)">${esc(l.name)}</span>
        <span style="color:var(--t3);font-size:11px">${(l.entries||[]).length} ${t('tags.entries')||'entradas'}</span>
        <button class="btn btn-g btn-xs tag-lib-edit" data-lid="${esc(l.id||l.name)}" style="font-size:10px;padding:1px 6px">${t('homol.btn_edit')||'Editar'}</button>
        <button class="btn btn-xs tag-lib-del"        data-lid="${esc(l.id||l.name)}" style="font-size:10px;padding:1px 6px;background:rgba(255,90,90,.08);color:var(--warn);border-color:rgba(255,90,90,.2)">${t('homol.btn_delete')||'Eliminar'}</button>
      </div>`).join('') : '';

  const promptBody = _tagPromptOpen ? 'block' : 'none';
  const togLbl     = _tagPromptOpen ? `&#x25BE; ${t('homol.hide')||'Ocultar'}` : `&#x25B8; ${t('homol.btn_view')||'Ver'}`;
  const viewLibsLbl = _tagLibsListOpen ? (t('homol.hide_libs')||'&#x2039; Ocultar') : `&#x203A; ${t('homol.view_libs', tagLibs.length)||`Ver todas (${tagLibs.length})`}`;

  bodyEl.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:0">

      <!-- CAMPO FUENTE -->
      <div class="homo-section">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
          <span style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--t2)">${t('tags.src_title')||'Campo fuente'}</span>
          <span style="font-size:11px;color:var(--t3)">${t('homol.src_hint')||'(seleccioná uno)'}</span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${colChips || `<span style="font-size:12px;color:var(--t2)">${t('homol.src_empty')||'No hay columnas disponibles'}</span>`}
        </div>
      </div>

      <!-- CAMPO DESTINO -->
      <div class="homo-section">
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
          <span style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--t2);white-space:nowrap">${t('tags.target_title')||'Campo destino'}</span>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;white-space:nowrap">
            <input type="radio" name="tag-target-mode" value="new" ${tagTargetMode==='new'?'checked':''} style="accent-color:var(--accent)">
            ${t('homol.target_new')||'Nuevo campo'}
            <input type="text" id="tag-target-name" value="${esc(tagTargetName||'Tags')}" placeholder="Tags…"
              style="display:${tagTargetMode==='new'?'inline-block':'none'};margin-left:6px;width:180px;font-size:12px;background:transparent;color:var(--accent);border:1px solid var(--border);border-radius:var(--rs);padding:3px 8px;outline:none">
          </label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;white-space:nowrap">
            <input type="radio" name="tag-target-mode" value="existing" ${tagTargetMode==='existing'?'checked':''} style="accent-color:var(--accent)">
            ${t('homol.target_existing')||'Campo existente'}
            <select id="tag-target-col" style="display:${tagTargetMode==='existing'?'inline-block':'none'};margin-left:6px">${targetCols}</select>
          </label>
        </div>
      </div>

      <!-- TAG GLOBAL -->
      <div class="homo-section">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <span style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--t2);white-space:nowrap">${t('tags.global_tag')||'Tag global'}</span>
          <input type="text" id="tag-global-inp" value="${esc(tagGlobalTag||'')}" placeholder="${t('tags.global_ph')||'se agrega a todos'}"
            style="flex:1;min-width:180px;max-width:320px;font-size:12px;color:var(--accent);background:transparent;border:1px solid var(--border);border-radius:var(--rs);padding:3px 8px;outline:none">
        </div>
      </div>

      <!-- LIBRERÍA -->
      <div class="homo-section">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--t2);margin-bottom:8px">${t('tags.lib_section')||'Librería de etiquetas'}</div>

        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
          <span style="font-size:12px;color:var(--t2)">${t('libs.library_lbl')||'Biblioteca'}:</span>
          <button class="btn btn-g btn-sm" id="btn-tag-new-lib">${t('tags.btn_new_lib')||'Nueva'}</button>
          ${tagLibs.length ? `<button class="btn btn-g btn-xs" id="btn-tag-view-libs" data-count="${tagLibs.length}" style="font-size:11px">${viewLibsLbl}</button>` : ''}
          <span style="flex:1"></span>
          <span style="font-size:12px;color:var(--t2)">${t('homol.btn_select')||'Seleccionar'}:</span>
          <select id="tag-lib-sel" style="min-width:200px">
            <option value="">${t('tags.lib_ph')||'Librería de etiquetas'}</option>
            ${tagLibs.map(l => `<option value="${esc(l.id||l.name)}"${(l.id||l.name)===tagSelectedLibId?' selected':''}>${esc(l.name)} (${(l.entries||[]).length} ${t('tags.entries')||'entradas'})</option>`).join('')}
          </select>
          ${selLib ? `<button class="btn btn-g btn-xs tag-lib-edit" data-lid="${esc(selLib.id||selLib.name)}" style="font-size:11px">${t('homol.btn_edit')||'Editar'}</button>` : ''}
        </div>

        <div id="tag-libs-list" style="display:${_tagLibsListOpen?'':'none'};margin-bottom:8px">
          <div style="display:flex;flex-direction:column;gap:4px;max-height:140px;overflow-y:auto">${libsListHtml}</div>
        </div>

        <!-- Editor inline -->
        <div id="tag-lib-editor" style="display:${_tagLibEditorOpen?'':'none'};margin-top:12px;padding:10px;background:var(--s3);border-radius:8px;border:1px solid var(--border)">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">
            <input type="text" id="tag-lib-name-inp" placeholder="${t('tags.lib_name_ph')||'Nombre de la biblioteca'}" value="${esc(tagLibName||'')}" style="flex:1;min-width:160px;font-size:12px">
            <span style="font-size:11px;color:var(--t2)">${entries.length} ${t('tags.entries')||'entradas'}</span>
          </div>
          <div class="twrap" style="max-height:260px;overflow-y:auto">
            <table style="width:100%;border-collapse:separate;border-spacing:0;font-size:12px">
              <thead style="position:sticky;top:0;z-index:10;isolation:isolate">
                <tr><th>${t('tags.col_value')||'Valor campo'}</th><th>${t('tags.col_tag')||'Tag'}</th><th style="width:36px"></th></tr>
              </thead>
              <tbody>${editorRows||`<tr><td colspan="3" style="padding:14px;text-align:center;color:var(--t2);font-size:12px">${t('tags.no_entries')||'Sin entradas todavía'}</td></tr>`}</tbody>
            </table>
          </div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:8px">
            <button class="btn btn-g btn-xs" id="tag-add-entry">+ ${t('tags.btn_add_entry')||'Entrada'}</button>
            <span style="flex:1"></span>
            <button class="btn btn-g btn-sm" id="btn-c11-close-editor">${t('homol.collapse')||'Cancelar'}</button>
            <button class="btn btn-p btn-sm" id="btn-c11-save-lib">${t('tags.btn_save_lib')||'Guardar biblioteca'}</button>
          </div>
        </div>
      </div>

      <!-- PROMPT IA -->
      <div class="homo-section">
        <div style="padding:8px 10px;background:var(--s3);border-radius:6px;border:1px solid var(--border)">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--t2)">${t('tags.prompt_lbl')||'Prompt — Etiquetado por fila IA'}</span>
            <button class="btn btn-g btn-xs" id="btn-tag-prompt-toggle">${togLbl}</button>
          </div>
          <div id="tag-prompt-body" style="display:${promptBody};margin-top:8px">
            <textarea id="tag-prompt-ta" style="width:100%;height:110px;font-family:var(--mono);font-size:11px;line-height:1.5;background:var(--s2);border:1px solid var(--border);border-radius:var(--rs);color:var(--t0);padding:8px;resize:vertical;outline:none;box-sizing:border-box">${esc(tagPromptMatch||'')}</textarea>
            <div style="display:flex;gap:6px;margin-top:6px">
              <button class="btn btn-g btn-xs" id="btn-tag-prompt-reset">${t('homol.btn_restore')||'Restaurar'}</button>
              <button class="btn btn-p btn-xs" id="btn-tag-prompt-save">${t('homol.btn_save')||'Guardar'}</button>
            </div>
          </div>
        </div>
      </div>

      <!-- ACCIONES PASO 1 / PASO 2 + FILTROS -->
      <div class="homo-section" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;border-bottom:none">
        <span style="font-size:11px;color:var(--t2)">${t('homol.step1')||'PASO 1'}</span>
        <button class="btn btn-p btn-sm" id="btn-c11-apply-match">Match</button>
        <span style="color:var(--border);font-size:14px">|</span>
        <span style="font-size:11px;color:var(--t2)">${t('homol.step2')||'PASO 2'}</span>
        <button class="btn btn-p btn-sm" id="btn-c11-run-ai">${_CHIP_SVG} IA</button>
        <button class="btn btn-g btn-sm" id="btn-c11-cancel-ai" style="display:none">${t('homol.collapse')||'Cancelar'}</button>
        <span style="flex:1"></span>
        <div id="tag-filter-bar" style="display:flex;gap:4px;flex-wrap:wrap">
          ${['todas','sin-match','completo','match','ia','manual'].map(f => {
            const lbl = f==='todas'?'Todas':f==='sin-match'?'Sin match':f==='completo'?'Completo':f==='match'?'Match':f==='ia'?'IA':'Manual';
            return `<button class="fb${_tagFilter===f?' on':''}" data-tf="${f}" style="font-size:10px;padding:2px 8px">${lbl}</button>`;
          }).join('')}
        </div>
      </div>

    </div>`;

  // ── Events ────────────────────────────────────────────────
  bodyEl.querySelectorAll('input[name="tag-src-col"]').forEach(r =>
    r.addEventListener('change', e => _tagCallbacks.onSrcColChange?.(+e.target.dataset.ci))
  );
  bodyEl.querySelectorAll('input[name="tag-target-mode"]').forEach(r =>
    r.addEventListener('change', e => {
      $('tag-target-name').style.display = e.target.value==='new'?'inline-block':'none';
      $('tag-target-col').style.display  = e.target.value==='existing'?'inline-block':'none';
      _tagCallbacks.onTargetModeChange?.(e.target.value);
    })
  );
  $('tag-target-name')?.addEventListener('input', e => _tagCallbacks.onTargetNameChange?.(e.target.value));
  $('tag-target-col')?.addEventListener('change', e => _tagCallbacks.onTargetColChange?.(+e.target.value));
  $('tag-global-inp')?.addEventListener('input',  e => _tagCallbacks.onGlobalTagChange?.(e.target.value));

  $('tag-lib-sel')?.addEventListener('change', e => _tagCallbacks.onLibSelect?.(e.target.value));
  bodyEl.querySelectorAll('.tag-lib-edit').forEach(btn =>
    btn.addEventListener('click', () => { _tagLibEditorOpen = true; _tagCallbacks.onEditLib?.(btn.dataset.lid); })
  );
  bodyEl.querySelectorAll('.tag-lib-del').forEach(btn =>
    btn.addEventListener('click', () => _tagCallbacks.onDeleteLib?.(btn.dataset.lid))
  );
  $('btn-tag-new-lib')?.addEventListener('click', () => { _tagLibEditorOpen = true; _tagCallbacks.onNewLib?.(); });

  $('btn-tag-view-libs')?.addEventListener('click', () => {
    _tagLibsListOpen = !_tagLibsListOpen;
    const list = $('tag-libs-list');
    const btn  = $('btn-tag-view-libs');
    const cnt  = btn?.dataset.count || 0;
    if (list) list.style.display = _tagLibsListOpen ? '' : 'none';
    if (btn)  btn.innerHTML = _tagLibsListOpen ? '▲ Ocultar' : `▶ Ver todas (${cnt})`;
    if (_tagLibsListOpen && list) {
      const tagLibs2 = (tagLibraries||[]).sort((a,b)=>a.name.localeCompare(b.name));
      list.querySelector('div').innerHTML = tagLibs2.map(l =>
        `<div style="display:flex;align-items:center;gap:8px;padding:4px 6px;background:var(--s3);border-radius:6px;font-size:12px">
          <span style="flex:1;color:var(--t1)">${esc(l.name)}</span>
          <span style="color:var(--t3);font-size:11px">${(l.entries||[]).length} ${t('tags.entries')||'entradas'}</span>
          <button class="btn btn-g btn-xs tag-lib-edit" data-lid="${esc(l.id||l.name)}" style="font-size:10px;padding:1px 6px">${t('homol.btn_edit')||'Editar'}</button>
          <button class="btn btn-xs tag-lib-del" data-lid="${esc(l.id||l.name)}" style="font-size:10px;padding:1px 6px;background:rgba(255,90,90,.08);color:var(--warn);border-color:rgba(255,90,90,.2)">${t('homol.btn_delete')||'Eliminar'}</button>
        </div>`
      ).join('');
      list.querySelectorAll('.tag-lib-edit').forEach(b => b.addEventListener('click', () => { _tagLibEditorOpen = true; _tagCallbacks.onEditLib?.(b.dataset.lid); }));
      list.querySelectorAll('.tag-lib-del').forEach(b => b.addEventListener('click', () => _tagCallbacks.onDeleteLib?.(b.dataset.lid)));
    }
  });

  $('btn-c11-close-editor')?.addEventListener('click', () => { _tagLibEditorOpen = false; _tagCallbacks.onRender?.(); });
  $('tag-lib-name-inp')?.addEventListener('input', e => _tagCallbacks.onLibNameChange?.(e.target.value));
  $('btn-c11-save-lib')?.addEventListener('click', () => _tagCallbacks.onSaveLib?.());
  $('tag-add-entry')?.addEventListener('click', () => _tagCallbacks.onAddEntry?.());
  bodyEl.querySelectorAll('.tag-val-inp').forEach(inp =>
    inp.addEventListener('input', e => _tagCallbacks.onEditEntry?.(+e.target.dataset.idx, 'value', e.target.value))
  );
  bodyEl.querySelectorAll('.tag-tag-inp').forEach(inp =>
    inp.addEventListener('input', e => _tagCallbacks.onEditEntry?.(+e.target.dataset.idx, 'tag', e.target.value))
  );
  bodyEl.querySelectorAll('.tag-del-entry').forEach(btn =>
    btn.addEventListener('click', () => _tagCallbacks.onDeleteEntry?.(+btn.dataset.idx))
  );

  $('btn-tag-prompt-toggle')?.addEventListener('click', () => {
    _tagPromptOpen = !_tagPromptOpen;
    const body = $('tag-prompt-body');
    const btn  = $('btn-tag-prompt-toggle');
    if (body) body.style.display = _tagPromptOpen ? 'block' : 'none';
    if (btn)  btn.innerHTML = _tagPromptOpen ? '&#x25BE; Ocultar' : '&#x25B8; Ver';
  });
  $('btn-tag-prompt-save')?.addEventListener('click',  () => _tagCallbacks.onSavePromptMatch?.($('tag-prompt-ta')?.value));
  $('btn-tag-prompt-reset')?.addEventListener('click', () => _tagCallbacks.onSavePromptMatch?.(null));

  $('btn-c11-apply-match')?.addEventListener('click', () => _tagCallbacks.onApplyMatch?.());
  $('btn-c11-run-ai')?.addEventListener('click',      () => _tagCallbacks.onRunAI?.());
  $('btn-c11-cancel-ai')?.addEventListener('click',   () => _tagCallbacks.onCancelAI?.());

  $('tag-filter-bar')?.querySelectorAll('button[data-tf]').forEach(btn =>
    btn.addEventListener('click', e => {
      _tagFilter = e.target.dataset.tf;
      $('tag-filter-bar')?.querySelectorAll('button[data-tf]').forEach(b => b.classList.toggle('on', b.dataset.tf === _tagFilter));
      _tagCallbacks.onRender?.();
    })
  );

  _renderC11Results({ tagResults: tagResults || [], csv, tagSrcCol });
  _renderC11Actions({ tagResults: tagResults || [], tagSrcCol, tagTargetMode, tagTargetName, tagTargetColIdx });
}

export function renderStep11Progress(current, total) {
  const panel = $('c11-progress');
  if (!panel) return;
  if (!total) { panel.innerHTML = ''; return; }
  const p = Math.round(current / total * 100);
  panel.innerHTML = `
    <div style="margin:6px 0 2px;display:flex;align-items:center;gap:10px">
      <div style="flex:1">
        <div style="height:5px;background:var(--border);border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${p}%;background:var(--accent);border-radius:3px;transition:width 0.25s"></div>
        </div>
        <div style="font-size:11px;color:var(--t2);margin-top:4px">${t('ai.applying', current, total, p)}</div>
      </div>
      <button id="btn-c11-progress-cancel" class="btn btn-xs" style="flex-shrink:0;color:var(--red);border:1px solid var(--red);background:transparent">${t('misc.cancel')||'Cancelar'}</button>
    </div>`;
  $('btn-c11-progress-cancel')?.addEventListener('click', () => _tagCallbacks.onCancelAI?.());
}
