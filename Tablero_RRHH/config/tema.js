// TODO: Reemplazar los valores hex provisorios por los colores reales de marca Cimomet.
// Extraer del CSS del Google Sites actual o del manual de marca.

// Colores de marca — se definen una sola vez acá y se reusan para
// identificar módulos por área (RRHH = rojo del logo, Administración = azul corporativo).
const AZUL_CORPORATIVO = '#167bc1';  // azul principal del tablero
const ROJO_LOGO        = '#cc2222';  // rojo provisorio para el logo

export const tema = {
  nombre: 'Nexo RRHH y Administración',
  empresa: 'Cimomet S.A. / Co.mo.ing S.R.L.',

  colores: {
    // TODO: reemplazar por el hex exacto del azul corporativo Cimomet
    primario: AZUL_CORPORATIVO,
    primarioHover: '#0e659f',    // versión más oscura para hover
    primarioTexto: '#ffffff',

    // TODO: confirmar si el rojo del logo tiene un hex específico
    acento: ROJO_LOGO,

    // Identificación por área — RRHH y Administración se distinguen con estos dos colores
    // en el sidebar y en las tabs (ver components/nav-lateral.js y components/header.js).
    rrhh: ROJO_LOGO,
    administracion: AZUL_CORPORATIVO,

    fondo: '#f0f8fc',
    fondoTarjeta: '#ffffff',
    borde: '#e1edf4',
    texto: '#111318',
    textoSecundario: '#606a73',
    exito: '#2e7d32',
    error: '#c62828',
  },

  // Modo noche — mismos campos que "colores" de arriba, aplicados en su lugar
  // cuando el usuario activa el modo oscuro (ver data/tema-modo.js).
  coloresOscuro: {
    primario: '#64b9ec',
    primarioHover: '#8dcef2',
    primarioTexto: '#ffffff',

    acento: '#e8447f',
    rrhh: '#e8447f',
    administracion: '#4c8dc9',

    fondo: '#0d151d',
    fondoTarjeta: '#18222d',
    borde: '#31404d',
    texto: '#f4f7fa',
    textoSecundario: '#b5c1cc',
    exito: '#75d6a3',
    error: '#ff9b93',
  },

  tipografia: {
    // TODO: confirmar si Cimomet usa una fuente corporativa específica
    familia: "'Inter', 'Segoe UI', system-ui, sans-serif",
    tamanioBase: '16px',
  },

  logo: {
    ruta: 'assets/logo-cimomet.png',
    texto: 'CIMOMET',
    ancho: '120px',
  },
};
