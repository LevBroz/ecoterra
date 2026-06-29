-- =============================================================
-- EcoTerra · Método de ingreso (QR vs manual) en el BI de accesos
-- Ejecutar UNA VEZ en SQL Editor (después de 01-11).
--
-- "Entró por QR" = la visita tiene pass_used_at (la marcó redeem_visit_pass).
-- "Manual" = ingreso/denegación por botón del vigilante (sin pass_used_at).
-- =============================================================

-- ---------- 1. Conservar el método en el archivo de deliveries ----------
alter table visit_archive add column if not exists via_qr boolean not null default false;

-- Redefinir limpieza para guardar via_qr antes de borrar
create or replace function cleanup_delivery_visits()
returns int
language plpgsql security definer set search_path = public
as $$
declare v_count int;
begin
  with doomed as (
    select id, expected_date, type, status, house_id, announced_by, pass_used_at
    from visits
    where type = 'delivery'
      and (
        (status = 'announced' and created_at < now() - interval '3 hours')
        or (status in ('arrived', 'denied') and checked_at is not null
            and checked_at < now() - interval '30 minutes')
      )
  ),
  archived as (
    insert into visit_archive (expected_date, type, status, house_id, announced_by, via_qr)
    select expected_date, type, status, house_id, announced_by, (pass_used_at is not null)
    from doomed
  )
  delete from visits where id in (select id from doomed);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------- 2. Resumen con conteo de ingresos por QR ----------
-- Cambia el tipo de retorno (agrega qr_entries) → DROP antes de recrear.
drop function if exists bi_visits_summary(int);
create or replace function bi_visits_summary(p_months int default 12)
returns table (total bigint, deliveries bigint, visits bigint, denied bigint,
               announced_app bigint, walkins bigint, qr_entries bigint)
language plpgsql stable security definer set search_path = public
as $$
begin
  if auth_role() <> 'admin' then return; end if;
  return query
  with all_v as (
    select expected_date, type, status, announced_by, (pass_used_at is not null) as via_qr from visits
    union all
    select expected_date, type, status, announced_by, via_qr from visit_archive
  )
  select
    count(*),
    count(*) filter (where type = 'delivery'),
    count(*) filter (where type = 'visit'),
    count(*) filter (where status = 'denied'),
    count(*) filter (where announced_by is not null),
    count(*) filter (where announced_by is null),
    count(*) filter (where via_qr)
  from all_v
  where expected_date >= (date_trunc('month', current_date) - ((p_months - 1) || ' months')::interval)::date;
end;
$$;

grant execute on function bi_visits_summary(int) to authenticated;
