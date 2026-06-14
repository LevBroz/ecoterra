-- =============================================================
-- EcoTerra · Seed enriquecido para DEMO
-- Requiere haber ejecutado: 01, 02, 03, 05_seed_demo, 07_updates.
-- Es ADITIVO e idempotente (ON CONFLICT / NOT EXISTS): se puede
-- correr una vez sobre el seed básico sin duplicar nada.
--
-- Qué agrega:
--   · 12 casas nuevas (16 en total)
--   · 12 meses de cuotas para todas + 1 cuota extraordinaria (derrama)
--   · Pagos por cada cuota pagada + abonos libres
--   · 12 meses de gastos por categoría + 3 inversiones (para BI)
--   · Visitas de hoy e históricas, reservas en varios estados
--   · Anuncios con vigencia/imagen/programados/expirados + lecturas
--   · Formularios descargables
--
-- Casas en mora (para demo de cobranza): A-02, B-04, C-02, A-05
-- =============================================================

-- ---------- 1. Más casas ----------
insert into houses (code, owner_name, phone, email) values
  ('A-03', 'Familia Hernández', '555-0203', 'hernandez@example.com'),
  ('A-04', 'Familia Torres',    '555-0204', 'torres@example.com'),
  ('A-05', 'Familia Ramírez',   '555-0205', 'ramirez@example.com'),
  ('A-06', 'Familia Flores',    '555-0206', 'flores@example.com'),
  ('B-03', 'Familia Díaz',      '555-0303', 'diaz@example.com'),
  ('B-04', 'Familia Morales',   '555-0304', 'morales@example.com'),
  ('B-05', 'Familia Romero',    '555-0305', 'romero@example.com'),
  ('B-06', 'Familia Vargas',    '555-0306', 'vargas@example.com'),
  ('C-01', 'Familia Mendoza',   '555-0401', 'mendoza@example.com'),
  ('C-02', 'Familia Aguilar',   '555-0402', 'aguilar@example.com'),
  ('C-03', 'Familia Navarro',   '555-0403', 'navarro@example.com'),
  ('C-04', 'Familia Reyes',     '555-0404', 'reyes@example.com')
on conflict (code) do nothing;

-- ---------- 2. Cuotas: 12 meses para todas las casas activas ----------
-- Las casas pagadoras quedan 'paid'; las de mora dejan sin pagar los
-- últimos 3 meses (genera morosidad realista y baja la tasa de cobranza
-- reciente). Las filas que ya existían (seed 05) no se tocan.
insert into fees (house_id, period, concept, amount, due_date, status)
select
  h.id,
  to_char(m, 'YYYY-MM'),
  'Mensualidad',
  50.00,
  (date_trunc('month', m) + interval '8 days')::date,
  case
    when m >= date_trunc('month', current_date) - interval '2 months'
         and h.code = any (array['A-02','B-04','C-02','A-05'])
      then (case when (date_trunc('month', m) + interval '8 days')::date < current_date
                 then 'overdue' else 'pending' end)
    else 'paid'
  end::fee_status
from houses h
cross join generate_series(
  date_trunc('month', current_date) - interval '11 months',
  date_trunc('month', current_date),
  interval '1 month'
) m
where h.active
on conflict (house_id, period, concept) do nothing;

-- ---------- 2b. Cuota extraordinaria (derrama), hace 4 meses ----------
insert into fees (house_id, period, concept, amount, due_date, status)
select
  h.id,
  to_char(date_trunc('month', current_date) - interval '4 months', 'YYYY-MM'),
  'Derrama: pintura de fachadas',
  35.00,
  (date_trunc('month', current_date) - interval '4 months' + interval '14 days')::date,
  case when h.code = any (array['A-02','B-04','C-02','A-05'])
       then 'overdue' else 'paid' end::fee_status
from houses h
where h.active
on conflict (house_id, period, concept) do nothing;

