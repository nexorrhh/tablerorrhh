import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';

const HDR = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

let graficosActivos = [];

function destruirGraficos() {
  graficosActivos.forEach(g => { try { g.destroy(); } catch {} });
  graficosActivos = [];
}

function formatearPeriodo(p) {
  const [y, m] = p.split('-');
  return `${MESES[+m - 1]} ${y}`;
}

export async function renderizarPresentismoResumen(contenedor, alIrACarga) {
  destruirGraficos();
  contenedor.innerHTML = '<div class="pres__loading">Cargando…</div>';

  let periodos = [];
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/rrhh_horas_mensual?select=periodo&order=periodo.desc`,
      { headers: HDR }
    );
    if (r.ok) {
      const rows = await r.json();
      periodos = [...new Set(rows.map(r => r.periodo))];
    }
  } catch {}

  if (!periodos.length) {
    contenedor.innerHTML = `
      <div class="estado-vacio">
        <div class="estado-vacio__icono">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
        </div>
        <h3 class="estado-vacio__titulo">Sin datos cargados</h3>
        <p class="estado-vacio__texto">No hay datos de horas disponibles. Importá el archivo de Tango desde la pestaña "Cargar datos".</p>
        ${typeof alIrACarga === 'function' ? `<button class="pres__btn-ir-carga" id="pres-ir-carga" type="button">Ir a Cargar datos →</button>` : ''}
      </div>
    `;
    contenedor.querySelector('#pres-ir-carga')?.addEventListener('click', alIrACarga);
    return;
  }

  let periodoActivo = periodos[0];

  contenedor.innerHTML = `
    <div class="pres__resumen-wrap">
      <div class="pres__periodo-bar">
        <label class="pres__periodo-lbl">Período:</label>
        <select class="pres__periodo-sel" id="pres-res-periodo">
          ${periodos.map(p => `<option value="${p}" ${p === periodoActivo ? 'selected' : ''}>${formatearPeriodo(p)}</option>`).join('')}
        </select>
      </div>
      <div id="pres-res-contenido"></div>
    </div>
  `;

  contenedor.querySelector('#pres-res-periodo').addEventListener('change', e => {
    periodoActivo = e.target.value;
    cargarYMostrar();
  });

  async function cargarYMostrar() {
    destruirGraficos();
    const div = contenedor.querySelector('#pres-res-contenido');
    div.innerHTML = '<div class="pres__loading">Cargando…</div>';

    let datos = [];
    try {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/rrhh_horas_mensual?periodo=eq.${periodoActivo}&order=apellido.asc`,
        { headers: HDR }
      );
      if (r.ok) datos = await r.json();
    } catch {}

    if (!datos.length) {
      div.innerHTML = '<div class="pres__vacio">Sin datos para este período.</div>';
      return;
    }

    // KPIs globales — presentismo por días, eficiencia por horas (dos métricas separadas)
    const totalDiasLab    = datos.reduce((s, d) => s + (+d.dias_laborables       || 0), 0);
    const totalDiasPres   = datos.reduce((s, d) => s + (+d.dias_presentes        || 0), 0);
    const totalDiasNojust = datos.reduce((s, d) => s + (+d.dias_ausentes_nojust  || 0), 0);
    const totalHsEsp      = datos.reduce((s, d) => s + (+d.hs_esperadas          || 0), 0);
    const totalHsNorm     = datos.reduce((s, d) => s + (+d.hs_normales           || 0), 0);
    const totalExt50      = datos.reduce((s, d) => s + (+d.hs_extra50            || 0), 0);
    const totalExt100     = datos.reduce((s, d) => s + (+d.hs_extra100           || 0), 0);
    const totalNoJust     = datos.reduce((s, d) => s + (+d.hs_no_justificadas    || 0), 0);
    const totalJust       = datos.reduce((s, d) => s + (+d.hs_justificadas       || 0), 0);

    const presGlobal = (totalDiasPres + totalDiasNojust) > 0
      ? ((totalDiasPres / (totalDiasPres + totalDiasNojust)) * 100).toFixed(1)
      : '—';
    const eficHs = totalHsEsp > 0
      ? ((totalHsNorm / totalHsEsp) * 100).toFixed(1)
      : '—';
    const hsNoCumplidas = Math.max(0, totalHsEsp - totalHsNorm);

    const colorPres = +presGlobal >= 95 ? '#16a34a' : +presGlobal >= 90 ? '#d97706' : '#dc2626';
    const colorEfic = +eficHs   >= 95 ? '#16a34a' : +eficHs   >= 90 ? '#d97706' : '#dc2626';
    const colorNoCumpl = hsNoCumplidas === 0 ? '#16a34a' : +eficHs >= 95 ? '#d97706' : '#dc2626';

    // Agrupado por departamento (para gráficos)
    const porDep = new Map();
    datos.forEach(d => {
      const dep = d.departamento || 'Sin departamento';
      if (!porDep.has(dep)) porDep.set(dep, {
        diasPres: 0, diasNojust: 0, hsEsp: 0, hsNorm: 0,
        ext50: 0, ext100: 0, count: 0,
      });
      const x = porDep.get(dep);
      x.diasPres   += +d.dias_presentes       || 0;
      x.diasNojust += +d.dias_ausentes_nojust || 0;
      x.hsEsp      += +d.hs_esperadas         || 0;
      x.hsNorm     += +d.hs_normales          || 0;
      x.ext50      += +d.hs_extra50           || 0;
      x.ext100     += +d.hs_extra100          || 0;
      x.count++;
    });

    // Ordenar por presentismo ascendente (peor primero, para que resalten los problemas)
    const depsSorted = [...porDep.entries()]
      .map(([dep, v]) => ({
        dep,
        pres:   (v.diasPres + v.diasNojust) > 0 ? +((v.diasPres / (v.diasPres + v.diasNojust)) * 100).toFixed(1) : 100,
        eficHs: v.hsEsp > 0 ? +(v.hsNorm / v.hsEsp * 100).toFixed(1) : 100,
        ext50:  +v.ext50.toFixed(1),
        ext100: +v.ext100.toFixed(1),
        count:  v.count,
      }))
      .sort((a, b) => a.pres - b.pres);

    const hayExt100 = totalExt100 > 0;

    div.innerHTML = `
      <div class="pres__kpis">
        <div class="pres__kpi">
          <span class="pres__kpi-num">${datos.length}</span>
          <span class="pres__kpi-lbl">Empleados</span>
        </div>
        <div class="pres__kpi pres__kpi--destacado">
          <span class="pres__kpi-num" style="color:${colorPres}">${presGlobal}%</span>
          <span class="pres__kpi-lbl">Presentismo (días)</span>
          <span class="pres__kpi-sub">${totalDiasPres} de ${totalDiasPres + totalDiasNojust} días</span>
        </div>
        <div class="pres__kpi pres__kpi--destacado">
          <span class="pres__kpi-num" style="color:${colorEfic}">${eficHs}%</span>
          <span class="pres__kpi-lbl">Cumplimiento de horas</span>
          <span class="pres__kpi-sub">${totalHsNorm.toFixed(0)}h trabajadas de ${totalHsEsp.toFixed(0)}h esperadas</span>
        </div>
        <div class="pres__kpi pres__kpi--destacado">
          <span class="pres__kpi-num" style="color:${colorNoCumpl}">${hsNoCumplidas.toFixed(0)}h</span>
          <span class="pres__kpi-lbl">Horas no cumplidas</span>
          <span class="pres__kpi-sub">${totalHsEsp.toFixed(0)}h esperadas − ${totalHsNorm.toFixed(0)}h trabajadas</span>
        </div>
        ${totalExt50 > 0 ? `
        <div class="pres__kpi">
          <span class="pres__kpi-num" style="color:#7c3aed">${totalExt50.toFixed(0)}h</span>
          <span class="pres__kpi-lbl">Horas extra 50%</span>
        </div>` : ''}
        ${hayExt100 ? `
        <div class="pres__kpi">
          <span class="pres__kpi-num" style="color:#dc2626">${totalExt100.toFixed(0)}h</span>
          <span class="pres__kpi-lbl">Horas extra 100%</span>
        </div>` : ''}
      </div>

      <div class="pres__graficos-grid">
        <div class="pres__graf-card">
          <h3 class="pres__graf-titulo">Presentismo por departamento <span class="pres__graf-subtit">(% días presente)</span></h3>
          <div class="pres__graf-wrap"><canvas id="pres-chart-pres"></canvas></div>
        </div>
        <div class="pres__graf-card">
          <h3 class="pres__graf-titulo">Horas extra por departamento</h3>
          <div id="pres-ext-wrap" class="pres__graf-wrap"><canvas id="pres-chart-ext"></canvas></div>
        </div>
      </div>
    `;

    if (typeof Chart === 'undefined') return;

    const minPres = Math.max(0, Math.min(...depsSorted.map(d => d.pres)) - 3);

    // Gráfico 1: Presentismo % por días
    const ctx1 = div.querySelector('#pres-chart-pres').getContext('2d');
    graficosActivos.push(new Chart(ctx1, {
      type: 'bar',
      data: {
        labels: depsSorted.map(d => d.dep),
        datasets: [{
          label: '% Presentismo',
          data:  depsSorted.map(d => d.pres),
          backgroundColor: depsSorted.map(d =>
            d.pres >= 95 ? '#16a34a' : d.pres >= 90 ? '#d97706' : '#dc2626'
          ),
          borderRadius: 4,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            min: minPres, max: 100,
            ticks: { callback: v => v + '%' },
            grid: { color: 'rgba(0,0,0,0.06)' },
          },
          y: { ticks: { font: { size: 11 } } },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label:      ctx => ` ${ctx.parsed.x}% presentismo`,
              afterLabel: ctx => ` ${depsSorted[ctx.dataIndex].count} empleados`,
            },
          },
        },
      },
    }));

    // Gráfico 2: Horas extra por departamento
    const conExtras = depsSorted
      .filter(d => d.ext50 + d.ext100 > 0)
      .sort((a, b) => (b.ext50 + b.ext100) - (a.ext50 + a.ext100));

    if (!conExtras.length) {
      div.querySelector('#pres-ext-wrap').innerHTML =
        '<p class="pres__vacio-small">Sin horas extra este período.</p>';
      return;
    }

    const datasets = [{
      label: 'Extra 50%',
      data:  conExtras.map(d => d.ext50),
      backgroundColor: '#7c3aed',
      borderRadius: 4,
      stack: 'ext',
    }];
    if (hayExt100) {
      datasets.push({
        label: 'Extra 100%',
        data:  conExtras.map(d => d.ext100),
        backgroundColor: '#dc2626',
        borderRadius: 4,
        stack: 'ext',
      });
    }

    const ctx2 = div.querySelector('#pres-chart-ext').getContext('2d');
    graficosActivos.push(new Chart(ctx2, {
      type: 'bar',
      data: { labels: conExtras.map(d => d.dep), datasets },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { callback: v => v + 'h' }, grid: { color: 'rgba(0,0,0,0.06)' } },
          y: { ticks: { font: { size: 11 } } },
        },
        plugins: {
          legend:  { display: hayExt100, position: 'top' },
          tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.x}h` } },
        },
      },
    }));
  }

  cargarYMostrar();
}
