// Helpers compartidos por los componentes de Vencimientos (Facturas, Impuestos, y los que se
// agreguen a futuro). Contratos/Licencias/Institucional NO usan este archivo — quedan con su
// propia copia de estos mismos helpers para no tocar código que ya funciona.

import { sbGet, sbTraerTodo, sbPost, sbPatch, sbDelete } from '../data/supabase-rest.js';

// ── CRUD Supabase parametrizado por tabla ────────────────────────────────────
// Envoltorio fino sobre data/supabase-rest.js: todas lanzan error si la respuesta no es OK.
export function crearHelpersSupabase(tabla) {
  return {
    // Una sola página: usar solo con filtros que devuelvan pocas filas.
    sbGet(q = '') {
      return sbGet(`${tabla}?${q}`);
    },
    // Todas las filas (pagina de a 1000). `q` debería incluir un order= por columna única.
    sbTraerTodo(q = '') {
      return sbTraerTodo(`${tabla}?${q}`);
    },
    async sbInsert(body) {
      await sbPost(tabla, body);
    },
    // Igual que sbInsert, pero devuelve la fila creada (útil cuando hace falta el id nuevo).
    async sbInsertRet(body) {
      const filas = await sbPost(tabla, body, 'return=representation');
      return filas[0];
    },
    async sbUpdate(id, body) {
      await sbPatch(`${tabla}?id=eq.${id}`, body);
    },
    async sbDelete(id) {
      await sbDelete(`${tabla}?id=eq.${id}`);
    },
  };
}

// ── Toast (una instancia con temporizador propio por contenedor) ────────────
export function crearToast(contenedor) {
  let toastTimer = null;
  return function toast(msg, tipo = '') {
    let t = contenedor.querySelector('.venc__toast');
    if (!t) { t = document.createElement('div'); t.className = 'venc__toast'; contenedor.appendChild(t); }
    t.textContent = msg;
    t.className = `venc__toast venc__toast--show${tipo ? ' venc__toast--' + tipo : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'venc__toast'; }, 3200);
  };
}

// ── Días hasta la fecha (negativo = vencido) ────────────────────────────────
export function dias(fecha) {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  return Math.round((new Date(fecha + 'T00:00:00') - hoy) / 86400000);
}

// ── Badge de urgencia según días restantes ──────────────────────────────────
export function badge(d, { proximo = 30, medio = 90 } = {}) {
  if (d < 0)      return { cls: 'venc__badge--rojo',     txt: 'Vencido' };
  if (d <= proximo) return { cls: 'venc__badge--naranja',  txt: `Vence en ${d}d` };
  if (d <= medio)   return { cls: 'venc__badge--amarillo', txt: `En ${d}d` };
  return                   { cls: 'venc__badge--verde',    txt: 'Vigente' };
}

// ── Fecha dentro del mes calendario actual ──────────────────────────────────
export function esMesActual(fecha) {
  const hoy = new Date();
  const f = new Date(fecha + 'T00:00:00');
  return f.getFullYear() === hoy.getFullYear() && f.getMonth() === hoy.getMonth();
}

export function fmtFecha(f) {
  return new Date(f + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function e(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

export function v(id) { return document.getElementById(id)?.value.trim() ?? ''; }

export function errHtml(msg) {
  return `<div class="estado-vacio"><div class="estado-vacio__icono"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div><h3 class="estado-vacio__titulo">Error al cargar</h3><p class="estado-vacio__texto">${msg}</p></div>`;
}

// ── Estado de autorización de un comprobante ARCA (Autorizar / Seguimiento mensual) ──
export const ESTADOS_AUTORIZACION = {
  pendiente:    { label: 'Pendiente',    cls: 'venc__badge--gris' },
  autorizado:   { label: 'Autorizado',   cls: 'venc__badge--verde' },
  en_revision:  { label: 'En revisión',  cls: 'venc__badge--amarillo' },
  rechazado:    { label: 'Rechazado',    cls: 'venc__badge--rojo' },
};

export function estadoAutorizacionInfo(estado) {
  return ESTADOS_AUTORIZACION[estado] ?? ESTADOS_AUTORIZACION.pendiente;
}
