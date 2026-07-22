// Autorización de Facturas (ARCA) → Autorizar.
// Cola de revisión factura por factura: compara contra el mes anterior del mismo proveedor,
// muestra el historial de ese proveedor, y permite Autorizar / Dejar en revisión / Rechazar
// desde una ventana emergente que además permite dejar una observación.
// Queda registrado quién tomó la acción (usuario logueado) y cuándo.
//
// "En revisión" NO es un estado que saca al comprobante de la cola de pendientes — es lo
// mismo que "pendiente" (sigue esperando una decisión final), con la diferencia de que
// queda con una observación adjunta. Solo "Autorizado" y "Rechazado" salen de "Pendientes".

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';
import { e, errHtml, fmtFecha, v, ESTADOS_AUTORIZACION as ESTADOS } from './venc-comun.js';
import { labelTipoComprobante } from '../data/parser-arca.js';
import { obtenerUsuario } from '../data/usuario-activo.js';

const HDR_SB   = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
const HDR_JSON = { ...HDR_SB, 'Content-Type': 'application/json' };

// Estados que siguen contando como "pendiente de decisión final" para filtros/contadores.
function esPendiente(c) {
  const est = c.estado_autorizacion || 'pendiente';
  return est === 'pendiente' || est === 'en_revision';
}

function periodoDe(fecha) { return fecha.slice(0, 7); }

