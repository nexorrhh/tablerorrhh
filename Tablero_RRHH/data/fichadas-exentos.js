import { SUPABASE_URL, SUPABASE_ANON_KEY } from './fuentes.js';

// Personas que nunca van a fichar en el reloj por algún motivo particular (trabajan en otra
// sede, no tienen registrada la huella todavía, etc.) — al margen de los directores (Gerencia,
// que además están excluidos por puesto). Sin esto quedaban siempre marcadas "No fichó" en
// Novedades → Chequeo del día, ensuciando el informe con gente que nunca va a aparecer ahí.
// Se administra desde Parametrización → Fichadas.

const HDR = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
const HDR_JSON = { ...HDR, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' };

export async function obtenerExentosFichada() {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rrhh_fichadas_exentos?select=legajo,empresa,nombre,motivo&order=nombre.asc`, { headers: HDR });
  return r.ok ? await r.json() : [];
}

export async function marcarExentoFichada(legajo, empresa, nombre, motivo) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rrhh_fichadas_exentos?on_conflict=legajo,empresa`, {
    method: 'POST',
    headers: HDR_JSON,
    body: JSON.stringify({ legajo, empresa, nombre: nombre || null, motivo: motivo || null }),
  });
  if (!r.ok) throw new Error(`Supabase: error ${r.status} al marcar la excepción`);
}

export async function quitarExencionFichada(legajo, empresa) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rrhh_fichadas_exentos?legajo=eq.${legajo}&empresa=eq.${encodeURIComponent(empresa)}`, {
    method: 'DELETE',
    headers: HDR,
  });
  if (!r.ok) throw new Error(`Supabase: error ${r.status} al quitar la excepción`);
}
