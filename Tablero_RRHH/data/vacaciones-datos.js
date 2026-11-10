// Lectura y escritura del módulo Vacaciones. Arma un "contexto" con todo lo que usan las
// pantallas (nómina, sectores, períodos, saldos, feriados, competencias) a partir de las
// tablas existentes + las vac_ (sql/vacaciones.sql). No duplica la nómina: los empleados
// salen siempre de `empleados`.
import { sbGet, sbTraerTodo, sbTraerTodoCache, sbPost, sbPatch, sbDelete, sbRpc, invalidarCache } from './supabase-rest.js';
import { obtenerUsuario } from './usuario-activo.js';
import { vacacionesConfig } from '../config/vacaciones.js';
import { normalizarPuesto, diasCorresponden, diasCorridos, rangoAnioVacacional } from './vacaciones-reglas.js';
import { clavePersona } from './vacaciones-cobertura.js';
import { cruceTango, vacacionesSinPlanificar } from './vacaciones-tango.js';

export const usuarioActual = () => obtenerUsuario()?.nombre || 'desconocido';

// Error especial: las tablas todavía no están creadas en Supabase.
export class ModuloNoInstalado extends Error {}

async function leerVac(ruta) {
  try { return await sbTraerTodo(ruta); }
  catch (e) {
    if (/PGRST205|42P01|Could not find the table|does not exist|Supabase 404/.test(e.message)) {
      throw new ModuloNoInstalado('Faltan las tablas del módulo (sql/vacaciones.sql).');
    }
    throw e;
  }
}

// Datos opcionales de otros módulos: si fallan, el módulo sigue andando sin ellos.
async function opcional(promesa, que) {
  try { return await promesa; } catch (e) { console.warn(`Vacaciones: sin ${que}`, e); return null; }
}

export async function cargarContexto() {
  const [
    empleados, puestosCfg, sectores, mapeo, extras, periodos, escenarios, saldos, demanda, reglasV,
    feriados, poliPersonas, poliDetalle, poliPuestos, poliNiveles, vacTango, mesesTango,
  ] = await Promise.all([
    sbTraerTodo('empleados?activo=eq.true&select=legajo,empresa,apellido_y_nombre,desc_puesto,fecha_ingreso&order=apellido_y_nombre.asc,id.asc'),
    opcional(sbTraerTodo('rrhh_puestos_config?select=desc_puesto,tipo&order=desc_puesto.asc'), 'clasificación de puestos'),
    leerVac('vac_sectores?select=*&order=orden.asc,id.asc'),
    leerVac('vac_puesto_sector?select=*&order=puesto_norm.asc'),
    leerVac('vac_empleado_extra?select=*&order=legajo.asc,empresa.asc'),
    leerVac('vac_periodos?select=*&order=id.asc'),
    leerVac('vac_escenarios?select=*&order=id.asc'),
    leerVac('vac_saldos?select=*&order=id.asc'),
    leerVac('vac_demanda?select=*&order=semana.asc,sector_id.asc'),
    leerVac('vac_reglas?select=*&order=version.desc,id.desc'),
    opcional(sbRpc('produccion_listar_feriados', {}, { lectura: true }), 'feriados'),
    opcional(sbTraerTodo('produccion_polivalencia_persona?select=id,legajo,empresa&order=id.asc'), 'polivalencia'),
    opcional(sbTraerTodo('produccion_polivalencia_detalle?select=persona_id,puesto_id,nivel_id&order=id.asc'), 'polivalencia'),
    opcional(sbTraerTodo('produccion_puestos_polivalencia?select=id,nombre&order=id.asc'), 'polivalencia'),
    opcional(sbTraerTodo('produccion_niveles_polivalencia?select=id,nombre,orden&order=orden.asc'), 'polivalencia'),
    opcional(sbTraerTodo('rrhh_tardanzas_salidas?codigo_justificacion=eq.VACACION&select=legajo,empresa,fecha&order=id.asc'), 'vacaciones de Tango'),
    // Qué meses de Tango ya están importados (por empresa): sin eso no se puede afirmar que
    // alguien "no se tomó" las vacaciones, solo que todavía no hay datos.
    opcional(sbTraerTodoCache('rrhh_horas_mensual?select=periodo,empresa&order=id.asc'), 'meses importados de Tango'),
  ]);
  return armarContexto({
    empleados, puestosCfg: puestosCfg || [], sectores, mapeo, extras, periodos, escenarios, saldos, demanda, reglasV,
    feriados: feriados || [], poliPersonas: poliPersonas || [], poliDetalle: poliDetalle || [],
    poliPuestos: poliPuestos || [], poliNiveles: poliNiveles || [], vacTango: vacTango || [], mesesTango: mesesTango || [],
  });
}

