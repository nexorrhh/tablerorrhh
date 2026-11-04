// Portal externo de evaluadores — capa de datos.
// `iso_evaluadores` (nombre + DNI hasheado, login propio del portal en Evaluadores/index.html,
// separado de perfiles_rrhh) y `iso_evaluadores_puestos` (qué PUESTOS le corresponde evaluar a
// cada evaluador — RRHH arma esto acá, manualmente, por puesto y no por persona: así alguien que
// entra o sale de un puesto ya asignado no necesita re-tocar nada acá).

import { sbGet, sbTraerTodo, sbTraerTodoCache, sbPost, sbPatch, sbDelete, sbUpsert } from './supabase-rest.js';
import { normPuesto } from './clasificacion-puestos.js';

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
  return sbGet('iso_evaluadores?select=*&order=nombre.asc');
}

export async function crearEvaluador({ nombre, legajo, empresa, documento }) {
  const documento_hash = await hashear(documento.trim());
  const filas = await sbPost('iso_evaluadores',
    { nombre: nombre.trim(), legajo: +legajo, empresa, documento_hash }, 'return=representation');
  return filas[0];
}

export async function cambiarActivoEvaluador(id, activo) {
  await sbPatch(`iso_evaluadores?id=eq.${id}`, { activo });
}

// Email al que Nexo RRHH le manda los permisos nuevos de la gente de sus puestos (ver
// sql/permisos_responsables.sql). Vacío = no recibe permisos (van a los autorizadores generales).
export async function guardarEmailEvaluador(id, email) {
  try {
    await sbPatch(`iso_evaluadores?id=eq.${id}`, { email: email.trim().toLowerCase() || null });
  } catch (e) {
    // supabase-rest arma el mensaje como "Supabase <status> en ..."; un 400 acá es la columna faltante.
    if (/^Supabase 400 /.test(e.message)) throw new Error('falta la columna "email" — ejecutá sql/permisos_responsables.sql en Supabase');
    throw e;
  }
}

export async function borrarEvaluador(id) {
  await sbDelete(`iso_evaluadores?id=eq.${id}`);
}

// Todas las asignaciones de puesto de todos los evaluadores — usado por la pantalla de RRHH para
// armar el "diagrama" completo de quién evalúa qué puesto y quién queda sin cubrir.
export async function obtenerAsignacionesPuestos() {
  return sbTraerTodo('iso_evaluadores_puestos?select=*&order=evaluador_id.asc,desc_puesto.asc');
}

export async function agregarPuestoAsignado(evaluadorId, descPuesto) {
  await sbUpsert('iso_evaluadores_puestos?on_conflict=evaluador_id,desc_puesto', { evaluador_id: evaluadorId, desc_puesto: descPuesto });
}

export async function quitarPuestoAsignado(evaluadorId, descPuesto) {
  await sbDelete(`iso_evaluadores_puestos?evaluador_id=eq.${evaluadorId}&desc_puesto=eq.${encodeURIComponent(descPuesto)}`);
}

// Resuelve los puestos asignados a UN evaluador a la lista de personas activas que hoy están en
// esos puestos — usado por el portal (Evaluadores/evaluador-panel.js), que solo necesita saber
// qué legajos le tocan, no de qué puesto vienen. Devuelve el mismo {legajo, empresa}[] de antes
// (cuando la asignación era por persona), así el portal no necesitó cambiar nada.
export async function obtenerAsignacionesDe(evaluadorId) {
  // Si falla empleados se lanza error: antes quedaba [] y el portal mostraba "nadie para evaluar".
  const [puestos, empleados] = await Promise.all([
    sbGet(`iso_evaluadores_puestos?evaluador_id=eq.${evaluadorId}&select=desc_puesto`),
    sbTraerTodoCache('empleados?select=legajo,empresa,desc_puesto&activo=eq.true&order=id.asc'),
  ]);
  const puestosSet = new Set(puestos.map(p => normPuesto(p.desc_puesto)));
  return empleados
    .filter(e => puestosSet.has(normPuesto(e.desc_puesto)))
    .map(e => ({ legajo: e.legajo, empresa: e.empresa }));
}
