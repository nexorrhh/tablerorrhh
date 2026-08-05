// Horas y Presentismo → Horas por OT.
// Carga el reporte "Capataz" (Gestión Personalizada PCP) y arma un informe de horas
// con/sin Orden de Trabajo, con desglose Mes → OT → Tarea.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';

const HDR    = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
const HDR_JSON = { ...HDR, 'Content-Type': 'application/json', Prefer: 'return=minimal' };

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const MESES_CORTO = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const SIN_OT = '__SIN_OT__';

function eP(s) { return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function fmtPeriodo(p) { const [y, m] = p.split('-'); return `${MESES[+m - 1]} ${y}`; }
function fmtPeriodoCorto(p) { const [y, m] = p.split('-'); return `${MESES_CORTO[+m - 1]} ${y}`; }
function fmtNum(n) { return Math.round(n || 0).toLocaleString('es-AR'); }
function pct(a, b) { return b > 0 ? Math.round(a / b * 100) : 0; }

// Convierte serial de fecha Excel a YYYY-MM-DD
function serialAFecha(serial) {
  const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
  return d.toISOString().slice(0, 10);
}

// Supabase/PostgREST trunca en 1000 filas por request sin avisar — paginar hasta agotar.
async function fetchTodasFilas(url) {
  const PAGE = 1000;
  let offset = 0, out = [];
  for (;;) {
    const sep = url.includes('?') ? '&' : '?';
    const r = await fetch(`${url}${sep}limit=${PAGE}&offset=${offset}`, { headers: HDR });
    if (!r.ok) break;
    const rows = await r.json();
    out = out.concat(rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

// Legajos de Capataz que en realidad son una entidad (empresa/vehículo) y no una persona:
// sus "horas" son costeo agregado, no tiempo de nadie. Se identifican porque el nombre no
// tiene el formato "Apellido, Nombre" (no tiene coma) — a diferencia de cualquier empleado real.
function esEntidadNoPersona(nombre) {
  return !String(nombre || '').includes(',');
}

// Ningún empleado puede trabajar más de este número de horas en un solo día. Por encima de
// esto, la fila de Capataz es una carga acumulada (costeo de proyecto, uso de vehículo, etc.),
// no horas de asistencia de ese día puntual — se guarda pero se excluye de los totales.
const UMBRAL_HORAS_ANOMALAS = 16;

// Comoing usa en Capataz el mismo legajo que en Tango pero corrido +13000 (ej. legajo Tango 62
// = legajo Capataz 13062 = Riquelme, Víctor Hugo, verificado por nombre). Cimomet usa el mismo
// legajo en los dos sistemas. Sin este ajuste, el legajo de Comoing nunca matchea contra Tango.
function empresaYLegajo(legajoCapataz) {
  if (legajoCapataz >= 13000 && legajoCapataz <= 13999) {
    return { empresa: 'COMOING', legajo: legajoCapataz - 13000 };
  }
  return { empresa: 'CIMOMET', legajo: legajoCapataz };
}

// ── Parser del archivo "Capataz" ──────────────────────────────────────────────
function parsearExcelOT(buffer) {
  if (typeof XLSX === 'undefined') throw new Error('SheetJS no disponible. Recargá la página.');

  const wb = XLSX.read(buffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const filas = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (filas.length < 2) throw new Error('El archivo no tiene datos suficientes');

  const headers = filas[0].map(h => String(h).trim());
  const col = name => headers.findIndex(h => h.toLowerCase() === name.toLowerCase());
  const C = {
    legajo: col('legajo'), nombre: col('nombre'), horas: col('HS'),
    fecha: col('fecha_ini'), mes: col('mes'), quin: col('Quin'),
    opCod: col('n_operacio'), operacion: col('opercacion'), productiva: col('productiva'),
    proyNum: col('num_proye'), proyNom: col('nom_proy'), cliente: col('cliente'),
    tComp: col('t_comp'), nOt: col('n_ot'),
  };
  const faltantes = Object.entries(C).filter(([, v]) => v === -1).map(([k]) => k);
  if (faltantes.length) throw new Error(`Columnas no encontradas: ${faltantes.join(', ')}`);

  const filasOut = [];
  let entidadesExcluidas = 0;
  let anomalias = 0;
  for (let i = 1; i < filas.length; i++) {
    const f = filas[i];
    const nombreCapataz = String(f[C.nombre] ?? '').trim() || null;
    if (esEntidadNoPersona(nombreCapataz)) { entidadesExcluidas++; continue; }

    const legajoCapataz = +String(f[C.legajo] ?? '').trim() || null;
    const horas  = +f[C.horas] || 0;
    if (!horas || !legajoCapataz) continue;
    const { empresa, legajo } = empresaYLegajo(legajoCapataz);

    const mesRaw = String(f[C.mes] ?? '').trim();
    if (mesRaw.length < 6) continue;
    const anio = +mesRaw.slice(0, 4), mesNum = +mesRaw.slice(4, 6);
    if (!anio || !mesNum) continue;
    const periodo = `${anio}-${String(mesNum).padStart(2, '0')}-01`;

    const fechaSerial = f[C.fecha];
    const fecha = typeof fechaSerial === 'number' ? serialAFecha(fechaSerial) : null;

    const tComp = String(f[C.tComp] ?? '').trim();
    // n_ot viene con ceros a la izquierda (ej. "000000000550") — se recorta al número real de OT.
    const otRaw = String(f[C.nOt] ?? '').trim();
    const ot = tComp === 'O/T' ? (otRaw.replace(/^0+(?=\d)/, '') || null) : null;

    const anomalo = horas > UMBRAL_HORAS_ANOMALAS;
    if (anomalo) anomalias++;

    filasOut.push({
      periodo, fecha,
      quincena:          String(f[C.quin] ?? '').trim() || null,
      empresa,
      legajo,
      nombre:            nombreCapataz,
      operacion_codigo:  String(f[C.opCod] ?? '').trim() || null,
      operacion:         String(f[C.operacion] ?? '').trim() || 'SIN OPERACIÓN',
      productiva:        ['1', 'true'].includes(String(f[C.productiva] ?? '').trim().toLowerCase()),
      proyecto_num:      String(f[C.proyNum] ?? '').trim() || null,
      proyecto_nombre:   String(f[C.proyNom] ?? '').trim() || null,
      cliente:           String(f[C.cliente] ?? '').trim() || null,
      tipo_comprobante:  tComp || null,
      ot,
      horas,
      anomalo,
    });
  }
  if (!filasOut.length) throw new Error('No se encontraron filas válidas en el archivo');
  return { filas: filasOut, entidadesExcluidas, anomalias };
}

async function guardarEnSupabase(filas) {
  const periodos = [...new Set(filas.map(f => f.periodo))];
  // Reemplazar por período — no acumula duplicados si se vuelve a subir el mismo mes.
  await fetch(`${SUPABASE_URL}/rest/v1/horas_ot_detalle?periodo=in.(${periodos.join(',')})`, {
    method: 'DELETE', headers: HDR,
  });
  const BATCH = 500;
  for (let i = 0; i < filas.length; i += BATCH) {
    const lote = filas.slice(i, i + BATCH);
    const r = await fetch(`${SUPABASE_URL}/rest/v1/horas_ot_detalle`, {
      method: 'POST', headers: HDR_JSON, body: JSON.stringify(lote),
    });
    if (!r.ok) throw new Error(`Error al guardar (HTTP ${r.status})`);
  }
}

const SELECT_OT = 'periodo,fecha,legajo,empresa,nombre,operacion,proyecto_nombre,cliente,ot,horas,anomalo';

// Las filas anómalas (>16h en un día, ver UMBRAL_HORAS_ANOMALAS) se guardan en la base para
// no perder el dato, pero se excluyen acá de todo el informe — no son horas de asistencia
// reales de ese día. Quedan visibles en Horas y Presentismo → Cruce de Horas.
async function cargarFilasOT() {
  const rows = await fetchTodasFilas(`${SUPABASE_URL}/rest/v1/horas_ot_detalle?select=${SELECT_OT}&order=periodo.asc`);
  return rows.filter(f => !f.anomalo);
}

// ── Componente principal ──────────────────────────────────────────────────────
export async function renderizarHorasOT(contenedor) {
  contenedor.innerHTML = '<div class="pres__loading">Cargando…</div>';

  let filas = [];
  try {
    filas = await cargarFilasOT();
  } catch {
    contenedor.innerHTML = `<div class="pres__vacio">No se pudieron cargar los datos.</div>`;
    return;
  }

  let mostrarCarga  = filas.length === 0;
  let periodoActivo = null;
  let vistaOT       = null; // null = nivel "por OT"; string = nivel "por tarea" dentro de esa OT (o SIN_OT)
  let datosParseados = null;
  // Declarado acá (no más abajo, junto a dibujarGrafico) porque el primer render() —un par
  // de líneas más abajo— ya puede llamar a dibujarGrafico si hay datos cargados, y una
  // declaración `let` más tardía en el mismo scope revienta con "no se puede acceder antes
  // de la inicialización" (temporal dead zone) apenas hay algún período con datos.
  let chartActivo = null;

  function periodos() { return [...new Set(filas.map(f => f.periodo))].sort(); }

  function filasDelPeriodo(p) { return filas.filter(f => f.periodo === p); }

  function totalesPeriodo(p) {
    const fs = filasDelPeriodo(p);
    const conOT = fs.filter(f => f.ot != null).reduce((s, f) => s + f.horas, 0);
    const total = fs.reduce((s, f) => s + f.horas, 0);
    return { total, conOT, sinOT: total - conOT };
  }

  function otsDelPeriodo(p) {
    const mapa = new Map(); // ot -> { horas, cliente, proyecto }
    filasDelPeriodo(p).filter(f => f.ot != null).forEach(f => {
      if (!mapa.has(f.ot)) mapa.set(f.ot, { horas: 0, cliente: f.cliente, proyecto: f.proyecto_nombre });
      const x = mapa.get(f.ot);
      x.horas += f.horas;
      if (!x.cliente && f.cliente) x.cliente = f.cliente;
      if (!x.proyecto && f.proyecto_nombre) x.proyecto = f.proyecto_nombre;
    });
    return [...mapa.entries()].map(([ot, v]) => ({ ot, ...v })).sort((a, b) => b.horas - a.horas);
  }

  function tareasDe(p, ot) {
    const fs = filasDelPeriodo(p).filter(f => (ot === SIN_OT ? f.ot == null : f.ot === ot));
    const mapa = new Map();
    fs.forEach(f => mapa.set(f.operacion, (mapa.get(f.operacion) || 0) + f.horas));
    return [...mapa.entries()].map(([operacion, horas]) => ({ operacion, horas })).sort((a, b) => b.horas - a.horas);
  }

  render();

  // ── Render principal ─────────────────────────────────────────────────────
  function render() {
    const pers = periodos();
    if (!periodoActivo || !pers.includes(periodoActivo)) periodoActivo = pers[pers.length - 1] || null;

    const totalGeneral = filas.reduce((s, f) => s + f.horas, 0);
    const conOTGeneral  = filas.filter(f => f.ot != null).reduce((s, f) => s + f.horas, 0);
    const sinOTGeneral  = totalGeneral - conOTGeneral;
    const otsActivas    = new Set(filas.filter(f => f.ot != null).map(f => f.ot)).size;

    contenedor.innerHTML = `
      <div class="pres__personas-wrap">
        ${cargaHtml()}
        ${pers.length ? informeHtml(pers, totalGeneral, conOTGeneral, sinOTGeneral, otsActivas) : ''}
      </div>
    `;

    wireCarga();
    if (pers.length) {
      wireInforme(pers);
      dibujarGrafico(pers);
    }
  }

  // ── Zona de carga ─────────────────────────────────────────────────────────
  function cargaHtml() {
    const hayDatos = periodos().length > 0;
    return `
      <div class="hot__carga ${hayDatos && !mostrarCarga ? 'hot__carga--colapsada' : ''}">
        ${hayDatos ? `
          <button class="hot__carga-toggle" id="hot-toggle-carga">
            ${mostrarCarga ? '✕ Cerrar' : '⬆ Cargar otro mes'}
          </button>` : ''}
        <div id="hot-carga-cuerpo" ${hayDatos && !mostrarCarga ? 'hidden' : ''}>
          <div class="pres__carga-cabecera">
            <h2 class="pres__titulo">Cargar horas por OT</h2>
            <p class="pres__subtitulo">Seleccioná el archivo <strong>"Capataz"</strong> (Gestión Personalizada PCP) exportado en formato <strong>.xlsx</strong>.</p>
          </div>
          <div class="pres__carga-zona" id="hot-zona">
            <input type="file" id="hot-file" accept=".xlsx,.xls" class="pres__file-input">
            <label for="hot-file" class="pres__file-label">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              <span>Hacé clic para seleccionar el archivo</span>
              <span class="pres__file-hint">.xlsx exportado desde PCP</span>
            </label>
          </div>
          <div id="hot-estado" class="pres__estado" style="display:none"></div>
          <div id="hot-preview" style="display:none"></div>
        </div>
      </div>
    `;
  }

  function wireCarga() {
    contenedor.querySelector('#hot-toggle-carga')?.addEventListener('click', () => {
      mostrarCarga = !mostrarCarga;
      render();
    });

    const zonaDiv = contenedor.querySelector('#hot-zona');
    const fileInput = contenedor.querySelector('#hot-file');
    const estadoDiv = contenedor.querySelector('#hot-estado');
    const previewDiv = contenedor.querySelector('#hot-preview');
    if (!zonaDiv) return;

    zonaDiv.addEventListener('dragover', e => { e.preventDefault(); zonaDiv.classList.add('pres__carga-zona--drag'); });
    zonaDiv.addEventListener('dragleave', () => zonaDiv.classList.remove('pres__carga-zona--drag'));
    zonaDiv.addEventListener('drop', e => {
      e.preventDefault();
      zonaDiv.classList.remove('pres__carga-zona--drag');
      const f = e.dataTransfer.files[0];
      if (f) procesarArchivo(f);
    });
    fileInput.addEventListener('change', e => { if (e.target.files[0]) procesarArchivo(e.target.files[0]); });

    async function procesarArchivo(file) {
      estadoDiv.style.display = 'block';
      estadoDiv.innerHTML = '<div class="pres__leyendo">Leyendo archivo...</div>';
      previewDiv.style.display = 'none';
      datosParseados = null;

      try {
        const buf = await file.arrayBuffer();
        datosParseados = parsearExcelOT(new Uint8Array(buf));
        mostrarPreview();
      } catch (err) {
        estadoDiv.innerHTML = `<div class="pres__msg-error">Error al leer el archivo: ${eP(err.message)}</div>`;
      }
    }

    function mostrarPreview() {
      const { filas: filasParseadas, entidadesExcluidas, anomalias } = datosParseados;
      const periodosArchivo = [...new Set(filasParseadas.map(f => f.periodo))].sort();
      const validas = filasParseadas.filter(f => !f.anomalo);
      const total = validas.reduce((s, f) => s + f.horas, 0);
      const conOT = validas.filter(f => f.ot != null).reduce((s, f) => s + f.horas, 0);
      const ots   = new Set(validas.filter(f => f.ot != null).map(f => f.ot));

      estadoDiv.innerHTML = `
        <div class="pres__msg-ok">
          ✓ Archivo leído correctamente — <strong>${periodosArchivo.map(fmtPeriodo).join(', ')}</strong>
        </div>
      `;

      previewDiv.style.display = 'block';
      previewDiv.innerHTML = `
        <div class="pres__preview-kpis">
          <div class="pres__preview-kpi">
            <span class="pres__preview-kpi-num">${fmtNum(validas.length)}</span>
            <span class="pres__preview-kpi-lbl">registros</span>
          </div>
          <div class="pres__preview-kpi">
            <span class="pres__preview-kpi-num">${fmtNum(total)}h</span>
            <span class="pres__preview-kpi-lbl">horas totales</span>
          </div>
          <div class="pres__preview-kpi">
            <span class="pres__preview-kpi-num">${pct(conOT, total)}%</span>
            <span class="pres__preview-kpi-lbl">con OT</span>
          </div>
          <div class="pres__preview-kpi">
            <span class="pres__preview-kpi-num">${ots.size}</span>
            <span class="pres__preview-kpi-lbl">OTs distintas</span>
          </div>
        </div>

        ${anomalias ? `
        <div class="pres__aviso-parcial">
          <strong>Aviso:</strong> ${anomalias} fila${anomalias > 1 ? 's' : ''} con más de ${UMBRAL_HORAS_ANOMALAS}h
          cargadas en un solo día (parecen costeo acumulado de proyecto, no horas de ese día puntual).
          Se van a guardar pero excluidas de los totales — quedan disponibles en la solapa Cruce de Horas.
        </div>` : ''}
        ${entidadesExcluidas ? `
        <div class="pres__aviso-parcial">
          ${entidadesExcluidas} fila${entidadesExcluidas > 1 ? 's' : ''} descartada${entidadesExcluidas > 1 ? 's' : ''}
          por corresponder a una entidad (vehículo/empresa) y no a una persona — no se van a guardar.
        </div>` : ''}

        <div class="pres__carga-acciones">
          <button class="pres__btn-cancelar" id="hot-cancelar" type="button">Cancelar</button>
          <button class="pres__btn-confirmar" id="hot-confirmar" type="button">
            Guardar datos de ${periodosArchivo.map(fmtPeriodo).join(', ')}
          </button>
        </div>
      `;

      previewDiv.querySelector('#hot-cancelar').addEventListener('click', () => {
        previewDiv.style.display = 'none';
        estadoDiv.style.display  = 'none';
        fileInput.value = '';
        datosParseados  = null;
      });
      previewDiv.querySelector('#hot-confirmar').addEventListener('click', confirmarCarga);
    }

    async function confirmarCarga() {
      if (!datosParseados) return;
      const btnOk  = previewDiv.querySelector('#hot-confirmar');
      const btnCan = previewDiv.querySelector('#hot-cancelar');
      btnOk.disabled = true; btnCan.disabled = true;
      btnOk.textContent = 'Guardando…';

      try {
        await guardarEnSupabase(datosParseados.filas);
        filas = await cargarFilasOT();
        mostrarCarga = false;
        periodoActivo = null;
        vistaOT = null;
        render();
      } catch (err) {
        btnOk.disabled = false; btnCan.disabled = false;
        btnOk.textContent = 'Reintentar';
        estadoDiv.innerHTML = `<div class="pres__msg-error">Error al guardar: ${eP(err.message)}</div>`;
      }
    }
  }

  // ── Informe visual ────────────────────────────────────────────────────────
  function informeHtml(pers, totalGeneral, conOTGeneral, sinOTGeneral, otsActivas) {
    return `
      <section class="pind__sec" style="margin-top:var(--espacio-m)">
        <div class="pind__kpis">
          <div class="pind__kpi">
            <span class="pind__kpi-num">${fmtNum(totalGeneral)}h</span>
            <span class="pind__kpi-lbl">Total de horas</span>
            <span class="pind__kpi-sub">${fmtPeriodoCorto(pers[0])} – ${fmtPeriodoCorto(pers[pers.length - 1])}</span>
          </div>
          <div class="pind__kpi">
            <span class="pind__kpi-num" style="color:#185FA5">${fmtNum(conOTGeneral)}h</span>
            <span class="pind__kpi-lbl">Con OT</span>
            <span class="pind__kpi-sub">${pct(conOTGeneral, totalGeneral)}% del total</span>
          </div>
          <div class="pind__kpi">
            <span class="pind__kpi-num" style="color:#E07B39">${fmtNum(sinOTGeneral)}h</span>
            <span class="pind__kpi-lbl">Sin OT</span>
            <span class="pind__kpi-sub">${pct(sinOTGeneral, totalGeneral)}% del total</span>
          </div>
          <div class="pind__kpi">
            <span class="pind__kpi-num">${otsActivas}</span>
            <span class="pind__kpi-lbl">OTs activas</span>
            <span class="pind__kpi-sub">en todo el período</span>
          </div>
        </div>

        <div class="hot__graf-wrap">
          <canvas id="hot-chart" height="90"></canvas>
        </div>

        <div class="pind__grupo-header" style="margin-top:var(--espacio-l)">
          <div class="pind__grupo-header-izq">
            <h2 class="pind__grupo-titulo">Desglose</h2>
          </div>
          <select class="pind__per-filtro" id="hot-per-sel">
            ${[...pers].reverse().map(p => `<option value="${p}" ${p === periodoActivo ? 'selected' : ''}>${fmtPeriodo(p)}</option>`).join('')}
          </select>
        </div>

        <div id="hot-panel">${panelHtml()}</div>
      </section>
    `;
  }

  function panelHtml() {
    if (!periodoActivo) return '';
    if (vistaOT == null) return panelOTsHtml();
    return panelTareasHtml();
  }

  function panelOTsHtml() {
    const { total, conOT, sinOT } = totalesPeriodo(periodoActivo);
    const ots = otsDelPeriodo(periodoActivo);
    const maxV = Math.max(sinOT, ...ots.map(o => o.horas), 1);

    const filaSinOT = sinOT > 0 ? `
      <div class="hot__row" data-ot="${SIN_OT}">
        <div class="hot__row-main">
          <span class="hot__pill hot__pill--sin">Sin OT</span>
          <div class="pind__bar-cell"><div class="pind__bar-fill" style="width:${pct(sinOT, maxV)}%;background:#E07B39"></div></div>
        </div>
        <div class="hot__row-val">
          <span class="hot__row-hs">${fmtNum(sinOT)}h</span>
          <span class="hot__row-pct">${pct(sinOT, total)}%</span>
        </div>
      </div>` : '';

    const filasOT = ots.map(o => `
      <div class="hot__row" data-ot="${eP(o.ot)}">
        <div class="hot__row-main">
          <span class="hot__pill hot__pill--ot">OT ${eP(o.ot)}</span>
          ${o.cliente || o.proyecto ? `<span class="hot__row-sub">${eP(o.proyecto || '')}${o.proyecto && o.cliente ? ' · ' : ''}${eP(o.cliente || '')}</span>` : ''}
          <div class="pind__bar-cell"><div class="pind__bar-fill" style="width:${pct(o.horas, maxV)}%;background:#185FA5"></div></div>
        </div>
        <div class="hot__row-val">
          <span class="hot__row-hs">${fmtNum(o.horas)}h</span>
          <span class="hot__row-pct">${pct(o.horas, total)}%</span>
        </div>
      </div>`).join('');

    return `
      <p class="hot__crumb"><span class="hot__crumb-activo">${fmtPeriodo(periodoActivo)}</span></p>
      <p class="hot__sec-hdr">Desglose por OT — clic para ver las tareas</p>
      ${filaSinOT}${filasOT}
      <div class="hot__pie">
        <span>${ots.length} OT${ots.length !== 1 ? 's' : ''} activa${ots.length !== 1 ? 's' : ''} este período</span>
        <span class="hot__pie-tot">Total ${fmtNum(total)}h</span>
      </div>
    `;
  }

  function panelTareasHtml() {
    const esSinOT = vistaOT === SIN_OT;
    const tareas = tareasDe(periodoActivo, vistaOT);
    const total = tareas.reduce((s, t) => s + t.horas, 0);
    const maxV = tareas[0]?.horas || 1;
    const { cliente, proyecto } = (() => {
      if (esSinOT) return {};
      const o = otsDelPeriodo(periodoActivo).find(x => x.ot === vistaOT);
      return { cliente: o?.cliente, proyecto: o?.proyecto };
    })();

    return `
      <p class="hot__crumb">
        <span class="hot__crumb-link" data-volver="1">${fmtPeriodo(periodoActivo)}</span>
        <span class="hot__crumb-sep">›</span>
        <span class="hot__crumb-activo">${esSinOT ? 'Sin OT' : 'OT ' + eP(vistaOT)}</span>
      </p>
      ${!esSinOT && (cliente || proyecto) ? `<p class="hot__sub">${eP(proyecto || '')}${proyecto && cliente ? ' · ' : ''}${eP(cliente || '')}</p>` : ''}
      <p class="hot__sec-hdr">Tareas que insumieron horas</p>
      ${tareas.map((t, i) => `
        <div class="hot__row hot__row--static">
          <div class="hot__row-main">
            <span class="hot__dot" style="background:${DOT_COLORS[i % DOT_COLORS.length]}"></span>
            <span class="hot__row-txt">${eP(t.operacion)}</span>
            <div class="pind__bar-cell"><div class="pind__bar-fill" style="width:${pct(t.horas, maxV)}%;background:${DOT_COLORS[i % DOT_COLORS.length]}"></div></div>
          </div>
          <div class="hot__row-val">
            <span class="hot__row-hs">${fmtNum(t.horas)}h</span>
            <span class="hot__row-pct">${pct(t.horas, total)}%</span>
          </div>
        </div>`).join('')}
      <div class="hot__pie">
        <span>${tareas.length} tarea${tareas.length !== 1 ? 's' : ''}</span>
        <span class="hot__pie-tot">Total ${fmtNum(total)}h</span>
      </div>
    `;
  }

  function wireInforme(pers) {
    const sel = contenedor.querySelector('#hot-per-sel');
    sel?.addEventListener('change', () => {
      periodoActivo = sel.value;
      vistaOT = null;
      contenedor.querySelector('#hot-panel').innerHTML = panelHtml();
      wirePanel();
      dibujarGrafico(pers);
    });
    wirePanel();
  }

  function wirePanel() {
    const panel = contenedor.querySelector('#hot-panel');
    if (!panel) return;
    panel.querySelectorAll('[data-ot]').forEach(row => {
      row.addEventListener('click', () => {
        vistaOT = row.dataset.ot;
        panel.innerHTML = panelHtml();
        wirePanel();
      });
    });
    panel.querySelector('[data-volver]')?.addEventListener('click', () => {
      vistaOT = null;
      panel.innerHTML = panelHtml();
      wirePanel();
    });
  }

  function dibujarGrafico(pers) {
    const canvas = contenedor.querySelector('#hot-chart');
    if (!canvas || typeof Chart === 'undefined') return;
    if (chartActivo) { chartActivo.destroy(); chartActivo = null; }

    const sinOT = pers.map(p => totalesPeriodo(p).sinOT);
    const conOT = pers.map(p => totalesPeriodo(p).conOT);
    const idxActivo = pers.indexOf(periodoActivo);

    chartActivo = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: pers.map(fmtPeriodoCorto),
        datasets: [
          { label: 'Sin OT', data: sinOT, backgroundColor: pers.map((_, i) => i === idxActivo ? '#E07B39' : '#fce4a8'), stack: 's', borderSkipped: 'top' },
          { label: 'Con OT', data: conOT, backgroundColor: pers.map((_, i) => i === idxActivo ? '#185FA5' : '#b5d4f4'), stack: 's', borderRadius: 4, borderSkipped: 'bottom' },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 12 } },
          tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmtNum(c.parsed.y)}h` } },
        },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, ticks: { callback: v => v >= 1000 ? (v / 1000) + 'K' : v }, grid: { color: 'rgba(0,0,0,0.06)' } },
        },
        onClick: (_, els) => {
          if (!els.length) return;
          periodoActivo = pers[els[0].index];
          vistaOT = null;
          const sel = contenedor.querySelector('#hot-per-sel');
          if (sel) sel.value = periodoActivo;
          contenedor.querySelector('#hot-panel').innerHTML = panelHtml();
          wirePanel();
          dibujarGrafico(pers);
        },
      },
    });
  }
}

const DOT_COLORS = ['#185FA5', '#0F6E56', '#854F0B', '#4a3aa7', '#993C1D', '#028090', '#3B6D11', '#993556', '#5F5E5A'];
