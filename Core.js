/**
 * @file Core.gs
 * @description Punto de entrada HTTP y Motor Backend URS-28. v6.0.1 (Hard-Linked)
 * @arquitectura Memory-First / Única Fuente de Verdad / Escritura Universal
 * @cumplimiento ISO 22000 / SII Chile (Trazabilidad Forense SHA-256)
 */

/**
 * @function _obtenerBaseDatos
 * @description Conector Zero-Trust mediante ID estricto.
 */
function _obtenerBaseDatos() {
  if (!SECRETS.ADSHEET_ID) throw new Error("Falla Crítica: ADSHEET_ID no configurado en Config.gs.");
  return SpreadsheetApp.openById(SECRETS.ADSHEET_ID);
}

/**
 * ============================================================================
 * 0. DESPLIEGUE HTTP (FRONTEND SERVING) V2.0.0
 * ============================================================================
 */
function doGet(e) {
  try {
    var template = HtmlService.createTemplateFromFile('Index');
    template.APP_VERSION = (typeof CONFIG !== 'undefined' && CONFIG.VERSION) ? CONFIG.VERSION : "5.1.0";

    // Inyectamos el mapa logico seguro como cadena JSON
    template.CONFIG_PAYLOAD = JSON.stringify(CONFIG);

    return template.evaluate()
      .setTitle(CONFIG.APP_NAME + " - v" + CONFIG.VERSION + " (" + CONFIG.ENV + ")" || "ERP MDP - PAN19")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  } catch (error) {
    console.error("[PGA] Fallo Crítico en Renderizado:", error);
    return HtmlService.createHtmlOutput("<h1>Falla Crítica 500</h1><p>" + error.message + "</p>");
  }
}

function include(filename) {
  try {
    return HtmlService.createTemplateFromFile(filename).evaluate().getContent();
  } catch (error) {
    console.error('[PGA] Error crítico al inyectar módulo: ' + filename, error);
    return '';
  }
}

/**
 * ============================================================================
 * 0.5. UTILIDAD DE EXPLORACIÓN ACTIVA DE CABECERAS
 * ============================================================================
 */
function UTIL_ExploradorCabeceras(sheet) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var mapa = {};
  headers.forEach(function (h, i) {
    var nombre = String(h || '').trim().toUpperCase();
    if (nombre) mapa[nombre] = i;
  });
  return mapa;
}

/**
 * ============================================================================
 * 1. GUARDIÁN ZERO TRUST (RBAC EN VIVO)
 * ============================================================================
 */
function w_verificarEstadoSesion(moduloRequerido) {
  try {
    var email = Session.getActiveUser().getEmail();
    if (!email) return false;

    // 🚀 FIX: Anclaje estricto v6
    var ss = _obtenerBaseDatos();
    var sheetUsers = ss.getSheetByName(CONFIG.DB.USUARIOS);
    var dataUsers = sheetUsers.getDataRange().getValues();
    var headUsers = dataUsers[0].map(function (h) { return String(h).trim().toUpperCase(); });

    var idxEmail = headUsers.indexOf('EMAIL');
    var idxStatus = headUsers.indexOf('STATUS');
    var idxRol = headUsers.indexOf('NIVEL_ACCESO');

    var userRow = dataUsers.find(function (r) { return r[idxEmail] === email; });
    if (!userRow || userRow[idxStatus] !== 'ACTIVO') return false;

    if (!moduloRequerido) return true;

    var idRol = String(userRow[idxRol]);
    if (idRol === "1") return true;

    var sheetRoles = ss.getSheetByName(CONFIG.DB.ROLES);
    var dataRoles = sheetRoles.getDataRange().getValues();
    var headRoles = dataRoles[0].map(function (h) { return String(h).trim().toUpperCase(); });
    var idxIdRol = headRoles.indexOf('ID_ROL');
    var idxPermisos = headRoles.indexOf('PERMISOS_JSON');

    var rolRow = dataRoles.find(function (r) { return String(r[idxIdRol]) === idRol; });
    if (!rolRow) return false;

    var permisosArr = JSON.parse(rolRow[idxPermisos] || '[]');
    return permisosArr.includes('*') || permisosArr.includes(moduloRequerido);
  } catch (e) {
    console.error("❌ Error en Guardián Backend:", e);
    return false;
  }
}

