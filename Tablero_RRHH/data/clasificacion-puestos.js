import { SUPABASE_URL, SUPABASE_ANON_KEY } from './fuentes.js';

// Fuente única de verdad para saber si un puesto liquida mensual o quincenal.
// La clasificación vive en la tabla rrhh_puestos_config (desc_puesto → tipo).
// Un puesto SIN fila en esa tabla está "sin_asignar" por defecto: no hace falta
// guardar una fila con tipo='sin_asignar', su ausencia ya representa ese estado.

const HDR = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
const HDR_JSON = { ...HDR, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' };

// Clave normalizada para comparar puestos sin distinguir mayúsculas/minúsculas ni espacios —
// el actualizador de Tango a veces reescribe el mismo puesto con otra capitalización (ej.
// "RRHH" pasa a "Rrhh"), y sin esto la clasificación de ese puesto se perdía silenciosamente
// en cada sincronización.
export function normPuesto(s) {
  return (s || '').trim().toUpperCase();
}

export async function obtenerClasificacionPuestos() {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rrhh_puestos_config?select=desc_puesto,tipo`, { headers: HDR });
  const rows = r.ok ? await r.json() : [];
  return new Map(rows.map(f => [normPuesto(f.desc_puesto), f.tipo]));
}

// mapa: el Map devuelto por obtenerClasificacionPuestos().
export function tipoPuesto(descPuesto, mapa) {
  return mapa.get(normPuesto(descPuesto)) || 'sin_asignar';
}

export async function guardarClasificacionPuesto(descPuesto, tipo) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rrhh_puestos_config?on_conflict=desc_puesto`, {
    method: 'POST',
    headers: HDR_JSON,
    body: JSON.stringify({ desc_puesto: descPuesto, tipo }),
  });
  if (!r.ok) throw new Error(`Supabase: error ${r.status} al clasificar puesto "${descPuesto}"`);
}

export async function borrarClasificacionPuesto(descPuesto) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rrhh_puestos_config?desc_puesto=eq.${encodeURIComponent(descPuesto)}`, {
    method: 'DELETE',
    headers: HDR,
  });
  if (!r.ok) throw new Error(`Supabase: error ${r.status} al desclasificar puesto "${descPuesto}"`);
}
