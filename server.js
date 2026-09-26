/**
 * DataB Flow · Cleaning | Transformation | Governance · © 2026 mdmarein · GNU AGPLv3
 * Servidor HTTP local — sin dependencias npm
 * Requiere: Node.js >= 14
 */

'use strict';

const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const { URL } = require('url');

const PORT       = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR   = path.join(__dirname, 'data');

// ── Asegurar que existe el directorio data ──────────────────
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── Archivos de datos ───────────────────────────────────────
const FILES = {
  domainDefault:        path.join(DATA_DIR, 'domain-rules-default.json'),
  domainCustom:         path.join(DATA_DIR, 'domain-rules-custom.json'),
  domainValidDefault:   path.join(DATA_DIR, 'domain-valid-default.json'),
  domainValidCustom:    path.join(DATA_DIR, 'domain-valid-custom.json'),
  keywords:        path.join(DATA_DIR, 'keywords.json'),
  enterprise:      path.join(DATA_DIR, 'enterprise-clean.json'),
  homologate:      path.join(DATA_DIR, 'enterprise-homologate.json'),
  country:         path.join(DATA_DIR, 'country.json'),
  learning:        path.join(DATA_DIR, 'learning.json'),
  flowConfig:      path.join(DATA_DIR, 'flow-config.json'),
  fieldHomologated: path.join(DATA_DIR, 'field-homologated.json'),
  prepFormats:     path.join(DATA_DIR, 'prep-formats.json'),
  aiConfig:        path.join(DATA_DIR, 'ai-config.json'),
  aiPrompts:       path.join(DATA_DIR, 'ai-prompts-default.json'),
  suffixDefault:   path.join(DATA_DIR, 'suffix-rules-default.json'),
  suffixCustom:    path.join(DATA_DIR, 'suffix-rules-custom.json'),
  fieldTags:       path.join(DATA_DIR, 'field-tags.json'),
};

function readJSON(filePath, defaults) {
  try {
    if (fs.existsSync(filePath))
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.warn(`[WARN] No se pudo leer ${filePath}:`, e.message);
  }
  return defaults;
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error(`[ERROR] No se pudo escribir ${filePath}:`, e.message);
    return false;
  }
}

// ── MIME types ──────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
};

// ── Helpers HTTP ────────────────────────────────────────────
function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 2e6) {
        req.destroy(new Error('payload_too_large'));
      }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch (e) { reject(new Error('JSON inválido')); }
    });
    req.on('error', e => {
      if (e.message === 'payload_too_large') reject(Object.assign(e, { status: 413 }));
      else reject(e);
    });
  });
}

// ── Defaults de datos ────────────────────────────────────────
const DEFAULTS = {
  domainDefault:       { version: 1, rules: [] },
  domainCustom:        { customRules: [], defaultRuleExclusions: [], version: 1 },
  domainValidDefault:  { domains: [], version: 1 },
  domainValidCustom:   { domains: [], exclusions: [], version: 1 },
  keywords:     { patterns: ['test'], version: 1 },
  enterprise:   { junkCompanies: [], junkExclusions: [], version: 1 },
  homologate:   { version: 1, rules: [] },
  country:      { countries: [],  version: 1 },
  flowConfig:     { version: 1, configs: [] },
  fieldHomologated: { version: 1, libraries: [] },
  prepFormats:    { version: 1, number: [], currency: [], percent: [], date: [] },
  aiConfig: { providers: [] },
  suffixDefault: { version: 1, validTlds: [], rules: [] },
  suffixCustom:  { version: 1, rules: [] },
  learning: {
    version: 1,
    validationDecisions:  {},
    columnPreferences:    {},
    domainDecisions:      {},
    learnedPatterns:      [],
    pendingSuggestions:   [],
    companyDecisions:     {},
    learnedJunkCompanies: [],
    learnedRenames:       {},
    sessions:             [],
  },
};

