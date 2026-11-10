// Vacaciones → Resumen: tarjetas, próximas salidas, semanas con riesgo (próximas 12) y
// pendientes de aprobación / datos faltantes.
import { escaparHtml as e } from './util.js';
import { cargarContexto, periodosDelPlan, esActivo, saldoPersona, cruceTangoDe, tangoSinPlanificar } from '../data/vacaciones-datos.js';
import { TEXTO_CRUCE } from '../data/vacaciones-tango.js';
import { rangoAnioVacacional } from '../data/vacaciones-reglas.js';
import {
  estadoVac, htmlBarraFiltros, enlazarBarraFiltros, filtrarEmpleados, cargarConManejo, coberturaDelPlan,
  fmtFecha, fmtFechaCorta, fmtNum, hoyISO, EMP_LABEL, ESTADO_TEXTO, abrirModalPeriodo,
} from './vacaciones-comun.js';
import { sumarDias, lunesDe, diasCorridos, reincorporacion } from '../data/vacaciones-reglas.js';
import { resumenSemanal, nivelCobertura } from '../data/vacaciones-cobertura.js';
import { cargarDatosProyeccion } from '../data/proyeccion-horas-datos.js';
import { periodoActual, mesesDesde, diasHabilesDelMes, proyeccionPorGrupo, diasDeVacacionesPorPersona } from '../data/proyeccion-horas.js';
import { fmtHs, fmtPeriodoCorto } from './proyeccion-horas.js';

// Opciones de la sección de horas: duran mientras la página esté abierta.
const horasUI = { cantidad: 6, ausentismo: true };

