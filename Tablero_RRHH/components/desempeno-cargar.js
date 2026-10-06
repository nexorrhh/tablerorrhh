// Desempeño → Cargar evaluación.
// Evaluación de desempeño anual (ISO — PG-6.01 / F-84). Ausentismo y llegadas tarde/salidas
// anticipadas se calculan solos a partir de lo que ya carga Tango, para mensuales y quincenales
// por igual; el resto (evaluación del superior, EPP, reprocesos) lo completa quien evalúa acá.
// Mensuales y quincenales evalúan los mismos aspectos, con el mismo puntaje por default — lo que
// varía es el puesto (ver Personalizar por puesto en Parametrización), no el tipo de personal.
//
// "Mejora continua" (categoría del F-84 original para mensuales) se sacó del cálculo — hoy no
// hay ningún dato en el sistema que la alimente. El día que lo haya, se puede reintegrar
// sumándola de nuevo a calcularDesempeno() y bajando el peso de "evaluación del superior".

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';
import { obtenerClasificacionPuestos, tipoPuesto, normPuesto } from '../data/clasificacion-puestos.js';
import { obtenerUsuario } from '../data/usuario-activo.js';
import { obtenerConfigDesempeno, obtenerConfigPorPuesto, resolverConfigPersona, CONFIG_DEFAULT, REPROCESOS_LABEL_DEFAULT } from '../data/desempeno-config.js';
import { obtenerReingresosManualesSet } from '../data/reingresos-manuales.js';
import { obtenerPuestosExcluidosDesempeno } from '../data/desempeno-exclusiones.js';
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
// 2025 se habilita únicamente para que se pueda cargar a mano como referencia (no había
// datos en el sistema ese año) y así, al evaluar 2026, se pueda "copiar" lo del año anterior
// cambiando el selector de año — no representa que el sistema ya tuviera datos desde 2025.
export const ANIO_MINIMO_DESEMPENO = 2025;
// A partir de este año el ausentismo/tardanzas del F-84 salen solos de lo que cargó Tango
// (rrhh_horas_mensual / rrhh_tardanzas_salidas). 2025 quedó habilitado más arriba solo como
// referencia manual, pero no hay datos de Tango de ese año — por eso ahí esos dos campos se
// cargan a mano en vez de salir automáticos (ver renderForm).
export const PRIMER_ANIO_CON_DATOS_TANGO = 2026;
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
// El puntaje máximo de cada aspecto y el punto en que Ausentismo/Tardanzas llegan a 0 son
// configurables desde Desempeño → Parametrización (tabla iso_desempeno_config, ver
// data/desempeno-config.js). `cfg` es la fila de esa config para el tipo correspondiente (o la
// personalizada del puesto, ver resolverConfigPersona) — si no se pasa, se usa CONFIG_DEFAULT.
//
// Mensuales y quincenales evalúan exactamente los mismos aspectos — la única diferencia entre
// puestos es el peso configurado de cada uno, no el tipo de personal. Un aspecto que no aplica a
// un puesto puntual (ej. EPP para Administración) no se "saca del código": se deja su máximo en
// 0/deshabilitado desde Personalizar por puesto y se reparten esos puntos en otro aspecto — ver
// Desempeño → Parametrización.
//
// EPP y Reprocesos no se cargan como conteo exacto (hoy no hay un registro objetivo de faltas de
// uso de EPP ni de reprocesos de calidad) — se cargan con la misma escala NIVELES_F84 (0-100:
// Insuficiente cumplimiento/calidad → Excelente), igual que la evaluación aptitudinal/operativa,
// y se convierten a puntos de la misma manera (nivel/100 * máximo configurado).
//
// Un aspecto puede estar desactivado (cfg.epp_max/reprocesos_max en null, ver Desempeño →
// Parametrización → Personalizar por puesto) — en ese caso no se le pide esa pregunta y no suma
// ni resta puntaje, en vez de romper la cuenta con un NaN.
export function calcularDesempeno({ ausentismo_dias, tardanzas_cant, epp_nivel, reprocesos_nivel, evaluacion_aptitudinal, evaluacion_operativa }, cfg = CONFIG_DEFAULT.quincenal) {
  const pAus    = Math.max(cfg.ausentismo_max * (1 - ausentismo_dias / cfg.ausentismo_dias_cero), 0);
  const pTard   = Math.max(cfg.tardanzas_max * (1 - tardanzas_cant / cfg.tardanzas_cant_cero), 0);
  const pEpp    = cfg.epp_max ? ((epp_nivel ?? 0) / 100 * cfg.epp_max) : 0;
  const pRepro  = cfg.reprocesos_max ? ((reprocesos_nivel ?? 0) / 100 * cfg.reprocesos_max) : 0;
  const evalProm = (evaluacion_aptitudinal + evaluacion_operativa) / 2;
  const pEval   = evalProm / 100 * cfg.evaluacion_max;
  const puntaje = pAus + pTard + pEpp + pRepro + pEval;
  return { puntaje, resultado: resultadoDe(puntaje), desglose: { pAus, pTard, pEpp, pRepro, pEval } };
}
// Detecta reingresos: gente que renuncia (para cobrar el Fondo de Cese Laboral, algo habitual en
// el convenio) y vuelve a entrar sin haber dejado de trabajar en la práctica. Tango le pisa
// `fecha_ingreso` con la fecha de la recontratación, pero el legajo es el mismo de siempre.
// Se detecta sin cargar nada a mano: si esta fila YA estaba en el sistema (`creado_en`) antes de
// la fecha de ingreso que Tango informa hoy, es porque el ingreso se corrió hacia adelante — no es
// una persona nueva. No se conoce la fecha real de ingreso original, pero se sabe que es anterior.
//
// Límite conocido: esto solo puede detectar reingresos que pasaron DESPUÉS de que el sistema
// empezó a registrar gente — si alguien reingresó antes de esa fecha, no hay nada contra qué
// comparar. Para esos casos, `manualSet` (de data/reingresos-manuales.js, cargado a mano desde
// Desempeño → Parametrización) completa lo que la detección automática no puede ver.
export function esReingreso(persona, manualSet = null) {
  const automatico = !!(persona.fecha_ingreso && persona.creado_en && persona.fecha_ingreso > persona.creado_en.slice(0, 10));
  if (automatico) return true;
  return !!manualSet?.has(`${persona.legajo}|${persona.empresa}`);
}

