// Configuración → Usuarios: quién entra al tablero y, con casillas, QUÉ MÓDULOS VE cada uno;
// además permisos especiales, administrador, PIN y si está habilitado.
// Los cambios se aplican la próxima vez que la persona abra el tablero.
import { navegacion } from '../config/navegacion.js';
import { escaparHtml as e, htmlError } from './util.js';
import { obtenerUsuario } from '../data/usuario-activo.js';
import {
  cargarAccesos, AccesosNoInstalado, crearUsuario, actualizarUsuario, borrarUsuario, blanquearPin,
} from '../data/accesos.js';

// Permisos especiales (columnas de perfiles_rrhh) — los mismos que usa el login.
const PERMISOS = [
  { col: 'puede_parametrizar',        texto: 'Parametrizar (entra a Configuración, sin Usuarios ni Módulos)' },
  { col: 'puede_autorizar_facturas',  texto: 'Autorizar facturas' },
  { col: 'puede_autorizar_busquedas', texto: 'Autorizar búsquedas' },
  { col: 'puede_eliminar_operativos', texto: 'Eliminar operativos' },
];
// Módulos que se pueden dar o quitar (Configuración no: es solo para administradores).
const MODULOS = navegacion.filter(m => !m.permisosModulo).sort((a, b) => a.orden - b.orden);
const tituloModulo = id => MODULOS.find(m => m.id === id)?.titulo || id;
// modulos_permitidos: null = todos (incluye los que se agreguen después), [] = solo el Panel.
const veModulo = (u, id) => !u.modulos_permitidos || u.modulos_permitidos.includes(id);

const AVISO_SEGURIDAD = `<p class="vac__nota">Tildá qué módulos ve cada persona. El Panel de inicio lo ven todos; Configuración, solo los administradores.
  Los cambios se aplican la próxima vez que la persona abra el tablero. La protección completa de los datos llega con el login seguro (paso de seguridad pendiente).</p>`;

