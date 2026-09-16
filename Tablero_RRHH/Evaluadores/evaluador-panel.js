// Panel del evaluador — muestra SOLO a las personas que RRHH le asignó (data/evaluadores.js →
// iso_evaluadores_asignados) y deja cargar su evaluación anual (F-84) y/o de período de prueba
// (F-101), escribiendo en las mismas tablas que ya lee "Desempeño → Indicadores" del Tablero de
// RRHH. Reutiliza el cálculo puro de components/desempeno-cargar.js y desempeno-prueba.js para
// que la fórmula de puntaje nunca quede duplicada/desincronizada de la que usa RRHH.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';
import { obtenerClasificacionPuestos, tipoPuesto } from '../data/clasificacion-puestos.js';
import { obtenerAsignacionesDe } from '../data/evaluadores.js';
import { cerrarSesionEvaluador } from './evaluador-sesion.js';
import {
  calcularMensual, calcularQuincenal, resultadoDe, corresponde, esReingreso,
  aniosDisponiblesDesempeno, NIVELES_F84, RESULTADO_LABEL, RESULTADO_COLOR,
  EMP_LABEL, TIPO_LABEL,
} from '../components/desempeno-cargar.js';
import {
  ASPECTOS, NIVELES, diasDesdeIngreso, VENTANA_DIAS, VENTANA_VISIBLE_DIAS, datosAutomaticos,
} from '../components/desempeno-prueba.js';
import { mejorarSelectsEscala } from '../components/selector-escala.js';
import { obtenerConfigDesempeno, obtenerConfigPorPuesto, resolverConfigPersona } from '../data/desempeno-config.js';
import { obtenerReingresosManualesSet } from '../data/reingresos-manuales.js';

