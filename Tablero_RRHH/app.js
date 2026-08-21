// Orquestador. Gestiona los dos niveles de navegación:
//   Nivel 1 — Módulo  (sidebar):  Panel | Permisos | Sábados | Postulantes
//   Nivel 2 — Sub-módulo (tabs):  Generar | Pendientes | Autorizados  (según módulo)
//
// Los cambios de contenido van a config/. Este archivo casi nunca se toca.

import { secciones }   from './config/secciones.js';
import { botones }     from './config/botones.js';
import { navegacion }  from './config/navegacion.js';

import { renderizarNavLateral }     from './components/nav-lateral.js';
import { renderizarHeader }         from './components/header.js';
import { mostrarLogin }             from './components/login.js';
import { obtenerUsuario, cerrarSesion } from './data/usuario-activo.js';
import { inicializarTema }          from './data/tema-modo.js';
import { renderizarPanel }          from './components/panel-inicio.js';
import { crearBotonAccion }         from './components/boton-accion.js';
import { renderizarPlantelResumen }  from './components/plantel-resumen.js';
import { renderizarPlantelListado }  from './components/plantel-listado.js';
import { renderizarSabadosResumen }  from './components/sabados-resumen.js';
import { renderizarSabadosMarcar }   from './components/sabados-marcar.js';
import { renderizarBusquedas }               from './components/busquedas.js';
import { renderizarBusquedasActivas }        from './components/busquedas-activas.js';
import { renderizarBusquedasHistorial }      from './components/busquedas-historial.js';
import { renderizarPostulantesLista }       from './components/postulantes-lista.js';
import { renderizarPostulantesPreseleccion } from './components/postulantes-preseleccion.js';
import { renderizarPostulantesCandidatos }  from './components/postulantes-candidatos.js';
import { renderizarPostulantesRechazados }  from './components/postulantes-rechazados.js';
import { renderizarVencimientosResumen }           from './components/vencimientos-resumen.js';
import { renderizarVencimientosInstitucionalTodo } from './components/vencimientos-institucional-todo.js';
import { renderizarVencimientosPagos }             from './components/vencimientos-pagos.js';
import { renderizarArcaProveedores }           from './components/arca-proveedores.js';
import { renderizarArcaImportar }              from './components/arca-importar.js';
import { renderizarArcaAutorizar }             from './components/arca-autorizar.js';
import { renderizarArcaSeguimiento }           from './components/arca-seguimiento.js';
import { renderizarCumpleanosAntiguedad }  from './components/cumpleanos-antiguedad.js';
import { renderizarPlantelParametrizacion } from './components/plantel-parametrizacion.js';
import { renderizarPresentismoResumen }       from './components/presentismo-resumen.js';
import { renderizarPresentismoPersonas }      from './components/presentismo-personas.js';
import { renderizarPresentismoFicha }         from './components/presentismo-ficha.js';
import { renderizarPresentismoCarga }         from './components/presentismo-carga.js';
import { renderizarPresentismoIndicadores }   from './components/presentismo-indicadores.js';
import { renderizarPresentismoNovedades }     from './components/presentismo-novedades.js';
import { renderizarPresentismoParametrizacion } from './components/presentismo-parametrizacion.js';
import { renderizarHorasOT }                  from './components/horas-ot.js';
import { renderizarHorasCruce }               from './components/horas-cruce.js';
import { renderizarPermisosAutorizacion }     from './components/permisos-autorizacion.js';
import { renderizarPermisosAutorizados }      from './components/permisos-autorizados.js';
import { renderizarPermisosIndicadores }      from './components/permisos-indicadores.js';
import { renderizarPermisosAutorizadores }    from './components/permisos-autorizadores.js';

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './data/fuentes.js';
import { nexoCall } from './data/nexo-permisos.js';

// ── Definición de módulos del sidebar ────────────────────────────────────────
const PANEL_ITEM = { id: 'panel', titulo: 'Panel', icono: 'panel', submodulos: [] };
const SIDEBAR_ITEMS = [PANEL_ITEM, ...navegacion.sort((a, b) => a.orden - b.orden)];

// ── Estado de navegación ─────────────────────────────────────────────────────
let modActivo    = 'panel';
let submodActivo = null;
let badges       = {};
let usuarioActivo = null;

