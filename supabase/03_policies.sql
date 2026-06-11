-- =============================================================
-- EcoTerra · Row Level Security
-- Reglas:
--   admin    → todo
--   resident → sus datos; anunciar visita/reservar SOLO si al día
--   guard    → visitas del día, lectura de estado de pago
--   transparencia (transactions) → lectura para todos los autenticados
-- =============================================================

alter table houses        enable row level security;
alter table profiles      enable row level security;
alter table fees          enable row level security;
alter table payments      enable row level security;
alter table announcements enable row level security;
alter table amenities     enable row level security;
alter table reservations  enable row level security;
alter table visits        enable row level security;
alter table transactions  enable row level security;
alter table settings      enable row level security;

-- ---------- profiles ----------
create policy "own profile read" on profiles for select
  using (id = auth.uid() or auth_role() = 'admin');
create policy "admin manage profiles" on profiles for all
  using (auth_role() = 'admin') with check (auth_role() = 'admin');

-- ---------- houses ----------
create policy "read houses" on houses for select
  using (auth.uid() is not null);   -- guard necesita listar casas
create policy "admin manage houses" on houses for all
  using (auth_role() = 'admin') with check (auth_role() = 'admin');

-- ---------- fees ----------
create policy "resident reads own fees" on fees for select
  using (house_id = auth_house_id() or auth_role() in ('admin', 'guard'));
create policy "admin manage fees" on fees for all
  using (auth_role() = 'admin') with check (auth_role() = 'admin');

-- ---------- payments ----------
create policy "resident reads own payments" on payments for select
  using (house_id = auth_house_id() or auth_role() = 'admin');
-- INSERT/UPDATE de pagos: solo backend (service role salta RLS) o admin
create policy "admin manage payments" on payments for all
  using (auth_role() = 'admin') with check (auth_role() = 'admin');

-- ---------- announcements ----------
create policy "everyone reads announcements" on announcements for select
  using (auth.uid() is not null);
create policy "admin manage announcements" on announcements for all
  using (auth_role() = 'admin') with check (auth_role() = 'admin');

-- ---------- amenities ----------
create policy "everyone reads amenities" on amenities for select
  using (auth.uid() is not null);
create policy "admin manage amenities" on amenities for all
  using (auth_role() = 'admin') with check (auth_role() = 'admin');

-- ---------- reservations ----------
create policy "read reservations" on reservations for select
  using (house_id = auth_house_id() or auth_role() = 'admin');
-- Regla de negocio: reservar solo si la casa está al día
create policy "resident reserves if current" on reservations for insert
  with check (
    auth_role() = 'resident'
    and house_id = auth_house_id()
    and is_house_current(auth_house_id())
  );
create policy "resident cancels own pending" on reservations for update
  using (house_id = auth_house_id() and status = 'pending')
  with check (status = 'cancelled');
create policy "admin manage reservations" on reservations for all
  using (auth_role() = 'admin') with check (auth_role() = 'admin');

-- ---------- visits ----------
create policy "read visits" on visits for select
  using (house_id = auth_house_id() or auth_role() in ('admin', 'guard'));
-- Regla de negocio: anunciar visita/delivery solo si la casa está al día
create policy "resident announces if current" on visits for insert
  with check (
    auth_role() = 'resident'
    and house_id = auth_house_id()
    and is_house_current(auth_house_id())
  );
create policy "resident cancels own announced" on visits for update
  using (house_id = auth_house_id() and status = 'announced')
  with check (status = 'cancelled');
-- Vigilante registra llegada o niega entrada
create policy "guard checks visits" on visits for update
  using (auth_role() = 'guard')
  with check (auth_role() = 'guard' and status in ('arrived', 'denied'));
-- Vigilante registra visita no anunciada (walk-in)
create policy "guard registers walkin" on visits for insert
  with check (auth_role() = 'guard');
create policy "admin manage visits" on visits for all
  using (auth_role() = 'admin') with check (auth_role() = 'admin');

-- ---------- transactions (transparencia) ----------
create policy "everyone reads transactions" on transactions for select
  using (auth.uid() is not null);
create policy "admin manage transactions" on transactions for all
  using (auth_role() = 'admin') with check (auth_role() = 'admin');

-- ---------- settings ----------
create policy "everyone reads settings" on settings for select
  using (auth.uid() is not null);
create policy "admin manage settings" on settings for all
  using (auth_role() = 'admin') with check (auth_role() = 'admin');
