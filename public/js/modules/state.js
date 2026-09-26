/**
 * state.js — Estado global con patrón observable
 * DataB Flow · Cleaning | Transformation | Governance · © 2026 mdmarein · GNU AGPLv3
 */

import { BASE_WHITELIST, BASE_JUNK_COMPANIES, DEFAULT_ENABLED_STEPS } from './config.js';

// Convierte una lista de strings (con posibles wildcards) a { exactSet, patterns }.
// Wildcard: 'hotmail.com.*' → RegExp ^hotmail\.com\..+$
function _buildWL(domains) {
  const exactSet = new Set();
  const patterns = [];
  for (const d of domains) {
    if (d.includes('*')) {
      const escaped = d.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.+');
      patterns.push(new RegExp('^' + escaped + '$'));
    } else {
      exactSet.add(d);
    }
  }
  return { exactSet, patterns };
}

// Estado inicial
const _initial = () => {
  const { exactSet, patterns } = _buildWL(BASE_WHITELIST);
  return {
  step: 1,
  csv: null,       // { headers: [], rows: [] }
  colIdx: -1,
  emailColName: null,
  confirmedNombreIdx:   null,  // null = no detectado aún; -1 = ninguno; ≥0 = columna confirmada
  confirmedApellidoIdx: null,
  confirmedEmpresaIdx:  null,
  confirmedTelIdx:      null,
  confirmedPaisIdx:     null,
  confirmedNombreColName:   null,  // nombre de columna para recomputar idx tras edits
  confirmedApellidoColName: null,
  confirmedEmpresaColName:  null,
  confirmedTelColName:      null,
  confirmedPaisColName:     null,
  filename: '',
  csvStartRow: 0,          // fila usada como header (0 = primera fila)
  selectedColumns: null,      // null = all columns; array of indices to keep in export
  selectedColumnNames: null,  // nombres de columnas seleccionadas para recomputar tras edits
  enabledSteps: { ...DEFAULT_ENABLED_STEPS },
  omittedSteps: {},
  _flowConfig: null,       // loaded from server, keyed by filename pattern
  // Configuración persistida (cargada desde servidor al inicio)
  defaultDomainRules: [],   // cargado desde domain-rules-default.json (solo lectura)
  customRules: [],
  defaultRuleExclusions: [],
  defaultValidDomains: [],    // domain-valid-default.json (solo lectura en UI)
  defaultValidExclusions: [], // dominios del default excluidos por el usuario
  customWL: [],               // dominios válidos custom agregados por el usuario
  suffixRules: { validTlds: [], rules: [] },
  whitelist: exactSet,
  whitelistPatterns: patterns,
  testPatterns: ['test'],   // patrones de detección de filas de prueba
  // Resultados por paso
  valItems: [],    // { rowIdx, original, autoFixed, manualValue, issues, checked }
  domItems: [],    // { rowIdx, emailIn, original, corrected, provider, manualValue, checked }
  dupGroups: [],   // { email, rows[], keepRowIdxs: Set }
  dupExcluded: new Set(),
  dupCols: new Set(),
  _idCols: new Set(),
  testItems: [],   // { rowIdx, row, matchedFields, checked }
  testExcluded: new Set(),
  empresaIdx: -1,
  companyNorms: [], // { key, displayName, rowIdxs, newName, clear, learned }
  customJunkCompanies:   [], // patrones custom del usuario (persisten en enterprise-clean.json)
  customJunkExclusions:  [], // valores excluidos manualmente de la lista base/learned
  homologateRules:       [], // [{ find, replace }] — cargado desde enterprise-homologate.json
  // Paso 8 — País y teléfono
  paisIdx:     -1,
  telIdx:      -1,
  step8Items:  [],  // { rowIdx, email, phone, country, source }  source: 'email'|'phone'|'column'|'manual'|null
  countryData: [],  // array de países cargado desde country.json (persiste entre resets)
  // Paso 9 — Homologación de campos
  fieldSelectedCols: [],  // [colIdx, ...] — campos seleccionados por el usuario
  fieldNorms:        {},  // { colIdx: [{key, displayValue, rowIdxs, newValue, source, changed}] }
  fieldLibraries:    [],  // [{ id, name, values }] — persiste entre sesiones
  fieldPresets:      [],  // [{ id, name, fieldHint, libraryId, mappings }] — persiste entre sesiones
  fieldAssignments:  {},  // { colIdx: libraryId | null }
  // Paso 9 IA — status del provider y prompt template
  aiStatus10:          'checking',
  fieldAIPrompt:      '',   // prompt activo (custom o default)
  _fieldDefaultPrompt: '',  // default cargado desde ai-prompts-default.json (para reset)
  // Paso 10 — Completar Nombre/Apellido con IA
  nameaiIdx:    -1,   // índice columna Nombre (-1 = no detectada)
  apellaiIdx:   -1,   // índice columna Apellido
  nameaiItems:  [],   // [{ rowIdx, email, origNombre, origApellido, aiNombre, aiApellido,
                      //    editNombre, editApellido, checked, status, needsNom, needsApell }]
                      // status: 'pending'|'done'|'error'
  nameaiFields: [],   // ['nombre','apellido'] — cuáles columnas procesar
  aiPrompt:     '',   // prompt editable cargado desde ai-config.json
  homoSessionCount:     0,   // cantidad de sesiones de homo completadas vía "Otro"
  homoSessionSummaries: [], // [{ label, fieldNames, destName, completados, total }]
  // Paso 11 — Etiquetas
  tagSrcCol:        -1,
  tagTargetMode:   'new',
  tagTargetName:   'Tags',
  tagTargetColIdx:  -1,
  tagLibraries:    [],
  tagLibEntries:   [],
  tagLibName:      '',
  tagSelectedLibId: '',
  tagGlobalTag:    '',
  tagResults:      [],   // [{value, tag, status:'match'|'no-match'|'ia'|'manual', rowIdxs}]
  tagPromptMatch:  '',
  aiStatus11:      'checking',
  // Para exports
  _finalRows: null,
  _changeLog:  null,
  _dupLog:     null,
  _testLog:    null,
  // Learning (cargado desde servidor)
  learning: null,
  // Editor CSV
  csvOriginal:       null,        // copia del csv antes de editar (para undo completo)
  editorDeletedCols:  new Set(),   // nombres de columnas eliminadas por el editor
  editorDisplayCols:  null,          // [{ type:'real'|'ghost', name, values? }] — orden visual con fantasmas
  editorAddedCols:    new Set(),     // nombres de columnas agregadas por split
  editorCellEdits:   0,           // count de celdas editadas inline
  editorEditedCells: new Set(),   // "ri:ci" de celdas editadas directamente
  editorOpsCount:    0,           // count de operaciones de herramienta aplicadas
  editorToolsUsed:   new Set(),   // IDs de herramientas usadas
  prepFormats:       { number: [], currency: [], percent: [], date: [] }, // presets server-side de formato
  prepHistory:       [],          // stack de { csv, label } para undo (máx 30)
  };
};

