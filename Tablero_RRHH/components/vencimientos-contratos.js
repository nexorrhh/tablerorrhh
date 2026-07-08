import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';

const HDR = {
  apikey:         SUPABASE_ANON_KEY,
  Authorization:  `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
};
const TABLA     = 'contratos_vencimiento';
const TABLA_EMP = 'v_empleados_activos';

const TIPOS_CONTRATO = ['Monotributista', 'Contrato plazo fijo', 'Locación de servicios', 'Contrato de obra', 'Otro'];
const TIPOS_SEGURO   = ['Seguro ART', 'Seguro de vida', 'Seguro de accidentes', 'Seguro de planta'];
const TODOS_TIPOS    = [...TIPOS_CONTRATO, ...TIPOS_SEGURO];

function esSeguro(tipo) { return TIPOS_SEGURO.includes(tipo); }

async function sbGet(q)        { const r = await fetch(`${SUPABASE_URL}/rest/v1/${TABLA}?${q}`, { headers: HDR }); if (!r.ok) throw new Error('HTTP '+r.status); return r.json(); }
async function sbInsert(body)  { const r = await fetch(`${SUPABASE_URL}/rest/v1/${TABLA}`, { method:'POST',  headers:{...HDR,Prefer:'return=minimal'}, body:JSON.stringify(body) }); if (!r.ok) throw new Error(await r.text()); }
async function sbUpdate(id, b) { const r = await fetch(`${SUPABASE_URL}/rest/v1/${TABLA}?id=eq.${id}`, { method:'PATCH', headers:{...HDR,Prefer:'return=minimal'}, body:JSON.stringify(b) }); if (!r.ok) throw new Error(await r.text()); }
async function sbDelete(id)    { const r = await fetch(`${SUPABASE_URL}/rest/v1/${TABLA}?id=eq.${id}`, { method:'DELETE', headers: HDR }); if (!r.ok) throw new Error(await r.text()); }

export async function renderizarVencimientosContratos(contenedor) {
  let registros    = [];
  let monotribList = [];
  let editandoId   = null;
  let toastTimer   = null;

  contenedor.innerHTML = `<p class="plantel__cargando">Cargando contratos…</p>`;

  async function cargar() {
    try {
      const [rContr, rEmp] = await Promise.allSettled([
        sbGet('order=fecha_vencimiento.asc'),
        fetch(
          `${SUPABASE_URL}/rest/v1/${TABLA_EMP}?select=legajo,apellido_y_nombre,empresa&order=apellido_y_nombre.asc`,
          { headers: HDR }
        ).then(r => r.ok ? r.json() : [])
         .then(rows => rows.filter(r => +r.legajo >= 2000 && +r.legajo < 3000)),
      ]);
      registros    = rContr.status === 'fulfilled' ? rContr.value : [];
      monotribList = rEmp.status   === 'fulfilled' ? rEmp.value   : [];
    } catch {
      contenedor.innerHTML = errHtml('No se pudieron cargar los contratos.');
      return;
    }
    renderVista();
  }

  function renderVista() {
    const vencidos = registros.filter(r => dias(r.fecha_vencimiento) <  0).length;
    const proximos = registros.filter(r => { const d=dias(r.fecha_vencimiento); return d>=0 && d<=30; }).length;

    // Cruzar monotributistas con sus registros por legajo
    const mapContratos = new Map(); // legajo → registro de contrato
    const mapSeguros   = new Map(); // legajo → registro de seguro
    registros.forEach(r => {
      if (!r.legajo) return;
      esSeguro(r.tipo) ? mapSeguros.set(r.legajo, r) : mapContratos.set(r.legajo, r);
    });

    const monoHtml = monotribList.map(emp => {
      const contrato = mapContratos.get(emp.legajo);
      const seguro   = mapSeguros.get(emp.legajo);
      const empLabel = emp.empresa === 'CIMOMET' ? 'Cimomet' : 'Co.mo.ing';

      const celdaContrato = contrato
        ? `<button class="venc__mono-estado" data-editar="${contrato.id}">
             ${badgeHtml(dias(contrato.fecha_vencimiento))}
             <span class="venc__mono-fecha">${fmtFecha(contrato.fecha_vencimiento)}</span>
           </button>`
        : `<button class="venc__mono-add" data-prefill-legajo="${emp.legajo}" data-prefill-nombre="${e(emp.apellido_y_nombre)}" data-prefill-cat="contrato">
             <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
             Cargar contrato
           </button>`;

      const celdaSeguro = seguro
        ? `<button class="venc__mono-estado" data-editar="${seguro.id}">
             ${badgeHtml(dias(seguro.fecha_vencimiento))}
             ${seguro.numero_poliza ? `<span class="venc__mono-poliza">Póliza ${e(seguro.numero_poliza)}</span>` : ''}
             <span class="venc__mono-fecha">${fmtFecha(seguro.fecha_vencimiento)}</span>
           </button>`
        : `<button class="venc__mono-add" data-prefill-legajo="${emp.legajo}" data-prefill-nombre="${e(emp.apellido_y_nombre)}" data-prefill-cat="seguro">
             <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
             Cargar seguro
           </button>`;

      return `
        <tr>
          <td>
            <span class="venc__td-bold">${e(emp.apellido_y_nombre)}</span>
            <span class="venc__td-muted"> · #${emp.legajo} · ${empLabel}</span>
          </td>
          <td>${celdaContrato}</td>
          <td>${celdaSeguro}</td>
        </tr>`;
    }).join('');

    contenedor.innerHTML = `
      <div class="venc">
        <div class="venc__toolbar">
          <div class="venc__resumen">
            ${vencidos ? `<span class="venc__pill venc__pill--rojo">${vencidos} vencido${vencidos!==1?'s':''}</span>` : ''}
            ${proximos ? `<span class="venc__pill venc__pill--naranja">${proximos} próximo${proximos!==1?'s':''} a vencer</span>` : ''}
            ${!vencidos && !proximos ? `<span class="venc__pill venc__pill--verde">Todo en regla</span>` : ''}
          </div>
          <div class="venc__btns">
            <button class="venc__btn-pri" id="venc-nuevo">
              <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Agregar
            </button>
          </div>
        </div>

        ${monotribList.length ? `
          <div class="venc__seccion">
            <h4 class="venc__seccion-h">Monotributistas activos</h4>
            <div class="venc__tabla-wrap">
              <table class="venc__tabla">
                <thead><tr>
                  <th>Persona</th>
                  <th>Contrato</th>
                  <th>Seguro de planta</th>
                </tr></thead>
                <tbody>${monoHtml}</tbody>
              </table>
            </div>
          </div>
        ` : ''}

        <div class="venc__seccion">
          <h4 class="venc__seccion-h">Todos los contratos y seguros</h4>
          ${registros.length === 0
            ? `<p class="venc__vacio">No hay registros. Agregá el primero.</p>`
            : `<div class="venc__tabla-wrap">
                <table class="venc__tabla">
                  <thead><tr>
                    <th>Contratista</th><th>Tipo</th><th>Empresa · Área</th>
                    <th>Vencimiento</th><th>Estado</th><th></th>
                  </tr></thead>
                  <tbody>${registros.map(filaContrato).join('')}</tbody>
                </table>
              </div>`}
        </div>
      </div>`;

    contenedor.querySelector('#venc-nuevo').addEventListener('click', () => abrirModal());
    contenedor.querySelectorAll('[data-editar]').forEach(b =>
      b.addEventListener('click', () => abrirModal(registros.find(r => r.id === b.dataset.editar)))
    );
    contenedor.querySelectorAll('[data-prefill-legajo]').forEach(b =>
      b.addEventListener('click', () => abrirModal(null, {
        legajo: +b.dataset.prefillLegajo,
        nombre: b.dataset.prefillNombre,
        cat:    b.dataset.prefillCat,   // 'contrato' | 'seguro'
      }))
    );
    contenedor.querySelectorAll('[data-eliminar]').forEach(b =>
      b.addEventListener('click', () => eliminar(b.dataset.eliminar))
    );
  }

  function abrirModal(reg = null, prefill = null) {
    editandoId = reg?.id ?? null;
    document.getElementById('venc-modal-contratos')?.remove();

    const tipoInicial = reg?.tipo
      ?? (prefill?.cat === 'seguro' ? TIPOS_SEGURO[0] : 'Monotributista');
    const mostrarPoliza = esSeguro(tipoInicial);

    const modal = document.createElement('div');
    modal.id        = 'venc-modal-contratos';
    modal.className = 'venc__modal-overlay';
    modal.innerHTML = `
      <div class="venc__modal" role="dialog" aria-modal="true">
        <h3 class="venc__modal-titulo">${reg ? 'Editar registro' : 'Nuevo registro'}</h3>

        <label class="venc__label">Nombre del contratista *</label>
        <input class="venc__input" id="vm-nombre" type="text"
               value="${e(reg?.nombre ?? prefill?.nombre ?? '')}"
               placeholder="Ej: García Juan">

        <div class="venc__row2">
          <div>
            <label class="venc__label">Tipo *</label>
            <select class="venc__input" id="vm-tipo">
              <optgroup label="Contratos">
                ${TIPOS_CONTRATO.map(t => `<option ${tipoInicial===t?'selected':''}>${t}</option>`).join('')}
              </optgroup>
              <optgroup label="Seguros">
                ${TIPOS_SEGURO.map(t => `<option ${tipoInicial===t?'selected':''}>${t}</option>`).join('')}
              </optgroup>
            </select>
          </div>
          <div>
            <label class="venc__label">Empresa *</label>
            <select class="venc__input" id="vm-empresa">
              <option value="CIMOMET" ${(!reg||reg.empresa==='CIMOMET')?'selected':''}>Cimomet S.A.</option>
              <option value="COMOING" ${reg?.empresa==='COMOING'?'selected':''}>Co.mo.ing S.R.L.</option>
            </select>
          </div>
        </div>

        <div id="vm-poliza-row" style="display:${mostrarPoliza?'block':'none'}">
          <label class="venc__label">Número de póliza</label>
          <input class="venc__input" id="vm-poliza" type="text"
                 value="${e(reg?.numero_poliza)}" placeholder="Ej: 1234567">
        </div>

        <label class="venc__label">Área / Sector</label>
        <input class="venc__input" id="vm-area" type="text"
               value="${e(reg?.area)}" placeholder="Ej: Producción">

        <div class="venc__row2">
          <div>
            <label class="venc__label">Fecha de inicio</label>
            <input class="venc__input" id="vm-inicio" type="date" value="${reg?.fecha_inicio||''}">
          </div>
          <div>
            <label class="venc__label">Fecha de vencimiento *</label>
            <input class="venc__input" id="vm-venc" type="date" value="${reg?.fecha_vencimiento||''}">
          </div>
        </div>

        <label class="venc__label">Notas</label>
        <textarea class="venc__textarea" id="vm-notas" rows="2"
                  placeholder="Observaciones opcionales">${e(reg?.notas)}</textarea>

        <input type="hidden" id="vm-legajo" value="${reg?.legajo ?? prefill?.legajo ?? ''}">

        <div class="venc__modal-footer">
          <button class="venc__btn-sec" id="vm-cancel">Cancelar</button>
          <button class="venc__btn-pri" id="vm-ok">${reg ? 'Guardar cambios' : 'Agregar'}</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    // Mostrar/ocultar campo póliza según tipo seleccionado
    modal.querySelector('#vm-tipo').addEventListener('change', ev => {
      modal.querySelector('#vm-poliza-row').style.display =
        esSeguro(ev.target.value) ? 'block' : 'none';
    });

    const sc = document.querySelector('.app-contenido');
    if (sc) sc.style.overflow = 'hidden';
    const cerrar = () => { modal.remove(); if (sc) sc.style.overflow = ''; };
    modal.addEventListener('click', ev => { if (ev.target === modal) cerrar(); });
    modal.querySelector('#vm-cancel').addEventListener('click', cerrar);
    modal.querySelector('#vm-ok').addEventListener('click', () => guardar(cerrar));
    setTimeout(() => modal.querySelector('#vm-nombre').focus({ preventScroll: true }), 40);
  }

  async function guardar(cerrar) {
    const nombre     = v('vm-nombre');
    const tipo       = v('vm-tipo');
    const empresa    = v('vm-empresa');
    const area       = v('vm-area') || null;
    const inicio     = v('vm-inicio') || null;
    const venc       = v('vm-venc');
    const notas      = v('vm-notas') || null;
    const poliza     = esSeguro(tipo) ? (v('vm-poliza') || null) : null;
    const legajoStr  = v('vm-legajo');
    const legajo     = legajoStr ? +legajoStr : null;

    if (!nombre || !venc) { toast('Completá los campos obligatorios (*)', 'error'); return; }

    const btn = document.getElementById('vm-ok');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
    try {
      const body = { nombre, tipo, empresa, area, fecha_inicio: inicio,
                     fecha_vencimiento: venc, notas, numero_poliza: poliza, legajo };
      editandoId ? await sbUpdate(editandoId, body) : await sbInsert({ ...body, activo: true });
      cerrar();
      await cargar();
      toast(editandoId ? 'Registro actualizado' : 'Registro agregado', 'ok');
    } catch (err) {
      toast('Error: ' + err.message, 'error');
      if (btn) { btn.disabled = false; btn.textContent = editandoId ? 'Guardar cambios' : 'Agregar'; }
    }
  }

  async function eliminar(id) {
    if (!confirm('¿Eliminar este registro? Esta acción no se puede deshacer.')) return;
    try { await sbDelete(id); await cargar(); toast('Registro eliminado'); }
    catch { toast('Error al eliminar', 'error'); }
  }

  function toast(msg, tipo = '') {
    let t = contenedor.querySelector('.venc__toast');
    if (!t) { t = document.createElement('div'); t.className = 'venc__toast'; contenedor.appendChild(t); }
    t.textContent = msg;
    t.className = `venc__toast venc__toast--show${tipo ? ' venc__toast--'+tipo : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'venc__toast'; }, 3200);
  }

  await cargar();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function filaContrato(r) {
  const d = dias(r.fecha_vencimiento);
  const { cls, txt } = badge(d);
  const emp    = r.empresa === 'CIMOMET' ? 'Cimomet' : 'Co.mo.ing';
  const rowCls = d < 0 ? 'venc__fila--vencida' : d <= 30 ? 'venc__fila--proxima' : '';
  const polizaInfo = r.numero_poliza ? ` · Póliza ${e(r.numero_poliza)}` : '';
  return `
    <tr class="${rowCls}">
      <td class="venc__td-bold">${e(r.nombre)}${r.legajo ? `<span class="venc__td-muted"> #${r.legajo}</span>` : ''}</td>
      <td>${e(r.tipo)}${polizaInfo}</td>
      <td class="venc__td-muted">${emp}${r.area ? ' · '+e(r.area) : ''}</td>
      <td>${fmtFecha(r.fecha_vencimiento)}</td>
      <td><span class="venc__badge ${cls}">${txt}</span></td>
      <td class="venc__td-acc">
        <button class="venc__btn-icon" data-editar="${r.id}" title="Editar">
          <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
        </button>
        <button class="venc__btn-icon venc__btn-icon--danger" data-eliminar="${r.id}" title="Eliminar">
          <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </td>
    </tr>`;
}

function badgeHtml(d) {
  const { cls, txt } = badge(d);
  return `<span class="venc__badge ${cls}">${txt}</span>`;
}

function dias(fecha) {
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  return Math.round((new Date(fecha+'T00:00:00') - hoy) / 86400000);
}

function badge(d) {
  if (d < 0)   return { cls: 'venc__badge--rojo',     txt: 'Vencido' };
  if (d <= 30) return { cls: 'venc__badge--naranja',  txt: `Vence en ${d}d` };
  if (d <= 90) return { cls: 'venc__badge--amarillo', txt: `En ${d}d` };
  return              { cls: 'venc__badge--verde',    txt: 'Vigente' };
}

function fmtFecha(f) {
  return new Date(f+'T00:00:00').toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' });
}

function e(s)  { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function v(id) { return document.getElementById(id)?.value.trim() ?? ''; }
function errHtml(msg) {
  return `<div class="estado-vacio"><div class="estado-vacio__icono"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div><h3 class="estado-vacio__titulo">Error al cargar</h3><p class="estado-vacio__texto">${msg}</p></div>`;
}