-- ---------- 3. Pagos por cada cuota pagada ----------
insert into payments (house_id, fee_id, amount, method, reference, paid_at, recorded_by)
select
  f.house_id, f.id, f.amount,
  (array['transfer','cash','card','transfer'])[floor(random()*4)+1]::payment_method,
  'PAY-' || f.period || '-' || left(f.house_id::text, 4),
  least((date_trunc('month', to_date(f.period, 'YYYY-MM')) + interval '7 days'
         + (floor(random()*5) || ' days')::interval)::date, current_date),
  (select id from profiles where role = 'admin' limit 1)
from fees f
where f.status = 'paid'
  and not exists (select 1 from payments p where p.fee_id = f.id);

-- ---------- 3b. Abonos libres (pago sin cuota específica) ----------
insert into payments (house_id, amount, method, reference, paid_at, notes, recorded_by)
select h.id, 25.00, 'cash', 'ABONO-FONDO', current_date - 15,
       'Abono voluntario al fondo común',
       (select id from profiles where role = 'admin' limit 1)
from houses h
where h.code in ('A-01', 'B-02')
  and not exists (
    select 1 from payments p
    where p.house_id = h.id and p.notes = 'Abono voluntario al fondo común'
  );

-- ---------- 4. Gastos mensuales por categoría (12 meses) ----------
insert into transactions (kind, category, description, amount, tx_date, created_by)
select
  'expense', t.cat::tx_category,
  t.descr || ' ' || to_char(m, 'YYYY-MM'),
  round((t.base + random() * t.var)::numeric, 2),
  (date_trunc('month', m) + interval '12 days')::date,
  (select id from profiles where role = 'admin' limit 1)
from generate_series(
  date_trunc('month', current_date) - interval '11 months',
  date_trunc('month', current_date),
  interval '1 month'
) m
cross join (values
  ('seguridad',      'Vigilancia y monitoreo',        220, 30),
  ('limpieza',       'Limpieza de áreas comunes',     110, 25),
  ('jardineria',     'Mantenimiento de jardines',      75, 20),
  ('servicios',      'Electricidad y agua comunes',    95, 35),
  ('administracion', 'Gastos administrativos',         45, 15)
) as t(cat, descr, base, var)
where not exists (
  select 1 from transactions x
  where x.description = t.descr || ' ' || to_char(m, 'YYYY-MM')
);

-- 4b. Reparaciones esporádicas (cada 3 meses)
insert into transactions (kind, category, description, amount, tx_date, created_by)
select
  'expense', 'reparaciones'::tx_category,
  'Reparaciones varias ' || to_char(m, 'YYYY-MM'),
  round((130 + random() * 80)::numeric, 2),
  (date_trunc('month', m) + interval '18 days')::date,
  (select id from profiles where role = 'admin' limit 1)
from generate_series(
  date_trunc('month', current_date) - interval '11 months',
  date_trunc('month', current_date),
  interval '1 month'
) m
where extract(month from m)::int % 3 = 0
  and not exists (
    select 1 from transactions x
    where x.description = 'Reparaciones varias ' || to_char(m, 'YYYY-MM')
  );

-- 4c. Inversiones (montos grandes → dan picos/saldos negativos para MoM)
insert into transactions (kind, category, description, amount, tx_date, created_by)
select 'investment', 'inversion'::tx_category, v.descr, v.amount,
       (date_trunc('month', current_date) - (v.months_ago || ' months')::interval
        + interval '10 days')::date,
       (select id from profiles where role = 'admin' limit 1)
from (values
  ('Cámaras de seguridad perimetrales', 850.00, 4),
  ('Remodelación del área de BBQ',      600.00, 8),
  ('Portón eléctrico de acceso',        420.00, 2)
) as v(descr, amount, months_ago)
where not exists (select 1 from transactions x where x.description = v.descr);

-- ---------- 5. Visitas de HOY (panel vigilante) ----------
insert into visits (house_id, type, visitor_name, company, plate, expected_date, status, announced_by)
select v.house_id, v.type::visit_type, v.visitor_name, v.company, v.plate,
       current_date, 'announced'::visit_status, v.announced_by
