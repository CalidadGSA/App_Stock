-- Si ya ejecutaste 004 antes de que incluyera los GRANT, corré solo este archivo (o estas líneas).

grant execute on function public.admin_estadisticas_mensual_sucursal(timestamptz, timestamptz)
  to service_role;
grant execute on function public.admin_estadisticas_mensual_sucursal(timestamptz, timestamptz)
  to authenticated;