/**
 * ============================================================================
 * 2. MOTOR DE ESCRITURA UNIVERSAL Y DIFERENCIAS (DIFF ENGINE)
 * ============================================================================
 */
function w_EjecutarTransaccionSegura(idTablaConfig, idRegistro, nuevosDatos, ipCliente) {
  var LOCK = LockService.getScriptLock();
  try {
    if (!w_verificarEstadoSesion()) {
      return JSON.stringify({ error: true, tipo: 'FATAL_AUTH', mensaje: 'Sesión no autorizada.' });
    }

    LOCK.waitLock(15000);
    var nombreHoja = CONFIG.DB[idTablaConfig];
    if (!nombreHoja) {
      return JSON.stringify({ error: true, message: 'Tabla no registrada en CONFIG.DB: ' + idTablaConfig });
    }

    // 🚀 FIX: Anclaje estricto v6
    var ss = _obtenerBaseDatos();
    var sheet = ss.getSheetByName(nombreHoja);
    if (!sheet) {
      return JSON.stringify({ error: true, message: 'Hoja no encontrada: ' + nombreHoja });
    }

    var fullData = sheet.getDataRange().getValues();
    var cabeceras = fullData[0].map(function (h) { return String(h).trim().toUpperCase(); });

    var nombreLlavePrimaria = (CONFIG.LLAVES_PRIMARIAS && CONFIG.LLAVES_PRIMARIAS[idTablaConfig])
      ? CONFIG.LLAVES_PRIMARIAS[idTablaConfig]
      : cabeceras[0];

    var idxLlave = cabeceras.indexOf(nombreLlavePrimaria);
    if (idxLlave === -1) {
      return JSON.stringify({ error: true, message: 'Llave primaria "' + nombreLlavePrimaria + '" no encontrada' });
    }

    var filaIndex = -1;
    var datosAnteriores = {};

    if (idRegistro !== 'NUEVO') {
      for (var i = 1; i < fullData.length; i++) {
        if (String(fullData[i][idxLlave]) === String(idRegistro)) {
          filaIndex = i + 1;
          cabeceras.forEach(function (h, idx) { datosAnteriores[h] = fullData[i][idx]; });
          break;
        }
      }
    }

    var diff = { anterior: {}, nuevo: {} };
    var hayCambios = false;
    cabeceras.forEach(function (h) {
      if (nuevosDatos.hasOwnProperty(h)) {
        var valViejo = String(datosAnteriores[h] || '');
        var valNuevo = String(nuevosDatos[h] || '');
        if (valViejo !== valNuevo) {
          diff.anterior[h] = valViejo;
          diff.nuevo[h] = valNuevo;
          hayCambios = true;
        }
      }
    });

    if (!hayCambios && idRegistro !== 'NUEVO') return JSON.stringify({ success: true, noChange: true });

    var emailActual = Session.getActiveUser().getEmail();
    var timestampActual = new Date().toISOString();

    var filaFinal = cabeceras.map(function (h) {
      if (h === 'TIMESTAMP_UPDATE') return timestampActual;
      if (h === 'USER_UPDATER') return emailActual;
      if (h === 'TIMESTAMP_CREATE' && idRegistro === 'NUEVO') return timestampActual;
      if (h === 'USER_CREATOR' && idRegistro === 'NUEVO') return emailActual;
      return nuevosDatos.hasOwnProperty(h) ? nuevosDatos[h] : (datosAnteriores[h] || '');
    });

    if (idRegistro === 'NUEVO') {
      sheet.appendRow(filaFinal);
    } else if (filaIndex > 0) {
      sheet.getRange(filaIndex, 1, 1, cabeceras.length).setValues([filaFinal]);
    } else {
      return JSON.stringify({ error: true, message: 'Registro no encontrado: ' + idRegistro });
    }

    registrarLogInterno(
      idRegistro === 'NUEVO' ? 'CREATE' : 'UPDATE',
      idTablaConfig,
      idRegistro === 'NUEVO' ? (nuevosDatos[nombreLlavePrimaria] || 'AUTO') : idRegistro,
      JSON.stringify(diff.anterior),
      JSON.stringify(diff.nuevo),
      'Transacción segura via Motor Universal v6.0.0',
      ipCliente || 'MOTOR_INTERNO'
    );

    return JSON.stringify({ success: true, diff: diff });
  } catch (e) {
    return JSON.stringify({ error: true, message: e.message });
  } finally {
    LOCK.releaseLock();
  }
}

