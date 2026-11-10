-- Módulo de Vacaciones: Planificación y cobertura operativa.
--
-- Tablas nuevas con prefijo vac_. NO modifica ninguna tabla existente: la nómina sigue
-- siendo `empleados` (fuente única), los feriados salen de `produccion_feriados` y las
-- competencias del módulo Polivalencia (produccion_polivalencia_*).
--
-- Seguridad: mismo esquema que el resto del tablero hoy (lectura/escritura con la anon
-- key). Cuando se implemente el login real (Supabase Auth), estas políticas se cambian
-- a `authenticated` con chequeo de rol — ver "Fase 0" de la propuesta.
--
-- Auditoría: todo alta/cambio/baja en períodos, saldos y escenarios queda en
-- vac_auditoria (por trigger, no depende de la pantalla). El usuario sale de la columna
-- `modificado_por` que completa el tablero.
--
-- Cómo instalar: Supabase → SQL Editor → pegar → Run. Es idempotente.

-- ── Sectores y mapeo de puestos ─────────────────────────────────────────────
create table if not exists public.vac_sectores (
  id                 bigint generated always as identity primary key,
  nombre             text not null unique,
  orden              int not null default 100,
  -- Necesidad mínima de personas presentes por día hábil (operativa, NO legal).
  -- null = sin definir: la pantalla muestra dotación pero no juzga la cobertura.
  requeridos_default int,
  -- Umbrales del mapa de calor (% de cobertura). Operativos y configurables por sector.
  pct_verde          int not null default 100,
  pct_amarillo       int not null default 85,
  activo             boolean not null default true,
  creado_en          timestamptz not null default now()
);

-- desc_puesto de Tango (normalizado: minúsculas, sin tildes ni espacios extra) → sector.
create table if not exists public.vac_puesto_sector (
  puesto_norm text primary key,
  sector_id   bigint not null references public.vac_sectores(id) on delete cascade
);

-- Datos que no están en `empleados` (sin duplicar la nómina: solo se agregan campos).
create table if not exists public.vac_empleado_extra (
  legajo          int  not null,
  empresa         text not null,
  convenio        text,          -- 'UOM' | 'UOCRA' | 'Fuera de convenio' | ...
  establecimiento text,
  sector_id       bigint references public.vac_sectores(id) on delete set null, -- excepción al mapeo por puesto
  observaciones   text,
  modificado_por  text,
  modificado_en   timestamptz not null default now(),
  primary key (legajo, empresa)
);

-- ── Saldos ──────────────────────────────────────────────────────────────────
-- anio_vacacional N = vacaciones del año N (antigüedad al 31/12/N; se otorgan, en
-- principio, entre el 1/10/N y el 30/4/N+1).
create table if not exists public.vac_saldos (
  id                bigint generated always as identity primary key,
  legajo            int  not null,
  empresa           text not null,
  anio_vacacional   int  not null,
  dias_corresponden numeric not null,
  -- rrhh: informado por RRHH (importado) · ajuste: corrección autorizada (suma o resta)
  origen            text not null check (origen in ('rrhh', 'ajuste')),
  motivo            text,
  autorizado_por    text,
  importacion_id    bigint,
  modificado_por    text,
  creado_en         timestamptz not null default now()
);
create index if not exists vac_saldos_persona on public.vac_saldos (legajo, empresa, anio_vacacional);
-- Un solo saldo "rrhh" por persona y año (reimportar lo reemplaza, no lo duplica).
create unique index if not exists vac_saldos_rrhh_unico
  on public.vac_saldos (legajo, empresa, anio_vacacional) where origen = 'rrhh';

-- ── Escenarios y períodos ───────────────────────────────────────────────────
create table if not exists public.vac_escenarios (
  id             bigint generated always as identity primary key,
  nombre         text not null,
  descripcion    text,
  anio_vacacional int not null,
  estado         text not null default 'borrador'
                 check (estado in ('borrador', 'presentado', 'aprobado', 'descartado')),
  modificado_por text,
  creado_en      timestamptz not null default now(),
  modificado_en  timestamptz not null default now()
);

