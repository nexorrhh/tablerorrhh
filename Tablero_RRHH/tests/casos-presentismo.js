// Casos fijos para data/calculo-presentismo.js. Cada caso lanza un error si el cálculo
// no da lo esperado. Se corren desde el navegador (tests/index.html) o con Node:
//   node tests/correr.mjs
// Si cambiás una fórmula a propósito, actualizá el caso correspondiente y anotá por qué.
import {
  calcularGrupo, desgloseExt50, totalHorasTrabajadas, rangoQuincena,
  reconstruirFilasDesdeDetalle, resumenTardanzas, ausentismoPorCategoriaPeriodo, mesesDisponibles,
} from '../data/calculo-presentismo.js';

function igual(obtenido, esperado, que) {
  const a = JSON.stringify(obtenido), b = JSON.stringify(esperado);
  if (a !== b) throw new Error(`${que}: se esperaba ${b} y dio ${a}`);
}

const P = '2026-10-01';

// Fila mínima de rrhh_horas_mensual.
const fila = (o) => ({
  periodo: P, empresa: 'CIMOMET', legajo: 1,
  hs_normales: 0, hs_esperadas: 0, hs_extra50: 0, hs_extra100: 0,
  hs_vac_trabajadas: 0, hs_vac_esperadas: 0, hs_ausencias: 0,
  hs_justificadas: 0, hs_no_justificadas: 0, dias_presentes: 0, dias_ausentes_nojust: 0,
  ...o,
});

