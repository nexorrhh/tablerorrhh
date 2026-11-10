// Motor de cobertura operativa del módulo Vacaciones: funciones PURAS (sin red ni pantalla),
// probadas en tests/casos-vacaciones.js.
//
// Para cada sector y cada día hábil:
//   dotación     = activos asignados al sector
//   ausentes     = personas del sector con un período activo ese día
//   disponibles  = dotación − ausentes
//   requeridos   = demanda de esa semana (o el mínimo por defecto del sector); null = sin definir
//   reemplazos   = personas de OTROS sectores que pueden cubrir (nivel máximo en Polivalencia),
//                  que no están ausentes y cuyo propio sector tiene excedente. Cada persona se
//                  cuenta UNA sola vez por día (si cubre un sector, deja de sumar en el suyo).
// Sin requeridos definidos se informa la dotación, pero no se juzga la cobertura: no se puede
// afirmar que la producción esté garantizada sin saber cuánta gente hace falta.

import { rangoDias, esHabil, lunesDe } from './vacaciones-reglas.js';

export const clavePersona = (empresa, legajo) => `${empresa}|${legajo}`;

// Personas ausentes por día: Map(iso → Set(clave)).
export function ausentesPorDia(periodos, dias) {
  const enRango = new Set(dias);
  const out = new Map(dias.map(d => [d, new Set()]));
  periodos.forEach(p => {
    const desde = p.desde < dias[0] ? dias[0] : p.desde;
    const hasta = p.hasta > dias[dias.length - 1] ? dias[dias.length - 1] : p.hasta;
    if (hasta < desde) return;
    rangoDias(desde, hasta).forEach(d => { if (enRango.has(d)) out.get(d).add(clavePersona(p.empresa, p.legajo)); });
  });
  return out;
}

//   personas:     [{ clave, sectorId }]
//   periodos:     períodos activos a considerar (oficial o escenario)
//   requeridosDe: (sectorId, lunesISO) → número | null
//   competencias: Map(clave → Set(sectorId que puede cubrir))
// Devuelve Map(sectorId → Map(iso → celda)), solo días hábiles.
export function calcularCoberturaDiaria({ dias, feriados, sectores, personas, periodos, requeridosDe, competencias = new Map() }) {
  const habiles = dias.filter(d => esHabil(d, feriados));
  const ausentes = ausentesPorDia(periodos, dias.length ? dias : habiles);
  const porSector = new Map(sectores.map(s => [s.id, personas.filter(p => p.sectorId === s.id).map(p => p.clave)]));
  const sectorDe = new Map(personas.map(p => [p.clave, p.sectorId]));
  const out = new Map(sectores.map(s => [s.id, new Map()]));

  habiles.forEach(dia => {
    const aus = ausentes.get(dia) || new Set();
    const lunes = lunesDe(dia);
    const celdas = new Map();
    sectores.forEach(s => {
      const dot = porSector.get(s.id) || [];
      const ausS = dot.filter(c => aus.has(c));
      const req = requeridosDe(s.id, lunes);
      celdas.set(s.id, {
        dia, sectorId: s.id, dotacion: dot.length, ausentes: ausS,
        disponibles: dot.length - ausS.length, requeridos: req, reemplazos: [],
      });
    });

    // Excedente de cada sector (solo si tiene requeridos definidos: si no, no se sabe si sobra).
    const excedente = new Map([...celdas.values()].map(c => [c.sectorId, c.requeridos == null ? 0 : Math.max(0, c.disponibles - c.requeridos)]));
    const usados = new Set();
    // Se cubren primero los sectores con mayor déficit.
    const conDeficit = [...celdas.values()]
      .filter(c => c.requeridos != null && c.disponibles < c.requeridos)
      .sort((a, b) => (a.disponibles - a.requeridos) - (b.disponibles - b.requeridos));
    conDeficit.forEach(c => {
      let falta = c.requeridos - c.disponibles;
      for (const [clave, puede] of competencias) {
        if (falta <= 0) break;
        const origen = sectorDe.get(clave);
        if (origen == null || origen === c.sectorId || !puede.has(c.sectorId)) continue;
        if (usados.has(clave) || aus.has(clave) || (excedente.get(origen) || 0) <= 0) continue;
        usados.add(clave);
        excedente.set(origen, excedente.get(origen) - 1);
        celdas.get(origen).disponibles -= 1;           // deja de contar en su sector
        celdas.get(origen).prestados = (celdas.get(origen).prestados || 0) + 1;
        c.reemplazos.push({ clave, desdeSectorId: origen });
        falta--;
      }
    });

    celdas.forEach(c => {
      c.disponiblesConReemplazo = c.disponibles + c.reemplazos.length;
      c.cobertura = c.requeridos ? Math.round((c.disponiblesConReemplazo / c.requeridos) * 100) : null;
      out.get(c.sectorId).set(dia, c);
    });
  });
  return out;
}

// Resumen por semana: el PEOR día hábil de la semana (lo que importa para planificar es el
// día más corto, no el promedio). Devuelve Map(sectorId → Map(lunes → celda del peor día)).
export function resumenSemanal(porDia) {
  const out = new Map();
  porDia.forEach((dias, sectorId) => {
    const semanas = new Map();
    dias.forEach(c => {
      const lunes = lunesDe(c.dia);
      const prev = semanas.get(lunes);
      const peor = !prev ? true
        : c.cobertura != null && prev.cobertura != null ? c.cobertura < prev.cobertura
        : c.disponiblesConReemplazo < prev.disponiblesConReemplazo;
      if (peor) semanas.set(lunes, c);
    });
    out.set(sectorId, semanas);
  });
  return out;
}

// Nivel de color según los umbrales operativos del sector.
export function nivelCobertura(cobertura, sector) {
  if (cobertura == null) return 'sin-dato';
  if (cobertura >= sector.pct_verde) return 'verde';
  if (cobertura >= sector.pct_amarillo) return 'amarillo';
  return 'rojo';
}

// Métricas para comparar escenarios.
export function metricasEscenario(porDia, sectores) {
  const sem = resumenSemanal(porDia);
  let rojas = 0, amarillas = 0, diasDeficit = 0, faltanPersonasDia = 0, reemplazos = 0;
  const minimaPorSector = new Map();
  sectores.forEach(s => {
    (sem.get(s.id) || new Map()).forEach(c => {
      const n = nivelCobertura(c.cobertura, s);
      if (n === 'rojo') rojas++; else if (n === 'amarillo') amarillas++;
    });
    (porDia.get(s.id) || new Map()).forEach(c => {
      reemplazos += c.reemplazos.length;
      if (c.requeridos != null && c.disponiblesConReemplazo < c.requeridos) {
        diasDeficit++;
        faltanPersonasDia += c.requeridos - c.disponiblesConReemplazo;
      }
      if (c.cobertura != null) minimaPorSector.set(s.id, Math.min(minimaPorSector.get(s.id) ?? Infinity, c.cobertura));
    });
  });
  return { semanasRojas: rojas, semanasAmarillas: amarillas, diasDeficit, faltanPersonasDia, reemplazos, minimaPorSector };
}
