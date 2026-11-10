// Reglas de vacaciones: funciones PURAS (sin red ni pantalla), probadas en
// tests/casos-vacaciones.js. Fechas siempre como texto 'YYYY-MM-DD' y aritmética en UTC,
// para que el huso horario nunca corra un día.

const MS_DIA = 86400000;

export function aFecha(iso) { return new Date(iso + 'T00:00:00Z'); }
export function aISO(fecha) { return fecha.toISOString().slice(0, 10); }
export function sumarDias(iso, n) { return aISO(new Date(aFecha(iso).getTime() + n * MS_DIA)); }
export function difDias(desde, hasta) { return Math.round((aFecha(hasta) - aFecha(desde)) / MS_DIA); }
export function diaSemana(iso) { return aFecha(iso).getUTCDay(); } // 0 = domingo
export function lunesDe(iso) { const d = diaSemana(iso); return sumarDias(iso, d === 0 ? -6 : 1 - d); }

// Vacaciones = días CORRIDOS (incluye fines de semana y feriados).
export function diasCorridos(desde, hasta) { return difDias(desde, hasta) + 1; }

export function esHabil(iso, feriados) {
  const d = diaSemana(iso);
  return d >= 1 && d <= 5 && !feriados.has(iso);
}

// Primer día hábil después del último día de vacaciones.
export function reincorporacion(hasta, feriados) {
  let d = sumarDias(hasta, 1);
  for (let i = 0; i < 15 && !esHabil(d, feriados); i++) d = sumarDias(d, 1);
  return d;
}

export function rangoDias(desde, hasta) {
  const out = [];
  for (let d = desde; d <= hasta; d = sumarDias(d, 1)) out.push(d);
  return out;
}

// Año vacacional al que pertenece una fecha de inicio: de octubre en adelante es el año
// en curso; de enero a septiembre, el anterior (temporada oct–abr del año previo).
export function anioVacacionalDe(iso) {
  const [y, m] = iso.split('-').map(Number);
  return m >= 10 ? y : y - 1;
}

// Rango de fechas del año vacacional N: del 1/10/N al 30/9/N+1.
export function rangoAnioVacacional(anio) {
  return [`${anio}-10-01`, `${anio + 1}-09-30`];
}

// Para mostrar en selectores: "2026/27".
export function textoAnioVacacional(anio) {
  return `${anio}/${String(anio + 1).slice(2)}`;
}

// Normaliza un puesto de Tango para mapearlo a un sector (igual criterio que el SQL).
export function normalizarPuesto(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ').trim();
}

// Antigüedad en años completos al 31/12 del año vacacional.
export function antiguedadAnios(fechaIngreso, anio) {
  if (!fechaIngreso) return null;
  // Al 31/12 cualquier fecha del año de ingreso ya cumplió aniversario: alcanza con restar años.
  const y = Number(fechaIngreso.slice(0, 4));
  return Math.max(0, anio - y);
}

function diasHabilesEntre(desde, hasta, feriados) {
  if (hasta < desde) return 0;
  return rangoDias(desde, hasta).filter(d => esHabil(d, feriados)).length;
}

// Días que corresponden según LCT (art. 150 y 151). Devuelve también cómo se calculó, para
// mostrarlo: es un valor CALCULADO, no reemplaza al que informa RRHH.
export function diasCorresponden(fechaIngreso, anio, reglas, feriados = new Set()) {
  if (!fechaIngreso) return { dias: null, detalle: 'Sin fecha de ingreso' };
  const ingreso = fechaIngreso.slice(0, 10);
  const finAnio = `${anio}-12-31`;
  if (ingreso > finAnio) return { dias: 0, detalle: 'Ingresó después de fin de año' };
  const ant = antiguedadAnios(ingreso, anio);
  // LCT art. 150: "no exceda de 5 años" → 5 justos todavía es el primer tramo (inclusive).
  const tramo = reglas.escalaAntiguedad.find(t => t.hastaAnios == null || ant <= t.hastaAnios)
             ?? reglas.escalaAntiguedad[reglas.escalaAntiguedad.length - 1];

  // Si ingresó durante el año: ¿trabajó al menos la mitad de los días hábiles?
  if (ingreso > `${anio}-01-01`) {
    const habilesAnio = diasHabilesEntre(`${anio}-01-01`, finAnio, feriados);
    const trabajados = diasHabilesEntre(ingreso, finAnio, feriados);
    if (trabajados < habilesAnio / 2) {
      const prop = Math.floor(trabajados / reglas.diasTrabajadosPorDiaProporcional);
      return { dias: prop, detalle: `Proporcional: ${trabajados} días hábiles trabajados / ${reglas.diasTrabajadosPorDiaProporcional}`, antiguedad: ant };
    }
  }
  return { dias: tramo.dias, detalle: `${ant} año${ant === 1 ? '' : 's'} de antigüedad al 31/12`, antiguedad: ant };
}