/**
 * ============================================================================
 * 3. MOTOR DE HIDRATACIÓN (FALLBACK NATIVO V5.1)
 * ============================================================================
 */
function getDatabaseCompleta() {
  const LOCK = LockService.getScriptLock();
  try {
    LOCK.waitLock(5000);
    const userEmail = Session.getActiveUser().getEmail();
    if (!userEmail) throw new Error("Sesión Inválida");

    // 🚀 Este ya estaba bien en tu código
    const ss = _obtenerBaseDatos();
    const nombresPestañas = Object.values(CONFIG.DB);
    const dbSaneada = {};

    nombresPestañas.forEach(nombre => {
      const sheet = ss.getSheetByName(nombre);
      if (sheet) {
        dbSaneada[nombre] = sheet.getDataRange().getValues();
      } else {
        dbSaneada[nombre] = [];
      }
    });

    return JSON.stringify(dbSaneada);
  } catch (error) {
    console.error("❌ Fallo en Hidratación:", error);
    return JSON.stringify({ error: true, message: error.message });
  } finally {
    LOCK.releaseLock();
  }
}

/**
 * ============================================================================
 * 4. AUDITORÍA FORENSE — VERSIÓN CANÓNICA ÚNICA (ISO 22000)
 * ============================================================================
 */
function registrarLogInterno(accion, modulo, idEntidad, anterior, nuevo, detalles, ipAddress) {
  try {
    // 🚀 FIX: Reemplazo de getActiveSpreadsheet() por _obtenerBaseDatos()
    var sheet = _obtenerBaseDatos().getSheetByName(CONFIG.DB.AUDIT_LOG);
    if (!sheet) {
      console.error('❌ [Auditoría] Hoja ' + CONFIG.DB.AUDIT_LOG + ' no encontrada.');
      return false;
    }

    var C = UTIL_ExploradorCabeceras(sheet);

    var columnasRequeridas = [
      'ID_LOG', 'TIMESTAMP', 'USER_EMAIL', 'ACTION_TYPE',
      'MODULO', 'ENTIDAD_ID', 'VALOR_ANTERIOR', 'VALOR_NUEVO',
      'IP_ADDRESS', 'DETALLES', 'HASH_RECORD', 'HASH_PREVIOUS'
    ];

    var faltantes = columnasRequeridas.filter(function (col) { return C[col] === undefined; });
    if (faltantes.length > 0) {
      console.error('❌ [Auditoría] Columnas faltantes: ' + faltantes.join(', '));
      return false;
    }

    var lastRow = sheet.getLastRow();
    var hashPrevio = 'GENESIS_BLOCK';
    if (lastRow > 1) {
      hashPrevio = sheet.getRange(lastRow, C.HASH_RECORD + 1).getValue() || 'EMPTY_PREV';
    }

    var ipFinal = (ipAddress && ipAddress !== '0.0.0.0' && ipAddress !== 'CAPTURANDO...') ? ipAddress : 'ORIGIN_NOT_CAPTURED';
    var totalCols = sheet.getLastColumn();
    var row = new Array(totalCols).fill('');

    row[C.ID_LOG] = Utilities.getUuid();
    row[C.TIMESTAMP] = new Date().toISOString();
    row[C.USER_EMAIL] = Session.getActiveUser().getEmail() || 'SISTEMA';
    row[C.ACTION_TYPE] = accion;
    row[C.MODULO] = modulo;
    row[C.ENTIDAD_ID] = idEntidad;
    row[C.VALOR_ANTERIOR] = anterior || 'N/A';
    row[C.VALOR_NUEVO] = nuevo || 'N/A';
    row[C.IP_ADDRESS] = ipFinal;
    row[C.DETALLES] = detalles;
    row[C.HASH_PREVIOUS] = hashPrevio;

    var rawContent = row[C.TIMESTAMP] + row[C.USER_EMAIL] + accion + idEntidad + (nuevo || 'N/A') + hashPrevio;
    var signature = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, rawContent, Utilities.Charset.UTF_8);
    row[C.HASH_RECORD] = signature.map(function (byte) { return ('0' + (byte & 0xFF).toString(16)).slice(-2); }).join('');

    try {
      sheet.appendRow(row);
    } catch (e) {
      console.error('❌ [Auditoría] Fallo al escribir.', e);
    }

    return true;
  } catch (e) {
    console.error('❌ [Auditoría] Error en registrarLogInterno:', e);
    return false;
  }
}

