// Define los módulos del menú lateral y sus sub-módulos (tabs).
// Para agregar un módulo: agregar objeto con submodulos al array.
// Para agregar un sub-módulo: agregar objeto al array submodulos del módulo.
//
// tipo de submodulo:
//   'botones'     → muestra las columnas de botones de las secciones listadas
//   'placeholder' → muestra vista "próximamente" con el mensaje dado
//
// categoria (módulo o submódulo): 'rrhh' | 'administracion'
//   Identifica visualmente el módulo/tab por área (borde/color rojo o azul).
//   Se declara a nivel de módulo cuando TODOS sus submódulos son de la misma área.
//   Un módulo mixto (ej: Vencimientos) no lleva categoria propia — cada submódulo
//   declara la suya, y los que no la declaran quedan neutros (ej: el resumen general).

export const navegacion = [
  {
    id: 'permisos',
    titulo: 'Permisos y solicitudes',
    descripcion: 'Llegadas tarde, faltas, vacaciones',
    icono: 'documento',
    subtituloPanel: 'solicitudes pendientes',
    orden: 2,
    categoria: 'rrhh',
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
    categoria: 'rrhh',
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
    categoria: 'rrhh',
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
    descripcion: 'Contratos, licencias, impuestos y facturas por vencer',
    icono: 'alerta',
    subtituloPanel: 'alertas activas',
    orden: 6,
    // Contenido mixto (Institucional es RRHH, Pagos es Administración — cada submódulo
    // sigue marcando la suya), pero el ítem del sidebar se pinta de azul como Autorización.
    categoria: 'administracion',
    submodulos: [
      {
        id: 'resumen',
        titulo: 'Resumen',
        tipo: 'venc-resumen',
        categoria: '', // fuerza neutro: no hereda el azul del módulo (esta tab es mixta)
      },
      {
        id: 'institucional',
        titulo: 'Institucional',
        tipo: 'venc-institucional-todo',
        categoria: 'rrhh',
      },
      {
        id: 'pagos',
        titulo: 'Pagos',
        tipo: 'venc-pagos',
        categoria: 'administracion',
      },
    ],
  },
  {
    id: 'presentismo',
    titulo: 'Horas y Presentismo',
    descripcion: 'Asistencia y horas trabajadas por período',
    icono: 'calendario',
    subtituloPanel: 'presentismo del período',
    orden: 5,
    categoria: 'rrhh',
    submodulos: [
      { id: 'indicadores', titulo: 'Indicadores',   tipo: 'pres-indicadores' },
      { id: 'personas',    titulo: 'Por persona',   tipo: 'pres-personas' },
      { id: 'cargar',      titulo: 'Cargar datos',  tipo: 'pres-carga' },
    ],
  },
  {
    id: 'plantel',
    titulo: 'Plantel',
    descripcion: 'Empleados activos · Cimomet y Co.mo.ing',
    icono: 'plantel',
    subtituloPanel: 'empleados activos',
    orden: 1,
    categoria: 'rrhh',
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
  {
    id: 'autorizacion-facturas',
    titulo: 'Autorización de Facturas',
    descripcion: 'Comprobantes de ARCA por proveedor',
    icono: 'documento',
    subtituloPanel: 'proveedores en seguimiento',
    orden: 7,
    categoria: 'administracion',
    submodulos: [
      {
        id: 'seguimiento',
        titulo: 'Seguimiento mensual',
        tipo: 'arca-seguimiento',
      },
      {
        id: 'importar',
        titulo: 'Importar comprobantes',
        tipo: 'arca-importar',
      },
      {
        id: 'autorizar',
        titulo: 'Autorizar',
        tipo: 'arca-autorizar',
        // Solo lo ven los perfiles con este permiso (ver data/usuario-activo.js / login.js).
        permiso: 'autorizarFacturas',
      },
      {
        id: 'proveedores',
        titulo: 'Proveedores',
        tipo: 'arca-proveedores',
      },
    ],
  },
];
