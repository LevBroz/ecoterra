import { supabase } from './supabaseClient.js';
import { guardPage, logout } from './auth.js';
import { badge, toast, renderNavbar } from './ui.js';

const ctx = await guardPage('guard');
if (!ctx) throw new Error('redirect');
const { profile } = ctx;

document.getElementById('navbar').innerHTML = renderNavbar(profile, [
  ['home', './guard.html', 'Portería'],
], 'home');
document.getElementById('logout-btn').addEventListener('click', logout);

let allVisits = [];
const paymentStatusCache = new Map(); // house_id -> boolean

async function houseIsCurrent(houseId) {
  if (paymentStatusCache.has(houseId)) return paymentStatusCache.get(houseId);
  const { data } = await supabase.rpc('is_house_current', { p_house_id: houseId });
  paymentStatusCache.set(houseId, !!data);
  return !!data;
}

async function loadVisits() {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('visits')
    .select('*, houses(id, code, owner_name)')
    .eq('expected_date', today)
    .order('created_at', { ascending: false });
  if (error) return toast('Error cargando visitas', 'danger');
  allVisits = data;
  await renderVisits();
}

async function renderVisits() {
  const term = document.getElementById('search').value.trim().toLowerCase();
  const rows = [];
  for (const v of allVisits) {
    if (term && !v.visitor_name.toLowerCase().includes(term)
        && !v.houses.code.toLowerCase().includes(term)) continue;
    const current = await houseIsCurrent(v.house_id);
    rows.push(`
      <tr class="${!current && v.status === 'announced' ? 'table-danger' : ''}">
        <td><strong>${v.houses.code}</strong><br /><small class="text-muted">${v.houses.owner_name}</small></td>
        <td>${current
          ? '<span class="badge text-bg-success">Al día</span>'
          : '<span class="badge text-bg-danger">En mora</span>'}</td>
        <td>${v.type === 'delivery' ? '<i class="bi bi-box-seam"></i> Delivery' : '<i class="bi bi-person"></i> Visita'}</td>
        <td>${v.visitor_name}</td>
        <td>${v.company || v.plate || '—'}</td>
        <td>${badge(v.status)}</td>
        <td>
          ${v.status === 'announced' ? `
            <button class="btn btn-success btn-sm" data-action="arrived" data-id="${v.id}"
              ${!current ? 'disabled title="Casa en mora — entrada no permitida"' : ''}>
              <i class="bi bi-check-lg"></i> Ingresó
            </button>
            <button class="btn btn-outline-danger btn-sm" data-action="denied" data-id="${v.id}">
              Denegar
            </button>` : ''}
        </td>
      </tr>`);
  }
  document.getElementById('visits-body').innerHTML =
    rows.join('') || '<tr><td colspan="7" class="text-muted p-3">Sin visitas anunciadas para hoy.</td></tr>';
}

document.getElementById('visits-body').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const { error } = await supabase
    .from('visits')
    .update({ status: btn.dataset.action, checked_by: profile.id, checked_at: new Date().toISOString() })
    .eq('id', btn.dataset.id);
  if (error) return toast('Error al actualizar', 'danger');
  toast(btn.dataset.action === 'arrived' ? 'Entrada registrada' : 'Entrada denegada');
  loadVisits();
});

document.getElementById('search').addEventListener('input', renderVisits);

// ----- Walk-in -----
async function loadHouses() {
  const { data } = await supabase.from('houses').select('id, code, owner_name').eq('active', true).order('code');
  document.getElementById('walkin-house').innerHTML = (data || [])
    .map((h) => `<option value="${h.id}">${h.code} — ${h.owner_name}</option>`).join('');
  updateWalkinStatus();
}

async function updateWalkinStatus() {
  const houseId = document.getElementById('walkin-house').value;
  if (!houseId) return;
  const current = await houseIsCurrent(houseId);
  document.getElementById('walkin-house-status').innerHTML = current
    ? '<span class="text-success">Casa al día ✓</span>'
    : '<span class="text-danger fw-bold">⚠ Casa en mora — verificar con administración antes de permitir entrada</span>';
}
document.getElementById('walkin-house').addEventListener('change', updateWalkinStatus);

document.getElementById('walkin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const detail = document.getElementById('walkin-detail').value.trim();
  const type = document.getElementById('walkin-type').value;
  const { error } = await supabase.from('visits').insert({
    house_id: document.getElementById('walkin-house').value,
    type,
    visitor_name: document.getElementById('walkin-name').value.trim(),
    company: type === 'delivery' ? detail || null : null,
    plate: type === 'visit' ? detail || null : null,
    status: document.getElementById('walkin-status').value,
    checked_by: profile.id,
    checked_at: new Date().toISOString(),
  });
  if (error) return toast('Error al registrar', 'danger');
  bootstrap.Modal.getInstance(document.getElementById('walkin-modal')).hide();
  e.target.reset();
  toast('Registro guardado');
  loadVisits();
});

await Promise.all([loadVisits(), loadHouses()]);
// Refrescar cada 60s para ver nuevas visitas anunciadas
setInterval(() => { paymentStatusCache.clear(); loadVisits(); }, 60000);