// Filtra los sub-módulos que requieren un permiso que el usuario activo no tiene
// (ver campo `permiso` en config/navegacion.js y `permisos` en data/usuario-activo.js).
function modConPermisos(mod) {
  if (!mod) return mod;
  const submodulos = (mod.submodulos ?? []).filter(s => !s.permiso || usuarioActivo?.permisos?.includes(s.permiso));
  return { ...mod, submodulos };
}

// ── Badges: pendientes por módulo ────────────────────────────────────────────
async function actualizarBadges() {
  const HDR_SB = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
  const fechaLimite = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const hoyISO      = new Date().toISOString().slice(0, 10);

  const [rPost, rContr, rLic, rInstBadge, rPagos, rPermCim, rPermCom] = await Promise.allSettled([
    fetch(`${SUPABASE_URL}/rest/v1/solicitudes_personal?estado=eq.pendiente&select=id`, { headers: HDR_SB }),
    fetch(`${SUPABASE_URL}/rest/v1/contratos_vencimiento?fecha_vencimiento=lte.${fechaLimite}&select=id`, { headers: HDR_SB }),
    fetch(`${SUPABASE_URL}/rest/v1/licencias_vencimiento?fecha_vencimiento=lte.${fechaLimite}&select=id`, { headers: HDR_SB }),
    fetch(`${SUPABASE_URL}/rest/v1/vencimientos_institucionales?select=fecha_vencimiento,preaviso_meses`, { headers: HDR_SB }),
    // Los pagos solo notifican si ya vencieron o vencen hoy (no con anticipación como el resto).
    fetch(`${SUPABASE_URL}/rest/v1/pagos_vencimiento?pagado=eq.false&omitido=eq.false&necesita_revision=eq.false&fecha_vencimiento=lte.${hoyISO}&select=id`, { headers: HDR_SB }),
    // Permisos: no es una tabla de este Supabase — es la Edge Function de Nexo RRHH,
    // un tenant por empresa (ver data/nexo-permisos.js).
    nexoCall('cimomet', 'get_permisos_pendientes', {}),
    nexoCall('comoing', 'get_permisos_pendientes', {}),
  ]);

  async function count(settled) {
    if (settled.status !== 'fulfilled' || !settled.value.ok) return 0;
    return (await settled.value.json()).length;
  }

  const [nPost, nContr, nLic, nPagos] = await Promise.all([count(rPost), count(rContr), count(rLic), count(rPagos)]);

  let nInst = 0;
  if (rInstBadge.status === 'fulfilled' && rInstBadge.value.ok) {
    const instItems = await rInstBadge.value.json();
    const hoyB = new Date(); hoyB.setHours(0, 0, 0, 0);
    nInst = instItems.filter(r => {
      const d = Math.round((new Date(r.fecha_vencimiento+'T00:00:00') - hoyB) / 86400000);
      return d <= r.preaviso_meses * 30;
    }).length;
  }

  const nPerm = (rPermCim.status === 'fulfilled' ? (rPermCim.value.permisos || []).length : 0)
              + (rPermCom.status === 'fulfilled' ? (rPermCom.value.permisos || []).length : 0);

  badges = { ...badges, postulantes: nPost, vencimientos: nContr + nLic + nInst + nPagos, permisos: nPerm };
}

function refrescarNav() {
  renderizarNavLateral(SIDEBAR_ITEMS, modActivo, cambiarModulo, badges);
}

// ── Renderizar columnas de botones ───────────────────────────────────────────
// seccionIds: array de ids de config/secciones.js a mostrar
function mostrarBotones(seccionIds, contenedor) {
  const seccionesAMostrar = [...secciones]
    .filter(s => seccionIds.includes(s.id))
    .sort((a, b) => a.orden - b.orden);

  let html = '<div class="columnas-botones">';
  seccionesAMostrar.forEach(seccion => {
    const botonesDeSeccion = botones.filter(b => b.seccion === seccion.id);
    if (!botonesDeSeccion.length) return;
    html += `
      <div class="columna-botones">
        <h2 class="columna-botones__titulo">${seccion.titulo}</h2>
        <div class="columna-botones__lista">
          ${botonesDeSeccion.map(crearBotonAccion).join('')}
        </div>
      </div>
    `;
  });
  html += '</div>';
  contenedor.innerHTML = html;
}

