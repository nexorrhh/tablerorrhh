// Corre los casos de prueba desde la terminal: node tests/correr.mjs
import { casos as casosPresentismo } from './casos-presentismo.js';
import { casos as casosVacaciones } from './casos-vacaciones.js';
import { casos as casosProyeccion } from './casos-proyeccion.js';

const casos = [...casosPresentismo, ...casosVacaciones, ...casosProyeccion];
const resultados = casos.map(c => {
  try { c.fn(); return { nombre: c.nombre, ok: true }; }
  catch (e) { return { nombre: c.nombre, ok: false, error: e.message }; }
});
resultados.forEach(r => console.log(`${r.ok ? 'OK   ' : 'FALLA'} ${r.nombre}${r.ok ? '' : '\n      ' + r.error}`));
const fallas = resultados.filter(r => !r.ok).length;
console.log(`\n${resultados.length - fallas}/${resultados.length} casos OK`);
process.exit(fallas ? 1 : 0);
