// Login del portal de evaluadores — separado del login del Tablero de RRHH (components/login.js
// / tabla perfiles_rrhh). Acceso simple a propósito: se elige el nombre de una lista y se
// confirma con el número de documento (DNI), sin PIN que el evaluador tenga que inventar.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';
import { hashear } from '../data/evaluadores.js';
import { guardarSesionEvaluador } from './evaluador-sesion.js';

const HDR = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };

function e(s) { return (s ?? '').toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function iniciales(nombre) {
  return nombre.trim().split(/\s+/).slice(0, 2).map(p => (p[0] ?? '').toUpperCase()).join('');
}

export function mostrarLoginEvaluador(contenedor) {
  return new Promise(async (resolve) => {
    contenedor.innerHTML = '<p class="ev-cargando">Cargando…</p>';

    let evaluadores = [];
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/iso_evaluadores?activo=eq.true&select=id,nombre,documento_hash&order=nombre.asc`, { headers: HDR });
      evaluadores = r.ok ? await r.json() : [];
    } catch {
      evaluadores = [];
    }

    if (!evaluadores.length) {
      contenedor.innerHTML = `
        <div class="ev-card">
          <h1 class="ev-marca">Evaluaciones de desempeño</h1>
          <p class="ev-vacio">Todavía no hay evaluadores dados de alta. Pedile a RRHH que te agregue desde el Tablero.</p>
        </div>`;
      return;
    }

    renderSeleccion();

    function renderSeleccion() {
      contenedor.innerHTML = `
        <div class="ev-card">
          <h1 class="ev-marca">Evaluaciones de desempeño</h1>
          <p class="ev-sub">¿Quién sos?</p>
          <div class="ev-perfiles">
            ${evaluadores.map(ev => `
              <button type="button" class="ev-perfil" data-id="${ev.id}">
                <span class="ev-avatar">${iniciales(ev.nombre)}</span>
                <span class="ev-perfil-nombre">${e(ev.nombre)}</span>
              </button>`).join('')}
          </div>
        </div>`;

      contenedor.querySelectorAll('.ev-perfil').forEach(btn => {
        btn.addEventListener('click', () => {
          const ev = evaluadores.find(x => x.id === btn.dataset.id);
          renderDocumento(ev);
        });
      });
    }

    function renderDocumento(ev) {
      contenedor.innerHTML = `
        <div class="ev-card ev-card--chica">
          <span class="ev-avatar ev-avatar--lg">${iniciales(ev.nombre)}</span>
          <h2 class="ev-nombre-grande">${e(ev.nombre)}</h2>
          <p class="ev-sub">Ingresá tu número de documento para confirmar</p>
          <input class="ev-input" id="ev-doc" type="text" inputmode="numeric" placeholder="Número de documento" autocomplete="off">
          <p class="ev-error" id="ev-error" hidden>Documento incorrecto. Probá de nuevo.</p>
          <div class="ev-footer">
            <button type="button" class="ev-btn-sec" id="ev-volver">Volver</button>
            <button type="button" class="ev-btn-pri" id="ev-entrar">Ingresar</button>
          </div>
        </div>`;

      const input = contenedor.querySelector('#ev-doc');
      const error = contenedor.querySelector('#ev-error');
      setTimeout(() => input.focus(), 30);

      contenedor.querySelector('#ev-volver').addEventListener('click', renderSeleccion);

      async function intentar() {
        const doc = input.value.trim();
        if (!doc) { input.focus(); return; }
        const btn = contenedor.querySelector('#ev-entrar');
        btn.disabled = true; btn.textContent = 'Verificando…';
        const hash = await hashear(doc);
        if (hash === ev.documento_hash) {
          const evaluador = { id: ev.id, nombre: ev.nombre };
          guardarSesionEvaluador(evaluador);
          resolve(evaluador);
        } else {
          error.hidden = false;
          input.value = '';
          input.focus();
          btn.disabled = false; btn.textContent = 'Ingresar';
        }
      }

      input.addEventListener('keydown', ev2 => { if (ev2.key === 'Enter') intentar(); });
      contenedor.querySelector('#ev-entrar').addEventListener('click', intentar);
    }
  });
}
