/**
 * prep.js — Funciones puras de transformación de CSV para el Editor
 * dataB Flow · © 2026 mdmarein · GNU AGPLv3
 *
 * Todas las funciones son inmutables: reciben un csv y devuelven uno nuevo.
 * csv = { headers: string[], rows: string[][], sep: string }
 */

// ── Helpers ──────────────────────────────────────────────────

function cloneCSV(csv) {
  return {
    headers: [...csv.headers],
    rows:    csv.rows.map(r => [...r]),
    sep:     csv.sep,
  };
}

// ── 1. Split por caracter ────────────────────────────────────

/**
 * Divide los valores de una columna por un delimitador.
 * La columna original se reemplaza por la primera parte,
 * y se insertan columnas nuevas para el resto.
 * @param {object} csv
 * @param {number} colIdx  índice de la columna a dividir
 * @param {string} delimiter  cadena delimitadora (puede ser un espacio)
 * @returns {{ csv: object, newColCount: number }}
 */
export function splitColumn(csv, colIdx, delimiter) {
  if (!delimiter) return { csv, newColCount: 0 };

  // Calcular max partes en todo el CSV
  let maxParts = 1;
  for (const row of csv.rows) {
    const val = row[colIdx] ?? '';
    const parts = val.split(delimiter);
    if (parts.length > maxParts) maxParts = parts.length;
  }

  const newColCount = maxParts - 1;
  if (newColCount === 0) return { csv, newColCount: 0 };

  const origHeader = csv.headers[colIdx] || `Col ${colIdx + 1}`;
  const newHeaders = [...csv.headers];
  // Insertar nuevos headers después de la columna original
  const insertedHeaders = Array.from({ length: newColCount }, (_, i) => `${origHeader}_${i + 2}`);
  newHeaders.splice(colIdx + 1, 0, ...insertedHeaders);

  const newRows = csv.rows.map(row => {
    const val    = row[colIdx] ?? '';
    const parts  = val.split(delimiter);
    // Rellenar hasta maxParts con vacíos
    while (parts.length < maxParts) parts.push('');
    const newRow = [...row];
    // Reemplazar la celda original + insertar las nuevas
    newRow.splice(colIdx, 1, ...parts);
    return newRow;
  });

  return {
    csv:        { headers: newHeaders, rows: newRows, sep: csv.sep },
    newColCount,
  };
}

/**
 * Preview del split: devuelve las primeras N filas con las partes separadas.
 */
export function splitPreview(csv, colIdx, delimiter, limit = 8) {
  if (!delimiter) return [];
  return csv.rows.slice(0, limit).map(row => {
    const val = row[colIdx] ?? '';
    return val.split(delimiter);
  });
}

// ── 2. Eliminar columnas ─────────────────────────────────────

/**
 * Elimina un conjunto de columnas (por índice).
 * @param {object} csv
 * @param {number[]} colIdxs  índices a eliminar
 */
export function deleteColumns(csv, colIdxs) {
  const toDelete = new Set(colIdxs);
  const newHeaders = csv.headers.filter((_, i) => !toDelete.has(i));
  const newRows    = csv.rows.map(row => row.filter((_, i) => !toDelete.has(i)));
  return { headers: newHeaders, rows: newRows, sep: csv.sep };
}

// ── 3. Reordenar columnas ────────────────────────────────────

/**
 * Reordena las columnas según el array de índices originales.
 * @param {object} csv
 * @param {number[]} newOrder  array de índices en el nuevo orden deseado
 */
export function reorderColumns(csv, newOrder) {
  const newHeaders = newOrder.map(i => csv.headers[i] ?? '');
  const newRows    = csv.rows.map(row => newOrder.map(i => row[i] ?? ''));
  return { headers: newHeaders, rows: newRows, sep: csv.sep };
}

// ── 4. Renombrar columna ─────────────────────────────────────

/**
 * Renombra una o varias columnas.
 * @param {object} csv
 * @param {{ [colIdx: number]: string }} renames
 */
export function renameColumns(csv, renames) {
  const result = cloneCSV(csv);
  for (const [idx, name] of Object.entries(renames)) {
    result.headers[Number(idx)] = name;
  }
  return result;
}

// ── 5. Formato de columna ────────────────────────────────────

/**
 * Aplica un patrón de formato a todos los valores de una columna.
 * @param {object} csv
 * @param {number} colIdx
 * @param {'number'|'date'|'text'} type
 * @param {string} pattern
 */
export function formatColumn(csv, colIdx, type, pattern) {
  const result = cloneCSV(csv);
  result.rows = result.rows.map(row => {
    const newRow = [...row];
    newRow[colIdx] = _applyFormat(row[colIdx] ?? '', type, pattern);
    return newRow;
  });
  return result;
}

