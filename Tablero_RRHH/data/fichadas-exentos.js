import { sbTraerTodo, sbUpsert, sbDelete } from './supabase-rest.js';

// Personas que nunca van a fichar en el reloj por algún motivo particular (trabajan en otra
// sede, no tienen registrada la huella todavía, etc.) — al margen de los directores (Gerencia,
// que además están excluidos por puesto). Sin esto quedaban siempre marcadas "No fichó" en
// Novedades → Chequeo del día, ensuciando el informe con gente que nunca va a aparecer ahí.
// Se administra desde Parametrización → Fichadas.

// Lanza error si falla: cada pantalla decide (Parametrización lo muestra; Fichadas sigue sin la lista).
export async function obtenerExentosFichada() {
  return sbTraerTodo('rrhh_fichadas_exentos?select=legajo,empresa,nombre,motivo&order=nombre.asc,id.asc');
}

export async function marcarExentoFichada(legajo, empresa, nombre, motivo) {
  try {
    await sbUpsert('rrhh_fichadas_exentos?on_conflict=legajo,empresa', { legajo, empresa, nombre: nombre || null, motivo: motivo || null });
  } catch (e) {
    throw new Error(`${e.message} — al marcar la excepción`, { cause: e });
  }
}

export async function quitarExencionFichada(legajo, empresa) {
  try {
    await sbDelete(`rrhh_fichadas_exentos?legajo=eq.${legajo}&empresa=eq.${encodeURIComponent(empresa)}`);
  } catch (e) {
    throw new Error(`${e.message} — al quitar la excepción`, { cause: e });
  }
}
