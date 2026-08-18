// Permisos y solicitudes → Pendientes.
// Autoriza (aprueba/rechaza) llegadas tarde, salidas anticipadas y ausencias.
// A diferencia del resto del tablero, estos datos NO viven en el Supabase de este
// proyecto: viven en Nexo RRHH, dos tenants independientes (uno por empresa) detrás
// de la misma Edge Function — ver data/nexo-permisos.js y data/fuentes.js (NEXO_CONFIG).
// La generación del permiso (formulario) sigue siendo externa; esta pantalla es solo
// el paso de autorización, calcada en estructura de components/postulantes-solicitudes.js.

import { nexoCall, tenantDeEmpresa, obtenerPermisosPendientes } from '../data/nexo-permisos.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';
import { obtenerClasificacionPuestos, tipoPuesto } from '../data/clasificacion-puestos.js';
import { crearOrdenTabla } from './tabla-ordenable.js';

const HDR = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
const EMP_LABEL = { CIMOMET: 'Cimomet', COMOING: 'Co.mo.ing' };
const EMP_COLOR = { CIMOMET: 'var(--color-primario)', COMOING: '#0d9488' };
const TIPO_LABEL = {
  llegada_tarde:     'Llegada tarde',
  salida_anticipada: 'Salida anticipada',
  ausencia:          'Ausencia',
};
const TIPO_PUESTO_LABEL = { mensual: 'Mensual', quincenal: 'Quincenal', sin_asignar: 'Sin asignar' };

