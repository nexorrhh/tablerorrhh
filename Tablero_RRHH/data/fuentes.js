// Credenciales e IDs de cada fuente de datos.
// Este es el ÚNICO archivo que conoce los detalles de conexión.
// Los componentes y los indicadores nunca acceden directamente a este archivo.

// ── Google Sheets ────────────────────────────────────────────────────────────
// TODO: reemplazar PEGAR_SHEET_ID_ACA por el ID real de la planilla de indicadores.
export const SHEET_ID = 'PEGAR_SHEET_ID_ACA';

// Planilla de postulantes (formulario de Google Forms público)
export const SHEET_ID_POSTULANTES = '1aFwMjW8eNG0d2Y7mKdDQvaySm-s2vtSLSO7HBWu7aTE';
export const SHEET_NOMBRE_POSTULANTES = 'Postulantes';

// TODO: confirmar el tipo de publicación de la planilla:
//   - "Cualquiera con el enlace puede ver" → usar endpoint gviz/tq
//   - "Publicada en la web" → puede funcionar también con gviz/tq o con export CSV
// Verificar en el navegador antes de dar por buena la función de parseo en adaptadores.js
export function urlSheets(nombreHoja) {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(nombreHoja)}`;
}

export function urlSheetsCSV(gid) {
  // Alternativa si gviz/tq falla
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;
}

// ── Supabase ──────────────────────────────────────────────────────────────────
// TODO: reemplazar por los valores reales del proyecto Supabase de este dashboard.
// IMPORTANTE: usar SOLO la anon key (es pública). NUNCA la service_role key acá.
export const SUPABASE_URL      = 'https://bmueojeeexheprteavay.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJtdWVvamVlZXhoZXBydGVhdmF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MjEyMzQsImV4cCI6MjA5NTk5NzIzNH0.Rh_OGhhnWZwOil1Rp7261QETH9kFgSvylZVJS35e7-o';
