// Autorización de Facturas (ARCA) → Proveedores en seguimiento.
// El usuario administra esta lista libremente (alta y baja) desde acá — no es config estática.

import { crearHelpersSupabase, crearToast, e, v, errHtml } from './venc-comun.js';

const TABLA = 'arca_proveedores';
const { sbGet, sbInsert, sbUpdate, sbDelete } = crearHelpersSupabase(TABLA);

const perfilesHelper = crearHelpersSupabase('perfiles_rrhh');

function plazoTexto(dias) {
  if (dias == null) return '<span class="venc__td-muted">Sin config. de pago</span>';
  if (dias === 0) return 'Se paga el mismo día de la factura';
  return `Se paga a ${dias} día${dias !== 1 ? 's' : ''} de la factura`;
}

export async function renderizarArcaProveedores(contenedor) {
  let registros  = [];
  let autorizadores = [];
  let editandoId = null;
  const toast    = crearToast(contenedor);

  contenedor.innerHTML = `<p class="plantel__cargando">Cargando proveedores…</p>`;

  function nombreAutorizador(id) {
    if (!id) return '<span class="venc__td-muted">Sin asignar</span>';
    return e(autorizadores.find(p => p.id === id)?.nombre) || '<span class="venc__td-muted">Sin asignar</span>';
  }

  async function cargar() {
    try {
      const [regs, perfiles] = await Promise.all([
        sbGet('order=razon_social.asc'),
        perfilesHelper.sbGet('puede_autorizar_facturas=eq.true&select=id,nombre&order=nombre.asc'),
      ]);
      registros = regs;
      autorizadores = perfiles;
    } catch {
      contenedor.innerHTML = errHtml('No se pudieron cargar los proveedores.');
      return;
    }
    renderVista();
  }

  function renderVista() {
    const activos = registros.filter(r => r.activo).length;

    contenedor.innerHTML = `
      <div class="venc">
        <div class="venc__toolbar">
          <div class="venc__resumen">
            <span class="venc__pill venc__pill--gris">${activos} proveedor${activos!==1?'es':''} en seguimiento</span>
          </div>
          <div class="venc__btns">
            <button class="venc__btn-pri" id="venc-nuevo">
              <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Agregar proveedor
            </button>
          </div>
        </div>

        <div class="venc__seccion">
          ${registros.length === 0
            ? `<p class="venc__vacio">No hay proveedores cargados. Agregá el primero para empezar a trackear sus comprobantes.</p>`
            : `<div class="venc__tabla-wrap">
                <table class="venc__tabla">
                  <thead><tr>
                    <th>CUIT</th><th>Razón social</th><th>Plazo de pago</th><th>Autorizador</th><th>Estado</th><th></th>
                  </tr></thead>
                  <tbody>${registros.map(fila).join('')}</tbody>
                </table>
              </div>`}
        </div>
      </div>`;

    contenedor.querySelector('#venc-nuevo').addEventListener('click', () => abrirModal());
    contenedor.querySelectorAll('[data-editar]').forEach(b =>
      b.addEventListener('click', () => abrirModal(registros.find(r => String(r.id) === b.dataset.editar)))
    );
    contenedor.querySelectorAll('[data-eliminar]').forEach(b =>
      b.addEventListener('click', () => eliminar(b.dataset.eliminar))
    );
    contenedor.querySelectorAll('[data-toggle]').forEach(b =>
      b.addEventListener('click', () => toggleActivo(b.dataset.toggle, b.dataset.activo === 'true'))
    );
  }

  function fila(r) {
    return `
      <tr>
        <td class="venc__td-bold">${e(r.cuit)}</td>
        <td>${r.razon_social ? e(r.razon_social) : '<span class="venc__td-muted">Pendiente de detectar…</span>'}</td>
        <td class="venc__td-muted">${plazoTexto(r.dias_plazo_pago)}</td>
        <td class="venc__td-muted">${nombreAutorizador(r.autorizador_default_id)}</td>
        <td>
          <button class="venc__badge ${r.activo ? 'venc__badge--verde' : 'venc__badge--rojo'}" data-toggle="${r.id}" data-activo="${r.activo}" title="Cambiar estado" style="border:none;cursor:pointer;">
            ${r.activo ? 'Activo' : 'Inactivo'}
          </button>
        </td>
        <td class="venc__td-acc">
          <button class="venc__btn-icon" data-editar="${r.id}" title="Editar plazo de pago">
            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
          </button>
          <button class="venc__btn-icon venc__btn-icon--danger" data-eliminar="${r.id}" title="Eliminar">
            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </td>
      </tr>`;
  }

  function abrirModal(reg = null) {
    editandoId = reg?.id ?? null;
    document.getElementById('venc-modal-proveedor')?.remove();

    const modal = document.createElement('div');
    modal.id        = 'venc-modal-proveedor';
    modal.className = 'venc__modal-overlay';
    modal.innerHTML = `
      <div class="venc__modal" role="dialog" aria-modal="true">
        <h3 class="venc__modal-titulo">${reg ? 'Editar proveedor' : 'Nuevo proveedor'}</h3>

        ${reg ? `
          <p class="venc__ayuda">${e(reg.razon_social) || 'Proveedor sin nombre detectado'} · CUIT ${e(reg.cuit)}</p>
        ` : `
          <label class="venc__label">CUIT *</label>
          <input class="venc__input" id="vm-cuit" type="text" placeholder="Ej: 20304050607">
          <p class="venc__ayuda">Con el CUIT alcanza — la razón social se completa sola cuando se importe el primer comprobante de ARCA de este proveedor.</p>
        `}

        <label class="venc__label">Días de plazo de pago</label>
        <input class="venc__input" id="vm-dias-plazo" type="number" min="0" step="1" value="${reg?.dias_plazo_pago ?? ''}" placeholder="Ej: 30 (0 = mismo día de la factura)">
        <p class="venc__ayuda">Cuando importes un comprobante de este proveedor, se va a generar automáticamente un vencimiento a pagar en "Vencimientos → Pagos" con esta cantidad de días desde la fecha de la factura. Dejalo vacío si no querés que se generen automáticamente (podés cargarlos a mano cuando quieras).</p>

        <label class="venc__label">Autorizador por defecto</label>
        <select class="venc__input" id="vm-autorizador">
          <option value="">— Sin asignar —</option>
          ${autorizadores.map(p => `<option value="${p.id}" ${reg?.autorizador_default_id===p.id?'selected':''}>${e(p.nombre)}</option>`).join('')}
        </select>
        <p class="venc__ayuda">Quién debería autorizar las facturas de este proveedor. Se muestra como sugerencia en "Autorizar" — no bloquea a los demás perfiles con permiso.</p>

        <div class="venc__modal-footer">
          <button class="venc__btn-sec" id="vm-cancel">Cancelar</button>
          <button class="venc__btn-pri" id="vm-ok">${reg ? 'Guardar cambios' : 'Agregar'}</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const sc = document.querySelector('.app-contenido');
    if (sc) sc.style.overflow = 'hidden';
    const cerrar = () => { modal.remove(); if (sc) sc.style.overflow = ''; };
    modal.addEventListener('click', ev => { if (ev.target === modal) cerrar(); });
    modal.querySelector('#vm-cancel').addEventListener('click', cerrar);
    modal.querySelector('#vm-ok').addEventListener('click', () => guardar(cerrar));
    setTimeout(() => modal.querySelector(reg ? '#vm-dias-plazo' : '#vm-cuit').focus({ preventScroll: true }), 40);
  }

  async function guardar(cerrar) {
    const diasStr  = v('vm-dias-plazo');
    const diasPlazo = diasStr !== '' ? +diasStr : null;
    const autorizadorId = v('vm-autorizador') || null;

    const btn = document.getElementById('vm-ok');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
    try {
      if (editandoId) {
        await sbUpdate(editandoId, { dias_plazo_pago: diasPlazo, autorizador_default_id: autorizadorId });
      } else {
        const cuit = v('vm-cuit').replace(/\D/g, '');
        if (!cuit) { toast('Completá el CUIT', 'error'); if (btn) { btn.disabled = false; btn.textContent = 'Agregar'; } return; }
        await sbInsert({ cuit, razon_social: null, activo: true, dias_plazo_pago: diasPlazo, autorizador_default_id: autorizadorId });
      }
      cerrar();
      await cargar();
      toast(editandoId ? 'Proveedor actualizado' : 'Proveedor agregado', 'ok');
    } catch (err) {
      toast('Error: ' + err.message, 'error');
      if (btn) { btn.disabled = false; btn.textContent = editandoId ? 'Guardar cambios' : 'Agregar'; }
    }
  }

  async function toggleActivo(id, activoActual) {
    try { await sbUpdate(id, { activo: !activoActual }); await cargar(); }
    catch { toast('Error al actualizar', 'error'); }
  }

  async function eliminar(id) {
    if (!confirm('¿Eliminar este proveedor de la lista de seguimiento? Los comprobantes ya importados no se borran.')) return;
    try { await sbDelete(id); await cargar(); toast('Proveedor eliminado'); }
    catch { toast('Error al eliminar', 'error'); }
  }

  await cargar();
}
