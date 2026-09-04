// Horas y Presentismo → Ficha individual.
// Es el mismo tablero que Indicadores (mismas tarjetas KPI, mismos gráficos), pero armado
// con los datos de UNA sola persona en vez de un grupo — reutiliza el cálculo y el formato
// de presentismo-indicadores.js para que no haya dos fuentes de verdad. El detalle día por
// día es el mismo calendario/tabla que arma "Por persona", también reutilizado tal cual.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';
import { obtenerClasificacionPuestos, tipoPuesto } from '../data/clasificacion-puestos.js';
import { obtenerClasificacionAusencias, categoriaAusencia } from '../data/clasificacion-ausencias.js';
import {
  calcularGrupo, resumenTardanzas, ausentismoPorCategoriaPeriodo, desgloseExt50,
  fetchTodasFilas, fmtNum, fmtPeriodo, fmtFecha, EMP_LABEL,
  CATEGORIAS_TABLA, CATEGORIA_LABEL, CATEGORIA_COLOR, CODIGOS_EXCLUIDOS_AUSENTISMO,
  renderDias, renderEventosTardanza, mesesDisponibles, rangoQuincena, reconstruirFilasDesdeDetalle,
} from './presentismo-indicadores.js';
import { renderDetalleDia, habilitarTooltipsOT } from './presentismo-personas.js';

