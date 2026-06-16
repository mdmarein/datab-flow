/**
 * parser.js — Parser y serializer CSV (RFC 4180)
 * Soporta: \n dentro de campos quoted, separador auto-detectado (, o ;)
 * dataB Flow · Cleaning | Transformation | Governance · © 2026 mdmarein · GNU AGPLv3
 */

/**
 * Parsear texto CSV a { headers, rows }
 * Maneja campos con saltos de línea internos (RFC 4180 compliant)
 */
export function parseCSV(text, startRow = 0) {
  const raw = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Auto-detectar separador: tab (TSV) > punto y coma > coma
  const firstLine = raw.split('\n')[0];
  const tabs   = (firstLine.match(/\t/g)  || []).length;
  const semis  = (firstLine.match(/;/g)   || []).length;
  const commas = (firstLine.match(/,/g)   || []).length;
  const sep = tabs > 0 && tabs >= semis && tabs >= commas ? '\t'
            : semis > commas ? ';' : ',';

  // Autómata de estados RFC 4180
  const rows = [];
  let row  = [];
  let cell = '';
  let inQ  = false;
  let i    = 0;

  while (i < raw.length) {
    const ch = raw[i];
    if (inQ) {
      if (ch === '"') {
        if (raw[i + 1] === '"') { cell += '"'; i += 2; } // "" → literal "
        else                    { inQ = false; i++;     } // cierre
      } else {
        cell += ch; i++; // incluye \n internos
      }
    } else {
      if      (ch === '"')  { inQ = true; i++; }
      else if (ch === sep)  { row.push(cell); cell = ''; i++; }
      else if (ch === '\n') { row.push(cell); cell = ''; rows.push(row); row = []; i++; }
      else                  { cell += ch; i++; }
    }
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }

  const nonempty = rows.filter(r => r.some(c => c.trim()));
  if (!nonempty.length) return { headers: [], rows: [] };

  // Normalizar longitud de filas al largo del header
  const headerIdx = Math.min(Math.max(0, startRow), nonempty.length - 1);
  const headers  = nonempty[headerIdx];
  const ncols    = headers.length;
  const dataRows = nonempty.slice(headerIdx + 1).map(r => {
    if (r.length === ncols) return r;
    if (r.length  < ncols) return [...r, ...Array(ncols - r.length).fill('')];
    return r.slice(0, ncols);
  });

  return { headers, rows: dataRows, sep };
}

/**
 * Serializar { headers, rows } a string CSV
 */
export function toCSV(headers, rows, sep = ',') {
  const escapeCell = v => {
    const s = String(v ?? '');
    const needsQuote = s.includes(sep) || s.includes('"') || s.includes('\n') || s.includes('\r') || s.startsWith('+');
    return needsQuote ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [headers, ...rows].map(row => row.map(escapeCell).join(sep)).join('\n');
}

/**
 * Generar un hash simple del esquema (lista de columnas)
 * Usado para recordar preferencias de duplicados por esquema
 */
export function schemaHash(headers) {
  const str = headers.map(h => h.trim().toLowerCase()).join('|');
  // FNV-1a 32-bit: mejor distribución que djb2 para strings cortas con mismo prefijo
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * Detectar columnas que parecen IDs auto-incrementales
 */
export function detectIdColumns(headers, rows) {
  const idCols = new Set();
  headers.forEach((h, i) => {
    const name = h.trim().toLowerCase();
    if (/^id$/i.test(name) || /_id$/i.test(name)) { idCols.add(i); return; }
    if (rows.length < 2) return;
    const vals = rows.map(r => (r[i] || '').trim());
    const hasValues  = vals.filter(v => v).length;
    const allNumeric = vals.every(v => !v || /^\d+$/.test(v));
    const allUnique  = new Set(vals.filter(v => v)).size === hasValues;
    if (allNumeric && allUnique && hasValues > rows.length * 0.85) idCols.add(i);
  });
  return idCols;
}
