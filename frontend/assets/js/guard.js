import { supabase } from './supabaseClient.js';
import { guardPage, logout } from './auth.js';
import { badge, toast, renderNavbar, fmtDate, enableCardTables } from './ui.js';

const ctx = await guardPage('guard');
if (!ctx) throw new Error('redirect');
const { profile } = ctx;

document.getElementById('navbar').innerHTML = renderNavbar(profile, [
  ['home', './guard.html', 'Portería'],
], 'home');
document.getElementById('logout-btn').addEventListener('click', logout);
enableCardTables();

let allVisits = [];
const paymentStatusCache = new Map(); // house_id -> boolean
let knownVisitIds = null; // null = primera carga (no notificar lo ya existente)

// Sonidos con WebAudio (sin archivos). freqs = [[hz, delaySeg, durSeg], ...]
function tone(freqs, type = 'sine') {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    freqs.forEach(([freq, delay, dur]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.25, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + dur);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + dur + 0.02);
    });
  } catch { /* sin audio si el navegador lo bloquea */ }
}
const playAlertSound = () => tone([[880, 0, 0.25], [1175, 0.18, 0.25]]);   // visita nueva
const soundGranted  = () => tone([[660, 0, 0.15], [990, 0.15, 0.3]]);       // permitido
const soundDenied   = () => tone([[180, 0, 0.45]], 'square');               // denegado

function notifyNewVisits(visits) {
  if (knownVisitIds === null) {
    // primera carga: registrar sin notificar
    knownVisitIds = new Set(visits.map((v) => v.id));
    return;
  }
  const fresh = visits.filter((v) => !knownVisitIds.has(v.id) && v.status === 'announced');
  visits.forEach((v) => knownVisitIds.add(v.id));
  if (!fresh.length) return;

  playAlertSound();
  fresh.forEach((v) => {
    toast(
      `<i class="bi bi-bell-fill"></i> ${v.type === 'delivery' ? 'Delivery' : 'Visita'} para
       <strong>${v.houses.code}</strong>: ${v.visitor_name}`,
      'warning'
    );
  });
}

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
  notifyNewVisits(data);
  await renderVisits();
}

function resolvedRow(v) {
  const via = v.status === 'arrived'
    ? (v.pass_used_at
        ? '<span class="badge text-bg-success"><i class="bi bi-qr-code"></i> QR</span>'
        : '<span class="badge text-bg-secondary">Manual</span>')
    : '—';
  const hora = v.checked_at
    ? new Date(v.checked_at).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
    : '—';
  return `
    <tr>
      <td><strong>${v.houses.code}</strong></td>
      <td>${v.type === 'delivery' ? 'Delivery' : 'Visita'}</td>
      <td>${v.visitor_name}</td>
      <td>${badge(v.status)}</td>
      <td>${via}</td>
      <td>${hora}</td>
    </tr>`;
}

async function renderVisits() {
  const term = document.getElementById('search').value.trim().toLowerCase();
  const pending = [], resolved = [];
  for (const v of allVisits) {
    if (term && !v.visitor_name.toLowerCase().includes(term)
        && !v.houses.code.toLowerCase().includes(term)) continue;

    if (v.status !== 'announced') { resolved.push(resolvedRow(v)); continue; }

    const current = await houseIsCurrent(v.house_id);
    pending.push(`
      <tr class="${!current ? 'table-danger' : ''}">
        <td><strong>${v.houses.code}</strong><br /><small class="text-muted">${v.houses.owner_name}</small></td>
        <td>${current
          ? '<span class="badge text-bg-success">Al día</span>'
          : '<span class="badge text-bg-danger">En mora</span>'}</td>
        <td>${v.type === 'delivery' ? '<i class="bi bi-box-seam"></i> Delivery' : '<i class="bi bi-person"></i> Visita'}</td>
        <td>${v.visitor_name}</td>
        <td>${v.company || v.plate || '—'}</td>
        <td>${badge(v.status)}</td>
        <td>
          <button class="btn btn-success btn-sm" data-action="arrived" data-id="${v.id}"
            ${!current ? 'disabled title="Casa en mora — entrada no permitida"' : ''}>
            <i class="bi bi-check-lg"></i> Ingresó
          </button>
          <button class="btn btn-outline-danger btn-sm" data-action="denied" data-id="${v.id}">
            Denegar
          </button>
        </td>
      </tr>`);
  }
  document.getElementById('visits-body').innerHTML =
    pending.join('') || '<tr><td colspan="7" class="text-muted p-3">Sin visitas pendientes para hoy.</td></tr>';
  document.getElementById('resolved-body').innerHTML =
    resolved.join('') || '<tr><td colspan="6" class="text-muted p-3">Aún no hay visitas resueltas hoy.</td></tr>';
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

// ===== Escáner de pase QR =====
let scanStream = null, scanLoop = null, zxingControls = null, scanBusy = false;
const scanModalEl = document.getElementById('scan-modal');
const scanResult = document.getElementById('scan-result');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

// Botón "Escanear QR": en la app nativa abre el escáner MLKit (cámara nativa,
// sin teclear nada); en web abre el modal con la cámara del navegador.
document.getElementById('btn-scan').addEventListener('click', () => {
  if (isNative()) nativeScan();
  else bootstrap.Modal.getOrCreateInstance(scanModalEl).show();
});
scanModalEl.addEventListener('shown.bs.modal', () => { if (!isNative()) startScan(); });
scanModalEl.addEventListener('hidden.bs.modal', stopScan);

// ----- Escáner nativo (Capacitor + MLKit barcode-scanning) -----
async function nativeScan() {
  const sc = window.Capacitor?.Plugins?.BarcodeScanner;
  if (!sc) return toast('Escáner nativo no disponible', 'danger');
  try {
    const { barcodes } = await sc.scan({ formats: ['QR_CODE'] });
    bootstrap.Modal.getOrCreateInstance(scanModalEl).show();
    document.getElementById('scan-video').classList.add('d-none');
    const raw = barcodes?.[0]?.rawValue || barcodes?.[0]?.displayValue;
    if (raw) await handleToken(raw);
    else { scanResult.innerHTML = withRetry(banner('secondary', 'Sin lectura', 'No se detectó ningún código.')); wireRetry(); }
  } catch (e) {
    const msg = String(e?.message || e);
    // En el primer uso puede faltar el módulo de escáner de Google: lo instala
    if (/module/i.test(msg) && sc.installGoogleBarcodeScannerModule) {
      try { await sc.installGoogleBarcodeScannerModule(); toast('Preparando escáner, intenta de nuevo'); }
      catch { toast('No se pudo iniciar el escáner', 'danger'); }
    } else {
      toast('Escaneo cancelado', 'warning');
    }
  }
}

async function startScan() {
  scanResult.innerHTML = '';
  scanBusy = false;
  const video = document.getElementById('scan-video');
  video.classList.remove('d-none');
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = scanStream;
    await video.play();
  } catch {
    scanResult.innerHTML = banner('danger', 'Sin acceso a la cámara',
      'Permite el uso de la cámara para escanear pases.');
    return;
  }

  if ('BarcodeDetector' in window) {
    const detector = new BarcodeDetector({ formats: ['qr_code'] });
    const tick = async () => {
      if (!scanStream) return;
      try {
        const codes = await detector.detect(video);
        if (codes.length) return onScan(codes[0].rawValue);
      } catch { /* frame sin código */ }
      scanLoop = requestAnimationFrame(tick);
    };
    scanLoop = requestAnimationFrame(tick);
  } else {
    // Fallback: ZXing desde CDN (navegadores sin BarcodeDetector)
    const { BrowserQRCodeReader } = await import('https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/+esm');
    zxingControls = await new BrowserQRCodeReader()
      .decodeFromStream(scanStream, video, (res) => { if (res) onScan(res.getText()); });
  }
}

