// Vacaciones → Planificación: calendario tipo Gantt (una fila por persona, agrupadas por
// sector), con la cobertura diaria de cada sector en su fila de título. En la planificación
// oficial se edita con clic; en un escenario además se pueden arrastrar las barras.
import { vacacionesConfig } from '../config/vacaciones.js';
import { escaparHtml as e } from './util.js';
import { cargarContexto, periodosDelPlan, esActivo, esFirme, saldoPersona, guardarPeriodo } from '../data/vacaciones-datos.js';
import {
  estadoVac, htmlBarraFiltros, enlazarBarraFiltros, filtrarEmpleados, cargarConManejo, abrirModalPeriodo,
  coberturaDelPlan, fmtFecha, fmtFechaCorta, hoyISO, ESTADO_TEXTO, EMP_LABEL, exportarExcel, mesTexto,
} from './vacaciones-comun.js';
import {
  sumarDias, difDias, diasCorridos, reincorporacion, esHabil, rangoDias, lunesDe, anioVacacionalDe,
  rangoAnioVacacional, validarPeriodo, hayBloqueantes, textoAnioVacacional,
} from '../data/vacaciones-reglas.js';
import { nivelCobertura } from '../data/vacaciones-cobertura.js';

const CFG = vacacionesConfig;
const ANCHO_NOMBRE = 230;

