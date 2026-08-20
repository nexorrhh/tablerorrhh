// Horas y Presentismo → Ficha individual.
// Es el mismo tablero que Indicadores (mismas tarjetas KPI, mismos gráficos), pero armado
// con los datos de UNA sola persona en vez de un grupo — reutiliza el cálculo y el formato
// de presentismo-indicadores.js para que no haya dos fuentes de verdad. El detalle día por
// día es el mismo calendario/tabla que arma "Por persona", también reutilizado tal cual.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';
import { obtenerClasificacionPuestos, tipoPuesto } from '../data/clasificacion-puestos.js';
import { obtenerClasificacionAusencias } from '../data/clasificacion-ausencias.js';
import {
  calcularGrupo, resumenTardanzas, ausentismoPorCategoriaPeriodo, desgloseExt50,
  fetchTodasFilas, fmtNum, fmtPeriodo, EMP_LABEL,
  CATEGORIAS_TABLA, CATEGORIA_LABEL, CATEGORIA_COLOR, CODIGOS_EXCLUIDOS_AUSENTISMO,
  renderDias, renderEventosTardanza,
} from './presentismo-indicadores.js';
import { renderDetalleDia, habilitarTooltipsOT } from './presentismo-personas.js';

const HDR = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
const TIPO_LABEL = { mensual: 'Mensual', quincenal: 'Quincenal', sin_asignar: 'Sin clasificar' };
const EXT50_CODIGOS = new Set(['HSEXT', 'HSEXT50', 'HS 50 VAC']);

