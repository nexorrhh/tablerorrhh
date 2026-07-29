import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';
import { guardarSesion } from '../data/usuario-activo.js';

const TABLA = 'perfiles_rrhh';
const HDR = {
  'Content-Type': 'application/json',
  apikey:         SUPABASE_ANON_KEY,
  Authorization:  `Bearer ${SUPABASE_ANON_KEY}`,
};

async function sbGet(q) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${TABLA}?${q}`, { headers: HDR });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function sbPatch(id, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${TABLA}?id=eq.${id}`, {
    method:  'PATCH',
    headers: { ...HDR, Prefer: 'return=minimal' },
    body:    JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
}

async function hashear(texto) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function iniciales(nombre) {
  return nombre.trim().split(/\s+/).slice(0, 2).map(p => (p[0] ?? '').toUpperCase()).join('');
}

function e(s) { return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// Traduce las columnas de permisos del perfil (Supabase) a una lista de claves de permiso
// que el resto de la app puede chequear (ver config/navegacion.js, campo `permiso`).
function permisosDe(perfil) {
  const permisos = [];
  if (perfil?.puede_autorizar_facturas) permisos.push('autorizarFacturas');
  return permisos;
}

// Filtra el input para que solo acepte dígitos y máximo 4 caracteres
function bindPinInput(input) {
  input.addEventListener('input', () => {
    input.value = input.value.replace(/\D/g, '').slice(0, 4);
  });
  input.addEventListener('keydown', ev => {
    // Permite: backspace, delete, tab, flechas, números del teclado principal y numpad
    const permitidos = ['Backspace','Delete','Tab','ArrowLeft','ArrowRight'];
    const esNumero   = (ev.key >= '0' && ev.key <= '9') || (ev.key >= 'Numpad0' && ev.key <= 'Numpad9');
    if (!permitidos.includes(ev.key) && !esNumero) ev.preventDefault();
  });
}

// ── Pantalla principal de selección de perfil ────────────────────────────────

function renderSeleccion(overlay, perfiles, onResolve) {
  overlay.innerHTML = `
    <div class="login__card">
      <div class="login__brand">
        <div class="login__brand-logo">Cimo<span class="login__brand-acento">met</span></div>
        <p class="login__brand-sub">TABLERO DE CONTROL · RRHH</p>
      </div>
      <h2 class="login__titulo">¿Quién está usando este portal?</h2>
      <div class="login__perfiles">
        ${perfiles.map(p => `
          <button class="login__perfil" data-id="${p.id}"
                  data-nombre="${e(p.nombre)}" data-tiene-pin="${!!p.password_hash}" type="button">
            <span class="login__avatar">${iniciales(p.nombre)}</span>
            <span class="login__perfil-nombre">${e(p.nombre)}</span>
            ${!p.password_hash ? '<span class="login__primer-ingreso">Crear PIN</span>' : ''}
          </button>
        `).join('')}
      </div>
    </div>`;

  overlay.querySelectorAll('.login__perfil[data-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const { id, nombre } = btn.dataset;
      const tienePin = btn.dataset.tienePin === 'true';
      if (tienePin) {
        renderIngresarPin(overlay, perfiles, id, nombre, onResolve);
      } else {
        renderCrearPin(overlay, perfiles, id, nombre, onResolve);
      }
    });
  });
}

// ── Pantalla: ingresar PIN (perfiles con PIN ya configurado) ─────────────────

function renderIngresarPin(overlay, perfiles, id, nombre, onResolve) {
  overlay.innerHTML = `
    <div class="login__card login__card--chica">
      <div class="login__avatar login__avatar--lg">${iniciales(nombre)}</div>
      <h2 class="login__nombre-grande">${e(nombre)}</h2>
      <p class="login__subtitulo">Ingresá tu PIN de 4 dígitos</p>
      <input class="login__input login__input--pin" id="login-pin"
             type="tel" inputmode="numeric" maxlength="4"
             placeholder="· · · ·" autocomplete="one-time-code">
      <p class="login__error" id="login-error" hidden>PIN incorrecto.</p>
      <div class="login__footer">
        <button class="login__btn-sec" id="login-volver" type="button">Volver</button>
        <button class="login__btn-pri" id="login-ingresar" type="button">Ingresar</button>
      </div>
    </div>`;

  const input = overlay.querySelector('#login-pin');
  const error = overlay.querySelector('#login-error');
  bindPinInput(input);
  setTimeout(() => input.focus(), 40);

  overlay.querySelector('#login-volver').addEventListener('click', () => {
    renderSeleccion(overlay, perfiles, onResolve);
  });

  async function intentarLogin() {
    const pin = input.value;
    if (pin.length !== 4) { input.focus(); return; }
    const btn = overlay.querySelector('#login-ingresar');
    btn.disabled = true; btn.textContent = 'Verificando…';
    const hash   = await hashear(pin);
    const perfil = perfiles.find(p => p.id === id);
    if (perfil && perfil.password_hash === hash) {
      const usuario = { id, nombre, permisos: permisosDe(perfil) };
      guardarSesion(usuario);
      overlay.remove();
      onResolve(usuario);
    } else {
      error.hidden = false;
      input.value = '';
      input.focus();
      btn.disabled = false; btn.textContent = 'Ingresar';
    }
  }

  // Auto-ingresar al completar 4 dígitos
  input.addEventListener('input', () => { if (input.value.length === 4) intentarLogin(); });
  overlay.querySelector('#login-ingresar').addEventListener('click', intentarLogin);
}

