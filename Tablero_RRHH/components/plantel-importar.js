// Plantel → Actualizar desde Excel.
//
// Reemplazo manual del sync con la API de Tango (Desktop\...\API Tango\Sync-Empleados*.ps1), para
// cuando la API no funciona. Se sube el Excel "Legajos de Sueldos" que se baja de Tango para cada
// empresa: es el mismo proceso 1038 / misma vista que leía el script (NRO_LEGAJO, APELLIDO_Y_NOMBRE,
// CUIL, DESC_DEPARTAMENTO, FECHA_NACIMIENTO, FECHA_INGRESO_TRAMO), y se aplica igual que él:
//   · quien está en el Excel queda activo con sus datos actualizados (alta si no existía);
//   · quien estaba activo en la base y ya no figura en el Excel de su empresa pasa a baja.
// A diferencia del script, primero muestra qué va a cambiar y deja destildar cambios puntuales
// (ej. un puesto que se corrigió a mano en la base y el Excel todavía trae viejo).

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';
import { obtenerUsuario } from '../data/usuario-activo.js';

const HDR = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
const HDR_JSON = { ...HDR, 'Content-Type': 'application/json' };
const EMP_LABEL = { CIMOMET: 'Cimomet', COMOING: 'Co.mo.ing' };

// Columnas del Excel de Tango → columnas de `empleados`. Se buscan por título (sin tildes ni
// mayúsculas) y no por posición, por si Tango cambia el orden.
const COLUMNAS = [
  { campo: 'legajo',            titulos: ['numero', 'nro legajo', 'legajo'] },
  { campo: 'apellido_y_nombre', titulos: ['apellido y nombre'] },
  { campo: 'cuil',              titulos: ['cuil'] },
  { campo: 'desc_puesto',       titulos: ['descripcion de departamento', 'departamento'] },
  { campo: 'fecha_nacimiento',  titulos: ['fecha de nacimiento'] },
  { campo: 'fecha_ingreso',     titulos: ['fecha de ingreso de ultimo tramo', 'fecha de ingreso'] },
];
const CAMPO_LABEL = {
  apellido_y_nombre: 'Nombre', cuil: 'CUIL', desc_puesto: 'Puesto',
  fecha_nacimiento: 'Nacimiento', fecha_ingreso: 'Ingreso',
};
const CAMPOS_COMPARADOS = Object.keys(CAMPO_LABEL);
// Si un Excel trae menos de esta proporción de los activos actuales, probablemente esté
// incompleto (filtro aplicado en Tango, archivo cortado): dar de baja a todos los que faltan
// sería un error grave, así que se pide confirmación explícita.
const UMBRAL_EXCEL_INCOMPLETO = 0.8;

function e(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function norm(s) { return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase(); }
function fmtFecha(iso) { if (!iso) return '—'; const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}`; }
function valorLegible(campo, v) { return campo.startsWith('fecha') ? fmtFecha(v) : (v || '—'); }

// Fecha local "YYYY-MM-DD" (sin pasar por UTC, que en Argentina corre el día para atrás).
function fechaISO(v) {
  if (v === null || v === undefined || v === '') return null;
  // Celda con formato fecha (cellDates). Se chequea así y no con instanceof Date para no depender
  // de en qué contexto se creó el objeto.
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  // Número de serie de Excel (días desde 1900), por si la celda no trae formato de fecha.
  if (typeof v === 'number' && v > 0) {
    const d = XLSX.SSF.parse_date_code(v);
    return d ? `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` : null;
  }
  const m = String(v).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const iso = String(v).trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return iso ? iso[1] : null;
}

function empresaDesdeNombre(nombreArchivo) {
  const n = norm(nombreArchivo).replace(/[^a-z]/g, '');
  if (n.includes('comoing')) return 'COMOING';
  if (n.includes('cimomet')) return 'CIMOMET';
  return '';
}

// El Excel que exporta Tango declara mal su tamaño (<dimension ref="A1"/>): leído tal cual,
// SheetJS ve una sola celda. Se recalcula el rango real a partir de las celdas presentes.
function corregirRango(ws) {
  let maxF = 0, maxC = 0;
  Object.keys(ws).forEach(k => {
    if (k[0] === '!') return;
    const { r, c } = XLSX.utils.decode_cell(k);
    if (r > maxF) maxF = r;
    if (c > maxC) maxC = c;
  });
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxF, c: maxC } });
}

async function leerExcel(archivo) {
  const wb = XLSX.read(new Uint8Array(await archivo.arrayBuffer()), { type: 'array', cellDates: true });
  const hoja = wb.SheetNames.find(n => norm(n).includes('legajo')) || wb.SheetNames[0];
  const ws = wb.Sheets[hoja];
  corregirRango(ws);
  const filas = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });

  const iEnc = filas.findIndex(f => f.some(c => ['numero', 'nro legajo'].includes(norm(c))));
  if (iEnc < 0) throw new Error('No encontré la columna "Número". ¿Es el Excel "Legajos de Sueldos" de Tango?');
  const enc = filas[iEnc].map(norm);
  const idx = {};
  COLUMNAS.forEach(col => {
    idx[col.campo] = enc.findIndex(t => col.titulos.includes(t));
  });
  const faltan = COLUMNAS.filter(c => idx[c.campo] < 0).map(c => c.titulos[0]);
  if (faltan.length) throw new Error(`Faltan columnas en el Excel: ${faltan.join(', ')}.`);

  const personas = new Map();
  filas.slice(iEnc + 1).forEach(f => {
    const legajo = String(f[idx.legajo] ?? '').trim();
    if (!/^\d+$/.test(legajo)) return; // filas vacías o de totales
    personas.set(legajo, {
      legajo,
      apellido_y_nombre: String(f[idx.apellido_y_nombre] ?? '').trim(),
      cuil:              String(f[idx.cuil] ?? '').trim(),
      desc_puesto:       String(f[idx.desc_puesto] ?? '').trim(),
      fecha_nacimiento:  fechaISO(f[idx.fecha_nacimiento]),
      fecha_ingreso:     fechaISO(f[idx.fecha_ingreso]),
    });
  });
  if (!personas.size) throw new Error('El Excel no tiene ninguna fila con número de legajo.');
  return personas;
}

async function traerEmpleados() {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/empleados?select=legajo,empresa,${CAMPOS_COMPARADOS.join(',')},activo&limit=5000`, { headers: HDR });
  if (!r.ok) throw new Error(`No se pudo leer el plantel actual (HTTP ${r.status}).`);
  return r.json();
}

