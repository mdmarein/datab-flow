/**
 * config.js — Diccionarios y constantes globales
 * DataB Flow · Cleaning | Transformation | Governance · © 2026 mdmarein · GNU AGPLv3
 */

export const VERSION = '2.0.0';

// ── Empresas "basura" — valores que no son empresa real ──────
export const BASE_JUNK_COMPANIES = [
  'no', 'no tengo', 'no tiene', 'no aplica', 'sin empresa', 'sin dato',
  'sin información', 'sin informacion', 's/d', 's/i', 'n/a', 'na',
  'ninguna', 'ninguno', 'ninguna empresa',
  'particular', 'propio', 'dueño', 'dueña', 'propietario', 'propietaria',
  'arquitecto', 'arquitecta', 'arquitectura',
  'autónomo', 'autonomo', 'independiente', 'freelance', 'cuenta propia',
  'tec', 'tecnico', 'técnico', 'técnica', 'tecnica',
  '.', '-', '..', '--', '/', 'x', '-', '–', '—',
].map(s => s.toLowerCase().normalize('NFC'));

// ── Whitelist de dominios válidos ────────────────────────────
// Array (no Set) para poder iterar y serializar a dominio.json.
// Wildcards: 'hotmail.com.*' cubre hotmail.com.ar, .br, .mx, etc.
export const BASE_WHITELIST = [
  'gmail.com',
  'hotmail.com', 'hotmail.com.*',
  'hotmail.es', 'hotmail.co.uk', 'hotmail.fr', 'hotmail.de', 'hotmail.it', 'hotmail.pt',
  'outlook.com', 'outlook.com.*',
  'outlook.es', 'outlook.co.uk', 'outlook.fr',
  'yahoo.com', 'yahoo.com.*',
  'yahoo.es', 'yahoo.co.uk', 'yahoo.fr', 'yahoo.de', 'yahoo.it', 'yahoo.com.au',
  'live.com', 'live.com.*', 'live.es',
  'msn.com', 'icloud.com', 'me.com', 'mac.com',
  'protonmail.com', 'proton.me', 'pm.me',
  'googlemail.com', 'ymail.com',
];

// ── Diccionario de dominios erróneos ─────────────────────────
// Fuente: patrones reales de formularios de Argentina/LATAM
// ── Mapa de transliteración Unicode → ASCII ──────────────────
export const TRANSLIT_MAP = {
  'á':'a','à':'a','â':'a','ä':'a','ã':'a','å':'a',
  'é':'e','è':'e','ê':'e','ë':'e',
  'í':'i','ì':'i','î':'i','ï':'i',
  'ó':'o','ò':'o','ô':'o','ö':'o','õ':'o','ø':'o',
  'ú':'u','ù':'u','û':'u','ü':'u',
  'ý':'y','ÿ':'y','ñ':'n','ç':'c',
  'Á':'a','À':'a','Â':'a','Ä':'a','Ã':'a',
  'É':'e','È':'e','Ê':'e','Ë':'e',
  'Í':'i','Ì':'i','Î':'i','Ï':'i',
  'Ó':'o','Ò':'o','Ô':'o','Ö':'o','Õ':'o',
  'Ú':'u','Ù':'u','Û':'u','Ü':'u',
  'Ý':'y','Ñ':'n','Ç':'c',
};

// ── Pasos del flujo de procesamiento ─────────────────────────
export const FLOW_STEPS = [
  { id: 'rules',      label: 'Reglas',      abbr: 'R', group: 'email',      required: false, card: 'c2' },
  { id: 'validation', label: 'Validación',  abbr: 'V', group: 'email',      required: false, card: 'c3' },
  { id: 'domains',    label: 'Dominios',    abbr: 'D', group: 'email',      required: false, card: 'c4' },
  { id: 'duplicates', label: 'Duplicados',             group: 'filters',    required: false, card: 'c5' },
  { id: 'keywords',   label: 'Palabras',               group: 'filters',    required: false, card: 'c6' },
  { id: 'nameai',     label: 'Nombres',   group: 'corregir',  required: false, card: 'c9' },
  { id: 'company',    label: 'Empresa',   group: 'corregir',  required: false, card: 'c7' },
  { id: 'country',    label: 'País/Tel',  group: 'corregir',  required: false, card: 'c8' },
  { id: 'fieldhomol', label: 'Campos',    group: 'homologar', required: false, card: 'c10' },
  { id: 'fieldtags',  label: 'Etiquetas', group: 'homologar', required: false, card: 'c11' },
];
export const DEFAULT_ENABLED_STEPS = Object.fromEntries(FLOW_STEPS.map(s => [s.id, true]));

// ── Tipos de fix de validación ────────────────────────────────
export const FIX_TYPES = {
  LOWERCASE:    'lowercase',
  SPACES:       'spaces',
  TRANSLIT:     'translit',
  DOT_TRIM:     'dot_trim',
  DOT_DOUBLE:   'dot_double',
  DASH_TRIM:    'dash_trim',
  INVALID_CHAR: 'invalid_char',
  NO_AT:        'no_at',
  MULTI_AT:     'multi_at',
  LENGTH:       'length',
  DOMAIN_ISSUE: 'domain_issue',
};

