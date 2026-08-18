// Recibe un <canvas>, el tipo de gráfico y los datos en formato común { labels, valores }
// y delega en Chart.js (cargado vía CDN en index.html).
// Para agregar un tipo nuevo (ej: 'linea'): agregar un case en el switch de tipoChartJs.

export function renderizarGrafico(canvas, tipo, datos) {
  if (typeof Chart === 'undefined') {
    throw new Error('Chart.js no está disponible. Verificar que cargó desde el CDN.');
  }

  const { labels, valores } = datos;

  const tipoChartJs = resolverTipoChart(tipo);
  const configuracion = construirConfiguracion(tipoChartJs, labels, valores);

  new Chart(canvas, configuracion);
}

function resolverTipoChart(tipo) {
  switch (tipo) {
    case 'barras': return 'bar';
    case 'torta':  return 'pie';
    case 'linea':  return 'line';
    default:
      throw new Error(`Tipo de gráfico desconocido: "${tipo}". Opciones: 'barras', 'torta', 'linea'.`);
  }
}

function construirConfiguracion(tipoChartJs, labels, valores) {
  const coloresBase = [
    '#1a4a7a', '#2e7db5', '#4fa3d1', '#7ec0e0',
    '#cc2222', '#e05555', '#f08080', '#f4b8b8',
  ];

  const esTorta = tipoChartJs === 'pie';

  return {
    type: tipoChartJs,
    data: {
      labels,
      datasets: [{
        label: '',
        data: valores,
        backgroundColor: esTorta
          ? coloresBase.slice(0, labels.length)
          : coloresBase[0],
        borderColor: esTorta ? '#ffffff' : coloresBase[1],
        borderWidth: esTorta ? 2 : 1,
        borderRadius: tipoChartJs === 'bar' ? 4 : 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          display: esTorta,
          position: 'bottom',
        },
      },
      scales: esTorta ? {} : {
        y: {
          beginAtZero: true,
          ticks: { precision: 0 },
        },
      },
    },
  };
}
