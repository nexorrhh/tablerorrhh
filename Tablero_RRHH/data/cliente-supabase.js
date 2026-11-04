import { sbTraerTodo } from './supabase-rest.js';

// Helper mínimo para leer una tabla completa de Supabase via REST.
// Usa sbTraerTodo para no quedar cortado en 1000 filas (límite silencioso de PostgREST)
// y para que un fallo lance error en vez de devolver datos parciales.
// No se agrega order= porque la tabla es genérica y no sabemos si tiene columna `id`.

export async function obtenerTabla(tabla, columnas = '*') {
  return sbTraerTodo(`${tabla}?select=${columnas}`);
}
