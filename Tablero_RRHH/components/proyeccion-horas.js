// Proyección de horas por puesto y mes. Port de panel-produccion → Planificación →
// Capacidad (misma lógica y misma pantalla), con un agregado: se pueden descontar las
// vacaciones de un plan del módulo Vacaciones (oficial o escenario).
// Cada mes se muestra según dónde cae respecto de hoy:
//   - pasado: horas reales de Tango (trabajadas sin extras / esperadas);
//   - en curso: lo real hasta la última sincronización + lo proyectado para los días que faltan;
//   - futuro: proyección (jornada × días hábiles, menos vacaciones y ausentismo).
import { escaparHtml as e, htmlError } from './util.js';
import { cargarDatosProyeccion, MESES_HISTORICOS } from '../data/proyeccion-horas-datos.js';
import {
  periodoActual, sumarMeses, mesesDesde, diasHabilesDelMes, feriadosHabilesDelMes, tipoPuesto,
  capacidadPorPuesto, horasPorSemana, describirJornada, horasSemanales, proyeccionPorGrupo,
  diasDeVacacionesPorPersona,
} from '../data/proyeccion-horas.js';
import { sbTraerTodoCache } from '../data/supabase-rest.js';
import { vacacionesConfig } from '../config/vacaciones.js';
import { estadoVac } from './vacaciones-comun.js';

const HORIZONTES = [3, 6, 12];
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const DIAS_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const SIN_DATO = { esperadas: 0, trabajadas: 0 };

export const fmtHs = v => Math.round(Number(v) || 0).toLocaleString('es-AR') + ' h';
export const fmtPct = v => Math.round((Number(v) || 0) * 100) + '%';
export const fmtPeriodo = p => { const [a, m] = p.split('-').map(Number); return `${MESES[m - 1]} ${a}`; };
export const fmtPeriodoCorto = p => { const [a, m] = p.split('-').map(Number); return `${MESES_CORTOS[m - 1]} ${String(a).slice(2)}`; };
const fmtDiaMes = iso => { const [, m, d] = iso.split('-').map(Number); return `${d}/${m}`; };
const fmtFecha = iso => { const [a, m, d] = iso.split('-').map(Number); return `${DIAS_CORTOS[new Date(Date.UTC(a, m - 1, d)).getUTCDay()]} ${d}/${m}/${a}`; };

// Planes de vacaciones (oficial + escenarios) para el selector. Opcional: si las tablas
// vac_ no están, la pantalla funciona igual que en el panel (sin descontar vacaciones).
async function cargarPlanes() {
  try {
    const [periodos, escenarios] = await Promise.all([
      sbTraerTodoCache('vac_periodos?select=legajo,empresa,desde,hasta,estado,escenario_id&order=id.asc'),
      sbTraerTodoCache('vac_escenarios?select=id,nombre,estado&order=id.asc'),
    ]);
    const activos = new Set(vacacionesConfig.estadosActivos);
    return { periodos: periodos.filter(p => activos.has(p.estado)), escenarios: escenarios.filter(s => s.estado !== 'descartado') };
  } catch (err) {
    console.warn('Proyección: sin planes de vacaciones', err);
    return null;
  }
}

