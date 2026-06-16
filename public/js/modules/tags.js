/**
 * Motor de matching para Etiquetas de campo.
 * Agrupa filas por valor único del campo fuente y busca el tag correspondiente en la librería.
 */

function _normalize(str) {
  return (str || '').toString().trim().toLowerCase().normalize('NFC');
}

/**
 * Agrupa filas del CSV por valor único del campo fuente y asigna tag si hay match en la librería.
 * @param {Object} csv - { headers, rows }
 * @param {number} srcColIdx - índice del campo fuente
 * @param {Array}  entries   - [{ value, tag }] — entradas de la librería activa
 * @returns {Array} [{value, tag, status:'match'|'no-match', rowIdxs}]
 */
export function groupTagResults(csv, srcColIdx, entries) {
  if (!csv || srcColIdx < 0) return [];

  // Construir mapa de valor normalizado → tag desde la librería
  const libMap = new Map();
  for (const entry of (entries || [])) {
    const key = _normalize(entry.value);
    if (key) libMap.set(key, entry.tag || '');
  }

  // Agrupar filas por valor del campo fuente
  const groups = new Map(); // valor original → { rowIdxs[], normalizedKey }
  for (let ri = 0; ri < csv.rows.length; ri++) {
    const raw = (csv.rows[ri][srcColIdx] ?? '').toString().trim();
    if (!raw) continue;
    if (!groups.has(raw)) groups.set(raw, { rowIdxs: [], normalizedKey: _normalize(raw) });
    groups.get(raw).rowIdxs.push(ri);
  }

  const results = [];
  for (const [value, { rowIdxs, normalizedKey }] of groups) {
    const tag    = libMap.get(normalizedKey) ?? null;
    const status = tag !== null ? 'match' : 'no-match';
    results.push({ value, tag: tag || '', status, rowIdxs });
  }

  // Ordenar: match primero, luego no-match
  results.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'match' ? -1 : 1;
    return a.value.localeCompare(b.value);
  });

  return results;
}

/**
 * Construye el valor final del campo destino para una fila:
 * si hay globalTag, lo antepone separado por coma.
 */
export function buildTagValue(tag, globalTag) {
  const g = (globalTag || '').trim();
  const t = (tag || '').trim();
  if (g && t) return `${g}, ${t}`;
  if (g)      return g;
  return t;
}
