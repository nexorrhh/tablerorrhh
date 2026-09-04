// Autorización de Facturas (ARCA) → Importar comprobantes.
// Sube el archivo de "Comprobantes Recibidos" de ARCA (CSV), lo filtra contra los proveedores
// activos en seguimiento, y guarda el histórico en Supabase (upsert por comprobante).

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';
import { parsearArchivoARCA, labelTipoComprobante } from '../data/parser-arca.js';
import { e as eP } from './venc-comun.js';

const HDR_JSON = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
};
const HDR_SB = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };

// Recién a partir de esta fecha se generan vencimientos de pago automáticos al importar.
// Antes de esto la empresa no usaba este sistema, así que no tiene sentido crear vencimientos
// "vencidos" retroactivos para facturas viejas que en la realidad ya se pagaron. Para cambiar
// la fecha de corte alcanza con editar esta constante.
const FECHA_DESDE_GENERAR_PAGOS = '2026-08-01';

async function obtenerProveedoresActivos() {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/arca_proveedores?activo=eq.true&select=id,cuit,razon_social,dias_plazo_pago`, { headers: HDR_SB });
  if (!r.ok) throw new Error('No se pudo obtener la lista de proveedores en seguimiento.');
  return r.json();
}

// Completa la razón social de los proveedores que todavía no la tienen, usando lo que
// trajo el archivo de ARCA para ese CUIT (así el alta de proveedor solo necesita el CUIT).
async function actualizarRazonesSocialesDetectadas(detecciones) {
  for (const { id, razonSocial } of detecciones) {
    await fetch(`${SUPABASE_URL}/rest/v1/arca_proveedores?id=eq.${id}`, {
      method: 'PATCH', headers: { ...HDR_JSON, Prefer: 'return=minimal' },
      body: JSON.stringify({ razon_social: razonSocial }),
    });
  }
}

// Guarda (upsert) los comprobantes y devuelve las filas guardadas, con su id — se necesita
// para poder vincular cada comprobante con el vencimiento de pago que se genera a partir de él.
async function guardarComprobantes(filas) {
  const BATCH = 500;
  const guardadas = [];
  for (let i = 0; i < filas.length; i += BATCH) {
    const lote = filas.slice(i, i + BATCH);
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/arca_comprobantes?on_conflict=cuit,punto_venta,numero_comprobante,tipo_comprobante`,
      { method: 'POST', headers: { ...HDR_JSON, Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(lote) }
    );
    if (!r.ok) {
      const detalle = await r.text().catch(() => '');
      throw new Error(`Error al guardar comprobantes (HTTP ${r.status})${detalle ? ': ' + detalle.slice(0, 200) : ''}`);
    }
    guardadas.push(...await r.json());
  }
  return guardadas;
}