export async function renderizarProyeccionHoras(contenedor) {
  contenedor.innerHTML = '<div class="pres__loading">Calculando capacidad…</div>';
  let datos, planes;
  try {
    [datos, planes] = await Promise.all([cargarDatosProyeccion(), cargarPlanes()]);
  } catch (err) {
    console.error(err);
    contenedor.innerHTML = htmlError('No se pudieron cargar los datos de horas.', err.message);
    return;
  }

  const actual = periodoActual();
  const est = estadoVac.get();
  const ui = {
    desde: actual, cantidad: 6, aplicarAusentismo: true, tipo: '', abierto: null,
    // Por defecto, el plan elegido en Vacaciones ('' = no descontar, 'oficial', o id de escenario).
    plan: planes ? (est.escenarioId != null ? String(est.escenarioId) : 'oficial') : '',
  };
  const opcionesDesde = mesesDesde(sumarMeses(actual, -MESES_HISTORICOS), 16);

  function pintar() {
    const { empleados, mapaClasif, resolverJornada, ausentismo, real, ultimaFechaHoras, feriados, feriadosSet } = datos;
    const meses = mesesDesde(ui.desde, ui.cantidad);
    const columnas = meses.map(p => {
      const dias = diasHabilesDelMes(p, feriadosSet);
      const clase = p < actual ? 'real' : p === actual ? 'curso' : 'futuro';
      return {
        periodo: p, clase, dias,
        // En el mes en curso solo se proyectan los días posteriores al último que trajo Tango.
        restantes: clase === 'real' ? [] : clase === 'curso' ? dias.filter(f => !ultimaFechaHoras || f > ultimaFechaHoras) : dias,
        feriados: feriadosHabilesDelMes(p, feriados),
      };
    });

    const periodosPlan = !planes || !ui.plan ? []
      : planes.periodos.filter(p => (p.escenario_id == null ? 'oficial' : String(p.escenario_id)) === ui.plan);
    const diasVac = diasDeVacacionesPorPersona(periodosPlan);
    const conVac = ui.plan !== '';

    const porPuesto = capacidadPorPuesto({ empleados, resolverJornada, ausentismo, aplicarAusentismo: ui.aplicarAusentismo });
    const proy = proyeccionPorGrupo({
      personas: empleados.map(x => ({ ...x, grupo: x.desc_puesto })),
      resolverJornada, ausentismo, aplicarAusentismo: ui.aplicarAusentismo, diasVac,
      columnas: columnas.map(c => ({ periodo: c.periodo, dias: c.restantes })),
    });

    const puestos = new Set(porPuesto.keys());
    // Puestos sin gente activa hoy pero con horas reales en los meses visibles (personas que se fueron).
    real.forEach((porMes, puesto) => { if (columnas.some(c => c.clase !== 'futuro' && porMes.has(c.periodo))) puestos.add(puesto); });

    const filas = [...puestos]
      .filter(puesto => !ui.tipo || tipoPuesto(puesto, mapaClasif) === ui.tipo)
      .map(puesto => {
        const cap = porPuesto.get(puesto);
        const pg = proy.grupos.get(puesto);
        const porDiaTeorica = cap?.porDiaTeorica || [0, 0, 0, 0, 0, 0, 0];
        return {
          puesto, personas: cap?.personas || [], ausentismo: cap?.ausentismo || 0, porDiaTeorica,
          porMes: columnas.map((c, i) => ({
            ...(c.clase === 'futuro' ? SIN_DATO : real.get(puesto)?.get(c.periodo) || SIN_DATO),
            teoricas: pg?.porMes[i].teoricas || 0,
            vacaciones: pg?.porMes[i].vacaciones || 0,
            deVacaciones: pg?.porMes[i].deVacaciones || 0,
            disponibles: pg?.porMes[i].disponibles || 0,
          })),
        };
      })
      .sort((a, b) => horasPorSemana(b.porDiaTeorica) - horasPorSemana(a.porDiaTeorica)
        || b.porMes.reduce((s, m) => s + m.trabajadas, 0) - a.porMes.reduce((s, m) => s + m.trabajadas, 0));

    const totales = columnas.map((_, i) => filas.reduce((t, f) => {
      const m = f.porMes[i];
      return {
        esperadas: t.esperadas + m.esperadas, trabajadas: t.trabajadas + m.trabajadas, teoricas: t.teoricas + m.teoricas,
        vacaciones: t.vacaciones + m.vacaciones, deVacaciones: t.deVacaciones + m.deVacaciones, disponibles: t.disponibles + m.disponibles,
      };
    }, { esperadas: 0, trabajadas: 0, teoricas: 0, vacaciones: 0, deVacaciones: 0, disponibles: 0 }));
    const personas = filas.reduce((s, f) => s + f.personas.length, 0);

    // Los KPIs hablan del mes en curso si está en el rango; si no, del primero.
    const iRef = Math.max(0, columnas.findIndex(c => c.clase === 'curso'));
    const colRef = columnas[iRef], totRef = totales[iRef];
    const claseCol = c => (c.clase === 'curso' ? 'ph__col-actual' : c.clase === 'real' ? 'ph__col-real' : '');
    const nombrePlan = !ui.plan ? '' : ui.plan === 'oficial' ? 'de la planificación oficial'
      : `del escenario "${planes.escenarios.find(s => String(s.id) === ui.plan)?.nombre || ui.plan}"`;
    const descuentos = [conVac ? `sin las vacaciones ${e(nombrePlan)}` : '', ui.aplicarAusentismo ? 'descontando ausentismo histórico' : ''].filter(Boolean);
    const leyendaDescuentos = descuentos.length ? ` (${descuentos.join(' y ')})` : '';

    contenedor.innerHTML = `
      <div class="ph">
        <div class="ph__filtros">
          <label class="vac__campo">Desde
            <select class="venc__input" data-ph="desde">
              ${opcionesDesde.map(p => `<option value="${p}" ${p === ui.desde ? 'selected' : ''}>${fmtPeriodo(p)}${p === actual ? ' (actual)' : ''}</option>`).join('')}
            </select></label>
          <label class="vac__campo">Meses
            <select class="venc__input" data-ph="cantidad">
              ${HORIZONTES.map(n => `<option ${n === ui.cantidad ? 'selected' : ''}>${n}</option>`).join('')}
            </select></label>
          <div class="ph__pills" role="group" aria-label="Tipo de personal">
            ${[['', 'Todos'], ['quincenal', 'Quincenales'], ['mensual', 'Mensuales']].map(([k, l]) =>
              `<button type="button" class="${ui.tipo === k ? 'activo' : ''}" data-tipo="${k}" aria-pressed="${ui.tipo === k}">${l}</button>`).join('')}
          </div>
          ${planes ? `
          <label class="vac__campo">Vacaciones
            <select class="venc__input" data-ph="plan">
              <option value="" ${ui.plan === '' ? 'selected' : ''}>No descontar</option>
              <option value="oficial" ${ui.plan === 'oficial' ? 'selected' : ''}>Planificación oficial</option>
              ${planes.escenarios.map(s => `<option value="${s.id}" ${ui.plan === String(s.id) ? 'selected' : ''}>Escenario: ${e(s.nombre)}</option>`).join('')}
            </select></label>` : ''}
          <label class="ph__toggle"><input type="checkbox" data-ph="aus" ${ui.aplicarAusentismo ? 'checked' : ''}> Descontar ausentismo histórico</label>
        </div>

        ${datos.sinFeriados ? '<div class="vac__aviso">No se pudieron leer los feriados: se calcula sin feriados.</div>' : ''}

        <div class="ph__kpis">
          <div class="ph__kpi"><span class="ph__kpi-lbl">Días hábiles · ${fmtPeriodo(colRef.periodo)}</span><b>${colRef.dias.length}</b>
            <span class="ph__kpi-sub">${colRef.clase === 'curso' ? `quedan ${colRef.restantes.length} por cumplir`
              : colRef.feriados.length ? `${colRef.feriados.length} feriado(s) en semana` : 'sin feriados en semana'}</span></div>
          <div class="ph__kpi"><span class="ph__kpi-lbl">Personas activas</span><b>${personas}</b>
            <span class="ph__kpi-sub">jornada fija, no la de Tango</span></div>
          ${htmlKpisMes(colRef, totRef, ultimaFechaHoras, ui.aplicarAusentismo, conVac)}
        </div>

        <p class="ph__leyenda">
          <span class="ph__tag ph__tag--real">real</span> meses cerrados: horas trabajadas sin extras, de las esperadas según Tango.
          <span class="ph__tag ph__tag--curso">en curso</span> lo trabajado hasta ${ultimaFechaHoras ? `el ${fmtDiaMes(ultimaFechaHoras)}` : 'la última sincronización'}
          y, en azul, lo que queda por cumplir. <span class="ph__tag">proyectado</span> horas disponibles${leyendaDescuentos},
          de las teóricas (jornada × días hábiles).
        </p>

        <div class="ph__scroll">
          <table class="ph__tabla">
            <thead>
              <tr><th>Puesto</th>${columnas.map(c => `<th class="${claseCol(c)}">${fmtPeriodoCorto(c.periodo)}
                <span class="ph__tag ph__tag--col ${c.clase === 'futuro' ? '' : `ph__tag--${c.clase}`}">${c.clase === 'real' ? 'real' : c.clase === 'curso' ? 'en curso' : 'proyectado'}</span></th>`).join('')}</tr>
              <tr class="ph__fila-dias"><td>Días hábiles</td>${columnas.map(c => `<td class="${claseCol(c)}"
                title="${e(c.feriados.map(f => `${fmtFecha(f.fecha)} — ${f.descripcion || ''}`).join('\n') || 'Sin feriados en semana')}">${c.dias.length}
                ${c.clase === 'curso' ? `<span class="ph__marca ph__azul">quedan ${c.restantes.length}</span>` : ''}
                ${c.feriados.length ? `<span class="ph__marca">${c.feriados.length} fer.</span>` : ''}</td>`).join('')}</tr>
            </thead>
            <tbody>
              ${filas.map(f => `
                <tr class="ph__fila-clic" data-puesto="${e(f.puesto)}" tabindex="0" aria-expanded="${ui.abierto === f.puesto}">
                  <td><span class="ph__chevron ${ui.abierto === f.puesto ? 'abierto' : ''}">▸</span> <b>${e(f.puesto)}</b> <span class="ph__gris">· ${f.personas.length}</span>
                    ${ui.aplicarAusentismo && f.ausentismo > 0 ? `<span class="ph__gris"> · aus. ${fmtPct(f.ausentismo)}</span>` : ''}</td>
                  ${f.porMes.map((m, i) => `<td class="${claseCol(columnas[i])}">${htmlCelda(columnas[i].clase, m, ui.aplicarAusentismo, conVac)}</td>`).join('')}
                </tr>
                ${ui.abierto === f.puesto ? `<tr class="ph__fila-detalle"><td colspan="${columnas.length + 1}">${f.personas.length ? `
                  <ul class="ph__personas">${f.personas.map(p => `<li><span>${e(p.apellido_y_nombre)}</span>
                    <span class="ph__gris">${e(describirJornada(p.jornada) || 'sin jornada')}</span><b>${horasSemanales(p.jornada)} h/sem</b>
                    ${p.regla !== 'General' ? `<span class="ph__chip" title="Excepción en config/proyeccion-horas.js">${e(p.regla)}</span>` : ''}</li>`).join('')}</ul>`
                  : '<span class="ph__gris">Hoy no hay personal activo en este puesto; solo tiene horas reales de meses pasados.</span>'}</td></tr>` : ''}`).join('')}
              <tr class="ph__fila-total"><td>Total</td>${totales.map((t, i) => `<td class="${claseCol(columnas[i])}">${htmlCelda(columnas[i].clase, t, ui.aplicarAusentismo, conVac)}</td>`).join('')}</tr>
            </tbody>
          </table>
        </div>
        <p class="ph__nota">Horas de lunes a viernes, sin sábados ni horas extra. Jornada proyectada fija, no la que tenga cargada cada persona en Tango: ${e(datos.textoJornada)}.
          ${conVac ? 'Las vacaciones se descuentan con la jornada de cada persona en los días hábiles que caen dentro de sus períodos.'
            : 'Las vacaciones no se descuentan (elegí un plan en "Vacaciones" para verlas).'}
          En los meses reales cada persona se cuenta en su puesto actual.</p>
      </div>`;

    contenedor.querySelectorAll('[data-ph]').forEach(el => el.addEventListener('change', () => {
      const k = el.dataset.ph;
      if (k === 'desde') ui.desde = el.value;
      if (k === 'cantidad') ui.cantidad = Number(el.value);
      if (k === 'plan') ui.plan = el.value;
      if (k === 'aus') ui.aplicarAusentismo = el.checked;
      pintar();
    }));
    contenedor.querySelectorAll('[data-tipo]').forEach(b => b.addEventListener('click', () => { ui.tipo = b.dataset.tipo; pintar(); }));
    contenedor.querySelectorAll('.ph__fila-clic').forEach(tr => {
      const alternar = () => { ui.abierto = ui.abierto === tr.dataset.puesto ? null : tr.dataset.puesto; pintar(); };
      tr.addEventListener('click', alternar);
      tr.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); alternar(); } });
    });
  }

  pintar();
}

