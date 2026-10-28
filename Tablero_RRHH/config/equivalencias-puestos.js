// Equivalencias entre el PUESTO de una búsqueda (sale del plantel / Tango) y los SECTORES a los
// que postula la gente en el formulario de postulantes (Google Forms), que tienen otros nombres.
// Lo usa Búsquedas → "Ver candidatos" para encontrar candidatos y preseleccionados del puesto.
//
// Clave: el puesto tal como figura en la búsqueda. Valor: los nombres de sector del formulario
// que cuentan como ese puesto. No hace falta repetir mayúsculas, tildes ni el nombre exacto
// (eso ya se compara solo); solo agregar acá cuando el nombre es distinto.
//
// Para agregar una: sumar una línea con el puesto y sus sectores equivalentes.

export const EQUIVALENCIAS_PUESTOS = {
  'Recepción y Despacho':   ['Despacho/Pañol'],
  'Pañol':                  ['Despacho/Pañol'],
  'Movimientos':            ['Movimiento'],
  'Presupuestos':           ['Presupuesto'],
  'RRHH':                   ['Recursos Humanos'],
  'Seguridad & Higiene':    ['Seguridad e Higiene'],
  'Ayudante de Produccion': ['Ayudante'],
  'Camion':                 ['Chofer clase C'],
};
