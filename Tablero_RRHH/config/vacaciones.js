// Configuración del módulo Vacaciones (solo datos).
// Las reglas de acá son los valores POR DEFECTO: RRHH las puede cambiar y versionar desde
// Vacaciones → Configuración (se guardan en vac_reglas). Ninguna es definitiva hasta que
// RRHH las verifique — por eso casi todas son "advertencia" y no bloquean.

export const vacacionesConfig = {
  reglasPorDefecto: {
    version: 0,
    // LCT art. 150: días corridos según antigüedad al 31/12 del año.
    escalaAntiguedad: [
      { hastaAnios: 5,    dias: 14 },
      { hastaAnios: 10,   dias: 21 },
      { hastaAnios: 20,   dias: 28 },
      { hastaAnios: null, dias: 35 },
    ],
    // LCT art. 151: si no trabajó la mitad de los días hábiles del año, 1 día cada 20 trabajados.
    diasTrabajadosPorDiaProporcional: 20,
    // LCT art. 154: período de otorgamiento (mes-día).
    otorgamientoDesde: '10-01',
    otorgamientoHasta: '04-30',
    // Aviso previo por escrito. LCT art. 154 dice 45; la investigación indica que la Ley 27.802
    // (2026) lo llevó a 30 — A VERIFICAR CON RRHH antes de cambiarlo.
    avisoPrevioDias: 45,
    // Tramo mínimo si se fraccionan (Ley 27.802, a verificar).
    fraccionMinimaDias: 7,
    // LCT art. 151: deben comenzar un lunes (o el hábil siguiente si es feriado).
    inicioEnLunes: true,
    // LCT art. 154: verano al menos una vez cada N años.
    veranoCadaAnios: 3,
    veranoDesde: '12-21',
    veranoHasta: '03-21',
  },

  // Qué hace cada regla si no se cumple: 'bloqueante' (no deja guardar) o 'advertencia'
  // (deja guardar si alguien acepta la advertencia, y queda registrado).
  nivelReglas: {
    fechas: 'bloqueante',
    superposicion: 'bloqueante',
    saldo: 'bloqueante',
    sinSaldo: 'advertencia',
    lunes: 'advertencia',
    otorgamiento: 'advertencia',
    aviso: 'advertencia',
    fraccion: 'advertencia',
    verano: 'advertencia',
    cobertura: 'advertencia',
  },

  estados: [
    { id: 'borrador',   texto: 'Borrador' },
    { id: 'propuesto',  texto: 'Propuesto' },
    { id: 'aprobado',   texto: 'Aprobado' },
    { id: 'notificado', texto: 'Notificado' },
    { id: 'gozado',     texto: 'Gozado' },
    { id: 'rechazado',  texto: 'Rechazado' },
    { id: 'cancelado',  texto: 'Cancelado' },
  ],
  // Estados que ocupan días (cuentan para saldo y cobertura).
  estadosActivos: ['borrador', 'propuesto', 'aprobado', 'notificado', 'gozado'],
  // Estados que se consideran firmes (los demás se ven como "propuesta").
  estadosFirmes: ['aprobado', 'notificado', 'gozado'],

  // Vistas del Gantt: cuántos píxeles ocupa un día y cuántos días se ven por pantalla.
  vistas: [
    { id: 'semana',    texto: 'Semanal',    pxDia: 44, dias: 21 },
    { id: 'mes',       texto: 'Mensual',    pxDia: 24, dias: 45 },
    { id: 'trimestre', texto: 'Trimestral', pxDia: 10, dias: 100 },
    { id: 'anio',      texto: 'Anual',      pxDia: 3.4, dias: 366 },
  ],
  vistaPorDefecto: 'trimestre',

  // Duración que se propone al crear un período nuevo (días corridos).
  duracionSugeridaDias: 14,

  convenios: ['UOM', 'UOCRA', 'Fuera de convenio'],

  // Convenio por defecto según la empresa. Una persona puntual se puede cambiar en
  // Vacaciones → Configuración → Personas (eso tiene prioridad sobre esta regla).
  convenioPorEmpresa: { CIMOMET: 'UOM', COMOING: 'UOCRA' },

  // Puestos que no entran en la planificación de vacaciones (ni en cobertura ni en saldos).
  // Se escriben normalizados: minúsculas, sin tildes.
  puestosExcluidos: ['gerencia'],

  // Agrupación automática, igual que el tablero de Dirección: todo puesto que empiece con
  // el prefijo va al sector indicado, sin importar de qué área sea (ej. "Responsable de
  // Calidad", "Responsable de Compras y Tecnología" → Responsables). Tiene prioridad sobre
  // el mapeo puesto → sector de Configuración; una excepción cargada para una persona puntual
  // tiene prioridad sobre esto.
  gruposPorPrefijo: [
    { prefijo: 'responsable', sector: 'Responsables' },
  ],
};
