/** Catálogo de permisos de la aplicación (espejo de app_permissions en BD). */
export interface PermissionDefinition {
  codigo: string;
  nombre: string;
  descripcion: string;
  categoria: string;
  orden: number;
}

export const PERMISSIONS_CATALOG: PermissionDefinition[] = [
  { codigo: 'dashboard.view', nombre: 'Ver dashboard', descripcion: 'Acceso al panel principal', categoria: 'general', orden: 10 },
  { codigo: 'inventario.diario', nombre: 'Inventario diario', descripcion: 'Crear controles de inventario diario', categoria: 'inventario', orden: 20 },
  { codigo: 'inventario.ocasional', nombre: 'Inventario ocasional', descripcion: 'Inventarios ocasionales de sucursal', categoria: 'inventario', orden: 30 },
  { codigo: 'inventario.auditoria', nombre: 'Auditoría de inventario', descripcion: 'Controles de auditoría', categoria: 'inventario', orden: 40 },
  { codigo: 'inventario.lista', nombre: 'Lista de inventarios', descripcion: 'Ver historial de controles', categoria: 'inventario', orden: 50 },
  { codigo: 'inventario.diferencias_resumen', nombre: 'Resumen de diferencias', descripcion: 'Reporte consolidado de diferencias', categoria: 'inventario', orden: 60 },
  { codigo: 'inventario.diferencias_consolidado', nombre: 'Diferencias consolidado', descripcion: 'Diferencias de inventario en todas las sucursales', categoria: 'inventario', orden: 65 },
  { codigo: 'vencimientos.nuevo', nombre: 'Nuevo control vencimientos', descripcion: 'Iniciar control de vencimientos', categoria: 'vencimientos', orden: 70 },
  { codigo: 'vencimientos.lista', nombre: 'Lista vencimientos', descripcion: 'Historial de controles de vencimientos', categoria: 'vencimientos', orden: 80 },
  { codigo: 'vencimientos.por_vencer', nombre: 'Por vencer', descripcion: 'Listado de productos por vencer', categoria: 'vencimientos', orden: 90 },
  { codigo: 'vencimientos.consolidado', nombre: 'Por vencer consolidado', descripcion: 'Vista multi-sucursal por vencer', categoria: 'vencimientos', orden: 100 },
  { codigo: 'vencimientos.vencidos', nombre: 'Vencidos', descripcion: 'Productos vencidos', categoria: 'vencimientos', orden: 110 },
  { codigo: 'vencimientos.devoluciones', nombre: 'Devoluciones', descripcion: 'Devoluciones de vencimientos', categoria: 'vencimientos', orden: 120 },
  { codigo: 'vencimientos.descuentos', nombre: 'Descuentos', descripcion: 'Gestión de descuentos por vencimiento', categoria: 'vencimientos', orden: 130 },
  { codigo: 'admin.resumen_trimestral', nombre: 'Resumen trimestral', descripcion: 'Progreso trimestral por sucursal', categoria: 'administracion', orden: 200 },
  { codigo: 'admin.informe_mensual_sucursales', nombre: 'Informe mensual sucursales', descripcion: 'Vencidos cargados/vendidos y diferencias inventario por mes', categoria: 'administracion', orden: 205 },
  { codigo: 'admin.diferencias_psico', nombre: 'Dif. psico / estupefacientes', descripcion: 'Diferencias en controlados', categoria: 'administracion', orden: 210 },
  { codigo: 'admin.ajustes', nombre: 'Ajustes', descripcion: 'Exportar y gestionar ajustes', categoria: 'administracion', orden: 220 },
  { codigo: 'admin.ajustes_historial', nombre: 'Historial de ajustes', descripcion: 'Ver historial de ajustes', categoria: 'administracion', orden: 230 },
  { codigo: 'admin.roles_manage', nombre: 'Roles y permisos', descripcion: 'Administrar roles y asignaciones', categoria: 'administracion', orden: 240 },
  { codigo: 'admin.padron_productos', nombre: 'Padrón productos', descripcion: 'CRUD padron_final (abastecimiento)', categoria: 'administracion', orden: 245 },
  { codigo: 'admin.operadores_manage', nombre: 'Gestionar operadores', descripcion: 'Asignar roles a operadores', categoria: 'administracion', orden: 250 },
  { codigo: 'admin.maintenance', nombre: 'Modo mantenimiento', descripcion: 'Activar/desactivar mantenimiento', categoria: 'sistema', orden: 300 },
  { codigo: 'admin.sync', nombre: 'Sincronización legacy', descripcion: 'Sync sucursales y medicamentos', categoria: 'sistema', orden: 310 },
];

export const PERMISSION_CATEGORIES: Record<string, string> = {
  general: 'General',
  inventario: 'Inventario',
  vencimientos: 'Vencimientos',
  administracion: 'Administración',
  sistema: 'Sistema',
};

/** Permisos que implican capacidades de administrador (nav admin, APIs admin). */
export const ADMIN_LIKE_PERMISSIONS = new Set(
  PERMISSIONS_CATALOG.filter((p) => p.codigo.startsWith('admin.')).map((p) => p.codigo),
);

export const ALL_PERMISSION_CODES = PERMISSIONS_CATALOG.map((p) => p.codigo);

/** Fallback si RBAC no está migrado en BD (permissions vacío en sesión). */
export const LEGACY_ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  superadmin: ALL_PERMISSION_CODES,
  admin: ALL_PERMISSION_CODES.filter(
    (c) =>
      c !== 'admin.maintenance' &&
      c !== 'inventario.diario' &&
      c !== 'vencimientos.nuevo',
  ),
  operador_sucursal: [
    'dashboard.view',
    'inventario.diario',
    'inventario.ocasional',
    'inventario.lista',
    'inventario.diferencias_resumen',
    'vencimientos.nuevo',
    'vencimientos.lista',
    'vencimientos.por_vencer',
    'vencimientos.vencidos',
    'vencimientos.devoluciones',
  ],
};

export function legacyPermissionsForRol(rol: string | undefined): Set<string> {
  const list = LEGACY_ROLE_PERMISSIONS[rol ?? 'operador_sucursal'] ?? LEGACY_ROLE_PERMISSIONS.operador_sucursal;
  return new Set(list);
}
