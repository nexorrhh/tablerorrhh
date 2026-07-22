// Autorización de Facturas (ARCA) → Seguimiento mensual.
// Por defecto solo muestra qué proveedores NO facturaron en el mes (para no tapar todo con
// una grilla enorme cuando hay muchos proveedores). La grilla de 12 meses completa queda
// disponible detrás de un botón, y abajo sigue la tabla de detalle filtrable.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';
import { e, errHtml, estadoAutorizacionInfo, crearToast } from './venc-comun.js';
import { labelTipoComprobante } from '../data/parser-arca.js';

const HDR      = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
const HDR_JSON = { ...HDR, 'Content-Type': 'application/json' };

const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const MESES_LARGO = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

// Últimos 12 meses (más viejo → más nuevo), cada uno como { key: 'YYYY-MM', anio, mes }
function ventana12Meses() {
  const hoy = new Date();
  const meses = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    meses.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, anio: d.getFullYear(), mes: d.getMonth() });
  }
  return meses;
}

export async function renderizarArcaSeguimiento(contenedor) {
  contenedor.innerHTML = `<p class="plantel__cargando">Cargando seguimiento…</p>`;

  const meses = ventana12Meses();
  const desde = `${meses[0].key}-01`;

  const [rProv, rComp, rExc] = await Promise.allSettled([
    fetch(`${SUPABASE_URL}/rest/v1/arca_proveedores?order=razon_social.asc`, { headers: HDR }).then(r => r.ok ? r.json() : []),
    fetch(`${SUPABASE_URL}/rest/v1/arca_comprobantes?fecha_emision=gte.${desde}&order=fecha_emision.desc`, { headers: HDR }).then(r => r.ok ? r.json() : []),
    fetch(`${SUPABASE_URL}/rest/v1/arca_seguimiento_excepciones?select=proveedor_id,periodo`, { headers: HDR }).then(r => r.ok ? r.json() : []),
  ]);

  if (rProv.status !== 'fulfilled' || rComp.status !== 'fulfilled') {
    contenedor.innerHTML = errHtml('No se pudo cargar el seguimiento de comprobantes.');
    return;
  }

  const proveedores  = rProv.value;
  const comprobantes = rComp.value;
  // "proveedorId|periodo" → no se espera comprobante de ese proveedor ese mes puntual.
  const excepciones = new Set((rExc.status === 'fulfilled' ? rExc.value : []).map(x => `${x.proveedor_id}|${x.periodo}`));

  if (proveedores.length === 0) {
    contenedor.innerHTML = `
      <div class="venc">
        <div class="estado-vacio">
          <h3 class="estado-vacio__titulo">Sin proveedores en seguimiento</h3>
          <p class="estado-vacio__texto">Agregá proveedores en la pestaña "Proveedores" para poder ver su seguimiento acá.</p>
        </div>
      </div>`;
    return;
  }

  // cuit → periodo (YYYY-MM) → comprobantes[]
  const porCuitPeriodo = new Map();
  comprobantes.forEach(c => {
    const periodo = c.fecha_emision.slice(0, 7);
    if (!porCuitPeriodo.has(c.cuit)) porCuitPeriodo.set(c.cuit, new Map());
    const m = porCuitPeriodo.get(c.cuit);
    if (!m.has(periodo)) m.set(periodo, []);
    m.get(periodo).push(c);
  });

  let filtroProveedor = '';
  let filtroMes       = '';
  let offsetMesFaltantes = 0;
  let grillaAbierta   = false;
  const toast = crearToast(contenedor);

  // Marca "no se espera comprobante de este proveedor en este mes puntual" — no toca al
  // proveedor en general, solo saca la alerta de faltante para ese mes (útil, por ejemplo,
  // cuando a veces factura otra persona de la familia y ese mes no corresponde reclamarle a él).
  async function noEsperarEsteMes(proveedorId, nombre, periodo, periodoLabel) {
    if (!confirm(`¿Marcar que no se espera un comprobante de "${nombre}" en ${periodoLabel}? Solo afecta a ese mes — si el mes que viene sigue sin facturar, va a volver a aparecer como faltante.`)) return;
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/arca_seguimiento_excepciones`, {
        method: 'POST', headers: { ...HDR_JSON, Prefer: 'return=minimal' },
        body: JSON.stringify({ proveedor_id: +proveedorId, periodo }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      excepciones.add(`${proveedorId}|${periodo}`);
      renderVista();
      toast('Listo, no se va a esperar ese mes', 'ok');
    } catch {
      toast('Error al guardar la excepción', 'error');
    }
  }

  function renderVista() {
    const activos = proveedores.filter(p => p.activo);

    // ── Mes objetivo para "faltantes" (navegable, default mes actual) ──────
    const base = new Date();
    const objetivo = new Date(base.getFullYear(), base.getMonth() + offsetMesFaltantes, 1);
    const keyObjetivo = `${objetivo.getFullYear()}-${String(objetivo.getMonth() + 1).padStart(2, '0')}`;
    const labelObjetivo = `${MESES_LARGO[objetivo.getMonth()]} ${objetivo.getFullYear()}`;

    const faltantes = activos.filter(p =>
      !(porCuitPeriodo.get(p.cuit)?.get(keyObjetivo)?.length > 0) &&
      !excepciones.has(`${p.id}|${keyObjetivo}`)
    );

    // ── Grilla completa (12 meses) ──────────────────────────────────────────
    const filasGrid = activos.map(p => {
      const porPeriodo = porCuitPeriodo.get(p.cuit) ?? new Map();
      const celdas = meses.map(m => {
        const items = porPeriodo.get(m.key) ?? [];
        const cls = items.length > 0 ? 'venc__badge--verde' : 'venc__badge--rojo';
        const txt = items.length > 0 ? String(items.length) : '0';
        return `<td><span class="venc__badge ${cls}" title="${MESES_LARGO[m.mes]} ${m.anio}">${txt}</span></td>`;
      }).join('');
      const nombre = p.razon_social ? e(p.razon_social) : '<span class="venc__td-muted">Pendiente de detectar…</span>';
      return `<tr><td class="venc__td-bold">${nombre}<span class="venc__td-muted"> · ${e(p.cuit)}</span></td>${celdas}</tr>`;
    }).join('');

    const opcionesProveedor = proveedores.map(p => `<option value="${e(p.cuit)}" ${filtroProveedor===p.cuit?'selected':''}>${e(p.razon_social) || p.cuit}</option>`).join('');
    const opcionesMes = meses.slice().reverse().map(m => `<option value="${m.key}" ${filtroMes===m.key?'selected':''}>${MESES_LARGO[m.mes]} ${m.anio}</option>`).join('');

    const detalle = comprobantes.filter(c =>
      (!filtroProveedor || c.cuit === filtroProveedor) &&
      (!filtroMes || c.fecha_emision.slice(0, 7) === filtroMes)
    );

    contenedor.innerHTML = `
      <div class="venc">

        <!-- ── Faltantes del mes (vista compacta por defecto) ── -->
        <div class="venc__seccion">
          <div class="venc-res__calmontos-nav" style="margin-bottom:10px;">
            <button type="button" class="venc-res__calmontos-btn" data-mes-prev title="Mes anterior">‹</button>
            <span class="venc-res__calmontos-titulo">${labelObjetivo}</span>
            <button type="button" class="venc-res__calmontos-btn" data-mes-next title="Mes siguiente">›</button>
            ${offsetMesFaltantes !== 0 ? `<button type="button" class="venc-res__calmontos-hoy" data-mes-hoy>Mes actual</button>` : ''}
          </div>

          ${faltantes.length === 0
            ? `<span class="venc__pill venc__pill--verde">Todos los proveedores activos facturaron en ${labelObjetivo}</span>`
            : `
              <span class="venc__pill venc__pill--rojo" style="margin-bottom:10px;display:inline-block;">${faltantes.length} proveedor${faltantes.length!==1?'es':''} sin comprobantes en ${labelObjetivo}</span>
              <div class="arca-aut__lista">
                ${faltantes.map(p => `
                  <div class="arca-aut__card" style="padding:10px 14px;">
                    <div class="arca-aut__card-top">
                      <div class="arca-aut__card-info">
                        <strong>${p.razon_social ? e(p.razon_social) : 'Proveedor sin nombre'}</strong>
                        <span class="venc__td-muted">${e(p.cuit)}</span>
                      </div>
                      <span class="venc__badge venc__badge--rojo">Sin factura</span>
                    </div>
                    <div class="arca-aut__card-acciones">
                      <button type="button" class="arca-aut__btn arca-aut__btn--rechazar" data-no-esperar="${p.id}" data-nombre="${e(p.razon_social) || e(p.cuit)}">No esperar esta factura este mes</button>
                    </div>
                  </div>`).join('')}
              </div>`}
        </div>

        <!-- ── Grilla completa, colapsada por defecto ── -->
        <div class="venc__seccion">
          <button type="button" class="pres__btn-cancelar" id="arca-toggle-grilla" style="margin-bottom:10px;">
            ${grillaAbierta ? 'Ocultar' : 'Ver'} grilla completa (últimos 12 meses, ${activos.length} proveedor${activos.length!==1?'es':''})
          </button>
          ${grillaAbierta ? `
            <div class="venc__tabla-wrap">
              <table class="venc__tabla">
                <thead><tr>
                  <th>Proveedor</th>
                  ${meses.map(m => `<th>${MESES[m.mes]} ${String(m.anio).slice(2)}</th>`).join('')}
                </tr></thead>
                <tbody>${filasGrid}</tbody>
              </table>
            </div>
          ` : ''}
        </div>

        <div class="venc__seccion">
          <h4 class="venc__seccion-h">Detalle de comprobantes</h4>
          <div class="venc__row2" style="margin-bottom:12px;">
            <div>
              <label class="venc__label">Proveedor</label>
              <select class="venc__input" id="arca-filtro-prov">
                <option value="">Todos</option>
                ${opcionesProveedor}
              </select>
            </div>
            <div>
              <label class="venc__label">Mes</label>
              <select class="venc__input" id="arca-filtro-mes">
                <option value="">Todos</option>
                ${opcionesMes}
              </select>
            </div>
          </div>
          ${detalle.length === 0
            ? `<p class="venc__vacio">No hay comprobantes que coincidan con el filtro.</p>`
            : `<div class="venc__tabla-wrap">
                <table class="venc__tabla">
                  <thead><tr><th>Proveedor</th><th>Comprobante</th><th>Fecha</th><th>Importe</th><th>Estado</th></tr></thead>
                  <tbody>
                    ${detalle.map(c => `
                      <tr>
                        <td>${e(c.razon_social)}</td>
                        <td class="venc__td-muted">${e(labelTipoComprobante(c.tipo_comprobante))} ${e(c.punto_venta)}-${e(c.numero_comprobante)}</td>
                        <td>${c.fecha_emision}</td>
                        <td>${c.importe_total != null ? '$' + Number(c.importe_total).toLocaleString('es-AR') : '—'}</td>
                        <td><span class="venc__badge ${estadoAutorizacionInfo(c.estado_autorizacion).cls}">${estadoAutorizacionInfo(c.estado_autorizacion).label}</span></td>
                      </tr>`).join('')}
                  </tbody>
                </table>
              </div>`}
        </div>
      </div>`;

    contenedor.querySelector('[data-mes-prev]').addEventListener('click', () => { offsetMesFaltantes--; renderVista(); });
    contenedor.querySelector('[data-mes-next]').addEventListener('click', () => { offsetMesFaltantes++; renderVista(); });
    contenedor.querySelector('[data-mes-hoy]')?.addEventListener('click', () => { offsetMesFaltantes = 0; renderVista(); });
    contenedor.querySelector('#arca-toggle-grilla').addEventListener('click', () => { grillaAbierta = !grillaAbierta; renderVista(); });
    contenedor.querySelector('#arca-filtro-prov').addEventListener('change', ev => { filtroProveedor = ev.target.value; renderVista(); });
    contenedor.querySelector('#arca-filtro-mes').addEventListener('change', ev => { filtroMes = ev.target.value; renderVista(); });
    contenedor.querySelectorAll('[data-no-esperar]').forEach(b =>
      b.addEventListener('click', () => noEsperarEsteMes(b.dataset.noEsperar, b.dataset.nombre, keyObjetivo, labelObjetivo))
    );
  }

  renderVista();
}
