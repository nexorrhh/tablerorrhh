import { obtenerTabla } from '../data/cliente-supabase.js';

const COLOR_GREEN  = '#16a34a';
const COLOR_AMBER  = '#d97706';
const COLOR_RED    = '#dc2626';
const COLOR_PURPLE = '#7c3aed';
const COLOR_BLUE   = '#1a4a7a';

const DIAS         = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
const LIMITE       = 10;   // filas visibles antes de "Ver más"

const graficosActivos = [];

export async function renderizarSabadosResumen(contenedor) {
  graficosActivos.forEach(c => c.destroy());
  graficosActivos.length = 0;

  contenedor.innerHTML = `<p class="plantel__cargando">Cargando datos de operativos…</p>`;

  let fechas, personas;
  try {
    [fechas, personas] = await Promise.all([
      obtenerTabla('v_resumen_fecha'),
      obtenerTabla('v_cumplimiento_persona'),
    ]);
  } catch (e) {
    contenedor.innerHTML = `
      <div class="estado-vacio">
        <div class="estado-vacio__icono">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
               stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
        <h3 class="estado-vacio__titulo">Error al cargar datos</h3>
        <p class="estado-vacio__texto">No se pudieron obtener los datos de operativos.</p>
      </div>`;
    return;
  }

  // Normalizar tipos numéricos
  fechas.forEach(f => {
    f.convocados    = +f.convocados;
    f.presentes     = +f.presentes;
    f.ausentes      = +f.ausentes;
    f.no_convocados = +f.no_convocados;
    f.pct           = +f.pct_cumplimiento;
  });
  personas.forEach(p => {
    p.convocado    = +p.convocado;
    p.presente     = +p.presente;
    p.ausente      = +p.ausente;
    p.no_convocado = +p.no_convocado;
    p.pct          = +p.pct_cumplimiento;
  });

  // KPIs globales
  const totConv    = fechas.reduce((s, f) => s + f.convocados, 0);
  const totPres    = fechas.reduce((s, f) => s + f.presentes, 0);
  const totAus     = fechas.reduce((s, f) => s + f.ausentes, 0);
  const totNoc     = fechas.reduce((s, f) => s + f.no_convocados, 0);
  const cantSab    = fechas.filter(f => f.tipo === 'Sabado').length;
  const cantDomFer = fechas.length - cantSab;
  const pctGlobal  = totConv > 0 ? Math.round(totPres / totConv * 100) : 0;

  contenedor.innerHTML = `
    <div class="sabres">

      <!-- ── KPIs ── -->
      <div class="sabres__kpis">
        ${kpiCard(fechas.length,    'Operativos',         `${cantSab} sáb. · ${cantDomFer} dom/fer.`, COLOR_PURPLE)}
        ${kpiCard(totConv,          'Convocatorias',      'total acumulado', COLOR_BLUE)}
        ${kpiCard(totPres,          'Presentes',          'total acumulado', COLOR_GREEN)}
        ${kpiCard(totAus,           'Ausentes',           'total acumulado', COLOR_RED)}
        ${kpiCard(totNoc,           'No convocados',      'vinieron sin citar', COLOR_AMBER)}
        ${kpiCard(pctGlobal + '%',  'Cumplimiento global','presentes / convocados', colorPct(pctGlobal))}
      </div>

      <!-- ── Gráficos ── -->
      <div class="sabres__graficos">
        <div class="sabres__graf-card sabres__graf-card--wide">
          <h3 class="sabres__graf-titulo">Cumplimiento por operativo</h3>
          <div class="sabres__canvas-wrap"><canvas id="sabres-evo"></canvas></div>
        </div>
        <div class="sabres__graf-card">
          <h3 class="sabres__graf-titulo">Asistencia acumulada</h3>
          <div class="sabres__canvas-wrap sabres__canvas-wrap--small">
            <canvas id="sabres-dona"></canvas>
          </div>
        </div>
      </div>

      <!-- ── Detalle (toggle operativo / persona) ── -->
      <div class="sabres__seccion">

        <div class="sabres__seccion-header">
          <h3 class="sabres__seccion-titulo">Detalle</h3>
          <div class="sabres__header-actions">
            <div class="sabres__toggle-group" id="sabres-toggle">
              <button class="sabres__toggle sabres__toggle--activo" data-vista="op">
                Por operativo
              </button>
              <button class="sabres__toggle" data-vista="per">
                Por persona
              </button>
            </div>
            <button class="sabres__export-btn" id="sabres-export">
              <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"
                   viewBox="0 0 24 24" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Descargar Excel
            </button>
          </div>
        </div>

        <!-- Vista: Por operativo -->
        <div id="sabres-vista-op">
          <div class="sabres__vista-subheader">
            <div class="sabres__filtros-bar">
              <div class="sabres__tabs" id="sabres-tabs-tipo">
                <button class="sabres__tab sabres__tab--activo" data-filter="todos">Todos</button>
                <button class="sabres__tab" data-filter="Sabado">Sábados</button>
                <button class="sabres__tab" data-filter="domfer">Dom. y Feriados</button>
              </div>
              <input type="search" class="sabres__filtro-busqueda" id="sabres-busq-op"
                     placeholder="Buscar por fecha o día…" autocomplete="off">
            </div>
          </div>
          <div class="sabres__tabla-wrap">
            <table class="sabres__tabla">
              <thead>
                <tr>
                  <th>Fecha</th><th>Día</th><th>Tipo</th>
                  <th class="sabres__td--right">Convocados</th>
                  <th class="sabres__td--right">Presentes</th>
                  <th class="sabres__td--right">Ausentes</th>
                  <th class="sabres__td--right">No conv.</th>
                  <th>Cumplimiento</th>
                </tr>
              </thead>
              <tbody id="sabres-tbody-op"></tbody>
            </table>
          </div>
          <div class="sabres__ver-mas-wrap" id="sabres-ver-mas-op-wrap">
            <button class="sabres__ver-mas-btn" id="sabres-ver-mas-op">Ver más</button>
          </div>
        </div>

        <!-- Vista: Por persona (oculta por defecto) -->
        <div id="sabres-vista-per" hidden>
          <div class="sabres__vista-subheader">
            <div class="sabres__filtros-bar">
              <div class="sabres__empresa-pills" id="sabres-pills-per">
                <button class="sabres__emp-pill sabres__emp-pill--activo" data-empresa="">Todos</button>
                <button class="sabres__emp-pill" data-empresa="CIMOMET">Cimomet</button>
                <button class="sabres__emp-pill" data-empresa="COMOING">Co.mo.ing</button>
              </div>
              <input type="search" class="sabres__filtro-busqueda" id="sabres-busq-per"
                     placeholder="Buscar por nombre…" autocomplete="off">
            </div>
          </div>
          <div class="sabres__tabla-wrap">
            <table class="sabres__tabla">
              <thead>
                <tr>
                  <th>Legajo</th><th>Apellido y nombre</th><th>Empresa</th>
                  <th class="sabres__td--right">Conv.</th>
                  <th class="sabres__td--right">Pres.</th>
                  <th class="sabres__td--right">Aus.</th>
                  <th class="sabres__td--right">No conv.</th>
                  <th>Cumplimiento</th>
                </tr>
              </thead>
              <tbody id="sabres-tbody-per"></tbody>
            </table>
          </div>
          <div class="sabres__ver-mas-wrap" id="sabres-ver-mas-per-wrap">
            <button class="sabres__ver-mas-btn" id="sabres-ver-mas-per">Ver más</button>
          </div>
        </div>

      </div>
    </div>
  `;

  // ── Estado interno ──────────────────────────────────────────────────────────
  let filtroTipo     = 'todos';
  let filtroTextoOp  = '';
  let filtroTextoPer = '';
  let filtroEmpresaPer = '';
  let expandedOp  = false;
  let expandedPer = false;

  function listaFechasFiltrada() {
    let lista = [...fechas];
    if (filtroTipo === 'Sabado') lista = lista.filter(f => f.tipo === 'Sabado');
    if (filtroTipo === 'domfer') lista = lista.filter(f => f.tipo !== 'Sabado');
    if (filtroTextoOp) {
      const txt = filtroTextoOp.toLowerCase();
      lista = lista.filter(f =>
        fmtFecha(f.fecha).toLowerCase().includes(txt) ||
        (f.dia_semana || '').toLowerCase().includes(txt) ||
        f.fecha.includes(txt)
      );
    }
    return lista.sort((a, b) => b.fecha.localeCompare(a.fecha));
  }

  function actualizarTablaOp() {
    const lista    = listaFechasFiltrada();
    const visibles = expandedOp ? lista : lista.slice(0, LIMITE);
    const tbody    = contenedor.querySelector('#sabres-tbody-op');
    tbody.innerHTML = visibles.length
      ? visibles.map(filaFecha).join('')
      : `<tr><td colspan="8" class="sabres__td--vacio">Sin operativos para este filtro</td></tr>`;

    const wrap = contenedor.querySelector('#sabres-ver-mas-op-wrap');
    const btn  = contenedor.querySelector('#sabres-ver-mas-op');
    wrap.hidden = lista.length <= LIMITE;
    if (!wrap.hidden) {
      btn.textContent = expandedOp
        ? 'Ver menos'
        : `Ver más — ${lista.length - LIMITE} operativos más`;
    }
  }

  function actualizarTablaPersonas() {
    let lista = [...personas].sort((a, b) =>
      (a.apellido_y_nombre || '').localeCompare(b.apellido_y_nombre || '', 'es', { sensitivity: 'base' })
    );
    if (filtroEmpresaPer) lista = lista.filter(p => p.empresa === filtroEmpresaPer);
    if (filtroTextoPer) {
      const txt = filtroTextoPer.toLowerCase();
      lista = lista.filter(p => (p.apellido_y_nombre || '').toLowerCase().includes(txt));
    }
    const visibles = expandedPer ? lista : lista.slice(0, LIMITE);
    const tbody    = contenedor.querySelector('#sabres-tbody-per');
    tbody.innerHTML = visibles.length
      ? visibles.map(filaPersona).join('')
      : `<tr><td colspan="8" class="sabres__td--vacio">Sin personas para los filtros seleccionados</td></tr>`;

    const wrap = contenedor.querySelector('#sabres-ver-mas-per-wrap');
    const btn  = contenedor.querySelector('#sabres-ver-mas-per');
    wrap.hidden = lista.length <= LIMITE;
    if (!wrap.hidden) {
      btn.textContent = expandedPer
        ? 'Ver menos'
        : `Ver más — ${lista.length - LIMITE} personas más`;
    }
  }

  // Render inicial
  actualizarTablaOp();
  actualizarTablaPersonas();

  // ── Toggle Por operativo / Por persona ─────────────────────────────────────
  contenedor.querySelectorAll('.sabres__toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      contenedor.querySelectorAll('.sabres__toggle').forEach(b => b.classList.remove('sabres__toggle--activo'));
      btn.classList.add('sabres__toggle--activo');
      const esOp = btn.dataset.vista === 'op';
      contenedor.querySelector('#sabres-vista-op').hidden  = !esOp;
      contenedor.querySelector('#sabres-vista-per').hidden = esOp;
    });
  });

  // ── Tabs de tipo (Todos / Sábados / Dom.Fer) ───────────────────────────────
  contenedor.querySelectorAll('#sabres-tabs-tipo .sabres__tab').forEach(btn => {
    btn.addEventListener('click', () => {
      contenedor.querySelectorAll('#sabres-tabs-tipo .sabres__tab')
        .forEach(t => t.classList.remove('sabres__tab--activo'));
      btn.classList.add('sabres__tab--activo');
      filtroTipo = btn.dataset.filter;
      expandedOp = false;   // resetear expansión al cambiar filtro
      actualizarTablaOp();
    });
  });

  // ── Ver más / Ver menos ────────────────────────────────────────────────────
  contenedor.querySelector('#sabres-ver-mas-op').addEventListener('click', () => {
    expandedOp = !expandedOp;
    actualizarTablaOp();
  });

  contenedor.querySelector('#sabres-ver-mas-per').addEventListener('click', () => {
    expandedPer = !expandedPer;
    actualizarTablaPersonas();
  });

  // ── Búsqueda por fecha/día (operativo) ────────────────────────────────────
  contenedor.querySelector('#sabres-busq-op').addEventListener('input', e => {
    filtroTextoOp = e.target.value.trim();
    expandedOp = false;
    actualizarTablaOp();
  });

  // ── Empresa pills (persona) ────────────────────────────────────────────────
  contenedor.querySelectorAll('#sabres-pills-per .sabres__emp-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      contenedor.querySelectorAll('#sabres-pills-per .sabres__emp-pill')
        .forEach(b => b.classList.remove('sabres__emp-pill--activo'));
      btn.classList.add('sabres__emp-pill--activo');
      filtroEmpresaPer = btn.dataset.empresa;
      expandedPer = false;
      actualizarTablaPersonas();
    });
  });

  // ── Búsqueda por nombre (persona) ─────────────────────────────────────────
  contenedor.querySelector('#sabres-busq-per').addEventListener('input', e => {
    filtroTextoPer = e.target.value.trim();
    expandedPer = false;
    actualizarTablaPersonas();
  });

  // ── Exportar CSV ────────────────────────────────────────────────────────────
  contenedor.querySelector('#sabres-export').addEventListener('click', () => {
    exportarExcel(fechas, personas);
  });

  // ── Gráficos ────────────────────────────────────────────────────────────────
  const g1 = crearLineaEvo(fechas);
  const g2 = crearDonaAsistencia(totPres, totAus, totNoc);
  if (g1) graficosActivos.push(g1);
  if (g2) graficosActivos.push(g2);
}

