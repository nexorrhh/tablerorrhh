// Genera el HTML de un botón de acción individual.
// Recibe un objeto de config/botones.js y devuelve un string HTML.

export function crearBotonAccion({ id, texto, url, estilo }) {
  const esPlaceholder = url.startsWith('PEGAR_');

  const href = esPlaceholder ? '#' : url;
  const claseExtra = esPlaceholder ? ' boton-accion--placeholder' : '';
  const titleAttr = esPlaceholder ? 'title="URL pendiente de configurar"' : '';
  const targetAttr = esPlaceholder ? 'aria-disabled="true"' : 'target="_blank" rel="noopener noreferrer"';

  return `
    <a
      href="${href}"
      class="boton-accion boton-accion--${estilo}${claseExtra}"
      id="btn-${id}"
      ${titleAttr}
      ${targetAttr}
    >
      <span class="boton-accion__texto">${texto}</span>
      ${esPlaceholder
        ? '<span class="boton-accion__badge">Pendiente</span>'
        : '<span class="boton-accion__flecha" aria-hidden="true">›</span>'
      }
    </a>
  `;
}
