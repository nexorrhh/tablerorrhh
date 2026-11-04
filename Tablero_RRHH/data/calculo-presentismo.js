// Cálculos de Horas y Presentismo: funciones PURAS (sin DOM, sin red, sin colores de
// pantalla). Se separaron de components/presentismo-indicadores.js para que:
//   - Indicadores, Ficha individual y Ficha de grupo usen exactamente la misma cuenta;
//   - se puedan verificar con casos fijos (tests/calculo-presentismo.html);
//   - los otros tableros (Dirección, panel-produccion) tengan una referencia única.
// Si se cambia una fórmula acá, correr los tests y replicar el cambio en
// ../tablero_control/sections.jsx y ../panel-produccion/.../calculoIndicadores.js.
import { categoriaAusencia } from './clasificacion-ausencias.js';

// Columnas de "Detalle de ausentismo", en el orden en que se muestran — 4 motivos +
// lo que todavía nadie clasificó (ver Horas y Presentismo → Parametrización).
export const CATEGORIAS_TABLA = ['enfermedad', 'accidente', 'licencia', 'aviso', 'sin_aviso', 'sin_clasificar'];
export const CATEGORIA_LABEL = {
  enfermedad: 'Enfermedad', accidente: 'Accidente', licencia: 'Licencia', aviso: 'Aviso',
  sin_aviso: 'Sin aviso', sin_clasificar: 'Sin clasif.',
};

// VACACION y VIAJE ya tienen tratamiento propio en presentismo-carga.js (no cuentan como
// ausentismo) — igual quedan como eventos 'ausente' en rrhh_tardanzas_salidas (los necesita
// el badge de "Vacaciones" en Por persona), así que hay que excluirlos acá explícitamente.
// AUS_FER (feriado) tampoco es una falta de la persona: la planta cierra por feriado.
export const CODIGOS_EXCLUIDOS_AUSENTISMO = new Set(['VACACION', 'VIAJE', 'AUS_FER']);

export const EMPRESAS  = ['CIMOMET', 'COMOING'];
export const EMP_LABEL = { CIMOMET: 'Cimomet', COMOING: 'Co.mo.ing' };

// Desglosa el detalle diario de HSEXT50 en "en semana" vs "sábados" (mismo dato que ya
// compone el total de Horas extra 50% — no es algo adicional, es un desglose de lo mismo).
export function desgloseExt50(detalle, legajosSet, periodo) {
  let semana = 0, sabado = 0;
  detalle.forEach(d => {
    if (!legajosSet.has(String(d.legajo))) return;
    if (periodo && d.periodo !== periodo) return;
    const horas = +d.hs_trabajadas || 0;
    const esSabado = new Date(d.fecha + 'T00:00:00').getDay() === 6;
    if (esSabado) sabado += horas; else semana += horas;
  });
  return { semana: Math.round(semana), sabado: Math.round(sabado) };
}

// Meses (con datos) de un año dado, a partir de la lista de períodos "YYYY-MM" ya cargados.
export function mesesDisponibles(allPeriodos, anio) {
  return [...new Set(allPeriodos.filter(p => p.startsWith(anio + '-')).map(p => p.split('-')[1]))].sort();
}

// Rango de fechas [desde, hasta] de una quincena dentro de un período. Acepta tanto
// "YYYY-MM" como el formato real de la columna "periodo" en Supabase ("YYYY-MM-01") — solo
// usa el año y el mes, así que el resto del string (si lo hay) no importa.
export function rangoQuincena(periodo, vista) {
  const [y, m] = periodo.split('-');
  const base = `${y}-${m}`;
  if (vista === 'q1') return [`${base}-01`, `${base}-15`];
  const ultimoDia = new Date(+y, +m, 0).getDate();
  return [`${base}-16`, `${base}-${String(ultimoDia).padStart(2, '0')}`];
}

export const EXT50_TIPOS = new Set(['HSEXT', 'HSEXT50', 'HS 50 VAC']);
const EXT100_TIPOS = new Set(['HSEXT100', 'HS 100 VAC']);

