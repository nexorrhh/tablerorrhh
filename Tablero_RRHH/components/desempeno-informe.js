// Desempeño → Informe individual (PDF).
// Genera el documento que se le entrega a la persona para dar la devolución de su evaluación
// (anual F-84 o período de prueba F-101) — un texto real armado con jsPDF/autoTable (ya cargados
// en el proyecto para otros exports), no una captura de pantalla, para que quede prolijo y
// legible al imprimirlo.

import {
  calcularMensual, calcularQuincenal, labelNivel,
  EMP_LABEL, TIPO_LABEL, RESULTADO_LABEL, RESULTADO_COLOR,
} from './desempeno-cargar.js';
import { NIVELES, ASPECTOS } from './desempeno-prueba.js';
import { CONFIG_DEFAULT } from '../data/desempeno-config.js';

function fmtFecha(iso) {
  if (!iso) return '—';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

function labelNivelPrueba(valor) {
  if (valor === null || valor === undefined || valor === '') return '—';
  const n = NIVELES.find(x => x.valor === +valor);
  return n ? n.label : '—';
}

function celdaPuntos(nivel, puntos, max) {
  return nivel === null || nivel === undefined ? '—' : `${puntos.toFixed(1)} / ${max}`;
}

function librerianoDisponible() {
  if (!window.jspdf) {
    alert('La librería de PDF no está disponible. Verificá la conexión a internet.');
    return true;
  }
  return false;
}

function armarEncabezado(pdf, margen, titulo, subtitulo) {
  let y = margen;
  pdf.setFontSize(15);
  pdf.setTextColor(20);
  pdf.text(titulo, margen, y);
  y += 6;
  pdf.setFontSize(9);
  pdf.setTextColor(120);
  pdf.text(subtitulo, margen, y);
  y += 5;
  pdf.text(`Generado el ${new Date().toLocaleString('es-AR')}`, margen, y);
  pdf.setTextColor(0);
  y += 8;
  return y;
}

function filaDatoPersona(pdf, margen, y, pares) {
  pdf.setFontSize(10);
  pares.forEach(([label, valor]) => {
    pdf.setFont(undefined, 'bold');
    pdf.text(`${label}:`, margen, y);
    pdf.setFont(undefined, 'normal');
    pdf.text(String(valor ?? '—'), margen + 45, y);
    y += 5.5;
  });
  return y + 2;
}

function armarResultado(pdf, margen, anchoUtil, y, puntaje, resultado, escalaMax) {
  pdf.setFontSize(12);
  pdf.setFont(undefined, 'bold');
  pdf.setTextColor(RESULTADO_COLOR[resultado] || '#000');
  pdf.text(`Resultado: ${puntaje.toFixed(1)}${escalaMax ? ` / ${escalaMax}` : '%'} — ${RESULTADO_LABEL[resultado] || resultado}`, margen, y);
  pdf.setFont(undefined, 'normal');
  pdf.setTextColor(0);
  return y + 8;
}

function armarAspectosTexto(pdf, margen, anchoUtil, y, pageH, destacable, mejorar) {
  pdf.setFontSize(10);
  [['Aspecto destacable', destacable], ['Aspecto a mejorar', mejorar]].forEach(([titulo, texto]) => {
    if (y > pageH - 25) { pdf.addPage(); y = margen; }
    pdf.setFont(undefined, 'bold');
    pdf.text(titulo, margen, y);
    y += 5;
    pdf.setFont(undefined, 'normal');
    const lineas = pdf.splitTextToSize(texto?.trim() || '—', anchoUtil);
    pdf.text(lineas, margen, y);
    y += lineas.length * 4.8 + 4;
  });
  return y;
}

function armarFirmas(pdf, margen, anchoUtil, y, pageH) {
  if (y > pageH - 30) { pdf.addPage(); y = margen; }
  y += 12;
  const mitad = anchoUtil / 2;
  pdf.setDrawColor(150);
  pdf.line(margen, y, margen + mitad - 10, y);
  pdf.line(margen + mitad + 10, y, margen + anchoUtil, y);
  y += 5;
  pdf.setFontSize(9);
  pdf.setTextColor(90);
  pdf.text('Firma evaluador/a', margen, y);
  pdf.text('Firma empleado/a (recibí devolución)', margen + mitad + 10, y);
  pdf.setTextColor(0);
}

// Dibuja el informe anual en una página del `pdf` recibido (no crea el documento ni lo guarda) —
// así se puede llamar una vez por persona sobre el mismo `pdf` para armar un solo archivo con
// varios informes (ver generarInformesAnualesPDF), o una sola vez para descargar el de una persona.
function dibujarInformeAnual(pdf, { persona, tipo, anio, datos, cfg = CONFIG_DEFAULT[tipo] }) {
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margen = 15;
  const anchoUtil = pageW - margen * 2;

  let y = armarEncabezado(pdf, margen, 'Evaluación de Desempeño Anual', `ISO 9001 — PG-6.01 / F-84 · Año ${anio}`);
  y = filaDatoPersona(pdf, margen, y, [
    ['Legajo', persona.legajo],
    ['Nombre', persona.apellido_y_nombre],
    ['Empresa', EMP_LABEL[persona.empresa] || persona.empresa],
    ['Sector', persona.desc_puesto || '—'],
    ['Tipo', TIPO_LABEL[tipo] || tipo],
    ['Evaluado por', datos.evaluado_por],
    ['Fecha de evaluación', fmtFecha(datos.fecha_evaluacion)],
  ]);

  // Ausentismo/tardanzas/EPP/reprocesos se recalculan para mostrar el desglose punto por punto —
  // son válidos incluso en evaluaciones viejas. Aptitudinal/operativa puede faltar en evaluaciones
  // guardadas antes de dividir "evaluación del superior" en dos aspectos: ahí no se recalcula (el
  // resultado final siempre se muestra tal como se guardó, ver `puntajeFinal` más abajo).
  const calc = tipo === 'mensual'
    ? calcularMensual({ ausentismo_dias: datos.ausentismo_dias, tardanzas_cant: datos.tardanzas_cant, evaluacion_aptitudinal: datos.evaluacion_aptitudinal || 0, evaluacion_operativa: datos.evaluacion_operativa || 0 }, cfg)
    : calcularQuincenal({ ausentismo_dias: datos.ausentismo_dias, tardanzas_cant: datos.tardanzas_cant, epp_nivel: datos.epp_nivel || 0, reprocesos_nivel: datos.reprocesos_nivel || 0, evaluacion_aptitudinal: datos.evaluacion_aptitudinal || 0, evaluacion_operativa: datos.evaluacion_operativa || 0 }, cfg);
  const { pAus, pTard, pEpp, pRepro, pEval } = calc.desglose;
  const hayEval = datos.evaluacion_aptitudinal != null && datos.evaluacion_operativa != null;

  const filas = [
    ['Ausentismo', `${datos.ausentismo_dias} día(s)`, `${pAus.toFixed(1)} / ${cfg.ausentismo_max}`],
    ['Llegadas tarde / salidas anticipadas', `${datos.tardanzas_cant}`, `${pTard.toFixed(1)} / ${cfg.tardanzas_max}`],
  ];
  if (tipo === 'quincenal' && cfg.epp_max) {
    filas.push(['Cumplimiento de uso de EPP', labelNivel(datos.epp_nivel), celdaPuntos(datos.epp_nivel, pEpp, cfg.epp_max)]);
  }
  if (tipo === 'quincenal' && cfg.reprocesos_max) {
    filas.push(['Calidad de trabajo (reprocesos)', labelNivel(datos.reprocesos_nivel), celdaPuntos(datos.reprocesos_nivel, pRepro, cfg.reprocesos_max)]);
  }
  // El promedio reparte el peso mitad y mitad entre los dos aspectos — se muestra el aporte de
  // cada uno (sobre la mitad del máximo) para que las dos filas de arriba sumen justo el total
  // de la fila de abajo, en vez de dejarlas sin puntaje.
  const mitadMax = cfg.evaluacion_max / 2;
  const pAptitudinal = datos.evaluacion_aptitudinal != null ? (datos.evaluacion_aptitudinal / 100) * mitadMax : null;
  const pOperativa = datos.evaluacion_operativa != null ? (datos.evaluacion_operativa / 100) * mitadMax : null;
  filas.push(
    ['Evaluación aptitudinal', labelNivel(datos.evaluacion_aptitudinal), celdaPuntos(datos.evaluacion_aptitudinal, pAptitudinal, mitadMax)],
    ['Evaluación operativa', labelNivel(datos.evaluacion_operativa), celdaPuntos(datos.evaluacion_operativa, pOperativa, mitadMax)],
    ['Evaluación del superior (promedio aptitudinal/operativa)', '', celdaPuntos(hayEval ? 1 : null, pEval, cfg.evaluacion_max)],
  );

  pdf.autoTable({
    startY: y,
    margin: { left: margen, right: margen },
    head: [['Aspecto', 'Valor', 'Puntaje']],
    body: filas,
    styles: { fontSize: 9 },
    headStyles: { fillColor: [26, 74, 122] },
  });
  y = pdf.lastAutoTable.finalY + 8;

  // Se muestra el puntaje/resultado tal como se guardó (si vino en `datos`), no el recalculado
  // acá — así el informe de una evaluación vieja nunca contradice lo que efectivamente se guardó.
  const puntajeFinal = datos.puntaje != null ? +datos.puntaje : calc.puntaje;
  const resultadoFinal = datos.resultado || calc.resultado;
  y = armarResultado(pdf, margen, anchoUtil, y, puntajeFinal, resultadoFinal, 100);
  y = armarAspectosTexto(pdf, margen, anchoUtil, y, pageH, datos.aspecto_destacable, datos.aspecto_mejorar);
  armarFirmas(pdf, margen, anchoUtil, y, pageH);
}

function nombreArchivo(base, persona) {
  return `${base}_${(persona.apellido_y_nombre || persona.legajo).replace(/[^\w]+/g, '_')}.pdf`;
}

// ── F-84: evaluación anual ───────────────────────────────────────────────────
// `cfg` es el puntaje YA resuelto para esta persona (por puesto si RRHH lo personalizó, si no
// por tipo) — ver resolverConfigPersona() en data/desempeno-config.js. Si no se pasa, se usa el
// default fijo del tipo, para no romper a quien todavía no pasa este parámetro.
export function generarInformeAnualPDF({ persona, tipo, anio, datos, cfg }) {
  if (librerianoDisponible()) return;
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF('p', 'mm', 'a4');
  dibujarInformeAnual(pdf, { persona, tipo, anio, datos, cfg });
  pdf.save(nombreArchivo(`Evaluacion_${anio}`, persona));
}

// Uno solo por año, con un informe por página en el orden recibido — evita que el navegador
// tenga que abrir una descarga por persona (los navegadores suelen bloquear varias seguidas).
// Cada `item` de `lista` trae su propio `cfg` ya resuelto (puede variar persona a persona si
// alguna tiene su puesto personalizado) — no se recibe una config global única acá.
export function generarInformesAnualesPDF(anio, lista) {
  if (!lista.length) return;
  if (librerianoDisponible()) return;
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF('p', 'mm', 'a4');
  lista.forEach((item, i) => {
    if (i > 0) pdf.addPage();
    dibujarInformeAnual(pdf, { ...item, anio });
  });
  pdf.save(`Informes_Desempeno_Anual_${anio}.pdf`);
}

// Igual que dibujarInformeAnual, pero para el F-101.
function dibujarInformePrueba(pdf, { persona, datos }) {
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margen = 15;
  const anchoUtil = pageW - margen * 2;

  let y = armarEncabezado(pdf, margen, 'Evaluación de Período de Prueba', 'ISO 9001 — PG-6.01 / F-101');
  y = filaDatoPersona(pdf, margen, y, [
    ['Legajo', persona.legajo],
    ['Nombre', persona.apellido_y_nombre],
    ['Empresa', EMP_LABEL[persona.empresa] || persona.empresa],
    ['Sector', persona.desc_puesto || '—'],
    ['Ingresó', fmtFecha(persona.fecha_ingreso)],
    ['Evaluado por', datos.evaluado_por],
    ['Fecha de evaluación', fmtFecha(datos.fecha_evaluacion)],
  ]);

  const filas = ASPECTOS.map(a => [a.label, labelNivelPrueba(datos[a.campo])]);
  filas.push(
    ['Presentismo (automático)', datos.presentismo_pct != null ? `${datos.presentismo_pct}%` : '—'],
    ['Puntualidad (automático)', datos.puntualidad_pct != null ? `${datos.puntualidad_pct}%` : '—'],
  );

  pdf.autoTable({
    startY: y,
    margin: { left: margen, right: margen },
    head: [['Aspecto', 'Nivel']],
    body: filas,
    styles: { fontSize: 9 },
    headStyles: { fillColor: [26, 74, 122] },
  });
  y = pdf.lastAutoTable.finalY + 8;

  y = armarResultado(pdf, margen, anchoUtil, y, datos.resultado_pct, datos.resultado, null);
  y = armarAspectosTexto(pdf, margen, anchoUtil, y, pageH, datos.aspecto_destacable, datos.aspecto_mejorar);
  armarFirmas(pdf, margen, anchoUtil, y, pageH);
}

export function generarInformePruebaPDF({ persona, datos }) {
  if (librerianoDisponible()) return;
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF('p', 'mm', 'a4');
  dibujarInformePrueba(pdf, { persona, datos });
  pdf.save(nombreArchivo('PeriodoPrueba', persona));
}

export function generarInformesPruebaPDF(lista) {
  if (!lista.length) return;
  if (librerianoDisponible()) return;
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF('p', 'mm', 'a4');
  lista.forEach((item, i) => {
    if (i > 0) pdf.addPage();
    dibujarInformePrueba(pdf, item);
  });
  pdf.save('Informes_Periodo_Prueba.pdf');
}