// ── Migración de datos ───────────────────────────────────────
function migrate() {
  try {
    // rules.json → domain-rules-custom.json
    const oldRules = path.join(DATA_DIR, 'rules.json');
    if (fs.existsSync(oldRules) && !fs.existsSync(FILES.domainCustom)) {
      const rules = readJSON(oldRules, {});
      // customWL → domain-valid-custom.json
      if (Array.isArray(rules.customWL) && rules.customWL.length) {
        const curr = readJSON(FILES.domainValidCustom, DEFAULTS.domainValidCustom);
        if (!curr.domains.length) writeJSON(FILES.domainValidCustom, { ...curr, domains: rules.customWL });
      }
      // dominio.json → domain-valid-custom.json (user domains from old format)
      const oldDominio = path.join(DATA_DIR, 'dominio.json');
      if (fs.existsSync(oldDominio)) {
        const old = readJSON(oldDominio, DEFAULTS.domainValidDefault);
        const curr = readJSON(FILES.domainValidCustom, DEFAULTS.domainValidCustom);
        if (!curr.domains.length && old.domains?.length) writeJSON(FILES.domainValidCustom, { ...curr, domains: old.domains });
        fs.unlinkSync(oldDominio);
        console.log('  ✓ dominio.json → domain-valid-custom.json migrado');
      }
      // junkCompanies → enterprise-clean.json
      if (Array.isArray(rules.junkCompanies) && rules.junkCompanies.length && !fs.existsSync(FILES.enterprise)) {
        writeJSON(FILES.enterprise, { junkCompanies: rules.junkCompanies, junkExclusions: rules.junkExclusions || [], version: 1 });
      }
      writeJSON(FILES.domainCustom, { customRules: rules.customRules || [], defaultRuleExclusions: rules.defaultRuleExclusions || [], version: rules.version || 1 });
      fs.unlinkSync(oldRules);
      console.log('  ✓ rules.json → domain-rules-custom.json migrado');
    }
    // test.json → keywords.json
    const oldTest = path.join(DATA_DIR, 'test.json');
    if (fs.existsSync(oldTest) && !fs.existsSync(FILES.keywords)) {
      writeJSON(FILES.keywords, readJSON(oldTest, DEFAULTS.keywords));
      fs.unlinkSync(oldTest);
      console.log('  ✓ test.json → keywords.json migrado');
    }
    // suffix-rules.json → suffix-rules-default.json + suffix-rules-custom.json
    const oldSuffix = path.join(DATA_DIR, 'suffix-rules.json');
    if (fs.existsSync(oldSuffix)) {
      const old = readJSON(oldSuffix, { version: 1, validTlds: [], rules: [] });
      if (!fs.existsSync(FILES.suffixCustom)) {
        const customRules = old.rules.filter(r => r.source !== 'default');
        writeJSON(FILES.suffixCustom, { version: 1, rules: customRules });
      }
      fs.unlinkSync(oldSuffix);
      console.log('  ✓ suffix-rules.json → suffix-rules-default.json + suffix-rules-custom.json migrado');
    }
    // enterprise.json → enterprise-clean.json
    const oldEnterprise = path.join(DATA_DIR, 'enterprise.json');
    if (fs.existsSync(oldEnterprise) && !fs.existsSync(FILES.enterprise)) {
      writeJSON(FILES.enterprise, readJSON(oldEnterprise, DEFAULTS.enterprise));
      console.log('  ✓ enterprise.json → enterprise-clean.json migrado');
    }
    // field-libraries.json → field-homologated.json
    const oldLibraries = path.join(DATA_DIR, 'field-libraries.json');
    if (fs.existsSync(oldLibraries) && !fs.existsSync(FILES.fieldHomologated)) {
      fs.copyFileSync(oldLibraries, FILES.fieldHomologated);
      console.log('  ✓ field-libraries.json → field-homologated.json migrado');
    }
    // domain-valid.json → domain-valid-default.json + domain-valid-custom.json
    const oldDomainValid = path.join(DATA_DIR, 'domain-valid.json');
    if (fs.existsSync(oldDomainValid)) {
      const old = readJSON(oldDomainValid, DEFAULTS.domainValidDefault);
      const defDomains = new Set(readJSON(FILES.domainValidDefault, DEFAULTS.domainValidDefault).domains || []);
      const userAdded = (old.domains || []).filter(d => !defDomains.has(d));
      if (userAdded.length) {
        const curr = readJSON(FILES.domainValidCustom, DEFAULTS.domainValidCustom);
        if (!curr.domains.length) writeJSON(FILES.domainValidCustom, { ...curr, domains: userAdded });
      }
      fs.unlinkSync(oldDomainValid);
      console.log('  ✓ domain-valid.json → domain-valid-default.json + domain-valid-custom.json migrado');
    }
    // field-presets.json → eliminar (en desuso)
    const oldPresets = path.join(DATA_DIR, 'field-presets.json');
    if (fs.existsSync(oldPresets)) {
      fs.unlinkSync(oldPresets);
      console.log('  ✓ field-presets.json eliminado (en desuso)');
    }
  } catch (e) { console.warn('[WARN] Migración:', e.message); }
}
migrate();

