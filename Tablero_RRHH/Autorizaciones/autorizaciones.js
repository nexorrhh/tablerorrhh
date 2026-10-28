// Página de autorización de permisos para responsables de área.
//
// Se entra desde el mail que manda Nexo RRHH cuando alguien de su área carga un permiso:
//   Autorizaciones/?tenant=cimomet|comoing&permiso=<id>&t=<clave firmada>
// La clave (t) identifica al responsable y la valida Nexo del lado del servidor
// (nexo/permisos-por-responsable.ts): sin usuario ni contraseña, y sin poder ver ni resolver
// permisos de gente que no sea de su área. Esta página no usa la api_key del Tablero.

import { NEXO_CONFIG } from '../data/fuentes.js';
import { cerrarConAnimacion } from '../components/modal-animado.js';

const TIPO_LABEL = { llegada_tarde: 'Llegada tarde', salida_anticipada: 'Salida anticipada', ausencia: 'Ausencia' };

const app = document.getElementById('app');
const params = new URLSearchParams(location.search);
const tenant = params.get('tenant');
const token = params.get('t');
const permisoInicial = params.get('permiso');

function e(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function fmtFecha(f) { const [a, m, d] = String(f).slice(0, 10).split('-'); return `${d}/${m}/${a}`; }
function fmtCuando(p) {
  const fecha = fmtFecha(p.fecha);
  return p.tipo === 'ausencia' ? `${fecha} · jornada completa` : `${fecha} a las ${String(p.hora ?? '').slice(0, 5)} h`;
}
function nombre(p) { return `${p.empleado?.apellido ?? ''}, ${p.empleado?.nombre ?? ''}`.replace(/^,\s*/, ''); }

async function llamarNexo(action, body) {
  const cfg = NEXO_CONFIG[tenant];
  const r = await fetch(`${cfg.url}?action=${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, ...body }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) {
    const err = new Error(data.error ?? `Error de conexión (HTTP ${r.status})`);
    err.status = r.status;
    throw err;
  }
  return data;
}

const ESTADO_HIST = {
  aprobado:  { txt: 'Aprobado',  cls: 'aut-est--ok' },
  rechazado: { txt: 'Rechazado', cls: 'aut-est--no' },
  pendiente: { txt: 'Pendiente', cls: 'aut-est--pend' },
};
const DIAS_RESUMEN = 90;

// Historial de la persona dentro de la ventana del pedido: un resumen de los últimos 90 días
// (sin contar rechazados, que no se tomaron) y la lista de sus últimos 10 permisos. Si no se
// puede cargar, se avisa ahí mismo y se puede autorizar igual — no bloquea la decisión.
async function cargarHistorial(p, cont) {
  let historial;
  try {
    historial = (await llamarNexo('autorizador_historial', { permiso_id: p.id })).historial || [];
  } catch {
    cont.innerHTML = '<p class="aut-hist-vacio">No se pudo cargar el historial.</p>';
    return;
  }
  if (!cont.isConnected) return; // la ventana se cerró mientras cargaba
  if (!historial.length) {
    cont.innerHTML = '<p class="aut-hist-vacio">Es su primer permiso.</p>';
    return;
  }

  const desde = new Date(Date.now() - DIAS_RESUMEN * 86400000).toISOString().slice(0, 10);
  const conteo = {};
  historial
    .filter(h => h.estado !== 'rechazado' && h.fecha >= desde)
    .forEach(h => { conteo[h.tipo] = (conteo[h.tipo] || 0) + 1; });
  const PLURAL = { llegada_tarde: 'llegadas tarde', salida_anticipada: 'salidas anticipadas', ausencia: 'ausencias' };
  const resumen = Object.entries(conteo)
    .map(([tipo, n]) => `${n} ${n === 1 ? (TIPO_LABEL[tipo] || tipo).toLowerCase() : (PLURAL[tipo] || tipo)}`)
    .join(' · ');

  cont.innerHTML = `
    <p class="aut-hist-resumen">${resumen
      ? `Últimos ${DIAS_RESUMEN} días: <strong>${e(resumen)}</strong>`
      : `Sin otros permisos en los últimos ${DIAS_RESUMEN} días.`}</p>
    <ul class="aut-hist-lista">
      ${historial.map(h => {
        const est = ESTADO_HIST[h.estado] || { txt: h.estado, cls: '' };
        return `
          <li class="aut-hist-item">
            <span class="aut-hist-fecha">${e(fmtFecha(h.fecha))}</span>
            <span class="aut-hist-info">
              <span class="aut-hist-tipo">${e(TIPO_LABEL[h.tipo] || h.tipo)}${h.tipo !== 'ausencia' && h.hora ? ` · ${e(String(h.hora).slice(0, 5))} h` : ''}</span>
              ${h.motivo ? `<span class="aut-hist-motivo">${e(h.motivo)}</span>` : ''}
            </span>
            <span class="aut-est ${est.cls}">${e(est.txt)}</span>
          </li>`;
      }).join('')}
    </ul>`;
}

function mostrarError(titulo, texto) {
  app.innerHTML = `<div class="aut-error" role="alert"><h1>${e(titulo)}</h1><p>${e(texto)}</p></div>`;
}

async function iniciar() {
  if (!tenant || !NEXO_CONFIG[tenant] || !token) {
    mostrarError('Link incompleto', 'Abrí esta página desde el botón "Revisar y autorizar" del mail que te llegó.');
    return;
  }
  let datos;
  try {
    datos = await llamarNexo('autorizador_pendientes', {});
  } catch (err) {
    mostrarError(err.status === 401 ? 'El link venció' : 'No se pudieron cargar los permisos', err.message);
    return;
  }

  let permisos = datos.permisos || [];
  let aviso = '';
  // El permiso del mail ya no está pendiente: lo resolvió otro (o RRHH desde el Tablero).
  if (permisoInicial && !permisos.some(p => p.id === permisoInicial)) {
    aviso = '<div class="aut-aviso aut-aviso--ok" role="status">El permiso de este aviso ya fue resuelto. Abajo están los que siguen pendientes de tu área.</div>';
  }

  function render() {
    app.innerHTML = `
      <header class="aut-top">
        <p class="aut-marca">${e(datos.empresa)}</p>
        <h1 class="aut-titulo">Autorización de permisos</h1>
        <p class="aut-sub">${datos.responsable ? `Hola, ${e(datos.responsable)} · ` : ''}${permisos.length
          ? `${permisos.length} permiso${permisos.length !== 1 ? 's' : ''} pendiente${permisos.length !== 1 ? 's' : ''} de tu área`
          : 'No tenés permisos pendientes'}</p>
      </header>
      ${aviso}
      ${permisos.length ? `
        <div class="aut-lista">
          ${permisos.map(p => `
            <button type="button" class="aut-fila" data-id="${e(p.id)}">
              <span>
                <span class="aut-fila-nombre">${e(nombre(p))}</span>
                <span class="aut-fila-meta"><span class="aut-tipo">${e(TIPO_LABEL[p.tipo] || p.tipo)}</span> ${e(fmtCuando(p))}${p.motivo ? ` · ${e(p.motivo)}` : ''}</span>
              </span>
              <span class="aut-fila-ver">Revisar →</span>
            </button>`).join('')}
        </div>`
        : '<p class="aut-vacio">Todo al día ✓</p>'}
    `;
    app.querySelectorAll('.aut-fila').forEach(btn =>
      btn.addEventListener('click', () => abrirDetalle(permisos.find(p => p.id === btn.dataset.id))));
  }

  function quitarDeLista(id, mensaje) {
    permisos = permisos.filter(p => p.id !== id);
    aviso = `<div class="aut-aviso aut-aviso--ok" role="status">${e(mensaje)}</div>`;
    render();
  }

  function abrirDetalle(p) {
    if (!p) return;
    const overlay = document.createElement('div');
    overlay.className = 'sol__modal-overlay';
    overlay.innerHTML = `
      <div class="sol__modal aut-modal" role="dialog" aria-modal="true" aria-labelledby="aut-modal-tit">
        <div>
          <h2 class="sol__modal-titulo" id="aut-modal-tit">${e(TIPO_LABEL[p.tipo] || p.tipo)}</h2>
          <p class="sol__modal-desc">${e(nombre(p))} · Legajo ${e(p.empleado?.legajo)}</p>
        </div>
        <dl class="aut-detalle">
          <dt>Fecha</dt><dd>${e(fmtCuando(p))}</dd>
          ${p.motivo ? `<dt>Motivo</dt><dd>${e(p.motivo)}</dd>` : ''}
          <dt>Pedido el</dt><dd>${e(new Date(p.created_at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))}</dd>
        </dl>
        <section class="aut-hist" aria-labelledby="aut-hist-tit">
          <h3 class="aut-hist-tit" id="aut-hist-tit">Últimos permisos de ${e(p.empleado?.nombre || nombre(p))}</h3>
          <div id="aut-hist-cuerpo"><p class="aut-hist-vacio">Cargando historial…</p></div>
        </section>
        <label class="sol__modal-label" for="aut-obs">Comentario <span id="aut-obs-req" style="font-weight:400;color:var(--color-texto-sec)">(opcional para autorizar, obligatorio para rechazar)</span></label>
        <textarea class="sol__modal-input" id="aut-obs" rows="2" placeholder="Ej: Ok, avisá a tu compañero de turno"></textarea>
        <p class="aut-msg-error" id="aut-error" role="alert"></p>
        <div class="aut-acciones">
          <button type="button" class="aut-btn" id="aut-cancelar">Cerrar</button>
          <button type="button" class="aut-btn aut-btn--no" id="aut-rechazar">Rechazar</button>
          <button type="button" class="aut-btn aut-btn--ok" id="aut-aprobar">Autorizar</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const alTeclado = ev => { if (ev.key === 'Escape') cerrar(); };
    function cerrar() {
      document.removeEventListener('keydown', alTeclado);
      cerrarConAnimacion(overlay, () => overlay.remove());
    }
    document.addEventListener('keydown', alTeclado);
    overlay.addEventListener('click', ev => { if (ev.target === overlay) cerrar(); });
    overlay.querySelector('#aut-cancelar').addEventListener('click', cerrar);

    const obs = overlay.querySelector('#aut-obs');
    const errorEl = overlay.querySelector('#aut-error');
    const botones = [...overlay.querySelectorAll('.aut-btn')];

    async function resolver(accion) {
      const observacion = obs.value.trim();
      if (accion === 'rechazar' && !observacion) {
        errorEl.textContent = 'Para rechazar, escribí el motivo en el comentario.';
        obs.focus();
        return;
      }
      errorEl.textContent = '';
      botones.forEach(b => { b.disabled = true; });
      const btn = overlay.querySelector(accion === 'aprobar' ? '#aut-aprobar' : '#aut-rechazar');
      const textoOriginal = btn.textContent;
      btn.textContent = 'Guardando…';
      try {
        await llamarNexo('autorizador_resolver', { permiso_id: p.id, accion, observacion });
        const ok = accion === 'aprobar';
        overlay.querySelector('.aut-modal').innerHTML = `
          <div class="aut-resultado" role="status">
            <div class="aut-resultado-icono" aria-hidden="true">${ok ? '✓' : '✕'}</div>
            <p class="aut-resultado-txt" style="color:${ok ? '#16a34a' : '#dc2626'}">Permiso ${ok ? 'autorizado' : 'rechazado'}</p>
            <p class="sol__modal-desc">${e(nombre(p))} · ${e(TIPO_LABEL[p.tipo] || p.tipo)} · ${e(fmtCuando(p))}</p>
            ${ok ? '<p class="sol__modal-desc" style="margin-top:8px">Se le avisó por mail.</p>' : ''}
          </div>`;
        setTimeout(() => {
          cerrar();
          quitarDeLista(p.id, `${ok ? 'Autorizaste' : 'Rechazaste'} el permiso de ${nombre(p)}.`);
        }, 1400);
      } catch (err) {
        // 409: mientras tanto lo resolvió otro (o RRHH) — sale de la lista igual.
        if (err.status === 409) {
          cerrar();
          quitarDeLista(p.id, `El permiso de ${nombre(p)} ya había sido resuelto.`);
          return;
        }
        errorEl.textContent = err.message;
        botones.forEach(b => { b.disabled = false; });
        btn.textContent = textoOriginal;
      }
    }
    cargarHistorial(p, overlay.querySelector('#aut-hist-cuerpo'));
    overlay.querySelector('#aut-aprobar').addEventListener('click', () => resolver('aprobar'));
    overlay.querySelector('#aut-rechazar').addEventListener('click', () => resolver('rechazar'));
    overlay.querySelector('#aut-aprobar').focus();
  }

  render();
  // Desde el mail: se abre directo el detalle del permiso que motivó el aviso.
  const inicial = permisos.find(p => p.id === permisoInicial);
  if (inicial) abrirDetalle(inicial);
}

iniciar();
