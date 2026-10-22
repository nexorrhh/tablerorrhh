-- Vista de solo lectura para que el Tablero de RRHH (Desempeño) pueda calcular el resultado de
-- seguridad a partir de las evaluaciones mensuales de Seguridad e Higiene (tablero-hys).
--
-- Por qué una vista: las tablas hys_evaluaciones_mensuales / hys_evaluacion_detalles solo las
-- puede leer un usuario logueado en tablero-hys, y este tablero usa la clave pública (anon). La
-- vista expone únicamente lo necesario — legajo, empresa, mes, año y el promedio del mes — sin
-- observaciones ni el detalle por aspecto.
--
-- Incluye también a los desvinculados (se une con "empleados", no con v_empleados_activos), para
-- que una evaluación de un año ya cerrado no pierda meses.
--
-- Ejecutar una sola vez en Supabase → SQL Editor (proyecto bmueojeeexheprteavay).

create or replace view public.v_hys_seguridad_mensual as
select
  e.legajo,
  e.empresa,
  h.anio,
  h.mes,
  h.promedio_general
from public.hys_evaluaciones_mensuales h
join public.empleados e on e.id = h.empleado_id
where h.promedio_general is not null;

grant select on public.v_hys_seguridad_mensual to anon, authenticated;
