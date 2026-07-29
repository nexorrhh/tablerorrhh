import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';

const HDR = {
  apikey:        SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
};

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
               'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

// ── Funciones puras de cálculo ────────────────────────────────────────────────
// Todas las reglas de negocio viven acá. Si cambia algo, se toca solo este bloque.

function parseFecha(str) {
  if (!str) return null;
  const p = str.split('-').map(Number);
  return { anio: p[0], mes: p[1], dia: p[2] }; // mes 1-indexed
}

// Edad que cumple en el año actual (año actual − año nacimiento, sin ajuste)
function edadQuesCumple(fechaNac, hoy) {
  const f = parseFecha(fechaNac);
  return f ? hoy.getFullYear() - f.anio : null;
}

// ¿El cumpleaños cae en el mes indicado? (mes 1-indexed)
function esCumpleMes(fechaNac, mes) {
  const f = parseFecha(fechaNac);
  return f ? f.mes === mes : false;
}

// ¿El cumpleaños es hoy?
function esCumpleHoy(fechaNac, hoy) {
  const f = parseFecha(fechaNac);
  return f ? f.mes === hoy.getMonth() + 1 && f.dia === hoy.getDate() : false;
}

// Días hasta el próximo aniversario laboral + años que cumple en esa fecha.
// Devuelve null si no hay fecha. Devuelve 0 si es hoy.
function diasHastaAniversario(fechaIngreso, hoy) {
  const f = parseFecha(fechaIngreso);
  if (!f) return null;
  const hoyNorm = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const anivEsteAnio = new Date(hoy.getFullYear(), f.mes - 1, f.dia);
  const diff = Math.round((anivEsteAnio - hoyNorm) / 86400000);
  if (diff >= 0) {
    return { dias: diff, aniosCumple: hoy.getFullYear() - f.anio };
  }
  // Ya pasó este año → calcular para el año siguiente
  const anivProxAnio = new Date(hoy.getFullYear() + 1, f.mes - 1, f.dia);
  return {
    dias:       Math.round((anivProxAnio - hoyNorm) / 86400000),
    aniosCumple: hoy.getFullYear() + 1 - f.anio,
  };
}

