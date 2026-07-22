// Vencimientos → Pagos (Administración): facturas e impuestos, unificados en un solo módulo
// porque comparten lo mismo que importa: un monto y una fecha de vencimiento.
// Cuentas por pagar: no confundir con "Autorización de Facturas" (ARCA), que trackea
// comprobantes EMITIDOS por proveedores monitoreados — son cosas distintas.
//
// Soporta vencimientos recurrentes: al crear uno se puede marcar "se repite todos los
// meses". Eso NO copia la fecha ni el monto al mes siguiente (varían mes a mes) — en
// cambio, cada vez que se abre esta pestaña se genera un placeholder "pendiente de cargar"
// para cada mes que falte (con el mismo concepto/tipo/empresa), que aparece primero en la
// lista y marcado como que necesita completarse, para atenderlo cuanto antes.
//
// La lista se agrupa por período (mes) y por defecto solo muestra vencidos y pendientes —
// los pagados quedan ocultos detrás de "Mostrar pagados" para no ensuciar la vista.

import { crearHelpersSupabase, crearToast, dias, badge, esMesActual, fmtFecha, e, v, errHtml, estadoAutorizacionInfo } from './venc-comun.js';

const TABLA = 'pagos_vencimiento';
const { sbGet, sbInsert, sbUpdate, sbDelete } = crearHelpersSupabase(TABLA);

const TABLA_PLANT = 'pagos_recurrentes';
const plant = crearHelpersSupabase(TABLA_PLANT);

const arcaComp = crearHelpersSupabase('arca_comprobantes');

const TIPOS = [
  { valor: 'factura',  label: 'Factura',  labelConcepto: 'Proveedor',        placeholderConcepto: 'Ej: Proveedor S.A.' },
  { valor: 'impuesto', label: 'Impuesto', labelConcepto: 'Impuesto / concepto', placeholderConcepto: 'Ej: IVA' },
];
const CONCEPTOS_SUGERIDOS_IMPUESTO = ['IVA', 'Ganancias', 'Ingresos Brutos', 'Cargas sociales / SUSS', 'Monotributo'];

const EMPRESAS = [
  { valor: 'CIMOMET', label: 'Cimomet S.A.' },
  { valor: 'COMOING', label: 'Co.mo.ing S.R.L.' },
];

const MESES_LARGO = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function infoTipo(t) { return TIPOS.find(x => x.valor === t) ?? TIPOS[0]; }
function labelEmpresa(v) { return EMPRESAS.find(x => x.valor === v)?.label ?? '—'; }

function periodoDe(anio, mesIndice0) { return `${anio}-${String(mesIndice0 + 1).padStart(2, '0')}`; }

function labelPeriodo(periodo) {
  if (!periodo) return 'Sin período';
  const [y, m] = periodo.split('-').map(Number);
  return `${MESES_LARGO[m - 1]} ${y}`;
}

// Cuántos meses de anticipación se generan sobre el mes actual (1 = ya ves el mes que
// viene sin esperar a que empiece, para poder completarlo con anticipación).
const MESES_ADELANTO_RECURRENTES = 1;

// ── Genera un placeholder "pendiente de cargar" por cada mes que falte, para cada
//    plantilla activa. No copia día ni monto — eso lo carga la persona a mano cada mes. ──
async function generarPendientesRecurrentes() {
  let plantillas;
  try { plantillas = await plant.sbGet('activo=eq.true'); } catch { return; }
  if (!plantillas.length) return;

  const hoy = new Date();
  const limiteMes = new Date(hoy.getFullYear(), hoy.getMonth() + MESES_ADELANTO_RECURRENTES, 1);

  for (const pl of plantillas) {
    let ultimas = [];
    try { ultimas = await sbGet(`recurrente_id=eq.${pl.id}&order=periodo.desc&limit=1`); } catch { continue; }

    let cursor;
    if (ultimas.length && ultimas[0].periodo) {
      const [y, m] = ultimas[0].periodo.split('-').map(Number);
      cursor = new Date(y, m, 1); // mes siguiente al último periodo generado
    } else {
      cursor = new Date(limiteMes);
    }

    let generados = 0;
    while (cursor <= limiteMes && generados < 12) {
      const periodo = periodoDe(cursor.getFullYear(), cursor.getMonth());
      try {
        await sbInsert({
          tipo: pl.tipo, concepto: pl.concepto, numero_referencia: null, empresa: pl.empresa,
          periodo, monto: null, fecha_vencimiento: `${periodo}-01`, pagado: false,
          notas: pl.notas, recurrente_id: pl.id, necesita_revision: true,
        });
      } catch { /* si ya existe (choca con la restricción única) u otro error puntual, seguimos con el resto */ }
      generados++;
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }
  }
}

