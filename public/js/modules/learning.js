/**
 * learning.js — Motor de aprendizaje adaptativo
 *
 * El sistema aprende de la interacción del usuario para:
 * 1. Recordar qué columnas usa para duplicados (por esquema CSV)
 * 2. Detectar qué tipos de fixes acepta/rechaza y ajustar sugerencias
 * 3. Aprender nuevos patrones de dominio erróneos del historial
 * 4. Generar insights comparativos entre sesiones
 * 5. Promover correcciones frecuentes a reglas sugeridas
 *
 * DataB Flow · Cleaning | Transformation | Governance · © 2026 mdmarein · GNU AGPLv3
 */

import { t } from './i18n.js';

const API = '/api/learning';
const SESSION_API = '/api/session';

// ── Carga inicial ────────────────────────────────────────────
export async function loadLearning() {
  try {
    const res = await fetch('/api/data');
    const { learning } = await res.json();
    return learning || _defaults();
  } catch {
    return _defaults();
  }
}

function _defaults() {
  return {
    version: 1,
    validationDecisions:  {},   // { fixType: { accepted, rejected } }
    columnPreferences:    {},   // { schemaHash: [colIdx, ...] }
    domainDecisions:      {},   // { "pattern→target": { accepted, rejected } }
    learnedPatterns:      [],   // [{ type, from, to, count }]
    pendingSuggestions:   [],   // patterns vistos >2 veces no agregados como regla
    companyDecisions:     {},   // { normalizedName: { cleared, kept, renames: {} } }
    learnedJunkCompanies: [],   // nombres aprendidos como basura
    learnedRenames:       {},   // { normalizedName: preferredName }
    sessions:             [],   // últimas 50 sesiones (historial para insights)
    startRowPreferences:  {},   // { filenameKey: { row, ts } } — fila inicio por archivo
  };
}

// ── Persistencia ─────────────────────────────────────────────
async function _persist(patch) {
  try {
    await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  } catch { /* offline graceful */ }
}

// ── 1. Preferencias de columnas por esquema ──────────────────

/**
 * Recordar las columnas seleccionadas para este esquema CSV
 */
export async function recordColumnPreference(schemaHash, selectedColIdxs) {
  const patch = {
    columnPreferences: {
      [schemaHash]: { cols: selectedColIdxs, ts: Date.now() },
    },
  };
  await _persist(patch);
}

/**
 * Obtener columnas recordadas para este esquema (o null si no hay)
 */
export function getSuggestedColumns(learning, schemaHash) {
  const pref = learning?.columnPreferences?.[schemaHash];
  if (!pref) return null;
  return pref.cols;
}

// ── 1b. Preferencia de fila de inicio por nombre de archivo ──

/**
 * Guardar la fila de inicio elegida por el usuario para este archivo
 */
export async function recordStartRowPreference(filenameKey, row) {
  const patch = { startRowPreferences: { [filenameKey]: { row, ts: Date.now() } } };
  await _persist(patch);
}

/**
 * Obtener la fila de inicio recordada para este archivo (null si no hay)
 */
export function getStartRowPreference(learning, filenameKey) {
  const pref = learning?.startRowPreferences?.[filenameKey];
  return pref != null ? pref.row : null;
}

// ── 2. Decisiones sobre tipos de fix de validación ───────────

/**
 * Registrar que el usuario aceptó o rechazó un tipo de fix
 * accepted: true = tildo el checkbox | false = destildó
 */
export async function recordValidationDecision(learning, fixType, accepted) {
  const key = accepted ? 'accepted' : 'rejected';
  const patch = {
    validationDecisions: { [fixType]: { [key]: 1 } },
  };
  await _persist(patch);
}

/**
 * ¿Debería sugerirse este tipo de fix activo por defecto?
 * Considera el ratio accepted/rejected del usuario
 */
export function shouldSuggestFixType(learning, fixType) {
  const dec = learning?.validationDecisions?.[fixType];
  if (!dec) return true; // sin historial → sugerir
  const total = (dec.accepted || 0) + (dec.rejected || 0);
  if (total < 5) return true; // muy pocos datos
  return (dec.accepted || 0) / total > 0.3; // si rechaza >70% → no sugerir
}

// ── 3. Aprendizaje de patrones de dominio ────────────────────

/**
 * Registrar decisión sobre una corrección de dominio
 * Si se acepta suficientes veces un patrón → promover a learned pattern
 */
