import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';
import { obtenerClasificacionPuestos, tipoPuesto } from '../data/clasificacion-puestos.js';
import { obtenerClasificacionAusencias, categoriaAusencia } from '../data/clasificacion-ausencias.js';
import { crearOrdenTabla } from './tabla-ordenable.js';

const HDR = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
const TIPO_LABEL = { mensual: 'Mensual', quincenal: 'Quincenal', sin_asignar: 'Sin asignar' };
const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const MESES_CORTO = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

// Motivo de ausencia (ver Horas y Presentismo → Parametrización) — reemplaza al genérico
// "Justificado"/"Ausente sin justificar" en el calendario y la tabla diaria de esta pantalla.
const CATEGORIA_LABEL = {
  enfermedad: 'Enfermedad', accidente: 'Accidente', aviso: 'Aviso',
  sin_aviso: 'Sin aviso', sin_clasificar: 'Sin clasificar',
};
const CATEGORIA_ICONO = { enfermedad: 'E', accidente: 'Ac', aviso: 'Av', sin_aviso: 'SA', sin_clasificar: '?' };
const CATEGORIA_COLOR = {
  enfermedad: '#d97706', accidente: '#dc2626', aviso: '#2563eb',
  sin_aviso: '#991b1b', sin_clasificar: '#94a3b8',
};
const CATEGORIAS_LEYENDA = ['enfermedad', 'accidente', 'aviso', 'sin_aviso', 'sin_clasificar'];