create table if not exists public.vac_periodos (
  id              bigint generated always as identity primary key,
  legajo          int  not null,
  empresa         text not null,
  anio_vacacional int  not null,
  -- null = planificación oficial; con valor = pertenece a un escenario de simulación.
  escenario_id    bigint references public.vac_escenarios(id) on delete cascade,
  desde           date not null,
  hasta           date not null,
  estado          text not null default 'propuesto'
                  check (estado in ('borrador', 'propuesto', 'aprobado', 'rechazado', 'notificado', 'gozado', 'cancelado')),
  notificado_en   date,
  constancia      text,
  observaciones   text,
  -- Advertencias que se aceptaron al guardar (quedan registradas, no se pierden).
  alertas_aceptadas jsonb,
  aprobado_por    text,
  aprobado_en     timestamptz,
  modificado_por  text,
  creado_en       timestamptz not null default now(),
  modificado_en   timestamptz not null default now(),
  check (hasta >= desde)
);
create index if not exists vac_periodos_fechas on public.vac_periodos (desde, hasta);
create index if not exists vac_periodos_persona on public.vac_periodos (legajo, empresa);
create index if not exists vac_periodos_escenario on public.vac_periodos (escenario_id);

-- Necesidad de personas por sector y semana (pisa el requeridos_default del sector).
create table if not exists public.vac_demanda (
  sector_id  bigint not null references public.vac_sectores(id) on delete cascade,
  semana     date   not null,   -- lunes de la semana
  requeridos int    not null,
  motivo     text,
  primary key (sector_id, semana)
);

-- ── Reglas (versionadas) ────────────────────────────────────────────────────
-- Una fila por versión. La pantalla usa la última activa; si no hay ninguna, usa los
-- valores por defecto de config/vacaciones.js. Se activan recién cuando RRHH las verifica.
create table if not exists public.vac_reglas (
  id            bigint generated always as identity primary key,
  version       int  not null,
  parametros    jsonb not null,
  activa        boolean not null default false,
  verificada_por text,
  vigente_desde date not null default current_date,
  creado_en     timestamptz not null default now()
);

-- ── Importaciones y auditoría ───────────────────────────────────────────────
create table if not exists public.vac_importaciones (
  id         bigint generated always as identity primary key,
  archivo    text,
  filas      int,
  aplicadas  int,
  errores    jsonb,
  hecho_por  text,
  creado_en  timestamptz not null default now()
);

create table if not exists public.vac_auditoria (
  id          bigint generated always as identity primary key,
  tabla       text not null,
  registro_id text,
  accion      text not null,
  antes       jsonb,
  despues     jsonb,
  usuario     text,
  fecha       timestamptz not null default now()
);
create index if not exists vac_auditoria_registro on public.vac_auditoria (tabla, registro_id);

create or replace function public.vac_auditar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reg jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into public.vac_auditoria (tabla, registro_id, accion, antes, despues, usuario)
  values (
    tg_table_name,
    v_reg->>'id',
    lower(tg_op),
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end,
    coalesce(v_reg->>'modificado_por', 'desconocido')
  );
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.vac_tocar_modificado()
returns trigger language plpgsql as $$
begin new.modificado_en := now(); return new; end; $$;

