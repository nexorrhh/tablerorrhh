// Datos del módulo Configuración: usuarios del tablero (perfiles_rrhh), qué módulos ve cada
// uno (columna modulos_permitidos: null = todos, [] = solo el Panel). Nunca se trae el hash
// del PIN: solo si tiene o no.
import { sbGet, sbTraerTodo, sbPost, sbPatch, sbDelete } from './supabase-rest.js';

export class AccesosNoInstalado extends Error {}

const COLS_USUARIO = 'id,nombre,activo,es_admin,puede_parametrizar,modulos_permitidos,puede_autorizar_facturas,puede_autorizar_busquedas,puede_eliminar_operativos,created_at';

export async function cargarAccesos() {
  let usuarios;
  try {
    usuarios = await sbGet(`perfiles_rrhh?select=${COLS_USUARIO}&order=nombre.asc`);
  } catch (e) {
    if (/activo|es_admin|puede_parametrizar/.test(e.message)) throw new AccesosNoInstalado('Falta sql/configuracion_accesos.sql o sql/configuracion_parametrizar.sql');
    throw e;
  }
  const conPin = new Set((await sbGet('perfiles_rrhh?select=id&password_hash=not.is.null')).map(x => x.id));
  const empleados = await sbTraerTodo('empleados?activo=eq.true&select=apellido_y_nombre&order=apellido_y_nombre.asc,id.asc');
  return {
    usuarios: usuarios.map(u => ({ ...u, tienePin: conPin.has(u.id) })),
    nombresEmpleados: [...new Set(empleados.map(x => x.apellido_y_nombre).filter(Boolean))],
  };
}

export const crearUsuario = u => sbPost('perfiles_rrhh', u);
export const actualizarUsuario = (id, campos) => sbPatch(`perfiles_rrhh?id=eq.${id}`, campos);
export const borrarUsuario = id => sbDelete(`perfiles_rrhh?id=eq.${id}`);
// Blanquear: sin PIN, en el próximo ingreso le pide crear uno nuevo.
export const blanquearPin = id => sbPatch(`perfiles_rrhh?id=eq.${id}`, { password_hash: null });
