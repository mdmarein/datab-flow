/**
 * broadcast.js — Sincronización en tiempo real entre ventanas via BroadcastChannel
 * dataB Flow · © 2026 mdmarein · GNU AGPLv3
 *
 * Protocolo de mensajes:
 *   REQUEST_STATE  → editor window pide el estado inicial
 *   STATE_RESPONSE → main window responde con csv + prepFormats
 *   CSV_UPDATE     → cualquier ventana notifica un cambio en csv
 *   APPLY_OP       → editor window delega una operación a main window
 *   OVERLAY_UPDATE → main window envía correcciones del flow al editor standalone
 */

const CHANNEL_NAME = 'databflow-csv';
let _channel = null;
let _onOpCallback      = null;
let _onCsvCallback     = null;
let _onReadyCallback   = null;
let _onOverlayCallback = null;

function _getChannel() {
  if (!_channel) {
    _channel = new BroadcastChannel(CHANNEL_NAME);
    _channel.onmessage = _handleMessage;
  }
  return _channel;
}

function _handleMessage(e) {
  const { type } = e.data || {};
  if (type === 'REQUEST_STATE' && _onReadyCallback) {
    _onReadyCallback();
  }
  if (type === 'CSV_UPDATE' && _onCsvCallback) {
    _onCsvCallback(e.data.csv, e.data.displayCols || null);
  }
  if (type === 'APPLY_OP' && _onOpCallback) {
    _onOpCallback(e.data.op);
  }
  if (type === 'OVERLAY_UPDATE' && _onOverlayCallback) {
    _onOverlayCallback(e.data.overlay);
  }
}

// ── Main window API ──────────────────────────────────────────

/** Notifica a la ventana del editor que el CSV cambió. */
export function broadcastCsvUpdate(csv, displayCols = null) {
  _getChannel().postMessage({ type: 'CSV_UPDATE', csv, displayCols });
}

/** Responde a una solicitud de estado inicial desde la ventana del editor. */
export function sendStateResponse(csv, prepFormats, filename, displayCols = null) {
  _getChannel().postMessage({ type: 'STATE_RESPONSE', csv, prepFormats, filename, displayCols });
}

/**
 * Registra callback para cuando el editor pide el estado inicial.
 * La main window debe llamar a sendStateResponse() en este callback.
 */
export function onEditorReady(cb) {
  _onReadyCallback = cb;
  _getChannel(); // asegura que el channel esté escuchando
}

/** Registra callback para cuando el editor envía una operación a aplicar. */
export function onEditorOp(cb) {
  _onOpCallback = cb;
  _getChannel();
}

// ── Editor window API ────────────────────────────────────────

/** Pide el estado inicial a la main window. */
export function requestState() {
  _getChannel().postMessage({ type: 'REQUEST_STATE' });
}

/** Envía una operación a la main window para que la aplique. */
export function sendOp(op) {
  _getChannel().postMessage({ type: 'APPLY_OP', op });
}

/** Registra callback para recibir actualizaciones de csv desde la main window. */
export function onCsvUpdate(cb) {
  _onCsvCallback = cb;
  _getChannel();
}

/** Registra callback para recibir la respuesta de estado inicial. */
export function onStateResponse(cb) {
  const ch = _getChannel();
  const prev = ch.onmessage;
  ch.onmessage = (e) => {
    if (prev) prev(e);
    if (e.data?.type === 'STATE_RESPONSE') cb(e.data.csv, e.data.prepFormats, e.data.filename, e.data.displayCols || null);
  };
}

/** Emite cambio de tema a todas las ventanas. */
export function broadcastTheme(light) {
  _getChannel().postMessage({ type: 'THEME_CHANGE', light });
}

/** Registra callback para recibir cambios de tema. */
export function onThemeChange(cb) {
  const ch = _getChannel();
  const prev = ch.onmessage;
  ch.onmessage = (e) => {
    if (prev) prev(e);
    if (e.data?.type === 'THEME_CHANGE') cb(e.data.light);
  };
}

/** Emite cambio de idioma a todas las ventanas. */
export function broadcastLang(lang) {
  _getChannel().postMessage({ type: 'LANG_CHANGE', lang });
}

/** Registra callback para recibir cambios de idioma. */
export function onLangChange(cb) {
  const ch = _getChannel();
  const prev = ch.onmessage;
  ch.onmessage = (e) => {
    if (prev) prev(e);
    if (e.data?.type === 'LANG_CHANGE') cb(e.data.lang);
  };
}

/** Envía overlay de correcciones del flow al editor standalone. */
export function broadcastOverlayUpdate(overlay) {
  _getChannel().postMessage({ type: 'OVERLAY_UPDATE', overlay });
}

/** Registra callback para recibir overlay del flow (usado por editor standalone). */
export function onOverlayUpdate(cb) {
  _onOverlayCallback = cb;
  _getChannel();
}

/** Cierra el canal (llamar al cerrar la ventana del editor). */
export function closeChannel() {
  if (_channel) { _channel.close(); _channel = null; }
}
