import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';

const HDR_JSON = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=minimal',
};
const HDR_SB = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

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

// Parsea el Excel y devuelve { mensual, detalle, periodo }
function parsearExcel(buffer) {
  if (typeof XLSX === 'undefined') throw new Error('SheetJS no disponible. Recargá la página.');

  const wb = XLSX.read(buffer, { type: 'array' });

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
    justDiur:    col('Hs. no trabajadas justificadas diurna'),
    justNoct:    col('Hs. no trabajadas justificadas nocturna'),
    noJustDiur:  col('Hs. no trabajadas no justificadas diurna'),
    noJustNoct:  col('Hs. no trabajadas no justificadas nocturna'),
    realDiur:    col('Hs. reales diurna'),
    realNoct:    col('Hs. reales nocturna'),
    descTipo:    col('Descripción de tipo hora'), // opcional — para mostrar motivo de justificación
  };

  // descTipo es opcional; los demás son requeridos
  const faltantes = Object.entries(C).filter(([k, v]) => k !== 'descTipo' && v === -1).map(([k]) => k);
  if (faltantes.length) throw new Error(`Columnas no encontradas: ${faltantes.join(', ')}`);

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

    const trabDiur   = +f[C.trabDiur]   || 0;
    const trabNoct   = +f[C.trabNoct]   || 0;
    const justDiur   = +f[C.justDiur]   || 0;
    const justNoct   = +f[C.justNoct]   || 0;
    const noJustDiur = +f[C.noJustDiur] || 0;
    const noJustNoct = +f[C.noJustNoct] || 0;
    const espDiur    = +f[C.espDiur]    || 0;
    const espNoct    = +f[C.espNoct]    || 0;
    const realDiur   = +f[C.realDiur]   || 0;
    const realNoct   = +f[C.realNoct]   || 0;
    const descTipo   = C.descTipo >= 0 ? String(f[C.descTipo] || '').trim() : '';

    // Guardar detalle de TODOS los tipos de hora (incluyendo SIN_HORA que tiene hs_reales)
    detalleRows.push({
      legajo, fecha, tipo_hora: tipoHora,
      descripcion_tipo_hora: descTipo || null,
      hs_esperadas:        tipoHora === 'HSNOR' ? +(espDiur + espNoct).toFixed(4) : 0,
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
    } else if (tipoHora === 'HSEXT50') {
      agg.hs_extra50  += trabDiur + trabNoct;
    } else if (tipoHora === 'HSEXT100') {
      agg.hs_extra100 += trabDiur + trabNoct;
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
      dias_laborables,
      dias_presentes,
      dias_ausentes_nojust,
      presentismo_pct,
      cumplimiento_hs_pct,
      periodo,
    });
  }

  return { mensual, detalle: detalleRows, periodo };
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

async function guardarEnSupabase(mensual, detalle, periodo) {
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
}

export async function renderizarPresentismoCarga(contenedor, alCargar) {
  let datosParseados = null;

  contenedor.innerHTML = `
    <div class="pres__carga-wrap">
      <div class="pres__carga-cabecera">
        <h2 class="pres__titulo">Cargar archivo de horas</h2>
        <p class="pres__subtitulo">Seleccioná el archivo exportado desde Tango como <strong>"Detalle de horas"</strong> en formato <strong>.xlsx</strong>.</p>
      </div>

      <div class="pres__carga-zona" id="pres-zona">
        <input type="file" id="pres-file" accept=".xlsx,.xls" class="pres__file-input">
        <label for="pres-file" class="pres__file-label">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          <span>Hacé clic para seleccionar el archivo</span>
          <span class="pres__file-hint">.xlsx exportado desde Tango</span>
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

    try {
      const buf    = await file.arrayBuffer();
      const parsed = parsearExcel(new Uint8Array(buf));
      datosParseados = parsed;

      // Chequear si ya hay datos para ese período
      const rEx = await fetch(
        `${SUPABASE_URL}/rest/v1/rrhh_horas_mensual?periodo=eq.${parsed.periodo}&select=legajo`,
        { headers: HDR_SB }
      );
      const existentes = rEx.ok ? await rEx.json() : [];
      mostrarPreview(parsed, existentes.length > 0);
    } catch (err) {
      estadoDiv.innerHTML = `<div class="pres__msg-error">Error al leer el archivo: ${eP(err.message)}</div>`;
    }
  }

  function mostrarPreview(parsed, periodoExistente) {
    const { mensual, detalle, periodo } = parsed;

    const totalEsp    = mensual.reduce((s, m) => s + m.hs_esperadas, 0);
    const totalNoJust = mensual.reduce((s, m) => s + m.hs_no_justificadas, 0);
    const totalExt50  = mensual.reduce((s, m) => s + m.hs_extra50, 0);
    const presGlobal  = totalEsp > 0 ? ((1 - totalNoJust / totalEsp) * 100).toFixed(1) : '—';

    const avgEsp   = totalEsp / mensual.length;
    const parciales = mensual.filter(m => m.hs_esperadas < avgEsp * 0.5);

    estadoDiv.innerHTML = `
      <div class="pres__msg-ok">
        ✓ Archivo leído correctamente — <strong>${formatearPeriodo(periodo)}</strong>
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
      </div>

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

    previewDiv.querySelector('#pres-confirmar').addEventListener('click', confirmarCarga);
  }

  async function confirmarCarga() {
    if (!datosParseados) return;
    const btnOk  = previewDiv.querySelector('#pres-confirmar');
    const btnCan = previewDiv.querySelector('#pres-cancelar');
    btnOk.disabled  = true;
    btnCan.disabled = true;
    btnOk.textContent = 'Guardando…';

    try {
      const enriched = await enrichConEmpresa(datosParseados.mensual);
      await guardarEnSupabase(enriched, datosParseados.detalle, datosParseados.periodo);

      estadoDiv.innerHTML = `
        <div class="pres__msg-exito">
          ✓ Datos de <strong>${formatearPeriodo(datosParseados.periodo)}</strong> guardados.
          ${enriched.length} empleados · ${datosParseados.detalle.length.toLocaleString('es-AR')} registros de detalle.
        </div>
      `;
      previewDiv.style.display = 'none';
      fileInput.value = '';
      datosParseados  = null;

      if (typeof alCargar === 'function') alCargar();
    } catch (err) {
      btnOk.disabled  = false;
      btnCan.disabled = false;
      btnOk.textContent = 'Reintentar';
      estadoDiv.innerHTML = `<div class="pres__msg-error">Error al guardar: ${eP(err.message)}</div>`;
    }
  }
}