// Reconstruye filas "tipo rrhh_horas_mensual" (una por legajo) a partir del detalle diario
// (rrhh_horas_detalle) para una franja de fechas que no tiene su propio acumulado mensual —
// 1ra/2da quincena. El resultado se puede pasar tal cual a calcularGrupo(), así los mismos
// indicadores de siempre (cumplimiento, presentismo, ausentismo) valen también acá sin
// reimplementar esa lógica dos veces.
export function reconstruirFilasDesdeDetalle(detalleRows, rawAusGroup, empresaPorLegajo, periodo, fechaDesde, fechaHasta) {
  const porLegajo = new Map();
  const porLegajoFecha = new Map();

  function fila(legajo) {
    // Normalizar: los legajos llegan como number desde Supabase pero como string cuando se
    // extraen de la clave "legajo|fecha" más abajo — sin esto, cada persona quedaba partida
    // en dos filas (una con las horas, otra con los días presente) y ninguna cerraba sola.
    legajo = String(legajo);
    if (!porLegajo.has(legajo)) {
      porLegajo.set(legajo, {
        legajo, periodo, empresa: empresaPorLegajo.get(String(legajo)) || null,
        hs_normales: 0, hs_esperadas: 0, hs_extra50: 0, hs_extra100: 0,
        hs_vac_trabajadas: 0, hs_vac_esperadas: 0,
        hs_justificadas: 0, hs_no_justificadas: 0, hs_ausencias: 0,
        dias_laborables: 0, dias_presentes: 0, dias_ausentes_nojust: 0,
      });
    }
    return porLegajo.get(legajo);
  }

  detalleRows.forEach(d => {
    if (d.fecha < fechaDesde || d.fecha > fechaHasta) return;
    // Exigir también que el período de la fila coincida con el que se está pidiendo — hay
    // filas en rrhh_horas_detalle mal etiquetadas (periodo de un mes, fecha real de otro)
    // que si no se filtran acá se cuentan dos veces (una en su mes real, otra acá).
    if (d.periodo && d.periodo !== periodo) return;
    const key = `${d.legajo}|${d.fecha}`;
    if (!porLegajoFecha.has(key)) porLegajoFecha.set(key, []);
    porLegajoFecha.get(key).push(d);

    const f = fila(d.legajo);
    if (d.tipo_hora === 'HSNOR') {
      f.hs_normales        += +d.hs_trabajadas       || 0;
      f.hs_justificadas    += +d.hs_justificadas     || 0;
      f.hs_no_justificadas += +d.hs_no_justificadas  || 0;
      f.hs_esperadas       += +d.hs_esperadas        || 0;
    } else if (EXT50_TIPOS.has(d.tipo_hora)) {
      f.hs_extra50 += +d.hs_trabajadas || 0;
    } else if (EXT100_TIPOS.has(d.tipo_hora)) {
      f.hs_extra100 += +d.hs_trabajadas || 0;
    } else if (d.tipo_hora === 'HS VAC') {
      // Mismo criterio que presentismo-carga.js: Tango no completa "trabajadas" en HS VAC,
      // el dato real está en "reales".
      f.hs_vac_trabajadas += +d.hs_reales    || 0;
      f.hs_vac_esperadas  += +d.hs_esperadas || 0;
    }
  });

  // Días presente / ausente sin justificar — un día a la vez, mirando todas sus filas juntas
  // (mismo criterio que calcularDia en presentismo-personas.js, pero solo para el conteo).
  porLegajoFecha.forEach((filasDia, key) => {
    const legajo = key.slice(0, key.indexOf('|'));
    const f = fila(legajo);
    const hsReales  = filasDia.reduce((s, d) => s + (+d.hs_reales || 0), 0);
    const hsnor     = filasDia.filter(d => d.tipo_hora === 'HSNOR');
    const hsEspDia  = hsnor.reduce((s, d) => s + (+d.hs_esperadas    || 0), 0);
    const hsJustDia = hsnor.reduce((s, d) => s + (+d.hs_justificadas || 0), 0);
    if (hsReales > 0) f.dias_presentes++;
    else if (hsEspDia > 0 && hsJustDia <= 0) f.dias_ausentes_nojust++;
  });

  rawAusGroup.forEach(e => {
    if (e.fecha < fechaDesde || e.fecha > fechaHasta) return;
    if (e.periodo && e.periodo !== periodo) return; // ver comentario arriba sobre filas mal etiquetadas
    if (CODIGOS_EXCLUIDOS_AUSENTISMO.has(e.codigo_justificacion)) return;
    fila(e.legajo).hs_ausencias += (+e.minutos || 0) / 60;
  });

  return [...porLegajo.values()];
}

// ── Métricas de un grupo (quincenal o mensual) para todos los períodos ────────
// También sirve para UNA sola persona (Horas y Presentismo → Ficha individual): basta con
// pasarle las filas de ese único legajo, no asume nada sobre cuántas personas hay en "rows".
// Las vacaciones trabajadas (HS VAC) son horas trabajadas y pagadas igual que las normales —
// sin sumarlas, "trabajadas" queda por debajo del total pagado que muestra Cruce de Horas.
const hsTrabajadas = d => (+d.hs_normales || 0) + (+d.hs_vac_trabajadas || 0);
const hsEsperadas  = d => (+d.hs_esperadas || 0) + (+d.hs_vac_esperadas || 0);

