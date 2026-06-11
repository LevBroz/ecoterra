import { supabase } from './supabaseClient.js';
import { getSessionProfile, homeForRole } from './auth.js';

// Si ya hay sesión, ir directo al panel del rol
const ctx = await getSessionProfile();
if (ctx) window.location.href = homeForRole(ctx.profile.role);

const form = document.getElementById('login-form');
const errorBox = document.getElementById('login-error');
const btn = document.getElementById('login-btn');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBox.classList.add('d-none');
  btn.disabled = true;
  btn.textContent = 'Ingresando…';

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    errorBox.textContent = 'Credenciales inválidas. Verifica tu correo y contraseña.';
    errorBox.classList.remove('d-none');
    btn.disabled = false;
    btn.textContent = 'Ingresar';
    return;
  }

  const session = await getSessionProfile();
  if (!session) {
    errorBox.textContent = 'Tu cuenta no tiene perfil asignado. Contacta a la junta.';
    errorBox.classList.remove('d-none');
    await supabase.auth.signOut();
    btn.disabled = false;
    btn.textContent = 'Ingresar';
    return;
  }
  window.location.href = homeForRole(session.profile.role);
});
