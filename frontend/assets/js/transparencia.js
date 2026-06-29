import { supabase } from './supabaseClient.js';
import { guardPage, logout, homeForRole } from './auth.js';
import { fmtMoney, fmtDate, renderNavbar, enableCardTables } from './ui.js';

// Transparencia: visible para residentes y admin
const ctx = await guardPage('resident', 'admin');
if (!ctx) throw new Error('redirect');
const { profile } = ctx;

document.getElementById('navbar').innerHTML = renderNavbar(profile, [
  ['home', homeForRole(profile.role), profile.role === 'admin' ? 'Administración' : 'Mi Casa'],
  ['transparencia', './transparencia.html', 'Transparencia'],
], 'transparencia');
document.getElementById('logout-btn').addEventListener('click', logout);
enableCardTables();

// El panel de accesos es exclusivo de la junta directiva
const isAdmin = profile.role === 'admin';
if (isAdmin) document.getElementById('accesos-panel').classList.remove('d-none');

const charts = {}; // id -> Chart, para destruir al refiltrar

function renderChart(id, config) {
  charts[id]?.destroy();
  charts[id] = new Chart(document.getElementById(id), config);
}

function momText(curr, prev) {
  if (!prev) return '';
  const delta = ((curr - prev) / prev) * 100;
  const arrow = delta >= 0 ? '▲' : '▼';
  return `${arrow} ${Math.abs(delta).toFixed(1)}% MoM`;
}