export function calcularGrupo(rows, allPeriodos, activosSet) {
  // Agrupado por (periodo, empresa) para los gráficos de tendencia
  const agg = new Map();
  rows.forEach(d => {
    const emp = EMPRESAS.includes(d.empresa) ? d.empresa : null;
    if (!emp) return;
    const k = `${d.periodo}|${emp}`;
    if (!agg.has(k)) agg.set(k, { hs_norm: 0, hs_just: 0, hs_nojust: 0, hs_esp: 0, ext50: 0, ext100: 0, hs_aus: 0 });
    const v = agg.get(k);
    v.hs_norm   += hsTrabajadas(d);
    v.ext50     += +d.hs_extra50   || 0;
    v.ext100    += +d.hs_extra100  || 0;
    v.hs_esp    += +d.hs_vac_esperadas || 0;
    if ((+d.hs_esperadas || 0) > 0) {
      v.hs_just   += +d.hs_justificadas    || 0;
      v.hs_nojust += +d.hs_no_justificadas || 0;
      v.hs_esp    += +d.hs_esperadas       || 0;
      v.hs_aus    += +d.hs_ausencias       || 0;
    }
  });
  const get = (p, e, f) => agg.get(`${p}|${e}`)?.[f] || 0;

  const horasCIM = allPeriodos.map(p => Math.round(get(p, 'CIMOMET', 'hs_norm')));
  const horasCOM = allPeriodos.map(p => Math.round(get(p, 'COMOING', 'hs_norm')));
  const horasTot = allPeriodos.map((_, i) => horasCIM[i] + horasCOM[i]);
  const ausPct   = allPeriodos.map(p => {
    let trab = 0, aus = 0;
    EMPRESAS.forEach(e => { trab += get(p, e, 'hs_norm'); aus += get(p, e, 'hs_aus'); });
    return trab + aus > 0 ? +((aus / (trab + aus)) * 100).toFixed(1) : 0;
  });
  const espTot   = allPeriodos.map(p => Math.round(EMPRESAS.reduce((s, e) => s + get(p, e, 'hs_esp'), 0)));
  const ext50Tot = allPeriodos.map(p => Math.round(EMPRESAS.reduce((s, e) => s + get(p, e, 'ext50'), 0)));
  const ext100Tot= allPeriodos.map(p => Math.round(EMPRESAS.reduce((s, e) => s + get(p, e, 'ext100'), 0)));

  // Totales globales
  const validRows = rows.filter(d => EMPRESAS.includes(d.empresa));
  const totalTrab = validRows.reduce((s, d) => s + hsTrabajadas(d), 0);
  const totalAus  = validRows.reduce((s, d) =>
    (+d.hs_esperadas || 0) > 0 ? s + (+d.hs_ausencias || 0) : s, 0);
  const totalEsp  = validRows.reduce((s, d) => s + hsEsperadas(d), 0);
  const totalExt50 = validRows.reduce((s, d) => s + (+d.hs_extra50 || 0), 0);
  const totalExt100= validRows.reduce((s, d) => s + (+d.hs_extra100 || 0), 0);
  const totalDiasPres   = validRows.reduce((s, d) =>
    (+d.hs_esperadas || 0) > 0 ? s + (+d.dias_presentes || 0) : s, 0);
  const totalDiasNojust = validRows.reduce((s, d) =>
    (+d.hs_esperadas || 0) > 0 ? s + (+d.dias_ausentes_nojust || 0) : s, 0);

  const idxAus = totalTrab + totalAus > 0
    ? ((totalAus / (totalTrab + totalAus)) * 100).toFixed(1) : '—';
  const cumplimiento = totalEsp > 0
    ? ((totalTrab / totalEsp) * 100).toFixed(1) : '—';
  const presGlobal = totalDiasPres + totalDiasNojust > 0
    ? ((totalDiasPres / (totalDiasPres + totalDiasNojust)) * 100).toFixed(1) : '—';

  const colorIdx   = +idxAus < 5 ? '#16a34a' : +idxAus < 8 ? '#d97706' : '#dc2626';
  const colorCumpl = +cumplimiento >= 95 ? '#16a34a' : +cumplimiento >= 90 ? '#d97706' : '#dc2626';
  const colorPres  = +presGlobal  >= 95 ? '#16a34a' : +presGlobal  >= 90 ? '#d97706' : '#dc2626';

  const totCIM = horasCIM.reduce((s, v) => s + v, 0);
  const totCOM = horasCOM.reduce((s, v) => s + v, 0);
  const legajosPeriodo  = new Set(validRows.map(d => d.legajo));
  const empleadosPeriodo = legajosPeriodo.size;
  const empleadosActivos = activosSet
    ? [...legajosPeriodo].filter(l => activosSet.has(String(l))).length
    : empleadosPeriodo;
  const empleadosDesvinculados = empleadosPeriodo - empleadosActivos;

  return {
    horasCIM, horasCOM, horasTot, ausPct,
    espTot, ext50Tot, ext100Tot,
    totalTrab, totalAus, totalEsp, totalExt50, totalExt100,
    idxAus, cumplimiento, presGlobal,
    colorIdx, colorCumpl, colorPres,
    totCIM, totCOM, totGen: totCIM + totCOM,
    empleadosPeriodo, empleadosActivos, empleadosDesvinculados,
    totalDiasPres,
  };
}

