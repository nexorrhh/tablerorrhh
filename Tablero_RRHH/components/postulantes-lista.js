import { SUPABASE_URL, SUPABASE_ANON_KEY, SHEET_ID_POSTULANTES, SHEET_NOMBRE_POSTULANTES } from '../data/fuentes.js';
import { obtenerUsuario } from '../data/usuario-activo.js';

const GVIZ_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID_POSTULANTES}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(SHEET_NOMBRE_POSTULANTES)}`;
const ADMIN_EMAIL = 'cimolay47@gmail.com';

const HDR = {
  'Content-Type': 'application/json',
  'apikey': SUPABASE_ANON_KEY,
  'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
};

// ── Google Sheets parsing ────────────────────────────────────────────────────

const COL_MAP = [
  ['marca_temporal', ['marca temporal', 'timestamp']],
  ['email',          ['correo electrónico', 'dirección de correo', 'correo', 'e-mail', 'email']],
  ['nombre',         ['nombre']],
  ['apellido',       ['apellido']],
  ['edad',           ['edad']],
  ['localidad',      ['localidad', 'ciudad']],
  ['sector',         ['sector', 'puesto', 'área', 'area']],
  ['cv_url',         ['cv', 'curriculum', 'currículum', 'adjunt']],
  ['observacion_postulante', ['observaci', 'nota']],
];

async function fetchPostulantesSheets() {
  const res = await fetch(GVIZ_URL);
  if (!res.ok) throw new Error('Error HTTP ' + res.status);
  const texto = await res.text();
  const inicio = texto.indexOf('{');
  const fin    = texto.lastIndexOf('}');
  if (inicio === -1 || fin === -1) throw new Error('Respuesta inesperada de Google Sheets');
  const data = JSON.parse(texto.slice(inicio, fin + 1));

  const cols = (data.table?.cols || []).map(c => (c.label || c.id || '').trim().toLowerCase());

  const indices = {};
  COL_MAP.forEach(([campo, candidatos]) => {
    const idx = cols.findIndex(col => candidatos.some(c => col.includes(c)));
    if (idx >= 0) indices[campo] = idx;
  });

  return (data.table?.rows || []).map(row => {
    const c = row.c || [];
    const get = campo => {
      const i = indices[campo];
      if (i === undefined || !c[i]) return null;
      return String(c[i].f ?? c[i].v ?? '').trim() || null;
    };
    return {
      marca_temporal:         get('marca_temporal'),
      email:                  (get('email') || '').toLowerCase(),
      nombre:                 get('nombre') || '',
      apellido:               get('apellido') || '',
      edad:                   get('edad'),
      localidad:              get('localidad') || '',
      sector:                 get('sector') || '',
      cv_url:                 get('cv_url') || '',
      observacion_postulante: get('observacion_postulante') || '',
    };
  }).filter(p => p.nombre || p.apellido);
}

// ── Agrupar por email ────────────────────────────────────────────────────────

function agruparPorEmail(postulantes) {
  const porEmail = new Map();
  const sinAgrupar = [];

  postulantes.forEach(p => {
    const email = (p.email || '').toLowerCase().trim();
    if (!email || email === ADMIN_EMAIL) {
      sinAgrupar.push({ tipo: 'simple', rows: [p], ...p });
      return;
    }
    if (!porEmail.has(email)) porEmail.set(email, []);
    porEmail.get(email).push(p);
  });

  const grupos = [];
  porEmail.forEach((rows, email) => {
    // Ordenar por fecha más reciente primero
    rows.sort((a, b) => (b.marca_temporal || '').localeCompare(a.marca_temporal || ''));
    const reciente = rows[0];
    const sectores = [...new Set(rows.map(r => r.sector).filter(Boolean))];
    const cvUrl    = rows.find(r => r.cv_url)?.cv_url || '';
    grupos.push({
      tipo:                   rows.length > 1 ? 'agrupado' : 'simple',
      rows,
      email,
      nombre:                 reciente.nombre,
      apellido:               reciente.apellido,
      edad:                   reciente.edad,
      localidad:              reciente.localidad,
      sectores,
      sector:                 reciente.sector,
      cv_url:                 cvUrl,
      marca_temporal:         reciente.marca_temporal,
      observacion_postulante: reciente.observacion_postulante,
    });
  });

  // Combinar ambos grupos; los individuales van intercalados por fecha
  return [...grupos, ...sinAgrupar].sort((a, b) =>
    (b.marca_temporal || '').localeCompare(a.marca_temporal || '')
  );
}

// ── Supabase helpers ─────────────────────────────────────────────────────────

// Devuelve Map<marca_temporal, estado> para todos los preseleccionados
async function obtenerEstadosPreseleccionados() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/preseleccionados?select=marca_temporal,estado`,
    { headers: HDR }
  );
  if (!res.ok) return new Map();
  const data = await res.json();
  return new Map(data.map(d => [d.marca_temporal, d.estado]));
}

