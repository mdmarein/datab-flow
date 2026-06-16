/**
 * domains.js — Motor de corrección de dominios
 * Proceso de 3 pasos (fiel al workflow original del usuario)
 * dataB Flow · Cleaning | Transformation | Governance · © 2026 mdmarein · GNU AGPLv3
 */

/**
 * Intentar corregir el dominio de un email.
 * Retorna null si el email ya es correcto, o un objeto de corrección.
 * @param {string} raw - Email a analizar (ya normalizado/validado)
 * @param {Set}    whitelist - Dominios válidos exactos que no se tocan
 * @param {Array}  customRules - Reglas custom del usuario
 * @param {Array}  learnedPatterns - Patrones aprendidos { pattern → target }
 * @param {Array}  whitelistPatterns - RegExps compiladas desde wildcards (ej: hotmail.com.*)
 * @param {Set}    excludedDefaults - Exclusiones de reglas default
 * @param {Array}  defaultRules - Reglas incorporadas cargadas desde domain-rules-default.json
 */
export function correctDomain(raw, whitelist, customRules = [], learnedPatterns = [], whitelistPatterns = [], excludedDefaults = new Set(), defaultRules = []) {
  if (!raw?.trim()) return null;

  const email  = raw.trim().toLowerCase().normalize('NFC');
  const atIdx  = email.lastIndexOf('@');
  if (atIdx < 1 || atIdx === email.length - 1) return null;

  const user   = email.slice(0, atIdx);
  const domain = email.slice(atIdx + 1);
  if (!domain.includes('.')) return null;

  // PASO 1 — Whitelist: dominio válido → no tocar
  if (whitelist.has(domain)) return null;
  if (whitelistPatterns.length && whitelistPatterns.some(rx => rx.test(domain))) return null;

  const mk = (correctedDomain, provider, source = 'base') => ({
    user,
    originalDomain:  domain,
    correctedDomain,
    provider,
    source,          // 'custom' | 'learned' | 'base'
    corrected:       `${user}@${correctedDomain}`,
  });

  // PASO 2 — Reglas custom del usuario (mayor prioridad)
  for (const rule of customRules) {
    if (rule.type === 'full'  && domain === rule.from)              return mk(rule.to, 'custom', 'custom');
    if (rule.type === 'label' && domain.split('.')[0] === rule.from) return mk(rule.to, 'custom', 'custom');
  }

  // PASO 2b — Patrones aprendidos del usuario
  for (const p of learnedPatterns) {
    if (p.type === 'full'  && domain === p.from)              return mk(p.to, p.to.split('.')[0], 'learned');
    if (p.type === 'label' && domain.split('.')[0] === p.from) return mk(p.to, p.to.split('.')[0], 'learned');
  }

  // PASO 2c — Dominio completo en diccionario base
  for (const rule of defaultRules) {
    if (rule.type === 'full' && domain === rule.from && !excludedDefaults.has(`full:${domain}`)) return mk(rule.to, rule.provider, 'base');
  }

  // PASO 3 — Label (primera parte antes del primer punto)
  const label = domain.split('.')[0];
  for (const rule of defaultRules) {
    if (rule.type === 'label' && label === rule.from && !excludedDefaults.has(`label:${label}`)) return mk(rule.to, rule.provider, 'base');
  }

  return null;
}

/**
 * Corregir terminaciones de dominio (TLD typos) componente a componente.
 * Recorre de derecha a izquierda, corrigiendo partes que son TLDs con typo.
 * El label (primera parte significativa) nunca se toca.
 * Retorna null si no hubo cambios, o el email corregido.
 *
 * @param {string} email        - Email ya normalizado
 * @param {Array}  rules        - [{ from, to }] — componentes sin punto
 * @param {Set}    validTldSet  - Set de TLD components válidos conocidos
 */
export function correctSuffix(email, rules = [], validTldSet = new Set()) {
  if (!email || !rules.length) return null;
  const atIdx = email.indexOf('@');
  if (atIdx < 0) return null;
  const user   = email.slice(0, atIdx);
  const domain = email.slice(atIdx + 1);
  const parts  = domain.split('.');
  if (parts.length < 2) return null;

  const ruleMap = new Map(rules.map(r => [r.from.toLowerCase(), r.to.toLowerCase()]));

  // Recorrer de derecha a izquierda, consumiendo TLD components
  // Condición de parada: el componente no es TLD conocido ni typo conocido,
  // o consumir dejaría 0 partes de label.
  const corrected = [...parts];
  for (let i = parts.length - 1; i >= 1; i--) {
    // Siempre debe quedar al menos parts[0..i-1] como label (mínimo 1 parte)
    const part = parts[i].toLowerCase();
    const fix  = ruleMap.get(part);
    if (fix) {
      corrected[i] = fix;
    } else if (!validTldSet.has(part)) {
      break; // no es TLD conocido ni typo — es parte del dominio, parar
    }
  }

  const newDomain = corrected.join('.');
  if (newDomain === domain) return null;
  return `${user}@${newDomain}`;
}

/**
 * Agrupar correcciones por proveedor para el resumen
 */
export function groupByProvider(domItems) {
  const counts = {};
  for (const item of domItems) {
    counts[item.provider] = (counts[item.provider] || 0) + 1;
  }
  return counts;
}
