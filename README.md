# EcoTerra 🌳

Gestión del residencial EcoTerra: mensualidades, anuncios, reservas de zonas
sociales, control de visitas/delivery y transparencia financiera (BI).

**Costo de operación: $0** — Netlify + Render + Supabase (free tiers).

## Roles

| Rol | Quién | Puede |
|-----|-------|-------|
| `admin` | Junta directiva | Pagos, cuotas, reservas, anuncios, gastos, usuarios, BI |
| `resident` | Cada casa | Ver cuotas/pagos, anunciar visitas/delivery*, reservar zonas*, ver transparencia |
| `guard` | Vigilante | Visitas del día, registrar entrada/denegación, ver estado de pago |

\* Solo si la casa está **al día** con sus pagos (regla aplicada por RLS en la base de datos).

## Arquitectura

```
[Netlify: frontend estático] ──supabase-js──▶ [Supabase: Postgres + RLS + Auth]
        │                                              ▲
        └──fetch + JWT──▶ [Render: Express API] ───────┘ (service role)
```

- El frontend consulta Supabase directamente; RLS limita cada rol.
- El backend solo maneja operaciones privilegiadas (registrar pagos, crear usuarios, generar cuotas).
- Cuotas mensuales se generan solas con `pg_cron` el día 1 de cada mes.

## Setup

Ver pasos detallados en [CLAUDE.md](CLAUDE.md#setup-inicial-una-vez). Resumen:

1. **Supabase**: crear proyecto, ejecutar `supabase/01..04.sql` en orden, habilitar `pg_cron`.
2. **Config**: `frontend/assets/js/config.js` (URL + anon key) y `backend/.env` (URL + service role).
3. **Deploy**: GitHub → Netlify (frontend) + Render (backend, blueprint incluido).

## Desarrollo local

```bash
# Backend
cd backend && npm install && npm run dev   # :3001

# Frontend
npx serve frontend                          # o cualquier server estático
```
