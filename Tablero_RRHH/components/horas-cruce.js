// Horas y Presentismo → Cruce de Horas.
// Cruza, por empresa + legajo + período, las horas registradas en "Horas por OT" (reporte
// Capataz) contra las horas pagadas según Tango (rrhh_horas_mensual), para detectar errores:
// gente a la que Tango le paga distinto de lo que Capataz dice que trabajó. Capataz es la
// fuente de verdad — ante una diferencia, se asume que Tango es lo que hay que revisar.
//
// Archivo autocontenido a propósito — si en algún momento hay que sacarlo alcanza con borrar
// este archivo + su entrada en config/navegacion.js + su rama en app.js, sin tocar nada más.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';
import { obtenerClasificacionPuestos, tipoPuesto } from '../data/clasificacion-puestos.js';
import { crearOrdenTabla } from './tabla-ordenable.js';

const HDR = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const TIPO_LABEL = { mensual: 'Mensual', quincenal: 'Quincenal', sin_asignar: 'Sin asignar' };

const EMP_LABEL = { CIMOMET: 'Cimomet', COMOING: 'Co.mo.ing' };
const EMP_COLOR = { CIMOMET: 'var(--color-primario)', COMOING: '#0d9488' };

// Umbral de diferencia (% sobre las horas de Tango) a partir del cual se marca como error real.
const PCT_DIF_SIGNIFICATIVA = 15;

