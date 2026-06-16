-- =============================================================
-- EcoTerra · BI de accesos (visitas/deliveries) — SOLO junta (admin)
-- Ejecutar UNA VEZ en SQL Editor (después de 01-09).
--
-- Importante: cleanup_delivery_visits() borra deliveries (3h/30min). Para no
-- perder el histórico para BI, ahora ARCHIVA un registro mínimo antes de borrar.
-- Las funciones bi_visits_* leen visitas vivas + archivadas. Cada función
-- verifica auth_role()='admin'; si no, devuelve vacío (no fuga de datos).
-- =============================================================

-- ---------- 1. Archivo mínimo de visitas (sin PII de nombres) ----------
create table if not exists visit_archive (
  id            uuid primary key default gen_random_uuid(),
  expected_date date not null,
  type          visit_type not null,
  status        visit_status not null,
  house_id      uuid,
  announced_by  uuid,            -- null = walk-in (registrada por vigilante)
  archived_at   timestamptz not null default now()
);

alter table visit_archive enable row level security;
create policy "admin reads visit_archive" on visit_archive for select
  using (auth_role() = 'admin');

-- ---------- 2. Limpieza de deliveries: archivar antes de borrar ----------
create or replace function cleanup_delivery_visits()
returns int
language plpgsql security definer set search_path = public
as $$
declare v_count int;
begin
  with doomed as (
    select id, expected_date, type, status, house_id, announced_by
    from visits
    where type = 'delivery'
      and (
        (status = 'announced' and created_at < now() - interval '3 hours')
        or (status in ('arrived', 'denied') and checked_at is not null
            and checked_at < now() - interval '30 minutes')
      )
  ),
  archived as (
    insert into visit_archive (expected_date, type, status, house_id, announced_by)
    select expected_date, type, status, house_id, announced_by from doomed
  )
  delete from visits where id in (select id from doomed);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------- 3. Resumen de accesos del período (tarjetas KPI) ----------
create or replace function bi_visits_summary(p_months int default 12)
returns table (total bigint, deliveries bigint, visits bigint,
               denied bigint, announced_app bigint, walkins bigint)
language plpgsql stable security definer set search_path = public
as $$
begin
  if auth_role() <> 'admin' then return; end if;
  return query
  with all_v as (
    select expected_date, type, status, announced_by from visits
    union all
    select expected_date, type, status, announced_by from visit_archive
  )
  select
    count(*),
    count(*) filter (where type = 'delivery'),
    count(*) filter (where type = 'visit'),
    count(*) filter (where status = 'denied'),
    count(*) filter (where announced_by is not null),
    count(*) filter (where announced_by is null)
  from all_v
  where expected_date >= (date_trunc('month', current_date) - ((p_months - 1) || ' months')::interval)::date;
end;
$$;

-- ---------- 4. Accesos por mes (visitas / deliveries / denegadas) ----------
create or replace function bi_visits_monthly(p_months int default 12)
returns table (month text, visits bigint, deliveries bigint, denied bigint)
language plpgsql stable security definer set search_path = public
as $$
begin
  if auth_role() <> 'admin' then return; end if;
  return query
  with all_v as (
    select expected_date, type, status from visits
    union all
    select expected_date, type, status from visit_archive
  ),
  months as (
    select to_char(d, 'YYYY-MM') as m
    from generate_series(
      date_trunc('month', current_date) - ((p_months - 1) || ' months')::interval,
      date_trunc('month', current_date), '1 month'
    ) d
  )
  select m.m,
    (select count(*) from all_v v where to_char(v.expected_date, 'YYYY-MM') = m.m and v.type = 'visit'),
    (select count(*) from all_v v where to_char(v.expected_date, 'YYYY-MM') = m.m and v.type = 'delivery'),
    (select count(*) from all_v v where to_char(v.expected_date, 'YYYY-MM') = m.m and v.status = 'denied')
  from months m order by m.m;
end;
$$;

-- ---------- 5. Casas con más accesos (top 8) ----------
create or replace function bi_visits_by_house(p_months int default 12)
returns table (house_code text, total bigint)
language plpgsql stable security definer set search_path = public
as $$
begin
  if auth_role() <> 'admin' then return; end if;
  return query
  with all_v as (
    select expected_date, house_id from visits
    union all
    select expected_date, house_id from visit_archive
  )
  select h.code, count(*)
  from all_v v join houses h on h.id = v.house_id
  where v.expected_date >= (date_trunc('month', current_date) - ((p_months - 1) || ' months')::interval)::date
  group by h.code order by count(*) desc limit 8;
end;
$$;

grant execute on function bi_visits_summary(int)  to authenticated;
grant execute on function bi_visits_monthly(int)  to authenticated;
grant execute on function bi_visits_by_house(int) to authenticated;
