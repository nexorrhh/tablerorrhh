// Fuerza a alguien a la evaluación de período de prueba (F-101) aunque ya tenga antigüedad y no
// esté en la ventana de ingreso — para el caso de "cambio de función" (PG-6.01), que hoy no se
// puede detectar solo porque el sistema no guarda historial de puesto (ver comentario al
// principio de components/desempeno-prueba.js). Es el espejo de data/reingresos-manuales.js, que
// fuerza para el otro lado: a alguien reingresado, FUERA de período de prueba.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './fuentes.js';

const HDR = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
const HDR_JSON = { ...HDR, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' };

export async function obtenerPruebaForzadaManual() {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/iso_prueba_forzada_manual?select=*`, { headers: HDR });
  return r.ok ? r.json() : [];
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
  const r = await fetch(`${SUPABASE_URL}/rest/v1/iso_prueba_forzada_manual?on_conflict=legajo,empresa`, {
    method: 'POST', headers: HDR_JSON,
    body: JSON.stringify({ legajo: +legajo, empresa, motivo: motivo || null, fecha_referencia: fechaReferencia || null }),
  });
  if (!r.ok) throw new Error(`Supabase: error ${r.status}`);
}

export async function quitarPruebaForzada(legajo, empresa) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/iso_prueba_forzada_manual?legajo=eq.${legajo}&empresa=eq.${empresa}`, {
    method: 'DELETE', headers: HDR,
  });
  if (!r.ok) throw new Error(`Supabase: error ${r.status}`);
}
