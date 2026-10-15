import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';

const HDR = {
  'Content-Type': 'application/json',
  'apikey': SUPABASE_ANON_KEY,
  'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
};

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: HDR });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function sbPatch(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: { ...HDR, 'Prefer': 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
}

async function sbDelete(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: { ...HDR, 'Prefer': 'return=minimal' },
  });
  if (!res.ok) throw new Error(await res.text());
}

function fmtFecha(f) {
  if (!f) return '—';
  return new Date(f).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export async function renderizarPostulantesRechazados(contenedor) {
  contenedor.innerHTML = `<p class="rech__cargando">Cargando rechazados…</p>`;

  let lista = [];
  try {
    lista = await sbGet('preseleccionados?select=*&estado=eq.descartado&order=created_at.desc');
  } catch (_) {
    contenedor.innerHTML = `
      <div class="estado-vacio">
        <h3 class="estado-vacio__titulo">Error al cargar</h3>
        <p class="estado-vacio__texto">No se pudieron obtener los rechazados.</p>
      </div>`;
    return;
  }

  const sectoresUnicos = [...new Set(lista.flatMap(p => (p.sector || '').split(',').map(s => s.trim())).filter(Boolean))].sort();

  let filtroTexto  = '';
  let filtroSector = '';

  function tarjeta(p) {
    const sectores = (p.sector || '').split(',').map(s => s.trim()).filter(Boolean);
    return `
      <div class="rech__card">
        <div class="rech__card-head">
          <div class="rech__avatar">${iniciales(p.nombre, p.apellido)}</div>
          <div class="rech__info">
            <p class="rech__nombre">${p.apellido ? p.apellido + ', ' : ''}${p.nombre || ''}</p>
            <p class="rech__meta">${[p.edad ? p.edad + ' años' : null, p.localidad].filter(Boolean).join(' · ')}</p>
          </div>
          <span class="rech__fecha-badge">${fmtFecha(p.created_at)}</span>
        </div>

        <div class="rech__sectores">
          ${sectores.map(s => `<span class="rech__sector-tag">${s}</span>`).join('')}
        </div>

        ${p.notas_rrhh ? `
          <div class="rech__motivo">
            <span class="rech__motivo-label">Motivo:</span>
            <span class="rech__motivo-texto">${p.notas_rrhh}</span>
          </div>
        ` : ''}

        ${p.observacion_postulante ? `<p class="rech__obs-post">"${p.observacion_postulante}"</p>` : ''}

        <div class="rech__card-foot">
          ${p.cv_url ? `<a class="rech__cv-link" href="${p.cv_url}" target="_blank" rel="noopener">Ver CV</a>` : ''}
          <button class="rech__btn-eliminar" data-id="${p.id}" type="button" title="Eliminar registro definitivamente">Eliminar</button>
          <button class="rech__btn-reactivar" data-id="${p.id}" type="button">Reactivar preselección</button>
        </div>
      </div>
    `;
  }

  function listaFiltrada() {
    const txt = filtroTexto.toLowerCase();
    return lista.filter(p => {
      const sectores = (p.sector || '').toLowerCase();
      const okSector = !filtroSector || sectores.includes(filtroSector.toLowerCase());
      const okTexto  = !txt || [p.nombre, p.apellido, p.localidad, p.sector, p.notas_rrhh]
        .some(v => (v || '').toLowerCase().includes(txt));
      return okSector && okTexto;
    });
  }

  contenedor.innerHTML = `
    <div class="rech__wrap">
      <div class="rech__topbar">
        <input type="search" class="rech__busqueda" id="rech-busqueda"
               placeholder="Buscar por nombre, localidad, motivo…" autocomplete="off">
        <div class="rech__sector-pills" role="group" aria-label="Filtrar por sector">
          <button class="rech__pill rech__pill--activo" data-sector="" type="button">Todos</button>
          ${sectoresUnicos.map(s => `
            <button class="rech__pill" data-sector="${s}" type="button">${s}</button>
          `).join('')}
        </div>
      </div>
      <p class="rech__conteo" id="rech-conteo">${lista.length} rechazado${lista.length !== 1 ? 's' : ''}</p>
      <div class="rech__grilla" id="rech-grilla"></div>
    </div>
  `;

  const grillaEl = contenedor.querySelector('#rech-grilla');
  const conteoEl = contenedor.querySelector('#rech-conteo');
  const busqueda = contenedor.querySelector('#rech-busqueda');
  const pills    = contenedor.querySelectorAll('.rech__pill');

  function actualizarGrilla() {
    const filtrada = listaFiltrada();
    conteoEl.textContent = `${filtrada.length} rechazado${filtrada.length !== 1 ? 's' : ''}`;
    grillaEl.innerHTML = filtrada.length
      ? filtrada.map(p => tarjeta(p)).join('')
      : `<p class="rech__sin-resultados">Sin resultados.</p>`;
    bindAcciones();
  }

  busqueda.addEventListener('input', () => { filtroTexto = busqueda.value; actualizarGrilla(); });
  pills.forEach(btn => {
    btn.addEventListener('click', () => {
      pills.forEach(b => b.classList.remove('rech__pill--activo'));
      btn.classList.add('rech__pill--activo');
      filtroSector = btn.dataset.sector;
      actualizarGrilla();
    });
  });

  function bindAcciones() {
    contenedor.querySelectorAll('.rech__btn-reactivar').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const p  = lista.find(x => x.id === id);
        btn.disabled = true;
        try {
          await sbPatch(`preseleccionados?id=eq.${id}`, { estado: 'activo' });
          lista.splice(lista.indexOf(p), 1);
          actualizarGrilla();
        } catch (_) {
          alert('Error al reactivar.');
          btn.disabled = false;
        }
      });
    });

    contenedor.querySelectorAll('.rech__btn-eliminar').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const p  = lista.find(x => x.id === id);
        if (!confirm(`¿Eliminás el registro de ${p?.apellido || ''} ${p?.nombre || ''}? Esta acción no se puede deshacer.`)) return;
        btn.disabled = true;
        try {
          await sbDelete(`preseleccionados?id=eq.${id}`);
          lista.splice(lista.indexOf(p), 1);
          actualizarGrilla();
        } catch (_) {
          alert('Error al eliminar.');
          btn.disabled = false;
        }
      });
    });
  }

  actualizarGrilla();
}

function iniciales(nombre, apellido) {
  const n = (nombre || '')[0] || '';
  const a = (apellido || '')[0] || '';
  return (a + n).toUpperCase() || '?';
}
