// Para agregar un botón: agregar un objeto a este array. Nada más.
// seccion debe coincidir con un id de config/secciones.js
// estilo: 'claro' (borde/fondo blanco) | 'oscuro' (fondo azul, texto blanco)

export const botones = [

  // ── Permisos — Generación ────────────────────────────────────────────────
  {
    id: 'llegada-tarde-salida-anticipada',
    seccion: 'generacion',
    texto: 'Solicitud de Lleg. Tarde / Sal. Anticipada',
    // TODO: reemplazar por la URL real del formulario
    url: 'PEGAR_URL_FORMULARIO_LLEGADA_TARDE_ACA',
    estilo: 'claro',
  },
  {
    id: 'solicitud-falta',
    seccion: 'generacion',
    texto: 'Solicitud de Falta',
    // TODO: reemplazar por la URL real del formulario
    url: 'PEGAR_URL_FORMULARIO_FALTA_ACA',
    estilo: 'claro',
  },
  {
    id: 'solicitud-vacaciones',
    seccion: 'generacion',
    texto: 'Solicitud de Vacaciones',
    // TODO: reemplazar por la URL real del formulario
    url: 'PEGAR_URL_FORMULARIO_VACACIONES_ACA',
    estilo: 'claro',
  },
  {
    id: 'carga-documentacion',
    seccion: 'generacion',
    texto: 'Carga de Documentación',
    // TODO: reemplazar por la URL real de la app
    url: 'PEGAR_URL_CARGA_DOCUMENTACION_ACA',
    estilo: 'claro',
  },

  // ── Permisos — Autorización ──────────────────────────────────────────────
  {
    id: 'autorizacion-llegada-tarde',
    seccion: 'autorizacion',
    texto: 'Autorización Lleg. Tarde / Sal. Anticipada',
    // TODO: reemplazar por la URL real del panel
    url: 'PEGAR_URL_AUTORIZACION_LLEGADA_TARDE_ACA',
    estilo: 'oscuro',
  },
  {
    id: 'autorizacion-falta',
    seccion: 'autorizacion',
    texto: 'Autorización de Falta',
    // TODO: reemplazar por la URL real del panel
    url: 'PEGAR_URL_AUTORIZACION_FALTA_ACA',
    estilo: 'oscuro',
  },
  {
    id: 'autorizacion-vacaciones',
    seccion: 'autorizacion',
    texto: 'Autorización de Vacaciones',
    // TODO: reemplazar por la URL real del panel
    url: 'PEGAR_URL_AUTORIZACION_VACACIONES_ACA',
    estilo: 'oscuro',
  },
  {
    id: 'revision-documentacion',
    seccion: 'autorizacion',
    texto: 'Revisión de Documentación',
    // TODO: reemplazar por la URL real del panel
    url: 'PEGAR_URL_REVISION_DOCUMENTACION_ACA',
    estilo: 'oscuro',
  },

  // ── Sábados y Feriados — Generación ─────────────────────────────────────
  {
    id: 'solicitud-sabado',
    seccion: 'generacion-sabados',
    texto: 'Solicitud de Trabajo en Sábado',
    // TODO: reemplazar por la URL real del formulario
    url: 'PEGAR_URL_SOLICITUD_SABADO_ACA',
    estilo: 'claro',
  },
  {
    id: 'solicitud-feriado',
    seccion: 'generacion-sabados',
    texto: 'Solicitud de Trabajo en Feriado',
    // TODO: reemplazar por la URL real del formulario
    url: 'PEGAR_URL_SOLICITUD_FERIADO_ACA',
    estilo: 'claro',
  },

  // ── Sábados y Feriados — Autorización ───────────────────────────────────
  {
    id: 'autorizacion-sabado',
    seccion: 'autorizacion-sabados',
    texto: 'Autorización de Trabajo en Sábado',
    // TODO: reemplazar por la URL real del panel
    url: 'PEGAR_URL_AUTORIZACION_SABADO_ACA',
    estilo: 'oscuro',
  },
  {
    id: 'autorizacion-feriado',
    seccion: 'autorizacion-sabados',
    texto: 'Autorización de Trabajo en Feriado',
    // TODO: reemplazar por la URL real del panel
    url: 'PEGAR_URL_AUTORIZACION_FERIADO_ACA',
    estilo: 'oscuro',
  },

  // ── Postulantes — Gestión ────────────────────────────────────────────────
  {
    id: 'carga-postulante',
    seccion: 'gestion-postulantes',
    texto: 'Carga de Nuevo Postulante',
    // TODO: reemplazar por la URL real del formulario
    url: 'PEGAR_URL_CARGA_POSTULANTE_ACA',
    estilo: 'claro',
  },
  {
    id: 'cv-postulante',
    seccion: 'gestion-postulantes',
    texto: 'Carga de CV / Documentación',
    // TODO: reemplazar por la URL real de la app
    url: 'PEGAR_URL_CV_POSTULANTE_ACA',
    estilo: 'claro',
  },

  // ── Postulantes — Seguimiento ────────────────────────────────────────────
  {
    id: 'estado-postulantes',
    seccion: 'seguimiento-postulantes',
    texto: 'Estado de Postulantes',
    // TODO: reemplazar por la URL real del panel
    url: 'PEGAR_URL_ESTADO_POSTULANTES_ACA',
    estilo: 'oscuro',
  },
  {
    id: 'reporte-contrataciones',
    seccion: 'seguimiento-postulantes',
    texto: 'Reporte de Contrataciones',
    // TODO: reemplazar por la URL real del panel
    url: 'PEGAR_URL_REPORTE_CONTRATACIONES_ACA',
    estilo: 'oscuro',
  },
];
