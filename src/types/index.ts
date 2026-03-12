// ============================================================
// TIPOS GLOBALES - GestionStock Farmacia
// ============================================================

export type RolUsuario = 'admin' | 'operador_sucursal';
export type EstadoControl = 'en_progreso' | 'cerrado';

// ------------------------------------------------------------
// Entidades de la base de datos
// ------------------------------------------------------------

export interface Sucursal {
  id: string;
  nombre: string;
  codigo_interno: string;
  ubicacion: string | null;
  activa: boolean;
  created_at: string;
}

export interface Usuario {
  id: string;
  nombre: string;
  email: string;
  rol: RolUsuario;
  activo: boolean;
  created_at: string;
}

export interface ProductoCache {
  id: string;
  producto_id_sistema: string;
  codigo_barras: string;
  descripcion: string;
  presentacion: string | null;
  laboratorio: string | null;
}

export interface ProductoLegacy {
  producto_id_sistema: string;
  codigo_barras: string;
  descripcion: string;
  presentacion: string | null;
  laboratorio: string | null;
  /** Stock del sistema en unidades totales (cajas*unidades_por_caja + unidades_sueltas) */
  stock_sistema: number;
  /** Stock del sistema expresado en cajas (si se conoce) */
  stock_cajas?: number;
  /** Stock del sistema expresado en unidades sueltas (si se conoce) */
  stock_unidades?: number;
  /** Unidades por caja según ficha de producto/stock (si se conoce) */
  unidades_por_caja?: number;
  /** Si el producto admite venta por unidades sueltas (1) o no (0). Base externa: tinyint. */
  fraccionable?: number;
}

// ------------------------------------------------------------
// Controles de Inventario
// ------------------------------------------------------------

export interface ControlInventario {
  id: string;
  sucursal_id: string;
  usuario_id: string;
  fecha_inicio: string;
  fecha_fin: string | null;
  estado: EstadoControl;
  /** Origen del control: 'Sucursal' (operador) o 'Auditoria' (admin). */
  origen?: string | null;
  /** Categoría macro del inventario: FARMA / BIENESTAR / PSICOTROPICOS */
  categoria_macro?: 'FARMA' | 'BIENESTAR' | 'PSICOTROPICOS' | null;
  descripcion: string | null;
  created_at: string;
  updated_at: string;
  sucursales?: Pick<Sucursal, 'nombre' | 'codigo_interno'>;
  usuarios?: Pick<Usuario, 'nombre'>;
}

export interface ControlInventarioDetalle {
  id: string;
  control_id: string;
  producto_id_sistema: string;
  codigo_barras: string;
  descripcion: string;
  presentacion: string | null;
  laboratorio: string | null;
  stock_sistema: number;
  stock_sist_cajas?: number | null;
  stock_sist_unidades?: number | null;
   /** Cantidad contada en cajas (si se registró en cajas/unidades) */
  stock_real_cajas?: number | null;
  /** Cantidad contada en unidades sueltas (si se registró en cajas/unidades) */
  stock_real_unidades?: number | null;
  /** Total contado en unidades (cajas*unidades_por_caja + unidades_sueltas) */
  stock_real: number;
  diferencia: number;
  fecha_registro: string;
}

// ------------------------------------------------------------
// Controles de Vencimientos
// ------------------------------------------------------------

export interface ControlVencimiento {
  id: string;
  sucursal_id: string;
  usuario_id: string;
  fecha_inicio: string;
  fecha_fin: string | null;
  estado: EstadoControl;
  observaciones: string | null;
  created_at: string;
  updated_at: string;
  sucursales?: Pick<Sucursal, 'nombre' | 'codigo_interno'>;
  usuarios?: Pick<Usuario, 'nombre'>;
}

export interface ControlVencimientoDetalle {
  id: string;
  control_id: string;
  producto_id_sistema: string;
  codigo_barras: string;
  descripcion: string;
  presentacion: string | null;
  laboratorio: string | null;
  fecha_vencimiento: string;
  cantidad: number;
  fecha_registro: string;
}

// ------------------------------------------------------------
// Dashboard
// ------------------------------------------------------------

export interface DashboardStats {
  rol: RolUsuario;
  inventarios_total: number;
  inventarios_mes: number;
  items_con_diferencia: number;
  controles_vencimientos_total: number;
  productos_vencidos: number;
  productos_por_vencer_30: number;
  productos_por_vencer_60: number;
  ultimos_inventarios: Pick<ControlInventario, 'id' | 'fecha_inicio' | 'estado' | 'descripcion' | 'sucursales'>[];
  ultimos_vencimientos: Pick<ControlVencimiento, 'id' | 'fecha_inicio' | 'estado' | 'sucursales'>[];
}

// ------------------------------------------------------------
// Sesión de sucursal
// ------------------------------------------------------------

export interface SucursalSession {
  sucursal_id: string;
  nombre: string;
  codigo_interno: string;
}

// ------------------------------------------------------------
// Respuestas de API
// ------------------------------------------------------------

export interface ApiResponse<T = unknown> {
  data?: T;
  error?: string;
}