// Aviso chico abajo a la derecha que se va solo (no mueve la pantalla).
let timerAviso = null;
function avisar(texto) {
  let el = document.getElementById('cfg-aviso');
  if (!el) {
    el = document.createElement('div');
    el.id = 'cfg-aviso';
    el.className = 'cfg__aviso';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = '✓ ' + texto;
  el.classList.add('cfg__aviso--visible');
  clearTimeout(timerAviso);
  timerAviso = setTimeout(() => el.classList.remove('cfg__aviso--visible'), 2500);
}

async function cargar(contenedor) {
  contenedor.innerHTML = '<div class="pres__loading">Cargando configuración…</div>';
  try { return await cargarAccesos(); }
  catch (err) {
    console.error(err);
    contenedor.innerHTML = err instanceof AccesosNoInstalado
      ? `<div class="estado-vacio"><h3 class="estado-vacio__titulo">Falta instalar la configuración de accesos</h3>
          <p class="estado-vacio__texto">Abrí Supabase → <strong>SQL Editor</strong>, pegá <code>sql/configuracion_accesos.sql</code> y después <code>sql/configuracion_parametrizar.sql</code> (cada uno con <strong>Run</strong>). Después recargá.</p></div>`
      : htmlError('No se pudo cargar la configuración.', err.message);
    return null;
  }
}

// ── Usuarios ──────────────────────────────────────────────────────────────────
export async function renderizarConfigUsuarios(contenedor) {
  let datos = await cargar(contenedor);
  if (!datos) return;
  const yo = obtenerUsuario();

  // Para altas, bajas y blanqueo de PIN: vuelve a leer los datos SIN mostrar "Cargando…"
  // y conserva la posición de la pantalla.
  async function recargar(msg) {
    const scroller = document.scrollingElement;
    const y = scroller.scrollTop;
    try { datos = await cargarAccesos(); }
    catch (err) { contenedor.querySelector('#cfg-msg').innerHTML = htmlError('No se pudo actualizar la lista.', err.message); return; }
    pintar();
    scroller.scrollTop = y;
    if (msg) avisar(msg);
  }

  function pintar() {
    const { usuarios, nombresEmpleados } = datos;
    const admins = usuarios.filter(u => u.es_admin && u.activo !== false).length;

    contenedor.innerHTML = `
      <div class="vac">
        <div id="cfg-msg"></div>
        <section class="vac__panel">
          <div class="vac__panel-cab"><h3>Qué módulos ve cada persona</h3>
            <button type="button" class="venc__btn-pri" id="cfg-nuevo">+ Nuevo usuario</button></div>
          ${AVISO_SEGURIDAD}
          <div id="cfg-form"></div>
          <div class="sol__tabla-wrap"><table class="sol__tabla hist__tabla cfg__matriz">
            <thead><tr>
              <th class="cfg__matriz-persona">Persona</th>
              <th class="cfg__matriz-col cfg__matriz-col--todos"><span>Todos</span></th>
              ${MODULOS.map(m => `<th class="cfg__matriz-col" title="${e(m.titulo)}"><span>${e(m.titulo)}</span></th>`).join('')}
            </tr></thead>
            <tbody>${usuarios.map(u => {
              const todos = !u.modulos_permitidos;
              return `<tr data-id="${u.id}" class="${u.activo === false ? 'cfg__fila--inactiva' : ''}">
                <td class="cfg__matriz-persona"><strong>${e(u.nombre)}</strong>${yo?.id === u.id ? ' <span class="vac__chip">vos</span>' : ''}${u.activo === false ? ' <span class="vac__chip">deshabilitado</span>' : ''}</td>
                <td class="cfg__matriz-celda cfg__matriz-celda--todos"><input type="checkbox" data-todos ${todos ? 'checked' : ''} aria-label="${e(u.nombre)}: todos los módulos" title="Todos, incluidos los que se agreguen en el futuro"></td>
                ${MODULOS.map(m => `<td class="cfg__matriz-celda"><input type="checkbox" data-modulo="${m.id}" ${veModulo(u, m.id) ? 'checked' : ''} ${todos ? 'disabled' : ''} aria-label="${e(u.nombre)}: ${e(m.titulo)}"></td>`).join('')}
              </tr>`;
            }).join('')}</tbody>
          </table></div>
        </section>

        <section class="vac__panel">
          <div class="vac__panel-cab"><h3>Usuarios del tablero (${usuarios.length})</h3></div>
          <div class="sol__tabla-wrap"><table class="sol__tabla hist__tabla vac__tabla cfg__tabla">
            <thead><tr><th>Persona</th><th>Permisos especiales</th><th>Administrador</th><th>PIN</th><th>Habilitado</th><th></th></tr></thead>
            <tbody>${usuarios.map(u => {
              const soyYo = yo?.id === u.id;
              return `<tr data-id="${u.id}" class="${u.activo === false ? 'cfg__fila--inactiva' : ''}">
                <td><strong>${e(u.nombre)}</strong>${soyYo ? ' <span class="vac__chip">vos</span>' : ''}</td>
                <td class="cfg__permisos">${PERMISOS.map(p => `<label class="vac__check"><input type="checkbox" data-permiso="${p.col}" ${u[p.col] ? 'checked' : ''}> ${p.texto}</label>`).join('')}</td>
                <td><label class="vac__check"><input type="checkbox" data-campo="admin" ${u.es_admin ? 'checked' : ''} ${soyYo ? 'disabled title="No podés quitarte el rol a vos mismo"' : ''}> Sí</label></td>
                <td>${u.tienePin ? '<span class="vac__chip vac__chip--aprobado">Definido</span> <button type="button" class="vac__link" data-accion="pin">Blanquear</button>' : '<span class="vac__chip">Sin definir</span>'}</td>
                <td><label class="vac__check"><input type="checkbox" data-campo="activo" ${u.activo !== false ? 'checked' : ''} ${soyYo ? 'disabled title="No podés deshabilitarte a vos mismo"' : ''}> ${u.activo !== false ? 'Sí' : 'No'}</label></td>
                <td>${soyYo ? '' : '<button type="button" class="venc__btn-sec vac__btn-peligro" data-accion="borrar">Eliminar</button>'}</td>
              </tr>`;
            }).join('')}</tbody>
          </table></div>
          <p class="vac__nota">Blanquear el PIN: en el próximo ingreso la persona elige uno nuevo. Deshabilitar: deja de aparecer para ingresar (no se borra nada). Administradores activos: ${admins}.</p>
        </section>
      </div>`;

    const msgZona = contenedor.querySelector('#cfg-msg');
    const conError = (que, fn) => async (...a) => { try { await fn(...a); } catch (err) { msgZona.innerHTML = htmlError(que, err.message); } };
    const usuarioDe = el => datos.usuarios.find(u => u.id === el.closest('tr').dataset.id);
    const adminsActivos = () => datos.usuarios.filter(u => u.es_admin && u.activo !== false).length;

    // Casillas: se guarda solo ese dato y se actualiza en el lugar, sin volver a cargar la
    // pantalla (antes cada tilde mostraba "Cargando…" y volvía arriba de todo). Si falla el
    // guardado, la casilla vuelve a como estaba y se muestra el error.
    const alTildar = (selector, que, guardar) => contenedor.querySelectorAll(selector).forEach(chk => chk.addEventListener('change', async () => {
      const u = usuarioDe(chk);
      chk.disabled = true;
      try {
        const aviso = await guardar(u, chk);
        if (aviso) avisar(aviso);
      } catch (err) {
        chk.checked = !chk.checked;
        msgZona.innerHTML = htmlError(que, err.message);
      } finally {
        chk.disabled = chk.hasAttribute('data-modulo') && !u.modulos_permitidos;
        if (chk.dataset.campo && yo?.id === u.id) chk.disabled = true;
      }
    }));

    // Grilla de módulos. "Todos" = null (también los módulos futuros). Al destildar "Todos"
    // arranca con todos los actuales tildados, para ir sacando los que no correspondan.
    alTildar('[data-todos]', 'No se pudieron cambiar los módulos.', async (u, chk) => {
      const valor = chk.checked ? null : MODULOS.map(m => m.id);
      await actualizarUsuario(u.id, { modulos_permitidos: valor });
      u.modulos_permitidos = valor;
      chk.closest('tr').querySelectorAll('[data-modulo]').forEach(c => { c.checked = true; c.disabled = chk.checked; });
      return `${u.nombre}: ${chk.checked ? 've todos los módulos' : 'elegí qué módulos ve'}.`;
    });
    alTildar('[data-modulo]', 'No se pudieron cambiar los módulos.', async (u, chk) => {
      const marcados = [...chk.closest('tr').querySelectorAll('[data-modulo]:checked')].map(c => c.dataset.modulo);
      await actualizarUsuario(u.id, { modulos_permitidos: marcados });
      u.modulos_permitidos = marcados;
      return `${u.nombre}: ${chk.checked ? 'ahora ve' : 'ya no ve'} ${tituloModulo(chk.dataset.modulo)}.`;
    });
    alTildar('[data-permiso]', 'No se pudo cambiar el permiso.', async (u, chk) => {
      await actualizarUsuario(u.id, { [chk.dataset.permiso]: chk.checked });
      u[chk.dataset.permiso] = chk.checked;
      return `${u.nombre}: permisos actualizados.`;
    });
    alTildar('[data-campo="admin"]', 'No se pudo cambiar el rol.', async (u, chk) => {
      if (!chk.checked && u.activo !== false && adminsActivos() <= 1) {
        chk.checked = true;
        msgZona.innerHTML = '<div class="vac__alerta vac__alerta--bloq">Es el único administrador activo: nombrá a otro antes.</div>';
        return null;
      }
      await actualizarUsuario(u.id, { es_admin: chk.checked });
      u.es_admin = chk.checked;
      return `${u.nombre}: ${chk.checked ? 'ahora es administrador' : 'ya no es administrador'}.`;
    });
    alTildar('[data-campo="activo"]', 'No se pudo habilitar/deshabilitar.', async (u, chk) => {
      if (!chk.checked && u.es_admin && adminsActivos() <= 1) {
        chk.checked = true;
        msgZona.innerHTML = '<div class="vac__alerta vac__alerta--bloq">Es el único administrador activo: nombrá a otro antes de deshabilitarlo.</div>';
        return null;
      }
      await actualizarUsuario(u.id, { activo: chk.checked });
      u.activo = chk.checked;
      contenedor.querySelectorAll(`tr[data-id="${u.id}"]`).forEach(tr => tr.classList.toggle('cfg__fila--inactiva', !chk.checked));
      chk.nextSibling.textContent = chk.checked ? ' Sí' : ' No';
      return `${u.nombre}: ${chk.checked ? 'habilitado' : 'deshabilitado'}.`;
    });
    contenedor.querySelectorAll('[data-accion="pin"]').forEach(b => b.addEventListener('click', conError('No se pudo blanquear el PIN.', async () => {
      const u = usuarioDe(b);
      if (!confirm(`¿Blanquear el PIN de ${u.nombre}? En su próximo ingreso va a tener que crear uno nuevo.`)) return;
      await blanquearPin(u.id);
      await recargar(`${u.nombre}: PIN blanqueado.`);
    })));
    contenedor.querySelectorAll('[data-accion="borrar"]').forEach(b => b.addEventListener('click', conError('No se pudo eliminar.', async () => {
      const u = usuarioDe(b);
      if (u.es_admin && adminsActivos() <= 1) { msgZona.innerHTML = '<div class="vac__alerta vac__alerta--bloq">Es el único administrador activo.</div>'; return; }
      if (!confirm(`¿Eliminar a ${u.nombre} del tablero? Si solo querés que no entre por un tiempo, mejor deshabilitalo.`)) return;
      await borrarUsuario(u.id);
      await recargar(`${u.nombre}: eliminado.`);
    })));

    contenedor.querySelector('#cfg-nuevo').addEventListener('click', () => {
      const zona = contenedor.querySelector('#cfg-form');
      const existentes = new Set(datos.usuarios.map(u => u.nombre));
      zona.innerHTML = `
        <div class="cfg__form">
          <label>Persona <input class="venc__input" id="cfg-n-nombre" list="cfg-n-lista" placeholder="Apellido, Nombre"></label>
          <datalist id="cfg-n-lista">${nombresEmpleados.filter(n => !existentes.has(n)).map(n => `<option value="${e(n)}">`).join('')}</datalist>
          <label class="vac__check"><input type="checkbox" id="cfg-n-admin"> Administrador</label>
          <button type="button" class="venc__btn-sec" id="cfg-n-cancel">Cancelar</button>
          <button type="button" class="venc__btn-pri" id="cfg-n-ok">Crear</button>
        </div>
        <p class="vac__nota">Se crea sin módulos (solo ve el Panel) y sin PIN: después tildás en la grilla qué módulos ve, y en su primer ingreso elige su PIN.</p>`;
      zona.querySelector('#cfg-n-nombre').focus();
      zona.querySelector('#cfg-n-cancel').addEventListener('click', () => { zona.innerHTML = ''; });
      zona.querySelector('#cfg-n-ok').addEventListener('click', conError('No se pudo crear el usuario.', async () => {
        const nombre = zona.querySelector('#cfg-n-nombre').value.trim();
        if (!nombre) { zona.querySelector('#cfg-n-nombre').focus(); return; }
        if (existentes.has(nombre)) { msgZona.innerHTML = '<div class="vac__alerta vac__alerta--bloq">Esa persona ya tiene usuario.</div>'; return; }
        await crearUsuario({ nombre, modulos_permitidos: [], es_admin: zona.querySelector('#cfg-n-admin').checked, activo: true });
        await recargar(`${nombre}: usuario creado. Tildá en la grilla qué módulos ve.`);
      }));
    });
  }

  pintar();
}
