/**
 * csv-worker.js — Web Worker para procesamiento pesado de CSV
 * Corre en hilo separado para no bloquear la UI.
 * DataB Flow · Cleaning | Transformation | Governance · © 2026 mdmarein · GNU AGPLv3
 */

import { autoFixEmail } from '../modules/validator.js';
import { correctDomain } from '../modules/domains.js';
import { findDuplicates } from '../modules/duplicates.js';
import { buildJunkSet, isCompanyJunk } from '../modules/state.js';
import { kwMatchEmail, kwMatchField } from '../modules/keywords.js';

function post(type, result) { self.postMessage({ type, result }); }
function prog(step, pct) { self.postMessage({ type: 'progress', step, pct }); }

function deserialize(p) {
  return {
    whitelist:          new Set(p.whitelist),
    whitelistPatterns:  (p.whitelistPatternSrc || []).map(({ source, flags }) => new RegExp(source, flags)),
    excludedDefaults:   new Set(p.defaultRuleExclusions || []),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  VALIDATE — paso 3
//  Payload: { emailCol: string[], skipTranslit: bool }
// ═══════════════════════════════════════════════════════════════════════════
function handleValidate({ emailCol, skipTranslit }) {
  const valItems = [];
  const n = emailCol.length;
  const CHUNK = 10000;

  for (let ri = 0; ri < n; ri++) {
    const val = emailCol[ri];
    if (val) {
      const { fixed, issues, changed } = autoFixEmail(val, { skipTranslit });
      if (issues.length) {
        valItems.push({ rowIdx: ri, original: val, autoFixed: fixed, manualValue: null, issues, checked: true, changed });
      }
    }
    if (ri % CHUNK === 0) prog('validate', Math.round(ri / n * 100));
  }

  post('validate:done', valItems);
}

// ═══════════════════════════════════════════════════════════════════════════
//  CORRECT DOMAINS — paso 4
//  Payload: { emailCol, whitelist, whitelistPatternSrc, customRules, learnedPatterns,
//             defaultRuleExclusions, defaultRules, valItemsSer }
// ═══════════════════════════════════════════════════════════════════════════
function handleCorrectDomains(p) {
  const { emailCol, customRules, learnedPatterns, valItemsSer, defaultRules = [] } = p;
  const { whitelist, whitelistPatterns, excludedDefaults } = deserialize(p);
  const n = emailCol.length;
  const CHUNK = 10000;

  // Map rowIdx → validación aceptada (para usar email corregido en paso 3)
  const valMap = new Map(valItemsSer.filter(v => v.checked).map(v => [v.rowIdx, v]));

  const domItems = [];
  for (let ri = 0; ri < n; ri++) {
    const orig = emailCol[ri];
    if (orig) {
      const vf      = valMap.get(ri);
      const emailIn = vf ? (vf.manualValue || vf.autoFixed) : orig;
      const res     = correctDomain(emailIn, whitelist, customRules, learnedPatterns, whitelistPatterns, excludedDefaults, defaultRules);
      if (res) domItems.push({ rowIdx: ri, emailIn, original: orig, ...res, manualValue: null, checked: true });
    }
    if (ri % CHUNK === 0) prog('correctDomains', Math.round(ri / n * 100));
  }

  post('correctDomains:done', domItems);
}

// ═══════════════════════════════════════════════════════════════════════════
//  FIND DUPLICATES — paso 5
//  Payload: { rows, headers, colIdx, dupColsArr, valItemsSer, domItemsSer }
// ═══════════════════════════════════════════════════════════════════════════
function handleFindDups({ rows, headers, colIdx, dupColsArr, valItemsSer, domItemsSer }) {
  prog('findDups', 10);
  const dupGroups = findDuplicates(
    { headers, rows },
    colIdx,
    new Set(dupColsArr),
    valItemsSer,
    domItemsSer,
  );
  prog('findDups', 100);

  // keepRowIdxs es un Set — serializar como Array para postMessage
  const serialized = dupGroups.map(g => ({
    ...g,
    keepRowIdxs: [...g.keepRowIdxs],
  }));
  post('findDups:done', serialized);
}

// ═══════════════════════════════════════════════════════════════════════════
//  ANALYZE — análisis previo al flujo
//  Payload: { emailCol, empresaCol?, paisCol?, telCol?, nombreCol?, apellidoCol?,
//             allCellsByRow?, colPresence, whitelist, whitelistPatternSrc,
//             customRules, learnedPatterns, defaultRuleExclusions, defaultRules,
//             testPatterns, customJunkCompanies, customJunkExclusions, learning }
// ═══════════════════════════════════════════════════════════════════════════
function handleAnalyze(p) {
  const {
    emailCol, empresaCol, paisCol, telCol, nombreCol, apellidoCol,
    allCellsByRow, colPresence,
    customRules, learnedPatterns, testPatterns,
    customJunkCompanies, customJunkExclusions, learning,
    defaultRules = [],
  } = p;
  const { whitelist, whitelistPatterns, excludedDefaults } = deserialize(p);
  const { empresaIdx, paisIdx, telIdx, nombreIdx, apellidoIdx } = colPresence;
  const n = emailCol.length;
  const CHUNK = 20000;

  const pats = testPatterns.length > 0 ? testPatterns : ['test'];
  let exactJunkSet, junkPatterns;
  if (empresaIdx >= 0) {
    const learnedJunk = learning?.learnedJunkCompanies || [];
    ({ exactSet: exactJunkSet, patterns: junkPatterns } = buildJunkSet(
      customJunkCompanies, learnedJunk, customJunkExclusions,
    ));
  }

  const affectedRows = new Set();
  let emailFormat = 0, emailDomain = 0, keywords = 0;
  let empresaEmpty = 0, empresaJunk = 0, emptyPais = 0, totalTel = 0, nombreEmpty = 0, apellidoEmpty = 0;

  for (let ri = 0; ri < n; ri++) {
    const row = allCellsByRow[ri]; // compact: only special columns
    if (!row.some(c => c)) continue;

    const val = emailCol[ri];

    if (val) {
      if (autoFixEmail(val, {}).issues.length) { emailFormat++; affectedRows.add(ri); }
      if (correctDomain(val, whitelist, customRules, learnedPatterns, whitelistPatterns, excludedDefaults, defaultRules)) { emailDomain++; affectedRows.add(ri); }
    }

    // Keywords (mismo criterio que el paso real: email + nombre/apellido/empresa)
    const kwMatch = (val && kwMatchEmail(val, pats))
      || (nombreIdx   >= 0 && nombreCol   && kwMatchField(nombreCol[ri]   || '', pats))
      || (apellidoIdx >= 0 && apellidoCol && kwMatchField(apellidoCol[ri] || '', pats))
      || (empresaIdx  >= 0 && empresaCol  && kwMatchField(empresaCol[ri]  || '', pats));
    if (kwMatch) { keywords++; affectedRows.add(ri); }

    if (empresaIdx >= 0 && empresaCol) {
      const e = empresaCol[ri];
      if (!e) { empresaEmpty++; affectedRows.add(ri); }
      else if (isCompanyJunk(e.toLowerCase().normalize('NFC'), exactJunkSet, junkPatterns)) { empresaJunk++; affectedRows.add(ri); }
    }

    if (paisIdx >= 0 && paisCol && !paisCol[ri]) { emptyPais++; affectedRows.add(ri); }
    if (telIdx  >= 0 && telCol  &&  telCol[ri])  { totalTel++;  affectedRows.add(ri); }

    if (val) {
      if (nombreIdx   >= 0 && nombreCol   && !nombreCol[ri])   { nombreEmpty++;  affectedRows.add(ri); }
      if (apellidoIdx >= 0 && apellidoCol && !apellidoCol[ri]) { apellidoEmpty++; affectedRows.add(ri); }
    }

    if (ri % CHUNK === 0) prog('analyze', Math.round(ri / n * 65));
  }

  // Duplicados — solo email (preview rápido)
  const emailMap = new Map();
  for (let ri = 0; ri < n; ri++) {
    const v = emailCol[ri];
    if (!v) continue;
    emailMap.set(v, (emailMap.get(v) || 0) + 1);
  }
  let duplicates = 0;
  for (const count of emailMap.values()) { if (count > 1) duplicates += count - 1; }
  prog('analyze', 80);

  // Homologación — muestreo de empresa si existe
  let homolCols = 0, homolUniqueTotal = 0;
  if (empresaCol) {
    const HOMOL_SAMPLE = 5000;
    const sample = empresaCol.length > HOMOL_SAMPLE
      ? (() => { const step = Math.ceil(empresaCol.length / HOMOL_SAMPLE); const out = []; for (let i = 0; i < empresaCol.length; i += step) { if (empresaCol[i]) out.push(empresaCol[i]); } return out; })()
      : empresaCol.filter(Boolean);

    const unique = [...new Set(sample.filter(v => !/^\d+$/.test(v)))];
    if (unique.length >= 3) {
      const wordFreq = {};
      unique.forEach(v => {
        new Set(v.toLowerCase().normalize('NFC').split(/[\s\-_,/]+/).filter(w => w.length > 2)).forEach(w => {
          wordFreq[w] = (wordFreq[w] || 0) + 1;
        });
      });
      if (Object.values(wordFreq).some(c => c >= 2)) { homolCols = 1; homolUniqueTotal = unique.length; }
    }
  }
  prog('analyze', 100);

  const total = emailCol.filter(Boolean).length;
  const stats = {
    total, emailFormat, emailDomain, duplicates, keywords,
    company:  { hasCol: empresaIdx  >= 0, total: empresaEmpty + empresaJunk, empty: empresaEmpty, junk: empresaJunk },
    country:  { hasCol: paisIdx     >= 0, emptyPais },
    phone:    { hasCol: telIdx      >= 0, totalTel  },
    nombre:   { hasCol: nombreIdx   >= 0, empty: nombreEmpty   },
    apellido: { hasCol: apellidoIdx >= 0, empty: apellidoEmpty },
    homolog:  { cols: homolCols, uniqueTotal: homolUniqueTotal },
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
  };

  post('analyze:done', { stats, suggested });
}

// ═══════════════════════════════════════════════════════════════════════════
//  ROUTER
// ═══════════════════════════════════════════════════════════════════════════
self.onmessage = ({ data: msg }) => {
  try {
    switch (msg.type) {
      case 'analyze':         handleAnalyze(msg.payload);         break;
      case 'validate':        handleValidate(msg.payload);        break;
      case 'correctDomains':  handleCorrectDomains(msg.payload);  break;
      case 'findDups':        handleFindDups(msg.payload);        break;
      default:
        self.postMessage({ type: 'error', step: msg.type, message: `Tipo desconocido: ${msg.type}` });
    }
  } catch (err) {
    self.postMessage({ type: 'error', step: msg.type, message: err.message });
  }
};
