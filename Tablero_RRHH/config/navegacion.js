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
        id: 'pendientes',
        titulo: 'Pendientes',
        tipo: 'perm-autorizacion',
      },
      {
        id: 'autorizados',
        titulo: 'Autorizados',
        tipo: 'perm-autorizados',
      },
      {
        id: 'indicadores',
        titulo: 'Indicadores',
        tipo: 'perm-indicadores',
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
      { id: 'novedades',   titulo: 'Novedades',     tipo: 'pres-novedades' },
      { id: 'personas',    titulo: 'Por persona',   tipo: 'pres-personas' },
      { id: 'ficha',       titulo: 'Ficha individual', tipo: 'pres-ficha' },
      { id: 'cargar',      titulo: 'Cargar datos',  tipo: 'pres-carga' },
      { id: 'horas-ot',    titulo: 'Horas por OT',  tipo: 'pres-horas-ot' },
      { id: 'horas-cruce', titulo: 'Cruce de Horas', tipo: 'pres-horas-cruce' },
    ],
  },
  {
    id: 'desempeno',
    titulo: 'Desempeño',
    descripcion: 'Evaluación de desempeño anual y período de prueba (ISO — PG-6.01)',
    icono: 'documento',
    subtituloPanel: 'evaluaciones pendientes',
    orden: 5.5,
    categoria: 'rrhh',
    submodulos: [
      { id: 'evaluaciones', titulo: 'Evaluaciones',     tipo: 'desem-evaluaciones' },
      { id: 'indicadores',  titulo: 'Indicadores',       tipo: 'desem-indicadores' },
    ],
  },
  {
    id: 'vacaciones',
    titulo: 'Vacaciones',
    descripcion: 'Planificación de vacaciones y cobertura operativa',
    icono: 'calendario',
    subtituloPanel: 'planificación del año',
    orden: 5.2,
    categoria: 'rrhh',
    submodulos: [
      { id: 'resumen',        titulo: 'Resumen',        tipo: 'vac-resumen' },
      { id: 'planificacion',  titulo: 'Planificación',  tipo: 'vac-planificacion' },
      { id: 'cobertura',      titulo: 'Cobertura',      tipo: 'vac-cobertura' },
      { id: 'horas',          titulo: 'Proyección de horas', tipo: 'proyeccion-horas' },
      { id: 'escenarios',     titulo: 'Escenarios',     tipo: 'vac-escenarios' },
      { id: 'saldos',         titulo: 'Saldos',         tipo: 'vac-saldos' },
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
      {
        id: 'importar',
        titulo: 'Actualizar desde Excel',
        tipo: 'plantel-importar',
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
  {
    id: 'configuracion',
    titulo: 'Configuración',
    descripcion: 'Parametrización del tablero, usuarios y módulos',
    icono: 'personas',
    subtituloPanel: 'pendientes de parametrizar',
    orden: 99,
    // Lo ven los administradores y quienes tengan el permiso "Parametrizar" (ver app.js →
    // actualizarSidebarPara). Cada solapa pide su permiso: las de parametrización
    // 'parametrizar' (los administradores también lo tienen) y Usuarios 'administrar'.
    // `modulo`: la solapa se muestra solo si la persona puede ver ese módulo.
    permisosModulo: ['administrar', 'parametrizar'],
    submodulos: [
      { id: 'pendientes',    titulo: 'Pendientes',                tipo: 'cfg-pendientes',          permiso: 'parametrizar' },
      { id: 'puestos',       titulo: 'Puestos',                   tipo: 'plantel-parametrizacion', permiso: 'parametrizar' },
      { id: 'presentismo',   titulo: 'Horas y Presentismo',       tipo: 'pres-parametrizacion',    permiso: 'parametrizar', modulo: 'presentismo' },
      { id: 'desempeno',     titulo: 'Desempeño',                 tipo: 'desem-parametrizacion',   permiso: 'parametrizar', modulo: 'desempeno' },
      { id: 'vacaciones',    titulo: 'Vacaciones',                tipo: 'vac-config',              permiso: 'parametrizar', modulo: 'vacaciones' },
      { id: 'autorizadores', titulo: 'Autorizadores de permisos', tipo: 'perm-autorizadores',      permiso: 'parametrizar', modulo: 'permisos' },
      { id: 'usuarios',      titulo: 'Usuarios',                  tipo: 'cfg-usuarios',            permiso: 'administrar' },
    ],
  },
];
