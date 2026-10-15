// Horas y Presentismo → Fichadas del día.
// Lee el archivo de fichadas que se baja del reloj biométrico (.txt, formato
// "Nombre,Apellido;legajoReloj;DD/MM/AAAA;HH:MM", una línea por marcación) y arma al
// instante un informe de quién llegó, a qué hora entró y quién todavía no fichó — para
// que RRHH pueda revisarlo a media mañana y citar a los que llegaron tarde.
//
// A propósito NO se guarda nada en Supabase: es una foto del momento, se rearma cada vez
// que se sube el archivo y no queda historial. El seguimiento de tardanzas repetidas en
// el tiempo ya lo cubre "Ficha individual" / "Por persona" con los datos que vienen de Tango.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';
import { obtenerClasificacionPuestos, tipoPuesto } from '../data/clasificacion-puestos.js';
import { obtenerExentosFichada } from '../data/fichadas-exentos.js';

const HDR = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };

const TIPO_LABEL   = { quincenal: 'Quincenales — Personal de taller', mensual: 'Mensuales — Personal administrativo' };
const ESTADO_LABEL = { a_tiempo: 'A tiempo', tarde: 'Tarde', sin_fichar: 'No fichó' };
const UMBRAL_KEY    = { quincenal: 'rrhh_fichadas_umbral_quincenal', mensual: 'rrhh_fichadas_umbral_mensual' };
const UMBRAL_DEFAULT = { quincenal: '07:00', mensual: '08:00' };

function eP(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function normNombre(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean).sort().join(' ');
}

function leerUmbrales() {
  const u = { ...UMBRAL_DEFAULT };
  try {
    for (const tipo of ['quincenal', 'mensual']) {
      const v = localStorage.getItem(UMBRAL_KEY[tipo]);
      if (v && /^\d{2}:\d{2}$/.test(v)) u[tipo] = v;
    }
  } catch {}
  return u;
}
function guardarUmbral(tipo, valor) {
  try { localStorage.setItem(UMBRAL_KEY[tipo], valor); } catch {}
}

// ── Parseo del archivo del reloj ──────────────────────────────────────────────
function parsearFichadas(texto) {
  const eventos = [];
  texto.split(/\r?\n/).forEach(linea => {
    const l = linea.trim();
    if (!l) return;
    const partes = l.split(';');
    if (partes.length < 4) return;
    const nombreCrudo = partes[0].trim();
    const legajoReloj = partes[1].trim();
    const mFecha = partes[2].trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    const hora = partes[3].trim();
    if (!nombreCrudo || !legajoReloj || !mFecha || !/^\d{2}:\d{2}$/.test(hora)) return;
    const [, dd, mm, aaaa] = mFecha;
    eventos.push({ nombreCrudo, legajoReloj, fecha: `${aaaa}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`, hora });
  });
  if (!eventos.length) throw new Error('No se encontró ninguna fichada reconocible en el archivo. Verificá que sea el .txt que exporta el reloj.');
  return eventos;
}

// El archivo normalmente trae un solo día, pero por las dudas nos quedamos con el que
// tiene más marcaciones (si hubiera alguna línea suelta de otro día, no lo arrastra).
function fechaPredominante(eventos) {
  const conteo = new Map();
  eventos.forEach(e => conteo.set(e.fecha, (conteo.get(e.fecha) || 0) + 1));
  return [...conteo.entries()].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0][0];
}

// Pasado el mediodía ninguna marca puede ser una entrada real (nadie entra a las 16hs) — si
// la más temprana del día ya es de la tarde, es la salida y a la persona simplemente no le
// quedó registrada la entrada. Mejor tratarla como "no fichó" que mostrar una hora imposible.
const CORTE_MEDIODIA = '12:00';

// Primera marcación del día por legajo del reloj = hora de entrada (se ignoran las
// marcaciones de salida y los duplicados, que sólo importan para armar la hora mínima).
function primerasFichadas(eventos, fecha) {
  const porLegajoReloj = new Map();
  eventos.filter(e => e.fecha === fecha).forEach(e => {
    const actual = porLegajoReloj.get(e.legajoReloj);
    if (!actual || e.hora < actual.hora) porLegajoReloj.set(e.legajoReloj, e);
  });
  return [...porLegajoReloj.values()].filter(e => e.hora < CORTE_MEDIODIA);
}

