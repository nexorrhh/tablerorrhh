import { tema }   from '../config/tema.js';
import { ICONOS } from './iconos.js';

// Renderiza el sidebar con los ítems de módulo clickeables.
// items  = [PANEL_ITEM, ...navegacion] — pasado desde app.js
// alCambiarMod(id) — callback cuando el usuario selecciona un módulo
// badges = { modId: count } — puntos rojos con conteo (ej: { postulantes: 3 })

export function renderizarNavLateral(items, modActivoId, alCambiarMod, badges = {}) {
  const nav = document.getElementById('nav-lateral');
  if (!nav) return;

  nav.innerHTML = `
    <div class="nav-lateral__brand">
      <div class="nav-lateral__logo">
        <span class="nav-lateral__logo-principal">Cimo</span><span class="nav-lateral__logo-acento">met</span>
      </div>
      <p class="nav-lateral__app-label">TABLERO DE CONTROL</p>
    </div>

    <div class="nav-lateral__divider"></div>

    <div class="nav-lateral__seccion">
      <p class="nav-lateral__seccion-label">RRHH y Administración</p>
      <ul class="nav-lateral__lista" role="list">
        ${items.map(item => {
          const badgeCount = badges[item.id] ?? 0;
          const claseCategoria = item.categoria ? `nav-lateral__item--${item.categoria}` : '';
          return `
            <li>
              <button
                class="nav-lateral__item ${claseCategoria} ${item.id === modActivoId ? 'nav-lateral__item--activo' : ''}"
                data-id="${item.id}"
                type="button"
                aria-current="${item.id === modActivoId ? 'page' : 'false'}"
              >
                <span class="nav-lateral__item-icono">${ICONOS[item.icono] ?? ICONOS.enlace}</span>
                <span class="nav-lateral__item-texto">${item.titulo}</span>
                ${badgeCount > 0 ? `<span class="nav-lateral__badge" aria-label="${badgeCount} pendientes">${badgeCount}</span>` : ''}
              </button>
            </li>
          `;
        }).join('')}
      </ul>
    </div>
  `;

  nav.querySelectorAll('.nav-lateral__item').forEach(btn => {
    btn.addEventListener('click', () => {
      // Cerrar sidebar en mobile al navegar
      nav.classList.remove('nav-lateral--abierto');
      document.getElementById('nav-overlay')?.classList.remove('nav-overlay--activo');
      document.getElementById('btn-hamburger')?.setAttribute('aria-expanded', 'false');

      alCambiarMod(btn.dataset.id);
    });
  });
}
