// Helpers de UI compartidos

export function fmtMoney(n, currency = 'USD') {
  return new Intl.NumberFormat('es', { style: 'currency', currency }).format(n ?? 0);
}

export function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('es', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

export function toast(message, type = 'success') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container position-fixed bottom-0 end-0 p-3';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  el.className = `toast align-items-center text-bg-${type} border-0 show`;
  el.innerHTML = `
    <div class="d-flex">
      <div class="toast-body">${message}</div>
      <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
    </div>`;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

export const STATUS_BADGE = {
  pending: 'warning', paid: 'success', overdue: 'danger', waived: 'secondary',
  approved: 'success', rejected: 'danger', cancelled: 'secondary',
  announced: 'info', arrived: 'success', denied: 'danger',
};

export const STATUS_LABEL = {
  pending: 'Pendiente', paid: 'Pagada', overdue: 'Vencida', waived: 'Exonerada',
  approved: 'Aprobada', rejected: 'Rechazada', cancelled: 'Cancelada',
  announced: 'Anunciada', arrived: 'Ingresó', denied: 'Denegada',
};

export function badge(status) {
  return `<span class="badge text-bg-${STATUS_BADGE[status] || 'secondary'}">${STATUS_LABEL[status] || status}</span>`;
}

// Convierte una <table class="cards"> en tarjetas verticales en móvil:
// copia el texto del thead a cada celda como data-label (lo usa el CSS).
// Observa el tbody para re-etiquetar en cada re-render.
export function makeCardTable(table) {
  if (!table) return;
  const headers = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
  const tbody = table.querySelector('tbody');
  if (!tbody) return;
  const apply = () => {
    for (const tr of tbody.rows) {
      [...tr.cells].forEach((td, i) => {
        if (td.colSpan && td.colSpan > 1) {
          td.classList.add('cell-full');
          td.removeAttribute('data-label');
          return;
        }
        // Celda sin contenido real (p. ej. acciones de una visita resuelta)
        const empty = !td.children.length && !td.textContent.trim();
        td.classList.toggle('cell-empty', empty);
        if (empty) td.removeAttribute('data-label');
        else td.setAttribute('data-label', headers[i] || '');
      });
    }
  };
  apply();
  new MutationObserver(apply).observe(tbody, { childList: true });
}

// Activa el modo tarjeta en todas las tablas .cards de la página
export function enableCardTables(root = document) {
  root.querySelectorAll('table.cards').forEach(makeCardTable);
}

// Navbar compartida; `active` = id de página activa
export function renderNavbar(profile, links, active) {
  const items = links
    .map(([id, href, label]) =>
      `<li class="nav-item"><a class="nav-link${id === active ? ' active' : ''}" href="${href}">${label}</a></li>`)
    .join('');
  return `
  <nav class="navbar navbar-expand-lg navbar-dark navbar-ecoterra">
    <div class="container-fluid">
      <span class="navbar-brand fw-bold">
        <img src="/assets/img/eco_logo.jpg" alt="" class="navbar-logo me-2" />EcoTerra
      </span>
      <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#nav">
        <span class="navbar-toggler-icon"></span>
      </button>
      <div class="collapse navbar-collapse" id="nav">
        <ul class="navbar-nav me-auto">${items}</ul>
        <span class="navbar-text me-3 text-white-50">${profile.full_name}</span>
        <button class="btn btn-outline-light btn-sm" id="logout-btn">Salir</button>
      </div>
    </div>
  </nav>`;
}
