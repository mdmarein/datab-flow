/**
 * ai.js — Cliente reutilizable para llamadas a Ollama vía proxy
 * DataB Flow · Cleaning | Transformation | Governance · © 2026 mdmarein · GNU AGPLv3
 */

// DEFAULT_PROMPT y DEFAULT_FIELD_PROMPT son fallbacks de último recurso cuando ai-prompts-default.json
// no está disponible. En producción normal el servidor lee el system prompt del JSON y el frontend
// obtiene el user prompt via GET /api/ai-prompts. Estos strings deben mantenerse sincronizados con
// las entradas nameExtractor.user y fieldHomologator.user de ai-prompts-default.json.
export async function callAI(prompt, { signal, providerId, promptKey, maxTokens } = {}) {
  try {
    const body = { prompt };
    if (providerId) body.providerId = providerId;
    if (promptKey)  body.promptKey  = promptKey;
    if (maxTokens)  body.maxTokens  = maxTokens;
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { ok: false, error: err.error || `HTTP ${res.status}` };
    }
    const data = await res.json();
    if (!data.ok) return { ok: false, error: data.error || 'AI error' };
    return { ok: true, text: data.text || '' };
  } catch (e) {
    if (e.name === 'AbortError') return { ok: false, error: 'aborted' };
    return { ok: false, error: e.message };
  }
}

const DEFAULT_PROMPT = `Contact:
  Email: {{EMAIL}}
  First name: {{NOMBRE}}
  Last name: {{APELLIDO}}

Fill ONLY the field(s) showing "(missing)". NEVER change a field that already has a value.
Use ONLY the username — the part before @ — and completely ignore the email domain.

── SKIP: Generic/role usernames ──
If the username is one of: info, admin, ventas, soporte, web, contacto, noreply, no-reply, hola, mail, rrhh, atencion, consultas
→ return {"firstName":"","lastName":""}

── CASE 1: Username contains dot(s) ──
Split by dots. Remove any generic parts listed above.
• First name IS known: find which part(s) match it → remaining parts joined with space = last name
• Last name IS known: find which part(s) match it → remaining parts joined with space = first name
• Neither known (LATAM): first part = first name, remaining parts joined with space = last name

Examples:
  Email=juan.garcia@x | first=(missing) | last=Garcia  → {"firstName":"Juan","lastName":"Garcia"}
  Email=s.silva@x     | first=Sergio    | last=(missing) → {"firstName":"Sergio","lastName":"Silva"}
  Email=gabriel.garcia.marquez@x | neither → {"firstName":"Gabriel","lastName":"Garcia Marquez"}

── CASE 2: Username has NO dot ──
Pattern: [initial letter(s) of first name][last name glued] — e.g. jperez, aalarcon, mjrodriguez

• First name IS known: count leading letters matching first name initials → strip them → rest = last name
  username=jperez, first=Juan → strip j → last=Perez
  username=mjrodriguez, first=Maria Jose → strip mj → last=Rodriguez
• Last name IS known: strip 1-2 chars → cannot determine first name → firstName=""
• Neither known: strip 1 char → remaining = last name, firstName=""
  username=mgonzalez → {"firstName":"","lastName":"Gonzalez"}

── CAPITALIZATION ──
Each word: first letter uppercase, rest lowercase. Handle ñ, á, é, í, ó, ú.
Compound last names: capitalize each part — De La Cruz, Garcia Marquez.

Reply ONLY with: {"firstName":"","lastName":""}`;

export async function extractNameParts(email, { signal, customPrompt, nombre = '', apellido = '', providerId } = {}) {
  const template = customPrompt || DEFAULT_PROMPT;
  const prompt   = template
    .replace('{{EMAIL}}',    email)
    .replace('{{NOMBRE}}',   nombre   || '(missing)')
    .replace('{{APELLIDO}}', apellido || '(missing)');

  const result = await callAI(prompt, { signal, providerId });
  if (!result.ok) return { ok: false, firstName: '', lastName: '' };

  try {
    // Buscar JSON en la respuesta (el modelo puede agregar texto antes/después)
    const jsonMatch = result.text.match(/\{[^}]*"firstName"[^}]*\}/s);
    const raw = jsonMatch ? jsonMatch[0] : result.text.trim();
    const parsed = JSON.parse(raw);
    return {
      ok: true,
      firstName: (parsed.firstName || '').trim(),
      lastName:  (parsed.lastName  || '').trim(),
    };
  } catch {
    // Fallback regex si el JSON viene malformado
    const m = result.text.match(/"firstName"\s*:\s*"([^"]*)"[^}]*"lastName"\s*:\s*"([^"]*)"/s);
    if (m) return { ok: true, firstName: m[1].trim(), lastName: m[2].trim() };
    return { ok: true, firstName: '', lastName: '' };
  }
}

