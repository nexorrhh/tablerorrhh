// Horas y Presentismo → Novedades.
// Vista de "qué pasó" en UN día puntual, navegable con ‹ › — para que dirección pueda ver de
// un vistazo llegadas tarde, faltas, horas extra y desvíos de mensuales sin ir registro a registro.
// No agrega tablas nuevas: lee las mismas rrhh_tardanzas_salidas / rrhh_horas_detalle /
// rrhh_horas_mensual que ya alimentan Indicadores y Ficha individual.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';
import { obtenerClasificacionAusencias, categoriaAusencia } from '../data/clasificacion-ausencias.js';
import { obtenerClasificacionPuestos, tipoPuesto } from '../data/clasificacion-puestos.js';
import { CODIGOS_EXCLUIDOS_AUSENTISMO } from './presentismo-indicadores.js';
import { renderizarPresentismoFichadas } from './presentismo-fichadas.js';

const HDR = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
const EMPRESAS  = ['CIMOMET', 'COMOING'];
const EMP_LABEL = { CIMOMET: 'Cimomet', COMOING: 'Co.mo.ing' };
const DIAS_SEM   = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
const MESES      = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

const CATEGORIA_LABEL = { enfermedad: 'Enfermedad', accidente: 'Accidente', licencia: 'Licencia', aviso: 'Aviso', sin_aviso: 'Sin aviso', sin_clasificar: 'Sin clasificar' };
const CATEGORIA_COLOR = { enfermedad: '#d97706', accidente: '#dc2626', licencia: '#0891b2', aviso: '#2563eb', sin_aviso: '#991b1b', sin_clasificar: '#94a3b8' };

function eP(s) { return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function fechaISO(d) { return d.toISOString().slice(0, 10); }
function sumarDias(fecha, n) {
  const [y, m, d] = fecha.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return fechaISO(dt);
}
function periodoDe(fecha) { return fecha.slice(0, 7) + '-01'; }
function tituloFecha(fecha) {
  const [y, m, d] = fecha.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${DIAS_SEM[dt.getUTCDay()]} ${d} de ${MESES[m - 1]} de ${y}`;
}
// Lunes de la semana que contiene `fecha` — la semana laboral acá es de lunes a viernes,
// los sábados se manejan aparte en "Sábados y feriados" (asistencia propia, con citación).
function lunesDeSemana(fecha) {
  const [y, m, d] = fecha.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0=domingo … 6=sábado
  dt.setUTCDate(dt.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return fechaISO(dt);
}
function tituloRango(lunes, viernes) {
  const [y1, m1, d1] = lunes.split('-').map(Number);
  const [y2, m2, d2] = viernes.split('-').map(Number);
  if (y1 === y2 && m1 === m2) return `Semana del ${d1} al ${d2} de ${MESES[m1 - 1]} de ${y1}`;
  if (y1 === y2) return `Semana del ${d1} de ${MESES[m1 - 1]} al ${d2} de ${MESES[m2 - 1]} de ${y1}`;
  return `Semana del ${d1} de ${MESES[m1 - 1]} de ${y1} al ${d2} de ${MESES[m2 - 1]} de ${y2}`;
}
function tituloFechaCorta(fecha) {
  const [y, m, d] = fecha.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${DIAS_SEM[dt.getUTCDay()]} ${d}/${String(m).padStart(2, '0')}`;
}
// Minutos → "Xh Ymin" / "Ymin"
function fmtMin(mins) {
  const m = Math.round(mins);
  if (m <= 0) return '—';
  const h = Math.floor(m / 60), r = m % 60;
  if (h === 0) return `${r} min`;
  if (r === 0) return `${h} h`;
  return `${h} h ${r} min`;
}
function fmtHs(v) {
  if (!v || Math.abs(v) < 0.01) return '—';
  return fmtMin(Math.abs(v) * 60);
}

export async function renderizarPresentismoNovedades(contenedor) {
  contenedor.innerHTML = `
    <div class="nov__wrap">
      <div class="pres-ficha__modo-switch" role="tablist" aria-label="Elegir vista de novedades">
        <button class="pres-ficha__modo-btn pres-ficha__modo-btn--activo" data-modo="tango" type="button" role="tab" aria-selected="true">Datos de Tango</button>
        <button class="pres-ficha__modo-btn" data-modo="fichadas" type="button" role="tab" aria-selected="false">Chequeo del día (fichadas)</button>
      </div>
      <div id="nov-modo-tango" class="nov__wrap"><div class="pres__loading">Cargando…</div></div>
      <div id="nov-modo-fichadas" hidden></div>
    </div>
  `;

  const modoTangoEl    = contenedor.querySelector('#nov-modo-tango');
  const modoFichadasEl = contenedor.querySelector('#nov-modo-fichadas');
  let fichadasInicializado = false;

  contenedor.querySelectorAll('.pres-ficha__modo-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const modo = btn.dataset.modo;
      contenedor.querySelectorAll('.pres-ficha__modo-btn').forEach(b => {
        const activo = b === btn;
        b.classList.toggle('pres-ficha__modo-btn--activo', activo);
        b.setAttribute('aria-selected', String(activo));
      });
      modoTangoEl.hidden = modo !== 'tango';
      modoFichadasEl.hidden = modo !== 'fichadas';
      if (modo === 'fichadas' && !fichadasInicializado) {
        fichadasInicializado = true;
        renderizarPresentismoFichadas(modoFichadasEl);
      }
    });
  });

  await renderModoTango(modoTangoEl);
}

