// Campo de seguridad de las evaluaciones de desempeño (anual F-84 y período de prueba F-101),
// compartido por el formulario de RRHH y el portal de evaluadores.
//
// Con evaluaciones de Seguridad e Higiene en el período (data/seguridad-hys.js), el valor sale
// del promedio de esas evaluaciones y se muestra de solo lectura. El número viaja en un
// <input type="hidden"> con el mismo id / data-aspecto que tenía el <select> manual: así el
// código de cada formulario que lee `.value` (cálculo de puntaje, guardado, PDF) no cambia.
// Sin evaluaciones de HyS, se muestra el <select> manual de siempre con un aviso.

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function fmtMes(clave) { const [a, m] = clave.split('-'); return `${MESES[+m - 1]} ${a}`; }

// El promedio exacto puede caer entre dos niveles (ej. 65): se nombra por el más cercano.
export function nivelMasCercano(valor, niveles) {
  return niveles.reduce((mejor, n) => Math.abs(n.valor - valor) < Math.abs(mejor.valor - valor) ? n : mejor);
}

// `seg`: resultado de obtenerSeguridadHyS() o null. `atributos`: los que identifican al campo
// para el formulario (ej. 'id="desem-epp"' o 'data-aspecto="seguridad"'). `selectHtml`: el
// <select> manual, para cuando no hay datos de HyS. `claseCampo` / `claseSub`: clases del
// formulario que lo aloja (RRHH y el portal de evaluadores tienen estilos distintos).
export function campoSeguridadHyS({ seg, label, atributos, niveles, selectHtml, claseCampo, claseSub }) {
  if (!seg) {
    return `
      <label class="${claseCampo}">
        <span>${label}</span>
        ${selectHtml}
        <span class="${claseSub}">Sin evaluaciones de Seguridad e Higiene en el período · completalo a mano</span>
      </label>`;
  }
  const nombre = nivelMasCercano(seg.nivel, niveles).label;
  const rango = seg.primerMes === seg.ultimoMes ? fmtMes(seg.primerMes) : `${fmtMes(seg.primerMes)} – ${fmtMes(seg.ultimoMes)}`;
  const promedio = seg.promedio.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
  return `
    <div class="${claseCampo} seg-hys">
      <span>${label}</span>
      <div class="seg-hys__valor">
        <strong>${nombre}</strong>
        <span class="seg-hys__num">${seg.nivel}/100</span>
        <span class="seg-hys__tag">Automático · HyS</span>
      </div>
      <span class="${claseSub}">Promedio de ${seg.cantidad} evaluaci${seg.cantidad !== 1 ? 'ones' : 'ón'} mensual${seg.cantidad !== 1 ? 'es' : ''} de Seguridad e Higiene (${rango}): ${promedio} de 5</span>
      <input type="hidden" ${atributos} value="${seg.nivel}">
    </div>`;
}
