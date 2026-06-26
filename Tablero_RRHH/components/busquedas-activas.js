import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';

const HDR = {
  'Content-Type': 'application/json',
  apikey:         SUPABASE_ANON_KEY,
  Authorization:  `Bearer ${SUPABASE_ANON_KEY}`,
};

async function sbGet(q) { const r = await fetch(`${SUPABASE_URL}/rest/v1/${q}`, { headers: HDR }); if (!r.ok) throw new Error(await r.text()); return r.json(); }

function e(s)        { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function fmtFecha(f) { if (!f) return '—'; return new Date(f).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }); }

const PRIO_CLS = { Alta: 'sol__badge--alta', Media: 'sol__badge--media', Baja: 'sol__badge--baja' };

function badgePrio(p) {
  if (!p) return '';
  return `<span class="sol__badge ${PRIO_CLS[p] || ''}">${e(p)}</span>`;
}

function badgeBusqueda(sb) {
  const cfg = {
    pendiente:   { cls: 'sol__badge--pend', txt: 'Sin iniciar' },
    en_busqueda: { cls: 'sol__badge--busq', txt: 'En búsqueda' },
  };
  const { cls, txt } = cfg[sb] || { cls: '', txt: e(sb) };
  return `<span class="sol__badge ${cls}">${txt}</span>`;
}

function filtrar(lista, f) {
  if (f === 'pendiente')   return lista.filter(b => b.estado_busqueda === 'pendiente');
  if (f === 'en_busqueda') return lista.filter(b => b.estado_busqueda === 'en_busqueda');
  return lista;
}

function renderTarjetas(lista, contratadosPor) {
  if (!lista.length) {
    return `<div class="estado-vacio">
      <h3 class="estado-vacio__titulo">Sin búsquedas activas</h3>
      <p class="estado-vacio__texto">No hay posiciones abiertas en este estado.</p>
    </div>`;
  }
  return `<div class="bsq__grid">${lista.map(s => {
    const cubiertos = contratadosPor[s.id] || 0;
    const total     = s.cantidad || 1;
    const pct       = Math.round((cubiertos / total) * 100);
    return `
    <div class="bsq__tarjeta">
      <div class="bsq__tarjeta-header">
        <div>
          <div class="bsq__puesto">${e(s.puesto)}</div>
          ${s.area ? `<div class="bsq__area">${e(s.area)}${s.empresa ? ` · ${e(s.empresa)}` : ''}</div>` : ''}
        </div>
        <div class="bsq__tarjeta-badges">
          ${badgePrio(s.prioridad)}
          ${badgeBusqueda(s.estado_busqueda)}
        </div>
      </div>
      <div class="bsq__tarjeta-body">
        ${s.motivo        ? `<div class="bsq__campo"><span class="bsq__label">Motivo</span><span>${e(s.motivo)}</span></div>` : ''}
        ${s.responsable_busqueda ? `<div class="bsq__campo"><span class="bsq__label">Responsable</span><span>${e(s.responsable_busqueda)}</span></div>` : ''}
        ${s.aprobado_por  ? `<div class="bsq__campo"><span class="bsq__label">Aprobado por</span><span>${e(s.aprobado_por)}</span></div>` : ''}
        ${s.fecha_aprobacion ? `<div class="bsq__campo"><span class="bsq__label">Aprobado el</span><span>${fmtFecha(s.fecha_aprobacion)}</span></div>` : ''}
        ${s.descripcion   ? `<div class="bsq__descripcion">${e(s.descripcion)}</div>` : ''}
      </div>
      <div class="bsq__progreso">
        <span class="bsq__progreso-num">${cubiertos}/${total}</span>
        <div class="bsq__progreso-bar" title="${cubiertos} de ${total} vacante${total !== 1 ? 's' : ''} cubierta${total !== 1 ? 's' : ''}">
          <div class="bsq__progreso-relleno" style="width:${pct}%"></div>
        </div>
        <span class="bsq__progreso-label">contratado${total !== 1 ? 's' : ''}</span>
      </div>
    </div>`; }).join('')}</div>`;
}

export async function renderizarBusquedasActivas(contenedor) {
  contenedor.innerHTML = `<p class="sol__cargando">Cargando búsquedas activas…</p>`;

  let busquedas    = [];
  let contratadosPor = {};
  let filtroActivo = '';

  try {
    busquedas = await sbGet('solicitudes_personal?estado=eq.aprobado&estado_busqueda=neq.cubierto&order=created_at.desc');
  } catch {
    contenedor.innerHTML = `<div class="estado-vacio"><h3 class="estado-vacio__titulo">Error al cargar</h3><p class="estado-vacio__texto">No se pudieron obtener las búsquedas activas.</p></div>`;
    return;
  }

  // Contar contratados vinculados a cada búsqueda
  if (busquedas.length) {
    try {
      const ids = busquedas.map(b => b.id).join(',');
      const vinculados = await sbGet(`candidatos?solicitud_id=in.(${ids})&estado=eq.contratado&select=solicitud_id`);
      vinculados.forEach(c => {
        contratadosPor[c.solicitud_id] = (contratadosPor[c.solicitud_id] || 0) + 1;
      });
    } catch (_) {}
  }

  function n(f) { return filtrar(busquedas, f).length; }

  contenedor.innerHTML = `
    <div class="sol__wrap">
      <div class="sol__topbar">
        <div class="sol__filtros" role="group" aria-label="Filtrar búsquedas">
          <button class="sol__ftab sol__ftab--activo" data-f="" type="button">
            Todas <span class="sol__ftab-count">${busquedas.length}</span>
          </button>
          <button class="sol__ftab" data-f="pendiente" type="button">
            Sin iniciar <span class="sol__ftab-count">${n('pendiente')}</span>
          </button>
          <button class="sol__ftab" data-f="en_busqueda" type="button">
            En búsqueda <span class="sol__ftab-count">${n('en_busqueda')}</span>
          </button>
        </div>
      </div>
      <div id="bsq-contenido">${renderTarjetas(busquedas, contratadosPor)}</div>
    </div>`;

  const contenidoArea = contenedor.querySelector('#bsq-contenido');

  function actualizar() {
    contenidoArea.innerHTML = renderTarjetas(filtrar(busquedas, filtroActivo), contratadosPor);
    bindAcciones();
  }

  contenedor.querySelectorAll('.sol__ftab').forEach(btn => {
    btn.addEventListener('click', () => {
      contenedor.querySelectorAll('.sol__ftab').forEach(b => b.classList.remove('sol__ftab--activo'));
      btn.classList.add('sol__ftab--activo');
      filtroActivo = btn.dataset.f;
      actualizar();
    });
  });

}
