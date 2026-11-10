// Piezas compartidas por las pantallas de Vacaciones: estado (año, plan, filtros), barra de
// filtros, ventana de alta/edición de un período con validación en vivo, cálculo de cobertura
// del plan y exportación a Excel.
import { vacacionesConfig } from '../config/vacaciones.js';
import { escaparHtml as e, htmlError } from './util.js';
import { cerrarConAnimacion } from './modal-animado.js';
import {
  ModuloNoInstalado, periodosDelPlan, esActivo, saldoPersona, requeridosDe, guardarPeriodo, borrarPeriodo, cruceTangoDe,
  usuarioActual, leerAuditoria,
} from '../data/vacaciones-datos.js';
import {
  diasCorridos, reincorporacion, sumarDias, anioVacacionalDe, validarPeriodo, hayBloqueantes, rangoDias,
  textoAnioVacacional, aFecha, lunesDe,
} from '../data/vacaciones-reglas.js';
import { calcularCoberturaDiaria, nivelCobertura } from '../data/vacaciones-cobertura.js';
import { TEXTO_CRUCE } from '../data/vacaciones-tango.js';

const CFG = vacacionesConfig;
export const ESTADO_TEXTO = Object.fromEntries(CFG.estados.map(s => [s.id, s.texto]));
export const EMP_LABEL = { CIMOMET: 'Cimomet', COMOING: 'Co.mo.ing' };

// ── Estado compartido entre solapas (dura la sesión del navegador) ───────────
const CLAVE_ESTADO = 'vac_estado';
function leerEstado() { try { return JSON.parse(sessionStorage.getItem(CLAVE_ESTADO)) || {}; } catch { return {}; } }
export const estadoVac = {
  get() {
    const hoy = new Date().toISOString().slice(0, 10);
    return { anio: anioVacacionalDe(hoy), escenarioId: null, empresa: '', sectorId: '', tipo: '', texto: '', ...leerEstado() };
  },
  set(cambios) {
    try { sessionStorage.setItem(CLAVE_ESTADO, JSON.stringify({ ...leerEstado(), ...cambios })); } catch { /* sin storage */ }
  },
};

export const hoyISO = () => new Date().toISOString().slice(0, 10);
export const fmtFecha = iso => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
export const fmtFechaCorta = iso => { const [, m, d] = iso.split('-'); return `${+d}/${+m}`; };
export const fmtNum = n => (n == null ? '—' : Number(n).toLocaleString('es-AR'));

export function htmlNoInstalado() {
  return `
    <div class="estado-vacio vac__instalar">
      <h3 class="estado-vacio__titulo">Falta instalar el módulo de Vacaciones</h3>
      <p class="estado-vacio__texto">Abrí Supabase → <strong>SQL Editor</strong>, pegá el contenido de
        <code>sql/vacaciones.sql</code> y apretá <strong>Run</strong>. Después recargá esta página.</p>
      <p class="estado-vacio__texto">Crea solo tablas nuevas (vac_…): no modifica la nómina ni ningún otro dato.</p>
    </div>`;
}

// Carga el contexto mostrando un error claro (o las instrucciones de instalación).
export async function cargarConManejo(contenedor, cargar) {
  contenedor.innerHTML = '<div class="pres__loading">Cargando vacaciones…</div>';
  try {
    return await cargar();
  } catch (err) {
    console.error(err);
    contenedor.innerHTML = err instanceof ModuloNoInstalado ? htmlNoInstalado() : htmlError('No se pudo cargar el módulo de Vacaciones.', err.message);
    return null;
  }
}

// ── Filtros ──────────────────────────────────────────────────────────────────
export function filtrarEmpleados(ctx, est) {
  const t = (est.texto || '').toLowerCase();
  return ctx.empleados.filter(emp =>
    (!est.empresa || emp.empresa === est.empresa) &&
    (!est.sectorId || String(emp.sectorId ?? 'sin') === String(est.sectorId)) &&
    (!est.tipo || emp.tipo === est.tipo) &&
    (!est.convenio || emp.convenio === est.convenio) &&
    (!t || emp.nombre.toLowerCase().includes(t) || String(emp.legajo).includes(t)));
}

