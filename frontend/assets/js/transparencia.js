import { supabase } from './supabaseClient.js';
import { guardPage, logout, homeForRole } from './auth.js';
import { fmtMoney, fmtDate, renderNavbar } from './ui.js';

// Transparencia: visible para residentes y admin
const ctx = await guardPage('resident', 'admin');
if (!ctx) throw new Error('redirect');
const { profile } = ctx;

document.getElementById('navbar').innerHTML = renderNavbar(profile, [
  ['home', homeForRole(profile.role), profile.role === 'admin' ? 'Administración' : 'Mi Casa'],
  ['transparencia', './transparencia.html', 'Transparencia'],
], 'transparencia');
document.getElementById('logout-btn').addEventListener('click', logout);

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

  const [cashflow, collection, byCategory, txs] = await Promise.all([
    supabase.rpc('bi_monthly_cashflow', { p_months: months }),
    supabase.rpc('bi_collection_rate', { p_months: months }),
    supabase.rpc('bi_expenses_by_category', { p_from: fromStr, p_to: toStr }),
    supabase.from('transactions').select('*').gte('tx_date', fromStr)
      .order('tx_date', { ascending: false }).limit(100),
  ]);

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
        { label: 'Ingresos', data: income, backgroundColor: '#059669cc', borderRadius: 4 },
        { label: 'Gastos', data: expenses, backgroundColor: '#dc2626b3', borderRadius: 4 },
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
        // Paleta accesible (sin pares rojo/verde puros)
        backgroundColor: ['#059669', '#0891b2', '#d97706', '#7c3aed', '#475569', '#15803d', '#be185d', '#b45309', '#0d9488'],
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
        borderColor: '#059669',
        backgroundColor: '#05966922',
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
      datasets: [{ label: 'Inversiones', data: investments, backgroundColor: '#0891b2cc', borderRadius: 4 }],
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

document.getElementById('months-filter').addEventListener('change', loadAll);
await loadAll();
