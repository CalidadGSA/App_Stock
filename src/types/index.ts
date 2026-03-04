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
  stock_sistema: number;
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
  observaciones: string | null;
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
  inventarios_total: number;
  inventarios_mes: number;
  items_con_diferencia: number;
  controles_vencimientos_total: number;
  productos_vencidos: number;
  productos_por_vencer_30: number;
  productos_por_vencer_60: number;
  ultimos_inventarios: Pick<ControlInventario, 'id' | 'fecha_inicio' | 'estado' | 'sucursales'>[];
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
