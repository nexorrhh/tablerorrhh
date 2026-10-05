// Permisos y solicitudes → Indicadores.
// Estadísticas sobre el histórico de permisos (get_estadisticas_permisos): tasa de
// aprobación, distribución por tipo y empresa, y ranking de empleados. Mismos
// prefijos de clase (pind__) que ya usan presentismo-indicadores.js / horas-cruce.js
// para este tipo de panel — no es exclusivo de un módulo, es el patrón de "indicadores"
// que ya tiene el resto del tablero.

import { obtenerEstadisticasPermisos } from '../data/nexo-permisos.js';

const EMP_LABEL = { CIMOMET: 'Cimomet', COMOING: 'Co.mo.ing' };
const COM_COLOR = '#0d9488';
const TIPO_LABEL = {
  llegada_tarde:     'Llegada tarde',
  salida_anticipada: 'Salida anticipada',
  ausencia:          'Ausencia',
};
const TIPOS = Object.keys(TIPO_LABEL);

function nombreEmpleado(p) {
  const emp = p.empleados || {};
  return `${emp.apellido || ''}, ${emp.nombre || ''}`.trim().replace(/^,\s*/, '') || '—';
}

let graficosActivos = [];
function destruirGraficos() {
  graficosActivos.forEach(g => { try { g.destroy(); } catch {} });
  graficosActivos = [];
}