// Ventana de período de prueba (F-101) — compartida acá y en desempeno-prueba.js para poder
// decidir, desde CUALQUIERA de los dos módulos, si a una persona le corresponde anual o período
// de prueba (nunca ambos): ver enPeriodoPrueba() más abajo.
export const VENTANA_DIAS = 90;          // PG-6.01: "antes de cumplir los tres meses"
export const VENTANA_VISIBLE_DIAS = 180; // se sigue mostrando un tiempo después de vencida, para no perderla de vista

export function diasDesdeIngreso(persona, hoy) {
  return Math.floor((hoy - new Date(`${persona.fecha_ingreso}T00:00:00`)) / 86400000);
}

// ¿Le corresponde período de prueba (y no anual) en este momento? Recién ingresada (dentro de la
// ventana visible) y no reingresada — un reingreso ya tiene antigüedad real y pasa directo a
// evaluación anual, nunca a período de prueba. Usado para que "Evaluación anual" y "Período de
// prueba" no se pisen: cada persona aparece como evaluable en uno solo de los dos módulos.
// `forzadosMap` (data/prueba-forzada-manual.js, Map de "legajo|empresa" -> {motivo,
// fecha_referencia}) es la excepción manual al revés de `manualSet`: alguien con antigüedad real
// pero que tuvo un cambio de función (PG-6.01) — el sistema no guarda historial de puesto, así que
// no hay forma de detectarlo solo; RRHH lo marca a mano desde Desempeño → Parametrización.
// Mientras esté marcado, gana por sobre la ventana/reingreso.
export function enPeriodoPrueba(persona, hoy, manualSet = null, forzadosMap = null) {
  if (forzadosMap?.has(`${persona.legajo}|${persona.empresa}`)) return true;
  if (!persona.fecha_ingreso || esReingreso(persona, manualSet)) return false;
  const dias = diasDesdeIngreso(persona, hoy);
  return dias >= 0 && dias <= VENTANA_VISIBLE_DIAS;
}

