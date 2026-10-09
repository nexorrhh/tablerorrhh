// Reingresos marcados a mano por RRHH — complementan a esReingreso() (components/desempeno-cargar.js)
// para los casos que la detección automática no puede ver: alguien que renunció y volvió a
// entrar ANTES de que este sistema empezara a registrar gente (creado_en más viejo que eso no
// existe, no hay nada contra qué comparar). Mismo criterio que rrhh_fichadas_exentos.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './fuentes.js';

const HDR = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
const HDR_JSON = { ...HDR, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' };

export async function obtenerReingresosManuales() {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/iso_periodo_prueba_manual?select=*`, { headers: HDR });
  return r.ok ? r.json() : [];
}

// Set de "legajo|empresa" — formato listo para pasarle a esReingreso()/corresponde().
export async function obtenerReingresosManualesSet() {
  const filas = await obtenerReingresosManuales();
  return new Set(filas.map(f => `${f.legajo}|${f.empresa}`));
}

export async function marcarReingresoManual(legajo, empresa, motivo) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/iso_periodo_prueba_manual?on_conflict=legajo,empresa`, {
    method: 'POST', headers: HDR_JSON,
    body: JSON.stringify({ legajo: +legajo, empresa, motivo: motivo || null }),
  });
  if (!r.ok) throw new Error(`Supabase: error ${r.status}`);
}

export async function quitarReingresoManual(legajo, empresa) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/iso_periodo_prueba_manual?legajo=eq.${legajo}&empresa=eq.${empresa}`, {
    method: 'DELETE', headers: HDR,
  });
  if (!r.ok) throw new Error(`Supabase: error ${r.status}`);
}