function enRangoMesDia(iso, desdeMD, hastaMD) {
  const md = iso.slice(5);
  return desdeMD <= hastaMD ? (md >= desdeMD && md <= hastaMD) : (md >= desdeMD || md <= hastaMD);
}

function seSuperponen(a, b) { return a.desde <= b.hasta && b.desde <= a.hasta; }

// Valida un período. Devuelve [{ codigo, nivel, mensaje }]. `nivel` sale de la config:
// 'bloqueante' no deja guardar; 'advertencia' deja guardar si alguien la acepta.
//   periodo:     { desde, hasta, estado, notificado_en }
//   otros:       otros períodos ACTIVOS de la misma persona en el mismo plan (sin este)
//   saldo:       { corresponde, comprometidoOtros } o null si no hay saldo cargado
//   historial:   períodos activos de la persona de años anteriores (para la regla de verano)
export function validarPeriodo({ periodo, otros = [], saldo = null, historial = [], reglas, niveles, feriados = new Set(), hoy }) {
  const alertas = [];
  const add = (codigo, mensaje) => alertas.push({ codigo, nivel: niveles[codigo] || 'advertencia', mensaje });
  const { desde, hasta } = periodo;

  if (!desde || !hasta || !/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
    add('fechas', 'Completá las fechas de inicio y fin.');
    return alertas;
  }
  if (hasta < desde) { add('fechas', 'La fecha de fin es anterior a la de inicio.'); return alertas; }

  const dias = diasCorridos(desde, hasta);
  const choque = otros.find(o => seSuperponen(o, periodo));
  if (choque) add('superposicion', `Se superpone con otro período de la misma persona (${choque.desde} a ${choque.hasta}).`);

  if (saldo && saldo.corresponde != null) {
    const disponible = saldo.corresponde - saldo.comprometidoOtros;
    if (dias > disponible) add('saldo', `Pide ${dias} días y le quedan ${disponible} (corresponden ${saldo.corresponde}).`);
  } else {
    add('sinSaldo', 'No hay saldo cargado ni calculable para esta persona: no se puede controlar si le alcanzan los días.');
  }

  if (reglas.inicioEnLunes) {
    // Debe empezar el lunes, o el primer día hábil de esa semana si el lunes es feriado.
    const lunes = lunesDe(desde);
    let primerHabil = lunes;
    for (let i = 0; i < 5 && !esHabil(primerHabil, feriados); i++) primerHabil = sumarDias(primerHabil, 1);
    if (desde !== primerHabil) add('lunes', 'No comienza un lunes (ni el primer día hábil de la semana, si el lunes es feriado).');
  }

  if (!enRangoMesDia(desde, reglas.otorgamientoDesde, reglas.otorgamientoHasta)) {
    add('otorgamiento', `Comienza fuera del período de otorgamiento (${reglas.otorgamientoDesde.split('-').reverse().join('/')} al ${reglas.otorgamientoHasta.split('-').reverse().join('/')}).`);
  }

  const notificado = periodo.estado === 'notificado' || periodo.estado === 'gozado' || periodo.notificado_en;
  if (!notificado && hoy && difDias(hoy, desde) < reglas.avisoPrevioDias && desde >= hoy) {
    add('aviso', `Faltan ${difDias(hoy, desde)} días para el inicio y el aviso previo es de ${reglas.avisoPrevioDias}.`);
  }

  if (dias < reglas.fraccionMinimaDias) add('fraccion', `Tramo de ${dias} días: menor al mínimo de ${reglas.fraccionMinimaDias} para fraccionar.`);

  // Verano: si en los últimos N-1 años no tuvo vacaciones de verano y esta tampoco lo es.
  if (reglas.veranoCadaAnios > 1 && historial.length) {
    const esVerano = p => rangoDias(p.desde, p.hasta).some(d => enRangoMesDia(d, reglas.veranoDesde, reglas.veranoHasta));
    const anioActual = anioVacacionalDe(desde);
    const anios = new Set(historial.map(h => anioVacacionalDe(h.desde)));
    const cubiertos = [...Array(reglas.veranoCadaAnios - 1)].map((_, i) => anioActual - 1 - i);
    const hayHistorialCompleto = cubiertos.every(a => anios.has(a));
    const tuvoVerano = historial.some(h => cubiertos.includes(anioVacacionalDe(h.desde)) && esVerano(h));
    if (hayHistorialCompleto && !tuvoVerano && !esVerano(periodo)) {
      add('verano', `No tuvo vacaciones de verano en los últimos ${reglas.veranoCadaAnios - 1} años y esta tampoco es de verano.`);
    }
  }
  return alertas;
}

export function hayBloqueantes(alertas) { return alertas.some(a => a.nivel === 'bloqueante'); }
