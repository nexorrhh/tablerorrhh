// Vacaciones → Resumen: tarjetas, próximas salidas, semanas con riesgo (próximas 12) y
// pendientes de aprobación / datos faltantes.
import { escaparHtml as e } from './util.js';
import { cargarContexto, periodosDelPlan, esActivo, saldoPersona } from '../data/vacaciones-datos.js';
import {
  estadoVac, htmlBarraFiltros, enlazarBarraFiltros, filtrarEmpleados, cargarConManejo, coberturaDelPlan,
  fmtFecha, fmtFechaCorta, fmtNum, hoyISO, EMP_LABEL, ESTADO_TEXTO, abrirModalPeriodo,
} from './vacaciones-comun.js';
import { sumarDias, lunesDe, diasCorridos, reincorporacion } from '../data/vacaciones-reglas.js';
import { resumenSemanal, nivelCobertura } from '../data/vacaciones-cobertura.js';

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
      abrirModalPeriodo({ ctx, emp: ctx.empleadoPor.get(b.dataset.nuevo), escenarioId: escId, alGuardar: recargar })));
  }

  pintar();
}
