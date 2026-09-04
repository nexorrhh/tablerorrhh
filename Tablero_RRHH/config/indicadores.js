// Para agregar un indicador: agregar un objeto a este array. Nada más.
// Si la fuente y el tipo de gráfico ya existen, no hay que tocar ningún otro archivo.
//
// Campos:
//   id            — identificador único, kebab-case
//   titulo        — título que se muestra en la tarjeta
//   tipo          — 'barras' | 'torta' | 'linea'
//   fuente        — 'ejemplo' | 'sheets' | 'supabase'
//                   Usar 'ejemplo' mientras no haya fuente real conectada.
//   origen        — objeto con los parámetros que necesita el adaptador de esa fuente:
//                   para 'sheets': { hoja, columnaLabel, columnaValor }
//                   para 'supabase': { tabla, columnaLabel, columnaValor }
//                   para 'ejemplo': { datos } — datos hardcodeados { labels, valores }
//   orden         — posición visual (menor = primero)

export const indicadores = [
  {
    id: 'faltas-por-mes',
    titulo: 'Faltas por mes — 2026',
    tipo: 'barras',
    fuente: 'ejemplo',
    origen: {
      // Datos de muestra. Reemplazar cambiando fuente a 'sheets' o 'supabase'
      // y configurando el origen correspondiente una vez que estén disponibles:
      // TODO: fuente: 'sheets', origen: { hoja: 'NOMBRE_HOJA', columnaLabel: 'Mes', columnaValor: 'Cantidad' }
      datos: {
        labels: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun'],
        valores: [4, 7, 3, 9, 5, 6],
      },
    },
    orden: 1,
  },
  {
    id: 'solicitudes-por-tipo',
    titulo: 'Solicitudes por tipo',
    tipo: 'torta',
    fuente: 'ejemplo',
    origen: {
      // Datos de muestra. Reemplazar cambiando fuente a 'sheets' o 'supabase'.
      // TODO: fuente: 'sheets', origen: { hoja: 'NOMBRE_HOJA', columnaLabel: 'Tipo', columnaValor: 'Total' }
      datos: {
        labels: ['Vacaciones', 'Falta', 'Lleg. tarde', 'Documentación'],
        valores: [12, 8, 15, 5],
      },
    },
    orden: 2,
  },
];