function stopScan() {
  if (scanLoop) { cancelAnimationFrame(scanLoop); scanLoop = null; }
  if (zxingControls) { zxingControls.stop(); zxingControls = null; }
  if (scanStream) { scanStream.getTracks().forEach((t) => t.stop()); scanStream = null; }
}

async function onScan(text) {
  if (scanBusy) return;
  scanBusy = true;
  stopScan();
  await handleToken(text);
  scanBusy = false;
}

// Valida el token, canjea el pase y muestra el resultado. Lo usan web y nativo.
async function handleToken(raw) {
  const token = (raw || '').trim();
  if (!UUID_RE.test(token)) {
    scanResult.innerHTML = withRetry(banner('danger', 'QR no válido',
      'No corresponde a un pase de EcoTerra.'));
    soundDenied();
    return wireRetry();
  }
  const { data, error } = await supabase.rpc('redeem_visit_pass', { p_token: token });
  if (error) {
    scanResult.innerHTML = withRetry(banner('danger', 'Error', error.message));
    soundDenied();
    return wireRetry();
  }
  renderScanResult(data);
  paymentStatusCache.clear();
  loadVisits();
}

function renderScanResult(d) {
  const who = `${d.house_code ? d.house_code + ' · ' : ''}${d.visitor_name || ''}`.trim();
  let html;
  switch (d.result) {
    case 'granted':
      html = banner('success', '✓ ENTRADA PERMITIDA',
        `${d.type === 'delivery' ? 'Delivery' : 'Visita'} — ${who}`);
      soundGranted(); break;
    case 'already_used':
      html = banner('danger', '✗ PASE YA UTILIZADO',
        `${who}. Validar con el residente antes de permitir el paso.`);
      soundDenied(); break;
    case 'house_overdue':
      html = banner('danger', '✗ CASA EN MORA', `${who}. Entrada no permitida.`);
      soundDenied(); break;
    case 'wrong_day':
      html = banner('warning', 'Pase para otra fecha',
        `${who}. Válido el ${fmtDate(d.expected_date)}.`);
      soundDenied(); break;
    case 'invalid_status':
      html = banner('danger', 'Pase no válido',
        `${who}. Estado: ${badge(d.status)}.`);
      soundDenied(); break;
    case 'not_found':
      html = banner('danger', 'QR no reconocido', 'El pase no existe en el sistema.');
      soundDenied(); break;
    case 'forbidden':
      html = banner('danger', 'No autorizado', 'Solo el vigilante puede validar pases.');
      soundDenied(); break;
    default:
      html = banner('secondary', 'Resultado', JSON.stringify(d));
  }
  scanResult.innerHTML = withRetry(html);
  wireRetry();
}

const banner = (type, title, msg) =>
  `<div class="alert alert-${type} mb-0"><h5 class="alert-heading mb-1">${title}</h5><p class="mb-0">${msg}</p></div>`;
const withRetry = (html) =>
  html + '<button class="btn btn-success w-100 mt-3" id="scan-again"><i class="bi bi-qr-code-scan"></i> Escanear otro</button>';
function wireRetry() {
  document.getElementById('scan-again')?.addEventListener('click', () => {
    scanResult.innerHTML = '';
    if (isNative()) nativeScan(); else startScan();
  });
}

await Promise.all([loadVisits(), loadHouses()]);
// Polling cada 20s: detecta visitas nuevas → globo + sonido.
// La limpieza de deliveries (3h anunciado / 30min resuelto) la hace
// cleanup_delivery_visits() vía pg_cron en Supabase.
setInterval(() => { paymentStatusCache.clear(); loadVisits(); }, 20000);