function armarContexto(d) {
  const sectorPorId = new Map(d.sectores.map(s => [s.id, s]));
  const mapeo = new Map(d.mapeo.map(m => [m.puesto_norm, m.sector_id]));
  const extraPor = new Map(d.extras.map(x => [clavePersona(x.empresa, x.legajo), x]));
  const tipoPorPuesto = new Map(d.puestosCfg.map(p => [normalizarPuesto(p.desc_puesto), p.tipo]));

  // Puestos que no se planifican (config: puestosExcluidos) y agrupación automática por
  // prefijo (config: gruposPorPrefijo, ej. todos los "Responsable de…" → Responsables).
  const excluidos = new Set(vacacionesConfig.puestosExcluidos.map(normalizarPuesto));
  const sectorPorNombre = new Map(d.sectores.map(s => [normalizarPuesto(s.nombre), s.id]));
  const sectorDePuesto = puestoNorm => {
    const grupo = vacacionesConfig.gruposPorPrefijo.find(g => puestoNorm.startsWith(normalizarPuesto(g.prefijo)));
    const porGrupo = grupo ? sectorPorNombre.get(normalizarPuesto(grupo.sector)) : null;
    return porGrupo ?? mapeo.get(puestoNorm) ?? null;
  };

  // En `empleados` el legajo viene como texto y en las tablas vac_ como número: se unifica
  // a número para que las comparaciones (p.legajo === emp.legajo) funcionen siempre.
  const empleados = d.empleados.filter(e0 => !excluidos.has(normalizarPuesto(e0.desc_puesto))).map(e0 => {
    const e = { ...e0, legajo: Number(e0.legajo) };
    const clave = clavePersona(e.empresa, e.legajo);
    const extra = extraPor.get(clave);
    const sectorId = extra?.sector_id ?? sectorDePuesto(normalizarPuesto(e.desc_puesto));
    return {
      clave, legajo: e.legajo, empresa: e.empresa, nombre: e.apellido_y_nombre || `Legajo ${e.legajo}`,
      puesto: e.desc_puesto || '', fecha_ingreso: e.fecha_ingreso, sectorId,
      sectorExcepcion: extra?.sector_id != null,
      tipo: tipoPorPuesto.get(normalizarPuesto(e.desc_puesto)) || 'sin_asignar',
      // Convenio: el cargado para la persona o, si no hay, el de su empresa (config).
      convenio: extra?.convenio || vacacionesConfig.convenioPorEmpresa[e.empresa] || '',
      convenioExcepcion: !!extra?.convenio,
      establecimiento: extra?.establecimiento || '',
    };
  });

  // Reglas: la última versión ACTIVA; si no hay, los valores por defecto de la config.
  const activa = d.reglasV.find(r => r.activa);
  const reglas = { ...vacacionesConfig.reglasPorDefecto, ...(activa?.parametros || {}) };
  const reglasInfo = activa
    ? { version: activa.version, verificadaPor: activa.verificada_por, desde: activa.vigente_desde, porDefecto: false }
    : { version: 0, verificadaPor: null, desde: null, porDefecto: true };

  // Competencias (Polivalencia): solo el nivel MÁXIMO cuenta como reemplazo, y solo si el
  // puesto de Polivalencia se puede mapear a un sector. Tener una competencia no equivale
  // a estar habilitado para una tarea crítica: por eso se muestran como "posibles reemplazos".
  const nivelMax = d.poliNiveles.length ? Math.max(...d.poliNiveles.map(n => n.orden)) : null;
  const nivelesMax = new Set(d.poliNiveles.filter(n => n.orden === nivelMax).map(n => n.id));
  const sectorDePuestoPoli = new Map(d.poliPuestos.map(p => [p.id, sectorDePuesto(normalizarPuesto(p.nombre))]));
  const personaPoli = new Map(d.poliPersonas.map(p => [p.id, clavePersona(p.empresa, p.legajo)]));
  const competencias = new Map();
  d.poliDetalle.forEach(x => {
    if (!nivelesMax.has(x.nivel_id)) return;
    const clave = personaPoli.get(x.persona_id);
    const sectorId = sectorDePuestoPoli.get(x.puesto_id);
    if (!clave || sectorId == null) return;
    if (!competencias.has(clave)) competencias.set(clave, new Set());
    competencias.get(clave).add(sectorId);
  });

  const vacTango = new Map();
  d.vacTango.forEach(v => {
    const k = clavePersona(v.empresa, v.legajo);
    if (!vacTango.has(k)) vacTango.set(k, []);
    vacTango.get(k).push(v.fecha);
  });

  const demanda = new Map(d.demanda.map(x => [`${x.sector_id}|${x.semana}`, x.requeridos]));

  return {
    empleados, empleadoPor: new Map(empleados.map(e => [e.clave, e])), sectorDePuesto,
    grupoAutomatico: puestoNorm => vacacionesConfig.gruposPorPrefijo.find(g => puestoNorm.startsWith(normalizarPuesto(g.prefijo)))?.sector ?? null,
    sectores: d.sectores, sectoresActivos: d.sectores.filter(s => s.activo), sectorPorId,
    mapeo, mapeoFilas: d.mapeo, extras: d.extras,
    periodos: d.periodos, escenarios: d.escenarios, saldos: d.saldos, demanda, demandaFilas: d.demanda,
    reglas, reglasInfo, reglasVersiones: d.reglasV,
    feriados: new Set(d.feriados.map(f => f.fecha)), feriadosLista: d.feriados,
    competencias, hayPolivalencia: d.poliDetalle.length > 0,
    vacTango,
    mesesTango: d.mesesTango.reduce((m, r) => { if (!m.has(r.empresa)) m.set(r.empresa, new Set()); m.get(r.empresa).add(String(r.periodo).slice(0, 7)); return m; }, new Map()),
  };
}