// En macOS, Node.js puede resolver 'localhost' a ::1 (IPv6) mientras Ollama
// escucha solo en 127.0.0.1 (IPv4). Forzamos IPv4 en llamadas server→Ollama.
// Solo reemplazar 'localhost' cuando está seguido de ':' o '/' o es fin de cadena.
function _resolveLocalhost(url) {
  return url.replace(/\blocalhost(?=[:\/]|$)/, '127.0.0.1');
}

// ── API Routes ───────────────────────────────────────────────
const API = {

  // GET /api/data → { rules, domainDefaultRules, dominioDefault, dominioCustom, keywords, enterprise, ... }
  'GET /api/data': async (req, res) => {
    try {
      const [domainCustom, domainDefault, domainValidDefault, domainValidCustom, keywords, enterprise, homologate, country, learning, flowConfig, fieldHomologated, fieldTags] =
        await Promise.all([
          fs.promises.readFile(FILES.domainCustom,        'utf8').then(JSON.parse).catch(() => DEFAULTS.domainCustom),
          fs.promises.readFile(FILES.domainDefault,       'utf8').then(JSON.parse).catch(() => DEFAULTS.domainDefault),
          fs.promises.readFile(FILES.domainValidDefault,  'utf8').then(JSON.parse).catch(() => DEFAULTS.domainValidDefault),
          fs.promises.readFile(FILES.domainValidCustom,   'utf8').then(JSON.parse).catch(() => DEFAULTS.domainValidCustom),
          fs.promises.readFile(FILES.keywords,             'utf8').then(JSON.parse).catch(() => DEFAULTS.keywords),
          fs.promises.readFile(FILES.enterprise,           'utf8').then(JSON.parse).catch(() => DEFAULTS.enterprise),
          fs.promises.readFile(FILES.homologate,           'utf8').then(JSON.parse).catch(() => DEFAULTS.homologate),
          fs.promises.readFile(FILES.country,              'utf8').then(JSON.parse).catch(() => DEFAULTS.country),
          fs.promises.readFile(FILES.learning,             'utf8').then(JSON.parse).catch(() => DEFAULTS.learning),
          fs.promises.readFile(FILES.flowConfig,           'utf8').then(JSON.parse).catch(() => DEFAULTS.flowConfig),
          fs.promises.readFile(FILES.fieldHomologated,     'utf8').then(JSON.parse).catch(() => DEFAULTS.fieldHomologated),
          fs.promises.readFile(FILES.fieldTags,            'utf8').then(JSON.parse).catch(() => ({ libraries: [] })),
        ]);
      json(res, 200, {
        rules: domainCustom,
        domainDefaultRules: domainDefault.rules || [],
        dominioDefault: domainValidDefault,
        dominioCustom:  domainValidCustom,
        test: keywords,
        enterprise, homologate, country, learning, flowConfig, fieldHomologated, fieldTags,
      });
    } catch (e) {
      json(res, 500, { ok: false, error: e.message });
    }
  },

  // POST /api/rules → guardar reglas de corrección de dominio (domain-rules-custom.json)
  'POST /api/rules': async (req, res) => {
    try {
      const body    = await parseBody(req);
      if (body.customRules !== undefined && !Array.isArray(body.customRules)) throw new Error('customRules debe ser un array');
      if (body.defaultRuleExclusions !== undefined && !Array.isArray(body.defaultRuleExclusions)) throw new Error('defaultRuleExclusions debe ser un array');
      const current = readJSON(FILES.domainCustom, DEFAULTS.domainCustom);
      const updated = { ...current, customRules: body.customRules ?? current.customRules, defaultRuleExclusions: body.defaultRuleExclusions ?? current.defaultRuleExclusions ?? [], version: current.version || 1 };
      writeJSON(FILES.domainCustom, updated);
      json(res, 200, { ok: true });
    } catch (e) { json(res, e.status === 413 ? 413 : 400, { ok: false, error: e.message }); }
  },

  // POST /api/domain-valid → guardar dominios válidos custom + exclusiones en domain-valid-custom.json
  'POST /api/domain-valid': async (req, res) => {
    try {
      const body    = await parseBody(req);
      if (body.domains    !== undefined && !Array.isArray(body.domains))    throw new Error('domains debe ser un array');
      if (body.exclusions !== undefined && !Array.isArray(body.exclusions)) throw new Error('exclusions debe ser un array');
      const current = readJSON(FILES.domainValidCustom, DEFAULTS.domainValidCustom);
      const updated = { ...current, domains: body.domains ?? current.domains, exclusions: body.exclusions ?? current.exclusions ?? [], version: current.version || 1 };
      writeJSON(FILES.domainValidCustom, updated);
      json(res, 200, { ok: true });
    } catch (e) { json(res, e.status === 413 ? 413 : 400, { ok: false, error: e.message }); }
  },

  // POST /api/keywords → guardar patrones de detección de filas de prueba (keywords.json)
  'POST /api/keywords': async (req, res) => {
    try {
      const body    = await parseBody(req);
      if (body.patterns !== undefined && !Array.isArray(body.patterns)) throw new Error('patterns debe ser un array');
      const current = readJSON(FILES.keywords, DEFAULTS.keywords);
      const updated = { ...current, patterns: body.patterns ?? current.patterns, version: current.version || 1 };
      writeJSON(FILES.keywords, updated);
      json(res, 200, { ok: true });
    } catch (e) { json(res, e.status === 413 ? 413 : 400, { ok: false, error: e.message }); }
  },

  // POST /api/enterprise → guardar empresas basura (solo las agregadas con el botón)
  'POST /api/enterprise': async (req, res) => {
    try {
      const body    = await parseBody(req);
      if (body.junkCompanies  !== undefined && !Array.isArray(body.junkCompanies))  throw new Error('junkCompanies debe ser un array');
      if (body.junkExclusions !== undefined && !Array.isArray(body.junkExclusions)) throw new Error('junkExclusions debe ser un array');
      const current = readJSON(FILES.enterprise, DEFAULTS.enterprise);
      const updated = {
        ...current,
        junkCompanies:  body.junkCompanies  ?? current.junkCompanies,
        junkExclusions: body.junkExclusions ?? current.junkExclusions,
        version: current.version || 1,
      };
      writeJSON(FILES.enterprise, updated);
      json(res, 200, { ok: true });
    } catch (e) { json(res, e.status === 413 ? 413 : 400, { ok: false, error: e.message }); }
  },

  // POST /api/enterprise-homologate → guardar reglas de homologación de empresa
  'POST /api/enterprise-homologate': async (req, res) => {
    try {
      const body    = await parseBody(req);
      if (body.rules !== undefined && !Array.isArray(body.rules)) throw new Error('rules debe ser un array');
      const current = readJSON(FILES.homologate, DEFAULTS.homologate);
      writeJSON(FILES.homologate, { ...current, rules: body.rules ?? current.rules, version: current.version || 1 });
      json(res, 200, { ok: true });
    } catch (e) { json(res, e.status === 413 ? 413 : 400, { ok: false, error: e.message }); }
  },

  // POST /api/learning → guardar datos de aprendizaje
  'POST /api/learning': async (req, res) => {
    try {
      const body = await parseBody(req);
      const current = readJSON(FILES.learning, DEFAULTS.learning);
      const updated = mergeLearning(current, body);
      writeJSON(FILES.learning, updated);
      json(res, 200, { ok: true, data: updated });
    } catch (e) {
      json(res, e.status === 413 ? 413 : 400, { ok: false, error: e.message });
    }
  },

  // GET /api/learning → exportar learning completo
  'GET /api/learning': async (req, res) => {
    try {
      const learning = readJSON(FILES.learning, DEFAULTS.learning);
      json(res, 200, learning);
    } catch (e) {
      json(res, 500, { ok: false, error: e.message });
    }
  },

  // POST /api/learning/import → reemplazar learning completo (no merge)
  'POST /api/learning/import': async (req, res) => {
    try {
      const body = await parseBody(req);
      if (!body || typeof body !== 'object' || !body.version) {
        json(res, 400, { ok: false, error: 'invalid_learning' }); return;
      }
      const safe = { ...DEFAULTS.learning, ...body };
      writeJSON(FILES.learning, safe);
      json(res, 200, { ok: true, data: safe });
    } catch (e) {
      json(res, e.status === 413 ? 413 : 400, { ok: false, error: e.message });
    }
  },

  // POST /api/learning/reset → restaurar learning a estado inicial
  'POST /api/learning/reset': async (req, res) => {
    try {
      writeJSON(FILES.learning, { ...DEFAULTS.learning });
      json(res, 200, { ok: true });
    } catch (e) {
      json(res, 500, { ok: false, error: e.message });
    }
  },

  // GET /api/suffix-rules → merge de suffix-rules-default.json + suffix-rules-custom.json
  'GET /api/suffix-rules': async (req, res) => {
    try {
      const [def, cust] = await Promise.all([
        fs.promises.readFile(FILES.suffixDefault, 'utf8').then(JSON.parse).catch(() => DEFAULTS.suffixDefault),
        fs.promises.readFile(FILES.suffixCustom,  'utf8').then(JSON.parse).catch(() => DEFAULTS.suffixCustom),
      ]);
      const defRules  = (def.rules  || []).map(r => ({ ...r, source: 'default' }));
      const custRules = (cust.rules || []).map(r => ({ ...r, source: r.source || 'manual' }));
      json(res, 200, { version: def.version || 1, validTlds: def.validTlds || [], rules: [...defRules, ...custRules] });
    } catch (e) {
      json(res, 500, { ok: false, error: e.message });
    }
  },

  // POST /api/suffix-rules → guardar solo reglas custom del usuario (suffix-rules-custom.json)
  'POST /api/suffix-rules': async (req, res) => {
    try {
      const body = await parseBody(req);
      if (!body || !Array.isArray(body.rules)) {
        json(res, 400, { ok: false, error: 'invalid_suffix_rules' }); return;
      }
      const customOnly = body.rules.filter(r => r.source !== 'default');
      const current    = readJSON(FILES.suffixCustom, DEFAULTS.suffixCustom);
      const updated    = { ...current, rules: customOnly, version: current.version || 1 };
      writeJSON(FILES.suffixCustom, updated);
      json(res, 200, { ok: true, data: updated });
    } catch (e) {
      json(res, 500, { ok: false, error: e.message });
    }
  },

  // POST /api/session → registrar sesión completada
  'POST /api/session': async (req, res) => {
    try {
      const session = await parseBody(req);
      const learning = readJSON(FILES.learning, DEFAULTS.learning);
      learning.sessions = learning.sessions || [];
      learning.sessions.unshift({ ...session, ts: Date.now() });
      if (learning.sessions.length > 50) learning.sessions = learning.sessions.slice(0, 50);
      writeJSON(FILES.learning, learning);
      json(res, 200, { ok: true });
    } catch (e) {
      json(res, e.status === 413 ? 413 : 400, { ok: false, error: e.message });
    }
  },

  // POST /api/flow-config → guardar configuración de flujo y columnas por patrón de archivo
  'POST /api/flow-config': async (req, res) => {
    try {
      const body = await parseBody(req);
      if (body.configs !== undefined && !Array.isArray(body.configs)) throw new Error('configs debe ser un array');
      writeJSON(FILES.flowConfig, body);
      json(res, 200, { ok: true });
    } catch (e) { json(res, e.status === 413 ? 413 : 400, { ok: false, error: e.message }); }
  },

  // POST /api/field-homologated → guardar librerías de homologación de campos
  'POST /api/field-homologated': async (req, res) => {
    try {
      const body = await parseBody(req);
      if (body.libraries !== undefined && !Array.isArray(body.libraries)) throw new Error('libraries debe ser un array');
      writeJSON(FILES.fieldHomologated, { version: 1, libraries: body.libraries ?? [] });
      json(res, 200, { ok: true });
    } catch (e) { json(res, e.status === 413 ? 413 : 400, { ok: false, error: e.message }); }
  },

  // POST /api/field-tags → guardar librerías de etiquetas
  'POST /api/field-tags': async (req, res) => {
    try {
      const body = await parseBody(req);
      if (body.libraries !== undefined && !Array.isArray(body.libraries)) throw new Error('libraries debe ser un array');
      writeJSON(FILES.fieldTags, { libraries: body.libraries ?? [] });
      json(res, 200, { ok: true });
    } catch (e) { json(res, e.status === 413 ? 413 : 400, { ok: false, error: e.message }); }
  },

  // GET /api/prep-formats → presets de formato número/fecha del editor
  'GET /api/prep-formats': (req, res) => {
    json(res, 200, readJSON(FILES.prepFormats, DEFAULTS.prepFormats));
  },

  // POST /api/prep-formats → guardar presets de formato
  'POST /api/prep-formats': async (req, res) => {
    try {
      const body = await parseBody(req);
      if (body.number   !== undefined && !Array.isArray(body.number))   throw new Error('number debe ser un array');
      if (body.currency !== undefined && !Array.isArray(body.currency)) throw new Error('currency debe ser un array');
      if (body.percent  !== undefined && !Array.isArray(body.percent))  throw new Error('percent debe ser un array');
      if (body.date     !== undefined && !Array.isArray(body.date))     throw new Error('date debe ser un array');
      const current = readJSON(FILES.prepFormats, DEFAULTS.prepFormats);
      writeJSON(FILES.prepFormats, {
        version:  1,
        number:   body.number   ?? current.number,
        currency: body.currency ?? current.currency  ?? [],
        percent:  body.percent  ?? current.percent   ?? [],
        date:     body.date     ?? current.date,
      });
      json(res, 200, { ok: true });
    } catch (e) { json(res, e.status === 413 ? 413 : 400, { ok: false, error: e.message }); }
  },

  // GET /api/health
  'GET /api/health': (req, res) => {
    json(res, 200, { ok: true, ts: Date.now(), port: PORT });
  },

  // GET /api/ai-config → devuelve lista de proveedores
  'GET /api/ai-config': (req, res) => {
    json(res, 200, readJSON(FILES.aiConfig, DEFAULTS.aiConfig));
  },

  // POST /api/ai-config → merge selectivo (preserva campos no enviados)
  'POST /api/ai-config': async (req, res) => {
    try {
      const body    = await parseBody(req);
      const current = readJSON(FILES.aiConfig, DEFAULTS.aiConfig);
      const updated = { ...current };
      if (Object.prototype.hasOwnProperty.call(body, 'providers'))             updated.providers             = Array.isArray(body.providers) ? body.providers : (current.providers ?? []);
      if (Object.prototype.hasOwnProperty.call(body, 'prompt'))                updated.prompt                = body.prompt ?? null;
      if (Object.prototype.hasOwnProperty.call(body, 'prompt_es'))             updated.prompt_es             = body.prompt_es ?? null;
      if (Object.prototype.hasOwnProperty.call(body, 'prompt_en'))             updated.prompt_en             = body.prompt_en ?? null;
      if (Object.prototype.hasOwnProperty.call(body, 'fieldHomolPrompt'))      updated.fieldHomolPrompt      = body.fieldHomolPrompt ?? null;
      if (Object.prototype.hasOwnProperty.call(body, 'fieldHomolPrompt_es'))   updated.fieldHomolPrompt_es   = body.fieldHomolPrompt_es ?? null;
      if (Object.prototype.hasOwnProperty.call(body, 'fieldHomolPrompt_en'))   updated.fieldHomolPrompt_en   = body.fieldHomolPrompt_en ?? null;
      writeJSON(FILES.aiConfig, updated);
      json(res, 200, { ok: true });
    } catch (e) { json(res, e.status === 413 ? 413 : 400, { ok: false, error: e.message }); }
  },

  // GET /api/ai-prompts → devuelve prompts por módulo
  'GET /api/ai-prompts': (req, res) => {
    json(res, 200, readJSON(FILES.aiPrompts, {}));
  },

  // GET /api/ai/health → verifica que el provider esté disponible y si el modelo está cargado
  // Acepta ?url= para testear sin guardar (desde el form de config)
  'GET /api/ai/health': async (req, res) => {
    const cfg = readJSON(FILES.aiConfig, DEFAULTS.aiConfig);
    const qParams = new URL(`http://x${req.url}`).searchParams;
    const qUrl    = qParams.get('url');
    const qModel  = qParams.get('model');
    const providers = cfg.providers || [];
    const providerUrl = qUrl || providers[0]?.url || '';
    if (!providerUrl) { json(res, 200, { ok: false, error: 'Sin provider configurado' }); return; }
    try {
      const base = _resolveLocalhost(providerUrl.replace(/\/v1\/.*$/, ''));
      // 1. Verificar que Ollama corra
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), 5000);
      const r    = await fetch(`${base}/api/tags`, { signal: ctrl.signal });
      clearTimeout(tid);
      if (!r.ok) { json(res, 200, { ok: false }); return; }
      // 2. Verificar si el modelo ya está cargado en memoria (ps es instantáneo)
      try {
        const psCtrl = new AbortController();
        const psTid  = setTimeout(() => psCtrl.abort(), 3000);
        const psRes  = await fetch(`${base}/api/ps`, { signal: psCtrl.signal });
        clearTimeout(psTid);
        if (psRes.ok) {
          const ps      = await psRes.json();
          const model   = qModel || providers[0]?.model || '';
          const loaded  = (ps.models || []).some(m => m.name === model || m.name?.startsWith(model?.split(':')[0]));
          json(res, 200, { ok: true, modelLoaded: loaded });
          return;
        }
      } catch { /* si /api/ps falla, ignorar y reportar ok sin info de modelo */ }
      json(res, 200, { ok: true, modelLoaded: null });
    } catch {
      json(res, 200, { ok: false });
    }
  },

  // POST /api/ai → proxy al provider LLM (OpenAI-compatible)
  'POST /api/ai': async (req, res) => {
    try {
      const body      = await parseBody(req);
      const cfg       = readJSON(FILES.aiConfig, DEFAULTS.aiConfig);
      const providers = cfg.providers || [];
      const provider  = (body.providerId ? providers.find(p => p.id === body.providerId) : null) || providers[0];
      if (!provider) { json(res, 200, { ok: false, error: 'No hay proveedores LLM configurados' }); return; }

      const prompts    = readJSON(FILES.aiPrompts, {});
      const promptKey  = body.promptKey || 'nameExtractor';
      const systemMsg  = prompts[promptKey]?.system || 'Responde SOLO con JSON valido.';

      const headers = { 'Content-Type': 'application/json' };
      if (provider.apiKey && provider.apiKey !== 'ollama') headers['Authorization'] = `Bearer ${provider.apiKey}`;

      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), 90000);
      let aiRes;
      try {
        // Para Ollama: expandir contexto según los tokens solicitados
        const ollamaOpts = (provider.apiKey === 'ollama' && body.maxTokens)
          ? { options: { num_ctx: Math.min(8192, body.maxTokens + 1024) } }
          : {};
        aiRes = await fetch(_resolveLocalhost(provider.url), {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model:       provider.model,
            messages: [
              { role: 'system', content: systemMsg },
              { role: 'user',   content: body.prompt },
            ],
            temperature: provider.temperature,
            top_p:       provider.top_p,
            seed:        provider.seed,
            max_tokens:  body.maxTokens || provider.maxTokens,
            stream:      false,
            ...ollamaOpts,
          }),
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(tid);
      }
      if (!aiRes.ok) {
        json(res, 200, { ok: false, error: `Provider HTTP ${aiRes.status}` }); return;
      }
      const data = await aiRes.json();
      // Quitar thinking blocks de Qwen3 / DeepSeek (<think>...</think>)
      const raw  = data.choices?.[0]?.message?.content || '';
      const text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      json(res, 200, { ok: true, text, waitTime: provider.waitTime || 0 });
    } catch (e) {
      if (e.status === 413) json(res, 413, { ok: false, error: e.message });
      else json(res, 200, { ok: false, error: e.name === 'AbortError' ? 'timeout' : e.message });
    }
  },
};

