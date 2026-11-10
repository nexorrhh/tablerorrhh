-- Permiso "Parametrizar": entra a Configuración pero solo ve las solapas de parametrización
-- (puestos, conceptos de ausencia, evaluadores, sectores de vacaciones, autorizadores) y los
-- Pendientes. No ve Usuarios ni Módulos (eso es solo para administradores).
--
-- Cómo instalar: Supabase → SQL Editor → pegar → Run. Es idempotente.
-- (Requiere haber corrido antes sql/configuracion_accesos.sql.)

alter table public.perfiles_rrhh add column if not exists puede_parametrizar boolean not null default false;

-- Thiago parametriza (puestos nuevos, conceptos, etc.) sin ser administrador.
update public.perfiles_rrhh set puede_parametrizar = true where nombre = 'Garraza, Thiago Lionel';

notify pgrst, 'reload schema';
