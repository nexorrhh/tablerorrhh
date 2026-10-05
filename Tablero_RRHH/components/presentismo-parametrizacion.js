// Horas y Presentismo → Parametrización.
// Tango exporta decenas de "conceptos de justificación" distintos (ENF, ENF TRAUM1,
// ACC_EMP, AUS C/AVIS, SIN_AVISO...) para el mismo tipo de evento (ausencia). A RRHH
// no le interesa el detalle médico/administrativo de cada uno — le interesa reducirlos
// a 4 motivos de ausentismo. Esta pantalla clasifica cada código UNA sola vez; el resto
// del sistema (Indicadores, Por persona) usa esa clasificación para agrupar.
//
// VACACION, VIAJE y AUS_FER no aparecen acá — ya tienen tratamiento propio en presentismo-carga.js
// / presentismo-indicadores.js (no cuentan como ausentismo), así que no son "motivo de ausencia"
// a clasificar. AUS_FER (feriado) se excluye porque no es una falta de la persona.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';
import {
  CATEGORIAS_AUSENCIA,
  obtenerClasificacionAusencias,
  categoriaAusencia,
  guardarClasificacionAusencia,
  borrarClasificacionAusencia,
} from '../data/clasificacion-ausencias.js';
import { fetchTodasFilas } from './presentismo-indicadores.js';
import { obtenerExentosFichada, marcarExentoFichada, quitarExencionFichada } from '../data/fichadas-exentos.js';

const HDR = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };

// Códigos con tratamiento propio aguas arriba — no son "motivo de ausencia" a clasificar acá.
const CODIGOS_EXCLUIDOS = new Set(['VACACION', 'VIAJE', 'AUS_FER']);

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

const EMP_LABEL = { CIMOMET: 'Cimomet', COMOING: 'Co.mo.ing' };

