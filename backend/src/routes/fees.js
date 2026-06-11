import { Router } from 'express';
import { supabaseAdmin } from '../supabase.js';

const router = Router();

// POST /api/fees/generate — generar cuotas del mes (respaldo manual de pg_cron)
router.post('/generate', async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.rpc('generate_monthly_fees');
    if (error) throw error;
    res.json({ created: data });
  } catch (err) {
    next(err);
  }
});

// POST /api/fees/mark-overdue — marcar vencidas (respaldo manual de pg_cron)
router.post('/mark-overdue', async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.rpc('mark_overdue_fees');
    if (error) throw error;
    res.json({ updated: data });
  } catch (err) {
    next(err);
  }
});

// POST /api/fees — cuota extraordinaria (derrama) para todas las casas activas
router.post('/', async (req, res, next) => {
  try {
    const { concept, amount, due_date, period } = req.body;
    if (!concept || !amount || !due_date) {
      return res.status(400).json({ error: 'concept, amount y due_date requeridos' });
    }
    const { data: houses, error: hErr } = await supabaseAdmin
      .from('houses').select('id').eq('active', true);
    if (hErr) throw hErr;

    const rows = houses.map((h) => ({
      house_id: h.id,
      period: period || new Date().toISOString().slice(0, 7),
      concept,
      amount,
      due_date,
    }));
    const { data, error } = await supabaseAdmin.from('fees').insert(rows).select();
    if (error) throw error;
    res.status(201).json({ created: data.length });
  } catch (err) {
    next(err);
  }
});

export default router;