const DEFAULT_FIELD_PROMPT =
`Sos un especialista en homologación de datos de contactos B2B.

Tu tarea: analizar los {{COUNT}} valores únicos del campo "{{FIELD_NAME}}" y proponer la homologación más limpia posible.

Campo: {{FIELD_NAME}}
Valores ({{COUNT}} únicos):
{{VALUES}}

LIBRERÍAS CANÓNICAS DISPONIBLES:
{{LIBRARIES}}

═══ PROCESO (seguí este orden) ═══

PASO 1 — IDENTIFICAR EL TIPO DE CAMPO
Analizá el nombre del campo y sus valores para determinar qué tipo de dato contiene (cargo, profesión, actividad, rubro, provincia, especialidad, etc.).

PASO 2 — EVALUAR LIBRERÍAS
Revisá cada librería. Usá una librería si:
• Sus canónicos cubren semánticamente la mayoría de los valores del campo
• El tipo del campo coincide con el propósito de la librería
• Al menos el 60% de los valores pueden mapearse a canónicos de esa librería
Si ninguna aplica → libraryUsed: null

PASO 3 — HOMOLOGAR

CON LIBRERÍA SELECCIONADA:
• Mapeá cada valor al canónico más cercano de esa librería
• Valores sin equivalente claro → mapeá a "Otro" u "Otra" si existe en la librería, o al canónico más próximo
• No inventes canónicos fuera de la librería seleccionada

SIN LIBRERÍA (homologación libre):
1. REDUCCIÓN MÁXIMA: agrupá todo lo que represente el mismo concepto real. Si hay duda, agrupá.
2. MISMO CONCEPTO: variantes de género (Arquitecto/Arquitecta → Arquitecto/a), idioma (Manager → Gerente), mayúsculas, errores tipográficos, abreviaturas, plural/singular.
3. ROLES EQUIVALENTES van en el mismo grupo: "CEO", "Director Ejecutivo", "Director General" → un grupo.
4. INDUSTRIAS/SECTORES equivalentes van juntos: "Tecnología", "IT", "TI", "Tech" → un grupo.
5. VALOR CANÓNICO: español, primera letra mayúscula por palabra principal, forma más completa y profesional.
6. No mantengás grupos de un solo valor si ese valor es variante obvia de otro grupo.

RESPONDÉ ÚNICAMENTE con JSON válido (sin texto, sin markdown, sin comentarios):
{"libraryUsed":"id_de_libreria_o_null","groups":[{"canonical":"Valor Canónico","values":["variante1","variante2"]}]}`;

const MAX_VALUES_AI = 250;  // límite seguro para evitar truncado silencioso por contexto

