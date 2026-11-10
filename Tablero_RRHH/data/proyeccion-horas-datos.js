// Lectura de lo que necesita la proyección de horas (mismas fuentes que el módulo
// Planificación → Capacidad del panel de producción): nómina, clasificación de puestos,
// meses recientes (real y ausentismo histórico) y feriados. La jornada proyectada NO sale de
// Tango: es la regla de config/proyeccion-horas.js.
import { sbGet, sbTraerTodoCache, sbRpc } from './supabase-rest.js';
import { periodoActual, sumarMeses, normPuesto, resolverJornadaPorRegla, textoReglaJornada, ausentismoPorPuesto, realPorPuesto } from './proyeccion-horas.js';
import { proyeccionConfig } from '../config/proyeccion-horas.js';

// Ventanas de cálculo (no son valores de negocio; iguales a las del panel).
export const MESES_HISTORICOS = 3;  // meses cerrados para el ausentismo y el real

async function cargar() {
  const actual = periodoActual();
  const periodos = Array.from({ length: MESES_HISTORICOS + 1 }, (_, i) => sumarMeses(actual, -i) + '-01');

  const [todosEmpleados, clasif, mensual, ultima, feriados] = await Promise.all([
    sbTraerTodoCache('empleados?select=legajo,empresa,apellido_y_nombre,desc_puesto,activo&order=id.asc'),
    sbTraerTodoCache('rrhh_puestos_config?select=desc_puesto,tipo&order=desc_puesto.asc'),
    // `periodo` es una columna date ('YYYY-MM-01'), no texto 'YYYY-MM'.
    sbTraerTodoCache(`rrhh_horas_mensual?select=legajo,empresa,periodo,hs_esperadas,hs_normales,hs_ausencias&periodo=in.(${periodos.join(',')})&order=id.asc`),
    sbGet('rrhh_horas_detalle?select=fecha&order=fecha.desc&limit=1'),
    sbRpc('produccion_listar_feriados', {}, { lectura: true }).catch(e => { console.warn('Proyección: sin feriados', e); return null; }),
  ]);

  const empleados = todosEmpleados.filter(e => e.activo);
  const mapaClasif = new Map(clasif.map(f => [normPuesto(f.desc_puesto), f.tipo]));
  // El ausentismo histórico solo mira meses cerrados: el mes en curso está a medio cargar.
  const cerrados = mensual.filter(f => String(f.periodo).slice(0, 7) < actual);
  return {
    todosEmpleados, empleados, mapaClasif,
    resolverJornada: resolverJornadaPorRegla(proyeccionConfig),
    textoJornada: textoReglaJornada(proyeccionConfig),
    ausentismo: ausentismoPorPuesto(cerrados, empleados),
    real: realPorPuesto(mensual, todosEmpleados),
    ultimaFechaHoras: ultima?.[0]?.fecha || null,
    feriados: feriados || [],
    feriadosSet: new Set((feriados || []).map(f => f.fecha)),
    sinFeriados: feriados == null,
  };
}

// Se comparte entre pantallas (Resumen de Vacaciones y Proyección) durante 5 minutos.
let enCurso = null, momento = 0;
export function cargarDatosProyeccion() {
  if (!enCurso || Date.now() - momento > 5 * 60 * 1000) {
    momento = Date.now();
    enCurso = cargar().catch(e => { enCurso = null; throw e; });
  }
  return enCurso;
}
