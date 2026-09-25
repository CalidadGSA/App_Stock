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

### KPIs mensuales

En **General → KPIs mensuales** (todos los usuarios) se ven dos indicadores del mes elegido para la sucursal activa (admin puede elegir otra sucursal):

- **Diferencias de inventario vs stock valorizado**: sobrante, faltante y neto en pesos (diferencia en cajas x costo) de todos los controles cerrados en el mes, por tipo de control, comparado con el stock valorizado de la sucursal. Para meses cerrados se usa el ultimo valor guardado de ese mes («aprox.» = no habia registro y se usa el stock de hoy).
- **Bajas y altas de stock vs facturacion**: operaciones de stock de Onze por motivo (Vencido, Devolucion, Roto, Ajustes, etc.) con signo (altas suman, bajas restan), a costo y a precio de venta, comparadas con la facturacion neta del mes (FV/TF/TK menos notas de credito que anulan esas ventas).

Si Onze no responde, el KPI de diferencias se muestra igual y el resto queda marcado como no disponible.

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

## 8 bis) Padron de productos (admin)

- Los productos se dan de alta **solo en el ERP (Plex)**; desde la app se editan, no se crean.
- Los campos que vienen de Plex (plexdr) u Onze Center se muestran con candado y no se pueden editar: el sync del padron los sobrescribe. Solo se editan los campos propios de GSA (categoria, cat_macro, temporada, formato, sub_categoria, comisiones_vc, cronica, etc.).

### Activar productos dados de baja en el ERP

La columna **activo** la sincroniza Plex y no se puede editar. Para usar en esta app un producto que el ERP dio de baja, poner **activomanual** en `S`: la app considera vigente un producto si `activo = S` **o** `activomanual = S` (escaneo, buscadores, inventarios y vencimientos). Para desactivarlo, volver a dejarlo en `N`. Se puede hacer de a un producto o con la edicion masiva.

### Edicion masiva

1. Elegi los productos: tildando el casillero de cada fila (la seleccion se mantiene al cambiar de pagina) o buscando y usando «todos los resultados de la busqueda».
2. Abri **Edicion masiva**, elegi una o varias columnas editables y escribi el nuevo valor de cada una («Dejar vacio» borra el contenido).
3. Confirma: antes de aplicar se muestra cuantos productos se modifican y con que valores. El cambio se aplica a **todas** las coincidencias de la busqueda (aunque sean miles) y no se puede deshacer: revisa bien ese numero antes de confirmar.

## 9) Vencimientos - por vencer

1. Ir a `Vencimientos > Por vencer`.
2. Filtrar por periodo (30/60/90 y variantes) y categoria.
3. Buscar por descripcion/presentacion/codigo.
4. Si se vendio stock de una linea, usar **Vendido** e indicar cuantas unidades (cajas). Cuando lo vendido llega a lo cargado, la linea queda liquidada.
5. Si te equivocaste en la cantidad vendida, usar **Arreglar vendido**.
6. Usar **Quitar** solo para corregir un error de carga (no es una venta).

> Nota tecnica: el descuento automatico de ventas (Onze/Quantio) esta desactivado.
> Para reactivarlo ver `docs/VENTAS_AUTO_POR_VENCER.md`.

## 10) Vencimientos - vencidos / para devolver

- Lista productos vencidos segun reglas por categoria macro.
- El saldo restante es el de la carga menos lo marcado como vendido a mano.
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

