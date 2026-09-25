-- Amplía el timeout de la RPC del informe mensual (consultas pesadas sobre
-- vencimientos + inventario). Evita "canceling statement due to statement timeout"
-- cuando el default del proyecto (p. ej. 8s) es insuficiente.

alter function public.admin_estadisticas_mensual_sucursal(timestamptz, timestamptz)
  set statement_timeout = '90s';