function sumarDias(fechaISO, dias) {
  const d = new Date(fechaISO + 'T00:00:00');
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

// Genera un vencimiento a pagar (pagos_vencimiento) por cada comprobante de un proveedor que
// tenga configurado un plazo de pago, vinculándolo por origen_comprobante_id para no duplicar
// si el mismo comprobante se vuelve a importar más adelante.
async function generarPagosDesdeComprobantes(comprobantesGuardados, plazoPorCuit) {
  const candidatos = comprobantesGuardados.filter(c =>
    plazoPorCuit.get(c.cuit) != null && c.fecha_emision >= FECHA_DESDE_GENERAR_PAGOS
  );
  if (!candidatos.length) return 0;

  const ids = candidatos.map(c => c.id);
  const existentes = await fetch(
    `${SUPABASE_URL}/rest/v1/pagos_vencimiento?origen_comprobante_id=in.(${ids.join(',')})&select=origen_comprobante_id`,
    { headers: HDR_SB }
  ).then(r => r.ok ? r.json() : []);
  const yaTienenPago = new Set(existentes.map(x => x.origen_comprobante_id));

  const nuevos = candidatos
    .filter(c => !yaTienenPago.has(c.id))
    .map(c => ({
      tipo: 'factura',
      empresa: 'CIMOMET', // el CUIT de ARCA que se trackea hoy es el de Cimomet S.A.
      concepto: c.razon_social || c.cuit,
      numero_referencia: `${labelTipoComprobante(c.tipo_comprobante)} ${c.punto_venta}-${c.numero_comprobante}`,
      periodo: c.fecha_emision.slice(0, 7),
      monto: c.importe_total,
      fecha_vencimiento: sumarDias(c.fecha_emision, plazoPorCuit.get(c.cuit)),
      pagado: false,
      origen_comprobante_id: c.id,
    }));

  if (!nuevos.length) return 0;

  const BATCH = 500;
  for (let i = 0; i < nuevos.length; i += BATCH) {
    const lote = nuevos.slice(i, i + BATCH);
    const r = await fetch(`${SUPABASE_URL}/rest/v1/pagos_vencimiento`, {
      method: 'POST', headers: HDR_JSON, body: JSON.stringify(lote),
    });
    if (!r.ok) throw new Error('Error al generar los vencimientos de pago (HTTP ' + r.status + ')');
  }
  return nuevos.length;
}

export async function renderizarArcaImportar(contenedor) {
  let datosParseados = null; // { matcheadas, cuitsNoTrackeados }

  contenedor.innerHTML = `
    <div class="pres__carga-wrap">
      <div class="pres__carga-cabecera">
        <h2 class="pres__titulo">Importar comprobantes de ARCA</h2>
        <p class="pres__subtitulo">Subí el archivo CSV de <strong>"Comprobantes Recibidos"</strong> descargado de ARCA (Mis Comprobantes → Recibidos → Consulta CSV). Solo se importan los comprobantes de proveedores activos en la pestaña "Proveedores".</p>
      </div>

      <div class="pres__carga-zona" id="arca-zona">
        <input type="file" id="arca-file" accept=".csv,.txt" class="pres__file-input">
        <label for="arca-file" class="pres__file-label">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          <span>Hacé clic para seleccionar el archivo</span>
          <span class="pres__file-hint">.csv exportado desde ARCA</span>
        </label>
      </div>

      <div id="arca-estado" class="pres__estado" style="display:none"></div>
      <div id="arca-preview" style="display:none"></div>
    </div>
  `;

  const fileInput  = contenedor.querySelector('#arca-file');
  const estadoDiv  = contenedor.querySelector('#arca-estado');
  const previewDiv = contenedor.querySelector('#arca-preview');
  const zonaDiv    = contenedor.querySelector('#arca-zona');

  zonaDiv.addEventListener('dragover',  ev => { ev.preventDefault(); zonaDiv.classList.add('pres__carga-zona--drag'); });
  zonaDiv.addEventListener('dragleave', ()  => zonaDiv.classList.remove('pres__carga-zona--drag'));
  zonaDiv.addEventListener('drop', ev => {
    ev.preventDefault();
    zonaDiv.classList.remove('pres__carga-zona--drag');
    const f = ev.dataTransfer.files[0];
    if (f) procesarArchivo(f);
  });
  fileInput.addEventListener('change', ev => { if (ev.target.files[0]) procesarArchivo(ev.target.files[0]); });

  function leerArchivo(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = ev => resolve(ev.target.result);
      reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
      reader.readAsText(file, 'UTF-8');
    });
  }

  async function procesarArchivo(file) {
    estadoDiv.style.display = 'block';
    estadoDiv.innerHTML = '<div class="pres__leyendo">Leyendo archivo…</div>';
    previewDiv.style.display = 'none';
    datosParseados = null;

    try {
      const texto = await leerArchivo(file);
      const filas = parsearArchivoARCA(texto);
      const proveedores = await obtenerProveedoresActivos();
      const porCuit = new Map(proveedores.map(p => [p.cuit, p]));

      // Proveedores sin razón social todavía: se completa con la primera que aparezca en el archivo.
      const deteccionesPorCuit = new Map();
      filas.forEach(f => {
        const prov = porCuit.get(f.cuit);
        if (prov && !prov.razon_social && f.razonSocial && !deteccionesPorCuit.has(f.cuit)) {
          deteccionesPorCuit.set(f.cuit, { id: prov.id, razonSocial: f.razonSocial });
        }
      });

      const matcheadas = filas
        .filter(f => porCuit.has(f.cuit))
        .map(f => ({
          cuit:                f.cuit,
          razon_social:        porCuit.get(f.cuit).razon_social || deteccionesPorCuit.get(f.cuit)?.razonSocial || f.razonSocial || null,
          tipo_comprobante:    f.tipoComprobante || null,
          punto_venta:         f.puntoVenta || null,
          numero_comprobante:  f.numeroComprobante,
          fecha_emision:       f.fechaEmision,
          moneda:              f.moneda || null,
          importe_total:       f.importeTotal,
        }));

      const cuitsNoTrackeados = [...new Set(filas.filter(f => !porCuit.has(f.cuit)).map(f => f.cuit))];
      const detecciones = [...deteccionesPorCuit.values()];
      const plazoPorCuit = new Map(proveedores.map(p => [p.cuit, p.dias_plazo_pago]));

      datosParseados = { matcheadas, cuitsNoTrackeados, totalFilas: filas.length, detecciones, plazoPorCuit };
      mostrarPreview(datosParseados);
    } catch (err) {
      estadoDiv.innerHTML = `<div class="pres__msg-error">${eP(err.message)}</div>`;
    }
  }

  function mostrarPreview({ matcheadas, cuitsNoTrackeados, totalFilas, detecciones, plazoPorCuit }) {
    const nConPlazo = matcheadas.filter(m =>
      plazoPorCuit.get(m.cuit) != null && m.fecha_emision >= FECHA_DESDE_GENERAR_PAGOS
    ).length;

    estadoDiv.innerHTML = `
      <div class="pres__msg-ok">✓ Archivo leído correctamente — ${totalFilas} comprobante${totalFilas!==1?'s':''} en el archivo</div>
      ${detecciones.length ? `<div class="pres__msg-ok">✓ Se va a completar la razón social de ${detecciones.length} proveedor${detecciones.length!==1?'es':''} nuevo${detecciones.length!==1?'s':''}</div>` : ''}
      ${nConPlazo ? `<div class="pres__msg-ok">✓ Se van a generar ${nConPlazo} vencimiento${nConPlazo!==1?'s':''} de pago automáticamente (según el plazo configurado de cada proveedor)</div>` : ''}
    `;

    if (matcheadas.length === 0) {
      previewDiv.style.display = 'block';
      previewDiv.innerHTML = `<p class="venc__vacio">Ninguno de los comprobantes del archivo pertenece a un proveedor activo en seguimiento. Revisá la pestaña "Proveedores" o el CUIT del archivo.</p>`;
      return;
    }

    previewDiv.style.display = 'block';
    previewDiv.innerHTML = `
      <div class="pres__preview-kpis">
        <div class="pres__preview-kpi">
          <span class="pres__preview-kpi-num">${matcheadas.length}</span>
          <span class="pres__preview-kpi-lbl">comprobantes a importar</span>
        </div>
        <div class="pres__preview-kpi">
          <span class="pres__preview-kpi-num">${new Set(matcheadas.map(m => m.cuit)).size}</span>
          <span class="pres__preview-kpi-lbl">proveedores trackeados</span>
        </div>
        <div class="pres__preview-kpi">
          <span class="pres__preview-kpi-num">${cuitsNoTrackeados.length}</span>
          <span class="pres__preview-kpi-lbl">CUIT no trackeados en el archivo</span>
        </div>
      </div>

      <div class="pres__preview-tabla-wrap">
        <table class="pres__preview-tabla">
          <thead><tr><th>Proveedor</th><th>Comprobante</th><th>Fecha</th><th>Importe</th></tr></thead>
          <tbody>
            ${matcheadas.slice(0, 15).map(m => `
              <tr>
                <td>${eP(m.razon_social)}</td>
                <td>${eP(labelTipoComprobante(m.tipo_comprobante))} ${eP(m.punto_venta)}-${eP(m.numero_comprobante)}</td>
                <td>${m.fecha_emision}</td>
                <td>${m.importe_total != null ? '$' + Number(m.importe_total).toLocaleString('es-AR') : '—'}</td>
              </tr>
            `).join('')}
            ${matcheadas.length > 15 ? `<tr><td colspan="4" class="pres__preview-mas">… y ${matcheadas.length - 15} más</td></tr>` : ''}
          </tbody>
        </table>
      </div>

      <div class="pres__carga-acciones">
        <button class="pres__btn-cancelar" id="arca-cancelar" type="button">Cancelar</button>
        <button class="pres__btn-confirmar" id="arca-confirmar" type="button">Importar ${matcheadas.length} comprobante${matcheadas.length!==1?'s':''}</button>
      </div>
    `;

    previewDiv.querySelector('#arca-cancelar').addEventListener('click', () => {
      previewDiv.style.display = 'none';
      estadoDiv.style.display  = 'none';
      fileInput.value = '';
      datosParseados  = null;
    });
    previewDiv.querySelector('#arca-confirmar').addEventListener('click', confirmarCarga);
  }

  async function confirmarCarga() {
    if (!datosParseados) return;
    const btnOk  = previewDiv.querySelector('#arca-confirmar');
    const btnCan = previewDiv.querySelector('#arca-cancelar');
    btnOk.disabled = true; btnCan.disabled = true;
    btnOk.textContent = 'Guardando…';

    try {
      const guardadas = await guardarComprobantes(datosParseados.matcheadas);
      if (datosParseados.detecciones.length) await actualizarRazonesSocialesDetectadas(datosParseados.detecciones);
      const nPagos = await generarPagosDesdeComprobantes(guardadas, datosParseados.plazoPorCuit);
      estadoDiv.innerHTML = `<div class="pres__msg-exito">✓ ${datosParseados.matcheadas.length} comprobante${datosParseados.matcheadas.length!==1?'s':''} importado${datosParseados.matcheadas.length!==1?'s':''}.${nPagos ? ` Se generaron ${nPagos} vencimiento${nPagos!==1?'s':''} de pago en "Vencimientos → Pagos".` : ''} Mirá el detalle en "Seguimiento mensual".</div>`;
      previewDiv.style.display = 'none';
      fileInput.value = '';
      datosParseados = null;
    } catch (err) {
      btnOk.disabled = false; btnCan.disabled = false;
      btnOk.textContent = 'Reintentar';
      estadoDiv.innerHTML = `<div class="pres__msg-error">${eP(err.message)}</div>`;
    }
  }
}
