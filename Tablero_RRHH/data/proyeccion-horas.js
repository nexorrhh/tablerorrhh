// Proyección de horas (cálculos puros, sin red ni DOM).
// Port de panel-produccion → modules/planificacion/lib (calendario, ausentismo, capacidad,
// real). Diferencias con el panel: la jornada proyectada sale de una regla fija
// (config/proyeccion-horas.js) y no del historial de Tango, y se descuentan las vacaciones
// planificadas (módulo Vacaciones).

// ── Calendario ('YYYY-MM-DD' / 'YYYY-MM') ────────────────────────────────────
// Se opera sobre fechas UTC armadas desde el texto: así no hay corrimientos de huso horario.
const aFecha = iso => new Date(iso + 'T00:00:00Z');
const isoDe = d => d.toISOString().slice(0, 10);
export const diaSemana = iso => aFecha(iso).getUTCDay(); // 0 = domingo
export const sumarDia = (iso, n = 1) => isoDe(new Date(aFecha(iso).getTime() + n * 86400000));

// Mes actual según el reloj LOCAL (en Argentina, después de las 21 h toISOString ya es mañana).
export function periodoActual(hoy = new Date()) {
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
}

export function sumarMeses(periodo, n) {
  const [a, m] = periodo.split('-').map(Number);
  const t = a * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

export const mesesDesde = (periodo, cantidad) => Array.from({ length: cantidad }, (_, i) => sumarMeses(periodo, i));

export function diasDelMes(periodo) {
  const [a, m] = periodo.split('-').map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return Array.from({ length: ultimo }, (_, i) => `${periodo}-${String(i + 1).padStart(2, '0')}`);
}

// Lunes a viernes que no son feriado: se planifica sobre la semana hábil (los sábados
// se manejan aparte como operativos, igual que en el panel).
export function esDiaHabil(iso, feriadosSet) {
  const d = diaSemana(iso);
  return d >= 1 && d <= 5 && !feriadosSet.has(iso);
}

export const diasHabilesDelMes = (periodo, feriadosSet) => diasDelMes(periodo).filter(f => esDiaHabil(f, feriadosSet));

export function feriadosHabilesDelMes(periodo, feriados) {
  return feriados.filter(f => f.fecha.slice(0, 7) === periodo && diaSemana(f.fecha) >= 1 && diaSemana(f.fecha) <= 5);
}

// ── Personas y puestos ───────────────────────────────────────────────────────
// El legajo viene como texto en unas tablas y como número en otras: se unifica a número.
export const clavePersona = (empresa, legajo) => `${empresa}|${Number(legajo)}`;
export const normPuesto = s => (s || '').trim().toUpperCase();
export const tipoPuesto = (descPuesto, mapaClasif) => mapaClasif.get(normPuesto(descPuesto)) || 'sin_asignar';

// ── Jornadas ─────────────────────────────────────────────────────────────────
const LETRAS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const DIAS_HABILES = [1, 2, 3, 4, 5];

// Jornada para proyectar: regla fija de config/proyeccion-horas.js (jornada general o la
// de la primera excepción cuyo texto aparece en el puesto), indistinta de lo que la persona
// tenga cargado en Tango. Devuelve también qué regla se aplicó, para mostrarlo.
export function resolverJornadaPorRegla(config) {
  const sinAcentos = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const excepciones = config.excepciones.map(x => ({ ...x, buscar: sinAcentos(x.contiene) }));
  return emp => {
    const puesto = sinAcentos(emp.desc_puesto);
    const ex = excepciones.find(x => puesto.includes(x.buscar));
    return ex ? { jornada: ex.jornada, regla: ex.nombre } : { jornada: config.jornadaGeneral, regla: 'General' };
  };
}

// "44 h/sem (L–J 9 h · V 8 h); Ingeniería 45 h/sem (L–V 9 h)" — para explicar la regla en pantalla.
export function textoReglaJornada(config) {
  const t = j => `${horasSemanales(j)} h/sem (${describirJornada(j)})`;
  return [t(config.jornadaGeneral), ...config.excepciones.map(x => `${x.nombre} ${t(x.jornada)}`)].join('; ');
}

export function horasSemanales(jornada) {
  return DIAS_HABILES.reduce((s, d) => s + (jornada[d] || 0), 0);
}

// [_,9,9,9,9,8,_] → "L–J 9 h · V 8 h"
export function describirJornada(jornada) {
  const tramos = [];
  DIAS_HABILES.forEach(d => {
    const v = jornada[d] || 0;
    const ultimo = tramos[tramos.length - 1];
    if (ultimo && ultimo.v === v && ultimo.hasta === d - 1) ultimo.hasta = d;
    else tramos.push({ desde: d, hasta: d, v });
  });
  return tramos.filter(t => t.v > 0)
    .map(t => `${LETRAS[t.desde]}${t.hasta !== t.desde ? '–' + LETRAS[t.hasta] : ''} ${t.v} h`).join(' · ');
}

// ── Ausentismo histórico ─────────────────────────────────────────────────────
// Misma fórmula que Indicadores: horas de ausencia / (normales + ausencia), por el puesto
// actual de cada persona. Un puesto sin historial usa el promedio general.
export function ausentismoPorPuesto(filasMensual, empleados) {
  const puestoPorClave = new Map(empleados.map(e => [clavePersona(e.empresa, e.legajo), e.desc_puesto]));
  const acc = new Map();
  let totAus = 0, totNorm = 0;
  filasMensual.forEach(f => {
    const puesto = puestoPorClave.get(clavePersona(f.empresa, f.legajo));
    if (!puesto) return;
    const aus = Number(f.hs_ausencias || 0), norm = Number(f.hs_normales || 0);
    totAus += aus; totNorm += norm;
    const a = acc.get(puesto) || { aus: 0, norm: 0 };
    a.aus += aus; a.norm += norm;
    acc.set(puesto, a);
  });
  const global = totAus + totNorm > 0 ? totAus / (totAus + totNorm) : 0;
  const porPuesto = new Map();
  acc.forEach((a, puesto) => porPuesto.set(puesto, a.aus + a.norm > 0 ? a.aus / (a.aus + a.norm) : global));
  return { porPuesto, global };
}

export const ausentismoDe = (ausentismo, puesto) => ausentismo.porPuesto.get(puesto) ?? ausentismo.global;

// ── Capacidad por puesto (patrón semanal) ───────────────────────────────────
// La capacidad de cualquier día hábil futuro sale de mirar qué día de la semana es: así
// los feriados se descuentan solos.
export function capacidadPorPuesto({ empleados, resolverJornada, ausentismo, aplicarAusentismo }) {
  const porPuesto = new Map();
  empleados.forEach(e => {
    const { jornada, regla } = resolverJornada(e);
    if (!porPuesto.has(e.desc_puesto)) porPuesto.set(e.desc_puesto, { puesto: e.desc_puesto, personas: [], porDiaTeorica: [0, 0, 0, 0, 0, 0, 0] });
    const g = porPuesto.get(e.desc_puesto);
    g.personas.push({ ...e, jornada, regla });
    jornada.forEach((h, d) => { g.porDiaTeorica[d] += h; });
  });
  porPuesto.forEach(g => {
    g.ausentismo = aplicarAusentismo ? ausentismoDe(ausentismo, g.puesto) : 0;
    g.porDiaDisponible = g.porDiaTeorica.map(h => h * (1 - g.ausentismo));
    g.personas.sort((a, b) => (a.apellido_y_nombre || '').localeCompare(b.apellido_y_nombre || ''));
  });
  return porPuesto;
}

export const horasEnDias = (porDia, dias) => dias.reduce((s, f) => s + porDia[diaSemana(f)], 0);
export const horasPorSemana = porDia => porDia[1] + porDia[2] + porDia[3] + porDia[4] + porDia[5];

// ── Real (meses cerrados y en curso) ─────────────────────────────────────────
export const SIN_PUESTO = 'Sin puesto en legajos';

// Horas reales por puesto y mes (rrhh_horas_mensual): esperadas = hs_esperadas,
// trabajadas = hs_normales (sin extras), agrupadas por el puesto de hoy de cada persona,
// incluidas las que ya no están activas.
export function realPorPuesto(filasMensual, todosEmpleados) {
  const puestoPorClave = new Map(todosEmpleados.map(e => [clavePersona(e.empresa, e.legajo), e.desc_puesto]));
  const porPuesto = new Map();
  filasMensual.forEach(f => {
    const puesto = puestoPorClave.get(clavePersona(f.empresa, f.legajo)) || SIN_PUESTO;
    const periodo = String(f.periodo).slice(0, 7);
    if (!porPuesto.has(puesto)) porPuesto.set(puesto, new Map());
    const meses = porPuesto.get(puesto);
    const m = meses.get(periodo) || { esperadas: 0, trabajadas: 0 };
    m.esperadas += Number(f.hs_esperadas || 0);
    m.trabajadas += Number(f.hs_normales || 0);
    meses.set(periodo, m);
  });
  return porPuesto;
}

// ── Vacaciones planificadas ──────────────────────────────────────────────────
// Fechas de vacaciones de cada persona según los períodos de un plan (oficial o escenario).
export function diasDeVacacionesPorPersona(periodos) {
  const porPersona = new Map();
  periodos.forEach(p => {
    const k = clavePersona(p.empresa, p.legajo);
    if (!porPersona.has(k)) porPersona.set(k, new Set());
    const set = porPersona.get(k);
    for (let d = p.desde; d <= p.hasta; d = sumarDia(d)) set.add(d);
  });
  return porPersona;
}

// Proyección de un conjunto de personas agrupadas (por puesto, sector…), mes a mes.
// Por persona y mes: teóricas = jornada × días hábiles; vacaciones = jornada de los días
// hábiles que caen en sus vacaciones; disponibles = (teóricas − vacaciones) × (1 − ausentismo).
// El ausentismo se aplica sobre lo que queda: quien está de vacaciones no puede faltar.
//   personas: [{ empresa, legajo, desc_puesto, grupo }]
//   columnas: [{ periodo, dias }]  (dias = días hábiles a proyectar de ese mes)
export function proyeccionPorGrupo({ personas, resolverJornada, ausentismo, aplicarAusentismo, diasVac = new Map(), columnas }) {
  const vacio = () => ({ teoricas: 0, vacaciones: 0, disponibles: 0, deVacaciones: 0 });
  const grupos = new Map();
  const totales = columnas.map(vacio);
  personas.forEach(p => {
    const { jornada } = resolverJornada(p);
    const aus = aplicarAusentismo ? ausentismoDe(ausentismo, p.desc_puesto) : 0;
    const vac = diasVac.get(clavePersona(p.empresa, p.legajo));
    if (!grupos.has(p.grupo)) grupos.set(p.grupo, { grupo: p.grupo, personas: 0, porMes: columnas.map(vacio) });
    const g = grupos.get(p.grupo);
    g.personas++;
    columnas.forEach((c, i) => {
      let teo = 0, hsVac = 0;
      c.dias.forEach(f => {
        const h = jornada[diaSemana(f)] || 0;
        teo += h;
        if (vac?.has(f)) hsVac += h;
      });
      const disp = (teo - hsVac) * (1 - aus);
      [g.porMes[i], totales[i]].forEach(m => {
        m.teoricas += teo; m.vacaciones += hsVac; m.disponibles += disp;
        if (hsVac > 0) m.deVacaciones++;
      });
    });
  });
  return { grupos, totales };
}