function mesAnteriorDe(periodo) {
  const [y, m] = periodo.split('-').map(Number);
  const d = new Date(y, m - 2, 1); // m es 1-indexado: m-1 = mes actual (0-indexado), -1 más = mes anterior
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// cuit → periodo (YYYY-MM) → total importe ese mes
function totalesPorProveedorYMes(comprobantes) {
  const mapa = new Map();
  comprobantes.forEach(c => {
    const periodo = periodoDe(c.fecha_emision);
    if (!mapa.has(c.cuit)) mapa.set(c.cuit, new Map());
    const m = mapa.get(c.cuit);
    m.set(periodo, (m.get(periodo) ?? 0) + (Number(c.importe_total) || 0));
  });
  return mapa;
}

function calcularVariacion(comprobante, totales) {
  const periodoAnt = mesAnteriorDe(periodoDe(comprobante.fecha_emision));
  const totalAnterior = totales.get(comprobante.cuit)?.get(periodoAnt);
  if (!totalAnterior) return null;
  const actual = Number(comprobante.importe_total) || 0;
  return ((actual - totalAnterior) / totalAnterior) * 100;
}

function variacionHtml(variacion) {
  if (variacion == null) return `<span class="venc__td-muted">Sin datos del mes anterior</span>`;
  const signo = variacion > 0 ? '+' : '';
  const cls = variacion > 0 ? 'arca-aut__var--suba' : variacion < 0 ? 'arca-aut__var--baja' : 'arca-aut__var--igual';
  return `<span class="arca-aut__var ${cls}">${signo}${variacion.toFixed(1)}% vs. mes anterior</span>`;
}

// Últimos comprobantes del mismo proveedor (excluyendo el actual), para dar contexto histórico.
function obtenerHistorial(c, comprobantes) {
  return comprobantes
    .filter(h => h.cuit === c.cuit && h.id !== c.id)
    .sort((a, b) => b.fecha_emision.localeCompare(a.fecha_emision))
    .slice(0, 12);
}

function historialListHtml(historialItems, totales) {
  if (historialItems.length === 0) return `<p class="venc__td-muted">Sin otros comprobantes de este proveedor.</p>`;
  return historialItems.map(h => `
    <div class="arca-aut__hist-item">
      <span>${fmtFecha(h.fecha_emision)}</span>
      <span class="venc__td-muted">${e(labelTipoComprobante(h.tipo_comprobante))} ${e(h.punto_venta)}-${e(h.numero_comprobante)}</span>
      <span>$${h.importe_total != null ? Number(h.importe_total).toLocaleString('es-AR') : '—'}</span>
      ${variacionHtml(calcularVariacion(h, totales))}
      <span class="venc__badge ${(ESTADOS[h.estado_autorizacion] ?? ESTADOS.pendiente).cls}">${(ESTADOS[h.estado_autorizacion] ?? ESTADOS.pendiente).label}</span>
    </div>`).join('');
}

export async function renderizarArcaAutorizar(contenedor) {
  contenedor.innerHTML = `<p class="plantel__cargando">Cargando comprobantes…</p>`;

  let comprobantes = [];
  let totales       = new Map();
  let autorizadorPorCuit = new Map();
  let filtroProveedor = '';
  let filtroEstado    = 'pendiente';
  let expandidoId     = null;
  let toastTimer      = null;

  async function cargar() {
    try {
      const [comps, proveedores, perfiles] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/arca_comprobantes?order=fecha_emision.desc`, { headers: HDR_SB })
          .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }),
        fetch(`${SUPABASE_URL}/rest/v1/arca_proveedores?select=cuit,autorizador_default_id`, { headers: HDR_SB }).then(r => r.ok ? r.json() : []),
        fetch(`${SUPABASE_URL}/rest/v1/perfiles_rrhh?select=id,nombre`, { headers: HDR_SB }).then(r => r.ok ? r.json() : []),
      ]);
      comprobantes = comps;
      const nombrePorId = new Map(perfiles.map(p => [p.id, p.nombre]));
      autorizadorPorCuit = new Map(
        proveedores.filter(p => p.autorizador_default_id).map(p => [p.cuit, nombrePorId.get(p.autorizador_default_id)])
      );
    } catch {
      contenedor.innerHTML = errHtml('No se pudieron cargar los comprobantes.');
      return;
    }
    totales = totalesPorProveedorYMes(comprobantes);
    renderVista();
  }

  function proveedoresUnicos() {
    const mapa = new Map();
    comprobantes.forEach(c => { if (!mapa.has(c.cuit)) mapa.set(c.cuit, c.razon_social || c.cuit); });
    return [...mapa.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }

  function renderVista() {
    if (comprobantes.length === 0) {
      contenedor.innerHTML = `
        <div class="venc">
          <div class="estado-vacio">
            <h3 class="estado-vacio__titulo">Sin comprobantes importados</h3>
            <p class="estado-vacio__texto">Importá comprobantes en la pestaña "Importar comprobantes" para poder autorizarlos acá.</p>
          </div>
        </div>`;
      return;
    }

    const filtrados = comprobantes.filter(c =>
      (!filtroProveedor || c.cuit === filtroProveedor) &&
      (filtroEstado === 'todos' || (filtroEstado === 'pendiente' ? esPendiente(c) : (c.estado_autorizacion || 'pendiente') === filtroEstado))
    );

    const nPendientes = comprobantes.filter(esPendiente).length;

    contenedor.innerHTML = `
      <div class="venc">
        <div class="venc__toolbar">
          <div class="venc__resumen">
            ${nPendientes
              ? `<span class="venc__pill venc__pill--naranja">${nPendientes} pendiente${nPendientes!==1?'s':''} de revisar</span>`
              : `<span class="venc__pill venc__pill--verde">No hay pendientes</span>`}
            <span class="venc__pill venc__pill--gris">${comprobantes.length} comprobante${comprobantes.length!==1?'s':''} en total</span>
          </div>
        </div>

        <div class="venc__row2" style="margin-bottom:16px;">
          <div>
            <label class="venc__label">Proveedor</label>
            <select class="venc__input" id="aut-filtro-prov">
              <option value="">Todos</option>
              ${proveedoresUnicos().map(([cuit, nombre]) => `<option value="${e(cuit)}" ${filtroProveedor===cuit?'selected':''}>${e(nombre)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="venc__label">Estado</label>
            <select class="venc__input" id="aut-filtro-estado">
              <option value="pendiente" ${filtroEstado==='pendiente'?'selected':''}>Pendientes</option>
              <option value="autorizado" ${filtroEstado==='autorizado'?'selected':''}>Autorizados</option>
              <option value="rechazado" ${filtroEstado==='rechazado'?'selected':''}>Rechazados</option>
              <option value="todos" ${filtroEstado==='todos'?'selected':''}>Todos</option>
            </select>
          </div>
        </div>

        ${filtrados.length === 0
          ? `<p class="venc__vacio">No hay comprobantes que coincidan con el filtro.</p>`
          : `<div class="arca-aut__lista">${filtrados.map(tarjeta).join('')}</div>`}
      </div>`;

    contenedor.querySelector('#aut-filtro-prov').addEventListener('change', ev => { filtroProveedor = ev.target.value; renderVista(); });
    contenedor.querySelector('#aut-filtro-estado').addEventListener('change', ev => { filtroEstado = ev.target.value; renderVista(); });

    contenedor.querySelectorAll('[data-revisar]').forEach(b =>
      b.addEventListener('click', () => abrirModalRevisar(comprobantes.find(c => String(c.id) === b.dataset.revisar)))
    );
    contenedor.querySelectorAll('[data-historial]').forEach(b =>
      b.addEventListener('click', () => { expandidoId = expandidoId === b.dataset.historial ? null : b.dataset.historial; renderVista(); })
    );
  }

  function tarjeta(c) {
    const estado = ESTADOS[c.estado_autorizacion] ?? ESTADOS.pendiente;
    const variacion = calcularVariacion(c, totales);
    const expandido = expandidoId === String(c.id);

    const historialItems = obtenerHistorial(c, comprobantes);

    return `
      <div class="arca-aut__card">
        <div class="arca-aut__card-top">
          <div class="arca-aut__card-info">
            <span class="venc-res__tipo venc-res__tipo--factura">${e(labelTipoComprobante(c.tipo_comprobante))}</span>
            <strong>${e(c.razon_social) || 'Proveedor sin nombre'}</strong>
            <span class="venc__td-muted">${e(c.cuit)}</span>
          </div>
          <span class="venc__badge ${estado.cls}">${estado.label}</span>
        </div>

        <div class="arca-aut__card-datos">
          <span>${e(c.punto_venta)}-${e(c.numero_comprobante)}</span>
          <span>${fmtFecha(c.fecha_emision)}</span>
          <span class="arca-aut__monto">$${c.importe_total != null ? Number(c.importe_total).toLocaleString('es-AR') : '—'}</span>
          ${variacionHtml(variacion)}
        </div>

        ${autorizadorPorCuit.get(c.cuit) ? `<p class="venc__ayuda">👤 Debería autorizar: <strong>${e(autorizadorPorCuit.get(c.cuit))}</strong></p>` : ''}
        ${c.observacion ? `<p class="venc__ayuda">📝 ${e(c.observacion)}</p>` : ''}
        ${c.revisado_por ? `<p class="venc__ayuda">Revisado por <strong>${e(c.revisado_por)}</strong>${c.revisado_en ? ' · ' + new Date(c.revisado_en).toLocaleString('es-AR') : ''}</p>` : ''}

        <div class="arca-aut__card-acciones">
          <button class="venc__btn-pri" data-revisar="${c.id}">Revisar</button>
          <button class="arca-aut__btn-historial" data-historial="${c.id}">${expandido ? 'Ocultar historial' : `Ver historial (${historialItems.length})`}</button>
        </div>

        ${expandido ? `
          <div class="arca-aut__historial">
            ${historialListHtml(historialItems, totales)}
          </div>
        ` : ''}
      </div>`;
  }

  // ── Ventana emergente: elegir Autorizar / En revisión / Rechazar + observación ──
  function abrirModalRevisar(c) {
    if (!c) return;
    document.getElementById('arca-aut-modal')?.remove();

    let accionElegida = ['autorizado', 'en_revision', 'rechazado'].includes(c.estado_autorizacion) ? c.estado_autorizacion : null;
    const variacion = calcularVariacion(c, totales);
    const historialItems = obtenerHistorial(c, comprobantes);

    const modal = document.createElement('div');
    modal.id        = 'arca-aut-modal';
    modal.className = 'venc__modal-overlay';
    modal.innerHTML = `
      <div class="venc__modal" role="dialog" aria-modal="true">
        <h3 class="venc__modal-titulo">Revisar comprobante</h3>
        <p class="venc__ayuda">${e(c.razon_social) || 'Proveedor sin nombre'} · ${e(labelTipoComprobante(c.tipo_comprobante))} ${e(c.punto_venta)}-${e(c.numero_comprobante)} · ${fmtFecha(c.fecha_emision)}</p>
        <p class="arca-aut__monto" style="margin-top:6px;">$${c.importe_total != null ? Number(c.importe_total).toLocaleString('es-AR') : '—'} <span style="font-weight:400;">— ${variacionHtml(variacion)}</span></p>
        ${autorizadorPorCuit.get(c.cuit) ? `<p class="venc__ayuda">👤 Debería autorizar: <strong>${e(autorizadorPorCuit.get(c.cuit))}</strong></p>` : ''}

        <h4 class="venc__seccion-h" style="margin-top:16px;">Historial de este proveedor (${historialItems.length})</h4>
        <div class="arca-aut__historial" style="border-top:none;padding-top:0;margin-top:6px;max-height:180px;overflow-y:auto;">
          ${historialListHtml(historialItems, totales)}
        </div>

        <label class="venc__label">Acción *</label>
        <div class="arca-aut__card-acciones" id="am-acciones" style="margin-top:4px;">
          <button type="button" class="arca-aut__btn arca-aut__btn--autorizar ${accionElegida==='autorizado'?'arca-aut__btn--activo':''}" data-elegir="autorizado">Autorizar</button>
          <button type="button" class="arca-aut__btn arca-aut__btn--revision ${accionElegida==='en_revision'?'arca-aut__btn--activo':''}" data-elegir="en_revision">Dejar en revisión</button>
          <button type="button" class="arca-aut__btn arca-aut__btn--rechazar ${accionElegida==='rechazado'?'arca-aut__btn--activo':''}" data-elegir="rechazado">Rechazar</button>
        </div>

        <label class="venc__label">Observación</label>
        <textarea class="venc__textarea" id="am-observacion" rows="3" placeholder="Opcional — se guarda junto con la decisión">${e(c.observacion)}</textarea>

        <div class="venc__modal-footer">
          <button class="venc__btn-sec" id="am-cancel">Cancelar</button>
          <button class="venc__btn-pri" id="am-ok" ${accionElegida ? '' : 'disabled'}>Guardar</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    modal.querySelectorAll('[data-elegir]').forEach(b => {
      b.addEventListener('click', () => {
        accionElegida = b.dataset.elegir;
        modal.querySelectorAll('[data-elegir]').forEach(x => x.classList.toggle('arca-aut__btn--activo', x === b));
        modal.querySelector('#am-ok').disabled = false;
      });
    });

    const sc = document.querySelector('.app-contenido');
    if (sc) sc.style.overflow = 'hidden';
    const cerrar = () => { modal.remove(); if (sc) sc.style.overflow = ''; };
    modal.addEventListener('click', ev => { if (ev.target === modal) cerrar(); });
    modal.querySelector('#am-cancel').addEventListener('click', cerrar);
    modal.querySelector('#am-ok').addEventListener('click', () => {
      if (!accionElegida) return;
      aplicarAccion(c.id, accionElegida, v('am-observacion') || null, cerrar);
    });
  }

  async function aplicarAccion(id, accion, observacion, cerrar) {
    const usuario = obtenerUsuario();
    const btn = document.getElementById('am-ok');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/arca_comprobantes?id=eq.${id}`, {
        method: 'PATCH', headers: { ...HDR_JSON, Prefer: 'return=minimal' },
        body: JSON.stringify({
          estado_autorizacion: accion,
          observacion,
          revisado_por: usuario?.nombre ?? null,
          revisado_en: new Date().toISOString(),
        }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      cerrar();
      await cargar();
      toast(ESTADOS[accion].label);
    } catch {
      toast('Error al actualizar el estado', 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Guardar'; }
    }
  }

  function toast(msg, tipo = '') {
    let t = contenedor.querySelector('.venc__toast');
    if (!t) { t = document.createElement('div'); t.className = 'venc__toast'; contenedor.appendChild(t); }
    t.textContent = msg;
    t.className = `venc__toast venc__toast--show${tipo ? ' venc__toast--' + tipo : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'venc__toast'; }, 3200);
  }

  await cargar();
}