export function aniosDisponibles(ctx) {
  const actual = anioVacacionalDe(hoyISO());
  const set = new Set([actual - 1, actual, actual + 1, ...ctx.periodos.map(p => p.anio_vacacional), ...ctx.saldos.map(s => s.anio_vacacional)]);
  return [...set].sort((a, b) => a - b);
}

// Barra superior común: año vacacional, plan (oficial / escenario) y filtros de personas.
export function htmlBarraFiltros(ctx, est, { plan = true, personas = true } = {}) {
  const escenarios = ctx.escenarios.filter(s => s.anio_vacacional === est.anio && s.estado !== 'descartado');
  return `
    <div class="vac__barra">
      <label class="vac__campo">Año vacacional
        <select class="venc__input" data-vac="anio">
          ${aniosDisponibles(ctx).map(a => `<option value="${a}" ${a === est.anio ? 'selected' : ''}>${textoAnioVacacional(a)}</option>`).join('')}
        </select>
      </label>
      ${plan ? `
      <label class="vac__campo">Plan
        <select class="venc__input" data-vac="escenarioId">
          <option value="">Planificación oficial</option>
          ${escenarios.map(s => `<option value="${s.id}" ${String(s.id) === String(est.escenarioId) ? 'selected' : ''}>Escenario: ${e(s.nombre)}</option>`).join('')}
        </select>
      </label>` : ''}
      ${personas ? `
      <label class="vac__campo">Empresa
        <select class="venc__input" data-vac="empresa">
          <option value="">Todas</option>
          ${Object.entries(EMP_LABEL).map(([k, v]) => `<option value="${k}" ${est.empresa === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
      </label>
      <label class="vac__campo">Sector
        <select class="venc__input" data-vac="sectorId">
          <option value="">Todos</option>
          ${ctx.sectoresActivos.map(s => `<option value="${s.id}" ${String(est.sectorId) === String(s.id) ? 'selected' : ''}>${e(s.nombre)}</option>`).join('')}
          <option value="sin" ${est.sectorId === 'sin' ? 'selected' : ''}>Sin sector asignado</option>
        </select>
      </label>
      <label class="vac__campo">Tipo
        <select class="venc__input" data-vac="tipo">
          <option value="">Todos</option>
          <option value="mensual" ${est.tipo === 'mensual' ? 'selected' : ''}>Mensuales</option>
          <option value="quincenal" ${est.tipo === 'quincenal' ? 'selected' : ''}>Quincenales</option>
        </select>
      </label>
      <label class="vac__campo">Convenio
        <select class="venc__input" data-vac="convenio">
          <option value="">Todos</option>
          ${CFG.convenios.map(c => `<option ${est.convenio === c ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </label>
      <label class="vac__campo vac__campo--texto">Buscar
        <input class="venc__input" data-vac="texto" type="search" placeholder="Nombre o legajo" value="${e(est.texto || '')}">
      </label>` : ''}
    </div>`;
}

export function enlazarBarraFiltros(raiz, alCambiar) {
  raiz.querySelectorAll('[data-vac]').forEach(el => {
    const evento = el.type === 'search' ? 'input' : 'change';
    el.addEventListener(evento, () => {
      const clave = el.dataset.vac;
      let valor = el.value;
      if (clave === 'anio') valor = Number(valor);
      if (clave === 'escenarioId') valor = valor ? Number(valor) : null;
      const cambios = { [clave]: valor };
      if (clave === 'anio') { cambios.escenarioId = null; cambios.ganttInicio = null; } // escenarios y vista del Gantt son por año
      estadoVac.set(cambios);
      alCambiar(clave);
    });
  });
}

// ── Cobertura de un plan en un rango ─────────────────────────────────────────
export function coberturaDelPlan(ctx, escenarioId, desde, hasta, { soloFirmes = false, reemplazo = null } = {}) {
  let periodos = periodosDelPlan(ctx, escenarioId).filter(esActivo);
  if (soloFirmes) periodos = periodos.filter(p => CFG.estadosFirmes.includes(p.estado));
  if (reemplazo) periodos = [...periodos.filter(p => p.id !== reemplazo.id), reemplazo];
  const personas = ctx.empleados.filter(x => x.sectorId != null).map(x => ({ clave: x.clave, sectorId: x.sectorId }));
  return calcularCoberturaDiaria({
    dias: rangoDias(desde, hasta), feriados: ctx.feriados, sectores: ctx.sectoresActivos, personas, periodos,
    requeridosDe: requeridosDe(ctx), competencias: ctx.competencias,
  });
}

// ── Ventana de período ───────────────────────────────────────────────────────
// Alta o edición. Valida en vivo (reglas + cobertura del sector) y no deja guardar con
// errores bloqueantes; las advertencias se pueden aceptar y quedan registradas.
export function abrirModalPeriodo({ ctx, emp = null, periodo = null, escenarioId = null, desde = null, alGuardar }) {
  document.getElementById('vac-modal-periodo')?.remove();
  const nuevo = !periodo;
  const ini = periodo?.desde || desde || lunesDe(sumarDias(hoyISO(), 60));
  const p = {
    id: periodo?.id ?? null, legajo: periodo?.legajo ?? emp?.legajo ?? null, empresa: periodo?.empresa ?? emp?.empresa ?? null,
    escenario_id: periodo ? periodo.escenario_id : escenarioId, desde: ini,
    hasta: periodo?.hasta || sumarDias(ini, CFG.duracionSugeridaDias - 1),
    estado: periodo?.estado || 'propuesto', notificado_en: periodo?.notificado_en || '', constancia: periodo?.constancia || '',
    observaciones: periodo?.observaciones || '', aprobado_por: periodo?.aprobado_por ?? null, aprobado_en: periodo?.aprobado_en ?? null,
  };
  const enEscenario = p.escenario_id != null;
  const escenario = enEscenario ? ctx.escenarios.find(s => s.id === p.escenario_id) : null;

  const modal = document.createElement('div');
  modal.id = 'vac-modal-periodo';
  modal.className = 'venc__modal-overlay';
  modal.innerHTML = `
    <div class="venc__modal vac__modal" role="dialog" aria-modal="true" aria-labelledby="vac-mp-tit">
      <h3 class="venc__modal-titulo" id="vac-mp-tit">${nuevo ? 'Nuevo período de vacaciones' : 'Período de vacaciones'}
        ${enEscenario ? `<span class="vac__chip vac__chip--esc">Escenario: ${e(escenario?.nombre || '')}</span>` : '<span class="vac__chip">Planificación oficial</span>'}</h3>
      ${p.legajo == null ? `
        <label class="venc__label" for="vac-mp-persona">Persona</label>
        <select class="venc__input" id="vac-mp-persona">
          <option value="">Elegí una persona…</option>
          ${ctx.empleados.map(x => `<option value="${x.clave}">${e(x.nombre)} — ${EMP_LABEL[x.empresa] || x.empresa} · ${e(x.puesto)}</option>`).join('')}
        </select>` : `<div class="vac__persona" id="vac-mp-persona-fija"></div>`}
      <div class="vac__fila2">
        <div><label class="venc__label" for="vac-mp-desde">Desde</label><input class="venc__input" type="date" id="vac-mp-desde" value="${p.desde}"></div>
        <div><label class="venc__label" for="vac-mp-hasta">Hasta (inclusive)</label><input class="venc__input" type="date" id="vac-mp-hasta" value="${p.hasta}"></div>
        <div><label class="venc__label" for="vac-mp-dias">Días corridos</label><input class="venc__input" type="number" min="1" max="60" id="vac-mp-dias"></div>
      </div>
      <p class="vac__nota" id="vac-mp-calc"></p>
      <p class="vac__tango" id="vac-mp-tango" hidden></p>
      <div class="vac__fila2">
        <div><label class="venc__label" for="vac-mp-estado">Estado</label>
          <select class="venc__input" id="vac-mp-estado">
            ${CFG.estados.filter(s => s.id !== 'gozado' || p.estado === 'gozado').map(s => `<option value="${s.id}" ${p.estado === s.id ? 'selected' : ''}>${s.texto}</option>`).join('')}
          </select></div>
        <div><label class="venc__label" for="vac-mp-notif">Notificado el</label><input class="venc__input" type="date" id="vac-mp-notif" value="${p.notificado_en || ''}"></div>
        <div><label class="venc__label" for="vac-mp-const">Constancia</label><input class="venc__input" id="vac-mp-const" placeholder="Ej. nota firmada, mail" value="${e(p.constancia)}"></div>
      </div>
      <label class="venc__label" for="vac-mp-obs">Observaciones</label>
      <textarea class="venc__input" id="vac-mp-obs" rows="2">${e(p.observaciones)}</textarea>
      <div class="vac__saldo" id="vac-mp-saldo"></div>
      <div class="vac__alertas" id="vac-mp-alertas" aria-live="polite"></div>
      <div class="vac__historial" id="vac-mp-hist" hidden></div>
      <div class="venc__modal-footer">
        ${!nuevo ? '<button type="button" class="venc__btn-sec vac__btn-peligro" id="vac-mp-borrar">Eliminar</button><button type="button" class="venc__btn-sec" id="vac-mp-ver-hist">Historial</button>' : ''}
        <span style="flex:1"></span>
        <button type="button" class="venc__btn-sec" id="vac-mp-cancel">Cancelar</button>
        <button type="button" class="venc__btn-pri" id="vac-mp-ok">Guardar</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  const $ = sel => modal.querySelector(sel);
  const cerrar = () => cerrarConAnimacion(modal, () => modal.remove());
  modal.addEventListener('click', ev => { if (ev.target === modal) cerrar(); });
  modal.addEventListener('keydown', ev => { if (ev.key === 'Escape') cerrar(); });
  $('#vac-mp-cancel').addEventListener('click', cerrar);

  let alertasActuales = [];
  let aceptado = false;
  let firmaAceptada = '';
  const empleado = () => ctx.empleadoPor.get(p.legajo != null ? `${p.empresa}|${p.legajo}` : $('#vac-mp-persona')?.value);

  function pintarPersona() {
    const x = empleado();
    const fija = $('#vac-mp-persona-fija');
    if (fija && x) fija.innerHTML = `<strong>${e(x.nombre)}</strong> · ${EMP_LABEL[x.empresa] || x.empresa} · ${e(x.puesto)} · ${e(ctx.sectorPorId.get(x.sectorId)?.nombre || 'Sin sector')}`;
  }

  function recalcular(origen) {
    const desdeV = $('#vac-mp-desde').value;
    let hastaV = $('#vac-mp-hasta').value;
    if (origen === 'dias' && desdeV && +$('#vac-mp-dias').value > 0) {
      hastaV = sumarDias(desdeV, +$('#vac-mp-dias').value - 1);
      $('#vac-mp-hasta').value = hastaV;
    }
    if (origen === 'desde' && desdeV && +$('#vac-mp-dias').value > 0) {
      hastaV = sumarDias(desdeV, +$('#vac-mp-dias').value - 1);
      $('#vac-mp-hasta').value = hastaV;
    }
    const ok = desdeV && hastaV && hastaV >= desdeV;
    if (ok && origen !== 'dias') $('#vac-mp-dias').value = diasCorridos(desdeV, hastaV);
    $('#vac-mp-calc').textContent = ok
      ? `${diasCorridos(desdeV, hastaV)} días corridos · vuelve a trabajar el ${fmtFecha(reincorporacion(hastaV, ctx.feriados))}`
      : '';

    const x = empleado();
    const zonaAl = $('#vac-mp-alertas');
    const zonaSal = $('#vac-mp-saldo');
    if (!x) { zonaAl.innerHTML = ''; zonaSal.innerHTML = ''; alertasActuales = []; return; }

    const anio = ok ? anioVacacionalDe(desdeV) : anioVacacionalDe(hoyISO());
    const s = saldoPersona(ctx, x, anio, p.escenario_id, p.id);
    // Si ya pasó (o está en curso): ¿Tango lo registró como vacaciones? (reemplaza a "Gozado")
    const zonaTango = $('#vac-mp-tango');
    const cruce = ok ? cruceTangoDe(ctx, { empresa: x.empresa, legajo: x.legajo, desde: desdeV, hasta: hastaV }) : null;
    zonaTango.hidden = !cruce || cruce.estado === 'futuro';
    if (cruce && cruce.estado !== 'futuro') {
      zonaTango.className = `vac__tango vac__tango--${cruce.estado}`;
      zonaTango.textContent = TEXTO_CRUCE[cruce.estado] + (cruce.habiles ? ` (${cruce.registrados} de ${cruce.habiles} días hábiles registrados como vacaciones)` : '')
        + (cruce.faltan?.length && cruce.faltan.length <= 8 ? ` · faltan: ${cruce.faltan.map(fmtFechaCorta).join(', ')}` : '');
    }
    zonaSal.innerHTML = `Año ${textoAnioVacacional(anio)}: corresponden <strong>${fmtNum(s.corresponde)}</strong>
      (${s.origen === 'rrhh' ? 'informado por RRHH' : 'calculado: ' + e(s.detalleCalculo)}${s.ajustes ? `, ajustes ${s.ajustes > 0 ? '+' : ''}${s.ajustes}` : ''})
      · comprometidos en otros períodos <strong>${s.comprometido}</strong>
      · disponibles <strong>${s.corresponde == null ? '—' : s.corresponde - s.comprometido}</strong>`;

    const propios = periodosDelPlan(ctx, p.escenario_id).filter(o => o.legajo === x.legajo && o.empresa === x.empresa && esActivo(o) && o.id !== p.id);
    const estado = $('#vac-mp-estado').value;
    const alertas = !esActivo({ estado }) ? [] : validarPeriodo({
      periodo: { desde: desdeV, hasta: hastaV, estado, notificado_en: $('#vac-mp-notif').value },
      otros: propios.filter(o => o.anio_vacacional === anio || (o.desde <= hastaV && desdeV <= o.hasta)),
      saldo: s.corresponde == null ? null : { corresponde: s.corresponde, comprometidoOtros: s.comprometido },
      historial: propios.filter(o => o.anio_vacacional < anio),
      reglas: ctx.reglas, niveles: CFG.nivelReglas, feriados: ctx.feriados, hoy: hoyISO(),
    });

    // Cobertura del sector durante el período (con este cambio aplicado).
    if (ok && esActivo({ estado }) && x.sectorId != null) {
      const sector = ctx.sectorPorId.get(x.sectorId);
      const cob = coberturaDelPlan(ctx, p.escenario_id, desdeV, hastaV, {
        reemplazo: { id: p.id ?? -1, legajo: x.legajo, empresa: x.empresa, desde: desdeV, hasta: hastaV, estado },
      }).get(x.sectorId);
      const rojos = [...(cob?.values() || [])].filter(c => nivelCobertura(c.cobertura, sector) === 'rojo');
      if (rojos.length) {
        const peor = rojos.reduce((a, b) => (a.cobertura <= b.cobertura ? a : b));
        alertas.push({ codigo: 'cobertura', nivel: CFG.nivelReglas.cobertura,
          mensaje: `${sector.nombre} queda con cobertura insuficiente ${rojos.length} día${rojos.length === 1 ? '' : 's'} hábil${rojos.length === 1 ? '' : 'es'} (peor: ${fmtFecha(peor.dia)}, ${peor.disponiblesConReemplazo} de ${peor.requeridos}).` });
      }
    }
    alertasActuales = alertas;
    const bloq = alertas.filter(a => a.nivel === 'bloqueante');
    const adv = alertas.filter(a => a.nivel !== 'bloqueante');
    // La aceptación se recuerda mientras las advertencias sean las mismas: esta zona se
    // vuelve a dibujar en cada cambio (y al apretar Guardar), y antes eso destildaba la
    // casilla y no dejaba guardar nunca.
    const firma = adv.map(a => a.mensaje).join('|');
    if (firma !== firmaAceptada) aceptado = false;
    firmaAceptada = firma;
    zonaAl.innerHTML = !alertas.length ? '<div class="vac__alerta vac__alerta--ok">✓ Cumple todas las reglas configuradas.</div>' : `
      ${bloq.map(a => `<div class="vac__alerta vac__alerta--bloq">✕ ${e(a.mensaje)}</div>`).join('')}
      ${adv.map(a => `<div class="vac__alerta vac__alerta--adv">⚠ ${e(a.mensaje)}</div>`).join('')}
      ${adv.length && !bloq.length ? `<label class="vac__aceptar"><input type="checkbox" id="vac-mp-acepto" ${aceptado ? 'checked' : ''}> Acepto las advertencias (quedan registradas con mi nombre)</label>` : ''}`;
    $('#vac-mp-acepto')?.addEventListener('change', ev => { aceptado = ev.target.checked; ev.target.closest('label').classList.remove('vac__aceptar--falta'); });
    $('#vac-mp-ok').disabled = hayBloqueantes(alertas);
  }

  ['desde', 'hasta', 'dias', 'estado', 'notif'].forEach(k => $(`#vac-mp-${k}`).addEventListener('input', () => recalcular(k)));
  $('#vac-mp-persona')?.addEventListener('change', () => recalcular('persona'));
  pintarPersona();
  recalcular('inicio');
  setTimeout(() => ($('#vac-mp-persona') || $('#vac-mp-desde')).focus({ preventScroll: true }), 40);

  $('#vac-mp-ver-hist')?.addEventListener('click', async () => {
    const zona = $('#vac-mp-hist');
    zona.hidden = false;
    zona.textContent = 'Cargando historial…';
    try {
      const filas = await leerAuditoria('vac_periodos', p.id);
      zona.innerHTML = filas.length ? `<ul>${filas.map(f => `<li>${new Date(f.fecha).toLocaleString('es-AR')} · <strong>${e(f.usuario)}</strong> · ${e(f.accion)}${f.despues ? ` → ${e(ESTADO_TEXTO[f.despues.estado] || '')} ${fmtFecha(f.despues.desde)}–${fmtFecha(f.despues.hasta)}` : ''}</li>`).join('')}</ul>` : 'Sin cambios registrados.';
    } catch (err) { zona.innerHTML = htmlError('No se pudo leer el historial.', err.message); }
  });

  $('#vac-mp-borrar')?.addEventListener('click', async () => {
    if (!confirm('¿Eliminar este período? Queda registrado en el historial.')) return;
    try { await borrarPeriodo(p.id); cerrar(); alGuardar?.(); }
    catch (err) { $('#vac-mp-alertas').innerHTML = htmlError('No se pudo eliminar.', err.message); }
  });

  $('#vac-mp-ok').addEventListener('click', async () => {
    const x = empleado();
    if (!x) { $('#vac-mp-alertas').innerHTML = '<div class="vac__alerta vac__alerta--bloq">Elegí una persona.</div>'; return; }
    recalcular('guardar');
    if (hayBloqueantes(alertasActuales)) return;
    const adv = alertasActuales.filter(a => a.nivel !== 'bloqueante');
    if (adv.length && !aceptado) {
      $('#vac-mp-acepto')?.closest('label')?.classList.add('vac__aceptar--falta');
      return;
    }
    const estado = $('#vac-mp-estado').value;
    const desdeV = $('#vac-mp-desde').value;
    const fila = {
      ...p, legajo: x.legajo, empresa: x.empresa, desde: desdeV, hasta: $('#vac-mp-hasta').value,
      anio_vacacional: anioVacacionalDe(desdeV), estado,
      notificado_en: $('#vac-mp-notif').value, constancia: $('#vac-mp-const').value.trim(), observaciones: $('#vac-mp-obs').value.trim(),
      alertas_aceptadas: adv.map(a => ({ ...a, aceptada_por: usuarioActual(), fecha: new Date().toISOString() })),
    };
    if (estado === 'aprobado' && periodo?.estado !== 'aprobado') { fila.aprobado_por = usuarioActual(); fila.aprobado_en = new Date().toISOString(); }
    const btn = $('#vac-mp-ok');
    btn.disabled = true; btn.textContent = 'Guardando…';
    try { await guardarPeriodo(fila); cerrar(); alGuardar?.(); }
    catch (err) {
      btn.disabled = false; btn.textContent = 'Guardar';
      $('#vac-mp-alertas').insertAdjacentHTML('afterbegin', htmlError('No se pudo guardar.', err.message));
    }
  });
}

// ── Exportar a Excel (SheetJS ya cargado en index.html) ──────────────────────
export function exportarExcel(nombreArchivo, hojas) {
  if (typeof XLSX === 'undefined') { alert('No se pudo cargar la librería de Excel. Recargá la página.'); return; }
  const wb = XLSX.utils.book_new();
  hojas.forEach(({ nombre, filas }) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), nombre.slice(0, 31)));
  XLSX.writeFile(wb, nombreArchivo);
}

export const mesTexto = iso => aFecha(iso).toLocaleDateString('es-AR', { month: 'long', timeZone: 'UTC' });
