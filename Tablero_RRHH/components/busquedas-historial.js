import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';

const HDR = {
  'Content-Type': 'application/json',
  apikey:         SUPABASE_ANON_KEY,
  Authorization:  `Bearer ${SUPABASE_ANON_KEY}`,
};

async function sbGet(q) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${q}`, { headers: HDR });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

function e(s)        { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function fmtFecha(f) { if (!f) return '—'; return new Date(f).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }); }

function badgeHistorial(s) {
  if (s.estado === 'rechazado')               return `<span class="sol__badge sol__badge--cerr">Rechazada</span>`;
  if (s.estado === 'pendiente')               return `<span class="sol__badge sol__badge--pend">Sin autorizar</span>`;
  if (s.estado_busqueda === 'cubierto')       return `<span class="sol__badge sol__badge--ok">Cubierta ✓</span>`;
  if (s.estado_busqueda === 'en_busqueda')    return `<span class="sol__badge sol__badge--busq">En búsqueda</span>`;
  return `<span class="sol__badge sol__badge--pend">Sin iniciar</span>`;
}

function filtrarLista(lista, f) {
  if (f === 'activas')    return lista.filter(s => s.estado === 'aprobado' && s.estado_busqueda !== 'cubierto');
  if (f === 'cubiertas')  return lista.filter(s => s.estado_busqueda === 'cubierto');
  if (f === 'rechazadas') return lista.filter(s => s.estado === 'rechazado');
  if (f === 'pendientes') return lista.filter(s => s.estado === 'pendiente');
  return lista;
}

function filas(lista, contratadosMap) {
  if (!lista.length) {
    return `<tr><td colspan="7" class="sol__empty">No hay búsquedas en este estado.</td></tr>`;
  }
  return lista.map(s => {
    const contratados = contratadosMap[s.id] || [];
    const cantidad    = s.cantidad ?? 1;
    const esCubierta  = s.estado_busqueda === 'cubierto';
    return `
      <tr class="hist__fila${esCubierta ? ' hist__fila--cubierta' : ''}">
        <td class="hist__td-puesto">
          <strong>${e(s.puesto)}</strong>
          ${s.area ? `<br><span class="sol__area">${e(s.area)}${s.empresa ? ' · ' + e(s.empresa) : ''}</span>` : ''}
        </td>
        <td class="hist__td-num">${cantidad}</td>
        <td>
          <span class="hist__persona">${e(s.solicitado_por) || '—'}</span>
          ${s.created_at ? `<br><span class="hist__fecha-sub">${fmtFecha(s.created_at)}</span>` : ''}
        </td>
        <td>
          <span class="hist__persona">${e(s.aprobado_por) || '—'}</span>
          ${s.fecha_aprobacion ? `<br><span class="hist__fecha-sub">${fmtFecha(s.fecha_aprobacion)}</span>` : ''}
        </td>
        <td>${badgeHistorial(s)}</td>
        <td class="hist__td-contratados">
          ${contratados.length
            ? contratados.map(c => `<span class="hist__cand">${e(c.apellido ? c.apellido + ', ' + c.nombre : c.nombre || '—')}</span>`).join('')
            : `<span class="hist__vacio">${esCubierta ? '—' : `0 / ${cantidad}`}</span>`
          }
        </td>
      </tr>`;
  }).join('');
}

export async function renderizarBusquedasHistorial(contenedor) {
  contenedor.innerHTML = `<p class="sol__cargando">Cargando historial de búsquedas…</p>`;

  let solicitudes     = [];
  let contratadosMap  = {};

  try {
    solicitudes = await sbGet('solicitudes_personal?order=created_at.desc');
  } catch {
    contenedor.innerHTML = `<div class="estado-vacio"><h3 class="estado-vacio__titulo">Error al cargar</h3><p class="estado-vacio__texto">No se pudo obtener el historial de búsquedas.</p></div>`;
    return;
  }

  if (solicitudes.length) {
    try {
      const ids = solicitudes.map(s => s.id).join(',');
      const contratados = await sbGet(`candidatos?solicitud_id=in.(${ids})&estado=eq.contratado&select=id,nombre,apellido,solicitud_id&order=updated_at.asc`);
      contratados.forEach(c => {
        if (!contratadosMap[c.solicitud_id]) contratadosMap[c.solicitud_id] = [];
        contratadosMap[c.solicitud_id].push(c);
      });
    } catch (_) {}
  }

  let filtroActivo = '';

  function n(f) { return filtrarLista(solicitudes, f).length; }
  const nActivas    = n('activas');
  const nPendientes = n('pendientes');

  contenedor.innerHTML = `
    <div class="sol__wrap">
      <div class="sol__topbar">
        <div class="sol__filtros" role="group" aria-label="Filtrar historial">
          <button class="sol__ftab sol__ftab--activo" data-f="" type="button">
            Todas <span class="sol__ftab-count">${solicitudes.length}</span>
          </button>
          <button class="sol__ftab" data-f="activas" type="button">
            Activas ${nActivas > 0 ? `<span class="sol__ftab-count sol__ftab-count--alert">${nActivas}</span>` : `<span class="sol__ftab-count">0</span>`}
          </button>
          <button class="sol__ftab" data-f="cubiertas" type="button">
            Cubiertas <span class="sol__ftab-count">${n('cubiertas')}</span>
          </button>
          <button class="sol__ftab" data-f="pendientes" type="button">
            Sin autorizar ${nPendientes > 0 ? `<span class="sol__ftab-count sol__ftab-count--alert">${nPendientes}</span>` : `<span class="sol__ftab-count">0</span>`}
          </button>
          <button class="sol__ftab" data-f="rechazadas" type="button">
            Rechazadas <span class="sol__ftab-count">${n('rechazadas')}</span>
          </button>
        </div>
      </div>
      <div class="sol__tabla-wrap">
        <table class="sol__tabla hist__tabla">
          <thead><tr>
            <th>Puesto · Área · Empresa</th>
            <th title="Vacantes solicitadas">Vac.</th>
            <th>Solicitado por</th>
            <th>Aprobado por</th>
            <th>Estado</th>
            <th>Contratados</th>
          </tr></thead>
          <tbody id="hist-tbody">${filas(solicitudes, contratadosMap)}</tbody>
        </table>
      </div>
    </div>`;

  const tbody = contenedor.querySelector('#hist-tbody');

  contenedor.querySelectorAll('.sol__ftab').forEach(btn => {
    btn.addEventListener('click', () => {
      contenedor.querySelectorAll('.sol__ftab').forEach(b => b.classList.remove('sol__ftab--activo'));
      btn.classList.add('sol__ftab--activo');
      filtroActivo = btn.dataset.f;
      tbody.innerHTML = filas(filtrarLista(solicitudes, filtroActivo), contratadosMap);
    });
  });
}
