// Vencimientos → Institucional: agrupa Contratos, Licencias e Institucional (ISO, Licencia
// Ambiental, habilitaciones, etc.) en una sola pestaña, en 3 secciones apiladas.
// Cada sección sigue usando su propio componente y su propia tabla de Supabase tal cual
// estaban — acá solo se los monta juntos, sin tocar su lógica interna.

import { renderizarVencimientosContratos }     from './vencimientos-contratos.js';
import { renderizarVencimientosLicencias }     from './vencimientos-licencias.js';
import { renderizarVencimientosInstitucional } from './vencimientos-institucionales.js';
import { htmlError } from './util.js';

// Cada sección falla sola: un error inesperado en una no deja en blanco a las otras.
function montarSeccion(fn, cont) {
  return fn(cont).catch(err => {
    console.error(err);
    cont.innerHTML = htmlError('No se pudo cargar esta sección.', err?.message);
  });
}

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
    montarSeccion(renderizarVencimientosContratos,     contenedor.querySelector('#vit-contratos')),
    montarSeccion(renderizarVencimientosLicencias,     contenedor.querySelector('#vit-licencias')),
    montarSeccion(renderizarVencimientosInstitucional, contenedor.querySelector('#vit-institucional')),
  ]);
}
