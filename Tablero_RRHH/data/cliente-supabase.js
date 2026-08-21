import { SUPABASE_URL, SUPABASE_ANON_KEY } from './fuentes.js';

// Helper mínimo para hacer GET a una tabla de Supabase via REST.
// No depende de la librería supabase-js (sin npm); usa fetch directo.
// Si en el futuro se quiere agregar supabase-js vía CDN, este helper se reemplaza.

export async function obtenerTabla(tabla, columnas = '*') {
  const url = `${SUPABASE_URL}/rest/v1/${tabla}?select=${columnas}`;

  const respuesta = await fetch(url, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });

  if (!respuesta.ok) {
    throw new Error(`Supabase: error ${respuesta.status} al leer tabla "${tabla}"`);
  }

  return respuesta.json();
}
