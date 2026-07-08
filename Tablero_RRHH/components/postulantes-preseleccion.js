import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';

const HDR = {
  'Content-Type': 'application/json',
  'apikey': SUPABASE_ANON_KEY,
  'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
};

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: HDR });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function sbPatch(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: { ...HDR, 'Prefer': 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
}

async function sbPost(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: { ...HDR, 'Prefer': 'return=representation' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function sbDelete(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: { ...HDR, 'Prefer': 'return=minimal' },
  });
  if (!res.ok) throw new Error(await res.text());
}

const EXP_LABEL = {
  sin_experiencia: 'Sin exp.',
  '1_3_años':      '1-3 años',
  '3_7_años':      '3-7 años',
  mas_7_años:      '+7 años',
};
const FORM_LABEL = {
  sin_cert:       'Sin cert.',
  titulo_tecnico: 'Título técnico',
  certificado:    'Certificado',
};
const ESTAB_LABEL = {
  alta_rotacion: 'Alta rotación',
  normal:        'Normal',
  estable:       'Estable',
};

const ESTADO_CLASE = {
  activo:    'presel__badge--activo',
  promovido: 'presel__badge--promovido',
  descartado:'presel__badge--descartado',
};

const ESTADO_LABEL = {
  activo:    'Activo',
  promovido: 'Promovido',
  descartado:'Descartado',
};

function badge(estado) {
  return `<span class="presel__badge ${ESTADO_CLASE[estado] || ''}">${ESTADO_LABEL[estado] || estado}</span>`;
}

export async function renderizarPostulantesPreseleccion(contenedor) {
  contenedor.innerHTML = `<p class="presel__cargando">Cargando preseleccionados…</p>`;

  let lista = [];

  try {
    lista = await sbGet('preseleccionados?select=*&order=created_at.desc');
  } catch (_) {
    contenedor.innerHTML = `
      <div class="estado-vacio">
        <h3 class="estado-vacio__titulo">Error al cargar</h3>
        <p class="estado-vacio__texto">No se pudieron obtener los preseleccionados.</p>
      </div>`;
    return;
  }

  let filtroEstado = 'activo';
  let filtroTexto  = '';
  let filtroCal    = '';
  let filtroExp    = '';
  let filtroForm   = '';
  let filtroEstab  = '';

  function tarjeta(p) {
    return `
      <div class="presel__card presel__card--${p.estado}">
        <div class="presel__card-head">
          <div class="presel__avatar">${iniciales(p.nombre, p.apellido)}</div>
          <div class="presel__info">
            <p class="presel__nombre">${p.apellido ? p.apellido + ', ' : ''}${p.nombre || ''}</p>
            <p class="presel__meta">${[
              p.sector,
              p.edad ? p.edad + ' años' : null,
              p.localidad,
            ].filter(Boolean).join(' · ')}</p>
          </div>
          ${badge(p.estado)}
        </div>
        ${p.calificacion ? `
          <div class="presel__eval-resumen">
            <span class="presel__eval-stars">${'★'.repeat(p.calificacion)}${'☆'.repeat(5 - p.calificacion)}</span>
            ${p.puesto_evaluado ? `<span class="presel__eval-chip presel__eval-chip--puesto">${p.puesto_evaluado}</span>` : ''}
            ${p.experiencia_rol ? `<span class="presel__eval-chip">${EXP_LABEL[p.experiencia_rol] || p.experiencia_rol}</span>` : ''}
            ${p.formacion ? `<span class="presel__eval-chip">${FORM_LABEL[p.formacion] || p.formacion}</span>` : ''}
            ${p.estabilidad_laboral ? `<span class="presel__eval-chip">${ESTAB_LABEL[p.estabilidad_laboral] || p.estabilidad_laboral}</span>` : ''}
          </div>
        ` : ''}
        ${p.notas_rrhh ? `<p class="presel__notas">${p.notas_rrhh}</p>` : ''}
        ${p.observacion_postulante ? `<p class="presel__obs-post">"${p.observacion_postulante}"</p>` : ''}
        <div class="presel__card-foot">
          ${p.cv_url ? `<a class="presel__cv-link" href="${p.cv_url}" target="_blank" rel="noopener">Ver CV</a>` : ''}
          ${p.estado === 'activo' ? `
            <button class="presel__btn-quitar" data-id="${p.id}" type="button" title="Eliminar preselección y volver al estado original">Quitar preselección</button>
            ${!p.calificacion ? `<button class="presel__btn-completar" data-id="${p.id}" type="button">Completar evaluación</button>` : ''}
            <button class="presel__btn-promover" data-id="${p.id}" type="button">Promover a candidato</button>
            <button class="presel__btn-descartar" data-id="${p.id}" type="button">Descartar</button>
          ` : ''}
          ${p.estado === 'promovido' ? `
            <button class="presel__btn-ascender" data-id="${p.id}" type="button">Volver a preselección</button>
            <button class="presel__btn-eliminar" data-id="${p.id}" type="button">Eliminar</button>
          ` : ''}
          ${p.estado === 'descartado' ? `
            <button class="presel__btn-ascender" data-id="${p.id}" type="button">Ascender a preselección</button>
            <button class="presel__btn-eliminar" data-id="${p.id}" type="button">Eliminar</button>
          ` : ''}
        </div>
        <p class="presel__preselec-por">${p.estado === 'descartado' ? 'Descartado por' : 'Preseleccionado por'}: ${p.preseleccionado_por || '—'}</p>
      </div>
    `;
  }

  function grilla() {
    const txt = filtroTexto.toLowerCase();
    const filtrado = lista.filter(p => {
      const okEst   = !filtroEstado || p.estado === filtroEstado;
      const okTxt   = !txt || [p.nombre, p.apellido, p.sector, p.localidad,
                                p.notas_rrhh, p.observacion_postulante, p.puesto_evaluado]
        .some(v => (v || '').toLowerCase().includes(txt));
      const okCal   = !filtroCal   || (p.calificacion != null && p.calificacion >= Number(filtroCal));
      const okExp   = !filtroExp   || p.experiencia_rol === filtroExp;
      const okForm  = !filtroForm  || p.formacion === filtroForm;
      const okEstab = !filtroEstab || p.estabilidad_laboral === filtroEstab;
      return okEst && okTxt && okCal && okExp && okForm && okEstab;
    });
    if (!filtrado.length) return `<p class="presel__sin-resultados">Sin resultados.</p>`;
    return filtrado.map(p => tarjeta(p)).join('');
  }

  const conteos = {
    '':         lista.length,
    activo:     lista.filter(p => p.estado === 'activo').length,
    promovido:  lista.filter(p => p.estado === 'promovido').length,
    descartado: lista.filter(p => p.estado === 'descartado').length,
  };

  contenedor.innerHTML = `
    <div class="presel__wrap">
      <div class="presel__topbar">
        <div class="presel__filtros" role="group" aria-label="Filtrar por estado">
          <button class="presel__ftab presel__ftab--activo" data-estado="activo" type="button">Preselección <span class="presel__ftab-count">${conteos.activo}</span></button>
          <button class="presel__ftab" data-estado="promovido" type="button">Promovidos <span class="presel__ftab-count">${conteos.promovido}</span></button>
          <button class="presel__ftab" data-estado="descartado" type="button">Rechazados <span class="presel__ftab-count">${conteos.descartado}</span></button>
        </div>
        <input type="search" class="presel__busqueda" id="presel-busqueda"
               placeholder="Buscar nombre, sector, observaciones…" autocomplete="off">
      </div>

      <div class="presel__filtros-avanzados" id="presel-filtros-avz">
        <select class="presel__filtro-sel" id="ff-cal">
          <option value="">Calificación</option>
          <option value="5">★★★★★  solo 5</option>
          <option value="4">★★★★  4+</option>
          <option value="3">★★★  3+</option>
          <option value="2">★★  2+</option>
          <option value="1">★  1+</option>
        </select>
        <select class="presel__filtro-sel" id="ff-exp">
          <option value="">Experiencia</option>
          <option value="sin_experiencia">Sin experiencia</option>
          <option value="1_3_años">1 a 3 años</option>
          <option value="3_7_años">3 a 7 años</option>
          <option value="mas_7_años">Más de 7 años</option>
        </select>
        <select class="presel__filtro-sel" id="ff-form">
          <option value="">Formación</option>
          <option value="sin_cert">Sin certificación</option>
          <option value="titulo_tecnico">Título técnico</option>
          <option value="certificado">Certificado</option>
        </select>
        <select class="presel__filtro-sel" id="ff-estab">
          <option value="">Estabilidad</option>
          <option value="alta_rotacion">Alta rotación</option>
          <option value="normal">Normal</option>
          <option value="estable">Estable</option>
        </select>
        <button class="presel__filtro-limpiar" id="ff-limpiar" type="button">✕ Limpiar</button>
      </div>

      <div id="presel-alerta"></div>
      <div class="presel__grilla" id="presel-grilla">
        ${grilla()}
      </div>
    </div>

    <!-- Modal: completar evaluación de preseleccionado existente -->
    <div class="presel__modal-overlay" id="presel-modal-eval" hidden>
      <div class="presel__modal presel__modal--eval" role="dialog" aria-modal="true" aria-labelledby="presel-eval-titulo">
        <h3 class="presel__modal-titulo" id="presel-eval-titulo">Completar evaluación</h3>
        <p class="presel__modal-desc" id="presel-eval-desc"></p>
        <div class="presel__eval-campo">
          <label class="presel__eval-label" for="presel-eval-puesto">Puesto evaluado</label>
          <select class="presel__eval-input" id="presel-eval-puesto">
            <option value="">— Seleccioná —</option>
          </select>
        </div>
        <div class="presel__eval-campo">
          <label class="presel__eval-label">Calificación general</label>
          <div class="presel__estrellas" id="presel-eval-estrellas" role="group" aria-label="Calificación del 1 al 5">
            <button type="button" class="presel__estrella" data-val="1" aria-label="1 estrella">★</button>
            <button type="button" class="presel__estrella" data-val="2" aria-label="2 estrellas">★</button>
            <button type="button" class="presel__estrella" data-val="3" aria-label="3 estrellas">★</button>
            <button type="button" class="presel__estrella" data-val="4" aria-label="4 estrellas">★</button>
            <button type="button" class="presel__estrella" data-val="5" aria-label="5 estrellas">★</button>
          </div>
          <input type="hidden" id="presel-eval-cal" value="">
        </div>
        <div class="presel__eval-campo">
          <label class="presel__eval-label" for="presel-eval-exp">Experiencia en el rol</label>
          <select class="presel__eval-input" id="presel-eval-exp">
            <option value="">— Seleccioná —</option>
            <option value="sin_experiencia">Sin experiencia</option>
            <option value="1_3_años">1 a 3 años</option>
            <option value="3_7_años">3 a 7 años</option>
            <option value="mas_7_años">Más de 7 años</option>
          </select>
        </div>
        <div class="presel__eval-campo">
          <label class="presel__eval-label" for="presel-eval-form">Formación / Certificación</label>
          <select class="presel__eval-input" id="presel-eval-form">
            <option value="">— Seleccioná —</option>
            <option value="sin_cert">Sin certificación</option>
            <option value="titulo_tecnico">Título técnico</option>
            <option value="certificado">Certificado específico</option>
          </select>
        </div>
        <div class="presel__eval-campo">
          <label class="presel__eval-label" for="presel-eval-estab">Estabilidad laboral</label>
          <select class="presel__eval-input" id="presel-eval-estab">
            <option value="">— Seleccioná —</option>
            <option value="alta_rotacion">Alta rotación</option>
            <option value="normal">Normal</option>
            <option value="estable">Estable</option>
          </select>
        </div>
        <div class="presel__modal-footer">
          <button class="presel__btn-cancel" type="button" id="presel-eval-cancel">Cancelar</button>
          <button class="presel__btn-ok" type="button" id="presel-eval-ok">Guardar evaluación</button>
        </div>
      </div>
    </div>

    <!-- Modal: promover a candidato -->
    <div class="presel__modal-overlay" id="presel-modal-promover" hidden>
      <div class="presel__modal" role="dialog" aria-modal="true" aria-labelledby="presel-prom-titulo">
        <h3 class="presel__modal-titulo" id="presel-prom-titulo">Promover a candidato</h3>
        <p class="presel__modal-desc" id="presel-prom-desc"></p>
        <div class="presel__modal-footer">
          <button class="presel__btn-cancel" type="button" id="presel-prom-cancel">Cancelar</button>
          <button class="presel__btn-ok" type="button" id="presel-prom-ok">Promover</button>
        </div>
      </div>
    </div>
  `;

  // ── Filtros ──
  const grillaEl = contenedor.querySelector('#presel-grilla');
  const busqueda = contenedor.querySelector('#presel-busqueda');
  const tabs     = contenedor.querySelectorAll('.presel__ftab');

  function actualizarGrilla() {
    grillaEl.innerHTML = grilla();
    actualizarAlerta();
    bindAcciones();
  }

  busqueda.addEventListener('input', () => { filtroTexto = busqueda.value; actualizarGrilla(); });

  const ffCal   = contenedor.querySelector('#ff-cal');
  const ffExp   = contenedor.querySelector('#ff-exp');
  const ffForm  = contenedor.querySelector('#ff-form');
  const ffEstab = contenedor.querySelector('#ff-estab');
  const ffLimp  = contenedor.querySelector('#ff-limpiar');

  ffCal.addEventListener('change',   () => { filtroCal   = ffCal.value;   actualizarGrilla(); });
  ffExp.addEventListener('change',   () => { filtroExp   = ffExp.value;   actualizarGrilla(); });
  ffForm.addEventListener('change',  () => { filtroForm  = ffForm.value;  actualizarGrilla(); });
  ffEstab.addEventListener('change', () => { filtroEstab = ffEstab.value; actualizarGrilla(); });
  ffLimp.addEventListener('click', () => {
    filtroCal = filtroExp = filtroForm = filtroEstab = filtroTexto = '';
    ffCal.value = ffExp.value = ffForm.value = ffEstab.value = '';
    busqueda.value = '';
    actualizarGrilla();
  });

  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      tabs.forEach(b => b.classList.remove('presel__ftab--activo'));
      btn.classList.add('presel__ftab--activo');
      filtroEstado = btn.dataset.estado;
      actualizarGrilla();
    });
  });

  // ── Modal: completar evaluación ──
  const modalEval  = contenedor.querySelector('#presel-modal-eval');
  const evalDesc   = contenedor.querySelector('#presel-eval-desc');
  const evalEstEl  = contenedor.querySelector('#presel-eval-estrellas');
  const evalCalEl  = contenedor.querySelector('#presel-eval-cal');
  let idEval       = null;

  const cerrarEval = () => { modalEval.hidden = true; idEval = null; };
  contenedor.querySelector('#presel-eval-cancel').addEventListener('click', cerrarEval);
  modalEval.addEventListener('click', e => { if (e.target === modalEval) cerrarEval(); });

  function actualizarEvalEstrellas(val) {
    evalCalEl.value = val > 0 ? val : '';
    evalEstEl.querySelectorAll('.presel__estrella').forEach((b, i) => {
      b.classList.toggle('presel__estrella--activa', i < val);
    });
  }

  evalEstEl.querySelectorAll('.presel__estrella').forEach(btn => {
    btn.addEventListener('click', () => actualizarEvalEstrellas(+btn.dataset.val));
    btn.addEventListener('mouseenter', () => {
      const hv = +btn.dataset.val;
      evalEstEl.querySelectorAll('.presel__estrella').forEach((b, i) => {
        b.classList.toggle('presel__estrella--hover', i < hv);
      });
    });
  });
  evalEstEl.addEventListener('mouseleave', () => {
    evalEstEl.querySelectorAll('.presel__estrella').forEach(b => b.classList.remove('presel__estrella--hover'));
  });

  contenedor.querySelector('#presel-eval-ok').addEventListener('click', async () => {
    if (!evalCalEl.value) { alert('Seleccioná una calificación.'); return; }
    const btn = contenedor.querySelector('#presel-eval-ok');
    btn.disabled = true;
    btn.textContent = 'Guardando…';
    const p = lista.find(x => x.id === idEval);
    try {
      const datos = {
        puesto_evaluado:     contenedor.querySelector('#presel-eval-puesto').value || null,
        calificacion:        Number(evalCalEl.value),
        experiencia_rol:     contenedor.querySelector('#presel-eval-exp').value || null,
        formacion:           contenedor.querySelector('#presel-eval-form').value || null,
        estabilidad_laboral: contenedor.querySelector('#presel-eval-estab').value || null,
      };
      await sbPatch(`preseleccionados?id=eq.${idEval}`, datos);
      Object.assign(p, datos);
      cerrarEval();
      actualizarGrilla();
    } catch (err) {
      alert('Error al guardar:\n' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Guardar evaluación';
    }
  });

  function abrirModalEval(p) {
    idEval = p.id;
    evalDesc.textContent = `${p.apellido || ''}, ${p.nombre || ''} — ${p.sector || ''}`;
    const sectores = [...new Set(lista.map(x => x.sector).filter(Boolean))].sort();
    const puestoSel = contenedor.querySelector('#presel-eval-puesto');
    puestoSel.innerHTML = '<option value="">— Seleccioná —</option>' +
      sectores.map(s => `<option value="${s}">${s}</option>`).join('');
    puestoSel.value = p.puesto_evaluado || p.sector || '';
    actualizarEvalEstrellas(p.calificacion || 0);
    contenedor.querySelector('#presel-eval-exp').value   = p.experiencia_rol || '';
    contenedor.querySelector('#presel-eval-form').value  = p.formacion || '';
    contenedor.querySelector('#presel-eval-estab').value = p.estabilidad_laboral || '';
    modalEval.hidden = false;
  }

  function actualizarAlerta() {
    const alertaEl = contenedor.querySelector('#presel-alerta');
    if (!alertaEl) return;
    const sinEval = lista.filter(p => p.estado === 'activo' && !p.calificacion).length;
    if (!sinEval) { alertaEl.innerHTML = ''; return; }
    alertaEl.innerHTML = `
      <div class="presel__alerta-banner">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        <span><strong>${sinEval} preseleccionado${sinEval > 1 ? 's' : ''} sin evaluación.</strong>
        Usá "Completar evaluación" en cada perfil para registrar los datos.</span>
      </div>
    `;
  }

  // ── Modal promover ──
  const modalProm = contenedor.querySelector('#presel-modal-promover');
  const promDesc  = contenedor.querySelector('#presel-prom-desc');
  let idPromover  = null;

  const cerrarProm = () => { modalProm.hidden = true; idPromover = null; };
  contenedor.querySelector('#presel-prom-cancel').addEventListener('click', cerrarProm);
  modalProm.addEventListener('click', e => { if (e.target === modalProm) cerrarProm(); });

  contenedor.querySelector('#presel-prom-ok').addEventListener('click', async () => {
    const btn = contenedor.querySelector('#presel-prom-ok');
    btn.disabled = true;
    btn.textContent = 'Guardando…';
    const p = lista.find(x => x.id === idPromover);
    try {
      await sbPost('candidatos', {
        preseleccionado_id: p.id,
        solicitud_id:       null,
        nombre:             p.nombre,
        apellido:           p.apellido,
        edad:               p.edad,
        localidad:          p.localidad,
        sector:             p.sector,
        cv_url:             p.cv_url,
        estado:             'en_revision',
      });
      await sbPatch(`preseleccionados?id=eq.${idPromover}`, { estado: 'promovido' });
      p.estado = 'promovido';
      cerrarProm();
      actualizarGrilla();
    } catch (err) {
      alert('Error al promover:\n' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Promover';
    }
  });

  function bindAcciones() {
    contenedor.querySelectorAll('.presel__btn-completar').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = lista.find(x => x.id === btn.dataset.id);
        if (p) abrirModalEval(p);
      });
    });

    contenedor.querySelectorAll('.presel__btn-promover').forEach(btn => {
      btn.addEventListener('click', () => {
        idPromover = btn.dataset.id;
        const p = lista.find(x => x.id === idPromover);
        promDesc.textContent = `${p?.apellido || ''}, ${p?.nombre || ''} — ${p?.sector || ''}`;
        evalForm.reset();
        contenedor.querySelector('#eval-puesto').value = p?.sector || '';
        actualizarEstrellas(0);
        modalProm.hidden = false;
      });
    });

    contenedor.querySelectorAll('.presel__btn-descartar').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const p  = lista.find(x => x.id === id);
        if (!confirm(`¿Descartás a ${p?.apellido || ''} ${p?.nombre || ''}?`)) return;
        btn.disabled = true;
        try {
          await sbPatch(`preseleccionados?id=eq.${id}`, { estado: 'descartado' });
          p.estado = 'descartado';
          actualizarGrilla();
        } catch (_) {
          alert('Error al descartar.');
          btn.disabled = false;
        }
      });
    });

    contenedor.querySelectorAll('.presel__btn-ascender').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const p  = lista.find(x => x.id === id);
        btn.disabled = true;
        try {
          await sbPatch(`preseleccionados?id=eq.${id}`, { estado: 'activo' });
          p.estado = 'activo';
          actualizarGrilla();
        } catch (_) {
          alert('Error al ascender. Intentá de nuevo.');
          btn.disabled = false;
        }
      });
    });

    contenedor.querySelectorAll('.presel__btn-eliminar').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const p  = lista.find(x => x.id === id);
        if (!confirm(`¿Eliminás definitivamente el registro de ${p?.apellido || ''} ${p?.nombre || ''}? Esta acción no se puede deshacer.`)) return;
        btn.disabled = true;
        try {
          await sbDelete(`preseleccionados?id=eq.${id}`);
          lista.splice(lista.indexOf(p), 1);
          actualizarGrilla();
        } catch (_) {
          alert('Error al eliminar. Intentá de nuevo.');
          btn.disabled = false;
        }
      });
    });

    contenedor.querySelectorAll('.presel__btn-quitar').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const p  = lista.find(x => x.id === id);
        if (!confirm(`¿Quitás la preselección de ${p?.apellido || ''} ${p?.nombre || ''}? El registro se elimina y la persona vuelve a aparecer como postulante sin marcar.`)) return;
        btn.disabled = true;
        try {
          await sbDelete(`preseleccionados?id=eq.${id}`);
          lista.splice(lista.indexOf(p), 1);
          actualizarGrilla();
        } catch (_) {
          alert('Error al eliminar. Intentá de nuevo.');
          btn.disabled = false;
        }
      });
    });
  }

  bindAcciones();
  actualizarAlerta();
}

function iniciales(nombre, apellido) {
  const n = (nombre || '')[0] || '';
  const a = (apellido || '')[0] || '';
  return (a + n).toUpperCase() || '?';
}
