import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../data/fuentes.js';

const HDR = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
  'Content-Type': 'application/json',
};

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: HDR });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function sbMutate(method, path, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { ...HDR, Prefer: 'return=minimal' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
}

export async function renderizarSabadosMarcar(contenedor) {
  let citaciones       = [];
  let detalleActual    = [];
  let citacionActual   = null;
  let empleadosActivos = [];
  let borrarIds        = [];
  let toastTimer       = null;

  contenedor.innerHTML = `<p class="plantel__cargando">Cargando citaciones…</p>`;

  // ── Carga inicial ──────────────────────────────────────────────────────────
  try {
    const data = await sbGet(
      'citaciones?select=id,fecha,tipo,dia_semana,citacion_detalle(situacion)&order=fecha.desc'
    );
    citaciones = data.map(mapCitacion);
  } catch (e) {
    contenedor.innerHTML = errorHtml('No se pudieron cargar las citaciones.');
    return;
  }

  // Empleados activos en segundo plano (necesarios para el modal)
  sbGet('empleados?select=legajo,empresa,apellido_y_nombre,desc_puesto&activo=eq.true&order=apellido_y_nombre.asc&limit=2000')
    .then(d => { empleadosActivos = d; })
    .catch(() => {});

  mostrarBandeja();

  // ── VISTA: BANDEJA ─────────────────────────────────────────────────────────
  function mostrarBandeja() {
    const pend = citaciones.filter(c => !c.completa);
    const comp = citaciones.filter(c => c.completa);

    contenedor.innerHTML = `
      <div class="smark">
        <div class="smark__banda">
          <p class="smark__stitle">
            Pendientes de marcar
            <span class="smark__pill">${pend.length}</span>
          </p>
          <div class="smark__cards">
            ${pend.length
              ? pend.map(htmlCard).join('')
              : `<div class="smark__empty">
                   <svg width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                   No hay citaciones pendientes de marcar
                 </div>`}
          </div>
          <p class="smark__stitle" style="margin-top:28px">Completadas</p>
          <div class="smark__cards">
            ${comp.length
              ? comp.map(htmlCard).join('')
              : `<div class="smark__empty" style="padding:24px;font-size:0.875rem">
                   Sin citaciones completadas todavía
                 </div>`}
          </div>
        </div>
      </div>
    `;

    contenedor.querySelectorAll('[data-cita-id]').forEach(el => {
      el.addEventListener('click', () => abrirCitacion(el.dataset.citaId));
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirCitacion(el.dataset.citaId); }
      });
    });
  }

  // ── ELIMINAR OPERATIVO ─────────────────────────────────────────────────────
  async function eliminarCitacionActual() {
    const label = `${fmtFecha(citacionActual.fecha)} · ${citacionActual.tipo}`;
    if (!confirm(`¿Eliminar el operativo "${label}"?\n\nSe borrarán todos los registros de asistencia. Esta acción no se puede deshacer.`)) return;
    const btn = contenedor.querySelector('#smark-btn-eliminar');
    if (btn) { btn.disabled = true; btn.textContent = 'Eliminando…'; }
    try {
      await sbMutate('DELETE', `citacion_detalle?citacion_id=eq.${citacionActual.id}`);
      await sbMutate('DELETE', `citaciones?id=eq.${citacionActual.id}`);
      const data = await sbGet('citaciones?select=id,fecha,tipo,dia_semana,citacion_detalle(situacion)&order=fecha.desc');
      citaciones = data.map(mapCitacion);
      citacionActual = null;
      mostrarToast('Operativo eliminado', 'ok');
      mostrarBandeja();
    } catch (e) {
      mostrarToast('Error al eliminar: ' + e.message, 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Eliminar operativo'; }
    }
  }

  // ── ABRIR CITACIÓN ─────────────────────────────────────────────────────────
  async function abrirCitacion(id) {
    citacionActual = citaciones.find(c => c.id === id);
    borrarIds = [];
    contenedor.innerHTML = `<p class="plantel__cargando">Cargando detalle…</p>`;

    try {
      detalleActual = await sbGet(
        `citacion_detalle?select=*&citacion_id=eq.${id}&order=apellido_y_nombre.asc`
      );
      detalleActual.forEach(d => { d.es_no_convocado = d.situacion === 'No convocado'; });
    } catch (e) {
      contenedor.innerHTML = errorHtml('No se pudo cargar el detalle de la citación.');
      return;
    }

    mostrarDetalle();
  }

  // ── VISTA: DETALLE ─────────────────────────────────────────────────────────
  function mostrarDetalle() {
    const titulo = `${fmtFecha(citacionActual.fecha)} · ${citacionActual.tipo}`;
    const subtit = `${citacionActual.dia || ''} · ${detalleActual.filter(d => !d.es_no_convocado).length} personas citadas`;

    contenedor.innerHTML = `
      <div class="smark">
        <div class="smark__det-header">
          <button class="smark__back-btn" id="smark-back">
            <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            Volver
          </button>
          <button class="smark__btn smark__btn--eliminar" id="smark-btn-eliminar" title="Eliminar este operativo y todos sus registros">
            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24" aria-hidden="true">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
            Eliminar operativo
          </button>
          <div>
            <div class="smark__det-titulo">${titulo}</div>
            <div class="smark__det-sub">${subtit}</div>
          </div>
          <div class="smark__bulk">
            <input type="file" id="smark-file-input" accept=".txt" style="display:none" aria-hidden="true">
            <button class="smark__btn smark__btn--importar" id="smark-importar"
                    title="Cargar archivo de fichadas (.txt) para marcar presentes automáticamente">
              <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              Importar fichadas
            </button>
            <button class="smark__btn smark__btn--agregar" id="smark-agregar">
              <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Agregar persona
            </button>
            <button class="smark__btn smark__btn--todos" id="smark-todos">
              <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>
              Todos presentes
            </button>
            <button class="smark__btn" id="smark-reiniciar">Reiniciar</button>
          </div>
        </div>

        <div class="smark__tabla-wrap">
          <table class="smark__tabla">
            <thead>
              <tr>
                <th style="width:70px">Legajo</th>
                <th>Apellido y nombre</th>
                <th style="width:90px">Empresa</th>
                <th>Puesto</th>
                <th style="width:90px">Turno</th>
                <th class="smark__th-center" style="min-width:240px">Situación</th>
              </tr>
            </thead>
            <tbody id="smark-tbody"></tbody>
          </table>
        </div>

        <div class="smark__action-bar">
          <div class="smark__bar-info">
            <span><b id="smark-cnt-pre">0</b> presentes</span>
            <span><b id="smark-cnt-aus">0</b> ausentes</span>
            <span><b id="smark-cnt-noc">0</b> no convocados</span>
            <span><b id="smark-cnt-pen">0</b> sin marcar</span>
          </div>
          <div style="margin-left:auto">
            <button class="smark__btn smark__btn--guardar" id="smark-guardar">
              <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/></svg>
              Guardar asistencia
            </button>
          </div>
        </div>

        <!-- Modal agregar persona -->
        <div class="smark__modal-overlay" id="smark-modal" hidden>
          <div class="smark__modal" role="dialog" aria-modal="true" aria-labelledby="smark-modal-tit">
            <h2 class="smark__modal-titulo" id="smark-modal-tit">Agregar persona</h2>
            <p class="smark__modal-sub">
              Se agrega como <strong>No convocado</strong>. Desde la lista podés promoverlo a Convocado si corresponde.
            </p>
            <div class="smark__modal-search">
              <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
              <input type="search" id="smark-modal-buscar" placeholder="Buscar por apellido…" autocomplete="off">
            </div>
            <div class="smark__modal-lista" id="smark-modal-lista"></div>
            <div class="smark__modal-footer">
              <button class="smark__btn" id="smark-modal-cerrar">Cerrar</button>
            </div>
          </div>
        </div>
      </div>
    `;

    renderTbody();

    // Enlazar eventos
    contenedor.querySelector('#smark-back').addEventListener('click', mostrarBandeja);
    contenedor.querySelector('#smark-btn-eliminar').addEventListener('click', eliminarCitacionActual);
    contenedor.querySelector('#smark-todos').addEventListener('click', () => {
      detalleActual.forEach(d => { if (!d.es_no_convocado) d.situacion = 'Presente'; });
      renderTbody();
    });
    contenedor.querySelector('#smark-reiniciar').addEventListener('click', () => {
      detalleActual.forEach(d => { if (!d.es_no_convocado) d.situacion = 'Convocado'; });
      renderTbody();
    });
    contenedor.querySelector('#smark-guardar').addEventListener('click', guardarAsistencia);
    contenedor.querySelector('#smark-agregar').addEventListener('click', abrirModal);

    // ── Importar fichadas desde archivo .txt ──
    const fileInput = contenedor.querySelector('#smark-file-input');
    contenedor.querySelector('#smark-importar').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const archivo = fileInput.files[0];
      if (!archivo) return;
      const reader = new FileReader();
      reader.onload = e => {
        importarFichadas(e.target.result);
        fileInput.value = ''; // permite volver a importar el mismo archivo
      };
      reader.readAsText(archivo, 'UTF-8');
    });
    contenedor.querySelector('#smark-modal-cerrar').addEventListener('click', cerrarModal);
    contenedor.querySelector('#smark-modal').addEventListener('click', e => {
      if (e.target === contenedor.querySelector('#smark-modal')) cerrarModal();
    });
    contenedor.querySelector('#smark-modal-buscar').addEventListener('input', renderListaModal);
  }

  // ── Render del tbody ───────────────────────────────────────────────────────
  function renderTbody() {
    const tbody   = contenedor.querySelector('#smark-tbody');
    if (!tbody) return;

    const citados = detalleActual.filter(d => !d.es_no_convocado);
    const noConv  = detalleActual.filter(d => d.es_no_convocado);

    let html = citados.map(d => htmlFilaCitado(d, detalleActual.indexOf(d))).join('');

    if (noConv.length) {
      html += `<tr class="smark__sep-row">
        <td colspan="6">
          <div class="smark__sep-label">
            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>
            No convocados — vinieron sin citación (${noConv.length})
          </div>
        </td>
      </tr>`;
      html += noConv.map(d => htmlFilaNoConv(d, detalleActual.indexOf(d))).join('');
    }

    tbody.innerHTML = html;
    actualizarBar();

    tbody.querySelectorAll('.smark__seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = +btn.dataset.idx;
        const sit = btn.dataset.sit;
        const d   = detalleActual[idx];
        if (!d || d.es_no_convocado) return;
        d.situacion = d.situacion === sit ? 'Convocado' : sit;
        renderTbody();
      });
    });

    tbody.querySelectorAll('.smark__promover-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = +btn.dataset.idx;
        const d   = detalleActual[idx];
        if (!d) return;
        d.situacion      = 'Convocado';
        d.es_no_convocado = false;
        detalleActual.sort((a, b) => (a.apellido_y_nombre || '').localeCompare(b.apellido_y_nombre || ''));
        renderTbody();
        mostrarToast(`${d.apellido_y_nombre} promovido a convocado`);
      });
    });

    tbody.querySelectorAll('.smark__quitar-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = +btn.dataset.idx;
        const d   = detalleActual[idx];
        if (!d) return;
        if (d.id) borrarIds.push(d.id);
        const nombre = d.apellido_y_nombre;
        detalleActual.splice(idx, 1);
        renderTbody();
        mostrarToast(`${nombre} quitado de la lista`);
      });
    });
  }

  // ── Barra de conteos ───────────────────────────────────────────────────────
  function actualizarBar() {
    const cnt = sit => detalleActual.filter(d => d.situacion === sit).length;
    const set = (id, v) => { const el = contenedor.querySelector(id); if (el) el.textContent = v; };
    set('#smark-cnt-pre', cnt('Presente'));
    set('#smark-cnt-aus', cnt('Ausente'));
    set('#smark-cnt-noc', cnt('No convocado'));
    set('#smark-cnt-pen', cnt('Convocado'));
  }

  // ── Modal ──────────────────────────────────────────────────────────────────
  function abrirModal() {
    const modal = contenedor.querySelector('#smark-modal');
    const input = contenedor.querySelector('#smark-modal-buscar');
    if (!modal) return;
    modal.hidden = false;
    input.value  = '';
    renderListaModal();
    setTimeout(() => input.focus(), 60);
  }

  function cerrarModal() {
    const modal = contenedor.querySelector('#smark-modal');
    if (modal) modal.hidden = true;
  }

  function renderListaModal() {
    const input = contenedor.querySelector('#smark-modal-buscar');
    const lista = contenedor.querySelector('#smark-modal-lista');
    if (!lista) return;

    const txt     = normTxt(input?.value || '');
    const yaEstan = new Set(detalleActual.map(d => d.legajo + '|' + d.empresa));

    const filtrados = empleadosActivos
      .filter(e => {
        if (yaEstan.has(e.legajo + '|' + e.empresa)) return false;
        return !txt || normTxt(e.apellido_y_nombre).includes(txt);
      })
      .slice(0, 80);

    if (!filtrados.length) {
      lista.innerHTML = `<div class="smark__modal-empty">Sin coincidencias (o ya están todos en la citación)</div>`;
      return;
    }

    lista.innerHTML = filtrados.map(e => {
      const emp = e.empresa === 'CIMOMET' ? 'Cimomet' : 'Co.mo.ing';
      return `<div class="smark__modal-item">
        <span class="smark__modal-legajo">${e.legajo}</span>
        <span class="smark__modal-nombre">${e.apellido_y_nombre}</span>
        <span class="smark__modal-puesto">${emp} · ${e.desc_puesto || ''}</span>
        <div class="smark__modal-acciones">
          <button class="smark__modal-btn smark__modal-btn--nocit"
                  data-legajo="${e.legajo}" data-empresa="${e.empresa}" type="button">
            + Agregar
          </button>
        </div>
      </div>`;
    }).join('');

    lista.querySelectorAll('.smark__modal-btn--nocit').forEach(btn => {
      btn.addEventListener('click', () => agregarNoConvocado(btn.dataset.legajo, btn.dataset.empresa));
    });
  }

  function agregarConvocado(legajo, empresa) {
    const e = empleadosActivos.find(x => x.legajo === legajo && x.empresa === empresa);
    if (!e) return;
    detalleActual.push({
      id: null,
      citacion_id:       citacionActual.id,
      legajo:            e.legajo,
      empresa:           e.empresa,
      apellido_y_nombre: e.apellido_y_nombre,
      desc_puesto:       e.desc_puesto,
      turno_manana:      false,
      turno_tarde:       false,
      ot:                null,
      trabajo:           null,
      situacion:         'Convocado',
      es_no_convocado:   false,
    });
    detalleActual.sort((a, b) => (a.apellido_y_nombre || '').localeCompare(b.apellido_y_nombre || ''));
    renderTbody();
    renderListaModal();
    mostrarToast(`${e.apellido_y_nombre} agregado como convocado`);
  }

  function agregarNoConvocado(legajo, empresa) {
    const e = empleadosActivos.find(x => x.legajo === legajo && x.empresa === empresa);
    if (!e) return;
    detalleActual.push({
      id: null,
      citacion_id:      citacionActual.id,
      legajo:           e.legajo,
      empresa:          e.empresa,
      apellido_y_nombre: e.apellido_y_nombre,
      desc_puesto:      e.desc_puesto,
      turno_manana:     false,
      turno_tarde:      false,
      ot:               null,
      trabajo:          null,
      situacion:        'No convocado',
      es_no_convocado:  true,
    });
    detalleActual.sort((a, b) => (a.apellido_y_nombre || '').localeCompare(b.apellido_y_nombre || ''));
    renderTbody();
    renderListaModal();
    mostrarToast(`${e.apellido_y_nombre} agregado sin citar`);
  }

  // ── Importar fichadas ──────────────────────────────────────────────────────
  // Formato esperado: Nombre,Apellido;Legajo;DD/MM/YYYY;HH:MM  (una fila por línea)
  // Solo se usa el legajo (campo índice 1). El archivo nunca se envía al servidor.
  //
  // Reglas:
  //   · Citado Y fichó           → Presente
  //   · Citado Y NO fichó        → Ausente
  //   · Fichó Y no estaba citado → se agrega como No convocado
  //
  // Nota: el reloj fichador puede agregar el prefijo '10' a legajos que en la base
  // se guardan sin él (ej: BD=282 → fichada=10282; BD=56 → fichada=10056).
  // La función fichoEn() prueba ambas formas para no depender del formato del reloj.
  function importarFichadas(texto) {
    const limpio = texto.replace(/^﻿/, ''); // quitar BOM UTF-8 si lo trae el archivo
    const lineas = limpio.split(/\r?\n/).filter(l => l.trim());

    const legajosArchivo = new Set(
      lineas.map(l => (l.split(';')[1] || '').trim()).filter(Boolean)
    );

    if (!legajosArchivo.size) {
      mostrarToast('El archivo no contiene legajos reconocibles', 'error');
      return;
    }

    // El reloj fichador codifica los legajos como '10' + legajo con 3 dígitos mínimo:
    //   BD=282  → '10282'   BD=62 → '10062'   BD=56 → '10056'
    // Los legajos "viejos" (1, 10, 23, 94, 1004...) coinciden directo sin prefijo.
    const conPrefijo = l => '10' + l.padStart(3, '0');

    // ¿Un legajo de la BD aparece en el archivo?
    const fichoEn = legajoBD => {
      const l = String(legajoBD).trim();
      return legajosArchivo.has(l) || legajosArchivo.has(conPrefijo(l));
    };

    // ¿Un legajo del archivo ya está en detalleActual (en cualquier formato)?
    const estaEnDetalle = legajoArchivo => detalleActual.some(d => {
      const l = String(d.legajo).trim();
      return l === legajoArchivo || conPrefijo(l) === legajoArchivo;
    });

    // ¿Un legajo del archivo existe en el padrón de empleados activos?
    const buscarEmpleado = legajoArchivo => empleadosActivos.find(e => {
      const l = String(e.legajo).trim();
      return l === legajoArchivo || conPrefijo(l) === legajoArchivo;
    });

    // 1. Marcar presentes o ausentes a los citados según el archivo
    let presentes = 0, ausentes = 0;
    detalleActual.forEach(d => {
      if (d.es_no_convocado) return;
      if (fichoEn(d.legajo)) { d.situacion = 'Presente'; presentes++; }
      else                   { d.situacion = 'Ausente';  ausentes++;  }
    });

    // 2. Quienes ficharon pero no estaban citados → agregar como No convocado
    let agregados = 0, desconocidos = 0;
    legajosArchivo.forEach(legajo => {
      if (estaEnDetalle(legajo)) return;
      const emp = buscarEmpleado(legajo);
      if (!emp) { desconocidos++; return; }
      detalleActual.push({
        id:                null,
        citacion_id:       citacionActual.id,
        legajo:            emp.legajo,
        empresa:           emp.empresa,
        apellido_y_nombre: emp.apellido_y_nombre,
        desc_puesto:       emp.desc_puesto,
        turno_manana:      false,
        turno_tarde:       false,
        ot:                null,
        trabajo:           null,
        situacion:         'No convocado',
        es_no_convocado:   true,
      });
      agregados++;
    });

    if (agregados > 0) {
      detalleActual.sort((a, b) => (a.apellido_y_nombre || '').localeCompare(b.apellido_y_nombre || ''));
    }

    renderTbody();

    const partes = [
      `${presentes} presentes`,
      `${ausentes} ausentes`,
      agregados    ? `${agregados} no convocados agregados`     : null,
      desconocidos ? `${desconocidos} legajos sin coincidencia` : null,
    ].filter(Boolean).join(' · ');
    mostrarToast(partes, 'ok');
  }

  // ── Guardar ────────────────────────────────────────────────────────────────
  async function guardarAsistencia() {
    const btn = contenedor.querySelector('#smark-guardar');
    if (btn) btn.disabled = true;

    try {
      // Borrar no convocados quitados
      for (const id of borrarIds) {
        await sbMutate('DELETE', `citacion_detalle?id=eq.${id}`);
      }
      borrarIds = [];

      // Insertar nuevos no convocados
      const nuevos = detalleActual.filter(d => !d.id);
      if (nuevos.length) {
        await sbMutate('POST', 'citacion_detalle', nuevos.map(d => ({
          citacion_id:      d.citacion_id,
          legajo:           d.legajo,
          empresa:          d.empresa,
          apellido_y_nombre: d.apellido_y_nombre,
          desc_puesto:      d.desc_puesto,
          turno_manana:     false,
          turno_tarde:      false,
          ot:               null,
          trabajo:          null,
          situacion:        d.situacion,
        })));
      }

      // Actualizar situación en registros existentes
      for (const d of detalleActual.filter(x => x.id)) {
        await sbMutate('PATCH', `citacion_detalle?id=eq.${d.id}`, { situacion: d.situacion });
      }

      mostrarToast('Asistencia guardada', 'ok');

      // Refrescar bandeja
      const data = await sbGet(
        'citaciones?select=id,fecha,tipo,dia_semana,citacion_detalle(situacion)&order=fecha.desc'
      );
      citaciones = data.map(mapCitacion);
      mostrarBandeja();

    } catch (e) {
      mostrarToast('Error al guardar: ' + e.message, 'error');
      if (btn) btn.disabled = false;
    }
  }

  // ── Toast ──────────────────────────────────────────────────────────────────
  function mostrarToast(msg, tipo = '') {
    let toast = contenedor.querySelector('.smark__toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'smark__toast';
      contenedor.appendChild(toast);
    }
    toast.textContent = msg;
    toast.className = `smark__toast smark__toast--show${tipo ? ' smark__toast--' + tipo : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.className = 'smark__toast'; }, 3000);
  }
}

// ── Helpers HTML (fuera del closure para no recrearlas en cada render) ─────────

function mapCitacion(c) {
  const det      = c.citacion_detalle || [];
  const total    = det.length;
  const pendientes = det.filter(d => d.situacion === 'Convocado').length;
  const presentes  = det.filter(d => d.situacion === 'Presente').length;
  return {
    id: c.id, fecha: c.fecha, tipo: c.tipo, dia: c.dia_semana,
    total, pendientes, presentes,
    completa: total > 0 && pendientes === 0,
  };
}

function htmlCard(c) {
  const pendiente = !c.completa;
  const tipoCls   = c.tipo === 'Sabado'  ? 'smark__tipo-tag--sab'
                  : c.tipo === 'Domingo' ? 'smark__tipo-tag--dom'
                  : 'smark__tipo-tag--fer';
  const tipoLbl   = c.tipo === 'Sabado' ? 'Sábado' : c.tipo;
  return `
    <div class="smark__card ${pendiente ? 'smark__card--pend' : 'smark__card--comp'}"
         data-cita-id="${c.id}" tabindex="0" role="button"
         aria-label="Citación ${fmtFecha(c.fecha)}, ${pendiente ? 'pendiente' : 'completa'}">
      <div class="smark__card-badge">
        <span class="smark__estado ${pendiente ? 'smark__estado--pend' : 'smark__estado--comp'}">
          ${pendiente ? 'Pendiente' : 'Completa'}
        </span>
      </div>
      <div class="smark__card-top">
        <div class="smark__card-fecha">${fmtFecha(c.fecha)}</div>
        <div class="smark__card-dia">${c.dia || ''} · ${c.fecha}</div>
      </div>
      <div><span class="smark__tipo-tag ${tipoCls}">${tipoLbl}</span></div>
      <div class="smark__card-stats">
        <div class="smark__cstat"><strong>${c.total}</strong><span>Citados</span></div>
        <div class="smark__cstat smark__cstat--pre"><strong>${c.presentes}</strong><span>Presentes</span></div>
        ${pendiente ? `<div class="smark__cstat smark__cstat--pen"><strong>${c.pendientes}</strong><span>Sin marcar</span></div>` : ''}
      </div>
    </div>
  `;
}

function htmlFilaCitado(d, idx) {
  const turno = d.turno_manana && d.turno_tarde ? 'Ambos'
              : d.turno_manana ? '07-12'
              : d.turno_tarde  ? '12-16'
              : '—';
  return `
    <tr>
      <td><span class="smark__legajo">${d.legajo}</span></td>
      <td class="smark__td-nombre">${d.apellido_y_nombre}</td>
      <td>${badgeEmpresa(d.empresa)}</td>
      <td><span class="smark__badge-puesto">${d.desc_puesto || '—'}</span></td>
      <td><span class="smark__turno">${turno}</span></td>
      <td class="smark__td-center">
        <div class="smark__seg">
          <button class="smark__seg-btn ${d.situacion === 'Presente' ? 'smark__seg-btn--pre' : ''}"
                  data-idx="${idx}" data-sit="Presente">Presente</button>
          <button class="smark__seg-btn ${d.situacion === 'Ausente'  ? 'smark__seg-btn--aus' : ''}"
                  data-idx="${idx}" data-sit="Ausente">Ausente</button>
        </div>
        <button class="smark__quitar-btn smark__quitar-citado-btn" data-idx="${idx}"
                title="Quitar de los convocados" aria-label="Quitar a ${d.apellido_y_nombre}">
          <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </td>
    </tr>
  `;
}

function htmlFilaNoConv(d, idx) {
  return `
    <tr class="smark__noconv-row">
      <td><span class="smark__legajo">${d.legajo}</span></td>
      <td class="smark__td-nombre">${d.apellido_y_nombre}</td>
      <td>${badgeEmpresa(d.empresa)}</td>
      <td><span class="smark__badge-puesto">${d.desc_puesto || '—'}</span></td>
      <td><span class="smark__turno smark__turno--muted">—</span></td>
      <td class="smark__td-center">
        <button class="smark__promover-btn" data-idx="${idx}" title="Promover a convocado">
          + Convocar
        </button>
        <button class="smark__quitar-btn" data-idx="${idx}" title="Quitar de la lista"
                aria-label="Quitar a ${d.apellido_y_nombre}">
          <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </td>
    </tr>
  `;
}

function badgeEmpresa(empresa) {
  return empresa === 'CIMOMET'
    ? '<span class="plantel__badge plantel__badge--cimomet">Cimomet</span>'
    : '<span class="plantel__badge plantel__badge--comoing">Co.mo.ing</span>';
}

function errorHtml(msg) {
  return `
    <div class="estado-vacio">
      <div class="estado-vacio__icono">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
             stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      </div>
      <h3 class="estado-vacio__titulo">Error al cargar</h3>
      <p class="estado-vacio__texto">${msg}</p>
    </div>
  `;
}

function fmtFecha(f) {
  return new Date(f + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'long' });
}

function normTxt(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