async function loadAll() {
  const months = Number(document.getElementById('months-filter').value);
  const from = new Date();
  from.setMonth(from.getMonth() - months);
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = new Date().toISOString().slice(0, 10);

  // Filtro opcional de un mes específico (afecta categorías + detalle, no las tendencias)
  const selMonth = document.getElementById('month-filter').value; // '' o 'YYYY-MM'
  let detFrom = fromStr, detTo = toStr;
  if (selMonth) {
    const [y, m] = selMonth.split('-').map(Number);
    detFrom = `${selMonth}-01`;
    detTo = new Date(y, m, 0).toISOString().slice(0, 10); // último día del mes
  }
  document.getElementById('detail-period').textContent = selMonth
    ? `· ${new Date(detFrom + 'T00:00:00').toLocaleDateString('es', { month: 'long', year: 'numeric' })}`
    : `· últimos ${months} meses`;

  let txQuery = supabase.from('transactions').select('*')
    .order('tx_date', { ascending: false }).limit(200);
  txQuery = selMonth ? txQuery.gte('tx_date', detFrom).lte('tx_date', detTo) : txQuery.gte('tx_date', fromStr);

  const [cashflow, collection, byCategory, txs] = await Promise.all([
    supabase.rpc('bi_monthly_cashflow', { p_months: months }),
    supabase.rpc('bi_collection_rate', { p_months: months }),
    supabase.rpc('bi_expenses_by_category', { p_from: detFrom, p_to: detTo }),
    txQuery,
  ]);

  if (isAdmin) loadAccesos(months);

  const cf = cashflow.data || [];
  const labels = cf.map((r) => r.month);
  const income = cf.map((r) => Number(r.income));
  const expenses = cf.map((r) => Number(r.expenses));
  const investments = cf.map((r) => Number(r.investments));

  // ----- KPIs -----
  const totIncome = income.reduce((a, b) => a + b, 0);
  const totExpenses = expenses.reduce((a, b) => a + b, 0) + investments.reduce((a, b) => a + b, 0);
  document.getElementById('kpi-income').textContent = fmtMoney(totIncome);
  document.getElementById('kpi-expenses').textContent = fmtMoney(totExpenses);
  const balance = totIncome - totExpenses;
  const balEl = document.getElementById('kpi-balance');
  balEl.textContent = fmtMoney(balance);
  balEl.classList.toggle('text-danger', balance < 0);

  const n = cf.length;
  if (n >= 2) {
    document.getElementById('kpi-income-mom').textContent = momText(income[n - 1], income[n - 2]);
    document.getElementById('kpi-expenses-mom').textContent = momText(expenses[n - 1], expenses[n - 2]);
  }

  const col = collection.data || [];
  const lastRate = col.at(-1)?.rate;
  document.getElementById('kpi-collection').textContent = lastRate != null ? `${lastRate}%` : '—';

  // ----- Gráficas -----
  renderChart('chart-cashflow', {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Ingresos', data: income, backgroundColor: '#7c2d43cc', borderRadius: 4 },
        { label: 'Gastos', data: expenses, backgroundColor: '#d97706b3', borderRadius: 4 },
      ],
    },
    options: { responsive: true, maintainAspectRatio: false },
  });

  renderChart('chart-categories', {
    type: 'doughnut',
    data: {
      labels: (byCategory.data || []).map((r) => r.category),
      datasets: [{
        data: (byCategory.data || []).map((r) => Number(r.total)),
        // Paleta de marca accesible (vino + rosas del logo + contrastes)
        backgroundColor: ['#7c2d43', '#d49ba6', '#d97706', '#586ba4', '#71606a', '#a8516e', '#0d9488', '#b45309', '#94a3b8'],
      }],
    },
    options: { responsive: true, maintainAspectRatio: false },
  });

  renderChart('chart-collection', {
    type: 'line',
    data: {
      labels: col.map((r) => r.period),
      datasets: [{
        label: 'Tasa de cobranza %',
        data: col.map((r) => Number(r.rate)),
        borderColor: '#7c2d43',
        backgroundColor: '#7c2d4322',
        tension: 0.3,
        fill: true,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { y: { min: 0, max: 100 } },
    },
  });

  renderChart('chart-investments', {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'Inversiones', data: investments, backgroundColor: '#586ba4cc', borderRadius: 4 }],
    },
    options: { responsive: true, maintainAspectRatio: false },
  });

  // ----- Tabla detalle -----
  document.getElementById('tx-body').innerHTML = (txs.data || []).map((t) => `
    <tr>
      <td>${fmtDate(t.tx_date)}</td>
      <td>${t.kind === 'expense'
        ? '<span class="badge text-bg-danger">Gasto</span>'
        : '<span class="badge text-bg-primary">Inversión</span>'}</td>
      <td>${t.category}</td><td>${t.description}</td>
      <td class="text-end">${fmtMoney(t.amount)}</td>
      <td>${t.receipt_url
        ? `<button class="btn btn-outline-success btn-sm" data-receipt="${t.receipt_url}" title="Ver factura">
             <i class="bi bi-file-earmark-text"></i>
           </button>`
        : '<span class="text-muted small">—</span>'}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="text-muted">Sin movimientos en el período.</td></tr>';
}

// Ver factura adjunta (URL firmada, expira en 5 min)
document.getElementById('tx-body').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-receipt]');
  if (!btn) return;
  const { data, error } = await supabase.storage
    .from('receipts')
    .createSignedUrl(btn.dataset.receipt, 300);
  if (error) return alert('No se pudo abrir la factura');
  window.open(data.signedUrl, '_blank');
});

// ----- Accesos y seguridad (solo junta) -----
async function loadAccesos(months) {
  const [summary, monthly, byHouse] = await Promise.all([
    supabase.rpc('bi_visits_summary', { p_months: months }),
    supabase.rpc('bi_visits_monthly', { p_months: months }),
    supabase.rpc('bi_visits_by_house', { p_months: months }),
  ]);

  const s = (summary.data && summary.data[0]) || {};
  const total = Number(s.total || 0);
  document.getElementById('kpi-acc-total').textContent = total;
  document.getElementById('kpi-acc-deliveries').textContent = Number(s.deliveries || 0);
  document.getElementById('kpi-acc-denied').textContent = Number(s.denied || 0);
  document.getElementById('kpi-acc-qr').textContent = Number(s.qr_entries || 0);
  document.getElementById('kpi-acc-app').textContent =
    total ? `${Math.round(Number(s.announced_app || 0) / total * 100)}%` : '—';

  const m = monthly.data || [];
  renderChart('chart-visits-monthly', {
    type: 'bar',
    data: {
      labels: m.map((r) => r.month),
      datasets: [
        { label: 'Visitas', data: m.map((r) => Number(r.visits)), backgroundColor: '#7c2d43cc', borderRadius: 4 },
        { label: 'Deliveries', data: m.map((r) => Number(r.deliveries)), backgroundColor: '#586ba4cc', borderRadius: 4 },
        { label: 'Denegadas', data: m.map((r) => Number(r.denied)), backgroundColor: '#d97706cc', borderRadius: 4 },
      ],
    },
    options: { responsive: true, maintainAspectRatio: false },
  });

  const h = byHouse.data || [];
  renderChart('chart-visits-houses', {
    type: 'bar',
    data: {
      labels: h.map((r) => r.house_code),
      datasets: [{ label: 'Accesos', data: h.map((r) => Number(r.total)), backgroundColor: '#7c2d43cc', borderRadius: 4 }],
    },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
  });
}

document.getElementById('months-filter').addEventListener('change', loadAll);
document.getElementById('month-filter').addEventListener('change', loadAll);
document.getElementById('month-clear').addEventListener('click', () => {
  document.getElementById('month-filter').value = '';
  loadAll();
});
await loadAll();
