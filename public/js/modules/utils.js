/**
 * utils.js — Helpers de DOM, formato y UI
 * dataB Flow · Cleaning | Transformation | Governance · © 2026 mdmarein · GNU AGPLv3
 */

import { t } from './i18n.js';

// ── DOM ──────────────────────────────────────────────────────
export const $ = id => document.getElementById(id);
export const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const show = id => $(id)?.classList.remove('hidden');
export const hide = id => $(id)?.classList.add('hidden');
export const lock   = id => $(id)?.classList.add('locked');
export const unlock = id => $(id)?.classList.remove('locked');

// ── Toast ────────────────────────────────────────────────────
let _toastTimer;
export function toast(msg, type = 'default') {
  const el  = $('toast');
  const dot = el?.querySelector('.toast-dot');
  if (!el) return;
  el.querySelector('#tmsg').textContent = msg;
  if (dot) dot.style.background = type === 'warn' ? 'var(--warn)' : type === 'error' ? 'var(--red)' : 'var(--accent)';
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), type === 'error' ? 5000 : 3000);
}

// ── Wizard ───────────────────────────────────────────────────
export function setWizardStep(stepId) {
  let found = false;
  document.querySelectorAll('#wz .wz-step').forEach(el => {
    const sid = el.dataset.sid;
    if (!sid) return;
    el.classList.remove('active', 'done');
    const dot    = el.querySelector('.wz-dot');
    const abbr   = el.dataset.abbr;
    const isOmit = el.dataset.omitted === 'true';

    if (sid === stepId) {
      el.classList.add('active');
      found = true;
    } else if (!found) {
      el.classList.add('done');
      if (isOmit) {
        el.classList.add('omitted');
        // Keep original dot content (abbr/number) for omitted steps
      } else if (!abbr && dot) {
        dot.textContent = '✓';
      }
      // Email-group steps (have data-abbr): keep the letter, CSS handles color
    }
  });

  // Update group box border/label color
  const group = document.getElementById('wg-email');
  if (group) {
    const hasActive = !!group.querySelector('.wz-step.active');
    const hasDone   = !!group.querySelector('.wz-step.done:not(.omitted)');
    group.classList.toggle('has-active', hasActive);
    group.classList.toggle('has-done', !hasActive && hasDone);
  }
}

// Lazy import to avoid circular deps — set by main.js via _setFlowSteps()
let _flowStepsData = [];
export function _setFlowSteps(steps) { _flowStepsData = steps; }

export function buildWizardBar(enabledSteps = {}, omittedSteps = {}) {
  const wz = $('wz');
  if (!wz) return;

  // Capture active step before clearing innerHTML
  const activeSid = wz.querySelector('.wz-step.active')?.dataset.sid;

  const flowStepsRaw = _flowStepsData;
  const visibleIds = new Set(
    flowStepsRaw
      .filter(s => enabledSteps[s.id] !== false || omittedSteps[s.id])
      .map(s => s.id)
  );

  // Email group: show ALL sub-steps whenever ≥1 is active, so R/V/D always appear together.
  // Individually disabled sub-steps get the 'skipped' class (neutral grey, not the red 'omitted' style).
  const allEmailSteps  = flowStepsRaw.filter(s => s.group === 'email');
  const anyEmailActive = allEmailSteps.some(s => visibleIds.has(s.id));
  const emailSteps     = anyEmailActive ? allEmailSteps : [];
  const nonEmailSteps  = flowStepsRaw.filter(s => s.group !== 'email' && visibleIds.has(s.id));

  // CORREO group — no labels inside dots, "CORREO" label sits below the box
  let emailHtml = '';
  if (emailSteps.length > 0) {
    const stepsHtml = emailSteps.map(s => {
      const abbr      = s.abbr || s.id[0].toUpperCase();
      const isOmitted = !!omittedSteps[s.id];
      const isSkipped = !isOmitted && enabledSteps[s.id] === false;
      const extraAttr = isOmitted ? ' data-omitted="true"' : (isSkipped ? ' data-skipped="true"' : '');
      return `<div class="wz-step" id="ws-${s.id}" data-sid="${s.id}" data-abbr="${abbr}"${extraAttr}><div class="wz-dot">${abbr}</div></div>`;
    }).join('');
    emailHtml = `<div class="wz-group" id="wg-email"><div class="wz-group-steps">${stepsHtml}</div><div class="wz-group-label">SYNTAX</div></div>`;
  }

  // Individual steps
  let num = 1;
  const individualHtml = nonEmailSteps.map(s => {
    const numStr = num < 10 ? '0' + num : String(num);
    num++;
    const omAttr = omittedSteps[s.id] ? ' data-omitted="true"' : '';
    return `<div class="wz-step" id="ws-${s.id}" data-sid="${s.id}"${omAttr}><div class="wz-dot">${numStr}</div><div class="wz-lbl">${t('step.' + s.id) || s.label}</div></div>`;
  }).join('');

  // RESUMEN
  const summaryHtml = `<div class="wz-step" id="ws-summary" data-sid="summary"><div class="wz-dot">⊙</div><div class="wz-lbl">${t('step.summary') || 'Resumen'}</div></div>`;

  wz.innerHTML = emailHtml + individualHtml + summaryHtml;

  // Apply state classes to email sub-steps
  emailSteps.forEach(s => {
    const el = $(`ws-${s.id}`);
    if (!el) return;
    if (omittedSteps[s.id])            el.classList.add('omitted');
    else if (enabledSteps[s.id] === false) el.classList.add('skipped');
  });

  // Apply omitted class to non-email omitted steps
  Object.keys(omittedSteps).forEach(sid => {
    const el = $(`ws-${sid}`);
    if (el) el.classList.add('omitted');
  });

  if (activeSid) setWizardStep(activeSid);

  // Update card numbers (enabled steps only, not omitted)
  let tNum = 1;
  flowStepsRaw.forEach(s => {
    if (enabledSteps[s.id] === false) return;
    const numStr = tNum < 10 ? '0' + tNum : String(tNum);
    tNum++;
    const numEl = document.querySelector(`#${s.card} .card-title .card-num`);
    if (numEl) numEl.textContent = numStr;
  });
}

