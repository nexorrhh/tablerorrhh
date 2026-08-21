import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';
import { obtenerClasificacionPuestos, tipoPuesto } from '../data/clasificacion-puestos.js';
import { obtenerClasificacionAusencias, categoriaAusencia } from '../data/clasificacion-ausencias.js';

const HDR = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
const MESES_CORTO = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

// Columnas de "Detalle de ausentismo", en el orden en que se muestran — 4 motivos +
// lo que todavía nadie clasificó (ver Horas y Presentismo → Parametrización).
export const CATEGORIAS_TABLA = ['enfermedad', 'accidente', 'licencia', 'aviso', 'sin_aviso', 'sin_clasificar'];
export const CATEGORIA_LABEL = {
  enfermedad: 'Enfermedad', accidente: 'Accidente', licencia: 'Licencia', aviso: 'Aviso',
  sin_aviso: 'Sin aviso', sin_clasificar: 'Sin clasif.',
};
export const CATEGORIA_COLOR = {
  enfermedad: '#d97706', accidente: '#dc2626', licencia: '#0891b2', aviso: '#2563eb',
  sin_aviso: '#991b1b', sin_clasificar: '#94a3b8',
};
// VACACION y VIAJE ya tienen tratamiento propio en presentismo-carga.js (no cuentan como
// ausentismo) — igual quedan como eventos 'ausente' en rrhh_tardanzas_salidas (los necesita
// el badge de "Vacaciones" en Por persona), así que hay que excluirlos acá explícitamente.
// AUS_FER (feriado) tampoco es una falta de la persona: la planta cierra por feriado.
export const CODIGOS_EXCLUIDOS_AUSENTISMO = new Set(['VACACION', 'VIAJE', 'AUS_FER']);

