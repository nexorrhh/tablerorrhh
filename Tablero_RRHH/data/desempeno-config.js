// Puntaje configurable del F-84 (Evaluación de Desempeño Anual), por tipo de personal.
// Fuente única de verdad: tabla iso_desempeno_config. Estos DEFAULTS son exactamente los
// valores que estaban hardcodeados en components/desempeno-cargar.js antes de que el puntaje
// se pudiera configurar — se usan como red de seguridad si la tabla todavía no existe o la
// consulta falla, para que nada se rompa ni cambie de golpe.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './fuentes.js';
import { normPuesto } from './clasificacion-puestos.js';

const HDR = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
const HDR_JSON = { ...HDR, 'Content-Type': 'application/json' };

// Nombre genérico del aspecto "reprocesos" cuando el puesto no le puso uno propio (ver
// reprocesos_label en iso_desempeno_config / iso_desempeno_config_puesto y Personalizar por
// puesto) — "Calidad de trabajo (reprocesos)" tiene sentido en taller, pero no en puestos
// administrativos, donde conviene un nombre puntual (ej. "Calidad de registración contable").
export const REPROCESOS_LABEL_DEFAULT = 'Evaluación específica';

// Mensuales y quincenales evalúan los mismos aspectos con el mismo puntaje por default — la
// distinción ya no es por tipo de personal, sino por puesto (ver Personalizar por puesto): un
// puesto donde EPP o Reprocesos no aplican (ej. Administración) se personaliza ahí, no acá.
const CONFIG_DEFAULT_COMPARTIDO = {
  ausentismo_max: 10, ausentismo_dias_cero: 5,
  tardanzas_max: 5, tardanzas_cant_cero: 12.5,
  epp_max: 15, reprocesos_max: 10,
  evaluacion_max: 50,
};
export const CONFIG_DEFAULT = {
  mensual: { ...CONFIG_DEFAULT_COMPARTIDO },
  quincenal: { ...CONFIG_DEFAULT_COMPARTIDO },
};

// Devuelve { mensual: {...}, quincenal: {...} } — siempre las dos claves, completando con el
// default lo que falte en la base (fila no creada todavía, columna null, etc.).
export async function obtenerConfigDesempeno() {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/iso_desempeno_config?select=*`, { headers: HDR });
    const filas = r.ok ? await r.json() : [];
    const porTipo = new Map(filas.map(f => [f.tipo, f]));
    return {
      mensual: { ...CONFIG_DEFAULT.mensual, ...(porTipo.get('mensual') || {}) },
      quincenal: { ...CONFIG_DEFAULT.quincenal, ...(porTipo.get('quincenal') || {}) },
    };
  } catch {
    return CONFIG_DEFAULT;
  }
}

export async function guardarConfigDesempeno(tipo, valores) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/iso_desempeno_config?on_conflict=tipo`, {
    method: 'POST',
    headers: { ...HDR_JSON, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ tipo, ...valores, actualizado_en: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error(`Supabase: error ${r.status}`);
}

// ── Personalización por puesto (opcional, por encima del default de mensual/quincenal) ──────
// Un puesto sin fila en iso_desempeno_config_puesto sigue usando el default de su tipo — ver
// resolverConfigPersona() más abajo, que es la única función que el resto del código necesita
// llamar para saber qué puntaje usar.

export async function obtenerConfigPorPuesto() {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/iso_desempeno_config_puesto?select=*`, { headers: HDR });
    const filas = r.ok ? await r.json() : [];
    return new Map(filas.map(f => [normPuesto(f.desc_puesto), f]));
  } catch {
    return new Map();
  }
}

export async function guardarConfigPuesto(descPuesto, valores) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/iso_desempeno_config_puesto?on_conflict=desc_puesto`, {
    method: 'POST',
    headers: { ...HDR_JSON, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ desc_puesto: descPuesto, ...valores, actualizado_en: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error(`Supabase: error ${r.status}`);
}

export async function borrarConfigPuesto(descPuesto) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/iso_desempeno_config_puesto?desc_puesto=eq.${encodeURIComponent(descPuesto)}`, {
    method: 'DELETE', headers: HDR,
  });
  if (!r.ok) throw new Error(`Supabase: error ${r.status}`);
}

// Única función que hace falta llamar para saber qué puntaje aplicarle a una persona: el de su
// puesto si RRHH lo personalizó, si no el de su tipo (mensual/quincenal), si no el default fijo.
export function resolverConfigPersona(persona, tipo, configGlobal, configPorPuesto) {
  const porPuesto = configPorPuesto?.get(normPuesto(persona?.desc_puesto));
  return porPuesto || configGlobal?.[tipo] || CONFIG_DEFAULT[tipo];
}
