/**
 * keywords.js — Matching de palabras clave (test/junk) para email, nombre, apellido y empresa
 * Compartido entre el análisis previo (worker + fallback) y el paso real de eliminación,
 * para que el conteo del análisis coincida siempre con el resultado del paso.
 * DataB Flow · Cleaning | Transformation | Governance · © 2026 mdmarein · GNU AGPLv3
 */

// Dominio: keyword debe ser el label completo entre puntos (o compuesto de keywords).
function kwDomainLabelMatch(label, patterns) {
  for (const pat of patterns) {
    const kw  = pat.toLowerCase();
    const pos = label.indexOf(kw);
    if (pos < 0) continue;
    const before = label.slice(0, pos);
    const after  = label.slice(pos + kw.length);
    const beforeOk = !before || patterns.some(p => p.toLowerCase() === before);
    const afterOk  = !after  || patterns.some(p => p.toLowerCase() === after);
    if (beforeOk && afterOk) return true;
  }
  return false;
}

// Email local part: boundary alfanumérico (test-suma → sí, teston → no).
// Dominio: keyword debe ser el label completo entre puntos.
export function kwMatchEmail(emailVal, patterns) {
  const low    = emailVal.toLowerCase();
  const at     = low.indexOf('@');
  const local  = at < 0 ? low : low.slice(0, at);
  const domain = at < 0 ? ''  : low.slice(at + 1);
  if (patterns.some(p => {
    const kw = p.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![a-zA-Z0-9])${kw}(?![a-zA-Z0-9])`).test(local);
  })) return true;
  if (domain.split('.').some(label => kwDomainLabelMatch(label, patterns))) return true;
  return false;
}

// Nombre, Apellido, Empresa: el campo completo debe estar formado SOLO por keywords
// (sola, repetida, o varias keywords juntas). Cualquier otra palabra → no marca.
export function kwMatchField(fieldVal, patterns) {
  const words = fieldVal.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length) return false;
  const kwSet = new Set(patterns.map(p => p.toLowerCase()));
  return words.every(w => kwSet.has(w));
}