// Supabase/PostgREST devuelve como máximo 1000 filas por request (aunque no se pida límite).
// rrhh_horas_detalle puede superar eso ampliamente, así que hay que paginar con offset/limit
// hasta agotar los resultados; una sola llamada trunca en silencio (sin error) y deja afuera
// lo que venga después de la fila 1000, sin ningún orden garantizado.
export async function fetchTodasFilas(url) {
  const PAGE = 1000;
  let offset = 0, out = [];
  for (;;) {
    const sep = url.includes('?') ? '&' : '?';
    const r = await fetch(`${url}${sep}limit=${PAGE}&offset=${offset}`, { headers: HDR });
    if (!r.ok) break;
    const rows = await r.json();
    out = out.concat(rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

export const EMPRESAS  = ['CIMOMET', 'COMOING'];
export const EMP_LABEL = { CIMOMET: 'Cimomet', COMOING: 'Co.mo.ing' };
const EMP_COLOR = { CIMOMET: 'var(--color-primario)', COMOING: '#0d9488' };

export function fmtPeriodo(p) { const [y, m] = p.split('-'); return `${MESES_CORTO[+m - 1]} ${y}`; }
export function fmtNum(n)     { return Math.round(n || 0).toLocaleString('es-AR'); }
export function fmtFecha(f) {
  if (!f) return '—';
  const [y, m, d] = f.slice(0, 10).split('-');
  return `${+d} ${MESES_CORTO[+m - 1]} ${y}`;
}

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

const EXT50_TIPOS = new Set(['HSEXT', 'HSEXT50', 'HS 50 VAC']);
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

// Gráficos principales (viven toda la vida del componente)
let graficosActivos = [];
// Gráficos de departamento (se recrean al cambiar período)
const graficosDepActivos = {};

function destruirGraficos() {
  [...graficosActivos, ...Object.values(graficosDepActivos).flat()]
    .forEach(g => { try { g.destroy(); } catch {} });
  graficosActivos = [];
  Object.keys(graficosDepActivos).forEach(k => delete graficosDepActivos[k]);
}

// ── Métricas de un grupo (quincenal o mensual) para todos los períodos ────────
// También sirve para UNA sola persona (Horas y Presentismo → Ficha individual): basta con
// pasarle las filas de ese único legajo, no asume nada sobre cuántas personas hay en "rows".
export function calcularGrupo(rows, allPeriodos, activosSet) {
  // Agrupado por (periodo, empresa) para los gráficos de tendencia
  const agg = new Map();
  rows.forEach(d => {
    const emp = EMPRESAS.includes(d.empresa) ? d.empresa : null;
    if (!emp) return;
    const k = `${d.periodo}|${emp}`;
    if (!agg.has(k)) agg.set(k, { hs_norm: 0, hs_just: 0, hs_nojust: 0, hs_esp: 0, ext50: 0, ext100: 0, hs_aus: 0 });
    const v = agg.get(k);
    v.hs_norm   += +d.hs_normales  || 0;
    v.ext50     += +d.hs_extra50   || 0;
    v.ext100    += +d.hs_extra100  || 0;
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
  const totalTrab = validRows.reduce((s, d) => s + (+d.hs_normales || 0), 0);
  const totalAus  = validRows.reduce((s, d) =>
    (+d.hs_esperadas || 0) > 0 ? s + (+d.hs_ausencias || 0) : s, 0);
  const totalEsp  = validRows.reduce((s, d) => s + (+d.hs_esperadas || 0), 0);
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

// ── Estadísticas por departamento para un período concreto ────────────────────
function buildDepStats(rawGroup, periodo) {
  const rows = rawGroup.filter(d => d.periodo === periodo && EMPRESAS.includes(d.empresa));
  const porDep = new Map();
  rows.forEach(d => {
    const dep = d.departamento || 'Sin sector';
    if (!porDep.has(dep)) porDep.set(dep, { diasPres: 0, diasNojust: 0, hsNorm: 0, hsEsp: 0, ext50: 0, ext100: 0, count: 0 });
    const x = porDep.get(dep);
    x.diasPres   += +d.dias_presentes       || 0;
    x.diasNojust += +d.dias_ausentes_nojust || 0;
    x.hsNorm     += +d.hs_normales          || 0;
    x.hsEsp      += +d.hs_esperadas         || 0;
    x.ext50      += +d.hs_extra50           || 0;
    x.ext100     += +d.hs_extra100          || 0;
    x.count++;
  });
  return [...porDep.entries()]
    .map(([dep, v]) => ({
      dep,
      pres:   (v.diasPres + v.diasNojust) > 0 ? +((v.diasPres / (v.diasPres + v.diasNojust)) * 100).toFixed(1) : 100,
      cumpl:  v.hsEsp > 0 ? +(v.hsNorm / v.hsEsp * 100).toFixed(1) : 100,
      ext50:  +v.ext50.toFixed(1),
      ext100: +v.ext100.toFixed(1),
      count:  v.count,
    }))
    .sort((a, b) => a.pres - b.pres);
}

// ── Tabla de detalle de ausentismo por empleado, agrupado por motivo ──────────
// El total ya no sale de hs_ausencias (agregado mensual) — sale de sumar los propios
// eventos de ausencia del período, clasificados por motivo. Así el total de la fila
// SIEMPRE cierra con la suma de sus columnas (antes podía haber un desvío chico entre
// hs_ausencias y hs_justificadas/no_justificadas, calculados por caminos distintos).
function tablaDetalleAusentismo(rawGroup, rawAusGroup, mapaAusencias, periodo, filtroEmpresa, activosSet) {
  const personaPorLegajo = new Map();
  rawGroup.forEach(d => {
    if (d.periodo !== periodo || !EMPRESAS.includes(d.empresa)) return;
    if (filtroEmpresa && d.empresa !== filtroEmpresa) return;
    personaPorLegajo.set(String(d.legajo), {
      legajo:  d.legajo,
      nombre:  `${d.apellido || ''}, ${d.nombre || ''}`.trim().replace(/^,\s*/, ''),
      sector:  d.departamento || '—',
      empresa: d.empresa,
      activo:  !activosSet || activosSet.has(String(d.legajo)),
    });
  });

  const acumPorLegajo = new Map(); // legajo -> { enfermedad, accidente, aviso, sin_aviso, sin_clasificar }
  rawAusGroup.filter(e => e.periodo === periodo && !CODIGOS_EXCLUIDOS_AUSENTISMO.has(e.codigo_justificacion)).forEach(e => {
    const key = String(e.legajo);
    const persona = personaPorLegajo.get(key);
    if (!persona) return; // fuera del filtro de empresa, o sin fila en rrhh_horas_mensual ese período
    if (!acumPorLegajo.has(key)) acumPorLegajo.set(key, Object.fromEntries(CATEGORIAS_TABLA.map(c => [c, 0])));
    const cat = categoriaAusencia(e.codigo_justificacion, mapaAusencias);
    acumPorLegajo.get(key)[cat] += (+e.minutos || 0) / 60;
  });

  const filas = [...acumPorLegajo.entries()]
    .map(([legajo, cats]) => {
      const total = CATEGORIAS_TABLA.reduce((s, c) => s + cats[c], 0);
      return { ...personaPorLegajo.get(legajo), ...cats, total };
    })
    .filter(d => Math.round(d.total) > 0)
    .sort((a, b) => b.total - a.total);

  if (!filas.length) return '<p style="padding:16px;color:var(--color-texto-sec);font-size:0.85rem">Sin ausentismo registrado para el filtro seleccionado.</p>';

  const totalesCol = Object.fromEntries(CATEGORIAS_TABLA.map(c => [c, filas.reduce((s, d) => s + d[c], 0)]));
  const totalGeneral = CATEGORIAS_TABLA.reduce((s, c) => s + totalesCol[c], 0);

  const porSector = new Map();
  filas.forEach(d => {
    if (!porSector.has(d.sector)) porSector.set(d.sector, { count: 0, total: 0 });
    const s = porSector.get(d.sector);
    s.total += d.total; s.count++;
  });

  let html = '';
  [...porSector.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .forEach(([sector, st]) => {
      html += `<tr class="pind__det-sector-row"><td class="pind__det-sector" colspan="${3 + CATEGORIAS_TABLA.length + 1}">${sector}<span class="pind__det-sector-cnt">${st.count} empleado${st.count !== 1 ? 's' : ''} · ${fmtNum(st.total)}h total</span></td></tr>`;
      filas.filter(d => d.sector === sector).forEach(d => {
        const expandId = `pind-det-exp-${d.legajo}-${periodo.replace(/-/g, '')}`;
        const rowStyle = d.activo ? '' : ' style="opacity:0.55"';
        const desvincTag = d.activo ? '' : '<span class="pind__tag-desvinc" title="Ya no figura como activo en el plantel">desvinculado</span>';
        html += `<tr class="pind__det-emp-row${d.activo ? '' : ' pind__det-emp-row--inactivo'}" data-legajo="${d.legajo}" data-periodo="${periodo}" data-expand="${expandId}" title="Clic para ver días"${rowStyle}>
          <td class="pind__res-td" style="width:28px;font-size:0.75rem"><span class="pind__det-expand-icon">▸</span></td>
          <td class="pind__res-td"><b style="font-size:0.875rem">${d.nombre || d.legajo}</b><span style="margin-left:6px;font-size:0.72rem;color:var(--color-texto-sec)">${d.legajo}</span>${desvincTag}</td>
          <td class="pind__res-td" style="font-size:0.8rem;color:${EMP_COLOR[d.empresa]};white-space:nowrap">${EMP_LABEL[d.empresa] || d.empresa}</td>
          ${CATEGORIAS_TABLA.map(c => `<td class="pind__res-td pind__res-td--num" style="color:${Math.round(d[c]) > 0 ? CATEGORIA_COLOR[c] : 'var(--color-texto-sec)'}">${Math.round(d[c]) > 0 ? fmtNum(d[c]) : '—'}</td>`).join('')}
          <td class="pind__res-td pind__res-td--num"><b>${fmtNum(d.total)}</b></td>
        </tr>
        <tr class="pind__det-expand-row" id="${expandId}" hidden>
          <td colspan="${3 + CATEGORIAS_TABLA.length + 1}" class="pind__det-expand-celda"><em class="pind__det-expand-loading">Cargando días…</em></td>
        </tr>`;
      });
    });

  return `<table class="pind__res-tabla">
    <thead><tr>
      <th class="pind__res-th">#</th>
      <th class="pind__res-th">Empleado</th>
      <th class="pind__res-th">Empresa</th>
      ${CATEGORIAS_TABLA.map(c => `<th class="pind__res-th" style="text-align:right">${CATEGORIA_LABEL[c]}</th>`).join('')}
      <th class="pind__res-th" style="text-align:right">Total</th>
    </tr></thead>
    <tbody>${html}</tbody>
    <tfoot><tr>
      <td class="pind__res-tf" colspan="3">Total (${filas.length} empleados)</td>
      ${CATEGORIAS_TABLA.map(c => `<td class="pind__res-tf pind__res-tf--num">${fmtNum(totalesCol[c])}</td>`).join('')}
      <td class="pind__res-tf pind__res-tf--num">${fmtNum(totalGeneral)}</td>
    </tr></tfoot>
  </table>`;
}

// ── Tabla de detalle de tardanzas / salidas anticipadas, agrupada por empleado
// (mismo patrón que tablaDetalleAusentismo: una fila por persona, click para ver sus eventos) ──
function tablaDetalleTardanzas(rawGroup, rawTardGroup, periodo, filtroEmpresa, activosSet) {
  const personaPorLegajo = new Map();
  rawGroup.forEach(d => {
    if (d.periodo !== periodo) return;
    personaPorLegajo.set(String(d.legajo), {
      nombre:  `${d.apellido || ''}, ${d.nombre || ''}`.trim().replace(/^,\s*/, ''),
      sector:  d.departamento || '—',
      empresa: d.empresa,
    });
  });

  const eventosPorLegajo = new Map();
  rawTardGroup.filter(t => t.periodo === periodo).forEach(t => {
    const key = String(t.legajo);
    if (!eventosPorLegajo.has(key)) eventosPorLegajo.set(key, []);
    eventosPorLegajo.get(key).push({
      tipo: t.tipo, fecha: t.fecha, minutos: +t.minutos || 0,
      justificacion: t.descripcion_justificacion || '',
    });
  });

  const filas = [...eventosPorLegajo.entries()]
    .map(([legajo, eventos]) => {
      const p = personaPorLegajo.get(legajo);
      if (!p || (filtroEmpresa && p.empresa !== filtroEmpresa)) return null;
      const tarde    = eventos.filter(e => e.tipo === 'tarde');
      const temprano = eventos.filter(e => e.tipo === 'temprano');
      return {
        legajo, nombre: p.nombre, sector: p.sector, empresa: p.empresa,
        diasTarde: tarde.length, diasTemprano: temprano.length,
        eventos: [...eventos].sort((a, b) => a.fecha.localeCompare(b.fecha)),
        activo: !activosSet || activosSet.has(legajo),
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.diasTarde + b.diasTemprano) - (a.diasTarde + a.diasTemprano));

  if (!filas.length) return '<p style="padding:16px;color:var(--color-texto-sec);font-size:0.85rem">Sin tardanzas ni salidas anticipadas para el filtro seleccionado.</p>';

  const totalTarde    = filas.reduce((s, d) => s + d.diasTarde, 0);
  const totalTemprano = filas.reduce((s, d) => s + d.diasTemprano, 0);

  const porSector = new Map();
  filas.forEach(d => {
    if (!porSector.has(d.sector)) porSector.set(d.sector, { tarde: 0, temprano: 0, count: 0 });
    const s = porSector.get(d.sector);
    s.tarde += d.diasTarde; s.temprano += d.diasTemprano; s.count++;
  });

  let html = '';
  [...porSector.entries()]
    .sort((a, b) => (b[1].tarde + b[1].temprano) - (a[1].tarde + a[1].temprano))
    .forEach(([sector, st]) => {
      html += `<tr class="pind__det-sector-row"><td class="pind__det-sector" colspan="6">${sector}<span class="pind__det-sector-cnt">${st.count} empleado${st.count !== 1 ? 's' : ''} · ${st.tarde} tarde · ${st.temprano} temprano</span></td></tr>`;
      filas.filter(d => d.sector === sector).forEach(d => {
        const expandId = `pind-tard-exp-${d.legajo}-${periodo.replace(/-/g, '')}`;
        const rowStyle = d.activo ? '' : ' style="opacity:0.55"';
        const desvincTag = d.activo ? '' : '<span class="pind__tag-desvinc" title="Ya no figura como activo en el plantel">desvinculado</span>';
        html += `<tr class="pind__det-emp-row" data-expand="${expandId}" title="Clic para ver el detalle"${rowStyle}>
          <td class="pind__res-td" style="width:28px;font-size:0.75rem"><span class="pind__det-expand-icon">▸</span></td>
          <td class="pind__res-td"><b style="font-size:0.875rem">${d.nombre || d.legajo}</b><span style="margin-left:6px;font-size:0.72rem;color:var(--color-texto-sec)">${d.legajo}</span>${desvincTag}</td>
          <td class="pind__res-td" style="font-size:0.8rem;color:${EMP_COLOR[d.empresa]};white-space:nowrap">${EMP_LABEL[d.empresa] || d.empresa}</td>
          <td class="pind__res-td pind__res-td--num" style="color:${d.diasTarde > 0 ? '#d97706' : 'var(--color-texto-sec)'}">${d.diasTarde > 0 ? d.diasTarde : '—'}</td>
          <td class="pind__res-td pind__res-td--num" style="color:${d.diasTemprano > 0 ? '#d97706' : 'var(--color-texto-sec)'}">${d.diasTemprano > 0 ? d.diasTemprano : '—'}</td>
          <td class="pind__res-td pind__res-td--num"><b>${d.diasTarde + d.diasTemprano}</b></td>
        </tr>
        <tr class="pind__det-expand-row" id="${expandId}" hidden>
          <td colspan="6" class="pind__det-expand-celda">${renderEventosTardanza(d.eventos)}</td>
        </tr>`;
      });
    });

  return `<table class="pind__res-tabla">
    <thead><tr>
      <th class="pind__res-th">#</th>
      <th class="pind__res-th">Empleado</th>
      <th class="pind__res-th">Empresa</th>
      <th class="pind__res-th" style="text-align:right">Tardanzas</th>
      <th class="pind__res-th" style="text-align:right">Salidas ant.</th>
      <th class="pind__res-th" style="text-align:right">Total</th>
    </tr></thead>
    <tbody>${html}</tbody>
    <tfoot><tr>
      <td class="pind__res-tf" colspan="3">Total (${filas.length} empleados)</td>
      <td class="pind__res-tf pind__res-tf--num">${totalTarde}</td>
      <td class="pind__res-tf pind__res-tf--num">${totalTemprano}</td>
      <td class="pind__res-tf pind__res-tf--num">${totalTarde + totalTemprano}</td>
    </tr></tfoot>
  </table>`;
}

// ── Desglose de eventos (tardanzas/salidas) de un empleado dentro del período ─
export function renderEventosTardanza(eventos) {
  if (!eventos.length) return '<em style="padding:10px 14px;display:block;color:var(--color-texto-sec);font-size:0.8rem">Sin eventos.</em>';
  return `<table class="pind__dias-tabla">
    <thead><tr>
      <th class="pind__dias-th">Fecha</th>
      <th class="pind__dias-th">Tipo</th>
      <th class="pind__dias-th pind__dias-th--num">Minutos</th>
      <th class="pind__dias-th">Justificación</th>
    </tr></thead>
    <tbody>${eventos.map(e => {
      const badge = e.tipo === 'tarde'
        ? '<span class="venc__badge venc__badge--naranja">Tarde</span>'
        : '<span class="venc__badge venc__badge--amarillo">Salida ant.</span>';
      return `<tr>
        <td class="pind__dias-td pind__dias-td--fecha">${fmtFecha(e.fecha)}</td>
        <td class="pind__dias-td">${badge}</td>
        <td class="pind__dias-td pind__dias-td--num">${e.minutos} min</td>
        <td class="pind__dias-td">${e.justificacion || '—'}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}

// ── Export a Excel: tardanzas y salidas anticipadas (uno o todos los períodos) ──
function datosTardanzasExport(rawGroup, rawTardGroup, periodos) {
  const personaPorLegajoPeriodo = new Map();
  rawGroup.forEach(d => {
    if (!periodos.includes(d.periodo)) return;
    personaPorLegajoPeriodo.set(`${d.legajo}|${d.periodo}`, {
      nombre:  `${d.apellido || ''}, ${d.nombre || ''}`.trim().replace(/^,\s*/, ''),
      sector:  d.departamento || '—',
      empresa: d.empresa,
    });
  });

  const porEmpleado = [];
  const porSectorPeriodo = new Map();
  const porPersonaTotal = new Map();

  rawTardGroup.filter(t => periodos.includes(t.periodo)).forEach(t => {
    const p = personaPorLegajoPeriodo.get(`${t.legajo}|${t.periodo}`);
    if (!p) return;
    const minutos = +t.minutos || 0;
    const tipoLabel = t.tipo === 'tarde' ? 'Tarde' : 'Salida anticipada';

    porEmpleado.push([
      fmtPeriodo(t.periodo), p.sector, t.legajo, p.nombre, EMP_LABEL[p.empresa] || p.empresa,
      tipoLabel, fmtFecha(t.fecha), minutos, t.descripcion_justificacion || '',
    ]);

    const keySec = `${t.periodo}|${p.sector}|${t.tipo}`;
    if (!porSectorPeriodo.has(keySec)) porSectorPeriodo.set(keySec, { periodo: t.periodo, sector: p.sector, tipo: tipoLabel, dias: 0, minutos: 0 });
    const s = porSectorPeriodo.get(keySec);
    s.dias++; s.minutos += minutos;

    if (!porPersonaTotal.has(t.legajo)) porPersonaTotal.set(t.legajo, { legajo: t.legajo, nombre: p.nombre, sector: p.sector, diasTarde: 0, minTarde: 0, diasTemprano: 0, minTemprano: 0 });
    const pp = porPersonaTotal.get(t.legajo);
    if (t.tipo === 'tarde') { pp.diasTarde++; pp.minTarde += minutos; } else { pp.diasTemprano++; pp.minTemprano += minutos; }
  });

  porEmpleado.sort((a, b) => a[0].localeCompare(b[0]) || b[7] - a[7]);

  const resumen = [...porSectorPeriodo.values()]
    .sort((a, b) => a.periodo.localeCompare(b.periodo) || b.minutos - a.minutos)
    .map(s => [fmtPeriodo(s.periodo), s.sector, s.tipo, s.dias, s.minutos]);

  const ranking = [...porPersonaTotal.values()]
    .sort((a, b) => (b.diasTarde + b.diasTemprano) - (a.diasTarde + a.diasTemprano))
    .map(p => [p.legajo, p.nombre, p.sector, p.diasTarde, p.minTarde, p.diasTemprano, p.minTemprano]);

  return { porEmpleado, resumen, ranking };
}

function exportarTardanzasExcel(rawGroup, rawTardGroup, periodos, nombreArchivo) {
  if (typeof XLSX === 'undefined') {
    alert('La librería de Excel no está disponible. Verificá la conexión a internet.');
    return;
  }
  const { porEmpleado, resumen, ranking } = datosTardanzasExport(rawGroup, rawTardGroup, periodos);
  const wb = XLSX.utils.book_new();

  const ws1 = XLSX.utils.aoa_to_sheet([
    ['Período', 'Sector', 'Legajo', 'Nombre', 'Empresa', 'Tipo', 'Fecha', 'Minutos', 'Justificación'],
    ...porEmpleado,
  ]);
  ws1['!cols'] = [12, 22, 10, 28, 12, 16, 12, 10, 24].map(w => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws1, 'Detalle por empleado');

  const ws2 = XLSX.utils.aoa_to_sheet([
    ['Período', 'Sector', 'Tipo', 'Días', 'Minutos'],
    ...resumen,
  ]);
  ws2['!cols'] = [12, 22, 16, 8, 10].map(w => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws2, 'Resumen por sector');

  const ws3 = XLSX.utils.aoa_to_sheet([
    ['Legajo', 'Nombre', 'Sector', 'Días tarde', 'Min. tarde', 'Días salida ant.', 'Min. salida ant.'],
    ...ranking,
  ]);
  ws3['!cols'] = [10, 28, 22, 12, 12, 16, 16].map(w => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws3, 'Ranking por persona');

  XLSX.writeFile(wb, nombreArchivo);
}

// ── Export a Excel: ausentismo por sector (uno o todos los períodos) ─────────
function datosAusentismoExport(rawGroup, rawAusGroup, mapaAusencias, activosSet, periodos) {
  const porEmpleado = [];
  const porSectorPeriodo = new Map(); // `periodo|sector` → acumulado

  periodos.forEach(periodo => {
    const personaPorLegajo = new Map();
    rawGroup.filter(d => d.periodo === periodo && EMPRESAS.includes(d.empresa)).forEach(d => {
      personaPorLegajo.set(String(d.legajo), {
        sector: d.departamento || '—',
        nombre: `${d.apellido || ''}, ${d.nombre || ''}`.trim().replace(/^,\s*/, ''),
        empresa: d.empresa,
        activo: !activosSet || activosSet.has(String(d.legajo)),
      });
    });

    const acumPorLegajo = new Map();
    rawAusGroup.filter(e => e.periodo === periodo && !CODIGOS_EXCLUIDOS_AUSENTISMO.has(e.codigo_justificacion)).forEach(e => {
      const key = String(e.legajo);
      if (!personaPorLegajo.has(key)) return;
      if (!acumPorLegajo.has(key)) acumPorLegajo.set(key, Object.fromEntries(CATEGORIAS_TABLA.map(c => [c, 0])));
      const cat = categoriaAusencia(e.codigo_justificacion, mapaAusencias);
      acumPorLegajo.get(key)[cat] += (+e.minutos || 0) / 60;
    });

    acumPorLegajo.forEach((cats, legajo) => {
      const total = CATEGORIAS_TABLA.reduce((s, c) => s + cats[c], 0);
      if (Math.round(total) <= 0) return;
      const p = personaPorLegajo.get(legajo);

      porEmpleado.push([
        fmtPeriodo(periodo), p.sector, legajo, p.nombre, EMP_LABEL[p.empresa] || p.empresa,
        p.activo ? 'Sí' : 'No',
        ...CATEGORIAS_TABLA.map(c => Math.round(cats[c] * 100) / 100),
        Math.round(total * 100) / 100,
      ]);

      const key = `${periodo}|${p.sector}`;
      if (!porSectorPeriodo.has(key)) {
        porSectorPeriodo.set(key, { periodo, sector: p.sector, count: 0, ...Object.fromEntries(CATEGORIAS_TABLA.map(c => [c, 0])) });
      }
      const s = porSectorPeriodo.get(key);
      CATEGORIAS_TABLA.forEach(c => { s[c] += cats[c]; });
      s.count++;
    });
  });

  const totalFila = fila => CATEGORIAS_TABLA.reduce((s, c, i) => s + fila[6 + i], 0);
  porEmpleado.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]) || totalFila(b) - totalFila(a));

  const resumen = [...porSectorPeriodo.values()]
    .sort((a, b) => a.periodo.localeCompare(b.periodo) || CATEGORIAS_TABLA.reduce((s, c) => s + b[c] - a[c], 0))
    .map(s => [
      fmtPeriodo(s.periodo), s.sector, s.count,
      ...CATEGORIAS_TABLA.map(c => Math.round(s[c] * 100) / 100),
      Math.round(CATEGORIAS_TABLA.reduce((sum, c) => sum + s[c], 0) * 100) / 100,
    ]);

  return { porEmpleado, resumen };
}

function exportarAusentismoExcel(rawGroup, rawAusGroup, mapaAusencias, activosSet, periodos, nombreArchivo) {
  if (typeof XLSX === 'undefined') {
    alert('La librería de Excel no está disponible. Verificá la conexión a internet.');
    return;
  }
  const { porEmpleado, resumen } = datosAusentismoExport(rawGroup, rawAusGroup, mapaAusencias, activosSet, periodos);
  const wb = XLSX.utils.book_new();

  const ws1 = XLSX.utils.aoa_to_sheet([
    ['Período', 'Sector', 'Legajo', 'Nombre', 'Empresa', 'Activo', ...CATEGORIAS_TABLA.map(c => CATEGORIA_LABEL[c]), 'Total'],
    ...porEmpleado,
  ]);
  ws1['!cols'] = [12, 22, 10, 28, 12, 8, 14, 14, 14, 14, 14, 10].map(w => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws1, 'Detalle por empleado');

  const ws2 = XLSX.utils.aoa_to_sheet([
    ['Período', 'Sector', 'Empleados', ...CATEGORIAS_TABLA.map(c => CATEGORIA_LABEL[c]), 'Total'],
    ...resumen,
  ]);
  ws2['!cols'] = [12, 22, 12, 14, 14, 14, 14, 14, 10].map(w => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws2, 'Resumen por sector');

  XLSX.writeFile(wb, nombreArchivo);
}

// ── Desglose diario de un empleado, por motivo de ausencia ────────────────────
export function renderDias(dias, mapaAusencias) {
  if (!dias.length) return '<em style="padding:10px 14px;display:block;color:var(--color-texto-sec);font-size:0.8rem">Sin días con ausentismo en este período.</em>';
  return `<table class="pind__dias-tabla">
    <thead><tr>
      <th class="pind__dias-th">Fecha</th>
      <th class="pind__dias-th">Motivo</th>
      <th class="pind__dias-th pind__dias-th--num">Horas</th>
    </tr></thead>
    <tbody>${dias.map(d => {
      const horas = (+d.minutos || 0) / 60;
      const cat   = categoriaAusencia(d.codigo_justificacion, mapaAusencias);
      return `<tr>
        <td class="pind__dias-td pind__dias-td--fecha">${fmtFecha(d.fecha)}</td>
        <td class="pind__dias-td" style="color:${CATEGORIA_COLOR[cat]};font-weight:600" title="${d.descripcion_justificacion || ''}">${CATEGORIA_LABEL[cat]}</td>
        <td class="pind__dias-td pind__dias-td--num">${fmtNum(horas)}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}

// ── HTML de la sección quincenal o mensual ────────────────────────────────────
function htmlSeccion(g, allPeriodos, id, titulo, acento) {
  const anios = [...new Set(allPeriodos.map(p => p.split('-')[0]))].sort();
  const anioDefault = anios[anios.length - 1];
  const maxBar = Math.max(...g.horasTot.filter(Boolean));
  const filas  = allPeriodos.map((p, i) => {
    const bar = maxBar > 0 ? Math.round((g.horasTot[i] / maxBar) * 100) : 0;
    return `<tr>
      <td class="pind__res-td pind__res-td--per">${fmtPeriodo(p)}</td>
      <td class="pind__res-td pind__res-td--num">${fmtNum(g.horasCIM[i])}</td>
      <td class="pind__res-td pind__res-td--num">${fmtNum(g.horasCOM[i])}</td>
      <td class="pind__res-td pind__res-td--tot">
        <div class="pind__bar-cell">
          <div class="pind__bar-fill" style="width:${bar}%;background:${acento}"></div>
          <span>${fmtNum(g.horasTot[i])}</span>
        </div>
      </td>
      <td class="pind__res-td pind__res-td--num">${fmtNum(g.espTot[i])}</td>
      <td class="pind__res-td pind__res-td--aus" style="color:${g.ausPct[i] < 5 ? '#16a34a' : g.ausPct[i] < 8 ? '#d97706' : '#dc2626'}">${g.ausPct[i]}%</td>
    </tr>`;
  }).join('');

  return `
    <section class="pind__sec pind__sec--grupo">
      <div class="pind__grupo-header" style="border-left-color:${acento}">
        <div class="pind__grupo-header-izq">
          <div class="pind__grupo-ver-switch" role="tablist" aria-label="Elegir grupo de personal">
            <button class="pind__grupo-ver-btn" data-grupo-ver="q" type="button" role="tab" aria-selected="false">Quincenales — Personal de taller</button>
            <button class="pind__grupo-ver-btn" data-grupo-ver="m" type="button" role="tab" aria-selected="false">Mensuales — Personal administrativo</button>
          </div>
          <div class="pind__grupo-badges">
            ${g.empleadosActivos > 0 ? `<span class="pind__grupo-badge pind__grupo-badge--activo">${g.empleadosActivos} activos</span>` : ''}
            ${g.empleadosDesvinculados > 0 ? `<span class="pind__grupo-badge pind__grupo-badge--desvinc" title="Trabajaron este período pero ya no están activos">${g.empleadosDesvinculados} desvinculado${g.empleadosDesvinculados !== 1 ? 's' : ''}</span>` : ''}
          </div>
        </div>
        <div class="pind__periodo-filtros">
          <select class="pind__per-filtro" id="pind-anio-${id}" title="Año">
            ${anios.map(a => `<option value="${a}" ${a === anioDefault ? 'selected' : ''}>${a}</option>`).join('')}
          </select>
          <select class="pind__per-filtro" id="pind-mes-${id}" title="Mes">
            <option value="">Todos los meses</option>
            ${mesesDisponibles(allPeriodos, anioDefault).map(m => `<option value="${m}">${MESES_CORTO[+m - 1]}</option>`).join('')}
          </select>
          <select class="pind__per-filtro" id="pind-vista-${id}" title="Vista" disabled>
            <option value="mensual">Vista mensual</option>
            <option value="q1">1ra quincena</option>
            <option value="q2">2da quincena</option>
          </select>
        </div>
      </div>

      <!-- KPIs fila 1: horas -->
      <div class="pind__kpis pind__kpis--sm">
        <div class="pind__kpi">
          <span class="pind__kpi-num" id="pind-kv-trab-${id}">${fmtNum(g.totalTrab)}</span>
          <span class="pind__kpi-lbl">Horas trabajadas</span>
          <span class="pind__kpi-sub" id="pind-kv-sub-trab-${id}">${fmtPeriodo(allPeriodos[0])} – ${fmtPeriodo(allPeriodos[allPeriodos.length - 1])}</span>
        </div>
        <div class="pind__kpi">
          <span class="pind__kpi-num" id="pind-kv-esp-${id}" style="color:var(--color-texto-sec)">${fmtNum(g.totalEsp)}</span>
          <span class="pind__kpi-lbl">Horas esperadas</span>
          <span class="pind__kpi-sub">Según planilla Tango</span>
        </div>
        <div class="pind__kpi pind__kpi--dest">
          <span class="pind__kpi-num" id="pind-kv-cumpl-${id}" style="color:${g.colorCumpl}">${g.cumplimiento}%</span>
          <span class="pind__kpi-lbl">Cumplimiento de horas</span>
          <span class="pind__kpi-sub">Trabajadas / Esperadas</span>
        </div>
      </div>

      <!-- KPIs fila 2: presentismo, ausentismo, extras -->
      <div class="pind__kpis pind__kpis--sm" style="margin-top:10px">
        <div class="pind__kpi pind__kpi--clickable" id="pind-kpi-aus-${id}" title="Ver detalle de ausentismo">
          <span class="pind__kpi-num" id="pind-kv-aus-${id}" style="color:#dc2626">${fmtNum(g.totalAus)}</span>
          <span class="pind__kpi-lbl">Hs. ausentismo <span class="pind__kpi-ver">▸ Ver</span></span>
          <span class="pind__kpi-sub">Justificadas + sin justificar</span>
        </div>
        <div class="pind__kpi">
          <span class="pind__kpi-num" id="pind-kv-idx-${id}" style="color:${g.colorIdx}">${g.idxAus}%</span>
          <span class="pind__kpi-lbl">Índice de ausentismo</span>
          <span class="pind__kpi-sub">Aus / (Trab + Aus)</span>
        </div>
        <div class="pind__kpi">
          <span class="pind__kpi-num" id="pind-kv-pres-${id}" style="color:${g.colorPres}">${g.presGlobal}%</span>
          <span class="pind__kpi-lbl">Presentismo (días)</span>
          <span class="pind__kpi-sub">Días presentes / Días lab.</span>
        </div>
        <div class="pind__kpi" id="pind-kv-ext50-${id}"${g.totalExt50 > 0 ? '' : ' hidden'}>
          <span class="pind__kpi-num" style="color:#7c3aed">${fmtNum(g.totalExt50)}h</span>
          <span class="pind__kpi-lbl">Horas extra 50%</span>
          <span class="pind__kpi-sub" id="pind-kv-ext50-sub-${id}">En semana: ${fmtNum(g.ext50Semana)}h · Sábados: ${fmtNum(g.ext50Sabado)}h</span>
        </div>
        <div class="pind__kpi" id="pind-kv-ext100-${id}"${g.totalExt100 > 0 ? '' : ' hidden'}>
          <span class="pind__kpi-num" style="color:#dc2626">${fmtNum(g.totalExt100)}h</span>
          <span class="pind__kpi-lbl">Horas extra 100%</span>
        </div>
      </div>

      <!-- KPIs fila 3: tardanzas/salidas anticipadas, puntualidad -->
      <div class="pind__kpis pind__kpis--sm" style="margin-top:10px">
        <div class="pind__kpi pind__kpi--clickable" id="pind-kpi-tard-${id}" title="Ver detalle de tardanzas y salidas anticipadas">
          <span class="pind__kpi-num" id="pind-kv-tard-${id}" style="color:#d97706">${g.diasTarde + g.diasTemprano}</span>
          <span class="pind__kpi-lbl">Tardanzas y salidas anticipadas <span class="pind__kpi-ver">▸ Ver</span></span>
          <span class="pind__kpi-sub" id="pind-kv-tard-sub-${id}">${g.diasTarde} tarde${g.diasTarde !== 1 ? 's' : ''} · ${g.diasTemprano} salida${g.diasTemprano !== 1 ? 's' : ''} anticipada${g.diasTemprano !== 1 ? 's' : ''}</span>
        </div>
        <div class="pind__kpi">
          <span class="pind__kpi-num" id="pind-kv-punt-${id}" style="color:${g.colorPunt}">${g.indicePuntualidad != null ? g.indicePuntualidad + '%' : '—'}</span>
          <span class="pind__kpi-lbl">Índice de puntualidad</span>
          <span class="pind__kpi-sub">Días sin tardanza ni salida / días presentes</span>
        </div>
      </div>

      <!-- Panel tardanzas / salidas anticipadas -->
      <div class="pind__detalle" id="pind-tard-${id}" hidden>
        <div class="pind__detalle-header">
          <span class="pind__detalle-tit">Detalle de tardanzas y salidas anticipadas</span>
          <div class="pind__detalle-controles">
            <div class="pind__detalle-filtros" role="group">
              <button class="pind__det-emp pind__det-emp--activo" data-tardemp="">Todas</button>
              <button class="pind__det-emp pind__det-emp--cim" data-tardemp="CIMOMET">Cimomet</button>
              <button class="pind__det-emp pind__det-emp--com" data-tardemp="COMOING">Co.mo.ing</button>
            </div>
            <select class="pind__detalle-sel" id="pind-tard-per-${id}">
              ${allPeriodos.map(p => `<option value="${p}">${fmtPeriodo(p)}</option>`).join('')}
            </select>
            <label class="pind__det-hist-check">
              <input type="checkbox" id="pind-tard-hist-${id}"> Histórico
            </label>
            <button class="pind__dep-toggle" id="pind-tard-export-${id}" title="Descargar Excel con tardanzas y salidas anticipadas">⬇ Excel</button>
            <button class="pind__detalle-cerrar" id="pind-tard-close-${id}">✕</button>
          </div>
        </div>
        <div class="pind__res-scroll" id="pind-tard-tabla-${id}"></div>
      </div>

      <!-- Panel ausentismo por empleado -->
      <div class="pind__detalle" id="pind-detalle-${id}" hidden>
        <div class="pind__detalle-header">
          <span class="pind__detalle-tit">Detalle de ausentismo</span>
          <div class="pind__detalle-controles">
            <div class="pind__detalle-filtros" role="group">
              <button class="pind__det-emp pind__det-emp--activo" data-emp="">Todas</button>
              <button class="pind__det-emp pind__det-emp--cim" data-emp="CIMOMET">Cimomet</button>
              <button class="pind__det-emp pind__det-emp--com" data-emp="COMOING">Co.mo.ing</button>
            </div>
            <select class="pind__detalle-sel" id="pind-det-per-${id}">
              ${allPeriodos.map(p => `<option value="${p}">${fmtPeriodo(p)}</option>`).join('')}
            </select>
            <label class="pind__det-hist-check">
              <input type="checkbox" id="pind-det-hist-${id}"> Histórico
            </label>
            <button class="pind__dep-toggle" id="pind-det-export-${id}" title="Descargar Excel con el detalle de ausentismo">⬇ Excel</button>
            <button class="pind__detalle-cerrar" id="pind-det-close-${id}">✕</button>
          </div>
        </div>
        <div class="pind__res-scroll" id="pind-det-tabla-${id}"></div>
      </div>

      <!-- Gráficos fila 1 -->
      <div class="pind__graf-grid">
        <div class="pind__sec pind__graf-card" style="background:var(--color-fondo)">
          <h3 class="pind__sec-tit">Horas trabajadas por empresa</h3>
          <div class="pind__graf-wrap"><canvas id="pind-ch-horas-${id}"></canvas></div>
        </div>
        <div class="pind__sec pind__graf-card" style="background:var(--color-fondo)">
          <h3 class="pind__sec-tit">Esperadas vs. Trabajadas</h3>
          <div class="pind__graf-wrap"><canvas id="pind-ch-esp-${id}"></canvas></div>
        </div>
      </div>

      <!-- Gráficos fila 2 -->
      <div class="pind__graf-grid" style="margin-top:var(--espacio-m)">
        <div class="pind__sec pind__graf-card" style="background:var(--color-fondo)">
          <h3 class="pind__sec-tit">Ausentismo vs. Horas trabajadas</h3>
          <div class="pind__graf-wrap"><canvas id="pind-ch-aus-${id}"></canvas></div>
        </div>
        <div class="pind__sec pind__graf-card" style="background:var(--color-fondo)">
          <h3 class="pind__sec-tit">Horas extra por período</h3>
          <div id="pind-ext-wrap-${id}" class="pind__graf-wrap"><canvas id="pind-ch-ext-${id}"></canvas></div>
        </div>
      </div>

      <!-- Gráficos fila 3 -->
      <div class="pind__graf-grid" style="margin-top:var(--espacio-m)">
        <div class="pind__sec pind__graf-card" style="background:var(--color-fondo);grid-column:1 / -1">
          <h3 class="pind__sec-tit">Ausentismo por motivo</h3>
          <div id="pind-ch-ausmotivo-wrap-${id}" class="pind__graf-wrap"><canvas id="pind-ch-ausmotivo-${id}"></canvas></div>
        </div>
      </div>

      <!-- Tabla resumen por período -->
      <div class="pind__res-scroll" style="margin-top:16px">
        <table class="pind__res-tabla">
          <thead><tr>
            <th class="pind__res-th">Período</th>
            <th class="pind__res-th pind__res-th--cim">Cimomet</th>
            <th class="pind__res-th pind__res-th--com">Co.mo.ing</th>
            <th class="pind__res-th">Trabajadas</th>
            <th class="pind__res-th">Esperadas</th>
            <th class="pind__res-th">% Aus.</th>
          </tr></thead>
          <tbody>${filas}</tbody>
          <tfoot><tr>
            <td class="pind__res-tf">Total</td>
            <td class="pind__res-tf pind__res-tf--num">${fmtNum(g.totCIM)}</td>
            <td class="pind__res-tf pind__res-tf--num">${fmtNum(g.totCOM)}</td>
            <td class="pind__res-tf pind__res-tf--num">${fmtNum(g.totGen)}</td>
            <td class="pind__res-tf pind__res-tf--num">${fmtNum(g.totalEsp)}</td>
            <td class="pind__res-tf" style="color:${g.colorIdx}">${g.idxAus}%</td>
          </tr></tfoot>
        </table>
      </div>

    </section>`;
}

export async function renderizarPresentismoIndicadores(contenedor) {
  destruirGraficos();
  contenedor.innerHTML = '<div class="pres__loading">Cargando indicadores…</div>';

  let rawHoras = [], empleados = [], rawAusTipo = [], detalleExt50 = [], rawTardanzas = [], mapaClasif = new Map(), mapaAusencias = new Map();
  try {
    const [rH, rE, rA, rDrows, rTard, mapa, mapaAus] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/rrhh_horas_mensual?select=legajo,apellido,nombre,departamento,periodo,empresa,hs_normales,hs_esperadas,hs_extra50,hs_extra100,hs_justificadas,hs_no_justificadas,hs_ausencias,dias_laborables,dias_presentes,dias_ausentes_nojust&order=periodo.asc`, { headers: HDR }),
      fetch(`${SUPABASE_URL}/rest/v1/empleados?select=legajo,empresa,desc_puesto&activo=eq.true&limit=2000`, { headers: HDR }),
      fetch(`${SUPABASE_URL}/rest/v1/v_ausentismo_tipo?select=periodo,tipo,hs_total&order=periodo.asc`, { headers: HDR }),
      // 'HSEXT' es el código real de Tango para 50% (ver presentismo-carga.js); 'HSEXT50' se
      // acepta también por compatibilidad con algún import previo que lo haya usado tal cual.
      // 'HS 50 VAC' es el mismo concepto de extra al 50% pero de un día de vacaciones
      // trabajadas — para el sistema es la misma hora extra, solo cambia el código porque
      // Tango la liquida aparte. Va con "or" (no "in") porque el valor tiene un espacio.
      fetchTodasFilas(`${SUPABASE_URL}/rest/v1/rrhh_horas_detalle?or=(tipo_hora.eq.HSEXT,tipo_hora.eq.HSEXT50,tipo_hora.eq.HS%2050%20VAC)&select=legajo,periodo,fecha,hs_trabajadas&order=id.asc`),
      fetchTodasFilas(`${SUPABASE_URL}/rest/v1/rrhh_tardanzas_salidas?select=legajo,periodo,fecha,tipo,minutos,codigo_justificacion,descripcion_justificacion&order=id.asc`),
      obtenerClasificacionPuestos(),
      obtenerClasificacionAusencias(),
    ]);
    if (rH.ok) rawHoras     = await rH.json();
    if (rE.ok) empleados    = await rE.json();
    if (rA.ok) rawAusTipo   = await rA.json();
    detalleExt50 = rDrows;
    rawTardanzas = rTard;
    mapaClasif = mapa;
    mapaAusencias = mapaAus;
  } catch (e) {
    contenedor.innerHTML = `<div class="pres__vacio">Error al cargar datos: ${e.message}</div>`;
    return;
  }

  if (!rawHoras.length) {
    contenedor.innerHTML = `
      <div class="estado-vacio">
        <div class="estado-vacio__icono"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
        <h3 class="estado-vacio__titulo">Sin datos cargados</h3>
        <p class="estado-vacio__texto">Importá el archivo de Tango desde "Cargar datos" para ver los indicadores.</p>
      </div>`;
    return;
  }

  // Clasificación (mensual / quincenal / sin_asignar), según config/plantel-parametrizacion
  const empMap = new Map();
  empleados.forEach(e => empMap.set(String(e.legajo), { tipo: tipoPuesto(e.desc_puesto, mapaClasif) }));
  // Set de legajos activos (para marcar desvinculados)
  const activosSet = new Set(empleados.map(e => String(e.legajo)));

  const rawQ = rawHoras.filter(d => empMap.get(String(d.legajo))?.tipo === 'quincenal');
  const rawM = rawHoras.filter(d => empMap.get(String(d.legajo))?.tipo === 'mensual');
  // Este panel es solo tarde/temprano — las ausencias completas (tipo 'ausente', ej.
  // enfermedad o falta sin aviso) son ausentismo, no salida anticipada, y ya se muestran
  // aparte en el panel de Ausentismo.
  const rawTardQ = rawTardanzas.filter(t => t.tipo !== 'ausente' && empMap.get(String(t.legajo))?.tipo === 'quincenal');
  const rawTardM = rawTardanzas.filter(t => t.tipo !== 'ausente' && empMap.get(String(t.legajo))?.tipo === 'mensual');
  // Ausencias completas (tipo 'ausente') para el panel de Ausentismo — clasificadas por
  // motivo en Horas y Presentismo → Parametrización.
  const rawAusQ = rawTardanzas.filter(t => t.tipo === 'ausente' && empMap.get(String(t.legajo))?.tipo === 'quincenal');
  const rawAusM = rawTardanzas.filter(t => t.tipo === 'ausente' && empMap.get(String(t.legajo))?.tipo === 'mensual');

  const allPeriodos = [...new Set(rawHoras.filter(d => EMPRESAS.includes(d.empresa)).map(d => d.periodo))].sort();
  const ultimoPer   = allPeriodos[allPeriodos.length - 1];
  const labels      = allPeriodos.map(fmtPeriodo);

  const gQ = calcularGrupo(rawQ, allPeriodos, activosSet);
  const gM = calcularGrupo(rawM, allPeriodos, activosSet);

  // Composición del ausentismo por motivo, período a período (para el gráfico apilado).
  gQ.ausCategoria = ausentismoPorCategoriaPeriodo(rawAusQ, allPeriodos, mapaAusencias);
  gM.ausCategoria = ausentismoPorCategoriaPeriodo(rawAusM, allPeriodos, mapaAusencias);

  // Desglose de Horas extra 50% en "en semana" vs "sábados". IMPORTANTE: el total que se
  // muestra arriba se redefine como semana+sábado (en vez de usar hs_extra50 del agregado
  // mensual) para que sea matemáticamente imposible que el número de arriba no cierre con
  // el desglose de abajo — son la misma cuenta, no dos cuentas separadas que "deberían" dar igual.
  const legajosQ = new Set(rawQ.map(d => String(d.legajo)));
  const legajosM = new Set(rawM.map(d => String(d.legajo)));
  const ext50Q = desgloseExt50(detalleExt50, legajosQ, null);
  const ext50M = desgloseExt50(detalleExt50, legajosM, null);
  gQ.ext50Semana = ext50Q.semana; gQ.ext50Sabado = ext50Q.sabado; gQ.totalExt50 = ext50Q.semana + ext50Q.sabado;
  gM.ext50Semana = ext50M.semana; gM.ext50Sabado = ext50M.sabado; gM.totalExt50 = ext50M.semana + ext50M.sabado;

  // Tardanzas / salidas anticipadas + índice de puntualidad, por grupo (todos los períodos)
  [[gQ, rawTardQ], [gM, rawTardM]].forEach(([g, rawTardGroup]) => {
    const r = resumenTardanzas(rawTardGroup, allPeriodos);
    Object.assign(g, r);
    g.indicePuntualidad = g.totalDiasPres > 0
      ? +(((g.totalDiasPres - r.diasConIncidente) / g.totalDiasPres) * 100).toFixed(1)
      : null;
    g.colorPunt = g.indicePuntualidad == null ? 'var(--color-texto-sec)'
      : g.indicePuntualidad >= 95 ? '#16a34a' : g.indicePuntualidad >= 90 ? '#d97706' : '#dc2626';
  });

  // Ausentismo por tipo
  const tipoTotales = new Map(), tipoPorPeriodo = new Map();
  rawAusTipo.forEach(d => {
    tipoTotales.set(d.tipo, (tipoTotales.get(d.tipo) || 0) + (+d.hs_total || 0));
    tipoPorPeriodo.set(`${d.tipo}|${d.periodo}`, +d.hs_total || 0);
  });
  const tiposOrdenados = [...tipoTotales.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  const totalAusTipoGen = [...tipoTotales.values()].reduce((s, v) => s + v, 0);

  contenedor.innerHTML = `<div class="pind">

    <!-- El selector de grupo (Quincenales/Mensuales) vive DENTRO de cada sección, en el
         lugar donde antes iba el título — ver htmlSeccion() — así no hay un título repetido
         arriba que ya dice lo mismo que el botón. -->
    <div id="pind-grupo-wrap-q">${htmlSeccion(gQ, allPeriodos, 'q', 'Personal de taller — Quincenales', 'var(--color-primario)')}</div>
    <div id="pind-grupo-wrap-m">${htmlSeccion(gM, allPeriodos, 'm', 'Personal administrativo — Mensuales', '#0d9488')}</div>

    <!-- Presentismo y extras por sector — sección única, se elige el grupo con el toggle
         en vez de repetir este bloque una vez por cada uno (Quincenales/Mensuales) -->
    <section class="pind__sec">
      <div class="pind__dep-header">
        <span class="pind__dep-tit">Presentismo y extras por sector</span>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <div class="pind__dep-grupo-switch" role="tablist" aria-label="Grupo de personal">
            <button class="pind__dep-grupo-btn pind__dep-grupo-btn--activo" data-grupo="q" type="button" role="tab" aria-selected="true">Quincenales</button>
            <button class="pind__dep-grupo-btn" data-grupo="m" type="button" role="tab" aria-selected="false">Mensuales</button>
          </div>
          <select class="pind__detalle-sel" id="pind-dep-per-global">
            ${[...allPeriodos].reverse().map(p => `<option value="${p}">${fmtPeriodo(p)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="pind__graf-grid" style="margin-top:var(--espacio-m)">
        <div class="pind__sec pind__graf-card" style="background:var(--color-fondo)">
          <h3 class="pind__sec-tit">Presentismo por sector (% días presente)</h3>
          <div id="pind-dep-pres-wrap-global" class="pind__graf-wrap"></div>
        </div>
        <div class="pind__sec pind__graf-card" style="background:var(--color-fondo)">
          <h3 class="pind__sec-tit">Horas extra por sector</h3>
          <div id="pind-dep-ext-wrap-global" class="pind__graf-wrap"></div>
        </div>
      </div>
    </section>

    <!-- Ausentismo por tipo -->
    ${tiposOrdenados.length ? `<section class="pind__sec">
      <h2 class="pind__sec-tit">
        <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
        Ausentismo por tipo de novedad
      </h2>
      <div class="pind__res-scroll"><table class="pind__aus-tabla">
        <thead><tr>
          <th class="pind__aus-th pind__aus-th--tipo">Tipo de novedad</th>
          ${allPeriodos.map(p => `<th class="pind__aus-th">${fmtPeriodo(p)}</th>`).join('')}
          <th class="pind__aus-th pind__aus-th--tot">Total</th>
        </tr></thead>
        <tbody>${tiposOrdenados.map(tipo => `<tr>
          <td class="pind__aus-td pind__aus-td--tipo">${tipo}</td>
          ${allPeriodos.map(p => { const v = tipoPorPeriodo.get(`${tipo}|${p}`) || 0; return `<td class="pind__aus-td pind__aus-td--num">${v > 0 ? fmtNum(v) : '—'}</td>`; }).join('')}
          <td class="pind__aus-td pind__aus-td--tot">${fmtNum(tipoTotales.get(tipo))}</td>
        </tr>`).join('')}</tbody>
        <tfoot><tr>
          <td class="pind__aus-tf">Total general</td>
          ${allPeriodos.map(p => { const v = Math.round(rawAusTipo.filter(d => d.periodo === p).reduce((s, d) => s + (+d.hs_total || 0), 0)); return `<td class="pind__aus-tf pind__aus-tf--num">${v > 0 ? v.toLocaleString('es-AR') : '—'}</td>`; }).join('')}
          <td class="pind__aus-tf pind__aus-tf--tot">${fmtNum(totalAusTipoGen)}</td>
        </tr></tfoot>
      </table></div>
    </section>` : ''}

  </div>`;

  if (typeof Chart === 'undefined') return;
  const CIM_COLOR = getComputedStyle(document.documentElement).getPropertyValue('--color-primario').trim() || '#1e3a5f';
  const COM_COLOR = '#0d9488';

  // ── Gráficos principales por sección ────────────────────────────────────
  // graficosPorGrupo permite llamar .resize() solo en los gráficos del grupo que se
  // vuelve a mostrar con el selector de arriba (ver más abajo, mostrarGrupo()).
  const graficosPorGrupo = {};
  function initCharts(g, sufijo, acento) {
    const inicioIdx = graficosActivos.length;
    // Horas por empresa
    graficosActivos.push(new Chart(contenedor.querySelector(`#pind-ch-horas-${sufijo}`).getContext('2d'), {
      type: 'bar',
      data: { labels, datasets: [
        { label: 'Cimomet',   data: g.horasCIM, backgroundColor: CIM_COLOR, borderRadius: 4 },
        { label: 'Co.mo.ing', data: g.horasCOM, backgroundColor: COM_COLOR, borderRadius: 4 },
      ]},
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { boxWidth: 12 } },
          tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${c.parsed.y.toLocaleString('es-AR')}h` } } },
        scales: { y: { ticks: { callback: v => v.toLocaleString('es-AR') }, grid: { color: 'rgba(0,0,0,0.06)' } } },
      },
    }));

    // Esperadas vs Trabajadas
    graficosActivos.push(new Chart(contenedor.querySelector(`#pind-ch-esp-${sufijo}`).getContext('2d'), {
      type: 'bar',
      data: { labels, datasets: [
        { label: 'Esperadas',   data: g.espTot,   backgroundColor: 'rgba(100,116,139,0.35)', borderRadius: 4 },
        { label: 'Trabajadas',  data: g.horasTot, backgroundColor: acento + 'dd', borderRadius: 4 },
      ]},
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { boxWidth: 12 } },
          tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${c.parsed.y.toLocaleString('es-AR')}h` } } },
        scales: { y: { ticks: { callback: v => v.toLocaleString('es-AR') }, grid: { color: 'rgba(0,0,0,0.06)' } } },
      },
    }));

    // Ausentismo dual axis
    graficosActivos.push(new Chart(contenedor.querySelector(`#pind-ch-aus-${sufijo}`).getContext('2d'), {
      type: 'bar',
      data: { labels, datasets: [
        { type: 'bar',  label: 'Horas trabajadas', data: g.horasTot, backgroundColor: acento + 'cc', borderRadius: 4, yAxisID: 'y' },
        { type: 'line', label: '% Ausentismo',     data: g.ausPct,   borderColor: '#f97316', backgroundColor: '#f9731620', pointBackgroundColor: '#f97316', pointRadius: 5, tension: 0.3, yAxisID: 'y2' },
      ]},
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { boxWidth: 12 } },
          tooltip: { callbacks: { label: c => c.dataset.yAxisID === 'y2' ? ` % Ausentismo: ${c.parsed.y}%` : ` Horas: ${c.parsed.y.toLocaleString('es-AR')}` } } },
        scales: {
          y:  { ticks: { callback: v => v.toLocaleString('es-AR') }, grid: { color: 'rgba(0,0,0,0.06)' } },
          y2: { position: 'right', ticks: { callback: v => v + '%' }, grid: { drawOnChartArea: false }, suggestedMin: 0, suggestedMax: 12 },
        },
      },
    }));

    // Horas extra
    const hayExt100 = g.ext100Tot.some(v => v > 0);
    const hayExt50  = g.ext50Tot.some(v => v > 0);
    if (!hayExt50 && !hayExt100) {
      const wrap = contenedor.querySelector(`#pind-ext-wrap-${sufijo}`);
      if (wrap) wrap.innerHTML = '<p style="padding:24px 0;text-align:center;color:var(--color-texto-sec);font-size:0.85rem">Sin horas extra en este período.</p>';
    } else {
      const extDatasets = [];
      if (hayExt50)  extDatasets.push({ label: 'Extra 50%',  data: g.ext50Tot,  backgroundColor: '#7c3aed', borderRadius: 4, stack: 'ext' });
      if (hayExt100) extDatasets.push({ label: 'Extra 100%', data: g.ext100Tot, backgroundColor: '#dc2626', borderRadius: 4, stack: 'ext' });
      graficosActivos.push(new Chart(contenedor.querySelector(`#pind-ch-ext-${sufijo}`).getContext('2d'), {
        type: 'bar',
        data: { labels, datasets: extDatasets },
        options: { responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: hayExt100, position: 'top', labels: { boxWidth: 12 } },
            tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${c.parsed.y.toLocaleString('es-AR')}h` } } },
          scales: { y: { ticks: { callback: v => v + 'h' }, grid: { color: 'rgba(0,0,0,0.06)' } } },
        },
      }));
    }

    // Ausentismo por motivo — una barra por período, apilada por categoría (Enfermedad,
    // Accidente, Aviso, Sin aviso, Sin clasificar), para ver de un vistazo si la composición
    // del ausentismo cambia de tendencia mes a mes.
    const hayAusCategoria = CATEGORIAS_TABLA.some(c => g.ausCategoria[c].some(v => v > 0));
    const wrapAusMotivo = contenedor.querySelector(`#pind-ch-ausmotivo-wrap-${sufijo}`);
    if (!hayAusCategoria) {
      if (wrapAusMotivo) wrapAusMotivo.innerHTML = '<p style="padding:24px 0;text-align:center;color:var(--color-texto-sec);font-size:0.85rem">Sin ausentismo clasificado en este período.</p>';
    } else {
      const catsConDatos = CATEGORIAS_TABLA.filter(c => g.ausCategoria[c].some(v => v > 0));
      graficosActivos.push(new Chart(contenedor.querySelector(`#pind-ch-ausmotivo-${sufijo}`).getContext('2d'), {
        type: 'bar',
        data: { labels, datasets: catsConDatos.map(c => ({
          label: CATEGORIA_LABEL[c], data: g.ausCategoria[c], backgroundColor: CATEGORIA_COLOR[c], borderRadius: 4, stack: 'aus',
        })) },
        options: { responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'top', labels: { boxWidth: 12 } },
            tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${c.parsed.y.toLocaleString('es-AR')}h` } } },
          scales: {
            x: { stacked: true, grid: { display: false } },
            y: { stacked: true, ticks: { callback: v => v + 'h' }, grid: { color: 'rgba(0,0,0,0.06)' } },
          },
        },
      }));
    }
    graficosPorGrupo[sufijo] = graficosActivos.slice(inicioIdx);
  }

  initCharts(gQ, 'q', CIM_COLOR);
  initCharts(gM, 'm', COM_COLOR);

  // Selector "Ver información de" — solo un grupo (Quincenales/Mensuales) visible a la vez.
  // Los gráficos de ambos ya se crearon arriba mientras las dos secciones estaban en el
  // flujo normal (para que Chart.js las mida bien); acá simplemente se oculta una y, al
  // volver a mostrarla, se le pide un resize por las dudas de que el layout haya cambiado.
  (function initSelectorGrupo() {
    const wraps = {
      q: contenedor.querySelector('#pind-grupo-wrap-q'),
      m: contenedor.querySelector('#pind-grupo-wrap-m'),
    };
    const btns = [...contenedor.querySelectorAll('.pind__grupo-ver-btn')];

    function mostrarGrupo(grupo) {
      Object.entries(wraps).forEach(([g, el]) => { if (el) el.hidden = g !== grupo; });
      btns.forEach(b => {
        const activo = b.dataset.grupoVer === grupo;
        b.classList.toggle('pind__grupo-ver-btn--activo', activo);
        b.setAttribute('aria-selected', String(activo));
      });
      requestAnimationFrame(() => (graficosPorGrupo[grupo] || []).forEach(ch => { try { ch.resize(); } catch {} }));
    }

    btns.forEach(btn => btn.addEventListener('click', () => mostrarGrupo(btn.dataset.grupoVer)));
    mostrarGrupo('q');
  })();

  // ── Gráficos de departamento (lazy) ──────────────────────────────────────
  function initDepCharts(rawGroup, sufijo, periodo) {
    if (graficosDepActivos[sufijo]) {
      graficosDepActivos[sufijo].forEach(g => { try { g.destroy(); } catch {} });
    }
    graficosDepActivos[sufijo] = [];

    const deps = buildDepStats(rawGroup, periodo);
    const presWrap = contenedor.querySelector(`#pind-dep-pres-wrap-${sufijo}`);
    const extWrap  = contenedor.querySelector(`#pind-dep-ext-wrap-${sufijo}`);
    if (!presWrap || !extWrap || !deps.length) return;

    // Altura dinámica según cantidad de sectores (compacta, para que ambos gráficos
    // entren en pantalla sin tener que scrollear demasiado)
    const h = Math.max(180, deps.length * 24 + 30);
    presWrap.style.height = h + 'px';

    const minPres = Math.max(0, Math.min(...deps.map(d => d.pres)) - 3);

    // Presentismo por sector
    const canvPres = document.createElement('canvas');
    presWrap.innerHTML = '';
    presWrap.appendChild(canvPres);
    graficosDepActivos[sufijo].push(new Chart(canvPres.getContext('2d'), {
      type: 'bar',
      data: { labels: deps.map(d => d.dep), datasets: [{
        label: '% Presentismo', data: deps.map(d => d.pres),
        backgroundColor: deps.map(d => d.pres >= 95 ? '#16a34a' : d.pres >= 90 ? '#d97706' : '#dc2626'),
        borderRadius: 4,
      }]},
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        scales: { x: { min: minPres, max: 100, ticks: { callback: v => v + '%' }, grid: { color: 'rgba(0,0,0,0.06)' } },
          y: { ticks: { font: { size: 11 } } } },
        plugins: { legend: { display: false },
          tooltip: { callbacks: { label: c => ` ${c.parsed.x}% presentismo`, afterLabel: c => ` ${deps[c.dataIndex].count} empleados` } } },
      },
    }));

    // Extras por sector
    const conExtras = deps.filter(d => d.ext50 + d.ext100 > 0).sort((a, b) => (b.ext50 + b.ext100) - (a.ext50 + a.ext100));
    if (!conExtras.length) {
      extWrap.innerHTML = '<p style="padding:24px 0;text-align:center;color:var(--color-texto-sec);font-size:0.85rem">Sin horas extra en este período.</p>';
      extWrap.style.height = 'auto';
    } else {
      extWrap.style.height = Math.max(180, conExtras.length * 24 + 30) + 'px';
      const hayExt100 = conExtras.some(d => d.ext100 > 0);
      const canvExt = document.createElement('canvas');
      extWrap.innerHTML = '';
      extWrap.appendChild(canvExt);
      const extDs = [{ label: 'Extra 50%', data: conExtras.map(d => d.ext50), backgroundColor: '#7c3aed', borderRadius: 4, stack: 'e' }];
      if (hayExt100) extDs.push({ label: 'Extra 100%', data: conExtras.map(d => d.ext100), backgroundColor: '#dc2626', borderRadius: 4, stack: 'e' });
      graficosDepActivos[sufijo].push(new Chart(canvExt.getContext('2d'), {
        type: 'bar',
        data: { labels: conExtras.map(d => d.dep), datasets: extDs },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
          scales: { x: { ticks: { callback: v => v + 'h' }, grid: { color: 'rgba(0,0,0,0.06)' } }, y: { ticks: { font: { size: 11 } } } },
          plugins: { legend: { display: hayExt100, position: 'top', labels: { boxWidth: 12 } },
            tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${c.parsed.x}h` } } },
        },
      }));
    }
  }

  // Detalle diario de TODO el mundo para un período dado (1ra/2da quincena no tiene su
  // propio acumulado mensual, hay que armarlo a partir de rrhh_horas_detalle) — se pide una
  // sola vez por período y se comparte entre el grupo Quincenal y el Mensual.
  const detalleQuincenaCache = new Map();
  function obtenerDetalleQuincena(periodo) {
    if (!detalleQuincenaCache.has(periodo)) {
      detalleQuincenaCache.set(periodo, fetchTodasFilas(
        `${SUPABASE_URL}/rest/v1/rrhh_horas_detalle?periodo=eq.${periodo}&select=legajo,fecha,periodo,tipo_hora,hs_trabajadas,hs_reales,hs_esperadas,hs_justificadas,hs_no_justificadas&order=id.asc`
      ).catch(() => []));
    }
    return detalleQuincenaCache.get(periodo);
  }

  // ── Interactividad ────────────────────────────────────────────────────────
  ['q', 'm'].forEach(sufijo => {
    const rawGroup   = sufijo === 'q' ? rawQ : rawM;
    const legajosSet = sufijo === 'q' ? legajosQ : legajosM;
    const rawTardGroup = sufijo === 'q' ? rawTardQ : rawTardM;
    const rawAusGroup  = sufijo === 'q' ? rawAusQ : rawAusM;

    // Selectores de Año / Mes / Vista → actualizan tarjetas KPI sin tocar los gráficos.
    // "Vista" (1ra/2da quincena) solo tiene sentido con un mes puntual elegido; para eso no
    // hay acumulado mensual pre-calculado, así que se reconstruye desde el detalle diario
    // (ver reconstruirFilasDesdeDetalle) — un poco más lento la primera vez que se pide.
    const anioSel  = contenedor.querySelector(`#pind-anio-${sufijo}`);
    const mesSel   = contenedor.querySelector(`#pind-mes-${sufijo}`);
    const vistaSel = contenedor.querySelector(`#pind-vista-${sufijo}`);

    // La columna "periodo" en Supabase es una fecha completa ("YYYY-MM-01", siempre el
    // primer día del mes) — hay que armar el filtro con ese mismo formato para que matchee.
    function periodoActual() {
      return mesSel && mesSel.value ? `${anioSel.value}-${mesSel.value}-01` : '';
    }

    function refrescarMeses() {
      const valorPrevio = mesSel.value;
      const disponibles = mesesDisponibles(allPeriodos, anioSel.value);
      mesSel.innerHTML = `<option value="">Todos los meses</option>` +
        disponibles.map(m => `<option value="${m}">${MESES_CORTO[+m - 1]}</option>`).join('');
      mesSel.value = disponibles.includes(valorPrevio) ? valorPrevio : '';
    }

    // Pone Año/Mes en un período "YYYY-MM" puntual (o "" para "todos los meses") y refresca
    // las tarjetas — usado cuando el selector del panel de ausentismo/tardanzas cambia de mes.
    function sincronizarPeriodo(nuevoPer) {
      if (nuevoPer) {
        const [y, m] = nuevoPer.split('-');
        if (anioSel.value !== y) { anioSel.value = y; refrescarMeses(); }
        mesSel.value = m;
      } else {
        mesSel.value = '';
      }
      aplicarFiltro();
    }

    async function aplicarFiltro() {
      const per = periodoActual();
      if (vistaSel) {
        vistaSel.disabled = !per;
        if (!per) vistaSel.value = 'mensual';
      }
      const vista = vistaSel ? vistaSel.value : 'mensual';
      const kv = key => contenedor.querySelector(`#pind-kv-${key}-${sufijo}`);

      let gF, rTard, ext50Desglose;

      if (per && vista !== 'mensual') {
        // 1ra/2da quincena: reconstruir desde el detalle diario de todo el grupo.
        ['trab', 'esp', 'cumpl', 'aus', 'idx', 'pres'].forEach(k => { const el = kv(k); if (el) el.textContent = '…'; });

        const [fechaDesde, fechaHasta] = rangoQuincena(per, vista);
        const detalleTodos = await obtenerDetalleQuincena(per);
        // Puede haber cambiado el filtro mientras esperábamos la respuesta — no pisar un
        // estado más nuevo con uno viejo que recién ahora termina de llegar.
        if (periodoActual() !== per || (vistaSel && vistaSel.value !== vista)) return;

        const detalleGrupo = detalleTodos.filter(d => legajosSet.has(String(d.legajo)));
        const empresaPorLegajo = new Map(rawGroup.map(d => [String(d.legajo), d.empresa]));
        const filasReconstruidas = reconstruirFilasDesdeDetalle(detalleGrupo, rawAusGroup, empresaPorLegajo, per, fechaDesde, fechaHasta);
        gF = calcularGrupo(filasReconstruidas, [per], activosSet);
        rTard = resumenTardanzas(rawTardGroup.filter(t => t.fecha >= fechaDesde && t.fecha <= fechaHasta), [per]);
        const ext50Filas = detalleGrupo.filter(d => EXT50_TIPOS.has(d.tipo_hora) && d.fecha >= fechaDesde && d.fecha <= fechaHasta);
        ext50Desglose = desgloseExt50(ext50Filas, legajosSet, null);
      } else {
        const filtradas = per ? rawGroup.filter(d => d.periodo === per) : rawGroup;
        gF = calcularGrupo(filtradas, per ? [per] : allPeriodos, activosSet);
        rTard = resumenTardanzas(rawTardGroup, per ? [per] : allPeriodos);
        ext50Desglose = desgloseExt50(detalleExt50, legajosSet, per || null);
      }

      const trabEl = kv('trab');
      const subEl  = kv('sub-trab');
      if (trabEl) trabEl.textContent = fmtNum(gF.totalTrab);
      if (subEl) subEl.textContent = !per
        ? (allPeriodos.length > 1
            ? `${fmtPeriodo(allPeriodos[0])} – ${fmtPeriodo(allPeriodos[allPeriodos.length - 1])}`
            : fmtPeriodo(allPeriodos[0]))
        : vista === 'q1' ? `1ra quincena · ${fmtPeriodo(per)}`
        : vista === 'q2' ? `2da quincena · ${fmtPeriodo(per)}`
        : fmtPeriodo(per);

      const espEl = kv('esp');
      if (espEl) espEl.textContent = fmtNum(gF.totalEsp);

      const cumplEl = kv('cumpl');
      if (cumplEl) { cumplEl.textContent = gF.cumplimiento + '%'; cumplEl.style.color = gF.colorCumpl; }

      const ausEl = kv('aus');
      if (ausEl) ausEl.textContent = fmtNum(gF.totalAus);

      const idxEl = kv('idx');
      if (idxEl) { idxEl.textContent = gF.idxAus + '%'; idxEl.style.color = gF.colorIdx; }

      const presEl = kv('pres');
      if (presEl) { presEl.textContent = gF.presGlobal + '%'; presEl.style.color = gF.colorPres; }

      const ext50El = contenedor.querySelector(`#pind-kv-ext50-${sufijo}`);
      if (ext50El) {
        const { semana, sabado } = ext50Desglose;
        const totalExt50Real = semana + sabado;
        ext50El.hidden = totalExt50Real <= 0;
        ext50El.querySelector('.pind__kpi-num').textContent = fmtNum(totalExt50Real) + 'h';
        const subEl50 = contenedor.querySelector(`#pind-kv-ext50-sub-${sufijo}`);
        if (subEl50) subEl50.textContent = `En semana: ${fmtNum(semana)}h · Sábados: ${fmtNum(sabado)}h`;
      }
      const ext100El = contenedor.querySelector(`#pind-kv-ext100-${sufijo}`);
      if (ext100El) {
        ext100El.hidden = gF.totalExt100 <= 0;
        ext100El.querySelector('.pind__kpi-num').textContent = fmtNum(gF.totalExt100) + 'h';
      }

      // Tardanzas / salidas anticipadas / puntualidad
      const tardEl = kv('tard');
      if (tardEl) tardEl.textContent = rTard.diasTarde + rTard.diasTemprano;
      const tardSubEl = contenedor.querySelector(`#pind-kv-tard-sub-${sufijo}`);
      if (tardSubEl) tardSubEl.textContent = `${rTard.diasTarde} tarde${rTard.diasTarde !== 1 ? 's' : ''} · ${rTard.diasTemprano} salida${rTard.diasTemprano !== 1 ? 's' : ''} anticipada${rTard.diasTemprano !== 1 ? 's' : ''}`;
      const puntEl = kv('punt');
      if (puntEl) {
        const punt = gF.totalDiasPres > 0 ? +(((gF.totalDiasPres - rTard.diasConIncidente) / gF.totalDiasPres) * 100).toFixed(1) : null;
        puntEl.textContent = punt != null ? punt + '%' : '—';
        puntEl.style.color = punt == null ? 'var(--color-texto-sec)' : punt >= 95 ? '#16a34a' : punt >= 90 ? '#d97706' : '#dc2626';
      }

      // Sincronizar selector del panel de ausentismo (por mes — la quincena no aplica ahí)
      if (selPer && selPer.value !== per) selPer.value = per;
      if (typeof refrescarTablaAus === 'function') refrescarTablaAus();
      // Sincronizar selector del panel de tardanzas/salidas
      if (selPerTard && selPerTard.value !== per) selPerTard.value = per;
      if (typeof refrescarTablaTard === 'function') refrescarTablaTard();
    }

    anioSel?.addEventListener('change', () => { refrescarMeses(); aplicarFiltro(); });
    mesSel?.addEventListener('change', () => { aplicarFiltro(); });
    vistaSel?.addEventListener('change', () => { aplicarFiltro(); });

    // Panel ausentismo
    const kpiBtn   = contenedor.querySelector(`#pind-kpi-aus-${sufijo}`);
    const panel    = contenedor.querySelector(`#pind-detalle-${sufijo}`);
    const selPer   = contenedor.querySelector(`#pind-det-per-${sufijo}`);
    const btnClose = contenedor.querySelector(`#pind-det-close-${sufijo}`);
    const tablaDiv = contenedor.querySelector(`#pind-det-tabla-${sufijo}`);
    const btnsFiltro = [...(contenedor.querySelectorAll(`#pind-detalle-${sufijo} .pind__det-emp`) || [])];
    let filtroEmpresa = '';

    selPer && (selPer.value = ultimoPer);

    function refrescarTablaAus() {
      if (tablaDiv) tablaDiv.innerHTML = tablaDetalleAusentismo(rawGroup, rawAusGroup, mapaAusencias, selPer.value, filtroEmpresa, activosSet);
    }

    kpiBtn?.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) refrescarTablaAus();
    });
    selPer?.addEventListener('change', () => {
      if (periodoActual() !== selPer.value) {
        sincronizarPeriodo(selPer.value); // actualiza KPIs y llama refrescarTablaAus
      } else {
        refrescarTablaAus();
      }
    });
    btnClose?.addEventListener('click', () => { panel.hidden = true; });
    btnsFiltro.forEach(btn => btn.addEventListener('click', () => {
      filtroEmpresa = btn.dataset.emp;
      btnsFiltro.forEach(b => b.classList.toggle('pind__det-emp--activo', b === btn));
      refrescarTablaAus();
    }));

    // Exportar a Excel: un período puntual, o el histórico completo si está tildado
    const chkHist   = contenedor.querySelector(`#pind-det-hist-${sufijo}`);
    const btnExport = contenedor.querySelector(`#pind-det-export-${sufijo}`);
    const nombreGrupo = sufijo === 'q' ? 'Quincenales' : 'Mensuales';
    chkHist?.addEventListener('change', () => { selPer.disabled = chkHist.checked; });
    btnExport?.addEventListener('click', () => {
      const periodos  = chkHist.checked ? allPeriodos : [selPer.value];
      const sufijoArchivo = chkHist.checked ? 'Historico' : selPer.value;
      exportarAusentismoExcel(rawGroup, rawAusGroup, mapaAusencias, activosSet, periodos, `Ausentismo_${nombreGrupo}_${sufijoArchivo}.xlsx`);
    });

    // Panel tardanzas / salidas anticipadas
    const kpiTardBtn    = contenedor.querySelector(`#pind-kpi-tard-${sufijo}`);
    const panelTard     = contenedor.querySelector(`#pind-tard-${sufijo}`);
    const selPerTard    = contenedor.querySelector(`#pind-tard-per-${sufijo}`);
    const btnCloseTard  = contenedor.querySelector(`#pind-tard-close-${sufijo}`);
    const tablaDivTard  = contenedor.querySelector(`#pind-tard-tabla-${sufijo}`);
    const btnsFiltroTard = [...(contenedor.querySelectorAll(`#pind-tard-${sufijo} .pind__det-emp`) || [])];
    const chkHistTard   = contenedor.querySelector(`#pind-tard-hist-${sufijo}`);
    const btnExportTard = contenedor.querySelector(`#pind-tard-export-${sufijo}`);
    let filtroEmpresaTard = '';

    selPerTard && (selPerTard.value = ultimoPer);

    function refrescarTablaTard() {
      if (tablaDivTard) tablaDivTard.innerHTML = tablaDetalleTardanzas(rawGroup, rawTardGroup, selPerTard.value, filtroEmpresaTard, activosSet);
    }

    function abrirPanelTard() {
      panelTard.hidden = !panelTard.hidden;
      if (!panelTard.hidden) refrescarTablaTard();
    }
    kpiTardBtn?.addEventListener('click', abrirPanelTard);
    selPerTard?.addEventListener('change', () => {
      if (periodoActual() !== selPerTard.value) {
        sincronizarPeriodo(selPerTard.value);
      } else {
        refrescarTablaTard();
      }
    });
    btnCloseTard?.addEventListener('click', () => { panelTard.hidden = true; });
    btnsFiltroTard.forEach(btn => btn.addEventListener('click', () => {
      filtroEmpresaTard = btn.dataset.tardemp;
      btnsFiltroTard.forEach(b => b.classList.toggle('pind__det-emp--activo', b === btn));
      refrescarTablaTard();
    }));
    chkHistTard?.addEventListener('change', () => { selPerTard.disabled = chkHistTard.checked; });
    btnExportTard?.addEventListener('click', () => {
      const periodos = chkHistTard.checked ? allPeriodos : [selPerTard.value];
      const sufijoArchivo = chkHistTard.checked ? 'Historico' : selPerTard.value;
      exportarTardanzasExcel(rawGroup, rawTardGroup, periodos, `TardanzasSalidas_${nombreGrupo}_${sufijoArchivo}.xlsx`);
    });

    // Expandir fila de empleado → ver sus tardanzas/salidas anticipadas del período (ya está
    // todo en memoria, no hace falta pedirlo al servidor como sí pasa con el de ausentismo)
    tablaDivTard?.addEventListener('click', e => {
      const row = e.target.closest('.pind__det-emp-row');
      if (!row) return;
      const expandRow = tablaDivTard.querySelector(`#${row.dataset.expand}`);
      if (!expandRow) return;
      const abriendo = expandRow.hidden;
      expandRow.hidden = !abriendo;
      row.querySelector('.pind__det-expand-icon')?.classList.toggle('pind__det-expand-icon--open', abriendo);
    });

    // Expand días de ausentismo
    tablaDiv?.addEventListener('click', async e => {
      const row = e.target.closest('.pind__det-emp-row');
      if (!row) return;
      const { legajo, periodo: per, expand: expandId } = row.dataset;
      const expandRow = tablaDiv.querySelector(`#${expandId}`);
      if (!expandRow) return;
      const abriendo = expandRow.hidden;
      expandRow.hidden = !abriendo;
      row.querySelector('.pind__det-expand-icon')?.classList.toggle('pind__det-expand-icon--open', abriendo);
      if (abriendo && !expandRow.dataset.loaded) {
        const celda = expandRow.querySelector('td');
        try {
          const r = await fetch(`${SUPABASE_URL}/rest/v1/rrhh_tardanzas_salidas?legajo=eq.${legajo}&periodo=eq.${per}&tipo=eq.ausente&select=fecha,minutos,codigo_justificacion,descripcion_justificacion&order=fecha.asc`, { headers: HDR });
          const eventosDia = r.ok ? await r.json() : [];
          celda.innerHTML = renderDias(eventosDia.filter(e => !CODIGOS_EXCLUIDOS_AUSENTISMO.has(e.codigo_justificacion)), mapaAusencias);
          expandRow.dataset.loaded = '1';
        } catch { celda.innerHTML = '<em style="padding:10px;color:#dc2626">Error al cargar.</em>'; }
      }
    });

  });

  // Panel por sector — sección única (ver comentario en el template): un solo par de
  // gráficos que se recalculan según el grupo elegido en el toggle, para que Quincenales
  // y Mensuales muestren siempre la misma información en el mismo formato.
  const depGrupoBtns = [...contenedor.querySelectorAll('.pind__dep-grupo-btn')];
  const depSelGlobal = contenedor.querySelector('#pind-dep-per-global');
  let depGrupoActivo = 'q';

  function refrescarDepCharts() {
    const rawGroup = depGrupoActivo === 'q' ? rawQ : rawM;
    initDepCharts(rawGroup, 'global', depSelGlobal?.value || ultimoPer);
  }

  depGrupoBtns.forEach(btn => btn.addEventListener('click', () => {
    if (btn.dataset.grupo === depGrupoActivo) return;
    depGrupoActivo = btn.dataset.grupo;
    depGrupoBtns.forEach(b => {
      const activo = b === btn;
      b.classList.toggle('pind__dep-grupo-btn--activo', activo);
      b.setAttribute('aria-selected', String(activo));
    });
    refrescarDepCharts();
  }));
  depSelGlobal?.addEventListener('change', refrescarDepCharts);

  if (depSelGlobal) depSelGlobal.value = ultimoPer;
  refrescarDepCharts();
}