function htmlCelda(clase, m, aplicarAusentismo, conVac) {
  if (clase === 'real') {
    if (!m.esperadas && !m.trabajadas) return '<span class="ph__gris" title="Sin horas registradas en Tango">—</span>';
    return `<b>${fmtHs(m.trabajadas)}</b><span class="ph__sub">de ${fmtHs(m.esperadas)} esperadas</span>`;
  }
  const vac = conVac && m.vacaciones > 0 ? `<span class="ph__sub ph__vac">− ${fmtHs(m.vacaciones)} vacaciones</span>` : '';
  if (clase === 'curso') {
    if (!m.esperadas && !m.trabajadas) {
      return `<span title="Este puesto no tiene horas registradas en Tango este mes"><span class="ph__gris">sin registro en Tango</span>
        <span class="ph__sub ph__azul">+ ${fmtHs(m.disponibles)} a cumplir</span>${vac}</span>`;
    }
    return `<span title="${e(`Real: ${fmtHs(m.trabajadas)} de ${fmtHs(m.esperadas)} esperadas\nA cumplir: ${fmtHs(m.disponibles)} (${fmtHs(m.teoricas)} teóricas)\nTotal estimado del mes: ${fmtHs(m.trabajadas + m.disponibles)}`)}">
      <b>${fmtHs(m.trabajadas)}</b><span class="ph__sub">de ${fmtHs(m.esperadas)} esperadas</span>
      <span class="ph__sub ph__azul">+ ${fmtHs(m.disponibles)} a cumplir</span>${vac}</span>`;
  }
  return `<span title="${e(`Teóricas: ${fmtHs(m.teoricas)}${conVac ? `\nVacaciones: − ${fmtHs(m.vacaciones)} (${m.deVacaciones} persona${m.deVacaciones === 1 ? '' : 's'})` : ''}\nDisponibles: ${fmtHs(m.disponibles)}`)}">
    <b>${fmtHs(m.disponibles)}</b>${aplicarAusentismo || (conVac && m.vacaciones > 0) ? `<span class="ph__sub">de ${fmtHs(m.teoricas)} teóricas</span>` : ''}${vac}</span>`;
}

