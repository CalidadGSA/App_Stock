-- Correcciones de cantidad vendida desde «por vencer» (delta positivo o negativo).
alter table vencimientos_detalle_ventas
  add column if not exists es_ajuste smallint not null default 0;

alter table vencimientos_detalle_ventas
  drop constraint if exists vencimientos_detalle_ventas_cantidad_vendida_check;

alter table vencimientos_detalle_ventas
  add constraint vencimientos_detalle_ventas_cantidad_vendida_check
  check (
    (es_ajuste = 0 and cantidad_vendida > 0)
    or (es_ajuste = 1 and cantidad_vendida <> 0)
  );