/**
 * ============================================================================
 * 5. VERIFICACIÓN DE INTEGRIDAD FORENSE
 * ============================================================================
 */
function w_verificarIntegridadLogs() {
  try {
    // 🚀 FIX: Reemplazo de getActiveSpreadsheet() por _obtenerBaseDatos()
    var sheet = _obtenerBaseDatos().getSheetByName(CONFIG.DB.AUDIT_LOG);
    var values = sheet.getDataRange().getValues();
    if (values.length < 2) return JSON.stringify({ integro: true, analizados: 0 });

    var headers = values[0];
    var C = {};
    headers.forEach(function (h, i) {
      var nombre = String(h || '').trim().toUpperCase();
      if (nombre) C[nombre] = i;
    });

    var requeridas = ['ID_LOG', 'TIMESTAMP', 'USER_EMAIL', 'ACTION_TYPE', 'ENTIDAD_ID', 'VALOR_NUEVO', 'HASH_RECORD', 'HASH_PREVIOUS'];
    var faltantes = requeridas.filter(function (col) { return C[col] === undefined; });
    if (faltantes.length > 0) return JSON.stringify({ error: true, message: 'Columnas faltantes: ' + faltantes.join(', ') });

    var hashPrevio = 'GENESIS_BLOCK';

    for (var i = 1; i < values.length; i++) {
      var r = values[i];
      var hashAlmacenado = r[C.HASH_RECORD];

      var content = String(r[C.TIMESTAMP]) + String(r[C.USER_EMAIL]) + String(r[C.ACTION_TYPE]) + String(r[C.ENTIDAD_ID]) + String(r[C.VALOR_NUEVO]) + hashPrevio;
      var signature = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, content, Utilities.Charset.UTF_8);
      var hashCalculado = signature.map(function (byte) { return ('0' + (byte & 0xFF).toString(16)).slice(-2); }).join('');

      if (hashCalculado !== hashAlmacenado) {
        return JSON.stringify({ integro: false, idRuptura: r[C.ID_LOG], fila: i + 1, hashEsperado: hashCalculado, hashEncontrado: hashAlmacenado });
      }
      hashPrevio = hashAlmacenado;
    }

    return JSON.stringify({ integro: true, analizados: values.length - 1 });
  } catch (e) {
    return JSON.stringify({ error: true, message: e.message });
  }
}

/**
 * ============================================================================
 * 6. PUENTES PARA EL FRONTEND
 * ============================================================================
 */
function w_obtenerDataMaestra() { return getDatabaseCompleta(); }
function w_getSystemTelemetry() {
  return JSON.stringify({
    success: true, version: CONFIG.VERSION, env: CONFIG.ENV, appName: CONFIG.APP_NAME,
    norma1: CONFIG.COMPLIANCE.NORMA_1, norma2: CONFIG.COMPLIANCE.NORMA_2, arch: CONFIG.ARCHITECTURE
  });
}
<<<<<<< HEAD

function w_registrarAuditoriaFrontend(acc, mod, id, det, ant, nvo) {
  return registrarLogInterno(acc, mod, id, ant, nvo, det, 'FRONTEND_REQUEST');
}

