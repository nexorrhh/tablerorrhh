// Configuración → Pendientes: todo lo que quedó sin parametrizar, agrupado, con un botón
// que lleva a la solapa donde se resuelve. Es lo mismo que cuenta el globito del menú.
import { escaparHtml as e, htmlError } from './util.js';
import { calcularPendientes, totalPendientes } from '../data/pendientes-parametrizacion.js';

const MAX_ITEMS = 12;

// irA(solapa): cambia de solapa dentro de Configuración. solapasVisibles: las que ve la
// persona. alCalcular(total): actualiza el globito del menú con el número recién calculado.
export async function renderizarConfigPendientes(contenedor, irA, solapasVisibles, alCalcular) {
  contenedor.innerHTML = '<div class="pres__loading">Buscando pendientes de parametrizar…</div>';
  let cats;
  try { cats = await calcularPendientes(solapasVisibles); }
  catch (err) { contenedor.innerHTML = htmlError('No se pudieron calcular los pendientes.', err.message); return; }
  const total = totalPendientes(cats);
  alCalcular?.(total);

  contenedor.innerHTML = `
    <div class="vac">
      ${total
        ? `<div class="vac__aviso"><strong>${total} pendiente${total === 1 ? '' : 's'} de parametrizar.</strong> Cada uno se resuelve en su solapa con el botón "Resolver".</div>`
        : '<div class="vac__alerta vac__alerta--ok">✓ No hay nada pendiente de parametrizar.</div>'}
      <div class="cfg__pendientes">${cats.map(c => `
        <section class="vac__panel cfg__pend ${c.items.length ? 'cfg__pend--hay' : ''}">
          <div class="vac__panel-cab">
            <h3>${e(c.titulo)}</h3>
            <span class="cfg__pend-num ${c.items.length ? 'cfg__pend-num--hay' : ''}">${c.items.length}</span>
          </div>
          <p class="vac__nota">${e(c.ayuda)}</p>
          ${c.error ? htmlError('No se pudo revisar esta parte.', c.error) : c.items.length ? `
            <ul class="cfg__pend-lista">${c.items.slice(0, MAX_ITEMS).map(i => `<li><strong>${e(i.texto)}</strong> <span class="vac__nota">${e(i.detalle || '')}</span></li>`).join('')}</ul>
            ${c.items.length > MAX_ITEMS ? `<p class="vac__nota">y ${c.items.length - MAX_ITEMS} más…</p>` : ''}
            <button type="button" class="venc__btn-pri" data-ir="${c.solapa}">Resolver →</button>`
          : '<p class="vac__nota">✓ Al día.</p>'}
        </section>`).join('')}
      </div>
    </div>`;
  contenedor.querySelectorAll('[data-ir]').forEach(b => b.addEventListener('click', () => irA?.(b.dataset.ir)));
}