const HDR = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
const HDR_JSON = { ...HDR, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' };

function eP(s) { return (s ?? '').toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function fmtFecha(iso) { if (!iso) return '—'; const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}`; }
function opciones(niveles, seleccionado) {
  return niveles.map(n => `<option value="${n.valor}" ${+seleccionado === n.valor ? 'selected' : ''}>${n.label}</option>`).join('');
}
function estadoPlazoPrueba(dias) {
  const restante = VENTANA_DIAS - dias;
  if (restante < 0) return { texto: `Vencida hace ${Math.abs(restante)} día${Math.abs(restante) !== 1 ? 's' : ''}`, color: '#dc2626' };
  if (restante <= 15) return { texto: `Vence en ${restante} día${restante !== 1 ? 's' : ''}`, color: '#d97706' };
  return { texto: `Vence en ${restante} días`, color: '#16a34a' };
}

export async function renderizarPanelEvaluador(contenedor, evaluador) {
  contenedor.innerHTML = '<p class="ev-cargando">Cargando…</p>';

  let empleados = [], mapaClasif = new Map(), asignaciones = [], config = null, manualSet = new Set(), configPorPuesto = new Map();
  try {
    const [rE, mc, asig, cfg, ms, cpp] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/empleados?select=legajo,apellido_y_nombre,empresa,desc_puesto,activo,fecha_ingreso,creado_en&limit=2000`, { headers: HDR }),
      obtenerClasificacionPuestos(),
      obtenerAsignacionesDe(evaluador.id),
      obtenerConfigDesempeno(),
      obtenerReingresosManualesSet(),
      obtenerConfigPorPuesto(),
    ]);
    empleados = rE.ok ? await rE.json() : [];
    mapaClasif = mc;
    asignaciones = asig;
    config = cfg;
    manualSet = ms;
    configPorPuesto = cpp;
  } catch (e) {
    contenedor.innerHTML = `<p class="ev-vacio">Error al cargar: ${eP(e.message)}</p>`;
    return;
  }

  const asignadosSet = new Set(asignaciones.map(a => `${a.legajo}|${a.empresa}`));
  const misPersonas = empleados.filter(p => p.activo && asignadosSet.has(`${p.legajo}|${p.empresa}`));
  const hoy = new Date();
  const anio = aniosDisponiblesDesempeno()[0];

  let evaluadosAnualSet = new Set(), evaluadosPruebaSet = new Set();
  try {
    const [rAnual, rPrueba] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/iso_evaluaciones_desempeno?anio=eq.${anio}&select=legajo,empresa`, { headers: HDR }),
      fetch(`${SUPABASE_URL}/rest/v1/iso_evaluaciones_periodo_prueba?motivo=eq.ingreso&select=legajo,empresa`, { headers: HDR }),
    ]);
    evaluadosAnualSet = new Set((rAnual.ok ? await rAnual.json() : []).map(f => `${f.legajo}|${f.empresa}`));
    evaluadosPruebaSet = new Set((rPrueba.ok ? await rPrueba.json() : []).map(f => `${f.legajo}|${f.empresa}`));
  } catch { /* si falla, se muestran todos como pendientes — no bloquea la carga */ }

  contenedor.innerHTML = `
    <div class="ev-shell">
      <div class="ev-topbar">
        <div>
          <p class="ev-topbar-marca">Evaluaciones de desempeño</p>
          <p class="ev-topbar-sub">Hola, ${eP(evaluador.nombre)}</p>
        </div>
        <button type="button" class="ev-btn-sec" id="ev-salir">Cerrar sesión</button>
      </div>
      <div id="ev-contenido"></div>
    </div>
  `;
  contenedor.querySelector('#ev-salir').addEventListener('click', () => {
    cerrarSesionEvaluador();
    location.reload();
  });

  const contenido = contenedor.querySelector('#ev-contenido');

  function persona(clave) {
    const [legajo, empresa] = clave.split('|');
    return misPersonas.find(p => String(p.legajo) === legajo && p.empresa === empresa);
  }

  function estadoDe(p) {
    const clave = `${p.legajo}|${p.empresa}`;
    const tipo = tipoPuesto(p.desc_puesto, mapaClasif);
    const corrAnual = (tipo === 'mensual' || tipo === 'quincenal') && corresponde(p, anio, mapaClasif, manualSet);
    const yaAnual = evaluadosAnualSet.has(clave);
    const dias = diasDesdeIngreso(p, hoy);
    const corrPrueba = !esReingreso(p, manualSet) && dias >= 0 && dias <= VENTANA_VISIBLE_DIAS;
    const yaPrueba = evaluadosPruebaSet.has(clave);
    return { clave, tipo, corrAnual, yaAnual, corrPrueba, yaPrueba, dias };
  }

  function renderLista() {
    contenido.innerHTML = `
      <p class="ev-lede">Estas son las personas que tenés asignadas para evaluar. Elegí una para cargar
      su evaluación anual y/o de período de prueba, según corresponda.</p>
      <div class="ev-lista">
        ${misPersonas.map(p => {
          const est = estadoDe(p);
          if (!est.corrAnual && !est.corrPrueba) return filaPersona(p, est, '<span class="ev-chip ev-chip--ok">Sin evaluación pendiente</span>');
          const chips = [];
          if (est.corrAnual) chips.push(`<button type="button" class="ev-chip ${est.yaAnual ? 'ev-chip--ok' : 'ev-chip--pend'}" data-anual="${est.clave}">${est.yaAnual ? '✓ Anual cargada' : 'Anual pendiente'}</button>`);
          if (est.corrPrueba) chips.push(`<button type="button" class="ev-chip ${est.yaPrueba ? 'ev-chip--ok' : 'ev-chip--pend'}" data-prueba="${est.clave}">${est.yaPrueba ? '✓ Período de prueba cargado' : 'Período de prueba pendiente'}</button>`);
          return filaPersona(p, est, chips.join(''));
        }).join('')}
      </div>
    `;
    contenido.querySelectorAll('[data-anual]').forEach(btn => btn.addEventListener('click', () => renderFormAnual(persona(btn.dataset.anual))));
    contenido.querySelectorAll('[data-prueba]').forEach(btn => btn.addEventListener('click', () => renderFormPrueba(persona(btn.dataset.prueba))));
  }

  function filaPersona(p, est, chipsHtml) {
    return `
      <div class="ev-fila">
        <div class="ev-fila-info">
          <span class="ev-fila-nombre">${eP(p.apellido_y_nombre)}</span>
          <span class="ev-fila-meta">Legajo #${p.legajo} · ${EMP_LABEL[p.empresa] || p.empresa} · ${eP(p.desc_puesto || '—')}</span>
        </div>
        <div class="ev-fila-chips">${chipsHtml}</div>
      </div>`;
  }

  // ── Evaluación anual (F-84) ────────────────────────────────────────────────
  async function renderFormAnual(p) {
    contenido.innerHTML = '<p class="ev-cargando">Cargando…</p>';
    const tipo = tipoPuesto(p.desc_puesto, mapaClasif);
    const cfg = resolverConfigPersona(p, tipo, config, configPorPuesto);
    const desde = `${anio}-01-01`, hasta = `${anio}-12-01`;
    let ausentismo_dias = 0, tardanzas_cant = 0, previa = null;
    try {
      const [rMen, rTard, rEval] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/rrhh_horas_mensual?legajo=eq.${p.legajo}&empresa=eq.${p.empresa}&periodo=gte.${desde}&periodo=lte.${hasta}&select=dias_ausentes_nojust`, { headers: HDR }),
        fetch(`${SUPABASE_URL}/rest/v1/rrhh_tardanzas_salidas?legajo=eq.${p.legajo}&empresa=eq.${p.empresa}&periodo=gte.${desde}&periodo=lte.${hasta}&tipo=in.(tarde,temprano)&select=id`, { headers: HDR }),
        fetch(`${SUPABASE_URL}/rest/v1/iso_evaluaciones_desempeno?legajo=eq.${p.legajo}&empresa=eq.${p.empresa}&anio=eq.${anio}&select=*`, { headers: HDR }),
      ]);
      const filasMen = rMen.ok ? await rMen.json() : [];
      ausentismo_dias = filasMen.reduce((s, f) => s + (+f.dias_ausentes_nojust || 0), 0);
      tardanzas_cant = rTard.ok ? (await rTard.json()).length : 0;
      const existentes = rEval.ok ? await rEval.json() : [];
      previa = existentes[0] || null;
    } catch (e) {
      contenido.innerHTML = `<p class="ev-vacio">Error al cargar los datos: ${eP(e.message)}</p>`;
      return;
    }

    contenido.innerHTML = `
      <button type="button" class="ev-btn-sec" id="ev-volver">← Volver a mi lista</button>
      <div class="ev-form-card">
        <h2 class="ev-form-tit">${eP(p.apellido_y_nombre)}</h2>
        <p class="ev-form-sub">Evaluación anual ${anio} · ${TIPO_LABEL[tipo] || tipo} · Legajo #${p.legajo}</p>

        <div class="ev-kpis">
          <div class="ev-kpi"><span class="ev-kpi-num">${ausentismo_dias}</span><span class="ev-kpi-lbl">Días de ausentismo</span></div>
          <div class="ev-kpi"><span class="ev-kpi-num">${tardanzas_cant}</span><span class="ev-kpi-lbl">Llegadas tarde / salidas ant.</span></div>
        </div>

        <div class="ev-campos">
          <label class="ev-campo"><span>Evaluación aptitudinal</span>
            <select id="ev-apt" class="escala-select"><option value="">Elegir…</option>${opciones(NIVELES_F84, previa?.evaluacion_aptitudinal)}</select>
          </label>
          <label class="ev-campo"><span>Evaluación operativa</span>
            <select id="ev-op" class="escala-select"><option value="">Elegir…</option>${opciones(NIVELES_F84, previa?.evaluacion_operativa)}</select>
          </label>
          ${tipo === 'quincenal' && cfg.epp_max ? `
          <label class="ev-campo"><span>Cumplimiento de uso de EPP</span>
            <select id="ev-epp" class="escala-select"><option value="">Elegir…</option>${opciones(NIVELES_F84, previa?.epp_nivel)}</select>
          </label>` : ''}
          ${tipo === 'quincenal' && cfg.reprocesos_max ? `
          <label class="ev-campo"><span>Calidad de trabajo (reprocesos)</span>
            <select id="ev-repro" class="escala-select"><option value="">Elegir…</option>${opciones(NIVELES_F84, previa?.reprocesos_nivel)}</select>
          </label>` : ''}
          <label class="ev-campo ev-campo--full"><span>Aspecto destacable</span>
            <textarea id="ev-destacable" rows="2" class="ev-textarea">${eP(previa?.aspecto_destacable)}</textarea>
          </label>
          <label class="ev-campo ev-campo--full"><span>Aspecto a mejorar</span>
            <textarea id="ev-mejorar" rows="2" class="ev-textarea">${eP(previa?.aspecto_mejorar)}</textarea>
          </label>
        </div>

        <div id="ev-preview"></div>
        <div class="ev-acciones">
          <button type="button" class="ev-btn-pri" id="ev-guardar">${previa ? 'Actualizar evaluación' : 'Guardar evaluación'}</button>
        </div>
        <div id="ev-estado"></div>
      </div>
    `;
    mejorarSelectsEscala(contenido);
    contenido.querySelector('#ev-volver').addEventListener('click', renderLista);

    const selApt = contenido.querySelector('#ev-apt');
    const selOp = contenido.querySelector('#ev-op');
    const selEpp = contenido.querySelector('#ev-epp');
    const selRepro = contenido.querySelector('#ev-repro');
    const previewEl = contenido.querySelector('#ev-preview');
    const estadoEl = contenido.querySelector('#ev-estado');
    const btnGuardar = contenido.querySelector('#ev-guardar');

    function leer() {
      return {
        evaluacion_aptitudinal: selApt.value === '' ? null : +selApt.value,
        evaluacion_operativa: selOp.value === '' ? null : +selOp.value,
        epp_nivel: selEpp ? (selEpp.value === '' ? null : +selEpp.value) : null,
        reprocesos_nivel: selRepro ? (selRepro.value === '' ? null : +selRepro.value) : null,
      };
    }
    function actualizarPreview() {
      const v = leer();
      const completo = v.evaluacion_aptitudinal !== null && v.evaluacion_operativa !== null
        && (!selEpp || v.epp_nivel !== null) && (!selRepro || v.reprocesos_nivel !== null);
      if (!completo) { previewEl.innerHTML = '<p class="ev-vacio-small">Completá los campos de arriba para ver el puntaje.</p>'; return null; }
      const calc = tipo === 'mensual'
        ? calcularMensual({ ausentismo_dias, tardanzas_cant, evaluacion_aptitudinal: v.evaluacion_aptitudinal, evaluacion_operativa: v.evaluacion_operativa }, cfg)
        : calcularQuincenal({ ausentismo_dias, tardanzas_cant, epp_nivel: v.epp_nivel, reprocesos_nivel: v.reprocesos_nivel, evaluacion_aptitudinal: v.evaluacion_aptitudinal, evaluacion_operativa: v.evaluacion_operativa }, cfg);
      previewEl.innerHTML = `<div class="ev-resultado" style="border-color:${RESULTADO_COLOR[calc.resultado]}">
        <span class="ev-resultado-num" style="color:${RESULTADO_COLOR[calc.resultado]}">${calc.puntaje.toFixed(1)}</span>
        <span class="ev-resultado-lbl" style="color:${RESULTADO_COLOR[calc.resultado]}">${RESULTADO_LABEL[calc.resultado]}</span></div>`;
      return { ...v, ...calc };
    }
    [selApt, selOp, selEpp, selRepro].forEach(s => s?.addEventListener('change', actualizarPreview));
    actualizarPreview();

    btnGuardar.addEventListener('click', async () => {
      const calc = actualizarPreview();
      if (!calc) { estadoEl.innerHTML = '<p class="ev-msg-error">Completá todos los campos antes de guardar.</p>'; return; }
      btnGuardar.disabled = true; btnGuardar.textContent = 'Guardando…';
      try {
        const body = {
          legajo: +p.legajo, empresa: p.empresa, anio, tipo,
          ausentismo_dias, tardanzas_cant,
          epp_nivel: calc.epp_nivel ?? null, reprocesos_nivel: calc.reprocesos_nivel ?? null,
          evaluacion_aptitudinal: calc.evaluacion_aptitudinal, evaluacion_operativa: calc.evaluacion_operativa,
          evaluacion_superior: (calc.evaluacion_aptitudinal + calc.evaluacion_operativa) / 2,
          puntaje: +calc.puntaje.toFixed(2), resultado: calc.resultado,
          aspecto_destacable: contenido.querySelector('#ev-destacable').value.trim() || null,
          aspecto_mejorar: contenido.querySelector('#ev-mejorar').value.trim() || null,
          evaluado_por: evaluador.nombre,
          fecha_evaluacion: new Date().toISOString().slice(0, 10),
          actualizado_en: new Date().toISOString(),
        };
        const r = await fetch(`${SUPABASE_URL}/rest/v1/iso_evaluaciones_desempeno?on_conflict=legajo,empresa,anio`, { method: 'POST', headers: HDR_JSON, body: JSON.stringify(body) });
        if (!r.ok) throw new Error(`Supabase: error ${r.status}`);
        evaluadosAnualSet.add(`${p.legajo}|${p.empresa}`);
        estadoEl.innerHTML = '<p class="ev-msg-exito">✓ Evaluación guardada.</p>';
        btnGuardar.disabled = false; btnGuardar.textContent = 'Actualizar evaluación';
      } catch (err) {
        estadoEl.innerHTML = `<p class="ev-msg-error">No se pudo guardar: ${eP(err.message)}</p>`;
        btnGuardar.disabled = false; btnGuardar.textContent = previa ? 'Actualizar evaluación' : 'Guardar evaluación';
      }
    });
  }

  // ── Período de prueba (F-101) ──────────────────────────────────────────────
  async function renderFormPrueba(p) {
    contenido.innerHTML = '<p class="ev-cargando">Cargando…</p>';
    let previa = null, auto = { presentismoPct: null, puntualidadPct: null };
    try {
      const [r, a] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/iso_evaluaciones_periodo_prueba?legajo=eq.${p.legajo}&empresa=eq.${p.empresa}&motivo=eq.ingreso&select=*`, { headers: HDR }),
        datosAutomaticos(p, hoy),
      ]);
      const filas = r.ok ? await r.json() : [];
      previa = filas[0] || null;
      auto = a;
    } catch (e) {
      contenido.innerHTML = `<p class="ev-vacio">Error al cargar los datos: ${eP(e.message)}</p>`;
      return;
    }
    const { presentismoPct, puntualidadPct } = auto;
    const dias = diasDesdeIngreso(p, hoy);
    const plazo = estadoPlazoPrueba(dias);

    contenido.innerHTML = `
      <button type="button" class="ev-btn-sec" id="ev-volver">← Volver a mi lista</button>
      <div class="ev-form-card">
        <h2 class="ev-form-tit">${eP(p.apellido_y_nombre)}</h2>
        <p class="ev-form-sub">Período de prueba · Ingresó ${fmtFecha(p.fecha_ingreso)} · ${previa ? 'Ya evaluado — editando' : plazo.texto}</p>

        <div class="ev-kpis">
          <div class="ev-kpi"><span class="ev-kpi-num">${presentismoPct != null ? presentismoPct + '%' : '—'}</span><span class="ev-kpi-lbl">Presentismo</span></div>
          <div class="ev-kpi"><span class="ev-kpi-num">${puntualidadPct != null ? puntualidadPct + '%' : '—'}</span><span class="ev-kpi-lbl">Puntualidad</span></div>
        </div>

        <div class="ev-campos">
          ${ASPECTOS.map(a => `
            <label class="ev-campo ev-campo--full"><span>${a.label}</span>
              <select data-aspecto="${a.campo}" class="escala-select"><option value="">Elegir…</option>${opciones(NIVELES, previa?.[a.campo])}</select>
            </label>`).join('')}
          <label class="ev-campo ev-campo--full"><span>Aspecto destacable</span>
            <textarea id="ev-destacable" rows="2" class="ev-textarea">${eP(previa?.aspecto_destacable)}</textarea>
          </label>
          <label class="ev-campo ev-campo--full"><span>Aspecto a mejorar</span>
            <textarea id="ev-mejorar" rows="2" class="ev-textarea">${eP(previa?.aspecto_mejorar)}</textarea>
          </label>
        </div>

        <div id="ev-preview"></div>
        <div class="ev-acciones">
          <button type="button" class="ev-btn-pri" id="ev-guardar">${previa ? 'Actualizar evaluación' : 'Guardar evaluación'}</button>
        </div>
        <div id="ev-estado"></div>
      </div>
    `;
    mejorarSelectsEscala(contenido);
    contenido.querySelector('#ev-volver').addEventListener('click', renderLista);

    const previewEl = contenido.querySelector('#ev-preview');
    const estadoEl = contenido.querySelector('#ev-estado');
    const btnGuardar = contenido.querySelector('#ev-guardar');

    function leerAspectos() {
      const vals = {}; let completo = true;
      ASPECTOS.forEach(a => {
        const v = contenido.querySelector(`[data-aspecto="${a.campo}"]`).value;
        vals[a.campo] = v === '' ? null : +v;
        if (vals[a.campo] === null) completo = false;
      });
      return { vals, completo };
    }
    function actualizarPreview() {
      const { vals, completo } = leerAspectos();
      if (!completo) { previewEl.innerHTML = '<p class="ev-vacio-small">Completá los 4 aspectos para ver el resultado.</p>'; return null; }
      const valores = Object.values(vals);
      if (presentismoPct != null) valores.push(presentismoPct);
      if (puntualidadPct != null) valores.push(puntualidadPct);
      const promedio = valores.reduce((s, v) => s + v, 0) / valores.length;
      return { vals, promedio };
    }
    function actualizarPreviewFinal() {
      const base = actualizarPreview();
      if (!base) return null;
      const resultado = resultadoDe(base.promedio);
      previewEl.innerHTML = `<div class="ev-resultado" style="border-color:${RESULTADO_COLOR[resultado]}">
        <span class="ev-resultado-num" style="color:${RESULTADO_COLOR[resultado]}">${base.promedio.toFixed(0)}%</span>
        <span class="ev-resultado-lbl" style="color:${RESULTADO_COLOR[resultado]}">${RESULTADO_LABEL[resultado]}</span></div>
        <p class="ev-vacio-small" style="margin-top:4px">Incluye los 4 aspectos + presentismo (${presentismoPct != null ? presentismoPct + '%' : 'sin datos'}) + puntualidad (${puntualidadPct != null ? puntualidadPct + '%' : 'sin datos'}).</p>`;
      return { ...base, resultado };
    }
    contenido.querySelectorAll('[data-aspecto]').forEach(sel => sel.addEventListener('change', actualizarPreviewFinal));
    actualizarPreviewFinal();

    btnGuardar.addEventListener('click', async () => {
      const calc = actualizarPreviewFinal();
      if (!calc) { estadoEl.innerHTML = '<p class="ev-msg-error">Completá los 4 aspectos antes de guardar.</p>'; return; }
      btnGuardar.disabled = true; btnGuardar.textContent = 'Guardando…';
      try {
        const body = {
          legajo: +p.legajo, empresa: p.empresa, motivo: 'ingreso',
          ...calc.vals,
          presentismo_pct: presentismoPct, puntualidad_pct: puntualidadPct,
          resultado_pct: +calc.promedio.toFixed(2), resultado: calc.resultado,
          aspecto_destacable: contenido.querySelector('#ev-destacable').value.trim() || null,
          aspecto_mejorar: contenido.querySelector('#ev-mejorar').value.trim() || null,
          evaluado_por: evaluador.nombre,
          fecha_evaluacion: new Date().toISOString().slice(0, 10),
        };
        const r = await fetch(`${SUPABASE_URL}/rest/v1/iso_evaluaciones_periodo_prueba?on_conflict=legajo,empresa,motivo`, { method: 'POST', headers: HDR_JSON, body: JSON.stringify(body) });
        if (!r.ok) throw new Error(`Supabase: error ${r.status}`);
        evaluadosPruebaSet.add(`${p.legajo}|${p.empresa}`);
        estadoEl.innerHTML = '<p class="ev-msg-exito">✓ Evaluación guardada.</p>';
        btnGuardar.disabled = false; btnGuardar.textContent = 'Actualizar evaluación';
      } catch (err) {
        estadoEl.innerHTML = `<p class="ev-msg-error">No se pudo guardar: ${eP(err.message)}</p>`;
        btnGuardar.disabled = false; btnGuardar.textContent = previa ? 'Actualizar evaluación' : 'Guardar evaluación';
      }
    });
  }

  renderLista();
}