// ── Modo "Datos de Tango": lo que ya cargó el parte mensual, navegable día a día ─────────
async function renderModoTango(contenedor) {
  // Rango de fechas con datos cargados, para no dejar navegar a un día sin sentido.
  let minFecha = null, maxFecha = null;
  try {
    const [rMin, rMax] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/rrhh_horas_detalle?select=fecha&order=fecha.asc&limit=1`, { headers: HDR }),
      fetch(`${SUPABASE_URL}/rest/v1/rrhh_horas_detalle?select=fecha&order=fecha.desc&limit=1`, { headers: HDR }),
    ]);
    const jMin = rMin.ok ? await rMin.json() : [];
    const jMax = rMax.ok ? await rMax.json() : [];
    minFecha = jMin[0]?.fecha || null;
    maxFecha = jMax[0]?.fecha || null;
  } catch {}

  if (!minFecha || !maxFecha) {
    contenedor.innerHTML = `<div class="pres__vacio">No hay datos cargados todavía. Usá la pestaña "Cargar datos" para importar el archivo de Tango.</div>`;
    return;
  }

  // Clasificación de puestos (mensual/quincenal/sin_asignar) — la misma que usa Indicadores
  // para separar "Personal de taller" de "Personal administrativo" (config en Plantel →
  // Parametrización), así el criterio de agrupamiento es consistente en toda la app.
  const empMap = new Map(); // legajo (string) → 'mensual' | 'quincenal' | 'sin_asignar'
  let mapaAusencias = new Map();
  try {
    const [rEmp, mapaClasif, mapaAus] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/empleados?select=legajo,desc_puesto`, { headers: HDR }),
      obtenerClasificacionPuestos(),
      obtenerClasificacionAusencias(),
    ]);
    if (rEmp.ok) {
      const empleados = await rEmp.json();
      empleados.forEach(e => empMap.set(String(e.legajo), tipoPuesto(e.desc_puesto, mapaClasif)));
    }
    mapaAusencias = mapaAus;
  } catch {}

  // Por defecto: ayer (o el último día con datos, si ayer todavía no se cargó / es futuro).
  const ayer = sumarDias(fechaISO(new Date()), -1);
  let diaActual = ayer > maxFecha ? maxFecha : (ayer < minFecha ? minFecha : ayer);
  let semanaActual = lunesDeSemana(diaActual);
  let filtroEmpresa = '';
  let vista = 'dia';

  contenedor.innerHTML = `
    <div class="pres-ficha__modo-switch" role="tablist" aria-label="Elegir alcance">
      <button class="pres-ficha__modo-btn pres-ficha__modo-btn--activo" data-vista="dia" type="button" role="tab" aria-selected="true">Día</button>
      <button class="pres-ficha__modo-btn" data-vista="semana" type="button" role="tab" aria-selected="false">Semana</button>
    </div>
    <div class="nov__barra">
      <div class="nov__nav" id="nov-nav-dia">
        <button class="nov__nav-btn" id="nov-prev" type="button" aria-label="Día anterior">‹</button>
        <div class="nov__fecha-box">
          <span class="nov__fecha-titulo" id="nov-fecha-titulo"></span>
          <input type="date" class="nov__fecha-input" id="nov-fecha-input" min="${minFecha}" max="${maxFecha}">
        </div>
        <button class="nov__nav-btn" id="nov-next" type="button" aria-label="Día siguiente">›</button>
      </div>
      <div class="nov__nav" id="nov-nav-semana" hidden>
        <button class="nov__nav-btn" id="nov-sem-prev" type="button" aria-label="Semana anterior">‹</button>
        <span class="nov__fecha-titulo" id="nov-sem-titulo"></span>
        <button class="nov__nav-btn" id="nov-sem-next" type="button" aria-label="Semana siguiente">›</button>
      </div>
      <div class="plantel__empresa-pills" role="group" aria-label="Filtrar por empresa" id="nov-pills-emp"></div>
    </div>
    <div id="nov-contenido"><div class="pres__loading">Cargando…</div></div>
  `;

  const tituloEl    = contenedor.querySelector('#nov-fecha-titulo');
  const inputFecha  = contenedor.querySelector('#nov-fecha-input');
  const navDiaEl    = contenedor.querySelector('#nov-nav-dia');
  const navSemanaEl = contenedor.querySelector('#nov-nav-semana');
  const tituloSemEl = contenedor.querySelector('#nov-sem-titulo');
  const contenido   = contenedor.querySelector('#nov-contenido');
  const pillsEmp    = contenedor.querySelector('#nov-pills-emp');

  function renderPills() {
    pillsEmp.innerHTML = `
      <button class="plantel__pill${!filtroEmpresa ? ' plantel__pill--activo' : ''}" data-empresa="">Todas</button>
      <button class="plantel__pill plantel__pill--cimomet${filtroEmpresa === 'CIMOMET' ? ' plantel__pill--activo' : ''}" data-empresa="CIMOMET">Cimomet</button>
      <button class="plantel__pill plantel__pill--comoing${filtroEmpresa === 'COMOING' ? ' plantel__pill--activo' : ''}" data-empresa="COMOING">Co.mo.ing</button>
    `;
    pillsEmp.querySelectorAll('[data-empresa]').forEach(btn => {
      btn.addEventListener('click', () => {
        filtroEmpresa = btn.dataset.empresa;
        renderPills();
        vista === 'dia' ? render() : renderSemana();
      });
    });
  }
  renderPills();

  // Delegado una sola vez sobre `contenido` (que nunca se reemplaza, solo su innerHTML) para
  // no tener que re-enganchar el toggle de cada sección cada vez que se re-renderiza el día,
  // la semana, o se abre/cierra el panel de un día dentro de la vista Semana.
  contenido.addEventListener('click', e => {
    const btn = e.target.closest('[data-toggle-seccion]');
    if (!btn) return;
    const panel = btn.nextElementSibling;
    if (!panel) return;
    const vaAAbrir = panel.hidden;
    panel.hidden = !vaAAbrir;
    btn.setAttribute('aria-expanded', String(vaAAbrir));
    btn.querySelector('.nov__seccion-caret').textContent = vaAAbrir ? '▾' : '▸';
  });

  // ── Toggle Día / Semana ──────────────────────────────────────────────────
  contenedor.querySelectorAll('.pres-ficha__modo-btn[data-vista]').forEach(btn => {
    btn.addEventListener('click', () => {
      vista = btn.dataset.vista;
      contenedor.querySelectorAll('.pres-ficha__modo-btn[data-vista]').forEach(b => {
        const activo = b === btn;
        b.classList.toggle('pres-ficha__modo-btn--activo', activo);
        b.setAttribute('aria-selected', String(activo));
      });
      navDiaEl.hidden    = vista !== 'dia';
      navSemanaEl.hidden = vista !== 'semana';
      if (vista === 'dia') cargarYRender(); else cargarYRenderSemana();
    });
  });

  function irA(fecha) {
    if (fecha < minFecha || fecha > maxFecha) return;
    diaActual = fecha;
    cargarYRender();
  }

  contenedor.querySelector('#nov-prev').addEventListener('click', () => irA(sumarDias(diaActual, -1)));
  contenedor.querySelector('#nov-next').addEventListener('click', () => irA(sumarDias(diaActual, 1)));
  inputFecha.addEventListener('change', () => { if (inputFecha.value) irA(inputFecha.value); });

  function irASemana(lunes) {
    const limIzq = lunesDeSemana(minFecha), limDer = lunesDeSemana(maxFecha);
    if (lunes < limIzq || lunes > limDer) return;
    semanaActual = lunes;
    cargarYRenderSemana();
  }
  contenedor.querySelector('#nov-sem-prev').addEventListener('click', () => irASemana(sumarDias(semanaActual, -7)));
  contenedor.querySelector('#nov-sem-next').addEventListener('click', () => irASemana(sumarDias(semanaActual, 7)));

  // Flechas de teclado — solo para la vista Día, y solo cuando el foco no está en un input y
  // el modo "Tango" está visible (si el usuario pasó a "Chequeo del día", este contenedor
  // queda oculto pero sigue en el DOM, así que sin el chequeo de `hidden` las flechas
  // seguirían navegando por debajo sin que se vea nada).
  const onKeydown = e => {
    if (contenedor.hidden || vista !== 'dia' || document.activeElement === inputFecha) return;
    if (e.key === 'ArrowLeft')  irA(sumarDias(diaActual, -1));
    if (e.key === 'ArrowRight') irA(sumarDias(diaActual, 1));
  };
  document.addEventListener('keydown', onKeydown);
  // El observer del router llama a esta función al desmontar — pero como no hay un hook de
  // "cleanup" explícito en este proyecto, se limpia solo al perder el elemento del DOM (el
  // listener queda en document, así que se remueve cuando cambian de pestaña usando MutationObserver liviano).
  const obs = new MutationObserver(() => {
    if (!document.body.contains(contenedor)) { document.removeEventListener('keydown', onKeydown); obs.disconnect(); }
  });
  obs.observe(document.body, { childList: true, subtree: true });

  const cacheDia = new Map();
  const cacheSemana = new Map();

  async function cargarYRender() {
    tituloEl.textContent = tituloFecha(diaActual);
    inputFecha.value = diaActual;
    contenedor.querySelector('#nov-prev').disabled = diaActual <= minFecha;
    contenedor.querySelector('#nov-next').disabled = diaActual >= maxFecha;
    contenido.innerHTML = '<div class="pres__loading">Cargando…</div>';

    let datos = cacheDia.get(diaActual);
    if (!datos) {
      try {
        const periodo = periodoDe(diaActual);
        const [rTard, rDet, rMen] = await Promise.all([
          fetch(`${SUPABASE_URL}/rest/v1/rrhh_tardanzas_salidas?fecha=eq.${diaActual}&select=legajo,empresa,tipo,minutos,codigo_justificacion,descripcion_justificacion&order=id.asc`, { headers: HDR }),
          fetch(`${SUPABASE_URL}/rest/v1/rrhh_horas_detalle?fecha=eq.${diaActual}&select=legajo,empresa,tipo_hora,hs_trabajadas,hs_reales,hs_esperadas&order=id.asc`, { headers: HDR }),
          fetch(`${SUPABASE_URL}/rest/v1/rrhh_horas_mensual?periodo=eq.${periodo}&select=legajo,empresa,apellido,nombre,departamento,condicion`, { headers: HDR }),
        ]);
        datos = {
          tardanzas: rTard.ok ? await rTard.json() : [],
          detalle:   rDet.ok  ? await rDet.json()  : [],
          roster:    rMen.ok  ? await rMen.json()  : [],
        };
        cacheDia.set(diaActual, datos);
      } catch {
        datos = { tardanzas: [], detalle: [], roster: [] };
      }
    }
    render(datos);
  }

  function render(datosArg) {
    const datos = datosArg || cacheDia.get(diaActual);
    if (!datos) return;
    contenido.innerHTML = construirNovedades(datos, filtroEmpresa, mapaAusencias, empMap);
  }

  // ── Vista Semana: lunes a viernes de la semana de `semanaActual` (los sábados se manejan
  // aparte, en Sábados y feriados) — una sola consulta por rango en vez de 5 consultas sueltas. ─
  async function cargarYRenderSemana() {
    const lunes = semanaActual, viernes = sumarDias(lunes, 4);
    tituloSemEl.textContent = tituloRango(lunes, viernes);
    contenedor.querySelector('#nov-sem-prev').disabled = lunes <= lunesDeSemana(minFecha);
    contenedor.querySelector('#nov-sem-next').disabled = lunes >= lunesDeSemana(maxFecha);
    contenido.innerHTML = '<div class="pres__loading">Cargando…</div>';

    let datos = cacheSemana.get(lunes);
    if (!datos) {
      try {
        const periodos = [...new Set([periodoDe(lunes), periodoDe(viernes)])];
        const [rTard, rDet, rMen] = await Promise.all([
          fetch(`${SUPABASE_URL}/rest/v1/rrhh_tardanzas_salidas?fecha=gte.${lunes}&fecha=lte.${viernes}&select=fecha,legajo,empresa,tipo,minutos,codigo_justificacion,descripcion_justificacion&order=id.asc`, { headers: HDR }),
          fetch(`${SUPABASE_URL}/rest/v1/rrhh_horas_detalle?fecha=gte.${lunes}&fecha=lte.${viernes}&select=fecha,legajo,empresa,tipo_hora,hs_trabajadas,hs_reales,hs_esperadas&order=id.asc`, { headers: HDR }),
          fetch(`${SUPABASE_URL}/rest/v1/rrhh_horas_mensual?periodo=in.(${periodos.join(',')})&select=legajo,empresa,apellido,nombre,departamento,condicion`, { headers: HDR }),
        ]);
        const tardanzas = rTard.ok ? await rTard.json() : [];
        const detalle   = rDet.ok  ? await rDet.json()  : [];
        const roster    = rMen.ok  ? await rMen.json()  : [];
        const porFecha = new Map();
        for (let f = lunes; f <= viernes; f = sumarDias(f, 1)) porFecha.set(f, { fecha: f, tardanzas: [], detalle: [] });
        tardanzas.forEach(t => porFecha.get(t.fecha)?.tardanzas.push(t));
        detalle.forEach(d => porFecha.get(d.fecha)?.detalle.push(d));
        datos = { dias: [...porFecha.values()], roster };
        cacheSemana.set(lunes, datos);
      } catch {
        datos = { dias: [], roster: [] };
      }
    }
    renderSemana(datos);
  }

  function renderSemana(datosArg) {
    const datos = datosArg || cacheSemana.get(semanaActual);
    if (!datos) return;
    contenido.innerHTML = construirResumenSemanal(datos, filtroEmpresa, mapaAusencias, empMap);
    contenido.querySelectorAll('[data-toggle-dia]').forEach(btn => {
      btn.addEventListener('click', () => {
        const panel = contenido.querySelector(`#nov-sem-dia-${btn.dataset.toggleDia}`);
        if (!panel) return;
        const vaAAbrir = panel.hidden;
        panel.hidden = !vaAAbrir;
        btn.setAttribute('aria-expanded', String(vaAAbrir));
        btn.querySelector('.nov__sem-dia-caret').textContent = vaAAbrir ? '▾' : '▸';
      });
    });
  }

  cargarYRender();
}

