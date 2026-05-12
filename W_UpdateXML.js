/**
 * @file W_UpdateXML.gs
 * @version 5.3.8
 * @description Motor Backend DTE: Blindaje Antiduplicidad, Norma SII (Carta) y Trazabilidad ISO 22000.
 * @compliance ISO 22000 / SII Chile / URS-28 / Zero-Trust
 * @reparacion [V5.3.8] Purga total de conflictos Git y sincronización con Auditoría v6.0.10.
 */

/** * ============================================================================
 * [SCOPE: DATA_ACCESS] - Puentes Públicos y Escritura Segura
 * ============================================================================
 */
function w_updatexml_procesarIntegracion(payloadStr) {
    const correlationId = "LOTE-" + new Date().getTime();
    try {
        const payload = JSON.parse(payloadStr);
        const email = Session.getActiveUser().getEmail();
        const resultado = _logica_ejecutarIntegracionLote(payload.loteDTE, email, correlationId, payload.ip);

        // Registro exitoso en auditoría
        w_registrarAuditoriaFrontend("UPDATEXML", "BATCH_INTEGRATION", correlationId, "Ingesta masiva exitosa", "N/A", "N/A");

        return JSON.stringify({ success: true, data: resultado });
    } catch (e) {
        return JSON.stringify({ error: true, message: e.message });
    }
}

function _ejecutarYValidar(idTablaConfig, idRegistro, nuevosDatos) {
    const resStr = w_EjecutarTransaccionSegura(idTablaConfig, idRegistro, nuevosDatos);
    const res = JSON.parse(resStr);
    if (res.error) throw new Error(`${idTablaConfig}: ${res.message}`);
    return res;
}

function UTIL_ToProperCase(t) {
    return t ? t.toLowerCase().replace(/\b\w/g, l => l.toUpperCase()) : "";
}

function _ejecutarYValidar(idTablaConfig, idRegistro, nuevosDatos) {
    const resStr = w_EjecutarTransaccionSegura(idTablaConfig, idRegistro, nuevosDatos);
    const res = JSON.parse(resStr);
    if (res.error) throw new Error(`${idTablaConfig}: ${res.message}`);
    return res;
}

/** * ============================================================================
 * [SCOPE: CORE_LOGIC] - Motor de Integración Industrial
 * ============================================================================
 */

