/**
 * @file W_Seguridad.js
 * @description Motor Zero Trust. Autenticación y Gestión de Usuarios (Estándar URS-28).
 * @version 6.0.3 (Hard-Linked Integrado con Core.js)
 */

/**
 * @section 1. MOTOR DE AUTENTICACIÓN (Fase 1)
 */

function w_verificarIdentidadZeroTrust(ip) {
  console.log("🛡️ [W_Seguridad] ==> Entrando a w_verificarIdentidadZeroTrust...");
  var LOCK = LockService.getScriptLock();
  try {
    LOCK.waitLock(10000);
    console.log("🛡️ [W_Seguridad] ==> 1. Lock adquirido.");

    var emailStr = String(Session.getActiveUser().getEmail() || "").toLowerCase().trim();
    if (!emailStr) throw new Error("Identidad de Google no detectada.");
    console.log("🛡️ [W_Seguridad] ==> 2. Email obtenido: " + emailStr);

    // 🚀 FIX: Usar el conector centralizado de Core.js (Zero-Trust)
    var ss = _obtenerBaseDatos();
    console.log("🛡️ [W_Seguridad] ==> 3. Spreadsheet abierto con éxito mediante _obtenerBaseDatos().");

    var wsUsers = ss.getSheetByName('MAESTRO_USUARIOS');
    console.log("🛡️ [W_Seguridad] ==> 4. Hoja 'MAESTRO_USUARIOS' obtenida.");

    var usersData = wsUsers.getDataRange().getValues();
    var userHeaders = usersData[0].map(function (h) { return String(h).trim().toUpperCase(); });

    var idxEmail = userHeaders.indexOf('EMAIL');
    var userRow = usersData.slice(1).find(function (r) {
      return String(r[idxEmail]).toLowerCase().trim() === emailStr;
    });

    // 1. CASO: USUARIO NO EXISTE
    if (!userRow) {
      var newUuid = Utilities.getUuid();
      registrarLogInterno('AUTH_REGISTER', 'SEGURIDAD', newUuid, 'N/A', 'PENDIENTE', 'Auto-registro: ' + emailStr, ip);
      return JSON.stringify({ authorized: false, status: 'PENDIENTE', email: emailStr });
    }

    var uuid = userRow[userHeaders.indexOf('ISPRED_UUID') || userHeaders.indexOf('ID_UUID')];
    var status = String(userRow[userHeaders.indexOf('STATUS')]).trim().toUpperCase();
    var nivelAcceso = parseInt(userRow[userHeaders.indexOf('NIVEL_ACCESO')], 10);

    // 2. CASO: USUARIO BLOQUEADO
    if (status !== 'ACTIVO') {
      registrarLogInterno('AUTH_REJECT', 'SEGURIDAD', uuid, status, status, 'Acceso denegado: ' + status, ip);
      return JSON.stringify({ authorized: false, status: status, email: emailStr });
    }

    // 3. VALIDACIÓN DE ROL Y PERMISOS
    let matrizPermisosStr = '[]';
    let nombreRol = 'Sin Rol';

    if (nivelAcceso === 1) {
      matrizPermisosStr = '["*"]';
      nombreRol = 'SUPER';
    } else {
      const wsRoles = ss.getSheetByName('MAESTRO_ROLES');
      const rolesData = wsRoles.getDataRange().getValues();
      const roleHeaders = rolesData[0].map(h => String(h).trim().toUpperCase());
      const rolRow = rolesData.slice(1).find(r => parseInt(r[roleHeaders.indexOf('ID_ROL')]) === nivelAcceso);

      if (rolRow && String(rolRow[roleHeaders.indexOf('STATUS')]).trim().toUpperCase() === 'ACTIVO') {
        matrizPermisosStr = rolRow[roleHeaders.indexOf('PERMISOS_JSON')] || '[]';
        nombreRol = rolRow[roleHeaders.indexOf('NOMBRE_ROL')] || `Rol ${nivelAcceso}`;
      } else {
        registrarLogInterno('AUTH_REJECT', 'SEGURIDAD', uuid, 'N/A', 'N/A', `Rol inválido: ${nivelAcceso}`, ip);
        return JSON.stringify({ authorized: false, status: 'ROL_INACTIVO', email: emailStr });
      }
    }

    // 4. REGISTRO FORENSE DE ÉXITO
    w_registrarLogForense('AUTH_SUCCESS', 'SEGURIDAD', uuid, 'Ingreso exitoso. Rol: ' + nombreRol, ip);

    // 5. RESPUESTA EXITOSA
    return JSON.stringify({
      authorized: true,
      status: 'ACTIVO',
      email: emailStr,
      nivel_acceso: nivelAcceso,
      nombres: userRow[userHeaders.indexOf('NOMBRES')],
      uuid: uuid,
      nombre_rol: nombreRol,
      matriz_permisos: matrizPermisosStr
    });

  } catch (error) {
    console.error("❌ [W_Seguridad] ==> CAPTURA DE ERROR en w_verificarIdentidadZeroTrust: ", error);
    registrarLogInterno('AUTH_ERROR', 'SEGURIDAD', 'N/A', 'N/A', 'N/A', 'Error: ' + error.message, ip);
    return JSON.stringify({ error: true, message: error.message, authorized: false });
  } finally {
    LOCK.releaseLock();
  }
}

/**
 * @section 2. CONTROLADORES DE ESCRITURA DE SEGURIDAD
 */
