// Permisos y solicitudes → Autorizados.
// Historial de permisos ya decididos (aprobados/rechazados) — de solo lectura, sin
// acciones. Usa get_estadisticas_permisos, que trae un shape distinto al de
// "Pendientes" (empleados en plural, con estado) — ver data/nexo-permisos.js.

import { obtenerEstadisticasPermisos } from '../data/nexo-permisos.js';
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
const ESTADO_CFG = {
  aprobado:  { cls: 'sol__badge--auto', txt: 'Aprobado' },
  rechazado: { cls: 'sol__badge--cerr', txt: 'Rechazado' },
  pendiente: { cls: 'sol__badge--pend', txt: 'Pendiente' },
};

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

function fmtFecha(f) {
  if (!f) return '—';
  const [y, m, d] = f.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

// A diferencia de `fecha` (fecha pura del permiso), esto sí es un timestamp real con
// offset explícito (ej. "...T17:42:57+00:00") — convertir a huso local es lo correcto acá.
function fmtTimestamp(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function nombreEmpleado(p) {
  const emp = p.empleados || {};
  const nombre = `${emp.apellido || ''}, ${emp.nombre || ''}`.trim().replace(/^,\s*/, '');
  return nombre || '—';
}

function badgeEstado(s) {
  const cfg = ESTADO_CFG[s] || { cls: '', txt: e(s) };
  return `<span class="sol__badge ${cfg.cls}">${cfg.txt}</span>`;
}

export async function renderizarPermisosAutorizados(contenedor) {
  contenedor.innerHTML = `<p class="sol__cargando">Cargando historial…</p>`;

  const [{ items: permisos, fallos }, mapaTipoPuesto] = await Promise.all([
    obtenerEstadisticasPermisos().catch(() => ({ items: [], fallos: ['CIMOMET', 'COMOING'] })),
    obtenerMapaTipoPuesto(),
  ]);

  if (!permisos.length && fallos.length === 2) {
    contenedor.innerHTML = `
      <div class="estado-vacio">
        <h3 class="estado-vacio__titulo">Error al cargar</h3>
        <p class="estado-vacio__texto">No se pudo obtener el historial de ninguna de las dos empresas.</p>
      </div>`;
    return;
  }

  permisos.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  permisos.forEach(p => { p.tipoPuesto = mapaTipoPuesto.get(`${p.empresa}|${p.empleados?.legajo}`) || 'sin_asignar'; });

  let filtroEmpresa = '';
  let filtroEstado  = '';
  let filtroTipoPuesto = '';

  const ordenPermisos = crearOrdenTabla(null);
  function valorPermiso(fila, clave) {
    switch (clave) {
      case 'empleado':   return nombreEmpleado(fila);
      case 'empresa':    return fila.empresa || '';
      case 'tipo':       return TIPO_LABEL[fila.tipo] || fila.tipo || '';
      case 'fecha':      return fila.fecha || '';
      case 'estado':     return fila.estado || '';
      case 'decidido':   return fila.aprobado_at || '';
      case 'observacion': return fila.observacion_rrhh || '';
      default:            return null;
    }
  }

  function filtrados() {
    return permisos
      .filter(p => !filtroEmpresa    || p.empresa === filtroEmpresa)
      .filter(p => !filtroEstado     || p.estado === filtroEstado)
      .filter(p => !filtroTipoPuesto || p.tipoPuesto === filtroTipoPuesto)
      .sort(ordenPermisos.comparador(valorPermiso));
  }

  function n(pred) { return permisos.filter(pred).length; }

  function filas(lista) {
    if (!lista.length) return `<tr><td colspan="7" class="sol__empty">No hay permisos para mostrar.</td></tr>`;
    return lista.map(p => `
      <tr class="sol__fila">
        <td class="sol__td-puesto">
          <strong>${e(nombreEmpleado(p))}</strong>
          <br><span class="sol__area">Legajo ${e(p.empleados?.legajo)}</span>
        </td>
        <td style="color:${EMP_COLOR[p.empresa] || 'var(--color-texto-sec)'};white-space:nowrap">${EMP_LABEL[p.empresa] || e(p.empresa)}</td>
        <td>${TIPO_LABEL[p.tipo] || e(p.tipo)}</td>
        <td class="sol__td-fecha">${fmtFecha(p.fecha)}</td>
        <td>${badgeEstado(p.estado)}</td>
        <td class="sol__td-fecha">${fmtTimestamp(p.aprobado_at)}</td>
        <td>${e(p.observacion_rrhh) || '—'}</td>
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
            ${ordenPermisos.thHtml('estado', 'Estado')}
            ${ordenPermisos.thHtml('decidido', 'Decidido')}
            ${ordenPermisos.thHtml('observacion', 'Observación')}
          </tr></thead>
          <tbody>${filas(lista)}</tbody>
        </table>
      </div>`;
  }

  function render() {
    const tiposConGente = ['mensual', 'quincenal', 'sin_asignar'].filter(t => permisos.some(p => p.tipoPuesto === t));
    contenedor.innerHTML = `
      <div class="sol__wrap">
        ${fallos.length ? `<div class="pres__aviso-parcial" style="margin-bottom:var(--espacio-m)">No se pudo cargar ${fallos.map(x => EMP_LABEL[x]).join(' ni ')} — mostrando solo lo disponible.</div>` : ''}
        <div class="sol__topbar">
          <div class="sol__filtros" role="group" aria-label="Filtrar por empresa">
            <button class="sol__ftab ${filtroEmpresa === '' ? 'sol__ftab--activo' : ''}" data-emp="" type="button">Todas <span class="sol__ftab-count">${permisos.length}</span></button>
            <button class="sol__ftab ${filtroEmpresa === 'CIMOMET' ? 'sol__ftab--activo' : ''}" data-emp="CIMOMET" type="button">Cimomet <span class="sol__ftab-count">${n(p => p.empresa === 'CIMOMET')}</span></button>
            <button class="sol__ftab ${filtroEmpresa === 'COMOING' ? 'sol__ftab--activo' : ''}" data-emp="COMOING" type="button">Co.mo.ing <span class="sol__ftab-count">${n(p => p.empresa === 'COMOING')}</span></button>
          </div>
          <div class="sol__filtros" role="group" aria-label="Filtrar por estado">
            <button class="sol__ftab ${filtroEstado === '' ? 'sol__ftab--activo' : ''}" data-est="" type="button">Todos</button>
            <button class="sol__ftab ${filtroEstado === 'aprobado' ? 'sol__ftab--activo' : ''}" data-est="aprobado" type="button">Aprobados <span class="sol__ftab-count">${n(p => p.estado === 'aprobado')}</span></button>
            <button class="sol__ftab ${filtroEstado === 'rechazado' ? 'sol__ftab--activo' : ''}" data-est="rechazado" type="button">Rechazados <span class="sol__ftab-count">${n(p => p.estado === 'rechazado')}</span></button>
          </div>
          <div class="sol__filtros" role="group" aria-label="Filtrar por tipo de puesto">
            <button class="sol__ftab ${filtroTipoPuesto === '' ? 'sol__ftab--activo' : ''}" data-tipopuesto="" type="button">Todos <span class="sol__ftab-count">${permisos.length}</span></button>
            ${tiposConGente.map(t => `
            <button class="sol__ftab ${filtroTipoPuesto === t ? 'sol__ftab--activo' : ''}" data-tipopuesto="${t}" type="button">${TIPO_PUESTO_LABEL[t]} <span class="sol__ftab-count">${n(p => p.tipoPuesto === t)}</span></button>`).join('')}
          </div>
        </div>
        <div id="perm-auth-tabla">${renderTabla(filtrados())}</div>
      </div>`;

    contenedor.querySelectorAll('[data-emp]').forEach(btn => btn.addEventListener('click', () => { filtroEmpresa = btn.dataset.emp; render(); }));
    contenedor.querySelectorAll('[data-est]').forEach(btn => btn.addEventListener('click', () => { filtroEstado = btn.dataset.est; render(); }));
    contenedor.querySelectorAll('[data-tipopuesto]').forEach(btn => btn.addEventListener('click', () => { filtroTipoPuesto = btn.dataset.tipopuesto; render(); }));
    // Se re-wirea sobre el `.sol__wrap` de ESTE render (nodo nuevo cada vez, ya que
    // contenedor.innerHTML se reemplaza entero) — wirear sobre `contenedor` en cambio
    // dejaría un listener pegado para siempre en el nodo persistente #contenido-principal,
    // que sigue vivo al navegar a otra pantalla y termina repintando esta por encima.
    ordenPermisos.wire(contenedor.querySelector('.sol__wrap'), render);
  }

  render();
}
