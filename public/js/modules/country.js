/**
 * country.js — Detección de país y formateo de teléfono
 * DataB Flow · Cleaning | Transformation | Governance · © 2026 mdmarein · GNU AGPLv3
 */

// Mapas internos (se construyen con buildCountryMaps)
let _tldMap   = {};   // tld → country obj  (ej: "ar" → {iso2:"AR", nameEs:"Argentina",...})
let _phoneMap = [];   // [{ prefix, country }] ordenado por longitud DESC
let _iso2Map  = {};   // iso2 → country obj
let _nameMap  = {};   // nameEs normalizada → country obj

const GENERIC_TLDS = new Set(['com','net','org','edu','gov','int','mil','info','biz','io','app','co']);

function _norm(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Construir mapas internos desde el array de países.
 * Debe llamarse una vez con los datos de country.json antes de usar las demás funciones.
 */
export function buildCountryMaps(countries) {
  _tldMap = {}; _iso2Map = {}; _phoneMap = []; _nameMap = {};
  for (const c of countries) {
    _tldMap[c.tld]   = c;
    _iso2Map[c.iso2] = c;
    _nameMap[_norm(c.nameEs)] = c;
    _phoneMap.push({ prefix: c.callingCode, country: c });
  }
  // Ordenar por longitud DESC para evitar falsos positivos (ej: "1" vs "1809")
  _phoneMap.sort((a, b) => b.prefix.length - a.prefix.length);
}

/**
 * Resolver país desde un valor ya presente en la columna País del CSV.
 * Acepta: iso2 ("AR"), nombre completo ("Argentina"), nombre normalizado ("argentina").
 */
export function resolveFromColumn(val) {
  if (!val?.trim()) return null;
  const t = val.trim();
  return _iso2Map[t.toUpperCase()] || _nameMap[_norm(t)] || null;
}

/**
 * Detectar país desde el TLD del email.
 * "usuario@gmail.com.ar" → Argentina
 * "usuario@empresa.co.uk" → Reino Unido
 */
export function detectCountryFromEmail(email) {
  if (!email?.includes('@')) return null;
  const domain = email.split('@')[1]?.toLowerCase() || '';
  const parts  = domain.split('.');
  const last   = parts[parts.length - 1];

  // TLD no genérico de 1 segmento (ej: .ar, .br, .mx)
  if (parts.length >= 2 && !GENERIC_TLDS.has(last) && _tldMap[last]) {
    return _tldMap[last];
  }
  // TLD de 2 segmentos (ej: co.uk, com.ar → "ar" ya cubierto arriba)
  if (parts.length >= 3) {
    const twoSeg = parts.slice(-2).join('.');
    if (_tldMap[twoSeg]) return _tldMap[twoSeg];
  }
  return null;
}

/**
 * Detectar país desde el número de teléfono.
 * Busca el prefijo internacional más largo que coincida con los primeros dígitos.
 */
export function detectCountryFromPhone(rawPhone) {
  if (!rawPhone?.trim()) return null;
  let digits = rawPhone.replace(/\D/g, '');
  // Quitar prefijos de marcación internacional
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length < 6) return null;
  for (const { prefix, country } of _phoneMap) {
    if (digits.startsWith(prefix)) return country;
  }
  return null;
}

/**
 * Formatear número de teléfono con código de país internacional.
 * Retorna el teléfono en formato +[callingCode][número] o el original si no aplica.
 *
 * Reglas de normalización:
 *   1. Solo dígitos
 *   2. Si empieza con '00' → quitar '00' (formato europeo)
 *   3. Si ya empieza con el callingCode → agregar '+' y listo
 *   4. Si empieza con '0' → quitar '0' (marcación local)
 *   5. Concatenar: '+' + callingCode + digitsLimpios
 */
export function formatPhone(rawPhone, country) {
  if (!country?.callingCode || !rawPhone?.trim()) return rawPhone;
  let digits = rawPhone.replace(/\D/g, '');
  if (!digits) return rawPhone;
  const code = country.callingCode;

  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith(code)) return '+' + digits;
  if (digits.startsWith('0'))  digits = digits.slice(1);
  return '+' + code + digits;
}

/** Encontrar el país más frecuente en un array de step8Items */
export function mostFrequentCountry(step8Items) {
  const counts = {};
  for (const item of step8Items) {
    if (item.country?.iso2) {
      counts[item.country.iso2] = (counts[item.country.iso2] || { n: 0, c: item.country });
      counts[item.country.iso2].n++;
    }
  }
  const top = Object.values(counts).sort((a, b) => b.n - a.n)[0];
  return top?.c || null;
}