const GRUPO_LABEL = { quincenal: 'Personal de taller — Quincenales', mensual: 'Personal administrativo — Mensuales', sin_asignar: 'Sin clasificar (puesto sin asignar en Parametrización)' };
const GRUPO_COLOR = { quincenal: 'var(--color-primario)', mensual: '#0d9488', sin_asignar: '#94a3b8' };

// ── Lógica de armado de las novedades de un día (se reusa tal cual para la vista Semana,
// tanto para las tarjetas resumen como para el detalle día por día) ─────────────────────
function calcularGrupos({ tardanzas, detalle, roster }, filtroEmpresa, mapaAusencias, empMap) {
  // roster: legajo+empresa → persona. Si un legajo existe en las dos empresas ese mes,
  // no se puede resolver "a ciegas" la empresa de una fila vieja sin empresa propia —
  // en ese caso la fila queda fuera en vez de arriesgar atribuirla a la persona equivocada.
  const rosterMap = new Map();      // `${legajo}|${empresa}` → persona
  const porLegajo = new Map();      // legajo → [personas de ese mes, 1 o 2 si hay colisión]
  roster.forEach(p => {
    rosterMap.set(`${p.legajo}|${p.empresa}`, p);
    if (!porLegajo.has(p.legajo)) porLegajo.set(p.legajo, []);
    porLegajo.get(p.legajo).push(p);
  });

  function resolver(fila) {
    let empresa = fila.empresa;
    if (!empresa) {
      const candidatos = porLegajo.get(fila.legajo);
      empresa = (candidatos && candidatos.length === 1) ? candidatos[0].empresa : null;
    }
    const persona = empresa ? rosterMap.get(`${fila.legajo}|${empresa}`) : null;
    const grupo = empMap.get(String(fila.legajo)) || 'sin_asignar';
    return { empresa, persona, grupo };
  }

  function pasaFiltro(empresa) {
    return !filtroEmpresa || empresa === filtroEmpresa;
  }

  function nombreDe(persona, legajo) {
    if (!persona) return `Legajo ${legajo}`;
    return `${persona.apellido || ''}${persona.nombre ? ', ' + persona.nombre : ''}`.trim() || `Legajo ${legajo}`;
  }

  // ── Llegadas tarde / salidas anticipadas / faltas (rrhh_tardanzas_salidas) ──
  const tarde = [], temprano = [], faltas = [], licencias = [];
  tardanzas.forEach(t => {
    const { empresa, persona, grupo } = resolver(t);
    if (!pasaFiltro(empresa)) return;
    const fila = { legajo: t.legajo, empresa, persona, grupo, minutos: +t.minutos || 0, codigo: t.codigo_justificacion, desc: t.descripcion_justificacion };
    if (t.tipo === 'tarde') tarde.push(fila);
    else if (t.tipo === 'temprano') temprano.push(fila);
    else if (t.tipo === 'ausente') {
      if (t.codigo_justificacion === 'VACACION' || t.codigo_justificacion === 'VIAJE') licencias.push(fila);
      else if (!CODIGOS_EXCLUIDOS_AUSENTISMO.has(t.codigo_justificacion)) {
        fila.categoria = categoriaAusencia(t.codigo_justificacion, mapaAusencias);
        faltas.push(fila);
      }
    }
  });
  tarde.sort((a, b) => b.minutos - a.minutos);
  temprano.sort((a, b) => b.minutos - a.minutos);
  faltas.sort((a, b) => a.categoria.localeCompare(b.categoria) || nombreDe(a.persona, a.legajo).localeCompare(nombreDe(b.persona, b.legajo)));

  // ── Horas extra (rrhh_horas_detalle) ────────────────────────────────────────
  const acumPorPersona = new Map(); // `${legajo}|${empresa}` → { legajo, empresa, persona, grupo, ext50, ext100, reales, esperadas }
  detalle.forEach(d => {
    const { empresa, persona, grupo } = resolver(d);
    if (!pasaFiltro(empresa)) return;
    const key = `${d.legajo}|${empresa || '?'}`;
    if (!acumPorPersona.has(key)) acumPorPersona.set(key, { legajo: d.legajo, empresa, persona, grupo, ext50: 0, ext100: 0, reales: 0, esperadas: 0 });
    const acc = acumPorPersona.get(key);
    if (d.tipo_hora === 'HSEXT' || d.tipo_hora === 'HSEXT50' || d.tipo_hora === 'HS 50 VAC') acc.ext50 += +d.hs_trabajadas || 0;
    if (d.tipo_hora === 'HSEXT100' || d.tipo_hora === 'HS 100 VAC') acc.ext100 += +d.hs_trabajadas || 0;
    if (d.tipo_hora === 'HSNOR') acc.esperadas += +d.hs_esperadas || 0;
    acc.reales += +d.hs_reales || 0; // "reales" = tiempo real en planta, de TODOS los tipos de hora del día
  });

  // Faltas de mensuales que no dejaron evento 'ausente' en tardanzas pero sí quedaron con
  // 0h reales teniendo jornada esperada ese día — para que no se pierdan de la lista de Faltas
  // (a los quincenales ya les llega por el evento de tardanzas de arriba).
  const yaEnFaltas = new Set(faltas.map(f => `${f.legajo}|${f.empresa}`));
  for (const a of acumPorPersona.values()) {
    if (a.esperadas <= 0 || a.reales > 0.01) continue;
    const key = `${a.legajo}|${a.empresa}`;
    if (yaEnFaltas.has(key)) continue;
    yaEnFaltas.add(key);
    faltas.push({ legajo: a.legajo, empresa: a.empresa, persona: a.persona, grupo: a.grupo, categoria: 'sin_clasificar', desc: null, sinEvento: true });
  }

  const horasExtra = [...acumPorPersona.values()]
    .filter(a => a.ext50 + a.ext100 > 0.01)
    .sort((a, b) => (b.ext50 + b.ext100) - (a.ext50 + a.ext100));

  // ── Armado por grupo (mismo criterio que Indicadores: Personal de taller / Personal
  // administrativo, según Plantel → Parametrización) — cada uno con sus propias 5 categorías,
  // para que una persona mensual no aparezca mezclada en la lista de los quincenales.
  const porGrupo = arr => ({
    quincenal: arr.filter(f => f.grupo === 'quincenal'),
    mensual: arr.filter(f => f.grupo === 'mensual'),
    sin_asignar: arr.filter(f => f.grupo === 'sin_asignar'),
  });
  const tardeG = porGrupo(tarde), tempranoG = porGrupo(temprano), faltasG = porGrupo(faltas),
        extraG = porGrupo(horasExtra), licenciasG = porGrupo(licencias);

  const hayAlgo = tarde.length || temprano.length || faltas.length || horasExtra.length || licencias.length;
  const grupos = ['quincenal', 'mensual', 'sin_asignar'].filter(g =>
    tardeG[g].length || tempranoG[g].length || faltasG[g].length || extraG[g].length || licenciasG[g].length
  );

  return { tardeG, tempranoG, faltasG, extraG, licenciasG, grupos, hayAlgo };
}

