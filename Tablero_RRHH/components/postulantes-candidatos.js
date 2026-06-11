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

// ── Estados posibles del candidato ──────────────────────────────────────────
// Verificar que estos valores coincidan con el CHECK constraint de la tabla candidatos en Supabase.
const ESTADOS = [
  { value: 'en_revision',                 label: 'En revisión' },
  { value: 'contactar',                   label: 'A contactar' },
  { value: 'contactado',                  label: 'Contactado' },
  { value: 'entrevista_rrhh_programada',  label: '1ª entrevista programada' },
  { value: 'entrevista_rrhh_realizada',   label: '1ª entrevista realizada' },
  { value: 'aprobado_rrhh',               label: 'Aprobado por RRHH' },
  { value: 'rechazado_rrhh',              label: 'Rechazado por RRHH' },
  { value: 'entrevista_prod_programada',  label: '2ª entrevista programada' },
  { value: 'entrevista_prod_realizada',   label: '2ª entrevista realizada' },
  { value: 'aprobado_produccion',         label: 'Aprobado por producción' },
  { value: 'rechazado_produccion',        label: 'Rechazado por producción' },
  { value: 'oferta_enviada',              label: 'Oferta enviada' },
  { value: 'oferta_aceptada',             label: 'Oferta aceptada' },
  { value: 'contratado',                  label: 'Contratado ✓' },
  { value: 'descartado',                  label: 'Descartado' },
];

const ESTADOS_MAP = Object.fromEntries(ESTADOS.map(e => [e.value, e.label]));

const ESTADO_GRUPO = {
  en_revision: 'neutro', contactar: 'neutro', contactado: 'neutro',
  entrevista_rrhh_programada: 'proceso', entrevista_rrhh_realizada: 'proceso',
  aprobado_rrhh: 'ok', rechazado_rrhh: 'mal',
  entrevista_prod_programada: 'proceso', entrevista_prod_realizada: 'proceso',
  aprobado_produccion: 'ok', rechazado_produccion: 'mal',
  oferta_enviada: 'proceso', oferta_aceptada: 'ok',
  contratado: 'contratado', descartado: 'mal',
};

function badge(estado) {
  const grupo = ESTADO_GRUPO[estado] || 'neutro';
  return `<span class="cand__badge cand__badge--${grupo}">${ESTADOS_MAP[estado] || estado}</span>`;
}

