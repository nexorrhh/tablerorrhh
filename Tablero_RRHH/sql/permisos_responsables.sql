-- Autorización de permisos por responsable de área.
--
-- Los responsables son los mismos de Desempeño → Parametrización → Evaluadores
-- (iso_evaluadores + iso_evaluadores_puestos): quien tiene asignado un puesto evalúa el
-- desempeño de esa gente y además autoriza sus permisos (llegada tarde, salida anticipada,
-- ausencia) cargados en Nexo RRHH.
--
-- Ejecutar una sola vez en Supabase → SQL Editor del proyecto del TABLERO
-- (bmueojeeexheprteavay), no en los proyectos de Nexo RRHH.

-- 1) Email de cada responsable: a esa dirección le llega el aviso de permiso nuevo.
alter table public.iso_evaluadores add column if not exists email text;

-- 2) Quién autoriza a quién. Nexo RRHH la consulta (con la clave pública) al llegar un permiso
--    nuevo, para mandarle el mail solo al responsable del área de esa persona.
--    - El puesto se compara sin mayúsculas ni espacios (Tango a veces cambia "RRHH" por "Rrhh").
--    - Se excluye a la persona misma: un responsable no autoriza sus propios permisos (esos
--      quedan para los autorizadores generales de Nexo).
--    - Solo responsables activos y con email cargado.
create or replace view public.v_responsables_permisos as
select
  e.legajo::text            as legajo,
  e.empresa                 as empresa,
  ev.id                     as responsable_id,
  ev.nombre                 as responsable_nombre,
  lower(trim(ev.email))     as responsable_email
from public.empleados e
join public.iso_evaluadores_puestos p
  on upper(trim(p.desc_puesto)) = upper(trim(e.desc_puesto))
join public.iso_evaluadores ev
  on ev.id = p.evaluador_id
where e.activo
  and ev.activo
  and coalesce(trim(ev.email), '') <> ''
  and not (ev.legajo::text = e.legajo::text and ev.empresa = e.empresa);

grant select on public.v_responsables_permisos to anon, authenticated;
