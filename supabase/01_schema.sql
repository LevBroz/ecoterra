-- =============================================================
-- EcoTerra · Esquema de base de datos (Supabase / Postgres)
-- Ejecutar en SQL Editor de Supabase, en orden: 01, 02, 03, 04
-- =============================================================

-- ---------- Tipos ----------
create type user_role as enum ('admin', 'resident', 'guard');
create type fee_status as enum ('pending', 'paid', 'overdue', 'waived');
create type payment_method as enum ('transfer', 'cash', 'card', 'other');
create type reservation_status as enum ('pending', 'approved', 'rejected', 'cancelled');
create type visit_type as enum ('visit', 'delivery');
create type visit_status as enum ('announced', 'arrived', 'denied', 'cancelled');
create type tx_category as enum (
  'mantenimiento', 'seguridad', 'limpieza', 'jardineria',
  'administracion', 'inversion', 'reparaciones', 'servicios', 'otros'
);

-- ---------- Casas ----------
create table houses (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,          -- ej. "A-12"
  owner_name  text not null,
  phone       text,
  email       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------- Perfiles (extiende auth.users) ----------
create table profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  role       user_role not null default 'resident',
  full_name  text not null,
  house_id   uuid references houses (id),   -- null para admin/guard
  created_at timestamptz not null default now(),
  constraint resident_needs_house
    check (role <> 'resident' or house_id is not null)
);

-- ---------- Cuotas mensuales ----------
create table fees (
  id         uuid primary key default gen_random_uuid(),
  house_id   uuid not null references houses (id),
  period     text not null,                 -- 'YYYY-MM'
  concept    text not null default 'Mensualidad',
  amount     numeric(12,2) not null check (amount >= 0),
  due_date   date not null,
  status     fee_status not null default 'pending',
  created_at timestamptz not null default now(),
  unique (house_id, period, concept)
);

-- ---------- Pagos ----------
create table payments (
  id           uuid primary key default gen_random_uuid(),
  house_id     uuid not null references houses (id),
  fee_id       uuid references fees (id),
  amount       numeric(12,2) not null check (amount > 0),
  method       payment_method not null default 'transfer',
  reference    text,                        -- nro. de transferencia / recibo
  receipt_url  text,                        -- comprobante en Supabase Storage
  paid_at      date not null default current_date,
  recorded_by  uuid not null references profiles (id),
  notes        text,
  created_at   timestamptz not null default now()
);

-- ---------- Anuncios de la junta ----------
create table announcements (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  body         text not null,
  pinned       boolean not null default false,
  published_at timestamptz not null default now(),
  author_id    uuid not null references profiles (id)
);

-- ---------- Zonas sociales ----------
create table amenities (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,                -- ej. "Salón de eventos"
  description text,
  capacity    int,
  fee         numeric(12,2) not null default 0,  -- costo de reserva
  active      boolean not null default true
);

-- ---------- Reservas ----------
create table reservations (
  id          uuid primary key default gen_random_uuid(),
  amenity_id  uuid not null references amenities (id),
  house_id    uuid not null references houses (id),
  event_name  text not null,
  date        date not null,
  start_time  time not null,
  end_time    time not null,
  status      reservation_status not null default 'pending',
  notes       text,
  reviewed_by uuid references profiles (id),
  created_at  timestamptz not null default now(),
  constraint valid_range check (end_time > start_time)
);

-- ---------- Visitas y deliveries ----------
create table visits (
  id            uuid primary key default gen_random_uuid(),
  house_id      uuid not null references houses (id),
  type          visit_type not null default 'visit',
  visitor_name  text not null,
  company       text,                       -- para delivery: empresa
  plate         text,                       -- placa vehículo (opcional)
  expected_date date not null default current_date,
  status        visit_status not null default 'announced',
  announced_by  uuid references profiles (id),   -- residente que anuncia
  checked_by    uuid references profiles (id),   -- vigilante que registra
  checked_at    timestamptz,
  notes         text,
  created_at    timestamptz not null default now()
);

-- ---------- Transparencia: gastos e inversiones ----------
create table transactions (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('expense', 'investment')),
  category    tx_category not null default 'otros',
  description text not null,
  amount      numeric(12,2) not null check (amount > 0),
  tx_date     date not null default current_date,
  receipt_url text,
  created_by  uuid not null references profiles (id),
  created_at  timestamptz not null default now()
);

-- ---------- Configuración ----------
create table settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

insert into settings (key, value) values
  ('monthly_fee_amount', '50.00'),
  ('fee_due_day', '10'),               -- día del mes en que vence la cuota
  ('currency', 'USD');

-- ---------- Índices ----------
create index idx_fees_house_status   on fees (house_id, status);
create index idx_fees_period         on fees (period);
create index idx_payments_house      on payments (house_id, paid_at);
create index idx_visits_date_status  on visits (expected_date, status);
create index idx_reservations_date   on reservations (date, status);
create index idx_transactions_date   on transactions (tx_date, kind);
