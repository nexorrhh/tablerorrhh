-- Observación de Capataz (columna "observacio" del Excel, ej. "ot 1", "ot d", "tk2")
-- en horas_ot_detalle. Se muestra en el tooltip de horas por OT del detalle diario
-- (Horas y Presentismo → Por persona / Ficha): "OT 596 · ot 1 — 8.0h".
--
-- Cómo instalar: Supabase → SQL Editor → pegar → Run. Después volver a subir el
-- Excel de Capataz para que los meses ya cargados tomen la observación.
-- Es idempotente.

alter table public.horas_ot_detalle add column if not exists observacion text;

notify pgrst, 'reload schema';
