// TODO: Reemplazar los valores hex provisorios por los colores reales de marca Cimomet.
// Extraer del CSS del Google Sites actual o del manual de marca.

// Colores de marca — se definen una sola vez acá y se reusan para
// identificar módulos por área (RRHH = rojo del logo, Administración = azul corporativo).
const AZUL_CORPORATIVO = '#1a4a7a';  // azul provisorio — verificar con marca
const ROJO_LOGO        = '#cc2222';  // rojo provisorio para el logo

export const tema = {
  nombre: 'Nexo RRHH y Administración',
  empresa: 'Cimomet S.A. / Co.mo.ing S.R.L.',

  colores: {
    // TODO: reemplazar por el hex exacto del azul corporativo Cimomet
    primario: AZUL_CORPORATIVO,
    primarioHover: '#153d66',    // versión más oscura para hover
    primarioTexto: '#ffffff',

    // TODO: confirmar si el rojo del logo tiene un hex específico
    acento: ROJO_LOGO,

    // Identificación por área — RRHH y Administración se distinguen con estos dos colores
    // en el sidebar y en las tabs (ver components/nav-lateral.js y components/header.js).
    rrhh: ROJO_LOGO,
    administracion: AZUL_CORPORATIVO,

    fondo: '#f4f6f9',
    fondoTarjeta: '#ffffff',
    borde: '#d1d9e0',
    texto: '#1a1a2e',
    textoSecundario: '#5a6a7a',
    exito: '#2e7d32',
    error: '#c62828',
  },

  // Modo noche — mismos campos que "colores" de arriba, aplicados en su lugar
  // cuando el usuario activa el modo oscuro (ver data/tema-modo.js).
  coloresOscuro: {
    primario: '#4c8dc9',
    primarioHover: '#5f9dd6',
    primarioTexto: '#ffffff',

    acento: '#e8447f',
    rrhh: '#e8447f',
    administracion: '#4c8dc9',

    fondo: '#10141d',
    fondoTarjeta: '#1a202e',
    borde: '#2a3244',
    texto: '#e7eaf1',
    textoSecundario: '#a4aec1',
    exito: '#4ade80',
    error: '#f87171',
  },

  tipografia: {
    // TODO: confirmar si Cimomet usa una fuente corporativa específica
    familia: "'Segoe UI', Arial, sans-serif",  // provisorio
    tamanioBase: '16px',
  },

  logo: {
    // TODO: reemplazar por la ruta real al logo de Cimomet una vez que esté en el repo
    ruta: null,   // null = muestra texto en su lugar
    texto: 'CIMOMET',
    ancho: '120px',
  },
};
