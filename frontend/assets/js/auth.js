import { supabase } from './supabaseClient.js';

const HOME_BY_ROLE = {
  admin: '/app/admin.html',
  resident: '/app/resident.html',
  guard: '/app/guard.html',
};

// Sesión + perfil, o null si no hay sesión
export async function getSessionProfile() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, role, full_name, house_id, houses(code, owner_name)')
    .eq('id', session.user.id)
    .single();
  if (error || !profile) return null;

  return { session, profile };
}

// Protege una página: exige sesión y rol permitido, si no redirige
export async function guardPage(...allowedRoles) {
  const ctx = await getSessionProfile();
  if (!ctx) {
    window.location.href = '/index.html';
    return null;
  }
  if (allowedRoles.length && !allowedRoles.includes(ctx.profile.role)) {
    window.location.href = HOME_BY_ROLE[ctx.profile.role] || '/index.html';
    return null;
  }
  return ctx;
}

export function homeForRole(role) {
  return HOME_BY_ROLE[role] || '/index.html';
}

export async function logout() {
  await supabase.auth.signOut();
  window.location.href = '/index.html';
}

// Token para llamar al backend de Render
export async function getAccessToken() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token || null;
}
