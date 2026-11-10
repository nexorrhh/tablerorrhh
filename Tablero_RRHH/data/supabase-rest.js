// Capa única para hablar con Supabase por REST (sin supabase-js, sin npm).
// Antes cada componente tenía su propio HDR / sbGet / paginador (49 copias), con
// criterios distintos ante errores: algunos devolvían [] en silencio y la pantalla
// mostraba "no hay datos" cuando en realidad había fallado la red. Acá todas las
// funciones LANZAN un error si la respuesta no es OK, para que cada pantalla pueda
// mostrar un mensaje claro (CLAUDE.md §7, "errores visibles").
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './fuentes.js';

export const HDR = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
const BASE = `${SUPABASE_URL}/rest/v1/`;

// PostgREST corta en 1000 filas por consulta SIN avisar (db-max-rows).
const PAGINA = 1000;

// `ruta` es lo que va después de /rest/v1/, ej: "empleados?select=legajo,activo".
// También acepta una URL completa (compatibilidad con código que ya la arma).
function url(ruta) {
  return /^https?:\/\//.test(ruta) ? ruta : BASE + ruta;
}

async function errorDe(r, ruta) {
  let detalle = '';
  try { detalle = (await r.text()).slice(0, 300); } catch { /* sin cuerpo */ }
  const tabla = String(ruta).replace(BASE, '').split('?')[0];
  return new Error(`Supabase ${r.status} en "${tabla}"${detalle ? ': ' + detalle : ''}`);
}

// GET simple (una sola página). Usar solo cuando el resultado es chico por
// naturaleza (filtro por id, limit explícito, tablas de configuración).
export async function sbGet(ruta) {
  const r = await fetch(url(ruta), { headers: HDR });
  if (!r.ok) throw await errorDe(r, ruta);
  return r.json();
}

// GET paginado hasta traer TODAS las filas. Si una página falla, lanza error en vez
// de devolver datos parciales como si estuvieran completos.
// Para que la paginación sea estable la ruta debería incluir un order= por una
// columna única (ej. order=id.asc); sin eso PostgREST no garantiza el orden.
export async function sbTraerTodo(ruta) {
  const sep = ruta.includes('?') ? '&' : '?';
  let offset = 0;
  let filas = [];
  for (;;) {
    const r = await fetch(`${url(ruta)}${sep}limit=${PAGINA}&offset=${offset}`, { headers: HDR });
    if (!r.ok) throw await errorDe(r, ruta);
    const pagina = await r.json();
    if (!Array.isArray(pagina)) throw new Error(`Supabase: respuesta inesperada en "${ruta}"`);
    filas = filas.concat(pagina);
    if (pagina.length < PAGINA) break;
    offset += PAGINA;
  }
  return filas;
}

// Cuenta filas sin descargarlas (para badges y contadores).
export async function sbContar(ruta) {
  const r = await fetch(url(ruta), { method: 'HEAD', headers: { ...HDR, Prefer: 'count=exact', Range: '0-0' } });
  if (!r.ok && r.status !== 206) throw await errorDe(r, ruta);
  const rango = r.headers.get('content-range') || '';
  const total = Number(rango.split('/')[1]);
  return Number.isFinite(total) ? total : 0;
}

async function escribir(metodo, ruta, cuerpo, prefer = 'return=minimal') {
  const r = await fetch(url(ruta), {
    method: metodo,
    headers: { ...HDR, 'Content-Type': 'application/json', Prefer: prefer },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  if (!r.ok) throw await errorDe(r, ruta);
  invalidarCache(String(ruta).replace(BASE, '').split('?')[0]);
  const texto = await r.text();
  return texto ? JSON.parse(texto) : null;
}

export const sbPost   = (ruta, cuerpo, prefer) => escribir('POST', ruta, cuerpo, prefer);
export const sbPatch  = (ruta, cuerpo, prefer) => escribir('PATCH', ruta, cuerpo, prefer);
export const sbDelete = (ruta, prefer)         => escribir('DELETE', ruta, undefined, prefer);
export const sbUpsert = (ruta, cuerpo)         => escribir('POST', ruta, cuerpo, 'resolution=merge-duplicates,return=minimal');

// Llama a una función de Postgres (RPC). Devuelve lo que devuelve la función.
export async function sbRpc(nombre, params = {}, { lectura = false } = {}) {
  const r = await fetch(`${BASE}rpc/${nombre}`, {
    method: 'POST',
    headers: { ...HDR, 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!r.ok) throw await errorDe(r, `rpc/${nombre}`);
  // Las RPC de este tablero escriben (importar plantel, cargas de Tango/Capataz) y no
  // se sabe qué tablas tocan: se limpia toda la caché para no mostrar datos viejos.
  // (lectura: true para RPC que solo leen, ej. listar feriados: no hace falta limpiar nada).
  if (!lectura) invalidarCache();
  const texto = await r.text();
  return texto ? JSON.parse(texto) : null;
}

// ── Caché por sesión ─────────────────────────────────────────────────────────
// Varias pestañas piden las mismas tablas grandes (rrhh_horas_mensual, empleados,
// clasificaciones). Se guarda la PROMESA, así dos pantallas que piden lo mismo a la
// vez comparten una sola descarga. Si la descarga falla se borra de la caché para
// que el próximo intento vuelva a consultar.
const cache = new Map();
const TTL_MS = 5 * 60 * 1000;

export function sbTraerTodoCache(ruta, ttlMs = TTL_MS) {
  const ahora = Date.now();
  const hit = cache.get(ruta);
  if (hit && ahora - hit.momento < ttlMs) return hit.promesa;
  const promesa = sbTraerTodo(ruta).catch((e) => { cache.delete(ruta); throw e; });
  cache.set(ruta, { promesa, momento: ahora });
  return promesa;
}

// Invalida lo cacheado de una tabla (se llama solo después de cualquier escritura;
// también lo puede llamar una pantalla de carga al terminar de importar).
export function invalidarCache(tabla) {
  if (!tabla) { cache.clear(); return; }
  for (const k of cache.keys()) if (k.split('?')[0] === tabla) cache.delete(k);
}
