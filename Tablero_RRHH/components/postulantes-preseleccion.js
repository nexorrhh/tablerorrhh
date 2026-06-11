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

async function sbPost(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: { ...HDR, 'Prefer': 'return=representation' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function sbDelete(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: { ...HDR, 'Prefer': 'return=minimal' },
  });
  if (!res.ok) throw new Error(await res.text());
}

const ESTADO_CLASE = {
  activo:    'presel__badge--activo',
  promovido: 'presel__badge--promovido',
  descartado:'presel__badge--descartado',
};

const ESTADO_LABEL = {
  activo:    'Activo',
  promovido: 'Promovido',
  descartado:'Descartado',
};

function badge(estado) {
  return `<span class="presel__badge ${ESTADO_CLASE[estado] || ''}">${ESTADO_LABEL[estado] || estado}</span>`;
}

export async function renderizarPostulantesPreseleccion(contenedor) {
  contenedor.innerHTML = `<p class="presel__cargando">Cargando preseleccionados…</p>`;

  let lista = [];
  let solicitudesAutorizadas = [];

  try {
    lista = await sbGet('preseleccionados?select=*&order=created_at.desc');
  } catch (_) {
    contenedor.innerHTML = `
      <div class="estado-vacio">
        <h3 class="estado-vacio__titulo">Error al cargar</h3>
        <p class="estado-vacio__texto">No se pudieron obtener los preseleccionados.</p>
      </div>`;
    return;
  }

  // Solicitudes para el dropdown de "Promover" — si falla, el dropdown queda vacío
  try {
    const todas = await sbGet('solicitudes_empleo?select=*&order=created_at.desc');
    solicitudesAutorizadas = todas.filter(s => s.estado === 'autorizado' || s.estado === 'en_busqueda');
  } catch (_) {
    solicitudesAutorizadas = [];
  }

  let filtroEstado = 'activo';
  let filtroTexto  = '';

  function tarjeta(p) {
    return `
      <div class="presel__card presel__card--${p.estado}">
        <div class="presel__card-head">
          <div class="presel__avatar">${iniciales(p.nombre, p.apellido)}</div>
          <div class="presel__info">
            <p class="presel__nombre">${p.apellido ? p.apellido + ', ' : ''}${p.nombre || ''}</p>
            <p class="presel__meta">${[
              p.sector,
              p.edad ? p.edad + ' años' : null,
              p.localidad,
            ].filter(Boolean).join(' · ')}</p>
          </div>
          ${badge(p.estado)}
        </div>
        ${p.notas_rrhh ? `<p class="presel__notas">${p.notas_rrhh}</p>` : ''}
        ${p.observacion_postulante ? `<p class="presel__obs-post">"${p.observacion_postulante}"</p>` : ''}
        <div class="presel__card-foot">
          ${p.cv_url ? `<a class="presel__cv-link" href="${p.cv_url}" target="_blank" rel="noopener">Ver CV</a>` : ''}
          ${p.estado === 'activo' ? `
            <button class="presel__btn-quitar" data-id="${p.id}" type="button" title="Eliminar preselección y volver al estado original">Quitar preselección</button>
            <button class="presel__btn-promover" data-id="${p.id}" type="button">Promover a candidato</button>
            <button class="presel__btn-descartar" data-id="${p.id}" type="button">Descartar</button>
          ` : ''}
          ${p.estado === 'promovido' ? `
            <button class="presel__btn-ascender" data-id="${p.id}" type="button">Volver a preselección</button>
            <button class="presel__btn-eliminar" data-id="${p.id}" type="button">Eliminar</button>
          ` : ''}
          ${p.estado === 'descartado' ? `
            <button class="presel__btn-ascender" data-id="${p.id}" type="button">Ascender a preselección</button>
            <button class="presel__btn-eliminar" data-id="${p.id}" type="button">Eliminar</button>
          ` : ''}
        </div>
        <p class="presel__preselec-por">Preseleccionado por: ${p.preseleccionado_por || '—'}</p>
      </div>
    `;
  }

  function grilla() {
    const txt = filtroTexto.toLowerCase();
    const filtrado = lista.filter(p => {
      const okEst  = !filtroEstado || p.estado === filtroEstado;
      const okTxt  = !txt || [p.nombre, p.apellido, p.sector, p.localidad]
        .some(v => (v || '').toLowerCase().includes(txt));
      return okEst && okTxt;
    });
    if (!filtrado.length) return `<p class="presel__sin-resultados">Sin resultados.</p>`;
    return filtrado.map(p => tarjeta(p)).join('');
  }

  const conteos = {
    '':         lista.length,
    activo:     lista.filter(p => p.estado === 'activo').length,
    promovido:  lista.filter(p => p.estado === 'promovido').length,
    descartado: lista.filter(p => p.estado === 'descartado').length,
  };

  contenedor.innerHTML = `
    <div class="presel__wrap">
      <div class="presel__topbar">
        <div class="presel__filtros" role="group" aria-label="Filtrar por estado">
          <button class="presel__ftab presel__ftab--activo" data-estado="activo" type="button">Preselección <span class="presel__ftab-count">${conteos.activo}</span></button>
          <button class="presel__ftab" data-estado="promovido" type="button">Promovidos <span class="presel__ftab-count">${conteos.promovido}</span></button>
          <button class="presel__ftab" data-estado="descartado" type="button">Rechazados <span class="presel__ftab-count">${conteos.descartado}</span></button>
        </div>
        <input type="search" class="presel__busqueda" id="presel-busqueda"
               placeholder="Buscar por nombre, sector…" autocomplete="off">
      </div>

      <div class="presel__grilla" id="presel-grilla">
        ${grilla()}
      </div>
    </div>

    <!-- Modal: promover a candidato -->
    <div class="presel__modal-overlay" id="presel-modal-promover" hidden>
      <div class="presel__modal" role="dialog" aria-modal="true" aria-labelledby="presel-prom-titulo">
        <h3 class="presel__modal-titulo" id="presel-prom-titulo">Promover a candidato</h3>
        <p class="presel__modal-desc" id="presel-prom-desc"></p>
        <label class="presel__modal-label" for="presel-solicitud">Vincular a solicitud (opcional)</label>
        <select class="presel__modal-input" id="presel-solicitud">
          <option value="">— Sin vincular —</option>
          ${solicitudesAutorizadas.map(s => `
            <option value="${s.id}">${s.puesto} — ${s.empresa} (${s.cantidad ?? '?'} puesto${s.cantidad !== 1 ? 's' : ''})</option>
          `).join('')}
        </select>
        <div class="presel__modal-footer">
          <button class="presel__btn-cancel" type="button" id="presel-prom-cancel">Cancelar</button>
          <button class="presel__btn-ok" type="button" id="presel-prom-ok">Promover</button>
        </div>
      </div>
    </div>
  `;

  // ── Filtros ──
  const grillaEl = contenedor.querySelector('#presel-grilla');
  const busqueda = contenedor.querySelector('#presel-busqueda');
  const tabs     = contenedor.querySelectorAll('.presel__ftab');

  function actualizarGrilla() {
    grillaEl.innerHTML = grilla();
    bindAcciones();
  }

  busqueda.addEventListener('input', () => { filtroTexto = busqueda.value; actualizarGrilla(); });

  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      tabs.forEach(b => b.classList.remove('presel__ftab--activo'));
      btn.classList.add('presel__ftab--activo');
      filtroEstado = btn.dataset.estado;
      actualizarGrilla();
    });
  });

  // ── Modal promover ──
  const modalProm = contenedor.querySelector('#presel-modal-promover');
  const promDesc  = contenedor.querySelector('#presel-prom-desc');
  const selSol    = contenedor.querySelector('#presel-solicitud');
  let idPromover  = null;

  const cerrarProm = () => { modalProm.hidden = true; idPromover = null; };
  contenedor.querySelector('#presel-prom-cancel').addEventListener('click', cerrarProm);
  modalProm.addEventListener('click', e => { if (e.target === modalProm) cerrarProm(); });

  contenedor.querySelector('#presel-prom-ok').addEventListener('click', async () => {
    const btn = contenedor.querySelector('#presel-prom-ok');
    btn.disabled = true;
    btn.textContent = 'Guardando…';
    const p = lista.find(x => x.id === idPromover);
    try {
      const solicitudId = selSol.value || null;
      // Crear candidato
      await sbPost('candidatos', {
        preseleccionado_id:  p.id,
        solicitud_id:        solicitudId || null,
        nombre:              p.nombre,
        apellido:            p.apellido,
        edad:                p.edad,
        localidad:           p.localidad,
        sector:              p.sector,
        cv_url:              p.cv_url,
        estado:              'en_revision',
      });
      // Marcar preseleccionado como promovido
      await sbPatch(`preseleccionados?id=eq.${idPromover}`, { estado: 'promovido' });
      p.estado = 'promovido';
      cerrarProm();
      actualizarGrilla();
    } catch (e) {
      alert('Error al promover:\n' + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Promover';
    }
  });

  function bindAcciones() {
    contenedor.querySelectorAll('.presel__btn-promover').forEach(btn => {
      btn.addEventListener('click', () => {
        idPromover = btn.dataset.id;
        const p = lista.find(x => x.id === idPromover);
        promDesc.textContent = `${p?.apellido || ''} ${p?.nombre || ''} — ${p?.sector || ''}`;
        selSol.value = '';
        modalProm.hidden = false;
      });
    });

    contenedor.querySelectorAll('.presel__btn-descartar').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const p  = lista.find(x => x.id === id);
        if (!confirm(`¿Descartás a ${p?.apellido || ''} ${p?.nombre || ''}?`)) return;
        btn.disabled = true;
        try {
          await sbPatch(`preseleccionados?id=eq.${id}`, { estado: 'descartado' });
          p.estado = 'descartado';
          actualizarGrilla();
        } catch (_) {
          alert('Error al descartar.');
          btn.disabled = false;
        }
      });
    });

    contenedor.querySelectorAll('.presel__btn-ascender').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const p  = lista.find(x => x.id === id);
        btn.disabled = true;
        try {
          await sbPatch(`preseleccionados?id=eq.${id}`, { estado: 'activo' });
          p.estado = 'activo';
          actualizarGrilla();
        } catch (_) {
          alert('Error al ascender. Intentá de nuevo.');
          btn.disabled = false;
        }
      });
    });

    contenedor.querySelectorAll('.presel__btn-eliminar').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const p  = lista.find(x => x.id === id);
        if (!confirm(`¿Eliminás definitivamente el registro de ${p?.apellido || ''} ${p?.nombre || ''}? Esta acción no se puede deshacer.`)) return;
        btn.disabled = true;
        try {
          await sbDelete(`preseleccionados?id=eq.${id}`);
          lista.splice(lista.indexOf(p), 1);
          actualizarGrilla();
        } catch (_) {
          alert('Error al eliminar. Intentá de nuevo.');
          btn.disabled = false;
        }
      });
    });

    contenedor.querySelectorAll('.presel__btn-quitar').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const p  = lista.find(x => x.id === id);
        if (!confirm(`¿Quitás la preselección de ${p?.apellido || ''} ${p?.nombre || ''}? El registro se elimina y la persona vuelve a aparecer como postulante sin marcar.`)) return;
        btn.disabled = true;
        try {
          await sbDelete(`preseleccionados?id=eq.${id}`);
          lista.splice(lista.indexOf(p), 1);
          actualizarGrilla();
        } catch (_) {
          alert('Error al eliminar. Intentá de nuevo.');
          btn.disabled = false;
        }
      });
    });
  }

  bindAcciones();
}

function iniciales(nombre, apellido) {
  const n = (nombre || '')[0] || '';
  const a = (apellido || '')[0] || '';
  return (a + n).toUpperCase() || '?';
}