// ── Matcheo contra el plantel ──────────────────────────────────────────────────
// El reloj numera a la gente de taller/planta con su legajo real de Tango (coincide
// directo), pero a buena parte del resto le asigna un ID propio que no tiene relación
// con el legajo de Tango — para esos, la única forma de identificarlos es por nombre.
function construirIndices(empleados) {
  const porLegajo = new Map();
  empleados.forEach(e => {
    const k = String(e.legajo);
    if (!porLegajo.has(k)) porLegajo.set(k, []);
    porLegajo.get(k).push(e);
  });
  const porNombre = new Map();
  empleados.forEach(e => {
    const k = normNombre(e.apellido_y_nombre);
    if (k && !porNombre.has(k)) porNombre.set(k, e);
  });
  return { porLegajo, porNombre };
}

function matchearPersona(ev, indices) {
  const candidatos = indices.porLegajo.get(ev.legajoReloj) || [];
  if (candidatos.length === 1) return candidatos[0];
  const nombreNorm = normNombre(ev.nombreCrudo.replace(',', ' '));
  if (candidatos.length > 1) {
    // Mismo legajo en Cimomet y Co.mo.ing (números repetidos entre empresas) — desempatar por nombre.
    return candidatos.find(e => normNombre(e.apellido_y_nombre) === nombreNorm) || candidatos[0];
  }
  // Co.mo.ing numera su reloj como 10000 + legajo real de Tango (legajo 361 → ID de reloj
  // 10361) — confirmado por RRHH. Se prueba ANTES del matcheo por nombre porque es más preciso:
  // el reloj trae errores de tipeo en varios nombres de Co.mo.ing ("Benitez" en vez de "Benito",
  // "Gonzales" en vez de "Gonzalez"), así que el nombre no siempre alcanza para identificarlos.
  if (/^10\d{3}$/.test(ev.legajoReloj)) {
    const candidatosComoing = (indices.porLegajo.get(String(+ev.legajoReloj - 10000)) || [])
      .filter(e => e.empresa === 'COMOING');
    if (candidatosComoing.length === 1) return candidatosComoing[0];
  }
  return indices.porNombre.get(nombreNorm) || null;
}

// ── Armado del informe ──────────────────────────────────────────────────────────
function construirInforme(primeras, empleadosActivos, mapaClasif, indices, umbrales) {
  const entradaPorClave = new Map(); // "legajo|empresa" -> { hora }
  const sinIdentificar = [];
  primeras.forEach(ev => {
    const emp = matchearPersona(ev, indices);
    if (!emp) { sinIdentificar.push(ev); return; }
    // `primeras` ya viene con el mínimo por ID de reloj, pero una misma persona puede
    // aparecer bajo DOS ID de reloj distintos el mismo día (su legajo real y el
    // transformado de Co.mo.ing, por ejemplo) — acá hay que quedarse con el más
    // temprano de los dos, no con el último que se procese.
    const key = `${emp.legajo}|${emp.empresa}`;
    const actual = entradaPorClave.get(key);
    if (!actual || ev.hora < actual.hora) entradaPorClave.set(key, { hora: ev.hora });
  });

  const grupos = { quincenal: [], mensual: [] };
  empleadosActivos.forEach(emp => {
    const tipo = tipoPuesto(emp.desc_puesto, mapaClasif);
    if (tipo !== 'quincenal' && tipo !== 'mensual') return; // sin clasificar: fuera de este informe
    const reg = entradaPorClave.get(`${emp.legajo}|${emp.empresa}`);
    const estado = !reg ? 'sin_fichar' : reg.hora > umbrales[tipo] ? 'tarde' : 'a_tiempo';
    grupos[tipo].push({ ...emp, hora: reg ? reg.hora : null, estado });
  });

  const orden = { tarde: 0, a_tiempo: 1, sin_fichar: 2 };
  Object.values(grupos).forEach(lista => lista.sort((a, b) =>
    orden[a.estado] - orden[b.estado]
    || (a.hora || '').localeCompare(b.hora || '')
    || (a.apellido_y_nombre || '').localeCompare(b.apellido_y_nombre || '')
  ));

  return { grupos, sinIdentificar };
}

