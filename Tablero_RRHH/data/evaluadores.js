// Portal externo de evaluadores — capa de datos.
// `iso_evaluadores` (nombre + DNI hasheado, login propio del portal en Evaluadores/index.html,
// separado de perfiles_rrhh) y `iso_evaluadores_puestos` (qué PUESTOS le corresponde evaluar a
// cada evaluador — RRHH arma esto acá, manualmente, por puesto y no por persona: así alguien que
// entra o sale de un puesto ya asignado no necesita re-tocar nada acá).

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './fuentes.js';
import { normPuesto } from './clasificacion-puestos.js';

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

// Todas las asignaciones de puesto de todos los evaluadores — usado por la pantalla de RRHH para
// armar el "diagrama" completo de quién evalúa qué puesto y quién queda sin cubrir.
export async function obtenerAsignacionesPuestos() {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/iso_evaluadores_puestos?select=*`, { headers: HDR });
  if (!r.ok) throw new Error(`Supabase: error ${r.status}`);
  return r.json();
}

export async function agregarPuestoAsignado(evaluadorId, descPuesto) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/iso_evaluadores_puestos?on_conflict=evaluador_id,desc_puesto`, {
    method: 'POST', headers: { ...HDR_JSON, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ evaluador_id: evaluadorId, desc_puesto: descPuesto }),
  });
  if (!r.ok) throw new Error(`Supabase: error ${r.status}`);
}

export async function quitarPuestoAsignado(evaluadorId, descPuesto) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/iso_evaluadores_puestos?evaluador_id=eq.${evaluadorId}&desc_puesto=eq.${encodeURIComponent(descPuesto)}`,
    { method: 'DELETE', headers: HDR },
  );
  if (!r.ok) throw new Error(`Supabase: error ${r.status}`);
}

// Resuelve los puestos asignados a UN evaluador a la lista de personas activas que hoy están en
// esos puestos — usado por el portal (Evaluadores/evaluador-panel.js), que solo necesita saber
// qué legajos le tocan, no de qué puesto vienen. Devuelve el mismo {legajo, empresa}[] de antes
// (cuando la asignación era por persona), así el portal no necesitó cambiar nada.
export async function obtenerAsignacionesDe(evaluadorId) {
  const [rPuestos, rEmp] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/iso_evaluadores_puestos?evaluador_id=eq.${evaluadorId}&select=desc_puesto`, { headers: HDR }),
    fetch(`${SUPABASE_URL}/rest/v1/empleados?select=legajo,empresa,desc_puesto&activo=eq.true&limit=2000`, { headers: HDR }),
  ]);
  if (!rPuestos.ok) throw new Error(`Supabase: error ${rPuestos.status}`);
  const puestos = await rPuestos.json();
  const puestosSet = new Set(puestos.map(p => normPuesto(p.desc_puesto)));
  const empleados = rEmp.ok ? await rEmp.json() : [];
  return empleados
    .filter(e => puestosSet.has(normPuesto(e.desc_puesto)))
    .map(e => ({ legajo: e.legajo, empresa: e.empresa }));
}
