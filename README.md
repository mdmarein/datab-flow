<div align="center">
  <img src="public/img/datab-flow-banner.png" alt="DataB Flow" width="100%">
</div>

# DataB Flow

**Cleaning | Transformation | Governance**

![version](https://img.shields.io/badge/version-2.0.0-blue) ![license](https://img.shields.io/badge/license-AGPL--3.0-green) ![node](https://img.shields.io/badge/node-%3E%3D14-brightgreen)

**English version:** [README.en.md](README.en.md)

Una herramienta local y gratuita para limpiar y procesar listas de contactos en formato CSV, TSV o XLSX. Sin necesidad de instalar librerías ni pagar servicios — todo corre en tu computadora.

---

## ¿Qué hace?

Tomás un archivo CSV, TSV o XLSX con emails (y opcionalmente nombre, apellido, empresa, teléfono, país, cargo, tags, etc.) y lo pasás por un wizard de varios pasos:

- Corrige emails con errores comunes de tipeo en el dominio, por ejemplo:

  | Email original | Email corregido | Proveedor |
  |----------------|-----------------|-----------|
  | `usuario@gmial.com` | `usuario@gmail.com` | Gmail |
  | `usuario@homail.com` | `usuario@hotmail.com` | Hotmail |
  | `usuario@yaho.com` | `usuario@yahoo.com` | Yahoo |
  | `usuario@outlok.com` | `usuario@outlook.com` | Outlook |
  | `usuario@icluod.com` | `usuario@icloud.com` | iCloud |

- Elimina duplicados con estrategias configurables
- Detecta y elimina filas de prueba/test
- Normaliza empresas, países, teléfonos y campos personalizados
- Homologa cualquier campo de texto (cargo, industria, etc.) agrupando variantes con IA
- Etiqueta filas por valor de un campo, con librería reutilizable y sugerencia por IA
- Completa nombres y apellidos usando IA (local o vía API)
- Editor de archivos tipo planilla, en ventana separada y sincronizado en vivo con el wizard (soporta CSV, TSV y XLSX)
- Exporta el CSV limpio y un log de todos los cambios
- Interfaz bilingüe (**español / inglés**) y con **tema claro y oscuro**

Aprende de tus decisiones y las aplica automáticamente en sesiones futuras.

---

## Antes de empezar: instalar Node.js

datab-flow necesita **Node.js v14 o superior**. Si ya lo tenés instalado, podés saltar este paso.

### Mac

1. Abrí el navegador y entrá a **https://nodejs.org**
2. Hacé clic en el botón verde **"LTS"** (versión recomendada)
3. Se descarga un archivo `.pkg` — hacé doble clic y seguí el instalador
4. Para verificar, abrí la app **Terminal** (`⌘ + Espacio`, escribí "Terminal") y ejecutá:
   ```bash
   node --version
   ```
   Tiene que aparecer algo como `v22.0.0` o superior.

### Windows

1. Abrí el navegador y entrá a **https://nodejs.org**
2. Hacé clic en el botón verde **"LTS"** (versión recomendada)
3. Se descarga un archivo `.msi` — hacé doble clic y seguí el instalador (dejá todas las opciones por defecto)
4. Para verificar, abrí el **Símbolo del sistema** (buscá "cmd" en el menú Inicio) y ejecutá:
   ```
   node --version
   ```
   Tiene que aparecer algo como `v22.0.0` o superior.

### Linux (Ubuntu / Debian)

Abrí una terminal y ejecutá:

```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Para otras distros (Fedora, Arch, etc.), seguí las instrucciones en **https://nodejs.org/en/download/package-manager**

---

## Descargar datab-flow

### Opción A — ZIP (más fácil, sin instalar nada extra)

1. Entrá a la página del proyecto en GitHub
2. Hacé clic en el botón verde **"Code"**
3. Seleccioná **"Download ZIP"**
4. Descomprimí el archivo en la carpeta que prefieras (ej: `Documentos/datab-flow`)

### Opción B — git clone

```bash
git clone https://github.com/mdmarein/datab-flow.git
cd datab-flow
```

---

## Cómo correr la aplicación

Hay dos formas de iniciar DataB Flow: desde la terminal o como una app con ícono en el escritorio.

---

### Opción 1 — Desde la terminal

#### Mac / Linux

Abrí una terminal en la carpeta del proyecto y escribí:

```bash
node server.js
```

#### Windows

Abrí el Símbolo del sistema en la carpeta del proyecto y escribí:

```
node server.js
```

---

### Opción 2 — Instalar como app con ícono (recomendado)

Podés crear un acceso directo con ícono en tu escritorio para abrir DataB Flow con doble clic, sin necesidad de usar la terminal.

#### Mac — Crear "DataB Flow.app"

1. Abrí una terminal en la carpeta del proyecto
2. Ejecutá:
   ```bash
   bash tools/make-mac-app.sh
   ```
3. Se crea **"DataB Flow.app"** en tu escritorio
4. **Primera vez:** clic derecho sobre el ícono → **Abrir** (macOS pide confirmación una sola vez)
5. **Las siguientes veces:** doble clic normal

> El app inicia el servidor automáticamente y abre el navegador en `http://localhost:3000`.  
> Si el servidor ya está corriendo, solo abre el navegador.

#### Windows — Crear acceso directo

1. Abrí la carpeta del proyecto en el Explorador de archivos
2. Entrá a la carpeta `tools`
3. Hacé doble clic en **`make-win-shortcut.bat`**
4. Se crea **"DataB Flow"** en tu escritorio
5. Doble clic en el ícono para iniciar la app

> Si aparece un error de permisos, clic derecho → **Ejecutar como administrador**.

---

### Abrir la aplicación en el navegador

Si usás la opción terminal, con el servidor corriendo abrí tu navegador y entrá a:

```
http://localhost:3000
```

Si usás el ícono instalado, el navegador se abre automáticamente.

Para cerrar el servidor desde la terminal: presioná `Ctrl + C`.

**Cambiar puerto (opcional):**
```bash
PORT=8080 node server.js          # Mac / Linux
set PORT=8080 && node server.js   # Windows
```

---

## Guía de uso

La aplicación funciona como un wizard. Después de importar el archivo y elegir los campos, la pantalla **C — Análisis del CSV** te muestra qué módulos detectaron algo para corregir, y en **D — Selección de flujo** activás o desactivás cada uno según lo que necesite tu archivo (los módulos sin issues quedan sugeridos como omitidos, pero podés cambiarlo).

### Paso A — Importar

Arrastrá tu archivo CSV, TSV o XLSX a la pantalla (o hacé clic para buscarlo). La app detecta automáticamente:
- El encoding del archivo (UTF-8 o Windows-1252) — para CSV/TSV
- El separador (coma `,`, punto y coma `;` o tabulación `\t`) — para CSV/TSV
- Qué columna contiene los emails, y qué fila es el header

Para archivos **XLSX**: se lee la primera hoja. Las fórmulas muestran el valor cacheado. Los formatos de fecha aparecen como número serial de Excel (se pueden reformatear en el editor de CSV).

### Paso B — Selección de campos

Seleccioná qué columnas del archivo original querés conservar en el archivo de salida.

### Paso C — Análisis del CSV

Diagnóstico previo: cuántas filas tienen problemas de email, duplicados, palabras clave, campos vacíos, valores homologables, columnas de etiquetas detectadas, etc. Define qué módulos te conviene activar.

### Paso D — Selección de flujo

Activá o desactivá cada módulo de procesamiento. Podés saltearte cualquier etapa que no aplique a tu archivo.

### Reglas

Definí reglas de corrección de dominios personalizadas:

| Tipo | Qué matchea | Ejemplo |
|------|-------------|---------|
| **Label** | La primera parte del dominio en cualquier extensión | `gmial` corrige `gmial.com`, `gmial.com.ar`, etc. |
| **Dominio completo** | Un dominio exacto | `gmail.co` corrige solo `gmail.co` |
| **Sufijos** | Componentes de TLD (ej: `.cim` → `.com`) | Cubre `.cim`, `.cim.ar`, etc. independientemente del resto del dominio |
| **Dominios válidos** | Marca un dominio como válido (no se corrige) | Dominios empresariales propios |

La whitelist incluye por defecto dominios LATAM válidos: `hotmail.com.ar`, `yahoo.com.ar`, `outlook.com.ar`, etc.

### Validación

Corrige automáticamente problemas comunes en los emails:
- Mayúsculas → minúsculas
- Acentos y tildes en usuario o dominio
- Espacios al inicio, al final o dentro del email
- Caracteres inválidos según el estándar RFC 2822

Podés revisar cada corrección y aceptarla o rechazarla individualmente. Si no hay problemas de formato, este paso se saltea automáticamente.

### Dominios

Detecta dominios con errores tipográficos y propone correcciones. Usa un motor de 3 pasos:
1. Normalización básica
2. Comparación con lista de dominios conocidos
3. Reglas aprendidas de sesiones anteriores (marcadas con 🧠)

### Duplicados

Detecta filas duplicadas usando los campos que elijas como clave (por defecto, solo el email). Para cada grupo de duplicados podés elegir quedarte con:
- El primero en aparecer
- El último
- El más completo (más campos con datos)
- Cualquier combinación manual

### Palabras clave

Elimina filas de prueba o ficticias detectando palabras clave: como **palabra completa** en el usuario o el dominio del email, y como **único contenido** del nombre, apellido o empresa (ej: el campo "Test Company" no se marca, pero "Test" solo sí). Patrones por defecto: `test`, `prueba`, `example`, `error`, `nadie`, `nobody`, `noreplay`, `no-replay`, `aaaa`, `1234`, entre otros — personalizables desde la misma pantalla.

### Nombres y apellidos con IA

Usa IA para completar nombres y apellidos faltantes analizando el usuario del email (la parte antes del `@`).

Ejemplo: email `jperez@empresa.com` + nombre `Juan` ya cargado → completa apellido como `Perez`.

### Empresa

Normaliza el campo de empresa: detecta valores vacíos, limpia entradas "basura" (`no tengo`, `particular`, símbolos sueltos, etc.) y aplica reglas de homologación (`SRL` → `SRL`, `.com` → eliminado, etc.).

### País y teléfono

Detecta el país del contacto a partir del dominio del email o el campo de país, y formatea los números al estándar internacional (ej: `+54 9 11 1234-5678`).

### Homologación de campos

Normaliza los valores de cualquier campo (cargo, industria, tipo de cliente, etc.) agrupando variantes del mismo concepto en un único valor canónico, usando una librería reutilizable de valor → canónico.

Ejemplo: `CEO`, `Director Ejecutivo`, `Director General` → `Director`

Flujo en 2 pasos: **Aplicar variantes** (match exacto/avanzado contra la librería, sin costo) y **IA** (homologa lo que no matcheó). Podés generar la librería automáticamente con IA a partir de los valores únicos del campo, o armarla a mano. Las filas sin valor real (campo vacío) no se envían a la IA.

### Etiquetar por valor en campo

Asigna una etiqueta (tag) a cada fila según el valor de un campo fuente, usando una librería de valor → tag reutilizable entre sesiones. Igual que homologación: **Match** contra la librería + **IA** para lo que no matcheó. Soporta un **tag global** que se agrega a todas las filas además del tag específico.

> Todos los pasos de IA (Nombres, Homologación, Etiquetas) son opcionales — si no los necesitás, desactivalos en la Selección de flujo. Ver sección [Configuración de IA](#configuración-de-ia) más abajo.

### Resumen final

Al completar el wizard se muestra:
- Score de calidad del archivo procesado
- Tabla con el resultado de cada módulo (incluidos los omitidos)
- Preview del CSV final
- Botones de exportación

---

## Editor de archivos

Botón **EDITOR** en el header — abre un editor tipo planilla en una ventana separada, sincronizado en vivo con el wizard principal (vía `BroadcastChannel`, sin servidor intermedio). Permite:

- Editar celdas directamente
- Dividir, eliminar, agregar, reordenar y renombrar columnas
- Formatear: mayúsculas/minúsculas, recorte de espacios, búsqueda y reemplazo, agregar texto, presets de número/moneda/porcentaje/fecha
- Deshacer / rehacer (hasta 30 pasos)

Los cambios se reflejan en el wizard principal sin necesidad de volver a importar el archivo.

---

## Idioma y tema

- **Idioma**: botón `EN`/`ES` en el header. Cambiar de idioma recarga la página (se pierde el progreso del wizard en curso) — es la forma más confiable de reaplicar todas las traducciones.
- **Tema**: botón de sol/luna en el header, oscuro por defecto. No recarga la página.

Ambas preferencias se guardan en `localStorage` y persisten entre sesiones.

---

## Exportaciones

Al terminar podés descargar dos archivos:

| Archivo | Contenido |
|---------|-----------|
| **CSV corregido** | Solo las filas válidas con todos los cambios aplicados |
| **Log completo** | Todas las filas originales + columnas `Accion`, `Email_Original`, `Email_Final` |

---

## Sistema de aprendizaje

La app guarda tus decisiones y las aplica automáticamente en la próxima sesión:

| Qué aprende | Cómo lo usa |
|-------------|-------------|
| Columnas usadas para detectar duplicados | Las preselecciona si el CSV tiene el mismo esquema |
| Correcciones de validación rechazadas | Si rechazás más del 70% de un tipo, lo desactiva automáticamente |
| Dominios aceptados | Si aceptás un patrón 3+ veces con ratio >80%, lo aplica solo (🧠) |
| Configuración de pasos por archivo | Si el nombre del CSV coincide con uno anterior, restaura flujo y columnas |
| Fila usada como header | Recuerda la fila de inicio por nombre de archivo |

Botón **LEARN** en el header: exportá un backup del aprendizaje, importá uno guardado, o reseteá todo (irreversible).

Los datos de aprendizaje se guardan localmente en `data/learning.json`. No se comparten ni se suben a ningún servidor — el repositorio solo incluye un esqueleto vacío de este archivo.

---

## Configuración de IA

Los módulos de Nombres, Homologación de campos y Etiquetas usan IA para procesar datos. DataB Flow es compatible con **cualquier LLM** que exponga una API compatible con OpenAI, ya sea local o en la nube.

La configuración se guarda en `data/ai-config.json` y se gestiona desde el botón **LLM** del header:

- `url` — endpoint del servidor LLM (ej: `http://localhost:11434/v1/chat/completions`)
- `model` — nombre del modelo a usar
- `apiKey` — clave de API (para proveedores en la nube) o cualquier texto para uso local
- `providers` — lista de configuraciones disponibles para elegir desde la interfaz

### Opciones de configuración

**LLM local (sin internet, sin costo):**
La forma más sencilla de usar IA de forma local es con **Ollama** — una herramienta gratuita que corre modelos de lenguaje en tu propia computadora.
- Instalación: **https://ollama.com**
- El archivo `ai-config.json` incluido ya está preconfigurado para usarlo con Ollama y el modelo `llama3.1`

**API de cualquier proveedor:**
También podés conectar DataB Flow a cualquier proveedor de IA en la nube (OpenAI, Anthropic, Mistral, Groq, etc.) actualizando `url`, `model` y `apiKey` desde el modal de gestión de proveedores, o editando `data/ai-config.json` directamente.

---

## Estructura del proyecto

```
datab-flow/
├── server.js                       Servidor HTTP puro (sin Express) — 24 endpoints REST
├── start.sh                        Script de inicio Mac/Linux
├── start.bat                       Script de inicio Windows
├── LICENSE.md                      GNU AGPLv3
├── tools/
│   ├── make-mac-app.sh             Crea "DataB Flow.app" en el Desktop (Mac)
│   └── make-win-shortcut.bat       Crea acceso directo en el Desktop (Windows)
├── data/
│   ├── domain-rules-default.json   Reglas de corrección de dominio incorporadas
│   ├── domain-rules-custom.json    Reglas de dominio del usuario (se genera con el uso)
│   ├── domain-valid-default.json   Whitelist de dominios válidos incorporada
│   ├── domain-valid-custom.json    Dominios válidos del usuario (se genera con el uso)
│   ├── suffix-rules-default.json   Reglas de corrección de TLD/sufijos incorporadas
│   ├── suffix-rules-custom.json    Reglas de sufijos del usuario (se genera con el uso)
│   ├── keywords.json               Patrones de detección de filas de prueba
│   ├── enterprise-clean.json       Empresas junk y exclusiones
│   ├── enterprise-homologate.json  Reglas de homologación de empresa
│   ├── field-homologated.json      Librerías de homologación de campos (esqueleto vacío en el repo)
│   ├── field-tags.json             Librerías de etiquetas (esqueleto vacío en el repo)
│   ├── prep-formats.json           Presets de formato del editor de CSV
│   ├── country.json                Datos de países e indicativos telefónicos
│   ├── ai-config.json              Configuración de proveedores LLM
│   ├── ai-prompts-default.json     Prompts por defecto de cada módulo de IA
│   ├── learning.json               Datos de aprendizaje (esqueleto vacío en el repo)
│   └── flow-config.json            Configuración de flujo guardada por archivo (se genera con el uso)
└── public/
    ├── index.html
    ├── editor.html                 Editor de CSV standalone
    ├── css/styles.css
    └── js/
        ├── main.js                 Orquestador del wizard
        ├── editor-standalone.js    Bootstrap del editor en ventana separada
        ├── modules/
        │   ├── config.js           Dominios, whitelist, TRANSLIT_MAP, FLOW_STEPS
        │   ├── state.js            Estado global reactivo
        │   ├── parser.js           Parser CSV/TSV RFC 4180
        │   ├── validator.js        Validación y auto-corrección de emails
        │   ├── domains.js          Motor de corrección de dominios
        │   ├── duplicates.js       Detección de duplicados
        │   ├── keywords.js         Matching de palabras clave (compartido análisis/paso real)
        │   ├── learning.js         Motor de aprendizaje adaptativo
        │   ├── country.js          Detección de país y formateo de teléfonos
        │   ├── tags.js             Motor de matching de etiquetas por valor
        │   ├── prep.js              Operaciones de columnas del editor de CSV
        │   ├── ai.js               Cliente LLM (proxy hacia backend)
        │   ├── llm-config.js       Modal de gestión de proveedores LLM
        │   ├── broadcast.js        Sincronización en vivo con el editor (BroadcastChannel)
        │   ├── i18n.js             Diccionario ES/EN
        │   └── utils.js            Helpers DOM y utilidades
        ├── ui/
        │   ├── steps.js            Render de todos los pasos del wizard
        │   └── csv-editor.js       UI del editor de CSV standalone
        └── workers/
            └── csv-worker.js       Web Worker — análisis y validación pesada fuera del hilo principal
```

---

## Arquitectura

### ¿Qué es?

Una herramienta de limpieza y transformación de listas de contactos de email en CSV, TSV o XLSX. Corre localmente en el navegador (`localhost:3000`), con backend Node.js y frontend en JavaScript vanilla. Sin dependencias npm. 100% offline (salvo que conectes un proveedor de IA en la nube).

### Tech Stack

| Capa | Tecnología |
|------|-----------|
| **Backend** | Node.js puro (sin Express), CommonJS, 0 dependencias externas, 24 endpoints REST |
| **Frontend** | JavaScript ES6 modules + Vanilla JS, CSS3 con variables para temas claro/oscuro |
| **XLSX** | Parser ZIP + XML nativo (`DecompressionStream` + `DOMParser`) — sin librerías externas |
| **Concurrencia** | Web Worker para análisis y validación pesada (no bloquea la UI) |
| **Multi-ventana** | BroadcastChannel API — sincroniza el editor de CSV standalone con el wizard principal |
| **Storage** | Archivos JSON en `data/` (sin base de datos), localStorage para preferencias de UI |
| **AI Opcional** | Ollama (local) o cualquier API compatible con OpenAI (Anthropic, Groq, Mistral) |

### Flujo de datos

```
CSV → Import → Selección de campos → Análisis → Selección de flujo
    → Reglas → Validación → Dominios → Duplicados → Palabras clave
    → Nombres (IA) → Empresa → País + teléfono
    → Homologación de campos (IA) → Etiquetas (IA)
    → Resumen → Export CSV limpio + log
```

Cada módulo del flujo (excepto Import/Selección de campos/Análisis/Selección de flujo) puede activarse o desactivarse independientemente.

### Estructura principal

| Archivo | Rol |
|---------|-----|
| `server.js` | Servidor HTTP + 24 endpoints API + proxy LLM |
| `public/js/main.js` | Orquestador del wizard |
| `public/js/ui/steps.js` | UI de cada paso |
| `public/js/ui/csv-editor.js` | UI del editor de CSV standalone |
| `modules/state.js` | Estado global observable |
| `modules/parser.js` | Parser CSV RFC 4180 (auto-detecta encoding/separador) |
| `modules/validator.js` | Validación y autocorrección de emails |
| `modules/domains.js` | Motor de corrección de dominios (whitelist + reglas + aprendizaje) |
| `modules/keywords.js` | Matching de palabras clave, compartido entre el análisis previo y el paso real |
| `modules/learning.js` | Motor adaptativo — aprende de decisiones del usuario |
| `modules/broadcast.js` | Protocolo de sincronización en vivo con el editor standalone |
| `modules/ai.js` / `modules/llm-config.js` | Cliente LLM y gestión de proveedores |
| `workers/csv-worker.js` | Análisis y validación pesada en hilo separado |
| `data/*.json` | Configs persistentes (reglas, whitelist, librerías, aprendizaje, etc.) |

### Decisiones de arquitectura clave

- **Zero deps** — sin `npm install`, fácil de deployar en cualquier entorno con Node.js
- **Whitelist-first** — protege dominios regionales válidos (`hotmail.com.ar` ≠ `gmail.com.ar`)
- **Aprendizaje adaptativo** — recuerda decisiones del usuario entre sesiones (por schema hash)
- **Proxy LLM server-side** — evita CORS; strip de bloques `<think>` de modelos reasoning
- **Transliteración** — mapa pre-computado `á→a`, `ñ→n`, `ç→c` para emails latinoamericanos
- **Estado observable** — patrón `subscribe/setState` vanilla (sin Redux/MobX)
- **Lógica compartida** — el conteo de issues en "Análisis del CSV" usa exactamente la misma lógica que el paso real, para que el diagnóstico nunca contradiga el resultado

---

## Licencia

GNU Affero General Public License v3.0 — ver [LICENSE.md](LICENSE.md).

---

*DataB Flow · Cleaning | Transformation | Governance · © 2026 mdmarein · GNU AGPLv3*
