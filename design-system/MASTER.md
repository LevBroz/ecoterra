# EcoTerra · Design System (Master)

Fuente de verdad para decisiones visuales. Generado con la skill ui-ux-pro-max
(paleta "Sustainable Energy / Climate Tech", tipografía "Modern Professional",
estilo "Data-Dense Dashboard"). Implementado como tokens CSS en
`frontend/assets/css/styles.css`.

## Colores (tokens semánticos)

| Token | Hex | Uso |
|-------|-----|-----|
| `--et-primary` | `#059669` | Acciones primarias, links activos, marca |
| `--et-primary-hover` | `#047857` | Hover de botones |
| `--et-primary-dark` | `#065F46` | Navbar (gradiente), superficies de marca |
| `--et-foreground` | `#064E3B` | Títulos |
| `--et-background` | `#F6FAF8` | Fondo de página |
| `--et-muted` | `#64748B` | Texto secundario, labels de tabla |
| `--et-border` | `#DBE7E0` | Bordes de cards, tabs, inputs |
| `--et-warning` | `#D97706` | Estados pendientes |
| `--et-danger` | `#DC2626` | Mora, errores, gastos |

Regla: usar tokens, nunca hex sueltos en componentes nuevos.

## Tipografía

- **Títulos / KPI / navbar:** Poppins 600–700
- **Cuerpo:** Open Sans 400–600, base 16px, line-height 1.6
- Cifras en tablas y KPIs: `font-variant-numeric: tabular-nums`
- Carga vía `@import` en styles.css con `display=swap`

## Gráficas (Chart.js)

- Ingresos: `#059669cc` · Gastos: `#dc2626b3` · Inversiones: `#0891b2cc`
- Dona categorías: paleta accesible definida en `transparencia.js` (sin pares rojo/verde puros)
- Barras con `borderRadius: 4`; línea de cobranza con relleno `#05966922`

## Reglas obligatorias (checklist de la skill)

- Íconos: solo Bootstrap Icons (SVG). **Nunca emojis como íconos.**
- Contraste texto ≥ 4.5:1 (badges usan fondo claro + texto oscuro por esto)
- Foco visible: anillo verde 3px (`:focus-visible`), no eliminarlo
- Transiciones 150–300ms ease-out; respetar `prefers-reduced-motion`
- Touch targets ≥ 44px en móvil (regla en media query ≤768px)
- Estados deshabilitados: opacity 0.45 + cursor not-allowed
- Un solo CTA primario (verde) por pantalla; secundarios en outline
- Responsive: probar en 375 / 768 / 1024 / 1440

## Overrides por página

Carpeta `design-system/pages/` — si existe `pages/<página>.md`, sus reglas
prevalecen sobre este Master para esa página. Hoy no hay overrides.