// Para calcular días-transcurridos/presentismo/puntualidad de un forzado por cambio de función:
// si RRHH cargó una fecha_referencia (desde cuándo está en el puesto nuevo), se usa esa en vez de
// la fecha de ingreso real a la empresa (que para estos casos ya no sirve de referencia — puede
// ser de varios años atrás). Devuelve una copia de `persona` con fecha_ingreso reemplazado; nunca
// toca el objeto original, así esReingreso()/corresponde() —que sí necesitan la fecha real— no se
// ven afectados por este reemplazo.
export function personaConFechaEfectiva(persona, forzadosMap) {
  const fila = forzadosMap?.get(`${persona.legajo}|${persona.empresa}`);
  if (!fila?.fecha_referencia) return persona;
  return { ...persona, fecha_ingreso: fila.fecha_referencia };
}

// ¿Corresponde evaluación ese año? Activo, con ≥365 días de antigüedad al 31/12 de `anio`
// (PG-6.01: "personal indeterminado o mayores a 365 días"), puesto clasificado mensual/quincenal,
// y que el puesto no esté excluido de Desempeño puntualmente (ver data/desempeno-exclusiones.js —
// ej. Gerencia: clasificado mensual para Presentismo, pero no se evalúa).
// A quien reingresó se lo da directamente por cumplido: no sabemos su antigüedad real, pero es
// mayor a la que muestra `fecha_ingreso`, así que no tiene sentido hacerlo esperar 365 días de nuevo.
export function corresponde(persona, anio, mapaClasif, manualSet = null, puestosExcluidos = null) {
  if (!persona.activo || !persona.fecha_ingreso) return false;
  const tipo = tipoPuesto(persona.desc_puesto, mapaClasif);
  if (tipo !== 'mensual' && tipo !== 'quincenal') return false;
  if (puestosExcluidos?.has(normPuesto(persona.desc_puesto))) return false;
  if (esReingreso(persona, manualSet)) return true;
  const cierre  = new Date(`${anio}-12-31T00:00:00`);
  const ingreso = new Date(`${persona.fecha_ingreso}T00:00:00`);
  return (cierre - ingreso) / 86400000 >= 365;
}

export function resultadoDe(puntaje) {
  if (puntaje < 40) return 'revision';
  if (puntaje < 60) return 'regular';
  return 'bueno';
}

