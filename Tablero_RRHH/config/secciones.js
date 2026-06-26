// Cada objeto define una columna de botones dentro de una sección del menú.
// El campo navSeccion conecta esta columna con un id de config/navegacion.js.

export const secciones = [
  // ── Permisos y Solicitudes
  { id: 'generacion',             titulo: 'Generación de solicitudes',           orden: 1, navSeccion: 'permisos' },
  { id: 'autorizacion',           titulo: 'Autorización o revisión',             orden: 2, navSeccion: 'permisos' },
  // ── Sábados y Feriados
  { id: 'generacion-sabados',     titulo: 'Solicitar trabajo especial',          orden: 1, navSeccion: 'sabados-feriados' },
  { id: 'autorizacion-sabados',   titulo: 'Autorizar trabajo especial',          orden: 2, navSeccion: 'sabados-feriados' },
  // ── Postulantes y Candidatos
  { id: 'gestion-postulantes',    titulo: 'Gestión de postulantes',              orden: 1, navSeccion: 'postulantes' },
  { id: 'seguimiento-postulantes', titulo: 'Seguimiento y reportes',             orden: 2, navSeccion: 'postulantes' },
];
