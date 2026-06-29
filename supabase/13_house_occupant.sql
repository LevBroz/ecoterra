-- =============================================================
-- EcoTerra · Tipo de ocupante de la casa (propietario / inquilino)
-- Ejecutar UNA VEZ en SQL Editor (después de 01-12).
-- =============================================================

alter table houses add column if not exists occupant_type text not null default 'owner'
  check (occupant_type in ('owner', 'tenant'));

-- owner   = propietario (dueño)
-- tenant  = inquilino
