import { supabase } from './supabaseClient.js';
import { guardPage, logout, getAccessToken } from './auth.js';
import { API_URL } from './config.js';
import { fmtMoney, fmtDate, badge, toast, renderNavbar, enableCardTables, emitReceipt } from './ui.js';

const ctx = await guardPage('admin');
if (!ctx) throw new Error('redirect');
const { profile } = ctx;

document.getElementById('navbar').innerHTML = renderNavbar(profile, [
  ['home', './admin.html', 'Administración'],
  ['transparencia', './transparencia.html', 'Transparencia / BI'],
], 'home');
document.getElementById('logout-btn').addEventListener('click', logout);
enableCardTables();

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
      <td>
        <button class="btn btn-outline-success btn-sm" data-remind
          data-phone="${r.phone || ''}" data-code="${r.house_code}" data-owner="${r.owner_name}"
          data-count="${r.overdue_count}" data-amount="${r.overdue_amount}">
          <i class="bi bi-whatsapp"></i> Recordar
        </button>
      </td>
    </tr>`).join('') || '<tr><td colspan="5" class="text-success p-3">Todas las casas están al día.</td></tr>';
}

// Recordatorio de cobro por WhatsApp (mensaje prellenado)
document.getElementById('delinquency-body').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-remind]');
  if (!btn) return;
  const { phone, code, owner, count, amount } = btn.dataset;
  const msg = `Estimada ${owner}, le recordamos que su casa ${code} tiene ${count} cuota(s) `
    + `de mantenimiento pendiente(s) por un total de ${fmtMoney(Number(amount))}. `
    + `Puede ponerse al día por transferencia o en administración. `
    + `¡Gracias! — Junta Directiva EcoTerra`;
  // wa.me requiere dígitos en formato internacional. SV = 503; si vienen 8
  // dígitos locales se antepone 503. Si no hay teléfono, WhatsApp pide el contacto.
  const digits = (phone || '').replace(/\D/g, '');
  const intl = digits ? (digits.length <= 8 ? '503' + digits : digits) : '';
  const url = intl
    ? `https://wa.me/${intl}?text=${encodeURIComponent(msg)}`
    : `https://wa.me/?text=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');
});

async function loadKpis() {
  const today = new Date().toISOString().slice(0, 10);
  const [{ count: pendingRes }, { count: visitsToday }] = await Promise.all([
    supabase.from('reservations').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('visits').select('id', { count: 'exact', head: true }).eq('expected_date', today),
  ]);
  document.getElementById('kpi-pending-res').textContent = pendingRes ?? 0;
  document.getElementById('kpi-visits-today').textContent = visitsToday ?? 0;

  // Badge persistente en la pestaña Reservas: visible hasta aprobar/denegar todas
  const badge = document.getElementById('res-badge');
  badge.textContent = pendingRes ?? 0;
  badge.classList.toggle('d-none', !pendingRes);
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

let lastReceipt = null;
document.getElementById('payment-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  // Capturar textos antes del reset (para el recibo)
  const houseText = document.getElementById('pay-house').selectedOptions[0]?.textContent || '';
  const feeSel = document.getElementById('pay-fee');
  const feeText = feeSel.value ? (feeSel.selectedOptions[0]?.textContent || '') : '';
  try {
    const payment = await api('/api/payments', {
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

    // Preparar recibo descargable / enviable
    const [houseCode, owner] = houseText.split(' — ');
    lastReceipt = {
      folio: 'REC-' + String(payment.id).slice(0, 8).toUpperCase(),
      houseCode: (houseCode || '').trim(),
      owner: (owner || '').trim(),
      concept: feeText ? feeText.split(' — ')[0] : 'Abono / pago libre',
      amount: Number(payment.amount),
      method: payment.method,
      reference: payment.reference,
      paidAt: fmtDate(payment.paid_at),
    };
    document.getElementById('last-receipt').innerHTML =
      '<button class="btn btn-outline-success" id="emit-receipt"><i class="bi bi-filetype-pdf"></i> Descargar / enviar recibo</button>';

    e.target.reset();
    document.getElementById('pay-date').valueAsDate = new Date();
    await Promise.all([loadDelinquency(), loadHouseFees()]);
  } catch (err) {
    toast(err.message, 'danger');
  }
});

document.getElementById('last-receipt').addEventListener('click', (e) => {
  if (e.target.closest('#emit-receipt') && lastReceipt) emitReceipt(lastReceipt);
});

// ----- Reservas -----
async function loadReservations() {
  const { data, error } = await supabase
    .from('reservations')
    .select('*, houses(code), amenities(name)')
    .order('date', { ascending: false })
    .limit(50);
  if (error) return;
  // Pendientes arriba: no desaparecen hasta aprobar/denegar
  data.sort((a, b) => (a.status === 'pending' ? -1 : 1) - (b.status === 'pending' ? -1 : 1));
  document.getElementById('reservations-body').innerHTML = data.map((r) => `
    <tr class="${r.status === 'pending' ? 'table-warning' : ''}">
      <td>${fmtDate(r.date)}</td><td>${r.houses?.code}</td><td>${r.amenities?.name}</td>
      <td>${r.event_name}</td><td>${r.start_time.slice(0, 5)}–${r.end_time.slice(0, 5)}</td>
      <td>${r.form_url
        ? `<button class="btn btn-outline-success btn-sm" data-res-form="${r.form_url}" title="Ver formulario">
             <i class="bi bi-file-earmark-text"></i> Ver
           </button>`
        : '<span class="text-muted small">—</span>'}</td>
      <td>${badge(r.status)}</td>
      <td>${r.status === 'pending' ? `
        <button class="btn btn-success btn-sm" data-res-action="approved" data-id="${r.id}">Aprobar</button>
        <button class="btn btn-outline-danger btn-sm" data-res-action="rejected" data-id="${r.id}">Rechazar</button>` : ''}
      </td>
    </tr>`).join('') || '<tr><td colspan="8" class="text-muted">Sin reservas.</td></tr>';
}

document.getElementById('reservations-body').addEventListener('click', async (e) => {
  const formBtn = e.target.closest('button[data-res-form]');
  if (formBtn) {
    const { data, error } = await supabase.storage
      .from('attachments')
      .createSignedUrl(formBtn.dataset.resForm, 300);
    if (error) return toast('No se pudo abrir el formulario', 'danger');
    return window.open(data.signedUrl, '_blank');
  }

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
function vigencia(a) {
  if (!a.active) return '<span class="badge text-bg-secondary">Desactivado</span>';
  const today = new Date().toISOString().slice(0, 10);
  if (a.starts_at > today) return `<span class="badge text-bg-info">Inicia ${fmtDate(a.starts_at)}</span>`;
  if (a.ends_at && a.ends_at < today) return '<span class="badge text-bg-secondary">Expirado</span>';
  return a.ends_at
    ? `<span class="badge text-bg-success">Vigente hasta ${fmtDate(a.ends_at)}</span>`
    : '<span class="badge text-bg-success">Vigente · no expira</span>';
}

async function loadAnnouncements() {
  const { data } = await supabase
    .from('announcements')
    .select('*')
    .order('published_at', { ascending: false })
    .limit(30);
  document.getElementById('announcements-list').innerHTML = (data || []).map((a) => `
    <div class="card mb-2 ${a.active ? '' : 'opacity-50'}">
      <div class="card-body d-flex justify-content-between gap-3">
        ${a.image_url ? `<img src="${a.image_url}" alt="" class="rounded" style="width:72px;height:72px;object-fit:cover;" />` : ''}
        <div class="flex-grow-1">
          <h6>${a.pinned ? '<i class="bi bi-pin-angle-fill text-success"></i> ' : ''}${a.title}</h6>
          <p class="mb-1">${a.body}</p>
          <small class="text-muted">${fmtDate(a.published_at.slice(0, 10))}</small> ${vigencia(a)}
        </div>
        <div class="d-flex flex-column gap-1 align-self-start">
          <button class="btn btn-outline-secondary btn-sm" data-toggle-ann="${a.id}" data-active="${a.active}"
                  title="${a.active ? 'Desactivar' : 'Activar'}">
            <i class="bi bi-${a.active ? 'eye-slash' : 'eye'}"></i>
          </button>
          <button class="btn btn-outline-danger btn-sm" data-del-ann="${a.id}" title="Eliminar">
            <i class="bi bi-trash"></i>
          </button>
        </div>
      </div>
    </div>`).join('') || '<p class="text-muted">Sin anuncios.</p>';
}

// "No expira" deshabilita la fecha fin
document.getElementById('ann-noexpire').addEventListener('change', (e) => {
  const end = document.getElementById('ann-end');
  end.disabled = e.target.checked;
  if (e.target.checked) end.value = '';
});
document.getElementById('ann-end').disabled = true;

document.getElementById('announcement-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('ann-submit');
  const imgFile = document.getElementById('ann-image').files[0];
  const noExpire = document.getElementById('ann-noexpire').checked;
  const endsAt = document.getElementById('ann-end').value;

  if (imgFile && imgFile.size > 5 * 1024 * 1024) {
    return toast('La imagen no puede superar 5 MB', 'danger');
  }
  if (!noExpire && !endsAt) {
    return toast('Indica fecha de fin o marca "No expira"', 'danger');
  }

  btn.disabled = true;
  try {
    let imageUrl = null;
    if (imgFile) {
      const path = `${Date.now()}-${imgFile.name.replace(/[^\w.\-]/g, '_')}`;
      const { error: upErr } = await supabase.storage.from('announcements').upload(path, imgFile);
      if (upErr) throw new Error('No se pudo subir la imagen');
      imageUrl = supabase.storage.from('announcements').getPublicUrl(path).data.publicUrl;
    }

    const { error } = await supabase.from('announcements').insert({
      title: document.getElementById('ann-title').value.trim(),
      body: document.getElementById('ann-body').value.trim(),
      pinned: document.getElementById('ann-pinned').checked,
      image_url: imageUrl,
      starts_at: document.getElementById('ann-start').value,
      ends_at: noExpire ? null : endsAt,
      author_id: profile.id,
    });
    if (error) throw new Error('Error al publicar');
    toast('Anuncio publicado');
    e.target.reset();
    document.getElementById('ann-start').valueAsDate = new Date();
    document.getElementById('ann-end').disabled = true;
    loadAnnouncements();
  } catch (err) {
    toast(err.message, 'danger');
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('announcements-list').addEventListener('click', async (e) => {
  const toggleBtn = e.target.closest('button[data-toggle-ann]');
  if (toggleBtn) {
    await supabase.from('announcements')
      .update({ active: toggleBtn.dataset.active !== 'true' })
      .eq('id', toggleBtn.dataset.toggleAnn);
    toast(toggleBtn.dataset.active === 'true' ? 'Anuncio desactivado' : 'Anuncio activado');
    return loadAnnouncements();
  }
  const btn = e.target.closest('button[data-del-ann]');
  if (!btn) return;
  if (!confirm('¿Eliminar este anuncio definitivamente? Los residentes dejarán de verlo.')) return;
  await supabase.from('announcements').delete().eq('id', btn.dataset.delAnn);
  toast('Anuncio eliminado');
  loadAnnouncements();
});

// ----- Formularios (plantillas) -----
async function loadFormTemplates() {
  const { data } = await supabase.from('forms').select('*').order('created_at', { ascending: false });
  document.getElementById('forms-body').innerHTML = (data || []).map((f) => `
    <tr class="${f.active ? '' : 'opacity-50'}">
      <td><a href="${f.file_url}" target="_blank">${f.name}</a></td>
      <td>${f.description || '—'}</td>
      <td>${f.active
        ? '<span class="badge text-bg-success">Publicado</span>'
        : '<span class="badge text-bg-secondary">Oculto</span>'}</td>
      <td>
        <button class="btn btn-outline-secondary btn-sm" data-toggle-form="${f.id}" data-active="${f.active}">
          ${f.active ? 'Ocultar' : 'Publicar'}
        </button>
      </td>
    </tr>`).join('') || '<tr><td colspan="4" class="text-muted">Sin formularios.</td></tr>';
}

document.getElementById('form-template-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('ft-submit');
  const file = document.getElementById('ft-file').files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) return toast('Máximo 10 MB', 'danger');

  btn.disabled = true;
  try {
    const path = `${Date.now()}-${file.name.replace(/[^\w.\-]/g, '_')}`;
    const { error: upErr } = await supabase.storage.from('forms').upload(path, file);
    if (upErr) throw new Error('No se pudo subir el archivo');
    const fileUrl = supabase.storage.from('forms').getPublicUrl(path).data.publicUrl;

    const { error } = await supabase.from('forms').insert({
      name: document.getElementById('ft-name').value.trim(),
      description: document.getElementById('ft-description').value.trim() || null,
      file_url: fileUrl,
    });
    if (error) throw new Error('Error al publicar el formulario');
    toast('Formulario publicado');
    e.target.reset();
    loadFormTemplates();
  } catch (err) {
    toast(err.message, 'danger');
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('forms-body').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-toggle-form]');
  if (!btn) return;
  await supabase.from('forms')
    .update({ active: btn.dataset.active !== 'true' })
    .eq('id', btn.dataset.toggleForm);
  loadFormTemplates();
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
      <td>${t.receipt_url
        ? `<button class="btn btn-outline-success btn-sm" data-receipt="${t.receipt_url}" title="Ver factura">
             <i class="bi bi-file-earmark-text"></i> Ver
           </button>`
        : '<span class="text-muted small">—</span>'}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="text-muted">Sin registros.</td></tr>';
}

// Sube la factura al bucket privado y devuelve su ruta, o null si no hay archivo
async function uploadReceipt(file) {
  const safeName = file.name.replace(/[^\w.\-]/g, '_');
  const path = `${new Date().toISOString().slice(0, 7)}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage.from('receipts').upload(path, file);
  if (error) throw new Error('No se pudo subir la factura: ' + error.message);
  return path;
}

