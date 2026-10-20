import { ICONOS } from './iconos.js';

// Genera el SVG de la mini sparkline a partir de un array de valores numéricos.
function sparklineSVG(datos, color) {
  const W = 64, H = 22, PAD = 2;
  const min = Math.min(...datos);
  const max = Math.max(...datos);
  const rng = (max - min) || 1;
  const n = datos.length;
  const pts = datos.map((v, i) => {
    const x = ((i / (n - 1)) * W).toFixed(1);
    const y = (H - PAD - ((v - min) / rng) * (H - PAD * 2)).toFixed(1);
    return `${x},${y}`;
  }).join(' ');
  return `
    <svg viewBox="0 0 ${W} ${H}" class="sparkline" aria-hidden="true" preserveAspectRatio="none">
      <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
}

// Tarjeta KPI con icono, valor grande, descripción y mini sparkline.
export function crearTarjetaStat({ id, titulo, valor, descripcion, color, icono, sparklineEjemplo, tendencia, proximamente, destino }) {
  const iconoHtml = ICONOS[icono] ?? '';
  const fondoIcono = `${color}26`;
  const navegable = destino?.modulo;
  const atributosNavegacion = navegable
    ? `role="button" tabindex="0" aria-label="Ver ${titulo}" data-destino-modulo="${destino.modulo}" data-destino-submodulo="${destino.submodulo || ''}"`
    : '';

  if (proximamente) {
    return `
      <div class="tarjeta-stat tarjeta-stat--prox" data-metrica="${id}" ${atributosNavegacion}>
        <div class="tarjeta-stat__icono" style="background:${fondoIcono}; color:${color}">
          ${iconoHtml}
        </div>
        <p class="tarjeta-stat__label">${titulo}</p>
        <div class="tarjeta-stat__fila-valor">
          <span class="tarjeta-stat__prox-badge">Próximamente</span>
        </div>
        <p class="tarjeta-stat__descripcion">${descripcion}</p>
        <div class="tarjeta-stat__acento" style="background:${color}"></div>
      </div>
    `;
  }

  return `
    <div class="tarjeta-stat${navegable ? ' tarjeta-stat--navegable' : ''}" data-metrica="${id}" ${atributosNavegacion}>
      <div class="tarjeta-stat__icono" style="background:${fondoIcono}; color:${color}">
        ${iconoHtml}
      </div>

      <p class="tarjeta-stat__label">${titulo}</p>

      <div class="tarjeta-stat__fila-valor">
        <p class="tarjeta-stat__valor">${valor ?? '—'}</p>
        <div class="tarjeta-stat__meta">
          ${tendencia ? `<span class="tarjeta-stat__tendencia" style="color:${color}">${tendencia}</span>` : ''}
          ${sparklineEjemplo ? sparklineSVG(sparklineEjemplo, color) : ''}
        </div>
      </div>

      <p class="tarjeta-stat__descripcion">${descripcion}</p>
      ${navegable ? '<span class="tarjeta-stat__enlace" aria-hidden="true">Ver detalle →</span>' : ''}
      <div class="tarjeta-stat__acento" style="background:${color}"></div>
    </div>
  `;
}