// ── Filas de tablas ───────────────────────────────────────────────────────────

function filaFecha(f) {
  const pct = Math.round(f.pct);
  const col = colorPct(pct);
  return `
    <tr>
      <td class="sabres__td--mono">${fmtFecha(f.fecha)}</td>
      <td>${f.dia_semana || diaDe(f.fecha)}</td>
      <td>${tipoBadge(f.tipo)}</td>
      <td class="sabres__td--right sabres__td--num">${f.convocados}</td>
      <td class="sabres__td--right sabres__td--verde">${f.presentes}</td>
      <td class="sabres__td--right sabres__td--rojo">${f.ausentes}</td>
      <td class="sabres__td--right sabres__td--muted">${f.no_convocados}</td>
      <td>${barraComp(pct, col)}</td>
    </tr>`;
}

function filaPersona(p) {
  const pct = Math.round(p.pct);
  const col = colorPct(pct);
  const badge = p.empresa === 'CIMOMET'
    ? `<span class="plantel__badge plantel__badge--cimomet">Cimomet</span>`
    : `<span class="plantel__badge plantel__badge--comoing">Co.mo.ing</span>`;
  return `
    <tr>
      <td><span class="sabres__legajo">${p.legajo}</span></td>
      <td class="sabres__td--nombre">${p.apellido_y_nombre}</td>
      <td>${badge}</td>
      <td class="sabres__td--right sabres__td--num">${p.convocado}</td>
      <td class="sabres__td--right sabres__td--verde">${p.presente}</td>
      <td class="sabres__td--right sabres__td--rojo">${p.ausente}</td>
      <td class="sabres__td--right sabres__td--muted">${p.no_convocado}</td>
      <td>${barraComp(pct, col)}</td>
    </tr>`;
}

