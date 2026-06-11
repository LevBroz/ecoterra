import { supabase } from './supabaseClient.js';
import { guardPage, logout, getAccessToken } from './auth.js';
import { API_URL } from './config.js';
import { fmtMoney, fmtDate, badge, toast, renderNavbar } from './ui.js';

const ctx = await guardPage('admin');
if (!ctx) throw new Error('redirect');
const { profile } = ctx;

document.getElementById('navbar').innerHTML = renderNavbar(profile, [
  ['home', './admin.html', 'Administración'],
  ['transparencia', './transparencia.html', 'Transparencia / BI'],
], 'home');
document.getElementById('logout-btn').addEventListener('click', logout);

// Llamada al backend de Render (operaciones con service role)
async function api(path, options = {}) {
  const token = await getAccessToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Error ${res.status}`);
  }
  return res.json();
}

// ----- KPIs + morosidad -----
async function loadDelinquency() {
  const { data, error } = await supabase.rpc('bi_delinquency');
  if (error) return toast('Error cargando morosidad', 'danger');
  document.getElementById('kpi-delinquent').textContent = data.length;
  document.getElementById('kpi-overdue-amount').textContent =
    fmtMoney(data.reduce((s, r) => s + Number(r.overdue_amount), 0));
  document.getElementById('delinquency-body').innerHTML = data.map((r) => `
    <tr>
      <td><strong>${r.house_code}</strong></td><td>${r.owner_name}</td>
      <td>${r.overdue_count}</td><td class="text-danger">${fmtMoney(r.overdue_amount)}</td>
    </tr>`).join('') || '<tr><td colspan="4" class="text-success p-3">Todas las casas están al día 🎉</td></tr>';
}

async function loadKpis() {
  const today = new Date().toISOString().slice(0, 10);
  const [{ count: pendingRes }, { count: visitsToday }] = await Promise.all([
    supabase.from('reservations').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('visits').select('id', { count: 'exact', head: true }).eq('expected_date', today),
  ]);
  document.getElementById('kpi-pending-res').textContent = pendingRes ?? 0;
  document.getElementById('kpi-visits-today').textContent = visitsToday ?? 0;
}

// ----- Registrar pago -----
async function loadHouses() {
  const { data } = await supabase.from('houses').select('id, code, owner_name').eq('active', true).order('code');
  document.getElementById('pay-house').innerHTML = (data || [])
    .map((h) => `<option value="${h.id}">${h.code} — ${h.owner_name}</option>`).join('');
  loadHouseFees();
}

async function loadHouseFees() {
  const houseId = document.getElementById('pay-house').value;
  if (!houseId) return;
  const { data } = await supabase
    .from('fees')
    .select('id, period, concept, amount, status')
    .eq('house_id', houseId)
    .in('status', ['pending', 'overdue'])
    .order('period');
  document.getElementById('pay-fee').innerHTML =
    '<option value="">— Pago libre (sin cuota) —</option>' +
    (data || []).map((f) =>
      `<option value="${f.id}" data-amount="${f.amount}">${f.concept} ${f.period} — ${fmtMoney(f.amount)} (${f.status})</option>`
    ).join('');
}
document.getElementById('pay-house').addEventListener('change', loadHouseFees);
document.getElementById('pay-fee').addEventListener('change', (e) => {
  const amount = e.target.selectedOptions[0]?.dataset?.amount;
  if (amount) document.getElementById('pay-amount').value = amount;
});

document.getElementById('payment-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/payments', {
      method: 'POST',
      body: JSON.stringify({
        house_id: document.getElementById('pay-house').value,
        fee_id: document.getElementById('pay-fee').value || null,
        amount: Number(document.getElementById('pay-amount').value),
        method: document.getElementById('pay-method').value,
        reference: document.getElementById('pay-reference').value.trim() || null,
        paid_at: document.getElementById('pay-date').value,
        notes: document.getElementById('pay-notes').value.trim() || null,
      }),
    });
    toast('Pago registrado');
    e.target.reset();
    document.getElementById('pay-date').valueAsDate = new Date();
    await Promise.all([loadDelinquency(), loadHouseFees()]);
  } catch (err) {
    toast(err.message, 'danger');
  }
});

// ----- Reservas -----
async function loadReservations() {
  const { data, error } = await supabase
    .from('reservations')
    .select('*, houses(code), amenities(name)')
    .order('date', { ascending: false })
    .limit(50);
  if (error) return;
  document.getElementById('reservations-body').innerHTML = data.map((r) => `
    <tr>
      <td>${fmtDate(r.date)}</td><td>${r.houses?.code}</td><td>${r.amenities?.name}</td>
      <td>${r.event_name}</td><td>${r.start_time.slice(0, 5)}–${r.end_time.slice(0, 5)}</td>
      <td>${badge(r.status)}</td>
      <td>${r.status === 'pending' ? `
        <button class="btn btn-success btn-sm" data-res-action="approved" data-id="${r.id}">Aprobar</button>
        <button class="btn btn-outline-danger btn-sm" data-res-action="rejected" data-id="${r.id}">Rechazar</button>` : ''}
      </td>
    </tr>`).join('') || '<tr><td colspan="7" class="text-muted">Sin reservas.</td></tr>';
}

document.getElementById('reservations-body').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-res-action]');
  if (!btn) return;
  const { error } = await supabase
    .from('reservations')
    .update({ status: btn.dataset.resAction, reviewed_by: profile.id })
    .eq('id', btn.dataset.id);
  if (error) return toast('Error al actualizar reserva', 'danger');
  toast(btn.dataset.resAction === 'approved' ? 'Reserva aprobada' : 'Reserva rechazada');
  await Promise.all([loadReservations(), loadKpis()]);
});

// ----- Anuncios -----
async function loadAnnouncements() {
  const { data } = await supabase
    .from('announcements')
    .select('*')
    .order('published_at', { ascending: false })
    .limit(20);
  document.getElementById('announcements-list').innerHTML = (data || []).map((a) => `
    <div class="card mb-2">
      <div class="card-body d-flex justify-content-between">
        <div>
          <h6>${a.pinned ? '<i class="bi bi-pin-angle-fill text-success"></i> ' : ''}${a.title}</h6>
          <p class="mb-1">${a.body}</p>
          <small class="text-muted">${fmtDate(a.published_at.slice(0, 10))}</small>
        </div>
        <button class="btn btn-outline-danger btn-sm align-self-start" data-del-ann="${a.id}">
          <i class="bi bi-trash"></i>
        </button>
      </div>
    </div>`).join('') || '<p class="text-muted">Sin anuncios.</p>';
}

document.getElementById('announcement-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { error } = await supabase.from('announcements').insert({
    title: document.getElementById('ann-title').value.trim(),
    body: document.getElementById('ann-body').value.trim(),
    pinned: document.getElementById('ann-pinned').checked,
    author_id: profile.id,
  });
  if (error) return toast('Error al publicar', 'danger');
  toast('Anuncio publicado');
  e.target.reset();
  loadAnnouncements();
});

document.getElementById('announcements-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-del-ann]');
  if (!btn) return;
  await supabase.from('announcements').delete().eq('id', btn.dataset.delAnn);
  toast('Anuncio eliminado');
  loadAnnouncements();
});

// ----- Gastos / inversiones -----
async function loadTransactions() {
  const { data } = await supabase
    .from('transactions')
    .select('*')
    .order('tx_date', { ascending: false })
    .limit(50);
  document.getElementById('tx-body').innerHTML = (data || []).map((t) => `
    <tr>
      <td>${fmtDate(t.tx_date)}</td>
      <td>${t.kind === 'expense' ? 'Gasto' : 'Inversión'}</td>
      <td>${t.category}</td><td>${t.description}</td>
      <td>${fmtMoney(t.amount)}</td>
    </tr>`).join('') || '<tr><td colspan="5" class="text-muted">Sin registros.</td></tr>';
}

document.getElementById('tx-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { error } = await supabase.from('transactions').insert({
    kind: document.getElementById('tx-kind').value,
    category: document.getElementById('tx-category').value,
    description: document.getElementById('tx-description').value.trim(),
    amount: Number(document.getElementById('tx-amount').value),
    tx_date: document.getElementById('tx-date').value,
    created_by: profile.id,
  });
  if (error) return toast('Error al registrar', 'danger');
  toast('Registrado');
  e.target.reset();
  document.getElementById('tx-date').valueAsDate = new Date();
  loadTransactions();
});

document.getElementById('pay-date').valueAsDate = new Date();
document.getElementById('tx-date').valueAsDate = new Date();

await Promise.all([
  loadDelinquency(), loadKpis(), loadHouses(),
  loadReservations(), loadAnnouncements(), loadTransactions(),
]);
