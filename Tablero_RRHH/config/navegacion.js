// Define los módulos del menú lateral y sus sub-módulos (tabs).
// Para agregar un módulo: agregar objeto con submodulos al array.
// Para agregar un sub-módulo: agregar objeto al array submodulos del módulo.
//
// tipo de submodulo:
//   'botones'     → muestra las columnas de botones de las secciones listadas
//   'placeholder' → muestra vista "próximamente" con el mensaje dado

export const navegacion = [
  {
    id: 'permisos',
    titulo: 'Permisos y solicitudes',
    descripcion: 'Llegadas tarde, faltas, vacaciones',
    icono: 'documento',
    subtituloPanel: 'solicitudes pendientes',
    orden: 2,
    submodulos: [
      {
        id: 'generar',
        titulo: 'Generar',
        tipo: 'botones',
        secciones: ['generacion'],
      },
      {
        id: 'pendientes',
        titulo: 'Pendientes',
        tipo: 'botones',
        secciones: ['autorizacion'],
      },
      {
        id: 'autorizados',
        titulo: 'Autorizados',
        tipo: 'placeholder',
        mensaje: 'El historial de permisos autorizados estará disponible una vez conectada la fuente de datos.',
      },
    ],
  },
  {
    id: 'sabados-feriados',
    titulo: 'Sábados y feriados',
    descripcion: 'Trabajo en días especiales',
    icono: 'calendario',
    subtituloPanel: 'turnos programados',
    orden: 3,
    submodulos: [
      {
        id: 'resumen',
        titulo: 'Resumen',
        tipo: 'sabados-resumen',
      },
      {
        id: 'asistencia',
        titulo: 'Asistencia',
        tipo: 'sabados-marcar',
      },
    ],
  },
  {
    id: 'postulantes',
    titulo: 'Postulantes y candidatos',
    descripcion: 'Reclutamiento y selección',
    icono: 'personas',
    subtituloPanel: 'en proceso',
    orden: 4,
    submodulos: [
      {
        id: 'busquedas',
        titulo: 'Búsquedas',
        tipo: 'busquedas',
      },
      {
        id: 'postulantes',
        titulo: 'Postulantes',
        tipo: 'post-lista',
      },
      {
        id: 'preseleccion',
        titulo: 'Revisados',
        tipo: 'post-preseleccion',
      },
      {
        id: 'candidatos',
        titulo: 'Candidatos',
        tipo: 'post-candidatos',
      },
    ],
  },
  {
    id: 'vencimientos',
    titulo: 'Vencimientos',
    descripcion: 'Contratos y licencias por vencer',
    icono: 'alerta',
    subtituloPanel: 'alertas activas',
    orden: 5,
    submodulos: [
      {
        id: 'contratos',
        titulo: 'Contratos',
        tipo: 'venc-contratos',
      },
      {
        id: 'licencias',
        titulo: 'Licencias',
        tipo: 'venc-licencias',
      },
    ],
  },
  {
    id: 'plantel',
    titulo: 'Plantel',
    descripcion: 'Empleados activos · Cimomet y Co.mo.ing',
    icono: 'plantel',
    subtituloPanel: 'empleados activos',
    orden: 1,
    submodulos: [
      {
        id: 'resumen',
        titulo: 'Resumen',
        tipo: 'plantel-resumen',
      },
      {
        id: 'listado',
        titulo: 'Listado',
        tipo: 'plantel-listado',
      },
      {
        id: 'cumpleanos',
        titulo: 'Cumpleaños y Antigüedad',
        tipo: 'cumpleanos-antiguedad',
      },
    ],
  },
];
