// Vencimientos → Institucional: agrupa Contratos, Licencias e Institucional (ISO, Licencia
// Ambiental, habilitaciones, etc.) en una sola pestaña, en 3 secciones apiladas.
// Cada sección sigue usando su propio componente y su propia tabla de Supabase tal cual
// estaban — acá solo se los monta juntos, sin tocar su lógica interna.

import { renderizarVencimientosContratos }     from './vencimientos-contratos.js';
import { renderizarVencimientosLicencias }     from './vencimientos-licencias.js';
import { renderizarVencimientosInstitucional } from './vencimientos-institucionales.js';

export async function renderizarVencimientosInstitucionalTodo(contenedor) {
  contenedor.innerHTML = `
    <div class="venc-inst-todo">
      <section class="venc-inst-todo__bloque">
        <h3 class="venc__seccion-h">Contratos y seguros</h3>
        <div id="vit-contratos"></div>
      </section>
      <section class="venc-inst-todo__bloque">
        <h3 class="venc__seccion-h">Licencias</h3>
        <div id="vit-licencias"></div>
      </section>
      <section class="venc-inst-todo__bloque">
        <h3 class="venc__seccion-h">Institucional (ISO, Licencia Ambiental, habilitaciones, etc.)</h3>
        <div id="vit-institucional"></div>
      </section>
    </div>`;

  await Promise.all([
    renderizarVencimientosContratos(contenedor.querySelector('#vit-contratos')),
    renderizarVencimientosLicencias(contenedor.querySelector('#vit-licencias')),
    renderizarVencimientosInstitucional(contenedor.querySelector('#vit-institucional')),
  ]);
}
