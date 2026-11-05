-- Más margen de tiempo para las cargas de Tango y Capataz.
--
-- POR QUÉ: Supabase corta a los 3 segundos cualquier consulta del rol "anon" (el que
-- usa el tablero). Las cargas ahora se hacen en una transacción por mes (todo o nada),
-- y un mes de Tango (miles de filas de detalle) puede rondar ese límite. Con 20 s
-- sobra margen. Solo amplía el tope: no hace más lenta ninguna consulta.
--
-- Cómo instalar: Supabase → SQL Editor → pegar → Run. Es idempotente.

alter role anon set statement_timeout = '20s';
alter role authenticated set statement_timeout = '20s';

notify pgrst, 'reload config';
