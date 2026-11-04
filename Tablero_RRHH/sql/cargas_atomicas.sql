-- Cargas atómicas de Horas y Presentismo (Tango) y Horas por OT (Capataz).
--
-- POR QUÉ: hasta ahora el navegador hacía "borrar detalle del período" y después
-- "insertar en lotes de 500". Si un lote fallaba a mitad de camino (corte de red,
-- error de un dato), el período quedaba a medias: el detalle viejo ya borrado y el
-- nuevo incompleto. Una función de Postgres corre en UNA transacción: o se guarda
-- todo, o no se guarda nada y los datos anteriores quedan intactos.
--
-- SECURITY INVOKER a propósito: corre con los mismos permisos (RLS) de quien la
-- llama, igual que las escrituras que reemplaza. No le da a nadie más permisos de
-- los que ya tenía. Cuando se implemente el login con Supabase Auth, estas
-- funciones heredan esas reglas sin cambios.
--
-- Cómo instalar: Supabase → SQL Editor → pegar este archivo completo → Run.
-- Es idempotente (se puede correr de nuevo sin problema).

-- Inserta (o actualiza, si se indica clave de conflicto) un array JSON de filas en
-- una tabla. Solo usa las claves del JSON que existen como columnas de la tabla.
create or replace function public.rrhh_insertar_json(p_tabla text, p_filas jsonb, p_conflicto text default null)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_cols text;
  v_upd  text;
  v_sql  text;
  v_n    integer;
begin
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) = 0 then
    return 0;
  end if;

  select string_agg(quote_ident(k), ', ' order by k),
         string_agg(format('%1$I = excluded.%1$I', k), ', ' order by k)
    into v_cols, v_upd
    from (select distinct jsonb_object_keys(e) as k from jsonb_array_elements(p_filas) e) claves
   where exists (select 1 from information_schema.columns c
                  where c.table_schema = 'public' and c.table_name = p_tabla and c.column_name = claves.k);

  if v_cols is null then
    raise exception 'Ninguna columna del JSON coincide con la tabla %', p_tabla;
  end if;

  v_sql := format('insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I, $1)',
                  p_tabla, v_cols, v_cols, p_tabla);
  if p_conflicto is not null then
    v_sql := v_sql || format(' on conflict (%s) do update set %s', p_conflicto, v_upd);
  end if;

  execute v_sql using p_filas;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Carga de Tango: resumen mensual (upsert) + detalle diario y tardanzas
-- (reemplazo de los legajos del archivo, acotado por período y empresa).
create or replace function public.rrhh_cargar_tango(
  p_periodo   text,   -- 'YYYY-MM-01'
  p_empresa   text,   -- 'CIMOMET' | 'COMOING'
  p_legajos   jsonb,  -- legajos del archivo: solo se reemplaza el detalle de estos
  p_mensual   jsonb,
  p_detalle   jsonb,
  p_tardanzas jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_mens integer;
  v_det  integer;
  v_tar  integer := 0;
begin
  v_mens := public.rrhh_insertar_json('rrhh_horas_mensual', p_mensual, 'periodo, legajo, empresa');

  delete from public.rrhh_horas_detalle
   where periodo::text = p_periodo
     and empresa = p_empresa
     and legajo::text in (select jsonb_array_elements_text(p_legajos));
  v_det := public.rrhh_insertar_json('rrhh_horas_detalle', p_detalle);

  if p_tardanzas is not null and jsonb_array_length(p_tardanzas) > 0 then
    delete from public.rrhh_tardanzas_salidas
     where periodo::text = p_periodo
       and empresa = p_empresa
       and legajo::text in (select jsonb_array_elements_text(p_legajos));
    v_tar := public.rrhh_insertar_json('rrhh_tardanzas_salidas', p_tardanzas, 'legajo, fecha, tipo, empresa');
  end if;

  return jsonb_build_object('mensual', v_mens, 'detalle', v_det, 'tardanzas', v_tar);
end;
$$;

-- Carga de Capataz (Horas por OT): reemplaza por completo los períodos del archivo.
create or replace function public.rrhh_cargar_horas_ot(p_periodos jsonb, p_filas jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_n integer;
begin
  delete from public.horas_ot_detalle
   where periodo::text in (select jsonb_array_elements_text(p_periodos));
  v_n := public.rrhh_insertar_json('horas_ot_detalle', p_filas);
  return jsonb_build_object('filas', v_n);
end;
$$;

grant execute on function public.rrhh_insertar_json(text, jsonb, text) to anon, authenticated;
grant execute on function public.rrhh_cargar_tango(text, text, jsonb, jsonb, jsonb, jsonb) to anon, authenticated;
grant execute on function public.rrhh_cargar_horas_ot(jsonb, jsonb) to anon, authenticated;

-- Nota: Supabase corta por defecto a los 3 s las consultas del rol anon. Un mes
-- (unos miles de filas) entra holgado; si alguna vez se cortara, la transacción se
-- deshace entera y el tablero muestra el error: no queda nada a medias.

notify pgrst, 'reload schema';