// ── Consultas sobre el contexto ─────────────────────────────────────────────

const ACTIVOS = new Set(vacacionesConfig.estadosActivos);
export const esActivo = p => ACTIVOS.has(p.estado);
export const esFirme = p => vacacionesConfig.estadosFirmes.includes(p.estado);

// Períodos de un plan: escenarioId null = oficial.
export function periodosDelPlan(ctx, escenarioId = null) {
  return ctx.periodos.filter(p => (p.escenario_id ?? null) === (escenarioId ?? null));
}

export function requeridosDe(ctx) {
  return (sectorId, lunes) => {
    const sem = ctx.demanda.get(`${sectorId}|${lunes}`);
    if (sem != null) return sem;
    return ctx.sectorPorId.get(sectorId)?.requeridos_default ?? null;
  };
}

// Saldo de una persona para un año vacacional, en un plan. `excluirId`: el período que se
// está editando (no cuenta como comprometido contra sí mismo).
export function saldoPersona(ctx, emp, anio, escenarioId = null, excluirId = null) {
  const propios = ctx.saldos.filter(s => s.legajo === emp.legajo && s.empresa === emp.empresa && s.anio_vacacional === anio);
  const rrhh = propios.find(s => s.origen === 'rrhh');
  const ajustes = propios.filter(s => s.origen === 'ajuste').reduce((t, s) => t + Number(s.dias_corresponden), 0);
  const calc = diasCorresponden(emp.fecha_ingreso, anio, ctx.reglas, ctx.feriados);
  const base = rrhh ? Number(rrhh.dias_corresponden) : calc.dias;
  const corresponde = base == null ? null : base + ajustes;
  const comprometido = periodosDelPlan(ctx, escenarioId)
    .filter(p => p.legajo === emp.legajo && p.empresa === emp.empresa && p.anio_vacacional === anio && esActivo(p) && p.id !== excluirId)
    .reduce((t, p) => t + diasCorridos(p.desde, p.hasta), 0);
  const [ini, fin] = rangoAnioVacacional(anio);
  const tango = (ctx.vacTango.get(emp.clave) || []).filter(f => f >= ini && f <= fin).length;
  return {
    calculado: calc.dias, detalleCalculo: calc.detalle, antiguedad: calc.antiguedad,
    rrhh: rrhh ? Number(rrhh.dias_corresponden) : null, ajustes, corresponde, origen: rrhh ? 'rrhh' : 'calculado',
    comprometido, saldo: corresponde == null ? null : corresponde - comprometido, tangoDiasHabiles: tango,
    difiere: rrhh != null && calc.dias != null && Number(rrhh.dias_corresponden) !== calc.dias,
  };
}

