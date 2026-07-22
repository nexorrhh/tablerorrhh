import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';

const HDR = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const MESES_CORTO = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

function eP(s) { return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function formatearPeriodo(p) {
  const [y, m] = p.split('-');
  return `${MESES[+m - 1]} ${y}`;
}

// Devuelve day + month abreviado (ej: "3 Jun")
function diaYMes(fechaStr) {
  const [, m, d] = fechaStr.split('-');
  return `${+d} ${MESES_CORTO[+m - 1]}`;
}

// Convierte horas decimales a "Xh Ymin" (ej: 9.85 → "9h 51min", 0.85 → "51min")
function hmin(v) {
  if (!v || v < 0.01) return '—';
  const total = Math.round(v * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}

// Para balances con signo: devuelve { txt, cls }
function hminBal(v) {
  if (v === null) return null;
  if (Math.abs(v) < 0.05) return { txt: '±0', cls: 'pres__det-td--bal-ok' };
  const total = Math.round(Math.abs(v) * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  const abs = h === 0 ? `${m}min` : m === 0 ? `${h}h` : `${h}h ${m}min`;
  return v > 0
    ? { txt: '+' + abs, cls: 'pres__det-td--bal-pos' }
    : { txt: '-' + abs, cls: 'pres__det-td--bal-neg' };
}

function colorPresentismo(pct) {
  if (pct === null || pct === undefined) return '';
  const p = +pct;
  if (p >= 95) return 'color:#16a34a';
  if (p >= 85) return 'color:#d97706';
  return 'color:#dc2626;font-weight:700';
}

export async function renderizarPresentismoPersonas(contenedor) {
  contenedor.innerHTML = '<div class="pres__loading">Cargando períodos…</div>';

  let periodos = [];
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/rrhh_horas_mensual?select=periodo&order=periodo.desc`,
      { headers: HDR }
    );
    if (r.ok) {
      const rows = await r.json();
      periodos = [...new Set(rows.map(r => r.periodo))];
    }
  } catch {}

  if (!periodos.length) {
    contenedor.innerHTML = `<div class="pres__vacio">No hay datos cargados. Usá la pestaña "Cargar datos" para importar el archivo de Tango.</div>`;
    return;
  }

  let periodoActivo = periodos[0];
  let ordenActivo   = 'apellido';
  let datosActivos  = [];
  const detalleCache = new Map();

  contenedor.innerHTML = `
    <div class="pres__personas-wrap">
      <div class="pres__barra-top">
        <div class="pres__periodo-bar">
          <label class="pres__periodo-lbl">Período:</label>
          <select class="pres__periodo-sel" id="pres-per-sel">
            ${periodos.map(p => `<option value="${p}" ${p === periodoActivo ? 'selected' : ''}>${formatearPeriodo(p)}</option>`).join('')}
          </select>
        </div>
        <div class="pres__periodo-bar">
          <label class="pres__periodo-lbl">Ordenar:</label>
          <select class="pres__periodo-sel" id="pres-orden-sel">
            <option value="apellido">Apellido</option>
            <option value="pres_asc">Presentismo ↑ (menor primero)</option>
            <option value="pres_desc">Presentismo ↓ (mayor primero)</option>
            <option value="ext_desc">Más horas extra</option>
          </select>
        </div>
      </div>
      <div id="pres-tabla-wrap" class="pres__tabla-wrap">
        <div class="pres__loading">Cargando…</div>
      </div>
    </div>
  `;

  const tablaWrap = contenedor.querySelector('#pres-tabla-wrap');

  contenedor.querySelector('#pres-per-sel').addEventListener('change', e => {
    periodoActivo = e.target.value;
    detalleCache.clear();
    cargarYMostrar();
  });

  contenedor.querySelector('#pres-orden-sel').addEventListener('change', e => {
    ordenActivo = e.target.value;
    renderTabla(datosActivos);
  });

  async function cargarYMostrar() {
    tablaWrap.innerHTML = '<div class="pres__loading">Cargando…</div>';
    try {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/rrhh_horas_mensual?periodo=eq.${periodoActivo}&order=apellido.asc`,
        { headers: HDR }
      );
      datosActivos = r.ok ? await r.json() : [];
    } catch { datosActivos = []; }
    renderTabla(datosActivos);
  }

  function sortDatos(datos) {
    const d = [...datos];
    if (ordenActivo === 'pres_asc')  return d.sort((a, b) => (+a.presentismo_pct ?? 100) - (+b.presentismo_pct ?? 100));
    if (ordenActivo === 'pres_desc') return d.sort((a, b) => (+b.presentismo_pct ?? 0)   - (+a.presentismo_pct ?? 0));
    if (ordenActivo === 'ext_desc')  return d.sort((a, b) => ((+b.hs_extra50 + +b.hs_extra100) - (+a.hs_extra50 + +a.hs_extra100)));
    return d.sort((a, b) => (a.apellido || '').localeCompare(b.apellido || ''));
  }

  function renderTabla(datos) {
    if (!datos.length) {
      tablaWrap.innerHTML = '<div class="pres__vacio">Sin datos para este período.</div>';
      return;
    }

    const sorted = sortDatos(datos);

    tablaWrap.innerHTML = `
      <table class="pres__tabla" id="pres-tabla">
        <thead>
          <tr>
            <th class="pres__th--leg">Leg.</th>
            <th>Apellido y nombre</th>
            <th class="pres__th--dep">Departamento</th>
            <th class="pres__th--num" title="Días presente vs días esperados">Pres. días</th>
            <th class="pres__th--num" title="Horas normales vs horas esperadas">Cumpl. hs</th>
            <th class="pres__th--num">Extra 50%</th>
            <th class="pres__th--num">Hs no just.</th>
            <th class="pres__th--exp"></th>
          </tr>
        </thead>
        <tbody id="pres-tbody">
          ${sorted.map(d => filaHTML(d)).join('')}
        </tbody>
      </table>
    `;

    tablaWrap.querySelector('#pres-tbody').addEventListener('click', async e => {
      const btn = e.target.closest('.pres__btn-exp');
      if (!btn) return;
      const legajo  = +btn.dataset.legajo;
      const filaId  = `pres-det-${legajo}`;
      const existente = tablaWrap.querySelector(`#${filaId}`);

      if (existente) {
        existente.remove();
        btn.textContent = '▶';
        btn.setAttribute('aria-expanded', 'false');
        return;
      }

      // Cerrar cualquier fila expandida
      tablaWrap.querySelector('.pres__fila-det')?.remove();
      tablaWrap.querySelectorAll('.pres__btn-exp').forEach(b => {
        b.textContent = '▶'; b.setAttribute('aria-expanded', 'false');
      });

      btn.textContent = '▼';
      btn.setAttribute('aria-expanded', 'true');

      const fila = btn.closest('tr');
      const detRow = document.createElement('tr');
      detRow.id = filaId;
      detRow.className = 'pres__fila-det';
      detRow.innerHTML = `<td colspan="10"><div class="pres__det-loading">Cargando detalle…</div></td>`;
      fila.insertAdjacentElement('afterend', detRow);

      const cacheKey = `${legajo}-${periodoActivo}`;
      let detalle = detalleCache.get(cacheKey);
      if (detalle === undefined) {
        try {
          const r = await fetch(
            `${SUPABASE_URL}/rest/v1/rrhh_horas_detalle?legajo=eq.${legajo}&periodo=eq.${periodoActivo}&order=fecha.asc,tipo_hora.asc`,
            { headers: HDR }
          );
          detalle = r.ok ? await r.json() : [];
          detalleCache.set(cacheKey, detalle);
        } catch (err) {
          console.error('Error al cargar detalle:', err);
          detalle = [];
        }
      }

      const persona = sorted.find(d => +d.legajo === legajo);
      const tdDet = detRow.querySelector('td');
      tdDet.setAttribute('colspan', '10');
      tdDet.innerHTML = renderDetalle(detalle, persona);
    });
  }

  function filaHTML(d) {
    const ext50    = +d.hs_extra50         || 0;
    const noJust   = +d.hs_no_justificadas || 0;
    const diasPres = +d.dias_presentes     || 0;
    const diasNojust = +d.dias_ausentes_nojust || 0;
    const diasTotal  = diasPres + diasNojust;
    const presDias   = d.presentismo_pct !== null ? d.presentismo_pct : null;
    const cumplHs    = d.cumplimiento_hs_pct !== null ? d.cumplimiento_hs_pct : null;

    const toltipDias = diasTotal > 0 ? `${diasPres}/${diasTotal} días` : '';
    const toltipHs   = d.hs_esperadas > 0 ? `${(+d.hs_normales||0).toFixed(0)}h / ${(+d.hs_esperadas||0).toFixed(0)}h` : '';

    return `
      <tr class="pres__fila-emp">
        <td class="pres__td--leg">${d.legajo}</td>
        <td>${eP(d.apellido)}${d.nombre ? `, ${eP(d.nombre)}` : ''}</td>
        <td class="pres__td--dep">${eP(d.departamento || '—')}</td>
        <td class="pres__td--num" title="${toltipDias}" style="${colorPresentismo(presDias)}">
          ${presDias !== null ? presDias + '%' : '—'}
        </td>
        <td class="pres__td--num" title="${toltipHs}" style="${colorPresentismo(cumplHs)}">
          ${cumplHs !== null ? cumplHs + '%' : '—'}
        </td>
        <td class="pres__td--num">${hmin(ext50)}</td>
        <td class="pres__td--num">${hmin(noJust)}</td>
        <td class="pres__td--exp">
          <button class="pres__btn-exp" data-legajo="${d.legajo}"
                  aria-label="Ver detalle de ${eP(d.apellido)}" aria-expanded="false"
                  type="button">▶</button>
        </td>
      </tr>
    `;
  }

  function renderDetalle(detalle, persona) {
    if (!detalle.length) {
      return `<div class="pres__det-vacio">
        No hay datos de detalle diario para este período.<br>
        <span style="font-size:0.82rem;opacity:0.7">Volvé a cargar el archivo desde la pestaña <strong>Cargar datos</strong> para ver el desglose diario.</span>
      </div>`;
    }

    const porFecha = new Map();
    detalle.forEach(d => {
      if (!porFecha.has(d.fecha)) porFecha.set(d.fecha, []);
      porFecha.get(d.fecha).push(d);
    });

    const DIAS_SEM = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
    function diaSemana(fechaStr) {
      const [y, m, d] = fechaStr.split('-');
      return DIAS_SEM[new Date(+y, +m-1, +d).getDay()];
    }

    function calcularDia(filas) {
      const hsnor  = filas.filter(f => f.tipo_hora === 'HSNOR');
      const ext50  = filas.filter(f => f.tipo_hora === 'HSEXT50');
      const ext100 = filas.filter(f => f.tipo_hora === 'HSEXT100');

      const hs_reales = filas.reduce((s, f) => s + (+f.hs_reales          || 0), 0);
      const hs_norm   = hsnor.reduce((s, f)  => s + (+f.hs_trabajadas      || 0), 0);
      const hs_just   = hsnor.reduce((s, f)  => s + (+f.hs_justificadas    || 0), 0);
      const hs_nojust = hsnor.reduce((s, f)  => s + (+f.hs_no_justificadas || 0), 0);
      const hs_e50    = ext50.reduce((s, f)  => s + (+f.hs_trabajadas      || 0), 0);
      const hs_e100   = ext100.reduce((s, f) => s + (+f.hs_trabajadas      || 0), 0);
      const hs_esp    = hsnor.reduce((s, f)  => s + (+f.hs_esperadas       || 0), 0);

      // balance = horas normales acreditadas - horas esperadas (sin contar extras)
      // positivo → cumplió la jornada y le sobra; negativo → déficit de jornada normal
      const balance = hs_esp > 0 ? +(hs_norm - hs_esp).toFixed(2) : null;

      const descJust = hsnor.find(f => f.descripcion_tipo_hora && f.hs_justificadas > 0)?.descripcion_tipo_hora
        || filas.find(f => f.descripcion_tipo_hora)?.descripcion_tipo_hora || '';

      let estado, estadoLabel;
      if (hs_reales > 0) {
        const tieneExtra   = hs_e50 + hs_e100 > 0;
        const fueraHorario = hs_nojust > 0.05;
        if (fueraHorario && tieneExtra) {
          estado = 'parcial'; estadoLabel = 'Fuera de horario + extras';
        } else if (fueraHorario) {
          estado = 'parcial'; estadoLabel = 'Fuera de horario';
        } else if (tieneExtra) {
          estado = 'extra';   estadoLabel = 'Con horas extra';
        } else {
          estado = 'ok';      estadoLabel = 'Presente';
        }
      } else if (hs_just > 0) {
        estado = 'justif'; estadoLabel = descJust ? `Justificado: ${descJust}` : 'Justificado';
      } else if (hs_esp <= 0) {
        estado = 'libre';  estadoLabel = 'Sin horas programadas';
      } else {
        estado = 'falta';  estadoLabel = 'Ausente sin justificar';
      }

      return { hs_reales, hs_norm, hs_just, hs_nojust, hs_e50, hs_e100, hs_esp, balance, descJust, estado, estadoLabel };
    }

    const dias = [...porFecha.keys()].sort();

    // Pre-calcular todos los días para las métricas del resumen
    const calculos = new Map(dias.map(f => [f, calcularDia(porFecha.get(f))]));

    // ── Métricas analíticas del período ──────────────────────────────────────
    const hayEsperadas = dias.some(f => calculos.get(f).hs_esp > 0);
    let totalEsp = 0, totalReales = 0, totalNorm = 0;
    let totalE50 = 0, totalE100 = 0, totalJust = 0, totalNojust = 0;
    let diasSobrec = 0, diasExtra = 0, diasFuera = 0, diasFalta = 0, diasPresentes = 0;
    let sumaBalPos = 0, sumaBalNeg = 0;

    for (const [, c] of calculos) {
      totalEsp    += c.hs_esp;
      totalReales += c.hs_reales;
      totalNorm   += c.hs_norm;
      totalE50    += c.hs_e50;
      totalE100   += c.hs_e100;
      totalJust   += c.hs_just;
      totalNojust += c.hs_nojust;
      if (c.estado === 'sobrec')  { diasSobrec++;   sumaBalPos += c.balance || 0; }
      if (c.estado === 'extra')   { diasExtra++;    sumaBalPos += Math.max(0, c.balance || 0); }
      if (c.estado === 'parcial') { diasFuera++;    sumaBalNeg += Math.abs(c.balance || c.hs_nojust); }
      if (c.estado === 'falta')   { diasFalta++; }
      if (c.hs_reales > 0)        { diasPresentes++; }
    }
    const balTotal = hayEsperadas ? +(totalNorm - totalEsp).toFixed(2) : null;

    function fmtBal(v, clasePos, claseNeg) {
      if (v === null) return '';
      const b = hminBal(v);
      if (!b) return `<span class="pres__anal-num pres__anal-num--neutro">±0</span>`;
      return `<span class="pres__anal-num ${b.cls.replace('pres__det-td--bal-pos', clasePos).replace('pres__det-td--bal-neg', claseNeg).replace('pres__det-td--bal-ok','pres__anal-num--neutro')}">${b.txt}</span>`;
    }

    // Tarjeta analítica
    const tarjetaAnalitica = `
      <div class="pres__anal-grid">
        <div class="pres__anal-item">
          <span class="pres__anal-val">${diasPresentes}</span>
          <span class="pres__anal-lbl">Días presente</span>
        </div>
        ${totalReales > 0 ? `
        <div class="pres__anal-item">
          <span class="pres__anal-val">${hmin(totalReales)}</span>
          <span class="pres__anal-lbl">Horas reales</span>
          <span class="pres__anal-sub">Tiempo total en el trabajo</span>
        </div>` : ''}
        ${hayEsperadas ? `
        <div class="pres__anal-item pres__anal-item--dest ${balTotal > 0 ? 'pres__anal-item--pos' : balTotal < -0.5 ? 'pres__anal-item--neg' : ''}">
          <span class="pres__anal-val">${fmtBal(balTotal, 'pres__anal-num--pos', 'pres__anal-num--neg')}</span>
          <span class="pres__anal-lbl">Balance del período</span>
          <span class="pres__anal-sub">${hmin(totalNorm)} normales de ${hmin(totalEsp)} esperadas</span>
        </div>
` : ''}
        ${totalE50 + totalE100 > 0 ? `
        <div class="pres__anal-item">
          <span class="pres__anal-val" style="color:#7c3aed">${(totalE50 + totalE100).toFixed(1)}h</span>
          <span class="pres__anal-lbl">Horas extra (${diasExtra} días)</span>
          <span class="pres__anal-sub">${hmin(totalE50)} al 50%${totalE100 > 0 ? ` · ${hmin(totalE100)} al 100%` : ''}</span>
        </div>` : ''}
        ${diasFuera > 0 ? `
        <div class="pres__anal-item">
          <span class="pres__anal-val" style="color:#ea580c">${diasFuera}</span>
          <span class="pres__anal-lbl">Días fuera de horario</span>
          <span class="pres__anal-sub">${hmin(totalNojust)} en total</span>
        </div>` : ''}
        ${diasFalta > 0 ? `
        <div class="pres__anal-item">
          <span class="pres__anal-val" style="color:#dc2626">${diasFalta}</span>
          <span class="pres__anal-lbl">Ausencias sin justificar</span>
        </div>` : ''}
        ${totalJust > 0 ? `
        <div class="pres__anal-item">
          <span class="pres__anal-val" style="color:#d97706">${hmin(totalJust)}</span>
          <span class="pres__anal-lbl">Horas justificadas</span>
        </div>` : ''}
      </div>
    `;

    // ── Calendario visual ─────────────────────────────────────────────────────
    const iconos = { ok: '✓', extra: '+', parcial: '~', justif: 'J', falta: '✗', libre: '·' };
    const casillas = dias.map(fecha => {
      const c = calculos.get(fecha);
      const hsMostrar = c.hs_reales > 0.01 ? c.hs_reales : 0;
      return `
        <div class="pres__cal-dia pres__cal-dia--${c.estado}" title="${fecha}${c.balance !== null ? ' · balance ' + (c.balance >= 0 ? '+' : '') + c.balance.toFixed(2) + 'h' : ''}">
          <span class="pres__cal-fecha">${diaYMes(fecha)}</span>
          <span class="pres__cal-icon">${iconos[c.estado]}</span>
          ${hsMostrar > 0.01 ? `<span class="pres__cal-hs">${hsMostrar.toFixed(1)}h</span>` : ''}
        </div>
      `;
    }).join('');

    // ── Tabla detallada ───────────────────────────────────────────────────────
    const n = hmin;

    const filasTbl = dias.map(fecha => {
      const c = calculos.get(fecha);
      const { hs_reales, hs_norm, hs_just, hs_nojust, hs_e50, hs_e100, hs_esp, balance, descJust, estado } = c;
      const [, mm, dd] = fecha.split('-');

      const estadoBadge = {
        ok:      `<span class="pres__det-est pres__det-est--ok">✓ Presente</span>`,
        extra:   `<span class="pres__det-est pres__det-est--extra">+ Extras</span>`,
        parcial: `<span class="pres__det-est pres__det-est--parcial">~ Fuera hor.</span>`,
        justif:  `<span class="pres__det-est pres__det-est--justif" title="${eP(descJust)}">J ${eP(descJust || 'Justificado')}</span>`,
        falta:   `<span class="pres__det-est pres__det-est--falta">✗ Ausente</span>`,
        libre:   `<span class="pres__det-est" style="color:#94a3b8">· Sin programar</span>`,
      }[estado];

      const nojustCell = hs_nojust > 0.01
        ? (hs_reales > 0
          ? `<span class="pres__det-td--fhor">${n(hs_nojust)}</span>`
          : `<span class="pres__det-td--nojust">${n(hs_nojust)}</span>`)
        : '—';

      let balanceCell = '—';
      if (balance !== null && hs_reales > 0) {
        const b = hminBal(balance);
        balanceCell = `<span class="${b.cls}">${b.txt}</span>`;
      }

      return `
        <tr class="pres__det-tr pres__det-tr--${estado}">
          <td class="pres__det-td pres__det-td--fecha">${+dd}/${+mm} ${diaSemana(fecha)}</td>
          <td class="pres__det-td">${estadoBadge}</td>
          <td class="pres__det-td pres__det-td--num">${n(hs_reales)}</td>
          <td class="pres__det-td pres__det-td--num">${hs_esp > 0 ? n(hs_esp) : '—'}</td>
          <td class="pres__det-td pres__det-td--num pres__det-td--bal">${balanceCell}</td>
          <td class="pres__det-td pres__det-td--num">${hs_norm > 0 ? n(hs_norm) : '—'}</td>
          <td class="pres__det-td pres__det-td--num">${n(hs_e50)}</td>
          <td class="pres__det-td pres__det-td--num">${n(hs_e100)}</td>
          <td class="pres__det-td pres__det-td--num">${n(hs_just)}</td>
          <td class="pres__det-td pres__det-td--num">${nojustCell}</td>
        </tr>
      `;
    }).join('');

    return `
      <div class="pres__det-inner">
        <div class="pres__det-titulo">
          Detalle — ${eP(persona?.apellido || '')} ${eP(persona?.nombre || '')}
          <span class="pres__det-periodo">${formatearPeriodo(periodoActivo)}</span>
        </div>
        ${tarjetaAnalitica}
        <div class="pres__cal-grid">${casillas}</div>
        <div class="pres__cal-leyenda">
          <span class="pres__cal-leg pres__cal-leg--ok">✓ Presente</span>
          <span class="pres__cal-leg pres__cal-leg--extra">+ Con extras</span>
          <span class="pres__cal-leg pres__cal-leg--parcial">~ Fuera de horario</span>
          <span class="pres__cal-leg pres__cal-leg--justif">J Justificado</span>
          <span class="pres__cal-leg pres__cal-leg--falta">✗ Ausente</span>
        </div>
        <div class="pres__det-tabla-wrap">
          <table class="pres__det-tabla">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Estado</th>
                <th title="Horas reales en el lugar de trabajo">Reales</th>
                <th title="Horas esperadas según jornada">Esperadas</th>
                <th title="Reales menos esperadas">Balance</th>
                <th title="Horas normales acreditadas como trabajadas (HSNOR)">Trabajadas</th>
                <th>Extra 50%</th>
                <th>Extra 100%</th>
                <th title="Horas no trabajadas justificadas">Justif.</th>
                <th title="Horas fuera del horario habitual o sin justificar">F. hor.</th>
              </tr>
            </thead>
            <tbody>${filasTbl}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  cargarYMostrar();
}
