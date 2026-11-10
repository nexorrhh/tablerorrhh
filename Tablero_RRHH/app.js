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
import { mostrarLogin, refrescarUsuario } from './components/login.js';
import { obtenerUsuario, cerrarSesion } from './data/usuario-activo.js';
import { inicializarTema }          from './data/tema-modo.js';
import { renderizarPanel }          from './components/panel-inicio.js';
import { crearBotonAccion }         from './components/boton-accion.js';

import { sbGet, sbContar } from './data/supabase-rest.js';
import { htmlError } from './components/util.js';
import { nexoCall } from './data/nexo-permisos.js';

// ── Definición de módulos del sidebar ────────────────────────────────────────
const PANEL_ITEM = { id: 'panel', titulo: 'Panel', icono: 'panel', submodulos: [] };
const SIDEBAR_ITEMS_TODOS = [PANEL_ITEM, ...navegacion.sort((a, b) => a.orden - b.orden)];
// Se recalcula en cada login según el perfil (ver actualizarSidebarPara) — todo lo que navega
// por módulos (sidebar, deep links, cambiarModulo) usa esta variable, nunca la lista completa
// de arriba directamente, así un perfil restringido no puede llegar a un módulo ajeno ni por URL.
let SIDEBAR_ITEMS = SIDEBAR_ITEMS_TODOS;

// Perfiles con perfiles_rrhh.modulos_permitidos cargado (ver Login) quedan limitados a esos
// módulos únicamente — pensado para gente a la que solo le corresponde ver una parte puntual
// del Tablero (ej. un encargado que solo debe ver Horas y Presentismo). Sin ese campo cargado
// (la gran mayoría de los perfiles), ve todos los módulos como siempre.
// ¿La persona puede ver este módulo? (módulos tildados en Configuración → Usuarios).
// El Panel se ve siempre.
function puedeVerModulo(usuario, id) {
  if (id === 'panel') return true;
  const permitidos = usuario?.modulosPermitidos;
  return !permitidos || permitidos.includes(id);
}

// Los módulos con `permisosModulo` (Configuración) se ven si la persona tiene alguno de esos
// permisos (administrador o "Parametrizar"), sin importar sus módulos tildados.
function actualizarSidebarPara(usuario) {
  SIDEBAR_ITEMS = SIDEBAR_ITEMS_TODOS.filter(item => {
    if (item.permisosModulo) return item.permisosModulo.some(p => usuario?.permisos?.includes(p));
    return puedeVerModulo(usuario, item.id);
  });
  return SIDEBAR_ITEMS;
}

// ── Estado de navegación ─────────────────────────────────────────────────────
let modActivo    = 'panel';
let submodActivo = null;
let badges       = {};
let usuarioActivo = null;

// Filtra los sub-módulos que requieren un permiso que el usuario activo no tiene
// (ver campo `permiso` en config/navegacion.js y `permisos` en data/usuario-activo.js).
function modConPermisos(mod) {
  if (!mod) return mod;
  // `permiso`: la solapa pide ese permiso. `modulo`: la solapa de Configuración de un módulo
  // (ej. Vacaciones) solo aparece si la persona puede ver ese módulo.
  const submodulos = (mod.submodulos ?? []).filter(s =>
    (!s.permiso || usuarioActivo?.permisos?.includes(s.permiso)) &&
    (!s.modulo || puedeVerModulo(usuarioActivo, s.modulo)));
  return { ...mod, submodulos };
}