export async function recordDomainDecision(learning, pattern, target, accepted) {
  const key = `${pattern}→${target}`;
  const dec  = learning?.domainDecisions?.[key] || { accepted: 0, rejected: 0 };
  if (accepted) dec.accepted = (dec.accepted || 0) + 1;
  else          dec.rejected = (dec.rejected || 0) + 1;

  // Auto-promover si se acepta ≥3 veces y ratio > 80%
  const learnedPatterns = [...(learning?.learnedPatterns || [])];
  const total = dec.accepted + dec.rejected;
  const alreadyLearned = learnedPatterns.some(p => p.from === pattern && p.to === target);

  if (!alreadyLearned && dec.accepted >= 3 && dec.accepted / total > 0.8) {
    // Detectar si es label o full (si tiene punto → full, sino label)
    const type = pattern.includes('.') ? 'full' : 'label';
    learnedPatterns.push({ type, from: pattern, to: target, count: dec.accepted });
  }

  const patch = {
    domainDecisions: { [key]: { accepted: accepted ? 1 : 0, rejected: accepted ? 0 : 1 } },
    learnedPatterns,
  };
  await _persist(patch);
  return learnedPatterns;
}

// ── 4. Aprendizaje de empresas ───────────────────────────────

/**
 * Obtener empresas aprendidas como basura
 */
export function getLearnedJunkCompanies(learning) {
  return learning?.learnedJunkCompanies || [];
}

/**
 * Obtener renombres aprendidos: { normalizedKey → preferredName }
 */
export function getLearnedCompanyRenames(learning) {
  return learning?.learnedRenames || {};
}

/**
 * Registrar las decisiones del usuario sobre empresas al finalizar el proceso.
 * Promueve a "learned junk" si fue limpiada ≥2 veces con ratio >70%.
 * Promueve rename si el mismo nombre fue usado ≥2 veces.
 */
export async function recordCompanyDecisions(learning, companyNorms) {
  if (!companyNorms?.length) return;

  const decisions     = Object.assign({}, learning?.companyDecisions || {});
  const learnedJunk   = [...(learning?.learnedJunkCompanies || [])];
  const learnedRenames = { ...(learning?.learnedRenames     || {}) };

  companyNorms.forEach(norm => {
    if (!norm.displayName) return;
    const key = norm.displayName.toLowerCase().normalize('NFC').trim();
    if (!decisions[key]) decisions[key] = { cleared: 0, kept: 0, renames: {} };

    if (norm.clear) {
      decisions[key].cleared++;
    } else if (norm.newName !== norm.displayName) {
      decisions[key].renames[norm.newName] = (decisions[key].renames[norm.newName] || 0) + 1;
      decisions[key].kept++;
    } else {
      decisions[key].kept++;
    }

    // Promover a learned junk: limpiada al menos 1 vez
    const d = decisions[key];
    if (!learnedJunk.includes(key) && d.cleared >= 1) {
      learnedJunk.push(key);
    }

    // Promover rename: mismo nombre ≥2 veces
    if (d.renames && !d.cleared) {
      const top = Object.entries(d.renames).sort((a, b) => b[1] - a[1])[0];
      if (top && top[1] >= 2) learnedRenames[key] = top[0];
    }
  });

  const patch = { companyDecisions: decisions, learnedJunkCompanies: learnedJunk, learnedRenames };
  await _persist(patch);
  return { learnedJunk, learnedRenames };
}

// ── 5. Registro de sesión completada ────────────────────────

/**
 * Guardar estadísticas de la sesión para generar insights futuros
 */
export async function recordSession(stats) {
  try {
    await fetch(SESSION_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stats),
    });
  } catch { /* offline graceful */ }
}

// ── 5. Insights comparativos ─────────────────────────────────

/**
 * Generar insights legibles comparando la sesión actual con el historial
 */
export function generateInsights(learning, currentStats) {
  const sessions = learning?.sessions || [];
  if (!sessions.length) return [];

  const insights = [];

  // Promedio de tasa de error de dominio en sesiones anteriores
  const pastDomRates = sessions
    .filter(s => s.total > 0 && s.domFixed >= 0)
    .map(s => s.domFixed / s.total);
  if (pastDomRates.length >= 2) {
    const avg = pastDomRates.reduce((a, b) => a + b, 0) / pastDomRates.length;
    const cur = currentStats.domFixed / (currentStats.total || 1);
    if (cur > avg * 1.5) {
      insights.push({ type: 'warn', msg: t('insights.domain_above', pct(cur), pct(avg)) });
    } else if (cur < avg * 0.5 && pastDomRates.length >= 3) {
      insights.push({ type: 'good', msg: t('insights.domain_below', pct(cur), pct(avg)) });
    }
  }

  // Patrones de dominio aprendidos disponibles
  const learned = learning?.learnedPatterns || [];
  if (learned.length > 0) {
    insights.push({ type: 'info', msg: t('insights.learned', learned.length) });
  }

  // Duplicados
  const pastDupRates = sessions
    .filter(s => s.total > 0 && s.dupRemoved >= 0)
    .map(s => s.dupRemoved / s.total);
  if (pastDupRates.length >= 2) {
    const avg = pastDupRates.reduce((a, b) => a + b, 0) / pastDupRates.length;
    const cur = currentStats.dupRemoved / (currentStats.total || 1);
    if (cur > avg * 2) {
      insights.push({ type: 'warn', msg: t('insights.dup_high', pct(cur), pct(avg)) });
    }
  }

  return insights;
}

function pct(n) { return `${(n * 100).toFixed(1)}%`; }
