# EcoTerra — Gestión de Residencial

Aplicación web para administrar el residencial EcoTerra: cobro de mensualidades,
anuncios de la junta, reservas de zonas sociales, registro de visitas/delivery
y sección de transparencia con Business Intelligence.

**Presupuesto: $0.** Todo corre en free tiers: Netlify (frontend), Render (backend),
Supabase (base de datos + auth). No introducir dependencias ni servicios pagos.

## Stack

| Capa | Tecnología | Hosting | Notas |
|------|-----------|---------|-------|
| Frontend | HTML estático + Bootstrap 5.3 (CDN) + Chart.js 4 (CDN) + supabase-js v2 (CDN ESM) | Netlify | **Sin build step.** No hay npm en el frontend. |
| Backend | Node 20 + Express (ESM, `"type": "module"`) | Render free | Solo operaciones que requieren service role. Cold start ~50s tras inactividad. |
| Datos/Auth | Supabase (Postgres + RLS + Auth + pg_cron) | Supabase free | La lógica de negocio vive en SQL (funciones + RLS). |

## Estructura

```
frontend/                  → se publica tal cual en Netlify
  index.html               → login (única página pública)
  app/
    admin.html             → panel junta directiva
    resident.html          → panel casa/residente
    guard.html             → panel vigilante (portería)
    transparencia.html     → BI (residentes + admin)
  assets/js/
    config.js              → SUPABASE_URL, ANON_KEY, API_URL (editar al configurar)
    supabaseClient.js      → cliente supabase-js compartido
    auth.js                → sesión, guardas de página por rol, token para API
    ui.js                  → helpers: fmtMoney/fmtDate/badge/toast/renderNavbar
    login.js / admin.js / resident.js / guard.js / transparencia.js → un módulo por página
backend/
  src/server.js            → Express, monta rutas bajo /api/* con requireAuth + requireRole('admin')
  src/supabase.js          → cliente con SERVICE_ROLE_KEY (salta RLS — solo backend)
  src/middleware/auth.js   → valida JWT de Supabase, carga req.profile
  src/routes/payments.js   → registrar pagos, listar pagos
  src/routes/fees.js       → generar cuotas mensuales/extraordinarias, marcar vencidas
  src/routes/users.js      → admin crea usuarios (auth + profile, con rollback)
supabase/                  → ejecutar en SQL Editor de Supabase EN ORDEN
  01_schema.sql            → tablas, enums, índices
  02_functions.sql         → funciones de negocio y BI (security definer)
  03_policies.sql          → RLS (aquí viven las reglas de negocio)
  04_seed.sql              → datos de prueba
netlify.toml               → publish=frontend, sin build
render.yaml                → blueprint del backend en Render
```

## Roles y permisos

Tres roles en `profiles.role` (enum `user_role`): `admin`, `resident`, `guard`.

- **admin** (junta directiva): todo — registrar pagos, generar cuotas, aprobar
  reservas, publicar anuncios, registrar gastos/inversiones, crear usuarios.
- **resident** (casa): ve sus cuotas/pagos, anuncia visitas/delivery, reserva
  zonas sociales, lee anuncios y transparencia. `profiles.house_id` obligatorio.
- **guard** (vigilante): ve visitas del día de todas las casas, registra
  entrada/denegación, registra walk-ins, consulta estado de pago de cada casa.

Redirección post-login por rol en `auth.js` (`HOME_BY_ROLE`). Cada página llama
`guardPage(...rolesPermitidos)` al inicio; si el rol no aplica, redirige.

## Regla de negocio central: "al día"

`is_house_current(house_id)` (en `02_functions.sql`): una casa está **al día**
si no tiene cuotas `overdue` ni `pending` con `due_date` vencida.

Se aplica en **tres** lugares (mantener consistentes):
1. **RLS** (`03_policies.sql`): INSERT en `visits` y `reservations` exige
   `is_house_current(auth_house_id())`. Esta es la barrera real de seguridad.
2. **UI residente** (`resident.js`): deshabilita botones y muestra alerta si en mora.
   Solo UX — la seguridad la da RLS.
3. **UI vigilante** (`guard.js`): muestra badge Al día/En mora por casa y
   deshabilita el botón "Ingresó" para casas en mora.

## Arquitectura de datos

Tablas: `houses`, `profiles` (extiende `auth.users`), `fees` (cuotas),
`payments`, `announcements`, `amenities` (zonas sociales), `reservations`,
`visits` (visitas y deliveries en una tabla, `type` = visit|delivery),
`transactions` (gastos e inversiones, `kind` = expense|investment), `settings`.

