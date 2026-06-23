import { obtenerDatosIndicador } from '../data/adaptadores.js';
import { renderizarGrafico } from './grafico.js';

// Crea y monta una tarjeta de indicador en el contenedor de indicadores.
// Si la carga de datos falla, muestra un mensaje de error en la tarjeta
// sin romper el resto del dashboard.

export async function renderizarIndicador(indicador, contenedor) {
  const tarjeta = document.createElement('div');
  tarjeta.className = 'tarjeta-indicador';
  tarjeta.id = `indicador-${indicador.id}`;

  tarjeta.innerHTML = `
    <h3 class="tarjeta-indicador__titulo">${indicador.titulo}</h3>
    <div class="tarjeta-indicador__cuerpo">
      <div class="tarjeta-indicador__cargando" aria-live="polite">Cargando datos…</div>
    </div>
  `;

  contenedor.appendChild(tarjeta);

  const cuerpo = tarjeta.querySelector('.tarjeta-indicador__cuerpo');

  try {
    const datos = await obtenerDatosIndicador(indicador);
    cuerpo.innerHTML = `<canvas id="canvas-${indicador.id}"></canvas>`;
    const canvas = cuerpo.querySelector('canvas');
    renderizarGrafico(canvas, indicador.tipo, datos);
  } catch (error) {
    console.error(`Error cargando indicador "${indicador.id}":`, error);
    cuerpo.innerHTML = `
      <p class="tarjeta-indicador__error">
        No se pudieron cargar los datos.<br>
        <small>${error.message}</small>
      </p>
    `;
  }
}
