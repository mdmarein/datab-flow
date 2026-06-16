/**
 * validator.js — Validación RFC 2822 + auto-corrección
 * dataB Flow · Cleaning | Transformation | Governance · © 2026 mdmarein · GNU AGPLv3
 */

import { TRANSLIT_MAP, FIX_TYPES } from './config.js';

/** ¿Tiene caracteres no-ASCII? (NFC-aware) */
export function hasNonAscii(str) {
  const s = str.normalize('NFC');
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 127) return true;
  return false;
}

/** Extraer caracteres no-ASCII para mostrar */
export function getNonAsciiChars(str) {
  const s = str.normalize('NFC');
  const found = new Set();
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 127) found.add(s[i]);
  return [...found].join(' ');
}

/** Transliterar caracteres no-ASCII a ASCII equivalentes */
export function transliterate(str) {
  const s = str.normalize('NFC');
  let result = '';
  for (let i = 0; i < s.length; i++) result += TRANSLIT_MAP[s[i]] ?? s[i];
  return result;
}

/**
 * Auto-corregir un email y reportar los cambios aplicados.
 * Retorna { fixed, issues, changed }
 * issues = [{ sev: 'error'|'warn', msg, type, applied }]
 */
export function autoFixEmail(raw, opts = {}) {
  const issues  = [];
  const push    = (sev, msg, type, applied = false) => issues.push({ sev, msg, type, applied });

  if (!raw?.trim()) {
    push('error', 'Email vacío', FIX_TYPES.NO_AT);
    return { fixed: raw || '', issues, changed: false };
  }

  // Normalizar NFC antes de todo
  let email   = raw.trim().normalize('NFC');
  let changed = false;

  // 1. Múltiples @ — no auto-corregible
  const atCount = (email.match(/@/g) || []).length;
  if (atCount === 0) { push('error', 'Sin signo @', FIX_TYPES.NO_AT);    return { fixed: email, issues, changed }; }
  if (atCount > 1)   { push('error', `${atCount} signos @`, FIX_TYPES.MULTI_AT); return { fixed: email, issues, changed }; }

  // 2. Minúsculas
  if (email !== email.toLowerCase()) {
    email   = email.toLowerCase();
    changed = true;
    push('warn', 'Mayúsculas → minúsculas', FIX_TYPES.LOWERCASE, true);
  }

  const atIdx = email.indexOf('@');
  let user   = email.slice(0, atIdx);
  let domain = email.slice(atIdx + 1);

  // 3. Espacios en blanco
  if (/\s/.test(user + domain)) {
    user   = user.replace(/\s/g, '');
    domain = domain.replace(/\s/g, '');
    changed = true;
    push('warn', 'Espacios eliminados', FIX_TYPES.SPACES, true);
  }

  // 4. Transliteración (solo si no está desactivada por el usuario)
  if (!opts.skipTranslit && hasNonAscii(user + domain)) {
    const chars    = getNonAsciiChars(user + domain);
    const newUser  = transliterate(user);
    const newDom   = transliterate(domain);
    if (newUser !== user || newDom !== domain) {
      user    = newUser;
      domain  = newDom;
      changed = true;
      push('warn', `Acentos (${chars}) → corregidos`, FIX_TYPES.TRANSLIT, true);
    }
  } else if (hasNonAscii(user + domain)) {
    const chars = getNonAsciiChars(user + domain);
    push('warn', `Acentos: ${chars}`, FIX_TYPES.TRANSLIT, false);
  }

  // 5. Puntos al inicio/final del usuario
  const uBefore = user;
  user = user.replace(/^\.+|\.+$/g, '');
  if (user !== uBefore) { changed = true; push('error', 'Puntos extremos eliminados', FIX_TYPES.DOT_TRIM, true); }

  // 6. Puntos consecutivos
  if (user.includes('..')) {
    user    = user.replace(/\.{2,}/g, '.');
    changed = true;
    push('error', 'Puntos consecutivos (..) → punto simple', FIX_TYPES.DOT_DOUBLE, true);
  }

  // 7. Guiones/guiones bajos extremos
  const uDash = user;
  user = user.replace(/^[-]+|[-]+$/g, '');
  if (user !== uDash) { changed = true; push('error', '- extremos eliminados', FIX_TYPES.DASH_TRIM, true); }

  // 7b. Guiones bajos extremos (_@)
  const uUnder = user;
  user = user.replace(/^_+|_+$/g, '');
  if (user !== uUnder) { changed = true; push('error', '_ extremos eliminados', FIX_TYPES.DASH_TRIM, true); }

  // 7c. Re-trim puntos expuestos tras quitar _/- (ej: test._@ → test)
  const uDot2 = user;
  user = user.replace(/^\.+|\.+$/g, '');
  if (user !== uDot2) { changed = true; push('error', 'Puntos extremos eliminados', FIX_TYPES.DOT_TRIM, true); }

  // 8. Caracteres inválidos — auto-sugerencia: eliminarlos
  // Permitidos: a-z 0-9 . - _ + (+ es válido en aliases Gmail/RFC)
  // Prohibidos per Infomaniak + RFC práctico:
  //   " , ; : < > ( ) [ ] \ ! * # $ % ^ & = / ?
  const _badRe = /[",;:<>()\[\]\\!*#$%^&=/?]/g;
  const badU   = [...new Set((user.match(_badRe) || []))];
  if (badU.length) {
    user    = user.replace(_badRe, '');
    changed = true;
    push('error', `Chars inválidos eliminados: ${badU.join(' ')}`, FIX_TYPES.INVALID_CHAR, true);
  }

  // 9. Usuario vacío tras limpiezas
  if (!user) push('error', 'Usuario vacío tras limpieza', FIX_TYPES.NO_AT);

  // 10. Longitudes RFC 5321
  if (user.length > 64)             push('error', `Usuario muy largo (${user.length}/64)`, FIX_TYPES.LENGTH);
  if ((user + '@' + domain).length > 254) push('error', 'Email muy largo (>254)', FIX_TYPES.LENGTH);

  // 11. Dominio básico
  if (!domain) {
    push('error', 'Sin dominio', FIX_TYPES.DOMAIN_ISSUE);
  } else {
    if (!domain.includes('.'))  push('error', 'Dominio sin punto', FIX_TYPES.DOMAIN_ISSUE);
    if (/^\.|\.$/.test(domain)) push('error', 'Punto al inicio/final del dominio', FIX_TYPES.DOMAIN_ISSUE);
    if (domain.includes('..'))  push('error', 'Puntos consecutivos en dominio', FIX_TYPES.DOMAIN_ISSUE);
    if (/\s/.test(domain))      push('error', 'Espacios en dominio', FIX_TYPES.DOMAIN_ISSUE);
    // Cada etiqueta (entre puntos) no puede empezar ni terminar con guión
    if (domain.split('.').some(label => /^-|-$/.test(label)))
      push('error', 'Etiqueta de dominio con guión al inicio/final', FIX_TYPES.DOMAIN_ISSUE);
    // Caracteres inválidos en dominio (solo a-z 0-9 . -)
    if (/[^a-z0-9.\-]/.test(domain))
      push('error', 'Caracteres inválidos en dominio', FIX_TYPES.DOMAIN_ISSUE);
  }

  const fixed = `${user}@${domain}`;
  return { fixed, issues, changed: changed || fixed !== email };
}