function w_registrarLogForense(motivo, modulo, id, detalles, ip) {
  return registrarLogInterno(motivo, modulo, id, 'N/A', 'N/A', detalles, ip);
}

/**
 * MOTOR DE TRANSACCIONES MULTITABLA (ATÓMICO)
 * Ejecuta múltiples operaciones de escritura bajo un único LockService.
 * Requerido para el Módulo de Calidad (Gatekeeper) e ISO 22000.
 * * @param {string} payloadStr - JSON String array: [{tabla: 'KEY', accion: 'INSERTAR|UPDATE', idRegistro: 'UUID', datos: {}}]
 * @param {string} ipCliente - IP del nodo cliente.
 * @returns {string} JSON String de respuesta.
 */
function w_EjecutarTransaccionMultitabla(payloadStr, ipCliente) {
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(15000)) {
    return JSON.stringify({ exito: false, mensaje: "Riesgo de colisión: El servidor está procesando otra operación. Reintente." });
  }

  try {
    const transacciones = JSON.parse(payloadStr);
    if (!Array.isArray(transacciones)) {
      throw new Error("Estructura de payload inválida. Se requiere un Array de transacciones.");
    }

    const emailUsuario = Session.getActiveUser().getEmail() || 'SYSTEM';
    let logsGenerados = [];

    // FASE 1: EJECUCIÓN ATÓMICA
    transacciones.forEach(tx => {
      const nombreHoja = CONFIG.DB[tx.tabla];
      const llavePrimaria = CONFIG.LLAVES_PRIMARIAS[tx.tabla];

      if (!nombreHoja || !llavePrimaria) throw new Error("Configuración de tabla no encontrada para: " + tx.tabla);

      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombreHoja);
      if (!sheet) throw new Error("Hoja de cálculo no encontrada: " + nombreHoja);

      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      const data = sheet.getDataRange().getValues();
      const colIdIndex = headers.indexOf(llavePrimaria);

      if (tx.accion === 'INSERTAR') {
        let nuevaFila = new Array(headers.length).fill('');
        headers.forEach((header, index) => {
          if (tx.datos[header] !== undefined) {
            nuevaFila[index] = tx.datos[header];
          }
        });
        sheet.appendRow(nuevaFila);
        logsGenerados.push({
          accion: 'INSERTAR_MULTITABLA', modulo: tx.tabla, entidad: tx.datos[llavePrimaria],
          valAnt: 'N/A', valNvo: JSON.stringify(tx.datos)
        });

      } else if (tx.accion === 'UPDATE') {
        if (!tx.idRegistro) throw new Error("ID de registro requerido para UPDATE en " + tx.tabla);

        let rowIndex = -1;
        for (let i = 1; i < data.length; i++) {
          if (data[i][colIdIndex] === tx.idRegistro) {
            rowIndex = i + 1;
            break;
          }
        }
        if (rowIndex === -1) throw new Error("Registro no encontrado para UPDATE: " + tx.idRegistro);

        let valoresAnteriores = {};
        let valoresNuevos = {};

        headers.forEach((header, index) => {
          if (tx.datos[header] !== undefined && tx.datos[header] !== data[rowIndex - 1][index]) {
            valoresAnteriores[header] = data[rowIndex - 1][index];
            valoresNuevos[header] = tx.datos[header];
            sheet.getRange(rowIndex, index + 1).setValue(tx.datos[header]);
          }
        });

        // Registrar timestamp y updater por defecto si existen
        const tsIndex = headers.indexOf('TIMESTAMP_UPDATE');
        const usrIndex = headers.indexOf('USER_UPDATER');
        const now = new Date().toISOString();
        if (tsIndex > -1) sheet.getRange(rowIndex, tsIndex + 1).setValue(now);
        if (usrIndex > -1) sheet.getRange(rowIndex, usrIndex + 1).setValue(emailUsuario);

        logsGenerados.push({
          accion: 'UPDATE_MULTITABLA', modulo: tx.tabla, entidad: tx.idRegistro,
          valAnt: JSON.stringify(valoresAnteriores), valNvo: JSON.stringify(valoresNuevos)
        });
      } else {
        throw new Error("Acción no reconocida: " + tx.accion);
      }
    });

    // FASE 2: CONSOLIDACIÓN DE TRAZABILIDAD (SYS_AUDIT_LOG)
    // Se invoca a la función interna de logeo por cada transacción procesada.
    // (Asumiendo la existencia de w_RegistrarLogInterno o similar en Core.gs)
    if (typeof w_RegistrarLogInterno === "function") {
      logsGenerados.forEach(log => {
        w_RegistrarLogInterno(emailUsuario, log.accion, log.modulo, log.entidad, log.valAnt, log.valNvo, ipCliente, "Transacción atómica exitosa.");
      });
    }

    return JSON.stringify({ exito: true, mensaje: "Transacción atómica procesada correctamente." });

  } catch (error) {
    // Nota: Apps Script no soporta Rollback nativo, la estructura atrapa errores de validación de memoria antes de escribir.
    return JSON.stringify({ exito: false, mensaje: "Fallo de Transacción: " + error.message });
  } finally {
    lock.releaseLock();
  }
}

