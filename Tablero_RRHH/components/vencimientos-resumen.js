import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';

const HDR = {
  apikey:        SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
};

const TIPO_LABEL = { contrato: 'Contrato', licencia: 'Licencia', institucional: 'Institucional' };

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
               'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

export async function renderizarVencimientosResumen(contenedor) {
  contenedor.innerHTML = `<p class="plantel__cargando">Cargando vencimientos…</p>`;

  const [rContr, rLic, rInst] = await Promise.allSettled([
    fetch(`${SUPABASE_URL}/rest/v1/contratos_vencimiento?order=fecha_vencimiento.asc`, { headers: HDR }).then(r => r.ok ? r.json() : []),
    fetch(`${SUPABASE_URL}/rest/v1/licencias_vencimiento?order=fecha_vencimiento.asc`, { headers: HDR }).then(r => r.ok ? r.json() : []),
    fetch(`${SUPABASE_URL}/rest/v1/vencimientos_institucionales?order=fecha_vencimiento.asc`, { headers: HDR }).then(r => r.ok ? r.json() : []),
  ]);

  const contratos = rContr.status === 'fulfilled' ? rContr.value : [];
  const licencias = rLic.status   === 'fulfilled' ? rLic.value   : [];
  const inst      = rInst.status  === 'fulfilled' ? rInst.value  : [];

  const items = [
    ...contratos.map(r => ({
      tipo:     'contrato',
      nombre:   r.nombre || '—',
      detalle:  [r.tipo, r.empresa === 'CIMOMET' ? 'Cimomet' : 'Co.mo.ing'].filter(Boolean).join(' · '),
      fecha:    r.fecha_vencimiento,
      preaviso: 30,
    })),
    ...licencias.map(r => ({
      tipo:     'licencia',
      nombre:   r.apellido_y_nombre || '—',
      detalle:  r.tipo_licencia || '',
      fecha:    r.fecha_vencimiento,
      preaviso: 30,
    })),
    ...inst.map(r => ({
      tipo:     'institucional',
      nombre:   r.titulo || '—',
      detalle:  r.preaviso_meses > 1 ? `Preaviso ${r.preaviso_meses} meses` : 'Preaviso 1 mes',
      fecha:    r.fecha_vencimiento,
      preaviso: r.preaviso_meses * 30,
    })),
  ];

  if (!items.length) {
    contenedor.innerHTML = `
      <div class="venc">
        <div class="estado-vacio">
          <div class="estado-vacio__icono">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
          </div>
          <h3 class="estado-vacio__titulo">Sin vencimientos cargados</h3>
          <p class="estado-vacio__texto">Agregá contratos, licencias o vencimientos institucionales para verlos aquí.</p>
        </div>
      </div>`;
    return;
  }

  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const anioHoy = hoy.getFullYear();
  const mesHoy  = hoy.getMonth(); // 0-indexed

  const withDias = items.map(item => {
    const d = Math.round((new Date(item.fecha+'T00:00:00') - hoy) / 86400000);
    const estado = d < 0 ? 'vencido' : d <= item.preaviso ? 'proximo' : 'ok';
    return { ...item, dias: d, estado };
  });

  const vencidos = withDias.filter(i => i.estado === 'vencido').sort((a, b) => a.dias - b.dias);
  const proximos = withDias.filter(i => i.estado === 'proximo').sort((a, b) => a.dias - b.dias);
  const hayAlertas = vencidos.length || proximos.length;

  // ── Agrupar TODOS los ítems por mes/año para el calendario ───────────────
  const porMes = new Map(); // clave "YYYY-MM" → array de items
  withDias
    .slice()
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
    .forEach(item => {
      const [y, m] = item.fecha.split('-');
      const key = `${y}-${m}`;
      if (!porMes.has(key)) porMes.set(key, []);
      porMes.get(key).push(item);
    });

  contenedor.innerHTML = `
    <div class="venc">

      <!-- ── Píldoras de resumen ── -->
      <div class="venc__toolbar">
        <div class="venc__resumen">
          ${vencidos.length ? `<span class="venc__pill venc__pill--rojo">${vencidos.length} vencido${vencidos.length!==1?'s':''}</span>` : ''}
          ${proximos.length ? `<span class="venc__pill venc__pill--naranja">${proximos.length} próximo${proximos.length!==1?'s':''} a vencer</span>` : ''}
          ${!hayAlertas ? `<span class="venc__pill venc__pill--verde">Todo en regla</span>` : ''}
          <span class="venc__pill venc__pill--gris">${items.length} ítem${items.length!==1?'s':''} en total</span>
        </div>
      </div>

      <!-- ── Sección de alertas (solo si hay urgencias) ── -->
      ${hayAlertas ? `
        <div class="venc-res__lista">
          ${vencidos.length ? `
            <h4 class="venc-res__seccion-titulo venc-res__seccion-titulo--rojo">
              <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              Vencidos (${vencidos.length})
            </h4>
            ${vencidos.map(alertaItemHtml).join('')}
          ` : ''}
          ${proximos.length ? `
            <h4 class="venc-res__seccion-titulo venc-res__seccion-titulo--naranja">
              <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              Próximos a vencer (${proximos.length})
            </h4>
            ${proximos.map(alertaItemHtml).join('')}
          ` : ''}
        </div>
      ` : ''}

      <!-- ── Calendario de vencimientos ── -->
      <div class="venc-res__cal">
        <h4 class="venc-res__cal-titulo">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          Calendario de vencimientos
        </h4>
        <div class="venc-res__timeline">
          ${[...porMes.entries()].map(([key, mesItems]) => mesHtml(key, mesItems, anioHoy, mesHoy)).join('')}
        </div>
      </div>

    </div>`;
}

