import { metricas }         from '../config/metricas.js';
import { crearTarjetaStat } from './tarjeta-stat.js';
import { obtenerTabla }     from '../data/cliente-supabase.js';
import {
  SUPABASE_URL, SUPABASE_ANON_KEY,
  SHEET_ID_POSTULANTES, SHEET_NOMBRE_POSTULANTES,
} from '../data/fuentes.js';
import { renderizarWidgetCumpleanos, renderizarWidgetAniversarios } from './cumpleanos-antiguedad.js';

const HDR = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
};

const ADMIN_EMAIL = 'cimolay47@gmail.com';

const PUESTOS_MENSUALES = new Set([
  'Calidad', 'Ingenieria', 'Gerencia', 'Administracion',
  'Responsable de Produccion', 'RRHH', 'Coordinación de producción',
  'Recepción y Despacho', 'Presupuestos', 'Seguridad & Higiene',
]);

const graficosPanel = [];

export async function renderizarPanel(contenedor, cambiarModulo) {
  graficosPanel.forEach(c => c.destroy());
  graficosPanel.length = 0;

  const hoy = new Date();

  contenedor.innerHTML = `
    <div class="panel">

      <!-- ── KPIs ── -->
      <div class="panel__kpis">
        ${metricas.map(crearTarjetaStat).join('')}
      </div>

      <!-- ── Vencimientos · Cumpleaños · Aniversarios ── -->
      <div class="panel__personas-grid panel__personas-grid--3">

        <div class="panel__graf-card panel__graf-card--cumple">
          <div class="panel__venc-cabecera">
            <h3 class="panel__graf-titulo">
              <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              Próximos vencimientos
            </h3>
            <button class="panel__venc-ir" id="panel-venc-link" type="button">Ver resumen →</button>
          </div>
          <div id="panel-venc-wrap" class="panel__cumple-lista-wrap">
            <p class="panel__graf-cargando">Cargando…</p>
          </div>
        </div>

        <div class="panel__graf-card panel__graf-card--cumple">
          <h3 class="panel__graf-titulo">🎂 Cumpleaños</h3>
          <div id="panel-cumple-wrap" class="panel__cumple-lista-wrap">
            <p class="panel__graf-cargando">Cargando…</p>
          </div>
        </div>

        <div class="panel__graf-card panel__graf-card--cumple">
          <h3 class="panel__graf-titulo">🏅 Aniversarios laborales</h3>
          <div id="panel-aniv-wrap" class="panel__cumple-lista-wrap">
            <p class="panel__graf-cargando">Cargando…</p>
          </div>
        </div>

      </div>

      <!-- ── Gráficos de indicadores ── -->
      <p class="panel__seccion-titulo">Indicadores</p>
      <div class="panel__graficos">

        <div class="panel__graf-card">
          <h3 class="panel__graf-titulo">Tendencia de presentismo · Sábados</h3>
          <div class="panel__graf-canvas-wrap" id="panel-pres-wrap">
            <p class="panel__graf-cargando">Cargando…</p>
          </div>
        </div>

        <div class="panel__graf-card">
          <div class="panel__post-header">
            <h3 class="panel__graf-titulo">Postulantes — Últimos 12 meses</h3>
            <p class="panel__post-total" id="panel-post-total">—</p>
          </div>
          <div class="panel__graf-canvas-wrap panel__graf-canvas-wrap--post" id="panel-post-wrap">
            <p class="panel__graf-cargando">Cargando…</p>
          </div>
        </div>

      </div>

    </div>
  `;

  // ── Carga en paralelo ───────────────────────────────────────────────────────
  const [rEmpleados, rFechas, rPreselMeses, rPostMeses, rIngresos, rContrPanel, rLicPanel, rInstPanel] = await Promise.allSettled([
    obtenerTabla('v_empleados_activos', 'empresa,desc_puesto'),
    obtenerTabla('v_resumen_fecha',     'fecha,tipo,pct_cumplimiento'),
    fetchPreseleccionadosPorMes(hoy),
    obtenerDatosPostulantesMeses(),
    fetchIngresosMes(hoy),
    fetchVencimientosPanel('contratos_vencimiento',        'nombre,fecha_vencimiento'),
    fetchVencimientosPanel('licencias_vencimiento',        'apellido_y_nombre,tipo_licencia,fecha_vencimiento'),
    fetchVencimientosPanel('vencimientos_institucionales', 'titulo,fecha_vencimiento,preaviso_meses'),
  ]);

  // ── Widget de vencimientos (estilo cumpleaños) ───────────────────────────────
  const hoyV     = new Date(); hoyV.setHours(0, 0, 0, 0);
  const anioHoyV = hoyV.getFullYear();
  const allVencItems = [];

  if (rContrPanel.status === 'fulfilled') {
    rContrPanel.value.forEach(r => {
      const [y, m, d] = r.fecha_vencimiento.split('-').map(Number);
      const dias = Math.round((new Date(y, m-1, d) - hoyV) / 86400000);
      allVencItems.push({ tipo: 'Contrato', nombre: r.nombre || '—', detalle: '',
        anio: y, mes: m, dia: d, dias, estado: dias < 0 ? 'vencido' : dias <= 30 ? 'proximo' : 'ok',
        fecha: r.fecha_vencimiento });
    });
  }
  if (rLicPanel.status === 'fulfilled') {
    rLicPanel.value.forEach(r => {
      const [y, m, d] = r.fecha_vencimiento.split('-').map(Number);
      const dias = Math.round((new Date(y, m-1, d) - hoyV) / 86400000);
      allVencItems.push({ tipo: 'Licencia', nombre: r.apellido_y_nombre || '—', detalle: r.tipo_licencia || '',
        anio: y, mes: m, dia: d, dias, estado: dias < 0 ? 'vencido' : dias <= 30 ? 'proximo' : 'ok',
        fecha: r.fecha_vencimiento });
    });
  }
  if (rInstPanel.status === 'fulfilled') {
    rInstPanel.value.forEach(r => {
      const [y, m, d] = r.fecha_vencimiento.split('-').map(Number);
      const dias  = Math.round((new Date(y, m-1, d) - hoyV) / 86400000);
      const prev  = r.preaviso_meses * 30;
      allVencItems.push({ tipo: 'Institucional', nombre: r.titulo || '—', detalle: '',
        anio: y, mes: m, dia: d, dias, estado: dias < 0 ? 'vencido' : dias <= prev ? 'proximo' : 'ok',
        fecha: r.fecha_vencimiento });
    });
  }

  allVencItems.sort((a, b) => a.fecha.localeCompare(b.fecha));

  const vencWrap = contenedor.querySelector('#panel-venc-wrap');
  if (vencWrap) renderVencimientosWidget(vencWrap, allVencItems, anioHoyV);
  contenedor.querySelector('#panel-venc-link')?.addEventListener('click', () => {
    if (typeof cambiarModulo === 'function') cambiarModulo('vencimientos');
  });

  // Widgets de cumpleaños y aniversarios (cargan independiente, no bloquean el panel)
  const cumpleWrap = contenedor.querySelector('#panel-cumple-wrap');
  if (cumpleWrap) renderizarWidgetCumpleanos(cumpleWrap);

  const anivWrap = contenedor.querySelector('#panel-aniv-wrap');
  if (anivWrap) renderizarWidgetAniversarios(anivWrap);

  // ── Plantel ─────────────────────────────────────────────────────────────────
  if (rEmpleados.status === 'fulfilled') {
    const emps        = rEmpleados.value.map(e => ({ ...e, desc_puesto: normalizarPuesto(e.desc_puesto) }));
    const total       = emps.length;
    const cimomet     = emps.filter(e => e.empresa === 'CIMOMET').length;
    const comoing     = emps.filter(e => e.empresa === 'COMOING').length;
    const mensuales   = emps.filter(e => PUESTOS_MENSUALES.has(e.desc_puesto)).length;
    const quincenales = total - mensuales;

    const kpiCard = contenedor.querySelector('[data-metrica="plantel-activo"]');
    if (kpiCard) {
      const valEl = kpiCard.querySelector('.tarjeta-stat__valor');
      if (valEl) valEl.textContent = total;

      let breakdown = kpiCard.querySelector('.panel__kpi-breakdown');
      if (!breakdown) {
        breakdown = document.createElement('div');
        breakdown.className = 'panel__kpi-breakdown';
        const acento = kpiCard.querySelector('.tarjeta-stat__acento');
        kpiCard.insertBefore(breakdown, acento);
      }
      breakdown.innerHTML = `
        <div><strong class="panel__kpi-bd-num" style="color:#1a4a7a">${cimomet}</strong><span class="panel__kpi-bd-lbl">Cimomet</span></div>
        <div><strong class="panel__kpi-bd-num" style="color:#00838f">${comoing}</strong><span class="panel__kpi-bd-lbl">Co.mo.ing</span></div>
        <div><strong class="panel__kpi-bd-num" style="color:#7c3aed">${mensuales}</strong><span class="panel__kpi-bd-lbl">Mensuales</span></div>
        <div><strong class="panel__kpi-bd-num" style="color:#d97706">${quincenales}</strong><span class="panel__kpi-bd-lbl">Quincenales</span></div>
      `;

      // Reemplazar sparkline con donut de Mensuales vs Quincenales
      const metaEl = kpiCard.querySelector('.tarjeta-stat__meta');
      if (metaEl && typeof Chart !== 'undefined') {
        metaEl.innerHTML = `
          <div style="display:flex;gap:6px;align-items:center">
            <canvas id="kpi-pie-cat" width="68" height="68"></canvas>
            <canvas id="kpi-pie-emp" width="68" height="68"></canvas>
          </div>`;

        const pieOpts = (labels, colores) => ({
          type: 'pie',
          options: {
            responsive: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: ctx => {
                    const tot = ctx.dataset.data.reduce((a, b) => a + b, 0);
                    const pct = Math.round(ctx.parsed / tot * 100);
                    return ` ${ctx.parsed} emp. (${pct}%)`;
                  },
                },
              },
            },
          },
          data: {
            labels,
            datasets: [{ data: [], backgroundColor: colores, borderWidth: 2, borderColor: '#fff' }],
          },
        });

        const cfgCat = pieOpts(['Mensuales', 'Quincenales'], ['#7c3aed', '#d97706']);
        cfgCat.data.datasets[0].data = [mensuales, quincenales];
        const cfgEmp = pieOpts(['Cimomet', 'Co.mo.ing'], ['#1a4a7a', '#00838f']);
        cfgEmp.data.datasets[0].data = [cimomet, comoing];

        graficosPanel.push(new Chart(kpiCard.querySelector('#kpi-pie-cat').getContext('2d'), cfgCat));
        graficosPanel.push(new Chart(kpiCard.querySelector('#kpi-pie-emp').getContext('2d'), cfgEmp));
      }
    }
  }

  // ── KPI: Ingresos este mes ───────────────────────────────────────────────────
  const kpiIngEl = contenedor.querySelector('[data-metrica="ingresos-mes"] .tarjeta-stat__valor');
  if (kpiIngEl && rIngresos.status === 'fulfilled') kpiIngEl.textContent = rIngresos.value;

  // ── Tendencia presentismo ───────────────────────────────────────────────────
  const presWrap = contenedor.querySelector('#panel-pres-wrap');
  if (presWrap) {
    if (rFechas.status === 'fulfilled') {
      const sabs = rFechas.value
        .filter(f => f.tipo === 'Sabado')
        .sort((a, b) => a.fecha.localeCompare(b.fecha))
        .slice(-12);

      if (sabs.length) {
        presWrap.innerHTML = `<canvas id="panel-chart-pres"></canvas>`;
        const g = crearGraficoPresentismo(contenedor, sabs);
        if (g) graficosPanel.push(g);
      } else {
        presWrap.innerHTML = `<p class="panel__graf-sin-datos">Sin datos de sábados aún.</p>`;
      }
    } else {
      presWrap.innerHTML = `<p class="panel__graf-error">No se pudieron cargar los datos.</p>`;
    }
  }

  // ── Postulantes — últimos 12 meses ─────────────────────────────────────────
  const postWrap    = contenedor.querySelector('#panel-post-wrap');
  const postTotalEl = contenedor.querySelector('#panel-post-total');

  const preselMesesMap = rPreselMeses.status === 'fulfilled' ? rPreselMeses.value : new Map();
  const { porMes: postMesesMap, total: totalSistema } =
    rPostMeses.status === 'fulfilled'
      ? rPostMeses.value
      : { porMes: new Map(), total: 0 };

  if (postTotalEl) {
    postTotalEl.innerHTML =
      `<strong>${totalSistema.toLocaleString('es-AR')}</strong> en el sistema`;
  }

  if (postWrap) {
    // Armar arrays para los 12 meses
    const meses12   = ultimos12Meses(hoy);
    const labels    = meses12.map(m => fmtMesLabel(m.anio, m.mes));
    const dPresel   = meses12.map(m => preselMesesMap.get(claveMs(m))?.activo    ?? 0);
    const dDesc     = meses12.map(m => preselMesesMap.get(claveMs(m))?.descartado ?? 0);
    const dPost     = meses12.map(m => postMesesMap.get(claveMs(m))  ?? 0);
    const dSinProc  = meses12.map((_, i) => Math.max(0, dPost[i] - dPresel[i] - dDesc[i]));

    const hayDatos  = dPost.some(v => v > 0) || dPresel.some(v => v > 0);

    if (!hayDatos) {
      postWrap.innerHTML = `<p class="panel__graf-sin-datos">Sin datos de postulantes registrados.</p>`;
    } else {
      postWrap.innerHTML = `<canvas id="panel-chart-post"></canvas>`;
      const g = crearGraficoPostulantes(contenedor, labels, dPresel, dDesc, dSinProc, dPost);
      if (g) graficosPanel.push(g);
    }
  }
}

