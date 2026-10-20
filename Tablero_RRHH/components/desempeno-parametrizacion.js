// Desempeño → Parametrización.
// Cuatro configuraciones para la evaluación de desempeño anual (F-84), cada una en su propia
// pestaña interna (ver el switch al principio de renderizarDesempenoParametrizacion) para que
// siempre quede claro qué se está configurando:
//   1. Puntaje: cuántos puntos vale cada aspecto (mensual/quincenal) y a partir de cuántos
//      días/eventos Ausentismo y Tardanzas llegan a 0 — ver data/desempeno-config.js.
//   2. Por puesto: el mismo puntaje de arriba, pero personalizado para un puesto puntual (ej.
//      "Soldador" con umbrales distintos a los de mensual/quincenal en general) — un puesto sin
//      personalización sigue usando el default de su tipo, ver resolverConfigPersona(). También
//      es donde se excluye un puesto entero de la evaluación (ej. Gerencia).
//   3. Evaluadores: RRHH da de alta evaluadores externos (ej. "Javier Hernández", "Responsable
//      de Ingeniería") y les asigna manualmente qué PUESTOS le corresponde evaluar a cada uno
//      (no personas puntuales — así alguien que entra o sale de un puesto ya asignado no
//      necesita re-tocar nada acá). El "diagrama" de quién evalúa qué puesto lo arma RRHH acá; no
//      hay ningún cruce automático por sector (empleados no tiene un campo de sector separado de
//      desc_puesto). Los evaluadores NUNCA entran a este Tablero: cargan sus evaluaciones desde
//      el portal separado en Evaluadores/index.html, que escribe en las mismas tablas que ya lee
//      "Indicadores".
//   4. Excepciones manuales: dos marcas manuales opuestas entre sí, para los casos que el sistema
//      no puede detectar solo — ver data/reingresos-manuales.js (reingreso: alguien con antigüedad
//      real pasa a anual aunque su fecha_ingreso sea reciente) y data/prueba-forzada-manual.js
//      (cambio de función: alguien con antigüedad real pasa a período de prueba igual, porque
//      PG-6.01 lo exige y el sistema no guarda historial de puesto para detectarlo solo).

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';
import {
  obtenerEvaluadores, crearEvaluador, cambiarActivoEvaluador, borrarEvaluador,
  obtenerAsignacionesPuestos, agregarPuestoAsignado, quitarPuestoAsignado, dniDesdeCuil,
} from '../data/evaluadores.js';
import {
  obtenerConfigDesempeno, guardarConfigDesempeno, CONFIG_DEFAULT, REPROCESOS_LABEL_DEFAULT,
  obtenerConfigPorPuesto, guardarConfigPuesto, borrarConfigPuesto,
} from '../data/desempeno-config.js';
import { obtenerReingresosManuales, quitarReingresoManual } from '../data/reingresos-manuales.js';
import { obtenerPuestosExcluidosDesempeno, excluirPuestoDesempeno, incluirPuestoDesempeno } from '../data/desempeno-exclusiones.js';
import { obtenerPruebaForzadaManual, marcarPruebaForzada, quitarPruebaForzada } from '../data/prueba-forzada-manual.js';
import { obtenerClasificacionPuestos, tipoPuesto, normPuesto } from '../data/clasificacion-puestos.js';
import { EMP_LABEL, TIPO_LABEL } from './desempeno-cargar.js';

const HDR = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };

function eP(s) { return (s || '').toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function normTxt(s) { return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
function fmtN(v) { return (+v || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 }); }

export async function renderizarDesempenoParametrizacion(contenedor) {
  contenedor.innerHTML = '<p class="plantel__cargando">Cargando…</p>';

  let empleados = [], evaluadores = [], asignaciones = [], config = CONFIG_DEFAULT, reingresosManuales = [], pruebaForzada = [];
  let mapaClasif = new Map(), configPorPuesto = new Map(), puestosExcluidos = new Set();
  try {
    const [rE, ev, asig, cfg, rm, mc, cpp, pe, pf] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/empleados?select=legajo,apellido_y_nombre,empresa,desc_puesto,activo,cuil&limit=2000`, { headers: HDR }),
      obtenerEvaluadores(),
      obtenerAsignacionesPuestos(),
      obtenerConfigDesempeno(),
      obtenerReingresosManuales(),
      obtenerClasificacionPuestos(),
      obtenerConfigPorPuesto(),
      obtenerPuestosExcluidosDesempeno(),
      obtenerPruebaForzadaManual(),
    ]);
    empleados = rE.ok ? await rE.json() : [];
    evaluadores = ev;
    asignaciones = asig;
    config = cfg;
    reingresosManuales = rm;
    mapaClasif = mc;
    configPorPuesto = cpp;
    puestosExcluidos = pe;
    pruebaForzada = pf;
  } catch (e) {
    contenedor.innerHTML = `<div class="pres__vacio">Error al cargar: ${eP(e.message)}</div>`;
    return;
  }

  const activos = empleados.filter(p => p.activo);

  // Lista única de puestos clasificados mensual/quincenal (los únicos a los que les corresponde
  // desempeño) — la usan tanto "Por puesto" (personalizar puntaje) como "Evaluadores" (asignar
  // qué evaluador le toca a cada puesto). Agrupado por versión normalizada por el mismo motivo de
  // siempre: Tango puede reescribir la capitalización del puesto entre sincronizaciones.
  function puestosDesempeno() {
    const conteo = new Map();
    activos.forEach(p => {
      const puesto = (p.desc_puesto || '').trim();
      if (!puesto) return;
      const tipo = tipoPuesto(puesto, mapaClasif);
      if (tipo !== 'mensual' && tipo !== 'quincenal') return;
      const key = normPuesto(puesto);
      if (!conteo.has(key)) conteo.set(key, { puesto, tipo, n: 0 });
      conteo.get(key).n++;
    });
    return [...conteo.values()].sort((a, b) => a.puesto.localeCompare(b.puesto));
  }

  contenedor.innerHTML = `
    <div class="pres-ficha__modo-switch" role="tablist" aria-label="Elegir qué configurar">
      <button class="pres-ficha__modo-btn pres-ficha__modo-btn--activo" data-subtab="puntaje" type="button" role="tab" aria-selected="true">Puntaje</button>
      <button class="pres-ficha__modo-btn" data-subtab="puesto" type="button" role="tab" aria-selected="false">Por puesto</button>
      <button class="pres-ficha__modo-btn" data-subtab="evaluadores" type="button" role="tab" aria-selected="false">Evaluadores</button>
      <button class="pres-ficha__modo-btn" data-subtab="reingresos" type="button" role="tab" aria-selected="false">Excepciones manuales</button>
    </div>
    <div id="dparam-puntaje"></div>
    <div id="dparam-puesto" hidden></div>
    <div id="dparam-evaluadores" hidden></div>
    <div id="dparam-reingresos" hidden></div>
  `;

  contenedor.querySelectorAll('.pres-ficha__modo-btn[data-subtab]').forEach(btn => {
    btn.addEventListener('click', () => {
      contenedor.querySelectorAll('.pres-ficha__modo-btn[data-subtab]').forEach(b => {
        const activo = b === btn;
        b.classList.toggle('pres-ficha__modo-btn--activo', activo);
        b.setAttribute('aria-selected', String(activo));
      });
      ['puntaje', 'puesto', 'evaluadores', 'reingresos'].forEach(id => {
        contenedor.querySelector(`#dparam-${id}`).hidden = id !== btn.dataset.subtab;
      });
    });
  });

  renderPuntaje(contenedor.querySelector('#dparam-puntaje'));
  renderPorPuesto(contenedor.querySelector('#dparam-puesto'));
  renderEvaluadores(contenedor.querySelector('#dparam-evaluadores'));
  renderReingresos(contenedor.querySelector('#dparam-reingresos'));

  // ── Reingresos marcados a mano ──────────────────────────────────────────────
  // Complementa a la detección automática (esReingreso, en desempeno-cargar.js) para los casos
  // que pasaron ANTES de que este sistema empezara a registrar gente — esos no se pueden
  // detectar solos. Se marcan desde el formulario de período de prueba en Desempeño →
  // Evaluaciones; acá se ven y se pueden sacar si alguno quedó mal marcado.
  function renderReingresos(el) {
    el.innerHTML = `
      <h2 class="pind__sec-tit" style="margin-bottom:4px">Reingresos marcados a mano</h2>
      <p class="pres__subtitulo" style="margin-bottom:var(--espacio-m)">
        Gente que renunció y fue recontratada (ej. cobro de FCL) antes de que este sistema empezara
        a registrarla — no se pudieron detectar solos, así que se marcaron a mano desde Desempeño → Evaluaciones.
        No les corresponde período de prueba, y sí evaluación anual cuando corresponda.
      </p>
      <div id="dparam-reingresos-lista"></div>

      <h2 class="pind__sec-tit" style="margin:var(--espacio-xl) 0 4px">Forzados a período de prueba (cambio de función)</h2>
      <p class="pres__subtitulo" style="margin-bottom:var(--espacio-m)">
        Gente que ya tiene antigüedad pero tuvo un cambio de función (PG-6.01) — el sistema no guarda
        historial de puesto, así que no se puede detectar solo. Mientras esté acá, a esta persona le
        corresponde período de prueba en vez de la anual, de forma excepcional. Si cargás la fecha
        desde la que está en el puesto nuevo, los días transcurridos y el presentismo/puntualidad
        automáticos del formulario se calculan desde esa fecha en vez de la fecha de ingreso real.
      </p>
      <input type="search" class="plantel__busqueda" id="dparam-forzada-busq" autocomplete="off"
             placeholder="Buscar persona por legajo o nombre para marcarla…">
      <div id="dparam-forzada-resultados" class="pres-ficha__resultados" hidden></div>
      <div id="dparam-forzada-lista" style="margin-top:var(--espacio-m)"></div>
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

    // ── Forzados a período de prueba ──────────────────────────────────────────
    const forzadaListaEl = el.querySelector('#dparam-forzada-lista');
    const forzadaBusq = el.querySelector('#dparam-forzada-busq');
    const forzadaResultadosEl = el.querySelector('#dparam-forzada-resultados');
    pintarForzados();

    // Pide la fecha desde la que está en el puesto nuevo (para que los cálculos del formulario de
    // período de prueba usen esa fecha en vez de la fecha de ingreso real a la empresa — ver
    // personaConFechaEfectiva() en desempeno-cargar.js). Valida el formato a mano porque es un
    // prompt() de texto libre, no un <input type="date">.
    function pedirFechaReferencia(valorActual) {
      const texto = prompt('¿Desde qué fecha está en el puesto nuevo? (AAAA-MM-DD, dejalo vacío si no corresponde)', valorActual || '');
      if (texto === null) return undefined; // canceló el prompt — no tocar lo que ya había
      const limpio = texto.trim();
      if (!limpio) return null;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(limpio)) {
        alert('Fecha con formato inválido (usá AAAA-MM-DD) — se guarda sin fecha de referencia.');
        return null;
      }
      return limpio;
    }

    function pintarForzados() {
      if (!pruebaForzada.length) {
        forzadaListaEl.innerHTML = '<p class="plantel__param-vacio">Todavía no se marcó a nadie a mano.</p>';
        return;
      }
      forzadaListaEl.innerHTML = pruebaForzada.map(f => {
        const p = activos.find(x => String(x.legajo) === String(f.legajo) && x.empresa === f.empresa);
        return `
          <div class="plantel__param-fila">
            <div class="plantel__param-info">
              <span class="plantel__param-puesto">${eP(p?.apellido_y_nombre) || `Legajo ${f.legajo}`}</span>
              <span class="plantel__param-count-chico">Legajo #${f.legajo} · ${EMP_LABEL[f.empresa] || f.empresa}${f.motivo ? ` · ${eP(f.motivo)}` : ''}${f.fecha_referencia ? ` · En el puesto nuevo desde ${f.fecha_referencia.split('-').reverse().join('/')}` : ''}</span>
            </div>
            <div class="plantel__param-acciones">
              <button type="button" class="plantel__param-btn" data-editar-forzada="${f.legajo}" data-empresa="${eP(f.empresa)}">Editar fecha</button>
              <button type="button" class="plantel__param-btn" data-quitar-forzada="${f.legajo}" data-empresa="${eP(f.empresa)}">Quitar</button>
            </div>
          </div>`;
      }).join('');

      forzadaListaEl.querySelectorAll('[data-quitar-forzada]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const { quitarForzada: legajo, empresa } = btn.dataset;
          try {
            await quitarPruebaForzada(legajo, empresa);
            pruebaForzada = pruebaForzada.filter(f => !(String(f.legajo) === legajo && f.empresa === empresa));
            pintarForzados();
          } catch (err) {
            alert('No se pudo quitar: ' + err.message);
          }
        });
      });

      forzadaListaEl.querySelectorAll('[data-editar-forzada]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const { editarForzada: legajo, empresa } = btn.dataset;
          const fila = pruebaForzada.find(f => String(f.legajo) === legajo && f.empresa === empresa);
          const fechaReferencia = pedirFechaReferencia(fila?.fecha_referencia);
          if (fechaReferencia === undefined) return; // canceló
          try {
            await marcarPruebaForzada(legajo, empresa, fila?.motivo, fechaReferencia);
            fila.fecha_referencia = fechaReferencia;
            pintarForzados();
          } catch (err) {
            alert('No se pudo guardar la fecha: ' + err.message);
          }
        });
      });
    }

    forzadaBusq.addEventListener('input', () => {
      const texto = normTxt(forzadaBusq.value.trim());
      if (!texto) { forzadaResultadosEl.hidden = true; forzadaResultadosEl.innerHTML = ''; return; }
      const yaMarcados = new Set(pruebaForzada.map(f => `${f.legajo}|${f.empresa}`));
      const coincidencias = activos
        .filter(p => !yaMarcados.has(`${p.legajo}|${p.empresa}`))
        .filter(p => normTxt(p.apellido_y_nombre).includes(texto) || String(p.legajo).includes(texto))
        .slice(0, 12);
      forzadaResultadosEl.hidden = false;
      forzadaResultadosEl.innerHTML = coincidencias.length
        ? coincidencias.map(p => `
            <button type="button" class="pres-ficha__resultado" data-legajo="${p.legajo}" data-empresa="${eP(p.empresa)}">
              <span class="pres-ficha__resultado-nombre">${eP(p.apellido_y_nombre)}</span>
              <span class="pres-ficha__resultado-meta">Legajo #${p.legajo} · ${EMP_LABEL[p.empresa] || p.empresa} · ${eP(p.desc_puesto || '—')}</span>
            </button>`).join('')
        : `<p class="pres-ficha__sin-resultados">Sin resultados.</p>`;

      forzadaResultadosEl.querySelectorAll('[data-legajo]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const { legajo, empresa } = btn.dataset;
          const motivo = prompt('Motivo (opcional, ej. "Cambio de función: pasó a Soldador"):', 'Cambio de función') || null;
          const fechaReferencia = pedirFechaReferencia(null);
          try {
            await marcarPruebaForzada(legajo, empresa, motivo, fechaReferencia === undefined ? null : fechaReferencia);
            pruebaForzada.push({ legajo: +legajo, empresa, motivo, fecha_referencia: fechaReferencia === undefined ? null : fechaReferencia, creado_en: new Date().toISOString() });
            forzadaBusq.value = ''; forzadaResultadosEl.hidden = true;
            pintarForzados();
          } catch (err) {
            alert('No se pudo marcar: ' + err.message);
          }
        });
      });
    });
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
        ${tarjetaPuntaje('mensual', 'Mensuales', config.mensual)}
        ${tarjetaPuntaje('quincenal', 'Quincenales', config.quincenal)}
      </div>
    `;
    wirePuntaje(el, 'mensual', async valores => { await guardarConfigDesempeno('mensual', valores); config.mensual = valores; });
    wirePuntaje(el, 'quincenal', async valores => { await guardarConfigDesempeno('quincenal', valores); config.quincenal = valores; });
  }

  // `idPrefix` solo se usa para namespacear los ids del DOM (puede ser "mensual"/"quincenal" o,
  // desde renderPorPuesto, "puesto-N") — quién decide qué hacer con los valores al guardar es
  // `onGuardar`, que pasa cada llamador (wirePuntaje).
  // Mensuales y quincenales evalúan los mismos aspectos — EPP y Reprocesos siempre están acá; si
  // no aplican a un puesto puntual (ej. Administración), se desactivan desde Personalizar por
  // puesto con "No evaluar este aspecto", no ocultando el campo según el tipo de personal.
  // `conNombrePersonalizado`: el campo de texto para renombrar "Calidad/reprocesos" solo tiene
  // sentido puesto por puesto (ej. "Calidad de registración contable" en Administración) — en las
  // tarjetas generales de Mensuales/Quincenales no se muestra.
  function tarjetaPuntaje(idPrefix, titulo, cfg, conNombrePersonalizado = false) {
    const filaAspecto = (nombre, controlesHtml) => `
      <div class="desem__aspecto-fila">
        <div class="desem__aspecto-nombre">${nombre}</div>
        <div class="desem__aspecto-controles">${controlesHtml}</div>
      </div>`;
    const subcampoNum = (id, label, value, opts = '') => `
      <label class="desem__subcampo"><span>${label}</span>
        <input type="number" min="0" step="0.5" id="${id}" value="${value}" ${opts}></label>`;
    const checkNoEvaluar = (id, checked) => `
      <label class="desem__subcampo desem__subcampo--check">
        <input type="checkbox" id="${id}" ${checked ? 'checked' : ''}> No evaluar este aspecto</label>`;

    return `
      <div class="pind__sec pind__graf-card" style="background:var(--color-fondo)">
        ${titulo ? `<h3 class="pind__sec-tit" style="margin-bottom:8px">${titulo}</h3>` : ''}
        <div class="desem__aspectos">
          ${filaAspecto('Ausentismo', `
            ${subcampoNum(`dp-${idPrefix}-aus-max`, 'Puntos máx.', cfg.ausentismo_max)}
            ${subcampoNum(`dp-${idPrefix}-aus-cero`, 'Días para llegar a 0', Number(cfg.ausentismo_dias_cero.toFixed(4)), 'min="0.1" step="0.1"')}
          `)}
          ${filaAspecto('Tardanzas', `
            ${subcampoNum(`dp-${idPrefix}-tard-max`, 'Puntos máx.', cfg.tardanzas_max)}
            ${subcampoNum(`dp-${idPrefix}-tard-cero`, 'Cantidad para llegar a 0', Number(cfg.tardanzas_cant_cero.toFixed(4)), 'min="0.1" step="0.1"')}
          `)}
          ${filaAspecto('Cumplimiento de EPP', `
            ${subcampoNum(`dp-${idPrefix}-epp-max`, 'Puntos máx.', cfg.epp_max ?? 15, cfg.epp_max == null ? 'disabled' : '')}
            ${checkNoEvaluar(`dp-${idPrefix}-epp-no`, cfg.epp_max == null)}
          `)}
          ${filaAspecto(REPROCESOS_LABEL_DEFAULT, `
            ${subcampoNum(`dp-${idPrefix}-repro-max`, 'Puntos máx.', cfg.reprocesos_max ?? 10, cfg.reprocesos_max == null ? 'disabled' : '')}
            ${checkNoEvaluar(`dp-${idPrefix}-repro-no`, cfg.reprocesos_max == null)}
            ${conNombrePersonalizado ? `
            <label class="desem__subcampo">
              <span>Nombre para este puesto (opcional)</span>
              <input type="text" id="dp-${idPrefix}-repro-label" value="${eP(cfg.reprocesos_label || '').replace(/"/g, '&quot;')}" placeholder="${REPROCESOS_LABEL_DEFAULT}" ${cfg.reprocesos_max == null ? 'disabled' : ''}>
            </label>` : ''}
          `)}
          ${filaAspecto('Evaluación aptitudinal + operativa', `
            ${subcampoNum(`dp-${idPrefix}-eval-max`, 'Puntos máx.', cfg.evaluacion_max)}
          `)}
        </div>
        <p class="pres__vacio-small" id="dp-${idPrefix}-total" style="margin-top:10px"></p>
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
  function wirePuntaje(el, idPrefix, onGuardar) {
    const campos = ['aus-max', 'aus-cero', 'tard-max', 'tard-cero', 'eval-max', 'epp-max', 'repro-max'];
    const inputs = Object.fromEntries(campos.map(c => [c, el.querySelector(`#dp-${idPrefix}-${c}`)]));
    const totalEl = el.querySelector(`#dp-${idPrefix}-total`);
    const estadoEl = el.querySelector(`#dp-${idPrefix}-estado`);
    const btn = el.querySelector(`#dp-${idPrefix}-guardar`);
    const noEpp = el.querySelector(`#dp-${idPrefix}-epp-no`);
    const noRepro = el.querySelector(`#dp-${idPrefix}-repro-no`);
    const reproLabel = el.querySelector(`#dp-${idPrefix}-repro-label`);

    function actualizarTotal() {
      const total = +inputs['aus-max'].value + +inputs['tard-max'].value + +inputs['eval-max'].value
        + (!noEpp.checked ? +inputs['epp-max'].value : 0)
        + (!noRepro.checked ? +inputs['repro-max'].value : 0);
      totalEl.textContent = `Total: ${fmtN(total)} pts${Math.abs(total - 100) > 0.01 ? ' (no suma 100 — igual se puede guardar)' : ''}`;
      totalEl.style.color = Math.abs(total - 100) > 0.01 ? '#d97706' : 'var(--color-texto-sec)';
    }
    campos.forEach(c => inputs[c].addEventListener('input', actualizarTotal));
    noEpp.addEventListener('change', () => { inputs['epp-max'].disabled = noEpp.checked; actualizarTotal(); });
    noRepro.addEventListener('change', () => {
      inputs['repro-max'].disabled = noRepro.checked;
      if (reproLabel) reproLabel.disabled = noRepro.checked;
      actualizarTotal();
    });
    actualizarTotal();

    btn.addEventListener('click', async () => {
      btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        const valores = {
          ausentismo_max: +inputs['aus-max'].value, ausentismo_dias_cero: +inputs['aus-cero'].value,
          tardanzas_max: +inputs['tard-max'].value, tardanzas_cant_cero: +inputs['tard-cero'].value,
          evaluacion_max: +inputs['eval-max'].value,
          epp_max: !noEpp.checked ? +inputs['epp-max'].value : null,
          reprocesos_max: !noRepro.checked ? +inputs['repro-max'].value : null,
          reprocesos_label: !noRepro.checked ? (reproLabel?.value.trim() || null) : null,
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
    const puestos = puestosDesempeno();

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
      listaEl.querySelectorAll('[data-excluir-puesto]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const puesto = btn.dataset.excluirPuesto;
          btn.disabled = true;
          try {
            await excluirPuestoDesempeno(puesto);
            puestosExcluidos.add(normPuesto(puesto));
            expandido = null;
            pintar();
          } catch (err) {
            alert('No se pudo excluir: ' + err.message);
          }
        });
      });
      listaEl.querySelectorAll('[data-incluir-puesto]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const puesto = btn.dataset.incluirPuesto;
          btn.disabled = true;
          try {
            await incluirPuestoDesempeno(puesto);
            puestosExcluidos.delete(normPuesto(puesto));
            pintar();
          } catch (err) {
            alert('No se pudo volver a incluir: ' + err.message);
          }
        });
      });
    }

    function tarjetaPuesto(p, i) {
      const override = configPorPuesto.get(normPuesto(p.puesto));
      const excluido = puestosExcluidos.has(normPuesto(p.puesto));
      return `
        <div class="pind__sec" style="margin-bottom:var(--espacio-m)${excluido ? ';opacity:0.75' : ''}">
          <div class="pind__grupo-header" ${excluido ? '' : `data-toggle-puesto="${i}" style="cursor:pointer;border-left-color:var(--color-primario)"`}>
            <div class="pind__grupo-header-izq">
              <h2 class="pind__grupo-titulo">${eP(p.puesto)}</h2>
              <div class="pind__grupo-badges">
                <span class="pind__grupo-badge pind__grupo-badge--desvinc">${TIPO_LABEL[p.tipo]}</span>
                <span class="pind__grupo-badge pind__grupo-badge--desvinc">${p.n} persona${p.n !== 1 ? 's' : ''}</span>
                ${excluido
                  ? '<span class="pind__grupo-badge pind__grupo-badge--desvinc" style="background:#fee2e2;color:#b91c1c">No se evalúa</span>'
                  : override
                    ? '<span class="pind__grupo-badge pind__grupo-badge--activo">Personalizado</span>'
                    : '<span class="pind__grupo-badge pind__grupo-badge--desvinc">Usa el default de ' + TIPO_LABEL[p.tipo].toLowerCase() + '</span>'}
              </div>
            </div>
            <div style="display:flex;gap:8px;align-items:center">
              ${excluido
                ? `<button type="button" class="plantel__param-btn" data-incluir-puesto="${eP(p.puesto)}">Incluir en la evaluación</button>`
                : `<button type="button" class="plantel__param-btn" data-excluir-puesto="${eP(p.puesto)}">No evaluar este puesto</button>
                   <button type="button" class="pind__dep-toggle" data-toggle-puesto="${i}">${expandido === i ? '▾ Ocultar' : override ? '▸ Editar' : '▸ Personalizar'}</button>`}
            </div>
          </div>
          ${!excluido && expandido === i ? `
          <div style="padding:var(--espacio-m)">
            ${tarjetaPuntaje(`puesto-${i}`, '', override || config[p.tipo], true)}
            ${override ? `<div class="pres__carga-acciones" style="margin-top:8px"><button type="button" class="plantel__param-btn" data-quitar-puesto="${eP(p.puesto)}">Quitar personalización (volver al default)</button></div>` : ''}
          </div>` : ''}
        </div>
      `;
    }

    function wirePuesto(p, i) {
      wirePuntaje(listaEl, `puesto-${i}`, async (valores) => {
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
        Acá se da de alta a cada evaluador y se le asignan manualmente los PUESTOS que le toca
        evaluar (no personas puntuales) — así, cuando alguien entra o sale de un puesto ya
        asignado, no hace falta re-tocar nada acá. Los evaluadores no entran a este Tablero —
        cargan sus evaluaciones (anual y período de prueba) desde un portal aparte, con su nombre
        y DNI. Lo que carguen aparece automáticamente en "Indicadores", igual que si lo hubiera
        cargado RRHH.
      </p>
      <div class="pres__personas-wrap" style="background:var(--color-fondo);border:1px solid var(--color-borde);border-radius:var(--radio-s);padding:var(--espacio-m);margin-bottom:var(--espacio-l)">
        <span class="desem__campo" style="font-weight:600;color:var(--color-texto-sec);font-size:0.8rem">Link del portal para los evaluadores</span>
        <div style="display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap">
          <code id="evd-link" style="font-size:0.85rem;background:var(--color-fondo-tarjeta);border:1px solid var(--color-borde);border-radius:6px;padding:6px 10px">${eP(linkPortal)}</code>
          <button type="button" class="pind__dep-toggle" id="evd-copiar">Copiar link</button>
        </div>
      </div>

      <div id="evd-sin-asignar" style="margin-bottom:var(--espacio-l)"></div>

      <div style="display:flex;gap:var(--espacio-m);align-items:flex-start;flex-wrap:wrap;margin-bottom:var(--espacio-l)">
        <div class="fichexc__agregar" style="margin:0;flex:1 1 320px">
          <h3 class="pind__sec-tit" style="margin-bottom:8px">Nuevo evaluador</h3>
          <p class="pres__subtitulo" style="margin-bottom:8px">Se elige de la lista de personal — el DNI se detecta solo desde su CUIL, no hace falta tipearlo.</p>
          <input type="search" id="evd-nuevo-busq" class="plantel__busqueda" autocomplete="off"
                 placeholder="Buscar persona por legajo o nombre…">
          <div id="evd-nuevo-resultados" class="pres-ficha__resultados" hidden></div>
          <div id="evd-nuevo-confirmar"></div>
        </div>
        <div id="evd-puestos-sin-evaluador" style="flex:0 1 280px;background:var(--color-fondo);border:1px solid var(--color-borde);border-radius:var(--radio-s);padding:var(--espacio-m)"></div>
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
    const puestosSinEvEl = el.querySelector('#evd-puestos-sin-evaluador');
    renderLista();

    // Mismo "hueco" que renderSinAsignar(), pero por PUESTO en vez de por persona — para saber de
    // un vistazo qué asignar, sin tener que ir contando personas repetidas del mismo puesto.
    function renderPuestosSinEvaluador() {
      const cubiertos = new Set(asignaciones.map(a => normPuesto(a.desc_puesto)));
      const sinEvaluador = puestosDesempeno().filter(p => !cubiertos.has(normPuesto(p.puesto)));
      puestosSinEvEl.innerHTML = `
        <span class="desem__campo" style="font-weight:600;color:var(--color-texto-sec);font-size:0.8rem">Puestos sin evaluador (${sinEvaluador.length})</span>
        ${sinEvaluador.length
          ? `<ul style="margin:8px 0 0;padding-left:18px;font-size:0.85rem;max-height:180px;overflow-y:auto">
              ${sinEvaluador.map(p => `<li style="margin-bottom:4px">${eP(p.puesto)} <span style="color:var(--color-texto-sec)">· ${p.n} persona${p.n !== 1 ? 's' : ''}</span></li>`).join('')}
            </ul>`
          : '<p class="pres__msg-exito" style="margin-top:8px;font-size:0.85rem">✓ Todos los puestos tienen evaluador.</p>'}
      `;
    }

    // Personas activas cuyo puesto no le toca a ningún evaluador todavía — el "hueco" en el
    // diagrama de quién evalúa a quién. Se recalcula cada vez que cambia algo (alta/baja de
    // evaluador, asignar/quitar un puesto), porque renderLista() ya es el punto central por el
    // que pasa todo eso.
    function renderSinAsignar() {
      const puestosCubiertos = new Set(asignaciones.map(a => normPuesto(a.desc_puesto)));
      const sinAsignar = activos
        .filter(p => !puestosCubiertos.has(normPuesto(p.desc_puesto)))
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
      renderPuestosSinEvaluador();
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
      const puestosAsig = asignaciones
        .filter(a => a.evaluador_id === ev.id)
        .map(a => a.desc_puesto)
        .sort((a, b) => a.localeCompare(b));
      const puestosAsigSet = new Set(puestosAsig.map(normPuesto));
      const personasCount = activos.filter(p => puestosAsigSet.has(normPuesto(p.desc_puesto))).length;

      return `
        <div class="pind__sec" style="margin-bottom:var(--espacio-m)">
          <div class="pind__grupo-header" data-toggle="${ev.id}" style="cursor:pointer;border-left-color:var(--color-primario)">
            <div class="pind__grupo-header-izq">
              <h2 class="pind__grupo-titulo">${eP(ev.nombre)}</h2>
              <div class="pind__grupo-badges">
                <span class="pind__grupo-badge ${ev.activo ? 'pind__grupo-badge--activo' : 'pind__grupo-badge--desvinc'}">${ev.activo ? 'Activo' : 'Desactivado'}</span>
                ${ev.legajo != null ? `<span class="pind__grupo-badge pind__grupo-badge--desvinc">Legajo #${ev.legajo} · ${EMP_LABEL[ev.empresa] || ev.empresa}</span>` : ''}
                <span class="pind__grupo-badge pind__grupo-badge--desvinc">${puestosAsig.length} puesto${puestosAsig.length !== 1 ? 's' : ''} · ${personasCount} persona${personasCount !== 1 ? 's' : ''}</span>
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
                   placeholder="Buscar puesto para asignarle…">
            <div id="evd-resultados-${ev.id}" class="pres-ficha__resultados" hidden></div>
            <div style="margin-top:var(--espacio-m)">
              ${puestosAsig.length
                ? puestosAsig.map(puesto => filaPuestoAsignado(ev.id, puesto)).join('')
                : '<p class="plantel__param-vacio">Todavía no tiene ningún puesto asignado.</p>'}
            </div>
          </div>` : ''}
        </div>
      `;
    }

    function filaPuestoAsignado(evaluadorId, puesto) {
      const tipo = tipoPuesto(puesto, mapaClasif);
      const n = activos.filter(p => normPuesto(p.desc_puesto) === normPuesto(puesto)).length;
      return `
        <div class="plantel__param-fila">
          <div class="plantel__param-info">
            <span class="plantel__param-puesto">${eP(puesto)}</span>
            <span class="plantel__param-count-chico">${TIPO_LABEL[tipo] || tipo} · ${n} persona${n !== 1 ? 's' : ''}</span>
          </div>
          <div class="plantel__param-acciones">
            <button type="button" class="plantel__param-btn" data-quitar-asig="${evaluadorId}" data-puesto="${eP(puesto)}">Quitar</button>
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
        // Un puesto es de UN solo evaluador a la vez — si ya se lo asignaron a otro, no se puede
        // volver a asignar acá (se explica a quién lo tiene en vez de dejarlo elegir igual).
        const yaAsignados = new Set(asignaciones.filter(a => a.evaluador_id === ev.id).map(a => normPuesto(a.desc_puesto)));
        const otroPorPuesto = new Map(); // puesto normalizado -> nombre del evaluador que ya lo tiene
        asignaciones.forEach(a => {
          if (a.evaluador_id === ev.id) return;
          const otro = evaluadores.find(e => e.id === a.evaluador_id);
          otroPorPuesto.set(normPuesto(a.desc_puesto), otro?.nombre || 'otro evaluador');
        });
        const coincidencias = puestosDesempeno()
          .filter(p => !yaAsignados.has(normPuesto(p.puesto)))
          .filter(p => normTxt(p.puesto).includes(texto))
          .slice(0, 12);
        resultadosEl.hidden = false;
        resultadosEl.innerHTML = coincidencias.length
          ? coincidencias.map(p => {
              const otro = otroPorPuesto.get(normPuesto(p.puesto));
              if (otro) return `
                <div class="pres-ficha__resultado pres-ficha__resultado--bloqueado" style="cursor:default">
                  <span class="pres-ficha__resultado-nombre">${eP(p.puesto)}</span>
                  <span class="pres-ficha__resultado-meta">Ya asignado a ${eP(otro)}</span>
                </div>`;
              return `
              <button type="button" class="pres-ficha__resultado" data-puesto="${eP(p.puesto)}">
                <span class="pres-ficha__resultado-nombre">${eP(p.puesto)}</span>
                <span class="pres-ficha__resultado-meta">${TIPO_LABEL[p.tipo]} · ${p.n} persona${p.n !== 1 ? 's' : ''}</span>
              </button>`;
            }).join('')
          : `<p class="pres-ficha__sin-resultados">Sin resultados.</p>`;

        resultadosEl.querySelectorAll('[data-puesto]').forEach(btn => {
          btn.addEventListener('click', async () => {
            const puesto = btn.dataset.puesto;
            busq.value = ''; resultadosEl.hidden = true;
            try {
              await agregarPuestoAsignado(ev.id, puesto);
              asignaciones.push({ evaluador_id: ev.id, desc_puesto: puesto });
              renderLista();
            } catch (err) {
              alert('No se pudo asignar: ' + err.message);
            }
          });
        });
      });

      listaEl.querySelectorAll(`[data-quitar-asig="${ev.id}"]`).forEach(btn => {
        btn.addEventListener('click', async () => {
          const puesto = btn.dataset.puesto;
          try {
            await quitarPuestoAsignado(ev.id, puesto);
            asignaciones = asignaciones.filter(a => !(a.evaluador_id === ev.id && normPuesto(a.desc_puesto) === normPuesto(puesto)));
            renderLista();
          } catch (err) {
            alert('No se pudo quitar: ' + err.message);
          }
        });
      });
    }
  }
}