// ── Gráficos ──────────────────────────────────────────────────────────────────

function crearLineaEvo(fechas) {
  const canvas = document.getElementById('sabres-evo');
  if (!canvas || typeof Chart === 'undefined') return null;
  const ord = [...fechas].sort((a, b) => a.fecha.localeCompare(b.fecha));
  return new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: ord.map(f => fmtFecha(f.fecha).slice(0, 5)),
      datasets: [{
        label: '% Cumplimiento',
        data: ord.map(f => Math.round(f.pct)),
        borderColor: COLOR_PURPLE,
        backgroundColor: 'rgba(124,58,237,0.07)',
        fill: true, tension: 0.3,
        pointRadius: 4, pointBackgroundColor: COLOR_PURPLE, borderWidth: 2,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { min: 0, max: 100, ticks: { callback: v => v + '%', font: { size: 11 } }, grid: { color: '#f1f5f9' } },
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
      },
    },
  });
}

function crearDonaAsistencia(presentes, ausentes, noConvocados) {
  const canvas = document.getElementById('sabres-dona');
  if (!canvas || typeof Chart === 'undefined') return null;
  return new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: ['Presentes', 'Ausentes', 'No convocados'],
      datasets: [{
        data: [presentes, ausentes, noConvocados],
        backgroundColor: [COLOR_GREEN, COLOR_RED, '#94a3b8'],
        borderWidth: 2, borderColor: '#ffffff',
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '62%',
      plugins: { legend: { position: 'bottom', labels: { padding: 14, font: { size: 12 } } } },
    },
  });
}