let _state = _initial();
const _listeners = new Set();

/** Suscribirse a cambios de estado */
export function subscribe(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

function _notify() {
  _listeners.forEach(fn => fn(_state));
}

/** Leer estado (inmutable desde afuera) */
export function getState() {
  return _state;
}

/** Actualizar estado parcial */
export function setState(partial) {
  _state = { ..._state, ...partial };
  _notify();
}

/** Reset completo — preservar configuración persistida */
export function resetSession() {
  const { defaultDomainRules, customRules, defaultRuleExclusions,
    defaultValidDomains, defaultValidExclusions, customWL,
    whitelist, whitelistPatterns, learning, testPatterns,
    customJunkCompanies, customJunkExclusions, homologateRules, countryData,
    fieldLibraries, fieldPresets,
    enabledSteps, _flowConfig,
    prepFormats, suffixRules } = _state;
  _state = { ..._initial(), defaultDomainRules, customRules, defaultRuleExclusions,
    defaultValidDomains, defaultValidExclusions, customWL,
    whitelist, whitelistPatterns, learning,
    testPatterns, customJunkCompanies, customJunkExclusions, homologateRules, countryData,
    fieldLibraries, fieldPresets,
    enabledSteps, _flowConfig,
    prepFormats, suffixRules };
  _notify();
}

/** Reconstruir whitelist desde default (menos exclusiones) + customWL */
export function rebuildWhitelist() {
  const excl = new Set(_state.defaultValidExclusions);
  const effective = [
    ..._state.defaultValidDomains.filter(d => !excl.has(d)),
    ..._state.customWL,
  ];
  const { exactSet, patterns } = _buildWL(effective);
  _state.whitelist = exactSet;
  _state.whitelistPatterns = patterns;
}

/**
 * Construir sets de junk (base + custom + learned) descontando exclusiones.
 * Retorna { exactSet, patterns } donde patterns son substrings de *valor*.
 */
export function buildJunkSet(customJunkCompanies, learnedJunk = [], exclusions = []) {
  const exclusionSet = new Set(exclusions.map(s => s.toLowerCase().normalize('NFC')));
  const exactSet = new Set();
  const patterns = [];

  const all = [
    ...BASE_JUNK_COMPANIES,
    ...customJunkCompanies.map(s => s.toLowerCase().normalize('NFC')),
    ...learnedJunk.map(s => s.toLowerCase().normalize('NFC')),
  ];

  for (const j of all) {
    if (exclusionSet.has(j)) continue;
    if (j.startsWith('*') && j.endsWith('*')) {
      const inner = j.slice(1, -1).trim();
      if (inner) patterns.push(inner);
    } else {
      exactSet.add(j);
    }
  }
  return { exactSet, patterns };
}

/** Chequea si una empresa (ya normalizada) matchea el junk set */
export function isCompanyJunk(normalizedKey, exactSet, patterns) {
  if (exactSet.has(normalizedKey)) return true;
  // Solo puntuación / espacios
  if (/^[.\-\s/–—x]+$/.test(normalizedKey)) return true;
  // Wildcard: solo marca si TODAS las palabras significativas (>1 char) son junk
  // (solo tokens de 1 char como "y", "e", "a" son transparentes; "fd", "de", "sa" son significativos)
  if (patterns.length > 0) {
    const words = normalizedKey.split(/[^a-záéíóúüñ0-9]+/).filter(w => w.length > 1);
    if (words.length > 0 && words.every(w => exactSet.has(w) || patterns.some(p => w.includes(p)))) {
      return true;
    }
  }
  return false;
}

/**
 * Aplica reglas de homologación sobre un nombre de empresa. Retorna { result, changed }.
 * Soporta wildcard `*` = cualquier secuencia de chars no-espacio ([^\s]*).
 * Los límites de palabra solo se aplican en los extremos que NO tienen `*`.
 * replace puede ser cadena vacía (elimina el texto encontrado).
 */
export function applyHomologateRules(name, rules) {
  if (!name || !rules?.length) return { result: name, changed: false };
  let result = name;
  for (const { find, replace } of rules) {
    if (!find || replace == null) continue;
    const startsWild = find.startsWith('*');
    const endsWild   = find.endsWith('*');
    const rawParts   = find.split('*');
    // Escapar cada parte entre los `*` y unirlas con el wildcard regex
    const parts = rawParts.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const inner  = parts.join('[^\\s]*');
    // Los límites de palabra solo se aplican cuando el extremo empieza/termina
    // con un carácter alfanumérico — si empieza con '.' el boundary bloquearía
    // matches como '.com.ar' precedido por letras ('gateway.com.ar').
    const rawFirst = rawParts.find(p => p.length > 0)?.[0]     ?? '';
    const rawLast  = [...rawParts].reverse().find(p => p.length > 0)?.slice(-1) ?? '';
    const lead  = startsWild ? '' : (/[a-zA-Z0-9_]/.test(rawFirst) ? '(?<![a-zA-Z0-9_])' : '');
    const trail = endsWild   ? '' : (/[a-zA-Z0-9_]/.test(rawLast)  ? '(?![a-zA-Z0-9_])'  : '');
    const re = new RegExp(`${lead}${inner}${trail}`, 'gi');
    result = result.replace(re, replace);
  }
  return { result, changed: result !== name };
}