function _applyFormat(val, type, pattern) {
  if (type === 'text')     return val;
  if (type === 'number')   return _formatNumber(val, pattern);
  if (type === 'percent')  return _formatNumber(val, pattern);
  if (type === 'date')     return _formatDate(val, pattern);
  if (type === 'currency') {
    const numPat = pattern.startsWith('$') ? pattern.slice(1) : pattern;
    const clean  = String(val).trim().replace(/^\$\s*/, '');
    const parsed = parseFloat(clean.replace(/\./g, '').replace(',', '.'));
    if (isNaN(parsed)) return val;
    return '$' + _formatNumber(clean, numPat);
  }
  return val;
}

// Formatea un número con convención argentina: '.' miles, ',' decimal
// Patrón: '0000' sin sep, '0.000' miles con punto, '0000,00' decimales con coma,
//         '0.000,00' ambos; sufijo '%' opcional.
function _formatNumber(val, pattern) {
  const isPercent    = pattern.endsWith('%');
  const pat          = isPercent ? pattern.slice(0, -1) : pattern;

  // Parsear valor en convención argentina: quitar puntos de miles, coma → punto decimal
  const clean = String(val).trim().replace(/\./g, '').replace(',', '.');
  const n = parseFloat(clean);
  if (isNaN(n)) return val;

  // Patrón de cero inicial: solo dígitos cero (ej. "00" → mínimo 2 dígitos con padding)
  if (/^0+$/.test(pat)) {
    return Math.trunc(Math.abs(n)).toString().padStart(pat.length, '0');
  }

  const hasThousands = pat.includes('.');
  const decMatch     = pat.match(/,(\d+)$/);
  const decimals     = decMatch ? decMatch[1].length : 0;

  const fixed = n.toFixed(decimals);           // siempre usa punto como decimal
  const [intPart, decPart] = fixed.split('.');
  const intFormatted = hasThousands
    ? intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
    : intPart;
  const result = decimals > 0 && decPart !== undefined
    ? `${intFormatted},${decPart}`
    : intFormatted;
  return isPercent ? result + '%' : result;
}

export function formatSample(val, type, pattern) {
  return _applyFormat(String(val ?? ''), type, pattern);
}

function _formatDate(val, pattern) {
  if (!val.trim()) return val;
  // Intentar parsear el valor como fecha
  const d = _parseDate(val.trim());
  if (!d) return val;
  return pattern
    .replace('yyyy', String(d.year))
    .replace('yy',   String(d.year).slice(-2))
    .replace('mm',   String(d.month).padStart(2, '0'))
    .replace('dd',   String(d.day).padStart(2, '0'));
}

function _parseDate(str) {
  // Formatos comunes: dd/mm/yyyy, yyyy-mm-dd, dd-mm-yyyy, mm/dd/yyyy
  const patterns = [
    /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/,  // dd/mm/yyyy o mm/dd/yyyy
    /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/,  // yyyy-mm-dd
    /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/,  // dd/mm/yy
  ];
  for (const p of patterns) {
    const m = str.match(p);
    if (m) {
      const [, a, b, c] = m;
      if (c.length === 4) {
        // Asumir dd/mm/yyyy
        return { day: parseInt(a), month: parseInt(b), year: parseInt(c) };
      }
      if (a.length === 4) {
        // yyyy-mm-dd
        return { day: parseInt(c), month: parseInt(b), year: parseInt(a) };
      }
      // dd/mm/yy
      const year = parseInt(c) + (parseInt(c) < 50 ? 2000 : 1900);
      return { day: parseInt(a), month: parseInt(b), year };
    }
  }
  const d = new Date(str);
  if (!isNaN(d)) return { day: d.getDate(), month: d.getMonth() + 1, year: d.getFullYear() };
  return null;
}

// ── 6. Quitar espacios y delimitadores ───────────────────────

/**
 * Aplica uno o varios modos de limpieza de espacios a una columna.
 * @param {object} csv
 * @param {number} colIdx
 * @param {string[]} modes  lista de modos a aplicar
 */
export function applySpaces(csv, colIdx, modes) {
  const result = cloneCSV(csv);
  result.rows = result.rows.map(row => {
    const newRow = [...row];
    newRow[colIdx] = _applySpaceModes(row[colIdx] ?? '', modes);
    return newRow;
  });
  return result;
}

export function applySpacesValue(val, modes) {
  return _applySpaceModes(val, modes);
}

