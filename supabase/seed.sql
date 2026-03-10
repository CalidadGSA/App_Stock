-- ============================================================
-- SEED: datos de prueba para Supabase
-- Ejecutar DESPUÉS del schema.sql
-- Reemplazar con datos reales antes de producción
-- ============================================================

-- Contraseña de prueba para sucursales (texto plano "sucursal123" para seed; en producción usar hash)
-- Para hash bcrypt: node -e "const b=require('bcryptjs'); console.log(b.hashSync('sucursal123',10))"

-- 1. Categorías (sin dependencias)
-- Postgres guarda nombres de columna en minúsculas si el schema no usa comillas
insert into categorias (idcategoria, nombre) values
  (1, 'Medicamentos'),
  (2, 'Higiene'),
  (3, 'Cosméticos')
on conflict (idcategoria) do nothing;

-- 2. Rubros (sin dependencias)
insert into rubros (codrubro, rubro) values
  (1, 'Analgésicos'),
  (2, 'Antihipertensivos'),
  (3, 'Antibióticos'),
  (4, 'Antidiabéticos'),
  (5, 'Antiácidos'),
  (6, 'Otros')
on conflict (codrubro) do nothing;

-- 3. Psicofármacos (sin dependencias)
insert into psicofarmacos (idpsicofarmaco, nombre) values
  ('N', 'No'),
  ('S', 'Sí'),
  ('RV', 'Receta verde')
on conflict (idpsicofarmaco) do nothing;

-- 4. Subrubros (dependen de rubros y categorías)
insert into subrubros (idsubrubro, nombre, idrubro, idcategoria) values
  (1, 'Analgésicos comunes', 1, 1),
  (2, 'IECA', 2, 1),
  (3, 'Penicilinas', 3, 1),
  (4, 'Biguanidas', 4, 1),
  (5, 'Inhibidores bomba protones', 5, 1)
on conflict (idsubrubro) do nothing;

-- 5. Sucursales
insert into sucursales (sucursal, nombrefantasia, domicilio, telefono, email, _codpostal, contraseña, activa) values
  (1, 'Sucursal Central', 'Av. Principal 100', '011 4567-8900', 'central@farmacia.com', '1043', 'sucursal123', true),
  (2, 'Sucursal Norte', 'Calle Norte 250', '011 4567-8901', 'norte@farmacia.com', '1430', 'sucursal123', true),
  (3, 'Sucursal Sur', 'Av. Sur 500', '011 4567-8902', 'sur@farmacia.com', '1406', 'sucursal123', true)
on conflict (sucursal) do nothing;

-- 6. Operadores
insert into operadores (idoperador, operador, nombrecompleto, codigo, rol, activo) values
  (1, 'admin', 'Administrador', 100, 'admin', 'S'),
  (2, 'operador1', 'Juan Pérez', 101, 'operador_sucursal', 'S'),
  (3, 'operador2', 'María García', 102, 'operador_sucursal', 'S')
on conflict (idoperador) do nothing;

-- 7. Medicamentos (dependen de rubros, subrubros, psicofarmacos)
insert into medicamentos (
  codplex, troquel, codlab, codebar, producto, presentaci, precio, costo,
  activo, cod_rubro, idsubrubro, idpsicofarmaco, visible, refrigeracion
) values
  (1, 12345, 10, '7790040005088', 'TAFIROL 500MG', 'CAJA x 20 COMP', 850.00, 420.00, 'S', 1, 1, 'N', 1, 'N'),
  (2, 12346, 11, '7798040805053', 'IBUPROFENO 400MG', 'CAJA x 20 COMP', 720.50, 350.00, 'S', 1, 1, 'N', 1, 'N'),
  (3, 12347, 12, '7793640007060', 'AMOXICILINA 500MG', 'CAJA x 15 CAPS', 1200.00, 600.00, 'S', 3, 3, 'N', 1, 'N'),
  (4, 12348, 13, '7790040900116', 'PARACETAMOL 500MG', 'CAJA x 24 COMP', 650.00, 320.00, 'S', 1, 1, 'N', 1, 'N'),
  (5, 12349, 14, '7702001005075', 'LOSARTAN 50MG', 'CAJA x 30 COMP', 980.00, 490.00, 'S', 2, 2, 'N', 1, 'N'),
  (6, 12350, 15, '7798010360015', 'ENALAPRIL 10MG', 'CAJA x 40 COMP', 550.00, 280.00, 'S', 2, 2, 'N', 1, 'N'),
  (7, 12351, 16, '7792397002091', 'METFORMINA 850MG', 'CAJA x 60 COMP', 890.00, 445.00, 'S', 4, 4, 'N', 1, 'N'),
  (8, 12352, 17, '7791519003018', 'OMEPRAZOL 20MG', 'CAJA x 14 CAPS', 1100.00, 550.00, 'S', 5, 5, 'N', 1, 'N')
on conflict (codplex) do nothing;

-- 8. Sync status (opcional, para que la API de sync vea estado)
insert into sync_status (key, completed, updated_at) values
  ('legacy_full', false, now())
on conflict (key) do nothing;

-- 9. Un control de inventario de prueba (opcional)
-- Solo se inserta si existen sucursal 1 y operador 1. Re-ejecutar el seed agrega más controles.
insert into controles_inventario (sucursal_id, usuario_id, estado, descripcion)
select 1, 1, 'en_progreso', 'Control de prueba seed'
where exists (select 1 from sucursales where sucursal = 1)
  and exists (select 1 from operadores where idoperador = 1);

-- 10. Detalle del último control de prueba (un ítem)
insert into controles_inventario_detalle (control_id, producto_id_sistema, codigo_barras, descripcion, presentacion, laboratorio, stock_sistema, stock_real)
select
  c.id,
  '1',
  '7790040005088',
  'TAFIROL 500MG',
  'CAJA x 20 COMP',
  null,
  100,
  98
from controles_inventario c
where c.sucursal_id = 1 and c.usuario_id = 1
order by c.created_at desc
limit 1;

-- ============================================================
-- Notas
-- ============================================================
-- • Los usuarios de la app (login) se crean con Supabase Auth; no hay tabla usuarios en este schema.
-- • contraseña en sucursales: en producción reemplazar por hash bcrypt.
-- • Para más datos de prueba, ejecutar el sync desde la API (POST /api/datos/sync) si tenés MySQL legacy.
