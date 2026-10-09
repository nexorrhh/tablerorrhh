// Reemplazo visual (con fade al abrir) de los <select class="escala-select"> usados en las
// escalas Likert de Desempeño (Evaluación aptitudinal/operativa, Cumplimiento de EPP, Calidad
// de trabajo, y los aspectos de Período de prueba).
//
// Los navegadores dibujan la lista de un <select> nativo con el sistema operativo — no se le
// puede aplicar ningún CSS ni transición. Por eso el <select> original se deja en el DOM (oculto
// visualmente, pero sigue siendo la fuente de verdad: se le sigue leyendo `.value` y disparando
// `change` exactamente igual que antes) y se le arma al lado un desplegable propio que sí se
// puede animar.

let idSeq = 0;

export function mejorarSelectsEscala(root) {
  root.querySelectorAll('select.escala-select:not([data-mejorado])').forEach(mejorarUnSelect);
}

function mejorarUnSelect(select) {
  select.dataset.mejorado = '1';
  select.classList.add('escala-select--oculto');
  select.tabIndex = -1;

  const idLista = `escala-lista-${++idSeq}`;
  const wrapper = document.createElement('div');
  wrapper.className = 'escala-desc';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'escala-desc__trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', idLista);

  const lista = document.createElement('div');
  lista.className = 'escala-desc__lista';
  lista.id = idLista;
  lista.setAttribute('role', 'listbox');
  lista.hidden = true;

  function renderTrigger() {
    const op = select.options[select.selectedIndex];
    trigger.textContent = op ? op.textContent : 'Elegir…';
    trigger.classList.toggle('escala-desc__trigger--vacio', select.value === '');
  }

  function renderLista() {
    lista.innerHTML = '';
    [...select.options].forEach(op => {
      if (op.value === '') return; // "Elegir…" no se repite dentro de la lista abierta
      const item = document.createElement('div');
      item.className = 'escala-desc__opcion';
      item.setAttribute('role', 'option');
      item.textContent = op.textContent;
      if (op.value === select.value) item.setAttribute('aria-selected', 'true');
      item.addEventListener('click', () => elegir(op.value));
      lista.appendChild(item);
    });
  }

  function elegir(valor) {
    if (select.value !== valor) {
      select.value = valor;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    renderTrigger();
    cerrar();
  }

  let abierto = false;
  let ocultarTimeout = null;

  function abrir() {
    if (abierto) return;
    clearTimeout(ocultarTimeout);
    renderLista();
    lista.hidden = false;
    // El siguiente frame, para que el navegador aplique el estado inicial (opacidad 0) antes de
    // animar hacia el estado abierto — si se agrega la clase en el mismo frame no hay transición.
    requestAnimationFrame(() => lista.classList.add('escala-desc__lista--abierta'));
    trigger.setAttribute('aria-expanded', 'true');
    abierto = true;
    document.addEventListener('mousedown', alClickFuera, true);
    document.addEventListener('keydown', alTeclado, true);
  }

  function cerrar() {
    if (!abierto) return;
    lista.classList.remove('escala-desc__lista--abierta');
    trigger.setAttribute('aria-expanded', 'false');
    abierto = false;
    document.removeEventListener('mousedown', alClickFuera, true);
    document.removeEventListener('keydown', alTeclado, true);
    ocultarTimeout = setTimeout(() => { lista.hidden = true; }, 160);
  }

  function alClickFuera(e) {
    if (!wrapper.contains(e.target)) cerrar();
  }

  function alTeclado(e) {
    if (e.key === 'Escape') { cerrar(); trigger.focus(); }
  }

  trigger.addEventListener('click', () => { abierto ? cerrar() : abrir(); });
  select.addEventListener('change', renderTrigger);

  renderTrigger();
  wrapper.appendChild(trigger);
  wrapper.appendChild(lista);
  select.insertAdjacentElement('afterend', wrapper);
}
