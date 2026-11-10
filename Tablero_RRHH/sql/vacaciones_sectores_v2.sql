-- Vacaciones: sectores agrupados como el tablero de Dirección.
--   · Cada puesto es su propio sector (Armador, Soldador, Pintura, Corte, Movimientos…).
--   · Todos los "Responsable de …" van a un único sector "Responsables" (lo resuelve el
--     tablero por prefijo, ver config/vacaciones.js → gruposPorPrefijo).
--   · Gerencia no se planifica (config/vacaciones.js → puestosExcluidos).
--
-- Se corre UNA vez sobre una base que ya tenía sql/vacaciones.sql. Renombra los sectores
-- existentes (conserva sus ids, así no se pierde nada cargado), agrega los que faltan y
-- rearma el mapeo puesto → sector. Es idempotente.
-- Cómo instalar: Supabase → SQL Editor → pegar → Run.

update public.vac_sectores set nombre = 'Armador'                    where nombre = 'Armado';
update public.vac_sectores set nombre = 'Soldador'                   where nombre = 'Soldadura';
update public.vac_sectores set nombre = 'Movimientos'                where nombre = 'Movimiento y despacho';
update public.vac_sectores set nombre = 'Coordinación de producción' where nombre = 'Producción (supervisión)';
update public.vac_sectores set nombre = 'Ingeniería'                 where nombre = 'Ingeniería y presupuestos';
update public.vac_sectores set nombre = 'Administración'             where nombre = 'Administración y gerencia';
update public.vac_sectores set nombre = 'Seguridad & Higiene'        where nombre = 'Seguridad e higiene';

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
