import { supabaseAdmin } from '../supabase.js';

// Verifica el JWT de Supabase enviado por el frontend (Authorization: Bearer <token>)
export async function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Token requerido' });

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return res.status(401).json({ error: 'Token inválido' });

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, role, full_name, house_id')
    .eq('id', data.user.id)
    .single();

  if (!profile) return res.status(403).json({ error: 'Perfil no encontrado' });

  req.user = data.user;
  req.profile = profile;
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.profile?.role)) {
      return res.status(403).json({ error: 'No autorizado para esta operación' });
    }
    next();
  };
}
