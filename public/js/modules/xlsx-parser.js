/**
 * xlsx-parser.js — Parser de archivos XLSX sin dependencias externas
 * Usa DecompressionStream (API nativa del browser) para descomprimir el ZIP.
 * Requiere: Chrome 80+, Firefox 113+, Safari 16.4+
 * DataB Flow · Cleaning | Transformation | Governance · © 2026 mdmarein · GNU AGPLv3
 */

// ── Firmas ZIP (little-endian uint32) ──────────────────────────
const SIG_EOCD = 0x06054b50;
const SIG_CD   = 0x02014b50;
const SIG_LFH  = 0x04034b50;

// ── ZIP: End of Central Directory ─────────────────────────────
function _findEOCD(view) {
  // EOCD mínimo 22 bytes desde el final; comentario ZIP max 65535 bytes
  const start = Math.max(0, view.byteLength - 65557);
  for (let i = view.byteLength - 22; i >= start; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) return i;
  }
  throw new Error('Archivo XLSX inválido — no se encontró EOCD en el ZIP');
}

// ── ZIP: Central Directory → Map<filename, {localOffset, compressedSize, method}> ──
function _parseCentralDirectory(buf) {
  const view = new DataView(buf);
  const eocd = _findEOCD(view);
  const cdOffset   = view.getUint32(eocd + 16, true);
  const numEntries = view.getUint16(eocd + 10, true);
  const td  = new TextDecoder();
  const map = new Map();

  let pos = cdOffset;
  for (let i = 0; i < numEntries; i++) {
    if (view.getUint32(pos, true) !== SIG_CD) break;
    const method         = view.getUint16(pos + 10, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const filenameLen    = view.getUint16(pos + 28, true);
    const extraLen       = view.getUint16(pos + 30, true);
    const commentLen     = view.getUint16(pos + 32, true);
    const localOffset    = view.getUint32(pos + 42, true);
    const filename       = td.decode(new Uint8Array(buf, pos + 46, filenameLen));
    map.set(filename, { localOffset, compressedSize, method });
    pos += 46 + filenameLen + extraLen + commentLen;
  }
  return map;
}

// ── ZIP: extraer y descomprimir una entrada ─────────────────────
async function _extract(buf, { localOffset, compressedSize, method }) {
  const view = new DataView(buf);
  if (view.getUint32(localOffset, true) !== SIG_LFH)
    throw new Error('Encabezado de archivo local inválido en el ZIP');

  const fnLen = view.getUint16(localOffset + 26, true);
  const exLen = view.getUint16(localOffset + 28, true);
  const data  = new Uint8Array(buf, localOffset + 30 + fnLen + exLen, compressedSize);

  if (method === 0) return data; // stored — sin compresión

  // Deflate raw (method 8) — ZIP usa deflate sin wrapper zlib
  const ds     = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();
  writer.write(data);
  writer.close();

  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

const _td = new TextDecoder();

// ── XLSX: shared strings ────────────────────────────────────────
function _parseSharedStrings(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  return [...doc.querySelectorAll('si')].map(si =>
    [...si.querySelectorAll('t')].map(t => t.textContent).join('')
  );
}

// ── XLSX: columna letra → índice (A→0, Z→25, AA→26…) ──────────
function _colIdx(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

// ── XLSX: parsear sheet XML → grilla 2D ────────────────────────
function _parseSheet(xml, shared) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  let maxRow = 0, maxCol = 0;

  // Primera pasada: recolectar datos y dimensiones
  const cells = [];
  for (const c of doc.querySelectorAll('c')) {
    const ref = c.getAttribute('r');
    if (!ref) continue;
    const m = ref.match(/^([A-Z]+)(\d+)$/);
    if (!m) continue;
    const col = _colIdx(m[1]);
    const row = parseInt(m[2], 10) - 1; // 0-based
    if (row > maxRow) maxRow = row;
    if (col > maxCol) maxCol = col;

    const t  = c.getAttribute('t') || '';
    let value = '';
    if (t === 's') {
      // Shared string — el value es un índice
      const v = c.querySelector('v');
      if (v) value = shared[parseInt(v.textContent, 10)] ?? '';
    } else if (t === 'inlineStr') {
      const v = c.querySelector('is t');
      if (v) value = v.textContent;
    } else if (t === 'b') {
      const v = c.querySelector('v');
      value = v ? (v.textContent === '1' ? 'TRUE' : 'FALSE') : '';
    } else {
      // Número, resultado de fórmula, fecha serial, etc.
      const v = c.querySelector('v');
      if (v) value = v.textContent;
    }
    cells.push({ row, col, value });
  }

  if (cells.length === 0) return [];

  // Construir grilla
  const numCols = maxCol + 1;
  const grid = Array.from({ length: maxRow + 1 }, () => new Array(numCols).fill(''));
  for (const { row, col, value } of cells) grid[row][col] = value;
  return grid;
}

// ── API pública ─────────────────────────────────────────────────
/**
 * parseXLSX(arrayBuffer) → Promise<{ headers, rows, sep, sheetName }>
 * Misma forma que parseCSV: headers = array de strings, rows = array de arrays.
 * sep siempre es ',' (la salida CSV usa coma por defecto).
 */
export async function parseXLSX(arrayBuffer) {
  if (!('DecompressionStream' in window)) {
    throw new Error('Tu navegador no soporta XLSX. Usá Chrome 80+, Firefox 113+ o Safari 16.4+.');
  }

  const entries = _parseCentralDirectory(arrayBuffer);

  // Shared strings (puede no existir si el archivo no tiene strings compartidas)
  let shared = [];
  const ssKey = [...entries.keys()].find(k => /xl\/sharedStrings\.xml$/i.test(k));
  if (ssKey) {
    const bytes = await _extract(arrayBuffer, entries.get(ssKey));
    shared = _parseSharedStrings(_td.decode(bytes));
  }

  // Primera hoja (sheet1.xml o la primera que encuentre)
  const sheetKey = [...entries.keys()].find(k => /xl\/worksheets\/sheet1\.xml$/i.test(k))
    || [...entries.keys()].find(k => /xl\/worksheets\/sheet\d+\.xml$/i.test(k));
  if (!sheetKey) throw new Error('No se encontró ninguna hoja de datos en el archivo XLSX');

  const sheetBytes = await _extract(arrayBuffer, entries.get(sheetKey));
  const grid = _parseSheet(_td.decode(sheetBytes), shared);

  if (grid.length === 0) throw new Error('La hoja XLSX está vacía o no tiene datos');

  // Nombre de la hoja (no crítico si falla)
  let sheetName = 'Hoja1';
  const wbKey = [...entries.keys()].find(k => /xl\/workbook\.xml$/i.test(k));
  if (wbKey) {
    try {
      const wbBytes = await _extract(arrayBuffer, entries.get(wbKey));
      const wbDoc = new DOMParser().parseFromString(_td.decode(wbBytes), 'application/xml');
      const s = wbDoc.querySelector('sheet');
      if (s) sheetName = s.getAttribute('name') || sheetName;
    } catch { /* no crítico */ }
  }

  const headers = grid[0].map(h => String(h ?? '').trim());
  const rows    = grid.slice(1).map(row => row.map(v => String(v ?? '')));

  return { headers, rows, sep: ',', sheetName };
}
