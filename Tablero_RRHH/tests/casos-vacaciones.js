// Casos fijos para data/vacaciones-reglas.js y data/vacaciones-cobertura.js.
import {
  diasCorridos, reincorporacion, anioVacacionalDe, antiguedadAnios, diasCorresponden,
  validarPeriodo, hayBloqueantes, lunesDe, normalizarPuesto,
} from '../data/vacaciones-reglas.js';
import { calcularCoberturaDiaria, resumenSemanal, nivelCobertura, metricasEscenario } from '../data/vacaciones-cobertura.js';
import { vacacionesConfig } from '../config/vacaciones.js';

const R = vacacionesConfig.reglasPorDefecto;
const N = vacacionesConfig.nivelReglas;

function igual(obtenido, esperado, que) {
  const a = JSON.stringify(obtenido), b = JSON.stringify(esperado);
  if (a !== b) throw new Error(`${que}: se esperaba ${b} y dio ${a}`);
}
const codigos = alertas => alertas.map(a => a.codigo).sort();

export const casos = [
  {
    nombre: 'Vacaciones: días corridos y reincorporación (salta fin de semana y feriado)',
    fn() {
      igual(diasCorridos('2027-01-04', '2027-01-17'), 14, '14 días');
      // Termina domingo 17/1 → vuelve lunes 18/1.
      igual(reincorporacion('2027-01-17', new Set()), '2027-01-18', 'vuelve lunes');
      // Termina viernes 1/1/2027 (feriado de Año Nuevo es ese viernes): sábado y domingo → lunes 4.
      igual(reincorporacion('2026-12-31', new Set(['2027-01-01'])), '2027-01-04', 'salta feriado y finde');
    },
  },
  {
    nombre: 'Vacaciones: año vacacional y antigüedad al 31/12',
    fn() {
      igual(anioVacacionalDe('2026-11-02'), 2026, 'noviembre');
      igual(anioVacacionalDe('2027-02-01'), 2026, 'febrero del año siguiente');
      igual(antiguedadAnios('2021-12-30', 2026), 5, 'cumple 5 al 31/12');
    },
  },
  {
    nombre: 'Vacaciones: días según antigüedad (LCT art. 150) y proporcional (art. 151)',
    fn() {
      igual(diasCorresponden('2023-03-01', 2026, R).dias, 14, '3 años → 14');
      igual(diasCorresponden('2021-06-01', 2026, R).dias, 14, '5 años justos → 14 (no excede 5)');
      igual(diasCorresponden('2020-06-01', 2026, R).dias, 21, '6 años → 21');
      igual(diasCorresponden('2006-01-10', 2026, R).dias, 28, '20 años → 28 (35 recién con más de 20)');
      igual(diasCorresponden('2000-01-10', 2026, R).dias, 35, '26 años → 35');
      // Ingresó en octubre: no llegó a la mitad de los días hábiles → 1 cada 20 trabajados.
      const p = diasCorresponden('2026-10-01', 2026, R);
      igual(p.dias, Math.floor(66 / 20), 'proporcional (66 hábiles del 1/10 al 31/12/2026)');
    },
  },
  {
    nombre: 'Vacaciones: período correcto no tiene alertas',
    fn() {
      const a = validarPeriodo({
        periodo: { desde: '2027-01-04', hasta: '2027-01-17', estado: 'propuesto' },
        saldo: { corresponde: 14, comprometidoOtros: 0 }, reglas: R, niveles: N, hoy: '2026-11-08',
      });
      igual(a, [], 'sin alertas');
    },
  },
  {
    nombre: 'Vacaciones: superposición y falta de saldo bloquean',
    fn() {
      const a = validarPeriodo({
        periodo: { desde: '2027-01-11', hasta: '2027-01-24', estado: 'propuesto' },
        otros: [{ desde: '2027-01-04', hasta: '2027-01-17' }],
        saldo: { corresponde: 21, comprometidoOtros: 14 }, reglas: R, niveles: N, hoy: '2026-11-08',
      });
      igual(codigos(a), ['saldo', 'superposicion'], 'alertas');
      igual(hayBloqueantes(a), true, 'bloquea');
    },
  },
  {
    nombre: 'Vacaciones: advertencias (no lunes, fuera de temporada, aviso corto, tramo corto)',
    fn() {
      const a = validarPeriodo({
        periodo: { desde: '2026-06-03', hasta: '2026-06-07', estado: 'propuesto' }, // miércoles de junio
        saldo: { corresponde: 14, comprometidoOtros: 0 }, reglas: R, niveles: N, hoy: '2026-05-20',
      });
      igual(codigos(a), ['aviso', 'fraccion', 'lunes', 'otorgamiento'], 'advertencias');
      igual(hayBloqueantes(a), false, 'no bloquea');
    },
  },
  {
    nombre: 'Vacaciones: si el lunes es feriado puede empezar el martes',
    fn() {
      const a = validarPeriodo({
        periodo: { desde: '2026-11-24', hasta: '2026-12-07', estado: 'propuesto' }, // lunes 23/11 feriado
        saldo: { corresponde: 14, comprometidoOtros: 0 }, reglas: R, niveles: N, hoy: '2026-01-01',
        feriados: new Set(['2026-11-23']),
      });
      igual(codigos(a), [], 'sin alerta de lunes');
    },
  },
  {
    nombre: 'Vacaciones: sin verano en los últimos 2 años avisa',
    fn() {
      const historial = [
        { desde: '2024-10-07', hasta: '2024-10-20' },
        { desde: '2025-10-06', hasta: '2025-10-19' },
      ];
      const a = validarPeriodo({
        periodo: { desde: '2026-10-05', hasta: '2026-10-18', estado: 'notificado' },
        saldo: { corresponde: 14, comprometidoOtros: 0 }, historial, reglas: R, niveles: N, hoy: '2026-09-01',
      });
      igual(codigos(a), ['verano'], 'verano');
    },
  },
  {
    nombre: 'Vacaciones: puestos de Tango se normalizan para mapear a sectores',
    fn() {
      igual(normalizarPuesto('  Recepción  y Despacho '), 'recepcion y despacho', 'normalizado');
      igual(lunesDe('2027-01-07'), '2027-01-04', 'lunes de la semana');
    },
  },
  {
    nombre: 'Cobertura: disponibles, déficit y reemplazo desde un sector con excedente',
    fn() {
      const sectores = [{ id: 1, pct_verde: 100, pct_amarillo: 85 }, { id: 2, pct_verde: 100, pct_amarillo: 85 }];
      const personas = [
        { clave: 'C|1', sectorId: 1 }, { clave: 'C|2', sectorId: 1 }, { clave: 'C|3', sectorId: 1 },
        { clave: 'C|4', sectorId: 2 }, { clave: 'C|5', sectorId: 2 }, { clave: 'C|6', sectorId: 2 },
      ];
      // Lunes 4/1/2027: salen 2 del sector 1. El sector 1 necesita 3, el 2 necesita 2.
      const periodos = [
        { empresa: 'C', legajo: 1, desde: '2027-01-04', hasta: '2027-01-17' },
        { empresa: 'C', legajo: 2, desde: '2027-01-04', hasta: '2027-01-17' },
      ];
      const competencias = new Map([['C|4', new Set([1])], ['C|5', new Set([1])]]);
      const porDia = calcularCoberturaDiaria({
        dias: ['2027-01-04'], feriados: new Set(), sectores, personas, periodos,
        requeridosDe: id => (id === 1 ? 3 : 2), competencias,
      });
      const s1 = porDia.get(1).get('2027-01-04');
      const s2 = porDia.get(2).get('2027-01-04');
      igual([s1.dotacion, s1.ausentes.length, s1.disponibles], [3, 2, 1], 'sector 1 base');
      // El sector 2 tiene 3 y necesita 2: presta UNA persona (no las dos).
      igual([s1.reemplazos.length, s1.disponiblesConReemplazo, s1.cobertura], [1, 2, 67], 'sector 1 con reemplazo');
      igual([s2.disponibles, s2.cobertura], [2, 100], 'sector 2 queda justo');
      igual(nivelCobertura(s1.cobertura, sectores[0]), 'rojo', 'rojo');
    },
  },
  {
    nombre: 'Cobertura: sin requeridos no se juzga; semana toma el peor día; métricas',
    fn() {
      const sectores = [{ id: 1, pct_verde: 100, pct_amarillo: 85 }];
      const personas = [{ clave: 'C|1', sectorId: 1 }, { clave: 'C|2', sectorId: 1 }];
      const periodos = [{ empresa: 'C', legajo: 1, desde: '2027-01-06', hasta: '2027-01-06' }];
      const dias = ['2027-01-04', '2027-01-05', '2027-01-06', '2027-01-07', '2027-01-08', '2027-01-09', '2027-01-10'];
      const sinReq = calcularCoberturaDiaria({ dias, feriados: new Set(), sectores, personas, periodos, requeridosDe: () => null });
      igual(sinReq.get(1).get('2027-01-06').cobertura, null, 'sin requeridos → null');
      igual(sinReq.get(1).size, 5, 'solo días hábiles');
      const conReq = calcularCoberturaDiaria({ dias, feriados: new Set(), sectores, personas, periodos, requeridosDe: () => 2 });
      const sem = resumenSemanal(conReq).get(1).get('2027-01-04');
      igual([sem.dia, sem.cobertura], ['2027-01-06', 50], 'peor día de la semana');
      const m = metricasEscenario(conReq, sectores);
      igual([m.semanasRojas, m.diasDeficit, m.faltanPersonasDia], [1, 1, 1], 'métricas');
    },
  },
];
