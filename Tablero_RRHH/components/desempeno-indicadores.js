// Desempeño → Indicadores.
// Vista de cumplimiento del ciclo anual de evaluación de desempeño (ISO — PG-6.01): quién
// corresponde evaluar este año (activos con ≥365 días de antigüedad al 31/12), quién ya está
// evaluado, quién falta, y la distribución de resultados (Bueno/Regular/Revisión) — el
// semáforo que hoy arma F-106 a mano.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';
import { obtenerClasificacionPuestos } from '../data/clasificacion-puestos.js';
import { RESULTADO_LABEL, RESULTADO_COLOR, corresponde, esReingreso, aniosDisponiblesDesempeno } from './desempeno-cargar.js';
import { diasDesdeIngreso, VENTANA_DIAS, VENTANA_VISIBLE_DIAS } from './desempeno-prueba.js';
import { generarInformesAnualesPDF, generarInformesPruebaPDF } from './desempeno-informe.js';
import { obtenerConfigDesempeno, obtenerConfigPorPuesto, resolverConfigPersona } from '../data/desempeno-config.js';
import { obtenerReingresosManualesSet } from '../data/reingresos-manuales.js';

const HDR = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
const EMP_LABEL  = { CIMOMET: 'Cimomet', COMOING: 'Co.mo.ing' };
const TIPO_LABEL = { mensual: 'Mensual', quincenal: 'Quincenal' };

