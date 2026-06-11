import { supabase } from './supabaseClient.js';
import { guardPage, logout } from './auth.js';
import { fmtMoney, fmtDate, badge, toast, renderNavbar } from './ui.js';

const ctx = await guardPage('resident');
if (!ctx) throw new Error('redirect');
const { profile } = ctx;

document.getElementById('navbar').innerHTML = renderNavbar(profile, [
  ['home', './resident.html', 'Mi Casa'],
  ['transparencia', './transparencia.html', 'Transparencia'],
], 'home');
document.getElementById('logout-btn').addEventListener('click', logout);

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

async function loadPayments() {
  const { data, error } = await supabase
    .from('payments')
    .select('*, fees(period, concept)')
    .eq('house_id', profile.house_id)
    .order('paid_at', { ascending: false });
  if (error) return;
  document.getElementById('payments-body').innerHTML = data.map((p) => `
    <tr>
      <td>${fmtDate(p.paid_at)}</td>
      <td>${p.fees ? `${p.fees.concept} ${p.fees.period}` : (p.notes || '—')}</td>
      <td>${fmtMoney(p.amount)}</td><td>${p.method}</td><td>${p.reference || '—'}</td>
    </tr>`).join('') || '<tr><td colspan="5" class="text-muted">Sin pagos registrados.</td></tr>';
}

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
        ? `<button class="btn btn-outline-danger btn-sm" data-cancel-visit="${v.id}">Cancelar</button>` : ''}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="text-muted">Sin visitas anunciadas.</td></tr>';
}

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

async function loadAnnouncements() {
  const { data, error } = await supabase
    .from('announcements')
    .select('*')
    .order('pinned', { ascending: false })
    .order('published_at', { ascending: false })
    .limit(20);
  if (error) return;
  document.getElementById('announcements-list').innerHTML = data.map((a) => `
    <div class="card mb-2 ${a.pinned ? 'border-success' : ''}">
      <div class="card-body">
        <h6 class="card-title">${a.pinned ? '<i class="bi bi-pin-angle-fill text-success"></i> ' : ''}${a.title}</h6>
        <p class="card-text">${a.body}</p>
        <small class="text-muted">${fmtDate(a.published_at.slice(0, 10))}</small>
      </div>
    </div>`).join('') || '<p class="text-muted">Sin anuncios.</p>';
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

// ----- Nueva reserva -----
document.getElementById('reservation-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { error } = await supabase.from('reservations').insert({
    amenity_id: document.getElementById('res-amenity').value,
    house_id: profile.house_id,
    event_name: document.getElementById('res-event').value.trim(),
    date: document.getElementById('res-date').value,
    start_time: document.getElementById('res-start').value,
    end_time: document.getElementById('res-end').value,
  });
  if (error) {
    toast(isCurrent ? 'Error al crear reserva' : 'Debes estar al día para reservar', 'danger');
    return;
  }
  bootstrap.Modal.getInstance(document.getElementById('reservation-modal')).hide();
  e.target.reset();
  toast('Reserva solicitada, pendiente de aprobación');
  loadReservations();
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
  loadVisits(), loadReservations(), loadAnnouncements(), loadAmenities(),
]);