export async function renderizarVacacionesResumen(contenedor, irA) {
  let ctx = await cargarConManejo(contenedor, cargarContexto);
  if (!ctx) return;

  async function recargar() {
    const nuevo = await cargarConManejo(contenedor, cargarContexto);
    if (nuevo) { ctx = nuevo; pintar(); }
  }

  function pintar() {
    const est = estadoVac.get();
    const escId = est.escenarioId ?? null;
    const hoy = hoyISO();
    const emps = filtrarEmpleados(ctx, est);
    const claves = new Set(emps.map(x => x.clave));
    const plan = periodosDelPlan(ctx, escId).filter(p => esActivo(p) && claves.has(`${p.empresa}|${p.legajo}`));
    const delAnio = plan.filter(p => p.anio_vacacional === est.anio);
    const conVac = new Set(delAnio.map(p => `${p.empresa}|${p.legajo}`));
    const hoyFuera = plan.filter(p => p.desde <= hoy && p.hasta >= hoy);
    const pendientesAprob = delAnio.filter(p => p.estado === 'propuesto' || p.estado === 'borrador');
    const saldos = emps.map(x => ({ x, s: saldoPersona(ctx, x, est.anio, escId) }));
    const diasPendientes = saldos.reduce((t, { s }) => t + Math.max(0, s.saldo || 0), 0);
    const sinPlan = saldos.filter(({ x, s }) => s.saldo > 0 && !conVac.has(x.clave));
    const sinSector = ctx.empleados.filter(x => x.sectorId == null).length;
    const proximas = plan.filter(p => p.desde >= hoy && p.desde <= sumarDias(hoy, 45)).sort((a, b) => a.desde.localeCompare(b.desde));

    // Próximas 12 semanas.
    const lunes0 = lunesDe(hoy);
    const semanas = [...Array(12)].map((_, i) => sumarDias(lunes0, i * 7));
    const sem = resumenSemanal(coberturaDelPlan(ctx, escId, lunes0, sumarDias(lunes0, 83)));
    const sectores = ctx.sectoresActivos.filter(s => !est.sectorId || String(s.id) === String(est.sectorId));
    let semanasRiesgo = 0;
    semanas.forEach(l => { if (sectores.some(s => nivelCobertura(sem.get(s.id)?.get(l)?.cobertura, s) === 'rojo')) semanasRiesgo++; });

    // Control con Tango: lo planificado que ya pasó, ¿se tomó? Y lo que Tango registra sin planificar.
    const [iniAnio] = rangoAnioVacacional(est.anio);
    const transcurridos = periodosDelPlan(ctx, null)
      .filter(p => esActivo(p) && p.anio_vacacional === est.anio && claves.has(`${p.empresa}|${p.legajo}`))
      .map(p => ({ p, c: cruceTangoDe(ctx, p, hoy) }))
      .filter(x => x.c.estado !== 'futuro');
    const sinRegistrar = transcurridos.filter(x => x.c.estado === 'no' || x.c.estado === 'parcial');
    const confirmados = transcurridos.filter(x => x.c.estado === 'ok').length;
    const sinDatosTango = transcurridos.filter(x => x.c.estado === 'sin-datos').length;
    const fueraDePlan = tangoSinPlanificar(ctx, emps, iniAnio, hoy);
    const kpi = (num, lbl, sub = '', color = '') => `<div class="pind__kpi"><span class="pind__kpi-num" ${color ? `style="color:${color}"` : ''}>${num}</span><span class="pind__kpi-lbl">${lbl}</span>${sub ? `<span class="pind__kpi-sub">${sub}</span>` : ''}</div>`;
    const nombre = p => ctx.empleadoPor.get(`${p.empresa}|${p.legajo}`)?.nombre || `Legajo ${p.legajo}`;

    contenedor.innerHTML = `
      <div class="vac">
        ${htmlBarraFiltros(ctx, est)}
        <div class="vac__kpis">
          ${kpi(emps.length, 'Empleados activos')}
          ${kpi(conVac.size, 'Con vacaciones programadas', `${emps.length ? Math.round(conVac.size / emps.length * 100) : 0}% del total`)}
          ${kpi(new Set(hoyFuera.map(p => `${p.empresa}|${p.legajo}`)).size, 'De vacaciones hoy')}
          ${kpi(fmtNum(diasPendientes), 'Días pendientes de planificar', `${sinPlan.length} personas sin fecha`)}
          ${kpi(semanasRiesgo, 'Semanas con riesgo', 'próximas 12 (algún sector en rojo)', semanasRiesgo ? 'var(--color-error)' : '')}
          ${kpi(pendientesAprob.length, 'Pendientes de aprobación', 'propuestos o borradores')}
        </div>
        ${sinSector ? `<div class="vac__aviso">${sinSector} personas sin sector asignado: no entran en el cálculo de cobertura. <button type="button" class="vac__link" data-ir="configuracion">Asignar en Configuración → Vacaciones</button></div>` : ''}
        ${ctx.reglasInfo.porDefecto ? `<div class="vac__aviso">Las reglas laborales están con los valores por defecto (LCT), sin verificar por RRHH. <button type="button" class="vac__link" data-ir="configuracion">Revisarlas</button></div>` : ''}

        <section class="vac__panel">
          <div class="vac__panel-cab"><h3>Cobertura de las próximas 12 semanas</h3><button type="button" class="vac__link" data-ir="cobertura">Ver mapa completo</button></div>
          <div class="vac-m"><table class="vac-m__tabla vac-m__tabla--mini">
            <thead><tr><th class="vac-m__sector">Sector</th>${semanas.map(l => `<th>${fmtFechaCorta(l)}</th>`).join('')}</tr></thead>
            <tbody>${sectores.map(s => `<tr><th class="vac-m__sector">${e(s.nombre)}</th>${semanas.map(l => {
              const c = sem.get(s.id)?.get(l);
              const n = c ? nivelCobertura(c.cobertura, s) : 'sin-dato';
              return `<td class="vac-m__celda vac-m__celda--${n}" title="${c ? `${c.disponiblesConReemplazo} de ${c.requeridos ?? '?'} · ${c.ausentes.length} ausentes` : ''}">${c ? (c.cobertura != null ? c.cobertura + '%' : c.ausentes.length ? `−${c.ausentes.length}` : '') : ''}</td>`;
            }).join('')}</tr>`).join('')}</tbody>
          </table></div>
        </section>

        <section class="vac__panel" id="vac-horas">
          <div class="vac__panel-cab"><h3>Horas mensuales proyectadas</h3>
            <button type="button" class="vac__link" data-ir="horas">Ver por puesto</button></div>
          <div class="pres__loading">Calculando horas…</div>
        </section>

        <div class="vac__dos">
          <section class="vac__panel">
            <div class="vac__panel-cab"><h3>Próximas salidas (45 días)</h3></div>
            ${!proximas.length ? '<p class="vac__nota">No hay salidas programadas.</p>' : `<ul class="vac__lista">${proximas.map(p => `
              <li><button type="button" class="vac__lista-btn" data-periodo="${p.id}">
                <strong>${e(nombre(p))}</strong> · ${fmtFecha(p.desde)} → vuelve ${fmtFecha(reincorporacion(p.hasta, ctx.feriados))}
                <span class="vac__chip vac__chip--${p.estado}">${ESTADO_TEXTO[p.estado]}</span> <span class="vac__nota">${diasCorridos(p.desde, p.hasta)} días</span></button></li>`).join('')}</ul>`}
          </section>
          <section class="vac__panel">
            <div class="vac__panel-cab"><h3>Pendientes de aprobación</h3></div>
            ${!pendientesAprob.length ? '<p class="vac__nota">Nada pendiente.</p>' : `<ul class="vac__lista">${pendientesAprob.sort((a, b) => a.desde.localeCompare(b.desde)).map(p => `
              <li><button type="button" class="vac__lista-btn" data-periodo="${p.id}"><strong>${e(nombre(p))}</strong> · ${fmtFecha(p.desde)} – ${fmtFecha(p.hasta)} <span class="vac__chip vac__chip--${p.estado}">${ESTADO_TEXTO[p.estado]}</span></button></li>`).join('')}</ul>`}
          </section>
        </div>

        <section class="vac__panel">
          <div class="vac__panel-cab"><h3>Control con Tango</h3>
            <span class="vac__nota">${confirmados} confirmadas${sinDatosTango ? ` · ${sinDatosTango} sin datos de Tango todavía` : ''}</span></div>
          <p class="vac__nota">Las vacaciones que ya pasaron se comparan con los días que Tango registró como VACACION. No hace falta marcarlas como tomadas: se confirman solas.</p>
          <div class="vac__dos">
            <div>
              <h4 class="vac__subtit">Planificadas que Tango no registra (${sinRegistrar.length})</h4>
              ${!sinRegistrar.length ? '<p class="vac__nota">✓ Todo lo planificado que ya pasó figura en Tango (o todavía no hay datos de esos meses).</p>' : `<ul class="vac__lista">${sinRegistrar.map(({ p, c }) => `
                <li><button type="button" class="vac__lista-btn" data-periodo="${p.id}"><strong>${e(nombre(p))}</strong> · ${fmtFecha(p.desde)} – ${fmtFecha(p.hasta)}
                  <span class="vac__tango vac__tango--${c.estado}">${TEXTO_CRUCE[c.estado]} (${c.registrados}/${c.habiles})</span></button></li>`).join('')}</ul>`}
            </div>
            <div>
              <h4 class="vac__subtit">En Tango sin planificar (${fueraDePlan.reduce((t, x) => t + x.tramos.length, 0)})</h4>
              ${!fueraDePlan.length ? '<p class="vac__nota">✓ No hay vacaciones en Tango fuera de la planificación.</p>' : `<ul class="vac__lista">${fueraDePlan.map(({ emp, tramos }) => tramos.map(t => `
                <li><button type="button" class="vac__lista-btn" data-nuevo="${emp.clave}" data-desde="${t.desde}" title="Cargarlas en la planificación"><strong>${e(emp.nombre)}</strong> · ${fmtFecha(t.desde)}${t.hasta !== t.desde ? ` – ${fmtFecha(t.hasta)}` : ''}
                  <span class="vac__nota">${t.dias} día${t.dias === 1 ? '' : 's'} hábil${t.dias === 1 ? '' : 'es'}</span></button></li>`).join('')).join('')}</ul>`}
            </div>
          </div>
        </section>

        <section class="vac__panel">
          <div class="vac__panel-cab"><h3>Con saldo y sin vacaciones planificadas (${sinPlan.length})</h3><button type="button" class="vac__link" data-ir="saldos">Ver saldos</button></div>
          ${!sinPlan.length ? '<p class="vac__nota">Todos los que tienen saldo ya tienen fecha.</p>' : `<div class="vac__chips">${sinPlan.slice(0, 60).map(({ x, s }) =>
            `<button type="button" class="vac__chip-btn" data-nuevo="${x.clave}" title="Planificar">${e(x.nombre)} <small>${s.saldo} d · ${EMP_LABEL[x.empresa] || x.empresa}</small></button>`).join('')}${sinPlan.length > 60 ? `<span class="vac__nota">y ${sinPlan.length - 60} más…</span>` : ''}</div>`}
        </section>
      </div>`;

    enlazarBarraFiltros(contenedor, () => pintar());
    contenedor.querySelectorAll('[data-ir]').forEach(b => b.addEventListener('click', () => irA?.(b.dataset.ir)));
    contenedor.querySelectorAll('[data-periodo]').forEach(b => b.addEventListener('click', () => {
      const p = ctx.periodos.find(x => String(x.id) === b.dataset.periodo);
      abrirModalPeriodo({ ctx, periodo: p, emp: ctx.empleadoPor.get(`${p.empresa}|${p.legajo}`), alGuardar: recargar });
    }));
    contenedor.querySelectorAll('[data-nuevo]').forEach(b => b.addEventListener('click', () =>
      abrirModalPeriodo({ ctx, emp: ctx.empleadoPor.get(b.dataset.nuevo), escenarioId: escId, desde: b.dataset.desde || null, alGuardar: recargar })));

    pintarHoras(contenedor.querySelector('#vac-horas'), ctx, est, emps, plan, irA);
  }

  pintar();
}