// Empleados con aniversario laboral en el mes+año indicado.
// Filtra a partir del 2° año. Ordenados por día del mes.
// anioRef: año del mes que se muestra (default: año de hoy)
function calcAniversariosMes(empleados, hoy, mes, anioRef) {
  const anio     = anioRef !== undefined ? anioRef : hoy.getFullYear();
  const hoyNorm  = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  return empleados
    .map(emp => {
      const f = parseFecha(emp.fecha_ingreso);
      if (!f || f.mes !== mes) return null;
      const aniosCumple = anio - f.anio;
      if (aniosCumple < 2) return null;
      const date = new Date(anio, f.mes - 1, f.dia);
      const diff = Math.round((date - hoyNorm) / 86400000);
      return {
        ...emp,
        aniosCumple,
        diasHasta: Math.abs(diff),
        esHoy:     diff === 0,
        esPasado:  diff < 0,
        diaFmt:          `${f.dia}/${f.mes}`,
        fechaIngresoFmt: `${f.dia}/${f.mes}/${f.anio}`,
        dia:             f.dia,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.dia - b.dia);
}

// Antigüedad cumplida: { anios, meses } desde fecha_ingreso hasta hoy
function calcAntiguedad(fechaIngreso, hoy) {
  const f = parseFecha(fechaIngreso);
  if (!f) return null;
  let anios = hoy.getFullYear() - f.anio;
  let meses = (hoy.getMonth() + 1) - f.mes;
  if (meses < 0)         { anios--; meses += 12; }
  if (hoy.getDate() < f.dia) { meses--; if (meses < 0) { anios--; meses += 12; } }
  if (anios < 0) return { anios: 0, meses: 0 };
  return { anios, meses };
}

function fmtAntiguedad({ anios, meses }) {
  if (anios === 0 && meses === 0) return 'Recién ingresó';
  if (anios === 0) return `${meses} mes${meses !== 1 ? 'es' : ''}`;
  if (meses === 0) return `${anios} año${anios !== 1 ? 's' : ''}`;
  return `${anios} año${anios !== 1 ? 's' : ''} ${meses} mes${meses !== 1 ? 'es' : ''}`;
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function fetchEmpleados() {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/empleados?activo=eq.true` +
    `&select=apellido_y_nombre,empresa,desc_puesto,fecha_nacimiento,fecha_ingreso` +
    `&order=apellido_y_nombre.asc&limit=2000`,
    { headers: HDR }
  );
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

function e(s) { return (s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function badgeEmpresa(empresa) {
  return empresa === 'CIMOMET'
    ? '<span class="plantel__badge plantel__badge--cimomet">Cimomet</span>'
    : '<span class="plantel__badge plantel__badge--comoing">Co.mo.ing</span>';
}

// ── Widget de aniversarios para el Panel ──────────────────────────────────────

export async function renderizarWidgetAniversarios(wrapper) {
  wrapper.innerHTML = `<p class="panel__graf-cargando">Cargando…</p>`;
  const hoy = new Date();

  let empleados = [];
  try { empleados = await fetchEmpleados(); }
  catch {
    wrapper.innerHTML = `<p class="panel__graf-error">No se pudieron cargar los datos.</p>`;
    return;
  }

  let mesNav  = hoy.getMonth() + 1;
  let anioNav = hoy.getFullYear();

  function renderTodo() {
    const esHoyMes  = mesNav === hoy.getMonth() + 1 && anioNav === hoy.getFullYear();
    const anivMes   = calcAniversariosMes(empleados, hoy, mesNav, anioNav);
    const anioLabel = anioNav !== hoy.getFullYear() ? ` ${anioNav}` : '';

    const listaHtml = anivMes.length
      ? `<div class="cump__aniv-lista">${anivMes.map(emp => {
          const clase = emp.esHoy    ? ' cump__aniv-fila--hoy'
                      : emp.esPasado ? ' cump__aniv-fila--past'
                      : '';
          let badge, badgeClase;
          if (esHoyMes) {
            badge      = emp.esHoy    ? `¡Hoy! · ${emp.aniosCumple} años`
                       : emp.esPasado ? `${emp.aniosCumple} años ✓`
                       :               `en ${emp.diasHasta}d · ${emp.aniosCumple} años`;
            badgeClase = emp.esHoy ? ' cump__aniv-badge--hoy' : emp.esPasado ? ' cump__aniv-badge--past' : '';
          } else {
            badge      = `${emp.aniosCumple} año${emp.aniosCumple !== 1 ? 's' : ''}`;
            badgeClase = emp.esPasado ? ' cump__aniv-badge--past' : '';
          }
          return `
            <div class="cump__aniv-fila${clase}">
              <div class="cump__aniv-info">
                <span class="cump__aniv-nombre">${e(emp.apellido_y_nombre)}</span>
                <span class="cump__aniv-meta">${emp.empresa === 'CIMOMET' ? 'Cimomet' : 'Co.mo.ing'} · <span class="cump__aniv-fecha-ing">${emp.fechaIngresoFmt}</span></span>
              </div>
              <span class="cump__aniv-badge${badgeClase}">${badge}</span>
            </div>`;
        }).join('')}</div>`
      : `<div class="cump__aniv-vacio">Sin aniversarios laborales en ${MESES[mesNav - 1]}${anioLabel}.</div>`;

    wrapper.innerHTML = `
      <div class="cump__aniv-nav-bar">
        <button class="cump__aniv-nav-btn" id="aniv-prev" aria-label="Mes anterior">‹</button>
        <span class="cump__aniv-nav-label">${MESES[mesNav - 1]}${anioLabel}</span>
        <button class="cump__aniv-nav-btn" id="aniv-next" aria-label="Mes siguiente">›</button>
      </div>
      ${listaHtml}`;

    wrapper.querySelector('#aniv-prev').addEventListener('click', () => {
      if (mesNav === 1) { mesNav = 12; anioNav--; } else { mesNav--; }
      renderTodo();
    });
    wrapper.querySelector('#aniv-next').addEventListener('click', () => {
      if (mesNav === 12) { mesNav = 1; anioNav++; } else { mesNav++; }
      renderTodo();
    });
  }

  renderTodo();
}

// ── Widget para el Panel (compacto, ventana deslizante) ───────────────────────

export async function renderizarWidgetCumpleanos(wrapper) {
  wrapper.innerHTML = `<p class="panel__graf-cargando">Cargando…</p>`;
  const hoy     = new Date();
  const hoyNorm = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());

  let empleados = [];
  try { empleados = await fetchEmpleados(); }
  catch {
    wrapper.innerHTML = `<p class="panel__graf-error">No se pudieron cargar los datos.</p>`;
    return;
  }

  // Ocurrencia de este año para cada empleado
  const ocurrencias = empleados
    .map(emp => {
      const f = parseFecha(emp.fecha_nacimiento);
      if (!f) return null;
      const date = new Date(hoy.getFullYear(), f.mes - 1, f.dia);
      const diff = Math.round((date - hoyNorm) / 86400000);
      return {
        nombre:  emp.apellido_y_nombre,
        empresa: emp.empresa,
        edad:    hoy.getFullYear() - f.anio,
        date, diff,
        esHoy:  diff === 0,
        isPast: diff < 0,
        mes: f.mes, dia: f.dia,
        anio: hoy.getFullYear(),
        _f: f,
      };
    })
    .filter(Boolean);

  // Últimos 3 pasados en orden cronológico (más antiguo → más reciente)
  const pasados = ocurrencias
    .filter(e => e.isPast)
    .sort((a, b) => b.diff - a.diff)   // diff negativo: -1 > -30 → más reciente primero
    .slice(0, 3)
    .reverse();                         // invertir para mostrar cronológicamente

  // Próximos 10 (hoy incluido), completando con el año siguiente si hacen falta
  let proximos = ocurrencias
    .filter(e => !e.isPast)
    .sort((a, b) => a.diff - b.diff);

  if (proximos.length < 10) {
    const sigAnio = ocurrencias
      .filter(e => e.isPast)
      .map(e => {
        const date = new Date(hoy.getFullYear() + 1, e._f.mes - 1, e._f.dia);
        return {
          ...e,
          date,
          diff:   Math.round((date - hoyNorm) / 86400000),
          esHoy:  false,
          isPast: false,
          edad:   hoy.getFullYear() + 1 - e._f.anio,
          anio:   hoy.getFullYear() + 1,
        };
      })
      .sort((a, b) => a.diff - b.diff)
      .slice(0, 10 - proximos.length);
    proximos = [...proximos, ...sigAnio];
  }
  proximos = proximos.slice(0, 10);

  const todos = [...pasados, ...proximos];

  if (!todos.length) {
    wrapper.innerHTML = `<div class="cump__widget-vacio">Sin datos de cumpleaños cargados.</div>`;
    return;
  }

  // Agrupar por mes+año para los separadores
  const grupos = [];
  let keyActual = null;
  todos.forEach(item => {
    const key = `${item.anio}-${item.mes}`;
    if (key !== keyActual) {
      grupos.push({ anio: item.anio, mes: item.mes, items: [] });
      keyActual = key;
    }
    grupos[grupos.length - 1].items.push(item);
  });

  wrapper.innerHTML = `
    <div class="cump__widget-lista">
      ${grupos.map(grp => {
        const todosPast = grp.items.every(i => i.isPast);
        const mesLabel  = MESES[grp.mes - 1] + (grp.anio !== hoy.getFullYear() ? ` ${grp.anio}` : '');
        return `
          <div class="cump__widget-mes-sep${todosPast ? ' cump__widget-mes-sep--past' : ''}">${mesLabel}</div>
          ${grp.items.map(emp => `
            <div class="cump__widget-fila${emp.esHoy ? ' cump__widget-fila--hoy' : ''}${emp.isPast ? ' cump__widget-fila--past' : ''}">
              <span class="cump__widget-dia">${emp.dia}</span>
              <span class="cump__widget-nombre">
                ${e(emp.nombre)}
                ${emp.esHoy ? '<span class="cump__hoy-badge">¡Hoy!</span>' : ''}
                <span class="cump__widget-meta">${emp.empresa === 'CIMOMET' ? 'Cimomet' : 'Co.mo.ing'} · ${emp.edad} años</span>
              </span>
            </div>
          `).join('')}
        `;
      }).join('')}
    </div>`;
}

// ── Vista completa para el tab de Plantel ────────────────────────────────────

export async function renderizarCumpleanosAntiguedad(contenedor) {
  contenedor.innerHTML = `<p class="plantel__cargando">Cargando datos…</p>`;
  const hoy = new Date();
  const mesActual = hoy.getMonth() + 1;

  let empleados = [];
  try { empleados = await fetchEmpleados(); }
  catch {
    contenedor.innerHTML = `
      <div class="estado-vacio">
        <h3 class="estado-vacio__titulo">Error al cargar</h3>
        <p class="estado-vacio__texto">No se pudieron obtener los datos de empleados.</p>
      </div>`;
    return;
  }

  // ── Cumpleaños del mes ───────────────────────────────────────────────────────
  const cumplesMes = empleados
    .filter(emp => esCumpleMes(emp.fecha_nacimiento, mesActual))
    .map(emp => {
      const f = parseFecha(emp.fecha_nacimiento);
      return {
        ...emp,
        dia:   f.dia,
        edad:  edadQuesCumple(emp.fecha_nacimiento, hoy),
        esHoy: esCumpleHoy(emp.fecha_nacimiento, hoy),
      };
    })
    .sort((a, b) => a.dia - b.dia);

  // ── Antigüedad ───────────────────────────────────────────────────────────────
  let ordenAnt = 'desc'; // 'desc' | 'asc'

  const conAntiguedad = empleados
    .map(emp => {
      const ant = calcAntiguedad(emp.fecha_ingreso, hoy);
      const f   = parseFecha(emp.fecha_ingreso);
      const totalMeses = ant ? ant.anios * 12 + ant.meses : -1;
      return { ...emp, ant, totalMeses, fechaIngresoFmt: f ? `${f.dia}/${f.mes}/${f.anio}` : '—' };
    })
    .filter(emp => emp.totalMeses >= 0);

  function ordenarAnt(lista, orden) {
    return [...lista].sort((a, b) =>
      orden === 'desc' ? b.totalMeses - a.totalMeses : a.totalMeses - b.totalMeses
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  function renderCumpleanos() {
    if (!cumplesMes.length) {
      return `<div class="estado-vacio" style="padding:40px 0">
        <h3 class="estado-vacio__titulo">Sin cumpleaños en ${MESES[mesActual - 1]}</h3>
        <p class="estado-vacio__texto">No hay empleados activos que cumplan años este mes.</p>
      </div>`;
    }
    return `
      <div class="sol__tabla-wrap">
        <table class="sol__tabla hist__tabla">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Empresa</th>
              <th>Puesto</th>
              <th style="width:60px;text-align:center">Día</th>
              <th style="width:100px;text-align:center">Edad que cumple</th>
            </tr>
          </thead>
          <tbody>
            ${cumplesMes.map(emp => `
              <tr class="${emp.esHoy ? 'cump__fila-hoy' : ''}">
                <td>
                  <strong>${e(emp.apellido_y_nombre)}</strong>
                  ${emp.esHoy ? '<span class="cump__hoy-badge">¡Hoy!</span>' : ''}
                </td>
                <td>${badgeEmpresa(emp.empresa)}</td>
                <td style="font-size:0.82rem;color:var(--color-texto-sec)">${e(emp.desc_puesto || '—')}</td>
                <td style="text-align:center;font-weight:700;font-size:1rem">${emp.dia}</td>
                <td style="text-align:center">${emp.edad} años</td>
              </tr>`
            ).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function renderAntiguedad(orden) {
    const lista = ordenarAnt(conAntiguedad, orden);
    const flecha = dir => dir === orden ? (orden === 'desc' ? ' ↓' : ' ↑') : '';
    return `
      <div class="sol__tabla-wrap">
        <table class="sol__tabla hist__tabla">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Empresa</th>
              <th>Puesto</th>
              <th style="width:110px;text-align:center">Fecha ingreso</th>
              <th class="cump__th-sort" data-orden="desc" style="width:140px;text-align:center;cursor:pointer"
                  title="Ordenar">Antigüedad${flecha('desc')}${flecha('asc')}</th>
            </tr>
          </thead>
          <tbody>
            ${lista.map(emp => `
              <tr>
                <td><strong>${e(emp.apellido_y_nombre)}</strong></td>
                <td>${badgeEmpresa(emp.empresa)}</td>
                <td style="font-size:0.82rem;color:var(--color-texto-sec)">${e(emp.desc_puesto || '—')}</td>
                <td style="text-align:center;font-size:0.82rem">${emp.fechaIngresoFmt}</td>
                <td style="text-align:center">
                  <span class="cump__ant-chip cump__ant-chip--${emp.ant.anios >= 10 ? 'alta' : emp.ant.anios >= 5 ? 'media' : 'baja'}">
                    ${fmtAntiguedad(emp.ant)}
                  </span>
                </td>
              </tr>`
            ).join('')}
          </tbody>
        </table>
      </div>`;
  }

  // ── Aniversarios del mes (navegable) ────────────────────────────────────────
  let mesAniv  = mesActual;
  let anioAniv = hoy.getFullYear();

  function renderAniversariosTabla(anivMes, esHoyMes) {
    if (!anivMes.length) {
      const anioLbl = anioAniv !== hoy.getFullYear() ? ` ${anioAniv}` : '';
      return `<div class="estado-vacio" style="padding:30px 0">
        <h3 class="estado-vacio__titulo">Sin aniversarios en ${MESES[mesAniv - 1]}${anioLbl}</h3>
        <p class="estado-vacio__texto">Nadie cumple 2° año o más en este mes.</p>
      </div>`;
    }
    return `
      <div class="sol__tabla-wrap">
        <table class="sol__tabla hist__tabla">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Empresa</th>
              <th>Puesto</th>
              <th style="width:90px;text-align:center">Ingresó</th>
              <th style="width:70px;text-align:center">Años</th>
              ${esHoyMes ? `<th style="width:90px;text-align:center">Cuándo</th>` : ''}
            </tr>
          </thead>
          <tbody>
            ${anivMes.map(emp => `
              <tr class="${emp.esHoy ? 'cump__fila-hoy' : ''}">
                <td>
                  <strong>${e(emp.apellido_y_nombre)}</strong>
                  ${emp.esHoy ? '<span class="cump__hoy-badge">¡Hoy!</span>' : ''}
                </td>
                <td>${badgeEmpresa(emp.empresa)}</td>
                <td style="font-size:0.82rem;color:var(--color-texto-sec)">${e(emp.desc_puesto || '—')}</td>
                <td style="text-align:center;font-size:0.82rem">${emp.fechaIngresoFmt}</td>
                <td style="text-align:center;font-weight:700;font-size:1rem;color:var(--color-primario)">${emp.aniosCumple}</td>
                ${esHoyMes ? `<td style="text-align:center">
                  ${emp.esHoy
                    ? '<span class="cump__aniv-badge cump__aniv-badge--hoy">¡Hoy!</span>'
                    : emp.esPasado
                      ? `<span class="cump__aniv-badge cump__aniv-badge--past">${emp.aniosCumple} años ✓</span>`
                      : `<span class="cump__aniv-badge">en ${emp.diasHasta}d</span>`
                  }
                </td>` : ''}
              </tr>`
            ).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function renderAnivSeccion() {
    const anioLbl  = anioAniv !== hoy.getFullYear() ? ` ${anioAniv}` : '';
    const esHoyMes = mesAniv === mesActual && anioAniv === hoy.getFullYear();
    const anivMes  = calcAniversariosMes(empleados, hoy, mesAniv, anioAniv);
    return `
      <div class="cump__seccion-header">
        <h2 class="cump__seccion-titulo">🏅 Aniversarios laborales</h2>
        <div class="cump__aniv-nav-bar cump__aniv-nav-bar--inline">
          <button class="cump__aniv-nav-btn" id="cump-aniv-prev">‹</button>
          <span class="cump__aniv-nav-label">${MESES[mesAniv - 1]}${anioLbl}</span>
          <button class="cump__aniv-nav-btn" id="cump-aniv-next">›</button>
        </div>
        <span class="cump__count">${anivMes.length} empleado${anivMes.length !== 1 ? 's' : ''}</span>
      </div>
      ${renderAniversariosTabla(anivMes, esHoyMes)}`;
  }

  // ── Render principal ─────────────────────────────────────────────────────────
  function render() {
    contenedor.innerHTML = `
      <div class="cump__wrap">

        <!-- ── Cumpleaños del mes ── -->
        <section class="cump__seccion">
          <div class="cump__seccion-header">
            <h2 class="cump__seccion-titulo">🎂 Cumpleaños de ${MESES[mesActual - 1]}</h2>
            <span class="cump__count">${cumplesMes.length} persona${cumplesMes.length !== 1 ? 's' : ''}</span>
          </div>
          ${renderCumpleanos()}
        </section>

        <!-- ── Aniversarios del mes (navegable) ── -->
        <section class="cump__seccion">
          <div id="cump-aniv-seccion">${renderAnivSeccion()}</div>
        </section>

        <!-- ── Antigüedad ── -->
        <section class="cump__seccion">
          <div class="cump__seccion-header">
            <h2 class="cump__seccion-titulo">⭐ Antigüedad</h2>
            <span class="cump__count">${conAntiguedad.length} empleados</span>
          </div>
          <div id="cump-ant-tabla">${renderAntiguedad(ordenAnt)}</div>
        </section>

      </div>`;

    bindSort();
    bindAnivNav();
  }

  function bindSort() {
    contenedor.querySelector('.cump__th-sort')?.addEventListener('click', () => {
      ordenAnt = ordenAnt === 'desc' ? 'asc' : 'desc';
      contenedor.querySelector('#cump-ant-tabla').innerHTML = renderAntiguedad(ordenAnt);
      bindSort();
    });
  }

  function bindAnivNav() {
    contenedor.querySelector('#cump-aniv-prev')?.addEventListener('click', () => {
      if (mesAniv === 1) { mesAniv = 12; anioAniv--; } else { mesAniv--; }
      contenedor.querySelector('#cump-aniv-seccion').innerHTML = renderAnivSeccion();
      bindAnivNav();
    });
    contenedor.querySelector('#cump-aniv-next')?.addEventListener('click', () => {
      if (mesAniv === 12) { mesAniv = 1; anioAniv++; } else { mesAniv++; }
      contenedor.querySelector('#cump-aniv-seccion').innerHTML = renderAnivSeccion();
      bindAnivNav();
    });
  }

  render();
}