// HTML de un día completo (una vez calculados los grupos) — vista "Día" y detalle de cada
// día dentro de la vista "Semana" comparten exactamente este render.
function renderGrupos(calc, filtroEmpresa) {
  if (!calc.hayAlgo) {
    return `<div class="pres__vacio">Sin novedades registradas para este día${filtroEmpresa ? ` (${EMP_LABEL[filtroEmpresa]})` : ''}.</div>`;
  }
  return calc.grupos.map(g => bloqueGrupo(g, {
    tarde: calc.tardeG[g], temprano: calc.tempranoG[g], faltas: calc.faltasG[g], horasExtra: calc.extraG[g], licencias: calc.licenciasG[g],
  })).join('');
}

function construirNovedades(datos, filtroEmpresa, mapaAusencias, empMap) {
  return renderGrupos(calcularGrupos(datos, filtroEmpresa, mapaAusencias, empMap), filtroEmpresa);
}

// ── Vista Semana: tarjetas con el total de lunes a viernes + detalle día por día ───────────
// (cada día reusa calcularGrupos/renderGrupos, así el resumen nunca puede desincronizarse
// de lo que se ve en la vista Día para esa misma fecha).
function construirResumenSemanal({ dias, roster }, filtroEmpresa, mapaAusencias, empMap) {
  const diasCalc = dias.map(d => ({
    fecha: d.fecha,
    calc: calcularGrupos({ tardanzas: d.tardanzas, detalle: d.detalle, roster }, filtroEmpresa, mapaAusencias, empMap),
  }));

  const hayAlgo = diasCalc.some(d => d.calc.hayAlgo);
  if (!hayAlgo) {
    return `<div class="pres__vacio">Sin novedades registradas en esta semana${filtroEmpresa ? ` (${EMP_LABEL[filtroEmpresa]})` : ''}.</div>`;
  }

  const gruposPresentes = new Set();
  diasCalc.forEach(d => d.calc.grupos.forEach(g => gruposPresentes.add(g)));
  const grupos = ['quincenal', 'mensual', 'sin_asignar'].filter(g => gruposPresentes.has(g));

  const sumaG = (campo, g) => diasCalc.reduce((s, d) => s + d.calc[campo][g].length, 0);
  const sumaHorasExtra = g => diasCalc.reduce((s, d) => s + d.calc.extraG[g].reduce((s2, a) => s2 + a.ext50 + a.ext100, 0), 0);

  const tarjetasHtml = grupos.map(g => {
    const faltas = sumaG('faltasG', g), tarde = sumaG('tardeG', g), temprano = sumaG('tempranoG', g),
          extraCant = sumaG('extraG', g), extraHoras = sumaHorasExtra(g), licencias = sumaG('licenciasG', g);
    return `
      <div class="nov__grupo">
        <div class="nov__grupo-titulo" style="color:${GRUPO_COLOR[g]}">${GRUPO_LABEL[g]}</div>
        <div class="nov__kpis">
          <div class="nov__kpi"><span class="nov__kpi-num" style="color:#dc2626">${faltas}</span><span class="nov__kpi-lbl">Faltas</span></div>
          <div class="nov__kpi"><span class="nov__kpi-num">${tarde}</span><span class="nov__kpi-lbl">Llegadas tarde</span></div>
          <div class="nov__kpi"><span class="nov__kpi-num">${temprano}</span><span class="nov__kpi-lbl">Salidas anticipadas</span></div>
          <div class="nov__kpi"><span class="nov__kpi-num" style="color:#7c3aed">${extraCant}</span><span class="nov__kpi-lbl">Con horas extra</span>${extraHoras > 0 ? `<span class="nov__kpi-sub">${fmtHs(extraHoras)} en total</span>` : ''}</div>
          <div class="nov__kpi"><span class="nov__kpi-num">${licencias}</span><span class="nov__kpi-lbl">Vacaciones / viaje</span></div>
        </div>
      </div>
    `;
  }).join('');

  const detalleHtml = diasCalc.map((d, i) => {
    const totFaltas = d.calc.grupos.reduce((s, g) => s + d.calc.faltasG[g].length, 0);
    const totTarde = d.calc.grupos.reduce((s, g) => s + d.calc.tardeG[g].length, 0);
    const totTemprano = d.calc.grupos.reduce((s, g) => s + d.calc.tempranoG[g].length, 0);
    const totExtra = d.calc.grupos.reduce((s, g) => s + d.calc.extraG[g].length, 0);
    const totLic = d.calc.grupos.reduce((s, g) => s + d.calc.licenciasG[g].length, 0);
    const tag = (n, label, color) => n ? `<span class="nov__tag" style="color:${color};background:${color}1a;border-color:${color}55">${n} ${label}</span>` : '';
    return `
      <div class="nov__sem-dia">
        <button type="button" class="nov__sem-dia-header" data-toggle-dia="${i}" aria-expanded="false">
          <span class="nov__sem-dia-caret">▸</span>
          <span class="nov__sem-dia-fecha">${tituloFechaCorta(d.fecha)}</span>
          <span class="nov__sem-dia-mini">
            ${totFaltas + totTarde + totTemprano + totExtra + totLic
              ? `${tag(totFaltas, totFaltas === 1 ? 'falta' : 'faltas', '#dc2626')}${tag(totTarde, 'tarde', '#d97706')}${tag(totTemprano, 'temprano', '#0891b2')}${tag(totExtra, 'c/extra', '#7c3aed')}${tag(totLic, 'lic.', '#64748b')}`
              : '<span class="nov__sem-dia-vacio">Sin novedades</span>'}
          </span>
        </button>
        <div class="nov__sem-dia-panel" id="nov-sem-dia-${i}" hidden>
          ${renderGrupos(d.calc, filtroEmpresa)}
        </div>
      </div>
    `;
  }).join('');

  return `
    ${tarjetasHtml}
    <div class="nov__sem-detalle">
      <div class="nov__sem-detalle-titulo">Detalle diario</div>
      ${detalleHtml}
    </div>
  `;
}

