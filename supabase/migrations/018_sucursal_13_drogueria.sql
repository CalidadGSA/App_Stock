-- Marcar sucursal 13 como droguería central (Quantio).
update sucursales
set es_drogueria = true
where sucursal = 13;