// ── Renderizar vista "próximamente" ──────────────────────────────────────────
function mostrarPlaceholder(mensaje, contenedor) {
  contenedor.innerHTML = `
    <div class="estado-vacio">
      <div class="estado-vacio__icono">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
      </div>
      <h3 class="estado-vacio__titulo">Próximamente</h3>
      <p class="estado-vacio__texto">${mensaje}</p>
    </div>
  `;
}

// ── Transición entre pantallas de contenido (mismo fundido que el login) ────────
const DURACION_SALIDA_CONTENIDO = 140; // ms — tiene que coincidir con .contenido-saliendo

// Desvanece lo que hay actualmente en el contenedor antes de reemplazarlo. Si el contenedor
// ya está vacío (primer render de la app), no hay nada que desvanecer y se resuelve al toque.
function desvanecerContenido(contenedor) {
  if (!contenedor.innerHTML.trim()) return Promise.resolve();
  return new Promise(resolve => {
    contenedor.classList.remove('contenido-entrando', 'contenido-pre-entrada');
    contenedor.classList.add('contenido-saliendo');
    setTimeout(resolve, DURACION_SALIDA_CONTENIDO);
  });
}

// La pantalla nueva se arma con el contenedor en 'contenido-pre-entrada' (invisible) — así
// ni el corte ni el "Cargando..." intermedio de cada renderizarX se llegan a notar — y recién
// acá, con el contenido ya final, se destapa con un fundido.
function animarEntradaContenido(contenedor) {
  contenedor.classList.remove('contenido-saliendo');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    contenedor.classList.remove('contenido-pre-entrada');
    contenedor.classList.add('contenido-entrando');
  }));
}

// Cada llamada a renderizarContenido() lleva un número de generación. Si el usuario cambia
// de pestaña mientras una llamada anterior todavía está esperando sus propios fetch (algunas
// pantallas hacen varias llamadas seguidas a Supabase y tardan unos segundos), esa llamada
// vieja terminaría escribiendo su contenido sobre el de la pestaña nueva — sin este chequeo,
// gana la que responde último, no la que está activa. Por eso cada render arma su contenido
// en un <div> aparte (nunca en el vivo) y solo lo vuelca al DOM real si, al terminar, sigue
// siendo la generación más nueva pedida.
let renderGen = 0;

