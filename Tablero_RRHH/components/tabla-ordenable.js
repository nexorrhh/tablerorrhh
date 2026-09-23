// Pieza de UI reutilizable: estado + wiring de "click en el header de una columna para
// ordenar" (clic = ascendente, clic de nuevo en la misma columna = descendente).
// No sabe nada del dominio de cada pantalla — recibe una clave de columna por header y una
// función de comparación de dos valores cualquiera. Cada componente que la usa sigue siendo
// dueño de su propio render(); esto solo decide clave+dirección y ordena el array antes de
// que el componente lo pinte.
//
// Uso típico dentro de un renderizarX(contenedor):
//
//   const orden = crearOrdenTabla('apellido');
//   function render() {
//     const filas = [...datos].sort(orden.comparador((fila, clave) => fila[clave]));
//     contenedor.innerHTML = `<table><thead><tr>
//       ${orden.thHtml('legajo', 'Legajo')}
//       ${orden.thHtml('apellido', 'Apellido')}
//     </tr></thead><tbody>...</tbody></table>`;
//     orden.wire(contenedor, render);
//   }

export function crearOrdenTabla(claveInicial = null, direccionInicial = 'asc') {
  let clave = claveInicial;
  let direccion = direccionInicial;

  function alClickear(nuevaClave, rerender) {
    if (clave === nuevaClave) {
      direccion = direccion === 'asc' ? 'desc' : 'asc';
    } else {
      clave = nuevaClave;
      direccion = 'asc';
    }
    rerender();
  }

  // obtenerValor(fila, clave) -> valor a comparar. Números se comparan como números; todo lo
  // demás como texto (con orden "natural" para que "2" venga antes que "10", no después).
  function comparador(obtenerValor) {
    return (a, b) => {
      if (!clave) return 0;
      const va = obtenerValor(a, clave);
      const vb = obtenerValor(b, clave);
      let cmp;
      if (typeof va === 'number' && typeof vb === 'number') {
        cmp = va - vb;
      } else if (va == null && vb == null) {
        cmp = 0;
      } else if (va == null) {
        cmp = -1;
      } else if (vb == null) {
        cmp = 1;
      } else {
        cmp = String(va).localeCompare(String(vb), 'es', { numeric: true, sensitivity: 'base' });
      }
      return direccion === 'asc' ? cmp : -cmp;
    };
  }

  // opts puede ser un string (se toma como `attrs`, ej. title="...") o un objeto
  // { clase, attrs } — `clase` se suma a la clase "tord__th" en el mismo atributo class=
  // (un <th> con dos atributos class="" sería inválido, el navegador ignora el segundo).
  function thHtml(claveCol, texto, opts = '') {
    const { clase = '', attrs = '' } = typeof opts === 'string' ? { attrs: opts } : opts;
    const activa = clave === claveCol;
    const icono = activa ? (direccion === 'asc' ? ' ▲' : ' ▼') : '';
    const claseFinal = `tord__th${activa ? ' tord__th--activo' : ''}${clase ? ' ' + clase : ''}`;
    return `<th class="${claseFinal}" data-sort-col="${claveCol}" ${attrs}>${texto}<span class="tord__icono">${icono}</span></th>`;
  }

  // Delegado sobre `contenedor` (no sobre cada <th> directamente) para que sobreviva a que
  // rerender() reemplace el <thead> por completo — no hace falta re-wirear a mano.
  let wireado = null;
  function wire(contenedor, rerender) {
    if (wireado) contenedor.removeEventListener('click', wireado);
    wireado = ev => {
      const th = ev.target.closest('[data-sort-col]');
      if (!th || !contenedor.contains(th)) return;
      alClickear(th.dataset.sortCol, rerender);
    };
    contenedor.addEventListener('click', wireado);
  }

  return {
    thHtml,
    comparador,
    wire,
    get clave() { return clave; },
    get direccion() { return direccion; },
  };
}