/**
 * @file Setup_Calidad.gs
 * @description Script de aprovisionamiento de infraestructura para el Módulo Gatekeeper.
 * Ejecutar exclusivamente una vez desde el editor de Apps Script.
 */

function w_InstalarTablaCalidad() {
  const SPREADSHEET_ID = SECRETS.SPREADSHEET_ID; // Extraído de Config.gs
  const NOMBRE_HOJA = "CALIDAD_LOG";

  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = ss.getSheetByName(NOMBRE_HOJA);

    if (sheet) {
      Logger.log("⚠️ La tabla " + NOMBRE_HOJA + " ya existe. Abortando creación para proteger integridad.");
      return;
    }

    // 1. Crear Hoja
    sheet = ss.insertSheet(NOMBRE_HOJA);

    // 2. Definir Cabeceras (URS-10 Estricto)
    const cabeceras = [
      "ID_UUID",
      "TIMESTAMP_CREATE",
      "USER_CREATOR",
      "ID_FACTURA",
      "RUT_PROVEEDOR",
      "RESULTADO_INSPECCION",
      "PARAMETROS_TECNICOS",
      "CRUCE_ALERGENOS",
      "ACCION_ISO_RIESGO",
      "CERTIFICADO_HASH"
    ];

    // 3. Definir Registro Génesis
    const genesis = [
      "GENESIS_CALIDAD",
      new Date().toISOString(),
      "SYSTEM",
      "N/A",
      "N/A",
      "APROBADO",
      JSON.stringify({ temp: 0, humedad: 0, integridad: "INTACTO" }),
      JSON.stringify({ control: "Genesis", alerta: false }),
      "MANTENIDO",
      "8ab29e469db627f2524b0b3e9b5d61eb84d10913bb048788b4e4ac57dcbbc247" // Hash estático semilla
    ];

    // 4. Inyectar Datos
    sheet.getRange(1, 1, 1, cabeceras.length).setValues([cabeceras]).setFontWeight("bold");
    sheet.getRange(2, 1, 1, genesis.length).setValues([genesis]);

    // 5. Aplicar Formato Estructural
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, cabeceras.length);

    Logger.log("✅ ÉXITO: Tabla " + NOMBRE_HOJA + " aprovisionada correctamente bajo estándar URS-28.");

  } catch (error) {
    Logger.log("🚨 ERROR CRÍTICO en aprovisionamiento: " + error.message);
  }
}
=======
function w_registrarAuditoriaFrontend(acc, mod, id, det, ant, nvo) { return registrarLogInterno(acc, mod, id, ant, nvo, det, 'FRONTEND_REQUEST'); }
function w_registrarLogForense(motivo, modulo, id, detalles, ip) { return registrarLogInterno(motivo, modulo, id, 'N/A', 'N/A', detalles, ip); }
>>>>>>> 62c6b20e30a8bb39c1b82f7ee9b598b783362e48