// ── Sección de alerta (ítems urgentes en la parte superior) ──────────────────

function alertaItemHtml(item) {
  const fechaDisp = fmtFecha(item.fecha);
  let diasBadge;
  if (item.dias < 0)        diasBadge = `<span class="venc__badge venc__badge--rojo">Vencido hace ${Math.abs(item.dias)}d</span>`;
  else if (item.dias === 0) diasBadge = `<span class="venc__badge venc__badge--naranja">Vence hoy</span>`;
  else                      diasBadge = `<span class="venc__badge venc__badge--naranja">En ${item.dias}d</span>`;

  const borderCls = item.estado === 'vencido' ? 'venc-res__item--vencido' : 'venc-res__item--proximo';
  return `
    <div class="venc-res__item ${borderCls}">
      <div class="venc-res__item-body">
        <span class="venc-res__tipo venc-res__tipo--${item.tipo}">${TIPO_LABEL[item.tipo]}</span>
        <span class="venc-res__nombre">${e(item.nombre)}</span>
        ${item.detalle ? `<span class="venc-res__detalle">${e(item.detalle)}</span>` : ''}
      </div>
      <div class="venc-res__item-foot">
        <span class="venc-res__fecha">${fechaDisp}</span>
        ${diasBadge}
      </div>
    </div>`;
}

// ── Mes en el timeline ────────────────────────────────────────────────────────

function mesHtml(key, mesItems, anioHoy, mesHoy) {
  const [anioStr, mesStr] = key.split('-');
  const anio = +anioStr;
  const mes  = +mesStr - 1; // 0-indexed

  // Estado del mes respecto a hoy
  const esPasado  = anio < anioHoy || (anio === anioHoy && mes < mesHoy);
  const esActual  = anio === anioHoy && mes === mesHoy;
  const esFuturo  = !esPasado && !esActual;

  // Determine el estado más urgente del mes para el dot
  const tieneVencido = mesItems.some(i => i.estado === 'vencido');
  const tieneProximo = mesItems.some(i => i.estado === 'proximo');
  const dotCls = tieneVencido ? 'venc-res__mes-dot--vencido'
               : tieneProximo ? 'venc-res__mes-dot--proximo'
               : esActual     ? 'venc-res__mes-dot--actual'
               : 'venc-res__mes-dot--ok';

  const headerCls = esPasado ? 'venc-res__mes-header--pasado' : esActual ? 'venc-res__mes-header--actual' : '';

  const label = `${MESES[mes]} ${anio}`;

  return `
    <div class="venc-res__mes">
      <div class="venc-res__mes-axis">
        <span class="venc-res__mes-dot ${dotCls}"></span>
        <span class="venc-res__mes-linea"></span>
      </div>
      <div class="venc-res__mes-body">
        <div class="venc-res__mes-header ${headerCls}">
          <span class="venc-res__mes-label">${label}</span>
          ${esActual ? `<span class="venc-res__mes-hoy">Mes actual</span>` : ''}
          ${esPasado && tieneVencido ? `<span class="venc-res__mes-tag venc-res__mes-tag--vencido">Vencido</span>` : ''}
        </div>
        <div class="venc-res__mes-items">
          ${mesItems.map(calItemHtml).join('')}
        </div>
      </div>
    </div>`;
}

// ── Ítem dentro del calendario ────────────────────────────────────────────────

function calItemHtml(item) {
  const estadoCls = item.estado === 'vencido' ? 'venc-res__cal-item--vencido'
                  : item.estado === 'proximo' ? 'venc-res__cal-item--proximo'
                  : '';
  return `
    <div class="venc-res__cal-item ${estadoCls}">
      <span class="venc-res__tipo venc-res__tipo--${item.tipo}">${TIPO_LABEL[item.tipo]}</span>
      <span class="venc-res__cal-nombre">${e(item.nombre)}</span>
      <span class="venc-res__cal-detalle">${e(item.detalle)}</span>
    </div>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtFecha(f) {
  return new Date(f+'T00:00:00').toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' });
}

function e(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
