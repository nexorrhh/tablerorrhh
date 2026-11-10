// Vacaciones → Configuración: sectores (necesidad mínima y umbrales del mapa de calor),
// a qué sector va cada puesto de Tango, datos extra por persona (convenio, establecimiento,
// sector distinto al de su puesto) y reglas laborales versionadas.
import { escaparHtml as e, htmlError } from './util.js';
import {
  cargarContexto, guardarSector, borrarSector, guardarMapeo, guardarExtra, guardarReglas,
} from '../data/vacaciones-datos.js';
import { estadoVac, htmlBarraFiltros, enlazarBarraFiltros, filtrarEmpleados, cargarConManejo, EMP_LABEL, fmtFecha } from './vacaciones-comun.js';
import { normalizarPuesto } from '../data/vacaciones-reglas.js';
import { vacacionesConfig } from '../config/vacaciones.js';

export async function renderizarVacacionesConfig(contenedor) {
  let ctx = await cargarConManejo(contenedor, cargarContexto);
  if (!ctx) return;

  async function recargar(mensaje) {
    const nuevo = await cargarConManejo(contenedor, cargarContexto);
    if (nuevo) { ctx = nuevo; pintar(mensaje); }
  }

  function pintar(mensaje = '') {
    const est = estadoVac.get();
    const puestos = new Map();
    ctx.empleados.forEach(x => {
      const k = normalizarPuesto(x.puesto);
      if (!puestos.has(k)) puestos.set(k, { texto: x.puesto || '(sin puesto)', n: 0 });
      puestos.get(k).n++;
    });
    const tieneSector = k => ctx.mapeo.has(k) || !!ctx.grupoAutomatico(k);
    const puestosOrden = [...puestos.entries()].sort((a, b) => (tieneSector(a[0]) - tieneSector(b[0])) || b[1].n - a[1].n);
    const sinSector = puestosOrden.filter(([k]) => !tieneSector(k)).length;
    const opcionesSector = (sel, vacio = 'Sin sector') => `<option value="">${vacio}</option>` +
      ctx.sectores.map(s => `<option value="${s.id}" ${String(sel) === String(s.id) ? 'selected' : ''}>${e(s.nombre)}${s.activo ? '' : ' (inactivo)'}</option>`).join('');
    const R = ctx.reglas;

    contenedor.innerHTML = `
      <div class="vac">
        ${mensaje ? `<div class="vac__alerta vac__alerta--ok">${e(mensaje)}</div>` : ''}
        <div id="vac-c-msg"></div>

        <section class="vac__panel">
          <div class="vac__panel-cab"><h3>Sectores</h3><button type="button" class="venc__btn-sec" id="vac-c-nuevo-sector">+ Sector</button></div>
          <p class="vac__nota">"Mínimo de personas" es la necesidad operativa diaria (no legal). Sin ese dato el mapa muestra la dotación pero no juzga si alcanza. Los umbrales definen el color: verde desde el primer %, amarillo desde el segundo, rojo por debajo.</p>
          <div class="sol__tabla-wrap"><table class="sol__tabla hist__tabla vac__tabla">
            <thead><tr><th>Sector</th><th>Orden</th><th>Personas</th><th>Mínimo de personas</th><th>Verde desde %</th><th>Amarillo desde %</th><th>Activo</th><th></th></tr></thead>
            <tbody>${ctx.sectores.map(s => `<tr data-sector="${s.id}">
              <td><input class="venc__input" data-c="nombre" value="${e(s.nombre)}"></td>
              <td><input class="venc__input vac__num" type="number" data-c="orden" value="${s.orden}"></td>
              <td>${ctx.empleados.filter(x => x.sectorId === s.id).length}</td>
              <td><input class="venc__input vac__num" type="number" min="0" data-c="requeridos_default" value="${s.requeridos_default ?? ''}" placeholder="sin definir"></td>
              <td><input class="venc__input vac__num" type="number" min="0" max="200" data-c="pct_verde" value="${s.pct_verde}"></td>
              <td><input class="venc__input vac__num" type="number" min="0" max="200" data-c="pct_amarillo" value="${s.pct_amarillo}"></td>
              <td><input type="checkbox" data-c="activo" ${s.activo ? 'checked' : ''}></td>
              <td class="vac__acciones"><button type="button" class="venc__btn-pri" data-guardar-sector>Guardar</button><button type="button" class="venc__btn-sec vac__btn-peligro" data-borrar-sector>Eliminar</button></td>
            </tr>`).join('')}</tbody>
          </table></div>
        </section>

        <section class="vac__panel">
          <div class="vac__panel-cab"><h3>Puestos → sector ${sinSector ? `<span class="vac__chip vac__chip--alerta">${sinSector} sin sector</span>` : ''}</h3></div>
          <p class="vac__nota">Cada puesto de Tango se asigna a un sector. Se guarda al elegir. Los puestos que empiezan con
            ${vacacionesConfig.gruposPorPrefijo.map(g => `"${e(g.prefijo)}…" van solos a <strong>${e(g.sector)}</strong>`).join(', ')}
            (como en el tablero de Dirección). No se planifican: ${vacacionesConfig.puestosExcluidos.map(p => e(p)).join(', ')}.</p>
          <div class="vac__mapeo">${puestosOrden.map(([k, p]) => {
            const auto = ctx.grupoAutomatico(k);
            return auto
              ? `<label class="vac__mapeo-item"><span>${e(p.texto)} <small>(${p.n})</small></span>
                   <select class="venc__input" disabled title="Agrupado automáticamente"><option>${e(auto)} (automático)</option></select></label>`
              : `<label class="vac__mapeo-item ${ctx.mapeo.has(k) ? '' : 'vac__mapeo-item--falta'}"><span>${e(p.texto)} <small>(${p.n})</small></span>
                   <select class="venc__input" data-mapeo="${e(k)}">${opcionesSector(ctx.mapeo.get(k))}</select></label>`;
          }).join('')}
          </div>
        </section>

        <section class="vac__panel">
          <div class="vac__panel-cab"><h3>Personas: convenio, establecimiento y excepciones de sector</h3></div>
          ${htmlBarraFiltros(ctx, est, { plan: false })}
          <div class="sol__tabla-wrap"><table class="sol__tabla hist__tabla vac__tabla">
            <thead><tr><th>Persona</th><th>Puesto</th><th>Sector</th><th>Convenio</th><th>Establecimiento</th></tr></thead>
            <tbody>${filtrarEmpleados(ctx, est).map(x => `<tr data-persona="${x.clave}">
              <td><strong>${e(x.nombre)}</strong><div class="vac__nota">${x.legajo} · ${EMP_LABEL[x.empresa] || x.empresa}</div></td>
              <td>${e(x.puesto)}</td>
              <td><select class="venc__input" data-p="sector">${opcionesSector(x.sectorExcepcion ? x.sectorId : '', `Según puesto (${e(ctx.sectorPorId.get(ctx.sectorDePuesto(normalizarPuesto(x.puesto)))?.nombre || 'sin sector')})`)}</select></td>
              <td><select class="venc__input" data-p="convenio"><option value="">Según empresa (${e(vacacionesConfig.convenioPorEmpresa[x.empresa] || 'sin definir')})</option>${vacacionesConfig.convenios.map(c => `<option ${x.convenioExcepcion && x.convenio === c ? 'selected' : ''}>${c}</option>`).join('')}</select></td>
              <td><input class="venc__input" data-p="establecimiento" value="${e(x.establecimiento)}"></td>
            </tr>`).join('')}</tbody>
          </table></div>
        </section>

        <section class="vac__panel">
          <div class="vac__panel-cab"><h3>Reglas laborales</h3>
            <span class="vac__chip ${ctx.reglasInfo.porDefecto ? 'vac__chip--alerta' : ''}">${ctx.reglasInfo.porDefecto ? 'Valores por defecto — sin verificar por RRHH' : `Versión ${ctx.reglasInfo.version} activa${ctx.reglasInfo.verificadaPor ? ' · verificada por ' + e(ctx.reglasInfo.verificadaPor) : ''}`}</span></div>
          <p class="vac__nota">Basadas en la LCT (arts. 150, 151 y 154). Hay que verificarlas con RRHH y contra los convenios (UOM / UOCRA) antes de activarlas. El aviso previo figura en 45 días según la LCT; la investigación indica que la Ley 27.802 (2026) lo habría llevado a 30: confirmarlo.</p>
          <div class="vac__reglas">
            <label>Días por antigüedad (hasta 5 / 10 / 20 / más de 20 años)
              <span class="vac__form-linea">${R.escalaAntiguedad.map((t, i) => `<input class="venc__input vac__num" type="number" data-r="escala${i}" value="${t.dias}">`).join('')}</span></label>
            <label>Aviso previo (días) <input class="venc__input vac__num" type="number" data-r="avisoPrevioDias" value="${R.avisoPrevioDias}"></label>
            <label>Tramo mínimo si se fracciona (días) <input class="venc__input vac__num" type="number" data-r="fraccionMinimaDias" value="${R.fraccionMinimaDias}"></label>
            <label>Período de otorgamiento (mm-dd)
              <span class="vac__form-linea"><input class="venc__input" data-r="otorgamientoDesde" value="${R.otorgamientoDesde}"> a <input class="venc__input" data-r="otorgamientoHasta" value="${R.otorgamientoHasta}"></span></label>
            <label>Verano al menos una vez cada (años) <input class="venc__input vac__num" type="number" data-r="veranoCadaAnios" value="${R.veranoCadaAnios}"></label>
            <label class="vac__check"><input type="checkbox" data-r="inicioEnLunes" ${R.inicioEnLunes ? 'checked' : ''}> Deben comenzar un lunes (o el hábil siguiente)</label>
            <label>Verificadas por <input class="venc__input" data-r="verificadaPor" placeholder="Nombre de quien las revisó en RRHH"></label>
            <label class="vac__check"><input type="checkbox" data-r="activar"> Activar esta versión</label>
          </div>
          <button type="button" class="venc__btn-pri" id="vac-c-reglas">Guardar nueva versión</button>
          ${ctx.reglasVersiones.length ? `<details class="vac__versiones"><summary>Versiones anteriores (${ctx.reglasVersiones.length})</summary><ul>${ctx.reglasVersiones.map(v => `<li>Versión ${v.version} · ${fmtFecha(v.creado_en)} ${v.activa ? '· <strong>activa</strong>' : ''} ${v.verificada_por ? '· verificada por ' + e(v.verificada_por) : ''}</li>`).join('')}</ul></details>` : ''}
        </section>
      </div>`;

    const msg = (html) => { contenedor.querySelector('#vac-c-msg').innerHTML = html; };
    const conError = (que, fn) => async (...args) => { try { await fn(...args); } catch (err) { msg(htmlError(que, err.message)); } };

    enlazarBarraFiltros(contenedor, () => pintar());

    contenedor.querySelector('#vac-c-nuevo-sector').addEventListener('click', conError('No se pudo crear el sector.', async () => {
      const nombre = prompt('Nombre del sector nuevo:');
      if (!nombre?.trim()) return;
      await guardarSector({ nombre: nombre.trim(), orden: Math.max(0, ...ctx.sectores.map(s => s.orden)) + 10 });
      await recargar('Sector creado.');
    }));
    contenedor.querySelectorAll('[data-guardar-sector]').forEach(b => b.addEventListener('click', conError('No se pudo guardar el sector.', async () => {
      const tr = b.closest('tr');
      const v = c => tr.querySelector(`[data-c="${c}"]`);
      const verde = Number(v('pct_verde').value), amarillo = Number(v('pct_amarillo').value);
      if (amarillo > verde) { msg('<div class="vac__alerta vac__alerta--bloq">El umbral amarillo no puede ser mayor que el verde.</div>'); return; }
      await guardarSector({
        id: Number(tr.dataset.sector), nombre: v('nombre').value.trim(), orden: Number(v('orden').value) || 100,
        requeridos_default: v('requeridos_default').value === '' ? null : Number(v('requeridos_default').value),
        pct_verde: verde, pct_amarillo: amarillo, activo: v('activo').checked,
      });
      await recargar('Sector guardado.');
    })));
    contenedor.querySelectorAll('[data-borrar-sector]').forEach(b => b.addEventListener('click', conError('No se pudo eliminar el sector.', async () => {
      const s = ctx.sectorPorId.get(Number(b.closest('tr').dataset.sector));
      if (!confirm(`¿Eliminar el sector "${s.nombre}"? Sus puestos quedan sin sector. (Para dejar de usarlo sin perder datos, desmarcá "Activo").`)) return;
      await borrarSector(s.id);
      await recargar('Sector eliminado.');
    })));
    contenedor.querySelectorAll('[data-mapeo]').forEach(sel => sel.addEventListener('change', conError('No se pudo guardar el puesto.', async () => {
      await guardarMapeo(sel.dataset.mapeo, sel.value ? Number(sel.value) : null);
      await recargar('Puesto asignado.');
    })));
    contenedor.querySelectorAll('[data-persona] [data-p]').forEach(el => el.addEventListener('change', conError('No se pudo guardar la persona.', async () => {
      const tr = el.closest('tr');
      const x = ctx.empleadoPor.get(tr.dataset.persona);
      const sector = tr.querySelector('[data-p="sector"]').value;
      await guardarExtra(x, {
        convenio: tr.querySelector('[data-p="convenio"]').value || null,
        establecimiento: tr.querySelector('[data-p="establecimiento"]').value.trim() || null,
        sector_id: sector ? Number(sector) : null,
      });
      await recargar('Datos de la persona guardados.');
    })));
    contenedor.querySelector('#vac-c-reglas').addEventListener('click', conError('No se pudieron guardar las reglas.', async () => {
      const r = k => contenedor.querySelector(`[data-r="${k}"]`);
      const md = /^\d{2}-\d{2}$/;
      if (!md.test(r('otorgamientoDesde').value) || !md.test(r('otorgamientoHasta').value)) {
        msg('<div class="vac__alerta vac__alerta--bloq">El período de otorgamiento va como mm-dd (ej. 10-01 y 04-30).</div>'); return;
      }
      if (r('activar').checked && !r('verificadaPor').value.trim()) {
        msg('<div class="vac__alerta vac__alerta--bloq">Para activar una versión indicá quién la verificó en RRHH.</div>'); return;
      }
      const parametros = {
        ...ctx.reglas,
        escalaAntiguedad: R.escalaAntiguedad.map((t, i) => ({ ...t, dias: Number(r('escala' + i).value) })),
        avisoPrevioDias: Number(r('avisoPrevioDias').value), fraccionMinimaDias: Number(r('fraccionMinimaDias').value),
        otorgamientoDesde: r('otorgamientoDesde').value, otorgamientoHasta: r('otorgamientoHasta').value,
        veranoCadaAnios: Number(r('veranoCadaAnios').value), inicioEnLunes: r('inicioEnLunes').checked,
      };
      await guardarReglas(parametros, { activar: r('activar').checked, verificadaPor: r('verificadaPor').value.trim() }, ctx);
      await recargar(r('activar').checked ? 'Reglas guardadas y activadas.' : 'Reglas guardadas como versión nueva (no activa).');
    }));
  }

  pintar();
}
