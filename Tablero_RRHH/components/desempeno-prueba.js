// Desempeño → Período de prueba.
// Evaluación de período de prueba / cambio de función (ISO — PG-6.01 / F-101) — distinta de la
// anual (F-84): se dispara por INGRESO (dentro de los primeros 3 meses), no por antigüedad ni
// año. Combina 4 aspectos calificados a mano (Escaso/Regular/Bueno/Muy bueno/Excelente) con
// presentismo y puntualidad calculados automáticamente desde los partes (mismas fórmulas que
// usa Horas y Presentismo → Indicadores), todo promediado a un único resultado.
//
// Por ahora solo cubre el disparador "ingreso nuevo" (se calcula solo desde fecha_ingreso). El
// disparador "cambio de función" queda pendiente de una fase futura: hoy el sistema no guarda
// historial de puesto, así que no hay forma de detectar solo un cambio de función.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';
import { obtenerUsuario } from '../data/usuario-activo.js';
import {
  resultadoDe, RESULTADO_LABEL, RESULTADO_COLOR, esReingreso,
  diasDesdeIngreso, VENTANA_DIAS, VENTANA_VISIBLE_DIAS, personaConFechaEfectiva,
} from './desempeno-cargar.js';
import { mejorarSelectsEscala } from './selector-escala.js';
import { generarInformePruebaPDF } from './desempeno-informe.js';
import { marcarReingresoManual } from '../data/reingresos-manuales.js';

const HDR = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
const HDR_JSON = { ...HDR, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' };

export const EMP_LABEL = { CIMOMET: 'Cimomet', COMOING: 'Co.mo.ing' };
// VENTANA_DIAS / VENTANA_VISIBLE_DIAS / diasDesdeIngreso ahora viven en desempeno-cargar.js (las
// necesita también la Evaluación anual, para no pisarse con el período de prueba — ver
// enPeriodoPrueba() ahí). Se re-exportan acá para no romper a quien ya las importaba de este archivo
// (ej. Evaluadores/evaluador-panel.js).
export { diasDesdeIngreso, VENTANA_DIAS, VENTANA_VISIBLE_DIAS };

export const ASPECTOS = [
  { campo: 'seguridad',      label: 'Cumplimiento de normas de seguridad' },
  { campo: 'dominio_tareas', label: 'Nivel de dominio de las tareas del puesto' },
  { campo: 'normas_iso',     label: 'Cumplimiento de las normas ISO y/o procedimiento del puesto' },
  { campo: 'proactividad',   label: 'Proactividad y cooperación' },
];
export const NIVELES = [
  { valor: 0,   label: 'Escaso' },
  { valor: 25,  label: 'Regular' },
  { valor: 50,  label: 'Bueno' },
  { valor: 75,  label: 'Muy bueno' },
  { valor: 100, label: 'Excelente' },
];

function eP(s) { return (s || '').toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function normTxt(s) { return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
function fmtFecha(iso) { const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}`; }

// Exportado: lo reusa desempeno-evaluaciones.js para la lista de pendientes de período de prueba.
export function estadoPlazo(dias) {
  const restante = VENTANA_DIAS - dias;
  if (restante < 0) return { texto: `Vencida hace ${Math.abs(restante)} día${Math.abs(restante) !== 1 ? 's' : ''}`, color: '#dc2626' };
  if (restante <= 15) return { texto: `Vence en ${restante} día${restante !== 1 ? 's' : ''}`, color: '#d97706' };
  return { texto: `Vence en ${restante} días`, color: '#16a34a' };
}
// Repite (a propósito, no se exporta) el mismo chequeo automático de esReingreso() en
// desempeno-cargar.js — acá solo hace falta para elegir qué texto mostrar (detectado solo vs.
// marcado a mano), no para decidir si corresponde o no período de prueba.
function fueDetectadoAutomatico(persona) {
  return !!(persona.fecha_ingreso && persona.creado_en && persona.fecha_ingreso > persona.creado_en.slice(0, 10));
}
function colorPct(pct) {
  return pct == null ? 'var(--color-texto-sec)' : pct >= 95 ? '#16a34a' : pct >= 90 ? '#d97706' : '#dc2626';
}
function fechaISO(d) { return d.toISOString().slice(0, 10); }

// Presentismo y puntualidad durante el período de prueba (desde fecha_ingreso hasta hoy),
// con las mismas fórmulas que usa Horas y Presentismo → Indicadores (presGlobal / indicePuntualidad).
export async function datosAutomaticos(persona, hoy) {
  const desdePeriodo = `${persona.fecha_ingreso.slice(0, 7)}-01`;
  const hastaPeriodo = `${fechaISO(hoy).slice(0, 7)}-01`;
  const [rMen, rTard] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/rrhh_horas_mensual?legajo=eq.${persona.legajo}&empresa=eq.${persona.empresa}&periodo=gte.${desdePeriodo}&periodo=lte.${hastaPeriodo}&select=dias_presentes,dias_ausentes_nojust`, { headers: HDR }),
    fetch(`${SUPABASE_URL}/rest/v1/rrhh_tardanzas_salidas?legajo=eq.${persona.legajo}&empresa=eq.${persona.empresa}&fecha=gte.${persona.fecha_ingreso}&fecha=lte.${fechaISO(hoy)}&tipo=in.(tarde,temprano)&select=fecha`, { headers: HDR }),
  ]);
  const filasMen = rMen.ok ? await rMen.json() : [];
  const filasTard = rTard.ok ? await rTard.json() : [];
  const totalDiasPres   = filasMen.reduce((s, f) => s + (+f.dias_presentes || 0), 0);
  const totalDiasNojust = filasMen.reduce((s, f) => s + (+f.dias_ausentes_nojust || 0), 0);
  const diasConIncidente = new Set(filasTard.map(f => f.fecha)).size;

  const presentismoPct = (totalDiasPres + totalDiasNojust) > 0
    ? +((totalDiasPres / (totalDiasPres + totalDiasNojust)) * 100).toFixed(1) : null;
  const puntualidadPct = totalDiasPres > 0
    ? +(((totalDiasPres - diasConIncidente) / totalDiasPres) * 100).toFixed(1) : null;

  return { presentismoPct, puntualidadPct, diasAusentes: totalDiasNojust, diasConIncidente };
}

