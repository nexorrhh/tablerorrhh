import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';

const HDR = {
  apikey:        SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
};

const TIPO_LABEL = { contrato: 'Contrato', licencia: 'Licencia', institucional: 'Institucional', factura: 'Factura', impuesto: 'Impuesto' };

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
               'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

const DIAS_SEMANA = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];

export async function renderizarVencimientosResumen(contenedor) {
  contenedor.innerHTML = `<p class="plantel__cargando">Cargando vencimientos…</p>`;

  const [rContr, rLic, rInst, rPagos] = await Promise.allSettled([
    fetch(`${SUPABASE_URL}/rest/v1/contratos_vencimiento?order=fecha_vencimiento.asc`, { headers: HDR }).then(r => r.ok ? r.json() : []),
    fetch(`${SUPABASE_URL}/rest/v1/licencias_vencimiento?order=fecha_vencimiento.asc`, { headers: HDR }).then(r => r.ok ? r.json() : []),
    fetch(`${SUPABASE_URL}/rest/v1/vencimientos_institucionales?order=fecha_vencimiento.asc`, { headers: HDR }).then(r => r.ok ? r.json() : []),
    fetch(`${SUPABASE_URL}/rest/v1/pagos_vencimiento?pagado=eq.false&omitido=eq.false&order=fecha_vencimiento.asc`, { headers: HDR }).then(r => r.ok ? r.json() : []),
  ]);

  const contratos = rContr.status  === 'fulfilled' ? rContr.value  : [];
  const licencias = rLic.status    === 'fulfilled' ? rLic.value   : [];
  const inst      = rInst.status   === 'fulfilled' ? rInst.value  : [];
  const pagos     = rPagos.status  === 'fulfilled' ? rPagos.value : [];

  const items = [
    ...contratos.map(r => ({
      tipo:     'contrato',
      nombre:   r.nombre || '—',
      detalle:  [r.tipo, r.empresa === 'CIMOMET' ? 'Cimomet' : 'Co.mo.ing'].filter(Boolean).join(' · '),
      fecha:    r.fecha_vencimiento,
      preaviso: 30,
      monto:    null,
    })),
    ...licencias.map(r => ({
      tipo:     'licencia',
      nombre:   r.apellido_y_nombre || '—',
      detalle:  r.tipo_licencia || '',
      fecha:    r.fecha_vencimiento,
      preaviso: 30,
      monto:    null,
    })),
    ...inst.map(r => ({
      tipo:     'institucional',
      nombre:   r.titulo || '—',
      detalle:  r.preaviso_meses > 1 ? `Preaviso ${r.preaviso_meses} meses` : 'Preaviso 1 mes',
      fecha:    r.fecha_vencimiento,
      preaviso: r.preaviso_meses * 30,
      monto:    null,
    })),
    ...pagos.map(r => ({
      tipo:     r.tipo, // 'factura' | 'impuesto'
      nombre:   r.concepto || '—',
      detalle:  [r.numero_referencia, r.periodo].filter(Boolean).join(' · '),
      fecha:    r.fecha_vencimiento,
      // Los pagos no avisan con anticipación como contratos/licencias/institucional —
      // solo importan si ya vencieron o vencen hoy. Preaviso 0 = nunca cae en "próximo".
      preaviso: 0,
      monto:    r.monto,
      // Los recurrentes que todavía no se completaron traen una fecha "placeholder"
      // (el 01 del mes) que no es real — no hay que tratarla como vencida.
      necesitaRevision: !!r.necesita_revision,
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
          <p class="estado-vacio__texto">Agregá contratos, licencias, vencimientos institucionales, facturas o impuestos para verlos aquí.</p>
        </div>
      </div>`;
    return;
  }

  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const anioHoy = hoy.getFullYear();
  const mesHoy  = hoy.getMonth(); // 0-indexed

  const withDias = items.map(item => {
    if (item.necesitaRevision) return { ...item, dias: null, estado: 'pendiente-fecha' };
    const d = Math.round((new Date(item.fecha+'T00:00:00') - hoy) / 86400000);
    const estado = d < 0 ? 'vencido' : d === 0 ? 'hoy' : d <= item.preaviso ? 'proximo' : 'ok';
    return { ...item, dias: d, estado };
  });

  const vencidos        = withDias.filter(i => i.estado === 'vencido').sort((a, b) => a.dias - b.dias);
  const hoyItems        = withDias.filter(i => i.estado === 'hoy');
  const proximos        = withDias.filter(i => i.estado === 'proximo').sort((a, b) => a.dias - b.dias);
  const pendientesFecha = withDias.filter(i => i.estado === 'pendiente-fecha');
  const hayAlertas = vencidos.length || hoyItems.length || proximos.length;

  // ── Agrupar por mes/año para el calendario (los "pendientes de fecha" no tienen
  //    una fecha real, así que no entran en ningún calendario/timeline) ──────────
  const porMes = new Map(); // clave "YYYY-MM" → array de items
  withDias
    .filter(i => i.estado !== 'pendiente-fecha')
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
          ${hoyItems.length ? `<span class="venc__pill venc__pill--rojo">${hoyItems.length} vence${hoyItems.length!==1?'n':''} hoy</span>` : ''}
          ${proximos.length ? `<span class="venc__pill venc__pill--naranja">${proximos.length} próximo${proximos.length!==1?'s':''} a vencer</span>` : ''}
          ${pendientesFecha.length ? `<span class="venc__pill venc__pill--gris">${pendientesFecha.length} por completar</span>` : ''}
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
          ${hoyItems.length ? `
            <h4 class="venc-res__seccion-titulo venc-res__seccion-titulo--rojo">
              <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              Vencimientos de hoy (${hoyItems.length})
            </h4>
            ${hoyItems.map(alertaItemHtml).join('')}
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

      <!-- ── Calendario de montos (Facturas + Impuestos) ── -->
      <div class="venc-res__cal">
        <h4 class="venc-res__cal-titulo">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          Calendario de montos — Facturas e Impuestos
        </h4>
        <div id="venc-cal-montos"></div>
      </div>

    </div>`;

  // Calendario de montos: se re-renderiza localmente (sin volver a pedir datos) al navegar de mes.
  const pagosConMonto = withDias.filter(i => i.monto != null && i.estado !== 'pendiente-fecha');
  let offsetMes = 0;
  function renderCalendarioMontos() {
    const wrap = contenedor.querySelector('#venc-cal-montos');
    if (!wrap) return;
    wrap.innerHTML = calendarioMontosHtml(pagosConMonto, offsetMes);
    wrap.querySelector('[data-cal-prev]')?.addEventListener('click', () => { offsetMes--; renderCalendarioMontos(); });
    wrap.querySelector('[data-cal-next]')?.addEventListener('click', () => { offsetMes++; renderCalendarioMontos(); });
    wrap.querySelector('[data-cal-hoy]')?.addEventListener('click', () => { offsetMes = 0; renderCalendarioMontos(); });
  }
  renderCalendarioMontos();
}

// ── Sección de alerta (ítems urgentes en la parte superior) ──────────────────

function alertaItemHtml(item) {
  const fechaDisp = fmtFecha(item.fecha);
  let diasBadge;
  if (item.dias < 0)        diasBadge = `<span class="venc__badge venc__badge--rojo">Vencido hace ${Math.abs(item.dias)}d</span>`;
  else if (item.dias === 0) diasBadge = `<span class="venc__badge venc__badge--rojo">Vence hoy</span>`;
  else                      diasBadge = `<span class="venc__badge venc__badge--naranja">En ${item.dias}d</span>`;

  const borderCls = item.estado === 'vencido' || item.estado === 'hoy' ? 'venc-res__item--vencido' : 'venc-res__item--proximo';
  return `
    <div class="venc-res__item ${borderCls}">
      <div class="venc-res__item-body">
        <span class="venc-res__tipo venc-res__tipo--${item.tipo}">${TIPO_LABEL[item.tipo]}</span>
        <span class="venc-res__nombre">${e(item.nombre)}</span>
        ${item.detalle ? `<span class="venc-res__detalle">${e(item.detalle)}</span>` : ''}
        ${item.monto != null ? `<span class="venc-res__detalle">$${Number(item.monto).toLocaleString('es-AR')}</span>` : ''}
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
  const tieneVencido = mesItems.some(i => i.estado === 'vencido' || i.estado === 'hoy');
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
  const estadoCls = item.estado === 'vencido' || item.estado === 'hoy' ? 'venc-res__cal-item--vencido'
                  : item.estado === 'proximo' ? 'venc-res__cal-item--proximo'
                  : '';
  return `
    <div class="venc-res__cal-item ${estadoCls}">
      <span class="venc-res__tipo venc-res__tipo--${item.tipo}">${TIPO_LABEL[item.tipo]}</span>
      <span class="venc-res__cal-nombre">${e(item.nombre)}</span>
      <span class="venc-res__cal-detalle">${e(item.detalle)}</span>
      ${item.monto != null ? `<span class="venc-res__cal-detalle">$${Number(item.monto).toLocaleString('es-AR')}</span>` : ''}
    </div>`;
}

// ── Calendario de montos (grilla día a día, navegable por mes) ──────────────────

function calendarioMontosHtml(pagosConMonto, offsetMes) {
  const base = new Date();
  const primerDia = new Date(base.getFullYear(), base.getMonth() + offsetMes, 1);
  const anioObjetivo = primerDia.getFullYear();
  const mesObjetivo  = primerDia.getMonth();
  const diasEnMes    = new Date(anioObjetivo, mesObjetivo + 1, 0).getDate();
  const offsetSemana = (primerDia.getDay() + 6) % 7; // 0 = Lunes

  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const esMesActual = anioObjetivo === hoy.getFullYear() && mesObjetivo === hoy.getMonth();

  // Total y estado por día del mes objetivo
  const totalPorDia = new Map(); // día (1-31) → { total, vencido }
  pagosConMonto.forEach(item => {
    const f = new Date(item.fecha + 'T00:00:00');
    if (f.getFullYear() !== anioObjetivo || f.getMonth() !== mesObjetivo) return;
    const dia = f.getDate();
    const actual = totalPorDia.get(dia) ?? { total: 0, vencido: false };
    actual.total += Number(item.monto) || 0;
    if (item.estado === 'vencido') actual.vencido = true;
    totalPorDia.set(dia, actual);
  });

  const totalMes = [...totalPorDia.values()].reduce((s, d) => s + d.total, 0);

  let celdas = '';
  for (let i = 0; i < offsetSemana; i++) celdas += `<div class="venc-res__diacal venc-res__diacal--vacio"></div>`;
  for (let dia = 1; dia <= diasEnMes; dia++) {
    const info  = totalPorDia.get(dia);
    const esHoy = esMesActual && dia === hoy.getDate();
    const cls   = info?.vencido ? 'venc-res__diacal--vencido' : info ? 'venc-res__diacal--conmonto' : '';
    celdas += `
      <div class="venc-res__diacal ${cls} ${esHoy ? 'venc-res__diacal--hoy' : ''}">
        <span class="venc-res__diacal-num">${dia}</span>
        ${info ? `<span class="venc-res__diacal-monto">$${info.total.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>` : ''}
      </div>`;
  }

  return `
    <div class="venc-res__calmontos">
      <div class="venc-res__calmontos-nav">
        <button type="button" class="venc-res__calmontos-btn" data-cal-prev title="Mes anterior">‹</button>
        <span class="venc-res__calmontos-titulo">${MESES[mesObjetivo]} ${anioObjetivo}</span>
        <button type="button" class="venc-res__calmontos-btn" data-cal-next title="Mes siguiente">›</button>
        ${offsetMes !== 0 ? `<button type="button" class="venc-res__calmontos-hoy" data-cal-hoy>Hoy</button>` : ''}
        <span class="venc-res__calmontos-total">Total del mes: <strong>$${totalMes.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</strong></span>
      </div>
      <div class="venc-res__calmontos-semana">
        ${DIAS_SEMANA.map(d => `<span>${d}</span>`).join('')}
      </div>
      <div class="venc-res__calmontos-grid">
        ${celdas}
      </div>
    </div>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtFecha(f) {
  return new Date(f+'T00:00:00').toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' });
}

function e(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
