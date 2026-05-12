/**
 * @file Core.gs
 * @version 6.0.21
 * @description Reparación de Mapeo de RAM (Key-Based Mapping).
 */

// --- 1. CONECTOR ---
function _obtenerBaseDatos() {
  const id = (typeof SECRETS !== 'undefined') ? (SECRETS.ADSHEET_ID || SECRETS.SPREADSHEET_ID) : null;
  return SpreadsheetApp.openById(id.toString().trim());
}

// --- 2. HIDRATACIÓN DE RAM (CORREGIDA) ---
function getDatabaseCompleta() {
  try {
    const ss = _obtenerBaseDatos();
    const db = {};

    // 🔄 Iteración por nombres de hoja físicos para match con Frontend v5.x
    for (const key in CONFIG.DB) {
      const nombreHoja = CONFIG.DB[key];
      const sheet = ss.getSheetByName(nombreHoja);

      // ✅ ASIGNACIÓN POR NOMBRE FÍSICO (Ej: db['LIBRO_COMPRAS'])
      // Esto asegura que window.SISTEMA_ERP.datos['LIBRO_COMPRAS'] exista.
      db[nombreHoja] = sheet ? sheet.getDataRange().getValues() : [];
    }

    return JSON.stringify(db);
  } catch (e) {
    return JSON.stringify({ error: true, message: "Falla RAM: " + e.message });
  }
}

// --- 3. HANDSHAKE Y TELEMETRÍA ---
function w_validarSesion(ip) {
  const email = Session.getActiveUser().getEmail();
  return JSON.stringify({
    authorized: true, email: email, nombres: email.split('@')[0].toUpperCase(),
    nombre_rol: "Administrador", matriz_permisos: JSON.stringify(['*']), status: 'AUTORIZADO'
  });
}

/**
 * @function w_getSystemTelemetry
 * @description Entrega el payload completo para el Footer y Sensores.
 */
function w_getSystemTelemetry() {
  try {
    // Verificamos que CONFIG exista para evitar errores de referencia
    if (typeof CONFIG === 'undefined') throw new Error("CONFIG no cargado");

    return JSON.stringify({
      success: true,
      version: CONFIG.VERSION,
      env: CONFIG.ENV,
      appName: CONFIG.APP_NAME,
      norma1: CONFIG.COMPLIANCE.NORMA_1,
      norma2: CONFIG.COMPLIANCE.NORMA_2,
      arch: CONFIG.ARCHITECTURE,
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

// --- 4. DESPLIEGUE HTTP ---
function doGet(e) {
  var template = HtmlService.createTemplateFromFile('Index');
  template.APP_VERSION = CONFIG.VERSION || "6.0.21";
  template.CONFIG_PAYLOAD = JSON.stringify(CONFIG);
  return template.evaluate().setTitle(CONFIG.APP_NAME).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  var template = HtmlService.createTemplateFromFile(filename);
  template.APP_VERSION = CONFIG.VERSION || "6.0.21";
  return template.evaluate().getContent();
}

// --- 5. MOTOR DE ESCRITURA ---
function w_EjecutarTransaccionSegura(idTabla, idReg, datos) {
  const ss = _obtenerBaseDatos();
  const sheet = ss.getSheetByName(CONFIG.DB[idTabla]);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row = headers.map(h => {
    const head = String(h).trim().toUpperCase();
    if (datos.hasOwnProperty(head)) return datos[head];
    if (head === "TIMESTAMP_CREATE" || head === "TIMESTAMP_UPDATE") return new Date().toISOString();
    if (head === "USER_UPDATER" || head === "USER_CREATOR") return Session.getActiveUser().getEmail();
    return "";
  });
  if (idReg === 'NUEVO') sheet.appendRow(row);
  return JSON.stringify({ success: true });
}

/**
 * @function w_registrarLogForense
 * @description Punto de entrada para cierres de sesión (Manual/Timeout).
 */
function w_registrarLogForense(tipoCierre, ip) {
  try {
    const email = Session.getActiveUser().getEmail() || "SISTEMA";
    const detalles = (tipoCierre === 'SESSION_TIMEOUT')
      ? "Cierre automático por inactividad"
      : "Cierre manual por el usuario";

    // Reutilizamos el motor de auditoría existente
    return registrarLogInterno(
      "LOGOUT",       // accion
      "SEGURIDAD",    // modulo
      "AUTH",         // id_ref
      "ACTIVO",       // valor anterior
      "CERRADO",      // valor nuevo
      detalles,       // detalles
      ip              // ip
    );
  } catch (e) {
    console.error("Fallo en registro de salida:", e.message);
    return JSON.stringify({ error: true, message: e.message });
  }
}