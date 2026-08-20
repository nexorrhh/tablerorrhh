// Horas y Presentismo → Parametrización.
// Tango exporta decenas de "conceptos de justificación" distintos (ENF, ENF TRAUM1,
// ACC_EMP, AUS C/AVIS, SIN_AVISO...) para el mismo tipo de evento (ausencia). A RRHH
// no le interesa el detalle médico/administrativo de cada uno — le interesa reducirlos
// a 4 motivos de ausentismo. Esta pantalla clasifica cada código UNA sola vez; el resto
// del sistema (Indicadores, Por persona) usa esa clasificación para agrupar.
//
// VACACION y VIAJE no aparecen acá — ya tienen tratamiento propio en presentismo-carga.js
// (no cuentan como ausentismo), así que no son "motivo de ausencia" a clasificar.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';
import {
  CATEGORIAS_AUSENCIA,
  obtenerClasificacionAusencias,
  categoriaAusencia,
  guardarClasificacionAusencia,
  borrarClasificacionAusencia,
} from '../data/clasificacion-ausencias.js';

const HDR = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };

// Códigos con tratamiento propio aguas arriba — no son "motivo de ausencia" a clasificar acá.
const CODIGOS_EXCLUIDOS = new Set(['VACACION', 'VIAJE']);

const COLOR = {
  enfermedad:     '#d97706',
  accidente:      '#dc2626',
  licencia:       '#0891b2',
  aviso:          '#2563eb',
  sin_aviso:      '#991b1b',
  sin_clasificar: '#94a3b8',
};
const ETIQUETA = {
  enfermedad:     'Enfermedad',
  accidente:      'Accidente',
  licencia:       'Licencia',
  aviso:          'Aviso',
  sin_aviso:      'Sin aviso',
  sin_clasificar: 'Sin clasificar',
};

function eP(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function renderizarPresentismoParametrizacion(contenedor) {
  contenedor.innerHTML = `<p class="plantel__cargando">Cargando conceptos de justificación…</p>`;

  let eventos, mapa;
  try {
    [eventos, mapa] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/rrhh_tardanzas_salidas?tipo=eq.ausente&select=codigo_justificacion,descripcion_justificacion`, { headers: HDR })
        .then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))),
      obtenerClasificacionAusencias(),
    ]);
  } catch (e) {
    contenedor.innerHTML = `
      <div class="estado-vacio">
        <div class="estado-vacio__icono">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
               stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
        <h3 class="estado-vacio__titulo">Error al cargar datos</h3>
        <p class="estado-vacio__texto">No se pudieron obtener los conceptos de justificación. Verificá la conexión.</p>
      </div>`;
    return;
  }

  // Un mismo código puede venir con distinta descripción entre archivos — nos quedamos
  // con la primera que aparece, y contamos cuántas veces se usó cada código.
  const conteo = new Map(); // codigo -> { descripcion, n }
  eventos.forEach(e => {
    const cod = (e.codigo_justificacion || '').trim();
    if (!cod || CODIGOS_EXCLUIDOS.has(cod)) return;
    if (!conteo.has(cod)) conteo.set(cod, { descripcion: e.descripcion_justificacion || '', n: 0 });
    conteo.get(cod).n++;
  });

  render();

  function render(mensajeError) {
    const entradas = [...conteo.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const grupos = { enfermedad: [], accidente: [], licencia: [], aviso: [], sin_aviso: [], sin_clasificar: [] };
    entradas.forEach(([codigo, info]) => grupos[categoriaAusencia(codigo, mapa)].push({ codigo, ...info }));

    contenedor.innerHTML = `
      <div class="plantel">
        <p class="plantel__param-intro">
          Clasificá cada concepto de justificación que use Tango en uno de estos 5 motivos de
          ausentismo. Esta clasificación la usan "Detalle de ausentismo" (Indicadores) y el
          detalle diario de "Por persona". Un concepto nuevo que todavía nadie clasificó queda
          en <strong>Sin clasificar</strong>.
        </p>
        ${mensajeError ? `<p class="plantel__param-error">${eP(mensajeError)}</p>` : ''}
        <div class="pres__ausparam-grid">
          ${columna('enfermedad', grupos.enfermedad)}
          ${columna('accidente', grupos.accidente)}
          ${columna('licencia', grupos.licencia)}
          ${columna('aviso', grupos.aviso)}
          ${columna('sin_aviso', grupos.sin_aviso)}
          ${columna('sin_clasificar', grupos.sin_clasificar)}
        </div>
      </div>
    `;

    contenedor.querySelectorAll('[data-mover]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const codigo  = btn.dataset.codigo;
        const destino = btn.dataset.mover;
        contenedor.querySelectorAll('[data-mover]').forEach(b => b.disabled = true);
        try {
          if (destino === 'sin_clasificar') {
            await borrarClasificacionAusencia(codigo);
            mapa.delete(codigo);
          } else {
            await guardarClasificacionAusencia(codigo, destino);
            mapa.set(codigo, destino);
          }
          render();
        } catch (err) {
          render(`No se pudo mover "${codigo}". Probá de nuevo.`);
        }
      });
    });
  }
}

function columna(categoria, items) {
  return `
    <div class="plantel__param-col">
      <div class="plantel__param-col-header">
        <span class="plantel__param-col-dot" style="background:${COLOR[categoria]}"></span>
        <h3 class="plantel__param-col-titulo">${ETIQUETA[categoria]}</h3>
        <span class="plantel__param-col-count">${items.length}</span>
      </div>
      <div class="plantel__param-col-lista">
        ${items.length
          ? items.map(item => fila(categoria, item)).join('')
          : `<p class="plantel__param-vacio">Sin conceptos acá.</p>`}
      </div>
    </div>`;
}

function fila(categoriaActual, item) {
  const destinos = [...CATEGORIAS_AUSENCIA, 'sin_clasificar'].filter(c => c !== categoriaActual);
  return `
    <div class="plantel__param-fila">
      <div class="plantel__param-info">
        <span class="plantel__param-puesto">${eP(item.codigo)}${item.descripcion ? ` — ${eP(item.descripcion)}` : ''}</span>
        <span class="plantel__param-count-chico">${item.n} ${item.n === 1 ? 'evento' : 'eventos'}</span>
      </div>
      <div class="plantel__param-acciones">
        ${destinos.map(d => `
          <button type="button" class="plantel__param-btn" data-mover="${d}" data-codigo="${eP(item.codigo)}">
            → ${ETIQUETA[d]}
          </button>`).join('')}
      </div>
    </div>`;
}