function eP(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function normTxt(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export async function renderizarPresentismoParametrizacion(contenedor) {
  contenedor.innerHTML = `<p class="plantel__cargando">Cargando…</p>`;

  let eventos, mapa, empleados, exentos;
  try {
    [eventos, mapa, empleados, exentos] = await Promise.all([
      // fetchTodasFilas pagina de a 1000 — con más de mil eventos de ausencia en la base,
      // un fetch simple los truncaba y los códigos nuevos (recién aparecidos en filas altas)
      // quedaban invisibles acá aunque sí se contaran como "sin clasificar" en los gráficos.
      fetchTodasFilas(`${SUPABASE_URL}/rest/v1/rrhh_tardanzas_salidas?tipo=eq.ausente&select=codigo_justificacion,descripcion_justificacion&order=id.asc`),
      obtenerClasificacionAusencias(),
      fetch(`${SUPABASE_URL}/rest/v1/empleados?select=legajo,apellido_y_nombre,empresa,activo&limit=2000`, { headers: HDR }).then(r => r.ok ? r.json() : []),
      obtenerExentosFichada(),
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
        <p class="estado-vacio__texto">No se pudieron obtener los datos. Verificá la conexión.</p>
      </div>`;
    return;
  }

  // Un mismo código puede venir con distinta descripción entre archivos — nos quedamos
  // con la primera que aparece, y contamos cuántas veces se usó cada código.
  // Importante: un código VACÍO (Tango no cargó nada) NO se descarta acá — categoriaAusencia()
  // lo clasifica igual como "sin_clasificar" en Indicadores/Por persona, así que si lo
  // ocultáramos acá, esas horas quedarían contadas en los gráficos pero invisibles/imposibles
  // de reclasificar en esta pantalla (eso pasaba antes: el gráfico mostraba "Sin clasif." con
  // horas pero acá figuraba "0", porque este filtro las tiraba).
  const conteo = new Map(); // codigo -> { descripcion, n }
  eventos.forEach(e => {
    const cod = (e.codigo_justificacion || '').trim();
    if (CODIGOS_EXCLUIDOS.has(cod)) return;
    if (!conteo.has(cod)) conteo.set(cod, { descripcion: e.descripcion_justificacion || '', n: 0 });
    conteo.get(cod).n++;
  });

  contenedor.innerHTML = `
    <div id="param-ausentismo"></div>
    <div id="param-fichexc" style="margin-top:var(--espacio-xl)"></div>
  `;
  const ausentismoEl = contenedor.querySelector('#param-ausentismo');
  const fichexcEl    = contenedor.querySelector('#param-fichexc');

  renderAusentismo();
  renderFichExc();

  function renderAusentismo(mensajeError) {
    const entradas = [...conteo.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const grupos = { enfermedad: [], accidente: [], licencia: [], aviso: [], sin_aviso: [], sin_clasificar: [] };
    entradas.forEach(([codigo, info]) => grupos[categoriaAusencia(codigo, mapa)].push({ codigo, ...info }));

    ausentismoEl.innerHTML = `
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

    ausentismoEl.querySelectorAll('[data-mover]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const codigo  = btn.dataset.codigo;
        const destino = btn.dataset.mover;
        ausentismoEl.querySelectorAll('[data-mover]').forEach(b => b.disabled = true);
        try {
          if (destino === 'sin_clasificar') {
            await borrarClasificacionAusencia(codigo);
            mapa.delete(codigo);
          } else {
            await guardarClasificacionAusencia(codigo, destino);
            mapa.set(codigo, destino);
          }
          renderAusentismo();
        } catch (err) {
          renderAusentismo(`No se pudo mover "${codigo}". Probá de nuevo.`);
        }
      });
    });
  }

  // ── Fichadas: personas exentas ────────────────────────────────────────────
  // Gente que nunca va a fichar en el reloj (directores, o alguien puntual por su propio
  // motivo) — Novedades → Chequeo del día usa esta misma lista para no mostrarlos como
  // "No fichó". Se puede agregar desde acá o con el botón "Exento" directo en ese informe.
  function renderFichExc(mensajeError) {
    const activos = empleados.filter(e => e.activo);
    fichexcEl.innerHTML = `
      <div class="plantel">
        <p class="plantel__param-intro">
          Personas que <strong>nunca</strong> van a fichar en el reloj (directores, gente sin
          huella cargada todavía, etc.). Novedades → Chequeo del día no las va a mostrar como
          "No fichó".
        </p>
        ${mensajeError ? `<p class="plantel__param-error">${eP(mensajeError)}</p>` : ''}
        <div class="fichexc__agregar">
          <input type="search" id="fichexc-busq" class="plantel__busqueda" autocomplete="off"
                 placeholder="Buscar persona por legajo o nombre para agregar…">
          <div id="fichexc-resultados" class="pres-ficha__resultados" hidden></div>
        </div>
        <div class="fichexc__lista">
          ${exentos.length
            ? exentos.map(e => filaExento(e)).join('')
            : `<p class="plantel__param-vacio">No hay nadie marcado como exento.</p>`}
        </div>
      </div>
    `;

    const busq = fichexcEl.querySelector('#fichexc-busq');
    const resultadosEl = fichexcEl.querySelector('#fichexc-resultados');
    const yaExento = new Set(exentos.map(e => `${e.legajo}|${e.empresa}`));

    busq.addEventListener('input', () => {
      const texto = normTxt(busq.value.trim());
      if (!texto) { resultadosEl.hidden = true; resultadosEl.innerHTML = ''; return; }
      const coincidencias = activos
        .filter(p => !yaExento.has(`${p.legajo}|${p.empresa}`))
        .filter(p => normTxt(p.apellido_y_nombre).includes(texto) || String(p.legajo).includes(texto))
        .slice(0, 12);
      resultadosEl.hidden = false;
      resultadosEl.innerHTML = coincidencias.length
        ? coincidencias.map(p => `
            <button type="button" class="pres-ficha__resultado" data-legajo="${p.legajo}" data-empresa="${eP(p.empresa)}" data-nombre="${eP(p.apellido_y_nombre)}">
              <span class="pres-ficha__resultado-nombre">${eP(p.apellido_y_nombre)}</span>
              <span class="pres-ficha__resultado-meta">Legajo #${p.legajo} · ${EMP_LABEL[p.empresa] || p.empresa}</span>
            </button>`).join('')
        : `<p class="pres-ficha__sin-resultados">Sin resultados.</p>`;

      resultadosEl.querySelectorAll('[data-legajo]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const { legajo, empresa, nombre } = btn.dataset;
          busq.value = ''; resultadosEl.hidden = true;
          try {
            await marcarExentoFichada(legajo, empresa, nombre, null);
            exentos.push({ legajo: +legajo, empresa, nombre, motivo: null });
            exentos.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
            renderFichExc();
          } catch (err) {
            renderFichExc(`No se pudo agregar a "${nombre}". Probá de nuevo.`);
          }
        });
      });
    });

    fichexcEl.querySelectorAll('[data-quitar]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const { legajo, empresa } = btn.dataset;
        fichexcEl.querySelectorAll('[data-quitar]').forEach(b => b.disabled = true);
        try {
          await quitarExencionFichada(legajo, empresa);
          exentos = exentos.filter(e => !(String(e.legajo) === legajo && e.empresa === empresa));
          renderFichExc();
        } catch (err) {
          renderFichExc('No se pudo quitar la excepción. Probá de nuevo.');
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
        <span class="plantel__param-puesto">${item.codigo ? eP(item.codigo) : '(sin código)'}${item.descripcion ? ` — ${eP(item.descripcion)}` : ''}</span>
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

function filaExento(e) {
  return `
    <div class="plantel__param-fila">
      <div class="plantel__param-info">
        <span class="plantel__param-puesto">${eP(e.nombre) || `Legajo ${e.legajo}`}</span>
        <span class="plantel__param-count-chico">Legajo #${e.legajo} · ${EMP_LABEL[e.empresa] || eP(e.empresa)}${e.motivo ? ` · ${eP(e.motivo)}` : ''}</span>
      </div>
      <div class="plantel__param-acciones">
        <button type="button" class="plantel__param-btn" data-quitar data-legajo="${e.legajo}" data-empresa="${eP(e.empresa)}">
          Quitar
        </button>
      </div>
    </div>`;
}