async function sbPost(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: { ...HDR, 'Prefer': 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
}

// ── Componente ───────────────────────────────────────────────────────────────

export async function renderizarPostulantesLista(contenedor) {
  contenedor.innerHTML = `<p class="plista__cargando">Cargando postulantes del formulario…</p>`;

  let items  = [];
  let estadosPresel = new Map();

  try {
    const [postulantes, estadosMap] = await Promise.all([
      fetchPostulantesSheets(),
      obtenerEstadosPreseleccionados(),
    ]);
    items         = agruparPorEmail(postulantes);
    estadosPresel = estadosMap;
  } catch (e) {
    contenedor.innerHTML = `
      <div class="estado-vacio">
        <h3 class="estado-vacio__titulo">Error al cargar</h3>
        <p class="estado-vacio__texto">No se pudo obtener la lista de postulantes. Verificá que la planilla sea accesible.</p>
      </div>`;
    return;
  }

  // Obtener todos los sectores únicos para los filtros
  const sectoresUnicos = [...new Set(items.flatMap(it => it.sectores || [it.sector]).filter(Boolean))].sort();

  let filtroTexto  = '';
  let filtroSector = '';

  // Verificar si alguna fila del grupo ya fue procesada
  function estadoGrupo(item) {
    const marcas = item.rows.map(r => r.marca_temporal).filter(Boolean);
    for (const m of marcas) {
      const e = estadosPresel.get(m);
      if (e) return e; // 'activo', 'promovido', 'descartado'
    }
    return null;
  }

  function tarjeta(item) {
    const estado   = estadoGrupo(item);
    const agrupado = item.tipo === 'agrupado';
    const sectores = agrupado ? item.sectores : [item.sector].filter(Boolean);
    const idx      = items.indexOf(item);

    let footerHTML = '';
    if (!estado) {
      // Sin procesar: mostrar ambos botones
      footerHTML = `
        ${item.cv_url ? `<a class="plista__cv-link" href="${item.cv_url}" target="_blank" rel="noopener">Ver CV</a>` : ''}
        <button class="plista__btn-archivar" data-idx="${idx}" type="button">Descartar</button>
        <button class="plista__btn-presel" data-idx="${idx}" type="button">Preseleccionar</button>
      `;
    } else if (estado === 'descartado') {
      footerHTML = `
        ${item.cv_url ? `<a class="plista__cv-link" href="${item.cv_url}" target="_blank" rel="noopener">Ver CV</a>` : ''}
        <span class="plista__archivado-label">✕ Descartado</span>
      `;
    } else {
      footerHTML = `
        ${item.cv_url ? `<a class="plista__cv-link" href="${item.cv_url}" target="_blank" rel="noopener">Ver CV</a>` : ''}
        <span class="plista__ya-presel">✓ Preseleccionado/a</span>
      `;
    }

    return `
      <div class="plista__card ${estado === 'descartado' ? 'plista__card--archivado' : ''}">
        <div class="plista__card-head">
          <div class="plista__avatar">${iniciales(item.nombre, item.apellido)}</div>
          <div class="plista__card-info">
            <p class="plista__nombre">
              ${item.apellido ? item.apellido + ', ' : ''}${item.nombre}
              ${agrupado ? `<span class="plista__count-badge">${item.rows.length} postulaciones</span>` : ''}
            </p>
            <p class="plista__meta">${[item.edad ? item.edad + ' años' : null, item.localidad].filter(Boolean).join(' · ')}</p>
          </div>
        </div>
        <div class="plista__sectores-tags">
          ${sectores.map(s => `<span class="plista__sector-tag">${s}</span>`).join('')}
        </div>
        ${item.marca_temporal ? `<p class="plista__fecha">Último envío: ${item.marca_temporal}</p>` : ''}
        ${item.observacion_postulante ? `<p class="plista__obs">${item.observacion_postulante}</p>` : ''}

        ${agrupado ? `
          <div class="plista__postulaciones-wrap">
            <button class="plista__toggle-postulaciones" type="button" aria-expanded="false">
              Ver las ${item.rows.length} postulaciones ▾
            </button>
            <div class="plista__postulaciones-detalle" hidden>
              <table class="plista__post-tabla">
                <thead><tr><th>Fecha</th><th>Sector postulado</th></tr></thead>
                <tbody>
                  ${item.rows.map(r => `
                    <tr>
                      <td class="plista__post-fecha">${r.marca_temporal || '—'}</td>
                      <td>${r.sector || '—'}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}

        <div class="plista__card-foot">
          ${footerHTML}
        </div>
      </div>
    `;
  }

  function listaFiltrada() {
    const txt = filtroTexto.toLowerCase();
    return items.filter(item => {
      if (estadoGrupo(item)) return false; // ya procesado: no aparece en Postulantes
      const sectores = item.sectores || [item.sector];
      const okSector = !filtroSector || sectores.includes(filtroSector);
      const okTexto  = !txt || [item.nombre, item.apellido, item.localidad, ...(item.sectores || [item.sector])]
        .some(v => (v || '').toLowerCase().includes(txt));
      return okSector && okTexto;
    });
  }

  contenedor.innerHTML = `
    <div class="plista__wrap">
      <div class="plista__filtros">
        <input type="search" class="plista__busqueda" id="plista-busqueda"
               placeholder="Buscar por nombre, localidad…" autocomplete="off">
        <div class="plista__sector-pills" role="group" aria-label="Filtrar por sector">
          <button class="plista__pill plista__pill--activo" data-sector="" type="button">Todos</button>
          ${sectoresUnicos.map(s => `
            <button class="plista__pill" data-sector="${s}" type="button">${s}</button>
          `).join('')}
        </div>
      </div>
      <p class="plista__conteo" id="plista-conteo">${items.length} postulante${items.length !== 1 ? 's' : ''}</p>
      <div class="plista__grilla" id="plista-grilla"></div>
    </div>

  `;

  // ── Modales en body (fuera del contenedor scrolleable para evitar saltos de scroll) ──
  document.querySelectorAll('#plista-modal-presel, #plista-modal-archivar').forEach(el => el.remove());

  const _mPresel = document.createElement('div');
  _mPresel.id = 'plista-modal-presel';
  _mPresel.className = 'plista__modal-overlay';
  _mPresel.hidden = true;
  _mPresel.innerHTML = `
    <div class="plista__modal" role="dialog" aria-modal="true" aria-labelledby="plista-presel-titulo">
      <h3 class="plista__modal-titulo" id="plista-presel-titulo">Preseleccionar postulante</h3>
      <div class="plista__modal-info" id="plista-presel-info"></div>
      <label class="plista__modal-label" for="plista-notas">Notas de RRHH</label>
      <textarea class="plista__modal-textarea" id="plista-notas" rows="3"
                placeholder="Observaciones internas (opcional)"></textarea>
      <label class="plista__modal-label" for="plista-presel-por">Preseleccionado por</label>
      <input class="plista__modal-input plista__modal-input--readonly" id="plista-presel-por" type="text"
             autocomplete="off" readonly>
      <div class="plista__modal-footer">
        <button class="plista__btn-cancel" type="button" id="plista-presel-cancel">Cancelar</button>
        <button class="plista__btn-ok" type="button" id="plista-presel-ok">Guardar preselección</button>
      </div>
    </div>
  `;
  document.body.appendChild(_mPresel);

  const _mArch = document.createElement('div');
  _mArch.id = 'plista-modal-archivar';
  _mArch.className = 'plista__modal-overlay';
  _mArch.hidden = true;
  _mArch.innerHTML = `
    <div class="plista__modal" role="dialog" aria-modal="true" aria-labelledby="plista-arch-titulo">
      <h3 class="plista__modal-titulo" id="plista-arch-titulo">Descartar postulante</h3>
      <p class="plista__modal-desc" id="plista-arch-desc"></p>
      <label class="plista__modal-label" for="plista-motivo">Motivo del descarte (opcional)</label>
      <textarea class="plista__modal-textarea" id="plista-motivo" rows="3"
                placeholder="Ej: No tiene el perfil, zona geográfica incompatible, sin experiencia…"></textarea>
      <div class="plista__modal-footer">
        <button class="plista__btn-cancel" type="button" id="plista-arch-cancel">Cancelar</button>
        <button class="plista__btn-archivar-ok" type="button" id="plista-arch-ok">Descartar</button>
      </div>
    </div>
  `;
  document.body.appendChild(_mArch);

  // ── Grilla ──
  const grillaEl = contenedor.querySelector('#plista-grilla');
  const conteoEl = contenedor.querySelector('#plista-conteo');
  const busqueda = contenedor.querySelector('#plista-busqueda');
  const pills    = contenedor.querySelectorAll('.plista__pill');

  function actualizarGrilla() {
    const lista = listaFiltrada();
    conteoEl.textContent = `${lista.length} postulante${lista.length !== 1 ? 's' : ''}`;
    grillaEl.innerHTML = lista.length
      ? lista.map(it => tarjeta(it)).join('')
      : `<p class="plista__sin-resultados">Sin resultados.</p>`;
    bindBotones();
  }

  busqueda.addEventListener('input', () => { filtroTexto = busqueda.value; actualizarGrilla(); });
  pills.forEach(btn => {
    btn.addEventListener('click', () => {
      pills.forEach(b => b.classList.remove('plista__pill--activo'));
      btn.classList.add('plista__pill--activo');
      filtroSector = btn.dataset.sector;
      actualizarGrilla();
    });
  });

  // ── Modal: preseleccionar ──
  const modalPresel  = document.querySelector('#plista-modal-presel');
  const preselInfo   = document.querySelector('#plista-presel-info');
  const notasEl      = document.querySelector('#plista-notas');
  const porEl        = document.querySelector('#plista-presel-por');
  let itemActualPresel = null;

  // Bloquear scroll del contenido detrás del modal mientras está abierto (buena UX).
  const scrollContenido = document.querySelector('.app-contenido');
  const bloquearScroll  = () => { if (scrollContenido) scrollContenido.style.overflow = 'hidden'; };
  const restaurarScroll = () => { if (scrollContenido) scrollContenido.style.overflow = ''; };

  const cerrarPresel = () => { modalPresel.hidden = true; restaurarScroll(); itemActualPresel = null; };
  document.querySelector('#plista-presel-cancel').addEventListener('click', cerrarPresel);
  modalPresel.addEventListener('click', e => { if (e.target === modalPresel) cerrarPresel(); });

  document.querySelector('#plista-presel-ok').addEventListener('click', async () => {
    const por = porEl.value.trim();
    if (!por) { porEl.focus(); return; }
    const btn = document.querySelector('#plista-presel-ok');
    btn.disabled = true;
    btn.textContent = 'Guardando…';
    const p = itemActualPresel;
    try {
      await sbPost('preseleccionados', {
        marca_temporal:         p.marca_temporal || null,
        nombre:                 p.nombre || null,
        apellido:               p.apellido || null,
        edad:                   p.edad ? parseInt(p.edad) : null,
        localidad:              p.localidad || null,
        sector:                 (p.sectores || [p.sector]).filter(Boolean).join(', ') || null,
        cv_url:                 p.cv_url || null,
        observacion_postulante: p.observacion_postulante || null,
        notas_rrhh:             notasEl.value.trim() || null,
        preseleccionado_por:    por,
        estado:                 'activo',
      });
      estadosPresel.set(p.marca_temporal, 'activo');
      cerrarPresel();
      actualizarGrilla();
    } catch (_) {
      alert('Error al guardar. Intentá de nuevo.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Guardar preselección';
    }
  });

  // ── Modal: archivar ──
  const modalArch  = document.querySelector('#plista-modal-archivar');
  const archDesc   = document.querySelector('#plista-arch-desc');
  const motivoEl   = document.querySelector('#plista-motivo');
  let itemActualArch = null;

  const cerrarArch = () => { modalArch.hidden = true; restaurarScroll(); itemActualArch = null; };
  document.querySelector('#plista-arch-cancel').addEventListener('click', cerrarArch);
  modalArch.addEventListener('click', e => { if (e.target === modalArch) cerrarArch(); });

  document.querySelector('#plista-arch-ok').addEventListener('click', async () => {
    const btn = document.querySelector('#plista-arch-ok');
    btn.disabled = true;
    btn.textContent = 'Descartando…';
    const p = itemActualArch;
    try {
      await sbPost('preseleccionados', {
        marca_temporal:         p.marca_temporal || null,
        nombre:                 p.nombre || null,
        apellido:               p.apellido || null,
        edad:                   p.edad ? parseInt(p.edad) : null,
        localidad:              p.localidad || null,
        sector:                 (p.sectores || [p.sector]).filter(Boolean).join(', ') || null,
        cv_url:                 p.cv_url || null,
        observacion_postulante: p.observacion_postulante || null,
        notas_rrhh:             motivoEl.value.trim() || null,
        preseleccionado_por:    obtenerUsuario()?.nombre ?? null,
        estado:                 'descartado',
      });
      estadosPresel.set(p.marca_temporal, 'descartado');
      cerrarArch();
      actualizarGrilla();
    } catch (_) {
      alert('Error al archivar. Intentá de nuevo.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Descartar';
    }
  });

  // ── Bind botones de tarjetas ──
  function bindBotones() {
    // Toggle expandir postulaciones
    contenedor.querySelectorAll('.plista__toggle-postulaciones').forEach(btn => {
      btn.addEventListener('click', () => {
        const detalle  = btn.nextElementSibling;
        const abierto  = !detalle.hidden;
        detalle.hidden = abierto;
        btn.setAttribute('aria-expanded', String(!abierto));
        btn.textContent = abierto
          ? btn.textContent.replace('▴', '▾')
          : btn.textContent.replace('▾', '▴');
      });
    });

    contenedor.querySelectorAll('.plista__btn-presel').forEach(btn => {
      btn.addEventListener('click', () => {
        itemActualPresel = items[Number(btn.dataset.idx)];
        const p = itemActualPresel;
        const sectores = p.sectores || [p.sector].filter(Boolean);
        const notaPrefill = p.tipo === 'agrupado'
          ? `Se postuló ${p.rows.length} veces para: ${sectores.join(', ')}`
          : '';
        notasEl.value = notaPrefill;
        porEl.value   = obtenerUsuario()?.nombre ?? '';
        preselInfo.innerHTML = `
          <p class="plista__modal-nombre">${p.apellido || ''} ${p.nombre || ''}</p>
          <p class="plista__modal-meta">${[sectores.join(' / '), p.edad ? p.edad + ' años' : null, p.localidad].filter(Boolean).join(' · ')}</p>
          ${p.cv_url ? `<a class="plista__modal-cv" href="${p.cv_url}" target="_blank" rel="noopener">Ver CV</a>` : ''}
          ${p.observacion_postulante ? `<p class="plista__modal-obs-post">${p.observacion_postulante}</p>` : ''}
        `;
        bloquearScroll();
        modalPresel.hidden = false;
        porEl.focus({ preventScroll: true });
      });
    });

    contenedor.querySelectorAll('.plista__btn-archivar').forEach(btn => {
      btn.addEventListener('click', () => {
        itemActualArch = items[Number(btn.dataset.idx)];
        const p = itemActualArch;
        const sectores = p.sectores || [p.sector].filter(Boolean);
        archDesc.textContent = `${p.apellido || ''} ${p.nombre || ''} — ${sectores.join(', ')}`;
        motivoEl.value = '';
        bloquearScroll();
        modalArch.hidden = false;
        motivoEl.focus({ preventScroll: true });
      });
    });
  }

  actualizarGrilla();
}

function iniciales(nombre, apellido) {
  const n = (nombre || '')[0] || '';
  const a = (apellido || '')[0] || '';
  return (a + n).toUpperCase() || '?';
}
