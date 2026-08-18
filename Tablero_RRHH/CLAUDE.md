# CLAUDE.md — Nexo RRHH Dashboard

> Documento de contexto y reglas para desarrollar este proyecto en Antigravity IDE.
> **Leé la sección que corresponde a tu tarea. No hace falta leer todo el archivo para cada cambio.**

---

## 1. Qué es este proyecto

Dashboard interno de **Recursos Humanos de Cimomet S.A. / Co.mo.ing S.R.L.**
Reemplaza al tablero actual hecho en Google Sites. Es esencialmente:

- Un **portal de navegación**: botones que linkean a apps/formularios que ya existen.
- Una **capa de indicadores**: gráficos que se alimentan de datos.

**No** desarrolla la lógica interna de los formularios/apps a los que linkea. Solo apunta a ellos.

### Audiencia y uso
- Lo usa el equipo de RRHH y dirección.
- Pensado para **uso en tablet y escritorio** (responsive obligatorio).
- Prioridad del proyecto: **que sea fácil de modificar**. Se le van a agregar muchas cosas con el tiempo.

---

## 2. Principio de arquitectura (LO MÁS IMPORTANTE)

> **Regla de oro: separar CONFIGURACIÓN de CÓDIGO.**

El 90% de las modificaciones futuras (agregar un botón, un indicador, cambiar un link, cambiar un color) se hacen **editando un archivo de configuración**, sin tocar la lógica.

Esto significa que:
- **Agregar contenido** = editar un archivo en `config/` (barato en tokens).
- **Cambiar cómo funciona algo** = editar un archivo en `components/` o `data/` (poco frecuente).
- `index.html` y `app.js` **casi nunca se tocan**.

Antes de escribir código nuevo, preguntate: *¿esto se puede resolver agregando una entrada a un archivo de config?* Si la respuesta es sí, hacelo así.

---

## 3. Estructura de carpetas

```
nexo-rrhh-dashboard/
├── index.html                  # Estructura HTML mínima. Casi nunca se toca.
├── app.js                      # Orquestador. Lee la config y arma todo. Rara vez se toca.
│
├── config/                     # ← ACÁ VIVE EL 90% DE LOS CAMBIOS
│   ├── secciones.js            # Las columnas/grupos de botones (ej: "Generación", "Autorización")
│   ├── botones.js              # Todos los botones y sus links
│   ├── indicadores.js          # Definición de cada indicador (qué muestra, de dónde sale)
│   └── tema.js                 # Colores, logo, nombre, fuentes
│
├── data/                       # Capa de datos. Abstrae de dónde vienen los datos.
│   ├── fuentes.js              # Credenciales/IDs de cada fuente (Sheets y Supabase)
│   ├── adaptadores.js          # Traduce cualquier fuente a un formato común
│   └── cliente-supabase.js     # Helper para hablar con Supabase
│
├── components/                 # Piezas de UI reutilizables. Se tocan poco.
│   ├── boton-accion.js
│   ├── tarjeta-indicador.js
│   ├── grafico.js
│   └── header.js
│
├── estilos/
│   ├── base.css                # Reset + variables CSS (leen de tema.js o las definen)
│   └── componentes.css         # Estilos de cada componente
│
└── CLAUDE.md                   # Este archivo.
```

### Por qué esta estructura
Cada archivo tiene **una sola responsabilidad**. Cuando una tarea entra, sabés exactamente qué archivo abrir sin escanear el resto. Eso es lo que mantiene barato cada cambio.

---

## 4. Stack técnico

- **HTML + CSS + JavaScript vanilla con módulos ES** (`import`/`export`). **Sin build step, sin npm, sin frameworks.**
- **Gráficos**: Chart.js vía CDN (`https://cdn.jsdelivr.net/npm/chart.js`). Maneja barras y torta, que es lo que necesita el dashboard actual.
- **Datos actuales**: Google Sheets (los Excel/planillas que ya existen), leídos vía endpoint público.
- **Datos nuevos**: Supabase (REST API con anon key).

### Requisito importante de los módulos ES
Los `import`/`export` **requieren servir el proyecto por HTTP**, no funcionan con `file://` (doble clic).
- En local: usar la extensión "Live Server" o `python -m http.server`.
- En producción: GitHub Pages ya sirve por HTTP. ✅

> Nota: si en algún momento esto resulta un problema, la alternativa es cargar todo con `<script>` en orden en el `index.html`. Pero los módulos ES son más limpios y modulares, así que los preferimos mientras se pueda servir por HTTP.

---

## 5. Capa de datos (clave para la migración futura)

