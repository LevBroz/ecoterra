-- =============================================================
-- EcoTerra · Funciones y automatización
-- =============================================================

-- ---------- Helpers de rol (usadas por RLS) ----------
create or replace function auth_role()
returns user_role
language sql stable security definer set search_path = public
as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function auth_house_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select house_id from profiles where id = auth.uid();
$$;

-- ---------- Regla central: ¿casa al día? ----------
-- Al día = sin cuotas vencidas (overdue) ni pendientes con due_date pasada.
create or replace function is_house_current(p_house_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select not exists (
    select 1 from fees
    where house_id = p_house_id
      and (status = 'overdue'
           or (status = 'pending' and due_date < current_date))
  );
$$;

-- ---------- Estado de cuenta de una casa ----------
create or replace function house_account_summary(p_house_id uuid)
returns table (
  pending_count   bigint,
  pending_amount  numeric,
  overdue_count   bigint,
  overdue_amount  numeric,
  is_current      boolean
)
language sql stable security definer set search_path = public
as $$
  select
    count(*) filter (where status = 'pending'),
    coalesce(sum(amount) filter (where status = 'pending'), 0),
    count(*) filter (where status = 'overdue'
                     or (status = 'pending' and due_date < current_date)),
    coalesce(sum(amount) filter (where status = 'overdue'
                     or (status = 'pending' and due_date < current_date)), 0),
    is_house_current(p_house_id)
  from fees
  where house_id = p_house_id and status in ('pending', 'overdue');
$$;

-- ---------- Generación mensual de cuotas ----------
-- Crea la cuota del mes corriente para toda casa activa que no la tenga.
create or replace function generate_monthly_fees()
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_period text := to_char(current_date, 'YYYY-MM');
  v_amount numeric := (select value::numeric from settings where key = 'monthly_fee_amount');
  v_due_day int := (select value::int from settings where key = 'fee_due_day');
  v_count int;
begin
  insert into fees (house_id, period, amount, due_date)
  select h.id, v_period, v_amount,
         make_date(extract(year from current_date)::int,
                   extract(month from current_date)::int, v_due_day)
  from houses h
  where h.active
    and not exists (
      select 1 from fees f
      where f.house_id = h.id and f.period = v_period and f.concept = 'Mensualidad'
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------- Marcar cuotas vencidas ----------
create or replace function mark_overdue_fees()
returns int
language plpgsql security definer set search_path = public
as $$
declare v_count int;
begin
  update fees set status = 'overdue'
  where status = 'pending' and due_date < current_date;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------- BI: ingresos vs gastos por mes (transparencia) ----------
create or replace function bi_monthly_cashflow(p_months int default 12)
returns table (month text, income numeric, expenses numeric, investments numeric)
language sql stable security definer set search_path = public
as $$
  with months as (
    select to_char(d, 'YYYY-MM') as m
    from generate_series(
      date_trunc('month', current_date) - ((p_months - 1) || ' months')::interval,
      date_trunc('month', current_date), '1 month'
    ) d
  )
  select m.m,
    coalesce((select sum(p.amount) from payments p
              where to_char(p.paid_at, 'YYYY-MM') = m.m), 0),
    coalesce((select sum(t.amount) from transactions t
              where t.kind = 'expense' and to_char(t.tx_date, 'YYYY-MM') = m.m), 0),
    coalesce((select sum(t.amount) from transactions t
              where t.kind = 'investment' and to_char(t.tx_date, 'YYYY-MM') = m.m), 0)
  from months m order by m.m;
$$;

-- ---------- BI: tasa de cobranza por mes ----------
create or replace function bi_collection_rate(p_months int default 12)
returns table (period text, billed numeric, collected numeric, rate numeric)
language sql stable security definer set search_path = public
as $$
  select f.period,
         sum(f.amount) as billed,
         sum(f.amount) filter (where f.status = 'paid') as collected,
         round(coalesce(sum(f.amount) filter (where f.status = 'paid'), 0)
               / nullif(sum(f.amount), 0) * 100, 1) as rate
  from fees f
  where f.period >= to_char(current_date - (p_months || ' months')::interval, 'YYYY-MM')
  group by f.period order by f.period;
$$;

-- ---------- BI: gastos por categoría ----------
create or replace function bi_expenses_by_category(p_from date, p_to date)
returns table (category tx_category, total numeric)
language sql stable security definer set search_path = public
as $$
  select t.category, sum(t.amount)
  from transactions t
  where t.kind = 'expense' and t.tx_date between p_from and p_to
  group by t.category order by 2 desc;
$$;

-- ---------- BI: morosidad actual por casa ----------
create or replace function bi_delinquency()
returns table (house_code text, owner_name text, overdue_count bigint, overdue_amount numeric)
language sql stable security definer set search_path = public
as $$
  select h.code, h.owner_name, count(f.id), sum(f.amount)
  from houses h
  join fees f on f.house_id = h.id
  where f.status = 'overdue' or (f.status = 'pending' and f.due_date < current_date)
  group by h.code, h.owner_name order by 4 desc;
$$;

-- ---------- pg_cron: automatización (extensión incluida en Supabase) ----------
-- Habilitar en Dashboard > Database > Extensions > pg_cron, luego:
-- select cron.schedule('generate-fees', '0 6 1 * *', 'select generate_monthly_fees()');
-- select cron.schedule('mark-overdue',  '0 6 * * *', 'select mark_overdue_fees()');
