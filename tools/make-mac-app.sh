#!/bin/bash
# ─────────────────────────────────────────────────────────────
#  DataB Flow — Crea "DataB Flow.app" en el Desktop (macOS)
#  Uso: bash tools/make-mac-app.sh
# ─────────────────────────────────────────────────────────────

set -e

# Directorio raíz del proyecto (donde está este script)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
APP_NAME="DataB Flow"
DEST="$HOME/Desktop/${APP_NAME}.app"
ICNS="$SCRIPT_DIR/icons/AppIcon.icns"

echo "📦 Creando ${APP_NAME}.app..."

# Eliminar versión previa si existe
rm -rf "$DEST"

# Estructura del bundle
mkdir -p "$DEST/Contents/MacOS"
mkdir -p "$DEST/Contents/Resources"

# ── Info.plist ────────────────────────────────────────────────
cat > "$DEST/Contents/Info.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>      <string>datab-flow</string>
  <key>CFBundleIconFile</key>        <string>AppIcon</string>
  <key>CFBundleIdentifier</key>      <string>ai.multiplai.datab-flow</string>
  <key>CFBundleName</key>            <string>DataB Flow</string>
  <key>CFBundleDisplayName</key>     <string>DataB Flow</string>
  <key>CFBundleVersion</key>         <string>1.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundlePackageType</key>     <string>APPL</string>
  <key>CFBundleSignature</key>       <string>????</string>
  <key>LSUIElement</key>             <false/>
  <key>NSHighResolutionCapable</key> <true/>
</dict>
</plist>
PLIST

# ── Launcher script ───────────────────────────────────────────
# El PROJECT_DIR se incrusta en el momento de la creación del .app
cat > "$DEST/Contents/MacOS/datab-flow" << LAUNCHER
#!/bin/bash
PROJECT_DIR="${PROJECT_DIR}"
PORT=3000
URL="http://localhost:\$PORT"

# Buscar node en ubicaciones comunes si no está en PATH
for candidate in \$(which node 2>/dev/null) /usr/local/bin/node /opt/homebrew/bin/node; do
  if [ -x "\$candidate" ]; then NODE="\$candidate"; break; fi
done

if [ -z "\$NODE" ]; then
  osascript -e 'display alert "DataB Flow" message "No se encontró Node.js. Instalalo desde nodejs.org" as critical'
  exit 1
fi

# Detectar si ya había servidor corriendo y matarlo para reiniciar limpio
ALREADY_RUNNING=false
if lsof -i :\$PORT -t &>/dev/null 2>&1; then
  ALREADY_RUNNING=true
  lsof -i :\$PORT -t | xargs kill -9 2>/dev/null || true
  sleep 0.5
fi

# Arrancar el servidor en background
cd "\$PROJECT_DIR"
nohup "\$NODE" server.js >> "\$PROJECT_DIR/server.log" 2>&1 &

# Esperar a que el servidor esté listo (max 8 segundos)
for i in {1..16}; do
  sleep 0.5
  if lsof -i :\$PORT -t &>/dev/null 2>&1; then
    # Solo abrir browser si no había servidor antes (evita segunda pestaña)
    [ "\$ALREADY_RUNNING" = false ] && open "\$URL"
    exit 0
  fi
done

# Si no levantó, mostrar error
osascript -e 'display alert "DataB Flow" message "El servidor no arrancó. Revisá server.log en el directorio del proyecto." as critical'
exit 1
LAUNCHER

chmod +x "$DEST/Contents/MacOS/datab-flow"

# ── Ícono ─────────────────────────────────────────────────────
if [ -f "$ICNS" ]; then
  cp "$ICNS" "$DEST/Contents/Resources/AppIcon.icns"
else
  echo "⚠️  No se encontró AppIcon.icns en tools/icons/"
fi

# ── Firma ad-hoc (evita bloqueo de Gatekeeper) ───────────────
codesign --force --deep --sign - "$DEST" 2>/dev/null && \
  echo "✓ Firmado ad-hoc" || echo "⚠️  codesign no disponible (opcional)"

# ── Refrescar Dock / Finder ───────────────────────────────────
touch "$DEST"

echo ""
echo "✅ Creado: $DEST"
echo ""
echo "Primera ejecución: clic derecho → Abrir (macOS pedirá confirmación una sola vez)"
echo "Siguiente vez:     doble clic normal"
