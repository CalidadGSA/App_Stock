-- ============================================================
-- SEED: datos de prueba
-- Ejecutar DESPUÉS del schema.sql
-- Reemplazar con datos reales antes de producción
-- ============================================================

-- Sucursales de prueba (contraseña: "sucursal123" -> hash bcrypt)
-- Para generar un hash nuevo: node -e "const b=require('bcryptjs'); console.log(b.hashSync('sucursal123',10))"
insert into sucursales (nombre, codigo_interno, ubicacion, password_hash) values
  ('Sucursal Central',  'SUC01', 'Av. Principal 100',   '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lh02'),
  ('Sucursal Norte',   'SUC02', 'Calle Norte 250',     '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lh02'),
  ('Sucursal Sur',     'SUC03', 'Av. Sur 500',         '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lh02');

-- Productos cache de prueba (EAN13 ficticios)
insert into productos_cache (producto_id_sistema, codigo_barras, descripcion, presentacion, laboratorio) values
  ('PRD001', '7790040005088', 'TAFIROL 500MG',         'CAJA x 20 COMP',  'BAGO'),
  ('PRD002', '7798040805053', 'IBUPROFENO 400MG',      'CAJA x 20 COMP',  'ROEMMERS'),
  ('PRD003', '7793640007060', 'AMOXICILINA 500MG',     'CAJA x 15 CAPS',  'RICHMOND'),
  ('PRD004', '7790040900116', 'PARACETAMOL 500MG',     'CAJA x 24 COMP',  'GENFAR'),
  ('PRD005', '7702001005075', 'LOSARTAN 50MG',         'CAJA x 30 COMP',  'BERNABO'),
  ('PRD006', '7798010360015', 'ENALAPRIL 10MG',        'CAJA x 40 COMP',  'NORTHIA'),
  ('PRD007', '7792397002091', 'METFORMINA 850MG',      'CAJA x 60 COMP',  'VARIFARMA'),
  ('PRD008', '7791519003018', 'OMEPRAZOL 20MG',        'CAJA x 14 CAPS',  'MONTPELLIER');

-- Nota: los usuarios se crean a través de Supabase Auth + trigger automático.
-- Para hacer admin a un usuario:
-- update usuarios set rol = 'admin' where email = 'admin@farmacia.com';
