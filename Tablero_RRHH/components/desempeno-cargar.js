// Desempeño → Cargar evaluación.
// Evaluación de desempeño anual (ISO — PG-6.01 / F-84). Ausentismo y llegadas tarde/salidas
// anticipadas se calculan solos a partir de lo que ya carga Tango, para mensuales y quincenales
// por igual; el resto (evaluación del superior, y en quincenales EPP/reprocesos) lo completa
// quien evalúa acá.
//
// "Mejora continua" (categoría del F-84 original para mensuales) se sacó del cálculo — hoy no
// hay ningún dato en el sistema que la alimente. El día que lo haya, se puede reintegrar
// sumándola de nuevo a calcularMensual() y bajando el peso de "evaluación del superior".

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';
import { obtenerClasificacionPuestos, tipoPuesto } from '../data/clasificacion-puestos.js';
import { obtenerUsuario } from '../data/usuario-activo.js';
import { mejorarSelectsEscala } from './selector-escala.js';
import { generarInformeAnualPDF } from './desempeno-informe.js';

const HDR = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
const HDR_JSON = { ...HDR, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' };

export const EMP_LABEL  = { CIMOMET: 'Cimomet', COMOING: 'Co.mo.ing' };
export const TIPO_LABEL = { mensual: 'Mensual', quincenal: 'Quincenal' };
export const RESULTADO_LABEL = { bueno: 'Bueno', regular: 'Regular', revision: 'Revisión' };
export const RESULTADO_COLOR = { bueno: '#16a34a', regular: '#d97706', revision: '#dc2626' };
// El módulo Desempeño arrancó en 2026 — no tiene sentido ofrecer años anteriores, no hay (ni va a
// haber) evaluaciones cargadas para esos años.
export const ANIO_MINIMO_DESEMPENO = 2026;
export function aniosDisponiblesDesempeno() {
  const anioActual = new Date().getFullYear();
  const anios = [];
  for (let a = anioActual; a >= ANIO_MINIMO_DESEMPENO; a--) anios.push(a);
  return anios;
}

function eP(s) { return (s || '').toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function normTxt(s) { return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
function fmtNum(v) { return (+v || 0).toLocaleString('es-AR', { maximumFractionDigits: 1 }); }
function opcionesNivel(valorSeleccionado) {
  return NIVELES_F84.map(n => `<option value="${n.valor}" ${+valorSeleccionado === n.valor ? 'selected' : ''}>${n.label}</option>`).join('');
}
export function labelNivel(valor) {
  if (valor === null || valor === undefined || valor === '') return '—';
  const n = NIVELES_F84.find(x => x.valor === +valor);
  return n ? n.label : '—';
}

// Escala única para TODOS los campos de apreciación manual del F-84 (Evaluación del superior en
// quincenal, Aptitudinal/Operativa en mensual, Cumplimiento de EPP y Calidad/reprocesos en
// quincenal) — mismas 5 palabras y los mismos puntos (0/25/50/75/100) en los dos tipos de
// persona, para que un "Bueno" signifique lo mismo se complete lo que se complete.
export const NIVELES_F84 = [
  { valor: 0,   label: 'Insuficiente' },
  { valor: 25,  label: 'Regular' },
  { valor: 50,  label: 'Bueno' },
  { valor: 75,  label: 'Muy bueno' },
  { valor: 100, label: 'Excelente' },
];

// ── Fórmula F-84 (ver nota de "Mejora continua" arriba) ──────────────────────
// La evaluación del superior se pide dividida en dos aspectos (aptitudinal y operativo) —
// mensual y quincenal por igual, porque en la práctica el supervisor evalúa esas dos cosas en
// los dos casos — cada uno con la escala de NIVELES_F84 (0-100), promediados para el peso que
// tenía el campo único (0-60 en mensual).
export function calcularMensual({ ausentismo_dias, tardanzas_cant, evaluacion_aptitudinal, evaluacion_operativa }) {
  const pAus  = Math.max(25 - ausentismo_dias * 3, 0);
  const pTard = Math.max(15 - tardanzas_cant * 1.1, 0);
  const evalProm = (evaluacion_aptitudinal + evaluacion_operativa) / 2;
  const pEval = evalProm / 100 * 60;
  const puntaje = pAus + pTard + pEval;
  return { puntaje, resultado: resultadoDe(puntaje), desglose: { pAus, pTard, pEval } };
}
// El F-84 original no pedía tardanzas para quincenal. Se sumó a pedido: se le sacaron 5 de los
// 15 puntos que tenía Ausentismo (mismo punto de cero: 5 días) y se los llevó Tardanzas (mismo
// punto de cero que en mensuales: ~13-14 tardanzas/año), sin tocar EPP/Reprocesos/Ev.Superior.
//
// EPP y Reprocesos no se cargan como conteo exacto (hoy no hay un registro objetivo de faltas de
// uso de EPP ni de reprocesos de calidad) — se cargan con la misma escala NIVELES_F84 (0-100:
// Insuficiente cumplimiento/calidad → Excelente), y se convierten a puntos de la misma manera
// (nivel/100 * máximo). Evaluación aptitudinal/operativa: mismo peso 0-50 que tenía el campo
// único "evaluación del superior" (misma fórmula que en calcularMensual, con máximo distinto).
export function calcularQuincenal({ ausentismo_dias, tardanzas_cant, epp_nivel, reprocesos_nivel, evaluacion_aptitudinal, evaluacion_operativa }) {
  const pAus    = Math.max(10 - ausentismo_dias * 2, 0);
  const pTard   = Math.max(5 - tardanzas_cant * 0.4, 0);
  const pEpp    = epp_nivel / 100 * 15;
  const pRepro  = reprocesos_nivel / 100 * 10;
  const evalProm = (evaluacion_aptitudinal + evaluacion_operativa) / 2;
  const pEval   = evalProm / 100 * 50;
  const puntaje = pAus + pTard + pEpp + pRepro + pEval;
  return { puntaje, resultado: resultadoDe(puntaje), desglose: { pAus, pTard, pEpp, pRepro, pEval } };
}
// Detecta reingresos: gente que renuncia (para cobrar el Fondo de Cese Laboral, algo habitual en
// el convenio) y vuelve a entrar sin haber dejado de trabajar en la práctica. Tango le pisa
// `fecha_ingreso` con la fecha de la recontratación, pero el legajo es el mismo de siempre.
// Se detecta sin cargar nada a mano: si esta fila YA estaba en el sistema (`creado_en`) antes de
// la fecha de ingreso que Tango informa hoy, es porque el ingreso se corrió hacia adelante — no es
// una persona nueva. No se conoce la fecha real de ingreso original, pero se sabe que es anterior.
export function esReingreso(persona) {
  return !!(persona.fecha_ingreso && persona.creado_en && persona.fecha_ingreso > persona.creado_en.slice(0, 10));
}

// ¿Corresponde evaluación ese año? Activo, con ≥365 días de antigüedad al 31/12 de `anio`
// (PG-6.01: "personal indeterminado o mayores a 365 días") y puesto clasificado mensual/quincenal.
// A quien reingresó se lo da directamente por cumplido: no sabemos su antigüedad real, pero es
// mayor a la que muestra `fecha_ingreso`, así que no tiene sentido hacerlo esperar 365 días de nuevo.
export function corresponde(persona, anio, mapaClasif) {
  if (!persona.activo || !persona.fecha_ingreso) return false;
  const tipo = tipoPuesto(persona.desc_puesto, mapaClasif);
  if (tipo !== 'mensual' && tipo !== 'quincenal') return false;
  if (esReingreso(persona)) return true;
  const cierre  = new Date(`${anio}-12-31T00:00:00`);
  const ingreso = new Date(`${persona.fecha_ingreso}T00:00:00`);
  return (cierre - ingreso) / 86400000 >= 365;
}

export function resultadoDe(puntaje) {
  if (puntaje < 40) return 'revision';
  if (puntaje < 60) return 'regular';
  return 'bueno';
}

export async function renderizarDesempenoCargar(contenedor) {
  contenedor.innerHTML = '<p class="plantel__cargando">Cargando plantel…</p>';

  let empleados = [], mapaClasif = new Map();
  try {
    const [rE, mc] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/empleados?select=legajo,apellido_y_nombre,empresa,desc_puesto,activo,fecha_ingreso,creado_en&limit=2000`, { headers: HDR }),
      obtenerClasificacionPuestos(),
    ]);
    empleados = rE.ok ? await rE.json() : [];
    mapaClasif = mc;
  } catch (e) {
    contenedor.innerHTML = `<div class="pres__vacio">Error al cargar el plantel: ${eP(e.message)}</div>`;
    return;
  }

  const activos = empleados.filter(e => e.activo);

  contenedor.innerHTML = `
    <div class="pres__personas-wrap">
      <div class="pres__periodo-bar" style="margin-bottom:var(--espacio-m)">
        <label class="pres__periodo-lbl">Año a evaluar:</label>
        <select class="pres__periodo-sel" id="desem-anio">
          ${aniosDisponiblesDesempeno().map(a => `<option value="${a}">${a}</option>`).join('')}
        </select>
      </div>

      <div id="desem-pendientes-wrap" style="margin-bottom:var(--espacio-l)"></div>

      <input type="search" class="plantel__busqueda" id="desem-busqueda"
             placeholder="Buscar persona por legajo o nombre…" autocomplete="off">
      <div id="desem-resultados" class="pres-ficha__resultados" hidden></div>
      <div id="desem-form">
        <p class="pres__vacio">Buscá una persona arriba, o elegí a alguien de la lista de pendientes, para cargar o editar su evaluación.</p>
      </div>
    </div>
  `;

  const selAnio      = contenedor.querySelector('#desem-anio');
  const input        = contenedor.querySelector('#desem-busqueda');
  const resultadosEl = contenedor.querySelector('#desem-resultados');
  const formEl       = contenedor.querySelector('#desem-form');
  const pendientesWrap = contenedor.querySelector('#desem-pendientes-wrap');
  let personaActual = null;
  const cacheEvals  = new Map(); // anio -> Set("legajo|empresa") ya evaluados ese año

  async function obtenerEvaluadosSet(anio) {
    let set = cacheEvals.get(anio);
    if (set) return set;
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/iso_evaluaciones_desempeno?anio=eq.${anio}&select=legajo,empresa`, { headers: HDR });
      const filas = r.ok ? await r.json() : [];
      set = new Set(filas.map(f => `${f.legajo}|${f.empresa}`));
    } catch { set = new Set(); }
    cacheEvals.set(anio, set);
    return set;
  }

  async function renderPendientes() {
    const anio = +selAnio.value;
    pendientesWrap.innerHTML = '<div class="pres__loading">Cargando pendientes…</div>';
    const evaluadosSet = await obtenerEvaluadosSet(anio);
    const pendientes = activos
      .filter(p => corresponde(p, anio, mapaClasif) && !evaluadosSet.has(`${p.legajo}|${p.empresa}`))
      .sort((a, b) => a.apellido_y_nombre.localeCompare(b.apellido_y_nombre));

    if (!pendientes.length) {
      pendientesWrap.innerHTML = `<p class="pres__msg-exito">✓ No tenés evaluaciones pendientes para ${anio}.</p>`;
      return;
    }
    pendientesWrap.innerHTML = `
      <div class="desem__pendientes">
        <div class="desem__pendientes-header">
          <span class="desem__pendientes-tit">Tenés ${pendientes.length} evaluaci${pendientes.length !== 1 ? 'ones' : 'ón'} pendiente${pendientes.length !== 1 ? 's' : ''} de ${anio}</span>
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
    pendientesWrap.querySelectorAll('[data-legajo]').forEach(btn => {
      btn.addEventListener('click', () => {
        const persona = activos.find(p => String(p.legajo) === btn.dataset.legajo && p.empresa === btn.dataset.empresa);
        if (persona) {
          cargarFormulario(persona);
          formEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  }

  input.addEventListener('input', () => {
    const texto = normTxt(input.value.trim());
    if (!texto) { resultadosEl.hidden = true; resultadosEl.innerHTML = ''; return; }
    const coincidencias = activos
      .filter(p => normTxt(p.apellido_y_nombre).includes(texto) || String(p.legajo).includes(texto))
      .slice(0, 12);
    resultadosEl.hidden = false;
    resultadosEl.innerHTML = coincidencias.length
      ? coincidencias.map(p => `
          <button type="button" class="pres-ficha__resultado" data-legajo="${p.legajo}" data-empresa="${eP(p.empresa)}">
            <span class="pres-ficha__resultado-nombre">${eP(p.apellido_y_nombre)}</span>
            <span class="pres-ficha__resultado-meta">Legajo #${p.legajo} · ${EMP_LABEL[p.empresa] || p.empresa}</span>
          </button>`).join('')
      : `<p class="pres-ficha__sin-resultados">Sin resultados.</p>`;

    resultadosEl.querySelectorAll('[data-legajo]').forEach(btn => {
      btn.addEventListener('click', () => {
        resultadosEl.hidden = true; input.value = '';
        const persona = activos.find(p => String(p.legajo) === btn.dataset.legajo && p.empresa === btn.dataset.empresa);
        if (persona) cargarFormulario(persona);
      });
    });
  });

  selAnio.addEventListener('change', () => {
    renderPendientes();
    if (personaActual) cargarFormulario(personaActual);
  });

  async function cargarFormulario(persona) {
    personaActual = persona;
    formEl.innerHTML = '<div class="pres__loading">Cargando…</div>';
    const anio = +selAnio.value;
    const tipo = tipoPuesto(persona.desc_puesto, mapaClasif);

    if (tipo !== 'mensual' && tipo !== 'quincenal') {
      formEl.innerHTML = `<div class="pres__vacio">"${eP(persona.desc_puesto || 'Sin puesto')}" no está clasificado como mensual ni quincenal. Clasificalo en Horas y Presentismo → Parametrización antes de evaluar a esta persona.</div>`;
      return;
    }

    const desde = `${anio}-01-01`, hasta = `${anio}-12-01`;
    try {
      const [rMen, rTard, rEval] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/rrhh_horas_mensual?legajo=eq.${persona.legajo}&empresa=eq.${persona.empresa}&periodo=gte.${desde}&periodo=lte.${hasta}&select=dias_ausentes_nojust`, { headers: HDR }),
        fetch(`${SUPABASE_URL}/rest/v1/rrhh_tardanzas_salidas?legajo=eq.${persona.legajo}&empresa=eq.${persona.empresa}&periodo=gte.${desde}&periodo=lte.${hasta}&tipo=in.(tarde,temprano)&select=id`, { headers: HDR }),
        fetch(`${SUPABASE_URL}/rest/v1/iso_evaluaciones_desempeno?legajo=eq.${persona.legajo}&empresa=eq.${persona.empresa}&anio=eq.${anio}&select=*`, { headers: HDR }),
      ]);
      const filasMen = rMen.ok ? await rMen.json() : [];
      const ausentismo_dias = filasMen.reduce((s, f) => s + (+f.dias_ausentes_nojust || 0), 0);
      const tardanzas_cant = rTard.ok ? (await rTard.json()).length : 0;
      const existentes = rEval.ok ? await rEval.json() : [];
      renderForm({ persona, tipo, anio, ausentismo_dias, tardanzas_cant, previa: existentes[0] || null });
    } catch (e) {
      formEl.innerHTML = `<div class="pres__vacio">Error al cargar los datos: ${eP(e.message)}</div>`;
    }
  }

  function renderForm({ persona, tipo, anio, ausentismo_dias, tardanzas_cant, previa }) {
    formEl.innerHTML = `
      <div class="pind__sec">
        <div class="pind__grupo-header" style="border-left-color:var(--color-primario)">
          <div class="pind__grupo-header-izq">
            <h2 class="pind__grupo-titulo">${eP(persona.apellido_y_nombre)}</h2>
            <div class="pind__grupo-badges">
              <span class="pind__grupo-badge pind__grupo-badge--desvinc">Legajo #${persona.legajo}</span>
              <span class="pind__grupo-badge pind__grupo-badge--desvinc">${EMP_LABEL[persona.empresa] || persona.empresa}</span>
              <span class="pind__grupo-badge pind__grupo-badge--desvinc">${eP(persona.desc_puesto || '—')}</span>
              <span class="pind__grupo-badge pind__grupo-badge--desvinc">${TIPO_LABEL[tipo]}</span>
              ${previa ? '<span class="pind__grupo-badge pind__grupo-badge--activo">Ya evaluado este año — editando</span>' : ''}
            </div>
          </div>
        </div>

        <div class="pind__kpis pind__kpis--sm" style="margin-top:var(--espacio-m)">
          <div class="pind__kpi">
            <span class="pind__kpi-num">${fmtNum(ausentismo_dias)}</span>
            <span class="pind__kpi-lbl">Días de ausentismo</span>
            <span class="pind__kpi-sub">Automático · ${anio}</span>
          </div>
          <div class="pind__kpi">
            <span class="pind__kpi-num">${tardanzas_cant}</span>
            <span class="pind__kpi-lbl">Llegadas tarde / salidas ant.</span>
            <span class="pind__kpi-sub">Automático · ${anio}</span>
          </div>
        </div>

        <div class="desem__form-manual">
          <label class="desem__campo">
            <span>Evaluación aptitudinal</span>
            <select id="desem-eval-apt" class="escala-select">
              <option value="">Elegir…</option>
              ${opcionesNivel(previa?.evaluacion_aptitudinal)}
            </select>
          </label>
          <label class="desem__campo">
            <span>Evaluación operativa</span>
            <select id="desem-eval-op" class="escala-select">
              <option value="">Elegir…</option>
              ${opcionesNivel(previa?.evaluacion_operativa)}
            </select>
          </label>
          ${tipo === 'quincenal' ? `
          <label class="desem__campo">
            <span>Cumplimiento de uso de EPP</span>
            <select id="desem-epp" class="escala-select">
              <option value="">Elegir…</option>
              ${opcionesNivel(previa?.epp_nivel)}
            </select>
          </label>
          <label class="desem__campo">
            <span>Calidad de trabajo (reprocesos)</span>
            <select id="desem-reprocesos" class="escala-select">
              <option value="">Elegir…</option>
              ${opcionesNivel(previa?.reprocesos_nivel)}
            </select>
          </label>` : ''}
          <label class="desem__campo desem__campo--full">
            <span>Aspecto destacable</span>
            <textarea id="desem-destacable" rows="2" class="desem__textarea">${eP(previa?.aspecto_destacable)}</textarea>
          </label>
          <label class="desem__campo desem__campo--full">
            <span>Aspecto a mejorar</span>
            <textarea id="desem-mejorar" rows="2" class="desem__textarea">${eP(previa?.aspecto_mejorar)}</textarea>
          </label>
        </div>

        <div id="desem-resultado-preview"></div>

        <div class="pres__carga-acciones">
          <button type="button" class="pres__btn-confirmar" id="desem-guardar">${previa ? 'Actualizar evaluación' : 'Guardar evaluación'}</button>
          <button type="button" class="pres__btn-ir-carga" id="desem-informe" disabled>⬇ Informe individual (PDF)</button>
        </div>
        <div id="desem-estado"></div>
      </div>
    `;
    mejorarSelectsEscala(formEl);

    const selEvalApt = formEl.querySelector('#desem-eval-apt');
    const selEvalOp  = formEl.querySelector('#desem-eval-op');
    const selEpp     = formEl.querySelector('#desem-epp');
    const selRepro   = formEl.querySelector('#desem-reprocesos');
    const previewEl  = formEl.querySelector('#desem-resultado-preview');
    const estadoEl   = formEl.querySelector('#desem-estado');
    const btnGuardar = formEl.querySelector('#desem-guardar');
    const btnInforme = formEl.querySelector('#desem-informe');

    function leerValores() {
      return {
        evaluacion_aptitudinal: selEvalApt.value === '' ? null : +selEvalApt.value,
        evaluacion_operativa: selEvalOp.value === '' ? null : +selEvalOp.value,
        epp_nivel: tipo === 'quincenal' ? (selEpp.value === '' ? null : +selEpp.value) : null,
        reprocesos_nivel: tipo === 'quincenal' ? (selRepro.value === '' ? null : +selRepro.value) : null,
      };
    }

    function actualizarPreview() {
      const v = leerValores();
      const completo = tipo === 'mensual'
        ? (v.evaluacion_aptitudinal !== null && v.evaluacion_operativa !== null)
        : (v.evaluacion_aptitudinal !== null && v.evaluacion_operativa !== null && v.epp_nivel !== null && v.reprocesos_nivel !== null);
      if (!completo) {
        previewEl.innerHTML = '<p class="pres__vacio-small">Completá los campos de arriba para ver el puntaje.</p>';
        btnInforme.disabled = true;
        return null;
      }
      const calc = tipo === 'mensual'
        ? calcularMensual({ ausentismo_dias, tardanzas_cant, evaluacion_aptitudinal: v.evaluacion_aptitudinal, evaluacion_operativa: v.evaluacion_operativa })
        : calcularQuincenal({ ausentismo_dias, tardanzas_cant, epp_nivel: v.epp_nivel, reprocesos_nivel: v.reprocesos_nivel, evaluacion_aptitudinal: v.evaluacion_aptitudinal, evaluacion_operativa: v.evaluacion_operativa });
      previewEl.innerHTML = `
        <div class="desem__resultado" style="border-color:${RESULTADO_COLOR[calc.resultado]}">
          <span class="desem__resultado-puntaje" style="color:${RESULTADO_COLOR[calc.resultado]}">${calc.puntaje.toFixed(1)}</span>
          <span class="desem__resultado-label" style="color:${RESULTADO_COLOR[calc.resultado]}">${RESULTADO_LABEL[calc.resultado]}</span>
        </div>`;
      btnInforme.disabled = false;
      return { ...v, ...calc };
    }

    selEvalApt?.addEventListener('change', actualizarPreview);
    selEvalOp?.addEventListener('change', actualizarPreview);
    selEpp?.addEventListener('change', actualizarPreview);
    selRepro?.addEventListener('change', actualizarPreview);
    actualizarPreview();

    btnInforme.addEventListener('click', () => {
      const resultadoCalc = actualizarPreview();
      if (!resultadoCalc) return;
      generarInformeAnualPDF({
        persona, tipo, anio,
        datos: {
          ausentismo_dias, tardanzas_cant,
          epp_nivel: resultadoCalc.epp_nivel, reprocesos_nivel: resultadoCalc.reprocesos_nivel,
          evaluacion_aptitudinal: resultadoCalc.evaluacion_aptitudinal,
          evaluacion_operativa: resultadoCalc.evaluacion_operativa,
          puntaje: resultadoCalc.puntaje, resultado: resultadoCalc.resultado,
          aspecto_destacable: formEl.querySelector('#desem-destacable').value.trim(),
          aspecto_mejorar: formEl.querySelector('#desem-mejorar').value.trim(),
          evaluado_por: previa?.evaluado_por || obtenerUsuario()?.nombre || null,
          fecha_evaluacion: previa?.fecha_evaluacion || new Date().toISOString().slice(0, 10),
        },
      });
    });

    btnGuardar.addEventListener('click', async () => {
      const resultadoCalc = actualizarPreview();
      if (!resultadoCalc) {
        estadoEl.innerHTML = '<p class="pres__msg-error">Completá la evaluación aptitudinal y operativa' + (tipo === 'quincenal' ? ', el cumplimiento de EPP y la calidad de trabajo' : '') + ' antes de guardar.</p>';
        return;
      }
      btnGuardar.disabled = true;
      const textoOriginal = btnGuardar.textContent;
      btnGuardar.textContent = 'Guardando…';
      try {
        const body = {
          legajo: +persona.legajo, empresa: persona.empresa, anio, tipo,
          ausentismo_dias, tardanzas_cant,
          epp_nivel: resultadoCalc.epp_nivel ?? null, reprocesos_nivel: resultadoCalc.reprocesos_nivel ?? null,
          evaluacion_aptitudinal: resultadoCalc.evaluacion_aptitudinal ?? null,
          evaluacion_operativa: resultadoCalc.evaluacion_operativa ?? null,
          // Se guarda el promedio aptitudinal/operativa en los dos tipos, para tener un único
          // campo comparable en Indicadores/exportaciones (mensual y quincenal usan la misma
          // pregunta dividida en dos aspectos).
          evaluacion_superior: (resultadoCalc.evaluacion_aptitudinal + resultadoCalc.evaluacion_operativa) / 2,
          puntaje: +resultadoCalc.puntaje.toFixed(2), resultado: resultadoCalc.resultado,
          aspecto_destacable: formEl.querySelector('#desem-destacable').value.trim() || null,
          aspecto_mejorar: formEl.querySelector('#desem-mejorar').value.trim() || null,
          evaluado_por: obtenerUsuario()?.nombre || null,
          fecha_evaluacion: new Date().toISOString().slice(0, 10),
          actualizado_en: new Date().toISOString(),
        };
        const r = await fetch(`${SUPABASE_URL}/rest/v1/iso_evaluaciones_desempeno?on_conflict=legajo,empresa,anio`, {
          method: 'POST', headers: HDR_JSON, body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(`Supabase: error ${r.status}`);
        // No se vuelve a cargar todo el formulario acá — pisaría este mismo mensaje de éxito
        // al toque. Alcanza con actualizar el botón y el badge "ya evaluado" a mano.
        estadoEl.innerHTML = '<p class="pres__msg-exito">✓ Evaluación guardada.</p>';
        btnGuardar.disabled = false;
        btnGuardar.textContent = 'Actualizar evaluación';
        const badgesEl = formEl.querySelector('.pind__grupo-badges');
        if (badgesEl && !badgesEl.querySelector('.pind__grupo-badge--activo')) {
          badgesEl.insertAdjacentHTML('beforeend', '<span class="pind__grupo-badge pind__grupo-badge--activo">Ya evaluado este año — editando</span>');
        }
        // Actualiza el set en memoria (sin ir a pedirlo de nuevo) y refresca la lista de
        // pendientes para que esta persona desaparezca de ahí al toque.
        (await obtenerEvaluadosSet(anio)).add(`${persona.legajo}|${persona.empresa}`);
        renderPendientes();
      } catch (err) {
        estadoEl.innerHTML = `<p class="pres__msg-error">No se pudo guardar: ${eP(err.message)}</p>`;
        btnGuardar.disabled = false;
        btnGuardar.textContent = textoOriginal;
      }
    });
  }

  await renderPendientes();
}