// Horas mensuales por sector con las vacaciones del plan elegido arriba (oficial o
// escenario): cuántas horas de armado, soldadura, etc. van a haber cada mes. Se carga
// aparte para no demorar el resto del resumen.
async function pintarHoras(seccion, ctx, est, emps, plan, irA) {
  let datos;
  try {
    datos = await cargarDatosProyeccion();
  } catch (err) {
    console.error(err);
    if (seccion.isConnected) seccion.querySelector('.pres__loading').outerHTML = `<p class="vac__nota">No se pudieron calcular las horas: ${e(err.message)}</p>`;
    return;
  }
  if (!seccion.isConnected) return; // se repintó mientras cargaba

  const nombreSector = id => (id == null ? 'Sin sector' : ctx.sectorPorId.get(id)?.nombre || `Sector ${id}`);
  const columnas = mesesDesde(periodoActual(), horasUI.cantidad).map(p => ({ periodo: p, dias: diasHabilesDelMes(p, datos.feriadosSet) }));
  const { grupos, totales } = proyeccionPorGrupo({
    personas: emps.map(x => ({ empresa: x.empresa, legajo: x.legajo, desc_puesto: x.puesto, grupo: x.sectorId ?? null })),
    resolverJornada: datos.resolverJornada, ausentismo: datos.ausentismo, aplicarAusentismo: horasUI.ausentismo,
    diasVac: diasDeVacacionesPorPersona(plan), columnas,
  });
  const orden = new Map(ctx.sectores.map((s, i) => [s.id, i]));
  const filas = [...grupos.values()].sort((a, b) => (orden.get(a.grupo) ?? 1e9) - (orden.get(b.grupo) ?? 1e9));
  const escId = est.escenarioId ?? null;
  const nombrePlan = escId == null ? 'de la planificación oficial' : `del escenario "${ctx.escenarios.find(s => s.id === escId)?.nombre || escId}"`;

  const celda = m => `<td class="vac-h__celda" title="${e(`Teóricas: ${fmtHs(m.teoricas)}\nVacaciones: − ${fmtHs(m.vacaciones)} (${m.deVacaciones} persona${m.deVacaciones === 1 ? '' : 's'})${horasUI.ausentismo ? `\nAusentismo histórico: − ${fmtHs(m.teoricas - m.vacaciones - m.disponibles)}` : ''}\nDisponibles: ${fmtHs(m.disponibles)}`)}">
      <b>${fmtHs(m.disponibles)}</b>
      ${m.vacaciones > 0 ? `<span class="vac-h__vac">− ${fmtHs(m.vacaciones)} vac. · ${m.deVacaciones} pers.</span>` : '<span class="vac-h__sub">sin vacaciones</span>'}
    </td>`;

  seccion.innerHTML = `
    <div class="vac__panel-cab"><h3>Horas mensuales proyectadas</h3>
      <button type="button" class="vac__link" data-ir="horas">Ver por puesto</button></div>
    <div class="vac-h__opciones">
      <label class="vac__campo">Meses
        <select class="venc__input" data-horas="cantidad">${[3, 6, 12].map(n => `<option ${n === horasUI.cantidad ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="ph__toggle"><input type="checkbox" data-horas="ausentismo" ${horasUI.ausentismo ? 'checked' : ''}> Descontar ausentismo histórico</label>
    </div>
    <p class="vac__nota">Horas disponibles de cada sector por mes con las vacaciones ${e(nombrePlan)}: jornada proyectada (${e(datos.textoJornada)}) × días hábiles (lunes a viernes, sin feriados ni horas extra), menos sus días de vacaciones${horasUI.ausentismo ? ' y el ausentismo histórico de su puesto' : ''}. Respeta los filtros de arriba.</p>
    <div class="vac-m"><table class="vac-h__tabla">
      <thead><tr><th class="vac-m__sector">Sector</th><th>Personas</th>${columnas.map(c => `<th>${fmtPeriodoCorto(c.periodo)}<span class="vac-h__sub">${c.dias.length} días háb.</span></th>`).join('')}</tr></thead>
      <tbody>
        ${filas.map(g => `<tr><th class="vac-m__sector">${e(nombreSector(g.grupo))}</th><td class="vac-h__n">${g.personas}</td>${g.porMes.map(celda).join('')}</tr>`).join('')}
        <tr class="vac-h__total"><th class="vac-m__sector">Total</th><td class="vac-h__n">${emps.length}</td>${totales.map(celda).join('')}</tr>
      </tbody>
    </table></div>`;

  seccion.querySelector('[data-horas="cantidad"]').addEventListener('change', ev => {
    horasUI.cantidad = Number(ev.target.value); pintarHoras(seccion, ctx, est, emps, plan, irA);
  });
  seccion.querySelector('[data-horas="ausentismo"]').addEventListener('change', ev => {
    horasUI.ausentismo = ev.target.checked; pintarHoras(seccion, ctx, est, emps, plan, irA);
  });
  seccion.querySelectorAll('[data-ir]').forEach(b => b.addEventListener('click', () => irA?.(b.dataset.ir)));
}
