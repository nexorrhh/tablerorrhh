import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';
import { parsearExcelOT, guardarEnSupabase as guardarHorasOT, UMBRAL_HORAS_ANOMALAS } from './horas-ot.js';

const HDR_JSON = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=minimal',
};
const HDR_SB = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const EMPRESAS  = ['CIMOMET', 'COMOING'];
const EMP_LABEL = { CIMOMET: 'Cimomet', COMOING: 'Co.mo.ing' };

function eP(s) { return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function formatearPeriodo(p) {
  const [y, m] = p.split('-');
  return `${MESES[+m - 1]} ${y}`;
}

// Convierte serial de fecha Excel a YYYY-MM-DD
function serialAFecha(serial) {
  const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
  return d.toISOString().slice(0, 10);
}

// Parsea la hoja "Horas no trabajadas" del reporte Extenso (Tarde/Temprano por día y legajo).
// Si el archivo subido es el formato viejo (sin esa hoja), devuelve [] sin romper nada más.
function parsearTardanzas(wb) {
  const nombreHoja = wb.SheetNames.find(n => n.toLowerCase() === 'horas no trabajadas');
  if (!nombreHoja) return [];

  const ws = wb.Sheets[nombreHoja];
  const filas = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (filas.length < 2) return [];

  const headers = filas[0].map(h => String(h).trim());
  const col = name => headers.findIndex(h => h.toLowerCase() === name.toLowerCase());
  const C = {
    legajo:   col('Número de legajo'),
    fecha:    col('Fecha de parte'),
    tipo:     col('Tipo de anormalidad'),
    minutos:  col('Horas no trabajadas'),
    codJust:  col('Código de concepto de justificación'),
    descJust: col('Descripción de concepto de justificación'),
    genera:   col('Genera horas'),
    compens:  col('Compensable'),
  };
  if ([C.legajo, C.fecha, C.tipo, C.minutos].some(i => i === -1)) return [];

  // Agrupar por legajo+fecha+tipo sumando minutos, por si Tango exporta más de un bloque el mismo día.
  // 'ausente' se usa para reclasificar vacaciones no trabajadas (ver parsearExcel) además
  // de quedar guardado para poder mostrarlo como motivo en el detalle por persona.
  const acumulado = new Map();
  for (let i = 1; i < filas.length; i++) {
    const f = filas[i];
    const tipo = String(f[C.tipo] || '').trim().toLowerCase();
    if (tipo !== 'tarde' && tipo !== 'temprano' && tipo !== 'ausente') continue;

    const legajo = +f[C.legajo];
    const fechaSerial = f[C.fecha];
    if (!legajo || typeof fechaSerial !== 'number') continue;
    const fecha = serialAFecha(fechaSerial);

    const key = `${legajo}|${fecha}|${tipo}`;
    if (!acumulado.has(key)) {
      acumulado.set(key, {
        legajo, fecha, tipo, minutos: 0,
        codigo_justificacion:      C.codJust  >= 0 ? (String(f[C.codJust]  || '').trim() || null) : null,
        descripcion_justificacion: C.descJust >= 0 ? (String(f[C.descJust] || '').trim() || null) : null,
        genera_horas: C.genera  >= 0 ? String(f[C.genera]).trim()  === 'S' : null,
        compensable:  C.compens >= 0 ? String(f[C.compens]).trim() === 'S' : null,
      });
    }
    acumulado.get(key).minutos += (+f[C.minutos] || 0);
  }
  return [...acumulado.values()];
}

// Reconoce si el workbook subido es un export de Tango o de Capataz, para poder tener una
// sola zona de carga que acepte los dos. Tango siempre trae varias hojas con nombres propios
// del reporte "Extenso"/"Detalle de horas"; Capataz es un único reporte plano (PCP) con
// columnas propias (legajo, HS, fecha_ini, t_comp...) — son formatos lo bastante distintos
// como para que esto sea confiable sin pedirle nada al usuario.
function detectarTipoArchivo(wb) {
  const nombresHoja = wb.SheetNames.map(n => n.toLowerCase());
  // Mismo criterio que usa parsearExcel para encontrar su hoja: algo con "detalle" que no
  // sea el "Detalle por legajo" — cubre tanto el reporte Extenso como el simple de Tango.
  const esTango = nombresHoja.some(n =>
    n.includes('datos del parte') || n.includes('horas esperadas') || (n.includes('detalle') && !n.includes('legajo'))
  );
  if (esTango) return 'tango';

  const ws = wb.Sheets[wb.SheetNames[0]];
  const filas = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const headers = (filas[0] || []).map(h => String(h).trim().toLowerCase());
  const esCapataz = ['legajo', 'hs', 'fecha_ini', 't_comp'].every(c => headers.includes(c));
  if (esCapataz) return 'capataz';

  return null;
}

// Parsea el Excel de Tango y devuelve { mensual, detalle, tardanzas, periodo }.
// Recibe el workbook ya leído (ver detectarTipoArchivo) para no leer el archivo dos veces.
function parsearExcel(wb) {
  // Buscar hoja "Detalle de horas" (no la de "por legajo")
  const nombreHoja = wb.SheetNames.find(n => {
    const nl = n.toLowerCase();
    return nl.includes('detalle') && !nl.includes('legajo');
  }) ?? wb.SheetNames[0];

  const ws = wb.Sheets[nombreHoja];
  const filas = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (filas.length < 2) throw new Error('El archivo no tiene datos suficientes');

  const headers = filas[0].map(h => String(h).trim());
  const col = name => headers.findIndex(h => h.toLowerCase() === name.toLowerCase());
  // Prueba varios nombres posibles para la misma columna — Tango abrevia distinto
  // el "Detalle de horas" del reporte Extenso vs el reporte simple de siempre.
  const colAny = (...nombres) => {
    for (const n of nombres) {
      const idx = col(n);
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const C = {
    legajo:      col('Número de legajo'),
    apellido:    col('Apellido'),
    nombre:      col('Nombre'),
    condicion:   col('Condición'),
    dep:         col('Descripción de departamento'),
    fecha:       col('Fecha del parte'),
    tipoHora:    col('Código de tipo hora'),
    espDiur:     col('Hs. esperadas diurna'),
    espNoct:     col('Hs. esperadas nocturna'),
    trabDiur:    col('Hs. trabajadas diurna'),
    trabNoct:    col('Hs. trabajadas nocturna'),
    justDiur:    colAny('Hs. no trabajadas justificadas diurna', 'Hs. no trab justif diurna'),
    justNoct:    colAny('Hs. no trabajadas justificadas nocturna', 'Hs. no trab justif nocturna'),
    noJustDiur:  colAny('Hs. no trabajadas no justificadas diurna', 'Hs. no trab no justif diurna'),
    noJustNoct:  colAny('Hs. no trabajadas no justificadas nocturna', 'Hs. no trab no justif noctur'),
    realDiur:    col('Hs. reales diurna'),
    realNoct:    col('Hs. reales nocturna'),
    descTipo:    col('Descripción de tipo hora'), // opcional — para mostrar motivo de justificación
  };

  // descTipo es opcional; los demás son requeridos
  const faltantes = Object.entries(C).filter(([k, v]) => k !== 'descTipo' && v === -1).map(([k]) => k);
  if (faltantes.length) throw new Error(`Columnas no encontradas: ${faltantes.join(', ')}`);

  // Eventos de "Horas no trabajadas" (tardanzas, salidas anticipadas, ausencias) — se
  // parsean ANTES del loop principal porque vacaciones y viaje laboral necesitan
  // reclasificar filas de "Detalle de horas" del mismo archivo (ver más abajo).
  const eventos = parsearTardanzas(wb);
  // VACACION: no es ausentismo — es un día sin jornada programada (como un franco), así
  // que se le reduce la hora esperada a 0 en vez de contarla como ausencia (ni justificada
  // ni no justificada). Tango además suele dejar estos días con 0h esperadas y todo el
  // déficit como "no justificado" en "Detalle de horas".
  const vacacionPorDia = new Set(
    eventos.filter(e => e.tipo === 'ausente' && e.codigo_justificacion === 'VACACION')
           .map(e => `${e.legajo}|${e.fecha}`)
  );
  // VIAJE (viaje laboral): la persona sigue trabajando, solo que fuera de la planta — se
  // acredita como presente/trabajado, no como ausencia (ni justificada ni no justificada).
  const viajePorDia = new Set(
    eventos.filter(e => e.tipo === 'ausente' && e.codigo_justificacion === 'VIAJE')
           .map(e => `${e.legajo}|${e.fecha}`)
  );

  const byLegajo = new Map();
  const detalleRows = [];
  const fechasSeriales = [];

  for (let i = 1; i < filas.length; i++) {
    const f = filas[i];
    const legajoRaw = f[C.legajo];
    if (!legajoRaw && legajoRaw !== 0) continue;
    const legajo = +legajoRaw;
    if (!legajo) continue;

    const tipoHora = String(f[C.tipoHora]).trim();
    const fechaSerial = f[C.fecha];
    if (typeof fechaSerial !== 'number' || !fechaSerial) continue;
    fechasSeriales.push(fechaSerial);
    const fecha = serialAFecha(fechaSerial);

    let   trabDiur   = +f[C.trabDiur]   || 0;
    let   trabNoct   = +f[C.trabNoct]   || 0;
    let   justDiur   = +f[C.justDiur]   || 0;
    let   justNoct   = +f[C.justNoct]   || 0;
    let   noJustDiur = +f[C.noJustDiur] || 0;
    let   noJustNoct = +f[C.noJustNoct] || 0;
    let   espDiur    = +f[C.espDiur]    || 0;
    let   espNoct    = +f[C.espNoct]    || 0;
    let   realDiur   = +f[C.realDiur]   || 0;
    let   realNoct   = +f[C.realNoct]   || 0;
    const descTipo   = C.descTipo >= 0 ? String(f[C.descTipo] || '').trim() : '';

    if (tipoHora === 'HSNOR' && vacacionPorDia.has(`${legajo}|${fecha}`)) {
      // Vacaciones: se anula la jornada de ese día — ni esperada ni ausencia, como un franco.
      espDiur = 0; espNoct = 0;
      justDiur = 0; justNoct = 0;
      noJustDiur = 0; noJustNoct = 0;
    } else if (tipoHora === 'HSNOR' && viajePorDia.has(`${legajo}|${fecha}`)) {
      // Viaje laboral: se acredita como si hubiera trabajado la jornada esperada completa.
      trabDiur = espDiur; trabNoct = espNoct;
      realDiur = espDiur; realNoct = espNoct;
      justDiur = 0; justNoct = 0;
      noJustDiur = 0; noJustNoct = 0;
    }

    // Guardar detalle de TODOS los tipos de hora (incluyendo SIN_HORA que tiene hs_reales)
    detalleRows.push({
      legajo, fecha, tipo_hora: tipoHora,
      descripcion_tipo_hora: descTipo || null,
      // HS VAC = "vacaciones trabajadas" (concepto nuevo de Tango): también tiene horas
      // esperadas reales, a diferencia del resto de los tipos de hora fuera de HSNOR.
      hs_esperadas:        (tipoHora === 'HSNOR' || tipoHora === 'HS VAC') ? +(espDiur + espNoct).toFixed(4) : 0,
      hs_reales:           +(realDiur + realNoct).toFixed(4),
      hs_trabajadas:       +(trabDiur + trabNoct).toFixed(4),
      hs_justificadas:     +(justDiur + justNoct).toFixed(4),
      hs_no_justificadas:  +(noJustDiur + noJustNoct).toFixed(4),
    });

    // Acumulado
    if (!byLegajo.has(legajo)) {
      byLegajo.set(legajo, {
        legajo,
        apellido:    String(f[C.apellido]).trim(),
        nombre:      String(f[C.nombre]).trim(),
        condicion:   String(f[C.condicion]).trim(),
        departamento: String(f[C.dep]).trim(),
        empresa: null,
        hs_esperadas: 0, hs_normales: 0,
        hs_extra50: 0, hs_extra100: 0,
        hs_justificadas: 0, hs_no_justificadas: 0,
        hs_vac_esperadas: 0, hs_vac_trabajadas: 0,
        // Mapa de presencia diaria: diaKey → { reales, justificadas, esLaborable }
        diasTracked: new Map(),
      });
    }

    const agg = byLegajo.get(legajo);

    // Reales del día: acumular desde TODOS los tipos (HSNOR + SIN_HORA + extras)
    const diaKey = fecha;
    if (!agg.diasTracked.has(diaKey)) agg.diasTracked.set(diaKey, { reales: 0, justificadas: 0, esperadas: 0, esLaborable: false });
    const dia = agg.diasTracked.get(diaKey);
    dia.reales += realDiur + realNoct;

    if (tipoHora === 'HSNOR') {
      dia.esLaborable = true;
      dia.esperadas   += espDiur + espNoct;
      dia.justificadas += justDiur + justNoct;
      agg.hs_esperadas += espDiur + espNoct;
      agg.hs_normales  += trabDiur + trabNoct;
      // Solo acumular ausencias en días donde había horas programadas
      if (espDiur + espNoct > 0) {
        agg.hs_justificadas    += justDiur + justNoct;
        agg.hs_no_justificadas += noJustDiur + noJustNoct;
      }
    } else if (tipoHora === 'HSEXT' || tipoHora === 'HSEXT50' || tipoHora === 'HS 50 VAC') {
      // Tango exporta la hora extra al 50% como 'HSEXT' (así viene en los archivos reales
      // de Enero a Julio 2026 — nunca usa el sufijo "50"). Se acepta también 'HSEXT50' por
      // si algún export previo o futuro usara ese código explícito. 'HS 50 VAC' es el
      // concepto nuevo que RRHH agregó para la hora extra al 50% de días de vacaciones
      // trabajadas — para el sistema es la misma hora extra al 50% de siempre, solo que
      // Tango la separa en otro código porque liquida distinto. Ver también HS 100 VAC abajo.
      agg.hs_extra50  += trabDiur + trabNoct;
    } else if (tipoHora === 'HSEXT100' || tipoHora === 'HS 100 VAC') {
      agg.hs_extra100 += trabDiur + trabNoct;
    } else if (tipoHora === 'HS VAC') {
      // Vacaciones trabajadas: cuenta como día laborable/presente, y se trackea aparte
      // de lo normal para poder mostrar el desglose "normales + vac trabajadas".
      dia.esLaborable = true;
      dia.esperadas   += espDiur + espNoct;
      agg.hs_vac_esperadas  += espDiur + espNoct;
      // Tango no completa "Hs. trabajadas" para este concepto — el dato real está en "reales".
      agg.hs_vac_trabajadas += realDiur + realNoct;
    }
  }

  if (!fechasSeriales.length) throw new Error('No se encontraron fechas válidas en el archivo');

  // Período = primer día del mes de la fecha mínima
  const minSerial = Math.min(...fechasSeriales);
  const minFecha  = new Date(Date.UTC(1899, 11, 30) + minSerial * 86400000);
  const periodo   = `${minFecha.getUTCFullYear()}-${String(minFecha.getUTCMonth() + 1).padStart(2, '0')}-01`;

  const mensual = [];
  for (const [, agg] of byLegajo) {
    // Presentismo por días: vino = hs_reales > 0 (incluye llegada tarde o salida temprana)
    let dias_laborables = 0, dias_presentes = 0, dias_ausentes_nojust = 0, hs_ausencias = 0;
    for (const [, dia] of agg.diasTracked) {
      if (!dia.esLaborable) continue; // solo días con fila HSNOR son laborables
      dias_laborables++;
      if (dia.reales > 0) {
        dias_presentes++;
        // reales > 0 → PRESENTE, aunque no haya cumplido horas: llegada tarde/salida temprana no es ausentismo
      } else if (dia.esperadas > 0) {
        // reales = 0 con jornada programada → falta completa (ausentismo), justificada o no
        hs_ausencias += dia.esperadas;
        if (dia.justificadas === 0) dias_ausentes_nojust++;
      }
      // esperadas = 0 → día sin carga programada, no cuenta como ausente
    }

    const hs_esp = +agg.hs_esperadas.toFixed(2);

    // Presentismo: días presentes sobre días que debía venir (excluye licencias)
    const presentismo_pct = (dias_presentes + dias_ausentes_nojust) > 0
      ? +((dias_presentes / (dias_presentes + dias_ausentes_nojust)) * 100).toFixed(1)
      : null;

    // Cumplimiento de horas: hs trabajadas sobre hs esperadas (refleja tardanzas/salidas antes)
    const cumplimiento_hs_pct = hs_esp > 0
      ? +(agg.hs_normales / hs_esp * 100).toFixed(1)
      : null;
    const { diasTracked, ...resto } = agg; // diasTracked es temporal, no va a BD
    mensual.push({
      ...resto,
      hs_esperadas:       hs_esp,
      hs_normales:        +agg.hs_normales.toFixed(2),
      hs_extra50:         +agg.hs_extra50.toFixed(2),
      hs_extra100:        +agg.hs_extra100.toFixed(2),
      hs_justificadas:    +agg.hs_justificadas.toFixed(2),
      hs_no_justificadas: +agg.hs_no_justificadas.toFixed(2),
      hs_ausencias:       +hs_ausencias.toFixed(2),
      hs_vac_esperadas:   +agg.hs_vac_esperadas.toFixed(2),
      hs_vac_trabajadas:  +agg.hs_vac_trabajadas.toFixed(2),
      dias_laborables,
      dias_presentes,
      dias_ausentes_nojust,
      presentismo_pct,
      cumplimiento_hs_pct,
      periodo,
    });
  }

  const tardanzas = eventos.map(t => ({ ...t, periodo }));

  return { mensual, detalle: detalleRows, tardanzas, periodo };
}

// Enriquece con empresa cruzando contra v_empleados_activos
async function enrichConEmpresa(mensual) {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/v_empleados_activos?select=legajo,empresa`,
      { headers: HDR_SB }
    );
    if (!r.ok) return mensual;
    const empleados = await r.json();
    const mapEmp = new Map(empleados.map(e => [+e.legajo, e.empresa]));
    return mensual.map(m => ({ ...m, empresa: mapEmp.get(m.legajo) ?? null }));
  } catch {
    return mensual;
  }
}

async function guardarEnSupabase(mensual, detalle, tardanzas, periodo) {
  // UPSERT del resumen mensual: nunca borra datos existentes antes de confirmar
  // Si falla, los datos anteriores quedan intactos
  const rMens = await fetch(`${SUPABASE_URL}/rest/v1/rrhh_horas_mensual?on_conflict=periodo,legajo`, {
    method: 'POST',
    headers: { ...HDR_JSON, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify(mensual),
  });
  if (!rMens.ok) {
    const detalle_err = await rMens.text().catch(() => '');
    throw new Error(`Error al guardar resumen mensual (HTTP ${rMens.status})${detalle_err ? ': ' + detalle_err.slice(0, 200) : ''}`);
  }

  // Solo si el mensual fue ok, reemplazar el detalle de los legajos de este archivo
  // (no borrar todo el período para no pisar datos del otro archivo empresa)
  const legajosArchivo = [...new Set(detalle.map(d => d.legajo))];
  await fetch(`${SUPABASE_URL}/rest/v1/rrhh_horas_detalle?periodo=eq.${periodo}&legajo=in.(${legajosArchivo.join(',')})`, {
    method: 'DELETE', headers: HDR_SB,
  });

  const BATCH = 500;
  for (let i = 0; i < detalle.length; i += BATCH) {
    const lote = detalle.slice(i, i + BATCH).map(d => ({ ...d, periodo }));
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rrhh_horas_detalle`, {
      method: 'POST',
      headers: HDR_JSON,
      body: JSON.stringify(lote),
    });
    if (!r.ok) throw new Error(`Error al guardar detalle (HTTP ${r.status})`);
  }

  // Tardanzas/salidas anticipadas — mismo patrón: reemplazar por legajo+período, no todo el período
  if (tardanzas.length) {
    await fetch(`${SUPABASE_URL}/rest/v1/rrhh_tardanzas_salidas?periodo=eq.${periodo}&legajo=in.(${legajosArchivo.join(',')})`, {
      method: 'DELETE', headers: HDR_SB,
    });
    for (let i = 0; i < tardanzas.length; i += BATCH) {
      const lote = tardanzas.slice(i, i + BATCH);
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rrhh_tardanzas_salidas?on_conflict=legajo,fecha,tipo`, {
        method: 'POST',
        headers: { ...HDR_JSON, Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(lote),
      });
      if (!r.ok) throw new Error(`Error al guardar tardanzas/salidas (HTTP ${r.status})`);
    }
  }
}

export async function renderizarPresentismoCarga(contenedor, alCargar) {
  let datosParseados = null;
  let tipoActivo = null; // 'tango' | 'capataz'

  contenedor.innerHTML = `
    <div class="pres__carga-wrap">
      <div class="pres__carga-cabecera">
        <h2 class="pres__titulo">Cargar horas</h2>
        <p class="pres__subtitulo">Seleccioná el archivo exportado desde <strong>Tango</strong> (reporte "Extenso" o "Detalle de horas") o desde <strong>Capataz</strong> (Gestión Personalizada PCP), en formato <strong>.xlsx</strong> — el sistema reconoce solo cuál es.</p>
      </div>

      <div id="pres-estado-carga"></div>

      <div class="pres__carga-zona" id="pres-zona">
        <input type="file" id="pres-file" accept=".xlsx,.xls" class="pres__file-input">
        <label for="pres-file" class="pres__file-label">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          <span>Hacé clic para seleccionar el archivo</span>
          <span class="pres__file-hint">.xlsx de Tango o de Capataz</span>
        </label>
      </div>

      <div id="pres-estado" class="pres__estado" style="display:none"></div>
      <div id="pres-preview" style="display:none"></div>
    </div>
  `;

  const fileInput  = contenedor.querySelector('#pres-file');
  const estadoDiv  = contenedor.querySelector('#pres-estado');
  const previewDiv = contenedor.querySelector('#pres-preview');
  const zonaDiv    = contenedor.querySelector('#pres-zona');
  const estadoCargaDiv = contenedor.querySelector('#pres-estado-carga');

  // Estado de carga por empresa y período — para saber de un vistazo qué meses ya están
  // cargados antes de subir uno nuevo. Se vuelve a pedir después de cada carga exitosa
  // (ver confirmarCargaTango) para que el check se actualice sin recargar la pantalla.
  async function renderEstadoCarga() {
    let rawHoras = [];
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rrhh_horas_mensual?select=periodo,empresa`, { headers: HDR_SB });
      rawHoras = r.ok ? await r.json() : [];
    } catch { estadoCargaDiv.innerHTML = ''; return; }

    if (!rawHoras.length) { estadoCargaDiv.innerHTML = ''; return; }

    const allPeriodos = [...new Set(rawHoras.filter(d => EMPRESAS.includes(d.empresa)).map(d => d.periodo))].sort();
    const cargados = new Set(rawHoras.filter(d => EMPRESAS.includes(d.empresa)).map(d => `${d.periodo}|${d.empresa}`));

    estadoCargaDiv.innerHTML = `
      <section class="pind__sec">
        <h2 class="pind__sec-tit">
          <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
          Estado de carga por empresa y período
        </h2>
        <div class="pind__cal-scroll"><table class="pind__cal">
          <thead><tr>
            <th class="pind__cal-th">Período</th>
            ${EMPRESAS.map(e => `<th class="pind__cal-th">${EMP_LABEL[e]}</th>`).join('')}
            <th class="pind__cal-th pind__cal-th--cnt">Empleados</th>
          </tr></thead>
          <tbody>${[...allPeriodos].reverse().map(p => {
            const cnt = rawHoras.filter(d => d.periodo === p && EMPRESAS.includes(d.empresa)).length;
            return `<tr>
              <td class="pind__cal-td pind__cal-td--per">${formatearPeriodo(p)}</td>
              ${EMPRESAS.map(e => {
                const ok = cargados.has(`${p}|${e}`);
                return `<td class="pind__cal-td pind__cal-td--${ok ? 'ok' : 'no'}"><span class="pind__cal-pill pind__cal-pill--${ok ? 'ok' : 'no'}">${ok ? '✓ Cargado' : '— Sin datos'}</span></td>`;
              }).join('')}
              <td class="pind__cal-td pind__cal-td--cnt">${cnt}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>
      </section>
    `;
  }
  renderEstadoCarga();

  // Arrastrar y soltar
  zonaDiv.addEventListener('dragover',  e => { e.preventDefault(); zonaDiv.classList.add('pres__carga-zona--drag'); });
  zonaDiv.addEventListener('dragleave', ()  => zonaDiv.classList.remove('pres__carga-zona--drag'));
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
    tipoActivo = null;

    try {
      if (typeof XLSX === 'undefined') throw new Error('SheetJS no disponible. Recargá la página.');
      const buf = await file.arrayBuffer();
      const wb  = XLSX.read(new Uint8Array(buf), { type: 'array' });
      tipoActivo = detectarTipoArchivo(wb);

      if (tipoActivo === 'tango') {
        const parsed = parsearExcel(wb);
        datosParseados = parsed;

        // Chequear si ya hay datos para ese período
        const rEx = await fetch(
          `${SUPABASE_URL}/rest/v1/rrhh_horas_mensual?periodo=eq.${parsed.periodo}&select=legajo`,
          { headers: HDR_SB }
        );
        const existentes = rEx.ok ? await rEx.json() : [];
        mostrarPreviewTango(parsed, existentes.length > 0);
      } else if (tipoActivo === 'capataz') {
        datosParseados = parsearExcelOT(wb);
        mostrarPreviewCapataz(datosParseados);
      } else {
        throw new Error('No reconocemos el formato de este archivo. Verificá que sea el export "Extenso" de Tango o el de Capataz (Gestión Personalizada PCP).');
      }
    } catch (err) {
      estadoDiv.innerHTML = `<div class="pres__msg-error">Error al leer el archivo: ${eP(err.message)}</div>`;
    }
  }

  function mostrarPreviewTango(parsed, periodoExistente) {
    const { mensual, detalle, tardanzas, periodo } = parsed;

    const totalEsp    = mensual.reduce((s, m) => s + m.hs_esperadas, 0);
    const totalNoJust = mensual.reduce((s, m) => s + m.hs_no_justificadas, 0);
    const totalExt50  = mensual.reduce((s, m) => s + m.hs_extra50, 0);
    const presGlobal  = totalEsp > 0 ? ((1 - totalNoJust / totalEsp) * 100).toFixed(1) : '—';

    const avgEsp   = totalEsp / mensual.length;
    const parciales = mensual.filter(m => m.hs_esperadas < avgEsp * 0.5);

    estadoDiv.innerHTML = `
      <div class="pres__msg-ok">
        ✓ Detectamos un archivo de <strong>Tango</strong> — <strong>${formatearPeriodo(periodo)}</strong>
        ${periodoExistente ? `<span class="pres__badge-reemplazo">Los datos existentes serán reemplazados</span>` : ''}
      </div>
    `;

    previewDiv.style.display = 'block';
    previewDiv.innerHTML = `
      <div class="pres__preview-kpis">
        <div class="pres__preview-kpi">
          <span class="pres__preview-kpi-num">${mensual.length}</span>
          <span class="pres__preview-kpi-lbl">empleados</span>
        </div>
        <div class="pres__preview-kpi">
          <span class="pres__preview-kpi-num">${detalle.length.toLocaleString('es-AR')}</span>
          <span class="pres__preview-kpi-lbl">registros</span>
        </div>
        <div class="pres__preview-kpi">
          <span class="pres__preview-kpi-num">${presGlobal}%</span>
          <span class="pres__preview-kpi-lbl">presentismo</span>
        </div>
        <div class="pres__preview-kpi">
          <span class="pres__preview-kpi-num">${totalExt50.toFixed(0)}h</span>
          <span class="pres__preview-kpi-lbl">extras 50%</span>
        </div>
        ${tardanzas.length ? `
        <div class="pres__preview-kpi">
          <span class="pres__preview-kpi-num">${tardanzas.length.toLocaleString('es-AR')}</span>
          <span class="pres__preview-kpi-lbl">tardanzas/salidas detectadas</span>
        </div>` : ''}
      </div>

      ${!tardanzas.length ? `
        <div class="pres__aviso-parcial">
          No se encontró la hoja "Horas no trabajadas" en este archivo — no se van a cargar
          tardanzas ni salidas anticipadas. Subí el reporte "Extenso" de Tango si querés ese dato.
        </div>` : ''}

      ${parciales.length ? `
        <div class="pres__aviso-parcial">
          <strong>Aviso:</strong> ${parciales.length} empleado${parciales.length > 1 ? 's' : ''} con horas esperadas muy bajas (posible alta/baja a mitad de mes):
          ${parciales.map(p => `<span class="pres__aviso-emp">${eP(p.apellido)} #${p.legajo} (${p.hs_esperadas}h)</span>`).join(', ')}
        </div>
      ` : ''}

      <div class="pres__preview-tabla-wrap">
        <table class="pres__preview-tabla">
          <thead>
            <tr>
              <th>Legajo</th><th>Apellido</th><th>Departamento</th>
              <th>Hs esp.</th><th>Hs norm.</th><th>Extra 50%</th><th>No just.</th><th>Presentismo</th>
            </tr>
          </thead>
          <tbody>
            ${mensual.slice(0, 10).map(m => `
              <tr>
                <td>${m.legajo}</td>
                <td>${eP(m.apellido)}</td>
                <td>${eP(m.departamento)}</td>
                <td>${m.hs_esperadas}</td>
                <td>${m.hs_normales}</td>
                <td>${m.hs_extra50 || '—'}</td>
                <td>${m.hs_no_justificadas || '—'}</td>
                <td>${m.presentismo_pct !== null ? m.presentismo_pct + '%' : '—'}</td>
              </tr>
            `).join('')}
            ${mensual.length > 10 ? `<tr><td colspan="8" class="pres__preview-mas">… y ${mensual.length - 10} más</td></tr>` : ''}
          </tbody>
        </table>
      </div>

      <div class="pres__carga-acciones">
        <button class="pres__btn-cancelar" id="pres-cancelar" type="button">Cancelar</button>
        <button class="pres__btn-confirmar" id="pres-confirmar" type="button">
          Guardar datos de ${formatearPeriodo(periodo)}
        </button>
      </div>
    `;

    previewDiv.querySelector('#pres-cancelar').addEventListener('click', () => {
      previewDiv.style.display = 'none';
      estadoDiv.style.display  = 'none';
      fileInput.value = '';
      datosParseados  = null;
    });

    previewDiv.querySelector('#pres-confirmar').addEventListener('click', confirmarCargaTango);
  }

  // ── Preview del archivo de Capataz (mismo criterio que Horas por OT) ─────────
  function mostrarPreviewCapataz(parsed) {
    const { filas: filasParseadas, entidadesExcluidas, anomalias } = parsed;
    const periodosArchivo = [...new Set(filasParseadas.map(f => f.periodo))].sort();
    const validas = filasParseadas.filter(f => !f.anomalo);
    const total = validas.reduce((s, f) => s + f.horas, 0);
    const conOT = validas.filter(f => f.ot != null).reduce((s, f) => s + f.horas, 0);
    const ots   = new Set(validas.filter(f => f.ot != null).map(f => f.ot));
    const pct   = (a, b) => b > 0 ? Math.round(a / b * 100) : 0;
    const fmtNum = n => Math.round(n || 0).toLocaleString('es-AR');
    const MESES_P = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    const fmtPer = p => { const [y, m] = p.split('-'); return `${MESES_P[+m - 1]} ${y}`; };

    estadoDiv.innerHTML = `
      <div class="pres__msg-ok">
        ✓ Detectamos un archivo de <strong>Capataz</strong> — <strong>${periodosArchivo.map(fmtPer).join(', ')}</strong>
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
        <button class="pres__btn-cancelar" id="pres-cancelar" type="button">Cancelar</button>
        <button class="pres__btn-confirmar" id="pres-confirmar" type="button">
          Guardar datos de ${periodosArchivo.map(fmtPer).join(', ')}
        </button>
      </div>
    `;

    previewDiv.querySelector('#pres-cancelar').addEventListener('click', () => {
      previewDiv.style.display = 'none';
      estadoDiv.style.display  = 'none';
      fileInput.value = '';
      datosParseados  = null;
    });

    previewDiv.querySelector('#pres-confirmar').addEventListener('click', confirmarCargaCapataz);
  }

  async function confirmarCargaCapataz() {
    if (!datosParseados) return;
    const btnOk  = previewDiv.querySelector('#pres-confirmar');
    const btnCan = previewDiv.querySelector('#pres-cancelar');
    btnOk.disabled  = true;
    btnCan.disabled = true;
    btnOk.textContent = 'Guardando…';

    try {
      await guardarHorasOT(datosParseados.filas);
      const validas = datosParseados.filas.filter(f => !f.anomalo);
      const periodosArchivo = [...new Set(datosParseados.filas.map(f => f.periodo))].sort();
      const MESES_P = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
      const fmtPer = p => { const [y, m] = p.split('-'); return `${MESES_P[+m - 1]} ${y}`; };

      estadoDiv.innerHTML = `
        <div class="pres__msg-exito">
          ✓ Datos de Capataz (<strong>${periodosArchivo.map(fmtPer).join(', ')}</strong>) guardados.
          ${validas.length.toLocaleString('es-AR')} registros.
        </div>
      `;
      previewDiv.style.display = 'none';
      fileInput.value = '';
      datosParseados  = null;
      tipoActivo = null;

      if (typeof alCargar === 'function') alCargar();
    } catch (err) {
      btnOk.disabled  = false;
      btnCan.disabled = false;
      btnOk.textContent = 'Reintentar';
      estadoDiv.innerHTML = `<div class="pres__msg-error">Error al guardar: ${eP(err.message)}</div>`;
    }
  }

  async function confirmarCargaTango() {
    if (!datosParseados) return;
    const btnOk  = previewDiv.querySelector('#pres-confirmar');
    const btnCan = previewDiv.querySelector('#pres-cancelar');
    btnOk.disabled  = true;
    btnCan.disabled = true;
    btnOk.textContent = 'Guardando…';

    try {
      const enriched = await enrichConEmpresa(datosParseados.mensual);
      await guardarEnSupabase(enriched, datosParseados.detalle, datosParseados.tardanzas, datosParseados.periodo);

      estadoDiv.innerHTML = `
        <div class="pres__msg-exito">
          ✓ Datos de <strong>${formatearPeriodo(datosParseados.periodo)}</strong> guardados.
          ${enriched.length} empleados · ${datosParseados.detalle.length.toLocaleString('es-AR')} registros de detalle.
        </div>
      `;
      previewDiv.style.display = 'none';
      fileInput.value = '';
      datosParseados  = null;
      tipoActivo = null;
      renderEstadoCarga();

      if (typeof alCargar === 'function') alCargar();
    } catch (err) {
      btnOk.disabled  = false;
      btnCan.disabled = false;
      btnOk.textContent = 'Reintentar';
      estadoDiv.innerHTML = `<div class="pres__msg-error">Error al guardar: ${eP(err.message)}</div>`;
    }
  }
}