const HDR = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
const TIPO_LABEL = { mensual: 'Mensual', quincenal: 'Quincenal', sin_asignar: 'Sin clasificar' };
const EXT50_CODIGOS = new Set(['HSEXT', 'HSEXT50', 'HS 50 VAC']);
const MESES_CORTO = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

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

  let indice = []; // [{ legajo, nombreCompleto, empresa, tipo, activo, sector }]
  let periodosGrupo = []; // períodos disponibles para el modo Grupo/Sector (independiente de una persona)
  let mapaAusencias = new Map();
  try {
    const [rE, mapaClasif, mapaAus, rPer] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/empleados?select=legajo,apellido_y_nombre,empresa,desc_puesto,activo&limit=2000`, { headers: HDR }),
      obtenerClasificacionPuestos(),
      obtenerClasificacionAusencias(),
      fetch(`${SUPABASE_URL}/rest/v1/rrhh_horas_mensual?select=periodo&order=periodo.desc&limit=5000`, { headers: HDR }),
    ]);
    mapaAusencias = mapaAus;
    if (rPer.ok) periodosGrupo = [...new Set((await rPer.json()).map(r => r.periodo))];
    if (rE.ok) {
      const filas = await rE.json();
      indice = filas.map(e => ({
        legajo: e.legajo,
        nombreCompleto: e.apellido_y_nombre || `Legajo ${e.legajo}`,
        empresa: e.empresa,
        tipo: tipoPuesto(e.desc_puesto, mapaClasif),
        activo: !!e.activo,
        sector: e.desc_puesto || 'Sin sector',
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
      <div class="pres-ficha__modo-switch" role="tablist" aria-label="Elegir modo de ficha">
        <button class="pres-ficha__modo-btn pres-ficha__modo-btn--activo" data-modo="individual" type="button" role="tab" aria-selected="true">Una persona</button>
        <button class="pres-ficha__modo-btn" data-modo="grupo" type="button" role="tab" aria-selected="false">Grupo / Sector</button>
      </div>

      <div id="ficha-modo-contenido">
        <div id="ficha-modo-individual">
          <input type="search" class="plantel__busqueda" id="ficha-busqueda"
                 placeholder="Buscar persona por legajo o nombre…" autocomplete="off">
          <div id="ficha-resultados" class="pres-ficha__resultados" hidden></div>
          <div id="ficha-contenido">
            <p class="pres__vacio">Buscá una persona arriba para ver su ficha completa.</p>
          </div>
        </div>

        <div id="ficha-modo-grupo" hidden></div>
      </div>
    </div>
  `;

  const input = contenedor.querySelector('#ficha-busqueda');
  const resultadosEl = contenedor.querySelector('#ficha-resultados');
  const contFicha = contenedor.querySelector('#ficha-contenido');
  const modoContenidoEl = contenedor.querySelector('#ficha-modo-contenido');
  const modoIndividualEl = contenedor.querySelector('#ficha-modo-individual');
  const modoGrupoEl = contenedor.querySelector('#ficha-modo-grupo');
  // Duración del fundido al cambiar de modo — tiene que coincidir con la transición de
  // opacidad de #ficha-modo-contenido (componentes.css). Mismo patrón que el fundido de
  // "Horas por OT" al cambiar de mes (ver wireInforme en horas-ot.js).
  const DURACION_FADE_MODO = 150;
  let grupoInicializado = false;

  contenedor.querySelectorAll('.pres-ficha__modo-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const modo = btn.dataset.modo;
      if (modo === (modoIndividualEl.hidden ? 'grupo' : 'individual')) return; // ya está en ese modo
      contenedor.querySelectorAll('.pres-ficha__modo-btn').forEach(b => {
        const activo = b === btn;
        b.classList.toggle('pres-ficha__modo-btn--activo', activo);
        b.setAttribute('aria-selected', String(activo));
      });
      modoContenidoEl.classList.add('pres-ficha__modo-fade');
      setTimeout(() => {
        modoIndividualEl.hidden = modo !== 'individual';
        modoGrupoEl.hidden = modo !== 'grupo';
        if (modo === 'grupo' && !grupoInicializado) {
          grupoInicializado = true;
          inicializarModoGrupo();
        }
        requestAnimationFrame(() => modoContenidoEl.classList.remove('pres-ficha__modo-fade'));
      }, DURACION_FADE_MODO);
    });
  });

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
          fetchTodasFilas(`${SUPABASE_URL}/rest/v1/rrhh_horas_detalle?legajo=eq.${legajo}&select=legajo,fecha,periodo,tipo_hora,hs_trabajadas,hs_reales,hs_esperadas,hs_justificadas,hs_no_justificadas,descripcion_tipo_hora&order=id.asc`),
        ]);
        const rows = rH.ok ? await rH.json() : [];
        const eventos = rT.ok ? await rT.json() : [];
        const persona = rows[rows.length - 1] || null;
        // Se trae también lo anómalo (no solo anomalo=eq.false): renderDetalleDia lo separa y
        // lo muestra como aviso en vez de descartarlo en silencio (ver celdaOT).
        const otRows = persona?.empresa
          ? await fetchTodasFilas(`${SUPABASE_URL}/rest/v1/horas_ot_detalle?legajo=eq.${legajo}&empresa=eq.${persona.empresa}&select=fecha,periodo,ot,operacion,horas,anomalo&order=id.asc`)
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
    const anios = [...new Set(allPeriodos.map(p => p.split('-')[0]))].sort();
    const anioDefault = anios[anios.length - 1];
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
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <div class="pind__periodo-filtros">
              <select class="pind__per-filtro" id="ficha-anio" title="Año">
                ${anios.map(a => `<option value="${a}" ${a === anioDefault ? 'selected' : ''}>${a}</option>`).join('')}
              </select>
              <select class="pind__per-filtro" id="ficha-mes" title="Mes">
                <option value="">Todos los meses</option>
                ${mesesDisponibles(allPeriodos, anioDefault).map(m => `<option value="${m}">${MESES_CORTO[+m - 1]}</option>`).join('')}
              </select>
              <select class="pind__per-filtro" id="ficha-vista" title="Vista" disabled>
                <option value="mensual">Vista mensual</option>
                <option value="q1">1ra quincena</option>
                <option value="q2">2da quincena</option>
              </select>
            </div>
            <button type="button" class="pind__dep-toggle" id="ficha-cambiar">↺ Buscar otra persona</button>
          </div>
        </div>

        <div class="pind__kpis pind__kpis--sm">
          <div class="pind__kpi">
            <span class="pind__kpi-num" id="ficha-kv-trab">${fmtNum(g.totalTrab)}</span>
            <span class="pind__kpi-lbl">Horas trabajadas</span>
            <span class="pind__kpi-sub" id="ficha-kv-sub-trab">${labels[0]} – ${labels[labels.length - 1]}</span>
          </div>
          <div class="pind__kpi">
            <span class="pind__kpi-num" id="ficha-kv-esp" style="color:var(--color-texto-sec)">${fmtNum(g.totalEsp)}</span>
            <span class="pind__kpi-lbl">Horas esperadas</span>
            <span class="pind__kpi-sub">Según planilla Tango</span>
          </div>
          <div class="pind__kpi pind__kpi--dest">
            <span class="pind__kpi-num" id="ficha-kv-cumpl" style="color:${g.colorCumpl}">${g.cumplimiento}%</span>
            <span class="pind__kpi-lbl">Cumplimiento de horas</span>
            <span class="pind__kpi-sub">Trabajadas / Esperadas</span>
          </div>
        </div>

        <div class="pind__kpis pind__kpis--sm" style="margin-top:8px">
          <div class="pind__kpi pind__kpi--clickable" id="ficha-kpi-aus" title="Ver detalle histórico de ausentismo">
            <span class="pind__kpi-num" id="ficha-kv-aus" style="color:#dc2626">${fmtNum(g.totalAus)}</span>
            <span class="pind__kpi-lbl">Hs. ausentismo <span class="pind__kpi-ver">▸ Ver</span></span>
            <span class="pind__kpi-sub">Justificadas + sin justificar</span>
          </div>
          <div class="pind__kpi">
            <span class="pind__kpi-num" id="ficha-kv-idx" style="color:${g.colorIdx}">${g.idxAus}%</span>
            <span class="pind__kpi-lbl">Índice de ausentismo</span>
            <span class="pind__kpi-sub">Aus / (Trab + Aus)</span>
          </div>
          <div class="pind__kpi">
            <span class="pind__kpi-num" id="ficha-kv-pres" style="color:${g.colorPres}">${g.presGlobal}%</span>
            <span class="pind__kpi-lbl">Presentismo (días)</span>
            <span class="pind__kpi-sub">Días presentes / Días lab.</span>
          </div>
          <div class="pind__kpi" id="ficha-kv-ext50-wrap"${g.totalExt50 > 0 ? '' : ' hidden'}>
            <span class="pind__kpi-num" id="ficha-kv-ext50" style="color:#7c3aed">${fmtNum(g.totalExt50)}h</span>
            <span class="pind__kpi-lbl">Horas extra 50%</span>
            <span class="pind__kpi-sub" id="ficha-kv-ext50-sub">En semana: ${fmtNum(g.ext50Semana)}h · Sábados: ${fmtNum(g.ext50Sabado)}h</span>
          </div>
          <div class="pind__kpi" id="ficha-kv-ext100-wrap"${g.totalExt100 > 0 ? '' : ' hidden'}>
            <span class="pind__kpi-num" id="ficha-kv-ext100" style="color:#dc2626">${fmtNum(g.totalExt100)}h</span>
            <span class="pind__kpi-lbl">Horas extra 100%</span>
          </div>
        </div>

        <div class="pind__kpis pind__kpis--sm" style="margin-top:8px">
          <div class="pind__kpi pind__kpi--clickable" id="ficha-kpi-tard" title="Ver detalle histórico de tardanzas">
            <span class="pind__kpi-num" id="ficha-kv-tard" style="color:#d97706">${g.diasTarde + g.diasTemprano}</span>
            <span class="pind__kpi-lbl">Tardanzas y salidas anticipadas <span class="pind__kpi-ver">▸ Ver</span></span>
            <span class="pind__kpi-sub" id="ficha-kv-tard-sub">${g.diasTarde} tarde${g.diasTarde !== 1 ? 's' : ''} · ${g.diasTemprano} salida${g.diasTemprano !== 1 ? 's' : ''} anticipada${g.diasTemprano !== 1 ? 's' : ''}</span>
          </div>
          <div class="pind__kpi">
            <span class="pind__kpi-num" id="ficha-kv-punt" style="color:${g.colorPunt}">${g.indicePuntualidad != null ? g.indicePuntualidad + '%' : '—'}</span>
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

    // Selectores de Año / Mes / Vista — igual que en Indicadores, ajustan las tarjetas KPI
    // (los gráficos siguen mostrando la tendencia completa). "Vista" (1ra/2da quincena) se
    // reconstruye desde el detalle diario, que para esta persona ya está todo en memoria
    // (no hace falta ningún pedido nuevo al servidor).
    const anioSel  = contFicha.querySelector('#ficha-anio');
    const mesSel   = contFicha.querySelector('#ficha-mes');
    const vistaSel = contFicha.querySelector('#ficha-vista');
    const empresaPorLegajo = new Map([[String(legajo), persona.empresa]]);

    function periodoActualFicha() {
      return mesSel && mesSel.value ? `${anioSel.value}-${mesSel.value}-01` : '';
    }

    function refrescarMesesFicha() {
      const valorPrevio = mesSel.value;
      const disponibles = mesesDisponibles(allPeriodos, anioSel.value);
      mesSel.innerHTML = `<option value="">Todos los meses</option>` +
        disponibles.map(m => `<option value="${m}">${MESES_CORTO[+m - 1]}</option>`).join('');
      mesSel.value = disponibles.includes(valorPrevio) ? valorPrevio : '';
    }

    function aplicarFiltroFicha() {
      const per = periodoActualFicha();
      if (vistaSel) {
        vistaSel.disabled = !per;
        if (!per) vistaSel.value = 'mensual';
      }
      const vista = vistaSel ? vistaSel.value : 'mensual';

      let gF;
      if (per && vista !== 'mensual') {
        const [fechaDesde, fechaHasta] = rangoQuincena(per, vista);
        const filasReconstruidas = reconstruirFilasDesdeDetalle(detalle, rawAus, empresaPorLegajo, per, fechaDesde, fechaHasta);
        gF = calcularGrupo(filasReconstruidas, [per], null);
        Object.assign(gF, resumenTardanzas(rawTard.filter(t => t.fecha >= fechaDesde && t.fecha <= fechaHasta), [per]));
        const ext50FilasF = ext50Filas.filter(d => d.fecha >= fechaDesde && d.fecha <= fechaHasta);
        const ext50F = desgloseExt50(ext50FilasF, new Set([String(legajo)]), null);
        gF.ext50Semana = ext50F.semana; gF.ext50Sabado = ext50F.sabado; gF.totalExt50 = ext50F.semana + ext50F.sabado;
      } else {
        const rowsF = per ? rows.filter(r => r.periodo === per) : rows;
        gF = calcularGrupo(rowsF, per ? [per] : allPeriodos, null);
        Object.assign(gF, resumenTardanzas(rawTard, per ? [per] : allPeriodos));
        const ext50FilasF = per ? ext50Filas.filter(d => d.periodo === per) : ext50Filas;
        const ext50F = desgloseExt50(ext50FilasF, new Set([String(legajo)]), null);
        gF.ext50Semana = ext50F.semana; gF.ext50Sabado = ext50F.sabado; gF.totalExt50 = ext50F.semana + ext50F.sabado;
      }
      gF.indicePuntualidad = gF.totalDiasPres > 0
        ? +(((gF.totalDiasPres - gF.diasConIncidente) / gF.totalDiasPres) * 100).toFixed(1)
        : null;
      gF.colorPunt = gF.indicePuntualidad == null ? 'var(--color-texto-sec)'
        : gF.indicePuntualidad >= 95 ? '#16a34a' : gF.indicePuntualidad >= 90 ? '#d97706' : '#dc2626';

      const kv = id => contFicha.querySelector(`#ficha-kv-${id}`);
      kv('trab').textContent = fmtNum(gF.totalTrab);
      kv('sub-trab').textContent = !per
        ? `${labels[0]} – ${labels[labels.length - 1]}`
        : vista === 'q1' ? `1ra quincena · ${fmtPeriodo(per)}`
        : vista === 'q2' ? `2da quincena · ${fmtPeriodo(per)}`
        : fmtPeriodo(per);
      kv('esp').textContent = fmtNum(gF.totalEsp);
      kv('cumpl').textContent = gF.cumplimiento + '%'; kv('cumpl').style.color = gF.colorCumpl;
      kv('aus').textContent = fmtNum(gF.totalAus);
      kv('idx').textContent = gF.idxAus + '%'; kv('idx').style.color = gF.colorIdx;
      kv('pres').textContent = gF.presGlobal + '%'; kv('pres').style.color = gF.colorPres;

      const ext50Wrap = contFicha.querySelector('#ficha-kv-ext50-wrap');
      const totalExt50Real = gF.ext50Semana + gF.ext50Sabado;
      ext50Wrap.hidden = totalExt50Real <= 0;
      kv('ext50').textContent = fmtNum(totalExt50Real) + 'h';
      kv('ext50-sub').textContent = `En semana: ${fmtNum(gF.ext50Semana)}h · Sábados: ${fmtNum(gF.ext50Sabado)}h`;

      const ext100Wrap = contFicha.querySelector('#ficha-kv-ext100-wrap');
      ext100Wrap.hidden = gF.totalExt100 <= 0;
      kv('ext100').textContent = fmtNum(gF.totalExt100) + 'h';

      kv('tard').textContent = gF.diasTarde + gF.diasTemprano;
      kv('tard-sub').textContent = `${gF.diasTarde} tarde${gF.diasTarde !== 1 ? 's' : ''} · ${gF.diasTemprano} salida${gF.diasTemprano !== 1 ? 's' : ''} anticipada${gF.diasTemprano !== 1 ? 's' : ''}`;
      kv('punt').textContent = gF.indicePuntualidad != null ? gF.indicePuntualidad + '%' : '—';
      kv('punt').style.color = gF.colorPunt;
    }

    anioSel?.addEventListener('change', () => { refrescarMesesFicha(); aplicarFiltroFicha(); });
    mesSel?.addEventListener('change', () => { aplicarFiltroFicha(); });
    vistaSel?.addEventListener('change', () => { aplicarFiltroFicha(); });

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

  // ── Modo "Grupo / Sector" ──────────────────────────────────────────────────
  // Reutiliza exactamente los mismos campos ya calculados y guardados en
  // rrhh_horas_mensual (presentismo_pct, cumplimiento_hs_pct, hs_extra50, hs_no_justificadas)
  // que ya usa "Por persona" — no hace falta traer detalle día a día para armar una tabla
  // comparativa, así que esto es liviano incluso para un sector entero.
  function inicializarModoGrupo() {
    // Tango a veces guarda el mismo sector con distinta mayúscula/minúscula entre personas
    // ("Rrhh" vs "RRHH") — sin esto aparecían como dos sectores distintos en el desplegable.
    // Se agrupan case-insensitive y se elige como etiqueta la variante más usada en el plantel.
    const conteoPorClave = new Map(); // clave (minúscula) -> Map<texto original, cantidad>
    indice.forEach(p => {
      const raw = (p.sector || 'Sin sector').trim();
      const clave = raw.toLowerCase();
      if (!conteoPorClave.has(clave)) conteoPorClave.set(clave, new Map());
      const porTexto = conteoPorClave.get(clave);
      porTexto.set(raw, (porTexto.get(raw) || 0) + 1);
    });
    const sectorCanonicoPorClave = new Map();
    conteoPorClave.forEach((porTexto, clave) => {
      const [ganador] = [...porTexto.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
      sectorCanonicoPorClave.set(clave, ganador);
    });
    const sectorCanonico = raw => sectorCanonicoPorClave.get((raw || 'Sin sector').trim().toLowerCase()) || raw || 'Sin sector';

    const sectores = [...new Set(indice.map(p => sectorCanonico(p.sector)))].sort((a, b) => a.localeCompare(b));
    const personasOrdenadas = [...indice].sort((a, b) => a.nombreCompleto.localeCompare(b.nombreCompleto));

    modoGrupoEl.innerHTML = `
      <div class="pres__barra-top">
        <div class="pres__periodo-bar">
          <label class="pres__periodo-lbl">Período:</label>
          <select class="pres__periodo-sel" id="ficha-grupo-periodo">
            <option value="">Todos los meses</option>
            ${periodosGrupo.map(p => `<option value="${p}">${fmtPeriodo(p)}</option>`).join('')}
          </select>
        </div>
        <div class="pres__periodo-bar">
          <label class="pres__periodo-lbl">Sector:</label>
          <select class="pres__periodo-sel" id="ficha-grupo-sector">
            <option value="">Elegir un sector…</option>
            ${sectores.map(s => `<option value="${eP(s)}">${eP(s)}</option>`).join('')}
          </select>
        </div>
        <button class="pres__btn-ir-carga" id="ficha-grupo-exportar" type="button" disabled>⬇ Exportar a PDF</button>
      </div>

      <div class="pres-ficha__grupo-panel">
        <div class="pres-ficha__grupo-lista-col">
          <input type="search" class="plantel__busqueda" id="ficha-grupo-busq-persona" placeholder="Buscar para tildar…" autocomplete="off">
          <div class="pres-ficha__grupo-acciones">
            <button type="button" id="ficha-grupo-todos">Seleccionar todos</button>
            <button type="button" id="ficha-grupo-ninguno">Limpiar selección</button>
            <span class="pres-ficha__grupo-cont" id="ficha-grupo-cant">0 seleccionadas</span>
          </div>
          <div class="pres-ficha__grupo-checklist" id="ficha-grupo-checklist">
            ${personasOrdenadas.map(p => `
              <label class="pres-ficha__grupo-check" data-nombre="${eP(normTxt(p.nombreCompleto + ' ' + p.legajo))}" data-sector="${eP(sectorCanonico(p.sector))}">
                <input type="checkbox" value="${p.legajo}">
                <span>${eP(p.nombreCompleto)}</span>
                <span class="pres-ficha__grupo-check-meta">#${p.legajo} · ${eP(sectorCanonico(p.sector))}</span>
              </label>`).join('')}
          </div>
        </div>
        <div class="pres-ficha__grupo-tabla-col" id="ficha-grupo-dash">
          <p class="pres__vacio">Elegí un sector o tildá personas de la lista para armar el informe.</p>
        </div>
      </div>
    `;

    const selPeriodo = modoGrupoEl.querySelector('#ficha-grupo-periodo');
    const selSector  = modoGrupoEl.querySelector('#ficha-grupo-sector');
    const btnExport  = modoGrupoEl.querySelector('#ficha-grupo-exportar');
    const checklistEl = modoGrupoEl.querySelector('#ficha-grupo-checklist');
    const contCantEl  = modoGrupoEl.querySelector('#ficha-grupo-cant');
    const dashEl       = modoGrupoEl.querySelector('#ficha-grupo-dash');
    const cacheMensual = new Map(); // legajo (string) -> filas rrhh_horas_mensual de TODOS los períodos
    const cacheEventos = new Map(); // legajo (string) -> filas rrhh_tardanzas_salidas
    const cacheDetalle = new Map(); // legajo (string) -> filas rrhh_horas_detalle
    let graficosGrupo = [];
    let ultimaTabla = null;   // { filas, totales, periodo } — para exportar sin recalcular
    let estadoActual = null;  // { rows, rawTard, ext50Filas, setLegajos, allPeriodos, labels } del último dashboard armado

    function destruirGraficosGrupo() {
      graficosGrupo.forEach(g => { try { g.destroy(); } catch {} });
      graficosGrupo = [];
    }

    // Trae (con cache por legajo) las tres fuentes que ya usa la ficha de "Una persona"
    // (mensual, tardanzas/salidas, detalle diario) pero para varios legajos a la vez, así
    // el dashboard de grupo se arma con el mismo cálculo (calcularGrupo) que Indicadores.
    async function obtenerDatosGrupo(legajos) {
      const faltantes = legajos.filter(l => !cacheMensual.has(String(l)));
      if (faltantes.length) {
        const lista = faltantes.join(',');
        try {
          const [rH, rT, detalle] = await Promise.all([
            fetch(`${SUPABASE_URL}/rest/v1/rrhh_horas_mensual?legajo=in.(${lista})&select=legajo,periodo,apellido,nombre,empresa,departamento,hs_normales,hs_esperadas,hs_extra50,hs_extra100,hs_justificadas,hs_no_justificadas,hs_ausencias,dias_laborables,dias_presentes,dias_ausentes_nojust,presentismo_pct,cumplimiento_hs_pct`, { headers: HDR }),
            fetch(`${SUPABASE_URL}/rest/v1/rrhh_tardanzas_salidas?legajo=in.(${lista})&select=legajo,periodo,fecha,tipo,minutos,codigo_justificacion,descripcion_justificacion`, { headers: HDR }),
            fetchTodasFilas(`${SUPABASE_URL}/rest/v1/rrhh_horas_detalle?legajo=in.(${lista})&select=legajo,fecha,periodo,tipo_hora,hs_reales&order=id.asc`),
          ]);
          const filasH = rH.ok ? await rH.json() : [];
          const filasT = rT.ok ? await rT.json() : [];
          faltantes.forEach(l => { cacheMensual.set(String(l), []); cacheEventos.set(String(l), []); cacheDetalle.set(String(l), []); });
          filasH.forEach(f => cacheMensual.get(String(f.legajo))?.push(f));
          filasT.forEach(f => cacheEventos.get(String(f.legajo))?.push(f));
          detalle.forEach(f => cacheDetalle.get(String(f.legajo))?.push(f));
        } catch {
          faltantes.forEach(l => { cacheMensual.set(String(l), []); cacheEventos.set(String(l), []); cacheDetalle.set(String(l), []); });
        }
      }
      return {
        rows: legajos.flatMap(l => cacheMensual.get(String(l)) || []),
        eventos: legajos.flatMap(l => cacheEventos.get(String(l)) || []),
        detalle: legajos.flatMap(l => cacheDetalle.get(String(l)) || []),
      };
    }

    // Suma las filas mensuales de cada persona a lo largo de los períodos dados y
    // recalcula los porcentajes en base a los totales (no un promedio simple de porcentajes).
    function agregarPorLegajo(filas) {
      const porLegajo = new Map();
      filas.forEach(f => {
        if (!porLegajo.has(f.legajo)) {
          porLegajo.set(f.legajo, {
            legajo: f.legajo, apellido: f.apellido, nombre: f.nombre, empresa: f.empresa, departamento: f.departamento,
            hs_esperadas: 0, hs_normales: 0, hs_extra50: 0, hs_extra100: 0, hs_no_justificadas: 0,
            dias_laborables: 0, dias_presentes: 0, dias_ausentes_nojust: 0,
          });
        }
        const g = porLegajo.get(f.legajo);
        g.hs_esperadas += +f.hs_esperadas || 0;
        g.hs_normales += +f.hs_normales || 0;
        g.hs_extra50 += +f.hs_extra50 || 0;
        g.hs_extra100 += +f.hs_extra100 || 0;
        g.hs_no_justificadas += +f.hs_no_justificadas || 0;
        g.dias_laborables += +f.dias_laborables || 0;
        g.dias_presentes += +f.dias_presentes || 0;
        g.dias_ausentes_nojust += +f.dias_ausentes_nojust || 0;
      });
      return [...porLegajo.values()].map(g => ({
        ...g,
        // OJO: NO es dias_presentes / dias_laborables — dias_laborables incluye los días de
        // vacaciones/feriado (VACACION/AUS_FER), que no deben contar en contra del presentismo.
        // Mismo criterio que calcularGrupo().presGlobal en presentismo-indicadores.js: el
        // universo son los días "presente" + "ausente sin justificar", nada más.
        presentismo_pct: (g.dias_presentes + g.dias_ausentes_nojust) > 0
          ? (g.dias_presentes / (g.dias_presentes + g.dias_ausentes_nojust)) * 100 : null,
        cumplimiento_hs_pct: g.hs_esperadas > 0 ? (g.hs_normales / g.hs_esperadas) * 100 : null,
      }));
    }

    function legajosMarcados() {
      return [...checklistEl.querySelectorAll('input[type=checkbox]:checked')].map(c => c.value);
    }

    function actualizarContador() {
      const n = legajosMarcados().length;
      contCantEl.textContent = `${n} seleccionada${n !== 1 ? 's' : ''}`;
    }

    checklistEl.addEventListener('change', () => { actualizarContador(); refrescarGrupo(); });

    modoGrupoEl.querySelector('#ficha-grupo-busq-persona').addEventListener('input', e => {
      const texto = normTxt(e.target.value.trim());
      checklistEl.querySelectorAll('.pres-ficha__grupo-check').forEach(el => {
        el.style.display = !texto || el.dataset.nombre.includes(texto) ? '' : 'none';
      });
    });

    modoGrupoEl.querySelector('#ficha-grupo-todos').addEventListener('click', () => {
      checklistEl.querySelectorAll('.pres-ficha__grupo-check:not([style*="display: none"]) input').forEach(c => c.checked = true);
      actualizarContador(); refrescarGrupo();
    });
    modoGrupoEl.querySelector('#ficha-grupo-ninguno').addEventListener('click', () => {
      checklistEl.querySelectorAll('input').forEach(c => c.checked = false);
      selSector.value = '';
      actualizarContador(); refrescarGrupo();
    });

    selSector.addEventListener('change', () => {
      const sector = selSector.value;
      checklistEl.querySelectorAll('.pres-ficha__grupo-check').forEach(el => {
        el.querySelector('input').checked = sector !== '' && el.dataset.sector === sector;
      });
      actualizarContador(); refrescarGrupo();
    });

    // Cambiar el período NO reconstruye los gráficos de tendencia (que siempre muestran
    // todo el histórico, igual que en "Una persona") — solo recalcula las tarjetas KPI y
    // la tabla por persona para ese recorte.
    selPeriodo.addEventListener('change', () => aplicarFiltroGrupo());

    btnExport.addEventListener('click', async () => {
      if (!ultimaTabla || !estadoActual) return;
      btnExport.disabled = true;
      const textoOriginal = btnExport.textContent;
      btnExport.textContent = 'Generando PDF…';
      try {
        await exportarGrupoPDF(ultimaTabla, selSector.value, dashEl.querySelector('.pind__sec--grupo'));
      } catch (e) {
        alert('No se pudo generar el PDF: ' + e.message);
      } finally {
        btnExport.textContent = textoOriginal;
        btnExport.disabled = false;
      }
    });

    async function refrescarGrupo() {
      const legajos = legajosMarcados();
      destruirGraficosGrupo();
      estadoActual = null;
      ultimaTabla = null;
      btnExport.disabled = true;
      if (!legajos.length) {
        dashEl.innerHTML = '<p class="pres__vacio">Elegí un sector o tildá personas de la lista para armar el informe.</p>';
        return;
      }
      dashEl.innerHTML = '<div class="pres__loading">Cargando…</div>';
      const { rows, eventos, detalle } = await obtenerDatosGrupo(legajos);
      construirDashboard(legajos, rows, eventos, detalle);
    }

    function nombrePorLegajo(legajo) {
      const p = indice.find(x => String(x.legajo) === String(legajo));
      return p ? p.nombreCompleto : `Legajo ${legajo}`;
    }

    // Mismas tablas que renderDias/renderEventosTardanza (presentismo-indicadores.js), pero
    // con una columna "Persona" — ahí alcanza con fecha/motivo porque es siempre la misma
    // persona; acá el detalle mezcla a todo el grupo, así que sin esa columna no se puede
    // saber quién faltó o llegó tarde cada día.
    function renderDiasGrupo(dias, mapaAusencias) {
      if (!dias.length) return '<em style="padding:10px 14px;display:block;color:var(--color-texto-sec);font-size:0.8rem">Sin días con ausentismo en este período.</em>';
      return `<table class="pind__dias-tabla">
        <thead><tr>
          <th class="pind__dias-th">Fecha</th>
          <th class="pind__dias-th">Persona</th>
          <th class="pind__dias-th">Motivo</th>
          <th class="pind__dias-th pind__dias-th--num">Horas</th>
        </tr></thead>
        <tbody>${dias.map(d => {
          const horas = (+d.minutos || 0) / 60;
          const cat = categoriaAusencia(d.codigo_justificacion, mapaAusencias);
          return `<tr>
            <td class="pind__dias-td pind__dias-td--fecha">${fmtFecha(d.fecha)}</td>
            <td class="pind__dias-td">${eP(nombrePorLegajo(d.legajo))}</td>
            <td class="pind__dias-td" style="color:${CATEGORIA_COLOR[cat]};font-weight:600" title="${eP(d.descripcion_justificacion || '')}">${CATEGORIA_LABEL[cat]}</td>
            <td class="pind__dias-td pind__dias-td--num">${fmtNum(horas)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>`;
    }

    function renderEventosTardanzaGrupo(eventos) {
      if (!eventos.length) return '<em style="padding:10px 14px;display:block;color:var(--color-texto-sec);font-size:0.8rem">Sin eventos.</em>';
      return `<table class="pind__dias-tabla">
        <thead><tr>
          <th class="pind__dias-th">Fecha</th>
          <th class="pind__dias-th">Persona</th>
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
            <td class="pind__dias-td">${eP(nombrePorLegajo(e.legajo))}</td>
            <td class="pind__dias-td">${badge}</td>
            <td class="pind__dias-td pind__dias-td--num">${e.minutos} min</td>
            <td class="pind__dias-td">${eP(e.justificacion || '—')}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>`;
    }

    function construirDashboard(legajosSeleccionados, rows, eventos, detalle) {
      if (!rows.length) {
        dashEl.innerHTML = '<p class="pres__vacio">Nadie de los que tildaste tiene datos de horas cargados en Tango.</p>';
        return;
      }
      const setLegajos = new Set(legajosSeleccionados.map(String));
      const allPeriodos = [...new Set(rows.map(r => r.periodo))].sort();
      const labels = allPeriodos.map(fmtPeriodo);
      const rawTard = eventos.filter(e => e.tipo !== 'ausente');
      const rawAus  = eventos.filter(e => e.tipo === 'ausente');
      const ext50Filas = detalle.filter(d => EXT50_CODIGOS.has(d.tipo_hora));
      const realesPorPeriodo = allPeriodos.map(p => Math.round(
        detalle.filter(d => d.periodo === p).reduce((s, d) => s + (+d.hs_reales || 0), 0)
      ));

      const g = calcularGrupo(rows, allPeriodos, null);
      g.ausCategoria = ausentismoPorCategoriaPeriodo(rawAus, allPeriodos, mapaAusencias);

      const sectoresInvolucrados = [...new Set(legajosSeleccionados
        .map(l => indice.find(p => String(p.legajo) === String(l))?.sector).filter(Boolean).map(sectorCanonico))];
      const empresasInvolucradas = [...new Set(rows.map(r => r.empresa))];
      const titulo = selSector.value ? selSector.value : 'Grupo personalizado';

      dashEl.innerHTML = `
        <div class="pind__sec pind__sec--grupo">
          <div class="pind__grupo-header fg-pdf-bloque" style="border-left-color:var(--color-primario)">
            <div class="pind__grupo-header-izq">
              <h2 class="pind__grupo-titulo">${eP(titulo)}</h2>
              <div class="pind__grupo-badges">
                <span class="pind__grupo-badge pind__grupo-badge--activo">${setLegajos.size} persona${setLegajos.size !== 1 ? 's' : ''}</span>
                ${empresasInvolucradas.map(e => `<span class="pind__grupo-badge pind__grupo-badge--desvinc">${EMP_LABEL[e] || e}</span>`).join('')}
                ${sectoresInvolucrados.length
                  ? (sectoresInvolucrados.length <= 3
                      ? sectoresInvolucrados.map(s => `<span class="pind__grupo-badge pind__grupo-badge--desvinc">${eP(s)}</span>`).join('')
                      : `<span class="pind__grupo-badge pind__grupo-badge--desvinc">${sectoresInvolucrados.length} sectores</span>`)
                  : ''}
              </div>
            </div>
          </div>

          <div class="pind__kpis pind__kpis--sm fg-pdf-bloque">
            <div class="pind__kpi">
              <span class="pind__kpi-num" id="fg-kv-trab">${fmtNum(g.totalTrab)}</span>
              <span class="pind__kpi-lbl">Horas trabajadas</span>
              <span class="pind__kpi-sub" id="fg-kv-sub-trab">${labels[0]} – ${labels[labels.length - 1]}</span>
            </div>
            <div class="pind__kpi">
              <span class="pind__kpi-num" id="fg-kv-esp" style="color:var(--color-texto-sec)">${fmtNum(g.totalEsp)}</span>
              <span class="pind__kpi-lbl">Horas esperadas</span>
              <span class="pind__kpi-sub">Según planilla Tango</span>
            </div>
            <div class="pind__kpi pind__kpi--dest">
              <span class="pind__kpi-num" id="fg-kv-cumpl" style="color:${g.colorCumpl}">${g.cumplimiento}%</span>
              <span class="pind__kpi-lbl">Cumplimiento de horas</span>
              <span class="pind__kpi-sub">Trabajadas / Esperadas</span>
            </div>
          </div>

          <div class="pind__kpis pind__kpis--sm fg-pdf-bloque" style="margin-top:8px">
            <div class="pind__kpi pind__kpi--clickable" id="fg-kpi-aus" title="Ver detalle histórico de ausentismo">
              <span class="pind__kpi-num" id="fg-kv-aus" style="color:#dc2626">${fmtNum(g.totalAus)}</span>
              <span class="pind__kpi-lbl">Hs. ausentismo <span class="pind__kpi-ver">▸ Ver</span></span>
              <span class="pind__kpi-sub">Justificadas + sin justificar</span>
            </div>
            <div class="pind__kpi">
              <span class="pind__kpi-num" id="fg-kv-idx" style="color:${g.colorIdx}">${g.idxAus}%</span>
              <span class="pind__kpi-lbl">Índice de ausentismo</span>
              <span class="pind__kpi-sub">Aus / (Trab + Aus)</span>
            </div>
            <div class="pind__kpi">
              <span class="pind__kpi-num" id="fg-kv-pres" style="color:${g.colorPres}">${g.presGlobal}%</span>
              <span class="pind__kpi-lbl">Presentismo (días)</span>
              <span class="pind__kpi-sub">Días presentes / Días lab.</span>
            </div>
            <div class="pind__kpi" id="fg-kv-ext50-wrap"${g.totalExt50 > 0 ? '' : ' hidden'}>
              <span class="pind__kpi-num" id="fg-kv-ext50" style="color:#7c3aed">${fmtNum(g.totalExt50)}h</span>
              <span class="pind__kpi-lbl">Horas extra 50%</span>
              <span class="pind__kpi-sub" id="fg-kv-ext50-sub"></span>
            </div>
            <div class="pind__kpi" id="fg-kv-ext100-wrap"${g.totalExt100 > 0 ? '' : ' hidden'}>
              <span class="pind__kpi-num" id="fg-kv-ext100" style="color:#dc2626">${fmtNum(g.totalExt100)}h</span>
              <span class="pind__kpi-lbl">Horas extra 100%</span>
            </div>
          </div>

          <div class="pind__kpis pind__kpis--sm fg-pdf-bloque" style="margin-top:8px">
            <div class="pind__kpi pind__kpi--clickable" id="fg-kpi-tard" title="Ver detalle histórico de tardanzas">
              <span class="pind__kpi-num" id="fg-kv-tard" style="color:#d97706">0</span>
              <span class="pind__kpi-lbl">Tardanzas y salidas anticipadas <span class="pind__kpi-ver">▸ Ver</span></span>
              <span class="pind__kpi-sub" id="fg-kv-tard-sub"></span>
            </div>
            <div class="pind__kpi">
              <span class="pind__kpi-num" id="fg-kv-punt">—</span>
              <span class="pind__kpi-lbl">Índice de puntualidad</span>
              <span class="pind__kpi-sub">Días sin tardanza ni salida / días presentes</span>
            </div>
          </div>

          <div class="pind__detalle" id="fg-det-aus" hidden>
            <div class="pind__detalle-header">
              <span class="pind__detalle-tit">Detalle de ausentismo — histórico completo</span>
              <button type="button" class="pind__detalle-cerrar" id="fg-det-aus-close">✕</button>
            </div>
            <div class="pind__res-scroll" id="fg-det-aus-tabla"></div>
          </div>

          <div class="pind__detalle" id="fg-det-tard" hidden>
            <div class="pind__detalle-header">
              <span class="pind__detalle-tit">Detalle de tardanzas y salidas anticipadas — histórico completo</span>
              <button type="button" class="pind__detalle-cerrar" id="fg-det-tard-close">✕</button>
            </div>
            <div class="pind__res-scroll" id="fg-det-tard-tabla"></div>
          </div>

          <div class="pind__graf-grid fg-pdf-bloque" style="margin-top:var(--espacio-m)">
            <div class="pind__sec pind__graf-card" style="background:var(--color-fondo)">
              <h3 class="pind__sec-tit">Horas trabajadas por período</h3>
              <div class="pind__graf-wrap"><canvas id="fg-ch-horas"></canvas></div>
            </div>
            <div class="pind__sec pind__graf-card" style="background:var(--color-fondo)">
              <h3 class="pind__sec-tit">Esperadas vs. Reales vs. Trabajadas</h3>
              <div class="pind__graf-wrap"><canvas id="fg-ch-esp"></canvas></div>
            </div>
          </div>
          <div class="pind__graf-grid fg-pdf-bloque" style="margin-top:var(--espacio-m)">
            <div class="pind__sec pind__graf-card" style="background:var(--color-fondo)">
              <h3 class="pind__sec-tit">Ausentismo vs. Horas trabajadas</h3>
              <div class="pind__graf-wrap"><canvas id="fg-ch-aus"></canvas></div>
            </div>
            <div class="pind__sec pind__graf-card" style="background:var(--color-fondo)">
              <h3 class="pind__sec-tit">Horas extra por período</h3>
              <div id="fg-ext-wrap" class="pind__graf-wrap"><canvas id="fg-ch-ext"></canvas></div>
            </div>
          </div>
          <div class="pind__graf-grid fg-pdf-bloque" style="margin-top:var(--espacio-m)">
            <div class="pind__sec pind__graf-card" style="background:var(--color-fondo);grid-column:1 / -1">
              <h3 class="pind__sec-tit">Ausentismo por motivo</h3>
              <div id="fg-ausmotivo-wrap" class="pind__graf-wrap"><canvas id="fg-ch-ausmotivo"></canvas></div>
            </div>
          </div>

          <div id="fg-tabla-personas"></div>
        </div>
      `;

      const detAus   = dashEl.querySelector('#fg-det-aus');
      const tablaAus = dashEl.querySelector('#fg-det-aus-tabla');
      dashEl.querySelector('#fg-kpi-aus').addEventListener('click', () => {
        detAus.hidden = !detAus.hidden;
        if (!detAus.hidden && !tablaAus.dataset.cargado) {
          const dias = rawAus
            .filter(e => !CODIGOS_EXCLUIDOS_AUSENTISMO.has(e.codigo_justificacion))
            .sort((a, b) => b.fecha.localeCompare(a.fecha) || nombrePorLegajo(a.legajo).localeCompare(nombrePorLegajo(b.legajo)));
          tablaAus.innerHTML = renderDiasGrupo(dias, mapaAusencias);
          tablaAus.dataset.cargado = '1';
        }
      });
      dashEl.querySelector('#fg-det-aus-close').addEventListener('click', () => { detAus.hidden = true; });

      const detTard   = dashEl.querySelector('#fg-det-tard');
      const tablaTard = dashEl.querySelector('#fg-det-tard-tabla');
      dashEl.querySelector('#fg-kpi-tard').addEventListener('click', () => {
        detTard.hidden = !detTard.hidden;
        if (!detTard.hidden && !tablaTard.dataset.cargado) {
          const eventosOrdenados = [...rawTard]
            .sort((a, b) => b.fecha.localeCompare(a.fecha) || nombrePorLegajo(a.legajo).localeCompare(nombrePorLegajo(b.legajo)))
            .map(e => ({ legajo: e.legajo, tipo: e.tipo, fecha: e.fecha, minutos: +e.minutos || 0, justificacion: e.descripcion_justificacion || '' }));
          tablaTard.innerHTML = renderEventosTardanzaGrupo(eventosOrdenados);
          tablaTard.dataset.cargado = '1';
        }
      });
      dashEl.querySelector('#fg-det-tard-close').addEventListener('click', () => { detTard.hidden = true; });

      // Gráficos: siempre muestran la tendencia completa (igual que en "Una persona"); el
      // filtro de período de arriba solo afecta las tarjetas KPI y la tabla por persona.
      if (typeof Chart !== 'undefined') {
        const ACENTO = getComputedStyle(document.documentElement).getPropertyValue('--color-primario').trim() || '#1e3a5f';

        graficosGrupo.push(new Chart(dashEl.querySelector('#fg-ch-horas').getContext('2d'), {
          type: 'bar',
          data: { labels, datasets: [{ label: 'Horas trabajadas', data: g.horasTot, backgroundColor: ACENTO, borderRadius: 4 }] },
          options: { responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false },
              tooltip: { callbacks: { label: c => ` ${c.parsed.y.toLocaleString('es-AR')}h` } } },
            scales: { y: { ticks: { callback: v => v.toLocaleString('es-AR') }, grid: { color: 'rgba(0,0,0,0.06)' } } },
          },
        }));

        graficosGrupo.push(new Chart(dashEl.querySelector('#fg-ch-esp').getContext('2d'), {
          type: 'bar',
          data: { labels, datasets: [
            { label: 'Esperadas',  data: g.espTot,   backgroundColor: 'rgba(100,116,139,0.35)', borderRadius: 4 },
            ...(realesPorPeriodo.some(v => v > 0) ? [{ label: 'Reales', data: realesPorPeriodo, backgroundColor: '#16a34add', borderRadius: 4 }] : []),
            { label: 'Trabajadas', data: g.horasTot, backgroundColor: ACENTO + 'dd', borderRadius: 4 },
          ]},
          options: { responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'top', labels: { boxWidth: 12 } },
              tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${c.parsed.y.toLocaleString('es-AR')}h` } } },
            scales: { y: { ticks: { callback: v => v.toLocaleString('es-AR') }, grid: { color: 'rgba(0,0,0,0.06)' } } },
          },
        }));

        graficosGrupo.push(new Chart(dashEl.querySelector('#fg-ch-aus').getContext('2d'), {
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
          dashEl.querySelector('#fg-ext-wrap').innerHTML = '<p style="padding:24px 0;text-align:center;color:var(--color-texto-sec);font-size:0.85rem">Sin horas extra en este período.</p>';
        } else {
          const extDatasets = [];
          if (hayExt50)  extDatasets.push({ label: 'Extra 50%',  data: g.ext50Tot,  backgroundColor: '#7c3aed', borderRadius: 4, stack: 'ext' });
          if (hayExt100) extDatasets.push({ label: 'Extra 100%', data: g.ext100Tot, backgroundColor: '#dc2626', borderRadius: 4, stack: 'ext' });
          graficosGrupo.push(new Chart(dashEl.querySelector('#fg-ch-ext').getContext('2d'), {
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
          dashEl.querySelector('#fg-ausmotivo-wrap').innerHTML = '<p style="padding:24px 0;text-align:center;color:var(--color-texto-sec);font-size:0.85rem">Sin ausentismo clasificado en este período.</p>';
        } else {
          const catsConDatos = CATEGORIAS_TABLA.filter(c => g.ausCategoria[c].some(v => v > 0));
          graficosGrupo.push(new Chart(dashEl.querySelector('#fg-ch-ausmotivo').getContext('2d'), {
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

      estadoActual = { rows, detalle, rawTard, ext50Filas, setLegajos, allPeriodos, labels };
      aplicarFiltroGrupo();
    }

    // Recalcula tarjetas KPI + tabla por persona para el período elegido arriba (o el
    // acumulado de todo el histórico si está en "Todos los meses"). No toca los gráficos.
    function aplicarFiltroGrupo() {
      if (!estadoActual) return;
      const { rows, detalle, rawTard, ext50Filas, setLegajos, allPeriodos, labels } = estadoActual;
      const per = selPeriodo.value;
      const rowsF = per ? rows.filter(r => r.periodo === per) : rows;
      const detalleF = per ? detalle.filter(d => d.periodo === per) : detalle;

      const gF = calcularGrupo(rowsF, per ? [per] : allPeriodos, null);
      Object.assign(gF, resumenTardanzas(rawTard, per ? [per] : allPeriodos));
      const ext50FilasF = per ? ext50Filas.filter(d => d.periodo === per) : ext50Filas;
      const ext50F = desgloseExt50(ext50FilasF, setLegajos, null);
      gF.ext50Semana = ext50F.semana; gF.ext50Sabado = ext50F.sabado; gF.totalExt50 = ext50F.semana + ext50F.sabado;
      gF.indicePuntualidad = gF.totalDiasPres > 0
        ? +(((gF.totalDiasPres - gF.diasConIncidente) / gF.totalDiasPres) * 100).toFixed(1)
        : null;
      gF.colorPunt = gF.indicePuntualidad == null ? 'var(--color-texto-sec)'
        : gF.indicePuntualidad >= 95 ? '#16a34a' : gF.indicePuntualidad >= 90 ? '#d97706' : '#dc2626';

      const kv = id => dashEl.querySelector(`#fg-kv-${id}`);
      if (!kv('trab')) return; // dashboard sin montar (nadie seleccionado o sin datos)

      kv('trab').textContent = fmtNum(gF.totalTrab);
      kv('sub-trab').textContent = per ? fmtPeriodo(per) : `${labels[0]} – ${labels[labels.length - 1]}`;
      kv('esp').textContent = fmtNum(gF.totalEsp);
      kv('cumpl').textContent = gF.cumplimiento + '%'; kv('cumpl').style.color = gF.colorCumpl;
      kv('aus').textContent = fmtNum(gF.totalAus);
      kv('idx').textContent = gF.idxAus + '%'; kv('idx').style.color = gF.colorIdx;
      kv('pres').textContent = gF.presGlobal + '%'; kv('pres').style.color = gF.colorPres;

      const ext50Wrap = dashEl.querySelector('#fg-kv-ext50-wrap');
      const totalExt50Real = gF.ext50Semana + gF.ext50Sabado;
      ext50Wrap.hidden = totalExt50Real <= 0;
      kv('ext50').textContent = fmtNum(totalExt50Real) + 'h';
      kv('ext50-sub').textContent = `En semana: ${fmtNum(gF.ext50Semana)}h · Sábados: ${fmtNum(gF.ext50Sabado)}h`;

      const ext100Wrap = dashEl.querySelector('#fg-kv-ext100-wrap');
      ext100Wrap.hidden = gF.totalExt100 <= 0;
      kv('ext100').textContent = fmtNum(gF.totalExt100) + 'h';

      kv('tard').textContent = gF.diasTarde + gF.diasTemprano;
      kv('tard-sub').textContent = `${gF.diasTarde} tarde${gF.diasTarde !== 1 ? 's' : ''} · ${gF.diasTemprano} salida${gF.diasTemprano !== 1 ? 's' : ''} anticipada${gF.diasTemprano !== 1 ? 's' : ''}`;
      kv('punt').textContent = gF.indicePuntualidad != null ? gF.indicePuntualidad + '%' : '—';
      kv('punt').style.color = gF.colorPunt;

      const filasTabla = per ? rowsF : agregarPorLegajo(rows);
      renderTablaPersonas(filasTabla, detalleF, per, allPeriodos);
    }

    function rangoPeriodos(allPeriodos) {
      if (!allPeriodos.length) return 'ningún período con datos';
      const desde = allPeriodos[0], hasta = allPeriodos[allPeriodos.length - 1];
      return desde === hasta ? fmtPeriodo(desde) : `${fmtPeriodo(desde)} – ${fmtPeriodo(hasta)}`;
    }

    function renderTablaPersonas(filas, detalleF, periodo, allPeriodos) {
      const tablaEl = dashEl.querySelector('#fg-tabla-personas');
      if (!tablaEl) return;
      if (!filas.length) {
        const msgPeriodo = periodo ? eP(fmtPeriodo(periodo)) : eP(rangoPeriodos(allPeriodos));
        tablaEl.innerHTML = `<p class="pres__vacio">Nadie de los que tildaste tiene datos cargados en ${msgPeriodo}.</p>`;
        ultimaTabla = null;
        btnExport.disabled = true;
        return;
      }

      // "Cumpl. reales" (Esperadas vs. Reales) — el mismo criterio que usa el balance de los
      // mensuales (ver "Una persona"): puede superar el 100% porque "reales" es el tiempo
      // real en planta, no las horas de convenio. Los mensuales no tienen extras (siempre 0),
      // así que esas columnas se reemplazan por esta, que sí les aporta algo.
      const realesPorLegajo = new Map();
      detalleF.forEach(d => realesPorLegajo.set(d.legajo, (realesPorLegajo.get(d.legajo) || 0) + (+d.hs_reales || 0)));
      filas = filas.map(f => {
        const reales = realesPorLegajo.get(f.legajo) || 0;
        const cumplimiento_reales_pct = f.hs_esperadas > 0 ? (reales / f.hs_esperadas) * 100 : null;
        return { ...f, hs_reales: reales, cumplimiento_reales_pct };
      }).sort((a, b) => `${a.apellido || ''}`.localeCompare(b.apellido || ''));

      const n = filas.length;
      const sum = campo => filas.reduce((s, f) => s + (+f[campo] || 0), 0);
      const promedio = campo => {
        const vals = filas.map(f => f[campo]).filter(v => v !== null && v !== undefined);
        return vals.length ? vals.reduce((s, v) => s + +v, 0) / vals.length : null;
      };
      const totales = {
        presentismo_pct: promedio('presentismo_pct'),
        cumplimiento_hs_pct: promedio('cumplimiento_hs_pct'),
        cumplimiento_reales_pct: promedio('cumplimiento_reales_pct'),
        hs_no_justificadas: sum('hs_no_justificadas'),
        dias_presentes: sum('dias_presentes'),
        dias_ausentes_nojust: sum('dias_ausentes_nojust'),
      };

      const pct = v => v === null || v === undefined ? '—' : `${(+v).toFixed(1)}%`;
      const hs = v => fmtNum(+v || 0);

      tablaEl.innerHTML = `
        <div class="pind__dep-header" style="margin-top:var(--espacio-l)">
          <span class="pind__dep-tit">Detalle por persona</span>
        </div>
        <p class="pres__subtitulo" style="margin-bottom:10px">${eP(periodo ? fmtPeriodo(periodo) : `Acumulado · ${rangoPeriodos(allPeriodos)}`)}</p>
        <div class="pres__tabla-wrap">
        <table class="pres__tabla" id="ficha-grupo-tabla">
          <thead><tr>
            <th class="pres__th--leg">Leg.</th>
            <th>Apellido y nombre</th>
            <th>Empresa</th>
            <th class="pres__th--dep">Sector</th>
            <th class="pres__th--num">Pres. días</th>
            <th class="pres__th--num">Cumpl. hs</th>
            <th class="pres__th--num">Cumpl. reales</th>
            <th class="pres__th--num">Hs no just.</th>
          </tr></thead>
          <tbody>
            ${filas.map(f => `
              <tr>
                <td class="pres__td--leg">${f.legajo}</td>
                <td>${eP(f.apellido)}${f.nombre ? `, ${eP(f.nombre)}` : ''}</td>
                <td>${EMP_LABEL[f.empresa] || eP(f.empresa) || '—'}</td>
                <td class="pres__td--dep">${eP(f.departamento || '—')}</td>
                <td class="pres__td--num">${pct(f.presentismo_pct)}</td>
                <td class="pres__td--num">${pct(f.cumplimiento_hs_pct)}</td>
                <td class="pres__td--num">${pct(f.cumplimiento_reales_pct)}</td>
                <td class="pres__td--num">${hs(f.hs_no_justificadas)}</td>
              </tr>`).join('')}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="4">Total / promedio (${n} persona${n !== 1 ? 's' : ''})</td>
              <td class="pres__td--num">${pct(totales.presentismo_pct)}</td>
              <td class="pres__td--num">${pct(totales.cumplimiento_hs_pct)}</td>
              <td class="pres__td--num">${pct(totales.cumplimiento_reales_pct)}</td>
              <td class="pres__td--num">${hs(totales.hs_no_justificadas)}</td>
            </tr>
          </tfoot>
        </table>
        </div>
      `;
      ultimaTabla = { filas, totales, periodo };
      btnExport.disabled = false;
    }

    // Arma un PDF con los mismos bloques que se ven en pantalla (encabezado, tarjetas KPI
    // y los 4 gráficos) capturados como imagen uno por uno con html2canvas —así cada bloque
    // cae completo en una página y no queda un gráfico cortado a la mitad— y agrega al final
    // la tabla por persona como texto real (jspdf-autotable), no como una captura borrosa.
    async function exportarGrupoPDF({ filas, totales, periodo }, sectorNombre, raizDashboard) {
      if (typeof html2canvas === 'undefined' || !window.jspdf) {
        alert('La librería de PDF no está disponible. Verificá la conexión a internet.');
        return;
      }
      if (!raizDashboard) return;
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margen = 10;
      const anchoUtil = pageW - margen * 2;
      let y = margen;

      const titulo = sectorNombre || 'Grupo personalizado';
      pdf.setFontSize(15);
      pdf.setTextColor(20);
      pdf.text(`Ficha de horas y presentismo — ${titulo}`, margen, y);
      y += 6;
      pdf.setFontSize(9);
      pdf.setTextColor(120);
      pdf.text(`Generado el ${new Date().toLocaleString('es-AR')}`, margen, y);
      pdf.setTextColor(0);
      y += 6;

      const bloques = [...raizDashboard.querySelectorAll(':scope > .fg-pdf-bloque')];
      for (const bloque of bloques) {
        const canvas = await html2canvas(bloque, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
        const altoImg = (canvas.height / canvas.width) * anchoUtil;
        if (y + altoImg > pageH - margen && y > margen) {
          pdf.addPage();
          y = margen;
        }
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', margen, y, anchoUtil, altoImg);
        y += altoImg + 5;
      }

      // Tabla por persona, como texto (no imagen) para que quede nítida y se pueda seleccionar/copiar.
      const pct = v => v === null || v === undefined ? '—' : `${(+v).toFixed(1)}%`;
      const hs = v => fmtNum(+v || 0);
      pdf.autoTable({
        startY: y + 2,
        margin: { left: margen, right: margen },
        head: [['Leg.', 'Apellido y nombre', 'Empresa', 'Sector', 'Pres. días', 'Cumpl. hs', 'Cumpl. reales', 'Hs no just.']],
        body: filas.map(f => [
          f.legajo, `${f.apellido || ''}${f.nombre ? `, ${f.nombre}` : ''}`, EMP_LABEL[f.empresa] || f.empresa || '—', f.departamento || '—',
          pct(f.presentismo_pct), pct(f.cumplimiento_hs_pct), pct(f.cumplimiento_reales_pct), hs(f.hs_no_justificadas),
        ]),
        foot: [[`Total / promedio (${filas.length})`, '', '', '', pct(totales.presentismo_pct), pct(totales.cumplimiento_hs_pct), pct(totales.cumplimiento_reales_pct), hs(totales.hs_no_justificadas)]],
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [30, 58, 95] },
        footStyles: { fillColor: [230, 230, 230], textColor: 20, fontStyle: 'bold' },
        theme: 'grid',
      });

      pdf.save(`Ficha_grupo_${periodo || 'todos-los-periodos'}.pdf`);
    }
  }
}