export async function renderizarPermisosIndicadores(contenedor) {
  destruirGraficos();
  contenedor.innerHTML = '<div class="pres__loading">Cargando indicadores…</div>';

  const { items: permisos, fallos } = await obtenerEstadisticasPermisos().catch(() => ({ items: [], fallos: ['CIMOMET', 'COMOING'] }));

  if (!permisos.length && fallos.length === 2) {
    contenedor.innerHTML = `
      <div class="estado-vacio">
        <h3 class="estado-vacio__titulo">Error al cargar</h3>
        <p class="estado-vacio__texto">No se pudo obtener el histórico de permisos de ninguna de las dos empresas.</p>
      </div>`;
    return;
  }

  if (!permisos.length) {
    contenedor.innerHTML = `
      <div class="estado-vacio">
        <h3 class="estado-vacio__titulo">Sin datos todavía</h3>
        <p class="estado-vacio__texto">Todavía no hay permisos decididos para calcular indicadores.</p>
      </div>`;
    return;
  }

  let filtroEmpresa = '';

  function calcular() {
    const lista = filtroEmpresa ? permisos.filter(p => p.empresa === filtroEmpresa) : permisos;
    const aprobados  = lista.filter(p => p.estado === 'aprobado').length;
    const rechazados = lista.filter(p => p.estado === 'rechazado').length;
    const pendientes = lista.filter(p => p.estado === 'pendiente').length;
    const decididos  = aprobados + rechazados;
    const tasaAprobacion = decididos > 0 ? +((aprobados / decididos) * 100).toFixed(1) : null;

    const porTipoCim = TIPOS.map(t => lista.filter(p => p.tipo === t && p.empresa === 'CIMOMET').length);
    const porTipoCom = TIPOS.map(t => lista.filter(p => p.tipo === t && p.empresa === 'COMOING').length);

    const porEmpleado = new Map();
    lista.forEach(p => {
      const key = nombreEmpleado(p);
      porEmpleado.set(key, (porEmpleado.get(key) || 0) + 1);
    });
    const topEmpleados = [...porEmpleado.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

    return { lista, aprobados, rechazados, pendientes, tasaAprobacion, porTipoCim, porTipoCom, topEmpleados };
  }

  function render() {
    destruirGraficos();
    const d = calcular();
    const colorTasa = d.tasaAprobacion === null ? 'var(--color-texto-sec)' : d.tasaAprobacion >= 90 ? '#16a34a' : d.tasaAprobacion >= 70 ? '#d97706' : '#dc2626';
    // Chart.js dibuja en un <canvas> — no resuelve custom properties de CSS como lo hace
    // un elemento del DOM, así que hay que pedirle el valor ya resuelto a getComputedStyle
    // (mismo criterio que ya usa presentismo-indicadores.js para este mismo azul).
    const CIM_COLOR = getComputedStyle(document.documentElement).getPropertyValue('--color-primario').trim() || '#1e3a5f';

    contenedor.innerHTML = `<div class="pind">
      ${fallos.length ? `<div class="pres__aviso-parcial">No se pudo cargar ${fallos.map(x => EMP_LABEL[x]).join(' ni ')} — los indicadores solo reflejan lo disponible.</div>` : ''}

      <section class="pind__sec">
        <div class="pind__grupo-header">
          <div class="pind__grupo-header-izq">
            <h2 class="pind__grupo-titulo">Permisos — resumen</h2>
          </div>
          <div class="pind__detalle-filtros" role="group" aria-label="Filtrar por empresa">
            <button class="pind__det-emp ${filtroEmpresa === '' ? 'pind__det-emp--activo' : ''}" data-emp="">Todas</button>
            <button class="pind__det-emp pind__det-emp--cim ${filtroEmpresa === 'CIMOMET' ? 'pind__det-emp--activo' : ''}" data-emp="CIMOMET">Cimomet</button>
            <button class="pind__det-emp pind__det-emp--com ${filtroEmpresa === 'COMOING' ? 'pind__det-emp--activo' : ''}" data-emp="COMOING">Co.mo.ing</button>
          </div>
        </div>

        <div class="pind__kpis">
          <div class="pind__kpi">
            <span class="pind__kpi-num">${d.lista.length}</span>
            <span class="pind__kpi-lbl">Permisos totales</span>
          </div>
          <div class="pind__kpi">
            <span class="pind__kpi-num" style="color:#16a34a">${d.aprobados}</span>
            <span class="pind__kpi-lbl">Aprobados</span>
          </div>
          <div class="pind__kpi">
            <span class="pind__kpi-num" style="color:#dc2626">${d.rechazados}</span>
            <span class="pind__kpi-lbl">Rechazados</span>
          </div>
          <div class="pind__kpi">
            <span class="pind__kpi-num" style="color:${colorTasa}">${d.tasaAprobacion !== null ? d.tasaAprobacion + '%' : '—'}</span>
            <span class="pind__kpi-lbl">Tasa de aprobación</span>
            <span class="pind__kpi-sub">sobre ${d.aprobados + d.rechazados} decididos</span>
          </div>
          ${d.pendientes > 0 ? `
          <div class="pind__kpi">
            <span class="pind__kpi-num" style="color:#d97706">${d.pendientes}</span>
            <span class="pind__kpi-lbl">Pendientes</span>
          </div>` : ''}
        </div>

        <div class="pind__graf-grid" style="margin-top:var(--espacio-l)">
          <div class="pind__sec pind__graf-card" style="background:var(--color-fondo)">
            <h3 class="pind__sec-tit">Permisos por tipo</h3>
            <div class="pind__graf-wrap"><canvas id="perm-ch-tipo"></canvas></div>
          </div>
          <div class="pind__sec pind__graf-card" style="background:var(--color-fondo)">
            <h3 class="pind__sec-tit">Empleados con más permisos</h3>
            <div id="perm-ch-top-wrap" class="pind__graf-wrap"></div>
          </div>
        </div>
      </section>
    </div>`;

    contenedor.querySelectorAll('[data-emp]').forEach(btn => {
      btn.addEventListener('click', () => { filtroEmpresa = btn.dataset.emp; render(); });
    });

    if (typeof Chart === 'undefined') return;

    graficosActivos.push(new Chart(contenedor.querySelector('#perm-ch-tipo').getContext('2d'), {
      type: 'bar',
      data: {
        labels: TIPOS.map(t => TIPO_LABEL[t]),
        datasets: [
          { label: 'Cimomet',   data: d.porTipoCim, backgroundColor: CIM_COLOR, borderRadius: 4 },
          { label: 'Co.mo.ing', data: d.porTipoCom, backgroundColor: COM_COLOR, borderRadius: 4 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { boxWidth: 12 } } },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, ticks: { precision: 0 }, grid: { color: 'rgba(0,0,0,0.06)' } },
        },
      },
    }));

    const wrapTop = contenedor.querySelector('#perm-ch-top-wrap');
    if (!d.topEmpleados.length) {
      wrapTop.innerHTML = '<p style="padding:24px 0;text-align:center;color:var(--color-texto-sec);font-size:0.85rem">Sin datos para este filtro.</p>';
    } else {
      wrapTop.style.height = Math.max(180, d.topEmpleados.length * 34 + 30) + 'px';
      const canvas = document.createElement('canvas');
      wrapTop.appendChild(canvas);
      graficosActivos.push(new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
          labels: d.topEmpleados.map(([nombre]) => nombre),
          datasets: [{ label: 'Permisos', data: d.topEmpleados.map(([, n]) => n), backgroundColor: CIM_COLOR, borderRadius: 4 }],
        },
        options: {
          indexAxis: 'y', responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { precision: 0 }, grid: { color: 'rgba(0,0,0,0.06)' } },
            y: { ticks: { font: { size: 11 } } },
          },
        },
      }));
    }
  }

  render();
}