function eP(s) { return (s || '').toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function fmtNum(v) { return (+v || 0).toLocaleString('es-AR', { maximumFractionDigits: 1 }); }

let graficoActivo = null;
function destruirGrafico() {
  try { graficoActivo?.destroy(); } catch {}
  graficoActivo = null;
}
let graficoPrueba = null;
function destruirGraficoPrueba() {
  try { graficoPrueba?.destroy(); } catch {}
  graficoPrueba = null;
}

export async function renderizarDesempenoIndicadores(contenedor) {
  contenedor.innerHTML = '<p class="plantel__cargando">Cargando…</p>';

  let empleados = [], mapaClasif = new Map(), filasPrueba = [], config = null, manualSet = new Set(), configPorPuesto = new Map();
  try {
    const [rE, mc, rP, cfg, ms, cpp] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/empleados?select=legajo,apellido_y_nombre,empresa,desc_puesto,activo,fecha_ingreso,creado_en&limit=2000`, { headers: HDR }),
      obtenerClasificacionPuestos(),
      fetch(`${SUPABASE_URL}/rest/v1/iso_evaluaciones_periodo_prueba?motivo=eq.ingreso&select=*`, { headers: HDR }),
      obtenerConfigDesempeno(),
      obtenerReingresosManualesSet(),
      obtenerConfigPorPuesto(),
    ]);
    empleados = rE.ok ? await rE.json() : [];
    mapaClasif = mc;
    filasPrueba = rP.ok ? await rP.json() : [];
    config = cfg;
    manualSet = ms;
    configPorPuesto = cpp;
  } catch (e) {
    contenedor.innerHTML = `<div class="pres__vacio">Error al cargar el plantel: ${eP(e.message)}</div>`;
    return;
  }

  const anioActual = new Date().getFullYear();
  let anioActivo = anioActual;
  const cacheEvals = new Map(); // anio -> filas de iso_evaluaciones_desempeno

  contenedor.innerHTML = `
    <div class="pres__resumen-wrap">
      <div class="pres__barra-top">
        <div class="pres__periodo-bar">
          <label class="pres__periodo-lbl">Año:</label>
          <select class="pres__periodo-sel" id="desem-ind-anio">
            ${aniosDisponiblesDesempeno().map(a => `<option value="${a}">${a}</option>`).join('')}
          </select>
        </div>
        <button class="pres__btn-ir-carga" id="desem-ind-exportar" type="button">⬇ Exportar a Excel</button>
        <button class="pres__btn-ir-carga" id="desem-ind-informes" type="button">⬇ Descargar informes (PDF)</button>
      </div>
      <div id="desem-ind-contenido"><div class="pres__loading">Cargando…</div></div>

      <h2 style="margin:var(--espacio-xl) 0 var(--espacio-s)">Período de prueba (F-101)</h2>
      <p class="pres__subtitulo" style="margin-bottom:var(--espacio-m)">
        No depende del año — se calcula sobre quién ingresó recientemente, en cualquier momento.
      </p>
      <button class="pres__btn-ir-carga" id="desem-ind-prueba-informes" type="button" style="margin-bottom:var(--espacio-m)">⬇ Descargar informes (PDF)</button>
      <div id="desem-ind-prueba"><div class="pres__loading">Cargando…</div></div>
    </div>
  `;

  const selAnio = contenedor.querySelector('#desem-ind-anio');
  const contenido = contenedor.querySelector('#desem-ind-contenido');
  const contenidoPrueba = contenedor.querySelector('#desem-ind-prueba');
  const btnExportar = contenedor.querySelector('#desem-ind-exportar');
  const btnInformes = contenedor.querySelector('#desem-ind-informes');
  const btnInformesPrueba = contenedor.querySelector('#desem-ind-prueba-informes');
  let ultimoResumen = null;
  let ultimoResumenPrueba = null;

  selAnio.addEventListener('change', () => { anioActivo = +selAnio.value; cargarYRender(); });
  btnExportar.addEventListener('click', () => {
    if (ultimoResumen) exportarExcel(ultimoResumen, ultimoResumenPrueba);
  });
  // Uno solo por evaluado, en el orden de la tabla — todos juntos en un solo PDF (no uno por
  // persona) para que el navegador no bloquee varias descargas seguidas.
  btnInformes.addEventListener('click', () => {
    if (!ultimoResumen?.evaluados.length) { alert('Todavía no hay nadie evaluado este año.'); return; }
    const lista = ultimoResumen.evaluados.map(p => {
      const f = ultimoResumen.evalPorClave.get(`${p.legajo}|${p.empresa}`);
      return { persona: p, tipo: f.tipo, datos: f, cfg: resolverConfigPersona(p, f.tipo, config, configPorPuesto) };
    });
    generarInformesAnualesPDF(anioActivo, lista);
  });
  btnInformesPrueba.addEventListener('click', () => {
    if (!ultimoResumenPrueba?.evaluados.length) { alert('Todavía no hay nadie evaluado en período de prueba.'); return; }
    const lista = ultimoResumenPrueba.evaluados.map(p => ({
      persona: p, datos: ultimoResumenPrueba.evalPorClave.get(`${p.legajo}|${p.empresa}`),
    }));
    generarInformesPruebaPDF(lista);
  });

  async function cargarYRender() {
    contenido.innerHTML = '<div class="pres__loading">Cargando…</div>';
    let filas = cacheEvals.get(anioActivo);
    if (!filas) {
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/iso_evaluaciones_desempeno?anio=eq.${anioActivo}&select=*`, { headers: HDR });
        filas = r.ok ? await r.json() : [];
        cacheEvals.set(anioActivo, filas);
      } catch { filas = []; }
    }
    render(filas);
  }

  function render(filasEval) {
    destruirGrafico();
    const evalPorClave = new Map(filasEval.map(f => [`${f.legajo}|${f.empresa}`, f]));
    const universo = empleados.filter(p => corresponde(p, anioActivo, mapaClasif, manualSet));
    const evaluados = universo.filter(p => evalPorClave.has(`${p.legajo}|${p.empresa}`));
    const pendientes = universo.filter(p => !evalPorClave.has(`${p.legajo}|${p.empresa}`));
    const pct = universo.length ? (evaluados.length / universo.length * 100) : 0;

    const conteoResultado = { bueno: 0, regular: 0, revision: 0 };
    evaluados.forEach(p => { const f = evalPorClave.get(`${p.legajo}|${p.empresa}`); if (f) conteoResultado[f.resultado]++; });

    ultimoResumen = { anio: anioActivo, universo, evaluados, pendientes, evalPorClave };

    contenido.innerHTML = `
      <div class="pres__kpis">
        <div class="pres__kpi pres__kpi--destacado">
          <span class="pres__kpi-num" style="color:${pct >= 90 ? '#16a34a' : pct >= 60 ? '#d97706' : '#dc2626'}">${pct.toFixed(0)}%</span>
          <span class="pres__kpi-lbl">Evaluados / corresponde</span>
          <span class="pres__kpi-sub">${evaluados.length} de ${universo.length}</span>
        </div>
        <div class="pres__kpi">
          <span class="pres__kpi-num" style="color:${RESULTADO_COLOR.bueno}">${conteoResultado.bueno}</span>
          <span class="pres__kpi-lbl">Bueno</span>
        </div>
        <div class="pres__kpi">
          <span class="pres__kpi-num" style="color:${RESULTADO_COLOR.regular}">${conteoResultado.regular}</span>
          <span class="pres__kpi-lbl">Regular</span>
          <span class="pres__kpi-sub">Va al plan anual de capacitación</span>
        </div>
        <div class="pres__kpi">
          <span class="pres__kpi-num" style="color:${RESULTADO_COLOR.revision}">${conteoResultado.revision}</span>
          <span class="pres__kpi-lbl">Revisión</span>
          <span class="pres__kpi-sub">Necesita plan de acción (PG 6.01)</span>
        </div>
        <div class="pres__kpi">
          <span class="pres__kpi-num" style="color:#64748b">${pendientes.length}</span>
          <span class="pres__kpi-lbl">Pendientes</span>
        </div>
      </div>

      <div class="pres__graficos-grid">
        <div class="pres__graf-card">
          <h3 class="pres__graf-titulo">Distribución de resultados</h3>
          <div class="pres__graf-wrap" style="height:220px"><canvas id="desem-ind-chart"></canvas></div>
        </div>
        <div class="pres__graf-card">
          <h3 class="pres__graf-titulo">Pendientes (${pendientes.length})</h3>
          <div class="pres__tabla-wrap" style="max-height:260px;overflow-y:auto">
            ${pendientes.length ? `
            <table class="pres__tabla">
              <thead><tr><th class="pres__th--leg">Leg.</th><th>Nombre</th><th class="pres__th--dep">Sector</th></tr></thead>
              <tbody>${pendientes.map(p => `
                <tr>
                  <td class="pres__td--leg">${p.legajo}</td>
                  <td>${eP(p.apellido_y_nombre)}</td>
                  <td class="pres__td--dep">${eP(p.desc_puesto || '—')}</td>
                </tr>`).join('')}</tbody>
            </table>` : '<p class="pres__vacio-small">No hay nadie pendiente — todos evaluados.</p>'}
          </div>
        </div>
      </div>

      <h3 class="pres__graf-titulo" style="margin:var(--espacio-l) 0 10px">Evaluados (${evaluados.length})</h3>
      <div class="pres__tabla-wrap">
        <table class="pres__tabla">
          <thead><tr>
            <th class="pres__th--leg">Leg.</th>
            <th>Nombre</th>
            <th>Empresa</th>
            <th class="pres__th--dep">Sector</th>
            <th class="pres__th--num">Tipo</th>
            <th class="pres__th--num">Puntaje</th>
            <th>Resultado</th>
          </tr></thead>
          <tbody>
            ${evaluados.length ? evaluados.map(p => {
              const f = evalPorClave.get(`${p.legajo}|${p.empresa}`);
              return `<tr>
                <td class="pres__td--leg">${p.legajo}</td>
                <td>${eP(p.apellido_y_nombre)}</td>
                <td>${EMP_LABEL[p.empresa] || eP(p.empresa)}</td>
                <td class="pres__td--dep">${eP(p.desc_puesto || '—')}</td>
                <td class="pres__td--num">${TIPO_LABEL[f.tipo] || f.tipo}</td>
                <td class="pres__td--num">${fmtNum(f.puntaje)}</td>
                <td><span style="color:${RESULTADO_COLOR[f.resultado]};font-weight:600">${RESULTADO_LABEL[f.resultado] || f.resultado}</span></td>
              </tr>`;
            }).join('') : `<tr><td colspan="7" class="pres__vacio-small">Todavía nadie evaluado este año.</td></tr>`}
          </tbody>
        </table>
      </div>
    `;

    if (typeof Chart !== 'undefined') {
      graficoActivo = new Chart(contenido.querySelector('#desem-ind-chart').getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: ['Bueno', 'Regular', 'Revisión', 'Pendientes'],
          datasets: [{
            data: [conteoResultado.bueno, conteoResultado.regular, conteoResultado.revision, pendientes.length],
            backgroundColor: [RESULTADO_COLOR.bueno, RESULTADO_COLOR.regular, RESULTADO_COLOR.revision, '#cbd5e1'],
          }],
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } } },
      });
    }
  }

  function renderPrueba() {
    destruirGraficoPrueba();
    const hoy = new Date();
    const evalPorClave = new Map(filasPrueba.map(f => [`${f.legajo}|${f.empresa}`, f]));
    const activosIngreso = empleados.filter(p => p.activo && p.fecha_ingreso);
    const universo = activosIngreso.filter(p => {
      const clave = `${p.legajo}|${p.empresa}`;
      if (evalPorClave.has(clave)) return true; // ya evaluado: se sigue mostrando aunque sea reingreso
      if (esReingreso(p, manualSet)) return false; // reingreso sin evaluar: no le corresponde período de prueba
      const dias = diasDesdeIngreso(p, hoy);
      return dias >= 0 && dias <= VENTANA_VISIBLE_DIAS;
    });
    const evaluados = universo.filter(p => evalPorClave.has(`${p.legajo}|${p.empresa}`));
    const pendientes = universo.filter(p => !evalPorClave.has(`${p.legajo}|${p.empresa}`))
      .sort((a, b) => diasDesdeIngreso(b, hoy) - diasDesdeIngreso(a, hoy));
    const vencidas = pendientes.filter(p => diasDesdeIngreso(p, hoy) > VENTANA_DIAS).length;
    const pct = universo.length ? (evaluados.length / universo.length * 100) : 0;

    const conteoResultado = { bueno: 0, regular: 0, revision: 0 };
    evaluados.forEach(p => { const f = evalPorClave.get(`${p.legajo}|${p.empresa}`); if (f) conteoResultado[f.resultado]++; });

    ultimoResumenPrueba = { evaluados, pendientes, evalPorClave };

    contenidoPrueba.innerHTML = `
      <div class="pres__kpis">
        <div class="pres__kpi pres__kpi--destacado">
          <span class="pres__kpi-num" style="color:${pct >= 90 ? '#16a34a' : pct >= 60 ? '#d97706' : '#dc2626'}">${pct.toFixed(0)}%</span>
          <span class="pres__kpi-lbl">Evaluados / corresponde</span>
          <span class="pres__kpi-sub">${evaluados.length} de ${universo.length}</span>
        </div>
        <div class="pres__kpi">
          <span class="pres__kpi-num" style="color:${RESULTADO_COLOR.bueno}">${conteoResultado.bueno}</span>
          <span class="pres__kpi-lbl">Bueno</span>
        </div>
        <div class="pres__kpi">
          <span class="pres__kpi-num" style="color:${RESULTADO_COLOR.regular}">${conteoResultado.regular}</span>
          <span class="pres__kpi-lbl">Regular</span>
        </div>
        <div class="pres__kpi">
          <span class="pres__kpi-num" style="color:${RESULTADO_COLOR.revision}">${conteoResultado.revision}</span>
          <span class="pres__kpi-lbl">Revisión</span>
        </div>
        <div class="pres__kpi">
          <span class="pres__kpi-num" style="color:${vencidas ? '#dc2626' : '#64748b'}">${vencidas}</span>
          <span class="pres__kpi-lbl">Pendientes vencidas</span>
          <span class="pres__kpi-sub">Ya pasaron los 3 meses</span>
        </div>
      </div>

      <div class="pres__graficos-grid">
        <div class="pres__graf-card">
          <h3 class="pres__graf-titulo">Distribución de resultados</h3>
          <div class="pres__graf-wrap" style="height:220px"><canvas id="desem-ind-prueba-chart"></canvas></div>
        </div>
        <div class="pres__graf-card">
          <h3 class="pres__graf-titulo">Pendientes (${pendientes.length})</h3>
          <div class="pres__tabla-wrap" style="max-height:260px;overflow-y:auto">
            ${pendientes.length ? `
            <table class="pres__tabla">
              <thead><tr><th class="pres__th--leg">Leg.</th><th>Nombre</th><th class="pres__th--dep">Sector</th><th class="pres__th--num">Días</th></tr></thead>
              <tbody>${pendientes.map(p => {
                const dias = diasDesdeIngreso(p, hoy);
                return `
                <tr>
                  <td class="pres__td--leg">${p.legajo}</td>
                  <td>${eP(p.apellido_y_nombre)}</td>
                  <td class="pres__td--dep">${eP(p.desc_puesto || '—')}</td>
                  <td class="pres__td--num" style="color:${dias > VENTANA_DIAS ? '#dc2626' : 'inherit'}">${dias}</td>
                </tr>`;
              }).join('')}</tbody>
            </table>` : '<p class="pres__vacio-small">No hay nadie pendiente.</p>'}
          </div>
        </div>
      </div>

      <h3 class="pres__graf-titulo" style="margin:var(--espacio-l) 0 10px">Evaluados (${evaluados.length})</h3>
      <div class="pres__tabla-wrap">
        <table class="pres__tabla">
          <thead><tr>
            <th class="pres__th--leg">Leg.</th>
            <th>Nombre</th>
            <th>Empresa</th>
            <th class="pres__th--dep">Sector</th>
            <th class="pres__th--num">Presentismo</th>
            <th class="pres__th--num">Puntualidad</th>
            <th class="pres__th--num">Resultado</th>
          </tr></thead>
          <tbody>
            ${evaluados.length ? evaluados.map(p => {
              const f = evalPorClave.get(`${p.legajo}|${p.empresa}`);
              return `<tr>
                <td class="pres__td--leg">${p.legajo}</td>
                <td>${eP(p.apellido_y_nombre)}</td>
                <td>${EMP_LABEL[p.empresa] || eP(p.empresa)}</td>
                <td class="pres__td--dep">${eP(p.desc_puesto || '—')}</td>
                <td class="pres__td--num">${f.presentismo_pct != null ? f.presentismo_pct + '%' : '—'}</td>
                <td class="pres__td--num">${f.puntualidad_pct != null ? f.puntualidad_pct + '%' : '—'}</td>
                <td><span style="color:${RESULTADO_COLOR[f.resultado]};font-weight:600">${RESULTADO_LABEL[f.resultado] || f.resultado} (${fmtNum(f.resultado_pct)}%)</span></td>
              </tr>`;
            }).join('') : `<tr><td colspan="7" class="pres__vacio-small">Todavía nadie evaluado.</td></tr>`}
          </tbody>
        </table>
      </div>
    `;

    if (typeof Chart !== 'undefined') {
      graficoPrueba = new Chart(contenidoPrueba.querySelector('#desem-ind-prueba-chart').getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: ['Bueno', 'Regular', 'Revisión', 'Pendientes'],
          datasets: [{
            data: [conteoResultado.bueno, conteoResultado.regular, conteoResultado.revision, pendientes.length],
            backgroundColor: [RESULTADO_COLOR.bueno, RESULTADO_COLOR.regular, RESULTADO_COLOR.revision, '#cbd5e1'],
          }],
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } } },
      });
    }
  }

  function exportarExcel({ anio, evaluados, pendientes, evalPorClave }, resumenPrueba) {
    if (typeof XLSX === 'undefined') {
      alert('La librería de Excel no está disponible. Verificá la conexión a internet.');
      return;
    }
    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.aoa_to_sheet([
      ['Legajo', 'Nombre', 'Empresa', 'Sector', 'Tipo', 'Ausentismo (días)', 'Tardanzas', 'Faltas EPP (0-5)', 'Reprocesos (0-5)', 'Aptitudinal (1-5)', 'Operativa (1-5)', 'Evaluación superior', 'Puntaje', 'Resultado', 'Aspecto destacable', 'Aspecto a mejorar'],
      ...evaluados.map(p => {
        const f = evalPorClave.get(`${p.legajo}|${p.empresa}`);
        return [p.legajo, p.apellido_y_nombre, EMP_LABEL[p.empresa] || p.empresa, p.desc_puesto || '', TIPO_LABEL[f.tipo] || f.tipo,
          f.ausentismo_dias, f.tardanzas_cant ?? '', f.epp_nivel ?? '', f.reprocesos_nivel ?? '',
          f.evaluacion_aptitudinal ?? '', f.evaluacion_operativa ?? '', f.evaluacion_superior,
          f.puntaje, RESULTADO_LABEL[f.resultado] || f.resultado, f.aspecto_destacable || '', f.aspecto_mejorar || ''];
      }),
    ]);
    ws1['!cols'] = [10, 26, 12, 20, 10, 14, 10, 10, 10, 12, 12, 14, 10, 12, 24, 24].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws1, 'Evaluados');

    const ws2 = XLSX.utils.aoa_to_sheet([
      ['Legajo', 'Nombre', 'Empresa', 'Sector'],
      ...pendientes.map(p => [p.legajo, p.apellido_y_nombre, EMP_LABEL[p.empresa] || p.empresa, p.desc_puesto || '']),
    ]);
    ws2['!cols'] = [10, 26, 12, 20].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws2, 'Pendientes');

    if (resumenPrueba) {
      const { evaluados: evP, pendientes: penP, evalPorClave: mapaP } = resumenPrueba;
      const ws3 = XLSX.utils.aoa_to_sheet([
        ['Legajo', 'Nombre', 'Empresa', 'Sector', 'Presentismo', 'Puntualidad', 'Resultado (%)', 'Resultado', 'Aspecto destacable', 'Aspecto a mejorar'],
        ...evP.map(p => {
          const f = mapaP.get(`${p.legajo}|${p.empresa}`);
          return [p.legajo, p.apellido_y_nombre, EMP_LABEL[p.empresa] || p.empresa, p.desc_puesto || '',
            f.presentismo_pct ?? '', f.puntualidad_pct ?? '', f.resultado_pct, RESULTADO_LABEL[f.resultado] || f.resultado,
            f.aspecto_destacable || '', f.aspecto_mejorar || ''];
        }),
      ]);
      ws3['!cols'] = [10, 26, 12, 20, 12, 12, 12, 12, 24, 24].map(w => ({ wch: w }));
      XLSX.utils.book_append_sheet(wb, ws3, 'Prueba - Evaluados');

      const ws4 = XLSX.utils.aoa_to_sheet([
        ['Legajo', 'Nombre', 'Empresa', 'Sector'],
        ...penP.map(p => [p.legajo, p.apellido_y_nombre, EMP_LABEL[p.empresa] || p.empresa, p.desc_puesto || '']),
      ]);
      ws4['!cols'] = [10, 26, 12, 20].map(w => ({ wch: w }));
      XLSX.utils.book_append_sheet(wb, ws4, 'Prueba - Pendientes');
    }

    XLSX.writeFile(wb, `Desempeno_${anio}.xlsx`);
  }

  cargarYRender();
  renderPrueba();
}
