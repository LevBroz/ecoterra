-- =============================================================
-- EcoTerra · Seed de demostración con usuarios de prueba
-- Ejecutar UNA SOLA VEZ en SQL Editor (después de 01, 02, 03).
-- No requiere haber corrido 04 (es independiente e idempotente
-- en usuarios/casas/cuotas; transacciones se insertan una vez).
--
-- USUARIOS DE PRUEBA (password junto a cada uno):
--   admin@ecoterra.test      / Admin123!   → rol admin (junta)
--   vigilante@ecoterra.test  / Guard123!   → rol guard (portería)
--   casa.a01@ecoterra.test   / Casa123!    → residente A-01 (AL DÍA)
--   casa.a02@ecoterra.test   / Casa123!    → residente A-02 (EN MORA)
-- =============================================================

-- ---------- 1. Usuarios en auth.users ----------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
) values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'admin@ecoterra.test',
   extensions.crypt('Admin123!', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'vigilante@ecoterra.test',
   extensions.crypt('Guard123!', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333',
   'authenticated', 'authenticated', 'casa.a01@ecoterra.test',
   extensions.crypt('Casa123!', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444',
   'authenticated', 'authenticated', 'casa.a02@ecoterra.test',
   extensions.crypt('Casa123!', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '')
on conflict (id) do nothing;

-- Identidades email (requeridas por GoTrue para login con contraseña)
insert into auth.identities (
  id, user_id, provider_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
)
select gen_random_uuid(), u.id, u.id::text,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
from auth.users u
where u.email like '%@ecoterra.test'
on conflict (provider_id, provider) do nothing;

-- ---------- 2. Casas ----------
insert into houses (code, owner_name, phone, email) values
  ('A-01', 'Familia Pérez',  '555-0101', 'casa.a01@ecoterra.test'),
  ('A-02', 'Familia Gómez',  '555-0102', 'casa.a02@ecoterra.test'),
  ('B-01', 'Familia Rivas',  '555-0103', 'rivas@example.com'),
  ('B-02', 'Familia Castro', '555-0104', 'castro@example.com')
on conflict (code) do nothing;

-- ---------- 3. Perfiles ----------
insert into profiles (id, role, full_name, house_id) values
  ('11111111-1111-1111-1111-111111111111', 'admin', 'Junta Directiva', null),
  ('22222222-2222-2222-2222-222222222222', 'guard', 'Vigilante Portería', null),
  ('33333333-3333-3333-3333-333333333333', 'resident', 'Familia Pérez',
     (select id from houses where code = 'A-01')),
  ('44444444-4444-4444-4444-444444444444', 'resident', 'Familia Gómez',
     (select id from houses where code = 'A-02'))
on conflict (id) do nothing;

-- ---------- 4. Zonas sociales ----------
insert into amenities (name, description, capacity, fee)
select * from (values
  ('Salón de eventos', 'Salón principal con cocina', 80, 25.00),
  ('Área de BBQ',      'Parrillas y mesas al aire libre', 30, 10.00),
  ('Cancha multiuso',  'Fútbol sala / básquet', 20, 0.00),
  ('Piscina',          'Área de piscina (eventos privados)', 40, 15.00)
) as v(name, description, capacity, fee)
where not exists (select 1 from amenities);

-- ---------- 5. Cuotas: últimos 6 meses ----------
-- A-02 queda EN MORA (últimos 2 meses sin pagar); el resto al día.
insert into fees (house_id, period, concept, amount, due_date, status)
select h.id,
       to_char(m, 'YYYY-MM'),
       'Mensualidad',
       50.00,
       (date_trunc('month', m) + interval '9 days')::date,
       case
         when m >= date_trunc('month', current_date) then 'pending'
         when h.code = 'A-02' and m >= date_trunc('month', current_date) - interval '2 months' then 'overdue'
         else 'paid'
       end::fee_status
from houses h
cross join generate_series(
  date_trunc('month', current_date) - interval '5 months',
  date_trunc('month', current_date), interval '1 month'
) m
on conflict (house_id, period, concept) do nothing;

-- ---------- 6. Pagos por cada cuota pagada ----------
insert into payments (house_id, fee_id, amount, method, reference, paid_at, recorded_by)
select f.house_id, f.id, f.amount, 'transfer', 'SEED-' || f.period,
       f.due_date - ((random() * 5)::int), '11111111-1111-1111-1111-111111111111'
from fees f
where f.status = 'paid'
  and not exists (select 1 from payments p where p.fee_id = f.id);

-- ---------- 7. Gastos e inversiones: últimos 6 meses (para BI) ----------
insert into transactions (kind, category, description, amount, tx_date, created_by)
select 'expense', c.cat::tx_category, c.descr,
       round((c.amt + random() * 40)::numeric, 2),
       (date_trunc('month', m) + interval '14 days')::date,
       '11111111-1111-1111-1111-111111111111'
from generate_series(
  date_trunc('month', current_date) - interval '5 months',
  date_trunc('month', current_date), interval '1 month'
) m
cross join (values
  ('seguridad',     'Servicio de vigilancia mensual', 80.00),
  ('limpieza',      'Limpieza de áreas comunes',      35.00),
  ('jardineria',    'Mantenimiento de jardines',      25.00),
  ('servicios',     'Luz y agua de áreas comunes',    30.00)
) as c(cat, descr, amt)
where not exists (select 1 from transactions where description like 'SEED%' or description = 'Servicio de vigilancia mensual');

insert into transactions (kind, category, description, amount, tx_date, created_by)
select * from (values
  ('investment', 'inversion'::tx_category, 'Cámaras de seguridad nuevas', 350.00,
     (date_trunc('month', current_date) - interval '3 months' + interval '5 days')::date,
     '11111111-1111-1111-1111-111111111111'::uuid),
  ('investment', 'inversion'::tx_category, 'Juegos infantiles parque', 280.00,
     (date_trunc('month', current_date) - interval '1 month' + interval '8 days')::date,
     '11111111-1111-1111-1111-111111111111'::uuid)
) as v(kind, category, description, amount, tx_date, created_by)
where not exists (select 1 from transactions where kind = 'investment');

-- ---------- 8. Visitas de HOY (para probar panel vigilante) ----------
insert into visits (house_id, type, visitor_name, company, plate, expected_date, status, announced_by)
select * from (values
  ((select id from houses where code = 'A-01'), 'visit'::visit_type,
    'Juan Martínez', null, 'ABC-123', current_date, 'announced'::visit_status,
    '33333333-3333-3333-3333-333333333333'::uuid),
  ((select id from houses where code = 'A-01'), 'delivery'::visit_type,
    'Pedro Repartidor', 'PedidosYa', null, current_date, 'announced'::visit_status,
    '33333333-3333-3333-3333-333333333333'::uuid),
  ((select id from houses where code = 'A-02'), 'visit'::visit_type,
    'María López', null, null, current_date, 'announced'::visit_status,
    '44444444-4444-4444-4444-444444444444'::uuid)
) as v(house_id, type, visitor_name, company, plate, expected_date, status, announced_by)
where not exists (select 1 from visits);

-- ---------- 9. Reserva pendiente (para probar aprobación admin) ----------
insert into reservations (amenity_id, house_id, event_name, date, start_time, end_time, status)
select (select id from amenities where name = 'Salón de eventos'),
       (select id from houses where code = 'A-01'),
       'Cumpleaños infantil',
       current_date + 7, '14:00', '19:00', 'pending'
where not exists (select 1 from reservations);

-- ---------- 10. Anuncios ----------
insert into announcements (title, body, pinned, author_id)
select * from (values
  ('Bienvenidos a EcoTerra App',
   'Ya está disponible la plataforma de gestión del residencial. Aquí podrás ver tus cuotas, anunciar visitas y reservar zonas sociales.',
   true, '11111111-1111-1111-1111-111111111111'::uuid),
  ('Corte de agua programado',
   'El martes próximo de 8am a 12pm habrá corte de agua por mantenimiento de tuberías en el sector B.',
   false, '11111111-1111-1111-1111-111111111111'::uuid)
) as v(title, body, pinned, author_id)
where not exists (select 1 from announcements);

-- ---------- Verificación ----------
select 'usuarios' as tabla, count(*) from auth.users where email like '%@ecoterra.test'
union all select 'profiles', count(*) from profiles
union all select 'houses', count(*) from houses
union all select 'fees', count(*) from fees
union all select 'payments', count(*) from payments
union all select 'transactions', count(*) from transactions
union all select 'visits', count(*) from visits
union all select 'reservations', count(*) from reservations
union all select 'announcements', count(*) from announcements;
