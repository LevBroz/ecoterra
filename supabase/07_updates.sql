-- =============================================================
-- EcoTerra · Migración: anuncios con vigencia/imagen/leídos,
-- formularios, adjunto en reservas, limpieza de deliveries.
-- Ejecutar UNA VEZ en SQL Editor.
-- =============================================================

-- ---------- 1. Anuncios: vigencia, imagen, activo ----------
alter table announcements add column if not exists starts_at date not null default current_date;
alter table announcements add column if not exists ends_at date;          -- null = no expira
alter table announcements add column if not exists active boolean not null default true;
alter table announcements add column if not exists image_url text;        -- URL pública de la imagen

-- Residentes/guard solo ven anuncios activos y vigentes; admin ve todos
drop policy if exists "everyone reads announcements" on announcements;
create policy "read active announcements" on announcements for select
  using (
    auth_role() = 'admin'
    or (
      auth.uid() is not null
      and active
      and starts_at <= current_date
      and (ends_at is null or ends_at >= current_date)
    )
  );

-- ---------- 2. Anuncios leídos por usuario ----------
create table if not exists announcement_reads (
  announcement_id uuid not null references announcements (id) on delete cascade,
  user_id         uuid not null references profiles (id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

alter table announcement_reads enable row level security;

create policy "own reads select" on announcement_reads for select
  using (user_id = auth.uid());
create policy "own reads insert" on announcement_reads for insert
  with check (user_id = auth.uid());
create policy "own reads delete" on announcement_reads for delete
  using (user_id = auth.uid());

-- ---------- 3. Formularios (plantillas descargables) ----------
create table if not exists forms (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  file_url    text not null,            -- URL pública en bucket forms
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table forms enable row level security;

create policy "read active forms" on forms for select
  using (auth_role() = 'admin' or (auth.uid() is not null and active));
create policy "admin manage forms" on forms for all
  using (auth_role() = 'admin') with check (auth_role() = 'admin');

-- ---------- 4. Reservas: formulario adjunto ----------
alter table reservations add column if not exists form_url text;  -- ruta en bucket attachments

-- ---------- 5. Limpieza automática de deliveries ----------
-- Anunciado sin resolver: se borra a las 3 horas.
-- Resuelto (ingresó/denegada): se borra a los 30 minutos.
create or replace function cleanup_delivery_visits()
returns int
language plpgsql security definer set search_path = public
as $$
declare v_count int;
begin
  delete from visits
  where type = 'delivery'
    and (
      (status = 'announced' and created_at < now() - interval '3 hours')
      or (status in ('arrived', 'denied') and checked_at is not null
          and checked_at < now() - interval '30 minutes')
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- pg_cron (con la extensión ya habilitada):
-- select cron.schedule('cleanup-deliveries', '*/10 * * * *', 'select cleanup_delivery_visits()');

-- ---------- 6. Buckets de Storage ----------
-- announcements: imágenes de anuncios (público: se muestran en el feed)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('announcements', 'announcements', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- forms: plantillas descargables (público: solo son formatos en blanco)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('forms', 'forms', true, 10485760,
        array['application/pdf',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'application/msword'])
on conflict (id) do nothing;

-- attachments: formularios llenos de reservas (PRIVADO)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Políticas de storage
create policy "admin uploads announcement images"
on storage.objects for insert to authenticated
with check (bucket_id = 'announcements' and auth_role() = 'admin');

create policy "admin deletes announcement images"
on storage.objects for delete to authenticated
using (bucket_id = 'announcements' and auth_role() = 'admin');

create policy "admin uploads forms"
on storage.objects for insert to authenticated
with check (bucket_id = 'forms' and auth_role() = 'admin');

create policy "admin deletes forms"
on storage.objects for delete to authenticated
using (bucket_id = 'forms' and auth_role() = 'admin');

-- Residentes suben su formulario lleno; cada quien lee lo suyo, admin todo
create policy "resident uploads attachments"
on storage.objects for insert to authenticated
with check (bucket_id = 'attachments' and auth_role() in ('resident', 'admin'));

create policy "read own attachments"
on storage.objects for select to authenticated
using (bucket_id = 'attachments' and (auth_role() = 'admin' or owner = auth.uid()));
