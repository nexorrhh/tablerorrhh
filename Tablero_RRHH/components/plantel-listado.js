import { obtenerTabla } from '../data/cliente-supabase.js';

export async function renderizarPlantelListado(contenedor) {
  contenedor.innerHTML = `<p class="plantel__cargando">Cargando listado de empleados…</p>`;

  let empleados;
  try {
    empleados = await obtenerTabla(
      'v_empleados_activos',
      'legajo,apellido_y_nombre,empresa,desc_puesto'
    );
    empleados.forEach(e => { e.desc_puesto = normalizarPuesto(e.desc_puesto); });
    empleados.sort((a, b) => {
      if (a.empresa !== b.empresa) return a.empresa.localeCompare(b.empresa);
      return (a.apellido_y_nombre || '').localeCompare(b.apellido_y_nombre || '');
    });
  } catch (e) {
    contenedor.innerHTML = `
      <div class="estado-vacio">
        <div class="estado-vacio__icono">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
        <h3 class="estado-vacio__titulo">Error al cargar listado</h3>
        <p class="estado-vacio__texto">No se pudo obtener el listado de empleados. Verificá la conexión con Supabase.</p>
      </div>
    `;
    return;
  }

  const puestosUnicos = [...new Set(
    empleados.map(e => e.desc_puesto).filter(Boolean).map(p => p.trim())
  )].sort();

  const cimometCount = empleados.filter(e => e.empresa === 'CIMOMET').length;
  const comoingCount = empleados.filter(e => e.empresa === 'COMOING').length;

  contenedor.innerHTML = `
    <div class="plantel">

      <div class="plantel__filtros">
        <input type="search" class="plantel__busqueda" placeholder="Buscar por nombre…"
               id="plantel-busqueda" autocomplete="off">

        <div class="plantel__empresa-pills" role="group" aria-label="Filtrar por empresa">
          <button class="plantel__pill plantel__pill--activo" data-empresa="">
            Todos&ensp;<span class="plantel__pill-count">${empleados.length}</span>
          </button>
          <button class="plantel__pill plantel__pill--cimomet" data-empresa="CIMOMET">
            Cimomet&ensp;<span class="plantel__pill-count">${cimometCount}</span>
          </button>
          <button class="plantel__pill plantel__pill--comoing" data-empresa="COMOING">
            Co.mo.ing&ensp;<span class="plantel__pill-count">${comoingCount}</span>
          </button>
        </div>

        <select class="plantel__select-puesto" id="plantel-puesto">
          <option value="">Todos los puestos</option>
          ${puestosUnicos.map(p => `<option value="${p}">${p}</option>`).join('')}
        </select>
      </div>

      <p class="plantel__conteo" id="plantel-conteo">
        ${empleados.length} empleados
      </p>

      <div class="plantel__grilla" id="plantel-grilla">
        ${empleados.map(tarjetaEmpleado).join('')}
      </div>

    </div>
  `;

  // ── Interactividad ──
  let filtroEmpresa = '';
  const inputBusqueda = contenedor.querySelector('#plantel-busqueda');
  const selectPuesto  = contenedor.querySelector('#plantel-puesto');
  const pills         = contenedor.querySelectorAll('.plantel__pill');
  const grilla        = contenedor.querySelector('#plantel-grilla');
  const conteoEl      = contenedor.querySelector('#plantel-conteo');

  function filtrar() {
    const texto  = inputBusqueda.value.toLowerCase().trim();
    const puesto = selectPuesto.value;

    const visibles = empleados.filter(e => {
      const okEmpresa = !filtroEmpresa || e.empresa === filtroEmpresa;
      const okPuesto  = !puesto || (e.desc_puesto || '').trim() === puesto;
      const okTexto   = !texto  || (e.apellido_y_nombre || '').toLowerCase().includes(texto);
      return okEmpresa && okPuesto && okTexto;
    });

    grilla.innerHTML = visibles.length
      ? visibles.map(tarjetaEmpleado).join('')
      : `<p class="plantel__sin-resultados">Sin resultados para la búsqueda.</p>`;

    const n = visibles.length;
    conteoEl.textContent = `${n} empleado${n !== 1 ? 's' : ''}`;
  }

  inputBusqueda.addEventListener('input', filtrar);
  selectPuesto.addEventListener('change', filtrar);

  pills.forEach(btn => {
    btn.addEventListener('click', () => {
      filtroEmpresa = btn.dataset.empresa;
      pills.forEach(b => b.classList.remove('plantel__pill--activo'));
      btn.classList.add('plantel__pill--activo');
      filtrar();
    });
  });
}

function tarjetaEmpleado({ legajo, apellido_y_nombre, empresa, desc_puesto }) {
  const esCimomet = empresa === 'CIMOMET';
  const inis      = iniciales(apellido_y_nombre);
  return `
    <div class="plantel__empleado-card">
      <div class="plantel__empleado-avatar plantel__empleado-avatar--${esCimomet ? 'cimomet' : 'comoing'}"
           aria-hidden="true">${inis}</div>
      <div class="plantel__empleado-info">
        <p class="plantel__empleado-nombre">${apellido_y_nombre || '—'}</p>
        <p class="plantel__empleado-puesto">${desc_puesto || '—'}</p>
      </div>
      <div class="plantel__empleado-meta">
        <span class="plantel__badge plantel__badge--${esCimomet ? 'cimomet' : 'comoing'}">
          ${esCimomet ? 'Cimomet' : 'Co.mo.ing'}
        </span>
        <span class="plantel__legajo">#${legajo}</span>
      </div>
    </div>
  `;
}

function normalizarPuesto(raw) {
  const p = (raw || 'Sin puesto').trim();
  if (p.toLowerCase() === 'rrhh') return 'RRHH';
  return p;
}

// "Apellido, Nombre" → primeras letras de apellido y nombre
function iniciales(nombreCompleto) {
  if (!nombreCompleto) return '?';
  const partes = nombreCompleto.split(',');
  const ape = partes[0]?.trim()[0] || '';
  const nom = partes[1]?.trim()[0] || '';
  return (ape + nom).toUpperCase() || '?';
}
