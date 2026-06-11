-- =============================================================
-- EcoTerra · Storage para facturas/comprobantes
-- Ejecutar en SQL Editor después de 01-03.
-- Bucket privado: solo admin sube, cualquier autenticado ve
-- (transparencia: residentes pueden corroborar facturas).
-- =============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipts', 'receipts', false,
  5242880,  -- 5 MB por archivo
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do nothing;

-- Solo admin sube facturas
create policy "admin uploads receipts"
on storage.objects for insert to authenticated
with check (bucket_id = 'receipts' and auth_role() = 'admin');

-- Solo admin reemplaza/elimina
create policy "admin manages receipts"
on storage.objects for update to authenticated
using (bucket_id = 'receipts' and auth_role() = 'admin');

create policy "admin deletes receipts"
on storage.objects for delete to authenticated
using (bucket_id = 'receipts' and auth_role() = 'admin');

-- Todo usuario autenticado puede ver (necesario para transparencia
-- y para generar signed URLs desde el frontend)
create policy "authenticated reads receipts"
on storage.objects for select to authenticated
using (bucket_id = 'receipts');