function bloqueGrupo(grupo, { tarde, temprano, faltas, horasExtra, licencias }) {
  const totalExtra = horasExtra.reduce((s, a) => s + a.ext50 + a.ext100, 0);
  return `
    <div class="nov__grupo">
      <div class="nov__grupo-titulo" style="color:${GRUPO_COLOR[grupo]}">${GRUPO_LABEL[grupo]}</div>
      <div class="nov__kpis">
        <div class="nov__kpi"><span class="nov__kpi-num" style="color:#dc2626">${faltas.length}</span><span class="nov__kpi-lbl">Faltas</span></div>
        <div class="nov__kpi"><span class="nov__kpi-num">${tarde.length}</span><span class="nov__kpi-lbl">Llegadas tarde</span></div>
        <div class="nov__kpi"><span class="nov__kpi-num">${temprano.length}</span><span class="nov__kpi-lbl">Salidas anticipadas</span></div>
        <div class="nov__kpi"><span class="nov__kpi-num" style="color:#7c3aed">${horasExtra.length}</span><span class="nov__kpi-lbl">Con horas extra</span>${totalExtra > 0 ? `<span class="nov__kpi-sub">${fmtHs(totalExtra)} en total</span>` : ''}</div>
        <div class="nov__kpi"><span class="nov__kpi-num">${licencias.length}</span><span class="nov__kpi-lbl">Vacaciones / viaje</span></div>
      </div>

      ${seccion('Faltas', faltas.length, faltas.map(f => filaPersona(f, `
        <span class="nov__tag" style="color:${CATEGORIA_COLOR[f.categoria]};background:${CATEGORIA_COLOR[f.categoria]}1a;border-color:${CATEGORIA_COLOR[f.categoria]}55">${f.sinEvento ? 'No vino' : CATEGORIA_LABEL[f.categoria]}</span>
        ${f.desc ? `<span class="nov__detalle-txt">${eP(f.desc)}</span>` : ''}
      `)))}

      ${seccion('Llegadas tarde', tarde.length, tarde.map(f => filaPersona(f, `<span class="nov__valor" style="color:#d97706">${fmtMin(f.minutos)} tarde</span>`)))}

      ${seccion('Salidas anticipadas', temprano.length, temprano.map(f => filaPersona(f, `<span class="nov__valor" style="color:#0891b2">${fmtMin(f.minutos)} antes</span>`)))}

      ${seccion('Horas extra', horasExtra.length, horasExtra.map(a => filaPersona(a, `
        ${a.ext50 > 0 ? `<span class="nov__valor" style="color:#7c3aed">${fmtHs(a.ext50)} al 50%</span>` : ''}
        ${a.ext100 > 0 ? `<span class="nov__valor" style="color:#7c3aed">${fmtHs(a.ext100)} al 100%</span>` : ''}
      `)))}

      ${seccion('Vacaciones / viaje', licencias.length, licencias.map(f => filaPersona(f, `<span class="nov__tag">${f.codigo === 'VACACION' ? 'Vacaciones' : 'Viaje laboral'}</span>`)))}
    </div>
  `;
}

