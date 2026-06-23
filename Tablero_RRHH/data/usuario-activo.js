// Manejo de la sesión del usuario activo (sessionStorage — dura hasta cerrar la pestaña).

const CLAVE = 'rrhh_sesion';

export function obtenerUsuario() {
  try { return JSON.parse(sessionStorage.getItem(CLAVE)); }
  catch { return null; }
}

export function guardarSesion(usuario) {
  sessionStorage.setItem(CLAVE, JSON.stringify(usuario));
}

export function cerrarSesion() {
  sessionStorage.removeItem(CLAVE);
}
