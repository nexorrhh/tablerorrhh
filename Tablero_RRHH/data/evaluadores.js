// Portal externo de evaluadores — capa de datos.
// `iso_evaluadores` (nombre + DNI hasheado, login propio del portal en Evaluadores/index.html,
// separado de perfiles_rrhh) y `iso_evaluadores_asignados` (qué legajos le corresponde evaluar
// a cada evaluador — asignación 100% manual, la arma RRHH acá).

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './fuentes.js';

const HDR = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
const HDR_JSON = { ...HDR, 'Content-Type': 'application/json' };

// Mismo esquema que password_hash en perfiles_rrhh (components/login.js): SHA-256 client-side,
// nunca se manda el DNI en texto plano.
export async function hashear(texto) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// El CUIL de Tango viene como XX-DNIIIIIIII-X (2 dígitos de prefijo + DNI + 1 dígito verificador).
// Para un empleado (prefijo 20/23/24/27) esos 8 dígitos del medio son el DNI — se usan para no
// tener que tipearlo a mano al dar de alta un evaluador. Devuelve null si el CUIL no viene con
// ese formato (por si algún registro lo tiene incompleto).
export function dniDesdeCuil(cuil) {
  const digitos = (cuil || '').replace(/\D/g, '');
  return digitos.length === 11 ? digitos.slice(2, -1) : null;
}

export async function obtenerEvaluadores() {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/iso_evaluadores?select=*&order=nombre.asc`, { headers: HDR });
  if (!r.ok) throw new Error(`Supabase: error ${r.status}`);
  return r.json();
}

export async function crearEvaluador({ nombre, legajo, empresa, documento }) {
  const documento_hash = await hashear(documento.trim());
  const r = await fetch(`${SUPABASE_URL}/rest/v1/iso_evaluadores`, {
    method: 'POST', headers: { ...HDR_JSON, Prefer: 'return=representation' },
    body: JSON.stringify({ nombre: nombre.trim(), legajo: +legajo, empresa, documento_hash }),
  });
  if (!r.ok) throw new Error(`Supabase: error ${r.status}`);
  const filas = await r.json();
  return filas[0];
}

export async function cambiarActivoEvaluador(id, activo) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/iso_evaluadores?id=eq.${id}`, {
    method: 'PATCH', headers: { ...HDR_JSON, Prefer: 'return=minimal' },
    body: JSON.stringify({ activo }),
  });
  if (!r.ok) throw new Error(`Supabase: error ${r.status}`);
}

export async function borrarEvaluador(id) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/iso_evaluadores?id=eq.${id}`, { method: 'DELETE', headers: HDR });
  if (!r.ok) throw new Error(`Supabase: error ${r.status}`);
}

export async function obtenerAsignaciones() {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/iso_evaluadores_asignados?select=*`, { headers: HDR });
  if (!r.ok) throw new Error(`Supabase: error ${r.status}`);
  return r.json();
}

// Asignaciones de un solo evaluador — usado por el portal (Evaluadores/evaluador-panel.js), que
// no necesita ver la lista completa de todos los evaluadores como sí hace la pantalla de RRHH.
export async function obtenerAsignacionesDe(evaluadorId) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/iso_evaluadores_asignados?evaluador_id=eq.${evaluadorId}&select=legajo,empresa`, { headers: HDR });
  if (!r.ok) throw new Error(`Supabase: error ${r.status}`);
  return r.json();
}

export async function agregarAsignacion(evaluadorId, legajo, empresa) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/iso_evaluadores_asignados?on_conflict=evaluador_id,legajo,empresa`, {
    method: 'POST', headers: { ...HDR_JSON, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ evaluador_id: evaluadorId, legajo: +legajo, empresa }),
  });
  if (!r.ok) throw new Error(`Supabase: error ${r.status}`);
}

export async function quitarAsignacion(evaluadorId, legajo, empresa) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/iso_evaluadores_asignados?evaluador_id=eq.${evaluadorId}&legajo=eq.${legajo}&empresa=eq.${empresa}`,
    { method: 'DELETE', headers: HDR },
  );
  if (!r.ok) throw new Error(`Supabase: error ${r.status}`);
}
