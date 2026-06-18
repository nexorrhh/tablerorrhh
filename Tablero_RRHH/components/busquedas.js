import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';

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

function renderCobertura(s, contratadosMap) {
  const cands = contratadosMap[s.id] || [];
  if (cands.length > 0) {
    return cands.map(c => `<span class="hist__cand">${e(c.apellido ? c.apellido + ', ' + c.nombre : c.nombre || '?')}</span>`).join('');
  }
  if (s.estado === 'aprobado' && s.estado_busqueda !== 'cubierto') {
    return `<span class="bsq-t__prog">0 / ${s.cantidad || 1}</span>`;
  }
  return '<span class="hist__vacio">—</span>';
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

  if (solicitudes.length) {
    try {
      const ids = solicitudes.map(s => s.id).join(',');
      const cands = await sbGet(`candidatos?solicitud_id=in.(${ids})&estado=eq.contratado&select=id,nombre,apellido,solicitud_id&order=updated_at.asc`);
      cands.forEach(c => {
        if (!contratadosMap[c.solicitud_id]) contratadosMap[c.solicitud_id] = [];
        contratadosMap[c.solicitud_id].push(c);
      });
    } catch (_) {}
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  function filas(lista) {
    if (!lista.length) return `<tr><td colspan="8" class="sol__empty">No hay búsquedas para mostrar.</td></tr>`;
    return lista.map(s => {
      const esPend     = s.estado === 'pendiente';
      const esCerrada  = s.estado_busqueda === 'cubierto' || s.estado === 'rechazado';
      return `
        <tr class="sol__fila${esCerrada ? ' sol__fila--cerrada' : ''}">
          <td class="hist__td-puesto">
            <strong>${e(s.puesto)}</strong>
            ${s.area || s.empresa ? `<br><span class="sol__area">${[s.area, s.empresa].filter(Boolean).map(e).join(' · ')}</span>` : ''}
          </td>
          <td class="hist__td-num">${s.cantidad ?? '—'}</td>
          <td>${badgePrio(s.prioridad)}</td>
          <td>
            ${e(s.solicitado_por) || '—'}
            ${s.created_at ? `<br><span class="hist__fecha-sub">${fmtFecha(s.created_at)}</span>` : ''}
          </td>
          <td>
            ${e(s.aprobado_por) || '—'}
            ${s.fecha_aprobacion ? `<br><span class="hist__fecha-sub">${fmtFecha(s.fecha_aprobacion)}</span>` : ''}
          </td>
          <td>${badgeEstado(s)}</td>
          <td class="hist__td-contratados">${renderCobertura(s, contratadosMap)}</td>
          <td class="sol__td-acciones">
            ${esPend
              ? `<button class="sol__btn-autorizar" data-id="${s.id}" type="button">Aprobar</button>
                 <button class="sol__btn-rechazar"  data-id="${s.id}" data-puesto="${e(s.puesto)}" type="button">Rechazar</button>`
              : s.estado === 'aprobado' && s.estado_busqueda === 'pendiente'
              ? `<button class="sol__btn-estado" data-id="${s.id}" data-eb="pendiente" type="button">Iniciar búsqueda</button>`
              : ''}
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
            <th>Solicitado por</th>
            <th>Aprobado por</th>
            <th>Estado</th>
            <th>Contratados</th>
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

  // ── Modal helper ─────────────────────────────────────────────────────────────
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
    const { modal, cerrar } = abrirModal('bsq-modal-aprobar', `
      <div class="sol__modal" role="dialog" aria-modal="true">
        <h3 class="sol__modal-titulo">Aprobar solicitud</h3>
        <p class="sol__modal-desc">${e(s?.puesto)} — ${e(s?.empresa)} · ${s?.cantidad??'?'} puesto${s?.cantidad!==1?'s':''}</p>
        <label class="sol__modal-label" for="bsq-quien">¿Quién aprueba? *</label>
        <input class="sol__modal-input" id="bsq-quien" type="text" placeholder="Nombre del director" autocomplete="off">
        <label class="sol__modal-label" for="bsq-notas-dir">Notas (opcional)</label>
        <textarea class="sol__modal-input" id="bsq-notas-dir" rows="2" placeholder="Observaciones…"></textarea>
        <div class="sol__modal-footer">
          <button class="sol__btn-cancel" id="bsq-ap-cancel" type="button">Cancelar</button>
          <button class="sol__btn-ok"     id="bsq-ap-ok"     type="button">Confirmar aprobación</button>
        </div>
      </div>`);
    modal.querySelector('#bsq-ap-cancel').addEventListener('click', cerrar);
    const inputQuien = modal.querySelector('#bsq-quien');
    setTimeout(() => inputQuien.focus({ preventScroll: true }), 40);
    modal.querySelector('#bsq-ap-ok').addEventListener('click', async () => {
      const quien = inputQuien.value.trim();
      if (!quien) { inputQuien.focus(); return; }
      const notas = modal.querySelector('#bsq-notas-dir').value.trim() || null;
      const btn = modal.querySelector('#bsq-ap-ok');
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
    const { modal, cerrar } = abrirModal('bsq-modal-rechazar', `
      <div class="sol__modal" role="dialog" aria-modal="true">
        <h3 class="sol__modal-titulo">Rechazar solicitud</h3>
        <p class="sol__modal-desc">Solicitud: <strong>${e(puesto)}</strong></p>
        <label class="sol__modal-label" for="bsq-notas-rec">Motivo del rechazo (opcional)</label>
        <textarea class="sol__modal-input" id="bsq-notas-rec" rows="2" placeholder="Observaciones…"></textarea>
        <div class="sol__modal-footer">
          <button class="sol__btn-cancel"                      id="bsq-rec-cancel" type="button">Cancelar</button>
          <button class="sol__btn-ok sol__btn-ok--danger"      id="bsq-rec-ok"     type="button">Rechazar</button>
        </div>
      </div>`);
    modal.querySelector('#bsq-rec-cancel').addEventListener('click', cerrar);
    setTimeout(() => modal.querySelector('#bsq-notas-rec').focus({ preventScroll: true }), 40);
    modal.querySelector('#bsq-rec-ok').addEventListener('click', async () => {
      const notas = modal.querySelector('#bsq-notas-rec').value.trim() || null;
      const btn = modal.querySelector('#bsq-rec-ok');
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

  // ── Modal: iniciar búsqueda (pendiente → en_busqueda) ───────────────────────
  function abrirModalIniciarBusqueda(solId) {
    const s = solicitudes.find(x => x.id === solId);
    const { modal, cerrar } = abrirModal('bsq-modal-iniciar', `
      <div class="sol__modal" role="dialog" aria-modal="true">
        <h3 class="sol__modal-titulo">Iniciar búsqueda</h3>
        <p class="sol__modal-desc">${e(s?.puesto)} — ${e(s?.empresa)}</p>
        <label class="sol__modal-label" for="bsq-responsable">Responsable de la búsqueda</label>
        <input class="sol__modal-input" id="bsq-responsable" type="text"
               value="${e(s?.responsable_busqueda)}" placeholder="Quién lleva la búsqueda en RRHH">
        <label class="sol__modal-label" for="bsq-notas-rrhh">Notas RRHH (opcional)</label>
        <textarea class="sol__modal-input" id="bsq-notas-rrhh" rows="2" placeholder="Observaciones…">${e(s?.notas_rrhh)}</textarea>
        <div class="sol__modal-footer">
          <button class="sol__btn-cancel" id="bsq-ini-cancel" type="button">Cancelar</button>
          <button class="sol__btn-ok"     id="bsq-ini-ok"     type="button">Confirmar</button>
        </div>
      </div>`);
    modal.querySelector('#bsq-ini-cancel').addEventListener('click', cerrar);
    setTimeout(() => modal.querySelector('#bsq-responsable').focus({ preventScroll: true }), 40);
    modal.querySelector('#bsq-ini-ok').addEventListener('click', async () => {
      const responsable = modal.querySelector('#bsq-responsable').value.trim() || null;
      const notas = modal.querySelector('#bsq-notas-rrhh').value.trim() || null;
      const btn = modal.querySelector('#bsq-ini-ok');
      btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        const body = { estado_busqueda:'en_busqueda', notas_rrhh:notas };
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

  // ── Bind acciones ────────────────────────────────────────────────────────────
  function bindAcciones() {
    contenedor.querySelectorAll('.sol__btn-autorizar').forEach(btn => {
      btn.addEventListener('click', () => abrirModalAprobar(btn.dataset.id));
    });
    contenedor.querySelectorAll('.sol__btn-rechazar').forEach(btn => {
      btn.addEventListener('click', () => abrirModalRechazar(btn.dataset.id, btn.dataset.puesto));
    });
    contenedor.querySelectorAll('.sol__btn-estado').forEach(btn => {
      btn.addEventListener('click', () => abrirModalIniciarBusqueda(btn.dataset.id));
    });
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