// ── Badges: pendientes por módulo ────────────────────────────────────────────
async function actualizarBadges() {
  const fechaLimite = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const hoyISO      = new Date().toISOString().slice(0, 10);

  // sbContar cuenta en el servidor sin descargar las filas. allSettled: si un contador
  // falla, ese badge queda en 0 y el resto se muestra igual (son solo avisos).
  const [rPost, rContr, rLic, rInst, rPagos, rPermCim, rPermCom] = await Promise.allSettled([
    sbContar('solicitudes_personal?estado=eq.pendiente'),
    sbContar(`contratos_vencimiento?fecha_vencimiento=lte.${fechaLimite}`),
    sbContar(`licencias_vencimiento?fecha_vencimiento=lte.${fechaLimite}`),
    sbGet('vencimientos_institucionales?select=fecha_vencimiento,preaviso_meses'),
    // Los pagos solo notifican si ya vencieron o vencen hoy (no con anticipación como el resto).
    sbContar(`pagos_vencimiento?pagado=eq.false&omitido=eq.false&necesita_revision=eq.false&fecha_vencimiento=lte.${hoyISO}`),
    // Permisos: no es una tabla de este Supabase — es la Edge Function de Nexo RRHH,
    // un tenant por empresa (ver data/nexo-permisos.js).
    nexoCall('cimomet', 'get_permisos_pendientes', {}),
    nexoCall('comoing', 'get_permisos_pendientes', {}),
  ]);

  const valor = (r) => {
    if (r.status === 'fulfilled') return r.value;
    console.warn('Badge sin dato:', r.reason?.message || r.reason);
    return 0;
  };

  let nInst = 0;
  if (rInst.status === 'fulfilled') {
    const hoyB = new Date(); hoyB.setHours(0, 0, 0, 0);
    nInst = rInst.value.filter(r => {
      const d = Math.round((new Date(r.fecha_vencimiento + 'T00:00:00') - hoyB) / 86400000);
      return d <= r.preaviso_meses * 30;
    }).length;
  }

  const nPerm = (rPermCim.status === 'fulfilled' ? (rPermCim.value.permisos || []).length : 0)
              + (rPermCom.status === 'fulfilled' ? (rPermCom.value.permisos || []).length : 0);

  badges = { ...badges, postulantes: valor(rPost), vencimientos: valor(rContr) + valor(rLic) + nInst + valor(rPagos), permisos: nPerm };

  // Configuración: cuántas cosas quedaron sin parametrizar (puestos, conceptos, evaluadores…),
  // solo para quien puede parametrizar y solo de las solapas que ve.
  if (usuarioActivo?.permisos?.includes('parametrizar')) {
    try {
      const { calcularPendientes, totalPendientes } = await import('./data/pendientes-parametrizacion.js');
      badges = { ...badges, configuracion: totalPendientes(await calcularPendientes(solapasConfiguracion())) };
    } catch (e) { console.warn('Badge de Configuración sin dato:', e.message); }
  }
}

