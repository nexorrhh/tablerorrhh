-- Configuración de accesos del Tablero RRHH (módulo Configuración).
--   · rrhh_perfiles_acceso: perfiles con nombre que definen qué módulos se ven.
--   · perfiles_rrhh (las personas que entran al tablero) suma tres columnas:
--       activo            → si está deshabilitado no aparece en el login.
--       perfil_acceso_id  → su perfil de acceso.
--       es_admin          → puede entrar a Configuración.
-- No borra nada: la columna vieja modulos_permitidos se respeta mientras la persona no
-- tenga perfil asignado (y abajo se migra a perfiles).
--
-- IMPORTANTE: igual que el resto del tablero hoy, esto controla qué ve cada uno en la
-- pantalla, pero la base sigue abierta con la anon key. El control real llega con el login
-- de Supabase Auth (Fase 0 de seguridad).
--
-- Cómo instalar: Supabase → SQL Editor → pegar → Run. Es idempotente.

create table if not exists public.rrhh_perfiles_acceso (
  id                bigint generated always as identity primary key,
  nombre            text not null unique,
  descripcion       text,
  -- ids de módulo de config/navegacion.js (ej. 'presentismo', 'vacaciones'). El Panel se ve siempre.
  modulos           text[] not null default '{}',
  todos_los_modulos boolean not null default false,
  creado_en         timestamptz not null default now()
);

alter table public.perfiles_rrhh add column if not exists activo boolean not null default true;
alter table public.perfiles_rrhh add column if not exists perfil_acceso_id bigint
  references public.rrhh_perfiles_acceso(id) on delete set null;
alter table public.perfiles_rrhh add column if not exists es_admin boolean not null default false;

alter table public.rrhh_perfiles_acceso enable row level security;
drop policy if exists rrhh_perfiles_acceso_todo on public.rrhh_perfiles_acceso;
create policy rrhh_perfiles_acceso_todo on public.rrhh_perfiles_acceso
  for all to anon, authenticated using (true) with check (true);
grant select, insert, update, delete on public.rrhh_perfiles_acceso to anon, authenticated;

-- Para poder dar de alta y borrar usuarios desde la pantalla (hoy solo se editaba el PIN).
do $$
begin
  if (select relrowsecurity from pg_class where oid = 'public.perfiles_rrhh'::regclass) then
    drop policy if exists perfiles_rrhh_config on public.perfiles_rrhh;
    create policy perfiles_rrhh_config on public.perfiles_rrhh
      for all to anon, authenticated using (true) with check (true);
  end if;
end $$;
grant select, insert, update, delete on public.perfiles_rrhh to anon, authenticated;

-- ── Migración de lo que ya existe ────────────────────────────────────────────
insert into public.rrhh_perfiles_acceso (nombre, descripcion, todos_los_modulos)
values ('Acceso total', 'Ve todos los módulos del tablero', true)
on conflict (nombre) do nothing;

-- Cada combinación de módulos que ya estaba cargada a mano pasa a ser un perfil.
insert into public.rrhh_perfiles_acceso (nombre, descripcion, modulos)
select 'Solo ' || array_to_string(modulos_permitidos, ', '), 'Creado a partir de la configuración anterior', modulos_permitidos
  from (select distinct modulos_permitidos from public.perfiles_rrhh
         where modulos_permitidos is not null and cardinality(modulos_permitidos) > 0) x
on conflict (nombre) do nothing;

update public.perfiles_rrhh p
   set perfil_acceso_id = a.id
  from public.rrhh_perfiles_acceso a
 where p.perfil_acceso_id is null
   and ((p.modulos_permitidos is null or cardinality(p.modulos_permitidos) = 0) and a.nombre = 'Acceso total'
        or p.modulos_permitidos is not null and cardinality(p.modulos_permitidos) > 0 and a.modulos = p.modulos_permitidos and not a.todos_los_modulos);

update public.rrhh_perfiles_acceso set nombre = 'Solo Horas y Presentismo'
 where nombre = 'Solo presentismo'
   and not exists (select 1 from public.rrhh_perfiles_acceso where nombre = 'Solo Horas y Presentismo');

-- Primer administrador (puede entrar a Configuración y nombrar a otros).
update public.perfiles_rrhh set es_admin = true where nombre = 'Angulo, Valentin Eduardo';

notify pgrst, 'reload schema';
