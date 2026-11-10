// "Pendientes" de Configuración: todo lo que quedó sin parametrizar. Cada categoría usa el
// MISMO criterio que la pantalla donde se resuelve, así el globito y la pantalla coinciden.
//   puestos       → puestos del plantel activo sin clasificar como mensual/quincenal
//   presentismo   → conceptos de ausencia de Tango sin categoría
//   desempeno     → personas activas (mensuales/quincenales) cuyo puesto no tiene evaluador
//   vacaciones    → puestos sin sector de vacaciones (solo si el módulo está instalado)
// Cada categoría dice en qué solapa de Configuración se resuelve (`solapa`).
import { sbTraerTodo, sbTraerTodoCache } from './supabase-rest.js';
import { obtenerClasificacionPuestos, tipoPuesto, normPuesto } from './clasificacion-puestos.js';
import { obtenerClasificacionAusencias, categoriaAusencia } from './clasificacion-ausencias.js';
import { obtenerAsignacionesPuestos } from './evaluadores.js';
import { obtenerPuestosExcluidosDesempeno } from './desempeno-exclusiones.js';
import { vacacionesConfig } from '../config/vacaciones.js';
import { normalizarPuesto } from './vacaciones-reglas.js';

// Mismos códigos que no cuentan como ausentismo (ver presentismo-parametrizacion.js).
const CODIGOS_EXCLUIDOS = new Set(['VACACION', 'VIAJE', 'AUS_FER']);

const contarPor = (filas, clave) => {
  const m = new Map();
  filas.forEach(f => { const k = clave(f); m.set(k, (m.get(k) || 0) + 1); });
  return m;
};

async function puestosSinClasificar(activos, mapa) {
  const conteo = contarPor(activos.filter(e => (e.desc_puesto || '').trim()), e => e.desc_puesto.trim());
  return [...conteo.entries()]
    .filter(([puesto]) => tipoPuesto(puesto, mapa) === 'sin_asignar')
    .sort((a, b) => b[1] - a[1])
    .map(([puesto, n]) => ({ texto: puesto, detalle: `${n} persona${n === 1 ? '' : 's'}` }));
}

async function conceptosSinClasificar() {
  const [eventos, mapa] = await Promise.all([
    sbTraerTodo('rrhh_tardanzas_salidas?tipo=eq.ausente&select=codigo_justificacion,descripcion_justificacion&order=id.asc'),
    obtenerClasificacionAusencias(),
  ]);
  const info = new Map();
  eventos.forEach(e => {
    const cod = (e.codigo_justificacion || '').trim();
    if (CODIGOS_EXCLUIDOS.has(cod)) return;
    if (!info.has(cod)) info.set(cod, { descripcion: e.descripcion_justificacion || '', n: 0 });
    info.get(cod).n++;
  });
  return [...info.entries()]
    .filter(([cod]) => categoriaAusencia(cod, mapa) === 'sin_clasificar')
    .sort((a, b) => b[1].n - a[1].n)
    .map(([cod, x]) => ({ texto: cod || '(sin código en Tango)', detalle: `${x.descripcion ? x.descripcion + ' · ' : ''}${x.n} registro${x.n === 1 ? '' : 's'}` }));
}

async function personasSinEvaluador(activos, mapa) {
  const [asignaciones, excluidos] = await Promise.all([obtenerAsignacionesPuestos(), obtenerPuestosExcluidosDesempeno()]);
  const cubiertos = new Set(asignaciones.map(a => normPuesto(a.desc_puesto)));
  return activos
    .filter(p => {
      const tipo = tipoPuesto(p.desc_puesto, mapa);
      if (tipo !== 'mensual' && tipo !== 'quincenal') return false; // sin clasificar: se resuelve en Puestos
      const k = normPuesto(p.desc_puesto);
      return !excluidos.has(k) && !cubiertos.has(k);
    })
    .sort((a, b) => (a.apellido_y_nombre || '').localeCompare(b.apellido_y_nombre || ''))
    .map(p => ({ texto: p.apellido_y_nombre, detalle: p.desc_puesto || 'Sin puesto' }));
}

async function puestosSinSectorVacaciones(activos) {
  let mapeo;
  try { mapeo = await sbTraerTodo('vac_puesto_sector?select=puesto_norm&order=puesto_norm.asc'); }
  catch { return null; } // módulo de vacaciones sin instalar: no es un pendiente
  const mapeados = new Set(mapeo.map(m => m.puesto_norm));
  const excluidos = new Set(vacacionesConfig.puestosExcluidos.map(normalizarPuesto));
  const prefijos = vacacionesConfig.gruposPorPrefijo.map(g => normalizarPuesto(g.prefijo));
  const conteo = contarPor(activos.filter(e => (e.desc_puesto || '').trim()), e => e.desc_puesto.trim());
  return [...conteo.entries()]
    .filter(([puesto]) => {
      const k = normalizarPuesto(puesto);
      return !excluidos.has(k) && !prefijos.some(p => k.startsWith(p)) && !mapeados.has(k);
    })
    .map(([puesto, n]) => ({ texto: puesto, detalle: `${n} persona${n === 1 ? '' : 's'}` }));
}

// Devuelve [{ id, solapa, titulo, ayuda, items, error }]. `solapasVisibles`: ids de las
// solapas de Configuración que la persona ve (las demás categorías no se calculan).
export async function calcularPendientes(solapasVisibles) {
  const ve = id => solapasVisibles.includes(id);
  const activos = (await sbTraerTodoCache('empleados?select=legajo,apellido_y_nombre,empresa,desc_puesto,activo&order=id.asc')).filter(e => e.activo);
  const mapa = await obtenerClasificacionPuestos();

  const defs = [
    { id: 'puestos', solapa: 'puestos', titulo: 'Puestos sin clasificar (mensual / quincenal)',
      ayuda: 'Un puesto nuevo de Tango entra como "Sin asignar". Hasta clasificarlo, esas personas no cuentan en los indicadores de su grupo ni en Desempeño.',
      calc: () => puestosSinClasificar(activos, mapa) },
    { id: 'presentismo', solapa: 'presentismo', titulo: 'Conceptos de ausencia sin clasificar',
      ayuda: 'Conceptos de justificación de Tango que no tienen motivo (enfermedad, accidente, licencia, aviso, sin aviso).',
      calc: conceptosSinClasificar },
    { id: 'desempeno', solapa: 'desempeno', titulo: 'Personas sin evaluador',
      ayuda: 'Su puesto no está asignado a ningún evaluador: nadie les va a cargar la evaluación de desempeño.',
      calc: () => personasSinEvaluador(activos, mapa) },
    { id: 'vacaciones', solapa: 'vacaciones', titulo: 'Puestos sin sector de vacaciones',
      ayuda: 'Las personas de estos puestos no entran en el cálculo de cobertura de vacaciones.',
      calc: () => puestosSinSectorVacaciones(activos) },
  ].filter(d => ve(d.solapa));

  const resultados = await Promise.all(defs.map(async d => {
    try { const items = await d.calc(); return items == null ? null : { ...d, items }; }
    catch (e) { console.warn('Pendientes', d.id, e); return { ...d, items: [], error: e.message }; }
  }));
  return resultados.filter(Boolean);
}

export const totalPendientes = cats => cats.reduce((t, c) => t + c.items.length, 0);