// ── Escrituras ──────────────────────────────────────────────────────────────

export async function guardarPeriodo(p) {
  const fila = {
    legajo: p.legajo, empresa: p.empresa, anio_vacacional: p.anio_vacacional,
    escenario_id: p.escenario_id ?? null, desde: p.desde, hasta: p.hasta, estado: p.estado,
    notificado_en: p.notificado_en || null, constancia: p.constancia || null, observaciones: p.observaciones || null,
    alertas_aceptadas: p.alertas_aceptadas?.length ? p.alertas_aceptadas : null,
    aprobado_por: p.aprobado_por ?? null, aprobado_en: p.aprobado_en ?? null,
    modificado_por: usuarioActual(),
  };
  if (p.id) return sbPatch(`vac_periodos?id=eq.${p.id}`, fila);
  return sbPost('vac_periodos', fila);
}

// Para borrar se marca primero quién lo hace (así la auditoría lo registra) y después se borra.
export async function borrarPeriodo(id) {
  await sbPatch(`vac_periodos?id=eq.${id}`, { modificado_por: usuarioActual() });
  return sbDelete(`vac_periodos?id=eq.${id}`);
}

export async function crearEscenario({ nombre, descripcion, anio, copiarOficial, ctx }) {
  const [esc] = await sbPost('vac_escenarios', { nombre, descripcion: descripcion || null, anio_vacacional: anio, modificado_por: usuarioActual() }, 'return=representation');
  if (copiarOficial) {
    const filas = periodosDelPlan(ctx, null)
      .filter(p => p.anio_vacacional === anio && esActivo(p))
      .map(p => ({
        legajo: p.legajo, empresa: p.empresa, anio_vacacional: p.anio_vacacional, escenario_id: esc.id,
        desde: p.desde, hasta: p.hasta, estado: p.estado, observaciones: p.observaciones,
        alertas_aceptadas: p.alertas_aceptadas, modificado_por: usuarioActual(),
      }));
    if (filas.length) await sbPost('vac_periodos', filas);
  }
  return esc;
}

export const cambiarEstadoEscenario = (id, estado) =>
  sbPatch(`vac_escenarios?id=eq.${id}`, { estado, modificado_por: usuarioActual() });

export async function borrarEscenario(id) {
  await sbPatch(`vac_escenarios?id=eq.${id}`, { modificado_por: usuarioActual() });
  return sbDelete(`vac_escenarios?id=eq.${id}`);
}