function fmtPeriodo(p) { const [y, m] = p.split('-'); return `${MESES[+m - 1]} ${y}`; }
function fmtFecha(f) { if (!f) return ''; const [, m, d] = f.split('-'); return `${+d}/${+m}`; }
function fmtNum(n) { return Math.round((n || 0) * 10) / 10; }
function eP(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function clave(empresa, legajo) { return `${empresa}|${legajo}`; }

async function fetchTodasFilas(url) {
  const PAGE = 1000;
  let offset = 0, out = [];
  for (;;) {
    const sep = url.includes('?') ? '&' : '?';
    const r = await fetch(`${url}${sep}limit=${PAGE}&offset=${offset}`, { headers: HDR });
    if (!r.ok) break;
    const rows = await r.json();
    out = out.concat(rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

export async function renderizarHorasCruce(contenedor) {
  contenedor.innerHTML = '<div class="pres__loading">Cargando…</div>';

  let rawTango = [], rawOT = [];
  const empMap = new Map(); // legajo → tipo ('mensual' | 'quincenal' | 'sin_asignar')
  try {
    const [tango, ot, empRes, mapaClasif] = await Promise.all([
      fetchTodasFilas(`${SUPABASE_URL}/rest/v1/rrhh_horas_mensual?select=legajo,apellido,nombre,departamento,empresa,periodo,hs_normales,hs_extra50,hs_extra100,hs_vac_trabajadas&order=id.asc`),
      fetchTodasFilas(`${SUPABASE_URL}/rest/v1/horas_ot_detalle?select=legajo,empresa,periodo,fecha,nombre,horas,anomalo&order=id.asc`),
      fetch(`${SUPABASE_URL}/rest/v1/empleados?select=legajo,desc_puesto`, { headers: HDR }),
      obtenerClasificacionPuestos(),
    ]);
    rawTango = tango;
    rawOT = ot;
    if (empRes.ok) {
      const empleadosPuesto = await empRes.json();
      empleadosPuesto.forEach(emp => empMap.set(String(emp.legajo), tipoPuesto(emp.desc_puesto, mapaClasif)));
    }
  } catch {
    contenedor.innerHTML = `<div class="pres__vacio">No se pudieron cargar los datos.</div>`;
    return;
  }

  if (!rawOT.length) {
    contenedor.innerHTML = `
      <div class="estado-vacio">
        <h3 class="estado-vacio__titulo">Todavía no hay datos de "Horas por OT"</h3>
        <p class="estado-vacio__texto">Cargá al menos un mes en Horas y Presentismo → Horas por OT para poder cruzarlo contra Tango.</p>
      </div>`;
    return;
  }

  // Solo tiene sentido cruzar legajos que en algún momento cargaron horas por OT —
  // el resto (administrativos, etc.) nunca va a tener OT y no es una diferencia real.
  const clavesOT = new Set(rawOT.map(r => clave(r.empresa, r.legajo)));
  const periodosComunes = [...new Set(rawOT.map(r => r.periodo))]
    .filter(p => rawTango.some(t => t.periodo === p))
    .sort();

  if (!periodosComunes.length) {
    contenedor.innerHTML = `
      <div class="estado-vacio">
        <h3 class="estado-vacio__titulo">Sin períodos en común</h3>
        <p class="estado-vacio__texto">Los períodos cargados en "Horas por OT" todavía no tienen datos de Tango cargados para el mismo mes (o viceversa).</p>
      </div>`;
    return;
  }

  // Fecha máxima cargada en cada sistema por período, para poder avisar cuando la diferencia
  // sea simplemente porque a Tango todavía le faltan cerrar los últimos días del mes (algo
  // que pasa naturalmente cuando el mes en curso no cerró todavía, no es un error real).
  let rawTangoDetalle = [];
  try {
    rawTangoDetalle = await fetchTodasFilas(
      `${SUPABASE_URL}/rest/v1/rrhh_horas_detalle?select=periodo,fecha&periodo=in.(${periodosComunes.join(',')})&order=id.asc`
    );
  } catch { /* el aviso de corte de mes es un plus — si falla, seguimos sin él */ }

  const tangoMaxFecha = new Map();  // periodo -> 'YYYY-MM-DD'
  rawTangoDetalle.forEach(d => {
    if (!d.fecha) return;
    if (!tangoMaxFecha.has(d.periodo) || d.fecha > tangoMaxFecha.get(d.periodo)) tangoMaxFecha.set(d.periodo, d.fecha);
  });
  const otMaxFecha = new Map();
  rawOT.forEach(d => {
    if (!d.fecha) return;
    if (!otMaxFecha.has(d.periodo) || d.fecha > otMaxFecha.get(d.periodo)) otMaxFecha.set(d.periodo, d.fecha);
  });

  let periodoActivo = periodosComunes[periodosComunes.length - 1];
  let filtroEmpresa = '';
  let filtroEstado = '';
  let filtroTipo   = '';

  const ordenCruce = crearOrdenTabla('difabs', 'desc');
  function valorCruce(fila, clave) {
    switch (clave) {
      case 'legajo':       return fila.legajo;
      case 'nombre':       return fila.nombre;
      case 'empresa':      return fila.empresa;
      case 'departamento': return fila.departamento;
      case 'tango':        return fila.horasTango;
      case 'ot':           return fila.horasOT;
      case 'dif':          return fila.dif;
      case 'difabs':       return Math.abs(fila.dif);
      default:             return null;
    }
  }

  function calcularCruce(periodo) {
    const tangoPorClave = new Map();
    rawTango.filter(t => t.periodo === periodo).forEach(t => {
      tangoPorClave.set(clave(t.empresa, t.legajo), t);
    });

    const otPorClave = new Map(); // clave -> { horas, horasAnomalas, nombre }
    rawOT.filter(o => o.periodo === periodo).forEach(o => {
      const key = clave(o.empresa, o.legajo);
      if (!otPorClave.has(key)) otPorClave.set(key, { horas: 0, horasAnomalas: 0, nombre: o.nombre });
      const x = otPorClave.get(key);
      if (o.anomalo) x.horasAnomalas += (+o.horas || 0);
      else x.horas += (+o.horas || 0);
    });

    const filas = [...clavesOT].map(key => {
      const [empresa, legajoStr] = key.split('|');
      const legajo = +legajoStr;
      const t = tangoPorClave.get(key);
      const o = otPorClave.get(key);

      const enTango = !!t;
      const horasTango = t ? (+t.hs_normales || 0) + (+t.hs_extra50 || 0) + (+t.hs_extra100 || 0) + (+t.hs_vac_trabajadas || 0) : 0;
      const horasOT = o?.horas || 0;
      const horasOTanomalas = o?.horasAnomalas || 0;
      const enOT = horasOT > 0;
      const soloAnomalo = !enOT && horasOTanomalas > 0;

      if (!enTango && !enOT && !soloAnomalo) return null; // sin ningún dato este período

      const dif = horasTango - horasOT;
      const pctDif = horasTango > 0 ? Math.round(Math.abs(dif) / horasTango * 100) : (horasOT > 0 ? 100 : 0);

      let estado;
      if (soloAnomalo)            estado = 'anomalo';
      else if (enTango && enOT)   estado = pctDif >= PCT_DIF_SIGNIFICATIVA ? 'diferencia' : 'ok';
      else if (enOT && !enTango)  estado = 'solo_ot';
      else                        estado = 'solo_tango';

      return {
        legajo, empresa,
        nombre: t ? `${t.apellido || ''}, ${t.nombre || ''}`.trim().replace(/^,\s*/, '') : (o?.nombre || `Legajo ${legajo}`),
        departamento: t?.departamento || '—',
        tipo: empMap.get(String(legajo)) || 'sin_asignar',
        horasTango, horasOT, horasOTanomalas, dif, pctDif, estado,
      };
    }).filter(Boolean);

    return filas
      // El personal mensual casi nunca carga en Capataz al 100% (no es su forma habitual de
      // registrar horas), así que comparado siempre da "sin OT" / 100% de diferencia — ruido,
      // no un error real. Se los deja afuera del cruce salvo que ESE período puntual sí tengan
      // horas cargadas en Capataz (ahí sí hay algo real para comparar).
      .filter(f => f.tipo !== 'mensual' || f.horasOT > 0)
      .filter(f => !filtroEmpresa || f.empresa === filtroEmpresa)
      .filter(f => !filtroTipo    || f.tipo === filtroTipo)
      .filter(f => !filtroEstado || f.estado === filtroEstado)
      .sort(ordenCruce.comparador(valorCruce));
  }

  render();

  function render() {
    const filtroTipoAnterior = filtroTipo;
    filtroTipo = '';
    const filasSinTipoFiltro = calcularCruce(periodoActivo);
    filtroTipo = filtroTipoAnterior;
    const tiposConGente = ['mensual', 'quincenal', 'sin_asignar'].filter(t => filasSinTipoFiltro.some(f => f.tipo === t));

    const filas = calcularCruce(periodoActivo);
    const totalTango = filas.reduce((s, f) => s + f.horasTango, 0);
    const totalOT    = filas.reduce((s, f) => s + f.horasOT, 0);
    const totalDif   = totalTango - totalOT;
    const conDiferencia = filas.filter(f => f.estado === 'diferencia').length;
    const conAnomalias  = filas.filter(f => f.estado === 'anomalo').length;

    const tMax = tangoMaxFecha.get(periodoActivo);
    const oMax = otMaxFecha.get(periodoActivo);
    const diasCorte = tMax && oMax && oMax > tMax
      ? Math.round((new Date(oMax) - new Date(tMax)) / 86400000) : 0;

    contenedor.innerHTML = `
      <div class="pres__personas-wrap">
        <div class="hotc__intro">
          <p>Compara, para cada persona que registró horas por OT en Capataz, el total pagado
          según Tango (normales + extras + vacaciones trabajadas) contra el total cargado en
          Capataz ese mismo período. <strong>Capataz es la fuente de verdad</strong>: si no
          coinciden, la diferencia es algo para revisar en Tango, no al revés.</p>
        </div>

        ${diasCorte >= 2 ? `
        <div class="pres__aviso-parcial">
          Tango de ${fmtPeriodo(periodoActivo)} tiene datos cargados hasta el <strong>${fmtFecha(tMax)}</strong>,
          mientras que Capataz llega hasta el <strong>${fmtFecha(oMax)}</strong> (${diasCorte} día${diasCorte !== 1 ? 's' : ''}
          de diferencia). Si el mes en Tango todavía no cerró, buena parte de las diferencias de
          este período pueden deberse a esos días pendientes de cerrar, no a un error real —
          conviene repetir el cruce cuando Tango tenga el mes completo.
        </div>` : ''}

        <section class="pind__sec" style="margin-top:var(--espacio-m)">
          <div class="pind__grupo-header">
            <div class="pind__grupo-header-izq">
              <h2 class="pind__grupo-titulo">Cruce Horas por OT vs. Tango</h2>
              <div class="pind__detalle-filtros" role="group">
                <button class="pind__det-emp ${filtroEmpresa === '' ? 'pind__det-emp--activo' : ''}" data-emp="">Todas</button>
                <button class="pind__det-emp pind__det-emp--cim ${filtroEmpresa === 'CIMOMET' ? 'pind__det-emp--activo' : ''}" data-emp="CIMOMET">Cimomet</button>
                <button class="pind__det-emp pind__det-emp--com ${filtroEmpresa === 'COMOING' ? 'pind__det-emp--activo' : ''}" data-emp="COMOING">Co.mo.ing</button>
              </div>
              <div class="pind__detalle-filtros" role="group" aria-label="Filtrar por tipo de puesto">
                <button class="pind__det-emp ${filtroTipo === '' ? 'pind__det-emp--activo' : ''}" data-tipo="">Todos</button>
                ${tiposConGente.map(t => `<button class="pind__det-emp ${filtroTipo === t ? 'pind__det-emp--activo' : ''}" data-tipo="${t}">${TIPO_LABEL[t]}</button>`).join('')}
              </div>
            </div>
            <select class="pind__per-filtro" id="hotc-per-sel">
              ${[...periodosComunes].reverse().map(p => `<option value="${p}" ${p === periodoActivo ? 'selected' : ''}>${fmtPeriodo(p)}</option>`).join('')}
            </select>
          </div>

          <div class="pind__kpis">
            <div class="pind__kpi">
              <span class="pind__kpi-num">${fmtNum(totalTango)}h</span>
              <span class="pind__kpi-lbl">Horas según Tango</span>
              <span class="pind__kpi-sub">${filas.length} legajos con OT</span>
            </div>
            <div class="pind__kpi">
              <span class="pind__kpi-num" style="color:#185FA5">${fmtNum(totalOT)}h</span>
              <span class="pind__kpi-lbl">Horas según Capataz</span>
              <span class="pind__kpi-sub">sin contar cargas anómalas</span>
            </div>
            <div class="pind__kpi">
              <span class="pind__kpi-num" style="color:${Math.abs(totalDif) < 0.5 ? '#16a34a' : '#dc2626'}">${totalDif >= 0 ? '+' : ''}${fmtNum(totalDif)}h</span>
              <span class="pind__kpi-lbl">Diferencia total</span>
              <span class="pind__kpi-sub">Tango − Capataz</span>
            </div>
            <div class="pind__kpi pind__kpi--clickable" data-estado="diferencia" title="Ver solo diferencias reales">
              <span class="pind__kpi-num" style="color:${conDiferencia > 0 ? '#dc2626' : '#16a34a'}">${conDiferencia}</span>
              <span class="pind__kpi-lbl">Con diferencia real <span class="pind__kpi-ver">▸ Ver</span></span>
              <span class="pind__kpi-sub">≥${PCT_DIF_SIGNIFICATIVA}% sobre ${filas.length} legajos</span>
            </div>
            ${conAnomalias ? `
            <div class="pind__kpi pind__kpi--clickable" data-estado="anomalo" title="Ver cargas anómalas">
              <span class="pind__kpi-num" style="color:#d97706">${conAnomalias}</span>
              <span class="pind__kpi-lbl">Cargas anómalas <span class="pind__kpi-ver">▸ Ver</span></span>
              <span class="pind__kpi-sub">>16h en un día en Capataz</span>
            </div>` : ''}
          </div>

          ${filtroEstado ? `
          <p class="hotc__filtro-activo">
            Filtrando por: <strong>${ETIQUETA_ESTADO[filtroEstado]}</strong>
            <button class="hotc__filtro-quitar" id="hotc-quitar-filtro" type="button">✕ Quitar filtro</button>
          </p>` : ''}

          <div class="pind__res-scroll" style="margin-top:var(--espacio-m)">
            ${filas.length ? tablaHtml(filas) : '<p style="padding:16px;color:var(--color-texto-sec);font-size:0.85rem">Sin legajos para el filtro seleccionado.</p>'}
          </div>
        </section>
      </div>
    `;

    contenedor.querySelector('#hotc-per-sel').addEventListener('change', e => {
      periodoActivo = e.target.value;
      render();
    });
    contenedor.querySelectorAll('[data-emp]').forEach(btn => {
      btn.addEventListener('click', () => {
        filtroEmpresa = btn.dataset.emp;
        render();
      });
    });
    contenedor.querySelectorAll('[data-tipo]').forEach(btn => {
      btn.addEventListener('click', () => {
        filtroTipo = btn.dataset.tipo;
        render();
      });
    });
    contenedor.querySelectorAll('.pind__kpi--clickable').forEach(kpi => {
      kpi.addEventListener('click', () => {
        filtroEstado = filtroEstado === kpi.dataset.estado ? '' : kpi.dataset.estado;
        render();
      });
    });
    contenedor.querySelector('#hotc-quitar-filtro')?.addEventListener('click', () => {
      filtroEstado = '';
      render();
    });
    // Se re-wirea sobre el `.pind__res-scroll` de ESTE render (nodo nuevo cada vez, ya que
    // contenedor.innerHTML se reemplaza entero) — wirear sobre `contenedor` en cambio
    // dejaría un listener pegado para siempre en el nodo persistente #contenido-principal,
    // que sigue vivo al navegar a otra pestaña y termina repintando esta por encima.
    ordenCruce.wire(contenedor.querySelector('.pind__res-scroll'), render);
  }

  function tablaHtml(filas) {
    return `
      <table class="pind__res-tabla">
        <thead><tr>
          ${ordenCruce.thHtml('legajo', 'Legajo', { clase: 'pind__res-th' })}
          ${ordenCruce.thHtml('nombre', 'Empleado', { clase: 'pind__res-th' })}
          ${ordenCruce.thHtml('empresa', 'Empresa', { clase: 'pind__res-th' })}
          ${ordenCruce.thHtml('departamento', 'Sector', { clase: 'pind__res-th' })}
          ${ordenCruce.thHtml('tango', 'Hs. Tango', { clase: 'pind__res-th', attrs: 'style="text-align:right"' })}
          ${ordenCruce.thHtml('ot', 'Hs. Capataz', { clase: 'pind__res-th', attrs: 'style="text-align:right"' })}
          ${ordenCruce.thHtml('dif', 'Diferencia', { clase: 'pind__res-th', attrs: 'style="text-align:right"' })}
        </tr></thead>
        <tbody>
          ${filas.map(f => `
            <tr>
              <td class="pind__res-td">${f.legajo}</td>
              <td class="pind__res-td">
                <b style="font-size:0.875rem">${eP(f.nombre)}</b>
                ${etiquetaEstado(f)}
              </td>
              <td class="pind__res-td" style="color:${EMP_COLOR[f.empresa] || 'var(--color-texto-sec)'};white-space:nowrap">${EMP_LABEL[f.empresa] || f.empresa || '—'}</td>
              <td class="pind__res-td" style="font-size:0.8rem;color:var(--color-texto-sec)">${eP(f.departamento)}</td>
              <td class="pind__res-td pind__res-td--num">${fmtNum(f.horasTango)}</td>
              <td class="pind__res-td pind__res-td--num">
                ${fmtNum(f.horasOT)}
                ${f.horasOTanomalas > 0 ? `<span class="hotc__tag hotc__tag--warn" title="Además tiene ${fmtNum(f.horasOTanomalas)}h cargadas en Capataz con más de 16h en un solo día — excluidas de este total">+${fmtNum(f.horasOTanomalas)}h anóm.</span>` : ''}
              </td>
              <td class="pind__res-td pind__res-td--num">
                ${f.estado === 'anomalo' ? '—' : `
                <span class="hotc__dif ${f.estado === 'diferencia' ? (f.dif >= 0 ? 'hotc__dif--pos' : 'hotc__dif--neg') : 'hotc__dif--ok'}">
                  ${f.dif >= 0 ? '+' : ''}${fmtNum(f.dif)}h${f.horasTango > 0 || f.horasOT > 0 ? ` (${f.pctDif}%)` : ''}
                </span>`}
              </td>
            </tr>`).join('')}
        </tbody>
        <tfoot><tr>
          <td class="pind__res-tf" colspan="4">Total (${filas.length} legajos)</td>
          <td class="pind__res-tf pind__res-tf--num">${fmtNum(filas.reduce((s, f) => s + f.horasTango, 0))}</td>
          <td class="pind__res-tf pind__res-tf--num">${fmtNum(filas.reduce((s, f) => s + f.horasOT, 0))}</td>
          <td class="pind__res-tf pind__res-tf--num">${fmtNum(filas.reduce((s, f) => s + f.dif, 0))}</td>
        </tr></tfoot>
      </table>
    `;
  }

  function etiquetaEstado(f) {
    if (f.estado === 'anomalo') return `<span class="hotc__tag hotc__tag--warn" title="Toda la carga de Capataz este mes tiene más de 16h en un día — no se puede comparar de forma confiable">carga anómala</span>`;
    if (f.estado === 'solo_ot')    return `<span class="hotc__tag hotc__tag--warn" title="No hay registro de Tango para este legajo en este período">sin Tango</span>`;
    if (f.estado === 'solo_tango') return `<span class="hotc__tag hotc__tag--warn" title="No cargó horas por OT en este período">sin OT</span>`;
    return '';
  }
}

const ETIQUETA_ESTADO = {
  diferencia: 'con diferencia real (≥15%)',
  anomalo: 'cargas anómalas en Capataz',
  solo_ot: 'sin registro en Tango',
  solo_tango: 'sin horas por OT en Capataz',
};
