import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';
import { obtenerUsuario } from '../data/usuario-activo.js';

const TABLA = 'solicitudes_personal';
const HDR = {
  'Content-Type': 'application/json',
  apikey:        SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
};

async function sbGet(q)       { const r = await fetch(`${SUPABASE_URL}/rest/v1/${q}`, { headers: HDR }); if (!r.ok) throw new Error(await r.text()); return r.json(); }
async function sbPost(b)      { const r = await fetch(`${SUPABASE_URL}/rest/v1/${TABLA}`, { method:'POST', headers:{...HDR,Prefer:'return=representation'}, body:JSON.stringify(b) }); if (!r.ok) throw new Error(await r.text()); return (await r.json())[0]; }
async function sbPatch(id, b) { const r = await fetch(`${SUPABASE_URL}/rest/v1/${TABLA}?id=eq.${id}`, { method:'PATCH', headers:{...HDR,Prefer:'return=minimal'}, body:JSON.stringify(b) }); if (!r.ok) throw new Error(await r.text()); }
async function sbDelete(id)   { const r = await fetch(`${SUPABASE_URL}/rest/v1/${TABLA}?id=eq.${id}`, { method:'DELETE', headers:HDR }); if (!r.ok) throw new Error(await r.text()); }

function e(s)        { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function fmtFecha(f) { if (!f) return ''; return new Date(f).toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric'}); }

// Motivo dispara los campos de reemplazo (a quién reemplaza) cuando es una baja/renuncia —
// no hay una restricción de base de datos sobre estos valores (es texto libre), esta lista
// es la que ofrece el formulario de este tablero.
const MOTIVOS = ['Baja / renuncia', 'Nueva posición', 'Cobertura temporal', 'Otro'];
const MOTIVO_REEMPLAZO = 'Baja / renuncia';
const EMPRESAS_SOLICITUD = ['Cimomet', 'Co.mo.ing'];
// Área es una clasificación amplia fija (no depende del plantel actual, a diferencia de Puesto).
const AREAS_SOLICITUD = ['Administrativo', 'Calidad', 'Gerencia', 'Ingeniería', 'Producción', 'Taller'];

// Puesto sí tiene que reflejar lo que ya existe hoy en la nómina — se trae en vivo de
// v_empleados_activos (mismo criterio que usa plantel-parametrizacion.js) en vez de tener
// una lista fija acá, para no desincronizarse cuando se dé de alta un puesto nuevo.
async function obtenerPuestosDisponibles() {
  try {
    const rows = await sbGet('v_empleados_activos?select=desc_puesto');
    const set = new Set(rows.map(r => (r.desc_puesto || '').trim()).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b, 'es'));
  } catch {
    return [];
  }
}

const EMPRESA_CODIGO = { 'Cimomet': 'CIMOMET', 'Co.mo.ing': 'COMOING' };
const EMPRESA_LABEL  = { CIMOMET: 'Cimomet', COMOING: 'Co.mo.ing' };

// "A quién reemplaza" tiene que salir de gente realmente dada de baja hace poco — mismo
// criterio que Panel de Producción — no texto libre, para no permitir legajos inventados
// o mal tipeados. Se trae una sola vez acá, mezclando las dos empresas (la búsqueda puede
// ser para reemplazar a alguien de cualquiera de las dos, no solo de la misma).
// Se limita a los últimos 3 meses para que la lista no vaya acumulando bajas viejas para
// siempre — pasado ese tiempo, la persona deja de aparecer acá sola (no hace falta borrar
// nada de `empleados`, solo se angosta la ventana de qué se ofrece para elegir).
const VENTANA_BAJAS_DIAS = 90;
async function obtenerBajasRecientes() {
  try {
    const desde = new Date(Date.now() - VENTANA_BAJAS_DIAS * 24 * 60 * 60 * 1000).toISOString();
    return await sbGet(`empleados?select=legajo,empresa,apellido_y_nombre,desc_puesto,actualizado_en&activo=eq.false&actualizado_en=gte.${desde}&order=actualizado_en.desc&limit=100`);
  } catch {
    return [];
  }
}

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

  let solicitudes        = [];
  let puestosDisponibles = [];
  let bajasRecientes     = [];
  let contratadosMap     = {};
  let filtroActivo       = '';

  try {
    [solicitudes, puestosDisponibles, bajasRecientes] = await Promise.all([
      sbGet(`${TABLA}?order=created_at.desc`),
      obtenerPuestosDisponibles(),
      obtenerBajasRecientes(),
    ]);
  } catch {
    contenedor.innerHTML = `<div class="estado-vacio"><h3 class="estado-vacio__titulo">Error al cargar</h3><p class="estado-vacio__texto">No se pudieron obtener las búsquedas.</p></div>`;
    return;
  }

  const usuarioActivo  = obtenerUsuario();
  const puedeAutorizar = !!usuarioActivo?.permisos?.includes('autorizarBusquedas');

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
            ${s.estado === 'pendiente' && puedeAutorizar
              ? `<button class="sol__btn-autorizar" data-id="${s.id}" type="button">Aprobar</button>
                 <button class="sol__btn-rechazar"  data-id="${s.id}" type="button">Rechazar</button>`
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
            <th>Estado</th>
            <th>Línea de tiempo</th>
            <th></th>
          </tr></thead>
          <tbody>${filas(lista)}</tbody>
        </table>
      </div>`;
  }

  function n(f) { return filtrar(solicitudes, f).length; }

  // Separado de renderTabla porque los contadores de cada tab (Sin autorizar/Activas/etc.)
  // tienen que refrescarse solos cada vez que Aprobar/Rechazar/Eliminar cambia el estado de
  // algo — antes solo se redibujaba la tabla y estos números quedaban pisados hasta recargar
  // la página entera.
  function filtrosHtml() {
    const cnt = (f, val, conAlerta) => `<span class="sol__ftab-count${conAlerta && val > 0 ? ' sol__ftab-count--alert' : ''}">${val}</span>`;
    return `
      <button class="sol__ftab ${filtroActivo === '' ? 'sol__ftab--activo' : ''}" data-f="" type="button">
        Todas ${cnt('', solicitudes.length, false)}
      </button>
      <button class="sol__ftab ${filtroActivo === 'sin_autorizar' ? 'sol__ftab--activo' : ''}" data-f="sin_autorizar" type="button">
        Sin autorizar ${cnt('sin_autorizar', n('sin_autorizar'), true)}
      </button>
      <button class="sol__ftab ${filtroActivo === 'activas' ? 'sol__ftab--activo' : ''}" data-f="activas" type="button">
        Activas ${cnt('activas', n('activas'), true)}
      </button>
      <button class="sol__ftab ${filtroActivo === 'cubiertas' ? 'sol__ftab--activo' : ''}" data-f="cubiertas" type="button">
        Cubiertas ${cnt('cubiertas', n('cubiertas'), false)}
      </button>
      <button class="sol__ftab ${filtroActivo === 'rechazadas' ? 'sol__ftab--activo' : ''}" data-f="rechazadas" type="button">
        Rechazadas ${cnt('rechazadas', n('rechazadas'), false)}
      </button>`;
  }

  contenedor.innerHTML = `
    <div class="sol__wrap">
      <div class="sol__topbar">
        <div class="sol__filtros" id="bsq-filtros" role="group" aria-label="Filtrar búsquedas"></div>
        <button class="sol__btn-autorizar" id="bsq-btn-nueva" type="button">+ Nueva solicitud</button>
      </div>
      <div id="bsq-tabla-area"></div>
    </div>`;

  const tabArea    = contenedor.querySelector('#bsq-tabla-area');
  const filtrosDiv = contenedor.querySelector('#bsq-filtros');
  contenedor.querySelector('#bsq-btn-nueva').addEventListener('click', abrirModalNueva);

  function actualizar() {
    filtrosDiv.innerHTML = filtrosHtml();
    wireFiltros();
    tabArea.innerHTML = renderTabla(filtrar(solicitudes, filtroActivo));
    bindAcciones();
  }

  function wireFiltros() {
    filtrosDiv.querySelectorAll('.sol__ftab').forEach(btn => {
      btn.addEventListener('click', () => {
        filtroActivo = btn.dataset.f;
        actualizar();
      });
    });
  }

  actualizar();

  // ── Modal genérico ───────────────────────────────────────────────────────────
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
        const body = { estado:'aprobado', aprobado_por:quien, fecha_aprobacion:new Date().toISOString(), notas_director:notas, estado_busqueda:'pendiente' };
        await sbPatch(solId, body);
        Object.assign(s, body);
        cerrar(); actualizar(); alActualizarBadge?.();
      } catch (err) {
        alert('Error: ' + err.message);
        btn.disabled = false; btn.textContent = 'Confirmar aprobación';
      }
    });
  }

  // ── Modal: rechazar ──────────────────────────────────────────────────────────
  function abrirModalRechazar(solId) {
    const s = solicitudes.find(x => x.id === solId);
    const { modal, cerrar } = abrirModal('bsq-modal-rechazar', `
      <div class="sol__modal" role="dialog" aria-modal="true">
        <h3 class="sol__modal-titulo">Rechazar solicitud</h3>
        <p class="sol__modal-desc">Solicitud: <strong>${e(s?.puesto)}</strong></p>
        <label class="sol__modal-label" for="bsq-notas-rec">Motivo del rechazo *</label>
        <textarea class="sol__modal-input" id="bsq-notas-rec" rows="2" placeholder="Por qué se rechaza…"></textarea>
        <div class="sol__modal-footer">
          <button class="sol__btn-cancel"    id="bsq-rec-cancel" type="button">Cancelar</button>
          <button class="sol__btn-ok sol__btn-ok--danger" id="bsq-rec-ok" type="button">Rechazar</button>
        </div>
      </div>`);
    modal.querySelector('#bsq-rec-cancel').addEventListener('click', cerrar);
    const textMotivo = modal.querySelector('#bsq-notas-rec');
    setTimeout(() => textMotivo.focus({ preventScroll: true }), 40);

    modal.querySelector('#bsq-rec-ok').addEventListener('click', async () => {
      const motivo = textMotivo.value.trim();
      if (!motivo) { textMotivo.focus(); return; }
      const btn = modal.querySelector('#bsq-rec-ok');
      btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        const body = { estado:'rechazado', notas_director:motivo };
        await sbPatch(solId, body);
        Object.assign(s, body);
        cerrar(); actualizar(); alActualizarBadge?.();
      } catch (err) {
        alert('Error: ' + err.message);
        btn.disabled = false; btn.textContent = 'Rechazar';
      }
    });
  }

  // ── Modal: nueva solicitud ───────────────────────────────────────────────────
  function abrirModalNueva() {
    const { modal, cerrar } = abrirModal('bsq-modal-nueva', `
      <div class="sol__modal" role="dialog" aria-modal="true">
        <h3 class="sol__modal-titulo">Nueva solicitud de personal</h3>
        <label class="sol__modal-label" for="bsq-n-puesto">Puesto *</label>
        <select class="sol__modal-input" id="bsq-n-puesto">
          <option value="" disabled selected>Seleccioná…</option>
          ${puestosDisponibles.map(p => `<option value="${e(p)}">${e(p)}</option>`).join('')}
        </select>
        <label class="sol__modal-label" for="bsq-n-area">Área *</label>
        <select class="sol__modal-input" id="bsq-n-area">
          <option value="" disabled selected>Seleccioná…</option>
          ${AREAS_SOLICITUD.map(a => `<option value="${e(a)}">${e(a)}</option>`).join('')}
        </select>
        <div class="sol__modal-fila2">
          <div>
            <label class="sol__modal-label" for="bsq-n-empresa">Empresa *</label>
            <select class="sol__modal-input" id="bsq-n-empresa">
              ${EMPRESAS_SOLICITUD.map(emp => `<option value="${e(emp)}">${e(emp)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="sol__modal-label" for="bsq-n-cantidad">Cantidad</label>
            <input class="sol__modal-input" id="bsq-n-cantidad" type="number" min="1" value="1">
          </div>
        </div>
        <div class="sol__modal-fila2">
          <div>
            <label class="sol__modal-label" for="bsq-n-prioridad">Prioridad</label>
            <select class="sol__modal-input" id="bsq-n-prioridad">
              <option value="Alta" selected>Alta</option>
              <option value="Media">Media</option>
              <option value="Baja">Baja</option>
            </select>
          </div>
          <div>
            <label class="sol__modal-label" for="bsq-n-motivo">Motivo *</label>
            <select class="sol__modal-input" id="bsq-n-motivo">
              ${MOTIVOS.map(m => `<option value="${e(m)}">${e(m)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div id="bsq-n-reemplazo-wrap" hidden>
          <label class="sol__modal-label" for="bsq-n-reemp-select">Reemplaza a *</label>
          <select class="sol__modal-input" id="bsq-n-reemp-select"></select>
        </div>
        <label class="sol__modal-label" for="bsq-n-desc">Descripción (opcional)</label>
        <textarea class="sol__modal-input" id="bsq-n-desc" rows="2" placeholder="Detalle de la posición, requisitos, etc."></textarea>
        <label class="sol__modal-label" for="bsq-n-solicitante">Solicitado por</label>
        <input class="sol__modal-input" id="bsq-n-solicitante" type="text" value="${e(usuarioActivo?.nombre)}" readonly>
        <div class="sol__modal-footer">
          <button class="sol__btn-cancel" id="bsq-n-cancel" type="button">Cancelar</button>
          <button class="sol__btn-ok"     id="bsq-n-ok"     type="button">Crear solicitud</button>
        </div>
      </div>`);
    modal.querySelector('#bsq-n-cancel').addEventListener('click', cerrar);

    const selectPuesto    = modal.querySelector('#bsq-n-puesto');
    const selectArea      = modal.querySelector('#bsq-n-area');
    const selectMotivo    = modal.querySelector('#bsq-n-motivo');
    const wrapReemplazo   = modal.querySelector('#bsq-n-reemplazo-wrap');
    const selectReemplazo = modal.querySelector('#bsq-n-reemp-select');
    setTimeout(() => selectPuesto.focus({ preventScroll: true }), 40);

    // "A quién reemplaza" sale SIEMPRE de una baja real (mismo criterio que Panel de
    // Producción) de las dos empresas mezcladas — la búsqueda no tiene por qué ser de la
    // misma razón social que la persona que se fue. No se permite cargarlo a mano: si la
    // persona todavía no está marcada como inactiva en el sistema, hay que actualizar eso
    // primero. El value codifica empresa+legajo (no solo legajo) porque los legajos de
    // Cimomet y Co.mo.ing son independientes y podrían pisarse entre sí.
    function refrescarOpcionesReemplazo() {
      selectReemplazo.innerHTML = `
        <option value="" disabled selected>Seleccioná…</option>
        ${bajasRecientes.map(b => `<option value="${e(b.empresa)}|${e(b.legajo)}">${e(b.apellido_y_nombre)} — ${EMPRESA_LABEL[b.empresa] || e(b.empresa)} · legajo ${e(b.legajo)}${b.desc_puesto ? ' · ' + e(b.desc_puesto) : ''}</option>`).join('')}`;
    }

    function sincronizarReemplazo() {
      wrapReemplazo.hidden = selectMotivo.value !== MOTIVO_REEMPLAZO;
      if (!wrapReemplazo.hidden && !selectReemplazo.options.length) refrescarOpcionesReemplazo();
    }
    selectMotivo.addEventListener('change', sincronizarReemplazo);
    sincronizarReemplazo(); // el motivo por defecto ("Baja / renuncia") ya necesita mostrar esto

    modal.querySelector('#bsq-n-ok').addEventListener('click', async () => {
      const puesto = selectPuesto.value;
      const area   = selectArea.value;
      const solicitadoPor = usuarioActivo?.nombre || '';
      if (!puesto) { selectPuesto.focus(); return; }
      if (!area)   { selectArea.focus(); return; }
      if (selectMotivo.value === MOTIVO_REEMPLAZO && !selectReemplazo.value) { selectReemplazo.focus(); return; }
      if (!solicitadoPor) { alert('No se pudo identificar quién está solicitando (sesión inválida).'); return; }

      const body = {
        puesto, area,
        empresa:        modal.querySelector('#bsq-n-empresa').value,
        cantidad:       Math.max(1, +modal.querySelector('#bsq-n-cantidad').value || 1),
        prioridad:      modal.querySelector('#bsq-n-prioridad').value,
        motivo:         selectMotivo.value,
        descripcion:    modal.querySelector('#bsq-n-desc').value.trim() || null,
        solicitado_por: solicitadoPor,
      };
      if (selectMotivo.value === MOTIVO_REEMPLAZO) {
        const [empCodigo, legajoSel] = selectReemplazo.value.split('|');
        const baja = bajasRecientes.find(b => b.empresa === empCodigo && b.legajo === legajoSel);
        body.reemplazo_legajo  = baja?.legajo ?? legajoSel;
        body.reemplazo_nombre  = baja?.apellido_y_nombre ?? null;
        body.reemplazo_empresa = EMPRESA_LABEL[empCodigo] || body.empresa;
      }

      const btn = modal.querySelector('#bsq-n-ok');
      btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        const creada = await sbPost(body);
        solicitudes.unshift(creada);
        cerrar(); actualizar(); alActualizarBadge?.();
      } catch (err) {
        alert('Error: ' + err.message);
        btn.disabled = false; btn.textContent = 'Crear solicitud';
      }
    });
  }

  function bindAcciones() {
    contenedor.querySelectorAll('.sol__btn-autorizar[data-id]').forEach(btn => {
      btn.addEventListener('click', () => abrirModalAprobar(btn.dataset.id));
    });
    contenedor.querySelectorAll('.sol__btn-rechazar').forEach(btn => {
      btn.addEventListener('click', () => abrirModalRechazar(btn.dataset.id));
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
}
