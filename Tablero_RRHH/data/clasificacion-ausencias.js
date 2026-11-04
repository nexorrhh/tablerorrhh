import { sbTraerTodoCache, sbUpsert, sbDelete } from './supabase-rest.js';

// Fuente única de verdad para saber a qué categoría de ausentismo pertenece cada concepto
// de justificación que exporta Tango (ENF, ENF TRAUM1, ACC_EMP, AUS C/AVIS, SIN_AVISO...).
// La clasificación vive en rrhh_justificacion_config (codigo_justificacion → categoria).
// Un código SIN fila en esa tabla está "sin_clasificar" por defecto: no hace falta guardar
// una fila con categoria='sin_clasificar', su ausencia ya representa ese estado.
//
// VACACION y VIAJE no entran acá — ya tienen tratamiento propio en presentismo-carga.js
// (no cuentan como ausentismo en absoluto), así que no son "motivo de ausencia" a clasificar.

export const CATEGORIAS_AUSENCIA = ['enfermedad', 'accidente', 'licencia', 'aviso', 'sin_aviso'];

export async function obtenerClasificacionAusencias() {
  // Fallback intencional: si falla, todos los códigos quedan "sin_clasificar" (como siempre)
  // en vez de romper Indicadores / Novedades / Por persona.
  let rows = [];
  try {
    rows = await sbTraerTodoCache('rrhh_justificacion_config?select=codigo_justificacion,categoria&order=codigo_justificacion.asc');
  } catch (e) {
    console.warn('No se pudo leer la clasificación de ausencias (rrhh_justificacion_config)', e);
  }
  return new Map(rows.map(f => [f.codigo_justificacion, f.categoria]));
}

// mapa: el Map devuelto por obtenerClasificacionAusencias().
export function categoriaAusencia(codigoJustificacion, mapa) {
  return mapa.get((codigoJustificacion || '').trim()) || 'sin_clasificar';
}

export async function guardarClasificacionAusencia(codigo, categoria) {
  try {
    await sbUpsert('rrhh_justificacion_config?on_conflict=codigo_justificacion', { codigo_justificacion: codigo, categoria });
  } catch (e) {
    throw new Error(`${e.message} — al clasificar "${codigo}"`, { cause: e });
  }
}

export async function borrarClasificacionAusencia(codigo) {
  try {
    await sbDelete(`rrhh_justificacion_config?codigo_justificacion=eq.${encodeURIComponent(codigo)}`);
  } catch (e) {
    throw new Error(`${e.message} — al desclasificar "${codigo}"`, { cause: e });
  }
}