Decisiones clave:
- **El frontend habla directo con Supabase** (anon key + RLS) para todo lo que
  el rol puede hacer por sí mismo. **El backend de Render solo existe** para
  operaciones privilegiadas: registrar pagos (admin), crear usuarios, generar
  cuotas. No agregar endpoints al backend si RLS puede resolverlo.
- BI se calcula en Postgres con funciones `bi_*` (security definer), no en JS.
  Para gráficas nuevas: crear función SQL en `02_functions.sql` y llamarla con
  `supabase.rpc(...)` desde `transparencia.js`.
- Cuotas mensuales se generan con `generate_monthly_fees()` vía **pg_cron**
  (gratis en Supabase; los cron jobs de Render cuestan dinero). El endpoint
  `POST /api/fees/generate` es respaldo manual.
- `payments.fee_id` es opcional: permite pagos libres (abonos) además de pago
  de cuota específica. Al pagar con `fee_id`, el backend marca la cuota `paid`.

## Diseño visual

El design system vive en `design-system/MASTER.md` (colores, tipografía,
reglas de accesibilidad) y está implementado como tokens CSS (`--et-*`) en
`frontend/assets/css/styles.css`. Para cualquier UI nueva: usar los tokens,
Bootstrap Icons (nunca emojis como íconos), foco visible y transiciones
150–300ms. Tipografía: Poppins (títulos) + Open Sans (cuerpo).

## Convenciones

- Idioma de UI y mensajes: **español**. Código (variables, funciones): inglés.
- Frontend: ES modules nativos, top-level await, sin frameworks ni bundler.
  Un archivo JS por página. Helpers compartidos en `ui.js` / `auth.js`.
- Estados se renderizan con `badge()` de `ui.js` (mapas `STATUS_BADGE`/`STATUS_LABEL`
  — agregar ahí los estados nuevos).
- SQL: snake_case, enums de Postgres para estados, funciones `security definer`
  con `set search_path = public`.
- Dinero: `numeric(12,2)` en SQL, `fmtMoney()` en UI. Moneda en `settings.currency`.
- Fechas período: formato `'YYYY-MM'` (texto) en `fees.period`.

## Desarrollo local

```powershell
# Backend (necesita backend/.env — copiar de .env.example)
cd backend; npm install; npm run dev      # http://localhost:3001

# Frontend — cualquier server estático, ej:
npx serve frontend                         # o: python -m http.server -d frontend 8888
```

No hay tests todavía. Verificación: `node --check backend/src/server.js`.

## Setup inicial (una vez)

1. Crear proyecto en Supabase → SQL Editor → ejecutar `01` a `06` en orden
   (`06_storage.sql` crea el bucket privado `receipts` para facturas: solo
   admin sube, autenticados leen vía signed URLs de 5 min).
2. Habilitar extensión `pg_cron` y programar los dos jobs (ver final de `02_functions.sql`).
3. Authentication → crear primer usuario admin → insertar su fila en `profiles` con `role='admin'`.
4. Copiar URL + anon key a `frontend/assets/js/config.js`; URL + service_role a `backend/.env`.
5. Deploy: repo a GitHub → Netlify (autodetecta `netlify.toml`) → Render (blueprint `render.yaml`, configurar env vars).
6. Actualizar `API_URL` en `config.js` con la URL real de Render y `FRONTEND_URL` en Render con la URL de Netlify.

## Limitaciones del free tier (no "arreglar" gastando)

- **Render free**: el servicio duerme tras 15 min sin tráfico; primera petición
  tarda ~50s. El frontend debe tolerar esto (operaciones admin solamente).
  Mitigación opcional: ping a `/health` desde el frontend al hacer login admin.
- **Supabase free**: pausa el proyecto tras 7 días sin actividad — entrar al
  dashboard o usar la app lo evita. 500MB DB, suficiente.
- **Netlify free**: 100GB bandwidth/mes, de sobra para un residencial.

## Seguridad

- `SUPABASE_SERVICE_ROLE_KEY` **jamás** en frontend ni commiteada (`.env` está en `.gitignore`).
- La anon key en `config.js` es pública por diseño; RLS es la defensa.
- Toda tabla nueva DEBE tener RLS habilitado y políticas explícitas antes de usarse.
- El backend valida el JWT con `supabaseAdmin.auth.getUser(token)` y verifica rol
  contra la tabla `profiles` (no contra claims del token).