// Qué haría la carga para una empresa, comparando el Excel contra la base.
function calcularCambios(empresa, excel, enBase) {
  const base = new Map(enBase.filter(x => x.empresa === empresa).map(x => [String(x.legajo), x]));
  const altas = [], reactivar = [], cambios = [];
  excel.forEach((p, legajo) => {
    const b = base.get(legajo);
    if (!b) { altas.push(p); return; }
    const difs = CAMPOS_COMPARADOS
      .filter(c => (b[c] || '') !== (p[c] || '') && p[c]) // un dato vacío en el Excel nunca borra el de la base
      .map(c => ({ campo: c, antes: b[c], despues: p[c] }));
    if (!b.activo) reactivar.push({ ...p, difs });
    else if (difs.length) cambios.push({ ...p, difs });
  });
  const bajas = [...base.values()].filter(b => b.activo && !excel.has(String(b.legajo)));
  const activosHoy = [...base.values()].filter(b => b.activo).length;
  return { empresa, excel, altas, reactivar, cambios, bajas, activosHoy };
}

// Arma la lista de operaciones elegidas y la aplica en la base con la función
// plantel_aplicar_excel (sql/plantel_importar_excel.sql): la tabla "empleados" no deja escribir
// con la clave pública del tablero, así que no se puede actualizar directo.
async function aplicar(plan, seleccion) {
  const { empresa } = plan;
  const operaciones = [];

  plan.cambios.forEach(p => {
    const campos = Object.fromEntries(p.difs.filter(d => seleccion.has(`${empresa}|${p.legajo}|${d.campo}`)).map(d => [d.campo, d.despues]));
    if (Object.keys(campos).length) operaciones.push({ op: 'actualizar', legajo: p.legajo, campos });
  });
  plan.reactivar.forEach(p => {
    if (seleccion.has(`${empresa}|${p.legajo}|reactivar`)) {
      operaciones.push({ op: 'reactivar', legajo: p.legajo, campos: Object.fromEntries(p.difs.map(d => [d.campo, d.despues])) });
    }
  });
  plan.altas.forEach(p => {
    if (seleccion.has(`${empresa}|${p.legajo}|alta`)) {
      const { legajo, ...campos } = p;
      operaciones.push({ op: 'alta', legajo, campos });
    }
  });
  plan.bajas.forEach(b => {
    if (seleccion.has(`${empresa}|${b.legajo}|baja`)) operaciones.push({ op: 'baja', legajo: String(b.legajo) });
  });

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/plantel_aplicar_excel`, {
      method: 'POST', headers: HDR_JSON,
      body: JSON.stringify({
        p_empresa: empresa, p_operaciones: operaciones,
        p_legajos_excel: [...plan.excel.keys()], p_usuario: obtenerUsuario()?.nombre || null,
      }),
    });
    if (r.status === 404) {
      throw new Error('Falta crear la función en la base: ejecutá sql/plantel_importar_excel.sql en Supabase (SQL Editor) y volvé a intentar.');
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.message || `Error de la base (HTTP ${r.status}).`);
    return { actualizados: data.actualizados ?? 0, altas: data.altas ?? 0, bajas: data.bajas ?? 0, errores: data.errores ?? [] };
  } catch (err) {
    return { actualizados: 0, altas: 0, bajas: 0, errores: [err.message] };
  }
}

export async function renderizarPlantelImportar(contenedor) {
  let planes = [];     // uno por empresa cargada
  let seleccion = new Set();

  contenedor.innerHTML = `
    <div class="pind__sec plimp">
      <h2 class="pind__sec-tit">Actualizar el plantel desde Excel</h2>
      <p class="pres__subtitulo">
        Mientras la sincronización automática con Tango no funcione, subí el Excel <strong>"Legajos de Sueldos"</strong>
        de cada empresa. Es la misma información que leía la API: quien figura queda activo con sus datos al día, y
        quien estaba activo y ya no figura pasa a baja. Antes de guardar vas a ver exactamente qué cambia.
      </p>
      <div class="plimp__archivos">
        <label class="plimp__archivo" for="plimp-file">
          <span class="plimp__archivo-tit">Elegir los Excel (uno o los dos)</span>
          <span class="plimp__archivo-sub">La empresa se reconoce por el nombre del archivo: "…Cimomet.xlsx" o "…Comoing.xlsx"</span>
          <input type="file" id="plimp-file" accept=".xlsx,.xls" multiple>
        </label>
      </div>
      <div id="plimp-estado"></div>
      <div id="plimp-preview"></div>
    </div>`;

  const estadoEl = contenedor.querySelector('#plimp-estado');
  const previewEl = contenedor.querySelector('#plimp-preview');

  contenedor.querySelector('#plimp-file').addEventListener('change', async ev => {
    const archivos = [...ev.target.files];
    previewEl.innerHTML = '';
    if (!archivos.length) return;
    estadoEl.innerHTML = '<p class="pres__loading">Leyendo los archivos…</p>';
    try {
      if (typeof XLSX === 'undefined') throw new Error('No se cargó el lector de Excel. Recargá la página.');
      const enBase = await traerEmpleados();
      planes = [];
      for (const archivo of archivos) {
        const empresa = empresaDesdeNombre(archivo.name);
        if (!empresa) throw new Error(`No sé de qué empresa es "${archivo.name}". Renombralo para que diga Cimomet o Comoing.`);
        if (planes.some(p => p.empresa === empresa)) throw new Error(`Subiste dos archivos de ${EMP_LABEL[empresa]}. Elegí uno por empresa.`);
        planes.push({ ...calcularCambios(empresa, await leerExcel(archivo), enBase), archivo: archivo.name });
      }
      // Por defecto se aplica todo; RRHH destilda lo que no quiera.
      seleccion = new Set();
      planes.forEach(p => {
        p.cambios.forEach(c => c.difs.forEach(d => seleccion.add(`${p.empresa}|${c.legajo}|${d.campo}`)));
        p.reactivar.forEach(c => seleccion.add(`${p.empresa}|${c.legajo}|reactivar`));
        p.altas.forEach(c => seleccion.add(`${p.empresa}|${c.legajo}|alta`));
        p.bajas.forEach(c => seleccion.add(`${p.empresa}|${c.legajo}|baja`));
      });
      estadoEl.innerHTML = '';
      renderPreview();
    } catch (err) {
      estadoEl.innerHTML = `<p class="pres__msg-error">${e(err.message)}</p>`;
    }
  });

  function check(clave) {
    return `<input type="checkbox" class="plimp__chk" data-clave="${e(clave)}" ${seleccion.has(clave) ? 'checked' : ''} aria-label="Aplicar este cambio">`;
  }

  function bloquePlan(p) {
    const incompleto = p.activosHoy > 0 && p.excel.size < p.activosHoy * UMBRAL_EXCEL_INCOMPLETO;
    const sinCambios = !p.altas.length && !p.reactivar.length && !p.cambios.length && !p.bajas.length;
    const fila = (clave, nombre, legajo, detalle) => `
      <li class="plimp__fila">${check(clave)}<span class="plimp__persona"><strong>${e(nombre)}</strong> <span class="plimp__leg">#${e(legajo)}</span></span><span class="plimp__detalle">${detalle}</span></li>`;
    return `
      <section class="plimp__empresa" aria-label="${EMP_LABEL[p.empresa]}">
        <header class="plimp__emp-head">
          <h3>${EMP_LABEL[p.empresa]}</h3>
          <span class="plimp__emp-sub">${e(p.archivo)} · ${p.excel.size} en el Excel · ${p.activosHoy} activos hoy en la base</span>
        </header>
        ${incompleto ? `<p class="plimp__alerta" role="alert">El Excel trae bastantes menos personas que las activas hoy (${p.excel.size} contra ${p.activosHoy}). Si se bajó con un filtro, las que faltan quedarían como baja. Revisá la lista de bajas antes de guardar.</p>` : ''}
        ${sinCambios ? '<p class="plimp__ok">✓ Sin cambios: la base ya coincide con el Excel.</p>' : ''}
        ${p.altas.length ? `<h4 class="plimp__grupo">Altas (${p.altas.length})</h4><ul class="plimp__lista">${p.altas.map(x => fila(`${p.empresa}|${x.legajo}|alta`, x.apellido_y_nombre, x.legajo, `${e(x.desc_puesto)} · ingreso ${fmtFecha(x.fecha_ingreso)}`)).join('')}</ul>` : ''}
        ${p.reactivar.length ? `<h4 class="plimp__grupo">Vuelven a estar activos (${p.reactivar.length})</h4><ul class="plimp__lista">${p.reactivar.map(x => fila(`${p.empresa}|${x.legajo}|reactivar`, x.apellido_y_nombre, x.legajo, `Figuraba de baja · ${e(x.desc_puesto)}`)).join('')}</ul>` : ''}
        ${p.cambios.length ? `<h4 class="plimp__grupo">Datos que cambian (${p.cambios.length} persona${p.cambios.length !== 1 ? 's' : ''})</h4>
          <ul class="plimp__lista">${p.cambios.flatMap(x => x.difs.map(d => fila(`${p.empresa}|${x.legajo}|${d.campo}`, x.apellido_y_nombre, x.legajo,
            `${CAMPO_LABEL[d.campo]}: <span class="plimp__antes">${e(valorLegible(d.campo, d.antes))}</span> → <span class="plimp__despues">${e(valorLegible(d.campo, d.despues))}</span>`))).join('')}</ul>
          <p class="plimp__nota">Destildá un cambio si en la base hay un dato corregido a mano que el Excel todavía trae viejo.</p>` : ''}
        ${p.bajas.length ? `<h4 class="plimp__grupo plimp__grupo--baja">Pasan a baja (${p.bajas.length})</h4><ul class="plimp__lista">${p.bajas.map(x => fila(`${p.empresa}|${x.legajo}|baja`, x.apellido_y_nombre, x.legajo, `Ya no figura en el Excel · ${e(x.desc_puesto)}`)).join('')}</ul>` : ''}
      </section>`;
  }

  function renderPreview() {
    const hayAlgo = planes.some(p => p.altas.length || p.reactivar.length || p.cambios.length || p.bajas.length);
    previewEl.innerHTML = `
      ${planes.map(bloquePlan).join('')}
      <div class="pres__carga-acciones">
        <button type="button" class="pres__btn-confirmar" id="plimp-guardar" ${hayAlgo ? '' : 'disabled'}>Guardar en el plantel</button>
      </div>
      <div id="plimp-resultado" aria-live="polite"></div>`;
    previewEl.querySelectorAll('.plimp__chk').forEach(chk => chk.addEventListener('change', () => {
      chk.checked ? seleccion.add(chk.dataset.clave) : seleccion.delete(chk.dataset.clave);
    }));
    previewEl.querySelector('#plimp-guardar').addEventListener('click', guardar);
  }

  async function guardar(ev) {
    const btn = ev.currentTarget;
    const resultadoEl = previewEl.querySelector('#plimp-resultado');
    btn.disabled = true; btn.textContent = 'Guardando…';
    const resumen = [];
    for (const p of planes) {
      const r = await aplicar(p, seleccion);
      resumen.push(`
        <div class="plimp__res ${r.errores.length ? 'plimp__res--error' : ''}">
          <strong>${EMP_LABEL[p.empresa]}:</strong> ${r.actualizados} actualizado${r.actualizados !== 1 ? 's' : ''}, ${r.altas} alta${r.altas !== 1 ? 's' : ''}, ${r.bajas} baja${r.bajas !== 1 ? 's' : ''}.
          ${r.errores.length ? `<ul>${r.errores.map(x => `<li>${e(x)}</li>`).join('')}</ul>` : ''}
        </div>`);
    }
    resultadoEl.innerHTML = `${resumen.join('')}<p class="pres__subtitulo">Para ver el plantel actualizado, recargá la página.</p>`;
    btn.textContent = 'Guardado';
  }
}