function htmlKpisMes(col, tot, ultimaFechaHoras, aplicarAusentismo, conVac) {
  const corto = fmtPeriodoCorto(col.periodo);
  const cumplimiento = tot.esperadas > 0 ? tot.trabajadas / tot.esperadas : 0;
  const kpi = (lbl, num, sub, destacado = false) =>
    `<div class="ph__kpi ${destacado ? 'ph__kpi--destacado' : ''}"><span class="ph__kpi-lbl">${lbl}</span><b>${num}</b><span class="ph__kpi-sub">${sub}</span></div>`;
  if (col.clase === 'real') {
    return kpi(`Horas esperadas · ${corto}`, fmtHs(tot.esperadas), 'según Tango')
      + kpi(`Horas trabajadas · ${corto}`, fmtHs(tot.trabajadas), `${fmtPct(cumplimiento)} de las esperadas · sin extras`, true);
  }
  if (col.clase === 'curso') {
    return kpi(`Trabajadas · ${corto}${ultimaFechaHoras ? ` al ${fmtDiaMes(ultimaFechaHoras)}` : ''}`, fmtHs(tot.trabajadas),
      `de ${fmtHs(tot.esperadas)} esperadas (${fmtPct(cumplimiento)}) · sin extras`)
      + kpi(`A cumplir · resto de ${corto}`, fmtHs(tot.disponibles),
        `${col.restantes.length} días hábiles · total estimado ${fmtHs(tot.trabajadas + tot.disponibles)}`, true);
  }
  const descuentos = [
    conVac && tot.vacaciones > 0 ? `${fmtHs(tot.vacaciones)} de vacaciones` : '',
    aplicarAusentismo && tot.teoricas > 0 ? 'ausentismo histórico' : '',
  ].filter(Boolean);
  return kpi(`Horas teóricas · ${corto}`, fmtHs(tot.teoricas), 'jornada × días hábiles')
    + kpi(`Horas disponibles · ${corto}`, fmtHs(tot.disponibles), descuentos.length ? `descontando ${descuentos.join(' y ')}` : 'sin descuentos', true);
}
