import { sbTraerTodoCache, sbUpsert, sbDelete } from './supabase-rest.js';

// Fuente única de verdad para saber si un puesto liquida mensual o quincenal.
// La clasificación vive en la tabla rrhh_puestos_config (desc_puesto → tipo).
// Un puesto SIN fila en esa tabla está "sin_asignar" por defecto: no hace falta
// guardar una fila con tipo='sin_asignar', su ausencia ya representa ese estado.

// Clave normalizada para comparar puestos sin distinguir mayúsculas/minúsculas ni espacios —
// el actualizador de Tango a veces reescribe el mismo puesto con otra capitalización (ej.
// "RRHH" pasa a "Rrhh"), y sin esto la clasificación de ese puesto se perdía silenciosamente
// en cada sincronización.
export function normPuesto(s) {
  return (s || '').trim().toUpperCase();
}

export async function obtenerClasificacionPuestos() {
  // Fallback intencional: la usan muchas pantallas como dato secundario; si falla, todos los
  // puestos quedan "sin_asignar" (como siempre) en vez de romperlas.
  let rows = [];
  try {
    rows = await sbTraerTodoCache('rrhh_puestos_config?select=desc_puesto,tipo&order=desc_puesto.asc');
  } catch (e) {
    console.warn('No se pudo leer la clasificación de puestos (rrhh_puestos_config)', e);
  }
  return new Map(rows.map(f => [normPuesto(f.desc_puesto), f.tipo]));
}

// mapa: el Map devuelto por obtenerClasificacionPuestos().
export function tipoPuesto(descPuesto, mapa) {
  return mapa.get(normPuesto(descPuesto)) || 'sin_asignar';
}

export async function guardarClasificacionPuesto(descPuesto, tipo) {
  try {
    await sbUpsert('rrhh_puestos_config?on_conflict=desc_puesto', { desc_puesto: descPuesto, tipo });
  } catch (e) {
    throw new Error(`${e.message} — al clasificar puesto "${descPuesto}"`, { cause: e });
  }
}

export async function borrarClasificacionPuesto(descPuesto) {
  try {
    await sbDelete(`rrhh_puestos_config?desc_puesto=eq.${encodeURIComponent(descPuesto)}`);
  } catch (e) {
    throw new Error(`${e.message} — al desclasificar puesto "${descPuesto}"`, { cause: e });
  }
}