document.getElementById('tx-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('tx-submit');
  const file = document.getElementById('tx-receipt').files[0];

  if (file && file.size > 5 * 1024 * 1024) {
    return toast('La factura no puede superar 5 MB', 'danger');
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Registrando…';
  try {
    const receiptPath = file ? await uploadReceipt(file) : null;
    const { error } = await supabase.from('transactions').insert({
      kind: document.getElementById('tx-kind').value,
      category: document.getElementById('tx-category').value,
      description: document.getElementById('tx-description').value.trim(),
      amount: Number(document.getElementById('tx-amount').value),
      tx_date: document.getElementById('tx-date').value,
      receipt_url: receiptPath,
      created_by: profile.id,
    });
    if (error) throw new Error('Error al registrar el gasto');
    toast('Registrado' + (receiptPath ? ' con factura adjunta' : ''));
    e.target.reset();
    document.getElementById('tx-date').valueAsDate = new Date();
    loadTransactions();
  } catch (err) {
    toast(err.message, 'danger');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-receipt"></i> Registrar';
  }
});

// Abrir factura con URL firmada (bucket privado, expira en 5 min)
document.getElementById('tx-body').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-receipt]');
  if (!btn) return;
  const { data, error } = await supabase.storage
    .from('receipts')
    .createSignedUrl(btn.dataset.receipt, 300);
  if (error) return toast('No se pudo abrir la factura', 'danger');
  window.open(data.signedUrl, '_blank');
});

