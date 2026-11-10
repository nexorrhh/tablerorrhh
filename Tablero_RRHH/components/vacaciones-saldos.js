// Vacaciones → Saldos: días que corresponden por persona (calculado por LCT, informado por
// RRHH y ajustes autorizados, siempre por separado), comprometidos en la planificación y
// saldo. Importación del Excel de RRHH con vista previa y validación antes de guardar.
import { escaparHtml as e, htmlError } from './util.js';
import { cerrarConAnimacion } from './modal-animado.js';
import { crearOrdenTabla } from './tabla-ordenable.js';
import { cargarContexto, saldoPersona, periodosDelPlan, esActivo, importarSaldos, agregarAjuste } from '../data/vacaciones-datos.js';
import {
  estadoVac, htmlBarraFiltros, enlazarBarraFiltros, filtrarEmpleados, cargarConManejo, abrirModalPeriodo,
  fmtFecha, fmtNum, EMP_LABEL, exportarExcel,
} from './vacaciones-comun.js';
import { textoAnioVacacional } from '../data/vacaciones-reglas.js';

export async function renderizarVacacionesSaldos(contenedor) {
  let ctx = await cargarConManejo(contenedor, cargarContexto);
  if (!ctx) return;
  const orden = crearOrdenTabla('nombre');

  async function recargar() {
    const nuevo = await cargarConManejo(contenedor, cargarContexto);
    if (nuevo) { ctx = nuevo; pintar(); }
  }

  function filasCalculadas(est) {
    const escId = est.escenarioId ?? null;
    return filtrarEmpleados(ctx, est).map(emp => {
      const s = saldoPersona(ctx, emp, est.anio, escId);
      const planificados = periodosDelPlan(ctx, escId).filter(p => p.legajo === emp.legajo && p.empresa === emp.empresa && p.anio_vacacional === est.anio && esActivo(p)).length;
      return { emp, s, planificados, sector: ctx.sectorPorId.get(emp.sectorId)?.nombre || 'Sin sector' };
    });
  }

  const valor = (f, k) => ({
    nombre: f.emp.nombre, legajo: f.emp.legajo, sector: f.sector, ingreso: f.emp.fecha_ingreso || '',
    antiguedad: f.s.antiguedad ?? -1, corresponde: f.s.corresponde ?? -1, comprometido: f.s.comprometido, saldo: f.s.saldo ?? -999,
  })[k];

  function pintar() {
    const est = estadoVac.get();
    const filas = filasCalculadas(est).sort(orden.comparador(valor));
    const sinPlan = filas.filter(f => f.s.saldo > 0 && !f.planificados).length;
    const difieren = filas.filter(f => f.s.difiere).length;
    const excedidos = filas.filter(f => f.s.saldo != null && f.s.saldo < 0).length;
    const pendientes = filas.reduce((t, f) => t + Math.max(0, f.s.saldo || 0), 0);

    contenedor.innerHTML = `
      <div class="vac">
        ${htmlBarraFiltros(ctx, est)}
        <div class="vac__toolbar">
          <label class="venc__btn-pri vac__file">⬆ Importar saldos de RRHH (Excel)<input type="file" id="vac-s-file" accept=".xlsx,.xls,.csv" hidden></label>
          <button type="button" class="venc__btn-sec" id="vac-s-modelo">Planilla modelo</button>
          <span style="flex:1"></span>
          <button type="button" class="venc__btn-sec" id="vac-s-excel">⬇ Excel</button>
        </div>
        <div class="vac__kpis">
          <div class="pind__kpi"><span class="pind__kpi-num">${fmtNum(pendientes)}</span><span class="pind__kpi-lbl">Días pendientes de planificar</span></div>
          <div class="pind__kpi"><span class="pind__kpi-num">${sinPlan}</span><span class="pind__kpi-lbl">Con saldo y sin vacaciones planificadas</span></div>
          <div class="pind__kpi"><span class="pind__kpi-num" style="color:var(--color-error)">${excedidos}</span><span class="pind__kpi-lbl">Exceden su saldo</span></div>
          <div class="pind__kpi"><span class="pind__kpi-num">${difieren}</span><span class="pind__kpi-lbl">RRHH ≠ cálculo LCT</span><span class="pind__kpi-sub">revisar</span></div>
        </div>
        <div id="vac-s-import"></div>
        <div class="sol__tabla-wrap">
          <table class="sol__tabla hist__tabla vac__tabla" id="vac-s-tabla">
            <thead><tr>
              ${orden.thHtml('legajo', 'Leg.')}${orden.thHtml('nombre', 'Apellido y nombre')}${orden.thHtml('sector', 'Sector')}
              ${orden.thHtml('ingreso', 'Ingreso')}${orden.thHtml('antiguedad', 'Antig.')}
              <th title="Según LCT art. 150/151">Cálculo LCT</th><th>Informado RRHH</th><th>Ajustes</th>
              ${orden.thHtml('corresponde', 'Corresponden')}${orden.thHtml('comprometido', 'Planificados')}${orden.thHtml('saldo', 'Saldo')}
              <th title="Días con código VACACION en Tango durante el año vacacional (días hábiles, no corridos)">Tango (hábiles)</th>
              <th></th>
            </tr></thead>
            <tbody>${filas.map(({ emp, s, planificados }) => `
              <tr>
                <td>${emp.legajo}</td>
                <td><strong>${e(emp.nombre)}</strong><div class="vac__nota">${EMP_LABEL[emp.empresa] || emp.empresa} · ${e(emp.puesto)}</div></td>
                <td>${e(ctx.sectorPorId.get(emp.sectorId)?.nombre || 'Sin sector')}</td>
                <td>${fmtFecha(emp.fecha_ingreso)}</td>
                <td>${s.antiguedad ?? '—'}</td>
                <td title="${e(s.detalleCalculo || '')}">${fmtNum(s.calculado)}</td>
                <td class="${s.difiere ? 'vac__difiere' : ''}" title="${s.difiere ? 'Distinto al cálculo LCT: revisar' : ''}">${fmtNum(s.rrhh)}</td>
                <td>${s.ajustes ? (s.ajustes > 0 ? '+' : '') + s.ajustes : '—'}</td>
                <td><strong>${fmtNum(s.corresponde)}</strong><div class="vac__nota">${s.origen === 'rrhh' ? 'RRHH' : 'calculado'}</div></td>
                <td>${s.comprometido}${planificados ? `<div class="vac__nota">${planificados} período${planificados === 1 ? '' : 's'}</div>` : ''}</td>
                <td class="${s.saldo < 0 ? 'vac__neg' : s.saldo > 0 ? '' : 'vac__pos'}"><strong>${fmtNum(s.saldo)}</strong></td>
                <td>${s.tangoDiasHabiles || '—'}</td>
                <td class="vac__acciones">
                  <button type="button" class="venc__btn-sec" data-plan="${emp.clave}">+ Período</button>
                  <button type="button" class="venc__btn-sec" data-ajuste="${emp.clave}">Ajuste</button>
                </td>
              </tr>`).join('')}</tbody>
          </table>
        </div>
        <p class="vac__nota">"Corresponden" usa el dato informado por RRHH si existe; si no, el cálculo por LCT (antigüedad al 31/12). Los ajustes autorizados se suman aparte y quedan registrados. Planificados = días corridos en períodos no cancelados del plan elegido.</p>
      </div>`;

    enlazarBarraFiltros(contenedor, () => pintar());
    orden.wire(contenedor.querySelector('#vac-s-tabla'), pintar);
    contenedor.querySelectorAll('[data-plan]').forEach(b => b.addEventListener('click', () =>
      abrirModalPeriodo({ ctx, emp: ctx.empleadoPor.get(b.dataset.plan), escenarioId: est.escenarioId ?? null, alGuardar: recargar })));
    contenedor.querySelectorAll('[data-ajuste]').forEach(b => b.addEventListener('click', () => abrirAjuste(ctx.empleadoPor.get(b.dataset.ajuste), est.anio)));
    contenedor.querySelector('#vac-s-file').addEventListener('change', ev => { const f = ev.target.files[0]; if (f) previsualizar(f, est.anio); ev.target.value = ''; });
    contenedor.querySelector('#vac-s-modelo').addEventListener('click', () => exportarExcel('Modelo_saldos_vacaciones.xlsx', [{
      nombre: 'Saldos', filas: [['legajo', 'empresa', 'anio', 'dias'], ...ctx.empleados.map(x => [x.legajo, x.empresa, est.anio, ''])],
    }]));
    contenedor.querySelector('#vac-s-excel').addEventListener('click', () => exportarExcel(`Saldos_vacaciones_${textoAnioVacacional(est.anio).replace('/', '-')}.xlsx`, [{
      nombre: 'Saldos',
      filas: [['Legajo', 'Empresa', 'Apellido y nombre', 'Sector', 'Ingreso', 'Antigüedad', 'Cálculo LCT', 'Informado RRHH', 'Ajustes', 'Corresponden', 'Planificados', 'Saldo', 'Tango (días hábiles)'],
        ...filas.map(({ emp, s, sector }) => [emp.legajo, EMP_LABEL[emp.empresa] || emp.empresa, emp.nombre, sector, fmtFecha(emp.fecha_ingreso), s.antiguedad ?? '',
          s.calculado ?? '', s.rrhh ?? '', s.ajustes || '', s.corresponde ?? '', s.comprometido, s.saldo ?? '', s.tangoDiasHabiles || ''])],
    }]));
  }

  // ── Importación ──────────────────────────────────────────────────────────
  async function previsualizar(archivo, anioDefecto) {
    const zona = contenedor.querySelector('#vac-s-import');
    try {
      if (typeof XLSX === 'undefined') throw new Error('No se pudo cargar la librería de Excel. Recargá la página.');
      const wb = XLSX.read(new Uint8Array(await archivo.arrayBuffer()), { type: 'array' });
      const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
      if (!filas.length) throw new Error('El archivo no tiene filas.');
      const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
      const columna = (fila, nombres) => { const k = Object.keys(fila).find(c => nombres.includes(norm(c))); return k == null ? undefined : fila[k]; };

      const vistos = new Set();
      const resultado = filas.map((f, i) => {
        const legajo = Number(String(columna(f, ['legajo', 'leg', 'nrolegajo']) ?? '').trim());
        const empTxt = String(columna(f, ['empresa', 'razonsocial']) ?? '').trim().toUpperCase().replace(/[^A-Z]/g, '');
        const anio = Number(columna(f, ['anio', 'ano', 'aniovacacional', 'periodo']) || anioDefecto);
        const dias = Number(String(columna(f, ['dias', 'diascorresponden', 'diasvacaciones', 'corresponden']) ?? '').replace(',', '.'));
        const fila = { n: i + 2, legajo, empresa: null, anio, dias, estado: 'ok', mensaje: '' };
        const candidatos = ctx.empleados.filter(x => x.legajo === legajo && (!empTxt || x.empresa === (empTxt.startsWith('COMO') ? 'COMOING' : empTxt.startsWith('CIMO') ? 'CIMOMET' : empTxt)));
        if (!legajo) { fila.estado = 'error'; fila.mensaje = 'Falta el legajo'; }
        else if (!candidatos.length) { fila.estado = 'error'; fila.mensaje = 'No es un empleado activo'; }
        else if (candidatos.length > 1) { fila.estado = 'error'; fila.mensaje = 'El legajo existe en las dos empresas: indicá la empresa'; }
        else if (!Number.isFinite(dias) || dias < 0 || dias > 60) { fila.estado = 'error'; fila.mensaje = 'Días inválidos'; }
        else if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) { fila.estado = 'error'; fila.mensaje = 'Año inválido'; }
        if (candidatos.length === 1) {
          const emp = candidatos[0];
          fila.empresa = emp.empresa; fila.nombre = emp.nombre;
          const clave = `${emp.clave}|${anio}`;
          if (fila.estado === 'ok' && vistos.has(clave)) { fila.estado = 'error'; fila.mensaje = 'Repetido en el archivo'; }
          vistos.add(clave);
          if (fila.estado === 'ok') {
            const s = saldoPersona(ctx, emp, anio);
            if (s.rrhh != null && s.rrhh !== dias) { fila.estado = 'cambia'; fila.mensaje = `Ya tenía ${s.rrhh} informados`; }
            else if (s.rrhh === dias) { fila.estado = 'igual'; fila.mensaje = 'Sin cambios'; }
            else if (s.calculado != null && s.calculado !== dias) { fila.mensaje = `El cálculo LCT da ${s.calculado}`; }
          }
        }
        return fila;
      });

      const errores = resultado.filter(r => r.estado === 'error');
      const aplicables = resultado.filter(r => r.estado === 'ok' || r.estado === 'cambia');
      const cambian = resultado.filter(r => r.estado === 'cambia').length;
      zona.innerHTML = `
        <section class="vac__panel">
          <div class="vac__panel-cab"><h3>Vista previa: ${e(archivo.name)}</h3></div>
          <p>${resultado.length} filas · <strong>${aplicables.length}</strong> se van a guardar · ${errores.length} con error (no se guardan) · ${resultado.filter(r => r.estado === 'igual').length} sin cambios</p>
          <div class="sol__tabla-wrap vac__preview"><table class="sol__tabla hist__tabla vac__tabla">
            <thead><tr><th>Fila</th><th>Legajo</th><th>Persona</th><th>Año</th><th>Días</th><th>Estado</th></tr></thead>
            <tbody>${resultado.map(r => `<tr class="vac__imp--${r.estado}"><td>${r.n}</td><td>${r.legajo || '—'}</td><td>${e(r.nombre || '')}</td><td>${r.anio ? textoAnioVacacional(r.anio) : ''}</td><td>${Number.isFinite(r.dias) ? r.dias : ''}</td><td>${{ ok: '✓ Nuevo', cambia: '⚠ Reemplaza', igual: '= Igual', error: '✕ Error' }[r.estado]} ${e(r.mensaje)}</td></tr>`).join('')}</tbody>
          </table></div>
          ${cambian ? `<label class="vac__check"><input type="checkbox" id="vac-s-reemp"> Reemplazar los ${cambian} saldos ya informados (si no lo marcás, no se guarda nada)</label>` : ''}
          <div class="vac__form-linea">
            <button type="button" class="venc__btn-sec" id="vac-s-cancel">Cancelar</button>
            <button type="button" class="venc__btn-pri" id="vac-s-ok" ${aplicables.length ? '' : 'disabled'}>Guardar ${aplicables.length} saldos</button>
          </div>
          <div id="vac-s-msg"></div>
        </section>`;
      zona.querySelector('#vac-s-cancel').addEventListener('click', () => { zona.innerHTML = ''; });
      zona.querySelector('#vac-s-ok').addEventListener('click', async ev => {
        ev.target.disabled = true;
        try {
          const res = await importarSaldos(aplicables.map(r => ({ legajo: r.legajo, empresa: r.empresa, anio_vacacional: r.anio, dias_corresponden: r.dias })),
            archivo.name, !!zona.querySelector('#vac-s-reemp')?.checked);
          await recargar();
          contenedor.querySelector('#vac-s-import').innerHTML = `<div class="vac__alerta vac__alerta--ok">Importación #${res.importacion}: ${res.aplicadas} saldos guardados${res.reemplazadas ? ` (${res.reemplazadas} reemplazados)` : ''}.</div>`;
        } catch (err) {
          ev.target.disabled = false;
          zona.querySelector('#vac-s-msg').innerHTML = htmlError('No se guardó nada.', err.message);
        }
      });
    } catch (err) {
      zona.innerHTML = htmlError('No se pudo leer el archivo.', err.message);
    }
  }

  // ── Ajuste autorizado ────────────────────────────────────────────────────
  function abrirAjuste(emp, anio) {
    const modal = document.createElement('div');
    modal.className = 'venc__modal-overlay';
    modal.innerHTML = `
      <div class="venc__modal" role="dialog" aria-modal="true">
        <h3 class="venc__modal-titulo">Ajuste de días · ${e(emp.nombre)} · ${textoAnioVacacional(anio)}</h3>
        <label class="venc__label" for="vac-aj-dias">Días a sumar (negativo para restar)</label>
        <input class="venc__input" type="number" id="vac-aj-dias" step="1">
        <label class="venc__label" for="vac-aj-motivo">Motivo</label>
        <input class="venc__input" id="vac-aj-motivo" placeholder="Ej. días pendientes del año anterior, acuerdo, licencia">
        <label class="venc__label" for="vac-aj-aut">Autorizado por</label>
        <input class="venc__input" id="vac-aj-aut">
        <div id="vac-aj-msg"></div>
        <div class="venc__modal-footer">
          <button type="button" class="venc__btn-sec" id="vac-aj-cancel">Cancelar</button>
          <button type="button" class="venc__btn-pri" id="vac-aj-ok">Guardar ajuste</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    const cerrar = () => cerrarConAnimacion(modal, () => modal.remove());
    modal.addEventListener('click', ev => { if (ev.target === modal) cerrar(); });
    modal.querySelector('#vac-aj-cancel').addEventListener('click', cerrar);
    setTimeout(() => modal.querySelector('#vac-aj-dias').focus(), 40);
    modal.querySelector('#vac-aj-ok').addEventListener('click', async () => {
      const dias = Number(modal.querySelector('#vac-aj-dias').value);
      const motivo = modal.querySelector('#vac-aj-motivo').value.trim();
      const aut = modal.querySelector('#vac-aj-aut').value.trim();
      if (!dias || !motivo || !aut) { modal.querySelector('#vac-aj-msg').innerHTML = '<div class="vac__alerta vac__alerta--bloq">Completá días (distinto de 0), motivo y quién lo autoriza.</div>'; return; }
      try { await agregarAjuste({ legajo: emp.legajo, empresa: emp.empresa, anio, dias, motivo, autorizadoPor: aut }); cerrar(); await recargar(); }
      catch (err) { modal.querySelector('#vac-aj-msg').innerHTML = htmlError('No se pudo guardar.', err.message); }
    });
  }

  pintar();
}