// ── Plantel helpers ───────────────────────────────────────────────────────────

function pbItem(val, lbl, color) {
  return `
    <div class="panel__pb-item" style="border-left-color:${color}">
      <span class="panel__pb-val" style="color:${color}">${val}</span>
      <span class="panel__pb-lbl">${lbl}</span>
    </div>`;
}

function plantelBreakdownPlaceholder() {
  return `
    <div class="panel__pb-grid">
      ${pbItem('—', 'Cimomet S.A.',     '#1a4a7a')}
      ${pbItem('—', 'Co.mo.ing S.R.L.', '#00838f')}
      ${pbItem('—', 'Mensuales',        '#7c3aed')}
      ${pbItem('—', 'Quincenales',      '#d97706')}
    </div>`;
}

// ── Gráfico: tendencia de presentismo ─────────────────────────────────────────

function crearGraficoPresentismo(contenedor, sabs) {
  const canvas = contenedor.querySelector('#panel-chart-pres');
  if (!canvas || typeof Chart === 'undefined') return null;

  return new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: sabs.map(f => fmtFechaMini(f.fecha)),
      datasets: [{
        label: '% Presentismo',
        data: sabs.map(f => Math.round(+f.pct_cumplimiento)),
        borderColor: '#7c3aed',
        backgroundColor: 'rgba(124,58,237,0.07)',
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: '#7c3aed',
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => `${ctx.raw}%` } },
      },
      scales: {
        y: {
          min: 0, max: 100,
          ticks: { callback: v => v + '%', font: { size: 11 } },
          grid: { color: '#f1f5f9' },
        },
        x: {
          grid: { display: false },
          ticks: { font: { size: 11 }, maxRotation: 40 },
        },
      },
    },
  });
}