export async function analyzeFieldValues(fieldName, values, { signal, providerId, promptTemplate, libraries = [], forcedLibrary = null } = {}) {
  let prompt, promptKey, tokensNeeded;

  // Truncar si hay demasiados valores únicos — ordenar por longitud ascendente (valores cortos suelen ser más canónicos)
  let effectiveValues = values;
  const truncatedCount = values.length > MAX_VALUES_AI ? values.length - MAX_VALUES_AI : 0;
  if (truncatedCount > 0) {
    effectiveValues = [...values].sort((a, b) => a.length - b.length).slice(0, MAX_VALUES_AI);
  }

  if (forcedLibrary) {
    // Prompt completamente diferente para modo forzado — sin lógica de evaluación
    const canonicals = forcedLibrary.values.join('\n').replace(/^/gm, '- ');
    const truncNote = truncatedCount > 0
      ? `\n(Nota: se enviaron ${effectiveValues.length} de ${values.length} valores únicos por límite de tokens. Los ${truncatedCount} valores restantes deberán ser revisados manualmente.)`
      : '';
    prompt = `Tenés ${effectiveValues.length} valores únicos del campo "${fieldName}" que deben mapearse a los canónicos de la librería "${forcedLibrary.name}".${truncNote}

CANÓNICOS DISPONIBLES (usá ÚNICAMENTE estos):
${canonicals}

VALORES A MAPEAR:
${effectiveValues.map(v => `- ${v}`).join('\n')}

INSTRUCCIONES:
1. Mapeá CADA valor al canónico semánticamente más cercano de la lista de arriba.
2. No podés usar canónicos fuera de la lista ni inventar nuevos.
3. Si un valor no tiene equivalente claro, usá el canónico más próximo.
4. Agrupá variantes del mismo concepto bajo un único canónico.
5. Incluí la TOTALIDAD de los ${effectiveValues.length} valores en algún grupo.

RESPONDÉ ÚNICAMENTE con JSON válido:
{"libraryUsed":"${forcedLibrary.id}","groups":[{"canonical":"Canónico","values":["variante1","variante2"]}]}`;

    promptKey    = 'fieldHomologatorForced';
    tokensNeeded = Math.max(1024, Math.min(4096, effectiveValues.length * 30 + forcedLibrary.values.length * 15 + 512));
  } else {
    const template    = promptTemplate || DEFAULT_FIELD_PROMPT;
    const librariesStr = libraries.length
      ? libraries.map(lib => `[${lib.id}] "${lib.name}": ${lib.values.join(' | ')}`).join('\n')
      : '(sin librerías disponibles)';
    prompt = template
      .replace(/\{\{FIELD_NAME\}\}/g, fieldName)
      .replace('{{COUNT}}', String(effectiveValues.length))
      .replace('{{VALUES}}', effectiveValues.map(v => `- ${v}`).join('\n'))
      .replace('{{LIBRARIES}}', librariesStr);
    promptKey    = 'fieldHomologator';
    tokensNeeded = Math.max(1024, Math.min(4096, effectiveValues.length * 35 + libraries.length * 20 + 512));
  }

  const result = await callAI(prompt, { signal, providerId, promptKey, maxTokens: tokensNeeded });
  if (!result.ok) { console.warn('[AI] analyzeFieldValues error:', result.error); return null; }
  if (!result.text) { console.warn('[AI] analyzeFieldValues: respuesta vacía'); return null; }

  const clean = result.text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  let parsed = null;

  try { parsed = JSON.parse(clean); } catch { /* continuar */ }

  if (!parsed) {
    try {
      const start = clean.indexOf('{');
      if (start !== -1) {
        let depth = 0, end = -1;
        for (let i = start; i < clean.length; i++) {
          if (clean[i] === '{') depth++;
          else if (clean[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
        }
        if (end !== -1) parsed = JSON.parse(clean.slice(start, end + 1));
      }
    } catch { /* nada */ }
  }

  if (!parsed?.groups) {
    console.warn('[AI] analyzeFieldValues: no se pudo parsear JSON. Respuesta:', result.text.slice(0, 300));
    return null;
  }

  return {
    libraryUsed: forcedLibrary
      ? forcedLibrary.id
      : (parsed.libraryUsed && parsed.libraryUsed !== 'null' ? parsed.libraryUsed : null),
    groups:        Array.isArray(parsed.groups) ? parsed.groups : [],
    truncatedCount,
  };
}

// Retorna false si el servidor no responde, 'cold' si el modelo no está cargado, true si está listo.
export async function checkOllamaAvailable(providerUrl = '', model = '') {
  try {
    const params = new URLSearchParams();
    if (providerUrl) params.set('url', providerUrl);
    if (model)       params.set('model', model);
    const qs  = params.toString() ? `?${params}` : '';
    const res = await fetch(`/api/ai/health${qs}`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return false;
    const data = await res.json();
    if (!data.ok) return false;
    if (data.modelLoaded === false) return 'cold';
    return true;
  } catch {
    return false;
  }
}