function fmtFecha(f) {
  if (!f) return '';
  return new Date(f).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function opcionesEstado(seleccionado) {
  return ESTADOS.map(e =>
    `<option value="${e.value}" ${e.value === seleccionado ? 'selected' : ''}>${e.label}</option>`
  ).join('');
}

export async function renderizarPostulantesCandidatos(contenedor) {
  contenedor.innerHTML = `<p class="cand__cargando">Cargando candidatos…</p>`;

  let candidatos   = [];
  let solicitudes  = [];

  try {
    candidatos = await sbGet('candidatos?select=*&order=created_at.desc');
  } catch (_) {
    contenedor.innerHTML = `
      <div class="estado-vacio">
        <h3 class="estado-vacio__titulo">Error al cargar</h3>
        <p class="estado-vacio__texto">No se pudieron obtener los candidatos.</p>
      </div>`;
    return;
  }

  // Solicitudes para el dropdown de vinculación — si falla, queda vacío
  try {
    solicitudes = await sbGet('solicitudes_empleo?select=id,puesto,empresa,cantidad&order=created_at.desc');
  } catch (_) {
    solicitudes = [];
  }

  const solMap = Object.fromEntries(solicitudes.map(s => [s.id, s]));

  // ── Estado de la vista ──
  let filtroEstado = '';
  let filtroTexto  = '';
  let candidatoActivo = null;  // id del candidato abierto en el panel de detalle

  // ── Layout ──────────────────────────────────────────────────────────────────
  contenedor.innerHTML = `
    <div class="cand__layout">

      <!-- Panel lista -->
      <aside class="cand__lista-panel" id="cand-lista-panel">
        <div class="cand__lista-filtros">
          <input type="search" class="cand__busqueda" id="cand-busqueda"
                 placeholder="Buscar por nombre…" autocomplete="off">
          <select class="cand__sel-estado" id="cand-sel-estado">
            <option value="">Todos los estados</option>
            ${ESTADOS.map(e => `<option value="${e.value}">${e.label}</option>`).join('')}
          </select>
        </div>
        <div class="cand__lista" id="cand-lista"></div>
      </aside>

      <!-- Panel detalle -->
      <main class="cand__detalle-panel" id="cand-detalle-panel">
        <div class="cand__detalle-vacio" id="cand-detalle-vacio">
          <p>Seleccioná un candidato para ver su ficha.</p>
        </div>
        <div class="cand__detalle" id="cand-detalle" hidden></div>
      </main>

    </div>
  `;

  const listaEl   = contenedor.querySelector('#cand-lista');
  const detalleEl = contenedor.querySelector('#cand-detalle');
  const vacioEl   = contenedor.querySelector('#cand-detalle-vacio');
  const busqueda  = contenedor.querySelector('#cand-busqueda');
  const selEstado = contenedor.querySelector('#cand-sel-estado');

  // ── Renderizar lista ─────────────────────────────────────────────────────────
  function actualizarLista() {
    const txt = filtroTexto.toLowerCase();
    const filtrada = candidatos.filter(c => {
      const okEst = !filtroEstado || c.estado === filtroEstado;
      const okTxt = !txt || [c.nombre, c.apellido, c.sector]
        .some(v => (v || '').toLowerCase().includes(txt));
      return okEst && okTxt;
    });

    if (!filtrada.length) {
      listaEl.innerHTML = `<p class="cand__lista-vacia">Sin resultados.</p>`;
      return;
    }

    listaEl.innerHTML = filtrada.map(c => {
      const sol = c.solicitud_id ? solMap[c.solicitud_id] : null;
      return `
        <button class="cand__item ${c.id === candidatoActivo ? 'cand__item--activo' : ''}"
                data-id="${c.id}" type="button">
          <div class="cand__item-avatar">${iniciales(c.nombre, c.apellido)}</div>
          <div class="cand__item-info">
            <p class="cand__item-nombre">${c.apellido ? c.apellido + ', ' : ''}${c.nombre || ''}</p>
            <p class="cand__item-sector">${c.sector || '—'}${sol ? ` · ${sol.puesto}` : ''}</p>
          </div>
          ${badge(c.estado)}
        </button>
      `;
    }).join('');

    listaEl.querySelectorAll('.cand__item').forEach(btn => {
      btn.addEventListener('click', () => {
        candidatoActivo = btn.dataset.id;
        listaEl.querySelectorAll('.cand__item').forEach(b => b.classList.remove('cand__item--activo'));
        btn.classList.add('cand__item--activo');
        abrirDetalle(candidatoActivo);
      });
    });
  }

  busqueda.addEventListener('input', () => { filtroTexto = busqueda.value; actualizarLista(); });
  selEstado.addEventListener('change', () => { filtroEstado = selEstado.value; actualizarLista(); });

  // Auto-seleccionar el primero al cargar
  if (candidatos.length > 0) {
    candidatoActivo = candidatos[0].id;
    abrirDetalle(candidatoActivo);
  }

  // ── Panel de detalle ─────────────────────────────────────────────────────────
  function abrirDetalle(id) {
    const c   = candidatos.find(x => x.id === id);
    const sol = c?.solicitud_id ? solMap[c.solicitud_id] : null;

    vacioEl.style.display   = 'none';
    detalleEl.style.display = 'block';

    detalleEl.innerHTML = `
      <div class="cand__det-header">
        <div class="cand__det-avatar">${iniciales(c.nombre, c.apellido)}</div>
        <div class="cand__det-titulo">
          <h2 class="cand__det-nombre">${c.apellido ? c.apellido + ', ' : ''}${c.nombre || ''}</h2>
          <p class="cand__det-meta">${[c.sector, c.edad ? c.edad + ' años' : null, c.localidad].filter(Boolean).join(' · ')}</p>
        </div>
        ${badge(c.estado)}
      </div>

      ${sol ? `
        <div class="cand__solicitud-box">
          <p class="cand__solicitud-label">Solicitud vinculada</p>
          <p class="cand__solicitud-val">${sol.puesto} — ${sol.empresa} (${sol.cantidad ?? '?'} puesto${sol.cantidad !== 1 ? 's' : ''})</p>
        </div>
      ` : ''}

      ${c.cv_url ? `<a class="cand__cv-link" href="${c.cv_url}" target="_blank" rel="noopener">Ver CV / Currículum</a>` : ''}

      <form class="cand__form" id="cand-form" novalidate>

        <fieldset class="cand__fieldset">
          <legend class="cand__legend">Primera entrevista (RRHH)</legend>
          <div class="cand__fila-2">
            <div class="cand__campo">
              <label class="cand__label" for="cand-f1-fecha">Fecha</label>
              <input class="cand__input" type="date" id="cand-f1-fecha" name="primera_entrevista_fecha"
                     value="${c.primera_entrevista_fecha || ''}">
            </div>
            <div class="cand__campo">
              <label class="cand__label" for="cand-f1-resultado">Resultado</label>
              <select class="cand__input" id="cand-f1-resultado" name="resultado_rrhh">
                <option value="">—</option>
                <option value="pendiente"   ${c.resultado_rrhh === 'pendiente' ? 'selected' : ''}>Pendiente</option>
                <option value="aprobado"    ${c.resultado_rrhh === 'aprobado'  ? 'selected' : ''}>Aprobado</option>
                <option value="rechazado"   ${c.resultado_rrhh === 'rechazado' ? 'selected' : ''}>Rechazado</option>
                <option value="en_revision" ${c.resultado_rrhh === 'en_revision' ? 'selected' : ''}>En revisión</option>
              </select>
            </div>
          </div>
          <div class="cand__campo">
            <label class="cand__label" for="cand-f1-obs">Observaciones RRHH</label>
            <textarea class="cand__textarea" id="cand-f1-obs" name="observacion_rrhh" rows="3">${c.observacion_rrhh || ''}</textarea>
          </div>
        </fieldset>

        <fieldset class="cand__fieldset">
          <legend class="cand__legend">Segunda entrevista (Producción)</legend>
          <div class="cand__fila-2">
            <div class="cand__campo">
              <label class="cand__label" for="cand-rem">Remuneración pretendida</label>
              <input class="cand__input" type="number" id="cand-rem" name="remuneracion_pretendida"
                     value="${c.remuneracion_pretendida || ''}" placeholder="$ 0.00" min="0">
            </div>
            <div class="cand__campo">
              <label class="cand__label" for="cand-f2-fecha">Fecha</label>
              <input class="cand__input" type="date" id="cand-f2-fecha" name="segunda_entrevista_fecha"
                     value="${c.segunda_entrevista_fecha || ''}">
            </div>
          </div>
          <div class="cand__campo">
            <label class="cand__label" for="cand-f2-resultado">Resultado</label>
            <select class="cand__input" id="cand-f2-resultado" name="resultado_produccion">
              <option value="">—</option>
              <option value="pendiente"   ${c.resultado_produccion === 'pendiente'   ? 'selected' : ''}>Pendiente</option>
              <option value="aprobado"    ${c.resultado_produccion === 'aprobado'    ? 'selected' : ''}>Aprobado</option>
              <option value="rechazado"   ${c.resultado_produccion === 'rechazado'   ? 'selected' : ''}>Rechazado</option>
              <option value="en_revision" ${c.resultado_produccion === 'en_revision' ? 'selected' : ''}>En revisión</option>
            </select>
          </div>
          <div class="cand__campo">
            <label class="cand__label" for="cand-f2-obs">Observaciones Producción</label>
            <textarea class="cand__textarea" id="cand-f2-obs" name="observacion_produccion" rows="3">${c.observacion_produccion || ''}</textarea>
          </div>
        </fieldset>

        <fieldset class="cand__fieldset">
          <legend class="cand__legend">Estado y notas</legend>
          <div class="cand__campo">
            <label class="cand__label" for="cand-estado">Estado del proceso</label>
            <select class="cand__input" id="cand-estado" name="estado">
              ${opcionesEstado(c.estado)}
            </select>
          </div>
          <div class="cand__campo">
            <label class="cand__label" for="cand-notas">Notas internas</label>
            <textarea class="cand__textarea" id="cand-notas" name="notas" rows="3">${c.notas || ''}</textarea>
          </div>
        </fieldset>

        <div class="cand__form-footer">
          <button class="cand__btn-eliminar" type="button" id="cand-eliminar">Eliminar candidato</button>
          <span class="cand__guardado-msg" id="cand-guardado-msg"></span>
          <button class="cand__btn-guardar" type="submit" id="cand-guardar">Guardar cambios</button>
        </div>

      </form>
    `;

    // ── Submit form ──
    const form    = detalleEl.querySelector('#cand-form');
    const msgEl   = detalleEl.querySelector('#cand-guardado-msg');
    const guardar = detalleEl.querySelector('#cand-guardar');

    form.addEventListener('submit', async e => {
      e.preventDefault();
      guardar.disabled = true;
      guardar.textContent = 'Guardando…';
      msgEl.textContent = '';
      msgEl.className = 'cand__guardado-msg';

      const datos = {
        primera_entrevista_fecha: form.primera_entrevista_fecha.value || null,
        resultado_rrhh:           form.resultado_rrhh.value || null,
        observacion_rrhh:         form.observacion_rrhh.value.trim() || null,
        remuneracion_pretendida:  form.remuneracion_pretendida.value ? Number(form.remuneracion_pretendida.value) : null,
        segunda_entrevista_fecha: form.segunda_entrevista_fecha.value || null,
        resultado_produccion:     form.resultado_produccion.value || null,
        observacion_produccion:   form.observacion_produccion.value.trim() || null,
        estado:                   form.estado.value,
        notas:                    form.notas.value.trim() || null,
        updated_at:               new Date().toISOString(),
      };

      try {
        await sbPatch(`candidatos?id=eq.${id}`, datos);
        // Actualizar cache local
        Object.assign(c, datos);
        msgEl.textContent = 'Guardado correctamente.';
        msgEl.classList.add('cand__guardado-msg--ok');
        actualizarLista();
        // Refrescar badge del estado en el header del detalle
        detalleEl.querySelector('.cand__badge').outerHTML = badge(datos.estado);
      } catch (_) {
        msgEl.textContent = 'Error al guardar. Intentá de nuevo.';
        msgEl.classList.add('cand__guardado-msg--error');
      } finally {
        guardar.disabled = false;
        guardar.textContent = 'Guardar cambios';
        setTimeout(() => { msgEl.textContent = ''; msgEl.className = 'cand__guardado-msg'; }, 4000);
      }
    });

    // ── Eliminar candidato ──
    detalleEl.querySelector('#cand-eliminar').addEventListener('click', async () => {
      const btnEl = detalleEl.querySelector('#cand-eliminar');
      if (!confirm(`¿Eliminás el candidato ${c.apellido || ''} ${c.nombre || ''}? Esta acción no se puede deshacer.`)) return;
      btnEl.disabled = true;
      try {
        await sbDelete(`candidatos?id=eq.${c.id}`);
        // Revertir el preseleccionado a activo para que vuelva al flujo
        if (c.preseleccionado_id) {
          await sbPatch(`preseleccionados?id=eq.${c.preseleccionado_id}`, { estado: 'activo' });
        }
        candidatos.splice(candidatos.indexOf(c), 1);
        candidatoActivo = null;
        vacioEl.style.display   = 'block';
        detalleEl.style.display = 'none';
        detalleEl.innerHTML     = '';
        actualizarLista();
      } catch (e) {
        alert('Error al eliminar:\n' + e.message);
        btnEl.disabled = false;
      }
    });
  }

  actualizarLista();
}

function iniciales(nombre, apellido) {
  const n = (nombre || '')[0] || '';
  const a = (apellido || '')[0] || '';
  return (a + n).toUpperCase() || '?';
}
