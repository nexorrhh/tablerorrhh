// Horas y Presentismo → Novedades.
// Vista de "qué pasó" en UN día puntual, navegable con ‹ › — para que dirección pueda ver de
// un vistazo llegadas tarde, faltas, horas extra y desvíos de mensuales sin ir registro a registro.
// No agrega tablas nuevas: lee las mismas rrhh_tardanzas_salidas / rrhh_horas_detalle /
// rrhh_horas_mensual que ya alimentan Indicadores y Ficha individual.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';
import { obtenerClasificacionAusencias, categoriaAusencia } from '../data/clasificacion-ausencias.js';
import { obtenerClasificacionPuestos, tipoPuesto } from '../data/clasificacion-puestos.js';
import { CODIGOS_EXCLUIDOS_AUSENTISMO } from './presentismo-indicadores.js';

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
  contenedor.innerHTML = '<div class="pres__loading">Cargando…</div>';

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
  let filtroEmpresa = '';

  contenedor.innerHTML = `
    <div class="nov__wrap">
      <div class="nov__barra">
        <div class="nov__nav">
          <button class="nov__nav-btn" id="nov-prev" type="button" aria-label="Día anterior">‹</button>
          <div class="nov__fecha-box">
            <span class="nov__fecha-titulo" id="nov-fecha-titulo"></span>
            <input type="date" class="nov__fecha-input" id="nov-fecha-input" min="${minFecha}" max="${maxFecha}">
          </div>
          <button class="nov__nav-btn" id="nov-next" type="button" aria-label="Día siguiente">›</button>
        </div>
        <div class="plantel__empresa-pills" role="group" aria-label="Filtrar por empresa" id="nov-pills-emp"></div>
      </div>
      <div id="nov-contenido"><div class="pres__loading">Cargando…</div></div>
    </div>
  `;

  const tituloEl   = contenedor.querySelector('#nov-fecha-titulo');
  const inputFecha = contenedor.querySelector('#nov-fecha-input');
  const contenido  = contenedor.querySelector('#nov-contenido');
  const pillsEmp   = contenedor.querySelector('#nov-pills-emp');

  function renderPills() {
    pillsEmp.innerHTML = `
      <button class="plantel__pill${!filtroEmpresa ? ' plantel__pill--activo' : ''}" data-empresa="">Todas</button>
      <button class="plantel__pill plantel__pill--cimomet${filtroEmpresa === 'CIMOMET' ? ' plantel__pill--activo' : ''}" data-empresa="CIMOMET">Cimomet</button>
      <button class="plantel__pill plantel__pill--comoing${filtroEmpresa === 'COMOING' ? ' plantel__pill--activo' : ''}" data-empresa="COMOING">Co.mo.ing</button>
    `;
    pillsEmp.querySelectorAll('[data-empresa]').forEach(btn => {
      btn.addEventListener('click', () => { filtroEmpresa = btn.dataset.empresa; renderPills(); render(); });
    });
  }
  renderPills();

  function irA(fecha) {
    if (fecha < minFecha || fecha > maxFecha) return;
    diaActual = fecha;
    cargarYRender();
  }

  contenedor.querySelector('#nov-prev').addEventListener('click', () => irA(sumarDias(diaActual, -1)));
  contenedor.querySelector('#nov-next').addEventListener('click', () => irA(sumarDias(diaActual, 1)));
  inputFecha.addEventListener('change', () => { if (inputFecha.value) irA(inputFecha.value); });

  // Flechas de teclado — solo cuando el foco no está en un input (para no romper el date picker).
  const onKeydown = e => {
    if (document.activeElement === inputFecha) return;
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

  cargarYRender();
}

const GRUPO_LABEL = { quincenal: 'Personal de taller — Quincenales', mensual: 'Personal administrativo — Mensuales', sin_asignar: 'Sin clasificar (puesto sin asignar en Parametrización)' };
const GRUPO_COLOR = { quincenal: 'var(--color-primario)', mensual: '#0d9488', sin_asignar: '#94a3b8' };

// ── Lógica de armado de las novedades del día ────────────────────────────────
function construirNovedades({ tardanzas, detalle, roster }, filtroEmpresa, mapaAusencias, empMap) {
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
  if (!hayAlgo) {
    return `<div class="pres__vacio">Sin novedades registradas para este día${filtroEmpresa ? ` (${EMP_LABEL[filtroEmpresa]})` : ''}.</div>`;
  }

  const grupos = ['quincenal', 'mensual', 'sin_asignar'].filter(g =>
    tardeG[g].length || tempranoG[g].length || faltasG[g].length || extraG[g].length || licenciasG[g].length
  );

  return grupos.map(g => bloqueGrupo(g, {
    tarde: tardeG[g], temprano: tempranoG[g], faltas: faltasG[g], horasExtra: extraG[g], licencias: licenciasG[g],
  })).join('');

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
        <span class="nov__fila-nombre">${eP(nombreDe(f.persona, f.legajo))}</span>
        <span class="nov__fila-emp nov__fila-emp--${(f.empresa || '').toLowerCase()}">${f.empresa ? EMP_LABEL[f.empresa] : '—'}</span>
        <span class="nov__fila-dep">${eP(f.persona?.departamento || '—')}</span>
        <div class="nov__fila-extra">${extraHtml}</div>
      </div>
    `;
  }
}

function seccion(titulo, cantidad, filasHtml, nota) {
  if (!cantidad) return '';
  return `
    <div class="nov__seccion">
      <div class="nov__seccion-titulo">${titulo} <span class="nov__seccion-cnt">${cantidad}</span></div>
      ${nota ? `<div class="nov__seccion-nota">${nota}</div>` : ''}
      <div class="nov__lista">${filasHtml.join('')}</div>
    </div>
  `;
}
