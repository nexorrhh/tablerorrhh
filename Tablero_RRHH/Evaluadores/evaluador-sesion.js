// Sesión del evaluador — separada por completo de la del Tablero de RRHH (data/usuario-activo.js
// usa la clave 'rrhh_sesion'; acá se usa otra a propósito para que nunca se pisen ni se confundan
// si alguien tiene las dos pestañas abiertas en el mismo navegador).

const CLAVE = 'evaluador_sesion';

export function obtenerEvaluadorActivo() {
  try { return JSON.parse(sessionStorage.getItem(CLAVE)); }
  catch { return null; }
}

export function guardarSesionEvaluador(evaluador) {
  sessionStorage.setItem(CLAVE, JSON.stringify(evaluador));
}

export function cerrarSesionEvaluador() {
  sessionStorage.removeItem(CLAVE);
}
