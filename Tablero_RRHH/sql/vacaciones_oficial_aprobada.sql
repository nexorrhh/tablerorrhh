-- Vacaciones: la planificación oficial solo tiene lo aprobado.
-- Correr una vez en Supabase → SQL Editor. Reemplaza la función vac_aprobar_escenario.
--
-- Antes: aprobar un escenario cancelaba en la oficial TODO lo de las personas del escenario
-- (incluso lo ya aprobado) y copiaba el escenario completo.
-- Ahora: un período aprobado individualmente ya vive en la oficial y los escenarios lo
-- muestran encima. Aprobar el escenario completo:
--   1. cancela en la oficial solo borradores/propuestas que quedaran de antes (no lo aprobado),
--   2. copia a la oficial, como aprobados, los períodos del escenario que todavía no estén
--      (los idénticos a uno oficial firme se saltean),
--   3. marca el escenario como aprobado.

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
     and o.estado in ('borrador', 'propuesto')
     and exists (select 1 from public.vac_periodos e
                  where e.escenario_id = p_escenario_id and e.legajo = o.legajo and e.empresa = o.empresa);
  get diagnostics v_cancelados = row_count;

  insert into public.vac_periodos (legajo, empresa, anio_vacacional, escenario_id, desde, hasta, estado,
                                   observaciones, alertas_aceptadas, aprobado_por, aprobado_en, modificado_por)
  select e.legajo, e.empresa, e.anio_vacacional, null, e.desde, e.hasta, 'aprobado',
         e.observaciones, e.alertas_aceptadas, p_usuario, now(), p_usuario
    from public.vac_periodos e
   where e.escenario_id = p_escenario_id
     and e.estado not in ('cancelado', 'rechazado')
     and not exists (select 1 from public.vac_periodos o
                      where o.escenario_id is null and o.legajo = e.legajo and o.empresa = e.empresa
                        and o.desde = e.desde and o.hasta = e.hasta
                        and o.estado in ('aprobado', 'notificado', 'gozado'));
  get diagnostics v_copiados = row_count;

  update public.vac_escenarios set estado = 'aprobado', modificado_por = p_usuario where id = p_escenario_id;
  return jsonb_build_object('cancelados', v_cancelados, 'aprobados', v_copiados);
end;
$$;

grant execute on function public.vac_aprobar_escenario(bigint, text) to anon, authenticated;
