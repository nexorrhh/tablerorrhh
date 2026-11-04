// Reingresos marcados a mano por RRHH — complementan a esReingreso() (components/desempeno-cargar.js)
// para los casos que la detección automática no puede ver: alguien que renunció y volvió a
// entrar ANTES de que este sistema empezara a registrar gente (creado_en más viejo que eso no
// existe, no hay nada contra qué comparar). Mismo criterio que rrhh_fichadas_exentos.

import { sbTraerTodo, sbUpsert, sbDelete } from './supabase-rest.js';

export async function obtenerReingresosManuales() {
  // Fallback intencional: es un complemento de la detección automática de reingresos; si no
  // se puede leer, las pantallas de Desempeño siguen funcionando solo con la automática.
  try {
    return await sbTraerTodo('iso_periodo_prueba_manual?select=*&order=legajo.asc,empresa.asc');
  } catch (e) {
    console.warn('No se pudieron leer los reingresos manuales (iso_periodo_prueba_manual)', e);
    return [];
  }
}

// Set de "legajo|empresa" — formato listo para pasarle a esReingreso()/corresponde().
export async function obtenerReingresosManualesSet() {
  const filas = await obtenerReingresosManuales();
  return new Set(filas.map(f => `${f.legajo}|${f.empresa}`));
}

export async function marcarReingresoManual(legajo, empresa, motivo) {
  await sbUpsert('iso_periodo_prueba_manual?on_conflict=legajo,empresa', { legajo: +legajo, empresa, motivo: motivo || null });
}

export async function quitarReingresoManual(legajo, empresa) {
  await sbDelete(`iso_periodo_prueba_manual?legajo=eq.${legajo}&empresa=eq.${empresa}`);
}
