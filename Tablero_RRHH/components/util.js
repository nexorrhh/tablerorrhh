// Utilidades de presentación compartidas por los componentes. Antes cada archivo
// tenía su copia (meses, formato de números, escape de HTML); centralizarlas evita
// que diverjan — ej. un archivo mostraba "Sep" y otro "Sept".

export const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
  'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
export const MESES_CORTO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

// Entero con separador de miles argentino: 12057 → "12.057".
export function fmtNum(n) {
  return Math.round(Number(n) || 0).toLocaleString('es-AR');
}

// Escapa texto para insertarlo dentro de innerHTML (contenido o atributo entre comillas).
// Los datos vienen de la base, de Excel o de formularios: nunca interpolarlos crudos.
export function escaparHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Mensaje de error estándar para una tarjeta o pantalla cuyo dato no se pudo cargar.
// Distinto de "sin datos": acá algo falló y el usuario tiene que saberlo.
export function htmlError(mensaje = 'No se pudieron cargar los datos.', detalle = '') {
  return `<div class="estado-error" role="alert">
    <strong>${escaparHtml(mensaje)}</strong>
    ${detalle ? `<span class="estado-error__detalle">${escaparHtml(detalle)}</span>` : ''}
  </div>`;
}