> **Objetivo: que ningún indicador sepa de dónde vienen sus datos.**
> Hoy salen de Google Sheets. Mañana van a salir de Supabase. El día que migremos, se cambia **un solo campo** por indicador y nada más se rompe.

### Cómo funciona

1. **`config/indicadores.js`** declara el indicador y dice **qué fuente** usa (un string, ej: `'sheets'` o `'supabase'`).
2. **`data/fuentes.js`** sabe cómo traer datos crudos de cada fuente.
3. **`data/adaptadores.js`** convierte esos datos crudos a un **formato común** que el componente de gráfico entiende:
   ```js
   // Formato común que TODOS los adaptadores deben devolver:
   { labels: ['Ene', 'Feb', 'Mar'], valores: [3, 5, 8] }
   ```

El componente de gráfico solo recibe `{ labels, valores }`. No le importa el origen.

### Estado actual de las fuentes

**Google Sheets** — los datos están en una planilla con **visibilidad pública**.
Se lee con el endpoint:
```
https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:json&sheet={NOMBRE_HOJA}
```
⚠️ **A verificar al implementar:** este endpoint devuelve el JSON envuelto en un prefijo de texto (algo tipo `google.visualization.Query.setResponse(...)`) que hay que recortar antes de parsear. El formato exacto del envoltorio conviene confirmarlo con una llamada real, porque Google lo ha cambiado en el pasado y **no tengo certeza de que sea idéntico hoy**. Probar en el navegador antes de dar por buena la función de parseo.

⚠️ **También a verificar:** dependiendo de si la planilla está como "Cualquiera con el enlace" o "Publicada en la web", el endpoint puede comportarse distinto. Si `gviz/tq` falla, la alternativa es el CSV publicado:
```
https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid={GID}
```

**Supabase** — para los datos nuevos.
- Usar la **anon key** (es pública, va en el front, está bien). **Nunca** poner la service_role key acá.
- Las tablas deben tener **Row Level Security (RLS)** configurada en Supabase.
- El proyecto Supabase (URL y anon key) se configura en `data/fuentes.js`.

> ⚠️ No tengo la URL ni la anon key del proyecto Supabase que vas a usar para este dashboard. Hay que cargarlas en `data/fuentes.js` antes de probar la parte de Supabase. (Si vas a reusar un proyecto Supabase existente, confirmá cuál.)

### Migrar un indicador de Sheets a Supabase (a futuro)
1. Mover/cargar los datos a una tabla en Supabase.
2. En `config/indicadores.js`, cambiar `fuente: 'sheets'` por `fuente: 'supabase'` en ese indicador.
3. Verificar que el adaptador de Supabase devuelva el formato común correcto.
4. Listo. El resto del dashboard no se entera.

---

## 6. RECETAS (seguir estos pasos para tareas comunes)

> Estas recetas existen para que cada cambio toque **el mínimo de archivos** y consuma **el mínimo de tokens**. Seguilas al pie de la letra.

### 6.1 Agregar un botón nuevo
1. Abrir **solo** `config/botones.js`.
2. Agregar un objeto al array:
   ```js
   {
     id: 'solicitud-vacaciones',          // identificador único, sin espacios
     seccion: 'generacion',               // a qué columna/grupo pertenece
     texto: 'Solicitud de Vacaciones',    // lo que ve el usuario
     url: 'https://...',                  // link a la app/formulario existente
     estilo: 'claro'                      // 'claro' o 'oscuro' (ver tema.js)
   }
   ```
3. No tocar nada más. El botón aparece solo.

### 6.2 Agregar una sección/columna nueva de botones
1. Abrir **solo** `config/secciones.js`.
2. Agregar:
   ```js
   { id: 'reportes', titulo: 'Reportes', orden: 3 }
   ```
3. Los botones se asignan a la sección con su campo `seccion`.

### 6.3 Cambiar el link de un botón
1. Abrir `config/botones.js`.
2. Editar el campo `url` del botón. Nada más.

### 6.4 Agregar un indicador nuevo
1. Abrir **solo** `config/indicadores.js`.
2. Agregar:
   ```js
   {
     id: 'faltas-por-mes',
     titulo: 'Faltas por mes 2026',
     tipo: 'barras',                      // 'barras' | 'torta' | 'linea'
     fuente: 'sheets',                    // 'sheets' | 'supabase'
     origen: {                            // qué leer de la fuente
       hoja: 'Faltas',                    // (para sheets) nombre de la hoja
       // tabla: 'faltas',                // (para supabase) nombre de la tabla
       columnaLabel: 'Mes',
       columnaValor: 'Cantidad'
     },
     orden: 2
   }
   ```