// ── Exportar Excel ────────────────────────────────────────────────────────────

function exportarExcel(fechas, personas) {
  if (typeof XLSX === 'undefined') {
    alert('La librería de Excel no está disponible. Verificá la conexión a internet.');
    return;
  }

  const wb = XLSX.utils.book_new();

  // Hoja 1: Por operativo
  const datosOp = [
    ['Fecha', 'Día', 'Tipo', 'Convocados', 'Presentes', 'Ausentes', 'No convocados', '% Cumplimiento'],
    ...[...fechas].sort((a, b) => b.fecha.localeCompare(a.fecha)).map(f => [
      fmtFecha(f.fecha),
      f.dia_semana || diaDe(f.fecha),
      f.tipo === 'Sabado' ? 'Sábado' : f.tipo,
      f.convocados,
      f.presentes,
      f.ausentes,
      f.no_convocados,
      Math.round(f.pct),
    ]),
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(datosOp);
  ws1['!cols'] = [14, 12, 10, 12, 12, 10, 14, 16].map(w => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws1, 'Por operativo');

  // Hoja 2: Por persona
  const datosPer = [
    ['Legajo', 'Apellido y nombre', 'Empresa', 'Convocado', 'Presente', 'Ausente', 'No convocado', '% Cumplimiento'],
    ...[...personas].sort((a, b) =>
      (a.apellido_y_nombre || '').localeCompare(b.apellido_y_nombre || '', 'es', { sensitivity: 'base' })
    ).map(p => [
      p.legajo,
      p.apellido_y_nombre,
      p.empresa,
      p.convocado,
      p.presente,
      p.ausente,
      p.no_convocado,
      Math.round(p.pct),
    ]),
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(datosPer);
  ws2['!cols'] = [10, 30, 12, 12, 10, 10, 14, 16].map(w => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws2, 'Por persona');

  XLSX.writeFile(wb, `Citaciones_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ── Helpers de render ─────────────────────────────────────────────────────────

function kpiCard(valor, label, sub, color) {
  return `
    <div class="sabres__kpi" style="border-left-color:${color}">
      <p class="sabres__kpi-label">${label}</p>
      <p class="sabres__kpi-valor" style="color:${color}">${valor}</p>
      <p class="sabres__kpi-sub">${sub}</p>
    </div>`;
}

function barraComp(pct, color) {
  return `
    <div class="sabres__comp">
      <div class="sabres__comp-track">
        <div class="sabres__comp-fill" style="width:${pct}%;background:${color}"></div>
      </div>
      <span class="sabres__comp-pct" style="color:${color}">${pct}%</span>
    </div>`;
}

function tipoBadge(tipo) {
  const cls = tipo === 'Sabado' ? 'sabres__tipo-tag--sab'
            : tipo === 'Domingo' ? 'sabres__tipo-tag--dom'
            : 'sabres__tipo-tag--fer';
  const txt = tipo === 'Sabado' ? 'Sábado' : tipo === 'Domingo' ? 'Domingo' : 'Feriado';
  return `<span class="sabres__tipo-tag ${cls}">${txt}</span>`;
}

function colorPct(pct) {
  return pct >= 80 ? COLOR_GREEN : pct >= 60 ? COLOR_AMBER : COLOR_RED;
}

function fmtFecha(f) {
  return new Date(f + 'T00:00:00').toLocaleDateString('es-AR',
    { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function diaDe(f) {
  return DIAS[new Date(f + 'T00:00:00').getDay()];
}
