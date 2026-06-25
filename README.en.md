<div align="center">
  <img src="public/img/datab-flow-banner.png" alt="DataB Flow" width="100%">
</div>

# DataB Flow

**Cleaning | Transformation | Governance**

![version](https://img.shields.io/badge/version-2.0.0-blue) ![license](https://img.shields.io/badge/license-AGPL--3.0-green) ![node](https://img.shields.io/badge/node-%3E%3D14-brightgreen)

**Versión en español:** [README.md](README.md)

A free, local tool for cleaning and processing contact lists in CSV or TSV format. No libraries to install, no services to pay for — everything runs on your computer.

---

## What it does

Take a CSV or TSV file with emails (and optionally first name, last name, company, phone, country, job title, tags, etc.) and run it through a multi-step wizard:

- Fixes common email domain typos, for example:

  | Original email | Fixed email | Provider |
  |----------------|-----------------|-----------|
  | `usuario@gmial.com` | `usuario@gmail.com` | Gmail |
  | `usuario@homail.com` | `usuario@hotmail.com` | Hotmail |
  | `usuario@yaho.com` | `usuario@yahoo.com` | Yahoo |
  | `usuario@outlok.com` | `usuario@outlook.com` | Outlook |
  | `usuario@icluod.com` | `usuario@icloud.com` | iCloud |

- Removes duplicates with configurable strategies
- Detects and removes test/fake rows
- Normalizes company, country, phone and custom fields
- Homologates any text field (job title, industry, etc.) by grouping variants with AI
- Tags rows by a field's value, with a reusable library and AI suggestions
- Completes first/last names using AI (local or via API)
- Spreadsheet-style CSV editor, in a separate window, live-synced with the wizard
- Exports the cleaned CSV and a full change log
- Bilingual interface (**Spanish / English**) with **dark and light theme**

Learns from your decisions and applies them automatically in future sessions.

---

## Before you start: install Node.js

datab-flow needs **Node.js v14 or higher**. If you already have it installed, skip this step.

### Mac

1. Open your browser and go to **https://nodejs.org**
2. Click the green **"LTS"** button (recommended version)
3. A `.pkg` file downloads — double-click it and follow the installer
4. To verify, open the **Terminal** app (`⌘ + Space`, type "Terminal") and run:
   ```bash
   node --version
   ```
   You should see something like `v22.0.0` or higher.

### Windows

1. Open your browser and go to **https://nodejs.org**
2. Click the green **"LTS"** button (recommended version)
3. A `.msi` file downloads — double-click it and follow the installer (keep all default options)
4. To verify, open **Command Prompt** (search "cmd" in the Start menu) and run:
   ```
   node --version
   ```
   You should see something like `v22.0.0` or higher.

### Linux (Ubuntu / Debian)

Open a terminal and run:

```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs
```

For other distros (Fedora, Arch, etc.), follow the instructions at **https://nodejs.org/en/download/package-manager**

---

## Downloading datab-flow

### Option A — ZIP (easiest, no extra installs)

1. Go to the project's GitHub page
2. Click the green **"Code"** button
3. Select **"Download ZIP"**
4. Unzip the file into the folder of your choice (e.g. `Documents/datab-flow`)

### Option B — git clone

```bash
git clone https://github.com/mdmarein/datab-flow.git
cd datab-flow
```

---

## Running the application

There are two ways to start DataB Flow: from the terminal, or as a desktop app with an icon.

---

### Option 1 — From the terminal

#### Mac / Linux

Open a terminal in the project folder and run:

```bash
node server.js
```

#### Windows

Open Command Prompt in the project folder and run:

```
node server.js
```

---

### Option 2 — Install as an app with an icon (recommended)

You can create a desktop shortcut with an icon to open DataB Flow with a double-click, without using the terminal.

#### Mac — Create "DataB Flow.app"

1. Open a terminal in the project folder
2. Run:
   ```bash
   bash tools/make-mac-app.sh
   ```
3. **"DataB Flow.app"** is created on your Desktop
4. **First time:** right-click the icon → **Open** (macOS asks for confirmation once)
5. **After that:** just double-click

> The app starts the server automatically and opens your browser at `http://localhost:3000`.  
> If the server is already running, it just opens the browser.

#### Windows — Create a shortcut

1. Open the project folder in File Explorer
2. Go into the `tools` folder
3. Double-click **`make-win-shortcut.bat`**
4. **"DataB Flow"** is created on your Desktop
5. Double-click the icon to start the app

> If you get a permissions error, right-click → **Run as administrator**.

---

### Opening the app in your browser

If you used the terminal option, with the server running open your browser and go to:

```
http://localhost:3000
```

If you used the installed icon, the browser opens automatically.

To stop the server from the terminal: press `Ctrl + C`.

**Change port (optional):**
```bash
PORT=8080 node server.js          # Mac / Linux
set PORT=8080 && node server.js   # Windows
```

---

## Usage guide

The app works as a wizard. After importing the file and choosing the fields, the **C — CSV analysis** screen shows you which modules found something to fix, and in **D — Flow selection** you turn each one on or off depending on what your file needs (modules with no issues are suggested as skipped by default, but you can change that).

### Step A — Import

Drag your CSV or TSV file onto the screen (or click to browse). The app automatically detects:
- The file's encoding (UTF-8 or Windows-1252)
- The separator (comma `,`, semicolon `;` or tab `\t`)
- Which column contains the emails, and which row is the header

### Step B — Field selection

Choose which columns from the original file to keep in the output file.

### Step C — CSV analysis

A preview diagnostic: how many rows have email issues, duplicates, keyword matches, empty fields, homologable values, detected tag columns, etc. Helps you decide which modules to enable.

### Step D — Flow selection

Turn each processing module on or off. You can skip any stage that doesn't apply to your file.

### Rules

Define custom domain correction rules:

| Type | What it matches | Example |
|------|-------------|---------|
| **Label** | The first part of the domain, in any extension | `gmial` fixes `gmial.com`, `gmial.com.ar`, etc. |
| **Full domain** | An exact domain | `gmail.co` fixes only `gmail.co` |
| **Suffixes** | TLD components (e.g. `.cim` → `.com`) | Covers `.cim`, `.cim.ar`, etc. regardless of the rest of the domain |
| **Valid domains** | Marks a domain as valid (never corrected) | Your own corporate domains |

The whitelist includes valid LATAM domains by default: `hotmail.com.ar`, `yahoo.com.ar`, `outlook.com.ar`, etc.

### Validation

Automatically fixes common email problems:
- Uppercase → lowercase
- Accents in the user or domain part
- Leading, trailing or internal spaces
- Invalid characters per the RFC 2822 standard

You can review and accept or reject each fix individually. If there are no format issues, this step is skipped automatically.

### Domains

Detects typo'd domains and suggests fixes, using a 3-step engine:
1. Basic normalization
2. Comparison against a list of known domains
3. Rules learned from previous sessions (marked with 🧠)

### Duplicates

Detects duplicate rows using the fields you choose as the key (by default, just the email). For each duplicate group you can choose to keep:
- The first one to appear
- The last one
- The most complete one (most fields filled in)
- Any manual combination

### Keywords

Removes test or fake rows by detecting keywords: as a **whole word** in the email's user or domain part, and as the **entire content** of the name, surname or company field (e.g. "Test Company" is not flagged, but "Test" alone is). Default patterns: `test`, `prueba`, `example`, `error`, `nadie`, `nobody`, `noreplay`, `no-replay`, `aaaa`, `1234`, among others — customizable from the same screen.

### Names with AI

Uses AI to complete missing first/last names by analyzing the email's user part (before the `@`).

Example: email `jperez@empresa.com` + first name `Juan` already filled in → completes last name as `Perez`.

### Company

Normalizes the company field: detects empty values, cleans up "junk" entries (`no tengo`, `particular`, stray symbols, etc.) and applies homologation rules (`SRL` → `SRL`, `.com` → removed, etc.).

### Country and phone

Detects the contact's country from the email domain or the country field, and formats phone numbers to the international standard (e.g. `+54 9 11 1234-5678`).

### Field homologation

Normalizes the values of any field (job title, industry, customer type, etc.) by grouping variants of the same concept into a single canonical value, using a reusable value → canonical library.

Example: `CEO`, `Director Ejecutivo`, `Director General` → `Director`

Two-step flow: **Apply variants** (exact/advanced matching against the library, free) and **AI** (homologates whatever didn't match). You can generate the library automatically with AI from the field's unique values, or build it by hand. Rows with no real value (empty field) are never sent to the AI.

### Tag by field value

Assigns a tag to each row based on a source field's value, using a reusable value → tag library shared across sessions. Same pattern as homologation: **Match** against the library + **AI** for whatever didn't match. Supports a **global tag** added to every row in addition to the specific tag.

> All AI steps (Names, Field homologation, Tags) are optional — disable them in Flow selection if you don't need them. See [AI configuration](#ai-configuration) below.

### Final summary

When the wizard finishes, you get:
- A quality score for the processed file
- A table with the result of every module (including skipped ones)
- A preview of the final CSV
- Export buttons

---

## CSV editor

**CSV** button in the header — opens a spreadsheet-style editor in a separate window, live-synced with the main wizard (via `BroadcastChannel`, no intermediate server). It lets you:

- Edit cells directly
- Split, delete, add, reorder and rename columns
- Format: uppercase/lowercase, trim spaces, find & replace, add text, number/currency/percent/date presets
- Undo / redo (up to 30 steps)

Changes show up in the main wizard without needing to re-import the file.

---

## Language and theme

- **Language**: `EN`/`ES` button in the header. Switching language reloads the page (in-progress wizard state is lost) — it's the most reliable way to re-apply every translation.
- **Theme**: sun/moon button in the header, dark by default. Doesn't reload the page.

Both preferences are saved in `localStorage` and persist across sessions.

---

## Exports

When you're done you can download two files:

| File | Content |
|---------|-----------|
| **Corrected CSV** | Only valid rows, with all fixes applied |
| **Full log** | Every original row + `Action`, `Original_Email`, `Final_Email` columns |

---

## Learning system

The app saves your decisions and applies them automatically in the next session:

| What it learns | How it's used |
|-------------|-------------|
| Columns used to detect duplicates | Preselects them if a CSV has the same schema |
| Rejected validation fixes | If you reject a type more than 70% of the time, it's disabled automatically |
| Accepted domains | If you accept a pattern 3+ times with an 80%+ ratio, it's applied automatically (🧠) |
| Per-file flow configuration | If the CSV filename matches a previous one, restores its flow and column setup |
| Header row used | Remembers the start row by filename |

**LEARN** button in the header: export a backup of your learning data, import a saved one, or reset everything (irreversible).

Learning data is stored locally in `data/learning.json`. It is never shared or uploaded anywhere — the repository only ships an empty skeleton of this file.

---

## AI configuration

The Names, Field homologation and Tags modules use AI to process data. DataB Flow works with **any LLM** that exposes an OpenAI-compatible API, local or cloud-based.

Configuration is stored in `data/ai-config.json` and managed from the **LLM** button in the header:

- `url` — the LLM server endpoint (e.g. `http://localhost:11434/v1/chat/completions`)
- `model` — the model name to use
- `apiKey` — API key (for cloud providers) or any placeholder text for local use
- `providers` — list of available configurations to pick from in the UI

### Setup options

**Local LLM (no internet, no cost):**
The simplest way to use AI locally is **Ollama** — a free tool that runs language models on your own computer.
- Install: **https://ollama.com**
- The included `ai-config.json` is already preconfigured for Ollama with the `llama3.1` model

**Any cloud provider's API:**
You can also connect DataB Flow to any cloud AI provider (OpenAI, Anthropic, Mistral, Groq, etc.) by updating `url`, `model` and `apiKey` from the provider management modal, or by editing `data/ai-config.json` directly.

---

## Project structure

```
datab-flow/
├── server.js                       Pure HTTP server (no Express) — 24 REST endpoints
├── start.sh                        Mac/Linux start script
├── start.bat                       Windows start script
├── LICENSE.md                      GNU AGPLv3
├── tools/
│   ├── make-mac-app.sh             Creates "DataB Flow.app" on the Desktop (Mac)
│   └── make-win-shortcut.bat       Creates a Desktop shortcut (Windows)
├── data/
│   ├── domain-rules-default.json   Built-in domain correction rules
│   ├── domain-rules-custom.json    User domain rules (generated on use)
│   ├── domain-valid-default.json   Built-in valid-domain whitelist
│   ├── domain-valid-custom.json    User valid domains (generated on use)
│   ├── suffix-rules-default.json   Built-in TLD/suffix correction rules
│   ├── suffix-rules-custom.json    User suffix rules (generated on use)
│   ├── keywords.json               Test-row detection patterns
│   ├── enterprise-clean.json       Junk companies and exclusions
│   ├── enterprise-homologate.json  Company homologation rules
│   ├── field-homologated.json      Field homologation libraries (empty skeleton in the repo)
│   ├── field-tags.json             Tag libraries (empty skeleton in the repo)
│   ├── prep-formats.json           CSV editor format presets
│   ├── country.json                Country data and phone prefixes
│   ├── ai-config.json              LLM provider configuration
│   ├── ai-prompts-default.json     Default prompts for each AI module
│   ├── learning.json               Learning data (empty skeleton in the repo)
│   └── flow-config.json            Per-file saved flow configuration (generated on use)
└── public/
    ├── index.html
    ├── editor.html                 Standalone CSV editor
    ├── css/styles.css
    └── js/
        ├── main.js                 Wizard orchestrator
        ├── editor-standalone.js    Bootstrap for the editor in its own window
        ├── modules/
        │   ├── config.js           Domains, whitelist, TRANSLIT_MAP, FLOW_STEPS
        │   ├── state.js            Reactive global state
        │   ├── parser.js           RFC 4180 CSV/TSV parser
        │   ├── validator.js        Email validation and auto-correction
        │   ├── domains.js          Domain correction engine
        │   ├── duplicates.js       Duplicate detection
        │   ├── keywords.js         Keyword matching (shared by analysis and the real step)
        │   ├── learning.js         Adaptive learning engine
        │   ├── country.js          Country detection and phone formatting
        │   ├── tags.js             Tag-by-value matching engine
        │   ├── prep.js              CSV editor column operations
        │   ├── ai.js               LLM client (proxy to backend)
        │   ├── llm-config.js       LLM provider management modal
        │   ├── broadcast.js        Live sync protocol with the standalone editor
        │   ├── i18n.js             ES/EN dictionary
        │   └── utils.js            DOM helpers and utilities
        ├── ui/
        │   ├── steps.js            Rendering for every wizard step
        │   └── csv-editor.js       Standalone CSV editor UI
        └── workers/
            └── csv-worker.js       Web Worker — heavy analysis/validation off the main thread
```

---

## Architecture

### What is it?

A cleaning and transformation tool for CSV contact/email lists. Runs locally in the browser (`localhost:3000`), with a Node.js backend and a vanilla JavaScript frontend. No npm dependencies. 100% offline (unless you connect a cloud AI provider).

### Tech stack

| Layer | Technology |
|------|-----------|
| **Backend** | Pure Node.js (no Express), CommonJS, 0 external dependencies, 24 REST endpoints |
| **Frontend** | JavaScript ES6 modules + vanilla JS, CSS3 variables for dark/light themes |
| **Concurrency** | Web Worker for heavy analysis/validation (keeps the UI responsive) |
| **Multi-window** | BroadcastChannel API — syncs the standalone CSV editor with the main wizard |
| **Storage** | JSON files in `data/` (no database), localStorage for UI preferences |
| **Optional AI** | Ollama (local) or any OpenAI-compatible API (Anthropic, Groq, Mistral) |

### Data flow

```
CSV → Import → Field selection → Analysis → Flow selection
    → Rules → Validation → Domains → Duplicates → Keywords
    → Names (AI) → Company → Country + phone
    → Field homologation (AI) → Tags (AI)
    → Summary → Export clean CSV + log
```

Every module in the flow (except Import/Field selection/Analysis/Flow selection) can be enabled or disabled independently.

### Main files

| File | Role |
|---------|-----|
| `server.js` | HTTP server + 24 API endpoints + LLM proxy |
| `public/js/main.js` | Wizard orchestrator |
| `public/js/ui/steps.js` | UI for every step |
| `public/js/ui/csv-editor.js` | Standalone CSV editor UI |
| `modules/state.js` | Observable global state |
| `modules/parser.js` | RFC 4180 CSV parser (auto-detects encoding/separator) |
| `modules/validator.js` | Email validation and auto-correction |
| `modules/domains.js` | Domain correction engine (whitelist + rules + learning) |
| `modules/keywords.js` | Keyword matching, shared between the preview analysis and the real step |
| `modules/learning.js` | Adaptive engine — learns from user decisions |
| `modules/broadcast.js` | Live sync protocol with the standalone editor |
| `modules/ai.js` / `modules/llm-config.js` | LLM client and provider management |
| `workers/csv-worker.js` | Heavy analysis/validation on a separate thread |
| `data/*.json` | Persistent configs (rules, whitelist, libraries, learning, etc.) |

### Key architecture decisions

- **Zero deps** — no `npm install`, easy to deploy on any Node.js environment
- **Whitelist-first** — protects valid regional domains (`hotmail.com.ar` ≠ `gmail.com.ar`)
- **Adaptive learning** — remembers user decisions across sessions (by schema hash)
- **Server-side LLM proxy** — avoids CORS; strips `<think>` blocks from reasoning models
- **Transliteration** — pre-computed `á→a`, `ñ→n`, `ç→c` map for Latin American emails
- **Observable state** — vanilla `subscribe/setState` pattern (no Redux/MobX)
- **Shared logic** — the issue count in "CSV analysis" uses the exact same logic as the real step, so the diagnostic never contradicts the result

---

## License

GNU Affero General Public License v3.0 — see [LICENSE.md](LICENSE.md).

---

*DataB Flow · Cleaning | Transformation | Governance · © 2026 mdmarein · GNU AGPLv3*
