import { NEXO_CONFIG } from './fuentes.js';

// Helper mínimo para llamar a la Edge Function de Nexo RRHH ("rapid-function").
// No hay tabla propia acá: los permisos (llegada tarde / falta / salida anticipada)
// viven en dos proyectos Supabase separados (uno por empresa), cada uno detrás de
// esta misma función. Se llama por POST con ?action=<nombre> y body { api_key, ...}.
export async function nexoCall(tenant, action, body = {}) {
  const cfg = NEXO_CONFIG[tenant];
  if (!cfg) throw new Error(`Tenant Nexo desconocido: "${tenant}"`);

  const r = await fetch(`${cfg.url}?action=${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: cfg.apiKey, ...body }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) throw new Error(data.error ?? `Error Nexo (HTTP ${r.status})`);
  return data;
}

// El backend no tagea sus respuestas con la empresa — la sabe el cliente porque
// la pidió a un tenant específico. Para el camino inverso (autorizar un permiso ya
// tageado client-side con empresa: 'CIMOMET'|'COMOING'), este helper hace el mapeo.
export function tenantDeEmpresa(empresa) {
  return empresa === 'COMOING' ? 'comoing' : 'cimomet';
}

const TENANTS = [['cimomet', 'CIMOMET'], ['comoing', 'COMOING']];

// Pide una acción a los dos tenants en paralelo y devuelve la lista combinada, cada
// item tageado con `empresa` (el backend no lo sabe — lo agrega el cliente porque
// pidió a un tenant específico). `extraer` saca el array de la respuesta cruda de
// cada acción (distinto nombre de campo según la acción: 'permisos', 'emails', etc.).
// Si un tenant falla, no rompe todo: se devuelve lo que sí vino + qué tenants fallaron.
async function combinarTenants(action, extraer, body = {}) {
  const resultados = await Promise.allSettled(TENANTS.map(([t]) => nexoCall(t, action, body)));
  const items = [];
  const fallos = [];
  resultados.forEach((r, i) => {
    const [, empresa] = TENANTS[i];
    if (r.status === 'fulfilled') items.push(...extraer(r.value).map(x => ({ ...x, empresa })));
    else fallos.push(empresa);
  });
  return { items, fallos };
}

export function obtenerPermisosPendientes() {
  return combinarTenants('get_permisos_pendientes', d => d.permisos || []);
}

export function obtenerEstadisticasPermisos() {
  return combinarTenants('get_estadisticas_permisos', d => d.permisos || []);
}