// Solapas de Configuración que ve la persona activa (según sus permisos y módulos).
function solapasConfiguracion() {
  return (modConPermisos(navegacion.find(n => n.id === 'configuracion'))?.submodulos || []).map(s => s.id);
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

// ── Registro de pantallas ────────────────────────────────────────────────────
// tipo (config/navegacion.js) → qué módulo cargar y con qué argumentos. Se importa
// recién al abrir la pantalla (import dinámico): la app arranca sin descargar los ~40
// componentes, y agregar una pantalla nueva es sumar una línea acá, no otro else-if.
const refrescarBadges = async () => { await actualizarBadges(); refrescarNav(); };
const PANTALLAS = {
  'plantel-resumen':         { m: () => import('./components/plantel-resumen.js'),          f: 'renderizarPlantelResumen' },
  'plantel-listado':         { m: () => import('./components/plantel-listado.js'),          f: 'renderizarPlantelListado' },
  'plantel-parametrizacion': { m: () => import('./components/plantel-parametrizacion.js'),  f: 'renderizarPlantelParametrizacion' },
  'plantel-importar':        { m: () => import('./components/plantel-importar.js'),         f: 'renderizarPlantelImportar' },
  'sabados-resumen':         { m: () => import('./components/sabados-resumen.js'),          f: 'renderizarSabadosResumen' },
  'sabados-marcar':          { m: () => import('./components/sabados-marcar.js'),           f: 'renderizarSabadosMarcar' },
  'busquedas':               { m: () => import('./components/busquedas.js'),                f: 'renderizarBusquedas', args: () => [refrescarBadges] },
  'busquedas-activas':       { m: () => import('./components/busquedas-activas.js'),        f: 'renderizarBusquedasActivas' },
  'busquedas-historial':     { m: () => import('./components/busquedas-historial.js'),      f: 'renderizarBusquedasHistorial' },
  'post-lista':              { m: () => import('./components/postulantes-lista.js'),        f: 'renderizarPostulantesLista' },
  'post-preseleccion':       { m: () => import('./components/postulantes-preseleccion.js'), f: 'renderizarPostulantesPreseleccion' },
  'post-candidatos':         { m: () => import('./components/postulantes-candidatos.js'),   f: 'renderizarPostulantesCandidatos' },
  'post-rechazados':         { m: () => import('./components/postulantes-rechazados.js'),   f: 'renderizarPostulantesRechazados' },
  'venc-resumen':            { m: () => import('./components/vencimientos-resumen.js'),     f: 'renderizarVencimientosResumen' },
  'venc-institucional-todo': { m: () => import('./components/vencimientos-institucional-todo.js'), f: 'renderizarVencimientosInstitucionalTodo' },
  'venc-pagos':              { m: () => import('./components/vencimientos-pagos.js'),       f: 'renderizarVencimientosPagos' },
  'arca-proveedores':        { m: () => import('./components/arca-proveedores.js'),         f: 'renderizarArcaProveedores' },
  'arca-importar':           { m: () => import('./components/arca-importar.js'),            f: 'renderizarArcaImportar' },
  'arca-autorizar':          { m: () => import('./components/arca-autorizar.js'),           f: 'renderizarArcaAutorizar' },
  'arca-seguimiento':        { m: () => import('./components/arca-seguimiento.js'),         f: 'renderizarArcaSeguimiento' },
  'cumpleanos-antiguedad':   { m: () => import('./components/cumpleanos-antiguedad.js'),    f: 'renderizarCumpleanosAntiguedad' },
  'pres-resumen':            { m: () => import('./components/presentismo-resumen.js'),      f: 'renderizarPresentismoResumen', args: () => [() => cambiarSubmodulo('cargar')] },
  'pres-personas':           { m: () => import('./components/presentismo-personas.js'),     f: 'renderizarPresentismoPersonas' },
  'pres-ficha':              { m: () => import('./components/presentismo-ficha.js'),        f: 'renderizarPresentismoFicha' },
  'pres-carga':              { m: () => import('./components/presentismo-carga.js'),        f: 'renderizarPresentismoCarga', args: () => [() => cambiarSubmodulo('resumen')] },
  'pres-indicadores':        { m: () => import('./components/presentismo-indicadores.js'),  f: 'renderizarPresentismoIndicadores' },
  'pres-novedades':          { m: () => import('./components/presentismo-novedades.js'),    f: 'renderizarPresentismoNovedades' },
  'pres-horas-ot':           { m: () => import('./components/horas-ot.js'),                 f: 'renderizarHorasOT' },
  'pres-horas-cruce':        { m: () => import('./components/horas-cruce.js'),              f: 'renderizarHorasCruce' },
  'pres-parametrizacion':    { m: () => import('./components/presentismo-parametrizacion.js'), f: 'renderizarPresentismoParametrizacion' },
  'desem-evaluaciones':      { m: () => import('./components/desempeno-evaluaciones.js'),   f: 'renderizarDesempenoEvaluaciones' },
  'desem-indicadores':       { m: () => import('./components/desempeno-indicadores.js'),    f: 'renderizarDesempenoIndicadores' },
  'desem-parametrizacion':   { m: () => import('./components/desempeno-parametrizacion.js'), f: 'renderizarDesempenoParametrizacion' },
  'vac-resumen':             { m: () => import('./components/vacaciones-resumen.js'),       f: 'renderizarVacacionesResumen',
                               // "configuracion" ahora vive en Configuración → Vacaciones (otro módulo).
                               args: () => [sub => (sub === 'configuracion' ? cambiarModulo('configuracion', 'vacaciones') : cambiarSubmodulo(sub))] },
  'vac-planificacion':       { m: () => import('./components/vacaciones-planificacion.js'), f: 'renderizarVacacionesPlanificacion' },
  'vac-cobertura':           { m: () => import('./components/vacaciones-mapa.js'),          f: 'renderizarVacacionesMapa' },
  'proyeccion-horas':        { m: () => import('./components/proyeccion-horas.js'),         f: 'renderizarProyeccionHoras' },
  'vac-escenarios':          { m: () => import('./components/vacaciones-escenarios.js'),    f: 'renderizarVacacionesEscenarios', args: () => [cambiarSubmodulo] },
  'vac-saldos':              { m: () => import('./components/vacaciones-saldos.js'),        f: 'renderizarVacacionesSaldos' },
  'vac-config':              { m: () => import('./components/vacaciones-config.js'),        f: 'renderizarVacacionesConfig' },
  'cfg-pendientes':          { m: () => import('./components/configuracion-pendientes.js'), f: 'renderizarConfigPendientes',
                               args: () => [cambiarSubmodulo, solapasConfiguracion(), total => { badges = { ...badges, configuracion: total }; refrescarNav(); }] },
  'cfg-usuarios':            { m: () => import('./components/configuracion-accesos.js'),   f: 'renderizarConfigUsuarios' },
  'perm-autorizacion':       { m: () => import('./components/permisos-autorizacion.js'),    f: 'renderizarPermisosAutorizacion', args: () => [refrescarBadges] },
  'perm-autorizados':        { m: () => import('./components/permisos-autorizados.js'),     f: 'renderizarPermisosAutorizados' },
  'perm-indicadores':        { m: () => import('./components/permisos-indicadores.js'),     f: 'renderizarPermisosIndicadores' },
  'perm-autorizadores':      { m: () => import('./components/permisos-autorizadores.js'),   f: 'renderizarPermisosAutorizadores' },
};

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
    try {
      await renderizarPanel(contenedor, cambiarModulo);
    } catch (e) {
      console.error('Panel', e);
      contenedor.innerHTML = htmlError('No se pudo abrir el panel.', e.message);
    }
    volcarContenido();
    return;
  }

  const mod   = modConPermisos(navegacion.find(n => n.id === modActivo));
  const submod = mod?.submodulos?.find(s => s.id === submodActivo);
  if (!submod) { volcarContenido(); return; }

  // Si una pantalla falla (red, dato inesperado, error de código) se muestra el error en
  // vez de dejar "Cargando…" para siempre; el resto del tablero sigue funcionando.
  try {
    const pantalla = PANTALLAS[submod.tipo];
    if (submod.tipo === 'botones') {
      mostrarBotones(submod.secciones, contenedor);
    } else if (pantalla) {
      const modulo = await pantalla.m();
      await modulo[pantalla.f](contenedor, ...(pantalla.args ? pantalla.args() : []));
    } else {
      mostrarPlaceholder(submod.mensaje, contenedor);
    }
  } catch (e) {
    console.error(`Pantalla "${submod.tipo}"`, e);
    contenedor.innerHTML = htmlError('No se pudo abrir esta pantalla.', e.message);
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
async function cambiarModulo(id, submoduloDestino = null) {
  modActivo = id;
  const mod = modConPermisos(SIDEBAR_ITEMS.find(item => item.id === id));
  submodActivo = mod?.submodulos?.some(sub => sub.id === submoduloDestino)
    ? submoduloDestino
    : mod?.submodulos?.[0]?.id ?? null;

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
  actualizarSidebarPara(usuarioActivo);
  submodActivo = null;
  badges       = {};
  await cambiarModulo(SIDEBAR_ITEMS[0]?.id ?? 'panel');
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
  // Se vuelve a leer el perfil: si lo deshabilitaron o le cambiaron los módulos desde
  // Configuración, se aplica ya (y si no puede entrar más, vuelve al login).
  if (usuarioActivo) {
    usuarioActivo = await refrescarUsuario(usuarioActivo);
    if (!usuarioActivo) cerrarSesion();
  }
  if (!usuarioActivo) {
    usuarioActivo = await mostrarLogin();
  }
  actualizarSidebarPara(usuarioActivo);

  const fueDeepLink = await aplicarDeepLinkInicial();
  if (!fueDeepLink) await cambiarModulo(SIDEBAR_ITEMS[0]?.id ?? 'panel');

  // Cargar badges de pendientes en segundo plano
  actualizarBadges().then(refrescarNav);
});
