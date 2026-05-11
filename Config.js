/**
 * @file Config.gs
 * @description Fuente de la Verdad. Segregación Zero-Trust (Público vs Secreto).
 * @version 5.3.0
 */

// ============================================================================
// 1. SECRETS (Infraestructura - Aislao en el Servidor V8)
// ============================================================================
var SECRETS = {
  ADSHEET_ID: "1-zTmClZh8s-xraYBdQlY5HJIQvmq_7dVCS0SmEydNMc",
  FOLDER_XML_BODEGA: "1iCMETUMuqwokGiTKeXPO_Vl_ZTnKhd4Z"
};

// ============================================================================
// 2. CONFIG (Reglas de Negocio y Mapeo - Seguro para Inyección al Frontend)
// ============================================================================
var CONFIG = {
  APP_NAME: "ERP MDP PAN19",
  VERSION: "5.3.0",
  ENV: "DEV",
  COMPLIANCE: {
    NORMA_1: "ISO 22000 COMPLIANT",
    NORMA_2: "DTE SII CHILE"
  },
  ARCHITECTURE: "Zero Trust Architecture",
  CHILE_OFFSET: "America/Santiago",

  DB: {
    COMPRAS: 'LIBRO_COMPRAS',
    ITEMS: 'MAESTRO_ITEMS',
    CONFIG: 'SYS_CONFIG',
    PROVEEDORES: 'MAESTRO_PROVEEDORES',
    AUDIT_LOG: 'SYS_AUDIT_LOG',
    USUARIOS: 'MAESTRO_USUARIOS',
    ROLES: 'MAESTRO_ROLES',
    LOTES: 'ABASTECIMIENTO_LOTES',
    CAJA: 'LIBRO_CAJA',
    CXP: 'CUENTAS_POR_PAGAR'
  },

  MATRIZ_ALERGENOS: {
    "GLUTEN": ["HARINA", "TRIGO", "AVENA", "CEBADA", "CENTENO", "SEMOLA", "MASA", "BOLLERÍA"],
    "LACTEOS": ["QUESO", "LECHE", "MANTEQUILLA", "CREMA", "YOGURT", "SUERO", "MANJAR"],
    "FRUTOS_SECOS": ["NUEZ", "ALMENDRA", "MANI", "PISTACHO", "AVELLANA"],
    "SOYA": ["SOYA", "SOJA", "TOFU"]
  },

  LLAVES_PRIMARIAS: {
    COMPRAS: 'ID_UUID',
    ITEMS: 'SKU_INTERNO',
    CONFIG: 'PARAM_KEY',
    PROVEEDORES: 'RUT_ENTIDAD',
    AUDIT_LOG: 'ID_LOG',
    USUARIOS: 'ISPRED_UUID',
    ROLES: 'ID_ROL',
    LOTES: 'ID_UUID',
    CAJA: 'ID_MOVIMIENTO',
    CXP: 'ID_CXP'
  }
};

// Estructuras públicas de procesamiento
var CONFIG_DETALLE_COMPRAS = {
  SII_MAPPING: {
    SKU: 'VlrCodigo',
    NOMBRE: 'NmbItem',
    DESCRIPCION: 'DscItem',
    CANTIDAD: 'QtyItem',
    PRECIO: 'PrcItem',
    UNIDAD: 'UnmdItem',
    MONTO: 'MntoItem'
  },
  EXTRACTORES: {
    LOTE: {
      pattern: /(?:LOTE|LOT|L:|B:|BATCH)\s*[:#-]?\s*([A-Z0-9.\-\/]+)/i,
      target_field: 'DESCRIPCION'
    }
  },
  SCHEMA_JSON: {
    sku: null, nombre: null, cantidad: 0, precio: 0, unidad: 'UN', lote: 'S/L', alergenos: 'OK', iso_status: 'PENDIENTE'
  }
};
