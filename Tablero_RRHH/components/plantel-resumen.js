import { obtenerTabla } from '../data/cliente-supabase.js';

const COLOR_CIMOMET   = '#1a4a7a';
const COLOR_COMOING   = '#00838f';
const COLOR_MENSUAL   = '#7c3aed';
const COLOR_QUINCENAL = '#d97706';

// Puestos que liquidan mensualmente. El resto son quincenales.
const PUESTOS_MENSUALES = new Set([
  'Calidad', 'Ingenieria', 'Gerencia', 'Administracion',
  'Responsable de Produccion', 'RRHH', 'Coordinación de producción',
  'Recepción y Despacho', 'Presupuestos', 'Seguridad & Higiene',
]);

// Instancias activas de Chart.js — destruir antes de re-render.
const graficosActivos = [];

export async function renderizarPlantelResumen(contenedor) {
  graficosActivos.forEach(c => c.destroy());
  graficosActivos.length = 0;

  contenedor.innerHTML = `<p class="plantel__cargando">Cargando datos del plantel…</p>`;

  let empleados;
  try {
    empleados = await obtenerTabla('v_empleados_activos', 'empresa,desc_puesto');
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
        <p class="estado-vacio__texto">No se pudieron obtener los datos del plantel. Verificá la conexión.</p>
      </div>`;
    return;
  }

  // Normalizar puestos
  empleados.forEach(e => { e.desc_puesto = normalizarPuesto(e.desc_puesto); });

  const total      = empleados.length;
  const cimomet    = empleados.filter(e => e.empresa === 'CIMOMET').length;
  const comoing    = empleados.filter(e => e.empresa === 'COMOING').length;
  const mensuales  = empleados.filter(e => PUESTOS_MENSUALES.has(e.desc_puesto));
  const quincenales = empleados.filter(e => !PUESTOS_MENSUALES.has(e.desc_puesto));

  const mensCim  = mensuales.filter(e => e.empresa === 'CIMOMET').length;
  const mensCom  = mensuales.filter(e => e.empresa === 'COMOING').length;
  const quinCim  = quincenales.filter(e => e.empresa === 'CIMOMET').length;
  const quinCom  = quincenales.filter(e => e.empresa === 'COMOING').length;

  const mapMensual   = agruparPorPuesto(mensuales);
  const mapQuincenal = agruparPorPuesto(quincenales);
  const maxMens  = Math.max(...Object.values(mapMensual).map(v => v.total), 1);
  const maxQuin  = Math.max(...Object.values(mapQuincenal).map(v => v.total), 1);

  contenedor.innerHTML = `
    <div class="plantel">

      <!-- ── KPIs ── -->
      <div class="plantel__stats plantel__stats--5">
        <div class="plantel__stat-card plantel__stat-card--total">
          <p class="plantel__stat-valor">${total}</p>
          <p class="plantel__stat-label">Total plantel activo</p>
        </div>
        <div class="plantel__stat-card" style="border-top-color:${COLOR_CIMOMET}">
          <p class="plantel__stat-valor" style="color:${COLOR_CIMOMET}">${cimomet}</p>
          <p class="plantel__stat-label">Cimomet S.A.</p>
        </div>
        <div class="plantel__stat-card" style="border-top-color:${COLOR_COMOING}">
          <p class="plantel__stat-valor" style="color:${COLOR_COMOING}">${comoing}</p>
          <p class="plantel__stat-label">Co.mo.ing S.R.L.</p>
        </div>
        <div class="plantel__stat-card" style="border-top-color:${COLOR_MENSUAL}">
          <p class="plantel__stat-valor" style="color:${COLOR_MENSUAL}">${mensuales.length}</p>
          <p class="plantel__stat-label">Mensuales</p>
        </div>
        <div class="plantel__stat-card" style="border-top-color:${COLOR_QUINCENAL}">
          <p class="plantel__stat-valor" style="color:${COLOR_QUINCENAL}">${quincenales.length}</p>
          <p class="plantel__stat-label">Quincenales</p>
        </div>
      </div>

      <!-- ── Gráficos ── -->
      <div class="plantel__graficos">

        <div class="plantel__grafico-card">
          <h3 class="plantel__grafico-titulo">Distribución por empresa</h3>
          <div class="plantel__grafico-wrap">
            <canvas id="grafico-empresas" width="160" height="160"></canvas>
          </div>
          <div class="plantel__grafico-leyenda">
            ${filaLeyenda(COLOR_CIMOMET, 'Cimomet', cimomet, total)}
            ${filaLeyenda(COLOR_COMOING, 'Co.mo.ing', comoing, total)}
          </div>
        </div>

        <div class="plantel__grafico-card">
          <h3 class="plantel__grafico-titulo">Sector de liquidación</h3>
          <div class="plantel__grafico-wrap">
            <canvas id="grafico-sectores" width="160" height="160"></canvas>
          </div>
          <div class="plantel__grafico-leyenda">
            ${filaLeyenda(COLOR_MENSUAL, 'Mensuales', mensuales.length, total)}
            ${filaLeyenda(COLOR_QUINCENAL, 'Quincenales', quincenales.length, total)}
          </div>
        </div>

        <div class="plantel__grafico-card">
          <h3 class="plantel__grafico-titulo">Cruce empresa × sector</h3>
          <table class="plantel__cruce-tabla">
            <thead>
              <tr>
                <th></th>
                <th><span class="plantel__badge plantel__badge--mensual">Mensual</span></th>
                <th><span class="plantel__badge plantel__badge--quincenal">Quincenal</span></th>
                <th class="plantel__cruce-th-total">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td class="plantel__cruce-empresa" style="color:${COLOR_CIMOMET}">Cimomet</td>
                <td>${mensCim}</td>
                <td>${quinCim}</td>
                <td class="plantel__cruce-bold">${cimomet}</td>
              </tr>
              <tr>
                <td class="plantel__cruce-empresa" style="color:${COLOR_COMOING}">Co.mo.ing</td>
                <td>${mensCom}</td>
                <td>${quinCom}</td>
                <td class="plantel__cruce-bold">${comoing}</td>
              </tr>
              <tr class="plantel__cruce-total">
                <td>Total</td>
                <td class="plantel__cruce-bold">${mensuales.length}</td>
                <td class="plantel__cruce-bold">${quincenales.length}</td>
                <td class="plantel__cruce-bold">${total}</td>
              </tr>
            </tbody>
          </table>
        </div>

      </div>

      <!-- ── Sector Mensuales ── -->
      ${renderSeccion('Mensuales', COLOR_MENSUAL, mapMensual, maxMens, mensuales.length, mensCim, mensCom)}

      <!-- ── Sector Quincenales ── -->
      ${renderSeccion('Quincenales', COLOR_QUINCENAL, mapQuincenal, maxQuin, quincenales.length, quinCim, quinCom)}

    </div>
  `;

  // Instanciar gráficos Chart.js una vez que el DOM está listo
  const g1 = crearDonut('grafico-empresas',
    [cimomet, comoing], ['Cimomet', 'Co.mo.ing'],
    [COLOR_CIMOMET, COLOR_COMOING]);
  const g2 = crearDonut('grafico-sectores',
    [mensuales.length, quincenales.length], ['Mensuales', 'Quincenales'],
    [COLOR_MENSUAL, COLOR_QUINCENAL]);
  if (g1) graficosActivos.push(g1);
  if (g2) graficosActivos.push(g2);
}

// ── Helpers de render ─────────────────────────────────────────────────────────

function renderSeccion(titulo, color, puestosMap, maxCount, totalSector, cimCount, comCount) {
  const filas = Object.entries(puestosMap).sort((a, b) => b[1].total - a[1].total);
  return `
    <div class="plantel__sector">
      <div class="plantel__sector-header">
        <h2 class="plantel__sector-titulo">
          <span class="plantel__sector-dot" style="background:${color}"></span>
          ${titulo}
        </h2>
        <div class="plantel__sector-meta">
          <span class="plantel__sector-total">${totalSector} empleados</span>
          <span class="plantel__badge plantel__badge--cimomet">CIM ${cimCount}</span>
          <span class="plantel__badge plantel__badge--comoing">COM ${comCount}</span>
        </div>
      </div>
      <div class="plantel__tabla-puestos">
        ${filas.map(([nombre, datos]) => {
          const anchoBarra = (datos.total / maxCount * 100).toFixed(1);
          const pctCim     = datos.total > 0 ? ((datos.CIMOMET || 0) / datos.total * 100).toFixed(1) : 0;
          const pctCom     = datos.total > 0 ? ((datos.COMOING || 0) / datos.total * 100).toFixed(1) : 0;
          return `
            <div class="plantel__puesto-fila">
              <span class="plantel__puesto-nombre">${nombre}</span>
              <div class="plantel__puesto-barra">
                <div class="plantel__barra-total" style="width:${anchoBarra}%">
                  <div class="plantel__barra-seg plantel__barra-seg--cimomet" style="width:${pctCim}%"
                       title="Cimomet: ${datos.CIMOMET || 0}"></div>
                  <div class="plantel__barra-seg plantel__barra-seg--comoing" style="width:${pctCom}%"
                       title="Co.mo.ing: ${datos.COMOING || 0}"></div>
                </div>
              </div>
              <div class="plantel__puesto-badges">
                ${(datos.CIMOMET || 0) > 0 ? `<span class="plantel__badge plantel__badge--cimomet">CIM&nbsp;${datos.CIMOMET}</span>` : ''}
                ${(datos.COMOING || 0) > 0 ? `<span class="plantel__badge plantel__badge--comoing">COM&nbsp;${datos.COMOING}</span>` : ''}
              </div>
              <span class="plantel__puesto-total">${datos.total}</span>
            </div>`;
        }).join('')}
      </div>
    </div>`;
}

function filaLeyenda(color, label, count, total) {
  const pct = total > 0 ? Math.round(count / total * 100) : 0;
  return `
    <div class="plantel__leyenda-fila">
      <span class="plantel__leyenda-dot" style="background:${color}"></span>
      <span class="plantel__leyenda-texto">${label}</span>
      <span class="plantel__leyenda-num">${count}</span>
      <span class="plantel__leyenda-pct">${pct}%</span>
    </div>`;
}

function crearDonut(canvasId, datos, etiquetas, colores) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === 'undefined') return null;
  const total = datos.reduce((a, b) => a + b, 0);
  return new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: etiquetas,
      datasets: [{
        data: datos,
        backgroundColor: colores,
        borderWidth: 2,
        borderColor: '#ffffff',
        hoverOffset: 4,
      }],
    },
    options: {
      responsive: false,
      cutout: '66%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.label}: ${ctx.raw} (${Math.round(ctx.raw / total * 100)}%)`,
          },
        },
      },
    },
  });
}

function agruparPorPuesto(lista) {
  const map = {};
  lista.forEach(e => {
    const p = e.desc_puesto;
    if (!map[p]) map[p] = { total: 0, CIMOMET: 0, COMOING: 0 };
    map[p].total++;
    map[p][e.empresa] = (map[p][e.empresa] || 0) + 1;
  });
  return map;
}

function normalizarPuesto(raw) {
  const p = (raw || 'Sin puesto').trim();
  if (p.toLowerCase() === 'rrhh') return 'RRHH';
  return p;
}
