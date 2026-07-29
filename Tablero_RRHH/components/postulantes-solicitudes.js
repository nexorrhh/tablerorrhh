import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';

const TABLA = 'solicitudes_personal';
const HDR = {
  'Content-Type': 'application/json',
  apikey:        SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
};

async function sbGet(q)       { const r = await fetch(`${SUPABASE_URL}/rest/v1/${TABLA}?${q}`, { headers: HDR }); if (!r.ok) throw new Error(await r.text()); return r.json(); }
async function sbPatch(id, b) { const r = await fetch(`${SUPABASE_URL}/rest/v1/${TABLA}?id=eq.${id}`, { method:'PATCH', headers:{...HDR,Prefer:'return=minimal'}, body:JSON.stringify(b) }); if (!r.ok) throw new Error(await r.text()); }
async function sbDelete(id)   { const r = await fetch(`${SUPABASE_URL}/rest/v1/${TABLA}?id=eq.${id}`, { method:'DELETE', headers: HDR }); if (!r.ok) throw new Error(await r.text()); }

function e(s)       { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function fmtFecha(f){ if (!f) return '—'; return new Date(f).toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' }); }

const PRIO_CLS = { Alta:'sol__badge--alta', Media:'sol__badge--media', Baja:'sol__badge--baja' };

function badgePrio(p) {
  if (!p) return '—';
  return `<span class="sol__badge ${PRIO_CLS[p]||''}">${e(p)}</span>`;
}

function badgeEstado(s) {
  const cfg = { pendiente:{cls:'sol__badge--pend',txt:'Pendiente'}, aprobado:{cls:'sol__badge--auto',txt:'Aprobado'}, rechazado:{cls:'sol__badge--cerr',txt:'Rechazado'} };
  const {cls,txt} = cfg[s] || {cls:'',txt:e(s)};
  return `<span class="sol__badge ${cls}">${txt}</span>`;
}

function badgeBusqueda(sb) {
  const cfg = { pendiente:{cls:'sol__badge--pend',txt:'Sin iniciar'}, en_busqueda:{cls:'sol__badge--busq',txt:'En búsqueda'}, cubierto:{cls:'sol__badge--ok',txt:'Cubierto'} };
  const {cls,txt} = cfg[sb] || {cls:'',txt:e(sb)};
  return `<span class="sol__badge ${cls}">${txt}</span>`;
}

function filtrar(lista, f) {
  if (f === 'pendiente')   return lista.filter(s => s.estado === 'pendiente');
  if (f === 'aprobado')    return lista.filter(s => s.estado === 'aprobado');
  if (f === 'en_busqueda') return lista.filter(s => s.estado === 'aprobado' && s.estado_busqueda === 'en_busqueda');
  if (f === 'cerrado')     return lista.filter(s => s.estado_busqueda === 'cubierto' || s.estado === 'rechazado');
  return lista;
}

const BUSQUEDA_SIG   = { pendiente:'en_busqueda', en_busqueda:'cubierto' };
const BUSQUEDA_LABEL = { pendiente:'Sin iniciar', en_busqueda:'En búsqueda', cubierto:'Cubierto' };

export async function renderizarPostulantesSolicitudes(contenedor, alActualizarBadge) {
  contenedor.innerHTML = `<p class="sol__cargando">Cargando solicitudes…</p>`;

  let solicitudes  = [];
  let filtroActivo = '';

  try {
    solicitudes = await sbGet('order=created_at.desc');
  } catch {
    contenedor.innerHTML = `<div class="estado-vacio"><h3 class="estado-vacio__titulo">Error al cargar</h3><p class="estado-vacio__texto">No se pudieron obtener las solicitudes.</p></div>`;
    return;
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  function filas(lista) {
    if (!lista.length) return `<tr><td colspan="9" class="sol__empty">No hay solicitudes para mostrar.</td></tr>`;
    return lista.map(s => {
      const esPend    = s.estado === 'pendiente';
      const esAprob   = s.estado === 'aprobado';
      const esCubierto = s.estado_busqueda === 'cubierto';
      const esCerrada  = s.estado === 'rechazado' || esCubierto;
      return `
        <tr class="sol__fila${esCerrada ? ' sol__fila--cerrada' : ''}">
          <td class="sol__td-puesto">
            <strong>${e(s.puesto)}</strong>
            ${s.area ? `<br><span class="sol__area">${e(s.area)}</span>` : ''}
          </td>
          <td>${e(s.empresa)||'—'}</td>
          <td class="sol__td-num">${s.cantidad??'—'}</td>
          <td>${badgePrio(s.prioridad)}</td>
          <td>${e(s.solicitado_por)||'—'}</td>
          <td class="sol__td-fecha">${fmtFecha(s.created_at)}</td>
          <td>
            ${badgeEstado(s.estado)}
            ${esAprob ? `<br>${badgeBusqueda(s.estado_busqueda)}` : ''}
          </td>
          <td>${e(s.aprobado_por)||'—'}</td>
          <td class="sol__td-acciones">
            ${esPend
              ? `<button class="sol__btn-autorizar" data-id="${s.id}" type="button">Aprobar</button>
                 <button class="sol__btn-rechazar"  data-id="${s.id}" data-puesto="${e(s.puesto)}" type="button">Rechazar</button>`
              : esAprob && !esCubierto
              ? `<button class="sol__btn-estado" data-id="${s.id}" data-eb="${e(s.estado_busqueda)}" type="button">Avanzar búsqueda</button>`
              : ''}
            <button class="sol__btn-eliminar" data-id="${s.id}" data-puesto="${e(s.puesto)}" type="button" title="Eliminar">✕</button>
          </td>
        </tr>`;
    }).join('');
  }

  function renderTabla(lista) {
    return `
      <div class="sol__tabla-wrap">
        <table class="sol__tabla">
          <thead><tr>
            <th>Puesto · Área</th><th>Empresa</th><th>Cant.</th><th>Prioridad</th>
            <th>Solicitado por</th><th>Fecha</th><th>Estado</th><th>Aprobado por</th><th></th>
          </tr></thead>
          <tbody>${filas(lista)}</tbody>
        </table>
      </div>`;
  }

  function n(f) { return filtrar(solicitudes, f).length; }
  const pend = n('pendiente');

  contenedor.innerHTML = `
    <div class="sol__wrap">
      <div class="sol__topbar">
        <div class="sol__filtros" role="group" aria-label="Filtrar por estado">
          <button class="sol__ftab sol__ftab--activo" data-f="" type="button">
            Todas <span class="sol__ftab-count">${solicitudes.length}</span>
          </button>
          <button class="sol__ftab" data-f="pendiente" type="button">
            Pendientes ${pend > 0 ? `<span class="sol__ftab-count sol__ftab-count--alert">${pend}</span>` : `<span class="sol__ftab-count">0</span>`}
          </button>
          <button class="sol__ftab" data-f="aprobado" type="button">
            Autorizadas <span class="sol__ftab-count">${n('aprobado')}</span>
          </button>
          <button class="sol__ftab" data-f="en_busqueda" type="button">
            En búsqueda <span class="sol__ftab-count">${n('en_busqueda')}</span>
          </button>
          <button class="sol__ftab" data-f="cerrado" type="button">
            Cerradas <span class="sol__ftab-count">${n('cerrado')}</span>
          </button>
        </div>
      </div>
      <div id="sol-tabla-area">${renderTabla(solicitudes)}</div>
    </div>`;

  const tabArea = contenedor.querySelector('#sol-tabla-area');

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

  // ── Helpers de modal ─────────────────────────────────────────────────────────
  function abrirModal(id, html) {
    document.getElementById(id)?.remove();
    const modal = document.createElement('div');
    modal.id        = id;
    modal.className = 'sol__modal-overlay';
    modal.innerHTML = html;
    document.body.appendChild(modal);
    const sc = document.querySelector('.app-contenido');
    if (sc) sc.style.overflow = 'hidden';
    const cerrar = () => { modal.remove(); if (sc) sc.style.overflow = ''; };
    modal.addEventListener('click', ev => { if (ev.target === modal) cerrar(); });
    return { modal, cerrar };
  }

  // ── Modal: aprobar ───────────────────────────────────────────────────────────
  function abrirModalAprobar(solId) {
    const s = solicitudes.find(x => x.id === solId);
    const { modal, cerrar } = abrirModal('sol-modal-aprobar', `
      <div class="sol__modal" role="dialog" aria-modal="true">
        <h3 class="sol__modal-titulo">Aprobar solicitud</h3>
        <p class="sol__modal-desc">${e(s?.puesto)} — ${e(s?.empresa)} · ${s?.cantidad??'?'} puesto${s?.cantidad!==1?'s':''}</p>
        <label class="sol__modal-label" for="sol-quien">¿Quién aprueba? *</label>
        <input class="sol__modal-input" id="sol-quien" type="text" placeholder="Nombre del director" autocomplete="off">
        <label class="sol__modal-label" for="sol-notas-dir">Notas (opcional)</label>
        <textarea class="sol__modal-input" id="sol-notas-dir" rows="2" placeholder="Observaciones…"></textarea>
        <div class="sol__modal-footer">
          <button class="sol__btn-cancel" id="sol-ap-cancel" type="button">Cancelar</button>
          <button class="sol__btn-ok"     id="sol-ap-ok"     type="button">Confirmar aprobación</button>
        </div>
      </div>`);
    modal.querySelector('#sol-ap-cancel').addEventListener('click', cerrar);
    const inputQuien = modal.querySelector('#sol-quien');
    setTimeout(() => inputQuien.focus({ preventScroll: true }), 40);

    modal.querySelector('#sol-ap-ok').addEventListener('click', async () => {
      const quien = inputQuien.value.trim();
      if (!quien) { inputQuien.focus(); return; }
      const notas = modal.querySelector('#sol-notas-dir').value.trim() || null;
      const btn = modal.querySelector('#sol-ap-ok');
      btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        await sbPatch(solId, { estado:'aprobado', aprobado_por:quien, fecha_aprobacion:new Date().toISOString(), notas_director:notas, estado_busqueda:'pendiente' });
        const rec = solicitudes.find(x => x.id === solId);
        if (rec) Object.assign(rec, { estado:'aprobado', aprobado_por:quien, fecha_aprobacion:new Date().toISOString(), notas_director:notas, estado_busqueda:'pendiente' });
        cerrar(); actualizar(); alActualizarBadge?.();
      } catch (err) {
        alert('Error: ' + err.message);
        btn.disabled = false; btn.textContent = 'Confirmar aprobación';
      }
    });
  }

  // ── Modal: rechazar ──────────────────────────────────────────────────────────
  function abrirModalRechazar(solId, puesto) {
    const { modal, cerrar } = abrirModal('sol-modal-rechazar', `
      <div class="sol__modal" role="dialog" aria-modal="true">
        <h3 class="sol__modal-titulo">Rechazar solicitud</h3>
        <p class="sol__modal-desc">Solicitud: <strong>${e(puesto)}</strong></p>
        <label class="sol__modal-label" for="sol-notas-rec">Motivo del rechazo (opcional)</label>
        <textarea class="sol__modal-input" id="sol-notas-rec" rows="2" placeholder="Observaciones…"></textarea>
        <div class="sol__modal-footer">
          <button class="sol__btn-cancel"    id="sol-rec-cancel" type="button">Cancelar</button>
          <button class="sol__btn-ok sol__btn-ok--danger" id="sol-rec-ok" type="button">Rechazar</button>
        </div>
      </div>`);
    modal.querySelector('#sol-rec-cancel').addEventListener('click', cerrar);
    setTimeout(() => modal.querySelector('#sol-notas-rec').focus({ preventScroll: true }), 40);

    modal.querySelector('#sol-rec-ok').addEventListener('click', async () => {
      const notas = modal.querySelector('#sol-notas-rec').value.trim() || null;
      const btn = modal.querySelector('#sol-rec-ok');
      btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        await sbPatch(solId, { estado:'rechazado', notas_director:notas });
        const rec = solicitudes.find(x => x.id === solId);
        if (rec) Object.assign(rec, { estado:'rechazado', notas_director:notas });
        cerrar(); actualizar(); alActualizarBadge?.();
      } catch (err) {
        alert('Error: ' + err.message);
        btn.disabled = false; btn.textContent = 'Rechazar';
      }
    });
  }

  // ── Modal: avanzar búsqueda ──────────────────────────────────────────────────
  function abrirModalBusqueda(solId, estadoBusquedaActual) {
    const sig = BUSQUEDA_SIG[estadoBusquedaActual];
    if (!sig) return;
    const s = solicitudes.find(x => x.id === solId);
    const necesitaResponsable = estadoBusquedaActual === 'pendiente';
    const { modal, cerrar } = abrirModal('sol-modal-busqueda', `
      <div class="sol__modal" role="dialog" aria-modal="true">
        <h3 class="sol__modal-titulo">Avanzar búsqueda</h3>
        <p class="sol__modal-desc">${e(s?.puesto)} — ${e(s?.empresa)}</p>
        <p class="sol__modal-desc">
          <strong>${BUSQUEDA_LABEL[estadoBusquedaActual]}</strong>
          &rarr; <strong>${BUSQUEDA_LABEL[sig]}</strong>
        </p>
        ${necesitaResponsable ? `
          <label class="sol__modal-label" for="sol-responsable">Responsable de la búsqueda</label>
          <input class="sol__modal-input" id="sol-responsable" type="text"
                 value="${e(s?.responsable_busqueda)}" placeholder="Quién lleva la búsqueda">
        ` : ''}
        <label class="sol__modal-label" for="sol-notas-rrhh">Notas RRHH (opcional)</label>
        <textarea class="sol__modal-input" id="sol-notas-rrhh" rows="2" placeholder="Observaciones…">${e(s?.notas_rrhh)}</textarea>
        <div class="sol__modal-footer">
          <button class="sol__btn-cancel" id="sol-bq-cancel" type="button">Cancelar</button>
          <button class="sol__btn-ok"     id="sol-bq-ok"     type="button">Confirmar</button>
        </div>
      </div>`);
    modal.querySelector('#sol-bq-cancel').addEventListener('click', cerrar);
    const primerInput = modal.querySelector('#sol-responsable') || modal.querySelector('#sol-notas-rrhh');
    setTimeout(() => primerInput?.focus({ preventScroll: true }), 40);

    modal.querySelector('#sol-bq-ok').addEventListener('click', async () => {
      const responsable = modal.querySelector('#sol-responsable')?.value.trim() || null;
      const notas = modal.querySelector('#sol-notas-rrhh').value.trim() || null;
      const btn = modal.querySelector('#sol-bq-ok');
      btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        const body = { estado_busqueda: sig, notas_rrhh: notas };
        if (responsable !== null) body.responsable_busqueda = responsable;
        await sbPatch(solId, body);
        const rec = solicitudes.find(x => x.id === solId);
        if (rec) Object.assign(rec, body);
        cerrar(); actualizar();
      } catch (err) {
        alert('Error: ' + err.message);
        btn.disabled = false; btn.textContent = 'Confirmar';
      }
    });
  }

  // ── Bind acciones de la tabla ────────────────────────────────────────────────
  function bindAcciones() {
    contenedor.querySelectorAll('.sol__btn-autorizar').forEach(btn => {
      btn.addEventListener('click', () => abrirModalAprobar(btn.dataset.id));
    });
    contenedor.querySelectorAll('.sol__btn-rechazar').forEach(btn => {
      btn.addEventListener('click', () => abrirModalRechazar(btn.dataset.id, btn.dataset.puesto));
    });
    contenedor.querySelectorAll('.sol__btn-estado').forEach(btn => {
      btn.addEventListener('click', () => abrirModalBusqueda(btn.dataset.id, btn.dataset.eb));
    });
    contenedor.querySelectorAll('.sol__btn-eliminar').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm(`¿Eliminás la solicitud "${btn.dataset.puesto}"? No se puede deshacer.`)) return;
        btn.disabled = true;
        try {
          await sbDelete(btn.dataset.id);
          const idx = solicitudes.findIndex(x => x.id === btn.dataset.id);
          if (idx !== -1) solicitudes.splice(idx, 1);
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