// ── Gráfico: postulantes por mes (barra apilada, 12 meses) ────────────────────

function crearGraficoPostulantes(contenedor, labels, dPresel, dDesc, dSinProc, dPost) {
  const canvas = contenedor.querySelector('#panel-chart-post');
  if (!canvas || typeof Chart === 'undefined') return null;

  return new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Preseleccionados',
          data: dPresel,
          backgroundColor: '#16a34a',
          stack: 'a',
        },
        {
          label: 'Descartados',
          data: dDesc,
          backgroundColor: '#dc2626',
          stack: 'a',
        },
        {
          label: 'Sin procesar',
          data: dSinProc,
          backgroundColor: '#cbd5e1',
          stack: 'a',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { font: { size: 11 }, padding: 12, boxWidth: 12 },
        },
        tooltip: {
          mode: 'index',
          callbacks: {
            footer: items => {
              const i = items[0]?.dataIndex;
              return i !== undefined && dPost[i] > 0
                ? `Total postulantes: ${dPost[i]}`
                : '';
            },
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          ticks: { font: { size: 11 } },
        },
        y: {
          stacked: true,
          grid: { color: '#f1f5f9' },
          ticks: { font: { size: 11 }, precision: 0 },
        },
      },
    },
  });
}

// ── Fetch de datos ────────────────────────────────────────────────────────────