function eP(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function normTxt(s) { return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

let graficosFicha = [];
function destruirGraficosFicha() {
  graficosFicha.forEach(g => { try { g.destroy(); } catch {} });
  graficosFicha = [];
}

export async function renderizarPresentismoFicha(contenedor) {
  destruirGraficosFicha();
  contenedor.innerHTML = '<div class="pres__loading">Cargando personas…</div>';
  habilitarTooltipsOT(contenedor);

  let indice = []; // [{ legajo, nombreCompleto, empresa, tipo, activo }]
  let mapaAusencias = new Map();
  try {
    const [rE, mapaClasif, mapaAus] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/empleados?select=legajo,apellido_y_nombre,empresa,desc_puesto,activo&limit=2000`, { headers: HDR }),
      obtenerClasificacionPuestos(),
      obtenerClasificacionAusencias(),
    ]);
    mapaAusencias = mapaAus;
    if (rE.ok) {
      const filas = await rE.json();
      indice = filas.map(e => ({
        legajo: e.legajo,
        nombreCompleto: e.apellido_y_nombre || `Legajo ${e.legajo}`,
        empresa: e.empresa,
        tipo: tipoPuesto(e.desc_puesto, mapaClasif),
        activo: !!e.activo,
      }));
    }
  } catch (e) {
    contenedor.innerHTML = `<div class="pres__vacio">Error al cargar el plantel: ${e.message}</div>`;
    return;
  }

  if (!indice.length) {
    contenedor.innerHTML = `<div class="pres__vacio">No hay datos de plantel cargados.</div>`;
    return;
  }

  const cache = new Map(); // legajo -> { rows, eventos, detalle, otRows }

  contenedor.innerHTML = `
    <div class="pres__personas-wrap">
      <input type="search" class="plantel__busqueda" id="ficha-busqueda"
             placeholder="Buscar persona por legajo o nombre…" autocomplete="off">
      <div id="ficha-resultados" class="pres-ficha__resultados" hidden></div>
      <div id="ficha-contenido">
        <p class="pres__vacio">Buscá una persona arriba para ver su ficha completa.</p>
      </div>
    </div>
  `;

  const input = contenedor.querySelector('#ficha-busqueda');
  const resultadosEl = contenedor.querySelector('#ficha-resultados');
  const contFicha = contenedor.querySelector('#ficha-contenido');

  input.addEventListener('input', () => {
    const texto = normTxt(input.value.trim());
    if (!texto) { resultadosEl.hidden = true; resultadosEl.innerHTML = ''; return; }

    const coincidencias = indice
      .filter(p => normTxt(p.nombreCompleto).includes(texto) || String(p.legajo).includes(texto))
      .slice(0, 12);

    resultadosEl.hidden = false;
    resultadosEl.innerHTML = coincidencias.length
      ? coincidencias.map(p => `
          <button type="button" class="pres-ficha__resultado" data-legajo="${p.legajo}">
            <span class="pres-ficha__resultado-nombre">${eP(p.nombreCompleto)}</span>
            <span class="pres-ficha__resultado-meta">
              Legajo #${p.legajo} · ${EMP_LABEL[p.empresa] || p.empresa || '—'}${p.activo ? '' : ' · Desvinculado'}
            </span>
          </button>`).join('')
      : `<p class="pres-ficha__sin-resultados">Sin resultados.</p>`;

    resultadosEl.querySelectorAll('[data-legajo]').forEach(btn => {
      btn.addEventListener('click', () => {
        resultadosEl.hidden = true;
        input.value = '';
        cargarFicha(btn.dataset.legajo);
      });
    });
  });

  async function cargarFicha(legajo) {
    destruirGraficosFicha();
    contFicha.innerHTML = '<div class="pres__loading">Cargando ficha…</div>';

    let datos = cache.get(legajo);
    if (!datos) {
      try {
        const [rH, rT, detalle] = await Promise.all([
          fetch(`${SUPABASE_URL}/rest/v1/rrhh_horas_mensual?legajo=eq.${legajo}&order=periodo.asc&select=legajo,apellido,nombre,departamento,periodo,empresa,hs_normales,hs_esperadas,hs_extra50,hs_extra100,hs_justificadas,hs_no_justificadas,hs_ausencias,dias_laborables,dias_presentes,dias_ausentes_nojust`, { headers: HDR }),
          fetch(`${SUPABASE_URL}/rest/v1/rrhh_tardanzas_salidas?legajo=eq.${legajo}&select=legajo,periodo,fecha,tipo,minutos,codigo_justificacion,descripcion_justificacion`, { headers: HDR }),
          fetchTodasFilas(`${SUPABASE_URL}/rest/v1/rrhh_horas_detalle?legajo=eq.${legajo}&select=legajo,fecha,periodo,tipo_hora,hs_trabajadas,hs_reales,hs_esperadas,hs_justificadas,hs_no_justificadas,descripcion_tipo_hora&order=fecha.asc,tipo_hora.asc`),
        ]);
        const rows = rH.ok ? await rH.json() : [];
        const eventos = rT.ok ? await rT.json() : [];
        const persona = rows[rows.length - 1] || null;
        const otRows = persona?.empresa
          ? await fetchTodasFilas(`${SUPABASE_URL}/rest/v1/horas_ot_detalle?legajo=eq.${legajo}&empresa=eq.${persona.empresa}&anomalo=eq.false&select=fecha,periodo,ot,operacion,horas`)
          : [];
        datos = { rows, eventos, detalle, otRows, persona };
        cache.set(legajo, datos);
      } catch (e) {
        contFicha.innerHTML = `<div class="pres__vacio">Error al cargar la ficha: ${e.message}</div>`;
        return;
      }
    }

    if (!datos.rows.length || !datos.persona) {
      contFicha.innerHTML = `<div class="pres__vacio">Esta persona no tiene datos de horas cargados en Tango.</div>`;
      return;
    }

    renderFicha(legajo, datos);
  }

  function renderFicha(legajo, { rows, eventos, detalle, otRows, persona }) {
    const infoIndice = indice.find(p => String(p.legajo) === String(legajo));
    const tipo = infoIndice?.tipo || 'sin_asignar';
    const activo = infoIndice?.activo ?? true;

    const allPeriodos = [...new Set(rows.map(r => r.periodo))].sort();
    const labels = allPeriodos.map(fmtPeriodo);
    const rawTard = eventos.filter(e => e.tipo !== 'ausente');
    const rawAus  = eventos.filter(e => e.tipo === 'ausente');

    const g = calcularGrupo(rows, allPeriodos, null);
    g.ausCategoria = ausentismoPorCategoriaPeriodo(rawAus, allPeriodos, mapaAusencias);

    // El total de Extra 50% que se muestra es semana+sábado del detalle diario (no el
    // acumulado de rrhh_horas_mensual) — mismo criterio que Indicadores, para que sea
    // matemáticamente imposible que el número de arriba no cierre con el desglose de abajo.
    const ext50Filas = detalle.filter(d => EXT50_CODIGOS.has(d.tipo_hora));
    const ext50 = desgloseExt50(ext50Filas, new Set([String(legajo)]), null);
    g.ext50Semana = ext50.semana; g.ext50Sabado = ext50.sabado; g.totalExt50 = ext50.semana + ext50.sabado;

    // Horas reales (tiempo real en el lugar de trabajo) por período — solo tiene sentido
    // mostrarlo para mensuales, donde el balance se calcula justamente contra "reales" (los
    // quincenales usan "trabajadas" como criterio, ver presentismo-personas.js). No viene
    // como columna acumulada en rrhh_horas_mensual, así que se suma del detalle diario.
    const realesPorPeriodo = allPeriodos.map(p => Math.round(
      detalle.filter(d => d.periodo === p).reduce((s, d) => s + (+d.hs_reales || 0), 0)
    ));

    const rTard = resumenTardanzas(rawTard, allPeriodos);
    Object.assign(g, rTard);
    g.indicePuntualidad = g.totalDiasPres > 0
      ? +(((g.totalDiasPres - rTard.diasConIncidente) / g.totalDiasPres) * 100).toFixed(1)
      : null;
    g.colorPunt = g.indicePuntualidad == null ? 'var(--color-texto-sec)'
      : g.indicePuntualidad >= 95 ? '#16a34a' : g.indicePuntualidad >= 90 ? '#d97706' : '#dc2626';

    contFicha.innerHTML = `
      <div class="pind__sec pind__sec--grupo">
        <div class="pind__grupo-header" style="border-left-color:var(--color-primario)">
          <div class="pind__grupo-header-izq">
            <h2 class="pind__grupo-titulo">${eP(persona.apellido)}${persona.nombre ? `, ${eP(persona.nombre)}` : ''}</h2>
            <div class="pind__grupo-badges">
              <span class="pind__grupo-badge ${activo ? 'pind__grupo-badge--activo' : 'pind__grupo-badge--desvinc'}">${activo ? 'Activo' : 'Desvinculado'}</span>
              <span class="pind__grupo-badge pind__grupo-badge--desvinc">Legajo #${legajo}</span>
              <span class="pind__grupo-badge pind__grupo-badge--desvinc">${eP(persona.departamento || '—')}</span>
              <span class="pind__grupo-badge pind__grupo-badge--desvinc">${EMP_LABEL[persona.empresa] || persona.empresa}</span>
              <span class="pind__grupo-badge pind__grupo-badge--desvinc">${TIPO_LABEL[tipo]}</span>
            </div>
          </div>
          <button type="button" class="pind__dep-toggle" id="ficha-cambiar">↺ Buscar otra persona</button>
        </div>

        <div class="pind__kpis pind__kpis--sm">
          <div class="pind__kpi">
            <span class="pind__kpi-num">${fmtNum(g.totalTrab)}</span>
            <span class="pind__kpi-lbl">Horas trabajadas</span>
            <span class="pind__kpi-sub">${labels[0]} – ${labels[labels.length - 1]}</span>
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

        <div class="pind__kpis pind__kpis--sm" style="margin-top:8px">
          <div class="pind__kpi pind__kpi--clickable" id="ficha-kpi-aus" title="Ver detalle histórico de ausentismo">
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
          <div class="pind__kpi"${g.totalExt50 > 0 ? '' : ' hidden'}>
            <span class="pind__kpi-num" style="color:#7c3aed">${fmtNum(g.totalExt50)}h</span>
            <span class="pind__kpi-lbl">Horas extra 50%</span>
            <span class="pind__kpi-sub">En semana: ${fmtNum(g.ext50Semana)}h · Sábados: ${fmtNum(g.ext50Sabado)}h</span>
          </div>
          <div class="pind__kpi"${g.totalExt100 > 0 ? '' : ' hidden'}>
            <span class="pind__kpi-num" style="color:#dc2626">${fmtNum(g.totalExt100)}h</span>
            <span class="pind__kpi-lbl">Horas extra 100%</span>
          </div>
        </div>

        <div class="pind__kpis pind__kpis--sm" style="margin-top:8px">
          <div class="pind__kpi pind__kpi--clickable" id="ficha-kpi-tard" title="Ver detalle histórico de tardanzas">
            <span class="pind__kpi-num" style="color:#d97706">${g.diasTarde + g.diasTemprano}</span>
            <span class="pind__kpi-lbl">Tardanzas y salidas anticipadas <span class="pind__kpi-ver">▸ Ver</span></span>
            <span class="pind__kpi-sub">${g.diasTarde} tarde${g.diasTarde !== 1 ? 's' : ''} · ${g.diasTemprano} salida${g.diasTemprano !== 1 ? 's' : ''} anticipada${g.diasTemprano !== 1 ? 's' : ''}</span>
          </div>
          <div class="pind__kpi">
            <span class="pind__kpi-num" style="color:${g.colorPunt}">${g.indicePuntualidad != null ? g.indicePuntualidad + '%' : '—'}</span>
            <span class="pind__kpi-lbl">Índice de puntualidad</span>
            <span class="pind__kpi-sub">Días sin tardanza ni salida / días presentes</span>
          </div>
        </div>

        <div class="pind__detalle" id="ficha-det-aus" hidden>
          <div class="pind__detalle-header">
            <span class="pind__detalle-tit">Detalle de ausentismo — histórico completo</span>
            <button type="button" class="pind__detalle-cerrar" id="ficha-det-aus-close">✕</button>
          </div>
          <div class="pind__res-scroll" id="ficha-det-aus-tabla"></div>
        </div>

        <div class="pind__detalle" id="ficha-det-tard" hidden>
          <div class="pind__detalle-header">
            <span class="pind__detalle-tit">Detalle de tardanzas y salidas anticipadas — histórico completo</span>
            <button type="button" class="pind__detalle-cerrar" id="ficha-det-tard-close">✕</button>
          </div>
          <div class="pind__res-scroll" id="ficha-det-tard-tabla"></div>
        </div>

        <div class="pind__graf-grid" style="margin-top:var(--espacio-m)">
          <div class="pind__sec pind__graf-card" style="background:var(--color-fondo)">
            <h3 class="pind__sec-tit">Horas trabajadas por período</h3>
            <div class="pind__graf-wrap"><canvas id="ficha-ch-horas"></canvas></div>
          </div>
          <div class="pind__sec pind__graf-card" style="background:var(--color-fondo)">
            <h3 class="pind__sec-tit">${tipo === 'mensual' ? 'Esperadas vs. Reales vs. Trabajadas' : 'Esperadas vs. Trabajadas'}</h3>
            <div class="pind__graf-wrap"><canvas id="ficha-ch-esp"></canvas></div>
          </div>
        </div>
        <div class="pind__graf-grid" style="margin-top:var(--espacio-m)">
          <div class="pind__sec pind__graf-card" style="background:var(--color-fondo)">
            <h3 class="pind__sec-tit">Ausentismo vs. Horas trabajadas</h3>
            <div class="pind__graf-wrap"><canvas id="ficha-ch-aus"></canvas></div>
          </div>
          <div class="pind__sec pind__graf-card" style="background:var(--color-fondo)">
            <h3 class="pind__sec-tit">Horas extra por período</h3>
            <div id="ficha-ext-wrap" class="pind__graf-wrap"><canvas id="ficha-ch-ext"></canvas></div>
          </div>
        </div>
        <div class="pind__graf-grid" style="margin-top:var(--espacio-m)">
          <div class="pind__sec pind__graf-card" style="background:var(--color-fondo);grid-column:1 / -1">
            <h3 class="pind__sec-tit">Ausentismo por motivo</h3>
            <div id="ficha-ausmotivo-wrap" class="pind__graf-wrap"><canvas id="ficha-ch-ausmotivo"></canvas></div>
          </div>
        </div>

        <div class="pind__dep-header">
          <span class="pind__dep-tit">Detalle día por día</span>
          <div style="display:flex;gap:8px;align-items:center">
            <select class="pind__detalle-sel" id="ficha-dia-per">
              ${[...allPeriodos].reverse().map(p => `<option value="${p}">${fmtPeriodo(p)}</option>`).join('')}
            </select>
            <button class="pind__dep-toggle" id="ficha-dia-btn">▸ Ver detalle</button>
          </div>
        </div>
        <div id="ficha-dia-panel" hidden></div>
      </div>
    `;

    contFicha.querySelector('#ficha-cambiar').addEventListener('click', () => {
      destruirGraficosFicha();
      contFicha.innerHTML = '<p class="pres__vacio">Buscá una persona arriba para ver su ficha completa.</p>';
      input.value = '';
      input.focus();
    });

    // Detalle histórico de ausentismo/tardanzas — a diferencia de Indicadores (que muestra
    // esto período a período, una fila por empleado), acá ya estamos parados en una sola
    // persona, así que directamente se listan TODOS sus eventos de todo el histórico.
    const detAus   = contFicha.querySelector('#ficha-det-aus');
    const tablaAus = contFicha.querySelector('#ficha-det-aus-tabla');
    contFicha.querySelector('#ficha-kpi-aus').addEventListener('click', () => {
      detAus.hidden = !detAus.hidden;
      if (!detAus.hidden && !tablaAus.dataset.cargado) {
        const dias = rawAus
          .filter(e => !CODIGOS_EXCLUIDOS_AUSENTISMO.has(e.codigo_justificacion))
          .sort((a, b) => b.fecha.localeCompare(a.fecha));
        tablaAus.innerHTML = renderDias(dias, mapaAusencias);
        tablaAus.dataset.cargado = '1';
      }
    });
    contFicha.querySelector('#ficha-det-aus-close').addEventListener('click', () => { detAus.hidden = true; });

    const detTard   = contFicha.querySelector('#ficha-det-tard');
    const tablaTard = contFicha.querySelector('#ficha-det-tard-tabla');
    contFicha.querySelector('#ficha-kpi-tard').addEventListener('click', () => {
      detTard.hidden = !detTard.hidden;
      if (!detTard.hidden && !tablaTard.dataset.cargado) {
        const eventosOrdenados = [...rawTard]
          .sort((a, b) => b.fecha.localeCompare(a.fecha))
          .map(e => ({ tipo: e.tipo, fecha: e.fecha, minutos: +e.minutos || 0, justificacion: e.descripcion_justificacion || '' }));
        tablaTard.innerHTML = renderEventosTardanza(eventosOrdenados);
        tablaTard.dataset.cargado = '1';
      }
    });
    contFicha.querySelector('#ficha-det-tard-close').addEventListener('click', () => { detTard.hidden = true; });

    const diaBtn   = contFicha.querySelector('#ficha-dia-btn');
    const diaSel   = contFicha.querySelector('#ficha-dia-per');
    const diaPanel = contFicha.querySelector('#ficha-dia-panel');
    let diaAbierto = false;

    function renderDia(periodo) {
      diaPanel.innerHTML = renderDetalleDia(
        detalle.filter(d => d.periodo === periodo),
        persona,
        eventos.filter(e => e.periodo === periodo),
        otRows.filter(o => o.periodo === periodo),
        tipo, periodo, mapaAusencias,
      );
    }

    diaBtn.addEventListener('click', () => {
      diaAbierto = !diaAbierto;
      diaPanel.hidden = !diaAbierto;
      diaBtn.textContent = diaAbierto ? '▾ Ocultar detalle' : '▸ Ver detalle';
      if (diaAbierto) renderDia(diaSel.value);
    });
    diaSel.addEventListener('change', () => { if (diaAbierto) renderDia(diaSel.value); });

    if (typeof Chart === 'undefined') return;
    const ACENTO = getComputedStyle(document.documentElement).getPropertyValue('--color-primario').trim() || '#1e3a5f';

    graficosFicha.push(new Chart(contFicha.querySelector('#ficha-ch-horas').getContext('2d'), {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Horas trabajadas', data: g.horasTot, backgroundColor: ACENTO, borderRadius: 4 }] },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false },
          tooltip: { callbacks: { label: c => ` ${c.parsed.y.toLocaleString('es-AR')}h` } } },
        scales: { y: { ticks: { callback: v => v.toLocaleString('es-AR') }, grid: { color: 'rgba(0,0,0,0.06)' } } },
      },
    }));

    graficosFicha.push(new Chart(contFicha.querySelector('#ficha-ch-esp').getContext('2d'), {
      type: 'bar',
      data: { labels, datasets: [
        { label: 'Esperadas',  data: g.espTot,   backgroundColor: 'rgba(100,116,139,0.35)', borderRadius: 4 },
        ...(tipo === 'mensual' ? [{ label: 'Reales', data: realesPorPeriodo, backgroundColor: '#16a34add', borderRadius: 4 }] : []),
        { label: 'Trabajadas', data: g.horasTot, backgroundColor: ACENTO + 'dd', borderRadius: 4 },
      ]},
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { boxWidth: 12 } },
          tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${c.parsed.y.toLocaleString('es-AR')}h` } } },
        scales: { y: { ticks: { callback: v => v.toLocaleString('es-AR') }, grid: { color: 'rgba(0,0,0,0.06)' } } },
      },
    }));

    graficosFicha.push(new Chart(contFicha.querySelector('#ficha-ch-aus').getContext('2d'), {
      type: 'bar',
      data: { labels, datasets: [
        { type: 'bar',  label: 'Horas trabajadas', data: g.horasTot, backgroundColor: ACENTO + 'cc', borderRadius: 4, yAxisID: 'y' },
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

    const hayExt100 = g.ext100Tot.some(v => v > 0);
    const hayExt50  = g.ext50Tot.some(v => v > 0);
    if (!hayExt50 && !hayExt100) {
      contFicha.querySelector('#ficha-ext-wrap').innerHTML = '<p style="padding:24px 0;text-align:center;color:var(--color-texto-sec);font-size:0.85rem">Sin horas extra en este período.</p>';
    } else {
      const extDatasets = [];
      if (hayExt50)  extDatasets.push({ label: 'Extra 50%',  data: g.ext50Tot,  backgroundColor: '#7c3aed', borderRadius: 4, stack: 'ext' });
      if (hayExt100) extDatasets.push({ label: 'Extra 100%', data: g.ext100Tot, backgroundColor: '#dc2626', borderRadius: 4, stack: 'ext' });
      graficosFicha.push(new Chart(contFicha.querySelector('#ficha-ch-ext').getContext('2d'), {
        type: 'bar',
        data: { labels, datasets: extDatasets },
        options: { responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: hayExt100, position: 'top', labels: { boxWidth: 12 } },
            tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${c.parsed.y.toLocaleString('es-AR')}h` } } },
          scales: { y: { ticks: { callback: v => v + 'h' }, grid: { color: 'rgba(0,0,0,0.06)' } } },
        },
      }));
    }

    const hayAusCategoria = CATEGORIAS_TABLA.some(c => g.ausCategoria[c].some(v => v > 0));
    if (!hayAusCategoria) {
      contFicha.querySelector('#ficha-ausmotivo-wrap').innerHTML = '<p style="padding:24px 0;text-align:center;color:var(--color-texto-sec);font-size:0.85rem">Sin ausentismo clasificado en este período.</p>';
    } else {
      const catsConDatos = CATEGORIAS_TABLA.filter(c => g.ausCategoria[c].some(v => v > 0));
      graficosFicha.push(new Chart(contFicha.querySelector('#ficha-ch-ausmotivo').getContext('2d'), {
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
  }
}
