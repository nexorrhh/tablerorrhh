// Modo claro/oscuro del tablero.
// El valor inicial ya lo define el script inline en index.html (antes de la
// primera pintura, según localStorage o la preferencia del sistema) — acá solo
// se lee/alterna después, y se vuelven a aplicar los colores de config/tema.js
// que correspondan al modo (ver "colores"/"coloresOscuro").
import { tema } from '../config/tema.js';

const CLAVE = 'rrhh_tema';

export function modoActual() {
  return document.documentElement.dataset.tema === 'oscuro' ? 'oscuro' : 'claro';
}

function aplicarColores(modo) {
  const r = document.documentElement;
  const c = modo === 'oscuro' ? tema.coloresOscuro : tema.colores;
  r.style.setProperty('--color-primario',       c.primario);
  r.style.setProperty('--color-primario-hover', c.primarioHover);
  r.style.setProperty('--color-primario-texto', c.primarioTexto);
  r.style.setProperty('--color-acento',         c.acento);
  r.style.setProperty('--color-rrhh',           c.rrhh);
  r.style.setProperty('--color-administracion', c.administracion);
  r.style.setProperty('--color-fondo',          c.fondo);
  r.style.setProperty('--color-fondo-tarjeta',  c.fondoTarjeta);
  r.style.setProperty('--color-borde',          c.borde);
  r.style.setProperty('--color-texto',          c.texto);
  r.style.setProperty('--color-texto-sec',      c.textoSecundario);
  r.style.setProperty('--color-error',          c.error);
  r.style.setProperty('--color-exito',          c.exito);

  actualizarGraficos(modo);
}

// Chart.js dibuja textos y grillas sobre canvas: las variables CSS no los actualizan.
// Al alternar el tema se cambia solamente su presentación, nunca las series de datos.
function actualizarGraficos(modo) {
  if (typeof Chart === 'undefined') return;

  const oscuro = modo === 'oscuro';
  const texto = oscuro ? '#cbd6e2' : '#606a73';
  const grilla = oscuro ? 'rgba(148,163,184,.16)' : 'rgba(96,106,115,.12)';

  Chart.defaults.color = texto;
  Chart.defaults.borderColor = grilla;

  Object.values(Chart.instances ?? {}).forEach(grafico => {
    const opciones = grafico.options ?? {};
    if (opciones.plugins?.legend?.labels) opciones.plugins.legend.labels.color = texto;
    if (opciones.plugins?.title) opciones.plugins.title.color = texto;

    Object.values(opciones.scales ?? {}).forEach(escala => {
      escala.ticks = { ...(escala.ticks ?? {}), color: texto };
      escala.grid = { ...(escala.grid ?? {}), color: grilla };
      escala.border = { ...(escala.border ?? {}), color: grilla };
      if (escala.title) escala.title.color = texto;
    });

    grafico.update('none');
  });
}

// Aplica los colores del modo activo y la tipografía — se llama una vez al iniciar.
export function inicializarTema() {
  aplicarColores(modoActual());
  document.documentElement.style.setProperty('--fuente-base', tema.tipografia.familia);
}

export function alternarModo() {
  const nuevo = modoActual() === 'oscuro' ? 'claro' : 'oscuro';
  document.documentElement.dataset.tema = nuevo;
  localStorage.setItem(CLAVE, nuevo);
  aplicarColores(nuevo);
  return nuevo;
}
