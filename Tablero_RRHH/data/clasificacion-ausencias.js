import { SUPABASE_URL, SUPABASE_ANON_KEY } from './fuentes.js';

// Fuente única de verdad para saber a qué categoría de ausentismo pertenece cada concepto
// de justificación que exporta Tango (ENF, ENF TRAUM1, ACC_EMP, AUS C/AVIS, SIN_AVISO...).
// La clasificación vive en rrhh_justificacion_config (codigo_justificacion → categoria).
// Un código SIN fila en esa tabla está "sin_clasificar" por defecto: no hace falta guardar
// una fila con categoria='sin_clasificar', su ausencia ya representa ese estado.
//
// VACACION y VIAJE no entran acá — ya tienen tratamiento propio en presentismo-carga.js
// (no cuentan como ausentismo en absoluto), así que no son "motivo de ausencia" a clasificar.

const HDR = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
const HDR_JSON = { ...HDR, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' };

export const CATEGORIAS_AUSENCIA = ['enfermedad', 'accidente', 'aviso', 'sin_aviso'];

export async function obtenerClasificacionAusencias() {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rrhh_justificacion_config?select=codigo_justificacion,categoria`, { headers: HDR });
  const rows = r.ok ? await r.json() : [];
  return new Map(rows.map(f => [f.codigo_justificacion, f.categoria]));
}

// mapa: el Map devuelto por obtenerClasificacionAusencias().
export function categoriaAusencia(codigoJustificacion, mapa) {
  return mapa.get((codigoJustificacion || '').trim()) || 'sin_clasificar';
}

export async function guardarClasificacionAusencia(codigo, categoria) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rrhh_justificacion_config?on_conflict=codigo_justificacion`, {
    method: 'POST',
    headers: HDR_JSON,
    body: JSON.stringify({ codigo_justificacion: codigo, categoria }),
  });
  if (!r.ok) throw new Error(`Supabase: error ${r.status} al clasificar "${codigo}"`);
}

export async function borrarClasificacionAusencia(codigo) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rrhh_justificacion_config?codigo_justificacion=eq.${encodeURIComponent(codigo)}`, {
    method: 'DELETE',
    headers: HDR,
  });
  if (!r.ok) throw new Error(`Supabase: error ${r.status} al desclasificar "${codigo}"`);
}