function eP(s) { return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
// eP no escapa comillas dobles — hace falta para meter JSON adentro de un atributo HTML="...".
function eAttr(s) { return eP(s).replace(/"/g, '&quot;'); }

function formatearPeriodo(p) {
  const [y, m] = p.split('-');
  return `${MESES[+m - 1]} ${y}`;
}

// Devuelve day + month abreviado (ej: "3 Jun")
function diaYMes(fechaStr) {
  const [, m, d] = fechaStr.split('-');
  return `${+d} ${MESES_CORTO[+m - 1]}`;
}

// Convierte horas decimales a "Xh Ymin" (ej: 9.85 → "9h 51min", 0.85 → "51min")
function hmin(v) {
  if (!v || v < 0.01) return '—';
  const total = Math.round(v * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}

// Para balances con signo: devuelve { txt, cls }
function hminBal(v) {
  if (v === null) return null;
  if (Math.abs(v) < 0.05) return { txt: '±0', cls: 'pres__det-td--bal-ok' };
  const total = Math.round(Math.abs(v) * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  const abs = h === 0 ? `${m}min` : m === 0 ? `${h}h` : `${h}h ${m}min`;
  return v > 0
    ? { txt: '+' + abs, cls: 'pres__det-td--bal-pos' }
    : { txt: '-' + abs, cls: 'pres__det-td--bal-neg' };
}

// Para que buscar "Nuñez" también encuentre "Núñez" y viceversa.
function normTxt(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function colorPresentismo(pct) {
  if (pct === null || pct === undefined) return '';
  const p = +pct;
  if (p >= 95) return 'color:#16a34a';
  if (p >= 85) return 'color:#d97706';
  return 'color:#dc2626;font-weight:700';
}

// Mismos colores que usa Horas por OT, para que una OT se vea siempre con el mismo color acá
// y allá. El color se elige por hash de la etiqueta (no por orden de aparición en el día), para
// que una misma OT no cambie de color de un día a otro.
const OT_COLORS = ['#185FA5', '#0F6E56', '#854F0B', '#4a3aa7', '#993C1D', '#028090', '#3B6D11', '#993556', '#5F5E5A'];
const SIN_OT_COLOR = '#cbd5e1';
function colorDeOT(etiqueta) {
  if (etiqueta === 'Sin OT') return SIN_OT_COLOR;
  let h = 0;
  for (let i = 0; i < etiqueta.length; i++) h = (h * 31 + etiqueta.charCodeAt(i)) >>> 0;
  return OT_COLORS[h % OT_COLORS.length];
}

// Total de horas cargadas en Capataz ese día, con una barra segmentada al lado (una porción
// por OT/tarea). Lo que RRHH necesita a simple vista es el número — para cruzar contra Tango,
// no les interesa de qué OT sale — así que el total va siempre visible; el desglose por OT
// queda para quien pase el mouse por encima (bar o número), en un tooltip propio armado en JS
// — ver mostrarTooltipOT más abajo — en vez del title nativo del navegador, que es lento y no
// se puede estilar.
function celdaOT(fecha, segmentos) {
  if (!segmentos || !segmentos.length) return '<span class="pres__ot-vacio">—</span>';
  const total = segmentos.reduce((s, o) => s + o.horas, 0);
  if (total <= 0) return '<span class="pres__ot-vacio">—</span>';
  const partes = segmentos.map(o => {
    const ancho = (o.horas / total * 100).toFixed(1);
    return `<span class="pres__ot-seg" style="width:${ancho}%;background:${colorDeOT(o.etiqueta)}"></span>`;
  }).join('');
  const datos = eAttr(JSON.stringify({ fecha, segmentos }));
  return `
    <div class="pres__ot-cell" data-ot-tip="${datos}">
      <span class="pres__ot-total">${total.toFixed(1)}h</span>
      <div class="pres__ot-bar">${partes}</div>
    </div>`;
}

// ── Tooltip enriquecido para la barra de OT (estilo tarjeta oscura, como los gráficos) ──
let tooltipOT = null;
function obtenerTooltipOT() {
  if (!tooltipOT) {
    tooltipOT = document.createElement('div');
    tooltipOT.className = 'pres__ot-tooltip';
    document.body.appendChild(tooltipOT);
  }
  return tooltipOT;
}

function mostrarTooltipOT(elBarra, clientX, clientY) {
  // El navegador ya decodifica las entidades HTML del atributo al parsear el DOM —
  // dataset.otTip llega con el JSON tal cual, sin &quot;/&amp; de por medio.
  let datos;
  try { datos = JSON.parse(elBarra.dataset.otTip); }
  catch { return; }
  const { fecha, segmentos } = datos;
  const total = segmentos.reduce((s, o) => s + o.horas, 0);

  const tip = obtenerTooltipOT();
  tip.innerHTML = `
    <div class="pres__ot-tooltip__titulo">${eP(fecha)}</div>
    ${segmentos.map(o => `
      <div class="pres__ot-tooltip__fila">
        <span class="pres__ot-tooltip__dot" style="background:${colorDeOT(o.etiqueta)}"></span>
        <span class="pres__ot-tooltip__label">${eP(o.etiqueta)}</span>
        <span class="pres__ot-tooltip__valor">${o.horas.toFixed(1)}h</span>
      </div>`).join('')}
    <div class="pres__ot-tooltip__total"><span>Total</span><span>${total.toFixed(1)}h</span></div>
  `;
  posicionarTooltipOT(tip, clientX, clientY);
  tip.classList.add('pres__ot-tooltip--visible');
}

function posicionarTooltipOT(tip, clientX, clientY) {
  const OFFSET = 14;
  const ancho = tip.offsetWidth || 200;
  const alto = tip.offsetHeight || 100;
  let x = clientX + OFFSET;
  let y = clientY + OFFSET;
  if (x + ancho > window.innerWidth - 8) x = clientX - ancho - OFFSET;
  if (y + alto > window.innerHeight - 8) y = clientY - alto - OFFSET;
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${Math.max(8, y)}px`;
}

function ocultarTooltipOT() {
  tooltipOT?.classList.remove('pres__ot-tooltip--visible');
}

// Delegación: se engancha una sola vez sobre un contenedor estable (no hace falta re-wirear
// cada vez que se redibuja la tabla de detalle, que se arma/destruye seguido).
function habilitarTooltipsOT(raiz) {
  raiz.addEventListener('mouseover', e => {
    const celda = e.target.closest('.pres__ot-cell');
    if (celda) mostrarTooltipOT(celda, e.clientX, e.clientY);
  });
  raiz.addEventListener('mousemove', e => {
    const celda = e.target.closest('.pres__ot-cell');
    if (celda && tooltipOT?.classList.contains('pres__ot-tooltip--visible')) {
      posicionarTooltipOT(tooltipOT, e.clientX, e.clientY);
    }
  });
  raiz.addEventListener('mouseout', e => {
    const celda = e.target.closest('.pres__ot-cell');
    if (celda && !celda.contains(e.relatedTarget)) ocultarTooltipOT();
  });
}

export async function renderizarPresentismoPersonas(contenedor) {
  contenedor.innerHTML = '<div class="pres__loading">Cargando períodos…</div>';
  habilitarTooltipsOT(contenedor);

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
    contenedor.innerHTML = `<div class="pres__vacio">No hay datos cargados. Usá la pestaña "Cargar datos" para importar el archivo de Tango.</div>`;
    return;
  }

  // legajo → tipo ('mensual' | 'quincenal' | 'sin_asignar'), para elegir el criterio
  // de balance en el detalle diario. La clasificación por puesto vive en Plantel → Parametrización.
  const empMap = new Map();
  let mapaAusencias = new Map();
  try {
    const [rE, mapaClasif, mapaAus] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/empleados?select=legajo,desc_puesto`, { headers: HDR }),
      obtenerClasificacionPuestos(),
      obtenerClasificacionAusencias(),
    ]);
    if (rE.ok) {
      const empleados = await rE.json();
      empleados.forEach(e => empMap.set(String(e.legajo), tipoPuesto(e.desc_puesto, mapaClasif)));
    }
    mapaAusencias = mapaAus;
  } catch {}

  let periodoActivo = periodos[0];
  let filtroEmpresa = '';
  let filtroTipo    = '';
  let filtroTexto   = '';
  let datosActivos  = [];
  const orden = crearOrdenTabla('apellido');
  const detalleCache = new Map();
  const eventosCache = new Map(); // tardanzas/salidas/ausencias (rrhh_tardanzas_salidas), por legajo-período
  const otCache = new Map(); // horas por OT (Capataz) del mes, por legajo-período

  contenedor.innerHTML = `
    <div class="pres__personas-wrap">
      <div class="pres__barra-top">
        <div class="pres__periodo-bar">
          <label class="pres__periodo-lbl">Período:</label>
          <select class="pres__periodo-sel" id="pres-per-sel">
            ${periodos.map(p => `<option value="${p}" ${p === periodoActivo ? 'selected' : ''}>${formatearPeriodo(p)}</option>`).join('')}
          </select>
        </div>
        <input type="search" class="plantel__busqueda" id="pres-busqueda"
               placeholder="Buscar persona por legajo o nombre…" autocomplete="off">
        <div class="plantel__empresa-pills" role="group" aria-label="Filtrar por empresa" id="pres-pills-emp"></div>
        <div class="plantel__empresa-pills" role="group" aria-label="Filtrar por tipo de puesto" id="pres-pills-tipo"></div>
      </div>
      <div id="pres-tabla-wrap" class="pres__tabla-wrap">
        <div class="pres__loading">Cargando…</div>
      </div>
    </div>
  `;

  const tablaWrap = contenedor.querySelector('#pres-tabla-wrap');
  orden.wire(tablaWrap, () => renderTabla(datosActivos));

  contenedor.querySelector('#pres-per-sel').addEventListener('change', e => {
    periodoActivo = e.target.value;
    detalleCache.clear();
    cargarYMostrar();
  });

  contenedor.querySelector('#pres-busqueda').addEventListener('input', e => {
    filtroTexto = e.target.value;
    renderTabla(datosActivos);
  });

  function tipoDe(fila) { return empMap.get(String(fila.legajo)) || 'sin_asignar'; }

  function renderPills() {
    const cimometCount = datosActivos.filter(d => d.empresa === 'CIMOMET').length;
    const comoingCount = datosActivos.filter(d => d.empresa === 'COMOING').length;
    const tiposConGente = ['mensual', 'quincenal', 'sin_asignar'].filter(t => datosActivos.some(d => tipoDe(d) === t));

    const pillsEmp = contenedor.querySelector('#pres-pills-emp');
    pillsEmp.innerHTML = `
      <button class="plantel__pill${!filtroEmpresa ? ' plantel__pill--activo' : ''}" data-empresa="">
        Todos&ensp;<span class="plantel__pill-count">${datosActivos.length}</span>
      </button>
      <button class="plantel__pill plantel__pill--cimomet${filtroEmpresa === 'CIMOMET' ? ' plantel__pill--activo' : ''}" data-empresa="CIMOMET">
        Cimomet&ensp;<span class="plantel__pill-count">${cimometCount}</span>
      </button>
      <button class="plantel__pill plantel__pill--comoing${filtroEmpresa === 'COMOING' ? ' plantel__pill--activo' : ''}" data-empresa="COMOING">
        Co.mo.ing&ensp;<span class="plantel__pill-count">${comoingCount}</span>
      </button>
    `;
    pillsEmp.querySelectorAll('[data-empresa]').forEach(btn => {
      btn.addEventListener('click', () => { filtroEmpresa = btn.dataset.empresa; renderPills(); renderTabla(datosActivos); });
    });

    const pillsTipo = contenedor.querySelector('#pres-pills-tipo');
    pillsTipo.innerHTML = `
      <button class="plantel__pill${!filtroTipo ? ' plantel__pill--activo' : ''}" data-tipo="">
        Todos&ensp;<span class="plantel__pill-count">${datosActivos.length}</span>
      </button>
      ${tiposConGente.map(t => `
      <button class="plantel__pill${filtroTipo === t ? ' plantel__pill--activo' : ''}" data-tipo="${t}">
        ${TIPO_LABEL[t]}&ensp;<span class="plantel__pill-count">${datosActivos.filter(d => tipoDe(d) === t).length}</span>
      </button>`).join('')}
    `;
    pillsTipo.querySelectorAll('[data-tipo]').forEach(btn => {
      btn.addEventListener('click', () => { filtroTipo = btn.dataset.tipo; renderPills(); renderTabla(datosActivos); });
    });
  }

  async function cargarYMostrar() {
    tablaWrap.innerHTML = '<div class="pres__loading">Cargando…</div>';
    try {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/rrhh_horas_mensual?periodo=eq.${periodoActivo}&order=apellido.asc`,
        { headers: HDR }
      );
      datosActivos = r.ok ? await r.json() : [];
    } catch { datosActivos = []; }
    renderPills();
    renderTabla(datosActivos);
  }

  function filtrarDatos(datos) {
    const texto = normTxt(filtroTexto.trim());
    return datos.filter(d =>
      (!filtroEmpresa || d.empresa === filtroEmpresa) &&
      (!filtroTipo || tipoDe(d) === filtroTipo) &&
      (!texto || normTxt(`${d.apellido || ''} ${d.nombre || ''}`).includes(texto) || String(d.legajo).includes(texto))
    );
  }

  function valorOrden(fila, clave) {
    switch (clave) {
      case 'legajo':       return +fila.legajo;
      case 'apellido':     return `${fila.apellido || ''} ${fila.nombre || ''}`.trim();
      case 'departamento': return fila.departamento || '';
      case 'pres':         return fila.presentismo_pct !== null ? +fila.presentismo_pct : null;
      case 'cumpl':        return fila.cumplimiento_hs_pct !== null ? +fila.cumplimiento_hs_pct : null;
      case 'extra50':      return +fila.hs_extra50 || 0;
      case 'nojust':       return +fila.hs_no_justificadas || 0;
      default:             return null;
    }
  }

  let filasVisibles = [];

  function renderTabla(datos) {
    const filtrados = filtrarDatos(datos);
    if (!filtrados.length) {
      tablaWrap.innerHTML = filtroTexto.trim()
        ? '<div class="pres__vacio">Sin resultados para la búsqueda.</div>'
        : '<div class="pres__vacio">Sin datos para este período.</div>';
      return;
    }

    filasVisibles = [...filtrados].sort(orden.comparador(valorOrden));

    tablaWrap.innerHTML = `
      <table class="pres__tabla" id="pres-tabla">
        <thead>
          <tr>
            ${orden.thHtml('legajo', 'Leg.', { clase: 'pres__th--leg' })}
            ${orden.thHtml('apellido', 'Apellido y nombre')}
            ${orden.thHtml('departamento', 'Departamento', { clase: 'pres__th--dep' })}
            ${orden.thHtml('pres', 'Pres. días', { clase: 'pres__th--num', attrs: 'title="Días presente vs días esperados"' })}
            ${orden.thHtml('cumpl', 'Cumpl. hs', { clase: 'pres__th--num', attrs: 'title="Horas normales vs horas esperadas"' })}
            ${orden.thHtml('extra50', 'Extra 50%', { clase: 'pres__th--num' })}
            ${orden.thHtml('nojust', 'Hs no just.', { clase: 'pres__th--num' })}
            <th class="pres__th--exp"></th>
          </tr>
        </thead>
        <tbody id="pres-tbody">
          ${filasVisibles.map(d => filaHTML(d)).join('')}
        </tbody>
      </table>
    `;

    tablaWrap.querySelector('#pres-tbody').addEventListener('click', e => {
      const btn = e.target.closest('.pres__btn-exp');
      if (btn) abrirDetalle(btn);
    });

    // Búsqueda que dejó a una sola persona → mostrarle el desglose directamente, sin
    // un clic extra (para cuando RRHH cita a alguien y quiere explicarle sus horas ahí mismo).
    if (filtroTexto.trim() && filasVisibles.length === 1) {
      abrirDetalle(tablaWrap.querySelector('.pres__btn-exp'));
    }
  }

  async function abrirDetalle(btn) {
      if (!btn) return;
      const legajo  = +btn.dataset.legajo;
      const filaId  = `pres-det-${legajo}`;
      const existente = tablaWrap.querySelector(`#${filaId}`);

      if (existente) {
        existente.remove();
        btn.textContent = '▶';
        btn.setAttribute('aria-expanded', 'false');
        return;
      }

      // Cerrar cualquier fila expandida
      tablaWrap.querySelector('.pres__fila-det')?.remove();
      tablaWrap.querySelectorAll('.pres__btn-exp').forEach(b => {
        b.textContent = '▶'; b.setAttribute('aria-expanded', 'false');
      });

      btn.textContent = '▼';
      btn.setAttribute('aria-expanded', 'true');

      const fila = btn.closest('tr');
      const detRow = document.createElement('tr');
      detRow.id = filaId;
      detRow.className = 'pres__fila-det';
      detRow.innerHTML = `<td colspan="11"><div class="pres__det-loading">Cargando detalle…</div></td>`;
      fila.insertAdjacentElement('afterend', detRow);

      const persona = filasVisibles.find(d => +d.legajo === legajo);
      const cacheKey = `${legajo}-${periodoActivo}`;
      let detalle = detalleCache.get(cacheKey);
      let eventos = eventosCache.get(cacheKey);
      let otDelMes = otCache.get(cacheKey);
      if (detalle === undefined || eventos === undefined || otDelMes === undefined) {
        try {
          const [rDet, rEv, rOt] = await Promise.all([
            fetch(`${SUPABASE_URL}/rest/v1/rrhh_horas_detalle?legajo=eq.${legajo}&periodo=eq.${periodoActivo}&order=fecha.asc,tipo_hora.asc`, { headers: HDR }),
            fetch(`${SUPABASE_URL}/rest/v1/rrhh_tardanzas_salidas?legajo=eq.${legajo}&periodo=eq.${periodoActivo}`, { headers: HDR }),
            persona?.empresa
              ? fetch(`${SUPABASE_URL}/rest/v1/horas_ot_detalle?legajo=eq.${legajo}&periodo=eq.${periodoActivo}&empresa=eq.${persona.empresa}&anomalo=eq.false&select=fecha,ot,operacion,horas`, { headers: HDR })
              : Promise.resolve(null),
          ]);
          detalle = rDet.ok ? await rDet.json() : [];
          eventos = rEv.ok ? await rEv.json() : [];
          otDelMes = rOt?.ok ? await rOt.json() : [];
          detalleCache.set(cacheKey, detalle);
          eventosCache.set(cacheKey, eventos);
          otCache.set(cacheKey, otDelMes);
        } catch (err) {
          console.error('Error al cargar detalle:', err);
          detalle = []; eventos = []; otDelMes = [];
        }
      }

      const tdDet = detRow.querySelector('td');
      tdDet.setAttribute('colspan', '11');
      tdDet.innerHTML = renderDetalle(detalle, persona, eventos, otDelMes);
  }

  function filaHTML(d) {
    const ext50    = +d.hs_extra50         || 0;
    const noJust   = +d.hs_no_justificadas || 0;
    const diasPres = +d.dias_presentes     || 0;
    const diasNojust = +d.dias_ausentes_nojust || 0;
    const diasTotal  = diasPres + diasNojust;
    const presDias   = d.presentismo_pct !== null ? d.presentismo_pct : null;
    const cumplHs    = d.cumplimiento_hs_pct !== null ? d.cumplimiento_hs_pct : null;

    const toltipDias = diasTotal > 0 ? `${diasPres}/${diasTotal} días` : '';
    const toltipHs   = d.hs_esperadas > 0 ? `${(+d.hs_normales||0).toFixed(0)}h / ${(+d.hs_esperadas||0).toFixed(0)}h` : '';

    return `
      <tr class="pres__fila-emp">
        <td class="pres__td--leg">${d.legajo}</td>
        <td>${eP(d.apellido)}${d.nombre ? `, ${eP(d.nombre)}` : ''}</td>
        <td class="pres__td--dep">${eP(d.departamento || '—')}</td>
        <td class="pres__td--num" title="${toltipDias}" style="${colorPresentismo(presDias)}">
          ${presDias !== null ? presDias + '%' : '—'}
        </td>
        <td class="pres__td--num" title="${toltipHs}" style="${colorPresentismo(cumplHs)}">
          ${cumplHs !== null ? cumplHs + '%' : '—'}
        </td>
        <td class="pres__td--num">${hmin(ext50)}</td>
        <td class="pres__td--num">${hmin(noJust)}</td>
        <td class="pres__td--exp">
          <button class="pres__btn-exp" data-legajo="${d.legajo}"
                  aria-label="Ver detalle de ${eP(d.apellido)}" aria-expanded="false"
                  type="button">▶</button>
        </td>
      </tr>
    `;
  }

  function renderDetalle(detalle, persona, eventos = [], otDelMes = []) {
    const tipo = empMap.get(String(persona?.legajo)) || 'sin_asignar';
    const isMensual = tipo === 'mensual';
    // Ausencias (ej. VACACION) por fecha — a lo sumo una por día.
    const ausenciaPorFecha = new Map(eventos.filter(e => e.tipo === 'ausente').map(e => [e.fecha, e]));
    // Horas por OT (Capataz) del día — cada fecha puede tener más de una OT/tarea.
    const otPorFecha = new Map();
    otDelMes.forEach(o => {
      if (!otPorFecha.has(o.fecha)) otPorFecha.set(o.fecha, []);
      otPorFecha.get(o.fecha).push({
        etiqueta: o.ot ? `OT ${o.ot}` : (o.operacion || 'Sin OT'),
        horas: +o.horas || 0,
      });
    });

    if (!detalle.length) {
      return `<div class="pres__det-vacio">
        No hay datos de detalle diario para este período.<br>
        <span style="font-size:0.82rem;opacity:0.7">Volvé a cargar el archivo desde la pestaña <strong>Cargar datos</strong> para ver el desglose diario.</span>
      </div>`;
    }

    const porFecha = new Map();
    detalle.forEach(d => {
      if (!porFecha.has(d.fecha)) porFecha.set(d.fecha, []);
      porFecha.get(d.fecha).push(d);
    });

    const DIAS_SEM = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
    function diaSemana(fechaStr) {
      const [y, m, d] = fechaStr.split('-');
      return DIAS_SEM[new Date(+y, +m-1, +d).getDay()];
    }

    function calcularDia(filas, fecha) {
      const hsnor  = filas.filter(f => f.tipo_hora === 'HSNOR');
      // Co.mo.ing exporta la hora extra al 50% como 'HSEXT' (sin el sufijo "50" — ver la
      // misma aclaración en presentismo-carga.js); Cimomet sí usa 'HSEXT50' explícito.
      // 'HS 50 VAC' / 'HS 100 VAC' son la hora extra de días de vacaciones trabajadas —
      // mismo concepto de extra, Tango solo la separa en otro código para liquidarla distinto.
      // Sin aceptar todos los códigos acá, el detalle diario perdía esa hora extra (no
      // aparecía en la columna "Extra 50%"/"Extra 100%" ni sumaba al total, aunque sí se
      // contaba bien en el acumulado mensual de rrhh_horas_mensual una vez arreglado ahí).
      const ext50  = filas.filter(f => f.tipo_hora === 'HSEXT' || f.tipo_hora === 'HSEXT50' || f.tipo_hora === 'HS 50 VAC');
      const ext100 = filas.filter(f => f.tipo_hora === 'HSEXT100' || f.tipo_hora === 'HS 100 VAC');
      const vac    = filas.filter(f => f.tipo_hora === 'HS VAC');

      const hs_reales = filas.reduce((s, f) => s + (+f.hs_reales          || 0), 0);
      const hs_norm   = hsnor.reduce((s, f)  => s + (+f.hs_trabajadas      || 0), 0);
      const hs_just   = hsnor.reduce((s, f)  => s + (+f.hs_justificadas    || 0), 0);
      const hs_nojust = hsnor.reduce((s, f)  => s + (+f.hs_no_justificadas || 0), 0);
      const hs_e50    = ext50.reduce((s, f)  => s + (+f.hs_trabajadas      || 0), 0);
      const hs_e100   = ext100.reduce((s, f) => s + (+f.hs_trabajadas      || 0), 0);
      const hs_esp    = hsnor.reduce((s, f)  => s + (+f.hs_esperadas       || 0), 0);
      // "Vacaciones trabajadas" (tipo_hora HS VAC): esperadas reales, pero Tango no completa
      // "trabajadas" para este concepto — el dato de horas trabajadas viene por "reales".
      const vac_esperadas  = vac.reduce((s, f) => s + (+f.hs_esperadas || 0), 0);
      const vac_trabajadas = vac.reduce((s, f) => s + (+f.hs_reales    || 0), 0);

      // Mensuales: balance = horas reales (tiempo en el lugar de trabajo) - esperadas.
      // Quincenales: balance = horas normales acreditadas (trabajadas) - esperadas, sin extras.
      // Las horas de vacaciones trabajadas se suman a ambos lados en los dos criterios
      // (en mensuales ya venían incluidas sin querer dentro de "hs_reales").
      // positivo → cumplió la jornada y le sobra; negativo → déficit de jornada
      const hs_base = (isMensual ? hs_reales : hs_norm + vac_trabajadas);
      const hs_esp_total = hs_esp + vac_esperadas;
      const balance = hs_esp_total > 0 ? +(hs_base - hs_esp_total).toFixed(2) : null;

      const descJust = hsnor.find(f => f.descripcion_tipo_hora && f.hs_justificadas > 0)?.descripcion_tipo_hora
        || filas.find(f => f.descripcion_tipo_hora)?.descripcion_tipo_hora || '';

      const ausencia = ausenciaPorFecha.get(fecha);
      const esVacacionNoTrabajada = ausencia?.codigo_justificacion === 'VACACION' && hs_reales <= 0;
      // Motivo de ausencia (Enfermedad/Accidente/Aviso/Sin aviso, ver Horas y Presentismo →
      // Parametrización) — solo aplica si ese día hay un evento de ausencia real (no vacación,
      // que ya se muestra aparte) y la persona no vino a trabajar.
      const categoriaDia = (ausencia && !esVacacionNoTrabajada)
        ? categoriaAusencia(ausencia.codigo_justificacion, mapaAusencias) : null;

      let estado, estadoLabel, categoria = null;
      if (vac_trabajadas > 0) {
        // Prioridad sobre presente/extras/fuera de horario: es información más específica.
        estado = 'vactrab'; estadoLabel = 'Vacaciones trabajadas';
      } else if (hs_reales > 0) {
        const tieneExtra   = hs_e50 + hs_e100 > 0;
        const fueraHorario = hs_nojust > 0.05;
        if (fueraHorario && tieneExtra) {
          estado = 'parcial'; estadoLabel = 'Fuera de horario + extras';
        } else if (fueraHorario) {
          estado = 'parcial'; estadoLabel = 'Fuera de horario';
        } else if (tieneExtra) {
          estado = 'extra';   estadoLabel = 'Con horas extra';
        } else {
          estado = 'ok';      estadoLabel = 'Presente';
        }
      } else if (esVacacionNoTrabajada) {
        estado = 'vacaciones'; estadoLabel = 'Vacaciones';
      } else if (categoriaDia) {
        estado = 'ausencia'; estadoLabel = CATEGORIA_LABEL[categoriaDia]; categoria = categoriaDia;
      } else if (hs_just > 0) {
        estado = 'justif'; estadoLabel = descJust ? `Justificado: ${descJust}` : 'Justificado';
      } else if (hs_esp_total <= 0) {
        estado = 'libre';  estadoLabel = 'Sin horas programadas';
      } else {
        estado = 'falta';  estadoLabel = 'Ausente sin justificar';
      }

      return {
        hs_reales, hs_norm, hs_just, hs_nojust, hs_e50, hs_e100, hs_esp,
        vac_esperadas, vac_trabajadas, balance, descJust, estado, estadoLabel, categoria,
      };
    }

    const dias = [...porFecha.keys()].sort();

    // Pre-calcular todos los días para las métricas del resumen
    const calculos = new Map(dias.map(f => [f, calcularDia(porFecha.get(f), f)]));

    // ── Métricas analíticas del período ──────────────────────────────────────
    const hayEsperadas = dias.some(f => (calculos.get(f).hs_esp + calculos.get(f).vac_esperadas) > 0);
    let totalEsp = 0, totalReales = 0, totalNorm = 0;
    let totalVacEsp = 0, totalVacTrab = 0;
    let totalE50 = 0, totalE100 = 0, totalJust = 0, totalNojust = 0;
    let diasSobrec = 0, diasExtra = 0, diasFuera = 0, diasFalta = 0, diasPresentes = 0, diasVacTrab = 0;
    let diasPresentesSemana = 0, diasPresentesSabado = 0;
    let sumaBalPos = 0, sumaBalNeg = 0;

    for (const [f, c] of calculos) {
      totalEsp    += c.hs_esp;
      totalReales += c.hs_reales;
      totalNorm   += c.hs_norm;
      totalVacEsp += c.vac_esperadas;
      totalVacTrab += c.vac_trabajadas;
      totalE50    += c.hs_e50;
      totalE100   += c.hs_e100;
      totalJust   += c.hs_just;
      totalNojust += c.hs_nojust;
      if (c.estado === 'sobrec')  { diasSobrec++;   sumaBalPos += c.balance || 0; }
      if (c.estado === 'extra')   { diasExtra++;    sumaBalPos += Math.max(0, c.balance || 0); }
      if (c.estado === 'parcial') { diasFuera++;    sumaBalNeg += Math.abs(c.balance || c.hs_nojust); }
      if (c.estado === 'falta')   { diasFalta++; }
      if (c.estado === 'vactrab') { diasVacTrab++; }
      if (c.hs_reales > 0) {
        diasPresentes++;
        if (new Date(f + 'T00:00:00').getDay() === 6) diasPresentesSabado++; else diasPresentesSemana++;
      }
    }
    const totalEspTotal  = totalEsp + totalVacEsp;
    const totalBaseNorm  = isMensual ? totalReales : totalNorm;
    const totalBase      = isMensual ? totalReales : totalNorm + totalVacTrab;
    const balTotal        = hayEsperadas ? +(totalBase - totalEspTotal).toFixed(2) : null;

    function fmtBal(v, clasePos, claseNeg) {
      if (v === null) return '';
      const b = hminBal(v);
      if (!b) return `<span class="pres__anal-num pres__anal-num--neutro">±0</span>`;
      return `<span class="pres__anal-num ${b.cls.replace('pres__det-td--bal-pos', clasePos).replace('pres__det-td--bal-neg', claseNeg).replace('pres__det-td--bal-ok','pres__anal-num--neutro')}">${b.txt}</span>`;
    }

    // Tarjeta analítica
    const tarjetaAnalitica = `
      <div class="pres__anal-grid">
        <div class="pres__anal-item">
          <span class="pres__anal-val">${diasPresentes}</span>
          <span class="pres__anal-lbl">Días presente</span>
          ${diasPresentesSabado > 0 ? `<span class="pres__anal-sub">${diasPresentesSemana} de semana · ${diasPresentesSabado} sábado${diasPresentesSabado !== 1 ? 's' : ''}</span>` : ''}
        </div>
        ${totalReales > 0 ? `
        <div class="pres__anal-item">
          <span class="pres__anal-val">${hmin(totalReales)}</span>
          <span class="pres__anal-lbl">Horas reales</span>
          <span class="pres__anal-sub">Tiempo total en el trabajo</span>
        </div>` : ''}
        ${hayEsperadas ? `
        <div class="pres__anal-item pres__anal-item--dest ${balTotal > 0 ? 'pres__anal-item--pos' : balTotal < -0.5 ? 'pres__anal-item--neg' : ''}">
          <span class="pres__anal-val">${fmtBal(balTotal, 'pres__anal-num--pos', 'pres__anal-num--neg')}</span>
          <span class="pres__anal-lbl">Balance del período</span>
          <span class="pres__anal-sub">${hmin(totalBase)} ${isMensual ? 'reales' : 'trabajadas'}${!isMensual && totalVacTrab > 0 ? ` (${hmin(totalBaseNorm)} normales + ${hmin(totalVacTrab)} vac. trabajadas)` : ''} de ${hmin(totalEspTotal)} esperadas${totalVacEsp > 0 ? ` (${hmin(totalEsp)} normales + ${hmin(totalVacEsp)} vac. esperadas)` : ''}</span>
        </div>
` : ''}
        ${totalE50 + totalE100 > 0 ? `
        <div class="pres__anal-item">
          <span class="pres__anal-val" style="color:#7c3aed">${(totalE50 + totalE100).toFixed(1)}h</span>
          <span class="pres__anal-lbl">Horas extra (${diasExtra} días)</span>
          <span class="pres__anal-sub">${hmin(totalE50)} al 50%${totalE100 > 0 ? ` · ${hmin(totalE100)} al 100%` : ''}</span>
        </div>` : ''}
        ${totalVacTrab > 0 ? `
        <div class="pres__anal-item">
          <span class="pres__anal-val" style="color:#4f46e5">${hmin(totalVacTrab)}</span>
          <span class="pres__anal-lbl">Vacaciones trabajadas (${diasVacTrab} día${diasVacTrab !== 1 ? 's' : ''})</span>
        </div>` : ''}
        ${diasFuera > 0 ? `
        <div class="pres__anal-item">
          <span class="pres__anal-val" style="color:#ea580c">${diasFuera}</span>
          <span class="pres__anal-lbl">Días fuera de horario</span>
          <span class="pres__anal-sub">${hmin(totalNojust)} en total</span>
        </div>` : ''}
        ${diasFalta > 0 ? `
        <div class="pres__anal-item">
          <span class="pres__anal-val" style="color:#dc2626">${diasFalta}</span>
          <span class="pres__anal-lbl">Ausencias sin justificar</span>
        </div>` : ''}
        ${totalJust > 0 ? `
        <div class="pres__anal-item">
          <span class="pres__anal-val" style="color:#d97706">${hmin(totalJust)}</span>
          <span class="pres__anal-lbl">Horas justificadas</span>
        </div>` : ''}
      </div>
    `;

    // ── Calendario visual ─────────────────────────────────────────────────────
    const iconos = { ok: '✓', extra: '+', parcial: '~', justif: 'J', falta: '✗', libre: '·', vacaciones: 'V', vactrab: 'VT' };
    const casillas = dias.map(fecha => {
      const c = calculos.get(fecha);
      const hsMostrar = c.hs_reales > 0.01 ? c.hs_reales : 0;
      // 'ausencia' es un solo estado para 4 motivos distintos — el color va por dato (por
      // categoría), no por CSS fijo como el resto de los estados.
      const esAusencia = c.estado === 'ausencia';
      const icono = esAusencia ? CATEGORIA_ICONO[c.categoria] : iconos[c.estado];
      const colorIcono = esAusencia ? ` style="color:${CATEGORIA_COLOR[c.categoria]}"` : '';
      return `
        <div class="pres__cal-dia pres__cal-dia--${c.estado}" title="${fecha}${c.balance !== null ? ' · balance ' + (c.balance >= 0 ? '+' : '') + c.balance.toFixed(2) + 'h' : ''}">
          <span class="pres__cal-fecha">${diaYMes(fecha)}</span>
          <span class="pres__cal-icon"${colorIcono}>${icono}</span>
          ${hsMostrar > 0.01 ? `<span class="pres__cal-hs">${hsMostrar.toFixed(1)}h</span>` : ''}
        </div>
      `;
    }).join('');

    // ── Tabla detallada ───────────────────────────────────────────────────────
    const n = hmin;

    const filasTbl = dias.map(fecha => {
      const c = calculos.get(fecha);
      const { hs_reales, hs_norm, hs_just, hs_nojust, hs_e50, hs_e100, hs_esp, vac_esperadas, vac_trabajadas, balance, descJust, estado, categoria } = c;
      const hs_esp_dia = hs_esp + vac_esperadas;
      const [, mm, dd] = fecha.split('-');

      const estadoBadge = {
        ok:      `<span class="pres__det-est pres__det-est--ok">✓ Presente</span>`,
        extra:   `<span class="pres__det-est pres__det-est--extra">+ Extras</span>`,
        parcial: `<span class="pres__det-est pres__det-est--parcial">~ Fuera hor.</span>`,
        justif:  `<span class="pres__det-est pres__det-est--justif" title="${eP(descJust)}">J ${eP(descJust || 'Justificado')}</span>`,
        falta:   `<span class="pres__det-est pres__det-est--falta">✗ Ausente</span>`,
        libre:   `<span class="pres__det-est" style="color:#94a3b8">· Sin programar</span>`,
        vacaciones: `<span class="pres__det-est pres__det-est--vacaciones">V Vacaciones</span>`,
        vactrab:    `<span class="pres__det-est pres__det-est--vactrab">VT Vacaciones trabajadas</span>`,
        // Motivo de ausencia — un solo estado, color por dato según la categoría asignada
        // en Horas y Presentismo → Parametrización (ver también el calendario, arriba).
        ausencia: `<span class="pres__det-est" style="color:${CATEGORIA_COLOR[categoria]};background:${CATEGORIA_COLOR[categoria]}1a;border-color:${CATEGORIA_COLOR[categoria]}55">${CATEGORIA_ICONO[categoria]} ${CATEGORIA_LABEL[categoria]}</span>`,
      }[estado];

      const nojustCell = hs_nojust > 0.01
        ? (hs_reales > 0
          ? `<span class="pres__det-td--fhor">${n(hs_nojust)}</span>`
          : `<span class="pres__det-td--nojust">${n(hs_nojust)}</span>`)
        : '—';

      let balanceCell = '—';
      if (balance !== null && hs_reales > 0) {
        const b = hminBal(balance);
        balanceCell = `<span class="${b.cls}">${b.txt}</span>`;
      }

      return `
        <tr class="pres__det-tr pres__det-tr--${estado}">
          <td class="pres__det-td pres__det-td--fecha">${+dd}/${+mm} ${diaSemana(fecha)}</td>
          <td class="pres__det-td">${estadoBadge}</td>
          <td class="pres__det-td pres__det-td--num">${n(hs_reales)}</td>
          <td class="pres__det-td pres__det-td--num">${hs_esp_dia > 0 ? n(hs_esp_dia) : '—'}</td>
          <td class="pres__det-td pres__det-td--num pres__det-td--bal">${balanceCell}</td>
          <td class="pres__det-td pres__det-td--num">${(hs_norm + vac_trabajadas) > 0 ? n(hs_norm + vac_trabajadas) : '—'}</td>
          <td class="pres__det-td pres__det-td--num">${n(hs_e50)}</td>
          <td class="pres__det-td pres__det-td--num">${n(hs_e100)}</td>
          <td class="pres__det-td pres__det-td--num">${n(hs_just)}</td>
          <td class="pres__det-td pres__det-td--num">${nojustCell}</td>
          <td class="pres__det-td pres__det-td--ot">${celdaOT(diaYMes(fecha), otPorFecha.get(fecha))}</td>
        </tr>
      `;
    }).join('');

    return `
      <div class="pres__det-inner">
        <div class="pres__det-titulo">
          Detalle — ${eP(persona?.apellido || '')} ${eP(persona?.nombre || '')}
          <span class="pres__det-periodo">${formatearPeriodo(periodoActivo)} · ${
            tipo === 'mensual' ? 'Mensual' : tipo === 'quincenal' ? 'Quincenal' : '⚠ Sin clasificar'
          }</span>
        </div>
        ${tarjetaAnalitica}
        <div class="pres__cal-grid">${casillas}</div>
        <div class="pres__cal-leyenda">
          <span class="pres__cal-leg pres__cal-leg--ok">✓ Presente</span>
          <span class="pres__cal-leg pres__cal-leg--extra">+ Con extras</span>
          <span class="pres__cal-leg pres__cal-leg--parcial">~ Fuera de horario</span>
          <span class="pres__cal-leg pres__cal-leg--vacaciones">V Vacaciones</span>
          <span class="pres__cal-leg pres__cal-leg--vactrab">VT Vacaciones trabajadas</span>
          ${CATEGORIAS_LEYENDA.map(cat => `<span class="pres__cal-leg" style="color:${CATEGORIA_COLOR[cat]};border-color:${CATEGORIA_COLOR[cat]}55;background:${CATEGORIA_COLOR[cat]}1a">${CATEGORIA_ICONO[cat]} ${CATEGORIA_LABEL[cat]}</span>`).join('')}
        </div>
        <div class="pres__det-tabla-wrap">
          <table class="pres__det-tabla">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Estado</th>
                <th title="Horas reales en el lugar de trabajo">Reales</th>
                <th title="Horas esperadas según jornada">Esperadas</th>
                <th title="${isMensual ? 'Reales menos esperadas' : 'Trabajadas menos esperadas (puesto sin clasificar usa este criterio por defecto)'}">Balance</th>
                <th title="Horas normales acreditadas como trabajadas (HSNOR), incluye vacaciones trabajadas">Trabajadas</th>
                <th>Extra 50%</th>
                <th>Extra 100%</th>
                <th title="Horas no trabajadas justificadas">Justif.</th>
                <th title="Horas fuera del horario habitual o sin justificar">F. hor.</th>
                <th title="Desglose por OT según Capataz — pasá el mouse sobre la barra">OT (Capataz)</th>
              </tr>
            </thead>
            <tbody>${filasTbl}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  cargarYMostrar();
}
