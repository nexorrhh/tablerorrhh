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

async function sbDelete(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: { ...HDR, 'Prefer': 'return=minimal' },
  });
  if (!res.ok) throw new Error(await res.text());
}

async function sbPatch(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: { ...HDR, 'Prefer': 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
}

const ESTADO_LABEL = {
  pendiente:   'Pendiente',
  autorizado:  'Autorizado',
  en_busqueda: 'En búsqueda',
  pausado:     'Pausado',
  cerrado:     'Cerrado',
};

const ESTADO_CLASE = {
  pendiente:   'sol__badge--pend',
  autorizado:  'sol__badge--auto',
  en_busqueda: 'sol__badge--busq',
  pausado:     'sol__badge--paus',
  cerrado:     'sol__badge--cerr',
};

function fmtFecha(f) {
  if (!f) return '—';
  return new Date(f).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function badge(estado) {
  return `<span class="sol__badge ${ESTADO_CLASE[estado] || ''}">${ESTADO_LABEL[estado] || estado}</span>`;
}

// alActualizarBadge: callback que llama app.js para refrescar el conteo del sidebar
export async function renderizarPostulantesSolicitudes(contenedor, alActualizarBadge) {
  contenedor.innerHTML = `<p class="sol__cargando">Cargando solicitudes…</p>`;

  let solicitudes = [];
  let candidatosPorSolicitud = {};

  try {
    [solicitudes] = await Promise.all([
      sbGet('solicitudes_empleo?select=*&order=created_at.desc'),
    ]);
  } catch (_) {
    contenedor.innerHTML = `
      <div class="estado-vacio">
        <h3 class="estado-vacio__titulo">Error al cargar</h3>
        <p class="estado-vacio__texto">No se pudieron obtener las solicitudes. Verificá la conexión.</p>
      </div>`;
    return;
  }

  // Contar candidatos vinculados (no bloquea si falla)
  try {
    const cands = await sbGet('candidatos?select=id,solicitud_id');
    cands.forEach(c => {
      if (c.solicitud_id) {
        candidatosPorSolicitud[c.solicitud_id] = (candidatosPorSolicitud[c.solicitud_id] || 0) + 1;
      }
    });
  } catch (_) {}

  let filtroEstado = '';

  function filas(lista) {
    if (!lista.length) return `<tr><td colspan="9" class="sol__empty">No hay solicitudes para mostrar.</td></tr>`;
    return lista.map(s => `
      <tr class="sol__fila">
        <td class="sol__td-puesto">${s.puesto || '—'}</td>
        <td>${s.empresa || '—'}</td>
        <td class="sol__td-num">${s.cantidad ?? '—'}</td>
        <td>${s.solicitado_por || '—'}</td>
        <td class="sol__td-fecha">${fmtFecha(s.fecha_solicitud || s.created_at)}</td>
        <td>${s.autorizado_por || '—'}</td>
        <td>${fmtFecha(s.fecha_autorizacion)}</td>
        <td>${badge(s.estado)}</td>
        <td class="sol__td-num">${candidatosPorSolicitud[s.id] || 0}</td>
        <td class="sol__td-acciones">
          ${s.estado === 'pendiente'
            ? `<button class="sol__btn-autorizar" data-id="${s.id}" type="button">Autorizar</button>`
            : `<button class="sol__btn-estado" data-id="${s.id}" type="button">Estado</button>`
          }
          <button class="sol__btn-eliminar" data-id="${s.id}" data-puesto="${s.puesto || ''}" type="button" title="Eliminar solicitud">✕</button>
        </td>
      </tr>
    `).join('');
  }

  function tablaHTML(lista) {
    return `
      <div class="sol__tabla-wrap">
        <table class="sol__tabla">
          <thead>
            <tr>
              <th>Puesto</th>
              <th>Empresa</th>
              <th>Cant.</th>
              <th>Solicitado por</th>
              <th>Fecha sol.</th>
              <th>Autorizado por</th>
              <th>Fecha aut.</th>
              <th>Estado</th>
              <th>Cands.</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="sol-tbody">
            ${filas(lista)}
          </tbody>
        </table>
      </div>
    `;
  }

  const pendientes = solicitudes.filter(s => s.estado === 'pendiente').length;

  contenedor.innerHTML = `
    <div class="sol__wrap">

      <div class="sol__topbar">
        <div class="sol__filtros" role="group" aria-label="Filtrar por estado">
          <button class="sol__ftab sol__ftab--activo" data-estado="" type="button">Todas <span class="sol__ftab-count">${solicitudes.length}</span></button>
          <button class="sol__ftab" data-estado="pendiente" type="button">
            Pendientes
            ${pendientes > 0 ? `<span class="sol__ftab-count sol__ftab-count--alert">${pendientes}</span>` : `<span class="sol__ftab-count">0</span>`}
          </button>
          <button class="sol__ftab" data-estado="autorizado" type="button">Autorizadas <span class="sol__ftab-count">${solicitudes.filter(s => s.estado === 'autorizado').length}</span></button>
          <button class="sol__ftab" data-estado="en_busqueda" type="button">En búsqueda <span class="sol__ftab-count">${solicitudes.filter(s => s.estado === 'en_busqueda').length}</span></button>
          <button class="sol__ftab" data-estado="cerrado" type="button">Cerradas <span class="sol__ftab-count">${solicitudes.filter(s => s.estado === 'cerrado').length}</span></button>
        </div>
      </div>

      <div class="sol__tabla-area" id="sol-tabla-area">
        ${tablaHTML(solicitudes)}
      </div>

      <!-- Modal: autorizar -->
      <div class="sol__modal-overlay" id="sol-modal-autorizar" hidden>
        <div class="sol__modal" role="dialog" aria-modal="true" aria-labelledby="sol-aut-titulo">
          <h3 class="sol__modal-titulo" id="sol-aut-titulo">Autorizar solicitud</h3>
          <p class="sol__modal-desc" id="sol-aut-desc"></p>
          <label class="sol__modal-label" for="sol-quien">¿Quién autoriza?</label>
          <input class="sol__modal-input" id="sol-quien" type="text" placeholder="Nombre completo del director" autocomplete="off">
          <div class="sol__modal-footer">
            <button class="sol__btn-cancel" type="button" id="sol-aut-cancel">Cancelar</button>
            <button class="sol__btn-ok" type="button" id="sol-aut-ok">Confirmar autorización</button>
          </div>
        </div>
      </div>

      <!-- Modal: cambiar estado -->
      <div class="sol__modal-overlay" id="sol-modal-estado" hidden>
        <div class="sol__modal" role="dialog" aria-modal="true" aria-labelledby="sol-est-titulo">
          <h3 class="sol__modal-titulo" id="sol-est-titulo">Cambiar estado</h3>
          <p class="sol__modal-desc" id="sol-est-desc"></p>
          <label class="sol__modal-label" for="sol-nuevo-estado">Nuevo estado</label>
          <select class="sol__modal-input" id="sol-nuevo-estado">
            <option value="autorizado">Autorizado</option>
            <option value="en_busqueda">En búsqueda</option>
            <option value="pausado">Pausado</option>
            <option value="cerrado">Cerrado</option>
          </select>
          <div class="sol__modal-footer">
            <button class="sol__btn-cancel" type="button" id="sol-est-cancel">Cancelar</button>
            <button class="sol__btn-ok" type="button" id="sol-est-ok">Guardar</button>
          </div>
        </div>
      </div>

    </div>
  `;

  // ── Filtros ──
  const tabArea = contenedor.querySelector('#sol-tabla-area');

  function actualizar() {
    const lista = filtroEstado ? solicitudes.filter(s => s.estado === filtroEstado) : solicitudes;
    tabArea.innerHTML = tablaHTML(lista);
    bindAcciones();
  }

  contenedor.querySelectorAll('.sol__ftab').forEach(btn => {
    btn.addEventListener('click', () => {
      contenedor.querySelectorAll('.sol__ftab').forEach(b => b.classList.remove('sol__ftab--activo'));
      btn.classList.add('sol__ftab--activo');
      filtroEstado = btn.dataset.estado;
      actualizar();
    });
  });

  // ── Modal autorizar ──
  const modalAut   = contenedor.querySelector('#sol-modal-autorizar');
  const autDesc    = contenedor.querySelector('#sol-aut-desc');
  const inputQuien = contenedor.querySelector('#sol-quien');
  let idAutorizar  = null;

  const cerrarAut = () => { modalAut.hidden = true; idAutorizar = null; };
  contenedor.querySelector('#sol-aut-cancel').addEventListener('click', cerrarAut);
  modalAut.addEventListener('click', e => { if (e.target === modalAut) cerrarAut(); });

  contenedor.querySelector('#sol-aut-ok').addEventListener('click', async () => {
    const quien = inputQuien.value.trim();
    if (!quien) { inputQuien.focus(); return; }
    const btn = contenedor.querySelector('#sol-aut-ok');
    btn.disabled = true;
    btn.textContent = 'Guardando…';
    try {
      await sbPatch(`solicitudes_empleo?id=eq.${idAutorizar}`, {
        estado: 'autorizado',
        autorizado_por: quien,
        fecha_autorizacion: new Date().toISOString(),
      });
      const s = solicitudes.find(x => x.id === idAutorizar);
      if (s) { s.estado = 'autorizado'; s.autorizado_por = quien; s.fecha_autorizacion = new Date().toISOString(); }
      cerrarAut();
      actualizar();
      alActualizarBadge?.();
    } catch (_) {
      alert('Error al guardar. Intentá de nuevo.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Confirmar autorización';
    }
  });

  // ── Modal cambiar estado ──
  const modalEst    = contenedor.querySelector('#sol-modal-estado');
  const estDesc     = contenedor.querySelector('#sol-est-desc');
  const selEstado   = contenedor.querySelector('#sol-nuevo-estado');
  let idCambioEstado = null;

  const cerrarEst = () => { modalEst.hidden = true; idCambioEstado = null; };
  contenedor.querySelector('#sol-est-cancel').addEventListener('click', cerrarEst);
  modalEst.addEventListener('click', e => { if (e.target === modalEst) cerrarEst(); });

  contenedor.querySelector('#sol-est-ok').addEventListener('click', async () => {
    const nuevoEstado = selEstado.value;
    const btn = contenedor.querySelector('#sol-est-ok');
    btn.disabled = true;
    btn.textContent = 'Guardando…';
    try {
      await sbPatch(`solicitudes_empleo?id=eq.${idCambioEstado}`, { estado: nuevoEstado });
      const s = solicitudes.find(x => x.id === idCambioEstado);
      if (s) s.estado = nuevoEstado;
      cerrarEst();
      actualizar();
      alActualizarBadge?.();
    } catch (_) {
      alert('Error al guardar. Intentá de nuevo.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Guardar';
    }
  });

  // ── Bind botones de la tabla (se re-bindea al actualizar) ──
  function bindAcciones() {
    contenedor.querySelectorAll('.sol__btn-autorizar').forEach(btn => {
      btn.addEventListener('click', () => {
        idAutorizar = btn.dataset.id;
        const s = solicitudes.find(x => String(x.id) === String(idAutorizar));
        autDesc.textContent = `${s?.puesto || ''} — ${s?.empresa || ''} · ${s?.cantidad ?? '?'} puesto${s?.cantidad !== 1 ? 's' : ''}`;
        inputQuien.value = '';
        modalAut.hidden = false;
        inputQuien.focus();
      });
    });

    contenedor.querySelectorAll('.sol__btn-estado').forEach(btn => {
      btn.addEventListener('click', () => {
        idCambioEstado = btn.dataset.id;
        const s = solicitudes.find(x => String(x.id) === String(idCambioEstado));
        estDesc.textContent = `${s?.puesto || ''} — ${s?.empresa || ''}`;
        selEstado.value = s?.estado || 'autorizado';
        modalEst.hidden = false;
      });
    });

    contenedor.querySelectorAll('.sol__btn-eliminar').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id    = btn.dataset.id;
        const puesto = btn.dataset.puesto || 'esta solicitud';
        if (!confirm(`¿Eliminás la solicitud de "${puesto}"? Esta acción no se puede deshacer.`)) return;
        btn.disabled = true;
        try {
          await sbDelete(`solicitudes_empleo?id=eq.${id}`);
          const idx = solicitudes.findIndex(x => String(x.id) === String(id));
          if (idx !== -1) solicitudes.splice(idx, 1);
          actualizar();
          alActualizarBadge?.();
        } catch (e) {
          alert('Error al eliminar:\n' + e.message);
          btn.disabled = false;
        }
      });
    });
  }

  bindAcciones();
}
