import { Router } from 'express';
import { supabaseAdmin } from '../supabase.js';

const router = Router();

// POST /api/users — admin crea usuario (residente, vigilante u otro admin)
router.post('/', async (req, res, next) => {
  try {
    const { email, password, full_name, role, house_id } = req.body;
    if (!email || !password || !full_name || !role) {
      return res.status(400).json({ error: 'email, password, full_name y role requeridos' });
    }
    if (role === 'resident' && !house_id) {
      return res.status(400).json({ error: 'resident requiere house_id' });
    }

    const { data: created, error: authErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (authErr) throw authErr;

    const { data: profile, error: profErr } = await supabaseAdmin
      .from('profiles')
      .insert({ id: created.user.id, role, full_name, house_id: house_id || null })
      .select()
      .single();
    if (profErr) {
      // rollback del usuario auth si el profile falla
      await supabaseAdmin.auth.admin.deleteUser(created.user.id);
      throw profErr;
    }

    res.status(201).json(profile);
  } catch (err) {
    next(err);
  }
});

// GET /api/users — listar perfiles
router.get('/', async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('*, houses(code, owner_name)')
      .order('created_at');
    if (error) throw error;
    res.json(data);
  } catch (err) {
    next(err);
  }
});

export default router;
