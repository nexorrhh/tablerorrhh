import { obtenerTabla } from '../data/cliente-supabase.js';
import {
  obtenerClasificacionPuestos,
  tipoPuesto,
  guardarClasificacionPuesto,
  borrarClasificacionPuesto,
} from '../data/clasificacion-puestos.js';

const COLOR_MENSUAL     = '#7c3aed';
const COLOR_QUINCENAL   = '#d97706';
const COLOR_SIN_ASIGNAR = '#e67e22';

const ETIQUETA = { mensual: 'Mensual', quincenal: 'Quincenal', sin_asignar: 'Sin asignar' };

function eP(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function renderizarPlantelParametrizacion(contenedor) {
  contenedor.innerHTML = `<p class="plantel__cargando">Cargando puestos…</p>`;

  let empleados, mapa;
  try {
    [empleados, mapa] = await Promise.all([
      obtenerTabla('v_empleados_activos', 'desc_puesto'),
      obtenerClasificacionPuestos(),
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
        <p class="estado-vacio__texto">No se pudo obtener el listado de puestos. Verificá la conexión.</p>
      </div>`;
    return;
  }

  const conteo = new Map();
  empleados.forEach(e => {
    const p = (e.desc_puesto || 'Sin puesto').trim();
    conteo.set(p, (conteo.get(p) || 0) + 1);
  });

  render();

  function render(mensajeError) {
    const entradas = [...conteo.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const grupos = { mensual: [], quincenal: [], sin_asignar: [] };
    entradas.forEach(([puesto, n]) => grupos[tipoPuesto(puesto, mapa)].push({ puesto, n }));

    contenedor.innerHTML = `
      <div class="plantel">
        <p class="plantel__param-intro">
          Clasificá cada puesto como mensual o quincenal. Esta clasificación la usan todos
          los indicadores del sistema (Presentismo, Plantel, Panel de inicio, Citaciones de sábados).
          Un puesto nuevo que todavía nadie clasificó queda en <strong>Sin asignar</strong>.
        </p>
        ${mensajeError ? `<p class="plantel__param-error">${eP(mensajeError)}</p>` : ''}
        <div class="plantel__param-grid">
          ${columna('quincenal', 'Puestos quincenales', grupos.quincenal, COLOR_QUINCENAL)}
          ${columna('mensual', 'Puestos mensuales', grupos.mensual, COLOR_MENSUAL)}
          ${columna('sin_asignar', 'Puestos sin asignar', grupos.sin_asignar, COLOR_SIN_ASIGNAR)}
        </div>
      </div>
    `;

    contenedor.querySelectorAll('[data-mover]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const puesto  = btn.dataset.puesto;
        const destino = btn.dataset.mover;
        contenedor.querySelectorAll('[data-mover]').forEach(b => b.disabled = true);
        try {
          if (destino === 'sin_asignar') {
            await borrarClasificacionPuesto(puesto);
            mapa.delete(puesto);
          } else {
            await guardarClasificacionPuesto(puesto, destino);
            mapa.set(puesto, destino);
          }
          render();
        } catch (err) {
          render(`No se pudo mover "${puesto}". Probá de nuevo.`);
        }
      });
    });
  }
}

function columna(tipo, titulo, items, color) {
  return `
    <div class="plantel__param-col">
      <div class="plantel__param-col-header">
        <span class="plantel__param-col-dot" style="background:${color}"></span>
        <h3 class="plantel__param-col-titulo">${titulo}</h3>
        <span class="plantel__param-col-count">${items.length}</span>
      </div>
      <div class="plantel__param-col-lista">
        ${items.length
          ? items.map(item => fila(tipo, item)).join('')
          : `<p class="plantel__param-vacio">Sin puestos acá.</p>`}
      </div>
    </div>`;
}

function fila(tipoActual, item) {
  const destinos = ['quincenal', 'mensual', 'sin_asignar'].filter(t => t !== tipoActual);
  return `
    <div class="plantel__param-fila">
      <div class="plantel__param-info">
        <span class="plantel__param-puesto">${eP(item.puesto)}</span>
        <span class="plantel__param-count-chico">${item.n} ${item.n === 1 ? 'empleado' : 'empleados'}</span>
      </div>
      <div class="plantel__param-acciones">
        ${destinos.map(d => `
          <button type="button" class="plantel__param-btn" data-mover="${d}" data-puesto="${eP(item.puesto)}">
            → ${ETIQUETA[d]}
          </button>`).join('')}
      </div>
    </div>`;
}
