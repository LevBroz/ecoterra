import { supabase } from './supabaseClient.js';
import { guardPage, logout } from './auth.js';
import { PUBLIC_WEB_URL } from './config.js';
import { fmtMoney, fmtDate, badge, toast, renderNavbar, enableCardTables, emitReceipt } from './ui.js';

const ctx = await guardPage('resident');
if (!ctx) throw new Error('redirect');
const { profile } = ctx;

document.getElementById('navbar').innerHTML = renderNavbar(profile, [
  ['home', './resident.html', 'Mi Casa'],
  ['transparencia', './transparencia.html', 'Transparencia'],
], 'home');
document.getElementById('logout-btn').addEventListener('click', logout);
enableCardTables();

let isCurrent = false;

async function loadAccountSummary() {
  const { data, error } = await supabase.rpc('house_account_summary', {
    p_house_id: profile.house_id,
  });
  if (error) return toast('Error cargando estado de cuenta', 'danger');
  const s = data[0];
  isCurrent = s.is_current;

  document.getElementById('kpi-pending').textContent = s.pending_count + s.overdue_count;
  document.getElementById('kpi-amount').textContent = fmtMoney(Number(s.pending_amount) + Number(s.overdue_amount));
  document.getElementById('kpi-status').innerHTML = s.is_current
    ? '<span class="text-success">Al día <i class="bi bi-check-circle-fill"></i></span>'
    : '<span class="text-danger">En mora <i class="bi bi-x-circle-fill"></i></span>';

  if (!s.is_current) {
    document.getElementById('account-alert').innerHTML = `
      <div class="alert alert-warning">
        <i class="bi bi-exclamation-triangle-fill"></i>
        Tu casa tiene cuotas vencidas. No podrás anunciar visitas ni reservar zonas
        sociales hasta ponerte al día.
      </div>`;
    document.getElementById('btn-new-visit').disabled = true;
    document.getElementById('btn-new-reservation').disabled = true;
  }
}

async function loadFees() {
  const { data, error } = await supabase
    .from('fees')
    .select('*')
    .eq('house_id', profile.house_id)
    .order('period', { ascending: false });
  if (error) return;
  document.getElementById('fees-body').innerHTML = data.map((f) => `
    <tr>
      <td>${f.period}</td><td>${f.concept}</td>
      <td>${fmtMoney(f.amount)}</td><td>${fmtDate(f.due_date)}</td>
      <td>${badge(f.status)}</td>
    </tr>`).join('') || '<tr><td colspan="5" class="text-muted">Sin cuotas registradas.</td></tr>';
}

let myPayments = [];
async function loadPayments() {
  const { data, error } = await supabase
    .from('payments')
    .select('*, fees(period, concept)')
    .eq('house_id', profile.house_id)
    .order('paid_at', { ascending: false });
  if (error) return;
  myPayments = data || [];
  document.getElementById('payments-body').innerHTML = myPayments.map((p) => `
    <tr>
      <td>${fmtDate(p.paid_at)}</td>
      <td>${p.fees ? `${p.fees.concept} ${p.fees.period}` : (p.notes || '—')}</td>
      <td>${fmtMoney(p.amount)}</td><td>${p.method}</td><td>${p.reference || '—'}</td>
      <td><button class="btn btn-outline-success btn-sm" data-receipt-id="${p.id}" title="Recibo PDF">
        <i class="bi bi-filetype-pdf"></i> Recibo
      </button></td>
    </tr>`).join('') || '<tr><td colspan="6" class="text-muted">Sin pagos registrados.</td></tr>';
}

document.getElementById('payments-body').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-receipt-id]');
  if (!btn) return;
  const p = myPayments.find((x) => x.id === btn.dataset.receiptId);
  if (!p) return;
  emitReceipt({
    folio: 'REC-' + p.id.slice(0, 8).toUpperCase(),
    houseCode: profile.houses?.code,
    owner: profile.houses?.owner_name || profile.full_name,
    concept: p.fees ? `${p.fees.concept} ${p.fees.period}` : (p.notes || 'Pago'),
    amount: Number(p.amount),
    method: p.method,
    reference: p.reference,
    paidAt: fmtDate(p.paid_at),
  });
});