function filaPersona(f, extraHtml) {
  return `
    <div class="nov__fila">
      <span class="nov__fila-leg">${f.legajo}</span>
      <span class="nov__fila-nombre">${eP(f.persona ? `${f.persona.apellido || ''}${f.persona.nombre ? ', ' + f.persona.nombre : ''}`.trim() || `Legajo ${f.legajo}` : `Legajo ${f.legajo}`)}</span>
      <span class="nov__fila-emp nov__fila-emp--${(f.empresa || '').toLowerCase()}">${f.empresa ? EMP_LABEL[f.empresa] : '—'}</span>
      <span class="nov__fila-dep">${eP(f.persona?.departamento || '—')}</span>
      <div class="nov__fila-extra">${extraHtml}</div>
    </div>
  `;
}

function seccion(titulo, cantidad, filasHtml, nota) {
  if (!cantidad) return '';
  return `
    <div class="nov__seccion">
      <button type="button" class="nov__seccion-titulo" data-toggle-seccion aria-expanded="false">
        <span class="nov__seccion-caret">▸</span>${titulo} <span class="nov__seccion-cnt">${cantidad}</span>
      </button>
      <div class="nov__seccion-panel" hidden>
        ${nota ? `<div class="nov__seccion-nota">${nota}</div>` : ''}
        <div class="nov__lista">${filasHtml.join('')}</div>
      </div>
    </div>
  `;
}