// ── Formato ──────────────────────────────────────────────────
export function pct(n, total) {
  if (!total) return '—';
  return `${Math.round(n / total * 100)}%`;
}

export function truncate(str, max = 28) {
  return str.length > max ? str.slice(0, max) + '…' : str;
}

// ── Sync checkbox "todos" ────────────────────────────────────
export function syncCheckAll(cbAllId, items, checkedProp = 'checked') {
  const el = $(cbAllId);
  if (!el) return;
  const total    = items.length;
  const selected = items.filter(i => i[checkedProp]).length;
  el.checked       = total > 0 && selected === total;
  el.indeterminate = selected > 0 && selected < total;
}

// ── Descarga de archivo ──────────────────────────────────────
export function downloadText(content, filename, mime = 'text/csv;charset=utf-8;') {
  const blob = new Blob(['\uFEFF' + content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Formateo de teléfono (inline para no importar country.js) ──
function _fmtPhone(rawPhone, callingCode) {
  if (!callingCode || !rawPhone?.trim()) return rawPhone;
  let d = rawPhone.replace(/\D/g, '');
  if (!d) return rawPhone;
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith(callingCode)) return '+' + d;
  if (d.startsWith('0')) d = d.slice(1);
  return '+' + callingCode + d;
}

// ── Construir filas finales del CSV ──────────────────────────
export function buildFinalRows(csv, colIdx, valItems, domItems, dupExcluded,
  testExcluded = new Set(), empresaIdx = -1, companyNorms = [],
  step8Items = [], paisIdx = -1, telIdx = -1,
  fieldNorms = {}, fieldSelectedCols = [],
  nameaiItems = [], nameaiIdx = -1, apellaiIdx = -1) {
  const finalRows = [];
  const changeLog = [];
  const dupLog    = [];
  const testLog   = [];

  // Mapa rápido: clave normalizada → norma de empresa
  const compNormMap = new Map();
  if (empresaIdx >= 0 && companyNorms.length) {
    companyNorms.forEach(n => compNormMap.set(n.key, n));
  }

  // Mapas rápidos: rowIdx → item (O(1) lookup en lugar de O(n) find por fila)
  const valMap    = new Map((valItems  || []).filter(v => v.checked).map(v => [v.rowIdx, v]));
  const domMap    = new Map((domItems  || []).filter(d => d.checked).map(d => [d.rowIdx, d]));
  const step8Map  = new Map(step8Items.map(i => [i.rowIdx, i]));
  const nameaiMap = new Map(nameaiItems.map(i => [i.rowIdx, i]));

  // Mapas de homologación de campos (paso 9): { colIdx → Map<key, newValue> }
  const fieldHomolMaps = {};
  for (const fi of fieldSelectedCols) {
    const norms = fieldNorms[fi];
    if (!norms) continue;
    const m = new Map();
    norms.filter(n => n.changed).forEach(n => m.set(n.key, n.newValue));
    if (m.size > 0) fieldHomolMaps[fi] = m;
  }

  csv.rows.forEach((row, ri) => {
    const orig = (row[colIdx] || '').trim();
    const r    = [...row];
    const changeTypes = [];

    const vf = valMap.get(ri);
    const df = domMap.get(ri);

    if (vf) { r[colIdx] = vf.manualValue ?? vf.autoFixed; changeTypes.push('Validación'); }
    if (df) { r[colIdx] = df.manualValue ?? df.corrected;  changeTypes.push('Dominio'); }

    if (dupExcluded.has(ri)) {
      dupLog.push({ fila: ri + 2, emailOriginal: orig, emailFinal: r[colIdx] });
      return;
    }

    if (testExcluded.has(ri)) {
      testLog.push({ fila: ri + 2, emailOriginal: orig, emailFinal: r[colIdx] });
      return;
    }

    // Aplicar normalización de empresa
    if (compNormMap.size > 0 && empresaIdx >= 0) {
      const empresa = (r[empresaIdx] || '').trim().replace(/\s{2,}/g, ' ');
      const key     = empresa.toLowerCase().normalize('NFC');
      const norm    = compNormMap.get(key);
      if (norm) {
        if (norm.clear) {
          r[empresaIdx] = '';
          changeTypes.push('Empresa limpiada');
        } else if (norm.newName !== norm.displayName) {
          r[empresaIdx] = norm.newName;
          changeTypes.push('Empresa normalizada');
        }
      }
    }

    // Aplicar país y teléfono (paso 8) — solo si el usuario lo dejó chequeado
    const item8 = step8Map.get(ri);
    if (item8?.checked && item8?.country) {
      if (paisIdx >= 0 && !r[paisIdx]?.trim()) {
        r[paisIdx] = item8.country.nameEs;
        changeTypes.push('País');
      }
      if (telIdx >= 0 && r[telIdx]?.trim()) {
        if (item8.phoneInvalid) {
          // Inválido: vaciar por defecto; usar corrección manual si el usuario la ingresó
          r[telIdx] = (item8.manualPhone != null && item8.manualPhone !== '') ? item8.manualPhone : '';
          changeTypes.push('Teléfono');
        } else {
          const target = (item8.manualPhone != null ? item8.manualPhone : item8.formattedPhone)
            || _fmtPhone(r[telIdx], item8.country.callingCode);
          if (target && target !== r[telIdx]) { r[telIdx] = target; changeTypes.push('Teléfono'); }
        }
      }
    }

    // Aplicar homologación de campos (paso 9)
    for (const [fiStr, map] of Object.entries(fieldHomolMaps)) {
      const fi = parseInt(fiStr);
      const cellVal = (r[fi] || '').trim();
      const cellKey = cellVal.toLowerCase().normalize('NFC');
      const mapped = map.get(cellKey);
      if (mapped !== undefined && mapped !== cellVal) {
        r[fi] = mapped;
        changeTypes.push('Homologación');
      }
    }

    // Aplicar nombre/apellido IA (paso 10) — guarda lo que quedó en el input
    const item10 = nameaiMap.get(ri);
    if (item10) {
      if (nameaiIdx >= 0 && item10.editNombre && item10.editNombre !== (r[nameaiIdx] || '').trim()) {
        r[nameaiIdx] = item10.editNombre;
        changeTypes.push('Nombre IA');
      }
      if (apellaiIdx >= 0 && item10.editApellido && item10.editApellido !== (r[apellaiIdx] || '').trim()) {
        r[apellaiIdx] = item10.editApellido;
        changeTypes.push('Apellido IA');
      }
    }

    if (changeTypes.length) {
      changeLog.push({ fila: ri + 2, emailOriginal: orig, emailFinal: r[colIdx], tipoCambio: changeTypes.join(' + ') });
    }

    finalRows.push({ row: r, rowIdx: ri, changed: changeTypes.length > 0, orig, final: r[colIdx] });
  });

  return { finalRows, changeLog, dupLog, testLog };
}

// ── Generar badge HTML ───────────────────────────────────────
const BADGE_MAP = {
  gmail:   'b-gmail',
  hotmail: 'b-hotmail',
  outlook: 'b-outlook',
  yahoo:   'b-yahoo',
  custom:  'b-custom',
  learned: 'b-learned',
};
export function providerBadge(provider) {
  const cls = BADGE_MAP[provider] || 'b-custom';
  return `<span class="badge ${cls}">${provider}</span>`;
}

// ── Tabla editable base ──────────────────────────────────────
/**
 * Crear una fila de tabla con checkbox, número de fila, y celda editable
 */
export function makeEditRow({ checked, rowIdx, original, displayValue, corrected, badgeHtml = '', onCheck, onInput, onRestore, extraCols = '' }) {
  const tr  = document.createElement('tr');
  const mod = displayValue && displayValue !== corrected;
  tr.className = checked ? 'row-on' : '';

  tr.innerHTML = `
    <td><div class="cbc"><input type="checkbox" ${checked ? 'checked' : ''}></div></td>
    <td><span class="mono t-dim">${rowIdx + 2}</span></td>
    <td><span class="t-orig">${esc(original)}</span></td>
    <td><div class="ewrap">
      ${displayValue !== original ? `<span class="t-bad">${esc(original)}</span><span class="arr">→</span>` : ''}
      <input class="ei${mod ? ' mod' : ''}" value="${esc(displayValue || corrected)}" placeholder="Ingresá corrección…">
      ${mod ? `<button class="restore" title="Restaurar">↺</button>` : ''}
    </div></td>
    ${badgeHtml ? `<td>${badgeHtml}</td>` : ''}
    ${extraCols}`;

  tr.querySelector('input[type=checkbox]').addEventListener('change', e => onCheck(e.target.checked, tr));
  const inp = tr.querySelector('.ei');
  inp.addEventListener('input', e => onInput(e.target.value, e.target));
  const rb = tr.querySelector('.restore');
  if (rb) rb.addEventListener('click', () => onRestore(tr));

  return tr;
}