function _logica_ejecutarIntegracionLote(loteDTE, email, correlationId, ip) {
    const ss = _obtenerBaseDatos();
    const resultados = { successes: [], errors: [], certUrl: "" };
    const folder = DriveApp.getFolderById(SECRETS.FOLDER_XML_BODEGA) || DriveApp.getRootFolder();

    // 🛡️ 1. CACHÉS DE DUPLICIDAD (Memory-First)
    const setCompras = new Set(ss.getSheetByName(CONFIG.DB.COMPRAS).getDataRange().getValues().slice(1).map(r => `${String(r[9]).replace(/\./g, '').trim().toUpperCase()}_${String(r[8]).trim()}`));
    const setProveedores = new Set(ss.getSheetByName(CONFIG.DB.PROVEEDORES).getDataRange().getValues().slice(1).map(r => String(r[4]).replace(/\./g, '').trim().toUpperCase()));
    const setItems = new Set(ss.getSheetByName(CONFIG.DB.ITEMS).getDataRange().getValues().slice(1).map(r => String(r[4]).trim().toUpperCase()));
    const setLotes = new Set(ss.getSheetByName(CONFIG.DB.LOTES).getDataRange().getValues().slice(1).map(r => String(r[1]).trim().toUpperCase()));

    const cssCarta = `
        <style>
            @page { size: letter; margin: 1.2cm; }
            body { font-family: 'Helvetica', Arial, sans-serif; font-size: 10px; color: #333; }
            .sii-header { border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 15px; }
            .sii-box { border: 3px solid #FF0000; padding: 10px; color: #FF0000; text-align: center; font-weight: bold; font-size: 14px; }
            .table-detalle { width: 100%; border-collapse: collapse; margin-top: 15px; }
            .table-detalle th { background: #f2f2f2; border: 1px solid #ccc; padding: 5px; text-align: left; }
            .table-detalle td { border: 1px solid #ccc; padding: 5px; }
            .totales-box { width: 45%; margin-left: 55%; margin-top: 15px; }
        </style>`;

    loteDTE.forEach(dte => {
        try {
            const rutL = String(dte.rutEmisor).replace(/\./g, '').trim().toUpperCase();
            const folio = String(Number(dte.folio));
            const purchaseKey = `${rutL}_${folio}`;

            // 🚫 FILTRO ANTIDUPLICIDAD
            if (setCompras.has(purchaseKey)) throw new Error(`DOCUMENTO YA EXISTE (RUT: ${rutL}, Folio: ${folio})`);

            const uuidComp = Utilities.getUuid();
            const rSocial = UTIL_ToProperCase(dte.razonSocial);
            const idDoc = `${rutL}_F${folio}`;

            // 📂 GENERACIÓN DE RESPALDO (FORMATO CARTA / NORMA SII)
            const fileXml = folder.createFile(Utilities.newBlob(dte.xmlRaw, 'application/xml', `DTE_${idDoc}.xml`));

            let htmlSII = `<html><head>${cssCarta}</head><body>
                <div class="sii-header"><table style="width: 100%;"><tr>
                    <td style="width: 65%;"><h2>${rSocial}</h2><p><b>GIRO:</b> ${dte.giro || 'N/A'}</p><p>${dte.direccion}, ${dte.comuna}</p></td>
                    <td style="width: 35%;"><div class="sii-box">R.U.T.: ${rutL}<br>FACTURA ELECTRÓNICA<br>N° ${folio}</div></td>
                </tr></table></div>
                <div style="font-size:11px; margin-bottom:15px; padding:10px; background:#fafafa; border:1px solid #eee;">
                    <b>RECEPTOR:</b> ${CONFIG.APP_NAME} | <b>FECHA EMISIÓN:</b> ${dte.fechaEmision}
                </div>
                <table class="table-detalle">
                    <thead><tr><th>SKU</th><th>DESCRIPCIÓN</th><th>CANT.</th><th>UNITARIO</th><th>TOTAL</th></tr></thead>
                    <tbody>${dte.items.map(it => `<tr><td>${it.codigo}</td><td>${it.nombre}</td><td style="text-align:center;">${it.cantidad} ${it.unidad}</td><td style="text-align:right;">$${Number(it.precio).toLocaleString('es-CL')}</td><td style="text-align:right;">$${(Number(it.cantidad) * Number(it.precio)).toLocaleString('es-CL')}</td></tr>`).join('')}</tbody>
                </table>
                <table class="totales-box">
                    <tr><td>Neto:</td><td style="text-align:right;">$${Number(dte.montoNeto).toLocaleString('es-CL')}</td></tr>
                    <tr><td>I.V.A. (19%):</td><td style="text-align:right;">$${Number(dte.montoIva).toLocaleString('es-CL')}</td></tr>
                    ${Number(dte.montoOtrosImpuestos) > 0 ? `<tr><td>Imptos Adic.:</td><td style="text-align:right;">$${Number(dte.montoOtrosImpuestos).toLocaleString('es-CL')}</td></tr>` : ''}
                    <tr style="font-weight:bold; border-top:1px solid #000;"><td>TOTAL:</td><td style="text-align:right;">$${Number(dte.montoTotal).toLocaleString('es-CL')}</td></tr>
                </table>
            </body></html>`;

            const filePdf = folder.createFile(Utilities.newBlob(htmlSII, 'text/html', `PDF_${idDoc}.html`).getAs('application/pdf').setName(`RESPALDO_${idDoc}.pdf`));
            const urls = { xml: fileXml.getUrl(), pdf: filePdf.getUrl() };

            // 🛡️ ENROLAMIENTO PROVEEDOR
            if (!setProveedores.has(rutL)) {
                _ejecutarYValidar('PROVEEDORES', 'NUEVO', {
                    ID_UUID: Utilities.getUuid(), STATUS: 'ACTIVO', RUT_ENTIDAD: rutL, RAZON_SOCIAL: rSocial,
                    GIRO: String(dte.giro || '').toUpperCase(), DIRECCION: dte.direccion, ISO_RIESGO: 'EVALUACION'
                });
                setProveedores.add(rutL);
            }

            // 📝 LIBRO_COMPRAS
            _ejecutarYValidar('COMPRAS', 'NUEVO', {
                ID_UUID: uuidComp, STATUS: 'INTEGRADO', FECHA_EMISION: dte.fechaEmision, TIPO_DTE: dte.tipoDTE, FOLIO: folio,
                RUT_EMISOR: rutL, RAZON_SOCIAL: rSocial, MONTO_NETO: dte.montoNeto, MONTO_IVA: dte.montoIva,
                OTROS_IMPUESTOS: dte.montoOtrosImpuestos, MONTO_TOTAL: dte.montoTotal,
                URL_XML_PDF: JSON.stringify(urls), DETALLE_JSON: JSON.stringify(dte.items)
            });

            // 📦 ITEMS Y LOTES ISO 22000
            dte.items.forEach((it, idx) => {
                const skuL = String(it.codigo).trim().toUpperCase();
                const loteId = `${rutL}_F${folio}_L${idx + 1}`;

                if (!setItems.has(skuL)) {
                    _ejecutarYValidar('ITEMS', 'NUEVO', {
                        ID_ITEM: Utilities.getUuid(), STATUS: 'ACTIVO', SKU_INTERNO: skuL,
                        NOMBRE_TECNICO: UTIL_ToProperCase(it.nombre), UNIDAD_MEDIDA: it.unidad, RUT_PROV_PREFERENTE: rutL
                    });
                    setItems.add(skuL);
                }

                if (!setLotes.has(loteId)) {
                    _ejecutarYValidar('LOTES', 'NUEVO', {
                        ID_UUID: Utilities.getUuid(), ID_LOTE_PAN19: loteId, SKU_INTERNO: skuL,
                        DTE_FOLIO: folio, RUT_PROVEEDOR: rutL, CANTIDAD_ORIGINAL: it.cantidad, SALDO_ACTUAL: it.cantidad, ESTADO_CALIDAD: 'CUARENTENA'
                    });
                    setLotes.add(loteId);
                }
            });

            // 🏦 FINANZAS
            _ejecutarYValidar('CXP', 'NUEVO', { ID_CXP: Utilities.getUuid(), ID_FACTURA: uuidComp, RUT_PROVEEDOR: rutL, MONTO_DEUDA: dte.montoTotal, ESTADO_PAGO: 'PENDIENTE', VENCIMIENTO: dte.fechaVencimiento });
            _ejecutarYValidar('CAJA', 'NUEVO', {
                ID_MOVIMIENTO: Utilities.getUuid(), FECHA_BANCO: dte.fechaEmision, INSTITUCION: rSocial, TIPO: 'PROVISION_CXP',
                MONTO: String(-(Number(dte.montoTotal))), ESTADO_CONCILIACION: 'PROVISIONADO', FOLIO_VINCULADO: 'FAC-' + folio, FECHA_SISTEMA: new Date().toISOString()
            });

            resultados.successes.push({ rut: rutL, folio: folio, razonSocial: rSocial, monto: dte.montoTotal });

        } catch (e) {
            resultados.errors.push({ folio: dte.folio, error: e.message });
        }
    });

    // 📊 CERTIFICADO DE LOTE
    const totalMonto = resultados.successes.reduce((acc, curr) => acc + Number(curr.monto), 0);
    let htmlCert = `<html><head>${cssCarta}</head><body>
        <div style="border-bottom:3px solid #1a2b4c; padding-bottom:10px;"><h2>CERTIFICADO DE INGESTA MASIVA DTE</h2><p>Lote: ${correlationId}</p></div>
        <p><b>Éxitos:</b> ${resultados.successes.length} | <b>Fallas:</b> ${resultados.errors.length} | <b>Total:</b> $${totalMonto.toLocaleString('es-CL')}</p>
        <table class="table-detalle"><thead><tr><th>RUT</th><th>FOLIO</th><th>ESTADO</th></tr></thead><tbody>
            ${resultados.successes.map(s => `<tr><td>${s.rut}</td><td>${s.folio}</td><td style="color:green;">INTEGRADO</td></tr>`).join('')}
            ${resultados.errors.map(e => `<tr><td colspan="2">Error en Folio ${e.folio}: ${e.error}</td><td style="color:red;">RECHAZADO</td></tr>`).join('')}
        </tbody></table>
    </body></html>`;

    resultados.certUrl = folder.createFile(Utilities.newBlob(htmlCert, 'text/html', `CERT_${correlationId}.html`).getAs('application/pdf').setName(`CERTIFICADO_LOTE_${correlationId}.pdf`)).getUrl();

    return resultados;
}

function UTIL_ToProperCase(t) { return t ? t.toLowerCase().replace(/\b\w/g, l => l.toUpperCase()) : ""; }