export const casos = [
  {
    nombre: 'Horas normales incluyen vacaciones trabajadas; esperadas incluyen vacaciones esperadas',
    fn() {
      const g = calcularGrupo([fila({ hs_normales: 150, hs_vac_trabajadas: 9, hs_esperadas: 160, hs_vac_esperadas: 9 })], [P]);
      igual(g.totalTrab, 159, 'totalTrab');
      igual(g.totalEsp, 169, 'totalEsp');
      igual(g.cumplimiento, '94.1', 'cumplimiento');
    },
  },
  {
    nombre: 'Ausentismo y días solo cuentan para quien tenía horas esperadas en el mes',
    fn() {
      const g = calcularGrupo([
        fila({ legajo: 1, hs_normales: 90, hs_esperadas: 100, hs_ausencias: 10, dias_presentes: 9, dias_ausentes_nojust: 1 }),
        // Todo el mes de vacaciones: sin esperadas, no suma ausencias ni días.
        fila({ legajo: 2, hs_esperadas: 0, hs_vac_esperadas: 80, hs_ausencias: 40, dias_presentes: 0, dias_ausentes_nojust: 5 }),
      ], [P]);
      igual(g.totalAus, 10, 'totalAus');
      igual(g.idxAus, '10.0', 'índice de ausentismo = 10 / (90 + 10)');
      igual(g.presGlobal, '90.0', 'presentismo = 9 / (9 + 1)');
    },
  },
  {
    nombre: 'Filas de otra empresa (fuera de CIMOMET/COMOING) no cuentan',
    fn() {
      const g = calcularGrupo([fila({ hs_normales: 100, hs_esperadas: 100 }), fila({ empresa: 'OTRA', hs_normales: 500, hs_esperadas: 500 })], [P]);
      igual(g.totalTrab, 100, 'totalTrab');
    },
  },
  {
    nombre: 'Desvinculados: se cuentan sus horas pero se informan aparte',
    fn() {
      const g = calcularGrupo([fila({ legajo: 1, hs_normales: 10 }), fila({ legajo: 2, hs_normales: 20 })], [P], new Set(['1']));
      igual(g.totalTrab, 30, 'totalTrab');
      igual([g.empleadosActivos, g.empleadosDesvinculados], [1, 1], 'activos / desvinculados');
    },
  },
  {
    nombre: 'Extras 50% se separan en semana y sábados (redondeadas)',
    fn() {
      const det = [
        { legajo: 1, periodo: P, fecha: '2026-10-30', hs_trabajadas: 2.4 }, // viernes
        { legajo: 1, periodo: P, fecha: '2026-10-31', hs_trabajadas: 4.6 }, // sábado
        { legajo: 2, periodo: P, fecha: '2026-10-31', hs_trabajadas: 8 },   // otro grupo
      ];
      igual(desgloseExt50(det, new Set(['1']), P), { semana: 2, sabado: 5 }, 'desglose');
    },
  },
  {
    nombre: 'Total = normales + extras 50% + extras 100% (cierra con las tarjetas)',
    fn() {
      // Valores reales de Oct 2026 Quincenales, validados contra el tablero.
      igual(totalHorasTrabajadas(10238.2, { semana: 1500, sabado: 299 }, 19.6), 12057, 'total');
    },
  },
  {
    nombre: 'Rangos de quincena, incluido febrero bisiesto',
    fn() {
      igual(rangoQuincena('2026-10-01', 'q1'), ['2026-10-01', '2026-10-15'], 'q1 oct');
      igual(rangoQuincena('2026-10-01', 'q2'), ['2026-10-16', '2026-10-31'], 'q2 oct');
      igual(rangoQuincena('2028-02', 'q2'), ['2028-02-16', '2028-02-29'], 'q2 feb 2028');
    },
  },
  {
    nombre: 'Quincena reconstruida desde el detalle: ignora filas mal etiquetadas y cuenta días',
    fn() {
      const det = [
        { legajo: 1, periodo: P, fecha: '2026-10-05', tipo_hora: 'HSNOR', hs_trabajadas: 8, hs_reales: 8, hs_esperadas: 8 },
        { legajo: 1, periodo: P, fecha: '2026-10-06', tipo_hora: 'HSNOR', hs_trabajadas: 0, hs_reales: 0, hs_esperadas: 8 },
        { legajo: 1, periodo: P, fecha: '2026-10-07', tipo_hora: 'HSEXT', hs_trabajadas: 2, hs_reales: 2 },
        // Etiquetada con otro período: no tiene que sumarse.
        { legajo: 1, periodo: '2026-09-01', fecha: '2026-10-08', tipo_hora: 'HSNOR', hs_trabajadas: 8, hs_reales: 8, hs_esperadas: 8 },
      ];
      const [f] = reconstruirFilasDesdeDetalle(det, [], new Map([['1', 'CIMOMET']]), P, '2026-10-01', '2026-10-15');
      igual([f.hs_normales, f.hs_esperadas, f.hs_extra50], [8, 16, 2], 'horas');
      igual([f.dias_presentes, f.dias_ausentes_nojust], [2, 1], 'días');
    },
  },
  {
    nombre: 'Un día con tardanza y salida anticipada cuenta como un solo incidente',
    fn() {
      const r = resumenTardanzas([
        { legajo: 1, periodo: P, fecha: '2026-10-05', tipo: 'tarde', minutos: 10 },
        { legajo: 1, periodo: P, fecha: '2026-10-05', tipo: 'temprano', minutos: 20 },
      ], [P]);
      igual([r.diasTarde, r.diasTemprano, r.diasConIncidente], [1, 1, 1], 'resumen');
    },
  },
  {
    nombre: 'Vacaciones, viajes y feriados no cuentan como ausentismo',
    fn() {
      const mapa = new Map([['ENF', 'enfermedad']]);
      const r = ausentismoPorCategoriaPeriodo([
        { periodo: P, codigo_justificacion: 'ENF', minutos: 480 },
        { periodo: P, codigo_justificacion: 'VACACION', minutos: 480 },
        { periodo: P, codigo_justificacion: 'AUS_FER', minutos: 480 },
        { periodo: P, codigo_justificacion: 'XYZ', minutos: 120 },
      ], [P], mapa);
      igual([r.enfermedad[0], r.sin_clasificar[0]], [8, 2], 'horas por categoría');
    },
  },
  {
    nombre: 'Meses disponibles de un año',
    fn() {
      igual(mesesDisponibles(['2025-12-01', '2026-09-01', '2026-10-01', '2026-10-01'], '2026'), ['09', '10'], 'meses');
    },
  },
];

// Corre todos los casos y devuelve [{ nombre, ok, error }].
export function correrCasos() {
  return casos.map(c => {
    try { c.fn(); return { nombre: c.nombre, ok: true }; }
    catch (e) { return { nombre: c.nombre, ok: false, error: e.message }; }
  });
}
