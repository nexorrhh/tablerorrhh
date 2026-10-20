// Cierre animado común a todas las ventanas emergentes del tablero (la apertura es solo CSS:
// ver "Ventanas emergentes" en estilos/componentes.css). La ventana se pliega hasta una línea
// y recién después se ejecuta `alTerminar` — que es lo que cada pantalla ya hacía para cerrar
// (quitarla del DOM o ponerle hidden).

const CLASE_SALIENDO = 'modal-anim--saliendo';
// Algo más que la animación de cierre (≈ .5s): cubre el caso en que no llegue animationend,
// por ejemplo con prefers-reduced-motion o si la ventana se quita por otro lado.
const ESPERA_MAXIMA_MS = 600;

export function cerrarConAnimacion(overlay, alTerminar) {
  if (!overlay || !overlay.isConnected || overlay.hidden) { alTerminar(); return; }
  if (overlay.classList.contains(CLASE_SALIENDO)) return; // ya se está cerrando

  overlay.classList.add(CLASE_SALIENDO);
  let hecho = false;
  const terminar = () => {
    if (hecho) return;
    hecho = true;
    overlay.removeEventListener('animationend', alFinal);
    alTerminar();
    // Se saca después de cerrar: si la ventana se reusa (las que se ocultan con hidden), la
    // próxima apertura tiene que arrancar limpia.
    overlay.classList.remove(CLASE_SALIENDO);
  };
  // El animationend de los elementos internos también burbujea: solo cuenta el del fondo.
  const alFinal = ev => { if (ev.target === overlay) terminar(); };
  overlay.addEventListener('animationend', alFinal);
  setTimeout(terminar, ESPERA_MAXIMA_MS);
}
