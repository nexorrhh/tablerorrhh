// Puestos que NO se evalúan en Desempeño (F-84) aunque estén clasificados mensual/quincenal para
// Horas y Presentismo (ej. Gerencia) — la exclusión es solo para el ciclo de evaluación, no toca
// la clasificación general de Plantel → Parametrización ni nada de presentismo.
import { sbGet, sbUpsert, sbDelete } from './supabase-rest.js';
import { normPuesto } from './clasificacion-puestos.js';

// Devuelve un Set de puestos normalizados (ver normPuesto) — comparar con normPuesto(desc_puesto)
// de la persona, nunca con el texto tal cual, por lo mismo que ya pasa con la clasificación:
// Tango puede reescribir la capitalización del puesto entre sincronizaciones.
export async function obtenerPuestosExcluidosDesempeno() {
  try {
    const filas = await sbGet('iso_desempeno_puestos_excluidos?select=desc_puesto');
    return new Set(filas.map(f => normPuesto(f.desc_puesto)));
  } catch (e) {
    // Fallback intencional: si la tabla falla no se excluye a nadie (se evalúa de más, no de menos).
    console.warn('obtenerPuestosExcluidosDesempeno: sin exclusiones', e);
    return new Set();
  }
}

export async function excluirPuestoDesempeno(descPuesto) {
  await sbUpsert('iso_desempeno_puestos_excluidos?on_conflict=desc_puesto', { desc_puesto: descPuesto });
}

export async function incluirPuestoDesempeno(descPuesto) {
  await sbDelete(`iso_desempeno_puestos_excluidos?desc_puesto=eq.${encodeURIComponent(descPuesto)}`);
}