// ── Renderizar contenido según módulo y sub-módulo activos ────────────────────
async function renderizarContenido() {
  const miGen = ++renderGen;
  const contenedorReal = document.getElementById('contenido-principal');
  if (!contenedorReal) return;

  await desvanecerContenido(contenedorReal);
  if (miGen !== renderGen) return; // se pidió otra pestaña mientras se desvanecía la anterior

  // Mientras se arma la pantalla nueva (algunas tardan varios segundos en traer datos —
  // Cruce de Horas, Horas por OT), se muestra un spinner visible en vez de dejar la pantalla
  // en gris sin ningún indicio de que algo está pasando.
  contenedorReal.innerHTML = '<div class="pres__loading">Cargando…</div>';
  contenedorReal.classList.remove('contenido-saliendo');
  contenedorReal.classList.add('contenido-pre-entrada');
  animarEntradaContenido(contenedorReal);

  // Todo lo que sigue arma el contenido en este <div> desconectado del DOM — así ningún
  // renderizarXxx(contenedor) de más abajo puede pisar la pantalla real todavía.
  const contenedor = document.createElement('div');

  if (modActivo === 'panel') {
    await renderizarPanel(contenedor, cambiarModulo);
    volcarContenido();
    return;
  }

  const mod   = modConPermisos(navegacion.find(n => n.id === modActivo));
  const submod = mod?.submodulos?.find(s => s.id === submodActivo);
  if (!submod) { volcarContenido(); return; }

  if (submod.tipo === 'botones') {
    mostrarBotones(submod.secciones, contenedor);
  } else if (submod.tipo === 'plantel-resumen') {
    await renderizarPlantelResumen(contenedor);
  } else if (submod.tipo === 'plantel-listado') {
    await renderizarPlantelListado(contenedor);
  } else if (submod.tipo === 'sabados-resumen') {
    await renderizarSabadosResumen(contenedor);
  } else if (submod.tipo === 'sabados-marcar') {
    await renderizarSabadosMarcar(contenedor);
  } else if (submod.tipo === 'busquedas') {
    await renderizarBusquedas(contenedor, async () => {
      await actualizarBadges();
      refrescarNav();
    });
  } else if (submod.tipo === 'busquedas-activas') {
    await renderizarBusquedasActivas(contenedor);
  } else if (submod.tipo === 'post-lista') {
    await renderizarPostulantesLista(contenedor);
  } else if (submod.tipo === 'post-preseleccion') {
    await renderizarPostulantesPreseleccion(contenedor);
  } else if (submod.tipo === 'post-candidatos') {
    await renderizarPostulantesCandidatos(contenedor);
  } else if (submod.tipo === 'busquedas-historial') {
    await renderizarBusquedasHistorial(contenedor);
  } else if (submod.tipo === 'post-rechazados') {
    await renderizarPostulantesRechazados(contenedor);
  } else if (submod.tipo === 'venc-resumen') {
    await renderizarVencimientosResumen(contenedor);
  } else if (submod.tipo === 'venc-institucional-todo') {
    await renderizarVencimientosInstitucionalTodo(contenedor);
  } else if (submod.tipo === 'venc-pagos') {
    await renderizarVencimientosPagos(contenedor);
  } else if (submod.tipo === 'arca-proveedores') {
    await renderizarArcaProveedores(contenedor);
  } else if (submod.tipo === 'arca-importar') {
    await renderizarArcaImportar(contenedor);
  } else if (submod.tipo === 'arca-autorizar') {
    await renderizarArcaAutorizar(contenedor);
  } else if (submod.tipo === 'arca-seguimiento') {
    await renderizarArcaSeguimiento(contenedor);
  } else if (submod.tipo === 'cumpleanos-antiguedad') {
    await renderizarCumpleanosAntiguedad(contenedor);
  } else if (submod.tipo === 'plantel-parametrizacion') {
    await renderizarPlantelParametrizacion(contenedor);
  } else if (submod.tipo === 'pres-resumen') {
    await renderizarPresentismoResumen(contenedor, () => cambiarSubmodulo('cargar'));
  } else if (submod.tipo === 'pres-personas') {
    await renderizarPresentismoPersonas(contenedor);
  } else if (submod.tipo === 'pres-ficha') {
    await renderizarPresentismoFicha(contenedor);
  } else if (submod.tipo === 'pres-carga') {
    await renderizarPresentismoCarga(contenedor, () => cambiarSubmodulo('resumen'));
  } else if (submod.tipo === 'pres-indicadores') {
    await renderizarPresentismoIndicadores(contenedor);
  } else if (submod.tipo === 'pres-novedades') {
    await renderizarPresentismoNovedades(contenedor);
  } else if (submod.tipo === 'pres-horas-ot') {
    await renderizarHorasOT(contenedor);
  } else if (submod.tipo === 'pres-horas-cruce') {
    await renderizarHorasCruce(contenedor);
  } else if (submod.tipo === 'pres-parametrizacion') {
    await renderizarPresentismoParametrizacion(contenedor);
  } else if (submod.tipo === 'perm-autorizacion') {
    await renderizarPermisosAutorizacion(contenedor, async () => {
      await actualizarBadges();
      refrescarNav();
    });
  } else if (submod.tipo === 'perm-autorizados') {
    await renderizarPermisosAutorizados(contenedor);
  } else if (submod.tipo === 'perm-indicadores') {
    await renderizarPermisosIndicadores(contenedor);
  } else if (submod.tipo === 'perm-autorizadores') {
    await renderizarPermisosAutorizadores(contenedor);
  } else {
    mostrarPlaceholder(submod.mensaje, contenedor);
  }

  volcarContenido();

  // Mueve el <div> desconectado (entero, como una sola pieza) al contenedor real y recién
  // ahí dispara el fundido de entrada — pero solo si nadie pidió otra pestaña mientras tanto
  // (si la generación quedó vieja, se descarta todo en silencio: la pestaña activa ahora es
  // otra y ya tiene su propio render en camino o ya terminado).
  //
  // Importante: se mueve el <div> COMPLETO (appendChild), no sus hijos sueltos. Varias
  // pantallas arrancan un fetch en segundo plano sin esperarlo (ej. presentismo-personas.js
  // llama cargarYMostrar() sin await) y ese código, cuando responde más tarde, sigue usando
  // `contenedor.querySelector(...)` para encontrar sus propios elementos — si se movieran los
  // hijos sueltos, `contenedor` quedaría vacío por dentro y esas búsquedas fallarían con
  // "Cannot set properties of null". Moviendo el <div> entero, `contenedor` sigue siendo el
  // padre real de todo lo que renderizó, esté donde esté colgado en ese momento.
  function volcarContenido() {
    if (miGen !== renderGen) return;
    contenedorReal.innerHTML = '';
    contenedorReal.appendChild(contenedor);
    contenedorReal.classList.remove('contenido-saliendo');
    contenedorReal.classList.add('contenido-pre-entrada');
    animarEntradaContenido(contenedorReal);
  }
}