async function loadVisits() {
  const { data, error } = await supabase
    .from('visits')
    .select('*')
    .eq('house_id', profile.house_id)
    .order('expected_date', { ascending: false })
    .limit(50);
  if (error) return;
  document.getElementById('visits-body').innerHTML = data.map((v) => `
    <tr>
      <td>${fmtDate(v.expected_date)}</td>
      <td>${v.type === 'delivery' ? '<i class="bi bi-box-seam"></i> Delivery' : '<i class="bi bi-person"></i> Visita'}</td>
      <td>${v.visitor_name}</td>
      <td>${v.company || v.plate || '—'}</td>
      <td>${badge(v.status)}</td>
      <td>${v.status === 'announced'
        ? `<button class="btn btn-success btn-sm" data-qr="${v.pass_token}"
             data-name="${v.visitor_name}" data-date="${v.expected_date}">
             <i class="bi bi-qr-code"></i> Pase QR
           </button>
           <button class="btn btn-outline-danger btn-sm" data-cancel-visit="${v.id}">Cancelar</button>` : ''}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="text-muted">Sin visitas anunciadas.</td></tr>';
}

// ----- Pase QR de un solo uso -----
let qrLib = null;
let currentPass = null;
async function showQrPass(token, name, date) {
  qrLib = qrLib || (await import('https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm')).default;
  const canvas = document.getElementById('qr-canvas');
  await qrLib.toCanvas(canvas, token, { width: 240, margin: 1, color: { dark: '#4a1f2b', light: '#ffffff' } });
  document.getElementById('qr-caption').textContent = `${name} · ${fmtDate(date)}`;
  currentPass = { token, name, date };
  bootstrap.Modal.getOrCreateInstance(document.getElementById('qr-modal')).show();
}

document.getElementById('visits-body').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-qr]');
  if (!btn) return;
  showQrPass(btn.dataset.qr, btn.dataset.name, btn.dataset.date);
});

// Compartir el pase con la visita (enlace público a pase.html)
async function sharePass({ token, name, date }) {
  const url = `${PUBLIC_WEB_URL}/pase.html?t=${token}&n=${encodeURIComponent(name)}${date ? `&d=${date}` : ''}`;
  const text = `Hola ${name}, este es tu pase de entrada a EcoTerra`
    + `${date ? ` (válido ${fmtDate(date)})` : ''}. Es de un solo uso; ábrelo y muéstralo en portería:`;
  const Plugins = window.Capacitor?.Plugins;

  // App nativa: hoja de compartir del sistema (incluye WhatsApp)
  if (window.Capacitor?.isNativePlatform?.() && Plugins?.Share) {
    try { await Plugins.Share.share({ title: 'Pase EcoTerra', text, url, dialogTitle: 'Compartir pase' }); } catch { /* cancelado */ }
    return;
  }
  // Web con Web Share API (Android Chrome muestra la hoja con WhatsApp)
  if (navigator.share) {
    try { await navigator.share({ title: 'Pase EcoTerra', text, url }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  // Respaldo: abrir WhatsApp directamente con el enlace
  window.open(`https://wa.me/?text=${encodeURIComponent(text + ' ' + url)}`, '_blank');
}

document.getElementById('qr-share').addEventListener('click', () => {
  if (currentPass) sharePass(currentPass);
});

async function loadReservations() {
  const { data, error } = await supabase
    .from('reservations')
    .select('*, amenities(name)')
    .eq('house_id', profile.house_id)
    .order('date', { ascending: false });
  if (error) return;
  document.getElementById('reservations-body').innerHTML = data.map((r) => `
    <tr>
      <td>${fmtDate(r.date)}</td><td>${r.amenities?.name || '—'}</td>
      <td>${r.event_name}</td><td>${r.start_time.slice(0, 5)}–${r.end_time.slice(0, 5)}</td>
      <td>${badge(r.status)}</td>
      <td>${r.status === 'pending'
        ? `<button class="btn btn-outline-danger btn-sm" data-cancel-res="${r.id}">Cancelar</button>` : ''}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="text-muted">Sin reservas.</td></tr>';
}

let annAll = [];
async function loadAnnouncements() {
  // announcement_reads viene filtrado por RLS a las lecturas del usuario actual
  const { data, error } = await supabase
    .from('announcements')
    .select('*, announcement_reads(user_id)')
    .order('pinned', { ascending: false })
    .order('published_at', { ascending: false })
    .limit(50);
  if (error) return;
  annAll = data;

  const unread = data.filter((a) => !a.announcement_reads.length);
  const read = data.filter((a) => a.announcement_reads.length);

  // Badge de no leídos en la pestaña
  const badge = document.getElementById('ann-badge');
  badge.textContent = unread.length;
  badge.classList.toggle('d-none', unread.length === 0);

  // No leídos: post estilo feed; imagen completa (sin recortar) y opción de ver full
  document.getElementById('announcements-list').innerHTML = unread.map((a) => `
    <div class="card mb-3 ${a.pinned ? 'border-success' : ''}">
      ${a.image_url ? `<img src="${a.image_url}" class="card-img-top" alt=""
        style="max-height:240px;object-fit:contain;background:#faf6f7;cursor:pointer"
        loading="lazy" data-ann-view="${a.id}" />` : ''}
      <div class="card-body">
        <h6 class="card-title">${a.pinned ? '<i class="bi bi-pin-angle-fill text-success"></i> ' : ''}${a.title}</h6>
        <p class="card-text text-truncate-3" style="white-space:pre-line;">${a.body}</p>
        <div class="d-flex justify-content-between align-items-center">
          <small class="text-muted">${fmtDate(a.published_at.slice(0, 10))}</small>
          <div class="d-flex gap-2">
            <button class="btn btn-outline-secondary btn-sm" data-ann-view="${a.id}">
              <i class="bi bi-arrows-fullscreen"></i> Ver completo
            </button>
            <button class="btn btn-outline-success btn-sm" data-mark-read="${a.id}">
              <i class="bi bi-check2"></i> Leído
            </button>
          </div>
        </div>
      </div>
    </div>`).join('') || '<p class="text-muted">No tienes anuncios sin leer.</p>';

  // Leídos: minimizados (expandibles, no se borran)
  document.getElementById('read-announcements-title').hidden = read.length === 0;
  document.getElementById('announcements-read-list').innerHTML = read.map((a) => `
    <details class="card mb-2">
      <summary class="card-body py-2 text-muted" style="cursor:pointer;">
        <i class="bi bi-envelope-open"></i> ${a.title}
        <small class="ms-2">${fmtDate(a.published_at.slice(0, 10))}</small>
      </summary>
      <div class="card-body pt-0">
        ${a.image_url ? `<img src="${a.image_url}" class="img-fluid rounded mb-2" alt="" loading="lazy" />` : ''}
        <p class="card-text" style="white-space:pre-line;">${a.body}</p>
      </div>
    </details>`).join('');
}

function openAnnModal(id) {
  const a = annAll.find((x) => x.id === id);
  if (!a) return;
  document.getElementById('ann-modal-title').textContent = a.title;
  document.getElementById('ann-modal-date').textContent = fmtDate(a.published_at.slice(0, 10));
  document.getElementById('ann-modal-body').textContent = a.body;
  const imgWrap = document.getElementById('ann-modal-img');
  imgWrap.innerHTML = a.image_url
    ? `<img src="${a.image_url}" class="img-fluid rounded mb-3" alt="" />` : '';
  bootstrap.Modal.getOrCreateInstance(document.getElementById('ann-modal')).show();
}

document.getElementById('announcements-list').addEventListener('click', async (e) => {
  const view = e.target.closest('[data-ann-view]');
  if (view) return openAnnModal(view.dataset.annView);

  const btn = e.target.closest('button[data-mark-read]');
  if (!btn) return;
  const { error } = await supabase.from('announcement_reads').insert({
    announcement_id: btn.dataset.markRead,
    user_id: profile.id,
  });
  if (error) return toast('No se pudo marcar como leído', 'danger');
  loadAnnouncements();
});

// ----- Formularios descargables -----
async function loadForms() {
  const { data } = await supabase
    .from('forms')
    .select('*')
    .eq('active', true)
    .order('name');
  document.getElementById('forms-list').innerHTML = (data || []).map((f) => `
    <div class="col-12 col-md-6 col-lg-4">
      <div class="card h-100">
        <div class="card-body d-flex flex-column">
          <h6 class="card-title"><i class="bi bi-file-earmark-text"></i> ${f.name}</h6>
          <p class="card-text text-muted small flex-grow-1">${f.description || ''}</p>
          <a class="btn btn-outline-success btn-sm" href="${f.file_url}" target="_blank" download>
            <i class="bi bi-download"></i> Descargar
          </a>
        </div>
      </div>
    </div>`).join('') || '<p class="text-muted">Aún no hay formularios publicados.</p>';
}

async function loadAmenities() {
  const { data } = await supabase.from('amenities').select('*').eq('active', true);
  document.getElementById('res-amenity').innerHTML = (data || [])
    .map((a) => `<option value="${a.id}">${a.name}${Number(a.fee) > 0 ? ` (${fmtMoney(a.fee)})` : ''}</option>`)
    .join('');
}

// ----- Anunciar visita -----
document.getElementById('visit-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { error } = await supabase.from('visits').insert({
    house_id: profile.house_id,
    type: document.getElementById('visit-type').value,
    visitor_name: document.getElementById('visit-name').value.trim(),
    company: document.getElementById('visit-company').value.trim() || null,
    plate: document.getElementById('visit-plate').value.trim() || null,
    expected_date: document.getElementById('visit-date').value,
    announced_by: profile.id,
  });
  if (error) {
    toast(isCurrent ? 'Error al anunciar visita' : 'Debes estar al día para anunciar visitas', 'danger');
    return;
  }
  bootstrap.Modal.getInstance(document.getElementById('visit-modal')).hide();
  e.target.reset();
  toast('Visita anunciada');
  loadVisits();
});

// ----- Nueva reserva (formulario lleno obligatorio) -----
document.getElementById('reservation-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const file = document.getElementById('res-form-file').files[0];
  if (!file) return toast('Debes adjuntar el formulario lleno', 'danger');
  if (file.size > 10 * 1024 * 1024) return toast('El archivo no puede superar 10 MB', 'danger');

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  try {
    const safeName = file.name.replace(/[^\w.\-]/g, '_');
    const path = `reservations/${profile.house_id}/${Date.now()}-${safeName}`;
    const { error: upErr } = await supabase.storage.from('attachments').upload(path, file);
    if (upErr) throw new Error('No se pudo subir el formulario: ' + upErr.message);

    const { error } = await supabase.from('reservations').insert({
      amenity_id: document.getElementById('res-amenity').value,
      house_id: profile.house_id,
      event_name: document.getElementById('res-event').value.trim(),
      date: document.getElementById('res-date').value,
      start_time: document.getElementById('res-start').value,
      end_time: document.getElementById('res-end').value,
      form_url: path,
    });
    if (error) {
      throw new Error(isCurrent ? 'Error al crear reserva' : 'Debes estar al día para reservar');
    }
    bootstrap.Modal.getInstance(document.getElementById('reservation-modal')).hide();
    e.target.reset();
    toast('Reserva solicitada, pendiente de aprobación');
    loadReservations();
  } catch (err) {
    toast(err.message, 'danger');
  } finally {
    submitBtn.disabled = false;
  }
});

// ----- Cancelaciones -----
document.addEventListener('click', async (e) => {
  const visitId = e.target.dataset?.cancelVisit;
  const resId = e.target.dataset?.cancelRes;
  if (visitId) {
    await supabase.from('visits').update({ status: 'cancelled' }).eq('id', visitId);
    toast('Visita cancelada');
    loadVisits();
  }
  if (resId) {
    await supabase.from('reservations').update({ status: 'cancelled' }).eq('id', resId);
    toast('Reserva cancelada');
    loadReservations();
  }
});

document.getElementById('visit-date').valueAsDate = new Date();

await Promise.all([
  loadAccountSummary(), loadFees(), loadPayments(),
  loadVisits(), loadReservations(), loadAnnouncements(), loadAmenities(), loadForms(),
]);