// ── Merge profundo de learning data ─────────────────────────
function mergeLearning(current, incoming) {
  const merged = { ...current };
  // validationDecisions / domainDecisions: sumar contadores numéricos (accepted, rejected)
  for (const key of ['validationDecisions', 'domainDecisions']) {
    if (incoming[key]) {
      merged[key] = merged[key] || {};
      for (const [k, v] of Object.entries(incoming[key])) {
        if (typeof v === 'object' && !Array.isArray(v)) {
          merged[key][k] = merged[key][k] || {};
          for (const [vk, vv] of Object.entries(v)) {
            merged[key][k][vk] = typeof vv === 'number'
              ? (merged[key][k][vk] || 0) + vv
              : vv;
          }
        } else {
          merged[key][k] = v;
        }
      }
    }
  }
  // columnPreferences: reemplazar siempre (no sumar — son preferencias, no contadores)
  if (incoming.columnPreferences) {
    merged.columnPreferences = merged.columnPreferences || {};
    for (const [k, v] of Object.entries(incoming.columnPreferences)) {
      merged.columnPreferences[k] = v;
    }
  }
  // learnedPatterns: merge por (type, from, to), suma el campo count para no perder aprendizaje de otras tabs
  if (incoming.learnedPatterns) {
    const existing = merged.learnedPatterns || [];
    const map = new Map(existing.map(p => [`${p.type}:${p.from}:${p.to}`, { ...p }]));
    for (const p of incoming.learnedPatterns) {
      const key = `${p.type}:${p.from}:${p.to}`;
      if (map.has(key)) {
        map.get(key).count = (map.get(key).count || 1) + ((p.count || 1) - 1);
      } else {
        map.set(key, { ...p });
      }
    }
    merged.learnedPatterns = [...map.values()];
  }
  // pendingSuggestions: reemplazar (son sugerencias transitorias, no contadores acumulativos)
  if (incoming.pendingSuggestions) merged.pendingSuggestions = incoming.pendingSuggestions;
  // Campos extra del cliente (companyDecisions, learnedJunkCompanies, learnedRenames) — merge selectivo
  for (const key of ['companyDecisions', 'learnedRenames']) {
    if (incoming[key]) merged[key] = { ...(merged[key] || {}), ...incoming[key] };
  }
  if (incoming.learnedJunkCompanies) {
    const set = new Set([...(merged.learnedJunkCompanies || []), ...incoming.learnedJunkCompanies]);
    merged.learnedJunkCompanies = [...set];
  }
  return merged;
}

