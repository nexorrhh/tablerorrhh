// Vacaciones → Escenarios: copias de la planificación para simular alternativas sin tocar la
// oficial, comparación lado a lado y circuito presentar → aprobar. Nada se aprueba solo: la
// aprobación siempre la hace una persona y queda registrada.
import { escaparHtml as e, htmlError } from './util.js';
import {
  cargarContexto, periodosDelPlan, esActivo, saldoPersona, crearEscenario, cambiarEstadoEscenario,
  borrarEscenario, aprobarEscenario, usuarioActual,
} from '../data/vacaciones-datos.js';
import {
  estadoVac, htmlBarraFiltros, enlazarBarraFiltros, cargarConManejo, coberturaDelPlan, fmtFecha, hoyISO,
} from './vacaciones-comun.js';
import { rangoAnioVacacional, validarPeriodo, textoAnioVacacional, lunesDe } from '../data/vacaciones-reglas.js';
import { metricasEscenario } from '../data/vacaciones-cobertura.js';
import { vacacionesConfig } from '../config/vacaciones.js';

const ESTADO_ESC = { borrador: 'Borrador', presentado: 'Presentado', aprobado: 'Aprobado', descartado: 'Descartado' };

export async function renderizarVacacionesEscenarios(contenedor, irA) {
  let ctx = await cargarConManejo(contenedor, cargarContexto);
  if (!ctx) return;

  async function recargar() {
    const nuevo = await cargarConManejo(contenedor, cargarContexto);
    if (nuevo) { ctx = nuevo; pintar(); }
  }

  // Métricas de un plan (null = oficial) en la temporada del año vacacional.
  function analizar(escId, anio) {
    const [ini] = rangoAnioVacacional(anio);
    const hasta = `${anio + 1}-${ctx.reglas.otorgamientoHasta}`;
    const m = metricasEscenario(coberturaDelPlan(ctx, escId, lunesDe(ini), hasta), ctx.sectoresActivos);
    const periodos = periodosDelPlan(ctx, escId).filter(p => p.anio_vacacional === anio && esActivo(p));
    let bloq = 0, adv = 0;
    const excedidos = new Set();
    periodos.forEach(p => {
      const emp = ctx.empleadoPor.get(`${p.empresa}|${p.legajo}`);
      if (!emp) return;
      const otros = periodosDelPlan(ctx, escId).filter(o => o.legajo === p.legajo && o.empresa === p.empresa && esActivo(o) && o.id !== p.id);
      const s = saldoPersona(ctx, emp, anio, escId, p.id);
      const al = validarPeriodo({ periodo: p, otros, saldo: s.corresponde == null ? null : { corresponde: s.corresponde, comprometidoOtros: s.comprometido }, reglas: ctx.reglas, niveles: vacacionesConfig.nivelReglas, feriados: ctx.feriados, hoy: hoyISO() });
      if (al.some(a => a.nivel === 'bloqueante')) bloq++;
      else if (al.length) adv++;
      if (al.some(a => a.codigo === 'saldo')) excedidos.add(emp.clave);
    });
    return { ...m, periodos: periodos.length, personas: new Set(periodos.map(p => `${p.empresa}|${p.legajo}`)).size, bloq, adv, excedidos: excedidos.size };
  }

  function pintar() {
    const est = estadoVac.get();
    const lista = ctx.escenarios.filter(s => s.anio_vacacional === est.anio);
    const opciones = [{ id: '', nombre: 'Planificación oficial' }, ...lista.filter(s => s.estado !== 'descartado')];
    const a = est.compararA ?? '';
    const b = est.compararB ?? (lista.find(s => s.estado !== 'descartado')?.id ?? '');

    contenedor.innerHTML = `
      <div class="vac">
        ${htmlBarraFiltros(ctx, est, { plan: false, personas: false })}
        <section class="vac__panel">
          <div class="vac__panel-cab"><h3>Nuevo escenario</h3></div>
          <div class="vac__form-linea">
            <label>Nombre <input class="venc__input" id="vac-e-nombre" placeholder="Ej. Soldadura en dos turnos de enero"></label>
            <label>Descripción <input class="venc__input" id="vac-e-desc" placeholder="Opcional"></label>
            <label class="vac__check"><input type="checkbox" id="vac-e-copiar" checked> Partir de la planificación oficial</label>
            <button type="button" class="venc__btn-pri" id="vac-e-crear">Crear y abrir</button>
          </div>
          <p class="vac__nota">Un escenario es una copia para simular: se edita en Planificación (podés arrastrar las barras) y no cambia nada oficial hasta que alguien lo aprueba.</p>
        </section>

        <section class="vac__panel">
          <div class="vac__panel-cab"><h3>Escenarios ${textoAnioVacacional(est.anio)}</h3></div>
          ${!lista.length ? '<p class="vac__nota">Todavía no hay escenarios para este año.</p>' : `
          <div class="sol__tabla-wrap"><table class="sol__tabla hist__tabla vac__tabla">
            <thead><tr><th>Nombre</th><th>Estado</th><th>Períodos</th><th>Creado</th><th>Acciones</th></tr></thead>
            <tbody>${lista.map(s => `<tr>
              <td><strong>${e(s.nombre)}</strong>${s.descripcion ? `<div class="vac__nota">${e(s.descripcion)}</div>` : ''}</td>
              <td><span class="vac__chip vac__chip--${s.estado}">${ESTADO_ESC[s.estado]}</span></td>
              <td>${periodosDelPlan(ctx, s.id).filter(esActivo).length}</td>
              <td>${fmtFecha(s.creado_en)}${s.modificado_por ? `<div class="vac__nota">${e(s.modificado_por)}</div>` : ''}</td>
              <td class="vac__acciones">
                ${s.estado !== 'aprobado' && s.estado !== 'descartado' ? `<button type="button" class="venc__btn-sec" data-accion="abrir" data-id="${s.id}">Abrir</button>` : ''}
                ${s.estado === 'borrador' ? `<button type="button" class="venc__btn-sec" data-accion="presentar" data-id="${s.id}">Presentar para aprobación</button>` : ''}
                ${s.estado === 'presentado' ? `<button type="button" class="venc__btn-pri" data-accion="aprobar" data-id="${s.id}">Aprobar</button><button type="button" class="venc__btn-sec" data-accion="volver" data-id="${s.id}">Volver a borrador</button>` : ''}
                ${s.estado !== 'aprobado' && s.estado !== 'descartado' ? `<button type="button" class="venc__btn-sec" data-accion="descartar" data-id="${s.id}">Descartar</button>` : ''}
                ${s.estado !== 'aprobado' ? `<button type="button" class="venc__btn-sec vac__btn-peligro" data-accion="borrar" data-id="${s.id}">Eliminar</button>` : ''}
              </td></tr>`).join('')}</tbody>
          </table></div>`}
          <div id="vac-e-msg"></div>
        </section>

        <section class="vac__panel">
          <div class="vac__panel-cab"><h3>Comparar</h3></div>
          <div class="vac__form-linea">
            <label>A <select class="venc__input" id="vac-e-a">${opciones.map(o => `<option value="${o.id}" ${String(o.id) === String(a) ? 'selected' : ''}>${e(o.nombre)}</option>`).join('')}</select></label>
            <label>B <select class="venc__input" id="vac-e-b">${opciones.map(o => `<option value="${o.id}" ${String(o.id) === String(b) ? 'selected' : ''}>${e(o.nombre)}</option>`).join('')}</select></label>
          </div>
          <div id="vac-e-comp"></div>
        </section>
      </div>`;

    enlazarBarraFiltros(contenedor, () => pintar());
    pintarComparacion(est, a, b);
    contenedor.querySelector('#vac-e-a').addEventListener('change', ev => { estadoVac.set({ compararA: ev.target.value }); pintar(); });
    contenedor.querySelector('#vac-e-b').addEventListener('change', ev => { estadoVac.set({ compararB: ev.target.value }); pintar(); });

    contenedor.querySelector('#vac-e-crear').addEventListener('click', async ev => {
      const nombre = contenedor.querySelector('#vac-e-nombre').value.trim();
      if (!nombre) { contenedor.querySelector('#vac-e-nombre').focus(); return; }
      ev.target.disabled = true;
      try {
        const esc = await crearEscenario({ nombre, descripcion: contenedor.querySelector('#vac-e-desc').value.trim(), anio: est.anio, copiarOficial: contenedor.querySelector('#vac-e-copiar').checked, ctx });
        estadoVac.set({ escenarioId: esc.id });
        irA?.('planificacion');
      } catch (err) {
        ev.target.disabled = false;
        contenedor.querySelector('#vac-e-msg').innerHTML = htmlError('No se pudo crear el escenario.', err.message);
      }
    });

    contenedor.querySelectorAll('[data-accion]').forEach(btn => btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.id);
      const esc = ctx.escenarios.find(s => s.id === id);
      const msg = contenedor.querySelector('#vac-e-msg');
      let aviso = '';
      try {
        switch (btn.dataset.accion) {
          case 'abrir': estadoVac.set({ escenarioId: id }); irA?.('planificacion'); return;
          case 'presentar': await cambiarEstadoEscenario(id, 'presentado'); break;
          case 'volver': await cambiarEstadoEscenario(id, 'borrador'); break;
          case 'descartar': await cambiarEstadoEscenario(id, 'descartado'); break;
          case 'borrar':
            if (!confirm(`¿Eliminar el escenario "${esc.nombre}" y sus períodos simulados?`)) return;
            await borrarEscenario(id); break;
          case 'aprobar': {
            const r = analizar(id, esc.anio_vacacional);
            const extraBloq = r.bloq ? `\n\nATENCIÓN: ${r.bloq} período(s) tienen errores bloqueantes (superposición o saldo).` : '';
            if (!confirm(`¿Aprobar "${esc.nombre}"?\n\nLos períodos oficiales de las personas incluidas se cancelan y se reemplazan por los del escenario, como "Aprobado" a nombre de ${usuarioActual()}.${extraBloq}`)) return;
            const res = await aprobarEscenario(id);
            aviso = `Escenario aprobado: ${res.aprobados} períodos pasaron a la planificación oficial (${res.cancelados} reemplazados).`;
            break;
          }
        }
        if (estadoVac.get().escenarioId === id && ['borrar', 'descartar', 'aprobar'].includes(btn.dataset.accion)) estadoVac.set({ escenarioId: null });
        await recargar();
        if (aviso) contenedor.querySelector('#vac-e-msg').innerHTML = `<div class="vac__alerta vac__alerta--ok">${e(aviso)}</div>`;
      } catch (err) { msg.innerHTML = htmlError('No se pudo completar la acción.', err.message); }
    }));
  }

  function pintarComparacion(est, a, b) {
    const zona = contenedor.querySelector('#vac-e-comp');
    const idA = a === '' ? null : Number(a);
    const idB = b === '' ? null : Number(b);
    const mA = analizar(idA, est.anio);
    const mB = analizar(idB, est.anio);
    const fila = (txt, va, vb, menorEsMejor = true) => {
      const mejor = va === vb ? '' : (menorEsMejor ? (va < vb ? 'a' : 'b') : (va > vb ? 'a' : 'b'));
      return `<tr><td>${txt}</td><td class="${mejor === 'a' ? 'vac__mejor' : ''}">${va}</td><td class="${mejor === 'b' ? 'vac__mejor' : ''}">${vb}</td></tr>`;
    };
    const nombre = id => (id == null ? 'Oficial' : e(ctx.escenarios.find(s => s.id === id)?.nombre || ''));
    zona.innerHTML = `
      <div class="sol__tabla-wrap"><table class="sol__tabla hist__tabla vac__tabla vac__comp">
        <thead><tr><th>Indicador (temporada oct–abr)</th><th>A: ${nombre(idA)}</th><th>B: ${nombre(idB)}</th></tr></thead>
        <tbody>
          ${fila('Semanas en rojo (sector × semana)', mA.semanasRojas, mB.semanasRojas)}
          ${fila('Semanas en amarillo', mA.semanasAmarillas, mB.semanasAmarillas)}
          ${fila('Días hábiles con déficit (sector × día)', mA.diasDeficit, mB.diasDeficit)}
          ${fila('Personas-día faltantes', mA.faltanPersonasDia, mB.faltanPersonasDia)}
          ${fila('Reemplazos necesarios (persona-día)', mA.reemplazos, mB.reemplazos)}
          ${fila('Períodos con errores bloqueantes', mA.bloq, mB.bloq)}
          ${fila('Períodos con advertencias', mA.adv, mB.adv)}
          ${fila('Personas que exceden su saldo', mA.excedidos, mB.excedidos)}
          ${fila('Personas con vacaciones planificadas', mA.personas, mB.personas, false)}
          ${ctx.sectoresActivos.filter(s => mA.minimaPorSector.has(s.id) || mB.minimaPorSector.has(s.id)).map(s =>
            fila(`Cobertura mínima · ${e(s.nombre)} (%)`, mA.minimaPorSector.get(s.id) ?? '—', mB.minimaPorSector.get(s.id) ?? '—', false)).join('')}
        </tbody>
      </table></div>
      <p class="vac__nota">En verde, el mejor de los dos en cada indicador. Las preferencias de los trabajadores todavía no se registran: cuando se carguen, se suman a la comparación.</p>`;
  }

  pintar();
}