// ── Pantalla: crear PIN (primer ingreso) ─────────────────────────────────────

function renderCrearPin(overlay, perfiles, id, nombre, onResolve) {
  overlay.innerHTML = `
    <div class="login__card login__card--chica">
      <div class="login__avatar login__avatar--lg">${iniciales(nombre)}</div>
      <h2 class="login__nombre-grande">${e(nombre)}</h2>
      <p class="login__subtitulo">Creá tu PIN de 4 dígitos</p>
      <label class="login__label-pin" for="login-pin1">Elegí un número de 4 dígitos</label>
      <input class="login__input login__input--pin" id="login-pin1"
             type="tel" inputmode="numeric" maxlength="4"
             placeholder="· · · ·" autocomplete="new-password">
      <label class="login__label-pin" for="login-pin2">Confirmá el número</label>
      <input class="login__input login__input--pin" id="login-pin2"
             type="tel" inputmode="numeric" maxlength="4"
             placeholder="· · · ·" autocomplete="new-password">
      <p class="login__error" id="login-error" hidden></p>
      <div class="login__footer">
        <button class="login__btn-sec" id="login-volver" type="button">Volver</button>
        <button class="login__btn-pri" id="login-crear" type="button">Confirmar PIN</button>
      </div>
    </div>`;

  const input1 = overlay.querySelector('#login-pin1');
  const input2 = overlay.querySelector('#login-pin2');
  const error  = overlay.querySelector('#login-error');
  bindPinInput(input1);
  bindPinInput(input2);
  setTimeout(() => input1.focus(), 40);

  // Al completar el primer campo, pasar al segundo automáticamente
  input1.addEventListener('input', () => { if (input1.value.length === 4) input2.focus(); });

  overlay.querySelector('#login-volver').addEventListener('click', () => {
    renderSeleccion(overlay, perfiles, onResolve);
  });

  async function confirmarPin() {
    const p1 = input1.value, p2 = input2.value;
    if (p1.length !== 4) { error.hidden = true; input1.focus(); return; }
    if (p2.length !== 4) { error.hidden = true; input2.focus(); return; }
    if (p1 !== p2) {
      error.textContent = 'Los números no coinciden. Intentá de nuevo.';
      error.hidden = false;
      input2.value = ''; input2.focus();
      return;
    }
    const btn = overlay.querySelector('#login-crear');
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      const hash = await hashear(p1);
      await sbPatch(id, { password_hash: hash });
      const perfil = perfiles.find(p => p.id === id);
      if (perfil) perfil.password_hash = hash;
      const usuario = { id, nombre, permisos: permisosDe(perfil) };
      guardarSesion(usuario);
      overlay.remove();
      onResolve(usuario);
    } catch (err) {
      alert('Error al guardar el PIN: ' + err.message);
      btn.disabled = false; btn.textContent = 'Confirmar PIN';
    }
  }

  // Auto-confirmar al completar la confirmación
  input2.addEventListener('input', () => { if (input2.value.length === 4) confirmarPin(); });
  overlay.querySelector('#login-crear').addEventListener('click', confirmarPin);
}

// ── Punto de entrada: muestra el login y devuelve una Promise ────────────────

export function mostrarLogin() {
  return new Promise(async (resolve) => {
    const overlay = document.createElement('div');
    overlay.id = 'login-overlay';
    overlay.className = 'login__overlay';
    document.body.appendChild(overlay);

    let perfiles = [];
    try {
      perfiles = await sbGet('order=created_at.asc');
    } catch (_) {
      perfiles = [];
    }

    renderSeleccion(overlay, perfiles, resolve);
  });
}
