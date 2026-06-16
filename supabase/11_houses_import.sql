-- =============================================================
-- EcoTerra · Casas: cantidad de vehículos + morosidad con teléfono
-- Ejecutar UNA VEZ en SQL Editor (después de 01-10).
-- =============================================================

-- ---------- 1. Cantidad de vehículos por casa (para stickers) ----------
alter table houses add column if not exists vehicles int not null default 0
  check (vehicles >= 0);

-- ---------- 2. Morosidad: agregar teléfono + restringir a admin ----------
-- (antes era 'language sql' sin guardia de rol: cualquiera autenticado podía
--  consultar quién debe. Ahora solo admin, y devuelve el teléfono para el
--  recordatorio por WhatsApp.)
create or replace function bi_delinquency()
returns table (house_code text, owner_name text, phone text,
               overdue_count bigint, overdue_amount numeric)
language plpgsql stable security definer set search_path = public
as $$
begin
  if auth_role() <> 'admin' then return; end if;
  return query
  select h.code, h.owner_name, h.phone, count(f.id), sum(f.amount)
  from houses h
  join fees f on f.house_id = h.id
  where f.status = 'overdue' or (f.status = 'pending' and f.due_date < current_date)
  group by h.code, h.owner_name, h.phone
  order by sum(f.amount) desc;
end;
$$;
