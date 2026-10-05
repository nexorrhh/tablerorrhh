// Puestos que NO se evalúan en Desempeño (F-84) aunque estén clasificados mensual/quincenal para
// Horas y Presentismo (ej. Gerencia) — la exclusión es solo para el ciclo de evaluación, no toca
// la clasificación general de Plantel → Parametrización ni nada de presentismo.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './fuentes.js';
import { normPuesto } from './clasificacion-puestos.js';

const HDR = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
const HDR_JSON = { ...HDR, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' };

// Devuelve un Set de puestos normalizados (ver normPuesto) — comparar con normPuesto(desc_puesto)
// de la persona, nunca con el texto tal cual, por lo mismo que ya pasa con la clasificación:
// Tango puede reescribir la capitalización del puesto entre sincronizaciones.
export async function obtenerPuestosExcluidosDesempeno() {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/iso_desempeno_puestos_excluidos?select=desc_puesto`, { headers: HDR });
    const filas = r.ok ? await r.json() : [];
    return new Set(filas.map(f => normPuesto(f.desc_puesto)));
  } catch {
    return new Set();
  }
}

export async function excluirPuestoDesempeno(descPuesto) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/iso_desempeno_puestos_excluidos?on_conflict=desc_puesto`, {
    method: 'POST',
    headers: HDR_JSON,
    body: JSON.stringify({ desc_puesto: descPuesto }),
  });
  if (!r.ok) throw new Error(`Supabase: error ${r.status}`);
}

export async function incluirPuestoDesempeno(descPuesto) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/iso_desempeno_puestos_excluidos?desc_puesto=eq.${encodeURIComponent(descPuesto)}`, {
    method: 'DELETE', headers: HDR,
  });
  if (!r.ok) throw new Error(`Supabase: error ${r.status}`);
}