// ----- Casas: listado, plantilla e importación CSV -----
async function loadHousesList() {
  const { data } = await supabase.from('houses').select('*').order('code');
  document.getElementById('houses-body').innerHTML = (data || []).map((h) => `
    <tr>
      <td><strong>${h.code}</strong></td><td>${h.owner_name}</td>
      <td>${h.email || '—'}</td><td>${h.phone || '—'}</td>
      <td>${h.vehicles ?? 0}</td>
    </tr>`).join('') || '<tr><td colspan="5" class="text-muted">Sin casas registradas.</td></tr>';
}

document.getElementById('btn-template').addEventListener('click', () => {
  const csv = 'code,owner_name,email,phone,vehicles\n'
    + 'A-01,Familia Ejemplo,correo@ejemplo.com,7000-0000,2\n';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = 'plantilla_casas_ecoterra.csv';
  a.click();
  URL.revokeObjectURL(a.href);
});

function showImportReport(html) {
  document.getElementById('import-report').innerHTML = html;
}

document.getElementById('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const Papa = (await import('https://cdn.jsdelivr.net/npm/papaparse@5.4.1/+esm')).default;
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: (res) => importHouses(res.data),
      error: () => showImportReport('<div class="alert alert-danger">No se pudo leer el archivo.</div>'),
    });
  } catch {
    showImportReport('<div class="alert alert-danger">No se pudo cargar el lector de CSV.</div>');
  }
  e.target.value = '';
});