function _applySpaceModes(val, modes) {
  let v = val;
  for (const mode of modes) {
    switch (mode) {
      case 'leading':     v = v.trim(); break;
      case 'between':     v = v.replace(/\s{2,}/g, ' '); break;
      case 'all':         v = v.replace(/\s/g, ''); break;
      case 'extra':       v = v.trim().replace(/\s{2,}/g, ' '); break;
      case 'linebreaks':  v = v.replace(/[\r\n]+/g, ' ').trim(); break;
      case 'html_ent':    v = v.replace(/&[a-z]+;|&#\d+;/gi, ''); break;
      case 'html_tags':   v = v.replace(/<[^>]*>/g, ''); break;
      case 'delimiters':  v = v.replace(/[,;|\/\\]+/g, ''); break;
      case 'nonprint':    v = v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ''); break;
    }
  }
  return v;
}

// ── 7. Quitar caracteres por posición ────────────────────────

/**
 * Quita caracteres según el modo especificado.
 * @param {object} csv
 * @param {number} colIdx
 * @param {'from_to'|'first_last'|'before_after'} mode
 * @param {object} opts
 */
export function applyRemoveByPos(csv, colIdx, mode, opts) {
  const result = cloneCSV(csv);
  result.rows = result.rows.map(row => {
    const newRow = [...row];
    newRow[colIdx] = _removeByPos(row[colIdx] ?? '', mode, opts);
    return newRow;
  });
  return result;
}

export function removeByPosValue(val, mode, opts) {
  return _removeByPos(val, mode, opts);
}

function _removeByPos(val, mode, opts) {
  if (!val) return val;
  if (mode === 'from_to') {
    if (!opts.from && !opts.to) return val;   // 0,0 = sin acción
    const from = Math.max(0, (opts.from || 1) - 1);
    const to   = Math.min(val.length, opts.to || 0);
    return val.slice(0, from) + val.slice(to);
  }
  if (mode === 'first_last') {
    const n = opts.n ?? 1;
    return opts.side === 'last' ? val.slice(0, -n) : val.slice(n);
  }
  if (mode === 'before_after') {
    const text  = opts.text ?? '';
    if (!text) return val;
    const flags = opts.matchCase ? '' : 'i';
    const idx   = val.search(new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags));
    if (idx === -1) return val;
    if (opts.side === 'before') return val.slice(idx);
    return val.slice(0, idx + text.length);
  }
  return val;
}

// ── 8. Change case ───────────────────────────────────────────

const _CONNECTORS = new Set([
  'de','del','la','las','los','el','en','y','a','o','e','u',
  'al','con','por','para','sin','que','como','of','the','and',
  'or','in','at','to','for','with','by','from','as','an','a',
]);

// Precompilado — evita construir el objeto RegExp en cada iteración
const _RE_LETTER    = /\p{L}/u;
const _RE_WORD_TOKS = /\p{L}+|\P{L}+/gu;

/**
 * Aplica una transformación de case a toda una columna.
 * @param {object} csv
 * @param {number} colIdx
 * @param {string} mode
 */
export function applyCase(csv, colIdx, mode) {
  const result = cloneCSV(csv);
  result.rows = result.rows.map(row => {
    const newRow = [...row];
    newRow[colIdx] = applyCaseValue(row[colIdx] ?? '', mode);
    return newRow;
  });
  return result;
}

export function applyCaseValue(val, mode) {
  // NFC primero: garantiza que á, ñ, ü, etc. sean codepoints únicos (no base+combining mark)
  // Sin esto, NFD input rompe las funciones de capitalización
  const s = (val || '').normalize('NFC');
  switch (mode) {
    case 'lower':         return s.toLowerCase();
    case 'upper':         return s.toUpperCase();
    case 'capitalize':    return _capitalize(s);
    case 'lower_cap':     return _capitalize(s.toLowerCase());
    case 'lower_cap_w':   return _capitalizeWords(s.toLowerCase());
    case 'sentence':      return _sentenceCase(s);
    case 'toggle':        return _toggleCase(s);
    default:              return val;
  }
}

function _capitalize(s) {
  let result = '';
  let afterNonLetter = true;
  for (const ch of s) {
    if (_RE_LETTER.test(ch)) {
      result += afterNonLetter ? ch.toUpperCase() : ch;
      afterNonLetter = false;
    } else {
      result += ch;
      afterNonLetter = true;
    }
  }
  return result;
}

function _capitalizeWords(s) {
  // lastIndex se resetea en cada llamada porque el flag /g es stateful en la instancia
  const tokens = [...s.matchAll(new RegExp(_RE_WORD_TOKS.source, _RE_WORD_TOKS.flags))].map(m => m[0]);
  let isFirst = true;
  return tokens.map(token => {
    if (!_RE_LETTER.test(token[0])) return token;
    if (isFirst) { isFirst = false; return token[0].toUpperCase() + token.slice(1); }
    return _CONNECTORS.has(token.toLowerCase()) ? token : token[0].toUpperCase() + token.slice(1);
  }).join('');
}

