// Permisos y solicitudes → Autorizadores.
// Configura a qué emails se notifica cada nueva solicitud de permiso, por empresa
// (get_config_autorizadores / set_config_autorizadores de Nexo RRHH). Guarda apenas
// se agrega o saca un email — mismo criterio de persistencia inmediata que ya usa
// plantel-parametrizacion.js, sin un botón "Guardar" aparte.

import { nexoCall } from '../data/nexo-permisos.js';

const TENANTS = [
  { tenant: 'cimomet', label: 'Cimomet',   color: 'var(--color-primario)' },
  { tenant: 'comoing', label: 'Co.mo.ing', color: '#0d9488' },
];

function e(s) { return (s ?? '').toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function esEmailValido(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }

export async function renderizarPermisosAutorizadores(contenedor) {
  contenedor.innerHTML = '<div class="pres__loading">Cargando configuración…</div>';

  const emailsPorTenant = {};
  const errores = [];
  await Promise.all(TENANTS.map(async ({ tenant }) => {
    try {
      const d = await nexoCall(tenant, 'get_config_autorizadores', {});
      emailsPorTenant[tenant] = d.emails || [];
    } catch {
      emailsPorTenant[tenant] = null; // null = no se pudo cargar, distinto de "sin emails"
      errores.push(tenant);
    }
  }));

  function render(mensaje) {
    contenedor.innerHTML = `
      <div class="plantel">
        <p class="plantel__param-intro">
          Emails que reciben un aviso cada vez que se genera una nueva solicitud de permiso, por empresa.
          Los cambios se guardan al toque, no hace falta un botón "Guardar" aparte.
        </p>
        ${mensaje ? `<p class="plantel__param-error">${e(mensaje)}</p>` : ''}
        <div class="perm-auth__grid">
          ${TENANTS.map(cfg => columna(cfg)).join('')}
        </div>
      </div>`;

    TENANTS.forEach(({ tenant }) => wireColumna(tenant));
  }

  function columna({ tenant, label, color }) {
    const emails = emailsPorTenant[tenant];
    return `
      <div class="plantel__param-col">
        <div class="plantel__param-col-header">
          <span class="plantel__param-col-dot" style="background:${color}"></span>
          <h3 class="plantel__param-col-titulo">${label}</h3>
          <span class="plantel__param-col-count">${emails ? emails.length : '—'}</span>
        </div>
        <div class="plantel__param-col-lista" id="perm-auth-lista-${tenant}">
          ${emails === null
            ? `<p class="plantel__param-vacio">No se pudo cargar. <button class="plantel__param-btn" data-reintentar="${tenant}" type="button">Reintentar</button></p>`
            : emails.length
              ? emails.map(email => fila(tenant, email)).join('')
              : `<p class="plantel__param-vacio">Sin emails configurados.</p>`}
        </div>
        ${emails !== null ? `
        <div class="perm-auth__agregar">
          <input type="email" class="sol__modal-input" id="perm-auth-input-${tenant}" placeholder="nombre@empresa.com" autocomplete="off">
          <button class="plantel__param-btn" data-agregar="${tenant}" type="button">+ Agregar</button>
        </div>` : ''}
      </div>`;
  }

  function fila(tenant, email) {
    return `
      <div class="plantel__param-fila">
        <div class="plantel__param-info">
          <span class="plantel__param-puesto">${e(email)}</span>
        </div>
        <div class="plantel__param-acciones">
          <button type="button" class="plantel__param-btn" data-quitar="${tenant}" data-email="${e(email)}">✕ Quitar</button>
        </div>
      </div>`;
  }

  async function guardar(tenant, nuevaLista) {
    const anterior = emailsPorTenant[tenant];
    emailsPorTenant[tenant] = nuevaLista; // optimista — si falla, se revierte
    try {
      await nexoCall(tenant, 'set_config_autorizadores', { emails: nuevaLista });
      render();
    } catch (err) {
      emailsPorTenant[tenant] = anterior;
      render(`No se pudo actualizar la lista de ${TENANTS.find(t => t.tenant === tenant).label}: ${err.message}`);
    }
  }

  function wireColumna(tenant) {
    contenedor.querySelector(`[data-reintentar="${tenant}"]`)?.addEventListener('click', async () => {
      try {
        const d = await nexoCall(tenant, 'get_config_autorizadores', {});
        emailsPorTenant[tenant] = d.emails || [];
        render();
      } catch (err) {
        render(`Sigue sin poder cargarse: ${err.message}`);
      }
    });

    contenedor.querySelectorAll(`[data-quitar="${tenant}"]`).forEach(btn => {
      btn.addEventListener('click', () => {
        const nuevaLista = emailsPorTenant[tenant].filter(em => em !== btn.dataset.email);
        guardar(tenant, nuevaLista);
      });
    });

    const btnAgregar = contenedor.querySelector(`[data-agregar="${tenant}"]`);
    const input = contenedor.querySelector(`#perm-auth-input-${tenant}`);
    if (!btnAgregar || !input) return;

    const intentarAgregar = () => {
      const email = input.value.trim().toLowerCase();
      if (!email) return;
      if (!esEmailValido(email)) { render(`"${email}" no parece un email válido.`); return; }
      if (emailsPorTenant[tenant].includes(email)) { render(`"${email}" ya está en la lista.`); return; }
      guardar(tenant, [...emailsPorTenant[tenant], email]);
    };
    btnAgregar.addEventListener('click', intentarAgregar);
    input.addEventListener('keydown', ev => { if (ev.key === 'Enter') intentarAgregar(); });
  }

  render(errores.length ? `No se pudo cargar la configuración de: ${errores.join(', ')}.` : '');
}
