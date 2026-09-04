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
import { resultadoDe, RESULTADO_LABEL, RESULTADO_COLOR } from './desempeno-cargar.js';

const HDR = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
const HDR_JSON = { ...HDR, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' };

const EMP_LABEL = { CIMOMET: 'Cimomet', COMOING: 'Co.mo.ing' };
export const VENTANA_DIAS = 90;         // PG-6.01: "antes de cumplir los tres meses"
export const VENTANA_VISIBLE_DIAS = 180; // se sigue mostrando un tiempo después de vencida, para no perderla de vista

const ASPECTOS = [
  { campo: 'seguridad',      label: 'Cumplimiento de normas de seguridad' },
  { campo: 'dominio_tareas', label: 'Nivel de dominio de las tareas del puesto' },
  { campo: 'normas_iso',     label: 'Cumplimiento de las normas ISO y/o procedimiento del puesto' },
  { campo: 'proactividad',   label: 'Proactividad y cooperación' },
];
const NIVELES = [
  { valor: 0,   label: 'Escaso' },
  { valor: 25,  label: 'Regular' },
  { valor: 50,  label: 'Bueno' },
  { valor: 75,  label: 'Muy bueno' },
  { valor: 100, label: 'Excelente' },
];

function eP(s) { return (s || '').toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function normTxt(s) { return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
function fmtFecha(iso) { const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}`; }

export function diasDesdeIngreso(persona, hoy) {
  return Math.floor((hoy - new Date(`${persona.fecha_ingreso}T00:00:00`)) / 86400000);
}
function estadoPlazo(dias) {
  const restante = VENTANA_DIAS - dias;
  if (restante < 0) return { texto: `Vencida hace ${Math.abs(restante)} día${Math.abs(restante) !== 1 ? 's' : ''}`, color: '#dc2626' };
  if (restante <= 15) return { texto: `Vence en ${restante} día${restante !== 1 ? 's' : ''}`, color: '#d97706' };
  return { texto: `Vence en ${restante} días`, color: '#16a34a' };
}
function colorPct(pct) {
  return pct == null ? 'var(--color-texto-sec)' : pct >= 95 ? '#16a34a' : pct >= 90 ? '#d97706' : '#dc2626';
}
function fechaISO(d) { return d.toISOString().slice(0, 10); }

// Presentismo y puntualidad durante el período de prueba (desde fecha_ingreso hasta hoy),
// con las mismas fórmulas que usa Horas y Presentismo → Indicadores (presGlobal / indicePuntualidad).
async function datosAutomaticos(persona, hoy) {
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

export async function renderizarDesempenoPrueba(contenedor) {
  contenedor.innerHTML = '<p class="plantel__cargando">Cargando plantel…</p>';

  let empleados = [];
  try {
    const rE = await fetch(`${SUPABASE_URL}/rest/v1/empleados?select=legajo,apellido_y_nombre,empresa,desc_puesto,activo,fecha_ingreso&limit=2000`, { headers: HDR });
    empleados = rE.ok ? await rE.json() : [];
  } catch (e) {
    contenedor.innerHTML = `<div class="pres__vacio">Error al cargar el plantel: ${eP(e.message)}</div>`;
    return;
  }

  const activos = empleados.filter(p => p.activo && p.fecha_ingreso);
  const hoy = new Date();

  contenedor.innerHTML = `
    <div class="pres__personas-wrap">
      <p class="pres__subtitulo" style="margin-bottom:var(--espacio-m)">
        Evaluación de período de prueba (F-101) — a todo ingresante, antes de cumplir los 3 meses.
        Combina los 4 aspectos del cuestionario con presentismo y puntualidad calculados automáticamente
        desde los partes. Por ahora solo detecta ingresos nuevos; los cambios de función se agregan más adelante.
      </p>
      <div id="prueba-pendientes-wrap" style="margin-bottom:var(--espacio-l)"></div>
      <input type="search" class="plantel__busqueda" id="prueba-busqueda"
             placeholder="Buscar persona por legajo o nombre…" autocomplete="off">
      <div id="prueba-resultados" class="pres-ficha__resultados" hidden></div>
      <div id="prueba-form">
        <p class="pres__vacio">Buscá una persona arriba, o elegí a alguien de la lista de pendientes.</p>
      </div>
    </div>
  `;

  const input        = contenedor.querySelector('#prueba-busqueda');
  const resultadosEl = contenedor.querySelector('#prueba-resultados');
  const formEl       = contenedor.querySelector('#prueba-form');
  const pendientesWrap = contenedor.querySelector('#prueba-pendientes-wrap');
  let evaluadosSet = null;

  async function obtenerEvaluadosSet() {
    if (evaluadosSet) return evaluadosSet;
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/iso_evaluaciones_periodo_prueba?motivo=eq.ingreso&select=legajo,empresa`, { headers: HDR });
      const filas = r.ok ? await r.json() : [];
      evaluadosSet = new Set(filas.map(f => `${f.legajo}|${f.empresa}`));
    } catch { evaluadosSet = new Set(); }
    return evaluadosSet;
  }

  async function renderPendientes() {
    pendientesWrap.innerHTML = '<div class="pres__loading">Cargando pendientes…</div>';
    const evalSet = await obtenerEvaluadosSet();
    const pendientes = activos
      .filter(p => !evalSet.has(`${p.legajo}|${p.empresa}`))
      .map(p => ({ ...p, dias: diasDesdeIngreso(p, hoy) }))
      .filter(p => p.dias >= 0 && p.dias <= VENTANA_VISIBLE_DIAS)
      .sort((a, b) => (VENTANA_DIAS - a.dias) - (VENTANA_DIAS - b.dias)); // más urgente (vencida hace más / vence antes) primero

    if (!pendientes.length) {
      pendientesWrap.innerHTML = '<p class="pres__msg-exito">✓ No tenés evaluaciones de período de prueba pendientes.</p>';
      return;
    }
    pendientesWrap.innerHTML = `
      <div class="desem__pendientes">
        <div class="desem__pendientes-header">
          <span class="desem__pendientes-tit">Tenés ${pendientes.length} evaluaci${pendientes.length !== 1 ? 'ones' : 'ón'} de período de prueba pendiente${pendientes.length !== 1 ? 's' : ''}</span>
          <span class="desem__pendientes-sub">Se hacen antes de cumplir los 3 meses de ingreso.</span>
        </div>
        <div class="desem__pendientes-lista">
          ${pendientes.map(p => {
            const plazo = estadoPlazo(p.dias);
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
    pendientesWrap.querySelectorAll('[data-legajo]').forEach(btn => {
      btn.addEventListener('click', () => {
        const persona = activos.find(p => String(p.legajo) === btn.dataset.legajo && p.empresa === btn.dataset.empresa);
        if (persona) { cargarFormulario(persona); formEl.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
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

  async function cargarFormulario(persona) {
    formEl.innerHTML = '<div class="pres__loading">Cargando…</div>';
    let previa = null;
    let automaticos = { presentismoPct: null, puntualidadPct: null, diasAusentes: 0, diasConIncidente: 0 };
    try {
      const [r, auto] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/iso_evaluaciones_periodo_prueba?legajo=eq.${persona.legajo}&empresa=eq.${persona.empresa}&motivo=eq.ingreso&select=*`, { headers: HDR }),
        datosAutomaticos(persona, hoy),
      ]);
      const filas = r.ok ? await r.json() : [];
      previa = filas[0] || null;
      automaticos = auto;
    } catch {}
    renderForm(persona, previa, automaticos);
  }

  function renderForm(persona, previa, automaticos) {
    const { presentismoPct, puntualidadPct, diasAusentes, diasConIncidente } = automaticos;
    const dias = diasDesdeIngreso(persona, hoy);
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
              <span class="pind__grupo-badge pind__grupo-badge--desvinc">Ingresó ${fmtFecha(persona.fecha_ingreso)}</span>
              ${previa
                ? '<span class="pind__grupo-badge pind__grupo-badge--activo">Ya evaluado — editando</span>'
                : `<span class="pind__grupo-badge pind__grupo-badge--desvinc" style="color:${plazo.color};border-color:${plazo.color}">${plazo.texto}</span>`}
            </div>
          </div>
        </div>

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
              <select data-aspecto="${a.campo}">
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
        </div>
        <div id="prueba-estado"></div>
      </div>
    `;

    const previewEl = formEl.querySelector('#prueba-resultado-preview');
    const estadoEl  = formEl.querySelector('#prueba-estado');
    const btnGuardar = formEl.querySelector('#prueba-guardar');

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
      return { vals, promedio, resultado };
    }

    formEl.querySelectorAll('[data-aspecto]').forEach(sel => sel.addEventListener('change', actualizarPreview));
    actualizarPreview();

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
        (await obtenerEvaluadosSet()).add(`${persona.legajo}|${persona.empresa}`);
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
