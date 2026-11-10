// Casos fijos para data/proyeccion-horas.js.
import {
  sumarMeses, diasHabilesDelMes, resolverJornadaPorRegla, horasSemanales, describirJornada,
  ausentismoPorPuesto, proyeccionPorGrupo, diasDeVacacionesPorPersona,
} from '../data/proyeccion-horas.js';

function igual(obtenido, esperado, que) {
  const a = JSON.stringify(obtenido), b = JSON.stringify(esperado);
  if (a !== b) throw new Error(`${que}: se esperaba ${b} y dio ${a}`);
}

// Jornada fija L–J 9 h, V 8 h.
const J = [0, 9, 9, 9, 9, 8, 0];
const resolver = () => ({ jornada: J, estimada: false });
const SIN_AUS = { porPuesto: new Map(), global: 0 };

export const casos = [
  {
    nombre: 'Proyección: meses y días hábiles (feriado en semana se descuenta)',
    fn() {
      igual(sumarMeses('2026-11', 2), '2027-01', 'cruza de año');
      igual(sumarMeses('2027-01', -1), '2026-12', 'hacia atrás');
      // Enero 2027: 21 días L–V; con el feriado del viernes 1/1 quedan 20.
      igual(diasHabilesDelMes('2027-01', new Set()).length, 21, 'enero sin feriados');
      igual(diasHabilesDelMes('2027-01', new Set(['2027-01-01'])).length, 20, 'enero con Año Nuevo');
    },
  },
  {
    nombre: 'Proyección: jornada fija por regla (general 44 h; Ingeniería 45 h, incluye Responsable)',
    fn() {
      const cfg = { jornadaGeneral: [0, 9, 9, 9, 9, 8, 0], excepciones: [{ nombre: 'Ingeniería', contiene: 'ingenier', jornada: [0, 9, 9, 9, 9, 9, 0] }] };
      const r = resolverJornadaPorRegla(cfg);
      igual(horasSemanales(r({ desc_puesto: 'Soldador' }).jornada), 44, 'general');
      igual(horasSemanales(r({ desc_puesto: 'Ingenieria' }).jornada), 45, 'Ingenieria sin acento');
      igual([horasSemanales(r({ desc_puesto: 'Responsable de Ingeniería' }).jornada), r({ desc_puesto: 'Responsable de Ingeniería' }).regla], [45, 'Ingeniería'], 'responsable');
      igual(describirJornada(cfg.jornadaGeneral), 'L–J 9 h · V 8 h', 'texto');
    },
  },
  {
    nombre: 'Proyección: vacaciones restan la jornada de los días hábiles; ausentismo sobre lo que queda',
    fn() {
      const columnas = [{ periodo: '2027-01', dias: diasHabilesDelMes('2027-01', new Set(['2027-01-01'])) }];
      // 20 días hábiles: 16 L–J (9 h) + 4 V (8 h) = 176 h teóricas (sin el viernes 1/1).
      const personas = [
        { empresa: 'CIMOMET', legajo: 10, desc_puesto: 'Armador', grupo: 'Armado' },
        { empresa: 'CIMOMET', legajo: 11, desc_puesto: 'Armador', grupo: 'Armado' },
      ];
      // Legajo 10 de vacaciones 04/01–17/01: 10 días hábiles = 8×9 + 2×8 = 88 h.
      const diasVac = diasDeVacacionesPorPersona([{ empresa: 'CIMOMET', legajo: '10', desde: '2027-01-04', hasta: '2027-01-17' }]);
      const sin = proyeccionPorGrupo({ personas, resolverJornada: resolver, ausentismo: SIN_AUS, aplicarAusentismo: false, diasVac, columnas });
      const m = sin.grupos.get('Armado').porMes[0];
      igual([m.teoricas, m.vacaciones, m.disponibles, m.deVacaciones], [352, 88, 264, 1], 'sin ausentismo');
      const aus = { porPuesto: new Map([['Armador', 0.1]]), global: 0 };
      const con = proyeccionPorGrupo({ personas, resolverJornada: resolver, ausentismo: aus, aplicarAusentismo: true, diasVac, columnas });
      igual(Math.round(con.totales[0].disponibles * 10) / 10, 237.6, '10% sobre 264');
    },
  },
  {
    nombre: 'Proyección: ausentismo histórico por puesto y general',
    fn() {
      const emps = [{ empresa: 'C', legajo: 1, desc_puesto: 'A' }, { empresa: 'C', legajo: 2, desc_puesto: 'B' }];
      const filas = [{ empresa: 'C', legajo: '1', hs_ausencias: 10, hs_normales: 90 }, { empresa: 'C', legajo: '2', hs_ausencias: 0, hs_normales: 100 }];
      const a = ausentismoPorPuesto(filas, emps);
      igual([a.porPuesto.get('A'), a.porPuesto.get('B'), a.global], [0.1, 0, 0.05], 'tasas');
    },
  },
];
