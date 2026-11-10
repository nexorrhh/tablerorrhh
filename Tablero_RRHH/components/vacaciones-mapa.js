// Vacaciones → Cobertura: mapa de calor sectores × semanas. Cada celda es el PEOR día hábil
// de la semana. Al elegir una celda se ve el detalle día por día (quiénes faltan, reemplazos
// posibles) y se puede cargar la necesidad de personas de esa semana.
import { escaparHtml as e, htmlError } from './util.js';
import { cargarContexto, guardarDemanda, requeridosDe } from '../data/vacaciones-datos.js';
import {
  estadoVac, htmlBarraFiltros, enlazarBarraFiltros, cargarConManejo, coberturaDelPlan, fmtFecha, fmtFechaCorta,
  EMP_LABEL, exportarExcel, hoyISO,
} from './vacaciones-comun.js';
import { rangoAnioVacacional, sumarDias, lunesDe, textoAnioVacacional } from '../data/vacaciones-reglas.js';
import { resumenSemanal, nivelCobertura } from '../data/vacaciones-cobertura.js';
import { vacacionesConfig } from '../config/vacaciones.js';

export async function renderizarVacacionesMapa(contenedor) {
  let ctx = await cargarConManejo(contenedor, cargarContexto);
  if (!ctx) return;
  let seleccion = null; // { sectorId, lunes }

  async function recargar() {
    const nuevo = await cargarConManejo(contenedor, cargarContexto);
    if (nuevo) { ctx = nuevo; pintar(); }
  }

  function pintar() {
    const est = estadoVac.get();
    const escId = est.escenarioId ?? null;
    const [iniAnio, finAnio] = rangoAnioVacacional(est.anio);
    const temporada = est.mapaTodoElAnio ? [iniAnio, finAnio] : [iniAnio, `${est.anio + 1}-${vacacionesConfig.reglasPorDefecto.otorgamientoHasta}`];
    const desde = lunesDe(temporada[0]);
    const hasta = temporada[1];
    const porDia = coberturaDelPlan(ctx, escId, desde, hasta, { soloFirmes: !!est.mapaSoloFirmes });
    const semanal = resumenSemanal(porDia);
    const semanas = [];
    for (let l = desde; l <= hasta; l = sumarDias(l, 7)) semanas.push(l);
    const sectores = ctx.sectoresActivos.filter(s => !est.sectorId || String(s.id) === String(est.sectorId));
    const hoy = lunesDe(hoyISO());
    const sinReq = sectores.filter(s => s.requeridos_default == null);

    const celda = (s, l) => {
      const c = semanal.get(s.id)?.get(l);
      if (!c) return `<td class="vac-m__celda vac-m__celda--vacia" title="Sin días hábiles"></td>`;
      const nivel = nivelCobertura(c.cobertura, s);
      const texto = c.cobertura != null ? `${c.cobertura}%` : `${c.disponibles}/${c.dotacion}`;
      const sel = seleccion && seleccion.sectorId === s.id && seleccion.lunes === l;
      const tit = `${s.nombre} · semana del ${fmtFecha(l)}\nPeor día: ${fmtFecha(c.dia)}\nDisponibles ${c.disponiblesConReemplazo} de ${c.requeridos ?? 'sin definir'} requeridos\nDotación ${c.dotacion} · ausentes ${c.ausentes.length}${c.reemplazos.length ? ` · reemplazos ${c.reemplazos.length}` : ''}`;
      return `<td class="vac-m__celda vac-m__celda--${nivel} ${sel ? 'vac-m__celda--sel' : ''} ${l === hoy ? 'vac-m__celda--hoy' : ''}">
        <button type="button" data-sector="${s.id}" data-lunes="${l}" title="${e(tit)}" aria-label="${e(tit)}">${texto}</button></td>`;
    };

    const esc = escId != null ? ctx.escenarios.find(x => x.id === escId) : null;
    contenedor.innerHTML = `
      <div class="vac">
        ${htmlBarraFiltros(ctx, est, { personas: false })}
        <div class="vac__toolbar">
          <label class="vac__check"><input type="checkbox" id="vac-m-firmes" ${est.mapaSoloFirmes ? 'checked' : ''}> Solo vacaciones aprobadas (sin propuestas)</label>
          <label class="vac__check"><input type="checkbox" id="vac-m-anio" ${est.mapaTodoElAnio ? 'checked' : ''}> Todo el año (no solo octubre–abril)</label>
          <span style="flex:1"></span>
          <button type="button" class="venc__btn-sec" id="vac-m-excel">⬇ Excel</button>
        </div>
        ${esc ? `<div class="vac__banner">Mostrando el escenario <strong>${e(esc.nombre)}</strong>.</div>` : ''}
        ${sinReq.length ? `<div class="vac__aviso">Sin necesidad mínima cargada en: ${sinReq.map(s => e(s.nombre)).join(', ')}. Ahí se muestra "disponibles/dotación" en gris: no se puede juzgar si alcanza. Cargala en Configuración → Vacaciones o por semana tocando una celda.</div>` : ''}
        ${!ctx.hayPolivalencia ? '<div class="vac__aviso">Polivalencia no tiene competencias cargadas: no se calculan reemplazos entre sectores.</div>' : ''}
        <div class="vac-m">
          <table class="vac-m__tabla">
            <thead><tr><th class="vac-m__sector">Sector</th>${semanas.map(l => `<th class="${l === hoy ? 'vac-m__th--hoy' : ''}" title="Semana del ${fmtFecha(l)}">${fmtFechaCorta(l)}</th>`).join('')}</tr></thead>
            <tbody>${sectores.map(s => `<tr><th class="vac-m__sector">${e(s.nombre)}<span>${ctx.empleados.filter(x => x.sectorId === s.id).length} pers.${s.requeridos_default != null ? ` · mín. ${s.requeridos_default}` : ''}</span></th>${semanas.map(l => celda(s, l)).join('')}</tr>`).join('')}</tbody>
          </table>
        </div>
        <p class="vac__nota">Verde ≥ umbral verde del sector · amarillo ≥ umbral amarillo · rojo por debajo. Los umbrales son operativos (no legales) y se cambian en Configuración → Vacaciones. Cada celda muestra el peor día hábil de la semana.</p>
        <div id="vac-m-detalle"></div>
      </div>`;

    enlazarBarraFiltros(contenedor, () => { seleccion = null; pintar(); });
    contenedor.querySelector('#vac-m-firmes').addEventListener('change', ev => { estadoVac.set({ mapaSoloFirmes: ev.target.checked }); pintar(); });
    contenedor.querySelector('#vac-m-anio').addEventListener('change', ev => { estadoVac.set({ mapaTodoElAnio: ev.target.checked }); pintar(); });
    contenedor.querySelector('#vac-m-excel').addEventListener('click', () => {
      const filas = [['Sector', ...semanas.map(fmtFecha)]];
      sectores.forEach(s => filas.push([s.nombre, ...semanas.map(l => {
        const c = semanal.get(s.id)?.get(l);
        return !c ? '' : c.cobertura != null ? `${c.cobertura}%` : `${c.disponibles}/${c.dotacion}`;
      })]));
      exportarExcel(`Cobertura_${textoAnioVacacional(est.anio).replace('/', '-')}${esc ? '_' + esc.nombre : ''}.xlsx`, [{ nombre: 'Cobertura semanal', filas }]);
    });
    contenedor.querySelectorAll('.vac-m__celda button').forEach(b => b.addEventListener('click', () => {
      seleccion = { sectorId: Number(b.dataset.sector), lunes: b.dataset.lunes };
      pintar();
      contenedor.querySelector('#vac-m-detalle')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }));
    if (seleccion) pintarDetalle(porDia, est);
  }

  function pintarDetalle(porDia, est) {
    const zona = contenedor.querySelector('#vac-m-detalle');
    const s = ctx.sectorPorId.get(seleccion.sectorId);
    const diasSemana = [...(porDia.get(s.id)?.values() || [])].filter(c => lunesDe(c.dia) === seleccion.lunes);
    const nombre = clave => { const x = ctx.empleadoPor.get(clave); return x ? `${x.nombre} (${EMP_LABEL[x.empresa] || x.empresa})` : clave; };
    const reqSemana = ctx.demanda.get(`${s.id}|${seleccion.lunes}`);
    const req = requeridosDe(ctx)(s.id, seleccion.lunes);
    zona.innerHTML = `
      <section class="vac__panel">
        <div class="vac__panel-cab">
          <h3>${e(s.nombre)} · semana del ${fmtFecha(seleccion.lunes)}</h3>
          <button type="button" class="venc__btn-sec" id="vac-m-cerrar">Cerrar</button>
        </div>
        <div class="vac__demanda">
          <label>Personas requeridas esta semana
            <input class="venc__input" type="number" min="0" id="vac-m-req" value="${reqSemana ?? ''}" placeholder="${s.requeridos_default ?? 'sin definir'}">
          </label>
          <button type="button" class="venc__btn-pri" id="vac-m-req-ok">Guardar</button>
          <span class="vac__nota">Vacío = usa el mínimo del sector (${s.requeridos_default ?? 'sin definir'}). Requeridos vigentes: <strong>${req ?? 'sin definir'}</strong>.</span>
        </div>
        <div class="sol__tabla-wrap">
          <table class="sol__tabla hist__tabla vac__tabla">
            <thead><tr><th>Día</th><th>Dotación</th><th>Ausentes</th><th>Disponibles</th><th>Requeridos</th><th>Déficit / excedente</th><th>Reemplazos posibles</th></tr></thead>
            <tbody>${diasSemana.map(c => {
              const dif = c.requeridos == null ? null : c.disponiblesConReemplazo - c.requeridos;
              return `<tr>
                <td>${fmtFecha(c.dia)}</td><td>${c.dotacion}</td>
                <td>${c.ausentes.length ? c.ausentes.map(k => `<div>${e(nombre(k))}</div>`).join('') : '—'}</td>
                <td>${c.disponibles}${c.prestados ? ` <span class="vac__nota">(${c.prestados} prestado${c.prestados === 1 ? '' : 's'} a otro sector)</span>` : ''}</td>
                <td>${c.requeridos ?? '—'}</td>
                <td class="${dif == null ? '' : dif < 0 ? 'vac__neg' : 'vac__pos'}">${dif == null ? '—' : dif > 0 ? '+' + dif : dif}</td>
                <td>${c.reemplazos.length ? c.reemplazos.map(r => `<div>${e(nombre(r.clave))} <span class="vac__nota">desde ${e(ctx.sectorPorId.get(r.desdeSectorId)?.nombre || '')}</span></div>`).join('') : '—'}</td>
              </tr>`;
            }).join('')}</tbody>
          </table>
        </div>
        <p class="vac__nota">Reemplazos: personas de otros sectores con el nivel máximo en Polivalencia para este sector, que no están de vacaciones y cuyo sector tiene excedente ese día. Cada persona se cuenta una sola vez. Tener la competencia no equivale a estar habilitado para una tarea crítica: confirmalo con el responsable.</p>
      </section>`;
    zona.querySelector('#vac-m-cerrar').addEventListener('click', () => { seleccion = null; pintar(); });
    zona.querySelector('#vac-m-req-ok').addEventListener('click', async () => {
      const v = zona.querySelector('#vac-m-req').value;
      try { await guardarDemanda(s.id, seleccion.lunes, v); await recargar(); }
      catch (err) { zona.insertAdjacentHTML('afterbegin', htmlError('No se pudo guardar la necesidad de la semana.', err.message)); }
    });
  }

  pintar();
}
