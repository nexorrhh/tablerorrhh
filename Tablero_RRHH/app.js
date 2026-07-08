// Orquestador. Gestiona los dos niveles de navegación:
//   Nivel 1 — Módulo  (sidebar):  Panel | Permisos | Sábados | Postulantes
//   Nivel 2 — Sub-módulo (tabs):  Generar | Pendientes | Autorizados  (según módulo)
//
// Los cambios de contenido van a config/. Este archivo casi nunca se toca.

import { tema }        from './config/tema.js';
import { secciones }   from './config/secciones.js';
import { botones }     from './config/botones.js';
import { navegacion }  from './config/navegacion.js';

import { renderizarNavLateral }     from './components/nav-lateral.js';
import { renderizarHeader }         from './components/header.js';
import { mostrarLogin }             from './components/login.js';
import { obtenerUsuario, cerrarSesion } from './data/usuario-activo.js';
import { renderizarPanel }          from './components/panel-inicio.js';
import { crearBotonAccion }         from './components/boton-accion.js';
import { renderizarPlantelResumen }  from './components/plantel-resumen.js';
import { renderizarPlantelListado }  from './components/plantel-listado.js';
import { renderizarSabadosResumen }  from './components/sabados-resumen.js';
import { renderizarSabadosMarcar }   from './components/sabados-marcar.js';
import { renderizarBusquedas }               from './components/busquedas.js';
import { renderizarBusquedasActivas }        from './components/busquedas-activas.js';
import { renderizarBusquedasHistorial }      from './components/busquedas-historial.js';
import { renderizarPostulantesSolicitudes } from './components/postulantes-solicitudes.js';
import { renderizarPostulantesLista }       from './components/postulantes-lista.js';
import { renderizarPostulantesPreseleccion } from './components/postulantes-preseleccion.js';
import { renderizarPostulantesCandidatos }  from './components/postulantes-candidatos.js';
import { renderizarPostulantesRechazados }  from './components/postulantes-rechazados.js';
import { renderizarVencimientosContratos }     from './components/vencimientos-contratos.js';
import { renderizarVencimientosLicencias }     from './components/vencimientos-licencias.js';
import { renderizarVencimientosResumen }       from './components/vencimientos-resumen.js';
import { renderizarVencimientosInstitucional } from './components/vencimientos-institucionales.js';
import { renderizarCumpleanosAntiguedad }  from './components/cumpleanos-antiguedad.js';
import { renderizarPresentismoResumen }       from './components/presentismo-resumen.js';
import { renderizarPresentismoPersonas }      from './components/presentismo-personas.js';
import { renderizarPresentismoCarga }         from './components/presentismo-carga.js';
import { renderizarPresentismoIndicadores }   from './components/presentismo-indicadores.js';

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './data/fuentes.js';

// ── Definición de módulos del sidebar ────────────────────────────────────────
const PANEL_ITEM = { id: 'panel', titulo: 'Panel', icono: 'panel', submodulos: [] };
const SIDEBAR_ITEMS = [PANEL_ITEM, ...navegacion.sort((a, b) => a.orden - b.orden)];

// ── Estado de navegación ─────────────────────────────────────────────────────
let modActivo    = 'panel';
let submodActivo = null;
let badges       = {};
let usuarioActivo = null;

// ── Tema ─────────────────────────────────────────────────────────────────────
function aplicarTema() {
  const r = document.documentElement;
  const c = tema.colores;
  r.style.setProperty('--color-primario',       c.primario);
  r.style.setProperty('--color-primario-hover',  c.primarioHover);
  r.style.setProperty('--color-primario-texto',  c.primarioTexto);
  r.style.setProperty('--color-acento',          c.acento);
  r.style.setProperty('--color-fondo',           c.fondo);
  r.style.setProperty('--color-fondo-tarjeta',   c.fondoTarjeta);
  r.style.setProperty('--color-borde',           c.borde);
  r.style.setProperty('--color-texto',           c.texto);
  r.style.setProperty('--color-texto-sec',       c.textoSecundario);
  r.style.setProperty('--color-error',           c.error);
  r.style.setProperty('--color-exito',           c.exito);
  r.style.setProperty('--fuente-base',           tema.tipografia.familia);
}