// ── Servidor ─────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  const method  = req.method;

  // CORS para desarrollo
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // API routes
  const route = `${method} ${pathname}`;
  if (API[route]) { API[route](req, res); return; }

  // Archivos estáticos
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  // Seguridad: evitar path traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err) {
      if (err.code === 'ENOENT') {
        // SPA fallback: servir index.html
        fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, d2) => {
          if (e2) { res.writeHead(404); res.end('Not found'); return; }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(d2);
        });
      } else {
        res.writeHead(500); res.end('Server error');
      }
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Content-Length': stat.size,
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  const addr = `http://localhost:${PORT}`;
  console.log(`\n  DataB Flow · Cleaning | Transformation | Governance · © 2026 mdmarein · GNU AGPLv3`);
  console.log(`  ───────────────────────────────────────────────────────────────────`);
  console.log(`  Servidor: ${addr}`);
  console.log(`  Datos:    ${DATA_DIR}`);
  console.log(`\n  Abrí ${addr} en Chrome\n`);
  // Intentar abrir el browser automáticamente
  const { exec } = require('child_process');
  const cmd = process.platform === 'darwin' ? `open ${addr}`
            : process.platform === 'win32'  ? `start ${addr}`
            : `xdg-open ${addr}`;
  exec(cmd, err => { if (err) console.log(`  (Abrí ${addr} manualmente)\n`); });
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE')
    console.error(`\n[ERROR] Puerto ${PORT} en uso. Cerrá otro proceso o cambiá PORT.\n`);
  else
    console.error('\n[ERROR]', e.message, '\n');
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('\n  Servidor cerrado.\n');
  process.exit(0);
});