from (values
  ((select id from houses where code='B-01'), 'visit',    'Carlos Méndez',         null,        'XYZ-987', null::uuid),
  ((select id from houses where code='A-03'), 'delivery',  'Repartidor Uber Eats',  'Uber Eats', null,      null::uuid),
  ((select id from houses where code='C-01'), 'visit',     'Abuela González',       null,        'JKL-456', null::uuid),
  ((select id from houses where code='B-02'), 'delivery',  'Mensajería Amazon',     'Amazon',    null,      null::uuid)
) as v(house_id, type, visitor_name, company, plate, announced_by)
where not exists (
  select 1 from visits x
  where x.visitor_name = v.visitor_name and x.expected_date = current_date
);

-- ---------- 5b. Visitas históricas (historial del residente) ----------
insert into visits (house_id, type, visitor_name, company, plate, expected_date,
                    status, announced_by, checked_by, checked_at, created_at)
select v.house_id, v.type::visit_type, v.visitor_name, v.company, v.plate,
       v.expected_date, v.status::visit_status, v.announced_by,
       (select id from profiles where role='guard' limit 1), v.checked_at, v.created_at
from (values
  ((select id from houses where code='A-01'), 'visit',    'Tía Marta',             null,  'AAA-111',
     current_date - 3, 'arrived',
     (select id from profiles where house_id=(select id from houses where code='A-01')),
     now() - interval '3 days', now() - interval '3 days'),
  ((select id from houses where code='A-01'), 'delivery', 'Mensajería DHL',        'DHL', null,
     current_date - 7, 'arrived',
     (select id from profiles where house_id=(select id from houses where code='A-01')),
     now() - interval '7 days', now() - interval '7 days'),
  ((select id from houses where code='A-02'), 'visit',    'Vendedor no autorizado', null, null,
     current_date - 2, 'denied', null,
     now() - interval '2 days', now() - interval '2 days')
) as v(house_id, type, visitor_name, company, plate, expected_date,
       status, announced_by, checked_at, created_at)
where not exists (select 1 from visits x where x.visitor_name = v.visitor_name);

-- ---------- 6. Reservas en varios estados ----------
insert into reservations (amenity_id, house_id, event_name, date, start_time, end_time,
                          status, reviewed_by, created_at)
select v.amenity_id, v.house_id, v.event_name, v.date,
       v.start_time::time, v.end_time::time, v.status::reservation_status,
       v.reviewed_by, v.created_at
from (values
  ((select id from amenities where name='Área de BBQ'),     (select id from houses where code='B-01'),
     'Reunión familiar',  current_date + 5,  '12:00', '17:00', 'pending',  null::uuid,
     now()),
  ((select id from amenities where name='Cancha multiuso'), (select id from houses where code='A-01'),
     'Torneo de fútbol',  current_date - 10, '15:00', '18:00', 'approved',
     (select id from profiles where role='admin' limit 1), now() - interval '15 days'),
  ((select id from amenities where name='Piscina'),         (select id from houses where code='B-02'),
     'Fiesta de verano',  current_date + 20, '14:00', '19:00', 'approved',
     (select id from profiles where role='admin' limit 1), now() - interval '2 days'),
  ((select id from amenities where name='Salón de eventos'),(select id from houses where code='B-01'),
     'Evento comercial',  current_date - 5,  '10:00', '20:00', 'rejected',
     (select id from profiles where role='admin' limit 1), now() - interval '8 days')
) as v(amenity_id, house_id, event_name, date, start_time, end_time, status, reviewed_by, created_at)
where not exists (
  select 1 from reservations r
  where r.event_name = v.event_name and r.house_id = v.house_id
);

