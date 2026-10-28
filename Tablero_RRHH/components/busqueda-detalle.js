import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';
import { ESTADOS, badge as badgeCandidato } from './postulantes-candidatos.js';
import { EXP_LABEL, FORM_LABEL, ESTAB_LABEL } from './postulantes-preseleccion.js';
import { cerrarConAnimacion } from './modal-animado.js';
import { EQUIVALENCIAS_PUESTOS } from '../config/equivalencias-puestos.js';

// Ventana de solo lectura con el estado de una búsqueda: pensada para que Dirección vea de
// un vistazo quiénes son los candidatos y cómo vienen, sin entrar a la gestión de RRHH.

const HDR = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };

const RESULTADO_LABEL = { pendiente: 'Pendiente', aprobado: 'Aprobado', rechazado: 'Rechazado', en_revision: 'En revisión' };
// Estados que cierran el proceso de un candidato sin contratarlo — van aparte, al final.
const ESTADOS_CERRADOS = new Set(['rechazado_rrhh', 'rechazado_produccion', 'descartado']);
const ORDEN_ESTADO = Object.fromEntries(ESTADOS.map((x, i) => [x.value, i]));

function e(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function fmtFecha(f) {
  if (!f) return '';
  // Las fechas "YYYY-MM-DD" sin hora se interpretarían como UTC y mostrarían el día anterior.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(f) ? new Date(f + 'T00:00:00') : new Date(f);
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fmtPesos(v) { return '$ ' + Number(v).toLocaleString('es-AR', { maximumFractionDigits: 0 }); }
function norm(s) { return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase(); }
// "Soldador, Armador" → ['soldador', 'armador'] — el formulario guarda varios sectores juntos.
function listaNorm(s) { return (s || '').split(',').map(norm).filter(Boolean); }

async function traerTodo(path) {
  const PAGE = 1000;
  let out = [];
  for (let offset = 0; ; offset += PAGE) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}&limit=${PAGE}&offset=${offset}`, { headers: HDR });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const filas = await r.json();
    out = out.concat(filas);
    if (filas.length < PAGE) return out;
  }
}

// Un candidato pertenece a la búsqueda si RRHH lo vinculó explícitamente, o — mientras no
// esté vinculado a ninguna — si postuló para el mismo puesto. Hoy el vínculo explícito solo
// se carga al contratar, así que sin el criterio por sector la ventana saldría casi vacía.
// Nombres que cuentan como el puesto de la búsqueda: el propio más sus equivalentes del
// formulario de postulantes (config/equivalencias-puestos.js), ej. "Recepción y Despacho" →
// "Despacho/Pañol". Sin esto, la búsqueda no encontraba a nadie aunque hubiera candidatos.
const EQUIV_NORM = new Map(Object.entries(EQUIVALENCIAS_PUESTOS).map(([k, v]) => [norm(k), v.map(norm)]));
function nombresDelPuesto(puesto) {
  const p = norm(puesto);
  return new Set([p, ...(EQUIV_NORM.get(p) || [])]);
}
const coincide = (texto, nombres) => listaNorm(texto).some(t => nombres.has(t));

// Si RRHH eligió un puesto al promoverlo, ese manda: sin esto, alguien que postuló a
// "Soldador, Armador" y fue promovido para Armador seguiría apareciendo en Soldador.
function perteneceABusqueda(c, s, nombres) {
  if (c.solicitud_id) return c.solicitud_id === s.id;
  return c.puesto_evaluado ? coincide(c.puesto_evaluado, nombres) : coincide(c.sector, nombres);
}

function dato(label, valor) {
  return valor === null || valor === undefined || valor === ''
    ? ''
    : `<div class="bsq-det__dato"><dt>${label}</dt><dd>${valor}</dd></div>`;
}

function estrellas(n) {
  const v = Math.max(0, Math.min(5, +n || 0));
  return `<span class="bsq-det__estrellas" aria-label="${v} de 5">${'★'.repeat(v)}${'☆'.repeat(5 - v)}</span>`;
}

function entrevista(fecha, resultado, obs) {
  const partes = [
    fecha ? fmtFecha(fecha) : '',
    resultado ? RESULTADO_LABEL[resultado] || e(resultado) : '',
  ].filter(Boolean).join(' · ');
  const txtObs = obs ? `<span class="bsq-det__obs">${e(obs)}</span>` : '';
  return partes || txtObs ? `${e(partes)}${txtObs}` : '';
}

function fichaCandidato(c) {
  const nombre = [c.apellido, c.nombre].filter(Boolean).join(', ') || 'Sin nombre';
  const meta = [c.edad ? `${c.edad} años` : '', c.localidad].filter(Boolean).join(' · ');
  const detalle = [
    dato('Calificación', c.calificacion ? estrellas(c.calificacion) : ''),
    dato('Experiencia', c.experiencia_rol ? e(EXP_LABEL[c.experiencia_rol] || c.experiencia_rol) : ''),
    dato('Formación', c.formacion ? e(FORM_LABEL[c.formacion] || c.formacion) : ''),
    dato('Estabilidad laboral', c.estabilidad_laboral ? e(ESTAB_LABEL[c.estabilidad_laboral] || c.estabilidad_laboral) : ''),
    // 0 es el valor que deja el formulario cuando no se completó, no una pretensión real.
    dato('Remuneración pretendida', +c.remuneracion_pretendida > 0 ? fmtPesos(c.remuneracion_pretendida) : ''),
    dato('1ª entrevista (RRHH)', entrevista(c.primera_entrevista_fecha, c.resultado_rrhh, c.observacion_rrhh)),
    dato('2ª entrevista (Producción)', entrevista(c.segunda_entrevista_fecha, c.resultado_produccion, c.observacion_produccion)),
    dato('Evaluación', c.observaciones_evaluacion ? e(c.observaciones_evaluacion) : ''),
    dato('Notas', c.notas ? e(c.notas) : ''),
    dato('Sector de postulación', c.sector ? e(c.sector) : ''),
    dato('Candidato desde', fmtFecha(c.created_at)),
    dato('Última actualización', c.updated_at ? fmtFecha(c.updated_at) : ''),
  ].join('');

  return `
    <details class="bsq-det__cand">
      <summary>
        <span class="bsq-det__cand-nombre">${e(nombre)}${meta ? `<span class="bsq-det__cand-meta">${e(meta)}</span>` : ''}</span>
        ${badgeCandidato(c.estado)}
      </summary>
      <div class="bsq-det__cand-cuerpo">
        <dl class="bsq-det__datos">${detalle}</dl>
        ${c.cv_url ? `<a class="bsq-det__cv" href="${e(c.cv_url)}" target="_blank" rel="noopener">Ver CV ↗</a>` : ''}
      </div>
    </details>`;
}

function resumenSolicitud(s, contratados) {
  const reemplazo = s.reemplazo_nombre ? `${e(s.reemplazo_nombre)}${s.reemplazo_legajo ? ` (#${e(s.reemplazo_legajo)})` : ''}` : '';
  const inicio = s.fecha_aprobacion || s.created_at;
  const dias = inicio ? Math.max(0, Math.floor((Date.now() - new Date(inicio)) / 86400000)) : null;
  return `
    <dl class="bsq-det__datos bsq-det__datos--sol">
      ${dato('Vacantes', `${contratados} de ${s.cantidad ?? 1} cubierta${(s.cantidad ?? 1) !== 1 ? 's' : ''}`)}
      ${dato('Prioridad', s.prioridad ? e(s.prioridad) : '')}
      ${dato('Motivo', s.motivo ? e(s.motivo) : '')}
      ${dato('Reemplaza a', reemplazo)}
      ${dato('Solicitado por', s.solicitado_por ? `${e(s.solicitado_por)} · ${fmtFecha(s.created_at)}` : '')}
      ${dato('Autorizado por', s.aprobado_por ? `${e(s.aprobado_por)}${s.fecha_aprobacion ? ' · ' + fmtFecha(s.fecha_aprobacion) : ''}` : '')}
      ${dato('Días abierta', dias !== null && s.estado_busqueda !== 'cubierto' ? String(dias) : '')}
      ${dato('Descripción', s.descripcion ? e(s.descripcion) : '')}
      ${dato('Notas de Dirección', s.notas_director ? e(s.notas_director) : '')}
      ${dato('Notas de RRHH', s.notas_rrhh ? e(s.notas_rrhh) : '')}
    </dl>`;
}

function contenido(s, candidatos, preseleccionados) {
  const ordenados = [...candidatos].sort((a, b) => (ORDEN_ESTADO[b.estado] ?? -1) - (ORDEN_ESTADO[a.estado] ?? -1));
  const enProceso = ordenados.filter(c => !ESTADOS_CERRADOS.has(c.estado));
  const cerrados  = ordenados.filter(c => ESTADOS_CERRADOS.has(c.estado));
  const contratados = candidatos.filter(c => c.estado === 'contratado').length;

  const kpi = (num, label) => `<div class="bsq-det__kpi"><span class="bsq-det__kpi-num">${num}</span><span class="bsq-det__kpi-lbl">${label}</span></div>`;

  return `
    <div class="bsq-det__kpis">
      ${kpi(`${contratados}/${s.cantidad ?? 1}`, 'Contratados')}
      ${kpi(enProceso.length - contratados, 'En proceso')}
      ${kpi(cerrados.length, 'Descartados')}
      ${kpi(preseleccionados, 'Preseleccionados en Revisados')}
    </div>

    ${resumenSolicitud(s, contratados)}

    <h4 class="bsq-det__subtit">Candidatos (${candidatos.length})</h4>
    ${candidatos.length
      ? `${enProceso.map(fichaCandidato).join('')}
         ${cerrados.length ? `<p class="bsq-det__sep">Descartados / rechazados</p>${cerrados.map(fichaCandidato).join('')}` : ''}`
      : `<p class="bsq-det__vacio">Todavía no hay candidatos para este puesto.${preseleccionados ? ` Hay ${preseleccionados} perfil${preseleccionados !== 1 ? 'es' : ''} preseleccionado${preseleccionados !== 1 ? 's' : ''} en Revisados esperando avanzar.` : ''}</p>`}
    <p class="bsq-det__nota">Se muestran los candidatos vinculados a esta búsqueda y los que postularon al puesto "${e(s.puesto)}" sin búsqueda asignada. Tocá cada uno para ver el detalle cargado.</p>`;
}

// Aparición escalonada: cada bloque (y cada número del resumen) entra un poco después del
// anterior. Tope de 12 pasos para que una lista larga no tarde en terminar de aparecer.
function animarEntrada(cuerpo, abiertoEn) {
  // Si los datos llegan mientras la ventana todavía se está desplegando, la cascada espera a
  // que termine de abrirse (~550ms) — si no, ocurriría escondida detrás del recorte.
  const espera = Math.max(0, 550 - (performance.now() - abiertoEn));
  cuerpo.style.setProperty('--base', `${Math.round(espera)}ms`);
  const bloques = [...cuerpo.querySelectorAll(':scope > *, .bsq-det__kpi')]
    .filter(el => !el.classList.contains('bsq-det__kpis'));
  bloques.forEach((el, i) => {
    el.classList.add('bsq-det__anim');
    el.style.setProperty('--i', Math.min(i, 12));
  });
}

// Misma estética que la apertura de la ventana: la tarjeta se estira y el detalle nace como
// una línea fina en el centro que se ensancha y se despliega. <details> abre y cierra de
// golpe por defecto, así que el clic se intercepta y la altura se anima a mano (Web
// Animations API: con CSS solo no se puede animar hasta una altura "auto").
const RECORTE_LINEA   = 'inset(calc(50% - 1px) 50% calc(50% - 1px) 50%)';
const RECORTE_ANCHO   = 'inset(calc(50% - 1px) 0% calc(50% - 1px) 0%)';
const RECORTE_ABIERTO = 'inset(0% 0% 0% 0%)';
const CURVA = 'cubic-bezier(.65, 0, .25, 1)';

function habilitarPlegadoSuave(cuerpo) {
  const sinMovimiento = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  cuerpo.querySelectorAll('.bsq-det__cand').forEach(det => {
    const detalle = det.querySelector('.bsq-det__cand-cuerpo');
    let animando = false;

    det.querySelector('summary').addEventListener('click', ev => {
      ev.preventDefault();
      if (animando) return; // un segundo clic a mitad de camino se ignora, no se encadena
      if (sinMovimiento()) { det.open = !det.open; return; }
      animando = true;
      det.style.overflow = 'hidden';
      const terminar = () => { det.style.overflow = ''; animando = false; };

      if (!det.open) {
        const altoCerrado = det.offsetHeight;
        det.open = true;
        const altoAbierto = det.offsetHeight;
        det.animate({ height: [`${altoCerrado}px`, `${altoAbierto}px`] }, { duration: 460, easing: CURVA })
          .onfinish = terminar;
        detalle.animate(
          [{ clipPath: RECORTE_LINEA }, { clipPath: RECORTE_ANCHO, offset: .4 }, { clipPath: RECORTE_ABIERTO }],
          { duration: 460, easing: CURVA },
        );
        [...detalle.children].forEach((hijo, i) => hijo.animate(
          [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }],
          { duration: 220, delay: 340 + i * 60, easing: 'ease-out', fill: 'backwards' },
        ));
      } else {
        const altoAbierto = det.offsetHeight;
        const altoCerrado = altoAbierto - detalle.offsetHeight;
        det.classList.add('bsq-det__cand--cerrando'); // gira la flecha y apaga el resaltado ya
        [...detalle.children].forEach(hijo => hijo.animate({ opacity: [1, 0] }, { duration: 120, fill: 'forwards' }));
        detalle.animate(
          [{ clipPath: RECORTE_ABIERTO }, { clipPath: RECORTE_ANCHO, offset: .55 }, { clipPath: RECORTE_LINEA }],
          { duration: 420, easing: CURVA, fill: 'forwards' },
        );
        det.animate({ height: [`${altoAbierto}px`, `${altoCerrado}px`] }, { duration: 420, easing: CURVA, fill: 'forwards' })
          .onfinish = () => {
            det.open = false;
            det.classList.remove('bsq-det__cand--cerrando');
            // Las animaciones con fill "forwards" se descartan para que la próxima apertura
            // arranque limpia (si no, el recorte y la opacidad quedarían pegados en cero).
            det.getAnimations({ subtree: true }).forEach(a => a.cancel());
            terminar();
          };
      }
    });
  });
}

export async function abrirDetalleBusqueda(s) {
  document.getElementById('bsq-modal-detalle')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'bsq-modal-detalle';
  overlay.className = 'sol__modal-overlay';
  overlay.innerHTML = `
    <div class="sol__modal bsq-det" role="dialog" aria-modal="true" aria-labelledby="bsq-det-titulo">
      <div class="bsq-det__head">
        <div>
          <h3 class="sol__modal-titulo" id="bsq-det-titulo">${e(s.puesto)}</h3>
          <p class="sol__modal-desc">${[s.area, s.empresa].filter(Boolean).map(e).join(' · ')}</p>
        </div>
        <button type="button" class="bsq-det__cerrar" aria-label="Cerrar">✕</button>
      </div>
      <div class="bsq-det__cuerpo"><p class="sol__cargando">Cargando candidatos…</p></div>
    </div>`;
  document.body.appendChild(overlay);
  const abiertoEn = performance.now();

  const sc = document.querySelector('.app-contenido');
  if (sc) sc.style.overflow = 'hidden';
  const alTeclado = ev => { if (ev.key === 'Escape') cerrar(); };
  function cerrar() {
    document.removeEventListener('keydown', alTeclado);
    cerrarConAnimacion(overlay, () => { overlay.remove(); if (sc) sc.style.overflow = ''; });
  }
  overlay.addEventListener('click', ev => { if (ev.target === overlay) cerrar(); });
  overlay.querySelector('.bsq-det__cerrar').addEventListener('click', cerrar);
  document.addEventListener('keydown', alTeclado);
  overlay.querySelector('.bsq-det__cerrar').focus();

  const cuerpo = overlay.querySelector('.bsq-det__cuerpo');
  try {
    const [candidatos, presel] = await Promise.all([
      traerTodo('candidatos?select=*&order=created_at.desc,id.asc'),
      traerTodo('preseleccionados?select=sector,puesto_evaluado&estado=eq.activo&order=id.asc'),
    ]);
    const nombres = nombresDelPuesto(s.puesto);
    const cantPresel = presel.filter(p => coincide(p.puesto_evaluado, nombres) || coincide(p.sector, nombres)).length;
    cuerpo.innerHTML = contenido(s, candidatos.filter(c => perteneceABusqueda(c, s, nombres)), cantPresel);
    animarEntrada(cuerpo, abiertoEn);
    habilitarPlegadoSuave(cuerpo);
  } catch {
    cuerpo.innerHTML = '<p class="bsq-det__vacio">No se pudieron cargar los candidatos. Probá de nuevo en unos segundos.</p>';
  }
}