// Monta en `formEl` la evaluación de período de prueba (F-101) de una persona puntual — llamado
// desde el submódulo unificado "Desempeño → Evaluaciones" (desempeno-evaluaciones.js), que es
// quien decide si a esta persona le toca esta evaluación o la anual, y quien posee la
// búsqueda/pendientes compartidos entre ambas.
// `ctx`: { manualSet, forzadosMap, hoy, onCambio }. `onCambio` se llama después de guardar con
// éxito o de marcar a alguien como reingreso, para que el módulo que llama refresque sus listas
// de pendientes. `forzadosMap` (data/prueba-forzada-manual.js): legajos marcados a mano para
// período de prueba por cambio de función, aunque ya tengan antigüedad real — ver enPeriodoPrueba()
// en desempeno-cargar.js. Si además tienen una fecha_referencia cargada (desde cuándo están en el
// puesto nuevo), los cálculos de acá (días transcurridos, presentismo/puntualidad automáticos) usan
// esa fecha en vez de la fecha de ingreso real a la empresa — ver personaConFechaEfectiva().
export async function montarEvaluacionPrueba(formEl, persona, ctx) {
  const { manualSet, forzadosMap, hoy, onCambio } = ctx;
  formEl.innerHTML = '<div class="pres__loading">Cargando…</div>';
  // Para el cálculo (días/automáticos) se usa la fecha efectiva; para todo lo demás (badges de
  // "reingreso", esReingreso() de la lógica de guardado, etc.) se sigue usando `persona` tal cual,
  // sin tocar su fecha_ingreso real.
  const personaCalculo = personaConFechaEfectiva(persona, forzadosMap);
  let previa = null;
  let automaticos = { presentismoPct: null, puntualidadPct: null, diasAusentes: 0, diasConIncidente: 0 };
  try {
    const [r, auto] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/iso_evaluaciones_periodo_prueba?legajo=eq.${persona.legajo}&empresa=eq.${persona.empresa}&motivo=eq.ingreso&select=*`, { headers: HDR }),
      datosAutomaticos(personaCalculo, hoy),
    ]);
    const filas = r.ok ? await r.json() : [];
    previa = filas[0] || null;
    automaticos = auto;
  } catch {}
  renderForm(persona, previa, automaticos);

  function renderForm(persona, previa, automaticos) {
    const { presentismoPct, puntualidadPct, diasAusentes, diasConIncidente } = automaticos;
    const forzado = !!forzadosMap?.has(`${persona.legajo}|${persona.empresa}`);
    const fechaReferencia = forzadosMap?.get(`${persona.legajo}|${persona.empresa}`)?.fecha_referencia;
    const dias = diasDesdeIngreso(personaCalculo, hoy);
    const plazo = estadoPlazo(dias);
    formEl.innerHTML = `
      <div class="pind__sec">
        <div class="pind__grupo-header" style="border-left-color:var(--color-primario)">
          <div class="pind__grupo-header-izq">
            <h2 class="pind__grupo-titulo">${eP(persona.apellido_y_nombre)}</h2>
            <div class="pind__grupo-badges">
              <span class="pind__grupo-badge pind__grupo-badge--desvinc">Legajo #${persona.legajo}</span>
              <span class="pind__grupo-badge pind__grupo-badge--desvinc">${EMP_LABEL[persona.empresa] || persona.empresa}</span>
              <span class="pind__grupo-badge pind__grupo-badge--desvinc">${eP(persona.desc_puesto || '—')}</span>
              <span class="pind__grupo-badge pind__grupo-badge--desvinc">${fechaReferencia ? `En este puesto desde ${fmtFecha(fechaReferencia)}` : `Ingresó ${fmtFecha(persona.fecha_ingreso)}`}</span>
              ${previa
                ? '<span class="pind__grupo-badge pind__grupo-badge--activo">Ya evaluado — editando</span>'
                : forzado
                  ? '<span class="pind__grupo-badge pind__grupo-badge--desvinc" style="color:#2563eb;border-color:#2563eb">Excepción — cambio de función</span>'
                  : esReingreso(persona, manualSet)
                    ? '<span class="pind__grupo-badge pind__grupo-badge--desvinc" style="color:#d97706;border-color:#d97706">Reingreso — no debería necesitar período de prueba</span>'
                    : `<span class="pind__grupo-badge pind__grupo-badge--desvinc" style="color:${plazo.color};border-color:${plazo.color}">${plazo.texto}</span>`}
            </div>
          </div>
        </div>
        ${!previa && forzado ? `
        <p class="pres__vacio-small" style="margin-top:var(--espacio-s);color:#2563eb">
          Marcada a mano para período de prueba por cambio de función (PG-6.01) — aunque tenga antigüedad
          real desde ${fmtFecha(persona.fecha_ingreso)}, se evalúa como si fuera nueva en este puesto${fechaReferencia ? ` desde ${fmtFecha(fechaReferencia)}` : ''}.
          Para sacar esta marca o cargar/corregir la fecha, Desempeño → Parametrización → Excepciones manuales.
        </p>` : ''}
        ${!previa && !forzado && esReingreso(persona, manualSet) ? `
        <p class="pres__vacio-small" style="margin-top:var(--espacio-s);color:#d97706">
          ${manualSet.has(`${persona.legajo}|${persona.empresa}`) && !fueDetectadoAutomatico(persona)
            ? 'Marcada a mano como reingreso (renunció y fue recontratada, ej. cobro de FCL, antes de que este sistema empezara a registrar gente — no se pudo detectar sola).'
            : 'Esta fecha de ingreso es más nueva que el registro que tenemos de esta persona — probablemente renunció y fue recontratada (ej. cobro de FCL) sin dejar de trabajar en la práctica.'}
          Ya tiene antigüedad real, así que en principio no le corresponde período de prueba (le va a tocar la
          evaluación anual cuando corresponda). Completá este formulario solo si estás seguro de que sí es un ingreso nuevo.
        </p>` : ''}
        ${!previa && !forzado && !esReingreso(persona, manualSet) ? `
        <p class="pres__vacio-small" style="margin-top:var(--espacio-s)">
          ¿Esta persona en realidad renunció y fue recontratada (ej. cobro de FCL) y ya tenía antigüedad?
          El sistema no lo pudo detectar solo —
          <button type="button" class="pind__dep-toggle" id="prueba-marcar-reingreso" style="padding:2px 10px;font-size:0.78rem">Marcarla como reingreso</button>
        </p>` : ''}

        <div class="pind__kpis pind__kpis--sm" style="margin-top:var(--espacio-m)">
          <div class="pind__kpi">
            <span class="pind__kpi-num" style="color:${colorPct(presentismoPct)}">${presentismoPct != null ? presentismoPct + '%' : '—'}</span>
            <span class="pind__kpi-lbl">Presentismo</span>
            <span class="pind__kpi-sub">Automático · ${diasAusentes} día${diasAusentes !== 1 ? 's' : ''} ausente${diasAusentes !== 1 ? 's' : ''} desde el ingreso</span>
          </div>
          <div class="pind__kpi">
            <span class="pind__kpi-num" style="color:${colorPct(puntualidadPct)}">${puntualidadPct != null ? puntualidadPct + '%' : '—'}</span>
            <span class="pind__kpi-lbl">Puntualidad</span>
            <span class="pind__kpi-sub">Automático · ${diasConIncidente} día${diasConIncidente !== 1 ? 's' : ''} con tarde/salida ant.</span>
          </div>
        </div>

        <div class="desem__form-manual" style="margin-top:var(--espacio-m)">
          ${ASPECTOS.map(a => `
            <label class="desem__campo desem__campo--full">
              <span>${a.label}</span>
              <select data-aspecto="${a.campo}" class="escala-select">
                <option value="">Elegir…</option>
                ${NIVELES.map(n => `<option value="${n.valor}" ${previa && +previa[a.campo] === n.valor ? 'selected' : ''}>${n.label}</option>`).join('')}
              </select>
            </label>`).join('')}
          <label class="desem__campo desem__campo--full">
            <span>Aspecto destacable</span>
            <textarea id="prueba-destacable" rows="2" class="desem__textarea">${eP(previa?.aspecto_destacable)}</textarea>
          </label>
          <label class="desem__campo desem__campo--full">
            <span>Aspecto a mejorar</span>
            <textarea id="prueba-mejorar" rows="2" class="desem__textarea">${eP(previa?.aspecto_mejorar)}</textarea>
          </label>
        </div>

        <div id="prueba-resultado-preview"></div>

        <div class="pres__carga-acciones">
          <button type="button" class="pres__btn-confirmar" id="prueba-guardar">${previa ? 'Actualizar evaluación' : 'Guardar evaluación'}</button>
          <button type="button" class="pres__btn-ir-carga" id="prueba-informe" disabled>⬇ Informe individual (PDF)</button>
        </div>
        <div id="prueba-estado"></div>
      </div>
    `;
    mejorarSelectsEscala(formEl);

    formEl.querySelector('#prueba-marcar-reingreso')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true; btn.textContent = 'Marcando…';
      try {
        await marcarReingresoManual(persona.legajo, persona.empresa, 'Marcado a mano desde Desempeño → Evaluaciones');
        manualSet.add(`${persona.legajo}|${persona.empresa}`);
        renderForm(persona, previa, automaticos);
        onCambio?.();
      } catch (err) {
        btn.disabled = false; btn.textContent = 'Marcarla como reingreso';
        alert('No se pudo marcar: ' + err.message);
      }
    });

    const previewEl = formEl.querySelector('#prueba-resultado-preview');
    const estadoEl  = formEl.querySelector('#prueba-estado');
    const btnGuardar = formEl.querySelector('#prueba-guardar');
    const btnInforme = formEl.querySelector('#prueba-informe');

    function leerAspectos() {
      const vals = {};
      let completo = true;
      ASPECTOS.forEach(a => {
        const v = formEl.querySelector(`[data-aspecto="${a.campo}"]`).value;
        vals[a.campo] = v === '' ? null : +v;
        if (vals[a.campo] === null) completo = false;
      });
      return { vals, completo };
    }

    function actualizarPreview() {
      const { vals, completo } = leerAspectos();
      if (!completo) {
        previewEl.innerHTML = '<p class="pres__vacio-small">Completá los 4 aspectos para ver el resultado.</p>';
        btnInforme.disabled = true;
        return null;
      }
      // Promedia los 4 aspectos manuales con presentismo/puntualidad automáticos (cuando hay datos).
      const valores = Object.values(vals);
      if (presentismoPct != null) valores.push(presentismoPct);
      if (puntualidadPct != null) valores.push(puntualidadPct);
      const promedio = valores.reduce((s, v) => s + v, 0) / valores.length;
      const resultado = resultadoDe(promedio);
      previewEl.innerHTML = `
        <div class="desem__resultado" style="border-color:${RESULTADO_COLOR[resultado]}">
          <span class="desem__resultado-puntaje" style="color:${RESULTADO_COLOR[resultado]}">${promedio.toFixed(0)}%</span>
          <span class="desem__resultado-label" style="color:${RESULTADO_COLOR[resultado]}">${RESULTADO_LABEL[resultado]}</span>
        </div>
        <p class="pres__vacio-small" style="margin-top:4px">Incluye los 4 aspectos + presentismo (${presentismoPct != null ? presentismoPct + '%' : 'sin datos'}) + puntualidad (${puntualidadPct != null ? puntualidadPct + '%' : 'sin datos'}).</p>`;
      btnInforme.disabled = false;
      return { vals, promedio, resultado };
    }

    formEl.querySelectorAll('[data-aspecto]').forEach(sel => sel.addEventListener('change', actualizarPreview));
    actualizarPreview();

    btnInforme.addEventListener('click', () => {
      const calc = actualizarPreview();
      if (!calc) return;
      generarInformePruebaPDF({
        persona,
        datos: {
          ...calc.vals,
          presentismo_pct: presentismoPct, puntualidad_pct: puntualidadPct,
          resultado_pct: calc.promedio, resultado: calc.resultado,
          aspecto_destacable: formEl.querySelector('#prueba-destacable').value.trim(),
          aspecto_mejorar: formEl.querySelector('#prueba-mejorar').value.trim(),
          evaluado_por: previa?.evaluado_por || obtenerUsuario()?.nombre || null,
          fecha_evaluacion: previa?.fecha_evaluacion || new Date().toISOString().slice(0, 10),
        },
      });
    });

    btnGuardar.addEventListener('click', async () => {
      const calc = actualizarPreview();
      if (!calc) {
        estadoEl.innerHTML = '<p class="pres__msg-error">Completá los 4 aspectos antes de guardar.</p>';
        return;
      }
      btnGuardar.disabled = true;
      const textoOriginal = btnGuardar.textContent;
      btnGuardar.textContent = 'Guardando…';
      try {
        const body = {
          legajo: +persona.legajo, empresa: persona.empresa, motivo: 'ingreso',
          ...calc.vals,
          presentismo_pct: presentismoPct, puntualidad_pct: puntualidadPct,
          resultado_pct: +calc.promedio.toFixed(2), resultado: calc.resultado,
          aspecto_destacable: formEl.querySelector('#prueba-destacable').value.trim() || null,
          aspecto_mejorar: formEl.querySelector('#prueba-mejorar').value.trim() || null,
          evaluado_por: obtenerUsuario()?.nombre || null,
          fecha_evaluacion: new Date().toISOString().slice(0, 10),
        };
        const r = await fetch(`${SUPABASE_URL}/rest/v1/iso_evaluaciones_periodo_prueba?on_conflict=legajo,empresa,motivo`, {
          method: 'POST', headers: HDR_JSON, body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(`Supabase: error ${r.status}`);
        estadoEl.innerHTML = '<p class="pres__msg-exito">✓ Evaluación guardada.</p>';
        btnGuardar.disabled = false;
        btnGuardar.textContent = 'Actualizar evaluación';
        const badgesEl = formEl.querySelector('.pind__grupo-badges');
        if (badgesEl && !badgesEl.querySelector('.pind__grupo-badge--activo')) {
          badgesEl.insertAdjacentHTML('beforeend', '<span class="pind__grupo-badge pind__grupo-badge--activo">Ya evaluado — editando</span>');
        }
        onCambio?.();
      } catch (err) {
        estadoEl.innerHTML = `<p class="pres__msg-error">No se pudo guardar: ${eP(err.message)}</p>`;
        btnGuardar.disabled = false;
        btnGuardar.textContent = textoOriginal;
      }
    });
  }
}
