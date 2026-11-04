// Fuerza a alguien a la evaluación de período de prueba (F-101) aunque ya tenga antigüedad y no
// esté en la ventana de ingreso — para el caso de "cambio de función" (PG-6.01), que hoy no se
// puede detectar solo porque el sistema no guarda historial de puesto (ver comentario al
// principio de components/desempeno-prueba.js). Es el espejo de data/reingresos-manuales.js, que
// fuerza para el otro lado: a alguien reingresado, FUERA de período de prueba.

import { sbGet, sbUpsert, sbDelete } from './supabase-rest.js';

// Lanza error si falla: devolver [] en silencio haría que los forzados por cambio de función
// desaparezcan del período de prueba sin que nadie se entere.
export async function obtenerPruebaForzadaManual() {
  return sbGet('iso_prueba_forzada_manual?select=*');
}

// Map de "legajo|empresa" -> { motivo, fecha_referencia } — formato listo para pasarle a
// enPeriodoPrueba() (que solo necesita el .has() de la membresía) y a personaConFechaEfectiva()
// (que además lee fecha_referencia). `fecha_referencia`: desde cuándo está en el puesto nuevo —
// cuando está cargada, los cálculos de la evaluación (días transcurridos, presentismo/puntualidad
// automáticos) usan esta fecha en vez de la fecha de ingreso real a la empresa, que para estos
// casos no sirve de referencia. Si queda sin cargar, se sigue usando fecha_ingreso como antes.
export async function obtenerPruebaForzadaMap() {
  const filas = await obtenerPruebaForzadaManual();
  return new Map(filas.map(f => [`${f.legajo}|${f.empresa}`, { motivo: f.motivo, fecha_referencia: f.fecha_referencia }]));
}

export async function marcarPruebaForzada(legajo, empresa, motivo, fechaReferencia) {
  await sbUpsert('iso_prueba_forzada_manual?on_conflict=legajo,empresa',
    { legajo: +legajo, empresa, motivo: motivo || null, fecha_referencia: fechaReferencia || null });
}

export async function quitarPruebaForzada(legajo, empresa) {
  await sbDelete(`iso_prueba_forzada_manual?legajo=eq.${legajo}&empresa=eq.${empresa}`);
}