// ── Cambiar módulo (nivel 1 — sidebar) ───────────────────────────────────────
async function cambiarModulo(id) {
  modActivo = id;
  const mod = modConPermisos(SIDEBAR_ITEMS.find(item => item.id === id));
  submodActivo = mod.submodulos?.[0]?.id ?? null;

  renderizarNavLateral(SIDEBAR_ITEMS, modActivo, cambiarModulo, badges);
  renderizarHeader(mod, submodActivo, cambiarSubmodulo, { usuario: usuarioActivo, alCerrarSesion });
  await renderizarContenido();
}

// ── Cambiar sub-módulo (nivel 2 — tabs) ──────────────────────────────────────
async function cambiarSubmodulo(id) {
  submodActivo = id;
  const mod = modConPermisos(SIDEBAR_ITEMS.find(item => item.id === modActivo));

  renderizarHeader(mod, submodActivo, cambiarSubmodulo, { usuario: usuarioActivo, alCerrarSesion });
  await renderizarContenido();
}

// ── Cerrar sesión ─────────────────────────────────────────────────────────────
// En vez de recargar la página entera (corte seco), se muestra el login de nuevo por
// encima del tablero actual — con su misma transición de fundido — y al elegir un perfil
// se re-renderiza todo para el usuario nuevo, sin perder la sesión de navegador.
async function alCerrarSesion() {
  cerrarSesion();
  usuarioActivo = await mostrarLogin();
  modActivo    = 'panel';
  submodActivo = null;
  badges       = {};
  await cambiarModulo('panel');
  actualizarBadges().then(refrescarNav);
}

// ── Mobile: hamburger ─────────────────────────────────────────────────────────
function inicializarHamburger() {
  const hamburger = document.getElementById('btn-hamburger');
  const overlay   = document.getElementById('nav-overlay');
  const nav       = document.getElementById('nav-lateral');
  if (!hamburger || !overlay || !nav) return;

  hamburger.addEventListener('click', () => {
    const abierto = nav.classList.toggle('nav-lateral--abierto');
    overlay.classList.toggle('nav-overlay--activo', abierto);
    hamburger.setAttribute('aria-expanded', String(abierto));
  });

  overlay.addEventListener('click', () => {
    nav.classList.remove('nav-lateral--abierto');
    overlay.classList.remove('nav-overlay--activo');
    hamburger.setAttribute('aria-expanded', 'false');
  });
}

// ── Deep link: ?modulo=X&submodulo=Y navega directo a esa pantalla al entrar
// (ej. desde el botón de un email: ?modulo=permisos&submodulo=pendientes).
// Valida contra SIDEBAR_ITEMS antes de navegar para no dejar la app en un
// estado roto si el link viene con un id que ya no existe o está mal escrito.
async function aplicarDeepLinkInicial() {
  const params    = new URLSearchParams(window.location.search);
  const moduloId  = params.get('modulo');
  const submodId  = params.get('submodulo');
  if (!moduloId) return false;

  const mod = modConPermisos(SIDEBAR_ITEMS.find(item => item.id === moduloId));
  if (!mod) return false;

  await cambiarModulo(moduloId);
  if (submodId && mod.submodulos?.some(s => s.id === submodId)) {
    await cambiarSubmodulo(submodId);
  }
  window.history.replaceState({}, '', window.location.pathname);
  return true;
}

// ── Punto de entrada ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  inicializarTema();
  inicializarHamburger();

  // Verificar sesión activa; si no hay, mostrar pantalla de login
  usuarioActivo = obtenerUsuario();
  if (!usuarioActivo) {
    usuarioActivo = await mostrarLogin();
  }

  const fueDeepLink = await aplicarDeepLinkInicial();
  if (!fueDeepLink) await cambiarModulo('panel');

  // Cargar badges de pendientes en segundo plano
  actualizarBadges().then(refrescarNav);
});