3. Si la **fuente y el tipo de gráfico ya existen**, no tocar nada más.
4. Si es un **tipo de gráfico nuevo** (ej: primera vez que usás `'linea'`), agregar el caso en `components/grafico.js`.

### 6.5 Cambiar un color, el logo o el nombre
1. Abrir **solo** `config/tema.js`.
2. Editar el valor correspondiente. Se propaga a todo el dashboard.

### 6.6 Cambiar una fuente de datos (migrar a Supabase)
Ver sección 5, "Migrar un indicador de Sheets a Supabase".

---

## 7. Convenciones de código

- **Idioma**: nombres de variables, funciones y comentarios en **español** (coherente con el resto de los sistemas internos).
- **Nombres**: `camelCase` para variables y funciones, `kebab-case` para `id` de config y nombres de archivo.
- **Sin lógica en `config/`**: los archivos de config son **solo datos** (arrays y objetos). Nada de funciones ni condicionales ahí.
- **Sin datos hardcodeados en `components/`**: los componentes reciben todo por parámetro. Nunca un texto, color o link escrito directo en un componente.
- **Una función, una responsabilidad.** Si una función hace dos cosas, separala.
- **Comentar el "por qué", no el "qué".** El código ya dice qué hace.
- **Errores visibles**: si una fuente de datos falla (Sheets caído, tabla vacía), el indicador debe mostrar un mensaje claro en su lugar (ej: "No se pudieron cargar los datos"), **no** romper todo el dashboard ni quedar en blanco.

---

## 8. Tema y diseño

El branding ya está definido por Cimomet. Respetarlo:
- **Azul corporativo** como color principal (el del título "Recursos Humanos" y los botones oscuros del tablero actual).
- **Logo Cimomet** (rojo) en el header.
- Botones en dos estilos: **claro** (borde, fondo blanco) para "Generación", **oscuro** (fondo azul, texto blanco) para "Autorización" — igual que el tablero actual.

Reglas de diseño:
- Todos los valores de color y tipografía salen de `config/tema.js` → se exponen como **variables CSS** (`:root { --color-primario: ... }`). Nunca colores sueltos en el CSS de componentes.
- **Responsive**: en tablet las dos columnas de botones se mantienen lado a lado; en pantallas chicas pasan a una sola columna. Los gráficos se reacomodan debajo.
- **Foco visible en teclado** y respeto por `prefers-reduced-motion`. Piso de calidad, sin excepciones.
- Consistencia de texto: un botón dice exactamente qué hace. El texto del botón y el de su destino deben ser coherentes.

> ⚠️ No tengo los valores hex exactos del azul de Cimomet. Hay que tomarlos del tablero/manual de marca actual y cargarlos en `tema.js`. Si no los tenés a mano, se pueden extraer del CSS del Google Sites existente o de la imagen del tablero.

---

## 9. Reglas de trabajo en Antigravity

- **Antes de crear un archivo nuevo, fijate si el cambio entra en una receta de la sección 6.** La mayoría de las veces no necesitás archivos nuevos.
- **No reescribas archivos enteros para un cambio chico.** Editá solo lo necesario.
- **No agregues dependencias ni build tools** (webpack, vite, npm) sin que esté pedido explícitamente. El proyecto es estático a propósito.
- **No metas las claves de Supabase en el repo si el repo es público.** La anon key es pública por diseño, pero confirmá que sea la anon y no la service_role.
- Cuando termines un cambio, dejá una nota de qué archivo tocaste y por qué.

---

## 10. Cosas pendientes de definir (NO inventar)

Estos datos faltan y **no deben inventarse**. Pedirlos o tomarlos de la fuente real antes de dar por terminada la parte correspondiente:

- [ ] **SHEET_ID y nombres de hojas** de la planilla de indicadores actual.
- [ ] **Confirmación del tipo de publicación** del Sheet (Cualquiera con el enlace vs. Publicado en la web) y verificación de que el endpoint elegido funciona.
- [ ] **URL y anon key** del proyecto Supabase para los datos nuevos.
- [ ] **URLs reales** de cada app/formulario al que linkean los botones.
- [ ] **Valores hex** del azul corporativo y demás colores de marca.
- [ ] **Estructura exacta de las planillas** (qué columnas tiene cada hoja) para mapear los adaptadores.

---

## Resumen de filosofía

> Construir una base robusta una vez, para que después agregar cosas sea cambiar una línea en `config/`.
> Cada modificación debería tocar **un solo archivo** y consumir **pocos tokens**.
> Si una tarea te obliga a tocar muchos archivos, probablemente la arquitectura se puede mejorar — avisá antes de seguir.
