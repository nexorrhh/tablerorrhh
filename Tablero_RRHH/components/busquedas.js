import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';
import { obtenerUsuario } from '../data/usuario-activo.js';

const TABLA = 'solicitudes_personal';
const HDR = {
  'Content-Type': 'application/json',
  apikey:        SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
};

async function sbGet(q)       { const r = await fetch(`${SUPABASE_URL}/rest/v1/${q}`, { headers: HDR }); if (!r.ok) throw new Error(await r.text()); return r.json(); }
async function sbPatch(id, b) { const r = await fetch(`${SUPABASE_URL}/rest/v1/${TABLA}?id=eq.${id}`, { method:'PATCH', headers:{...HDR,Prefer:'return=minimal'}, body:JSON.stringify(b) }); if (!r.ok) throw new Error(await r.text()); }
async function sbDelete(id)   { const r = await fetch(`${SUPABASE_URL}/rest/v1/${TABLA}?id=eq.${id}`, { method:'DELETE', headers:HDR }); if (!r.ok) throw new Error(await r.text()); }

function e(s)        { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function fmtFecha(f) { if (!f) return ''; return new Date(f).toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric'}); }

const PRIO_CLS = { Alta:'sol__badge--alta', Media:'sol__badge--media', Baja:'sol__badge--baja' };
function badgePrio(p) {
  if (!p) return '—';
  return `<span class="sol__badge ${PRIO_CLS[p]||''}">${e(p)}</span>`;
}

function badgeEstado(s) {
  if (s.estado === 'rechazado')            return `<span class="sol__badge sol__badge--cerr">Rechazada</span>`;
  if (s.estado === 'pendiente')            return `<span class="sol__badge sol__badge--pend">Sin autorizar</span>`;
  if (s.estado_busqueda === 'cubierto')    return `<span class="sol__badge sol__badge--ok">Cubierta ✓</span>`;
  if (s.estado_busqueda === 'en_busqueda') return `<span class="sol__badge sol__badge--busq">En búsqueda</span>`;
  return `<span class="sol__badge sol__badge--pend">Sin iniciar</span>`;
}

function filtrar(lista, f) {
  if (f === 'sin_autorizar') return lista.filter(s => s.estado === 'pendiente');
  if (f === 'activas')       return lista.filter(s => s.estado === 'aprobado' && s.estado_busqueda !== 'cubierto');
  if (f === 'cubiertas')     return lista.filter(s => s.estado_busqueda === 'cubierto');
  if (f === 'rechazadas')    return lista.filter(s => s.estado === 'rechazado');
  return lista;
}

// ── Columna "línea de tiempo" ─────────────────────────────────────────────────
function renderTimeline(s, contratadosMap) {
  const cands = contratadosMap[s.id] || [];

  const paso = (icono, label, fecha, persona, cls = '') => `
    <div class="bsq-tl__paso ${cls}">
      <span class="bsq-tl__icono">${icono}</span>
      <span class="bsq-tl__info">
        <span class="bsq-tl__label">${label}</span>
        ${fecha  ? `<span class="bsq-tl__fecha">${fmtFecha(fecha)}</span>` : ''}
        ${persona ? `<span class="bsq-tl__persona">${e(persona)}</span>` : ''}
      </span>
    </div>`;

  let html = paso('📋', 'Solicitado', s.created_at, s.solicitado_por);

  if (s.estado === 'rechazado') {
    html += paso('✕', 'Rechazado', s.fecha_aprobacion, s.aprobado_por, 'bsq-tl__paso--rechazo');
  } else if (s.estado === 'aprobado' || s.estado === 'pendiente') {
    if (s.fecha_aprobacion || s.aprobado_por) {
      html += paso('✓', 'Autorizado', s.fecha_aprobacion, s.aprobado_por, 'bsq-tl__paso--ok');
    } else {
      html += paso('…', 'Pendiente autorización', null, null, 'bsq-tl__paso--espera');
    }

    if (cands.length > 0) {
      cands.forEach(c => {
        const nombre = c.apellido ? `${c.apellido}, ${c.nombre}` : (c.nombre || '?');
        html += paso('👤', 'Contratado', c.updated_at, nombre, 'bsq-tl__paso--ok');
      });
    } else if (s.estado_busqueda === 'en_busqueda') {
      html += paso('🔍', 'En búsqueda', null, null, 'bsq-tl__paso--espera');
    }
  }

  return `<div class="bsq-tl">${html}</div>`;
}

export async function renderizarBusquedas(contenedor, alActualizarBadge) {
  contenedor.innerHTML = `<p class="sol__cargando">Cargando búsquedas…</p>`;

  let solicitudes    = [];
  let contratadosMap = {};
  let filtroActivo   = '';

  try {
    solicitudes = await sbGet(`${TABLA}?order=created_at.desc`);
  } catch {
    contenedor.innerHTML = `<div class="estado-vacio"><h3 class="estado-vacio__titulo">Error al cargar</h3><p class="estado-vacio__texto">No se pudieron obtener las búsquedas.</p></div>`;
    return;
  }

  // Auto-iniciar búsquedas aprobadas que quedaron en "pendiente"
  const aPatch = solicitudes.filter(s => s.estado === 'aprobado' && s.estado_busqueda === 'pendiente');
  if (aPatch.length) {
    await Promise.allSettled(aPatch.map(s => sbPatch(s.id, { estado_busqueda: 'en_busqueda' })));
    aPatch.forEach(s => { s.estado_busqueda = 'en_busqueda'; });
  }

  if (solicitudes.length) {
    try {
      const ids = solicitudes.map(s => s.id).join(',');
      const cands = await sbGet(`candidatos?solicitud_id=in.(${ids})&estado=eq.contratado&select=id,nombre,apellido,solicitud_id,updated_at&order=updated_at.asc`);
      cands.forEach(c => {
        if (!contratadosMap[c.solicitud_id]) contratadosMap[c.solicitud_id] = [];
        contratadosMap[c.solicitud_id].push(c);
      });
    } catch (_) {}
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  function filas(lista) {
    if (!lista.length) return `<tr><td colspan="6" class="sol__empty">No hay búsquedas para mostrar.</td></tr>`;
    return lista.map(s => {
      const esCerrada = s.estado_busqueda === 'cubierto' || s.estado === 'rechazado';
      return `
        <tr class="sol__fila${esCerrada ? ' sol__fila--cerrada' : ''}">
          <td class="hist__td-puesto">
            <strong>${e(s.puesto)}</strong>
            ${s.area || s.empresa ? `<br><span class="sol__area">${[s.area, s.empresa].filter(Boolean).map(e).join(' · ')}</span>` : ''}
          </td>
          <td class="hist__td-num">${s.cantidad ?? '—'}</td>
          <td>${badgePrio(s.prioridad)}</td>
          <td>${badgeEstado(s)}</td>
          <td class="bsq__td-tl">${renderTimeline(s, contratadosMap)}</td>
          <td class="sol__td-acciones">
            <button class="sol__btn-eliminar" data-id="${s.id}" data-puesto="${e(s.puesto)}" type="button" title="Eliminar">✕</button>
          </td>
        </tr>`;
    }).join('');
  }

  function renderTabla(lista) {
    return `
      <div class="sol__tabla-wrap">
        <table class="sol__tabla hist__tabla">
          <thead><tr>
            <th>Puesto · Área · Empresa</th>
            <th title="Vacantes solicitadas">Vac.</th>
            <th>Prioridad</th>
            <th>Estado</th>
            <th>Línea de tiempo</th>
            <th></th>
          </tr></thead>
          <tbody>${filas(lista)}</tbody>
        </table>
      </div>`;
  }

  function n(f) { return filtrar(solicitudes, f).length; }
  const nSinAut  = n('sin_autorizar');
  const nActivas = n('activas');

  contenedor.innerHTML = `
    <div class="sol__wrap">
      <div class="sol__topbar">
        <div class="sol__filtros" role="group" aria-label="Filtrar búsquedas">
          <button class="sol__ftab sol__ftab--activo" data-f="" type="button">
            Todas <span class="sol__ftab-count">${solicitudes.length}</span>
          </button>
          <button class="sol__ftab" data-f="sin_autorizar" type="button">
            Sin autorizar ${nSinAut > 0 ? `<span class="sol__ftab-count sol__ftab-count--alert">${nSinAut}</span>` : `<span class="sol__ftab-count">0</span>`}
          </button>
          <button class="sol__ftab" data-f="activas" type="button">
            Activas ${nActivas > 0 ? `<span class="sol__ftab-count sol__ftab-count--alert">${nActivas}</span>` : `<span class="sol__ftab-count">0</span>`}
          </button>
          <button class="sol__ftab" data-f="cubiertas" type="button">
            Cubiertas <span class="sol__ftab-count">${n('cubiertas')}</span>
          </button>
          <button class="sol__ftab" data-f="rechazadas" type="button">
            Rechazadas <span class="sol__ftab-count">${n('rechazadas')}</span>
          </button>
        </div>
      </div>
      <div id="bsq-tabla-area">${renderTabla(solicitudes)}</div>
    </div>`;

  const tabArea = contenedor.querySelector('#bsq-tabla-area');

  function actualizar() {
    tabArea.innerHTML = renderTabla(filtrar(solicitudes, filtroActivo));
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

  function bindAcciones() {
    contenedor.querySelectorAll('.sol__btn-eliminar').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm(`¿Eliminás la búsqueda "${btn.dataset.puesto}"? No se puede deshacer.`)) return;
        btn.disabled = true;
        try {
          await sbDelete(btn.dataset.id);
          const idx = solicitudes.findIndex(x => x.id === btn.dataset.id);
          if (idx !== -1) solicitudes.splice(idx, 1);
          delete contratadosMap[btn.dataset.id];
          actualizar(); alActualizarBadge?.();
        } catch (err) {
          alert('Error: ' + err.message);
          btn.disabled = false;
        }
      });
    });
  }

  bindAcciones();
}