// Monta en `formEl` la evaluación anual (F-84) de una persona puntual — llamado desde el
// submódulo unificado "Desempeño → Evaluaciones" (desempeno-evaluaciones.js), que es quien decide
// (con corresponde()/enPeriodoPrueba()) si a esta persona le toca esta evaluación o la de período
// de prueba, y quien posee la búsqueda/pendientes/año-selector compartidos entre ambas.
// `ctx`: { mapaClasif, config, configPorPuesto, puestosExcluidos, anio, onGuardado }.
// `onGuardado` se llama después de guardar con éxito, para que el módulo que llama refresque sus
// listas de pendientes (acá no se mantiene ningún set en memoria propio).
export async function montarEvaluacionAnual(formEl, persona, ctx) {
  const { mapaClasif, config, configPorPuesto, puestosExcluidos, anio, onGuardado } = ctx;
  formEl.innerHTML = '<div class="pres__loading">Cargando…</div>';
  const tipo = tipoPuesto(persona.desc_puesto, mapaClasif);

  if (tipo !== 'mensual' && tipo !== 'quincenal') {
    formEl.innerHTML = `<div class="pres__vacio">"${eP(persona.desc_puesto || 'Sin puesto')}" no está clasificado como mensual ni quincenal. Clasificalo en Horas y Presentismo → Parametrización antes de evaluar a esta persona.</div>`;
    return;
  }
  if (puestosExcluidos.has(normPuesto(persona.desc_puesto))) {
    formEl.innerHTML = `<div class="pres__vacio">"${eP(persona.desc_puesto || 'Sin puesto')}" está excluido de la evaluación de desempeño (ver Desempeño → Parametrización → Personalizar por puesto).</div>`;
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

  function renderForm({ persona, tipo, anio, ausentismo_dias, tardanzas_cant, previa }) {
    // Si RRHH personalizó el puntaje de este puesto (Desempeño → Parametrización), se usa ese;
    // si no, el default de mensual/quincenal.
    const cfg = resolverConfigPersona(persona, tipo, config, configPorPuesto);
    // Antes de PRIMER_ANIO_CON_DATOS_TANGO (hoy: solo 2025) no hay ausentismo/tardanzas
    // automáticos — se cargan a mano. Si ya se había guardado una evaluación de ese año, se
    // parte de lo que quedó guardado en vez de 0.
    const editableAutomaticos = anio < PRIMER_ANIO_CON_DATOS_TANGO;
    const ausentismoInicial = previa?.ausentismo_dias ?? ausentismo_dias;
    const tardanzasInicial  = previa?.tardanzas_cant ?? tardanzas_cant;
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
          ${editableAutomaticos ? `
          <label class="desem__campo">
            <span>Días de ausentismo</span>
            <input type="number" min="0" step="1" id="desem-ausentismo-input" value="${ausentismoInicial}">
            <span class="pind__kpi-sub">Sin datos de Tango para ${anio} · cargalo a mano</span>
          </label>
          <label class="desem__campo">
            <span>Llegadas tarde / salidas ant.</span>
            <input type="number" min="0" step="1" id="desem-tardanzas-input" value="${tardanzasInicial}">
            <span class="pind__kpi-sub">Sin datos de Tango para ${anio} · cargalo a mano</span>
          </label>` : `
          <div class="pind__kpi">
            <span class="pind__kpi-num">${fmtNum(ausentismo_dias)}</span>
            <span class="pind__kpi-lbl">Días de ausentismo</span>
            <span class="pind__kpi-sub">Automático · ${anio}</span>
          </div>
          <div class="pind__kpi">
            <span class="pind__kpi-num">${tardanzas_cant}</span>
            <span class="pind__kpi-lbl">Llegadas tarde / salidas ant.</span>
            <span class="pind__kpi-sub">Automático · ${anio}</span>
          </div>`}
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
          ${cfg.epp_max ? `
          <label class="desem__campo">
            <span>Cumplimiento de uso de EPP</span>
            <select id="desem-epp" class="escala-select">
              <option value="">Elegir…</option>
              ${opcionesNivel(previa?.epp_nivel)}
            </select>
          </label>` : ''}
          ${cfg.reprocesos_max ? `
          <label class="desem__campo">
            <span>${eP(cfg.reprocesos_label || REPROCESOS_LABEL_DEFAULT)}</span>
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
    const inputAus   = formEl.querySelector('#desem-ausentismo-input');
    const inputTard  = formEl.querySelector('#desem-tardanzas-input');

    // Mientras no haya datos de Tango (editableAutomaticos), usa lo que se tipeó a mano; si no,
    // el valor automático que ya trajo cargarFormulario().
    function automaticos() {
      return {
        ausentismo_dias: inputAus ? (+inputAus.value || 0) : ausentismo_dias,
        tardanzas_cant: inputTard ? (+inputTard.value || 0) : tardanzas_cant,
      };
    }

    function leerValores() {
      return {
        evaluacion_aptitudinal: selEvalApt.value === '' ? null : +selEvalApt.value,
        evaluacion_operativa: selEvalOp.value === '' ? null : +selEvalOp.value,
        epp_nivel: selEpp ? (selEpp.value === '' ? null : +selEpp.value) : null,
        reprocesos_nivel: selRepro ? (selRepro.value === '' ? null : +selRepro.value) : null,
      };
    }

    function actualizarPreview() {
      const v = leerValores();
      // EPP/Reprocesos solo hacen falta si este puesto los tiene habilitados (si no, el campo ni
      // se muestra — ver "Personalizar por puesto" en Parametrización).
      const completo = v.evaluacion_aptitudinal !== null && v.evaluacion_operativa !== null
        && (!selEpp || v.epp_nivel !== null) && (!selRepro || v.reprocesos_nivel !== null);
      if (!completo) {
        previewEl.innerHTML = '<p class="pres__vacio-small">Completá los campos de arriba para ver el puntaje.</p>';
        btnInforme.disabled = true;
        return null;
      }
      const { ausentismo_dias, tardanzas_cant } = automaticos();
      const calc = calcularDesempeno({ ausentismo_dias, tardanzas_cant, epp_nivel: v.epp_nivel, reprocesos_nivel: v.reprocesos_nivel, evaluacion_aptitudinal: v.evaluacion_aptitudinal, evaluacion_operativa: v.evaluacion_operativa }, cfg);
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
    inputAus?.addEventListener('input', actualizarPreview);
    inputTard?.addEventListener('input', actualizarPreview);
    actualizarPreview();

    btnInforme.addEventListener('click', () => {
      const resultadoCalc = actualizarPreview();
      if (!resultadoCalc) return;
      generarInformeAnualPDF({
        persona, tipo, anio, cfg,
        datos: {
          ...automaticos(),
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
        const faltantes = ['la evaluación aptitudinal y operativa'];
        if (selEpp) faltantes.push('el cumplimiento de EPP');
        if (selRepro) faltantes.push((cfg.reprocesos_label || REPROCESOS_LABEL_DEFAULT).toLowerCase());
        estadoEl.innerHTML = `<p class="pres__msg-error">Completá ${faltantes.join(', ')} antes de guardar.</p>`;
        return;
      }
      btnGuardar.disabled = true;
      const textoOriginal = btnGuardar.textContent;
      btnGuardar.textContent = 'Guardando…';
      try {
        const body = {
          legajo: +persona.legajo, empresa: persona.empresa, anio, tipo,
          ...automaticos(),
          epp_nivel: resultadoCalc.epp_nivel ?? null, reprocesos_nivel: resultadoCalc.reprocesos_nivel ?? null,
          evaluacion_aptitudinal: resultadoCalc.evaluacion_aptitudinal ?? null,
          evaluacion_operativa: resultadoCalc.evaluacion_operativa ?? null,
          // Se guarda el promedio aptitudinal/operativa en los dos tipos, para tener un único
          // campo comparable en Indicadores/exportaciones (mensual y quincenal usan la misma
          // pregunta dividida en dos aspectos).
          // Redondeado: evaluacion_superior es una columna entera en la base (viene de una
          // escala vieja 0-5), y el promedio de aptitudinal/operativa puede dar con decimales
          // (ej. 75 y 50 → 62.5) — sin esto Supabase rechaza el guardado con error 400.
          evaluacion_superior: Math.round((resultadoCalc.evaluacion_aptitudinal + resultadoCalc.evaluacion_operativa) / 2),
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
        onGuardado?.();
      } catch (err) {
        estadoEl.innerHTML = `<p class="pres__msg-error">No se pudo guardar: ${eP(err.message)}</p>`;
        btnGuardar.disabled = false;
        btnGuardar.textContent = textoOriginal;
      }
    });
  }
}
