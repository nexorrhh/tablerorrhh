// Parser del archivo de "Comprobantes Recibidos" que se descarga de ARCA (ex-AFIP).
//
// Verificado contra un archivo real (consulta CSV de comprobantes recibidos, CUIT 30613137498).
// Es un listado de facturas que LE EMITIERON a la empresa — por eso el CUIT del proveedor
// está en las columnas "Emisor" (el "Receptor" es siempre la propia empresa, constante en
// todas las filas). Separador ";", 30 columnas, sin comillas en las filas de datos, UTF-8.

const ALIAS_CUIT           = ['nro doc emisor', 'nro documento emisor', 'numero doc emisor', 'cuit emisor', 'cuit'];
const ALIAS_RAZON_SOCIAL   = ['denominacion emisor', 'razon social emisor', 'razon social', 'denominacion'];
const ALIAS_TIPO_COMPROB   = ['tipo de comprobante', 'tipo comprobante', 'tipo'];
const ALIAS_PUNTO_VENTA    = ['punto de venta', 'punto venta'];
const ALIAS_NUMERO_COMPROB = ['numero desde', 'nro desde', 'numero', 'nro comprobante', 'numero comprobante'];
const ALIAS_FECHA          = ['fecha de emision', 'fecha emision', 'fecha'];
const ALIAS_MONEDA         = ['moneda'];
const ALIAS_IMPORTE_TOTAL  = ['imp total', 'importe total', 'imp. total', 'total'];

// Códigos de tipo de comprobante de AFIP/ARCA (tabla pública y estable) — solo para mostrar
// una etiqueta legible en la UI. Si aparece un código que no está acá, se muestra el código tal cual.
const TIPO_COMPROBANTE_LABEL = {
  '1': 'Factura A', '2': 'Nota de Débito A', '3': 'Nota de Crédito A',
  '6': 'Factura B', '7': 'Nota de Débito B', '8': 'Nota de Crédito B',
  '11': 'Factura C', '12': 'Nota de Débito C', '13': 'Nota de Crédito C',
  '19': 'Factura E', '20': 'Nota de Débito E', '21': 'Nota de Crédito E',
  '51': 'Factura M', '52': 'Nota de Débito M', '53': 'Nota de Crédito M',
  '81': 'Tique Factura A', '82': 'Tique Factura B', '83': 'Tique',
};

export function labelTipoComprobante(codigo) {
  return TIPO_COMPROBANTE_LABEL[String(codigo).trim()] || String(codigo || '—');
}

// ── Normalización de headers (minúsculas, sin acentos, sin puntuación) ──────
function normalizar(s) {
  return (s || '')
    .toString()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // saca acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function buscarColumna(headersNorm, alias) {
  const idx = headersNorm.findIndex(h => alias.includes(h));
  return idx;
}

// ── Parser de línea delimitada con soporte de comillas ("campo con ; adentro") ──
function parsearLinea(linea, separador) {
  const campos = [];
  let actual = '';
  let entreComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (entreComillas) {
      if (c === '"') {
        if (linea[i + 1] === '"') { actual += '"'; i++; }
        else entreComillas = false;
      } else {
        actual += c;
      }
    } else if (c === '"') {
      entreComillas = true;
    } else if (c === separador) {
      campos.push(actual);
      actual = '';
    } else {
      actual += c;
    }
  }
  campos.push(actual);
  return campos.map(c => c.trim());
}

function detectarSeparador(lineaHeader) {
  const nPuntoYComa = (lineaHeader.match(/;/g) || []).length;
  const nComa       = (lineaHeader.match(/,/g) || []).length;
  return nPuntoYComa >= nComa ? ';' : ',';
}

// ── Fecha → YYYY-MM-DD. Acepta ISO (2026-05-01) o DD/MM/YYYY ────────────────
function normalizarFecha(f) {
  const s = (f || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; // ya viene en ISO
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (!m) return null;
  const [, d, mes, a] = m;
  return `${a}-${mes.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

// ── Importe con formato argentino ("15.234,56") → number ───────────────────
function normalizarImporte(s) {
  if (s == null || s === '') return null;
  const limpio = s.toString().trim().replace(/\./g, '').replace(',', '.');
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

// ── Normaliza un CUIT a solo dígitos ─────────────────────────────────────────
function normalizarCuit(s) {
  return (s || '').toString().replace(/\D/g, '');
}

/**
 * Parsea el texto del archivo de Comprobantes Recibidos de ARCA.
 * Devuelve: [{ cuit, razonSocial, tipoComprobante, puntoVenta, numeroComprobante, fechaEmision, moneda, importeTotal }]
 * cuit/razonSocial son los del EMISOR (el proveedor que facturó), no los de la empresa receptora.
 * Tira un Error con mensaje claro si no puede reconocer las columnas mínimas.
 */
export function parsearArchivoARCA(texto) {
  const limpio = (texto || '').replace(/^﻿/, ''); // saca el BOM si lo trae
  const lineas = limpio.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lineas.length < 2) {
    throw new Error('El archivo está vacío o no tiene filas de datos.');
  }

  const separador = detectarSeparador(lineas[0]);
  const headers = parsearLinea(lineas[0], separador);
  const headersNorm = headers.map(normalizar);

  const idx = {
    cuit:      buscarColumna(headersNorm, ALIAS_CUIT),
    razon:     buscarColumna(headersNorm, ALIAS_RAZON_SOCIAL),
    tipo:      buscarColumna(headersNorm, ALIAS_TIPO_COMPROB),
    ptoVenta:  buscarColumna(headersNorm, ALIAS_PUNTO_VENTA),
    numero:    buscarColumna(headersNorm, ALIAS_NUMERO_COMPROB),
    fecha:     buscarColumna(headersNorm, ALIAS_FECHA),
    moneda:    buscarColumna(headersNorm, ALIAS_MONEDA),
    total:     buscarColumna(headersNorm, ALIAS_IMPORTE_TOTAL),
  };

  if (idx.cuit === -1 || idx.fecha === -1 || idx.numero === -1) {
    throw new Error(
      'No se pudo interpretar el archivo — verificá que sea el de "Comprobantes Recibidos" de ARCA. ' +
      'No se encontraron las columnas de CUIT del emisor, fecha y/o número de comprobante.'
    );
  }

  const filas = [];
  for (let i = 1; i < lineas.length; i++) {
    const campos = parsearLinea(lineas[i], separador);
    if (!campos.some(c => c !== '')) continue; // fila vacía

    const cuit = normalizarCuit(campos[idx.cuit]);
    const fechaEmision = normalizarFecha(campos[idx.fecha]);
    const numeroComprobante = (campos[idx.numero] || '').trim();

    if (!cuit || !fechaEmision || !numeroComprobante) continue; // fila incompleta, se omite

    filas.push({
      cuit,
      razonSocial:        idx.razon    !== -1 ? campos[idx.razon].trim()    : '',
      tipoComprobante:    idx.tipo     !== -1 ? campos[idx.tipo].trim()     : '',
      puntoVenta:         idx.ptoVenta !== -1 ? campos[idx.ptoVenta].trim() : '',
      numeroComprobante,
      fechaEmision,
      moneda:             idx.moneda   !== -1 ? campos[idx.moneda].trim()  : '',
      importeTotal:       idx.total    !== -1 ? normalizarImporte(campos[idx.total]) : null,
    });
  }

  if (filas.length === 0) {
    throw new Error('El archivo tiene columnas reconocibles pero ninguna fila con datos completos (CUIT, fecha y número de comprobante).');
  }

  return filas;
}