function _sentenceCase(s) {
  if (!s) return s;
  const lower = s.toLowerCase();
  // Buscar la primera letra Unicode para no capitalizar un espacio o símbolo inicial
  return lower.replace(/\p{L}/u, ch => ch.toUpperCase());
}

function _toggleCase(s) {
  // [...s] itera por codepoints Unicode (correcto para surrogate pairs / emoji)
  return [...s].map(c => c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()).join('');
}

// ── 9. Agregar texto por posición ────────────────────────────

/**
 * Agrega texto al inicio o final de cada celda de una columna.
 * @param {object} csv
 * @param {number} colIdx
 * @param {string} text
 * @param {'start'|'end'} position
 * @param {boolean} skipEmpty
 */
export function applyAddText(csv, colIdx, text, position, skipEmpty, betweenN = 2) {
  const result = cloneCSV(csv);
  result.rows = result.rows.map(row => {
    const newRow = [...row];
    newRow[colIdx] = addTextValue(row[colIdx] ?? '', text, position, skipEmpty, betweenN);
    return newRow;
  });
  return result;
}

export function addTextValue(val, text, position, skipEmpty, betweenN = 2) {
  if (skipEmpty && !val.trim()) return val;
  if (position === 'between') {
    const n = Math.max(1, parseInt(betweenN) || 2);
    const chunks = [];
    for (let i = 0; i < val.length; i += n) chunks.push(val.slice(i, i + n));
    return chunks.join(text);
  }
  return position === 'start' ? text + val : val + text;
}

// ── 10. Reemplazar ───────────────────────────────────────────

/**
 * Aplica múltiples pares find/replace a toda una columna.
 * @param {object} csv
 * @param {number} colIdx
 * @param {{ find: string, replace: string }[]} pairs
 */
export function applyReplace(csv, colIdx, pairs) {
  const result = cloneCSV(csv);
  result.rows = result.rows.map(row => {
    const newRow = [...row];
    newRow[colIdx] = replaceValue(row[colIdx] ?? '', pairs);
    return newRow;
  });
  return result;
}

export function replaceValue(val, pairs) {
  let v = val;
  for (const { find, replace } of pairs) {
    if (!find) continue;
    v = v.split(find).join(replace ?? '');
  }
  return v;
}

// ── Aplicar lista de operaciones a una columna ───────────────

/**
 * Aplica una lista de operaciones acumuladas a una columna.
 * Cada op: { type, ...options }
 */
export function addColumn(csv, name) {
  return {
    headers: [name, ...csv.headers],
    rows: csv.rows.map(r => ['', ...r]),
    sep: csv.sep,
  };
}

export function mergePreview(csv, idxs, sep, skipEmpty, n = 6) {
  return csv.rows.slice(0, n).map(row => {
    const parts    = idxs.map(i => row[i] ?? '');
    const filtered = skipEmpty ? parts.filter(p => p !== '') : parts;
    return { parts, result: filtered.join(sep) };
  });
}

export function mergeColumns(csv, idxs, sep, skipEmpty, deleteSources = false, customHeader = null) {
  const mergedHeader = customHeader || idxs.map(i => csv.headers[i]).join('+');
  const rows = csv.rows.map(row => {
    const parts = idxs.map(i => row[i] ?? '');
    const joined = skipEmpty ? parts.filter(p => p !== '').join(sep) : parts.join(sep);
    return [joined, ...row];
  });
  let headers = [mergedHeader, ...csv.headers];
  let finalRows = rows;
  if (deleteSources) {
    // idxs are 0-based in original csv; after prepend they shift by 1
    const toRemove = new Set(idxs.map(i => i + 1));
    headers = headers.filter((_, i) => !toRemove.has(i));
    finalRows = rows.map(r => r.filter((_, i) => !toRemove.has(i)));
  }
  return { headers, rows: finalRows, sep: csv.sep };
}

export function applyCellOps(csv, colIdx, ops) {
  let result = csv;
  for (const op of ops) {
    switch (op.type) {
      case 'spaces':     result = applySpaces(result, colIdx, op.modes);   break;
      case 'remove_pos': result = applyRemoveByPos(result, colIdx, op.mode, op.opts); break;
      case 'case':       result = applyCase(result, colIdx, op.mode);       break;
      case 'add_text':   result = applyAddText(result, colIdx, op.text, op.position, op.skipEmpty); break;
      case 'replace':    result = applyReplace(result, colIdx, op.pairs);   break;
      case 'format':     result = formatColumn(result, colIdx, op.ftype, op.pattern); break;
    }
  }
  return result;
}