export async function renderizarVencimientosPagos(contenedor) {
  let registros   = [];
  let plantillas  = [];
  let editandoId  = null;
  let estadoArcaPorComprobante = new Map();
  let filtroEmpresa  = '';
  let filtroPeriodo  = '';
  let filtroTexto    = '';
  let mostrarPagados = false;
  const toast     = crearToast(contenedor);

  contenedor.innerHTML = `<p class="plantel__cargando">Cargando facturas e impuestos…</p>`;

  await generarPendientesRecurrentes(); // solo al entrar a la pestaña
  await cargar();

  async function cargar() {
    try {
      const [regs, plants, comprobantesArca] = await Promise.all([
        sbGet('order=periodo.asc,fecha_vencimiento.asc'),
        plant.sbGet('order=concepto.asc'),
        arcaComp.sbGet('select=id,estado_autorizacion'),
      ]);
      registros  = regs;
      plantillas = plants;
      estadoArcaPorComprobante = new Map(comprobantesArca.map(c => [c.id, c.estado_autorizacion]));
    } catch {
      contenedor.innerHTML = errHtml('No se pudieron cargar los pagos.');
      return;
    }
    renderVista();
  }

  function coincideFiltro(r) {
    return (!filtroEmpresa || r.empresa === filtroEmpresa) &&
           (!filtroPeriodo || r.periodo === filtroPeriodo) &&
           (!filtroTexto || r.concepto.toLowerCase().includes(filtroTexto.toLowerCase()));
  }

  function renderVista() {
    const pendientesFiltrados = registros.filter(r => coincideFiltro(r) && !r.pagado && !r.omitido);
    const porCompletar = pendientesFiltrados.filter(r => r.necesita_revision).length;
    const vencidos     = pendientesFiltrados.filter(r => !r.necesita_revision && dias(r.fecha_vencimiento) < 0).length;
    const venceHoy     = pendientesFiltrados.filter(r => !r.necesita_revision && dias(r.fecha_vencimiento) === 0).length;
    const esteMes      = pendientesFiltrados.filter(r => !r.necesita_revision && esMesActual(r.fecha_vencimiento) && dias(r.fecha_vencimiento) > 0).length;
    const totalPend    = pendientesFiltrados.reduce((s, r) => s + (Number(r.monto) || 0), 0);
    const nOcultos     = registros.filter(r => coincideFiltro(r) && (r.pagado || r.omitido)).length;

    const filtrados = registros.filter(r => coincideFiltro(r) && (mostrarPagados || (!r.pagado && !r.omitido)));

    const periodosDisponibles = [...new Set(registros.map(r => r.periodo).filter(Boolean))].sort();

    // ── Agrupar por período (mes), en orden cronológico ──────────────────────
    const porPeriodo = new Map();
    filtrados.forEach(r => {
      const key = r.periodo || 'sin-periodo';
      if (!porPeriodo.has(key)) porPeriodo.set(key, []);
      porPeriodo.get(key).push(r);
    });
    // Dentro de cada mes: primero lo vencido, después lo que vence hoy, después lo próximo,
    // y al final lo que todavía necesita completarse (y lo ya pagado, si se está mostrando).
    function prioridadFila(r) {
      if (r.pagado || r.omitido) return 5;
      if (r.necesita_revision) return 4;
      const d = dias(r.fecha_vencimiento);
      if (d < 0) return 0;
      if (d === 0) return 1;
      return 2;
    }
    porPeriodo.forEach(filas => filas.sort((a, b) =>
      prioridadFila(a) - prioridadFila(b) || a.fecha_vencimiento.localeCompare(b.fecha_vencimiento)
    ));
    const gruposOrdenados = [...porPeriodo.entries()].sort((a, b) => a[0].localeCompare(b[0]));

    contenedor.innerHTML = `
      <div class="venc">
        <div class="venc__toolbar">
          <div class="venc__resumen">
            ${vencidos ? `<span class="venc__pill venc__pill--rojo">${vencidos} vencido${vencidos!==1?'s':''}</span>` : ''}
            ${venceHoy ? `<span class="venc__pill venc__pill--rojo">${venceHoy} vence${venceHoy!==1?'n':''} hoy</span>` : ''}
            ${esteMes ? `<span class="venc__pill venc__pill--naranja">${esteMes} vence${esteMes!==1?'n':''} este mes</span>` : ''}
            ${porCompletar ? `<span class="venc__pill venc__pill--gris">${porCompletar} por completar</span>` : ''}
            ${!porCompletar && !vencidos && !venceHoy && !esteMes ? `<span class="venc__pill venc__pill--verde">Todo al día</span>` : ''}
            <span class="venc__pill venc__pill--gris">${pendientesFiltrados.length} pendiente${pendientesFiltrados.length!==1?'s':''} · $${totalPend.toLocaleString('es-AR')}</span>
          </div>
          <div class="venc__btns">
            <button class="venc__btn-sec" id="venc-recurrentes">🔁 Recurrentes</button>
            <button class="venc__btn-pri" id="venc-nuevo">
              <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Agregar
            </button>
          </div>
        </div>

        <div class="venc-pagos__filtros">
          <div>
            <label class="venc__label">Empresa</label>
            <select class="venc__input" id="pg-filtro-empresa">
              <option value="">Todas las empresas</option>
              ${EMPRESAS.map(x => `<option value="${x.valor}" ${filtroEmpresa===x.valor?'selected':''}>${x.label}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="venc__label">Mes</label>
            <select class="venc__input" id="pg-filtro-periodo">
              <option value="">Todos los meses</option>
              ${periodosDisponibles.map(p => `<option value="${p}" ${filtroPeriodo===p?'selected':''}>${labelPeriodo(p)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="venc__label">Buscar</label>
            <input class="venc__input" id="pg-filtro-texto" type="text" placeholder="Buscar por concepto/proveedor…" value="${e(filtroTexto)}">
          </div>
          <button type="button" class="pres__btn-cancelar" id="pg-toggle-pagados">
            ${mostrarPagados ? 'Ocultar pagados/omitidos' : `Mostrar pagados/omitidos (${nOcultos})`}
          </button>
        </div>

        <div class="venc__seccion">
          ${filtrados.length === 0
            ? `<p class="venc__vacio">No hay pagos que coincidan con el filtro.</p>`
            : `<div class="venc__tabla-wrap">
                <table class="venc__tabla">
                  <thead><tr>
                    <th>Tipo</th><th>Empresa</th><th>Concepto</th><th>Monto</th>
                    <th>Vencimiento</th><th>Estado</th><th>Autorización</th><th></th>
                  </tr></thead>
                  <tbody>
                    ${gruposOrdenados.map(([periodo, filas]) => grupoMesHtml(periodo, filas)).join('')}
                  </tbody>
                </table>
              </div>`}
        </div>
      </div>`;

    contenedor.querySelector('#venc-nuevo').addEventListener('click', () => abrirModal());
    contenedor.querySelector('#venc-recurrentes').addEventListener('click', () => abrirModalRecurrentes());
    contenedor.querySelector('#pg-filtro-empresa').addEventListener('change', ev => { filtroEmpresa = ev.target.value; renderVista(); });
    contenedor.querySelector('#pg-filtro-periodo').addEventListener('change', ev => { filtroPeriodo = ev.target.value; renderVista(); });
    contenedor.querySelector('#pg-filtro-texto').addEventListener('input', ev => { filtroTexto = ev.target.value; renderVista(); });
    contenedor.querySelector('#pg-toggle-pagados').addEventListener('click', () => { mostrarPagados = !mostrarPagados; renderVista(); });
    contenedor.querySelectorAll('[data-editar]').forEach(b =>
      b.addEventListener('click', () => abrirModal(registros.find(r => String(r.id) === b.dataset.editar)))
    );
    contenedor.querySelectorAll('[data-eliminar]').forEach(b =>
      b.addEventListener('click', () => eliminar(b.dataset.eliminar))
    );
    contenedor.querySelectorAll('[data-pagar]').forEach(b =>
      b.addEventListener('click', () => marcarPagado(b.dataset.pagar))
    );
    contenedor.querySelectorAll('[data-omitir]').forEach(b =>
      b.addEventListener('click', () => marcarOmitido(b.dataset.omitir))
    );
    contenedor.querySelectorAll('[data-deshacer-omitido]').forEach(b =>
      b.addEventListener('click', () => deshacerOmitido(b.dataset.deshacerOmitido))
    );
  }

  function grupoMesHtml(periodo, filas) {
    const subtotal = filas.reduce((s, r) => s + (Number(r.monto) || 0), 0);
    return `
      <tr class="venc-pagos__mes-header">
        <td colspan="8">
          <strong>${labelPeriodo(periodo === 'sin-periodo' ? null : periodo)}</strong>
          <span class="venc__td-muted"> · ${filas.length} ítem${filas.length!==1?'s':''} · $${subtotal.toLocaleString('es-AR')}</span>
        </td>
      </tr>
      ${filas.map(fila).join('')}`;
  }

  function fila(r) {
    const recurrenteTag = r.recurrente_id ? ` <span title="Vencimiento recurrente">🔁</span>` : '';
    const celdaAutorizacion = r.origen_comprobante_id
      ? (() => { const info = estadoAutorizacionInfo(estadoArcaPorComprobante.get(r.origen_comprobante_id)); return `<span class="venc__badge ${info.cls}">${info.label}</span>`; })()
      : '<span class="venc__td-muted">No requiere autorización</span>';
    const celdaEmpresa = r.empresa ? `<span class="venc__td-muted">${labelEmpresa(r.empresa)}</span>` : '<span class="venc__td-muted">—</span>';

    if (r.omitido) {
      return `
        <tr>
          <td><span class="venc-res__tipo venc-res__tipo--${r.tipo}">${infoTipo(r.tipo).label}</span></td>
          <td>${celdaEmpresa}</td>
          <td class="venc__td-bold">${e(r.concepto)}${recurrenteTag}</td>
          <td class="venc__td-muted">—</td>
          <td class="venc__td-muted">No corresponde este mes</td>
          <td><span class="venc__badge venc__badge--gris">No corresponde</span></td>
          <td>${celdaAutorizacion}</td>
          <td class="venc__td-acc">
            <button class="venc__btn-icon" data-deshacer-omitido="${r.id}" title="Deshacer (volver a pendiente de cargar)">
              <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
            </button>
            <button class="venc__btn-icon venc__btn-icon--danger" data-eliminar="${r.id}" title="Eliminar">
              <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
            </button>
          </td>
        </tr>`;
    }

    if (r.necesita_revision) {
      return `
        <tr class="venc__fila--vencida">
          <td><span class="venc-res__tipo venc-res__tipo--${r.tipo}">${infoTipo(r.tipo).label}</span></td>
          <td>${celdaEmpresa}</td>
          <td class="venc__td-bold">${e(r.concepto)}${recurrenteTag}</td>
          <td class="venc__td-muted">—</td>
          <td class="venc__td-muted">Pendiente de cargar</td>
          <td><span class="venc__badge venc__badge--rojo">⚠️ Completar datos</span></td>
          <td>${celdaAutorizacion}</td>
          <td class="venc__td-acc">
            <button class="venc__btn-icon" data-editar="${r.id}" title="Completar">
              <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
            </button>
            ${r.recurrente_id ? `
            <button class="venc__btn-icon" data-omitir="${r.id}" title="No corresponde este mes (no se vuelve a generar)">
              <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
            </button>` : ''}
            <button class="venc__btn-icon venc__btn-icon--danger" data-eliminar="${r.id}" title="Eliminar">
              <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
            </button>
          </td>
        </tr>`;
    }

    const d = dias(r.fecha_vencimiento);
    const estaEsteMes = esMesActual(r.fecha_vencimiento);
    let estadoHtml;
    if (r.pagado) {
      estadoHtml = `<span class="venc__badge venc__badge--verde">Pagado</span>`;
    } else {
      const { cls, txt } = badge(d);
      estadoHtml = `<span class="venc__badge ${cls}">${txt}</span>${estaEsteMes && d >= 0 ? ` <span class="venc__badge venc__badge--naranja">Este mes</span>` : ''}`;
    }
    const rowCls = !r.pagado && d < 0 ? 'venc__fila--vencida' : !r.pagado && d <= 30 ? 'venc__fila--proxima' : '';
    return `
      <tr class="${rowCls}">
        <td><span class="venc-res__tipo venc-res__tipo--${r.tipo}">${infoTipo(r.tipo).label}</span></td>
        <td>${celdaEmpresa}</td>
        <td class="venc__td-bold">${e(r.concepto)}${recurrenteTag}</td>
        <td>${r.monto != null ? '$' + Number(r.monto).toLocaleString('es-AR') : '—'}</td>
        <td>${fmtFecha(r.fecha_vencimiento)}</td>
        <td>${estadoHtml}</td>
        <td>${celdaAutorizacion}</td>
        <td class="venc__td-acc">
          ${!r.pagado ? `
          <button class="venc__btn-icon" data-pagar="${r.id}" title="Marcar como pagado">
            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
          </button>` : ''}
          <button class="venc__btn-icon" data-editar="${r.id}" title="Editar">
            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
          </button>
          <button class="venc__btn-icon venc__btn-icon--danger" data-eliminar="${r.id}" title="Eliminar">
            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </td>
      </tr>`;
  }

  function abrirModal(reg = null) {
    editandoId = reg?.id ?? null;
    document.getElementById('venc-modal-pagos')?.remove();

    const tipoInicial = infoTipo(reg?.tipo ?? 'factura');
    const esPlaceholder = !!reg?.necesita_revision;

    const modal = document.createElement('div');
    modal.id        = 'venc-modal-pagos';
    modal.className = 'venc__modal-overlay';
    modal.innerHTML = `
      <div class="venc__modal" role="dialog" aria-modal="true">
        <h3 class="venc__modal-titulo">${reg ? (esPlaceholder ? 'Completar vencimiento' : 'Editar') : 'Nuevo registro'}</h3>
        ${esPlaceholder ? `<p class="venc__ayuda">Este vencimiento recurrente todavía no tiene fecha ni monto cargados para ${labelPeriodo(reg.periodo)}. Completalos acá.</p>` : ''}

        <div class="venc__row2">
          <div>
            <label class="venc__label">Tipo *</label>
            <select class="venc__input" id="vm-tipo">
              ${TIPOS.map(t => `<option value="${t.valor}" ${tipoInicial.valor===t.valor?'selected':''}>${t.label}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="venc__label">Empresa *</label>
            <select class="venc__input" id="vm-empresa">
              ${EMPRESAS.map(x => `<option value="${x.valor}" ${(reg?.empresa ?? 'CIMOMET')===x.valor?'selected':''}>${x.label}</option>`).join('')}
            </select>
          </div>
        </div>

        <label class="venc__label" id="vm-concepto-label">${tipoInicial.labelConcepto} *</label>
        <input class="venc__input" id="vm-concepto" type="text" list="vm-concepto-sugerencias"
               value="${e(reg?.concepto)}" placeholder="${tipoInicial.placeholderConcepto}">
        <datalist id="vm-concepto-sugerencias">
          ${tipoInicial.valor === 'impuesto' ? CONCEPTOS_SUGERIDOS_IMPUESTO.map(c => `<option value="${c}"></option>`).join('') : ''}
        </datalist>

        <label class="venc__label">Monto</label>
        <input class="venc__input" id="vm-monto" type="number" step="0.01" value="${reg?.monto ?? ''}" placeholder="0.00">

        <div class="venc__row2">
          <div>
            <label class="venc__label">Período</label>
            <input class="venc__input" id="vm-periodo" type="month" value="${reg?.periodo || ''}">
          </div>
          <div>
            <label class="venc__label">Fecha de vencimiento *</label>
            <input class="venc__input" id="vm-venc" type="date" value="${esPlaceholder ? '' : (reg?.fecha_vencimiento || '')}">
          </div>
        </div>

        <label class="venc__label">Notas</label>
        <textarea class="venc__textarea" id="vm-notas" rows="2" placeholder="Observaciones opcionales">${e(reg?.notas)}</textarea>

        ${!reg ? `
          <label class="venc__label" style="display:flex;align-items:center;gap:7px;margin-top:14px;">
            <input type="checkbox" id="vm-recurrente" style="width:auto;">
            🔁 Este vencimiento se repite todos los meses
          </label>
          <p class="venc__ayuda">No copia la fecha ni el monto — se genera automáticamente <strong>la próxima vez que alguien abra esta pestaña</strong> (no es por calendario), un registro "por completar" para cada mes nuevo, para que cargues los datos reales de ese mes. Podés desactivarlo después desde "Recurrentes".</p>
        ` : (reg.recurrente_id && !esPlaceholder ? `<p class="venc__ayuda">🔁 Este registro es parte de un vencimiento recurrente. Para dejar de generarlo, andá a "Recurrentes".</p>` : '')}

        <div class="venc__modal-footer">
          <button class="venc__btn-sec" id="vm-cancel">Cancelar</button>
          <button class="venc__btn-pri" id="vm-ok">${reg ? 'Guardar cambios' : 'Agregar'}</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    modal.querySelector('#vm-tipo').addEventListener('change', ev => {
      const info = infoTipo(ev.target.value);
      modal.querySelector('#vm-concepto-label').textContent = info.labelConcepto + ' *';
      modal.querySelector('#vm-concepto').placeholder = info.placeholderConcepto;
      modal.querySelector('#vm-concepto-sugerencias').innerHTML =
        info.valor === 'impuesto' ? CONCEPTOS_SUGERIDOS_IMPUESTO.map(c => `<option value="${c}"></option>`).join('') : '';
    });

    const sc = document.querySelector('.app-contenido');
    if (sc) sc.style.overflow = 'hidden';
    const cerrar = () => { modal.remove(); if (sc) sc.style.overflow = ''; };
    modal.addEventListener('click', ev => { if (ev.target === modal) cerrar(); });
    modal.querySelector('#vm-cancel').addEventListener('click', cerrar);
    modal.querySelector('#vm-ok').addEventListener('click', () => guardar(cerrar));
    setTimeout(() => modal.querySelector('#vm-concepto').focus({ preventScroll: true }), 40);
  }

  async function guardar(cerrar) {
    const tipo       = v('vm-tipo');
    const empresa    = v('vm-empresa');
    const concepto   = v('vm-concepto');
    const periodo    = v('vm-periodo') || null;
    const monto      = v('vm-monto');
    const venc       = v('vm-venc');
    const notas      = v('vm-notas') || null;
    const recurrente = !editandoId && document.getElementById('vm-recurrente')?.checked;

    if (!concepto || !venc) { toast('Completá los campos obligatorios (*)', 'error'); return; }

    const btn = document.getElementById('vm-ok');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
    try {
      const montoNum = monto ? +monto : null;
      const periodoFinal = periodo || venc.slice(0, 7);
      const body = { tipo, empresa, concepto, periodo: periodoFinal, monto: montoNum, fecha_vencimiento: venc, notas };

      if (editandoId) {
        await sbUpdate(editandoId, { ...body, necesita_revision: false });
      } else if (recurrente) {
        const nuevaPlantilla = await plant.sbInsertRet({ tipo, empresa, concepto, activo: true, notas });
        await sbInsert({ ...body, pagado: false, recurrente_id: nuevaPlantilla.id, necesita_revision: false });
      } else {
        await sbInsert({ ...body, pagado: false });
      }
      cerrar();
      await cargar();
      toast(editandoId ? 'Registro actualizado' : 'Registro agregado', 'ok');
    } catch (err) {
      toast('Error: ' + err.message, 'error');
      if (btn) { btn.disabled = false; btn.textContent = editandoId ? 'Guardar cambios' : 'Agregar'; }
    }
  }

  // Corrige (tipo/empresa/concepto) TODOS los vencimientos ya generados de esta plantilla,
  // estén "por completar" o ya cargados con datos reales — no toca monto ni fecha de los que
  // ya están cargados, solo la categorización (para casos como "esto lo cargué como Factura
  // y era Impuesto" en todos los meses de una).
  async function actualizarVinculadosDePlantilla(plantillaId, cambios) {
    let vinculados = [];
    try { vinculados = await sbGet(`recurrente_id=eq.${plantillaId}`); } catch { return; }
    for (const p of vinculados) {
      try { await sbUpdate(p.id, cambios); } catch { /* seguimos con el resto */ }
    }
  }

  function abrirModalEditarPlantilla(pl) {
    if (!pl) return;
    document.getElementById('venc-modal-rec-editar')?.remove();

    const modal = document.createElement('div');
    modal.id        = 'venc-modal-rec-editar';
    modal.className = 'venc__modal-overlay';
    modal.innerHTML = `
      <div class="venc__modal" role="dialog" aria-modal="true">
        <h3 class="venc__modal-titulo">Editar vencimiento recurrente</h3>

        <div class="venc__row2">
          <div>
            <label class="venc__label">Tipo *</label>
            <select class="venc__input" id="rm-tipo">
              ${TIPOS.map(t => `<option value="${t.valor}" ${pl.tipo===t.valor?'selected':''}>${t.label}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="venc__label">Empresa *</label>
            <select class="venc__input" id="rm-empresa">
              ${EMPRESAS.map(x => `<option value="${x.valor}" ${pl.empresa===x.valor?'selected':''}>${x.label}</option>`).join('')}
            </select>
          </div>
        </div>

        <label class="venc__label">Concepto *</label>
        <input class="venc__input" id="rm-concepto" type="text" value="${e(pl.concepto)}">

        <label class="venc__label">Notas</label>
        <textarea class="venc__textarea" id="rm-notas" rows="2">${e(pl.notas)}</textarea>

        <p class="venc__ayuda">Esto corrige la plantilla y <strong>todos</strong> los vencimientos ya generados de esta serie (estén "por completar" o ya cargados con datos reales) — solo cambia tipo/empresa/concepto, nunca el monto ni la fecha que ya cargaste.</p>

        <div class="venc__modal-footer">
          <button class="venc__btn-sec" id="rm-cancel">Cancelar</button>
          <button class="venc__btn-pri" id="rm-ok">Guardar cambios</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const sc = document.querySelector('.app-contenido');
    if (sc) sc.style.overflow = 'hidden';
    const cerrar = () => { modal.remove(); if (sc) sc.style.overflow = ''; };
    modal.addEventListener('click', ev => { if (ev.target === modal) cerrar(); });
    modal.querySelector('#rm-cancel').addEventListener('click', cerrar);
    modal.querySelector('#rm-ok').addEventListener('click', async () => {
      const tipo     = v('rm-tipo');
      const empresa  = v('rm-empresa');
      const concepto = v('rm-concepto');
      const notas    = v('rm-notas') || null;
      if (!concepto) { toast('Completá el concepto', 'error'); return; }

      const btn = modal.querySelector('#rm-ok');
      btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        await plant.sbUpdate(pl.id, { tipo, empresa, concepto, notas });
        await actualizarVinculadosDePlantilla(pl.id, { tipo, empresa, concepto });
        cerrar();
        await cargar();
        abrirModalRecurrentes();
        toast('Plantilla actualizada', 'ok');
      } catch (err) {
        toast('Error: ' + err.message, 'error');
        btn.disabled = false; btn.textContent = 'Guardar cambios';
      }
    });
    setTimeout(() => modal.querySelector('#rm-concepto').focus({ preventScroll: true }), 40);
  }

  async function marcarPagado(id) {
    try { await sbUpdate(id, { pagado: true }); await cargar(); toast('Marcado como pagado'); }
    catch { toast('Error al actualizar', 'error'); }
  }

  // Para recurrentes irregulares (ej. cuotas de patente que no vencen todos los meses):
  // en vez de eliminar el placeholder (lo que hace que se vuelva a generar solo), se marca
  // "no corresponde" — el mes queda registrado como resuelto y no se regenera más.
  async function marcarOmitido(id) {
    try { await sbUpdate(id, { omitido: true, necesita_revision: false }); await cargar(); toast('Marcado como "no corresponde"'); }
    catch { toast('Error al actualizar', 'error'); }
  }

  async function deshacerOmitido(id) {
    try { await sbUpdate(id, { omitido: false, necesita_revision: true }); await cargar(); toast('Vuelve a estar pendiente de cargar'); }
    catch { toast('Error al actualizar', 'error'); }
  }

  async function eliminar(id) {
    if (!confirm('¿Eliminar este registro? Esta acción no se puede deshacer.')) return;
    try { await sbDelete(id); await cargar(); toast('Registro eliminado'); }
    catch { toast('Error al eliminar', 'error'); }
  }

  // ── Panel de configuración de plantillas recurrentes ────────────────────────
  function abrirModalRecurrentes() {
    document.getElementById('venc-modal-recurrentes')?.remove();

    const modal = document.createElement('div');
    modal.id        = 'venc-modal-recurrentes';
    modal.className = 'venc__modal-overlay';
    modal.innerHTML = `
      <div class="venc__modal" role="dialog" aria-modal="true">
        <h3 class="venc__modal-titulo">Vencimientos recurrentes</h3>
        <p class="venc__ayuda">Estos son los vencimientos marcados como "se repite todos los meses". Desactivá uno para que deje de generarse (los que ya se crearon no se borran).</p>
        ${plantillas.length === 0
          ? `<p class="venc__vacio">No hay ningún vencimiento recurrente configurado todavía.</p>`
          : `<div class="venc__tabla-wrap">
              <table class="venc__tabla">
                <thead><tr><th>Tipo</th><th>Empresa</th><th>Concepto</th><th>Estado</th><th></th></tr></thead>
                <tbody>
                  ${plantillas.map(pl => `
                    <tr>
                      <td><span class="venc-res__tipo venc-res__tipo--${pl.tipo}">${infoTipo(pl.tipo).label}</span></td>
                      <td class="venc__td-muted">${labelEmpresa(pl.empresa)}</td>
                      <td class="venc__td-bold">${e(pl.concepto)}</td>
                      <td>
                        <button class="venc__badge ${pl.activo ? 'venc__badge--verde' : 'venc__badge--rojo'}" data-rec-toggle="${pl.id}" data-activo="${pl.activo}" style="border:none;cursor:pointer;">
                          ${pl.activo ? 'Activo' : 'Inactivo'}
                        </button>
                      </td>
                      <td class="venc__td-acc">
                        <button class="venc__btn-icon" data-rec-editar="${pl.id}" title="Editar">
                          <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
                        </button>
                        <button class="venc__btn-icon venc__btn-icon--danger" data-rec-eliminar="${pl.id}" title="Eliminar plantilla">
                          <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                        </button>
                      </td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>`}
        <div class="venc__modal-footer">
          <button class="venc__btn-sec" id="vm-rec-cerrar">Cerrar</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const sc = document.querySelector('.app-contenido');
    if (sc) sc.style.overflow = 'hidden';
    const cerrar = () => { modal.remove(); if (sc) sc.style.overflow = ''; };
    modal.addEventListener('click', ev => { if (ev.target === modal) cerrar(); });
    modal.querySelector('#vm-rec-cerrar').addEventListener('click', cerrar);

    modal.querySelectorAll('[data-rec-toggle]').forEach(b =>
      b.addEventListener('click', async () => {
        try {
          await plant.sbUpdate(b.dataset.recToggle, { activo: b.dataset.activo !== 'true' });
          cerrar();
          await cargar();
          toast('Plantilla actualizada');
        } catch { toast('Error al actualizar', 'error'); }
      })
    );
    modal.querySelectorAll('[data-rec-editar]').forEach(b =>
      b.addEventListener('click', () => abrirModalEditarPlantilla(plantillas.find(pl => String(pl.id) === b.dataset.recEditar)))
    );
    modal.querySelectorAll('[data-rec-eliminar]').forEach(b =>
      b.addEventListener('click', async () => {
        if (!confirm('¿Eliminar esta plantilla recurrente? Los vencimientos ya generados no se borran, pero dejan de estar vinculados.')) return;
        try {
          await plant.sbDelete(b.dataset.recEliminar);
          cerrar();
          await cargar();
          toast('Plantilla eliminada');
        } catch { toast('Error al eliminar', 'error'); }
      })
    );
  }
}