// Nexo no informa el puesto de cada persona — para clasificar Mensual/Quincenal hay que
// cruzar legajo+empresa contra la tabla local `empleados` (misma fuente que usa Plantel).
async function obtenerMapaTipoPuesto() {
  const mapa = new Map(); // "EMPRESA|legajo" -> 'mensual' | 'quincenal' | 'sin_asignar'
  try {
    const [rEmp, mapaClasif] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/empleados?select=legajo,empresa,desc_puesto`, { headers: HDR }),
      obtenerClasificacionPuestos(),
    ]);
    if (rEmp.ok) {
      const empleados = await rEmp.json();
      empleados.forEach(emp => mapa.set(`${emp.empresa}|${emp.legajo}`, tipoPuesto(emp.desc_puesto, mapaClasif)));
    }
  } catch { /* si falla, todos quedan "sin_asignar" — el filtro sigue funcionando */ }
  return mapa;
}

function e(s) { return (s ?? '').toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// Fechas acá vienen como 'YYYY-MM-DD' puro (sin hora) — parsearlas con `new Date()` y
// formatear en el huso local puede correr el día para atrás (medianoche UTC cae el día
// anterior en Argentina). Se arma el string a mano para evitar esa clase de bug.
function fmtFecha(f) {
  if (!f) return '—';
  const [y, m, d] = f.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

function fmtFechaHora(p) {
  const fecha = fmtFecha(p.fecha);
  if (p.tipo === 'ausencia' || !p.hora) return `${fecha} · jornada completa`;
  return `${fecha} · ${String(p.hora).slice(0, 5)}`;
}

function nombreEmpleado(p) {
  const emp = p.empleado || {};
  const nombre = `${emp.apellido || ''}, ${emp.nombre || ''}`.trim().replace(/^,\s*/, '');
  return nombre || '—';
}

export async function renderizarPermisosAutorizacion(contenedor, alActualizarBadge) {
  contenedor.innerHTML = `<p class="sol__cargando">Cargando permisos…</p>`;

  let permisos = [];
  let filtroEmpresa = '';
  let filtroTipoPuesto = '';
  let errorParcial = '';

  const mapaTipoPuesto = await obtenerMapaTipoPuesto();
  const ordenPermisos = crearOrdenTabla(null);
  function valorPermiso(fila, clave) {
    switch (clave) {
      case 'empleado':  return nombreEmpleado(fila);
      case 'empresa':   return fila.empresa || '';
      case 'tipo':      return TIPO_LABEL[fila.tipo] || fila.tipo || '';
      case 'fecha':     return `${fila.fecha || ''} ${fila.hora || ''}`;
      case 'motivo':    return fila.motivo || '';
      case 'reemplazo': return fila.reemplazo_nombre || '';
      default:          return null;
    }
  }

  async function cargarPermisos() {
    const { items, fallos } = await obtenerPermisosPendientes();
    errorParcial = fallos.length ? `No se pudo cargar ${fallos.map(x => EMP_LABEL[x]).join(' ni ')} — mostrando solo lo disponible.` : '';
    items.forEach(p => { p.tipoPuesto = mapaTipoPuesto.get(`${p.empresa}|${p.empleado?.legajo}`) || 'sin_asignar'; });
    permisos = items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return fallos.length < 2; // false = fallaron los dos tenants, no hay nada que mostrar
  }

  let huboDatos;
  try {
    huboDatos = await cargarPermisos();
  } catch {
    huboDatos = false;
  }

  if (!huboDatos) {
    contenedor.innerHTML = `
      <div class="estado-vacio">
        <h3 class="estado-vacio__titulo">Error al cargar</h3>
        <p class="estado-vacio__texto">No se pudieron obtener los permisos pendientes de ninguna de las dos empresas. Puede ser un problema de conexión con Nexo RRHH — probá de nuevo en un momento.</p>
      </div>`;
    return;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  function filtrados() {
    return permisos
      .filter(p => !filtroEmpresa    || p.empresa === filtroEmpresa)
      .filter(p => !filtroTipoPuesto || p.tipoPuesto === filtroTipoPuesto)
      .sort(ordenPermisos.comparador(valorPermiso));
  }

  function filas(lista) {
    if (!lista.length) return `<tr><td colspan="7" class="sol__empty">No hay permisos pendientes.</td></tr>`;
    return lista.map(p => `
      <tr class="sol__fila">
        <td class="sol__td-puesto">
          <strong>${e(nombreEmpleado(p))}</strong>
          <br><span class="sol__area">Legajo ${e(p.empleado?.legajo)}</span>
        </td>
        <td style="color:${EMP_COLOR[p.empresa] || 'var(--color-texto-sec)'};white-space:nowrap">${EMP_LABEL[p.empresa] || e(p.empresa)}</td>
        <td>${TIPO_LABEL[p.tipo] || e(p.tipo)}</td>
        <td class="sol__td-fecha">${fmtFechaHora(p)}</td>
        <td>${e(p.motivo) || '—'}</td>
        <td>${p.reemplazo_nombre ? `${e(p.reemplazo_nombre)}${p.reemplazo_legajo ? ` (#${e(p.reemplazo_legajo)})` : ''}` : ''}</td>
        <td class="sol__td-acciones">
          <button class="sol__btn-autorizar" data-id="${e(p.id)}" type="button">Aprobar</button>
          <button class="sol__btn-rechazar"  data-id="${e(p.id)}" type="button">Rechazar</button>
        </td>
      </tr>`).join('');
  }

  function renderTabla(lista) {
    return `
      <div class="sol__tabla-wrap">
        <table class="sol__tabla">
          <thead><tr>
            ${ordenPermisos.thHtml('empleado', 'Empleado')}
            ${ordenPermisos.thHtml('empresa', 'Empresa')}
            ${ordenPermisos.thHtml('tipo', 'Tipo')}
            ${ordenPermisos.thHtml('fecha', 'Fecha')}
            ${ordenPermisos.thHtml('motivo', 'Motivo')}
            ${ordenPermisos.thHtml('reemplazo', 'Reemplazo')}
            <th></th>
          </tr></thead>
          <tbody>${filas(lista)}</tbody>
        </table>
      </div>`;
  }

  function render() {
    const lista = filtrados();
    const tiposConGente = ['mensual', 'quincenal', 'sin_asignar'].filter(t => permisos.some(p => p.tipoPuesto === t));
    contenedor.innerHTML = `
      <div class="sol__wrap">
        ${errorParcial ? `<div class="pres__aviso-parcial" style="margin-bottom:var(--espacio-m)">${e(errorParcial)}</div>` : ''}
        <div class="sol__topbar">
          <div class="sol__filtros" role="group" aria-label="Filtrar por empresa">
            <button class="sol__ftab ${filtroEmpresa === '' ? 'sol__ftab--activo' : ''}" data-emp="" type="button">
              Todas <span class="sol__ftab-count">${permisos.length}</span>
            </button>
            <button class="sol__ftab ${filtroEmpresa === 'CIMOMET' ? 'sol__ftab--activo' : ''}" data-emp="CIMOMET" type="button">
              Cimomet <span class="sol__ftab-count">${permisos.filter(p => p.empresa === 'CIMOMET').length}</span>
            </button>
            <button class="sol__ftab ${filtroEmpresa === 'COMOING' ? 'sol__ftab--activo' : ''}" data-emp="COMOING" type="button">
              Co.mo.ing <span class="sol__ftab-count">${permisos.filter(p => p.empresa === 'COMOING').length}</span>
            </button>
          </div>
          <div class="sol__filtros" role="group" aria-label="Filtrar por tipo de puesto">
            <button class="sol__ftab ${filtroTipoPuesto === '' ? 'sol__ftab--activo' : ''}" data-tipopuesto="" type="button">
              Todos <span class="sol__ftab-count">${permisos.length}</span>
            </button>
            ${tiposConGente.map(t => `
            <button class="sol__ftab ${filtroTipoPuesto === t ? 'sol__ftab--activo' : ''}" data-tipopuesto="${t}" type="button">
              ${TIPO_PUESTO_LABEL[t]} <span class="sol__ftab-count">${permisos.filter(p => p.tipoPuesto === t).length}</span>
            </button>`).join('')}
          </div>
        </div>
        <div id="perm-tabla-area">${renderTabla(lista)}</div>
      </div>`;

    contenedor.querySelectorAll('[data-emp]').forEach(btn => {
      btn.addEventListener('click', () => {
        filtroEmpresa = btn.dataset.emp;
        render();
      });
    });
    contenedor.querySelectorAll('[data-tipopuesto]').forEach(btn => {
      btn.addEventListener('click', () => {
        filtroTipoPuesto = btn.dataset.tipopuesto;
        render();
      });
    });
    bindAcciones();
    // Se re-wirea sobre el `.sol__wrap` de ESTE render (nodo nuevo cada vez, ya que
    // contenedor.innerHTML se reemplaza entero) — wirear sobre `contenedor` en cambio
    // dejaría un listener pegado para siempre en el nodo persistente #contenido-principal,
    // que sigue vivo al navegar a otra pantalla y termina repintando esta por encima.
    ordenPermisos.wire(contenedor.querySelector('.sol__wrap'), render);
  }

  async function recargarYRender() {
    try { await cargarPermisos(); } catch { /* se mantiene lo que ya había en memoria */ }
    render();
    alActualizarBadge?.();
  }

  // ── Modal ─────────────────────────────────────────────────────────────────
  function abrirModal(id, html) {
    document.getElementById(id)?.remove();
    const modal = document.createElement('div');
    modal.id = id;
    modal.className = 'sol__modal-overlay';
    modal.innerHTML = html;
    document.body.appendChild(modal);
    const sc = document.querySelector('.app-contenido');
    if (sc) sc.style.overflow = 'hidden';
    const cerrar = () => { modal.remove(); if (sc) sc.style.overflow = ''; };
    modal.addEventListener('click', ev => { if (ev.target === modal) cerrar(); });
    return { modal, cerrar };
  }

  function abrirModalAprobar(permisoId) {
    const p = permisos.find(x => x.id === permisoId);
    const { modal, cerrar } = abrirModal('perm-modal-aprobar', `
      <div class="sol__modal" role="dialog" aria-modal="true">
        <h3 class="sol__modal-titulo">Aprobar permiso</h3>
        <p class="sol__modal-desc">${e(nombreEmpleado(p))} — ${TIPO_LABEL[p?.tipo] || e(p?.tipo)} · ${fmtFechaHora(p || {})}</p>
        <label class="sol__modal-label" for="perm-quien">¿Quién aprueba? *</label>
        <input class="sol__modal-input" id="perm-quien" type="text" placeholder="Nombre" autocomplete="off">
        <label class="sol__modal-label" for="perm-obs-ap">Observación (opcional)</label>
        <textarea class="sol__modal-input" id="perm-obs-ap" rows="2" placeholder="Observaciones…"></textarea>
        <div class="sol__modal-footer">
          <button class="sol__btn-cancel" id="perm-ap-cancel" type="button">Cancelar</button>
          <button class="sol__btn-ok"     id="perm-ap-ok"     type="button">Confirmar aprobación</button>
        </div>
      </div>`);
    modal.querySelector('#perm-ap-cancel').addEventListener('click', cerrar);
    const inputQuien = modal.querySelector('#perm-quien');
    setTimeout(() => inputQuien.focus({ preventScroll: true }), 40);

    modal.querySelector('#perm-ap-ok').addEventListener('click', async () => {
      const quien = inputQuien.value.trim();
      if (!quien) { inputQuien.focus(); return; }
      const observacion = modal.querySelector('#perm-obs-ap').value.trim() || null;
      const btn = modal.querySelector('#perm-ap-ok');
      btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        await nexoCall(tenantDeEmpresa(p.empresa), 'autorizar_permiso', {
          permiso_id: permisoId, accion: 'aprobar', observacion, autorizado_por: quien,
        });
        cerrar();
        await recargarYRender();
      } catch (err) {
        alert('Error: ' + err.message);
        btn.disabled = false; btn.textContent = 'Confirmar aprobación';
      }
    });
  }

  function abrirModalRechazar(permisoId) {
    const p = permisos.find(x => x.id === permisoId);
    const { modal, cerrar } = abrirModal('perm-modal-rechazar', `
      <div class="sol__modal" role="dialog" aria-modal="true">
        <h3 class="sol__modal-titulo">Rechazar permiso</h3>
        <p class="sol__modal-desc">${e(nombreEmpleado(p))} — ${TIPO_LABEL[p?.tipo] || e(p?.tipo)} · ${fmtFechaHora(p || {})}</p>
        <label class="sol__modal-label" for="perm-quien-rec">¿Quién rechaza? *</label>
        <input class="sol__modal-input" id="perm-quien-rec" type="text" placeholder="Nombre" autocomplete="off">
        <label class="sol__modal-label" for="perm-obs-rec">Motivo del rechazo *</label>
        <textarea class="sol__modal-input" id="perm-obs-rec" rows="2" placeholder="Por qué se rechaza…"></textarea>
        <div class="sol__modal-footer">
          <button class="sol__btn-cancel" id="perm-rec-cancel" type="button">Cancelar</button>
          <button class="sol__btn-ok sol__btn-ok--danger" id="perm-rec-ok" type="button">Rechazar</button>
        </div>
      </div>`);
    modal.querySelector('#perm-rec-cancel').addEventListener('click', cerrar);
    const inputQuien = modal.querySelector('#perm-quien-rec');
    const textObs     = modal.querySelector('#perm-obs-rec');
    setTimeout(() => inputQuien.focus({ preventScroll: true }), 40);

    modal.querySelector('#perm-rec-ok').addEventListener('click', async () => {
      const quien = inputQuien.value.trim();
      if (!quien) { inputQuien.focus(); return; }
      const observacion = textObs.value.trim();
      if (!observacion) { textObs.focus(); return; }
      const btn = modal.querySelector('#perm-rec-ok');
      btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        await nexoCall(tenantDeEmpresa(p.empresa), 'autorizar_permiso', {
          permiso_id: permisoId, accion: 'rechazar', observacion, autorizado_por: quien,
        });
        cerrar();
        await recargarYRender();
      } catch (err) {
        alert('Error: ' + err.message);
        btn.disabled = false; btn.textContent = 'Rechazar';
      }
    });
  }

  function bindAcciones() {
    contenedor.querySelectorAll('.sol__btn-autorizar').forEach(btn => {
      btn.addEventListener('click', () => abrirModalAprobar(btn.dataset.id));
    });
    contenedor.querySelectorAll('.sol__btn-rechazar').forEach(btn => {
      btn.addEventListener('click', () => abrirModalRechazar(btn.dataset.id));
    });
  }

  render();
}