export async function renderizarPresentismoFichadas(contenedor) {
  contenedor.innerHTML = '<p class="plantel__cargando">Cargando plantel…</p>';

  let empleados = [], mapaClasif = new Map(), exentos = [];
  try {
    const [rE, mc, ex] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/empleados?select=legajo,apellido_y_nombre,empresa,desc_puesto,activo&limit=2000`, { headers: HDR }),
      obtenerClasificacionPuestos(),
      obtenerExentosFichada(),
    ]);
    empleados = rE.ok ? await rE.json() : [];
    mapaClasif = mc;
    exentos = ex;
  } catch (e) {
    contenedor.innerHTML = `<div class="pres__vacio">Error al cargar el plantel: ${eP(e.message)}</div>`;
    return;
  }

  // Gente que nunca va a fichar (directores, o personas puntuales por algún motivo propio)
  // no debe ensuciar el "no fichó" del informe. La lista la administra RRHH desde
  // Parametrización → Fichadas — acá solo se respeta.
  const exentosSet = new Set(exentos.map(e => `${e.legajo}|${e.empresa}`));
  const empleadosActivos = empleados.filter(e => e.activo && !exentosSet.has(`${e.legajo}|${e.empresa}`));
  const indices = construirIndices(empleados);
  let umbrales = leerUmbrales();
  let ultimoResultado = null; // { primeras, fecha } — para recalcular sin releer el archivo

  contenedor.innerHTML = `
    <div class="pres__carga-wrap">
      <div class="pres__carga-cabecera">
        <h2 class="pres__titulo">Fichadas del día</h2>
        <p class="pres__subtitulo">
          Subí el archivo de fichadas que baja del reloj (.txt) y arma al instante quién llegó,
          a qué hora, y quién todavía no fichó — pensado para el chequeo de media mañana.
          No se guarda nada acá: es una foto del momento, se rearma cada vez que subís el archivo.
        </p>
      </div>

      <div class="pres__carga-zona" id="fich-zona">
        <input type="file" id="fich-file" accept=".txt" class="pres__file-input">
        <label for="fich-file" class="pres__file-label">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          <span>Hacé clic para seleccionar el archivo</span>
          <span class="pres__file-hint">.txt exportado del reloj</span>
        </label>
      </div>

      <div id="fich-estado" class="pres__estado" style="display:none"></div>
      <div id="fich-informe"></div>
    </div>
  `;

  const fileInput  = contenedor.querySelector('#fich-file');
  const zonaDiv    = contenedor.querySelector('#fich-zona');
  const estadoDiv  = contenedor.querySelector('#fich-estado');
  const informeDiv = contenedor.querySelector('#fich-informe');

  zonaDiv.addEventListener('dragover',  e => { e.preventDefault(); zonaDiv.classList.add('pres__carga-zona--drag'); });
  zonaDiv.addEventListener('dragleave', () => zonaDiv.classList.remove('pres__carga-zona--drag'));
  zonaDiv.addEventListener('drop', e => {
    e.preventDefault();
    zonaDiv.classList.remove('pres__carga-zona--drag');
    const f = e.dataTransfer.files[0];
    if (f) procesarArchivo(f);
  });
  fileInput.addEventListener('change', e => { if (e.target.files[0]) procesarArchivo(e.target.files[0]); });

  function procesarArchivo(file) {
    estadoDiv.style.display = 'block';
    estadoDiv.innerHTML = '<div class="pres__leyendo">Leyendo archivo...</div>';
    informeDiv.innerHTML = '';
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const eventos = parsearFichadas(String(reader.result));
        const fecha = fechaPredominante(eventos);
        const primeras = primerasFichadas(eventos, fecha);
        ultimoResultado = { primeras, fecha };
        estadoDiv.style.display = 'none';
        renderInforme();
      } catch (err) {
        estadoDiv.innerHTML = `<div class="pres__msg-error">Error al leer el archivo: ${eP(err.message)}</div>`;
      }
    };
    reader.onerror = () => {
      estadoDiv.innerHTML = '<div class="pres__msg-error">No se pudo leer el archivo.</div>';
    };
    reader.readAsText(file, 'utf-8');
  }

  function fmtFechaLarga(iso) {
    const [aaaa, mm, dd] = iso.split('-');
    const d = new Date(`${iso}T00:00:00`);
    const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    return `${dias[d.getDay()]} ${dd}/${mm}/${aaaa}`;
  }

  function renderInforme() {
    if (!ultimoResultado) return;
    const { primeras, fecha } = ultimoResultado;
    const { grupos, sinIdentificar } = construirInforme(primeras, empleadosActivos, mapaClasif, indices, umbrales);

    informeDiv.innerHTML = `
      <div class="fich__resumen-top">
        <div class="fich__fecha">Fichadas del <strong>${eP(fmtFechaLarga(fecha))}</strong></div>
        <div class="fich__umbrales">
          <label>Límite quincenales <input type="time" id="fich-umbral-quincenal" value="${umbrales.quincenal}"></label>
          <label>Límite mensuales <input type="time" id="fich-umbral-mensual" value="${umbrales.mensual}"></label>
        </div>
      </div>

      ${seccionGrupo('quincenal', grupos.quincenal)}
      ${seccionGrupo('mensual', grupos.mensual)}

      ${sinIdentificar.length ? `
        <details class="fich__sin-id">
          <summary>${sinIdentificar.length} fichada${sinIdentificar.length !== 1 ? 's' : ''} sin identificar — no matchean con nadie del plantel activo</summary>
          <ul class="fich__sin-id-lista">
            ${sinIdentificar.map(e => `<li>${eP(e.nombreCrudo)} — legajo reloj ${eP(e.legajoReloj)} — ${eP(e.hora)}</li>`).join('')}
          </ul>
        </details>` : ''}
    `;

    informeDiv.querySelector('#fich-umbral-quincenal').addEventListener('change', e => {
      umbrales = { ...umbrales, quincenal: e.target.value || UMBRAL_DEFAULT.quincenal };
      guardarUmbral('quincenal', umbrales.quincenal);
      renderInforme();
    });
    informeDiv.querySelector('#fich-umbral-mensual').addEventListener('change', e => {
      umbrales = { ...umbrales, mensual: e.target.value || UMBRAL_DEFAULT.mensual };
      guardarUmbral('mensual', umbrales.mensual);
      renderInforme();
    });
  }

  function seccionGrupo(tipo, lista) {
    if (!lista.length) return '';
    // Separados a propósito: lo que necesita atención (tarde / no fichó) queda a la vista;
    // los que llegaron bien van en un desplegable aparte para no tapar lo importante.
    const problemas = lista.filter(p => p.estado !== 'a_tiempo');
    const bien      = lista.filter(p => p.estado === 'a_tiempo');
    const tarde     = lista.filter(p => p.estado === 'tarde').length;
    const sinFichar = lista.filter(p => p.estado === 'sin_fichar').length;
    return `
      <div class="fich__grupo">
        <div class="fich__grupo-header">
          <h3 class="fich__grupo-tit">${TIPO_LABEL[tipo]}</h3>
          <div class="fich__chips">
            <span class="fich__chip fich__chip--a_tiempo">${bien.length} a tiempo</span>
            <span class="fich__chip fich__chip--tarde">${tarde} tarde</span>
            <span class="fich__chip fich__chip--sin_fichar">${sinFichar} no fichó</span>
          </div>
        </div>

        ${problemas.length
          ? tablaFichadas(problemas)
          : '<p class="pres__vacio-small">Nadie llegó tarde ni quedó sin fichar 🎉</p>'}

        ${bien.length ? `
          <details class="fich__bien">
            <summary>${bien.length} a tiempo — ver</summary>
            ${tablaFichadas(bien)}
          </details>` : ''}
      </div>
    `;
  }

  function tablaFichadas(lista) {
    return `
      <div class="pres__tabla-wrap">
        <table class="pres__tabla">
          <thead><tr>
            <th class="pres__th--leg">Leg.</th>
            <th>Nombre</th>
            <th class="pres__th--dep">Sector</th>
            <th class="pres__th--num">Entrada</th>
            <th>Estado</th>
          </tr></thead>
          <tbody>
            ${lista.map(p => `
              <tr>
                <td class="pres__td--leg">${p.legajo}</td>
                <td>${eP(p.apellido_y_nombre)}</td>
                <td class="pres__td--dep">${eP(p.desc_puesto || '—')}</td>
                <td class="pres__td--num">${p.hora || '—'}</td>
                <td><span class="fich__badge fich__badge--${p.estado}">${ESTADO_LABEL[p.estado]}</span></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;
  }
}