async function fetchIngresosMes(hoy) {
  const y    = hoy.getFullYear();
  const m    = String(hoy.getMonth() + 1).padStart(2, '0');
  const desde = `${y}-${m}-01`;
  const ultimoDia = new Date(y, hoy.getMonth() + 1, 0).getDate();
  const hasta = `${y}-${m}-${String(ultimoDia).padStart(2, '0')}`;
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/empleados?fecha_ingreso=gte.${desde}&fecha_ingreso=lte.${hasta}&select=id`,
    { headers: HDR }
  );
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return (await r.json()).length;
}

async function fetchPreseleccionadosPorMes(hoy) {
  // Trae los últimos 12 meses completos desde Supabase
  const inicio = new Date(hoy.getFullYear(), hoy.getMonth() - 11, 1).toISOString();

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/preseleccionados?select=estado,created_at&created_at=gte.${inicio}`,
    { headers: HDR }
  );
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();

  const porMes = new Map(); // clave "anio-mes0" → { activo, descartado }
  data.forEach(d => {
    const dt  = new Date(d.created_at);
    const key = claveMs({ anio: dt.getFullYear(), mes: dt.getMonth() });
    if (!porMes.has(key)) porMes.set(key, { activo: 0, descartado: 0 });
    const entry = porMes.get(key);
    if (d.estado === 'activo')     entry.activo++;
    else if (d.estado === 'descartado') entry.descartado++;
  });

  return porMes;
}

