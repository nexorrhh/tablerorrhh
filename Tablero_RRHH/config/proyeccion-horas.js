// Jornada que se usa para PROYECTAR horas (Vacaciones → Resumen y Proyección de horas).
// Es una regla fija, indistinta de lo que cada persona tenga cargado en Tango.
// Cada jornada son las horas por día de semana: [dom, lun, mar, mié, jue, vie, sáb].
//
// Para agregar una excepción: sumar un objeto a `excepciones`. `contiene` se busca dentro
// del nombre del puesto, sin importar mayúsculas ni acentos (ej. 'ingenier' toma
// "Ingenieria" y "Responsable de Ingeniería"). Gana la primera que coincide.

export const proyeccionConfig = {
  jornadaGeneral: [0, 9, 9, 9, 9, 8, 0], // lunes a jueves 9 h, viernes 8 h = 44 h/sem

  excepciones: [
    { nombre: 'Ingeniería', contiene: 'ingenier', jornada: [0, 9, 9, 9, 9, 9, 0] }, // L–V 9 h = 45 h/sem
  ],
};
