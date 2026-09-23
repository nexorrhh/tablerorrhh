// Desempeño → Parametrización.
// Tres configuraciones para la evaluación de desempeño anual (F-84):
//   1. Puntaje: cuántos puntos vale cada aspecto (mensual/quincenal) y a partir de cuántos
//      días/eventos Ausentismo y Tardanzas llegan a 0 — ver data/desempeno-config.js.
//   2. Por puesto: el mismo puntaje de arriba, pero personalizado para un puesto puntual (ej.
//      "Soldador" con umbrales distintos a los de mensual/quincenal en general) — un puesto sin
//      personalización sigue usando el default de su tipo, ver resolverConfigPersona().
//   3. Evaluadores: RRHH da de alta evaluadores externos (ej. "Javier Hernández", "Responsable
//      de Ingeniería") y les asigna manualmente qué legajos le corresponde evaluar a cada uno —
//      el "diagrama" de quién evalúa a quién lo arma RRHH acá, no hay ningún cruce automático
//      por sector/puesto (empleados no tiene un campo de sector separado de desc_puesto). Los
//      evaluadores NUNCA entran a este Tablero: cargan sus evaluaciones desde el portal separado
//      en Evaluadores/index.html, que escribe en las mismas tablas que ya lee "Indicadores".

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';
import {
  obtenerEvaluadores, crearEvaluador, cambiarActivoEvaluador, borrarEvaluador,
  obtenerAsignaciones, agregarAsignacion, quitarAsignacion, dniDesdeCuil,
} from '../data/evaluadores.js';
import {
  obtenerConfigDesempeno, guardarConfigDesempeno, CONFIG_DEFAULT,
  obtenerConfigPorPuesto, guardarConfigPuesto, borrarConfigPuesto,
} from '../data/desempeno-config.js';
import { obtenerReingresosManuales, quitarReingresoManual } from '../data/reingresos-manuales.js';
import { obtenerClasificacionPuestos, tipoPuesto, normPuesto } from '../data/clasificacion-puestos.js';
import { EMP_LABEL, TIPO_LABEL } from './desempeno-cargar.js';

const HDR = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };

function eP(s) { return (s || '').toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function normTxt(s) { return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
function fmtN(v) { return (+v || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 }); }

export async function renderizarDesempenoParametrizacion(contenedor) {
  contenedor.innerHTML = '<p class="plantel__cargando">Cargando…</p>';

  let empleados = [], evaluadores = [], asignaciones = [], config = CONFIG_DEFAULT, reingresosManuales = [];
  let mapaClasif = new Map(), configPorPuesto = new Map();
  try {
    const [rE, ev, asig, cfg, rm, mc, cpp] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/empleados?select=legajo,apellido_y_nombre,empresa,desc_puesto,activo,cuil&limit=2000`, { headers: HDR }),
      obtenerEvaluadores(),
      obtenerAsignaciones(),
      obtenerConfigDesempeno(),
      obtenerReingresosManuales(),
      obtenerClasificacionPuestos(),
      obtenerConfigPorPuesto(),
    ]);
    empleados = rE.ok ? await rE.json() : [];
    evaluadores = ev;
    asignaciones = asig;
    config = cfg;
    reingresosManuales = rm;
    mapaClasif = mc;
    configPorPuesto = cpp;
  } catch (e) {
    contenedor.innerHTML = `<div class="pres__vacio">Error al cargar: ${eP(e.message)}</div>`;
    return;
  }

  const activos = empleados.filter(p => p.activo);

  contenedor.innerHTML = `
    <div id="dparam-puntaje" style="margin-bottom:var(--espacio-xl)"></div>
    <div id="dparam-puesto" style="margin-bottom:var(--espacio-xl)"></div>
    <div id="dparam-evaluadores" style="margin-bottom:var(--espacio-xl)"></div>
    <div id="dparam-reingresos"></div>
  `;

  renderPuntaje(contenedor.querySelector('#dparam-puntaje'));
  renderPorPuesto(contenedor.querySelector('#dparam-puesto'));
  renderEvaluadores(contenedor.querySelector('#dparam-evaluadores'));
  renderReingresos(contenedor.querySelector('#dparam-reingresos'));

  // ── Reingresos marcados a mano ──────────────────────────────────────────────
  // Complementa a la detección automática (esReingreso, en desempeno-cargar.js) para los casos
  // que pasaron ANTES de que este sistema empezara a registrar gente — esos no se pueden
  // detectar solos. Se marcan desde el formulario de Período de prueba; acá se ven y se pueden
  // sacar si alguno quedó mal marcado.
  function renderReingresos(el) {
    el.innerHTML = `
      <h2 class="pind__sec-tit" style="margin-bottom:4px">Reingresos marcados a mano</h2>
      <p class="pres__subtitulo" style="margin-bottom:var(--espacio-m)">
        Gente que renunció y fue recontratada (ej. cobro de FCL) antes de que este sistema empezara
        a registrarla — no se pudieron detectar solos, así que se marcaron desde "Período de prueba".
        No les corresponde período de prueba, y sí evaluación anual cuando corresponda.
      </p>
      <div id="dparam-reingresos-lista"></div>
    `;
    const listaEl = el.querySelector('#dparam-reingresos-lista');
    pintarLista();

    function pintarLista() {
      if (!reingresosManuales.length) {
        listaEl.innerHTML = '<p class="plantel__param-vacio">Todavía no se marcó a nadie a mano.</p>';
        return;
      }
      listaEl.innerHTML = reingresosManuales.map(r => {
        const p = activos.find(x => String(x.legajo) === String(r.legajo) && x.empresa === r.empresa);
        return `
          <div class="plantel__param-fila">
            <div class="plantel__param-info">
              <span class="plantel__param-puesto">${eP(p?.apellido_y_nombre) || `Legajo ${r.legajo}`}</span>
              <span class="plantel__param-count-chico">Legajo #${r.legajo} · ${EMP_LABEL[r.empresa] || r.empresa}${r.motivo ? ` · ${eP(r.motivo)}` : ''}</span>
            </div>
            <div class="plantel__param-acciones">
              <button type="button" class="plantel__param-btn" data-quitar-reingreso="${r.legajo}" data-empresa="${eP(r.empresa)}">Quitar</button>
            </div>
          </div>`;
      }).join('');

      listaEl.querySelectorAll('[data-quitar-reingreso]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const { quitarReingreso: legajo, empresa } = btn.dataset;
          try {
            await quitarReingresoManual(legajo, empresa);
            reingresosManuales = reingresosManuales.filter(r => !(String(r.legajo) === legajo && r.empresa === empresa));
            pintarLista();
          } catch (err) {
            alert('No se pudo quitar: ' + err.message);
          }
        });
      });
    }
  }

  // ── Puntaje de la evaluación anual ─────────────────────────────────────────
  function renderPuntaje(el) {
    el.innerHTML = `
      <h2 class="pind__sec-tit" style="margin-bottom:4px">Puntaje de la evaluación anual (F-84)</h2>
      <p class="pres__subtitulo" style="margin-bottom:var(--espacio-m)">
        Cuántos puntos vale cada aspecto (conviene que sumen 100) y a partir de cuántos días/eventos
        Ausentismo y Tardanzas llegan a 0. Cambiar esto NO recalcula evaluaciones ya guardadas —
        solo afecta a las que se carguen de acá en adelante.
      </p>
      <div class="pind__graf-grid">
        ${tarjetaPuntaje('mensual', 'Mensuales', config.mensual, false)}
        ${tarjetaPuntaje('quincenal', 'Quincenales', config.quincenal, true)}
      </div>
    `;
    wirePuntaje(el, 'mensual', false, async valores => { await guardarConfigDesempeno('mensual', valores); config.mensual = valores; });
    wirePuntaje(el, 'quincenal', true, async valores => { await guardarConfigDesempeno('quincenal', valores); config.quincenal = valores; });
  }

  // `idPrefix` solo se usa para namespacear los ids del DOM (puede ser "mensual"/"quincenal" o,
  // desde renderPorPuesto, "puesto-N") — quién decide qué hacer con los valores al guardar es
  // `onGuardar`, que pasa cada llamador (wirePuntaje).
  function tarjetaPuntaje(idPrefix, titulo, cfg, esQuincenal) {
    return `
      <div class="pind__sec pind__graf-card" style="background:var(--color-fondo)">
        ${titulo ? `<h3 class="pind__sec-tit" style="margin-bottom:8px">${titulo}</h3>` : ''}
        <div class="desem__form-manual" style="margin-top:0">
          <label class="desem__campo"><span>Ausentismo — puntos máx.</span>
            <input type="number" min="0" step="0.5" id="dp-${idPrefix}-aus-max" value="${cfg.ausentismo_max}"></label>
          <label class="desem__campo"><span>Ausentismo — días para llegar a 0</span>
            <input type="number" min="0.1" step="0.1" id="dp-${idPrefix}-aus-cero" value="${Number(cfg.ausentismo_dias_cero.toFixed(4))}"></label>
          <label class="desem__campo"><span>Tardanzas — puntos máx.</span>
            <input type="number" min="0" step="0.5" id="dp-${idPrefix}-tard-max" value="${cfg.tardanzas_max}"></label>
          <label class="desem__campo"><span>Tardanzas — cantidad para llegar a 0</span>
            <input type="number" min="0.1" step="0.1" id="dp-${idPrefix}-tard-cero" value="${Number(cfg.tardanzas_cant_cero.toFixed(4))}"></label>
          ${esQuincenal ? `
          <div class="desem__campo">
            <span>Cumplimiento EPP — puntos máx.</span>
            <input type="number" min="0" step="0.5" id="dp-${idPrefix}-epp-max" value="${cfg.epp_max ?? 15}" ${cfg.epp_max == null ? 'disabled' : ''}>
            <label style="display:flex;align-items:center;gap:6px;font-weight:400;font-size:0.76rem;margin-top:2px;color:var(--color-texto-sec)">
              <input type="checkbox" id="dp-${idPrefix}-epp-no" ${cfg.epp_max == null ? 'checked' : ''}> No evaluar este aspecto
            </label>
          </div>
          <div class="desem__campo">
            <span>Calidad/reprocesos — puntos máx.</span>
            <input type="number" min="0" step="0.5" id="dp-${idPrefix}-repro-max" value="${cfg.reprocesos_max ?? 10}" ${cfg.reprocesos_max == null ? 'disabled' : ''}>
            <label style="display:flex;align-items:center;gap:6px;font-weight:400;font-size:0.76rem;margin-top:2px;color:var(--color-texto-sec)">
              <input type="checkbox" id="dp-${idPrefix}-repro-no" ${cfg.reprocesos_max == null ? 'checked' : ''}> No evaluar este aspecto
            </label>
          </div>` : ''}
          <label class="desem__campo"><span>Evaluación aptitudinal+operativa — puntos máx.</span>
            <input type="number" min="0" step="0.5" id="dp-${idPrefix}-eval-max" value="${cfg.evaluacion_max}"></label>
        </div>
        <p class="pres__vacio-small" id="dp-${idPrefix}-total" style="margin-top:8px"></p>
        <div class="pres__carga-acciones" style="margin-top:8px">
          <button type="button" class="pres__btn-confirmar" id="dp-${idPrefix}-guardar">Guardar</button>
        </div>
        <div id="dp-${idPrefix}-estado"></div>
      </div>
    `;
  }

  // `onGuardar(valores)` hace el guardado real (a iso_desempeno_config o a
  // iso_desempeno_config_puesto, según quién llame) y actualiza el estado en memoria — acá solo
  // se arma el objeto `valores` a partir de los inputs y se maneja el feedback visual.
  function wirePuntaje(el, idPrefix, esQuincenal, onGuardar) {
    const campos = ['aus-max', 'aus-cero', 'tard-max', 'tard-cero', 'eval-max', ...(esQuincenal ? ['epp-max', 'repro-max'] : [])];
    const inputs = Object.fromEntries(campos.map(c => [c, el.querySelector(`#dp-${idPrefix}-${c}`)]));
    const totalEl = el.querySelector(`#dp-${idPrefix}-total`);
    const estadoEl = el.querySelector(`#dp-${idPrefix}-estado`);
    const btn = el.querySelector(`#dp-${idPrefix}-guardar`);
    const noEpp = el.querySelector(`#dp-${idPrefix}-epp-no`);
    const noRepro = el.querySelector(`#dp-${idPrefix}-repro-no`);

    function actualizarTotal() {
      const total = +inputs['aus-max'].value + +inputs['tard-max'].value + +inputs['eval-max'].value
        + (esQuincenal && !noEpp.checked ? +inputs['epp-max'].value : 0)
        + (esQuincenal && !noRepro.checked ? +inputs['repro-max'].value : 0);
      totalEl.textContent = `Total: ${fmtN(total)} pts${Math.abs(total - 100) > 0.01 ? ' (no suma 100 — igual se puede guardar)' : ''}`;
      totalEl.style.color = Math.abs(total - 100) > 0.01 ? '#d97706' : 'var(--color-texto-sec)';
    }
    campos.forEach(c => inputs[c].addEventListener('input', actualizarTotal));
    if (esQuincenal) {
      noEpp.addEventListener('change', () => { inputs['epp-max'].disabled = noEpp.checked; actualizarTotal(); });
      noRepro.addEventListener('change', () => { inputs['repro-max'].disabled = noRepro.checked; actualizarTotal(); });
    }
    actualizarTotal();

    btn.addEventListener('click', async () => {
      btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        const valores = {
          ausentismo_max: +inputs['aus-max'].value, ausentismo_dias_cero: +inputs['aus-cero'].value,
          tardanzas_max: +inputs['tard-max'].value, tardanzas_cant_cero: +inputs['tard-cero'].value,
          evaluacion_max: +inputs['eval-max'].value,
          epp_max: esQuincenal && !noEpp.checked ? +inputs['epp-max'].value : null,
          reprocesos_max: esQuincenal && !noRepro.checked ? +inputs['repro-max'].value : null,
        };
        await onGuardar(valores);
        estadoEl.innerHTML = '<p class="pres__msg-exito">✓ Guardado.</p>';
      } catch (err) {
        estadoEl.innerHTML = `<p class="pres__msg-error">No se pudo guardar: ${eP(err.message)}</p>`;
      } finally {
        btn.disabled = false; btn.textContent = 'Guardar';
      }
    });
  }

  // ── Personalizar el puntaje por puesto ─────────────────────────────────────
  // Mismos campos que "Puntaje" de arriba, pero para un desc_puesto puntual — si no se
  // personaliza, ese puesto sigue usando el default de su tipo (resolverConfigPersona()).
  // Solo se listan puestos clasificados mensual/quincenal (data/clasificacion-puestos.js): a un
  // puesto "sin asignar" no le corresponde evaluación de todas formas.
  function renderPorPuesto(el) {
    let expandido = null;
    const conteo = new Map();
    activos.forEach(p => {
      const puesto = (p.desc_puesto || '').trim();
      if (!puesto) return;
      const tipo = tipoPuesto(puesto, mapaClasif);
      if (tipo !== 'mensual' && tipo !== 'quincenal') return;
      // Se agrupa por versión normalizada (sin distinguir mayúsculas) porque el actualizador de
      // Tango a veces reescribe el mismo puesto con otra capitalización (ej. "RRHH" → "Rrhh") —
      // sin esto aparecía dos veces como si fueran puestos distintos.
      const key = normPuesto(puesto);
      if (!conteo.has(key)) conteo.set(key, { puesto, tipo, n: 0 });
      conteo.get(key).n++;
    });
    const puestos = [...conteo.values()].sort((a, b) => a.puesto.localeCompare(b.puesto));

    el.innerHTML = `
      <h2 class="pind__sec-tit" style="margin-bottom:4px">Personalizar por puesto</h2>
      <p class="pres__subtitulo" style="margin-bottom:var(--espacio-m)">
        Para un puesto puntual que necesite otro puntaje que el general de su tipo (ej. "Soldador"
        con umbrales distintos a los de mensual/quincenal en general). Un puesto sin personalizar
        sigue usando el default de arriba.
      </p>
      <div id="dpp-lista"></div>
    `;
    const listaEl = el.querySelector('#dpp-lista');
    pintar();

    function pintar() {
      if (!puestos.length) {
        listaEl.innerHTML = '<p class="pres__vacio">No hay puestos clasificados como mensual/quincenal todavía (se clasifican en Plantel → Parametrización).</p>';
        return;
      }
      listaEl.innerHTML = puestos.map((p, i) => tarjetaPuesto(p, i)).join('');
      puestos.forEach((p, i) => {
        listaEl.querySelector(`[data-toggle-puesto="${i}"]`)?.addEventListener('click', () => {
          expandido = expandido === i ? null : i;
          pintar();
        });
        if (expandido === i) wirePuesto(p, i);
      });
      listaEl.querySelectorAll('[data-quitar-puesto]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const puesto = btn.dataset.quitarPuesto;
          btn.disabled = true;
          try {
            await borrarConfigPuesto(puesto);
            configPorPuesto.delete(normPuesto(puesto));
            pintar();
          } catch (err) {
            alert('No se pudo quitar: ' + err.message);
          }
        });
      });
    }

    function tarjetaPuesto(p, i) {
      const override = configPorPuesto.get(normPuesto(p.puesto));
      return `
        <div class="pind__sec" style="margin-bottom:var(--espacio-m)">
          <div class="pind__grupo-header" data-toggle-puesto="${i}" style="cursor:pointer;border-left-color:var(--color-primario)">
            <div class="pind__grupo-header-izq">
              <h2 class="pind__grupo-titulo">${eP(p.puesto)}</h2>
              <div class="pind__grupo-badges">
                <span class="pind__grupo-badge pind__grupo-badge--desvinc">${TIPO_LABEL[p.tipo]}</span>
                <span class="pind__grupo-badge pind__grupo-badge--desvinc">${p.n} persona${p.n !== 1 ? 's' : ''}</span>
                ${override
                  ? '<span class="pind__grupo-badge pind__grupo-badge--activo">Personalizado</span>'
                  : '<span class="pind__grupo-badge pind__grupo-badge--desvinc">Usa el default de ' + TIPO_LABEL[p.tipo].toLowerCase() + '</span>'}
              </div>
            </div>
            <button type="button" class="pind__dep-toggle" data-toggle-puesto="${i}">${expandido === i ? '▾ Ocultar' : override ? '▸ Editar' : '▸ Personalizar'}</button>
          </div>
          ${expandido === i ? `
          <div style="padding:var(--espacio-m)">
            ${tarjetaPuntaje(`puesto-${i}`, '', override || config[p.tipo], p.tipo === 'quincenal')}
            ${override ? `<div class="pres__carga-acciones" style="margin-top:8px"><button type="button" class="plantel__param-btn" data-quitar-puesto="${eP(p.puesto)}">Quitar personalización (volver al default)</button></div>` : ''}
          </div>` : ''}
        </div>
      `;
    }

    function wirePuesto(p, i) {
      wirePuntaje(listaEl, `puesto-${i}`, p.tipo === 'quincenal', async (valores) => {
        await guardarConfigPuesto(p.puesto, valores);
        configPorPuesto.set(normPuesto(p.puesto), { desc_puesto: p.puesto, ...valores });
      });
    }
  }

  // ── Evaluadores ──────────────────────────────────────────────────────────
  function renderEvaluadores(el) {
    const linkPortal = `${location.origin}${location.pathname.replace(/\/[^/]*$/, '')}/Evaluadores/`;
    let expandidoId = null;

    el.innerHTML = `
      <h2 class="pind__sec-tit" style="margin-bottom:4px">Evaluadores</h2>
      <p class="pres__subtitulo" style="margin-bottom:var(--espacio-s)">
        Acá se da de alta a cada evaluador y se le asigna manualmente qué personas le toca evaluar.
        Los evaluadores no entran a este Tablero — cargan sus evaluaciones (anual y período de
        prueba) desde un portal aparte, con su nombre y DNI. Lo que carguen aparece automáticamente
        en "Indicadores", igual que si lo hubiera cargado RRHH.
      </p>
      <div class="pres__personas-wrap" style="background:var(--color-fondo);border:1px solid var(--color-borde);border-radius:var(--radio-s);padding:var(--espacio-m);margin-bottom:var(--espacio-l)">
        <span class="desem__campo" style="font-weight:600;color:var(--color-texto-sec);font-size:0.8rem">Link del portal para los evaluadores</span>
        <div style="display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap">
          <code id="evd-link" style="font-size:0.85rem;background:var(--color-fondo-tarjeta);border:1px solid var(--color-borde);border-radius:6px;padding:6px 10px">${eP(linkPortal)}</code>
          <button type="button" class="pind__dep-toggle" id="evd-copiar">Copiar link</button>
        </div>
      </div>

      <div id="evd-sin-asignar" style="margin-bottom:var(--espacio-l)"></div>

      <div class="fichexc__agregar" style="margin-bottom:var(--espacio-l)">
        <h3 class="pind__sec-tit" style="margin-bottom:8px">Nuevo evaluador</h3>
        <p class="pres__subtitulo" style="margin-bottom:8px">Se elige de la lista de personal — el DNI se detecta solo desde su CUIL, no hace falta tipearlo.</p>
        <input type="search" id="evd-nuevo-busq" class="plantel__busqueda" autocomplete="off"
               placeholder="Buscar persona por legajo o nombre…">
        <div id="evd-nuevo-resultados" class="pres-ficha__resultados" hidden></div>
        <div id="evd-nuevo-confirmar"></div>
      </div>

      <div id="evd-lista"></div>
    `;

    const linkCode = el.querySelector('#evd-link');
    el.querySelector('#evd-copiar').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(linkCode.textContent);
        const btn = el.querySelector('#evd-copiar');
        const original = btn.textContent;
        btn.textContent = '✓ Copiado';
        setTimeout(() => { btn.textContent = original; }, 1500);
      } catch { /* portapapeles no disponible — el link ya está visible para copiar a mano */ }
    });

    const busqNuevo = el.querySelector('#evd-nuevo-busq');
    const resultadosNuevo = el.querySelector('#evd-nuevo-resultados');
    const confirmarNuevo = el.querySelector('#evd-nuevo-confirmar');

    busqNuevo.addEventListener('input', () => {
      const texto = normTxt(busqNuevo.value.trim());
      confirmarNuevo.innerHTML = '';
      if (!texto) { resultadosNuevo.hidden = true; resultadosNuevo.innerHTML = ''; return; }
      const yaEvaluadores = new Set(evaluadores.filter(e => e.legajo != null).map(e => `${e.legajo}|${e.empresa}`));
      const coincidencias = activos
        .filter(p => !yaEvaluadores.has(`${p.legajo}|${p.empresa}`))
        .filter(p => normTxt(p.apellido_y_nombre).includes(texto) || String(p.legajo).includes(texto))
        .slice(0, 12);
      resultadosNuevo.hidden = false;
      resultadosNuevo.innerHTML = coincidencias.length
        ? coincidencias.map(p => `
            <button type="button" class="pres-ficha__resultado" data-legajo="${p.legajo}" data-empresa="${eP(p.empresa)}">
              <span class="pres-ficha__resultado-nombre">${eP(p.apellido_y_nombre)}</span>
              <span class="pres-ficha__resultado-meta">Legajo #${p.legajo} · ${EMP_LABEL[p.empresa] || p.empresa}</span>
            </button>`).join('')
        : `<p class="pres-ficha__sin-resultados">Sin resultados.</p>`;

      resultadosNuevo.querySelectorAll('[data-legajo]').forEach(btn => {
        btn.addEventListener('click', () => {
          const persona = activos.find(p => String(p.legajo) === btn.dataset.legajo && p.empresa === btn.dataset.empresa);
          resultadosNuevo.hidden = true; resultadosNuevo.innerHTML = '';
          renderConfirmar(persona);
        });
      });
    });

    function renderConfirmar(persona) {
      const dni = dniDesdeCuil(persona.cuil);
      confirmarNuevo.innerHTML = `
        <div class="plantel__param-fila" style="margin-top:8px">
          <div class="plantel__param-info">
            <span class="plantel__param-puesto">${eP(persona.apellido_y_nombre)}</span>
            <span class="plantel__param-count-chico">
              Legajo #${persona.legajo} · ${EMP_LABEL[persona.empresa] || persona.empresa}
              ${dni ? ` · DNI detectado: ${eP(dni)}` : ' · No se pudo detectar el DNI desde el CUIL cargado'}
            </span>
          </div>
          <div class="plantel__param-acciones">
            <button type="button" class="plantel__param-btn" id="evd-nuevo-cancelar">Cancelar</button>
            <button type="button" class="pres__btn-confirmar" id="evd-nuevo-confirmar-btn" ${dni ? '' : 'disabled'}>+ Agregar como evaluador</button>
          </div>
        </div>
        <p id="evd-crear-estado"></p>
      `;
      busqNuevo.value = '';
      const crearEstado = confirmarNuevo.querySelector('#evd-crear-estado');

      confirmarNuevo.querySelector('#evd-nuevo-cancelar').addEventListener('click', () => { confirmarNuevo.innerHTML = ''; });
      confirmarNuevo.querySelector('#evd-nuevo-confirmar-btn').addEventListener('click', async () => {
        const btn = confirmarNuevo.querySelector('#evd-nuevo-confirmar-btn');
        btn.disabled = true; btn.textContent = 'Guardando…';
        try {
          const nuevo = await crearEvaluador({ nombre: persona.apellido_y_nombre, legajo: persona.legajo, empresa: persona.empresa, documento: dni });
          evaluadores.push(nuevo);
          evaluadores.sort((a, b) => a.nombre.localeCompare(b.nombre));
          confirmarNuevo.innerHTML = '';
          renderLista();
        } catch (err) {
          crearEstado.innerHTML = `<p class="pres__msg-error">No se pudo crear: ${eP(err.message)}</p>`;
          btn.disabled = false; btn.textContent = '+ Agregar como evaluador';
        }
      });
    }

    const listaEl = el.querySelector('#evd-lista');
    const sinAsignarEl = el.querySelector('#evd-sin-asignar');
    renderLista();

    // Personas activas que no le tocan a ningún evaluador todavía — el "hueco" en el diagrama de
    // quién evalúa a quién. Se recalcula cada vez que cambia algo (alta/baja de evaluador,
    // asignar/quitar), porque renderLista() ya es el punto central por el que pasa todo eso.
    function renderSinAsignar() {
      const asignadosGlobal = new Set(asignaciones.map(a => `${a.legajo}|${a.empresa}`));
      const sinAsignar = activos
        .filter(p => !asignadosGlobal.has(`${p.legajo}|${p.empresa}`))
        .sort((a, b) => a.apellido_y_nombre.localeCompare(b.apellido_y_nombre));

      if (!sinAsignar.length) {
        sinAsignarEl.innerHTML = '<p class="pres__msg-exito">✓ Todas las personas activas tienen un evaluador asignado.</p>';
        return;
      }
      sinAsignarEl.innerHTML = `
        <div class="desem__pendientes">
          <div class="desem__pendientes-header">
            <span class="desem__pendientes-tit">${sinAsignar.length} persona${sinAsignar.length !== 1 ? 's' : ''} sin evaluador asignado</span>
            <span class="desem__pendientes-sub">No le corresponden a ningún evaluador todavía — nadie les va a cargar la evaluación.</span>
          </div>
          <div class="desem__pendientes-lista">
            ${sinAsignar.map(p => `
              <div class="desem__pendiente-fila">
                <span class="desem__pendiente-nombre">${eP(p.apellido_y_nombre)}</span>
                <span class="desem__pendiente-meta">#${p.legajo} · ${EMP_LABEL[p.empresa] || p.empresa} · ${eP(p.desc_puesto || '—')}</span>
              </div>`).join('')}
          </div>
        </div>
      `;
    }

    function renderLista() {
      renderSinAsignar();
      if (!evaluadores.length) {
        listaEl.innerHTML = '<p class="pres__vacio">Todavía no hay evaluadores cargados.</p>';
        return;
      }
      listaEl.innerHTML = evaluadores.map(ev => tarjetaEvaluador(ev)).join('');

      evaluadores.forEach(ev => {
        const header = listaEl.querySelector(`[data-toggle="${ev.id}"]`);
        header?.addEventListener('click', () => {
          expandidoId = expandidoId === ev.id ? null : ev.id;
          renderLista();
        });

        const btnActivo = listaEl.querySelector(`[data-activo-toggle="${ev.id}"]`);
        btnActivo?.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            await cambiarActivoEvaluador(ev.id, !ev.activo);
            ev.activo = !ev.activo;
            renderLista();
          } catch (err) {
            alert('No se pudo actualizar: ' + err.message);
          }
        });

        const btnBorrar = listaEl.querySelector(`[data-borrar="${ev.id}"]`);
        btnBorrar?.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm(`¿Eliminar a "${ev.nombre}" como evaluador? También se borran sus asignaciones.`)) return;
          try {
            await borrarEvaluador(ev.id);
            evaluadores = evaluadores.filter(x => x.id !== ev.id);
            asignaciones = asignaciones.filter(a => a.evaluador_id !== ev.id);
            if (expandidoId === ev.id) expandidoId = null;
            renderLista();
          } catch (err) {
            alert('No se pudo eliminar: ' + err.message);
          }
        });

        if (expandidoId === ev.id) wireAsignaciones(ev);
      });
    }

    function tarjetaEvaluador(ev) {
      const asignados = asignaciones
        .filter(a => a.evaluador_id === ev.id)
        .map(a => activos.find(p => String(p.legajo) === String(a.legajo) && p.empresa === a.empresa))
        .filter(Boolean)
        .sort((a, b) => a.apellido_y_nombre.localeCompare(b.apellido_y_nombre));

      return `
        <div class="pind__sec" style="margin-bottom:var(--espacio-m)">
          <div class="pind__grupo-header" data-toggle="${ev.id}" style="cursor:pointer;border-left-color:var(--color-primario)">
            <div class="pind__grupo-header-izq">
              <h2 class="pind__grupo-titulo">${eP(ev.nombre)}</h2>
              <div class="pind__grupo-badges">
                <span class="pind__grupo-badge ${ev.activo ? 'pind__grupo-badge--activo' : 'pind__grupo-badge--desvinc'}">${ev.activo ? 'Activo' : 'Desactivado'}</span>
                ${ev.legajo != null ? `<span class="pind__grupo-badge pind__grupo-badge--desvinc">Legajo #${ev.legajo} · ${EMP_LABEL[ev.empresa] || ev.empresa}</span>` : ''}
                <span class="pind__grupo-badge pind__grupo-badge--desvinc">${asignados.length} persona${asignados.length !== 1 ? 's' : ''} asignada${asignados.length !== 1 ? 's' : ''}</span>
              </div>
            </div>
            <div style="display:flex;gap:8px">
              <button type="button" class="pind__dep-toggle" data-activo-toggle="${ev.id}">${ev.activo ? 'Desactivar' : 'Reactivar'}</button>
              <button type="button" class="pind__dep-toggle" data-borrar="${ev.id}">Eliminar</button>
              <button type="button" class="pind__dep-toggle" data-toggle="${ev.id}">${expandidoId === ev.id ? '▾ Ocultar' : '▸ Ver / asignar'}</button>
            </div>
          </div>
          ${expandidoId === ev.id ? `
          <div style="padding:var(--espacio-m)">
            <input type="search" id="evd-busq-${ev.id}" class="plantel__busqueda" autocomplete="off"
                   placeholder="Buscar persona por legajo o nombre para asignarle…">
            <div id="evd-resultados-${ev.id}" class="pres-ficha__resultados" hidden></div>
            <div style="margin-top:var(--espacio-m)">
              ${asignados.length
                ? asignados.map(p => filaAsignado(ev.id, p)).join('')
                : '<p class="plantel__param-vacio">Todavía no tiene a nadie asignado.</p>'}
            </div>
          </div>` : ''}
        </div>
      `;
    }

    function filaAsignado(evaluadorId, p) {
      return `
        <div class="plantel__param-fila">
          <div class="plantel__param-info">
            <span class="plantel__param-puesto">${eP(p.apellido_y_nombre)}</span>
            <span class="plantel__param-count-chico">Legajo #${p.legajo} · ${EMP_LABEL[p.empresa] || p.empresa} · ${eP(p.desc_puesto || '—')}</span>
          </div>
          <div class="plantel__param-acciones">
            <button type="button" class="plantel__param-btn" data-quitar-asig="${evaluadorId}" data-legajo="${p.legajo}" data-empresa="${eP(p.empresa)}">Quitar</button>
          </div>
        </div>`;
    }

    function wireAsignaciones(ev) {
      const busq = listaEl.querySelector(`#evd-busq-${ev.id}`);
      const resultadosEl = listaEl.querySelector(`#evd-resultados-${ev.id}`);
      if (!busq) return;

      busq.addEventListener('input', () => {
        const texto = normTxt(busq.value.trim());
        if (!texto) { resultadosEl.hidden = true; resultadosEl.innerHTML = ''; return; }
        const yaAsignados = new Set(asignaciones.filter(a => a.evaluador_id === ev.id).map(a => `${a.legajo}|${a.empresa}`));
        const coincidencias = activos
          .filter(p => !yaAsignados.has(`${p.legajo}|${p.empresa}`))
          .filter(p => normTxt(p.apellido_y_nombre).includes(texto) || String(p.legajo).includes(texto))
          .slice(0, 12);
        resultadosEl.hidden = false;
        resultadosEl.innerHTML = coincidencias.length
          ? coincidencias.map(p => `
              <button type="button" class="pres-ficha__resultado" data-legajo="${p.legajo}" data-empresa="${eP(p.empresa)}">
                <span class="pres-ficha__resultado-nombre">${eP(p.apellido_y_nombre)}</span>
                <span class="pres-ficha__resultado-meta">Legajo #${p.legajo} · ${EMP_LABEL[p.empresa] || p.empresa} · ${eP(p.desc_puesto || '—')}</span>
              </button>`).join('')
          : `<p class="pres-ficha__sin-resultados">Sin resultados.</p>`;

        resultadosEl.querySelectorAll('[data-legajo]').forEach(btn => {
          btn.addEventListener('click', async () => {
            const { legajo, empresa } = btn.dataset;
            busq.value = ''; resultadosEl.hidden = true;
            try {
              await agregarAsignacion(ev.id, legajo, empresa);
              asignaciones.push({ evaluador_id: ev.id, legajo: +legajo, empresa });
              renderLista();
            } catch (err) {
              alert('No se pudo asignar: ' + err.message);
            }
          });
        });
      });

      listaEl.querySelectorAll(`[data-quitar-asig="${ev.id}"]`).forEach(btn => {
        btn.addEventListener('click', async () => {
          const { legajo, empresa } = btn.dataset;
          try {
            await quitarAsignacion(ev.id, legajo, empresa);
            asignaciones = asignaciones.filter(a => !(a.evaluador_id === ev.id && String(a.legajo) === legajo && a.empresa === empresa));
            renderLista();
          } catch (err) {
            alert('No se pudo quitar: ' + err.message);
          }
        });
      });
    }
  }
}