export async function renderizarVacacionesPlanificacion(contenedor) {
  let ctx = await cargarConManejo(contenedor, cargarContexto);
  if (!ctx) return;

  const vistaInicial = () => CFG.vistas.find(v => v.id === (estadoVac.get().vista || CFG.vistaPorDefecto)) || CFG.vistas[0];

  function inicioPorDefecto(est) {
    const [ini, fin] = rangoAnioVacacional(est.anio);
    const hoy = hoyISO();
    return lunesDe(hoy >= ini && hoy <= fin ? sumarDias(hoy, -7) : ini);
  }

  async function recargar() {
    const nuevo = await cargarConManejo(contenedor, cargarContexto);
    if (nuevo) { ctx = nuevo; pintar(); }
  }

  function pintar() {
    const est = estadoVac.get();
    const vista = vistaInicial();
    const inicio = est.ganttInicio && anioVacacionalDe(est.ganttInicio) === est.anio ? est.ganttInicio : inicioPorDefecto(est);
    const fin = sumarDias(inicio, vista.dias - 1);
    const dias = rangoDias(inicio, fin);
    const px = vista.pxDia;
    const ancho = dias.length * px;
    const escId = est.escenarioId ?? null;
    const enEscenario = escId != null;
    const empleados = filtrarEmpleados(ctx, est);
    const periodos = periodosDelPlan(ctx, escId).filter(p => esActivo(p) && p.hasta >= inicio && p.desde <= fin);
    const porPersona = new Map();
    periodos.forEach(p => {
      const k = `${p.empresa}|${p.legajo}`;
      if (!porPersona.has(k)) porPersona.set(k, []);
      porPersona.get(k).push(p);
    });
    const cobertura = coberturaDelPlan(ctx, escId, inicio, fin);

    // Agrupar por sector (en el orden configurado), "Sin sector" al final.
    const grupos = [...ctx.sectoresActivos.map(s => ({ sector: s, emps: empleados.filter(x => x.sectorId === s.id) })),
      { sector: null, emps: empleados.filter(x => x.sectorId == null || !ctx.sectorPorId.get(x.sectorId)?.activo) }]
      .filter(g => g.emps.length);

    const x = iso => difDias(inicio, iso) * px;
    const fondo = dias.map(d => {
      const fer = ctx.feriados.has(d);
      const finde = !esHabil(d, new Set());
      return fer || finde ? `<span class="vac-g__dia-fondo ${fer ? 'vac-g__dia-fondo--fer' : ''}" style="left:${x(d)}px;width:${px}px" title="${fer ? e(ctx.feriadosLista.find(f => f.fecha === d)?.descripcion || 'Feriado') : ''}"></span>` : '';
    }).join('');
    const hoy = hoyISO();
    const lineaHoy = hoy >= inicio && hoy <= fin ? `<span class="vac-g__hoy" style="left:${x(hoy) + px / 2}px" title="Hoy"></span>` : '';

    // Encabezado: meses y, si entra, el número de día (o el lunes de cada semana).
    const meses = [];
    dias.forEach(d => {
      const k = d.slice(0, 7);
      if (!meses.length || meses[meses.length - 1].k !== k) meses.push({ k, desde: d, n: 0 });
      meses[meses.length - 1].n++;
    });
    const encabezadoMeses = meses.map(m => `<span class="vac-g__mes" style="left:${x(m.desde)}px;width:${m.n * px}px">${m.n * px > 60 ? `${mesTexto(m.desde)} ${m.k.slice(0, 4)}` : ''}</span>`).join('');
    const encabezadoDias = dias.map(d => {
      if (px >= 18) return `<span class="vac-g__num ${!esHabil(d, ctx.feriados) ? 'vac-g__num--no' : ''}" style="left:${x(d)}px;width:${px}px">${+d.slice(8)}</span>`;
      if (d === lunesDe(d) && px * 7 >= 28) return `<span class="vac-g__num vac-g__num--sem" style="left:${x(d)}px;width:${px * 7}px">${fmtFechaCorta(d)}</span>`;
      return '';
    }).join('');

    const filaSector = g => {
      const s = g.sector;
      if (!s) return `<div class="vac-g__fila vac-g__fila--sector"><div class="vac-g__nombre"><strong>Sin sector asignado</strong> <span class="vac-g__cant">${g.emps.length}</span></div><div class="vac-g__linea" style="width:${ancho}px"><span class="vac-g__aviso-sector">Asigná un sector en Configuración → Vacaciones para calcular su cobertura.</span></div></div>`;
      const cob = cobertura.get(s.id) || new Map();
      const celdas = [...cob.values()].map(c => {
        const nivel = nivelCobertura(c.cobertura, s);
        const tit = `${fmtFecha(c.dia)} · ${s.nombre}: ${c.disponiblesConReemplazo} de ${c.requeridos ?? '?'} requeridos (dotación ${c.dotacion}, ausentes ${c.ausentes.length}${c.reemplazos.length ? `, reemplazos ${c.reemplazos.length}` : ''})`;
        return `<span class="vac-g__cob vac-g__cob--${nivel}" style="left:${x(c.dia)}px;width:${px}px" title="${e(tit)}">${px >= 24 && c.ausentes.length ? c.ausentes.length : ''}</span>`;
      }).join('');
      const maxAus = Math.max(0, ...[...cob.values()].map(c => c.ausentes.length));
      return `<div class="vac-g__fila vac-g__fila--sector">
          <div class="vac-g__nombre"><strong>${e(s.nombre)}</strong> <span class="vac-g__cant">${g.emps.length}</span>
            ${maxAus ? `<span class="vac-g__maxaus" title="Máximo de personas ausentes a la vez en esta ventana">máx. ${maxAus} fuera</span>` : ''}</div>
          <div class="vac-g__linea" style="width:${ancho}px">${celdas}</div>
        </div>`;
    };

    const filaPersona = emp => {
      const barras = (porPersona.get(emp.clave) || []).map(p => {
        const ini = p.desde < inicio ? inicio : p.desde;
        const finB = p.hasta > fin ? fin : p.hasta;
        const ancho = (difDias(ini, finB) + 1) * px;
        const dias = diasCorridos(p.desde, p.hasta);
        const otros = periodosDelPlan(ctx, escId).filter(o => o.legajo === p.legajo && o.empresa === p.empresa && esActivo(o) && o.id !== p.id);
        const s = saldoPersona(ctx, emp, p.anio_vacacional, escId, p.id);
        const alertas = validarPeriodo({
          periodo: p, otros, saldo: s.corresponde == null ? null : { corresponde: s.corresponde, comprometidoOtros: s.comprometido },
          historial: otros.filter(o => o.anio_vacacional < p.anio_vacacional), reglas: ctx.reglas, niveles: CFG.nivelReglas,
          feriados: ctx.feriados, hoy: hoyISO(),
        });
        const icono = hayBloqueantes(alertas) ? '✕ ' : alertas.length ? '⚠ ' : '';
        const vuelve = reincorporacion(p.hasta, ctx.feriados);
        const tit = `${emp.nombre}\n${fmtFecha(p.desde)} al ${fmtFecha(p.hasta)} · ${dias} días corridos\nVuelve: ${fmtFecha(vuelve)} · ${ESTADO_TEXTO[p.estado]}${alertas.length ? '\n' + alertas.map(a => (a.nivel === 'bloqueante' ? '✕ ' : '⚠ ') + a.mensaje).join('\n') : ''}`;
        const texto = ancho >= 90 ? `${icono}${dias}d → ${fmtFechaCorta(vuelve)}` : ancho >= 34 ? `${icono}${dias}d` : icono.trim();
        return `<button type="button" class="vac-g__barra vac-g__barra--${p.estado} ${esFirme(p) ? '' : 'vac-g__barra--propuesta'} ${enEscenario ? 'vac-g__barra--movible' : ''}"
                  data-id="${p.id}" style="left:${x(ini)}px;width:${ancho}px" title="${e(tit)}" aria-label="${e(tit)}">${texto}</button>`;
      }).join('');
      return `<div class="vac-g__fila" data-clave="${emp.clave}">
          <div class="vac-g__nombre" title="${e(emp.nombre)} · ${e(emp.puesto)}"><span class="vac-g__persona">${e(emp.nombre)}</span><span class="vac-g__puesto">${EMP_LABEL[emp.empresa] || emp.empresa} · ${e(emp.puesto)}</span></div>
          <div class="vac-g__linea vac-g__linea--persona" style="width:${ancho}px">${barras}</div>
        </div>`;
    };

    const escenario = enEscenario ? ctx.escenarios.find(s => s.id === escId) : null;
    contenedor.innerHTML = `
      <div class="vac">
        ${htmlBarraFiltros(ctx, est)}
        <div class="vac__toolbar">
          <div class="vac__grupo-btn" role="group" aria-label="Vista">
            ${CFG.vistas.map(v => `<button type="button" class="plantel__pill ${v.id === vista.id ? 'plantel__pill--activo' : ''}" data-vista="${v.id}">${v.texto}</button>`).join('')}
          </div>
          <div class="vac__grupo-btn">
            <button type="button" class="venc__btn-sec" id="vac-g-prev" aria-label="Anterior">‹</button>
            <button type="button" class="venc__btn-sec" id="vac-g-hoy">Hoy</button>
            <button type="button" class="venc__btn-sec" id="vac-g-next" aria-label="Siguiente">›</button>
            <span class="vac__rango">${fmtFecha(inicio)} – ${fmtFecha(fin)}</span>
          </div>
          <span style="flex:1"></span>
          <button type="button" class="venc__btn-sec" id="vac-g-excel">⬇ Excel</button>
          <button type="button" class="venc__btn-pri" id="vac-g-nuevo">+ Nuevo período</button>
        </div>
        ${enEscenario ? `<div class="vac__banner">Estás editando el escenario <strong>${e(escenario?.nombre || '')}</strong>: los cambios no tocan la planificación oficial. Podés arrastrar las barras para mover fechas.</div>` : ''}
        <div class="vac__leyenda">
          <span class="vac-g__barra-muestra vac-g__barra--aprobado"></span> Aprobado / notificado
          <span class="vac-g__barra-muestra vac-g__barra--propuesto vac-g__barra--propuesta"></span> Propuesto / borrador
          <span class="vac-g__cob-muestra vac-g__cob--verde"></span><span class="vac-g__cob-muestra vac-g__cob--amarillo"></span><span class="vac-g__cob-muestra vac-g__cob--rojo"></span> Cobertura del sector
          <span class="vac-g__cob-muestra vac-g__cob--sin-dato"></span> Sin necesidad mínima cargada
          <span class="vac-g__dia-muestra"></span> Fin de semana / feriado
        </div>
        ${!grupos.length ? '<div class="estado-vacio"><p class="estado-vacio__texto">No hay personas con esos filtros.</p></div>' : `
        <div class="vac-g" style="--ancho-nombre:${ANCHO_NOMBRE}px">
          <div class="vac-g__scroll">
            <div class="vac-g__contenido" style="width:${ANCHO_NOMBRE + ancho}px">
              <div class="vac-g__fila vac-g__fila--cab">
                <div class="vac-g__nombre">Sector / persona</div>
                <div class="vac-g__linea vac-g__linea--cab" style="width:${ancho}px"><div class="vac-g__meses">${encabezadoMeses}</div><div class="vac-g__dias">${encabezadoDias}</div></div>
              </div>
              <div class="vac-g__cuerpo">
                <div class="vac-g__fondo" style="left:${ANCHO_NOMBRE}px;width:${ancho}px">${fondo}${lineaHoy}</div>
                ${grupos.map(g => filaSector(g) + g.emps.map(filaPersona).join('')).join('')}
              </div>
            </div>
          </div>
        </div>`}
        <p class="vac__nota">Clic en una barra para editarla · clic en un lugar vacío de una fila para crear un período desde esa semana.
          Reglas: ${ctx.reglasInfo.porDefecto ? 'valores por defecto (sin verificar por RRHH)' : `versión ${ctx.reglasInfo.version}${ctx.reglasInfo.verificadaPor ? ', verificada por ' + e(ctx.reglasInfo.verificadaPor) : ''}`}.</p>
      </div>`;

    enlazarBarraFiltros(contenedor, () => pintar());
    contenedor.querySelectorAll('[data-vista]').forEach(b => b.addEventListener('click', () => { estadoVac.set({ vista: b.dataset.vista }); pintar(); }));
    const mover = n => { estadoVac.set({ ganttInicio: sumarDias(inicio, n) }); pintar(); };
    contenedor.querySelector('#vac-g-prev').addEventListener('click', () => mover(-Math.max(7, Math.round(vista.dias * 0.75 / 7) * 7)));
    contenedor.querySelector('#vac-g-next').addEventListener('click', () => mover(Math.max(7, Math.round(vista.dias * 0.75 / 7) * 7)));
    contenedor.querySelector('#vac-g-hoy').addEventListener('click', () => { estadoVac.set({ ganttInicio: null }); pintar(); });
    contenedor.querySelector('#vac-g-nuevo').addEventListener('click', () => abrirModalPeriodo({ ctx, escenarioId: escId, alGuardar: recargar }));
    contenedor.querySelector('#vac-g-excel').addEventListener('click', () => exportar(est, escId));

    const cuerpo = contenedor.querySelector('.vac-g__cuerpo');
    if (!cuerpo) return;
    // Clic en el vacío de una fila → período nuevo desde el lunes de esa semana.
    cuerpo.addEventListener('click', ev => {
      if (ev.target.closest('.vac-g__barra')) return;
      const linea = ev.target.closest('.vac-g__linea--persona');
      if (!linea) return;
      const emp = ctx.empleadoPor.get(linea.parentElement.dataset.clave);
      const offset = ev.clientX - linea.getBoundingClientRect().left;
      const dia = sumarDias(inicio, Math.floor(offset / px));
      abrirModalPeriodo({ ctx, emp, escenarioId: escId, desde: lunesDe(dia), alGuardar: recargar });
    });
    cuerpo.querySelectorAll('.vac-g__barra').forEach(barra => enlazarBarra(barra, { px, enEscenario, escId }));
  }

  // Clic abre la edición; en un escenario, arrastrar mueve el período (mismas reglas al soltar).
  function enlazarBarra(barra, { px, enEscenario, escId }) {
    const periodo = ctx.periodos.find(p => String(p.id) === barra.dataset.id);
    const abrir = () => abrirModalPeriodo({ ctx, periodo, emp: ctx.empleadoPor.get(`${periodo.empresa}|${periodo.legajo}`), alGuardar: recargar });
    if (!enEscenario) { barra.addEventListener('click', abrir); return; }

    let x0 = null, movido = 0;
    barra.addEventListener('pointerdown', ev => { x0 = ev.clientX; movido = 0; barra.setPointerCapture(ev.pointerId); });
    barra.addEventListener('pointermove', ev => {
      if (x0 == null) return;
      movido = Math.round((ev.clientX - x0) / px);
      barra.style.transform = `translateX(${movido * px}px)`;
      barra.classList.toggle('vac-g__barra--arrastrando', movido !== 0);
    });
    barra.addEventListener('pointerup', async () => {
      if (x0 == null) return;
      x0 = null;
      if (movido === 0) { barra.style.transform = ''; abrir(); return; }
      const nuevo = { ...periodo, desde: sumarDias(periodo.desde, movido), hasta: sumarDias(periodo.hasta, movido) };
      nuevo.anio_vacacional = anioVacacionalDe(nuevo.desde);
      const emp = ctx.empleadoPor.get(`${periodo.empresa}|${periodo.legajo}`);
      const otros = periodosDelPlan(ctx, escId).filter(o => o.legajo === periodo.legajo && o.empresa === periodo.empresa && esActivo(o) && o.id !== periodo.id);
      const s = emp ? saldoPersona(ctx, emp, nuevo.anio_vacacional, escId, periodo.id) : { corresponde: null };
      const alertas = validarPeriodo({ periodo: nuevo, otros, saldo: s.corresponde == null ? null : { corresponde: s.corresponde, comprometidoOtros: s.comprometido }, reglas: ctx.reglas, niveles: CFG.nivelReglas, feriados: ctx.feriados, hoy: hoyISO() });
      if (hayBloqueantes(alertas)) {
        barra.style.transform = '';
        barra.classList.remove('vac-g__barra--arrastrando');
        alert('No se puede mover ahí:\n' + alertas.filter(a => a.nivel === 'bloqueante').map(a => '• ' + a.mensaje).join('\n'));
        return;
      }
      try {
        await guardarPeriodo({ ...nuevo, alertas_aceptadas: alertas.map(a => ({ ...a, aceptada_por: 'arrastre en escenario', fecha: new Date().toISOString() })) });
        await recargar();
      } catch (err) { alert('No se pudo mover: ' + err.message); barra.style.transform = ''; }
    });
  }

  function exportar(est, escId) {
    const periodos = periodosDelPlan(ctx, escId).filter(p => p.anio_vacacional === est.anio && esActivo(p));
    const emps = new Set(filtrarEmpleados(ctx, est).map(x => x.clave));
    const filas = [['Legajo', 'Empresa', 'Apellido y nombre', 'Sector', 'Puesto', 'Desde', 'Hasta', 'Días corridos', 'Reincorporación', 'Estado', 'Notificado', 'Observaciones']];
    periodos.filter(p => emps.has(`${p.empresa}|${p.legajo}`))
      .sort((a, b) => a.desde.localeCompare(b.desde))
      .forEach(p => {
        const emp = ctx.empleadoPor.get(`${p.empresa}|${p.legajo}`);
        filas.push([p.legajo, EMP_LABEL[p.empresa] || p.empresa, emp?.nombre || '', ctx.sectorPorId.get(emp?.sectorId)?.nombre || '',
          emp?.puesto || '', fmtFecha(p.desde), fmtFecha(p.hasta), diasCorridos(p.desde, p.hasta),
          fmtFecha(reincorporacion(p.hasta, ctx.feriados)), ESTADO_TEXTO[p.estado], fmtFecha(p.notificado_en), p.observaciones || '']);
      });
    const esc = escId != null ? ctx.escenarios.find(s => s.id === escId) : null;
    exportarExcel(`Vacaciones_${textoAnioVacacional(est.anio).replace('/', '-')}${esc ? '_' + esc.nombre : ''}.xlsx`, [{ nombre: 'Cronograma', filas }]);
  }

  pintar();
}