do $$
declare t text;
begin
  foreach t in array array['vac_periodos', 'vac_saldos', 'vac_escenarios', 'vac_empleado_extra'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_auditoria', t);
    execute format('create trigger %I after insert or update or delete on public.%I
                    for each row execute function public.vac_auditar()', t || '_auditoria', t);
  end loop;
  foreach t in array array['vac_periodos', 'vac_escenarios'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_modificado', t);
    execute format('create trigger %I before update on public.%I
                    for each row execute function public.vac_tocar_modificado()', t || '_modificado', t);
  end loop;
end $$;

-- ── Aprobar un escenario: reemplaza la planificación oficial de sus personas ──
-- En una sola transacción: los períodos oficiales (no gozados) de las personas del
-- escenario se cancelan y se copian los del escenario como "aprobado".
create or replace function public.vac_aprobar_escenario(p_escenario_id bigint, p_usuario text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_anio int;
  v_cancelados int;
  v_copiados int;
begin
  select anio_vacacional into v_anio from public.vac_escenarios where id = p_escenario_id;
  if v_anio is null then raise exception 'Escenario % inexistente', p_escenario_id; end if;

  update public.vac_periodos o
     set estado = 'cancelado', modificado_por = p_usuario,
         observaciones = coalesce(o.observaciones || ' · ', '') || 'Reemplazado por escenario ' || p_escenario_id
   where o.escenario_id is null
     and o.anio_vacacional = v_anio
     and o.estado in ('borrador', 'propuesto', 'aprobado')
     and exists (select 1 from public.vac_periodos e
                  where e.escenario_id = p_escenario_id and e.legajo = o.legajo and e.empresa = o.empresa);
  get diagnostics v_cancelados = row_count;

  insert into public.vac_periodos (legajo, empresa, anio_vacacional, escenario_id, desde, hasta, estado,
                                   observaciones, alertas_aceptadas, aprobado_por, aprobado_en, modificado_por)
  select legajo, empresa, anio_vacacional, null, desde, hasta, 'aprobado',
         observaciones, alertas_aceptadas, p_usuario, now(), p_usuario
    from public.vac_periodos
   where escenario_id = p_escenario_id and estado not in ('cancelado', 'rechazado');
  get diagnostics v_copiados = row_count;

  update public.vac_escenarios set estado = 'aprobado', modificado_por = p_usuario where id = p_escenario_id;
  return jsonb_build_object('cancelados', v_cancelados, 'aprobados', v_copiados);
end;
$$;

-- ── Importar saldos informados por RRHH (todo o nada) ───────────────────────
-- p_filas: [{legajo, empresa, anio_vacacional, dias_corresponden}]. Con p_reemplazar =
-- false, si alguna persona ya tenía saldo informado para ese año se cancela todo: no se
-- pisan datos sin que alguien lo autorice explícitamente desde la vista previa.
create or replace function public.vac_importar_saldos(p_filas jsonb, p_archivo text, p_usuario text, p_reemplazar boolean)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_imp bigint;
  v_existentes int;
  v_n int;
begin
  select count(*) into v_existentes
    from jsonb_to_recordset(p_filas) as f(legajo int, empresa text, anio_vacacional int, dias_corresponden numeric)
    join public.vac_saldos s using (legajo, empresa, anio_vacacional)
   where s.origen = 'rrhh';
  if v_existentes > 0 and not p_reemplazar then
    raise exception '% personas ya tienen saldo informado para ese año. Marcá "Reemplazar" para pisarlos.', v_existentes;
  end if;

  insert into public.vac_importaciones (archivo, filas, hecho_por) values (p_archivo, jsonb_array_length(p_filas), p_usuario)
  returning id into v_imp;

  delete from public.vac_saldos s
   using jsonb_to_recordset(p_filas) as f(legajo int, empresa text, anio_vacacional int, dias_corresponden numeric)
   where s.origen = 'rrhh' and s.legajo = f.legajo and s.empresa = f.empresa and s.anio_vacacional = f.anio_vacacional;

  insert into public.vac_saldos (legajo, empresa, anio_vacacional, dias_corresponden, origen, importacion_id, modificado_por)
  select legajo, empresa, anio_vacacional, dias_corresponden, 'rrhh', v_imp, p_usuario
    from jsonb_to_recordset(p_filas) as f(legajo int, empresa text, anio_vacacional int, dias_corresponden numeric);
  get diagnostics v_n = row_count;

  update public.vac_importaciones set aplicadas = v_n where id = v_imp;
  return jsonb_build_object('importacion', v_imp, 'aplicadas', v_n, 'reemplazadas', v_existentes);
end;
$$;
grant execute on function public.vac_importar_saldos(jsonb, text, text, boolean) to anon, authenticated;

-- ── Permisos (igual que el resto del tablero por ahora; ver Fase 0) ──────────
do $$
declare t text;
begin
  foreach t in array array['vac_sectores', 'vac_puesto_sector', 'vac_empleado_extra', 'vac_saldos',
                           'vac_escenarios', 'vac_periodos', 'vac_demanda', 'vac_reglas',
                           'vac_importaciones', 'vac_auditoria'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_lectura', t);
    execute format('create policy %I on public.%I for select to anon, authenticated using (true)', t || '_lectura', t);
    if t <> 'vac_auditoria' then
      execute format('drop policy if exists %I on public.%I', t || '_escritura', t);
      execute format('create policy %I on public.%I for all to anon, authenticated using (true) with check (true)', t || '_escritura', t);
    end if;
    execute format('grant select, insert, update, delete on public.%I to anon, authenticated', t);
  end loop;
end $$;
-- La auditoría solo se lee desde el tablero: la escribe el trigger (security definer).
revoke insert, update, delete on public.vac_auditoria from anon, authenticated;
grant execute on function public.vac_aprobar_escenario(bigint, text) to anon, authenticated;

-- ── Datos iniciales sugeridos (editables desde Vacaciones → Configuración) ───
-- Agrupados como el tablero de Dirección: cada puesto es su sector y todos los
-- "Responsable de …" van a "Responsables" (por prefijo, ver config/vacaciones.js).
insert into public.vac_sectores (nombre, orden) values
  ('Armador', 10), ('Soldador', 20), ('Corte', 30), ('Pintura', 40), ('Movimientos', 50),
  ('Camión', 55), ('Recepción y Despacho', 60), ('Pañol', 65), ('Mantenimiento', 70), ('Calidad', 80),
  ('Ayudante de Producción', 85), ('Coordinación de producción', 90), ('Ingeniería', 100), ('Presupuestos', 105),
  ('Administración', 110), ('RRHH', 115), ('Seguridad & Higiene', 120), ('Responsables', 130)
on conflict (nombre) do nothing;

update public.vac_sectores set orden = v.orden
  from (values ('Armador', 10), ('Soldador', 20), ('Corte', 30), ('Pintura', 40), ('Movimientos', 50),
               ('Camión', 55), ('Recepción y Despacho', 60), ('Pañol', 65), ('Mantenimiento', 70), ('Calidad', 80),
               ('Ayudante de Producción', 85), ('Coordinación de producción', 90), ('Ingeniería', 100), ('Presupuestos', 105),
               ('Administración', 110), ('RRHH', 115), ('Seguridad & Higiene', 120), ('Responsables', 130)) as v(nombre, orden)
 where vac_sectores.nombre = v.nombre;

-- Mapeo puesto (normalizado) → sector. Los "responsable…" no hace falta mapearlos: van
-- solos a Responsables. Gerencia queda sin mapeo (no se planifica).
delete from public.vac_puesto_sector;
insert into public.vac_puesto_sector (puesto_norm, sector_id)
select m.puesto_norm, s.id
  from (values
    ('armador', 'Armador'), ('soldador', 'Soldador'),
    ('corte', 'Corte'), ('oxicorte', 'Corte'),
    ('pintura', 'Pintura'), ('granalla', 'Pintura'),
    ('movimientos', 'Movimientos'), ('camion', 'Camión'), ('recepcion y despacho', 'Recepción y Despacho'),
    ('panol', 'Pañol'), ('mantenimiento', 'Mantenimiento'), ('calidad', 'Calidad'),
    ('ayudante de produccion', 'Ayudante de Producción'), ('coordinacion de produccion', 'Coordinación de producción'),
    ('ingenieria', 'Ingeniería'), ('presupuestos', 'Presupuestos'),
    ('administracion', 'Administración'), ('rrhh', 'RRHH'),
    ('seguridad & higiene', 'Seguridad & Higiene')
  ) as m(puesto_norm, sector)
  join public.vac_sectores s on s.nombre = m.sector
on conflict (puesto_norm) do update set sector_id = excluded.sector_id;

notify pgrst, 'reload schema';