function w_upsertUsuario(payloadStr) {
  var LOCK = LockService.getScriptLock();
  try {
    if (!w_verificarEstadoSesion('seguridad')) {
      return JSON.stringify({ error: true, tipo: 'FATAL_AUTH', mensaje: 'Sesión revocada o privilegios insuficientes.' });
    }

    LOCK.waitLock(10000);
    var payload = JSON.parse(payloadStr);
    var tabla = 'MAESTRO_USUARIOS'; // Nombre directo por seguridad core

    if (payload.ID_UUID === 'NUEVO') {
      payload.ID_UUID = Utilities.getUuid();
      UTIL_CrearFilaSegura(tabla, payload);
      w_registrarAuditoriaFrontend('CREATE', 'SEGURIDAD', payload.ID_UUID, 'Nuevo Usuario', '', payload.EMAIL);
    } else {
      UTIL_ActualizarFilaSegura(tabla, 'ISPRED_UUID', payload.ID_UUID, payload);
      w_registrarAuditoriaFrontend('UPDATE', 'SEGURIDAD', payload.ID_UUID, 'Modificación de Usuario', '', payload.EMAIL);
    }

    return JSON.stringify({ error: false, success: true });

  } catch (e) {
    return JSON.stringify({ error: true, message: e.message });
  } finally {
    LOCK.releaseLock();
  }
}

function w_upsertRol(payload) {
  var LOCK = LockService.getScriptLock();
  try {
    if (!w_verificarEstadoSesion('seguridad')) {
      return JSON.stringify({ error: true, tipo: 'FATAL_AUTH', mensaje: 'Sesión revocada o privilegios insuficientes.' });
    }

    LOCK.waitLock(10000);
    var tabla = 'MAESTRO_ROLES';

    var objGuardar = {
      ID_ROL: payload.id_rol,
      NOMBRE_ROL: payload.nombre_rol,
      STATUS: payload.status,
      PERMISOS_JSON: JSON.stringify(payload.permisos)
    };

    // 🚀 FIX: Usar conector central
    var sheet = _obtenerBaseDatos().getSheetByName(tabla);
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var idCol = headers.indexOf('ID_ROL');
    var existe = data.some(function (row, i) { return i > 0 && String(row[idCol]) === String(payload.id_rol); });

    if (!existe) {
      UTIL_CrearFilaSegura(tabla, objGuardar);
      w_registrarAuditoriaFrontend('CREATE', 'SEGURIDAD', payload.id_rol, 'Nuevo Rol', '', payload.nombre_rol);
    } else {
      UTIL_ActualizarFilaSegura(tabla, 'ID_ROL', payload.id_rol, objGuardar);
      w_registrarAuditoriaFrontend('UPDATE', 'SEGURIDAD', payload.id_rol, 'Modificación de Rol', '', payload.nombre_rol);
    }

    return JSON.stringify({ error: false, success: true });

  } catch (e) {
    return JSON.stringify({ error: true, message: e.message });
  } finally {
    LOCK.releaseLock();
  }
}

/**
 * @section 3. AUDITORÍA ZERO-TRUST
 */
function w_logoutAudit(motivo) {
  try {
    if (typeof registrarLogInterno === 'function') {
      registrarLogInterno('AUTH_LOGOUT', 'SEGURIDAD', 'N/A', 'N/A', 'N/A', 'Cierre de sesión manual. Razón: ' + motivo);
    }
    return true;
  } catch (e) { return false; }
}

function w_logoutAuditDiferido(emailFront, timestampCaida) {
  try {
    if (typeof registrarLogInterno === 'function') {
      registrarLogInterno('AUTH_TIMEOUT', 'SEGURIDAD', 'N/A', 'N/A', 'N/A',
        '[DEAD MAN SWITCH] Caída por inactividad a las: ' + timestampCaida);
    }
    return true;
  } catch (e) { return false; }
}

/**
 * @section 4. MOTOR DE SEGURIDAD ZERO-LATENCY
 */
function w_pingSeguridadCache() {
  try {
    var emailStr = Session.getActiveUser().getEmail().toLowerCase().trim();
    var cache = CacheService.getScriptCache();
    var cacheKey = "AUTH_" + emailStr;

    var datosCacheados = cache.get(cacheKey);
    if (datosCacheados) {
      return JSON.parse(datosCacheados);
    }

    // 🚀 FIX: Usar el conector centralizado de Core.js
    var ss = _obtenerBaseDatos();
    var wsUsers = ss.getSheetByName('MAESTRO_USUARIOS');
    var dataU = wsUsers.getDataRange().getValues();
    var headU = dataU[0].map(function (h) { return String(h).trim().toUpperCase(); });

    var userRow = dataU.slice(1).find(function (r) {
      return String(r[headU.indexOf('EMAIL')]).toLowerCase() === emailStr;
    });

    if (!userRow || String(userRow[headU.indexOf('STATUS')]).toUpperCase() !== 'ACTIVO') {
      var respNegativa = { activo: false };
      cache.put(cacheKey, JSON.stringify(respNegativa), 900);
      return respNegativa;
    }

    var idRol = userRow[headU.indexOf('NIVEL_ACCESO')];
    var permisos = [];

    if (String(idRol) === "1") {
      permisos = ["*"];
    } else {
      var wsRoles = ss.getSheetByName('MAESTRO_ROLES');
      var dataR = wsRoles.getDataRange().getValues();
      var headR = dataR[0].map(function (h) { return String(h).trim().toUpperCase(); });
      var rolRow = dataR.slice(1).find(function (r) { return String(r[headR.indexOf('ID_ROL')]) === String(idRol); });

      permisos = (rolRow && String(rolRow[headR.indexOf('STATUS')]).toUpperCase() === 'ACTIVO')
        ? JSON.parse(rolRow[headR.indexOf('PERMISOS_JSON')] || '[]') : [];
    }

    var respPositiva = { activo: true, permisos: permisos };
    cache.put(cacheKey, JSON.stringify(respPositiva), 900);
    return respPositiva;

  } catch (e) {
    return { activo: true };
  }
}