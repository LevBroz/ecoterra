# EcoTerra · Design System (Master)

Fuente de verdad para decisiones visuales. Paleta derivada del logo oficial
(`frontend/assets/img/eco_logo.jpg`: árbol geométrico vino/borgoña con rosas
empolvados). Tipografía "Modern Professional" y estilo "Data-Dense Dashboard"
de la skill ui-ux-pro-max. Implementado como tokens CSS en
`frontend/assets/css/styles.css`.

## Logo

`frontend/assets/img/eco_logo.jpg` — usado en navbar (34px, radio 9px),
login (84px, radio 1.4rem) y favicon de todas las páginas. Rutas absolutas
(`/assets/img/...`) para funcionar desde `/` y `/app/`.

## Colores (tokens semánticos)

| Token | Hex | Origen / Uso |
|-------|-----|--------------|
| `--et-primary` | `#7C2D43` | Vino del logo — botones, links activos, marca |
| `--et-primary-hover` | `#662439` | Hover de botones |
| `--et-primary-dark` | `#4A1F2B` | Borgoña profundo (fondo del logo) — navbar |
| `--et-rose` | `#D49BA6` | Rosa medio del logo — bordes outline, acentos |
| `--et-rose-light` | `#DCC8D6` | Rosa claro del logo — fondos suaves |
| `--et-foreground` | `#3F1A24` | Títulos |
| `--et-background` | `#FAF6F7` | Fondo de página (rosa casi blanco) |
| `--et-muted` | `#71606A` | Texto secundario, labels de tabla |
| `--et-border` | `#EAD9DF` | Bordes de cards, tabs, inputs |
| `--et-warning` | `#D97706` | Estados pendientes, gastos en gráficas |
| `--et-danger` | `#DC2626` | Errores, mora |

**Regla clave — marca ≠ estado:** el vino es color de MARCA (botones, navbar,
gráficas de ingresos). Los badges/textos de ESTADO conservan semántica
universal: verde = al día/pagada, rojo = mora/vencida, ámbar = pendiente.
No convertir los badges de estado a vino.

Regla: usar tokens, nunca hex sueltos en componentes nuevos.

## Tipografía

- **Títulos / KPI / navbar:** Poppins 600–700
- **Cuerpo:** Open Sans 400–600, base 16px, line-height 1.6
- Cifras en tablas y KPIs: `font-variant-numeric: tabular-nums`
- Carga vía `@import` en styles.css con `display=swap`

## Gráficas (Chart.js)

- Ingresos: `#7c2d43cc` (vino marca) · Gastos: `#d97706b3` (ámbar — NO rojo,
  sería indistinguible del vino) · Inversiones: `#586ba4cc` (azul pizarra)
- Dona categorías: `['#7c2d43','#d49ba6','#d97706','#586ba4','#71606a','#a8516e','#0d9488','#b45309','#94a3b8']`
- Barras con `borderRadius: 4`; línea de cobranza vino con relleno `#7c2d4322`

## Reglas obligatorias (checklist de la skill)

- Íconos: solo Bootstrap Icons (SVG). **Nunca emojis como íconos.**
- Contraste texto ≥ 4.5:1 (badges usan fondo claro + texto oscuro por esto)
- Foco visible: anillo vino 3px (`:focus-visible`), no eliminarlo
- Transiciones 150–300ms ease-out; respetar `prefers-reduced-motion`
- Touch targets ≥ 44px en móvil (regla en media query ≤768px)
- Estados deshabilitados: opacity 0.45 + cursor not-allowed
- Un solo CTA primario (vino) por pantalla; secundarios en outline rosa
- Responsive: probar en 375 / 768 / 1024 / 1440

## Overrides por página

Carpeta `design-system/pages/` — si existe `pages/<página>.md`, sus reglas
prevalecen sobre este Master para esa página. Hoy no hay overrides.