async function obtenerDatosPostulantesMeses() {
  const url  = `https://docs.google.com/spreadsheets/d/${SHEET_ID_POSTULANTES}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(SHEET_NOMBRE_POSTULANTES)}`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const txt  = await res.text();
  const data = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));

  const cols      = (data.table?.cols || []).map(c => (c.label || c.id || '').trim().toLowerCase());
  const idxFecha  = cols.findIndex(c => c.includes('marca') || c.includes('timestamp'));
  const idxEmail  = cols.findIndex(c => c.includes('correo') || c.includes('email'));
  const idxNombre = cols.findIndex(c => c === 'nombre');
  const idxApel   = cols.findIndex(c => c === 'apellido');

  // Mismo criterio que la pestaña Postulantes: ignorar filas sin nombre ni apellido
  const filaValida = row => {
    const nombre  = idxNombre >= 0 ? String(row.c?.[idxNombre]?.v ?? '').trim() : '';
    const apellido = idxApel  >= 0 ? String(row.c?.[idxApel ]?.v ?? '').trim() : '';
    return !!(nombre || apellido);
  };

  const rows = (data.table?.rows || []).filter(filaValida);

  // Personas con email: email → { anio, mes, ts } de su PRIMERA postulación
  const emailPrimerFecha = new Map();
  // Personas sin email: cada fila cuenta como una persona independiente
  const sinEmailMeses = [];

  rows.forEach(row => {
    const email = idxEmail >= 0
      ? String(row.c?.[idxEmail]?.v ?? '').toLowerCase().trim()
      : '';

    // Parsear fecha ANTES de cualquier ramificación (evita temporal dead zone de let)
    let fechaInfo = null;
    if (idxFecha >= 0) {
      const cell = row.c?.[idxFecha];
      if (cell) {
        // Intento 1: gviz DateTime "Date(2026,5,9,...)" en .v — mes 0-indexed
        const mv = String(cell.v ?? '').match(/Date\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
        if (mv) {
          const anio = +mv[1], mes = +mv[2], dia = +mv[3];
          fechaInfo = { anio, mes, ts: new Date(anio, mes, dia).getTime() };
        } else {
          // Fallback: campo .f formateado "d/m/yyyy h:mm:ss" (locale AR)
          const partes = String(cell.f ?? '').split(' ')[0].split('/');
          if (partes.length >= 3) {
            const dia = +partes[0], mes = +partes[1] - 1, anio = +partes[2];
            if (!isNaN(dia) && mes >= 0 && anio > 2000) {
              fechaInfo = { anio, mes, ts: new Date(anio, mes, dia).getTime() };
            }
          }
        }
      }
    }

    // El email del director cargó CVs de terceros:
    // cada fila es una persona distinta, tratarla como "sin email propio"
    if (email === ADMIN_EMAIL) {
      sinEmailMeses.push(fechaInfo);
      return;
    }

    if (email) {
      // Persona con email: guardar solo la fecha más antigua (primera postulación)
      const actual = emailPrimerFecha.get(email);
      if (!actual || (fechaInfo && fechaInfo.ts < actual.ts)) {
        emailPrimerFecha.set(email, fechaInfo);
      }
    } else {
      // Sin email: contar individualmente en su mes de postulación
      sinEmailMeses.push(fechaInfo);
    }
  });

  // Construir mapa porMes y total
  const porMes = new Map();
  let total    = 0;

  const registrar = (fechaInfo) => {
    total++;
    if (!fechaInfo) return;
    const key = claveMs(fechaInfo);
    porMes.set(key, (porMes.get(key) || 0) + 1);
  };

  emailPrimerFecha.forEach(fechaInfo => registrar(fechaInfo));
  sinEmailMeses.forEach(fechaInfo => registrar(fechaInfo));

  return { porMes, total };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Genera el array de los últimos 12 meses (el índice 0 es el más viejo, 11 el vigente).
function ultimos12Meses(hoy) {
  const meses = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    meses.push({ anio: d.getFullYear(), mes: d.getMonth() }); // mes 0-indexed
  }
  return meses;
}

