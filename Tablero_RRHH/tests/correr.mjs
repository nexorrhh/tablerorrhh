// Corre los casos de prueba desde la terminal: node tests/correr.mjs
import { correrCasos } from './casos-presentismo.js';

const resultados = correrCasos();
resultados.forEach(r => console.log(`${r.ok ? 'OK   ' : 'FALLA'} ${r.nombre}${r.ok ? '' : '\n      ' + r.error}`));
const fallas = resultados.filter(r => !r.ok).length;
console.log(`\n${resultados.length - fallas}/${resultados.length} casos OK`);
process.exit(fallas ? 1 : 0);
