// Helpers de UI compartidos
import { supabase } from './supabaseClient.js';

// Formato $ 1,000.55 — miles con coma, decimales con punto
export function fmtMoney(n) {
  return '$ ' + Number(n ?? 0).toLocaleString('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
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

// Genera un comprobante de pago en PDF (NO fiscal) y lo comparte o descarga.
// $0, sin backend: jsPDF por CDN. d = { folio, houseCode, owner, concept,
// amount, currency, method, reference, paidAt }.
const METHOD_LABEL = { transfer: 'Transferencia', cash: 'Efectivo', card: 'Tarjeta', other: 'Otro' };

export async function emitReceipt(d) {
  const { jsPDF } = await import('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm');
  const doc = new jsPDF({ unit: 'pt', format: 'a5' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const vino = [124, 45, 67];

  // Banda superior con logo y marca
  doc.setFillColor(...vino);
  doc.rect(0, 0, W, 72, 'F');
  try {
    const img = new Image();
    img.src = '/assets/img/eco_logo.jpg';
    await img.decode();
    doc.addImage(img, 'JPEG', 24, 15, 42, 42);
  } catch { /* sin logo si no carga */ }
  doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(20);
  doc.text('EcoTerra', 78, 38);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
  doc.text('Comprobante de pago', 78, 55);

  // Folio y fecha
  doc.setTextColor(70); doc.setFontSize(10);
  doc.text(`Folio: ${d.folio}`, 24, 98);
  doc.text(`Fecha de pago: ${d.paidAt}`, 24, 114);

  // Detalle
  let y = 146;
  const row = (k, v) => {
    doc.setFont('helvetica', 'bold'); doc.setTextColor(90); doc.text(k, 24, y);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(40);
    doc.text(String(v || '—'), 170, y);
    y += 22;
  };
  row('Casa', d.houseCode);
  row('Propietario', d.owner);
  row('Concepto', d.concept);
  row('Método', METHOD_LABEL[d.method] || d.method);
  row('Referencia', d.reference);

  // Monto destacado
  y += 10;
  doc.setFillColor(245, 239, 241);
  doc.rect(24, y - 4, W - 48, 42, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...vino);
  doc.text('Monto pagado', 36, y + 22);
  doc.text(fmtMoney(d.amount, d.currency || 'USD'), W - 36, y + 22, { align: 'right' });

  // Pie: no fiscal
  doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(120);
  doc.text('Documento no fiscal. No sustituye un Documento Tributario Electrónico (DTE).',
    24, H - 28, { maxWidth: W - 48 });

  const filename = `recibo_${d.folio}.pdf`;
  const file = new File([doc.output('blob')], filename, { type: 'application/pdf' });

  // Menú de opciones: compartir / descargar / guardar en transacciones
  const el = receiptModal();
  const status = el.querySelector('[data-act="status"]');
  status.textContent = '';
  status.className = 'small text-muted text-center';
  el.querySelector('[data-act="archive"]').classList.toggle('d-none', !d.canArchive);

  el.querySelector('[data-act="share"]').onclick = async () => {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Recibo EcoTerra', text: `Comprobante de pago ${d.folio}` }); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    // Escritorio: WhatsApp Web no acepta adjuntos por URL → descarga + abre WhatsApp Web
    doc.save(filename);
    window.open('https://web.whatsapp.com/', '_blank');
    status.textContent = 'PDF descargado. Adjúntalo en WhatsApp Web.';
  };
  el.querySelector('[data-act="download"]').onclick = () => doc.save(filename);
  el.querySelector('[data-act="archive"]').onclick = async () => {
    status.textContent = 'Guardando…';
    const { error } = await supabase.storage.from('receipts')
      .upload(`payments/${d.folio}.pdf`, file, { upsert: true, contentType: 'application/pdf' });
    status.className = 'small text-center ' + (error ? 'text-danger' : 'text-success');
    status.textContent = error ? `Error: ${error.message}` : 'Guardado en transacciones ✓';
  };

  bootstrap.Modal.getOrCreateInstance(el).show();
}

// Modal reutilizable de opciones del recibo (se crea una vez)
function receiptModal() {
  let el = document.getElementById('receipt-modal');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'receipt-modal';
  el.className = 'modal fade';
  el.tabIndex = -1;
  el.innerHTML = `<div class="modal-dialog modal-sm"><div class="modal-content">
    <div class="modal-header">
      <h5 class="modal-title"><i class="bi bi-filetype-pdf"></i> Recibo de pago</h5>
      <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
    </div>
    <div class="modal-body d-grid gap-2">
      <button class="btn btn-success" data-act="share"><i class="bi bi-whatsapp"></i> Compartir por WhatsApp</button>
      <button class="btn btn-outline-success" data-act="download"><i class="bi bi-download"></i> Descargar al dispositivo</button>
      <button class="btn btn-outline-secondary d-none" data-act="archive"><i class="bi bi-folder-plus"></i> Guardar en transacciones</button>
      <div data-act="status" class="small text-muted text-center"></div>
    </div>
  </div></div>`;
  document.body.appendChild(el);
  return el;
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
