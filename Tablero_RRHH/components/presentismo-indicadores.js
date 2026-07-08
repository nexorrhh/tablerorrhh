import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';

const HDR = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
const MESES_CORTO = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

const EMPRESAS  = ['CIMOMET', 'COMOING'];
const EMP_LABEL = { CIMOMET: 'Cimomet', COMOING: 'Co.mo.ing' };
const EMP_COLOR = { CIMOMET: 'var(--color-primario)', COMOING: '#0d9488' };

const MENSUAL_KW = [
  'calidad','ingenieria','administrativ','administracion',
  'rrhh','recursos humanos','coordinacion','recepcion',
  'despacho','presupuesto','seguridad e higiene','higiene',
];
function esMensual(p) {
  const n = (p || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return MENSUAL_KW.some(kw => n.includes(kw));
}
function fmtPeriodo(p) { const [y, m] = p.split('-'); return `${MESES_CORTO[+m - 1]} ${y}`; }
function fmtNum(n)     { return Math.round(n || 0).toLocaleString('es-AR'); }
function fmtFecha(f) {
  if (!f) return '—';
  const [y, m, d] = f.slice(0, 10).split('-');
  return `${+d} ${MESES_CORTO[+m - 1]} ${y}`;
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
function calcularGrupo(rows, allPeriodos, activosSet) {
  // Agrupado por (periodo, empresa) para los gráficos de tendencia
  const agg = new Map();
  rows.forEach(d => {
    const emp = EMPRESAS.includes(d.empresa) ? d.empresa : null;
    if (!emp) return;
    const k = `${d.periodo}|${emp}`;
    if (!agg.has(k)) agg.set(k, { hs_norm: 0, hs_just: 0, hs_nojust: 0, hs_esp: 0, ext50: 0, ext100: 0 });
    const v = agg.get(k);
    v.hs_norm   += +d.hs_normales        || 0;
    v.hs_just   += +d.hs_justificadas    || 0;
    v.hs_nojust += +d.hs_no_justificadas || 0;
    v.hs_esp    += +d.hs_esperadas       || 0;
    v.ext50     += +d.hs_extra50         || 0;
    v.ext100    += +d.hs_extra100        || 0;
  });
  const get = (p, e, f) => agg.get(`${p}|${e}`)?.[f] || 0;

  const horasCIM = allPeriodos.map(p => Math.round(get(p, 'CIMOMET', 'hs_norm')));
  const horasCOM = allPeriodos.map(p => Math.round(get(p, 'COMOING', 'hs_norm')));
  const horasTot = allPeriodos.map((_, i) => horasCIM[i] + horasCOM[i]);
  const ausPct   = allPeriodos.map(p => {
    let trab = 0, aus = 0;
    EMPRESAS.forEach(e => { trab += get(p, e, 'hs_norm'); aus += get(p, e, 'hs_just') + get(p, e, 'hs_nojust'); });
    return trab + aus > 0 ? +((aus / (trab + aus)) * 100).toFixed(1) : 0;
  });
  const espTot   = allPeriodos.map(p => Math.round(EMPRESAS.reduce((s, e) => s + get(p, e, 'hs_esp'), 0)));
  const ext50Tot = allPeriodos.map(p => Math.round(EMPRESAS.reduce((s, e) => s + get(p, e, 'ext50'), 0)));
  const ext100Tot= allPeriodos.map(p => Math.round(EMPRESAS.reduce((s, e) => s + get(p, e, 'ext100'), 0)));

  // Totales globales
  const validRows = rows.filter(d => EMPRESAS.includes(d.empresa));
  const totalTrab = validRows.reduce((s, d) => s + (+d.hs_normales || 0), 0);
  const totalAus  = validRows.reduce((s, d) => s + (+d.hs_justificadas || 0) + (+d.hs_no_justificadas || 0), 0);
  const totalEsp  = validRows.reduce((s, d) => s + (+d.hs_esperadas || 0), 0);
  const totalExt50 = validRows.reduce((s, d) => s + (+d.hs_extra50 || 0), 0);
  const totalExt100= validRows.reduce((s, d) => s + (+d.hs_extra100 || 0), 0);
  const totalDiasPres   = validRows.reduce((s, d) => s + (+d.dias_presentes || 0), 0);
  const totalDiasNojust = validRows.reduce((s, d) => s + (+d.dias_ausentes_nojust || 0), 0);

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
  };
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

// ── Tabla de detalle de ausentismo por empleado ───────────────────────────────
function tablaDetalleAusentismo(rawGroup, periodo, filtroEmpresa, activosSet) {
  const filas = rawGroup
    .filter(d => d.periodo === periodo && EMPRESAS.includes(d.empresa) && (!filtroEmpresa || d.empresa === filtroEmpresa))
    .map(d => ({
      legajo:  d.legajo,
      nombre:  `${d.apellido || ''}, ${d.nombre || ''}`.trim().replace(/^,\s*/, ''),
      sector:  d.departamento || '—',
      empresa: d.empresa,
      just:    +d.hs_justificadas    || 0,
      nojust:  +d.hs_no_justificadas || 0,
      total:   (+d.hs_justificadas || 0) + (+d.hs_no_justificadas || 0),
      activo:  !activosSet || activosSet.has(String(d.legajo)),
    }))
    .filter(d => Math.round(d.total) > 0)
    .sort((a, b) => b.total - a.total);

  if (!filas.length) return '<p style="padding:16px;color:var(--color-texto-sec);font-size:0.85rem">Sin ausentismo registrado para el filtro seleccionado.</p>';

  const totalJust   = filas.reduce((s, d) => s + d.just, 0);
  const totalNojust = filas.reduce((s, d) => s + d.nojust, 0);

  const porSector = new Map();
  filas.forEach(d => {
    if (!porSector.has(d.sector)) porSector.set(d.sector, { just: 0, nojust: 0, count: 0 });
    const s = porSector.get(d.sector);
    s.just += d.just; s.nojust += d.nojust; s.count++;
  });

  let html = '';
  [...porSector.entries()]
    .sort((a, b) => (b[1].just + b[1].nojust) - (a[1].just + a[1].nojust))
    .forEach(([sector, st]) => {
      html += `<tr class="pind__det-sector-row"><td class="pind__det-sector" colspan="6">${sector}<span class="pind__det-sector-cnt">${st.count} empleado${st.count !== 1 ? 's' : ''} · ${fmtNum(st.just + st.nojust)}h total</span></td></tr>`;
      filas.filter(d => d.sector === sector).forEach((d, i) => {
        const expandId = `pind-det-exp-${d.legajo}-${periodo.replace(/-/g, '')}`;
        const rowStyle = d.activo ? '' : ' style="opacity:0.55"';
        const desvincTag = d.activo ? '' : '<span class="pind__tag-desvinc" title="Ya no figura como activo en el plantel">desvinculado</span>';
        html += `<tr class="pind__det-emp-row${d.activo ? '' : ' pind__det-emp-row--inactivo'}" data-legajo="${d.legajo}" data-periodo="${periodo}" data-expand="${expandId}" title="Clic para ver días"${rowStyle}>
          <td class="pind__res-td" style="width:28px;font-size:0.75rem"><span class="pind__det-expand-icon">▸</span></td>
          <td class="pind__res-td"><b style="font-size:0.875rem">${d.nombre || d.legajo}</b><span style="margin-left:6px;font-size:0.72rem;color:var(--color-texto-sec)">${d.legajo}</span>${desvincTag}</td>
          <td class="pind__res-td" style="font-size:0.8rem;color:${EMP_COLOR[d.empresa]};white-space:nowrap">${EMP_LABEL[d.empresa] || d.empresa}</td>
          <td class="pind__res-td pind__res-td--num" style="color:${Math.round(d.just) > 0 ? '#d97706' : 'var(--color-texto-sec)'}">${Math.round(d.just) > 0 ? fmtNum(d.just) : '—'}</td>
          <td class="pind__res-td pind__res-td--num" style="color:${Math.round(d.nojust) > 0 ? '#dc2626' : 'var(--color-texto-sec)'}">${Math.round(d.nojust) > 0 ? fmtNum(d.nojust) : '—'}</td>
          <td class="pind__res-td pind__res-td--num"><b>${fmtNum(d.total)}</b></td>
        </tr>
        <tr class="pind__det-expand-row" id="${expandId}" hidden>
          <td colspan="6" class="pind__det-expand-celda"><em class="pind__det-expand-loading">Cargando días…</em></td>
        </tr>`;
      });
    });

  return `<table class="pind__res-tabla">
    <thead><tr>
      <th class="pind__res-th">#</th>
      <th class="pind__res-th">Empleado</th>
      <th class="pind__res-th">Empresa</th>
      <th class="pind__res-th" style="text-align:right">Hs. Just.</th>
      <th class="pind__res-th" style="text-align:right">Hs. No just.</th>
      <th class="pind__res-th" style="text-align:right">Total</th>
    </tr></thead>
    <tbody>${html}</tbody>
    <tfoot><tr>
      <td class="pind__res-tf" colspan="3">Total (${filas.length} empleados)</td>
      <td class="pind__res-tf pind__res-tf--num">${fmtNum(totalJust)}</td>
      <td class="pind__res-tf pind__res-tf--num">${fmtNum(totalNojust)}</td>
      <td class="pind__res-tf pind__res-tf--num">${fmtNum(totalJust + totalNojust)}</td>
    </tr></tfoot>
  </table>`;
}

// ── Desglose diario de un empleado ────────────────────────────────────────────
function renderDias(dias) {
  const conAus = dias.filter(d => (+d.hs_justificadas || 0) + (+d.hs_no_justificadas || 0) > 0.005);
  if (!conAus.length) return '<em style="padding:10px 14px;display:block;color:var(--color-texto-sec);font-size:0.8rem">Sin días con ausentismo en este período.</em>';
  return `<table class="pind__dias-tabla">
    <thead><tr>
      <th class="pind__dias-th">Fecha</th>
      <th class="pind__dias-th">Tipo de novedad</th>
      <th class="pind__dias-th pind__dias-th--num">Hs. Just.</th>
      <th class="pind__dias-th pind__dias-th--num">Hs. No just.</th>
    </tr></thead>
    <tbody>${conAus.map(d => {
      const just = +d.hs_justificadas || 0, nojust = +d.hs_no_justificadas || 0;
      return `<tr>
        <td class="pind__dias-td pind__dias-td--fecha">${fmtFecha(d.fecha)}</td>
        <td class="pind__dias-td">${d.descripcion_tipo_hora || '—'}</td>
        <td class="pind__dias-td pind__dias-td--num" style="color:${just > 0 ? '#d97706' : 'var(--color-texto-sec)'}">${just > 0.005 ? fmtNum(just) : '—'}</td>
        <td class="pind__dias-td pind__dias-td--num" style="color:${nojust > 0 ? '#dc2626' : 'var(--color-texto-sec)'}">${nojust > 0.005 ? fmtNum(nojust) : '—'}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}

// ── HTML de la sección quincenal o mensual ────────────────────────────────────
function htmlSeccion(g, allPeriodos, id, titulo, acento) {
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
        <h2 class="pind__grupo-titulo">${titulo}</h2>
        <div class="pind__grupo-badges">
          ${g.empleadosActivos > 0 ? `<span class="pind__grupo-badge pind__grupo-badge--activo">${g.empleadosActivos} activos</span>` : ''}
          ${g.empleadosDesvinculados > 0 ? `<span class="pind__grupo-badge pind__grupo-badge--desvinc" title="Trabajaron este período pero ya no están activos">${g.empleadosDesvinculados} desvinculado${g.empleadosDesvinculados !== 1 ? 's' : ''}</span>` : ''}
        </div>
      </div>

      <!-- KPIs fila 1: horas -->
      <div class="pind__kpis pind__kpis--sm">
        <div class="pind__kpi">
          <span class="pind__kpi-num">${fmtNum(g.totalTrab)}</span>
          <span class="pind__kpi-lbl">Horas trabajadas</span>
          <span class="pind__kpi-sub">${fmtPeriodo(allPeriodos[0])} – ${fmtPeriodo(allPeriodos[allPeriodos.length - 1])}</span>
        </div>
        <div class="pind__kpi">
          <span class="pind__kpi-num" style="color:var(--color-texto-sec)">${fmtNum(g.totalEsp)}</span>
          <span class="pind__kpi-lbl">Horas esperadas</span>
          <span class="pind__kpi-sub">Según planilla Tango</span>
        </div>
        <div class="pind__kpi pind__kpi--dest">
          <span class="pind__kpi-num" style="color:${g.colorCumpl}">${g.cumplimiento}%</span>
          <span class="pind__kpi-lbl">Cumplimiento de horas</span>
          <span class="pind__kpi-sub">Trabajadas / Esperadas</span>
        </div>
      </div>

      <!-- KPIs fila 2: presentismo, ausentismo, extras -->
      <div class="pind__kpis pind__kpis--sm" style="margin-top:10px">
        <div class="pind__kpi pind__kpi--clickable" id="pind-kpi-aus-${id}" title="Ver detalle de ausentismo">
          <span class="pind__kpi-num" style="color:#dc2626">${fmtNum(g.totalAus)}</span>
          <span class="pind__kpi-lbl">Hs. ausentismo <span class="pind__kpi-ver">▸ Ver</span></span>
          <span class="pind__kpi-sub">Justificadas + sin justificar</span>
        </div>
        <div class="pind__kpi">
          <span class="pind__kpi-num" style="color:${g.colorIdx}">${g.idxAus}%</span>
          <span class="pind__kpi-lbl">Índice de ausentismo</span>
          <span class="pind__kpi-sub">Aus / (Trab + Aus)</span>
        </div>
        <div class="pind__kpi">
          <span class="pind__kpi-num" style="color:${g.colorPres}">${g.presGlobal}%</span>
          <span class="pind__kpi-lbl">Presentismo (días)</span>
          <span class="pind__kpi-sub">Días presentes / Días lab.</span>
        </div>
        ${g.totalExt50 > 0 ? `<div class="pind__kpi">
          <span class="pind__kpi-num" style="color:#7c3aed">${fmtNum(g.totalExt50)}h</span>
          <span class="pind__kpi-lbl">Horas extra 50%</span>
        </div>` : ''}
        ${g.totalExt100 > 0 ? `<div class="pind__kpi">
          <span class="pind__kpi-num" style="color:#dc2626">${fmtNum(g.totalExt100)}h</span>
          <span class="pind__kpi-lbl">Horas extra 100%</span>
        </div>` : ''}
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

      <!-- Sección presentismo por sector -->
      <div class="pind__dep-header">
        <span class="pind__dep-tit">Presentismo y extras por sector</span>
        <div style="display:flex;gap:8px;align-items:center">
          <select class="pind__detalle-sel" id="pind-dep-per-${id}">
            ${[...allPeriodos].reverse().map(p => `<option value="${p}">${fmtPeriodo(p)}</option>`).join('')}
          </select>
          <button class="pind__dep-toggle" id="pind-dep-btn-${id}">▸ Ver por sector</button>
        </div>
      </div>
      <div id="pind-dep-panel-${id}" hidden>
        <div class="pind__graf-grid" style="margin-top:var(--espacio-m)">
          <div class="pind__sec pind__graf-card" style="background:var(--color-fondo)">
            <h3 class="pind__sec-tit">Presentismo por sector (% días presente)</h3>
            <div id="pind-dep-pres-wrap-${id}" class="pind__graf-wrap pind__graf-wrap--tall"></div>
          </div>
          <div class="pind__sec pind__graf-card" style="background:var(--color-fondo)">
            <h3 class="pind__sec-tit">Horas extra por sector</h3>
            <div id="pind-dep-ext-wrap-${id}" class="pind__graf-wrap pind__graf-wrap--tall"></div>
          </div>
        </div>
      </div>
    </section>`;
}

export async function renderizarPresentismoIndicadores(contenedor) {
  destruirGraficos();
  contenedor.innerHTML = '<div class="pres__loading">Cargando indicadores…</div>';

  let rawHoras = [], empleados = [], rawAusTipo = [];
  try {
    const [rH, rE, rA] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/rrhh_horas_mensual?select=legajo,apellido,nombre,departamento,periodo,empresa,hs_normales,hs_esperadas,hs_extra50,hs_extra100,hs_justificadas,hs_no_justificadas,dias_laborables,dias_presentes,dias_ausentes_nojust&order=periodo.asc`, { headers: HDR }),
      fetch(`${SUPABASE_URL}/rest/v1/empleados?select=legajo,empresa,desc_puesto&activo=eq.true&limit=2000`, { headers: HDR }),
      fetch(`${SUPABASE_URL}/rest/v1/v_ausentismo_tipo?select=periodo,tipo,hs_total&order=periodo.asc`, { headers: HDR }),
    ]);
    if (rH.ok) rawHoras   = await rH.json();
    if (rE.ok) empleados  = await rE.json();
    if (rA.ok) rawAusTipo = await rA.json();
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

  // Clasificación
  const empMap = new Map();
  empleados.forEach(e => empMap.set(String(e.legajo), { isMensual: esMensual(e.desc_puesto) }));
  // Set de legajos activos (para marcar desvinculados)
  const activosSet = new Set(empleados.map(e => String(e.legajo)));

  const rawQ = rawHoras.filter(d => !empMap.get(String(d.legajo))?.isMensual);
  const rawM = rawHoras.filter(d =>  empMap.get(String(d.legajo))?.isMensual);

  const allPeriodos = [...new Set(rawHoras.filter(d => EMPRESAS.includes(d.empresa)).map(d => d.periodo))].sort();
  const ultimoPer   = allPeriodos[allPeriodos.length - 1];
  const labels      = allPeriodos.map(fmtPeriodo);
  const cargados    = new Set(rawHoras.filter(d => EMPRESAS.includes(d.empresa)).map(d => `${d.periodo}|${d.empresa}`));

  const gQ = calcularGrupo(rawQ, allPeriodos, activosSet);
  const gM = calcularGrupo(rawM, allPeriodos, activosSet);

  // Nómina
  const CIM_T = empleados.filter(e => e.empresa === 'CIMOMET' && !esMensual(e.desc_puesto)).length;
  const CIM_M = empleados.filter(e => e.empresa === 'CIMOMET' &&  esMensual(e.desc_puesto)).length;
  const COM_T = empleados.filter(e => e.empresa === 'COMOING' && !esMensual(e.desc_puesto)).length;
  const COM_M = empleados.filter(e => e.empresa === 'COMOING' &&  esMensual(e.desc_puesto)).length;
  const totalNomina = CIM_T + CIM_M + COM_T + COM_M;

  // Ausentismo por tipo
  const tipoTotales = new Map(), tipoPorPeriodo = new Map();
  rawAusTipo.forEach(d => {
    tipoTotales.set(d.tipo, (tipoTotales.get(d.tipo) || 0) + (+d.hs_total || 0));
    tipoPorPeriodo.set(`${d.tipo}|${d.periodo}`, +d.hs_total || 0);
  });
  const tiposOrdenados = [...tipoTotales.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  const totalAusTipoGen = [...tipoTotales.values()].reduce((s, v) => s + v, 0);

  contenedor.innerHTML = `<div class="pind">

    <!-- Calendario -->
    <section class="pind__sec">
      <h2 class="pind__sec-tit">
        <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
        Estado de carga por empresa y período
      </h2>
      <div class="pind__cal-scroll"><table class="pind__cal">
        <thead><tr>
          <th class="pind__cal-th">Período</th>
          ${EMPRESAS.map(e => `<th class="pind__cal-th">${EMP_LABEL[e]}</th>`).join('')}
          <th class="pind__cal-th pind__cal-th--cnt">Empleados</th>
        </tr></thead>
        <tbody>${[...allPeriodos].reverse().map(p => {
          const cnt = rawHoras.filter(d => d.periodo === p && EMPRESAS.includes(d.empresa)).length;
          return `<tr>
            <td class="pind__cal-td pind__cal-td--per">${fmtPeriodo(p)}</td>
            ${EMPRESAS.map(e => {
              const ok = cargados.has(`${p}|${e}`);
              return `<td class="pind__cal-td pind__cal-td--${ok ? 'ok' : 'no'}"><span class="pind__cal-pill pind__cal-pill--${ok ? 'ok' : 'no'}">${ok ? '✓ Cargado' : '— Sin datos'}</span></td>`;
            }).join('')}
            <td class="pind__cal-td pind__cal-td--cnt">${cnt}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
    </section>

    ${htmlSeccion(gQ, allPeriodos, 'q', 'Personal de taller — Quincenales', 'var(--color-primario)')}
    ${htmlSeccion(gM, allPeriodos, 'm', 'Personal administrativo — Mensuales', '#0d9488')}

    <!-- Composición nómina -->
    <section class="pind__sec">
      <h2 class="pind__sec-tit">
        <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        Composición de nómina (activos al día de hoy)
      </h2>
      <div class="pind__nomina-grid">
        <div class="pind__nomina-tarjetas">
          <div class="pind__nomina-card pind__nomina-card--cim">
            <div class="pind__nomina-emp">Cimomet</div><div class="pind__nomina-tot">${CIM_T + CIM_M}</div>
            <div class="pind__nomina-fila"><span>Taller</span><b>${CIM_T}</b></div>
            <div class="pind__nomina-fila"><span>Mensual</span><b>${CIM_M}</b></div>
          </div>
          <div class="pind__nomina-card pind__nomina-card--com">
            <div class="pind__nomina-emp">Co.mo.ing</div><div class="pind__nomina-tot">${COM_T + COM_M}</div>
            <div class="pind__nomina-fila"><span>Taller</span><b>${COM_T}</b></div>
            <div class="pind__nomina-fila"><span>Mensual</span><b>${COM_M}</b></div>
          </div>
          <div class="pind__nomina-total-box">
            <span class="pind__nomina-total-lbl">Total nómina</span>
            <span class="pind__nomina-total-num">${totalNomina}</span>
          </div>
        </div>
        <div class="pind__nomina-donut"><canvas id="pind-ch-comp"></canvas></div>
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
  function initCharts(g, sufijo, acento) {
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
  }

  initCharts(gQ, 'q', CIM_COLOR);
  initCharts(gM, 'm', COM_COLOR);

  // Donut nómina
  graficosActivos.push(new Chart(contenedor.querySelector('#pind-ch-comp').getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: ['Taller Cimomet', 'Taller Co.mo.ing', 'Mensual Cimomet', 'Mensual Co.mo.ing'],
      datasets: [{ data: [CIM_T, COM_T, CIM_M, COM_M],
        backgroundColor: [CIM_COLOR, COM_COLOR, CIM_COLOR + '88', COM_COLOR + '88'],
        borderWidth: 3, borderColor: 'var(--color-fondo-tarjeta, #fff)' }],
    },
    options: { responsive: true, maintainAspectRatio: false, cutout: '60%',
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 14 } },
        tooltip: { callbacks: { label: c => ` ${c.label}: ${c.parsed} (${totalNomina > 0 ? ((c.parsed / totalNomina) * 100).toFixed(1) : 0}%)` } } },
    },
  }));

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

    // Altura dinámica según cantidad de sectores
    const h = Math.max(220, deps.length * 34 + 40);
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
      extWrap.style.height = Math.max(220, conExtras.length * 34 + 40) + 'px';
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

  // ── Interactividad ────────────────────────────────────────────────────────
  ['q', 'm'].forEach(sufijo => {
    const rawGroup = sufijo === 'q' ? rawQ : rawM;

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
      if (tablaDiv) tablaDiv.innerHTML = tablaDetalleAusentismo(rawGroup, selPer.value, filtroEmpresa, activosSet);
    }

    kpiBtn?.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) refrescarTablaAus();
    });
    selPer?.addEventListener('change', refrescarTablaAus);
    btnClose?.addEventListener('click', () => { panel.hidden = true; });
    btnsFiltro.forEach(btn => btn.addEventListener('click', () => {
      filtroEmpresa = btn.dataset.emp;
      btnsFiltro.forEach(b => b.classList.toggle('pind__det-emp--activo', b === btn));
      refrescarTablaAus();
    }));

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
          const r = await fetch(`${SUPABASE_URL}/rest/v1/rrhh_horas_detalle?legajo=eq.${legajo}&periodo=eq.${per}&select=fecha,descripcion_tipo_hora,hs_justificadas,hs_no_justificadas&order=fecha.asc`, { headers: HDR });
          celda.innerHTML = renderDias(r.ok ? await r.json() : []);
          expandRow.dataset.loaded = '1';
        } catch { celda.innerHTML = '<em style="padding:10px;color:#dc2626">Error al cargar.</em>'; }
      }
    });

    // Panel por departamento
    const depBtn   = contenedor.querySelector(`#pind-dep-btn-${sufijo}`);
    const depPanel = contenedor.querySelector(`#pind-dep-panel-${sufijo}`);
    const depSel   = contenedor.querySelector(`#pind-dep-per-${sufijo}`);
    let depAbierto = false;

    depBtn?.addEventListener('click', () => {
      depAbierto = !depAbierto;
      depPanel.hidden = !depAbierto;
      depBtn.textContent = depAbierto ? '▾ Ocultar sectores' : '▸ Ver por sector';
      if (depAbierto) initDepCharts(rawGroup, sufijo, depSel?.value || ultimoPer);
    });
    depSel?.addEventListener('change', () => {
      if (depAbierto) initDepCharts(rawGroup, sufijo, depSel.value);
    });
  });
}
