import { SUPABASE_URL, SUPABASE_ANON_KEY } from './fuentes.js';

// Resultado de seguridad para Desempeño, calculado desde las evaluaciones mensuales que carga
// Seguridad e Higiene en su propio tablero (tablero-hys → "Evaluación Preventiva"): así ni RRHH
// ni el evaluador tienen que calificar seguridad a mano.
//
// Se lee de la vista v_hys_seguridad_mensual (ver sql/v_hys_seguridad_mensual.sql), que expone
// solo legajo, empresa, mes, año y el promedio de cada mes — las tablas originales de HyS solo
// las pueden leer usuarios logueados en tablero-hys.

const HDR = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };

// HyS califica de 1 (Malo) a 5 (Excelente); Desempeño usa 0-100 con los mismos 5 niveles
// (Insuficiente/Escaso, Regular, Bueno, Muy bueno, Excelente), así que la traducción es lineal:
// 1→0, 2→25, 3→50, 4→75, 5→100. Entero porque epp_nivel y seguridad son columnas enteras.
export function nivelDesdePromedioHyS(promedio) {
  return Math.round((promedio - 1) / 4 * 100);
}

const claveMes = (anio, mes) => `${anio}-${String(mes).padStart(2, '0')}`;

// Promedio de todas las evaluaciones mensuales de HyS de la persona entre `desde` y `hasta`
// (strings "YYYY-MM", ambos inclusive). Cada mes pesa lo mismo: 3 meses Excelente (5) y uno
// Malo (1) dan 4,0 → 75 (Muy bueno).
// Devuelve null si no hay ninguna evaluación en el período o si la vista no se puede leer (por
// ejemplo, si todavía no se creó en Supabase): en ese caso el formulario vuelve a la carga
// manual de siempre, así que nunca bloquea una evaluación.
export async function obtenerSeguridadHyS(legajo, empresa, desde, hasta) {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/v_hys_seguridad_mensual?legajo=eq.${encodeURIComponent(legajo)}&empresa=eq.${encodeURIComponent(empresa)}&select=anio,mes,promedio_general`,
      { headers: HDR },
    );
    if (!r.ok) return null;
    const meses = (await r.json())
      .filter(f => f.promedio_general != null)
      .map(f => ({ clave: claveMes(f.anio, f.mes), promedio: +f.promedio_general }))
      .filter(f => f.clave >= desde && f.clave <= hasta)
      .sort((a, b) => a.clave.localeCompare(b.clave));
    if (!meses.length) return null;
    const promedio = meses.reduce((s, f) => s + f.promedio, 0) / meses.length;
    return {
      promedio,
      nivel: nivelDesdePromedioHyS(promedio),
      cantidad: meses.length,
      primerMes: meses[0].clave,
      ultimoMes: meses[meses.length - 1].clave,
    };
  } catch {
    return null;
  }
}
