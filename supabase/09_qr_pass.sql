-- =============================================================
-- EcoTerra · Pase QR de un solo uso para visitas/deliveries
-- Ejecutar UNA VEZ en SQL Editor (después de 01-07).
--
-- Flujo:
--   1. El residente anuncia una visita → cada visita tiene pass_token.
--   2. El residente muestra el QR (codifica pass_token) en su teléfono.
--   3. El vigilante escanea y llama redeem_visit_pass(token).
--      - válido y no usado → marca 'arrived', sella pass_used_at → PERMITE
--      - ya usado          → DENIEGA (validar con residente)
--      - casa en mora      → DENIEGA
--      - otro día          → DENIEGA
-- La validación de "un solo uso" es ATÓMICA (UPDATE ... WHERE pass_used_at IS NULL).
-- =============================================================

-- ---------- 1. Columnas del pase ----------
alter table visits add column if not exists pass_token   uuid not null default gen_random_uuid();
alter table visits add column if not exists pass_used_at  timestamptz;

create unique index if not exists idx_visits_pass_token on visits (pass_token);

-- ---------- 2. Función de canje (security definer + atómica) ----------
create or replace function redeem_visit_pass(p_token uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v      visits%rowtype;
  v_code text;
begin
  -- Solo el vigilante puede canjear pases
  if auth_role() <> 'guard' then
    return jsonb_build_object('result', 'forbidden');
  end if;

  select * into v from visits where pass_token = p_token;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;

  select code into v_code from houses where id = v.house_id;

  -- Ya utilizado (o ya marcado como ingresado)
  if v.pass_used_at is not null or v.status = 'arrived' then
    return jsonb_build_object('result', 'already_used',
      'house_code', v_code, 'visitor_name', v.visitor_name, 'used_at', v.pass_used_at);
  end if;

  -- Cancelado o previamente denegado
  if v.status in ('denied', 'cancelled') then
    return jsonb_build_object('result', 'invalid_status',
      'status', v.status, 'house_code', v_code, 'visitor_name', v.visitor_name);
  end if;

  -- El pase es válido solo el día esperado
  if v.expected_date <> current_date then
    return jsonb_build_object('result', 'wrong_day',
      'expected_date', v.expected_date, 'house_code', v_code, 'visitor_name', v.visitor_name);
  end if;

  -- La casa debe estar al día
  if not is_house_current(v.house_id) then
    return jsonb_build_object('result', 'house_overdue',
      'house_code', v_code, 'visitor_name', v.visitor_name);
  end if;

  -- Marcar como ingresado de forma atómica (gana el primer escaneo)
  update visits
     set status = 'arrived', pass_used_at = now(),
         checked_by = auth.uid(), checked_at = now()
   where id = v.id and pass_used_at is null
   returning * into v;

  if not found then
    return jsonb_build_object('result', 'already_used',
      'house_code', v_code, 'visitor_name', v.visitor_name);
  end if;

  return jsonb_build_object('result', 'granted',
    'house_code', v_code, 'visitor_name', v.visitor_name, 'type', v.type);
end;
$$;

grant execute on function redeem_visit_pass(uuid) to authenticated;