async function importHouses(rows) {
  const clean = rows.map((r) => ({
    code: (r.code || '').trim(),
    owner_name: (r.owner_name || '').trim(),
    email: (r.email || '').trim() || null,
    phone: (r.phone || '').trim() || null,
    vehicles: Number.parseInt(r.vehicles, 10) || 0,
  })).filter((r) => r.code && r.owner_name);

  if (!clean.length) {
    return showImportReport('<div class="alert alert-danger">No hay filas válidas. '
      + 'Revisa los encabezados: <code>code, owner_name, email, phone, vehicles</code>.</div>');
  }

  const { data: existing } = await supabase.from('houses').select('code');
  const existingCodes = new Set((existing || []).map((h) => h.code));
  const update = document.getElementById('import-update').checked;
  const news = clean.filter((r) => !existingCodes.has(r.code));
  const dupes = clean.filter((r) => existingCodes.has(r.code));

  let created = 0, updated = 0;
  if (news.length) {
    const { error } = await supabase.from('houses').insert(news);
    if (error) return showImportReport(`<div class="alert alert-danger">Error al crear casas: ${error.message}</div>`);
    created = news.length;
  }
  if (dupes.length && update) {
    for (const r of dupes) {
      const { error } = await supabase.from('houses')
        .update({ owner_name: r.owner_name, email: r.email, phone: r.phone, vehicles: r.vehicles })
        .eq('code', r.code);
      if (!error) updated += 1;
    }
  }

  const parts = [`<strong>${created}</strong> creada(s)`];
  if (update) parts.push(`<strong>${updated}</strong> actualizada(s)`);
  let html = `<div class="alert alert-success">Importación lista: ${parts.join(', ')}.</div>`;
  if (!update && dupes.length) {
    html += `<div class="alert alert-warning">
      <strong>${dupes.length} casa(s) ya registrada(s)</strong> (no modificadas):
      ${dupes.map((d) => d.code).join(', ')}.<br>
      Marca <em>"Actualizar casas existentes"</em> y vuelve a importar si deseas sobrescribir sus datos.
    </div>`;
  }
  showImportReport(html);
  await Promise.all([loadHousesList(), loadHouses()]); // refresca tabla y selects de pago
}

document.getElementById('pay-date').valueAsDate = new Date();
document.getElementById('tx-date').valueAsDate = new Date();
document.getElementById('ann-start').valueAsDate = new Date();

await Promise.all([
  loadDelinquency(), loadKpis(), loadHouses(),
  loadReservations(), loadAnnouncements(), loadTransactions(), loadFormTemplates(), loadHousesList(),
]);

// Refrescar badge de reservas pendientes cada 60s
setInterval(() => { loadKpis(); loadReservations(); }, 60000);
