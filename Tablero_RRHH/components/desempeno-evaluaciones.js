// Desempeño → Evaluaciones.
// Submódulo único que reemplaza a las antiguas pestañas separadas "Evaluación anual" y "Período
// de prueba": acá se busca a UNA persona y el sistema decide solo, con corresponde()/
// enPeriodoPrueba() (desempeno-cargar.js), si le toca la evaluación anual (F-84) o la de período
// de prueba (F-101) — nunca las dos, nunca a elección de quien evalúa. Antes existía una pestaña
// para cada una y era posible entrar a la equivocada; acá esa elección ya no existe.
//
// El formulario de cada tipo vive en su propio archivo (montarEvaluacionAnual en
// desempeno-cargar.js, montarEvaluacionPrueba en desempeno-prueba.js) — este módulo solo posee la
// búsqueda, las dos listas de pendientes y el selector de año, y delega el formulario en sí.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';
import { obtenerClasificacionPuestos, tipoPuesto, normPuesto } from '../data/clasificacion-puestos.js';
import { obtenerConfigDesempeno, obtenerConfigPorPuesto, CONFIG_DEFAULT } from '../data/desempeno-config.js';
import { obtenerReingresosManualesSet } from '../data/reingresos-manuales.js';
import { obtenerPuestosExcluidosDesempeno } from '../data/desempeno-exclusiones.js';
import { obtenerPruebaForzadaMap } from '../data/prueba-forzada-manual.js';
import {
  EMP_LABEL, aniosDisponiblesDesempeno, corresponde, enPeriodoPrueba, diasDesdeIngreso,
  VENTANA_DIAS, montarEvaluacionAnual,
} from './desempeno-cargar.js';
import { montarEvaluacionPrueba, estadoPlazo } from './desempeno-prueba.js';

const HDR = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };

function eP(s) { return (s || '').toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function normTxt(s) { return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
function fmtFecha(iso) { const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}`; }

export async function renderizarDesempenoEvaluaciones(contenedor) {
  contenedor.innerHTML = '<p class="plantel__cargando">Cargando plantel…</p>';

  let empleados = [], mapaClasif = new Map(), config = CONFIG_DEFAULT, manualSet = new Set(), configPorPuesto = new Map(), puestosExcluidos = new Set(), forzadosMap = new Map();
  try {
    const [rE, mc, cfg, ms, cpp, pe, fs] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/empleados?select=legajo,apellido_y_nombre,empresa,desc_puesto,activo,fecha_ingreso,creado_en&limit=2000`, { headers: HDR }),
      obtenerClasificacionPuestos(),
      obtenerConfigDesempeno(),
      obtenerReingresosManualesSet(),
      obtenerConfigPorPuesto(),
      obtenerPuestosExcluidosDesempeno(),
      obtenerPruebaForzadaMap(),
    ]);
    empleados = rE.ok ? await rE.json() : [];
    mapaClasif = mc;
    config = cfg;
    manualSet = ms;
    configPorPuesto = cpp;
    puestosExcluidos = pe;
    forzadosMap = fs;
  } catch (e) {
    contenedor.innerHTML = `<div class="pres__vacio">Error al cargar el plantel: ${eP(e.message)}</div>`;
    return;
  }

  const activos = empleados.filter(e => e.activo);
  const hoy = new Date();

  contenedor.innerHTML = `
    <div class="pres__personas-wrap">
      <p class="pres__subtitulo" style="margin-bottom:var(--espacio-m)">
        El sistema detecta solo, para cada persona, si corresponde la evaluación anual (F-84) o la de
        período de prueba (F-101) según su antigüedad — no hace falta elegir entre las dos.
      </p>
      <div class="pres__periodo-bar" style="margin-bottom:var(--espacio-m)">
        <label class="pres__periodo-lbl">Año a evaluar (anual):</label>
        <select class="pres__periodo-sel" id="eval-anio">
          ${aniosDisponiblesDesempeno().map(a => `<option value="${a}">${a}</option>`).join('')}
        </select>
      </div>

      <div id="eval-pendientes-prueba-wrap" style="margin-bottom:var(--espacio-m)"></div>
      <div id="eval-pendientes-anual-wrap" style="margin-bottom:var(--espacio-l)"></div>

      <input type="search" class="plantel__busqueda" id="eval-busqueda"
             placeholder="Buscar persona por legajo o nombre…" autocomplete="off">
      <div id="eval-resultados" class="pres-ficha__resultados" hidden></div>
      <div id="eval-form">
        <p class="pres__vacio">Buscá una persona arriba, o elegí a alguien de la lista de pendientes, para cargar o editar su evaluación.</p>
      </div>
    </div>
  `;

  const selAnio        = contenedor.querySelector('#eval-anio');
  const input          = contenedor.querySelector('#eval-busqueda');
  const resultadosEl   = contenedor.querySelector('#eval-resultados');
  const formEl         = contenedor.querySelector('#eval-form');
  const pendPruebaWrap = contenedor.querySelector('#eval-pendientes-prueba-wrap');
  const pendAnualWrap  = contenedor.querySelector('#eval-pendientes-anual-wrap');

  let evaluadosPruebaSet = null;
  const cacheEvalsAnual = new Map(); // anio -> Set("legajo|empresa") ya evaluados ese año

  async function obtenerEvaluadosPrueba() {
    if (evaluadosPruebaSet) return evaluadosPruebaSet;
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/iso_evaluaciones_periodo_prueba?motivo=eq.ingreso&select=legajo,empresa`, { headers: HDR });
      const filas = r.ok ? await r.json() : [];
      evaluadosPruebaSet = new Set(filas.map(f => `${f.legajo}|${f.empresa}`));
    } catch { evaluadosPruebaSet = new Set(); }
    return evaluadosPruebaSet;
  }
  async function obtenerEvaluadosAnual(anio) {
    let set = cacheEvalsAnual.get(anio);
    if (set) return set;
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/iso_evaluaciones_desempeno?anio=eq.${anio}&select=legajo,empresa`, { headers: HDR });
      const filas = r.ok ? await r.json() : [];
      set = new Set(filas.map(f => `${f.legajo}|${f.empresa}`));
    } catch { set = new Set(); }
    cacheEvalsAnual.set(anio, set);
    return set;
  }

  // Por qué una persona no aparece como evaluable en ninguna de las dos listas — ni en período de
  // prueba (ya pasó la ventana) ni en anual (todavía no cumple antigüedad, puesto no clasificado,
  // o puesto excluido de Desempeño). Se usa en la búsqueda para explicar en vez de ocultar sin más.
  function explicarPorQueNoCorresponde(p) {
    if (!p.fecha_ingreso) return 'Sin fecha de ingreso cargada.';
    const tipo = tipoPuesto(p.desc_puesto, mapaClasif);
    if (tipo !== 'mensual' && tipo !== 'quincenal') return `"${eP(p.desc_puesto || 'Sin puesto')}" no está clasificado como mensual ni quincenal.`;
    if (puestosExcluidos.has(normPuesto(p.desc_puesto))) return 'Puesto excluido de la evaluación de desempeño.';
    return 'Todavía no le corresponde evaluación — no llega a los 365 días de antigüedad y ya no está en ventana de período de prueba.';
  }

  function abrirPersona(persona) {
    formEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (enPeriodoPrueba(persona, hoy, manualSet, forzadosMap)) {
      montarEvaluacionPrueba(formEl, persona, { manualSet, forzadosMap, hoy, onCambio: refrescarPendientes });
    } else {
      montarEvaluacionAnual(formEl, persona, {
        mapaClasif, config, configPorPuesto, puestosExcluidos, anio: +selAnio.value,
        onGuardado: refrescarPendientes,
      });
    }
  }

  async function renderPendientesPrueba() {
    pendPruebaWrap.innerHTML = '<div class="pres__loading">Cargando pendientes…</div>';
    const evalSet = await obtenerEvaluadosPrueba();
    const pendientes = activos
      .filter(p => enPeriodoPrueba(p, hoy, manualSet, forzadosMap) && !evalSet.has(`${p.legajo}|${p.empresa}`))
      .map(p => ({ ...p, dias: diasDesdeIngreso(p, hoy) }))
      .sort((a, b) => (VENTANA_DIAS - a.dias) - (VENTANA_DIAS - b.dias)); // más urgente primero

    if (!pendientes.length) {
      pendPruebaWrap.innerHTML = '<p class="pres__msg-exito">✓ No tenés evaluaciones de período de prueba pendientes.</p>';
      return;
    }
    pendPruebaWrap.innerHTML = `
      <div class="desem__pendientes">
        <div class="desem__pendientes-header">
          <span class="desem__pendientes-tit">Tenés ${pendientes.length} evaluaci${pendientes.length !== 1 ? 'ones' : 'ón'} de período de prueba pendiente${pendientes.length !== 1 ? 's' : ''}</span>
          <span class="desem__pendientes-sub">Se hacen antes de cumplir los 3 meses de ingreso.</span>
        </div>
        <div class="desem__pendientes-lista">
          ${pendientes.map(p => {
            const forzado = forzadosMap.has(`${p.legajo}|${p.empresa}`);
            const plazo = forzado ? { texto: 'Cambio de función', color: '#2563eb' } : estadoPlazo(p.dias);
            return `
            <button type="button" class="desem__pendiente-fila" data-legajo="${p.legajo}" data-empresa="${eP(p.empresa)}">
              <span class="desem__pendiente-nombre">${eP(p.apellido_y_nombre)}</span>
              <span class="desem__pendiente-meta">#${p.legajo} · ${EMP_LABEL[p.empresa] || p.empresa} · ${eP(p.desc_puesto || '—')} · Ingresó ${fmtFecha(p.fecha_ingreso)}</span>
              <span class="desem__pendiente-plazo" style="color:${plazo.color}">${plazo.texto}</span>
            </button>`;
          }).join('')}
        </div>
      </div>
    `;
    pendPruebaWrap.querySelectorAll('[data-legajo]').forEach(btn => {
      btn.addEventListener('click', () => {
        const persona = activos.find(p => String(p.legajo) === btn.dataset.legajo && p.empresa === btn.dataset.empresa);
        if (persona) abrirPersona(persona);
      });
    });
  }

  async function renderPendientesAnual() {
    const anio = +selAnio.value;
    pendAnualWrap.innerHTML = '<div class="pres__loading">Cargando pendientes…</div>';
    const evalSet = await obtenerEvaluadosAnual(anio);
    const pendientes = activos
      .filter(p => corresponde(p, anio, mapaClasif, manualSet, puestosExcluidos)
        && !enPeriodoPrueba(p, hoy, manualSet, forzadosMap)
        && !evalSet.has(`${p.legajo}|${p.empresa}`))
      .sort((a, b) => a.apellido_y_nombre.localeCompare(b.apellido_y_nombre));

    if (!pendientes.length) {
      pendAnualWrap.innerHTML = `<p class="pres__msg-exito">✓ No tenés evaluaciones anuales pendientes para ${anio}.</p>`;
      return;
    }
    pendAnualWrap.innerHTML = `
      <div class="desem__pendientes">
        <div class="desem__pendientes-header">
          <span class="desem__pendientes-tit">Tenés ${pendientes.length} evaluaci${pendientes.length !== 1 ? 'ones' : 'ón'} anual${pendientes.length !== 1 ? 'es' : ''} pendiente${pendientes.length !== 1 ? 's' : ''} de ${anio}</span>
          <span class="desem__pendientes-sub">Se completan entre noviembre y diciembre (PG 6.01: evaluación anual al 31/12) — se muestran desde ahora para que las puedas planificar.</span>
        </div>
        <div class="desem__pendientes-lista">
          ${pendientes.map(p => `
            <button type="button" class="desem__pendiente-fila" data-legajo="${p.legajo}" data-empresa="${eP(p.empresa)}">
              <span class="desem__pendiente-nombre">${eP(p.apellido_y_nombre)}</span>
              <span class="desem__pendiente-meta">#${p.legajo} · ${EMP_LABEL[p.empresa] || p.empresa} · ${eP(p.desc_puesto || '—')}</span>
            </button>`).join('')}
        </div>
      </div>
    `;
    pendAnualWrap.querySelectorAll('[data-legajo]').forEach(btn => {
      btn.addEventListener('click', () => {
        const persona = activos.find(p => String(p.legajo) === btn.dataset.legajo && p.empresa === btn.dataset.empresa);
        if (persona) abrirPersona(persona);
      });
    });
  }

  async function refrescarPendientes() {
    evaluadosPruebaSet = null;
    cacheEvalsAnual.clear();
    await Promise.all([renderPendientesPrueba(), renderPendientesAnual()]);
  }

  function filaResultado(p, anio) {
    if (enPeriodoPrueba(p, hoy, manualSet, forzadosMap)) {
      return `
        <button type="button" class="pres-ficha__resultado" data-legajo="${p.legajo}" data-empresa="${eP(p.empresa)}">
          <span class="pres-ficha__resultado-nombre">${eP(p.apellido_y_nombre)} <span class="desem__tag-tipo desem__tag-tipo--prueba">Período de prueba</span></span>
          <span class="pres-ficha__resultado-meta">Legajo #${p.legajo} · ${EMP_LABEL[p.empresa] || p.empresa}</span>
        </button>`;
    }
    if (corresponde(p, anio, mapaClasif, manualSet, puestosExcluidos)) {
      return `
        <button type="button" class="pres-ficha__resultado" data-legajo="${p.legajo}" data-empresa="${eP(p.empresa)}">
          <span class="pres-ficha__resultado-nombre">${eP(p.apellido_y_nombre)} <span class="desem__tag-tipo desem__tag-tipo--anual">Evaluación anual</span></span>
          <span class="pres-ficha__resultado-meta">Legajo #${p.legajo} · ${EMP_LABEL[p.empresa] || p.empresa}</span>
        </button>`;
    }
    return `
      <div class="pres-ficha__resultado pres-ficha__resultado--bloqueado" style="cursor:default">
        <span class="pres-ficha__resultado-nombre">${eP(p.apellido_y_nombre)}</span>
        <span class="pres-ficha__resultado-meta">${eP(explicarPorQueNoCorresponde(p))}</span>
      </div>`;
  }

  input.addEventListener('input', () => {
    const texto = normTxt(input.value.trim());
    if (!texto) { resultadosEl.hidden = true; resultadosEl.innerHTML = ''; return; }
    const anio = +selAnio.value;
    const coincidencias = activos
      .filter(p => normTxt(p.apellido_y_nombre).includes(texto) || String(p.legajo).includes(texto))
      .slice(0, 12);
    resultadosEl.hidden = false;
    resultadosEl.innerHTML = coincidencias.length
      ? coincidencias.map(p => filaResultado(p, anio)).join('')
      : `<p class="pres-ficha__sin-resultados">Sin resultados.</p>`;

    resultadosEl.querySelectorAll('[data-legajo]').forEach(btn => {
      btn.addEventListener('click', () => {
        resultadosEl.hidden = true; input.value = '';
        const persona = activos.find(p => String(p.legajo) === btn.dataset.legajo && p.empresa === btn.dataset.empresa);
        if (persona) abrirPersona(persona);
      });
    });
  });

  selAnio.addEventListener('change', () => { renderPendientesAnual(); });

  await Promise.all([renderPendientesPrueba(), renderPendientesAnual()]);
}
