/**
 * duplicates.js — Detección de filas duplicadas
 * DataB Flow · Cleaning | Transformation | Governance · © 2026 mdmarein · GNU AGPLv3
 */

/**
 * Detectar grupos de duplicados en el CSV.
 * Dos filas son duplicadas si todos los campos seleccionados (dupCols) coinciden.
 * El campo email se compara con su valor final (post val+dom fix).
 *
 * @param {object} csv      - { headers, rows }
 * @param {number} colIdx   - índice de la columna email
 * @param {Set}    dupCols  - índices de columnas a comparar
 * @param {Array}  valItems - correcciones de validación aplicadas
 * @param {Array}  domItems - correcciones de dominio aplicadas
 * @returns {Array} dupGroups
 */
export function findDuplicates(csv, colIdx, dupCols, valItems, domItems) {
  if (dupCols.size === 0) return []; // sin criterio = sin duplicados

  // Construir mapa rowIdx → emailFinal
  const valMap = new Map(valItems.filter(v => v.checked).map(v => [v.rowIdx, v.manualValue || v.autoFixed]));
  const domMap = new Map(domItems.filter(d => d.checked).map(d => [d.rowIdx, d.manualValue || d.corrected]));

  const map = new Map();

  csv.rows.forEach((row, ri) => {
    const orig = (row[colIdx] || '').trim();
    if (!orig) return;

    const emailFinal = (domMap.get(ri) || valMap.get(ri) || orig).toLowerCase().normalize('NFC');

    // Firma: solo columnas seleccionadas
    const parts = [];
    for (let i = 0; i < row.length; i++) {
      if (!dupCols.has(i)) continue;
      parts.push(i === colIdx ? emailFinal : (row[i] || '').trim().toLowerCase().normalize('NFC'));
    }
    const sig = parts.join('\x00');

    if (!map.has(sig)) map.set(sig, []);
    map.get(sig).push({
      rowIdx: ri,
      original: orig,
      finalEmail: emailFinal,
      hasValFix: valMap.has(ri),
      hasDomFix: domMap.has(ri),
    });
  });

  return [...map.entries()]
    .filter(([, rows]) => rows.length > 1)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([, rows]) => ({
      email:       rows[0].finalEmail,
      rows:        rows.sort((a, b) => a.rowIdx - b.rowIdx),
      keepRowIdxs: new Set([rows[0].rowIdx]), // default: mantener primero
    }));
}

/**
 * Recalcular filas excluidas a partir de keepRowIdxs
 */
export function buildExcluded(dupGroups) {
  const excl = new Set();
  for (const g of dupGroups) {
    for (const r of g.rows) {
      if (!g.keepRowIdxs.has(r.rowIdx)) excl.add(r.rowIdx);
    }
  }
  return excl;
}
