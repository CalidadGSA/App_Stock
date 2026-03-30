# Manual de usuario - GestionStock Farmacia

## 1) Perfil de usuarios

- **Operador sucursal**: inventario diario/ocasional de sucursal, vencimientos y consultas permitidas.
- **Admin**: auditorias, inventarios ocasionales de auditoria, ajustes y vistas globales habilitadas.

## 2) Ingreso al sistema

1. Ir a la pantalla de login.
2. Ingresar operador y contrasena.
3. Seleccionar sucursal (si corresponde).
4. Acceder al dashboard.

## 3) Dashboard

En el dashboard vas a ver:

- KPI de inventarios.
- KPI de items con diferencias.
- KPI de vencimientos (por vencer/vencidos).
- Ultimos controles de inventario y vencimientos.

Desde los KPI se puede navegar a vistas de detalle.

## 4) Inventario diario

### Crear inventario diario

1. Ir a Inventario nuevo.
2. Seleccionar **categoria macro** (FARMA, BIENESTAR o PSICOTROPICOS).
3. Confirmar creacion.

### Recontar productos

1. Buscar/escanear producto.
2. Se abre la card del producto.
3. Cargar stock real en cajas/unidades.
4. Confirmar.

Notas:

- Si el producto ya existe en el inventario, se reabre su card para editar.
- Si cambia el stock sistema durante el recuento, el sistema avisa y refresca valores antes de reconfirmar.

## 5) Inventario ocasional

- No precarga productos automaticamente.
- El operador agrega productos manualmente con el buscador.
- Luego el flujo de recuento es igual al diario.

## 6) Inventario de auditoria (admin)

1. Crear auditoria desde opciones de admin.
2. El sistema trae productos con diferencias pendientes segun reglas vigentes.
3. Seleccionar producto para abrir card y recontar.
4. Confirmar cambios.

## 7) Revisar diferencias

En la vista de diferencias podes:

- ver stock sistema, stock real y diferencia,
- editar lineas habilitadas,
- marcar productos como verificados (si corresponde),
- identificar rapidamente estados por color.

## 8) Ajustes

1. Ingresar a Ajustes.
2. Filtrar por fechas/origen (segun configuracion disponible).
3. Exportar CSV de diferencias para ajustar.
4. Consultar historial de ajustes/exportaciones.

## 9) Vencimientos - por vencer

1. Ir a `Vencimientos > Por vencer`.
2. Filtrar por periodo (30/60/90 y variantes) y categoria.
3. Buscar por descripcion/presentacion/codigo.
4. Usar boton **Vendido** para descontar cantidad vendida.

## 10) Vencimientos - vencidos

- Lista productos vencidos segun reglas por categoria macro.
- Permite marcar vendidos.
- Permite devolucion masiva cuando aplica.

## 11) Devoluciones

- Vista de historial de devoluciones.
- Filtros por fecha/macrocategoria (segun pantalla).
- Detalle por devolucion con productos, cantidades y fecha de vencimiento.

## 12) Uso de escaner y camara

- Se admite escaner USB/PDA (entrada por teclado).
- Se puede usar camara en flujos habilitados.
- En card de recuento existe opcion de camara para sumar cajas del mismo producto.

Recomendacion operativa:

- evitar tener dos dispositivos de escaneo activos a la vez sobre el mismo campo,
- confirmar cada producto antes de pasar al siguiente.

## 13) Mensajes frecuentes

- **"No hay productos para inventariar"**: no hay asignacion disponible para ese tipo/categoria/periodo.
- **"Sin permisos"**: el rol actual no puede ejecutar esa accion.
- **Cambio de stock sistema durante recuento**: revisar valores actualizados y volver a confirmar.

## 14) Buenas practicas

- Mantener filtros limpios al terminar una tarea.
- Validar sucursal seleccionada antes de iniciar controles.
- Cerrar controles correctamente para asegurar trazabilidad.
- Revisar diferencias y verificaciones antes de exportar ajustes.

## 15) Soporte interno

Ante incidentes, registrar:

- usuario y sucursal,
- modulo afectado,
- hora aproximada,
- mensaje exacto del error,
- captura de pantalla (si es posible).

Con eso se acelera el diagnostico tecnico.

