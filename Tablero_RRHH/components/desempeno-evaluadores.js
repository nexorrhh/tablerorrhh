// Desempeño → Evaluadores.
// RRHH da de alta evaluadores externos (ej. "Javier Hernández", "Responsable de Ingeniería") y
// les asigna manualmente qué legajos le corresponde evaluar a cada uno — el "diagrama" de quién
// evalúa a quién lo arma RRHH acá, no hay ningún cruce automático por sector/puesto (empleados
// no tiene un campo de sector separado de desc_puesto). Los evaluadores NUNCA entran a este
// Tablero: cargan sus evaluaciones desde el portal separado en Evaluadores/index.html, que
// escribe en las mismas tablas que ya lee "Desempeño → Indicadores".

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';
import {
  obtenerEvaluadores, crearEvaluador, cambiarActivoEvaluador, borrarEvaluador,
  obtenerAsignaciones, agregarAsignacion, quitarAsignacion, dniDesdeCuil,
} from '../data/evaluadores.js';
import { EMP_LABEL } from './desempeno-cargar.js';

const HDR = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };

function eP(s) { return (s || '').toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function normTxt(s) { return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

export async function renderizarDesempenoEvaluadores(contenedor) {
  contenedor.innerHTML = '<p class="plantel__cargando">Cargando…</p>';

  let empleados = [], evaluadores = [], asignaciones = [];
  try {
    const [rE, ev, asig] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/empleados?select=legajo,apellido_y_nombre,empresa,desc_puesto,activo,cuil&limit=2000`, { headers: HDR }),
      obtenerEvaluadores(),
      obtenerAsignaciones(),
    ]);
    empleados = rE.ok ? await rE.json() : [];
    evaluadores = ev;
    asignaciones = asig;
  } catch (e) {
    contenedor.innerHTML = `<div class="pres__vacio">Error al cargar: ${eP(e.message)}</div>`;
    return;
  }

  const activos = empleados.filter(p => p.activo);
  const linkPortal = `${location.origin}${location.pathname.replace(/\/[^/]*$/, '')}/Evaluadores/`;
  let expandidoId = null;

  contenedor.innerHTML = `
    <div class="pres__personas-wrap">
      <p class="pres__subtitulo" style="margin-bottom:var(--espacio-s)">
        Acá se da de alta a cada evaluador y se le asigna manualmente qué personas le toca evaluar.
        Los evaluadores no entran a este Tablero — cargan sus evaluaciones (anual y período de
        prueba) desde un portal aparte, con su nombre y DNI. Lo que carguen aparece automáticamente
        en "Indicadores", igual que si lo hubiera cargado RRHH.
      </p>
      <div class="pres__personas-wrap" style="background:var(--color-fondo);border:1px solid var(--color-borde);border-radius:var(--radio-s);padding:var(--espacio-m);margin-bottom:var(--espacio-l)">
        <span class="desem__campo" style="font-weight:600;color:var(--color-texto-sec);font-size:0.8rem">Link del portal para los evaluadores</span>
        <div style="display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap">
          <code id="evd-link" style="font-size:0.85rem;background:var(--color-fondo-tarjeta);border:1px solid var(--color-borde);border-radius:6px;padding:6px 10px">${eP(linkPortal)}</code>
          <button type="button" class="pind__dep-toggle" id="evd-copiar">Copiar link</button>
        </div>
      </div>

      <div class="fichexc__agregar" style="margin-bottom:var(--espacio-l)">
        <h3 class="pind__sec-tit" style="margin-bottom:8px">Nuevo evaluador</h3>
        <p class="pres__subtitulo" style="margin-bottom:8px">Se elige de la lista de personal — el DNI se detecta solo desde su CUIL, no hace falta tipearlo.</p>
        <input type="search" id="evd-nuevo-busq" class="plantel__busqueda" autocomplete="off"
               placeholder="Buscar persona por legajo o nombre…">
        <div id="evd-nuevo-resultados" class="pres-ficha__resultados" hidden></div>
        <div id="evd-nuevo-confirmar"></div>
      </div>

      <div id="evd-lista"></div>
    </div>
  `;

  const linkCode = contenedor.querySelector('#evd-link');
  contenedor.querySelector('#evd-copiar').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(linkCode.textContent);
      const btn = contenedor.querySelector('#evd-copiar');
      const original = btn.textContent;
      btn.textContent = '✓ Copiado';
      setTimeout(() => { btn.textContent = original; }, 1500);
    } catch { /* portapapeles no disponible — el link ya está visible para copiar a mano */ }
  });

  const busqNuevo = contenedor.querySelector('#evd-nuevo-busq');
  const resultadosNuevo = contenedor.querySelector('#evd-nuevo-resultados');
  const confirmarNuevo = contenedor.querySelector('#evd-nuevo-confirmar');

  busqNuevo.addEventListener('input', () => {
    const texto = normTxt(busqNuevo.value.trim());
    confirmarNuevo.innerHTML = '';
    if (!texto) { resultadosNuevo.hidden = true; resultadosNuevo.innerHTML = ''; return; }
    const yaEvaluadores = new Set(evaluadores.filter(e => e.legajo != null).map(e => `${e.legajo}|${e.empresa}`));
    const coincidencias = activos
      .filter(p => !yaEvaluadores.has(`${p.legajo}|${p.empresa}`))
      .filter(p => normTxt(p.apellido_y_nombre).includes(texto) || String(p.legajo).includes(texto))
      .slice(0, 12);
    resultadosNuevo.hidden = false;
    resultadosNuevo.innerHTML = coincidencias.length
      ? coincidencias.map(p => `
          <button type="button" class="pres-ficha__resultado" data-legajo="${p.legajo}" data-empresa="${eP(p.empresa)}">
            <span class="pres-ficha__resultado-nombre">${eP(p.apellido_y_nombre)}</span>
            <span class="pres-ficha__resultado-meta">Legajo #${p.legajo} · ${EMP_LABEL[p.empresa] || p.empresa}</span>
          </button>`).join('')
      : `<p class="pres-ficha__sin-resultados">Sin resultados.</p>`;

    resultadosNuevo.querySelectorAll('[data-legajo]').forEach(btn => {
      btn.addEventListener('click', () => {
        const persona = activos.find(p => String(p.legajo) === btn.dataset.legajo && p.empresa === btn.dataset.empresa);
        resultadosNuevo.hidden = true; resultadosNuevo.innerHTML = '';
        renderConfirmar(persona);
      });
    });
  });

  function renderConfirmar(persona) {
    const dni = dniDesdeCuil(persona.cuil);
    confirmarNuevo.innerHTML = `
      <div class="plantel__param-fila" style="margin-top:8px">
        <div class="plantel__param-info">
          <span class="plantel__param-puesto">${eP(persona.apellido_y_nombre)}</span>
          <span class="plantel__param-count-chico">
            Legajo #${persona.legajo} · ${EMP_LABEL[persona.empresa] || persona.empresa}
            ${dni ? ` · DNI detectado: ${eP(dni)}` : ' · No se pudo detectar el DNI desde el CUIL cargado'}
          </span>
        </div>
        <div class="plantel__param-acciones">
          <button type="button" class="plantel__param-btn" id="evd-nuevo-cancelar">Cancelar</button>
          <button type="button" class="pres__btn-confirmar" id="evd-nuevo-confirmar-btn" ${dni ? '' : 'disabled'}>+ Agregar como evaluador</button>
        </div>
      </div>
      <p id="evd-crear-estado"></p>
    `;
    busqNuevo.value = '';
    const crearEstado = confirmarNuevo.querySelector('#evd-crear-estado');

    confirmarNuevo.querySelector('#evd-nuevo-cancelar').addEventListener('click', () => { confirmarNuevo.innerHTML = ''; });
    confirmarNuevo.querySelector('#evd-nuevo-confirmar-btn').addEventListener('click', async () => {
      const btn = confirmarNuevo.querySelector('#evd-nuevo-confirmar-btn');
      btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        const nuevo = await crearEvaluador({ nombre: persona.apellido_y_nombre, legajo: persona.legajo, empresa: persona.empresa, documento: dni });
        evaluadores.push(nuevo);
        evaluadores.sort((a, b) => a.nombre.localeCompare(b.nombre));
        confirmarNuevo.innerHTML = '';
        renderLista();
      } catch (err) {
        crearEstado.innerHTML = `<p class="pres__msg-error">No se pudo crear: ${eP(err.message)}</p>`;
        btn.disabled = false; btn.textContent = '+ Agregar como evaluador';
      }
    });
  }

  const listaEl = contenedor.querySelector('#evd-lista');
  renderLista();

  function renderLista() {
    if (!evaluadores.length) {
      listaEl.innerHTML = '<p class="pres__vacio">Todavía no hay evaluadores cargados.</p>';
      return;
    }
    listaEl.innerHTML = evaluadores.map(ev => tarjetaEvaluador(ev)).join('');

    evaluadores.forEach(ev => {
      const header = listaEl.querySelector(`[data-toggle="${ev.id}"]`);
      header?.addEventListener('click', () => {
        expandidoId = expandidoId === ev.id ? null : ev.id;
        renderLista();
      });

      const btnActivo = listaEl.querySelector(`[data-activo-toggle="${ev.id}"]`);
      btnActivo?.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await cambiarActivoEvaluador(ev.id, !ev.activo);
          ev.activo = !ev.activo;
          renderLista();
        } catch (err) {
          alert('No se pudo actualizar: ' + err.message);
        }
      });

      const btnBorrar = listaEl.querySelector(`[data-borrar="${ev.id}"]`);
      btnBorrar?.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`¿Eliminar a "${ev.nombre}" como evaluador? También se borran sus asignaciones.`)) return;
        try {
          await borrarEvaluador(ev.id);
          evaluadores = evaluadores.filter(x => x.id !== ev.id);
          asignaciones = asignaciones.filter(a => a.evaluador_id !== ev.id);
          if (expandidoId === ev.id) expandidoId = null;
          renderLista();
        } catch (err) {
          alert('No se pudo eliminar: ' + err.message);
        }
      });

      if (expandidoId === ev.id) wireAsignaciones(ev);
    });
  }

  function tarjetaEvaluador(ev) {
    const asignados = asignaciones
      .filter(a => a.evaluador_id === ev.id)
      .map(a => activos.find(p => String(p.legajo) === String(a.legajo) && p.empresa === a.empresa))
      .filter(Boolean)
      .sort((a, b) => a.apellido_y_nombre.localeCompare(b.apellido_y_nombre));

    return `
      <div class="pind__sec" style="margin-bottom:var(--espacio-m)">
        <div class="pind__grupo-header" data-toggle="${ev.id}" style="cursor:pointer;border-left-color:var(--color-primario)">
          <div class="pind__grupo-header-izq">
            <h2 class="pind__grupo-titulo">${eP(ev.nombre)}</h2>
            <div class="pind__grupo-badges">
              <span class="pind__grupo-badge ${ev.activo ? 'pind__grupo-badge--activo' : 'pind__grupo-badge--desvinc'}">${ev.activo ? 'Activo' : 'Desactivado'}</span>
              ${ev.legajo != null ? `<span class="pind__grupo-badge pind__grupo-badge--desvinc">Legajo #${ev.legajo} · ${EMP_LABEL[ev.empresa] || ev.empresa}</span>` : ''}
              <span class="pind__grupo-badge pind__grupo-badge--desvinc">${asignados.length} persona${asignados.length !== 1 ? 's' : ''} asignada${asignados.length !== 1 ? 's' : ''}</span>
            </div>
          </div>
          <div style="display:flex;gap:8px">
            <button type="button" class="pind__dep-toggle" data-activo-toggle="${ev.id}">${ev.activo ? 'Desactivar' : 'Reactivar'}</button>
            <button type="button" class="pind__dep-toggle" data-borrar="${ev.id}">Eliminar</button>
            <button type="button" class="pind__dep-toggle" data-toggle="${ev.id}">${expandidoId === ev.id ? '▾ Ocultar' : '▸ Ver / asignar'}</button>
          </div>
        </div>
        ${expandidoId === ev.id ? `
        <div style="padding:var(--espacio-m)">
          <input type="search" id="evd-busq-${ev.id}" class="plantel__busqueda" autocomplete="off"
                 placeholder="Buscar persona por legajo o nombre para asignarle…">
          <div id="evd-resultados-${ev.id}" class="pres-ficha__resultados" hidden></div>
          <div style="margin-top:var(--espacio-m)">
            ${asignados.length
              ? asignados.map(p => filaAsignado(ev.id, p)).join('')
              : '<p class="plantel__param-vacio">Todavía no tiene a nadie asignado.</p>'}
          </div>
        </div>` : ''}
      </div>
    `;
  }

  function filaAsignado(evaluadorId, p) {
    return `
      <div class="plantel__param-fila">
        <div class="plantel__param-info">
          <span class="plantel__param-puesto">${eP(p.apellido_y_nombre)}</span>
          <span class="plantel__param-count-chico">Legajo #${p.legajo} · ${EMP_LABEL[p.empresa] || p.empresa} · ${eP(p.desc_puesto || '—')}</span>
        </div>
        <div class="plantel__param-acciones">
          <button type="button" class="plantel__param-btn" data-quitar-asig="${evaluadorId}" data-legajo="${p.legajo}" data-empresa="${eP(p.empresa)}">Quitar</button>
        </div>
      </div>`;
  }

  function wireAsignaciones(ev) {
    const busq = listaEl.querySelector(`#evd-busq-${ev.id}`);
    const resultadosEl = listaEl.querySelector(`#evd-resultados-${ev.id}`);
    if (!busq) return;

    busq.addEventListener('input', () => {
      const texto = normTxt(busq.value.trim());
      if (!texto) { resultadosEl.hidden = true; resultadosEl.innerHTML = ''; return; }
      const yaAsignados = new Set(asignaciones.filter(a => a.evaluador_id === ev.id).map(a => `${a.legajo}|${a.empresa}`));
      const coincidencias = activos
        .filter(p => !yaAsignados.has(`${p.legajo}|${p.empresa}`))
        .filter(p => normTxt(p.apellido_y_nombre).includes(texto) || String(p.legajo).includes(texto))
        .slice(0, 12);
      resultadosEl.hidden = false;
      resultadosEl.innerHTML = coincidencias.length
        ? coincidencias.map(p => `
            <button type="button" class="pres-ficha__resultado" data-legajo="${p.legajo}" data-empresa="${eP(p.empresa)}">
              <span class="pres-ficha__resultado-nombre">${eP(p.apellido_y_nombre)}</span>
              <span class="pres-ficha__resultado-meta">Legajo #${p.legajo} · ${EMP_LABEL[p.empresa] || p.empresa} · ${eP(p.desc_puesto || '—')}</span>
            </button>`).join('')
        : `<p class="pres-ficha__sin-resultados">Sin resultados.</p>`;

      resultadosEl.querySelectorAll('[data-legajo]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const { legajo, empresa } = btn.dataset;
          busq.value = ''; resultadosEl.hidden = true;
          try {
            await agregarAsignacion(ev.id, legajo, empresa);
            asignaciones.push({ evaluador_id: ev.id, legajo: +legajo, empresa });
            renderLista();
          } catch (err) {
            alert('No se pudo asignar: ' + err.message);
          }
        });
      });
    });

    listaEl.querySelectorAll(`[data-quitar-asig="${ev.id}"]`).forEach(btn => {
      btn.addEventListener('click', async () => {
        const { legajo, empresa } = btn.dataset;
        try {
          await quitarAsignacion(ev.id, legajo, empresa);
          asignaciones = asignaciones.filter(a => !(a.evaluador_id === ev.id && String(a.legajo) === legajo && a.empresa === empresa));
          renderLista();
        } catch (err) {
          alert('No se pudo quitar: ' + err.message);
        }
      });
    });
  }
}