-- ---------- 7. Anuncios con vigencia / imagen / programados ----------
-- Las imágenes usan picsum.photos (URLs públicas reales que sí renderizan).
insert into announcements (title, body, pinned, active, starts_at, ends_at, image_url, author_id, published_at)
select v.title, v.body, v.pinned, v.active, v.starts_at, v.ends_at, v.image_url,
       (select id from profiles where role='admin' limit 1), v.published_at
from (values
  ('Asamblea general ordinaria 2026',
   E'Convocamos a todos los propietarios a la asamblea general ordinaria.\n\nFecha: último sábado del mes\nLugar: Salón de eventos\nHora: 9:00 AM\n\nTemas: estados financieros, plan de inversiones y elección de junta directiva. Tu participación es importante.',
   true, true, current_date - 3, current_date + 20,
   'https://picsum.photos/seed/ecoterra-asamblea/800/400', now() - interval '3 days'),
  ('Nuevo horario de la piscina',
   E'A partir de este mes la piscina estará disponible de 8:00 AM a 8:00 PM todos los días.\n\nRecuerda ducharte antes de ingresar y respetar el aforo máximo.',
   false, true, current_date - 1, null,
   'https://picsum.photos/seed/ecoterra-piscina/800/400', now() - interval '1 day'),
  ('Mantenimiento de jardines',
   E'El equipo de jardinería realizará poda y fumigación esta semana en las áreas comunes. Evita estacionar cerca de las zonas verdes.',
   false, true, current_date, current_date + 7, null, now()),
  ('Recordatorio: pago de mantenimiento',
   E'Recuerda que la cuota de mantenimiento vence el día 9 de cada mes. Puedes pagar por transferencia o en la administración.',
   false, true, current_date - 40, current_date - 10, null, now() - interval '40 days'),
  ('Festival de fin de año',
   E'¡Prepárate! Se viene nuestro tradicional festival con música, comida y actividades para toda la familia. Más detalles próximamente.',
   false, true, current_date + 15, current_date + 45,
   'https://picsum.photos/seed/ecoterra-festival/800/400', now())
) as v(title, body, pinned, active, starts_at, ends_at, image_url, published_at)
where not exists (select 1 from announcements a where a.title = v.title);

-- 7b. Marcar algunos como leídos para casa.a01 (demo de leído/no leído)
insert into announcement_reads (announcement_id, user_id)
select a.id, p.id
from announcements a
cross join (
  select id from profiles where house_id = (select id from houses where code='A-01')
) p
where a.title in ('Nuevo horario de la piscina', 'Mantenimiento de jardines')
on conflict do nothing;

-- ---------- 8. Formularios descargables ----------
-- file_url apunta a PDFs públicos de ejemplo (la descarga funciona).
insert into forms (name, description, file_url)
select v.name, v.description, v.file_url
from (values
  ('Solicitud de reserva de salón',
   'Llénalo y adjúntalo al crear tu reserva del salón de eventos.',
   'https://www.africau.edu/images/default/sample.pdf'),
  ('Autorización de evento con música',
   'Requerido para eventos con sonido después de las 6:00 PM.',
   'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf'),
  ('Registro de mascota',
   'Registra a tu mascota ante la administración del residencial.',
   'https://www.africau.edu/images/default/sample.pdf')
) as v(name, description, file_url)
where not exists (select 1 from forms f where f.name = v.name);

-- ---------- Verificación ----------
select 'houses'         as tabla, count(*) from houses
union all select 'profiles',      count(*) from profiles
union all select 'fees',          count(*) from fees
union all select 'fees overdue',  count(*) from fees where status = 'overdue'
union all select 'payments',      count(*) from payments
union all select 'transactions',  count(*) from transactions
union all select 'investments',   count(*) from transactions where kind = 'investment'
union all select 'visits today',  count(*) from visits where expected_date = current_date
union all select 'reservations',  count(*) from reservations
union all select 'reserv pending',count(*) from reservations where status = 'pending'
union all select 'announcements', count(*) from announcements
union all select 'forms',         count(*) from forms;
