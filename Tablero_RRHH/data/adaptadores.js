// Cada adaptador recibe los parámetros del campo `origen` de un indicador
// y devuelve SIEMPRE el formato común: { labels: [], valores: [] }
//
// Esta capa es la que hace que los componentes no sepan de dónde vienen los datos.
// Para migrar un indicador de Sheets a Supabase: cambiar `fuente` en indicadores.js. Nada más.

import { urlSheets } from './fuentes.js';
import { obtenerTabla } from './cliente-supabase.js';

// Formato común que todos los adaptadores deben devolver:
// { labels: string[], valores: number[] }

// ── Adaptador: datos de ejemplo (hardcodeados) ────────────────────────────────
export async function adaptarEjemplo(origen) {
  // origen.datos ya tiene el formato común — solo lo reenvía
  return origen.datos;
}

// ── Adaptador: Google Sheets (gviz/tq) ────────────────────────────────────────
export async function adaptarSheets(origen) {
  // origen: { hoja, columnaLabel, columnaValor }
  const url = urlSheets(origen.hoja);
  const respuestaTexto = await fetch(url).then(r => r.text());

  // Google envuelve el JSON en un prefijo como:
  //   /*O_o*/\ngoogle.visualization.Query.setResponse({...});
  // Hay que recortar ese envoltorio antes de parsear.
  // TODO: verificar el formato exacto del envoltorio con una llamada real a la planilla,
  //       ya que Google lo ha cambiado en el pasado.
  const jsonStr = respuestaTexto
    .replace(/^[^(]+\(/, '')  // elimina todo hasta el primer "("
    .replace(/\);?\s*$/, ''); // elimina el ")" y punto y coma del final

  const datos = JSON.parse(jsonStr);
  const filas = datos?.table?.rows ?? [];
  const cols = datos?.table?.cols ?? [];

  const indiceLabel = cols.findIndex(c => c.label === origen.columnaLabel);
  const indiceValor = cols.findIndex(c => c.label === origen.columnaValor);

  if (indiceLabel === -1 || indiceValor === -1) {
    throw new Error(
      `Sheets: no se encontraron las columnas "${origen.columnaLabel}" y/o "${origen.columnaValor}" en la hoja "${origen.hoja}"`
    );
  }

  const labels = filas.map(f => f.c[indiceLabel]?.v ?? '');
  const valores = filas.map(f => Number(f.c[indiceValor]?.v ?? 0));

  return { labels, valores };
}

// ── Adaptador: Supabase ───────────────────────────────────────────────────────
export async function adaptarSupabase(origen) {
  // origen: { tabla, columnaLabel, columnaValor }
  const filas = await obtenerTabla(origen.tabla, `${origen.columnaLabel},${origen.columnaValor}`);

  const labels = filas.map(f => String(f[origen.columnaLabel] ?? ''));
  const valores = filas.map(f => Number(f[origen.columnaValor] ?? 0));

  return { labels, valores };
}

// ── Dispatcher: elige el adaptador según la fuente ───────────────────────────
export async function obtenerDatosIndicador(indicador) {
  switch (indicador.fuente) {
    case 'ejemplo':
      return adaptarEjemplo(indicador.origen);
    case 'sheets':
      return adaptarSheets(indicador.origen);
    case 'supabase':
      return adaptarSupabase(indicador.origen);
    default:
      throw new Error(`Fuente desconocida: "${indicador.fuente}"`);
  }
}
