import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';

const HDR = {
  apikey:         SUPABASE_ANON_KEY,
  Authorization:  `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
};
const TABLA = 'licencias_vencimiento';

const TIPOS_LICENCIA = [
  'Registro de conducir cat. B',
  'Registro de conducir cat. D/E',
  'Carnet de apilador / grúa',
  'Trabajo en altura',
  'Carnet de soldador',
  'Libreta sanitaria',
  'Habilitación municipal',
  'Matafuego',
  'Otro',
];

async function sbGet(q)        { const r = await fetch(`${SUPABASE_URL}/rest/v1/${TABLA}?${q}`, { headers: HDR }); if (!r.ok) throw new Error('HTTP '+r.status); return r.json(); }
async function sbInsert(body)  { const r = await fetch(`${SUPABASE_URL}/rest/v1/${TABLA}`, { method:'POST',  headers:{...HDR,Prefer:'return=minimal'}, body:JSON.stringify(body) }); if (!r.ok) throw new Error(await r.text()); }
async function sbUpdate(id, b) { const r = await fetch(`${SUPABASE_URL}/rest/v1/${TABLA}?id=eq.${id}`, { method:'PATCH', headers:{...HDR,Prefer:'return=minimal'}, body:JSON.stringify(b) }); if (!r.ok) throw new Error(await r.text()); }
async function sbDelete(id)    { const r = await fetch(`${SUPABASE_URL}/rest/v1/${TABLA}?id=eq.${id}`, { method:'DELETE', headers: HDR }); if (!r.ok) throw new Error(await r.text()); }

export async function renderizarVencimientosLicencias(contenedor) {
  let registros  = [];
  let editandoId = null;
  let toastTimer = null;

  contenedor.innerHTML = `<p class="plantel__cargando">Cargando licencias…</p>`;

  async function cargar() {
    try {
      registros = await sbGet(`order=fecha_vencimiento.asc`);
    } catch {
      contenedor.innerHTML = errHtml('No se pudieron cargar las licencias.');
      return;
    }
    renderVista();
  }

  function renderVista() {
    const vencidos = registros.filter(r => dias(r.fecha_vencimiento) <  0).length;
    const proximos = registros.filter(r => { const d=dias(r.fecha_vencimiento); return d>=0 && d<=30; }).length;

    contenedor.innerHTML = `
      <div class="venc">
        <div class="venc__toolbar">
          <div class="venc__resumen">
            ${vencidos ? `<span class="venc__pill venc__pill--rojo">${vencidos} vencida${vencidos!==1?'s':''}</span>` : ''}
            ${proximos ? `<span class="venc__pill venc__pill--naranja">${proximos} próxima${proximos!==1?'s':''} a vencer</span>` : ''}
            ${!vencidos && !proximos ? `<span class="venc__pill venc__pill--verde">Todo en regla</span>` : ''}
          </div>
          <div class="venc__btns">
            <button class="venc__btn-pri" id="venc-nuevo">
              <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Agregar licencia
            </button>
          </div>
        </div>

        ${registros.length === 0
          ? `<p class="venc__vacio">No hay licencias. Agregá la primera.</p>`
          : `<div class="venc__tabla-wrap">
              <table class="venc__tabla">
                <thead><tr>
                  <th>Persona</th><th>Legajo</th><th>Tipo de licencia</th>
                  <th>Vencimiento</th><th>Estado</th><th></th>
                </tr></thead>
                <tbody>${registros.map(filaLicencia).join('')}</tbody>
              </table>
            </div>`}
      </div>`;

    contenedor.querySelector('#venc-nuevo').addEventListener('click', () => abrirModal());
    contenedor.querySelectorAll('[data-editar]').forEach(b => {
      b.addEventListener('click', () => abrirModal(registros.find(r => r.id === b.dataset.editar)));
    });
    contenedor.querySelectorAll('[data-eliminar]').forEach(b => {
      b.addEventListener('click', () => eliminar(b.dataset.eliminar));
    });
  }

  function abrirModal(reg = null) {
    editandoId = reg?.id ?? null;
    document.getElementById('venc-modal-licencias')?.remove();

    const tipoEsOtro = reg && !TIPOS_LICENCIA.slice(0,-1).includes(reg.tipo_licencia);
    const tipoSelect = tipoEsOtro ? 'Otro' : (reg?.tipo_licencia || TIPOS_LICENCIA[0]);

    const modal = document.createElement('div');
    modal.id        = 'venc-modal-licencias';
    modal.className = 'venc__modal-overlay';
    modal.innerHTML = `
      <div class="venc__modal" role="dialog" aria-modal="true">
        <h3 class="venc__modal-titulo">${reg ? 'Editar licencia' : 'Nueva licencia'}</h3>

        <div class="venc__row2">
          <div>
            <label class="venc__label">Apellido y nombre *</label>
            <input class="venc__input" id="vm-nombre" type="text" value="${e(reg?.apellido_y_nombre)}" placeholder="Ej: Pérez Juan">
          </div>
          <div>
            <label class="venc__label">Legajo</label>
            <input class="venc__input" id="vm-legajo" type="text" value="${e(reg?.legajo)}" placeholder="Ej: 123">
          </div>
        </div>

        <div class="venc__row2">
          <div>
            <label class="venc__label">Empresa</label>
            <select class="venc__input" id="vm-empresa">
              <option value="">— Sin especificar —</option>
              <option value="CIMOMET" ${reg?.empresa==='CIMOMET'?'selected':''}>Cimomet S.A.</option>
              <option value="COMOING" ${reg?.empresa==='COMOING'?'selected':''}>Co.mo.ing S.R.L.</option>
            </select>
          </div>
          <div>
            <label class="venc__label">N.° documento / habilitación</label>
            <input class="venc__input" id="vm-nrodoc" type="text" value="${e(reg?.numero_doc)}" placeholder="Opcional">
          </div>
        </div>

        <label class="venc__label">Tipo de licencia *</label>
        <select class="venc__input" id="vm-tipo">
          ${TIPOS_LICENCIA.map(t => `<option value="${t}" ${tipoSelect===t?'selected':''}>${t}</option>`).join('')}
        </select>
        <input class="venc__input" id="vm-tipo-custom" type="text"
               style="margin-top:6px;display:${tipoEsOtro?'block':'none'}"
               value="${tipoEsOtro ? e(reg.tipo_licencia) : ''}"
               placeholder="Especificá el tipo de licencia">

        <label class="venc__label" style="margin-top:12px">Fecha de vencimiento *</label>
        <input class="venc__input" id="vm-venc" type="date" value="${reg?.fecha_vencimiento||''}">

        <label class="venc__label">Notas</label>
        <textarea class="venc__textarea" id="vm-notas" rows="2" placeholder="Observaciones opcionales">${e(reg?.notas)}</textarea>

        <div class="venc__modal-footer">
          <button class="venc__btn-sec" id="vm-cancel">Cancelar</button>
          <button class="venc__btn-pri" id="vm-ok">${reg ? 'Guardar cambios' : 'Agregar'}</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    // Mostrar/ocultar campo custom cuando se elige "Otro"
    modal.querySelector('#vm-tipo').addEventListener('change', function() {
      modal.querySelector('#vm-tipo-custom').style.display = this.value === 'Otro' ? 'block' : 'none';
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
    const nombre  = v('vm-nombre');
    const legajo  = v('vm-legajo') || null;
    const empresa = v('vm-empresa') || null;
    const nrodoc  = v('vm-nrodoc') || null;
    const tipoSel = v('vm-tipo');
    const tipoCustom = v('vm-tipo-custom');
    const tipo    = tipoSel === 'Otro' ? tipoCustom : tipoSel;
    const venc    = v('vm-venc');
    const notas   = v('vm-notas') || null;

    if (!nombre || !tipo || !venc) { toast('Completá los campos obligatorios (*)', 'error'); return; }

    const btn = document.getElementById('vm-ok');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
    try {
      const body = { apellido_y_nombre: nombre, legajo, empresa, tipo_licencia: tipo, numero_doc: nrodoc, fecha_vencimiento: venc, notas };
      editandoId ? await sbUpdate(editandoId, body) : await sbInsert({ ...body, activo: true });
      cerrar();
      await cargar();
      toast(editandoId ? 'Licencia actualizada' : 'Licencia agregada', 'ok');
    } catch (err) {
      toast('Error: ' + err.message, 'error');
      if (btn) { btn.disabled = false; btn.textContent = editandoId ? 'Guardar cambios' : 'Agregar'; }
    }
  }

  async function eliminar(id) {
    if (!confirm('¿Eliminar esta licencia? Esta acción no se puede deshacer.')) return;
    try { await sbDelete(id); await cargar(); toast('Licencia eliminada'); }
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

function filaLicencia(r) {
  const d = dias(r.fecha_vencimiento);
  const { cls, txt } = badge(d);
  const rowCls = d < 0 ? 'venc__fila--vencida' : d <= 30 ? 'venc__fila--proxima' : '';
  const emp = r.empresa === 'CIMOMET' ? '<span class="plantel__badge plantel__badge--cimomet">Cimomet</span>'
            : r.empresa === 'COMOING' ? '<span class="plantel__badge plantel__badge--comoing">Co.mo.ing</span>'
            : '';
  return `
    <tr class="${rowCls}">
      <td class="venc__td-bold">${e(r.apellido_y_nombre)} ${emp}</td>
      <td class="venc__td-muted">${r.legajo || '—'}</td>
      <td>${e(r.tipo_licencia)}${r.numero_doc ? `<span class="venc__nrodoc"> #${e(r.numero_doc)}</span>` : ''}</td>
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

function dias(fecha) {
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  return Math.round((new Date(fecha+'T00:00:00') - hoy) / 86400000);
}

function badge(d) {
  if (d < 0)   return { cls: 'venc__badge--rojo',     txt: 'Vencida' };
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