export const aprobarEscenario = id => sbRpc('vac_aprobar_escenario', { p_escenario_id: id, p_usuario: usuarioActual() });

export const importarSaldos = (filas, archivo, reemplazar) =>
  sbRpc('vac_importar_saldos', { p_filas: filas, p_archivo: archivo, p_usuario: usuarioActual(), p_reemplazar: reemplazar });

export const agregarAjuste = ({ legajo, empresa, anio, dias, motivo, autorizadoPor }) =>
  sbPost('vac_saldos', {
    legajo, empresa, anio_vacacional: anio, dias_corresponden: dias, origen: 'ajuste',
    motivo, autorizado_por: autorizadoPor, modificado_por: usuarioActual(),
  });

export const guardarSector = s => (s.id
  ? sbPatch(`vac_sectores?id=eq.${s.id}`, s)
  : sbPost('vac_sectores', s));

export const borrarSector = id => sbDelete(`vac_sectores?id=eq.${id}`);

export function guardarMapeo(puestoNorm, sectorId) {
  if (!sectorId) return sbDelete(`vac_puesto_sector?puesto_norm=eq.${encodeURIComponent(puestoNorm)}`);
  return sbPost('vac_puesto_sector?on_conflict=puesto_norm', { puesto_norm: puestoNorm, sector_id: sectorId },
    'resolution=merge-duplicates,return=minimal');
}

export const guardarExtra = (emp, campos) =>
  sbPost('vac_empleado_extra?on_conflict=legajo,empresa', {
    legajo: emp.legajo, empresa: emp.empresa, convenio: emp.convenioExcepcion ? emp.convenio : null, establecimiento: emp.establecimiento || null,
    sector_id: emp.sectorExcepcion ? emp.sectorId : null, ...campos, modificado_por: usuarioActual(),
  }, 'resolution=merge-duplicates,return=minimal');

export function guardarDemanda(sectorId, semana, requeridos) {
  if (requeridos === '' || requeridos == null) return sbDelete(`vac_demanda?sector_id=eq.${sectorId}&semana=eq.${semana}`);
  return sbPost('vac_demanda?on_conflict=sector_id,semana', { sector_id: sectorId, semana, requeridos: Number(requeridos) },
    'resolution=merge-duplicates,return=minimal');
}

export async function guardarReglas(parametros, { activar, verificadaPor }, ctx) {
  const version = Math.max(0, ...ctx.reglasVersiones.map(r => r.version)) + 1;
  if (activar) await sbPatch('vac_reglas?activa=eq.true', { activa: false });
  return sbPost('vac_reglas', { version, parametros, activa: !!activar, verificada_por: verificadaPor || null });
}

export const leerAuditoria = (tabla, id) =>
  sbGet(`vac_auditoria?tabla=eq.${tabla}&registro_id=eq.${id}&select=accion,usuario,fecha,antes,despues&order=fecha.desc&limit=30`);

export { invalidarCache };

// ── Cruce con Tango (reemplaza al estado manual "Gozado") ───────────────────
export function cruceTangoDe(ctx, p, hoy = new Date().toISOString().slice(0, 10)) {
  const fechas = new Set(ctx.vacTango.get(`${p.empresa}|${p.legajo}`) || []);
  return cruceTango(p, fechas, ctx.feriados, hoy, ctx.mesesTango.get(p.empresa) || new Set());
}

// Vacaciones que Tango registra y no están en la planificación oficial, por persona.
export function tangoSinPlanificar(ctx, empleados, desde, hasta) {
  const oficial = periodosDelPlan(ctx, null).filter(esActivo);
  return empleados.map(emp => ({
    emp,
    tramos: vacacionesSinPlanificar(new Set(ctx.vacTango.get(emp.clave) || []),
      oficial.filter(p => p.legajo === emp.legajo && p.empresa === emp.empresa), desde, hasta, ctx.feriados),
  })).filter(x => x.tramos.length);
}
