import { tema } from '../config/tema.js';

// Renderiza el encabezado de la columna principal.
// mod           — objeto del módulo activo (tiene .id, .titulo, .submodulos)
// submodActivoId — id del sub-módulo activo (null si no aplica)
// alCambiarSubmod(id) — callback al hacer clic en un tab de sub-módulo

export function renderizarHeader(mod, submodActivoId, alCambiarSubmod) {
  const header = document.getElementById('header');
  if (!header) return;

  const esPanel = mod.id === 'panel';
  const submodulos = mod.submodulos ?? [];
  const tieneSubmodulos = submodulos.length > 0;

  header.innerHTML = `
    <div class="page-header">
      <div class="page-header__top">
        <p class="page-header__breadcrumb">
          <span>${tema.logo.texto}</span>
          <span class="page-header__sep">›</span>
          <span>Recursos Humanos</span>
          ${!esPanel ? `<span class="page-header__sep">›</span><span>${mod.titulo}</span>` : ''}
        </p>
        <h1 class="page-header__titulo">${esPanel ? 'Recursos Humanos' : mod.titulo}</h1>
      </div>

      ${tieneSubmodulos ? `
        <nav class="tab-bar" role="tablist" aria-label="Sub-módulos de ${mod.titulo}">
          ${submodulos.map(sub => `
            <button
              class="tab-item ${sub.id === submodActivoId ? 'tab-item--activo' : ''}"
              role="tab"
              aria-selected="${sub.id === submodActivoId}"
              data-submod="${sub.id}"
              type="button"
            >${sub.titulo}</button>
          `).join('')}
        </nav>
      ` : ''}
    </div>
  `;

  if (tieneSubmodulos) {
    header.querySelectorAll('.tab-item').forEach(btn => {
      btn.addEventListener('click', () => alCambiarSubmod(btn.dataset.submod));
    });
  }
}
