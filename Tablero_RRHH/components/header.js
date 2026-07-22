import { tema } from '../config/tema.js';

function iniciales(nombre) {
  return nombre.trim().split(/\s+/).slice(0, 2).map(p => (p[0] ?? '').toUpperCase()).join('');
}

// mod             — objeto del módulo activo
// submodActivoId  — id del sub-módulo activo (null si no aplica)
// alCambiarSubmod — callback al hacer clic en un tab
// opciones        — { usuario: { id, nombre }, alCerrarSesion }

export function renderizarHeader(mod, submodActivoId, alCambiarSubmod, opciones = {}) {
  const header = document.getElementById('header');
  if (!header) return;

  const esPanel = mod.id === 'panel';
  const submodulos = mod.submodulos ?? [];
  const tieneSubmodulos = submodulos.length > 0;
  const { usuario, alCerrarSesion } = opciones;

  header.innerHTML = `
    <div class="page-header">
      <div class="page-header__top">
        <div class="page-header__left">
          <p class="page-header__breadcrumb">
            <span>${tema.logo.texto}</span>
            <span class="page-header__sep">›</span>
            <span>RRHH y Administración</span>
            ${!esPanel ? `<span class="page-header__sep">›</span><span>${mod.titulo}</span>` : ''}
          </p>
          <h1 class="page-header__titulo">${esPanel ? 'RRHH y Administración' : mod.titulo}</h1>
        </div>
        ${usuario ? `
          <div class="page-header__usuario">
            <span class="page-header__usuario-avatar">${iniciales(usuario.nombre)}</span>
            <span class="page-header__usuario-nombre">${usuario.nombre}</span>
            ${alCerrarSesion ? `<button class="page-header__btn-salir" id="btn-cerrar-sesion" type="button" title="Cerrar sesión">Salir</button>` : ''}
          </div>
        ` : ''}
      </div>

      ${tieneSubmodulos ? `
        <nav class="tab-bar" role="tablist" aria-label="Sub-módulos de ${mod.titulo}">
          ${submodulos.map(sub => {
            const categoria = sub.categoria ?? mod.categoria ?? '';
            const claseCategoria = categoria ? `tab-item--${categoria}` : '';
            return `
            <button
              class="tab-item ${claseCategoria} ${sub.id === submodActivoId ? 'tab-item--activo' : ''}"
              role="tab"
              aria-selected="${sub.id === submodActivoId}"
              data-submod="${sub.id}"
              type="button"
            >${sub.titulo}</button>
          `;
          }).join('')}
        </nav>
      ` : ''}
    </div>
  `;

  if (tieneSubmodulos) {
    header.querySelectorAll('.tab-item').forEach(btn => {
      btn.addEventListener('click', () => alCambiarSubmod(btn.dataset.submod));
    });
  }

  if (alCerrarSesion) {
    header.querySelector('#btn-cerrar-sesion')?.addEventListener('click', alCerrarSesion);
  }
}
