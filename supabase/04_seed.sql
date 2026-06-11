-- =============================================================
-- EcoTerra · Datos de prueba
-- NOTA: los usuarios (auth.users) se crean desde el Dashboard de
-- Supabase (Authentication > Users) o con la API admin del backend.
-- Después de crearlos, inserta sus profiles aquí con el UUID real.
-- =============================================================

-- Casas
insert into houses (code, owner_name, phone, email) values
  ('A-01', 'Familia Pérez',  '555-0101', 'perez@example.com'),
  ('A-02', 'Familia Gómez',  '555-0102', 'gomez@example.com'),
  ('B-01', 'Familia Rivas',  '555-0103', 'rivas@example.com'),
  ('B-02', 'Familia Castro', '555-0104', 'castro@example.com');

-- Zonas sociales
insert into amenities (name, description, capacity, fee) values
  ('Salón de eventos', 'Salón principal con cocina', 80, 25.00),
  ('Área de BBQ',      'Parrillas y mesas al aire libre', 30, 10.00),
  ('Cancha multiuso',  'Fútbol sala / básquet', 20, 0),
  ('Piscina',          'Área de piscina (eventos privados)', 40, 15.00);

-- Cuotas del mes corriente para todas las casas
select generate_monthly_fees();

-- Ejemplo de transacciones para transparencia
insert into transactions (kind, category, description, amount, tx_date, created_by)
select 'expense', 'seguridad', 'Servicio de vigilancia mensual', 800.00,
       date_trunc('month', current_date)::date, p.id
from profiles p where p.role = 'admin' limit 1;

-- Plantilla de profiles (reemplazar UUIDs por los reales de auth.users):
-- insert into profiles (id, role, full_name, house_id) values
--   ('<uuid-admin>',    'admin',    'Junta Directiva', null),
--   ('<uuid-guard>',    'guard',    'Vigilante Portería', null),
--   ('<uuid-resident>', 'resident', 'Familia Pérez',
--      (select id from houses where code = 'A-01'));