// Clave de mapa: "2026-5" (año-mes0)
function claveMs({ anio, mes }) {
  return `${anio}-${mes}`;
}

// Etiqueta para eje X: "Jun '26"
function fmtMesLabel(anio, mes) {
  const ABREV = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return `${ABREV[mes]} '${String(anio).slice(2)}`;
}

function fmtFechaMini(f) {
  return new Date(f + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
}

function normalizarPuesto(raw) {
  const p = (raw || 'Sin puesto').trim();
  if (p.toLowerCase() === 'rrhh') return 'RRHH';
  return p;
}

async function fetchVencimientosPanel(tabla, select) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${tabla}?select=${select}`, { headers: HDR });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

function eP(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── Widget de vencimientos tipo cumpleaños ────────────────────────────────────

const MESES_V = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                 'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function renderVencimientosWidget(wrap, items, anioHoy) {
  if (!items.length) {
    wrap.innerHTML = `<p class="cump__widget-vacio">Sin vencimientos cargados.</p>`;
    return;
  }

  const porMes = new Map();
  items.forEach(item => {
    const [y, m] = item.fecha.split('-');
    const key = `${y}-${m}`;
    if (!porMes.has(key)) porMes.set(key, []);
    porMes.get(key).push(item);
  });

  let html = '<div class="cump__widget-lista">';

  for (const [key, mesItems] of porMes) {
    const [yStr, mStr] = key.split('-');
    const anio = +yStr;
    const mes  = +mStr - 1;

    const tieneVencido = mesItems.some(i => i.estado === 'vencido');
    const tieneProximo = mesItems.some(i => i.estado === 'proximo');
    const sepMod = tieneVencido ? 'cump__widget-mes-sep--vencido'
                 : tieneProximo ? 'cump__widget-mes-sep--proximo'
                 : '';

    const label = anio !== anioHoy ? `${MESES_V[mes]} ${anio}` : MESES_V[mes];
    html += `<div class="cump__widget-mes-sep ${sepMod}">${label}</div>`;

    mesItems.forEach(item => {
      const filaMod = item.estado === 'vencido' ? 'cump__widget-fila--vencido'
                    : item.estado === 'proximo' ? 'cump__widget-fila--proximo'
                    : '';

      let badge = '';
      if (item.estado === 'vencido') {
        badge = `<span class="cump__venc-badge cump__venc-badge--vencido">Vencido</span>`;
      } else if (item.estado === 'proximo') {
        const dStr = item.dias === 0 ? 'Hoy' : `${item.dias}d`;
        badge = `<span class="cump__venc-badge cump__venc-badge--proximo">${dStr}</span>`;
      }

      html += `
        <div class="cump__widget-fila ${filaMod}">
          <span class="cump__widget-dia">${item.dia}</span>
          <div>
            <span class="cump__widget-nombre">${eP(item.nombre)}</span>
            <span class="cump__widget-meta">${eP(item.tipo)} ${badge}</span>
          </div>
        </div>`;
    });
  }

  html += '</div>';
  wrap.innerHTML = html;
}