// ── Resumen de tardanzas/salidas anticipadas para un grupo, en un conjunto de períodos ──
export function resumenTardanzas(rawTardGroup, periodos) {
  const filas = rawTardGroup.filter(t => periodos.includes(t.periodo));
  const diasTarde    = filas.filter(t => t.tipo === 'tarde').length;
  const minTarde      = filas.filter(t => t.tipo === 'tarde').reduce((s, t) => s + (+t.minutos || 0), 0);
  const diasTemprano  = filas.filter(t => t.tipo === 'temprano').length;
  const minTemprano   = filas.filter(t => t.tipo === 'temprano').reduce((s, t) => s + (+t.minutos || 0), 0);
  // Un día con tarde Y temprano cuenta una sola vez como "día con incidente"
  const diasConIncidente = new Set(filas.map(t => `${t.legajo}|${t.fecha}`)).size;
  return { diasTarde, minTarde, diasTemprano, minTemprano, diasConIncidente };
}

// ── Composición del ausentismo por motivo, período a período (gráfico apilado) ───────────
export function ausentismoPorCategoriaPeriodo(rawAusGroup, allPeriodos, mapaAusencias) {
  const porPeriodo = new Map(allPeriodos.map(p => [p, Object.fromEntries(CATEGORIAS_TABLA.map(c => [c, 0]))]));
  rawAusGroup.forEach(e => {
    if (CODIGOS_EXCLUIDOS_AUSENTISMO.has(e.codigo_justificacion)) return;
    const acc = porPeriodo.get(e.periodo);
    if (!acc) return;
    const cat = categoriaAusencia(e.codigo_justificacion, mapaAusencias);
    acc[cat] += (+e.minutos || 0) / 60;
  });
  return Object.fromEntries(CATEGORIAS_TABLA.map(c => [c, allPeriodos.map(p => Math.round(porPeriodo.get(p)[c]))]));
}

// Mismo agrupamiento que ausentismoPorCategoriaPeriodo, pero sin perder el detalle de motivo
// puntual (descripcion_justificacion, ej. "Enf-Digestiva") — se usa solo para el tooltip del
// gráfico "Ausentismo por motivo", que además del total de la categoría muestra el desglose.
export function ausentismoDetalleMotivoPeriodo(rawAusGroup, allPeriodos, mapaAusencias) {
  const porPeriodo = new Map(allPeriodos.map(p => [p, new Map()])); // periodo -> categoria -> descripcion -> horas
  rawAusGroup.forEach(e => {
    if (CODIGOS_EXCLUIDOS_AUSENTISMO.has(e.codigo_justificacion)) return;
    const porCategoria = porPeriodo.get(e.periodo);
    if (!porCategoria) return;
    const cat = categoriaAusencia(e.codigo_justificacion, mapaAusencias);
    if (!porCategoria.has(cat)) porCategoria.set(cat, new Map());
    const porDescripcion = porCategoria.get(cat);
    const desc = (e.descripcion_justificacion || e.codigo_justificacion || 'Sin detalle').trim();
    porDescripcion.set(desc, (porDescripcion.get(desc) || 0) + (+e.minutos || 0) / 60);
  });
  const resultado = {};
  allPeriodos.forEach(p => {
    resultado[p] = {};
    for (const [cat, porDescripcion] of porPeriodo.get(p).entries()) {
      resultado[p][cat] = [...porDescripcion.entries()]
        .map(([desc, horas]) => ({ desc, horas: Math.round(horas) }))
        .filter(x => x.horas > 0)
        .sort((a, b) => b.horas - a.horas);
    }
  });
  return resultado;
}

// Total de horas trabajadas = normales + extras 50% + extras 100%, con los MISMOS valores
// redondeados que muestran las tarjetas del desglose, así el total siempre coincide a la
// vista con la suma de las tres. La de 50% sale del detalle diario (semana + sábados).
export function totalHorasTrabajadas(totalNormales, ext50Desglose, totalExt100) {
  return Math.round(totalNormales) + ext50Desglose.semana + ext50Desglose.sabado + Math.round(totalExt100);
}
