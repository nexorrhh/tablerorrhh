// Cruce de la planificación de vacaciones con lo que efectivamente registró Tango (días con
// código VACACION en rrhh_tardanzas_salidas). Reemplaza al estado manual "Gozado": el sistema
// confirma solo si las vacaciones se tomaron. Funciones PURAS, probadas en
// tests/casos-vacaciones.js.
import { rangoDias, esHabil } from './vacaciones-reglas.js';

// Resultado para un período:
//   futuro     → todavía no empezó
//   sin-datos  → los meses del período no están importados de Tango todavía
//   ok         → todos los días hábiles transcurridos figuran como VACACION en Tango
//   parcial    → algunos sí y otros no
//   no         → ninguno (el período pasó y Tango no registra vacaciones esos días)
// fechasTango: Set('YYYY-MM-DD') de esa persona. mesesCargados: Set('YYYY-MM') de su empresa.
export function cruceTango(periodo, fechasTango, feriados, hoy, mesesCargados) {
  if (periodo.desde > hoy) return { estado: 'futuro', habiles: 0, registrados: 0, faltan: [] };
  const hasta = periodo.hasta < hoy ? periodo.hasta : hoy;
  const habiles = rangoDias(periodo.desde, hasta).filter(d => esHabil(d, feriados));
  const conDatos = habiles.filter(d => mesesCargados.has(d.slice(0, 7)));
  if (!conDatos.length) return { estado: 'sin-datos', habiles: habiles.length, registrados: 0, faltan: [] };
  const registrados = conDatos.filter(d => fechasTango.has(d));
  const faltan = conDatos.filter(d => !fechasTango.has(d));
  const estado = !faltan.length ? 'ok' : registrados.length ? 'parcial' : 'no';
  return { estado, habiles: conDatos.length, registrados: registrados.length, faltan, sinDatos: habiles.length - conDatos.length };
}

export const TEXTO_CRUCE = {
  'futuro':    '',
  'sin-datos': 'Tango: ese mes todavía no está importado',
  'ok':        '✓ Confirmado por Tango',
  'parcial':   '⚠ Tango lo registra en parte',
  'no':        '✕ Tango no registra estas vacaciones',
};

// Días de vacaciones en Tango que no caen dentro de ningún período planificado (activo) de la
// persona: se tomaron vacaciones sin estar en la planificación. Devuelve tramos consecutivos.
export function vacacionesSinPlanificar(fechasTango, periodosPersona, desde, hasta, feriados = new Set()) {
  const cubiertas = new Set(periodosPersona.flatMap(p => rangoDias(p.desde, p.hasta)));
  const sueltas = [...fechasTango].filter(f => f >= desde && f <= hasta && !cubiertas.has(f)).sort();
  // Un tramo sigue mientras entre un día y el siguiente no haya ningún día hábil (o sea, solo
  // fin de semana o feriado en el medio): viernes + lunes es un mismo tramo; martes y viernes no.
  const tramos = [];
  sueltas.forEach(f => {
    const ult = tramos[tramos.length - 1];
    const entre = ult ? rangoDias(ult.hasta, f).slice(1, -1) : [];
    if (ult && entre.every(d => !esHabil(d, feriados))) { ult.hasta = f; ult.dias++; }
    else tramos.push({ desde: f, hasta: f, dias: 1 });
  });
  return tramos;
}