// ── Badges: pendientes por módulo ────────────────────────────────────────────
async function actualizarBadges() {
  const HDR_SB = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
  const fechaLimite = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [rPost, rContr, rLic, rInstBadge] = await Promise.allSettled([
    fetch(`${SUPABASE_URL}/rest/v1/solicitudes_personal?estado=eq.pendiente&select=id`, { headers: HDR_SB }),
    fetch(`${SUPABASE_URL}/rest/v1/contratos_vencimiento?fecha_vencimiento=lte.${fechaLimite}&select=id`, { headers: HDR_SB }),
    fetch(`${SUPABASE_URL}/rest/v1/licencias_vencimiento?fecha_vencimiento=lte.${fechaLimite}&select=id`, { headers: HDR_SB }),
    fetch(`${SUPABASE_URL}/rest/v1/vencimientos_institucionales?select=fecha_vencimiento,preaviso_meses`, { headers: HDR_SB }),
  ]);

  async function count(settled) {
    if (settled.status !== 'fulfilled' || !settled.value.ok) return 0;
    return (await settled.value.json()).length;
  }

  const [nPost, nContr, nLic] = await Promise.all([count(rPost), count(rContr), count(rLic)]);

  let nInst = 0;
  if (rInstBadge.status === 'fulfilled' && rInstBadge.value.ok) {
    const instItems = await rInstBadge.value.json();
    const hoyB = new Date(); hoyB.setHours(0, 0, 0, 0);
    nInst = instItems.filter(r => {
      const d = Math.round((new Date(r.fecha_vencimiento+'T00:00:00') - hoyB) / 86400000);
      return d <= r.preaviso_meses * 30;
    }).length;
  }

  badges = { ...badges, postulantes: nPost, vencimientos: nContr + nLic + nInst };
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

// ── Renderizar contenido según módulo y sub-módulo activos ────────────────────
async function renderizarContenido() {
  const contenedor = document.getElementById('contenido-principal');
  if (!contenedor) return;

  // Animación de entrada
  contenedor.innerHTML = '';
  contenedor.classList.remove('contenido-entrando');
  contenedor.offsetHeight; // fuerza reflow
  contenedor.classList.add('contenido-entrando');

  if (modActivo === 'panel') {
    await renderizarPanel(contenedor, cambiarModulo);
    return;
  }

  const mod   = navegacion.find(n => n.id === modActivo);
  const submod = mod?.submodulos?.find(s => s.id === submodActivo);
  if (!submod) return;

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
  } else if (submod.tipo === 'post-solicitudes') {
    await renderizarPostulantesSolicitudes(contenedor, async () => {
      await actualizarBadges();
      refrescarNav();
    });
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
  } else if (submod.tipo === 'venc-contratos') {
    await renderizarVencimientosContratos(contenedor);
  } else if (submod.tipo === 'venc-licencias') {
    await renderizarVencimientosLicencias(contenedor);
  } else if (submod.tipo === 'venc-institucional') {
    await renderizarVencimientosInstitucional(contenedor);
  } else if (submod.tipo === 'cumpleanos-antiguedad') {
    await renderizarCumpleanosAntiguedad(contenedor);
  } else if (submod.tipo === 'pres-resumen') {
    await renderizarPresentismoResumen(contenedor, () => cambiarSubmodulo('cargar'));
  } else if (submod.tipo === 'pres-personas') {
    await renderizarPresentismoPersonas(contenedor);
  } else if (submod.tipo === 'pres-carga') {
    await renderizarPresentismoCarga(contenedor, () => cambiarSubmodulo('resumen'));
  } else if (submod.tipo === 'pres-indicadores') {
    await renderizarPresentismoIndicadores(contenedor);
  } else {
    mostrarPlaceholder(submod.mensaje, contenedor);
  }
}

// ── Cambiar módulo (nivel 1 — sidebar) ───────────────────────────────────────
async function cambiarModulo(id) {
  modActivo = id;
  const mod = SIDEBAR_ITEMS.find(item => item.id === id);
  submodActivo = mod.submodulos?.[0]?.id ?? null;

  renderizarNavLateral(SIDEBAR_ITEMS, modActivo, cambiarModulo, badges);
  renderizarHeader(mod, submodActivo, cambiarSubmodulo, { usuario: usuarioActivo, alCerrarSesion });
  await renderizarContenido();
}

// ── Cambiar sub-módulo (nivel 2 — tabs) ──────────────────────────────────────
async function cambiarSubmodulo(id) {
  submodActivo = id;
  const mod = SIDEBAR_ITEMS.find(item => item.id === modActivo);

  renderizarHeader(mod, submodActivo, cambiarSubmodulo, { usuario: usuarioActivo, alCerrarSesion });
  await renderizarContenido();
}

// ── Cerrar sesión ─────────────────────────────────────────────────────────────
async function alCerrarSesion() {
  cerrarSesion();
  location.reload();
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

// ── Punto de entrada ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  aplicarTema();
  inicializarHamburger();

  // Verificar sesión activa; si no hay, mostrar pantalla de login
  usuarioActivo = obtenerUsuario();
  if (!usuarioActivo) {
    usuarioActivo = await mostrarLogin();
  }

  await cambiarModulo('panel');
  // Cargar badges de pendientes en segundo plano
  actualizarBadges().then(refrescarNav);
});
