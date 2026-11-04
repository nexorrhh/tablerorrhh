-- Carga manual del plantel desde el Excel "Legajos de Sueldos" de Tango
-- (Plantel → Actualizar desde Excel, components/plantel-importar.js).
--
-- Por qué una función: la tabla "empleados" no deja escribir con la clave pública del tablero
-- (solo el sync de Tango, que usa la clave de servicio). En vez de abrir la tabla entera, esta
-- función hace únicamente lo mismo que hacía el sync: actualizar los datos que trae el Excel,
-- dar altas y bajas, y registrar la corrida en sync_log. Corre con los permisos de su dueño
-- (security definer), así el tablero puede llamarla sin tener la clave de servicio.
--
-- Ejecutar una sola vez en Supabase → SQL Editor del proyecto del TABLERO (bmueojeeexheprteavay).

create or replace function public.plantel_aplicar_excel(
  p_empresa       text,    -- 'CIMOMET' | 'COMOING'
  p_operaciones   jsonb,   -- [{ op: 'actualizar'|'reactivar'|'alta'|'baja', legajo, campos: {...} }]
  p_legajos_excel text[],  -- todos los legajos del Excel (para marcar la última sincronización)
  p_usuario       text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  op       jsonb;
  c        jsonb;
  n        int;
  v_act    int   := 0;
  v_altas  int   := 0;
  v_bajas  int   := 0;
  v_err    jsonb := '[]'::jsonb;
begin
  if p_empresa not in ('CIMOMET', 'COMOING') then
    raise exception 'Empresa inválida: %', p_empresa;
  end if;

  for op in select * from jsonb_array_elements(coalesce(p_operaciones, '[]'::jsonb)) loop
    c := coalesce(op->'campos', '{}'::jsonb);
    begin
      if op->>'op' = 'baja' then
        update empleados set activo = false, ultima_sync = now()
         where empresa = p_empresa and legajo = op->>'legajo' and activo;
        get diagnostics n = row_count;
        if n > 0 then v_bajas := v_bajas + 1;
        else v_err := v_err || to_jsonb('Baja #' || (op->>'legajo') || ': no estaba activo'); end if;

      elsif op->>'op' in ('actualizar', 'reactivar') then
        -- Solo se pisan los campos que vienen (un dato vacío del Excel no borra el de la base).
        update empleados set
          apellido_y_nombre = coalesce(nullif(c->>'apellido_y_nombre', ''), apellido_y_nombre),
          cuil              = coalesce(nullif(c->>'cuil', ''), cuil),
          desc_puesto       = coalesce(nullif(c->>'desc_puesto', ''), desc_puesto),
          fecha_nacimiento  = coalesce(nullif(c->>'fecha_nacimiento', '')::date, fecha_nacimiento),
          fecha_ingreso     = coalesce(nullif(c->>'fecha_ingreso', '')::date, fecha_ingreso),
          activo            = case when op->>'op' = 'reactivar' then true else activo end,
          ultima_sync       = now()
         where empresa = p_empresa and legajo = op->>'legajo';
        get diagnostics n = row_count;
        if n > 0 then v_act := v_act + 1;
        else v_err := v_err || to_jsonb('#' || (op->>'legajo') || ': no existe en el plantel'); end if;

      elsif op->>'op' = 'alta' then
        insert into empleados (legajo, empresa, apellido_y_nombre, cuil, desc_puesto,
                               fecha_nacimiento, fecha_ingreso, activo, ultima_sync)
        values (op->>'legajo', p_empresa, c->>'apellido_y_nombre', nullif(c->>'cuil', ''), c->>'desc_puesto',
                nullif(c->>'fecha_nacimiento', '')::date, nullif(c->>'fecha_ingreso', '')::date, true, now());
        v_altas := v_altas + 1;
      end if;
    exception when others then
      -- Un error en una persona no frena al resto.
      v_err := v_err || to_jsonb(coalesce(c->>'apellido_y_nombre', '') || ' #' || coalesce(op->>'legajo', '?') || ': ' || sqlerrm);
    end;
  end loop;

  -- Igual que el sync: queda registrada la última sincronización de todos los del Excel.
  update empleados set ultima_sync = now()
   where empresa = p_empresa and legajo = any(coalesce(p_legajos_excel, '{}'));

  -- sync_log.detalle es jsonb: se deja de dónde vino la corrida, quién la hizo y los errores.
  insert into sync_log (empresa, total_tango, upserted, desactivados, errores, detalle)
  values (p_empresa, coalesce(array_length(p_legajos_excel, 1), 0), v_act + v_altas, v_bajas,
          jsonb_array_length(v_err),
          jsonb_build_object('origen', 'Carga manual desde Excel', 'usuario', p_usuario, 'errores', v_err));

  return jsonb_build_object('actualizados', v_act, 'altas', v_altas, 'bajas', v_bajas, 'errores', v_err);
end;
$$;

revoke all on function public.plantel_aplicar_excel(text, jsonb, text[], text) from public;
grant execute on function public.plantel_aplicar_excel(text, jsonb, text[], text) to anon, authenticated;
