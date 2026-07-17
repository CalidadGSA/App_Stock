-- Vueltas de inventario diario de psicotrópicos por sucursal (fijo, no por trimestre).
alter table sucursales
  add column if not exists vueltas_psicos integer not null default 4;

comment on column sucursales.vueltas_psicos is
  'Cantidad de vueltas trimestrales de inventario diario PSICOTROPICOS para la sucursal.';

update sucursales
set vueltas_psicos = case sucursal
  when 1 then 3
  when 2 then 5
  when 3 then 4
  when 4 then 3
  when 5 then 4
  when 6 then 4
  when 7 then 4
  when 8 then 3
  when 11 then 4
  when 12 then 4
  when 16 then 4
  when 17 then 4
  when 19 then 5
  when 20 then 4
  when 21 then 3
  else 4
end
where sucursal in (1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 16, 17, 19, 20, 21);
