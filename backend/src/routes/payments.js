import { Router } from 'express';
import { supabaseAdmin } from '../supabase.js';

const router = Router();

// POST /api/payments — registrar pago y marcar cuota como pagada (atómico a nivel app)
router.post('/', async (req, res, next) => {
  try {
    const { house_id, fee_id, amount, method, reference, paid_at, notes } = req.body;
    if (!house_id || !amount) {
      return res.status(400).json({ error: 'house_id y amount son requeridos' });
    }

    const { data: payment, error: payErr } = await supabaseAdmin
      .from('payments')
      .insert({
        house_id,
        fee_id: fee_id || null,
        amount,
        method: method || 'transfer',
        reference,
        paid_at: paid_at || undefined,
        notes,
        recorded_by: req.profile.id,
      })
      .select()
      .single();
    if (payErr) throw payErr;

    if (fee_id) {
      const { error: feeErr } = await supabaseAdmin
        .from('fees')
        .update({ status: 'paid' })
        .eq('id', fee_id);
      if (feeErr) throw feeErr;
    }

    res.status(201).json(payment);
  } catch (err) {
    next(err);
  }
});

// GET /api/payments?house_id=&from=&to= — listado para admin
router.get('/', async (req, res, next) => {
  try {
    let q = supabaseAdmin
      .from('payments')
      .select('*, houses(code, owner_name), fees(period, concept)')
      .order('paid_at', { ascending: false });
    if (req.query.house_id) q = q.eq('house_id', req.query.house_id);
    if (req.query.from) q = q.gte('paid_at', req.query.from);
    if (req.query.to) q = q.lte('paid_at', req.query.to);

    const { data, error } = await q;
    if (error) throw error;
    res.json(data);
  } catch (err) {
    next(err);
  }
});

export default router;
